'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = { enabled: false, url: '', username: '', credential: '', forceRelay: false };

/**
 * Optional TURN relay configuration for the screensharing feature (see
 * docs/ROADMAP.md). Without a TURN server, screensharing connects directly
 * peer-to-peer via STUN, which reveals both peers' public IP addresses to
 * each other by the nature of P2P WebRTC. Configuring a TURN server here lets
 * traffic route through it instead - and enabling "force relay" guarantees
 * it, by refusing to negotiate direct candidates at all.
 *
 * Stored encrypted at rest (OS keychain-backed `safeStorage`) since the
 * credential field may be a real secret for a paid/shared TURN service.
 */
class WebrtcRelayStore {
  constructor(userDataDir, safeStorage) {
    this.filePath = path.join(userDataDir, 'webrtc-relay.enc');
    this.safeStorage = safeStorage;
    this.config = this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return { ...DEFAULT_CONFIG };
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return { ...DEFAULT_CONFIG };
      const decrypted = this.safeStorage.decryptString(fs.readFileSync(this.filePath));
      return { ...DEFAULT_CONFIG, ...JSON.parse(decrypted) };
    } catch (err) {
      return { ...DEFAULT_CONFIG };
    }
  }

  _persist() {
    if (!this.safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(this.filePath, this.safeStorage.encryptString(JSON.stringify(this.config)));
  }

  get() {
    return this.config;
  }

  /** `credential` may be omitted/empty to keep whatever secret is already stored. */
  set({ enabled, url, username, credential, forceRelay }) {
    this.config = {
      enabled: !!enabled,
      url: url || '',
      username: username || '',
      credential: credential ? credential : this.config.credential,
      forceRelay: !!forceRelay,
    };
    this._persist();
    return { ok: true };
  }
}

module.exports = { WebrtcRelayStore };
