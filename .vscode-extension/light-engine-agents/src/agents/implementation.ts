import * as vscode from 'vscode';
import { WorkflowOrchestrator } from '../workflow/orchestrator';
import { ContextBuilder } from '../workflow/context';

export class ImplementationAgent {
    constructor(
        private orchestrator: WorkflowOrchestrator,
        private context: vscode.ExtensionContext
    ) {}

    async handler(
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Check workflow state
        if (this.orchestrator.getState() !== 'proposing' && this.orchestrator.getState() !== 'idle') {
            stream.markdown('❌ Cannot propose solution. Current workflow state: ' + this.orchestrator.getState());
            stream.markdown('\n\nUse `/reset` to restart workflow.');
            return;
        }

        // Start workflow if idle
        if (this.orchestrator.getState() === 'idle') {
            this.orchestrator.start(request.prompt);
        }

        const task = this.orchestrator.getTask();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('❌ No workspace folder open. Please open a project.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        try {
            // Build context for implementation agent
            const agentContext = await ContextBuilder.forImplementation(task, workspaceRoot);

            // Show framework reminder
            stream.markdown('## Implementation Agent\n\n');
            stream.markdown('**Framework Rules:**\n');
            stream.markdown('- Investigation-First: Check codebase before proposing\n');
            stream.markdown('- Scope-Limited: Clear boundaries for changes\n');
            stream.markdown('- Verification Required: Specific validation steps\n');
            stream.markdown('- Multi-Agent Review: Proposal must pass Review Agent\n\n');

            // Generate proposal (simplified - real implementation would use LLM)
            stream.markdown('### Task\n');
            stream.markdown(`${task}\n\n`);

            stream.markdown('### Investigation Phase\n');
            stream.markdown('🔍 Searching codebase for relevant files...\n\n');

            // Simulate investigation (real version would search files)
            const relevantFiles = await this.investigateCodebase(task, workspaceRoot);
            
            if (relevantFiles.length > 0) {
                stream.markdown('**Found relevant files:**\n');
                relevantFiles.forEach(file => {
                    stream.markdown(`- ${file}\n`);
                });
            } else {
                stream.markdown('⚠️ No existing files found. This appears to be new functionality.\n');
            }

            stream.markdown('\n### Proposal\n');
            
            const proposal = this.generateProposal(task, relevantFiles);
            stream.markdown(proposal);

            // Save proposal to orchestrator
            this.orchestrator.setProposal(proposal);
            this.orchestrator.transition('reviewing');

            stream.markdown('\n\n---\n');
            stream.markdown('✅ **Proposal complete. Ready for Review Agent.**\n\n');
            stream.markdown('Next: Ask `@le-review` to validate this proposal.');

        } catch (error) {
            stream.markdown(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
            this.orchestrator.log('implementation', `Error: ${error}`);
        }
    }

    private async investigateCodebase(task: string, workspaceRoot: string): Promise<string[]> {
        // Extract keywords from task
        const keywords = task.toLowerCase().split(' ').filter(w => w.length > 3);
        const files: string[] = [];

        // Search for files containing keywords (simplified)
        try {
            const allFiles = await vscode.workspace.findFiles('**/*.{js,ts,json,md}', '**/node_modules/**', 20);
            
            for (const file of allFiles) {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText().toLowerCase();
                
                if (keywords.some(k => text.includes(k))) {
                    files.push(vscode.workspace.asRelativePath(file));
                }
            }
        } catch (e) {
            // Ignore errors
        }

        return files.slice(0, 10); // Limit to 10 most relevant
    }

    private generateProposal(task: string, relevantFiles: string[]): string {
        // Simplified proposal generation
        // Real version would use LLM with framework rules
        
        let proposal = `**Implementation Proposal**\n\n`;
        proposal += `**Objective:** ${task}\n\n`;
        
        if (relevantFiles.length > 0) {
            proposal += `**Files to Modify:**\n`;
            relevantFiles.forEach(file => {
                proposal += `- ${file}\n`;
            });
            proposal += '\n';
        } else {
            proposal += `**Files to Create:**\n`;
            proposal += `- (New files based on task requirements)\n\n`;
        }

        proposal += `**Changes:**\n`;
        proposal += `1. Investigate existing implementation\n`;
        proposal += `2. Follow data format standards (if applicable)\n`;
        proposal += `3. Use canonical field names from DATA_FORMAT_STANDARDS.md\n`;
        proposal += `4. Add appropriate error handling\n`;
        proposal += `5. Update related tests\n\n`;

        proposal += `**Verification Steps:**\n`;
        proposal += `- [ ] Run \`npm run validate-schemas\` (if data formats changed)\n`;
        proposal += `- [ ] Test functionality in browser/terminal\n`;
        proposal += `- [ ] Check console for errors\n`;
        proposal += `- [ ] Verify no regressions in related features\n\n`;

        proposal += `**Scope Limits:**\n`;
        proposal += `- Changes limited to files listed above\n`;
        proposal += `- No modifications to canonical data formats without migration plan\n`;
        proposal += `- No new dependencies without justification\n\n`;

        proposal += `**Framework Compliance:**\n`;
        proposal += `- ✅ Investigation-First: Searched codebase before proposing\n`;
        proposal += `- ✅ Scope-Limited: Clear boundaries defined\n`;
        proposal += `- ✅ Verification Required: Steps provided\n`;
        proposal += `- ⏳ Multi-Agent Review: Awaiting Review Agent validation\n`;

        return proposal;
    }
}
