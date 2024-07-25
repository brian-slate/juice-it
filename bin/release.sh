#!/bin/bash

# Get the new version from package.json
VERSION=$(node -p "require('./package.json').version")

# Create the tarball
npm run create-tarball

# Define the tarball filename
TARBALL_NAME="juice-it-v$VERSION.tar.gz"
TARBALL_PATH="releases/$TARBALL_NAME"

# Stage and commit the tarball
git add "$TARBALL_PATH"
git commit -m "Add release tarball for version $VERSION"

# Push changes and tags
git push --follow-tags

# Create the GitHub release with only the tarball
gh release create "v$VERSION" "$TARBALL_PATH" --title "Release v$VERSION" --notes "Release notes for version $VERSION"

# Update Homebrew formulas
FORMULA_DIR="homebrew/Formula"
FORMULA_FILE="$FORMULA_DIR/juiceit.rb"

if [ -f "$FORMULA_FILE" ]; then
    # Update the URL in the Homebrew formula
    sed -i '' "s|url .*|url \"https://github.com/brian-slate/juice-it/releases/download/v$VERSION/$TARBALL_NAME\"|" "$FORMULA_FILE"

    # Calculate the SHA256 hash of the new tarball
    SHA256=$(shasum -a 256 "$TARBALL_PATH" | awk '{ print $1 }')

    # Update the SHA256 in the Homebrew formula
    sed -i '' "s|sha256 .*|sha256 \"$SHA256\"|" "$FORMULA_FILE"
    
    echo "Updated Homebrew formula: $FORMULA_FILE"

    # Stage and commit the updated Homebrew formula
    git add "$FORMULA_FILE"
    git commit -m "Update Homebrew formula for version $VERSION"

    # Push the Homebrew formula changes
    git push
else
    echo "Homebrew formula not found: $FORMULA_FILE"
fi