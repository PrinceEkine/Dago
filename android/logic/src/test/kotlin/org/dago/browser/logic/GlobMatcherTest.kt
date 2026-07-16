package org.dago.browser.logic

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.system.measureTimeMillis

class GlobMatcherTest {

    @Test
    fun `domain plus path wildcard matches only the right domain and path`() {
        val pattern = GlobPattern.compile("||cdn.example.com/banners/*^")
        assertTrue(pattern.matches("https://cdn.example.com/banners/300x250.gif"))
        assertFalse(pattern.matches("https://cdn.example.com/content/photo.jpg"))
        assertFalse(pattern.matches("https://other.com/banners/x.gif"))
        assertTrue(pattern.matches("https://static.cdn.example.com/banners/x.gif")) // subdomain suffix match
    }

    @Test
    fun `bare substring pattern matches anywhere`() {
        val pattern = GlobPattern.compile("annoying-ads.js")
        assertTrue(pattern.matches("https://cdn.example/scripts/annoying-ads.js?v=2"))
        assertFalse(pattern.matches("https://cdn.example/scripts/legit.js"))
    }

    @Test
    fun `start and end anchors are respected`() {
        val startAnchored = GlobPattern.compile("|https://exact-start.example")
        assertTrue(startAnchored.matches("https://exact-start.example/page"))
        assertFalse(startAnchored.matches("https://other.com/https://exact-start.example"))

        val endAnchored = GlobPattern.compile("trailing-end.js|")
        assertTrue(endAnchored.matches("https://cdn.example/trailing-end.js"))
        assertFalse(endAnchored.matches("https://cdn.example/trailing-end.js?v=1"))
    }

    @Test
    fun `degenerate patterns never match anything (regression test)`() {
        // Each of these has no domain and no literal text at all - if this
        // guard were missing or broken, every one would match every URL
        // unconditionally, exactly the bug that let a single "@@|" line
        // disable all ad blocking on the desktop app (see /SECURITY.md).
        val degeneratePatterns = listOf("|", "*", "^", "**", "^^", "*^*")
        for (raw in degeneratePatterns) {
            val pattern = GlobPattern.compile(raw)
            assertFalse(pattern.matches("https://doubleclick.net/ad.js"), "pattern '$raw' should never match")
            assertFalse(pattern.matches("https://example.com/anything"), "pattern '$raw' should never match")
        }
    }

    @Test
    fun `domain-anchored patterns with empty domain are self-limiting, not degenerate`() {
        // "||^" and "||*" parse to an empty *domain* (not a null domain), so
        // they're already safe via matchesDomain("", ...) never matching a
        // real hostname - distinct code path from the no-domain case above,
        // still worth a regression test since it's an easy case to break.
        val pattern = GlobPattern.compile("||^")
        assertFalse(pattern.matches("https://doubleclick.net/ad.js"))
        assertFalse(pattern.matches("https://example.com/anything"))
    }

    @Test
    fun `pathological wildcard count resolves near-instantly, not exponentially`() {
        val pattern = GlobPattern.compile("*" + "a*".repeat(500) + "b")
        val input = "a".repeat(5000) + "X" // deliberately non-matching, worst case for naive backtracking
        var result = true
        val elapsedMs = measureTimeMillis {
            result = pattern.matches(input)
        }
        assertFalse(result)
        assertTrue(elapsedMs < 1000, "expected near-instant resolution, took ${elapsedMs}ms")
    }
}
