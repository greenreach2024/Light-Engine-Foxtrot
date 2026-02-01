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
exports.WorkflowTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class WorkflowTreeProvider {
    constructor(orchestrator) {
        this.orchestrator = orchestrator;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        // Listen to workflow state changes
        orchestrator.onStateChange(() => {
            this.refresh();
        });
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            // Root level - show workflow stages
            return this.getWorkflowStages();
        }
        return [];
    }
    getWorkflowStages() {
        const state = this.orchestrator.getState();
        const task = this.orchestrator.getTask();
        const items = [];
        // Task item (if exists)
        if (task) {
            items.push(new WorkflowItem(`Task: ${task.slice(0, 50)}${task.length > 50 ? '...' : ''}`, vscode.TreeItemCollapsibleState.None, 'task', 'info'));
        }
        // Stage 1: Implementation
        const implState = this.getStageState('proposing', state);
        items.push(new WorkflowItem('① Implementation Agent', vscode.TreeItemCollapsibleState.None, implState, implState === 'done' ? 'pass' : implState === 'active' ? 'sync' : 'circle-outline'));
        // Stage 2: Review
        const reviewState = this.getStageState('reviewing', state);
        items.push(new WorkflowItem('② Review Agent', vscode.TreeItemCollapsibleState.None, reviewState, reviewState === 'done' ? 'pass' : reviewState === 'active' ? 'sync' : 'circle-outline'));
        // Stage 3: Architecture (optional)
        const archRequired = this.orchestrator.requiresArchitecture();
        const archState = this.getStageState('strategic', state);
        items.push(new WorkflowItem(`③ Architecture Agent ${archRequired ? '' : '(Optional)'}`, vscode.TreeItemCollapsibleState.None, archState, archState === 'done' ? 'pass' : archState === 'active' ? 'sync' : 'circle-outline'));
        // Stage 4: Ready to commit
        const canCommit = this.orchestrator.canCommit();
        items.push(new WorkflowItem('④ Ready to Commit', vscode.TreeItemCollapsibleState.None, canCommit ? 'done' : 'pending', canCommit ? 'check' : 'circle-outline'));
        return items;
    }
    getStageState(stageName, currentState) {
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
exports.WorkflowTreeProvider = WorkflowTreeProvider;
class WorkflowItem extends vscode.TreeItem {
    constructor(label, collapsibleState, stage, icon) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.stage = stage;
        this.icon = icon;
        this.iconPath = new vscode.ThemeIcon(icon);
        // Set context value for commands
        this.contextValue = stage;
        // Set description based on stage
        if (stage === 'active') {
            this.description = 'In Progress';
        }
        else if (stage === 'done') {
            this.description = 'Complete';
        }
        else if (stage === 'rejected') {
            this.description = 'Rejected';
        }
    }
}
//# sourceMappingURL=treeProvider.js.map