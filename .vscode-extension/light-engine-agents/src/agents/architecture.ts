import * as vscode from 'vscode';
import { WorkflowOrchestrator } from '../workflow/orchestrator';
import { ContextBuilder } from '../workflow/context';
import { LLMClient } from '../utils/llmClient';

export class ArchitectureAgent {
    private llmClient: LLMClient;

    constructor(
        private orchestrator: WorkflowOrchestrator,
        private context: vscode.ExtensionContext
    ) {
        this.llmClient = new LLMClient();
    }

    async handler(
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Check workflow state
        if (this.orchestrator.getState() !== 'strategic') {
            stream.markdown('❌ Cannot perform strategic review.');
            stream.markdown(`\n\nCurrent state: ${this.orchestrator.getState()}`);
            
            if (this.orchestrator.getState() === 'reviewing') {
                stream.markdown('\n\nWait for `@le-review` approval first.');
            } else {
                stream.markdown('\n\nArchitecture review only needed after Review Agent approval.');
            }
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
            // Build context for architecture agent (strategic view)
            const agentContext = await ContextBuilder.forArchitecture(task, proposal, workspaceRoot);

            // Show framework reminder
            stream.markdown('## Architecture Agent (Strategic Assessment)\n\n');
            stream.markdown('**Assessment Focus:**\n');
            stream.markdown('- Mission Alignment: Does this support core goals?\n');
            stream.markdown('- Data Integrity: Impact on canonical schemas?\n');
            stream.markdown('- System Impact: Breaking changes? Consumer count?\n');
            stream.markdown('- Technical Debt: Adding complexity or reducing it?\n\n');

            stream.markdown('---\n\n');
            stream.markdown('### Strategic Review\n\n');
            stream.markdown('🤖 Performing strategic assessment using LLM...\n\n');

            // Use LLM for intelligent assessment
            const llmAssessment = await this.performLLMAssessment(task, proposal);

            // Perform strategic assessment with LLM insights
            const assessment = await this.performAssessment(proposal, agentContext, llmAssessment);

            // Display assessment
            stream.markdown('**Mission Alignment:**\n');
            stream.markdown(`${assessment.missionAlignment.icon} ${assessment.missionAlignment.summary}\n`);
            stream.markdown(`*${assessment.missionAlignment.detail}*\n\n`);

            stream.markdown('**Data Integrity:**\n');
            stream.markdown(`${assessment.dataIntegrity.icon} ${assessment.dataIntegrity.summary}\n`);
            stream.markdown(`*${assessment.dataIntegrity.detail}*\n\n`);

            stream.markdown('**System Impact:**\n');
            stream.markdown(`${assessment.systemImpact.icon} ${assessment.systemImpact.summary}\n`);
            stream.markdown(`*${assessment.systemImpact.detail}*\n\n`);

            stream.markdown('**Technical Debt:**\n');
            stream.markdown(`${assessment.technicalDebt.icon} ${assessment.technicalDebt.summary}\n`);
            stream.markdown(`*${assessment.technicalDebt.detail}*\n\n`);

            stream.markdown('---\n\n');

            // Make decision
            const approved = assessment.recommendation === 'approve';

            if (approved) {
                stream.markdown('### ✅ STRATEGIC APPROVAL\n\n');
                stream.markdown('**Status:** APPROVED FOR IMPLEMENTATION\n\n');
                stream.markdown('**Strategic Justification:**\n');
                stream.markdown(assessment.justification || 'Approved');
                stream.markdown('\n\n**Commit Tag:** [APPROVED:REVIEW] [APPROVED:ARCH]\n\n');
                stream.markdown('Proceed with implementation.');

                this.orchestrator.setArchitectureApproval(true, assessment.justification);

            } else if (assessment.recommendation === 'conditional') {
                stream.markdown('### ⚠️ CONDITIONAL APPROVAL\n\n');
                stream.markdown('**Status:** APPROVED WITH CONDITIONS\n\n');
                stream.markdown('**Required Modifications:**\n');
                stream.markdown(assessment.conditions || 'See concerns above');
                stream.markdown('\n\n**Action:** Revise proposal to address conditions, then re-submit for review.');

                this.orchestrator.setArchitectureApproval(false, 'Conditional approval - requires modifications');

            } else {
                stream.markdown('### ❌ STRATEGIC REJECTION\n\n');
                stream.markdown('**Status:** REJECTED\n\n');
                stream.markdown('**Strategic Concerns:**\n');
                stream.markdown(assessment.concerns || 'See assessment above');
                stream.markdown('\n\n**Recommendation:**\n');
                stream.markdown(assessment.alternative || 'Reconsider approach or scope.');

                this.orchestrator.setArchitectureApproval(false, assessment.concerns || 'Strategic concerns identified');
            }

        } catch (error) {
            stream.markdown(`❌ Error during strategic review: ${error instanceof Error ? error.message : String(error)}`);
            this.orchestrator.log('architecture', `Error: ${error}`);
        }
    }

    private async performLLMAssessment(
        task: string,
        proposal: string
    ): Promise<{ approved: boolean; reason: string; concerns: string[] } | null> {
        try {
            return await this.llmClient.generateArchitectureAssessment(proposal, task);
        } catch (error) {
            this.orchestrator.log('architecture', `LLM assessment failed: ${error}. Using rule-based fallback.`);
            return null;
        }
    }

    private async performAssessment(
        proposal: string, 
        context: any,
        llmAssessment?: { approved: boolean; reason: string; concerns: string[] } | null
    ): Promise<{
        missionAlignment: { icon: string; summary: string; detail: string };
        dataIntegrity: { icon: string; summary: string; detail: string };
        systemImpact: { icon: string; summary: string; detail: string };
        technicalDebt: { icon: string; summary: string; detail: string };
        recommendation: 'approve' | 'conditional' | 'reject';
        justification?: string;
        conditions?: string;
        concerns?: string;
        alternative?: string;
    }> {
        // If LLM assessment is available, incorporate its insights
        let llmInfluence = {
            approved: true,
            concerns: [] as string[]
        };
        
        if (llmAssessment) {
            llmInfluence = {
                approved: llmAssessment.approved,
                concerns: llmAssessment.concerns
            };
        }

        // Check for data format changes
        const affectsDataFormats = proposal.toLowerCase().includes('groups.json') ||
                                   proposal.toLowerCase().includes('farm.json') ||
                                   proposal.toLowerCase().includes('rooms.json') ||
                                   proposal.toLowerCase().includes('recipes.json');

        // Check for authentication changes
        const affectsAuth = proposal.toLowerCase().includes('auth') ||
                           proposal.toLowerCase().includes('login') ||
                           proposal.toLowerCase().includes('password');

        // Check for database schema changes
        const affectsDatabase = proposal.toLowerCase().includes('database') ||
                               proposal.toLowerCase().includes('schema') ||
                               proposal.toLowerCase().includes('migration');

        // Mission Alignment Assessment
        const missionKeywords = ['simplify', 'reduce', 'automate', 'workflow', 'grower'];
        const alignsWithMission = missionKeywords.some(k => proposal.toLowerCase().includes(k));
        
        const missionAlignment = {
            icon: alignsWithMission ? '✅' : '⚠️',
            summary: alignsWithMission ? 'Aligned with mission' : 'Neutral to mission',
            detail: alignsWithMission 
                ? 'Supports core goal of reducing grower workload'
                : 'Does not directly impact core mission goals'
        };

        // Data Integrity Assessment
        let dataIntegrity;
        if (affectsDataFormats) {
            const hasAdapter = proposal.includes('adapter') || proposal.includes('normalize');
            dataIntegrity = {
                icon: hasAdapter ? '✅' : '❌',
                summary: hasAdapter ? 'Uses adapters (good)' : 'Modifies source format (violation)',
                detail: hasAdapter
                    ? 'Uses data adapters to handle format variations - correct approach'
                    : 'CRITICAL: Modifies canonical data formats. Use adapters instead (see DATA_FORMAT_STANDARDS.md)'
            };
        } else {
            dataIntegrity = {
                icon: '✅',
                summary: 'No data format impact',
                detail: 'Does not affect canonical data schemas'
            };
        }

        // System Impact Assessment
        let systemImpact;
        if (affectsAuth || affectsDatabase) {
            systemImpact = {
                icon: '⚠️',
                summary: 'High-risk system changes',
                detail: 'Affects critical infrastructure (auth/database). Requires extensive testing.'
            };
        } else if (affectsDataFormats) {
            systemImpact = {
                icon: '⚠️',
                summary: 'Medium-risk: 56+ consumers',
                detail: 'Data format changes affect 56+ consumer files across system'
            };
        } else {
            systemImpact = {
                icon: '✅',
                summary: 'Low-risk: Isolated changes',
                detail: 'Changes are localized with minimal blast radius'
            };
        }

        // Technical Debt Assessment
        const addsComplexity = proposal.toLowerCase().includes('new dependency') ||
                              proposal.toLowerCase().includes('new framework') ||
                              proposal.split('\n').length > 100;
        
        const technicalDebt = {
            icon: addsComplexity ? '⚠️' : '✅',
            summary: addsComplexity ? 'Increases complexity' : 'Maintains simplicity',
            detail: addsComplexity
                ? 'Adds new dependencies or significant complexity - ensure justified'
                : 'Follows simplicity principle - minimal new complexity'
        };

        // Make recommendation
        let recommendation: 'approve' | 'conditional' | 'reject' = 'approve';
        let justification = 'Proposal aligns with strategic goals and follows best practices.';
        let conditions: string | undefined;
        let concerns: string | undefined;

        // Factor in LLM assessment
        if (!llmInfluence.approved && llmInfluence.concerns.length > 0) {
            recommendation = 'reject';
            concerns = 'LLM Strategic Assessment: ' + llmInfluence.concerns.join('; ');
        }

        // Rule-based checks override if critical
        if (dataIntegrity.icon === '❌') {
            recommendation = 'reject';
            concerns = 'CRITICAL: Modifying canonical data formats violates architecture principles. Use adapters from lib/data-adapters.js instead.';
        } else if (affectsAuth || affectsDatabase) {
            recommendation = 'conditional';
            conditions = '- Implement comprehensive error handling\n- Add rollback mechanism\n- Test on staging environment first\n- Document migration steps';
        } else if (systemImpact.icon === '⚠️' && !proposal.includes('adapter')) {
            recommendation = 'conditional';
            conditions = '- Use data adapters (lib/data-adapters.js)\n- Run schema validation: npm run validate-schemas\n- Test against all 56+ consumer files';
        } else if (llmInfluence.concerns.length > 0 && recommendation === 'approve') {
            // Downgrade to conditional if LLM has concerns but not critical
            recommendation = 'conditional';
            conditions = llmInfluence.concerns.map(c => `- ${c}`).join('\n');
        }

        return {
            missionAlignment,
            dataIntegrity,
            systemImpact,
            technicalDebt,
            recommendation,
            justification,
            conditions,
            concerns
        };
    }
}
