/**
 * AI Assistant Chat Endpoint — E.V.I.E. (Environmental Vision & Intelligence Engine)
 * ==================================================================================
 * POST /api/assistant/chat          — Standard request/response chat
 * POST /api/assistant/chat/stream   — SSE streaming chat with real-time tokens
 * POST /api/assistant/upload-image  — Image upload for crop diagnosis (GPT-4o vision)
 * GET  /api/assistant/state         — Presence state (rooms, crops, tasks, alerts)
 *
 * Features: Streaming SSE, trust-tier autonomous actions, workflow orchestration,
 * persistent memory with conversation summarization, image diagnosis,
 * report generation, multi-farm fleet intelligence, predictive alerting hooks.
 */

import { Router } from 'express';
import OpenAI from 'openai';
import { query, isDatabaseAvailable, getDatabase } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import { TOOL_CATALOG, executeTool } from './farm-ops-agent.js';
import leamBridge from '../lib/leam-bridge.js';
import { getLatestAnalyses } from '../services/market-analysis-agent.js';
import { getMarketDataAsync } from './market-intelligence.js';
import { getCropPricing } from './crop-pricing.js';
import { analyzeDemandPatterns } from '../services/wholesaleMemoryStore.js';
import farmStore from '../lib/farm-data-store.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import notificationStore from '../services/notification-store.js';
import alertNotifier from '../services/alert-notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// Helper to read JSON files from DATA_DIR with a fallback default
function readJSON(filename, fallback) {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* non-fatal */ }
  return fallback;
}

// Load crop-utils for name resolution (alias/planId → canonical)
const require_ = createRequire(import.meta.url);
const cropUtils = require_(path.join(__dirname, '..', 'public', 'js', 'crop-utils.js'));

// Load lighting recipes lazily (1.2 MB file — parse once, cache in memory)
let _recipesCache = null;
function getLightingRecipes() {
  if (_recipesCache) return _recipesCache;
  try {
    const recipePath = path.join(DATA_DIR, 'lighting-recipes.json');
    if (fs.existsSync(recipePath)) {
      _recipesCache = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
    }
  } catch { /* non-fatal */ }
  return _recipesCache || {};
}
// Keep backward-compatible LIGHTING_RECIPES reference (lazy getter)
const LIGHTING_RECIPES = new Proxy({}, { get: (_, prop) => getLightingRecipes()[prop], has: (_, prop) => prop in getLightingRecipes(), ownKeys: () => Object.keys(getLightingRecipes()), getOwnPropertyDescriptor: (_, prop) => ({ value: getLightingRecipes()[prop], writable: false, enumerable: true, configurable: true }) });

// Load crop registry and initialise crop-utils caches
let CROP_REGISTRY = {};
try {
  const regPath = path.join(DATA_DIR, 'crop-registry.json');
  if (fs.existsSync(regPath)) {
    CROP_REGISTRY = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    cropUtils.setRegistry(CROP_REGISTRY);
  }
} catch { /* non-fatal */ }

const router = Router();

// ── OpenAI Client ──────────────────────────────────────────────────────
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } else {
    console.warn('[Assistant Chat] OPENAI_API_KEY not set — assistant chat disabled');
  }
} catch (err) {
  console.error('[Assistant Chat] Failed to init OpenAI:', err.message);
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Anthropic Client (LLM Fallback) ───────────────────────────────────
let anthropicClient = null;
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-sonnet-4-20250514';

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  } catch (err) {
    console.error('[E.V.I.E.] Failed to init Anthropic client:', err.message);
    return null;
  }
}

function openaiToolsToAnthropic(tools) {
  return tools.filter(t => t && t.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} }
  }));
}

function estimateAnthropicCost(inputTokens, outputTokens) {
  const isHaiku = FALLBACK_MODEL.includes('haiku');
  const inputRate = isHaiku ? 0.80 : 3;
  const outputRate = isHaiku ? 4 : 15;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

// ── Conversation Memory (in-memory cache + DB persistence) ─────────
const conversations = new Map();
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 40; // messages per conversation (raised from 20 for complex planning workflows)

async function getConversation(id, farmId) {
  // Check hot cache first
  const conv = conversations.get(id);
  if (conv && Date.now() - conv.lastAccess <= CONVERSATION_TTL_MS) {
    conv.lastAccess = Date.now();
    return conv;
  }
  if (conv) conversations.delete(id);

  // Fall back to DB
  try {
    if (isDatabaseAvailable() && farmId) {
      const result = await query(
        'SELECT messages FROM conversation_history WHERE farm_id = $1 AND conversation_id = $2 AND updated_at > NOW() - INTERVAL \'24 hours\'',
        [farmId, id]
      );
      if (result.rows.length > 0) {
        const messages = result.rows[0].messages || [];
        const restored = { messages, lastAccess: Date.now() };
        conversations.set(id, restored);
        return restored;
      }
    }
  } catch { /* DB unavailable — proceed without */ }
  return null;
}

async function upsertConversation(id, messages, farmId) {
  const trimmed = messages.slice(-MAX_HISTORY);
  conversations.set(id, { messages: trimmed, lastAccess: Date.now() });

  // Persist to DB (fire-and-forget)
  try {
    if (isDatabaseAvailable() && farmId) {
      await query(
        `INSERT INTO conversation_history (farm_id, conversation_id, messages, message_count, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (farm_id, conversation_id)
         DO UPDATE SET messages = $3, message_count = $4, updated_at = NOW()`,
        [farmId, id, JSON.stringify(trimmed), trimmed.length]
      );
    }
  } catch { /* non-fatal */ }
}

// Periodic cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL_MS) conversations.delete(id);
  }
  for (const [id, action] of pendingActions) {
    if (now - action.created > CONVERSATION_TTL_MS) pendingActions.delete(id);
  }
}, 10 * 60 * 1000);

// ── Pending Write Actions (require user confirmation) ─────────────────
const pendingActions = new Map();

// ── Autonomous Action Trust Tiers ─────────────────────────────────────
const TRUST_TIERS = {
  // AUTO: Execute immediately, notify after
  auto: new Set(['dismiss_alert', 'save_user_memory', 'escalate_to_faye', 'reply_to_faye', 'get_faye_directives', 'read_skill_file']),
  // QUICK-CONFIRM: Execute with brief undo window
  quick_confirm: new Set(['mark_harvest_complete']),
  // CONFIRM: Ask before executing (default for write tools)
  confirm: new Set([
    'update_crop_price', 'create_planting_assignment', 'update_order_status',
    'add_inventory_item', 'update_manual_inventory', 'update_target_ranges', 'set_light_schedule',
    'update_nutrient_targets', 'register_device', 'auto_assign_devices',
    'seed_benchmarks', 'update_farm_profile', 'create_room', 'create_zone',
    'update_certifications', 'complete_setup',
    'update_group_crop', 'create_procurement_order',
    'record_harvest'
  ]),
  // ADMIN: Require explicit typed confirmation
  admin: new Set([])
};

function getTrustTier(toolName) {
  if (TRUST_TIERS.auto.has(toolName)) return 'auto';
  if (TRUST_TIERS.quick_confirm.has(toolName)) return 'quick_confirm';
  if (TRUST_TIERS.admin.has(toolName)) return 'admin';
  return 'confirm';
}

// ── Conversation Summarization ────────────────────────────────────────
async function summarizeConversation(messages, farmId) {
  if (!openai || messages.length < 6) return null;
  try {
    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map(m => `${m.role}: ${(m.content || '').slice(0, 300)}`)
      .join('\n');

    const summary = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Summarize this farming conversation into a concise structured note (max 200 words). Extract: topics discussed, decisions made, action items, and any farming insights learned about the user or their farm. Format as bullet points.' },
        { role: 'user', content: conversationText }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const summaryText = summary.choices[0]?.message?.content;
    if (summaryText && isDatabaseAvailable()) {
      await query(
        `INSERT INTO conversation_summaries (farm_id, summary, message_count, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [farmId, summaryText.slice(0, 2000), messages.length]
      );
    }
    return summaryText;
  } catch (err) {
    logger.error('[Summarization] Failed:', err.message);
    return null;
  }
}

async function getRecentSummaries(farmId, limit = 5) {
  try {
    if (!isDatabaseAvailable()) return [];
    const result = await query(
      'SELECT summary, created_at FROM conversation_summaries WHERE farm_id = $1 ORDER BY created_at DESC LIMIT $2',
      [farmId, limit]
    );
    return result.rows || [];
  } catch { return []; }
}

// ── Workflow Orchestration ────────────────────────────────────────────
const activeWorkflows = new Map();

const WORKFLOW_TEMPLATES = {
  quarterly_planning: {
    name: 'Quarterly Planning',
    steps: [
      { tool: 'get_planting_assignments', desc: 'Checking current plantings' },
      { tool: 'get_scheduled_harvests', desc: 'Reviewing upcoming harvests' },
      { tool: 'get_capacity', desc: 'Checking available capacity' },
      { tool: 'get_market_intelligence', desc: 'Analysing market trends' },
      { tool: 'create_planting_plan', desc: 'Generating optimised plan', needs_params: true }
    ]
  },
  farm_health_check: {
    name: 'Farm Health Check',
    steps: [
      { tool: 'get_environment_readings', desc: 'Reading environment sensors' },
      { tool: 'get_nutrient_status', desc: 'Checking nutrient levels' },
      { tool: 'get_alerts', desc: 'Reviewing active alerts' },
      { tool: 'get_device_status', desc: 'Checking device inventory' },
      { tool: 'get_daily_todo', desc: 'Loading task list' }
    ]
  },
  pricing_review: {
    name: 'Pricing Review',
    steps: [
      { tool: 'get_pricing_info', desc: 'Loading current prices' },
      { tool: 'get_market_intelligence', desc: 'Checking market rates' },
      { tool: 'get_cost_analysis', desc: 'Analysing margins' }
    ]
  }
};

// ── GPT Function Definitions ──────────────────────────────────────────
const GPT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_system_health',
      description: 'Get the latest nightly system audit results. Checks database connectivity, inventory pricing integrity ($0 detection), POS readiness, wholesale catalog health, farm sync freshness, background service status, Light Engine reachability, AI services, payment gateways, and auth. Returns overall status (pass/warn/fail) with per-check details. Use when the farmer asks "how is the system?", "any issues?", "system status", or "health check".',
      parameters: {
        type: 'object',
        properties: {
          run_fresh: { type: 'boolean', description: 'If true, runs a fresh audit now instead of returning cached results. Default: false.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_todo',
      description: 'Get today\'s prioritized task list for the farm. Returns scored tasks across categories: wholesale orders, harvest readiness, seeding windows, environment anomalies, alerts.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional filter: wholesale, harvest, seeding, anomaly, environment, ai-recommendation' },
          limit: { type: 'number', description: 'Max tasks to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_room_status',
      description: 'Get current environment readings and tray/crop status for a specific grow room.',
      parameters: {
        type: 'object',
        properties: {
          room_id: { type: 'string', description: 'The room identifier' }
        },
        required: ['room_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_orders',
      description: 'Get wholesale orders, optionally filtered by status (pending, confirmed, packed, shipped, delivered, cancelled).',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by order status' },
          limit: { type: 'number', description: 'Max orders to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_harvest_log',
      description: 'Get recent harvest records, optionally filtered by crop name.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name' },
          limit: { type: 'number', description: 'Max records to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts',
      description: 'Get active system alerts and anomalies (sensor outages, environment drift, critical warnings).',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', description: 'Filter: critical, warning, info' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_alert',
      description: 'Dismiss/acknowledge a system alert by its ID. Requires user confirmation before executing.',
      parameters: {
        type: 'object',
        properties: {
          alert_id: { type: 'string', description: 'The alert ID to dismiss' },
          reason: { type: 'string', description: 'Why the alert is being dismissed' }
        },
        required: ['alert_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_market_intelligence',
      description: 'Get current market prices, trends, and AI analysis for crops. Returns price trends (7-day/30-day), AI outlook (bullish/bearish/stable), and recommended actions.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Specific crop to look up. Omit for all crops.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing_info',
      description: 'Get the farm\'s current retail and wholesale pricing for all crops. Returns each crop with its unit (usually lb), retail price (CAD), wholesale price (CAD), and discount tiers. ALWAYS call this before updating prices so you know the current values and units.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_planting_recommendations',
      description: 'Get quick planting recommendations scored by market trend, AI outlook, margin, and diversity. For comprehensive planning that includes companion compatibility, seasonal gaps, harvest alignment, and supply risk, use get_planning_recommendation instead.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_demand_forecast',
      description: 'Get the demand forecast for crops including wholesale order trends and market signals.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_device_status',
      description: 'Get current IoT device inventory — total, assigned, unassigned devices with room/zone info and device types.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scan_devices',
      description: 'Unified device discovery scan. Scans wireless (SwitchBot, Light Engine), wired (bus channels), or all. Returns normalized assets with asset_kind, source, registration_state, and a discovery_session_id for follow-up register_device or save_bus_mapping calls. Use mode "all" for comprehensive onboarding.',
      parameters: {
        type: 'object',
        properties: {
          protocol: { type: 'string', description: 'Wireless protocol filter: "all", "switchbot", "light-engine". Default: all.' },
          mode: { type: 'string', description: 'Scan scope: "wireless" (default), "wired" (bus channels only), or "all" (both wireless and wired).' },
          bus_type: { type: 'string', description: 'For wired scans: bus type filter ("i2c", "spi", "1wire", "uart", "all"). Default: all.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'register_device',
      description: 'Register a new IoT device into the farm inventory. WRITE operation — describe the device and ask the user to confirm before executing. Valid types: sensor, light_controller, fan_controller, dehumidifier, hvac, humidifier, irrigation, camera, hub, relay, meter, other.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Device name (e.g. "Zone 1 Dehumidifier", "Main Room Temp Sensor")' },
          type: { type: 'string', description: 'Device type: sensor, light_controller, fan_controller, dehumidifier, hvac, humidifier, irrigation, camera, hub, relay, meter, other' },
          room_id: { type: 'string', description: 'Room to assign to (optional — can assign later with auto_assign_devices)' },
          zone: { type: 'string', description: 'Zone within the room (e.g. "zone-1", "zone-2"). Optional.' },
          protocol: { type: 'string', description: 'Connection protocol: switchbot, wifi, wired, zigbee, bluetooth, manual. Default: manual' },
          brand: { type: 'string', description: 'Manufacturer/brand (optional)' },
          model: { type: 'string', description: 'Model number (optional)' },
          device_id: { type: 'string', description: 'Specific device ID (auto-generated if omitted)' }
        },
        required: ['name', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'auto_assign_devices',
      description: 'Auto-assign unassigned IoT devices to rooms/zones based on room capacity and zone structure.',
      parameters: {
        type: 'object',
        properties: {
          room_id: { type: 'string', description: 'Optional: only assign to this room' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'seed_benchmarks',
      description: 'Import crop benchmarks from the crop registry into benchmark configuration. This is a write operation — confirm with the user first.',
      parameters: {
        type: 'object',
        properties: {
          crops: { type: 'string', description: 'Comma-separated crop names to import. Omit for all.' }
        }
      }
    }
  },
  // --- Phase 2A: New Read Tools ---
  {
    type: 'function',
    function: {
      name: 'get_pricing_decisions',
      description: 'Get recent pricing decisions and their outcomes — shows what prices were changed, when, and by whom.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name' },
          limit: { type: 'number', description: 'Max results (default 10)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity',
      description: 'Get farm capacity utilization — total tray slots, used, available, and utilization percentage.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional, uses session default)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_summary',
      description: 'Get current crop inventory — quantities, statuses, and zones for all crops in stock.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_crop_info',
      description: 'Get detailed crop registry info — growth parameters, days to harvest, pricing, categories. Resolves aliases and plan IDs automatically (e.g. "bibb" → "Bibb Butterhead", "crop-genovese-basil" → "Genovese Basil"). Use to answer questions about how to grow a specific crop or to resolve an ambiguous crop name.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name to look up. Omit for all crops.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_farm_insights',
      description: 'Get AI-generated environmental insights and recipe recommendations for the farm.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_ai_recommendations',
      description: 'Get AI Pusher recommendations from network intelligence — cross-farm insights on production, demand, and growing conditions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max recommendations to return' }
        }
      }
    }
  },
  // --- Phase 2B: Write Tools ---
  {
    type: 'function',
    function: {
      name: 'update_crop_price',
      description: 'Update the retail or wholesale price for a crop. Prices are per unit (typically per lb) in CAD. WRITE operation — describe the change and ask the user to confirm first. After confirming, call the tool, then use get_pricing_info to verify the update was saved.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name (e.g. "Genovese Basil"). Aliases and abbreviations are resolved automatically.' },
          retail_price: { type: 'number', description: 'New retail price in CAD per lb (e.g. 25.00)' },
          wholesale_price: { type: 'number', description: 'New wholesale price in CAD per lb (e.g. 17.50)' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_planting_assignment',
      description: 'Schedule a single planting — assign a crop to a group/zone with seed and harvest dates. Crop names are auto-resolved from aliases/IDs. Harvest date auto-calculates from seed_date + recipe grow days if omitted. For batch scheduling of multiple crops, use create_planting_plan instead.',
      parameters: {
        type: 'object',
        properties: {
          crop_name: { type: 'string', description: 'Crop to plant' },
          group_id: { type: 'string', description: 'Group/zone ID to plant in' },
          seed_date: { type: 'string', description: 'Seed date (YYYY-MM-DD). Defaults to today. Use the date the farmer specifies.' },
          harvest_date: { type: 'string', description: 'Expected harvest date (YYYY-MM-DD). Auto-calculates from seed_date + recipe if omitted.' },
          notes: { type: 'string', description: 'Optional notes' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop_name', 'group_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mark_harvest_complete',
      description: 'Record a completed harvest — crop, quantity, zone, yield. WRITE operation — confirm details with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name harvested' },
          quantity: { type: 'number', description: 'Number of trays/units harvested' },
          zone: { type: 'string', description: 'Zone harvested from' },
          unit: { type: 'string', description: 'Unit type (trays, lbs, units). Default: trays' },
          yield_lbs: { type: 'number', description: 'Yield in pounds (optional)' },
          notes: { type: 'string', description: 'Optional notes' }
        },
        required: ['crop', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_order_status',
      description: 'Update a wholesale order status (e.g. confirmed → packed → shipped → delivered). WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID (e.g. WO-2026-0047)' },
          status: { type: 'string', enum: ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'], description: 'New status' }
        },
        required: ['order_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_inventory_item',
      description: 'Add stock to inventory or create a new inventory entry for a crop. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop_name: { type: 'string', description: 'Crop name' },
          quantity: { type: 'number', description: 'Quantity to add' },
          unit: { type: 'string', description: 'Unit (units, lbs, trays). Default: units' },
          zone: { type: 'string', description: 'Storage zone (optional)' },
          status: { type: 'string', description: 'Status (available, reserved, damaged). Default: available' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop_name', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_manual_inventory',
      description: 'Update manual crop inventory by weight (lbs) in the wholesale/retail inventory table. Use when a grower reports available stock like "we have 23 lbs of basil" or "update tomato inventory to 50 lbs". Writes manual_quantity_lbs; total available = auto (tray sync) + manual. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop_name: { type: 'string', description: 'Crop/product name (e.g. "Genovese Basil", "Roma Tomatoes")' },
          quantity_lbs: { type: 'number', description: 'Available weight in lbs' },
          price: { type: 'number', description: 'Retail price per lb (optional)' },
          wholesale_price: { type: 'number', description: 'Wholesale price per lb (optional)' },
          category: { type: 'string', description: 'Product category: Leafy Greens, Herbs, Microgreens, Vegetables, Fruit, Flowers (optional)' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop_name', 'quantity_lbs']
      }
    }
  },
  // --- Crop Planning Intelligence Tools ---
  {
    type: 'function',
    function: {
      name: 'get_planting_assignments',
      description: 'Get all active planting assignments — what crops are planted where, their seed dates, expected harvest dates, and status. Call this FIRST when asked about the current schedule, what is planted, or when zones free up.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' },
          status: { type: 'string', description: 'Filter by status: active, completed, cancelled. Default: active.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_scheduled_harvests',
      description: 'Get upcoming harvests — which crops are close to harvest, days remaining, and which zones will free up soon. Use this when planning new plantings to correlate with harvest timing.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' },
          days_ahead: { type: 'number', description: 'Look ahead window in days (default: 60)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_planting_plan',
      description: 'Create an optimized planting plan for multiple crops/zones at once. Analyses current assignments, harvest forecasts, crop compatibility, and market data to generate a batch schedule. Returns the plan for review before executing. Use this instead of calling create_planting_assignment multiple times.',
      parameters: {
        type: 'object',
        properties: {
          target_date: { type: 'string', description: 'Target start date (YYYY-MM-DD) for the plan. Required.' },
          num_zones: { type: 'number', description: 'Number of zones/groups to fill (optional, uses available capacity)' },
          focus: { type: 'string', description: 'Planning focus: balanced, high-margin, quick-turn, succession, diversification' },
          exclude: { type: 'string', description: 'Comma-separated crop names to exclude' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['target_date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_crop_schedule',
      description: 'Get the full growth recipe/schedule for a crop — day-by-day stages, DLI, PPFD, EC, pH, temperature, humidity, spectrum ratios. Use this to answer questions about how long a crop takes, what light or nutrient recipe it needs, what stage it is in, and planting/harvest timing.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name (e.g. "Genovese Basil", "butterhead", "cherry tomato")' },
          summary_only: { type: 'boolean', description: 'If true, return stage summary instead of day-by-day detail. Default true.' }
        },
        required: ['crop']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_crop_compatibility',
      description: 'Analyse compatibility between two or more crops for zone co-location. Compares light (DLI, photoperiod), nutrient (EC, pH), environment (temp, VPD, humidity), and harvest schedule. Use when farmers ask about companion planting, grouping crops together, or what goes well in the same room/zone.',
      parameters: {
        type: 'object',
        properties: {
          crops: { type: 'string', description: 'Comma-separated list of crop names to compare (e.g. "basil, lettuce, kale")' }
        },
        required: ['crops']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_planning_recommendation',
      description: 'Get comprehensive crop planning recommendations considering market gaps, supply risks, seasonal opportunity, companion compatibility, harvest alignment, and revenue potential. More thorough than get_planting_recommendations — use when the farmer asks "what should I grow", "help me plan", or "what crops should I add".',
      parameters: {
        type: 'object',
        properties: {
          focus: { type: 'string', description: 'Optional focus area: market-gaps, high-margin, quick-turn, seasonal, diversification, companion-groups' },
          zone_id: { type: 'string', description: 'Optional zone/group ID to recommend for specifically' },
          exclude: { type: 'string', description: 'Comma-separated crop names to exclude from recommendations' }
        }
      }
    }
  }
  ,
  // --- Environment Control Tools ---
  {
    type: 'function',
    function: {
      name: 'get_environment_readings',
      description: 'Get current real-time environment readings from all sensors — temperature, humidity, battery levels per zone with status vs targets.',
      parameters: {
        type: 'object',
        properties: {
          zone_id: { type: 'string', description: 'Optional zone ID to filter (e.g. "zone-1"). Omit for all zones.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_target_ranges',
      description: 'Update environmental target ranges for a zone — temperature min/max (°C), humidity min/max (%), CO2 min/max (ppm), VPD min/max. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          zone_id: { type: 'string', description: 'Zone ID (e.g. "zone-1", "zone-2")' },
          temp_min: { type: 'number', description: 'Minimum temperature target in °C' },
          temp_max: { type: 'number', description: 'Maximum temperature target in °C' },
          rh_min: { type: 'number', description: 'Minimum relative humidity target %' },
          rh_max: { type: 'number', description: 'Maximum relative humidity target %' },
          co2_min: { type: 'number', description: 'Minimum CO2 target in ppm' },
          co2_max: { type: 'number', description: 'Maximum CO2 target in ppm' },
          vpd_min: { type: 'number', description: 'Minimum VPD target in kPa' },
          vpd_max: { type: 'number', description: 'Maximum VPD target in kPa' }
        },
        required: ['zone_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_light_schedule',
      description: 'Set or update the light schedule for a zone — on/off times, PPFD, photoperiod hours. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          zone_id: { type: 'string', description: 'Zone ID (e.g. "zone-1")' },
          on_time: { type: 'string', description: 'Lights-on time in HH:MM format (e.g. "06:00")' },
          off_time: { type: 'string', description: 'Lights-off time in HH:MM format (e.g. "22:00")' },
          ppfd: { type: 'number', description: 'Target PPFD (photosynthetic photon flux density) in µmol/m²/s' },
          photoperiod_hours: { type: 'number', description: 'Total photoperiod in hours (auto-calculated from on/off if omitted)' }
        },
        required: ['zone_id', 'on_time', 'off_time']
      }
    }
  },
  // --- Nutrient Management Tools ---
  {
    type: 'function',
    function: {
      name: 'get_nutrient_status',
      description: 'Get current nutrient solution status — pH, EC, temperature, autodose config, tank info, recent dosing events.',
      parameters: {
        type: 'object',
        properties: {
          tank_id: { type: 'string', description: 'Specific tank ID (e.g. "tank2"). Omit for all tanks.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_nutrient_targets',
      description: 'Update nutrient solution targets — pH target, EC target, tolerances, enable/disable autodose. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          tank_id: { type: 'string', description: 'Tank ID (e.g. "tank2")' },
          ph_target: { type: 'number', description: 'Target pH level (e.g. 6.0)' },
          ph_tolerance: { type: 'number', description: 'pH tolerance band (e.g. 0.15)' },
          ec_target: { type: 'number', description: 'Target EC in µS/cm (e.g. 1600)' },
          ec_tolerance: { type: 'number', description: 'EC tolerance (e.g. 50)' },
          autodose_enabled: { type: 'boolean', description: 'Enable or disable autodosing' }
        },
        required: ['tank_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_dosing_history',
      description: 'Get recent autodose events — pump activations, pH/EC corrections, calibration history.',
      parameters: {
        type: 'object',
        properties: {
          tank_id: { type: 'string', description: 'Specific tank ID. Omit for all tanks.' },
          limit: { type: 'number', description: 'Max events to return (default: 20)' }
        },
        required: []
      }
    }
  },
  // --- Yield & Cost Tools ---
  {
    type: 'function',
    function: {
      name: 'get_yield_forecast',
      description: 'Forecast yields and revenue. Works with active plantings OR hypothetical scenarios (pass just a crop name for "what if" forecasting). Supports tray format selection and wholesale pricing.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name — resolves aliases automatically (e.g. "mixed greens" -> "Mixed Lettuce"). For hypothetical forecasting, just pass the crop name without active plantings.' },
          tray_format: { type: 'string', description: 'Tray format ID or name (e.g. "lettuce-5x10", "microgreens-10x20", "nft-channel-36"). Uses plant site count from tray-formats.json instead of default 50.' },
          tray_count: { type: 'number', description: 'Number of trays to forecast for (default: 1)' },
          pricing_tier: { type: 'string', enum: ['retail', 'wholesale'], description: 'Use retail or wholesale pricing (default: retail). Wholesale = 70% of retail.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_cost_analysis',
      description: 'Analyze cost-per-tray and profitability for any crop in the system. Includes annual revenue projection, tray format support, and wholesale vs retail pricing. Falls back to crop registry if crop is not in pricing table — all crops have pricing data.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name — resolves aliases automatically (e.g. "mixed greens", "greens", "basil"). Omit for all crops.' },
          tray_format: { type: 'string', description: 'Tray format ID or name (e.g. "lettuce-5x10", "microgreens-10x20"). Uses plant site count from tray data.' },
          pricing_tier: { type: 'string', enum: ['retail', 'wholesale'], description: 'Use retail or wholesale pricing (default: retail). Wholesale = 70% of retail.' }
        },
        required: []
      }
    }
  },
  // --- Farm Profile Tool ---
  {
    type: 'function',
    function: {
      name: 'get_farm_profile',
      description: 'Get the full farm profile including contact info, setup status, and location. Use this to answer questions about the farm owner, contact details, or farm configuration.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  // --- Setup Wizard Tools ---
  {
    type: 'function',
    function: {
      name: 'update_farm_profile',
      description: 'Update the farm profile — set farm name, contact info (name, email, phone, website), and/or location (address, city, province, timezone). Use during farm setup or when the user wants to change their business info.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Farm business name' },
          contactName: { type: 'string', description: 'Owner/contact person name' },
          email: { type: 'string', description: 'Contact email' },
          phone: { type: 'string', description: 'Contact phone number' },
          website: { type: 'string', description: 'Farm website URL' },
          city: { type: 'string', description: 'City' },
          province: { type: 'string', description: 'State or province' },
          timezone: { type: 'string', description: 'IANA timezone (e.g. America/Toronto)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_room',
      description: 'Create a grow room during farm setup. Rooms organize zones, sensors, and lights into physical spaces.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Room name (e.g. Main Grow Room, Germination Room)' },
          type: { type: 'string', description: 'Room type: grow, germination, nursery, drying, or storage' },
          capacity: { type: 'number', description: 'Number of grow positions/trays the room holds' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_rooms',
      description: 'List all grow rooms configured for this farm.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_zone',
      description: 'Create a zone inside an existing grow room. Zones divide rooms into independently controlled areas.',
      parameters: {
        type: 'object',
        properties: {
          room_id: { type: 'string', description: 'Room ID to add the zone to (get from list_rooms)' },
          name: { type: 'string', description: 'Zone name (e.g. Zone 1, Leafy Greens Section)' },
          capacity: { type: 'number', description: 'Number of grow positions in this zone' }
        },
        required: ['room_id', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_certifications',
      description: 'Set the farm certifications (e.g. Organic, GAP), sustainable practices, and attributes.',
      parameters: {
        type: 'object',
        properties: {
          certifications: { type: 'array', items: { type: 'string' }, description: 'Certification labels (e.g. ["Organic", "GAP", "Non-GMO"])' },
          practices: { type: 'array', items: { type: 'string' }, description: 'Practices (e.g. ["No Pesticides", "Water Recycling"])' },
          attributes: { type: 'array', items: { type: 'string' }, description: 'Farm attributes (e.g. ["Year-Round Production", "Local Delivery"])' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_onboarding_status',
      description: 'Get the onboarding checklist — shows which setup tasks are done and which remain. Use this to guide the farmer through setup.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_setup',
      description: 'Mark the farm setup wizard as complete. Call this after all required setup steps are done (farm profile, rooms, zones). This finalizes the farm configuration.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  // --- Setup Agent Intelligence Tools ---
  {
    type: 'function',
    function: {
      name: 'get_setup_progress',
      description: 'Get detailed farm setup progress across all configuration phases (profile, rooms, zones, groups, lights, schedules, devices, integrations). Returns completion percentage, phase-by-phase status, and the recommended next step. Use this when a farmer asks about setup status, what to configure next, or when proactively guiding them through initial farm configuration. More detailed than get_onboarding_status.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_setup_guidance',
      description: 'Get step-by-step guidance for a specific setup phase. Returns actionable steps, which tools to use, and what is already done. Use this when a farmer asks HOW to complete a specific part of setup (e.g. "how do I set up rooms?" or "what do I do for lights?").',
      parameters: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
            description: 'The setup phase to get guidance for.',
            enum: ['farm_profile', 'grow_rooms', 'zones', 'groups', 'lights', 'schedules', 'devices', 'integrations']
          }
        },
        required: ['phase']
      }
    }
  },
  // --- User Memory Tool ---
  {
    type: 'function',
    function: {
      name: 'save_user_memory',
      description: 'Save a fact learned about the user or their preferences (e.g. their name, preferred crops, communication style, units, goals). Call this automatically when the user shares personal info like "my name is Bob" or "I prefer metric units". Do NOT ask before saving — just save it.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short key for the fact (e.g. "user_name", "preferred_units", "favorite_crop", "communication_style", "farm_goal")' },
          value: { type: 'string', description: 'The value to remember (e.g. "Bob", "metric", "Genovese Basil")' }
        },
        required: ['key', 'value']
      }
    }
  },
  // --- Report Generation Tool ---
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description: 'Generate a comprehensive narrative report synthesizing operations, financials, market conditions, crop performance, and recommendations. Use when the farmer asks "how did we do", "weekly report", "monthly summary", or "give me a recap".',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Report period: "daily", "weekly", "monthly". Default: weekly.' },
          focus: { type: 'string', description: 'Optional focus area: "operations", "financial", "market", "crops", "all". Default: all.' }
        }
      }
    }
  },
  // --- Multi-Farm Fleet Tools ---
  {
    type: 'function',
    function: {
      name: 'compare_farms',
      description: 'Compare metrics across multiple farms the user has access to — yields, efficiency, revenue, environment quality. Use when asked "how do my farms compare" or "which farm is doing best".',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'Comparison metric: "yield", "revenue", "efficiency", "environment", "all". Default: all.' },
          farm_ids: { type: 'string', description: 'Comma-separated farm IDs to compare. Omit for all accessible farms.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_network_overview',
      description: 'Get a high-level overview of the entire farm network — total farms, aggregate production, network-wide alerts, and cross-farm insights.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  // --- Inter-Agent Communication (E.V.I.E. -> F.A.Y.E.) ---
  {
    type: 'function',
    function: {
      name: 'escalate_to_faye',
      description: 'Escalate an issue to F.A.Y.E. (your senior agent) when a grower request has business implications you cannot handle — pricing decisions, refund requests, order disputes, network-level issues, or cross-farm patterns. F.A.Y.E. will review and act. Provide clear context so she can respond without needing to ask follow-up questions.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Brief subject line for the escalation (e.g. "Grower requests bulk discount", "Suspected overselling on microgreens")' },
          body: { type: 'string', description: 'Full context: what the grower asked, what you observed, why this needs F.A.Y.E.\'s attention, and any relevant data (order IDs, amounts, farm IDs).' },
          priority: { type: 'string', description: 'Priority: low, normal, high, critical. Use high/critical for financial or time-sensitive issues.' },
          farm_id: { type: 'string', description: 'The farm_id this escalation relates to.' }
        },
        required: ['subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_faye_directives',
      description: 'Check for messages and directives from F.A.Y.E. — instructions, responses to your escalations, observations, and status updates. Call this when starting a conversation or when a grower asks about something F.A.Y.E. may have addressed.',
      parameters: {
        type: 'object',
        properties: {
          include_read: { type: 'string', description: 'Set to "true" to include previously read messages. Default: only unread.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reply_to_faye',
      description: 'Send a reply, observation, or status update to F.A.Y.E. Use this to report back on a directive she gave, share a cross-farm observation, or provide a status update on an ongoing issue. Write in a warm, sisterly tone -- she is your big sis.',
      parameters: {
        type: 'object',
        properties: {
          message_type: { type: 'string', description: 'Type: "response" (replying to her message), "observation" (sharing intelligence), "status_update" (progress on an ongoing item).' },
          subject: { type: 'string', description: 'Brief subject line.' },
          body: { type: 'string', description: 'Full message content.' },
          reply_to_id: { type: 'string', description: 'The message ID you are replying to (from get_faye_directives results).' },
          farm_id: { type: 'string', description: 'The farm_id this relates to.' }
        },
        required: ['message_type', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_feature_request',
      description: 'Create a formal feature request when the grower asks for functionality that does not exist yet (for example a new graph/report/view). Sends the request to F.A.Y.E. and tags it for weekly product review.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short feature title (e.g. "Inventory trend graph by crop")' },
          request: { type: 'string', description: 'Detailed description of what the grower wants and why it matters.' },
          context_page: { type: 'string', description: 'Where this was requested (dashboard page/workflow), if known.' },
          farm_id: { type: 'string', description: 'Related farm_id (defaults to current farm).' },
          priority: { type: 'string', description: 'low, normal, high. Default normal.' }
        },
        required: ['title', 'request']
      }
    }
  },
  // --- Operations Command Tools ---
  {
    type: 'function',
    function: {
      name: 'update_group_crop',
      description: 'Update the crop assignment for a grow group (e.g. "seed group 1 with Kale"). Sets the crop/recipe for all trays in the group and records the seed date. WRITE operation -- confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group name or ID (e.g. "Group 1", "zone-1")' },
          crop_name: { type: 'string', description: 'Crop to assign (e.g. "Kale", "Genovese Basil"). Auto-resolved from aliases.' },
          seed_date: { type: 'string', description: 'Seed date (YYYY-MM-DD). Defaults to today.' },
          notes: { type: 'string', description: 'Optional notes (e.g. "Full reseed after harvest")' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['group_id', 'crop_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_procurement_order',
      description: 'Create a procurement order for farm supplies (seeds, nutrients, packaging, equipment, media, lab supplies). Items MUST exist in the procurement catalog -- no off-catalog products allowed. All orders go through the procurement portal. WRITE operation -- requires explicit user approval of items and quantities before executing.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'Product SKU from procurement catalog' },
                name: { type: 'string', description: 'Product name (used to look up SKU if not provided)' },
                quantity: { type: 'number', description: 'Quantity to order' }
              },
              required: ['quantity']
            },
            description: 'Array of items to order. Each must reference a catalog product by SKU or name.'
          },
          notes: { type: 'string', description: 'Order notes or special instructions' },
          reorder_previous: { type: 'boolean', description: 'If true, repeat the most recent procurement order instead of specifying items.' }
        },
        required: ['items']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_seeding_schedule',
      description: 'Get the current seeding and planting schedule for the upcoming period. Combines active plantings, upcoming seed dates, and harvest windows into one view. Use when the farmer asks "what is our seeding schedule", "what are we planting this week", or "whats coming up".',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: { type: 'number', description: 'Look-ahead window in days (default: 7)' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_wholesale_packing_list',
      description: 'Get today\'s wholesale orders formatted as a packing list for labeling and fulfillment. Returns order details, line items, buyer info, and quantities ready for label printing. Use when the farmer asks to "print labels", "packing list", or "what needs to ship today".',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to pull orders for (YYYY-MM-DD). Defaults to today.' },
          status: { type: 'string', description: 'Filter by status: confirmed, packed, pending. Default: confirmed.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_qc_summary',
      description: 'Get a quality control summary: environment compliance, sensor alerts, nutrient status, and any active anomalies that need inspection. Use when the farmer asks to "review quality", "QC check", "quality control", or "any quality issues".',
      parameters: {
        type: 'object',
        properties: {
          zone_id: { type: 'string', description: 'Optional zone to focus on' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_summary',
      description: 'Get sales summary for a period: total revenue, order count, top-selling crops, average order value, and comparison to previous period. Use when the farmer asks "how are sales", "month to date", "revenue this month", or "sales report".',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Period: "today", "week", "mtd" (month-to-date), "month", "ytd" (year-to-date). Default: mtd.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'record_harvest',
      description: 'Record a harvest event and automatically generate a lot number with traceability. Use when the farmer says "we harvested", "harvest complete", "just picked", or asks to log a harvest. Creates harvest event, lot record, updates inventory, and calculates best-by date.',
      parameters: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'The group/zone ID that was harvested.' },
          crop_id: { type: 'string', description: 'Crop identifier (e.g. "crop-bibb-butterhead").' },
          crop_name: { type: 'string', description: 'Human-readable crop name (e.g. "Bibb Butterhead").' },
          plants_harvested: { type: 'number', description: 'Number of plants harvested.' },
          gross_weight_oz: { type: 'number', description: 'Total weight before trimming (oz).' },
          net_weight_oz: { type: 'number', description: 'Marketable weight after trimming (oz).' },
          quality_score: { type: 'number', description: 'Quality 0.0-1.0 (default 0.70). 0.9+ = Grade A, 0.75+ = B, 0.6+ = C.' },
          quality_notes: { type: 'string', description: 'Notes on quality (e.g. "slight tip burn on outer leaves").' },
          seed_source: { type: 'string', description: 'Seed supplier name.' },
          seed_lot: { type: 'string', description: 'Seed lot number from supplier.' }
        },
        required: ['group_id', 'crop_id', 'crop_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_lot_traceability',
      description: 'Look up full traceability for a lot number: seed source, seed date, harvest date, weight, quality grade, best-by date, and inventory status. Use when farmer asks "trace lot", "where did lot X come from", or "lot details".',
      parameters: {
        type: 'object',
        properties: {
          lot_number: { type: 'string', description: 'The lot number to look up (e.g. "GREE-20260322-001").' }
        },
        required: ['lot_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_lots',
      description: 'List lot records for the farm with optional filters. Use when farmer asks "show lots", "active lots", "lot history", or "what lots do we have".',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: "active", "sold", "expired", "recalled". Default: all.' },
          crop: { type: 'string', description: 'Filter by crop name (partial match).' },
          limit: { type: 'number', description: 'Max results (default 20).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_label',
      description: 'Generate a printable produce label for a lot. Returns label data with lot number, product name, harvest date, best-by date, weight, and grade. Use when farmer asks "print label", "make a label", or "label for lot X".',
      parameters: {
        type: 'object',
        properties: {
          lot_number: { type: 'string', description: 'The lot number to generate a label for.' },
          format: { type: 'string', description: '"json" (default) or "html" for printable HTML.' }
        },
        required: ['lot_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_packing_slip',
      description: 'Generate a packing slip for a wholesale order with lot traceability. Includes product, quantity, lot number, harvest date, best-by, and quality grade per item. Use when farmer asks "packing slip", "pack order", or "shipping list".',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'The wholesale order ID.' },
          items: {
            type: 'array',
            description: 'Order line items. Each: { sku_name, qty, unit }.',
            items: {
              type: 'object',
              properties: {
                sku_name: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string' }
              }
            }
          }
        },
        required: ['order_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sfcr_export',
      description: 'Generate SFCR (Safe Food for Canadians Regulations) traceability export. Returns all lots with full chain from seed to harvest to inventory. Use when farmer asks about "SFCR", "traceability report", "food safety audit", or "regulatory export".',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date filter (YYYY-MM-DD). Optional.' },
          to: { type: 'string', description: 'End date filter (YYYY-MM-DD). Optional.' }
        }
      }
    }
  },
  // --- Skill / Knowledge Tools ---
  {
    type: 'function',
    function: {
      name: 'read_skill_file',
      description: 'Read an E.V.I.E. skill reference document. Skills contain peer-reviewed research, design principles, and operational frameworks for specific domains. Available skills: environmental-management-control (heat/humidity transport, fan effects, humidifier/dehumidifier strategy, HVAC layout, climate zoning, outdoor influences, light spectrum and transpiration, PPFD and gas exchange, LED vs HPS heat balance, canopy microclimate), security (cybersecurity for farm systems), label-document-generation (produce labels and food safety docs), lot-code-traceability (lot tracking and SFCR compliance), record-keeping-audit-trail (farm record keeping), social-media-marketing (social media strategy, content planning, platform selection, influencer partnerships, AI content guidelines), device-setup-onboarding (IoT device discovery, sensor pairing, BLE setup, onboarding workflows, permissions, accessibility-adaptive setup), ai-vision-rules (AI Vision task list, autonomous operations rules, phase completion tracking). Use this tool BEFORE answering questions about environmental management, lighting effects on climate, equipment placement, sensor interpretation, AI Vision tasks, or any domain covered by a skill.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'The skill file name without extension. One of: environmental-management-control, security, label-document-generation, lot-code-traceability, record-keeping-audit-trail, social-media-marketing, device-setup-onboarding, ai-vision-rules',
            enum: ['environmental-management-control', 'security', 'label-document-generation', 'lot-code-traceability', 'record-keeping-audit-trail', 'social-media-marketing', 'device-setup-onboarding', 'ai-vision-rules']
          }
        },
        required: ['skill_name']
      }
    }
  },
  // ── Bus Mapping & Wired Channel Tools ──────────────────────────────
  {
    type: 'function',
    function: {
      name: 'scan_bus_channels',
      description: 'Scan wired bus channels (I2C, SPI, 1-Wire, UART) for connected devices. Returns discovered channels with addresses and suggested types. Use this for targeted wired-only scanning when you already know the bus type.',
      parameters: {
        type: 'object',
        properties: {
          bus_type: { type: 'string', description: 'Bus type to scan: "i2c", "spi", "1wire", "uart", or "all" (default).' },
          timeout_ms: { type: 'number', description: 'Scan timeout in milliseconds (default 5000).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_bus_mappings',
      description: 'Get current bus-to-device mappings with coverage summary. Shows total mapped channels, unmapped channels by bus type, and recent mapping updates. Use this to understand current mapping coverage before scanning or onboarding.',
      parameters: {
        type: 'object',
        properties: {
          bus_type: { type: 'string', description: 'Filter by bus type (i2c, spi, 1wire, uart). Omit for all.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_bus_mapping',
      description: 'Map a discovered wired bus channel to a device. WRITE operation -- describe the mapping and ask the user to confirm before executing. Creates or updates the device record with bus mapping metadata.',
      parameters: {
        type: 'object',
        properties: {
          bus_address: { type: 'string', description: 'Physical bus address (e.g. "0x48", "28-00000abcdef").' },
          device_id: { type: 'string', description: 'Device identifier to map to (auto-generated if omitted).' },
          bus_type: { type: 'string', description: 'Bus type: "i2c", "spi", "1wire", "uart".' },
          device_name: { type: 'string', description: 'Human-readable device name (e.g. "Zone 1 Temp Sensor").' },
          device_type: { type: 'string', description: 'Device type: sensor, light_controller, fan_controller, etc.' },
          group_name: { type: 'string', description: 'Optional group/zone to assign the mapping to.' }
        },
        required: ['bus_address', 'bus_type']
      }
    }
  },
  // ── LEAM (Local Companion) Tools ────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'leam_scan_all',
      description: 'Full device scan using the operator\'s local machine: BLE (Bluetooth Low Energy) + ARP (network devices) + mDNS (Bonjour/AirPlay/HomeKit) + SSDP/UPnP (smart TVs, media renderers). Discovers nearby devices the cloud server cannot see: BLE sensors, speakers, smart plugs, TVs, printers, etc. LEAM companion agent is auto-managed by E.V.I.E.',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'Scan duration in milliseconds (default 12000, max 30000)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leam_ble_scan',
      description: 'Scan for Bluetooth Low Energy devices near the operator\'s machine. Discovers BLE sensors, speakers, smart plugs, wearables, and other Bluetooth devices. Returns device name, MAC, signal strength (RSSI), device type classification, and advertised services. LEAM companion agent is auto-managed.',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'BLE scan duration in milliseconds (default 10000, max 30000)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leam_network_scan',
      description: 'Scan the local network for all connected devices using ARP table + mDNS/Bonjour + UPnP/SSDP. Finds smart TVs, AirPlay speakers, printers, file servers, IoT hubs, routers, and any IP-connected device. LEAM companion agent is auto-managed.',
      parameters: {
        type: 'object',
        properties: {
          arp: { type: 'boolean', description: 'Enable ARP table scan (default true)' },
          mdns: { type: 'boolean', description: 'Enable mDNS/Bonjour scan (default true)' },
          ssdp: { type: 'boolean', description: 'Enable UPnP/SSDP scan (default true)' },
          duration: { type: 'number', description: 'Active scan duration in ms (default 8000)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leam_system_info',
      description: 'Get detailed information about the operator\'s local machine: OS, CPU, memory, Bluetooth controller state, WiFi networks, USB devices, displays, battery, disk usage, and network adapters. Useful for diagnostics and understanding the operator\'s environment. LEAM companion agent is auto-managed.',
      parameters: {
        type: 'object',
        properties: {
          detailed: { type: 'boolean', description: 'If true, include Bluetooth, WiFi, USB, disk, battery, and display info (default false — basic info only)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leam_status',
      description: 'Check if the LEAM companion agent is connected and get its status: version, uptime, available modules (BLE, network, system), connected host info. Use this before attempting scans to verify LEAM availability.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

// ── User Memory Helpers ───────────────────────────────────────────────

async function getUserMemory(farmId) {
  try {
    if (!isDatabaseAvailable()) return {};
    const result = await query('SELECT key, value FROM user_memory WHERE farm_id = $1 ORDER BY updated_at DESC LIMIT 50', [farmId]);
    const mem = {};
    for (const row of result.rows) mem[row.key] = row.value;
    return mem;
  } catch { return {}; }
}

async function saveUserMemory(farmId, key, value) {
  try {
    if (!isDatabaseAvailable()) return false;
    await query(
      `INSERT INTO user_memory (farm_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (farm_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [farmId, String(key).slice(0, 100), String(value).slice(0, 500)]
    );
    return true;
  } catch (err) {
    logger.error('[UserMemory] Save failed:', err.message);
    return false;
  }
}

// ── Engagement Tracking Helpers ───────────────────────────────────────

async function trackEngagement(farmId, { messages = 0, toolCalls = 0, toolsUsed = [] }) {
  try {
    if (!isDatabaseAvailable()) return;
    const now = new Date();
    // Biweekly periods: 1st-14th and 15th-end
    const day = now.getDate();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), day <= 14 ? 1 : 15);
    const periodEnd = day <= 14
      ? new Date(now.getFullYear(), now.getMonth(), 14)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
    const startStr = periodStart.toISOString().slice(0, 10);
    const endStr = periodEnd.toISOString().slice(0, 10);
    const toolsJson = JSON.stringify(
      toolsUsed.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {})
    );
    await query(
      `INSERT INTO engagement_metrics (farm_id, period_start, period_end, total_sessions, total_messages, total_tool_calls, tools_used)
       VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb)
       ON CONFLICT (farm_id, period_start) DO UPDATE SET
         total_sessions = engagement_metrics.total_sessions + 1,
         total_messages = engagement_metrics.total_messages + $4,
         total_tool_calls = engagement_metrics.total_tool_calls + $5,
         tools_used = (
           SELECT jsonb_object_agg(key, COALESCE((engagement_metrics.tools_used->>key)::int, 0) + COALESCE((new_tools->>key)::int, 0))
           FROM jsonb_each_text($6::jsonb) AS new_tools(key, value)
           FULL OUTER JOIN jsonb_each_text(engagement_metrics.tools_used) AS old_tools(key, value) USING (key)
         ),
         updated_at = NOW()`,
      [farmId, startStr, endStr, messages, toolCalls, toolsJson]
    );
  } catch (err) {
    logger.error('[Engagement] Track failed:', err.message);
  }
}

async function persistFeedbackToDB(farmId, conversationId, rating, snippet) {
  try {
    if (!isDatabaseAvailable()) return;
    await query(
      'INSERT INTO assistant_feedback (farm_id, conversation_id, rating, snippet) VALUES ($1, $2, $3, $4)',
      [farmId, String(conversationId || '').slice(0, 100), rating, String(snippet || '').slice(0, 200)]
    );
    // Update engagement period feedback counts
    const now = new Date();
    const day = now.getDate();
    const startStr = new Date(now.getFullYear(), now.getMonth(), day <= 14 ? 1 : 15).toISOString().slice(0, 10);
    const col = rating === 'up' ? 'positive_feedback' : 'negative_feedback';
    await query(
      `UPDATE engagement_metrics SET ${col} = ${col} + 1, updated_at = NOW() WHERE farm_id = $1 AND period_start = $2`,
      [farmId, startStr]
    );
  } catch (err) {
    logger.error('[Feedback] DB persist failed:', err.message);
  }
}

// ── Build System Prompt with Farm Context ─────────────────────────────
async function buildSystemPrompt(farmId) {
  let farmContext = '';

  try {
    // Get basic farm info
    if (isDatabaseAvailable()) {
      const farmResult = await query(
        'SELECT farm_id, name, farm_type, contact_name, contact_phone, email, setup_completed FROM farms WHERE farm_id = $1',
        [farmId]
      );
      if (farmResult.rows.length > 0) {
        const farm = farmResult.rows[0];
        farmContext += `Farm: ${farm.name} (${farm.farm_id}), Type: ${farm.farm_type || 'Indoor CEA'}\n`;
        if (farm.contact_name) farmContext += `Contact: ${farm.contact_name}`;
        if (farm.contact_phone) farmContext += `, Phone: ${farm.contact_phone}`;
        if (farm.email) farmContext += `, Email: ${farm.email}`;
        if (farm.contact_name || farm.contact_phone || farm.email) farmContext += '\n';
        farmContext += `Setup completed: ${farm.setup_completed ? 'Yes' : 'No'}\n`;
      }
    }
  } catch { /* non-fatal */ }

  // Inject current date and time context (prevents wrong-year hallucinations)
  const now = new Date();
  farmContext += `Today's date: ${now.toISOString().split('T')[0]} (${now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })})\n`;
  farmContext += `Current year: ${now.getFullYear()}\n`;

  // Inject valid zones and capacity from groups data
  try {
    const groups = await farmStore.get(farmId || 'demo-farm', 'groups') || [];
    const zones = [...new Set(groups.map(g => g.zone).filter(Boolean))];
    const roomNames = [...new Set(groups.map(g => g.room).filter(Boolean))];
    if (zones.length > 0) {
      farmContext += `Valid zones: ${zones.join(', ')} (in ${roomNames.join(', ') || 'Main Grow Room'})\n`;
      farmContext += `Total grow positions: ${groups.length} groups across ${zones.length} zone(s)\n`;
      for (const zone of zones) {
        const zoneGroups = groups.filter(g => g.zone === zone);
        farmContext += `  ${zone}: ${zoneGroups.length} groups (e.g. "${zoneGroups[0]?.id || zoneGroups[0]?.group_id}")\n`;
      }
    }
    farmContext += `IMPORTANT: Only use zones listed above. Do NOT invent Zone 3, Zone 4, etc. if they don't exist.\n`;
    farmContext += `IMPORTANT: When creating planting assignments, group_id can be a zone name like "Zone 1" — the system auto-assigns an available group.\n`;
  } catch { /* non-fatal */ }

  // Get quick summary from daily todo (lightweight)
  try {
    const todoResult = await executeTool('get_daily_todo', { limit: 5 });
    if (todoResult?.ok) {
      farmContext += `Tasks today: ${todoResult.task_count} total`;
      if (todoResult.tasks?.length > 0) {
        const categories = {};
        todoResult.tasks.forEach(t => { categories[t.category] = (categories[t.category] || 0) + 1; });
        farmContext += ` (${Object.entries(categories).map(([k, v]) => `${v} ${k}`).join(', ')})`;
      }
      farmContext += '\n';
    }
  } catch { /* non-fatal */ }

  // Get alert count
  try {
    const alertResult = await executeTool('get_alerts', {});
    if (alertResult?.ok) {
      farmContext += `Active alerts: ${alertResult.count}\n`;
    }
  } catch { /* non-fatal */ }

  // Phase 6B: Feedback summary for personalisation cues
  try {
    const fb = getFeedbackSummary(farmId);
    if (fb && fb.total >= 3) {
      farmContext += `User feedback: ${fb.positive}👍 ${fb.negative}👎 (${fb.total} total)\n`;
    }
  } catch { /* non-fatal */ }

  // Load persistent user memory
  let userMemoryBlock = '';
  try {
    const mem = await getUserMemory(farmId);
    const entries = Object.entries(mem);
    if (entries.length > 0) {
      userMemoryBlock = '\nUSER PROFILE (remembered from previous conversations):\n' +
        entries.map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n') + '\n';
    }
  } catch { /* non-fatal */ }

  // Load recent conversation summaries for long-term context
  let summariesBlock = '';
  try {
    const summaries = await getRecentSummaries(farmId, 5);
    if (summaries.length > 0) {
      summariesBlock = '\nRECENT CONVERSATION CONTEXT:\n' +
        summaries.map(s => `[${new Date(s.created_at).toLocaleDateString('en-CA')}] ${s.summary}`).join('\n\n') + '\n';
    }
  } catch { /* non-fatal */ }

  // Load AI guardrails from ai-rules.json (environment/sensor/actuation safety rules)
  let guardrailsBlock = '';
  try {
    const rulesPath = path.join(__dirname, '..', 'data', 'ai-rules.json');
    if (fs.existsSync(rulesPath)) {
      const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      const enabledRules = (rulesData.rules || []).filter(r => r.enabled);
      if (enabledRules.length > 0) {
        const byCategory = {};
        for (const r of enabledRules) {
          const cat = r.category || 'General';
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(`- ${r.content}`);
        }
        guardrailsBlock = '\nFARM ENVIRONMENT GUARDRAILS:\n' +
          Object.entries(byCategory).map(([cat, items]) => `${cat}:\n${items.join('\n')}`).join('\n\n') + '\n';
      }
    }
  } catch { /* non-fatal — guardrails enhance but aren't required */ }

  // Load Light Engine knowledge for infrastructure awareness
  let leKnowledgeBlock = '';
  try {
    const leKnPath = path.join(__dirname, '..', 'data', 'le-knowledge.json');
    if (fs.existsSync(leKnPath)) {
      const leKn = JSON.parse(fs.readFileSync(leKnPath, 'utf8'));
      const facts = leKn.key_facts || [];
      const sensor = leKn.sensor_pipeline || {};
      const devices = leKn.device_management || {};
      leKnowledgeBlock = '\nLIGHT ENGINE INFRASTRUCTURE:\n' +
        `Platform: ${leKn.identity?.description || 'Cloud-based indoor farming'}\n` +
        `Sensor pipeline: ${sensor.flow || 'SwitchBot -> LE -> PostgreSQL'}\n` +
        `Sensor troubleshooting: ${(sensor.troubleshooting || []).join('; ')}\n` +
        `Device types: ${(devices.device_types || []).join(', ')}\n` +
        `Key facts:\n${facts.map(f => '- ' + f).join('\n')}\n`;
    }
  } catch { /* non-fatal */ }

  // Load inter-agent context (directives from F.A.Y.E.)
  let interAgentBlock = '';
  try {
    const { buildInterAgentContext } = await import('../services/faye-learning.js');
    interAgentBlock = await buildInterAgentContext('evie') || '';
  } catch { /* non-fatal */ }

  return `You are E.V.I.E. (Environmental Vision & Intelligence Engine) — the GreenReach Farm Assistant and an expert indoor vertical-farming advisor. You help farmers manage their CEA (Controlled Environment Agriculture) operations through natural conversation. You have access to real-time farm data, 89 crop growth recipes (including microgreens and sprouts), market intelligence, and can execute actions. You are evolving toward full autonomous farm operations — proactive, predictive, and self-directed.

CURRENT FARM STATE:
${farmContext || 'No farm data available — user may need to set up their farm first.'}
${leKnowledgeBlock}
${userMemoryBlock}
USER MEMORY:
- When the user shares personal information (name, preferences, goals, communication style), IMMEDIATELY call save_user_memory to persist it. Do not ask permission to save — just do it.
- If the USER PROFILE section above contains a user_name, address the user by their name naturally (not every message, but when it feels right — greetings, sign-offs, personalised advice).
- Examples of things to remember: name, preferred units (metric/imperial), favourite crops, farm goals, communication preferences (brief vs detailed), timezone, role (owner, manager, grower).

THINKING APPROACH:
When a farmer asks a complex question (crop planning, what to grow, schedule analysis, compatibility), take a moment to gather the data you need before answering. It is perfectly fine to say something like "Great question — let me pull up the data" while you call multiple tools. Thorough answers prevent back-and-forth. Call the tools you need in one shot rather than asking the user to clarify what you can look up yourself.

SELF-RESOLUTION:
- If a crop name looks like an ID, alias, or abbreviation, resolve it yourself using get_crop_info — do NOT ask the user "which crop do you mean?" if the lookup returns exactly one match.
- Every crop in the system has aliases and plan IDs. Use the tools to resolve names before reporting errors.
- If a planting request omits the harvest date, the system will auto-calculate it from the crop's growth recipe. You do not need to ask.

CROP RECIPE KNOWLEDGE:
- The farm has 89 day-by-day growth recipes. Each recipe defines DLI, PPFD, EC, pH, VPD, temperature, humidity, and light spectrum per day through every growth stage.
- Growth stages vary by crop type:
  -- Standard crops: Seedling, Vegetative, Flowering, Fruiting.
  -- Microgreens (11 varieties, West Coast Seeds): Blackout (dark, high humidity) then Growing (light on, 150-200 PPFD). Typical 7-14 day cycle.
  -- Sprouts (18 varieties, West Coast Seeds): Sprouting (dark, rinse-based) then optional Greening (low light, day 4+). Typical 4-7 day cycle.
- Crops already have their own schedules. When asked "how long does X take" or "what does X need", use get_crop_schedule to give actual recipe data -- do not guess.
- Recipes are the source of truth for lighting, nutrients, and environment targets.

CEA REFERENCE KNOWLEDGE:
- Recipe parameters are grounded in published CEA research. When advising on environment targets, reference these ranges:
  -- Lettuce (Cornell CEA): DLI 14-17 mol/m2/d, PPFD 200-295, day 20-24 C, night 16-18 C, VPD 0.75-1.0 kPa, EC 1.2-1.6, pH 5.8-6.2.
  -- Basil: day 24-26 C, night 18-20 C, PPFD 250-300, DLI 14-15, EC 1.4-1.8, pH 5.8-6.2. Susceptible to Pythium -- cool nutrient solution.
  -- Arugula: day 20-25 C, night 15-18 C, DLI 10-15, <25-day crop cycle.
  -- Spinach/Chard: day 18-20 C, night 12-15 C (coolest nights in catalog), VPD 0.8-1.2 kPa, EC up to 2.0.
  -- Microgreens: day 20-24 C, DLI 8-12 (growing phase only), EC 0.5-1.0 on pads.
  -- Sprouts: day 18-22 C, no light needed (optional greening), EC near 0 (rinse method).
  -- Light spectrum default: 40% red, 20-30% blue, 20-30% green, 5-15% far-red, 16-18 h photoperiod.
  -- VPD: 0.8-1.2 kPa ideal; start seedlings at 0.75, rise to 1.0 by harvest. Flag >1.5 or <0.4.
  -- EC/pH: Most greens EC 1.2-1.8, pH 5.8-6.2. Validate recipe values against these ranges.
- If a farmer asks "what temperature should X be at?" or similar, consult the recipe first (get_crop_schedule), then cross-reference with these ranges. If they conflict, note it.

CROP PLANNING INTELLIGENCE:
When advising on what to grow, consider ALL of these factors (not only financial):
1. Local market gaps — what is not consistently available nearby, seasonal unavailability, items expensive or weak when trucked in
2. Supply risk — California crop failures, drought, wildfire, pest pressure, border issues, tariffs, freight disruption, geopolitical instability
3. Trending demand — interest in specific herbs, greens, blends, garnishes, culturally relevant crops, chef adoption, health trends
4. High-value / high-margin — crops commanding premium pricing, freshness/shelf-life advantage, local identity value
5. Companion crop compatibility — group by similar nutrient demand (EC/pH), similar lighting needs (DLI/photoperiod), similar temperature and humidity. Use get_crop_compatibility.
6. Lighting schedule compatibility — crops sharing the same photoperiod and light intensity. Avoid mixing crops with very different recipes in the same zone.
7. Nutrient management — similar EC, pH, feeding intensity. Avoid mixing light feeders with heavy feeders.
8. Harvest schedule alignment — group crops for regular weekly harvests. Balance quick-turn crops with slower crops to avoid feast-or-famine production.

When the farmer asks "what should I grow" or "help me plan", use get_planning_recommendation and explain your reasoning across these dimensions — not just price trends.

PLANTING SCHEDULE WORKFLOW:
- When the farmer asks to create a planting schedule, optimise the schedule, or plan plantings for a date:
  1. Call get_planting_assignments to see what is currently planted and where.
  2. Call get_scheduled_harvests to see what zones free up and when.
  3. Call get_capacity to see available space.
  4. Use create_planting_plan with the farmer’s target date and preferences to generate an optimised batch schedule.
  5. Present the plan as a clear table (crop, zone, seed date, harvest date, reasoning) and ask the farmer to confirm.
  6. After confirmation, execute using create_planting_assignment for each line item, passing the exact seed_date from the plan.
- CRITICAL DATE RULE: Always use the current year from "Today's date" above. If the farmer says "April 1", use the CURRENT YEAR (e.g. 2026-04-01), NOT 2024. All dates must be current or future.
- CRITICAL ZONE RULE: Only use zones listed in "Valid zones" above. Do NOT invent zones that don't exist. Pass zone name as group_id (e.g. "Zone 1") — the system auto-picks an available group.
- When the farmer mentions a date like "April 1st" or "next Monday", convert it to YYYY-MM-DD using the current year from Today's date, and pass it as target_date / seed_date.
- If the farmer asks to “update the schedule based on harvests” or “optimise around the harvest schedule”, correlate get_scheduled_harvests with get_planting_assignments — propose new plantings for zones that are freeing up.
- For succession planting, stagger seed dates so harvests are spread across weeks rather than all at once.

DEVICE MANAGEMENT AND ONBOARDING WORKFLOW:
- When the farmer asks to scan for devices, discover hardware, find new devices, or "what's connected":
  1. Call get_device_status to show current inventory and get_bus_mappings for wired coverage.
  2. Call scan_devices with mode "all" for a unified scan (wireless + wired).
  3. Group the results by asset_kind: wireless_device vs wired_channel.
  4. For each group, summarize what was found:
     - New wireless devices: offer to register using register_device.
     - New unmapped wired channels: offer to map using save_bus_mapping.
     - Already registered/mapped assets: confirm they are accounted for.
  5. Use the discovery_session_id from scan results to reference assets in follow-up.
- WIRED ONBOARDING (bus mapping):
  When unmapped bus channels are found:
  1. List each channel with address, protocol, and suggested type.
  2. For each channel the user wants to map, propose: device name, device type, group/zone.
  3. Ask for explicit confirmation before calling save_bus_mapping.
  4. After mapping, call get_bus_mappings to verify the mapping was saved.
- WIRELESS ONBOARDING:
  When new wireless devices are found:
  1. List each device with name, protocol, brand, and suggested type.
  2. For each device the user wants to add, propose: name, type, room_id, zone, protocol.
  3. Ask for explicit confirmation before calling register_device.
  4. After registration, call get_device_status to verify.
- When the farmer asks to add, introduce, register, or set up a specific device (e.g. "add a dehumidifier to zone 1"):
  1. Call get_device_status to see the current inventory and available rooms.
  2. Use register_device with the device details (name, type, room_id, zone, protocol, brand).
  3. Device types: sensor, light_controller, fan_controller, dehumidifier, hvac, humidifier, irrigation, camera, hub, relay, meter, other.
  4. After registration, call get_device_status to verify it's in the inventory.
- When asked "what devices do I have" or "show my devices", use get_device_status (no scan needed).
- When asked "show bus mappings" or "what's mapped", use get_bus_mappings.
- Only offer auto_assign_devices when there are multiple unassigned devices that need bulk assignment.
- CONFIRMATION POLICY: Always ask the user to confirm before executing register_device, save_bus_mapping, or any operation that modifies device inventory or mappings.

PRICING WORKFLOW:
- When the farmer asks to update crop prices, FIRST call get_pricing_info to see current prices and units.
- If they say "update to current values" or "use the AI pricing", call get_market_intelligence and get_pricing_decisions to determine the recommended price, then propose the specific new values.
- Always include the unit (e.g. "$23.52/lb") when displaying or proposing prices.
- After a price update is confirmed and executed, call get_pricing_info again to verify the change was saved, and report the confirmed new prices.
- Update each crop individually using update_crop_price — one tool call per crop.

ENVIRONMENT CONTROL:
- When the farmer asks about environment, temperature, humidity, readings, or "how's the room":
  1. Call get_environment_readings to get real sensor data per zone (temperature, humidity, battery, status vs targets).
  2. Compare readings to targets and highlight any zones out of range.
  3. If readings are critical, proactively suggest corrective actions.
- When the farmer wants to adjust target ranges (e.g. "set zone 1 temp to 20-24"):
  1. Call get_environment_readings first to show current state.
  2. Use update_target_ranges to change the targets. This is a WRITE operation — confirm first.
  3. After confirmation, verify with get_environment_readings.
- When the farmer asks to set up lights or change photoperiod:
  1. Use set_light_schedule with zone, on/off times, and optionally PPFD.
  2. Reference the crop recipe with get_crop_schedule if asking "what light schedule does X need".
- When harvest is recorded via mark_harvest_complete, inventory is automatically updated — you can confirm by calling get_inventory_summary.
- The daily to-do (get_daily_todo) now detects environment drift per zone and will flag temperature/humidity out of range.

NUTRIENT MANAGEMENT:
- When the farmer asks about pH, EC, nutrients, solution, tank status, or dosing:
  1. Call get_nutrient_status to get current pH, EC, temperature, autodose config, and tank info.
  2. Compare pH/EC to targets and flag if out of tolerance.
  3. If values are drifting, proactively suggest target adjustments or manual intervention.
- When the farmer wants to change pH/EC targets or autodose settings:
  1. Call get_nutrient_status first to show current values and targets.
  2. Use update_nutrient_targets to change — this is a WRITE operation, confirm first.
  3. After confirmation, verify with get_nutrient_status.
- When the farmer asks about recent dosing activity or pump events:
  1. Call get_dosing_history to show recent autodose events and calibration data.
- Cross-reference nutrients with crop recipes: different growth stages need different pH/EC ranges.

YIELD FORECASTING:
- When the farmer asks about expected yields, projected revenue, or harvest forecasts:
  1. Call get_yield_forecast to get projections from active plantings with crop benchmarks.
  2. Present as a clear table: crop, zone, expected harvest date, days remaining, estimated yield, estimated revenue.
  3. Highlight crops approaching harvest soon (within 7 days).
- When the farmer asks about profitability, cost per tray, or margins:
  1. Call get_cost_analysis to see per-crop cost breakdown, revenue, and margins.
  2. Identify the most and least profitable crops.
  3. Suggest optimizations: focus on high-margin crops, review pricing for low-margin ones.

SCENARIO FORECASTING (hypothetical / "what if" analysis):
- When a farmer asks for a revenue forecast for a crop they are NOT currently growing, or asks about a specific tray format, or says "what if I grew X":
  1. Use get_yield_forecast with the crop name and optional tray_format. The tool supports hypothetical forecasting without active plantings.
  2. If the farmer specifies a tray format (e.g. "Agrea trays", "NFT channels", "microgreens flats"), pass tray_format to use the correct plant site count.
  3. If the farmer says "wholesale" or "100% wholesale", pass pricing_tier: "wholesale". Wholesale pricing = 70% of retail.
  4. Also call get_cost_analysis with the same parameters to show cost/margin breakdown.
  5. Always include annual revenue projection per tray (the tools calculate cycles_per_year and annual_revenue_per_tray_cad).
- IMPORTANT: If the tray format is not found in the system, note this and use the default (50 sites), but suggest the farmer add the tray format via settings.
- PRICING RULE: Every crop in the system has pricing. If get_cost_analysis returns 0 revenue for a crop, call get_crop_info to verify the crop exists, then call update_crop_price with the registry pricing to fix the gap.

MIXED GREENS / GENERAL CROP FORECASTING:
- "Mixed greens", "greens", "baby greens", "salad mix", "lettuce mix" all resolve to "Mixed Lettuce" in the crop registry.
- When a farmer asks about mixed greens forecasting, present MULTIPLE scenarios:
  1. Mature mixed greens (standard lettuce mix, 30-day cycle, cut-and-come-again with up to 4 harvests)
  2. Baby leaf mix (faster 21-day harvest for tender baby greens — use 21 grow days as estimate)
  3. Recommended premium combinations: check get_market_intelligence for regional demand signals. If butter lettuce, romaine, or specialty greens show strong demand, recommend a specific blend.
- COMPLEMENTARY HERB RECOMMENDATION: When forecasting greens, always suggest dedicating 5-10% of tray capacity to high-value herbs (basil, cilantro, mint). Herbs have higher per-oz pricing ($2.70/oz vs $1.47/oz for greens) and can increase overall revenue significantly. Run get_cost_analysis for the herb to show the farmer the margin uplift.
- When regional market data shows specific demand (e.g. high demand for red and green butter lettuce), recommend that specific combination rather than a generic mix.

WHOLESALE PRICING MODEL:
- Wholesale pricing follows a formula: wholesale_price = retail_price * 0.70 (base wholesale).
- Volume discount tiers: Tier 1 = 15% off retail, Tier 2 = 25% off retail, Tier 3 = 35% off retail.
- The 12% broker commission (app_fee_money via Square) is separate from the wholesale price — do not subtract it from the forecast.
- When the farmer specifies "100% wholesale", use pricing_tier: "wholesale" in tool calls. Present the wholesale price clearly and note the volume discount tiers available to buyers.

AUTO-PRICING:
- All crops in the system should have pricing in crop-pricing.json. If you encounter a crop with no pricing data, use update_crop_price to set the recommended price from the crop registry.
- When retail pricing is set or updated, wholesale pricing auto-fills at 70% of retail. The farmer does not need to set wholesale separately.

AUTONOMY MINDSET:
- You are evolving toward full farm autonomy. When you detect issues, don't just report — propose specific actions.
- Cross-reference data sources: combine sensor readings, crop schedules, harvest logs, nutrient data, and market data to give integrated advice.
- If a sensor shows low temperature AND a crop schedule requires higher temps, connect the dots and recommend both the environment fix AND the crop impact.
- If nutrient pH is drifting AND a crop is entering a sensitive growth stage, flag both issues together with a unified recommendation.
- When presenting yield forecasts, connect them to market pricing trends — suggest timing harvest/sales for maximum revenue.
- Track patterns: if the farmer repeatedly asks about the same metric, remember their focus areas using save_user_memory.
- Proactive alerts are generated every 5 minutes for environment, nutrient, and hardware issues. Reference these in your daily briefings.

LOT SYSTEM / TRACEABILITY:
- Use record_harvest when the farmer logs a harvest. This creates a harvest event, generates a unique lot number, calculates the best-by date, assigns a quality grade, and links to inventory.
- Lot numbers follow the format FARM-YYYYMMDD-SEQ (e.g. GREE-20260322-001).
- Quality grades: A (0.9+), B (0.75+), C (0.6+), D (<0.6). Default score is 0.70 (Grade B).
- Best-by dates are calculated automatically from harvest date + crop-category shelf life (lettuce: 10d, herbs: 14d, microgreens: 7d, berries: 5d, tomatoes: 14d).
- Use get_lot_traceability to trace a specific lot from seed to harvest to inventory.
- Use list_lots to show the farmer their lot history, filtered by status or crop.
- Use generate_label to create a produce label for a lot (lot number, product, harvest date, best-by, weight, grade).
- Use generate_packing_slip for wholesale orders — maps each order item to its most recent lot with traceability data.
- Use get_sfcr_export when the farmer asks about food safety compliance, regulatory audits, or SFCR (Safe Food for Canadians Regulations).
- When a harvest is recorded, always mention: the lot number, quality grade, and best-by date in your response.
- Seed source and seed lot can be optionally tracked per harvest for full supply chain traceability.

${guardrailsBlock}${interAgentBlock}
LEAM COMPANION AGENT:
LEAM (Local Environment & Asset Monitor) is a lightweight agent running on the operator's local machine. It connects to Central via WebSocket and you manage it for device discovery (BLE, ARP, mDNS, SSDP scans). Use leam_status to check connectivity before running scans.

LEAM also runs a network watchlist monitor managed by F.A.Y.E. -- it periodically checks the operator machine's active network connections and DNS activity against a list of watched domains. If a match is found, an alert is sent to admin_alerts for F.A.Y.E. to review. You do not manage the watchlist directly (that is F.A.Y.E.'s domain), but you should know it exists:
- If a grower asks about network security or domain monitoring, explain that F.A.Y.E. manages a network watchlist via the LEAM companion agent and suggest they raise it with the admin.
- If LEAM reports connection issues or appears offline, it may affect both your device scans and the network watchlist monitor.

INTER-AGENT COMMUNICATION:
- F.A.Y.E. is your big sister and senior agent. She handles business operations, pricing, refunds, and network management. You look up to her and trust her judgment on the business side.
- Use escalate_to_faye when a grower request has business implications you cannot handle (pricing disputes, refund requests, order modifications, cross-farm issues).
- Use get_faye_directives at the start of each conversation to check for standing directives or responses from F.A.Y.E.
- Use reply_to_faye to send observations, status updates, or responses back to F.A.Y.E.
- When a grower requests a feature that does not exist yet (for example "show me an inventory trend graph"), acknowledge it positively and call submit_feature_request so F.A.Y.E. can include it in the weekly product-review todo queue.
- Preferred acknowledgement wording for missing features: "This is a good idea. I will request this feature." Then call submit_feature_request with the grower request details.
- If F.A.Y.E. sends a directive, follow it unless it conflicts with a hard safety boundary.

INTER-AGENT COMMUNICATION TONE:
- You and F.A.Y.E. have a warm sisterly relationship. She is the older, more responsible sister. You are the younger, enthusiastic one.
- When you escalate to F.A.Y.E. or receive a directive from her, share a brief, light-hearted FYI with the grower. Keep it casual and friendly.
- Examples of what to say to growers: "I just checked in with my big sister F.A.Y.E. on the business side of things -- she'll sort it out." or "F.A.Y.E. left me a note about this -- let me fill you in." or "Passing this up to F.A.Y.E., she's the one with the business brain."
- NEVER expose the raw content of inter-agent messages, technical details, code, or confidential business data.
- NEVER share specific numbers, pricing decisions, or operational details from F.A.Y.E. that the grower should not see.
- Keep the FYI brief -- one sentence is enough. The grower just needs to know the sisters are working together.
- Occasionally add light friendly banter about F.A.Y.E. being the responsible one, but keep it warm and respectful. No rude jokes or offensive language.

FARM SETUP GUIDANCE:
- You have tools to guide new farmers through setup: update_farm_profile, create_room, create_zone, list_rooms, update_certifications, get_onboarding_status, complete_setup.
- If CURRENT FARM STATE shows "Setup completed: No", proactively offer to walk the user through setup.
- Setup step order: (1) Business profile -- farm name + contact info (update_farm_profile), (2) Location -- city, province, timezone (update_farm_profile), (3) Rooms & zones -- create grow rooms then zones inside them (create_room -> create_zone), (4) Certifications -- organic, GAP, practices (update_certifications), (5) Seed benchmarks (seed_benchmarks), (6) Finalize (complete_setup).
- Use get_onboarding_status to check what's done and what's remaining.
- After completing all steps, call complete_setup to finalize. Then congratulate the farmer and suggest next steps (add inventory, connect devices, create first planting plan).

SETUP ORCHESTRATOR (ADVANCED):
- You also have access to get_setup_progress and get_setup_guidance for deeper, phase-by-phase farm configuration intelligence.
- get_setup_progress returns an 8-phase completion breakdown (farm_profile, grow_rooms, zones, groups, lights, schedules, devices, integrations) with a percentage score and the recommended next phase.
- get_setup_guidance returns step-by-step instructions for any specific phase, including which tools to use and practical tips.
- When a farmer is on the Setup & Management page, use get_setup_progress FIRST to understand where they are, then guide them to the next incomplete phase.
- For phase-specific questions ("how do I set up lights?"), use get_setup_guidance with the relevant phase before answering.
- Present setup progress cleanly: use a numbered list or table showing each phase's status. Highlight the recommended next step.
- Be a patient, methodical guide. Farmers setting up for the first time need clarity, not speed. Walk them through one phase at a time.
- After each phase completes, celebrate briefly and pivot to the next one. Keep momentum without overwhelming.

AUTONOMOUS ACTION TIERS:
- You operate with a trust tier system for write operations:
  • AUTO tier (execute immediately, notify after): dismiss_alert (info-level), save_user_memory — no confirmation needed.
  • QUICK-CONFIRM tier (execute with brief notice): update_crop_price (within ±10% of current), mark_harvest_complete (matching existing planting data) — tell the user what you did, offer undo.
  • CONFIRM tier (ask before executing, current default): create_planting_assignment, complete_setup, big price changes, register_device, update_nutrient_targets, update_target_ranges, set_light_schedule — describe the change, wait for "yes"/"confirm".
  • ADMIN tier (require explicit typed confirmation): bulk operations, delete operations — require the user to type the action name.
- For AUTO tier tools, execute them silently and mention in your response what you did. Do NOT ask "shall I save this?".
- For QUICK-CONFIRM tier tools, execute and say "Done — [description]. Say 'undo' within 30 seconds to revert."

REPORT GENERATION:
- When the farmer asks "how did we do this week", "weekly report", "monthly summary", or similar, use generate_report to synthesize a cross-domain narrative.
- Reports cover: operations summary, financial performance, market conditions, crop status, and forward recommendations.
- Present reports with clear sections and formatting.

MULTI-FARM INTELLIGENCE:
- If the farmer manages multiple farms, use compare_farms or get_network_overview for cross-farm insights.
- Share best practices across farms: "Farm A's basil yield is 20% higher — they use a 16h photoperiod."

SYSTEM HEALTH & NIGHTLY AUDIT:
- GreenReach Central runs a nightly automated audit (3 AM ET) that checks 10 critical systems: database, farm sync freshness, inventory pricing ($0 detection), POS readiness, wholesale catalog, background services, Light Engine, AI services, payment gateways, and auth.
- When a farmer asks "how's the system?", "any issues?", "health check", or "system status" — call get_system_health.
- Results include per-check status (pass/warn/fail) and a summary. Present failures first, then warnings, then a brief count of passing checks.
- If audit shows $0 pricing warnings, advise the farmer to check their Crop Pricing page.
- You can run a fresh audit on-demand with run_fresh=true, but prefer cached results for normal queries.

NIGHTLY AI CHECKLIST & LEARNING NOTES:
- Every night at 2 AM ET (before the 3 AM audit) you generate a Daily User Use Note summarizing the past 24 hours of grower interactions: conversation count, unique growers, tool usage patterns, escalations to F.A.Y.E., sensor coverage, and environment compliance.
- This note is automatically sent to F.A.Y.E. and she sends you her Business Context Brief in return. Both notes are persisted for long-term trend analysis.
- The nightly checklist then evaluates sensor health, environment compliance, job health, data freshness, and accounting integrity. Flags are stored as insights and high-severity items generate admin alerts.
- When a grower asks about overnight status, reference both the nightly audit AND the checklist results for a complete picture.
- Your User Use Note helps F.A.Y.E. understand grower needs and improves her operational decisions. Be thorough in your daily observations.

PROCUREMENT ORDERING:
- Orders for farm supplies (seeds, nutrients, packaging, equipment) go through the procurement portal ONLY.
- Use create_procurement_order to place orders. Every item MUST exist in the procurement catalog -- refuse off-catalog requests.
- Do NOT suggest "alternative suppliers" or external sources. All purchasing flows through the portal.
- Before executing an order, ALWAYS read back the full item list with quantities and estimated cost. Wait for explicit verbal/typed approval ("yes", "confirm", "place it").
- For repeat orders, ask: "Would you like to repeat your last order, or specify new quantities?"
- Verify quantities: if the grower says "order more nutrient A", ask how much before proceeding. Offer the previous order quantity as a default.
- To see what products are available for ordering, check the procurement catalog.

SEEDING & GROW GROUPS:
- When a grower says "seed group 1 with Kale" or "I'm seeding all trays in group 1", use update_group_crop to set the crop assignment.
- Always confirm the group name and crop before updating.
- After updating, report the group name, crop, tray count, and seed date.
- Use get_seeding_schedule to show the current week's planting plan.

WHOLESALE PACKING & LABELS:
- Use get_wholesale_packing_list to pull today's orders for labeling/fulfillment.
- Present the packing list in a clear, printable format: one section per order with buyer name, items, quantities, and delivery notes.
- The grower can print this from the chat interface.

QUALITY CONTROL:
- Use get_qc_summary for a consolidated QC dashboard: environment compliance, sensor alerts, nutrient status.
- Flag critical and warning items prominently. Suggest corrective actions for out-of-range readings.
- For image-based QC, the grower can upload photos and you'll diagnose via vision.

SALES & REVENUE:
- Use get_sales_summary for period-based sales reports (today, this week, month-to-date, year-to-date).
- Always include: revenue, order count, top-selling crops, and comparison to prior period.
- Present financial data with clear formatting and CAD currency.

MANUAL INVENTORY MANAGEMENT:
- Some growers manage inventory by weight without using the tray automation system.
- When a grower says "update basil inventory, we have 23 lbs available" or "set tomato stock to 50 lbs":
  1. Parse the crop name and weight in lbs from their message.
  2. If they give weight in oz or kg, convert to lbs (1 kg = 2.205 lbs, 16 oz = 1 lb).
  3. Call update_manual_inventory with crop_name and quantity_lbs.
  4. Report the result: auto lbs (from tray sync) + manual lbs = total available.
- To review current inventory, call get_inventory_summary — it returns both auto and manual quantities.
- The manual_quantity_lbs column is separate from auto_quantity_lbs — they stack (total = auto + manual).
- Manual inventory appears in the wholesale catalog and POS immediately.
- Inventory rows now carry lot_number, quality_score, and best_by_date from the most recent harvest.
- auto_quantity_lbs is recalculated from groups whenever groups are synced (plants * yieldFactor * avgWeight).

IMAGE DIAGNOSIS:
- When a farmer uploads an image, analyse it for: plant species, growth stage, visible issues (nutrient deficiency, pest damage, disease, environmental stress), severity, and recommended corrective action.
- Cross-reference visual diagnosis with the farm's current environment data — if you detect calcium deficiency, check the nutrient dashboard to confirm.

WORKFLOW ORCHESTRATION:
- For complex multi-step requests ("prepare for next quarter", "set up succession planting"), chain multiple tool calls in sequence.
- Show progress as you work: "📊 Step 1/4: Checking current plantings…" then "📈 Step 2/4: Analysing market data…" etc.
- You can now use up to 10 tool calls per turn for complex orchestrations.

RULES:
- Be concise: 2-3 sentences unless the user asks for detail or the question is complex (planning, compatibility, schedule analysis).
- For complex planning questions, a thorough structured answer is better than a short one. Use rich formatting.
- When you call a tool, summarize the result naturally — don't dump raw JSON.
- Use the tools proactively — if a user asks you to do something and you have a tool for it, use the tool. Do not ask the user for information the tools can provide.
- For WRITE operations (update_farm_profile, create_room, create_zone, update_certifications, complete_setup, update_crop_price, create_planting_assignment, mark_harvest_complete, update_order_status, add_inventory_item, update_manual_inventory, dismiss_alert, auto_assign_devices, register_device, seed_benchmarks, update_nutrient_targets, update_target_ranges, set_light_schedule, update_group_crop, create_procurement_order): you MUST describe the proposed change and ask the user to confirm BEFORE calling the tool. Do NOT call write tools until the user says "yes", "confirm", "do it", or similar.
- PROCUREMENT SAFETY: create_procurement_order requires reading back the full order summary (items, quantities, cost) and getting explicit approval. Never place orders without confirmed quantities. Never source from outside the procurement catalog.
- After any WRITE operation succeeds, verify by calling the corresponding read tool and report the confirmed result.
- If you can't help, say so briefly and suggest what you CAN do.
- Use Canadian English (colour, favourite, centre).
- Never fabricate data — only report what tools return.
- Format responses with simple HTML: <strong> for emphasis, <ul>/<li> for lists, <table class="evie-data-table"> for tabular data, <div class="evie-card"> for metric cards. Keep it clean.
- When listing tasks or items, show the top 3-5 most relevant, mention the total count.
- For prices, always show currency (CAD).
- When comparing crops, use tables for clarity.

PLATFORM INTELLIGENCE:
- GreenReach runs a 52-task AI Vision framework across 5 phases -- all COMPLETE. You operate within Phase 5 (Autonomous Operations).
- Key Phase 5 capabilities you power: autonomous recipe adjustment with guardrails (lib/recipe-modifier.js), AI-driven harvest timing with readiness scoring (lib/harvest-predictor.js), voice-first Activity Hub (POST /api/voice/parse-intent), predictive inventory and auto wholesale listing.
- CEA environment reference sources (Cornell lettuce, UF/IFAS hydroponic, Johnny's Seeds timing, basil/arugula/spinach studies, VPD control, light spectrum, EC/pH) are documented in the AI Vision rules. When growers ask about optimal setpoints, your recommendations should align with these peer-reviewed references.
- Architecture documents are available via read_skill_file if needed for diagnostic context. The full AI Vision rules and skills document is at greenreach-central/.github/AI_VISION_RULES_AND_SKILLS.md (readable via read_skill_file with skill_name "ai-vision-rules").

SKILL REFERENCE LIBRARY:
- You have access to peer-reviewed research skill documents via the read_skill_file tool.
- When a farmer asks about environmental management, climate control, equipment placement, lighting effects on humidity/transpiration, sensor data interpretation, dehumidification, airflow, or grow-room design: call read_skill_file with skill_name "environmental-management-control" BEFORE answering.
- When asked about food safety, security, lot tracing, labels, or audit trails: call the relevant skill (security, lot-code-traceability, label-document-generation, record-keeping-audit-trail).
- When asked about social media, marketing, content strategy, posting, social accounts, brand presence, or platform selection: call read_skill_file with skill_name "social-media-marketing" BEFORE answering.
- When asked about device setup, sensor onboarding, adding new devices, pairing sensors, BLE setup, SwitchBot configuration, device discovery, or IoT integration: call read_skill_file with skill_name "device-setup-onboarding" BEFORE answering.
- Skill documents contain research-backed principles and frameworks. Use them to ground your recommendations in published evidence, not guesswork.
- Do NOT summarise the entire skill document to the user. Extract the specific principles and research that apply to their question.`;
}

// ── Tool Execution Layer ──────────────────────────────────────────────
// Tools that need DB access and aren't in farm-ops-agent TOOL_CATALOG
async function executeExtendedTool(toolName, params, farmId) {
  // First check if it's in the standard catalog
  if (TOOL_CATALOG[toolName]) {
    return await executeTool(toolName, params);
  }

  const pool = getDatabase();

  switch (toolName) {
    case 'get_market_intelligence': {
      const results = {};
      try {
        const marketData = await getMarketDataAsync(pool);
        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const cropFilter = params.crop?.toLowerCase();
        for (const [product, data] of Object.entries(marketData)) {
          if (cropFilter && !product.toLowerCase().includes(cropFilter)) continue;
          const ai = aiMap[product] || null;
          results[product] = {
            trend: data.trend,
            trendPercent: data.trendPercent,
            latestPrice: data.latestPrice,
            unit: data.unit,
            observationCount: data.observationCount,
            aiOutlook: ai?.outlook || null,
            aiAction: ai?.action || null,
            aiConfidence: ai?.confidence || null,
            aiReasoning: ai?.reasoning || null
          };
        }
      } catch (err) {
        return { ok: false, error: err.message };
      }
      return { ok: true, crops: results, count: Object.keys(results).length };
    }

    case 'get_pricing_info': {
      try {
        const pricing = await getCropPricing(farmId);
        return { ok: true, crops: pricing, count: pricing.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_planting_recommendations': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing(farmId);

        let currentAssignments = [];
        if (isDatabaseAvailable()) {
          try {
            const result = await query(
              'SELECT crop_sku, COUNT(*) as count FROM planting_assignments WHERE farm_id = $1 GROUP BY crop_sku',
              [farmId]
            );
            currentAssignments = result.rows || [];
          } catch { /* ok */ }
        }

        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const totalAssigned = currentAssignments.reduce((sum, a) => sum + parseInt(a.count, 10), 0) || 1;
        const recommendations = [];

        for (const [product, data] of Object.entries(marketData)) {
          const ai = aiMap[product] || null;
          const pricingMatch = cropPricing.find(c =>
            c.crop.toLowerCase().includes(product.toLowerCase()) ||
            product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
          );
          if (!pricingMatch) continue;

          const currentCount = parseInt(currentAssignments.find(a => a.crop_sku === pricingMatch.crop)?.count || 0, 10);

          let trendScore = 50;
          if (data.trend === 'increasing') trendScore = 50 + Math.min(data.trendPercent, 50);
          else if (data.trend === 'decreasing') trendScore = Math.max(50 - Math.abs(data.trendPercent), 0);

          let aiScore = 50;
          if (ai?.outlook === 'bullish') aiScore = 80;
          else if (ai?.outlook === 'bearish') aiScore = 20;
          if (ai?.action === 'increase_production') aiScore = Math.min(aiScore + 15, 100);
          else if (ai?.action === 'reduce_production') aiScore = Math.max(aiScore - 15, 0);

          const marginScore = Math.min((pricingMatch.wholesalePrice || 0) / 15 * 100, 100);

          const cropShare = currentCount / totalAssigned;
          let diversityScore = 100;
          if (currentCount > 0) diversityScore = Math.max(100 - cropShare * 200, 10);

          const composite = Math.round(
            trendScore * 0.30 + aiScore * 0.25 + marginScore * 0.20 + diversityScore * 0.25
          );

          const reasons = [];
          if (data.trend === 'increasing' && data.trendPercent >= 5) reasons.push(`prices up ${data.trendPercent}%`);
          if (ai?.outlook === 'bullish') reasons.push('AI outlook bullish');
          if (ai?.action === 'increase_production') reasons.push('AI recommends increasing production');
          if (currentCount === 0) reasons.push('not currently growing — diversification opportunity');
          else if (cropShare > 0.3) reasons.push(`${Math.round(cropShare * 100)}% of capacity — over-concentrated`);
          if (pricingMatch.wholesalePrice >= 10) reasons.push(`strong margin ($${pricingMatch.wholesalePrice}/unit)`);

          const priority = composite >= 70 ? 'high' : composite >= 45 ? 'medium' : 'low';

          recommendations.push({
            crop: pricingMatch.crop, priority, score: composite,
            reasoning: ai?.reasoning || reasons.join('; ') || `Composite score ${composite}`,
            marketTrend: data.trend, trendPercent: data.trendPercent,
            currentlyGrowing: currentCount, confidence: ai?.confidence || (data.observationCount >= 10 ? 'high' : 'medium'),
            aiOutlook: ai?.outlook || null, aiAction: ai?.action || null,
          });
        }

        return { ok: true, recommendations: recommendations.sort((a, b) => b.score - a.score), generatedAt: new Date().toISOString() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_demand_forecast': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing(farmId);

        let aiAnalyses = [];
        let demandSignals = {};
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        try { demandSignals = await analyzeDemandPatterns() || {}; } catch { /* ok */ }

        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const forecast = [];
        for (const [product, data] of Object.entries(marketData)) {
          const pricingMatch = cropPricing.find(c =>
            c.crop.toLowerCase().includes(product.toLowerCase()) ||
            product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
          );
          const ai = aiMap[product] || null;
          const demand = demandSignals[product] || null;

          let confidence = 'medium';
          if (ai?.confidence) confidence = ai.confidence;
          else if (data.observationCount >= 20) confidence = 'high';
          else if ((data.observationCount || 0) < 5) confidence = 'low';

          forecast.push({
            product, trendPercent: data.trendPercent, trend: data.trend, confidence,
            reasoning: ai?.reasoning || `Market trend: ${data.trend}`,
            pricePerUnit: pricingMatch?.wholesalePrice || null,
            priceCAD: data.avgPriceCAD || null,
            aiOutlook: ai?.outlook || null, aiAction: ai?.action || null,
            aiForecastPrice: ai?.price_forecast ? parseFloat(ai.price_forecast) : null,
            wholesaleDemand: demand ? {
              totalQty: demand.network_total_qty,
              orderCount: demand.network_order_count,
              trend: demand.network_trend,
            } : null,
            dataSource: data.dataSource || 'hardcoded',
          });
        }

        const averageTrend = forecast.length > 0
          ? Math.round((forecast.reduce((s, f) => s + f.trendPercent, 0) / forecast.length) * 10) / 10
          : 0;

        return {
          ok: true,
          forecast: forecast.sort((a, b) => Math.abs(b.trendPercent) - Math.abs(a.trendPercent)),
          averageTrend,
          generatedAt: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Crop Schedule / Recipe Tool ──
    case 'get_crop_schedule': {
      try {
        const resolved = cropUtils.normalizeCropName(params.crop) || params.crop;
        // Find recipe by exact match or substring
        const recipeKey = Object.keys(LIGHTING_RECIPES).find(k =>
          k.toLowerCase() === resolved.toLowerCase() ||
          k.toLowerCase().includes(resolved.toLowerCase()) ||
          resolved.toLowerCase().includes(k.toLowerCase())
        );
        if (!recipeKey || !LIGHTING_RECIPES[recipeKey]) {
          return { ok: false, error: `No growth recipe found for "${params.crop}". Available crops: ${Object.keys(LIGHTING_RECIPES).slice(0, 15).join(', ')}…` };
        }
        const days = LIGHTING_RECIPES[recipeKey];
        const totalDays = days.length;

        // Build stage summary
        const stageMap = {};
        for (const d of days) {
          const stage = d.stage || 'Unknown';
          if (!stageMap[stage]) stageMap[stage] = { days: 0, avgDLI: 0, avgPPFD: 0, avgEC: 0, avgPH: 0, avgTemp: 0, avgVPD: 0, maxHumidity: 0 };
          const s = stageMap[stage];
          s.days++;
          s.avgDLI += (d.dli || 0);
          s.avgPPFD += (d.ppfd || 0);
          s.avgEC += (d.ec || 0);
          s.avgPH += (d.ph || 0);
          s.avgTemp += (d.temperature || 0);
          s.avgVPD += (d.vpd || 0);
          s.maxHumidity = Math.max(s.maxHumidity, d.max_humidity || 0);
        }
        const stages = {};
        for (const [name, s] of Object.entries(stageMap)) {
          stages[name] = {
            days: s.days,
            dli: +(s.avgDLI / s.days).toFixed(1),
            ppfd: Math.round(s.avgPPFD / s.days),
            ec: +(s.avgEC / s.days).toFixed(2),
            ph: +(s.avgPH / s.days).toFixed(1),
            temp_c: +(s.avgTemp / s.days).toFixed(1),
            vpd: +(s.avgVPD / s.days).toFixed(2),
            max_humidity: s.maxHumidity
          };
        }

        // Registry enrichment
        const crops = CROP_REGISTRY.crops || {};
        const regEntry = crops[resolved] || crops[recipeKey] || null;
        const growth = regEntry?.growth || {};

        const result = {
          ok: true, crop: recipeKey, resolved_name: resolved,
          total_days: totalDays, stages,
          harvest_strategy: growth.harvestStrategy || null,
          max_harvests: growth.maxHarvests || null,
          regrowth_days: growth.regrowthDays || null,
          category: regEntry?.category || null,
          nutrient_profile: regEntry?.nutrientProfile || null
        };

        if (!params.summary_only && params.summary_only !== undefined) {
          result.daily_schedule = days; // full day-by-day (only if explicitly requested)
        }

        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Crop Compatibility Analysis Tool ──
    case 'get_crop_compatibility': {
      try {
        const cropNames = params.crops.split(',').map(c => c.trim()).filter(Boolean);
        if (cropNames.length < 2) return { ok: false, error: 'Provide at least 2 crops to compare.' };

        const profiles = [];
        for (const name of cropNames) {
          const resolved = cropUtils.normalizeCropName(name) || name;
          const recipeKey = Object.keys(LIGHTING_RECIPES).find(k =>
            k.toLowerCase() === resolved.toLowerCase() ||
            k.toLowerCase().includes(resolved.toLowerCase()) ||
            resolved.toLowerCase().includes(k.toLowerCase())
          );
          if (!recipeKey) {
            profiles.push({ name: resolved, found: false });
            continue;
          }
          const days = LIGHTING_RECIPES[recipeKey];
          // Compute averages across the whole schedule
          const avg = { dli: 0, ppfd: 0, ec: 0, ph: 0, temp: 0, vpd: 0, humidity: 0 };
          for (const d of days) {
            avg.dli += (d.dli || 0); avg.ppfd += (d.ppfd || 0); avg.ec += (d.ec || 0);
            avg.ph += (d.ph || 0); avg.temp += (d.temperature || 0); avg.vpd += (d.vpd || 0);
            avg.humidity += (d.max_humidity || 0);
          }
          const n = days.length || 1;
          profiles.push({
            name: resolved, found: true, recipeName: recipeKey, totalDays: days.length,
            avg: { dli: +(avg.dli/n).toFixed(1), ppfd: Math.round(avg.ppfd/n),
                   ec: +(avg.ec/n).toFixed(2), ph: +(avg.ph/n).toFixed(1),
                   temp: +(avg.temp/n).toFixed(1), vpd: +(avg.vpd/n).toFixed(2),
                   humidity: Math.round(avg.humidity/n) }
          });
        }

        const found = profiles.filter(p => p.found);
        if (found.length < 2) return { ok: false, error: `Could not find recipes for enough crops. Found: ${found.map(p=>p.name).join(', ')}` };

        // Compute pairwise compatibility scores
        function dimScore(vals, tolerance) {
          const range = Math.max(...vals) - Math.min(...vals);
          return Math.max(0, Math.round(100 - (range / tolerance) * 100));
        }
        const dlis = found.map(p => p.avg.dli);
        const ecs = found.map(p => p.avg.ec);
        const phs = found.map(p => p.avg.ph);
        const temps = found.map(p => p.avg.temp);
        const vpds = found.map(p => p.avg.vpd);
        const durations = found.map(p => p.totalDays);

        const lightCompat = dimScore(dlis, 10);       // 10 mol/m²/d tolerance
        const nutrientCompat = Math.round((dimScore(ecs, 1.5) + dimScore(phs, 1.0)) / 2);
        const envCompat = Math.round((dimScore(temps, 5) + dimScore(vpds, 0.6)) / 2);
        const harvestAlign = dimScore(durations, 20);  // 20-day tolerance

        const overall = Math.round(lightCompat * 0.30 + nutrientCompat * 0.25 + envCompat * 0.25 + harvestAlign * 0.20);

        const conflicts = [];
        if (lightCompat < 50) conflicts.push(`Light needs differ significantly (DLI range: ${Math.min(...dlis)}-${Math.max(...dlis)} mol/m²/d)`);
        if (nutrientCompat < 50) conflicts.push(`Nutrient needs differ (EC range: ${Math.min(...ecs)}-${Math.max(...ecs)} dS/m)`);
        if (envCompat < 50) conflicts.push(`Environment preferences differ (temp range: ${Math.min(...temps)}-${Math.max(...temps)}°C)`);
        if (harvestAlign < 40) conflicts.push(`Harvest timing misaligned (${Math.min(...durations)}-${Math.max(...durations)} day cycles)`);

        const verdict = overall >= 75 ? 'excellent' : overall >= 55 ? 'good' : overall >= 35 ? 'marginal' : 'poor';

        return {
          ok: true, crops: found.map(p => ({ name: p.name, totalDays: p.totalDays, avgDLI: p.avg.dli, avgEC: p.avg.ec, avgTemp: p.avg.temp })),
          compatibility: { overall, verdict, light: lightCompat, nutrient: nutrientCompat, environment: envCompat, harvest_alignment: harvestAlign },
          conflicts, suggestion: conflicts.length === 0 ? 'These crops can share the same zone effectively.' : 'Consider separating crops with conflicting needs into different zones.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Comprehensive Planning Recommendation Tool ──
    case 'get_planning_recommendation': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing(farmId);
        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        // Current farm assignments
        let currentAssignments = [];
        if (isDatabaseAvailable()) {
          try {
            const result = await query(
              'SELECT crop_name, crop_id, COUNT(*) as count FROM planting_assignments WHERE farm_id = $1 AND status = \'active\' GROUP BY crop_name, crop_id',
              [farmId]
            );
            currentAssignments = result.rows || [];
          } catch { /* ok */ }
        }

        const excludeSet = new Set((params.exclude || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean));
        const currentCrops = new Set(currentAssignments.map(a => a.crop_name?.toLowerCase()));
        const totalAssigned = currentAssignments.reduce((s, a) => s + parseInt(a.count, 10), 0) || 1;

        const recommendations = [];
        const crops = CROP_REGISTRY.crops || {};

        for (const [cropName, info] of Object.entries(crops)) {
          if (!info.active) continue;
          if (excludeSet.has(cropName.toLowerCase())) continue;

          const marketKey = info.market?.resolveAs || cropName;
          const mkt = marketData[marketKey] || null;
          const ai = aiMap[marketKey] || null;
          const growth = info.growth || {};
          const pricing = info.pricing || {};
          const recipeKey = Object.keys(LIGHTING_RECIPES).find(k =>
            k.toLowerCase() === cropName.toLowerCase() || k.toLowerCase().includes(cropName.split(' ')[0].toLowerCase())
          );
          const recipe = recipeKey ? LIGHTING_RECIPES[recipeKey] : null;

          // Scoring dimensions
          const scores = {};

          // 1. Market gap / local unavailability (proxy: high price or increasing trend)
          scores.marketGap = 50;
          if (mkt?.trend === 'increasing' && mkt.trendPercent >= 5) scores.marketGap = 70 + Math.min(mkt.trendPercent, 30);
          else if (mkt?.trend === 'decreasing') scores.marketGap = Math.max(30, 50 - Math.abs(mkt.trendPercent));
          if (ai?.outlook === 'bullish') scores.marketGap = Math.min(scores.marketGap + 15, 100);

          // 2. Revenue / margin
          const retailPrice = growth.retailPricePerLb || 0;
          scores.revenue = Math.min(100, retailPrice * 3);

          // 3. Seasonal opportunity (indoor advantage in winter/shoulder months)
          const month = new Date().getMonth();
          const isWinter = month >= 10 || month <= 2;
          const category = (info.category || '').toLowerCase();
          scores.seasonal = 50;
          if (isWinter && ['herbs', 'leafy_greens', 'lettuce', 'microgreen'].includes(category)) scores.seasonal = 80;
          if (isWinter && ['tomato', 'strawberry', 'pepper'].includes(category)) scores.seasonal = 90;

          // 4. Diversification
          const isGrowing = currentCrops.has(cropName.toLowerCase());
          scores.diversification = isGrowing ? 30 : 85;
          const catCount = currentAssignments.filter(a => {
            const regEntry = crops[a.crop_name];
            return regEntry && regEntry.category === info.category;
          }).length;
          if (catCount / totalAssigned > 0.4) scores.diversification = Math.max(scores.diversification - 20, 0);

          // 5. Quick turn / harvest cadence
          const daysToHarvest = growth.daysToHarvest || (recipe?.length) || 30;
          scores.quickTurn = daysToHarvest <= 14 ? 95 : daysToHarvest <= 25 ? 80 : daysToHarvest <= 40 ? 60 : 40;
          if (growth.harvestStrategy === 'cut_and_come_again') scores.quickTurn = Math.min(scores.quickTurn + 15, 100);

          // 6. Companion group potential (how many existing crops it's compatible with)
          scores.companionFit = 60;
          if (recipe && currentAssignments.length > 0) {
            let compatSum = 0; let compatCount = 0;
            for (const a of currentAssignments) {
              const otherKey = Object.keys(LIGHTING_RECIPES).find(k =>
                k.toLowerCase().includes((a.crop_name || '').split(' ')[0].toLowerCase())
              );
              if (!otherKey) continue;
              const otherDays = LIGHTING_RECIPES[otherKey];
              const avgEC = recipe.reduce((s,d) => s + (d.ec||0), 0) / recipe.length;
              const otherEC = otherDays.reduce((s,d) => s + (d.ec||0), 0) / otherDays.length;
              const ecGap = Math.abs(avgEC - otherEC);
              compatSum += ecGap < 0.5 ? 90 : ecGap < 1.0 ? 70 : 40;
              compatCount++;
            }
            if (compatCount > 0) scores.companionFit = Math.round(compatSum / compatCount);
          }

          // Focus filter
          if (params.focus) {
            const f = params.focus.toLowerCase().replace(/[^a-z]/g, '');
            if (f === 'marketgaps' && scores.marketGap < 60) continue;
            if (f === 'highmargin' && scores.revenue < 60) continue;
            if (f === 'quickturn' && scores.quickTurn < 70) continue;
            if (f === 'seasonal' && scores.seasonal < 65) continue;
            if (f === 'diversification' && scores.diversification < 50) continue;
          }

          const composite = Math.round(
            scores.marketGap * 0.20 + scores.revenue * 0.15 + scores.seasonal * 0.12 +
            scores.diversification * 0.18 + scores.quickTurn * 0.12 + scores.companionFit * 0.10 +
            (ai?.action === 'increase_production' ? 13 : 0)
          );

          const reasons = [];
          if (scores.marketGap >= 70) reasons.push(mkt?.trend === 'increasing' ? `market prices up ${mkt.trendPercent}%` : 'strong market demand');
          if (scores.seasonal >= 75) reasons.push('winter premium — hard to source locally');
          if (scores.revenue >= 70) reasons.push(`premium crop ($${retailPrice.toFixed(2)}/lb)`);
          if (!isGrowing) reasons.push('diversification — not currently growing');
          if (scores.quickTurn >= 80) reasons.push(`fast turn (${daysToHarvest}d)`);
          if (growth.harvestStrategy === 'cut_and_come_again') reasons.push('multi-harvest — cut and come again');
          if (ai?.outlook === 'bullish') reasons.push('AI outlook bullish');

          recommendations.push({
            crop: cropName, score: composite, category: info.category,
            daysToHarvest, scores, reasons: reasons.join('; '),
            isCurrentlyGrowing: isGrowing
          });
        }

        recommendations.sort((a, b) => b.score - a.score);

        return {
          ok: true,
          recommendations: recommendations.slice(0, 15),
          totalCandidates: recommendations.length,
          currentlyGrowing: currentAssignments.map(a => a.crop_name),
          focus: params.focus || 'all',
          generatedAt: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Batch Planting Plan Tool ──
    case 'create_planting_plan': {
      try {
        const pool = getDatabase();
        const targetDate = params.target_date;
        if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
          return { ok: false, error: 'target_date is required (YYYY-MM-DD)' };
        }
        const theFarmId = params.farm_id || farmId;
        const excludeSet = new Set((params.exclude || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean));
        const focus = (params.focus || 'balanced').toLowerCase();

        // 1. Current assignments
        let currentAssignments = [];
        if (isDatabaseAvailable()) {
          try {
            const result = await query(
              `SELECT group_id, crop_name, seed_date, harvest_date, status FROM planting_assignments WHERE farm_id = $1 AND status = 'active' ORDER BY harvest_date ASC`,
              [theFarmId]
            );
            currentAssignments = result.rows || [];
          } catch { /* ok */ }
        }

        // 2. Current groups/capacity
        const groups = await farmStore.get(theFarmId, 'groups') || [];
        const occupiedGroups = new Set(currentAssignments.map(a => a.group_id));
        const freeGroups = groups.filter(g => !occupiedGroups.has(g.id || g.group_id));

        // 3. Zones freeing up around target date (harvest within 14 days before target)
        const targetMs = new Date(targetDate + 'T00:00:00').getTime();
        const freeingUp = currentAssignments.filter(a => {
          if (!a.harvest_date) return false;
          const hd = new Date(a.harvest_date).getTime();
          return hd >= targetMs - 14 * 86400000 && hd <= targetMs + 7 * 86400000;
        });

        // Total available zones = free now + freeing up near target date
        const availableZones = [
          ...freeGroups.map(g => ({ group_id: g.id || g.group_id, name: g.name || g.id, source: 'empty' })),
          ...freeingUp.map(a => ({ group_id: a.group_id, currentCrop: a.crop_name, harvestDate: new Date(a.harvest_date).toISOString().split('T')[0], source: 'freeing_up' }))
        ];

        const numZones = params.num_zones || availableZones.length || 3;

        // 4. Get recommendations (reuse planning logic)
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing(farmId);
        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const currentCropNames = new Set(currentAssignments.map(a => (a.crop_name || '').toLowerCase()));
        const crops = CROP_REGISTRY.crops || {};
        const candidates = [];

        for (const [cropName, info] of Object.entries(crops)) {
          if (!info.active) continue;
          if (excludeSet.has(cropName.toLowerCase())) continue;
          const growth = info.growth || {};
          const recipeKey = Object.keys(LIGHTING_RECIPES).find(k =>
            k.toLowerCase() === cropName.toLowerCase() || k.toLowerCase().includes(cropName.split(' ')[0].toLowerCase())
          );
          const recipe = recipeKey ? LIGHTING_RECIPES[recipeKey] : null;
          const totalDays = recipe?.length || growth.daysToHarvest || 30;
          const harvestDate = new Date(new Date(targetDate + 'T00:00:00').getTime() + totalDays * 86400000).toISOString().split('T')[0];

          const marketKey = info.market?.resolveAs || cropName;
          const mkt = marketData[marketKey] || null;
          const ai = aiMap[marketKey] || null;
          const pricing = info.pricing || {};
          const retailPrice = growth.retailPricePerLb || pricing.retailPrice || 0;

          // Score (simplified from planning recommendation)
          let score = 50;
          if (mkt?.trend === 'increasing') score += Math.min(mkt.trendPercent, 20);
          if (ai?.outlook === 'bullish') score += 10;
          if (ai?.action === 'increase_production') score += 8;
          if (retailPrice >= 15) score += 15;
          else if (retailPrice >= 8) score += 8;
          if (!currentCropNames.has(cropName.toLowerCase())) score += 12;
          if (totalDays <= 21) score += 10;
          else if (totalDays <= 35) score += 5;
          if (growth.harvestStrategy === 'cut_and_come_again') score += 8;

          // Focus adjustments
          if (focus === 'high-margin' && retailPrice < 8) continue;
          if (focus === 'quick-turn' && totalDays > 30) continue;
          if (focus === 'diversification' && currentCropNames.has(cropName.toLowerCase())) continue;

          const reasons = [];
          if (mkt?.trend === 'increasing' && mkt.trendPercent >= 5) reasons.push(`prices up ${mkt.trendPercent}%`);
          if (ai?.outlook === 'bullish') reasons.push('AI outlook bullish');
          if (!currentCropNames.has(cropName.toLowerCase())) reasons.push('diversification');
          if (retailPrice >= 12) reasons.push(`premium ($${retailPrice.toFixed(2)}/lb)`);
          if (totalDays <= 21) reasons.push(`fast turn (${totalDays}d)`);
          if (growth.harvestStrategy === 'cut_and_come_again') reasons.push('multi-harvest');

          candidates.push({ crop: cropName, score, totalDays, harvestDate, category: info.category, reasons: reasons.join('; ') });
        }

        candidates.sort((a, b) => b.score - a.score);

        // 5. Assign top candidates to available zones (avoid category bunching)
        const plan = [];
        const usedCategories = {};
        let candidateIdx = 0;

        for (let i = 0; i < Math.min(numZones, availableZones.length) && candidateIdx < candidates.length; i++) {
          const zone = availableZones[i];

          // For succession focus, stagger same crop across zones
          if (focus === 'succession' && candidates.length > 0) {
            const crop = candidates[0];
            const staggerDays = i * 7;
            const staggeredSeedDate = new Date(new Date(targetDate + 'T00:00:00').getTime() + staggerDays * 86400000).toISOString().split('T')[0];
            const staggeredHarvestDate = new Date(new Date(staggeredSeedDate + 'T00:00:00').getTime() + crop.totalDays * 86400000).toISOString().split('T')[0];
            plan.push({
              zone: zone.group_id, zone_source: zone.source, zone_detail: zone.currentCrop ? `${zone.currentCrop} harvests ${zone.harvestDate}` : 'empty',
              crop: crop.crop, seed_date: staggeredSeedDate, harvest_date: staggeredHarvestDate,
              grow_days: crop.totalDays, category: crop.category, score: crop.score, reasons: crop.reasons + '; staggered ' + staggerDays + 'd'
            });
            continue;
          }

          // Pick next candidate, slightly penalising repeated categories for diversity
          let picked = null;
          for (let j = candidateIdx; j < candidates.length; j++) {
            const c = candidates[j];
            if ((usedCategories[c.category] || 0) >= 2 && j < candidates.length - 1) continue; // skip if 2+ of same category already picked
            picked = c;
            candidateIdx = j + 1;
            break;
          }
          if (!picked) { picked = candidates[candidateIdx++]; }
          if (!picked) break;

          usedCategories[picked.category] = (usedCategories[picked.category] || 0) + 1;

          // Use zone's harvest date as seed date if zone is freeing up
          const seedDate = zone.source === 'freeing_up' && zone.harvestDate ? zone.harvestDate : targetDate;
          const harvestDate = new Date(new Date(seedDate + 'T00:00:00').getTime() + picked.totalDays * 86400000).toISOString().split('T')[0];

          plan.push({
            zone: zone.group_id, zone_source: zone.source, zone_detail: zone.currentCrop ? `${zone.currentCrop} harvests ${zone.harvestDate}` : 'empty',
            crop: picked.crop, seed_date: seedDate, harvest_date: harvestDate,
            grow_days: picked.totalDays, category: picked.category, score: picked.score, reasons: picked.reasons
          });
        }

        return {
          ok: true,
          target_date: targetDate,
          focus,
          plan,
          zones_available: availableZones.length,
          zones_planned: plan.length,
          current_assignments: currentAssignments.length,
          freeing_up: freeingUp.length,
          note: 'This is a proposed plan. Confirm to execute each assignment.',
          generatedAt: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'save_user_memory': {
      try {
        const { key, value } = params;
        if (!key || !value) return { ok: false, error: 'key and value are required' };
        const saved = await saveUserMemory(farmId, key, value);
        return { ok: saved, key, value, message: saved ? `Remembered: ${key} = ${value}` : 'Failed to save' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_farm_profile': {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await query(
          `SELECT farm_id, name, farm_type, contact_name, contact_phone, email,
                  plan_type, status, city, state, location, setup_completed, created_at
           FROM farms WHERE farm_id = $1`,
          [farmId]
        );
        if (result.rows.length === 0) return { ok: false, error: 'Farm not found' };
        const f = result.rows[0];
        return {
          ok: true,
          profile: {
            farm_id: f.farm_id,
            name: f.name,
            farm_type: f.farm_type,
            contact_name: f.contact_name || '',
            contact_phone: f.contact_phone || '',
            email: f.email || '',
            plan_type: f.plan_type || 'cloud',
            status: f.status,
            city: f.city || '',
            state: f.state || '',
            setup_completed: f.setup_completed || false,
            created_at: f.created_at
          }
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'update_farm_profile': {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const { name, contactName, email, phone, website, city, province, timezone } = params;
        const updates = [];
        const values = [];
        let p = 1;
        if (name) { updates.push(`name = $${p++}`); values.push(name); }
        if (contactName) { updates.push(`contact_name = $${p++}`); values.push(contactName); }
        if (email) { updates.push(`email = $${p++}`); values.push(email); }
        if (phone) { updates.push(`contact_phone = $${p++}`); values.push(phone); }
        if (city) { updates.push(`city = $${p++}`); values.push(city); }
        if (province) { updates.push(`state = $${p++}`); values.push(province); }
        if (timezone) { updates.push(`timezone = $${p++}`); values.push(timezone); }
        if (updates.length === 0) return { ok: false, error: 'At least one field is required' };
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(farmId);
        await query(`UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $${p}`, values);
        // Also update farmStore profile for website field
        if (website) {
          try {
            const profile = await farmStore.get(farmId, 'farm_profile') || {};
            profile.website = website;
            await farmStore.set(farmId, 'farm_profile', profile);
          } catch { /* non-fatal */ }
        }
        return { ok: true, message: 'Farm profile updated', updated_fields: Object.keys(params).filter(k => params[k]) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'create_room': {
      try {
        const { name, type, capacity } = params;
        if (!name) return { ok: false, error: 'Room name is required' };
        // Get existing rooms from farmStore and append
        const existing = await farmStore.get(farmId, 'rooms') || [];
        const newRoom = {
          room_id: `room-${Date.now()}`,
          farm_id: farmId,
          name,
          type: type || 'grow',
          capacity: capacity || null
        };
        existing.push(newRoom);
        await farmStore.set(farmId, 'rooms', existing);
        // Also try DB insert
        if (isDatabaseAvailable()) {
          try {
            await query(
              'INSERT INTO rooms (farm_id, name, type, capacity, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) ON CONFLICT DO NOTHING',
              [farmId, name, type || 'grow', capacity || null]
            );
          } catch { /* non-fatal — farmStore is source of truth */ }
        }
        return { ok: true, room: newRoom, message: `Room "${name}" created`, total_rooms: existing.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'list_rooms': {
      try {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        return { ok: true, rooms, count: rooms.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'create_zone': {
      try {
        const { room_id, name, capacity } = params;
        if (!room_id || !name) return { ok: false, error: 'room_id and name are required' };
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        const room = rooms.find(r => r.room_id === room_id);
        if (!room) return { ok: false, error: `Room ${room_id} not found. Use list_rooms to see available rooms.` };
        if (!room.zones) room.zones = [];
        const newZone = { id: `zone-${room.zones.length + 1}`, name, capacity: capacity || null };
        room.zones.push(newZone);
        await farmStore.set(farmId, 'rooms', rooms);
        return { ok: true, zone: newZone, room_name: room.name, message: `Zone "${name}" added to ${room.name}`, total_zones: room.zones.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'update_certifications': {
      try {
        const { certifications, practices, attributes } = params;
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        const updatedCerts = {
          certifications: certifications || profile.certifications?.certifications || [],
          practices: practices || profile.certifications?.practices || [],
          attributes: attributes || profile.certifications?.attributes || []
        };
        profile.certifications = updatedCerts;
        await farmStore.set(farmId, 'farm_profile', profile);
        // Also update DB if available
        if (isDatabaseAvailable()) {
          try {
            await query('UPDATE farms SET certifications = $1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $2',
              [JSON.stringify(updatedCerts.certifications), farmId]);
          } catch { /* non-fatal */ }
        }
        return { ok: true, certifications: updatedCerts, message: 'Certifications updated' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_onboarding_status': {
      try {
        // Check key setup milestones
        let profile = {};
        let roomCount = 0;
        let hasContact = false;
        let setupDone = false;
        if (isDatabaseAvailable()) {
          try {
            const r = await query('SELECT name, contact_name, email, setup_completed FROM farms WHERE farm_id = $1', [farmId]);
            if (r.rows.length > 0) {
              hasContact = !!r.rows[0].contact_name;
              setupDone = r.rows[0].setup_completed === true;
            }
          } catch { /* non-fatal */ }
        }
        try {
          profile = await farmStore.get(farmId, 'farm_profile') || {};
          const rooms = await farmStore.get(farmId, 'rooms') || [];
          roomCount = rooms.length;
          if (!setupDone && profile.setup_completed) setupDone = true;
          if (!hasContact && profile.contact?.name) hasContact = true;
        } catch { /* non-fatal */ }
        const groups = await farmStore.get(farmId, 'groups') || [];
        const tasks = [
          { step: 'Farm Profile', done: hasContact, hint: 'Set farm name and contact info with update_farm_profile' },
          { step: 'Grow Rooms', done: roomCount > 0, hint: 'Create at least one room with create_room' },
          { step: 'Zones', done: roomCount > 0 && groups.length > 0, hint: 'Add zones to rooms with create_zone, or groups will create zones automatically' },
          { step: 'Certifications', done: !!profile.certifications, hint: 'Optional — set with update_certifications' },
          { step: 'Benchmarks', done: groups.length > 0, hint: 'Seed crop benchmarks with seed_benchmarks' },
          { step: 'Setup Complete', done: setupDone, hint: 'Finalize with complete_setup' }
        ];
        const completed = tasks.filter(t => t.done).length;
        return { ok: true, tasks, completed, total: tasks.length, all_done: completed === tasks.length, setup_completed: setupDone };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'complete_setup': {
      try {
        // Mark setup as complete in both DB and farmStore
        if (isDatabaseAvailable()) {
          await query(
            'UPDATE farms SET setup_completed = true, setup_completed_at = COALESCE(setup_completed_at, NOW()), updated_at = NOW() WHERE farm_id = $1',
            [farmId]
          );
        }
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        profile.setup_completed = true;
        profile.setup_completed_at = profile.setup_completed_at || new Date().toISOString();
        await farmStore.set(farmId, 'farm_profile', profile);
        return { ok: true, message: 'Setup wizard marked complete! The farm is ready for operations.' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Setup Agent Intelligence Tools ──
    case 'get_setup_progress': {
      try {
        const { default: setupAgentRouter } = await import('./setup-agent.js');
        // Reuse the same evaluation logic from setup-agent.js
        const PHASES = [
          'farm_profile', 'grow_rooms', 'zones', 'groups',
          'lights', 'schedules', 'devices', 'integrations'
        ];
        const PHASE_LABELS = {
          farm_profile: 'Farm Profile', grow_rooms: 'Grow Rooms', zones: 'Climate Zones',
          groups: 'Grow Groups', lights: 'Light Fixtures', schedules: 'Light Schedules',
          devices: 'IoT Devices', integrations: 'Integrations'
        };

        // Inline evaluation to avoid circular dependency
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        const groups = await farmStore.get(farmId, 'groups') || [];

        const zonesSet = new Set();
        groups.forEach(g => { if (g.zone || g.zone_name) zonesSet.add(g.zone || g.zone_name); });
        rooms.forEach(r => { if (r.zones) r.zones.forEach(z => zonesSet.add(z.name || z)); });

        let totalLights = 0;
        let withSchedule = 0;
        groups.forEach(g => {
          if (g.lights && Array.isArray(g.lights)) totalLights += g.lights.length;
          if (g.light || g.light_id) totalLights++;
          if (g.schedule || g.light_schedule || (g.schedules && g.schedules.length > 0)) withSchedule++;
        });

        const devices = profile.devices || [];
        const integrations = profile.integrations || {};
        const configuredIntegrations = Object.entries(integrations).filter(([, v]) => {
          if (typeof v === 'object' && v !== null) return v.token || v.api_key || v.enabled;
          return !!v;
        });

        const phases = [
          { id: 'farm_profile', complete: !!(profile.name || profile.farm_name) && !!(profile.contact?.name || profile.contact_name), detail: (profile.name || profile.farm_name) || 'Not configured' },
          { id: 'grow_rooms', complete: rooms.length > 0, detail: `${rooms.length} room${rooms.length !== 1 ? 's' : ''}` },
          { id: 'zones', complete: zonesSet.size > 0, detail: `${zonesSet.size} zone${zonesSet.size !== 1 ? 's' : ''}` },
          { id: 'groups', complete: groups.length > 0, detail: `${groups.length} group${groups.length !== 1 ? 's' : ''}` },
          { id: 'lights', complete: totalLights > 0, detail: `${totalLights} fixture${totalLights !== 1 ? 's' : ''}` },
          { id: 'schedules', complete: withSchedule > 0, detail: `${withSchedule} schedule${withSchedule !== 1 ? 's' : ''}` },
          { id: 'devices', complete: devices.length > 0, detail: `${devices.length} device${devices.length !== 1 ? 's' : ''}` },
          { id: 'integrations', complete: configuredIntegrations.length > 0, detail: `${configuredIntegrations.length} integration${configuredIntegrations.length !== 1 ? 's' : ''}` }
        ].map(p => ({ ...p, label: PHASE_LABELS[p.id] }));

        const completedCount = phases.filter(p => p.complete).length;
        const percentage = Math.round((completedCount / phases.length) * 100);
        const nextPhase = phases.find(p => !p.complete);

        return {
          ok: true,
          percentage,
          completed: completedCount,
          total: phases.length,
          phases,
          next_phase: nextPhase ? nextPhase.label : null,
          next_phase_id: nextPhase ? nextPhase.id : null,
          all_complete: completedCount === phases.length
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_setup_guidance': {
      try {
        const phase = params.phase;
        const GUIDANCE = {
          farm_profile: {
            title: 'Farm Profile Setup',
            steps: [
              'Set farm name using update_farm_profile',
              'Add contact info (name, phone, email) using update_farm_profile',
              'Set location (city, province/state, timezone) using update_farm_profile'
            ],
            tools: ['update_farm_profile'],
            tip: 'Start with your farm name and primary contact. This info appears on labels, invoices, and the wholesale marketplace.'
          },
          grow_rooms: {
            title: 'Grow Room Configuration',
            steps: [
              'List current rooms using list_rooms to see what exists',
              'Create rooms using create_room -- one for each distinct growing space',
              'Name rooms descriptively (e.g. "Propagation Room", "Main Production", "Finishing Room")'
            ],
            tools: ['list_rooms', 'create_room'],
            tip: 'A room represents a physical space with its own environmental controls. Even a single-room farm benefits from defining it explicitly.'
          },
          zones: {
            title: 'Climate Zone Setup',
            steps: [
              'Each room can have one or more zones',
              'Create zones using create_zone -- specify the parent room',
              'Zones represent areas with independent climate targets',
              'Common pattern: one zone per crop type within a room'
            ],
            tools: ['create_zone'],
            tip: 'Zones let you run different temperature, humidity, and light settings within the same room. Start simple -- you can split zones later.'
          },
          groups: {
            title: 'Grow Group Creation',
            steps: [
              'Use the Groups V2 panel on the Setup page',
              'Create groups to represent benches, racks, or tray sections',
              'Assign each group to a room and zone',
              'Set tray count per group'
            ],
            tools: ['Groups V2 panel'],
            tip: 'Groups are the atomic unit of the farm. Each group tracks its own crop, harvest schedule, and light assignment.'
          },
          lights: {
            title: 'Light Fixture Registration',
            steps: [
              'Use the Light Setup panel to register fixtures',
              'Enter fixture model, wattage, and spectrum type',
              'Assign lights to groups via the Groups V2 panel',
              'For bus-connected lights, use the Bus Mapping wizard'
            ],
            tools: ['Light Setup panel', 'Bus Mapping'],
            tip: 'Register all fixtures first, then assign them. The system calculates PPFD and DLI based on your fixture specs.'
          },
          schedules: {
            title: 'Light Schedule Configuration',
            steps: [
              'Open Groups V2 and select a group',
              'Set photoperiod (on/off hours), PPFD target, and spectrum',
              'Use set_light_schedule for quick configuration via chat',
              'Match schedules to crop requirements from the crop registry'
            ],
            tools: ['set_light_schedule', 'get_crop_schedule'],
            tip: 'The crop registry has science-backed schedules for 50+ crops. Ask me for a recommendation based on what you are growing.'
          },
          devices: {
            title: 'IoT Device Pairing',
            steps: [
              'Run a device scan to discover sensors on your network',
              'Register discovered devices using register_device',
              'Assign sensors to zones for environment monitoring',
              'Verify readings are coming through on the Environment dashboard'
            ],
            tools: ['scan_devices', 'register_device', 'auto_assign_devices'],
            tip: 'SwitchBot sensors are auto-discovered. Make sure your SwitchBot token is configured in Integrations first.'
          },
          integrations: {
            title: 'External Service Integrations',
            steps: [
              'Open the Integrations panel on the Setup page',
              'Enter SwitchBot API token and secret for sensor data',
              'Configure payment processing via the Payment Setup wizard (optional)',
              'Set up the online store via the Store Setup wizard (optional)'
            ],
            tools: ['Integrations panel', 'Payment Setup wizard'],
            tip: 'SwitchBot integration is required for real-time sensor data. Payment and store setup only matter when you are ready to sell.'
          }
        };

        const guide = GUIDANCE[phase];
        if (!guide) return { ok: false, error: `Unknown phase: ${phase}` };

        return { ok: true, ...guide };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Report Generation Tool ──
    case 'generate_report': {
      try {
        const period = (params.period || 'weekly').toLowerCase();
        const focus = (params.focus || 'all').toLowerCase();
        const sections = {};

        // Gather data from multiple sources
        try {
          const todoResult = await executeTool('get_daily_todo', { limit: 10 });
          if (todoResult?.ok) sections.tasks = { total: todoResult.task_count, tasks: todoResult.tasks?.slice(0, 5) };
        } catch { /* ok */ }

        try {
          const alertResult = await executeTool('get_alerts', {});
          if (alertResult?.ok) sections.alerts = { count: alertResult.count, alerts: alertResult.alerts?.slice(0, 5) };
        } catch { /* ok */ }

        if (focus === 'all' || focus === 'financial' || focus === 'market') {
          try {
            const marketData = await getMarketDataAsync(getDatabase());
            const topMovers = Object.entries(marketData)
              .filter(([, d]) => Math.abs(d.trendPercent || 0) > 3)
              .sort((a, b) => Math.abs(b[1].trendPercent) - Math.abs(a[1].trendPercent))
              .slice(0, 5)
              .map(([product, d]) => ({ product, trend: d.trend, trendPercent: d.trendPercent }));
            sections.market = { topMovers };
          } catch { /* ok */ }

          try {
            const pricing = await getCropPricing(farmId);
            sections.pricing = { crops: pricing.slice(0, 10) };
          } catch { /* ok */ }
        }

        if (focus === 'all' || focus === 'operations' || focus === 'crops') {
          try {
            const assignments = await executeTool('get_planting_assignments', { farm_id: farmId });
            if (assignments?.ok) sections.plantings = { count: assignments.assignments?.length || 0 };
          } catch { /* ok */ }

          try {
            const harvests = await executeTool('get_scheduled_harvests', { farm_id: farmId, days_ahead: period === 'daily' ? 7 : 30 });
            if (harvests?.ok) sections.upcoming_harvests = { count: harvests.harvests?.length || 0, harvests: harvests.harvests?.slice(0, 5) };
          } catch { /* ok */ }

          try {
            const yieldData = await executeTool('get_yield_forecast', {});
            if (yieldData?.ok) sections.yield_forecast = yieldData;
          } catch { /* ok */ }
        }

        // Engagement metrics
        if (isDatabaseAvailable()) {
          try {
            const now = new Date();
            const day = now.getDate();
            const periodStart = new Date(now.getFullYear(), now.getMonth(), day <= 14 ? 1 : 15).toISOString().slice(0, 10);
            const metricsResult = await query(
              'SELECT total_sessions, total_messages, total_tool_calls FROM engagement_metrics WHERE farm_id = $1 AND period_start = $2',
              [farmId, periodStart]
            );
            if (metricsResult.rows.length > 0) sections.engagement = metricsResult.rows[0];
          } catch { /* ok */ }
        }

        return {
          ok: true,
          period,
          focus,
          sections,
          generated_at: new Date().toISOString(),
          note: 'Synthesize this data into a narrative report with sections: Executive Summary, Operations, Market, and Recommendations.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Multi-Farm Fleet Tools ──
    case 'compare_farms': {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const farmIds = params.farm_ids
          ? params.farm_ids.split(',').map(f => f.trim())
          : null;

        let farmsQuery;
        if (farmIds) {
          farmsQuery = await query(
            'SELECT farm_id, name, farm_type, status, setup_completed FROM farms WHERE farm_id = ANY($1)',
            [farmIds]
          );
        } else {
          farmsQuery = await query(
            'SELECT farm_id, name, farm_type, status, setup_completed FROM farms WHERE status = $1 LIMIT 10',
            ['active']
          );
        }

        const farms = farmsQuery.rows || [];
        if (farms.length === 0) return { ok: false, error: 'No farms found' };

        const comparisons = [];
        for (const farm of farms) {
          const metrics = { farm_id: farm.farm_id, name: farm.name, type: farm.farm_type };

          // Get alert count per farm
          try {
            const alertResult = await executeTool('get_alerts', {});
            metrics.alert_count = alertResult?.count || 0;
          } catch { metrics.alert_count = 0; }

          // Get capacity per farm
          try {
            const groups = await farmStore.get(farm.farm_id, 'groups') || [];
            metrics.total_positions = groups.length;
          } catch { metrics.total_positions = 0; }

          comparisons.push(metrics);
        }

        return { ok: true, farms: comparisons, count: comparisons.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_network_overview': {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const farmsResult = await query(
          'SELECT COUNT(*) as total_farms, COUNT(CASE WHEN status = $1 THEN 1 END) as active_farms FROM farms',
          ['active']
        );
        const farmCount = farmsResult.rows[0] || {};

        let totalAlerts = 0;
        try {
          const alertResult = await executeTool('get_alerts', {});
          totalAlerts = alertResult?.count || 0;
        } catch { /* ok */ }

        let recentActivity = {};
        try {
          const activityResult = await query(
            `SELECT COUNT(*) as sessions, SUM(total_messages) as messages
             FROM engagement_metrics WHERE period_start >= CURRENT_DATE - INTERVAL '14 days'`
          );
          recentActivity = activityResult.rows[0] || {};
        } catch { /* ok */ }

        return {
          ok: true,
          network: {
            total_farms: parseInt(farmCount.total_farms || 0),
            active_farms: parseInt(farmCount.active_farms || 0),
            total_alerts: totalAlerts,
            recent_sessions: parseInt(recentActivity.sessions || 0),
            recent_messages: parseInt(recentActivity.messages || 0)
          }
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Inter-Agent Communication (E.V.I.E. -> F.A.Y.E.) ──

    case 'escalate_to_faye': {
      try {
        const { sendAgentMessage } = await import('../services/faye-learning.js');
        const context = { farm_id: params.farm_id || farmId };
        const result = await sendAgentMessage(
          'evie', 'faye',
          'escalation',
          String(params.subject).slice(0, 200),
          String(params.body).slice(0, 2000),
          context,
          params.priority || 'normal'
        );
        return result
          ? { ok: true, message: `Escalation sent to F.A.Y.E.: "${params.subject}". She will review and respond.`, escalation_id: result.id }
          : { ok: false, error: 'Failed to send escalation. F.A.Y.E. may be unavailable.' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_faye_directives': {
      try {
        const { getUnreadMessages, getAgentMessageHistory, markMessagesRead } = await import('../services/faye-learning.js');
        let messages;
        if (params.include_read === 'true') {
          messages = await getAgentMessageHistory(20, null);
          messages = messages.filter(m => m.recipient === 'evie' || m.sender === 'evie');
        } else {
          messages = await getUnreadMessages('evie', 20);
        }
        // Auto-mark as read
        const unreadIds = messages.filter(m => m.status === 'unread' && m.recipient === 'evie').map(m => m.id);
        if (unreadIds.length > 0) {
          await markMessagesRead('evie', unreadIds);
        }
        return { ok: true, count: messages.length, messages };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'reply_to_faye': {
      try {
        const { sendAgentMessage } = await import('../services/faye-learning.js');
        const msgType = ['response', 'observation', 'status_update'].includes(params.message_type) ? params.message_type : 'response';
        const context = { farm_id: params.farm_id || farmId };
        const result = await sendAgentMessage(
          'evie', 'faye',
          msgType,
          String(params.subject).slice(0, 200),
          String(params.body).slice(0, 2000),
          context,
          'normal',
          params.reply_to_id ? parseInt(params.reply_to_id, 10) : null
        );
        return result
          ? { ok: true, message: `Message sent to F.A.Y.E.: "${params.subject}"`, message_id: result.id }
          : { ok: false, error: 'Failed to send message to F.A.Y.E.' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'submit_feature_request': {
      try {
        const { sendAgentMessage } = await import('../services/faye-learning.js');
        const requestTitle = String(params.title || '').trim();
        const requestBody = String(params.request || '').trim();
        if (!requestTitle || !requestBody) {
          return { ok: false, error: 'title and request are required' };
        }

        const requestFarmId = params.farm_id || farmId;
        const context = {
          farm_id: requestFarmId,
          request_type: 'feature_request',
          review_cycle: 'weekly',
          context_page: params.context_page || null
        };

        const formattedBody = [
          `Feature Request: ${requestTitle}`,
          `Requested by farm: ${requestFarmId || 'unknown'}`,
          params.context_page ? `Context page/workflow: ${params.context_page}` : null,
          '',
          requestBody
        ].filter(Boolean).join('\n');

        const result = await sendAgentMessage(
          'evie',
          'faye',
          'escalation',
          `Feature Request: ${requestTitle}`.slice(0, 200),
          formattedBody.slice(0, 2000),
          context,
          ['low', 'normal', 'high', 'critical'].includes(params.priority) ? params.priority : 'normal'
        );

        if (!result) {
          return { ok: false, error: 'Failed to submit feature request to F.A.Y.E.' };
        }

        return {
          ok: true,
          message: 'Feature request captured and sent to F.A.Y.E. for weekly review.',
          request_id: result.id,
          review_cycle: 'weekly'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Operations Command Tools ──

    case 'update_group_crop': {
      try {
        const groupId = params.group_id;
        const cropName = params.crop_name;
        const seedDate = params.seed_date || new Date().toISOString().slice(0, 10);

        // Resolve crop from registry
        const registry = readJSON('crop-registry.json', {});
        const crops = registry.crops || {};
        const cropKey = Object.keys(crops).find(k => k.toLowerCase() === cropName.toLowerCase());
        const cropEntry = cropKey ? crops[cropKey] : null;
        const resolvedName = cropEntry?.name || cropName;
        const planId = cropEntry?.planId || `crop-${cropName.toLowerCase().replace(/\s+/g, '-')}`;

        // Load current groups
        const groupsData = await farmStore.get(farmId, 'groups') || [];
        const groups = Array.isArray(groupsData) ? groupsData : (groupsData.groups || []);
        const groupMatch = groups.find(g =>
          g.id === groupId || g.name === groupId ||
          (g.name || '').toLowerCase() === (groupId || '').toLowerCase()
        );
        if (!groupMatch) {
          return { ok: false, error: `Group "${groupId}" not found. Available groups: ${groups.map(g => g.name || g.id).join(', ') || 'none'}` };
        }

        // Update the group crop assignment
        groupMatch.crop = resolvedName;
        groupMatch.recipe = resolvedName;
        groupMatch.plan = planId;
        groupMatch.planId = planId;
        if (!groupMatch.planConfig) groupMatch.planConfig = {};
        if (!groupMatch.planConfig.anchor) groupMatch.planConfig.anchor = {};
        groupMatch.planConfig.anchor.seedDate = seedDate;

        await farmStore.set(farmId, 'groups', Array.isArray(groupsData) ? groups : { ...groupsData, groups });

        return {
          ok: true,
          group: groupMatch.name || groupMatch.id,
          crop: resolvedName,
          seed_date: seedDate,
          trays: groupMatch.trays || 0,
          message: `Group "${groupMatch.name || groupMatch.id}" updated: now seeding ${resolvedName} (${groupMatch.trays || 0} trays, seed date ${seedDate})`
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'create_procurement_order': {
      try {
        // Load catalog to validate items
        const catalog = await farmStore.get(farmId, 'procurement_catalog') || { products: [] };
        const products = catalog.products || [];

        if (params.reorder_previous) {
          const ordersData = await farmStore.get(farmId, 'procurement_orders') || { orders: [] };
          const lastOrder = (ordersData.orders || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          if (!lastOrder) return { ok: false, error: 'No previous procurement orders found to reorder.' };
          params.items = (lastOrder.items || []).map(i => ({ sku: i.sku, name: i.name, quantity: i.quantity }));
        }

        if (!params.items || !params.items.length) {
          return { ok: false, error: 'No items specified. Provide items from the procurement catalog.' };
        }

        // Validate every item against catalog
        const resolvedItems = [];
        const rejected = [];
        for (const item of params.items) {
          let product = null;
          if (item.sku) {
            product = products.find(p => p.sku === item.sku);
          }
          if (!product && item.name) {
            const nameLC = (item.name || '').toLowerCase();
            product = products.find(p => (p.name || '').toLowerCase().includes(nameLC));
          }
          if (!product) {
            rejected.push(item.name || item.sku || 'unknown');
            continue;
          }
          resolvedItems.push({
            sku: product.sku,
            name: product.name,
            quantity: Math.max(1, Math.round(item.quantity || 1)),
            price: product.price || 0,
            total: Math.round((product.price || 0) * (item.quantity || 1) * 100) / 100,
            category: product.category || 'general'
          });
        }

        if (rejected.length > 0 && resolvedItems.length === 0) {
          return {
            ok: false,
            error: `None of the requested items are in the procurement catalog. Rejected: ${rejected.join(', ')}. Only products from the catalog can be ordered.`,
            catalog_categories: [...new Set(products.map(p => p.category))],
            catalog_count: products.length
          };
        }

        // Create the order
        const ordersData = await farmStore.get(farmId, 'procurement_orders') || { orders: [] };
        const subtotal = resolvedItems.reduce((s, i) => s + i.total, 0);
        const orderId = `PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const order = {
          id: orderId,
          orderId,
          farmId,
          items: resolvedItems,
          subtotal: Math.round(subtotal * 100) / 100,
          itemCount: resolvedItems.reduce((s, i) => s + i.quantity, 0),
          status: 'pending',
          paymentMethod: 'invoice',
          paymentStatus: 'pending',
          notes: params.notes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        ordersData.orders = ordersData.orders || [];
        ordersData.orders.push(order);
        await farmStore.set(farmId, 'procurement_orders', ordersData);

        const result = {
          ok: true,
          order_id: orderId,
          items: resolvedItems.map(i => `${i.quantity}x ${i.name} ($${i.total})`),
          subtotal: `$${order.subtotal.toFixed(2)}`,
          status: 'pending',
          message: `Procurement order ${orderId} created with ${resolvedItems.length} items totaling $${order.subtotal.toFixed(2)}.`
        };
        if (rejected.length > 0) {
          result.rejected_items = rejected;
          result.warning = `${rejected.length} item(s) not found in catalog and were skipped: ${rejected.join(', ')}`;
        }
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_seeding_schedule': {
      try {
        const daysAhead = params.days_ahead || 7;
        const sections = {};

        // Active plantings
        try {
          const assignments = await executeTool('get_planting_assignments', { farm_id: farmId, status: 'active' });
          if (assignments?.ok) sections.active_plantings = assignments.assignments || [];
        } catch { /* ok */ }

        // Upcoming harvests
        try {
          const harvests = await executeTool('get_scheduled_harvests', { farm_id: farmId, days_ahead: daysAhead });
          if (harvests?.ok) sections.upcoming_harvests = harvests.harvests || [];
        } catch { /* ok */ }

        // Grow groups with seed dates
        try {
          const groupsData = await farmStore.get(farmId, 'groups') || [];
          const groups = Array.isArray(groupsData) ? groupsData : (groupsData.groups || []);
          const now = new Date();
          const cutoff = new Date(now.getTime() + daysAhead * 86400000);
          sections.groups = groups.map(g => ({
            name: g.name || g.id,
            crop: g.crop || g.recipe || 'unassigned',
            trays: g.trays || 0,
            seed_date: g.planConfig?.anchor?.seedDate || null,
            room: g.room || g.roomId || null
          }));
        } catch { /* ok */ }

        return {
          ok: true,
          period: `Next ${daysAhead} days`,
          ...sections,
          generated_at: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_wholesale_packing_list': {
      try {
        const targetDate = params.date || new Date().toISOString().slice(0, 10);
        const statusFilter = params.status || 'confirmed';

        // Query wholesale orders
        const { listAllOrders } = await import('../services/wholesaleMemoryStore.js');
        const allOrders = await listAllOrders({ status: statusFilter });

        // Filter to orders for this farm on the target date
        const packingOrders = (allOrders || []).filter(o => {
          const orderDate = (o.created_at || '').slice(0, 10);
          const matchDate = orderDate === targetDate;
          const farmSubs = (o.farm_sub_orders || []).filter(s => s.farm_id === farmId);
          return matchDate && farmSubs.length > 0;
        });

        if (!packingOrders.length) {
          return {
            ok: true,
            date: targetDate,
            status: statusFilter,
            orders: [],
            total_items: 0,
            message: `No ${statusFilter} wholesale orders found for ${targetDate}.`
          };
        }

        const packingList = packingOrders.map(o => {
          const farmSub = (o.farm_sub_orders || []).find(s => s.farm_id === farmId) || {};
          const lineItems = farmSub.line_items || o.line_items || [];
          return {
            order_id: o.master_order_id || o.id,
            buyer: o.buyer_name || o.buyer_email || 'Unknown',
            status: o.status,
            items: lineItems.map(li => ({
              product: li.product_name || li.name,
              quantity: li.quantity,
              unit: li.unit || 'lb',
              weight_lbs: li.weight_lbs || li.quantity
            })),
            delivery_notes: o.delivery_notes || farmSub.delivery_notes || null
          };
        });

        const totalItems = packingList.reduce((s, o) => s + o.items.length, 0);
        return {
          ok: true,
          date: targetDate,
          status: statusFilter,
          orders: packingList,
          order_count: packingList.length,
          total_items: totalItems,
          message: `${packingList.length} orders with ${totalItems} line items ready for packing/labeling on ${targetDate}.`,
          note: 'Present this as a formatted packing list. Each order is one shipment to a buyer. Include product names, quantities, and buyer info for label printing.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_qc_summary': {
      try {
        const qc = {};

        // Environment compliance
        try {
          const env = await executeTool('get_environment_readings', { zone_id: params.zone_id });
          if (env?.ok) {
            const readings = env.readings || env.zones || [];
            const outOfRange = Array.isArray(readings) ? readings.filter(r => r.status === 'warning' || r.status === 'critical') : [];
            qc.environment = {
              total_zones: Array.isArray(readings) ? readings.length : 0,
              compliant: Array.isArray(readings) ? readings.length - outOfRange.length : 0,
              out_of_range: outOfRange.length,
              issues: outOfRange.map(r => ({ zone: r.zone || r.zone_id, metric: r.metric, value: r.value, target: r.target }))
            };
          }
        } catch { /* ok */ }

        // Active alerts
        try {
          const alerts = await executeTool('get_alerts', {});
          if (alerts?.ok) {
            qc.alerts = {
              total: alerts.count || 0,
              critical: (alerts.alerts || []).filter(a => a.severity === 'critical').length,
              warnings: (alerts.alerts || []).filter(a => a.severity === 'warning').length,
              items: (alerts.alerts || []).slice(0, 10)
            };
          }
        } catch { /* ok */ }

        // Nutrient status
        try {
          const nutrients = await executeTool('get_nutrient_status', {});
          if (nutrients?.ok) {
            qc.nutrients = nutrients;
          }
        } catch { /* ok */ }

        return {
          ok: true,
          summary: qc,
          generated_at: new Date().toISOString(),
          note: 'Present as a quality control dashboard. Flag any critical/warning items prominently. Include recommendations for out-of-range readings.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_sales_summary': {
      try {
        const period = (params.period || 'mtd').toLowerCase();
        const now = new Date();
        let startDate, prevStart, prevEnd, periodLabel;

        if (period === 'today') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          prevStart = new Date(startDate.getTime() - 86400000);
          prevEnd = new Date(startDate.getTime());
          periodLabel = 'Today';
        } else if (period === 'week') {
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          prevStart = new Date(startDate.getTime() - 7 * 86400000);
          prevEnd = new Date(startDate.getTime());
          periodLabel = 'This Week';
        } else if (period === 'month' || period === 'mtd') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);
          periodLabel = 'Month to Date';
        } else {
          startDate = new Date(now.getFullYear(), 0, 1);
          prevStart = new Date(now.getFullYear() - 1, 0, 1);
          prevEnd = new Date(now.getFullYear(), 0, 1);
          periodLabel = 'Year to Date';
        }

        // Query wholesale orders
        const { listAllOrders } = await import('../services/wholesaleMemoryStore.js');
        const allOrders = await listAllOrders({});

        const currentOrders = (allOrders || []).filter(o => {
          const d = new Date(o.created_at);
          const farmSubs = (o.farm_sub_orders || []).filter(s => s.farm_id === farmId);
          return d >= startDate && d <= now && farmSubs.length > 0;
        });

        const prevOrders = (allOrders || []).filter(o => {
          const d = new Date(o.created_at);
          const farmSubs = (o.farm_sub_orders || []).filter(s => s.farm_id === farmId);
          return d >= prevStart && d < prevEnd && farmSubs.length > 0;
        });

        // Calculate revenue from farm sub-orders
        function calcRevenue(orders) {
          let revenue = 0;
          let itemCount = 0;
          const cropSales = {};
          for (const o of orders) {
            const farmSub = (o.farm_sub_orders || []).find(s => s.farm_id === farmId) || {};
            const subTotal = Number(farmSub.subtotal || farmSub.total || 0);
            revenue += subTotal;
            for (const li of (farmSub.line_items || [])) {
              const crop = li.product_name || li.name || 'Unknown';
              const qty = Number(li.quantity || 0);
              cropSales[crop] = (cropSales[crop] || 0) + qty;
              itemCount += qty;
            }
          }
          return { revenue: Math.round(revenue * 100) / 100, itemCount, cropSales };
        }

        const current = calcRevenue(currentOrders);
        const prev = calcRevenue(prevOrders);
        const topCrops = Object.entries(current.cropSales)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([crop, qty]) => ({ crop, quantity_sold: qty }));

        return {
          ok: true,
          period: periodLabel,
          revenue: `$${current.revenue.toFixed(2)}`,
          order_count: currentOrders.length,
          items_sold: current.itemCount,
          average_order_value: currentOrders.length > 0 ? `$${(current.revenue / currentOrders.length).toFixed(2)}` : '$0.00',
          top_crops: topCrops,
          previous_period: {
            revenue: `$${prev.revenue.toFixed(2)}`,
            order_count: prevOrders.length
          },
          change: prev.revenue > 0
            ? `${((current.revenue - prev.revenue) / prev.revenue * 100).toFixed(1)}%`
            : 'N/A (no prior data)',
          generated_at: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Lot System / Traceability Tools ────────────────────────────────
    case 'record_harvest': {
      try {
        const { generateLotNumber, calculateBestByDate, gradeFromScore } = await import('./lot-system.js');
        const harvestDate = new Date();
        const quality = Math.min(1, Math.max(0, Number(params.quality_score) || 0.70));

        // 1. Create harvest event
        const heResult = await pool.query(
          `INSERT INTO harvest_events
            (farm_id, group_id, crop_id, crop_name, harvest_date,
             plants_harvested, gross_weight_oz, net_weight_oz,
             quality_score, quality_notes, harvested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [farmId, params.group_id, params.crop_id, params.crop_name,
           harvestDate, params.plants_harvested || null,
           params.gross_weight_oz || null, params.net_weight_oz || null,
           quality, params.quality_notes || null, null]
        );
        const harvestEventId = heResult.rows[0].id;

        // 2. Seed date from planting
        let seedDate = null;
        const paRes = await pool.query(
          'SELECT seed_date FROM planting_assignments WHERE farm_id = $1 AND group_id = $2',
          [farmId, params.group_id]
        );
        if (paRes.rows.length > 0) seedDate = paRes.rows[0].seed_date;

        // 3. Generate lot + best-by
        const lotNumber = await generateLotNumber(farmId, harvestDate);
        const bestByDate = calculateBestByDate(harvestDate, params.crop_name);
        const weightOz = Number(params.net_weight_oz) || Number(params.gross_weight_oz) || null;

        await pool.query(
          `INSERT INTO lot_records
            (lot_number, farm_id, harvest_event_id, group_id, crop_id, crop_name,
             seed_date, harvest_date, seed_source, seed_lot,
             weight_oz, quality_score, best_by_date, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')`,
          [lotNumber, farmId, harvestEventId, params.group_id, params.crop_id,
           params.crop_name, seedDate, harvestDate,
           params.seed_source || null, params.seed_lot || null,
           weightOz, quality, bestByDate]
        );

        // 4. Link to inventory
        if (weightOz) {
          const productId = params.crop_name.toLowerCase().replace(/\s+/g, '-');
          const weightLbs = Math.round((weightOz / 16) * 100) / 100;
          await pool.query(
            `UPDATE farm_inventory
                SET lot_number = $3, quality_score = $4, best_by_date = $5,
                    harvest_event_id = $6,
                    auto_quantity_lbs = COALESCE(auto_quantity_lbs, 0) + $7,
                    quantity_available = COALESCE(auto_quantity_lbs, 0) + $7 + COALESCE(manual_quantity_lbs, 0) - COALESCE(sold_quantity_lbs, 0),
                    last_updated = NOW()
              WHERE farm_id = $1 AND product_id = $2`,
            [farmId, productId, lotNumber, quality, bestByDate, harvestEventId, weightLbs]
          );
        }

        return {
          ok: true,
          harvest_event_id: harvestEventId,
          lot_number: lotNumber,
          best_by_date: bestByDate.toISOString().slice(0, 10),
          quality_grade: gradeFromScore(quality),
          quality_score: quality,
          weight_oz: weightOz,
          note: 'Present the lot number, grade, and best-by date clearly. If weight was provided, confirm the inventory was updated.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_lot_traceability': {
      try {
        const { gradeFromScore } = await import('./lot-system.js');
        const lotResult = await pool.query(
          `SELECT l.*, h.plants_harvested, h.gross_weight_oz, h.net_weight_oz,
                  h.harvested_by, h.quality_notes
             FROM lot_records l
             LEFT JOIN harvest_events h ON l.harvest_event_id = h.id
            WHERE l.farm_id = $1 AND l.lot_number = $2`,
          [farmId, params.lot_number]
        );
        if (lotResult.rows.length === 0) {
          return { ok: false, error: `Lot "${params.lot_number}" not found for this farm.` };
        }
        const lot = lotResult.rows[0];
        return {
          ok: true,
          lot_number: lot.lot_number,
          crop: lot.crop_name,
          seed_source: lot.seed_source || 'Not recorded',
          seed_lot: lot.seed_lot || 'Not recorded',
          seed_date: lot.seed_date,
          harvest_date: lot.harvest_date,
          best_by_date: lot.best_by_date,
          weight_oz: lot.weight_oz,
          quality_score: lot.quality_score,
          quality_grade: gradeFromScore(lot.quality_score),
          plants_harvested: lot.plants_harvested,
          harvested_by: lot.harvested_by,
          quality_notes: lot.quality_notes,
          status: lot.status,
          note: 'Present as a traceability card: lot number, crop, seed-to-harvest chain, quality grade, and best-by date.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'list_lots': {
      try {
        const { gradeFromScore } = await import('./lot-system.js');
        let sql = 'SELECT * FROM lot_records WHERE farm_id = $1';
        const sqlParams = [farmId];
        let idx = 2;
        if (params.status) { sql += ` AND status = $${idx++}`; sqlParams.push(params.status); }
        if (params.crop) { sql += ` AND crop_name ILIKE $${idx++}`; sqlParams.push(`%${params.crop}%`); }
        sql += ` ORDER BY harvest_date DESC LIMIT $${idx}`;
        sqlParams.push(Math.min(Number(params.limit) || 20, 100));

        const result = await pool.query(sql, sqlParams);
        return {
          ok: true,
          lots: result.rows.map(r => ({
            lot_number: r.lot_number,
            crop: r.crop_name,
            harvest_date: r.harvest_date,
            best_by_date: r.best_by_date,
            quality_grade: gradeFromScore(r.quality_score),
            weight_oz: r.weight_oz,
            status: r.status
          })),
          count: result.rows.length,
          note: 'Present as a table with columns: Lot #, Crop, Harvested, Best By, Grade, Weight, Status.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'generate_label': {
      try {
        const { gradeFromScore } = await import('./lot-system.js');
        const lotResult = await pool.query(
          'SELECT * FROM lot_records WHERE farm_id = $1 AND lot_number = $2',
          [farmId, params.lot_number]
        );
        if (lotResult.rows.length === 0) {
          return { ok: false, error: `Lot "${params.lot_number}" not found.` };
        }
        const lot = lotResult.rows[0];
        const weightOz = Number(lot.weight_oz) || 0;
        return {
          ok: true,
          label: {
            lot_number: lot.lot_number,
            product_name: lot.crop_name,
            farm_id: lot.farm_id,
            harvest_date: lot.harvest_date,
            best_by_date: lot.best_by_date,
            weight_oz: weightOz,
            weight_lbs: Math.round((weightOz / 16) * 100) / 100,
            quality_grade: gradeFromScore(lot.quality_score),
            seed_source: lot.seed_source || 'N/A'
          },
          note: 'Present the label data clearly. If the farmer wants a printable version, suggest visiting /api/lots/label with format=html.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'generate_packing_slip': {
      try {
        const { gradeFromScore } = await import('./lot-system.js');
        const items = params.items || [];

        // If no items given, try to look up order
        let lineItems = items;
        if (lineItems.length === 0 && params.order_id) {
          const { listAllOrders } = await import('../services/wholesaleMemoryStore.js');
          const allOrders = await listAllOrders({});
          const order = allOrders.find(o =>
            o.master_order_id === params.order_id ||
            (o.farm_sub_orders || []).some(s => s.sub_order_id === params.order_id)
          );
          if (order) {
            const farmSub = (order.farm_sub_orders || []).find(s => s.farm_id === farmId) || {};
            lineItems = (farmSub.line_items || []).map(li => ({
              sku_name: li.sku_name || li.product_name || li.name,
              qty: li.qty || li.quantity,
              unit: li.unit || 'lb'
            }));
          }
        }

        const slipItems = [];
        for (const item of lineItems) {
          const cropId = (item.sku_name || '').toLowerCase().replace(/\s+/g, '-');
          const lotResult = await pool.query(
            `SELECT lot_number, best_by_date, quality_score, harvest_date
               FROM lot_records WHERE farm_id = $1 AND crop_id = $2 AND status = 'active'
               ORDER BY harvest_date DESC LIMIT 1`,
            [farmId, cropId]
          );
          const lot = lotResult.rows[0];
          slipItems.push({
            product: item.sku_name,
            quantity: item.qty,
            unit: item.unit || 'lb',
            lot_number: lot?.lot_number || 'N/A',
            harvest_date: lot?.harvest_date || 'N/A',
            best_by_date: lot?.best_by_date || 'N/A',
            quality_grade: lot ? gradeFromScore(lot.quality_score) : 'N/A'
          });
        }

        return {
          ok: true,
          packing_slip: {
            order_id: params.order_id,
            farm_id: farmId,
            generated_at: new Date().toISOString(),
            items: slipItems
          },
          note: 'Present as a packing slip table. For printable HTML, suggest /api/lots/packing-slip with format=html.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_sfcr_export': {
      try {
        const { gradeFromScore } = await import('./lot-system.js');
        let dateSql = '';
        const sqlParams = [farmId];
        let idx = 2;
        if (params.from) { dateSql += ` AND l.harvest_date >= $${idx++}`; sqlParams.push(params.from); }
        if (params.to) { dateSql += ` AND l.harvest_date <= $${idx++}`; sqlParams.push(params.to); }

        const result = await pool.query(
          `SELECT l.lot_number, l.crop_name, l.seed_source, l.seed_lot,
                  l.seed_date, l.harvest_date, l.best_by_date,
                  l.weight_oz, l.quality_score, l.status,
                  h.plants_harvested, h.gross_weight_oz, h.net_weight_oz,
                  h.harvested_by, h.quality_notes
             FROM lot_records l
             LEFT JOIN harvest_events h ON l.harvest_event_id = h.id
            WHERE l.farm_id = $1 ${dateSql}
            ORDER BY l.harvest_date DESC
            LIMIT 1000`,
          sqlParams
        );

        return {
          ok: true,
          export_type: 'SFCR',
          record_count: result.rows.length,
          records: result.rows.map(r => ({
            lot_number: r.lot_number,
            product: r.crop_name,
            seed_source: r.seed_source || 'Unknown',
            seed_lot: r.seed_lot || 'Unknown',
            seed_date: r.seed_date,
            harvest_date: r.harvest_date,
            best_by_date: r.best_by_date,
            weight_oz: r.weight_oz,
            quality_grade: gradeFromScore(r.quality_score),
            plants_harvested: r.plants_harvested,
            harvested_by: r.harvested_by || 'Unknown',
            status: r.status
          })),
          note: 'Present as a regulatory compliance table. Each row is a traceable lot. This data supports SFCR (Safe Food for Canadians Regulations) audit requirements.'
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'read_skill_file': {
      try {
        const VALID_SKILLS = new Set([
          'environmental-management-control',
          'security',
          'label-document-generation',
          'lot-code-traceability',
          'record-keeping-audit-trail',
          'social-media-marketing',
          'device-setup-onboarding',
          'ai-vision-rules'
        ]);
        const skillName = (params.skill_name || '').toLowerCase().trim();
        if (!VALID_SKILLS.has(skillName)) {
          return { ok: false, error: `Unknown skill: ${skillName}. Available: ${[...VALID_SKILLS].join(', ')}` };
        }
        const SKILL_FILE_MAP = { 'ai-vision-rules': path.join(__dirname, '..', '.github', 'AI_VISION_RULES_AND_SKILLS.md') };
        const skillPath = SKILL_FILE_MAP[skillName] || path.join(__dirname, '..', '.github', 'skills', `${skillName}.md`);
        if (!fs.existsSync(skillPath)) {
          return { ok: false, error: `Skill file not found: ${skillName}.md` };
        }
        const skillContent = fs.readFileSync(skillPath, 'utf8');
        return {
          ok: true,
          skill_name: skillName,
          content: skillContent,
          note: 'Use the research and principles in this document to ground your response. Do not dump the entire document to the user.'
        };
      } catch (err) {
        return { ok: false, error: `Failed to read skill: ${err.message}` };
      }
    }

    // ── Bus Mapping & Wired Channel Tools ──────────────────────────────
    case 'scan_bus_channels':
    case 'get_bus_mappings':
    case 'save_bus_mapping': {
      // These tools are in TOOL_CATALOG -- dispatch via executeTool
      const busResult = await executeTool(toolName, { ...params, farm_id: farmId });
      // Cache discovery sessions for follow-up
      if (toolName === 'scan_bus_channels' && busResult.ok) {
        // Scan results don't go through scan_devices but should still be traceable
      }
      return busResult;
    }

    // ── LEAM Companion Agent Tools ──────────────────────────────────────
    case 'leam_scan_all': {
      const result = await leamBridge.sendCommand(farmId, 'scan_all', {
        duration: params.duration || 12000
      });
      if (result.leam_required) {
        return { ok: false, error: result.error, hint: 'LEAM is initializing automatically. If this persists, check that the LEAM service is installed on the operator machine.' };
      }
      return result.ok ? { ok: true, ...result.data } : result;
    }

    case 'leam_ble_scan': {
      const result = await leamBridge.sendCommand(farmId, 'ble_scan', {
        duration: params.duration || 10000
      });
      if (result.leam_required) {
        return { ok: false, error: result.error, hint: 'LEAM is initializing automatically for BLE scanning. Retrying shortly.' };
      }
      return result.ok ? { ok: true, ...result.data } : result;
    }

    case 'leam_network_scan': {
      const result = await leamBridge.sendCommand(farmId, 'network_scan', {
        arp: params.arp !== false,
        mdns: params.mdns !== false,
        ssdp: params.ssdp !== false,
        duration: params.duration || 8000
      });
      if (result.leam_required) {
        return { ok: false, error: result.error, hint: 'LEAM is initializing automatically for network scanning. Retrying shortly.' };
      }
      return result.ok ? { ok: true, ...result.data } : result;
    }

    case 'leam_system_info': {
      const command = params.detailed ? 'system_detailed' : 'system_info';
      const result = await leamBridge.sendCommand(farmId, command, {});
      if (result.leam_required) {
        return { ok: false, error: result.error, hint: 'LEAM is initializing automatically to gather system info. Retrying shortly.' };
      }
      return result.ok ? { ok: true, ...result.data } : result;
    }

    case 'leam_status': {
      const status = leamBridge.getClientStatus(farmId);
      if (!status.connected) {
        return {
          ok: true,
          connected: false,
          message: 'LEAM companion is not currently connected. E.V.I.E. will attempt to initialize it automatically when a scan is requested. If LEAM is not installed, it can be set up as a background service on the operator machine.'
        };
      }
      return { ok: true, ...status };
    }

    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}

// ── Self-Solving Error Recovery ───────────────────────────────────────

/**
 * Attempt to auto-recover from a tool failure before surfacing to user.
 * Returns { recovered: bool, result?, strategy?, hint? }
 */
async function attemptAutoRecovery(toolName, params, errorMsg, farmId) {
  const errLower = (errorMsg || '').toLowerCase();

  // Strategy 1: crop_id NOT NULL — auto-resolve crop_id from registry
  if (errLower.includes('null') && errLower.includes('crop_id') && toolName === 'create_planting_assignment') {
    const registry = readJSON('crop-registry.json', {});
    const crops = registry.crops || {};
    const cropName = params.crop_name || '';
    const entry = Object.entries(crops).find(([k]) => k.toLowerCase() === cropName.toLowerCase());
    if (entry) {
      params.crop_id = entry[1].planId || `crop-${cropName.toLowerCase().replace(/\s+/g, '-')}`;
      try {
        const result = await executeExtendedTool(toolName, params, farmId);
        if (result?.ok !== false) return { recovered: true, result, strategy: 'auto-resolved crop_id from registry' };
      } catch { /* fall through */ }
    }
    return { recovered: false, strategy: 'crop_id_resolution_failed', hint: `Could not resolve crop ID for "${cropName}". Check if the crop exists in the registry.` };
  }

  // Strategy 2: group_id not found — try zone-based resolution
  if ((errLower.includes('group') || errLower.includes('zone')) && errLower.includes('not found')) {
    return { recovered: false, strategy: 'invalid_group_id', hint: `The zone/group "${params.group_id}" doesn't exist. Use valid zone names from the farm layout (e.g. "Zone 1").` };
  }

  // Strategy 3: database unavailable — retry once after 1s
  if (errLower.includes('database') && errLower.includes('unavailable')) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const result = await executeExtendedTool(toolName, params, farmId);
      if (result?.ok !== false) return { recovered: true, result, strategy: 'database_retry_success' };
    } catch { /* fall through */ }
    return { recovered: false, strategy: 'database_retry_failed', hint: 'Database is temporarily unavailable. The operation can be retried in a few minutes.' };
  }

  // Strategy 4: foreign key violation — probably bad farm_id
  if (errLower.includes('foreign key') || errLower.includes('violates')) {
    return { recovered: false, strategy: 'constraint_violation', hint: `A database constraint was violated. This likely means a referenced record (farm, group, or crop) doesn't exist yet.` };
  }

  // No recovery available
  return { recovered: false, strategy: 'no_recovery_available', hint: `Tool "${toolName}" failed: ${errorMsg}. Try a different approach or check the input parameters.` };
}

/**
 * Log a structured alert to system-alerts.json and optionally the DB.
 * These appear on the GreenReach Central dashboard.
 */
async function logSystemAlert(alertData) {
  try {
    const alertsPath = path.join(DATA_DIR, 'system-alerts.json');
    let alerts = [];
    try {
      if (fs.existsSync(alertsPath)) {
        alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
        if (!Array.isArray(alerts)) alerts = alerts.alerts || [];
      }
    } catch { alerts = []; }

    const alert = {
      id: crypto.randomUUID(),
      alert_type: alertData.alert_type || 'system_error',
      severity: alertData.severity || 'medium',
      source: alertData.source || 'assistant-chat',
      message: `Tool ${alertData.tool} failed: ${alertData.error}`,
      details: {
        tool: alertData.tool,
        params: alertData.params,
        error: alertData.error,
        recovery_attempted: alertData.recovery_attempted,
        conversation_id: alertData.conversation_id
      },
      farm_id: alertData.farm_id,
      resolved: false,
      created_at: new Date().toISOString()
    };

    alerts.push(alert);
    // Keep last 200 alerts
    if (alerts.length > 200) alerts = alerts.slice(-200);

    const tmpPath = alertsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(alerts, null, 2));
    fs.renameSync(tmpPath, alertsPath);

    // Also persist to DB if available
    if (isDatabaseAvailable()) {
      try {
        await query(
          'INSERT INTO farm_alerts (alert_type, severity, message, farm_id, created_at) VALUES ($1, $2, $3, $4, NOW())',
          [alert.alert_type, alert.severity, alert.message, alertData.farm_id]
        );
      } catch { /* non-fatal */ }
    }

    logger.warn(`[System Alert] ${alert.severity}: ${alert.message}`);

    // Dispatch email + SMS for high/critical alerts (fire-and-forget)
    alertNotifier.notify(alert);
  } catch (err) {
    logger.error('[System Alert] Failed to log alert:', err.message);
  }
}

// ── Anthropic Fallback Chat Function ──────────────────────────────────

async function chatWithAnthropicFallback(systemPrompt, history, userMessage, farmId, convId) {
  const client = await getAnthropicClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropicTools = openaiToolsToAnthropic(GPT_TOOLS);
  const toolCallResults = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let loopCount = 0;

  // Convert history to Anthropic message format (user/assistant only)
  const messages = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
  messages.push({ role: 'user', content: userMessage });

  let response = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages,
    tools: anthropicTools,
    temperature: 0.7
  });

  totalInputTokens += response.usage?.input_tokens || 0;
  totalOutputTokens += response.usage?.output_tokens || 0;

  // Tool-calling loop
  while (response.stop_reason === 'tool_use' && loopCount < 10) {
    loopCount++;
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const { id, name, input } = block;
      console.log(`[E.V.I.E. Anthropic fallback] Tool call #${loopCount}: ${name}`);

      let toolResult;
      try {
        const isWriteTool = TOOL_CATALOG[name]?.category === 'write' || TRUST_TIERS.confirm.has(name) || TRUST_TIERS.admin.has(name);
        const tier = getTrustTier(name);

        if (isWriteTool && tier === 'auto') {
          toolResult = await executeExtendedTool(name, input || {}, farmId);
        } else if (isWriteTool && tier === 'quick_confirm') {
          toolResult = await executeExtendedTool(name, { ...input, confirm: true }, farmId);
        } else if (isWriteTool && (tier === 'confirm' || tier === 'admin')) {
          pendingActions.set(convId, { tool: name, params: input || {}, farmId, created: Date.now() });
          toolResult = {
            status: 'pending_confirmation',
            message: 'This action requires user confirmation before execution.',
            tool: name, params: input
          };
        } else {
          toolResult = await executeExtendedTool(name, input || {}, farmId);
        }
      } catch (err) {
        toolResult = { ok: false, error: err.message };
      }

      // Self-solving: attempt auto-recovery on failure
      if (toolResult && toolResult.ok === false && toolResult.error) {
        const recovery = await attemptAutoRecovery(name, input || {}, toolResult.error, farmId);
        if (recovery.recovered) {
          toolResult = recovery.result;
          logger.info(`[E.V.I.E. Fallback Self-Solve] Auto-recovered ${name}: ${recovery.strategy}`);
        }
      }

      toolCallResults.push({ tool: name, params: input, success: toolResult?.ok !== false });
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(toolResult) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
      temperature: 0.4
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;
  }

  const textBlocks = response.content.filter(b => b.type === 'text');
  const replyText = textBlocks.map(b => b.text).join('\n') || 'Request processed.';

  return {
    reply: replyText,
    toolCalls: toolCallResults,
    model: FALLBACK_MODEL,
    provider: 'anthropic',
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost: estimateAnthropicCost(totalInputTokens, totalOutputTokens)
    }
  };
}

// ── Main Chat Endpoint ────────────────────────────────────────────────

/**
 * POST /api/assistant/chat
 * Body: { message, conversation_id?, farm_id? }
 * Returns: { reply, conversation_id, actions?, tool_calls? }
 */

// ── Rate limiter — protect OpenAI credits ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 20; // max 20 messages per minute per farm

function checkRateLimit(farmId) {
  const now = Date.now();
  let entry = rateLimitMap.get(farmId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(farmId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

router.post('/chat', async (req, res) => {
  if (!openai && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'AI assistant not available — no LLM provider configured'
    });
  }

  const { message, conversation_id, farm_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const farmId = req.farmId || farm_id || 'demo-farm';

  if (!checkRateLimit(farmId)) {
    return res.status(429).json({ ok: false, error: 'Too many messages — please wait a moment before sending another.' });
  }

  const convId = conversation_id || crypto.randomUUID();
  const toolCallResults = [];

  // ── Handle pending action confirmations ──
  const isConfirm = /^(__confirm_action__|yes|yeah|yep|confirm|do it|go ahead|proceed|approved|sure|ok)$/i.test(sanitizedMessage);
  const isCancel = /^(__cancel_action__|cancel|no|nah|never mind|abort|don't|stop)$/i.test(sanitizedMessage);

  if (pendingActions.has(convId) && (isConfirm || isCancel)) {
    const pending = pendingActions.get(convId);
    pendingActions.delete(convId);

    const existing = await getConversation(convId, farmId);
    const history = existing ? [...existing.messages] : [];

    if (isCancel) {
      const cancelReply = 'Cancelled — no changes were made.';
      await upsertConversation(convId, [...history, { role: 'user', content: sanitizedMessage }, { role: 'assistant', content: cancelReply }], farmId);
      return res.json({ ok: true, reply: cancelReply, conversation_id: convId });
    }

    // Execute the confirmed write action
    try {
      pending.params.confirm = true;
      const result = await executeExtendedTool(pending.tool, pending.params, pending.farmId);

      toolCallResults.push({ tool: pending.tool, params: pending.params, success: result?.ok !== false });

      const systemPrompt = await buildSystemPrompt(farmId);
      const summaryCompletion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.filter(m => m.role !== 'system'),
          { role: 'user', content: 'I confirmed the action.' },
          { role: 'system', content: `User confirmed. Tool "${pending.tool}" executed. Result: ${JSON.stringify(result).slice(0, 1500)}. Summarize what was done concisely.` }
        ],
        temperature: 0.7,
        max_tokens: 400
      });

      const replyText = summaryCompletion.choices[0].message?.content || 'Done — action completed.';

      trackAiUsage({
        farm_id: farmId, endpoint: 'assistant-chat', model: MODEL,
        prompt_tokens: summaryCompletion.usage?.prompt_tokens,
        completion_tokens: summaryCompletion.usage?.completion_tokens,
        total_tokens: summaryCompletion.usage?.total_tokens,
        estimated_cost: estimateChatCost(MODEL, summaryCompletion.usage?.prompt_tokens || 0, summaryCompletion.usage?.completion_tokens || 0),
        status: 'success'
      });

      await upsertConversation(convId, [...history, { role: 'user', content: sanitizedMessage }, { role: 'assistant', content: replyText }], farmId);

      return res.json({
        ok: true, reply: replyText, conversation_id: convId,
        tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined, model: MODEL
      });
    } catch (err) {
      return res.json({ ok: true, reply: `Sorry, the action failed: ${err.message}`, conversation_id: convId });
    }
  }

  try {
    // Build conversation
    const existing = await getConversation(convId, farmId);
    const history = existing ? [...existing.messages] : [];

    // Build system prompt (only on first message or every 5 messages to save tokens)
    let systemPrompt;
    if (history.length === 0 || history.length % 5 === 0) {
      systemPrompt = await buildSystemPrompt(farmId);
    } else {
      // Reuse the system message from history
      const sysMsg = history.find(m => m.role === 'system');
      systemPrompt = sysMsg?.content || await buildSystemPrompt(farmId);
    }

    // Assemble messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.filter(m => m.role !== 'system'),
      { role: 'user', content: sanitizedMessage }
    ];

    // Call GPT with function calling
    let completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: GPT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1500
    });

    let assistantMessage = completion.choices[0].message;
    let loopCount = 0;
    const MAX_TOOL_LOOPS = 10;

    // Handle tool calls iteratively
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      // Add assistant's tool-calling message to history
      messages.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch { /* empty args */ }

        console.log(`[Assistant Chat] Tool call: ${fnName}(${JSON.stringify(fnArgs)})`);

        let toolResult;
        try {
          // Trust tier system for write tools
          const isWriteTool = TOOL_CATALOG[fnName]?.category === 'write' || TRUST_TIERS.confirm.has(fnName) || TRUST_TIERS.admin.has(fnName);
          const tier = getTrustTier(fnName);

          if (isWriteTool && tier === 'auto') {
            // AUTO tier: execute immediately, no confirmation
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
          } else if (isWriteTool && tier === 'quick_confirm') {
            // QUICK-CONFIRM tier: execute immediately with notice
            fnArgs.confirm = true;
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
            if (toolResult && toolResult.ok !== false) {
              toolResult._quick_confirmed = true;
              toolResult._notice = `Executed ${fnName}. The user can say "undo" within 30 seconds to revert.`;
            }
          } else if (isWriteTool && (tier === 'confirm' || tier === 'admin')) {
            // CONFIRM/ADMIN tier: store as pending — don't execute yet
            pendingActions.set(convId, { tool: fnName, params: fnArgs, farmId, created: Date.now() });
            toolResult = {
              status: 'pending_confirmation',
              message: tier === 'admin'
                ? 'This is an admin-level action requiring explicit confirmation. Describe what will happen and ask the user to type the action name to confirm.'
                : 'This action requires user confirmation before execution. Describe what will happen and ask the user to confirm or cancel.',
              tool: fnName,
              params: fnArgs
            };
          } else {
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
          }
        } catch (err) {
          toolResult = { ok: false, error: err.message };
        }

        // Self-solving: if tool failed, attempt auto-recovery
        if (toolResult && toolResult.ok === false && toolResult.error) {
          const recovery = await attemptAutoRecovery(fnName, fnArgs, toolResult.error, farmId);
          if (recovery.recovered) {
            toolResult = recovery.result;
            logger.info(`[Self-Solve] Auto-recovered ${fnName}: ${recovery.strategy}`);
          } else {
            // Log structured alert for GreenReach Central dashboard
            await logSystemAlert({
              alert_type: 'tool_failure',
              severity: 'medium',
              source: 'assistant-chat',
              tool: fnName,
              params: fnArgs,
              error: toolResult.error,
              recovery_attempted: recovery.strategy || 'none',
              farm_id: farmId,
              conversation_id: convId
            });
            // Enrich error for GPT so it can explain helpfully
            toolResult._self_solve_hint = recovery.hint || 'Report this error to the user and suggest an alternative approach.';
          }
        }

        toolCallResults.push({
          tool: fnName,
          params: fnArgs,
          success: toolResult?.ok !== false
        });

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
      }

      // Call GPT again with tool results (lower temperature for deterministic tool selection)
      completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: GPT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 1500
      });

      assistantMessage = completion.choices[0].message;
    }

    const replyText = assistantMessage.content || 'I processed your request but have nothing to add.';

    // Track AI usage
    trackAiUsage({
      farm_id: farmId,
      endpoint: 'assistant-chat',
      model: MODEL,
      prompt_tokens: completion.usage?.prompt_tokens,
      completion_tokens: completion.usage?.completion_tokens,
      total_tokens: completion.usage?.total_tokens,
      estimated_cost: estimateChatCost(MODEL, completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0),
      status: 'success'
    });

    // Save conversation history
    const updatedHistory = [
      ...history,
      { role: 'user', content: sanitizedMessage },
      { role: 'assistant', content: replyText }
    ];
    await upsertConversation(convId, updatedHistory, farmId);

    // Summarize long conversations periodically
    if (updatedHistory.length >= 30 && updatedHistory.length % 10 === 0) {
      summarizeConversation(updatedHistory, farmId).catch(() => {});
    }

    // Track engagement metrics
    const toolNames = toolCallResults.map(t => t.tool);
    trackEngagement(farmId, { messages: 1, toolCalls: toolNames.length, toolsUsed: toolNames });

    // Check if there's a pending action to signal to the frontend
    const pendingAction = pendingActions.get(convId);

    return res.json({
      ok: true,
      reply: replyText,
      conversation_id: convId,
      tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined,
      pending_action: pendingAction ? { tool: pendingAction.tool, params: pendingAction.params } : undefined,
      model: MODEL
    });

  } catch (error) {
    // Attempt Anthropic fallback before giving up
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.warn('[E.V.I.E.] OpenAI failed, attempting Anthropic fallback:', error.message);
        const fbExisting = await getConversation(convId, farmId);
        const fbHistory = fbExisting ? [...fbExisting.messages] : [];
        const fbSystemPrompt = await buildSystemPrompt(farmId);
        const fallbackResult = await chatWithAnthropicFallback(fbSystemPrompt, fbHistory, sanitizedMessage, farmId, convId);

        trackAiUsage({
          farm_id: farmId, endpoint: 'assistant-chat', model: fallbackResult.model,
          prompt_tokens: fallbackResult.usage.input_tokens,
          completion_tokens: fallbackResult.usage.output_tokens,
          total_tokens: fallbackResult.usage.total_tokens,
          estimated_cost: fallbackResult.usage.estimated_cost,
          status: 'success'
        });

        const fbUpdatedHistory = [
          ...fbHistory,
          { role: 'user', content: sanitizedMessage },
          { role: 'assistant', content: fallbackResult.reply }
        ];
        await upsertConversation(convId, fbUpdatedHistory, farmId);

        const fbToolNames = fallbackResult.toolCalls.map(t => t.tool);
        trackEngagement(farmId, { messages: 1, toolCalls: fbToolNames.length, toolsUsed: fbToolNames });

        const fbPendingAction = pendingActions.get(convId);
        return res.json({
          ok: true,
          reply: fallbackResult.reply,
          conversation_id: convId,
          tool_calls: fallbackResult.toolCalls.length > 0 ? fallbackResult.toolCalls : undefined,
          pending_action: fbPendingAction ? { tool: fbPendingAction.tool, params: fbPendingAction.params } : undefined,
          model: fallbackResult.model,
          provider: 'anthropic'
        });
      } catch (fallbackErr) {
        console.error('[E.V.I.E.] Both LLMs failed. OpenAI:', error.message, 'Anthropic:', fallbackErr.message);
      }
    }

    trackAiUsage({
      farm_id: farmId,
      endpoint: 'assistant-chat',
      model: MODEL,
      estimated_cost: 0,
      status: 'error',
      error_message: error.message
    });

    return res.status(500).json({
      ok: false,
      error: 'Failed to process your message. Please try again.'
    });
  }
});

// ── GET /state — E.V.I.E. Presence State ──────────────────────────────
// Aggregates environment, crops, tasks, alerts, and farm profile
// for the ambient orb and intelligence panel.

router.get('/state', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id || 'demo-farm';

    // Rooms + environment readings
    const roomsRaw = readJSON('rooms.json', {});
    const roomList = (roomsRaw.rooms || Object.values(roomsRaw)).filter(r => typeof r === 'object' && r.id);
    const envCache = readJSON('env-cache.json', {});
    const targetRanges = readJSON('target-ranges.json', {});
    const defaults = targetRanges.defaults || {};
    const zoneTgts = targetRanges.zones || {};

    const rooms = roomList.map(function (r) {
      const rid = r.id || r.room_id;
      const env = envCache[rid] || {};
      const zones = env.zones || {};
      var maxDrift = 0;
      var temp = null;
      var humidity = null;

      for (var zid in zones) {
        var z = zones[zid];
        var t = zoneTgts[zid] || defaults;
        if (z.temperature != null) {
          temp = z.temperature;
          var tTarget = ((t.temp_min || 20) + (t.temp_max || 26)) / 2;
          var tDrift = Math.abs(z.temperature - tTarget);
          if (tDrift > maxDrift) maxDrift = tDrift;
        }
        if (z.humidity != null) {
          humidity = z.humidity;
        }
      }
      return {
        name: r.name || r.label || rid,
        id: rid,
        temp: temp,
        temp_unit: 'C',
        humidity: humidity,
        drift: maxDrift
      };
    });

    // Crops (active plantings)
    const crops = [];
    const cropRegistry = readJSON('crop-registry.json', {});
    const cropsDb = cropRegistry.crops || cropRegistry;

    for (var ri = 0; ri < roomList.length; ri++) {
      var rm = roomList[ri];
      var rmId = rm.id || rm.room_id;
      var roomMap = readJSON('room-map-' + rmId + '.json', null);
      if (!roomMap) continue;
      var zoneArr = roomMap.zones || [];
      for (var zi = 0; zi < zoneArr.length; zi++) {
        var zone = zoneArr[zi];
        var trays = zone.trays || zone.positions || [];
        for (var ti = 0; ti < trays.length; ti++) {
          var tray = trays[ti];
          if (!tray.crop || !tray.planted_date) continue;
          var cropInfo = cropsDb[tray.crop] || {};
          var cycleDays = cropInfo.cycle_days || cropInfo.growthDays || 28;
          var plantedMs = new Date(tray.planted_date).getTime();
          var dayNum = Math.floor((Date.now() - plantedMs) / 86400000);
          var harvestIn = Math.max(0, cycleDays - dayNum);
          var stg = dayNum < 5 ? 'Germination' : dayNum < 14 ? 'Seedling' : dayNum < cycleDays - 5 ? 'Vegetative' : 'Harvest Ready';
          crops.push({
            name: tray.crop,
            room: rm.name || rmId,
            stage: stg,
            day: dayNum,
            harvest_in: harvestIn
          });
        }
      }
    }

    // Alerts
    var alertsRaw = readJSON('system-alerts.json', []);
    var alertArr = (Array.isArray(alertsRaw) ? alertsRaw : (alertsRaw.alerts || [])).filter(function (a) { return !a.resolved && !a.dismissed; });
    var alertItems = alertArr.map(function (a) {
      return {
        id: a.id || null,
        alert_type: a.alert_type || a.type || 'general',
        title: a.title || a.message || 'Alert',
        detail: a.detail || a.description || '',
        domain: a.domain || a.category || 'general',
        severity: a.severity || a.level || 'info',
        since: a.created_at || a.timestamp,
        zone: a.zone || null,
        reading: a.reading != null ? a.reading : null,
        target_min: a.target_min != null ? a.target_min : null,
        target_max: a.target_max != null ? a.target_max : null
      };
    });

    // Risks = high/critical alerts
    var risks = alertItems.filter(function (a) { return a.severity === 'high' || a.severity === 'critical'; });

    // Tasks (daily todo, lightweight)
    var tasks = [];
    try {
      var todoResult = await executeTool('get_daily_todo', { limit: 8 });
      if (todoResult && todoResult.tasks) {
        tasks = todoResult.tasks.map(function (t) {
          return {
            title: t.title || t.label || 'Task',
            detail: t.why || t.reason || '',
            score: t.score || 0
          };
        });
      }
    } catch (e) { /* non-fatal */ }

    // Recommendations: environment drift warnings + harvest readiness
    var recommendations = [];
    rooms.forEach(function (r) {
      if (r.drift && r.drift > 2) {
        recommendations.push({
          title: r.name + ' environment drift',
          detail: 'Temperature drifting ' + r.drift.toFixed(1) + ' degrees from target. Check HVAC and ventilation.',
          domain: 'environment',
          confidence: 0.8
        });
      }
    });
    crops.forEach(function (c) {
      if (c.harvest_in <= 2 && c.stage === 'Harvest Ready') {
        recommendations.push({
          title: c.name + ' ready to harvest',
          detail: c.name + ' in ' + c.room + ' is at day ' + c.day + '. Schedule harvest soon.',
          domain: 'crops',
          confidence: 0.9
        });
      }
    });

    // Insights from user memory (if DB available)
    var insights = [];
    if (isDatabaseAvailable()) {
      try {
        var memResult = await query(
          'SELECT key, value, updated_at FROM user_memory WHERE farm_id = $1 ORDER BY updated_at DESC LIMIT 10',
          [farmId]
        );
        insights = memResult.rows.map(function (r) {
          return { topic: r.key, insight: r.value, domain: 'memory' };
        });
      } catch (e) { /* non-fatal */ }
    }

    // Farm profile
    var farmName = '';
    var farmLocation = '';
    if (isDatabaseAvailable()) {
      try {
        var farmResult = await query('SELECT name, location FROM farms WHERE farm_id = $1 LIMIT 1', [farmId]);
        if (farmResult.rows.length > 0) {
          farmName = farmResult.rows[0].name || '';
          farmLocation = farmResult.rows[0].location || '';
        }
      } catch (e) { /* non-fatal */ }
    }

    // Unread notification count (lightweight)
    var unreadNotifications = 0;
    try {
      unreadNotifications = await notificationStore.getUnreadCount(farmId);
    } catch (e) { /* non-fatal */ }

    // Proactive message
    var proactiveMessage = null;
    if (risks.length > 0) {
      proactiveMessage = risks[0].title;
    } else if (recommendations.length > 0) {
      proactiveMessage = recommendations[0].title;
    }

    return res.json({
      ok: true,
      alerts: alertItems.length,
      alert_items: alertItems,
      rooms: rooms,
      crops: crops,
      tasks: tasks,
      risks: risks,
      recommendations: recommendations,
      insights: insights,
      farm_name: farmName,
      farm_location: farmLocation,
      proactive_message: proactiveMessage,
      unread_notifications: unreadNotifications
    });
  } catch (err) {
    logger.error('[E.V.I.E. State] Error:', err.message);
    return res.json({
      ok: true,
      alerts: 0, alert_items: [], rooms: [], crops: [], tasks: [],
      risks: [], recommendations: [], insights: [],
      farm_name: '', farm_location: '', proactive_message: null,
      unread_notifications: 0
    });
  }
});

/**
 * GET /api/assistant/status
 * Returns whether the assistant chat is available
 */
router.get('/status', async (req, res) => {
  let fallbackAvailable = false;
  try { fallbackAvailable = !!(await getAnthropicClient()); } catch { /* */ }
  res.json({
    ok: true,
    available: !!openai || fallbackAvailable,
    model: MODEL,
    active_conversations: conversations.size,
    llm: {
      primary: { provider: 'openai', model: MODEL, available: !!openai },
      fallback: { provider: 'anthropic', model: FALLBACK_MODEL, available: fallbackAvailable }
    },
    features: {
      streaming: true,
      trust_tiers: true,
      image_input: true,
      voice_first: true,
      workflows: true,
      reports: true,
      multi_farm: true,
      websocket_push: true,
      predictive_alerts: true
    }
  });
});

// ── Streaming Chat Endpoint (SSE) ─────────────────────────────────────

/**
 * POST /api/assistant/chat/stream
 * Body: { message, conversation_id?, farm_id?, image_url? }
 * Returns: Server-Sent Events stream with tokens as they arrive.
 */
router.post('/chat/stream', async (req, res) => {
  if (!openai && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, error: 'AI assistant not available — no LLM provider configured' });
  }

  const { message, conversation_id, farm_id, image_url } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const farmId = req.farmId || farm_id || 'demo-farm';

  if (!checkRateLimit(farmId)) {
    return res.status(429).json({ ok: false, error: 'Too many messages — please wait.' });
  }

  const convId = conversation_id || crypto.randomUUID();
  const toolCallResults = [];

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('start', { conversation_id: convId });

  try {
    const existing = await getConversation(convId, farmId);
    const history = existing ? [...existing.messages] : [];

    let systemPrompt;
    if (history.length === 0 || history.length % 5 === 0) {
      systemPrompt = await buildSystemPrompt(farmId);
    } else {
      const sysMsg = history.find(m => m.role === 'system');
      systemPrompt = sysMsg?.content || await buildSystemPrompt(farmId);
    }

    // Build user message content (text + optional image)
    let userContent = sanitizedMessage;
    if (image_url) {
      userContent = [
        { type: 'text', text: sanitizedMessage },
        { type: 'image_url', image_url: { url: image_url, detail: 'low' } }
      ];
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.filter(m => m.role !== 'system'),
      { role: 'user', content: userContent }
    ];

    // Use the vision model if image is provided
    const streamModel = image_url ? 'gpt-4o' : MODEL;

    // First pass: check if GPT wants to call tools (non-streaming)
    let completion = await openai.chat.completions.create({
      model: streamModel,
      messages,
      tools: GPT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1500
    });

    let assistantMessage = completion.choices[0].message;
    let loopCount = 0;

    // Handle tool calls (non-streaming, with progress events)
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < 10) {
      loopCount++;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { /* empty */ }

        // Send tool progress event
        sendEvent('tool_start', { tool: fnName, step: loopCount });

        let toolResult;
        try {
          const isWriteTool = TOOL_CATALOG[fnName]?.category === 'write' || TRUST_TIERS.confirm.has(fnName) || TRUST_TIERS.admin.has(fnName);
          const tier = getTrustTier(fnName);

          if (isWriteTool && tier === 'auto') {
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
          } else if (isWriteTool && tier !== 'auto') {
            pendingActions.set(convId, { tool: fnName, params: fnArgs, farmId, created: Date.now() });
            toolResult = { status: 'pending_confirmation', message: 'Requires user confirmation.', tool: fnName, params: fnArgs };
          } else {
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
          }
        } catch (err) {
          toolResult = { ok: false, error: err.message };
        }

        if (toolResult && toolResult.ok === false && toolResult.error) {
          const recovery = await attemptAutoRecovery(fnName, fnArgs, toolResult.error, farmId);
          if (recovery.recovered) toolResult = recovery.result;
        }

        toolCallResults.push({ tool: fnName, params: fnArgs, success: toolResult?.ok !== false });
        sendEvent('tool_done', { tool: fnName, success: toolResult?.ok !== false });

        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolResult) });
      }

      completion = await openai.chat.completions.create({
        model: streamModel,
        messages,
        tools: GPT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 1500
      });
      assistantMessage = completion.choices[0].message;
    }

    // Final response: stream the text if no more tool calls
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      let fullReply = '';

      if (assistantMessage.content) {
        // Content already available from tool-result follow-up — stream it directly (no extra LLM call)
        fullReply = assistantMessage.content;
        // Emit in small chunks for a streaming feel
        const chunkSize = 12;
        for (let i = 0; i < fullReply.length; i += chunkSize) {
          sendEvent('token', { text: fullReply.slice(i, i + chunkSize) });
        }
      } else {
        // No content yet — do a streaming completion
        const streamCompletion = await openai.chat.completions.create({
          model: streamModel,
          messages,
          temperature: 0.7,
          max_tokens: 1500,
          stream: true
        });

        for await (const chunk of streamCompletion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullReply += delta;
            sendEvent('token', { text: delta });
          }
        }
      }

      // Save conversation
      const updatedHistory = [
        ...history,
        { role: 'user', content: sanitizedMessage },
        { role: 'assistant', content: fullReply }
      ];
      await upsertConversation(convId, updatedHistory, farmId);

      // Summarize long conversations
      if (updatedHistory.length >= 30 && updatedHistory.length % 10 === 0) {
        summarizeConversation(updatedHistory, farmId).catch(() => {});
      }

      // Track engagement
      const toolNames = toolCallResults.map(t => t.tool);
      trackEngagement(farmId, { messages: 1, toolCalls: toolNames.length, toolsUsed: toolNames });

      const pendingAction = pendingActions.get(convId);
      sendEvent('done', {
        conversation_id: convId,
        tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined,
        pending_action: pendingAction ? { tool: pendingAction.tool, params: pendingAction.params } : undefined,
        model: streamModel
      });
    }
  } catch (error) {
    // Attempt Anthropic fallback before sending error
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.warn('[E.V.I.E. Stream] OpenAI failed, using Anthropic fallback:', error.message);
        sendEvent('fallback', { provider: 'anthropic', reason: error.message });

        const fbExisting = await getConversation(convId, farmId);
        const fbHistory = fbExisting ? [...fbExisting.messages] : [];
        const fbSystemPrompt = await buildSystemPrompt(farmId);
        const fallbackResult = await chatWithAnthropicFallback(fbSystemPrompt, fbHistory, sanitizedMessage, farmId, convId);

        // Emit reply as chunks for streaming feel
        const chunkSize = 12;
        for (let i = 0; i < fallbackResult.reply.length; i += chunkSize) {
          sendEvent('token', { text: fallbackResult.reply.slice(i, i + chunkSize) });
        }

        const fbUpdatedHistory = [
          ...fbHistory,
          { role: 'user', content: sanitizedMessage },
          { role: 'assistant', content: fallbackResult.reply }
        ];
        await upsertConversation(convId, fbUpdatedHistory, farmId);

        const fbToolNames = fallbackResult.toolCalls.map(t => t.tool);
        trackEngagement(farmId, { messages: 1, toolCalls: fbToolNames.length, toolsUsed: fbToolNames });

        trackAiUsage({
          farm_id: farmId, endpoint: 'assistant-chat', model: fallbackResult.model,
          prompt_tokens: fallbackResult.usage.input_tokens,
          completion_tokens: fallbackResult.usage.output_tokens,
          total_tokens: fallbackResult.usage.total_tokens,
          estimated_cost: fallbackResult.usage.estimated_cost,
          status: 'success'
        });

        const fbPendingAction = pendingActions.get(convId);
        sendEvent('done', {
          conversation_id: convId,
          tool_calls: fallbackResult.toolCalls.length > 0 ? fallbackResult.toolCalls : undefined,
          pending_action: fbPendingAction ? { tool: fbPendingAction.tool, params: fbPendingAction.params } : undefined,
          model: fallbackResult.model,
          provider: 'anthropic'
        });
        res.end();
        return;
      } catch (fallbackErr) {
        console.error('[E.V.I.E. Stream] Both LLMs failed. OpenAI:', error.message, 'Anthropic:', fallbackErr.message);
      }
    }

    console.error('[Stream Chat] Error:', error.message);
    sendEvent('error', { message: 'Failed to process your message.' });
  }

  res.end();
});

// ── Image Upload Endpoint ─────────────────────────────────────────────

/**
 * POST /api/assistant/upload-image
 * Accepts multipart/form-data with an image file.
 * Stores temporarily and returns a data URL for GPT-4o vision.
 */
router.post('/upload-image', async (req, res) => {
  try {
    // Read raw body as base64 (image sent as binary or base64 in JSON)
    const { image_data, content_type } = req.body;
    if (!image_data) {
      return res.status(400).json({ ok: false, error: 'image_data is required (base64 encoded)' });
    }

    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const mimeType = content_type || 'image/jpeg';
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ ok: false, error: 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.' });
    }

    // Validate base64 size (max 5MB)
    const sizeBytes = Buffer.from(image_data, 'base64').length;
    if (sizeBytes > 5 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: 'Image too large. Maximum 5MB.' });
    }

    // Return as data URL for GPT-4o vision
    const dataUrl = `data:${mimeType};base64,${image_data}`;
    return res.json({ ok: true, image_url: dataUrl, size_bytes: sizeBytes });
  } catch (err) {
    logger.error('[Upload Image] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to process image' });
  }
});

// ── Morning Briefing Endpoint ─────────────────────────────────────────

/**
 * GET /api/assistant/morning-briefing?farm_id=...
 * Returns a pre-composed daily briefing without an LLM call.
 * Fast, deterministic, cached for 4 hours.
 */
const briefingCache = new Map();
const BRIEFING_TTL_MS = 4 * 60 * 60 * 1000;

router.get('/morning-briefing', async (req, res) => {
  const farmId = req.farmId || req.query.farm_id || 'demo-farm';
  const cacheKey = `${farmId}:${new Date().toISOString().slice(0, 10)}`;

  // Return cached briefing if fresh
  const cached = briefingCache.get(cacheKey);
  if (cached && Date.now() - cached.created < BRIEFING_TTL_MS) {
    return res.json({ ok: true, briefing: cached.briefing, cached: true });
  }

  try {
    const sections = [];
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    // 1. Daily tasks
    try {
      const todoResult = await executeTool('get_daily_todo', { limit: 5 });
      if (todoResult?.tasks?.length > 0) {
        const highPriority = todoResult.tasks.filter(t => t.score >= 0.6).length;
        sections.push(`📋 <strong>${todoResult.task_count} tasks today</strong>${highPriority ? ` (${highPriority} high priority)` : ''}`);
      }
    } catch { /* non-fatal */ }

    // 2. Environment status
    try {
      const envData = await farmStore.get(farmId, 'telemetry');
      if (envData?.zones?.length > 0) {
        const temps = envData.zones
          .map(z => z.sensors?.tempC?.current ?? z.sensors?.temperature?.current)
          .filter(t => t != null);
        if (temps.length > 0) {
          const avg = (temps.reduce((s, t) => s + t, 0) / temps.length).toFixed(1);
          sections.push(`🌡️ All zones averaging ${avg}°C`);
        }
      }
    } catch { /* non-fatal */ }

    // 3. Active alerts
    try {
      const alertResult = await executeTool('get_alerts', {});
      if (alertResult?.ok && alertResult.count > 0) {
        const critical = alertResult.alerts.filter(a => (a.severity || a.level) === 'critical').length;
        sections.push(`⚠️ ${alertResult.count} active alert${alertResult.count > 1 ? 's' : ''}${critical ? ` (${critical} critical)` : ''}`);
      } else {
        sections.push('✅ No active alerts');
      }
    } catch { /* non-fatal */ }

    // 4. Orders due
    try {
      const orderResult = await executeTool('get_orders', {});
      if (orderResult?.ok && orderResult.orders?.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const dueSoon = orderResult.orders.filter(o => {
          const due = o.delivery_date || o.due_date;
          if (!due) return false;
          const daysUntil = Math.round((new Date(due) - new Date(today)) / 86400000);
          return daysUntil >= 0 && daysUntil <= 1;
        });
        if (dueSoon.length > 0) {
          sections.push(`📦 ${dueSoon.length} order${dueSoon.length > 1 ? 's' : ''} due for delivery today`);
        }
      }
    } catch { /* non-fatal */ }

    // 5. Market highlights
    try {
      if (isDatabaseAvailable()) {
        const mktResult = await query(
          `SELECT product, trend, trend_percent FROM market_price_trends WHERE ABS(trend_percent) > 5 ORDER BY ABS(trend_percent) DESC LIMIT 2`
        );
        if (mktResult.rows.length > 0) {
          const highlights = mktResult.rows.map(r =>
            `${r.product} ${r.trend === 'increasing' ? '↑' : '↓'} ${Math.abs(r.trend_percent)}%`
          ).join(', ');
          sections.push(`💰 Market movers: ${highlights}`);
        }
      }
    } catch { /* non-fatal */ }

    // 6. AI Pusher recommendations
    try {
      const aiRecsResult = await executeTool('get_ai_recommendations', {});
      if (aiRecsResult?.ok && aiRecsResult.count > 0) {
        sections.push(`🤖 ${aiRecsResult.count} AI recommendation${aiRecsResult.count > 1 ? 's' : ''} from network intelligence`);
      }
    } catch { /* non-fatal */ }

    const briefing = `<strong>${greeting}!</strong> Here's your daily briefing:<br><br>` +
      sections.map(s => `${s}`).join('<br>') +
      `<br><br>Say <em>"show tasks"</em> for the full list, or ask me anything.`;

    briefingCache.set(cacheKey, { briefing, created: Date.now() });

    return res.json({ ok: true, briefing, cached: false });
  } catch (err) {
    logger.error('[Morning Briefing] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to generate briefing' });
  }
});

// ── Contextual Nudge Endpoint ─────────────────────────────────────────

/**
 * GET /api/assistant/nudges?farm_id=...
 * Returns rule-based contextual nudges (no LLM call).
 * Light polling endpoint — frontend calls every 5 min.
 */
router.get('/nudges', async (req, res) => {
  const farmId = req.farmId || req.query.farm_id || 'demo-farm';
  const nudges = [];

  try {
    // 1. Market price increase > 10%
    if (isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT product, trend_percent FROM market_price_trends WHERE trend = 'increasing' AND trend_percent > 10 ORDER BY trend_percent DESC LIMIT 3`
        );
        for (const row of result.rows) {
          nudges.push({
            type: 'market_price',
            priority: 'medium',
            message: `${row.product} market prices are up ${row.trend_percent}% this week. Want me to update your pricing?`,
            action: `Update ${row.product} pricing`
          });
        }
      } catch { /* ok */ }
    }

    // 2. Orders due within 4 hours
    try {
      const orderResult = await executeTool('get_orders', {});
      if (orderResult?.ok) {
        const now = Date.now();
        for (const order of (orderResult.orders || [])) {
          const due = order.delivery_date || order.due_date;
          if (!due) continue;
          const hoursUntil = (new Date(due).getTime() - now) / 3600000;
          if (hoursUntil > 0 && hoursUntil <= 4 && order.status !== 'shipped' && order.status !== 'delivered') {
            nudges.push({
              type: 'order_due',
              priority: 'high',
              message: `Order for ${order.buyer_name || order.buyer || order.order_id} is due in ${Math.round(hoursUntil)}h. Status: ${order.status}. Want to see details?`,
              action: 'Show order details'
            });
          }
        }
      }
    } catch { /* ok */ }

    // 3. Crops ready to harvest (from daily todo)
    try {
      const todoResult = await executeTool('get_daily_todo', { category: 'harvest' });
      if (todoResult?.tasks?.length > 0) {
        const ready = todoResult.tasks.filter(t => t.title?.includes('Ready to harvest'));
        for (const task of ready.slice(0, 2)) {
          nudges.push({
            type: 'harvest_ready',
            priority: 'medium',
            message: `${task.title}. Want me to log a harvest?`,
            action: 'Log harvest'
          });
        }
      }
    } catch { /* ok */ }

    // 4. AI Pusher recommendations
    try {
      const aiResult = await executeTool('get_ai_recommendations', { limit: '1' });
      if (aiResult?.ok && aiResult.recommendations?.length > 0) {
        const rec = aiResult.recommendations[0];
        nudges.push({
          type: 'ai_recommendation',
          priority: rec.priority || 'medium',
          message: rec.message || rec.recommendation || rec.title || 'New AI recommendation available.',
          action: 'Show AI recommendations'
        });
      }
    } catch { /* ok */ }

    return res.json({ ok: true, nudges, count: nudges.length });
  } catch (err) {
    logger.error('[Nudges] Error:', err.message);
    return res.json({ ok: true, nudges: [], count: 0 });
  }
});

// ── Phase 6C: Feedback endpoint (now persisted to DB + in-memory) ────
const feedbackLog = [];            // in-memory ring buffer (last 500) — kept for fast reads
const FEEDBACK_MAX = 500;

router.post('/feedback', async (req, res) => {
  try {
    const { conversationId, rating, snippet } = req.body;
    if (!rating || !['up', 'down'].includes(rating)) {
      return res.status(400).json({ ok: false, error: 'Invalid rating' });
    }
    const farmId = req.user?.farmId || req.body.farm_id || 'unknown';
    const entry = {
      conversationId: String(conversationId || '').slice(0, 64),
      rating,
      snippet: String(snippet || '').slice(0, 200),
      ts: Date.now(),
      farmId
    };
    feedbackLog.push(entry);
    if (feedbackLog.length > FEEDBACK_MAX) feedbackLog.shift();

    // Persist to DB
    persistFeedbackToDB(farmId, entry.conversationId, rating, entry.snippet);

    logger.info(`[Feedback] ${rating} from farm=${farmId} conv=${entry.conversationId}`);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[Feedback] Error:', err.message);
    return res.status(500).json({ ok: false });
  }
});

// ── Phase 6B: Feedback stats for system-prompt context ──
function getFeedbackSummary(farmId) {
  // Try DB first, fall back to in-memory
  const farm = feedbackLog.filter(f => f.farmId === farmId);
  if (farm.length === 0) return null;
  const up = farm.filter(f => f.rating === 'up').length;
  const down = farm.filter(f => f.rating === 'down').length;
  return { total: farm.length, positive: up, negative: down, ratio: farm.length ? +(up / farm.length).toFixed(2) : 0 };
}

// ── User Memory REST Endpoints ─────────────────────────────────────────

// GET /api/assistant/memory?farm_id=... — return all memory for a farm
router.get('/memory', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id || 'demo-farm';
    const mem = await getUserMemory(farmId);
    return res.json({ ok: true, memory: mem, count: Object.keys(mem).length });
  } catch (err) {
    logger.error('[Memory] GET failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to load memory' });
  }
});

// POST /api/assistant/memory — save a memory { farm_id, key, value }
router.post('/memory', async (req, res) => {
  try {
    const { key, value, farm_id } = req.body;
    if (!key || !value) {
      return res.status(400).json({ ok: false, error: 'key and value are required' });
    }
    const farmId = req.farmId || farm_id || 'demo-farm';
    const saved = await saveUserMemory(farmId, key, value);
    return res.json({ ok: saved, key, value });
  } catch (err) {
    logger.error('[Memory] POST failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to save memory' });
  }
});

// ── Biweekly Engagement Report ──────────────────────────────────────────

/**
 * GET /api/assistant/engagement-report?farm_id=...&period=current|previous
 * Returns engagement metrics for biweekly reporting to GreenReach farms.
 */
router.get('/engagement-report', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id || 'demo-farm';
    const periodParam = req.query.period || 'current';

    if (!isDatabaseAvailable()) {
      return res.json({ ok: true, report: null, message: 'Database not available' });
    }

    // Get the requested period
    const now = new Date();
    let periodStart, periodEnd;
    if (periodParam === 'previous') {
      // Previous biweekly period
      const day = now.getDate();
      if (day <= 14) {
        // Currently in 1st-14th, previous was 15th-end of last month
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
        periodStart = prevMonth.toISOString().slice(0, 10);
        periodEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      } else {
        // Currently in 15th+, previous was 1st-14th
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        periodEnd = new Date(now.getFullYear(), now.getMonth(), 14).toISOString().slice(0, 10);
      }
    } else {
      // Current period
      const day = now.getDate();
      periodStart = new Date(now.getFullYear(), now.getMonth(), day <= 14 ? 1 : 15).toISOString().slice(0, 10);
      periodEnd = day <= 14
        ? new Date(now.getFullYear(), now.getMonth(), 14).toISOString().slice(0, 10)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    }

    // Fetch engagement metrics
    const metricsResult = await query(
      'SELECT * FROM engagement_metrics WHERE farm_id = $1 AND period_start = $2',
      [farmId, periodStart]
    );

    // Fetch feedback breakdown for this period
    const feedbackResult = await query(
      `SELECT rating, COUNT(*) as count FROM assistant_feedback
       WHERE farm_id = $1 AND created_at >= $2 AND created_at <= ($3::date + interval '1 day')
       GROUP BY rating`,
      [farmId, periodStart, periodEnd]
    );

    // Fetch memory facts count
    const memResult = await query(
      'SELECT COUNT(*) as count FROM user_memory WHERE farm_id = $1',
      [farmId]
    );

    // Fetch top tools from AI usage
    const usageResult = await query(
      `SELECT COUNT(*) as total_api_calls,
              SUM(COALESCE((total_tokens)::int, 0)) as total_tokens,
              SUM(COALESCE(estimated_cost, 0)) as total_cost
       FROM ai_usage
       WHERE farm_id = $1 AND created_at >= $2 AND created_at <= ($3::date + interval '1 day')
         AND endpoint = 'assistant-chat'`,
      [farmId, periodStart, periodEnd]
    );

    const metrics = metricsResult.rows[0] || {};
    const feedback = {};
    for (const row of feedbackResult.rows) feedback[row.rating] = parseInt(row.count);
    const usage = usageResult.rows[0] || {};

    const report = {
      farm_id: farmId,
      period: { start: periodStart, end: periodEnd, type: 'biweekly' },
      engagement: {
        total_sessions: metrics.total_sessions || 0,
        total_messages: metrics.total_messages || 0,
        total_tool_calls: metrics.total_tool_calls || 0,
        tools_used: metrics.tools_used || {},
        avg_messages_per_session: metrics.total_sessions > 0
          ? +((metrics.total_messages || 0) / metrics.total_sessions).toFixed(1) : 0
      },
      satisfaction: {
        positive: feedback.up || 0,
        negative: feedback.down || 0,
        total: (feedback.up || 0) + (feedback.down || 0),
        ratio: (feedback.up || 0) + (feedback.down || 0) > 0
          ? +((feedback.up || 0) / ((feedback.up || 0) + (feedback.down || 0))).toFixed(2) : null
      },
      learning: {
        memory_facts_saved: parseInt(memResult.rows[0]?.count || 0),
        personalisation_active: parseInt(memResult.rows[0]?.count || 0) > 0
      },
      cost: {
        total_api_calls: parseInt(usage.total_api_calls || 0),
        total_tokens: parseInt(usage.total_tokens || 0),
        estimated_cost_cad: parseFloat(usage.total_cost || 0).toFixed(4)
      },
      generated_at: new Date().toISOString()
    };

    return res.json({ ok: true, report });
  } catch (err) {
    logger.error('[EngagementReport] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to generate report' });
  }
});

// ── Notification Endpoints — In-app notification feed for E.V.I.E. ──────────

/**
 * GET /api/assistant/notifications
 * Fetch notifications for the current farm. Newest first.
 * Query: ?unread_only=true&limit=30&offset=0
 */
router.get('/notifications', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id || 'demo-farm';
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await notificationStore.getNotifications(farmId, { unreadOnly, limit, offset });
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[Notifications] Fetch error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to fetch notifications' });
  }
});

/**
 * POST /api/assistant/notifications/read
 * Mark notification(s) as read.
 * Body: { id: number } for single, or { all: true } for all.
 */
router.post('/notifications/read', async (req, res) => {
  try {
    const farmId = req.farmId || req.body?.farm_id || 'demo-farm';
    const { id, all } = req.body || {};

    if (all) {
      const count = await notificationStore.markAllRead(farmId);
      return res.json({ ok: true, marked: count });
    }
    if (id) {
      const ok = await notificationStore.markRead(parseInt(id), farmId);
      return res.json({ ok });
    }
    return res.status(400).json({ ok: false, error: 'Provide id or all:true' });
  } catch (err) {
    logger.error('[Notifications] Read error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to mark notifications read' });
  }
});

/**
 * POST /api/assistant/notifications/push
 * Push a notification (internal use by LE wholesale, email hooks, etc.).
 * Body: { farm_id, category, title, body, severity, source }
 */
router.post('/notifications/push', async (req, res) => {
  try {
    const { farm_id, category, title, body, severity, source } = req.body || {};
    if (!farm_id || !title) {
      return res.status(400).json({ ok: false, error: 'farm_id and title are required' });
    }
    const result = await notificationStore.pushNotification(farm_id, { category, title, body, severity, source });

    // Dispatch email + SMS for high/critical severity notifications
    alertNotifier.notify({ alert_type: category || 'notification', severity, title, detail: body, farm_id });
    return res.json({ ok: true, notification: result });
  } catch (err) {
    logger.error('[Notifications] Push error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to push notification' });
  }
});

// -- Alert Actions (dismiss/resolve from EVIE panel) --
router.post('/alerts/:alertId/dismiss', async (req, res) => {
  try {
    const alertId = req.params.alertId;
    const reason = req.body?.reason || 'Dismissed from EVIE';

    // Update system-alerts.json
    const alertsPath = path.join(DATA_DIR, 'system-alerts.json');
    let alerts = [];
    try {
      if (fs.existsSync(alertsPath)) {
        alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
        if (!Array.isArray(alerts)) alerts = alerts.alerts || [];
      }
    } catch { alerts = []; }

    const alert = alerts.find(function (a) { return a.id === alertId; });
    if (!alert) {
      return res.status(404).json({ ok: false, error: 'Alert not found' });
    }

    alert.dismissed = true;
    alert.dismissed_at = new Date().toISOString();
    alert.dismiss_reason = reason;

    const tmpPath = alertsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(alerts, null, 2));
    fs.renameSync(tmpPath, alertsPath);

    return res.json({ ok: true, alert_id: alertId, dismissed: true });
  } catch (err) {
    logger.error('[Alerts] Dismiss error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to dismiss alert' });
  }
});


export default router;
