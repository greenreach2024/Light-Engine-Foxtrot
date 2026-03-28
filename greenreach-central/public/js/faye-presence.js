/**
 * F.A.Y.E. Presence System v2 -- 3-Layer Operational Intelligence
 * ================================================================
 * Layer 1: Ambient Orb -- persistent, always visible, state-reactive
 * Layer 2: Intelligence Panel -- slide-out: 6 operational modes
 * Layer 3: Conversation -- direct dialogue within the panel
 *
 * Modes: Observe | Advise | Act | Explain | Learn | Escalate
 *
 * Usage: <script src="/js/faye-presence.js"></script>
 *        (Requires /styles/faye-core.css)
 */

(function () {
  'use strict';

  var API_BASE = '/api/admin/assistant';
  var STATE_POLL_INTERVAL = 30000;
  var PROACTIVE_CHECK_INTERVAL = 60000;

  var conversationId = null;
  var isLoading = false;
  var panelOpen = false;
  var activeMode = 'observe';
  var currentState = 'idle';
  var stateData = { alerts: 0, risks: [], recommendations: [], automations: [], insights: [], domains: [] };
  var pollTimer = null;

  // -- Auth ---------------------------------------------------------
  function getAuthHeaders() {
    var token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
    return token
      ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  // -- Text Utilities -----------------------------------------------
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderMarkdown(text) {
    var safe = esc(text);
    return safe
      .replace(/```([\s\S]*?)```/g, '<pre style="background:#1e1e2e;padding:8px;border-radius:6px;overflow-x:auto;font-size:12px;margin:4px 0"><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<div style="font-weight:600;font-size:14px;margin:8px 0 4px;color:var(--faye-text-accent)">$1</div>')
      .replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:8px 0 4px;color:var(--faye-text-accent)">$1</div>')
      .replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">&#8226; $1</div>')
      .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">$1. $2</div>')
      .replace(/\n/g, '<br>');
  }

  function timeAgo(ts) {
    if (!ts) return '--';
    var diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // -- Orb Construction ---------------------------------------------
  function buildOrb(sizeClass) {
    var c = document.createElement('div');
    c.className = 'faye-orb-container faye-state-idle ' + (sizeClass || '');
    c.innerHTML =
      '<div class="faye-orb-data-ring"></div>' +
      '<div class="faye-orb-sweep"></div>' +
      '<div class="faye-orb-beam"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--outer"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--middle"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--inner"></div>' +
      '<div class="faye-orb-core"></div>';
    return c;
  }

  function setOrbState(orb, state) {
    if (!orb) return;
    orb.className = orb.className.replace(/faye-state-\S+/g, '').trim();
    orb.classList.add('faye-state-' + state);
  }

  // ================================================================
  // Layer 1: Ambient Presence
  // ================================================================
  var ambient = document.createElement('div');
  ambient.className = 'faye-ambient';
  ambient.id = 'faye-ambient';

  var ambientRow = document.createElement('div');
  ambientRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-direction:row-reverse;pointer-events:auto';

  var ambientOrb = document.createElement('div');
  ambientOrb.className = 'faye-ambient-orb';
  var orbEl = buildOrb('faye-orb--ambient');
  ambientOrb.appendChild(orbEl);

  var ambientBadge = document.createElement('div');
  ambientBadge.className = 'faye-ambient-badge';
  ambientBadge.id = 'faye-ambient-badge';
  ambientOrb.appendChild(ambientBadge);

  var ambientStatus = document.createElement('div');
  ambientStatus.className = 'faye-ambient-status';
  ambientStatus.id = 'faye-ambient-status';
  ambientStatus.textContent = 'F.A.Y.E. monitoring';

  // Proactive surface
  var proactiveSurface = document.createElement('div');
  proactiveSurface.className = 'faye-proactive-surface';
  proactiveSurface.id = 'faye-proactive-surface';

  ambientRow.appendChild(ambientOrb);
  ambientRow.appendChild(ambientStatus);
  ambient.appendChild(ambientRow);
  ambient.appendChild(proactiveSurface);

  ambientOrb.addEventListener('click', function () { togglePanel(); });
  ambientStatus.addEventListener('click', function () { togglePanel(); });

  document.body.appendChild(ambient);

  // ================================================================
  // Layer 2: Intelligence Panel
  // ================================================================
  var backdrop = document.createElement('div');
  backdrop.className = 'faye-backdrop';
  backdrop.id = 'faye-backdrop';
  document.body.appendChild(backdrop);

  var panel = document.createElement('div');
  panel.className = 'faye-intel-panel';
  panel.id = 'faye-intel-panel';
  panel.innerHTML = [
    '<div class="faye-intel-header">',
    '  <div class="faye-intel-header-orb" id="faye-panel-orb-wrap"></div>',
    '  <div class="faye-intel-header-text">',
    '    <div class="faye-intel-title">F.A.Y.E.</div>',
    '    <div class="faye-intel-subtitle" id="faye-panel-subtitle">Observing operations</div>',
    '  </div>',
    '  <button class="faye-intel-close" id="faye-panel-close" title="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '</div>',
    '<div class="faye-mode-tabs" id="faye-mode-tabs">',
    '  <button class="faye-mode-tab active" data-mode="observe"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>Observe</button>',
    '  <button class="faye-mode-tab" data-mode="advise"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg></span>Advise</button>',
    '  <button class="faye-mode-tab" data-mode="act"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>Act</button>',
    '  <button class="faye-mode-tab" data-mode="explain"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>Explain</button>',
    '  <button class="faye-mode-tab" data-mode="learn"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>Learn</button>',
    '  <button class="faye-mode-tab" data-mode="escalate"><span class="faye-mode-tab-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>Escalate</button>',
    '</div>',
    '',
    '<!-- Observe Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-observe">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">What I\'m watching</div>',
    '      <div class="faye-intel-section-count" id="faye-watch-count">0</div>',
    '    </div>',
    '    <div id="faye-watch-list"></div>',
    '  </div>',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Active risks</div>',
    '      <div class="faye-intel-section-count" id="faye-risk-count">0</div>',
    '    </div>',
    '    <div id="faye-risk-list"></div>',
    '  </div>',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Automations</div>',
    '    </div>',
    '    <div id="faye-automation-list"></div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Advise Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-advise" style="display:none">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Recommended actions</div>',
    '      <div class="faye-intel-section-count" id="faye-rec-count">0</div>',
    '    </div>',
    '    <div id="faye-rec-list"></div>',
    '  </div>',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Needs your attention</div>',
    '    </div>',
    '    <div id="faye-attention-list"></div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Act Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-act" style="display:none">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Pending actions</div>',
    '      <div class="faye-intel-section-count" id="faye-action-count">0</div>',
    '    </div>',
    '    <div id="faye-action-list"></div>',
    '  </div>',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Recently executed</div>',
    '    </div>',
    '    <div id="faye-executed-list"></div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Explain Mode (Conversation: "explain why") -->',
    '<div class="faye-conversation" id="faye-mode-explain">',
    '  <div class="faye-conversation-messages faye-scroll" id="faye-explain-messages">',
    '    <div class="faye-conv-msg system">Ask me to explain any decision, risk, or recommendation.</div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Learn Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-learn" style="display:none">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Trust & Autonomy</div>',
    '    </div>',
    '    <div id="faye-domain-list"></div>',
    '  </div>',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">What I\'ve learned</div>',
    '      <div class="faye-intel-section-count" id="faye-insight-count">0</div>',
    '    </div>',
    '    <div id="faye-insight-list"></div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Escalate Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-escalate" style="display:none">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Items requiring human decision</div>',
    '      <div class="faye-intel-section-count" id="faye-escalate-count">0</div>',
    '    </div>',
    '    <div id="faye-escalate-list"></div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Footer: always-visible chat input -->',
    '<div class="faye-intel-footer">',
    '  <div class="faye-intel-chat-input">',
    '    <textarea id="faye-panel-input" rows="1" placeholder="Ask F.A.Y.E. anything..."></textarea>',
    '    <button class="faye-intel-send" id="faye-panel-send" title="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '  </div>',
    '</div>'
  ].join('\n');
  document.body.appendChild(panel);

  // Insert orb into panel header
  var panelOrbWrap = document.getElementById('faye-panel-orb-wrap');
  var panelOrb = buildOrb('faye-orb--panel');
  panelOrbWrap.appendChild(panelOrb);

  // -- Panel Controls -----------------------------------------------
  var panelInput = document.getElementById('faye-panel-input');
  var panelSend = document.getElementById('faye-panel-send');

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    backdrop.classList.toggle('visible', panelOpen);
    if (panelOpen) {
      panelInput.focus();
      refreshState();
    }
  }

  document.getElementById('faye-panel-close').addEventListener('click', function () {
    panelOpen = false;
    panel.classList.remove('open');
    backdrop.classList.remove('visible');
  });

  backdrop.addEventListener('click', function () {
    panelOpen = false;
    panel.classList.remove('open');
    backdrop.classList.remove('visible');
  });

  // -- Mode Switching -----------------------------------------------
  var MODES = ['observe', 'advise', 'act', 'explain', 'learn', 'escalate'];
  var modeSubtitles = {
    observe: 'Observing operations',
    advise: 'Providing recommendations',
    act: 'Managing actions',
    explain: 'Ready to explain',
    learn: 'Learning from patterns',
    escalate: 'Escalation queue'
  };

  function switchMode(mode) {
    activeMode = mode;
    MODES.forEach(function (m) {
      var el = document.getElementById('faye-mode-' + m);
      if (!el) return;
      if (m === mode) {
        el.style.display = '';
        el.classList.add('active');
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    });
    var tabs = document.querySelectorAll('#faye-mode-tabs .faye-mode-tab');
    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
    });
    var subtitle = document.getElementById('faye-panel-subtitle');
    if (subtitle) subtitle.textContent = modeSubtitles[mode] || '';
  }

  document.getElementById('faye-mode-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.faye-mode-tab');
    if (!tab) return;
    var mode = tab.getAttribute('data-mode');
    if (mode) switchMode(mode);
  });

  // -- Conversation Messages ----------------------------------------
  var convContainers = {
    explain: document.getElementById('faye-explain-messages')
  };

  function getActiveConvMessages() {
    // Explain mode has its own conversation container
    if (activeMode === 'explain') return convContainers.explain;
    // For other modes that spawn conversation, use explain container as fallback
    return convContainers.explain;
  }

  function addConvMessage(role, text) {
    var container = getActiveConvMessages();
    var div = document.createElement('div');
    div.className = 'faye-conv-msg ' + role;
    if (role === 'assistant') {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function showTyping() {
    var container = getActiveConvMessages();
    var div = document.createElement('div');
    div.className = 'faye-conv-msg system';
    div.id = 'faye-typing-indicator';
    div.innerHTML = '<span style="display:inline-flex;gap:4px"><span class="faye-status-dot"></span><span class="faye-status-dot" style="animation-delay:0.2s"></span><span class="faye-status-dot" style="animation-delay:0.4s"></span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('faye-typing-indicator');
    if (el) el.remove();
  }

  // -- Chat ---------------------------------------------------------
  function sendChat(text) {
    if (isLoading) return;
    isLoading = true;
    panelSend.disabled = true;
    panelInput.value = '';

    // Auto-switch to explain mode for direct dialogue
    if (activeMode !== 'explain') switchMode('explain');

    addConvMessage('user', text);
    setFayeState('analyzing');
    showTyping();

    fetch(API_BASE + '/chat', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ message: text, conversation_id: conversationId })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      hideTyping();

      if (data.ok !== false) {
        conversationId = data.conversation_id;

        // Tool badges
        if (data.tool_calls && data.tool_calls.length > 0) {
          var interAgentTools = ['send_message_to_evie', 'get_evie_messages', 'get_agent_conversation', 'get_evie_conversations', 'get_evie_conversation_summaries', 'get_farm_alerts'];
          var hasInterAgent = false;
          var regularTools = [];
          data.tool_calls.forEach(function (t) {
            if (interAgentTools.indexOf(t.tool) !== -1) {
              hasInterAgent = true;
            } else {
              regularTools.push(t);
            }
          });
          if (hasInterAgent) {
            var sisterDiv = document.createElement('div');
            sisterDiv.style.cssText = 'align-self:flex-start;padding:2px 8px;font-size:11px;color:var(--faye-accent,#8b5cf6);opacity:0.8;font-style:italic';
            sisterDiv.textContent = 'Coordinating with little sis E.V.I.E...';
            getActiveConvMessages().appendChild(sisterDiv);
          }
          if (regularTools.length > 0) {
            var toolDiv = document.createElement('div');
            toolDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-self:flex-start;padding:0 4px';
            regularTools.forEach(function (t) {
              var badge = document.createElement('span');
              badge.className = 'faye-tool-badge' + (t.success ? '' : ' tool-failed');
              badge.textContent = (t.success ? '+ ' : '- ') + t.tool.replace(/_/g, ' ');
              toolDiv.appendChild(badge);
            });
            getActiveConvMessages().appendChild(toolDiv);
          }
        }

        addConvMessage('assistant', data.reply || data.response || data.message || '');

        // Pending action confirmation flow
        if (data.pending_action) showConfirmBar(data.pending_action);

        // Action execution result
        if (data.action_executed) {
          var aBadge = document.createElement('div');
          aBadge.className = 'faye-tool-badge' + (data.action_executed.success ? '' : ' tool-failed');
          aBadge.textContent = (data.action_executed.success ? 'Executed: ' : 'Failed: ') + data.action_executed.tool.replace(/_/g, ' ');
          getActiveConvMessages().appendChild(aBadge);
        }

        setFayeState('confident');
      } else {
        addConvMessage('system', 'Error: ' + (data.error || 'Unknown error'));
        setFayeState('uncertain');
      }

      isLoading = false;
      panelSend.disabled = false;
      panelInput.focus();
      setTimeout(function () { if (currentState === 'confident') setFayeState('idle'); }, 4000);
    })
    .catch(function (err) {
      hideTyping();
      addConvMessage('system', 'Connection error: ' + err.message);
      setFayeState('uncertain');
      isLoading = false;
      panelSend.disabled = false;
      panelInput.focus();
    });
  }

  panelSend.addEventListener('click', function () {
    var text = (panelInput.value || '').trim();
    if (text) sendChat(text);
  });

  panelInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = (panelInput.value || '').trim();
      if (text) sendChat(text);
    }
  });

  // -- Confirmation Bar ---------------------------------------------
  function showConfirmBar(pending) {
    var existing = document.getElementById('faye-confirm-row');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'faye-confirm-row';
    bar.className = 'faye-confirm-row';

    var label = document.createElement('span');
    label.className = 'faye-confirm-label ' + (pending.tier === 'admin' ? 'critical' : 'approval');
    label.textContent = pending.tier === 'admin' ? 'CRITICAL' : 'Approval needed';

    var yesBtn = document.createElement('button');
    yesBtn.className = 'faye-confirm-btn confirm';
    yesBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Approve';
    yesBtn.addEventListener('click', function () { bar.remove(); sendChat('yes'); });

    var noBtn = document.createElement('button');
    noBtn.className = 'faye-confirm-btn cancel';
    noBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Decline';
    noBtn.addEventListener('click', function () { bar.remove(); sendChat('cancel'); });

    bar.appendChild(label);
    bar.appendChild(yesBtn);
    bar.appendChild(noBtn);
    var container = getActiveConvMessages();
    container.appendChild(bar);
    container.scrollTop = container.scrollHeight;
  }

  // -- State Management ---------------------------------------------
  function setFayeState(state) {
    currentState = state;
    setOrbState(orbEl, state);
    setOrbState(panelOrb, state);

    var statusEl = document.getElementById('faye-ambient-status');
    var labels = {
      idle: 'F.A.Y.E. monitoring',
      listening: 'F.A.Y.E. listening',
      analyzing: 'F.A.Y.E. analyzing',
      alerting: stateData.alerts + ' active risk' + (stateData.alerts === 1 ? '' : 's'),
      executing: 'F.A.Y.E. executing',
      uncertain: 'F.A.Y.E. uncertain',
      confident: 'F.A.Y.E. confident'
    };
    statusEl.textContent = labels[state] || labels.idle;
  }

  // -- State Refresh ------------------------------------------------
  function refreshState() {
    fetch(API_BASE + '/state', { headers: getAuthHeaders() })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var s = data.state || data;
      stateData = s;
      stateData.alerts = s.alerts || (s.risks ? s.risks.length : 0);
      renderObserveMode(s);
      renderAdviseMode(s);
      renderActMode(s);
      renderLearnMode(s);
      renderEscalateMode(s);
      updateAmbient(s);
    })
    .catch(function () { /* silent */ });
  }

  function updateAmbient(data) {
    var badge = document.getElementById('faye-ambient-badge');
    var alertCount = data.alerts || 0;
    badge.textContent = alertCount > 0 ? String(alertCount) : '';

    if (alertCount > 0 && currentState === 'idle') setFayeState('alerting');
    else if (alertCount === 0 && currentState === 'alerting') setFayeState('idle');

    if (data.proactive_message) {
      showProactiveNotice(data.proactive_message);
    }
  }

  // -- Proactive Surface --------------------------------------------
  function showProactiveNotice(text) {
    var statusEl = document.getElementById('faye-ambient-status');
    statusEl.textContent = text;
    ambient.classList.add('show-status');
    setTimeout(function () {
      ambient.classList.remove('show-status');
      var labels = {
        idle: 'F.A.Y.E. monitoring',
        alerting: stateData.alerts + ' active risk' + (stateData.alerts === 1 ? '' : 's')
      };
      statusEl.textContent = labels[currentState] || labels.idle;
    }, 6000);
  }

  // -- Render: Observe Mode -----------------------------------------
  function renderObserveMode(data) {
    var watchList = document.getElementById('faye-watch-list');
    var watches = data.watching || [];
    var watchCount = document.getElementById('faye-watch-count');
    if (watchCount) watchCount.textContent = String(watches.length);
    if (watchList) {
      if (watches.length === 0) {
        watchList.innerHTML = '<div class="faye-notice">All systems nominal. No active watches.</div>';
      } else {
        watchList.innerHTML = watches.map(function (w) {
          return '<div class="faye-signal-card signal-' + (w.severity || 'ok') + '">' +
            '<div class="faye-signal-title">' + esc(w.title || w.label) + '</div>' +
            '<div class="faye-signal-detail">' + esc(w.detail || w.description || '') + '</div>' +
            (w.confidence != null ? '<div class="faye-confidence-bar" style="margin-top:4px"><div class="faye-confidence-fill ' + confClass(w.confidence) + '" style="width:' + Math.round(w.confidence * 100) + '%"></div></div>' : '') +
            '<div class="faye-signal-meta"><span>' + esc(w.domain || '') + '</span>' +
            (w.since ? '<span>' + timeAgo(w.since) + '</span>' : '') + '</div></div>';
        }).join('');
      }
    }

    // Risks
    var riskList = document.getElementById('faye-risk-list');
    var risks = data.risks || [];
    var riskCount = document.getElementById('faye-risk-count');
    if (riskCount) riskCount.textContent = String(risks.length);
    if (riskList) {
      if (risks.length === 0) {
        riskList.innerHTML = '<div class="faye-notice">No active risks detected.</div>';
      } else {
        riskList.innerHTML = risks.map(function (r) {
          var reasons = '';
          if (r.reasons && r.reasons.length) {
            reasons = '<ul class="faye-reason-stack">' + r.reasons.map(function (reason) {
              return '<li class="faye-reason-item">' + esc(reason) + '</li>';
            }).join('') + '</ul>';
          }
          return '<div class="faye-signal-card signal-' + (r.severity || 'warning') + '">' +
            '<div class="faye-signal-title">' + esc(r.title || r.label) + '</div>' +
            '<div class="faye-signal-detail">' + esc(r.detail || r.description || '') + '</div>' +
            reasons +
            '<div class="faye-signal-meta"><span>' + esc(r.domain || '') + '</span></div></div>';
        }).join('');
      }
    }

    // Automations
    var autoList = document.getElementById('faye-automation-list');
    var autos = data.automations || [];
    if (autoList) {
      if (autos.length === 0) {
        autoList.innerHTML = '<div class="faye-notice">No active automations.</div>';
      } else {
        autoList.innerHTML = autos.map(function (a) {
          return '<div class="faye-signal-card signal-ok">' +
            '<div class="faye-signal-title">' + esc(a.name || a.title) + '</div>' +
            '<div class="faye-signal-detail">' + esc(a.status || 'Running') + '</div></div>';
        }).join('');
      }
    }
  }

  function confClass(v) {
    if (v >= 0.75) return 'conf-high';
    if (v >= 0.45) return 'conf-medium';
    return 'conf-low';
  }

  // -- Render: Advise Mode ------------------------------------------
  function renderAdviseMode(data) {
    var recList = document.getElementById('faye-rec-list');
    var recs = data.recommendations || [];
    var recCount = document.getElementById('faye-rec-count');
    if (recCount) recCount.textContent = String(recs.length);
    if (recList) {
      if (recs.length === 0) {
        recList.innerHTML = '<div class="faye-notice">No recommendations at this time.</div>';
      } else {
        recList.innerHTML = recs.map(function (r) {
          var confPct = Math.round((r.confidence || 0) * 100);
          var cc = confClass(r.confidence || 0);
          var reasons = '';
          if (r.reasons && r.reasons.length) {
            reasons = '<ul class="faye-reason-stack">' + r.reasons.map(function (reason) {
              return '<li class="faye-reason-item">' + esc(reason) + '</li>';
            }).join('') + '</ul>';
          }
          var approvalClass = r.requires_approval ? 'requires-approval' : 'auto-approved';
          var approvalText = r.requires_approval ? 'Approval required' : 'Auto-approved';
          return '<div class="faye-action-card' + (r.action_prompt ? ' clickable' : '') + '" ' +
            (r.action_prompt ? 'data-prompt="' + esc(r.action_prompt) + '"' : '') + '>' +
            '<div class="faye-action-title"><span class="faye-action-name">' + esc(r.title || r.label) + '</span>' +
            '<span class="faye-action-confidence">' + confPct + '%</span></div>' +
            '<div class="faye-confidence-bar"><div class="faye-confidence-fill ' + cc + '" style="width:' + confPct + '%"></div></div>' +
            reasons +
            '<div class="faye-action-approval ' + approvalClass + '">' + approvalText + '</div></div>';
        }).join('');
      }
    }

    // Delegate click for action prompts
    if (recList) {
      recList.onclick = function (e) {
        var card = e.target.closest('.faye-action-card[data-prompt]');
        if (card) sendChat(card.getAttribute('data-prompt'));
      };
    }

    // Attention items
    var attList = document.getElementById('faye-attention-list');
    var atts = data.attention || data.needs_attention || [];
    if (attList) {
      if (atts.length === 0) {
        attList.innerHTML = '<div class="faye-notice">No items need your attention.</div>';
      } else {
        attList.innerHTML = atts.map(function (a) {
          return '<div class="faye-signal-card signal-warning">' +
            '<div class="faye-signal-title">' + esc(a.title || a.label) + '</div>' +
            '<div class="faye-signal-detail">' + esc(a.detail || a.description || '') + '</div></div>';
        }).join('');
      }
    }
  }

  // -- Render: Act Mode ---------------------------------------------
  function renderActMode(data) {
    var actionList = document.getElementById('faye-action-list');
    var pending = data.pending_actions || [];
    var actionCount = document.getElementById('faye-action-count');
    if (actionCount) actionCount.textContent = String(pending.length);
    if (actionList) {
      if (pending.length === 0) {
        actionList.innerHTML = '<div class="faye-notice">No pending actions.</div>';
      } else {
        actionList.innerHTML = pending.map(function (a) {
          return '<div class="faye-action-card">' +
            '<div class="faye-action-title"><span class="faye-action-name">' + esc(a.title || a.label) + '</span></div>' +
            '<div class="faye-signal-detail">' + esc(a.detail || a.description || '') + '</div>' +
            '<div class="faye-action-approval requires-approval">' +
            (a.tier === 'admin' ? 'CRITICAL -- Admin only' : 'Awaiting approval') + '</div></div>';
        }).join('');
      }
    }

    var executedList = document.getElementById('faye-executed-list');
    var executed = data.recent_actions || data.executed || [];
    if (executedList) {
      if (executed.length === 0) {
        executedList.innerHTML = '<div class="faye-notice">No recent executions.</div>';
      } else {
        executedList.innerHTML = executed.map(function (a) {
          var statusClass = a.success ? 'signal-ok' : 'signal-alert';
          return '<div class="faye-signal-card ' + statusClass + '">' +
            '<div class="faye-signal-title">' + esc(a.title || a.tool || a.label) + '</div>' +
            '<div class="faye-signal-detail">' + (a.success ? 'Completed' : 'Failed') +
            (a.timestamp ? ' -- ' + timeAgo(a.timestamp) : '') + '</div></div>';
        }).join('');
      }
    }
  }

  // -- Render: Learn Mode -------------------------------------------
  function renderLearnMode(data) {
    // Domains / Trust
    var domainList = document.getElementById('faye-domain-list');
    var domains = data.domains || data.trust || [];
    if (domainList) {
      if (domains.length === 0) {
        domainList.innerHTML = '<div class="faye-notice">No domain data available.</div>';
      } else {
        domainList.innerHTML = domains.map(function (d) {
          var level = d.level || 0;
          var status = d.status || 'baseline';
          return '<div class="faye-action-card" style="margin-bottom:8px">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
            '<span class="faye-domain-ring level-' + level + '"></span>' +
            '<span style="font-weight:600;color:var(--faye-text)">' + esc(d.domain || d.label) + '</span>' +
            '<span class="faye-domain-badge domain-' + status + '">' + esc(status) + '</span></div>' +
            '<div class="faye-autonomy-track">' +
            [0,1,2,3,4].map(function (i) {
              return '<div class="faye-autonomy-segment' + (i < level ? ' filled' : '') + '"></div>';
            }).join('') +
            '</div></div>';
        }).join('');
      }
    }

    // Insights
    var insightList = document.getElementById('faye-insight-list');
    var insights = data.insights || data.learning || [];
    var insightCount = document.getElementById('faye-insight-count');
    if (insightCount) insightCount.textContent = String(insights.length);
    if (insightList) {
      if (insights.length === 0) {
        insightList.innerHTML = '<div class="faye-notice">No insights recorded yet.</div>';
      } else {
        insightList.innerHTML = insights.map(function (i) {
          return '<div class="faye-signal-card signal-learning">' +
            '<div class="faye-signal-title">' + esc(i.title || i.label) + '</div>' +
            '<div class="faye-signal-detail">' + esc(i.detail || i.description || '') + '</div>' +
            '<div class="faye-signal-meta"><span>' + timeAgo(i.timestamp || i.learned_at) + '</span></div></div>';
        }).join('');
      }
    }
  }

  // -- Render: Escalate Mode ----------------------------------------
  function renderEscalateMode(data) {
    var escalateList = document.getElementById('faye-escalate-list');
    var items = data.escalations || data.needs_human || [];
    var escalateCount = document.getElementById('faye-escalate-count');
    if (escalateCount) escalateCount.textContent = String(items.length);
    if (escalateList) {
      if (items.length === 0) {
        escalateList.innerHTML = '<div class="faye-notice">No items requiring human decision.</div>';
      } else {
        escalateList.innerHTML = items.map(function (item) {
          return '<div class="faye-signal-card signal-alert">' +
            '<div class="faye-signal-title">' + esc(item.title || item.label) + '</div>' +
            '<div class="faye-signal-detail">' + esc(item.detail || item.description || '') + '</div>' +
            '<div class="faye-action-approval requires-approval">' + esc(item.reason || 'Human decision required') + '</div></div>';
        }).join('');
      }
    }
  }

  // -- Polling Loop -------------------------------------------------
  function startPolling() {
    if (pollTimer) return;
    refreshState();
    pollTimer = setInterval(refreshState, STATE_POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // -- Initialization -----------------------------------------------
  (function init() {
    fetch(API_BASE + '/status', { headers: getAuthHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) {
        setFayeState('uncertain');
      } else {
        setFayeState('idle');
      }
    })
    .catch(function () {
      setFayeState('uncertain');
    });

    startPolling();

    setTimeout(function () {
      showProactiveNotice('F.A.Y.E. online');
    }, 2000);
  })();

  // -- Keyboard Shortcut --------------------------------------------
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      togglePanel();
    }
    if (e.key === 'Escape' && panelOpen) {
      panelOpen = false;
      panel.classList.remove('open');
      backdrop.classList.remove('visible');
    }
  });

  // -- Public API ---------------------------------------------------
  window.FAYE = {
    open: function () { if (!panelOpen) togglePanel(); },
    close: function () { if (panelOpen) togglePanel(); },
    setState: setFayeState,
    ask: sendChat,
    notice: showProactiveNotice,
    refresh: refreshState,
    mode: function (m) { if (MODES.indexOf(m) !== -1) switchMode(m); }
  };

})();