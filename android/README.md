# Dago for Android

A separate app from the desktop Electron browser in `../src/` - Electron
doesn't run on mobile, so this shares Dago's privacy design and, where
possible, its actual algorithms, but is a distinct codebase using Android's
own `WebView` as the rendering engine instead of Chromium-via-Electron.

## What's genuinely verified here, and what isn't

This is a multi-module Gradle project split deliberately along a
verifiability line:

- **`:logic`** is plain Kotlin/JVM with zero Android dependencies - just the
  ad-block domain/pattern matcher and filter-list parser, ported from the
  desktop app's `src/main/adblock.js` and `src/main/filter-list-store.js`.
  It only needs Maven Central, so it's genuinely buildable and testable
  *anywhere*, including this repo's own dev sandbox: `gradle :logic:test`
  (or `./gradlew :logic:test` once you have real network access - see
  "Building" below) actually runs 12 real JUnit tests, including a
  regression test for the exact ReDoS and ad-block-bypass bugs described in
  `/SECURITY.md`, ported with both fixes baked in from the start rather than
  needing to be rediscovered.
- **`:app`** is the real Android application - `WebView`-based tabs, the
  Tor-routing service, PIN-gated history, bookmarks, downloads, settings.
  It needs the actual Android SDK (`compileSdk`, `aapt2`, `d8`), which comes
  from Google's Maven (`dl.google.com` / `maven.google.com`, which redirects
  there) - and a direct HTTPS check to that host from this project's dev
  sandbox came back **403 (blocked by egress policy)**, confirmed the same
  way the desktop app's Electron binary download and Tor binary fetch were
  confirmed blocked earlier in this project's history. So `:app` has never
  been built or run in this repository. It was written as carefully as
  possible without that feedback loop:
  - Every `R.id`/`R.layout`/`R.string` reference was cross-checked by hand
    against what's actually declared in `res/`, since `aapt2` couldn't do
    that automatically here.
  - The Tor library's actual public API (`org.torproject.jni.TorService`,
    `net.freehaven.tor.control.TorControlConnection`) was verified by
    downloading the real published AAR/JAR from Maven Central and running
    `javap` against the compiled classes - not written from memory - before
    `DagoTorController.kt` was written against it.
  - `settings.gradle.kts` excludes `:app` from the build entirely (not just
    "best effort ignore it") when no Android SDK is configured, specifically
    so `:logic:test` keeps working for anyone without a full Android Studio
    setup - Gradle resolves a module's plugins during project configuration
    even for unrelated tasks, so leaving `:app` included would break
    `:logic` too.

If you have normal internet access (i.e., you are not this specific
sandboxed dev environment), `:app` should build normally in Android Studio
or via `./gradlew :app:assembleDebug` once `local.properties` points at an
installed SDK. Please open an issue if it doesn't - that would be a real bug
report, since this really hasn't been build-verified locally.

**`.github/workflows/android.yml`** now builds `:app` for real on every push
to `main` that touches `android/` - GitHub's own runners have the normal
internet access this project's dev sandbox doesn't, so that workflow is the
actual first real build-verification of this module, not just careful code
review. Check the Actions tab for its current status; a green run there is a
stronger claim than anything in this file, since it's an outside process
actually invoking `aapt2`/`d8`/the real Android Gradle Plugin rather than a
human reading the source. It uploads a debug APK as a downloadable artifact
too - see "Installing on a phone" below.

## How this differs from the desktop app (architecture, not bugs)

Android's platform constraints mean some of Dago's desktop privacy design
can't carry over unchanged. These are deliberate, documented trade-offs:

| Concern | Desktop (Electron) | Android |
|---|---|---|
| Rendering engine | Chromium via Electron | Android system `WebView` |
| Tor circuits | Each tab gets its own isolated `SocksPort`/circuit | **One shared circuit for the whole app** - `androidx.webkit.ProxyController` sets one proxy for the entire process, with no per-`WebView` equivalent. "New Identity" (`NEWNYM`) still works, but doesn't isolate tabs from each other the way desktop does. |
| Tor binary | Requires a system `tor` install, or a maintainer-run fetch script (see `../scripts/fetch-tor-binaries.js`) | **Bundled automatically** - `tor-android` ships verified prebuilt binaries for Android ABIs directly in its AAR. This is actually a win over desktop's current state. |
| Tab cookie/storage isolation | Each tab is a separate, non-persistent Electron session (`session.fromPartition`) | **Shared** - `WebView` has one process-wide `CookieManager`/storage; there's no built-in equivalent of Electron's per-tab session partitions. All tabs share cookies and site storage here. |
| Fingerprint resistance | `privacy-preload.js` via Electron's `preload` guarantee | Same script (`assets/privacy-preload.js`, cosmetic-hiding section replaced with a native equivalent - see `CosmeticHiding.kt`), injected via `WebViewCompat.addDocumentStartJavaScript` - not supported on every WebView version; falls back to a logged no-op rather than crashing, see `WebViewInjection.kt`. |
| Camera/video-call block | Denied in the main process permission handler + JS override | Denied in `PrivacyWebChromeClient.onPermissionRequest` + the same JS override |
| History PIN | scrypt-derived verifier | PBKDF2WithHmacSHA256-derived verifier (Java's built-in KDF - avoids pulling in a scrypt implementation as an unverifiable dependency here) |
| Screensharing | Peer-to-peer WebRTC feature with optional TURN relay | **Not implemented on Android in this pass.** Screen capture on Android needs the `MediaProjection` API plus its own foreground service, which is enough of a distinct undertaking to be a separate roadmap item rather than something ported alongside everything else here. |
| Downloads | Custom download-manager.js (Electron has no OS-level download service) | Delegates to Android's own `DownloadManager` system service - it already handles progress, retries, and notifications, so there's no need to reimplement that here. |
| Search engine | Configurable (DuckDuckGo/Startpage/Brave Search/Mojeek + custom `%s`-template URLs), via `search-provider-store.js` | Same feature, same defaults - `SearchProviderStore.kt` (`SharedPreferences`-backed) |

See `../docs/THREAT_MODEL.md` for the full privacy/security picture across
both apps, and `../SECURITY.md` for the security self-review disclosure
(not an independent audit - same caveat as the rest of this project).

## Building

You'll need:

1. An installed Android SDK (Android Studio's SDK manager is the easiest
   way, or the standalone `cmdline-tools`). Point `android/local.properties`
   at it (`sdk.dir=/path/to/sdk`) or set `ANDROID_HOME`.
2. Real internet access - `dl.google.com`/`maven.google.com` for the
   Android Gradle Plugin and AndroidX libraries, and Maven Central for
   everything else (including `:logic`'s dependencies and `tor-android`).

Then:

```bash
cd android
./gradlew :app:assembleDebug
```

(This repo's own dev sandbox can't run that last command - see above - but
`./gradlew :logic:test` works anywhere, including here.)

## Installing on a phone

Two options, depending on whether you want to build it yourself:

1. **Download the CI-built APK (easiest).** Go to the repo's Actions tab -\>
   `Android` workflow -\> the most recent successful run -\> download the
   `dago-android-debug` artifact, which contains an unsigned debug APK. On
   your phone, enable "install from unknown sources" (or "install unknown
   apps" for the app you use to open it, e.g. your file manager or browser),
   transfer the APK over, and tap it to install. This is a debug build, not
   a signed release - expect Android to warn you about that, and treat it
   as alpha-quality since it hasn't had a real device smoke test yet either.
2. **Build it yourself** with Android Studio (open the `android/` folder,
   let it sync, then Run with your phone connected over USB with developer
   mode/USB debugging enabled), or via the command line as described above
   and then `adb install app/build/outputs/apk/debug/app-debug.apk`.

Either way, please open an issue with what you find - this really is the
first time this app has been installed on real hardware.

## Known gaps versus the desktop app

- No screensharing (see table above).
- No browser extension support (not on desktop yet either).
- No bookmarks/history/downloads sync between tabs opened in quick
  succession beyond a simple in-memory list - this is an MVP, not a
  polished release.
- The Tor "force relay"/TURN-relay screensharing settings from desktop
  don't apply here since there's no screensharing feature yet to configure.
