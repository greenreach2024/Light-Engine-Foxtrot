import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cached = null;

export async function loadWholesaleDemoCatalog() {
  if (cached) return cached;
  const filePath = path.join(__dirname, '..', 'public', 'data', 'wholesale-demo-catalog.json');
  const raw = await fs.readFile(filePath, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export function mapDemoItemToUiSku(item, farmDirectory) {
  const farms = (item.farms || []).map((farm) => {
    const meta = farmDirectory[farm.farm_id] || {};
    return {
      farm_id: farm.farm_id,
      farm_name: farm.farm_name,
      qty_available: Number(farm.quantity_available ?? 0),
      unit: item.unit,
      price_per_unit: Number(farm.price_per_unit ?? 0),
      organic: Boolean(farm.organic),
      certifications: meta.certifications || [],
      practices: meta.practices || [],
      attributes: meta.attributes || [],
      location: meta.location || meta.location_name || meta.location || ''
    };
  });

  const totalQty = farms.reduce((sum, farm) => sum + Number(farm.qty_available || 0), 0);
  const bestPrice = farms.length ? Math.min(...farms.map((f) => Number(f.price_per_unit || 0))) : 0;

  return {
    sku_id: item.sku_id,
    product_name: item.product_name,
    size: item.size || 'Bulk Case',
    unit: item.unit,
    price_per_unit: bestPrice,
    total_qty_available: totalQty,
    farms,
    organic: farms.some((f) => f.organic)
  };
}

export function allocateCartFromDemo({ cart, demoCatalog, commissionRate }) {
  const itemsBySku = new Map((demoCatalog.items || []).map((it) => [it.sku_id, it]));

  const farmMap = new Map();
  let grandTotal = 0;

  for (const line of cart || []) {
    const skuId = line.sku_id;
    const requestedQty = Number(line.quantity || 0);
    if (!skuId || requestedQty <= 0) continue;

    const sku = itemsBySku.get(skuId);
    if (!sku) continue;

    let qtyRemaining = requestedQty;
    const farms = [...(sku.farms || [])].sort((a, b) => Number(a.price_per_unit) - Number(b.price_per_unit));

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

  const brokerFeeTotal = Number((farmSubOrders.reduce((sum, s) => sum + s.broker_fee, 0)).toFixed(2));
  const netToFarmsTotal = Number((farmSubOrders.reduce((sum, s) => sum + s.net_to_farm, 0)).toFixed(2));

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
