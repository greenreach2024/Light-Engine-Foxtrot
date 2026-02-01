import * as vscode from 'vscode';

export interface AgentContext {
    task: string;
    state: string;
    proposal?: string;
    allowedFiles?: string[];
    frameworkRules?: string;
}

export class ContextBuilder {
    /**
     * Build context for Implementation Agent
     * - Full codebase access
     * - Can read all files
     * - Can propose changes
     */
    static async forImplementation(task: string, workspaceRoot: string): Promise<AgentContext> {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        let frameworkRules = '';
        
        try {
            const doc = await vscode.workspace.openTextDocument(frameworkPath);
            frameworkRules = doc.getText();
        } catch (e) {
            frameworkRules = 'Framework file not found';
        }

        return {
            task,
            state: 'proposing',
            frameworkRules,
            allowedFiles: undefined // No restrictions
        };
    }

    /**
     * Build context for Review Agent
     * - Limited codebase access (only proposal-mentioned files)
     * - Cannot solve problems (must reject if issues found)
     * - Validates against framework
     */
    static async forReview(task: string, proposal: string, workspaceRoot: string): Promise<AgentContext> {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        let frameworkRules = '';
        
        try {
            const doc = await vscode.workspace.openTextDocument(frameworkPath);
            frameworkRules = doc.getText();
        } catch (e) {
            frameworkRules = 'Framework file not found';
        }

        // Extract files mentioned in proposal (simplified - could use regex)
        const allowedFiles = extractFilePaths(proposal);

        return {
            task,
            state: 'reviewing',
            proposal,
            allowedFiles,
            frameworkRules
        };
    }

    /**
     * Build context for Architecture Agent
     * - High-level view only
     * - Data format standards
     * - Schema consumer count
     * - Mission alignment
     */
    static async forArchitecture(task: string, proposal: string, workspaceRoot: string): Promise<AgentContext> {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        const dataStandardsPath = vscode.Uri.file(`${workspaceRoot}/DATA_FORMAT_STANDARDS.md`);
        const schemaConsumersPath = vscode.Uri.file(`${workspaceRoot}/SCHEMA_CONSUMERS.md`);
        
        let context = '';
        
        try {
            const framework = await vscode.workspace.openTextDocument(frameworkPath);
            context += '# FRAMEWORK\n' + framework.getText() + '\n\n';
        } catch (e) {
            context += '# FRAMEWORK: Not found\n\n';
        }

        try {
            const standards = await vscode.workspace.openTextDocument(dataStandardsPath);
            context += '# DATA STANDARDS\n' + standards.getText() + '\n\n';
        } catch (e) {
            context += '# DATA STANDARDS: Not found\n\n';
        }

        try {
            const consumers = await vscode.workspace.openTextDocument(schemaConsumersPath);
            context += '# SCHEMA CONSUMERS\n' + consumers.getText() + '\n\n';
        } catch (e) {
            context += '# SCHEMA CONSUMERS: Not found\n\n';
        }

        return {
            task,
            state: 'strategic',
            proposal,
            frameworkRules: context,
            allowedFiles: ['.github/AGENT_SKILLS_FRAMEWORK.md', 'DATA_FORMAT_STANDARDS.md', 'SCHEMA_CONSUMERS.md']
        };
    }
}

/**
 * Extract file paths from proposal text
 * Looks for patterns like: path/to/file.ext
 */
function extractFilePaths(text: string): string[] {
    const filePattern = /[a-zA-Z0-9_\-\/\.]+\.[a-z]{2,4}/g;
    const matches = text.match(filePattern) || [];
    return [...new Set(matches)]; // Deduplicate
}
