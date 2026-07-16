package org.dago.browser

import android.content.Context
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Installs assets/privacy-preload.js as a document-start script - the
 * androidx.webkit equivalent of the guarantee Electron's `preload` option
 * gives the desktop app (src/main/main.js's `will-attach-webview`): this
 * runs before any of the page's own scripts, on every navigation, in every
 * frame.
 */
object WebViewInjection {
    @Volatile
    private var cachedScript: String? = null

    private fun loadScript(context: Context): String {
        cachedScript?.let { return it }
        val script = context.assets.open("privacy-preload.js").bufferedReader().use { it.readText() }
        cachedScript = script
        return script
    }

    /**
     * No-op (with a log, not a crash) on WebView builds too old to support
     * document-start scripts - a real, documented possibility on Android's
     * range of OS/WebView versions, unlike desktop where Electron always
     * ships a known-good bundled Chromium.
     */
    fun installDocumentStartScript(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            android.util.Log.w(
                "Dago",
                "This device's WebView doesn't support DOCUMENT_START_SCRIPT - " +
                    "fingerprint-resistance patches won't be injected on it."
            )
            return
        }
        val script = loadScript(webView.context)
        WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
    }
}
