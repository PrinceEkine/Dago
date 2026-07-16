# Security

Dago is pre-alpha, unaudited software built by a small/volunteer team - see
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for an honest account of what
it does and doesn't protect against right now.

## Reporting a vulnerability

There's no dedicated security contact or bug-bounty program yet (that costs
money this project doesn't have - see the README's funding ask). For now,
please open a GitHub issue. If the issue is sensitive enough that you'd
rather not post it publicly, say so in a minimal issue and a maintainer will
follow up for details privately.

## Self-review disclosure

This codebase has **not** had an independent third-party security audit -
that's explicitly tracked as an open, unfunded item in
[`docs/ROADMAP.md`](docs/ROADMAP.md), and nothing below changes that. What
has happened is an internal self-review pass over the code in this
repository, using static analysis and direct exploit reproduction rather
than just reading the diff. In the interest of being upfront about what that
did and didn't catch:

- **Found and fixed before merging**: the filter-list glob-pattern matcher
  (`src/main/adblock.js`) had a bug where a degenerate address pattern with
  no domain and no literal text - a bare `|`, `*`, `^`, or similar - compiled
  into a matcher that matched *every* URL unconditionally. Because exception
  (`@@`) rules are checked before any block rule, a single line like `@@|`
  in an enabled filter-list subscription would silently disable all
  ad/tracker blocking browser-wide, including the built-in list. Filter
  lists are fetched from a URL the user supplies and can be a third party's
  infrastructure, so a compromised or malicious list host is exactly the
  threat this feature has to assume - this was a real, concretely
  reproducible bypass of the browser's core privacy feature, not a
  theoretical one. Fixed by making the compiler fail safe: a pattern with no
  real constraint now matches nothing instead of everything.
- **Also found and fixed during development** (not a late-stage catch, but
  worth being transparent about): an earlier version of that same matcher
  used `RegExp` built from escaped literal segments, reasoning that having no
  nested quantifiers made it immune to ReDoS. That reasoning was wrong - a
  pattern with about 30 wildcard segments took over two minutes to fail a
  single match, confirming catastrophic backtracking. It was replaced with a
  matcher that only uses `String.prototype.indexOf`/`startsWith`/`endsWith`,
  which can't backtrack at all.

Both of these were in code added in the same development pass that
introduced them, verified by direct execution (not just code reading), and
fixed before being merged to `main`. They're disclosed here specifically
because "we reviewed our own code and it's fine" is a much weaker claim than
"here's what our review actually found, including our own mistakes" - a
self-review is still just that, self-review, and it does not substitute for
an independent audit by people with no stake in the outcome.

- **Found in the field, and the first fix didn't work either**: popup
  blocking was ineffective from the very first commit until it was reported
  from real-world use (an ad popunder opened a new tab and redirected to a
  shopping site). Root cause one: the webview tag was created with
  `allowpopups="false"`, but `allowpopups` is a presence-checked boolean
  attribute in Electron - setting it to the string `"false"` still *enables*
  popups, the exact opposite of the intent. Root cause two: the first
  attempted fix listened for the webview's `new-window` event, which was
  removed from Electron years before the version this project uses - the
  handler could never fire, so the "fix" changed nothing, and only a second
  field report revealed that. The working fix removes the `allowpopups`
  attribute entirely (popups are disabled by default when it's absent) and
  additionally denies all window creation from tab content in the main
  process via `setWindowOpenHandler`, which page content cannot reach.
  Lesson worth stating plainly: the first fix was verified with syntax
  checks and unrelated regression tests, but the popup path itself was
  never exercised end-to-end - this dev environment can't launch Electron
  (its binary host is blocked), and that verification gap is exactly where
  the bug survived. The same field report also surfaced that tab WebRTC
  bypassed the Tor SOCKS proxy (STUN requests from ad scripts were visible
  in the user's logs), a real-IP-discovery vector now closed with
  `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`.

## Android app caveat

`android/`'s shared `:logic` module ports the same glob-matching and
filter-parsing algorithms, with both fixes above built in from the start
(there's a regression test for the degenerate-pattern case specifically -
see `android/logic/src/test/kotlin/.../GlobMatcherTest.kt`) rather than
needing to be rediscovered there. That module has genuine, passing
automated tests. The rest of the Android app (`:app` - the actual
`WebView`/Tor-service/UI layer) has **not been build-verified at all** in
this repository, for reasons unrelated to code review depth: it requires
the Android SDK, and this project's dev sandbox has no network access to
fetch it. See `android/README.md` for the full explanation. Treat that part
of the codebase as less scrutinized than everything covered above until a
real build/test pass happens on it.
