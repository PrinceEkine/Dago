package org.dago.browser.logic

/** Same hand-curated built-in list as the desktop app's src/main/adblock.js. */
val BUILT_IN_BLOCKED_DOMAINS: List<String> = listOf(
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "googletagmanager.com",
    "googletagservices.com",
    "adservice.google.com",
    "facebook.net",
    "connect.facebook.net",
    "ads.facebook.com",
    "analytics.twitter.com",
    "ads-twitter.com",
    "scorecardresearch.com",
    "quantserve.com",
    "adnxs.com",
    "outbrain.com",
    "taboola.com",
    "criteo.com",
    "moatads.com",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    "hotjar.com",
    "amplitude.com",
    "bat.bing.com",
    "adsystem.com",
    "advertising.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "yieldmo.com",
    "branch.io",
    "appsflyer.com",
    "sentry-cdn.com",
)

/** `domains == null` means "applies on every site"; entries prefixed `~` are exclusions. */
data class CosmeticRule(val domains: List<String>?, val selector: String)

/** The subscription-sourced data merged with [BUILT_IN_BLOCKED_DOMAINS] at request time. */
data class DynamicBlocklist(
    val domains: Set<String> = emptySet(),
    val allowedDomains: Set<String> = emptySet(),
    val blockedPatterns: List<GlobPattern> = emptyList(),
    val allowedPatterns: List<GlobPattern> = emptyList(),
    val cosmeticRules: List<CosmeticRule> = emptyList(),
) {
    companion object {
        val EMPTY = DynamicBlocklist()
    }
}

/**
 * Decides whether a request should be blocked. Mirrors the desktop app's
 * `isBlocked()` in src/main/adblock.js exactly, including the precedence
 * rule (exceptions checked before any block source - matching how
 * Adblock Plus-style engines treat `@@` rules).
 */
fun isBlocked(url: String, dynamic: DynamicBlocklist): Boolean {
    val parsed = runCatching { java.net.URL(url) }.getOrNull() ?: return false
    val hostname = parsed.host ?: return false

    if (matchesAnyDomain(hostname, dynamic.allowedDomains)) return false
    if (dynamic.allowedPatterns.any { it.matches(url) }) return false

    if (matchesAnyDomain(hostname, BUILT_IN_BLOCKED_DOMAINS)) return true
    if (matchesAnyDomain(hostname, dynamic.domains)) return true
    if (dynamic.blockedPatterns.any { it.matches(url) }) return true

    return false
}

private fun cosmeticRuleAppliesToHost(rule: CosmeticRule, hostname: String): Boolean {
    val domains = rule.domains ?: return true
    val includes = domains.filter { !it.startsWith("~") }
    val excludes = domains.filter { it.startsWith("~") }.map { it.substring(1) }
    if (excludes.any { matchesDomain(hostname, it) }) return false
    if (includes.isEmpty()) return true // exclusion-only list: applies unless excluded above
    return includes.any { matchesDomain(hostname, it) }
}

/** Deduplicated CSS selectors to hide on a given hostname. */
fun getCosmeticRulesForHost(hostname: String, dynamic: DynamicBlocklist): List<String> =
    dynamic.cosmeticRules.filter { cosmeticRuleAppliesToHost(it, hostname) }.map { it.selector }.distinct()
