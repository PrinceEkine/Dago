package org.dago.browser

import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import java.util.concurrent.Executors

class SettingsActivity : AppCompatActivity() {
    private lateinit var filterListRepository: FilterListRepository
    private lateinit var pinStore: PinStore
    private lateinit var searchProviderStore: SearchProviderStore
    private lateinit var adapter: FilterListAdapter
    private lateinit var searchProviderAdapter: SearchProviderAdapter
    private val backgroundExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        filterListRepository = FilterListRepository(this)
        pinStore = PinStore(this)
        searchProviderStore = SearchProviderStore(this)

        findViewById<android.widget.TextView>(R.id.torStatusDesc).text =
            "Each tab shares one Tor circuit on Android (see android/README.md for why this differs from desktop's per-tab isolation)."
        findViewById<android.widget.TextView>(R.id.adblockStatusDesc).text =
            "Enabled - blocking known ad/tracker domains by default, plus any enabled subscriptions below."
        findViewById<android.widget.TextView>(R.id.versionDesc).text = "Dago Android 0.1.0-alpha"

        val recycler = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.filterListRecycler)
        adapter = FilterListAdapter(
            mutableListOf(),
            onToggle = { sub, enabled ->
                filterListRepository.setEnabled(sub.id, enabled)
                refreshList()
            },
            onUpdate = { sub, button ->
                button.isEnabled = false
                button.text = "Updating…"
                backgroundExecutor.execute {
                    val result = filterListRepository.update(sub.id)
                    runOnUiThread {
                        button.isEnabled = true
                        button.text = "Update"
                        if (result.isFailure) {
                            Toast.makeText(this, "Update failed: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                        }
                        refreshList()
                    }
                }
            },
            onRemove = { sub ->
                filterListRepository.remove(sub.id)
                refreshList()
            },
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter

        val searchRecycler = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.searchProviderRecycler)
        searchProviderAdapter = SearchProviderAdapter(
            mutableListOf(),
            onSelect = { provider ->
                searchProviderStore.setActive(provider.id)
                refreshSearchProviders()
            },
            onRemove = { provider ->
                searchProviderStore.remove(provider.id)
                refreshSearchProviders()
            },
        )
        searchRecycler.layoutManager = LinearLayoutManager(this)
        searchRecycler.adapter = searchProviderAdapter

        findViewById<Button>(R.id.addProviderButton).setOnClickListener {
            val name = findViewById<android.widget.EditText>(R.id.newProviderName).text.toString().trim()
            val url = findViewById<android.widget.EditText>(R.id.newProviderUrl).text.toString().trim()
            val error = findViewById<android.widget.TextView>(R.id.searchProviderError)
            val result = searchProviderStore.add(name, url)
            if (result.isSuccess) {
                error.text = ""
                findViewById<android.widget.EditText>(R.id.newProviderName).text.clear()
                findViewById<android.widget.EditText>(R.id.newProviderUrl).text.clear()
                refreshSearchProviders()
            } else {
                error.text = result.exceptionOrNull()?.message ?: "Could not add search engine."
            }
        }

        findViewById<Button>(R.id.updateAllButton).setOnClickListener { button ->
            (button as Button).isEnabled = false
            backgroundExecutor.execute {
                for (sub in filterListRepository.list()) filterListRepository.update(sub.id)
                runOnUiThread {
                    button.isEnabled = true
                    refreshList()
                }
            }
        }

        findViewById<Button>(R.id.addListButton).setOnClickListener {
            val name = findViewById<android.widget.EditText>(R.id.newListName).text.toString().trim()
            val url = findViewById<android.widget.EditText>(R.id.newListUrl).text.toString().trim()
            val error = findViewById<android.widget.TextView>(R.id.filterListError)
            if (filterListRepository.add(name, url)) {
                error.text = ""
                findViewById<android.widget.EditText>(R.id.newListName).text.clear()
                findViewById<android.widget.EditText>(R.id.newListUrl).text.clear()
                refreshList()
            } else {
                error.text = "Name is required and URL must start with https://"
            }
        }

        findViewById<Button>(R.id.resetPinButton).setOnClickListener {
            if (!pinStore.unlocked) {
                Toast.makeText(this, "Unlock History with your current PIN first, then come back here.", Toast.LENGTH_LONG).show()
            } else {
                pinStore.reset()
                Toast.makeText(this, "PIN reset. You'll be asked to set a new one next time you open History.", Toast.LENGTH_LONG).show()
            }
        }

        refreshList()
        refreshSearchProviders()
    }

    private fun refreshList() {
        adapter.submit(filterListRepository.list())
    }

    private fun refreshSearchProviders() {
        searchProviderAdapter.submit(searchProviderStore.list())
    }
}
