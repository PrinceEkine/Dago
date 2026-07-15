'use strict';

// A small, hand-curated set of widely-known ad/tracker domains. This is not a
// substitute for a full EasyList/EasyPrivacy feed (fetching those requires a
// network call we don't want to make implicitly on every launch), but it
// blocks the most common trackers out of the box. See docs/ROADMAP.md for the
// plan to support subscribing to full blocklists.
const BLOCKED_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'facebook.net',
  'connect.facebook.net',
  'ads.facebook.com',
  'analytics.twitter.com',
  'ads-twitter.com',
  'scorecardresearch.com',
  'quantserve.com',
  'adnxs.com',
  'outbrain.com',
  'taboola.com',
  'criteo.com',
  'moatads.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'hotjar.com',
  'amplitude.com',
  'bat.bing.com',
  'adsystem.com',
  'advertising.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'yieldmo.com',
  'branch.io',
  'appsflyer.com',
  'sentry-cdn.com',
];

// Domains contributed by enabled filter-list subscriptions (see
// filter-list-store.js). Held here, rather than duplicated per-session, so
// every open tab picks up subscription updates immediately - `isBlocked`
// reads this live rather than a snapshot.
const dynamicBlocklist = {
  domains: new Set(),
  allowedDomains: new Set(),
};

/** Replaces the subscription-sourced block/allow domain sets. */
function setDynamicBlocklist(domains, allowedDomains) {
  dynamicBlocklist.domains = domains;
  dynamicBlocklist.allowedDomains = allowedDomains;
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesAny(hostname, domainSet) {
  for (const domain of domainSet) {
    if (matchesDomain(hostname, domain)) return true;
  }
  return false;
}

function isBlocked(url) {
  try {
    const { hostname } = new URL(url);
    if (matchesAny(hostname, dynamicBlocklist.allowedDomains)) return false;
    if (BLOCKED_DOMAINS.some((domain) => matchesDomain(hostname, domain))) return true;
    return matchesAny(hostname, dynamicBlocklist.domains);
  } catch (err) {
    return false;
  }
}

/** Wires up request blocking on a given Electron session. Idempotent per-session. */
function attachAdblock(session, { enabled = true } = {}) {
  const state = { enabled };
  session.webRequest.onBeforeRequest((details, callback) => {
    if (state.enabled && isBlocked(details.url)) {
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
  return {
    setEnabled(value) { state.enabled = value; },
    isEnabled() { return state.enabled; },
  };
}

module.exports = { attachAdblock, isBlocked, setDynamicBlocklist, BLOCKED_DOMAINS };
