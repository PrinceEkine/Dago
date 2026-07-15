'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, shell } = require('electron');

function uniqueSavePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

/**
 * Tracks downloads across every tab session. Files save straight to the
 * OS downloads folder (no per-download "save as" prompt, matching most
 * browsers' default behavior) with automatic de-duplication of filenames.
 * In-memory only - the list resets on restart, same as most browsers'
 * "recent downloads" view resets to what's still on disk.
 */
class DownloadManager {
  constructor() {
    this.downloads = [];
  }

  list() {
    return [...this.downloads].sort((a, b) => b.startTime - a.startTime);
  }

  /** Wires download tracking into a given Electron session. Safe to call on multiple sessions. */
  attachToSession(session) {
    session.on('will-download', (event, item) => {
      const id = crypto.randomUUID();
      const downloadsDir = app.getPath('downloads');
      const savePath = uniqueSavePath(downloadsDir, item.getFilename());
      item.setSavePath(savePath);

      const entry = {
        id,
        filename: path.basename(savePath),
        savePath,
        url: item.getURL(),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startTime: Date.now(),
      };
      this.downloads.push(entry);

      item.on('updated', (updateEvent, state) => {
        entry.state = state; // 'progressing' | 'interrupted'
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
      });

      item.once('done', (doneEvent, state) => {
        entry.state = state; // 'completed' | 'cancelled' | 'interrupted'
        entry.receivedBytes = item.getReceivedBytes();
      });

      this._itemsById = this._itemsById || new Map();
      this._itemsById.set(id, item);
    });
  }

  cancel(id) {
    const item = this._itemsById && this._itemsById.get(id);
    if (item && !item.isDestroyed()) item.cancel();
    return { ok: true };
  }

  remove(id) {
    this.downloads = this.downloads.filter((d) => d.id !== id);
    if (this._itemsById) this._itemsById.delete(id);
    return { ok: true };
  }

  openFile(id) {
    const entry = this.downloads.find((d) => d.id === id);
    if (!entry || entry.state !== 'completed') return { ok: false, reason: 'Not available.' };
    shell.openPath(entry.savePath);
    return { ok: true };
  }

  showInFolder(id) {
    const entry = this.downloads.find((d) => d.id === id);
    if (!entry) return { ok: false, reason: 'Not found.' };
    shell.showItemInFolder(entry.savePath);
    return { ok: true };
  }
}

module.exports = { DownloadManager };
