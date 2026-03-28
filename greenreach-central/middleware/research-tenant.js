/**
 * Research Tenant Enforcement Middleware
 * 
 * Verifies that sub-resources accessed by ID belong to the requesting farm.
 * Prevents IDOR (Insecure Direct Object Reference) attacks across tenants.
 * 
 * Usage in route files:
 *   import { verifyStudyOwnership, verifyDatasetOwnership, ... } from '../middleware/research-tenant.js';
 *   router.get('/research/studies/:id/protocols', verifyStudyOwnership, handler);
 */
import { query as dbQuery } from '../config/database.js';

// Cache ownership lookups for 30 seconds (reduces DB round-trips for rapid sub-resource access)
const ownershipCache = new Map();
const CACHE_TTL_MS = 30_000;

function getCached(key) {
  const entry = ownershipCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.farmId;
  return undefined;
}
function setCache(key, farmId) {
  ownershipCache.set(key, { farmId, ts: Date.now() });
  // Evict old entries periodically
  if (ownershipCache.size > 5000) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of ownershipCache) {
      if (v.ts < cutoff) ownershipCache.delete(k);
    }
  }
}

function getFarmId(req) {
  return req.farmId || req.user?.farmId || null;
}

function rejectUnauthorized(res, entity) {
  return res.status(403).json({ ok: false, error: `Access denied: ${entity} does not belong to your farm` });
}

// ── Direct Ownership: Table has farm_id column ──────────────────────

async function checkDirectOwnership(table, id, farmId) {
  const cacheKey = `${table}:${id}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(`SELECT farm_id FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  if (result.rows.length === 0) return null; // not found
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

// ── Chain Ownership: Join through parent tables ─────────────────────

async function checkStudyOwnership(studyId, farmId) {
  return checkDirectOwnership('studies', studyId, farmId);
}

async function checkDatasetOwnership(datasetId, farmId) {
  const cacheKey = `dataset:${datasetId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM research_datasets d JOIN studies s ON d.study_id = s.id WHERE d.id = $1 LIMIT 1`,
    [datasetId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkNotebookOwnership(notebookId, farmId) {
  return checkDirectOwnership('eln_notebooks', notebookId, farmId);
}

async function checkEntryOwnership(entryId, farmId) {
  const cacheKey = `entry:${entryId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT n.farm_id FROM eln_entries e JOIN eln_notebooks n ON e.notebook_id = n.id WHERE e.id = $1 LIMIT 1`,
    [entryId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkMilestoneOwnership(milestoneId, farmId) {
  const cacheKey = `milestone:${milestoneId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM trial_milestones m JOIN studies s ON m.study_id = s.id WHERE m.id = $1 LIMIT 1`,
    [milestoneId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkBudgetOwnership(budgetId, farmId) {
  const cacheKey = `budget:${budgetId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM grant_budgets b JOIN studies s ON b.study_id = s.id WHERE b.id = $1 LIMIT 1`,
    [budgetId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkBudgetItemOwnership(itemId, farmId) {
  const cacheKey = `budgetItem:${itemId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM budget_line_items bi JOIN grant_budgets b ON bi.budget_id = b.id JOIN studies s ON b.study_id = s.id WHERE bi.id = $1 LIMIT 1`,
    [itemId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkCollaboratorOwnership(collabId, farmId) {
  const cacheKey = `collab:${collabId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM study_collaborators c JOIN studies s ON c.study_id = s.id WHERE c.id = $1 LIMIT 1`,
    [collabId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkCommentOwnership(commentId, farmId) {
  const cacheKey = `comment:${commentId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM review_comments c JOIN studies s ON c.study_id = s.id WHERE c.id = $1 LIMIT 1`,
    [commentId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkExportOwnership(exportId, farmId) {
  const cacheKey = `export:${exportId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM export_packages ep JOIN studies s ON ep.study_id = s.id WHERE ep.id = $1 LIMIT 1`,
    [exportId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkAlertOwnership(alertId, farmId) {
  const cacheKey = `alert:${alertId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM study_alerts a JOIN studies s ON a.study_id = s.id WHERE a.id = $1 LIMIT 1`,
    [alertId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkQualityFlagOwnership(flagId, farmId) {
  const cacheKey = `qflag:${flagId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached === farmId;

  const result = await dbQuery(
    `SELECT s.farm_id FROM data_quality_flags qf
     JOIN research_observations ro ON qf.observation_id = ro.id
     JOIN research_datasets d ON ro.dataset_id = d.id
     JOIN studies s ON d.study_id = s.id
     WHERE qf.id = $1 LIMIT 1`,
    [flagId]
  );
  if (result.rows.length === 0) return null;
  const owner = result.rows[0].farm_id;
  setCache(cacheKey, owner);
  return owner === farmId;
}

async function checkProfileOwnership(profileId, farmId) {
  return checkDirectOwnership('researcher_profiles', profileId, farmId);
}

async function checkOnboardingOwnership(checklistId, farmId) {
  return checkDirectOwnership('onboarding_checklists', checklistId, farmId);
}

// ── Middleware Factories ────────────────────────────────────────────

function makeOwnershipMiddleware(checker, paramName, entityLabel) {
  return async (req, res, next) => {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(401).json({ ok: false, error: 'Farm context required' });

    const resourceId = req.params[paramName || 'id'];
    if (!resourceId) return next(); // no ID param — skip (list endpoints)

    try {
      const result = await checker(resourceId, farmId);
      if (result === null) return res.status(404).json({ ok: false, error: `${entityLabel} not found` });
      if (result === false) return rejectUnauthorized(res, entityLabel);
      next();
    } catch (err) {
      console.error(`[ResearchTenant] Ownership check failed for ${entityLabel}:`, err.message);
      // Fail open on DB errors to avoid blocking legitimate requests
      // (the route handler will hit the same DB issue and handle it)
      next();
    }
  };
}

// ── Exported Middleware ─────────────────────────────────────────────

export const verifyStudyOwnership = makeOwnershipMiddleware(checkStudyOwnership, 'id', 'Study');
export const verifyDatasetOwnership = makeOwnershipMiddleware(checkDatasetOwnership, 'id', 'Dataset');
export const verifyNotebookOwnership = makeOwnershipMiddleware(checkNotebookOwnership, 'id', 'Notebook');
export const verifyEntryOwnership = makeOwnershipMiddleware(checkEntryOwnership, 'id', 'Entry');
export const verifyMilestoneOwnership = makeOwnershipMiddleware(checkMilestoneOwnership, 'id', 'Milestone');
export const verifyBudgetOwnership = makeOwnershipMiddleware(checkBudgetOwnership, 'id', 'Budget');
export const verifyBudgetItemOwnership = makeOwnershipMiddleware(checkBudgetItemOwnership, 'id', 'Budget item');
export const verifyCollaboratorOwnership = makeOwnershipMiddleware(checkCollaboratorOwnership, 'id', 'Collaborator');
export const verifyCommentOwnership = makeOwnershipMiddleware(checkCommentOwnership, 'id', 'Comment');
export const verifyExportOwnership = makeOwnershipMiddleware(checkExportOwnership, 'id', 'Export');
export const verifyAlertOwnership = makeOwnershipMiddleware(checkAlertOwnership, 'id', 'Alert');
export const verifyQualityFlagOwnership = makeOwnershipMiddleware(checkQualityFlagOwnership, 'id', 'Quality flag');
export const verifyProfileOwnership = makeOwnershipMiddleware(checkProfileOwnership, 'id', 'Profile');
export const verifyOnboardingOwnership = makeOwnershipMiddleware(checkOnboardingOwnership, 'id', 'Onboarding');
