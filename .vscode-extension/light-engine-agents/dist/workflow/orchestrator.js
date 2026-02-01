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
exports.WorkflowOrchestrator = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class WorkflowOrchestrator {
    constructor(context) {
        this.context = context;
        this.state = 'idle';
        this.task = '';
        this.logs = [];
        this.proposal = '';
        this.reviewApproval = false;
        this.architectureApproval = false;
        this.changeEmitter = new vscode.EventEmitter();
        this.onStateChange = this.changeEmitter.event;
    }
    start(task) {
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
    getState() {
        return this.state;
    }
    getTask() {
        return this.task;
    }
    canTransition(to) {
        const transitions = {
            'idle': ['proposing'],
            'proposing': ['reviewing', 'rejected'],
            'reviewing': ['strategic', 'approved', 'rejected'],
            'strategic': ['approved', 'rejected'],
            'approved': ['idle'],
            'rejected': ['idle']
        };
        return transitions[this.state]?.includes(to) ?? false;
    }
    transition(to) {
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
        }
        else if (to === 'strategic') {
            vscode.window.showInformationMessage('Review passed. Ready for Architecture Agent');
        }
        else if (to === 'approved') {
            vscode.window.showInformationMessage('✅ All agents approved! Ready to commit.');
        }
        else if (to === 'rejected') {
            vscode.window.showWarningMessage('❌ Proposal rejected. See workflow logs.');
        }
    }
    setProposal(proposal) {
        this.proposal = proposal;
        this.log('implementation', 'Proposal generated');
    }
    getProposal() {
        return this.proposal;
    }
    setReviewApproval(approved, reason) {
        this.reviewApproval = approved;
        this.log('review', `Review ${approved ? 'APPROVED' : 'REJECTED'}`, approved, reason);
        if (approved && !this.requiresArchitecture()) {
            this.transition('approved');
        }
        else if (approved) {
            this.transition('strategic');
        }
        else {
            this.transition('rejected');
        }
    }
    setArchitectureApproval(approved, reason) {
        this.architectureApproval = approved;
        this.log('architecture', `Strategic review ${approved ? 'APPROVED' : 'REJECTED'}`, approved, reason);
        this.transition(approved ? 'approved' : 'rejected');
    }
    requiresArchitecture() {
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
        return criticalKeywords.some(keyword => this.task.toLowerCase().includes(keyword) ||
            this.proposal.toLowerCase().includes(keyword));
    }
    canCommit() {
        return this.state === 'approved' &&
            this.reviewApproval &&
            (!this.requiresArchitecture() || this.architectureApproval);
    }
    getCommitMessage() {
        const tags = [];
        if (this.reviewApproval)
            tags.push('[APPROVED:REVIEW]');
        if (this.architectureApproval)
            tags.push('[APPROVED:ARCH]');
        return `${tags.join(' ')} ${this.task}`;
    }
    log(agent, output, approval, reason) {
        this.logs.push({
            timestamp: Date.now(),
            state: this.state,
            agent,
            output,
            approval,
            reason
        });
    }
    getLogs() {
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
    getProgressHTML() {
        const stateColors = {
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
exports.WorkflowOrchestrator = WorkflowOrchestrator;
//# sourceMappingURL=orchestrator.js.map