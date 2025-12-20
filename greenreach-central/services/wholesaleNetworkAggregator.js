function haversineKm(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sLat1 = toRad(lat1);
  const sLat2 = toRad(lat2);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

async function safeFetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 4000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal, headers: options.headers });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, json: null, error };
  } finally {
    clearTimeout(timer);
  }
}

function mapFarmInventoryToCatalogItems({ farm, inventory }) {
  const lots = inventory?.lots || [];
  const items = lots.map((lot) => {
    const skuId = String(lot.sku_id || lot.skuId || '').trim();
    const skuName = String(lot.sku_name || lot.skuName || skuId).trim();
    return {
      sku_id: skuId,
      product_name: skuName,
      size: lot.pack_size ? `${lot.pack_size}${lot.unit || ''}` : 'Bulk',
      unit: lot.unit || 'unit',
      farms: [
        {
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          quantity_available: Number(lot.qty_available || 0),
          price_per_unit: Number(lot.price_per_unit || 0),
          organic: Boolean(lot.organic),
          lots: [
            {
              lot_id: lot.lot_id || null,
              qr_payload: lot.qr_payload || null,
              label_text: lot.label_text || null,
              qty_available: Number(lot.qty_available || 0),
              harvest_date_start: lot.harvest_date_start,
              harvest_date_end: lot.harvest_date_end,
              location: lot.location || null
            }
          ],
          harvest_date_start: lot.harvest_date_start,
          harvest_date_end: lot.harvest_date_end,
          crop_type: lot.crop_type,
          days_to_harvest: lot.days_to_harvest,
          quality_flags: lot.quality_flags || []
        }
      ]
    };
  });

  // Coalesce by sku_id across lots within the same farm
  const bySku = new Map();
  for (const it of items) {
    if (!it.sku_id) continue;
    const existing = bySku.get(it.sku_id);
    if (!existing) {
      bySku.set(it.sku_id, it);
      continue;
    }

    const existingFarm = existing.farms[0];
    const nextFarm = it.farms[0];
    existingFarm.quantity_available += Number(nextFarm.quantity_available || 0);
    existingFarm.price_per_unit = Math.min(Number(existingFarm.price_per_unit || 0), Number(nextFarm.price_per_unit || 0));
    if (Array.isArray(existingFarm.lots) && Array.isArray(nextFarm.lots)) {
      existingFarm.lots.push(...nextFarm.lots);
    }
  }

  return Array.from(bySku.values());
}

const state = {
  farms: [],
  snapshotsByFarmId: new Map(),
  historyByFarmId: new Map(),
  marketEvents: []
};

export async function setNetworkFarms(farms) {
  state.farms = Array.isArray(farms) ? farms : [];
}

export function getNetworkState() {
  return state;
}

export async function syncNetworkOnce({ includeFarmJson = true } = {}) {
  const results = [];

  for (const farm of state.farms) {
    if (!farm?.base_url) continue;

    const inventoryUrl = new URL('/api/wholesale/inventory', farm.base_url).toString();
    const inventoryRes = await safeFetchJson(inventoryUrl, { timeoutMs: 5000 });

    let farmMeta = null;
    if (includeFarmJson) {
      const metaUrl = new URL('/data/farm.json', farm.base_url).toString();
      const metaRes = await safeFetchJson(metaUrl, { timeoutMs: 3000 });
      if (metaRes.ok && metaRes.json) farmMeta = metaRes.json;
    }

    const ok = Boolean(inventoryRes.ok && inventoryRes.json?.ok);

    const mergedFarm = {
      ...farm,
      farm_name: farmMeta?.name || farm.farm_name,
      latitude: farmMeta?.location?.lat ?? farmMeta?.lat ?? farm.latitude,
      longitude: farmMeta?.location?.lng ?? farmMeta?.lng ?? farm.longitude,
      city: farmMeta?.location?.city ?? farmMeta?.city ?? farm.city,
      state: farmMeta?.location?.state ?? farmMeta?.state ?? farm.state
    };

    const snapshot = {
      farm: mergedFarm,
      ok,
      fetched_at: new Date().toISOString(),
      inventory: inventoryRes.json
    };

    state.snapshotsByFarmId.set(mergedFarm.farm_id, snapshot);

    const totalAvailable = (inventoryRes.json?.lots || []).reduce((sum, lot) => sum + Number(lot.qty_available || 0), 0);
    if (!state.historyByFarmId.has(mergedFarm.farm_id)) state.historyByFarmId.set(mergedFarm.farm_id, []);

    const history = state.historyByFarmId.get(mergedFarm.farm_id);
    history.push({ t: Date.now(), total_available: totalAvailable });

    // Keep last 30 days-ish in memory
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    while (history.length && history[0].t < cutoff) history.shift();

    results.push({
      farm_id: mergedFarm.farm_id,
      ok,
      status: inventoryRes.status,
      total_available: totalAvailable
    });
  }

  return { results, timestamp: new Date().toISOString() };
}

export function getBuyerLocationFromBuyer(buyer) {
  const loc = buyer?.location || null;
  if (!loc) return null;
  const latitude = Number(loc.latitude);
  const longitude = Number(loc.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
  return null;
}

export function buildAggregateCatalog({ buyerLocation = null } = {}) {
  const itemsBySku = new Map();

  for (const snapshot of state.snapshotsByFarmId.values()) {
    if (!snapshot?.ok) continue;

    const farm = snapshot.farm;
    const mapped = mapFarmInventoryToCatalogItems({ farm, inventory: snapshot.inventory });

    for (const item of mapped) {
      if (!item.sku_id) continue;

      const existing = itemsBySku.get(item.sku_id);
      if (!existing) {
        itemsBySku.set(item.sku_id, {
          ...item,
          farms: item.farms.map((f) => {
            const distance_km = buyerLocation ? haversineKm(buyerLocation, farm) : null;
            const qty = Number(f.quantity_available || 0);
            return { ...f, qty_available: qty, distance_km };
          })
        });
        continue;
      }

      const distance_km = buyerLocation ? haversineKm(buyerLocation, farm) : null;
      const nextFarm = item.farms[0];
      const qty = Number(nextFarm.quantity_available || 0);
      existing.farms.push({ ...nextFarm, qty_available: qty, distance_km });
    }
  }

  const items = Array.from(itemsBySku.values()).map((sku) => {
    const farms = sku.farms || [];
    const totalQty = farms.reduce((sum, f) => sum + Number(f.quantity_available || 0), 0);
    const bestPrice = farms.length ? Math.min(...farms.map((f) => Number(f.price_per_unit || 0))) : 0;
    const organic = farms.some((f) => Boolean(f.organic));

    return {
      ...sku,
      total_qty_available: totalQty,
      price_per_unit: bestPrice,
      organic
    };
  });

  return { items, generated_at: new Date().toISOString() };
}

export function allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation }) {
  const itemsBySku = new Map((catalog?.items || []).map((it) => [it.sku_id, it]));

  const mode = sourcing?.mode || 'auto_network';
  const singleFarmId = sourcing?.farm_id || null;

  const farmMap = new Map();
  let grandTotal = 0;

  for (const line of cart || []) {
    const skuId = line.sku_id;
    const requestedQty = Number(line.quantity || 0);
    if (!skuId || requestedQty <= 0) continue;

    const sku = itemsBySku.get(skuId);
    if (!sku) continue;

    let qtyRemaining = requestedQty;

    let farms = [...(sku.farms || [])];

    if (mode === 'single_farm' && singleFarmId) {
      farms = farms.filter((f) => f.farm_id === singleFarmId);
    }

    farms.sort((a, b) => {
      const da = buyerLocation ? (Number(a.distance_km) || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
      const db = buyerLocation ? (Number(b.distance_km) || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return Number(a.price_per_unit || 0) - Number(b.price_per_unit || 0);
    });

    for (const farm of farms) {
      if (qtyRemaining <= 0) break;
      const available = Math.min(qtyRemaining, Number(farm.quantity_available || 0));
      if (available <= 0) continue;

      qtyRemaining -= available;
      const price = Number(farm.price_per_unit || 0);
      const lineTotal = available * price;
      grandTotal += lineTotal;

      if (!farmMap.has(farm.farm_id)) {
        farmMap.set(farm.farm_id, {
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          subtotal: 0,
          items: []
        });
      }

      const sub = farmMap.get(farm.farm_id);
      sub.subtotal += lineTotal;
      sub.items.push({
        sku_id: skuId,
        product_name: sku.product_name,
        quantity: available,
        unit: sku.unit,
        price_per_unit: price
      });
    }
  }

  const farmSubOrders = Array.from(farmMap.values()).map((sub) => {
    const brokerFee = Number((sub.subtotal * commissionRate).toFixed(2));
    const netToFarm = Number((sub.subtotal - brokerFee).toFixed(2));
    return {
      ...sub,
      broker_fee: brokerFee,
      net_to_farm: netToFarm
    };
  });

  const brokerFeeTotal = Number(farmSubOrders.reduce((sum, s) => sum + s.broker_fee, 0).toFixed(2));
  const netToFarmsTotal = Number(farmSubOrders.reduce((sum, s) => sum + s.net_to_farm, 0).toFixed(2));

  return {
    allocation: {
      grand_total: Number(grandTotal.toFixed(2)),
      broker_fee_total: brokerFeeTotal,
      net_to_farms_total: netToFarmsTotal,
      farm_sub_orders: farmSubOrders
    },
    payment_split: farmSubOrders.map((s) => ({
      farm_id: s.farm_id,
      farm_name: s.farm_name,
      gross: Number(s.subtotal.toFixed(2)),
      broker_fee: s.broker_fee,
      net_to_farm: s.net_to_farm
    }))
  };
}

export function listNetworkSnapshots() {
  return Array.from(state.snapshotsByFarmId.values()).map((s) => {
    const lots = s.inventory?.lots || [];
    const total_available = lots.reduce((sum, lot) => sum + Number(lot.qty_available || 0), 0);
    const next14 = lots.filter((lot) => Number(lot.days_to_harvest) <= 14).reduce((sum, lot) => sum + Number(lot.qty_available || 0), 0);
    return {
      farm: s.farm,
      ok: s.ok,
      fetched_at: s.fetched_at,
      totals: {
        lots: lots.length,
        total_available,
        available_next14_days: next14
      }
    };
  });
}

export function aggregateSupplyBySku() {
  const catalog = buildAggregateCatalog();
  return catalog.items
    .map((it) => {
      const total = (it.farms || []).reduce((sum, f) => sum + Number(f.quantity_available || 0), 0);
      const bestPrice = (it.farms || []).length ? Math.min(...it.farms.map((f) => Number(f.price_per_unit || 0))) : 0;
      return {
        sku_id: it.sku_id,
        product_name: it.product_name,
        unit: it.unit,
        total_available: total,
        best_price: bestPrice
      };
    })
    .sort((a, b) => b.total_available - a.total_available);
}

export function getNetworkTrends() {
  const series = [];
  for (const [farmId, history] of state.historyByFarmId.entries()) {
    series.push({ farm_id: farmId, points: history });
  }
  return { series, generated_at: new Date().toISOString() };
}

export function listMarketEvents() {
  return [...state.marketEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function addMarketEvent({ date, title, notes, impact }) {
  const event = {
    id: `evt-${Math.random().toString(16).slice(2)}`,
    date: date || new Date().toISOString().slice(0, 10),
    title: String(title || '').trim(),
    notes: String(notes || '').trim(),
    impact: String(impact || '').trim(),
    created_at: new Date().toISOString()
  };
  state.marketEvents.unshift(event);
  return event;
}

export function generateNetworkRecommendations({ recentOrders = [] } = {}) {
  const supply = aggregateSupplyBySku();
  const demandBySku = new Map();

  for (const order of recentOrders || []) {
    for (const sub of order.farm_sub_orders || []) {
      for (const item of sub.items || []) {
        const sku = item.sku_id;
        demandBySku.set(sku, (demandBySku.get(sku) || 0) + Number(item.quantity || 0));
      }
    }
  }

  const topDemand = [...demandBySku.entries()]
    .map(([sku_id, qty]) => ({ sku_id, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const recommendations = [];

  if (state.farms.length === 0) {
    recommendations.push({
      title: 'Add farms to the network',
      detail: 'Register at least one Light Engine farm base URL so GreenReach can pull inventory.'
    });
  }

  if (supply.length === 0) {
    recommendations.push({
      title: 'No inventory snapshots yet',
      detail: 'Run a sync from the Network view to pull /api/wholesale/inventory from each farm.'
    });
  }

  for (const item of supply.slice(0, 5)) {
    const demand = Number(demandBySku.get(item.sku_id) || 0);
    if (demand > item.total_available) {
      recommendations.push({
        title: `Demand exceeds supply: ${item.product_name}`,
        detail: `Recent demand ${demand} ${item.unit} vs available ${item.total_available} ${item.unit}. Consider prompting farms to seed more or source externally.`
      });
    }
  }

  if (topDemand.length) {
    recommendations.push({
      title: 'Top demand SKUs',
      detail: topDemand.map((d) => `${d.sku_id}: ${d.qty}`).join(', ')
    });
  }

  const events = listMarketEvents().slice(0, 3);
  for (const evt of events) {
    recommendations.push({
      title: `Market event (${evt.date}): ${evt.title}`,
      detail: evt.notes || evt.impact || 'Review impact on pricing and allocation.'
    });
  }

  return { recommendations, generated_at: new Date().toISOString() };
}
