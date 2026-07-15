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

## Next

- [ ] Bundle a pinned, verified Tor binary per platform instead of requiring
      a system install
- [ ] Full Adblock Plus filter syntax (path/regex rules, cosmetic/element
      hiding) - the current subscription parser only extracts domain-level
      `||domain^` and `@@||domain^` rules, not the full EasyList rule set
- [ ] Bookmarks, download manager, extension support
- [ ] Reproducible builds + signed releases for Windows/macOS/Linux
- [ ] Independent security audit of the Tor integration and
      privacy-preload sandboxing

## Later

- [ ] Mobile builds (Android first)
- [ ] Optional bridges/pluggable transports for censored networks
- [ ] Sync (opt-in, end-to-end encrypted, self-hostable relay)

Contributions and funding both directly move items up this list - see the
README's "Support Dago" section.
