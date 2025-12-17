/**
 * Farm Sales - Programs Management
 * Food security programs and CSA box builders (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/programs
 * List all programs for farm
 * 
 * Query params:
 * - type: Filter by type (food_bank, snap_ebt, donation, csa)
 * - status: Filter by status (active, paused, archived)
 */
router.get('/', (req, res) => {
  try {
    const { type, status } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.programs.getAllForFarm(farmId);

    if (type) {
      filtered = filtered.filter(p => p.type === type);
    }
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps?.created_at || 0) - new Date(a.timestamps?.created_at || 0)
    );

    res.json({
      ok: true,
      farm_id: farmId,
      programs: filtered,
      totals: {
        count: filtered.length,
        by_type: countByType(filtered),
        by_status: countByStatus(filtered)
      }
    });

  } catch (error) {
    console.error('[farm-sales] Programs list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/programs/:programId
 * Get program details
 */
router.get('/:programId', (req, res) => {
  try {
    const { programId } = req.params;
    const farmId = req.farm_id;

    const program = farmStores.programs.get(farmId, programId);
    
    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found'
      });
    }

    res.json({
      ok: true,
      program
    });

  } catch (error) {
    console.error('[farm-sales] Program fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/programs
 * Create new program
 * 
 * Body:
 * {
 *   name: string,
 *   type: 'food_bank'|'snap_ebt'|'donation'|'csa',
 *   subsidy_percent?: number,
 *   max_weekly_amount?: number,
 *   eligible_items?: 'all'|string[],
 *   grant?: { source, grant_id, start_date, end_date, total_budget },
 *   box_builder?: { enabled, available_items, min_items, max_items, categories }
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { name, type, subsidy_percent, max_weekly_amount, eligible_items, grant, box_builder } = req.body;
    const farmId = req.farm_id;

    // Validate required fields
    if (!name || !type) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'name and type are required'
      });
    }

    // Validate type
    const validTypes = ['food_bank', 'snap_ebt', 'donation', 'csa'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_type',
        message: `Type must be one of: ${validTypes.join(', ')}`
      });
    }

    const programId = farmStores.programs.generateId(farmId, 'PROG', 3);
    const timestamp = new Date().toISOString();

    const program = {
      program_id: programId,
      name,
      type,
      status: 'active',
      subsidy_percent: subsidy_percent || 0,
      max_weekly_amount: max_weekly_amount || null,
      eligible_items: eligible_items || 'all',
      grant: grant || null,
      box_builder: box_builder || null,
      usage_stats: {
        total_orders: 0,
        total_amount: 0,
        total_subsidy: 0
      },
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp
      }
    };

    farmStores.programs.set(farmId, programId, program);

    res.status(201).json({
      ok: true,
      program_id: programId,
      program
    });

  } catch (error) {
    console.error('[farm-sales] Program creation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'creation_failed',
      message: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/programs/:programId
 * Update program details
 * 
 * Body: Partial program data to update
 */
router.patch('/:programId', async (req, res) => {
  try {
    const { programId } = req.params;
    const farmId = req.farm_id;
    const updates = req.body;

    const program = farmStores.programs.get(farmId, programId);
    
    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found'
      });
    }

    // Merge updates (don't allow changing usage_stats directly)
    const { usage_stats, ...allowedUpdates } = updates;
    
    const updatedProgram = {
      ...program,
      ...allowedUpdates,
      timestamps: {
        ...program.timestamps,
        updated_at: new Date().toISOString()
      }
    };

    farmStores.programs.set(farmId, programId, updatedProgram);

    res.json({
      ok: true,
      program: updatedProgram
    });

  } catch (error) {
    console.error('[farm-sales] Program update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/programs/:programId/box-options
 * Get available items for box builder
 */
router.get('/:programId/box-options', async (req, res) => {
  try {
    const { programId } = req.params;
    const farmId = req.farm_id;

    const program = farmStores.programs.get(farmId, programId);
    
    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found'
      });
    }

    if (!program.box_builder?.enabled) {
      return res.status(400).json({
        ok: false,
        error: 'box_builder_not_enabled',
        message: 'Box builder is not enabled for this program'
      });
    }

    // Get current inventory
    const inventory = farmStores.inventory.getAllForFarm(farmId);
    
    // Filter by available items and categories
    let availableItems = inventory.filter(item => item.available > 0);

    if (program.box_builder.available_items && program.box_builder.available_items !== 'all') {
      availableItems = availableItems.filter(item => 
        program.box_builder.available_items.includes(item.sku_id)
      );
    }

    if (program.box_builder.categories) {
      availableItems = availableItems.filter(item => 
        program.box_builder.categories.includes(item.category)
      );
    }

    // Group by category
    const byCategory = {};
    availableItems.forEach(item => {
      if (!byCategory[item.category]) {
        byCategory[item.category] = [];
      }
      byCategory[item.category].push({
        sku_id: item.sku_id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        available: item.available,
        retail_price: item.retail_price
      });
    });

    res.json({
      ok: true,
      program_id: programId,
      box_builder: program.box_builder,
      available_items: availableItems.map(item => ({
        sku_id: item.sku_id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        available: item.available,
        retail_price: item.retail_price
      })),
      by_category: byCategory
    });

  } catch (error) {
    console.error('[farm-sales] Box options fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/programs/:programId/box-selections
 * Save customer box selections
 * 
 * Body:
 * {
 *   customer_id: string,
 *   selections: [{ sku_id, quantity }],
 *   delivery_date: 'YYYY-MM-DD'
 * }
 */
router.post('/:programId/box-selections', async (req, res) => {
  try {
    const { programId } = req.params;
    const { customer_id, selections, delivery_date } = req.body;
    const farmId = req.farm_id;

    // Validate required fields
    if (!customer_id || !Array.isArray(selections) || !delivery_date) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'customer_id, selections array, and delivery_date are required'
      });
    }

    const program = farmStores.programs.get(farmId, programId);
    
    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found'
      });
    }

    if (!program.box_builder?.enabled) {
      return res.status(400).json({
        ok: false,
        error: 'box_builder_not_enabled'
      });
    }

    // Validate item count limits
    const totalItems = selections.reduce((sum, s) => sum + s.quantity, 0);
    
    if (program.box_builder.min_items && totalItems < program.box_builder.min_items) {
      return res.status(400).json({
        ok: false,
        error: 'too_few_items',
        message: `Minimum ${program.box_builder.min_items} items required`,
        selected: totalItems,
        min_required: program.box_builder.min_items
      });
    }

    if (program.box_builder.max_items && totalItems > program.box_builder.max_items) {
      return res.status(400).json({
        ok: false,
        error: 'too_many_items',
        message: `Maximum ${program.box_builder.max_items} items allowed`,
        selected: totalItems,
        max_allowed: program.box_builder.max_items
      });
    }

    // Store box selections (create simple store for box preferences)
    if (!farmStores.boxSelections) {
      const FarmScopedStore = farmStores.customers.constructor;
      farmStores.boxSelections = new FarmScopedStore('boxSelections');
    }

    const selectionId = farmStores.boxSelections.generateId(farmId, 'BOX', 6);
    const timestamp = new Date().toISOString();

    const boxSelection = {
      selection_id: selectionId,
      program_id: programId,
      customer_id,
      delivery_date,
      selections,
      total_items: totalItems,
      status: 'confirmed',
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp
      }
    };

    farmStores.boxSelections.set(farmId, selectionId, boxSelection);

    res.status(201).json({
      ok: true,
      selection_id: selectionId,
      box_selection: boxSelection,
      message: `Box selections confirmed for ${delivery_date}`
    });

  } catch (error) {
    console.error('[farm-sales] Box selection failed:', error);
    res.status(500).json({
      ok: false,
      error: 'selection_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/programs/:programId/box-selections/:customerId
 * Get customer's box selections for a program
 * 
 * Query params:
 * - delivery_date: Filter by specific delivery date
 */
router.get('/:programId/box-selections/:customerId', (req, res) => {
  try {
    const { programId, customerId } = req.params;
    const { delivery_date } = req.query;
    const farmId = req.farm_id;

    if (!farmStores.boxSelections) {
      return res.json({
        ok: true,
        selections: []
      });
    }

    let selections = farmStores.boxSelections.getAllForFarm(farmId)
      .filter(s => s.program_id === programId && s.customer_id === customerId);

    if (delivery_date) {
      selections = selections.filter(s => s.delivery_date === delivery_date);
    }

    // Sort by delivery_date descending
    selections.sort((a, b) => 
      new Date(b.delivery_date) - new Date(a.delivery_date)
    );

    res.json({
      ok: true,
      customer_id: customerId,
      program_id: programId,
      selections
    });

  } catch (error) {
    console.error('[farm-sales] Box selections fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: error.message
    });
  }
});

/**
 * Helper functions
 */
function countByType(programs) {
  return programs.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});
}

function countByStatus(programs) {
  return programs.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
}

export default router;
