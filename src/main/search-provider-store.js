'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// %s is the query placeholder, replaced with the encoded search terms -
// the same convention most browsers use for custom search engine URLs.
const DEFAULT_PROVIDERS = [
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q=%s', builtIn: true },
  { id: 'startpage', name: 'Startpage', urlTemplate: 'https://www.startpage.com/sp/search?query=%s', builtIn: true },
  { id: 'brave', name: 'Brave Search', urlTemplate: 'https://search.brave.com/search?q=%s', builtIn: true },
  { id: 'mojeek', name: 'Mojeek', urlTemplate: 'https://www.mojeek.com/search?q=%s', builtIn: true },
];

/**
 * Lets the user choose which search engine the address bar submits
 * non-URL input to, and add their own (any https:// URL template with a
 * %s query placeholder). DuckDuckGo remains the default, matching prior
 * behavior when this didn't exist as a setting.
 */
class SearchProviderStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'search-providers.json');
    const loaded = this._load();
    this.providers = loaded.providers;
    this.activeId = loaded.activeId;
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (Array.isArray(data.providers) && data.providers.length > 0) {
          return { providers: data.providers, activeId: data.activeId || data.providers[0].id };
        }
      } catch (err) {
        // fall through to defaults
      }
    }
    return { providers: DEFAULT_PROVIDERS.map((p) => ({ ...p })), activeId: 'duckduckgo' };
  }

  _persist() {
    fs.writeFileSync(this.filePath, JSON.stringify({ providers: this.providers, activeId: this.activeId }, null, 2));
  }

  list() {
    return this.providers.map((p) => ({ ...p, active: p.id === this.activeId }));
  }

  getActive() {
    return this.providers.find((p) => p.id === this.activeId) || this.providers[0];
  }

  setActive(id) {
    if (!this.providers.some((p) => p.id === id)) return { ok: false, reason: 'not-found' };
    this.activeId = id;
    this._persist();
    return { ok: true };
  }

  add(name, urlTemplate) {
    if (!name || !urlTemplate) return { ok: false, reason: 'Name and URL template are required.' };
    if (!urlTemplate.includes('%s')) return { ok: false, reason: 'URL template must include %s as the query placeholder.' };
    try {
      const parsed = new URL(urlTemplate.replace('%s', 'test'));
      if (parsed.protocol !== 'https:') return { ok: false, reason: 'Only https:// URLs are supported.' };
    } catch (err) {
      return { ok: false, reason: 'Invalid URL template.' };
    }
    const id = crypto.randomUUID();
    this.providers.push({ id, name, urlTemplate, builtIn: false });
    this._persist();
    return { ok: true, id };
  }

  remove(id) {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) return { ok: false, reason: 'not-found' };
    if (provider.builtIn) return { ok: false, reason: 'Built-in providers cannot be removed.' };
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = this.providers[0]?.id || 'duckduckgo';
    this._persist();
    return { ok: true };
  }

  /** Builds the search URL for a query using the currently active provider. */
  buildSearchUrl(query) {
    const provider = this.getActive();
    return provider.urlTemplate.replace('%s', encodeURIComponent(query));
  }
}

module.exports = { SearchProviderStore, DEFAULT_PROVIDERS };
