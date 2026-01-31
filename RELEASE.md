# How to Release a New Version

## Quick Release Process

### 1. Prepare the Release

Make sure all changes are committed and merged:

```bash
# Merge your feature branch
git checkout improve-output-ui
git merge interactive-episode-mapping

# Make sure everything is committed
git status
```

### 2. Bump Version

Edit `package.json` and update the version:

```json
{
  "version": "1.1.0"
}
```

Commit:
```bash
git add package.json
git commit -m "Bump version to 1.1.0"
```

### 3. Create Tag and Push

```bash
# Create tag
git tag -a v1.1.0 -m "Release v1.1.0: Interactive mapping and API key management"

# Push everything
git push origin improve-output-ui
git push origin v1.1.0
```

### 4. Create GitHub Release

1. Go to: https://github.com/YOUR_USERNAME/juice-it/releases/new
2. Select tag: `v1.1.0`
3. Title: `v1.1.0 - Interactive Mapping & API Key Management`
4. Description: Copy highlights from `COMPLETION_SUMMARY.md`
5. Click "Publish release"

GitHub automatically creates a tarball at:
```
https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz
```

### 5. Update Homebrew Formula

```bash
# Download the release tarball
curl -L https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz -o v1.1.0.tar.gz

# Calculate SHA256
shasum -a 256 v1.1.0.tar.gz
# Copy the hash!

# Edit the formula in your tap repo
cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit
vim Formula/juiceit.rb
```

Update these lines:
```ruby
url "https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz"
sha256 "PASTE_SHA256_HERE"
version "1.1.0"
```

Commit and push:
```bash
git add Formula/juiceit.rb
git commit -m "Update formula for v1.1.0"
git push
```

### 6. Done!

Users will now get v1.1.0 when they run:
```bash
brew upgrade juiceit
```

Or new users:
```bash
brew install YOUR_USERNAME/juiceit/juiceit
```

## What Version Number to Use?

Follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0)**: Breaking changes
- **Minor (1.X.0)**: New features (backward compatible)
- **Patch (1.1.X)**: Bug fixes

Examples:
- `1.1.0` - Added interactive mapping (new feature)
- `1.1.1` - Fixed episode naming bug (bug fix)
- `2.0.0` - Changed CLI arguments (breaking change)

## Using the Release Script

You have an existing release script at `bin/release.sh` but it requires the `gh` CLI tool.

To use it:
```bash
# Install GitHub CLI if needed
brew install gh

# Run the script (after bumping version in package.json)
npm run release
```

This will:
- Create tarball
- Push to GitHub
- Create release
- Update formula automatically

## Simplified Manual Process (Recommended)

If you don't want to use the script, just follow steps 1-6 above manually. It's straightforward and gives you full control.
