#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TAP_REPO="$HOME/code/personal/homebrew-juice-it"
FORMULA_FILE="$TAP_REPO/Formula/juice-it.rb"

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  JuiceIt Release Script${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${RED}Error: You have uncommitted changes. Please commit or stash them first.${NC}"
    exit 1
fi

# Check tap repo exists
if [ ! -d "$TAP_REPO" ]; then
    echo -e "${RED}Error: Homebrew tap repo not found at $TAP_REPO${NC}"
    echo "Clone it first: git clone git@github.com:brian-slate/homebrew-juice-it.git $TAP_REPO"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "Current version: ${YELLOW}v$CURRENT_VERSION${NC}"

# Determine bump type (default: patch)
BUMP_TYPE="${1:-patch}"
echo -e "Bump type: ${YELLOW}$BUMP_TYPE${NC}"
echo ""

# Step 1: Run tests
echo -e "${GREEN}[1/8] Running tests...${NC}"
npm test
echo ""

# Step 2: Run lint
echo -e "${GREEN}[2/8] Running lint...${NC}"
npm run lint
echo ""

# Step 3: Bump version
echo -e "${GREEN}[3/8] Bumping version ($BUMP_TYPE)...${NC}"
npm version $BUMP_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "New version: ${YELLOW}v$NEW_VERSION${NC}"
echo ""

# Step 4: Commit and tag
echo -e "${GREEN}[4/8] Committing and tagging...${NC}"
git add package.json package-lock.json
git commit -m "chore: Bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"
echo ""

# Step 5: Push to GitHub
echo -e "${GREEN}[5/8] Pushing to GitHub...${NC}"
git push origin main --tags
echo ""

# Step 6: Create GitHub Release
echo -e "${GREEN}[6/8] Creating GitHub release...${NC}"
gh release create "v$NEW_VERSION" --generate-notes --title "v$NEW_VERSION"
echo ""

# Step 7: Update Homebrew tap
echo -e "${GREEN}[7/8] Updating Homebrew tap...${NC}"
TARBALL_URL="https://github.com/brian-slate/juice-it/archive/refs/tags/v${NEW_VERSION}.tar.gz"

# Wait a moment for GitHub to process the tag
echo "Waiting for GitHub to process the tag..."
sleep 3

# Calculate SHA256
SHA256=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')
echo "SHA256: $SHA256"

# Update formula
sed -i '' "s|url \".*\"|url \"$TARBALL_URL\"|" "$FORMULA_FILE"
sed -i '' "s|sha256 \".*\"|sha256 \"$SHA256\"|" "$FORMULA_FILE"
echo ""

# Step 8: Commit and push tap
echo -e "${GREEN}[8/8] Pushing Homebrew tap...${NC}"
cd "$TAP_REPO"
git add Formula/juice-it.rb
git commit -m "Update juice-it to v$NEW_VERSION"
git push origin main
cd - > /dev/null
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Release v$NEW_VERSION complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "To install the new version:"
echo "  brew untap brian-slate/juice-it"
echo "  brew tap brian-slate/juice-it"
echo "  brew install brian-slate/juice-it/juice-it"
echo ""
echo "Or if already installed:"
echo "  brew upgrade juice-it"
