# Architecture

This document covers the **desktop** app (`src/`). The Android app
(`android/`) is a separate codebase with its own architecture doc -
see `android/README.md` - since Electron doesn't run on mobile.

Dago (alpha) is an Electron application. Electron was chosen over a
from-scratch engine because writing a competitive browser rendering engine,
JS engine, and network stack is a multi-year, industry-scale effort (see
Chromium, Gecko, WebKit) that isn't achievable by a small/unfunded team -
building on Chromium via Electron lets the project focus its effort on the
privacy layer instead of reinventing HTML/CSS/JS rendering.

## Process layout

- **Main process** (`src/main/main.js`) - owns the app lifecycle, the browser
  window, and all privileged operations: launching Tor, managing per-tab
  sessions/proxies, the encrypted history store, the PIN gate, and screen
  capture source selection.
- **Renderer (browser chrome)** (`src/renderer/`) - the tab strip, address
  bar, and status indicators. Talks to the main process only through the
  `window.dago` bridge exposed by `src/preload/app-preload.js`
  (`contextIsolation: true`, no direct Node access).
- **Tabs** - each tab is an Electron `<webview>` with its own **in-memory,
  non-persistent session partition** (`tab-<uuid>`, no `persist:` prefix), so
  closing a tab wipes its cookies/local storage/cache. `will-attach-webview`
  in `main.js` forcibly attaches `src/preload/privacy-preload.js` to every
  webview regardless of what the page requests, so a compromised or
  malicious page can't opt out of the hardening.
- **Utility windows** (History / Settings / Screenshare / Bookmarks /
  Downloads) are separate `BrowserWindow`s using the default session and the
  same `app-preload.js` bridge, not webviews - they need access to
  privileged IPC (PIN verification, `desktopCapturer`) that tab content must
  never get.

## Chrome UI

The tab strip, address bar, and toolbar (`src/renderer/index.html`,
`styles.css`, `renderer.js`) use a small hand-built inline-SVG icon set
(`src/renderer/icons.js`, shared with the utility pages) instead of unicode
glyphs, which rendered inconsistently across platforms/fonts. Tabs show a
real favicon (fetched the privacy-preserving way described in the table
below) with a letter-placeholder fallback and a loading spinner while the
page is still loading. The address bar suggests matches from bookmarks and
history as you type (arrow keys to navigate, Enter/click to go) - history
suggestions only appear once history has been unlocked with its PIN
elsewhere in the app during that session, consistent with history's
existing PIN gate rather than working around it.

The main window merges the OS title bar with the tab strip, the way
Chrome/Edge do, instead of a native titlebar sitting above a separate
custom tab row: `frame: false` on Windows/Linux with Dago's own
minimize/maximize/close buttons (`#window-controls` in `index.html`, wired
through `window:minimize`/`window:maximize-toggle`/`window:close` IPC
handlers in `ipc.js`), and `titleBarStyle: 'hiddenInset'` on macOS instead,
which keeps the native traffic-light buttons rather than replacing them -
replacing them would be off-platform for how macOS users expect a window
to look. **Caveat:** this dev environment can't launch a real Electron
window on any OS (its binary host is blocked - see README), so the window
chrome itself is verified by cross-checking the Electron API surface
(`electron.d.ts`) and by rendering the actual HTML/CSS/JS in real Chromium
via Playwright with a mocked `window.dago` bridge (confirms the controls
render, wire up, and call the right bridge methods) - not by a live
minimize/maximize/drag test on a real window in any OS. A maintainer with
a desktop to actually run `npm start` on is the real test of this one.

## Privacy layer

| Concern | Mechanism | File |
|---|---|---|
| Anonymized routing | Spawns a `tor` daemon with N isolated `SocksPort`s; each tab is pinned to one, so tabs don't share circuits the way default Tor Browser tabs can. The binary is resolved in order: a maintainer-bundled build, `tor` on PATH (a normal system install), then a detected Tor Browser install as a fallback (Tor Browser bundles its own private `tor` but deliberately keeps it off PATH, which otherwise makes Dago wrongly report Tor as "not installed" for the very common case of a user who only has Tor Browser) | `src/main/tor-manager.js` |
| New identity | Sends `SIGNAL NEWNYM` over Tor's control port | `src/main/tor-manager.js` |
| Tracker/ad blocking | `webRequest.onBeforeRequest` cancels requests to a known tracker/ad domain list, per tab session; the list is a static built-in set merged live with any enabled filter-list subscriptions | `src/main/adblock.js` |
| Filter list subscriptions | User-added EasyList/EasyPrivacy-style URLs, fetched and parsed only on explicit "Update" (never automatically), cached to disk, and merged into the shared blocklist that all tab sessions read from | `src/main/filter-list-store.js` |
| Fingerprint resistance | Best-effort JS patches: canvas noise (across `getImageData`/`toDataURL`/`toBlob`), audio-context noise (`AudioBuffer`/`AnalyserNode`), WebGL vendor spoofing, UTC timezone, normalized UA/hardware values (including `navigator.userAgentData`'s Client Hints, not just the classic `User-Agent` string), `screen`/`innerWidth`/`innerHeight` bucketing | `src/preload/privacy-preload.js` |
| Consistent User-Agent across headers and JS | The `User-Agent` HTTP header is normalized per tab session; the `Sec-CH-UA*` Client Hints headers are normalized to match (a mismatch between the two is itself a fingerprinting/bot-detection signal - this was found by hitting a real Cloudflare challenge wall in manual testing) | `src/main/ipc.js`, `src/preload/privacy-preload.js` |
| Popup blocking | `setWindowOpenHandler` on every webview's contents denies all `window.open()`/`target="_blank"` window creation from tab content, enforced in the main process where a page can't touch it. Two earlier renderer-side attempts were silently ineffective (`allowpopups="false"` actually *enables* popups - it's a presence-checked boolean attribute - and the webview `new-window` event no longer exists in modern Electron); see `SECURITY.md` | `src/main/main.js` |
| WebRTC IP-leak protection in tabs | Tab WebRTC is restricted to proxied transports (`setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`) - otherwise a page script could learn the real IP via a STUN request even while the tab's HTTP traffic rides Tor, since WebRTC UDP bypasses the SOCKS proxy. Dago's own Screenshare window is a `BrowserWindow`, not a webview, and is unaffected | `src/main/main.js` |
| No video calls | `getUserMedia` rejects any request with a `video` constraint (both in the injected preload and as a second, main-process enforced check); `getDisplayMedia` is untouched | `src/preload/privacy-preload.js`, `src/main/main.js` |
| PIN-gated history | History is always encrypted at rest via Electron's OS-keychain-backed `safeStorage`; viewing it in the UI additionally requires a PIN (scrypt-verified, never stored in plaintext) | `src/main/history-store.js`, `src/main/pin-store.js` |
| Session-scoped favicon fetching | A tab's favicon is fetched through that *same tab's* session (`session.fromPartition(partition).fetch(url)`), not the chrome window's own default session, then returned to the renderer as a `data:` URL - so showing a tab icon doesn't silently make an unrouted, cookie-unisolated request outside whatever Tor/isolation guarantees that tab's traffic otherwise has | `src/main/ipc.js` (`favicon:fetch`), `src/renderer/renderer.js` |
| Screensharing without calls | `desktopCapturer` + a user-driven source picker + `setDisplayMediaRequestHandler`, wired only into Dago's own Screenshare window, never into tab sessions | `src/main/main.js`, `src/renderer/pages/screenshare.js` |
| Screenshare TURN relay | Optional, user-configured TURN server (encrypted at rest like history) added to the WebRTC `iceServers` list; "force relay" sets `iceTransportPolicy: 'relay'` so no direct/public-IP-revealing candidate is ever negotiated | `src/main/webrtc-relay-store.js`, `src/renderer/pages/screenshare.js` |
| Cosmetic (element-hiding) blocking | `##selector`/`domain##selector` rules from enabled subscriptions are turned into a `<style>` tag injected into each tab's page, scoped to that page's hostname (with `~exclusion` support), via an IPC round-trip from `privacy-preload.js` | `src/main/adblock.js`, `src/preload/privacy-preload.js` |

Other non-privacy features round out normal browser functionality:
bookmarks (`src/main/bookmark-store.js`, no PIN gate - unlike history,
bookmarks aren't treated as sensitive), a download manager
(`src/main/download-manager.js`, attached to every tab session's
`will-download` event, auto-saves with filename de-duplication rather than
prompting per download), and a configurable default search engine
(`src/main/search-provider-store.js` - DuckDuckGo/Startpage/Brave
Search/Mojeek built in, plus any `https://` URL template with a `%s` query
placeholder the user adds; the address bar asks for the active provider's
URL via `search:build-url` rather than hardcoding one).

Filter list subscriptions support more than plain domain rules: the parser
in `filter-list-store.js` also extracts path/wildcard address rules
(`||domain.tld/ads/*^`, bare substrings like `annoying-ads.js`) and cosmetic
rules. These are matched by `compileGlobPattern`/`globSegmentsMatch` in
`adblock.js`, which deliberately avoid `RegExp` entirely in favor of
sequential `String.prototype.indexOf` scanning - an earlier RegExp-based
version turned out to have a real ReDoS vulnerability despite looking safe
on paper (see [`SECURITY.md`](../SECURITY.md) for the full story). Raw
`/regex/` filters from a subscription are still rejected outright rather
than compiled, and most request-type/context options (`$script`, `$xhr`,
`$domain=`, etc.) still aren't implemented - only address matching. The one
option that IS implemented is `$third-party`: a rule scoped with it only
fires when the request's registrable domain differs from the current tab's
top-level page (via `webRequest`'s `details.frame.top.url`), the same
convention real ad-blockers use so a subscription's ad/tracker rules don't
also catch a site's own first-party content. This was added specifically
because ignoring it entirely caused real, reported breakage (see
[`SECURITY.md`](../SECURITY.md)) - most EasyList/EasyPrivacy rules use this
option, so skipping it made a full subscription meaningfully more
trigger-happy than intended. A full Adblock Plus rule engine (the remaining
options) remains tracked in `docs/ROADMAP.md`.

## Screensharing data path

Dago's screenshare feature is peer-to-peer WebRTC. The only server involved
(`signaling-server/server.js`) relays SDP/ICE messages between exactly two
peers by room code and never touches the actual video stream. Anyone can run
their own signaling server; there's no dependency on a Dago-operated service.

By default the WebRTC connection itself is still direct P2P (via a public
STUN server for NAT traversal), which means each peer's public IP address is
visible to the other - inherent to P2P WebRTC, not a signaling-server
concern. Settings lets you point at your own TURN server (e.g. a
self-hosted `coturn` instance) and optionally force all media through it
(`iceTransportPolicy: 'relay'`), so a peer only ever learns the relay's
address instead of yours.

See `docs/THREAT_MODEL.md` for what this design does and doesn't protect
against, and `docs/ROADMAP.md` for what's left before any of this is
production-grade.
