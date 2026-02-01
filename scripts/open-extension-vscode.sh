#!/bin/bash
# Quick test: Open extension in VS Code for manual testing

set -e

EXTENSION_DIR="/Users/petergilbert/Light-Engine-Foxtrot/.vscode-extension/light-engine-agents"

echo "Opening Light Engine Extension in VS Code..."
echo ""
echo "📂 Extension Directory:"
echo "   $EXTENSION_DIR"
echo ""
echo "⚡ Next Steps:"
echo "   1. Wait for VS Code to open"
echo "   2. Press F5 to launch Extension Development Host"
echo "   3. Test chat participants: @le-implementation, @le-review, @le-architecture"
echo "   4. Check tree view: View → Open View → Light Engine Workflow"
echo "   5. Document results in FUNCTIONAL_TEST_RESULTS.md"
echo ""

code "$EXTENSION_DIR"

echo "✅ VS Code launched"
echo ""
echo "💡 Tips:"
echo "   - Debug Console (Cmd+Shift+Y) shows extension logs"
echo "   - Chat panel (Cmd+Shift+I) for testing agents"
echo "   - Reload extension: Cmd+Shift+F5"
echo ""
