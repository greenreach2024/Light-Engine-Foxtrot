import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const buyersByEmail = new Map();
const buyersById = new Map();

const ordersById = new Map();
const ordersByBuyerId = new Map();

const paymentsById = new Map();

export async function createBuyer({ businessName, contactName, email, password, buyerType, location }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');
  if (buyersByEmail.has(normalizedEmail)) {
    const err = new Error('Email already registered');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }

  const buyerId = `buyer-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(String(password || ''), 10);

  const buyer = {
    id: buyerId,
    businessName: String(businessName || '').trim(),
    contactName: String(contactName || '').trim(),
    email: normalizedEmail,
    buyerType: String(buyerType || '').trim(),
    location: location && typeof location === 'object' ? {
      address1: String(location.address1 || '').trim() || null,
      city: String(location.city || '').trim() || null,
      state: String(location.state || '').trim() || null,
      postalCode: String(location.postalCode || location.zip || '').trim() || null,
      latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
      longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null
    } : null,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  buyersByEmail.set(normalizedEmail, buyer);
  buyersById.set(buyerId, buyer);

  return sanitizeBuyer(buyer);
}

export async function authenticateBuyer({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const buyer = buyersByEmail.get(normalizedEmail);
  if (!buyer) return null;
  const ok = await bcrypt.compare(String(password || ''), buyer.passwordHash);
  if (!ok) return null;
  return sanitizeBuyer(buyer);
}

export function getBuyerById(buyerId) {
  const buyer = buyersById.get(buyerId);
  return buyer ? sanitizeBuyer(buyer) : null;
}

export function sanitizeBuyer(buyer) {
  return {
    id: buyer.id,
    businessName: buyer.businessName,
    contactName: buyer.contactName,
    email: buyer.email,
    buyerType: buyer.buyerType,
    location: buyer.location || null,
    createdAt: buyer.createdAt
  };
}

export function createOrder({ buyerId, buyerAccount, poNumber, deliveryDate, deliveryAddress, recurrence, farmSubOrders, totals }) {
  const orderId = `wo-${randomUUID()}`;
  const order = {
    master_order_id: orderId,
    status: 'confirmed',
    created_at: new Date().toISOString(),
    buyer_id: buyerId,
    buyer_account: buyerAccount,
    po_number: poNumber || null,
    delivery_date: deliveryDate,
    delivery_address: deliveryAddress,
    recurrence: recurrence || { cadence: 'one_time' },
    grand_total: totals.grand_total,
    broker_fee_total: totals.broker_fee_total,
    net_to_farms_total: totals.net_to_farms_total,
    farm_sub_orders: farmSubOrders
  };

  ordersById.set(orderId, order);
  if (!ordersByBuyerId.has(buyerId)) ordersByBuyerId.set(buyerId, []);
  ordersByBuyerId.get(buyerId).unshift(order);

  return order;
}

export function listOrdersForBuyer(buyerId) {
  return ordersByBuyerId.get(buyerId) || [];
}

export function listAllOrders() {
  return Array.from(ordersById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function updateFarmSubOrder({ orderId, farmId, updates }) {
  const order = ordersById.get(orderId);
  if (!order) return null;

  const subOrder = (order.farm_sub_orders || []).find((sub) => sub.farm_id === farmId);
  if (!subOrder) return null;

  Object.assign(subOrder, updates);
  
  // Update in buyer's list too
  const buyerOrders = ordersByBuyerId.get(order.buyer_id);
  if (buyerOrders) {
    const idx = buyerOrders.findIndex((o) => o.master_order_id === orderId);
    if (idx >= 0) buyerOrders[idx] = order;
  }

  return subOrder;
}

export function createPayment({ orderId, provider, split, totals }) {
  const paymentId = `pay-${randomUUID()}`;
  const payment = {
    id: paymentId,
    payment_id: paymentId,
    order_id: orderId,
    provider: provider || 'demo',
    status: 'created',
    amount: totals.grand_total,
    broker_fee_amount: totals.broker_fee_total,
    net_to_farms_total: totals.net_to_farms_total,
    split,
    created_at: new Date().toISOString()
  };
  paymentsById.set(paymentId, payment);
  return payment;
}

export function listPayments() {
  return Array.from(paymentsById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function listRefunds() {
  return [];
}
