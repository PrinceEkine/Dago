'use strict';

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 20000;

// Background history logging (record()) only schedules a trailing write -
// see _schedulePersist. Explicit user actions and app quit flush now.
const PERSIST_DEBOUNCE_MS = 1500;

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
    this._persistTimer = null;
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

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist();
    }, PERSIST_DEBOUNCE_MS);
    // A pending history write must never hold the process open on its own;
    // a clean quit always goes through flush() instead.
    if (typeof this._persistTimer.unref === 'function') this._persistTimer.unref();
  }

  /** Cancels any scheduled write and persists now. Called on quit and explicit edits. */
  flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._persist();
  }

  record(url, title) {
    if (!url || url.startsWith('dago://')) return;
    this.entries.push({ url, title: title || url, timestamp: Date.now() });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    // record() fires on every navigation and title update - encrypting and
    // rewriting the whole file synchronously each time stalls the main
    // thread mid-page-load (and grows with history size), so background
    // logging only schedules a trailing write. Explicit user actions
    // (clear/remove) and app quit flush immediately instead.
    this._schedulePersist();
  }

  list() {
    return [...this.entries].reverse();
  }

  clear() {
    this.entries = [];
    this.flush();
  }

  removeEntry(index) {
    const reversedIdx = this.entries.length - 1 - index;
    if (reversedIdx >= 0 && reversedIdx < this.entries.length) {
      this.entries.splice(reversedIdx, 1);
      this.flush();
    }
  }
}

module.exports = { HistoryStore };
