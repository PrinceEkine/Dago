# Dago

A fast, secure, and highly intuitive web browser designed to simplify how you
navigate the internet. Combining minimalist design with powerful privacy
features, Dago cuts out the clutter to deliver a smooth, lightning-fast
browsing experience tailored to modern web standards.

**Status: pre-alpha.** This repository is an early, working prototype, not a
finished product - see [Status & honesty](#status--honesty) below.

## Why Dago

Most "private" browsers pick one lane: Tor Browser optimizes for anonymity
but ships no tracker blocking or screensharing; Chrome ships everything
except privacy; Brave sits in between. Dago's goal is to be the browser that
doesn't make you choose:

- **Onion-routed by default, with per-tab circuit isolation.** Each tab gets
  its own isolated Tor circuit rather than sharing one - so even within a
  single browsing session, tabs are harder to correlate with each other than
  in default Tor Browser. See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
  for exactly what "more private than Tor" does and doesn't mean here.
- **Built-in tracker & ad blocking**, which vanilla Tor deliberately doesn't
  ship (it prioritizes uniform fingerprints over blocking) - plus optional
  EasyList/EasyPrivacy-style subscriptions you control (nothing is fetched
  until you ask for it).
- **Fingerprint resistance** - canvas noise, normalized hardware/timezone
  signals, spoofed WebGL vendor strings.
- **No video calls, ever.** Camera access is disabled browser-wide - there is
  no code path that can turn it on. This is a deliberate policy, not a
  missing feature.
- **In-app, camera-free screensharing.** Share your screen peer-to-peer with
  another Dago user via a short room code - no account, no camera, no
  microphone - with an optional TURN relay if you don't want to reveal your
  public IP to the other side.
- **PIN-locked history.** Your browsing history is always encrypted at rest,
  and viewing it inside the browser additionally requires a PIN.
- Everything you'd expect from a normal browser - tabs, address bar,
  back/forward, bookmarizable addresses for internal pages - without the
  telemetry.

## Platforms

Dago is two separate codebases sharing a design philosophy, not one
codebase that runs everywhere - Electron (the desktop app in `src/`)
doesn't run on mobile:

- **Desktop** (Windows/macOS/Linux) - `src/`, documented below.
- **Android** - `android/`, a `WebView`-based app with its own README
  (`android/README.md`) covering what's shared with desktop (the ad-block
  and filter-list-parsing algorithms, via a genuinely tested plain-Kotlin
  module), what's architecturally different (one shared Tor circuit instead
  of per-tab isolation, shared cookie storage across tabs, no screensharing
  yet), and what's verified versus not (the shared logic module has real
  passing tests; the Android UI/Tor-service layer is unbuilt in this
  project's own dev environment for the same network-access reasons as the
  Tor-binary and CI notes below).
- **iOS** - not started; see `docs/ROADMAP.md` for why it's a bigger lift
  than Android (Apple requires all iOS browsers to use WebKit specifically,
  and restricts background processes in ways that rule out bundling Tor the
  way Android allows).

## Features in this repo (alpha, desktop)

| Feature | Status |
|---|---|
| Tabbed browsing, address bar, navigation | Working |
| Modern chrome UI (custom title bar, tab favicons, address bar suggestions from bookmarks/history) | Working - see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a verification caveat on the title bar specifically |
| Configurable search engine | Working (DuckDuckGo, Startpage, Brave Search, or Mojeek by default; add your own https:// URL with a `%s` query placeholder in Settings) |
| Tor routing with per-tab isolated circuits + "New Identity" | Working (needs a system Tor install *or* a detected Tor Browser install - see below) |
| Built-in tracker/ad blocking | Working (curated domain list) |
| EasyList/EasyPrivacy subscriptions | Working (add any https:// filter list URL in Settings - domain, path/wildcard, and cosmetic/element-hiding rules; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for what's still not implemented) |
| Fingerprint resistance (canvas/WebGL/timezone/UA, including Client Hints) | Working, best-effort |
| Popup blocking (blocks `window.open()`-based popups/popunders by default) | Working - trade-off: legitimate popups like OAuth logins are blocked too, see [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| No-camera policy (video calls disabled everywhere) | Working |
| Screensharing (screen-only, peer-to-peer, room code) | Working (needs a signaling server - one-command to self-host) |
| Optional TURN relay for screensharing | Working (configure in Settings; "force relay" hides both peers' public IPs) |
| PIN-gated, encrypted-at-rest history | Working |
| Bookmarks and a download manager | Working |
| Browser extension support | Not yet - see [`docs/ROADMAP.md`](docs/ROADMAP.md) |

Full architecture write-up: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
What this alpha actually protects against (and what it doesn't):
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Getting started

Requirements: [Node.js](https://nodejs.org/) 18+, and Tor for onion routing
(Dago runs without it, just without Tor circuits - the status bar tells you
which mode you're in). Dago looks for Tor in this order, so you don't
necessarily need a separate install:

1. A system-wide [`tor`](https://www.torproject.org/) daemon on your `PATH`.
2. A [Tor Browser](https://www.torproject.org/download/) install at its
   default location, if you already have one - Tor Browser bundles its own
   copy of `tor` but keeps it off PATH by design (it's meant to be launched
   only by Tor Browser), so Dago detects common install paths itself instead
   of requiring you to install Tor twice.

If neither is found, the status bar shows "Tor: unavailable" and tabs fall
back to a direct (non-Tor) connection.

```bash
npm install
npm start
```

To try the screensharing feature, run a signaling server (yours, a
friend's, or your own deployment - there's no Dago-operated one):

```bash
npm run signaling-server
```

Then point both the sharer's and viewer's Screenshare window at that
server's address. By default the actual video connects directly
peer-to-peer, revealing both sides' public IP to each other; if you'd rather
not, configure a TURN server (e.g. a self-hosted `coturn`) under Settings and
enable "force relay" to route through it instead.

## Status & honesty

This is a solo/small-team, low-budget effort. Building a full browser engine
from scratch is a multi-year, industry-scale undertaking (see Chromium or
Firefox) - Dago is realistic about that and builds on Electron/Chromium
rather than reinventing rendering, focusing its own engineering on the
privacy layer described above. What's in this repo runs and does what the
table above says, but it is **unaudited alpha software**: don't rely on it
for high-stakes anonymity yet (use Tor Browser for that today), and expect
rough edges. See [`SECURITY.md`](SECURITY.md) for how to report issues and
for an honest account of what an internal self-review has (and hasn't)
caught so far - it's explicitly not a substitute for the independent audit
this project still needs.

CI (`.github/workflows/build.yml`) and Tor-binary-bundling groundwork
(`scripts/fetch-tor-binaries.js`) exist in this repo, but neither is fully
wired up yet: there are no code-signing certificates configured (that costs
real money - see below), and no Tor binaries are bundled because this
project's own dev environment has no network access to fetch and verify
them. Builds today are unsigned, and onion routing still requires either a
system Tor install or an existing Tor Browser install for Dago to detect.
`docs/RELEASING.md` and `docs/ROADMAP.md` cover what's left.

## Support Dago

Dago is currently built on a shoestring budget. If you believe in a browser
that's private by default *and* still pleasant to use, here's how to help:

- **Contribute code or review** - the roadmap in
  [`docs/ROADMAP.md`](docs/ROADMAP.md) is the priority list; PRs and security
  reviews (especially of the Tor integration and fingerprinting code) are
  the highest-leverage help right now.
- **Fund development** - development time, infrastructure (build servers,
  code signing certificates), and a future independent security audit all
  cost money that a volunteer effort can't easily cover alone. You can
  sponsor Dago directly via
  [GitHub Sponsors](https://github.com/sponsors/PrinceEkine).
- **Spread the word** - star the repo, share it with people who care about
  privacy, and file issues for bugs or missing features.

Every bit of funding or contribution moves items up the roadmap faster,
particularly the security audit, which is the item this project needs most
before anyone should treat its privacy claims as more than "promising alpha."

## License

MIT - see [`LICENSE`](LICENSE).
