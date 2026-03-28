/**
 * E.V.I.E. Presence System -- 3-Layer Farm Intelligence Interface
 * =================================================================
 * Replaces the old chat bubble widget with an ambient intelligence presence.
 *
 * Layer 1: Ambient Orb -- persistent, always visible, farm-health-reactive
 * Layer 2: Intelligence Panel -- slide-out: environment, crops, tasks, risks
 * Layer 3: Conversation Mode -- direct dialogue within the panel
 *
 * Usage: <script src="/js/evie-presence.js"></script>
 *        (Requires /styles/evie-core.css)
 */

(function () {
  'use strict';

  var API_BASE = '/api/assistant';
  var STATE_POLL_INTERVAL = 30000;  // 30s
  var PROACTIVE_CHECK_INTERVAL = 60000; // 60s

  var conversationId = null;
  var isLoading = false;
  var panelOpen = false;
  var activeMode = 'observe';  // observe | advise | converse | learn
  var currentState = 'idle';   // idle | wake | listening | thinking | explaining | confirming | alert | uncertain | offline
  var stateData = {
    alerts: 0, rooms: [], crops: [], tasks: [], risks: [],
    environment: [], recommendations: [], insights: [], farm_name: ''
  };
  var pollTimer = null;
  var proactiveTimer = null;

  // ── Auth ─────────────────────────────────────────────────────
  function getAuthHeaders() {
    var token = localStorage.getItem('token') || sessionStorage.getItem('token')
      || localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    return token
      ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  // ── DOM Construction ─────────────────────────────────────────

  function buildOrb(sizeClass) {
    var c = document.createElement('div');
    c.className = 'evie-orb-container evie-state-idle ' + (sizeClass || '');
    c.innerHTML =
      '<div class="evie-orb-core"></div>' +
      '<div class="evie-orb-halo evie-orb-halo--inner"></div>' +
      '<div class="evie-orb-halo evie-orb-halo--mid"></div>' +
      '<div class="evie-orb-halo evie-orb-halo--outer"></div>';
    return c;
  }

  function setOrbState(orb, state) {
    if (!orb) return;
    orb.className = orb.className.replace(/evie-state-\S+/g, '').trim();
    orb.classList.add('evie-state-' + state);
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function timeAgo(ts) {
    if (!ts) return '';
    var ms = Date.now() - new Date(ts).getTime();
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // ── Layer 1: Ambient Presence ────────────────────────────────

  var ambient = document.createElement('div');
  ambient.className = 'evie-ambient';
  ambient.id = 'evie-ambient';

  var ambientRow = document.createElement('div');
  ambientRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-direction:row-reverse;pointer-events:auto';

  var ambientOrbWrap = document.createElement('div');
  ambientOrbWrap.className = 'evie-ambient-orb';
  var orbEl = buildOrb();
  ambientOrbWrap.appendChild(orbEl);

  var ambientBadge = document.createElement('div');
  ambientBadge.className = 'evie-ambient-badge';
  ambientBadge.id = 'evie-ambient-badge';
  ambientOrbWrap.appendChild(ambientBadge);

  var statusEl = document.createElement('div');
  statusEl.className = 'evie-ambient-status';
  statusEl.id = 'evie-ambient-status';
  statusEl.textContent = 'Monitoring your farm';

  ambientRow.appendChild(ambientOrbWrap);
  ambientRow.appendChild(statusEl);
  ambient.appendChild(ambientRow);

  ambientOrbWrap.addEventListener('click', function () { togglePanel(); });

  // ── Layer 2: Intelligence Panel ──────────────────────────────

  var panel = document.createElement('div');
  panel.className = 'evie-intel-panel';
  panel.id = 'evie-intel-panel';

  // -- Header
  var panelHeader = document.createElement('div');
  panelHeader.className = 'evie-intel-header';

  var panelOrb = buildOrb('evie-orb--compact');

  var headerText = document.createElement('div');
  headerText.className = 'evie-intel-header-text';
  headerText.innerHTML = '<h2>E.V.I.E.</h2><small id="evie-panel-subtitle">Farm Intelligence</small>';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'evie-intel-close';
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.addEventListener('click', function () { togglePanel(false); });

  panelHeader.appendChild(panelOrb);
  panelHeader.appendChild(headerText);
  panelHeader.appendChild(closeBtn);
  panel.appendChild(panelHeader);

  // -- Mode Tabs
  var tabBar = document.createElement('div');
  tabBar.className = 'evie-mode-tabs';
  var modes = [
    { key: 'observe', label: 'Observe' },
    { key: 'advise',  label: 'Advise' },
    { key: 'converse', label: 'Chat' },
    { key: 'learn',   label: 'Farm' }
  ];
  var modeIcons = {
    observe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    advise: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>',
    converse: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    learn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>'
  };
  modes.forEach(function (m) {
    var btn = document.createElement('button');
    btn.className = 'evie-mode-tab' + (m.key === activeMode ? ' active' : '');
    btn.dataset.mode = m.key;
    btn.innerHTML = '<span class="evie-mode-tab-icon">' + (modeIcons[m.key] || '') + '</span>' + m.label;
    btn.addEventListener('click', function () { switchMode(m.key); });
    tabBar.appendChild(btn);
  });
  panel.appendChild(tabBar);

  // -- Body
  var panelBody = document.createElement('div');
  panelBody.className = 'evie-intel-body';
  panelBody.id = 'evie-intel-body';
  panel.appendChild(panelBody);

  // ── Build Mode Content ───────────────────────────────────────

  // --- Observe Mode ---
  var observeEl = document.createElement('div');
  observeEl.id = 'evie-mode-observe';
  observeEl.innerHTML =
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Environment <span class="count" id="evie-env-count">0</span></div>' +
    '  <div id="evie-env-list"></div>' +
    '</div>' +
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Active Crops <span class="count" id="evie-crop-count">0</span></div>' +
    '  <div id="evie-crop-list"></div>' +
    '</div>' +
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Alerts <span class="count" id="evie-alert-count">0</span></div>' +
    '  <div id="evie-alert-list"></div>' +
    '</div>';

  // --- Advise Mode ---
  var adviseEl = document.createElement('div');
  adviseEl.id = 'evie-mode-advise';
  adviseEl.style.display = 'none';
  adviseEl.innerHTML =
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Today\'s Tasks <span class="count" id="evie-task-count">0</span></div>' +
    '  <div id="evie-task-list"></div>' +
    '</div>' +
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Risks <span class="count" id="evie-risk-count">0</span></div>' +
    '  <div id="evie-risk-list"></div>' +
    '</div>' +
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Recommendations <span class="count" id="evie-rec-count">0</span></div>' +
    '  <div id="evie-rec-list"></div>' +
    '</div>';

  // --- Converse Mode ---
  var converseEl = document.createElement('div');
  converseEl.id = 'evie-mode-converse';
  converseEl.style.display = 'none';
  converseEl.className = 'evie-conversation';
  converseEl.innerHTML =
    '<div class="evie-conv-messages" id="evie-conv-messages"></div>' +
    '<div class="evie-conv-input-row">' +
    '  <input class="evie-conv-input" id="evie-conv-input" placeholder="Ask E.V.I.E. about your farm..." />' +
    '  <button class="evie-conv-send" id="evie-conv-send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
    '</div>';

  // --- Learn Mode (Farm Profile) ---
  var learnEl = document.createElement('div');
  learnEl.id = 'evie-mode-learn';
  learnEl.style.display = 'none';
  learnEl.innerHTML =
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Farm Profile</div>' +
    '  <div id="evie-farm-profile"></div>' +
    '</div>' +
    '<div class="evie-intel-section">' +
    '  <div class="evie-intel-section-title">Insights <span class="count" id="evie-insight-count">0</span></div>' +
    '  <div id="evie-insight-list"></div>' +
    '</div>';

  panelBody.appendChild(observeEl);
  panelBody.appendChild(adviseEl);
  panelBody.appendChild(converseEl);
  panelBody.appendChild(learnEl);

  // ── Inject into DOM ──────────────────────────────────────────
  function inject() {
    document.body.appendChild(ambient);
    document.body.appendChild(panel);
    startPolling();
    attachChatEvents();
    refreshState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // ── Panel Toggle ─────────────────────────────────────────────

  function togglePanel(forceState) {
    panelOpen = forceState !== undefined ? forceState : !panelOpen;
    panel.classList.toggle('open', panelOpen);
    if (panelOpen) {
      refreshState();
    }
  }

  // ── Mode Switching ───────────────────────────────────────────

  function switchMode(mode) {
    activeMode = mode;
    var tabs = tabBar.querySelectorAll('.evie-mode-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.mode === mode);
    }
    observeEl.style.display = mode === 'observe' ? '' : 'none';
    adviseEl.style.display  = mode === 'advise'  ? '' : 'none';
    converseEl.style.display = mode === 'converse' ? '' : 'none';
    learnEl.style.display   = mode === 'learn'   ? '' : 'none';

    if (mode === 'converse') {
      setTimeout(function () {
        var inp = document.getElementById('evie-conv-input');
        if (inp) inp.focus();
      }, 100);
    }
  }

  // ── Chat (Layer 3: Conversation) ─────────────────────────────

  function attachChatEvents() {
    var inp = document.getElementById('evie-conv-input');
    var btn = document.getElementById('evie-conv-send');
    if (!inp || !btn) return;

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(inp.value); }
    });
    btn.addEventListener('click', function () { sendChat(inp.value); });
  }

  function addChatMsg(role, text) {
    var box = document.getElementById('evie-conv-messages');
    if (!box) return;
    var msg = document.createElement('div');
    msg.className = 'evie-conv-msg ' + role;
    msg.innerHTML = (role === 'user' ? '<strong>You:</strong> ' : '<strong>E.V.I.E.:</strong> ') + esc(text);
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(text) {
    text = (text || '').trim();
    if (!text || isLoading) return;

    var inp = document.getElementById('evie-conv-input');
    if (inp) inp.value = '';

    addChatMsg('user', text);
    isLoading = true;
    setEvieState('thinking');

    try {
      var body = { message: text };
      if (conversationId) body.conversation_id = conversationId;

      var resp = await fetch(API_BASE + '/chat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
      });

      var data = await resp.json();
      if (data.ok !== false && data.reply) {
        conversationId = data.conversation_id || conversationId;
        if (data.tool_calls && data.tool_calls.length > 0) {
          var interAgentTools = ['escalate_to_faye', 'reply_to_faye', 'get_faye_directives'];
          data.tool_calls.forEach(function (t) {
            var toolName = t.name || t.tool || 'unknown';
            if (interAgentTools.indexOf(toolName) !== -1) {
              if (toolName === 'escalate_to_faye') {
                addChatMsg('system', 'Checking in with big sister F.A.Y.E...');
              } else if (toolName === 'get_faye_directives') {
                addChatMsg('system', 'Checking for notes from F.A.Y.E...');
              }
            } else {
              addChatMsg('system', 'Used tool: ' + toolName);
            }
          });
        }
        addChatMsg('assistant', data.reply);
        setEvieState('explaining');
        setTimeout(function () { setEvieState('idle'); }, 3000);
      } else {
        addChatMsg('system', 'Error: ' + (data.error || 'Unknown error'));
        setEvieState('uncertain');
        setTimeout(function () { setEvieState('idle'); }, 3000);
      }
    } catch (e) {
      addChatMsg('system', 'Connection error. Please try again.');
      setEvieState('offline');
      setTimeout(function () { setEvieState('idle'); }, 5000);
    }
    isLoading = false;
  }

  // ── State Management ─────────────────────────────────────────

  function setEvieState(state) {
    currentState = state;
    setOrbState(orbEl, state);
    setOrbState(panelOrb, state);

    var labels = {
      idle: 'Monitoring your farm',
      wake: 'Attention detected',
      listening: 'Listening...',
      thinking: 'Thinking...',
      explaining: 'Here is what I found',
      confirming: 'Done',
      alert: stateData.alerts + ' alert' + (stateData.alerts === 1 ? '' : 's') + ' active',
      uncertain: 'Checking on something...',
      offline: 'Reconnecting...'
    };
    statusEl.textContent = labels[state] || labels.idle;
  }

  // ── State Refresh (polls /api/assistant/state) ───────────────

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
      // Best-effort polling -- silent fail
    }
  }

  function updateAmbient(data) {
    var badge = document.getElementById('evie-ambient-badge');
    var alertCount = data.alerts || 0;
    if (badge) badge.textContent = alertCount > 0 ? String(alertCount) : '';

    if (alertCount > 0 && currentState === 'idle') {
      setEvieState('alert');
    } else if (alertCount === 0 && currentState === 'alert') {
      setEvieState('idle');
    }

    // Proactive message
    if (data.proactive_message) {
      statusEl.textContent = data.proactive_message;
      ambient.classList.add('show-status');
      setTimeout(function () { ambient.classList.remove('show-status'); }, 5000);
    }

    // Update panel subtitle with farm name
    var subtitle = document.getElementById('evie-panel-subtitle');
    if (subtitle && data.farm_name) {
      subtitle.textContent = data.farm_name;
    }
  }

  // ── Render: Observe Mode ─────────────────────────────────────

  function renderObserveMode(data) {
    // Environment
    var envList = document.getElementById('evie-env-list');
    var rooms = data.rooms || [];
    var envCount = document.getElementById('evie-env-count');
    if (envCount) envCount.textContent = String(rooms.length);

    if (envList) {
      envList.innerHTML = '';
      if (rooms.length === 0) {
        envList.innerHTML = '<div class="evie-notice">No room data available.</div>';
      } else {
        rooms.forEach(function (r) {
          var sev = 'info';
          if (r.drift && r.drift > 0) sev = r.drift > 2 ? 'high' : 'medium';
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-' + sev;
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(r.name || 'Room') + '</div>' +
            '<div class="evie-signal-detail">' +
            (r.temp != null ? 'Temp: ' + r.temp + (r.temp_unit || 'C') + ' ' : '') +
            (r.humidity != null ? 'RH: ' + r.humidity + '% ' : '') +
            (r.vpd != null ? 'VPD: ' + r.vpd + ' kPa ' : '') +
            '</div>' +
            (r.drift ? '<div class="evie-signal-meta"><span>Drift: ' + r.drift.toFixed(1) + '</span></div>' : '');
          envList.appendChild(card);
        });
      }
    }

    // Crops
    var cropList = document.getElementById('evie-crop-list');
    var crops = data.crops || [];
    var cropCount = document.getElementById('evie-crop-count');
    if (cropCount) cropCount.textContent = String(crops.length);

    if (cropList) {
      cropList.innerHTML = '';
      if (crops.length === 0) {
        cropList.innerHTML = '<div class="evie-notice">No active plantings.</div>';
      } else {
        crops.forEach(function (c) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-info';
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(c.name || c.crop) + '</div>' +
            '<div class="evie-signal-detail">' +
            (c.stage ? 'Stage: ' + esc(c.stage) + ' ' : '') +
            (c.room ? 'in ' + esc(c.room) + ' ' : '') +
            (c.day != null ? '(Day ' + c.day + ')' : '') +
            '</div>' +
            (c.harvest_in != null ? '<div class="evie-signal-meta"><span>Harvest in ~' + c.harvest_in + ' days</span></div>' : '');
          cropList.appendChild(card);
        });
      }
    }

    // Alerts
    var alertList = document.getElementById('evie-alert-list');
    var alerts = data.alert_items || [];
    var alertCountEl = document.getElementById('evie-alert-count');
    if (alertCountEl) alertCountEl.textContent = String(alerts.length);

    if (alertList) {
      alertList.innerHTML = '';
      if (alerts.length === 0) {
        alertList.innerHTML = '<div class="evie-notice">All systems nominal.</div>';
      } else {
        alerts.forEach(function (a) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-' + (a.severity || 'info');
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(a.title) + '</div>' +
            '<div class="evie-signal-detail">' + esc(a.detail || '') + '</div>' +
            '<div class="evie-signal-meta">' +
            (a.domain ? '<span>' + esc(a.domain) + '</span>' : '') +
            (a.since ? '<span>' + timeAgo(a.since) + '</span>' : '') +
            '</div>';
          alertList.appendChild(card);
        });
      }
    }
  }

  // ── Render: Advise Mode ──────────────────────────────────────

  function renderAdviseMode(data) {
    // Tasks
    var taskList = document.getElementById('evie-task-list');
    var tasks = data.tasks || [];
    var taskCount = document.getElementById('evie-task-count');
    if (taskCount) taskCount.textContent = String(tasks.length);

    if (taskList) {
      taskList.innerHTML = '';
      if (tasks.length === 0) {
        taskList.innerHTML = '<div class="evie-notice">No tasks prioritized for today.</div>';
      } else {
        tasks.forEach(function (t) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-info';
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(t.title || t.label) + '</div>' +
            '<div class="evie-signal-detail">' + esc(t.detail || t.reason || '') + '</div>' +
            (t.score != null ? '<div class="evie-confidence-bar"><div class="evie-confidence-fill" style="width:' + Math.round(t.score * 100) + '%"></div></div>' : '');
          taskList.appendChild(card);
        });
      }
    }

    // Risks
    var riskList = document.getElementById('evie-risk-list');
    var risks = data.risks || [];
    var riskCount = document.getElementById('evie-risk-count');
    if (riskCount) riskCount.textContent = String(risks.length);

    if (riskList) {
      riskList.innerHTML = '';
      if (risks.length === 0) {
        riskList.innerHTML = '<div class="evie-notice">No active risks detected.</div>';
      } else {
        risks.forEach(function (r) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-' + (r.severity || 'medium');
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(r.title) + '</div>' +
            '<div class="evie-signal-detail">' + esc(r.detail || '') + '</div>';
          riskList.appendChild(card);
        });
      }
    }

    // Recommendations
    var recList = document.getElementById('evie-rec-list');
    var recs = data.recommendations || [];
    var recCount = document.getElementById('evie-rec-count');
    if (recCount) recCount.textContent = String(recs.length);

    if (recList) {
      recList.innerHTML = '';
      if (recs.length === 0) {
        recList.innerHTML = '<div class="evie-notice">No recommendations at this time.</div>';
      } else {
        recs.forEach(function (r) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-info';
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(r.title) + '</div>' +
            '<div class="evie-signal-detail">' + esc(r.detail || '') + '</div>' +
            (r.confidence != null ? '<div class="evie-confidence-bar"><div class="evie-confidence-fill" style="width:' + Math.round(r.confidence * 100) + '%"></div></div>' : '');
          recList.appendChild(card);
        });
      }
    }
  }

  // ── Render: Learn Mode ───────────────────────────────────────

  function renderLearnMode(data) {
    // Farm profile
    var profileEl = document.getElementById('evie-farm-profile');
    if (profileEl) {
      var html = '';
      if (data.farm_name) html += '<div style="font-size:14px;font-weight:600;color:var(--evie-text);margin-bottom:8px">' + esc(data.farm_name) + '</div>';
      if (data.farm_location) html += '<div style="font-size:12px;color:var(--evie-text-secondary)">' + esc(data.farm_location) + '</div>';

      // Stats row
      html += '<div class="evie-stats-row" style="margin-top:12px">';
      html += '<div class="evie-stat"><div class="evie-stat-value">' + ((data.rooms || []).length) + '</div><div class="evie-stat-label">Rooms</div></div>';
      html += '<div class="evie-stat"><div class="evie-stat-value">' + ((data.crops || []).length) + '</div><div class="evie-stat-label">Crops</div></div>';
      html += '<div class="evie-stat"><div class="evie-stat-value">' + (data.alerts || 0) + '</div><div class="evie-stat-label">Alerts</div></div>';
      html += '<div class="evie-stat"><div class="evie-stat-value">' + ((data.tasks || []).length) + '</div><div class="evie-stat-label">Tasks</div></div>';
      html += '</div>';
      profileEl.innerHTML = html;
    }

    // Insights
    var insightList = document.getElementById('evie-insight-list');
    var insights = data.insights || [];
    var insightCount = document.getElementById('evie-insight-count');
    if (insightCount) insightCount.textContent = String(insights.length);

    if (insightList) {
      insightList.innerHTML = '';
      if (insights.length === 0) {
        insightList.innerHTML = '<div class="evie-notice">No insights recorded yet.</div>';
      } else {
        insights.forEach(function (i) {
          var card = document.createElement('div');
          card.className = 'evie-signal-card signal-info';
          card.innerHTML =
            '<div class="evie-signal-title">' + esc(i.topic || i.title || 'Insight') + '</div>' +
            '<div class="evie-signal-detail">' + esc(i.insight || i.detail || '') + '</div>' +
            '<div class="evie-signal-meta">' +
            (i.domain ? '<span class="evie-domain-badge">' + esc(i.domain) + '</span>' : '') +
            '</div>';
          insightList.appendChild(card);
        });
      }
    }
  }

  // ── Polling ──────────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshState, STATE_POLL_INTERVAL);
  }

  // ── Keyboard Shortcut ────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd + Shift + E to toggle panel
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      togglePanel();
    }
    // Escape to close
    if (e.key === 'Escape' && panelOpen) {
      togglePanel(false);
    }
  });

  // ── Show Proactive Notice ────────────────────────────────────

  function showProactiveNotice(text) {
    statusEl.textContent = text;
    ambient.classList.add('show-status');
    setTimeout(function () { ambient.classList.remove('show-status'); }, 5000);
  }

  // ── Public API ───────────────────────────────────────────────

  window.EVIE = {
    open: function () { togglePanel(true); },
    close: function () { togglePanel(false); },
    setState: setEvieState,
    ask: function (text) {
      switchMode('converse');
      if (!panelOpen) togglePanel(true);
      sendChat(text);
    },
    notice: showProactiveNotice,
    refresh: refreshState,
    getState: function () { return stateData; }
  };

})();
