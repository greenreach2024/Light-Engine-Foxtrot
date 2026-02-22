/**
 * Developer Mode — Phase 4, Ticket 4.6
 *
 * Lets Light Engine users make update requests via Farm Assistant.
 * The agent evaluates feasibility, proposes changes, and routes through
 * safety gates. MVP: text-only requests, single-file scope, human approval required.
 *
 * All developer actions go through the require-approval tier — no auto-apply.
 *
 * Architecture:
 *   User text request → evaluateRequest() → proposeChange() →
 *   Human reviews proposal → approveAndApply() or reject()
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROPOSALS_DIR = path.join(__dirname, '..', 'data', 'dev-proposals');
const ALLOWED_EDIT_DIRS = ['data', 'config', 'prompts']; // Safety: only allow edits to data/config files
const FORBIDDEN_PATTERNS = [/password/i, /secret/i, /key/i, /token/i, /\.env/i, /credential/i];

/**
 * Ensure proposals directory exists.
 */
function ensureProposalsDir() {
  if (!fs.existsSync(PROPOSALS_DIR)) {
    fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
  }
}

/**
 * Evaluate a text request for feasibility.
 *
 * @param {string} request — user's natural language request
 * @param {object} [context] — { user, agentClass, farmId }
 * @returns {{ feasible: boolean, scope: string, risk: string, reason: string, proposalId?: string }}
 */
export function evaluateRequest(request, context = {}) {
  if (!request || typeof request !== 'string' || request.trim().length < 5) {
    return { feasible: false, scope: null, risk: null, reason: 'Request too short or empty.' };
  }

  // Check for forbidden patterns (security)
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(request)) {
      return {
        feasible: false,
        scope: null,
        risk: 'high',
        reason: `Request touches sensitive content (${pattern.source}). Rejected by safety gate.`
      };
    }
  }

  // Detect file scope from request
  const fileMatch = request.match(/(?:file|in|update|edit|change|modify)\s+[`"']?([^\s`"']+\.\w+)[`"']?/i);
  const targetFile = fileMatch ? fileMatch[1] : null;

  // Scope check: MVP only allows single-file edits in safe directories
  let scope = 'unknown';
  let risk = 'medium';

  if (targetFile) {
    const dir = path.dirname(targetFile).split('/')[0];
    if (ALLOWED_EDIT_DIRS.includes(dir)) {
      scope = 'data_config';
      risk = 'low';
    } else if (targetFile.endsWith('.js') || targetFile.endsWith('.html')) {
      scope = 'code';
      risk = 'high';
    } else {
      scope = 'other';
      risk = 'medium';
    }
  } else {
    // No specific file mentioned — classify by intent
    if (/config|setting|parameter|threshold|toggle/i.test(request)) {
      scope = 'configuration';
      risk = 'low';
    } else if (/recipe|lighting|spectrum|ppfd/i.test(request)) {
      scope = 'recipe';
      risk = 'medium';
    } else if (/code|function|endpoint|api|route|bug|fix/i.test(request)) {
      scope = 'code';
      risk = 'high';
    } else {
      scope = 'general';
      risk = 'medium';
    }
  }

  // MVP: code-scope requires acknowledgment that it's review-only
  const feasible = risk !== 'high' || scope === 'code'; // code is feasible but always require-approval

  ensureProposalsDir();
  const proposalId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    feasible,
    scope,
    risk,
    targetFile: targetFile || null,
    reason: feasible
      ? `Request is feasible. Scope: ${scope}, Risk: ${risk}. Proposal will require human approval.`
      : `Request blocked by safety gate. Risk: ${risk}.`,
    proposalId,
    requiresApproval: true // MVP: always true
  };
}

/**
 * Create a change proposal for human review.
 *
 * @param {string} proposalId — from evaluateRequest()
 * @param {object} proposal
 * @param {string} proposal.description — what the change does
 * @param {string} [proposal.targetFile] — file to modify
 * @param {string} [proposal.currentContent] — current file content (snippet)
 * @param {string} [proposal.proposedContent] — proposed new content
 * @param {object} [proposal.configChanges] — key/value changes for config files
 * @param {string} proposal.requestedBy — user who made the request
 * @returns {object} saved proposal
 */
export function createProposal(proposalId, proposal) {
  ensureProposalsDir();

  const record = {
    id: proposalId,
    status: 'pending_review',
    created_at: new Date().toISOString(),
    requested_by: proposal.requestedBy || 'unknown',
    description: proposal.description,
    target_file: proposal.targetFile || null,
    current_content: proposal.currentContent || null,
    proposed_content: proposal.proposedContent || null,
    config_changes: proposal.configChanges || null,
    scope: proposal.scope || 'unknown',
    risk: proposal.risk || 'medium',
    reviewed_by: null,
    reviewed_at: null,
    applied_at: null
  };

  const filePath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  return record;
}

/**
 * List all proposals, optionally filtered by status.
 */
export function listProposals(status = null) {
  ensureProposalsDir();
  const files = fs.readdirSync(PROPOSALS_DIR).filter(f => f.endsWith('.json'));
  const proposals = files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(PROPOSALS_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean);

  if (status) return proposals.filter(p => p.status === status);
  return proposals.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Get a specific proposal by ID.
 */
export function getProposal(proposalId) {
  const filePath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Approve and apply a proposal. Only works for data/config scope.
 *
 * @param {string} proposalId
 * @param {string} reviewedBy — who approved
 * @returns {{ applied: boolean, reason: string }}
 */
export function approveAndApply(proposalId, reviewedBy) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { applied: false, reason: 'Proposal not found.' };
  if (proposal.status !== 'pending_review') return { applied: false, reason: `Proposal status is ${proposal.status}, not pending_review.` };

  // Safety gate: only auto-apply data/config changes
  if (proposal.scope === 'code') {
    // Code changes are recorded as approved but not auto-applied
    proposal.status = 'approved_manual';
    proposal.reviewed_by = reviewedBy;
    proposal.reviewed_at = new Date().toISOString();
    const filePath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), 'utf-8');
    return { applied: false, reason: 'Code change approved but must be applied manually by engineer.' };
  }

  // Apply config changes
  if (proposal.config_changes && proposal.target_file) {
    try {
      const targetPath = path.join(__dirname, '..', proposal.target_file);
      // Safety: only allow writing to ALLOWED_EDIT_DIRS
      const relDir = path.relative(path.join(__dirname, '..'), targetPath).split(path.sep)[0];
      if (!ALLOWED_EDIT_DIRS.includes(relDir)) {
        return { applied: false, reason: `Target directory ${relDir} is not in the allowed list.` };
      }

      let content = {};
      if (fs.existsSync(targetPath)) {
        content = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      }
      Object.assign(content, proposal.config_changes);
      fs.writeFileSync(targetPath, JSON.stringify(content, null, 2), 'utf-8');

      proposal.status = 'applied';
      proposal.reviewed_by = reviewedBy;
      proposal.reviewed_at = new Date().toISOString();
      proposal.applied_at = new Date().toISOString();
      const filePath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), 'utf-8');

      return { applied: true, reason: `Config changes applied to ${proposal.target_file}.` };
    } catch (error) {
      return { applied: false, reason: `Error applying: ${error.message}` };
    }
  }

  return { applied: false, reason: 'No actionable changes in proposal.' };
}

/**
 * Reject a proposal.
 */
export function rejectProposal(proposalId, reviewedBy, reason = '') {
  const proposal = getProposal(proposalId);
  if (!proposal) return null;

  proposal.status = 'rejected';
  proposal.reviewed_by = reviewedBy;
  proposal.reviewed_at = new Date().toISOString();
  proposal.rejection_reason = reason;

  const filePath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), 'utf-8');
  return proposal;
}

export default {
  evaluateRequest,
  createProposal,
  listProposals,
  getProposal,
  approveAndApply,
  rejectProposal
};
