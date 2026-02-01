# Light Engine Multi-Agent Extension

VS Code extension implementing true multi-agent workflow with enforced gates and context isolation.

## Overview

This extension provides **three independent chat participants** that enforce the Light Engine Foxtrot Agent Skills Framework:

- `@le-implementation` - Proposes solutions with Investigation-First methodology
- `@le-review` - Validates proposals (skeptic role, cannot solve problems)
- `@le-architecture` - Strategic assessment for critical changes

## Key Features

### 🚦 Enforced Workflow Gates
Cannot skip review steps. State machine prevents:
- Committing without Review Agent approval
- Bypassing Architecture Agent for critical changes
- Implementing before investigation

### 🔒 Context Isolation
Each agent sees only what they need:
- **Implementation Agent**: Full codebase access, proposes solutions
- **Review Agent**: Limited to proposal-mentioned files, validates only
- **Architecture Agent**: Strategic view (framework, data standards, mission)

### 📊 Visual Progress Tracking
- Tree view shows workflow stages
- Status bar displays current state
- Webview panel shows detailed progress
- Persistent workflow logs

## Installation

### From Source

```bash
cd .vscode-extension/light-engine-agents
npm install
npm run compile
```

### Install Extension

Press `F5` in VS Code to launch Extension Development Host, or:

```bash
npm run package
code --install-extension light-engine-agents-1.0.0.vsix
```

## Usage

### 1. Start a Workflow

Use the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

```
Light Engine: Start Workflow
```

Enter your task description, then interact with agents via chat.

### 2. Chat with Agents

**Implementation Agent** (proposes solutions):
```
@le-implementation Fix the group detail page to show real data
```

**Review Agent** (validates proposal):
```
@le-review Validate this proposal
```

**Architecture Agent** (strategic assessment):
```
@le-architecture Assess strategic impact
```

### 3. Monitor Progress

- **Tree View**: `Light Engine Workflow` in sidebar
- **Status Bar**: Shows current workflow state
- **Command**: `Light Engine: Show Progress` for detailed view

### 4. Reset Workflow

```
Light Engine: Reset Workflow
```

## Workflow States

| State | Description | Actions Available |
|-------|-------------|-------------------|
| `idle` | No active workflow | Start new workflow |
| `proposing` | Implementation Agent working | Wait for proposal |
| `reviewing` | Review Agent validating | Approve/reject |
| `strategic` | Architecture Agent assessing | Approve/reject |
| `approved` | All gates passed | Ready to commit |
| `rejected` | Proposal rejected | Revise and resubmit |

## Framework Compliance

### Investigation-First ✅
Implementation Agent searches codebase before proposing solutions.

### Multi-Agent Review ✅
Proposals require Review Agent validation. Critical changes require Architecture Agent approval.

### Data Format Standards ✅
Architecture Agent checks for canonical format violations, requires adapters.

### Scope-Limited ✅
Implementation Agent defines clear boundaries. Review Agent rejects scope creep.

## Architecture

### State Machine
```
idle → proposing → reviewing → [strategic] → approved
                            ↓           ↓
                          rejected    rejected
```

### Agent Isolation
- **Implementation**: Can read all files, proposes changes
- **Review**: Reads only proposal-mentioned files, validates (cannot solve)
- **Architecture**: Reads framework/standards, assesses strategy

### Validation Checks

**Review Agent Checklist:**
- ✅ Investigation-First compliance
- ✅ Scope boundaries defined
- ✅ Verification steps provided
- ✅ No scope creep
- ✅ Data format standards (if applicable)
- ✅ No hallucinations/assumptions
- ✅ Framework awareness

**Architecture Agent Assessment:**
- Mission alignment
- Data integrity (56+ consumers)
- System impact (breaking changes?)
- Technical debt

## Configuration

### Extension Settings

None required - works out of the box.

### Framework Files

Extension reads:
- `.github/AGENT_SKILLS_FRAMEWORK.md` - Core rules
- `DATA_FORMAT_STANDARDS.md` - Canonical schemas
- `SCHEMA_CONSUMERS.md` - Consumer count

## Development

### Build

```bash
npm install
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Test

Press `F5` to launch Extension Development Host.

### Package

```bash
npm run package
```

Produces: `light-engine-agents-1.0.0.vsix`

## Project Structure

```
.vscode-extension/light-engine-agents/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── agents/
│   │   ├── implementation.ts     # Implementation Agent
│   │   ├── review.ts             # Review Agent
│   │   └── architecture.ts       # Architecture Agent
│   ├── workflow/
│   │   ├── orchestrator.ts       # State machine
│   │   └── context.ts            # Context isolation
│   └── ui/
│       ├── treeProvider.ts       # Workflow tree view
│       └── logger.ts             # Persistent logging
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
└── README.md                     # This file
```

## Troubleshooting

### Extension Not Loading

Check VS Code version:
```bash
code --version  # Must be 1.85 or higher
```

### Chat Participants Not Showing

Enable Chat API in VS Code settings:
```json
{
  "chat.experimental.enable": true
}
```

### Workflow Stuck

Reset workflow:
```
Cmd+Shift+P → Light Engine: Reset Workflow
```

Check logs:
```
.vscode-extension/light-engine-agents/logs/workflow.log
```

## Known Limitations

- **Agent LLM Integration**: Current version uses simplified proposal generation. Full LLM integration requires OpenAI/Anthropic API keys.
- **File Search**: Basic keyword matching. Production version should use vector search.
- **Context Extraction**: Simple regex for file paths. Could use AST parsing.

## Roadmap

- [ ] LLM integration (OpenAI/Anthropic)
- [ ] Vector search for codebase investigation
- [ ] AST parsing for context extraction
- [ ] Metrics dashboard (agent performance tracking)
- [ ] Git integration (auto-commit with approval tags)
- [ ] Workflow templates (common patterns)

## License

MIT

## Author

Light Engine Foxtrot Team

---

**Framework Version:** 1.2.0  
**Extension Version:** 1.0.0  
**VS Code Required:** 1.85+
