/**
 * Farm Toolbar -- Draggable floating card with Mic, Help, and E.V.I.E. buttons
 * =============================================================================
 * Creates a compact, modern floating toolbar that groups 3 actions:
 *   1. Mic (voice input to E.V.I.E.)
 *   2. Help (toggles help overlay via LightEngineHelp)
 *   3. E.V.I.E. (opens the intelligence panel via window.EVIE)
 *
 * The toolbar is draggable -- users can reposition it anywhere on screen.
 * Position is persisted in localStorage per farm.
 *
 * Dependencies: evie-presence.js (window.EVIE), light-engine-help.js (window.LightEngineHelp)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'farm_toolbar_position';
  var recognition = null;
  var isListening = false;

  // ── Build DOM ────────────────────────────────────────────────

  var toolbar = document.createElement('div');
  toolbar.id = 'farm-toolbar';
  toolbar.innerHTML =
    '<div class="farm-toolbar-handle" id="farm-toolbar-handle" title="Drag to reposition">' +
      '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.4">' +
        '<circle cx="2" cy="2" r="1.2"/><circle cx="5" cy="2" r="1.2"/><circle cx="8" cy="2" r="1.2"/>' +
        '<circle cx="2" cy="5" r="1.2"/><circle cx="5" cy="5" r="1.2"/><circle cx="8" cy="5" r="1.2"/>' +
        '<circle cx="2" cy="8" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/>' +
      '</svg>' +
    '</div>' +
    '<div class="farm-toolbar-buttons">' +
      '<button class="farm-toolbar-btn farm-toolbar-btn--mic" id="farm-toolbar-mic" title="Voice input">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
          '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>' +
          '<line x1="12" y1="19" x2="12" y2="23"/>' +
          '<line x1="8" y1="23" x2="16" y2="23"/>' +
        '</svg>' +
      '</button>' +
      '<button class="farm-toolbar-btn farm-toolbar-btn--help" id="farm-toolbar-help" title="Toggle Help Mode">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"/>' +
          '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
          '<line x1="12" y1="17" x2="12.01" y2="17"/>' +
        '</svg>' +
      '</button>' +
      '<button class="farm-toolbar-btn farm-toolbar-btn--evie" id="farm-toolbar-evie" title="Open E.V.I.E.">' +
        '<div class="farm-toolbar-evie-orb"></div>' +
        '<span class="farm-toolbar-evie-label">E.V.I.E.</span>' +
      '</button>' +
    '</div>';

  // ── Inject Styles ────────────────────────────────────────────

  var style = document.createElement('style');
  style.textContent =
    '#farm-toolbar {' +
      'position: fixed;' +
      'bottom: 20px;' +
      'right: 20px;' +
      'z-index: 99998;' +
      'background: rgba(15, 23, 42, 0.92);' +
      'backdrop-filter: blur(16px);' +
      '-webkit-backdrop-filter: blur(16px);' +
      'border: 1px solid rgba(148, 163, 184, 0.15);' +
      'border-radius: 14px;' +
      'padding: 6px;' +
      'display: flex;' +
      'flex-direction: column;' +
      'align-items: center;' +
      'gap: 4px;' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset;' +
      'transition: box-shadow 0.2s ease;' +
      'user-select: none;' +
      'touch-action: none;' +
    '}' +
    '#farm-toolbar:hover {' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset;' +
    '}' +
    '#farm-toolbar.dragging {' +
      'opacity: 0.85;' +
      'transition: none;' +
    '}' +
    '.farm-toolbar-handle {' +
      'width: 100%;' +
      'display: flex;' +
      'justify-content: center;' +
      'padding: 2px 0;' +
      'cursor: grab;' +
      'color: #64748b;' +
    '}' +
    '.farm-toolbar-handle:active { cursor: grabbing; }' +
    '.farm-toolbar-buttons {' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 4px;' +
      'align-items: center;' +
    '}' +
    '.farm-toolbar-btn {' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      'border: none;' +
      'cursor: pointer;' +
      'transition: background 0.15s ease, transform 0.15s ease;' +
      'outline: none;' +
    '}' +
    '.farm-toolbar-btn:active { transform: scale(0.93); }' +

    /* Mic button */
    '.farm-toolbar-btn--mic {' +
      'width: 38px;' +
      'height: 38px;' +
      'border-radius: 10px;' +
      'background: rgba(59, 130, 246, 0.15);' +
      'color: #60a5fa;' +
    '}' +
    '.farm-toolbar-btn--mic:hover { background: rgba(59, 130, 246, 0.25); }' +
    '.farm-toolbar-btn--mic.listening {' +
      'background: rgba(239, 68, 68, 0.2);' +
      'color: #f87171;' +
      'animation: mic-pulse 1.2s ease-in-out infinite;' +
    '}' +
    '@keyframes mic-pulse {' +
      '0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }' +
      '50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }' +
    '}' +

    /* Help button */
    '.farm-toolbar-btn--help {' +
      'width: 38px;' +
      'height: 38px;' +
      'border-radius: 10px;' +
      'background: rgba(148, 163, 184, 0.12);' +
      'color: #94a3b8;' +
    '}' +
    '.farm-toolbar-btn--help:hover { background: rgba(148, 163, 184, 0.22); }' +
    '.farm-toolbar-btn--help.active {' +
      'background: rgba(239, 68, 68, 0.2);' +
      'color: #f87171;' +
    '}' +

    /* EVIE button -- larger */
    '.farm-toolbar-btn--evie {' +
      'width: 52px;' +
      'height: 52px;' +
      'border-radius: 12px;' +
      'background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15));' +
      'color: #a78bfa;' +
      'flex-direction: column;' +
      'gap: 2px;' +
      'padding: 4px;' +
    '}' +
    '.farm-toolbar-btn--evie:hover {' +
      'background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.25));' +
    '}' +
    '.farm-toolbar-evie-orb {' +
      'width: 20px;' +
      'height: 20px;' +
      'border-radius: 50%;' +
      'background: radial-gradient(circle at 40% 35%, #c4b5fd, #7c3aed 60%, #4c1d95);' +
      'box-shadow: 0 0 8px rgba(139, 92, 246, 0.4);' +
      'transition: box-shadow 0.3s ease;' +
    '}' +
    '.farm-toolbar-btn--evie:hover .farm-toolbar-evie-orb {' +
      'box-shadow: 0 0 14px rgba(139, 92, 246, 0.6);' +
    '}' +
    '.farm-toolbar-evie-label {' +
      'font-size: 8px;' +
      'font-weight: 700;' +
      'letter-spacing: 0.5px;' +
      'color: #a78bfa;' +
      'line-height: 1;' +
    '}' +

    /* Hide the default standalone buttons when toolbar is present */
    '#farm-toolbar ~ #le-help-toggle,' +
    'body.farm-toolbar-active #le-help-toggle { display: none !important; }' +
    'body.farm-toolbar-active .evie-ambient { display: none !important; }';

  // ── Insert into DOM ──────────────────────────────────────────

  document.head.appendChild(style);
  document.body.appendChild(toolbar);
  document.body.classList.add('farm-toolbar-active');

  // ── Restore Position ─────────────────────────────────────────

  function getStorageKey() {
    var farmId = localStorage.getItem('farm_id') || localStorage.getItem('farmId') || 'default';
    return STORAGE_KEY + ':' + farmId;
  }

  function restorePosition() {
    try {
      var stored = localStorage.getItem(getStorageKey());
      if (!stored) return;
      var pos = JSON.parse(stored);
      // Validate bounds
      var maxX = window.innerWidth - toolbar.offsetWidth;
      var maxY = window.innerHeight - toolbar.offsetHeight;
      var x = Math.max(0, Math.min(pos.x, maxX));
      var y = Math.max(0, Math.min(pos.y, maxY));
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
      toolbar.style.left = x + 'px';
      toolbar.style.top = y + 'px';
    } catch (_) {
      // Use default position
    }
  }

  function savePosition() {
    try {
      var rect = toolbar.getBoundingClientRect();
      localStorage.setItem(getStorageKey(), JSON.stringify({ x: rect.left, y: rect.top }));
    } catch (_) {
      // best-effort
    }
  }

  // Restore after a brief delay so offsetWidth/Height are available
  requestAnimationFrame(restorePosition);

  // ── Drag Behavior ────────────────────────────────────────────

  var dragState = null;

  function onPointerDown(e) {
    // Only drag from the handle area
    if (!e.target.closest('.farm-toolbar-handle')) return;
    e.preventDefault();
    var rect = toolbar.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top
    };
    toolbar.classList.add('dragging');
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    e.preventDefault();
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    var newX = dragState.origLeft + dx;
    var newY = dragState.origTop + dy;
    // Clamp to viewport
    var maxX = window.innerWidth - toolbar.offsetWidth;
    var maxY = window.innerHeight - toolbar.offsetHeight;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));
    toolbar.style.left = newX + 'px';
    toolbar.style.top = newY + 'px';
  }

  function onPointerUp() {
    if (!dragState) return;
    dragState = null;
    toolbar.classList.remove('dragging');
    savePosition();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  toolbar.addEventListener('pointerdown', onPointerDown);

  // ── Button: Mic (Voice Input) ────────────────────────────────

  var micBtn = document.getElementById('farm-toolbar-mic');

  function initSpeechRecognition() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.title = 'Voice input not supported in this browser';
      micBtn.style.opacity = '0.4';
      micBtn.style.cursor = 'not-allowed';
      return null;
    }
    var rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = function (event) {
      var transcript = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcript = transcript.trim();
      if (transcript && window.EVIE && typeof window.EVIE.ask === 'function') {
        window.EVIE.ask(transcript);
      }
      stopListening();
    };
    rec.onerror = function () { stopListening(); };
    rec.onend = function () { stopListening(); };
    return rec;
  }

  function startListening() {
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition) return;
    try {
      recognition.start();
      isListening = true;
      micBtn.classList.add('listening');
      micBtn.title = 'Listening... click to stop';
    } catch (_) {
      stopListening();
    }
  }

  function stopListening() {
    isListening = false;
    micBtn.classList.remove('listening');
    micBtn.title = 'Voice input';
    if (recognition) {
      try { recognition.abort(); } catch (_) { /* ignore */ }
    }
  }

  micBtn.addEventListener('click', function () {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  // ── Button: Help ─────────────────────────────────────────────

  var helpBtn = document.getElementById('farm-toolbar-help');
  var helpActive = false;

  helpBtn.addEventListener('click', function () {
    if (window.LightEngineHelp && typeof window.LightEngineHelp.toggle === 'function') {
      window.LightEngineHelp.toggle();
      helpActive = !helpActive;
      helpBtn.classList.toggle('active', helpActive);
    }
  });

  // Sync state if help is toggled externally
  var helpObserver = new MutationObserver(function () {
    var isActive = document.body.classList.contains('le-help-active');
    helpActive = isActive;
    helpBtn.classList.toggle('active', isActive);
  });
  helpObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ── Button: E.V.I.E. ────────────────────────────────────────

  var evieBtn = document.getElementById('farm-toolbar-evie');

  evieBtn.addEventListener('click', function () {
    if (window.EVIE && typeof window.EVIE.open === 'function') {
      window.EVIE.open();
    }
  });

  // ── Window Resize Guard ──────────────────────────────────────

  window.addEventListener('resize', function () {
    var rect = toolbar.getBoundingClientRect();
    var maxX = window.innerWidth - toolbar.offsetWidth;
    var maxY = window.innerHeight - toolbar.offsetHeight;
    if (rect.left > maxX || rect.top > maxY) {
      toolbar.style.left = Math.max(0, Math.min(rect.left, maxX)) + 'px';
      toolbar.style.top = Math.max(0, Math.min(rect.top, maxY)) + 'px';
      savePosition();
    }
  });

})();
