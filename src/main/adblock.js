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
  'bing.com/ads',
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

function isBlocked(url) {
  try {
    const { hostname } = new URL(url);
    return BLOCKED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
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

module.exports = { attachAdblock, isBlocked, BLOCKED_DOMAINS };
