package org.dago.browser

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.text.DateFormat

class BookmarkAdapter(
    private val bookmarks: MutableList<BookmarkStore.Bookmark>,
    private val onRemove: (BookmarkStore.Bookmark) -> Unit,
) : RecyclerView.Adapter<BookmarkAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.entryTitle)
        val url: TextView = view.findViewById(R.id.entryUrl)
        val remove: TextView = view.findViewById(R.id.entryRemove)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_history_entry, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val bookmark = bookmarks[position]
        holder.title.text = bookmark.title
        holder.url.text = "${bookmark.url} - ${DateFormat.getDateInstance().format(bookmark.createdAt)}"
        holder.remove.setOnClickListener { onRemove(bookmark) }
    }

    override fun getItemCount(): Int = bookmarks.size

    fun submit(newBookmarks: List<BookmarkStore.Bookmark>) {
        bookmarks.clear()
        bookmarks.addAll(newBookmarks)
        notifyDataSetChanged()
    }
}
