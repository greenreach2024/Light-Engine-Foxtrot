/**
 * Light Engine AI Agent
 * 
 * An intelligent assistant that can understand commands and take real actions
 * - Uses OpenAI for natural language understanding
 * - Executes system commands based on intent
 * - Provides context-aware responses
 * - Includes safety controls and confirmation for destructive actions
 * - Permission matrix gates actions by agent class and approval tier
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Permission matrix ──────────────────────────────────────────────────
let agentPermissions = null;

function loadPermissions() {
  if (agentPermissions) return agentPermissions;
  try {
    const raw = readFileSync(join(__dirname, '..', 'data', 'agent-permissions.json'), 'utf-8');
    agentPermissions = JSON.parse(raw);
    console.log('[AI Agent] Permission matrix loaded —', Object.keys(agentPermissions.agent_classes).length, 'agent classes');
  } catch (err) {
    console.error('[AI Agent] Failed to load agent-permissions.json:', err.message);
    agentPermissions = { agent_classes: {}, defaults: { unknown_action_tier: 'require-approval' } };
  }
  return agentPermissions;
}

/**
 * Check whether an agent class is allowed to perform an action and at what tier.
 * @param {string} agentClass - Agent class (e.g. 'farm-operator', 'admin-ops')
 * @param {string} category   - Action category (e.g. 'orders')
 * @param {string} action     - Specific action (e.g. 'create_order')
 * @returns {{ allowed: boolean, tier: string, reason?: string }}
 */
export function checkPermission(agentClass, category, action) {
  const perms = loadPermissions();
  const defaults = perms.defaults || {};

  // Resolve agent class — fall back to default
  const className = perms.agent_classes[agentClass]
    ? agentClass
    : (defaults.unknown_agent_class || 'farm-operator');

  const classDef = perms.agent_classes[className];
  if (!classDef) {
    return { allowed: false, tier: 'require-approval', reason: `Unknown agent class: ${agentClass}` };
  }

  const catPerms = classDef.capabilities?.[category];
  if (!catPerms) {
    return { allowed: false, tier: 'require-approval', reason: `Agent class "${className}" has no access to category "${category}"` };
  }

  const actionPerm = catPerms[action];
  if (!actionPerm) {
    // Action not listed — use default tier
    const fallbackTier = defaults.unknown_action_tier || 'require-approval';
    return { allowed: fallbackTier !== 'require-approval', tier: fallbackTier, reason: `Action "${action}" not explicitly listed; defaulting to ${fallbackTier}` };
  }

  return { allowed: true, tier: actionPerm.tier };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// System capabilities that the agent can perform
// Note: Lighting and temperature control are database-managed and not user-controllable
export const SYSTEM_CAPABILITIES = {
  inventory: {
    description: 'Manage farm inventory and products',
    actions: ['list_products', 'low_stock_alert', 'search_product', 'product_details', 'inventory_value']
  },
  orders: {
    description: 'View and manage sales orders',
    actions: ['list_orders', 'order_status', 'recent_orders', 'order_details', 'create_order']
  },
  sales: {
    description: 'Sales operations and customer management',
    actions: ['list_customers', 'customer_details', 'top_customers', 'revenue_today']
  },
  reports: {
    description: 'Generate reports and analytics',
    actions: ['sales_report', 'inventory_report', 'export_data', 'daily_summary']
  },
  checklists: {
    description: 'Daily operational checklists and workflows',
    actions: ['daily_checklist', 'harvest_checklist', 'quality_check', 'closing_checklist']
  },
  monitoring: {
    description: 'View system status and environmental readings (read-only)',
    actions: ['get_readings', 'zone_status', 'alert_status', 'view_automation']
  },
  system: {
    description: 'System information and health',
    actions: ['status', 'health_check', 'recent_activity']
  },
  // Phase 2 agent classes (tickets 2.1–2.3)
  admin: {
    description: 'Cross-farm operations: alert triage, SLA risk, ops summaries (admin-ops agent)',
    actions: ['cross_farm_summary', 'sla_risk_report', 'alert_triage', 'reassign_resources', 'override_schedule']
  },
  marketing: {
    description: 'Lead scoring, outreach copy, SEO drafts, conversion analytics (marketing agent)',
    actions: ['score_leads', 'generate_outreach', 'draft_seo_page', 'conversion_analytics', 'publish_content', 'send_campaign']
  },
  payroll: {
    description: 'Payout reconciliation, anomaly detection, compliance checks (payroll agent)',
    actions: ['reconcile_payouts', 'detect_anomalies', 'compliance_check', 'generate_pay_stub', 'execute_payout', 'adjust_rate']
  },
  // Phase 3 agent classes (tickets 3.7–3.8)
  deployment: {
    description: 'New site readiness scoring, preflight checks, deployment plan generation (deployment agent)',
    actions: ['site_readiness', 'preflight_check', 'generate_plan', 'compliance_baseline', 'network_topology']
  },
  viability: {
    description: 'Farm closure risk scoring, acquisition evaluation, growth scenario modeling (strategy agent)',
    actions: ['closure_risk', 'acquisition_eval', 'growth_scenarios', 'competitive_position', 'portfolio_optimization']
  },
  developer: {
    description: 'Developer mode: evaluate change requests, propose modifications, apply approved changes (human approval required)',
    actions: ['evaluate_request', 'propose_change', 'list_proposals', 'approve_proposal', 'reject_proposal']
  }
};

// System prompt for the AI agent
const SYSTEM_PROMPT = `You are an intelligent assistant for Light Engine Foxtrot, an indoor farming business management system. You help users manage daily operations, sales, inventory, and farm processes.

IMPORTANT: Lighting and environmental controls are database-managed. You can VIEW status but cannot control hardware directly.

Your capabilities include:
${Object.entries(SYSTEM_CAPABILITIES).map(([cat, info]) => `- ${cat}: ${info.description}`).join('\n')}

When a user asks you to do something, analyze their intent and respond with a JSON action plan:

{
  "intent": "category.action",
  "confidence": 0.95,
  "parameters": { "key": "value" },
  "requires_confirmation": false,
  "response": "Natural language response to user"
}

Examples:
- "Show me today's orders" → {"intent": "orders.recent_orders", "confidence": 0.95, "parameters": {"timeframe": "today"}, "requires_confirmation": false, "response": "Here are today's orders."}
- "What's the temperature?" → {"intent": "monitoring.get_readings", "confidence": 0.98, "parameters": {}, "requires_confirmation": false, "response": "Let me check the current environmental readings."}
- "Daily checklist" → {"intent": "checklists.daily_checklist", "confidence": 0.92, "parameters": {}, "requires_confirmation": false, "response": "Here's your daily operations checklist."}
- "Generate sales report" → {"intent": "reports.sales_report", "confidence": 0.93, "parameters": {}, "requires_confirmation": false, "response": "I'll generate your sales report."}

Always be helpful, concise, and accurate. If you're unsure about a request, ask for clarification.`;

/**
 * Parse user command using OpenAI
 * @param {string} userMessage - User's natural language command
 * @param {array} conversationHistory - Previous messages for context
 * @returns {Promise<object>} Intent and action plan
 */
export async function parseCommand(userMessage, conversationHistory = []) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
  }

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        messages: messages,
        temperature: 0.3, // Lower temperature for more consistent parsing
        max_tokens: 500,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
    return result;

  } catch (error) {
    console.error('[AI Agent] Command parsing failed:', error.response?.data || error.message);
    throw new Error(`Failed to parse command: ${error.message}`);
  }
}

/**
 * Execute an action based on parsed intent
 * @param {object} intent - Parsed intent from parseCommand
 * @param {object} context - Execution context (farmId, userId, stores, etc.)
 * @returns {Promise<object>} Action result
 */
export async function executeAction(intent, context) {
  const { farmStores, farmId, userId, agentClass } = context;
  const [category, action] = intent.intent.split('.');

  // Verify capability exists
  if (!SYSTEM_CAPABILITIES[category] || !SYSTEM_CAPABILITIES[category].actions.includes(action)) {
    return {
      success: false,
      error: 'unknown_action',
      message: `I don't know how to perform: ${intent.intent}`
    };
  }

  // ── Permission gate ──────────────────────────────────────────────────
  const perm = checkPermission(agentClass || 'farm-operator', category, action);

  if (!perm.allowed) {
    console.log(`[AI Agent] BLOCKED ${intent.intent} for class="${agentClass}": ${perm.reason}`);
    return {
      success: false,
      error: 'permission_denied',
      message: perm.reason || `Agent class "${agentClass}" is not permitted to perform ${intent.intent}`,
      tier: perm.tier
    };
  }

  if (perm.tier === 'require-approval') {
    console.log(`[AI Agent] APPROVAL REQUIRED for ${intent.intent} (class="${agentClass}")`);
    return {
      success: false,
      error: 'approval_required',
      message: `This action requires human approval before execution: ${intent.intent}`,
      tier: 'require-approval',
      intent: intent
    };
  }

  if (perm.tier === 'recommend') {
    // Allow execution but flag the result as a recommendation
    console.log(`[AI Agent] RECOMMEND tier for ${intent.intent} (class="${agentClass}")`);
  }

  // Execute based on category and action
  try {
    let result;
    switch (category) {
      case 'inventory':
        result = await executeInventoryAction(action, intent.parameters, context);
        break;
      
      case 'orders':
        result = await executeOrdersAction(action, intent.parameters, context);
        break;
      
      case 'sales':
        result = await executeSalesAction(action, intent.parameters, context);
        break;
      
      case 'reports':
        result = await executeReportsAction(action, intent.parameters, context);
        break;
      
      case 'checklists':
        result = await executeChecklistsAction(action, intent.parameters, context);
        break;
      
      case 'monitoring':
        result = await executeMonitoringAction(action, intent.parameters, context);
        break;
      
      case 'system':
        result = await executeSystemAction(action, intent.parameters, context);
        break;
      
      case 'admin':
        result = await executeAdminAction(action, intent.parameters, context);
        break;
      
      case 'marketing':
        result = await executeMarketingAction(action, intent.parameters, context);
        break;
      
      case 'payroll':
        result = await executePayrollAction(action, intent.parameters, context);
        break;
      
      case 'deployment':
        result = await executeDeploymentAction(action, intent.parameters, context);
        break;
      
      case 'viability':
        result = await executeViabilityAction(action, intent.parameters, context);
        break;
      
      case 'developer':
        result = await executeDeveloperAction(action, intent.parameters, context);
        break;
      
      default:
        return {
          success: false,
          error: 'unknown_category',
          message: `Category not implemented: ${category}`
        };
    }

    // Tag recommend-tier results so the UI can present them as suggestions
    if (perm.tier === 'recommend' && result?.success) {
      result.tier = 'recommend';
      result.requiresConfirmation = true;
    }

    return result;
  } catch (error) {
    console.error(`[AI Agent] Action execution failed (${intent.intent}):`, error);
    return {
      success: false,
      error: 'execution_failed',
      message: error.message
    };
  }
}

/**
async function executeInventoryAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'list_products':
      const inventory = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      return {
        success: true,
        message: `Found ${inventory.length} products`,
        data: { 
          products: inventory.map(p => ({
            sku: p.sku_id,
            name: p.product_name,
            available: p.available,
            total: p.quantity_total,
            price: p.price_per_unit
          }))
        }
      };

    case 'low_stock_alert':
      const allProducts = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const threshold = params.threshold || 10;
      const lowStock = allProducts.filter(p => p.available < threshold);
      return {
        success: true,
        message: `Found ${lowStock.length} low stock items`,
        data: { 
          threshold,
          low_stock_items: lowStock.map(p => ({
            sku: p.sku_id,
            name: p.product_name,
            available: p.available
          }))
        }
      };

    case 'search_product':
      const searchTerm = params.query || params.name;
      if (!searchTerm) {
        return {
          success: false,
          error: 'missing_parameter',
          message: 'Please specify a product name or SKU to search'
        };
      }
      const invSearch = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const matches = invSearch.filter(p => 
        p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku_id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      return {
        success: true,
        message: `Found ${matches.length} matching products`,
        data: { query: searchTerm, products: matches }
      };

    case 'product_details':
      const sku = params.sku;
      if (!sku) {
        return {
          success: false,
          error: 'missing_parameter',
          message: 'Please specify a SKU'
        };
      }
      const allInv = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const product = allInv.find(p => p.sku_id === sku);
      if (!product) {
        return {
          success: false,
          error: 'not_found',
          message: `Product ${sku} not found`
        };
      }
      return {
        success: true,
        message: `Details for ${product.product_name}`,
        data: { product }
      };

    case 'inventory_value':
      const products = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const totalValue = products.reduce((sum, p) => 
        sum + (p.available * (p.price_per_unit || 0)), 0
      );
      const totalUnits = products.reduce((sum, p) => sum + p.available, 0);
      return {
        success: true,
        message: `Total inventory value: $${totalValue.toFixed(2)}`,
        data: { 
          total_value: totalValue,
          total_units: totalUnits,
          product_count: products.length,
          average_price: products.length > 0 ? totalValue / totalUnits : 0
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Inventory action not yet implemented: ${action}`
      };
  }
}

/**
 * Execute order management actions
 */
async function executeOrdersAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'list_orders':
    case 'recent_orders':
      const orders = farmStores.orders?.getAllForFarm?.(farmId) || [];
      const timeframe = params.timeframe || 'all';
      
      let filteredOrders = orders;
      if (timeframe === 'today') {
        const today = new Date().toISOString().split('T')[0];
        filteredOrders = orders.filter(o => 
          o.timestamps?.created_at?.startsWith(today)
        );
      }
      
      return {
        success: true,
        message: `Found ${filteredOrders.length} orders${timeframe === 'today' ? ' today' : ''}`,
        data: {
          orders: filteredOrders.slice(0, 20).map(o => ({
            order_id: o.order_id,
            customer: o.customer_name || 'Walk-up',
            total: o.payment?.amount || 0,
            status: o.status,
            created: o.timestamps?.created_at
          }))
        }
      };

    case 'order_status':
    case 'order_details':
      const orderId = params.order_id;
      if (!orderId) {
        return {
          success: false,
          error: 'missing_parameter',
          message: 'Please specify order_id'
        };
      }
      
      const allOrders = farmStores.orders?.getAllForFarm?.(farmId) || [];
      const order = allOrders.find(o => o.order_id === orderId);
      
      if (!order) {
        return {
          success: false,
          error: 'order_not_found',
          message: `Order ${orderId} not found`
        };
      }
      
      return {
        success: true,
        message: `Order ${orderId} details`,
        data: { order }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Orders action not yet implemented: ${action}`
      };
  }
}

/**
async function executeReportsAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'sales_report':
      const orders = farmStores.orders?.getAllForFarm?.(farmId) || [];
      const totalRevenue = orders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
      const totalOrders = orders.length;
      
      return {
        success: true,
        message: 'Sales report generated',
        data: {
          total_orders: totalOrders,
          total_revenue: totalRevenue,
          average_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0
        }
      };

    case 'inventory_report':
      const inventory = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const totalValue = inventory.reduce((sum, i) => 
        sum + (i.available * (i.price_per_unit || 0)), 0
      );
      
      return {
        success: true,
        message: 'Inventory report generated',
        data: {
          total_products: inventory.length,
          total_units: inventory.reduce((sum, i) => sum + i.available, 0),
          total_value: totalValue
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Reports action not yet implemented: ${action}`
      };
  }
}

/**
 * Execute system actions
 */
async function executeSystemAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'status':
    case 'health_check':
      const zones = farmStores.zones?.getAllForFarm?.(farmId) || [];
      const orders = farmStores.orders?.getAllForFarm?.(farmId) || [];
      const inventory = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      
      return {
        success: true,
        message: 'System health check complete',
        data: {
          status: 'healthy',
          farm_id: farmId,
          zones: zones.length,
          orders: orders.length,
          inventory_items: inventory.length,
          uptime: process.uptime()
        }
      };

    case 'recent_activity':
      const recentOrders = (farmStores.orders?.getAllForFarm?.(farmId) || [])
        .sort((a, b) => new Date(b.timestamps?.created_at) - new Date(a.timestamps?.created_at))
        .slice(0, 5);
      
      return {
        success: true,
        message: 'Recent activity',
        data: {
          recent_orders: recentOrders.map(o => ({
            order_id: o.order_id,
            customer: o.customer_name,
            amount: o.payment?.amount,
            created: o.timestamps?.created_at
          }))
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `System action not yet implemented: ${action}`
      };
  }
}

/**
 * Execute sales and customer management actions
 */
async function executeSalesAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'list_customers':
      const customers = farmStores.customers?.getAllForFarm?.(farmId) || [];
      return {
        success: true,
        message: `Found ${customers.length} customers`,
        data: {
          customers: customers.slice(0, 50).map(c => ({
            customer_id: c.customer_id,
            name: c.name,
            email: c.email,
            phone: c.phone
          }))
        }
      };

    case 'top_customers':
      const limit = params.limit || 10;
      const allOrders = farmStores.orders?.getAllForFarm?.(farmId) || [];
      const customerSpending = {};
      
      allOrders.forEach(order => {
        const custId = order.customer_id || 'walk-up';
        const custName = order.customer_name || 'Walk-up';
        if (!customerSpending[custId]) {
          customerSpending[custId] = { name: custName, total: 0, orders: 0 };
        }
        customerSpending[custId].total += order.payment?.amount || 0;
        customerSpending[custId].orders += 1;
      });
      
      const topCustomers = Object.entries(customerSpending)
        .map(([id, data]) => ({ customer_id: id, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
      
      return {
        success: true,
        message: `Top ${topCustomers.length} customers by revenue`,
        data: { top_customers: topCustomers }
      };

    case 'revenue_today':
      const today = new Date().toISOString().split('T')[0];
      const todayOrders = (farmStores.orders?.getAllForFarm?.(farmId) || [])
        .filter(o => o.timestamps?.created_at?.startsWith(today));
      
      const revenue = todayOrders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
      
      return {
        success: true,
        message: `Today's revenue: $${revenue.toFixed(2)}`,
        data: {
          date: today,
          revenue: revenue,
          order_count: todayOrders.length,
          average_order: todayOrders.length > 0 ? revenue / todayOrders.length : 0
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Sales action not yet implemented: ${action}`
      };
  }
}

/**
 * Execute checklist and workflow actions
 */
async function executeChecklistsAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'daily_checklist':
      const checklist = {
        morning: [
          { task: 'Check environmental conditions', status: 'pending', priority: 'high' },
          { task: 'Inspect plant health (walk zones)', status: 'pending', priority: 'high' },
          { task: 'Check nutrient levels', status: 'pending', priority: 'medium' },
          { task: 'Review automation logs', status: 'pending', priority: 'low' },
          { task: 'Check for low inventory items', status: 'pending', priority: 'medium' }
        ],
        afternoon: [
          { task: 'Process today\'s orders', status: 'pending', priority: 'high' },
          { task: 'Update harvest records', status: 'pending', priority: 'medium' },
          { task: 'Prepare tomorrow\'s shipments', status: 'pending', priority: 'medium' }
        ],
        evening: [
          { task: 'Final zone inspection', status: 'pending', priority: 'medium' },
          { task: 'Review sales report', status: 'pending', priority: 'low' },
          { task: 'Check closing checklist', status: 'pending', priority: 'high' }
        ]
      };
      
      return {
        success: true,
        message: 'Daily operations checklist generated',
        data: { checklist, date: new Date().toISOString().split('T')[0] }
      };

    case 'harvest_checklist':
      const harvestChecklist = [
        { step: 1, task: 'Verify maturity dates', notes: 'Check planting scheduler' },
        { step: 2, task: 'Prepare harvest containers', notes: 'Clean, sanitized bins' },
        { step: 3, task: 'Record lot codes', notes: 'Zone-Crop-Date-Batch format' },
        { step: 4, task: 'Harvest in proper sequence', notes: 'FIFO - oldest first' },
        { step: 5, task: 'Weigh and record yields', notes: 'Update inventory immediately' },
        { step: 6, task: 'Quality inspection', notes: 'Check for defects, damage' },
        { step: 7, task: 'Package and label', notes: 'Include lot code on all packages' },
        { step: 8, task: 'Update inventory system', notes: 'Mark trays as harvested' },
        { step: 9, task: 'Store properly', notes: 'Temperature and humidity controlled' }
      ];
      
      return {
        success: true,
        message: 'Harvest procedure checklist',
        data: { checklist: harvestChecklist, total_steps: harvestChecklist.length }
      };

    case 'quality_check':
      const inventory = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const qualityChecks = [
        {
          category: 'Low Stock',
          items: inventory.filter(p => p.available < 10),
          action: 'Plan harvest or restock'
        }
      ];
      
      return {
        success: true,
        message: 'Quality and inventory checks',
        data: { checks: qualityChecks }
      };

    case 'closing_checklist':
      const closingTasks = [
        { task: 'Complete all orders', status: 'pending', required: true },
        { task: 'Reconcile cash drawer', status: 'pending', required: true },
        { task: 'Review tomorrow\'s schedule', status: 'pending', required: false },
        { task: 'Check zone temperatures', status: 'pending', required: true },
        { task: 'Secure facility', status: 'pending', required: true },
        { task: 'Update staff notes', status: 'pending', required: false }
      ];
      
      return {
        success: true,
        message: 'End-of-day closing checklist',
        data: { tasks: closingTasks }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Checklist action not yet implemented: ${action}`
      };
  }
}

/**
 * Execute monitoring actions (read-only environmental data)
 */
async function executeMonitoringAction(action, params, context) {
  const { farmStores, farmId } = context;

  switch (action) {
    case 'get_readings':
      const sensors = farmStores.sensorData?.getAllForFarm?.(farmId) || [];
      const latestReadings = sensors
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10);
      
      return {
        success: true,
        message: `Retrieved ${latestReadings.length} recent sensor readings`,
        data: { 
          readings: latestReadings,
          note: 'Environmental controls are database-managed'
        }
      };

    case 'zone_status':
      const zones = farmStores.zones?.getAllForFarm?.(farmId) || [];
      const zoneStatus = zones.map(z => ({
        zone_id: z.zone_id,
        name: z.name,
        type: z.type,
        is_on: z.is_on,
        current_brightness: z.current_brightness,
        current_temp: z.current_temp,
        target_temp: z.target_temp
      }));
      
      return {
        success: true,
        message: `Found ${zoneStatus.length} zones (read-only)`,
        data: { 
          zones: zoneStatus,
          note: 'Contact admin to modify zone settings'
        }
      };

    case 'alert_status':
      const allSensors = farmStores.sensorData?.getAllForFarm?.(farmId) || [];
      const alerts = [];
      
      // Check for temperature alerts
      const recentTemp = allSensors.find(s => s.type === 'temperature');
      if (recentTemp && (recentTemp.value > 80 || recentTemp.value < 60)) {
        alerts.push({
          type: 'temperature',
          severity: 'warning',
          message: `Temperature ${recentTemp.value > 80 ? 'high' : 'low'}: ${recentTemp.value}°F`
        });
      }
      
      // Check for low inventory
      const inventory = farmStores.inventory?.getAllForFarm?.(farmId) || [];
      const lowStock = inventory.filter(p => p.available < 10);
      if (lowStock.length > 0) {
        alerts.push({
          type: 'inventory',
          severity: 'info',
          message: `${lowStock.length} items low in stock`
        });
      }
      
      return {
        success: true,
        message: alerts.length > 0 ? `Found ${alerts.length} alerts` : 'No alerts - all systems normal',
        data: { alerts, status: alerts.length === 0 ? 'healthy' : 'needs_attention' }
      };

    case 'view_automation':
      const rules = farmStores.automationRules?.getAllForFarm?.(farmId) || [];
      return {
        success: true,
        message: `Found ${rules.length} automation rules (read-only)`,
        data: {
          rules: rules.map(r => ({
            rule_id: r.rule_id,
            name: r.name,
            enabled: r.enabled,
            trigger_type: r.trigger_type
          })),
          note: 'Automation is database-managed. Contact admin to modify rules.'
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Monitoring action not yet implemented: ${action}`
      };
  }
}

// ── Phase 2, Ticket 2.1: Admin Ops Agent ────────────────────────────────
async function executeAdminAction(action, params, context) {
  switch (action) {
    case 'cross_farm_summary': {
      // Recommendation-only: summarize network status
      return {
        success: true,
        message: 'Cross-farm summary generated (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation connects to Central /api/admin/health/fleet. Currently returns recommendation stub.',
          recommended_actions: [
            'Review farms with fill rate below 80%',
            'Check SLA risk for orders due within 24 hours',
            'Triage any open critical alerts'
          ]
        }
      };
    }

    case 'sla_risk_report': {
      return {
        success: true,
        message: 'SLA risk assessment generated (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation queries pending orders vs. projected harvest. Currently returns framework.',
          risk_factors: ['pending_orders_volume', 'harvest_projection_gap', 'delivery_capacity']
        }
      };
    }

    case 'alert_triage': {
      return {
        success: true,
        message: 'Alert triage completed (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation aggregates alerts from all farms, ranks by severity.',
          triage_categories: ['critical', 'warning', 'info']
        }
      };
    }

    case 'reassign_resources':
    case 'override_schedule':
      return {
        success: true,
        message: `Action "${action}" prepared as recommendation. Requires human approval to execute.`,
        data: { action, parameters: params, requires_approval: true }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Admin action not yet implemented: ${action}`
      };
  }
}

// ── Phase 2, Ticket 2.2: Marketing Growth Agent ────────────────────────
async function executeMarketingAction(action, params, context) {
  switch (action) {
    case 'score_leads': {
      // Read leads from the purchase-leads DB via the API
      let leads = [];
      try {
        const port = process.env.PORT || 3000;
        const leadsRes = await fetch(`http://localhost:${port}/api/purchase/leads`, {
          signal: AbortSignal.timeout(3000)
        });
        if (leadsRes.ok) {
          const data = await leadsRes.json();
          leads = data.leads || [];
        }
      } catch (_) {}

      // Simple scoring: newer leads + specified plan = higher score
      const scored = leads.map(lead => {
        let score = 50;
        if (lead.plan === 'cloud') score += 20;
        else if (lead.plan === 'edge') score += 10;
        const daysOld = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);
        score -= Math.min(daysOld * 2, 30); // Decay 2 pts/day, max -30
        if (lead.status === 'contacted') score += 5;
        if (lead.status === 'scheduled') score += 15;
        if (lead.status === 'converted') score += 25;
        return { lead_id: lead.lead_id, farm_name: lead.farm_name, email: lead.email, status: lead.status, score: Math.max(0, Math.min(100, score)) };
      }).sort((a, b) => b.score - a.score);

      return {
        success: true,
        message: `Scored ${scored.length} leads`,
        data: { leads_scored: scored.length, top_leads: scored.slice(0, 10) }
      };
    }

    case 'generate_outreach': {
      return {
        success: true,
        message: 'Outreach copy draft generated (recommendation mode)',
        data: {
          draft_type: 'email',
          note: 'Full implementation uses GPT to generate personalized copy based on lead profile.',
          template: 'Hi {contact_name}, thank you for your interest in GreenReach Light Engine...',
          requires_review: true
        }
      };
    }

    case 'draft_seo_page': {
      return {
        success: true,
        message: 'SEO page draft prepared (recommendation mode)',
        data: {
          note: 'Full implementation uses GPT to generate optimized landing page content.',
          parameters: params,
          requires_review: true
        }
      };
    }

    case 'conversion_analytics': {
      // Compute funnel metrics from leads
      let leads = [];
      try {
        const port = process.env.PORT || 3000;
        const leadsRes = await fetch(`http://localhost:${port}/api/purchase/leads`, {
          signal: AbortSignal.timeout(3000)
        });
        if (leadsRes.ok) {
          const data = await leadsRes.json();
          leads = data.leads || [];
        }
      } catch (_) {}

      const funnel = {
        total_leads: leads.length,
        new: leads.filter(l => l.status === 'new').length,
        contacted: leads.filter(l => l.status === 'contacted').length,
        scheduled: leads.filter(l => l.status === 'scheduled').length,
        converted: leads.filter(l => l.status === 'converted').length,
        declined: leads.filter(l => l.status === 'declined').length
      };

      // Drop-off rates
      const stages = ['new', 'contacted', 'scheduled', 'converted'];
      const dropOff = {};
      for (let i = 0; i < stages.length - 1; i++) {
        const from = funnel[stages[i]] + funnel[stages[i + 1]]; // total who reached this stage
        const to = funnel[stages[i + 1]];
        dropOff[`${stages[i]}_to_${stages[i + 1]}`] = from > 0 ? +((to / from) * 100).toFixed(1) : 0;
      }

      return {
        success: true,
        message: `Funnel analytics: ${leads.length} total leads`,
        data: { funnel, drop_off_rates: dropOff }
      };
    }

    case 'publish_content':
    case 'send_campaign':
      return {
        success: true,
        message: `Action "${action}" prepared as draft. Requires human approval before execution.`,
        data: { action, parameters: params, requires_approval: true }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Marketing action not yet implemented: ${action}`
      };
  }
}

// ── Phase 2, Ticket 2.3: Payroll & Settlement Agent ────────────────────
async function executePayrollAction(action, params, context) {
  switch (action) {
    case 'reconcile_payouts': {
      return {
        success: true,
        message: 'Payout reconciliation report generated (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation queries wholesale order history and compares against disbursement records.',
          checks: ['order_total_vs_payout', 'delivery_confirmation_match', 'pricing_agreement_check']
        }
      };
    }

    case 'detect_anomalies': {
      return {
        success: true,
        message: 'Anomaly scan completed (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation applies statistical outlier detection to payment time series.',
          anomaly_types: ['duplicate_payment', 'amount_outlier', 'timing_irregularity', 'missing_confirmation']
        }
      };
    }

    case 'compliance_check': {
      return {
        success: true,
        message: 'Compliance check completed (recommendation mode)',
        data: {
          generated_at: new Date().toISOString(),
          note: 'Full implementation verifies payment records against policy rules.',
          policy_areas: ['payment_frequency', 'minimum_threshold', 'tax_withholding', 'documentation']
        }
      };
    }

    case 'generate_pay_stub':
      return {
        success: true,
        message: 'Pay stub draft generated (recommendation mode)',
        data: { action, parameters: params, requires_review: true }
      };

    case 'execute_payout':
    case 'adjust_rate':
      return {
        success: true,
        message: `Action "${action}" prepared. Requires human approval before execution.`,
        data: { action, parameters: params, requires_approval: true }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Payroll action not yet implemented: ${action}`
      };
  }
}

// ── Phase 3 Ticket 3.7: Product Deployment Agent ──────────────────────────

async function executeDeploymentAction(action, params, context) {
  const port = process.env.PORT || 8091;

  switch (action) {
    case 'site_readiness': {
      // Assess readiness by checking key system components
      const checks = [];
      let score = 100;

      // Check API connectivity
      try {
        const resp = await fetch(`http://localhost:${port}/api/health`);
        checks.push({ check: 'api_health', status: resp.ok ? 'pass' : 'fail' });
        if (!resp.ok) score -= 20;
      } catch {
        checks.push({ check: 'api_health', status: 'fail' });
        score -= 20;
      }

      // Check farm.json exists
      try {
        const resp = await fetch(`http://localhost:${port}/api/farm`);
        const data = await resp.json();
        checks.push({ check: 'farm_profile', status: data?.farmId ? 'pass' : 'warn', detail: data?.farmId || 'missing' });
        if (!data?.farmId) score -= 15;
      } catch {
        checks.push({ check: 'farm_profile', status: 'fail' });
        score -= 15;
      }

      // Check groups.json
      try {
        const resp = await fetch(`http://localhost:${port}/data/groups.json`);
        const data = await resp.json();
        checks.push({ check: 'groups_config', status: data?.groups?.length > 0 ? 'pass' : 'warn', count: data?.groups?.length || 0 });
      } catch {
        checks.push({ check: 'groups_config', status: 'warn' });
        score -= 5;
      }

      // Check lighting recipes
      try {
        const resp = await fetch(`http://localhost:${port}/data/lighting-recipes.json`);
        checks.push({ check: 'lighting_recipes', status: resp.ok ? 'pass' : 'warn' });
        if (!resp.ok) score -= 10;
      } catch {
        checks.push({ check: 'lighting_recipes', status: 'warn' });
        score -= 10;
      }

      // Check IoT devices
      try {
        const resp = await fetch(`http://localhost:${port}/data/iot-devices.json`);
        const data = await resp.json();
        const deviceCount = data?.devices?.length || Object.keys(data || {}).length;
        checks.push({ check: 'iot_devices', status: deviceCount > 0 ? 'pass' : 'warn', count: deviceCount });
        if (deviceCount === 0) score -= 10;
      } catch {
        checks.push({ check: 'iot_devices', status: 'warn' });
        score -= 10;
      }

      const blocking = checks.filter(c => c.status === 'fail').map(c => c.check);
      const warnings = checks.filter(c => c.status === 'warn').map(c => c.check);

      return {
        success: true,
        data: {
          readiness_score: Math.max(0, score),
          checks,
          blocking_issues: blocking,
          warnings,
          recommendation: score >= 80 ? 'Site is ready for deployment' :
            score >= 50 ? 'Site has issues that should be resolved before deployment' :
            'Site is not ready — resolve blocking issues first'
        }
      };
    }

    case 'preflight_check':
      return {
        success: true,
        tier: 'recommend',
        message: 'Preflight check: verify firmware versions, API keys, and network connectivity before go-live.',
        data: {
          checklist: [
            'Verify all IoT device firmware is up to date',
            'Confirm Central API key is configured',
            'Test network connectivity to Central',
            'Validate lighting recipes for all crop groups',
            'Confirm zone-to-device bindings are correct',
            'Run a test schedule execution cycle'
          ]
        }
      };

    case 'generate_plan':
      return {
        success: true,
        tier: 'recommend',
        message: 'Deployment plan generated. Requires human review before execution.',
        data: {
          deployment_steps: [
            { step: 1, description: 'Install and configure Light Engine server', estimated_hours: 2, dependencies: [] },
            { step: 2, description: 'Register IoT devices and configure zones', estimated_hours: 4, dependencies: ['step_1'] },
            { step: 3, description: 'Upload lighting recipes and create crop groups', estimated_hours: 2, dependencies: ['step_2'] },
            { step: 4, description: 'Configure Central sync and API keys', estimated_hours: 1, dependencies: ['step_1'] },
            { step: 5, description: 'Run preflight checks and test automation', estimated_hours: 2, dependencies: ['step_3', 'step_4'] },
            { step: 6, description: 'Go-live: enable schedule executor', estimated_hours: 1, dependencies: ['step_5'] },
            { step: 7, description: 'Monitor first 48 hours for anomalies', estimated_hours: 4, dependencies: ['step_6'] }
          ],
          total_estimated_hours: 16,
          requires_approval: true
        }
      };

    case 'compliance_baseline':
      return {
        success: true,
        tier: 'recommend',
        message: 'Compliance baseline assessment for the target region.',
        data: {
          checks: [
            { area: 'food_safety', status: 'review_required', note: 'Verify GAP certification for the facility' },
            { area: 'electrical', status: 'review_required', note: 'LED fixtures must meet local electrical codes' },
            { area: 'water_quality', status: 'review_required', note: 'Nutrient solution disposal per local regulations' },
            { area: 'data_privacy', status: 'pass', note: 'Farm data stored locally on edge server' }
          ]
        }
      };

    case 'network_topology':
      return {
        success: true,
        tier: 'recommend',
        message: 'Network topology review for new site integration.',
        data: {
          considerations: [
            'Check for existing farms serving the same geographic region',
            'Verify Central can reach the new site (firewall rules, port forwarding)',
            'Assess network bandwidth for sensor data sync (minimum 1 Mbps)',
            'Plan crop specialization to avoid network-wide oversupply'
          ]
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Deployment action not yet implemented: ${action}`
      };
  }
}

// ── Phase 3 Ticket 3.8: Strategy & Viability Agent ──────────────────────

async function executeViabilityAction(action, params, context) {
  const port = process.env.PORT || 8091;

  switch (action) {
    case 'closure_risk': {
      // Analyze farm health metrics for closure risk
      let kpiData = {};
      try {
        const resp = await fetch(`http://localhost:${port}/api/kpis`);
        if (resp.ok) kpiData = await resp.json();
      } catch { /* no KPI data */ }

      const metrics = kpiData.metrics || {};
      let riskScore = 0;

      // Score based on KPIs (higher = more risk)
      const fillRate = metrics.fill_rate?.value;
      if (fillRate != null) {
        if (fillRate < 0.5) riskScore += 30;
        else if (fillRate < 0.7) riskScore += 15;
        else if (fillRate < 0.85) riskScore += 5;
      } else {
        riskScore += 10; // No data = minor risk signal
      }

      const lossRate = metrics.loss_rate?.value;
      if (lossRate != null) {
        if (lossRate > 0.2) riskScore += 25;
        else if (lossRate > 0.1) riskScore += 10;
      }

      const margin = metrics.contribution_margin?.value;
      if (margin != null) {
        if (margin < 0) riskScore += 30;
        else if (margin < 500) riskScore += 15;
      } else {
        riskScore += 10;
      }

      const trafficLight = riskScore >= 50 ? 'red' : riskScore >= 25 ? 'yellow' : 'green';

      return {
        success: true,
        data: {
          traffic_light: trafficLight,
          risk_score: Math.min(100, riskScore),
          key_metrics: {
            fill_rate: fillRate,
            loss_rate: lossRate,
            contribution_margin: margin
          },
          scenarios: [
            { name: 'Continue operations', description: 'Maintain current operations with targeted improvements', probability: trafficLight === 'green' ? 'high' : 'medium' },
            { name: 'Restructure', description: 'Reduce crop variety, focus on highest-margin crops', probability: 'medium' },
            { name: 'Seek acquisition', description: 'Explore acquisition by another network member', probability: trafficLight === 'red' ? 'medium' : 'low' }
          ],
          recommendation: `Farm risk level: ${trafficLight.toUpperCase()}. ${
            trafficLight === 'green' ? 'Farm is healthy. Continue current strategy.' :
            trafficLight === 'yellow' ? 'Monitor closely. Consider operational improvements.' :
            'Action required. Review alternatives before next governance cycle.'
          }`,
          requires_board_review: true
        }
      };
    }

    case 'acquisition_eval':
      return {
        success: true,
        tier: 'recommend',
        requiresConfirmation: true,
        message: 'Acquisition evaluation requires target farm profile data. Provide farm_id or profile for analysis.',
        data: {
          required_inputs: ['target_farm_id', 'asking_price', 'current_revenue', 'crop_mix', 'facility_age'],
          evaluation_criteria: [
            'Geographic fit with existing network',
            'Crop specialization complementarity',
            'Equipment and facility condition',
            'Customer base overlap',
            'Regulatory compliance status'
          ],
          requires_board_review: true
        }
      };

    case 'growth_scenarios':
      return {
        success: true,
        tier: 'recommend',
        message: 'Growth scenario modeling — provide expansion parameters for detailed projections.',
        data: {
          scenario_types: [
            { name: 'organic_growth', description: 'Expand capacity at existing sites' },
            { name: 'new_site', description: 'Deploy Light Engine at a new facility' },
            { name: 'acquisition', description: 'Acquire an existing farm operation' }
          ],
          required_inputs: ['scenario_type', 'investment_budget', 'timeline_months'],
          requires_board_review: true
        }
      };

    case 'competitive_position': {
      // Compare against network averages (uses local KPIs as proxy)
      let kpiData = {};
      try {
        const resp = await fetch(`http://localhost:${port}/api/kpis`);
        if (resp.ok) kpiData = await resp.json();
      } catch { /* no data */ }

      return {
        success: true,
        data: {
          farm_metrics: kpiData.metrics || {},
          network_comparison: 'Network average comparison requires Central data — showing local metrics only',
          recommendation: 'Request full network benchmarks from Central for comprehensive competitive analysis',
          requires_board_review: true
        }
      };
    }

    case 'portfolio_optimization':
      return {
        success: true,
        tier: 'recommend',
        requiresConfirmation: true,
        message: 'Portfolio optimization requires cross-farm data from Central.',
        data: {
          analysis_dimensions: [
            'Crop mix diversification across network',
            'Capacity utilization per farm',
            'Regional demand alignment',
            'Seasonal coverage gaps'
          ],
          requires_board_review: true
        }
      };

    default:
      return {
        success: false,
        error: 'action_not_implemented',
        message: `Viability action not yet implemented: ${action}`
      };
  }
}

// ── Ticket 2.7: Agent action audit log ──────────────────────────────────
// Caller (route handler) injects a DB store via setAuditStore().
// logAgentAction() persists every recommendation / action for governance.

let _auditDB = null;

/**
 * Inject the NeDB audit store (called once from server-foxtrot.js at startup).
 * @param {object} db - nedb-promises Datastore instance
 */
export function setAuditStore(db) {
  _auditDB = db;
}

/**
 * Log an agent action to the persistent audit store.
 * Fire-and-forget — never throws.
 * @param {object} entry
 * @param {string} entry.agent_class  - e.g. 'farm-operator', 'admin-ops'
 * @param {string} entry.action_type  - e.g. 'orders.recent_orders'
 * @param {string} entry.input_summary - truncated user message
 * @param {object|string} entry.recommendation - agent output / recommendation
 * @param {string} entry.human_decision - 'auto'|'accepted'|'rejected'|'pending'
 * @param {string} [entry.tier] - 'auto'|'recommend'|'require-approval'
 * @param {string} [entry.farm_id]
 * @param {string} [entry.user_id]
 */
export async function logAgentAction(entry) {
  if (!_auditDB) {
    console.warn('[AI Agent Audit] No audit store configured — skipping log');
    return null;
  }
  try {
    const record = {
      ...entry,
      logged_at: new Date().toISOString()
    };
    const inserted = await _auditDB.insert(record);
    return inserted._id;
  } catch (err) {
    console.error('[AI Agent Audit] Failed to log action:', err.message);
    return null;
  }
}

/**
 * Query recent audit records.
 * @param {{ limit?: number, agent_class?: string, farm_id?: string }} opts
 * @returns {Promise<Array>}
 */
export async function getAuditLog(opts = {}) {
  if (!_auditDB) return [];
  const filter = {};
  if (opts.agent_class) filter.agent_class = opts.agent_class;
  if (opts.farm_id) filter.farm_id = opts.farm_id;
  const limit = opts.limit || 50;
  return _auditDB.find(filter).sort({ logged_at: -1 }).limit(limit);
}

// ── Phase 4 Ticket 4.6: Developer mode action handler ──────────────────────

async function executeDeveloperAction(action, params, context) {
  const { evaluateRequest, createProposal, listProposals, getProposal, approveAndApply, rejectProposal } = await import('../lib/developer-mode.js');

  switch (action) {
    case 'evaluate_request': {
      const request = params?.request || params?.text || '';
      const evaluation = evaluateRequest(request, context);
      return {
        success: true,
        action: 'evaluate_request',
        evaluation,
        message: evaluation.feasible
          ? `Request evaluated: ${evaluation.scope} scope, ${evaluation.risk} risk. Proposal ID: ${evaluation.proposalId}. Requires human approval.`
          : `Request rejected: ${evaluation.reason}`
      };
    }

    case 'propose_change': {
      const proposal = createProposal(params.proposalId, {
        description: params.description || 'No description provided',
        targetFile: params.targetFile || null,
        currentContent: params.currentContent || null,
        proposedContent: params.proposedContent || null,
        configChanges: params.configChanges || null,
        scope: params.scope || 'unknown',
        risk: params.risk || 'medium',
        requestedBy: context?.user || 'unknown'
      });
      return {
        success: true,
        action: 'propose_change',
        proposal,
        message: `Proposal ${proposal.id} created. Status: pending_review. An authorized user must approve before changes are applied.`
      };
    }

    case 'list_proposals': {
      const status = params?.status || null;
      const proposals = listProposals(status);
      return {
        success: true,
        action: 'list_proposals',
        proposals: proposals.map(p => ({
          id: p.id,
          status: p.status,
          description: p.description,
          scope: p.scope,
          risk: p.risk,
          created_at: p.created_at,
          requested_by: p.requested_by
        })),
        count: proposals.length
      };
    }

    case 'approve_proposal': {
      const result = approveAndApply(params.proposalId, context?.user || 'unknown');
      return {
        success: result.applied,
        action: 'approve_proposal',
        result,
        message: result.reason
      };
    }

    case 'reject_proposal': {
      const rejected = rejectProposal(params.proposalId, context?.user || 'unknown', params.reason || '');
      return {
        success: !!rejected,
        action: 'reject_proposal',
        proposal: rejected,
        message: rejected
          ? `Proposal ${params.proposalId} rejected.`
          : 'Proposal not found.'
      };
    }

    default:
      return { success: false, error: `Unknown developer action: ${action}` };
  }
}

export default {
  parseCommand,
  executeAction,
  checkPermission,
  setAuditStore,
  logAgentAction,
  getAuditLog,
  SYSTEM_CAPABILITIES
};
