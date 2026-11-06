'use strict';

const { app, BrowserWindow, nativeTheme, safeStorage, session, desktopCapturer } = require('electron');
const path = require('path');

const { TorManager } = require('./tor-manager');
const { PinStore } = require('./pin-store');
const { HistoryStore } = require('./history-store');
const { FilterListStore } = require('./filter-list-store');
const { getBlocklistStats } = require('./adblock');
const { WebrtcRelayStore } = require('./webrtc-relay-store');
const { BookmarkStore } = require('./bookmark-store');
const { DownloadManager } = require('./download-manager');
const { SearchProviderStore } = require('./search-provider-store');
const { ThemeStore } = require('./theme-store');
const { PopupStore } = require('./popup-store');
const { registerIpc } = require('./ipc');

let mainWindow;
let torManager;
let historyStore;
let themeStore;
let popupStore;
// True while the main window's fullscreen state is owned by a tab's HTML
// fullscreen request (e.g. a video's fullscreen button) rather than the
// user's own F11 - so leaving video fullscreen doesn't also exit a
// fullscreen the user entered deliberately (matches Chrome's behavior).
let videoOwnedFullscreen = false;

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
    backgroundColor: themeStore.windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  // The resolved theme rides along in the URL so theme-init.js can apply it
  // before first paint (no flash), without weakening the page's CSP with an
  // inline script or adding a synchronous IPC round-trip.
  win.loadFile(path.join(__dirname, '..', 'renderer', 'pages', `${pageName}.html`), {
    query: { 'dago-theme': themeStore.resolved },
  });
  utilityWindows.set(pageName, win);
  win.on('closed', () => utilityWindows.delete(pageName));
}

// Merges the OS window frame with Dago's own tab strip, the way Chrome/Edge
// do, instead of a native titlebar sitting above a separate custom tab row.
// macOS keeps its native traffic-light buttons via `titleBarStyle:
// 'hiddenInset'` (removing them entirely would be off-platform - macOS users
// expect them); Windows/Linux get `frame: false` and Dago draws its own
// minimize/maximize/close buttons (see index.html's `.window-controls`,
// wired up in renderer.js via the `windowControls` preload bridge).
const macTitleBarOptions = { titleBarStyle: 'hiddenInset' };
const framelessOptions = { frame: false };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: themeStore.windowBackgroundColor(),
    title: 'Dago',
    fullscreenable: true,
    ...(process.platform === 'darwin' ? macTitleBarOptions : framelessOptions),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-changed', false));

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:fullscreen-changed', false));

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

  // The resolved theme rides along in the URL - see openUtilityWindow.
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: { 'dago-theme': themeStore.resolved },
  });

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

  // The theme store is the one store created before the window: window
  // creation needs the resolved theme (background color, URL stamp), and its
  // setup is a single tiny JSON read, not the heavy I/O the reorder below
  // is about.
  themeStore = new ThemeStore(userDataDir, nativeTheme);
  // Same for the popup allow-list: the window-open handler (registered below
  // at module scope) consults it, so it must exist before any webview can.
  popupStore = new PopupStore(userDataDir);

  // The window is created before the remaining stores below: loadFile is
  // asynchronous, so Chromium starts parsing/rendering the chrome UI while
  // the main thread is still busy with synchronous store setup (history
  // decrypt, filter-list parsing/indexing). This is safe because renderer
  // IPC can't arrive until this synchronous block finishes, by which point
  // registerIpc has run.
  createWindow();

  torManager = new TorManager(userDataDir);
  const pinStore = new PinStore(userDataDir);
  historyStore = new HistoryStore(userDataDir, safeStorage);
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

  // Fetches Dago's own hardcoded default lists (EasyList/EasyPrivacy) if
  // they've never been fetched or have gone stale - never anything the user
  // added themselves. Deliberately not awaited: this shouldn't delay the
  // window appearing, and a background refresh has nothing useful to block
  // on anyway (see filter-list-store.js's doc comment for the trust
  // reasoning behind auto-fetching these two specifically).
  filterListStore.autoUpdateDefaults().catch(() => {}).finally(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('adblock:stats-changed', getBlocklistStats());
    }
  });

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
    themeStore,
    popupStore,
    desktopCapturer,
    setPendingScreenShareSource,
    openUtilityWindow,
  });

  const result = await torManager.start();
  if (mainWindow) {
    mainWindow.webContents.send('tor:status-changed', {
      available: result.available,
      reason: result.reason || null,
      source: result.source || null,
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
  // History logging only schedules trailing writes (see history-store.js),
  // so a quit must flush the latest entries synchronously - this handler
  // runs before the process exits, which the debounced timer can't rely on.
  if (historyStore) historyStore.flush();
  if (torManager) torManager.stop();
});

// Video calling is disallowed as a matter of policy: camera access is never
// granted to any origin. Microphone-only requests (voice notes, dictation)
// are allowed through. This is defense in depth on top of the getUserMedia
// override injected by privacy-preload.js into every tab.
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    // Popup handling, enforced where page content can't reach it. Three
    // traps made earlier attempts at this silently ineffective, in sequence:
    // <webview>'s `allowpopups` is a boolean attribute (setting it to the
    // string "false" still ENABLES popups - Electron only checks for its
    // presence); the webview `new-window` event was removed from Electron
    // long ago, so a listener on it never fires; and this very handler is
    // only ever CONSULTED for webview guests when the tag carries the
    // `allowpopups` attribute at all (see renderer.js createTab) - without
    // it, Chromium refuses the request below the app and the deny below
    // never runs. See SECURITY.md for the full archaeology.
    //
    // setWindowOpenHandler is therefore the SOLE gatekeeper now: deny by
    // default, allow only for openers on the user's popup allow-list (see
    // popup-store.js - keyed by the opener's site, since an OAuth popup
    // necessarily targets a different site). Even then, never a native
    // window: the URL is handed to the renderer to open as a normal Dago
    // tab (fresh isolated session, adblocking, privacy preload - everything
    // a tab gets), because a native child window would escape all of that.
    // Always denying natively also sidesteps the window.open()
    // features-string option-injection class entirely: there is no child
    // window to inject options into.
    contents.setWindowOpenHandler(({ url }) => {
      const openerUrl = contents.getURL();
      if (popupStore && popupStore.isAllowed(openerUrl)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('popups:open-in-tab', { url });
        }
        return { action: 'deny' };
      }
      console.log(`[dago] blocked popup from tab content: ${url}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('popups:blocked', {
          contentsId: contents.id,
          openerUrl,
          popupUrl: url,
        });
      }
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

    // HTML fullscreen from tab content (a video player's fullscreen button):
    // without this the request only fills the webview area behind Dago's
    // own tab strip/toolbar. Entering real window fullscreen makes it true
    // fullscreen; the renderer hides the chrome on the resulting
    // window:fullscreen-changed event (see renderer.js).
    contents.on('enter-html-full-screen', () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFullScreen()) {
        videoOwnedFullscreen = true;
        mainWindow.setFullScreen(true);
      }
    });
    contents.on('leave-html-full-screen', () => {
      if (videoOwnedFullscreen && mainWindow && !mainWindow.isDestroyed()) {
        videoOwnedFullscreen = false;
        mainWindow.setFullScreen(false);
      }
    });
  }

  // F11 toggles fullscreen no matter where focus is - tab content included,
  // where a renderer-side keydown handler would never see the key. Handled
  // here (and only here) so one press can't double-toggle. A webview guest
  // has no window of its own, so its target is always the main window;
  // anything else (chrome, utility windows) toggles its own window.
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      const target = contents.getType() === 'webview'
        ? mainWindow
        : BrowserWindow.fromWebContents(contents);
      if (target && !target.isDestroyed()) {
        event.preventDefault();
        target.setFullScreen(!target.isFullScreen());
      }
    }
  });

  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media') {
      const wantsVideo = !details.mediaTypes || details.mediaTypes.includes('video');
      callback(!wantsVideo);
      return;
    }
    callback(true);
  });
});
