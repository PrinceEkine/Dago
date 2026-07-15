'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

class PinStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'pin.json');
    this.unlocked = false;
  }

  isSet() {
    return fs.existsSync(this.filePath);
  }

  _deriveVerifier(pin, salt) {
    return crypto.scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTS).toString('hex');
  }

  setPin(pin) {
    if (!pin || pin.length < 4) {
      return { ok: false, reason: 'PIN must be at least 4 characters.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const verifier = this._deriveVerifier(pin, salt);
    fs.writeFileSync(this.filePath, JSON.stringify({ salt, verifier }));
    this.unlocked = true;
    return { ok: true };
  }

  verify(pin) {
    if (!this.isSet()) return { ok: false, reason: 'no-pin-set' };
    const { salt, verifier } = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    const attempt = this._deriveVerifier(pin || '', salt);
    const match = crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(verifier));
    if (match) this.unlocked = true;
    return { ok: match };
  }

  lock() {
    this.unlocked = false;
  }

  isUnlocked() {
    return this.unlocked;
  }

  reset() {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    this.unlocked = false;
  }
}

module.exports = { PinStore };
