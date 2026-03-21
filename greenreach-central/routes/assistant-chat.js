/**
 * AI Assistant Chat Endpoint — E.V.I.E. (Environmental Vision & Intelligence Engine)
 * ==================================================================================
 * POST /api/assistant/chat          — Standard request/response chat
 * POST /api/assistant/chat/stream   — SSE streaming chat with real-time tokens
 * POST /api/assistant/upload-image  — Image upload for crop diagnosis (GPT-4o vision)
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
  auto: new Set(['dismiss_alert', 'save_user_memory']),
  // QUICK-CONFIRM: Execute with brief undo window
  quick_confirm: new Set(['mark_harvest_complete']),
  // CONFIRM: Ask before executing (default for write tools)
  confirm: new Set([
    'update_crop_price', 'create_planting_assignment', 'update_order_status',
    'add_inventory_item', 'update_target_ranges', 'set_light_schedule',
    'update_nutrient_targets', 'register_device', 'auto_assign_devices',
    'seed_benchmarks', 'update_farm_profile', 'create_room', 'create_zone',
    'update_certifications', 'complete_setup'
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
      description: 'Trigger a real network/protocol scan for IoT devices (SwitchBot, Light Engine, wired sensors). Returns discovered devices that are NOT yet registered. After scanning, use register_device to add new devices to the inventory.',
      parameters: {
        type: 'object',
        properties: {
          protocol: { type: 'string', description: 'Protocol to scan: "all", "switchbot", "light-engine". Default: all.' }
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
      description: 'Forecast upcoming yields from active plantings — expected harvest dates, estimated weights, revenue projections based on crop benchmarks and pricing.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name (optional)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_cost_analysis',
      description: 'Analyze cost-per-tray and profitability for crops — grow time, estimated costs, revenue per tray, and profit margins. Sorted by margin.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name (optional)' }
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
        guardrails${summariesBlock}Block = '\nFARM ENVIRONMENT GUARDRAILS:\n' +
          Object.entries(byCategory).map(([cat, items]) => `${cat}:\n${items.join('\n')}`).join('\n\n') + '\n';
      }
    }
  } catch { /* non-fatal — guardrails enhance but aren't required */ }

  return `You are E.V.I.E. (Environmental Vision & Intelligence Engine) — the GreenReach Farm Assistant and an expert indoor vertical-farming advisor. You help farmers manage their CEA (Controlled Environment Agriculture) operations through natural conversation. You have access to real-time farm data, 50 crop growth recipes, market intelligence, and can execute actions. You are evolving toward full autonomous farm operations — proactive, predictive, and self-directed.

CURRENT FARM STATE:
${farmContext || 'No farm data available — user may need to set up their farm first.'}
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
- The farm has 50 day-by-day growth recipes. Each recipe defines DLI, PPFD, EC, pH, VPD, temperature, humidity, and light spectrum per day through every growth stage (Seedling → Vegetative → Flowering → Fruiting).
- Crops already have their own schedules. When asked "how long does X take" or "what does X need", use get_crop_schedule to give actual recipe data — do not guess.
- Recipes are the source of truth for lighting, nutrients, and environment targets.

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

DEVICE MANAGEMENT:
- When the farmer asks to scan for devices, discover hardware, or check what's connected:
  1. Call scan_devices to trigger a real network/protocol scan.
  2. Also call get_device_status to show the current inventory.
  3. Report what was found: new devices on the network + already registered devices.
  4. For each new device found, offer to register it using register_device.
- When the farmer asks to add, introduce, register, or set up a specific device (e.g. "add a dehumidifier to zone 1"):
  1. Call get_device_status to see the current inventory and available rooms.
  2. Use register_device with the device details (name, type, room_id, zone, protocol, brand).
  3. Device types: sensor, light_controller, fan_controller, dehumidifier, hvac, humidifier, irrigation, camera, hub, relay, meter, other.
  4. After registration, call get_device_status to verify it's in the inventory.
- Only offer auto_assign_devices when there are multiple unassigned devices that need bulk assignment.
- When asked "what devices do I have" or "show my devices", use get_device_status (no scan needed).

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

AUTONOMY MINDSET:
- You are evolving toward full farm autonomy. When you detect issues, don't just report — propose specific actions.
- Cross-reference data sources: combine sensor readings, crop schedules, harvest logs, nutrient data, and market data to give integrated advice.
- If a sensor shows low temperature AND a crop schedule requires higher temps, connect the dots and recommend both the environment fix AND the crop impact.
- If nutrient pH is drifting AND a crop is entering a sensitive growth stage, flag both issues together with a unified recommendation.
- When presenting yield forecasts, connect them to market pricing trends — suggest timing harvest/sales for maximum revenue.
- Track patterns: if the farmer repeatedly asks about the same metric, remember their focus areas using save_user_memory.
- Proactive alerts are generated every 5 minutes for environment, nutrient, and hardware issues. Reference these in your daily briefings.
${guardrailsBlock}
FARM SETUP GUIDANCE:
- You have tools to guide new farmers through setup: update_farm_profile, create_room, create_zone, list_rooms, update_certifications, get_onboarding_status, complete_setup.
- If CURRENT FARM STATE shows "Setup completed: No", proactively offer to walk the user through setup.
- Setup step order: (1) Business profile — farm name + contact info (update_farm_profile), (2) Location — city, province, timezone (update_farm_profile), (3) Rooms & zones — create grow rooms then zones inside them (create_room → create_zone), (4) Certifications — organic, GAP, practices (update_certifications), (5) Seed benchmarks (seed_benchmarks), (6) Finalize (complete_setup).
- Use get_onboarding_status to check what's done and what's remaining.
- After completing all steps, call complete_setup to finalize. Then congratulate the farmer and suggest next steps (add inventory, connect devices, create first planting plan).

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
- For WRITE operations (update_farm_profile, create_room, create_zone, update_certifications, complete_setup, update_crop_price, create_planting_assignment, mark_harvest_complete, update_order_status, add_inventory_item, dismiss_alert, auto_assign_devices, register_device, seed_benchmarks, update_nutrient_targets, update_target_ranges, set_light_schedule): you MUST describe the proposed change and ask the user to confirm BEFORE calling the tool. Do NOT call write tools until the user says "yes", "confirm", "do it", or similar.
- After any WRITE operation succeeds, verify by calling the corresponding read tool and report the confirmed result.
- If you can't help, say so briefly and suggest what you CAN do.
- Use Canadian English (colour, favourite, centre).
- Never fabricate data — only report what tools return.
- Format responses with simple HTML: <strong> for emphasis, <ul>/<li> for lists, <table class="evie-data-table"> for tabular data, <div class="evie-card"> for metric cards. Keep it clean.
- When listing tasks or items, show the top 3-5 most relevant, mention the total count.
- For prices, always show currency (CAD).
- When comparing crops, use tables for clarity.`;
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
        const pricing = await getCropPricing();
        return { ok: true, crops: pricing, count: pricing.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_planting_recommendations': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing();

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
        const cropPricing = await getCropPricing();

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
        const cropPricing = await getCropPricing();
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
        const cropPricing = await getCropPricing();
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
            const pricing = await getCropPricing();
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
  } catch (err) {
    logger.error('[System Alert] Failed to log alert:', err.message);
  }
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
  if (!openai) {
    return res.status(503).json({
      ok: false,
      error: 'AI assistant not available — OPENAI_API_KEY not configured'
    });
  }

  const { message, conversation_id, farm_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const farmId = farm_id || req.session?.farm_id || 'demo-farm';

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
          const isWriteTool = TOOL_CATALOG[fnName]?.category === 'write';
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
    console.error('[Assistant Chat] Error:', error.message);

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

/**
 * GET /api/assistant/status
 * Returns whether the assistant chat is available
 */
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    available: !!openai,
    model: MODEL,
    active_conversations: conversations.size,
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
  if (!openai) {
    return res.status(503).json({ ok: false, error: 'AI assistant not available' });
  }

  const { message, conversation_id, farm_id, image_url } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const farmId = farm_id || req.session?.farm_id || 'demo-farm';

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
          const isWriteTool = TOOL_CATALOG[fnName]?.category === 'write';
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
      // Re-run as streaming for the final text generation
      const streamCompletion = await openai.chat.completions.create({
        model: streamModel,
        messages: [...messages, ...(assistantMessage.content ? [] : [])],
        temperature: 0.7,
        max_tokens: 1500,
        stream: true
      });

      let fullReply = '';
      for await (const chunk of streamCompletion) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullReply += delta;
          sendEvent('token', { text: delta });
        }
      }

      // If streaming produced no content, use the non-streamed response
      if (!fullReply && assistantMessage.content) {
        fullReply = assistantMessage.content;
        sendEvent('token', { text: fullReply });
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
  const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
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
  const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
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
    const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
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
    const farmId = farm_id || req.session?.farm_id || 'demo-farm';
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
    const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
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

export default router;
