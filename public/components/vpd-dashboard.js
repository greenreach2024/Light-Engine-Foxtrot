/**
 * VPD Automation Dashboard Component
 * 
 * Visualizes VPD control status, zone capabilities, and energy metrics
 * for the hardware-driven automation system.
 * 
 * Features:
 * - Zone capability matrix (what's enabled per zone)
 * - Real-time VPD heatmap (zones × time)
 * - Control regime indicator (in-band, too-low, too-high)
 * - Active controller status
 * - Warnings and recommendations
 * - Energy savings metrics (when ventilation active)
 */

export class VpdDashboard {
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl || '/api/automation/vpd';
    this.refreshInterval = options.refreshInterval || 30000; // 30 seconds
    this.container = options.container || document.getElementById('vpd-dashboard');
    
    this.data = {
      status: null,
      zones: [],
      controlResults: null
    };
    
    this.refreshTimer = null;
  }

  /**
   * Initialize dashboard and start auto-refresh
   */
  async initialize() {
    if (!this.container) {
      console.warn('[VpdDashboard] Container element not found');
      return;
    }

    // Render initial structure
    this._renderStructure();

    // Load initial data
    await this.refresh();

    // Start auto-refresh
    this.startAutoRefresh();
  }

  /**
   * Refresh dashboard data from API
   */
  async refresh() {
    try {
      // Fetch status
      const statusRes = await fetch(`${this.apiBaseUrl}/status`);
      const statusData = await statusRes.json();
      this.data.status = statusData.success ? statusData : null;

      // Fetch zones
      const zonesRes = await fetch(`${this.apiBaseUrl}/zones`);
      const zonesData = await zonesRes.json();
      this.data.zones = zonesData.success ? zonesData.zones : [];

      // Fetch control results
      const resultsRes = await fetch(`${this.apiBaseUrl}/control-results`);
      const resultsData = await resultsRes.json();
      this.data.controlResults = resultsData.success ? resultsData.results : null;

      // Update UI
      this._updateStatusSection();
      this._updateZoneCapabilities();
      this._updateControlResults();

    } catch (error) {
      console.error('[VpdDashboard] Failed to refresh:', error);
      this._showError('Failed to load VPD automation data');
    }
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(() => {
      this.refresh();
    }, this.refreshInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Render dashboard structure
   */
  _renderStructure() {
    this.container.innerHTML = `
      <div class="vpd-dashboard">
        <div class="vpd-dashboard__header">
          <h2>VPD Automation System</h2>
          <div class="vpd-dashboard__status-indicator" id="vpdStatusIndicator">
            <span class="status-dot"></span>
            <span class="status-text">Initializing...</span>
          </div>
        </div>

        <div class="vpd-dashboard__error" id="vpdError" style="display: none;">
          <span class="error-icon">⚠️</span>
          <span class="error-message"></span>
        </div>

        <div class="vpd-dashboard__sections">
          <!-- Active Controllers Section -->
          <section class="vpd-section vpd-section--controllers">
            <h3>Active Controllers</h3>
            <div id="activeControllers" class="controllers-grid">
              <!-- Populated dynamically -->
            </div>
          </section>

          <!-- Zone Capabilities Matrix -->
          <section class="vpd-section vpd-section--capabilities">
            <h3>Zone Capabilities</h3>
            <div class="capabilities-legend">
              <span class="legend-item"><span class="cap-dot cap-enabled"></span>Enabled</span>
              <span class="legend-item"><span class="cap-dot cap-disabled"></span>Disabled</span>
              <span class="legend-item"><span class="cap-dot cap-limited"></span>Limited</span>
            </div>
            <div id="zoneCapabilities" class="capabilities-matrix">
              <!-- Populated dynamically -->
            </div>
          </section>

          <!-- Control Results -->
          <section class="vpd-section vpd-section--control">
            <h3>Real-Time Control Status</h3>
            <div id="controlResults" class="control-grid">
              <!-- Populated dynamically -->
            </div>
          </section>

          <!-- Warnings & Recommendations -->
          <section class="vpd-section vpd-section--feedback">
            <div class="feedback-columns">
              <div class="feedback-col">
                <h4>⚠️ Warnings</h4>
                <ul id="warningsList" class="feedback-list">
                  <!-- Populated dynamically -->
                </ul>
              </div>
              <div class="feedback-col">
                <h4>💡 Recommendations</h4>
                <ul id="recommendationsList" class="feedback-list">
                  <!-- Populated dynamically -->
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  /**
   * Update status section
   */
  _updateStatusSection() {
    const indicator = document.getElementById('vpdStatusIndicator');
    if (!indicator || !this.data.status) return;

    const { initialized, enabled, farmSummary } = this.data.status;

    let statusClass = 'status-unknown';
    let statusText = 'Unknown';

    if (initialized && enabled) {
      statusClass = 'status-active';
      statusText = 'Active';
    } else if (initialized && !enabled) {
      statusClass = 'status-paused';
      statusText = 'Paused';
    } else {
      statusClass = 'status-error';
      statusText = 'Not Initialized';
    }

    indicator.className = `vpd-dashboard__status-indicator ${statusClass}`;
    indicator.querySelector('.status-text').textContent = statusText;

    // Update active controllers
    if (farmSummary) {
      this._updateActiveControllers(farmSummary.activeControllers || []);
    }
  }

  /**
   * Update active controllers display
   */
  _updateActiveControllers(controllers) {
    const container = document.getElementById('activeControllers');
    if (!container) return;

    const controllerNames = {
      vpd: 'VPD Control',
      ventilation: 'Smart Ventilation',
      mixing: 'Air Mixing',
      irrigation: 'Irrigation Pre-emption'
    };

    const controllerDescriptions = {
      vpd: 'Maintains target VPD through fans and dehumidifiers',
      ventilation: 'Uses outdoor air for free cooling/dehumidification',
      mixing: 'Prevents thermal and humidity stratification',
      irrigation: 'Pre-dries and manages moisture around watering'
    };

    if (controllers.length === 0) {
      container.innerHTML = '<p class="no-data">No controllers active</p>';
      return;
    }

    container.innerHTML = controllers.map(id => `
      <div class="controller-card controller-card--${id}">
        <div class="controller-card__icon">${this._getControllerIcon(id)}</div>
        <div class="controller-card__info">
          <h4>${controllerNames[id] || id}</h4>
          <p>${controllerDescriptions[id] || 'Active'}</p>
        </div>
        <div class="controller-card__badge">✓</div>
      </div>
    `).join('');
  }

  /**
   * Get icon for controller type
   */
  _getControllerIcon(id) {
    const icons = {
      vpd: '🌡️',
      ventilation: '🌬️',
      mixing: '🔄',
      irrigation: '💧'
    };
    return icons[id] || '⚙️';
  }

  /**
   * Update zone capabilities matrix
   */
  _updateZoneCapabilities() {
    const container = document.getElementById('zoneCapabilities');
    if (!container || !this.data.zones || this.data.zones.length === 0) {
      if (container) {
        container.innerHTML = '<p class="no-data">No zones configured</p>';
      }
      return;
    }

    // Capability columns
    const capabilities = [
      { id: 'vpdControl', label: 'VPD' },
      { id: 'ventilationControl', label: 'Ventilation' },
      { id: 'mixingControl', label: 'Mixing' },
      { id: 'irrigationPreemption', label: 'Irrigation' }
    ];

    // Build table
    let html = '<table class="capabilities-table"><thead><tr>';
    html += '<th>Zone</th>';
    capabilities.forEach(cap => {
      html += `<th>${cap.label}</th>`;
    });
    html += '</tr></thead><tbody>';

    this.data.zones.forEach(zone => {
      html += `<tr><td class="zone-name">${zone.zoneId}</td>`;
      capabilities.forEach(cap => {
        const enabled = zone.capabilities?.[cap.id] || false;
        const limited = enabled && zone.warnings?.some(w => w.includes(cap.label));
        const cssClass = enabled ? (limited ? 'cap-limited' : 'cap-enabled') : 'cap-disabled';
        const icon = enabled ? (limited ? '◐' : '●') : '○';
        html += `<td><span class="cap-indicator ${cssClass}">${icon}</span></td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  /**
   * Update control results display
   */
  _updateControlResults() {
    const container = document.getElementById('controlResults');
    if (!container) return;

    if (!this.data.controlResults || !this.data.controlResults.zones) {
      container.innerHTML = '<p class="no-data">No control data available</p>';
      return;
    }

    const { zones } = this.data.controlResults;
    const zoneIds = Object.keys(zones);

    if (zoneIds.length === 0) {
      container.innerHTML = '<p class="no-data">No zones under control</p>';
      return;
    }

    container.innerHTML = zoneIds.map(zoneId => {
      const zoneResult = zones[zoneId];
      if (!zoneResult) return '';

      const vpdResult = zoneResult.controllers?.vpd;
      const regime = vpdResult?.regime || 'unknown';
      const actions = zoneResult.actions || [];

      return `
        <div class="control-card">
          <div class="control-card__header">
            <h4>${zoneId}</h4>
            <span class="regime-badge regime-${regime}">${this._formatRegime(regime)}</span>
          </div>
          <div class="control-card__body">
            <div class="control-metric">
              <span class="metric-label">Current VPD:</span>
              <span class="metric-value">${vpdResult?.metrics?.currentVpd?.toFixed(2) || 'N/A'} kPa</span>
            </div>
            <div class="control-metric">
              <span class="metric-label">Target VPD:</span>
              <span class="metric-value">${vpdResult?.metrics?.targetVpd?.toFixed(2) || 'N/A'} kPa</span>
            </div>
            <div class="control-metric">
              <span class="metric-label">Actions:</span>
              <span class="metric-value">${actions.length} pending</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Update warnings and recommendations
    this._updateFeedback();
  }

  /**
   * Update warnings and recommendations
   */
  _updateFeedback() {
    const warningsList = document.getElementById('warningsList');
    const recommendationsList = document.getElementById('recommendationsList');

    if (!warningsList || !recommendationsList) return;

    // Collect all warnings and recommendations from zones
    const warnings = [];
    const recommendations = [];

    if (this.data.controlResults?.zones) {
      Object.values(this.data.controlResults.zones).forEach(zoneResult => {
        if (zoneResult.warnings) {
          warnings.push(...zoneResult.warnings);
        }
        if (zoneResult.recommendations) {
          recommendations.push(...zoneResult.recommendations);
        }
      });
    }

    // Also add farm-level warnings
    if (this.data.status?.farmSummary) {
      if (this.data.status.farmSummary.warnings) {
        warnings.push(...this.data.status.farmSummary.warnings);
      }
      if (this.data.status.farmSummary.recommendations) {
        recommendations.push(...this.data.status.farmSummary.recommendations);
      }
    }

    // Deduplicate
    const uniqueWarnings = [...new Set(warnings)];
    const uniqueRecommendations = [...new Set(recommendations)];

    // Render warnings
    if (uniqueWarnings.length === 0) {
      warningsList.innerHTML = '<li class="no-data">No warnings</li>';
    } else {
      warningsList.innerHTML = uniqueWarnings.map(w => `<li>${w}</li>`).join('');
    }

    // Render recommendations
    if (uniqueRecommendations.length === 0) {
      recommendationsList.innerHTML = '<li class="no-data">No recommendations</li>';
    } else {
      recommendationsList.innerHTML = uniqueRecommendations.map(r => `<li>${r}</li>`).join('');
    }
  }

  /**
   * Format regime for display
   */
  _formatRegime(regime) {
    const regimeLabels = {
      'vpd-in-band': 'In Range',
      'vpd-too-low': 'Too Humid',
      'vpd-too-high': 'Too Dry',
      'vpd-decay': 'Stabilizing',
      'ventilation-enabled': 'Outdoor Assist',
      'outdoor-unfavorable': 'Mechanical Only',
      'stratification-detected': 'Mixing Active',
      'uniform-conditions': 'Uniform',
      'pre-dry': 'Pre-Irrigation',
      'post-irrigation': 'Post-Irrigation',
      'unknown': 'Unknown'
    };

    return regimeLabels[regime] || regime;
  }

  /**
   * Show error message
   */
  _showError(message) {
    const errorEl = document.getElementById('vpdError');
    if (!errorEl) return;

    errorEl.querySelector('.error-message').textContent = message;
    errorEl.style.display = 'block';

    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 5000);
  }

  /**
   * Destroy dashboard (cleanup)
   */
  destroy() {
    this.stopAutoRefresh();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in main app
export default VpdDashboard;
