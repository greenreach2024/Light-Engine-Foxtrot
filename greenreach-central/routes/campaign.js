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

// ── POST /signup ─────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
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
        memoryStore.push({ name: sanitizedName, email: sanitizedEmail, postalCode: cleanPostal, prefix, province, createdAt: new Date() });
      }
    } else {
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
    if (!isDatabaseAvailable()) {
      return res.json({
        total: memoryStore.length,
        last24h: memoryStore.filter(s => (Date.now() - s.createdAt.getTime()) < 86400000).length,
        topCommunities: [],
        topPerCapita: [],
        recentCommunities: []
      });
    }

    const [totalR, last24hR, topR, recentR] = await Promise.all([
      query('SELECT COUNT(*) AS count FROM campaign_supporters'),
      query("SELECT COUNT(*) AS count FROM campaign_supporters WHERE created_at > NOW() - INTERVAL '24 hours'"),
      query(`SELECT postal_prefix, province, COUNT(*) AS supporters
             FROM campaign_supporters
             GROUP BY postal_prefix, province
             ORDER BY supporters DESC
             LIMIT 15`),
      query(`SELECT postal_prefix, province, COUNT(*) AS supporters
             FROM campaign_supporters
             WHERE created_at > NOW() - INTERVAL '24 hours'
             GROUP BY postal_prefix, province
             ORDER BY supporters DESC
             LIMIT 10`)
    ]);

    return res.json({
      total: parseInt(totalR.rows[0].count, 10),
      last24h: parseInt(last24hR.rows[0].count, 10),
      topCommunities: topR.rows,
      recentCommunities: recentR.rows
    });
  } catch (error) {
    console.error('[campaign] Stats error:', error.message);
    return res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ── GET /heatmap ─────────────────────────────────────────────────
router.get('/heatmap', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      const counts = {};
      memoryStore.forEach(s => { counts[s.prefix] = (counts[s.prefix] || 0) + 1; });
      return res.json({ regions: Object.entries(counts).map(([prefix, count]) => ({ prefix, count })) });
    }

    const result = await query(
      `SELECT postal_prefix AS prefix, province, COUNT(*) AS count
       FROM campaign_supporters
       GROUP BY postal_prefix, province
       ORDER BY count DESC`
    );

    return res.json({ regions: result.rows });
  } catch (error) {
    console.error('[campaign] Heatmap error:', error.message);
    return res.status(500).json({ error: 'Failed to load heatmap data.' });
  }
});

export default router;
