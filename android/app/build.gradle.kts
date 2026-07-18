// This module needs the Android SDK (compileSdk/android.jar, aapt2,
// d8/dex), which this project's own dev sandbox can't fetch - a direct
// check to dl.google.com came back 403 from the sandbox's network egress
// policy, and Google's Maven (maven.google.com) redirects there for actual
// artifact bytes too. See android/README.md. Everything here is written to
// be correct, including dependency coordinates verified against real Maven
// Central metadata (see that file's history for how), but the module
// itself has not been built in this repository.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application") version "8.5.0"
    // Bumped from 2.0.0 to match tor-android's transitive kotlin-stdlib
    // 2.3.0 dependency - see the matching comment in logic/build.gradle.kts
    // and the tor-android version pin comment below for the full story.
    id("org.jetbrains.kotlin.android") version "2.3.0"
}

android {
    namespace = "org.dago.browser"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.dago.browser"
        // 26 (Android 8.0) - the minimum for reliable foreground services,
        // which the bundled Tor process needs to keep running.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-alpha"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
    }
}

// The old `android { kotlinOptions { jvmTarget = "17" } }` shorthand became a
// hard compile error in the Kotlin Gradle Plugin bundled with this project's
// bumped 2.3.0 version (see the plugin version comment above) - it's not
// just deprecated, the DSL was removed. Confirmed the replacement API for
// real by downloading and inspecting the actual kotlin-gradle-plugin-api
// 2.3.0 JAR from Maven Central via javap, rather than guessing at
// post-cutoff Kotlin API changes from memory.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":logic"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.webkit:webkit:1.11.0")
    // EncryptedSharedPreferences - mirrors desktop's safeStorage-encrypted
    // history store, backed here by the Android Keystore instead of an OS
    // keychain.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")

    // Tor for Android, published by the Guardian Project (Orbot's/Tor
    // Browser for Android's underlying tooling). Coordinates and the real
    // public API surface (org.torproject.jni.TorService,
    // net.freehaven.tor.control.TorControlConnection) were verified against
    // the actual published AAR/JAR from Maven Central before writing
    // DagoTorController.kt - see that file's doc comment.
    //
    // Pinned to 0.4.9.5, not the newest release (0.4.9.11 at the time of
    // writing): this project's first real CI build (.github/workflows/
    // android.yml, which has actual internet access this repo's own dev
    // sandbox doesn't) failed on `:app:checkDebugAarMetadata` because every
    // tor-android release from 0.4.9.6 onward declares `minCompileSdk=36`
    // or `37` in its AAR metadata, while this project's AGP 8.5.0 only
    // supports compileSdk up to 34. Confirmed directly by downloading and
    // inspecting META-INF/com/android/build/gradle/aar-metadata.properties
    // from several real published versions on Maven Central - 0.4.9.5 is
    // the newest one with no such constraint (minCompileSdk=1). Re-verified
    // via javap that its TorService/LocalBinder/TorControlConnection API
    // surface is unchanged from what DagoTorController.kt was written
    // against (jtorctl stays at 0.4.5.7 as a transitive dependency either
    // way). Upgrading past this needs bumping AGP/compileSdk together,
    // which needs real access to Google's Maven to verify version
    // compatibility - tracked in docs/ROADMAP.md.
    implementation("info.guardianproject:tor-android:0.4.9.5")
}
