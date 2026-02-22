/**
 * Standardized Event Bus
 * Phase 1 Ticket 1.6 — emits canonical events per data/event-taxonomy.json
 *
 * Usage:
 *   import eventBus from './lib/event-bus.js';
 *   eventBus.emit('harvest', { crop: 'basil', ... });
 *   eventBus.on('harvest', (payload) => { ... });
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FarmEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.taxonomy = null;
    this._loadTaxonomy();
    this._history = [];     // ring buffer of last 200 events
    this._maxHistory = 200;
  }

  _loadTaxonomy() {
    try {
      const raw = readFileSync(join(__dirname, '..', 'data', 'event-taxonomy.json'), 'utf-8');
      this.taxonomy = JSON.parse(raw);
      console.log(`[EventBus] Loaded event taxonomy v${this.taxonomy.version} — ${Object.keys(this.taxonomy.events).length} event types`);
    } catch (err) {
      console.warn('[EventBus] Could not load event taxonomy:', err.message);
      this.taxonomy = { events: {} };
    }
  }

  /**
   * Emit a standardised event.
   * @param {string} eventType — must match a key in event-taxonomy.json
   * @param {object} payload  — event data (timestamp auto-added if missing)
   */
  emitEvent(eventType, payload = {}) {
    if (!this.taxonomy.events[eventType]) {
      console.warn(`[EventBus] Unknown event type "${eventType}" — emitting anyway`);
    }

    const envelope = {
      event_type: eventType,
      timestamp: payload.timestamp || new Date().toISOString(),
      ...payload,
    };

    // Store in ring buffer
    this._history.push(envelope);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // Emit on both the specific channel and the wildcard '*' channel
    this.emit(eventType, envelope);
    this.emit('*', envelope);

    return envelope;
  }

  /**
   * Return recent event history (newest first).
   * @param {number} limit
   * @param {string} [eventType] — optional filter
   */
  getRecent(limit = 50, eventType = null) {
    let list = this._history;
    if (eventType) {
      list = list.filter(e => e.event_type === eventType);
    }
    return list.slice(-limit).reverse();
  }
}

const eventBus = new FarmEventBus();
export default eventBus;
