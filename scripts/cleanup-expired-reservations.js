#!/usr/bin/env node
/**
 * Cron Job: Cleanup Expired Reservations
 * Runs hourly to remove reservations older than 24 hours
 * This ensures inventory doesn't get stuck in "reserved" state
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const RESERVATIONS_FILE = path.join(PUBLIC_DIR, 'data', 'wholesale-reservations.json');

console.log('[Reservation Cleanup] Starting cleanup job...');
console.log(`[Reservation Cleanup] Time: ${new Date().toISOString()}`);

function loadReservations() {
  try {
    const raw = fs.readFileSync(RESERVATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.reservations) ? parsed.reservations : [];
  } catch {
    return [];
  }
}

function saveReservations(reservations) {
  const payload = {
    reservations: reservations || [],
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function cleanupExpiredReservations() {
  const now = Date.now();
  const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
  
  const reservations = loadReservations();
  const initialCount = reservations.length;
  
  const active = reservations.filter((r) => {
    const reservedAt = new Date(r.reserved_at).getTime();
    const age = now - reservedAt;
    const isExpired = age >= ttlMs;
    
    if (isExpired) {
      const ageHours = Math.floor(age / (1000 * 60 * 60));
      console.log(`[Reservation Cleanup] Removing expired reservation: order_id=${r.order_id}, sku_id=${r.sku_id}, age=${ageHours}h`);
    }
    
    return !isExpired;
  });
  
  const removedCount = initialCount - active.length;
  
  if (removedCount > 0) {
    saveReservations(active);
    console.log(`[Reservation Cleanup] ✅ Removed ${removedCount} expired reservation(s)`);
    console.log(`[Reservation Cleanup] Active reservations: ${active.length}`);
  } else {
    console.log(`[Reservation Cleanup] ✅ No expired reservations found`);
    console.log(`[Reservation Cleanup] Active reservations: ${active.length}`);
  }
  
  // Log summary by SKU
  const bySku = new Map();
  active.forEach(r => {
    const current = bySku.get(r.sku_id) || 0;
    bySku.set(r.sku_id, current + Number(r.quantity || 0));
  });
  
  if (bySku.size > 0) {
    console.log(`[Reservation Cleanup] Reserved quantities by SKU:`);
    bySku.forEach((qty, sku) => {
      console.log(`  - ${sku}: ${qty} reserved`);
    });
  }
  
  return {
    initial: initialCount,
    removed: removedCount,
    active: active.length
  };
}

// Run cleanup
try {
  const result = cleanupExpiredReservations();
  
  console.log('[Reservation Cleanup] Cleanup complete');
  console.log(`[Reservation Cleanup] Summary: ${result.removed} removed, ${result.active} active`);
  
  process.exit(0);
} catch (error) {
  console.error('[Reservation Cleanup] Error:', error);
  process.exit(1);
}
