import * as vscode from 'vscode';
import * as fs from 'fs/promises';

export interface FrameworkRule {
    category: string;
    rule: string;
    severity: 'error' | 'warning' | 'info';
}

export class FrameworkParser {
    private frameworkPath: string;
    private rules: FrameworkRule[] = [];

    constructor(workspaceRoot: string) {
        this.frameworkPath = `${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`;
    }

    async parse(): Promise<FrameworkRule[]> {
        try {
            const content = await fs.readFile(this.frameworkPath, 'utf-8');
            this.rules = this.extractRules(content);
            return this.rules;
        } catch (e) {
            console.error('Failed to parse framework:', e);
            return [];
        }
    }

    private extractRules(content: string): FrameworkRule[] {
        const rules: FrameworkRule[] = [];

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

    getRules(): FrameworkRule[] {
        return this.rules;
    }

    getRulesByCategory(category: string): FrameworkRule[] {
        return this.rules.filter(r => r.category === category);
    }

    getRulesBySeverity(severity: 'error' | 'warning' | 'info'): FrameworkRule[] {
        return this.rules.filter(r => r.severity === severity);
    }
}

export async function validateProposalAgainstFramework(
    proposal: string,
    workspaceRoot: string
): Promise<{ passed: boolean; violations: string[] }> {
    const parser = new FrameworkParser(workspaceRoot);
    await parser.parse();

    const violations: string[] = [];

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
