// VaultExport — popup.js

let context = null; // { platform, conversationId, url }
let selectedFormat = 'markdown';

const $ = id => document.getElementById(id);

// =====================================================================
// INIT
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved preferences
  const prefs = await new Promise(r => chrome.storage.local.get(['defaultFormat', 'recallOsMode'], r));
  if (prefs.defaultFormat) {
    selectedFormat = prefs.defaultFormat;
    document.querySelectorAll('.fmt-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.fmt === selectedFormat);
    });
  }
  if (prefs.recallOsMode) $('recallos-toggle').checked = true;

  // Get current tab context
  await detectContext();

  // Wire up format buttons
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.dataset.fmt;
      chrome.storage.local.set({ defaultFormat: selectedFormat });
    });
  });

  // RecallOS toggle
  $('recallos-toggle').addEventListener('change', e => {
    chrome.storage.local.set({ recallOsMode: e.target.checked });
  });

  // Export button
  $('export-btn').addEventListener('click', doExport);

  // Navigation
  $('open-options').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const openBrowse = e => {
    e.preventDefault();
    if (!context?.platform) {
      setStatus('Open a ChatGPT or Claude page first.', 'error');
      return;
    }
    const url = chrome.runtime.getURL(`browse.html?platform=${context.platform}`);
    chrome.tabs.create({ url });
    window.close();
  };
  $('open-browse').addEventListener('click', openBrowse);
  $('browse-link').addEventListener('click', openBrowse);
});

// =====================================================================
// CONTEXT DETECTION
// =====================================================================
async function detectContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showNoContext();

    const res = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT' });
    if (res?.error || !res?.platform) return showNoContext();

    context = res;
    showContext(res);
  } catch {
    showNoContext();
  }
}

function showNoContext() {
  $('no-context').classList.remove('hidden');
  $('has-context').classList.add('hidden');
  $('export-panel').classList.add('hidden');
}

function showContext({ platform, conversationId, url }) {
  $('no-context').classList.add('hidden');
  $('has-context').classList.remove('hidden');

  const badge = $('platform-badge');
  badge.textContent = platform === 'chatgpt' ? '🤖 ChatGPT' : '🧠 Claude';
  badge.className = `context-badge context-badge--${platform}`;

  if (!conversationId) {
    $('conv-title').textContent = 'Navigate to a conversation to export';
    $('export-panel').classList.add('hidden');
  } else {
    $('conv-title').textContent = `Conversation ready`;
    $('export-panel').classList.remove('hidden');
  }
}

// =====================================================================
// EXPORT
// =====================================================================
async function doExport() {
  if (!context?.conversationId) {
    setStatus('No conversation selected. Open a chat first.', 'error');
    return;
  }

  const btn = $('export-btn');
  const recallOsMode = $('recallos-toggle').checked;

  btn.disabled = true;
  btn.textContent = 'Exporting…';
  setStatus('Fetching conversation…', 'info');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'EXPORT_CURRENT',
      payload: {
        platform: context.platform,
        conversationId: context.conversationId,
        format: selectedFormat,
        recallOsMode,
      },
    });

    if (res?.error) {
      setStatus('❌ ' + res.error, 'error');
    } else if (res?.success) {
      const msg = recallOsMode
        ? `✅ Saved to recallos/${context.platform}/ — run recallos ingest to index`
        : `✅ Exported "${res.title}" (${res.messageCount} messages)`;
      setStatus(msg, 'success');
    }
  } catch (err) {
    setStatus('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Conversation`;
  }
}

// =====================================================================
// STATUS
// =====================================================================
function setStatus(msg, type = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status status--${type}`;
  el.classList.remove('hidden');
}
