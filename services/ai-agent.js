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

export default {
  parseCommand,
  executeAction,
  checkPermission,
  SYSTEM_CAPABILITIES
};
