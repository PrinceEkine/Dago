package org.dago.browser

import android.webkit.WebView

/**
 * One browser tab. Unlike the desktop app's per-tab, non-persistent
 * Electron session partitions, Android's WebView shares a single
 * CookieManager and HTTP cache across every WebView instance in the
 * process - there's no equivalent of Electron's `session.fromPartition`
 * here. Tabs on Android are isolated in the UI sense (separate WebView
 * instances, separate back/forward history) but **not** in the
 * cookie/storage sense. This is a real, documented gap - see
 * android/README.md and docs/THREAT_MODEL.md.
 */
class BrowserTab(val id: String, val webView: WebView) {
    var title: String = "New Tab"
    var url: String = ""
}
