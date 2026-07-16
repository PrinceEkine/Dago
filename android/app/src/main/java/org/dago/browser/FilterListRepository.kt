package org.dago.browser

import android.content.Context
import org.dago.browser.logic.parseFilterList
import org.dago.browser.logic.mergeDynamicBlocklists
import org.dago.browser.logic.ParsedFilterList
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Android counterpart to the desktop app's filter-list-store.js: manages
 * user-added EasyList/EasyPrivacy-style subscriptions, fetched and parsed
 * only when the user explicitly adds one or presses Update in Settings -
 * never on a timer or automatically at startup, same "no silent background
 * fetch" rule. Parsing itself is the exact same :logic module the desktop
 * app's port shares algorithms with (see FilterListParser.kt's doc
 * comment), so the security properties established there (indexOf-based
 * matching, degenerate-pattern rejection - see /SECURITY.md) apply here
 * unchanged rather than needing to be re-established for a second parser.
 */
class FilterListRepository(private val context: Context) {
    data class Subscription(
        val id: String,
        val name: String,
        val url: String,
        val enabled: Boolean,
        val lastUpdated: Long?,
        val ruleCount: Int,
    )

    private val prefs = context.getSharedPreferences("dago_filter_lists", Context.MODE_PRIVATE)
    private val cacheDir = File(context.filesDir, "filter-lists-cache").apply { mkdirs() }

    init {
        if (!prefs.contains("subscriptions")) {
            // Same default subscriptions as the desktop app, unsubscribed by default.
            val defaults = JSONArray()
                .put(subscriptionJson(UUID.randomUUID().toString(), "EasyList", "https://easylist.to/easylist/easylist.txt", false, null, 0))
                .put(subscriptionJson(UUID.randomUUID().toString(), "EasyPrivacy", "https://easylist.to/easylist/easyprivacy.txt", false, null, 0))
            prefs.edit().putString("subscriptions", defaults.toString()).apply()
        }
        rebuildDynamicBlocklist()
    }

    fun list(): List<Subscription> {
        val raw = loadRaw()
        val result = mutableListOf<Subscription>()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            result.add(
                Subscription(
                    obj.getString("id"),
                    obj.getString("name"),
                    obj.getString("url"),
                    obj.getBoolean("enabled"),
                    if (obj.isNull("lastUpdated")) null else obj.getLong("lastUpdated"),
                    obj.optInt("ruleCount", 0),
                )
            )
        }
        return result
    }

    fun add(name: String, url: String): Boolean {
        if (name.isBlank() || !url.startsWith("https://")) return false
        val raw = loadRaw()
        raw.put(subscriptionJson(UUID.randomUUID().toString(), name, url, false, null, 0))
        persist(raw)
        return true
    }

    fun remove(id: String) {
        val raw = loadRaw()
        val rebuilt = JSONArray()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            if (obj.getString("id") != id) rebuilt.put(obj)
        }
        persist(rebuilt)
        cacheFile(id).delete()
        rebuildDynamicBlocklist()
    }

    fun setEnabled(id: String, enabled: Boolean) {
        val raw = loadRaw()
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            if (obj.getString("id") == id) obj.put("enabled", enabled)
        }
        persist(raw)
        rebuildDynamicBlocklist()
    }

    /** Fetches, parses, and caches one subscription. Runs network I/O - call off the main thread. */
    fun update(id: String): Result<Int> {
        val raw = loadRaw()
        var targetUrl: String? = null
        for (i in 0 until raw.length()) {
            val obj = raw.getJSONObject(i)
            if (obj.getString("id") == id) targetUrl = obj.getString("url")
        }
        val url = targetUrl ?: return Result.failure(IllegalArgumentException("Unknown subscription"))

        return runCatching {
            val text = fetch(url)
            val parsed = parseFilterList(text)
            cacheFile(id).writeText(parsedFilterListToJson(parsed).toString())

            for (i in 0 until raw.length()) {
                val obj = raw.getJSONObject(i)
                if (obj.getString("id") == id) {
                    obj.put("lastUpdated", System.currentTimeMillis())
                    obj.put("ruleCount", parsed.ruleCount)
                }
            }
            persist(raw)
            rebuildDynamicBlocklist()
            parsed.ruleCount
        }
    }

    private fun fetch(urlString: String): String {
        val connection = URL(urlString).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        try {
            check(connection.responseCode == HttpURLConnection.HTTP_OK) { "HTTP ${connection.responseCode}" }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun rebuildDynamicBlocklist() {
        val parsedLists = mutableListOf<ParsedFilterList>()
        for (sub in list()) {
            if (!sub.enabled) continue
            val file = cacheFile(sub.id)
            if (!file.exists()) continue
            val parsed = runCatching { jsonToParsedFilterList(JSONObject(file.readText())) }.getOrNull() ?: continue
            parsedLists.add(parsed)
        }
        AdBlockRepository.update(mergeDynamicBlocklists(parsedLists))
    }

    private fun cacheFile(id: String) = File(cacheDir, "$id.json")

    private fun loadRaw(): JSONArray {
        val raw = prefs.getString("subscriptions", null) ?: return JSONArray()
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }

    private fun persist(subscriptions: JSONArray) {
        prefs.edit().putString("subscriptions", subscriptions.toString()).apply()
    }

    private fun subscriptionJson(id: String, name: String, url: String, enabled: Boolean, lastUpdated: Long?, ruleCount: Int) =
        JSONObject()
            .put("id", id)
            .put("name", name)
            .put("url", url)
            .put("enabled", enabled)
            .put("lastUpdated", lastUpdated)
            .put("ruleCount", ruleCount)

    private fun parsedFilterListToJson(parsed: ParsedFilterList): JSONObject = JSONObject()
        .put("blocked", JSONArray(parsed.blocked))
        .put("allowed", JSONArray(parsed.allowed))
        .put("blockedPatterns", JSONArray(parsed.blockedPatterns))
        .put("allowedPatterns", JSONArray(parsed.allowedPatterns))
        .put(
            "cosmeticRules",
            JSONArray(
                parsed.cosmeticRules.map {
                    JSONObject()
                        .put("domains", if (it.domains == null) JSONObject.NULL else JSONArray(it.domains))
                        .put("selector", it.selector)
                }
            ),
        )

    private fun jsonToParsedFilterList(json: JSONObject): ParsedFilterList {
        fun stringList(key: String): List<String> {
            val arr = json.getJSONArray(key)
            return (0 until arr.length()).map { arr.getString(it) }
        }
        val cosmeticArr = json.getJSONArray("cosmeticRules")
        val cosmeticRules = (0 until cosmeticArr.length()).map { i ->
            val obj = cosmeticArr.getJSONObject(i)
            val domains = if (obj.isNull("domains")) null else {
                val arr = obj.getJSONArray("domains")
                (0 until arr.length()).map { arr.getString(it) }
            }
            org.dago.browser.logic.CosmeticRule(domains, obj.getString("selector"))
        }
        return ParsedFilterList(
            blocked = stringList("blocked"),
            allowed = stringList("allowed"),
            blockedPatterns = stringList("blockedPatterns"),
            allowedPatterns = stringList("allowedPatterns"),
            cosmeticRules = cosmeticRules,
        )
    }
}
