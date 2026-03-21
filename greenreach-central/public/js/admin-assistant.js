/**
 * F.A.Y.E. Admin Assistant Chat Widget
 * =====================================
 * Self-contained floating chat widget for GreenReach Central admin dashboard.
 * Injects into any page that loads this script.
 *
 * Usage: <script src="/js/admin-assistant.js"></script>
 */

(function() {
  'use strict';

  const API_BASE = '/api/admin/assistant';
  let conversationId = null;
  let isOpen = false;
  let isLoading = false;

  // ── Auth Token ────────────────────────────────────────────────
  function getAuthHeaders() {
    const token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
    return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  // ── Inject Styles ─────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #faye-chat-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #10b981, #059669);
      border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(16,185,129,0.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
      font-size: 24px; color: white;
    }
    #faye-chat-bubble:hover { transform: scale(1.1); box-shadow: 0 6px 24px rgba(16,185,129,0.5); }
    #faye-chat-bubble.has-alert { animation: faye-pulse 2s infinite; }
    @keyframes faye-pulse {
      0%, 100% { box-shadow: 0 4px 16px rgba(16,185,129,0.4); }
      50% { box-shadow: 0 4px 24px rgba(16,185,129,0.7); }
    }

    #faye-chat-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 10001;
      width: 420px; max-height: 600px; border-radius: 16px;
      background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #faye-chat-panel.open { display: flex; }

    .faye-header {
      padding: 16px 20px; background: linear-gradient(135deg, #10b981, #059669);
      display: flex; align-items: center; justify-content: space-between;
      color: white;
    }
    .faye-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .faye-header .faye-subtitle { font-size: 11px; opacity: 0.8; margin-top: 2px; }
    .faye-header-actions { display: flex; gap: 8px; }
    .faye-header-btn {
      background: rgba(255,255,255,0.2); border: none; color: white;
      width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
    }
    .faye-header-btn:hover { background: rgba(255,255,255,0.3); }

    .faye-messages {
      flex: 1; overflow-y: auto; padding: 16px; max-height: 400px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .faye-messages::-webkit-scrollbar { width: 6px; }
    .faye-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

    .faye-msg {
      max-width: 85%; padding: 10px 14px; border-radius: 12px;
      font-size: 13px; line-height: 1.5; word-wrap: break-word;
    }
    .faye-msg.user {
      align-self: flex-end; background: #2563eb; color: white;
      border-bottom-right-radius: 4px;
    }
    .faye-msg.assistant {
      align-self: flex-start; background: #2a2a40; color: #e0e0e0;
      border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.06);
    }
    .faye-msg.system {
      align-self: center; background: rgba(16,185,129,0.15); color: #6ee7b7;
      font-size: 12px; border-radius: 8px; text-align: center;
    }

    .faye-tool-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
      background: rgba(16,185,129,0.2); color: #6ee7b7; margin: 4px 2px;
    }

    .faye-input-area {
      padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.08);
      display: flex; gap: 8px; align-items: center;
    }
    #faye-input {
      flex: 1; padding: 10px 14px; border-radius: 10px;
      background: #2a2a40; border: 1px solid rgba(255,255,255,0.1);
      color: #e0e0e0; font-size: 13px; outline: none;
      resize: none; min-height: 40px; max-height: 100px;
      font-family: inherit; line-height: 1.4;
    }
    #faye-input::placeholder { color: rgba(255,255,255,0.3); }
    #faye-input:focus { border-color: #10b981; }
    #faye-send {
      background: #10b981; border: none; color: white;
      width: 40px; height: 40px; border-radius: 10px; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    #faye-send:hover { background: #059669; }
    #faye-send:disabled { background: #374151; cursor: not-allowed; }

    .faye-typing {
      display: flex; gap: 4px; padding: 8px 14px; align-self: flex-start;
    }
    .faye-typing span {
      width: 8px; height: 8px; border-radius: 50%; background: #6ee7b7;
      animation: faye-bounce 1.4s infinite both;
    }
    .faye-typing span:nth-child(2) { animation-delay: 0.16s; }
    .faye-typing span:nth-child(3) { animation-delay: 0.32s; }
    @keyframes faye-bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }

    .faye-quick-actions {
      padding: 8px 16px 4px; display: flex; flex-wrap: wrap; gap: 6px;
    }
    .faye-quick-btn {
      padding: 4px 10px; border-radius: 6px; font-size: 11px;
      background: rgba(16,185,129,0.15); color: #6ee7b7;
      border: 1px solid rgba(16,185,129,0.25); cursor: pointer;
      transition: background 0.2s;
    }
    .faye-quick-btn:hover { background: rgba(16,185,129,0.3); }

    @media (max-width: 480px) {
      #faye-chat-panel { width: calc(100vw - 16px); right: 8px; bottom: 80px; max-height: 70vh; }
    }
  `;
  document.head.appendChild(style);

  // ── Inject DOM ────────────────────────────────────────────────
  const bubble = document.createElement('button');
  bubble.id = 'faye-chat-bubble';
  bubble.title = 'F.A.Y.E. — Operations Assistant';
  bubble.innerHTML = '&#129302;'; // robot emoji
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.id = 'faye-chat-panel';
  panel.innerHTML = `
    <div class="faye-header">
      <div>
        <h3>F.A.Y.E.</h3>
        <div class="faye-subtitle">Farm Autonomy & Yield Engine</div>
      </div>
      <div class="faye-header-actions">
        <button class="faye-header-btn" id="faye-briefing-btn" title="Morning Briefing">&#128203;</button>
        <button class="faye-header-btn" id="faye-clear-btn" title="New Conversation">&#128260;</button>
        <button class="faye-header-btn" id="faye-close-btn" title="Close">&#10005;</button>
      </div>
    </div>
    <div class="faye-quick-actions">
      <button class="faye-quick-btn" data-msg="How is the system health?">System Health</button>
      <button class="faye-quick-btn" data-msg="Show me the trial balance">Trial Balance</button>
      <button class="faye-quick-btn" data-msg="Any open alerts?">Alerts</button>
      <button class="faye-quick-btn" data-msg="Show order dashboard">Orders</button>
      <button class="faye-quick-btn" data-msg="Farm network overview">Farms</button>
      <button class="faye-quick-btn" data-msg="What are today's AI costs?">AI Costs</button>
    </div>
    <div class="faye-messages" id="faye-messages">
      <div class="faye-msg system">F.A.Y.E. online — ready to assist with operations.</div>
    </div>
    <div class="faye-input-area">
      <textarea id="faye-input" rows="1" placeholder="Ask F.A.Y.E. anything..."></textarea>
      <button id="faye-send" title="Send">&#9654;</button>
    </div>
  `;
  document.body.appendChild(panel);

  // ── References ────────────────────────────────────────────────
  const messagesEl = document.getElementById('faye-messages');
  const inputEl = document.getElementById('faye-input');
  const sendBtn = document.getElementById('faye-send');

  // ── Toggle ────────────────────────────────────────────────────
  bubble.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) inputEl.focus();
  });

  document.getElementById('faye-close-btn').addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('open');
  });

  document.getElementById('faye-clear-btn').addEventListener('click', () => {
    conversationId = null;
    messagesEl.innerHTML = '<div class="faye-msg system">New conversation started.</div>';
  });

  // ── Quick Actions ─────────────────────────────────────────────
  panel.querySelectorAll('.faye-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = btn.getAttribute('data-msg');
      if (msg) sendMessage(msg);
    });
  });

  // ── Briefing ──────────────────────────────────────────────────
  document.getElementById('faye-briefing-btn').addEventListener('click', async () => {
    addMessage('system', 'Generating operations briefing...');
    try {
      const resp = await fetch(`${API_BASE}/briefing`, { headers: getAuthHeaders() });
      const data = await resp.json();
      if (data.ok && data.briefing) {
        addMessage('assistant', data.briefing);
      } else {
        addMessage('system', 'Briefing unavailable: ' + (data.error || 'unknown error'));
      }
    } catch (err) {
      addMessage('system', 'Failed to load briefing: ' + err.message);
    }
  });

  // ── Send Message ──────────────────────────────────────────────
  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (text) sendMessage(text);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) sendMessage(text);
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `faye-msg ${role}`;
    // Basic markdown-like rendering for assistant messages
    if (role === 'assistant') {
      div.innerHTML = renderMarkdown(content);
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addToolBadges(tools) {
    if (!tools || tools.length === 0) return;
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; padding: 0 4px; align-self: flex-start;';
    for (const t of tools) {
      const badge = document.createElement('span');
      badge.className = 'faye-tool-badge';
      badge.textContent = (t.success ? '✓ ' : '✗ ') + t.tool.replace(/_/g, ' ');
      container.appendChild(badge);
    }
    messagesEl.appendChild(container);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'faye-typing';
    div.id = 'faye-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('faye-typing-indicator');
    if (el) el.remove();
  }

  async function sendMessage(text) {
    if (isLoading) return;
    isLoading = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    addMessage('user', text);
    showTyping();

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ message: text, conversation_id: conversationId })
      });

      hideTyping();
      const data = await resp.json();

      if (data.ok) {
        conversationId = data.conversation_id;
        if (data.tool_calls) addToolBadges(data.tool_calls);
        addMessage('assistant', data.reply);
      } else {
        addMessage('system', 'Error: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      hideTyping();
      addMessage('system', 'Connection error: ' + err.message);
    }

    isLoading = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  // ── Simple Markdown Renderer ──────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';
    return text
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre style="background:#1e1e2e;padding:8px;border-radius:6px;overflow-x:auto;font-size:12px;margin:4px 0"><code>$1</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code style="background:#2a2a40;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Headers
      .replace(/^### (.+)$/gm, '<div style="font-weight:600;font-size:14px;margin:8px 0 4px;color:#6ee7b7">$1</div>')
      .replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:8px 0 4px;color:#6ee7b7">$1</div>')
      // Bullet lists
      .replace(/^[•\-\*] (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">&#8226; $1</div>')
      // Numbered lists
      .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">$1. $2</div>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  // ── Check F.A.Y.E. availability on load ───────────────────────
  (async function checkStatus() {
    try {
      const resp = await fetch(`${API_BASE}/status`, { headers: getAuthHeaders() });
      const data = await resp.json();
      if (!data.ok || (!data.llm?.primary?.available && !data.llm?.fallback?.available)) {
        bubble.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)';
        bubble.title = 'F.A.Y.E. — AI service unavailable';
      }
    } catch {
      // Service unavailable — keep bubble visible but dim
      bubble.style.opacity = '0.5';
    }
  })();
})();
