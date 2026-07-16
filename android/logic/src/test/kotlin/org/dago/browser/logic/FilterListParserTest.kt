package org.dago.browser.logic

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class FilterListParserTest {

    @Test
    fun `parses domain, path pattern, bare literal, exception, and cosmetic rules`() {
        val sample = listOf(
            "! a comment",
            "||ads.example.com^",
            "||cdn.example.com/banners/*^",
            "*/track.js",
            "@@||goodcdn.example.com^",
            "@@*/allowed-track.js",
            "example.com,sub.example.org##.ad-banner",
            "~excluded.example.com,example.com##.popup",
            "##.global-hide-me",
            "badselector##<script>alert(1)</script>",
            "/some-arbitrary-regex-.*+/",
            "example.com#@#.exception-hide",
        ).joinToString("\n")

        val result = parseFilterList(sample)

        assertEquals(listOf("ads.example.com"), result.blocked)
        assertEquals(listOf("goodcdn.example.com"), result.allowed)
        assertEquals(listOf("||cdn.example.com/banners/*^", "*/track.js"), result.blockedPatterns)
        assertEquals(listOf("@@*/allowed-track.js".removePrefix("@@")), result.allowedPatterns)
        assertEquals(3, result.cosmeticRules.size)
        assertTrue(result.cosmeticRules.any { it.selector == ".global-hide-me" && it.domains == null })
        // Malicious/garbage selectors and unsupported cosmetic syntax must not leak through.
        assertFalse(result.cosmeticRules.any { it.selector.contains("<script>") })
    }

    @Test
    fun `a degenerate exception pattern is parsed but neutralized when compiled`() {
        // The parser doesn't reject this (that's GlobPattern's job) - this
        // test exists to document that split of responsibility and make
        // sure a future change doesn't silently start rejecting it at parse
        // time in a way that masks GlobPattern's own guard no longer being
        // exercised by real parser output.
        val result = parseFilterList("@@|")
        assertEquals(listOf("|"), result.allowedPatterns)
        val compiled = result.toDynamicBlocklist()
        assertFalse(compiled.allowedPatterns.first().matches("https://doubleclick.net/ad.js"))
    }

    @Test
    fun `ruleCount reflects all rule kinds`() {
        val result = parseFilterList(
            listOf("||a.example^", "||b.example/x/*^", "c.example##.d").joinToString("\n")
        )
        assertEquals(3, result.ruleCount)
    }
}
