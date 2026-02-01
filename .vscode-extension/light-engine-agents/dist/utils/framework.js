"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkParser = void 0;
exports.validateProposalAgainstFramework = validateProposalAgainstFramework;
const fs = __importStar(require("fs/promises"));
class FrameworkParser {
    constructor(workspaceRoot) {
        this.rules = [];
        this.frameworkPath = `${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`;
    }
    async parse() {
        try {
            const content = await fs.readFile(this.frameworkPath, 'utf-8');
            this.rules = this.extractRules(content);
            return this.rules;
        }
        catch (e) {
            console.error('Failed to parse framework:', e);
            return [];
        }
    }
    extractRules(content) {
        const rules = [];
        // Extract Investigation-First rules
        if (content.includes('Investigation-First')) {
            rules.push({
                category: 'Investigation-First',
                rule: 'Must check codebase before proposing solutions',
                severity: 'error'
            });
            rules.push({
                category: 'Investigation-First',
                rule: 'No speculation without evidence',
                severity: 'error'
            });
        }
        // Extract Multi-Agent Review rules
        if (content.includes('Multi-Agent Review')) {
            rules.push({
                category: 'Multi-Agent Review',
                rule: 'Implementation Agent proposes, Review Agent validates',
                severity: 'error'
            });
            rules.push({
                category: 'Multi-Agent Review',
                rule: 'Architecture Agent reviews critical changes',
                severity: 'warning'
            });
        }
        // Extract Data Format rules
        if (content.includes('Data Format')) {
            rules.push({
                category: 'Data Formats',
                rule: 'Never modify canonical data formats',
                severity: 'error'
            });
            rules.push({
                category: 'Data Formats',
                rule: 'Use adapters from lib/data-adapters.js',
                severity: 'error'
            });
            rules.push({
                category: 'Data Formats',
                rule: 'Run npm run validate-schemas before commit',
                severity: 'warning'
            });
        }
        // Extract Simplicity rules
        if (content.includes('Simplicity')) {
            rules.push({
                category: 'Simplicity',
                rule: 'Reduce grower workload, do not add steps',
                severity: 'warning'
            });
            rules.push({
                category: 'Simplicity',
                rule: 'Database-driven over code-driven',
                severity: 'info'
            });
        }
        return rules;
    }
    getRules() {
        return this.rules;
    }
    getRulesByCategory(category) {
        return this.rules.filter(r => r.category === category);
    }
    getRulesBySeverity(severity) {
        return this.rules.filter(r => r.severity === severity);
    }
}
exports.FrameworkParser = FrameworkParser;
async function validateProposalAgainstFramework(proposal, workspaceRoot) {
    const parser = new FrameworkParser(workspaceRoot);
    await parser.parse();
    const violations = [];
    // Check Investigation-First
    if (!proposal.toLowerCase().includes('investigation')) {
        violations.push('Missing evidence of Investigation-First methodology');
    }
    // Check Data Format compliance
    const mentionsDataFormat = proposal.toLowerCase().includes('groups.json') ||
        proposal.toLowerCase().includes('farm.json');
    if (mentionsDataFormat && !proposal.includes('adapter')) {
        violations.push('Data format change detected but no adapter mentioned');
    }
    // Check verification steps
    if (!proposal.includes('Verification') && !proposal.includes('Test')) {
        violations.push('Missing verification steps');
    }
    return {
        passed: violations.length === 0,
        violations
    };
}
//# sourceMappingURL=framework.js.map