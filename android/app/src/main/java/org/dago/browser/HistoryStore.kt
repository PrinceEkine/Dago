package org.dago.browser

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

private const val MAX_ENTRIES = 20_000

/**
 * Mirrors the desktop app's history-store.js: history is always encrypted
 * at rest - there, via OS-keychain-backed `safeStorage`; here, via the
 * Android Keystore-backed `EncryptedSharedPreferences` - independent of the
 * PIN, so recording keeps working in the background without prompting.
 * [PinStore] separately gates *viewing* history in the UI.
 */
class HistoryStore(context: Context) {
    data class Entry(val url: String, val title: String, val timestamp: Long)

    private val prefs = run {
        val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context,
            "dago_history",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun record(url: String, title: String) {
        if (url.isBlank() || url == "about:blank") return
        val entries = loadRaw()
        entries.put(
            JSONObject()
                .put("url", url)
                .put("title", title)
                .put("timestamp", System.currentTimeMillis())
        )
        while (entries.length() > MAX_ENTRIES) entries.remove(0)
        persist(entries)
    }

    /** Newest first. */
    fun list(): List<Entry> {
        val raw = loadRaw()
        val result = mutableListOf<Entry>()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            result.add(Entry(obj.getString("url"), obj.getString("title"), obj.getLong("timestamp")))
        }
        return result.reversed()
    }

    fun removeEntry(displayIndex: Int) {
        val raw = loadRaw()
        val reversedIdx = raw.length() - 1 - displayIndex
        if (reversedIdx !in 0 until raw.length()) return
        val rebuilt = JSONArray()
        for (i in 0 until raw.length()) if (i != reversedIdx) rebuilt.put(raw.get(i))
        persist(rebuilt)
    }

    fun clear() {
        prefs.edit().remove("entries").apply()
    }

    private fun loadRaw(): JSONArray {
        val raw = prefs.getString("entries", null) ?: return JSONArray()
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }

    private fun persist(entries: JSONArray) {
        prefs.edit().putString("entries", entries.toString()).apply()
    }
}
