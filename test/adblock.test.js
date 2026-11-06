'use strict';

// Focused regression suite for the request blocker (src/main/adblock.js).
// Run with: npm test  (Node's built-in runner, no dependencies)
//
// These tests pin the blocker's *behavior*, including the quirks documented
// in SECURITY.md (degenerate-pattern fail-safe, $third-party scoping) and
// the first-match-in-list-order precedence the indexed matcher preserves.
// The final test is a loose performance tripwire: it fails if per-request
// matching ever regresses to linear-scan territory, with ~400x headroom so
// it never flakes on slow CI machines.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isBlocked,
  setDynamicBlocklist,
  getCosmeticRulesForHost,
  getBlocklistStats,
  compileGlobPattern,
  BLOCKED_DOMAINS,
} = require('../src/main/adblock.js');
const { parseFilterList } = require('../src/main/filter-list-store.js');

const EMPTY = {
  domains: [],
  allowedDomains: [],
  blockedPatterns: [],
  allowedPatterns: [],
  cosmeticRules: [],
};

beforeEach(() => {
  setDynamicBlocklist(JSON.parse(JSON.stringify(EMPTY)));
});

describe('built-in list', () => {
  it('blocks known tracker domains and their subdomains', () => {
    assert.equal(isBlocked('https://google-analytics.com/collect'), true);
    assert.equal(isBlocked('https://sub.doubleclick.net/ads'), true);
    assert.equal(isBlocked('https://not-a-tracker.example.com/'), false);
  });

  it('does not match unrelated domains that merely contain a listed name', () => {
    assert.equal(isBlocked('https://doubleclick.net.evil.com/'), false);
    assert.equal(isBlocked('https://mydoubleclick.net/'), false);
  });
});

describe('subscription domain rules', () => {
  it('blocks listed domains and subdomains', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'ads.example.com', thirdParty: false }],
    });
    assert.equal(isBlocked('https://ads.example.com/banner.js'), true);
    assert.equal(isBlocked('https://cdn.ads.example.com/banner.js'), true);
    assert.equal(isBlocked('https://example.com/'), false);
  });

  it('lets exception domains override every block source, including built-ins', () => {
    setDynamicBlocklist({
      ...EMPTY,
      allowedDomains: [{ domain: 'google-analytics.com', thirdParty: false }],
    });
    assert.equal(isBlocked('https://google-analytics.com/collect'), false);
  });
});

describe('$third-party scoping', () => {
  // The SECURITY.md field report: a subscription rule matching a site's own
  // CDN path must not break the site itself, while genuinely third-party
  // matches from the same rule shape are still blocked.
  const lists = {
    ...EMPTY,
    blockedPatterns: [{ pattern: '||cdn.streambox.example/ads/*', thirdParty: true }],
    domains: [{ domain: 'evil-tracker.example', thirdParty: true }],
  };

  it('skips third-party-scoped rules on first-party requests', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(lists)));
    assert.equal(
      isBlocked('https://cdn.streambox.example/ads/player.js', {
        resourceType: 'script',
        topUrl: 'https://www.streambox.example/watch/123',
      }),
      false
    );
  });

  it('applies third-party-scoped rules on cross-site requests', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(lists)));
    assert.equal(
      isBlocked('https://evil-tracker.example/pixel.gif', {
        resourceType: 'image',
        topUrl: 'https://www.streambox.example/watch/123',
      }),
      true
    );
  });

  it('treats a top-level navigation as first-party to itself', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(lists)));
    assert.equal(
      isBlocked('https://www.streambox.example/watch/123', { resourceType: 'mainFrame' }),
      false
    );
  });

  it('falls back to blocking when third-party status is unknown', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(lists)));
    assert.equal(isBlocked('https://evil-tracker.example/pixel.gif', {}), true);
  });

  it('respects multi-label public suffixes (co.uk sites are distinct sites)', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'ads.shop.co.uk', thirdParty: true }],
    });
    assert.equal(
      isBlocked('https://ads.shop.co.uk/a.js', { resourceType: 'script', topUrl: 'https://other.co.uk/' }),
      true
    );
    assert.equal(
      isBlocked('https://ads.shop.co.uk/a.js', { resourceType: 'script', topUrl: 'https://shop.co.uk/' }),
      false
    );
  });
});

describe('first-match-in-list-order precedence', () => {
  // Only the FIRST matching entry's $third-party flag is consulted: if it
  // says "skip on first-party", later matching entries are not reconsidered.
  // Preserved deliberately - changing it would change what gets blocked.
  it('does not fall through to a later matching rule', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [
        { domain: 'ads.example.com', thirdParty: true },
        { domain: 'ads.example.com', thirdParty: false },
      ],
    });
    assert.equal(
      isBlocked('https://ads.example.com/a.js', {
        resourceType: 'script',
        topUrl: 'https://ads.example.com/page',
      }),
      false
    );
  });

  it('honors suffix-overlapping entries in list order, not specificity order', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [
        { domain: 'example.com', thirdParty: true },
        { domain: 'sub.example.com', thirdParty: false },
      ],
    });
    assert.equal(
      isBlocked('https://sub.example.com/a.js', {
        resourceType: 'script',
        topUrl: 'https://sub.example.com/page',
      }),
      false
    );
  });
});

describe('glob patterns', () => {
  it('matches anchored, path, and bare-substring rules', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [
        { pattern: '||cdn.example.com/ads/*', thirdParty: false },
        { pattern: '|https://track.example.com/pixel', thirdParty: false },
        { pattern: 'sponsored-slot.js', thirdParty: false },
      ],
    });
    assert.equal(isBlocked('https://cdn.example.com/ads/banner.js'), true);
    assert.equal(isBlocked('https://cdn.example.com/content/app.js'), false);
    assert.equal(isBlocked('https://track.example.com/pixel?x=1'), true);
    assert.equal(isBlocked('https://other.example.com/js/sponsored-slot.js'), true);
    assert.equal(isBlocked('https://other.example.com/js/app.js'), false);
  });

  it('treats degenerate patterns as matching nothing (SECURITY.md fail-safe)', () => {
    for (const pattern of ['|', '*', '^', '**', '^^', '||']) {
      assert.equal(
        compileGlobPattern(pattern).test('https://example.com/'),
        false,
        `pattern ${JSON.stringify(pattern)} must match nothing`
      );
    }
    // ...especially in the exception list, where a match-everything rule
    // would silently disable all blocking browser-wide.
    setDynamicBlocklist({
      ...EMPTY,
      allowedPatterns: [{ pattern: '|', thirdParty: false }],
    });
    assert.equal(isBlocked('https://google-analytics.com/collect'), true);
  });

  it('keeps the exported test(url) working standalone', () => {
    const compiled = compileGlobPattern('||cdn.example.com/ads/*');
    assert.equal(compiled.test('https://cdn.example.com/ads/x.js'), true);
    assert.equal(compiled.test('https://cdn.example.com/app.js'), false);
    assert.equal(compiled.test('not a url'), false);
  });
});

describe('cosmetic rules', () => {
  const cosmeticRules = [
    { domains: null, selector: '.generic-ad' },
    { domains: ['example.com'], selector: '.site-ad' },
    { domains: ['example.com', '~sub.example.com'], selector: '.scoped-ad' },
    { domains: ['~example.com'], selector: '.excluded-ad' },
  ];

  it('scopes selectors to the hostname with exclusion support', () => {
    setDynamicBlocklist({ ...EMPTY, cosmeticRules: JSON.parse(JSON.stringify(cosmeticRules)) });
    assert.deepEqual(getCosmeticRulesForHost('example.com').sort(), ['.generic-ad', '.scoped-ad', '.site-ad']);
    assert.deepEqual(getCosmeticRulesForHost('sub.example.com').sort(), ['.generic-ad', '.site-ad']);
    assert.deepEqual(getCosmeticRulesForHost('other.org').sort(), ['.excluded-ad', '.generic-ad']);
  });

  it('dedupes repeated selectors', () => {
    setDynamicBlocklist({
      ...EMPTY,
      cosmeticRules: [
        { domains: null, selector: '.dup' },
        { domains: ['example.com'], selector: '.dup' },
      ],
    });
    assert.deepEqual(getCosmeticRulesForHost('example.com'), ['.dup']);
  });

  it('matches hostnames case-insensitively, like request blocking', () => {
    setDynamicBlocklist({ ...EMPTY, cosmeticRules: JSON.parse(JSON.stringify(cosmeticRules)) });
    assert.deepEqual(getCosmeticRulesForHost('EXAMPLE.COM').sort(), ['.generic-ad', '.scoped-ad', '.site-ad']);
  });
});

describe('stats', () => {
  it('reports built-in vs subscription counts', () => {
    setDynamicBlocklist({
      domains: [{ domain: 'a.example', thirdParty: false }],
      allowedDomains: [],
      blockedPatterns: [{ pattern: '||b.example/*', thirdParty: false }],
      allowedPatterns: [],
      cosmeticRules: [{ domains: null, selector: '.c' }],
    });
    assert.deepEqual(getBlocklistStats(), {
      builtinDomainCount: BLOCKED_DOMAINS.length,
      subscriptionRuleCount: 3,
    });
  });
});

describe('invalid input', () => {
  it('never throws and never blocks on garbage', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: 'tracking', thirdParty: false }],
    });
    for (const url of ['', 'not a url', '://bad', null, undefined]) {
      assert.equal(isBlocked(url, {}), false);
    }
    assert.equal(isBlocked('https://example.com/', { topUrl: 'garbage][' }), false);
  });
});

describe('$domain= scoping', () => {
  const scoped = {
    ...EMPTY,
    domains: [{ domain: 'ads.cdn.example', domains: { inc: ['shop.example'], exc: [] } }],
  };

  it('applies only on listed top-level pages', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(scoped)));
    assert.equal(
      isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script', topUrl: 'https://shop.example/item' }),
      true
    );
    assert.equal(
      isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script', topUrl: 'https://other.example/' }),
      false
    );
  });

  it('includes subdomains of listed pages', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(scoped)));
    assert.equal(
      isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script', topUrl: 'https://app.shop.example/' }),
      true
    );
  });

  it('honors ~ exclusions', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'ads.cdn.example', domains: { inc: ['example.com'], exc: ['safe.example.com'] } }],
    });
    assert.equal(
      isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script', topUrl: 'https://www.example.com/' }),
      true
    );
    assert.equal(
      isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script', topUrl: 'https://safe.example.com/' }),
      false
    );
  });

  it('treats a top-level navigation as its own page', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'shop.example', domains: { inc: ['shop.example'], exc: [] } }],
    });
    assert.equal(isBlocked('https://shop.example/', { resourceType: 'mainFrame' }), true);
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'shop.example', domains: { inc: ['other.example'], exc: [] } }],
    });
    assert.equal(isBlocked('https://shop.example/', { resourceType: 'mainFrame' }), false);
  });

  it('skips $domain rules when the page is unknown', () => {
    setDynamicBlocklist(JSON.parse(JSON.stringify(scoped)));
    assert.equal(isBlocked('https://ads.cdn.example/b.js', {}), false);
    assert.equal(isBlocked('https://ads.cdn.example/b.js', { resourceType: 'script' }), false);
  });
});

describe('resource-type options', () => {
  it('restricts to listed types', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||cdn.example.com^', types: { inc: ['script'], exc: [] } }],
    });
    assert.equal(isBlocked('https://cdn.example.com/a.js', { resourceType: 'script' }), true);
    assert.equal(isBlocked('https://cdn.example.com/a.png', { resourceType: 'image' }), false);
    assert.equal(isBlocked('https://cdn.example.com/', { resourceType: 'mainFrame' }), false);
  });

  it('$document matches only the top-level page load', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||example.com^', types: { inc: ['mainFrame'], exc: [] } }],
    });
    assert.equal(isBlocked('https://example.com/', { resourceType: 'mainFrame' }), true);
    assert.equal(
      isBlocked('https://example.com/frame', { resourceType: 'subFrame', topUrl: 'https://other.example/' }),
      false
    );
    assert.equal(
      isBlocked('https://example.com/a.js', { resourceType: 'script', topUrl: 'https://other.example/' }),
      false
    );
  });

  it('negated types exclude, with and without positives', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||cdn.example.com^', types: { inc: [], exc: ['script'] } }],
    });
    assert.equal(isBlocked('https://cdn.example.com/a.js', { resourceType: 'script' }), false);
    assert.equal(isBlocked('https://cdn.example.com/a.png', { resourceType: 'image' }), true);

    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||cdn.example.com^', types: { inc: ['script', 'image'], exc: ['image'] } }],
    });
    assert.equal(isBlocked('https://cdn.example.com/a.js', { resourceType: 'script' }), true);
    assert.equal(isBlocked('https://cdn.example.com/a.png', { resourceType: 'image' }), false);
  });

  it('applies when the request type is unknown', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||cdn.example.com^', types: { inc: ['script'], exc: [] } }],
    });
    assert.equal(isBlocked('https://cdn.example.com/a.js', {}), true);
  });

  it('buckets cspReport with $other', () => {
    setDynamicBlocklist({
      ...EMPTY,
      blockedPatterns: [{ pattern: '||example.com^', types: { inc: ['other'], exc: [] } }],
    });
    assert.equal(isBlocked('https://example.com/', { resourceType: 'cspReport' }), true);
    assert.equal(isBlocked('https://example.com/', { resourceType: 'other' }), true);
    assert.equal(isBlocked('https://example.com/a.js', { resourceType: 'script' }), false);
  });
});

describe('first-party ($~third-party) rules', () => {
  it('blocks same-site requests and skips cross-site ones', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'tracker.example', firstParty: true }],
    });
    assert.equal(
      isBlocked('https://tracker.example/p.gif', { resourceType: 'image', topUrl: 'https://tracker.example/page' }),
      true
    );
    assert.equal(
      isBlocked('https://tracker.example/p.gif', { resourceType: 'image', topUrl: 'https://other.example/' }),
      false
    );
    assert.equal(isBlocked('https://tracker.example/p.gif', {}), true);
  });
});

describe('filter option parsing (parseFilterList)', () => {
  it('parses $domain=, types, and party options end to end', () => {
    const parsed = parseFilterList('||ads.example.com^$script,third-party,domain=shop.example|~safe.shop.example\n');
    assert.equal(parsed.blocked.length, 1);
    assert.deepEqual(parsed.blocked[0], {
      domain: 'ads.example.com',
      thirdParty: true,
      firstParty: false,
      domains: { inc: ['shop.example'], exc: ['safe.shop.example'] },
      types: { inc: ['script'], exc: [] },
    });
  });

  it('parses negations and aliases, ignoring unsupported options', () => {
    const parsed = parseFilterList('||ads.example.com^$~script,~third-party,xhr,elemhide,match-case,csp=script-src,foo=bar\n');
    assert.equal(parsed.blocked.length, 1);
    assert.deepEqual(parsed.blocked[0], {
      domain: 'ads.example.com',
      thirdParty: false,
      firstParty: true,
      domains: null,
      types: { inc: ['xhr'], exc: ['script'] },
    });
  });

  it('keeps unscoped rules fully unscoped', () => {
    const parsed = parseFilterList('||ads.example.com^\n');
    assert.deepEqual(parsed.blocked[0], {
      domain: 'ads.example.com',
      thirdParty: false,
      firstParty: false,
      domains: null,
      types: null,
    });
  });

  it('carries options through exception and pattern rules', () => {
    const parsed = parseFilterList('@@||cdn.example.com/ads/*$image,domain=example.com\n');
    assert.equal(parsed.allowedPatterns.length, 1);
    assert.deepEqual(parsed.allowedPatterns[0], {
      pattern: '||cdn.example.com/ads/*',
      thirdParty: false,
      firstParty: false,
      domains: { inc: ['example.com'], exc: [] },
      types: { inc: ['image'], exc: [] },
    });
  });
});

describe('legacy and precedence compat', () => {
  it('accepts legacy {thirdParty}-only entries (old disk caches)', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [{ domain: 'ads.example.com', thirdParty: true }],
      blockedPatterns: [{ pattern: 'tracking.js', thirdParty: false }],
    });
    assert.equal(
      isBlocked('https://ads.example.com/a.js', { resourceType: 'script', topUrl: 'https://other.example/' }),
      true
    );
    assert.equal(
      isBlocked('https://ads.example.com/a.js', { resourceType: 'script', topUrl: 'https://ads.example.com/' }),
      false
    );
    assert.equal(isBlocked('https://other.example/tracking.js', { resourceType: 'script' }), true);
  });

  it('first-match-wins covers the new scopes too', () => {
    setDynamicBlocklist({
      ...EMPTY,
      domains: [
        { domain: 'ads.example.com', domains: { inc: ['other.example'], exc: [] } },
        { domain: 'ads.example.com' },
      ],
    });
    // The first entry matches the address but its $domain scope misses - and
    // the later unscoped match is not reconsidered (same preserved quirk as
    // $third-party ordering).
    assert.equal(
      isBlocked('https://ads.example.com/a.js', { resourceType: 'script', topUrl: 'https://shop.example/' }),
      false
    );
  });
});

describe('performance tripwire', () => {
  it('matches EasyList-scale lists in well under linear-scan time', () => {
    const domains = [];
    for (let i = 0; i < 15000; i++) {
      domains.push({ domain: `ads${i}.tracker${i % 997}.com`, thirdParty: i % 3 !== 0 });
    }
    const blockedPatterns = [];
    for (let i = 0; i < 15000; i++) {
      blockedPatterns.push({
        pattern: `||cdn${i % 5000}.static${i % 251}.net/ads/banner${i}/*^`,
        thirdParty: i % 2 === 0,
      });
    }
    for (let i = 0; i < 8000; i++) {
      blockedPatterns.push({ pattern: `tracking-pixel-${i}.js`, thirdParty: false });
    }
    setDynamicBlocklist({
      domains,
      allowedDomains: [],
      blockedPatterns,
      allowedPatterns: [],
      cosmeticRules: [],
    });

    const urls = [
      'https://www.example.com/',
      'https://cdn7.static3.net/assets/app.css',
      'https://ads42.tracker42.com/pixel.gif',
      'https://www.example.com/static/tracking-pixel-42.js',
    ];
    const started = Date.now();
    for (let i = 0; i < 500; i++) {
      for (const url of urls) isBlocked(url, { resourceType: 'script', topUrl: 'https://www.example.com/' });
    }
    const elapsed = Date.now() - started;
    // The old linear scan needed ~16ms per call here (~33s for this loop);
    // the indexed matcher needs ~0.02ms (~50ms). 5s is generous headroom.
    assert.ok(elapsed < 5000, `2000 isBlocked calls took ${elapsed}ms - matcher regressed?`);
  });
});
