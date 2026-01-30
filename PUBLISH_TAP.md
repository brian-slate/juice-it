# Publishing Your Homebrew Tap (Easy Way)

## What You Already Have

You already have a **local tap** working! Now let's make it public so anyone can use it.

## Step-by-Step: Publish Your Tap

### 1. Create GitHub Repo

Go to GitHub and create a new repository named: **`homebrew-juiceit`**

⚠️ **Important:** The name MUST start with `homebrew-` for Homebrew to recognize it as a tap.

### 2. Push Your Local Tap to GitHub

```bash
cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit

# Initialize git if not already done
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: JuiceIt Homebrew tap"

# Add your GitHub repo as remote
git remote add origin https://github.com/YOUR_USERNAME/homebrew-juiceit.git

# Push
git push -u origin main
```

### 3. Create a Release of JuiceIt

Users need a versioned release to download:

```bash
# Go to your juice-it repo
cd /Users/brianslate/code/personal/juice-it

# Merge your feature branch to main
git checkout improve-output-ui
git merge interactive-episode-mapping

# Create and push a tag
git tag -a v1.1.0 -m "Release v1.1.0: Interactive mapping + API key management"
git push origin improve-output-ui
git push origin v1.1.0
```

### 4. Create GitHub Release

1. Go to your juice-it repo on GitHub
2. Click "Releases" → "Create a new release"
3. Select tag `v1.1.0`
4. Title: "v1.1.0 - Interactive Mapping & API Key Management"
5. Description: Copy from COMPLETION_SUMMARY.md
6. Click "Publish release"

GitHub will automatically create a tarball at:
```
https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz
```

### 5. Update Formula with Release URL

Edit your tap's formula:

```bash
cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit
vim Formula/juiceit.rb
```

Change these lines:
```ruby
# FROM (local):
url "file:///Users/brianslate/code/personal/juice-it", using: :git, branch: "interactive-episode-mapping"
version "1.0.11-dev"

# TO (public):
url "https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz"
sha256 "CALCULATED_SHA256_HERE"
version "1.1.0"
```

### 6. Calculate SHA256

```bash
# Download the release tarball
curl -L https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz -o v1.1.0.tar.gz

# Calculate SHA256
shasum -a 256 v1.1.0.tar.gz

# Copy the hash and paste it in the formula
```

### 7. Push Updated Formula

```bash
cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit
git add Formula/juiceit.rb
git commit -m "Update formula for v1.1.0 public release"
git push
```

## Done! 🎉

Now **anyone** can install JuiceIt with:

```bash
brew tap YOUR_USERNAME/juiceit
brew install juiceit
```

Or in one line:
```bash
brew install YOUR_USERNAME/juiceit/juiceit
```

## Example (Real Projects)

This is how popular projects distribute via Homebrew:

```bash
# Stripe's CLI
brew install stripe/stripe-cli/stripe

# GitHub CLI
brew install github/gh/gh

# Your project
brew install YOUR_USERNAME/juiceit/juiceit
```

## Updating Your Tap

When you make changes:

1. Create new release with new tag (e.g., `v1.1.1`)
2. Update formula with new URL and SHA256
3. Push to homebrew-juiceit repo
4. Users run: `brew upgrade juiceit`

## Benefits of Taps vs Homebrew Core

✅ **Full control** - You manage releases  
✅ **Fast updates** - No waiting for PR approval  
✅ **Easy maintenance** - Just push to your repo  
✅ **No strict requirements** - Homebrew Core has many rules  
✅ **Still professional** - Users install the same way  

## Your Tap URL Structure

```
GitHub Repo: https://github.com/YOUR_USERNAME/homebrew-juiceit
Tap Name:    YOUR_USERNAME/juiceit
Install:     brew install YOUR_USERNAME/juiceit/juiceit
```

## No Need for Homebrew Core!

Homebrew Core is only needed if you want:
- Ultra-mainstream distribution
- To be in default `brew search` results
- Official Homebrew branding

For 99% of projects, **a personal tap is perfect**!
