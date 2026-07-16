'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { setDynamicBlocklist } = require('./adblock');

const DEFAULT_LISTS = [
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
];

const MAX_CSS_SELECTOR_LENGTH = 300;

/**
 * Parses a safe, bounded subset of Adblock Plus filter syntax:
 *  - plain domain-blocking rules (`||domain.tld^`) and their exceptions
 *  - path/wildcard address rules (`||domain.tld/ads/*^`, `*substring*`,
 *    bare substrings like `annoying-ads.js`) as glob patterns - see
 *    `compileGlobPattern`/`globSegmentsMatch` in adblock.js, which match
 *    these with sequential `String.prototype.indexOf` scanning rather than
 *    RegExp, specifically to stay immune to catastrophic backtracking
 *  - basic element-hiding/cosmetic rules (`domain.com##selector`, `##selector`)
 *
 * Deliberately NOT supported: raw `/regex/` filters. Compiling and running
 * arbitrary regex handed to us by a (possibly compromised or malicious)
 * subscription URL is a real ReDoS vector - ABP's regex filters allow
 * patterns a hostile list could use to freeze the browser. (An earlier
 * version of the glob matcher used RegExp internally instead of indexOf and
 * had this exact problem despite being built only from escaped literals - a
 * ~30-wildcard pattern took over two minutes to fail a single match. The
 * indexOf-based matcher replaced it for that reason.) Almost all filter
 * options (`$script`, `$xmlhttprequest`, `$domain=`, etc.) are still stripped
 * and ignored - only address matching, not full request-type matching, is
 * implemented. The one option that IS read is `$third-party`: EasyList/
 * EasyPrivacy scope most of their rules with it specifically so they only
 * ever match embedded ads/trackers, never a site's own first-party content,
 * and dropping that distinction entirely turned out to make a full
 * subscription block sites' own pages/assets outright (see SECURITY.md/
 * ROADMAP.md) - so that one flag is captured and carried through to
 * adblock.js's isBlocked() rather than discarded with the rest.
 */
function parseFilterList(text) {
  const blocked = [];
  const allowed = [];
  const blockedPatterns = [];
  const allowedPatterns = [];
  const cosmeticRules = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;

    // Cosmetic rules: "domain1,domain2##selector" or "##selector". Exception
    // hiding rules (#@#), scriptlets (#$#) and procedural rules (#?#) aren't
    // supported - skip rather than misinterpret them.
    const cosmeticMatch = line.match(/^([^\s#]*)##(.+)$/);
    if (cosmeticMatch) {
      const [, domainsPart, selector] = cosmeticMatch;
      const trimmedSelector = selector.trim();
      // Guard against garbage/oversized/HTML-bearing "selectors" before they
      // ever reach a <style> tag in privacy-preload.js.
      if (!trimmedSelector || trimmedSelector.length > MAX_CSS_SELECTOR_LENGTH || /[<>{}]/.test(trimmedSelector)) continue;
      const domains = domainsPart ? domainsPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : null;
      cosmeticRules.push({ domains, selector: trimmedSelector });
      continue;
    }
    if (line.includes('#')) continue; // #@#, #$#, #?#, or anything else cosmetic-shaped we don't parse

    // Raw regex filters (wrapped in slashes): skipped entirely, see doc
    // comment above.
    if (line.startsWith('/') && line.endsWith('/') && line.length > 1) continue;

    const isException = line.startsWith('@@');
    const body = isException ? line.slice(2) : line;

    // Split off filter options (anything from the first unescaped '$'
    // onward). Only `third-party` is read out of them - see doc comment;
    // everything else in the options list is still discarded.
    const dollarIdx = body.indexOf('$');
    const addressPattern = dollarIdx === -1 ? body : body.slice(0, dollarIdx);
    const options = dollarIdx === -1 ? '' : body.slice(dollarIdx + 1);
    const thirdParty = options.split(',').map((o) => o.trim()).includes('third-party');
    if (!addressPattern) continue;

    const domainOnlyMatch = addressPattern.match(/^\|\|([a-zA-Z0-9.-]+)\^$/);
    if (domainOnlyMatch) {
      const domain = domainOnlyMatch[1].toLowerCase();
      if (isException) allowed.push({ domain, thirdParty });
      else blocked.push({ domain, thirdParty });
      continue;
    }

    // Everything else - anchored (`||`/`|`), wildcarded (`*`), or a bare
    // substring like `annoying-ads.js` - becomes a glob pattern matched
    // against the full request URL (see compileGlobPattern; a pattern with
    // no anchors or wildcards is just an unanchored literal substring
    // search, which is exactly what a bare ABP address rule means).
    if (isException) allowedPatterns.push({ pattern: addressPattern, thirdParty });
    else blockedPatterns.push({ pattern: addressPattern, thirdParty });
  }

  return { blocked, allowed, blockedPatterns, allowedPatterns, cosmeticRules };
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
      entry.ruleCount =
        parsed.blocked.length + parsed.allowed.length + parsed.blockedPatterns.length +
        parsed.allowedPatterns.length + parsed.cosmeticRules.length;
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
    const domains = [];
    const allowed = [];
    const blockedPatterns = [];
    const allowedPatterns = [];
    const cosmeticRules = [];
    for (const entry of this.lists) {
      if (!entry.enabled) continue;
      const cachePath = this._cachePath(entry.id);
      if (!fs.existsSync(cachePath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        domains.push(...(parsed.blocked || []));
        allowed.push(...(parsed.allowed || []));
        blockedPatterns.push(...(parsed.blockedPatterns || []));
        allowedPatterns.push(...(parsed.allowedPatterns || []));
        cosmeticRules.push(...(parsed.cosmeticRules || []));
      } catch (err) {
        // skip corrupt cache entry
      }
    }
    setDynamicBlocklist({ domains, allowedDomains: allowed, blockedPatterns, allowedPatterns, cosmeticRules });
  }
}

module.exports = { FilterListStore, parseFilterList, DEFAULT_LISTS };
