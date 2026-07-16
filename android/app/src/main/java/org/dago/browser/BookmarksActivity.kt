package org.dago.browser

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager

class BookmarksActivity : AppCompatActivity() {
    private lateinit var bookmarkStore: BookmarkStore
    private lateinit var adapter: BookmarkAdapter
    private var allBookmarks: List<BookmarkStore.Bookmark> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_bookmarks)

        bookmarkStore = BookmarkStore(this)
        val emptyMessage = findViewById<android.widget.TextView>(R.id.emptyMessage)
        val list = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.bookmarkList)
        val searchBox = findViewById<android.widget.EditText>(R.id.searchBox)

        adapter = BookmarkAdapter(mutableListOf()) { bookmark ->
            bookmarkStore.removeById(bookmark.id)
            refresh(emptyMessage)
        }
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        searchBox.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                val query = s?.toString()?.lowercase().orEmpty()
                val filtered = allBookmarks.filter {
                    it.title.lowercase().contains(query) || it.url.lowercase().contains(query)
                }
                adapter.submit(filtered)
            }
        })

        refresh(emptyMessage)
    }

    override fun onResume() {
        super.onResume()
        refresh(findViewById(R.id.emptyMessage))
    }

    private fun refresh(emptyMessage: android.widget.TextView) {
        allBookmarks = bookmarkStore.list()
        adapter.submit(allBookmarks)
        emptyMessage.visibility = if (allBookmarks.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE
    }
}
