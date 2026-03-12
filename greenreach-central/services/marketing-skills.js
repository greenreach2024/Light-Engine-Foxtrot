/**
 * Marketing Skills Service — GreenReach Central
 * Agent skill registry with risk tiers, allowed/blocked actions, approval modes.
 * Adapted from Real-Estate-Ready-MVP guardrails.ts pattern.
 */

import { query } from '../config/database.js';

/**
 * Get all skills (optionally filtered by enabled status)
 * @param {{ enabledOnly?: boolean }} options
 * @returns {Promise<Array>}
 */
export async function listSkills({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? 'SELECT * FROM marketing_skills WHERE enabled = true ORDER BY category, skill_name'
    : 'SELECT * FROM marketing_skills ORDER BY category, skill_name';
  const result = await query(sql);
  return result.rows;
}

/**
 * Get a single skill by name
 * @param {string} skillName
 * @returns {Promise<object|null>}
 */
export async function getSkill(skillName) {
  const result = await query(
    'SELECT * FROM marketing_skills WHERE skill_name = $1',
    [skillName]
  );
  return result.rows[0] || null;
}

/**
 * Check if an action is allowed for a given skill.
 * Returns { allowed, reason }.
 */
export async function checkAction(skillName, action) {
  const skill = await getSkill(skillName);
  if (!skill) {
    return { allowed: false, reason: `Skill '${skillName}' not found` };
  }
  if (!skill.enabled) {
    return { allowed: false, reason: `Skill '${skillName}' is disabled` };
  }
  if (skill.blocked_actions && skill.blocked_actions.includes(action)) {
    return { allowed: false, reason: `Action '${action}' is blocked for skill '${skillName}'` };
  }
  if (skill.allowed_actions && skill.allowed_actions.length > 0 && !skill.allowed_actions.includes(action)) {
    return { allowed: false, reason: `Action '${action}' is not in allowed list for skill '${skillName}'` };
  }
  return { allowed: true, reason: null };
}

/**
 * Check if a skill requires human approval.
 * @param {string} skillName
 * @returns {Promise<boolean>}
 */
export async function requiresApproval(skillName) {
  const skill = await getSkill(skillName);
  if (!skill) return true; // Unknown skills always require approval
  return skill.approval_mode === 'required' || skill.approval_mode === 'prohibited';
}

/**
 * Get the risk tier for a skill.
 * @param {string} skillName
 * @returns {Promise<number>}
 */
export async function getRiskTier(skillName) {
  const skill = await getSkill(skillName);
  return skill ? skill.risk_tier : 4; // Unknown skills get highest risk tier
}

/**
 * Update a skill (toggle enabled, change approval mode, etc.)
 * @param {string} skillName
 * @param {object} updates - { enabled?, approval_mode?, allowed_actions?, blocked_actions? }
 */
export async function updateSkill(skillName, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`);
    values.push(updates.enabled);
  }
  if (updates.approval_mode !== undefined) {
    fields.push(`approval_mode = $${idx++}`);
    values.push(updates.approval_mode);
  }
  if (updates.allowed_actions !== undefined) {
    fields.push(`allowed_actions = $${idx++}`);
    values.push(updates.allowed_actions);
  }
  if (updates.blocked_actions !== undefined) {
    fields.push(`blocked_actions = $${idx++}`);
    values.push(updates.blocked_actions);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(updates.description);
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(skillName);

  const result = await query(
    `UPDATE marketing_skills SET ${fields.join(', ')} WHERE skill_name = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Risk tier labels for display
 */
export const RISK_TIER_LABELS = {
  0: 'Informational',
  1: 'Low Risk',
  2: 'Medium Risk',
  3: 'High Risk',
  4: 'Critical Risk',
};

/**
 * High-risk actions that should never be automated
 */
export const HIGH_RISK_ACTIONS = [
  'publish-post',
  'send-external-message',
  'send-direct-message',
  'override-human-decision',
  'rewrite-policy',
  'delete-published-post',
  'invent-testimonials',
  'change-account-status',
];
