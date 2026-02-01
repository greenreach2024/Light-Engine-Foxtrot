/**
 * Anomaly Diagnostics Display Component
 * 
 * Shows diagnostic information for detected anomalies with actionable suggestions.
 * Progressive rendering: adapts to available data context.
 */

class AnomalyDiagnosticsDisplay {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.baseUrl = options.baseUrl || '';
    this.autoRefresh = options.autoRefresh || false;
    this.refreshInterval = options.refreshInterval || 300000; // 5 minutes
    this.diagnostics = [];
    this.summary = null;
    
    if (this.autoRefresh) {
      setInterval(() => this.refresh(), this.refreshInterval);
    }
  }

  /**
   * Load diagnostics from API
   */
  async load() {
    try {
      const response = await fetch(`${this.baseUrl}/api/ml/diagnostics`);
      const data = await response.json();

      if (data.ok) {
        this.diagnostics = data.diagnostics || [];
        this.summary = data.summary || {};
        return { diagnostics: this.diagnostics, summary: this.summary };
      } else {
        console.error('Failed to load diagnostics:', data.error);
        return { diagnostics: [], summary: {} };
      }
    } catch (error) {
      console.error('Error loading diagnostics:', error);
      return { diagnostics: [], summary: {} };
    }
  }

  /**
   * Refresh diagnostics
   */
  async refresh() {
    await this.load();
    this.renderAll();
  }

  /**
   * Render diagnostic card
   */
  renderCard(diagnostic) {
    const diag = diagnostic.diagnosis;
    const urgencyClass = `diagnostic-${diag.urgency}`;
    const categoryIcon = this._getCategoryIcon(diag.category);
    
    // Format suggestions as list
    const suggestionsHtml = diag.suggestions && diag.suggestions.length > 0
      ? `
        <div class="diagnostic-suggestions">
          <div class="suggestions-header">Recommended Actions:</div>
          <ul class="suggestions-list">
            ${diag.suggestions.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      `
      : '';

    // Weather badge
    const weatherBadge = diag.weatherRelated
      ? '<span class="weather-badge">Weather-Related</span>'
      : '';

    return `
      <div class="diagnostic-card ${urgencyClass}">
        <div class="diagnostic-header">
          <div class="diagnostic-title">
            <span class="diagnostic-icon">${categoryIcon}</span>
            <span class="diagnostic-zone">${diagnostic.zone_name || diagnostic.zone}</span>
            ${weatherBadge}
          </div>
          <div class="diagnostic-urgency-badge urgency-${diag.urgency}">
            ${diag.urgency.toUpperCase()}
          </div>
        </div>

        <div class="diagnostic-body">
          <div class="diagnostic-cause">
            <strong>Detected:</strong> ${diag.rootCause || 'Environmental anomaly'}
          </div>

          <div class="diagnostic-metrics">
            <div class="metric">
              <span class="metric-label">Temperature:</span>
              <span class="metric-value">${diagnostic.indoor_temp?.toFixed(1)}°C</span>
            </div>
            <div class="metric">
              <span class="metric-label">Humidity:</span>
              <span class="metric-value">${diagnostic.indoor_rh?.toFixed(0)}%</span>
            </div>
            ${diagnostic.outdoor_temp ? `
              <div class="metric">
                <span class="metric-label">Outdoor:</span>
                <span class="metric-value">${diagnostic.outdoor_temp?.toFixed(1)}°C</span>
              </div>
            ` : ''}
          </div>

          <div class="diagnostic-confidence">
            <div class="confidence-label">Confidence: ${Math.round(diag.confidence * 100)}%</div>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width: ${diag.confidence * 100}%"></div>
            </div>
          </div>

          ${suggestionsHtml}
        </div>

        <div class="diagnostic-footer">
          <span class="diagnostic-time">${new Date(diagnostic.timestamp).toLocaleString()}</span>
        </div>
      </div>
    `;
  }

  /**
   * Render summary card
   */
  renderSummary() {
    if (!this.summary || this.summary.total === 0) {
      return `
        <div class="diagnostic-summary diagnostic-summary-ok">
          <div class="summary-icon">✓</div>
          <div class="summary-message">${this.summary?.message || 'All systems normal'}</div>
        </div>
      `;
    }

    const urgencyClass = this.summary.needsAttention > 0 ? 'diagnostic-summary-alert' : 'diagnostic-summary-info';

    return `
      <div class="diagnostic-summary ${urgencyClass}">
        <div class="summary-header">
          <h3>Diagnostic Summary</h3>
        </div>
        <div class="summary-body">
          <div class="summary-message">${this.summary.message}</div>
          <div class="summary-stats">
            <div class="summary-stat">
              <span class="stat-value">${this.summary.total}</span>
              <span class="stat-label">Total Issues</span>
            </div>
            <div class="summary-stat">
              <span class="stat-value">${this.summary.needsAttention}</span>
              <span class="stat-label">Need Attention</span>
            </div>
            <div class="summary-stat">
              <span class="stat-value">${this.summary.weatherRelated}</span>
              <span class="stat-label">Weather-Related</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render all diagnostics
   */
  renderAll() {
    if (!this.container) return;

    const summaryHtml = this.renderSummary();
    
    if (this.diagnostics.length === 0) {
      this.container.innerHTML = summaryHtml;
      return;
    }

    // Sort by urgency
    const sortedDiagnostics = [...this.diagnostics].sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return urgencyOrder[a.diagnosis.urgency] - urgencyOrder[b.diagnosis.urgency];
    });

    const cardsHtml = sortedDiagnostics.map(d => this.renderCard(d)).join('');

    this.container.innerHTML = `
      ${summaryHtml}
      <div class="diagnostics-grid">
        ${cardsHtml}
      </div>
    `;
  }

  /**
   * Get category icon
   */
  _getCategoryIcon(category) {
    const icons = {
      weather_correlated: 'Weather',
      sensor_issue: 'Sensor',
      equipment_failure: 'Equipment',
      control_loop: 'Control',
      environmental: 'Environment'
    };
    return icons[category] || 'Alert';
  }

  /**
   * Inject CSS styles
   */
  injectStyles() {
    if (document.getElementById('diagnostic-styles')) return;

    const style = document.createElement('style');
    style.id = 'diagnostic-styles';
    style.textContent = `
      .diagnostic-summary {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        border-left: 4px solid #3b82f6;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .diagnostic-summary-ok {
        border-left-color: #10b981;
      }

      .diagnostic-summary-alert {
        border-left-color: #ef4444;
      }

      .diagnostic-summary-info {
        border-left-color: #f59e0b;
      }

      .summary-header h3 {
        margin: 0 0 1rem 0;
        color: #f8fafc;
        font-size: 1.25rem;
      }

      .summary-message {
        font-size: 1rem;
        color: #cbd5e1;
        margin-bottom: 1rem;
      }

      .summary-stats {
        display: flex;
        gap: 2rem;
        margin-top: 1rem;
      }

      .summary-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .stat-value {
        font-size: 2rem;
        font-weight: 700;
        color: #3b82f6;
      }

      .stat-label {
        font-size: 0.875rem;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .diagnostics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
        gap: 1rem;
      }

      .diagnostic-card {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        padding: 1.25rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.3s ease;
      }

      .diagnostic-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }

      .diagnostic-critical {
        border-left: 4px solid #dc2626;
      }

      .diagnostic-high {
        border-left: 4px solid #f59e0b;
      }

      .diagnostic-medium {
        border-left: 4px solid #3b82f6;
      }

      .diagnostic-low {
        border-left: 4px solid #10b981;
      }

      .diagnostic-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      }

      .diagnostic-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .diagnostic-icon {
        font-size: 0.875rem;
        color: #94a3b8;
        padding: 0.25rem 0.5rem;
        background: rgba(148, 163, 184, 0.1);
        border-radius: 4px;
      }

      .diagnostic-zone {
        font-size: 1.125rem;
        font-weight: 600;
        color: #f8fafc;
      }

      .weather-badge {
        font-size: 0.75rem;
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        border: 1px solid rgba(59, 130, 246, 0.3);
      }

      .diagnostic-urgency-badge {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .urgency-critical {
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        color: #ffffff;
      }

      .urgency-high {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: #ffffff;
      }

      .urgency-medium {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: #ffffff;
      }

      .urgency-low {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #ffffff;
      }

      .diagnostic-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .diagnostic-cause {
        color: #cbd5e1;
        font-size: 0.95rem;
        line-height: 1.5;
      }

      .diagnostic-metrics {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .metric {
        display: flex;
        flex-direction: column;
        padding: 0.5rem;
        background: rgba(15, 23, 42, 0.4);
        border-radius: 6px;
        min-width: 100px;
      }

      .metric-label {
        font-size: 0.75rem;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .metric-value {
        font-size: 1.125rem;
        font-weight: 600;
        color: #f8fafc;
      }

      .diagnostic-confidence {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .confidence-label {
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .confidence-bar {
        height: 6px;
        background: rgba(148, 163, 184, 0.2);
        border-radius: 3px;
        overflow: hidden;
      }

      .confidence-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
        transition: width 0.3s ease;
      }

      .diagnostic-suggestions {
        margin-top: 0.5rem;
      }

      .suggestions-header {
        font-weight: 600;
        color: #f8fafc;
        margin-bottom: 0.5rem;
        font-size: 0.95rem;
      }

      .suggestions-list {
        list-style: none;
        padding-left: 0;
        margin: 0;
      }

      .suggestions-list li {
        padding: 0.5rem 0;
        padding-left: 1.5rem;
        position: relative;
        color: #cbd5e1;
        font-size: 0.9rem;
        line-height: 1.5;
        border-left: 2px solid rgba(59, 130, 246, 0.3);
        margin-bottom: 0.25rem;
      }

      .suggestions-list li:before {
        content: "→";
        position: absolute;
        left: 0.5rem;
        color: #3b82f6;
      }

      .diagnostic-footer {
        margin-top: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid rgba(148, 163, 184, 0.15);
        display: flex;
        justify-content: flex-end;
      }

      .diagnostic-time {
        font-size: 0.75rem;
        color: #94a3b8;
      }
    `;

    document.head.appendChild(style);
  }
}

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('anomaly-diagnostics');
  if (container) {
    window.anomalyDiagnostics = new AnomalyDiagnosticsDisplay('anomaly-diagnostics', {
      autoRefresh: true,
      refreshInterval: 300000 // 5 minutes
    });
    anomalyDiagnostics.injectStyles();
    anomalyDiagnostics.load().then(() => anomalyDiagnostics.renderAll());
  }
});
