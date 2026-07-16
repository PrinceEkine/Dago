package org.dago.browser

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Mirrors the desktop app's pin-store.js: a PIN gates *viewing* history in
 * the UI, verified via a salted hash that's never stored or derivable back
 * to the PIN itself. Uses PBKDF2WithHmacSHA256 (part of the standard Java
 * crypto providers) rather than desktop's scrypt - pulling in a scrypt
 * implementation would be another dependency this sandbox has no way to
 * verify, and PBKDF2 with a high iteration count is still a reasonable,
 * standard choice for this.
 */
class PinStore(context: Context) {
    private val prefs = context.getSharedPreferences("dago_pin", Context.MODE_PRIVATE)

    var unlocked = false
        private set

    fun isSet(): Boolean = prefs.contains("salt")

    fun setPin(pin: String): Boolean {
        if (pin.length < 4) return false
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val verifier = derive(pin, salt)
        prefs.edit()
            .putString("salt", Base64.getEncoder().encodeToString(salt))
            .putString("verifier", Base64.getEncoder().encodeToString(verifier))
            .apply()
        unlocked = true
        return true
    }

    fun verify(pin: String): Boolean {
        val saltB64 = prefs.getString("salt", null) ?: return false
        val verifierB64 = prefs.getString("verifier", null) ?: return false
        val salt = Base64.getDecoder().decode(saltB64)
        val expected = Base64.getDecoder().decode(verifierB64)
        val actual = derive(pin, salt)
        val match = MessageDigest.isEqual(actual, expected)
        if (match) unlocked = true
        return match
    }

    fun lock() {
        unlocked = false
    }

    fun reset() {
        prefs.edit().clear().apply()
        unlocked = false
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, 120_000, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }
}
