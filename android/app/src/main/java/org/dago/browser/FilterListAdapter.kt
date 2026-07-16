package org.dago.browser

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.text.DateFormat

class FilterListAdapter(
    private val subscriptions: MutableList<FilterListRepository.Subscription>,
    private val onToggle: (FilterListRepository.Subscription, Boolean) -> Unit,
    private val onUpdate: (FilterListRepository.Subscription, Button) -> Unit,
    private val onRemove: (FilterListRepository.Subscription) -> Unit,
) : RecyclerView.Adapter<FilterListAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val checkbox: CheckBox = view.findViewById(R.id.enabledCheckbox)
        val name: TextView = view.findViewById(R.id.listName)
        val meta: TextView = view.findViewById(R.id.listMeta)
        val updateButton: Button = view.findViewById(R.id.updateButton)
        val removeButton: Button = view.findViewById(R.id.removeButton)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_filter_list, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val sub = subscriptions[position]
        holder.checkbox.setOnCheckedChangeListener(null)
        holder.checkbox.isChecked = sub.enabled
        holder.name.text = sub.name
        val lastUpdated = sub.lastUpdated?.let { DateFormat.getDateTimeInstance().format(it) } ?: "never updated"
        holder.meta.text = "${sub.url} - ${sub.ruleCount} rules, $lastUpdated"
        holder.checkbox.setOnCheckedChangeListener { _, checked -> onToggle(sub, checked) }
        holder.updateButton.setOnClickListener { onUpdate(sub, holder.updateButton) }
        holder.removeButton.setOnClickListener { onRemove(sub) }
    }

    override fun getItemCount(): Int = subscriptions.size

    fun submit(newSubscriptions: List<FilterListRepository.Subscription>) {
        subscriptions.clear()
        subscriptions.addAll(newSubscriptions)
        notifyDataSetChanged()
    }
}
