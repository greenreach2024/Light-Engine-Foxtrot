import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

type WorkflowState = 'idle' | 'proposing' | 'reviewing' | 'strategic' | 'approved' | 'rejected';

interface WorkflowLog {
    timestamp: number;
    state: WorkflowState;
    agent: string;
    output: string;
    approval?: boolean;
    reason?: string;
}

export class WorkflowOrchestrator {
    private state: WorkflowState = 'idle';
    private task: string = '';
    private logs: WorkflowLog[] = [];
    private proposal: string = '';
    private reviewApproval: boolean = false;
    private architectureApproval: boolean = false;
    private changeEmitter = new vscode.EventEmitter<void>();
    
    public readonly onStateChange = this.changeEmitter.event;

    constructor(private context: vscode.ExtensionContext) {}

    start(task: string) {
        this.reset();
        this.task = task;
        this.transition('proposing');
        this.log('orchestrator', `Workflow started for: ${task}`);
    }

    reset() {
        this.state = 'idle';
        this.task = '';
        this.logs = [];
        this.proposal = '';
        this.reviewApproval = false;
        this.architectureApproval = false;
        this.changeEmitter.fire();
    }

    getState(): string {
        return this.state;
    }

    getTask(): string {
        return this.task;
    }

    canTransition(to: WorkflowState): boolean {
        const transitions: Record<WorkflowState, WorkflowState[]> = {
            'idle': ['proposing'],
            'proposing': ['reviewing', 'rejected'],
            'reviewing': ['strategic', 'approved', 'rejected'],
            'strategic': ['approved', 'rejected'],
            'approved': ['idle'],
            'rejected': ['idle']
        };

        return transitions[this.state]?.includes(to) ?? false;
    }

    transition(to: WorkflowState) {
        if (!this.canTransition(to)) {
            throw new Error(`Cannot transition from ${this.state} to ${to}`);
        }

        const from = this.state;
        this.state = to;
        this.log('orchestrator', `State changed: ${from} → ${to}`);
        this.changeEmitter.fire();

        // Show notification on state changes
        if (to === 'reviewing') {
            vscode.window.showInformationMessage('Proposal ready for Review Agent');
        } else if (to === 'strategic') {
            vscode.window.showInformationMessage('Review passed. Ready for Architecture Agent');
        } else if (to === 'approved') {
            vscode.window.showInformationMessage('✅ All agents approved! Ready to commit.');
        } else if (to === 'rejected') {
            vscode.window.showWarningMessage('❌ Proposal rejected. See workflow logs.');
        }
    }

    setProposal(proposal: string) {
        this.proposal = proposal;
        this.log('implementation', 'Proposal generated');
    }

    getProposal(): string {
        return this.proposal;
    }

    setReviewApproval(approved: boolean, reason?: string) {
        this.reviewApproval = approved;
        this.log('review', `Review ${approved ? 'APPROVED' : 'REJECTED'}`, approved, reason);
        
        if (approved && !this.requiresArchitecture()) {
            this.transition('approved');
        } else if (approved) {
            this.transition('strategic');
        } else {
            this.transition('rejected');
        }
    }

    setArchitectureApproval(approved: boolean, reason?: string) {
        this.architectureApproval = approved;
        this.log('architecture', `Strategic review ${approved ? 'APPROVED' : 'REJECTED'}`, approved, reason);
        
        this.transition(approved ? 'approved' : 'rejected');
    }

    requiresArchitecture(): boolean {
        // Check if task affects critical files
        const criticalKeywords = [
            'data format',
            'schema',
            'authentication',
            'database',
            'recipe',
            'automation rule',
            'API contract'
        ];

        return criticalKeywords.some(keyword => 
            this.task.toLowerCase().includes(keyword) ||
            this.proposal.toLowerCase().includes(keyword)
        );
    }

    canCommit(): boolean {
        return this.state === 'approved' && 
               this.reviewApproval && 
               (!this.requiresArchitecture() || this.architectureApproval);
    }

    getCommitMessage(): string {
        const tags: string[] = [];
        if (this.reviewApproval) tags.push('[APPROVED:REVIEW]');
        if (this.architectureApproval) tags.push('[APPROVED:ARCH]');
        
        return `${tags.join(' ')} ${this.task}`;
    }

    log(agent: string, output: string, approval?: boolean, reason?: string) {
        this.logs.push({
            timestamp: Date.now(),
            state: this.state,
            agent,
            output,
            approval,
            reason
        });
    }

    getLogs(): WorkflowLog[] {
        return this.logs;
    }

    async saveLog() {
        const logDir = path.join(this.context.extensionPath, 'logs');
        await fs.mkdir(logDir, { recursive: true });
        
        const logFile = path.join(logDir, `workflow-${Date.now()}.json`);
        await fs.writeFile(logFile, JSON.stringify({
            task: this.task,
            state: this.state,
            logs: this.logs,
            reviewApproval: this.reviewApproval,
            architectureApproval: this.architectureApproval
        }, null, 2));

        return logFile;
    }

    getProgressHTML(): string {
        const stateColors: Record<WorkflowState, string> = {
            'idle': '#6c757d',
            'proposing': '#0d6efd',
            'reviewing': '#ffc107',
            'strategic': '#0dcaf0',
            'approved': '#198754',
            'rejected': '#dc3545'
        };

        const color = stateColors[this.state];

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: var(--vscode-font-family); 
                        padding: 20px;
                        color: var(--vscode-foreground);
                    }
                    .state {
                        font-size: 24px;
                        font-weight: bold;
                        color: ${color};
                        margin-bottom: 20px;
                    }
                    .step {
                        padding: 10px;
                        margin: 10px 0;
                        border-left: 3px solid #6c757d;
                    }
                    .step.active {
                        border-left-color: ${color};
                        background: var(--vscode-editor-background);
                    }
                    .step.done {
                        border-left-color: #198754;
                        opacity: 0.7;
                    }
                    .log {
                        font-size: 12px;
                        padding: 5px;
                        margin: 5px 0;
                        background: var(--vscode-editor-background);
                        font-family: monospace;
                    }
                </style>
            </head>
            <body>
                <h1>Multi-Agent Workflow</h1>
                <div class="state">State: ${this.state.toUpperCase()}</div>
                <h2>Task: ${this.task || 'None'}</h2>
                
                <h3>Progress:</h3>
                <div class="step ${this.state === 'proposing' ? 'active' : this.logs.some(l => l.agent === 'implementation') ? 'done' : ''}">
                    ① Implementation Agent - Propose Solution
                    ${this.proposal ? '✓' : ''}
                </div>
                <div class="step ${this.state === 'reviewing' ? 'active' : this.reviewApproval ? 'done' : ''}">
                    ② Review Agent - Validate Proposal
                    ${this.reviewApproval ? '✓' : ''}
                </div>
                <div class="step ${this.state === 'strategic' ? 'active' : this.architectureApproval ? 'done' : ''}">
                    ③ Architecture Agent - Strategic Assessment
                    ${this.architectureApproval ? '✓' : this.requiresArchitecture() ? '' : '(Optional - Skipped)'}
                </div>
                <div class="step ${this.state === 'approved' ? 'active' : ''}">
                    ④ Ready to Commit
                    ${this.canCommit() ? '✓' : ''}
                </div>

                <h3>Workflow Log:</h3>
                ${this.logs.map(log => `
                    <div class="log">
                        [${new Date(log.timestamp).toLocaleTimeString()}] 
                        <strong>${log.agent}</strong>: ${log.output}
                        ${log.approval !== undefined ? (log.approval ? ' ✅' : ' ❌') : ''}
                    </div>
                `).join('')}
            </body>
            </html>
        `;
    }
}
