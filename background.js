// VaultExport — background.js (Service Worker)
// All API calls, parsing, formatting, and downloads happen here
// to bypass Content Security Policy restrictions on content scripts.

importScripts('lib/jszip.min.js');

// =====================================================================
// MESSAGE ROUTER
// =====================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    GET_CONTEXT:      () => handleGetContext(sender.tab),
    EXPORT_CURRENT:   () => handleExportCurrent(msg.payload),
    LIST_CONVOS:      () => handleListConvos(msg.payload),
    EXPORT_BULK:      () => handleExportBulk(msg.payload),
    GET_SETTINGS:     () => getSettings(),
  };
  const fn = handlers[msg.type];
  if (fn) { fn().then(sendResponse).catch(err => sendResponse({ error: err.message })); return true; }
});

// =====================================================================
// CONTEXT DETECTION
// =====================================================================
async function handleGetContext(tab) {
  // When called from popup, sender.tab is undefined — query the active tab instead
  if (!tab) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  }
  if (!tab?.url) return { platform: null, conversationId: null };
  const url = tab.url;

  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return { platform: 'chatgpt', conversationId: match?.[1] || null, url };
  }
  if (url.includes('claude.ai')) {
    // Handles /chat/{id} and /project/{pid}/chat/{id}
    const match = url.match(/\/chat\/([a-f0-9-]{36})/);
    return { platform: 'claude', conversationId: match?.[1] || null, url };
  }
  return { platform: null, conversationId: null };
}

// =====================================================================
// SETTINGS
// =====================================================================
function getSettings() {
  return new Promise(resolve =>
    chrome.storage.local.get(['claudeOrgId', 'defaultFormat', 'recallOsMode', 'lastExportAt'], resolve)
  );
}

function saveLastExport() {
  chrome.storage.local.set({ lastExportAt: new Date().toISOString() });
}

async function getClaudeOrgId() {
  const s = await getSettings();
  if (!s.claudeOrgId) throw new Error('Claude Organization ID not configured. Open extension Options and paste your Org ID from claude.ai/settings/account.');
  return s.claudeOrgId;
}

// =====================================================================
// CHATGPT — FETCH & PARSE
// =====================================================================
let _chatgptToken = null;
let _chatgptTokenExpiry = 0;

async function getChatGPTToken() {
  // Cache token for 5 minutes
  if (_chatgptToken && Date.now() < _chatgptTokenExpiry) return _chatgptToken;
  const res = await fetch('https://chatgpt.com/api/auth/session', {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Not logged in to ChatGPT. Please sign in at chatgpt.com and try again.');
  const data = await res.json();
  if (!data?.accessToken) throw new Error('Could not get ChatGPT session token. Make sure you are logged in.');
  _chatgptToken = data.accessToken;
  _chatgptTokenExpiry = Date.now() + 5 * 60 * 1000;
  return _chatgptToken;
}

async function fetchChatGPT(path) {
  const token = await getChatGPTToken();
  const res = await fetch(`https://chatgpt.com${path}`, {
    credentials: 'include',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) {
    _chatgptToken = null; // Clear cached token on 401
    throw new Error('ChatGPT session expired. Please reload the chatgpt.com tab and try again.');
  }
  if (!res.ok) throw new Error(`ChatGPT API error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchChatGPTConversation(id) {
  return fetchChatGPT(`/backend-api/conversation/${id}`);
}

async function listChatGPTConversations() {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchChatGPT(`/backend-api/conversations?offset=${offset}&limit=${limit}`);
    const items = data.items || [];
    all.push(...items.map(c => ({
      id: c.id,
      title: c.title || 'Untitled',
      created_at: c.create_time ? new Date(c.create_time * 1000).toISOString() : null,
      updated_at: c.update_time ? new Date(c.update_time * 1000).toISOString() : null,
      platform: 'chatgpt',
    })));
    if (items.length < limit || all.length >= (data.total || all.length)) break;
    offset += limit;
    await sleep(200);
  }
  return { conversations: all, total: all.length };
}

function parseChatGPTConversation(raw) {
  const mapping = raw.mapping || {};
  const chain = [];
  let nodeId = raw.current_node;
  while (nodeId && mapping[nodeId]) {
    chain.unshift(nodeId);
    nodeId = mapping[nodeId].parent;
  }

  const messages = [];
  for (const id of chain) {
    const node = mapping[id];
    if (!node?.message) continue;
    const msg = node.message;
    const role = msg.author?.role;
    if (!role || role === 'tool') continue;
    const content = extractChatGPTContent(msg.content);
    if (!content.trim() && role === 'system') continue;
    if (!content.trim()) continue;

    messages.push({
      role: role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant',
      content,
      timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : null,
      model: msg.metadata?.model_slug || null,
      thinking: null,
      artifacts: null,
    });
  }

  const lastModel = [...messages].reverse().find(m => m.role === 'assistant')?.model;

  return {
    id: raw.id,
    title: raw.title || 'Untitled',
    platform: 'chatgpt',
    model: lastModel || null,
    url: `https://chatgpt.com/c/${raw.id}`,
    created_at: raw.create_time ? new Date(raw.create_time * 1000).toISOString() : null,
    updated_at: raw.update_time ? new Date(raw.update_time * 1000).toISOString() : null,
    exported_at: new Date().toISOString(),
    messages,
  };
}

function extractChatGPTContent(content) {
  if (!content) return '';
  const { content_type, parts, text } = content;
  if (content_type === 'text' || !content_type) {
    if (Array.isArray(parts)) return parts.filter(p => typeof p === 'string').join('');
    if (typeof text === 'string') return text;
  }
  if (content_type === 'multimodal_text' && Array.isArray(parts)) {
    return parts.filter(p => typeof p === 'string').join('');
  }
  if (content_type === 'tether_quote' && typeof content.text === 'string') return content.text;
  if (typeof text === 'string') return text;
  return '';
}

// =====================================================================
// CLAUDE — FETCH & PARSE
// =====================================================================
async function fetchClaude(path) {
  const res = await fetch(`https://claude.ai${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Not authenticated with Claude. Please log in and ensure your Org ID is correct.');
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchClaudeConversation(conversationId) {
  const orgId = await getClaudeOrgId();
  return fetchClaude(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&render_all_tools=true`);
}

async function listClaudeConversations() {
  const orgId = await getClaudeOrgId();
  // Claude paginates with before_id cursor
  const all = [];
  let beforeId = null;

  while (true) {
    const qs = beforeId ? `?limit=100&before_id=${beforeId}` : '?limit=100';
    const data = await fetchClaude(`/api/organizations/${orgId}/chat_conversations${qs}`);
    const items = Array.isArray(data) ? data : (data.conversations || []);
    if (!items.length) break;
    all.push(...items.map(c => ({
      id: c.uuid,
      title: c.name || 'Untitled',
      created_at: c.created_at || null,
      updated_at: c.updated_at || null,
      model: c.model || null,
      platform: 'claude',
    })));
    if (items.length < 100) break;
    beforeId = items[items.length - 1].uuid;
    await sleep(200);
  }
  return { conversations: all, total: all.length };
}

function parseClaudeConversation(raw) {
  const messages = [];
  const msgList = raw.chat_messages || [];

  for (const msg of msgList) {
    const role = msg.sender === 'human' ? 'user' : 'assistant';
    const content = extractClaudeTextContent(msg.content || msg.text || '');
    const thinking = extractClaudeThinking(msg.content);
    const artifacts = extractClaudeArtifacts(msg.content);
    if (!content.trim() && !thinking) continue;

    messages.push({
      role,
      content,
      thinking: thinking || null,
      artifacts: artifacts.length ? artifacts : null,
      timestamp: msg.created_at || null,
      model: msg.model || raw.model || null,
    });
  }

  return {
    id: raw.uuid,
    title: raw.name || 'Untitled',
    platform: 'claude',
    model: raw.model || null,
    url: `https://claude.ai/chat/${raw.uuid}`,
    created_at: raw.created_at || null,
    updated_at: raw.updated_at || null,
    exported_at: new Date().toISOString(),
    messages,
  };
}

function extractClaudeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n\n');
  }
  return '';
}

function extractClaudeThinking(content) {
  if (!Array.isArray(content)) return null;
  const blocks = content.filter(b => b.type === 'thinking').map(b => b.thinking || b.text || '');
  return blocks.length ? blocks.join('\n\n') : null;
}

function extractClaudeArtifacts(content) {
  if (!Array.isArray(content)) return [];
  const artifacts = [];
  for (const b of content) {
    if (b.type === 'tool_use' && b.name) {
      artifacts.push({ type: 'tool_use', name: b.name, content: JSON.stringify(b.input || {}, null, 2) });
    }
    if (b.type === 'tool_result') {
      const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('\n') : String(b.content || '');
      artifacts.push({ type: 'tool_result', name: `Result for ${b.tool_use_id || 'tool'}`, content: c });
    }
  }
  return artifacts;
}

// =====================================================================
// FORMATTERS
// =====================================================================

// --- Markdown ---
function formatMarkdown(convo, recallOsMode = false) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${escYaml(convo.title)}"`);
  lines.push(`platform: ${convo.platform}`);
  if (convo.model) lines.push(`model: ${convo.model}`);
  lines.push(`url: "${convo.url}"`);
  if (convo.created_at) lines.push(`created_at: "${convo.created_at}"`);
  if (convo.updated_at) lines.push(`updated_at: "${convo.updated_at}"`);
  lines.push(`exported_at: "${convo.exported_at}"`);
  if (recallOsMode) lines.push('recallos_ingest: true');
  lines.push('---');
  lines.push('');
  lines.push(`# ${convo.title}`);
  lines.push('');

  for (const msg of convo.messages) {
    if (msg.role === 'system') continue;
    const label = msg.role === 'user' ? '## Human' : `## Assistant${msg.model ? ` (${msg.model})` : ''}`;
    const ts = msg.timestamp ? `\n*${fmtDate(msg.timestamp)}*` : '';
    lines.push(`${label}${ts}`);
    lines.push('');

    // Thinking block
    if (msg.thinking) {
      lines.push('<details>');
      lines.push('<summary>💭 Thinking</summary>');
      lines.push('');
      lines.push(msg.thinking);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    lines.push(msg.content);

    // Artifacts
    if (msg.artifacts?.length) {
      for (const a of msg.artifacts) {
        lines.push('');
        lines.push(`**[${a.type === 'tool_use' ? '🔧 Tool' : '📦 Result'}: ${a.name}]**`);
        lines.push('```');
        lines.push(a.content);
        lines.push('```');
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// --- JSON ---
function formatJSON(convo) {
  return JSON.stringify(convo, null, 2);
}

// --- Plain Text ---
function formatText(convo) {
  const lines = [];
  lines.push(convo.title.toUpperCase());
  lines.push(`Platform: ${convo.platform}${convo.model ? `  |  Model: ${convo.model}` : ''}`);
  lines.push(`Exported: ${fmtDate(convo.exported_at)}`);
  lines.push('='.repeat(70));
  lines.push('');

  for (const msg of convo.messages) {
    if (msg.role === 'system') continue;
    const label = msg.role === 'user' ? 'Human' : 'Assistant';
    const ts = msg.timestamp ? ` [${fmtDate(msg.timestamp)}]` : '';
    lines.push(`${label}${ts}:`);
    if (msg.thinking) lines.push(`[Thinking: ${msg.thinking.substring(0, 200)}...]`);
    lines.push(msg.content);
    lines.push('');
    lines.push('-'.repeat(50));
    lines.push('');
  }
  return lines.join('\n');
}

// --- HTML ---
function formatHTML(convo) {
  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderContent = text => esc(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code"><code class="lang-$1">$2</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  const msgsHtml = convo.messages
    .filter(m => m.role !== 'system')
    .map(msg => {
      const roleClass = msg.role === 'user' ? 'human' : 'asst';
      const label = msg.role === 'user' ? 'Human' : `Assistant${msg.model ? ` <span class="model">(${esc(msg.model)})</span>` : ''}`;
      const ts = msg.timestamp ? `<span class="ts">${fmtDate(msg.timestamp)}</span>` : '';
      const thinking = msg.thinking
        ? `<details class="thinking"><summary>💭 Thinking</summary><pre>${esc(msg.thinking)}</pre></details>`
        : '';
      const artifacts = msg.artifacts?.length
        ? msg.artifacts.map(a => `<div class="artifact"><div class="art-title">${a.type === 'tool_use' ? '🔧' : '📦'} ${esc(a.name)}</div><pre>${esc(a.content)}</pre></div>`).join('')
        : '';
      return `
<div class="msg ${roleClass}">
  <div class="role">${label} ${ts}</div>
  ${thinking}
  <div class="body">${renderContent(msg.content)}</div>
  ${artifacts}
</div>`;
    }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(convo.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f17;color:#dde1ec;max-width:860px;margin:40px auto;padding:0 20px 60px;line-height:1.65}
h1{font-size:1.6rem;color:#c4b5fd;margin-bottom:6px}
.meta{font-size:12px;color:#64748b;margin-bottom:32px}
.meta span{margin-right:14px}
.msg{margin:12px 0;padding:16px 20px;border-radius:10px;position:relative}
.human{background:#1e293b;border-left:3px solid #60a5fa}
.asst{background:#161625;border-left:3px solid #a78bfa}
.role{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:10px}
.model{font-weight:400;text-transform:none;letter-spacing:0}
.ts{font-weight:400;font-size:10px;color:#475569;margin-left:10px;letter-spacing:0;text-transform:none}
.body{font-size:14.5px}
pre{background:#0d1117;border:1px solid #1e293b;padding:12px 16px;border-radius:6px;overflow-x:auto;font-size:12.5px;margin:10px 0;white-space:pre-wrap;word-break:break-word}
code{background:#0d1117;padding:2px 5px;border-radius:4px;font-size:12.5px;font-family:'JetBrains Mono','Fira Code',monospace}
pre code{background:none;padding:0}
.thinking{margin:8px 0;border:1px solid #1e293b;border-radius:6px;overflow:hidden}
.thinking summary{cursor:pointer;padding:6px 12px;background:#1e293b;font-size:12px;color:#94a3b8;list-style:none}
.thinking pre{margin:0;border:none;border-radius:0;color:#64748b;font-size:11.5px}
.artifact{margin:10px 0;background:#0d1117;border:1px solid #334155;border-radius:6px;overflow:hidden}
.art-title{padding:6px 12px;background:#1e293b;font-size:12px;color:#94a3b8;font-weight:600}
.artifact pre{border:none;border-radius:0;margin:0}
strong{color:#e2e8f0}
br{display:block;content:"";margin-top:4px}
</style>
</head>
<body>
<h1>${esc(convo.title)}</h1>
<div class="meta">
  <span><strong>Platform:</strong> ${esc(convo.platform)}</span>
  ${convo.model ? `<span><strong>Model:</strong> ${esc(convo.model)}</span>` : ''}
  <span><strong>Exported:</strong> ${esc(convo.exported_at)}</span>
  <span><a href="${esc(convo.url)}" style="color:#60a5fa">Open original</a></span>
</div>
${msgsHtml}
</body>
</html>`;
}

// --- CSV ---
function formatCSV(convo) {
  const rows = [
    ['conversation_id', 'conversation_title', 'platform', 'conversation_model',
     'message_index', 'role', 'content', 'timestamp', 'model']
  ];
  convo.messages.forEach((msg, i) => {
    rows.push([
      convo.id, convo.title, convo.platform, convo.model || '',
      i + 1, msg.role, msg.content, msg.timestamp || '', msg.model || '',
    ]);
  });
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}


// =====================================================================
// DOWNLOAD HELPERS
// =====================================================================
function sanitize(name) {
  return (name || 'export').replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').substring(0, 120);
}

const EXT = { markdown: 'md', json: 'json', text: 'txt', html: 'html', csv: 'csv' };

async function triggerDownload(content, filename) {
  let url;
  if (content instanceof Blob) {
    // ZIP blob — convert to base64 data URL (URL.createObjectURL not available in MV3 service workers)
    const buffer = await content.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    url = `data:application/zip;base64,${base64}`;
  } else {
    // Use octet-stream so Chrome/Brave honours the filename parameter and doesn't
    // override the extension based on MIME type (e.g. text/plain → .txt)
    url = `data:application/octet-stream,${encodeURIComponent(String(content))}`;
  }
  return chrome.downloads.download({ url, filename, saveAs: false });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Process in chunks to avoid call stack limits on large files
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// =====================================================================
// EXPORT: CURRENT CONVERSATION
// =====================================================================
async function handleExportCurrent({ platform, conversationId, format, recallOsMode }) {
  let raw, convo;
  if (platform === 'chatgpt') {
    raw = await fetchChatGPTConversation(conversationId);
    convo = parseChatGPTConversation(raw);
  } else if (platform === 'claude') {
    raw = await fetchClaudeConversation(conversationId);
    convo = parseClaudeConversation(raw);
  } else {
    throw new Error('Unsupported platform: ' + platform);
  }

  const folder = recallOsMode ? `recallos/${platform}/` : '';
  const name = `${folder}${sanitize(convo.title)}.${EXT[format] || 'md'}`;

  const fmtFns = { markdown: formatMarkdown, json: formatJSON, text: formatText, html: formatHTML, csv: formatCSV };
  const content = (fmtFns[format] || formatMarkdown)(convo, recallOsMode);

  await triggerDownload(content, name);
  saveLastExport();
  return { success: true, title: convo.title, messageCount: convo.messages.length };
}

// =====================================================================
// EXPORT: LIST ALL CONVERSATIONS (for browse page)
// =====================================================================
async function handleListConvos({ platform }) {
  if (platform === 'chatgpt') return listChatGPTConversations();
  if (platform === 'claude') return listClaudeConversations();
  throw new Error('Unsupported platform');
}

// =====================================================================
// EXPORT: BULK (multiple conversations → ZIP)
// =====================================================================
async function handleExportBulk({ platform, conversationIds, format, recallOsMode }) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded. Try reloading the extension.');

  const zip = new JSZip();
  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < conversationIds.length; i++) {
    const id = conversationIds[i];
    // Notify progress
    chrome.runtime.sendMessage({ type: 'BULK_PROGRESS', payload: { current: i + 1, total: conversationIds.length, id } }).catch(() => {});

    try {
      let raw, convo;
      if (platform === 'chatgpt') {
        raw = await fetchChatGPTConversation(id);
        convo = parseChatGPTConversation(raw);
      } else {
        raw = await fetchClaudeConversation(id);
        convo = parseClaudeConversation(raw);
      }

      const fmtFns = { markdown: formatMarkdown, json: formatJSON, text: formatText, html: formatHTML, csv: formatCSV };
      const content = (fmtFns[format] || formatMarkdown)(convo, recallOsMode);
      const folder = recallOsMode ? `recallos/${platform}/` : `${platform}/`;
      zip.file(`${folder}${sanitize(convo.title)}.${EXT[format] || 'md'}`, content);
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push({ id, error: err.message });
    }

    // Polite rate limiting
    if (i < conversationIds.length - 1) await sleep(350);
  }

  // Add summary manifest
  const manifest = {
    exported_at: new Date().toISOString(),
    platform,
    format,
    recallos_mode: recallOsMode,
    total: conversationIds.length,
    success: results.success,
    failed: results.failed,
    errors: results.errors,
  };
  zip.file('_vaultexport_manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  await triggerDownload(blob, `vaultexport_${platform}_${ts}.zip`);

  saveLastExport();
  return results;
}

// =====================================================================
// UTILITIES
// =====================================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function escYaml(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
