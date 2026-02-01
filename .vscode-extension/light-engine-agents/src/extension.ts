import * as vscode from 'vscode';
import { ImplementationAgent } from './agents/implementation';
import { ReviewAgent } from './agents/review';
import { ArchitectureAgent } from './agents/architecture';
import { WorkflowOrchestrator } from './workflow/orchestrator';
import { WorkflowTreeProvider } from './ui/treeProvider';

let orchestrator: WorkflowOrchestrator;
let treeProvider: WorkflowTreeProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Light Engine Multi-Agent extension activated');

    // Initialize workflow orchestrator
    orchestrator = new WorkflowOrchestrator(context);
    
    // Initialize tree view
    treeProvider = new WorkflowTreeProvider(orchestrator);
    vscode.window.registerTreeDataProvider('lightEngineWorkflow', treeProvider);

    // Register chat participants
    const implementationAgent = new ImplementationAgent(orchestrator, context);
    const reviewAgent = new ReviewAgent(orchestrator, context);
    const architectureAgent = new ArchitectureAgent(orchestrator, context);

    context.subscriptions.push(
        vscode.chat.createChatParticipant('light-engine.implementation', implementationAgent.handler.bind(implementationAgent)),
        vscode.chat.createChatParticipant('light-engine.review', reviewAgent.handler.bind(reviewAgent)),
        vscode.chat.createChatParticipant('light-engine.architecture', architectureAgent.handler.bind(architectureAgent))
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('lightEngine.startWorkflow', async () => {
            const task = await vscode.window.showInputBox({
                prompt: 'Enter task description',
                placeHolder: 'e.g., Fix harvest prediction bug'
            });
            
            if (task) {
                orchestrator.start(task);
                vscode.window.showInformationMessage(`Started workflow: ${task}`);
                treeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('lightEngine.showProgress', () => {
            const panel = vscode.window.createWebviewPanel(
                'workflowProgress',
                'Workflow Progress',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );
            
            panel.webview.html = orchestrator.getProgressHTML();
        }),

        vscode.commands.registerCommand('lightEngine.resetWorkflow', () => {
            orchestrator.reset();
            treeProvider.refresh();
            vscode.window.showInformationMessage('Workflow reset');
        })
    );

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

export function deactivate() {
    console.log('Light Engine Multi-Agent extension deactivated');
}
