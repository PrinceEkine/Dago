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

## Next

- [ ] Bundle a pinned, verified Tor binary per platform instead of requiring
      a system install
- [ ] Proper canvas/audio-context letterboxing instead of point-noise
- [ ] TURN relay support for screenshare so it doesn't require direct
      P2P connectivity or leak public IP to the peer
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
