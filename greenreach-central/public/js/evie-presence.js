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

  // -- Iframe Detection --
  // When inside an iframe whose parent already has EVIE,
  // expose a bridge API but skip the full orb/panel injection.
  var inIframe = false;
  try { inIframe = window.self !== window.top; } catch (_) { inIframe = true; }

  var parentHasEvie = false;
  if (inIframe) {
    try { parentHasEvie = !!(window.parent && window.parent.EVIE); } catch (_) { /* cross-origin */ }
  }

  // Detect page context for context-aware suggestions
  var pageContext = (function () {
    var path = window.location.pathname.toLowerCase();
    if (path.indexOf('farm-inventory') >= 0) return 'inventory';
    if (path.indexOf('planting-scheduler') >= 0) return 'planting';
    if (path.indexOf('nutrient') >= 0) return 'nutrients';
    if (path.indexOf('tray-inventory') >= 0) return 'activity-hub';
    if (path.indexOf('farm-summary') >= 0) return 'farm-summary';
    if (path.indexOf('crop-weight') >= 0) return 'harvest-analytics';
    if (path.indexOf('room-heatmap') >= 0) return 'heatmap';
    if (path.indexOf('procurement') >= 0) return 'procurement';
    if (path.indexOf('wholesale') >= 0) return 'wholesale';
    if (path.indexOf('maintenance') >= 0) return 'maintenance';
    if (path.indexOf('research') >= 0) return 'research';
    return 'general';
  })();

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
  var notifData = [];
  var notifUnread = 0;
  var lastUnreadCount = 0;
  var notifBaselineSeen = false;
  var audioContextRef = null;

  // ── Auth ─────────────────────────────────────────────────────
  function getAuthHeaders() {
    var token = localStorage.getItem('token') || sessionStorage.getItem('token')
      || localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    return token
      ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  function getFarmScopeKey() {
    var farmId = localStorage.getItem('farm_id') || sessionStorage.getItem('farm_id')
      || localStorage.getItem('farmId') || sessionStorage.getItem('farmId')
      || 'default';
    return 'evie_presence_conversation_id:' + farmId;
  }

  function loadConversationId() {
    try {
      return localStorage.getItem(getFarmScopeKey()) || null;
    } catch (_) {
      return null;
    }
  }

  function saveConversationId(id) {
    if (!id) return;
    try {
      localStorage.setItem(getFarmScopeKey(), id);
    } catch (_) {
      // best-effort persistence
    }
  }

  conversationId = loadConversationId();

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

  // -- Alert Domain-to-Page routing map --
  var ALERT_PAGE_MAP = {
    environment: { url: '/views/environment.html', title: 'Environment' },
    nutrient:    { url: '/views/nutrient-management.html', title: 'Nutrient Management' },
    inventory:   { url: '/views/farm-inventory.html', title: 'Farm Inventory' },
    planting:    { url: '/views/planting-scheduler.html', title: 'Planting Scheduler' },
    harvest:     { url: '/views/harvest-tracking.html', title: 'Harvest Tracking' },
    payment:     { section: 'payments', title: 'Payments' },
    order:       { section: 'wholesale-orders', title: 'Wholesale Orders' },
    general:     { url: '/views/farm-summary.html', title: 'Farm Summary' }
  };

  function navigateToAlertPage(domain) {
    var route = ALERT_PAGE_MAP[domain] || ALERT_PAGE_MAP.general;
    if (window.parent && window.parent !== window && window.parent.EVIE) {
      window.parent.postMessage({ type: 'evie-navigate', route: route }, '*');
      return;
    }
    if (route.section) {
      var navItem = document.querySelector('[data-section="' + route.section + '"]');
      if (navItem) { navItem.click(); return; }
      window.location.hash = '#' + route.section;
      return;
    }
    if (route.url) {
      if (typeof window.renderEmbeddedView === 'function') {
        window.renderEmbeddedView(route.url, route.title);
      } else {
        var iframe = document.getElementById('admin-iframe');
        if (iframe) {
          iframe.src = route.url;
          var iframeSec = document.getElementById('section-iframe-view');
          if (iframeSec) {
            document.querySelectorAll('.content-section').forEach(function (s) { s.style.display = 'none'; });
            iframeSec.style.display = 'block';
          }
        } else {
          window.location.href = route.url;
        }
      }
    }
  }

  function dismissAlertFromPanel(alertId) {
    fetch(API_BASE + '/alerts/' + encodeURIComponent(alertId) + '/dismiss', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({ reason: 'Dismissed from EVIE panel' })
    }).then(function (resp) {
      if (resp.ok) {
        var card = document.querySelector('[data-alert-id="' + alertId + '"]');
        if (card) {
          card.style.opacity = '0';
          card.style.transform = 'translateX(20px)';
          setTimeout(function () { card.remove(); updateAlertCount(); }, 300);
        }
        setTimeout(refreshState, 500);
      }
    }).catch(function () { /* silent */ });
  }

  function updateAlertCount() {
    var list = document.getElementById('evie-alert-list');
    var countEl = document.getElementById('evie-alert-count');
    if (list && countEl) {
      countEl.textContent = String(list.querySelectorAll('.evie-signal-card').length);
    }
  }

  function askEvieAboutAlert(alert) {
    var question = 'Tell me about the ' + (alert.alert_type || alert.domain || '') +
      ' alert' + (alert.zone ? ' in ' + alert.zone : '') + ': ' + alert.title +
      '. What should I do?';
    switchMode('converse');
    if (!panelOpen) togglePanel(true);
    setTimeout(function () {
      var inp = document.getElementById('evie-conv-input');
      if (inp) {
        inp.value = question;
        sendChat(question);
      }
    }, 200);
  }

  function unlockNotificationAudio() {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!audioContextRef) audioContextRef = new AudioContextCtor();
    if (audioContextRef.state === 'suspended') {
      audioContextRef.resume().catch(function () { /* autoplay restrictions */ });
    }
  }

  function playNotificationDong() {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!audioContextRef) audioContextRef = new AudioContextCtor();

    if (audioContextRef.state === 'suspended') {
      audioContextRef.resume().catch(function () { /* autoplay restrictions */ });
    }
    if (audioContextRef.state !== 'running') return;

    var now = audioContextRef.currentTime;
    var master = audioContextRef.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    master.connect(audioContextRef.destination);

    function strike(freq, start, duration, peak, type) {
      var osc = audioContextRef.createOscillator();
      var amp = audioContextRef.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.88), start + duration);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(peak, start + 0.03);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp);
      amp.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    }

    strike(740, now + 0.01, 0.8, 0.22, 'triangle');
    strike(1110, now + 0.06, 0.55, 0.08, 'sine');
    strike(1480, now + 0.09, 0.35, 0.05, 'sine');
  }

  function triggerNotificationArrivalCue() {
    var bell = document.getElementById('evie-notif-bell');
    if (bell) {
      bell.classList.remove('new-arrival');
      void bell.offsetWidth;
      bell.classList.add('new-arrival');
      setTimeout(function () { bell.classList.remove('new-arrival'); }, 2200);
    }
    playNotificationDong();
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

  // Notification bell (highly visible when unread)
  var notifBell = document.createElement('div');
  notifBell.className = 'evie-notif-bell';
  notifBell.id = 'evie-notif-bell';
  notifBell.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="evie-notif-count" id="evie-notif-count"></span>';
  notifBell.addEventListener('click', function (e) {
    e.stopPropagation();
    unlockNotificationAudio();
    togglePanel(true);
    switchMode('inbox');
  });

  ambientRow.appendChild(ambientOrbWrap);
  ambientRow.appendChild(notifBell);
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
    { key: 'inbox',   label: 'Inbox' },
    { key: 'learn',   label: 'Farm' }
  ];
  var modeIcons = {
    observe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    advise: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>',
    converse: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    inbox: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
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

  // --- Inbox Mode (Notifications) ---
  var inboxEl = document.createElement('div');
  inboxEl.id = 'evie-mode-inbox';
  inboxEl.style.display = 'none';
  inboxEl.innerHTML =
    '<div class="evie-inbox-header">' +
    '  <div class="evie-intel-section-title">Notifications <span class="count" id="evie-notif-inbox-count">0</span></div>' +
    '  <button class="evie-notif-mark-all" id="evie-notif-mark-all">Mark all read</button>' +
    '</div>' +
    '<div id="evie-notif-list" class="evie-notif-list"></div>';

  panelBody.appendChild(observeEl);
  panelBody.appendChild(adviseEl);
  panelBody.appendChild(converseEl);
  panelBody.appendChild(inboxEl);
  panelBody.appendChild(learnEl);

  // ── Inject into DOM ──────────────────────────────────────────
  function inject() {
    // If inside any iframe, expose bridge only (top-level admin shell owns the orb).
    // Uses window.top so the bridge works at any nesting depth.
    if (inIframe) {
      window.EVIE = {
        open: function () { try { window.top.EVIE.open(); } catch (_) {} },
        close: function () { try { window.top.EVIE.close(); } catch (_) {} },
        ask: function (t) { try { window.top.EVIE.ask(t); } catch (_) {} },
        notice: function (t) { try { window.top.EVIE.notice(t); } catch (_) {} },
        pageContext: pageContext,
        getState: function () { try { return window.top.EVIE.getState(); } catch (_) { return {}; } }
      };
      // Notify top-level admin of page context for context-aware suggestions
      try {
        window.top.postMessage({ type: 'evie-page-context', context: pageContext }, '*');
      } catch (_) {}
      return;
    }

    document.body.appendChild(ambient);
    document.body.appendChild(panel);
    document.addEventListener('pointerdown', unlockNotificationAudio, { once: true, passive: true });
    startPolling();
    attachChatEvents();
    refreshState();

    // Wire up mark-all-read button
    var markAllBtn = document.getElementById('evie-notif-mark-all');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async function () {
        try {
          await fetch(API_BASE + '/notifications/read', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
            body: JSON.stringify({ all: true })
          });
          loadNotifications();
        } catch (e) { /* silent */ }
      });
    }
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
    inboxEl.style.display   = mode === 'inbox'   ? '' : 'none';
    learnEl.style.display   = mode === 'learn'   ? '' : 'none';

    if (mode === 'inbox') {
      loadNotifications();
    }

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
        saveConversationId(conversationId);
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
      updateNotifBadge(data.unread_notifications || 0);
    } catch (e) {
      // Best-effort polling -- silent fail
    }
  }

  // ── Notification Badge + Loading ─────────────────────────────

  function updateNotifBadge(count) {
    var nextCount = Number(count || 0);
    if (!Number.isFinite(nextCount) || nextCount < 0) nextCount = 0;

    notifUnread = nextCount;
    var badge = document.getElementById('evie-notif-count');
    var bell = document.getElementById('evie-notif-bell');
    var inboxCount = document.getElementById('evie-notif-inbox-count');
    if (badge) badge.textContent = nextCount > 0 ? String(nextCount) : '';
    if (bell) bell.classList.toggle('has-unread', nextCount > 0);
    if (inboxCount) inboxCount.textContent = String(nextCount);

    // Also update the inbox tab itself
    var inboxTab = tabBar.querySelector('[data-mode="inbox"]');
    if (inboxTab) {
      var existing = inboxTab.querySelector('.evie-tab-badge');
      if (nextCount > 0) {
        if (!existing) {
          var dot = document.createElement('span');
          dot.className = 'evie-tab-badge';
          inboxTab.appendChild(dot);
        }
      } else if (existing) {
        existing.remove();
      }
    }

    if (!notifBaselineSeen) {
      notifBaselineSeen = true;
      lastUnreadCount = nextCount;
      return;
    }

    if (nextCount > lastUnreadCount) {
      triggerNotificationArrivalCue();
    }
    lastUnreadCount = nextCount;
  }

  async function loadNotifications() {
    var list = document.getElementById('evie-notif-list');
    if (!list) return;
    try {
      var resp = await fetch(API_BASE + '/notifications?limit=30', { headers: getAuthHeaders() });
      if (!resp.ok) return;
      var data = await resp.json();
      if (!data.ok) return;
      notifData = data.notifications || [];
      updateNotifBadge(data.unread_count || 0);
      renderNotifications();
    } catch (e) {
      console.warn('[E.V.I.E.] Notification fetch failed');
    }
  }

  // Category-to-action defaults — where to navigate when no explicit action_url
  var NOTIF_ACTION_MAP = {
    order:     { url: 'section:wholesale-orders',               label: 'View Orders' },
    alert:     { url: 'iframe:/views/farm-summary.html',        label: 'View Farm Status' },
    harvest:   { url: 'iframe:/views/tray-inventory.html',      label: 'View Activity Hub' },
    inventory: { url: 'iframe:/views/farm-inventory.html',      label: 'View Inventory' },
    nutrient:  { url: 'iframe:/views/nutrient-management.html', label: 'View Nutrients' },
    quality:   { url: 'section:quality',                        label: 'View Quality' },
    sales:     { url: 'iframe:/farm-sales-pos.html',            label: 'View Sales' },
    pricing:   { url: 'section:pricing',                        label: 'View Pricing' },
    environment: { url: 'iframe:/views/environment.html',       label: 'View Environment' }
  };

  function getNotifAction(n) {
    if (n.action_url) return { url: n.action_url, label: n.action_label || 'Open' };
    return NOTIF_ACTION_MAP[n.category] || null;
  }

  function renderNotifications() {
    var list = document.getElementById('evie-notif-list');
    if (!list) return;
    if (notifData.length === 0) {
      list.innerHTML = '<div class="evie-notice">No notifications yet.</div>';
      return;
    }
    var html = '';
    notifData.forEach(function (n) {
      var catIcon = {
        order: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
        alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        general: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
      };
      var icon = catIcon[n.category] || catIcon.general;
      var readClass = n.read ? 'read' : 'unread';
      var action = getNotifAction(n);
      var hasAction = !!action;

      html += '<div class="evie-notif-item ' + readClass + (hasAction ? ' actionable' : '') + '" data-id="' + n.id + '"' +
        (hasAction ? ' onclick="window._evieNotifAction(' + n.id + ',\'' + esc(action.url) + '\')"' : '') + '>' +
        '<div class="evie-notif-icon">' + icon + '</div>' +
        '<div class="evie-notif-content">' +
        '  <div class="evie-notif-title">' + esc(n.title) + '</div>' +
        (n.body ? '  <div class="evie-notif-body">' + esc(n.body) + '</div>' : '') +
        '  <div class="evie-notif-meta">' + timeAgo(new Date(n.created_at).getTime()) +
        (n.source ? ' | ' + esc(n.source) : '') + '</div>' +
        (hasAction ? '  <button class="evie-notif-action-btn" onclick="event.stopPropagation(); window._evieNotifAction(' + n.id + ',\'' + esc(action.url) + '\')">' + esc(action.label) +
        ' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>' : '') +
        '</div>' +
        (!n.read && !hasAction ? '<button class="evie-notif-read-btn" onclick="window._evieMarkRead(' + n.id + ')">Mark read</button>' : '') +
        '</div>';
    });
    list.innerHTML = html;
  }

  // Global handlers for notification actions
  window._evieMarkRead = async function (id) {
    try {
      await fetch(API_BASE + '/notifications/read', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ id: id })
      });
      loadNotifications();
    } catch (e) { /* silent */ }
  };

  // Navigate to the target of an actionable notification, mark it read, close the panel
  window._evieNotifAction = async function (id, actionUrl) {
    // Mark read first (fire-and-forget)
    fetch(API_BASE + '/notifications/read', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({ id: id })
    }).then(function () { loadNotifications(); }).catch(function () {});

    // Close the EVIE panel
    var panel = document.getElementById('evie-intel-panel');
    if (panel) panel.classList.remove('open');

    // Route to the target
    if (actionUrl.indexOf('section:') === 0) {
      // Internal section — click the sidebar nav item
      var section = actionUrl.replace('section:', '');
      var navItem = document.querySelector('.nav-item[data-section="' + section + '"]');
      if (navItem) navItem.click();
    } else if (actionUrl.indexOf('iframe:') === 0) {
      // Iframe page — find matching nav item or trigger embedded view directly
      var iframeUrl = actionUrl.replace('iframe:', '');
      var navItem = document.querySelector('.nav-item[data-section="iframe-view"][data-url="' + iframeUrl + '"]');
      if (navItem) {
        navItem.click();
      } else if (typeof window.renderEmbeddedView === 'function') {
        window.renderEmbeddedView(iframeUrl, 'Notification');
      }
    } else if (actionUrl.indexOf('http') === 0 || actionUrl.indexOf('/') === 0) {
      // Direct URL — navigate
      window.location.href = actionUrl;
    }
  };

  function updateAmbient(data) {
    var badge = document.getElementById('evie-ambient-badge');
    var alertCount = data.alerts || 0;
    if (badge) badge.textContent = alertCount > 0 ? String(alertCount) : '';

    if (alertCount > 0 && currentState === 'idle') {
      setEvieState('alert');
    } else if (alertCount === 0 && currentState === 'alert') {
      setEvieState('idle');
    }

    // Farm-health reactive glow (C3)
    var envWarnings = (data.environment || []).filter(function (e) {
      return e.status === 'warning' || e.status === 'caution';
    }).length;
    var envCritical = (data.environment || []).filter(function (e) {
      return e.status === 'critical' || e.status === 'danger';
    }).length;
    if (envCritical > 0 || alertCount >= 3) {
      setFarmHealth('critical');
    } else if (envWarnings > 0 || alertCount >= 1) {
      setFarmHealth('warning');
    } else {
      setFarmHealth('good');
    }

    // Insight beacon
    var hasInsights = (data.insights || []).length > 0;
    setHasInsight(hasInsights);

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
          card.className = 'evie-signal-card signal-' + (a.severity || 'info') + ' evie-alert-clickable';
          if (a.id) card.dataset.alertId = a.id;

          var headerHtml =
            '<div class="evie-alert-header">' +
            '  <div class="evie-signal-title">' + esc(a.title) + '</div>' +
            '  <div class="evie-alert-expand-icon">&#9662;</div>' +
            '</div>' +
            '<div class="evie-signal-detail">' + esc(a.detail || '') + '</div>' +
            '<div class="evie-signal-meta">' +
            (a.domain ? '<span>' + esc(a.domain) + '</span>' : '') +
            (a.zone ? '<span>' + esc(a.zone) + '</span>' : '') +
            (a.since ? '<span>' + timeAgo(a.since) + '</span>' : '') +
            '</div>';

          var expandedHtml = '<div class="evie-alert-expanded">';
          if (a.reading != null || a.target_min != null || a.target_max != null) {
            expandedHtml += '<div class="evie-alert-readings">';
            if (a.reading != null) expandedHtml += '<div class="evie-alert-reading-item"><span class="label">Current</span><span class="value">' + a.reading + '</span></div>';
            if (a.target_min != null) expandedHtml += '<div class="evie-alert-reading-item"><span class="label">Min Target</span><span class="value">' + a.target_min + '</span></div>';
            if (a.target_max != null) expandedHtml += '<div class="evie-alert-reading-item"><span class="label">Max Target</span><span class="value">' + a.target_max + '</span></div>';
            expandedHtml += '</div>';
          }
          expandedHtml += '<div class="evie-alert-actions">';
          expandedHtml += '<button class="evie-alert-btn evie-alert-btn-navigate" data-domain="' + esc(a.domain || a.alert_type || 'general') + '">Go to Page</button>';
          expandedHtml += '<button class="evie-alert-btn evie-alert-btn-ask">Ask E.V.I.E.</button>';
          if (a.id) expandedHtml += '<button class="evie-alert-btn evie-alert-btn-dismiss" data-alert-id="' + esc(a.id) + '">Dismiss</button>';
          expandedHtml += '</div>';
          expandedHtml += '</div>';

          card.innerHTML = headerHtml + expandedHtml;

          card.addEventListener('click', function (e) {
            if (e.target.closest('.evie-alert-btn')) return;
            card.classList.toggle('expanded');
          });

          card.addEventListener('click', function (e) {
            var btn = e.target.closest('.evie-alert-btn');
            if (!btn) return;
            e.stopPropagation();
            if (btn.classList.contains('evie-alert-btn-dismiss')) {
              dismissAlertFromPanel(btn.dataset.alertId);
            } else if (btn.classList.contains('evie-alert-btn-navigate')) {
              navigateToAlertPage(btn.dataset.domain);
            } else if (btn.classList.contains('evie-alert-btn-ask')) {
              askEvieAboutAlert(a);
            }
          });

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

  // Farm-health reactive glow
  var currentHealth = 'good';
  function setFarmHealth(status) {
    var valid = { good: 1, warning: 1, critical: 1 };
    if (!valid[status]) return;
    currentHealth = status;
    var orb = document.querySelector('.evie-orb-container');
    if (!orb) return;
    orb.className = orb.className.replace(/evie-farm-health--\S+/g, '').trim();
    orb.classList.add('evie-farm-health--' + status);
  }

  // Insight beacon
  function setHasInsight(flag) {
    var orb = document.querySelector('.evie-orb-container');
    if (!orb) return;
    if (flag) { orb.classList.add('evie-has-insight'); }
    else { orb.classList.remove('evie-has-insight'); }
  }

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
    getState: function () { return stateData; },
    pageContext: pageContext,
    setFarmHealth: setFarmHealth,
    setHasInsight: setHasInsight
  };

  // Listen for page context messages from iframed sub-pages
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'evie-page-context' && e.data.context) {
      window.EVIE.pageContext = e.data.context;
    }
    if (e.data && e.data.type === 'evie-navigate' && e.data.route) {
      var route = e.data.route;
      if (route.section) {
        var navItem = document.querySelector('[data-section="' + route.section + '"]');
        if (navItem) navItem.click();
      } else if (route.url) {
        if (typeof window.renderEmbeddedView === 'function') {
          window.renderEmbeddedView(route.url, route.title || '');
        } else {
          var iframe = document.getElementById('admin-iframe');
          if (iframe) iframe.src = route.url;
        }
      }
    }
  });

})();
