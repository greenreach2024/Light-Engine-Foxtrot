import * as vscode from 'vscode';

export interface AgentContext {
    task: string;
    state: string;
    proposal?: string;
    allowedFiles?: string[];
    frameworkRules?: string;
    semanticContext?: string[];
}

export class ContextBuilder {
    /**
     * Build context for Implementation Agent
     * - Full codebase access
     * - Can read all files
     * - Can propose changes
     * - Enhanced with semantic search for better codebase understanding
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

        // Perform semantic search to find relevant context
        const semanticContext = await this.performSemanticSearch(task, workspaceRoot);

        return {
            task,
            state: 'proposing',
            frameworkRules,
            semanticContext,
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

    /**
     * Perform semantic search to find relevant files and code
     * Uses keywords and code patterns from the task
     */
    private static async performSemanticSearch(task: string, workspaceRoot: string): Promise<string[]> {
        const context: string[] = [];
        
        // Extract meaningful keywords from task
        const keywords = this.extractKeywords(task);
        
        if (keywords.length === 0) {
            return context;
        }

        try {
            // Search for files containing keywords
            for (const keyword of keywords.slice(0, 5)) { // Limit to top 5 keywords
                const searchPattern = `**/*${keyword}*.*`;
                const files = await vscode.workspace.findFiles(
                    searchPattern,
                    '**/node_modules/**',
                    10
                );

                for (const file of files.slice(0, 3)) {
                    const relativePath = vscode.workspace.asRelativePath(file);
                    if (!context.includes(relativePath)) {
                        context.push(relativePath);
                    }
                }
            }

        } catch (e) {
            // Semantic search failed, return empty context
        }

        return context.slice(0, 10); // Limit to top 10 results
    }

    /**
     * Extract meaningful keywords from task description
     * Filters out common words and focuses on technical terms
     */
    private static extractKeywords(task: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
            'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'should', 'could', 'may', 'might', 'must', 'can', 'add',
            'create', 'update', 'modify', 'change', 'fix', 'remove', 'delete'
        ]);

        const words = task
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w));

        return [...new Set(words)]; // Deduplicate
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
