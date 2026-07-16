package org.dago.browser.logic

import java.net.URL

/**
 * Matches a glob (segments split on `*`/`^`, both treated as "any number of
 * characters" wildcard boundaries) against [text] using only
 * String.indexOf/startsWith/endsWith - never Regex.
 *
 * This is a direct, deliberate port of the equivalent function in Dago's
 * desktop app (src/main/adblock.js's `globSegmentsMatch`). An earlier
 * version of that desktop code built a Regex from escaped literal segments
 * joined by `.*`, on the theory that "no nested quantifiers" made it
 * ReDoS-safe. That reasoning was wrong - chained `.*literal.*literal.*...`
 * is exactly the classic catastrophic-backtracking shape in a backtracking
 * engine, confirmed there by a pattern with ~30 wildcard segments taking
 * over two minutes to fail a single match (see /SECURITY.md). Sequential
 * indexOf scanning is O(segments x text length) with no backtracking
 * possible, so this port starts from the corrected design rather than
 * repeating that mistake.
 */
fun globSegmentsMatch(text: String, segments: List<String>, anchorStart: Boolean, anchorEnd: Boolean): Boolean {
    var pos = 0

    for (i in segments.indices) {
        val segment = segments[i]
        if (segment.isEmpty()) continue
        // Only the literal token at index 0 can be anchor-started - if it
        // was empty (pattern began with a wildcard, e.g. "|*foo"), the
        // anchor is already moot by the time we reach the next literal, so
        // every later segment always falls through to the indexOf scan.
        if (i == 0 && anchorStart) {
            if (!text.startsWith(segment)) return false
            pos = segment.length
        } else {
            val idx = text.indexOf(segment, pos)
            if (idx == -1) return false
            pos = idx + segment.length
        }
    }

    if (anchorEnd) {
        val lastSegment = segments.lastOrNull() ?: ""
        // An empty last token means the pattern ended in a wildcard right
        // before the anchor, which is redundant - matches above suffice.
        if (lastSegment.isNotEmpty() && !text.endsWith(lastSegment)) return false
    }

    return true
}

/**
 * A compiled address pattern: either a `||domain` requirement plus a glob
 * to run against just the path+query (decomposed this way so the glob
 * matcher never has to reason about hostnames), or a plain glob run against
 * the whole URL string.
 */
class GlobPattern private constructor(
    private val domain: String?,
    private val remainderPattern: String,
    private val segments: List<String>,
    private val anchorStart: Boolean,
    private val anchorEnd: Boolean,
) {
    // A pattern with no `||domain` component and no literal text at all - a
    // bare "|", "*", "^", or any combination that fully collapses to
    // emptiness (e.g. "**", "^^") - would otherwise match every URL
    // unconditionally: globSegmentsMatch has nothing to scan for, so it
    // just returns true. That's almost never the intent of a filter-list
    // rule, and if such a pattern lands in an exception ("@@") rule,
    // AdBlockEngine checks allow-patterns before any block source, so it
    // would silently disable every other block source for the entire
    // browser. A hostile or compromised filter-list URL - exactly the
    // threat this feature has to assume - only needs to serve a single
    // line like "@@|" to trigger that (this exact bug shipped and was
    // fixed on the desktop app - see /SECURITY.md). Fail safe here: treat
    // a degenerate pattern as matching nothing, from the start.
    private val isDegenerate = domain == null && segments.all { it.isEmpty() }

    fun matches(url: String): Boolean {
        if (isDegenerate) return false
        if (domain != null) {
            val parsed = runCatching { URL(url) }.getOrNull() ?: return false
            val hostname = parsed.host ?: return false
            if (!matchesDomain(hostname, domain)) return false
            if (remainderPattern.isEmpty()) return true
            val target = parsed.path.orEmpty() + (parsed.query?.let { "?$it" } ?: "")
            return globSegmentsMatch(target, segments, anchorStart, anchorEnd)
        }
        return globSegmentsMatch(url, segments, anchorStart, anchorEnd)
    }

    companion object {
        fun compile(rawPattern: String): GlobPattern {
            var pattern = rawPattern
            var domain: String? = null
            var anchorStart = false
            var anchorEnd = false

            if (pattern.startsWith("||")) {
                pattern = pattern.substring(2)
                val boundaryIdx = pattern.indexOfFirst { it == '/' || it == '^' || it == '*' }
                if (boundaryIdx == -1) {
                    domain = pattern.lowercase()
                    pattern = ""
                } else {
                    domain = pattern.substring(0, boundaryIdx).lowercase()
                    pattern = pattern.substring(boundaryIdx)
                }
            } else if (pattern.startsWith("|")) {
                anchorStart = true
                pattern = pattern.substring(1)
            }
            if (pattern.endsWith("|") && !pattern.endsWith("||")) {
                anchorEnd = true
                pattern = pattern.dropLast(1)
            }

            val segments = pattern.split(Regex("[*^]"))
            return GlobPattern(domain, pattern, segments, anchorStart, anchorEnd)
        }
    }
}
