// routes/sustainability.js — Sustainability & ESG Dashboard  (Page 9)
// Replaces inline zero-stubs in server.js.
// Stores utility bills via farmStore; derives metrics from bills + harvest data.
// Enhanced: Real ESG scoring via esg-scoring-engine service.

import { Router } from 'express';
import { calculateESGScore, getESGHistory } from '../services/esg-scoring-engine.js';
import { listAllBuyers } from '../services/wholesaleMemoryStore.js';
import logger from '../utils/logger.js';

const router = Router();

// ── helpers ────────────────────────────────────────────────────────────

function getFarmStore(req) {
  return req.farmStore || req.app?.locals?.farmStore || null;
}

function farmId(req) {
  return req.headers['x-farm-id'] || req.query.farm_id || 'default';
}

function storeKey(fid, suffix) {
  return `sustainability_${suffix}_${fid}`;
}

// Carbon emission factors (kg CO₂ per unit)
const EMISSION_FACTORS = {
  electricity_kwh: 0.42,   // Canadian grid average
  natural_gas_m3: 1.89,
  propane_l: 1.51,
  water_l: 0.000298        // water treatment/pumping
};

// ── Utility Bills CRUD ─────────────────────────────────────────────────

// GET  /api/sustainability/utility-bills
router.get('/utility-bills', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const key = storeKey(fid, 'utility_bills');
    let bills = [];
    if (store) {
      const raw = await store.get(fid, key);
      bills = raw || [];
    }
    // sort newest first
    bills.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({ ok: true, bills });
  } catch (e) {
    console.error('[sustainability] GET /utility-bills error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/sustainability/utility-bills
router.post('/utility-bills', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    if (!store) return res.status(500).json({ ok: false, error: 'Store unavailable' });

    const {
      bill_type,        // electricity | natural_gas | propane | water | other
      billing_period_start,
      billing_period_end,
      usage_amount,     // numeric
      usage_unit,       // kWh | m³ | L | etc.
      cost,
      currency,         // CAD | USD
      notes
    } = req.body;

    if (!bill_type || usage_amount == null) {
      return res.status(400).json({ ok: false, error: 'bill_type and usage_amount required' });
    }

    const key = storeKey(fid, 'utility_bills');
    let bills = (await store.get(fid, key)) || [];

    const bill = {
      id: `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      bill_type,
      billing_period_start: billing_period_start || null,
      billing_period_end: billing_period_end || null,
      usage_amount: Number(usage_amount),
      usage_unit: usage_unit || guessUnit(bill_type),
      cost: cost != null ? Number(cost) : null,
      currency: currency || 'CAD',
      notes: notes || '',
      created_at: new Date().toISOString(),
      created_by: req.user?.name || req.user?.email || 'system'
    };

    bills.push(bill);
    await store.set(fid, key, bills);
    return res.json({ ok: true, bill });
  } catch (e) {
    console.error('[sustainability] POST /utility-bills error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/sustainability/utility-bills/:id
router.delete('/utility-bills/:id', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    if (!store) return res.status(500).json({ ok: false, error: 'Store unavailable' });

    const key = storeKey(fid, 'utility_bills');
    let bills = (await store.get(fid, key)) || [];
    const before = bills.length;
    bills = bills.filter(b => b.id !== req.params.id);
    if (bills.length === before) {
      return res.status(404).json({ ok: false, error: 'Bill not found' });
    }
    await store.set(fid, key, bills);
    return res.json({ ok: true, deleted: req.params.id });
  } catch (e) {
    console.error('[sustainability] DELETE /utility-bills error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Metrics (derived from bills) ───────────────────────────────────────

// GET /api/sustainability/metrics?days=30
router.get('/metrics', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 86400000);

    let bills = [];
    if (store) {
      bills = (await store.get(fid, storeKey(fid, 'utility_bills'))) || [];
    }

    // Filter to bills in range
    const recent = bills.filter(b => {
      const d = b.billing_period_end || b.created_at;
      return new Date(d) >= cutoff;
    });

    // Aggregate by type
    const energy = recent.filter(b => ['electricity', 'natural_gas', 'propane'].includes(b.bill_type));
    const water = recent.filter(b => b.bill_type === 'water');

    const totalKwh = energy
      .filter(b => b.usage_unit === 'kWh')
      .reduce((s, b) => s + b.usage_amount, 0);
    const totalGasM3 = energy
      .filter(b => b.usage_unit === 'm³')
      .reduce((s, b) => s + b.usage_amount, 0);
    const totalPropaneL = energy
      .filter(b => b.usage_unit === 'L' && b.bill_type === 'propane')
      .reduce((s, b) => s + b.usage_amount, 0);
    const totalWaterL = water
      .reduce((s, b) => s + b.usage_amount, 0);

    const totalEnergyCost = energy.reduce((s, b) => s + (b.cost || 0), 0);
    const totalWaterCost = water.reduce((s, b) => s + (b.cost || 0), 0);

    // Carbon calculation
    const carbonFromElec = totalKwh * EMISSION_FACTORS.electricity_kwh;
    const carbonFromGas = totalGasM3 * EMISSION_FACTORS.natural_gas_m3;
    const carbonFromPropane = totalPropaneL * EMISSION_FACTORS.propane_l;
    const carbonFromWater = totalWaterL * EMISSION_FACTORS.water_l;
    const totalCarbonKg = carbonFromElec + carbonFromGas + carbonFromPropane + carbonFromWater;

    // Try to get harvest totals for per-kg metrics
    let harvestKg = null;
    if (store) {
      try {
        const inv = await store.get(fid, `inventory_${fid}`) || await store.get(fid, 'inventory');
        if (inv && Array.isArray(inv)) {
          harvestKg = inv.reduce((s, i) => s + (i.weight_kg || i.quantity || 0), 0);
        }
      } catch (_) { /* ignore */ }
    }

    return res.json({
      ok: true,
      period_days: days,
      energy: {
        total_kwh: totalKwh,
        total_gas_m3: totalGasM3,
        total_propane_l: totalPropaneL,
        total_cost: totalEnergyCost,
        carbon_kg: carbonFromElec + carbonFromGas + carbonFromPropane,
        bill_count: energy.length
      },
      water: {
        total_liters: totalWaterL,
        total_cost: totalWaterCost,
        carbon_kg: carbonFromWater,
        bill_count: water.length
      },
      carbon: {
        total_kg: totalCarbonKg,
        daily_average_kg: days > 0 ? totalCarbonKg / days : 0,
        breakdown: {
          electricity: carbonFromElec,
          natural_gas: carbonFromGas,
          propane: carbonFromPropane,
          water: carbonFromWater
        }
      },
      per_kg_harvested: harvestKg ? {
        energy_kwh: totalKwh / harvestKg,
        water_l: totalWaterL / harvestKg,
        carbon_kg: totalCarbonKg / harvestKg,
        harvest_kg: harvestKg
      } : null,
      currency: recent[0]?.currency || 'CAD'
    });
  } catch (e) {
    console.error('[sustainability] GET /metrics error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/sustainability/food-miles  (read-only from buyer/order data)
router.get('/food-miles', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);

    // Try to read farm location + buyer locations from store
    let farmLat = null, farmLng = null;
    let avgMiles = null;
    let buyerCount = 0;

    if (store) {
      try {
        const farmData = await store.get(fid, `farm_settings_${fid}`) || await store.get(fid, 'farm_settings');
        if (farmData) {
          // farm_settings stores coords under coordinates.lat/lng (from farm.json)
          farmLat = farmData.coordinates?.lat ?? farmData.latitude ?? farmData.lat ?? null;
          farmLng = farmData.coordinates?.lng ?? farmData.longitude ?? farmData.lng ?? null;
        }
      } catch (_) { /* ignore */ }

      // Use wholesale buyer records from memory store (buyers are in DB, not farmStore)
      try {
        const buyers = listAllBuyers();
        if (Array.isArray(buyers) && buyers.length > 0 && farmLat && farmLng) {
          let totalDist = 0;
          let counted = 0;
          for (const b of buyers) {
            // buyer location uses latitude/longitude (not lat/lng)
            const blat = b.location?.latitude ?? b.location?.lat ?? b.lat ?? null;
            const blng = b.location?.longitude ?? b.location?.lng ?? b.lng ?? null;
            if (blat != null && blng != null) {
              totalDist += haversineKm(farmLat, farmLng, blat, blng);
              counted++;
            }
          }
          if (counted > 0) {
            avgMiles = (totalDist / counted) * 0.621371; // km → miles
            buyerCount = counted;
          }
        }
      } catch (_) { /* ignore */ }
    }

    return res.json({
      ok: true,
      avg_food_miles: avgMiles || 0,
      buyer_count: buyerCount,
      conventional_avg_miles: 1500,  // USDA estimate for conventional supply chain
      reduction_percent: avgMiles ? Math.max(0, ((1500 - avgMiles) / 1500 * 100)).toFixed(1) : null,
      farm_location: (farmLat && farmLng) ? { lat: farmLat, lng: farmLng } : null
    });
  } catch (e) {
    console.error('[sustainability] GET /food-miles error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Legacy compatibility endpoints (return derived data, not hard zeros) ──

// GET /api/sustainability/esg-report
router.get('/esg-report', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    const fid = farmId(req);
    const days = parseInt(req.query.days) || 30;
    const store = getFarmStore(req);

    if (pool) {
      // Use real ESG scoring engine
      try {
        const assessment = await calculateESGScore(pool, fid, { days, farmStore: store });
        return res.json({ ok: true, esg_score: assessment });
      } catch (esgErr) {
        logger.warn('[sustainability] ESG engine error, using fallback:', esgErr.message);
      }
    }

    // Fallback: derive from metrics if ESG engine unavailable
    const metricsUrl = `${req.protocol}://${req.get('host')}/api/sustainability/metrics?days=${days}`;
    let metrics;
    try {
      const r = await fetch(metricsUrl, {
        headers: { 'x-farm-id': fid },
        signal: AbortSignal.timeout(5000)
      });
      metrics = await r.json();
    } catch (_) {
      metrics = { ok: false };
    }

    const hasBills = metrics.ok && (metrics.energy?.bill_count > 0 || metrics.water?.bill_count > 0);

    // Improved fallback scoring (still better than pure placeholder)
    let score = 0, grade = 'N/A';
    const breakdown = { energy: 0, water: 0, carbon: 0, nutrients: 0, waste: 0 };

    if (hasBills) {
      if (metrics.energy?.total_kwh > 0) breakdown.energy = 60;
      if (metrics.water?.total_liters > 0) breakdown.water = 60;
      if (metrics.carbon?.total_kg > 0) breakdown.carbon = 50;
      // Vertical farms: no soil nutrients needed, inherently low waste
      breakdown.nutrients = 70;
      breakdown.waste = 65;

      score = Math.round(
        breakdown.energy * 0.25 +
        breakdown.water * 0.25 +
        breakdown.carbon * 0.25 +
        breakdown.nutrients * 0.10 +
        breakdown.waste * 0.15
      );
      grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    }

    return res.json({
      ok: true,
      esg_score: {
        total_score: score,
        grade,
        source: 'fallback',
        breakdown,
        metrics: {
          renewable_energy_percent: 0,
          water_recycling_percent: 0,
          waste_diversion_percent: 0
        }
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/sustainability/esg-history — ESG score trend over time
router.get('/esg-history', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.json({ ok: true, history: [] });

    const fid = farmId(req);
    const limit = parseInt(req.query.limit) || 12;
    const history = await getESGHistory(pool, fid, limit);
    return res.json({ ok: true, history });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Legacy simple endpoints — return data from metrics
router.get('/energy/usage', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const bills = store ? ((await store.get(fid, storeKey(fid, 'utility_bills'))) || []) : [];
    const energy = bills.filter(b => ['electricity', 'natural_gas', 'propane'].includes(b.bill_type));
    const totalKwh = energy.filter(b => b.usage_unit === 'kWh').reduce((s, b) => s + b.usage_amount, 0);
    const totalCost = energy.reduce((s, b) => s + (b.cost || 0), 0);
    const carbonKg = totalKwh * EMISSION_FACTORS.electricity_kwh;
    return res.json({ ok: true, total_kwh: totalKwh, by_source: {}, total_carbon_kg: carbonKg, total_cost_cad: totalCost });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/water/usage', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const bills = store ? ((await store.get(fid, storeKey(fid, 'utility_bills'))) || []) : [];
    const water = bills.filter(b => b.bill_type === 'water');
    const totalL = water.reduce((s, b) => s + b.usage_amount, 0);
    return res.json({ ok: true, total_liters_used: totalL, average_efficiency_percent: 0, total_liters_recycled: 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/carbon-footprint', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const bills = store ? ((await store.get(fid, storeKey(fid, 'utility_bills'))) || []) : [];
    let totalC = 0;
    for (const b of bills) {
      if (b.bill_type === 'electricity') totalC += b.usage_amount * EMISSION_FACTORS.electricity_kwh;
      else if (b.bill_type === 'natural_gas') totalC += b.usage_amount * EMISSION_FACTORS.natural_gas_m3;
      else if (b.bill_type === 'propane') totalC += b.usage_amount * EMISSION_FACTORS.propane_l;
      else if (b.bill_type === 'water') totalC += b.usage_amount * EMISSION_FACTORS.water_l;
    }
    return res.json({ ok: true, total_carbon_kg: totalC, daily_average_kg: totalC / 30 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/waste/tracking', (_req, res) => {
  // Waste management removed per user directive (not applicable to microgreen farms)
  return res.json({ ok: true, total_waste_kg: 0, diversion_rate_percent: 0, total_diverted_kg: 0, note: 'Waste tracking removed — not applicable to microgreen operations' });
});

router.get('/trends', async (req, res) => {
  try {
    const store = getFarmStore(req);
    const fid = farmId(req);
    const days = parseInt(req.query.days) || 30;
    const bills = store ? ((await store.get(fid, storeKey(fid, 'utility_bills'))) || []) : [];

    // Generate daily trend placeholders (bills don't have daily granularity)
    const trends = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      trends.push({
        date: d.toISOString().split('T')[0],
        energy_kwh: 0,
        water_liters: 0,
        carbon_kg: 0
      });
    }

    // Spread bill usage evenly across their billing period
    for (const b of bills) {
      if (!b.billing_period_start || !b.billing_period_end) continue;
      const start = new Date(b.billing_period_start);
      const end = new Date(b.billing_period_end);
      const billDays = Math.max(1, (end - start) / 86400000);
      const dailyUsage = b.usage_amount / billDays;

      for (const t of trends) {
        const td = new Date(t.date);
        if (td >= start && td <= end) {
          if (b.bill_type === 'electricity') {
            t.energy_kwh += dailyUsage;
            t.carbon_kg += dailyUsage * EMISSION_FACTORS.electricity_kwh;
          } else if (b.bill_type === 'water') {
            t.water_liters += dailyUsage;
            t.carbon_kg += dailyUsage * EMISSION_FACTORS.water_l;
          } else if (b.bill_type === 'natural_gas') {
            t.energy_kwh += dailyUsage * 10.55; // m³ → kWh equivalent
            t.carbon_kg += dailyUsage * EMISSION_FACTORS.natural_gas_m3;
          }
        }
      }
    }

    return res.json({ ok: true, trends });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────

function guessUnit(billType) {
  switch (billType) {
    case 'electricity': return 'kWh';
    case 'natural_gas': return 'm³';
    case 'propane': return 'L';
    case 'water': return 'L';
    default: return '';
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default router;
