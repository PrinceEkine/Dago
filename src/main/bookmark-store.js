'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Bookmarks are plain local JSON, unlike history/PIN/TURN config - there's
 * no PIN-style access control here, matching how most browsers treat
 * bookmarks as non-sensitive (unlike browsing history, which reveals a lot
 * more about behavior over time).
 */
class BookmarkStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'bookmarks.json');
    this.bookmarks = this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      return [];
    }
  }

  _persist() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.bookmarks, null, 2));
  }

  list() {
    return [...this.bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  }

  isBookmarked(url) {
    return this.bookmarks.some((b) => b.url === url);
  }

  add(url, title) {
    if (!url) return { ok: false, reason: 'No URL to bookmark.' };
    if (this.isBookmarked(url)) return { ok: false, reason: 'Already bookmarked.' };
    const bookmark = { id: crypto.randomUUID(), url, title: title || url, createdAt: Date.now() };
    this.bookmarks.push(bookmark);
    this._persist();
    return { ok: true, id: bookmark.id };
  }

  removeByUrl(url) {
    this.bookmarks = this.bookmarks.filter((b) => b.url !== url);
    this._persist();
    return { ok: true };
  }

  removeById(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this._persist();
    return { ok: true };
  }
}

module.exports = { BookmarkStore };
