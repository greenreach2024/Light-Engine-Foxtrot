/**
 * Harvest Prediction UI Component
 * Fetches and displays AI-powered harvest predictions for groups
 * 
 * Usage:
 * <script src="harvest-predictions.js"></script>
 * <div id="harvest-predictions"></div>
 * <script>
 *   const predictions = new HarvestPredictions('harvest-predictions');
 *   predictions.loadForGroup('GRP-001');  // Single group
 *   predictions.loadAll();                 // All active groups
 * </script>
 */

class HarvestPredictions {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.baseUrl = options.baseUrl || '';
    this.autoRefresh = options.autoRefresh || false;
    this.refreshInterval = options.refreshInterval || 300000; // 5 minutes
    this.predictions = new Map();
    
    if (this.autoRefresh) {
      setInterval(() => this.refresh(), this.refreshInterval);
    }
  }

  /**
   * Load prediction for a single group
   */
  async loadForGroup(groupId, options = {}) {
    try {
      const queryParams = new URLSearchParams(options).toString();
      const url = `${this.baseUrl}/api/harvest/predictions/${groupId}${queryParams ? '?' + queryParams : ''}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.ok && data.prediction) {
        this.predictions.set(groupId, data.prediction);
        return data.prediction;
      } else {
        console.error(`Failed to load prediction for ${groupId}:`, data.error);
        return null;
      }
    } catch (error) {
      console.error(`Error loading prediction for ${groupId}:`, error);
      return null;
    }
  }

  /**
   * Load predictions for all active groups
   */
  async loadAll() {
    try {
      const response = await fetch(`${this.baseUrl}/api/harvest/predictions/all`);
      const data = await response.json();

      if (data.ok && data.predictions) {
        data.predictions.forEach(pred => {
          if (!pred.error) {
            this.predictions.set(pred.groupId, pred);
          }
        });
        return data.predictions;
      } else {
        console.error('Failed to load predictions:', data.error);
        return [];
      }
    } catch (error) {
      console.error('Error loading predictions:', error);
      return [];
    }
  }

  /**
   * Refresh current predictions
   */
  async refresh() {
    const groupIds = Array.from(this.predictions.keys());
    if (groupIds.length > 0) {
      await this.loadBatch(groupIds);
    }
  }

  /**
   * Load predictions for multiple groups
   */
  async loadBatch(groupIds, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/api/harvest/predictions/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds, options })
      });

      const data = await response.json();

      if (data.ok && data.predictions) {
        data.predictions.forEach(pred => {
          if (!pred.error) {
            this.predictions.set(pred.groupId, pred);
          }
        });
        return data.predictions;
      } else {
        console.error('Failed to load batch predictions:', data.error);
        return [];
      }
    } catch (error) {
      console.error('Error loading batch predictions:', error);
      return [];
    }
  }

  /**
   * Get prediction for a group (from cache)
   */
  get(groupId) {
    return this.predictions.get(groupId);
  }

  /**
   * Render prediction badge (compact inline display)
   */
  renderBadge(groupId) {
    const prediction = this.predictions.get(groupId);
    if (!prediction) {
      return '<span class="harvest-badge harvest-badge-unknown">Calculating...</span>';
    }

    const daysRemaining = prediction.daysRemaining;
    const confidence = Math.round(prediction.confidence * 100);

    let badgeClass = 'harvest-badge';
    let label = '';

    if (daysRemaining < 0) {
      badgeClass += ' harvest-badge-overdue';
      const daysText = Math.abs(daysRemaining) === 1 ? 'day' : 'days';
      label = `Overdue ${Math.abs(daysRemaining)} ${daysText}`;
    } else if (daysRemaining === 0) {
      badgeClass += ' harvest-badge-today';
      label = 'Ready today';
    } else if (daysRemaining <= 3) {
      badgeClass += ' harvest-badge-soon';
      const daysText = daysRemaining === 1 ? 'day' : 'days';
      label = `Ready in ${daysRemaining} ${daysText}`;
    } else if (daysRemaining <= 7) {
      badgeClass += ' harvest-badge-week';
      const daysText = daysRemaining === 1 ? 'day' : 'days';
      label = `Ready in ${daysRemaining} ${daysText}`;
    } else {
      badgeClass += ' harvest-badge-future';
      const daysText = daysRemaining === 1 ? 'day' : 'days';
      label = `Ready in ${daysRemaining} ${daysText}`;
    }

    return `<span class="${badgeClass}" title="${confidence}% confident">${label}</span>`;
  }

  /**
   * Render detailed prediction card
   */
  renderCard(groupId) {
    const prediction = this.predictions.get(groupId);
    if (!prediction) {
      return `
        <div class="harvest-card harvest-card-loading">
          <div class="harvest-card-header">
            <span>Loading prediction...</span>
          </div>
        </div>
      `;
    }

    const daysRemaining = prediction.daysRemaining;
    const confidence = Math.round(prediction.confidence * 100);
    const predictedDate = new Date(prediction.predictedDate).toLocaleDateString();
    const seedDate = new Date(prediction.seedDate).toLocaleDateString();

    // Confidence bar color
    let confidenceColor = '#10b981'; // green
    if (confidence < 70) confidenceColor = '#f59e0b'; // yellow
    if (confidence < 50) confidenceColor = '#ef4444'; // red

    // Factors list
    const factorsHtml = prediction.factors.map(factor => {
      const factorLabel = factor.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<li>${factorLabel}</li>`;
    }).join('');

    // Adjustments
    const adjustmentsHtml = prediction.adjustments.total !== 0
      ? `
        <div class="harvest-adjustments">
          <strong>Adjustments:</strong>
          ${prediction.adjustments.historical !== 0 ? `<div>Historical: ${prediction.adjustments.historical > 0 ? '+' : ''}${prediction.adjustments.historical} days</div>` : ''}
          ${prediction.adjustments.environmental !== 0 ? `<div>Environmental: ${prediction.adjustments.environmental > 0 ? '+' : ''}${prediction.adjustments.environmental} days</div>` : ''}
        </div>
      `
      : '';

    return `
      <div class="harvest-card">
        <div class="harvest-card-header">
          <div>
            <div class="harvest-crop">${prediction.crop}</div>
            <div class="harvest-dates">Seeded: ${seedDate}</div>
          </div>
          ${this.renderBadge(groupId)}
        </div>

        <div class="harvest-card-body">
          <div class="harvest-prediction">
            <div class="harvest-prediction-label">Predicted Harvest</div>
            <div class="harvest-prediction-value">${predictedDate}</div>
            <div class="harvest-prediction-sublabel">${daysRemaining} days from now</div>
          </div>

          <div class="harvest-confidence">
            <div class="harvest-confidence-label">
              <span>Confidence</span>
              <span>${confidence}%</span>
            </div>
            <div class="harvest-confidence-bar">
              <div class="harvest-confidence-fill" style="width: ${confidence}%; background: ${confidenceColor};"></div>
            </div>
          </div>

          ${adjustmentsHtml}

          <div class="harvest-factors">
            <strong>Prediction factors:</strong>
            <ul>${factorsHtml}</ul>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render all predictions in container
   */
  renderAll() {
    if (!this.container) return;

    if (this.predictions.size === 0) {
      this.container.innerHTML = `
        <div class="harvest-empty">
          <p>No harvest predictions available</p>
          <button onclick="harvestPredictions.loadAll()">Load Predictions</button>
        </div>
      `;
      return;
    }

    const cardsHtml = Array.from(this.predictions.keys())
      .map(groupId => this.renderCard(groupId))
      .join('');

    this.container.innerHTML = `
      <div class="harvest-predictions-grid">
        ${cardsHtml}
      </div>
    `;
  }

  /**
   * Inject CSS styles
   */
  injectStyles() {
    if (document.getElementById('harvest-predictions-styles')) return;

    const style = document.createElement('style');
    style.id = 'harvest-predictions-styles';
    style.textContent = `
      .harvest-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .harvest-badge-today {
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
      }

      .harvest-badge-soon {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      }

      .harvest-badge-week {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
      }

      .harvest-badge-future {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      }

      .harvest-badge-overdue {
        background: linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(127, 29, 29, 0.4);
      }

      .harvest-badge-unknown {
        background: linear-gradient(135deg, #475569 0%, #334155 100%);
        color: #cbd5e1;
        box-shadow: 0 2px 8px rgba(71, 85, 105, 0.3);
      }

      .harvest-predictions-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1rem;
        margin: 1rem 0;
      }

      .harvest-card {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
      }

      .harvest-card:hover {
        border-color: rgba(59, 130, 246, 0.4);
        box-shadow: 0 8px 24px rgba(59, 130, 246, 0.15);
        transform: translateY(-2px);
      }

      .harvest-card-loading {
        opacity: 0.6;
        text-align: center;
        padding: 2rem;
      }

      .harvest-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      }

      .harvest-crop {
        font-size: 1.125rem;
        font-weight: 600;
        color: #f8fafc;
        margin-bottom: 0.25rem;
      }

      .harvest-dates {
        font-size: 0.875rem;
        color: #94a3b8;
      }

      .harvest-card-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .harvest-prediction {
        background: rgba(59, 130, 246, 0.05);
        border-left: 3px solid #3b82f6;
        padding: 0.75rem;
        border-radius: 4px;
      }

      .harvest-prediction-label {
        font-size: 0.75rem;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 0.25rem;
      }

      .harvest-prediction-value {
        font-size: 1.25rem;
        font-weight: 600;
        color: #3b82f6;
        margin-bottom: 0.25rem;
      }

      .harvest-prediction-sublabel {
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .harvest-confidence {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .harvest-confidence-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .harvest-confidence-bar {
        height: 8px;
        background: rgba(148, 163, 184, 0.2);
        border-radius: 4px;
        overflow: hidden;
      }

      .harvest-confidence-fill {
        height: 100%;
        transition: width 0.3s ease;
        border-radius: 4px;
      }

      .harvest-adjustments {
        font-size: 0.875rem;
        color: #cbd5e1;
        padding: 0.5rem;
        background: rgba(15, 23, 42, 0.4);
        border-radius: 4px;
      }

      .harvest-adjustments div {
        margin-top: 0.25rem;
      }

      .harvest-factors {
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .harvest-factors strong {
        display: block;
        margin-bottom: 0.5rem;
        color: #f8fafc;
      }

      .harvest-factors ul {
        list-style: none;
        padding-left: 0;
        margin: 0;
      }

      .harvest-factors li {
        padding: 0.25rem 0;
        padding-left: 1.5rem;
        position: relative;
      }

      .harvest-factors li:before {
        content: "•";
        position: absolute;
        left: 0.5rem;
        color: #3b82f6;
      }

      .harvest-empty {
        text-align: center;
        padding: 3rem;
        color: #94a3b8;
      }

      .harvest-empty button {
        margin-top: 1rem;
        padding: 0.5rem 1rem;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.875rem;
      }

      .harvest-empty button:hover {
        background: #2563eb;
      }
    `;

    document.head.appendChild(style);
  }
}

// Global instance for easy access
let harvestPredictions;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('harvest-predictions');
  if (container) {
    harvestPredictions = new HarvestPredictions('harvest-predictions', {
      autoRefresh: true,
      refreshInterval: 300000 // 5 minutes
    });
    harvestPredictions.injectStyles();
  }
});
