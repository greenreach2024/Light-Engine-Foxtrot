import * as vscode from 'vscode';
import { WorkflowOrchestrator } from '../workflow/orchestrator';

export class WorkflowTreeProvider implements vscode.TreeDataProvider<WorkflowItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkflowItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private orchestrator: WorkflowOrchestrator) {
        // Listen to workflow state changes
        orchestrator.onStateChange(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkflowItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: WorkflowItem): WorkflowItem[] {
        if (!element) {
            // Root level - show workflow stages
            return this.getWorkflowStages();
        }
        return [];
    }

    private getWorkflowStages(): WorkflowItem[] {
        const state = this.orchestrator.getState();
        const task = this.orchestrator.getTask();

        const items: WorkflowItem[] = [];

        // Task item (if exists)
        if (task) {
            items.push(new WorkflowItem(
                `Task: ${task.slice(0, 50)}${task.length > 50 ? '...' : ''}`,
                vscode.TreeItemCollapsibleState.None,
                'task',
                'info'
            ));
        }

        // Stage 1: Implementation
        const implState = this.getStageState('proposing', state);
        items.push(new WorkflowItem(
            '① Implementation Agent',
            vscode.TreeItemCollapsibleState.None,
            implState,
            implState === 'done' ? 'pass' : implState === 'active' ? 'sync' : 'circle-outline'
        ));

        // Stage 2: Review
        const reviewState = this.getStageState('reviewing', state);
        items.push(new WorkflowItem(
            '② Review Agent',
            vscode.TreeItemCollapsibleState.None,
            reviewState,
            reviewState === 'done' ? 'pass' : reviewState === 'active' ? 'sync' : 'circle-outline'
        ));

        // Stage 3: Architecture (optional)
        const archRequired = this.orchestrator.requiresArchitecture();
        const archState = this.getStageState('strategic', state);
        items.push(new WorkflowItem(
            `③ Architecture Agent ${archRequired ? '' : '(Optional)'}`,
            vscode.TreeItemCollapsibleState.None,
            archState,
            archState === 'done' ? 'pass' : archState === 'active' ? 'sync' : 'circle-outline'
        ));

        // Stage 4: Ready to commit
        const canCommit = this.orchestrator.canCommit();
        items.push(new WorkflowItem(
            '④ Ready to Commit',
            vscode.TreeItemCollapsibleState.None,
            canCommit ? 'done' : 'pending',
            canCommit ? 'check' : 'circle-outline'
        ));

        return items;
    }

    private getStageState(stageName: string, currentState: string): 'pending' | 'active' | 'done' | 'rejected' {
        const stageOrder = ['idle', 'proposing', 'reviewing', 'strategic', 'approved', 'rejected'];
        const currentIndex = stageOrder.indexOf(currentState);
        const stageIndex = stageOrder.indexOf(stageName);

        if (currentState === 'rejected') {
            return 'rejected';
        }

        if (currentState === stageName) {
            return 'active';
        }

        if (currentIndex > stageIndex) {
            return 'done';
        }

        return 'pending';
    }
}

class WorkflowItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly stage: string,
        public readonly icon: string
    ) {
        super(label, collapsibleState);
        this.iconPath = new vscode.ThemeIcon(icon);
        
        // Set context value for commands
        this.contextValue = stage;

        // Set description based on stage
        if (stage === 'active') {
            this.description = 'In Progress';
        } else if (stage === 'done') {
            this.description = 'Complete';
        } else if (stage === 'rejected') {
            this.description = 'Rejected';
        }
    }
}
