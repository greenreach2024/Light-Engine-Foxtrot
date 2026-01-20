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
    this.jokes = [
      {
        type: 'joke',
        question: 'Why did the tomato turn red?',
        answer: 'Because it saw the salad dressing!'
      },
      {
        type: 'joke',
        question: 'What do you get when you cross a snowman and a dog?',
        answer: 'Frostbite!'
      },
      {
        type: 'joke',
        question: "Why don't eggs tell jokes?",
        answer: "They'd crack each other up."
      },
      {
        type: 'joke',
        question: "What do you call cheese that isn't yours?",
        answer: 'Nacho cheese!'
      },
      {
        type: 'joke',
        question: 'Why did the banana go to the doctor?',
        answer: "Because it wasn't peeling well."
      },
      {
        type: 'joke',
        question: 'What do you call a bear with no teeth?',
        answer: 'A gummy bear.'
      },
      {
        type: 'joke',
        question: 'Why did the bicycle fall over?',
        answer: 'Because it was two-tired.'
      },
      {
        type: 'joke',
        question: "What do you call a dinosaur that's sleeping?",
        answer: 'A dino-snore.'
      },
      {
        type: 'riddle',
        question: "I'm full of holes but I can still hold water. What am I?",
        answer: 'A sponge.'
      },
      {
        type: 'riddle',
        question: 'The more you take, the more you leave behind. What are they?',
        answer: 'Footsteps.'
      },
      {
        type: 'riddle',
        question: 'I can fly without wings. I can cry without eyes. Wherever I go, darkness follows me. What am I?',
        answer: 'A cloud.'
      },
      {
        type: 'riddle',
        question: 'I have a face and two hands, but no arms or legs. What am I?',
        answer: 'A clock.'
      },
      {
        type: 'riddle',
        question: 'What has to be broken before you can use it?',
        answer: 'An egg.'
      }
    ];
    this.funFacts = [
      {
        fact: "Want to be an astronaut—would you try a 'space salad'? Astronauts have grown leafy greens in NASA's Veggie system on the International Space Station—and they've even eaten space-grown lettuce!",
        question: 'If you could grow one food in space, what would you pick?',
        icon: '🚀'
      },
      {
        fact: "What if your plants had a robot babysitter—would that be cool? NASA's Advanced Plant Habitat is like a super-smart space greenhouse with 180+ sensors watching things like humidity, oxygen, and moisture.",
        question: 'If you could add ONE "plant sensor power," what would it measure?',
        icon: '🤖'
      },
      {
        fact: "Want to live on the Moon—how would you get fresh food? That's one reason NASA studies plant-growing systems in space: learning how to grow food when you can't just run to a grocery store.",
        question: 'What do you think would be the hardest part—light, water, or space?',
        icon: '🌙'
      },
      {
        fact: 'Would you garden in the coldest place on Earth? In Antarctica, the EDEN ISS greenhouse has grown lots of fresh foods (like lettuce, cucumbers, tomatoes, herbs—and more).',
        question: 'If you had an Antarctic greenhouse, what would you name it?',
        icon: '❄️'
      },
      {
        fact: 'Would you eat greens grown in a tunnel under a city? In London, an underground hydroponic farm grows plants without sunlight, using LED lights in old tunnels.',
        question: 'If you found a secret farm underground, what would you hope they\'re growing?',
        icon: '🚇'
      },
      {
        fact: "Could fog help grow lettuce in a desert—like magic? In Chile's Atacama Desert, people have used fog-catching nets to collect water and grow crops (including lettuce) using hydroponics.",
        question: 'If you could "catch" water from the air, where would you put your fog net?',
        icon: '🌫️'
      }
    ];
    this.init();
    this.initVoiceRecognition();
    this.initTextToSpeech();
  }

  init() {
    this.createWidget();
    this.attachEventListeners();
    this.loadHistory();
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
    console.log('[Farm Assistant] Initializing widget...');
    const widget = document.createElement('div');
    widget.id = 'farm-assistant';
    widget.innerHTML = `
      <div class="assistant-container minimized">
        <div class="assistant-header">
          <div class="header-content">
            <img src="/images/cheo-mascot.svg" alt="Cheo" class="assistant-mascot-thumb" />
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
              <img src="/images/cheo-mascot.svg" alt="Cheo the Farm Assistant" class="mascot-image" />
              <div class="welcome-text">
                <strong>Hi I'm Cheo, your farm Assistant!</strong>
                <strong class="love-to-help">I love to help!</strong>
                <div class="example-queries">
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('What\\'s ready to harvest?')">What's ready to harvest?</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Show me the temperature')">Show me the temperature</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Where is the lettuce?')">Where is the lettuce?</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Fun fact!')">Fun Fact!</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Tell me a joke')">Tell me a joke</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Blink lights for basil')">Blink lights for basil</button>
                  <button class="example-btn" onclick="window.farmAssistant.handleExampleQuery('Show planting schedule')">Show planting schedule</button>
                </div>
                <strong>Or type your own question below!</strong>
              </div>
            </div>
          </div>
          
          <div class="chat-input-container">
            <button id="voiceBtn" class="voice-btn" title="Voice command">
              <span class="voice-icon">🎤</span>
            </button>
            <input 
              type="text" 
              id="assistantInput" 
              placeholder="Ask me anything or click 🎤..."
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
    console.log('[Farm Assistant] Widget appended to body. Element:', widget);
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
      console.log('🎤 Voice recognition started');
    };

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log('🎤 Heard:', transcript);
      
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
        this.addMessage('🎤 Microphone access denied. Please allow microphone access in your browser settings.', 'assistant');
      } else if (event.error === 'no-speech') {
        this.addMessage('🎤 No speech detected. Try again!', 'assistant');
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateVoiceButton();
      console.log('🎤 Voice recognition ended');
    };
  }

  initTextToSpeech() {
    // ResponsiveVoice will be loaded via script tag in HTML
    // Check if either ResponsiveVoice or browser speech synthesis is available
    if (window.responsiveVoice) {
      console.log('🔊 ResponsiveVoice detected - using high-quality voices');
      this.voiceEnabled = true;
      
      // Log available ResponsiveVoice voices
      if (window.responsiveVoice.getVoices) {
        const voices = window.responsiveVoice.getVoices();
        console.log('🔊 ResponsiveVoice voices:', voices.map(v => v.name).join(', '));
      }
    } else if (window.speechSynthesis) {
      console.log('🔊 Using browser Web Speech API (fallback)');
      this.voiceEnabled = true;
      this.voices = [];
      
      // Load voices for fallback
      const loadVoices = () => {
        this.voices = window.speechSynthesis.getVoices();
        console.log('🔊 Browser voices loaded:', this.voices.length);
      };
      
      loadVoices();
      
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    } else {
      console.warn('🔊 Text-to-speech not supported in this browser');
      this.voiceEnabled = false;
    }
    
    console.log('🔊 Text-to-speech initialized, voiceEnabled:', this.voiceEnabled);
  }

  speak(text) {
    console.log('🔊 speak() called with:', text.substring(0, 50) + '...');
    
    if (!this.voiceEnabled) {
      console.warn('🔊 Voice disabled');
      return;
    }

    // Check if ResponsiveVoice is available (better quality)
    if (window.responsiveVoice) {
      console.log('🔊 Using ResponsiveVoice');
      
      // Cancel any ongoing speech
      if (window.responsiveVoice.isPlaying()) {
        window.responsiveVoice.cancel();
      }
      
      // Use a child-friendly voice
      // Options: "UK English Female", "US English Female", "Australian Female"
      const voiceName = "UK English Female"; // British accent is friendly for kids
      
      const options = {
        pitch: 1.2,      // Slightly higher for friendlier sound
        rate: 0.85,      // Slower for children to understand
        volume: 1.0,
        onstart: () => {
          this.isSpeaking = true;
          console.log('🔊 ✅ ResponsiveVoice speaking started:', text.substring(0, 30) + '...');
        },
        onend: () => {
          this.isSpeaking = false;
          console.log('🔊 ✅ ResponsiveVoice speech ended');
        },
        onerror: (error) => {
          console.error('🔊 ❌ ResponsiveVoice error:', error);
          this.isSpeaking = false;
        }
      };
      
      window.responsiveVoice.speak(text, voiceName, options);
      return;
    }
    
    // Fallback to browser's Web Speech API
    console.log('🔊 Using browser Web Speech API (fallback)');
    
    if (!window.speechSynthesis) {
      console.warn('🔊 Text-to-speech not supported');
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    // Create speech utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice settings for child-friendly sound
    utterance.rate = 0.85;
    utterance.pitch = 1.3;
    utterance.volume = 1.0;
    
    const voices = this.voices && this.voices.length > 0 ? this.voices : window.speechSynthesis.getVoices();
    
    if (voices.length > 0) {
      const preferredVoice = voices.find(v => 
        v.name.includes('Samantha') ||
        v.name.includes('Karen') ||
        v.name.includes('Google UK English Female') ||
        v.name.includes('Google US English Female') ||
        (v.name.toLowerCase().includes('female') && v.lang.startsWith('en'))
      );
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        console.log('🔊 Using voice:', preferredVoice.name);
      }
    }

    utterance.onstart = () => {
      this.isSpeaking = true;
      console.log('🔊 ✅ Speaking started');
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      console.log('🔊 ✅ Speech ended');
    };

    utterance.onerror = (event) => {
      console.error('🔊 ❌ Speech error:', event.error);
      this.isSpeaking = false;
    };

    // Speak the text
    console.log('🔊 Calling speechSynthesis.speak()');
    window.speechSynthesis.speak(utterance);
  }

  toggleVoiceRecognition() {
    if (!this.recognition) {
      this.addMessage('🎤 Voice commands are not supported in your browser. Try Chrome, Edge, or Safari!', 'assistant');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
        this.addMessage('🎤 Listening... Speak now!', 'assistant');
      } catch (error) {
        console.error('Failed to start voice recognition:', error);
        this.addMessage('🎤 Could not start microphone. Please try again.', 'assistant');
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
      `🤔 I'm not sure about that one! Here are some fun things to try:
      <ul>
        <li>🌱 "What's ready to harvest?"</li>
        <li>🌡️ "Show me the temperature"</li>
        <li>🥬 "Do we have lettuce?"</li>
        <li>💡 "Blink lights for basil"</li>
        <li>📅 "Show planting schedule"</li>
      </ul>`
    );
  }

  matchNavigation(query) {
    // Simplified navigation - just check if query contains ANY keyword
    const navPatterns = [
      { keywords: ['planting', 'schedule', 'calendar', 'plan'], url: '/views/planting-scheduler.html', name: 'Planting Schedule', emoji: '📅' },
      { keywords: ['tray', 'seed', 'seeding'], url: '/views/tray-inventory.html', name: 'Tray Inventory', emoji: '🌱' },
      { keywords: ['dashboard', 'home', 'main', 'summary'], url: '/views/farm-summary.html', name: 'Farm Dashboard', emoji: '🏠' },
      { keywords: ['wholesale', 'buyer'], url: '/GR-wholesale.html', name: 'Wholesale Portal', emoji: '📦' },
      { keywords: ['sales', 'pos', 'sell', 'store'], url: '/Farmsales-pos.html', name: 'POS Terminal', emoji: '💰' },
      { keywords: ['heatmap', 'map', 'temps'], url: '/views/room-heatmap.html', name: 'Temperature Heatmap', emoji: '🗺️' },
      { keywords: ['inventory', 'crops', 'plants'], url: '/views/farm-inventory.html', name: 'Crop Inventory', emoji: '🥬' },
      { keywords: ['admin', 'settings'], url: '/GR-central-admin.html', name: 'Central Admin', emoji: '⚙️' }
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
      const response = await fetch(`${API_BASE}/env`);
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
              <p class="harvest-message">Today we have:</p>
              <p class="harvest-crops">${cropList}</p>
              <p class="harvest-count">${readyToHarvest.length} trays ready to pick!</p>
            </div>
          </div>
        `;
        
        this.createInfoPopup('Ready to Harvest!', popupContent);
        this.addMessage(`We have ${cropNames.length} types of crops ready today! 🌾`, 'assistant');
      } else if (soonToHarvest.length > 0) {
        const cropNames = [...new Set(soonToHarvest.map(item => item.crop))];
        let popupContent = `
          <div class="harvest-list">
            <div class="harvest-icon">🌱</div>
            <div class="harvest-text">
              <p class="harvest-message">Coming soon:</p>
              <p class="harvest-crops">${cropNames.join(', ')}</p>
              <p class="harvest-count">Will be ready in 1-2 days!</p>
            </div>
          </div>
        `;
        
        this.createInfoPopup('Almost Ready!', popupContent);
        this.addMessage('These crops will be ready very soon! 🌱', 'assistant');
      } else {
        this.addMessage('No crops are ready for harvest right now. Check back tomorrow! 🌱', 'assistant');
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
      const response = await fetch(`${API_BASE}/env`);
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
          popupContent += '<div class="status-message success">✅ Perfect conditions! Everything looks great!</div>';
        } else if (avgTemp < 18 || avgTemp > 29) {
          popupContent += '<div class="status-message warning">⚠️ Temperature needs attention</div>';
        } else {
          popupContent += '<div class="status-message ok">Conditions look good!</div>';
        }
        
        this.createInfoPopup('Farm Weather', popupContent);
        this.addMessage('Here\'s the current weather! 🌞', 'assistant');
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
      const response = await fetch(`${API_BASE}/env`);
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
          
          this.createInfoPopup(`Found ${cropName}!`, popupContent);
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
      const response = await fetch(`${API_BASE}/env`);
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
      const response = await fetch(`${API_BASE}/env`);
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
          this.addMessage(`✨ Blinking lights for <strong>${found.name}</strong>! The lights will flash for 10 seconds.`, 'assistant',
            `<button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">View on Heatmap</button>`
          );
        } else {
          this.addMessage(`Found <strong>${found.name}</strong>, but hardware control is not available in demo mode. In production, lights would blink!`, 'assistant',
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
          let message = `<strong>⚠️ Found ${data.anomalies.length} alert(s):</strong><ul>`;
          data.anomalies.slice(0, 3).forEach(alert => {
            message += `<li><strong>${alert.severity}:</strong> ${alert.reason} (${alert.zone})</li>`;
          });
          message += `</ul>`;
          
          this.addMessage(message, 'assistant',
            `<button onclick="window.location.href='/views/farm-summary.html'" class="action-btn primary">View All Alerts</button>`
          );
        } else {
          this.addMessage('✅ No alerts! Everything looks good.', 'assistant',
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
        <strong>🎯 Here's what I can do for you:</strong>
        <ul>
          <li><strong>🌱 Harvest Info:</strong><br>"What's ready to harvest?", "Ready crops today"</li>
          <li><strong>🌡️ Environment:</strong><br>"Show temperature", "What's the humidity?"</li>
          <li><strong>🥬 Find Crops:</strong><br>"Where is the basil?", "Do we have lettuce?"</li>
          <li><strong>💡 Hardware Control:</strong><br>"Blink lights for romaine", "Identify zone A"</li>
          <li><strong>📊 Farm Status:</strong><br>"How is the farm?", "Any alerts?"</li>
          <li><strong>🗺️ Navigation:</strong><br>"Show planting schedule", "Open wholesale"</li>
        </ul>
        <br><em>💡 Tip: Just ask naturally - I understand many ways of asking the same thing!</em>
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
      
      this.createInfoPopup(item.type === 'riddle' ? 'Riddle Time! 🧩' : 'Joke Time! 😄', popupContent);
      
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
      
      this.createInfoPopup('Amazing Farm Fact! 🌱', popupContent);
      
      // Show question after 4 seconds
      setTimeout(() => {
        const answerElement = document.querySelector('.joke-answer');
        if (answerElement) {
          answerElement.style.opacity = '1';
        }
      }, 4000);
      
      this.addMessage(`Here's an amazing farm fact! 🌟`, 'assistant');
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

// Auto-initialize when DOM is ready
console.log('[Farm Assistant] Script loaded. DOM state:', document.readyState);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Farm Assistant] DOM loaded, creating instance...');
    window.farmAssistant = new FarmAssistant();
  });
} else {
  console.log('[Farm Assistant] DOM already loaded, creating instance immediately...');
  window.farmAssistant = new FarmAssistant();
}
