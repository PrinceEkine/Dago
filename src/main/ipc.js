'use strict';

const { ipcMain, session, app } = require('electron');
const crypto = require('crypto');
const { attachAdblock, BLOCKED_DOMAINS } = require('./adblock');

const NORMALIZED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Wires all renderer <-> main IPC. Called once from main.js at startup. */
function registerIpc({
  mainWindow,
  torManager,
  pinStore,
  historyStore,
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

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('windows:open', (event, pageName) => {
    const allowed = ['history', 'settings', 'screenshare'];
    if (!allowed.includes(pageName)) return { ok: false, reason: 'unknown-page' };
    openUtilityWindow(pageName);
    return { ok: true };
  });

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
