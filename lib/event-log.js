/**
 * Durable Event Log (XC-3)
 *
 * Persist all FarmEventBus events to an append-only NeDB datastore.
 * Provides per-consumer cursor tracking so downstream agents can
 * resume processing from where they left off after a restart.
 *
 * Usage:
 *   import { initEventLog } from './lib/event-log.js';
 *   const eventLog = initEventLog(eventBus, runtimeDbPath);
 *   // Query: eventLog.query({ event_type: 'harvest' }, 50)
 *   // Cursor: eventLog.consumeSince(consumerName, limit)
 */

import Datastore from 'nedb-promises';

let eventLogDB = null;
let cursorDB = null;
let initialized = false;

/**
 * Initialize the durable event log.
 * @param {import('./event-bus.js').default} eventBus - The FarmEventBus singleton
 * @param {function} runtimeDbPath - Resolves a filename to a runtime DB path
 * @returns {{ query, consumeSince, getCursor, compact }}
 */
export function initEventLog(eventBus, runtimeDbPath) {
  if (initialized) return getAPI();

  eventLogDB = new Datastore({
    filename: runtimeDbPath('event-log.db'),
    autoload: true,
    timestampData: false,
  });

  cursorDB = new Datastore({
    filename: runtimeDbPath('event-cursors.db'),
    autoload: true,
  });

  // Index for fast queries by event_type and timestamp
  eventLogDB.ensureIndex({ fieldName: 'event_type' });
  eventLogDB.ensureIndex({ fieldName: 'seq' });

  // Index cursors by consumer name (unique)
  cursorDB.ensureIndex({ fieldName: 'consumer', unique: true });

  let seq = 0;

  // Load max seq from DB on startup (async, non-blocking)
  eventLogDB.find({}).sort({ seq: -1 }).limit(1).then(docs => {
    if (docs.length > 0 && typeof docs[0].seq === 'number') {
      seq = docs[0].seq;
    }
    console.log(`[event-log] Initialized. Last seq: ${seq}`);
  }).catch(err => {
    console.warn('[event-log] Failed to read max seq:', err.message);
  });

  // Listen to all events and persist them asynchronously
  eventBus.on('*', (envelope) => {
    if (!envelope || !envelope.event_type) return;
    seq++;
    const record = {
      seq,
      event_type: envelope.event_type,
      timestamp: envelope.timestamp || new Date().toISOString(),
      logged_at: new Date().toISOString(),
      payload: envelope,
    };
    eventLogDB.insert(record).catch(err => {
      console.warn('[event-log] Failed to persist event:', err.message);
    });
  });

  initialized = true;
  console.log('[event-log] Durable event log attached to event bus');
  return getAPI();
}

function getAPI() {
  return { query, consumeSince, getCursor, compact };
}

/**
 * Query persisted events.
 * @param {object} filter - NeDB query (e.g. { event_type: 'harvest' })
 * @param {number} limit - Max results (default 100)
 * @param {string} order - 'asc' or 'desc' (default 'desc' = newest first)
 * @returns {Promise<Array>}
 */
async function query(filter = {}, limit = 100, order = 'desc') {
  const sortDir = order === 'asc' ? 1 : -1;
  return eventLogDB.find(filter).sort({ seq: sortDir }).limit(limit);
}

/**
 * Consume events since the named consumer's last cursor position.
 * Advances the cursor after returning results.
 * @param {string} consumer - Consumer name (e.g. 'audit-log', 'sage-scheduler')
 * @param {number} limit - Max events to return per call (default 100)
 * @returns {Promise<{ events: Array, cursor: number }>}
 */
async function consumeSince(consumer, limit = 100) {
  const cursorDoc = await cursorDB.findOne({ consumer });
  const lastSeq = cursorDoc?.last_seq || 0;

  const events = await eventLogDB
    .find({ seq: { $gt: lastSeq } })
    .sort({ seq: 1 })
    .limit(limit);

  if (events.length > 0) {
    const newSeq = events[events.length - 1].seq;
    await cursorDB.update(
      { consumer },
      { consumer, last_seq: newSeq, updated_at: new Date().toISOString() },
      { upsert: true }
    );
  }

  return {
    events,
    cursor: events.length > 0 ? events[events.length - 1].seq : lastSeq,
  };
}

/**
 * Get the current cursor position for a consumer without advancing it.
 * @param {string} consumer
 * @returns {Promise<number>}
 */
async function getCursor(consumer) {
  const doc = await cursorDB.findOne({ consumer });
  return doc?.last_seq || 0;
}

/**
 * Compact the event log DB file (reclaim disk space from deleted records).
 */
function compact() {
  eventLogDB.persistence.compactDatafile();
  cursorDB.persistence.compactDatafile();
}
