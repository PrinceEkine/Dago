'use strict';

const { ipcMain, session, app } = require('electron');
const crypto = require('crypto');
const { attachAdblock, getCosmeticRulesForHost, BLOCKED_DOMAINS } = require('./adblock');

const NORMALIZED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Wires all renderer <-> main IPC. Called once from main.js at startup. */
function registerIpc({
  mainWindow,
  torManager,
  pinStore,
  historyStore,
  filterListStore,
  webrtcRelayStore,
  bookmarkStore,
  downloadManager,
  desktopCapturer,
  setPendingScreenShareSource,
  openUtilityWindow,
}) {
  const tabSessions = new Map();

  ipcMain.handle('tabs:create', (event) => {
    const partition = `tab-${crypto.randomUUID()}`;
    const ses = session.fromPartition(partition); // no "persist:" prefix => in-memory, wiped on close

    let torPort = null;
    if (torManager.available) {
      torPort = torManager.assignPortForTab();
      ses.setProxy({ proxyRules: torManager.proxyRulesForPort(torPort) });
    }

    attachAdblock(ses, { enabled: true });
    downloadManager.attachToSession(ses);

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = NORMALIZED_USER_AGENT;
      callback({ requestHeaders: details.requestHeaders });
    });

    tabSessions.set(partition, ses);
    return { partition, torPort, torAvailable: torManager.available };
  });

  ipcMain.handle('tor:get-status', () => ({
    available: torManager.available,
    bootstrapped: torManager.bootstrapped,
  }));

  ipcMain.handle('tor:new-identity', async () => torManager.newIdentity());

  ipcMain.handle('adblock:stats', () => ({ domainCount: BLOCKED_DOMAINS.length }));

  // Called from privacy-preload.js (running inside tab webviews) to fetch
  // cosmetic/element-hiding CSS selectors for the page's own hostname.
  ipcMain.handle('adblock:cosmetic-rules-for-host', (event, hostname) => getCosmeticRulesForHost(hostname));

  // --- Filter list subscriptions (EasyList/EasyPrivacy-style, user-controlled) ---

  ipcMain.handle('filterlists:list', () => filterListStore.list());
  ipcMain.handle('filterlists:add', (event, { name, url }) => filterListStore.add(name, url));
  ipcMain.handle('filterlists:remove', (event, id) => filterListStore.remove(id));
  ipcMain.handle('filterlists:set-enabled', (event, { id, enabled }) => filterListStore.setEnabled(id, enabled));
  ipcMain.handle('filterlists:update', (event, id) => filterListStore.update(id));
  ipcMain.handle('filterlists:update-all', () => filterListStore.updateAll());

  // --- Screenshare TURN relay configuration ---

  ipcMain.handle('webrtc:get-relay-config', () => webrtcRelayStore.get());
  ipcMain.handle('webrtc:set-relay-config', (event, config) => webrtcRelayStore.set(config));

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('windows:open', (event, pageName) => {
    const allowed = ['history', 'settings', 'screenshare', 'bookmarks', 'downloads'];
    if (!allowed.includes(pageName)) return { ok: false, reason: 'unknown-page' };
    openUtilityWindow(pageName);
    return { ok: true };
  });

  // --- Bookmarks (not access-controlled, unlike history) ---

  ipcMain.handle('bookmarks:list', () => bookmarkStore.list());
  ipcMain.handle('bookmarks:is-bookmarked', (event, url) => bookmarkStore.isBookmarked(url));
  ipcMain.handle('bookmarks:add', (event, { url, title }) => bookmarkStore.add(url, title));
  ipcMain.handle('bookmarks:remove-by-url', (event, url) => bookmarkStore.removeByUrl(url));
  ipcMain.handle('bookmarks:remove-by-id', (event, id) => bookmarkStore.removeById(id));

  // --- Downloads ---

  ipcMain.handle('downloads:list', () => downloadManager.list());
  ipcMain.handle('downloads:cancel', (event, id) => downloadManager.cancel(id));
  ipcMain.handle('downloads:remove', (event, id) => downloadManager.remove(id));
  ipcMain.handle('downloads:open-file', (event, id) => downloadManager.openFile(id));
  ipcMain.handle('downloads:show-in-folder', (event, id) => downloadManager.showInFolder(id));

  // --- History (PIN-gated viewing; logging always on, encrypted at rest) ---

  ipcMain.on('history:record', (event, { url, title }) => {
    historyStore.record(url, title);
  });

  ipcMain.handle('history:is-pin-set', () => pinStore.isSet());

  ipcMain.handle('history:is-unlocked', () => pinStore.isUnlocked());

  ipcMain.handle('history:set-pin', (event, pin) => pinStore.setPin(pin));

  ipcMain.handle('history:verify-pin', (event, pin) => pinStore.verify(pin));

  ipcMain.handle('history:lock', () => {
    pinStore.lock();
    return { ok: true };
  });

  ipcMain.handle('history:reset-pin', () => {
    if (!pinStore.isUnlocked()) return { ok: false, reason: 'locked' };
    pinStore.reset();
    return { ok: true };
  });

  ipcMain.handle('history:list', () => {
    if (!pinStore.isUnlocked()) return { locked: true, entries: [] };
    return { locked: false, entries: historyStore.list() };
  });

  ipcMain.handle('history:clear', () => {
    if (!pinStore.isUnlocked()) return { ok: false, reason: 'locked' };
    historyStore.clear();
    return { ok: true };
  });

  ipcMain.handle('history:remove-entry', (event, index) => {
    if (!pinStore.isUnlocked()) return { ok: false, reason: 'locked' };
    historyStore.removeEntry(index);
    return { ok: true };
  });

  // --- Screensharing (screen/window capture only - camera is never involved) ---

  ipcMain.handle('screenshare:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 300, height: 200 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('screenshare:select-source', (event, sourceId) => {
    setPendingScreenShareSource(sourceId);
    return { ok: true };
  });
}

module.exports = { registerIpc };
