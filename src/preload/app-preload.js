'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dago', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
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
});
