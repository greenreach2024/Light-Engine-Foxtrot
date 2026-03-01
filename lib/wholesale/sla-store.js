/**
 * GreenReach Wholesale - Persistent SLA & Substitution Store
 */

import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

function createStore(filename) {
  return Datastore.create({
    filename,
    autoload: !IS_TEST_ENV,
    inMemoryOnly: IS_TEST_ENV,
  });
}

const slaRulesDB = createStore('data/wholesale-sla-rules.db');
const substitutionPoliciesDB = createStore('data/wholesale-substitution-policies.db');
const buyerPreferencesDB = createStore('data/wholesale-buyer-preferences.db');
const slaViolationsDB = createStore('data/wholesale-sla-violations.db');
const substitutionApprovalsDB = createStore('data/wholesale-substitution-approvals.db');

slaRulesDB.ensureIndex({ fieldName: 'rule_id', unique: true });
slaRulesDB.ensureIndex({ fieldName: 'applies_to' });
slaRulesDB.ensureIndex({ fieldName: 'priority' });
slaRulesDB.ensureIndex({ fieldName: 'active' });
slaRulesDB.persistence.setAutocompactionInterval(600000);

substitutionPoliciesDB.ensureIndex({ fieldName: 'policy_id', unique: true });
substitutionPoliciesDB.ensureIndex({ fieldName: 'active' });
substitutionPoliciesDB.ensureIndex({ fieldName: 'requires_buyer_approval' });
substitutionPoliciesDB.persistence.setAutocompactionInterval(600000);

buyerPreferencesDB.ensureIndex({ fieldName: 'buyer_id', unique: true });
buyerPreferencesDB.ensureIndex({ fieldName: 'updated_at' });
buyerPreferencesDB.persistence.setAutocompactionInterval(600000);

slaViolationsDB.ensureIndex({ fieldName: 'violation_id', unique: true });
slaViolationsDB.ensureIndex({ fieldName: 'farm_id' });
slaViolationsDB.ensureIndex({ fieldName: 'status' });
slaViolationsDB.ensureIndex({ fieldName: 'created_at' });
slaViolationsDB.persistence.setAutocompactionInterval(600000);

substitutionApprovalsDB.ensureIndex({ fieldName: 'approval_id', unique: true });
substitutionApprovalsDB.ensureIndex({ fieldName: 'buyer_id' });
substitutionApprovalsDB.ensureIndex({ fieldName: 'status' });
substitutionApprovalsDB.ensureIndex({ fieldName: 'requested_at' });
substitutionApprovalsDB.ensureIndex({ fieldName: 'expires_at' });
substitutionApprovalsDB.persistence.setAutocompactionInterval(600000);

export async function seedDefaultSlaRules(defaultRules = []) {
  for (const rule of defaultRules) {
    const existing = await slaRulesDB.findOne({ rule_id: rule.rule_id });
    if (existing) continue;
    await slaRulesDB.insert({
      ...rule,
      active: rule.active !== false,
      created_at: rule.created_at || new Date().toISOString()
    });
  }
}

export async function seedDefaultSubstitutionPolicies(defaultPolicies = []) {
  for (const policy of defaultPolicies) {
    const existing = await substitutionPoliciesDB.findOne({ policy_id: policy.policy_id });
    if (existing) continue;
    await substitutionPoliciesDB.insert({
      ...policy,
      active: policy.active !== false,
      created_at: policy.created_at || new Date().toISOString()
    });
  }
}

export async function saveSlaRule(rule) {
  const existing = await slaRulesDB.findOne({ rule_id: rule.rule_id });
  if (existing) {
    await slaRulesDB.update(
      { _id: existing._id },
      { $set: { ...rule, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...rule };
  }
  const doc = {
    ...rule,
    active: rule.active !== false,
    created_at: rule.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return slaRulesDB.insert(doc);
}

export async function listSlaRules(filters = {}) {
  let rules = await slaRulesDB.find({});
  if (filters.buyer_id) {
    rules = rules.filter((rule) => rule.applies_to === 'all' || rule.applies_to === filters.buyer_id);
  }
  rules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return rules;
}

export async function getSlaRule(ruleId) {
  return slaRulesDB.findOne({ rule_id: ruleId });
}

export async function saveSubstitutionPolicy(policy) {
  const existing = await substitutionPoliciesDB.findOne({ policy_id: policy.policy_id });
  if (existing) {
    await substitutionPoliciesDB.update(
      { _id: existing._id },
      { $set: { ...policy, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...policy };
  }
  const doc = {
    ...policy,
    active: policy.active !== false,
    created_at: policy.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return substitutionPoliciesDB.insert(doc);
}

export async function listSubstitutionPolicies() {
  return substitutionPoliciesDB.find({}).sort({ created_at: 1 });
}

export async function getSubstitutionPolicy(policyId) {
  return substitutionPoliciesDB.findOne({ policy_id: policyId });
}

export async function saveBuyerPreferences(preferences) {
  const existing = await buyerPreferencesDB.findOne({ buyer_id: preferences.buyer_id });
  if (existing) {
    await buyerPreferencesDB.update(
      { _id: existing._id },
      { $set: { ...preferences, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...preferences };
  }

  const doc = {
    ...preferences,
    updated_at: preferences.updated_at || new Date().toISOString()
  };

  return buyerPreferencesDB.insert(doc);
}

export async function getBuyerPreferences(buyerId) {
  return buyerPreferencesDB.findOne({ buyer_id: buyerId });
}

export async function saveSlaViolation(violation) {
  const existing = await slaViolationsDB.findOne({ violation_id: violation.violation_id });
  if (existing) {
    await slaViolationsDB.update(
      { _id: existing._id },
      { $set: { ...violation, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...violation };
  }

  const doc = {
    ...violation,
    created_at: violation.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return slaViolationsDB.insert(doc);
}

export async function listSlaViolations(filters = {}) {
  let violations = await slaViolationsDB.find({});

  if (filters.farm_id) {
    violations = violations.filter((entry) => entry.farm_id === filters.farm_id);
  }
  if (filters.status) {
    violations = violations.filter((entry) => entry.status === filters.status);
  }
  if (filters.from_date) {
    const fromTime = new Date(filters.from_date).getTime();
    violations = violations.filter((entry) => new Date(entry.created_at).getTime() >= fromTime);
  }
  if (filters.to_date) {
    const toTime = new Date(filters.to_date).getTime();
    violations = violations.filter((entry) => new Date(entry.created_at).getTime() <= toTime);
  }

  violations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return violations;
}

export async function saveSubstitutionApproval(approval) {
  const existing = await substitutionApprovalsDB.findOne({ approval_id: approval.approval_id });
  if (existing) {
    await substitutionApprovalsDB.update(
      { _id: existing._id },
      { $set: { ...approval, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...approval };
  }

  const doc = {
    ...approval,
    requested_at: approval.requested_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return substitutionApprovalsDB.insert(doc);
}

export async function getSubstitutionApproval(approvalId) {
  return substitutionApprovalsDB.findOne({ approval_id: approvalId });
}

export async function updateSubstitutionApproval(approvalId, patch) {
  const existing = await getSubstitutionApproval(approvalId);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString()
  };

  await substitutionApprovalsDB.update({ _id: existing._id }, { $set: next });
  return next;
}

export default {
  seedDefaultSlaRules,
  seedDefaultSubstitutionPolicies,
  saveSlaRule,
  listSlaRules,
  getSlaRule,
  saveSubstitutionPolicy,
  listSubstitutionPolicies,
  getSubstitutionPolicy,
  saveBuyerPreferences,
  getBuyerPreferences,
  saveSlaViolation,
  listSlaViolations,
  saveSubstitutionApproval,
  getSubstitutionApproval,
  updateSubstitutionApproval
};
