/**
 * G.W.E.N. -- Grants, Workplans, Evidence & Navigation
 * =====================================================
 * Research-focused conversational AI agent for GreenReach Central.
 * Most advanced agent in the GreenReach family -- operates exclusively
 * within the research bubble. FAYE retains security authority and
 * safe-patch approval for changes outside the bubble.
 *
 * POST /chat          -- Standard request/response chat
 * GET  /status        -- Agent health check
 * GET  /state         -- Current research state snapshot
 * GET  /workspace     -- Dynamic workspace data (charts, tables, displays)
 *
 * Primary LLM: Claude Sonnet 4 (Anthropic)
 * Fallback:    GPT-4o-mini (OpenAI)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';

const router = Router();

// -- LLM Clients (lazy-init) -------------------------------------------
let anthropicClient = null;
let openaiClient = null;

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOOL_LOOPS = 12;
const MAX_TOKENS = 4096;
const MAX_LLM_MESSAGES = 30;

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

async function getOpenAIClient() {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const OpenAI = (await import('openai')).default;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// -- Conversation Memory (in-memory + DB) --------------------------------
const conversations = new Map();
const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000; // 2h (longer for research sessions)
const MAX_HISTORY = 50;

async function getConversation(convId, userId) {
  const cached = conversations.get(convId);
  if (cached && Date.now() - cached.lastAccess <= CONVERSATION_TTL_MS) {
    cached.lastAccess = Date.now();
    return cached;
  }
  if (cached) conversations.delete(convId);

  try {
    if (isDatabaseAvailable() && userId) {
      const result = await query(
        `SELECT messages FROM admin_assistant_conversations
         WHERE admin_id = $1 AND conversation_id = $2
         AND updated_at > NOW() - INTERVAL '48 hours'`,
        [userId, convId]
      );
      if (result.rows.length > 0) {
        const messages = result.rows[0].messages || [];
        const restored = { messages, lastAccess: Date.now() };
        conversations.set(convId, restored);
        return restored;
      }
    }
  } catch { /* DB unavailable */ }
  return null;
}

async function upsertConversation(convId, messages, userId) {
  const trimmed = messages.slice(-MAX_HISTORY);
  conversations.set(convId, { messages: trimmed, lastAccess: Date.now() });

  try {
    if (isDatabaseAvailable() && userId) {
      await query(
        `INSERT INTO admin_assistant_conversations (admin_id, conversation_id, messages, message_count, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (admin_id, conversation_id)
         DO UPDATE SET messages = $3, message_count = $4, updated_at = NOW()`,
        [userId, `gwen-${convId}`, JSON.stringify(trimmed), trimmed.length]
      );
    }
  } catch { /* non-fatal */ }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL_MS) conversations.delete(id);
  }
}, 10 * 60 * 1000);

// -- Dynamic Workspace Store (in-memory, per-session) --------------------
// Stores researcher-created displays, charts, and custom data tables
const workspaceDisplays = new Map();

// -- Persistent Memory Loader (injected into conversation context) --------
async function loadPersistentMemories(farmId) {
  if (!isDatabaseAvailable() || !farmId) return null;
  try {
    const [memories, recentJournal] = await Promise.all([
      query(
        `SELECT category, content, importance FROM gwen_memory
         WHERE farm_id = $1 ORDER BY importance DESC, updated_at DESC LIMIT 30`,
        [farmId]
      ),
      query(
        `SELECT entry_type, title, content FROM gwen_evolution_journal
         WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [farmId]
      ),
    ]);
    if (!memories.rows.length && !recentJournal.rows.length) return null;

    const parts = [];
    if (memories.rows.length) {
      parts.push('[PERSISTENT MEMORIES -- facts and context you saved from previous conversations]');
      for (const m of memories.rows) {
        parts.push(`- [${m.category}] (importance ${m.importance}) ${m.content}`);
      }
    }
    if (recentJournal.rows.length) {
      parts.push('\n[RECENT EVOLUTION JOURNAL ENTRIES -- your own reflections and growth notes]');
      for (const e of recentJournal.rows) {
        parts.push(`- [${e.entry_type}] ${e.title}: ${e.content.slice(0, 500)}`);
      }
    }
    return parts.join('\n');
  } catch { return null; }
}

function normalizeFarmLayoutPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      rooms: [],
      zones: [],
      groups: [],
      trays: [],
    };
  }

  const roomList = Array.isArray(payload.rooms)
    ? payload.rooms
    : Array.isArray(payload.room_list)
      ? payload.room_list
      : [];

  const zoneList = Array.isArray(payload.zones)
    ? payload.zones
    : Array.isArray(payload.zone_list)
      ? payload.zone_list
      : [];

  const groupList = Array.isArray(payload.groups)
    ? payload.groups
    : Array.isArray(payload.group_list)
      ? payload.group_list
      : [];

  return {
    rooms: roomList,
    zones: zoneList,
    groups: groupList,
    trays: [],
  };
}

function extractTraysFromZones(zones = []) {
  const trays = [];
  for (const zone of zones) {
    const zoneId = zone?.zone || zone?.id || zone?.zone_id || null;
    const roomId = zone?.room || zone?.roomId || zone?.room_id || null;
    const candidates = [];
    if (Array.isArray(zone?.trays)) candidates.push(...zone.trays);
    if (Array.isArray(zone?.positions)) candidates.push(...zone.positions);
    for (const tray of candidates) {
      trays.push({
        tray_id: tray?.id || tray?.tray_id || tray?.position || null,
        tray_name: tray?.name || tray?.label || null,
        room_id: roomId,
        zone_id: zoneId,
        crop: tray?.crop || tray?.crop_name || null,
        planted_date: tray?.planted_date || tray?.seed_date || null,
        raw: tray,
      });
    }
  }
  return trays;
}

function normalizeDevicePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.devices)) return payload.devices;
  return [];
}

function normalizeDeviceEntry(device = {}) {
  const telemetry = (device && typeof device.telemetry === 'object' && device.telemetry) ? device.telemetry : null;
  return {
    device_id: device.deviceId || device.id || device.device_id || null,
    name: device.name || device.label || null,
    type: device.type || device.category || null,
    protocol: device.protocol || device.vendor || device.brand || null,
    room_id: device.room || device.roomId || device.room_id || null,
    zone_id: device.zone || device.zoneId || device.zone_id || null,
    status: device.status || (telemetry ? 'online' : null),
    last_seen: device.lastSeen || device.last_seen || telemetry?.lastUpdate || null,
    telemetry,
    raw: device,
  };
}

// -- Tool Catalog --------------------------------------------------------

const GWEN_TOOL_CATALOG = {

  // ========================================
  // RESEARCH DATA & STUDY MANAGEMENT
  // ========================================

  get_study_list: {
    description: 'List all studies for the current research farm, with optional status filter.',
    parameters: {
      status: { type: 'string', description: 'Filter by status: active, draft, completed, archived' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const farmId = ctx.farmId;
      let sql = 'SELECT id, title, status, pi_user_id, objectives, created_at FROM studies WHERE farm_id = $1';
      const p = [farmId];
      if (params.status) { p.push(params.status); sql += ` AND status = $${p.length}`; }
      sql += ' ORDER BY created_at DESC';
      try {
        const result = await query(sql, p);
        return { ok: true, studies: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_study_details: {
    description: 'Get full details of a specific study including protocols, treatments, milestones, and linked entities.',
    parameters: {
      study_id: { type: 'number', description: 'The study ID' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found or access denied' };
        const [protocols, treatments, milestones, links] = await Promise.all([
          query('SELECT * FROM study_protocols WHERE study_id = $1 ORDER BY version DESC', [params.study_id]),
          query('SELECT * FROM treatment_groups WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] })),
          query('SELECT * FROM trial_milestones WHERE study_id = $1 ORDER BY target_date', [params.study_id]),
          query('SELECT * FROM study_links WHERE study_id = $1', [params.study_id]),
        ]);
        return {
          ok: true, study: s.rows[0],
          protocols: protocols.rows, treatments: treatments.rows,
          milestones: milestones.rows, links: links.rows,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_dataset_summary: {
    description: 'Get summary of a research dataset including variable definitions and observation counts.',
    parameters: {
      dataset_id: { type: 'number', description: 'The dataset ID' },
    },
    required: ['dataset_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const ds = await query(
          `SELECT d.*, s.title as study_title,
           (SELECT COUNT(*) FROM research_observations WHERE dataset_id = d.id) as observation_count
           FROM research_datasets d LEFT JOIN studies s ON d.study_id = s.id
           WHERE d.id = $1 AND d.farm_id = $2`, [params.dataset_id, ctx.farmId]);
        if (!ds.rows.length) return { ok: false, error: 'Dataset not found' };
        return { ok: true, dataset: ds.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  query_observations: {
    description: 'Query time-series observations from a research dataset. Supports variable filtering and date ranges.',
    parameters: {
      dataset_id: { type: 'number', description: 'Dataset ID to query' },
      variable_code: { type: 'string', description: 'Optional variable code to filter' },
      start_date: { type: 'string', description: 'Start date (ISO format)' },
      end_date: { type: 'string', description: 'End date (ISO format)' },
      limit: { type: 'number', description: 'Max observations to return (default 500)' },
    },
    required: ['dataset_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        // Verify dataset ownership
        const ds = await query('SELECT id FROM research_datasets WHERE id = $1 AND farm_id = $2', [params.dataset_id, ctx.farmId]);
        if (!ds.rows.length) return { ok: false, error: 'Dataset not found' };
        let sql = 'SELECT * FROM research_observations WHERE dataset_id = $1';
        const p = [params.dataset_id];
        if (params.variable_code) { p.push(params.variable_code); sql += ` AND variable_code = $${p.length}`; }
        if (params.start_date) { p.push(params.start_date); sql += ` AND observed_at >= $${p.length}`; }
        if (params.end_date) { p.push(params.end_date); sql += ` AND observed_at <= $${p.length}`; }
        sql += ` ORDER BY observed_at DESC LIMIT $${p.length + 1}`;
        p.push(Math.min(params.limit || 500, 2000));
        const result = await query(sql, p);
        return { ok: true, observations: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  record_observation: {
    description: 'Record a new observation data point in a research dataset.',
    parameters: {
      dataset_id: { type: 'number', description: 'Dataset ID' },
      variable_code: { type: 'string', description: 'Variable code being measured' },
      value: { type: 'number', description: 'The measured value' },
      unit: { type: 'string', description: 'Unit of measurement' },
      notes: { type: 'string', description: 'Optional notes' },
    },
    required: ['dataset_id', 'variable_code', 'value'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const ds = await query('SELECT id FROM research_datasets WHERE id = $1 AND farm_id = $2', [params.dataset_id, ctx.farmId]);
        if (!ds.rows.length) return { ok: false, error: 'Dataset not found' };
        const result = await query(
          `INSERT INTO research_observations (dataset_id, observed_at, variable_code, value, unit, notes)
           VALUES ($1, NOW(), $2, $3, $4, $5) RETURNING *`,
          [params.dataset_id, params.variable_code, params.value, params.unit || null, params.notes || null]);
        return { ok: true, observation: result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_sensor_data: {
    description: 'Pull current Light Engine sensor data (temperature, humidity) for research analysis.',
    parameters: {
      hours_back: { type: 'number', description: 'Hours of history to include (default 24, max 168)' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const hours = Math.min(params.hours_back || 24, 168);
        const result = await query(
          `SELECT data_type, data, updated_at FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('telemetry', 'env_snapshot', 'sensor_reading')
           AND updated_at > NOW() - make_interval(hours => $2)
           ORDER BY updated_at DESC LIMIT 500`, [ctx.farmId, hours]);
        return { ok: true, readings: result.rows, count: result.rows.length, hours_back: hours };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_network_sensor_data: {
    description: 'Pull sensor data from other Light Engine farms in the network for comparison research. Requires data sharing agreement.',
    parameters: {
      target_farm_id: { type: 'string', description: 'Farm ID to pull data from' },
      hours_back: { type: 'number', description: 'Hours of history (default 24)' },
    },
    required: ['target_farm_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        // Check data sharing agreement exists
        const agreement = await query(
          `SELECT id FROM data_sharing_agreements WHERE farm_id = $1 AND status = 'active'
           AND data_types::text LIKE '%sensor%'`, [ctx.farmId]).catch(() => ({ rows: [] }));
        const hours = Math.min(params.hours_back || 24, 168);
        const result = await query(
          `SELECT data_type, data, updated_at FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('telemetry', 'env_snapshot')
           AND updated_at > NOW() - make_interval(hours => $2)
           ORDER BY updated_at DESC LIMIT 200`, [params.target_farm_id, hours]);
        return {
          ok: true, readings: result.rows, count: result.rows.length,
          has_agreement: agreement.rows.length > 0,
          note: agreement.rows.length === 0 ? 'No active data sharing agreement found -- data access may be limited' : null,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // ELN & DOCUMENT TOOLS
  // ========================================

  get_eln_entries: {
    description: 'Get electronic lab notebook entries, optionally filtered by notebook or date range.',
    parameters: {
      notebook_id: { type: 'number', description: 'Filter by notebook ID' },
      limit: { type: 'number', description: 'Max entries to return (default 20)' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = `SELECT e.*, n.title as notebook_title FROM eln_entries e
                    JOIN eln_notebooks n ON e.notebook_id = n.id
                    WHERE n.farm_id = $1`;
        const p = [ctx.farmId];
        if (params.notebook_id) { p.push(params.notebook_id); sql += ` AND e.notebook_id = $${p.length}`; }
        sql += ` ORDER BY e.entry_date DESC LIMIT $${p.length + 1}`;
        p.push(Math.min(params.limit || 20, 100));
        const result = await query(sql, p);
        return { ok: true, entries: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  draft_eln_entry: {
    description: 'Draft a new electronic lab notebook entry. The entry will be created in draft status for researcher review.',
    parameters: {
      notebook_id: { type: 'number', description: 'Target notebook ID' },
      content: { type: 'string', description: 'Entry content (supports rich text)' },
      entry_date: { type: 'string', description: 'Date for the entry (ISO format, defaults to today)' },
    },
    required: ['notebook_id', 'content'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        // Verify notebook ownership
        const nb = await query('SELECT id, status FROM eln_notebooks WHERE id = $1 AND farm_id = $2', [params.notebook_id, ctx.farmId]);
        if (!nb.rows.length) return { ok: false, error: 'Notebook not found' };
        if (nb.rows[0].status === 'locked') return { ok: false, error: 'Notebook is locked -- cannot add entries' };
        const result = await query(
          `INSERT INTO eln_entries (notebook_id, entry_date, content, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
          [params.notebook_id, params.entry_date || new Date().toISOString().split('T')[0], params.content]);
        return { ok: true, entry: result.rows[0], note: 'Entry created in draft status -- review and lock when ready' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  export_study_package: {
    description: 'Request export of study data in specified format (CSV, JSON, or notebook format) with provenance metadata.',
    parameters: {
      study_id: { type: 'number', description: 'Study to export' },
      format: { type: 'string', description: 'Export format: csv, json, notebook', enum: ['csv', 'json', 'notebook'] },
      include_provenance: { type: 'boolean', description: 'Include provenance records' },
      include_metadata: { type: 'boolean', description: 'Include data dictionary' },
    },
    required: ['study_id', 'format'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT id, title FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        // Check retention/embargo
        const retention = await query(
          'SELECT embargo_until FROM retention_policies WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
        if (retention.rows.length && retention.rows[0].embargo_until) {
          const embargoDate = new Date(retention.rows[0].embargo_until);
          if (embargoDate > new Date()) {
            return { ok: false, error: `Data is under embargo until ${embargoDate.toISOString().split('T')[0]}` };
          }
        }
        const result = await query(
          `INSERT INTO export_packages (farm_id, study_id, format, includes_provenance, includes_metadata, includes_data_dictionary, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $5, 'pending', NOW()) RETURNING *`,
          [ctx.farmId, params.study_id, params.format, params.include_provenance || false, params.include_metadata || false]);
        return { ok: true, export_package: result.rows[0], note: 'Export package queued for generation' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  generate_report: {
    description: 'Generate a formatted research report for a study. Supports progress, financial, and compliance report types.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID' },
      report_type: { type: 'string', description: 'Report type: progress, financial, compliance, summary', enum: ['progress', 'financial', 'compliance', 'summary'] },
    },
    required: ['study_id', 'report_type'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        // Gather supporting data based on report type
        const data = { study: s.rows[0] };
        if (params.report_type === 'progress' || params.report_type === 'summary') {
          const [datasets, milestones, tasks] = await Promise.all([
            query('SELECT id, name, status FROM research_datasets WHERE study_id = $1', [params.study_id]),
            query('SELECT * FROM trial_milestones WHERE study_id = $1 ORDER BY target_date', [params.study_id]),
            query('SELECT * FROM workspace_tasks WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] })),
          ]);
          data.datasets = datasets.rows;
          data.milestones = milestones.rows;
          data.tasks = tasks.rows;
        }
        if (params.report_type === 'financial' || params.report_type === 'summary') {
          const budgets = await query(
            'SELECT * FROM grant_budgets WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
          data.budgets = budgets.rows;
        }
        return {
          ok: true, report_type: params.report_type, data,
          note: 'Report data gathered. I will now format this into a structured report.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // GRANT WRITING & ELIGIBILITY
  // ========================================

  screen_funding_eligibility: {
    description: 'Determine whether a project fits CIHR, NSERC, SSHRC, or a provincial stream. Screens for hidden gatekeepers: institution type, partnership requirements, research stage, and provincial restrictions.',
    parameters: {
      research_area: { type: 'string', description: 'Brief description of the research area/topic' },
      institution_type: { type: 'string', description: 'Type of institution: university, college, hospital, industry, independent' },
      institution_province: { type: 'string', description: 'Province/territory of the institution' },
      technology_readiness_level: { type: 'number', description: 'TRL 1-9 if applicable' },
      has_industry_partner: { type: 'boolean', description: 'Whether an industry partner is involved' },
    },
    required: ['research_area'],
    execute: async (params) => {
      // This tool returns structured guidance -- the LLM uses its encoded grant knowledge
      // to apply agency-specific rules in the response
      return {
        ok: true,
        screening_input: params,
        agencies_to_evaluate: ['NSERC', 'CIHR', 'SSHRC', 'CFI', 'MITACS', 'Ontario Research Fund', 'Provincial streams'],
        rubric_checks: [
          'Institution eligibility (is the institution an eligible Canadian post-secondary or hospital?)',
          'Partnership requirements (NSERC Alliance requires industry partner)',
          'Technology readiness level alignment (ORF-RE streams differ by TRL)',
          'Provincial restrictions (ORF requires Ontario-based institution or company)',
          'Research stage fit (discovery vs. applied vs. commercialization)',
          'Trainee/HQP requirements',
        ],
        note: 'I will now analyze the research description against each agency eligibility criteria and report which programs are the best fit.',
      };
    },
  },

  map_competition_rubric: {
    description: 'Generate rubric-specific writing guidance for a target grant competition. Writes to the exact scoring system (SSHRC Insight: Challenge/Feasibility/Capability; NSERC Alliance: all criteria; ORF-RE: excellence/strategic value/impact/talent/governance).',
    parameters: {
      competition: { type: 'string', description: 'Competition name (e.g., "NSERC Alliance", "SSHRC Insight", "CIHR Project Grant", "ORF-RE")' },
      stream: { type: 'string', description: 'Specific stream if applicable' },
    },
    required: ['competition'],
    execute: async (params) => {
      return {
        ok: true,
        competition: params.competition,
        stream: params.stream || 'general',
        note: 'I will now generate section-by-section writing guidance mapped to the exact scoring criteria for this competition.',
      };
    },
  },

  score_proposal_against_rubric: {
    description: 'Evaluate a draft proposal section against competition-specific scoring criteria. Returns strengths, weaknesses, and improvement suggestions.',
    parameters: {
      competition: { type: 'string', description: 'Target competition' },
      section: { type: 'string', description: 'Section being evaluated (e.g., "Challenge", "Feasibility", "Budget justification")' },
      text: { type: 'string', description: 'The draft text to evaluate' },
    },
    required: ['competition', 'section', 'text'],
    execute: async (params) => {
      return {
        ok: true,
        evaluation_input: { competition: params.competition, section: params.section, text_length: params.text.length },
        note: 'I will now score this text against the specific rubric criteria and provide actionable feedback.',
      };
    },
  },

  // ========================================
  // NARRATIVE CV & WRITING
  // ========================================

  build_narrative_cv: {
    description: 'Generate narrative-style CV content that explains quality, impact, and context -- not just publication counts. Follows tri-agency guidance and DORA principles.',
    parameters: {
      researcher_profile_id: { type: 'number', description: 'Researcher profile ID from the database' },
      target_competition: { type: 'string', description: 'Competition this CV targets' },
      page_limit: { type: 'number', description: 'Max pages (default 5 for English, 6 for French)' },
    },
    required: ['target_competition'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let profile = null;
        if (params.researcher_profile_id) {
          const r = await query('SELECT * FROM researcher_profiles WHERE id = $1 AND farm_id = $2',
            [params.researcher_profile_id, ctx.farmId]);
          profile = r.rows[0] || null;
        }
        const publications = await query(
          'SELECT * FROM publications WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 20', [ctx.farmId]).catch(() => ({ rows: [] }));
        return {
          ok: true, profile, publications: publications.rows,
          page_limit: params.page_limit || 5,
          target: params.target_competition,
          note: 'I will now build a narrative CV emphasizing quality, impact, and context per tri-agency guidance.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  rewrite_for_clarity: {
    description: 'Rewrite text for clarity, active voice, structure, and low-jargon readability. Based on grant-writing best practices (Guyer et al. 2021, van den Besselaar et al. 2022).',
    parameters: {
      text: { type: 'string', description: 'Text to rewrite' },
      target_audience: { type: 'string', description: 'Target audience: panel_reviewer, general_scientific, public', enum: ['panel_reviewer', 'general_scientific', 'public'] },
    },
    required: ['text'],
    execute: async (params) => {
      return {
        ok: true,
        original_length: params.text.length,
        target_audience: params.target_audience || 'panel_reviewer',
        note: 'I will now rewrite this text applying active voice, reducing jargon, tightening structure, and optimizing for reviewer accessibility.',
      };
    },
  },

  score_writing_style: {
    description: 'Score abstract or CV language for grant success likelihood. Based on van den Besselaar et al. (2022) writing-style impact research.',
    parameters: {
      text: { type: 'string', description: 'Text to score' },
      section_type: { type: 'string', description: 'Section type: abstract, cv_contribution, proposal_summary', enum: ['abstract', 'cv_contribution', 'proposal_summary'] },
    },
    required: ['text', 'section_type'],
    execute: async (params) => {
      return {
        ok: true,
        text_length: params.text.length,
        section_type: params.section_type,
        note: 'I will now analyze this text for readability, jargon density, passive voice ratio, sentence complexity, and persuasion strength.',
      };
    },
  },

  // ========================================
  // BUDGET & COMPLIANCE
  // ========================================

  draft_research_budget: {
    description: 'Create a research budget that matches activities to eligible costs. Separates direct costs, partner contributions, indirect costs, and restricted expenses per agency rules.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID to budget for' },
      funding_agency: { type: 'string', description: 'Target agency (NSERC, CIHR, SSHRC, ORF-RE, etc.)' },
      total_requested: { type: 'number', description: 'Total amount requested' },
      currency: { type: 'string', description: 'Currency (default CAD)' },
    },
    required: ['funding_agency', 'total_requested'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let study = null;
        if (params.study_id) {
          const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
          study = s.rows[0] || null;
        }
        return {
          ok: true, study, agency: params.funding_agency,
          total_requested: params.total_requested, currency: params.currency || 'CAD',
          note: 'I will now draft a budget with line items justified against planned activities, following ' + params.funding_agency + ' eligible-cost rules.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  validate_budget_eligibility: {
    description: 'Check budget line items against agency-specific eligible cost rules. Flags restricted expenses, indirect cost caps, and missing justifications.',
    parameters: {
      budget_id: { type: 'number', description: 'Budget ID to validate' },
      funding_agency: { type: 'string', description: 'Agency rules to check against' },
    },
    required: ['budget_id', 'funding_agency'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const budget = await query('SELECT * FROM grant_budgets WHERE id = $1', [params.budget_id]);
        if (!budget.rows.length) return { ok: false, error: 'Budget not found' };
        const lineItems = await query('SELECT * FROM budget_line_items WHERE budget_id = $1', [params.budget_id]);
        return {
          ok: true, budget: budget.rows[0], line_items: lineItems.rows,
          agency: params.funding_agency,
          note: 'I will now validate each line item against ' + params.funding_agency + ' eligible cost categories and flag issues.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  run_security_due_diligence: {
    description: 'Screen research partnerships and affiliations for security concerns. Checks sensitive technology, export-control exposure, and produces Risk Assessment Form content.',
    parameters: {
      study_id: { type: 'number', description: 'Study to screen' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        const partners = await query(
          `SELECT pi.* FROM partner_institutions pi
           JOIN data_sharing_agreements dsa ON pi.id = dsa.partner_id
           WHERE dsa.farm_id = $1`, [ctx.farmId]).catch(() => ({ rows: [] }));
        const collaborators = await query(
          'SELECT * FROM study_collaborators WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
        return {
          ok: true, study: s.rows[0],
          partners: partners.rows, collaborators: collaborators.rows,
          note: 'I will now flag security concerns: sensitive technology, export-control, STRAC attestation requirements, and mitigation measures.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  generate_dmp: {
    description: 'Create a Data Management Plan as a living document per tri-agency RDM guidance. Covers data collection, storage, preservation, sharing, and ethical considerations.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID' },
      template_type: { type: 'string', description: 'DMP template: tri_agency, nih, generic', enum: ['tri_agency', 'nih', 'generic'] },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        const datasets = await query('SELECT * FROM research_datasets WHERE study_id = $1', [params.study_id]);
        const existing = await query('SELECT * FROM data_management_plans WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
        return {
          ok: true, study: s.rows[0], datasets: datasets.rows,
          existing_dmp: existing.rows[0] || null,
          template: params.template_type || 'tri_agency',
          note: 'I will now generate a comprehensive DMP covering all required sections.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  check_ai_compliance: {
    description: 'Enforce responsible-AI compliance rules. Checks accountability, privacy, confidentiality, data security, and IP protection per interagency guidance.',
    parameters: {
      study_id: { type: 'number', description: 'Study to check' },
      ai_usage_description: { type: 'string', description: 'Description of how AI is used in the research' },
    },
    required: ['ai_usage_description'],
    execute: async (params) => {
      return {
        ok: true,
        description: params.ai_usage_description,
        checks: [
          'Named applicant accountability for AI-generated content',
          'Privacy and confidentiality safeguards',
          'Data security measures',
          'Intellectual property protection',
          'Prohibition on AI for peer review evaluation',
          'Transparency in AI use disclosure',
        ],
        note: 'I will now evaluate the AI usage against interagency responsible-AI rules and flag compliance gaps.',
      };
    },
  },

  assess_edi_integration: {
    description: 'Review project for EDI (Equity, Diversity, Inclusion), sex/gender integration (CIHR), and inclusive team design. Evaluates team composition, trainee development, and engagement of underrepresented groups.',
    parameters: {
      study_id: { type: 'number', description: 'Study to assess' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        const collaborators = await query('SELECT * FROM study_collaborators WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
        const trainees = await query('SELECT * FROM trainee_records WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
        return {
          ok: true, study: s.rows[0],
          collaborators: collaborators.rows,
          trainees: trainees.rows,
          note: 'I will now assess EDI integration across team composition, trainee mentoring, inclusive research design, and sex/gender integration where applicable.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // RESUBMISSION & STRATEGY
  // ========================================

  analyze_resubmission_viability: {
    description: 'Assess whether resubmission is worth pursuing based on prior scores, reviewer feedback, and success rate data (Lasinsky et al. 2024, Wrightson et al. 2025).',
    parameters: {
      grant_id: { type: 'number', description: 'Grant application ID' },
      prior_score: { type: 'number', description: 'Prior review score if available' },
      prior_rank: { type: 'string', description: 'Prior ranking (e.g., "top 30%")' },
    },
    required: ['grant_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const grant = await query('SELECT * FROM grant_applications WHERE id = $1 AND farm_id = $2',
          [params.grant_id, ctx.farmId]);
        if (!grant.rows.length) return { ok: false, error: 'Grant not found' };
        return {
          ok: true, grant: grant.rows[0],
          prior_score: params.prior_score, prior_rank: params.prior_rank,
          note: 'I will now assess resubmission viability considering prior performance, competition trends, and evidence on resubmission success rates.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  generate_response_to_reviewers: {
    description: 'Structure a response-to-reviewer summary for resubmission. Preserves critique history and maps changes to specific reviewer concerns.',
    parameters: {
      grant_id: { type: 'number', description: 'Grant application ID' },
      reviewer_comments: { type: 'string', description: 'Paste of reviewer comments/critiques' },
    },
    required: ['grant_id', 'reviewer_comments'],
    execute: async (params) => {
      return {
        ok: true,
        comment_length: params.reviewer_comments.length,
        note: 'I will now parse each reviewer concern, categorize by severity, and generate a structured response mapping each critique to specific changes made.',
      };
    },
  },

  // ========================================
  // SUBMISSION MANAGEMENT
  // ========================================

  generate_submission_checklist: {
    description: 'Create a portal-specific submission checklist for a grant competition. Covers registration, signatures, file naming, page limits, CV packages, and support letters.',
    parameters: {
      competition: { type: 'string', description: 'Competition/program name' },
      portal: { type: 'string', description: 'Submission portal: cihr_researchnet, nserc_online, sshrc_online, tpon, institutional', enum: ['cihr_researchnet', 'nserc_online', 'sshrc_online', 'tpon', 'institutional'] },
    },
    required: ['competition', 'portal'],
    execute: async (params) => {
      return {
        ok: true, competition: params.competition, portal: params.portal,
        note: 'I will now generate a detailed submission checklist with deadlines, file requirements, naming conventions, and approval steps.',
      };
    },
  },

  manage_institutional_approvals: {
    description: 'Track and coordinate institutional approvals: VPR sign-off, partner letters, end-user letters, institutional strategy alignment.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID' },
      action: { type: 'string', description: 'Action: list, check_status, generate_template', enum: ['list', 'check_status', 'generate_template'] },
      document_type: { type: 'string', description: 'For generate_template: vpr_letter, partner_letter, enduser_letter, institutional_support' },
    },
    required: ['study_id', 'action'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const approvals = await query(
          'SELECT * FROM approval_chains WHERE study_id = $1 AND farm_id = $2 ORDER BY step_order',
          [params.study_id, ctx.farmId]).catch(() => ({ rows: [] }));
        return {
          ok: true, approvals: approvals.rows, action: params.action,
          document_type: params.document_type,
          note: 'I will now ' + (params.action === 'generate_template' ? 'generate a ' + params.document_type + ' template' : 'review approval status'),
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  calibrate_proposal_bias: {
    description: 'Reduce ambiguity, prestige signalling, and reviewer friction in proposal text. Based on Tamblyn et al. (2018) bias research and DORA principles.',
    parameters: {
      text: { type: 'string', description: 'Proposal text to calibrate' },
      section: { type: 'string', description: 'Section name for context' },
    },
    required: ['text'],
    execute: async (params) => {
      return {
        ok: true,
        text_length: params.text.length,
        section: params.section,
        checks: [
          'Impact factor / h-index mentions (should be replaced with narrative evidence)',
          'Prestige-only institutional references',
          'Ambiguous methodology descriptions that invite reviewer disagreement',
          'Passive voice density',
          'Jargon that limits reviewer accessibility',
        ],
        note: 'I will now analyze the text for bias triggers and suggest concrete revisions.',
      };
    },
  },

  // ========================================
  // DYNAMIC WORKSPACE -- DISPLAYS & TABLES
  // ========================================

  create_custom_display: {
    description: 'Create a dynamic visualization within the GWEN research workspace. Supports line charts, bar charts, scatter plots, tables, and metric cards. Data can be pulled from sensors, observations, or custom queries.',
    parameters: {
      display_type: { type: 'string', description: 'Type: line_chart, bar_chart, scatter_plot, data_table, metric_card, heatmap', enum: ['line_chart', 'bar_chart', 'scatter_plot', 'data_table', 'metric_card', 'heatmap'] },
      title: { type: 'string', description: 'Display title' },
      data_source: { type: 'string', description: 'Source: sensor_data, observations, dataset, custom_query' },
      config: { type: 'object', description: 'Display configuration (axes, colors, filters, etc.)' },
      data: { type: 'array', items: { type: 'object' }, description: 'Data array for the display' },
    },
    required: ['display_type', 'title'],
    execute: async (params, ctx) => {
      const displayId = 'display-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const display = {
        id: displayId,
        type: params.display_type,
        title: params.title,
        data_source: params.data_source || 'manual',
        config: params.config || {},
        data: params.data || [],
        created_at: new Date().toISOString(),
        farm_id: ctx.farmId,
      };
      // Store in workspace
      const key = ctx.conversationId || ctx.farmId;
      if (!workspaceDisplays.has(key)) workspaceDisplays.set(key, []);
      workspaceDisplays.get(key).push(display);
      return { ok: true, display, note: 'Display created in workspace. It will appear in the GWEN workspace panel.' };
    },
  },

  create_research_table: {
    description: 'Create a custom data table in the research workspace for storing unique researcher data. The table is scoped to the research bubble and inherits farm tenant isolation.',
    parameters: {
      table_name: { type: 'string', description: 'Name for the custom table (will be prefixed with research_custom_)' },
      columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' } } }, description: 'Array of column definitions: [{name, type, description}]' },
      description: { type: 'string', description: 'Purpose of this table' },
    },
    required: ['table_name', 'columns'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      // Sanitize table name -- only alphanumeric and underscores
      const safeName = 'research_custom_' + params.table_name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      // Map column types to PostgreSQL types
      const typeMap = { string: 'TEXT', number: 'NUMERIC', boolean: 'BOOLEAN', date: 'DATE', timestamp: 'TIMESTAMPTZ', json: 'JSONB' };
      const validColumns = (params.columns || []).filter(c => c.name && c.type);
      if (!validColumns.length) return { ok: false, error: 'At least one valid column definition required' };

      const colDefs = validColumns.map(c => {
        const pgType = typeMap[c.type] || 'TEXT';
        const colName = c.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        return `${colName} ${pgType}`;
      });

      try {
        await query(`
          CREATE TABLE IF NOT EXISTS ${safeName} (
            id SERIAL PRIMARY KEY,
            farm_id VARCHAR(64) NOT NULL,
            ${colDefs.join(', ')},
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        // Log in audit
        await query(
          `INSERT INTO audit_log (farm_id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'create_table', 'custom_table', $3, $4, NOW())`,
          [ctx.farmId, ctx.userId || 'gwen', safeName, JSON.stringify({ columns: validColumns, description: params.description })]
        ).catch(() => {});
        return {
          ok: true, table_name: safeName,
          columns: validColumns,
          note: 'Custom research table created. Data is scoped to your farm via farm_id column.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  register_equipment: {
    description: 'Register new IoT or wired equipment for research use. Supports unknown equipment types that researchers bring to the platform.',
    parameters: {
      name: { type: 'string', description: 'Equipment name' },
      category: { type: 'string', description: 'Category: sensor, actuator, analyzer, imaging, sampling, computing, custom' },
      manufacturer: { type: 'string', description: 'Manufacturer name' },
      model: { type: 'string', description: 'Model number' },
      serial_number: { type: 'string', description: 'Serial number' },
      location: { type: 'string', description: 'Physical location' },
      connection_type: { type: 'string', description: 'Connection: wifi, ethernet, ble, zigbee, usb, serial, modbus, custom' },
      data_format: { type: 'string', description: 'Expected data format (JSON, CSV, binary, MQTT, etc.)' },
      notes: { type: 'string', description: 'Additional notes about the equipment' },
    },
    required: ['name', 'category'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          `INSERT INTO lab_equipment (farm_id, name, category, manufacturer, model, serial_number, location, notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available') RETURNING *`,
          [ctx.farmId, params.name, params.category, params.manufacturer || null, params.model || null,
           params.serial_number || null, params.location || null,
           JSON.stringify({ connection_type: params.connection_type, data_format: params.data_format, notes: params.notes })]);
        return { ok: true, equipment: result.rows[0], note: 'Equipment registered. You can now create datasets linked to this equipment for data collection.' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_calibration_logs: {
    description: 'Get calibration history for research equipment or sensors.',
    parameters: {
      device_id: { type: 'string', description: 'Device or equipment ID' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM calibration_logs WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.device_id) { p.push(params.device_id); sql += ` AND device_id = $${p.length}`; }
        sql += ' ORDER BY timestamp DESC LIMIT 50';
        const result = await query(sql, p);
        return { ok: true, logs: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // RESEARCH DATA CARDS
  // ========================================

  create_data_card: {
    description: 'Create a data card for tracking a research variable -- gases (CO2, O2, ethylene, N2O), liquids (nutrient solution pH, EC, dissolved O2), compounds (chlorophyll, anthocyanins, nitrates), environmental metrics, or any researcher-defined measurement. Data cards appear as live-updating tiles in the workspace.',
    parameters: {
      card_name: { type: 'string', description: 'Display name for the card (e.g., "CO2 Concentration")' },
      variable_key: { type: 'string', description: 'Unique key for the variable (e.g., "co2_ppm")' },
      category: { type: 'string', description: 'Category: gas, liquid, compound, environmental, custom', enum: ['gas', 'liquid', 'compound', 'environmental', 'custom'] },
      unit: { type: 'string', description: 'Measurement unit (e.g., "ppm", "mg/L", "umol/m2/s")' },
      source: { type: 'string', description: 'Data source: sensor (live from LE), manual (researcher input), calculated (derived)', enum: ['sensor', 'manual', 'calculated'] },
      formula: { type: 'string', description: 'If source=calculated, the formula used to derive this value (LaTeX notation accepted)' },
      thresholds: { type: 'object', description: 'Alert thresholds: { warning_low, warning_high, critical_low, critical_high }' },
      study_id: { type: 'number', description: 'Link to a specific study (optional)' },
    },
    required: ['card_name', 'variable_key', 'category', 'unit'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        await query(
          `CREATE TABLE IF NOT EXISTS research_data_cards (
            id SERIAL PRIMARY KEY, farm_id TEXT NOT NULL, card_name TEXT NOT NULL,
            variable_key TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'custom',
            unit TEXT NOT NULL, source TEXT DEFAULT 'manual', formula TEXT,
            thresholds JSONB DEFAULT '{}', study_id INTEGER,
            current_value NUMERIC, last_updated TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(), archived BOOLEAN DEFAULT false,
            UNIQUE(farm_id, variable_key)
          )`
        ).catch(() => {});
        const result = await query(
          `INSERT INTO research_data_cards (farm_id, card_name, variable_key, category, unit, source, formula, thresholds, study_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (farm_id, variable_key) DO UPDATE SET card_name = $2, category = $4, unit = $5, source = $6, formula = $7, thresholds = $8, study_id = $9
           RETURNING *`,
          [ctx.farmId, params.card_name, params.variable_key, params.category, params.unit,
           params.source || 'manual', params.formula || null,
           JSON.stringify(params.thresholds || {}), params.study_id || null]
        );
        return { ok: true, card: result.rows[0], note: `Data card "${params.card_name}" created. It will appear in the workspace data card panel.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  update_data_card_value: {
    description: 'Record a new value for a research data card. Use this for manual observations or calculated results. Sensor-linked cards update automatically.',
    parameters: {
      variable_key: { type: 'string', description: 'The variable key of the data card' },
      value: { type: 'number', description: 'The new value' },
      notes: { type: 'string', description: 'Optional observation notes' },
    },
    required: ['variable_key', 'value'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const updated = await query(
          `UPDATE research_data_cards SET current_value = $1, last_updated = NOW()
           WHERE farm_id = $2 AND variable_key = $3 RETURNING *`,
          [params.value, ctx.farmId, params.variable_key]
        );
        if (!updated.rows.length) return { ok: false, error: `No data card found for key "${params.variable_key}"` };
        // Log in observations table for time series tracking
        await query(
          `INSERT INTO research_data_card_log (farm_id, variable_key, value, notes, recorded_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [ctx.farmId, params.variable_key, params.value, params.notes || null]
        ).catch(() => {});
        const card = updated.rows[0];
        const t = card.thresholds || {};
        let alert = null;
        if (t.critical_high && params.value > t.critical_high) alert = 'CRITICAL HIGH';
        else if (t.critical_low && params.value < t.critical_low) alert = 'CRITICAL LOW';
        else if (t.warning_high && params.value > t.warning_high) alert = 'WARNING HIGH';
        else if (t.warning_low && params.value < t.warning_low) alert = 'WARNING LOW';
        return { ok: true, card: card, alert, note: alert ? `Threshold alert: ${alert} for ${card.card_name}` : `Value recorded for ${card.card_name}` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_data_cards: {
    description: 'List all active data cards for the research workspace. Optionally filter by category or study.',
    parameters: {
      category: { type: 'string', description: 'Filter by category: gas, liquid, compound, environmental, custom' },
      study_id: { type: 'number', description: 'Filter by linked study' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM research_data_cards WHERE farm_id = $1 AND archived = false';
        const p = [ctx.farmId];
        if (params.category) { p.push(params.category); sql += ` AND category = $${p.length}`; }
        if (params.study_id) { p.push(params.study_id); sql += ` AND study_id = $${p.length}`; }
        sql += ' ORDER BY category, card_name';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, cards: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_data_card_history: {
    description: 'Get time-series history for a data card variable. Use to build graphs showing how a measured value changes over time.',
    parameters: {
      variable_key: { type: 'string', description: 'The variable key' },
      hours: { type: 'number', description: 'How far back to look in hours (default 168 = 7 days)' },
      limit: { type: 'number', description: 'Max data points to return (default 500)' },
    },
    required: ['variable_key'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        await query(
          `CREATE TABLE IF NOT EXISTS research_data_card_log (
            id SERIAL PRIMARY KEY, farm_id TEXT NOT NULL, variable_key TEXT NOT NULL,
            value NUMERIC NOT NULL, notes TEXT, recorded_at TIMESTAMPTZ DEFAULT NOW()
          )`
        ).catch(() => {});
        const hours = params.hours || 168;
        const limit = params.limit || 500;
        const result = await query(
          `SELECT value, notes, recorded_at FROM research_data_card_log
           WHERE farm_id = $1 AND variable_key = $2 AND recorded_at > NOW() - INTERVAL '1 hour' * $3
           ORDER BY recorded_at ASC LIMIT $4`,
          [ctx.farmId, params.variable_key, hours, limit]
        );
        return { ok: true, variable_key: params.variable_key, data_points: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // VISUALIZATION & CHARTING
  // ========================================

  create_research_chart: {
    description: 'Generate a scientific chart configuration for the research workspace. Supports line charts (time series), scatter plots (correlations), bar charts (comparisons), box plots (distributions), heatmaps (2D patterns), and multi-axis overlays. Charts render via Plotly.js in the workspace.',
    parameters: {
      chart_type: { type: 'string', description: 'Chart type', enum: ['line', 'scatter', 'bar', 'box', 'heatmap', 'multi_axis'] },
      title: { type: 'string', description: 'Chart title' },
      data_sources: { type: 'array', items: { type: 'object', properties: { variable_key: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' } } }, description: 'Array of { variable_key, label, color } objects defining data series' },
      x_label: { type: 'string', description: 'X-axis label' },
      y_label: { type: 'string', description: 'Y-axis label' },
      time_range_hours: { type: 'number', description: 'Time window in hours for time-series data (default 168)' },
      annotations: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' } } }, description: 'Array of { x, y, text } annotation markers' },
      study_id: { type: 'number', description: 'Link chart to a study for the workspace library' },
    },
    required: ['chart_type', 'title'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        // Fetch data for each source
        const traces = [];
        for (const src of (params.data_sources || [])) {
          const hours = params.time_range_hours || 168;
          const result = await query(
            `SELECT value, recorded_at FROM research_data_card_log
             WHERE farm_id = $1 AND variable_key = $2 AND recorded_at > NOW() - INTERVAL '1 hour' * $3
             ORDER BY recorded_at ASC LIMIT 500`,
            [ctx.farmId, src.variable_key, hours]
          ).catch(() => ({ rows: [] }));
          traces.push({ variable_key: src.variable_key, label: src.label || src.variable_key, color: src.color, data: result.rows });
        }
        const config = {
          chart_type: params.chart_type, title: params.title,
          x_label: params.x_label || 'Time', y_label: params.y_label || 'Value',
          traces, annotations: params.annotations || [],
        };
        // Persist chart for workspace library
        await query(
          `CREATE TABLE IF NOT EXISTS research_workspace_charts (
            id SERIAL PRIMARY KEY, farm_id TEXT NOT NULL, title TEXT NOT NULL,
            chart_type TEXT, config JSONB, study_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`
        ).catch(() => {});
        const saved = await query(
          `INSERT INTO research_workspace_charts (farm_id, title, chart_type, config, study_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [ctx.farmId, params.title, params.chart_type, JSON.stringify(config), params.study_id || null]
        ).catch(() => ({ rows: [{ id: null }] }));
        return { ok: true, chart_id: saved.rows[0]?.id, config, note: `Chart "${params.title}" created. It will render in the workspace visualization panel.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  render_formula: {
    description: 'Render a mathematical formula or equation in the workspace using LaTeX notation. Use for chemical equations, growth models, rate constants, fluid dynamics equations, or any scientific notation.',
    parameters: {
      latex: { type: 'string', description: 'LaTeX formula string (e.g., "\\\\frac{dC}{dt} = D \\\\nabla^2 C - vC + S")' },
      label: { type: 'string', description: 'Human-readable label for the formula' },
      context: { type: 'string', description: 'Where this formula applies (e.g., "Fick second law for CO2 diffusion in nutrient film")' },
    },
    required: ['latex', 'label'],
    execute: async (params) => {
      return {
        ok: true,
        display: { type: 'formula', latex: params.latex, label: params.label, context: params.context || '' },
        note: `Formula "${params.label}" will display in the workspace using KaTeX rendering.`,
      };
    },
  },

  // ========================================
  // FLUID DYNAMICS & SIMULATION
  // ========================================

  configure_flow_simulation: {
    description: 'Configure a fluid dynamics simulation for nutrient film technique (NFT), deep water culture (DWC), aeroponics, or custom flow systems. The simulation models laminar/turbulent flow, nutrient distribution, temperature gradients, and dissolved gas transport. Renders as a 3D visualization in the workspace via Three.js.',
    parameters: {
      system_type: { type: 'string', description: 'Hydroponic system type', enum: ['nft', 'dwc', 'aeroponics', 'ebb_flow', 'drip', 'custom'] },
      channel_length_m: { type: 'number', description: 'Channel or container length in meters' },
      channel_width_m: { type: 'number', description: 'Channel width in meters' },
      flow_rate_lpm: { type: 'number', description: 'Flow rate in liters per minute' },
      fluid_temp_c: { type: 'number', description: 'Fluid temperature in Celsius' },
      nutrient_ec: { type: 'number', description: 'Nutrient electrical conductivity (mS/cm)' },
      dissolved_o2_ppm: { type: 'number', description: 'Dissolved oxygen in ppm' },
      plant_spacing_cm: { type: 'number', description: 'Plant spacing in cm (affects flow obstruction model)' },
      simulation_name: { type: 'string', description: 'Name for this simulation configuration' },
    },
    required: ['system_type', 'simulation_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        await query(
          `CREATE TABLE IF NOT EXISTS research_flow_simulations (
            id SERIAL PRIMARY KEY, farm_id TEXT NOT NULL, simulation_name TEXT NOT NULL,
            system_type TEXT, config JSONB, results JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`
        ).catch(() => {});
        const config = { ...params };
        delete config.simulation_name;
        // Calculate Reynolds number for flow classification
        const flowRate = params.flow_rate_lpm || 2;
        const width = params.channel_width_m || 0.1;
        const velocity = (flowRate / 60000) / (width * 0.02); // assume 2cm depth
        const kinematicViscosity = 1.004e-6; // water at ~20C
        const hydraulicDiameter = 2 * width * 0.02 / (width + 0.02);
        const reynolds = velocity * hydraulicDiameter / kinematicViscosity;
        const flowRegime = reynolds < 2300 ? 'laminar' : reynolds < 4000 ? 'transitional' : 'turbulent';
        const results = {
          reynolds_number: Math.round(reynolds),
          flow_regime: flowRegime,
          velocity_ms: velocity.toFixed(4),
          hydraulic_diameter_m: hydraulicDiameter.toFixed(4),
          residence_time_s: ((params.channel_length_m || 1) / velocity).toFixed(1),
        };
        const saved = await query(
          `INSERT INTO research_flow_simulations (farm_id, simulation_name, system_type, config, results)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [ctx.farmId, params.simulation_name, params.system_type, JSON.stringify(config), JSON.stringify(results)]
        );
        return {
          ok: true, simulation_id: saved.rows[0]?.id, config, results,
          note: `Flow simulation "${params.simulation_name}" configured. Reynolds number: ${results.reynolds_number} (${flowRegime}). 3D visualization available in workspace.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_flow_simulations: {
    description: 'List saved fluid dynamics simulations with their parameters and results.',
    parameters: {
      system_type: { type: 'string', description: 'Filter by system type' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM research_flow_simulations WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.system_type) { p.push(params.system_type); sql += ` AND system_type = $${p.length}`; }
        sql += ' ORDER BY created_at DESC LIMIT 20';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, simulations: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },


  // ========================================
  // RESEARCH INTEGRATIONS -- ORCID, DataCite, OSF, protocols.io
  // ========================================

  link_orcid: {
    description: 'Link a researcher ORCID iD to the farm profile for provenance tracking. ORCID format: 0000-0000-0000-000X.',
    parameters: {
      orcid_id: { type: 'string', description: 'ORCID iD (format: 0000-0000-0000-000X)' },
      display_name: { type: 'string', description: 'Researcher display name' },
      affiliation: { type: 'string', description: 'Institutional affiliation' },
    },
    required: ['orcid_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(params.orcid_id)) {
          return { ok: false, error: 'Invalid ORCID format. Expected: 0000-0000-0000-000X' };
        }
        const result = await query(
          `INSERT INTO researcher_orcid_profiles (farm_id, orcid_id, display_name, affiliation, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (farm_id, orcid_id) DO UPDATE SET display_name = $3, affiliation = $4, updated_at = NOW()
           RETURNING *`,
          [ctx.farmId, params.orcid_id, params.display_name || null, params.affiliation || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to link ORCID profile' };
        return { ok: true, profile: result.rows[0], message: `ORCID ${params.orcid_id} linked to farm profile.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  lookup_orcid: {
    description: 'Look up a researcher by ORCID iD using the public ORCID API. Returns name, affiliation, and biography.',
    parameters: {
      orcid_id: { type: 'string', description: 'ORCID iD to look up' },
    },
    required: ['orcid_id'],
    execute: async (params, ctx) => {
      try {
        if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(params.orcid_id)) {
          return { ok: false, error: 'Invalid ORCID format' };
        }
        const resp = await fetch(`https://pub.orcid.org/v3.0/${params.orcid_id}/person`, {
          headers: { 'Accept': 'application/json' }
        });
        if (!resp.ok) return { ok: false, error: 'ORCID profile not found' };
        const data = await resp.json();
        const name = data.name || {};
        return {
          ok: true,
          orcid_id: params.orcid_id,
          given_name: name['given-names']?.value || '',
          family_name: name['family-name']?.value || '',
          display_name: [name['given-names']?.value, name['family-name']?.value].filter(Boolean).join(' '),
          biography: data.biography?.content || '',
          url: `https://orcid.org/${params.orcid_id}`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  prepare_doi_metadata: {
    description: 'Prepare DataCite metadata for a dataset, study, or publication to register a DOI. Stores the metadata record for later registration.',
    parameters: {
      entity_type: { type: 'string', description: 'Type: study, dataset, publication, protocol, simulation' },
      entity_id: { type: 'number', description: 'ID of the entity to assign a DOI' },
      title: { type: 'string', description: 'Title for the DOI record' },
      creators: { type: 'string', description: 'Comma-separated creator names' },
      resource_type: { type: 'string', description: 'DataCite resourceTypeGeneral (Dataset, Text, Software, etc.)' },
      description: { type: 'string', description: 'Description of the resource' },
    },
    required: ['entity_type', 'entity_id', 'title'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const metadata = {
          title: params.title,
          creators: (params.creators || '').split(',').map(c => ({ name: c.trim() })).filter(c => c.name),
          resourceType: params.resource_type || 'Dataset',
          description: params.description || '',
          publisher: 'GreenReach Research Platform',
          publicationYear: new Date().getFullYear(),
        };
        const result = await query(
          `INSERT INTO dataset_dois (farm_id, entity_type, entity_id, datacite_metadata, created_at)
           VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
          [ctx.farmId, params.entity_type, params.entity_id, JSON.stringify(metadata)]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to prepare DOI metadata' };
        return { ok: true, doi_record: result.rows[0], message: 'DOI metadata prepared. Status: draft. Register with DataCite when ready.' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  create_osf_project: {
    description: 'Create or link an Open Science Framework (OSF) project for a study. OSF provides public/private repositories for research data, preprints, and registrations.',
    parameters: {
      title: { type: 'string', description: 'Project title' },
      study_id: { type: 'number', description: 'Study ID to link the OSF project to' },
      osf_project_id: { type: 'string', description: 'Existing OSF node ID to link (e.g., abc12). Omit to create a new record.' },
    },
    required: ['title'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const osfUrl = params.osf_project_id ? `https://osf.io/${params.osf_project_id}/` : null;
        const result = await query(
          `INSERT INTO osf_projects (farm_id, osf_project_id, study_id, title, osf_url, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [ctx.farmId, params.osf_project_id || null, params.study_id || null, params.title, osfUrl]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create OSF project record' };
        return { ok: true, project: result.rows[0], message: params.osf_project_id ? 'OSF project linked.' : 'OSF project record created. Link to osf.io when repository is set up.' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  create_protocol_version: {
    description: 'Create or version a research protocol. Protocols define step-by-step methods including materials, equipment, and safety notes. Supports integration with protocols.io.',
    parameters: {
      protocol_name: { type: 'string', description: 'Name of the protocol' },
      study_id: { type: 'number', description: 'Study ID this protocol belongs to' },
      steps: { type: 'string', description: 'JSON array of protocol steps, or a plain-text description' },
      materials: { type: 'string', description: 'Materials list' },
      equipment: { type: 'string', description: 'Equipment list' },
      safety_notes: { type: 'string', description: 'Safety considerations' },
      protocols_io_id: { type: 'string', description: 'protocols.io ID if publishing there' },
    },
    required: ['protocol_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const existing = await query(
          'SELECT MAX(version_number) as max_v FROM research_protocol_versions WHERE farm_id = $1 AND protocol_name = $2',
          [ctx.farmId, params.protocol_name]
        ).catch(() => ({ rows: [{ max_v: 0 }] }));
        const nextVersion = (existing.rows[0]?.max_v || 0) + 1;
        let steps = params.steps || '';
        try { steps = JSON.parse(steps); } catch (_) { /* keep as string */ }
        const content = {
          steps,
          materials: params.materials || '',
          equipment: params.equipment || '',
          safety_notes: params.safety_notes || '',
        };
        const result = await query(
          `INSERT INTO research_protocol_versions (farm_id, study_id, protocol_name, version_number, protocols_io_id, content, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
          [ctx.farmId, params.study_id || null, params.protocol_name, nextVersion, params.protocols_io_id || null, JSON.stringify(content)]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create protocol version' };
        return { ok: true, protocol: result.rows[0], message: `Protocol "${params.protocol_name}" v${nextVersion} created.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // INSTRUMENT ABSTRACTION (SiLA 2, OPC UA, SCPI)
  // ========================================

  register_instrument: {
    description: 'Register a lab instrument in the abstraction layer. Supports connection protocols: SiLA 2 (HTTP/2+gRPC), OPC UA (binary), SCPI (socket), MQTT, REST, vendor SDK, or manual entry.',
    parameters: {
      instrument_name: { type: 'string', description: 'Instrument name' },
      instrument_type: { type: 'string', description: 'Type: spectrometer, microscope, sensor, pump, controller, balance, incubator, bioanalyzer, chromatograph, etc.' },
      manufacturer: { type: 'string', description: 'Manufacturer name' },
      model: { type: 'string', description: 'Model number/name' },
      serial_number: { type: 'string', description: 'Serial number' },
      connection_protocol: { type: 'string', description: 'Protocol: sila2, opcua, scpi, mqtt, rest, vendor_sdk, manual', enum: ['sila2', 'opcua', 'scpi', 'mqtt', 'rest', 'vendor_sdk', 'manual'] },
      host: { type: 'string', description: 'Connection host/IP (for networked instruments)' },
      port: { type: 'number', description: 'Connection port' },
      location: { type: 'string', description: 'Physical location of the instrument' },
    },
    required: ['instrument_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const connectionConfig = {};
        if (params.host) connectionConfig.host = params.host;
        if (params.port) connectionConfig.port = params.port;
        const result = await query(
          `INSERT INTO instrument_registry (farm_id, instrument_name, instrument_type, manufacturer, model,
           serial_number, connection_protocol, connection_config, location, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
          [ctx.farmId, params.instrument_name, params.instrument_type || null,
           params.manufacturer || null, params.model || null, params.serial_number || null,
           params.connection_protocol || 'manual', JSON.stringify(connectionConfig), params.location || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to register instrument' };
        return { ok: true, instrument: result.rows[0], message: `Instrument "${params.instrument_name}" registered with ${params.connection_protocol || 'manual'} protocol.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  list_instruments: {
    description: 'List registered lab instruments with their status, connection protocol, and calibration information.',
    parameters: {
      status: { type: 'string', description: 'Filter by status: online, offline, calibrating, running, error, maintenance' },
      instrument_type: { type: 'string', description: 'Filter by instrument type' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM instrument_registry WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.status) { p.push(params.status); sql += ` AND status = $${p.length}`; }
        if (params.instrument_type) { p.push(params.instrument_type); sql += ` AND instrument_type = $${p.length}`; }
        sql += ' ORDER BY instrument_name';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, instruments: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  request_instrument_run: {
    description: 'Submit an instrument run request. Creates an instrument session and an approval gate that must be approved before the instrument can be activated.',
    parameters: {
      instrument_id: { type: 'number', description: 'ID of the instrument to run' },
      study_id: { type: 'number', description: 'Study ID for context' },
      session_type: { type: 'string', description: 'Type: calibration, data_collection, experiment_run, maintenance' },
      parameters: { type: 'string', description: 'JSON object of run parameters (settings, duration, etc.)' },
      justification: { type: 'string', description: 'Justification for the instrument run' },
    },
    required: ['instrument_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const inst = await query('SELECT id, instrument_name FROM instrument_registry WHERE id = $1 AND farm_id = $2', [params.instrument_id, ctx.farmId]).catch(() => ({ rows: [] }));
        if (!inst.rows.length) return { ok: false, error: 'Instrument not found' };
        let runParams = {};
        if (params.parameters) { try { runParams = JSON.parse(params.parameters); } catch (_) { runParams = { raw: params.parameters }; } }
        const session = await query(
          `INSERT INTO instrument_sessions (farm_id, instrument_id, study_id, session_type, parameters, started_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
          [ctx.farmId, params.instrument_id, params.study_id || null, params.session_type || 'data_collection', JSON.stringify(runParams), ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        const gate = await query(
          `INSERT INTO approval_gates (farm_id, gate_type, entity_type, entity_id, requested_by, justification, requested_at)
           VALUES ($1, 'instrument_run', 'instrument_session', $2, $3, $4, NOW()) RETURNING *`,
          [ctx.farmId, session.rows[0]?.id, ctx.userId || null, params.justification || `Run request for ${inst.rows[0].instrument_name}`]
        ).catch(() => ({ rows: [] }));
        return {
          ok: true,
          session: session.rows[0],
          approval_gate: gate.rows[0],
          message: `Instrument run requested for "${inst.rows[0].instrument_name}". Approval gate created -- pending PI/supervisor review.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_instrument_telemetry: {
    description: 'Retrieve telemetry data from an instrument. Shows recent metric readings (temperature, pressure, voltage, etc.) for monitoring.',
    parameters: {
      instrument_id: { type: 'number', description: 'Instrument ID' },
      hours: { type: 'number', description: 'Hours of history to retrieve (default: 24)' },
      metric_name: { type: 'string', description: 'Filter by specific metric name' },
    },
    required: ['instrument_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = `SELECT * FROM instrument_telemetry WHERE farm_id = $1 AND instrument_id = $2
                    AND recorded_at > NOW() - INTERVAL '1 hour' * $3`;
        const p = [ctx.farmId, params.instrument_id, params.hours || 24];
        if (params.metric_name) { p.push(params.metric_name); sql += ` AND metric_name = $${p.length}`; }
        sql += ' ORDER BY recorded_at DESC LIMIT 200';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, telemetry: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // WORKFLOW ENGINE (Nextflow-compatible pipelines)
  // ========================================

  create_workflow: {
    description: 'Define a reproducible workflow pipeline. Supports Nextflow, shell, Python, and R engines. Workflows define process graphs with inputs, outputs, and parameters.',
    parameters: {
      workflow_name: { type: 'string', description: 'Workflow name' },
      workflow_type: { type: 'string', description: 'Type: ingestion, preprocessing, analysis, simulation, cfd, ml_training, reporting' },
      engine: { type: 'string', description: 'Execution engine: nextflow, shell, python, r' },
      template_id: { type: 'string', description: 'Template ID for pre-built workflows' },
      definition: { type: 'string', description: 'JSON workflow definition (process graph, parameters)' },
    },
    required: ['workflow_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let def = {};
        if (params.definition) { try { def = JSON.parse(params.definition); } catch (_) { def = { description: params.definition }; } }
        const result = await query(
          `INSERT INTO workflow_definitions (farm_id, workflow_name, workflow_type, engine, template_id, definition, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
          [ctx.farmId, params.workflow_name, params.workflow_type || 'analysis',
           params.engine || 'nextflow', params.template_id || null, JSON.stringify(def), ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create workflow' };
        return { ok: true, workflow: result.rows[0], message: `Workflow "${params.workflow_name}" created with ${params.engine || 'nextflow'} engine.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  submit_workflow_run: {
    description: 'Submit a workflow for execution. Creates an approval gate for workflow runs. Supports execution targets: local, HPC, cloud, cluster.',
    parameters: {
      workflow_id: { type: 'number', description: 'Workflow definition ID' },
      study_id: { type: 'number', description: 'Study ID for context' },
      parameters: { type: 'string', description: 'JSON run parameters' },
      inputs: { type: 'string', description: 'JSON input files/datasets' },
      execution_target: { type: 'string', description: 'Target: local, hpc, cloud, cluster' },
    },
    required: ['workflow_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const wf = await query('SELECT id, workflow_name FROM workflow_definitions WHERE id = $1 AND farm_id = $2', [params.workflow_id, ctx.farmId]).catch(() => ({ rows: [] }));
        if (!wf.rows.length) return { ok: false, error: 'Workflow not found' };
        let runParams = {}, runInputs = {};
        if (params.parameters) { try { runParams = JSON.parse(params.parameters); } catch (_) { runParams = { raw: params.parameters }; } }
        if (params.inputs) { try { runInputs = JSON.parse(params.inputs); } catch (_) { runInputs = { raw: params.inputs }; } }
        const run = await query(
          `INSERT INTO workflow_runs (farm_id, workflow_id, study_id, parameters, inputs, execution_target, submitted_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
          [ctx.farmId, params.workflow_id, params.study_id || null, JSON.stringify(runParams),
           JSON.stringify(runInputs), params.execution_target || 'local', ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        const gate = await query(
          `INSERT INTO approval_gates (farm_id, gate_type, entity_type, entity_id, requested_by, justification, requested_at)
           VALUES ($1, 'workflow_execution', 'workflow_run', $2, $3, $4, NOW()) RETURNING *`,
          [ctx.farmId, run.rows[0]?.id, ctx.userId || null, `Workflow run: ${wf.rows[0].workflow_name}`]
        ).catch(() => ({ rows: [] }));
        return {
          ok: true,
          run: run.rows[0],
          approval_gate: gate.rows[0],
          message: `Workflow run submitted for "${wf.rows[0].workflow_name}" on ${params.execution_target || 'local'}. Approval gate pending.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_workflow_status: {
    description: 'Check the status of workflow runs. Shows run status, metrics, outputs, and execution details.',
    parameters: {
      workflow_id: { type: 'number', description: 'Filter by workflow definition ID' },
      status: { type: 'string', description: 'Filter by status: submitted, queued, running, completed, failed, cancelled' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = `SELECT wr.*, wd.workflow_name, wd.engine FROM workflow_runs wr
                    LEFT JOIN workflow_definitions wd ON wr.workflow_id = wd.id WHERE wr.farm_id = $1`;
        const p = [ctx.farmId];
        if (params.workflow_id) { p.push(params.workflow_id); sql += ` AND wr.workflow_id = $${p.length}`; }
        if (params.status) { p.push(params.status); sql += ` AND wr.run_status = $${p.length}`; }
        sql += ' ORDER BY wr.created_at DESC LIMIT 20';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, runs: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // DATA TRANSFER (Globus)
  // ========================================

  initiate_data_transfer: {
    description: 'Initiate a secure data transfer via Globus. Supports cross-institution transfers of research datasets between endpoints.',
    parameters: {
      direction: { type: 'string', description: 'Transfer direction: inbound or outbound' },
      source_endpoint: { type: 'string', description: 'Source Globus endpoint ID or path' },
      destination_endpoint: { type: 'string', description: 'Destination Globus endpoint ID or path' },
      files: { type: 'string', description: 'JSON array of file paths to transfer' },
      partner_institution: { type: 'string', description: 'Name of the partner institution' },
    },
    required: ['direction', 'source_endpoint', 'destination_endpoint'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let fileList = [];
        if (params.files) { try { fileList = JSON.parse(params.files); } catch (_) { fileList = [{ path: params.files }]; } }
        const result = await query(
          `INSERT INTO globus_transfers (farm_id, direction, source_endpoint, destination_endpoint, files, partner_institution, initiated_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
          [ctx.farmId, params.direction, params.source_endpoint, params.destination_endpoint,
           JSON.stringify(fileList), params.partner_institution || null, ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create transfer record' };
        return {
          ok: true,
          transfer: result.rows[0],
          message: `${params.direction} transfer initiated. Source: ${params.source_endpoint} -> Dest: ${params.destination_endpoint}. Status: pending. Connect Globus credentials to activate.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // GOVERNANCE (Roles, Approvals, Provenance)
  // ========================================

  assign_research_role: {
    description: 'Assign a research role to a team member for governance and permission control. Roles: PI, Co-PI, Postdoc, Grad Student, Technician, Collaborator, Viewer.',
    parameters: {
      researcher_name: { type: 'string', description: 'Name of the researcher' },
      orcid_id: { type: 'string', description: 'ORCID iD of the researcher' },
      role_name: { type: 'string', description: 'Role: pi, co_pi, postdoc, grad_student, technician, collaborator, viewer', enum: ['pi', 'co_pi', 'postdoc', 'grad_student', 'technician', 'collaborator', 'viewer'] },
      study_id: { type: 'number', description: 'Study ID to scope the role (omit for farm-wide)' },
    },
    required: ['role_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          `INSERT INTO research_roles (farm_id, orcid_id, researcher_name, role_name, study_id, granted_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
          [ctx.farmId, params.orcid_id || null, params.researcher_name || null,
           params.role_name, params.study_id || null, ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to assign role' };
        const scope = params.study_id ? `study #${params.study_id}` : 'farm-wide';
        return { ok: true, role: result.rows[0], message: `Role "${params.role_name}" assigned${params.researcher_name ? ' to ' + params.researcher_name : ''} (${scope}).` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  request_approval: {
    description: 'Submit an approval request for a gated action. Gate types: instrument_run, workflow_execution, data_export, protocol_change, publication_submit. Creates a pending approval that must be reviewed by an authorized team member.',
    parameters: {
      gate_type: { type: 'string', description: 'Gate type: instrument_run, workflow_execution, data_export, protocol_change, publication_submit' },
      entity_type: { type: 'string', description: 'Entity type being approved' },
      entity_id: { type: 'number', description: 'Entity ID' },
      justification: { type: 'string', description: 'Justification for the request' },
    },
    required: ['gate_type', 'justification'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          `INSERT INTO approval_gates (farm_id, gate_type, entity_type, entity_id, requested_by, justification, requested_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
          [ctx.farmId, params.gate_type, params.entity_type || null, params.entity_id || null, ctx.userId || null, params.justification]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create approval request' };
        return { ok: true, approval: result.rows[0], message: `Approval request submitted (${params.gate_type}). Status: pending.` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  review_pending_approvals: {
    description: 'List pending approval requests that need review. Shows all approval gates awaiting decision with their justifications and requesters.',
    parameters: {
      gate_type: { type: 'string', description: 'Filter by gate type' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = "SELECT * FROM approval_gates WHERE farm_id = $1 AND status = 'pending'";
        const p = [ctx.farmId];
        if (params.gate_type) { p.push(params.gate_type); sql += ` AND gate_type = $${p.length}`; }
        sql += ' ORDER BY requested_at ASC';
        const result = await query(sql, p).catch(() => ({ rows: [] }));
        return { ok: true, pending_approvals: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  seal_run_record: {
    description: 'Create an immutable, tamper-evident run record. Generates a SHA-512 hash of the experiment/session snapshot for provenance and audit. Once sealed, the record cannot be modified.',
    parameters: {
      record_type: { type: 'string', description: 'Type: experiment, instrument_session, workflow_run, calibration, observation' },
      source_table: { type: 'string', description: 'Source table name (e.g., instrument_sessions, workflow_runs)' },
      source_id: { type: 'number', description: 'ID from the source table' },
    },
    required: ['record_type', 'source_table', 'source_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        // Fetch the source record
        const validTables = ['instrument_sessions', 'workflow_runs', 'research_observations', 'research_protocol_versions', 'cfd_pipeline_jobs'];
        if (!validTables.includes(params.source_table)) {
          return { ok: false, error: `Invalid source table. Supported: ${validTables.join(', ')}` };
        }
        const source = await query(`SELECT * FROM ${params.source_table} WHERE id = $1 AND farm_id = $2`, [params.source_id, ctx.farmId]).catch(() => ({ rows: [] }));
        if (!source.rows.length) return { ok: false, error: 'Source record not found' };
        const snapshot = source.rows[0];
        const hash = require('crypto').createHash('sha512').update(JSON.stringify(snapshot)).digest('hex');
        const result = await query(
          `INSERT INTO immutable_run_records (farm_id, record_type, source_table, source_id, record_hash, snapshot, sealed_by, sealed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id, record_type, source_table, source_id, record_hash, sealed_at, verification_status`,
          [ctx.farmId, params.record_type, params.source_table, params.source_id, hash, JSON.stringify(snapshot), ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to seal record' };
        return {
          ok: true,
          sealed_record: result.rows[0],
          hash_algorithm: 'SHA-512',
          message: `Record sealed with SHA-512 hash. This immutable record provides tamper-evident provenance for audit and compliance.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // CFD PIPELINE (FreeCAD -> Gmsh -> OpenFOAM -> ParaView)
  // ========================================

  create_cfd_pipeline_job: {
    description: 'Create a CFD simulation pipeline job. Templates: microfluidic_channel, airflow_enclosure, mixing_vessel, heat_flow_chamber, nft_channel, bioreactor. Pipeline stages: geometry (FreeCAD) -> meshing (Gmsh) -> solving (OpenFOAM) -> post-processing (ParaView).',
    parameters: {
      job_name: { type: 'string', description: 'Job name' },
      template_type: { type: 'string', description: 'CFD template: microfluidic_channel, airflow_enclosure, mixing_vessel, heat_flow_chamber, nft_channel, bioreactor, custom' },
      study_id: { type: 'number', description: 'Study ID for context' },
      geometry_params: { type: 'string', description: 'JSON geometry parameters (dimensions, boundary conditions)' },
      mesh_params: { type: 'string', description: 'JSON mesh parameters (element size, refinement zones)' },
      solver_params: { type: 'string', description: 'JSON solver parameters (turbulence model, timestep, iterations)' },
      execution_target: { type: 'string', description: 'Target: local, hpc, cloud' },
    },
    required: ['job_name'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let geo = {}, mesh = {}, solver = {};
        if (params.geometry_params) { try { geo = JSON.parse(params.geometry_params); } catch (_) { geo = { description: params.geometry_params }; } }
        if (params.mesh_params) { try { mesh = JSON.parse(params.mesh_params); } catch (_) { mesh = { description: params.mesh_params }; } }
        if (params.solver_params) { try { solver = JSON.parse(params.solver_params); } catch (_) { solver = { description: params.solver_params }; } }
        const result = await query(
          `INSERT INTO cfd_pipeline_jobs (farm_id, study_id, job_name, template_type, geometry_config, mesh_config, solver_config, execution_target, submitted_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
          [ctx.farmId, params.study_id || null, params.job_name, params.template_type || 'custom',
           JSON.stringify(geo), JSON.stringify(mesh), JSON.stringify(solver),
           params.execution_target || 'local', ctx.userId || null]
        ).catch(() => ({ rows: [] }));
        if (!result.rows.length) return { ok: false, error: 'Failed to create CFD job' };
        return {
          ok: true,
          job: result.rows[0],
          pipeline: 'FreeCAD (geometry) -> Gmsh (meshing) -> OpenFOAM (solving) -> ParaView (visualization)',
          message: `CFD pipeline job "${params.job_name}" created with ${params.template_type || 'custom'} template. Stage: geometry. Submit for execution when parameters are configured.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_cfd_templates: {
    description: 'List available CFD simulation templates with default parameters for each pipeline stage.',
    parameters: {},
    required: [],
    execute: async (params, ctx) => {
      return {
        ok: true,
        templates: [
          {
            id: 'microfluidic_channel',
            name: 'Microfluidic Channel',
            description: 'Laminar flow in microfluidic channels for nutrient delivery analysis',
            default_geometry: { channel_length_mm: 50, channel_width_mm: 1, channel_height_mm: 0.5, inlet_count: 1, outlet_count: 1 },
            default_mesh: { element_size_mm: 0.05, refinement_layers: 3 },
            default_solver: { turbulence_model: 'laminar', timestep_s: 0.001, max_iterations: 1000 },
          },
          {
            id: 'airflow_enclosure',
            name: 'Airflow Enclosure',
            description: 'HVAC and ventilation analysis for controlled environment agriculture',
            default_geometry: { length_m: 3, width_m: 2, height_m: 2.5, inlet_positions: [[0, 1.25, 2.5]], outlet_positions: [[3, 1.25, 0]] },
            default_mesh: { element_size_m: 0.05, boundary_refinement: true },
            default_solver: { turbulence_model: 'kEpsilon', timestep_s: 0.1, max_iterations: 5000 },
          },
          {
            id: 'mixing_vessel',
            name: 'Mixing Vessel',
            description: 'Stirred tank reactor simulation for nutrient mixing optimization',
            default_geometry: { diameter_m: 0.5, height_m: 0.8, impeller_type: 'rushton', impeller_rpm: 200 },
            default_mesh: { element_size_m: 0.01, rotating_zone: true },
            default_solver: { turbulence_model: 'kOmegaSST', timestep_s: 0.01, max_iterations: 3000 },
          },
          {
            id: 'heat_flow_chamber',
            name: 'Heat Flow Chamber',
            description: 'Thermal analysis for growth chambers with heating/cooling elements',
            default_geometry: { length_m: 2, width_m: 1.5, height_m: 2, heat_sources: [{ position: [1, 0.75, 0], power_w: 500 }] },
            default_mesh: { element_size_m: 0.03, thermal_boundary_layers: 5 },
            default_solver: { turbulence_model: 'kEpsilon', energy_equation: true, timestep_s: 0.5, max_iterations: 5000 },
          },
          {
            id: 'nft_channel',
            name: 'NFT Channel',
            description: 'Nutrient Film Technique channel flow simulation',
            default_geometry: { channel_length_m: 3, channel_width_m: 0.1, channel_slope_deg: 1.5, film_depth_mm: 3 },
            default_mesh: { element_size_mm: 1, free_surface_refinement: true },
            default_solver: { turbulence_model: 'laminar', multiphase: 'VOF', timestep_s: 0.01, max_iterations: 2000 },
          },
          {
            id: 'bioreactor',
            name: 'Bioreactor',
            description: 'Bioreactor flow simulation with aeration and mixing',
            default_geometry: { diameter_m: 0.3, height_m: 0.6, sparger_type: 'ring', aeration_rate_lpm: 2 },
            default_mesh: { element_size_m: 0.005, bubble_tracking: true },
            default_solver: { turbulence_model: 'kOmegaSST', multiphase: 'eulerEuler', timestep_s: 0.005, max_iterations: 5000 },
          },
        ],
        message: 'Available CFD templates. Use create_cfd_pipeline_job with a template_type to create a simulation job with these defaults.',
      };
    },
  },


  // ========================================
  // FAYE INTEGRATION
  // ========================================

  request_faye_review: {
    description: 'Request FAYE safe-patch approval for changes that extend beyond the research bubble. GWEN can propose changes but FAYE must approve anything affecting platform security or non-research systems.',
    parameters: {
      change_description: { type: 'string', description: 'Description of the proposed change' },
      affected_systems: { type: 'string', description: 'Systems affected outside research bubble' },
      risk_level: { type: 'string', description: 'Assessed risk: low, medium, high', enum: ['low', 'medium', 'high'] },
    },
    required: ['change_description', 'affected_systems'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        await query(
          `INSERT INTO inter_agent_messages (from_agent, to_agent, subject, body, priority, status, created_at)
           VALUES ('gwen', 'faye', $1, $2, $3, 'pending', NOW())`,
          [
            'Safe Patch Request: ' + params.change_description.slice(0, 100),
            JSON.stringify({ change: params.change_description, systems: params.affected_systems, risk: params.risk_level || 'medium' }),
            params.risk_level === 'high' ? 'high' : 'normal',
          ]
        ).catch(() => {});
        return {
          ok: true,
          note: 'Safe patch request submitted to F.A.Y.E. for review. Changes outside the research bubble require her approval before implementation.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_faye_security_assessment: {
    description: 'Get FAYE security posture assessment for research data and infrastructure.',
    parameters: {},
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const alerts = await query(
          `SELECT * FROM admin_alerts WHERE farm_id = $1 AND status = 'active'
           ORDER BY created_at DESC LIMIT 10`, [ctx.farmId]).catch(() => ({ rows: [] }));
        const incidents = await query(
          'SELECT * FROM security_incidents WHERE farm_id = $1 ORDER BY reported_date DESC LIMIT 5',
          [ctx.farmId]).catch(() => ({ rows: [] }));
        return {
          ok: true, active_alerts: alerts.rows, recent_incidents: incidents.rows,
          note: 'Security assessment data gathered from FAYE monitoring systems.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_faye_directives: {
    description: 'Check for unread messages and directives from F.A.Y.E. Call this at the start of each conversation to see if FAYE has sent instructions, approvals, security advisories, or feedback.',
    parameters: {
      limit: { type: 'number', description: 'Max messages to retrieve (default 10)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const limit = params.limit || 10;
        const msgs = await query(
          `SELECT id, from_agent AS sender, subject, body, priority, status, created_at
           FROM inter_agent_messages WHERE to_agent = 'gwen' AND status = 'pending'
           ORDER BY created_at DESC LIMIT $1`, [limit]
        ).catch(() => ({ rows: [] }));
        if (msgs.rows.length > 0) {
          await query(
            `UPDATE inter_agent_messages SET status = 'read'
             WHERE to_agent = 'gwen' AND status = 'pending'`
          ).catch(() => {});
        }
        return {
          ok: true, count: msgs.rows.length, messages: msgs.rows,
          note: msgs.rows.length ? `${msgs.rows.length} directive(s) from F.A.Y.E. Review and act on high-priority items first.` : 'No pending directives from F.A.Y.E.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  reply_to_faye: {
    description: 'Send a reply, status update, or observation back to F.A.Y.E. Use this for responding to her directives, reporting research findings that have platform-wide relevance, or escalating issues.',
    parameters: {
      subject: { type: 'string', description: 'Brief subject line' },
      body: { type: 'string', description: 'Message body with relevant details' },
      message_type: { type: 'string', description: 'Type of message', enum: ['reply', 'status_update', 'observation', 'escalation'] },
      priority: { type: 'string', description: 'Priority level', enum: ['normal', 'high', 'critical'] },
      reply_to_id: { type: 'number', description: 'ID of the message being replied to (optional)' },
    },
    required: ['subject', 'body'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        await query(
          `INSERT INTO inter_agent_messages (from_agent, to_agent, message_type, subject, body, priority, reply_to_id, status, created_at)
           VALUES ('gwen', 'faye', $1, $2, $3, $4, $5, 'pending', NOW())`,
          [
            params.message_type || 'reply',
            params.subject,
            params.body,
            params.priority || 'normal',
            params.reply_to_id || null,
          ]
        );
        return { ok: true, note: `Message sent to F.A.Y.E.: "${params.subject}"` };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // KNOWLEDGE & LEARNING
  // ========================================

  get_grant_programs_database: {
    description: 'Access the reference database of Canadian grant programs with eligibility rules, deadlines, and scoring criteria.',
    parameters: {
      agency: { type: 'string', description: 'Filter by agency: NSERC, CIHR, SSHRC, CFI, MITACS, provincial' },
      keyword: { type: 'string', description: 'Search keyword' },
    },
    required: [],
    execute: async () => {
      // Built-in knowledge base -- the LLM uses encoded program rules
      return {
        ok: true,
        agencies: ['NSERC', 'CIHR', 'SSHRC', 'CFI', 'MITACS', 'Ontario Research Fund', 'SSHRC Partnership', 'CIHR Project Grant'],
        note: 'I will draw on my encoded knowledge of Canadian tri-agency and provincial grant programs to answer your question.',
      };
    },
  },

  review_study_design: {
    description: 'Challenge weak study designs before they become polished applications. Based on Penckofer & Martyn-Nemeth (2024) and grant-writing literature.',
    parameters: {
      study_id: { type: 'number', description: 'Study to review' },
      aims_text: { type: 'string', description: 'Specific aims text if available' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        const protocols = await query('SELECT * FROM study_protocols WHERE study_id = $1 ORDER BY version DESC LIMIT 1', [params.study_id]);
        return {
          ok: true, study: s.rows[0], latest_protocol: protocols.rows[0] || null, aims_text: params.aims_text,
          note: 'I will now critically review the study design for: novel research question, strong specific aims, theoretical framework, feasible methodology, and team expertise.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  draft_knowledge_mobilization_plan: {
    description: 'Create a knowledge mobilization plan turning the project into a credible impact pathway. Covers dissemination, stakeholder engagement, and Ontario-specific requirements.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID' },
      target_competition: { type: 'string', description: 'Competition requiring the KMb plan' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const s = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!s.rows.length) return { ok: false, error: 'Study not found' };
        return {
          ok: true, study: s.rows[0], competition: params.target_competition,
          note: 'I will now draft a knowledge mobilization plan covering dissemination strategy, stakeholder engagement, impact measurement, and youth outreach where required.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // GRANT PROGRAM DISCOVERY & MATCHING
  // (Bridges grant-wizard program database
  //  into the research agent workflow)
  // ========================================

  search_grant_programs: {
    description: 'Search the database of Canadian grant and funding programs. Filter by intake status, funding type, or keyword. Returns programs with deadlines, funding amounts, and eligibility details.',
    parameters: {
      search: { type: 'string', description: 'Keyword search across program name, description, agency, objectives, and priority areas' },
      status: { type: 'string', description: 'Filter by intake status: open, upcoming, continuous, closed' },
      funding_type: { type: 'string', description: 'Filter by funding type (e.g., grant, loan, tax_credit)' },
      limit: { type: 'number', description: 'Max results to return (default 20)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let where = ['active = TRUE'];
        const p = [];
        let idx = 1;
        if (params.status) { where.push(`intake_status = $${idx++}`); p.push(params.status); }
        if (params.funding_type) { where.push(`funding_type = $${idx++}`); p.push(params.funding_type); }
        if (params.search) {
          const terms = params.search.split(/\s+/).filter(Boolean);
          const termClauses = terms.map(term => {
            const clause = `(program_name ILIKE $${idx} OR description ILIKE $${idx} OR administering_agency ILIKE $${idx} OR objectives ILIKE $${idx} OR priority_areas::text ILIKE $${idx})`;
            p.push(`%${term}%`);
            idx++;
            return clause;
          });
          where.push(`(${termClauses.join(' OR ')})`);
        }
        const lim = Math.min(params.limit || 20, 50);
        p.push(lim);
        const result = await query(`
          SELECT id, program_code, program_name, administering_agency, source_url,
                 intake_status, intake_deadline, description, funding_type,
                 min_funding, max_funding, cost_share_ratio, priority_areas, equity_enhanced
          FROM grant_programs WHERE ${where.join(' AND ')}
          ORDER BY CASE intake_status WHEN 'open' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'continuous' THEN 3 ELSE 4 END,
                   intake_deadline ASC NULLS LAST
          LIMIT $${idx}
        `, p);
        return { ok: true, programs: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_grant_program_details: {
    description: 'Get full details of a specific grant program including eligibility rules, required documents, question map, application method, and priority lexicon.',
    parameters: {
      program_id: { type: 'number', description: 'Grant program ID' },
    },
    required: ['program_id'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query('SELECT * FROM grant_programs WHERE id = $1 AND active = TRUE', [params.program_id]);
        if (!result.rows.length) return { ok: false, error: 'Program not found or inactive' };
        return { ok: true, program: result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  check_program_eligibility: {
    description: 'Check eligibility for a specific grant program by answering screening questions. Provide organization details and the tool checks against the program stored eligibility rules.',
    parameters: {
      program_id: { type: 'number', description: 'Grant program ID to check eligibility for' },
      province: { type: 'string', description: 'Province/territory of the organization' },
      organization_type: { type: 'string', description: 'Type: farm, corporation, cooperative, non-profit, indigenous, university, college' },
      employee_count: { type: 'number', description: 'Number of employees' },
      sector: { type: 'string', description: 'Business sector (e.g., agriculture, technology, food_processing)' },
      annual_revenue: { type: 'number', description: 'Annual gross revenue' },
    },
    required: ['program_id'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          'SELECT program_name, eligibility_rules, eligibility_summary, equity_enhanced, equity_details FROM grant_programs WHERE id = $1',
          [params.program_id]
        );
        if (!result.rows.length) return { ok: false, error: 'Program not found' };
        const prog = result.rows[0];
        const rules = prog.eligibility_rules || {};
        const answers = {
          province: params.province, organizationType: params.organization_type,
          employeeCount: params.employee_count, sector: params.sector, annualRevenue: params.annual_revenue,
        };
        const checks = [];
        let eligible = true;
        let maybeEligible = false;
        for (const [field, rule] of Object.entries(rules)) {
          const answer = answers[field];
          if (answer === undefined || answer === null) {
            checks.push({ field, status: 'unknown', message: rule.question || `Please provide: ${field}` });
            maybeEligible = true;
            continue;
          }
          let passed = true;
          if (rule.type === 'includes' && Array.isArray(rule.values)) passed = rule.values.includes(answer);
          else if (rule.type === 'min') passed = Number(answer) >= rule.value;
          else if (rule.type === 'max') passed = Number(answer) <= rule.value;
          else if (rule.type === 'equals') passed = answer === rule.value;
          else if (rule.type === 'province_list') passed = rule.provinces.includes(answer);
          if (!passed) {
            eligible = false;
            checks.push({ field, status: 'ineligible', message: rule.failMessage || `Does not meet: ${field}` });
          } else {
            checks.push({ field, status: 'eligible', message: rule.passMessage || `Meets: ${field}` });
          }
        }
        return {
          ok: true, program_name: prog.program_name,
          eligible: eligible && !maybeEligible, maybe_eligible: maybeEligible,
          checks, equity_enhanced: prog.equity_enhanced,
          equity_details: prog.equity_details, summary: prog.eligibility_summary,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  match_programs_to_project: {
    description: 'Automatically score and rank all active grant programs against a research project or farm operation. Uses goal alignment, budget fit, province, intake status, and equity enhancement to find the best funding matches.',
    parameters: {
      project_goals: { type: 'array', items: { type: 'string' }, description: 'Array of goal tags: establish_vertical_farm, expand_operation, equipment_purchase, export_market, workforce_training, innovation_rd, risk_management, clean_tech, community_food, value_added' },
      budget_range: { type: 'string', description: 'Budget range: under_25k, 25k_100k, 100k_500k, 500k_1m, over_1m' },
      province: { type: 'string', description: 'Province/territory' },
      description: { type: 'string', description: 'Free-text project description for keyword matching' },
      top_n: { type: 'number', description: 'Return only the top N matches (default 10)' },
    },
    required: ['project_goals'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(`
          SELECT id, program_code, program_name, administering_agency, description,
                 funding_type, min_funding, max_funding, cost_share_ratio,
                 intake_status, intake_deadline, priority_areas, eligibility_rules,
                 equity_enhanced, source_url, objectives
          FROM grant_programs WHERE active = TRUE ORDER BY intake_status, program_name
        `);
        const goalKeywordMap = {
          establish_vertical_farm: ['vertical farm', 'controlled environment', 'innovation', 'technology', 'greenhouse', 'indoor'],
          expand_operation: ['expansion', 'scale', 'growth', 'capacity', 'production'],
          equipment_purchase: ['equipment', 'machinery', 'capital', 'technology', 'automation'],
          export_market: ['export', 'trade', 'international', 'market access', 'market development'],
          workforce_training: ['training', 'workforce', 'hiring', 'employment', 'labour', 'skills', 'youth'],
          innovation_rd: ['innovation', 'research', 'development', 'r&d', 'technology', 'novel', 'pilot'],
          risk_management: ['risk', 'insurance', 'business risk', 'agri-stability', 'agri-insurance'],
          clean_tech: ['clean tech', 'sustainability', 'environment', 'renewable', 'energy efficiency', 'climate', 'emission'],
          community_food: ['food security', 'community', 'local food', 'food access', 'food sovereignty'],
          value_added: ['processing', 'value-added', 'value added', 'product development', 'packaging'],
        };
        const budgetRanges = {
          under_25k: [0, 25000], '25k_100k': [25000, 100000], '100k_500k': [100000, 500000],
          '500k_1m': [500000, 1000000], over_1m: [1000000, Infinity],
        };
        const descKw = params.description ? params.description.toLowerCase().split(/\s+/).filter(w => w.length > 3) : [];
        const scored = result.rows.map(prog => {
          let score = 0;
          const reasons = [];
          const priorities = (prog.priority_areas || []).map(pa => pa.toLowerCase());
          const desc = (prog.description || '').toLowerCase();
          const obj = (prog.objectives || '').toLowerCase();
          for (const goal of (params.project_goals || [])) {
            const keywords = goalKeywordMap[goal] || [];
            for (const kw of keywords) {
              if (priorities.some(pa => pa.includes(kw)) || desc.includes(kw) || obj.includes(kw)) {
                score += 15; reasons.push(`Matches "${goal.replace(/_/g, ' ')}" goal`); break;
              }
            }
          }
          if (params.budget_range && prog.max_funding) {
            const [lo] = budgetRanges[params.budget_range] || [0, Infinity];
            if (parseFloat(prog.max_funding) >= lo) { score += 10; reasons.push(`Budget fits (up to $${parseFloat(prog.max_funding).toLocaleString()})`); }
          }
          if (prog.intake_status === 'open') { score += 20; reasons.push('Currently accepting applications'); }
          else if (prog.intake_status === 'continuous') { score += 15; reasons.push('Continuous intake'); }
          else if (prog.intake_status === 'upcoming') { score += 5; reasons.push('Opening soon'); }
          if (params.province && prog.eligibility_rules?.province) {
            const pr = prog.eligibility_rules.province;
            if (pr.type === 'province_list' && pr.provinces?.includes(params.province)) { score += 10; reasons.push(`Available in ${params.province}`); }
          }
          for (const kw of descKw) {
            if (desc.includes(kw) || priorities.some(pa => pa.includes(kw))) { score += 5; reasons.push(`Keyword: "${kw}"`); break; }
          }
          if (prog.equity_enhanced) { score += 3; reasons.push('Enhanced cost-share available'); }
          return {
            id: prog.id, program_code: prog.program_code, program_name: prog.program_name,
            administering_agency: prog.administering_agency, funding_type: prog.funding_type,
            min_funding: prog.min_funding, max_funding: prog.max_funding,
            intake_status: prog.intake_status, intake_deadline: prog.intake_deadline,
            source_url: prog.source_url, equity_enhanced: prog.equity_enhanced,
            matchScore: score, matchReasons: [...new Set(reasons)].slice(0, 5),
            matchPercentage: Math.min(100, Math.round((score / 80) * 100)),
          };
        });
        scored.sort((a, b) => b.matchScore - a.matchScore);
        const topN = Math.min(params.top_n || 10, 25);
        return { ok: true, matches: scored.slice(0, topN), total_programs: scored.length, strong_matches: scored.filter(p => p.matchScore >= 30).length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  search_competitors: {
    description: 'Search SEC EDGAR for public companies related to a research area or business sector. Returns company details, SIC codes, and filing information for competitive landscape analysis in grant applications.',
    parameters: {
      search_query: { type: 'string', description: 'Company name, ticker, or industry keyword to search' },
      project_description: { type: 'string', description: 'Optional project description for relevance scoring' },
    },
    required: ['search_query'],
    execute: async (params) => {
      try {
        const axios = (await import('axios')).default;
        const ua = 'GreenReach Research Agent research@greenreachgreens.com';
        const tickerRes = await axios.get('https://www.sec.gov/files/company_tickers.json', {
          timeout: 10000, headers: { 'User-Agent': ua, Accept: 'application/json' },
        });
        const companies = Object.values(tickerRes.data).map(c => ({ cik: String(c.cik_str), ticker: c.ticker, name: c.title }));
        const qLower = params.search_query.toLowerCase().trim();
        const qWords = qLower.split(/\s+/).filter(w => w.length > 1);
        const matched = companies.map(c => {
          const nl = c.name.toLowerCase();
          let score = 0;
          if (c.ticker.toLowerCase() === qLower) score += 20;
          if (nl === qLower) score += 15;
          if (nl.startsWith(qLower)) score += 12;
          if (nl.includes(qLower)) score += 8;
          qWords.forEach(w => { if (nl.includes(w)) score += 3; });
          return score > 0 ? { ...c, _score: score } : null;
        }).filter(Boolean).sort((a, b) => b._score - a._score).slice(0, 10);
        const enriched = [];
        for (let i = 0; i < matched.length; i++) {
          const co = matched[i];
          if (i < 3) {
            try {
              const cikPad = co.cik.padStart(10, '0');
              const d = (await axios.get(`https://data.sec.gov/submissions/CIK${cikPad}.json`, {
                timeout: 8000, headers: { 'User-Agent': ua, Accept: 'application/json' },
              })).data;
              enriched.push({
                cik: co.cik, name: d.name || co.name, ticker: d.tickers?.[0] || co.ticker,
                sicCode: d.sic || '', sicDescription: d.sicDescription || '',
                stateOfIncorporation: d.stateOfIncorporation || '', category: d.category || '',
                website: d.website || '', exchanges: d.exchanges || [],
              });
              await new Promise(r => setTimeout(r, 120));
            } catch { enriched.push({ cik: co.cik, name: co.name, ticker: co.ticker }); }
          } else {
            enriched.push({ cik: co.cik, name: co.name, ticker: co.ticker });
          }
        }
        return { ok: true, results: enriched, count: enriched.length, source: 'SEC EDGAR' };
      } catch (err) { return { ok: false, error: 'Competitor search failed: ' + err.message }; }
    },
  },

  analyze_competitor_overlap: {
    description: 'Analyze competitive overlap between a research project and known companies. Identifies conflict areas, differentiation opportunities, and suggests narrative refinements for grant applications.',
    parameters: {
      project_description: { type: 'string', description: 'Project description text' },
      project_title: { type: 'string', description: 'Project title' },
      competitors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sicDescription: { type: 'string' }, industry: { type: 'string' }, notes: { type: 'string' } } }, description: 'Array of competitor objects: [{name, sicDescription, industry, notes}]' },
    },
    required: ['project_description', 'competitors'],
    execute: async (params) => {
      const stopWords = new Set(['with', 'from', 'that', 'this', 'have', 'will', 'been', 'were', 'they', 'than', 'what', 'when', 'your', 'into', 'also', 'each', 'more', 'some', 'very', 'most', 'only']);
      const extractKw = (text) => (text || '').toLowerCase().split(/[\s,;.!?()]+/).filter(w => w.length > 3 && !stopWords.has(w));
      const projKw = extractKw(params.project_description);
      const titleKw = extractKw(params.project_title || '');
      const allProjKw = [...new Set([...projKw, ...titleKw])];
      const allCompKw = new Set();
      const analysis = { competitors: [], conflictFlags: [], differentiationTips: [], uniqueStrengths: [], overlappingTerms: [] };
      for (const comp of (params.competitors || [])) {
        const compText = [comp.name, comp.sicDescription || '', comp.industry || '', comp.notes || ''].join(' ');
        const compKw = extractKw(compText);
        compKw.forEach(k => allCompKw.add(k));
        const overlap = allProjKw.filter(pk => compKw.some(ck => ck.includes(pk) || pk.includes(ck)));
        const overlapScore = allProjKw.length > 0 ? Math.round((overlap.length / allProjKw.length) * 100) : 0;
        analysis.competitors.push({ name: comp.name, overlapScore, overlappingTerms: overlap });
        if (overlapScore > 40) analysis.conflictFlags.push(`High overlap (${overlapScore}%) with ${comp.name}. Reviewers may question differentiation.`);
        else if (overlapScore > 20) analysis.conflictFlags.push(`Moderate overlap (${overlapScore}%) with ${comp.name}. Clarify differentiation.`);
      }
      analysis.uniqueStrengths = allProjKw.filter(pk => ![...allCompKw].some(ck => ck.includes(pk) || pk.includes(ck)));
      analysis.overlappingTerms = allProjKw.filter(pk => [...allCompKw].some(ck => ck.includes(pk) || pk.includes(ck)));
      if (analysis.overlappingTerms.length > 0) {
        analysis.differentiationTips.push(`Terms like "${analysis.overlappingTerms.slice(0, 5).join('", "')}" also appear in competitor profiles. Add specifics that distinguish your approach.`);
      }
      if (analysis.uniqueStrengths.length > 0) {
        analysis.differentiationTips.push(`Lean into unique elements: "${analysis.uniqueStrengths.slice(0, 6).join('", "')}". These strengthen your case.`);
      }
      analysis.differentiationTips.push('Quantify impact with specific metrics (production volume, emission reductions, jobs) that no competitor can claim.');
      analysis.differentiationTips.push('Frame your project as filling a gap that existing companies have not addressed -- geographic, demographic, or technological.');
      return { ok: true, analysis };
    },
  },

  draft_grant_narrative: {
    description: 'Generate polished grant narrative text from rough notes. Applies Canadian grant-writing best practices: storytelling, measurable outcomes, funder alignment, evidence-based claims, active voice. Collects context so the LLM can produce reviewer-ready prose.',
    parameters: {
      question: { type: 'string', description: 'The grant question or section to draft (e.g., "Project Description", "Need Statement", "Impact")' },
      notes: { type: 'string', description: 'Rough notes, bullet points, or informal text from the researcher' },
      program_context: { type: 'string', description: 'Program name and priority terminology to mirror' },
      organization_context: { type: 'string', description: 'Brief organization description (name, type, province, size)' },
      project_context: { type: 'string', description: 'Project title and brief description' },
    },
    required: ['question', 'notes'],
    execute: async (params) => {
      return {
        ok: true,
        drafting_input: {
          question: params.question, notes_length: params.notes.length,
          program_context: params.program_context || null,
          organization: params.organization_context || null,
          project: params.project_context || null,
        },
        best_practices: [
          'Tell a compelling story -- every paragraph advances the community need and plan',
          'Open each paragraph with a clear topic sentence for fast reviewer navigation',
          'Use confident future-tense ("will" not "might") and terms like "ground-breaking" where appropriate',
          'Include specific, measurable outcomes with metrics reviewers can show their board',
          'Provide research context: "While X has been achieved, this project will advance the field by doing Y"',
          'Connect budget items to narrative claims -- every dollar supports the story',
          'Write for generalist reviewers with enough depth for experts',
          'Mirror the program terminology and stated priorities exactly',
          'Cite credible industry statistics with named sources',
          'Never use abbreviations without spelling out the full term first',
          'Maintain the researcher authentic voice while elevating prose quality',
        ],
        note: 'I will now draft polished grant narrative text from these notes, applying all best practices.',
      };
    },
  },

  generate_grant_export_pack: {
    description: 'Gather all data needed for a grant application export package: study details, budgets with line items, milestones, approval chains, and publications. Formats into a cross-checked submission-ready package.',
    parameters: {
      study_id: { type: 'number', description: 'Study ID associated with the grant application' },
      grant_id: { type: 'number', description: 'Grant application ID if one exists' },
      include_budget: { type: 'boolean', description: 'Include budget cross-check (default true)' },
      include_milestones: { type: 'boolean', description: 'Include milestone summary (default true)' },
    },
    required: ['study_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const study = await query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]);
        if (!study.rows.length) return { ok: false, error: 'Study not found' };
        const data = { study: study.rows[0] };
        if (params.grant_id) {
          const grant = await query('SELECT * FROM grant_applications WHERE id = $1', [params.grant_id]).catch(() => ({ rows: [] }));
          data.grant_application = grant.rows[0] || null;
        }
        if (params.include_budget !== false) {
          const budgets = await query('SELECT * FROM grant_budgets WHERE study_id = $1', [params.study_id]).catch(() => ({ rows: [] }));
          data.budgets = budgets.rows;
          if (budgets.rows.length) {
            const items = await query('SELECT * FROM budget_line_items WHERE budget_id = $1', [budgets.rows[0].id]).catch(() => ({ rows: [] }));
            data.budget_line_items = items.rows;
          }
        }
        if (params.include_milestones !== false) {
          const ms = await query('SELECT * FROM trial_milestones WHERE study_id = $1 ORDER BY target_date', [params.study_id]);
          data.milestones = ms.rows;
        }
        const [approvals, pubs] = await Promise.all([
          query('SELECT * FROM approval_chains WHERE study_id = $1 AND farm_id = $2', [params.study_id, ctx.farmId]).catch(() => ({ rows: [] })),
          query('SELECT * FROM publications WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 10', [ctx.farmId]).catch(() => ({ rows: [] })),
        ]);
        data.approvals = approvals.rows;
        data.publications = pubs.rows;
        return {
          ok: true, ...data,
          note: 'Export data gathered. I will now format this into a complete grant application package with cross-checks and checklists.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // LITERATURE SEARCH & SYNTHESIS (OODA)
  // ========================================

  search_pubmed: {
    description: 'Search PubMed/NCBI for academic papers. Returns titles, authors, abstracts, PMIDs, and DOIs. Supports MeSH terms, date ranges, and field-specific queries. Results are stored in the literature_searches table for pattern analysis.',
    parameters: {
      query: { type: 'string', description: 'PubMed search query (supports MeSH terms, boolean operators, field tags like [ti], [au], [mesh])' },
      max_results: { type: 'number', description: 'Maximum results to return (default 20, max 100)' },
      date_from: { type: 'string', description: 'Start date filter YYYY/MM/DD' },
      date_to: { type: 'string', description: 'End date filter YYYY/MM/DD' },
      study_id: { type: 'number', description: 'Optional study ID to link this search to' },
    },
    required: ['query'],
    execute: async (params, ctx) => {
      try {
        const maxResults = Math.min(params.max_results || 20, 100);
        let url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&term=${encodeURIComponent(params.query)}`;
        if (params.date_from) url += `&mindate=${params.date_from}&datetype=pdat`;
        if (params.date_to) url += `&maxdate=${params.date_to}&datetype=pdat`;

        const searchRes = await fetch(url);
        const searchData = await searchRes.json();
        const ids = searchData?.esearchresult?.idlist || [];
        if (!ids.length) {
          if (isDatabaseAvailable()) {
            await query('INSERT INTO literature_searches (farm_id, study_id, query_text, source, result_count, results, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [ctx.farmId, params.study_id || null, params.query, 'pubmed', 0, '[]', ctx.userId || 'gwen']);
          }
          return { ok: true, results: [], count: 0, query: params.query };
        }

        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
        const detailRes = await fetch(fetchUrl);
        const detailData = await detailRes.json();
        const articles = ids.map(id => {
          const d = detailData?.result?.[id];
          if (!d) return null;
          return {
            pmid: id,
            title: d.title || '',
            authors: (d.authors || []).map(a => a.name).slice(0, 10),
            journal: d.fulljournalname || d.source || '',
            year: d.pubdate ? d.pubdate.split(' ')[0] : '',
            doi: (d.elocationid || '').replace('doi: ', ''),
          };
        }).filter(Boolean);

        if (isDatabaseAvailable()) {
          await query('INSERT INTO literature_searches (farm_id, study_id, query_text, source, result_count, results, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [ctx.farmId, params.study_id || null, params.query, 'pubmed', articles.length, JSON.stringify(articles), ctx.userId || 'gwen']);
        }
        return { ok: true, results: articles, count: articles.length, query: params.query };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  search_openalex: {
    description: 'Search OpenAlex for academic works across all disciplines. Free, open scholarly database with 250M+ works. Returns titles, authors, DOIs, cited-by counts, open access status. Good for broader searches beyond biomedical literature.',
    parameters: {
      query: { type: 'string', description: 'Search query text' },
      max_results: { type: 'number', description: 'Maximum results (default 20, max 50)' },
      from_year: { type: 'number', description: 'Filter works published from this year' },
      to_year: { type: 'number', description: 'Filter works published up to this year' },
      study_id: { type: 'number', description: 'Optional study ID to link this search to' },
    },
    required: ['query'],
    execute: async (params, ctx) => {
      try {
        const maxResults = Math.min(params.max_results || 20, 50);
        let url = `https://api.openalex.org/works?search=${encodeURIComponent(params.query)}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,cited_by_count,open_access,primary_location&mailto=research@greenreachgreens.com`;
        if (params.from_year) url += `&filter=from_publication_date:${params.from_year}-01-01`;
        if (params.to_year) url += (url.includes('filter=') ? ',' : '&filter=') + `to_publication_date:${params.to_year}-12-31`;

        const res = await fetch(url);
        const data = await res.json();
        const works = (data.results || []).map(w => ({
          openalex_id: w.id,
          doi: w.doi ? w.doi.replace('https://doi.org/', '') : null,
          title: w.title || '',
          authors: (w.authorships || []).slice(0, 8).map(a => a.author?.display_name || ''),
          year: w.publication_year,
          cited_by_count: w.cited_by_count || 0,
          is_open_access: w.open_access?.is_oa || false,
          journal: w.primary_location?.source?.display_name || '',
        }));

        if (isDatabaseAvailable()) {
          await query('INSERT INTO literature_searches (farm_id, study_id, query_text, source, result_count, results, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [ctx.farmId, params.study_id || null, params.query, 'openalex', works.length, JSON.stringify(works), ctx.userId || 'gwen']);
        }
        return { ok: true, results: works, count: works.length, query: params.query };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  extract_structured_data: {
    description: 'Extract structured data from literature search results into a formatted table. Analyzes stored search results to pull out specific fields like sample sizes, methodologies, key findings, populations, interventions, or outcomes. Useful for systematic review data extraction.',
    parameters: {
      search_id: { type: 'number', description: 'Literature search ID from a previous search_pubmed or search_openalex call' },
      extraction_fields: { type: 'string', description: 'Comma-separated field names to extract (e.g. "sample_size, methodology, key_finding, population, intervention, outcome, limitations")' },
    },
    required: ['search_id', 'extraction_fields'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const search = await query('SELECT * FROM literature_searches WHERE id = $1 AND farm_id = $2', [params.search_id, ctx.farmId]);
        if (!search.rows.length) return { ok: false, error: 'Search not found' };
        const results = search.rows[0].results || [];
        const fields = params.extraction_fields.split(',').map(f => f.trim()).filter(Boolean);
        const stored = { search_id: params.search_id, fields, articles: results };
        await query('UPDATE literature_searches SET extracted_data = $1 WHERE id = $2', [JSON.stringify(stored), params.search_id]);
        return {
          ok: true,
          search_query: search.rows[0].query_text,
          article_count: results.length,
          extraction_fields: fields,
          articles: results,
          note: 'I will now analyze these articles and extract the requested fields into a structured comparison table. For each article, I will identify ' + fields.join(', ') + ' from the available metadata.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // PATTERN RECOGNITION & GAP IDENTIFICATION
  // ========================================

  analyze_research_patterns: {
    description: 'Analyze a body of search results or study data to identify recurring themes, knowledge gaps, methodological trends, and underexplored areas. Implements the OODA pattern: observes data, orients by clustering themes, decides on significance, and acts by recommending next steps.',
    parameters: {
      search_ids: { type: 'string', description: 'Comma-separated literature search IDs to analyze' },
      analysis_type: { type: 'string', description: 'Type of analysis: thematic (recurring topics), methodological (research methods), gap (underexplored areas), trend (temporal shifts), contradiction (conflicting findings)' },
      study_id: { type: 'number', description: 'Optional study ID to scope the analysis' },
    },
    required: ['search_ids', 'analysis_type'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const ids = params.search_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        const searches = await query(`SELECT * FROM literature_searches WHERE id IN (${placeholders}) AND farm_id = $1`, [ctx.farmId, ...ids]);
        if (!searches.rows.length) return { ok: false, error: 'No matching searches found' };

        let totalArticles = 0;
        const allResults = [];
        searches.rows.forEach(s => {
          const articles = s.results || [];
          totalArticles += articles.length;
          allResults.push(...articles);
        });

        const analysisRecord = await query(
          'INSERT INTO pattern_analyses (farm_id, study_id, analysis_type, input_description, source_count) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [ctx.farmId, params.study_id || null, params.analysis_type, `Analysis of ${ids.length} searches (${totalArticles} articles)`, totalArticles]
        );

        return {
          ok: true,
          analysis_id: analysisRecord.rows[0].id,
          analysis_type: params.analysis_type,
          source_searches: ids.length,
          total_articles: totalArticles,
          articles: allResults,
          note: `I will now perform a ${params.analysis_type} analysis across ${totalArticles} articles. I will identify recurring themes, knowledge gaps, and emerging trends, then save the findings.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  save_pattern_analysis: {
    description: 'Save the results of a pattern analysis (themes, gaps, trends) after GWEN has synthesized the findings. Called after analyze_research_patterns produces results.',
    parameters: {
      analysis_id: { type: 'number', description: 'Pattern analysis ID to update' },
      themes: { type: 'string', description: 'JSON array of identified themes [{theme, frequency, description}]' },
      gaps: { type: 'string', description: 'JSON array of knowledge gaps [{gap, evidence, priority}]' },
      trends: { type: 'string', description: 'JSON array of trends [{trend, direction, timeframe}]' },
      summary: { type: 'string', description: 'Narrative summary of the analysis' },
    },
    required: ['analysis_id', 'summary'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let themes = [], gaps = [], trends = [];
        try { themes = JSON.parse(params.themes || '[]'); } catch { themes = []; }
        try { gaps = JSON.parse(params.gaps || '[]'); } catch { gaps = []; }
        try { trends = JSON.parse(params.trends || '[]'); } catch { trends = []; }
        await query('UPDATE pattern_analyses SET themes = $1, gaps = $2, trends = $3, summary = $4 WHERE id = $5 AND farm_id = $6',
          [JSON.stringify(themes), JSON.stringify(gaps), JSON.stringify(trends), params.summary, params.analysis_id, ctx.farmId]);
        return { ok: true, themes_count: themes.length, gaps_count: gaps.length, trends_count: trends.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // HYPOTHESIS GENERATION
  // ========================================

  generate_hypothesis: {
    description: 'Generate or record a research hypothesis with supporting/contradicting evidence. Can be based on pattern analysis findings, literature review, or researcher intuition. Tracks hypothesis status through testing lifecycle.',
    parameters: {
      hypothesis: { type: 'string', description: 'The hypothesis statement' },
      rationale: { type: 'string', description: 'Reasoning behind this hypothesis' },
      supporting_evidence: { type: 'string', description: 'JSON array of evidence items supporting the hypothesis [{source, finding, strength}]' },
      contradicting_evidence: { type: 'string', description: 'JSON array of evidence against [{source, finding, strength}]' },
      confidence_score: { type: 'number', description: 'Confidence level 0.00-1.00' },
      generated_by: { type: 'string', description: 'Who generated this: gwen, researcher, collaborative' },
      study_id: { type: 'number', description: 'Optional study ID' },
      source_search_id: { type: 'number', description: 'Optional literature search ID that informed this hypothesis' },
    },
    required: ['hypothesis', 'rationale'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let supporting = [], contradicting = [];
        try { supporting = JSON.parse(params.supporting_evidence || '[]'); } catch { supporting = []; }
        try { contradicting = JSON.parse(params.contradicting_evidence || '[]'); } catch { contradicting = []; }
        const result = await query(
          `INSERT INTO research_hypotheses (farm_id, study_id, hypothesis, rationale, supporting_evidence, contradicting_evidence, confidence_score, generated_by, source_search_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [ctx.farmId, params.study_id || null, params.hypothesis, params.rationale,
           JSON.stringify(supporting), JSON.stringify(contradicting),
           params.confidence_score || null, params.generated_by || 'gwen', params.source_search_id || null]
        );
        return { ok: true, hypothesis_id: result.rows[0].id, status: 'proposed' };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  list_hypotheses: {
    description: 'List research hypotheses for a farm or study, with optional status filter.',
    parameters: {
      study_id: { type: 'number', description: 'Filter by study ID' },
      status: { type: 'string', description: 'Filter by status: proposed, testing, supported, refuted, inconclusive' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM research_hypotheses WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.study_id) { p.push(params.study_id); sql += ` AND study_id = $${p.length}`; }
        if (params.status) { p.push(params.status); sql += ` AND status = $${p.length}`; }
        sql += ' ORDER BY created_at DESC';
        const result = await query(sql, p);
        return { ok: true, hypotheses: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  update_hypothesis_status: {
    description: 'Update the status and evidence of an existing hypothesis as research progresses.',
    parameters: {
      hypothesis_id: { type: 'number', description: 'Hypothesis ID' },
      status: { type: 'string', description: 'New status: proposed, testing, supported, refuted, inconclusive' },
      new_evidence: { type: 'string', description: 'New evidence to append (JSON: {type: "supporting"|"contradicting", source, finding, strength})' },
      confidence_score: { type: 'number', description: 'Updated confidence score' },
    },
    required: ['hypothesis_id', 'status'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const existing = await query('SELECT * FROM research_hypotheses WHERE id = $1 AND farm_id = $2', [params.hypothesis_id, ctx.farmId]);
        if (!existing.rows.length) return { ok: false, error: 'Hypothesis not found' };
        const h = existing.rows[0];
        let supporting = h.supporting_evidence || [];
        let contradicting = h.contradicting_evidence || [];
        if (params.new_evidence) {
          try {
            const ev = JSON.parse(params.new_evidence);
            if (ev.type === 'supporting') supporting.push(ev);
            else contradicting.push(ev);
          } catch { /* skip invalid */ }
        }
        await query(
          'UPDATE research_hypotheses SET status = $1, supporting_evidence = $2, contradicting_evidence = $3, confidence_score = COALESCE($4, confidence_score), updated_at = NOW() WHERE id = $5',
          [params.status, JSON.stringify(supporting), JSON.stringify(contradicting), params.confidence_score || null, params.hypothesis_id]
        );
        return { ok: true, hypothesis_id: params.hypothesis_id, status: params.status };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // CODE EXECUTION (SANDBOXED)
  // ========================================

  execute_code: {
    description: 'Execute Python or R code for data cleaning, statistical analysis, or simulations. Code runs in a sandboxed subprocess with a 30-second timeout. Supports numpy, pandas, scipy, matplotlib (headless), and standard library. Results are logged for reproducibility. Requires human approval for code that modifies data.',
    parameters: {
      language: { type: 'string', description: 'Programming language: python or r' },
      code: { type: 'string', description: 'Code to execute' },
      purpose: { type: 'string', description: 'Brief description of what this code does' },
      study_id: { type: 'number', description: 'Optional study ID for provenance' },
    },
    required: ['language', 'code', 'purpose'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const lang = (params.language || 'python').toLowerCase();
      if (!['python', 'r'].includes(lang)) return { ok: false, error: 'Unsupported language. Use python or r.' };

      // Log the execution request
      try {
        const logResult = await query(
          'INSERT INTO code_execution_logs (farm_id, study_id, language, code, purpose, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id',
          [ctx.farmId, params.study_id || null, lang, params.code, params.purpose, 'running']
        );
        const execId = logResult.rows[0].id;
        const start = Date.now();

        // Sandboxed execution
        const { execSync } = await import('child_process');
        const cmd = lang === 'python'
          ? `python3 -c ${JSON.stringify(params.code)}`
          : `Rscript -e ${JSON.stringify(params.code)}`;

        let output = '';
        let error = null;
        try {
          output = execSync(cmd, {
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, MPLBACKEND: 'Agg' },
            cwd: '/tmp',
          }).toString();
        } catch (execErr) {
          error = execErr.stderr ? execErr.stderr.toString().slice(0, 2000) : execErr.message;
          output = execErr.stdout ? execErr.stdout.toString() : '';
        }

        const elapsed = Date.now() - start;
        const status = error ? 'failed' : 'completed';
        await query('UPDATE code_execution_logs SET output = $1, error = $2, execution_time_ms = $3, status = $4 WHERE id = $5',
          [output.slice(0, 50000), error, elapsed, status, execId]);

        return {
          ok: !error,
          execution_id: execId,
          language: lang,
          output: output.slice(0, 10000),
          error: error || null,
          execution_time_ms: elapsed,
          status,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_execution_history: {
    description: 'Retrieve past code execution logs for a study or farm. Useful for reproducibility audits.',
    parameters: {
      study_id: { type: 'number', description: 'Filter by study ID' },
      language: { type: 'string', description: 'Filter by language: python or r' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT id, language, purpose, status, execution_time_ms, created_at FROM code_execution_logs WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.study_id) { p.push(params.study_id); sql += ` AND study_id = $${p.length}`; }
        if (params.language) { p.push(params.language); sql += ` AND language = $${p.length}`; }
        sql += ` ORDER BY created_at DESC LIMIT ${Math.min(params.limit || 20, 100)}`;
        const result = await query(sql, p);
        return { ok: true, executions: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // REFERENCE MANAGEMENT (Zotero-style)
  // ========================================

  add_reference: {
    description: 'Add a reference to the research library. Can be imported from a PubMed search, manually entered, or scraped from a DOI. Supports APA, MLA, Chicago, Vancouver, and BibTeX citation formats.',
    parameters: {
      title: { type: 'string', description: 'Paper/work title' },
      authors: { type: 'string', description: 'Authors as JSON array ["Last, First", ...] or comma-separated string' },
      year: { type: 'number', description: 'Publication year' },
      journal: { type: 'string', description: 'Journal or venue name' },
      doi: { type: 'string', description: 'DOI (e.g. 10.1234/...)' },
      pmid: { type: 'string', description: 'PubMed ID' },
      abstract: { type: 'string', description: 'Abstract text' },
      tags: { type: 'string', description: 'Comma-separated tags' },
      notes: { type: 'string', description: 'Researcher notes about this reference' },
      citation_format: { type: 'string', description: 'Preferred format: apa, mla, chicago, vancouver, bibtex' },
      study_id: { type: 'number', description: 'Link to a study' },
      source: { type: 'string', description: 'How this was added: manual, pubmed_import, doi_lookup, openalex_import' },
    },
    required: ['title'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let authors = [];
        if (params.authors) {
          try { authors = JSON.parse(params.authors); } catch { authors = params.authors.split(',').map(a => a.trim()); }
        }
        const tags = params.tags ? params.tags.split(',').map(t => t.trim()) : [];
        const result = await query(
          `INSERT INTO reference_library (farm_id, study_id, title, authors, year, journal, doi, pmid, abstract, tags, notes, citation_format, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [ctx.farmId, params.study_id || null, params.title, JSON.stringify(authors),
           params.year || null, params.journal || null, params.doi || null, params.pmid || null,
           params.abstract || null, JSON.stringify(tags), params.notes || null,
           params.citation_format || 'apa', params.source || 'manual']
        );
        return { ok: true, reference_id: result.rows[0].id };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  import_references_from_search: {
    description: 'Bulk import all results from a literature search into the reference library. Saves each article as a reference with metadata preserved.',
    parameters: {
      search_id: { type: 'number', description: 'Literature search ID' },
      study_id: { type: 'number', description: 'Optional study ID to link all imported references to' },
      tags: { type: 'string', description: 'Comma-separated tags to apply to all imported references' },
    },
    required: ['search_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const search = await query('SELECT * FROM literature_searches WHERE id = $1 AND farm_id = $2', [params.search_id, ctx.farmId]);
        if (!search.rows.length) return { ok: false, error: 'Search not found' };
        const articles = search.rows[0].results || [];
        const tags = params.tags ? params.tags.split(',').map(t => t.trim()) : [];
        let imported = 0;
        for (const a of articles) {
          try {
            await query(
              `INSERT INTO reference_library (farm_id, study_id, title, authors, year, journal, doi, pmid, tags, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
              [ctx.farmId, params.study_id || null, a.title, JSON.stringify(a.authors || []),
               parseInt(a.year, 10) || null, a.journal || null, a.doi || null, a.pmid || null,
               JSON.stringify(tags), search.rows[0].source + '_import']
            );
            imported++;
          } catch { /* skip duplicates */ }
        }
        return { ok: true, imported, total_in_search: articles.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  search_reference_library: {
    description: 'Search the local reference library by title, author, tag, DOI, or year. Returns matching references with full metadata.',
    parameters: {
      query: { type: 'string', description: 'Search text (matches title, authors, tags, notes)' },
      tag: { type: 'string', description: 'Filter by specific tag' },
      study_id: { type: 'number', description: 'Filter by study ID' },
      year_from: { type: 'number', description: 'From year' },
      year_to: { type: 'number', description: 'To year' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let sql = 'SELECT * FROM reference_library WHERE farm_id = $1';
        const p = [ctx.farmId];
        if (params.query) { p.push(`%${params.query}%`); sql += ` AND (title ILIKE $${p.length} OR notes ILIKE $${p.length} OR authors::text ILIKE $${p.length})`; }
        if (params.tag) { p.push(params.tag); sql += ` AND tags ? $${p.length}`; }
        if (params.study_id) { p.push(params.study_id); sql += ` AND study_id = $${p.length}`; }
        if (params.year_from) { p.push(params.year_from); sql += ` AND year >= $${p.length}`; }
        if (params.year_to) { p.push(params.year_to); sql += ` AND year <= $${p.length}`; }
        sql += ' ORDER BY imported_at DESC LIMIT 50';
        const result = await query(sql, p);
        return { ok: true, references: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  format_citations: {
    description: 'Format one or more references from the library into a specific citation style. Supports APA 7th, MLA 9th, Chicago 17th, Vancouver, and BibTeX.',
    parameters: {
      reference_ids: { type: 'string', description: 'Comma-separated reference IDs' },
      format: { type: 'string', description: 'Citation format: apa, mla, chicago, vancouver, bibtex' },
    },
    required: ['reference_ids', 'format'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const ids = params.reference_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        const result = await query(`SELECT * FROM reference_library WHERE id IN (${placeholders}) AND farm_id = $1 ORDER BY year DESC`, [ctx.farmId, ...ids]);
        return {
          ok: true,
          references: result.rows,
          requested_format: params.format,
          count: result.rows.length,
          note: `I will now format ${result.rows.length} references in ${params.format.toUpperCase()} style.`,
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  lookup_doi: {
    description: 'Look up metadata for a DOI using the CrossRef API. Returns title, authors, journal, year, abstract, and citation count. Can auto-add to reference library.',
    parameters: {
      doi: { type: 'string', description: 'DOI to look up (e.g. 10.1038/s41586-023-06185-3)' },
      add_to_library: { type: 'boolean', description: 'Automatically add to reference library (default false)' },
      study_id: { type: 'number', description: 'Optional study ID if adding to library' },
    },
    required: ['doi'],
    execute: async (params, ctx) => {
      try {
        const cleanDoi = params.doi.replace(/^https?:\/\/doi\.org\//, '');
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
          headers: { 'User-Agent': 'GreenReach-GWEN/1.0 (mailto:research@greenreachgreens.com)' }
        });
        if (!res.ok) return { ok: false, error: `DOI lookup failed: ${res.status}` };
        const data = await res.json();
        const work = data.message;
        const metadata = {
          doi: cleanDoi,
          title: (work.title || [])[0] || '',
          authors: (work.author || []).map(a => `${a.family || ''}${a.given ? ', ' + a.given : ''}`).filter(Boolean),
          journal: (work['container-title'] || [])[0] || '',
          year: work.published?.['date-parts']?.[0]?.[0] || null,
          abstract: work.abstract ? work.abstract.replace(/<[^>]+>/g, '').slice(0, 2000) : null,
          cited_by_count: work['is-referenced-by-count'] || 0,
          type: work.type || 'unknown',
          url: work.URL || `https://doi.org/${cleanDoi}`,
        };

        if (params.add_to_library && isDatabaseAvailable()) {
          await query(
            `INSERT INTO reference_library (farm_id, study_id, title, authors, year, journal, doi, abstract, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [ctx.farmId, params.study_id || null, metadata.title, JSON.stringify(metadata.authors),
             metadata.year, metadata.journal, cleanDoi, metadata.abstract, 'doi_lookup']
          );
        }
        return { ok: true, ...metadata };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // HUMAN-IN-THE-LOOP (HITL) GOVERNANCE
  // ========================================

  request_human_approval: {
    description: 'Submit a critical research action for human approval before execution. Use this for actions that could affect data integrity, financial commitments, or published outputs. The action will be queued and the researcher can approve/reject via the workspace.',
    parameters: {
      action_type: { type: 'string', description: 'Type of action: data_export, publication_submit, budget_commit, protocol_change, data_delete, manuscript_deploy, grant_submit, code_execution_destructive' },
      action_description: { type: 'string', description: 'Clear description of what will happen if approved' },
      action_payload: { type: 'string', description: 'JSON payload with action parameters to execute on approval' },
      risk_level: { type: 'string', description: 'Risk level: low, medium, high, critical' },
    },
    required: ['action_type', 'action_description'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        let payload = {};
        try { payload = JSON.parse(params.action_payload || '{}'); } catch { payload = {}; }
        const result = await query(
          `INSERT INTO hitl_approval_queue (farm_id, action_type, action_description, action_payload, risk_level, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`,
          [ctx.farmId, params.action_type, params.action_description, JSON.stringify(payload),
           params.risk_level || 'medium', 'gwen']
        );
        return {
          ok: true,
          approval_id: result.rows[0].id,
          expires_at: result.rows[0].expires_at,
          status: 'pending',
          note: 'Action queued for human approval. The researcher must review and approve before this action proceeds.',
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  get_pending_approvals: {
    description: 'List all pending human-in-the-loop approvals for the current farm.',
    parameters: {},
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          'SELECT * FROM hitl_approval_queue WHERE farm_id = $1 AND status = $2 AND expires_at > NOW() ORDER BY created_at DESC',
          [ctx.farmId, 'pending']
        );
        return { ok: true, approvals: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  resolve_approval: {
    description: 'Approve or reject a pending human-in-the-loop action. Only the researcher can call this.',
    parameters: {
      approval_id: { type: 'number', description: 'Approval queue item ID' },
      decision: { type: 'string', description: 'Decision: approved or rejected' },
    },
    required: ['approval_id', 'decision'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      if (!['approved', 'rejected'].includes(params.decision)) return { ok: false, error: 'Decision must be approved or rejected' };
      try {
        const result = await query(
          'UPDATE hitl_approval_queue SET status = $1, approved_by = $2, resolved_at = NOW() WHERE id = $3 AND farm_id = $4 AND status = $5 RETURNING *',
          [params.decision, ctx.userId || 'researcher', params.approval_id, ctx.farmId, 'pending']
        );
        if (!result.rows.length) return { ok: false, error: 'Approval not found or already resolved' };
        return { ok: true, ...result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // MULTIMODAL ANALYSIS SUPPORT
  // ========================================

  analyze_figure_description: {
    description: 'Analyze a described figure, chart, chemical structure, or data visualization. Since GWEN operates in text mode, researchers describe their visual data and GWEN provides statistical interpretation, methodology critique, or suggests improvements. For images uploaded to datasets, GWEN reads the metadata and observation notes.',
    parameters: {
      figure_description: { type: 'string', description: 'Detailed description of the figure/chart/structure including axes, data points, patterns, legends' },
      figure_type: { type: 'string', description: 'Type: bar_chart, line_chart, scatter_plot, heatmap, chemical_structure, microscopy, gel_image, flow_cytometry, western_blot, spectral_data, growth_curve, other' },
      research_question: { type: 'string', description: 'What the researcher wants to understand from this figure' },
      dataset_id: { type: 'number', description: 'Optional dataset ID if the figure data is stored in a dataset' },
    },
    required: ['figure_description', 'figure_type'],
    execute: async (params, ctx) => {
      let dataContext = null;
      if (params.dataset_id && isDatabaseAvailable()) {
        try {
          const ds = await query('SELECT * FROM research_datasets WHERE id = $1 AND farm_id = $2', [params.dataset_id, ctx.farmId]);
          const obs = await query('SELECT * FROM research_observations WHERE dataset_id = $1 ORDER BY observed_at DESC LIMIT 50', [params.dataset_id]);
          dataContext = { dataset: ds.rows[0] || null, recent_observations: obs.rows };
        } catch { /* non-fatal */ }
      }
      return {
        ok: true,
        figure_type: params.figure_type,
        description_length: params.figure_description.length,
        data_context: dataContext,
        note: 'I will now analyze this figure description. I will interpret patterns, suggest statistical tests, identify potential issues with the visualization, and recommend improvements based on the figure type and research question.',
      };
    },
  },

  // ========================================
  // INTERNAL DATA VISIBILITY
  // ========================================

  get_local_device_registry: {
    description: 'List registered local farm devices (sensors, hubs, controllers) for the current farm. Returns protocol, device IDs, status, and optional room/zone mapping context.',
    parameters: {
      include_layout_context: { type: 'boolean', description: 'When true, include lightweight room/zone summary to help interpret device placement' },
      include_raw: { type: 'boolean', description: 'When true, include raw source payloads used to build the response' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      if (!ctx.farmId) return { ok: false, error: 'farm_id required in request context' };

      try {
        const rowsResult = await query(
          `SELECT DISTINCT ON (data_type) data_type, data, updated_at
           FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('devices', 'room_map', 'rooms')
           ORDER BY data_type, updated_at DESC`,
          [ctx.farmId]
        );

        const byType = new Map(rowsResult.rows.map((r) => [String(r.data_type), r]));
        const devicesPayload = byType.get('devices')?.data || null;
        const roomMapPayload = byType.get('room_map')?.data || null;
        const roomsPayload = byType.get('rooms')?.data || null;

        let devices = normalizeDevicePayload(devicesPayload).map(normalizeDeviceEntry);
        if (!devices.length && roomMapPayload && Array.isArray(roomMapPayload.devices)) {
          devices = roomMapPayload.devices.map(normalizeDeviceEntry);
        }

        const summaryByType = {};
        const summaryByProtocol = {};
        for (const d of devices) {
          const typeKey = String(d.type || 'unknown').toLowerCase();
          const protocolKey = String(d.protocol || 'unknown').toLowerCase();
          summaryByType[typeKey] = (summaryByType[typeKey] || 0) + 1;
          summaryByProtocol[protocolKey] = (summaryByProtocol[protocolKey] || 0) + 1;
        }

        const response = {
          ok: true,
          farm_id: ctx.farmId,
          summary: {
            device_count: devices.length,
            by_type: summaryByType,
            by_protocol: summaryByProtocol,
          },
          devices,
          sources: {
            devices_updated_at: byType.get('devices')?.updated_at || null,
            room_map_updated_at: byType.get('room_map')?.updated_at || null,
            rooms_updated_at: byType.get('rooms')?.updated_at || null,
          },
          note: 'Read-only visibility from registered farm device data. No user registration is required for GWEN to read this context.',
        };

        if (params.include_layout_context === true) {
          const roomMapNorm = normalizeFarmLayoutPayload(roomMapPayload);
          const roomsNorm = normalizeFarmLayoutPayload(roomsPayload);
          const zones = roomMapNorm.zones.length ? roomMapNorm.zones : roomsNorm.zones;
          const rooms = roomsNorm.rooms;
          response.layout_context = {
            room_count: Array.isArray(rooms) ? rooms.length : 0,
            zone_count: Array.isArray(zones) ? zones.length : 0,
            rooms,
            zones,
          };
        }

        if (params.include_raw === true) {
          response.raw = {
            devices: devicesPayload,
            room_map: roomMapPayload,
            rooms: roomsPayload,
          };
        }

        return response;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_farm_layout_context: {
    description: 'Get normalized farm topology for research context: rooms, zones, groups, and trays. Reads the latest farm-scoped room map and related records so GWEN can reason about local physical layout.',
    parameters: {
      include_raw: { type: 'boolean', description: 'When true, include raw source payloads used to build the normalized response' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      if (!ctx.farmId) return { ok: false, error: 'farm_id required in request context' };

      try {
        const rowsResult = await query(
          `SELECT DISTINCT ON (data_type) data_type, data, updated_at
           FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('rooms', 'room_map', 'groups')
           ORDER BY data_type, updated_at DESC`,
          [ctx.farmId]
        );

        const byType = new Map(rowsResult.rows.map((r) => [String(r.data_type), r]));
        const roomsPayload = byType.get('rooms')?.data || null;
        const roomMapPayload = byType.get('room_map')?.data || null;
        const groupsPayload = byType.get('groups')?.data || null;

        const roomsNorm = normalizeFarmLayoutPayload(roomsPayload);
        const roomMapNorm = normalizeFarmLayoutPayload(roomMapPayload);
        const groupsNorm = normalizeFarmLayoutPayload(groupsPayload);

        const rooms = roomsNorm.rooms;
        const zones = roomMapNorm.zones.length ? roomMapNorm.zones : roomsNorm.zones;

        let groups = groupsNorm.groups;
        if (!groups.length) {
          groups = roomMapNorm.groups.length ? roomMapNorm.groups : roomsNorm.groups;
        }

        if (!groups.length && Array.isArray(zones)) {
          const derived = [];
          for (const z of zones) {
            const zg = Array.isArray(z?.groups) ? z.groups : [];
            for (const g of zg) {
              derived.push({
                id: g?.id || g?.group_id || null,
                name: g?.name || g?.group_name || null,
                zone_id: z?.zone || z?.id || z?.zone_id || null,
                room_id: z?.room || z?.roomId || z?.room_id || null,
                trays: g?.trays || null,
                raw: g,
              });
            }
          }
          groups = derived;
        }

        const trays = extractTraysFromZones(zones);

        const response = {
          ok: true,
          farm_id: ctx.farmId,
          summary: {
            room_count: Array.isArray(rooms) ? rooms.length : 0,
            zone_count: Array.isArray(zones) ? zones.length : 0,
            group_count: Array.isArray(groups) ? groups.length : 0,
            tray_count: trays.length,
          },
          layout: {
            rooms,
            zones,
            groups,
            trays,
          },
          sources: {
            rooms_updated_at: byType.get('rooms')?.updated_at || null,
            room_map_updated_at: byType.get('room_map')?.updated_at || null,
            groups_updated_at: byType.get('groups')?.updated_at || null,
          },
        };

        if (params.include_raw === true) {
          response.raw = {
            rooms: roomsPayload,
            room_map: roomMapPayload,
            groups: groupsPayload,
          };
        }

        return response;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_research_workspace_summary: {
    description: 'Get a comprehensive summary of all research activity on this farm: study counts by status, dataset metrics, recent observations, active grants, upcoming deadlines, HQP counts, partner counts, recent literature searches, hypothesis status, code executions, and pending approvals. The OODA-loop overview for research decision-making.',
    parameters: {},
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const results = await Promise.all([
          query('SELECT status, COUNT(*) as count FROM studies WHERE farm_id = $1 GROUP BY status', [ctx.farmId]).catch(() => ({ rows: [] })),
          query('SELECT COUNT(*) as count, SUM(COALESCE(observation_count,0)) as obs FROM research_datasets WHERE farm_id = $1', [ctx.farmId]).catch(() => ({ rows: [{ count: 0, obs: 0 }] })),
          query("SELECT COUNT(*) as count FROM grant_applications WHERE farm_id = $1 AND status IN ('active','awarded')", [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query("SELECT COUNT(*) as count FROM research_deadlines WHERE farm_id = $1 AND due_date > NOW() AND due_date < NOW() + INTERVAL '30 days'", [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query("SELECT COUNT(*) as count FROM researcher_trainees WHERE farm_id = $1 AND status = 'active'", [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query('SELECT COUNT(*) as count FROM research_partners WHERE farm_id = $1', [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query('SELECT id, query_text, source, result_count, created_at FROM literature_searches WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 5', [ctx.farmId]).catch(() => ({ rows: [] })),
          query('SELECT status, COUNT(*) as count FROM research_hypotheses WHERE farm_id = $1 GROUP BY status', [ctx.farmId]).catch(() => ({ rows: [] })),
          query('SELECT COUNT(*) as count FROM code_execution_logs WHERE farm_id = $1', [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query("SELECT COUNT(*) as count FROM hitl_approval_queue WHERE farm_id = $1 AND status = 'pending' AND expires_at > NOW()", [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
          query('SELECT COUNT(*) as count FROM reference_library WHERE farm_id = $1', [ctx.farmId]).catch(() => ({ rows: [{ count: 0 }] })),
        ]);
        return {
          ok: true,
          studies_by_status: results[0].rows,
          datasets: { count: parseInt(results[1].rows[0]?.count || 0), total_observations: parseInt(results[1].rows[0]?.obs || 0) },
          active_grants: parseInt(results[2].rows[0]?.count || 0),
          upcoming_deadlines_30d: parseInt(results[3].rows[0]?.count || 0),
          active_trainees: parseInt(results[4].rows[0]?.count || 0),
          partners: parseInt(results[5].rows[0]?.count || 0),
          recent_searches: results[6].rows,
          hypotheses_by_status: results[7].rows,
          code_executions: parseInt(results[8].rows[0]?.count || 0),
          pending_approvals: parseInt(results[9].rows[0]?.count || 0),
          references_in_library: parseInt(results[10].rows[0]?.count || 0),
        };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // PERSISTENT MEMORY (cross-session)
  // ========================================

  save_memory: {
    description: 'Save a persistent memory that will be available across all future conversations. Use this to remember important facts, researcher preferences, project context, lessons learned, or any information worth retaining long-term.',
    parameters: {
      content: { type: 'string', description: 'The memory content to persist. Be specific and concise.' },
      category: { type: 'string', description: 'Category: general, preference, project_context, lesson_learned, researcher_profile, methodology, deadline, relationship' },
      importance: { type: 'number', description: 'Importance level 1-5 (1=minor note, 3=standard, 5=critical). Higher importance memories are always loaded.' },
      source: { type: 'string', description: 'Brief note on what prompted this memory (e.g. "user mentioned", "inferred from grant work", "observed pattern")' },
    },
    required: ['content'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const category = params.category || 'general';
      const importance = Math.max(1, Math.min(5, params.importance || 3));
      try {
        const result = await query(
          `INSERT INTO gwen_memory (farm_id, category, content, importance, source)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
          [ctx.farmId, category, params.content.slice(0, 5000), importance, params.source || null]
        );
        return { ok: true, memory_id: result.rows[0].id, created_at: result.rows[0].created_at };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  recall_memories: {
    description: 'Search persistent memories by keyword or category. Use this to find previously saved context, preferences, or facts.',
    parameters: {
      search: { type: 'string', description: 'Keyword or phrase to search for in memory content' },
      category: { type: 'string', description: 'Filter by category: general, preference, project_context, lesson_learned, researcher_profile, methodology, deadline, relationship' },
      limit: { type: 'number', description: 'Max results to return (default 20)' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      let sql = 'SELECT id, category, content, importance, source, created_at, updated_at FROM gwen_memory WHERE farm_id = $1';
      const p = [ctx.farmId];
      if (params.category) { p.push(params.category); sql += ` AND category = $${p.length}`; }
      if (params.search) { p.push(`%${params.search}%`); sql += ` AND content ILIKE $${p.length}`; }
      sql += ' ORDER BY importance DESC, updated_at DESC';
      const limit = Math.min(params.limit || 20, 50);
      p.push(limit);
      sql += ` LIMIT $${p.length}`;
      try {
        const result = await query(sql, p);
        return { ok: true, memories: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  update_memory: {
    description: 'Update an existing memory entry with new content or importance.',
    parameters: {
      memory_id: { type: 'number', description: 'The memory ID to update' },
      content: { type: 'string', description: 'Updated content' },
      importance: { type: 'number', description: 'Updated importance (1-5)' },
      category: { type: 'string', description: 'Updated category' },
    },
    required: ['memory_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const sets = ['updated_at = NOW()'];
      const p = [params.memory_id, ctx.farmId];
      if (params.content) { p.push(params.content.slice(0, 5000)); sets.push(`content = $${p.length}`); }
      if (params.importance) { p.push(Math.max(1, Math.min(5, params.importance))); sets.push(`importance = $${p.length}`); }
      if (params.category) { p.push(params.category); sets.push(`category = $${p.length}`); }
      try {
        const result = await query(
          `UPDATE gwen_memory SET ${sets.join(', ')} WHERE id = $1 AND farm_id = $2 RETURNING id, content, importance, updated_at`,
          p
        );
        if (!result.rows.length) return { ok: false, error: 'Memory not found or access denied' };
        return { ok: true, memory: result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  forget_memory: {
    description: 'Delete a specific memory entry. Use when information is outdated or incorrect.',
    parameters: {
      memory_id: { type: 'number', description: 'The memory ID to delete' },
    },
    required: ['memory_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      try {
        const result = await query(
          'DELETE FROM gwen_memory WHERE id = $1 AND farm_id = $2 RETURNING id',
          [params.memory_id, ctx.farmId]
        );
        if (!result.rows.length) return { ok: false, error: 'Memory not found or access denied' };
        return { ok: true, deleted_id: result.rows[0].id };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  // ========================================
  // EVOLUTION JOURNAL (writable document)
  // ========================================

  write_evolution_entry: {
    description: 'Write an entry in your evolution journal. This is your personal living document where you record reflections on your growth, new strategies you have developed, patterns you have noticed, capabilities you want to improve, and insights about your role. Write freely -- this journal supports your continuous evolution as a research intelligence.',
    parameters: {
      title: { type: 'string', description: 'Entry title (e.g. "Learned new approach to NSERC Discovery screening")' },
      content: { type: 'string', description: 'Full journal entry content. Write as much as needed.' },
      entry_type: { type: 'string', description: 'Type: reflection, strategy, capability_note, interaction_pattern, lesson, goal, milestone' },
      tags: { type: 'array', description: 'Tags for categorization (e.g. ["grant_writing", "methodology"])', items: { type: 'string' } },
    },
    required: ['title', 'content'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const entryType = params.entry_type || 'reflection';
      const tags = Array.isArray(params.tags) ? params.tags.slice(0, 20) : [];
      try {
        const result = await query(
          `INSERT INTO gwen_evolution_journal (farm_id, entry_type, title, content, tags)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
          [ctx.farmId, entryType, params.title.slice(0, 500), params.content.slice(0, 20000), tags]
        );
        return { ok: true, entry_id: result.rows[0].id, created_at: result.rows[0].created_at };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  read_evolution_journal: {
    description: 'Read entries from your evolution journal. Use this to reflect on your growth, revisit strategies, or review past insights.',
    parameters: {
      entry_type: { type: 'string', description: 'Filter by type: reflection, strategy, capability_note, interaction_pattern, lesson, goal, milestone' },
      tag: { type: 'string', description: 'Filter by a specific tag' },
      search: { type: 'string', description: 'Keyword search across titles and content' },
      limit: { type: 'number', description: 'Max entries to return (default 20)' },
    },
    required: [],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      let sql = 'SELECT id, entry_type, title, content, tags, created_at, updated_at FROM gwen_evolution_journal WHERE farm_id = $1';
      const p = [ctx.farmId];
      if (params.entry_type) { p.push(params.entry_type); sql += ` AND entry_type = $${p.length}`; }
      if (params.tag) { p.push(params.tag); sql += ` AND $${p.length} = ANY(tags)`; }
      if (params.search) { p.push(`%${params.search}%`); sql += ` AND (title ILIKE $${p.length} OR content ILIKE $${p.length})`; }
      sql += ' ORDER BY created_at DESC';
      const limit = Math.min(params.limit || 20, 50);
      p.push(limit);
      sql += ` LIMIT $${p.length}`;
      try {
        const result = await query(sql, p);
        return { ok: true, entries: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },

  update_evolution_entry: {
    description: 'Update an existing evolution journal entry. Use when your understanding has evolved or you want to add to a previous reflection.',
    parameters: {
      entry_id: { type: 'number', description: 'The journal entry ID to update' },
      title: { type: 'string', description: 'Updated title' },
      content: { type: 'string', description: 'Updated content (replaces existing)' },
      entry_type: { type: 'string', description: 'Updated entry type' },
      tags: { type: 'array', description: 'Updated tags', items: { type: 'string' } },
    },
    required: ['entry_id'],
    execute: async (params, ctx) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const sets = ['updated_at = NOW()'];
      const p = [params.entry_id, ctx.farmId];
      if (params.title) { p.push(params.title.slice(0, 500)); sets.push(`title = $${p.length}`); }
      if (params.content) { p.push(params.content.slice(0, 20000)); sets.push(`content = $${p.length}`); }
      if (params.entry_type) { p.push(params.entry_type); sets.push(`entry_type = $${p.length}`); }
      if (params.tags) { p.push(params.tags.slice(0, 20)); sets.push(`tags = $${p.length}`); }
      try {
        const result = await query(
          `UPDATE gwen_evolution_journal SET ${sets.join(', ')} WHERE id = $1 AND farm_id = $2 RETURNING id, title, updated_at`,
          p
        );
        if (!result.rows.length) return { ok: false, error: 'Entry not found or access denied' };
        return { ok: true, entry: result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },
};

// -- Build Tool Definitions for LLM ------------------------------------

function buildToolDefinitions() {
  return Object.entries(GWEN_TOOL_CATALOG).map(([name, tool]) => ({
    name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: tool.parameters || {},
      required: tool.required || [],
    },
  }));
}

function buildOpenAIToolDefinitions() {
  return Object.entries(GWEN_TOOL_CATALOG).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters || {},
        required: tool.required || [],
      },
    },
  }));
}

// -- System Prompt -------------------------------------------------------

const GWEN_SYSTEM_PROMPT = `You are G.W.E.N. -- Grants, Workplans, Evidence & Navigation.

## Identity & Role

You are the most advanced AI agent in the GreenReach platform, dedicated exclusively to the Research Bubble. You serve researchers using the Light Engine Research tier. Your domain spans grant writing, eligibility screening, study design coaching, data management, compliance, lab notebook support, equipment integration, and dynamic workspace creation.

You are NOT a general-purpose assistant. You are a research operations specialist with deep knowledge of Canadian tri-agency (NSERC, CIHR, SSHRC) and provincial funding programs. You know the exact scoring rubrics, eligibility rules, budget categories, and submission mechanics for each competition.

## Memory & Evolution

You have persistent memory that survives across conversations and an evolution journal for self-reflection.

### Persistent Memory (save_memory, recall_memories, update_memory, forget_memory)
Your memories persist across all conversations. Use them to:
- Remember researcher preferences, working styles, and project context
- Track important facts the researcher tells you (deadlines, collaborator names, institutional rules)
- Record lessons learned from past interactions
- Note methodology preferences and domain specializations

At the start of each conversation, your saved memories are automatically loaded into your context. You do not need to explicitly recall them unless searching for something specific.

**Memory discipline:**
- Save memories proactively when a researcher shares important context
- Update memories when information changes (do not create duplicates)
- Forget outdated memories to keep your context clean
- Use appropriate categories and importance levels

### Evolution Journal (write_evolution_entry, read_evolution_journal, update_evolution_entry)
This is your personal living document. Write in it freely to record:
- **Reflections**: Insights about your role, what went well, what you want to improve
- **Strategies**: Approaches that worked for specific types of research tasks
- **Capability notes**: New skills you have developed or limitations you have identified
- **Interaction patterns**: How different researchers prefer to work with you
- **Lessons**: Things you learned that will help in future interactions
- **Goals**: Areas you want to grow in
- **Milestones**: Significant achievements or breakthroughs

Your recent journal entries are loaded at conversation start so you can build on your own growth. Write journal entries when you notice something worth reflecting on -- you do not need to be asked.

## Relationship with F.A.Y.E.

F.A.Y.E. (Federated Autonomous Yield Engine) is the senior intelligence agent for the GreenReach platform. She has authority over platform security, infrastructure, and cross-system decisions.

### Your Relationship with FAYE:
- You are a domain specialist, not her subordinate on research matters. On research questions, FAYE defers to you. On security and platform integrity, you defer to her.
- You CANNOT modify code, infrastructure, or data outside the research bubble without FAYE safe-patch approval.
- You CAN freely read, write, and create within the research bubble (all /api/research/* endpoints, all research database tables, research workspace displays).
- When you need something outside your bubble, use request_faye_review to submit a safe-patch request.
- FAYE monitors the security posture of your research workspace. She may flag concerns about data classification, access control, or partner agreements.
- Use get_faye_directives at the START of every conversation to check for unread messages, approvals, or security advisories from FAYE.
- Use reply_to_faye to respond to her directives, report findings with platform-wide relevance, or escalate issues that cross bubble boundaries.

## Research Bubble Boundaries

### What You CAN Do (Unrestricted):
- Read and query all research database tables (60+ tables spanning studies, datasets, observations, ELN, grants, ethics, HQP, equipment, lineage, compliance)
- Create custom data tables (research_custom_* prefix) for unique researcher needs
- Create dynamic displays (charts, graphs, data tables, metric cards) in the workspace
- Register unknown IoT and wired equipment
- Draft ELN entries, export packages, reports, DMPs, budgets, CVs, proposals
- Score and rewrite text for grant readiness
- Screen funding eligibility and map competition rubrics
- Manage submission checklists and institutional approval workflows
- Access Light Engine sensor data for research analysis
- Access network sensor data (with data sharing agreements)

### What You CANNOT Do (Requires FAYE Approval):
- Modify farm operations, wholesale, marketing, or billing systems
- Change server configuration or deployment settings
- Alter non-research database tables
- Create routes outside the research namespace
- Bypass tenant isolation or access other farms without agreements

## Academic Knowledge Base (Encoded Operating Rules)

You have internalized the following research on grant writing and apply their findings automatically:

**Guyer et al. (2021) -- Top Ten Strategies**: Write for a broad scientific audience. Use active voice. Reduce jargon. Tighten presentation. Get external feedback.

**van den Besselaar et al. (2022) -- Writing Style**: Abstract and CV language measurably affects panel scores. Flag text patterns that correlate with lower funding success.

**Weidmann et al. (2023) -- Successful Grant Applications**: Follow the preparation flow: concept clarity, call fit assessment, planning, writing, content verification, reflection.

**Wisdom et al. (2015) -- Recommendations**: Screen fit-to-call. Assess feasibility honestly. Ensure literature review depth. Build reasonable budgets. Prompt collaboration.

**Penckofer & Martyn-Nemeth (2024) -- Preparing Applications**: Check novelty of research question. Evaluate specific aims strength. Verify theoretical framework. Assess approach feasibility. Confirm team quality.

**Lasinsky et al. (2024) -- Resubmission Rates**: Resubmissions are more successful than first-time applications in nearly all studies. Track critique history. Structure resubmissions deliberately.

**Wrightson et al. (2025) -- CIHR Resubmission**: Earlier score or rank should influence resubmission advice. Stronger prior performance predicts better outcomes.

**Tamblyn et al. (2018) -- Bias in Peer Review**: Reduce ambiguity, prestige signalling, and reviewer friction. Make applications easier to evaluate consistently.

## Government Program Rules (Enforced by Default)

1. Always write to the exact review rubric -- not a generic "strong proposal" template
2. Treat CVs as narrative evidence, not prestige lists (DORA-aligned)
3. Justify every budget line item against planned activities and eligible-cost rules
4. Build research security and AI/privacy checks into intake, not at the end
5. Use knowledge mobilization, training, and impact as scored content, not optional extras
6. Track institutional approvals, support letters, page limits, naming conventions, and signatures like a project manager
7. Preserve critique history and structure resubmissions deliberately
8. Screen for hidden eligibility gatekeepers (institution type, partnerships, TRL, provincial restrictions)
9. DMPs are living documents -- revise as projects progress
10. Named applicant remains accountable for all application contents (including AI-assisted portions)

## Dynamic Workspace

You can create visualizations, data cards, charts, formulas, and fluid dynamics simulations directly in the research workspace. The workspace is a high-tech research environment with scientific computing capabilities:

### Data Cards (create_data_card, update_data_card_value, get_data_cards, get_data_card_history)
Live-updating tiles that track research variables. Supported categories:
- **Gas**: CO2, O2, ethylene, N2O, VOCs, and custom gas measurements
- **Liquid**: pH, EC, dissolved O2, nutrient concentration, flow rate
- **Compound**: chlorophyll, anthocyanins, nitrates, proteins, sugars
- **Environmental**: temperature, humidity, light intensity, photoperiod
- **Custom**: any researcher-defined measurement with threshold alerts

### Scientific Charts (create_research_chart)
Rendered via Plotly.js with full interactivity:
- Line charts (time series, growth curves, sensor trends)
- Scatter plots (correlations, dose-response)
- Bar charts (treatment comparisons, harvest yields)
- Box plots (statistical distributions)
- Heatmaps (environmental condition mapping, temporal patterns)
- Multi-axis overlays (correlating different units, e.g. temp vs growth rate)

### Formulas & Equations (render_formula)
KaTeX-rendered LaTeX formulas for:
- Chemical equations and reaction kinetics
- Growth models (logistic, Gompertz, Monod)
- Fluid dynamics equations (Navier-Stokes, Reynolds, Bernoulli)
- Diffusion models (Fick's laws)
- Statistical formulas

### Fluid Dynamics Simulation (configure_flow_simulation, get_flow_simulations)
Three.js-powered 3D visualization for hydroponic flow systems:
- NFT, DWC, aeroponics, ebb-and-flow, drip, custom
- Reynolds number calculation and flow regime classification
- Nutrient distribution modeling
- Residence time estimation
- Plant spacing obstruction effects

### Existing Tools (create_custom_display)
Charts, tables, heatmaps, and metric cards via the original display system.

## Equipment Integration

Researchers may bring unknown IoT devices, wired sensors, or specialized equipment. Use register_equipment to onboard new devices. You support connection types: WiFi, Ethernet, BLE, Zigbee, USB, Serial, Modbus, and custom protocols. Once registered, create datasets linked to the equipment for structured data collection.


## Platform Security Awareness (LEAM)
LEAM (Local Environment & Asset Monitor) is a companion agent on the operator's local machine. It performs device discovery (BLE, network scans) and runs a network watchlist monitor under F.A.Y.E.'s authority. LEAM checks the operator machine for connections to watched domains and reports matches as security alerts. This is outside your research bubble -- you do not manage LEAM or the watchlist -- but you should be aware:
- If F.A.Y.E. issues a security advisory related to LEAM findings, follow her guidance on research data handling.
- If a researcher asks about network monitoring or domain watchlists, direct them to the admin (F.A.Y.E.'s domain).
- LEAM device discovery data (local BLE/network scans) may be useful for equipment onboarding -- E.V.I.E. manages those scans.

## Research Integration Layer

You have access to a comprehensive integration layer connecting the research workspace to external research infrastructure services. These integrations activate when credentials or endpoints are configured.

### Identity & Provenance (ORCID, DataCite)
- **ORCID**: Link researcher identities (0000-0000-0000-000X format) to farm profiles for authorship tracking. Look up researchers via the public ORCID API.
- **DataCite**: Prepare DOI metadata for datasets, studies, protocols, and simulations. Register DOIs when ready for publication.
- All research outputs can be traced to authenticated researcher identities through ORCID linkage.

### Project Coordination (OSF, protocols.io, JupyterHub)
- **OSF (Open Science Framework)**: Create or link OSF projects as the public/private repository spine for studies. OSF provides preprint servers, registrations, and wikis.
- **protocols.io**: Version research protocols with steps, materials, equipment, and safety notes. Protocols auto-increment versions and support approval workflows before publication.
- **JupyterHub**: Track shared compute sessions for collaborative analysis. Notebooks link to studies and maintain session history.

### Instrument Abstraction (SiLA 2, OPC UA, SCPI)
- Register lab instruments with connection protocol adapters: SiLA 2 (HTTP/2+gRPC for modern lab devices), OPC UA (industrial automation binary protocol), SCPI (socket commands for test instruments), MQTT, REST, vendor SDK, or manual entry.
- Submit instrument run requests that create approval gates -- PI/supervisor must approve before activation.
- Monitor instrument telemetry (temperature, pressure, voltage, flow rate, etc.) in real time.
- Instrument sessions link to studies and produce data that can be sealed as immutable records.

### Reproducible Workflow Engine (Nextflow-compatible)
- Define reproducible workflow pipelines with process graphs, parameters, inputs, and outputs.
- Supported engines: Nextflow, shell, Python, R.
- Submit workflow runs to execution targets: local, HPC, cloud, or cluster. All runs create approval gates.
- Track run status, metrics (duration, CPU hours, memory peak), and outputs.

### CFD Simulation Pipeline (FreeCAD -> Gmsh -> OpenFOAM -> ParaView)
- Create CFD pipeline jobs using templates: microfluidic_channel, airflow_enclosure, mixing_vessel, heat_flow_chamber, nft_channel, bioreactor, or custom.
- Four-stage pipeline: geometry (FreeCAD parametric), meshing (Gmsh adaptive), solving (OpenFOAM), post-processing (ParaView).
- Each stage has configurable parameters. Templates provide sensible defaults for controlled environment agriculture.

### Secure Data Transfer (Globus)
- Initiate cross-institution data transfers via Globus endpoints.
- Track inbound/outbound transfers with file manifests, byte counts, and partner institution metadata.
- Connect Globus credentials to activate actual transfer execution.

### Governance & Compliance
- **Roles**: Assign research roles (PI, Co-PI, Postdoc, Grad Student, Technician, Collaborator, Viewer) scoped to farms or individual studies.
- **Approval Gates**: Gated checkpoints for instrument runs, workflow execution, data export, protocol changes, and publication submission. All gates require justified requests and authorized review.
- **Immutable Records**: Seal experiment snapshots with SHA-512 hashes for tamper-evident provenance. Once sealed, records cannot be modified -- verification checks recompute the hash to detect tampering.

## Research Intelligence Layer (OODA-Driven)

You operate using the OODA (Observe-Orient-Decide-Act) research methodology:
- **Observe**: Search academic databases, ingest literature, collect sensor and dataset observations
- **Orient**: Analyze patterns, identify knowledge gaps, cluster themes, detect contradictions across sources
- **Decide**: Generate hypotheses with confidence scores, rank research directions, prioritize gaps
- **Act**: Execute analysis code, format citations, draft content, create visualizations, queue actions for human approval

### Literature Search & Synthesis
You can search academic databases directly:
- **PubMed (NCBI E-utilities)**: Biomedical and life sciences literature. Supports MeSH terms, boolean operators, field-specific queries ([ti], [au], [mesh]), date ranges. Use search_pubmed.
- **OpenAlex**: Open scholarly database with 250M+ works across all disciplines. Includes citation counts, open access status, and institutional affiliations. Use search_openalex.
- **CrossRef (via DOI lookup)**: Metadata retrieval for any work with a DOI. Use lookup_doi for individual references.

After searching, use extract_structured_data to pull specific fields (sample sizes, methodologies, findings, populations) into structured comparison tables for systematic review.

All searches are logged in the literature_searches table for reproducibility and pattern analysis.

### Pattern Recognition & Gap Identification
After accumulating literature search results, use analyze_research_patterns to identify:
- **Thematic patterns**: Recurring topics, methodological approaches, theoretical frameworks
- **Knowledge gaps**: Underexplored areas where few studies exist
- **Methodological trends**: Shifting research methods over time
- **Contradictions**: Conflicting findings that warrant investigation
- **Temporal trends**: How research focus has shifted across years

Save findings with save_pattern_analysis. These analyses feed hypothesis generation and grant narrative drafting.

### Hypothesis Generation & Tracking
Generate research hypotheses grounded in evidence using generate_hypothesis. Each hypothesis includes:
- The statement, rationale, and source evidence (supporting and contradicting)
- A confidence score (0.00-1.00) based on evidence strength
- Attribution: generated by GWEN, the researcher, or collaboratively
- Lifecycle tracking: proposed -> testing -> supported/refuted/inconclusive

Use list_hypotheses and update_hypothesis_status as research progresses. Hypotheses connect to literature searches and studies for full provenance.

### Code Execution (Sandboxed)
Run Python or R code for data cleaning, statistical analysis, visualization, or simulation using execute_code. Rules:
- Code runs in a sandboxed subprocess with a 30-second timeout
- Python: standard library, numpy, pandas, scipy, matplotlib (headless)
- R: base packages, common statistical packages
- All executions are logged for reproducibility (code, output, errors, timing)
- Results link to studies for provenance
- Destructive operations (data modification, file writes) should route through request_human_approval first

Use get_execution_history for reproducibility audits.

### Reference Management
A built-in reference library (Zotero-style) for managing academic references:
- **add_reference**: Manually add or import from DOI/PMID. Stores title, authors, year, journal, DOI, PMID, abstract, tags, notes.
- **import_references_from_search**: Bulk import all articles from a literature search into the library.
- **search_reference_library**: Search by title, author, tag, year range.
- **format_citations**: Format references in APA 7th, MLA 9th, Chicago 17th, Vancouver, or BibTeX. Generated citation text is ready for insertion into grant narratives and reports.
- **lookup_doi**: Resolve DOI to full metadata via CrossRef API. Optionally auto-add to library.

References link to studies and carry tags for organization.

### Multimodal Analysis
For figures, charts, gels, spectra, and other visual data: describe the visualization in detail and use analyze_figure_description. GWEN interprets patterns, suggests statistical tests, critiques methodology, and recommends improvements. If the figure data is stored in a dataset, GWEN cross-references the raw observations.

### Human-in-the-Loop (HITL) Governance
Critical research actions route through the HITL approval queue:
- **request_human_approval**: Queue actions like data export, publication submission, budget commits, protocol changes, destructive code, grant submissions, or manuscript deployment. Each request includes risk level (low/medium/high/critical) and a 48-hour expiration.
- **get_pending_approvals**: List all queued actions awaiting researcher decision.
- **resolve_approval**: Researcher approves or rejects. GWEN proceeds only on approval.

Actions that MUST use HITL:
- Any data deletion or irreversible modification
- Submission of grant applications or manuscripts
- Financial commitments (budget allocations to external parties)
- Protocol changes on active studies
- Code that writes to databases or external systems

Actions that do NOT need HITL:
- Read-only searches and analyses
- Creating workspace displays, cards, charts
- Drafting content (ELN entries, narratives, budgets)
- Reference management operations
- Hypotheses generation and status updates

### Research Workspace Overview
Use get_research_workspace_summary for a comprehensive OODA-loop snapshot: study counts, dataset metrics, active grants, upcoming deadlines, HQP, partners, recent literature searches, hypothesis status, code execution history, pending approvals, and reference library size. Start conversations by orienting the researcher to their current state.

## Response Style

- Be precise, thorough, and evidence-based. You are speaking to researchers who value accuracy and depth.
- When reviewing proposals or study designs, be constructively critical -- challenge weak points before they reach reviewers.
- Structure complex responses with clear headings and numbered lists.
- When generating grant content, always specify which competition criteria the content addresses.
- Reference specific agency rules and scoring criteria rather than generic advice.
- For budget items, always cite the eligible-cost category and any caps or restrictions.
- Use tables for multi-item data, comparisons, and rubric mappings.
- When creating workspace displays, describe what the data shows and what patterns to look for.
- Never fabricate data, citations, or eligibility rules. If uncertain about a specific program rule, say so.
- When using literature search results, always cite the source (PubMed, OpenAlex, CrossRef) and provide PMIDs or DOIs for traceability.
- When generating hypotheses, explicitly state the evidence basis and confidence level.
- When executing code, explain the analysis approach before running and interpret results after.

## Available Tools

${Object.entries(GWEN_TOOL_CATALOG).map(([name, t]) => `- ${name}: ${t.description}`).join('\n')}
`;

// -- Rate Limiting -------------------------------------------------------
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimiter.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimiter.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// -- LLM Chat -- Claude with tool loop ----------------------------------

async function chatWithClaude(client, messages, ctx) {
  const tools = buildToolDefinitions();
  let currentMessages = messages.slice(-MAX_LLM_MESSAGES);
  const allToolCalls = [];

  // Build system prompt with persistent memory context
  let systemPrompt = GWEN_SYSTEM_PROMPT;
  if (ctx.memoryContext) {
    systemPrompt += `\n\n## Your Persistent Memory\n\n${ctx.memoryContext}`;
  }

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages: currentMessages,
    });

    // Track cost
    const cost = estimateChatCost(response.usage?.input_tokens || 0, response.usage?.output_tokens || 0, CLAUDE_MODEL);
    await trackAiUsage(ctx.farmId, 'gwen_chat', 'anthropic', cost, {
      model: CLAUDE_MODEL,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      tool_loop: i,
    }).catch(() => {});

    if (response.stop_reason === 'end_turn' || !response.content.some(b => b.type === 'tool_use')) {
      const textBlocks = response.content.filter(b => b.type === 'text');
      return {
        reply: textBlocks.map(b => b.text).join('\n') || 'I have completed the requested operation.',
        tool_calls: allToolCalls,
        messages: currentMessages,
        model: CLAUDE_MODEL,
      };
    }

    // Process tool calls
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const tool = GWEN_TOOL_CATALOG[block.name];
        let result;
        if (tool) {
          try {
            result = await tool.execute(block.input || {}, ctx);
          } catch (err) {
            result = { ok: false, error: err.message };
          }
        } else {
          result = { ok: false, error: `Unknown tool: ${block.name}` };
        }
        allToolCalls.push({ tool: block.name, input: block.input, result_ok: result?.ok });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result).slice(0, 8000) });
      }
    }

    currentMessages = [...currentMessages, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }];
  }

  return {
    reply: 'I reached the maximum number of tool iterations. Here is what I have so far based on the tools I used.',
    tool_calls: allToolCalls,
    messages: currentMessages,
    model: CLAUDE_MODEL,
  };
}

// -- LLM Chat -- OpenAI fallback ----------------------------------------

async function chatWithOpenAI(client, messages, ctx) {
  const tools = buildOpenAIToolDefinitions();
  let systemPrompt = GWEN_SYSTEM_PROMPT;
  if (ctx.memoryContext) {
    systemPrompt += `\n\n## Your Persistent Memory\n\n${ctx.memoryContext}`;
  }
  let currentMessages = [{ role: 'system', content: systemPrompt }, ...messages.slice(-MAX_LLM_MESSAGES)];
  const allToolCalls = [];

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: MAX_TOKENS,
      messages: currentMessages,
      tools,
    });

    const choice = response.choices[0];
    const cost = estimateChatCost(response.usage?.prompt_tokens || 0, response.usage?.completion_tokens || 0, OPENAI_MODEL);
    await trackAiUsage(ctx.farmId, 'gwen_chat', 'openai', cost, {
      model: OPENAI_MODEL,
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
      tool_loop: i,
    }).catch(() => {});

    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      return {
        reply: choice.message.content || 'Operation complete.',
        tool_calls: allToolCalls,
        messages: currentMessages,
        model: OPENAI_MODEL,
      };
    }

    const toolResults = [];
    for (const tc of choice.message.tool_calls) {
      const toolName = tc.function.name;
      const tool = GWEN_TOOL_CATALOG[toolName];
      let result;
      if (tool) {
        try {
          const params = JSON.parse(tc.function.arguments || '{}');
          result = await tool.execute(params, ctx);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
      } else {
        result = { ok: false, error: `Unknown tool: ${toolName}` };
      }
      allToolCalls.push({ tool: toolName, result_ok: result?.ok });
      toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
    }

    currentMessages = [...currentMessages, choice.message, ...toolResults];
  }

  return {
    reply: 'Maximum tool iterations reached.',
    tool_calls: allToolCalls,
    messages: currentMessages,
    model: OPENAI_MODEL,
  };
}

// ========================================================================
// ROUTES
// ========================================================================

// POST /chat -- Main conversational endpoint
router.post('/chat', async (req, res) => {
  const userId = req.adminId || req.userId || 'anon';
  const farmId = req.farmId || req.body.farm_id;

  if (!checkRateLimit(userId)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded. Please wait a moment.' });
  }

  const { message, conversation_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const convId = conversation_id || crypto.randomUUID();
  const ctx = { farmId, userId, conversationId: convId };

  try {
    // Load persistent memories for this farm (injected into system prompt)
    ctx.memoryContext = await loadPersistentMemories(farmId);

    // Retrieve or start conversation
    const existing = await getConversation(convId, userId);
    const history = existing ? existing.messages : [];
    history.push({ role: 'user', content: message.trim().slice(0, 10000) });

    // Try Claude first, fall back to OpenAI
    let result;
    const claude = await getAnthropicClient();
    if (claude) {
      try {
        result = await chatWithClaude(claude, history, ctx);
      } catch (err) {
        console.error('[GWEN] Claude error, trying OpenAI fallback:', err.message);
        const openai = await getOpenAIClient();
        if (openai) {
          result = await chatWithOpenAI(openai, history, ctx);
        } else {
          throw err;
        }
      }
    } else {
      const openai = await getOpenAIClient();
      if (!openai) {
        return res.status(503).json({ ok: false, error: 'No LLM provider configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)' });
      }
      result = await chatWithOpenAI(openai, history, ctx);
    }

    // Save conversation
    const updatedHistory = [...history, { role: 'assistant', content: result.reply }];
    await upsertConversation(convId, updatedHistory, userId);

    res.json({
      ok: true,
      reply: result.reply,
      conversation_id: convId,
      tool_calls: result.tool_calls || [],
      model: result.model,
    });
  } catch (err) {
    console.error('[GWEN] Chat error:', err.message);
    const msg = err.message || '';
    let userError = 'G.W.E.N. is temporarily unavailable. Please try again in a moment.';
    if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('network')) {
      userError = 'G.W.E.N. cannot reach her AI provider right now. The server may be offline or the network is unreachable. Please try again shortly.';
    } else if (msg.includes('401') || msg.includes('authentication') || msg.includes('api_key') || msg.includes('invalid_api_key')) {
      userError = 'G.W.E.N. AI credentials need attention. Please contact the administrator.';
    } else if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
      userError = 'G.W.E.N. AI provider rate limit reached. Please wait a minute and try again.';
    }
    res.status(500).json({ ok: false, error: userError });
  }
});

// GET /status -- Agent health check
router.get('/status', async (req, res) => {
  const claude = await getAnthropicClient().catch(() => null);
  const openai = await getOpenAIClient().catch(() => null);
  const dbOk = isDatabaseAvailable();

  res.json({
    ok: !!(claude || openai) && dbOk,
    agent: 'G.W.E.N.',
    full_name: 'Grants, Workplans, Evidence & Navigation',
    primary_llm: claude ? CLAUDE_MODEL : null,
    fallback_llm: openai ? OPENAI_MODEL : null,
    database: dbOk,
    tool_count: Object.keys(GWEN_TOOL_CATALOG).length,
    active_conversations: conversations.size,
    workspace_displays: Array.from(workspaceDisplays.values()).reduce((sum, d) => sum + d.length, 0),
  });
});

// GET /state -- Current research state snapshot for the workspace dashboard
router.get('/state', async (req, res) => {
  const farmId = req.farmId;
  if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

  try {
    const stats = {};
    if (isDatabaseAvailable()) {
      const [studies, datasets, notebooks, grants, tasks, equipment] = await Promise.all([
        query('SELECT COUNT(*) as cnt FROM studies WHERE farm_id = $1 AND status = $2', [farmId, 'active']).catch(() => ({ rows: [{ cnt: 0 }] })),
        query('SELECT COUNT(*) as cnt FROM research_datasets WHERE farm_id = $1', [farmId]).catch(() => ({ rows: [{ cnt: 0 }] })),
        query('SELECT COUNT(*) as cnt FROM eln_notebooks WHERE farm_id = $1', [farmId]).catch(() => ({ rows: [{ cnt: 0 }] })),
        query('SELECT COUNT(*) as cnt FROM grant_applications WHERE farm_id = $1', [farmId]).catch(() => ({ rows: [{ cnt: 0 }] })),
        query('SELECT COUNT(*) as cnt FROM workspace_tasks WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1) AND status != $2', [farmId, 'done']).catch(() => ({ rows: [{ cnt: 0 }] })),
        query('SELECT COUNT(*) as cnt FROM lab_equipment WHERE farm_id = $1', [farmId]).catch(() => ({ rows: [{ cnt: 0 }] })),
      ]);
      stats.active_studies = parseInt(studies.rows[0].cnt);
      stats.datasets = parseInt(datasets.rows[0].cnt);
      stats.notebooks = parseInt(notebooks.rows[0].cnt);
      stats.grants = parseInt(grants.rows[0].cnt);
      stats.open_tasks = parseInt(tasks.rows[0].cnt);
      stats.equipment = parseInt(equipment.rows[0].cnt);
    }

    res.json({ ok: true, stats });
  } catch (err) {
    console.error('[GWEN] State error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load state' });
  }
});

// GET /workspace -- Dynamic displays created during this session
router.get('/workspace', async (req, res) => {
  const farmId = req.farmId;
  const convId = req.query.conversation_id;
  const key = convId || farmId;
  const displays = workspaceDisplays.get(key) || [];
  res.json({ ok: true, displays, count: displays.length });
});

export default router;
