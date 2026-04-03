/**
 * Setup Orchestrator Controller
 *
 * Drives the cinematic setup progress UI. Fetches phase data from
 * /api/setup-agent/progress, renders phase cards, and bridges user
 * actions to EVIE chat and sidebar panel navigation.
 *
 * Dependencies:
 *   - /css/setup-orchestrator.css
 *   - window._farmAssistant (farm-assistant.js)
 *   - setActivePanel() (app.foxtrot.js)
 */

(function () {
  'use strict';

  const CACHE_KEY = 'setup_orchestrator_cache';
  const CACHE_TTL = 60 * 1000; // 1 minute
  const API_PATH = '/api/setup-agent/progress';

  let _container = null;
  let _data = null;
  let _collapsed = false;
  let _loading = false;

  // ── Initialise ─────────────────────────────────────────────────────

  function init() {
    _container = document.getElementById('setupOrchestrator');
    if (!_container) return;

    // Restore collapse preference
    _collapsed = localStorage.getItem('setup_orchestrator_collapsed') === '1';

    // Check cached data first for instant render
    const cached = loadCache();
    if (cached) {
      _data = cached;
      render();
    }

    // Fetch fresh data
    fetchProgress();
  }

  // ── Data Fetching ──────────────────────────────────────────────────

  async function fetchProgress() {
    if (_loading) return;
    _loading = true;
    setLoadingState(true);

    try {
      const token = localStorage.getItem('farm_jwt') || localStorage.getItem('jwt_token');
      const farmId = localStorage.getItem('farm_id');
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      if (farmId) headers['x-farm-id'] = farmId;

      const res = await fetch(API_PATH, { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Unknown error');

      _data = json;
      saveCache(json);
      render();
    } catch (err) {
      console.warn('[SetupOrchestrator] Failed to load progress:', err.message);
      if (!_data) renderError();
    } finally {
      _loading = false;
      setLoadingState(false);
    }
  }

  function loadCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > CACHE_TTL) return null;
      return entry.data;
    } catch { return null; }
  }

  function saveCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* quota exceeded -- ignore */ }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  function render() {
    if (!_container || !_data) return;

    const { percentage, completed, total, phases, next_phase, all_complete } = _data;

    // Container state classes
    _container.className = 'setup-orchestrator'
      + (all_complete ? ' setup-orchestrator--complete' : '')
      + (_collapsed ? ' setup-orchestrator--collapsed' : '');

    // Score ring: circumference = 2 * PI * 36 = ~226.2
    const circumference = 226.2;
    const offset = circumference - (circumference * percentage / 100);

    _container.innerHTML = `
      <div class="setup-orchestrator__header">
        <div class="setup-orchestrator__title-group">
          <div class="setup-orchestrator__label">${all_complete ? 'Setup Complete' : 'Setup Orchestrator'}</div>
          <h2 class="setup-orchestrator__title">${all_complete ? 'Farm Configuration Complete' : 'Farm Configuration'}</h2>
          <p class="setup-orchestrator__subtitle">${all_complete
            ? completed + ' of ' + total + ' phases finished. Your farm is fully configured.'
            : completed + ' of ' + total + ' phases complete. EVIE can guide you through each step.'
          }</p>
        </div>
        <div class="setup-orchestrator__score">
          <svg viewBox="0 0 80 80">
            <defs>
              <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${all_complete ? '#22c55e' : '#6366f1'}" />
                <stop offset="100%" stop-color="${all_complete ? '#4ade80' : '#a78bfa'}" />
              </linearGradient>
            </defs>
            <circle class="setup-orchestrator__score-track" cx="40" cy="40" r="36" />
            <circle class="setup-orchestrator__score-fill" cx="40" cy="40" r="36"
              style="stroke-dashoffset: ${offset}" />
          </svg>
          <div class="setup-orchestrator__score-text">
            <span class="setup-orchestrator__score-value">${percentage}</span>
            <span class="setup-orchestrator__score-unit">percent</span>
          </div>
        </div>
        <button class="setup-orchestrator__toggle" title="${_collapsed ? 'Expand' : 'Collapse'}"
          data-action="toggle">${_collapsed ? 'Show' : 'Hide'}</button>
      </div>

      <div class="setup-orchestrator__progress">
        <div class="setup-orchestrator__progress-fill" style="width: ${percentage}%"></div>
      </div>

      <div class="setup-orchestrator__phases">
        ${phases.map(renderPhaseCard).join('')}
      </div>

      ${next_phase && !all_complete ? `
      <div class="setup-orchestrator__footer">
        <div class="setup-orchestrator__next">
          <span class="setup-orchestrator__next-label">Next</span>
          <span class="setup-orchestrator__next-phase">${escapeHTML(next_phase.label)}</span>
        </div>
        <button class="setup-orchestrator__evie-btn" data-action="evie" data-prompt="${escapeAttr(next_phase.evie_prompt)}">
          <span class="setup-orchestrator__evie-icon">E</span>
          Guide me
        </button>
      </div>` : ''}
    `;

    // Bind events
    bindEvents();
  }

  function renderPhaseCard(phase) {
    const state = phase.complete ? 'complete' : (phase.id === (_data.next_phase?.id) ? 'active' : 'pending');
    return `
      <div class="setup-phase setup-phase--${state}"
           data-action="phase"
           data-phase-id="${phase.id}"
           data-sidebar="${phase.sidebar_target}"
           data-prompt="${escapeAttr(phase.evie_prompt)}"
           title="${escapeAttr(phase.description)}">
        <div class="setup-phase__header">
          <div class="setup-phase__indicator"></div>
          <span class="setup-phase__order">${phase.order} / ${_data.total}</span>
        </div>
        <div class="setup-phase__name">${escapeHTML(phase.label)}</div>
        <div class="setup-phase__detail">${escapeHTML(phase.detail)}</div>
      </div>`;
  }

  function renderError() {
    if (!_container) return;
    _container.className = 'setup-orchestrator';
    _container.innerHTML = `
      <div class="setup-orchestrator__header">
        <div class="setup-orchestrator__title-group">
          <div class="setup-orchestrator__label">Setup Orchestrator</div>
          <h2 class="setup-orchestrator__title">Farm Configuration</h2>
          <p class="setup-orchestrator__subtitle">Unable to load setup progress. Ask EVIE for help or try refreshing.</p>
        </div>
      </div>`;
  }

  function setLoadingState(on) {
    if (!_container) return;
    _container.classList.toggle('setup-orchestrator--loading', on);
  }

  // ── Event Handling ─────────────────────────────────────────────────

  function bindEvents() {
    if (!_container) return;

    _container.addEventListener('click', function (e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;

      switch (action) {
        case 'toggle':
          _collapsed = !_collapsed;
          localStorage.setItem('setup_orchestrator_collapsed', _collapsed ? '1' : '0');
          render();
          break;

        case 'phase':
          handlePhaseClick(target);
          break;

        case 'evie':
          openEvieWithPrompt(target.dataset.prompt);
          break;
      }
    });
  }

  function handlePhaseClick(el) {
    const phaseId = el.dataset.phaseId;
    const sidebarTarget = el.dataset.sidebar;
    const prompt = el.dataset.prompt;

    // Navigate to the relevant sidebar panel
    if (sidebarTarget && typeof setActivePanel === 'function') {
      setActivePanel(sidebarTarget);
    }

    // If phase is incomplete, also offer EVIE guidance
    const phase = _data?.phases?.find(p => p.id === phaseId);
    if (phase && !phase.complete && prompt) {
      // Small delay so sidebar panel loads first
      setTimeout(function () { openEvieWithPrompt(prompt); }, 400);
    }
  }

  function openEvieWithPrompt(prompt) {
    if (!prompt) return;

    const assistant = window._farmAssistant || window.farmAssistant;
    if (!assistant) {
      console.warn('[SetupOrchestrator] EVIE not available');
      return;
    }

    // Ensure chat panel is open
    const container = document.querySelector('.assistant-container');
    if (container && container.classList.contains('minimized')) {
      assistant.toggleMinimize();
    }

    // Send the phase-specific prompt
    assistant.handleExampleQuery(prompt);
  }

  // ── Utilities ──────────────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Public API ─────────────────────────────────────────────────────

  window.setupOrchestrator = {
    refresh: fetchProgress,
    init: init
  };

  // Auto-initialise when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
