/**
 * Anomaly History Persistence
 * 
 * Manages persistent storage of anomaly events with 30-day retention.
 * Uses JSON file storage for simplicity and portability.
 * 
 * @module lib/anomaly-history
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const HISTORY_FILE = path.join(__dirname, '..', 'public', 'data', 'anomaly-history.json');
const RETENTION_DAYS = 30;
const MAX_EVENTS_PER_FILE = 10000; // Prevent file from growing too large

/**
 * Load anomaly history from file
 * 
 * @returns {Promise<Array>} Array of anomaly events
 */
export async function loadHistory() {
  try {
    await fs.access(HISTORY_FILE);
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.events) ? data.events : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return [];
    }
    throw new Error(`Failed to load anomaly history: ${error.message}`);
  }
}

/**
 * Save anomaly history to file
 * 
 * @param {Array} events - Array of anomaly events
 * @returns {Promise<void>}
 */
async function saveHistory(events) {
  const data = {
    events,
    metadata: {
      total_events: events.length,
      oldest_event: events.length > 0 ? events[0].timestamp : null,
      newest_event: events.length > 0 ? events[events.length - 1].timestamp : null,
      updated_at: new Date().toISOString()
    }
  };

  // Ensure directory exists
  const dir = path.dirname(HISTORY_FILE);
  await fs.mkdir(dir, { recursive: true });

  // Write atomically (write to temp file, then rename)
  const tempFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
  await fs.rename(tempFile, HISTORY_FILE);
}

/**
 * Clean old events based on retention policy
 * 
 * @param {Array} events - Array of anomaly events
 * @returns {Array} Filtered events within retention period
 */
function cleanOldEvents(events) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const cutoffTime = cutoffDate.getTime();

  return events.filter(event => {
    const eventTime = new Date(event.timestamp).getTime();
    return eventTime >= cutoffTime;
  });
}

/**
 * Add new anomaly events to history
 * 
 * @param {Array} anomalies - Array of new anomaly events
 * @returns {Promise<Object>} Result with counts
 */
export async function addAnomalies(anomalies) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    return {
      added: 0,
      total: 0,
      cleaned: 0,
      message: 'No anomalies to add'
    };
  }

  // Load existing history
  let history = await loadHistory();

  // Add new events with persistent IDs
  const newEvents = anomalies.map((anomaly, index) => ({
    id: `anomaly-${Date.now()}-${index}`,
    recorded_at: new Date().toISOString(),
    ...anomaly
  }));

  history = [...history, ...newEvents];

  // Clean old events
  const beforeClean = history.length;
  history = cleanOldEvents(history);
  const cleaned = beforeClean - history.length;

  // Limit total events
  if (history.length > MAX_EVENTS_PER_FILE) {
    const excess = history.length - MAX_EVENTS_PER_FILE;
    history = history.slice(excess);
  }

  // Sort by timestamp (oldest first)
  history.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return aTime - bTime;
  });

  // Save updated history
  await saveHistory(history);

  return {
    added: newEvents.length,
    total: history.length,
    cleaned,
    message: `Added ${newEvents.length} anomalies, cleaned ${cleaned} old events`
  };
}

/**
 * Get anomaly history with optional filters
 * 
 * @param {Object} options - Filter options
 * @param {string} options.zone - Filter by zone
 * @param {string} options.severity - Filter by severity (critical, warning, info)
 * @param {number} options.since - Timestamp (ms) to filter from
 * @param {number} options.limit - Maximum number of events to return
 * @param {string} options.sort - Sort order ('asc' or 'desc')
 * @returns {Promise<Object>} Filtered events with metadata
 */
export async function getHistory(options = {}) {
  let events = await loadHistory();

  // Apply filters
  if (options.zone) {
    events = events.filter(e => e.zone === options.zone);
  }

  if (options.severity) {
    events = events.filter(e => e.severity === options.severity);
  }

  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }

  // Sort
  const sortOrder = options.sort || 'desc';
  events.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
  });

  // Limit
  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  // Calculate statistics
  const stats = {
    total: events.length,
    by_severity: {
      critical: events.filter(e => e.severity === 'critical').length,
      warning: events.filter(e => e.severity === 'warning').length,
      info: events.filter(e => e.severity === 'info').length
    },
    by_zone: {}
  };

  // Count by zone
  events.forEach(event => {
    const zone = event.zone || 'unknown';
    stats.by_zone[zone] = (stats.by_zone[zone] || 0) + 1;
  });

  return {
    events,
    stats,
    filters: options,
    retention_days: RETENTION_DAYS
  };
}

/**
 * Get anomaly statistics for a time range
 * 
 * @param {number} hours - Number of hours to look back
 * @returns {Promise<Object>} Statistics
 */
export async function getStatistics(hours = 24) {
  const since = Date.now() - (hours * 60 * 60 * 1000);
  const history = await getHistory({ since });

  const events = history.events;

  // Calculate time buckets (hourly)
  const buckets = {};
  for (let i = 0; i < hours; i++) {
    const bucketTime = new Date(since + (i * 60 * 60 * 1000));
    const bucketKey = bucketTime.toISOString().slice(0, 13) + ':00:00.000Z';
    buckets[bucketKey] = {
      timestamp: bucketKey,
      critical: 0,
      warning: 0,
      info: 0,
      total: 0
    };
  }

  // Fill buckets
  events.forEach(event => {
    const eventTime = new Date(event.timestamp);
    const bucketKey = eventTime.toISOString().slice(0, 13) + ':00:00.000Z';
    
    if (buckets[bucketKey]) {
      buckets[bucketKey][event.severity]++;
      buckets[bucketKey].total++;
    }
  });

  return {
    time_range_hours: hours,
    since: new Date(since).toISOString(),
    total_events: events.length,
    by_severity: history.stats.by_severity,
    by_zone: history.stats.by_zone,
    hourly_buckets: Object.values(buckets)
  };
}

/**
 * Delete anomaly history (for testing/maintenance)
 * 
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  try {
    await fs.unlink(HISTORY_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export default {
  loadHistory,
  addAnomalies,
  getHistory,
  getStatistics,
  clearHistory,
  RETENTION_DAYS
};
