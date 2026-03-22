/**
 * F.A.Y.E. Presence System — 3-Layer Intelligence Interface
 * ===========================================================
 * Replaces the old chat bubble widget with a Jarvis-class presence.
 *
 * Layer 1: Ambient Orb — persistent, always visible, state-reactive
 * Layer 2: Intelligence Panel — slide-out: watching, recommending, doing
 * Layer 3: Conversation Mode — direct dialogue within the panel
 *
 * Usage: <script src="/js/faye-presence.js"></script>
 *        (Requires /styles/faye-core.css)
 */

(function () {
  'use strict';

  const API_BASE = '/api/admin/assistant';
  const STATE_POLL_INTERVAL = 30000; // 30s
  const PROACTIVE_CHECK_INTERVAL = 60000; // 60s

  let conversationId = null;
  let isLoading = false;
  let panelOpen = false;
  let activeMode = 'observe'; // observe | advise | converse | learn
  let currentState = 'idle'; // idle | listening | analyzing | alerting | executing | uncertain | confident
  let stateData = { alerts: 0, risks: [], recommendations: [], automations: [], insights: [], domains: [] };
  let pollTimer = null;
  let proactiveTimer = null;

  // ── Auth ──────────────────────────────────────────────────────
  function getAuthHeaders() {
    const token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
    return token
      ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  // ── DOM Construction ──────────────────────────────────────────

  function buildOrb(sizeClass) {
    const c = document.createElement('div');
    c.className = 'faye-orb-container faye-state-idle ' + (sizeClass || '');
    c.innerHTML =
      '<div class="faye-orb-core"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--inner"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--middle"></div>' +
      '<div class="faye-orb-ring faye-orb-ring--outer"></div>';
    return c;
  }

  function setOrbState(orb, state) {
    orb.className = orb.className.replace(/faye-state-\S+/g, '').trim();
    orb.classList.add('faye-state-' + state);
  }

  // ── Layer 1: Ambient Presence ─────────────────────────────────

  const ambient = document.createElement('div');
  ambient.className = 'faye-ambient';
  ambient.id = 'faye-ambient';

  const ambientRow = document.createElement('div');
  ambientRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-direction:row-reverse;pointer-events:auto';

  const ambientOrb = document.createElement('div');
  ambientOrb.className = 'faye-ambient-orb';
  const orbEl = buildOrb();
  ambientOrb.appendChild(orbEl);

  const ambientBadge = document.createElement('div');
  ambientBadge.className = 'faye-ambient-badge';
  ambientBadge.id = 'faye-ambient-badge';
  ambientOrb.appendChild(ambientBadge);

  const ambientStatus = document.createElement('div');
  ambientStatus.className = 'faye-ambient-status';
  ambientStatus.id = 'faye-ambient-status';
  ambientStatus.textContent = 'F.A.Y.E. monitoring';

  ambientRow.appendChild(ambientOrb);
  ambientRow.appendChild(ambientStatus);
  ambient.appendChild(ambientRow);
  document.body.appendChild(ambient);

  // Click orb to toggle intelligence panel
  ambientOrb.addEventListener('click', function () {
    togglePanel();
  });

  // ── Layer 2: Intelligence Panel ───────────────────────────────

  const backdrop = document.createElement('div');
  backdrop.className = 'faye-intel-panel-backdrop';
  backdrop.id = 'faye-intel-backdrop';
  document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'faye-intel-panel';
  panel.id = 'faye-intel-panel';
  panel.innerHTML = [
    '<div class="faye-intel-header">',
    '  <div class="faye-intel-header-orb" id="faye-panel-orb-wrap"></div>',
    '  <div class="faye-intel-header-text">',
    '    <div class="faye-intel-title">F.A.Y.E.</div>',
    '    <div class="faye-intel-subtitle" id="faye-panel-subtitle">Observing operations</div>',
    '  </div>',
    '  <button class="faye-intel-close" id="faye-panel-close" title="Close">&times;</button>',
    '</div>',
    '<div class="faye-mode-tabs" id="faye-mode-tabs">',
    '  <button class="faye-mode-tab active" data-mode="observe">Observe</button>',
    '  <button class="faye-mode-tab" data-mode="advise">Advise</button>',
    '  <button class="faye-mode-tab" data-mode="converse">Chat</button>',
    '  <button class="faye-mode-tab" data-mode="learn">Learn</button>',
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
    '<!-- Converse Mode -->',
    '<div class="faye-conversation" id="faye-mode-converse">',
    '  <div class="faye-conversation-messages faye-scroll" id="faye-conv-messages">',
    '    <div class="faye-conv-msg system">F.A.Y.E. ready for direct dialogue.</div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Learn Mode -->',
    '<div class="faye-intel-body faye-scroll" id="faye-mode-learn" style="display:none">',
    '  <div class="faye-intel-section">',
    '    <div class="faye-intel-section-header">',
    '      <div class="faye-section-label">Trust &amp; Autonomy</div>',
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
    '<!-- Footer: always-visible chat input -->',
    '<div class="faye-intel-footer">',
    '  <div class="faye-intel-chat-input">',
    '    <textarea id="faye-panel-input" rows="1" placeholder="Ask F.A.Y.E. anything..."></textarea>',
    '    <button class="faye-intel-send" id="faye-panel-send" title="Send">&#9654;</button>',
    '  </div>',
    '</div>'
  ].join('\n');
  document.body.appendChild(panel);

  // Insert orb into panel header
  var panelOrbWrap = document.getElementById('faye-panel-orb-wrap');
  var panelOrb = buildOrb();
  panelOrbWrap.appendChild(panelOrb);

  // ── Panel Controls ────────────────────────────────────────────

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    backdrop.classList.toggle('visible', panelOpen);
    if (panelOpen) {
      document.getElementById('faye-panel-input').focus();
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

  // ── Mode Switching ────────────────────────────────────────────

  var modeTabs = document.getElementById('faye-mode-tabs');
  modeTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.faye-mode-tab');
    if (!tab) return;
    var mode = tab.getAttribute('data-mode');
    switchMode(mode);
  });

  function switchMode(mode) {
    activeMode = mode;
    modeTabs.querySelectorAll('.faye-mode-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-mode') === mode);
    });

    ['observe', 'advise', 'converse', 'learn'].forEach(function (m) {
      var el = document.getElementById('faye-mode-' + m);
      if (!el) return;
      if (m === 'converse') {
        el.classList.toggle('active', m === mode);
      } else {
        el.style.display = m === mode ? '' : 'none';
      }
    });

    updatePanelSubtitle();
  }

  function updatePanelSubtitle() {
    var sub = document.getElementById('faye-panel-subtitle');
    var labels = {
      observe: 'Monitoring operations',
      advise: 'Reviewing recommendations',
      converse: 'Direct dialogue',
      learn: 'Knowledge and autonomy'
    };
    sub.textContent = labels[activeMode] || labels.observe;
  }

  // ── Chat (Layer 3: Conversation) ──────────────────────────────

  var convMessages = document.getElementById('faye-conv-messages');
  var panelInput = document.getElementById('faye-panel-input');
  var panelSend = document.getElementById('faye-panel-send');

  panelSend.addEventListener('click', function () {
    var text = panelInput.value.trim();
    if (text) sendChat(text);
  });

  panelInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = panelInput.value.trim();
      if (text) sendChat(text);
    }
  });

  panelInput.addEventListener('input', function () {
    panelInput.style.height = 'auto';
    panelInput.style.height = Math.min(panelInput.scrollHeight, 80) + 'px';
  });

  // When user types in non-converse mode, auto-switch to converse
  panelInput.addEventListener('focus', function () {
    if (activeMode !== 'converse') {
      switchMode('converse');
    }
  });

  function addConvMessage(role, content) {
    var div = document.createElement('div');
    div.className = 'faye-conv-msg ' + role;
    if (role === 'assistant') {
      div.innerHTML = renderMarkdown(content);
    } else {
      div.textContent = content;
    }
    convMessages.appendChild(div);
    convMessages.scrollTop = convMessages.scrollHeight;
    return div;
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'faye-conv-msg system';
    div.id = 'faye-typing-indicator';
    div.innerHTML = '<span style="display:inline-flex;gap:4px"><span class="faye-status-dot"></span><span class="faye-status-dot" style="animation-delay:0.2s"></span><span class="faye-status-dot" style="animation-delay:0.4s"></span></span>';
    convMessages.appendChild(div);
    convMessages.scrollTop = convMessages.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('faye-typing-indicator');
    if (el) el.remove();
  }

  async function sendChat(text) {
    if (isLoading) return;
    isLoading = true;
    panelSend.disabled = true;
    panelInput.value = '';
    panelInput.style.height = 'auto';

    // Auto-switch to converse mode
    if (activeMode !== 'converse') switchMode('converse');

    addConvMessage('user', text);
    setFayeState('analyzing');
    showTyping();

    try {
      var resp = await fetch(API_BASE + '/chat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ message: text, conversation_id: conversationId })
      });

      hideTyping();
      var data = await resp.json();

      if (data.ok) {
        conversationId = data.conversation_id;

        // Show tool badges
        if (data.tool_calls && data.tool_calls.length > 0) {
          var toolDiv = document.createElement('div');
          toolDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-self:flex-start;padding:0 4px';
          data.tool_calls.forEach(function (t) {
            var badge = document.createElement('span');
            badge.className = 'faye-tool-badge' + (t.success ? '' : ' tool-failed');
            badge.textContent = (t.success ? '+ ' : '- ') + t.tool.replace(/_/g, ' ');
            toolDiv.appendChild(badge);
          });
          convMessages.appendChild(toolDiv);
        }

        addConvMessage('assistant', data.reply);

        // Confirmation flow
        if (data.pending_action) {
          showConfirmBar(data.pending_action);
        }

        if (data.action_executed) {
          var aBadge = document.createElement('div');
          aBadge.className = 'faye-tool-badge' + (data.action_executed.success ? '' : ' tool-failed');
          aBadge.textContent = (data.action_executed.success ? 'Executed: ' : 'Failed: ') + data.action_executed.tool.replace(/_/g, ' ');
          convMessages.appendChild(aBadge);
          convMessages.scrollTop = convMessages.scrollHeight;
        }

        setFayeState('confident');
      } else {
        addConvMessage('system', 'Error: ' + (data.error || 'Unknown error'));
        setFayeState('uncertain');
      }
    } catch (err) {
      hideTyping();
      addConvMessage('system', 'Connection error: ' + err.message);
      setFayeState('uncertain');
    }

    isLoading = false;
    panelSend.disabled = false;
    panelInput.focus();

    // Return to idle after a few seconds
    setTimeout(function () { if (currentState === 'confident') setFayeState('idle'); }, 4000);
  }

  function showConfirmBar(pending) {
    var existing = document.getElementById('faye-confirm-row');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'faye-confirm-row';
    bar.style.cssText = 'display:flex;gap:8px;padding:4px 8px;align-self:flex-start;align-items:center';

    var label = document.createElement('span');
    label.className = 'faye-action-approval requires-approval';
    label.textContent = pending.tier === 'admin' ? 'CRITICAL' : 'Approval needed';

    var yesBtn = document.createElement('button');
    yesBtn.className = 'faye-mode-tab';
    yesBtn.style.cssText = 'background:rgba(16,185,129,0.2);color:#6ee7b7;cursor:pointer';
    yesBtn.textContent = 'Confirm';
    yesBtn.addEventListener('click', function () { bar.remove(); sendChat('yes'); });

    var noBtn = document.createElement('button');
    noBtn.className = 'faye-mode-tab';
    noBtn.style.cssText = 'cursor:pointer';
    noBtn.textContent = 'Cancel';
    noBtn.addEventListener('click', function () { bar.remove(); sendChat('cancel'); });

    bar.appendChild(label);
    bar.appendChild(yesBtn);
    bar.appendChild(noBtn);
    convMessages.appendChild(bar);
    convMessages.scrollTop = convMessages.scrollHeight;
  }

  // ── State Management ──────────────────────────────────────────

  function setFayeState(state) {
    currentState = state;
    setOrbState(orbEl, state);
    setOrbState(panelOrb, state);

    // Update ambient status text
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

  // ── State Refresh (polls /api/admin/assistant/state) ──────────

  async function refreshState() {
    try {
      var resp = await fetch(API_BASE + '/state', { headers: getAuthHeaders() });
      if (!resp.ok) return;
      var data = await resp.json();
      if (!data.ok) return;
      stateData = data;
      renderObserveMode(data);
      renderAdviseMode(data);
      renderLearnMode(data);
      updateAmbient(data);
    } catch (e) {
      // Silently fail — state polling is best-effort
    }
  }

  function updateAmbient(data) {
    var badge = document.getElementById('faye-ambient-badge');
    var alertCount = (data.alerts || 0);
    badge.textContent = alertCount > 0 ? String(alertCount) : '';

    // Set orb state based on alerts
    if (alertCount > 0 && currentState === 'idle') {
      setFayeState('alerting');
    } else if (alertCount === 0 && currentState === 'alerting') {
      setFayeState('idle');
    }

    // Show proactive status briefly
    if (data.proactive_message) {
      var statusEl = document.getElementById('faye-ambient-status');
      statusEl.textContent = data.proactive_message;
      ambient.classList.add('show-status');
      setTimeout(function () { ambient.classList.remove('show-status'); }, 5000);
    }
  }

  // ── Render: Observe Mode ──────────────────────────────────────

  function renderObserveMode(data) {
    // Watching
    var watchList = document.getElementById('faye-watch-list');
    var watches = data.watching || [];
    document.getElementById('faye-watch-count').textContent = String(watches.length);
    watchList.innerHTML = '';

    if (watches.length === 0) {
      watchList.innerHTML = '<div class="faye-notice">All systems nominal. No active watches.</div>';
    } else {
      watches.forEach(function (w) {
        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-' + (w.severity || 'ok');
        card.innerHTML =
          '<div class="faye-signal-title">' + esc(w.title) + '</div>' +
          '<div class="faye-signal-detail">' + esc(w.detail) + '</div>' +
          '<div class="faye-signal-meta">' +
          '  <span>' + esc(w.domain || '') + '</span>' +
          (w.since ? '  <span>' + timeAgo(w.since) + '</span>' : '') +
          '</div>';
        watchList.appendChild(card);
      });
    }

    // Risks
    var riskList = document.getElementById('faye-risk-list');
    var risks = data.risks || [];
    document.getElementById('faye-risk-count').textContent = String(risks.length);
    riskList.innerHTML = '';

    if (risks.length === 0) {
      riskList.innerHTML = '<div class="faye-notice">No active risks detected.</div>';
    } else {
      risks.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-' + (r.severity || 'warning');
        card.innerHTML =
          '<div class="faye-signal-title">' + esc(r.title) + '</div>' +
          '<div class="faye-signal-detail">' + esc(r.detail) + '</div>' +
          '<div class="faye-signal-meta"><span>' + esc(r.domain || '') + '</span></div>';
        riskList.appendChild(card);
      });
    }

    // Automations
    var autoList = document.getElementById('faye-automation-list');
    var autos = data.automations || [];
    autoList.innerHTML = '';

    if (autos.length === 0) {
      autoList.innerHTML = '<div class="faye-notice">No active automations.</div>';
    } else {
      autos.forEach(function (a) {
        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-ok';
        card.innerHTML =
          '<div class="faye-signal-title">' + esc(a.name) + '</div>' +
          '<div class="faye-signal-detail">' + esc(a.status || 'Running') + '</div>';
        autoList.appendChild(card);
      });
    }
  }

  // ── Render: Advise Mode ───────────────────────────────────────

  function renderAdviseMode(data) {
    var recList = document.getElementById('faye-rec-list');
    var recs = data.recommendations || [];
    document.getElementById('faye-rec-count').textContent = String(recs.length);
    recList.innerHTML = '';

    if (recs.length === 0) {
      recList.innerHTML = '<div class="faye-notice">No recommendations at this time.</div>';
    } else {
      recs.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'faye-action-card';

        var confClass = (r.confidence || 0) >= 0.8 ? 'conf-high' : (r.confidence || 0) >= 0.5 ? 'conf-medium' : 'conf-low';
        var confPct = Math.round((r.confidence || 0) * 100);
        var reasons = (r.reasons || []);

        var html =
          '<div class="faye-action-title">' +
          '  <span class="faye-action-name">' + esc(r.title) + '</span>' +
          '  <span class="faye-action-confidence">' + confPct + '%</span>' +
          '</div>' +
          '<div class="faye-confidence-bar"><div class="faye-confidence-fill ' + confClass + '" style="width:' + confPct + '%"></div></div>';

        if (reasons.length > 0) {
          html += '<ul class="faye-reason-stack">';
          reasons.forEach(function (reason) {
            html += '<li class="faye-reason-item">' + esc(reason) + '</li>';
          });
          html += '</ul>';
        }

        var approvalClass = r.requires_approval ? 'requires-approval' : 'auto-approved';
        var approvalText = r.requires_approval ? 'Approval required' : 'Auto-approved';
        html += '<div class="faye-action-approval ' + approvalClass + '">' + approvalText + '</div>';

        card.innerHTML = html;

        // If clickable, send as chat
        if (r.action_prompt) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', (function (prompt) {
            return function () { sendChat(prompt); };
          })(r.action_prompt));
        }

        recList.appendChild(card);
      });
    }

    // Attention items
    var attList = document.getElementById('faye-attention-list');
    var attention = data.attention || [];
    attList.innerHTML = '';

    if (attention.length === 0) {
      attList.innerHTML = '<div class="faye-notice">Nothing requires your attention right now.</div>';
    } else {
      attention.forEach(function (a) {
        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-warning';
        card.innerHTML =
          '<div class="faye-signal-title">' + esc(a.title) + '</div>' +
          '<div class="faye-signal-detail">' + esc(a.detail) + '</div>';
        attList.appendChild(card);
      });
    }
  }

  // ── Render: Learn Mode ────────────────────────────────────────

  function renderLearnMode(data) {
    // Domains
    var domainList = document.getElementById('faye-domain-list');
    var domains = data.domains || [];
    domainList.innerHTML = '';

    if (domains.length === 0) {
      domainList.innerHTML = '<div class="faye-notice">Domain ownership data not yet available.</div>';
    } else {
      domains.forEach(function (d) {
        var levelClass = 'level-' + (d.level || 0);
        var badgeClass = d.level >= 3 ? 'domain-owned' : d.level >= 2 ? 'domain-learning' : d.level >= 1 ? 'domain-observing' : 'domain-baseline';

        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-ok';
        card.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px">' +
          '  <div class="faye-domain-ring ' + levelClass + '"></div>' +
          '  <div>' +
          '    <div class="faye-signal-title">' + esc(d.domain) + '</div>' +
          '    <span class="faye-domain-badge ' + badgeClass + '">L' + (d.level || 0) + ' ' + (d.label || '') + '</span>' +
          '  </div>' +
          '</div>' +
          '<div style="margin-top:8px">' +
          '  <div class="faye-autonomy-track">' +
          buildAutonomySegments(d.level || 0, 4) +
          '  </div>' +
          '</div>' +
          (d.detail ? '<div class="faye-signal-detail" style="margin-top:6px">' + esc(d.detail) + '</div>' : '');
        domainList.appendChild(card);
      });
    }

    // Insights
    var insightList = document.getElementById('faye-insight-list');
    var insights = data.insights || [];
    document.getElementById('faye-insight-count').textContent = String(insights.length);
    insightList.innerHTML = '';

    if (insights.length === 0) {
      insightList.innerHTML = '<div class="faye-notice">No learned insights yet.</div>';
    } else {
      insights.forEach(function (ins) {
        var card = document.createElement('div');
        card.className = 'faye-signal-card signal-ok';
        var confPct = Math.round((ins.confidence || 0) * 100);
        card.innerHTML =
          '<div class="faye-signal-title">' + esc(ins.topic) + '</div>' +
          '<div class="faye-signal-detail">' + esc(ins.insight) + '</div>' +
          '<div class="faye-signal-meta">' +
          '  <span class="faye-domain-badge domain-observing">' + esc(ins.domain || '') + '</span>' +
          '  <span>Confidence: ' + confPct + '%</span>' +
          '</div>';
        insightList.appendChild(card);
      });
    }
  }

  function buildAutonomySegments(level, max) {
    var html = '';
    for (var i = 0; i < max; i++) {
      html += '<div class="faye-autonomy-segment' + (i < level ? ' filled' : '') + '"></div>';
    }
    return html;
  }

  // ── Utilities ─────────────────────────────────────────────────

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    var safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    var diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ── Proactive surface: brief status flash ─────────────────────

  function showProactiveNotice(text) {
    var statusEl = document.getElementById('faye-ambient-status');
    statusEl.textContent = text;
    ambient.classList.add('show-status');
    setTimeout(function () {
      ambient.classList.remove('show-status');
      // Reset to default
      var labels = {
        idle: 'F.A.Y.E. monitoring',
        alerting: stateData.alerts + ' active risk' + (stateData.alerts === 1 ? '' : 's')
      };
      statusEl.textContent = labels[currentState] || labels.idle;
    }, 6000);
  }

  // ── Polling Loop ──────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) return;
    refreshState();
    pollTimer = setInterval(refreshState, STATE_POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Initialization ────────────────────────────────────────────

  (async function init() {
    // Check service health
    try {
      var resp = await fetch(API_BASE + '/status', { headers: getAuthHeaders() });
      var data = await resp.json();
      if (!data.ok || (!data.llm?.primary?.available && !data.llm?.fallback?.available)) {
        setFayeState('uncertain');
      } else {
        setFayeState('idle');
      }
    } catch (e) {
      setFayeState('uncertain');
    }

    startPolling();

    // Flash initial status
    setTimeout(function () {
      showProactiveNotice('F.A.Y.E. online');
    }, 2000);
  })();

  // ── Keyboard Shortcut ─────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd + Shift + F to toggle panel
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      togglePanel();
    }
    // Escape to close panel
    if (e.key === 'Escape' && panelOpen) {
      panelOpen = false;
      panel.classList.remove('open');
      backdrop.classList.remove('visible');
    }
  });

  // ── Public API (for cross-page integration) ───────────────────
  window.FAYE = {
    open: function () { if (!panelOpen) togglePanel(); },
    close: function () { if (panelOpen) togglePanel(); },
    setState: setFayeState,
    ask: sendChat,
    notice: showProactiveNotice,
    refresh: refreshState
  };
})();
