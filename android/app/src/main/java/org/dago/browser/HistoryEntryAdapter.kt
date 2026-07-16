package org.dago.browser

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.text.DateFormat

class HistoryEntryAdapter(
    private val entries: MutableList<HistoryStore.Entry>,
    private val onRemove: (Int) -> Unit,
) : RecyclerView.Adapter<HistoryEntryAdapter.ViewHolder>() {

    class ViewHolder(view: android.view.View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.entryTitle)
        val url: TextView = view.findViewById(R.id.entryUrl)
        val remove: TextView = view.findViewById(R.id.entryRemove)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_history_entry, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val entry = entries[position]
        holder.title.text = entry.title
        holder.url.text = "${entry.url} - ${DateFormat.getDateTimeInstance().format(entry.timestamp)}"
        holder.remove.setOnClickListener { onRemove(position) }
    }

    override fun getItemCount(): Int = entries.size

    fun submit(newEntries: List<HistoryStore.Entry>) {
        entries.clear()
        entries.addAll(newEntries)
        notifyDataSetChanged()
    }
}
