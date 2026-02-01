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
exports.ContextBuilder = void 0;
const vscode = __importStar(require("vscode"));
class ContextBuilder {
    /**
     * Build context for Implementation Agent
     * - Full codebase access
     * - Can read all files
     * - Can propose changes
     */
    static async forImplementation(task, workspaceRoot) {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        let frameworkRules = '';
        try {
            const doc = await vscode.workspace.openTextDocument(frameworkPath);
            frameworkRules = doc.getText();
        }
        catch (e) {
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
    static async forReview(task, proposal, workspaceRoot) {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        let frameworkRules = '';
        try {
            const doc = await vscode.workspace.openTextDocument(frameworkPath);
            frameworkRules = doc.getText();
        }
        catch (e) {
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
    static async forArchitecture(task, proposal, workspaceRoot) {
        const frameworkPath = vscode.Uri.file(`${workspaceRoot}/.github/AGENT_SKILLS_FRAMEWORK.md`);
        const dataStandardsPath = vscode.Uri.file(`${workspaceRoot}/DATA_FORMAT_STANDARDS.md`);
        const schemaConsumersPath = vscode.Uri.file(`${workspaceRoot}/SCHEMA_CONSUMERS.md`);
        let context = '';
        try {
            const framework = await vscode.workspace.openTextDocument(frameworkPath);
            context += '# FRAMEWORK\n' + framework.getText() + '\n\n';
        }
        catch (e) {
            context += '# FRAMEWORK: Not found\n\n';
        }
        try {
            const standards = await vscode.workspace.openTextDocument(dataStandardsPath);
            context += '# DATA STANDARDS\n' + standards.getText() + '\n\n';
        }
        catch (e) {
            context += '# DATA STANDARDS: Not found\n\n';
        }
        try {
            const consumers = await vscode.workspace.openTextDocument(schemaConsumersPath);
            context += '# SCHEMA CONSUMERS\n' + consumers.getText() + '\n\n';
        }
        catch (e) {
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
exports.ContextBuilder = ContextBuilder;
/**
 * Extract file paths from proposal text
 * Looks for patterns like: path/to/file.ext
 */
function extractFilePaths(text) {
    const filePattern = /[a-zA-Z0-9_\-\/\.]+\.[a-z]{2,4}/g;
    const matches = text.match(filePattern) || [];
    return [...new Set(matches)]; // Deduplicate
}
//# sourceMappingURL=context.js.map