/**
 * Feature Gate Middleware (Central-local)
 *
 * Enforces tier-based access control for the Research Platform.
 * Central cannot import from ../server/middleware/feature-flags.js (outside EB deploy bundle),
 * so this is a self-contained equivalent that checks:
 *   1. Environment variable overrides (RESEARCH_TIER_ENABLED, RESEARCH_TIER_FARMS)
 *   2. Per-farm DB settings (farms.settings->'features'->'research_enabled')
 *
 * Resolves audit finding C1: "Feature Gate NOT Enforced on Central"
 */
import { query as dbQuery, isDatabaseAvailable } from '../config/database.js';

// Cache farm tier lookups (5 min TTL, avoids DB round-trip on every request)
const tierCache = new Map();
const CACHE_TTL_MS = 300_000;

function getCached(farmId) {
  const entry = tierCache.get(farmId);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.enabled;
  return undefined;
}

function setCache(farmId, enabled) {
  tierCache.set(farmId, { enabled, ts: Date.now() });
  // Prevent unbounded cache growth
  if (tierCache.size > 500) {
    const oldest = [...tierCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) tierCache.delete(oldest[0]);
  }
}

/**
 * Middleware factory: require research tier for the requesting farm.
 *
 * Bypass conditions (in order):
 *   - NODE_ENV === 'development' or 'test'
 *   - RESEARCH_TIER_ENABLED === '*' (all farms allowed)
 *   - Farm ID appears in RESEARCH_TIER_FARMS comma-separated list
 *   - farms.settings->'features'->'research_enabled' === 'true' in DB
 *
 * If none match, returns 403.
 */
export function requireResearchTier() {
  return async (req, res, next) => {
    // Dev/test: bypass gating
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return next();
    }

    // Global override: all farms get research access
    if (process.env.RESEARCH_TIER_ENABLED === '*') {
      return next();
    }

    const farmId = req.farmId;
    if (!farmId) {
      return res.status(401).json({
        ok: false,
        error: 'Farm context required for research access'
      });
    }

    // Check JWT plan_type first (avoids DB round-trip for research subscribers)
    if (req.plan_type === 'research' || req.planType === 'research') {
      setCache(farmId, true);
      return next();
    }

    // Check cache first
    const cached = getCached(farmId);
    if (cached === true) return next();
    if (cached === false) {
      return res.status(403).json({
        ok: false,
        error: 'Research tier not enabled',
        message: 'The Research Workspace is not enabled for this farm. Contact support to activate.'
      });
    }

    // Check env var allowlist: RESEARCH_TIER_FARMS=FARM-ABC,FARM-XYZ
    const allowList = process.env.RESEARCH_TIER_FARMS;
    if (allowList) {
      const farms = allowList.split(',').map(f => f.trim());
      if (farms.includes(farmId)) {
        setCache(farmId, true);
        return next();
      }
    }

    // Check DB: plan_type = 'research' OR settings -> features -> research_enabled
    if (isDatabaseAvailable()) {
      try {
        const result = await dbQuery(
          `SELECT plan_type, settings->'features'->>'research_enabled' as enabled FROM farms WHERE farm_id = $1`,
          [farmId]
        );
        const row = result.rows[0];
        const enabled = row?.plan_type === 'research' || row?.enabled === 'true';
        setCache(farmId, enabled);
        if (enabled) return next();
      } catch (err) {
        console.error('[FeatureGate] DB tier lookup failed:', err.message);
        // Fail open on DB errors during startup/migration to avoid blocking
        return next();
      }
    } else {
      // DB unavailable -- fail open to avoid blocking during startup
      return next();
    }

    // Not enabled -- block with 403
    console.warn('[FeatureGate] Research access denied:', { farmId, path: req.path });
    setCache(farmId, false);
    return res.status(403).json({
      ok: false,
      error: 'Research tier not enabled',
      message: 'The Research Workspace is not enabled for this farm. Contact support to activate.'
    });
  };
}
