package org.dago.browser

import android.app.DownloadManager
import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

class DownloadsActivity : AppCompatActivity() {

    data class DownloadRow(val title: String, val statusText: String)

    private class DownloadAdapter(private val rows: MutableList<DownloadRow>) :
        RecyclerView.Adapter<DownloadAdapter.ViewHolder>() {

        class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val title: TextView = view.findViewById(R.id.entryTitle)
            val status: TextView = view.findViewById(R.id.entryUrl)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_history_entry, parent, false)
            view.findViewById<View>(R.id.entryRemove).visibility = View.GONE
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            holder.title.text = rows[position].title
            holder.status.text = rows[position].statusText
        }

        override fun getItemCount(): Int = rows.size

        fun submit(newRows: List<DownloadRow>) {
            rows.clear()
            rows.addAll(newRows)
            notifyDataSetChanged()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_downloads)

        val emptyMessage = findViewById<TextView>(R.id.emptyMessage)
        val list = findViewById<RecyclerView>(R.id.downloadList)
        val adapter = DownloadAdapter(mutableListOf())
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        val rows = queryDownloads()
        adapter.submit(rows)
        emptyMessage.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun queryDownloads(): List<DownloadRow> {
        val downloadManager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        // Query() with no filter returns every download this app enqueued
        // (DownloadManager scopes results to the calling app already).
        val cursor = downloadManager.query(DownloadManager.Query())
        val rows = mutableListOf<DownloadRow>()
        cursor.use {
            val titleIdx = it.getColumnIndex(DownloadManager.COLUMN_TITLE)
            val statusIdx = it.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val totalIdx = it.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val soFarIdx = it.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            while (it.moveToNext()) {
                val title = if (titleIdx >= 0) it.getString(titleIdx) else "Download"
                val status = if (statusIdx >= 0) it.getInt(statusIdx) else -1
                val statusText = when (status) {
                    DownloadManager.STATUS_SUCCESSFUL -> "Done"
                    DownloadManager.STATUS_RUNNING -> {
                        val total = if (totalIdx >= 0) it.getLong(totalIdx) else 0L
                        val soFar = if (soFarIdx >= 0) it.getLong(soFarIdx) else 0L
                        if (total > 0) "Downloading… ${(soFar * 100 / total)}%" else "Downloading…"
                    }
                    DownloadManager.STATUS_FAILED -> "Failed"
                    DownloadManager.STATUS_PAUSED -> "Paused"
                    DownloadManager.STATUS_PENDING -> "Pending"
                    else -> "Unknown"
                }
                rows.add(DownloadRow(title ?: "Download", statusText))
            }
        }
        return rows
    }
}
