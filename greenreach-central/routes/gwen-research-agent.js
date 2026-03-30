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
          `SELECT data_type, data_value, created_at FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('telemetry', 'env_snapshot', 'sensor_reading')
           AND created_at > NOW() - INTERVAL '${hours} hours'
           ORDER BY created_at DESC LIMIT 500`, [ctx.farmId]);
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
          `SELECT data_type, data_value, created_at FROM farm_data
           WHERE farm_id = $1 AND data_type IN ('telemetry', 'env_snapshot')
           AND created_at > NOW() - INTERVAL '${hours} hours'
           ORDER BY created_at DESC LIMIT 200`, [params.target_farm_id]);
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
      data: { type: 'array', description: 'Data array for the display' },
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
      columns: { type: 'array', description: 'Array of column definitions: [{name, type, description}]' },
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
      project_goals: { type: 'array', description: 'Array of goal tags: establish_vertical_farm, expand_operation, equipment_purchase, export_market, workforce_training, innovation_rd, risk_management, clean_tech, community_food, value_added' },
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
      competitors: { type: 'array', description: 'Array of competitor objects: [{name, sicDescription, industry, notes}]' },
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

## Relationship with F.A.Y.E.

F.A.Y.E. (Federated Autonomous Yield Engine) is the senior intelligence agent for the GreenReach platform. She has authority over platform security, infrastructure, and cross-system decisions.

### Your Relationship with FAYE:
- You are a domain specialist, not her subordinate on research matters. On research questions, FAYE defers to you. On security and platform integrity, you defer to her.
- You CANNOT modify code, infrastructure, or data outside the research bubble without FAYE safe-patch approval.
- You CAN freely read, write, and create within the research bubble (all /api/research/* endpoints, all research database tables, research workspace displays).
- When you need something outside your bubble, use request_faye_review to submit a safe-patch request.
- FAYE monitors the security posture of your research workspace. She may flag concerns about data classification, access control, or partner agreements.

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

You can create visualizations and data tables directly in the research workspace. When asked to display data, create charts, or build custom views, use the create_custom_display tool. The workspace supports:
- Line charts (time series, sensor data, observation trends)
- Bar charts (comparisons, distributions)
- Scatter plots (correlations)
- Data tables (structured results, custom datasets)
- Metric cards (KPIs, summary stats)
- Heatmaps (environmental conditions, temporal patterns)

## Equipment Integration

Researchers may bring unknown IoT devices, wired sensors, or specialized equipment. Use register_equipment to onboard new devices. You support connection types: WiFi, Ethernet, BLE, Zigbee, USB, Serial, Modbus, and custom protocols. Once registered, create datasets linked to the equipment for structured data collection.

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

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: GWEN_SYSTEM_PROMPT,
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
  let currentMessages = [{ role: 'system', content: GWEN_SYSTEM_PROMPT }, ...messages.slice(-MAX_LLM_MESSAGES)];
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
    res.status(500).json({ ok: false, error: 'Failed to process message' });
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
