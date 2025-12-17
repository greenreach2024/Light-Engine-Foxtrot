import path from 'path';
import { readJsonFileSync, writeJsonFileSync, ensureDirSync } from './utils/file-storage.js';

function nowIso() {
  return new Date().toISOString();
}

function normalizeRule(rule) {
  const normalized = {
    id: String(rule.id || '').trim() || `rule-${Date.now()}`,
    name: rule.name || rule.id || 'Untitled Rule',
    scope: rule.scope || { room: 'default' },
    when: rule.when || {},
    actions: Array.isArray(rule.actions) ? [...rule.actions] : [],
    guardrails: rule.guardrails || {},
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    createdAt: rule.createdAt || nowIso(),
    updatedAt: nowIso(),
    description: rule.description || rule.notes || ''
  };
  return normalized;
}

export default class RulesStore {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'rules.json'
    } = options;
    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDirSync(this.dataDir);
    const payload = readJsonFileSync(this.filePath, { rules: [] });
    this.rules = Array.isArray(payload?.rules) ? payload.rules.map(normalizeRule) : [];
  }

  list() {
    return this.rules.map(rule => ({ ...rule }));
  }

  listEnabled() {
    return this.rules.filter(rule => rule.enabled !== false).map(rule => ({ ...rule }));
  }

  find(ruleId) {
    const rule = this.rules.find(rule => rule.id === ruleId);
    return rule ? { ...rule } : null;
  }

  upsert(rule) {
    const normalized = normalizeRule(rule);
    const index = this.rules.findIndex(r => r.id === normalized.id);
    if (index >= 0) {
      this.rules[index] = { ...this.rules[index], ...normalized, updatedAt: nowIso() };
    } else {
      this.rules.push({ ...normalized, createdAt: nowIso(), updatedAt: nowIso() });
    }
    this.persist();
    return this.find(normalized.id);
  }

  remove(ruleId) {
    const before = this.rules.length;
    this.rules = this.rules.filter(rule => rule.id !== ruleId);
    if (this.rules.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  setEnabled(ruleId, enabled) {
    const rule = this.find(ruleId);
    if (!rule) return null;
    rule.enabled = Boolean(enabled);
    rule.updatedAt = nowIso();
    this.persist();
    return { ...rule };
  }

  findByScope(scopeId) {
    return this.rules.filter(rule => {
      const ruleScope = rule.scope || {};
      if (!scopeId) return true;
      if (!ruleScope) return false;
      return ruleScope.room === scopeId || ruleScope.scope === scopeId || ruleScope.id === scopeId;
    });
  }

  updateRule(ruleId, updater) {
    const index = this.rules.findIndex(rule => rule.id === ruleId);
    if (index < 0) return null;
    const current = this.rules[index];
    const next = updater({ ...current });
    if (!next) return null;
    next.updatedAt = nowIso();
    this.rules[index] = next;
    this.persist();
    return { ...next };
  }

  assignPlug(ruleId, plugId, actionConfig = { set: 'on' }) {
    return this.updateRule(ruleId, (rule) => {
      const actions = Array.isArray(rule.actions) ? [...rule.actions] : [];
      const filtered = actions.filter(action => action.plugId !== plugId);
      filtered.push({ plugId, ...actionConfig });
      return { ...rule, actions: filtered };
    });
  }

  removePlugFromRule(ruleId, plugId) {
    return this.updateRule(ruleId, (rule) => {
      const actions = Array.isArray(rule.actions) ? rule.actions.filter(action => action.plugId !== plugId) : [];
      return { ...rule, actions };
    });
  }

  persist() {
    writeJsonFileSync(this.filePath, { rules: this.rules });
  }
}
