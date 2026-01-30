#!/bin/bash

# Script to update Homebrew installation with latest changes
# Run this after committing changes to test them via brew

set -e

echo "🍺 Updating JuiceIt in Homebrew..."
echo ""

# Copy updated formula to Homebrew tap
echo "📝 Copying formula to Homebrew tap..."
cp homebrew/Formula/juiceit.rb /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit/Formula/

# Reinstall
echo "🔄 Reinstalling juiceit..."
brew reinstall brianslate/juiceit/juiceit

echo ""
echo "✅ Done! JuiceIt has been updated."
echo ""
echo "Test it with:"
echo "  juiceit --help"
echo "  juiceit --setup"
echo ""
