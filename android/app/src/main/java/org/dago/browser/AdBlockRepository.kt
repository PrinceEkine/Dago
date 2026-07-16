package org.dago.browser

import org.dago.browser.logic.DynamicBlocklist
import org.dago.browser.logic.getCosmeticRulesForHost
import org.dago.browser.logic.isBlocked

/**
 * Process-wide holder for the currently-merged filter-list data (built-in
 * list is handled inside :logic's `isBlocked`/`getCosmeticRulesForHost`
 * directly, this only holds the subscription-sourced part). Every WebView's
 * [PrivacyWebViewClient] and the cosmetic-hiding JS bridge read from this
 * live, matching how the desktop app's adblock.js holds one shared
 * `dynamicBlocklist` that every tab session reads from - so updating
 * subscriptions applies to already-open tabs immediately here too.
 *
 * Simple singleton `object` rather than a DI-provided instance: this repo
 * doesn't currently pull in a DI framework, and a single mutable holder is
 * enough for what's otherwise process-global state anyway.
 */
object AdBlockRepository {
    @Volatile
    var dynamicBlocklist: DynamicBlocklist = DynamicBlocklist.EMPTY
        private set

    @Volatile
    var enabled: Boolean = true

    fun update(newBlocklist: DynamicBlocklist) {
        dynamicBlocklist = newBlocklist
    }

    fun isUrlBlocked(url: String): Boolean = enabled && isBlocked(url, dynamicBlocklist)

    fun cosmeticRulesForHost(hostname: String): List<String> = getCosmeticRulesForHost(hostname, dynamicBlocklist)
}
