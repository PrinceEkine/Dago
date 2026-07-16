pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "dago-android"

// :logic is plain Kotlin/JVM (only needs Maven Central) and is genuinely
// buildable/testable anywhere, including this project's own dev sandbox.
// :app is a real Android application module that needs the Android SDK
// (from Google's Maven/dl.google.com - see android/README.md for why that
// couldn't be verified in this repo's own sandbox). Gradle resolves a
// module's declared plugins during project configuration even for
// unrelated tasks like `:logic:test`, so :app has to be excluded from the
// build entirely - not just left untouched - whenever no Android SDK is
// configured, or it would break every command in this whole project,
// including ones that only touch :logic. This mirrors how contributors
// without a full Android Studio setup are expected to work on this repo.
val hasAndroidSdk = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }

include(":logic")
if (hasAndroidSdk) {
    include(":app")
} else {
    logger.warn(
        "No Android SDK detected (set ANDROID_HOME or create android/local.properties " +
        "with sdk.dir=...) - excluding :app from this build. :logic still builds/tests normally."
    )
}
