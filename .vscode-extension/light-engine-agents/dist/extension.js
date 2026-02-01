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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const implementation_1 = require("./agents/implementation");
const review_1 = require("./agents/review");
const architecture_1 = require("./agents/architecture");
const orchestrator_1 = require("./workflow/orchestrator");
const treeProvider_1 = require("./ui/treeProvider");
let orchestrator;
let treeProvider;
function activate(context) {
    console.log('Light Engine Multi-Agent extension activated');
    // Initialize workflow orchestrator
    orchestrator = new orchestrator_1.WorkflowOrchestrator(context);
    // Initialize tree view
    treeProvider = new treeProvider_1.WorkflowTreeProvider(orchestrator);
    vscode.window.registerTreeDataProvider('lightEngineWorkflow', treeProvider);
    // Register chat participants
    const implementationAgent = new implementation_1.ImplementationAgent(orchestrator, context);
    const reviewAgent = new review_1.ReviewAgent(orchestrator, context);
    const architectureAgent = new architecture_1.ArchitectureAgent(orchestrator, context);
    context.subscriptions.push(vscode.chat.createChatParticipant('light-engine.implementation', implementationAgent.handler.bind(implementationAgent)), vscode.chat.createChatParticipant('light-engine.review', reviewAgent.handler.bind(reviewAgent)), vscode.chat.createChatParticipant('light-engine.architecture', architectureAgent.handler.bind(architectureAgent)));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('lightEngine.startWorkflow', async () => {
        const task = await vscode.window.showInputBox({
            prompt: 'Enter task description',
            placeHolder: 'e.g., Fix harvest prediction bug'
        });
        if (task) {
            orchestrator.start(task);
            vscode.window.showInformationMessage(`Started workflow: ${task}`);
            treeProvider.refresh();
        }
    }), vscode.commands.registerCommand('lightEngine.showProgress', () => {
        const panel = vscode.window.createWebviewPanel('workflowProgress', 'Workflow Progress', vscode.ViewColumn.Two, { enableScripts: true });
        panel.webview.html = orchestrator.getProgressHTML();
    }), vscode.commands.registerCommand('lightEngine.resetWorkflow', () => {
        orchestrator.reset();
        treeProvider.refresh();
        vscode.window.showInformationMessage('Workflow reset');
    }));
    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = `$(sync~spin) LE Workflow: ${orchestrator.getState()}`;
    statusBarItem.command = 'lightEngine.showProgress';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Update status bar on workflow changes
    orchestrator.onStateChange(() => {
        statusBarItem.text = `$(check) LE Workflow: ${orchestrator.getState()}`;
        treeProvider.refresh();
    });
}
function deactivate() {
    console.log('Light Engine Multi-Agent extension deactivated');
}
//# sourceMappingURL=extension.js.map