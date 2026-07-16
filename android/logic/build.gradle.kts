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
    kotlin("jvm") version "2.0.0"
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
