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
                Hi! I'm your Farm Assistant. I can help you:
                <ul>
                  <li>Navigate pages ("show planting schedule")</li>
                  <li>Find crops ("do we have basil?")</li>
                  <li>Check farm health ("any alerts?")</li>
                  <li>Control hardware ("blink lights zone A")</li>
                </ul>
                What can I help you with?
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
    
    // Fallback
    this.addMessage(
      `I'm not sure how to help with that. Try asking:
      <ul>
        <li>"Show planting schedule"</li>
        <li>"Do we have basil?"</li>
        <li>"Any alerts today?"</li>
        <li>"Navigate to wholesale"</li>
      </ul>`
    );
  }

  matchNavigation(query) {
    const navPatterns = [
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['planting', 'schedule'], url: '/views/planting-scheduler.html', name: 'Planting Schedule' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['tray', 'inventory'], url: '/views/tray-inventory.html', name: 'Tray Inventory' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['farm', 'summary', 'dashboard'], url: '/views/farm-summary.html', name: 'Farm Dashboard' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['wholesale'], url: '/wholesale.html', name: 'Wholesale Portal' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['sales', 'pos', 'terminal'], url: '/farm-sales.html', name: 'POS Terminal' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['heatmap', 'temperature', 'map'], url: '/views/room-heatmap.html', name: 'Heatmap' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['inventory', 'crops'], url: '/views/farm-inventory.html', name: 'Inventory' },
      { pattern: /show|open|go to|navigate to|view/i, keywords: ['central', 'admin', 'platform'], url: '/central-admin.html', name: 'Central Admin' }
    ];

    for (const nav of navPatterns) {
      if (nav.pattern.test(query) && nav.keywords.some(kw => query.includes(kw))) {
        const actions = `<button onclick="window.location.href='${nav.url}'" class="action-btn primary">Open ${nav.name}</button>`;
        this.addMessage(`Opening <strong>${nav.name}</strong>...`, 'assistant', actions);
        setTimeout(() => window.location.href = nav.url, 1500);
        return true;
      }
    }
    
    return false;
  }

  async matchInventoryQuery(query) {
    const cropPatterns = [
      /do (we|you) have (.+)/i,
      /where is (.+)/i,
      /find (.+)/i,
      /show me (.+)/i,
      /how much (.+)/i
    ];

    for (const pattern of cropPatterns) {
      const match = query.match(pattern);
      if (match) {
        const cropName = match[match.length - 1].replace(/\?/g, '').trim();
        await this.searchCrop(cropName);
        return true;
      }
    }
    
    return false;
  }

  async searchCrop(cropName) {
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
                  group: group.name || group.id,
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
        let message = `<strong>Found ${cropName}:</strong><ul>`;
        found.forEach(item => {
          message += `<li><strong>${item.zone}</strong> - ${item.group}: ${item.trays} trays`;
          if (item.harvestIn !== undefined) {
            message += ` (harvest in ${item.harvestIn} days)`;
          }
          message += `</li>`;
        });
        message += `</ul>`;
        
        const actions = `
          <button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn">View Inventory</button>
          <button onclick="window.location.href='/views/room-heatmap.html'" class="action-btn">Show Heatmap</button>
        `;
        
        this.addMessage(message, 'assistant', actions);
      } else {
        this.addMessage(`No <strong>${cropName}</strong> found in current inventory. Would you like to check the planting schedule?`, 'assistant',
          `<button onclick="window.location.href='/views/planting-scheduler.html'" class="action-btn">Open Schedule</button>`
        );
      }
    } catch (error) {
      console.error('Crop search error:', error);
      this.addMessage(`I had trouble searching for ${cropName}. Try viewing the inventory page directly.`, 'assistant',
        `<button onclick="window.location.href='/views/farm-inventory.html'" class="action-btn">View Inventory</button>`
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
        <strong>I can help you with:</strong>
        <ul>
          <li><strong>Navigation:</strong> "show planting schedule", "open wholesale"</li>
          <li><strong>Inventory:</strong> "do we have basil?", "where is romaine?"</li>
          <li><strong>Farm Status:</strong> "how is the farm?", "any alerts?"</li>
          <li><strong>Hardware:</strong> "blink lights zone A", "identify group 3"</li>
          <li><strong>Current Page:</strong> ${this.currentContext.page}-specific actions</li>
        </ul>
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
