import * as vscode from 'vscode';
import { WorkflowOrchestrator } from '../workflow/orchestrator';
import { ContextBuilder } from '../workflow/context';

export class ReviewAgent {
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
        if (this.orchestrator.getState() !== 'reviewing') {
            stream.markdown('❌ Cannot review. No proposal in review state.');
            stream.markdown(`\n\nCurrent state: ${this.orchestrator.getState()}`);
            stream.markdown('\n\nUse `@le-implementation` to create a proposal first.');
            return;
        }

        const task = this.orchestrator.getTask();
        const proposal = this.orchestrator.getProposal();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('❌ No workspace folder open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        try {
            // Build context for review agent (limited access)
            const agentContext = await ContextBuilder.forReview(task, proposal, workspaceRoot);

            // Show framework reminder
            stream.markdown('## Review Agent (Skeptic Role)\n\n');
            stream.markdown('**Review Principles:**\n');
            stream.markdown('- ❌ REJECT scope creep (changes beyond stated goal)\n');
            stream.markdown('- ❌ REJECT hallucinations (assumptions without evidence)\n');
            stream.markdown('- ❌ REJECT missing verification steps\n');
            stream.markdown('- ✅ APPROVE only if proposal is sound and complete\n');
            stream.markdown('- 🚫 DO NOT propose solutions (reject and explain instead)\n\n');

            stream.markdown('---\n\n');
            stream.markdown('### Reviewing Proposal\n\n');

            // Perform validation checks
            const validationResults = await this.validateProposal(proposal, agentContext);

            // Display results
            stream.markdown('**Validation Checklist:**\n\n');
            
            for (const check of validationResults.checks) {
                const icon = check.passed ? '✅' : '❌';
                stream.markdown(`${icon} ${check.name}\n`);
                if (!check.passed && check.reason) {
                    stream.markdown(`   *${check.reason}*\n`);
                }
            }

            stream.markdown('\n---\n\n');

            // Make decision
            const approved = validationResults.checks.every(c => c.passed);

            if (approved) {
                stream.markdown('### ✅ APPROVAL\n\n');
                stream.markdown('**Status:** APPROVED\n\n');
                stream.markdown('**Justification:**\n');
                stream.markdown('- All validation checks passed\n');
                stream.markdown('- Proposal follows framework guidelines\n');
                stream.markdown('- Verification steps are clear\n');
                stream.markdown('- Scope is appropriately limited\n\n');

                if (this.orchestrator.requiresArchitecture()) {
                    stream.markdown('**Next Step:** Architecture Agent review required (affects critical systems)\n\n');
                    stream.markdown('Ask `@le-architecture` to perform strategic assessment.');
                } else {
                    stream.markdown('**Next Step:** Ready to implement\n\n');
                    stream.markdown('Architecture review not required (non-critical changes).');
                }

                this.orchestrator.setReviewApproval(true, 'All validation checks passed');

            } else {
                stream.markdown('### ❌ REJECTION\n\n');
                stream.markdown('**Status:** REJECTED\n\n');
                stream.markdown('**Reasons:**\n');
                
                const failures = validationResults.checks.filter(c => !c.passed);
                failures.forEach(f => {
                    stream.markdown(`- **${f.name}**: ${f.reason}\n`);
                });

                stream.markdown('\n**Required Actions:**\n');
                stream.markdown('1. Address all validation failures\n');
                stream.markdown('2. Submit revised proposal to `@le-implementation`\n');
                stream.markdown('3. Return to Review Agent for re-validation\n');

                this.orchestrator.setReviewApproval(false, failures.map(f => f.reason).join('; '));
            }

        } catch (error) {
            stream.markdown(`❌ Error during review: ${error instanceof Error ? error.message : String(error)}`);
            this.orchestrator.log('review', `Error: ${error}`);
        }
    }

    private async validateProposal(
        proposal: string, 
        context: any
    ): Promise<{ checks: Array<{ name: string; passed: boolean; reason?: string }> }> {
        const checks: Array<{ name: string; passed: boolean; reason?: string }> = [];

        // Check 1: Investigation-First compliance
        const hasInvestigation = proposal.toLowerCase().includes('investigation') || 
                                proposal.toLowerCase().includes('searched') ||
                                proposal.toLowerCase().includes('found');
        checks.push({
            name: 'Investigation-First',
            passed: hasInvestigation,
            reason: hasInvestigation ? undefined : 'No evidence of codebase investigation'
        });

        // Check 2: Clear scope boundaries
        const hasScope = proposal.includes('Files to Modify') || 
                        proposal.includes('Files to Create') ||
                        proposal.includes('Scope Limits');
        checks.push({
            name: 'Scope Defined',
            passed: hasScope,
            reason: hasScope ? undefined : 'Scope boundaries not clearly defined'
        });

        // Check 3: Verification steps provided
        const hasVerification = proposal.includes('Verification Steps') || 
                               proposal.includes('[ ]') ||
                               proposal.includes('Test');
        checks.push({
            name: 'Verification Steps',
            passed: hasVerification,
            reason: hasVerification ? undefined : 'Missing concrete verification steps'
        });

        // Check 4: No scope creep
        const hasScopeCreep = proposal.toLowerCase().includes('while we\'re at it') ||
                             proposal.toLowerCase().includes('also refactor') ||
                             proposal.toLowerCase().includes('bonus:');
        checks.push({
            name: 'No Scope Creep',
            passed: !hasScopeCreep,
            reason: !hasScopeCreep ? undefined : 'Detected scope creep - additional changes beyond task'
        });

        // Check 5: Data format compliance (if applicable)
        const mentionsDataFormat = proposal.toLowerCase().includes('group') ||
                                   proposal.toLowerCase().includes('farm') ||
                                   proposal.toLowerCase().includes('room') ||
                                   proposal.toLowerCase().includes('recipe');
        
        if (mentionsDataFormat) {
            const hasDataStandards = proposal.includes('DATA_FORMAT_STANDARDS') ||
                                    proposal.includes('canonical field') ||
                                    proposal.includes('schema');
            checks.push({
                name: 'Data Format Standards',
                passed: hasDataStandards,
                reason: hasDataStandards ? undefined : 'Affects data formats but does not reference standards'
            });
        }

        // Check 6: No hallucinations (unverified assumptions)
        const hasAssumptions = proposal.toLowerCase().includes('probably') ||
                              proposal.toLowerCase().includes('should be') ||
                              proposal.toLowerCase().includes('likely');
        checks.push({
            name: 'No Hallucinations',
            passed: !hasAssumptions,
            reason: !hasAssumptions ? undefined : 'Contains unverified assumptions'
        });

        // Check 7: Framework compliance mentioned
        const mentionsFramework = proposal.includes('Framework Compliance') ||
                                 proposal.includes('AGENT_SKILLS_FRAMEWORK');
        checks.push({
            name: 'Framework Awareness',
            passed: mentionsFramework,
            reason: mentionsFramework ? undefined : 'Does not reference framework compliance'
        });

        return { checks };
    }
}
