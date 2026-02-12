/**
 * Vertical Farm Production Calculator — API Routes
 *
 * Generates investor-grade financial projections for vertical farm grant applications.
 * Based on specification: VERTICAL_FARM_CALCULATOR_SPEC.md
 *
 * Endpoints:
 *   POST /calculate        — Run calculation, return CAPEX/OPEX/revenue/projections
 *   POST /save             — Persist model to farm_production_models
 *   GET  /models/:appId    — List saved models for an application
 *   DELETE /models/:id     — Delete a model
 *   POST /apply-to-wizard  — Push outputs into grant application budget/narrative
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { getDatabase } from '../config/database.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

// ─── Reference Data ────────────────────────────────────────────────────────────

const CROP_DATA = {
  lettuce:     { label: 'Butter Lettuce',        plantsPerTray: 30,  daysToHarvest: 28, kgPerTray: 2.5, pricePerKg: 10, photoperiod: 16 },
  pakchoi:     { label: 'Pak Choi',              plantsPerTray: 24,  daysToHarvest: 32, kgPerTray: 3.0, pricePerKg: 12, photoperiod: 16 },
  microgreens: { label: 'Microgreens (Sunflower)', plantsPerTray: 200, daysToHarvest: 10, kgPerTray: 0.8, pricePerKg: 50, photoperiod: 18 },
  basil:       { label: 'Basil',                 plantsPerTray: 15,  daysToHarvest: 35, kgPerTray: 1.2, pricePerKg: 22, photoperiod: 16 },
  kale:        { label: 'Baby Kale',             plantsPerTray: 28,  daysToHarvest: 30, kgPerTray: 2.8, pricePerKg: 14, photoperiod: 16 },
};

const ELECTRICITY_RATES = { ON: 0.12, QC: 0.07, BC: 0.09, AB: 0.11 };
const WAGE_BY_PROVINCE   = { ON: 18.50, QC: 16.50, BC: 19.00, AB: 20.00 };

const BENEFITS_MULTIPLIER = 1.15; // CPP, EI, workers comp
const PACKAGING_RATE = 0.15;      // 15% of gross revenue
const LIGHT_WATTS_PER_TRAY = 200; // 2x100W fixtures
const LIGHT_COST_PER_TRAY = 119;  // $119 per fixture pair

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function authenticateGrantUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.grantUser = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// ─── Calculation Functions ─────────────────────────────────────────────────────

/**
 * Calculate total plants across all crop allocations
 */
function calculatePlants(crops) {
  return crops.reduce((sum, c) => {
    const data = CROP_DATA[c.type];
    return sum + (data ? c.trayAllocation * data.plantsPerTray : 0);
  }, 0);
}

/**
 * Calculate CAPEX (capital expenditure) breakdown
 */
function calculateCAPEX(numTrays, plants, automationTier) {
  const racks = Math.ceil(numTrays / 10);
  const reservoirs = Math.ceil(numTrays / 10);
  const coolingTons = (plants * 1.32 * 1.3) / 12000; // incl 30% sensible heat

  const infrastructure = {
    racks: racks * 400,
    trays: numTrays * 15,
    reservoirs: reservoirs * 200,
    insulation_flooring: Math.ceil(numTrays * 3.2) * 8, // ~3.2 sqft/tray × $8
    electrical_panel: numTrays > 500 ? 5000 : 3000,
  };

  const environmental = {
    hvac: Math.ceil(coolingTons) * 1500,
    dehumidifier: Math.ceil(plants / 10000) * 2500,
    circulation_fans: Math.ceil(racks / 5) * 150,
    co2_generator: 800,
  };

  const lighting_hydro = {
    lighting: numTrays * LIGHT_COST_PER_TRAY,
    pumps_supply: Math.ceil(plants / 10000) * 800,
    pumps_return: Math.ceil(plants / 10000) * 400,
    plumbing: Math.ceil(plants / 10000) * 500,
    nutrient_system: 2000,
  };

  const automation = {
    controller: automationTier === 'advanced' ? 8000 : 3000,
    sensors: Math.ceil(reservoirs / 5) * 1200,
    water_level: Math.ceil(reservoirs / 5) * 300,
    cameras: automationTier === 'advanced' ? 1500 : 0,
  };

  const subtotals = {
    infrastructure: Object.values(infrastructure).reduce((a, b) => a + b, 0),
    environmental: Object.values(environmental).reduce((a, b) => a + b, 0),
    lighting_hydro: Object.values(lighting_hydro).reduce((a, b) => a + b, 0),
    automation: Object.values(automation).reduce((a, b) => a + b, 0),
  };

  return {
    detail: { infrastructure, environmental, lighting_hydro, automation },
    subtotals,
    total: Object.values(subtotals).reduce((a, b) => a + b, 0),
    perPlant: plants > 0 ? Math.round(Object.values(subtotals).reduce((a, b) => a + b, 0) / plants * 100) / 100 : 0,
  };
}

/**
 * Calculate monthly OPEX (operating expenditure)
 */
function calculateOPEX(plants, province, crops, numTrays, facilityType, rentPerSqFt, facilitySize) {
  const rate = ELECTRICITY_RATES[province] || 0.12;
  const wage = WAGE_BY_PROVINCE[province] || 18.50;

  // Lighting energy: weighted by crop photoperiod
  const totalTrayCount = crops.reduce((s, c) => s + c.trayAllocation, 0);
  let lightingKwh = 0;
  for (const c of crops) {
    const data = CROP_DATA[c.type];
    if (!data) continue;
    lightingKwh += c.trayAllocation * (LIGHT_WATTS_PER_TRAY / 1000) * data.photoperiod * 30; // kWh/month
  }

  // HVAC energy
  const coolingTons = (plants * 1.32 * 1.3) / 12000;
  const hvacKwh = coolingTons * 1.2 * 24 * 30; // 1.2 kW per ton × continuous
  const dehumidKwh = (plants / 10000) * 0.4 * 24 * 30; // 400W per 10k plants avg

  // Pump energy
  const pumpKwh = Math.ceil(plants / 10000) * 0.225 * 24 * 30; // 225W effective avg

  const electricity = {
    lighting: Math.round(lightingKwh * rate),
    hvac: Math.round(hvacKwh * rate),
    dehumidification: Math.round(dehumidKwh * rate),
    pumps: Math.round(pumpKwh * rate),
    total_kwh: Math.round(lightingKwh + hvacKwh + dehumidKwh + pumpKwh),
  };
  electricity.total = electricity.lighting + electricity.hvac + electricity.dehumidification + electricity.pumps;

  // Labour
  let fte;
  if (plants <= 4000) fte = 2;
  else if (plants <= 10000) fte = 3;
  else fte = 3 + Math.floor((plants - 10000) / 10000);

  const monthlyHours = fte * 40 * 4.33;
  const labourCost = Math.round(monthlyHours * wage * BENEFITS_MULTIPLIER);

  // Revenue (needed for packaging cost)
  const grossRevenue = crops.reduce((sum, c) => {
    const data = CROP_DATA[c.type];
    if (!data) return sum;
    const harvestsPerMonth = 30 / data.daysToHarvest;
    return sum + c.trayAllocation * data.kgPerTray * harvestsPerMonth * data.pricePerKg;
  }, 0);

  const nutrients = Math.round(plants * 0.15);
  const seeds = Math.round(plants * 0.05);
  const packaging = Math.round(grossRevenue * PACKAGING_RATE);
  const water = Math.round(electricity.total * 0.05);
  const insurance = plants <= 10000 ? 500 : plants <= 25000 ? 750 : 1500;
  const rent = facilityType === 'rented' ? Math.round((rentPerSqFt || 1.5) * (facilitySize || 800)) : 0;
  const maintenance = 200; // approx $245 spread monthly

  return {
    labour: { fte, hourlyWage: wage, monthlyHours: Math.round(monthlyHours), cost: labourCost },
    electricity,
    nutrients,
    seeds,
    packaging,
    water,
    insurance,
    rent,
    maintenance,
    total: labourCost + electricity.total + nutrients + seeds + packaging + water + insurance + rent + maintenance,
  };
}

/**
 * Calculate monthly revenue
 */
function calculateRevenue(crops) {
  let totalKg = 0;
  let grossRevenue = 0;
  const byCrop = [];

  for (const c of crops) {
    const data = CROP_DATA[c.type];
    if (!data) continue;
    const harvestsPerMonth = 30 / data.daysToHarvest;
    const kgPerMonth = c.trayAllocation * data.kgPerTray * harvestsPerMonth;
    const revenue = kgPerMonth * data.pricePerKg;
    totalKg += kgPerMonth;
    grossRevenue += revenue;
    byCrop.push({
      type: c.type,
      label: data.label,
      trays: c.trayAllocation,
      kgPerMonth: Math.round(kgPerMonth),
      pricePerKg: data.pricePerKg,
      grossRevenue: Math.round(revenue),
    });
  }

  const packagingCost = Math.round(grossRevenue * PACKAGING_RATE);
  return {
    byCrop,
    totalKgPerMonth: Math.round(totalKg),
    grossRevenue: Math.round(grossRevenue),
    packagingCost,
    netRevenue: Math.round(grossRevenue - packagingCost),
  };
}

/**
 * Generate 5-year financial projections
 */
function generate5YearProjection(capex, opex, revenue) {
  const years = [];
  const capacityRamp = [0.50, 0.75, 0.90, 0.90, 0.90]; // Year 1-5
  const colaRate = 0.04;       // Labour cost-of-living adjustment
  const electricityInflation = 0.05;
  const revenueInflation = 0.03;

  let cumulativeCashFlow = -capex.total;

  for (let y = 0; y < 5; y++) {
    const capacity = capacityRamp[y];
    const labourMultiplier = Math.pow(1 + colaRate, y);
    const elecMultiplier = Math.pow(1 + electricityInflation, y);
    const revMultiplier = Math.pow(1 + revenueInflation, y);

    const yearRevenue = Math.round(revenue.netRevenue * 12 * capacity * revMultiplier);
    const yearLabour = Math.round(opex.labour.cost * 12 * labourMultiplier);
    const yearElectricity = Math.round(opex.electricity.total * 12 * elecMultiplier);
    const yearOtherOpex = Math.round((opex.total - opex.labour.cost - opex.electricity.total) * 12);
    const yearTotalOpex = yearLabour + yearElectricity + yearOtherOpex;
    const yearCapex = y === 0 ? capex.total : (y === 1 ? Math.round(capex.total * 0.1) : Math.round(capex.total * 0.03));
    const ebitda = yearRevenue - yearTotalOpex;
    const netCashFlow = ebitda - (y === 0 ? 0 : yearCapex); // Year 0 CAPEX already in cumulativeCashFlow

    cumulativeCashFlow += netCashFlow;

    years.push({
      year: y + 1,
      capacity: Math.round(capacity * 100),
      revenue: yearRevenue,
      opex: yearTotalOpex,
      opexBreakdown: { labour: yearLabour, electricity: yearElectricity, other: yearOtherOpex },
      ebitda,
      capex: yearCapex,
      netCashFlow,
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
    });
  }

  // Calculate payback period
  let paybackYear = null;
  for (let i = 1; i < years.length; i++) {
    if (years[i - 1].cumulativeCashFlow < 0 && years[i].cumulativeCashFlow >= 0) {
      // Linear interpolation
      const deficit = Math.abs(years[i - 1].cumulativeCashFlow);
      const gain = years[i].netCashFlow;
      paybackYear = (i) + (gain > 0 ? deficit / gain : 1);
      break;
    }
  }

  return { years, paybackYear: paybackYear ? Math.round(paybackYear * 10) / 10 : null };
}

/**
 * Calculate sensitivity analysis (±20% electricity, ±15% yield, ±10% pricing)
 */
function calculateSensitivity(opex, revenue, capex) {
  const baseMonthlyProfit = revenue.netRevenue - opex.total;

  const scenarios = {};

  // Electricity sensitivity (±20%)
  const elecDelta = opex.electricity.total * 0.20;
  scenarios.electricity = {
    label: 'Electricity Cost',
    variation: '±20%',
    optimistic: Math.round(baseMonthlyProfit + elecDelta),
    base: Math.round(baseMonthlyProfit),
    pessimistic: Math.round(baseMonthlyProfit - elecDelta),
    impact_pct: Math.round((elecDelta / Math.abs(baseMonthlyProfit || 1)) * 100),
  };

  // Yield sensitivity (±15%)
  const yieldDelta = revenue.netRevenue * 0.15;
  scenarios.yield = {
    label: 'Crop Yield',
    variation: '±15%',
    optimistic: Math.round(baseMonthlyProfit + yieldDelta),
    base: Math.round(baseMonthlyProfit),
    pessimistic: Math.round(baseMonthlyProfit - yieldDelta),
    impact_pct: Math.round((yieldDelta / Math.abs(baseMonthlyProfit || 1)) * 100),
  };

  // Pricing sensitivity (±10%)
  const priceDelta = revenue.grossRevenue * 0.10 * (1 - PACKAGING_RATE);
  scenarios.pricing = {
    label: 'Wholesale Pricing',
    variation: '±10%',
    optimistic: Math.round(baseMonthlyProfit + priceDelta),
    base: Math.round(baseMonthlyProfit),
    pessimistic: Math.round(baseMonthlyProfit - priceDelta),
    impact_pct: Math.round((priceDelta / Math.abs(baseMonthlyProfit || 1)) * 100),
  };

  // Break-even scale
  const breakEvenRevenue = opex.total / (1 - PACKAGING_RATE);
  const avgRevenuePerTray = revenue.totalKgPerMonth > 0
    ? revenue.grossRevenue / revenue.totalKgPerMonth * (revenue.totalKgPerMonth / (revenue.byCrop.reduce((s, c) => s + c.trays, 0) || 1))
    : 100;

  return {
    baseMonthlyProfit: Math.round(baseMonthlyProfit),
    scenarios,
    breakEvenMonthlyRevenue: Math.round(breakEvenRevenue),
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /calculate — Run full calculation
 */
router.post('/calculate', (req, res) => {
  try {
    const {
      numTrays,
      crops = [{ type: 'lettuce', trayAllocation: numTrays || 100 }],
      province = 'ON',
      facilityType = 'owned',
      rentPerSqFt = null,
      facilitySize = null,
      automationTier = 'basic',
    } = req.body;

    if (!numTrays || numTrays < 1 || numTrays > 10000) {
      return res.status(400).json({ success: false, error: 'numTrays must be between 1 and 10,000' });
    }

    // Validate crops
    const totalAllocated = crops.reduce((s, c) => s + (c.trayAllocation || 0), 0);
    if (totalAllocated !== numTrays) {
      return res.status(400).json({ success: false, error: `Crop tray allocations (${totalAllocated}) must equal numTrays (${numTrays})` });
    }
    for (const c of crops) {
      if (!CROP_DATA[c.type]) {
        return res.status(400).json({ success: false, error: `Unknown crop type: ${c.type}. Valid: ${Object.keys(CROP_DATA).join(', ')}` });
      }
    }

    const plants = calculatePlants(crops);
    const estimatedSqFt = Math.round(numTrays * 3.2 + (Math.ceil(numTrays / 10) * 4 * 3)); // trays + aisles
    const capex = calculateCAPEX(numTrays, plants, automationTier);
    const opexResult = calculateOPEX(plants, province, crops, numTrays, facilityType, rentPerSqFt, facilitySize || estimatedSqFt);
    const revenue = calculateRevenue(crops);
    const projections = generate5YearProjection(capex, opexResult, revenue);
    const sensitivity = calculateSensitivity(opexResult, revenue, capex);

    return res.json({
      success: true,
      data: {
        inputs: { numTrays, crops, province, facilityType, rentPerSqFt, facilitySize: facilitySize || estimatedSqFt, automationTier },
        summary: { plants, estimatedSqFt, totalTrays: numTrays },
        capex,
        opex: opexResult,
        revenue,
        profitability: {
          monthlyProfit: revenue.netRevenue - opexResult.total,
          annualProfit: (revenue.netRevenue - opexResult.total) * 12,
          breakEvenMonthlyRevenue: sensitivity.breakEvenMonthlyRevenue,
          paybackYears: projections.paybackYear,
        },
        projections,
        sensitivity,
      },
    });
  } catch (err) {
    logger.error('Calculator error:', err);
    return res.status(500).json({ success: false, error: 'Calculation failed' });
  }
});

/**
 * GET /reference-data — Return crop types, provinces, etc. for the UI
 */
router.get('/reference-data', (req, res) => {
  res.json({
    success: true,
    data: {
      crops: Object.entries(CROP_DATA).map(([key, d]) => ({
        value: key,
        label: d.label,
        plantsPerTray: d.plantsPerTray,
        daysToHarvest: d.daysToHarvest,
        pricePerKg: d.pricePerKg,
      })),
      provinces: Object.entries(ELECTRICITY_RATES).map(([prov, rate]) => ({
        value: prov,
        label: { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta' }[prov],
        electricityRate: rate,
        hourlyWage: WAGE_BY_PROVINCE[prov],
      })),
      constraints: { minTrays: 1, maxTrays: 10000 },
    },
  });
});

/**
 * POST /save — Save a calculation model to database
 */
router.post('/save', authenticateGrantUser, async (req, res) => {
  try {
    const { applicationId, modelName, inputs, outputs } = req.body;
    if (!applicationId || !inputs || !outputs) {
      return res.status(400).json({ success: false, error: 'applicationId, inputs, and outputs are required' });
    }

    const db = getDatabase();

    // Verify ownership
    const appCheck = await db.query(
      'SELECT id FROM grant_applications WHERE id = $1 AND user_id = $2',
      [applicationId, req.grantUser.userId]
    );
    if (appCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Application not found or not yours' });
    }

    const result = await db.query(
      `INSERT INTO farm_production_models (application_id, model_name, inputs, outputs)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [applicationId, modelName || 'default', JSON.stringify(inputs), JSON.stringify(outputs)]
    );

    return res.json({ success: true, data: { id: result.rows[0].id, created_at: result.rows[0].created_at } });
  } catch (err) {
    logger.error('Save model error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save model' });
  }
});

/**
 * GET /models/:applicationId — List saved models
 */
router.get('/models/:applicationId', authenticateGrantUser, async (req, res) => {
  try {
    const db = getDatabase();
    const result = await db.query(
      `SELECT fpm.id, fpm.model_name, fpm.inputs, fpm.outputs, fpm.created_at, fpm.updated_at
       FROM farm_production_models fpm
       JOIN grant_applications ga ON ga.id = fpm.application_id
       WHERE fpm.application_id = $1 AND ga.user_id = $2
       ORDER BY fpm.created_at DESC`,
      [req.params.applicationId, req.grantUser.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('List models error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list models' });
  }
});

/**
 * DELETE /models/:id — Delete a saved model
 */
router.delete('/models/:id', authenticateGrantUser, async (req, res) => {
  try {
    const db = getDatabase();
    const result = await db.query(
      `DELETE FROM farm_production_models fpm
       USING grant_applications ga
       WHERE fpm.id = $1 AND fpm.application_id = ga.id AND ga.user_id = $2
       RETURNING fpm.id`,
      [req.params.id, req.grantUser.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Model not found or not yours' });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error('Delete model error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete model' });
  }
});

/**
 * POST /apply-to-wizard — Push calculator outputs into a grant application
 */
router.post('/apply-to-wizard', authenticateGrantUser, async (req, res) => {
  try {
    const { applicationId, outputs } = req.body;
    if (!applicationId || !outputs) {
      return res.status(400).json({ success: false, error: 'applicationId and outputs are required' });
    }

    const db = getDatabase();

    // Verify ownership
    const appCheck = await db.query(
      'SELECT id, budget, project_profile, milestones FROM grant_applications WHERE id = $1 AND user_id = $2',
      [applicationId, req.grantUser.userId]
    );
    if (appCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Application not found or not yours' });
    }

    const app = appCheck.rows[0];
    const existingBudget = app.budget || {};
    const existingProfile = app.project_profile || {};
    const existingMilestones = app.milestones || [];

    // Build budget items from CAPEX + OPEX
    const budgetItems = [];

    // CAPEX items
    if (outputs.capex?.detail) {
      for (const [category, items] of Object.entries(outputs.capex.detail)) {
        for (const [item, cost] of Object.entries(items)) {
          if (cost > 0) {
            budgetItems.push({
              category: 'Capital',
              description: `${category} — ${item.replace(/_/g, ' ')}`,
              amount: cost,
              source: 'calculator',
            });
          }
        }
      }
    }

    // OPEX items (annualized for Year 1)
    if (outputs.opex) {
      const opexItems = [
        { key: 'labour', desc: 'Labour (Year 1)', amount: (outputs.opex.labour?.cost || 0) * 12 },
        { key: 'electricity', desc: 'Electricity (Year 1)', amount: (outputs.opex.electricity?.total || 0) * 12 },
        { key: 'nutrients', desc: 'Nutrients & Growing Media (Year 1)', amount: (outputs.opex.nutrients || 0) * 12 },
        { key: 'packaging', desc: 'Packaging (Year 1)', amount: (outputs.opex.packaging || 0) * 12 },
      ];
      for (const item of opexItems) {
        if (item.amount > 0) {
          budgetItems.push({ category: 'Operating', description: item.desc, amount: Math.round(item.amount), source: 'calculator' });
        }
      }
    }

    // Build auto-milestones from the 5-year ramp
    const autoMilestones = [
      { title: 'Phase 1: Facility Build-Out & Equipment', month: '1-3', budget: Math.round(outputs.capex?.total * 0.7 || 0), deliverables: 'Racks, lighting, HVAC installed and operational' },
      { title: 'Phase 2: First Production Cycle', month: '4-6', budget: Math.round(outputs.capex?.total * 0.3 || 0), deliverables: 'First harvest completed, quality validation' },
      { title: 'Phase 3: Scale to 75% Capacity', month: '7-12', budget: Math.round(outputs.opex?.total * 6 || 0), deliverables: 'Consistent production, wholesale contracts secured' },
      { title: 'Phase 4: Full Operations', month: '13-24', budget: Math.round(outputs.opex?.total * 12 || 0), deliverables: 'Break-even target, 90% capacity utilization' },
    ];

    // Merge with existing (don't clobber user's manual entries)
    const updatedBudget = {
      ...existingBudget,
      items: [...(existingBudget.items || []).filter(i => i.source !== 'calculator'), ...budgetItems],
      totalAmount: budgetItems.reduce((s, i) => s + (i.amount || 0), 0),
      generatedByCalculator: true,
    };

    const mergedMilestones = [
      ...existingMilestones.filter(m => m.source !== 'calculator'),
      ...autoMilestones.map(m => ({ ...m, source: 'calculator' })),
    ];

    const updatedProfile = {
      ...existingProfile,
      productionModel: {
        plants: outputs.summary?.plants,
        trays: outputs.inputs?.numTrays,
        province: outputs.inputs?.province,
        monthlyRevenue: outputs.revenue?.netRevenue,
        monthlyCost: outputs.opex?.total,
        paybackYears: outputs.profitability?.paybackYears,
      },
    };

    await db.query(
      `UPDATE grant_applications
       SET budget = $1, project_profile = $2, milestones = $3, updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(updatedBudget), JSON.stringify(updatedProfile), JSON.stringify(mergedMilestones), applicationId]
    );

    return res.json({
      success: true,
      data: {
        budgetItemsAdded: budgetItems.length,
        milestonesAdded: autoMilestones.length,
        totalBudget: updatedBudget.totalAmount,
      },
    });
  } catch (err) {
    logger.error('Apply to wizard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to apply calculator results' });
  }
});

export default router;
