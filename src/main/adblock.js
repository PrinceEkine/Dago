'use strict';

// A small, hand-curated set of widely-known ad/tracker domains. This is not a
// substitute for a full EasyList/EasyPrivacy feed, but it blocks the most
// common trackers out of the box, including before any subscription has been
// fetched (see filter-list-store.js for the subscription side).
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
//
// Everything below is INDEXED rather than scanned linearly: with a full
// EasyList/EasyPrivacy subscription this holds tens of thousands of rules,
// and `isBlocked` runs on every single network request, so a linear scan per
// request costs ~15ms each - seconds of main-thread stall per page load.
// Domain rules and `||domain`-anchored patterns are indexed by domain (only
// buckets under the request hostname's suffixes are ever tested); unanchored
// substring patterns are prefetched through an Aho-Corasick automaton over
// their longest literals (one linear pass over the URL instead of one
// substring search per rule). The indexes preserve the exact matching
// semantics of the old linear scans (including first-match-in-list-order
// precedence for `$third-party` scoping - see
// findDomainEntry/findPatternEntry), just without testing rules that cannot
// match the request.
const dynamicBlocklist = {
  domainEntries: new Map(), // exact domain -> { thirdParty, index } (first list occurrence wins)
  allowedDomainEntries: new Map(),
  anchoredBlocked: new Map(), // ||domain -> compiled[] in original list order
  anchoredAllowed: new Map(),
  unanchoredBlocked: null, // Aho-Corasick index (see buildLiteralIndex), set by setDynamicBlocklist
  unanchoredAllowed: null,
  cosmeticGlobal: [], // selectors applying on every site
  cosmeticByDomain: new Map(), // include-domain -> [{ selector, excludes }]
  cosmeticExclusionOnly: [], // [{ selector, excludes }] - applies unless excluded
  ruleCounts: { domains: 0, blockedPatterns: 0, cosmeticRules: 0 },
};

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Yields every domain key that could satisfy `matchesDomain(hostname, key)`:
 * the hostname itself plus each parent suffix (`a.b.c` -> `a.b.c`, `b.c`,
 * `c`). A request only ever tests the index buckets under these keys, which
 * is what turns per-request matching from O(all rules) into O(hostname
 * labels + rules for this site). Two edge cases mirror matchesDomain
 * exactly: an empty hostname (e.g. `file://` URLs) yields just `''`, and a
 * trailing-dot hostname additionally yields `''` (matchesDomain's
 * `endsWith('.')` clause).
 */
function* domainSuffixes(hostname) {
  const host = hostname.toLowerCase();
  if (host === '') {
    yield '';
    return;
  }
  yield host;
  let dot = host.indexOf('.');
  while (dot !== -1) {
    yield host.slice(dot + 1);
    dot = host.indexOf('.', dot + 1);
  }
  if (host.endsWith('.')) yield '';
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
 *
 * Besides `test(url)` (kept for compatibility - same behavior as always),
 * the compiled object carries the metadata the per-request index needs:
 * `domain` (which bucket it lives in, null for unanchored substring
 * patterns), `longestLiteral` (a cheap `includes` prefilter for unanchored
 * patterns - if the glob matches, its longest literal must appear in the
 * URL, so a miss proves non-match without running the full scan), and
 * `testRequest()` (same matching as `test()` but reusing the already-parsed
 * URL parts instead of parsing the URL itself on every call).
 */
function compileGlobPattern(rawPattern, rawOpts = {}) {
  const opts = normalizeRuleOpts(rawOpts);
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
  const isDegenerate = domain === null && !hasLiteralContent;

  let longestLiteral = '';
  for (const segment of segments) {
    if (segment.length > longestLiteral.length) longestLiteral = segment;
  }
  const hasRemainder = pattern !== '';

  return {
    thirdParty: opts.thirdParty,
    opts,
    domain,
    longestLiteral,
    isDegenerate,
    index: -1, // filled in by setDynamicBlocklist - position in the original list order
    test(url) {
      if (isDegenerate) return false;
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
    testRequest(hostname, pathQuery, fullUrl) {
      if (isDegenerate) return false;
      if (domain !== null) {
        // The index only selects this pattern for hostnames under its
        // domain, so this recheck normally passes - it stays so this method
        // is correct standalone too, not just when called via the index.
        if (!matchesDomain(hostname, domain)) return false;
        if (!hasRemainder) return true;
        return globSegmentsMatch(pathQuery, segments, anchorStart, anchorEnd);
      }
      return globSegmentsMatch(fullUrl, segments, anchorStart, anchorEnd);
    },
  };
}

/** Indexes domain entries by exact domain; first occurrence wins. */
function indexDomainEntries(entries) {
  const map = new Map();
  for (let i = 0; i < entries.length; i++) {
    // Keys are stored as-is (the parser lowercases them): lowercasing here
    // would make a hypothetical mixed-case entry match, where the old
    // linear scan compared it case-sensitively against an already-lowercase
    // hostname and never matched.
    if (!map.has(entries[i].domain)) {
      map.set(entries[i].domain, { opts: normalizeRuleOpts(entries[i]), index: i });
    }
  }
  return map;
}

/**
 * Splits `{ pattern, thirdParty }[]` into `||domain`-anchored buckets plus
 * an Aho-Corasick index over the unanchored remainder's longest literals.
 * `total` counts every entry that compiled (including degenerate ones, which
 * are skipped for matching but still counted - same as before).
 */
function indexPatterns(entries) {
  const anchored = new Map();
  const unanchored = [];
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    let compiled;
    try {
      compiled = compileGlobPattern(entries[i].pattern, entries[i]);
    } catch (err) {
      // skip a pattern that fails to compile rather than fail the whole list
      continue;
    }
    compiled.index = i;
    total++;
    if (compiled.isDegenerate) continue; // matches nothing - no bucket needed
    if (compiled.domain !== null) {
      let bucket = anchored.get(compiled.domain);
      if (!bucket) {
        bucket = [];
        anchored.set(compiled.domain, bucket);
      }
      bucket.push(compiled); // stays in original list order (pushed in order)
    } else {
      unanchored.push(compiled);
    }
  }
  return { anchored, unanchored: buildLiteralIndex(unanchored), total };
}

/**
 * Builds an Aho-Corasick automaton over unanchored patterns' longest
 * literals, so one linear pass over the request URL finds every pattern
 * that could match it - instead of one substring search per rule. If a
 * pattern's glob matches a URL, its longest literal must appear in that URL,
 * so a literal the scan never reports proves its patterns can't match and
 * they are never fully tested; reported ones still go through the exact
 * same glob test as before (see findPatternEntry), so this changes
 * performance only, never results.
 *
 * Deliberately not a combined RegExp for the same reason
 * globSegmentsMatch avoids RegExp (see its doc comment): this automaton is
 * a plain DFA - constant work per input character, no backtracking
 * possible - so a hostile filter list cannot craft literals that blow up
 * match time the way it could with an alternation regex.
 */
function buildLiteralIndex(patterns) {
  const next = [Object.create(null)]; // node -> { char: node }
  const fail = [0];
  const output = [[]]; // node -> compiled[] whose longest literal ends here
  const always = [];
  for (const p of patterns) {
    const lit = p.longestLiteral;
    if (!lit) {
      // No literal to index - tested on every request. Unreachable for
      // well-formed input (a non-degenerate unanchored pattern always has
      // literal content), but kept so behavior stays correct even if that
      // invariant ever breaks, rather than silently dropping the rule.
      always.push(p);
      continue;
    }
    let node = 0;
    for (let i = 0; i < lit.length; i++) {
      const ch = lit[i];
      let child = next[node][ch];
      if (child === undefined) {
        child = next.length;
        next[node][ch] = child;
        next.push(Object.create(null));
        fail.push(0);
        output.push([]);
      }
      node = child;
    }
    output[node].push(p);
  }
  // Failure links, breadth-first (queue via head index, not shift()).
  // A node's output inherits its fail target's: a literal ending at the
  // target also ends here (e.g. "ads" inside "myads"). That inheritance is
  // built once here rather than walked per request, so adversarial literal
  // sets cost build time (once per list update), never per-request time.
  const queue = [];
  for (const ch in next[0]) {
    const child = next[0][ch];
    fail[child] = 0;
    queue.push(child);
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const children = next[node];
    for (const ch in children) {
      const child = children[ch];
      queue.push(child);
      let f = fail[node];
      while (f !== 0 && next[f][ch] === undefined) f = fail[f];
      const target = next[f][ch];
      fail[child] = target === undefined ? 0 : target;
      if (output[fail[child]].length > 0) {
        output[child] = output[child].concat(output[fail[child]]);
      }
    }
  }
  return { next, fail, output, always };
}

let literalScanId = 0;

/**
 * Yields each indexed pattern whose longest literal appears in `text`,
 * exactly once per scan (a literal can match at several positions - the
 * scan id dedupes without allocating a Set per request).
 */
function* scanLiterals(ac, text) {
  const scanId = ++literalScanId;
  let node = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (node !== 0 && ac.next[node][ch] === undefined) node = ac.fail[node];
    const child = ac.next[node][ch];
    node = child === undefined ? 0 : child;
    const out = ac.output[node];
    for (let k = 0; k < out.length; k++) {
      const p = out[k];
      if (p.acSeen !== scanId) {
        p.acSeen = scanId;
        yield p;
      }
    }
  }
}

function indexCosmetics(rules) {
  const cosmeticGlobal = [];
  const cosmeticByDomain = new Map();
  const cosmeticExclusionOnly = [];
  for (const rule of rules) {
    if (!rule.domains) {
      cosmeticGlobal.push(rule.selector);
      continue;
    }
    const includes = [];
    const excludes = [];
    for (const d of rule.domains) {
      if (d.startsWith('~')) excludes.push(d.slice(1));
      else includes.push(d);
    }
    if (includes.length === 0) {
      cosmeticExclusionOnly.push({ selector: rule.selector, excludes });
      continue;
    }
    for (const domain of includes) {
      let bucket = cosmeticByDomain.get(domain);
      if (!bucket) {
        bucket = [];
        cosmeticByDomain.set(domain, bucket);
      }
      bucket.push({ selector: rule.selector, excludes });
    }
  }
  return { cosmeticGlobal, cosmeticByDomain, cosmeticExclusionOnly };
}

/**
 * Replaces the subscription-sourced block/allow/cosmetic data. `domains`/
 * `allowedDomains` are `{ domain, ...scope }[]` and `blockedPatterns`/
 * `allowedPatterns` are `{ pattern, ...scope }[]`, where scope is the flat
 * `{ thirdParty, firstParty, domains, types }` shape from
 * filter-list-store.js's parseFilterOptions (legacy `{ thirdParty }`-only
 * entries from older on-disk caches are normalized on the way in - see
 * normalizeRuleOpts).
 */
function setDynamicBlocklist({ domains, allowedDomains, blockedPatterns = [], allowedPatterns = [], cosmeticRules = [] }) {
  dynamicBlocklist.domainEntries = indexDomainEntries(domains);
  dynamicBlocklist.allowedDomainEntries = indexDomainEntries(allowedDomains);

  const blocked = indexPatterns(blockedPatterns);
  dynamicBlocklist.anchoredBlocked = blocked.anchored;
  dynamicBlocklist.unanchoredBlocked = blocked.unanchored;

  const allowed = indexPatterns(allowedPatterns);
  dynamicBlocklist.anchoredAllowed = allowed.anchored;
  dynamicBlocklist.unanchoredAllowed = allowed.unanchored;

  const cosmetics = indexCosmetics(cosmeticRules);
  dynamicBlocklist.cosmeticGlobal = cosmetics.cosmeticGlobal;
  dynamicBlocklist.cosmeticByDomain = cosmetics.cosmeticByDomain;
  dynamicBlocklist.cosmeticExclusionOnly = cosmetics.cosmeticExclusionOnly;

  dynamicBlocklist.ruleCounts = {
    domains: domains.length,
    blockedPatterns: blocked.total,
    cosmeticRules: cosmeticRules.length,
  };
}

/**
 * Finds the matching entry with the lowest original list position - i.e. the
 * same entry the old linear "first match wins" scan returned. That ordering
 * matters because only the FIRST matching entry's scope options are
 * consulted (see ruleApplies): if they say "skip on this request", later
 * matching entries are not reconsidered. Preserved exactly, not "fixed",
 * because changing it would change what gets blocked.
 */
function findDomainEntry(hostname, map) {
  let best = null;
  for (const suffix of domainSuffixes(hostname)) {
    const entry = map.get(suffix);
    if (entry && (!best || entry.index < best.index)) best = entry;
  }
  return best;
}

/**
 * Same first-match-in-list-order rule as findDomainEntry, across both the
 * domain-indexed buckets and the unanchored remainder (which interleave in
 * the original order, hence the shared `best.index` cutoff: anchored buckets
 * are in list order so they can break early, while automaton candidates
 * arrive unsorted and are only skipped, never cut off). Every candidate
 * still runs the exact same glob test as the old linear scan - the indexes
 * only decide which rules are worth testing.
 */
function findPatternEntry(url, hostname, pathQuery, anchored, literalIndex) {
  let best = null;
  for (const suffix of domainSuffixes(hostname)) {
    const bucket = anchored.get(suffix);
    if (!bucket) continue;
    for (const p of bucket) {
      if (best && p.index >= best.index) break; // bucket is in list order
      if (p.testRequest(hostname, pathQuery, url)) best = p;
    }
  }
  if (literalIndex) {
    for (const p of scanLiterals(literalIndex, url)) {
      if (best && p.index >= best.index) continue;
      if (p.testRequest(hostname, pathQuery, url)) best = p;
    }
    for (const p of literalIndex.always) {
      if (best && p.index >= best.index) continue;
      if (p.testRequest(hostname, pathQuery, url)) best = p;
    }
  }
  return best;
}

/**
 * Normalizes a rule's scope options into `{ thirdParty, firstParty,
 * domains: { inc, exc } | null, types: { inc, exc } | null }`. Accepts the
 * legacy `{ thirdParty }`-only shape too (old on-disk filter-list caches
 * and older callers): missing fields default to unscoping. Empty
 * include/exclude lists collapse to null (no scope).
 */
function normalizeRuleOpts(raw = {}) {
  const rawDomains = raw.domains;
  const domains = rawDomains && ((rawDomains.inc && rawDomains.inc.length) || (rawDomains.exc && rawDomains.exc.length))
    ? { inc: rawDomains.inc || [], exc: rawDomains.exc || [] }
    : null;
  const rawTypes = raw.types;
  const types = rawTypes && ((rawTypes.inc && rawTypes.inc.length) || (rawTypes.exc && rawTypes.exc.length))
    ? { inc: rawTypes.inc || [], exc: rawTypes.exc || [] }
    : null;
  return { thirdParty: !!raw.thirdParty, firstParty: !!raw.firstParty, domains, types };
}

/**
 * Decides whether a scoped rule actually applies to this particular request:
 * - `$third-party` skips same-site requests (`thirdPartyStatus === false`,
 *   the whole point of the option: don't block a site's own first-party
 *   content just because some embedded-ad rule happens to also match its
 *   path/domain); unknown status (null) still applies - the
 *   pre-`$third-party` behavior, so subresource blocking outside the
 *   specific case this was added for is unaffected.
 * - `$~third-party` (first-party-only) is the mirror: skips cross-site
 *   requests (`thirdPartyStatus === true`); unknown still applies.
 * - `$domain=` requires the top-level page's hostname to match (suffix, so
 *   subdomains count; `~` entries exclude); an unknown page means the rule
 *   doesn't apply - scope that can't be confirmed isn't assumed.
 * - Resource types require the request's Electron resourceType to be in the
 *   include set (if any) and out of the exclude set; an unknown request
 *   type applies (production always provides one via webRequest).
 */
function ruleApplies(opts, thirdPartyStatus, topHostname, resourceType) {
  if (opts.thirdParty && thirdPartyStatus === false) return false;
  if (opts.firstParty && thirdPartyStatus === true) return false;
  if (opts.domains && !domainScopeApplies(opts.domains, topHostname)) return false;
  if (opts.types && !typeScopeApplies(opts.types, resourceType)) return false;
  return true;
}

function domainScopeApplies(scope, topHostname) {
  if (!topHostname) return false;
  const host = topHostname.toLowerCase();
  if (scope.exc.some((d) => matchesDomain(host, d))) return false;
  if (scope.inc.length === 0) return true;
  return scope.inc.some((d) => matchesDomain(host, d));
}

function typeScopeApplies(scope, resourceType) {
  if (!resourceType) return true;
  // cspReport is browser-generated noise with no ABP counterpart; bucket it
  // with $other rather than inventing a pseudo-type.
  const effective = resourceType === 'cspReport' ? 'other' : resourceType;
  if (scope.exc.includes(effective)) return false;
  if (scope.inc.length === 0) return true;
  return scope.inc.includes(effective);
}

// The top-level page URL barely changes between requests (every subresource
// of a page load shares it), so memoizing its last parse skips ~100 redundant
// URL parses per page.
let lastTopUrl = null;
let lastTopHostname = null;

/**
 * `context.resourceType`/`context.topUrl` scope rules the way real
 * ad-blockers do (see ruleApplies): `$third-party`-scoped rules (the
 * majority of real EasyList/EasyPrivacy entries) apply only to genuinely
 * cross-site requests instead of a site's own first-party content -
 * without this, subscribing to a full list will routinely block a site's
 * own page/assets whenever their path or domain happens to also match a
 * rule that was only ever meant to catch third-party embeds; `$domain=`
 * restricts rules to listed top-level pages; resource-type options
 * (`$script`, `$image`, ...) restrict to matching request kinds. A
 * top-level navigation (`resourceType === 'mainFrame'`) with no prior
 * `topUrl` to compare against is treated as first-party to itself - the
 * same convention real ad-blockers use, since there's no "other site" for a
 * page's own load to be third-party relative to.
 */
function isBlocked(url, context = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return false;
  }
  const hostname = parsed.hostname;

  const topUrl = context.topUrl || null;
  let topHostname = null;
  if (topUrl) {
    if (topUrl === lastTopUrl) {
      topHostname = lastTopHostname;
    } else {
      topHostname = safeHostname(topUrl);
      lastTopUrl = topUrl;
      lastTopHostname = topHostname;
    }
  }
  let thirdPartyStatus = isThirdPartyRequest(hostname, topHostname);
  if (thirdPartyStatus === null && context.resourceType === 'mainFrame') thirdPartyStatus = false;
  // A top-level navigation with no prior page to compare against compares
  // `$domain=` scoping against the request's own hostname - the page IS its
  // own top document (same convention as the first-party fallback above).
  const scopeHostname = topHostname || (context.resourceType === 'mainFrame' ? hostname : null);
  const resourceType = context.resourceType || null;

  // Exceptions always win, matching how Adblock Plus-style engines treat
  // @@ rules - an allow rule overrides any block rule, not just ones from
  // the same list.
  const allowedDomainEntry = findDomainEntry(hostname, dynamicBlocklist.allowedDomainEntries);
  if (allowedDomainEntry && ruleApplies(allowedDomainEntry.opts, thirdPartyStatus, scopeHostname, resourceType)) return false;
  const pathQuery = parsed.pathname + parsed.search;
  const allowedPattern = findPatternEntry(
    url, hostname, pathQuery, dynamicBlocklist.anchoredAllowed, dynamicBlocklist.unanchoredAllowed
  );
  if (allowedPattern && ruleApplies(allowedPattern.opts, thirdPartyStatus, scopeHostname, resourceType)) return false;

  if (BLOCKED_DOMAINS.some((domain) => matchesDomain(hostname, domain))) return true;
  const blockedDomainEntry = findDomainEntry(hostname, dynamicBlocklist.domainEntries);
  if (blockedDomainEntry && ruleApplies(blockedDomainEntry.opts, thirdPartyStatus, scopeHostname, resourceType)) return true;
  const blockedPattern = findPatternEntry(
    url, hostname, pathQuery, dynamicBlocklist.anchoredBlocked, dynamicBlocklist.unanchoredBlocked
  );
  if (blockedPattern && ruleApplies(blockedPattern.opts, thirdPartyStatus, scopeHostname, resourceType)) return true;

  return false;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return null;
  }
}

/**
 * Returns the deduplicated list of CSS selectors to hide on a given
 * hostname. Hostnames are lowercased before matching (DNS is
 * case-insensitive, and the caller passes `location.hostname` which is
 * already lowercase) so this agrees with isBlocked's case handling.
 */
function getCosmeticRulesForHost(hostname) {
  const host = hostname.toLowerCase();
  let extra = null;
  for (const rule of dynamicBlocklist.cosmeticExclusionOnly) {
    if (!rule.excludes.some((d) => matchesDomain(host, d))) {
      if (!extra) extra = [];
      extra.push(rule.selector);
    }
  }
  for (const suffix of domainSuffixes(host)) {
    const bucket = dynamicBlocklist.cosmeticByDomain.get(suffix);
    if (!bucket) continue;
    for (const rule of bucket) {
      if (rule.excludes.some((d) => matchesDomain(host, d))) continue;
      if (!extra) extra = [];
      extra.push(rule.selector);
    }
  }
  // Fast path (the common case for sites with no scoped rules): the global
  // list alone, without building a Set over tens of thousands of selectors.
  if (!extra) return dynamicBlocklist.cosmeticGlobal.slice();
  return [...new Set(dynamicBlocklist.cosmeticGlobal.concat(extra))];
}

/**
 * Reports how many rules are actually active right now, split into the
 * always-on built-in list versus whatever enabled subscriptions have
 * contributed. Once EasyList/EasyPrivacy are auto-fetched (see
 * filter-list-store.js), subscriptionRuleCount is typically tens of
 * thousands - the status pill showing only the 34-domain built-in count
 * regardless of that would be actively misleading about what's protecting
 * the user.
 */
function getBlocklistStats() {
  return {
    builtinDomainCount: BLOCKED_DOMAINS.length,
    subscriptionRuleCount:
      dynamicBlocklist.ruleCounts.domains +
      dynamicBlocklist.ruleCounts.blockedPatterns +
      dynamicBlocklist.ruleCounts.cosmeticRules,
  };
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
  getBlocklistStats,
  compileGlobPattern,
  BLOCKED_DOMAINS,
};
