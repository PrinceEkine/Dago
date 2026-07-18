// Plain Kotlin/JVM module: the ad-block domain/pattern matcher and
// filter-list parser, shared conceptually with the desktop app's
// src/main/adblock.js and src/main/filter-list-store.js (same algorithms,
// ported deliberately rather than auto-translated, with the same safety
// properties from the start - see this module's source comments and
// /SECURITY.md for why those properties matter).
//
// This module only depends on Maven Central (no Android SDK, no Google
// Maven), so unlike :app it's genuinely buildable and testable in any
// environment with plain internet access - `gradle :logic:test` actually
// runs here.
plugins {
    // Bumped from 2.0.0 - tor-android (see app/build.gradle.kts) declares
    // a kotlin-stdlib 2.3.0 dependency, and Gradle's version resolution
    // picks that over an older stdlib requested elsewhere. Leaving this
    // plugin below the resolved stdlib version causes a real "class was
    // compiled with an incompatible version of Kotlin" compile failure -
    // caught by this project's first real CI build (.github/workflows/
    // android.yml), not something visible from :logic alone in isolation.
    kotlin("jvm") version "2.3.0"
}

// Repositories are centrally declared in settings.gradle.kts
// (dependencyResolutionManagement) rather than per-module.

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

kotlin {
    jvmToolchain(21)
}
