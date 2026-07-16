package org.dago.browser

import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView

/**
 * Camera permission is refused unconditionally here - mirrors the desktop
 * app's policy (src/main/main.js's `setPermissionRequestHandler`, which
 * inspects `details.mediaTypes` and denies anything requesting video) and
 * privacy-preload.js's getUserMedia override. Microphone-only requests are
 * granted, matching that same "no video calls, ever" policy rather than
 * blocking all media.
 */
class PrivacyWebChromeClient(
    private val onTitleChanged: (title: String) -> Unit,
) : WebChromeClient() {

    override fun onReceivedTitle(view: WebView, title: String?) {
        super.onReceivedTitle(view, title)
        if (!title.isNullOrBlank()) onTitleChanged(title)
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        val wantsVideo = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (wantsVideo) {
            request.deny()
            return
        }
        // Grant only the non-video resources actually requested (typically
        // just RESOURCE_AUDIO_CAPTURE) rather than the whole original set.
        val grantable = request.resources.filter { it != PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        if (grantable.isNotEmpty()) {
            request.grant(grantable.toTypedArray())
        } else {
            request.deny()
        }
    }
}
