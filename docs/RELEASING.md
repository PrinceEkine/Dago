# Releasing

`.github/workflows/build.yml` builds installable artifacts (Windows `.exe`,
macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`) via `electron-builder` on every
`v*.*.*` tag push, or on demand from the Actions tab. This repo does not ship
any signing keys or certificates - none exist here to ship - so builds are
**unsigned** until a maintainer adds them.

## What "reproducible" means here (and doesn't, yet)

- The Node version is pinned (`.nvmrc`), dependencies are locked
  (`package-lock.json`), and the build runs in a clean CI container - so the
  same tag should produce the same output given the same CI image.
- What's still missing for a stronger reproducibility guarantee: deterministic
  timestamps in the packaged app, a documented/pinned CI runner image
  version, and independent rebuild verification (someone else building the
  same tag and diffing the result). Tracked in `docs/ROADMAP.md`.

## Enabling code signing

Nothing needs to change in this repo's code - electron-builder reads these
as environment variables automatically. Add them under **Settings > Secrets
and variables > Actions** in GitHub:

**macOS** (requires an active Apple Developer Program membership):
- `CSC_LINK` - base64-encoded `.p12` certificate export
- `CSC_KEY_PASSWORD` - that certificate's password
- `APPLE_ID`, `APPLE_ID_PASSWORD` (an app-specific password, not your real
  Apple ID password), `APPLE_TEAM_ID` - for notarization, required for the
  app to run without a Gatekeeper warning on modern macOS

**Windows**:
- `WIN_CSC_LINK` - base64-encoded code-signing certificate
- `WIN_CSC_KEY_PASSWORD` - that certificate's password

None of the above are obtainable without a maintainer's real identity and
money (Apple Developer Program is $99/year; Windows code-signing
certificates from a CA are a recurring cost too) - this is explicitly one of
the funding asks in the README, not something that can be worked around.

Once secrets are set, re-run the workflow - no other changes needed.
