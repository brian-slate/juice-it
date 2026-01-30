# Homebrew Distribution Guide

## Current Setup (Local Development)

You're currently using a **local tap** for development and testing.

### Local Installation
Users install with:
```bash
brew tap brianslate/juiceit
brew install juiceit
```

Formula location: `/opt/homebrew/Library/Taps/brianslate/homebrew-juiceit/Formula/juiceit.rb`

The formula points to: `file:///Users/brianslate/code/personal/juice-it` (your local repo)

---

## Public Distribution (For Internet Users)

To make JuiceIt installable by anyone on the internet, you need to:

### Step 1: Create a GitHub Repository

```bash
# Create a new repo on GitHub: homebrew-juiceit
# Then push your local tap:

cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit
git init
git add .
git commit -m "Initial commit: JuiceIt Homebrew formula"
git remote add origin https://github.com/YOUR_USERNAME/homebrew-juiceit.git
git push -u origin main
```

### Step 2: Create a Release of JuiceIt

You need to create versioned releases that Homebrew can download:

```bash
# In your juice-it repo
cd /Users/brianslate/code/personal/juice-it

# Merge your feature branch
git checkout improve-output-ui
git merge interactive-episode-mapping

# Tag a release
git tag -a v1.1.0 -m "Release v1.1.0: Interactive mapping and API key management"
git push origin v1.1.0

# Create a tarball
git archive --format=tar.gz --prefix=juice-it-1.1.0/ v1.1.0 > juice-it-1.1.0.tar.gz
```

### Step 3: Host the Release

**Option A: GitHub Releases (Recommended)**
1. Go to your juice-it repo on GitHub
2. Click "Releases" → "Create a new release"
3. Tag: `v1.1.0`
4. Upload the tarball or let GitHub auto-generate it
5. Publish release

**Option B: Your Own Server**
Upload the tarball to a publicly accessible URL.

### Step 4: Update Formula for Public Distribution

Edit `homebrew/Formula/juiceit.rb`:

```ruby
class Juiceit < Formula
  desc "Smart DVD ripper with automatic metadata lookup and episode naming"
  homepage "https://github.com/YOUR_USERNAME/juice-it"
  url "https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz"
  sha256 "TARBALL_SHA256_HERE"  # Get with: shasum -a 256 juice-it-1.1.0.tar.gz
  version "1.1.0"
  license "MIT"

  depends_on "node"
  depends_on "handbrake"
  depends_on "libdvdcss"
  depends_on "ffmpeg"

  def install
    # Install all files to libexec first
    libexec.install Dir["*"]
    
    # Install npm dependencies in libexec
    system "npm", "install", "--production", "--prefix", libexec
    
    # Create wrapper script that uses node
    (bin/"juiceit").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/juiceit.js" "$@"
    EOS
  end

  def caveats
    <<~EOS
      🎬 JuiceIt installed successfully!
      
      📋 Next Steps:
      1. Get a free TMDB API key:
         https://www.themoviedb.org/settings/api
      
      2. Run setup:
         juiceit --setup
      
      3. Insert a DVD and run:
         juiceit
      
      For help: juiceit --help
    EOS
  end

  test do
    system "#{bin}/juiceit", "--help"
  end
end
```

### Step 5: Calculate SHA256

```bash
# Download your release tarball
wget https://github.com/YOUR_USERNAME/juice-it/archive/refs/tags/v1.1.0.tar.gz

# Calculate SHA256
shasum -a 256 v1.1.0.tar.gz

# Copy the hash and update the formula
```

### Step 6: Push Updated Formula

```bash
cd /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit
git add Formula/juiceit.rb
git commit -m "Update formula for v1.1.0 public release"
git push
```

### Step 7: Users Can Now Install!

Anyone can install with:

```bash
brew tap YOUR_USERNAME/juiceit
brew install juiceit
```

Or in one line:
```bash
brew install YOUR_USERNAME/juiceit/juiceit
```

---

## Updating After Changes

### Local Development
```bash
./bin/quick-test.sh "Your commit message"
```

### Public Release
1. Make changes and commit
2. Bump version in `package.json`
3. Create new tag: `git tag -a v1.1.1 -m "Release v1.1.1"`
4. Push tag: `git push origin v1.1.1`
5. Create GitHub release
6. Update formula with new URL and SHA256
7. Push updated formula to homebrew-juiceit repo

---

## Alternative: Submit to Homebrew Core

For maximum visibility, submit to the official Homebrew repository:

### Requirements
- Project must be stable and maintained
- Must have notable popularity or utility
- Must follow Homebrew guidelines

### Process
1. Create your tap as above
2. Get users and traction
3. Submit PR to homebrew-core:
   - https://github.com/Homebrew/homebrew-core
4. Follow their contribution guidelines

Users would then install with just:
```bash
brew install juiceit
```

---

## Quick Reference

| Stage | Installation Command | Formula Location |
|-------|---------------------|------------------|
| Local Dev | `brew install brianslate/juiceit/juiceit` | Local file path |
| Personal Tap | `brew install YOUR_USERNAME/juiceit/juiceit` | GitHub tarball |
| Homebrew Core | `brew install juiceit` | Official repo |

---

## Current Status

✅ **Local Development**: Working  
⏳ **Personal Tap**: Not yet published  
⏳ **Homebrew Core**: Future consideration

**Next Step**: Create GitHub releases when ready to go public!
