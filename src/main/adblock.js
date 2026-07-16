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
  domains: [], // { domain, thirdParty }[]
  allowedDomains: [], // { domain, thirdParty }[]
  blockedPatterns: [], // compiled pattern objects, each carrying .thirdParty
  allowedPatterns: [], // compiled pattern objects, each carrying .thirdParty
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

// A handful of common multi-label public suffixes, so registrableDomain()
// doesn't treat "example.co.uk" as the registrable domain "co.uk" (which
// would make it match every other .co.uk site). Not a full Public Suffix
// List - just enough to avoid the most common false positives; anything
// outside this short list falls back to a plain last-two-labels guess.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tr', 'com.sg',
]);

function registrableDomain(hostname) {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && parts.length > 2) return parts.slice(-3).join('.');
  return lastTwo;
}

/**
 * Whether `requestHostname` counts as a different site than `topHostname` -
 * the standard meaning of Adblock Plus's `$third-party` filter option, which
 * a huge share of real-world EasyList/EasyPrivacy rules are scoped with
 * specifically so they only ever touch embedded ads/trackers and never a
 * site's own first-party content. Returns null if either hostname is
 * missing, meaning "unknown" rather than a yes/no answer - callers decide
 * what unknown should default to (see isBlocked).
 */
function isThirdPartyRequest(requestHostname, topHostname) {
  if (!requestHostname || !topHostname) return null;
  return registrableDomain(requestHostname) !== registrableDomain(topHostname);
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
function compileGlobPattern(rawPattern, { thirdParty = false } = {}) {
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
  const hasLiteralContent = segments.some((s) => s !== '');

  // A pattern with no `||domain` component and no literal text at all - a
  // bare `|`, `*`, `^`, or any combination that fully collapses to
  // emptiness (e.g. `**`, `^^`) - would otherwise compile into something
  // that matches every URL unconditionally: globSegmentsMatch has nothing to
  // scan for, so it just returns true. That's almost never the intent of a
  // filter-list rule, and if such a pattern lands in an exception (`@@`)
  // rule, isBlocked() checks allowedPatterns first, so it would silently
  // disable every other block source (the built-in list, every subscription
  // domain, every subscription pattern) for the entire browser. A hostile or
  // compromised filter-list URL - exactly the threat this feature has to
  // assume - only needs to serve a single line like `@@|` to trigger that.
  // Fail safe here: treat a degenerate pattern as matching nothing instead.
  if (domain === null && !hasLiteralContent) {
    return { thirdParty, test: () => false };
  }

  return {
    thirdParty,
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

/**
 * Replaces the subscription-sourced block/allow/cosmetic data. `domains`/
 * `allowedDomains` are `{ domain, thirdParty }[]`, and `blockedPatterns`/
 * `allowedPatterns` are `{ pattern, thirdParty }[]` - see filter-list-store.js
 * for where the `$third-party` option is actually parsed out of a filter
 * list line.
 */
function setDynamicBlocklist({ domains, allowedDomains, blockedPatterns = [], allowedPatterns = [], cosmeticRules = [] }) {
  dynamicBlocklist.domains = domains;
  dynamicBlocklist.allowedDomains = allowedDomains;
  dynamicBlocklist.cosmeticRules = cosmeticRules;

  const compile = (entries) => {
    const compiled = [];
    for (const entry of entries) {
      try {
        compiled.push(compileGlobPattern(entry.pattern, { thirdParty: entry.thirdParty }));
      } catch (err) {
        // skip a pattern that fails to compile rather than fail the whole list
      }
    }
    return compiled;
  };
  dynamicBlocklist.blockedPatterns = compile(blockedPatterns);
  dynamicBlocklist.allowedPatterns = compile(allowedPatterns);
}

/**
 * Finds a matching entry in a `{ domain, thirdParty }[]` list, or null.
 * `thirdParty` on the returned entry tells the caller whether the rule is
 * `$third-party`-scoped - see shouldApplyRule() for what that means for
 * whether the rule actually fires on this particular request.
 */
function findMatchingDomainEntry(hostname, entries) {
  for (const entry of entries) {
    if (matchesDomain(hostname, entry.domain)) return entry;
  }
  return null;
}

function findMatchingPattern(url, patterns) {
  for (const p of patterns) {
    if (p.test(url)) return p;
  }
  return null;
}

/**
 * Decides whether a rule scoped with `$third-party` actually applies to this
 * particular request. `thirdPartyStatus` is the result of
 * isThirdPartyRequest(): true (cross-site, rule applies), false (same site,
 * rule is skipped - this is the whole point of the option: don't block a
 * site's own first-party content just because some embedded-ad rule
 * happens to also match its path/domain), or null (couldn't be determined -
 * falls back to applying the rule, i.e. today's pre-$third-party behavior,
 * so subresource blocking outside the specific case this was added for is
 * unaffected).
 */
function shouldApplyRule(ruleIsThirdPartyOnly, thirdPartyStatus) {
  if (!ruleIsThirdPartyOnly) return true;
  return thirdPartyStatus !== false;
}

/**
 * `context.resourceType`/`context.topUrl` let $third-party-scoped rules (the
 * majority of real EasyList/EasyPrivacy entries) apply only to genuinely
 * cross-site ad/tracker requests instead of a site's own first-party
 * content - without this, subscribing to a full list will routinely block
 * a site's own page/assets whenever their path or domain happens to also
 * match a rule that was only ever meant to catch third-party embeds. A
 * top-level navigation (`resourceType === 'mainFrame'`) with no prior
 * `topUrl` to compare against is treated as first-party to itself - the
 * same convention real ad-blockers use, since there's no "other site" for a
 * page's own load to be third-party relative to.
 */
function isBlocked(url, context = {}) {
  try {
    const { hostname } = new URL(url);
    const topHostname = context.topUrl ? safeHostname(context.topUrl) : null;
    let thirdPartyStatus = isThirdPartyRequest(hostname, topHostname);
    if (thirdPartyStatus === null && context.resourceType === 'mainFrame') thirdPartyStatus = false;

    // Exceptions always win, matching how Adblock Plus-style engines treat
    // @@ rules - an allow rule overrides any block rule, not just ones from
    // the same list.
    const allowedDomainEntry = findMatchingDomainEntry(hostname, dynamicBlocklist.allowedDomains);
    if (allowedDomainEntry && shouldApplyRule(allowedDomainEntry.thirdParty, thirdPartyStatus)) return false;
    const allowedPattern = findMatchingPattern(url, dynamicBlocklist.allowedPatterns);
    if (allowedPattern && shouldApplyRule(allowedPattern.thirdParty, thirdPartyStatus)) return false;

    if (BLOCKED_DOMAINS.some((domain) => matchesDomain(hostname, domain))) return true;
    const blockedDomainEntry = findMatchingDomainEntry(hostname, dynamicBlocklist.domains);
    if (blockedDomainEntry && shouldApplyRule(blockedDomainEntry.thirdParty, thirdPartyStatus)) return true;
    const blockedPattern = findMatchingPattern(url, dynamicBlocklist.blockedPatterns);
    if (blockedPattern && shouldApplyRule(blockedPattern.thirdParty, thirdPartyStatus)) return true;

    return false;
  } catch (err) {
    return false;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return null;
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
    // details.frame is the frame that initiated the request; .top walks up
    // to the current top-level document, which is what $third-party rules
    // compare against. Both can be undefined (frame torn down mid-request,
    // or Electron simply not populating it in some cases) - isBlocked()
    // treats a missing topUrl as "unknown" rather than guessing.
    let topUrl = null;
    try { topUrl = details.frame?.top?.url || null; } catch (err) { topUrl = null; }
    if (state.enabled && isBlocked(details.url, { resourceType: details.resourceType, topUrl })) {
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
