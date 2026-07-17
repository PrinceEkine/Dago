'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dago', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  },

  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChanged: (callback) => {
      ipcRenderer.on('window:maximize-changed', (event, isMaximized) => callback(isMaximized));
    },
  },

  windows: {
    open: (pageName) => ipcRenderer.invoke('windows:open', pageName),
  },

  tabs: {
    create: () => ipcRenderer.invoke('tabs:create'),
  },

  tor: {
    getStatus: () => ipcRenderer.invoke('tor:get-status'),
    newIdentity: () => ipcRenderer.invoke('tor:new-identity'),
    onStatusChanged: (callback) => {
      ipcRenderer.on('tor:status-changed', (event, status) => callback(status));
    },
  },

  adblock: {
    stats: () => ipcRenderer.invoke('adblock:stats'),
  },

  favicon: {
    fetch: (partition, url) => ipcRenderer.invoke('favicon:fetch', { partition, url }),
  },

  filterLists: {
    list: () => ipcRenderer.invoke('filterlists:list'),
    add: (name, url) => ipcRenderer.invoke('filterlists:add', { name, url }),
    remove: (id) => ipcRenderer.invoke('filterlists:remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('filterlists:set-enabled', { id, enabled }),
    update: (id) => ipcRenderer.invoke('filterlists:update', id),
    updateAll: () => ipcRenderer.invoke('filterlists:update-all'),
  },

  history: {
    record: (url, title) => ipcRenderer.send('history:record', { url, title }),
    isPinSet: () => ipcRenderer.invoke('history:is-pin-set'),
    isUnlocked: () => ipcRenderer.invoke('history:is-unlocked'),
    setPin: (pin) => ipcRenderer.invoke('history:set-pin', pin),
    verifyPin: (pin) => ipcRenderer.invoke('history:verify-pin', pin),
    lock: () => ipcRenderer.invoke('history:lock'),
    resetPin: () => ipcRenderer.invoke('history:reset-pin'),
    list: () => ipcRenderer.invoke('history:list'),
    clear: () => ipcRenderer.invoke('history:clear'),
    removeEntry: (index) => ipcRenderer.invoke('history:remove-entry', index),
  },

  screenshare: {
    getSources: () => ipcRenderer.invoke('screenshare:get-sources'),
    selectSource: (id) => ipcRenderer.invoke('screenshare:select-source', id),
  },

  webrtc: {
    getRelayConfig: () => ipcRenderer.invoke('webrtc:get-relay-config'),
    setRelayConfig: (config) => ipcRenderer.invoke('webrtc:set-relay-config', config),
  },

  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list'),
    isBookmarked: (url) => ipcRenderer.invoke('bookmarks:is-bookmarked', url),
    add: (url, title) => ipcRenderer.invoke('bookmarks:add', { url, title }),
    removeByUrl: (url) => ipcRenderer.invoke('bookmarks:remove-by-url', url),
    removeById: (id) => ipcRenderer.invoke('bookmarks:remove-by-id', id),
  },

  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
    remove: (id) => ipcRenderer.invoke('downloads:remove', id),
    openFile: (id) => ipcRenderer.invoke('downloads:open-file', id),
    showInFolder: (id) => ipcRenderer.invoke('downloads:show-in-folder', id),
  },

  search: {
    list: () => ipcRenderer.invoke('search:list'),
    setActive: (id) => ipcRenderer.invoke('search:set-active', id),
    add: (name, urlTemplate) => ipcRenderer.invoke('search:add', { name, urlTemplate }),
    remove: (id) => ipcRenderer.invoke('search:remove', id),
    buildUrl: (query) => ipcRenderer.invoke('search:build-url', query),
  },
});
