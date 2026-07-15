'use strict';

const { app, BrowserWindow, safeStorage, session, desktopCapturer } = require('electron');
const path = require('path');

const { TorManager } = require('./tor-manager');
const { PinStore } = require('./pin-store');
const { HistoryStore } = require('./history-store');
const { FilterListStore } = require('./filter-list-store');
const { WebrtcRelayStore } = require('./webrtc-relay-store');
const { registerIpc } = require('./ipc');

let mainWindow;
let torManager;

const utilityWindows = new Map();

function openUtilityWindow(pageName) {
  const existing = utilityWindows.get(pageName);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    title: `Dago - ${pageName[0].toUpperCase()}${pageName.slice(1)}`,
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'pages', `${pageName}.html`));
  utilityWindows.set(pageName, win);
  win.on('closed', () => utilityWindows.delete(pageName));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#1a1b26',
    title: 'Dago',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  // Every <webview> the renderer creates gets our privacy patch as its
  // preload, regardless of what the renderer script asks for. This is
  // enforced here, not in the renderer, so a compromised page inside a tab
  // can't opt itself out of the fingerprint/getUserMedia hardening.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
    webPreferences.preload = path.join(__dirname, '..', 'preload', 'privacy-preload.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = false;
    webPreferences.webSecurity = true;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Only Dago's own screenshare page (loaded in the default session) can
// fulfil getDisplayMedia, and only with a source the user explicitly picked
// in our UI (see ipc.js `screenshare:select-source`). Tabs never get a
// display-media handler, so arbitrary websites can't trigger a screen-share
// prompt at all - screensharing only happens through Dago's own feature.
let pendingScreenShareSourceId = null;

function setPendingScreenShareSource(sourceId) {
  pendingScreenShareSourceId = sourceId;
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData');

  torManager = new TorManager(userDataDir);
  const pinStore = new PinStore(userDataDir);
  const historyStore = new HistoryStore(userDataDir, safeStorage);
  const filterListStore = new FilterListStore(userDataDir);
  const webrtcRelayStore = new WebrtcRelayStore(userDataDir, safeStorage);

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!pendingScreenShareSourceId) {
      callback({});
      return;
    }
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const match = sources.find((s) => s.id === pendingScreenShareSourceId);
    pendingScreenShareSourceId = null;
    callback(match ? { video: match } : {});
  });

  createWindow();

  registerIpc({
    mainWindow,
    torManager,
    pinStore,
    historyStore,
    filterListStore,
    webrtcRelayStore,
    desktopCapturer,
    setPendingScreenShareSource,
    openUtilityWindow,
  });

  const result = await torManager.start();
  if (mainWindow) {
    mainWindow.webContents.send('tor:status-changed', {
      available: result.available,
      reason: result.reason || null,
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (torManager) torManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (torManager) torManager.stop();
});

// Video calling is disallowed as a matter of policy: camera access is never
// granted to any origin. Microphone-only requests (voice notes, dictation)
// are allowed through. This is defense in depth on top of the getUserMedia
// override injected by privacy-preload.js into every tab.
app.on('web-contents-created', (event, contents) => {
  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media') {
      const wantsVideo = !details.mediaTypes || details.mediaTypes.includes('video');
      callback(!wantsVideo);
      return;
    }
    callback(true);
  });
});

