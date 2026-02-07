#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TAP_REPO="$HOME/code/personal/homebrew-juice-it"
FORMULA_FILE="$TAP_REPO/Formula/juice-it.rb"

# Parse flags
SKIP_TESTS=false
if [[ "$*" == *"--skip-tests"* ]]; then
    SKIP_TESTS=true
fi

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

# Determine bump type (default: patch, filter out --skip-tests flag)
BUMP_TYPE="patch"
for arg in "$@"; do
    if [[ "$arg" != "--skip-tests" ]]; then
        BUMP_TYPE="$arg"
        break
    fi
done
echo -e "Bump type: ${YELLOW}$BUMP_TYPE${NC}"

if [ "$SKIP_TESTS" = true ]; then
    echo -e "${BLUE}ℹ️  Skipping tests (assuming pre-commit hooks already verified)${NC}"
fi
echo ""

# Step 1: Run tests (optional)
if [ "$SKIP_TESTS" = false ]; then
    echo -e "${GREEN}[1/9] Running tests...${NC}"
    npm test
    echo ""

    # Step 2: Run lint
    echo -e "${GREEN}[2/9] Running lint...${NC}"
    npm run lint
    echo ""
else
    echo -e "${BLUE}[1-2/9] Skipped tests and lint (--skip-tests flag)${NC}"
    echo ""
fi

# Step 3: Bump version
echo -e "${GREEN}[3/9] Bumping version ($BUMP_TYPE)...${NC}"
npm version $BUMP_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "New version: ${YELLOW}v$NEW_VERSION${NC}"
echo ""

# Step 4: Commit and tag
echo -e "${GREEN}[4/9] Committing and tagging...${NC}"
git add package.json package-lock.json
git commit -m "chore: Bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"
echo ""

# Step 5: Push to GitHub
echo -e "${GREEN}[5/9] Pushing to GitHub...${NC}"
git push origin main --tags
echo ""

# Step 6: Create GitHub Release
echo -e "${GREEN}[6/9] Creating GitHub release...${NC}"
gh release create "v$NEW_VERSION" --generate-notes --title "v$NEW_VERSION"
echo ""

# Step 7: Update Homebrew tap
echo -e "${GREEN}[7/9] Updating Homebrew tap...${NC}"
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
echo -e "${GREEN}[8/9] Pushing Homebrew tap...${NC}"
cd "$TAP_REPO"
git add Formula/juice-it.rb
git commit -m "Update juice-it to v$NEW_VERSION"
git push origin main
cd - > /dev/null
echo ""

# Step 9: Clean up any local release artifacts
echo -e "${GREEN}[9/9] Cleaning up local release artifacts...${NC}"
if [ -d "releases" ]; then
    rm -rf releases/*
    echo "Removed files from releases/ folder"
else
    echo "No releases/ folder found (nothing to clean)"
fi
# Also clean any stray tarball files in project root
rm -f *.tar.gz *.tgz 2>/dev/null || true
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
