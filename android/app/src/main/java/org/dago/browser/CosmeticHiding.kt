package org.dago.browser

import android.net.Uri
import android.webkit.WebView
import org.json.JSONArray

/**
 * Injects a `<style>` tag hiding this page's matching cosmetic/element-hiding
 * selectors (see :logic's `getCosmeticRulesForHost`). Computed natively and
 * pushed in via `evaluateJavascript` rather than exposing a
 * `addJavascriptInterface` bridge to the page - the native side already
 * knows the URL at `onPageFinished`, so there's no need to give every loaded
 * page (including untrusted ones) a callable surface just to ask "what
 * should I hide on myself", which is the kind of exposed native bridge
 * that's historically been a real WebView attack-surface footgun.
 */
fun injectCosmeticHiding(view: WebView, url: String) {
    val hostname = runCatching { Uri.parse(url).host }.getOrNull() ?: return
    val selectors = AdBlockRepository.cosmeticRulesForHost(hostname)
    if (selectors.isEmpty()) return

    // JSONArray.toString() gives us safely-escaped JS string literals for
    // each selector without hand-rolling escaping.
    val selectorsJson = JSONArray(selectors).toString()
    val script = """
        (function() {
            try {
                var selectors = $selectorsJson;
                var style = document.createElement('style');
                style.textContent = selectors.map(function(s) { return s + '{display:none!important}'; }).join('\n');
                (document.head || document.documentElement).appendChild(style);
            } catch (e) { /* non-fatal */ }
        })();
    """.trimIndent()
    view.evaluateJavascript(script, null)
}
