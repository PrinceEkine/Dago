package org.dago.browser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/**
 * Android counterpart to the desktop app's search-provider-store.js: lets
 * the user choose which search engine the address bar submits non-URL
 * input to, and add their own (any https:// URL template with a %s query
 * placeholder). DuckDuckGo remains the default.
 */
class SearchProviderStore(context: Context) {
    data class Provider(val id: String, val name: String, val urlTemplate: String, val builtIn: Boolean, val active: Boolean)

    companion object {
        private val DEFAULT_PROVIDERS = listOf(
            Triple("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q=%s"),
            Triple("startpage", "Startpage", "https://www.startpage.com/sp/search?query=%s"),
            Triple("brave", "Brave Search", "https://search.brave.com/search?q=%s"),
            Triple("mojeek", "Mojeek", "https://www.mojeek.com/search?q=%s"),
        )
    }

    private val prefs = context.getSharedPreferences("dago_search_providers", Context.MODE_PRIVATE)

    init {
        if (!prefs.contains("providers")) {
            val defaults = JSONArray()
            for ((id, name, url) in DEFAULT_PROVIDERS) {
                defaults.put(JSONObject().put("id", id).put("name", name).put("urlTemplate", url).put("builtIn", true))
            }
            prefs.edit().putString("providers", defaults.toString()).putString("activeId", "duckduckgo").apply()
        }
    }

    fun list(): List<Provider> {
        val raw = loadRaw()
        val activeId = prefs.getString("activeId", "duckduckgo")
        val result = mutableListOf<Provider>()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            val id = obj.getString("id")
            result.add(Provider(id, obj.getString("name"), obj.getString("urlTemplate"), obj.getBoolean("builtIn"), id == activeId))
        }
        return result
    }

    fun getActive(): Provider = list().find { it.active } ?: list().first()

    fun setActive(id: String): Boolean {
        if (loadRaw().let { raw -> (0 until raw.length()).none { raw.getJSONObject(it).getString("id") == id } }) return false
        prefs.edit().putString("activeId", id).apply()
        return true
    }

    fun add(name: String, urlTemplate: String): Result<String> {
        if (name.isBlank() || urlTemplate.isBlank()) return Result.failure(IllegalArgumentException("Name and URL template are required."))
        if (!urlTemplate.contains("%s")) return Result.failure(IllegalArgumentException("URL template must include %s as the query placeholder."))
        if (!urlTemplate.startsWith("https://")) return Result.failure(IllegalArgumentException("Only https:// URLs are supported."))

        val raw = loadRaw()
        val id = UUID.randomUUID().toString()
        raw.put(JSONObject().put("id", id).put("name", name).put("urlTemplate", urlTemplate).put("builtIn", false))
        persist(raw)
        return Result.success(id)
    }

    fun remove(id: String): Boolean {
        val raw = loadRaw()
        var found = false
        val rebuilt = JSONArray()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            if (obj.getString("id") == id) {
                if (obj.getBoolean("builtIn")) return false // cannot remove built-in providers
                found = true
            } else {
                rebuilt.put(obj)
            }
        }
        if (!found) return false
        persist(rebuilt)
        if (prefs.getString("activeId", null) == id) {
            val fallback = if (rebuilt.length() > 0) rebuilt.getJSONObject(0).getString("id") else "duckduckgo"
            prefs.edit().putString("activeId", fallback).apply()
        }
        return true
    }

    /** Builds the search URL for a query using the currently active provider. */
    fun buildSearchUrl(query: String): String {
        val encoded = URLEncoder.encode(query, "UTF-8")
        return getActive().urlTemplate.replace("%s", encoded)
    }

    private fun loadRaw(): JSONArray {
        val raw = prefs.getString("providers", null) ?: return JSONArray()
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }

    private fun persist(providers: JSONArray) {
        prefs.edit().putString("providers", providers.toString()).apply()
    }
}
