'use strict';

// Popup allow-list store tests. Run with: npm test (Node's built-in runner)

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PopupStore } = require('../src/main/popup-store.js');

let dir;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dago-popup-test-'));
  store = new PopupStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('popup allow-list', () => {
  it('starts empty and denies everything', () => {
    assert.deepEqual(store.list(), []);
    assert.equal(store.isAllowed('https://example.com/'), false);
  });

  it('allows the exact hostname that was added', () => {
    const result = store.allow('https://app.example.com/login');
    assert.equal(result.ok, true);
    assert.equal(result.hostname, 'app.example.com');
    assert.equal(store.isAllowed('https://app.example.com/other/page'), true);
    assert.equal(store.isAllowed('https://other.org/'), false);
  });

  it('covers subdomains but not similar names or parents', () => {
    store.allow('https://example.com/');
    assert.equal(store.isAllowed('https://deep.sub.example.com/'), true);
    assert.equal(store.isAllowed('https://evil-example.com/'), false);
    assert.equal(store.isAllowed('https://example.com.evil.com/'), false);
    assert.equal(store.isAllowed('https://com/'), false);
  });

  it('is case-insensitive', () => {
    store.allow('https://APP.Example.COM/');
    assert.equal(store.isAllowed('https://app.example.com/'), true);
    assert.deepEqual(store.list().map((e) => e.hostname), ['app.example.com']);
  });

  it('rejects URLs with no hostname', () => {
    for (const bad of ['not a url', '', 'file:///C:/page.html', 'about:blank']) {
      assert.equal(store.allow(bad).ok, false, JSON.stringify(bad));
      assert.equal(store.isAllowed(bad), false, JSON.stringify(bad));
    }
    assert.deepEqual(store.list(), []);
  });

  it('is idempotent for repeat allows', () => {
    store.allow('https://example.com/a');
    const second = store.allow('https://example.com/b');
    assert.equal(second.ok, true);
    assert.equal(second.added, false);
    assert.equal(store.list().length, 1);
  });

  it('removes entries by id', () => {
    store.allow('https://example.com/');
    const [entry] = store.list();
    assert.equal(store.remove(entry.id).ok, true);
    assert.equal(store.isAllowed('https://example.com/'), false);
    assert.deepEqual(store.list(), []);
    assert.equal(store.remove('nonexistent').ok, true);
  });

  it('persists across instances', () => {
    store.allow('https://example.com/');
    const reopened = new PopupStore(dir);
    assert.equal(reopened.isAllowed('https://sub.example.com/'), true);
    assert.equal(reopened.list().length, 1);
  });

  it('survives corrupt config by starting empty', () => {
    fs.writeFileSync(path.join(dir, 'popup-allowlist.json'), '{oops');
    const recovered = new PopupStore(dir);
    assert.deepEqual(recovered.list(), []);
    assert.equal(recovered.isAllowed('https://example.com/'), false);
  });
});
