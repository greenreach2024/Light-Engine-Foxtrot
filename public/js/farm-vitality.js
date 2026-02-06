/**
 * Farm Vitality Multi-View Dashboard
 * Phase 1: Foundation + View Management
 */

class VitalityViewManager {
  constructor() {
    this.currentView = 'rings';
    this.vitalityData = null;
    this.settings = this.loadSettings();
    this.refreshInterval = null;
    this.screensaverTimeout = null;
    this.screensaverInterval = null;
    this.isScreensaverActive = false;
    this.lastActivityTime = Date.now();
    this.animationFrame = null;
    this.rotationAngle = 0;
    this.heartbeatPhase = 0;
    this.isAnimating = false;
    this.blobPositions = []; // Track blob positions for click detection
    this.time = 0; // Master animation timer
    
    // Initialize
    this.init();
  }
  
  async init() {
    console.log('[Farm Vitality] Initializing dashboard...');
    
    // Set up activity tracking
    this.setupActivityTracking();
    
    // Set up blob click interaction
    this.setupBlobClickInteraction();
    
    // Apply settings
    this.applySettings();
    
    // Load initial data
    await this.fetchVitalityData();
    
    // Start refresh loop
    this.startRefreshLoop();
    
    // Start screensaver monitoring
    if (this.settings.screensaverEnabled) {
      this.startScreensaverMonitoring();
    }
    
    // Initialize current view
    this.renderCurrentView();
    
    // Load farm name into header
    this.loadFarmName();
  }
  
  /**
   * Load farm name and update header
   */
  async loadFarmName() {
    try {
      const response = await fetch('/data/farm.json');
      if (response.ok) {
        const farmData = await response.json();
        const farmName = farmData.name || farmData.farmName;
        if (farmName) {
          const headerEl = document.getElementById('farmNameHeader');
          if (headerEl) {
            headerEl.textContent = `${farmName} - Farm Vitality`;
          }
          document.title = `${farmName} - Farm Vitality`;
        }
      }
    } catch (error) {
      console.log('[Farm Vitality] Could not load farm name:', error.message);
    }
  }
  
  /**
   * Fetch vitality data from API
   */
  async fetchVitalityData() {
    try {
      const response = await fetch('/api/health/vitality');
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Failed to load vitality data');
      }
      
      this.vitalityData = data;
      this.updateUI();
      this.hideError();
      
      console.log('[Farm Vitality] Data loaded:', data);
      
      return data;
    } catch (error) {
      console.error('[Farm Vitality] Error fetching data:', error);
      this.showError(error.message);
      throw error;
    }
  }
  
  /**
   * Update UI with current data
   */
  updateUI() {
    if (!this.vitalityData) return;
    
    // Hide loading, show status bar
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('statusBar').style.display = 'flex';
    
    // Update last updated time
    const timestamp = new Date(this.vitalityData.timestamp);
    document.getElementById('lastUpdated').textContent = timestamp.toLocaleTimeString();
    
    // Update overall score
    const scoreEl = document.getElementById('overallScore');
    scoreEl.textContent = this.vitalityData.overall_score;
    scoreEl.style.color = this.getScoreColor(this.vitalityData.overall_score);
    
    // Update freshness indicators
    this.updateFreshnessIndicators();
  }
  
  /**
   * Update data freshness indicators
   */
  updateFreshnessIndicators() {
    if (!this.vitalityData?.data_freshness) return;
    
    const indicators = {
      environment: document.getElementById('envDot'),
      nutrients: document.getElementById('nutrientDot'),
      inventory: document.getElementById('inventoryDot')
    };
    
    for (const [key, dot] of Object.entries(indicators)) {
      const freshness = this.vitalityData.data_freshness[key];
      if (freshness && dot) {
        dot.className = `freshness-dot ${freshness.status}`;
        dot.title = `${key}: ${freshness.age_minutes || 'N/A'} minutes old`;
      }
    }
  }
  
  /**
   * Easing functions for smooth animations
   */
  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
  
  /**
   * Get color for score (matching admin header palette)
   */
  getScoreColor(score) {
    if (score >= 85) return '#10b981'; // excellent - green (farm summary)
    if (score >= 70) return '#06b6d4'; // good - cyan (vitality/nutrient)
    if (score >= 50) return '#3b82f6'; // fair - blue (dashboard)
    if (score >= 30) return '#f59e0b'; // degraded - yellow (inventory)
    return '#ef4444'; // critical - red (close button)
  }
  
  /**
   * Switch to a different view
   */
  switchView(viewName) {
    if (!this.isViewEnabled(viewName)) {
      console.warn('[Farm Vitality] View disabled:', viewName);
      return;
    }
    
    this.currentView = viewName;
    this.recordActivity();
    
    // Update UI
    this.updateViewButtons();
    this.renderCurrentView();
    
    console.log('[Farm Vitality] Switched to view:', viewName);
  }
  
  /**
   * Check if view is enabled in settings
   */
  isViewEnabled(viewName) {
    const key = `view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}Enabled`;
    return this.settings[key] !== false;
  }
  
  /**
   * Update view button states
   */
  updateViewButtons() {
    const buttons = document.querySelectorAll('.view-btn');
    buttons.forEach(btn => {
      if (btn.dataset.view === this.currentView) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  /**
   * Render the current active view
   */
  renderCurrentView() {
    // Hide all canvases
    document.querySelectorAll('.view-canvas').forEach(canvas => {
      canvas.classList.remove('active');
    });
    
    // Stop previous animation
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.isAnimating = false;
    }
    
    // Show current canvas
    const canvas = document.getElementById(`${this.currentView}Canvas`);
    if (canvas) {
      canvas.classList.add('active');
      
      // Start animation for this view
      this.isAnimating = true;
      
      // Render based on view type
      switch (this.currentView) {
        case 'rings':
          this.animateRingsView(canvas);
          break;
        case 'heartbeat':
          this.animateHeartbeatView(canvas);
          break;
        case 'blobs':
          this.renderBlobsView(canvas);
          break;
      }
    }
  }
  
  /**
   * Animate Rings View with rotation
   */
  animateRingsView(canvas) {
    if (!this.isAnimating || this.currentView !== 'rings') return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, width, height);
    
    if (!this.vitalityData) {
      this.drawLoadingMessage(ctx, width, height);
      this.animationFrame = requestAnimationFrame(() => this.animateRingsView(canvas));
      return;
    }
    
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = 80;
    
    // Update master time for coordinated animation
    this.time += 1;
    this.rotationAngle += 0.008;
    
    const components = [
      { key: 'environment', label: 'Environment', ...this.vitalityData.components.environment },
      { key: 'crop_readiness', label: 'Crop Readiness', ...this.vitalityData.components.crop_readiness },
      { key: 'nutrient_health', label: 'Nutrient Health', ...this.vitalityData.components.nutrient_health },
      { key: 'operations', label: 'Operations', ...this.vitalityData.components.operations }
    ];
    
    // Draw organic undulating rings
    components.forEach((component, index) => {
      const radius = baseRadius + (index * 60);
      const score = component.score || 0;
      const baseColor = this.getScoreColor(score);
      const freshness = component.data_freshness || { status: 'no_data' };
      
      // Health-based movement with smooth easing
      const healthFactor = score / 100;
      const easedHealth = this.easeOutCubic(healthFactor);
      
      // Healthy: calm, smooth waves | Unhealthy: urgent, sharp changes
      const baseFreq = 2 + (1 - easedHealth) * 4; // 2-6 range
      const baseAmp = 3 + (1 - easedHealth) * 8; // 3-11 range (reduced)
      const breathSpeed = 0.01 + (1 - easedHealth) * 0.03; // Breathing pace
      
      // Smooth rotation with per-ring phase offset
      const ringRotation = this.rotationAngle * (0.8 + index * 0.15);
      const breathPhase = Math.sin(this.time * breathSpeed + index) * 0.5 + 0.5;
      
      // Draw organic undulating ring
      const points = 80;
      ctx.beginPath();
      
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2 + ringRotation;
        
        // Single wave with breathing modulation
        const wave = Math.sin(angle * baseFreq + this.time * 0.1);
        const breathMod = Math.sin(this.time * breathSpeed * 2) * 0.3 + 0.7;
        const undulation = wave * baseAmp * breathPhase * breathMod;
        
        const r = radius + undulation;
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      
      // Soft gradient with subtle shimmer
      const gradient = ctx.createRadialGradient(centerX, centerY, radius - 8, centerX, centerY, radius + 8);
      
      const shimmerPhase = Math.sin(this.time * 0.05 + index) * 0.3 + 0.7;
      gradient.addColorStop(0, baseColor + 'ee');
      gradient.addColorStop(0.4, baseColor + Math.floor(shimmerPhase * 255).toString(16).padStart(2, '0'));
      gradient.addColorStop(0.6, this.getIridescentShift(baseColor, index, this.time * 0.03));
      gradient.addColorStop(1, baseColor + '66');
      
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      
      // Apply staleness visual
      if (freshness.stale) {
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([8, 8]);
      } else {
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
      }
      
      ctx.stroke();
      
      // Pulsing glow for healthy rings
      if (healthFactor > 0.7) {
        const glowStrength = (Math.sin(this.time * 0.08 + index) * 0.3 + 0.5) * easedHealth;
        ctx.globalAlpha = glowStrength * 0.4;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 14;
        ctx.stroke();
      }
      
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      
      // Label and Score on right side
      const labelX = width - 180;
      const labelY = 150 + (index * 140);
      
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(component.label, labelX, labelY);
      
      // Score with color
      ctx.fillStyle = baseColor;
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText(score, labelX, labelY + 35);
      
      // Freshness indicator dot
      ctx.fillStyle = this.getFreshnessColor(freshness.status);
      ctx.beginPath();
      ctx.arc(labelX + 60, labelY + 20, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Center: Overall score
    ctx.fillStyle = '#1a2332';
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius - 50, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = this.getScoreColor(this.vitalityData.overall_score);
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.vitalityData.overall_score, centerX, centerY - 10);
    
    ctx.fillStyle = '#9ca3af';
    ctx.font = '16px sans-serif';
    ctx.fillText('Farm Health', centerX, centerY + 25);
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(() => this.animateRingsView(canvas));
  }
  
  /**
   * Animate Heartbeat View (Phase 3 - Implementation)
   */
  animateHeartbeatView(canvas) {
    if (!this.isAnimating || this.currentView !== 'heartbeat') return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, width, height);
    
    if (!this.vitalityData) {
      this.drawLoadingMessage(ctx, width, height);
      this.animationFrame = requestAnimationFrame(() => this.animateHeartbeatView(canvas));
      return;
    }
    
    // Update phase for wave scrolling
    this.heartbeatPhase += 2;
    if (this.heartbeatPhase > width) this.heartbeatPhase = 0;
    
    const components = [
      { key: 'environment', label: 'Environment', ...this.vitalityData.components.environment },
      { key: 'crop_readiness', label: 'Crop Readiness', ...this.vitalityData.components.crop_readiness },
      { key: 'nutrient_health', label: 'Nutrient Health', ...this.vitalityData.components.nutrient_health },
      { key: 'operations', label: 'Systems', ...this.vitalityData.components.operations }
    ];
    
    // Reserve space for title (60px) and footer (80px)
    const usableHeight = height - 140;
    const channelHeight = usableHeight / components.length;
    const startY = 80;
    
    // Draw title
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Farm Heartbeat Monitor', width / 2, 40);
    
    // Draw each channel
    components.forEach((component, index) => {
      const y = startY + (channelHeight * (index + 0.5));
      const score = component.score || 0;
      const color = this.getScoreColor(score);
      const freshness = component.data_freshness || { status: 'no_data' };
      
      // Channel background line
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      // Label and score
      ctx.fillStyle = '#9ca3af';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(component.label, 20, y - channelHeight / 2 + 10);
      
      ctx.fillStyle = color;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(score, 20, y - channelHeight / 2 + 35);
      
      // Waveform
      if (freshness.stale || freshness.status === 'critical') {
        // Flatline for stale data
        ctx.strokeStyle = freshness.status === 'critical' ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(200, y);
        ctx.lineTo(width - 20, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // "NO DATA" label for critical
        if (freshness.status === 'critical') {
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('NO DATA', width / 2, y - 5);
        }
      } else {
        // Draw heartbeat waveform
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        
        let firstPoint = true;
        for (let x = 200; x < width - 20; x += 2) {
          const amplitude = (score / 100) * (channelHeight / 3);
          const scrolledX = (x + this.heartbeatPhase) % (width - 220);
          const t = scrolledX / 50;
          
          // Heartbeat pattern: spike, dip, flat
          let waveY;
          const cycle = t % 4;
          if (cycle < 0.3) {
            waveY = y - amplitude * Math.sin(cycle * 10 * Math.PI);
          } else if (cycle < 0.6) {
            waveY = y + amplitude * 0.3 * Math.sin((cycle - 0.3) * 10 * Math.PI);
          } else {
            waveY = y;
          }
          
          if (firstPoint) {
            ctx.moveTo(x, waveY);
            firstPoint = false;
          } else {
            ctx.lineTo(x, waveY);
          }
        }
        ctx.stroke();
      }
      
      // Freshness indicator
      const dotX = width - 40;
      const dotY = y - channelHeight / 2 + 20;
      ctx.fillStyle = this.getFreshnessColor(freshness.status);
      ctx.beginPath();
      ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Overall status at bottom
    const footerY = height - 50;
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Overall Health: ${this.vitalityData.overall_score}/100`, width / 2, footerY);
    ctx.fillStyle = this.getScoreColor(this.vitalityData.overall_score);
    ctx.fillText(this.vitalityData.overall_status.toUpperCase(), width / 2, footerY + 25);
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(() => this.animateHeartbeatView(canvas));
  }
  
  /**
   * Get freshness indicator color (matching admin header palette)
   */
  getFreshnessColor(status) {
    switch (status) {
      case 'fresh': return '#10b981';      // green
      case 'acceptable': return '#06b6d4';  // cyan
      case 'stale': return '#f59e0b';       // yellow
      case 'critical': return '#ef4444';    // red
      case 'no_data': return '#6b7280';     // gray
      default: return '#6b7280';            // gray
    }
  }
  
  /**
   * Get iridescent color shift for shimmer effect
   * Creates subtle rainbow shimmer on ring edges
   */
  getIridescentShift(baseColor, ringIndex, phase) {
    // Extract RGB from hex
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Create phase-based hue shift for iridescence
    const shift = Math.sin(phase * 5 + ringIndex * 0.5) * 30;
    
    // Shift colors slightly for shimmer
    const r2 = Math.min(255, Math.max(0, r + shift));
    const g2 = Math.min(255, Math.max(0, g + shift * 0.7));
    const b2 = Math.min(255, Math.max(0, b - shift * 0.5));
    
    return `rgb(${Math.round(r2)}, ${Math.round(g2)}, ${Math.round(b2)})`;
  }
  
  /**
   * Render Happy Blobs View (Phase 4A - Implementation)
   */
  renderBlobsView(canvas) {
    if (!this.isAnimating || this.currentView !== 'blobs') return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, width, height);
    
    if (!this.vitalityData) {
      this.drawLoadingMessage(ctx, width, height);
      this.animationFrame = requestAnimationFrame(() => this.renderBlobsView(canvas));
      return;
    }
    
    // Update animation time
    this.time += 1;
    this.rotationAngle += 0.015;
    
    // Clear blob positions for click detection
    this.blobPositions = [];
    
    const components = [
      { key: 'environment', label: 'Environment', ...this.vitalityData.components.environment },
      { key: 'crop_readiness', label: 'Crop Readiness', ...this.vitalityData.components.crop_readiness },
      { key: 'nutrient_health', label: 'Nutrient Health', ...this.vitalityData.components.nutrient_health },
      { key: 'operations', label: 'Systems', ...this.vitalityData.components.operations }
    ];
    
    // Draw title
    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Farm Friends', width / 2, 50);
    
    // Grid layout: 2x2
    const cols = 2;
    const rows = 2;
    const cellWidth = width / cols;
    const cellHeight = (height - 100) / rows;
    
    components.forEach((component, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const centerX = cellWidth * col + cellWidth / 2;
      const centerY = 100 + cellHeight * row + cellHeight / 2;
      
      // Draw blob and store position
      const blobSize = this.drawBlob(ctx, component, centerX, centerY, index);
      
      // Store blob position for click detection
      this.blobPositions.push({
        x: centerX,
        y: centerY,
        size: blobSize,
        component: component
      });
    });
    
    // Overall status
    ctx.fillStyle = '#c4b5fd';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Farm Health: ${this.vitalityData.overall_score}/100`, width / 2, height - 30);
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(() => this.renderBlobsView(canvas));
  }
  
  /**
   * Draw individual blob creature
   */
  drawBlob(ctx, component, x, y, index) {
    const score = component.score || 0;
    const baseColor = this.getScoreColor(score);
    const freshness = component.data_freshness || { status: 'no_data' };
    
    // Determine emotion based on score
    const emotion = score >= 85 ? 'happy' : score >= 50 ? 'neutral' : 'sad';
    const healthFactor = score / 100;
    
    // Smooth floating with easing
    const floatPhase = (this.time * 0.03 + index * Math.PI / 2) % (Math.PI * 2);
    const easedFloat = this.easeInOutCubic(Math.sin(floatPhase) * 0.5 + 0.5);
    const floatOffset = (easedFloat - 0.5) * 25;
    
    // Squash and stretch based on float velocity
    const velocity = Math.cos(floatPhase) * 0.15;
    const squash = 1 - Math.abs(velocity) * 0.3;
    const stretch = 1 + Math.abs(velocity) * 0.2;
    
    const blobY = y + floatOffset;
    
    // Size based on health with breathing
    const breathScale = Math.sin(this.time * 0.04 + index) * 0.08 + 1;
    const baseSize = (55 + healthFactor * 35) * breathScale;
    
    // Draw blob body with squash/stretch
    ctx.save();
    ctx.translate(x, blobY);
    ctx.scale(stretch, squash);
    
    // Single smooth circle with subtle wobble
    const wobbleAmt = (1 - healthFactor) * 8 + 2;
    const wobblePoints = 16;
    
    ctx.beginPath();
    for (let i = 0; i <= wobblePoints; i++) {
      const angle = (i / wobblePoints) * Math.PI * 2;
      const wobble = Math.sin(angle * 3 + this.time * 0.1 + index) * wobbleAmt;
      const r = baseSize + wobble;
      const px = r * Math.cos(angle);
      const py = r * Math.sin(angle);
      
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    
    // Fill blob with gradient
    const gradient = ctx.createRadialGradient(0, -20, 0, 0, 0, baseSize);
    gradient.addColorStop(0, baseColor + 'ff');
    gradient.addColorStop(0.7, baseColor + 'cc');
    gradient.addColorStop(1, baseColor + '88');
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Outline
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Draw face based on emotion
    this.drawBlobFace(ctx, emotion, baseSize, freshness.stale);
    
    ctx.restore();
    
    // Label below blob
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(component.label, x, blobY + baseSize + 30);
    
    // Score
    ctx.fillStyle = baseColor;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(score, x, blobY + baseSize + 55);
    
    // Freshness indicator
    if (freshness.stale) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = '12px sans-serif';
      ctx.fillText('⚠️ stale', x, blobY + baseSize + 75);
    }
    
    // Return blob size for click detection
    return baseSize;
  }
  
  /**
   * Draw blob facial features based on emotion
   */
  drawBlobFace(ctx, emotion, size, isStale) {
    const eyeY = -size * 0.2;
    const eyeSpacing = size * 0.3;
    const eyeSize = size * 0.12;
    
    // Eyes
    ctx.fillStyle = isStale ? '#6b7280' : '#1a2332';
    
    if (emotion === 'sad') {
      // Sad eyes (downturned)
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY - 5, eyeSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeSpacing, eyeY - 5, eyeSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
      
      // Sad eyebrows
      ctx.strokeStyle = '#1a2332';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 10, eyeY - 15);
      ctx.lineTo(-eyeSpacing + 10, eyeY - 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(eyeSpacing - 10, eyeY - 12);
      ctx.lineTo(eyeSpacing + 10, eyeY - 15);
      ctx.stroke();
    } else if (emotion === 'neutral') {
      // Neutral eyes (circles)
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Happy eyes (sparkly)
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();
      
      // Sparkles
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-eyeSpacing - 4, eyeY - 4, eyeSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeSpacing - 4, eyeY - 4, eyeSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Mouth
    const mouthY = size * 0.2;
    const mouthWidth = size * 0.4;
    
    ctx.strokeStyle = isStale ? '#6b7280' : '#1a2332';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    
    if (emotion === 'sad') {
      // Sad mouth (frown)
      ctx.arc(0, mouthY + 20, mouthWidth, 0.2 * Math.PI, 0.8 * Math.PI);
    } else if (emotion === 'neutral') {
      // Neutral mouth (straight line)
      ctx.moveTo(-mouthWidth, mouthY);
      ctx.lineTo(mouthWidth, mouthY);
    } else {
      // Happy mouth (smile)
      ctx.arc(0, mouthY - 10, mouthWidth, 0.2 * Math.PI, 0.8 * Math.PI, true);
    }
    
    ctx.stroke();
  }
  
  /**
   * Draw loading message
   */
  drawLoadingMessage(ctx, width, height) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading data...', width / 2, height / 2);
  }
  
  /**
   * Start data refresh loop
   */
  startRefreshLoop() {
    const intervalSeconds = this.settings.refreshInterval || 5;
    const intervalMs = intervalSeconds * 1000;
    
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(() => {
      this.fetchVitalityData()
        .then(() => this.renderCurrentView())
        .catch(err => console.error('[Farm Vitality] Refresh error:', err));
    }, intervalMs);
    
    console.log(`[Farm Vitality] Refresh loop started (${intervalSeconds}s)`);
  }
  
  /**
   * Activity tracking setup
   */
  setupActivityTracking() {
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, () => this.recordActivity(), true);
    });
  }
  
  /**
   * Set up blob click interaction
   */
  setupBlobClickInteraction() {
    const blobsCanvas = document.getElementById('blobsCanvas');
    if (!blobsCanvas) return;
    
    blobsCanvas.addEventListener('click', (e) => {
      if (this.currentView !== 'blobs' || !this.vitalityData) return;
      
      const rect = blobsCanvas.getBoundingClientRect();
      const scaleX = blobsCanvas.width / rect.width;
      const scaleY = blobsCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      // Check if click is within any blob
      this.blobPositions.forEach((blob, index) => {
        const dx = x - blob.x;
        const dy = y - blob.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < blob.size) {
          this.showBlobDetails(blob.component, e.clientX, e.clientY);
        }
      });
    });
  }
  
  /**
   * Show blob detail popup
   */
  showBlobDetails(component, x, y) {
    // Remove existing popup
    const existingPopup = document.getElementById('blobDetailPopup');
    if (existingPopup) existingPopup.remove();
    
    // Create popup
    const popup = document.createElement('div');
    popup.id = 'blobDetailPopup';
    popup.style.cssText = `
      position: fixed;
      left: ${x + 20}px;
      top: ${y + 20}px;
      background: rgba(26, 35, 50, 0.98);
      border: 2px solid ${this.getScoreColor(component.score)};
      border-radius: 12px;
      padding: 1.5rem;
      color: #e5e7eb;
      z-index: 1000;
      min-width: 250px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      animation: popupFadeIn 0.2s ease;
    `;
    
    popup.innerHTML = `
      <style>
        @keyframes popupFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        #blobDetailPopup .close-popup {
          position: absolute;
          top: 8px;
          right: 8px;
          background: none;
          border: none;
          color: #9ca3af;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
        }
        #blobDetailPopup .close-popup:hover {
          color: #ef4444;
        }
      </style>
      <button class="close-popup" onclick="this.parentElement.remove()">×</button>
      <h3 style="color: ${this.getScoreColor(component.score)}; margin-bottom: 1rem; font-size: 1.2rem;">
        ${component.label}
      </h3>
      <div style="margin-bottom: 0.75rem;">
        <span style="color: #9ca3af;">Score:</span>
        <span style="color: ${this.getScoreColor(component.score)}; font-weight: bold; font-size: 1.5rem; margin-left: 0.5rem;">
          ${component.score}/100
        </span>
      </div>
      <div style="margin-bottom: 0.75rem;">
        <span style="color: #9ca3af;">Status:</span>
        <span style="color: ${this.getScoreColor(component.score)}; margin-left: 0.5rem;">
          ${component.status}
        </span>
      </div>
      ${component.data_freshness ? `
        <div style="margin-bottom: 0.75rem;">
          <span style="color: #9ca3af;">Data Freshness:</span>
          <span style="color: ${this.getFreshnessColor(component.data_freshness.status)}; margin-left: 0.5rem;">
            ${component.data_freshness.status || 'unknown'}
          </span>
        </div>
      ` : ''}
      ${component.plants_ready_48h !== undefined ? `
        <div style="margin-bottom: 0.5rem; font-size: 0.9rem; color: #9ca3af;">
          Ready in 48h: ${component.plants_ready_48h}
        </div>
      ` : ''}
      ${component.system_uptime !== undefined ? `
        <div style="margin-bottom: 0.5rem; font-size: 0.9rem; color: #9ca3af;">
          Uptime: ${component.system_uptime}%
        </div>
      ` : ''}
    `;
    
    document.body.appendChild(popup);
    
    // Auto-close after 5 seconds
    setTimeout(() => {
      if (document.getElementById('blobDetailPopup')) {
        popup.remove();
      }
    }, 5000);
  }
  
  /**
   * Record user activity
   */
  recordActivity() {
    this.lastActivityTime = Date.now();
    
    if (this.isScreensaverActive) {
      this.exitScreensaver();
    }
  }
  
  /**
   * Start screensaver monitoring
   */
  startScreensaverMonitoring() {
    if (this.screensaverTimeout) {
      clearInterval(this.screensaverTimeout);
    }
    
    this.screensaverTimeout = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      const delayMs = (this.settings.screensaverDelay || 120) * 1000;
      
      if (idleTime >= delayMs && !this.isScreensaverActive) {
        this.enterScreensaver();
      }
    }, 1000);
  }
  
  /**
   * Enter screensaver mode
   */
  enterScreensaver() {
    console.log('[Farm Vitality] Entering screensaver mode');
    this.isScreensaverActive = true;
    
    // Hide controls
    document.getElementById('viewControls').style.opacity = '0';
    document.getElementById('viewControls').style.pointerEvents = 'none';
    
    // Start view rotation
    const rotationSeconds = this.settings.screensaverRotation || 30;
    this.screensaverInterval = setInterval(() => {
      this.rotateView();
    }, rotationSeconds * 1000);
  }
  
  /**
   * Exit screensaver mode
   */
  exitScreensaver() {
    console.log('[Farm Vitality] Exiting screensaver mode');
    this.isScreensaverActive = false;
    
    // Show controls
    document.getElementById('viewControls').style.opacity = '1';
    document.getElementById('viewControls').style.pointerEvents = 'auto';
    
    // Stop rotation
    if (this.screensaverInterval) {
      clearInterval(this.screensaverInterval);
      this.screensaverInterval = null;
    }
  }
  
  /**
   * Rotate to next enabled view
   */
  rotateView() {
    const views = ['rings', 'heartbeat', 'blobs'];
    const enabledViews = views.filter(v => this.isViewEnabled(v));
    
    if (enabledViews.length === 0) return;
    
    const currentIndex = enabledViews.indexOf(this.currentView);
    const nextIndex = (currentIndex + 1) % enabledViews.length;
    const nextView = enabledViews[nextIndex];
    
    this.switchView(nextView);
  }
  
  /**
   * Load settings from localStorage
   */
  loadSettings() {
    const defaultSettings = {
      screensaverEnabled: true,
      screensaverDelay: 120,
      screensaverRotation: 30,
      viewRingsEnabled: true,
      viewHeartbeatEnabled: true,
      viewBlobsEnabled: true,
      refreshInterval: 5,
      showStalenessWarnings: true,
      targetFPS: 30
    };
    
    try {
      const stored = localStorage.getItem('farmVitalitySettings');
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('[Farm Vitality] Error loading settings:', error);
    }
    
    return defaultSettings;
  }
  
  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('farmVitalitySettings', JSON.stringify(this.settings));
      console.log('[Farm Vitality] Settings saved');
    } catch (error) {
      console.error('[Farm Vitality] Error saving settings:', error);
    }
  }
  
  /**
   * Apply settings to UI
   */
  applySettings() {
    // Update form fields
    document.getElementById('screensaverEnabled').checked = this.settings.screensaverEnabled;
    document.getElementById('screensaverDelay').value = this.settings.screensaverDelay;
    document.getElementById('screensaverRotation').value = this.settings.screensaverRotation;
    document.getElementById('viewRingsEnabled').checked = this.settings.viewRingsEnabled;
    document.getElementById('viewHeartbeatEnabled').checked = this.settings.viewHeartbeatEnabled;
    document.getElementById('viewBlobsEnabled').checked = this.settings.viewBlobsEnabled;
    document.getElementById('refreshInterval').value = this.settings.refreshInterval;
    document.getElementById('showStalenessWarnings').checked = this.settings.showStalenessWarnings;
    document.getElementById('targetFPS').value = this.settings.targetFPS;
  }
  
  /**
   * Show error message
   */
  showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
  }
  
  /**
   * Hide error message
   */
  hideError() {
    document.getElementById('errorState').style.display = 'none';
  }
}

// Global instance
let vitalityManager;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  vitalityManager = new VitalityViewManager();
});

// Global functions for UI
function switchView(viewName) {
  if (vitalityManager) {
    vitalityManager.switchView(viewName);
  }
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.toggle('open');
}

function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('open');
}

function saveSettings() {
  if (!vitalityManager) return;
  
  // Read all settings from form
  vitalityManager.settings = {
    screensaverEnabled: document.getElementById('screensaverEnabled').checked,
    screensaverDelay: parseInt(document.getElementById('screensaverDelay').value),
    screensaverRotation: parseInt(document.getElementById('screensaverRotation').value),
    viewRingsEnabled: document.getElementById('viewRingsEnabled').checked,
    viewHeartbeatEnabled: document.getElementById('viewHeartbeatEnabled').checked,
    viewBlobsEnabled: document.getElementById('viewBlobsEnabled').checked,
    refreshInterval: parseInt(document.getElementById('refreshInterval').value),
    showStalenessWarnings: document.getElementById('showStalenessWarnings').checked,
    targetFPS: parseInt(document.getElementById('targetFPS').value)
  };
  
  vitalityManager.saveSettings();
  
  // Restart refresh loop with new interval
  vitalityManager.startRefreshLoop();
  
  // Restart screensaver monitoring
  if (vitalityManager.settings.screensaverEnabled) {
    vitalityManager.startScreensaverMonitoring();
  }
}
