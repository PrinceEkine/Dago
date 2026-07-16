'use strict';

const NEW_TAB_URL = 'new-tab.html';
const DAGO_PAGES = ['history', 'settings', 'screenshare', 'bookmarks', 'downloads'];

const tabsEl = document.getElementById('tabs');
const webviewHost = document.getElementById('webview-host');
const addressBar = document.getElementById('address-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const newIdentityBtn = document.getElementById('new-identity-btn');
const bookmarkBtn = document.getElementById('bookmark-btn');
const torStatusEl = document.getElementById('tor-status');
const adblockStatusEl = document.getElementById('adblock-status');

let tabs = [];
let activeTabId = null;
let tabCounter = 0;

function parseAddressInput(input) {
  const trimmed = input.trim();
  if (!trimmed) return NEW_TAB_URL;

  const dagoMatch = trimmed.match(/^dago:\/\/(\w+)/);
  if (dagoMatch && DAGO_PAGES.includes(dagoMatch[1])) return { dagoPage: dagoMatch[1] };

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(' '));
  if (looksLikeUrl) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return { searchQuery: trimmed };
}

async function createTab(initialUrl) {
  const { partition, torPort, torAvailable } = await window.dago.tabs.create();

  const id = `t${++tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="tab-title">New Tab</span><span class="tab-close">&times;</span>`;
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeTab(id);
    } else {
      activateTab(id);
    }
  });
  tabsEl.appendChild(tabEl);

  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', 'false');
  webview.src = initialUrl || NEW_TAB_URL;
  webviewHost.appendChild(webview);

  const tab = { id, partition, torPort, torAvailable, tabEl, webview, title: 'New Tab', url: webview.src };
  tabs.push(tab);

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) {
      addressBar.value = e.url;
      updateBookmarkButton();
    }
    window.dago.history.record(e.url, tab.title);
    updateNavButtons();
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) addressBar.value = e.url;
  });
  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    tabEl.querySelector('.tab-title').textContent = e.title;
    window.dago.history.record(tab.url, e.title);
  });
  webview.addEventListener('did-start-loading', () => {
    if (tab.id === activeTabId) reloadBtn.innerHTML = '&#10005;';
  });
  webview.addEventListener('did-stop-loading', () => {
    if (tab.id === activeTabId) reloadBtn.innerHTML = '&#8635;';
    updateNavButtons();
  });
  // Popups are blocked by default, full stop - not opened in a background
  // tab, not shown as a "blocked, click to allow" prompt. Ad networks on
  // aggregator/streaming sites routinely trigger window.open() popunders
  // from a click anywhere on the page (a video player's own "play" button,
  // for instance), and earlier this simply opened whatever the popup asked
  // for as a new tab - which defeated `allowpopups="false"` above rather
  // than enforcing it, and is exactly the "ad opened a new tab and
  // redirected me" behavior this is meant to prevent. The real trade-off:
  // legitimate uses of window.open() (OAuth login popups, "open in new
  // window" buttons) won't work either. See docs/ROADMAP.md for a possible
  // future per-site allow list instead of an all-or-nothing block.
  webview.addEventListener('new-window', (e) => {
    console.log(`Blocked popup: ${e.url}`);
  });

  activateTab(id);
  return tab;
}

function activateTab(id) {
  activeTabId = id;
  for (const tab of tabs) {
    const isActive = tab.id === id;
    tab.tabEl.classList.toggle('active', isActive);
    tab.webview.classList.toggle('active', isActive);
  }
  const tab = tabs.find((t) => t.id === id);
  if (tab) {
    addressBar.value = tab.url === NEW_TAB_URL ? '' : tab.url;
    updateNavButtons();
    updateBookmarkButton();
  }
}

async function updateBookmarkButton() {
  const tab = getActiveTab();
  if (!tab || tab.url === NEW_TAB_URL) {
    bookmarkBtn.innerHTML = '&#9734;';
    bookmarkBtn.classList.remove('active');
    return;
  }
  const bookmarked = await window.dago.bookmarks.isBookmarked(tab.url);
  bookmarkBtn.innerHTML = bookmarked ? '&#9733;' : '&#9734;';
  bookmarkBtn.classList.toggle('active', bookmarked);
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  tab.tabEl.remove();
  tab.webview.remove();

  if (activeTabId === id) {
    const next = tabs[index] || tabs[index - 1];
    if (next) {
      activateTab(next.id);
    } else {
      createTab();
    }
  }
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

function updateNavButtons() {
  const tab = getActiveTab();
  if (!tab) return;
  backBtn.disabled = !tab.webview.canGoBack();
  forwardBtn.disabled = !tab.webview.canGoForward();
}

async function navigateActiveTab(destination) {
  const tab = getActiveTab();
  if (!tab) return;
  if (destination && destination.dagoPage) {
    window.dago.windows.open(destination.dagoPage);
    return;
  }
  if (destination && destination.searchQuery) {
    tab.webview.src = await window.dago.search.buildUrl(destination.searchQuery);
    return;
  }
  tab.webview.src = destination;
}

// --- Toolbar wiring ---

document.getElementById('new-tab-btn').addEventListener('click', () => createTab());

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigateActiveTab(parseAddressInput(addressBar.value));
  }
});

backBtn.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab && tab.webview.canGoBack()) tab.webview.goBack();
});
forwardBtn.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab && tab.webview.canGoForward()) tab.webview.goForward();
});
reloadBtn.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) tab.webview.reload();
});

newIdentityBtn.addEventListener('click', async () => {
  newIdentityBtn.disabled = true;
  const result = await window.dago.tor.newIdentity();
  newIdentityBtn.disabled = false;
  const tab = getActiveTab();
  if (result.ok && tab) tab.webview.reload();
});

document.getElementById('history-btn').addEventListener('click', () => window.dago.windows.open('history'));
document.getElementById('settings-btn').addEventListener('click', () => window.dago.windows.open('settings'));
document.getElementById('screenshare-btn').addEventListener('click', () => window.dago.windows.open('screenshare'));
document.getElementById('bookmarks-btn').addEventListener('click', () => window.dago.windows.open('bookmarks'));
document.getElementById('downloads-btn').addEventListener('click', () => window.dago.windows.open('downloads'));

bookmarkBtn.addEventListener('click', async () => {
  const tab = getActiveTab();
  if (!tab || tab.url === NEW_TAB_URL) return;
  const bookmarked = await window.dago.bookmarks.isBookmarked(tab.url);
  if (bookmarked) await window.dago.bookmarks.removeByUrl(tab.url);
  else await window.dago.bookmarks.add(tab.url, tab.title);
  updateBookmarkButton();
});

// --- Status bar ---

function renderTorStatus(status) {
  if (status.available) {
    torStatusEl.textContent = 'Tor: connected (per-tab circuits)';
    torStatusEl.className = 'status-pill status-on';
  } else {
    torStatusEl.textContent = `Tor: unavailable (${status.reason || 'not installed'})`;
    torStatusEl.className = 'status-pill status-off';
  }
}

window.dago.tor.getStatus().then(renderTorStatus);
window.dago.tor.onStatusChanged(renderTorStatus);

window.dago.adblock.stats().then(({ domainCount }) => {
  adblockStatusEl.textContent = `Tracker blocking: on (${domainCount} domains)`;
});

// --- Boot ---
createTab();
