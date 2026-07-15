# Architecture

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

## Privacy layer

| Concern | Mechanism | File |
|---|---|---|
| Anonymized routing | Spawns the system `tor` daemon with N isolated `SocksPort`s; each tab is pinned to one, so tabs don't share circuits the way default Tor Browser tabs can | `src/main/tor-manager.js` |
| New identity | Sends `SIGNAL NEWNYM` over Tor's control port | `src/main/tor-manager.js` |
| Tracker/ad blocking | `webRequest.onBeforeRequest` cancels requests to a known tracker/ad domain list, per tab session; the list is a static built-in set merged live with any enabled filter-list subscriptions | `src/main/adblock.js` |
| Filter list subscriptions | User-added EasyList/EasyPrivacy-style URLs, fetched and parsed only on explicit "Update" (never automatically), cached to disk, and merged into the shared blocklist that all tab sessions read from | `src/main/filter-list-store.js` |
| Fingerprint resistance | Best-effort JS patches: canvas noise (across `getImageData`/`toDataURL`/`toBlob`), audio-context noise (`AudioBuffer`/`AnalyserNode`), WebGL vendor spoofing, UTC timezone, normalized UA/hardware values, `screen`/`innerWidth`/`innerHeight` bucketing | `src/preload/privacy-preload.js` |
| No video calls | `getUserMedia` rejects any request with a `video` constraint (both in the injected preload and as a second, main-process enforced check); `getDisplayMedia` is untouched | `src/preload/privacy-preload.js`, `src/main/main.js` |
| PIN-gated history | History is always encrypted at rest via Electron's OS-keychain-backed `safeStorage`; viewing it in the UI additionally requires a PIN (scrypt-verified, never stored in plaintext) | `src/main/history-store.js`, `src/main/pin-store.js` |
| Screensharing without calls | `desktopCapturer` + a user-driven source picker + `setDisplayMediaRequestHandler`, wired only into Dago's own Screenshare window, never into tab sessions | `src/main/main.js`, `src/renderer/pages/screenshare.js` |
| Screenshare TURN relay | Optional, user-configured TURN server (encrypted at rest like history) added to the WebRTC `iceServers` list; "force relay" sets `iceTransportPolicy: 'relay'` so no direct/public-IP-revealing candidate is ever negotiated | `src/main/webrtc-relay-store.js`, `src/renderer/pages/screenshare.js` |
| Cosmetic (element-hiding) blocking | `##selector`/`domain##selector` rules from enabled subscriptions are turned into a `<style>` tag injected into each tab's page, scoped to that page's hostname (with `~exclusion` support), via an IPC round-trip from `privacy-preload.js` | `src/main/adblock.js`, `src/preload/privacy-preload.js` |

Other non-privacy features round out normal browser functionality:
bookmarks (`src/main/bookmark-store.js`, no PIN gate - unlike history,
bookmarks aren't treated as sensitive) and a download manager
(`src/main/download-manager.js`, attached to every tab session's
`will-download` event, auto-saves with filename de-duplication rather than
prompting per download).

Filter list subscriptions support more than plain domain rules: the parser
in `filter-list-store.js` also extracts path/wildcard address rules
(`||domain.tld/ads/*^`, bare substrings like `annoying-ads.js`) and cosmetic
rules. These are matched by `compileGlobPattern`/`globSegmentsMatch` in
`adblock.js`, which deliberately avoid `RegExp` entirely in favor of
sequential `String.prototype.indexOf` scanning - an earlier RegExp-based
version turned out to have a real ReDoS vulnerability despite looking safe
on paper (see [`SECURITY.md`](../SECURITY.md) for the full story). Raw
`/regex/` filters from a subscription are still rejected outright rather
than compiled, and request-type options (`$third-party`, `$script`, etc.)
aren't implemented - only address matching. A full Adblock Plus rule engine
remains tracked in `docs/ROADMAP.md`.

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
