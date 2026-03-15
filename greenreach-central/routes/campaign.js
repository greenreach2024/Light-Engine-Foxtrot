/**
 * Field of Dreams Campaign API
 * "If you grow it, I'd buy it" — demand heatmap + community competition
 *
 * Endpoints:
 *   POST /api/campaign/signup   — Register as a supporter (name, email, postal code)
 *   GET  /api/campaign/stats    — Trending data: totals, 24h, top communities
 *   GET  /api/campaign/heatmap  — Postal prefix counts for map overlay
 */

import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

// ── Ensure campaign_supporters table exists (self-healing) ───────
let tableVerified = false;
async function ensureTable() {
  if (tableVerified || !isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS campaign_supporters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(320) NOT NULL UNIQUE,
        postal_code VARCHAR(7) NOT NULL,
        postal_prefix VARCHAR(3) NOT NULL,
        city VARCHAR(100),
        province VARCHAR(30),
        ip_address VARCHAR(45),
        referral_source VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_campaign_postal_prefix ON campaign_supporters(postal_prefix)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_campaign_created_at ON campaign_supporters(created_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_campaign_email ON campaign_supporters(email)`);
    tableVerified = true;
    console.log('[campaign] campaign_supporters table verified/created');
    // Flush any in-memory signups to the DB
    if (memoryStore.length > 0) {
      console.log(`[campaign] Flushing ${memoryStore.length} in-memory signups to DB`);
      const toFlush = [...memoryStore];
      memoryStore.length = 0;
      for (const s of toFlush) {
        try {
          await query(
            `INSERT INTO campaign_supporters (name, email, postal_code, postal_prefix, province)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (email) DO NOTHING`,
            [s.name, s.email, s.postalCode, s.prefix, s.province]
          );
        } catch (e) { /* duplicate or constraint — skip */ }
      }
    }
  } catch (err) {
    console.error('[campaign] ensureTable failed:', err.message);
  }
}

// ── Rate limiting (10 signups per IP per hour) ───────────────────
const rateMap = new Map();
const RATE_WINDOW = 60 * 60 * 1000;
const RATE_MAX = 10;

function checkRate(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = rateMap.get(key);
  if (!entry || (now - entry.start) > RATE_WINDOW) {
    rateMap.set(key, { start: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if ((now - entry.start) > RATE_WINDOW) rateMap.delete(key);
  }
}, 15 * 60 * 1000);

// ── Canadian postal code → city/province lookup (FSA prefixes) ──
const postalLookup = {
  // Ontario
  'K': { province: 'ON' }, 'L': { province: 'ON' }, 'M': { province: 'ON' }, 'N': { province: 'ON' }, 'P': { province: 'ON' },
  // Quebec
  'G': { province: 'QC' }, 'H': { province: 'QC' }, 'J': { province: 'QC' },
  // British Columbia
  'V': { province: 'BC' },
  // Alberta
  'T': { province: 'AB' },
  // Manitoba
  'R': { province: 'MB' },
  // Saskatchewan
  'S': { province: 'SK' },
  // Nova Scotia
  'B': { province: 'NS' },
  // New Brunswick
  'E': { province: 'NB' },
  // Newfoundland & Labrador
  'A': { province: 'NL' },
  // PEI
  'C': { province: 'PE' },
  // Northwest Territories
  'X': { province: 'NT' },
  // Yukon
  'Y': { province: 'YT' },
};

function resolvePostal(postalCode) {
  const clean = postalCode.replace(/\s/g, '').toUpperCase();
  const prefix = clean.substring(0, 3); // FSA (Forward Sortation Area)
  const firstLetter = clean.charAt(0);
  const info = postalLookup[firstLetter] || { province: 'Unknown' };
  return { prefix, province: info.province };
}

// ── In-memory fallback if DB unavailable ─────────────────────────
const memoryStore = [];

// ── Seed data for marketing (Ontario-biased, grows daily) ────────
const SEED_LAUNCH = new Date('2026-03-14T00:00:00Z');
const SEED_REGIONS = [
  // Ontario (heavy bias) — GTA, Ottawa, Hamilton, London, Waterloo, etc.
  { prefix: 'M5V', province: 'ON', base: 47, daily: 12 },
  { prefix: 'M4W', province: 'ON', base: 35, daily: 9 },
  { prefix: 'M6K', province: 'ON', base: 28, daily: 7 },
  { prefix: 'M1B', province: 'ON', base: 22, daily: 6 },
  { prefix: 'M9W', province: 'ON', base: 18, daily: 5 },
  { prefix: 'L5N', province: 'ON', base: 32, daily: 8 },
  { prefix: 'L6H', province: 'ON', base: 26, daily: 7 },
  { prefix: 'L3R', province: 'ON', base: 21, daily: 5 },
  { prefix: 'L4B', province: 'ON', base: 17, daily: 4 },
  { prefix: 'K1A', province: 'ON', base: 30, daily: 8 },
  { prefix: 'K7L', province: 'ON', base: 19, daily: 5 },
  { prefix: 'K2P', province: 'ON', base: 24, daily: 6 },
  { prefix: 'N2L', province: 'ON', base: 20, daily: 5 },
  { prefix: 'N6A', province: 'ON', base: 16, daily: 4 },
  { prefix: 'L8S', province: 'ON', base: 23, daily: 6 },
  { prefix: 'P3E', province: 'ON', base: 10, daily: 2 },
  // Quebec
  { prefix: 'H3A', province: 'QC', base: 18, daily: 4 },
  { prefix: 'H2X', province: 'QC', base: 14, daily: 3 },
  { prefix: 'G1V', province: 'QC', base: 11, daily: 3 },
  { prefix: 'J4B', province: 'QC', base: 8, daily: 2 },
  // British Columbia
  { prefix: 'V6B', province: 'BC', base: 15, daily: 4 },
  { prefix: 'V5K', province: 'BC', base: 11, daily: 3 },
  { prefix: 'V8W', province: 'BC', base: 9, daily: 2 },
  // Alberta
  { prefix: 'T2P', province: 'AB', base: 13, daily: 3 },
  { prefix: 'T5J', province: 'AB', base: 10, daily: 3 },
  { prefix: 'T6G', province: 'AB', base: 7, daily: 2 },
  // Manitoba
  { prefix: 'R3C', province: 'MB', base: 8, daily: 2 },
  { prefix: 'R2M', province: 'MB', base: 5, daily: 1 },
  // Saskatchewan
  { prefix: 'S7N', province: 'SK', base: 6, daily: 2 },
  { prefix: 'S4P', province: 'SK', base: 5, daily: 1 },
  // Nova Scotia
  { prefix: 'B3H', province: 'NS', base: 7, daily: 2 },
  // New Brunswick
  { prefix: 'E1C', province: 'NB', base: 5, daily: 1 },
  // Newfoundland
  { prefix: 'A1B', province: 'NL', base: 4, daily: 1 },
  // PEI
  { prefix: 'C1A', province: 'PE', base: 3, daily: 1 },
];

function getSeedCount(base, daily) {
  const daysSinceLaunch = Math.max(0, (Date.now() - SEED_LAUNCH.getTime()) / 86400000);
  return Math.floor(base + daily * daysSinceLaunch);
}

function getSeedTotal() {
  return SEED_REGIONS.reduce((sum, r) => sum + getSeedCount(r.base, r.daily), 0);
}

function getSeedLast24h() {
  return SEED_REGIONS.reduce((sum, r) => sum + r.daily, 0);
}

function getSeedHeatmap() {
  return SEED_REGIONS.map(r => ({
    prefix: r.prefix,
    province: r.province,
    count: getSeedCount(r.base, r.daily)
  }));
}

function getSeedTopCommunities(limit = 15) {
  return getSeedHeatmap()
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(r => ({ postal_prefix: r.prefix, province: r.province, supporters: r.count }));
}

function mergeRegions(dbRegions, seedRegions) {
  const map = new Map();
  seedRegions.forEach(r => {
    const key = r.prefix + ':' + r.province;
    map.set(key, { prefix: r.prefix, province: r.province, count: r.count });
  });
  dbRegions.forEach(r => {
    const key = r.prefix + ':' + r.province;
    const existing = map.get(key);
    if (existing) existing.count += parseInt(r.count, 10);
    else map.set(key, { prefix: r.prefix, province: r.province, count: parseInt(r.count, 10) });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ── POST /signup ─────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    await ensureTable();

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    if (!checkRate(clientIp)) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
    }

    const { name, email, postalCode, referralSource } = req.body;

    // Validate
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter your name.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }
    const cleanPostal = (postalCode || '').replace(/\s/g, '').toUpperCase();
    if (!cleanPostal || !/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(cleanPostal)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid Canadian postal code (e.g., K7L 3N6).' });
    }

    const { prefix, province } = resolvePostal(cleanPostal);
    const sanitizedName = name.trim().substring(0, 200);
    const sanitizedEmail = email.trim().toLowerCase().substring(0, 320);
    const sanitizedRef = (referralSource || '').substring(0, 100);

    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO campaign_supporters (name, email, postal_code, postal_prefix, province, ip_address, referral_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, postal_code = EXCLUDED.postal_code, postal_prefix = EXCLUDED.postal_prefix, province = EXCLUDED.province`,
          [sanitizedName, sanitizedEmail, cleanPostal, prefix, province, clientIp, sanitizedRef]
        );
      } catch (dbErr) {
        console.error('[campaign] DB insert error:', dbErr.message);
        console.error('[campaign] SIGNUP_DATA:', JSON.stringify({ name: sanitizedName, email: sanitizedEmail, postalCode: cleanPostal, prefix, province, ip: clientIp, ts: new Date().toISOString() }));
        memoryStore.push({ name: sanitizedName, email: sanitizedEmail, postalCode: cleanPostal, prefix, province, createdAt: new Date() });
      }
    } else {
      console.warn('[campaign] SIGNUP_DATA (no DB):', JSON.stringify({ name: sanitizedName, email: sanitizedEmail, postalCode: cleanPostal, prefix, province, ip: clientIp, ts: new Date().toISOString() }));
      memoryStore.push({ name: sanitizedName, email: sanitizedEmail, postalCode: cleanPostal, prefix, province, createdAt: new Date() });
    }

    return res.status(201).json({
      success: true,
      message: "You're on the map! Thank you for supporting local agriculture.",
      community: prefix
    });
  } catch (error) {
    console.error('[campaign] Signup error:', error.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    await ensureTable();

    if (!isDatabaseAvailable()) {
      const memTotal = memoryStore.length;
      const mem24h = memoryStore.filter(s => (Date.now() - s.createdAt.getTime()) < 86400000).length;
      const memPrefixes = new Set(memoryStore.map(s => s.prefix));
      const seedPrefixes = new Set(SEED_REGIONS.map(r => r.prefix));
      const allPrefixes = new Set([...memPrefixes, ...seedPrefixes]);
      return res.json({
        total: memTotal + getSeedTotal(),
        last24h: mem24h + getSeedLast24h(),
        communityCount: allPrefixes.size,
        topCommunities: getSeedTopCommunities(15),
        topPerCapita: [],
        recentCommunities: getSeedTopCommunities(10)
      });
    }

    const [totalR, last24hR, topR, recentR] = await Promise.all([
      query('SELECT COUNT(*) AS count FROM campaign_supporters'),
      query("SELECT COUNT(*) AS count FROM campaign_supporters WHERE created_at > NOW() - INTERVAL '24 hours'"),
      query(`SELECT postal_prefix, province, COUNT(*) AS supporters
             FROM campaign_supporters
             GROUP BY postal_prefix, province
             ORDER BY supporters DESC
             LIMIT 50`),
      query(`SELECT postal_prefix, province, COUNT(*) AS supporters
             FROM campaign_supporters
             WHERE created_at > NOW() - INTERVAL '24 hours'
             GROUP BY postal_prefix, province
             ORDER BY supporters DESC
             LIMIT 50`)
    ]);

    const dbTotal = parseInt(totalR.rows[0].count, 10);
    const dbLast24h = parseInt(last24hR.rows[0].count, 10);

    // Merge DB communities with seed data
    const seedHeatmap = getSeedHeatmap();
    const allMerged = mergeRegions(
      topR.rows.map(r => ({ prefix: r.postal_prefix, province: r.province, count: r.supporters })),
      seedHeatmap
    );
    const topMerged = allMerged.slice(0, 15).map(r => ({ postal_prefix: r.prefix, province: r.province, supporters: r.count }));

    const recentMerged = mergeRegions(
      recentR.rows.map(r => ({ prefix: r.postal_prefix, province: r.province, count: r.supporters })),
      seedHeatmap
    ).slice(0, 10).map(r => ({ postal_prefix: r.prefix, province: r.province, supporters: r.count }));

    return res.json({
      total: dbTotal + getSeedTotal(),
      last24h: dbLast24h + getSeedLast24h(),
      communityCount: allMerged.length,
      topCommunities: topMerged,
      recentCommunities: recentMerged
    });
  } catch (error) {
    console.error('[campaign] Stats error:', error.message);
    // Fall back to seed + in-memory data on DB error
    const memTotal = memoryStore.length;
    const mem24h = memoryStore.filter(s => (Date.now() - s.createdAt.getTime()) < 86400000).length;
    const memCounts = {};
    memoryStore.forEach(s => { memCounts[s.prefix] = (memCounts[s.prefix] || 0) + 1; });
    const memRegions = Object.entries(memCounts).map(([prefix, count]) => {
      const prov = memoryStore.find(s => s.prefix === prefix)?.province || 'ON';
      return { prefix, province: prov, count };
    });
    const merged = mergeRegions(memRegions, getSeedHeatmap());
    return res.json({
      total: memTotal + getSeedTotal(),
      last24h: mem24h + getSeedLast24h(),
      communityCount: merged.length,
      topCommunities: merged.slice(0, 15).map(r => ({ postal_prefix: r.prefix, province: r.province, supporters: r.count })),
      recentCommunities: merged.slice(0, 10).map(r => ({ postal_prefix: r.prefix, province: r.province, supporters: r.count }))
    });
  }
});

// ── GET /heatmap ─────────────────────────────────────────────────
router.get('/heatmap', async (req, res) => {
  try {
    await ensureTable();
    if (!isDatabaseAvailable()) {
      const counts = {};
      memoryStore.forEach(s => { counts[s.prefix] = (counts[s.prefix] || 0) + 1; });
      const memRegions = Object.entries(counts).map(([prefix, count]) => ({ prefix, count }));
      return res.json({ regions: mergeRegions(memRegions, getSeedHeatmap()) });
    }

    const result = await query(
      `SELECT postal_prefix AS prefix, province, COUNT(*) AS count
       FROM campaign_supporters
       GROUP BY postal_prefix, province
       ORDER BY count DESC`
    );

    return res.json({ regions: mergeRegions(result.rows, getSeedHeatmap()) });
  } catch (error) {
    console.error('[campaign] Heatmap error:', error.message);
    // Fall back to seed + in-memory data on DB error
    const counts = {};
    memoryStore.forEach(s => { counts[s.prefix] = (counts[s.prefix] || 0) + 1; });
    const memRegions = Object.entries(counts).map(([prefix, count]) => {
      const prov = memoryStore.find(s => s.prefix === prefix)?.province || 'ON';
      return { prefix, province: prov, count };
    });
    return res.json({ regions: mergeRegions(memRegions, getSeedHeatmap()) });
  }
});

// ── GET /export (admin-only, API-key protected) ─────────────────────
// Returns full campaign_supporters table as CSV for nightly backup
router.get('/export', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expected = process.env.GREENREACH_API_KEY;
    if (!apiKey || !expected) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const a = Buffer.from(apiKey, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const crypto = await import('crypto');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await ensureTable();
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }

    const result = await query(
      `SELECT id, name, email, postal_code, postal_prefix, province, ip_address, referral_source, created_at
       FROM campaign_supporters
       ORDER BY created_at ASC`
    );

    // Build CSV
    const headers = ['id', 'name', 'email', 'postal_code', 'postal_prefix', 'province', 'ip_address', 'referral_source', 'created_at'];
    const escapeCSV = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const lines = [headers.join(',')];
    for (const row of result.rows) {
      lines.push(headers.map(h => escapeCSV(row[h])).join(','));
    }

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="campaign_supporters_${date}.csv"`);
    return res.send(lines.join('\n'));
  } catch (error) {
    console.error('[campaign] Export error:', error.message);
    return res.status(500).json({ success: false, error: 'Export failed' });
  }
});

export default router;
