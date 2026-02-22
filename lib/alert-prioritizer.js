/**
 * Alert Prioritization Model — Phase 3, Ticket 3.9
 *
 * Reduces alert fatigue by scoring anomaly alerts against:
 * - Farm context (what's actually growing, current growth stage)
 * - Historical dismiss rates (alerts the grower always ignores)
 * - Severity thresholds (sensor failures > control issues > weather)
 *
 * Only surfaces high-priority alerts. Tracks grower response to tune thresholds.
 *
 * Integration: AnomalyDiagnostics → AlertPrioritizer → Activity Hub
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALERT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'alert-history.json');

// Priority weights by diagnosis category
const CATEGORY_WEIGHTS = {
  equipment_failure: 100,
  sensor_issue: 85,
  control_loop: 60,
  environmental: 40,
  weather_correlated: 15
};

// Priority weights by urgency level
const URGENCY_WEIGHTS = {
  critical: 100,
  high: 75,
  medium: 40,
  low: 15
};

// Minimum priority score to surface an alert (0-100)
const DEFAULT_SURFACE_THRESHOLD = 35;

/**
 * Load alert history (dismiss/acknowledge rates per category).
 */
function loadAlertHistory() {
  try {
    const raw = fs.readFileSync(ALERT_HISTORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      categories: {},
      total_surfaced: 0,
      total_dismissed: 0,
      total_acknowledged: 0,
      last_updated: null
    };
  }
}

/**
 * Save alert history.
 */
function saveAlertHistory(history) {
  fs.writeFileSync(ALERT_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Score a single alert and decide whether to surface it.
 *
 * @param {object} diagnostic - output from AnomalyDiagnostics.diagnose()
 * @param {object} [farmContext] - { activeGroups, growthStages, zone }
 * @returns {{ priority: number, surface: boolean, reason: string, suppressReason?: string }}
 */
export function scoreAlert(diagnostic, farmContext = {}) {
  const diagnosis = diagnostic?.diagnosis || {};
  const category = diagnosis.category || 'environmental';
  const urgency = diagnosis.urgency || 'low';
  const confidence = diagnosis.confidence || 0;

  // Base score from category + urgency
  const categoryScore = CATEGORY_WEIGHTS[category] || 30;
  const urgencyScore = URGENCY_WEIGHTS[urgency] || 15;
  let priority = (categoryScore * 0.5 + urgencyScore * 0.5) * Math.max(0.3, confidence);

  // Boost for sensor issues affecting active grow zones
  if (farmContext.activeGroups && farmContext.activeGroups > 0) {
    if (category === 'sensor_issue' || category === 'equipment_failure') {
      priority *= 1.2; // 20% boost for active zones
    }
  }

  // Adjust based on historical dismiss rate for this category
  const history = loadAlertHistory();
  const catHistory = history.categories?.[category];
  if (catHistory && catHistory.total > 5) {
    const dismissRate = catHistory.dismissed / catHistory.total;
    if (dismissRate > 0.8) {
      // Grower dismisses 80%+ of this category — suppress
      priority *= 0.4;
    } else if (dismissRate > 0.5) {
      priority *= 0.7;
    }
  }

  // Deduplication: if same category alert was surfaced within last 30 minutes, reduce
  if (catHistory?.last_surfaced_at) {
    const elapsed = Date.now() - new Date(catHistory.last_surfaced_at).getTime();
    if (elapsed < 30 * 60 * 1000) {
      priority *= 0.5; // Cool-down: don't re-alert same category within 30 min
    }
  }

  // Weather-correlated alerts are almost always low-priority
  if (diagnosis.weatherRelated) {
    priority = Math.min(priority, 25);
  }

  priority = Math.min(100, Math.max(0, +priority.toFixed(1)));
  const threshold = farmContext.alertThreshold || DEFAULT_SURFACE_THRESHOLD;
  const surface = priority >= threshold;

  return {
    priority,
    surface,
    category,
    urgency,
    reason: surface
      ? `Priority ${priority} exceeds threshold ${threshold} (${category}/${urgency})`
      : undefined,
    suppressReason: !surface
      ? `Priority ${priority} below threshold ${threshold}` +
        (diagnosis.weatherRelated ? ' (weather-related)' : '') +
        (catHistory && catHistory.dismissed / (catHistory.total || 1) > 0.5 ? ' (high dismiss rate)' : '')
      : undefined
  };
}

/**
 * Prioritize a batch of alerts. Returns only the ones worth surfacing,
 * sorted by priority (highest first).
 *
 * @param {Array} diagnostics - array of AnomalyDiagnostics.diagnose() outputs
 * @param {object} [farmContext] - { activeGroups, growthStages, zone, alertThreshold }
 * @returns {{ surfaced: Array, suppressed: number, total: number }}
 */
export function prioritizeAlerts(diagnostics, farmContext = {}) {
  if (!diagnostics || diagnostics.length === 0) {
    return { surfaced: [], suppressed: 0, total: 0 };
  }

  const scored = diagnostics.map(d => {
    const score = scoreAlert(d, farmContext);
    return { ...d, _priority: score };
  });

  const surfaced = scored
    .filter(s => s._priority.surface)
    .sort((a, b) => b._priority.priority - a._priority.priority);

  const suppressed = scored.filter(s => !s._priority.surface).length;

  return {
    surfaced,
    suppressed,
    total: diagnostics.length
  };
}

/**
 * Record grower response to an alert (for adaptive thresholds).
 *
 * @param {string} category - alert category (from diagnosis)
 * @param {'acknowledged'|'dismissed'|'acted_on'} response
 */
export function recordAlertResponse(category, response) {
  const history = loadAlertHistory();

  if (!history.categories[category]) {
    history.categories[category] = {
      total: 0,
      dismissed: 0,
      acknowledged: 0,
      acted_on: 0,
      last_surfaced_at: null
    };
  }

  const cat = history.categories[category];
  cat.total++;
  if (response === 'dismissed') {
    cat.dismissed++;
    history.total_dismissed++;
  } else if (response === 'acknowledged') {
    cat.acknowledged++;
    history.total_acknowledged++;
  } else if (response === 'acted_on') {
    cat.acted_on = (cat.acted_on || 0) + 1;
    history.total_acknowledged++;
  }

  cat.last_surfaced_at = new Date().toISOString();
  history.total_surfaced++;
  history.last_updated = new Date().toISOString();

  saveAlertHistory(history);
  return cat;
}

/**
 * Get alert statistics for monitoring dismiss rates.
 */
export function getAlertStats() {
  const history = loadAlertHistory();
  const stats = {
    total_surfaced: history.total_surfaced,
    total_dismissed: history.total_dismissed,
    overall_dismiss_rate: history.total_surfaced > 0
      ? +(history.total_dismissed / history.total_surfaced * 100).toFixed(1)
      : 0,
    categories: {}
  };

  for (const [cat, data] of Object.entries(history.categories || {})) {
    stats.categories[cat] = {
      total: data.total,
      dismissed: data.dismissed,
      dismiss_rate: data.total > 0 ? +(data.dismissed / data.total * 100).toFixed(1) : 0,
      last_surfaced: data.last_surfaced_at
    };
  }

  return stats;
}

export default {
  scoreAlert,
  prioritizeAlerts,
  recordAlertResponse,
  getAlertStats
};
