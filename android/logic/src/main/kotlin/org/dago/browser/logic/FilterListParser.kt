package org.dago.browser.logic

private const val MAX_CSS_SELECTOR_LENGTH = 300

data class ParsedFilterList(
    val blocked: List<String> = emptyList(),
    val allowed: List<String> = emptyList(),
    val blockedPatterns: List<String> = emptyList(),
    val allowedPatterns: List<String> = emptyList(),
    val cosmeticRules: List<CosmeticRule> = emptyList(),
) {
    val ruleCount: Int
        get() = blocked.size + allowed.size + blockedPatterns.size + allowedPatterns.size + cosmeticRules.size
}

/**
 * Parses a safe, bounded subset of Adblock Plus filter syntax - a direct
 * port of the desktop app's `parseFilterList` in src/main/filter-list-store.js:
 *  - plain domain-blocking rules (`||domain.tld^`) and their exceptions
 *  - path/wildcard address rules (`||domain.tld/banner-ads*^`, bare substrings
 *    like `annoying-ads.js`) as glob patterns for [GlobPattern]/[globSegmentsMatch]
 *  - basic element-hiding/cosmetic rules (`domain.com##selector`, `##selector`)
 *
 * Deliberately NOT supported: raw `/regex/` filters, for the same reason as
 * the desktop parser - compiling and running arbitrary regex handed to us
 * by a (possibly compromised or malicious) subscription URL is a real
 * ReDoS vector. Filter options (`$third-party`, `$script`, etc.) are
 * stripped and ignored - only address matching is implemented.
 */
fun parseFilterList(text: String): ParsedFilterList {
    val blocked = mutableListOf<String>()
    val allowed = mutableListOf<String>()
    val blockedPatterns = mutableListOf<String>()
    val allowedPatterns = mutableListOf<String>()
    val cosmeticRules = mutableListOf<CosmeticRule>()

    val cosmeticRegex = Regex("^([^\\s#]*)##(.+)$")
    val domainOnlyRegex = Regex("^\\|\\|([a-zA-Z0-9.-]+)\\^\$")

    for (rawLine in text.split("\n")) {
        val line = rawLine.trim()
        if (line.isEmpty() || line.startsWith("!") || line.startsWith("[")) continue

        val cosmeticMatch = cosmeticRegex.find(line)
        if (cosmeticMatch != null) {
            val (domainsPart, selector) = cosmeticMatch.destructured
            val trimmedSelector = selector.trim()
            if (trimmedSelector.isEmpty() ||
                trimmedSelector.length > MAX_CSS_SELECTOR_LENGTH ||
                trimmedSelector.any { it == '<' || it == '>' || it == '{' || it == '}' }
            ) {
                continue
            }
            val domains = if (domainsPart.isNotEmpty()) {
                domainsPart.split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }
            } else {
                null
            }
            cosmeticRules.add(CosmeticRule(domains, trimmedSelector))
            continue
        }
        if (line.contains("#")) continue // #@#, #$#, #?#, or anything else cosmetic-shaped we don't parse

        // Raw regex filters (wrapped in slashes): skipped entirely, see doc comment.
        if (line.startsWith("/") && line.endsWith("/") && line.length > 1) continue

        val isException = line.startsWith("@@")
        val body = if (isException) line.substring(2) else line

        val dollarIdx = body.indexOf('$')
        val addressPattern = if (dollarIdx == -1) body else body.substring(0, dollarIdx)
        if (addressPattern.isEmpty()) continue

        val domainOnlyMatch = domainOnlyRegex.find(addressPattern)
        if (domainOnlyMatch != null) {
            val domain = domainOnlyMatch.groupValues[1].lowercase()
            if (isException) allowed.add(domain) else blocked.add(domain)
            continue
        }

        // Everything else - anchored (`||`/`|`), wildcarded (`*`), or a bare
        // substring like `annoying-ads.js` - becomes a glob pattern (see
        // GlobPattern.compile; degenerate patterns are neutralized there).
        if (isException) allowedPatterns.add(addressPattern) else blockedPatterns.add(addressPattern)
    }

    return ParsedFilterList(blocked, allowed, blockedPatterns, allowedPatterns, cosmeticRules)
}

/** Compiles a [ParsedFilterList]'s raw pattern strings into a ready-to-use [DynamicBlocklist]. */
fun ParsedFilterList.toDynamicBlocklist(): DynamicBlocklist = DynamicBlocklist(
    domains = blocked.toSet(),
    allowedDomains = allowed.toSet(),
    blockedPatterns = blockedPatterns.map { GlobPattern.compile(it) },
    allowedPatterns = allowedPatterns.map { GlobPattern.compile(it) },
    cosmeticRules = cosmeticRules,
)

/** Merges multiple enabled subscriptions' parsed lists into one [DynamicBlocklist]. */
fun mergeDynamicBlocklists(lists: List<ParsedFilterList>): DynamicBlocklist {
    val domains = mutableSetOf<String>()
    val allowedDomains = mutableSetOf<String>()
    val blockedPatterns = mutableListOf<GlobPattern>()
    val allowedPatterns = mutableListOf<GlobPattern>()
    val cosmeticRules = mutableListOf<CosmeticRule>()
    for (list in lists) {
        domains.addAll(list.blocked)
        allowedDomains.addAll(list.allowed)
        blockedPatterns.addAll(list.blockedPatterns.map { GlobPattern.compile(it) })
        allowedPatterns.addAll(list.allowedPatterns.map { GlobPattern.compile(it) })
        cosmeticRules.addAll(list.cosmeticRules)
    }
    return DynamicBlocklist(domains, allowedDomains, blockedPatterns, allowedPatterns, cosmeticRules)
}
