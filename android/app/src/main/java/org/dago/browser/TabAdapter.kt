package org.dago.browser

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView

class TabAdapter(
    private val tabs: MutableList<BrowserTab>,
    private val activeTabId: () -> String?,
    private val onSelect: (BrowserTab) -> Unit,
    private val onClose: (BrowserTab) -> Unit,
) : RecyclerView.Adapter<TabAdapter.TabViewHolder>() {

    class TabViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: android.widget.TextView = view.findViewById(R.id.tabTitle)
        val close: android.widget.TextView = view.findViewById(R.id.tabClose)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TabViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_tab, parent, false)
        return TabViewHolder(view)
    }

    override fun onBindViewHolder(holder: TabViewHolder, position: Int) {
        val tab = tabs[position]
        holder.title.text = tab.title
        holder.title.alpha = if (tab.id == activeTabId()) 1.0f else 0.6f
        holder.itemView.setOnClickListener { onSelect(tab) }
        holder.close.setOnClickListener { onClose(tab) }
    }

    override fun getItemCount(): Int = tabs.size
}
