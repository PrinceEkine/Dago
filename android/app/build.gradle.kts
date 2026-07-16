// This module needs the Android SDK (compileSdk/android.jar, aapt2,
// d8/dex), which this project's own dev sandbox can't fetch - a direct
// check to dl.google.com came back 403 from the sandbox's network egress
// policy, and Google's Maven (maven.google.com) redirects there for actual
// artifact bytes too. See android/README.md. Everything here is written to
// be correct, including dependency coordinates verified against real Maven
// Central metadata (see that file's history for how), but the module
// itself has not been built in this repository.
plugins {
    id("com.android.application") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "2.0.0"
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

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
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
    implementation("info.guardianproject:tor-android:0.4.9.11")
}
