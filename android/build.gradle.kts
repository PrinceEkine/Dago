// Intentionally minimal. Per-module plugins/config live in each module's
// own build.gradle.kts - notably, the Android application plugin is
// declared only in app/build.gradle.kts, not here, because :app itself is
// conditionally excluded from the build (see settings.gradle.kts) when no
// Android SDK is configured. Declaring it at the root would force Gradle to
// resolve it from Google's Maven during project configuration regardless of
// which module a command targets, breaking `:logic:test` too.
