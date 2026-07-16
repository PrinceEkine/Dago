package org.dago.browser

import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

/**
 * Mirrors the desktop app's tracker/ad blocking
 * (`session.webRequest.onBeforeRequest` in src/main/ipc.js) via
 * `shouldInterceptRequest`, which WebView calls for the main-frame
 * navigation and every subresource. A blocked request gets an empty
 * response instead of `null` (which would let WebView fetch it normally) -
 * this is the WebView-side equivalent of Electron's `callback({cancel: true})`.
 */
class PrivacyWebViewClient(
    private val onUrlChanged: (url: String) -> Unit,
    private val onLoadingStateChanged: (loading: Boolean) -> Unit,
) : WebViewClient() {

    private val blockedResponse: WebResourceResponse
        get() = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        if (AdBlockRepository.isUrlBlocked(url)) return blockedResponse
        return super.shouldInterceptRequest(view, request)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onLoadingStateChanged(true)
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        onLoadingStateChanged(false)
        onUrlChanged(url)
        injectCosmeticHiding(view, url)
    }
}
