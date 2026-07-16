package org.dago.browser

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast

/**
 * Unlike the desktop app's custom download-manager.js (which has to track
 * progress/state itself since Electron has no OS-level download service),
 * Android provides one: `DownloadManager` handles the actual transfer,
 * progress notification, and retry - this just hands it a correctly-built
 * request (including the page's session cookie, which WebView doesn't pass
 * along automatically) and lets the OS take it from there. `DownloadsActivity`
 * queries the same system `DownloadManager` for a list rather than
 * maintaining a separate one.
 */
object DownloadHandler {
    fun enqueue(context: Context, url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        val request = DownloadManager.Request(Uri.parse(url))
        val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
        request.setMimeType(mimeType)
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("cookie", it) }
        userAgent?.let { request.addRequestHeader("User-Agent", it) }
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)

        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        runCatching { downloadManager.enqueue(request) }
            .onFailure { Toast.makeText(context, "Could not start download: ${it.message}", Toast.LENGTH_LONG).show() }
    }
}
