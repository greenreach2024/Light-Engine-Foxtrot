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
    this.setupBlobHoverInteraction();
    
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
      const fallbackUrl = `${window.location.protocol}//${window.location.hostname}:8091/api/health/vitality`;
      let response = await fetch('/api/health/vitality');
      
      if (response.status === 404) {
        response = await fetch(fallbackUrl);
      }
      
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
    
    // Update overall score with smooth transition
    const scoreEl = document.getElementById('overallScore');
    const newScore = this.vitalityData.overall_score;
    const oldScore = scoreEl.textContent;
    
    if (oldScore !== newScore.toString()) {
      // Add transition effect
      scoreEl.classList.add('updating');
      setTimeout(() => {
        scoreEl.textContent = newScore;
        scoreEl.style.color = this.getScoreColor(newScore);
      }, 150);
      setTimeout(() => scoreEl.classList.remove('updating'), 400);
    } else {
      scoreEl.textContent = newScore;
      scoreEl.style.color = this.getScoreColor(newScore);
    }
    
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
    const baseRadius = 150;
    
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
    const ringColors = ['#3b82f6', '#10b981', '#8b5cf6', '#06b6d4'];
    components.forEach((component, index) => {
      const radius = baseRadius + (index * 90);
      const score = component.score || 0;
      const baseColor = ringColors[index % ringColors.length];
      const freshness = component.data_freshness || { status: 'no_data' };
      
      // Health-based movement with smooth easing
      const healthFactor = score / 100;
      const easedHealth = this.easeOutCubic(healthFactor);
      
      // Smooth, liquid ring with traveling bulges (reference style)
      const ringRotation = this.rotationAngle * (0.6 + index * 0.12);
      const travelSpeed = 0.012 + (1 - easedHealth) * 0.01;
      const bulgeAmp = 12 + (1 - easedHealth) * 10;
      const bulgeSigma = 0.65;
      const phaseA = this.time * travelSpeed + index * 1.4;
      const phaseB = this.time * travelSpeed * 0.8 + index * 2.1 + Math.PI;
      const breath = Math.sin(this.time * 0.015 + index) * (2 + (1 - easedHealth) * 2);

      const points = 120;
      const ringPoints = [];
      const ringWidths = [];

      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2 + ringRotation;

        const distA = Math.min(
          Math.abs(angle - phaseA) % (Math.PI * 2),
          Math.PI * 2 - (Math.abs(angle - phaseA) % (Math.PI * 2))
        );
        const distB = Math.min(
          Math.abs(angle - phaseB) % (Math.PI * 2),
          Math.PI * 2 - (Math.abs(angle - phaseB) % (Math.PI * 2))
        );

        const bulgeA = Math.exp(-(distA * distA) / (2 * bulgeSigma * bulgeSigma)) * bulgeAmp;
        const bulgeB = Math.exp(-(distB * distB) / (2 * (bulgeSigma * 1.2) * (bulgeSigma * 1.2))) * bulgeAmp * 0.7;
        const microWave = Math.sin(angle * 3 + this.time * 0.03 + index) * (2.2 + (1 - easedHealth) * 2);
        const undulation = bulgeA + bulgeB + microWave + breath;

        const r = radius + undulation;
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);

        const thicknessWave = 0.5 + 0.5 * Math.sin(angle * 2.6 + this.time * 0.06 + index);
        const thickness = 6 + thicknessWave * 16 + (bulgeA + bulgeB) * 0.35;

        ringPoints.push({ x, y, angle });
        ringWidths.push(thickness);
      }

      // Iridescent membrane gradient with rotating color shift
      const colorShift = this.time * 0.01 + index * 0.6;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(colorShift);
      ctx.translate(-centerX, -centerY);

      const gradient = ctx.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
      gradient.addColorStop(0, '#60a5fa');
      gradient.addColorStop(0.35, '#34d399');
      gradient.addColorStop(0.7, '#c084fc');
      gradient.addColorStop(1, '#22d3ee');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Apply staleness visual
      if (freshness.stale) {
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([8, 8]);
      } else {
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
      }

      // Soft glow halo
      ctx.shadowBlur = 42;
      ctx.shadowColor = baseColor;
      ctx.beginPath();
      ringPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.stroke();

      // Silky membrane with variable thickness
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = gradient;

      for (let i = 1; i < ringPoints.length; i++) {
        const prev = ringPoints[i - 1];
        const curr = ringPoints[i];
        ctx.lineWidth = ringWidths[i];
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
      }
      // Close the loop with variable thickness
      const first = ringPoints[0];
      const last = ringPoints[ringPoints.length - 1];
      ctx.lineWidth = ringWidths[0];
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(first.x, first.y);
      ctx.stroke();

      ctx.restore();

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      
      // No text overlays for rings-only display
    });
    
    // No center score for rings-only display
    
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
      const maxRadius = Math.min(cellWidth, cellHeight) * 0.34;
      const blobSize = this.drawBlob(ctx, component, centerX, centerY, index, maxRadius);
      
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
  drawBlob(ctx, component, x, y, index, maxRadius) {
    const score = component.score || 0;
    const palette = ['#3b82f6', '#10b981', '#8b5cf6', '#06b6d4'];
    const baseColor = palette[index % palette.length];
    const freshness = component.data_freshness || { status: 'no_data' };
    
    // Determine emotion based on score
    const emotion = score >= 85 ? 'happy' : score >= 50 ? 'neutral' : 'sad';
    const healthFactor = score / 100;
    
    // Smooth floating with controlled motion - faster for healthier blobs
    const speedMultiplier = 0.5 + (healthFactor * 1.5); // 0.5x (dead) to 2.0x (thriving)
    const floatPhase = (this.time * 0.035 * speedMultiplier + index * Math.PI / 2) % (Math.PI * 2);
    const easedFloat = this.easeInOutCubic(Math.sin(floatPhase) * 0.5 + 0.5);
    const floatOffset = (easedFloat - 0.5) * Math.min(28, maxRadius * 0.3);
    
    // Subtle squash and stretch for a rounder feel
    const velocity = Math.cos(floatPhase) * 0.2;
    const squash = 1 - Math.abs(velocity) * 0.25;
    const stretch = 1 + Math.abs(velocity) * 0.2;
    
    const blobY = y + floatOffset;
    
    // Size based on health with smooth breathing animation
    // Healthier blobs breathe deeper and faster
    const breathScale = Math.sin(this.time * 0.04 * speedMultiplier + index) * (0.05 + healthFactor * 0.05) + 1;
    const targetSize = (80 + healthFactor * 70) * breathScale;
    const baseSize = Math.min(targetSize, maxRadius);
    
    // Draw blob body with squash/stretch
    ctx.save();
    ctx.translate(x, blobY);
    ctx.scale(stretch, squash);
    
    // Smooth blob with organic wobble (more blob-like)
    // Healthier blobs wobble more energetically
    const wobbleAmt = (1 - healthFactor) * 5 + 4 + (healthFactor * 3); 
    const wobblePoints = 28;
    
    // Create the wobble path
    ctx.beginPath();
    for (let i = 0; i <= wobblePoints; i++) {
        const angle = (i / wobblePoints) * Math.PI * 2;
        // Dual-frequency wobble for more "jello" feel like B.O.B.
        const wobble1 = Math.sin(angle * 3 + this.time * 0.05 * speedMultiplier + index);
        const wobble2 = Math.sin(angle * 5 - this.time * 0.03 + index);
        const r = baseSize + (wobble1 * wobbleAmt) + (wobble2 * wobbleAmt * 0.3);
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    
    // 1. Base Gradient (Translucent Jelly)
    const shimmerColor = this.getIridescentShift(baseColor, index, this.time * 0.02);
    const gradient = ctx.createRadialGradient(-baseSize * 0.3, -baseSize * 0.4, 0, 0, 0, baseSize);
    // B.O.B. is semi-transparent
    gradient.addColorStop(0, this.hexToRgba(baseColor, 0.8));
    gradient.addColorStop(0.6, this.hexToRgba(baseColor, 0.5));
    gradient.addColorStop(1, this.hexToRgba(baseColor, 0.7)); // Darker rim
    
    ctx.fillStyle = gradient;
    ctx.shadowBlur = 40;
    ctx.shadowColor = baseColor;
    ctx.fill();

    // 2. Trapped Bubbles (Internal Volume)
    // Deterministic random generator for bubbles based on index
    const bubbleCount = 5;
    for(let b=0; b<bubbleCount; b++) {
        const seed = index * 100 + b;
        const speed = 0.02 + ((seed % 5) / 100);
        const bubbleR = baseSize * (0.1 + ((seed % 10)/50)); // 10-30% size
        const angleOffset = seed;
        const orbitR = baseSize * 0.5;
        
        // Bubbles float inside
        const bx = Math.sin(this.time * speed + angleOffset) * orbitR * 0.8;
        const by = Math.cos(this.time * speed * 0.7 + angleOffset) * orbitR * 0.6;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(bx, by, bubbleR, 0, Math.PI * 2);
        ctx.fill();
        
        // Bubble highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(bx - bubbleR*0.3, by - bubbleR*0.3, bubbleR*0.2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 3. Highlight (Glossy Sheen)
    const highlightSize = baseSize * 0.45;
    const highlightGradient = ctx.createRadialGradient(
      -baseSize * 0.3, -baseSize * 0.4, 0,
      -baseSize * 0.3, -baseSize * 0.4, highlightSize
    );
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    highlightGradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
    highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.shadowBlur = 0;
    ctx.fillStyle = highlightGradient;
    ctx.beginPath();
    ctx.ellipse(-baseSize * 0.3, -baseSize * 0.4, highlightSize, highlightSize * 0.8, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Rim Lighting (Fresnel Effect)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
    
    // Draw face based on emotion (Now Cyclops!)
    // Pass stretch/squash context or adjust Y to match body movement? 
    // Actually drawBlobFace draws in local coords if we didn't restore context, 
    // but we DID restore ctx. The previous code didn't transform the face.
    // Let's re-save context for the face to follow the squash/stretch if we want attached features.
    // But original code drew face AFTER restore, meaning face floats separate from body mesh?
    // Let's keep it AFTER restore for stability, but we need to track the Y offset.
    const faceY = blobY + floatOffset; // Correct Y position accounting for float
    
    // Wait, the original code drew face inside the restore block? 
    // No, `drawBlobFace` call was inside the restore block in my READ.
    
    // Re-apply translation for face
    ctx.save();
    ctx.translate(x, blobY);
    ctx.scale(stretch, squash);
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
   * Helper: Hex to RGBA
   */
  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Draw blob facial features based on emotion
   */
  drawBlobFace(ctx, emotion, size, isStale) {
    // ONE BIG EYE (Cyclops style like B.O.B.)
    const eyeY = -size * 0.25;
    const eyeSize = size * 0.45; // Huge single eye
    
    // Eyes (glossy, iridescent)
    const irisLight = isStale ? '#9ca3af' : '#e0f2fe';
    const irisDark = isStale ? '#6b7280' : '#4f46e5'; // Deep blue/indigo
    const pupilColor = isStale ? '#4b5563' : '#0f172a';
    const eyeWhite = isStale ? 'rgba(229, 231, 235, 0.8)' : 'rgba(255, 255, 255, 0.95)';

    const drawEye = (ex, ey, mood) => {
      // Eyeball
      ctx.fillStyle = eyeWhite;
      ctx.beginPath();
      // Slightly oblate for cartoon feel
      ctx.ellipse(ex, ey, eyeSize, eyeSize * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iris (Large)
      const irisGradient = ctx.createRadialGradient(
        ex - eyeSize * 0.1,
        ey - eyeSize * 0.1,
        eyeSize * 0.1,
        ex,
        ey,
        eyeSize * 0.75
      );
      irisGradient.addColorStop(0, irisLight);
      irisGradient.addColorStop(1, irisDark);
      ctx.fillStyle = irisGradient;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeSize * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = pupilColor;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeSize * 0.25, 0, Math.PI * 2);
      ctx.fill();

      // Specular Highlights (Sharp)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(ex - eyeSize * 0.25, ey - eyeSize * 0.25, eyeSize * 0.15, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(ex + eyeSize * 0.2, ey + eyeSize * 0.2, eyeSize * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // Mood Eyelid (Cyclops)
      if (mood === 'sad') {
        // Heavy lid
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; 
        ctx.beginPath();
        ctx.rect(ex - eyeSize, ey - eyeSize, eyeSize*2, eyeSize*0.8);
        ctx.fill();
        
        ctx.strokeStyle = isStale ? '#6b7280' : '#1e3a8a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(ex, ey, eyeSize, 1.1 * Math.PI, 1.9 * Math.PI);
        ctx.stroke();
      } else if (mood === 'happy') {
        // Cheek squash from bottom? Or just wide eye.
        // Let's add a lower lid curve for happy squint
      }
    };

    drawEye(0, eyeY, emotion);
    
    // Mouth
    const mouthY = size * 0.35;
    const mouthWidth = size * 0.35;
    
    ctx.strokeStyle = isStale ? '#6b7280' : '#1e3a8a'; // Dark blue ink for mouth
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    
    if (emotion === 'sad') {
      ctx.arc(0, mouthY + size*0.1, mouthWidth, 1.2 * Math.PI, 1.8 * Math.PI);
    } else if (emotion === 'neutral') {
      ctx.moveTo(-mouthWidth*0.5, mouthY);
      ctx.lineTo(mouthWidth*0.5, mouthY);
    } else {
      // Big toothless gummy smile
      ctx.arc(0, mouthY - size*0.05, mouthWidth, 0.2 * Math.PI, 0.8 * Math.PI);
      
      // Add optional smile dimples
      ctx.moveTo(-mouthWidth * 1.1, mouthY - size*0.05);
      ctx.lineTo(-mouthWidth * 0.9, mouthY + size*0.05);
      ctx.moveTo(mouthWidth * 1.1, mouthY - size*0.05);
      ctx.lineTo(mouthWidth * 0.9, mouthY + size*0.05);
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
   * Set up blob hover interaction for Global Help
   */
  setupBlobHoverInteraction() {
    const blobsCanvas = document.getElementById('blobsCanvas');
    if (!blobsCanvas) return;
    
    blobsCanvas.addEventListener('mousemove', (e) => {
      // Only active if Global Help is enabled
      if (!window.LightEngineHelp || !window.LightEngineHelp.isActive()) return;
      if (this.currentView !== 'blobs' || !this.vitalityData) return;
      
      const rect = blobsCanvas.getBoundingClientRect();
      const scaleX = blobsCanvas.width / rect.width;
      const scaleY = blobsCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      let hoveredBlob = null;
      
      // Check collision
      this.blobPositions.forEach((blob) => {
        const dx = x - blob.x;
        const dy = y - blob.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < blob.size) {
          hoveredBlob = blob;
        }
      });
      
      if (hoveredBlob) {
        // Show Global Help
        window.LightEngineHelp.show(
            e.clientX, 
            e.clientY, 
            hoveredBlob.component.label,
            `This blob represents the ${hoveredBlob.component.label} system. Current score: ${hoveredBlob.component.score}/100. Status: ${hoveredBlob.component.status}.`,
            `AI Insight: The ${hoveredBlob.component.label} system is performing ` + (hoveredBlob.component.score > 80 ? 'optimally.' : 'below peak efficiency. Check diagnostic logs.')
        );
        blobsCanvas.style.cursor = 'help';
      } else {
        window.LightEngineHelp.hide();
        blobsCanvas.style.cursor = 'default';
      }
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
