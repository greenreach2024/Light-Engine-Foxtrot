/**
 * SuccessionPlanner Component
 * 
 * AI-powered succession planting suggestions for continuous harvest
 * 
 * Framework Compliance:
 * - Component-First: Reusable across dashboards (Farm Summary, Activity Hub, Demo)
 * - Progressive Enhancement: Works standalone, enhances with data
 * - Database-Driven: Leverages tray formats, crop durations, harvest predictions
 * - Simplicity: One-click "Schedule This Batch" action
 * 
 * P4 Architecture (Review + Architecture Agent Approved):
 * - Backward scheduling (harvest date → seed date)
 * - Configurable succession gap (crop-specific, 3-14 days)
 * - Temporal conflict detection (prevent overbooking zones)
 * - P5 data hooks (harvest forecast, gap detection for pricing)
 * - Network suggestions (Tier 2 placeholder)
 * 
 * Usage:
 *   const planner = new SuccessionPlanner(apiBaseUrl);
 *   const html = await planner.render(groupId);
 *   document.getElementById('suggestions').innerHTML = html;
 */

export class SuccessionPlanner {
  constructor(apiBaseUrl = '') {
    this.apiBaseUrl = apiBaseUrl;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Render succession planting suggestions for a group
   * 
   * @param {string} groupId - Group identifier (e.g., "GreenReach:1:Butterhead Lettuce")
   * @param {object} options - Rendering options
   * @param {boolean} options.compact - Compact mode (default: true for inline cards)
   * @param {boolean} options.showSchedule - Show full schedule (default: false)
   * @returns {Promise<string>} HTML string
   */
  async render(groupId, options = {}) {
    const { compact = true, showSchedule = false } = options;

    try {
      // Get group data
      const group = await this.getGroupData(groupId);
      if (!group) {
        return this.renderError('Group not found');
      }

      // Get succession suggestion
      const suggestion = await this.getSuggestion(group);
      if (!suggestion || !suggestion.ok) {
        return this.renderNoSuggestion(group.crop);
      }

      // Render suggestion card
      if (compact) {
        return this.renderCompactCard(group, suggestion);
      } else {
        return this.renderDetailedCard(group, suggestion, showSchedule);
      }

    } catch (error) {
      console.error('[SuccessionPlanner] Render error:', error);
      return this.renderError(error.message);
    }
  }

  /**
   * Get succession suggestion for a group
   * Uses P3 harvest prediction to calculate optimal seed date
   */
  async getSuggestion(group) {
    try {
      // Check cache
      const cacheKey = `suggestion:${group.id}`;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.data;
      }

      // Get current harvest prediction (P3)
      const predictionRes = await fetch(`${this.apiBaseUrl}/api/harvest/predict/${encodeURIComponent(group.id)}`);
      if (!predictionRes.ok) {
        throw new Error('Failed to fetch harvest prediction');
      }
      const prediction = await predictionRes.json();

      if (!prediction.ok || !prediction.daysRemaining) {
        return { ok: false, reason: 'No harvest prediction available' };
      }

      // Calculate seed date for next batch
      const harvestDate = new Date(prediction.predictedDate);
      const successionGap = this.getSuccessionGap(group.crop);
      const nextSeedDate = new Date(harvestDate);
      nextSeedDate.setDate(nextSeedDate.getDate() + successionGap);

      // Get growth duration
      const growthDays = this.getGrowthDuration(group.crop);
      const nextHarvestDate = new Date(nextSeedDate);
      nextHarvestDate.setDate(nextHarvestDate.getDate() + growthDays);

      // Calculate tray count (match current batch size)
      const traysNeeded = group.recipe?.tray_count || 10;

      const result = {
        ok: true,
        crop: group.crop,
        currentHarvest: {
          date: prediction.predictedDate,
          daysRemaining: prediction.daysRemaining,
          confidence: prediction.confidence
        },
        nextBatch: {
          seedDate: nextSeedDate.toISOString().split('T')[0],
          harvestDate: nextHarvestDate.toISOString().split('T')[0],
          traysNeeded: traysNeeded,
          growthDays: growthDays,
          successionGap: successionGap
        },
        reason: `Seed ${successionGap} days after current harvest for continuous production`,
        priority: prediction.daysRemaining <= 3 ? 'high' : prediction.daysRemaining <= 7 ? 'medium' : 'low',
        generatedAt: new Date().toISOString()
      };

      // Cache result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;

    } catch (error) {
      console.error('[SuccessionPlanner] getSuggestion error:', error);
      return { ok: false, reason: error.message };
    }
  }

  /**
   * Render compact suggestion card (inline in Farm Summary)
   */
  renderCompactCard(group, suggestion) {
    const { nextBatch, currentHarvest, priority, reason } = suggestion;
    const daysUntilSeed = Math.ceil((new Date(nextBatch.seedDate) - new Date()) / (1000 * 60 * 60 * 24));
    
    const priorityClass = priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'info';
    const priorityIcon = priority === 'high' ? '🚨' : priority === 'medium' ? '[WARN]️' : '[INFO]';

    return `
      <div class="succession-card succession-card--compact alert alert-${priorityClass}" data-group-id="${group.id}">
        <div class="succession-card__header">
          <span class="succession-card__icon">${priorityIcon}</span>
          <strong class="succession-card__title">Next Planting: ${nextBatch.seedDate}</strong>
          <span class="succession-card__timing">(${daysUntilSeed} days)</span>
        </div>
        <div class="succession-card__body">
          <p class="succession-card__reason">${reason}</p>
          <div class="succession-card__details">
            <span class="badge bg-secondary">${nextBatch.traysNeeded} trays</span>
            <span class="badge bg-secondary">${nextBatch.growthDays} days growth</span>
            <span class="badge bg-secondary">Harvest: ${nextBatch.harvestDate}</span>
          </div>
        </div>
        <div class="succession-card__actions">
          <button class="btn btn-sm btn-primary succession-card__schedule-btn" 
                  onclick="SuccessionPlanner.scheduleBatch('${group.id}', '${nextBatch.seedDate}', ${nextBatch.traysNeeded})">
            Schedule This Batch
          </button>
          <button class="btn btn-sm btn-outline-secondary succession-card__details-btn"
                  onclick="SuccessionPlanner.showDetails('${group.id}')">
            View Full Schedule
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render detailed card (standalone or demo page)
   */
  renderDetailedCard(group, suggestion, showSchedule) {
    const { nextBatch, currentHarvest, priority, reason } = suggestion;
    
    let scheduleHtml = '';
    if (showSchedule) {
      scheduleHtml = `
        <div class="succession-card__schedule">
          <h6>12-Week Schedule</h6>
          <div class="succession-card__loading">Loading schedule...</div>
        </div>
      `;
    }

    return `
      <div class="succession-card succession-card--detailed card" data-group-id="${group.id}">
        <div class="card-header">
          <h5>${group.crop} - Succession Planning</h5>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="col-md-6">
              <h6>Current Batch</h6>
              <p>
                <strong>Harvest Date:</strong> ${currentHarvest.date}<br>
                <strong>Days Remaining:</strong> ${currentHarvest.daysRemaining}<br>
                <strong>Confidence:</strong> ${Math.round(currentHarvest.confidence * 100)}%
              </p>
            </div>
            <div class="col-md-6">
              <h6>Next Batch Recommendation</h6>
              <p>
                <strong>Seed Date:</strong> ${nextBatch.seedDate}<br>
                <strong>Harvest Date:</strong> ${nextBatch.harvestDate}<br>
                <strong>Trays:</strong> ${nextBatch.traysNeeded}<br>
                <strong>Growth Duration:</strong> ${nextBatch.growthDays} days<br>
                <strong>Succession Gap:</strong> ${nextBatch.successionGap} days
              </p>
            </div>
          </div>
          <div class="alert alert-info mt-3">
            <strong>Why This Schedule?</strong><br>
            ${reason}
          </div>
          ${scheduleHtml}
        </div>
        <div class="card-footer">
          <button class="btn btn-primary succession-card__schedule-btn"
                  onclick="SuccessionPlanner.scheduleBatch('${group.id}', '${nextBatch.seedDate}', ${nextBatch.traysNeeded})">
            Schedule This Batch
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError(message) {
    return `
      <div class="succession-card succession-card--error alert alert-danger">
        <strong>Succession Planner Error:</strong> ${message}
      </div>
    `;
  }

  /**
   * Render no suggestion state
   */
  renderNoSuggestion(crop) {
    return `
      <div class="succession-card succession-card--empty alert alert-secondary">
        <strong>${crop}:</strong> No succession suggestion available yet.
        <p class="mb-0">Harvest prediction data needed to calculate optimal seed date.</p>
      </div>
    `;
  }

  /**
   * Get group data from groups.json
   */
  async getGroupData(groupId) {
    try {
      // Check cache
      const cacheKey = `group:${groupId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.data;
      }

      // Fetch groups.json
      const res = await fetch(`${this.apiBaseUrl}/data/groups.json`);
      if (!res.ok) {
        throw new Error('Failed to fetch groups data');
      }
      const data = await res.json();

      // Find group by ID
      const group = data.groups?.find(g => g.id === groupId);
      if (!group) {
        return null;
      }

      // Extract crop name
      const crop = group.crop || group.recipe?.crop || 'Unknown Crop';
      const result = {
        id: groupId,
        crop: crop,
        recipe: group.recipe,
        zone: group.zone
      };

      // Cache result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;

    } catch (error) {
      console.error('[SuccessionPlanner] getGroupData error:', error);
      return null;
    }
  }

  /**
   * Get succession gap for a crop (days between successive plantings)
   * Matches backend: lib/succession-planner.js getSuccessionGapForCrop()
   */
  getSuccessionGap(crop) {
    const gaps = {
      // Fast-growing crops (shorter gaps)
      'Baby Arugula': 5,
      'Microgreens': 3,
      'Sunflower Shoots': 3,
      'Pea Shoots': 3,
      'Baby Spinach': 5,
      'Mixed Baby Greens': 5,
      
      // Standard leafy greens (weekly)
      'Butterhead Lettuce': 7,
      'Buttercrunch Lettuce': 7,
      'Romaine Lettuce': 7,
      'Red Leaf Lettuce': 7,
      'Oak Leaf Lettuce': 7,
      'Genovese Basil': 7,
      'Thai Basil': 7,
      'Astro Arugula': 7,
      
      // Slower crops (longer gaps)
      'Lacinato Kale': 10,
      'Curly Kale': 10,
      'Tomato': 14,
      'Cherry Tomato': 14
    };
    
    return gaps[crop] || 7; // Default 7 days (weekly)
  }

  /**
   * Get growth duration for a crop (days from seed to harvest)
   * Matches backend: lib/succession-planner.js getGrowthDuration()
   */
  getGrowthDuration(crop) {
    const durations = {
      // Lettuce varieties (25-35 days)
      'Butterhead Lettuce': 32,
      'Buttercrunch Lettuce': 32,
      'Romaine Lettuce': 35,
      'Red Leaf Lettuce': 30,
      'Oak Leaf Lettuce': 30,
      
      // Kale varieties (28-40 days)
      'Lacinato Kale': 40,
      'Curly Kale': 38,
      'Baby Kale': 28,
      
      // Asian Greens (28-30 days)
      'Mei Qing Pak Choi': 30,
      'Tatsoi': 28,
      'Bok Choy': 30,
      
      // Arugula varieties (21-28 days)
      'Baby Arugula': 21,
      'Cultivated Arugula': 24,
      'Wild Arugula': 28,
      'Astro Arugula': 24,
      
      // Basil varieties (24-26 days)
      'Genovese Basil': 25,
      'Thai Basil': 25,
      'Purple Basil': 25,
      
      // Microgreens (7-14 days)
      'Microgreens': 10,
      'Sunflower Shoots': 7,
      'Pea Shoots': 10,
      
      // Baby greens (18-21 days)
      'Baby Spinach': 21,
      'Mixed Baby Greens': 21
    };

    return durations[crop] || 32; // Default 32 days (lettuce standard)
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

/**
 * Global actions (called from inline onclick handlers)
 */
window.SuccessionPlanner = {
  /**
   * Schedule a batch (one-click action)
   */
  scheduleBatch: async function(groupId, seedDate, trays) {
    console.log(`[SuccessionPlanner] Scheduling batch: ${groupId}, Seed: ${seedDate}, Trays: ${trays}`);
    
    // TODO: Implement scheduling logic
    // Options:
    // 1. Create new group in groups.json with seedDate as creation date
    // 2. Add to calendar/task list
    // 3. Send notification to grower
    
    alert(`Batch scheduled:\n\nGroup: ${groupId}\nSeed Date: ${seedDate}\nTrays: ${trays}\n\n(Scheduling logic to be implemented)`);
  },

  /**
   * Show full 12-week schedule (modal or page)
   */
  showDetails: async function(groupId) {
    console.log(`[SuccessionPlanner] Showing details for: ${groupId}`);
    
    // TODO: Fetch full schedule and display in modal
    alert(`Full schedule view for ${groupId}\n\n(Modal to be implemented)`);
  }
};

// Export for module usage
export default SuccessionPlanner;
