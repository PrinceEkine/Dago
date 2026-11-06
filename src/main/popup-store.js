'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Hostnames match exactly or by subdomain: allowlisting example.com covers
// app.example.com, but never a merely similar name (evil-example.com) and
// never a parent (com). Deliberately NOT registrable-domain matching: with
// only a partial public-suffix list, that would over-cover hosts like
// user.github.io (see adblock.js's MULTI_LABEL_SUFFIXES caveat) - exact
// hostname scoping has no such failure mode.
function hostnameMatches(hostname, entry) {
  return hostname === entry || hostname.endsWith(`.${entry}`);
}

function hostnameFromUrl(openerUrl) {
  try {
    const hostname = new URL(openerUrl).hostname.toLowerCase();
    return hostname || null; // file:// and friends have no hostname - never allowlistable
  } catch (err) {
    return null;
  }
}

/**
 * Per-site popup allow-list. Dago blocks popups from every site by default
 * (see main.js setWindowOpenHandler); this stores the user's explicit
 * exceptions, keyed by the OPENER's hostname - i.e. the site the tab was
 * on when it called window.open(), not the popup's target (an OAuth login
 * popup necessarily targets a different site than the opener). Plain local
 * JSON like bookmarks - allowed-popup origins aren't treated as sensitive.
 */
class PopupStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'popup-allowlist.json');
    this.entries = this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(data)) return [];
      return data.filter((e) => e && typeof e.hostname === 'string' && e.hostname);
    } catch (err) {
      return [];
    }
  }

  _persist() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  list() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Whether popups may open from the site at `openerUrl`. Fail-closed: unknown/unparseable opener → false. */
  isAllowed(openerUrl) {
    const hostname = hostnameFromUrl(openerUrl);
    if (!hostname) return false;
    return this.entries.some((e) => hostnameMatches(hostname, e.hostname));
  }

  allow(openerUrl) {
    const hostname = hostnameFromUrl(openerUrl);
    if (!hostname) return { ok: false, reason: 'Could not determine the site to allow.' };
    const existing = this.entries.find((e) => e.hostname === hostname);
    if (existing) return { ok: true, hostname, added: false };
    this.entries.push({ id: crypto.randomUUID(), hostname, createdAt: Date.now() });
    this._persist();
    return { ok: true, hostname, added: true };
  }

  remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this._persist();
    return { ok: true };
  }
}

module.exports = { PopupStore };
