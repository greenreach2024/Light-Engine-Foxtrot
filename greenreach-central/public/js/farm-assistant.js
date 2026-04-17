/**
 * Farm Assistant - AI-powered helper with pattern matching
 * Helps users navigate, query data, and control hardware
 */

class FarmAssistant {
  constructor() {
    this.isMinimized = true;
    this.conversationHistory = [];
    this.currentContext = this.detectContext();
    this.isListening = false;
    this.recognition = null;
    this.isSpeaking = false;
    this.voiceEnabled = JSON.parse(localStorage.getItem('evie_tts_enabled') ?? 'true');
    this.ttsVoice = localStorage.getItem('evie_tts_voice') || 'echo';
    this.jokes = [];
    this.funFacts = [];
    this.conversationId = localStorage.getItem('evie_conversation_id') || null;
    this.aiAvailable = null;     // null = unknown, true/false after check
    this.pendingAction = null;   // Pending write action awaiting confirmation
    this.recentAction = null;    // Most recent undoable action
    window._farmAssistant = this; // Global ref for action button onclick
    this.nudgeInterval = null;    // Nudge polling interval
    this.settingsOpen = false;   // Settings panel state
    this._speakGeneration = 0;   // TTS generation counter — prevents overlapping playback
    this._pendingImageUrl = null; // Pending image URL for next AI chat
    this._ws = null;              // WebSocket connection for real-time alerts
    this._wakeWordActive = false; // Wake word detection state
    this.init();
    this.initVoiceRecognition();
    this.initTextToSpeech();
    this.checkAIAvailability();
    this.checkMorningBriefing();
    this.startNudgePolling();
    this._initWebSocket();
    this._initWakeWord();
  }

  async checkAIAvailability() {
    try {
      const resp = await this._authFetch('/api/assistant/status');
      if (resp.ok) {
        const data = await resp.json();
        this.aiAvailable = data.available === true;
      } else {
        this.aiAvailable = false;
      }
    } catch {
      this.aiAvailable = false;
    }
    console.debug('[Farm Assistant] AI chat available:', this.aiAvailable);
  }

  /**
   * Morning briefing — shows once per day on first visit.
   * Calls the server-side briefing endpoint (no LLM, deterministic).
   */
  checkMorningBriefing() {
    const today = new Date().toISOString().slice(0, 10);
    const lastBriefing = localStorage.getItem('evie_briefing_date');
    if (lastBriefing === today) return;

    setTimeout(async () => {
      try {
        const greeted = localStorage.getItem('evie_greeted');
        if (!greeted) return; // Let onboarding greeting happen first

        const resp = await this._authFetch(`/api/assistant/morning-briefing?farm_id=${encodeURIComponent(window.FARM_ID || '')}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.ok || !data.briefing) return;

        // Auto-expand the assistant
        const container = document.querySelector('.assistant-container');
        if (container && container.classList.contains('minimized')) {
          this.toggleMinimize();
        }

        this.addMessage(data.briefing);
        localStorage.setItem('evie_briefing_date', today);
      } catch (e) {
        console.debug('[Farm Assistant] Morning briefing skipped:', e.message);
      }
    }, 3000);
  }

  /**
   * Contextual nudge polling — checks every 5 min for actionable insights.
   * Nudges appear as subtle assistant messages (not intrusive).
   */
  startNudgePolling() {
    // First check after 2 minutes (don't overload page load)
    setTimeout(() => this.checkNudges(), 2 * 60 * 1000);
    // Then every 5 minutes
    this.nudgeInterval = setInterval(() => this.checkNudges(), 5 * 60 * 1000);
  }

  async checkNudges() {
    try {
      const resp = await this._authFetch(`/api/assistant/nudges?farm_id=${encodeURIComponent(window.FARM_ID || '')}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.ok || !data.nudges?.length) return;

      // Only show nudges we haven't shown in this session
      const shownKey = 'evie_shown_nudges';
      const shown = JSON.parse(sessionStorage.getItem(shownKey) || '[]');

      for (const nudge of data.nudges) {
        const nudgeKey = `${nudge.type}:${nudge.message.slice(0, 40)}`;
        if (shown.includes(nudgeKey)) continue;

        // Show the first unseen nudge (one at a time, not spammy)
        const container = document.querySelector('.assistant-container');
        if (!container || container.classList.contains('minimized')) break;

        this.addMessage(`\ud83d\udca1 ${nudge.message}`);
        shown.push(nudgeKey);
        sessionStorage.setItem(shownKey, JSON.stringify(shown));
        break;
      }
    } catch {
      // Silent — nudges are non-critical
    }
  }

  _authFetch(url, opts = {}) {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('token') || localStorage.getItem('token') || '';
    if (token) {
      opts.headers = opts.headers || {};
      if (!opts.headers['Authorization']) opts.headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, opts);
  }

  init() {
    this.createWidget();
    this.attachEventListeners();
    this.loadHistory();
    this.injectHomeButton();
    this.initNavigationTracking();
    this.checkProactiveGreeting();
    this.showContextHint();
  }

  /**
   * Proactive first-time greeting — fires once if setup was completed recently (< 24 h)
   * or if the user has never received a greeting.
   */
  checkProactiveGreeting() {
    const greeted = localStorage.getItem('evie_greeted');
    const fromWizard = sessionStorage.getItem('wizard_just_completed');
    if (greeted && !fromWizard) return;  // Already shown and not fresh from wizard
    if (fromWizard) sessionStorage.removeItem('wizard_just_completed');

    setTimeout(async () => {
      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('token') || '';
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/setup-wizard/onboarding-status', { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        const incomplete = (data.tasks || []).filter(t => !t.completed);
        const total = data.totalCount || 0;
        const done = data.completedCount || 0;

        // Auto-expand the assistant
        const container = document.querySelector('.assistant-container');
        if (container && container.classList.contains('minimized')) {
          this.toggleMinimize();
        }

        if (incomplete.length === 0) {
          this.addMessage(
            `<strong>Your farm is fully set up.</strong> Grow rooms, inventory, payments, and store are all configured. Ask me anything about your crops, environment, or operations.`
          );
        } else if (fromWizard) {
          const nextItems = incomplete.slice(0, 4).map(t => `${t.icon || '-'} ${t.label}`).join('<br>');
          this.addMessage(
            `<strong>Setup wizard complete -- I will take it from here.</strong><br>
            You've finished the basics. There are <strong>${incomplete.length} remaining steps</strong> to get your farm fully operational.
            <br><br><strong>Here is what to tackle next:</strong><br>${nextItems}
            <br><br>I will walk you through each one. Type <em>"next step"</em> or click any task above to get started.`
          );
        } else {
          const nextItems = incomplete.slice(0, 3).map(t => `${t.icon || '-'} ${t.label}`).join('<br>');
          this.addMessage(
            `<strong>Welcome to GreenReach Central.</strong><br>
            You've completed <strong>${done} of ${total}</strong> setup tasks.
            <br><br><strong>Recommended next:</strong><br>${nextItems}
            <br><br>Each step builds on the last. Type <em>"what should I do next"</em> anytime to pick up where you left off.`
          );
        }

        localStorage.setItem('evie_greeted', Date.now().toString());
      } catch (e) {
        console.debug('[Farm Assistant] Proactive greeting skipped:', e.message);
      }
    }, 2000);  // Delay 2 s so the page settles first
  }

  /**
   * Context-aware first-visit suggestions.
   * Shows a tooltip hint the first time user visits Inventory, POS, or Settings.
   */
  showContextHint() {
    const page = this.currentContext.page;
    const hintKey = `evie_hint_${page.replace(/\s+/g, '_').toLowerCase()}`;
    if (localStorage.getItem(hintKey)) return;

    const hints = {
      'Inventory': '<strong>Crop Inventory</strong> — Crops you add here feed into your store, POS, pricing, and harvest tracking. Click <strong>"Add Crop"</strong> to register variety, expected yield, and growing location.',
      'POS Terminal': '<strong>Point-of-Sale</strong> — Connect Square under <strong>Settings → Payment Methods</strong> to accept card and tap payments here.',
      'Tray Management': '<strong>Tray Management</strong> — Tracks every plant from seed to harvest with QR-coded trays. Add a tray to start logging seeding, germination, and transplant moves.',
      'Planting Schedule': '<strong>Planting Scheduler</strong> — Plan successive plantings so you always have crops coming to harvest. Set a crop, target date, and quantity to forecast harvest windows.',
      'Wholesale': '<strong>Wholesale Module</strong> — Manage incoming B2B orders, fulfillment status, and compliance documents. Buyers order through the portal and orders appear here.'
    };

    const hint = hints[page];
    if (!hint) return;

    setTimeout(() => {
      this.addMessage(hint);
      localStorage.setItem(hintKey, Date.now().toString());
    }, 3000);
  }

  initNavigationTracking() {
    if (window.__leNavTrackingEnabled) return;
    window.__leNavTrackingEnabled = true;

    const storeEntry = (entry) => {
      try {
        const key = 'le_nav_log';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(entry);
        const trimmed = existing.slice(-100);
        localStorage.setItem(key, JSON.stringify(trimmed));
        console.debug('[nav-track]', entry);
      } catch (error) {
        console.warn('[nav-track] Failed to store entry', error);
      }
    };

    document.addEventListener('click', (event) => {
      const target = event.target.closest('a, button');
      if (!target) return;

      const href = target.getAttribute('href') || target.dataset.target || target.dataset.wizard || '';
      const text = (target.textContent || '').trim().slice(0, 120);

      storeEntry({
        ts: new Date().toISOString(),
        page: window.location.pathname,
        action: 'click',
        text,
        href
      });
    }, true);

    window.addEventListener('hashchange', () => {
      storeEntry({
        ts: new Date().toISOString(),
        page: window.location.pathname,
        action: 'hashchange',
        href: window.location.href
      });
    });

    window.addEventListener('beforeunload', () => {
      storeEntry({
        ts: new Date().toISOString(),
        page: window.location.pathname,
        action: 'navigate',
        href: window.location.href
      });
    });
  }

  injectHomeButton() {
    const ensureButton = () => {
      const containers = document.querySelectorAll('.header-actions');
      if (!containers.length) return;

      containers.forEach(container => {
        if (!container) return;
        const sample = container.querySelector('button, a');
        const existing = container.querySelector('[data-le-home-button]');

        const button = existing || document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-le-home-button', 'true');
        button.textContent = 'Home';

        if (sample) {
          button.className = sample.className || button.className;
          if (sample.getAttribute('style')) {
            button.setAttribute('style', sample.getAttribute('style'));
          }
        } else if (!button.className) {
          button.className = 'btn btn-secondary';
        }

        if (!button.__leHomeBound) {
          button.addEventListener('click', () => {
            window.location.href = '/LE-farm-admin.html';
          });
          button.__leHomeBound = true;
        }

        if (!existing) {
          if (container.firstChild) {
            container.insertBefore(button, container.firstChild);
          } else {
            container.appendChild(button);
          }
        }
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
    } else {
      ensureButton();
    }
  }

  detectContext() {
    const path = window.location.pathname;
    const contexts = {
      'farm-summary': { page: 'Dashboard', features: ['environmental', 'alerts', 'zones'] },
      'tray-inventory': { page: 'Tray Management', features: ['trays', 'seeding', 'harvest'] },
      'planting-scheduler': { page: 'Planting Schedule', features: ['schedule', 'planning'] },
      'farm-inventory': { page: 'Inventory', features: ['crops', 'zones', 'heatmap'] },
      'farm-sales': { page: 'POS Terminal', features: ['orders', 'customers', 'lots'] },
      'wholesale': { page: 'Wholesale', features: ['orders', 'buyers', 'compliance'] },
      'central-admin': { page: 'Central Admin', features: ['farms', 'platform', 'analytics'] },
      'room-heatmap': { page: 'Heatmap', features: ['temperature', 'humidity', 'zones'] },
      'nutrient-management': { page: 'Nutrients', features: ['nutrients', 'recipes'] }
    };

    for (const [key, value] of Object.entries(contexts)) {
      if (path.includes(key)) return value;
    }
    return { page: 'Farm System', features: [] };
  }

  createWidget() {
    console.debug('[Farm Assistant] Initializing widget...');
    const widget = document.createElement('div');
    widget.id = 'farm-assistant';
    widget.innerHTML = `
      <div class="assistant-container minimized">
        <div class="assistant-header">
          <div class="header-content">
            <img src="/images/cheo-mascot.svg?v=20260304" alt="E.V.I.E." class="assistant-mascot-thumb" />
            <div class="header-text">
              <strong>Farm Assistant</strong>
              <small>${this.currentContext.page}</small>
            </div>
          </div>
          <div style="display:flex;gap:0.25rem;align-items:center">
            <button class="mute-btn" id="muteBtn" title="${this.voiceEnabled ? 'Mute voice' : 'Unmute voice'}" style="background:none;border:none;cursor:pointer;font-size:1rem;padding:2px 6px;opacity:0.7;" onclick="if(window.farmAssistant)window.farmAssistant.toggleMute()">
              <span id="muteIcon">${this.voiceEnabled ? '🔊' : '🔇'}</span>
            </button>
            <button class="settings-btn" id="settingsBtn" title="Settings">
              <span>⚙</span>
            </button>
            <button class="minimize-btn" id="minimizeBtn">
              <span class="minimize-icon">+</span>
            </button>
          </div>
        </div>
        
        <div class="assistant-body">
          <div class="chat-messages" id="chatMessages">
            <div class="mascot-welcome">
              <img src="/images/cheo-mascot.svg?v=20260304" alt="E.V.I.E. — Environmental Vision & Intelligence Engine" class="mascot-image" />
              <div class="welcome-text">
                <strong>Farm Assistant</strong>
                <strong class="love-to-help">Ask me anything, or try one of these:</strong>
                <div class="example-queries">
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('What should I do next?')">What should I do next?</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('What\'s ready to harvest?')">What's ready to harvest?</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Show me the temperature')">Show me the temperature</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Where is the lettuce?')">Where is the lettuce?</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Blink lights for basil')">Blink lights for basil</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Show planting schedule')">Show planting schedule</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Any alerts?')">Any alerts?</button>
                </div>
                <strong>Or type your own question below.</strong>
              </div>
            </div>
          </div>
          
          <div class="chat-input-container">
            <button id="voiceBtn" class="voice-btn" title="Voice command">
              <span class="voice-icon">♪</span>
            </button>
            <button id="evieImageBtn" class="evie-image-btn" title="Upload image for diagnosis">📷</button>
            <input type="file" id="evieImageInput" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none" />
            <input 
              type="text" 
              id="assistantInput" 
              placeholder="Ask a question..."
              autocomplete="off"
            />
            <button id="sendBtn" class="send-btn">
              <span>↑</span>
            </button>
          </div>
          <div id="evieWakeIndicator" class="evie-wake-indicator">
            <span class="evie-wake-dot"></span> Listening…
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(widget);
    console.debug('[Farm Assistant] Widget appended to body. Element:', widget);
  }

  createInfoPopup(title, content) {
    // Create popup overlay
    const overlay = document.createElement('div');
    overlay.className = 'assistant-popup-overlay';
    
    const popup = document.createElement('div');
    popup.className = 'assistant-popup';
    
    popup.innerHTML = `
      <div class="assistant-popup-header">${title}</div>
      <div class="assistant-popup-content">${content}</div>
      <button class="assistant-popup-close" onclick="this.closest('.assistant-popup-overlay').remove()">Close</button>
    `;
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    // Auto-close after 15 seconds
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 500);
    }, 15000);
  }

  attachEventListeners() {
    const input = document.getElementById('assistantInput');
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');

    const settingsBtn = document.getElementById('settingsBtn');

    sendBtn.addEventListener('click', () => this.handleUserInput());
    voiceBtn.addEventListener('click', () => this.toggleVoiceRecognition());
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettings();
    });
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleUserInput();
    });

    // Image upload for crop diagnosis
    const imageBtn = document.getElementById('evieImageBtn');
    const imageInput = document.getElementById('evieImageInput');
    if (imageBtn && imageInput) {
      imageBtn.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', (e) => this._handleImageUpload(e));
    }
    
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent drag when clicking minimize
      this.toggleMinimize();
    });

    // Make the widget draggable
    this.makeDraggable();
  }

  makeDraggable() {
    const widget = document.getElementById('farm-assistant');
    const header = widget.querySelector('.assistant-header');
    
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    // Get initial position from CSS (bottom-right)
    const rect = widget.getBoundingClientRect();
    xOffset = rect.left;
    yOffset = rect.top;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // Touch events for mobile
    header.addEventListener('touchstart', dragStart);
    document.addEventListener('touchmove', drag);
    document.addEventListener('touchend', dragEnd);

    function dragStart(e) {
      // Don't drag if clicking on minimize button
      if (e.target.closest('.minimize-btn')) {
        return;
      }

      if (e.type === 'touchstart') {
        initialX = e.touches[0].clientX - xOffset;
        initialY = e.touches[0].clientY - yOffset;
      } else {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
      }

      isDragging = true;
      widget.style.transition = 'none';
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();

        if (e.type === 'touchmove') {
          currentX = e.touches[0].clientX - initialX;
          currentY = e.touches[0].clientY - initialY;
        } else {
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
        }

        xOffset = currentX;
        yOffset = currentY;

        // Keep widget within viewport bounds
        const maxX = window.innerWidth - widget.offsetWidth;
        const maxY = window.innerHeight - widget.offsetHeight;
        
        xOffset = Math.max(0, Math.min(xOffset, maxX));
        yOffset = Math.max(0, Math.min(yOffset, maxY));

        // Remove fixed positioning and use absolute
        widget.style.position = 'fixed';
        widget.style.left = xOffset + 'px';
        widget.style.top = yOffset + 'px';
        widget.style.bottom = 'auto';
        widget.style.right = 'auto';
      }
    }

    function dragEnd() {
      isDragging = false;
      widget.style.transition = 'all 0.3s ease';
      
      // Save position to localStorage
      localStorage.setItem('farmAssistantPosition', JSON.stringify({
        x: xOffset,
        y: yOffset
      }));
    }

    // Restore saved position
    const savedPosition = localStorage.getItem('farmAssistantPosition');
    if (savedPosition) {
      try {
        const pos = JSON.parse(savedPosition);
        xOffset = pos.x;
        yOffset = pos.y;
        
        widget.style.position = 'fixed';
        widget.style.left = pos.x + 'px';
        widget.style.top = pos.y + 'px';
        widget.style.bottom = 'auto';
        widget.style.right = 'auto';
      } catch (e) {
        console.warn('Could not restore Farm Assistant position:', e);
      }
    }
  }

  initVoiceRecognition() {
    // Check if browser supports Web Speech API
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn('Voice recognition not supported in this browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateVoiceButton();
      console.debug('🎤 Voice recognition started');
    };

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.debug('🎤 Heard:', transcript);
      
      const input = document.getElementById('assistantInput');
      input.value = transcript;
      
      // Auto-process the voice command
      this.handleUserInput();
    };

    this.recognition.onerror = (event) => {
      console.error('🎤 Voice recognition error:', event.error);
      this.isListening = false;
      this.updateVoiceButton();
      
      if (event.error === 'not-allowed') {
        this.addMessage('Microphone access denied. Check your browser settings.', 'assistant');
      } else if (event.error === 'no-speech') {
        this.addMessage('No speech detected. Try again.', 'assistant');
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateVoiceButton();
      console.log('🎤 Voice recognition ended');
    };
  }

  initTextToSpeech() {
    // Server-side OpenAI TTS is primary; browser speech is fallback.
    this.voiceEnabled = true;
    this.voices = [];
    this._ttsAudio = null;
    this._audioCtx = null;
    this._ttsSource = null;

    if (window.speechSynthesis) {
      const loadVoices = () => { this.voices = window.speechSynthesis.getVoices(); };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }

    // Create a persistent AudioContext and unlock it on first user gesture.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      this._audioCtx = new AudioCtx();
    }
    const unlockAudio = () => {
      if (this._audioCtx && this._audioCtx.state !== 'running') {
        this._audioCtx.resume().catch(() => {});
      }
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
  }

  speak(text) {
    if (!this.voiceEnabled) return;

    // Increment generation — any in-flight TTS for a prior generation is discarded on arrival.
    const gen = ++this._speakGeneration;

    // Cancel any in-progress playback.
    if (this._ttsSource) {
      try { this._ttsSource.stop(); } catch (_) { /* ignore */ }
      this._ttsSource = null;
    }
    if (this._ttsAudio) {
      this._ttsAudio.pause();
      this._ttsAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    this.isSpeaking = true;
    const ttsVoice = this.ttsVoice || window.FARM_ASSISTANT_TTS_VOICE || 'echo';
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 2000), voice: ttsVoice })
    })
      .then(res => {
        if (gen !== this._speakGeneration) return; // stale — discard
        if (!res.ok) throw new Error('TTS ' + res.status);
        return res.arrayBuffer();
      })
      .then(buf => {
        if (!buf || gen !== this._speakGeneration) return; // stale — discard
        // Keep a copy for fallback since decodeAudioData detaches the buffer.
        this._lastTtsBuf = buf.slice(0);
        return this._playViaWebAudio(buf, text, gen);
      })
      .catch(err => {
        console.warn('[TTS] Error:', err.message, '-- falling back to browser speech');
        this._speakBrowser(text);
      });
  }

  // Play audio buffer through Web Audio API (bypasses autoplay blocking).
  _playViaWebAudio(arrayBuffer, fallbackText, gen) {
    const ctx = this._audioCtx;
    if (!ctx) {
      console.warn('[TTS] No AudioContext -- trying HTML Audio');
      return this._playViaHtmlAudio(this._lastTtsBuf || arrayBuffer, fallbackText);
    }
    return ctx.resume().then(() => {
      if (gen != null && gen !== this._speakGeneration) return; // stale
      return ctx.decodeAudioData(arrayBuffer);
    }).then(audioBuffer => {
      if (!audioBuffer) return; // stale guard returned early
      if (gen != null && gen !== this._speakGeneration) return; // stale
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      this._ttsSource = source;
      source.onended = () => { this.isSpeaking = false; this._ttsSource = null; };
      source.start(0);
      console.log('[TTS] Playing via Web Audio API');
    }).catch(err => {
      console.warn('[TTS] Web Audio decode failed:', err.message, '-- trying HTML Audio');
      this._playViaHtmlAudio(this._lastTtsBuf, fallbackText);
    });
  }

  // HTMLAudioElement fallback if Web Audio API is unavailable.
  _playViaHtmlAudio(arrayBuffer, fallbackText) {
    try {
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._ttsAudio = audio;
      audio.onended = () => { this.isSpeaking = false; URL.revokeObjectURL(url); };
      audio.onerror = () => {
        this.isSpeaking = false;
        URL.revokeObjectURL(url);
        console.warn('[TTS] HTML Audio error -- using browser speech');
        this._speakBrowser(fallbackText);
      };
      audio.play().then(() => {
        console.log('[TTS] Playing via HTML Audio element');
      }).catch(() => {
        this.isSpeaking = false;
        URL.revokeObjectURL(url);
        console.warn('[TTS] HTML Audio play blocked -- using browser speech');
        this._speakBrowser(fallbackText);
      });
    } catch (e) {
      console.warn('[TTS] HTML Audio setup failed:', e.message, '-- using browser speech');
      this._speakBrowser(fallbackText);
    }
  }

  // Browser speech fallback disabled -- OpenAI voice is the only TTS source.
  // If the server TTS fails, we stay silent rather than using the robotic browser voice.
  _speakBrowser(text) {
    console.log('[TTS] Server TTS unavailable -- staying silent (browser speech disabled)');
    this.isSpeaking = false;
  }

  toggleMute() {
    this.voiceEnabled = !this.voiceEnabled;
    localStorage.setItem('evie_tts_enabled', JSON.stringify(this.voiceEnabled));
    // Update mute button icon
    const muteIcon = document.getElementById('muteIcon');
    if (muteIcon) muteIcon.textContent = this.voiceEnabled ? '\u{1F50A}' : '\u{1F507}';
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) muteBtn.title = this.voiceEnabled ? 'Mute voice' : 'Unmute voice';
    // Sync the settings panel checkbox if visible
    const ttsToggle = document.getElementById('evieTtsToggle');
    if (ttsToggle) ttsToggle.checked = this.voiceEnabled;
    // If muting, stop any current speech
    if (!this.voiceEnabled) {
      if (this._ttsSource) { try { this._ttsSource.stop(); } catch(_) {} this._ttsSource = null; }
      if (this._ttsAudio) { this._ttsAudio.pause(); this._ttsAudio = null; }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      this.isSpeaking = false;
    }
    console.log('[Farm Assistant] Voice ' + (this.voiceEnabled ? 'enabled' : 'muted'));
  }

  toggleVoiceRecognition() {
    if (!this.recognition) {
      this.addMessage('Voice input requires Chrome, Edge, or Safari.', 'assistant');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
        this.addMessage('Listening...', 'assistant');
      } catch (error) {
        console.error('Failed to start voice recognition:', error);
        this.addMessage('Could not access microphone. Please try again.', 'assistant');
      }
    }
  }

  updateVoiceButton() {
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceIcon = voiceBtn.querySelector('.voice-icon');
    
    if (this.isListening) {
      voiceBtn.classList.add('listening');
      voiceIcon.textContent = '🔴';
      voiceBtn.title = 'Stop listening';
    } else {
      voiceBtn.classList.remove('listening');
      voiceIcon.textContent = '🎤';
      voiceBtn.title = 'Voice command';
    }
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    const container = document.querySelector('.assistant-container');
    const icon = document.querySelector('.minimize-icon');
    
    container.classList.toggle('minimized', this.isMinimized);
    icon.textContent = this.isMinimized ? '+' : '\u2212';
    // Close settings panel when minimizing
    if (this.isMinimized && this.settingsOpen) this.toggleSettings();
  }

  // ── Settings Panel (Phase 5B) ──────────────────────
  toggleSettings() {
    this.settingsOpen = !this.settingsOpen;
    let panel = document.getElementById('evieSettingsPanel');
    if (this.settingsOpen && !panel) {
      panel = document.createElement('div');
      panel.id = 'evieSettingsPanel';
      panel.className = 'evie-settings-panel';
      const voices = ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer'];
      const voiceOpts = voices.map(v =>
        `<button class="evie-voice-chip${v === this.ttsVoice ? ' active' : ''}" data-voice="${v}">${v}</button>`
      ).join('');
      panel.innerHTML = `
        <div class="evie-settings-section">
          <label class="evie-settings-label">Voice</label>
          <div class="evie-voice-grid">${voiceOpts}</div>
        </div>
        <div class="evie-settings-section">
          <label class="evie-settings-label">
            <input type="checkbox" id="evieTtsToggle" ${this.voiceEnabled ? 'checked' : ''} />
            Read responses aloud
          </label>
        </div>
      `;
      const body = document.querySelector('.assistant-body');
      body.insertBefore(panel, body.firstChild);

      // Voice chip click handlers
      panel.querySelectorAll('.evie-voice-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.evie-voice-chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.ttsVoice = btn.dataset.voice;
          localStorage.setItem('evie_tts_voice', this.ttsVoice);
          // Play a short sample
          this.speak('Hello, I\'m E.V.I.E.');
        });
      });

      // TTS toggle handler
      document.getElementById('evieTtsToggle').addEventListener('change', (e) => {
        this.voiceEnabled = e.target.checked;
        localStorage.setItem('evie_tts_enabled', JSON.stringify(this.voiceEnabled));
      });
    } else if (panel) {
      panel.remove();
      this.settingsOpen = false;
    }
  }

  // ── Phase 6C: Feedback ──────────────────────────────
  async _submitFeedback(msgId, rating, content) {
    const container = document.querySelector(`.evie-feedback[data-msg-id="${msgId}"]`);
    if (!container || container.dataset.submitted) return;
    container.dataset.submitted = 'true';
    container.querySelectorAll('.evie-fb-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.rating === rating);
      b.disabled = true;
    });
    // Strip HTML for a short snippet
    const snippet = content.replace(/<[^>]*>/g, '').slice(0, 120);
    try {
      await fetch('/api/assistant/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ conversationId: this.conversationId, rating, snippet })
      });
    } catch (e) {
      console.warn('[Farm Assistant] feedback send failed', e);
    }
  }

  // ── Phase 6A: Usage-pattern tracking ────────────────
  _trackQuery(text) {
    try {
      const queries = JSON.parse(localStorage.getItem('evie_query_log') || '[]');
      queries.push({ q: text.slice(0, 200), t: Date.now() });
      // Keep last 200 queries
      if (queries.length > 200) queries.splice(0, queries.length - 200);
      localStorage.setItem('evie_query_log', JSON.stringify(queries));
    } catch (_) { /* silent */ }
  }

  getQueryStats() {
    try {
      const queries = JSON.parse(localStorage.getItem('evie_query_log') || '[]');
      const now = Date.now();
      const recent = queries.filter(q => now - q.t < 7 * 86400000);
      const topics = {};
      const keywords = ['plant', 'water', 'harvest', 'temperature', 'humidity', 'light', 'nutrient', 'cost', 'price', 'schedule', 'alert', 'sensor'];
      recent.forEach(({ q }) => {
        const lower = q.toLowerCase();
        keywords.forEach(k => { if (lower.includes(k)) topics[k] = (topics[k] || 0) + 1; });
      });
      return { totalQueries: queries.length, last7Days: recent.length, topTopics: topics };
    } catch (_) { return null; }
  }

  async handleUserInput() {
    const input = document.getElementById('assistantInput');
    const query = input.value.trim();
    
    if (!query) return;
    
    // Add user message
    this.addMessage(query, 'user');
    input.value = '';
    
    // Process query
    await this.processQuery(query);
  }

  async handleExampleQuery(query) {
    // Add user message
    this.addMessage(query, 'user');
    
    // Process query
    await this.processQuery(query);
  }

  setTypingIndicator(show) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    let indicator = messagesContainer.querySelector('.typing-indicator');
    if (show && !indicator) {
      indicator = document.createElement('div');
      indicator.className = 'message assistant-message typing-indicator';
      indicator.innerHTML = '<div class="message-avatar">AI</div><div class="message-content loading">Thinking…</div>';
      messagesContainer.appendChild(indicator);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else if (!show && indicator) {
      indicator.remove();
    }
  }

  addMessage(content, type = 'assistant', actions = null, suppressSpeak = false) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    if (type === 'action') {
      // Action buttons — no avatar, no history, no TTS
      messageDiv.innerHTML = `<div class="message-content">${content}</div>`;
      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return;
    }

    const avatar = type === 'user' ? 'You' : 'AI';
    const msgId = `msg-${Date.now()}`;
    const feedbackHtml = type === 'assistant' && this.aiAvailable
      ? `<div class="evie-feedback" data-msg-id="${msgId}">
           <button class="evie-fb-btn" data-rating="up" title="Helpful">👍</button>
           <button class="evie-fb-btn" data-rating="down" title="Not helpful">👎</button>
         </div>` : '';
    
    messageDiv.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        ${content}
        ${actions ? `<div class="message-actions">${actions}</div>` : ''}
        ${feedbackHtml}
      </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Wire feedback buttons
    if (feedbackHtml) {
      messageDiv.querySelectorAll('.evie-fb-btn').forEach(btn => {
        btn.addEventListener('click', () => this._submitFeedback(msgId, btn.dataset.rating, content));
      });
    }
    
    // Save to history
    this.conversationHistory.push({ content, type, timestamp: Date.now() });
    this.saveHistory();

    // Track assistant tool usage patterns (Phase 6A)
    if (type === 'user') this._trackQuery(content);
    
    // Speak assistant messages aloud (text-to-speech)
    if (type === 'assistant' && this.voiceEnabled && !suppressSpeak) {
      // Remove HTML tags and emojis from speech
      const cleanText = content
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
        .trim();
      
      if (cleanText) {
        console.log('🔊 Calling speak() for assistant message');
        this.speak(cleanText);
      }
    }
  }

  clearActionMessages() {
    const messagesContainer = document.getElementById('chatMessages');
    const actionMsgs = messagesContainer?.querySelectorAll('.action-message');
    if (actionMsgs) actionMsgs.forEach(el => el.remove());
  }

  showActionMessages({ pending_action, recent_action } = {}) {
    this.pendingAction = pending_action || null;
    this.recentAction = recent_action || null;
    this.clearActionMessages();

    const buttons = [];
    if (this.pendingAction) {
      buttons.push('<button class="assistant-confirm-btn" onclick="window._farmAssistant.confirmPendingAction()">Confirm</button>');
      buttons.push('<button class="assistant-cancel-btn" onclick="window._farmAssistant.cancelPendingAction()">Cancel</button>');
    }
    if (this.recentAction) {
      buttons.push('<button class="assistant-undo-btn" onclick="window._farmAssistant.undoRecentAction()">Undo Last Action</button>');
    }

    if (buttons.length > 0) {
      this.addMessage(buttons.join(' '), 'action');
    }
  }

  /**
   * Handle image file upload for crop diagnosis.
   */
  async _handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // Reset input

    if (file.size > 5 * 1024 * 1024) {
      this.addMessage('Image must be under 5 MB.');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result; // data:image/...;base64,...
      try {
        const resp = await this._authFetch('/api/assistant/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 })
        });
        if (!resp.ok) {
          this.addMessage('Image upload failed — please try again.');
          return;
        }
        const data = await resp.json();
        if (data.ok && data.image_url) {
          this._pendingImageUrl = data.image_url;
          // Show a thumbnail preview in chat
          this.addMessage(`<img src="${base64}" alt="Uploaded image" style="max-width:180px;max-height:140px;border-radius:8px;margin:4px 0" />`, 'user');
          // Focus the input so user can type a question about the image
          const input = document.getElementById('assistantInput');
          if (input) {
            input.placeholder = 'Describe the issue or ask about this image…';
            input.focus();
          }
        }
      } catch (err) {
        console.warn('[E.V.I.E.] Image upload error:', err);
        this.addMessage('Image upload failed — please try again.');
      }
    };
    reader.readAsDataURL(file);
  }

  async processQuery(query) {
    // Try GPT-powered AI chat first (if available)
    if (this.aiAvailable !== false) {
      try {
        const aiHandled = await this.tryAIChat(query);
        if (aiHandled) return;
      } catch (err) {
        console.warn('[Farm Assistant] AI chat failed, falling back to local:', err.message);
      }
    }

    // Fallback: local pattern matching (works offline / when API is down)
    await this.processQueryLocal(query);
  }

  /**
   * Send query to GPT-powered backend assistant with SSE streaming.
   * Returns true if handled, false if should fall through to local.
   */
  async tryAIChat(query) {
    // Check for pending action confirmation first (non-streaming)
    if (this.pendingAction) {
      return this._tryAIChatClassic(query);
    }

    const body = {
      message: query,
      conversation_id: this.conversationId || undefined,
      farm_id: window.FARM_ID || undefined,
      image_url: this._pendingImageUrl || undefined
    };
    this._pendingImageUrl = null; // Clear after use

    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('token') || localStorage.getItem('token') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch('/api/assistant/chat/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        if (resp.status === 503) { this.aiAvailable = false; return false; }
        // Fall back to classic non-streaming
        return this._tryAIChatClassic(query);
      }

      this.aiAvailable = true;

      // Parse SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let msgDiv = null;
      let contentEl = null;
      let fullReply = '';
      let convId = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let eventType = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'start') {
                convId = data.conversation_id;
                this.conversationId = convId;
                try { localStorage.setItem('evie_conversation_id', convId); } catch { /* quota */ }
              } else if (eventType === 'tool_start') {
                // Show tool progress inline
                this.setTypingIndicator(false);
                if (!msgDiv) {
                  const messagesContainer = document.getElementById('chatMessages');
                  msgDiv = document.createElement('div');
                  msgDiv.className = 'message assistant-message';
                  msgDiv.innerHTML = '<div class="message-avatar">AI</div><div class="message-content"><span class="evie-stream-text"></span></div>';
                  messagesContainer.appendChild(msgDiv);
                  contentEl = msgDiv.querySelector('.evie-stream-text');
                  messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
                const toolLabel = (data.tool || '').replace(/_/g, ' ');
                contentEl.innerHTML += `<span class="evie-tool-progress">\ud83d\udcca ${toolLabel}…</span> `;
              } else if (eventType === 'tool_done') {
                // Update tool status
                const progEls = contentEl?.querySelectorAll('.evie-tool-progress');
                if (progEls?.length > 0) {
                  const last = progEls[progEls.length - 1];
                  last.classList.add(data.success ? 'done' : 'failed');
                  last.textContent = last.textContent.replace('…', data.success ? ' ✓' : ' ✗');
                }
              } else if (eventType === 'token') {
                this.setTypingIndicator(false);
                if (!msgDiv) {
                  const messagesContainer = document.getElementById('chatMessages');
                  msgDiv = document.createElement('div');
                  msgDiv.className = 'message assistant-message';
                  msgDiv.innerHTML = '<div class="message-avatar">AI</div><div class="message-content"><span class="evie-stream-text"></span></div>';
                  messagesContainer.appendChild(messagesContainer.lastChild === msgDiv ? null : msgDiv);
                  messagesContainer.appendChild(msgDiv);
                  contentEl = msgDiv.querySelector('.evie-stream-text');
                }
                fullReply += data.text;
                // Clear tool progress and show streaming text
                const toolProgs = contentEl?.querySelectorAll('.evie-tool-progress');
                if (toolProgs?.length > 0 && !contentEl._toolsCleared) {
                  contentEl._toolsCleared = true;
                  // Keep tool progress summary, add line break
                  contentEl.innerHTML += '<br>';
                }
                contentEl.innerHTML = contentEl.innerHTML.replace(/<span class="evie-stream-text">.*?<\/span>/, '') ;
                // Re-render full reply content
                const streamSpan = document.createElement('span');
                streamSpan.className = 'evie-stream-text';
                streamSpan.innerHTML = fullReply;
                // Keep tool progress elements if any
                const existingTools = contentEl.querySelectorAll('.evie-tool-progress');
                contentEl.innerHTML = '';
                existingTools.forEach(t => contentEl.appendChild(t));
                if (existingTools.length > 0) {
                  contentEl.appendChild(document.createElement('br'));
                }
                contentEl.appendChild(streamSpan);
                const messagesContainer = document.getElementById('chatMessages');
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              } else if (eventType === 'done') {
                // Add feedback buttons
                if (msgDiv) {
                  const msgId = `msg-${Date.now()}`;
                  const feedbackDiv = document.createElement('div');
                  feedbackDiv.className = 'evie-feedback';
                  feedbackDiv.dataset.msgId = msgId;
                  feedbackDiv.innerHTML = `
                    <button class="evie-fb-btn" data-rating="up" title="Helpful">\ud83d\udc4d</button>
                    <button class="evie-fb-btn" data-rating="down" title="Not helpful">\ud83d\udc4e</button>
                  `;
                  msgDiv.querySelector('.message-content').appendChild(feedbackDiv);
                  feedbackDiv.querySelectorAll('.evie-fb-btn').forEach(btn => {
                    btn.addEventListener('click', () => this._submitFeedback(msgId, btn.dataset.rating, fullReply));
                  });
                }

                this.showActionMessages(data);

                // Speak the reply
                if (this.voiceEnabled && fullReply) {
                  const cleanText = fullReply.replace(/<[^>]*>/g, '').replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
                  if (cleanText) this.speak(cleanText);
                }
              } else if (eventType === 'error') {
                this.setTypingIndicator(false);
                fullReply = data.message || 'Something went wrong.';
                this.addMessage(fullReply);
              }
            } catch { /* skip malformed JSON */ }
            eventType = null;
          }
        }
      }

      // Save to conversation history
      if (fullReply) {
        this.conversationHistory.push({ content: fullReply, type: 'assistant', timestamp: Date.now() });
        this.saveHistory();
      }

      return true;
    } catch (err) {
      console.warn('[Farm Assistant] Streaming failed, trying classic:', err.message);
      return this._tryAIChatClassic(query);
    }
  }

  /**
   * Classic (non-streaming) AI chat — used as fallback and for confirmations.
   */
  async _tryAIChatClassic(query) {
    const body = {
      message: query,
      conversation_id: this.conversationId || undefined,
      farm_id: window.FARM_ID || undefined
    };

    const resp = await this._authFetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      if (resp.status === 503) {
        // AI not configured — mark unavailable and fall through
        this.aiAvailable = false;
        return false;
      }
      return false;
    }

    const data = await resp.json();
    if (!data.ok || !data.reply) return false;

    // Track conversation for follow-ups
    this.conversationId = data.conversation_id;
    try { localStorage.setItem('evie_conversation_id', data.conversation_id); } catch { /* quota */ }
    this.aiAvailable = true;

    // Display the AI response
    this.addMessage(data.reply);
    this.showActionMessages(data);

    return true;
  }

  /**
   * Confirm a pending write action.
   */
  async confirmPendingAction() {
    if (!this.pendingAction || !this.conversationId) return;
    this.pendingAction = null;
    this.clearActionMessages();

    this.addMessage('Yes, confirm.', 'user');
    this.setTypingIndicator(true);

    try {
      const resp = await this._authFetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '__confirm_action__',
          conversation_id: this.conversationId,
          farm_id: window.FARM_ID || undefined
        })
      });
      this.setTypingIndicator(false);
      if (!resp.ok) { this.addMessage('Action failed — please try again.'); return; }
      const data = await resp.json();
      if (data.reply) this.addMessage(data.reply);
      this.showActionMessages(data);
    } catch (err) {
      this.setTypingIndicator(false);
      this.addMessage('Action failed — please try again.');
    }
  }

  /**
   * Cancel a pending write action.
   */
  async cancelPendingAction() {
    if (!this.conversationId) return;
    this.pendingAction = null;
    this.clearActionMessages();

    this.addMessage('Cancel', 'user');
    this.setTypingIndicator(true);

    try {
      const resp = await this._authFetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '__cancel_action__',
          conversation_id: this.conversationId,
          farm_id: window.FARM_ID || undefined
        })
      });
      this.setTypingIndicator(false);
      if (!resp.ok) { this.addMessage('Cancelled.'); return; }
      const data = await resp.json();
      if (data.reply) this.addMessage(data.reply);
      this.showActionMessages(data);
    } catch {
      this.setTypingIndicator(false);
      this.addMessage('Cancelled — no changes made.');
    }
  }

  async undoRecentAction() {
    if (!this.recentAction || !this.conversationId) return;
    this.recentAction = null;
    this.clearActionMessages();

    this.addMessage('Undo the last action.', 'user');
    this.setTypingIndicator(true);

    try {
      const resp = await this._authFetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '__undo_action__',
          conversation_id: this.conversationId,
          farm_id: window.FARM_ID || undefined
        })
      });
      this.setTypingIndicator(false);
      if (!resp.ok) { this.addMessage('Undo failed — please try again.'); return; }
      const data = await resp.json();
      if (data.reply) this.addMessage(data.reply);
      this.showActionMessages(data);
    } catch {
      this.setTypingIndicator(false);
      this.addMessage('Undo failed — please try again.');
    }
  }

  /**
   * Local pattern-matching fallback (original logic).
   * Used when AI API is unavailable or fails.
   */
  async processQueryLocal(query) {
    const lowerQuery = query.toLowerCase();
    
    // Setup / onboarding queries (highest priority for new users)
    if (await this.matchSetupQuery(lowerQuery)) return;

    // Fun facts (educational and engaging for kids!)
    if (this.matchFunFactRequest(lowerQuery)) return;
    
    // Joke/Riddle requests (fun for kids!)
    if (this.matchJokeRequest(lowerQuery)) return;
    
    // Harvest queries (priority for education)
    if (await this.matchHarvestQuery(lowerQuery)) return;
    
    // Environmental quick checks
    if (await this.matchEnvironmentQuery(lowerQuery)) return;
    
    // Navigation intents
    if (this.matchNavigation(lowerQuery)) return;
    
    // Crop/Inventory queries
    if (await this.matchInventoryQuery(lowerQuery)) return;
    
    // Farm health queries
    if (await this.matchHealthQuery(lowerQuery)) return;
    
    // Hardware control
    if (await this.matchHardwareControl(lowerQuery)) return;
    
    // Alert queries
    if (await this.matchAlertQuery(lowerQuery)) return;
    
    // Contextual help
    if (this.matchContextualHelp(lowerQuery)) return;
    
    // Fallback with encouragement
    this.addMessage(
      `I'm not sure how to help with that. Here are some things I can do:
      <ul>
        <li><strong>Harvest</strong> — "What's ready to harvest?"</li>
        <li><strong>Environment</strong> — "Show me the temperature"</li>
        <li><strong>Crop lookup</strong> — "Where is the basil?"</li>
        <li><strong>Hardware ID</strong> — "Blink lights for basil"</li>
        <li><strong>Scheduling</strong> — "Show planting schedule"</li>
        <li><strong>Setup</strong> — "What should I do next?"</li>
      </ul>`
    );
  }

  /**
   * Setup / Onboarding query handler
   * Responds to "how do I set up", "what should I do next", "help me get started", etc.
   */
  async matchSetupQuery(query) {
    const setupPatterns = /set\s*up|get\s*started|first\s*time|new\s*here|help\s*me\s*start|onboard|getting started/i;
    const nextPatterns = /what.*next|what.*do|todo|to-do|next\s*step/i;
    const addRoomPattern = /add.*room|create.*room|new.*room/i;
    const paymentPattern = /payment|square|pay|checkout/i;
    const storePattern = /store|online.*sale|e-?commerce|shop/i;
    const inventoryPattern = /add.*inventory|add.*stock|add.*product|manage.*inventory/i;
    const upgradePattern = /upgrade|edge|light.*engine.*edge/i;
    const profilePattern = /profile|contact|my.*info|update.*name|change.*email|my.*phone/i;

    if (setupPatterns.test(query) || nextPatterns.test(query)) {
      await this.showOnboardingStatus();
      return true;
    }

    if (addRoomPattern.test(query)) {
      this.addMessage(
        `🌱 <strong>Add a grow room.</strong><br>Grow rooms are the foundation of your layout — zones, sensors, and light groups all live inside a room. Go to <strong>Setup/Update → Farm Setup → Grow Rooms</strong> to define your first space.`,
        'assistant',
        `<button onclick="window.location.href='/LE-dashboard.html?panel=grow-rooms'" class="action-btn primary">Open Grow Rooms</button>`
      );
      return true;
    }

    if (paymentPattern.test(query)) {
      this.addMessage(
        `<strong>Connect payment processing.</strong><br>GreenReach uses Square for payments — store checkout, POS, and wholesale billing. Go to <strong>Settings → Payment Methods</strong> to link your Square account.`,
        'assistant',
        `<button onclick="if(window.parent && window.parent.document.querySelector('[data-section=payments]')){window.parent.document.querySelector('[data-section=payments]').click()}else{window.location.href='/LE-farm-admin.html#payments'}" class="action-btn primary">Open Payment Settings</button>`
      );
      return true;
    }

    if (storePattern.test(query)) {
      this.addMessage(
        `<strong>Set up your online store.</strong><br>Your store lets customers browse crops and place orders directly. Make sure you've added crops and set prices first. The store wizard walks you through branding, delivery, and payment setup.`,
        'assistant',
        `<button onclick="window.location.href='/LE-dashboard.html?wizard=store-setup'" class="action-btn primary">Open Store Wizard</button>`
      );
      return true;
    }

    if (inventoryPattern.test(query)) {
      this.addMessage(
        `📦 <strong>Let's add crops to your inventory.</strong><br>Your inventory is the single source of truth for everything you grow. Each crop you add here becomes available in your store, POS, pricing tools, and planting scheduler. Include the variety, growing zone, and expected yield for the most accurate tracking.`,
        'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">Open Inventory</button>`
      );
      return true;
    }

    if (upgradePattern.test(query)) {
      this.addMessage(
        `<strong>Light Engine runs fully in the cloud.</strong><br>There is no required on-site edge hardware tier for this deployment. You can use monitoring, inventory, store, POS, wholesale, and assistant workflows directly from your current cloud environment.`,
        'assistant',
        `<button onclick="window.location.href='/LE-farm-admin.html#settings'" class="action-btn primary">Open Settings</button>`
      );
      return true;
    }

    if (profilePattern.test(query)) {
      this.addMessage(
        `👤 <strong>Let's update your farm profile.</strong><br>Your profile information — farm name, contact name, email, phone, and address — appears on customer receipts, invoices, your online store, and wholesale communications. Keeping it accurate ensures your buyers and customers can reach you.`,
        'assistant',
        `<button onclick="if(window.parent && window.parent.document.querySelector('[data-section=settings]')){window.parent.document.querySelector('[data-section=settings]').click()}else{window.location.href='/LE-farm-admin.html#settings'}" class="action-btn primary">Open Settings</button>`
      );
      return true;
    }

    return false;
  }

  async showOnboardingStatus() {
    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('token') || '';
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/setup-wizard/onboarding-status', { headers });
      if (!response.ok) throw new Error('Could not fetch onboarding status');
      const data = await response.json();

      if (!data.success || !data.tasks) {
        this.addMessage(`I couldn't load your setup status. Try going to <strong>Settings</strong> to see your progress.`);
        return;
      }

      const incomplete = data.tasks.filter(t => !t.completed);
      const completed = data.tasks.filter(t => t.completed);

      if (incomplete.length === 0) {
        this.addMessage(
          `<strong>All ${data.totalCount} setup tasks are complete.</strong> Your farm is fully configured. Ask me about harvests, environment, or anything else.`
        );
        return;
      }

      let nextTasks = incomplete.slice(0, 3).map(t => `<li>${t.icon || '○'} ${t.label}</li>`).join('');
      this.addMessage(
        `<strong>Setup Progress: ${data.completedCount} of ${data.totalCount} complete</strong>
        <br><br>Next steps:
        <ul>${nextTasks}</ul>
        ${incomplete.length > 3 ? `<em>...and ${incomplete.length - 3} more</em>` : ''}
        <br>Open <strong>Getting Started</strong> in Settings to jump to any task.`,
        'assistant',
        `<button onclick="if(window.parent && window.parent.document.querySelector('[data-section=settings]')){window.parent.document.querySelector('[data-section=settings]').click()}else{window.location.href='/LE-farm-admin.html#settings'}" class="action-btn primary">View Full Checklist</button>`
      );
    } catch (error) {
      console.error('[Farm Assistant] Onboarding status error:', error);
      this.addMessage(`I had trouble checking your setup progress. Go to <strong>Settings</strong> to see the onboarding checklist.`);
    }
  }

  matchNavigation(query) {
    // Simplified navigation - just check if query contains ANY keyword
    const navPatterns = [
      { keywords: ['planting', 'schedule', 'calendar', 'plan'], url: '/views/planting-scheduler.html', name: 'Planting Schedule', emoji: '' },
      { keywords: ['tray', 'seed', 'seeding'], url: '/views/tray-inventory.html', name: 'Tray Inventory', emoji: '' },
      { keywords: ['dashboard', 'home', 'main', 'summary'], url: '/views/farm-summary.html', name: 'Farm Dashboard', emoji: '' },
      { keywords: ['wholesale', 'buyer'], url: '/GR-wholesale.html', name: 'Wholesale Portal', emoji: '' },
      { keywords: ['sales', 'pos', 'sell', 'store'], url: '/Farmsales-pos.html', name: 'POS Terminal', emoji: '' },
      { keywords: ['heatmap', 'map', 'temps'], url: '/views/room-heatmap.html', name: 'Temperature Heatmap', emoji: '' },
      { keywords: ['inventory', 'crops', 'plants'], url: '/views/farm-inventory.html', name: 'Crop Inventory', emoji: '' },
      { keywords: ['admin', 'settings'], url: '/GR-central-admin.html', name: 'Central Admin', emoji: '' }
    ];

    for (const nav of navPatterns) {
      // Match if contains page keyword (much simpler!)
      if (nav.keywords.some(kw => query.includes(kw))) {
        const actions = `<button onclick="window.location.href='${nav.url}'" class="action-btn primary">Open ${nav.name} ${nav.emoji}</button>`;
        this.addMessage(`Opening <strong>${nav.name}</strong>... ${nav.emoji}`, 'assistant', actions);
        setTimeout(() => window.location.href = nav.url, 1500);
        return true;
      }
    }
    
    return false;
  }

  async matchHarvestQuery(query) {
    // Simple keyword matching - if query contains harvest-related words
    const harvestKeywords = ['harvest', 'ready', 'pick', 'collect', 'ripe'];
    const todayKeywords = ['today', 'now', 'currently'];
    
    // Check if query has ANY harvest keyword
    const hasHarvestWord = harvestKeywords.some(word => query.includes(word));
    const hasTodayWord = todayKeywords.some(word => query.includes(word));
    
    // Match if: has harvest word (with or without today)
    if (hasHarvestWord) {
      await this.checkHarvestReady();
      return true;
    }
    
    return false;
  }

  async checkHarvestReady() {
    try {
      const API_BASE = window.API_BASE || '';
      const response = await this._authFetch(`${API_BASE}/env`);
      if (!response.ok) throw new Error('Failed to fetch crop data');
      
      const data = await response.json();
      let readyToHarvest = [];
      let soonToHarvest = [];
      
      if (data.zones) {
        data.zones.forEach(zone => {
          if (zone.groups) {
            zone.groups.forEach(group => {
              if (group.harvestIn !== undefined) {
                const item = {
                  zone: zone.name || zone.id,
                  group: group.name || group.id,
                  crop: group.crop,
                  trays: group.trays || 0,
                  harvestIn: group.harvestIn,
                  daysOld: group.daysOld
                };
                
                if (group.harvestIn <= 0) {
                  readyToHarvest.push(item);
                } else if (group.harvestIn <= 3) {
                  soonToHarvest.push(item);
                }
              }
            });
          }
        });
      }

      if (readyToHarvest.length > 0) {
        // Create simple list for children
        const cropNames = [...new Set(readyToHarvest.map(item => item.crop))];
        const cropList = cropNames.join(', ');
        
        let popupContent = `
          <div class="harvest-list">
            <div class="harvest-icon">🌾</div>
            <div class="harvest-text">
              <p class="harvest-message">Ready today:</p>
              <p class="harvest-crops">${cropList}</p>
              <p class="harvest-count">${readyToHarvest.length} tray${readyToHarvest.length > 1 ? 's' : ''} ready</p>
            </div>
          </div>
        `;
        
        this.createInfoPopup('Ready to Harvest', popupContent);
        this.addMessage(`${cropNames.length} crop type${cropNames.length > 1 ? 's' : ''} ready for harvest.`, 'assistant');
      } else if (soonToHarvest.length > 0) {
        const cropNames = [...new Set(soonToHarvest.map(item => item.crop))];
        let popupContent = `
          <div class="harvest-list">
            <div class="harvest-icon">🌱</div>
            <div class="harvest-text">
              <p class="harvest-message">Coming soon:</p>
              <p class="harvest-crops">${cropNames.join(', ')}</p>
              <p class="harvest-count">Expected ready in 1–2 days</p>
            </div>
          </div>
        `;
        
        this.createInfoPopup('Almost Ready', popupContent);
        this.addMessage('These crops are close to harvest.', 'assistant');
      } else {
        this.addMessage('No crops are currently ready for harvest.', 'assistant');
      }
    } catch (error) {
      console.error('Harvest check error:', error);
      this.addMessage('I had trouble checking harvest status. Let me take you to the inventory page.', 'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View Inventory</button>`
      );
    }
  }

  async matchEnvironmentQuery(query) {
    // Simple keyword matching for environment
    const tempWords = ['temp', 'temperature', 'hot', 'cold', 'warm', 'cool', 'degree'];
    const humidityWords = ['humidity', 'humid', 'moisture', 'wet', 'dry'];
    const envWords = ['condition', 'environment', 'climate', 'weather'];
    
    const hasTempWord = tempWords.some(word => query.includes(word));
    const hasHumidityWord = humidityWords.some(word => query.includes(word));
    const hasEnvWord = envWords.some(word => query.includes(word));
    
    // Match if has ANY environment-related word
    if (hasTempWord || hasHumidityWord || hasEnvWord) {
      await this.checkEnvironment(query);
      return true;
    }
    
    return false;
  }

  async checkEnvironment(query) {
    try {
      const API_BASE = window.API_BASE || '';
      const response = await this._authFetch(`${API_BASE}/env`);
      if (!response.ok) throw new Error('Failed to fetch environmental data');
      
      const data = await response.json();
      
      if (data.zones && data.zones.length > 0) {
        // Temperature is in sensors.tempC.current (Celsius), keep as Celsius
        const temps = data.zones
          .map(z => parseFloat(z.sensors?.tempC?.current))
          .filter(v => Number.isFinite(v));
        const humidities = data.zones
          .map(z => parseFloat(z.sensors?.rh?.current))
          .filter(v => Number.isFinite(v));

        if (!temps.length && !humidities.length) {
          throw new Error('No live temperature or humidity readings available');
        }
        
        const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null;
        const minTemp = temps.length ? Math.min(...temps).toFixed(1) : null;
        const maxTemp = temps.length ? Math.max(...temps).toFixed(1) : null;
        
        const avgHumidity = humidities.length ? (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(0) : null;
        const minHumidity = humidities.length ? Math.min(...humidities).toFixed(0) : null;
        const maxHumidity = humidities.length ? Math.max(...humidities).toFixed(0) : null;
        
        // Determine what user asked for
        const wantsTemp = /temp|temperature|hot|cold|warm/i.test(query);
        const wantsHumidity = /humidity|humid/i.test(query);
        
        // Create child-friendly popup content
        let popupContent = '<div class="big-info">';
        
        if ((wantsTemp || (!wantsTemp && !wantsHumidity)) && avgTemp != null) {
          popupContent += `
            <div class="info-item">
              <div class="info-icon">🌡️</div>
              <div class="info-label">Temperature</div>
              <div class="info-value">${avgTemp}°C</div>
            </div>
          `;
        }
        
        if ((wantsHumidity || (!wantsTemp && !wantsHumidity)) && avgHumidity != null) {
          popupContent += `
            <div class="info-item">
              <div class="info-icon">💧</div>
              <div class="info-label">Humidity</div>
              <div class="info-value">${avgHumidity}%</div>
            </div>
          `;
        }
        
        popupContent += '</div>';
        
        // Add status message (Celsius thresholds: 20-26°C ideal, <18°C or >29°C warning)
        if (avgTemp != null && avgHumidity != null && avgTemp >= 20 && avgTemp <= 26 && avgHumidity >= 50 && avgHumidity <= 70) {
          popupContent += '<div class="status-message success">All readings within ideal range</div>';
        } else if (avgTemp < 18 || avgTemp > 29) {
          popupContent += '<div class="status-message warning">Temperature outside ideal range</div>';
        } else {
          popupContent += '<div class="status-message ok">Conditions within acceptable range</div>';
        }
        
        this.createInfoPopup('Environment', popupContent);
        this.addMessage('Current environment readings:', 'assistant');
      } else {
        this.addMessage('No environmental data available right now.', 'assistant');
      }
    } catch (error) {
      console.error('Environment check error:', error);
      this.addMessage('I had trouble checking the environment. Let me show you the heatmap.', 'assistant',
        `<button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn primary">View Heatmap</button>`
      );
    }
  }

  async matchInventoryQuery(query) {
    // Common crop names to detect
    const commonCrops = ['lettuce', 'basil', 'tomato', 'kale', 'spinach', 'arugula', 'chard', 
                         'herb', 'romaine', 'microgreen', 'green', 'salad'];
    
    // Check if query mentions a crop
    const mentionedCrop = commonCrops.find(crop => query.includes(crop));
    
    const cropPatterns = [
      /do (we|you) have (.+)/i,
      /where is (.+)/i,
      /where('s| is) (.+)/i,
      /find (.+)/i,
      /locate (.+)/i,
      /show me (.+)/i,
      /how much (.+)/i,
      /any (.+)/i
    ];

    for (const pattern of cropPatterns) {
      const match = query.match(pattern);
      if (match) {
        const cropName = match[match.length - 1]
          .replace(/\?/g, '')
          .replace(/\bthe\b/gi, '')
          .trim();
        await this.searchCrop(cropName, query);
        return true;
      }
    }
    
    // Fallback: if mentions a crop name, search for it
    if (mentionedCrop) {
      await this.searchCrop(mentionedCrop, query);
      return true;
    }
    
    return false;
  }

  async searchCrop(cropName, originalQuery = '') {
    try {
      const API_BASE = window.API_BASE || '';
      
      // Try to fetch inventory data
      const response = await this._authFetch(`${API_BASE}/env`);
      if (!response.ok) throw new Error('Failed to fetch inventory');
      
      const data = await response.json();
      
      // Search through zones for matching crops
      let found = [];
      if (data.zones) {
        data.zones.forEach(zone => {
          if (zone.groups) {
            zone.groups.forEach(group => {
              if (group.crop && group.crop.toLowerCase().includes(cropName.toLowerCase())) {
                found.push({
                  zone: zone.name || zone.id,
                  zoneId: zone.id,
                  group: group.name || group.id,
                  groupId: group.id,
                  crop: group.crop,
                  trays: group.trays || 0,
                  daysOld: group.daysOld,
                  harvestIn: group.harvestIn
                });
              }
            });
          }
        });
      }

      if (found.length > 0) {
        const isLocateQuery = /locate|where|show me where/i.test(originalQuery);
        
        if (isLocateQuery) {
          // Child-friendly response: blink lights
          this.addMessage(`Certainly! Let me blink the lights where the ${cropName} is! 💡`, 'assistant');
          
          // Blink lights for each location
          found.forEach(item => {
            this.blinkZoneLights(item.zoneId, item.groupId);
          });
          
          // Show simple popup with locations
          let popupContent = `
            <div class="location-list">
              <div class="location-icon">📍</div>
              <div class="location-text">
                <p class="location-message">${cropName} is in:</p>
          `;
          
          found.forEach(item => {
            popupContent += `<p class="location-item"><strong>${item.zone}</strong> - ${item.trays} trays</p>`;
          });
          
          popupContent += `
                <p class="location-hint">Watch for the blinking lights! 💡</p>
              </div>
            </div>
          `;
          
          this.createInfoPopup(`Found: ${cropName}`, popupContent);
        } else {
          // Simple info query
          const totalTrays = found.reduce((sum, item) => sum + item.trays, 0);
          let popupContent = `
            <div class="crop-info">
              <div class="crop-icon">🌱</div>
              <div class="crop-text">
                <p class="crop-message">We have ${cropName}!</p>
                <p class="crop-details">${totalTrays} trays growing</p>
                <p class="crop-locations">In ${found.length} location${found.length > 1 ? 's' : ''}</p>
              </div>
            </div>
          `;
          
          this.createInfoPopup(`${cropName}`, popupContent);
          this.addMessage(`Yes! We're growing ${cropName}! 🌱`, 'assistant');
        }
      } else {
        this.addMessage(`I don't see any ${cropName} growing right now. 🤔`, 'assistant');
      }
    } catch (error) {
      console.error('Crop search error:', error);
      this.addMessage(`😕 I had trouble searching for ${cropName}. Let me show you the inventory page.`, 'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View Inventory</button>`
      );
    }
  }

  async matchHealthQuery(query) {
    // Simple keyword matching for farm health
    const healthWords = ['health', 'status', 'ok', 'good', 'problem', 'issue', 'working'];
    const farmWords = ['farm', 'everything', 'system'];
    
    const hasHealthWord = healthWords.some(word => query.includes(word));
    const hasFarmWord = farmWords.some(word => query.includes(word));
    const hasHow = query.includes('how');
    
    // Match if: health word + farm word, OR "how" + farm word
    if ((hasHealthWord && hasFarmWord) || (hasHow && hasFarmWord)) {
      await this.checkFarmHealth();
      return true;
    }
    
    return false;
  }

  async checkFarmHealth() {
    try {
      const API_BASE = window.API_BASE || '';
      const response = await this._authFetch(`${API_BASE}/env`);
      if (!response.ok) throw new Error('Failed to fetch farm data');
      
      const data = await response.json();
      
      let message = '<strong>Farm Health Status:</strong><ul>';
      
      if (data.zones && data.zones.length > 0) {
        const temps = data.zones
          .map(z => parseFloat(z.sensors?.tempC?.current))
          .filter(v => Number.isFinite(v));
        const humidities = data.zones
          .map(z => parseFloat(z.sensors?.rh?.current))
          .filter(v => Number.isFinite(v));
        const avgTemp = temps.length ? (temps.reduce((sum, value) => sum + value, 0) / temps.length).toFixed(1) : null;
        const avgHumidity = humidities.length ? (humidities.reduce((sum, value) => sum + value, 0) / humidities.length).toFixed(0) : null;
        
        if (avgTemp != null) message += `<li>🌡️ Average Temperature: ${avgTemp}°C</li>`;
        if (avgHumidity != null) message += `<li>💧 Average Humidity: ${avgHumidity}%</li>`;
        message += `<li>📊 Active Zones: ${data.zones.length}</li>`;
      }
      
      message += `</ul>`;
      
      const actions = `
        <button onclick="window.location.href='/views/farm-summary.html'" class="action-btn primary">View Dashboard</button>
        <button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">View Heatmap</button>
      `;
      
      this.addMessage(message, 'assistant', actions);
    } catch (error) {
      console.error('Health check error:', error);
      this.addMessage('I had trouble checking farm health. Let me take you to the dashboard.', 'assistant',
        `<button onclick="window.location.href='/views/farm-summary.html'" class="action-btn primary">Open Dashboard</button>`
      );
    }
  }

  async matchHardwareControl(query) {
    // Simple keyword check first - if no action word, skip
    const actionWords = ['blink', 'flash', 'light', 'identify'];
    const hasActionWord = actionWords.some(word => query.includes(word));
    if (!hasActionWord) return false;
    
    const hardwarePatterns = [
      { pattern: /blink (lights?|leds?) (for |in |zone )?(.+)/i, action: 'blink' },
      { pattern: /identify (zone |group )?(.+)/i, action: 'identify' },
      { pattern: /show (me )?where (.+) is/i, action: 'locate' },
      { pattern: /(blink|flash|light).+/i, action: 'blink' }
    ];

    for (const hw of hardwarePatterns) {
      const match = query.match(hw.pattern);
      if (match) {
        const target = match[match.length - 1].trim();
        await this.controlHardware(hw.action, target);
        return true;
      }
    }
    
    return false;
  }

  async controlHardware(action, target) {
    try {
      const API_BASE = window.API_BASE || '';
      
      // First, find the target zone/group
      const response = await this._authFetch(`${API_BASE}/env`);
      if (!response.ok) throw new Error('Failed to fetch zones');
      
      const data = await response.json();
      let found = null;
      
      if (data.zones) {
        for (const zone of data.zones) {
          if (zone.id && zone.id.toLowerCase().includes(target.toLowerCase())) {
            found = { type: 'zone', id: zone.id, name: zone.name || zone.id };
            break;
          }
          if (zone.groups) {
            for (const group of zone.groups) {
              if (group.id && group.id.toLowerCase().includes(target.toLowerCase())) {
                found = { type: 'group', id: group.id, name: group.name || group.id, zone: zone.id };
                break;
              }
            }
          }
        }
      }

      if (found) {
        // Attempt to send identify command
        const endpoint = found.type === 'zone' 
          ? `${API_BASE}/api/automation/zones/${found.id}/identify`
          : `${API_BASE}/api/automation/groups/${found.id}/identify`;
        
        const identifyResp = await fetch(endpoint, { method: 'POST' }).catch(() => null);
        
        if (identifyResp && identifyResp.ok) {
          this.addMessage(`Blinking lights for <strong>${found.name}</strong> — watch for the flash over the next 10 seconds.`, 'assistant',
            `<button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">View on Heatmap</button>`
          );
        } else {
          this.addMessage(`Found <strong>${found.name}</strong>, but hardware control isn't available right now.`, 'assistant',
            `<button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">View on Heatmap</button>`
          );
        }
      } else {
        this.addMessage(`I couldn't find "${target}". Try being more specific, like "zone A" or "group 1".`);
      }
    } catch (error) {
      console.error('Hardware control error:', error);
      this.addMessage(`I had trouble controlling hardware. Make sure you're connected to the farm network.`);
    }
  }

  async matchAlertQuery(query) {
    const alertPatterns = [
      /any (alerts?|warnings?|problems?)/i,
      /show (me )?(alerts?|warnings?)/i,
      /what'?s wrong/i,
      /(alerts?|warnings?) today/i
    ];

    if (alertPatterns.some(pattern => pattern.test(query))) {
      await this.checkAlerts();
      return true;
    }
    
    return false;
  }

  async checkAlerts() {
    try {
      const API_BASE = window.API_BASE || '';
      const response = await fetch(`${API_BASE}/api/schedule-executor/ml-anomalies`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.anomalies && data.anomalies.length > 0) {
          let message = `<strong>${data.anomalies.length} active alert${data.anomalies.length > 1 ? 's' : ''}:</strong><ul>`;
          data.anomalies.slice(0, 3).forEach(alert => {
            message += `<li><strong>${alert.severity}:</strong> ${alert.reason} (${alert.zone})</li>`;
          });
          message += `</ul>`;
          
          this.addMessage(message, 'assistant',
            `<button onclick="window.location.href='/views/farm-summary.html'" class="action-btn primary">View All Alerts</button>`
          );
        } else {
          this.addMessage('No active alerts. All systems normal.', 'assistant',
            `<button onclick="window.location.href='/views/farm-summary.html'" class="action-btn">View Dashboard</button>`
          );
        }
      } else {
        throw new Error('Failed to fetch alerts');
      }
    } catch (error) {
      console.error('Alert check error:', error);
      this.addMessage('I had trouble checking alerts. Let me take you to the dashboard.', 'assistant',
        `<button onclick="window.location.href='/views/farm-summary.html'" class="action-btn primary">Open Dashboard</button>`
      );
    }
  }

  matchContextualHelp(query) {
    const helpPatterns = /help|what can you do|commands|features/i;
    
    if (helpPatterns.test(query)) {
      this.addMessage(`
        <strong>What I can help with:</strong>
        <ul>
          <li><strong>Harvest</strong> — "What's ready to harvest?"</li>
          <li><strong>Environment</strong> — "Show me the temperature"</li>
          <li><strong>Crop lookup</strong> — "Where is the basil?"</li>
          <li><strong>Hardware ID</strong> — "Blink lights for romaine"</li>
          <li><strong>Alerts</strong> — "Any alerts?"</li>
          <li><strong>Navigation</strong> — "Open planting schedule"</li>
          <li><strong>Setup</strong> — "What should I do next?"</li>
        </ul>
      `);
      return true;
    }
    
    return false;
  }

  matchJokeRequest(query) {
    const jokePatterns = /tell me a joke|joke|riddle|make me laugh|funny|something funny/i;
    
    if (jokePatterns.test(query)) {
      // Pick a random joke or riddle
      const item = this.jokes[Math.floor(Math.random() * this.jokes.length)];
      
      // Create child-friendly popup with answer hidden initially
      const popupContent = `
        <div class="joke-display">
          <div class="joke-icon">${item.type === 'riddle' ? '🤔' : '😄'}</div>
          <div class="joke-text">
            <p class="joke-question">${item.question}</p>
            <p class="joke-answer" style="opacity: 0; transition: opacity 0.5s ease-in;">${item.answer}</p>
          </div>
        </div>
      `;
      
      this.createInfoPopup(item.type === 'riddle' ? 'Riddle' : 'Joke', popupContent);
      
      // Speak the question first
      const questionText = item.question.replace(/[🤔😄]/g, '');
      this.speak(questionText);
      
      // Show and speak answer after 3 seconds
      setTimeout(() => {
        const answerElement = document.querySelector('.joke-answer');
        if (answerElement) {
          answerElement.style.opacity = '1';
        }
        // Speak the answer
        const answerText = item.answer.replace(/[🤔😄]/g, '');
        this.speak(answerText);
      }, 3000);
      
      this.addMessage(`Here's a ${item.type === 'riddle' ? 'riddle' : 'joke'} for you!`, 'assistant', null, true);
      return true;
    }
    
    return false;
  }

  matchFunFactRequest(query) {
    const funFactPatterns = /fun fact|tell me a fun fact|interesting fact|cool fact|amazing fact|did you know/i;
    
    if (funFactPatterns.test(query)) {
      // Pick a random fun fact
      const fact = this.funFacts[Math.floor(Math.random() * this.funFacts.length)];
      
      // Create child-friendly popup with the fun fact
      const popupContent = `
        <div class="joke-display">
          <div class="joke-icon" style="font-size: 64px;">${fact.icon}</div>
          <div class="joke-text">
            <p class="joke-question" style="font-size: 24px; line-height: 1.5;">${fact.fact}</p>
            <p class="joke-answer" style="opacity: 0; transition: opacity 0.5s ease-in; color: #10b981; font-size: 22px; margin-top: 20px;">${fact.question}</p>
          </div>
        </div>
      `;
      
      this.createInfoPopup('Farm Fact', popupContent);
      
      // Show question after 4 seconds
      setTimeout(() => {
        const answerElement = document.querySelector('.joke-answer');
        if (answerElement) {
          answerElement.style.opacity = '1';
        }
      }, 4000);
      
      this.addMessage(`Here's an interesting farm fact.`, 'assistant', null, true);
      return true;
    }
    
    return false;
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('farmAssistantHistory');
      if (saved) {
        this.conversationHistory = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load assistant history:', e);
    }
  }

  saveHistory() {
    try {
      // Keep last 50 messages
      const toSave = this.conversationHistory.slice(-50);
      localStorage.setItem('farmAssistantHistory', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Failed to save assistant history:', e);
    }
  }

  // ── WebSocket Client ─────────────────────────────────────────────────────
  _initWebSocket() {
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('jwt') || localStorage.getItem('token') || sessionStorage.getItem('token');
      if (!token) { console.debug('[E.V.I.E. WS] No auth token — skipping WebSocket'); return; }

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const configuredUrl = String(window.EVIE_WS_URL || '').trim();
      const configuredPort = String(window.EVIE_WS_PORT || '').trim();
      const isCentralHost = /greenreach-central|greenreachgreens\.com$/i.test(location.hostname);

      let wsBase = '';
      if (configuredUrl) {
        wsBase = configuredUrl.replace(/\/$/, '');
      } else if (configuredPort) {
        wsBase = `${proto}//${location.hostname}:${configuredPort}`;
      } else if (isCentralHost) {
        wsBase = `${proto}//${location.host}`;
      } else {
        console.debug('[E.V.I.E. WS] Realtime endpoint not configured for this host — skipping WebSocket');
        return;
      }

      const joinChar = wsBase.includes('?') ? '&' : '?';
      const url = `${wsBase}${joinChar}token=${encodeURIComponent(token)}`;

      this._ws = new WebSocket(url);

      this._ws.onopen = () => {
        console.debug('[E.V.I.E. WS] Connected');
        // Subscribe to current farm
        if (window.FARM_ID) {
          this._ws.send(JSON.stringify({ type: 'subscribe', farmId: window.FARM_ID }));
        }
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleWsEvent(data);
        } catch { /* ignore malformed */ }
      };

      this._ws.onclose = () => {
        console.debug('[E.V.I.E. WS] Disconnected — reconnecting in 10s');
        setTimeout(() => this._initWebSocket(), 10_000);
      };

      this._ws.onerror = (err) => {
        console.warn('[E.V.I.E. WS] Error:', err);
      };
    } catch (err) {
      console.warn('[E.V.I.E. WS] Init failed:', err.message);
    }
  }

  _handleWsEvent(data) {
    if (data.type === 'connection' || data.type === 'subscribed') return; // Handshake

    if (data.type === 'evie_alert') {
      const severityClass = data.alert_type === 'critical' ? 'alert-critical'
        : data.alert_type === 'warning' ? 'alert-warning' : '';
      const icon = data.alert_type === 'critical' ? '🚨'
        : data.alert_type === 'predictive' ? '🔮' : '⚠️';

      const html = `<div class="evie-ws-alert ${severityClass}">
        <span>${icon}</span>
        <div>
          <strong>${data.message || 'Environmental alert'}</strong>
          ${data.suggestion ? `<br><small>${data.suggestion}</small>` : ''}
        </div>
      </div>`;

      this.addMessage(html);

      // Speak critical alerts
      if (data.alert_type === 'critical' && this.voiceEnabled) {
        this.speak(data.message);
      }
    }
  }

  // ── Voice-First Mode (Wake Word) ─────────────────────────────────────────
  _initWakeWord() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.debug('[E.V.I.E.] Wake word unavailable — no SpeechRecognition API');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._wakeRecognition = new SpeechRecognition();
    this._wakeRecognition.continuous = true;
    this._wakeRecognition.interimResults = true;
    this._wakeRecognition.lang = 'en-US';

    this._wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        // Detect wake phrase "hey evie"
        if (transcript.includes('hey evie') || transcript.includes('hey e.v.i.e') || transcript.includes('hey ivy')) {
          if (!this._wakeWordActive) {
            this._activateWakeWord();
          }
        } else if (this._wakeWordActive && event.results[i].isFinal) {
          // We're in active listening mode — treat final transcript as a command
          const command = transcript.replace(/hey\s*(evie|e\.v\.i\.e|ivy)/gi, '').trim();
          if (command.length > 2) {
            this._wakeWordActive = false;
            this._updateWakeIndicator(false);
            // Stop TTS if speaking
            if (this.isSpeaking) { window.speechSynthesis?.cancel(); this.isSpeaking = false; }
            // Process the voice command
            this.addMessage(command, 'user');
            this.setTypingIndicator(true);
            this.processQuery(command);
          }
        }
      }
    };

    this._wakeRecognition.onend = () => {
      // Auto-restart for continuous wake word listening
      if (!this.isListening) {
        try { this._wakeRecognition.start(); } catch { /* already running */ }
      }
    };

    this._wakeRecognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[E.V.I.E. Wake] Recognition error:', e.error);
      }
    };

    // Start passive listening for wake word
    try {
      this._wakeRecognition.start();
      console.debug('[E.V.I.E.] Wake word detection active — say "Hey EVIE"');
    } catch (err) {
      console.warn('[E.V.I.E.] Wake word start failed:', err.message);
    }
  }

  _activateWakeWord() {
    this._wakeWordActive = true;
    this._updateWakeIndicator(true);
    // Play a subtle chime / vibration feedback
    if (navigator.vibrate) navigator.vibrate(100);
    // Auto-deactivate after 8 seconds of no command
    this._wakeTimeout = setTimeout(() => {
      this._wakeWordActive = false;
      this._updateWakeIndicator(false);
    }, 8000);
  }

  _updateWakeIndicator(active) {
    const indicator = document.getElementById('evieWakeIndicator');
    if (!indicator) return;
    if (active) {
      indicator.classList.add('listening');
    } else {
      indicator.classList.remove('listening');
    }
  }
}

// Auto-initialize when DOM is ready — skip when loaded inside an iframe
(function() {
  try {
    if (window.self !== window.top) {
      console.debug('[Farm Assistant] Skipping — running inside iframe');
      return;
    }
  } catch (e) {
    // Cross-origin iframe — skip initialization
    console.debug('[Farm Assistant] Skipping — cross-origin iframe');
    return;
  }
  console.debug('[Farm Assistant] Script loaded. DOM state:', document.readyState);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.debug('[Farm Assistant] DOM loaded, creating instance...');
      window.farmAssistant = new FarmAssistant();
    });
  } else {
    console.debug('[Farm Assistant] DOM already loaded, creating instance immediately...');
    window.farmAssistant = new FarmAssistant();
  }
})();
