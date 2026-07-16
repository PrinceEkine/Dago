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
- [x] Popup/popunder blocking: `window.open()` calls from tab content are
      blocked outright instead of auto-opened as a new tab, closing a real
      ad-popunder-and-redirect bug found during manual testing; plus
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

- [ ] Actually bundle verified Tor binaries for desktop (the groundwork
      above exists; someone with network access + a PGP verification step
      needs to run it) - Android already gets this for free via tor-android
- [ ] Per-site popup allow-list, so the blanket `window.open()` block above
      doesn't also break legitimate uses (OAuth login popups, "open in new
      window" buttons) - today it's all-or-nothing
- [ ] Full Adblock Plus filter syntax: request-type options (`$third-party`,
      `$script`, etc.), and a safe way to support at least some of what raw
      `/regex/` filters express without reintroducing ReDoS risk
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
