package org.dago.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.WebView
import android.widget.PopupMenu
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private val tabs = mutableListOf<BrowserTab>()
    private var activeTabId: String? = null
    private lateinit var tabAdapter: TabAdapter

    private lateinit var torController: DagoTorController
    private lateinit var bookmarkStore: BookmarkStore
    private lateinit var historyStore: HistoryStore
    private lateinit var filterListRepository: FilterListRepository

    private lateinit var tabStrip: RecyclerView
    private lateinit var addressBar: android.widget.EditText
    private lateinit var backButton: android.widget.ImageButton
    private lateinit var forwardButton: android.widget.ImageButton
    private lateinit var reloadButton: android.widget.ImageButton
    private lateinit var bookmarkButton: android.widget.ImageButton
    private lateinit var newIdentityButton: android.widget.ImageButton
    private lateinit var torStatusText: android.widget.TextView
    private lateinit var webViewContainer: android.widget.FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tabStrip = findViewById(R.id.tabStrip)
        addressBar = findViewById(R.id.addressBar)
        backButton = findViewById(R.id.backButton)
        forwardButton = findViewById(R.id.forwardButton)
        reloadButton = findViewById(R.id.reloadButton)
        bookmarkButton = findViewById(R.id.bookmarkButton)
        newIdentityButton = findViewById(R.id.newIdentityButton)
        torStatusText = findViewById(R.id.torStatusText)
        webViewContainer = findViewById(R.id.webViewContainer)

        // Reading cached subscriptions and rebuilding AdBlockRepository's
        // merged blocklist at startup - mirrors desktop's FilterListStore
        // constructor doing the same, with no network call involved.
        filterListRepository = FilterListRepository(applicationContext)

        torController = DagoTorController(applicationContext)
        bookmarkStore = BookmarkStore(this)
        historyStore = HistoryStore(this)

        tabAdapter = TabAdapter(tabs, { activeTabId }, ::activateTab, ::closeTab)
        tabStrip.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        tabStrip.adapter = tabAdapter

        wireToolbar()
        observeTorStatus()
        torController.start()

        createTab(null)
    }

    override fun onDestroy() {
        torController.unbind()
        super.onDestroy()
    }

    private fun wireToolbar() {
        findViewById<View>(R.id.newTabButton).setOnClickListener { createTab(null) }
        backButton.setOnClickListener { activeTab()?.webView?.let { if (it.canGoBack()) it.goBack() } }
        forwardButton.setOnClickListener { activeTab()?.webView?.let { if (it.canGoForward()) it.goForward() } }
        reloadButton.setOnClickListener { activeTab()?.webView?.reload() }
        bookmarkButton.setOnClickListener { toggleBookmark() }
        newIdentityButton.setOnClickListener {
            torController.newIdentity()
            activeTab()?.webView?.reload()
        }
        findViewById<View>(R.id.menuButton).setOnClickListener { showOverflowMenu(it) }

        addressBar.setOnEditorActionListener { _, actionId, event ->
            val isGo = actionId == EditorInfo.IME_ACTION_GO ||
                (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (isGo) {
                navigate(addressBar.text.toString())
                true
            } else {
                false
            }
        }
    }

    private fun showOverflowMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        popup.menu.add(0, 1, 0, R.string.action_bookmarks)
        popup.menu.add(0, 2, 1, R.string.action_downloads)
        popup.menu.add(0, 3, 2, R.string.action_history)
        popup.menu.add(0, 4, 3, R.string.action_settings)
        popup.setOnMenuItemClickListener { item ->
            val target = when (item.itemId) {
                1 -> BookmarksActivity::class.java
                2 -> DownloadsActivity::class.java
                3 -> HistoryActivity::class.java
                4 -> SettingsActivity::class.java
                else -> null
            }
            if (target != null) startActivity(Intent(this, target))
            true
        }
        popup.show()
    }

    private fun activeTab(): BrowserTab? = tabs.find { it.id == activeTabId }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createTab(initialUrl: String?) {
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true

        val tab = BrowserTab(UUID.randomUUID().toString(), webView)

        webView.webViewClient = PrivacyWebViewClient(
            onUrlChanged = { url ->
                tab.url = url
                if (tab.id == activeTabId) {
                    addressBar.setText(url)
                    updateBookmarkIcon()
                    updateNavButtons()
                }
                historyStore.record(url, tab.title)
                tabAdapter.notifyDataSetChanged()
            },
            onLoadingStateChanged = { loading ->
                if (tab.id == activeTabId) {
                    reloadButton.setImageResource(
                        if (loading) android.R.drawable.ic_menu_close_clear_cancel else android.R.drawable.ic_menu_rotate
                    )
                }
            },
        )
        webView.webChromeClient = PrivacyWebChromeClient(
            onTitleChanged = { title ->
                tab.title = title
                historyStore.record(tab.url, title)
                tabAdapter.notifyDataSetChanged()
            },
        )
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            DownloadHandler.enqueue(this, url, userAgent, contentDisposition, mimeType)
        }
        WebViewInjection.installDocumentStartScript(webView)

        tabs.add(tab)
        webViewContainer.addView(webView)
        webView.visibility = View.GONE

        webView.loadUrl(initialUrl ?: "about:blank")

        tabAdapter.notifyDataSetChanged()
        activateTab(tab)
    }

    private fun activateTab(tab: BrowserTab) {
        activeTabId = tab.id
        for (t in tabs) {
            t.webView.visibility = if (t.id == tab.id) View.VISIBLE else View.GONE
        }
        addressBar.setText(if (tab.url.isBlank() || tab.url == "about:blank") "" else tab.url)
        updateNavButtons()
        updateBookmarkIcon()
        tabAdapter.notifyDataSetChanged()
    }

    private fun closeTab(tab: BrowserTab) {
        val index = tabs.indexOf(tab)
        if (index == -1) return
        tabs.removeAt(index)
        webViewContainer.removeView(tab.webView)
        tab.webView.destroy()

        if (activeTabId == tab.id) {
            val next = tabs.getOrNull(index) ?: tabs.getOrNull(index - 1)
            if (next != null) activateTab(next) else createTab(null)
        }
        tabAdapter.notifyDataSetChanged()
    }

    private fun navigate(input: String) {
        val tab = activeTab() ?: return
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return
        val url = when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            Regex("^[\\w-]+(\\.[\\w-]+)+").containsMatchIn(trimmed) && !trimmed.contains(" ") -> "https://$trimmed"
            else -> "https://duckduckgo.com/?q=" + Uri.encode(trimmed)
        }
        tab.webView.loadUrl(url)
    }

    private fun updateNavButtons() {
        val webView = activeTab()?.webView
        backButton.isEnabled = webView?.canGoBack() == true
        forwardButton.isEnabled = webView?.canGoForward() == true
    }

    private fun updateBookmarkIcon() {
        val tab = activeTab() ?: return
        val bookmarked = tab.url.isNotBlank() && bookmarkStore.isBookmarked(tab.url)
        bookmarkButton.setImageResource(
            if (bookmarked) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off
        )
    }

    private fun toggleBookmark() {
        val tab = activeTab() ?: return
        if (tab.url.isBlank()) return
        if (bookmarkStore.isBookmarked(tab.url)) {
            bookmarkStore.removeByUrl(tab.url)
        } else {
            bookmarkStore.add(tab.url, tab.title)
        }
        updateBookmarkIcon()
    }

    private fun observeTorStatus() {
        torController.onStatusChanged = { status ->
            runOnUiThread {
                torStatusText.text = when (status) {
                    DagoTorController.Status.ON -> getString(R.string.tor_status_connected)
                    DagoTorController.Status.STARTING -> getString(R.string.tor_status_starting)
                    DagoTorController.Status.OFF -> getString(R.string.tor_status_unavailable)
                }
            }
        }
    }
}
