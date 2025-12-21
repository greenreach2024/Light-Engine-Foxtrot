/**
 * Farm Assistant - AI-powered helper with pattern matching
 * Helps users navigate, query data, and control hardware
 */

class FarmAssistant {
  constructor() {
    this.isMinimized = false;
    this.conversationHistory = [];
    this.currentContext = this.detectContext();
    this.init();
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
    const widget = document.createElement('div');
    widget.id = 'farm-assistant';
    widget.innerHTML = `
      <div class="assistant-container">
        <div class="assistant-header">
          <div class="header-content">
            <span class="assistant-icon">🤖</span>
            <div class="header-text">
              <strong>Farm Assistant</strong>
              <small>${this.currentContext.page}</small>
            </div>
          </div>
          <button class="minimize-btn" id="minimizeBtn">
            <span class="minimize-icon">−</span>
          </button>
        </div>
        
        <div class="assistant-body">
          <div class="chat-messages" id="chatMessages">
            <div class="message assistant-message">
              <div class="message-avatar">🤖</div>
              <div class="message-content">
                Hi! 👋 I'm your Farm Assistant. Ask me anything!
                <ul style="margin-top:0.5rem;">
                  <li>🌱 "What's ready to harvest?"</li>
                  <li>🌡️ "Show me the temperature"</li>
                  <li>🥬 "Where is the lettuce?"</li>
                  <li>💡 "Blink lights for basil"</li>
                  <li>📅 "Show planting schedule"</li>
                </ul>
                Try typing a question below! 😊
              </div>
            </div>
          </div>
          
          <div class="chat-input-container">
            <input 
              type="text" 
              id="assistantInput" 
              placeholder="Ask me anything..."
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
  }

  attachEventListeners() {
    const input = document.getElementById('assistantInput');
    const sendBtn = document.getElementById('sendBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');

    sendBtn.addEventListener('click', () => this.handleUserInput());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleUserInput();
    });
    
    minimizeBtn.addEventListener('click', () => this.toggleMinimize());
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

  addMessage(content, type = 'assistant', actions = null) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const avatar = type === 'user' ? '👤' : '🤖';
    
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
  }

  async processQuery(query) {
    const lowerQuery = query.toLowerCase();
    
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
    const navPatterns = [
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['planting', 'schedule', 'calendar'], url: '/views/planting-scheduler.html', name: 'Planting Schedule', emoji: '📅' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['tray', 'trays', 'seeding'], url: '/views/tray-inventory.html', name: 'Tray Inventory', emoji: '🌱' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['farm', 'summary', 'dashboard', 'home'], url: '/views/farm-summary.html', name: 'Farm Dashboard', emoji: '🏠' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['wholesale', 'buyers'], url: '/wholesale.html', name: 'Wholesale Portal', emoji: '📦' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['sales', 'pos', 'terminal', 'sell'], url: '/farm-sales.html', name: 'POS Terminal', emoji: '💰' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['heatmap', 'temperature', 'map', 'temps'], url: '/views/room-heatmap.html', name: 'Temperature Heatmap', emoji: '🗺️' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['inventory', 'crops', 'plants'], url: '/views/farm-inventory.html', name: 'Crop Inventory', emoji: '🥬' },
      { pattern: /show|open|go to|navigate to|view|take me to/i, keywords: ['central', 'admin', 'platform', 'settings'], url: '/central-admin.html', name: 'Central Admin', emoji: '⚙️' }
    ];

    for (const nav of navPatterns) {
      if (nav.pattern.test(query) && nav.keywords.some(kw => query.includes(kw))) {
        const actions = `<button onclick="window.location.href='${nav.url}'" class="action-btn primary">Open ${nav.name} ${nav.emoji}</button>`;
        this.addMessage(`Opening <strong>${nav.name}</strong>... ${nav.emoji}`, 'assistant', actions);
        setTimeout(() => window.location.href = nav.url, 1500);
        return true;
      }
    }
    
    return false;
  }

  async matchHarvestQuery(query) {
    const harvestPatterns = [
      /what('s| is) ready (to harvest|for harvest|today)/i,
      /ready (to harvest|for harvest|crops|today)/i,
      /harvest (ready|today|now)/i,
      /can (i|we) harvest/i,
      /show (me )?(ready|harvest)/i
    ];

    if (harvestPatterns.some(pattern => pattern.test(query))) {
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
        let message = `<strong>🎉 Ready to Harvest Today!</strong><ul>`;
        readyToHarvest.forEach(item => {
          message += `<li><strong>${item.crop}</strong> in ${item.zone} - ${item.trays} trays ready! 🌱</li>`;
        });
        message += `</ul>`;
        
        if (soonToHarvest.length > 0) {
          message += `<br><strong>Coming Soon:</strong><ul>`;
          soonToHarvest.forEach(item => {
            message += `<li>${item.crop} in ${item.zone} - ${item.harvestIn} days</li>`;
          });
          message += `</ul>`;
        }
        
        const actions = `
          <button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View All Crops</button>
          <button onclick="window.location.href='/views/planting-scheduler.html'" class="action-btn">View Schedule</button>
        `;
        
        this.addMessage(message, 'assistant', actions);
      } else if (soonToHarvest.length > 0) {
        let message = `<strong>Nothing ready today, but soon! 🌱</strong><ul>`;
        soonToHarvest.forEach(item => {
          message += `<li><strong>${item.crop}</strong> in ${item.zone} - ${item.harvestIn} days to go</li>`;
        });
        message += `</ul>`;
        
        this.addMessage(message, 'assistant',
          `<button onclick="window.location.href='/views/planting-scheduler.html'" class="action-btn">View Full Schedule</button>`
        );
      } else {
        this.addMessage(`No crops are currently ready to harvest. Check the planting schedule to see what's coming! 📅`, 'assistant',
          `<button onclick="window.location.href='/views/planting-scheduler.html'" class="action-btn primary">View Schedule</button>`
        );
      }
    } catch (error) {
      console.error('Harvest check error:', error);
      this.addMessage('I had trouble checking harvest status. Let me take you to the inventory page.', 'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View Inventory</button>`
      );
    }
  }

  async matchEnvironmentQuery(query) {
    const envPatterns = [
      /what('s| is) the (temp|temperature|humidity)/i,
      /show (me )?(temp|temperature|humidity|conditions|environment)/i,
      /(temp|temperature|humidity) (in|of) (the )?farm/i,
      /how (hot|cold|humid|warm)/i,
      /(current|farm) (conditions|climate|environment)/i
    ];

    if (envPatterns.some(pattern => pattern.test(query))) {
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
        const temps = data.zones.map(z => parseFloat(z.temperature || 0));
        const humidities = data.zones.map(z => parseFloat(z.humidity || 0));
        
        const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
        const minTemp = Math.min(...temps).toFixed(1);
        const maxTemp = Math.max(...temps).toFixed(1);
        
        const avgHumidity = (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(0);
        const minHumidity = Math.min(...humidities).toFixed(0);
        const maxHumidity = Math.max(...humidities).toFixed(0);
        
        // Determine what user asked for
        const wantsTemp = /temp|temperature|hot|cold|warm/i.test(query);
        const wantsHumidity = /humidity|humid/i.test(query);
        
        let message = '<strong>🌡️ Farm Environment:</strong><ul>';
        
        if (wantsTemp || (!wantsTemp && !wantsHumidity)) {
          message += `<li><strong>Temperature:</strong> ${avgTemp}°F average`;
          if (maxTemp - minTemp > 3) {
            message += ` (${minTemp}°F - ${maxTemp}°F across zones)`;
          }
          message += `</li>`;
        }
        
        if (wantsHumidity || (!wantsTemp && !wantsHumidity)) {
          message += `<li><strong>Humidity:</strong> ${avgHumidity}% average`;
          if (maxHumidity - minHumidity > 10) {
            message += ` (${minHumidity}% - ${maxHumidity}% across zones)`;
          }
          message += `</li>`;
        }
        
        message += `<li><strong>Active Zones:</strong> ${data.zones.length} zones monitored</li>`;
        message += `</ul>`;
        
        // Add comfort assessment
        if (avgTemp >= 68 && avgTemp <= 78 && avgHumidity >= 50 && avgHumidity <= 70) {
          message += `<br>✅ <strong>Perfect conditions!</strong> Everything looks great!`;
        } else if (avgTemp < 65 || avgTemp > 85) {
          message += `<br>⚠️ <strong>Temperature alert:</strong> Check climate control`;
        }
        
        const actions = `
          <button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn primary">View Heatmap</button>
          <button onclick="window.location.href='/views/farm-summary.html'" class="action-btn">Dashboard</button>
        `;
        
        this.addMessage(message, 'assistant', actions);
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
        
        let message = `<strong>🌱 Found ${found.length} ${cropName} location${found.length > 1 ? 's' : ''}!</strong><ul>`;
        found.forEach(item => {
          message += `<li><strong>${item.zone}</strong> - ${item.group}: ${item.trays} tray${item.trays !== 1 ? 's' : ''}`;
          if (item.harvestIn !== undefined) {
            if (item.harvestIn <= 0) {
              message += ` 🎉 <strong>Ready to harvest!</strong>`;
            } else if (item.harvestIn <= 3) {
              message += ` (${item.harvestIn} days until harvest 🌱)`;
            } else {
              message += ` (${item.harvestIn} days to go)`;
            }
          } else if (item.daysOld !== undefined) {
            message += ` (${item.daysOld} days old)`;
          }
          message += `</li>`;
        });
        message += `</ul>`;
        
        // Create action buttons based on query type
        let actions = '';
        if (isLocateQuery && found.length === 1) {
          const item = found[0];
          actions = `
            <button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn">View Inventory</button>
            <button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn primary">Show on Map</button>
          `;
          message += `<br>💡 <em>Tip: Ask me to "blink lights for ${item.zone}" to see it light up!</em>`;
        } else {
          actions = `
            <button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View All</button>
            <button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">Show Heatmap</button>
          `;
        }
        
        this.addMessage(message, 'assistant', actions);
      } else {
        this.addMessage(`🤔 I don't see any <strong>${cropName}</strong> growing right now. Would you like to check the planting schedule?`, 'assistant',
          `<button onclick="window.location.href='/views/planting-scheduler.html'" class="action-btn primary">View Schedule</button>
          <button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn">Browse All Crops</button>`
        );
      }
    } catch (error) {
      console.error('Crop search error:', error);
      this.addMessage(`😕 I had trouble searching for ${cropName}. Let me show you the inventory page.`, 'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn primary">View Inventory</button>`
      );
    }
  }

  async matchHealthQuery(query) {
    const healthPatterns = [
      /farm health|how is the farm|farm status/i,
      /any (problems|issues|alerts)/i,
      /check (health|status)/i
    ];

    if (healthPatterns.some(pattern => pattern.test(query))) {
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
        const avgTemp = (data.zones.reduce((sum, z) => sum + parseFloat(z.temperature || 0), 0) / data.zones.length).toFixed(1);
        const avgHumidity = (data.zones.reduce((sum, z) => sum + parseFloat(z.humidity || 0), 0) / data.zones.length).toFixed(0);
        
        message += `<li>🌡️ Average Temperature: ${avgTemp}°F</li>`;
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
    const hardwarePatterns = [
      { pattern: /blink (lights?|leds?) (for |in |zone )?(.+)/i, action: 'blink' },
      { pattern: /identify (zone |group )?(.+)/i, action: 'identify' },
      { pattern: /show (me )?where (.+) is/i, action: 'locate' }
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.farmAssistant = new FarmAssistant();
  });
} else {
  window.farmAssistant = new FarmAssistant();
}
