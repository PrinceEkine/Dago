'use strict';

const bookmarkListEl = document.getElementById('bookmark-list');
const emptyMsg = document.getElementById('empty-msg');
const searchBox = document.getElementById('search-box');

let allBookmarks = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderList(bookmarks) {
  bookmarkListEl.innerHTML = '';
  emptyMsg.classList.toggle('hidden', bookmarks.length > 0);
  bookmarks.forEach((bookmark) => {
    const li = document.createElement('li');
    const date = new Date(bookmark.createdAt).toLocaleDateString();
    li.innerHTML = `
      <div style="overflow:hidden">
        <div class="entry-title">${escapeHtml(bookmark.title)}</div>
        <div class="entry-url">${escapeHtml(bookmark.url)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="entry-time">${date}</span>
        <span class="entry-remove" data-id="${bookmark.id}">&times;</span>
      </div>
    `;
    bookmarkListEl.appendChild(li);
  });

  bookmarkListEl.querySelectorAll('.entry-remove').forEach((el) => {
    el.addEventListener('click', async (e) => {
      await window.dago.bookmarks.removeById(e.target.getAttribute('data-id'));
      refresh();
    });
  });
}

async function refresh() {
  allBookmarks = await window.dago.bookmarks.list();
  renderList(allBookmarks);
}

searchBox.addEventListener('input', () => {
  const query = searchBox.value.toLowerCase();
  renderList(allBookmarks.filter((b) => b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query)));
});

refresh();
