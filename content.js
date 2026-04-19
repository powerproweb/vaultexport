// VaultExport — content.js
// Injected into chatgpt.com and claude.ai pages.
// Lightweight: just detects context, injects the export button,
// and relays messages. All heavy work is done in background.js.

(function () {
  'use strict';

  // Guard against double-injection
  if (window.__vaultExportInjected) return;
  window.__vaultExportInjected = true;

  // Guard: chrome.runtime becomes undefined in orphaned content scripts
  // (happens when extension is reloaded while the tab stays open)
  if (typeof chrome === 'undefined' || !chrome?.runtime) return;

  // ===================================================================
  // PLATFORM DETECTION
  // ===================================================================
  function getPlatform() {
    const h = location.hostname;
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt';
    if (h.includes('claude.ai')) return 'claude';
    return null;
  }

  function getConversationId() {
    const url = location.href;
    if (getPlatform() === 'chatgpt') {
      const m = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
      return m?.[1] || null;
    }
    if (getPlatform() === 'claude') {
      const m = url.match(/\/chat\/([a-f0-9-]{36})/);
      return m?.[1] || null;
    }
    return null;
  }

  const platform = getPlatform();
  if (!platform) return;

  // ===================================================================
  // INJECT EXPORT BUTTON
  // ===================================================================
  let injectedBtn = null;
  let currentConvId = null;

  function createButton() {
    const btn = document.createElement('button');
    btn.id = 'vaultexport-btn';
    btn.className = 'vaultexport-btn';
    btn.setAttribute('title', 'VaultExport — Export this conversation');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Export</span>`;
    btn.addEventListener('click', onExportClick);
    return btn;
  }

  function onExportClick(e) {
    e.preventDefault();
    e.stopPropagation();
    // Popup will handle the full export UI; button just opens popup context
    // For quick export: send message to background to open popup or trigger export
    const convId = getConversationId();
    if (!convId) {
      showToast('No conversation detected. Open a chat first.', 'error');
      return;
    }
    // Guard against orphaned content script after extension reload
    if (!chrome?.runtime?.sendMessage) {
      showToast('Extension reloaded — please refresh this page first.', 'error');
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: 'EXPORT_CURRENT',
        payload: {
          platform,
          conversationId: convId,
          format: null,
          recallOsMode: false,
        },
      }, (res) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.includes('invalidated') || msg.includes('disconnected')) {
            showToast('Extension was reloaded — please refresh this page (F5) to reconnect.', 'error');
          } else {
            showToast('Extension error: ' + msg, 'error');
          }
          return;
        }
        if (res?.error) {
          showToast('Export failed: ' + res.error, 'error');
        } else if (res?.success) {
          showToast(`✓ Exported "${res.title}" (${res.messageCount} messages)`, 'success');
        }
      });
    } catch (err) {
      if (err.message?.includes('invalidated') || err.message?.includes('Extension context')) {
        showToast('Extension was reloaded — please refresh this page (F5) to reconnect.', 'error');
      } else {
        showToast('Unexpected error: ' + err.message, 'error');
      }
    }
  }

  // Platform-specific injection targets
  const INJECT_TARGETS = {
    chatgpt: [
      // ChatGPT share/copy button area in header
      '[data-testid="share-chat-button"]',
      'button[aria-label="Share"]',
      // Fallback: top nav area
      'nav ~ div button',
      'header',
    ],
    claude: [
      // Claude action bar
      '[data-testid="chat-menu-trigger"]',
      'button[aria-label="Conversation options"]',
      // Project header
      'header button',
      // Fallback: main header area
      'header',
    ],
  };

  function findInjectionPoint() {
    const targets = INJECT_TARGETS[platform] || [];
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) return el.closest('div, header, nav') || el.parentElement;
    }
    return null;
  }

  function injectButton() {
    const convId = getConversationId();
    if (!convId) return; // Not on a conversation page

    // Don't re-inject if already present and same conversation
    if (injectedBtn && document.body.contains(injectedBtn) && convId === currentConvId) return;

    // Remove stale button
    if (injectedBtn) injectedBtn.remove();

    const target = findInjectionPoint();
    if (!target) return;

    const btn = createButton();
    target.appendChild(btn);
    injectedBtn = btn;
    currentConvId = convId;
  }

  // ===================================================================
  // TOAST NOTIFICATIONS
  // ===================================================================
  function showToast(message, type = 'info') {
    // Remove existing toast
    document.getElementById('vaultexport-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'vaultexport-toast';
    toast.className = `vaultexport-toast vaultexport-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('vaultexport-toast--visible'));

    // Auto-remove
    setTimeout(() => {
      toast.classList.remove('vaultexport-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ===================================================================
  // URL CHANGE OBSERVER (SPA navigation)
  // ===================================================================
  let lastUrl = location.href;
  let debounceTimer = null;

  function onDomChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Check for URL change (SPA navigation)
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        injectButton();
      }
      // Also try injecting even on same URL (DOM may have updated)
      injectButton();
    }, 600);
  }

  const observer = new MutationObserver(onDomChange);
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial injection attempt
  setTimeout(injectButton, 800);
  setTimeout(injectButton, 2000); // Retry for slow loads

  // ===================================================================
  // MESSAGE LISTENER (from popup)
  // ===================================================================
  if (!chrome?.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GET_PAGE_CONTEXT') {
      return { platform, conversationId: getConversationId(), url: location.href };
    }
    if (msg.type === 'SHOW_TOAST') {
      showToast(msg.payload.message, msg.payload.type);
    }
  });

})();
