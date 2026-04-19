// VaultExport — options.js

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  // Load existing settings
  const s = await new Promise(r =>
    chrome.storage.local.get(['claudeOrgId', 'defaultFormat', 'recallOsMode', 'lastExportAt'], r)
  );

  if (s.claudeOrgId) $('claude-org-id').value = s.claudeOrgId;
  if (s.defaultFormat) $('default-format').value = s.defaultFormat;
  if (s.recallOsMode) $('default-recallos').checked = true;
  if (s.lastExportAt) {
    $('last-export').textContent = `Last export: ${new Date(s.lastExportAt).toLocaleString()}`;
  }

  // Save
  $('save-btn').addEventListener('click', async () => {
    const orgId = $('claude-org-id').value.trim();
    const format = $('default-format').value;
    const recallos = $('default-recallos').checked;

    // Basic UUID validation for org ID
    if (orgId && !/^[a-f0-9-]{36}$/.test(orgId)) {
      showStatus('save-status', '❌ Organization ID looks invalid. It should be a UUID like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'error');
      return;
    }

    await chrome.storage.local.set({ claudeOrgId: orgId, defaultFormat: format, recallOsMode: recallos });
    showStatus('save-status', '✅ Settings saved!', 'success');
    setTimeout(() => hideStatus('save-status'), 3000);
  });

  // Test Claude connection
  $('test-btn').addEventListener('click', async () => {
    const orgId = $('claude-org-id').value.trim();
    if (!orgId) {
      showStatus('test-result', '❌ Enter your Organization ID first.', 'error');
      return;
    }

    $('test-btn').textContent = 'Testing…';
    $('test-btn').disabled = true;

    try {
      const res = await fetch(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=1`,
        { credentials: 'include', headers: { 'Content-Type': 'application/json' } }
      );

      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data) ? data.length : '?';
        showStatus('test-result', `✅ Connection successful! Found conversations. Your Org ID is valid.`, 'success');
      } else if (res.status === 401 || res.status === 403) {
        showStatus('test-result', '❌ Authentication failed. Make sure you are logged into claude.ai and the Org ID is correct.', 'error');
      } else {
        showStatus('test-result', `❌ API returned ${res.status}. Check your Org ID.`, 'error');
      }
    } catch (err) {
      showStatus('test-result', `❌ Connection failed: ${err.message}. Make sure you're on claude.ai or open it in another tab first.`, 'error');
    } finally {
      $('test-btn').textContent = 'Test Claude Connection';
      $('test-btn').disabled = false;
    }
  });
});

function showStatus(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${type}`;
}

function hideStatus(id) {
  $(id).className = 'status';
}
