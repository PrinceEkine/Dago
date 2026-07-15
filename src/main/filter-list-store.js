'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { setDynamicBlocklist } = require('./adblock');

const DEFAULT_LISTS = [
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
];

/**
 * Parses a small, safe subset of Adblock Plus filter syntax: plain
 * domain-blocking rules (`||domain.tld^`) and their exceptions (`@@||domain.tld^`).
 * Cosmetic rules (element hiding), regex filters, and path-scoped rules are
 * intentionally skipped - Dago's blocking is domain-level only (see
 * adblock.js), so this parser only extracts what it can actually enforce.
 */
function parseFilterList(text) {
  const blocked = [];
  const allowed = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.includes('#')) continue; // cosmetic/element-hiding rules

    const isException = line.startsWith('@@');
    const body = isException ? line.slice(2) : line;

    const match = body.match(/^\|\|([a-zA-Z0-9.-]+)\^/);
    if (!match) continue;

    const domain = match[1].toLowerCase();
    if (isException) allowed.push(domain);
    else blocked.push(domain);
  }

  return { blocked, allowed };
}

/**
 * Manages user-controlled filter list subscriptions. Nothing is fetched
 * automatically on startup or on a timer - lists are only ever fetched when
 * the user explicitly adds one or clicks "Update" in Settings, per
 * docs/ROADMAP.md's "not a silent background fetch" requirement.
 */
class FilterListStore {
  constructor(userDataDir) {
    this.configPath = path.join(userDataDir, 'filter-lists.json');
    this.cacheDir = path.join(userDataDir, 'filter-lists-cache');
    this.lists = this._loadConfig();
    this._rebuildDynamicBlocklist();
  }

  _loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch (err) {
        // fall through to defaults below
      }
    }
    return DEFAULT_LISTS.map((l) => ({ ...l, enabled: false, lastUpdated: null, ruleCount: 0 }));
  }

  _saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.lists, null, 2));
  }

  _cachePath(id) {
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    return path.join(this.cacheDir, `${id}.json`);
  }

  list() {
    return this.lists;
  }

  add(name, url) {
    if (!name || !url) return { ok: false, reason: 'Name and URL are required.' };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return { ok: false, reason: 'Only https:// URLs are supported.' };
    } catch (err) {
      return { ok: false, reason: 'Invalid URL.' };
    }
    const id = crypto.randomUUID();
    this.lists.push({ id, name, url, enabled: false, lastUpdated: null, ruleCount: 0 });
    this._saveConfig();
    return { ok: true, id };
  }

  remove(id) {
    this.lists = this.lists.filter((l) => l.id !== id);
    this._saveConfig();
    const cachePath = this._cachePath(id);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    this._rebuildDynamicBlocklist();
    return { ok: true };
  }

  setEnabled(id, enabled) {
    const entry = this.lists.find((l) => l.id === id);
    if (!entry) return { ok: false, reason: 'not-found' };
    entry.enabled = enabled;
    this._saveConfig();
    this._rebuildDynamicBlocklist();
    return { ok: true };
  }

  async update(id) {
    const entry = this.lists.find((l) => l.id === id);
    if (!entry) return { ok: false, reason: 'not-found' };

    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const parsed = parseFilterList(text);
      fs.writeFileSync(this._cachePath(id), JSON.stringify(parsed));
      entry.lastUpdated = Date.now();
      entry.ruleCount = parsed.blocked.length + parsed.allowed.length;
      this._saveConfig();
      this._rebuildDynamicBlocklist();
      return { ok: true, ruleCount: entry.ruleCount };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async updateAll() {
    const results = [];
    for (const entry of this.lists) {
      results.push({ id: entry.id, name: entry.name, ...(await this.update(entry.id)) });
    }
    return results;
  }

  _rebuildDynamicBlocklist() {
    const domains = new Set();
    const allowed = new Set();
    for (const entry of this.lists) {
      if (!entry.enabled) continue;
      const cachePath = this._cachePath(entry.id);
      if (!fs.existsSync(cachePath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        parsed.blocked.forEach((d) => domains.add(d));
        parsed.allowed.forEach((d) => allowed.add(d));
      } catch (err) {
        // skip corrupt cache entry
      }
    }
    setDynamicBlocklist(domains, allowed);
  }
}

module.exports = { FilterListStore, parseFilterList, DEFAULT_LISTS };
