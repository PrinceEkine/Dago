'use strict';

const { app, BrowserWindow, safeStorage, session, desktopCapturer } = require('electron');
const path = require('path');

const { TorManager } = require('./tor-manager');
const { PinStore } = require('./pin-store');
const { HistoryStore } = require('./history-store');
const { FilterListStore } = require('./filter-list-store');
const { WebrtcRelayStore } = require('./webrtc-relay-store');
const { BookmarkStore } = require('./bookmark-store');
const { DownloadManager } = require('./download-manager');
const { SearchProviderStore } = require('./search-provider-store');
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
    // Explicitly off (not just relying on default) so the preload script can
    // require('electron').ipcRenderer to fetch cosmetic-hiding rules for the
    // page's hostname - sandboxed preloads only get a much more restricted
    // require.
    webPreferences.sandbox = false;
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
  const bookmarkStore = new BookmarkStore(userDataDir);
  const downloadManager = new DownloadManager();
  downloadManager.attachToSession(session.defaultSession);
  const searchProviderStore = new SearchProviderStore(userDataDir);

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
    bookmarkStore,
    downloadManager,
    searchProviderStore,
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
  if (contents.getType() === 'webview') {
    // Popup blocking, enforced where page content can't reach it. Two traps
    // made earlier renderer-side attempts silently ineffective: <webview>'s
    // `allowpopups` is a boolean attribute (setting it to the string "false"
    // still ENABLES popups - Electron only checks for its presence), and the
    // webview `new-window` event was removed from Electron long ago, so a
    // listener on it never fires. setWindowOpenHandler is the authoritative
    // modern mechanism. Trade-off: legitimate window.open() uses (OAuth
    // login popups, "open in new window" buttons) are blocked too - a
    // per-site allow-list is tracked in docs/ROADMAP.md.
    contents.setWindowOpenHandler(({ url }) => {
      console.log(`[dago] blocked popup from tab content: ${url}`);
      return { action: 'deny' };
    });

    // WebRTC does not go through the tab's SOCKS proxy, so page scripts
    // could otherwise learn the machine's real IP via a STUN binding request
    // even while the tab's HTTP traffic is Tor-routed (ad/tracking scripts
    // actively do this). Restrict tab WebRTC to proxied transports only;
    // since Tor's SOCKS proxy carries no UDP, this effectively disables
    // WebRTC-based IP discovery in tabs. Dago's own Screenshare window is a
    // regular BrowserWindow, not a webview, so it keeps normal WebRTC
    // behavior.
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  }

  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media') {
      const wantsVideo = !details.mediaTypes || details.mediaTypes.includes('video');
      callback(!wantsVideo);
      return;
    }
    callback(true);
  });
});

