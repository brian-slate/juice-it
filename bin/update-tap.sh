#!/bin/bash

# Script to update the Homebrew tap formula after a new release
#
# Usage: ./bin/update-tap.sh v1.3.0
#
# This updates the formula in your tap repo, commits, and pushes to GitHub.
# After pushing, users who run `brew update && brew upgrade juiceit` will get the new version.

set -e

VERSION="${1}"
TAP_REPO="$HOME/code/personal/homebrew-juice-it"
FORMULA="$TAP_REPO/Formula/juice-it.rb"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 v1.3.0"
    exit 1
fi

if [ ! -d "$TAP_REPO" ]; then
    echo "❌ Tap repo not found at $TAP_REPO"
    echo "   Clone it with: git clone git@github.com:brian-slate/homebrew-juice-it.git $TAP_REPO"
    exit 1
fi

echo "🍺 Updating Homebrew tap for version $VERSION..."
echo ""

# Download tarball and calculate SHA
TARBALL_URL="https://github.com/brian-slate/juice-it/archive/refs/tags/${VERSION}.tar.gz"
echo "📦 Downloading $TARBALL_URL..."
SHA256=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')

# Check for empty file (release doesn't exist)
if [ -z "$SHA256" ] || [ "$SHA256" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
    echo "❌ Failed to download tarball. Does the release tag exist?"
    echo "   Create it with: gh release create $VERSION"
    exit 1
fi

echo "🔐 SHA256: $SHA256"

# Update formula
echo "📝 Updating formula..."
sed -i '' \
    -e "s|url \"https://github.com/brian-slate/juice-it/archive/refs/tags/.*\"|url \"$TARBALL_URL\"|" \
    -e "s|sha256 \".*\"|sha256 \"$SHA256\"|" \
    "$FORMULA"

# Commit and push
echo "📤 Pushing to GitHub..."
cd "$TAP_REPO"
git add Formula/juice-it.rb
git commit -m "Update juiceit to $VERSION"
git push origin main

echo ""
echo "✅ Done! Tap updated to $VERSION"
echo ""
echo "Users can now run:"
echo "  brew update && brew upgrade juiceit"
echo ""
