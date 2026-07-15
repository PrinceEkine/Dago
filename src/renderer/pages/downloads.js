'use strict';

const downloadListEl = document.getElementById('download-list');
const emptyMsg = document.getElementById('empty-msg');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function statusLabel(entry) {
  if (entry.state === 'progressing') {
    const pct = entry.totalBytes ? Math.round((entry.receivedBytes / entry.totalBytes) * 100) : null;
    return pct !== null ? `Downloading… ${pct}% (${formatBytes(entry.receivedBytes)} / ${formatBytes(entry.totalBytes)})` : `Downloading… ${formatBytes(entry.receivedBytes)}`;
  }
  if (entry.state === 'completed') return `Done - ${formatBytes(entry.receivedBytes)}`;
  if (entry.state === 'cancelled') return 'Cancelled';
  return 'Interrupted';
}

async function refresh() {
  const downloads = await window.dago.downloads.list();
  downloadListEl.innerHTML = '';
  emptyMsg.classList.toggle('hidden', downloads.length > 0);

  downloads.forEach((entry) => {
    const li = document.createElement('li');
    const actions = [];
    if (entry.state === 'progressing') {
      actions.push(`<button class="dl-cancel" data-id="${entry.id}">Cancel</button>`);
    } else {
      if (entry.state === 'completed') {
        actions.push(`<button class="dl-open" data-id="${entry.id}">Open</button>`);
        actions.push(`<button class="dl-show" data-id="${entry.id}">Show in folder</button>`);
      }
      actions.push(`<span class="entry-remove" data-id="${entry.id}">&times;</span>`);
    }

    li.innerHTML = `
      <div style="overflow:hidden">
        <div class="entry-title">${escapeHtml(entry.filename)}</div>
        <div class="entry-url">${statusLabel(entry)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">${actions.join('')}</div>
    `;
    downloadListEl.appendChild(li);
  });

  downloadListEl.querySelectorAll('.dl-cancel').forEach((el) => {
    el.addEventListener('click', async (e) => {
      await window.dago.downloads.cancel(e.target.getAttribute('data-id'));
      refresh();
    });
  });
  downloadListEl.querySelectorAll('.dl-open').forEach((el) => {
    el.addEventListener('click', (e) => window.dago.downloads.openFile(e.target.getAttribute('data-id')));
  });
  downloadListEl.querySelectorAll('.dl-show').forEach((el) => {
    el.addEventListener('click', (e) => window.dago.downloads.showInFolder(e.target.getAttribute('data-id')));
  });
  downloadListEl.querySelectorAll('.entry-remove').forEach((el) => {
    el.addEventListener('click', async (e) => {
      await window.dago.downloads.remove(e.target.getAttribute('data-id'));
      refresh();
    });
  });
}

refresh();
setInterval(refresh, 1000); // simple polling instead of a push channel - fine at this list size/update rate
