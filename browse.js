// VaultExport — browse.js

const $ = id => document.getElementById(id);

let allConvos = [];
let filteredConvos = [];
let selectedIds = new Set();
let platform = null;

// =====================================================================
// INIT
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Get platform from URL query string
  const params = new URLSearchParams(location.search);
  platform = params.get('platform') || 'chatgpt';

  // Setup platform badge
  const badge = $('platform-badge');
  badge.textContent = platform === 'chatgpt' ? '🤖 ChatGPT' : '🧠 Claude';
  badge.className = `platform-badge platform-${platform}`;
  document.title = `VaultExport — ${platform === 'chatgpt' ? 'ChatGPT' : 'Claude'} Conversations`;

  // Load saved preferences
  const prefs = await new Promise(r => chrome.storage.local.get(['defaultFormat', 'recallOsMode'], r));
  if (prefs.defaultFormat) $('format-select').value = prefs.defaultFormat;
  if (prefs.recallOsMode) $('recallos-toggle').checked = true;

  // Listen for bulk progress from background
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'BULK_PROGRESS') updateProgress(msg.payload);
  });

  // Wire up controls
  $('search').addEventListener('input', () => renderTable());
  $('sort-select').addEventListener('change', () => renderTable());
  $('refresh-btn').addEventListener('click', loadConvos);
  $('select-all-btn').addEventListener('click', selectAllVisible);
  $('deselect-btn').addEventListener('click', deselectAll);
  $('header-cb').addEventListener('change', e => {
    if (e.target.checked) selectAllVisible(); else deselectAll();
  });
  $('export-selected-btn').addEventListener('click', exportSelected);

  // Load conversations
  await loadConvos();
});

// =====================================================================
// LOAD
// =====================================================================
async function loadConvos() {
  showState('loading');
  selectedIds.clear();
  updateBulkBar();

  try {
    const res = await chrome.runtime.sendMessage({ type: 'LIST_CONVOS', payload: { platform } });
    if (res?.error) throw new Error(res.error);

    allConvos = res.conversations || [];
    $('conv-count').textContent = `${allConvos.length} conversations`;
    renderTable();
    showState('table');
  } catch (err) {
    showState('error', err.message);
  }
}

// =====================================================================
// RENDER TABLE
// =====================================================================
function renderTable() {
  const query = $('search').value.toLowerCase().trim();
  const sort = $('sort-select').value;

  // Filter
  filteredConvos = query
    ? allConvos.filter(c => c.title.toLowerCase().includes(query))
    : [...allConvos];

  // Sort
  filteredConvos.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    const dateA = new Date(sort === 'created' ? a.created_at : a.updated_at || a.created_at || 0);
    const dateB = new Date(sort === 'created' ? b.created_at : b.updated_at || b.created_at || 0);
    return dateB - dateA;
  });

  $('conv-count').textContent = `${filteredConvos.length} of ${allConvos.length} conversations`;

  const tbody = $('conv-tbody');
  tbody.innerHTML = '';

  if (!filteredConvos.length) {
    showState('empty');
    return;
  }
  showState('table');

  for (const conv of filteredConvos) {
    const tr = document.createElement('tr');
    if (selectedIds.has(conv.id)) tr.classList.add('selected');

    tr.innerHTML = `
      <td><input type="checkbox" class="cb row-cb" data-id="${conv.id}" ${selectedIds.has(conv.id) ? 'checked' : ''}></td>
      <td class="title-cell" title="${esc(conv.title)}">${esc(conv.title)}</td>
      <td class="date-cell">${fmtDate(conv.updated_at)}</td>
      <td class="date-cell">${fmtDate(conv.created_at)}</td>
      <td class="model-cell">${esc(conv.model || '—')}</td>
      <td>
        <button class="btn btn-secondary export-one-btn" data-id="${conv.id}" style="padding:4px 10px;font-size:11.5px">Export</button>
      </td>`;

    // Row click to toggle
    tr.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      const cb = tr.querySelector('.row-cb');
      cb.checked = !cb.checked;
      toggleSelect(conv.id, cb.checked, tr);
    });

    tr.querySelector('.row-cb').addEventListener('change', e => {
      toggleSelect(conv.id, e.target.checked, tr);
    });

    tr.querySelector('.export-one-btn').addEventListener('click', e => {
      e.stopPropagation();
      exportOne(conv.id, conv.title);
    });

    tbody.appendChild(tr);
  }

  // Sync header checkbox
  const allVisible = filteredConvos.every(c => selectedIds.has(c.id));
  $('header-cb').checked = filteredConvos.length > 0 && allVisible;
  $('header-cb').indeterminate = !allVisible && filteredConvos.some(c => selectedIds.has(c.id));
}

// =====================================================================
// SELECTION
// =====================================================================
function toggleSelect(id, checked, tr) {
  if (checked) { selectedIds.add(id); tr.classList.add('selected'); }
  else { selectedIds.delete(id); tr.classList.remove('selected'); }
  updateBulkBar();
}

function selectAllVisible() {
  filteredConvos.forEach(c => selectedIds.add(c.id));
  document.querySelectorAll('.row-cb').forEach(cb => cb.checked = true);
  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.add('selected'));
  $('header-cb').checked = true;
  updateBulkBar();
}

function deselectAll() {
  selectedIds.clear();
  document.querySelectorAll('.row-cb').forEach(cb => cb.checked = false);
  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('selected'));
  $('header-cb').checked = false;
  $('header-cb').indeterminate = false;
  updateBulkBar();
}

function updateBulkBar() {
  const count = selectedIds.size;
  $('selected-count').textContent = count;
  $('bulk-bar').classList.toggle('hidden', count === 0);
  $('export-selected-btn').textContent = `⬇️ Export ${count} Selected (ZIP)`;
}

// =====================================================================
// EXPORT
// =====================================================================
async function exportOne(id, title) {
  const btn = document.querySelector(`.export-one-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'EXPORT_CURRENT',
      payload: {
        platform,
        conversationId: id,
        format: $('format-select').value,
        recallOsMode: $('recallos-toggle').checked,
      },
    });
    if (res?.error) alert('Export failed: ' + res.error);
    else if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Export'; }, 2000); }
  } catch (err) {
    alert('Export error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function exportSelected() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  const format = $('format-select').value;
  const recallOsMode = $('recallos-toggle').checked;

  // Note: DOCX not supported in bulk (only MD/JSON/TXT/HTML/CSV)
  if (format === 'docx') {
    alert('DOCX format is not supported for bulk export due to file size constraints. Please use Markdown, JSON, or another text format for bulk exports.');
    return;
  }

  showProgress(0, ids.length, 'Starting…');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'EXPORT_BULK',
      payload: { platform, conversationIds: ids, format, recallOsMode },
    });

    hideProgress();

    if (res?.error) {
      alert('Bulk export failed: ' + res.error);
    } else {
      const msg = `✅ Exported ${res.success} conversations` +
        (res.failed ? ` (${res.failed} failed)` : '') +
        '. ZIP saved to your Downloads folder.';
      alert(msg);
      deselectAll();
    }
  } catch (err) {
    hideProgress();
    alert('Bulk export error: ' + err.message);
  }
}

// =====================================================================
// PROGRESS
// =====================================================================
function showProgress(current, total, detail) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $('progress-bar').style.width = `${pct}%`;
  $('progress-text').textContent = `${current} / ${total}`;
  $('progress-detail').textContent = detail;
  $('progress-overlay').classList.add('visible');
}

function updateProgress({ current, total, id }) {
  const convo = allConvos.find(c => c.id === id);
  showProgress(current, total, convo ? convo.title : id);
}

function hideProgress() {
  $('progress-overlay').classList.remove('visible');
}

// =====================================================================
// UI HELPERS
// =====================================================================
function showState(state, msg) {
  $('loading').classList.add('hidden');
  $('empty').classList.add('hidden');
  $('error-state').classList.add('hidden');
  $('conv-table').classList.add('hidden');

  if (state === 'loading') $('loading').classList.remove('hidden');
  else if (state === 'empty') $('empty').classList.remove('hidden');
  else if (state === 'error') { $('error-state').textContent = '❌ ' + msg; $('error-state').classList.remove('hidden'); }
  else if (state === 'table') $('conv-table').classList.remove('hidden');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) { try { return iso ? new Date(iso).toLocaleDateString() : '—'; } catch { return '—'; } }
