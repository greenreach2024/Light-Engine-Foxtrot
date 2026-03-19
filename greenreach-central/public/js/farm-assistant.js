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
    this.voiceEnabled = true;
    this.jokes = [];
    this.funFacts = [];
    this.init();
    this.initVoiceRecognition();
    this.initTextToSpeech();
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
    const greeted = localStorage.getItem('cheo_greeted');
    if (greeted) return;  // Already shown

    setTimeout(async () => {
      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('token') || '';
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/setup/onboarding-status', { headers });
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
        } else {
          const nextItems = incomplete.slice(0, 3).map(t => `${t.icon || '○'} ${t.label}`).join('<br>');
          this.addMessage(
            `<strong>Welcome to GreenReach Central.</strong><br>
            You've completed <strong>${done} of ${total}</strong> setup tasks.
            <br><br><strong>Recommended next:</strong><br>${nextItems}
            <br><br>Each step builds on the last. Type <em>"what should I do next"</em> anytime to pick up where you left off.`
          );
        }

        localStorage.setItem('cheo_greeted', Date.now().toString());
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
    const hintKey = `cheo_hint_${page.replace(/\s+/g, '_').toLowerCase()}`;
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
            <img src="/images/cheo-mascot.svg?v=20260304" alt="Cheo" class="assistant-mascot-thumb" />
            <div class="header-text">
              <strong>Farm Assistant</strong>
              <small>${this.currentContext.page}</small>
            </div>
          </div>
          <button class="minimize-btn" id="minimizeBtn">
            <span class="minimize-icon">+</span>
          </button>
        </div>
        
        <div class="assistant-body">
          <div class="chat-messages" id="chatMessages">
            <div class="mascot-welcome">
              <img src="/images/cheo-mascot.svg?v=20260304" alt="Cheo the Farm Assistant" class="mascot-image" />
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

    sendBtn.addEventListener('click', () => this.handleUserInput());
    voiceBtn.addEventListener('click', () => this.toggleVoiceRecognition());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleUserInput();
    });
    
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
    const ttsVoice = window.FARM_ASSISTANT_TTS_VOICE || 'echo';
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 2000), voice: ttsVoice })
    })
      .then(res => {
        if (!res.ok) throw new Error('TTS ' + res.status);
        return res.arrayBuffer();
      })
      .then(buf => {
        // Keep a copy for fallback since decodeAudioData detaches the buffer.
        this._lastTtsBuf = buf.slice(0);
        return this._playViaWebAudio(buf, text);
      })
      .catch(err => {
        console.warn('[TTS] Error:', err.message, '-- falling back to browser speech');
        this._speakBrowser(text);
      });
  }

  // Play audio buffer through Web Audio API (bypasses autoplay blocking).
  _playViaWebAudio(arrayBuffer, fallbackText) {
    const ctx = this._audioCtx;
    if (!ctx) {
      console.warn('[TTS] No AudioContext -- trying HTML Audio');
      return this._playViaHtmlAudio(this._lastTtsBuf || arrayBuffer, fallbackText);
    }
    return ctx.resume().then(() => {
      return ctx.decodeAudioData(arrayBuffer);
    }).then(audioBuffer => {
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

  // Browser Web Speech API fallback.
  _speakBrowser(text) {
    if (!window.speechSynthesis) { this.isSpeaking = false; return; }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = this.voices && this.voices.length > 0 ? this.voices : window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const preferred = voices.find(v =>
        v.name.includes('Samantha') ||
        v.name.includes('Google US English') ||
        v.name.includes('Microsoft Aria') ||
        (v.lang.startsWith('en') && v.name.toLowerCase().includes('natural'))
      ) || voices.find(v => v.lang.startsWith('en'));
      if (preferred) utterance.voice = preferred;
    }

    utterance.onend = () => { this.isSpeaking = false; };
    utterance.onerror = () => { this.isSpeaking = false; };
    window.speechSynthesis.speak(utterance);
    console.log('[TTS] Playing via browser speech synthesis');
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
    icon.textContent = this.isMinimized ? '+' : '−';
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

  addMessage(content, type = 'assistant', actions = null) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const avatar = type === 'user' ? 'You' : 'AI';
    
    messageDiv.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        ${content}
        ${actions ? `<div class="message-actions">${actions}</div>` : ''}
      </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Save to history
    this.conversationHistory.push({ content, type, timestamp: Date.now() });
    this.saveHistory();
    
    // Speak assistant messages aloud (text-to-speech for children)
    if (type === 'assistant' && this.voiceEnabled) {
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

  async processQuery(query) {
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
      const planType = localStorage.getItem('plan_type') || 'cloud';
      if (planType === 'edge') {
        this.addMessage(`⚡ <strong>You're on the Edge plan</strong> — that's the full hardware suite. You have light control, environment management, nutrient dosing, and auto-discovery all active. Every feature in the platform is available to you.`);
      } else {
        this.addMessage(
          `☁️ <strong>You're currently on the Cloud plan.</strong><br>Cloud gives you inventory, store, POS, wholesale, and environment monitoring. Upgrading to <strong>Edge</strong> adds direct hardware control — automated light recipes, nutrient dosing, and auto-discovery of controllers on your farm network. Edge requires a reTerminal device on-site.`,
          'assistant',
          `<button onclick="window.open('/purchase.html?upgrade=edge','_self')" class="action-btn primary">Learn about Edge</button>`
        );
      }
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

      const response = await fetch('/api/setup/onboarding-status', { headers });
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
        const temps = data.zones.map(z => {
          const tempC = parseFloat(z.sensors?.tempC?.current || 0);
          return tempC; // Keep in Celsius
        });
        const humidities = data.zones.map(z => parseFloat(z.sensors?.rh?.current || 0));
        
        const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
        const minTemp = Math.min(...temps).toFixed(1);
        const maxTemp = Math.max(...temps).toFixed(1);
        
        const avgHumidity = (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(0);
        const minHumidity = Math.min(...humidities).toFixed(0);
        const maxHumidity = Math.max(...humidities).toFixed(0);
        
        // Determine what user asked for
        const wantsTemp = /temp|temperature|hot|cold|warm/i.test(query);
        const wantsHumidity = /humidity|humid/i.test(query);
        
        // Create child-friendly popup content
        let popupContent = '<div class="big-info">';
        
        if (wantsTemp || (!wantsTemp && !wantsHumidity)) {
          popupContent += `
            <div class="info-item">
              <div class="info-icon">🌡️</div>
              <div class="info-label">Temperature</div>
              <div class="info-value">${avgTemp}°C</div>
            </div>
          `;
        }
        
        if (wantsHumidity || (!wantsTemp && !wantsHumidity)) {
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
        if (avgTemp >= 20 && avgTemp <= 26 && avgHumidity >= 50 && avgHumidity <= 70) {
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
        const avgTemp = (data.zones.reduce((sum, z) => sum + parseFloat(z.sensors?.tempC?.current || 0), 0) / data.zones.length).toFixed(1);
        const avgHumidity = (data.zones.reduce((sum, z) => sum + parseFloat(z.sensors?.rh?.current || 0), 0) / data.zones.length).toFixed(0);
        
        message += `<li>🌡️ Average Temperature: ${avgTemp}°C</li>`;
        message += `<li>💧 Average Humidity: ${avgHumidity}%</li>`;
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
      
      this.addMessage(`Here's a ${item.type === 'riddle' ? 'riddle' : 'joke'} for you!`, 'assistant');
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
      
      this.addMessage(`Here's an interesting farm fact.`, 'assistant');
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
