package org.dago.browser.logic

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AdBlockEngineTest {

    @Test
    fun `built-in domains are blocked with no subscriptions active`() {
        assertTrue(isBlocked("https://doubleclick.net/x", DynamicBlocklist.EMPTY))
        assertFalse(isBlocked("https://example.com/x", DynamicBlocklist.EMPTY))
    }

    @Test
    fun `subscription domain and pattern blocking works, and exceptions override blocks`() {
        val dynamic = DynamicBlocklist(
            domains = setOf("dyn-tracker.example"),
            allowedDomains = setOf("safe.example"),
            blockedPatterns = listOf(GlobPattern.compile("||cdn.example.com/ads/*^")),
            allowedPatterns = listOf(GlobPattern.compile("*/ok-ads/*")),
        )
        assertTrue(isBlocked("https://dyn-tracker.example/x", dynamic))
        assertFalse(isBlocked("https://safe.example/x", dynamic))
        assertTrue(isBlocked("https://cdn.example.com/ads/banner.gif", dynamic))
        assertFalse(isBlocked("https://cdn.example.com/ok-ads/banner.gif", dynamic)) // exception overrides
        assertFalse(isBlocked("https://unrelated.example/x", dynamic))
    }

    @Test
    fun `cosmetic rules respect global, domain-scoped, and exclusion semantics`() {
        val dynamic = DynamicBlocklist(
            cosmeticRules = listOf(
                CosmeticRule(null, ".global-ad"),
                CosmeticRule(listOf("example.com"), ".example-only-ad"),
                CosmeticRule(listOf("~excluded.example.com", "example.com"), ".popup"),
            ),
        )
        assertEqualsUnordered(listOf(".global-ad", ".example-only-ad", ".popup"), getCosmeticRulesForHost("example.com", dynamic))
        assertEqualsUnordered(listOf(".global-ad", ".example-only-ad"), getCosmeticRulesForHost("excluded.example.com", dynamic))
        assertEqualsUnordered(listOf(".global-ad"), getCosmeticRulesForHost("unrelated.com", dynamic))
    }

    private fun assertEqualsUnordered(expected: List<String>, actual: List<String>) {
        org.junit.jupiter.api.Assertions.assertEquals(expected.toSet(), actual.toSet())
    }
}
