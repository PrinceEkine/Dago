package org.dago.browser

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager

class HistoryActivity : AppCompatActivity() {
    private lateinit var pinStore: PinStore
    private lateinit var historyStore: HistoryStore
    private lateinit var adapter: HistoryEntryAdapter
    private var allEntries: List<HistoryStore.Entry> = emptyList()
    private var isFirstTimeSetup = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_history)

        pinStore = PinStore(this)
        historyStore = HistoryStore(this)

        val pinGate = findViewById<android.view.View>(R.id.pinGate)
        val historyView = findViewById<android.view.View>(R.id.historyView)
        val pinInstructions = findViewById<android.widget.TextView>(R.id.pinInstructions)
        val pinInput = findViewById<android.widget.EditText>(R.id.pinInput)
        val pinSubmitButton = findViewById<android.widget.Button>(R.id.pinSubmitButton)
        val pinError = findViewById<android.widget.TextView>(R.id.pinError)
        val searchBox = findViewById<android.widget.EditText>(R.id.searchBox)
        val emptyMessage = findViewById<android.widget.TextView>(R.id.emptyMessage)
        val historyList = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.historyList)
        val lockButton = findViewById<android.widget.Button>(R.id.lockButton)
        val clearButton = findViewById<android.widget.Button>(R.id.clearButton)

        adapter = HistoryEntryAdapter(mutableListOf()) { displayIndex ->
            historyStore.removeEntry(displayIndex)
            refreshList(historyView, pinGate, emptyMessage)
        }
        historyList.layoutManager = LinearLayoutManager(this)
        historyList.adapter = adapter

        fun showPinGate(firstTime: Boolean) {
            isFirstTimeSetup = firstTime
            pinInstructions.setText(
                if (firstTime) R.string.history_pin_setup_title else R.string.history_pin_unlock_title
            )
            pinSubmitButton.setText(if (firstTime) R.string.history_set_pin else R.string.history_unlock)
            pinGate.visibility = android.view.View.VISIBLE
            historyView.visibility = android.view.View.GONE
        }

        pinSubmitButton.setOnClickListener {
            pinError.text = ""
            val pin = pinInput.text.toString()
            val ok = if (isFirstTimeSetup) pinStore.setPin(pin) else pinStore.verify(pin)
            if (!ok) {
                pinError.text = if (isFirstTimeSetup) "PIN must be at least 4 digits." else getString(R.string.history_incorrect_pin)
                pinInput.text.clear()
                return@setOnClickListener
            }
            pinGate.visibility = android.view.View.GONE
            historyView.visibility = android.view.View.VISIBLE
            refreshList(historyView, pinGate, emptyMessage)
        }

        lockButton.setOnClickListener {
            pinStore.lock()
            pinInput.text.clear()
            showPinGate(false)
        }

        clearButton.setOnClickListener {
            historyStore.clear()
            refreshList(historyView, pinGate, emptyMessage)
        }

        searchBox.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                val query = s?.toString()?.lowercase().orEmpty()
                val filtered = allEntries.filter {
                    it.title.lowercase().contains(query) || it.url.lowercase().contains(query)
                }
                adapter.submit(filtered)
                emptyMessage.visibility = if (filtered.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE
            }
        })

        showPinGate(!pinStore.isSet())
    }

    private fun refreshList(historyView: android.view.View, pinGate: android.view.View, emptyMessage: android.widget.TextView) {
        allEntries = historyStore.list()
        adapter.submit(allEntries)
        emptyMessage.visibility = if (allEntries.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE
    }
}
