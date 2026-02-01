#!/bin/bash
# VS Code Extension Testing Script
# Tests the Light Engine Multi-Agent extension

set -e

cd "$(dirname "$0")/../.vscode-extension/light-engine-agents"

echo "=== Light Engine Extension - Test Preparation ==="
echo ""

# Check VS Code version
echo "1. Checking VS Code version..."
VSCODE_VERSION=$(code --version | head -1)
echo "   VS Code: $VSCODE_VERSION (requires 1.85+)"
echo ""

# Verify compilation
echo "2. Verifying compilation..."
if [ -d "dist" ]; then
    echo "   ✅ dist/ directory exists"
    FILE_COUNT=$(find dist -name "*.js" | wc -l | xargs)
    echo "   ✅ $FILE_COUNT JavaScript files compiled"
else
    echo "   ❌ dist/ directory missing - run: npm run compile"
    exit 1
fi
echo ""

# Check dependencies
echo "3. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules/ exists"
else
    echo "   ❌ node_modules/ missing - run: npm install"
    exit 1
fi
echo ""

# Validate package.json
echo "4. Validating package.json..."
PARTICIPANTS=$(node -e "console.log(require('./package.json').contributes.chatParticipants.length)")
echo "   ✅ $PARTICIPANTS chat participants configured"
COMMANDS=$(node -e "console.log(require('./package.json').contributes.commands.length)")
echo "   ✅ $COMMANDS commands registered"
echo ""

# Check for framework files
echo "5. Checking framework files..."
if [ -f "../../.github/AGENT_SKILLS_FRAMEWORK.md" ]; then
    echo "   ✅ AGENT_SKILLS_FRAMEWORK.md found"
else
    echo "   ⚠️  AGENT_SKILLS_FRAMEWORK.md not found"
fi
echo ""

echo "=== Pre-Flight Checks Complete ==="
echo ""
echo "📋 Manual Testing Required:"
echo ""
echo "   1. Open this folder in VS Code:"
echo "      cd $(pwd)"
echo "      code ."
echo ""
echo "   2. Press F5 to launch Extension Development Host"
echo ""
echo "   3. In the Extension Development Host window:"
echo "      - Check Debug Console for 'Light Engine Multi-Agent extension activated'"
echo "      - Open chat: Cmd+Shift+I"
echo "      - Try: @le-implementation Propose a test solution"
echo "      - Try: @le-review Validate this"
echo "      - Try: @le-architecture Assess impact"
echo ""
echo "   4. Verify tree view:"
echo "      - View → Open View → Light Engine Workflow"
echo "      - Check workflow stages display"
echo ""
echo "   5. Run test suite:"
echo "      See FUNCTIONAL_TEST_RESULTS.md for complete checklist"
echo ""
echo "🔧 If extension fails to load:"
echo "   - Check Debug Console for errors"
echo "   - Verify VS Code version ≥ 1.85"
echo "   - Try: npm run compile"
echo "   - Try: Cmd+Shift+F5 (reload extension)"
echo ""
echo "📄 Document results in: FUNCTIONAL_TEST_RESULTS.md"
echo ""
