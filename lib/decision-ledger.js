/**
 * Agent Decision Ledger -- append-only NDJSON log per agent per day.
 * Directory: data/agent-decisions/<agent>/<yyyy-mm-dd>.ndjson
 *
 * Each line is a JSON record:
 *   { seq, agent, decision_type, inputs, alternatives, chosen, approval, outcome, timestamp }
 *
 * Phase 4 #21 (R7)
 */

import fs from 'fs';
import path from 'path';

let baseDir = path.join(process.cwd(), 'data', 'agent-decisions');

function init(dataDir) {
  if (dataDir) baseDir = path.join(dataDir, 'agent-decisions');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
}

function _agentDir(agent) {
  const sanitized = agent.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  const dir = path.join(baseDir, sanitized);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function _todayFile(agent) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(_agentDir(agent), `${date}.ndjson`);
}

let _seq = 0;

/**
 * Append a decision record to the agent's daily NDJSON file.
 * @param {object} entry
 * @param {string} entry.agent - Agent name (e.g. 'sage', 'evie', 'faye')
 * @param {string} entry.decision_type - Type of decision (e.g. 'schedule_change', 'recipe_modify', 'escalation')
 * @param {object} [entry.inputs] - Input data the agent used to make the decision
 * @param {Array}  [entry.alternatives] - Alternative actions considered
 * @param {object} entry.chosen - The action chosen by the agent
 * @param {string} [entry.approval] - Approval status: 'auto', 'pending', 'approved', 'rejected'
 * @param {object} [entry.outcome] - Outcome after execution (may be filled later)
 * @param {string} [entry.farm_id] - Farm ID context
 * @returns {object} The persisted record with seq and timestamp
 */
function record(entry) {
  if (!entry.agent) throw new Error('decision-ledger: agent is required');
  if (!entry.chosen) throw new Error('decision-ledger: chosen action is required');

  _seq++;
  const record = {
    seq: _seq,
    agent: entry.agent,
    decision_type: entry.decision_type || 'unknown',
    inputs: entry.inputs || null,
    alternatives: entry.alternatives || [],
    chosen: entry.chosen,
    approval: entry.approval || 'pending',
    outcome: entry.outcome || null,
    farm_id: entry.farm_id || null,
    timestamp: new Date().toISOString()
  };

  const filePath = _todayFile(entry.agent);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');

  return record;
}

/**
 * Update the outcome of a previously recorded decision.
 * Appends an outcome_update record referencing the original seq.
 */
function recordOutcome(agent, originalSeq, outcome) {
  const update = {
    seq: ++_seq,
    agent,
    decision_type: 'outcome_update',
    ref_seq: originalSeq,
    outcome,
    timestamp: new Date().toISOString()
  };

  const filePath = _todayFile(agent);
  fs.appendFileSync(filePath, JSON.stringify(update) + '\n');
  return update;
}

/**
 * Read decision records for an agent on a specific date.
 * @param {string} agent
 * @param {string} [date] - YYYY-MM-DD (defaults to today)
 * @returns {Array} Array of decision records
 */
function read(agent, date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const filePath = path.join(_agentDir(agent), `${d}.ndjson`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  return lines.filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/**
 * List available dates for an agent.
 * @param {string} agent
 * @returns {Array<string>} Sorted array of YYYY-MM-DD dates
 */
function listDates(agent) {
  const dir = _agentDir(agent);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.ndjson'))
    .map(f => f.replace('.ndjson', ''))
    .sort();
}

export default { init, record, recordOutcome, read, listDates };
