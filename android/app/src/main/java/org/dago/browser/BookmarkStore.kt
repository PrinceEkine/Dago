package org.dago.browser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Plain (unencrypted) local storage, matching the desktop app's
 * bookmark-store.js decision that bookmarks aren't sensitive the way
 * browsing history is - no PIN gate here.
 */
class BookmarkStore(context: Context) {
    data class Bookmark(val id: String, val url: String, val title: String, val createdAt: Long)

    private val prefs = context.getSharedPreferences("dago_bookmarks", Context.MODE_PRIVATE)

    fun list(): List<Bookmark> {
        val raw = loadRaw()
        val result = mutableListOf<Bookmark>()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            result.add(Bookmark(obj.getString("id"), obj.getString("url"), obj.getString("title"), obj.getLong("createdAt")))
        }
        return result.sortedByDescending { it.createdAt }
    }

    fun isBookmarked(url: String): Boolean {
        val raw = loadRaw()
        return (0 until raw.length()).any { raw.getJSONObject(it).getString("url") == url }
    }

    fun add(url: String, title: String): Boolean {
        if (url.isBlank() || isBookmarked(url)) return false
        val raw = loadRaw()
        raw.put(
            JSONObject()
                .put("id", UUID.randomUUID().toString())
                .put("url", url)
                .put("title", title.ifBlank { url })
                .put("createdAt", System.currentTimeMillis())
        )
        persist(raw)
        return true
    }

    fun removeByUrl(url: String) = removeWhere { it.getString("url") == url }

    fun removeById(id: String) = removeWhere { it.getString("id") == id }

    private fun removeWhere(predicate: (JSONObject) -> Boolean) {
        val raw = loadRaw()
        val rebuilt = JSONArray()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            if (!predicate(obj)) rebuilt.put(obj)
        }
        persist(rebuilt)
    }

    private fun loadRaw(): JSONArray {
        val raw = prefs.getString("entries", null) ?: return JSONArray()
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }

    private fun persist(entries: JSONArray) {
        prefs.edit().putString("entries", entries.toString()).apply()
    }
}
