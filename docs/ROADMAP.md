# Roadmap

Dago is pre-alpha. This is a rough, honest ordering of what's next, not a
committed timeline - pace depends heavily on funding and contributors (see
the README).

## Now (alpha, this repo)

- [x] Electron shell: tabs, address bar, back/forward/reload
- [x] Per-tab Tor circuit isolation (multiple isolated `SocksPort`s + "New
      Identity")
- [x] Built-in tracker/ad domain blocking
- [x] Best-effort fingerprint resistance (canvas noise, WebGL/timezone/UA
      normalization)
- [x] PIN-gated history viewer, encrypted at rest via OS keychain
- [x] Camera blocked everywhere; peer-to-peer screen-only sharing feature
- [x] Full EasyList/EasyPrivacy subscription support (user-controlled update
      cadence, no silent background fetch)
- [x] Canvas noise extended to all three extraction vectors (`getImageData`,
      `toDataURL`, `toBlob`) plus new audio-context fingerprint resistance
      (`AudioBuffer`/`AnalyserNode` noise) and `innerWidth`/`innerHeight`
      bucketing alongside the existing `screen.width`/`height` bucketing
- [x] Optional TURN relay for screensharing (user-configured, encrypted at
      rest), with a "force relay" mode that hides both peers' public IPs
- [x] Bookmarks (star toggle, bookmarks page) and a download manager
      (auto-save with de-duplication, open/show-in-folder/cancel)
- [x] Extended filter-list syntax: path/wildcard address rules and
      cosmetic (element-hiding) rules, matched with a custom
      backtracking-free scanner - not the full Adblock Plus rule set
      (still no request-type options like `$third-party`, no raw `/regex/`
      filters - see `src/main/adblock.js`'s doc comments for why)
- [x] Tor-binary bundling *groundwork*: `scripts/fetch-tor-binaries.js` +
      `resources/tor/manifest.json` + `tor-manager.js` preferring a bundled
      binary. No binaries are actually bundled yet - this dev environment
      has no network access to `dist.torproject.org` (confirmed blocked),
      so a maintainer with real access and the ability to verify the Tor
      Project's PGP signature has to run the fetch script at least once.
      Still effectively a system-Tor requirement until that happens.
- [x] CI build scaffolding (`.github/workflows/build.yml`,
      `docs/RELEASING.md`) that produces unsigned Windows/macOS/Linux
      installers and signs them automatically once a maintainer adds real
      certificate secrets. No certificates exist in this project yet -
      that's a real cost (~$99/yr Apple Developer Program alone), part of
      the funding ask in the README.
- [x] Internal security self-review pass - see [`SECURITY.md`](../SECURITY.md)
      for what it found (including a real, pre-merge bypass of ad/tracker
      blocking) and, importantly, why it is explicitly *not* a substitute
      for the independent audit below.
- [x] EasyList/EasyPrivacy on by default: previously a user had to visit
      Settings, add the list, enable it, and press Update before getting
      real ad/tracker blocking beyond the small built-in domain list - full
      protection now works out of the box. Dago's own two hardcoded default
      lists are enabled from a fresh install and auto-fetched on startup
      (once, then re-fetched if more than a week stale via
      `FilterListStore.autoUpdateDefaults()`); any *other* list a user adds
      themselves is unaffected and still requires an explicit enable +
      Update, since that's a URL supplying arbitrary third-party
      infrastructure rather than a project-vetted default - see
      `docs/THREAT_MODEL.md` for the trust reasoning. The status pill now
      also reports the real active rule count instead of always showing the
      34-domain built-in figure regardless of what's actually loaded
- [x] Screensharing improvements: multiple viewers per room (one
      `RTCPeerConnection` per viewer, capped at 8 to protect the host's
      upload bandwidth), visible connection status with a best-effort
      auto-recovery attempt on ICE failure, quality presets, and a room-code
      copy button. Camera/microphone are still never used anywhere in this
      feature - see the README's no-video-call policy. Found and fixed
      along the way: every inline `style="..."` attribute across the
      utility pages (Settings, Screenshare) had been silently no-op'd since
      each page's own CSP (`style-src 'self'`) blocks inline styles outright
      - Chromium drops them with no visible error, so this had been quietly
      broken since those pages were first built. Replaced with real CSS
      classes in `pages.css`
- [x] Chrome UI overhaul: a hand-built inline-SVG icon set replacing unicode
      glyphs (inconsistent across platforms/fonts), tab favicons (fetched
      through that tab's own session, never the chrome's default session -
      see `docs/ARCHITECTURE.md`) with a loading spinner and letter-fallback,
      an address bar suggestions dropdown from bookmarks/history, and a
      custom frameless title bar merging the OS frame with the tab strip
      (native traffic lights kept on macOS via `titleBarStyle:
      'hiddenInset'`, custom minimize/maximize/close on Windows/Linux).
      Verified via Electron API cross-checks and real-Chromium
      Playwright rendering with a mocked bridge, not a live window on a
      real OS - this dev environment can't launch Electron itself
- [x] `$third-party` filter-option support: enabling a full EasyList/
      EasyPrivacy subscription was blocking normal site loading, not just
      ads, because every other filter option was already (and still is)
      discarded, and most real-world rules rely on `$third-party` scoping
      specifically to avoid matching a site's own first-party content. Now
      parsed and honored (skipped when the request is same-site as the
      current tab's top-level page); all other options remain unimplemented
      - see `src/main/adblock.js` and `SECURITY.md` for the full story
- [x] Tor Browser auto-detection as a fallback binary source: a user with
      only Tor Browser installed (no separate system Tor) previously always
      got "Tor: unavailable", because Tor Browser deliberately keeps its
      bundled `tor` off PATH. Dago now checks common per-OS Tor Browser
      install locations if PATH lookup fails, verified with a functional
      test against a simulated Tor Browser directory layout (this sandbox
      has no system Tor at all, making it a clean test of the fallback path
      specifically)
- [x] Popup/popunder blocking: `window.open()` calls from tab content are
      denied via a main-process `setWindowOpenHandler`, closing a real
      ad-popunder-and-redirect bug found during manual testing (it took two
      tries - the first fix targeted a webview event that no longer exists
      in modern Electron and never fired; see `SECURITY.md`); plus WebRTC
      in tabs restricted to proxied transports so page scripts can't learn
      the real IP via STUN while Tor-routed; plus
      `Sec-CH-UA*` Client Hints (headers and `navigator.userAgentData` in
      JS) normalized to match the spoofed `User-Agent`, closing a
      fingerprint inconsistency traced to a real Cloudflare challenge wall
      hit during that same testing
- [x] Android app (`android/`) - a separate codebase (Electron doesn't run
      on mobile), sharing the ad-block/filter-parser algorithms via a
      genuinely tested plain-Kotlin `:logic` module, plus WebView-based
      tabs, Tor routing (via the Guardian Project's `tor-android`, which
      conveniently bundles its own verified binaries - no system Tor
      install needed, unlike desktop today), camera blocking, and
      PIN-gated history/bookmarks/downloads/settings. The app module
      itself is unbuilt/unverified here (needs the Android SDK, which
      needs `dl.google.com` - confirmed blocked, same as the Tor/Electron
      binary hosts) - see `android/README.md` for the full verification
      story and the real architectural differences from desktop (one
      shared Tor circuit instead of per-tab isolation, shared cookie
      storage across tabs, no screensharing yet).

## Next

- [ ] Extend the custom title bar/icon set to the utility windows (History/
      Settings/Screenshare/Bookmarks/Downloads) - they still use the default
      OS window frame, a deliberate scope cut for the initial chrome
      overhaul rather than an oversight
- [ ] Actually bundle verified Tor binaries for desktop (the groundwork
      above exists; someone with network access + a PGP verification step
      needs to run it) - Android already gets this for free via tor-android
- [ ] Per-site popup allow-list, so the blanket `window.open()` block above
      doesn't also break legitimate uses (OAuth login popups, "open in new
      window" buttons) - today it's all-or-nothing
- [ ] Remaining Adblock Plus filter options: `$third-party` is implemented
      (see "Now" above); resource-type options (`$script`, `$image`, `$xhr`,
      etc.) and `$domain=` scoping are still ignored, and a safe way to
      support at least some of what raw `/regex/` filters express without
      reintroducing ReDoS risk remains unsolved
- [ ] Browser extension support (a WebExtensions-compatible API surface) -
      not attempted yet; this is a much larger undertaking than the other
      "Next" items, closer in scope to a second browser feature
- [ ] Real code signing once a maintainer funds/owns the certificates
- [ ] Independent security audit by a paid third party - the self-review
      above is real work, but it's still the same people who wrote the
      code checking their own code
- [ ] Build-verify the Android `:app` module (needs a maintainer with an
      installed Android SDK - see `android/README.md`) and get a real
      device/emulator smoke test done
- [ ] Android screensharing (needs `MediaProjection` + its own foreground
      service - a distinct undertaking from the WebRTC approach on desktop)

## Later

- [ ] iOS app - a third codebase again: Apple requires all iOS browsers to
      use WebKit specifically (no Chromium/Gecko/custom engines allowed),
      and iOS's background-process restrictions rule out running a bundled
      Tor daemon the way Android's foreground service allows, so this would
      need real design work, not just a port. Also requires a paid Apple
      Developer account and a Mac to build/submit from.
- [ ] Optional bridges/pluggable transports for censored networks
- [ ] Sync (opt-in, end-to-end encrypted, self-hostable relay)

Contributions and funding both directly move items up this list - see the
README's "Support Dago" section.
