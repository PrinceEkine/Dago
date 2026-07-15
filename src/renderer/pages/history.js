'use strict';

const pinGate = document.getElementById('pin-gate');
const pinInstructions = document.getElementById('pin-instructions');
const pinInput = document.getElementById('pin-input');
const pinSubmit = document.getElementById('pin-submit');
const pinError = document.getElementById('pin-error');

const historyView = document.getElementById('history-view');
const historyList = document.getElementById('history-list');
const emptyMsg = document.getElementById('empty-msg');
const searchBox = document.getElementById('search-box');
const lockBtn = document.getElementById('lock-btn');
const clearBtn = document.getElementById('clear-btn');

let allEntries = [];
let isFirstTimeSetup = false;

async function init() {
  const pinSet = await window.dago.history.isPinSet();
  isFirstTimeSetup = !pinSet;
  pinInstructions.textContent = isFirstTimeSetup
    ? 'Set a PIN to protect your browsing history. You will need it every time you open History.'
    : 'Enter your PIN to view browsing history.';
  pinSubmit.textContent = isFirstTimeSetup ? 'Set PIN' : 'Unlock';

  const unlocked = await window.dago.history.isUnlocked();
  if (unlocked) showHistory();
}

async function submitPin() {
  const pin = pinInput.value;
  pinError.textContent = '';

  if (isFirstTimeSetup) {
    const result = await window.dago.history.setPin(pin);
    if (!result.ok) {
      pinError.textContent = result.reason;
      return;
    }
    showHistory();
    return;
  }

  const result = await window.dago.history.verifyPin(pin);
  if (!result.ok) {
    pinError.textContent = 'Incorrect PIN.';
    pinInput.value = '';
    return;
  }
  showHistory();
}

pinSubmit.addEventListener('click', submitPin);
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });

async function showHistory() {
  pinGate.classList.add('hidden');
  historyView.classList.remove('hidden');
  await refreshList();
}

async function refreshList() {
  const { locked, entries } = await window.dago.history.list();
  if (locked) {
    historyView.classList.add('hidden');
    pinGate.classList.remove('hidden');
    return;
  }
  allEntries = entries;
  renderList(allEntries);
}

function renderList(entries) {
  historyList.innerHTML = '';
  emptyMsg.classList.toggle('hidden', entries.length > 0);
  entries.forEach((entry, displayIndex) => {
    const li = document.createElement('li');
    const date = new Date(entry.timestamp).toLocaleString();
    li.innerHTML = `
      <div style="overflow:hidden">
        <div class="entry-title">${escapeHtml(entry.title)}</div>
        <div class="entry-url">${escapeHtml(entry.url)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="entry-time">${date}</span>
        <span class="entry-remove" data-index="${displayIndex}">&times;</span>
      </div>
    `;
    historyList.appendChild(li);
  });

  historyList.querySelectorAll('.entry-remove').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const index = Number(e.target.getAttribute('data-index'));
      await window.dago.history.removeEntry(index);
      refreshList();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

searchBox.addEventListener('input', () => {
  const query = searchBox.value.toLowerCase();
  const filtered = allEntries.filter(
    (e) => e.title.toLowerCase().includes(query) || e.url.toLowerCase().includes(query)
  );
  renderList(filtered);
});

lockBtn.addEventListener('click', async () => {
  await window.dago.history.lock();
  historyView.classList.add('hidden');
  pinGate.classList.remove('hidden');
  pinInput.value = '';
  isFirstTimeSetup = false;
  pinInstructions.textContent = 'Enter your PIN to view browsing history.';
  pinSubmit.textContent = 'Unlock';
});

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all browsing history? This cannot be undone.')) return;
  await window.dago.history.clear();
  refreshList();
});

init();
