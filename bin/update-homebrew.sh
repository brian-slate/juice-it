#!/bin/bash

# Script to manage JuiceIt installation for development
#
# Usage:
#   ./bin/update-homebrew.sh --local    Link to local dev code (npm link)
#   ./bin/update-homebrew.sh --release  Install from latest GitHub release

set -e

MODE="${1:---local}"

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ "$MODE" = "--release" ]; then
    #######################################
    # RELEASE MODE: Install from GitHub
    #######################################
    echo "🍺 Installing JuiceIt from GitHub release..."
    echo ""

    # Remove any existing npm link
    echo "🔗 Removing npm link (if exists)..."
    npm unlink -g juice-it 2>/dev/null || true

    # Refresh tap from GitHub and reinstall
    echo "🔄 Fetching latest from GitHub..."
    brew untap brian-slate/juice-it 2>/dev/null || true
    brew tap brian-slate/juice-it

    echo "🔄 Installing..."
    brew install brian-slate/juice-it/juiceit

    echo ""
    echo "✅ Done! JuiceIt installed from latest GitHub release."

else
    #######################################
    # LOCAL MODE: npm link for dev
    #######################################
    echo "🔗 Linking JuiceIt to local development code..."
    echo ""

    # Run tests first to make sure code is usable
    echo "🧪 Running tests..."
    if npm test; then
        echo ""
        echo "✅ Tests passed!"
    else
        echo ""
        echo "❌ Tests failed! Fix issues before linking."
        exit 1
    fi

    echo ""
    echo "🔗 Creating npm link..."
    cd "$PROJECT_DIR"
    npm link

    echo ""
    echo "✅ Done! 'juiceit' and 'juice-it' now run your local code."
    echo ""
    echo "Any changes you make are instantly available - no reinstall needed!"
fi

echo ""
echo "Test it with:"
echo "  juiceit --help"
echo "  juice-it --help"
echo ""
