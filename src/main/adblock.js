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

// Domain/pattern/cosmetic data contributed by enabled filter-list
// subscriptions (see filter-list-store.js). Held here, rather than
// duplicated per-session, so every open tab picks up subscription updates
// immediately - `isBlocked` reads this live rather than a snapshot.
const dynamicBlocklist = {
  domains: new Set(),
  allowedDomains: new Set(),
  blockedPatterns: [], // compiled RegExp[]
  allowedPatterns: [], // compiled RegExp[]
  cosmeticRules: [], // { domains: string[]|null, selector: string }
};

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesAnyDomain(hostname, domainSet) {
  for (const domain of domainSet) {
    if (matchesDomain(hostname, domain)) return true;
  }
  return false;
}

/**
 * Matches a glob (segments split on `*`/`^`, both treated as "any number of
 * characters" wildcard boundaries) against `text` using only
 * String.prototype.indexOf/startsWith/endsWith - never RegExp. This is a
 * deliberate correction: an earlier version of this file built a RegExp from
 * escaped literal segments joined by `.*`, on the theory that "no nested
 * quantifiers" made it ReDoS-safe. That reasoning was wrong - chained
 * `.*literal.*literal.*...` is exactly the classic catastrophic-backtracking
 * shape in a backtracking engine like V8's, confirmed by a pattern with ~30
 * wildcard segments taking over two and a half minutes to fail a single
 * match. Sequential indexOf scanning for each literal segment is O(segments
 * x text length) with no backtracking possible, so it can't blow up
 * regardless of how many wildcards a hostile filter list packs into a line.
 */
function globSegmentsMatch(text, segments, anchorStart, anchorEnd) {
  let pos = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '') continue;
    // Only the literal token at index 0 can be anchor-started - if it was
    // empty (pattern began with a wildcard, e.g. "|*foo"), the anchor is
    // already moot by the time we reach the next literal, so every later
    // segment always falls through to the indexOf scan below.
    if (i === 0 && anchorStart) {
      if (!text.startsWith(segment)) return false;
      pos = segment.length;
    } else {
      const idx = text.indexOf(segment, pos);
      if (idx === -1) return false;
      pos = idx + segment.length;
    }
  }

  if (anchorEnd) {
    const lastSegment = segments[segments.length - 1];
    // An empty last token means the pattern ended in a wildcard right before
    // the anchor, which is redundant - the matches above already suffice.
    if (lastSegment !== '' && !text.endsWith(lastSegment)) return false;
  }

  return true;
}

/**
 * Parses a `||domain` or `|`/plain address pattern into a domain to check
 * via exact/suffix matching (reusing `matchesDomain`, not glob matching) plus
 * a remaining glob to run against just the path+query - decomposing it this
 * way means the glob matcher above never has to reason about hostnames.
 */
function compileGlobPattern(rawPattern) {
  let pattern = rawPattern;
  let domain = null;
  let anchorStart = false;
  let anchorEnd = false;

  if (pattern.startsWith('||')) {
    pattern = pattern.slice(2);
    const boundaryIdx = pattern.search(/[/^*]/);
    if (boundaryIdx === -1) {
      domain = pattern.toLowerCase();
      pattern = '';
    } else {
      domain = pattern.slice(0, boundaryIdx).toLowerCase();
      pattern = pattern.slice(boundaryIdx);
    }
  } else if (pattern.startsWith('|')) {
    anchorStart = true;
    pattern = pattern.slice(1);
  }
  if (pattern.endsWith('|') && !pattern.endsWith('||')) {
    anchorEnd = true;
    pattern = pattern.slice(0, -1);
  }

  const segments = pattern.split(/[*^]/);

  return {
    test(url) {
      if (domain !== null) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch (err) {
          return false;
        }
        if (!matchesDomain(parsed.hostname, domain)) return false;
        if (pattern === '') return true;
        return globSegmentsMatch(parsed.pathname + parsed.search, segments, anchorStart, anchorEnd);
      }
      return globSegmentsMatch(url, segments, anchorStart, anchorEnd);
    },
  };
}

/** Replaces the subscription-sourced block/allow/cosmetic data. */
function setDynamicBlocklist({ domains, allowedDomains, blockedPatterns = [], allowedPatterns = [], cosmeticRules = [] }) {
  dynamicBlocklist.domains = domains;
  dynamicBlocklist.allowedDomains = allowedDomains;
  dynamicBlocklist.cosmeticRules = cosmeticRules;

  const compile = (patterns) => {
    const compiled = [];
    for (const p of patterns) {
      try {
        compiled.push(compileGlobPattern(p));
      } catch (err) {
        // skip a pattern that fails to compile rather than fail the whole list
      }
    }
    return compiled;
  };
  dynamicBlocklist.blockedPatterns = compile(blockedPatterns);
  dynamicBlocklist.allowedPatterns = compile(allowedPatterns);
}

function matchesAnyPattern(url, patterns) {
  return patterns.some((p) => p.test(url));
}

function isBlocked(url) {
  try {
    const { hostname } = new URL(url);

    // Exceptions always win, matching how Adblock Plus-style engines treat
    // @@ rules - an allow rule overrides any block rule, not just ones from
    // the same list.
    if (matchesAnyDomain(hostname, dynamicBlocklist.allowedDomains)) return false;
    if (matchesAnyPattern(url, dynamicBlocklist.allowedPatterns)) return false;

    if (BLOCKED_DOMAINS.some((domain) => matchesDomain(hostname, domain))) return true;
    if (matchesAnyDomain(hostname, dynamicBlocklist.domains)) return true;
    if (matchesAnyPattern(url, dynamicBlocklist.blockedPatterns)) return true;

    return false;
  } catch (err) {
    return false;
  }
}

function cosmeticRuleAppliesToHost(rule, hostname) {
  if (!rule.domains) return true;
  const includes = rule.domains.filter((d) => !d.startsWith('~'));
  const excludes = rule.domains.filter((d) => d.startsWith('~')).map((d) => d.slice(1));
  if (excludes.some((d) => matchesDomain(hostname, d))) return false;
  if (includes.length === 0) return true; // exclusion-only list: applies unless excluded above
  return includes.some((d) => matchesDomain(hostname, d));
}

/** Returns the deduplicated list of CSS selectors to hide on a given hostname. */
function getCosmeticRulesForHost(hostname) {
  const selectors = new Set();
  for (const rule of dynamicBlocklist.cosmeticRules) {
    if (cosmeticRuleAppliesToHost(rule, hostname)) selectors.add(rule.selector);
  }
  return [...selectors];
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

module.exports = {
  attachAdblock,
  isBlocked,
  setDynamicBlocklist,
  getCosmeticRulesForHost,
  compileGlobPattern,
  BLOCKED_DOMAINS,
};
