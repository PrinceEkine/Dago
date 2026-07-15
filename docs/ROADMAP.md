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

## Next

- [ ] Actually bundle verified Tor binaries (the groundwork above exists;
      someone with network access + a PGP verification step needs to run it)
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

## Later

- [ ] Mobile builds (Android first)
- [ ] Optional bridges/pluggable transports for censored networks
- [ ] Sync (opt-in, end-to-end encrypted, self-hostable relay)

Contributions and funding both directly move items up this list - see the
README's "Support Dago" section.
