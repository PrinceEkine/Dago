'use strict';

const NEW_TAB_URL = 'new-tab.html';
const DAGO_PAGES = ['history', 'settings', 'screenshare', 'bookmarks', 'downloads'];

// Resolved chrome theme ('light'|'dark'), stamped into new-tab page URLs so
// the blank page matches the chrome. New-tab pages run inside webviews with
// no preload bridge, so they can't subscribe to theme changes themselves -
// the stamp plus the re-stamp loop in the theme subscription below cover it.
let chromeTheme = 'dark';

function newTabUrl() {
  return `${NEW_TAB_URL}?dago-theme=${chromeTheme}`;
}

function isNewTabUrl(url) {
  if (typeof url !== 'string') return false;
  // Pre-navigation the webview still holds the relative string we assigned;
  // post-navigation it holds the resolved file:// URL (with our theme stamp).
  if (url === NEW_TAB_URL || url === newTabUrl()) return true;
  return url.startsWith('file:') && url.includes('new-tab.html');
}

const tabsEl = document.getElementById('tabs');
const webviewHost = document.getElementById('webview-host');
const addressBar = document.getElementById('address-bar');
const addressSuggestionsEl = document.getElementById('address-suggestions');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
const popupBtn = document.getElementById('popup-btn');
const newIdentityBtn = document.getElementById('new-identity-btn');
const bookmarkBtn = document.getElementById('bookmark-btn');
const torStatusEl = document.getElementById('tor-status');
const adblockStatusEl = document.getElementById('adblock-status');

let tabs = [];
let activeTabId = null;
let tabCounter = 0;

function parseAddressInput(input) {
  const trimmed = input.trim();
  if (!trimmed) return newTabUrl();

  const dagoMatch = trimmed.match(/^dago:\/\/(\w+)/);
  if (dagoMatch && DAGO_PAGES.includes(dagoMatch[1])) return { dagoPage: dagoMatch[1] };

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(' '));
  if (looksLikeUrl) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return { searchQuery: trimmed };
}

/** Sets a tab's leading icon slot to a spinner, a favicon <img>, or a letter placeholder. */
function setTabIconLoading(tab) {
  tab.iconSlot.innerHTML = '<span class="tab-spinner"></span>';
}

function setTabIconPlaceholder(tab) {
  const letter = (tab.title || tab.url || '?').replace(/^https?:\/\//, '').trim()[0] || '?';
  const placeholder = document.createElement('span');
  placeholder.className = 'tab-favicon-placeholder';
  placeholder.textContent = letter;
  tab.iconSlot.innerHTML = '';
  tab.iconSlot.appendChild(placeholder);
}

function setTabIconImage(tab, dataUrl) {
  const img = document.createElement('img');
  img.className = 'tab-favicon';
  img.src = dataUrl;
  img.alt = '';
  tab.iconSlot.innerHTML = '';
  tab.iconSlot.appendChild(img);
}

async function fetchTabFavicon(tab, faviconUrl) {
  if (!faviconUrl) return;
  const dataUrl = await window.dago.favicon.fetch(tab.partition, faviconUrl);
  // The tab may have navigated again (or started loading again) by the time
  // this resolves - only apply it if we're still showing the page it's for
  // and not mid-load (did-start-loading already swapped in a spinner).
  if (dataUrl && tab.faviconRequestUrl === faviconUrl && !tab.loading) {
    setTabIconImage(tab, dataUrl);
  }
}

async function createTab(initialUrl) {
  const { partition, torPort, torAvailable } = await window.dago.tabs.create();

  const id = `t${++tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="tab-icon-slot"></span><span class="tab-title">New Tab</span><span class="tab-close">${DAGO_ICONS.close}</span>`;
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) {
      closeTab(id);
    } else {
      activateTab(id);
    }
  });
  tabsEl.appendChild(tabEl);

  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  // `allowpopups` is a presence-checked boolean attribute: ANY value,
  // including the string "false", ENABLES popups - the earlier
  // `allowpopups="false"` did the exact opposite of its intent. It is set
  // here unconditionally because the main process gates every request (see
  // main.js setWindowOpenHandler): deny by default, allow-listed openers
  // only, and even those open as Dago tabs rather than native windows.
  // Do NOT remove this to "harden" popups: without the attribute, Chromium
  // refuses window-open requests below the app and the main-process
  // handler never fires at all, which would silently break the allow-list
  // (OAuth logins included) - see SECURITY.md.
  webview.setAttribute('allowpopups', '');
  webview.src = initialUrl || newTabUrl();
  webviewHost.appendChild(webview);

  const tab = {
    id, partition, torPort, torAvailable, tabEl, webview,
    title: 'New Tab', url: webview.src,
    iconSlot: tabEl.querySelector('.tab-icon-slot'),
    loading: false,
    faviconRequestUrl: null,
    blockedPopups: [],
  };
  tabs.push(tab);
  setTabIconPlaceholder(tab);

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.faviconRequestUrl = null;
    tab.blockedPopups = [];
    if (tab.id === activeTabId) {
      addressBar.value = isNewTabUrl(e.url) ? '' : e.url;
      updateBookmarkButton();
      updatePopupButton();
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
  webview.addEventListener('page-favicon-updated', (e) => {
    const faviconUrl = e.favicons && e.favicons[0];
    tab.faviconRequestUrl = faviconUrl || null;
    fetchTabFavicon(tab, faviconUrl);
  });
  webview.addEventListener('did-start-loading', () => {
    tab.loading = true;
    setTabIconLoading(tab);
    if (tab.id === activeTabId) reloadBtn.innerHTML = DAGO_ICONS.stop;
  });
  webview.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    if (tab.faviconRequestUrl) fetchTabFavicon(tab, tab.faviconRequestUrl);
    else setTabIconPlaceholder(tab);
    if (tab.id === activeTabId) reloadBtn.innerHTML = DAGO_ICONS.reload;
    updateNavButtons();
  });
  // Note: there is intentionally no popup handling here. The webview
  // `new-window` event this renderer previously listened to was removed
  // from Electron years ago and never fired - popup blocking lives in the
  // main process (main.js, setWindowOpenHandler) where it actually works.

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
    addressBar.value = isNewTabUrl(tab.url) ? '' : tab.url;
    updateNavButtons();
    updateBookmarkButton();
    updatePopupButton();
  }
}

async function updateBookmarkButton() {
  const tab = getActiveTab();
  if (!tab || isNewTabUrl(tab.url)) {
    bookmarkBtn.innerHTML = DAGO_ICONS.starOutline;
    bookmarkBtn.classList.remove('active');
    return;
  }
  const bookmarked = await window.dago.bookmarks.isBookmarked(tab.url);
  bookmarkBtn.innerHTML = bookmarked ? DAGO_ICONS.starFilled : DAGO_ICONS.starOutline;
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

// --- Address bar suggestions (bookmarks + history) ---
// History suggestions only appear once history has been unlocked with its
// PIN elsewhere in the app this session - before that, history:list()
// deliberately returns no entries (see history-store.js/ipc.js), and this
// dropdown respects that rather than trying to work around it.
//
// Bookmarks/history are fetched once per address-bar focus (then refreshed
// in the background only once stale), and filtered locally per keystroke -
// pushing the full history list (up to 20k entries) over IPC on EVERY
// keystroke made typing visibly laggy on large histories.

let suggestionItems = [];
let selectedSuggestionIndex = -1;
let suggestionCache = { bookmarks: [], historyEntries: [], fetchedAt: 0 };
const SUGGESTION_CACHE_TTL_MS = 30000;

async function refreshSuggestionCache() {
  const [bookmarks, historyResult] = await Promise.all([
    window.dago.bookmarks.list(),
    window.dago.history.list(),
  ]);
  suggestionCache = {
    bookmarks,
    historyEntries: (historyResult && historyResult.entries) || [],
    fetchedAt: Date.now(),
  };
}

function filterSuggestions(query) {
  const seen = new Set();
  const matches = [];
  outer:
  for (const source of [suggestionCache.bookmarks, suggestionCache.historyEntries]) {
    for (const entry of source) {
      if (matches.length >= 8) break outer;
      if (seen.has(entry.url)) continue;
      const haystack = `${entry.title || ''} ${entry.url}`.toLowerCase();
      if (haystack.includes(query)) {
        seen.add(entry.url);
        matches.push(entry);
      }
    }
  }
  return matches;
}

function hideSuggestions() {
  addressSuggestionsEl.classList.add('hidden');
  addressSuggestionsEl.innerHTML = '';
  suggestionItems = [];
  selectedSuggestionIndex = -1;
}

function renderSuggestions(matches) {
  suggestionItems = matches;
  selectedSuggestionIndex = -1;
  addressSuggestionsEl.innerHTML = '';
  if (matches.length === 0) {
    addressSuggestionsEl.classList.add('hidden');
    return;
  }
  for (const match of matches) {
    const li = document.createElement('li');
    const titleEl = document.createElement('div');
    titleEl.className = 'suggestion-title';
    titleEl.textContent = match.title || match.url;
    const urlEl = document.createElement('div');
    urlEl.className = 'suggestion-url';
    urlEl.textContent = match.url;
    li.appendChild(titleEl);
    li.appendChild(urlEl);
    // mousedown, not click: fires before the address bar's blur handler
    // hides the dropdown, so the navigation isn't lost to a race.
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addressBar.value = match.url;
      navigateActiveTab(match.url);
      hideSuggestions();
    });
    addressSuggestionsEl.appendChild(li);
  }
  addressSuggestionsEl.classList.remove('hidden');
}

function updateSelectedSuggestion() {
  [...addressSuggestionsEl.children].forEach((li, i) => li.classList.toggle('selected', i === selectedSuggestionIndex));
  if (selectedSuggestionIndex >= 0) addressBar.value = suggestionItems[selectedSuggestionIndex].url;
}

function updateSuggestions() {
  const query = addressBar.value.trim().toLowerCase();
  if (!query) {
    hideSuggestions();
    return;
  }
  renderSuggestions(filterSuggestions(query));
  // Refresh stale data in the background (a bookmark added, or history
  // unlocked, since the cache was fetched); re-render only if the query
  // hasn't moved on while the fetch was in flight.
  if (Date.now() - suggestionCache.fetchedAt > SUGGESTION_CACHE_TTL_MS) {
    refreshSuggestionCache().then(() => {
      if (addressBar.value.trim().toLowerCase() === query) {
        renderSuggestions(filterSuggestions(query));
      }
    });
  }
}

addressBar.addEventListener('input', updateSuggestions);
addressBar.addEventListener('focus', () => {
  refreshSuggestionCache().then(updateSuggestions);
});
addressBar.addEventListener('blur', () => setTimeout(hideSuggestions, 100));

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && suggestionItems.length) {
    e.preventDefault();
    selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestionItems.length - 1);
    updateSelectedSuggestion();
  } else if (e.key === 'ArrowUp' && suggestionItems.length) {
    e.preventDefault();
    selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
    updateSelectedSuggestion();
  } else if (e.key === 'Escape') {
    hideSuggestions();
  } else if (e.key === 'Enter') {
    hideSuggestions();
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
  if (!tab || isNewTabUrl(tab.url)) return;
  const bookmarked = await window.dago.bookmarks.isBookmarked(tab.url);
  if (bookmarked) await window.dago.bookmarks.removeByUrl(tab.url);
  else await window.dago.bookmarks.add(tab.url, tab.title);
  updateBookmarkButton();
});

// --- Status bar ---

function renderTorStatus(status) {
  if (status.available) {
    const sourceNote = status.source === 'tor-browser' ? ', via detected Tor Browser install'
      : status.source === 'bundled' ? ', bundled'
      : '';
    torStatusEl.textContent = `Tor: connected (per-tab circuits${sourceNote})`;
    torStatusEl.className = 'status-pill status-on';
  } else {
    torStatusEl.textContent = `Tor: unavailable (${status.reason || 'not installed'})`;
    torStatusEl.className = 'status-pill status-off';
  }
}

window.dago.tor.getStatus().then(renderTorStatus);
window.dago.tor.onStatusChanged(renderTorStatus);

function renderAdblockStats({ builtinDomainCount, subscriptionRuleCount }) {
  const total = builtinDomainCount + subscriptionRuleCount;
  adblockStatusEl.textContent = subscriptionRuleCount > 0
    ? `Tracker blocking: on (${total.toLocaleString()} rules, incl. EasyList/EasyPrivacy)`
    : `Tracker blocking: on (${builtinDomainCount} built-in domains)`;
}

window.dago.adblock.stats().then(renderAdblockStats);
window.dago.adblock.onStatsChanged(renderAdblockStats);

// --- Custom window controls (Windows/Linux only - macOS keeps its native
// traffic-light buttons via titleBarStyle: 'hiddenInset', see main.js) ---

async function setupWindowControls() {
  const platform = await window.dago.app.getPlatform();
  if (platform === 'darwin') return;

  const windowControlsEl = document.getElementById('window-controls');
  const maximizeBtn = document.getElementById('win-maximize-btn');
  windowControlsEl.classList.remove('hidden');

  document.getElementById('win-minimize-btn').addEventListener('click', () => window.dago.windowControls.minimize());
  maximizeBtn.addEventListener('click', () => window.dago.windowControls.maximizeToggle());
  document.getElementById('win-close-btn').addEventListener('click', () => window.dago.windowControls.close());

  const applyMaximizeIcon = (isMaximized) => {
    maximizeBtn.innerHTML = isMaximized ? DAGO_ICONS.restore : DAGO_ICONS.maximize;
    maximizeBtn.title = isMaximized ? 'Restore' : 'Maximize';
  };
  window.dago.windowControls.isMaximized().then(applyMaximizeIcon);
  window.dago.windowControls.onMaximizeChanged(applyMaximizeIcon);
}

setupWindowControls();

// --- Fullscreen ---
// F11 itself is handled in the main process (before-input-event), which is
// the only place that sees the key when focus is inside tab content - the
// renderer just offers the toolbar button / exit pill and hides the chrome
// while fullscreen, whether it was entered via F11 or a video's fullscreen
// button (see main.js's enter-html-full-screen handling).
fullscreenBtn.addEventListener('click', () => window.dago.windowControls.toggleFullscreen());
exitFullscreenBtn.addEventListener('click', () => window.dago.windowControls.toggleFullscreen());

function applyFullscreen(isFullscreen) {
  document.body.classList.toggle('fullscreen', isFullscreen);
}

window.dago.windowControls.isFullscreen().then(applyFullscreen);
window.dago.windowControls.onFullscreenChanged(applyFullscreen);

// --- Theme (new-tab pages only - the chrome itself is themed by
// theme-init.js, which runs before this script) ---
window.dago.theme.get().then(({ resolved }) => {
  chromeTheme = resolved;
});
window.dago.theme.onChanged(({ resolved }) => {
  if (resolved === chromeTheme) return;
  chromeTheme = resolved;
  // New-tab pages have no bridge to hear this themselves, so re-stamp the
  // open ones. Only blank pages are touched - real web content is neither
  // themed nor reloaded here.
  for (const tab of tabs) {
    if (isNewTabUrl(tab.url)) tab.webview.src = newTabUrl();
  }
});

// --- Blocked popups ---
// The main process blocks popups by default and reports each one here with
// the webview's contents id, which is how the event reaches the right tab
// (the active tab may have moved on since). The toolbar button appears only
// while the active tab has blocked popups; one click offers a one-click
// allow for the opener's site and opens the latest blocked URL.

const MAX_BLOCKED_POPUPS_PER_TAB = 5;

function updatePopupButton() {
  const tab = getActiveTab();
  const count = tab ? tab.blockedPopups.length : 0;
  popupBtn.classList.toggle('hidden', count === 0);
  if (count > 0) {
    popupBtn.title = `Popups blocked from ${openerHostname(tab.blockedPopups[tab.blockedPopups.length - 1].openerUrl)} - click to allow`;
  }
}

function openerHostname(openerUrl) {
  try {
    return new URL(openerUrl).hostname;
  } catch (err) {
    return 'this site';
  }
}

window.dago.popups.onBlocked(({ contentsId, openerUrl, popupUrl }) => {
  const tab = tabs.find((t) => {
    try {
      return t.webview.getWebContentsId() === contentsId;
    } catch (err) {
      return false;
    }
  });
  if (!tab) return;
  tab.blockedPopups.push({ openerUrl, popupUrl });
  if (tab.blockedPopups.length > MAX_BLOCKED_POPUPS_PER_TAB) {
    tab.blockedPopups.splice(0, tab.blockedPopups.length - MAX_BLOCKED_POPUPS_PER_TAB);
  }
  if (tab.id === activeTabId) updatePopupButton();
});

window.dago.popups.onOpenInTab((url) => {
  createTab(url);
});

popupBtn.addEventListener('click', async () => {
  const tab = getActiveTab();
  if (!tab || tab.blockedPopups.length === 0) return;
  const latest = tab.blockedPopups[tab.blockedPopups.length - 1];
  const host = openerHostname(latest.openerUrl);
  const count = tab.blockedPopups.length;
  const ok = confirm(
    `${host} tried to open ${count === 1 ? 'a popup' : `${count} popups`} ` +
    `(latest: ${latest.popupUrl}).\n\nAllow popups from ${host}? They will open as new tabs. ` +
    `You can revoke this in Settings.`
  );
  if (!ok) return;
  const result = await window.dago.popups.allowSite(latest.openerUrl);
  if (!result.ok) {
    alert(`Could not allow popups: ${result.reason}`);
    return;
  }
  tab.blockedPopups = [];
  updatePopupButton();
  createTab(latest.popupUrl);
});

// --- Boot ---
createTab();
