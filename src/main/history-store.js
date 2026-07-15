'use strict';

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 20000;

/**
 * Browsing history is always encrypted at rest using the OS keychain-backed
 * `safeStorage` API (Keychain / DPAPI / libsecret), independent of the user's
 * PIN. The PIN is a separate, in-app gate: it doesn't derive the encryption
 * key, so background history logging keeps working without prompting for a
 * PIN on every page load - the PIN only gates *viewing* history in the UI.
 */
class HistoryStore {
  constructor(userDataDir, safeStorage) {
    this.filePath = path.join(userDataDir, 'history.enc');
    this.safeStorage = safeStorage;
    this.entries = this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const encrypted = fs.readFileSync(this.filePath);
      if (!this.safeStorage.isEncryptionAvailable()) return [];
      const decrypted = this.safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    } catch (err) {
      return [];
    }
  }

  _persist() {
    if (!this.safeStorage.isEncryptionAvailable()) return;
    const encrypted = this.safeStorage.encryptString(JSON.stringify(this.entries));
    fs.writeFileSync(this.filePath, encrypted);
  }

  record(url, title) {
    if (!url || url.startsWith('dago://')) return;
    this.entries.push({ url, title: title || url, timestamp: Date.now() });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this._persist();
  }

  list() {
    return [...this.entries].reverse();
  }

  clear() {
    this.entries = [];
    this._persist();
  }

  removeEntry(index) {
    const reversedIdx = this.entries.length - 1 - index;
    if (reversedIdx >= 0 && reversedIdx < this.entries.length) {
      this.entries.splice(reversedIdx, 1);
      this._persist();
    }
  }
}

module.exports = { HistoryStore };
