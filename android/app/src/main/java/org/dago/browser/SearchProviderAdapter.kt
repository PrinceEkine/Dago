package org.dago.browser

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.RadioButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class SearchProviderAdapter(
    private val providers: MutableList<SearchProviderStore.Provider>,
    private val onSelect: (SearchProviderStore.Provider) -> Unit,
    private val onRemove: (SearchProviderStore.Provider) -> Unit,
) : RecyclerView.Adapter<SearchProviderAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val radio: RadioButton = view.findViewById(R.id.selectedRadio)
        val name: TextView = view.findViewById(R.id.providerName)
        val url: TextView = view.findViewById(R.id.providerUrl)
        val removeButton: Button = view.findViewById(R.id.removeButton)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_search_provider, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val provider = providers[position]
        holder.radio.setOnCheckedChangeListener(null)
        holder.radio.isChecked = provider.active
        holder.name.text = provider.name
        holder.url.text = provider.urlTemplate
        holder.removeButton.visibility = if (provider.builtIn) View.GONE else View.VISIBLE
        holder.radio.setOnCheckedChangeListener { _, checked -> if (checked) onSelect(provider) }
        holder.removeButton.setOnClickListener { onRemove(provider) }
    }

    override fun getItemCount(): Int = providers.size

    fun submit(newProviders: List<SearchProviderStore.Provider>) {
        providers.clear()
        providers.addAll(newProviders)
        notifyDataSetChanged()
    }
}
