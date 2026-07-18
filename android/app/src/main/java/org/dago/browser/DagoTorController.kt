package org.dago.browser

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import org.torproject.jni.TorService

/**
 * Wraps `org.torproject.jni.TorService` (published by the Guardian Project -
 * the same underlying tooling as Orbot/Tor Browser for Android) to provide
 * the same operations the desktop app's `tor-manager.js` exposes: start,
 * "New Identity", and a SOCKS proxy every WebView routes through. The real
 * public API used here (`TorService`, its `LocalBinder`, `ACTION_START`,
 * `ACTION_STATUS`/`EXTRA_STATUS`, `getSocksPort()`,
 * `getTorControlConnection()`, and `TorControlConnection.signal()`) was
 * verified against the actual published tor-android AAR and jtorctl 0.4.5.7
 * JAR from Maven Central (via `javap`) before writing this class, not
 * written from memory alone - see app/build.gradle.kts for why the
 * dependency is pinned to 0.4.9.5 rather than the newest release.
 *
 * A real architectural difference from desktop: Electron gives each tab its
 * own session with its own SocksPort, so tabs never share a circuit.
 * Android's `ProxyController` sets ONE proxy configuration for the whole
 * process - there's no per-WebView equivalent - so every tab on Android
 * shares a single Tor circuit until "New Identity" is used. This is a real,
 * documented limitation, not a bug - see android/README.md.
 */
class DagoTorController(private val appContext: Context) {

    enum class Status { OFF, STARTING, ON }

    var onStatusChanged: ((Status) -> Unit)? = null
    var status: Status = Status.OFF
        private set(value) {
            field = value
            onStatusChanged?.invoke(value)
        }

    private var torService: TorService? = null
    private var bound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder) {
            torService = (binder as TorService.LocalBinder).service
            bound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            torService = null
            bound = false
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            status = when (intent.getStringExtra(TorService.EXTRA_STATUS)) {
                TorService.STATUS_ON -> Status.ON
                TorService.STATUS_STARTING -> Status.STARTING
                else -> Status.OFF
            }
            if (status == Status.ON) applyProxyToWebViews()
        }
    }

    fun start() {
        status = Status.STARTING
        LocalBroadcastManager.getInstance(appContext).registerReceiver(
            statusReceiver,
            IntentFilter(TorService.ACTION_STATUS),
        )
        val startIntent = Intent(appContext, TorService::class.java).setAction(TorService.ACTION_START)
        ContextCompat.startForegroundService(appContext, startIntent)
        appContext.bindService(Intent(appContext, TorService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    fun unbind() {
        if (bound) {
            appContext.unbindService(connection)
            bound = false
        }
        runCatching { LocalBroadcastManager.getInstance(appContext).unregisterReceiver(statusReceiver) }
    }

    /** Sends the Tor control-port "NEWNYM" signal - same as the desktop app's "New Identity" button. */
    fun newIdentity() {
        runCatching { torService?.getTorControlConnection()?.signal("NEWNYM") }
    }

    private fun applyProxyToWebViews() {
        val service = torService ?: return
        val socksPort = service.getSocksPort()
        if (socksPort <= 0) return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            android.util.Log.w("Dago", "This device's WebView doesn't support proxy override - Tor routing unavailable.")
            return
        }
        val config = ProxyConfig.Builder()
            .addProxyRule("socks5://127.0.0.1:$socksPort")
            .build()
        ProxyController.getInstance().setProxyOverride(
            config,
            ContextCompat.getMainExecutor(appContext),
            Runnable {},
        )
    }
}
