#!/bin/bash

# Quick test script: commits changes and updates Homebrew installation
# Usage: ./bin/quick-test.sh "Your commit message"

set -e

# Check if commit message provided
if [ -z "$1" ]; then
    echo "❌ Error: Please provide a commit message"
    echo ""
    echo "Usage: ./bin/quick-test.sh \"Your commit message\""
    echo ""
    echo "Example:"
    echo "  ./bin/quick-test.sh \"Fix episode naming bug\""
    exit 1
fi

COMMIT_MSG="$1"

echo "🚀 Quick Test Workflow"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "📝 Committing changes..."
    git add -A
    git commit -m "$COMMIT_MSG"
    echo "   ✓ Committed: $COMMIT_MSG"
    echo ""
else
    echo "ℹ️  No changes to commit"
    echo ""
fi

# Copy formula and reinstall
echo "📝 Updating Homebrew formula..."
cp homebrew/Formula/juiceit.rb /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit/Formula/
echo "   ✓ Formula copied"
echo ""

echo "🔄 Reinstalling juiceit..."
brew reinstall brianslate/juiceit/juiceit 2>&1 | grep -E "(Reinstalling|Caveats|Summary|files)" || true
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Ready to test!"
echo ""
echo "Try:"
echo "  juiceit --help"
echo "  juiceit --setup"
echo "  juiceit --scan-only"
echo ""
