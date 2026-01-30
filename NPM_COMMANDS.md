# NPM Commands Reference

Quick reference for development and testing commands.

## Testing

### Run Automated Tests
```bash
npm test
```
Runs the full test suite (9 tests covering API key management, helper functions, mock files, and track mapping).

### Run Interactive Demo
```bash
npm run demo
```
Launches an interactive demo of the episode mapping feature. Creates mock DVD tracks and lets you experience the full workflow:
- See problematic track assignments (e.g., 512KB menu assigned to Episode 1)
- Navigate with arrow keys
- Reassign tracks to correct episodes
- Mark tracks as skip
- Finalize renames

**Demo creates files in:** `test/demo-output/`

## Development

### Update Homebrew Installation
```bash
./bin/update-homebrew.sh
```
After committing changes, run this to update your local Homebrew installation for testing.

### Create Release Tarball
```bash
npm run create-tarball
```
Creates a distribution tarball for Homebrew.

### Version Bump
```bash
npm run standard-version
```
Bumps version and updates CHANGELOG.

### Full Release
```bash
npm run release
```
Runs version bump and release script.

## Manual Testing

### Test with Real DVD
```bash
# Insert DVD, then:
juiceit

# Or with options:
juiceit --scan-only        # Preview without ripping
juiceit --verbose          # See detailed output
juiceit --no-lookup        # Skip metadata lookup
juiceit --setup            # Configure TMDB API key
```

### Test API Key Setup
```bash
juiceit --setup
```
Walks through API key configuration. Test with:
- Valid API key (should save successfully)
- Invalid API key (should show error)
- Ctrl-C cancellation (should exit gracefully)

### Test Rename Only Mode
```bash
# After ripping, test metadata-based renaming:
juiceit --rename-only --output ./output_directory
```

## File Locations

### Test Output
- `test/test-output/` - Automated test artifacts (auto-cleaned)
- `test/demo-output/` - Demo script output
- `./<disc_name>_<date>/` - Actual rip output directories

### Config
- `~/.config/juice-it/config.json` - User API key
- `~/Library/Caches/juice-it/*.json` - Disc scan cache

### Logs
- `./<disc_name>_<date>/rip-log-*.txt` - Detailed operation logs

## Cleanup Commands

### Clean Test Artifacts
```bash
rm -rf test/test-output test/demo-output
```

### Clean Cache
```bash
rm -rf ~/Library/Caches/juice-it
```

### Clean Config
```bash
rm -rf ~/.config/juice-it
```

## Git Workflow

### View Recent Changes
```bash
git log --oneline --graph -10
```

### Check Current Branch
```bash
git branch --show-current
```

### Run All Validation
```bash
npm test && node --check juiceit.js
```
Runs tests and checks for syntax errors.

## Troubleshooting

### Demo Not Working?
```bash
# Make sure enquirer is installed:
npm install

# Check Node version (need 14+):
node --version

# Run with verbose errors:
node test/demo-interactive-mapping.js --trace-warnings
```

### Tests Failing?
```bash
# Clean test output and retry:
rm -rf test/test-output
npm test
```

### Permission Errors?
```bash
# Make scripts executable:
chmod +x test/demo-interactive-mapping.js
chmod +x bin/juiceit
```

## Quick Start for New Contributors

1. **Clone and install:**
   ```bash
   git clone <repo>
   cd juice-it
   npm install
   ```

2. **Run tests:**
   ```bash
   npm test
   ```

3. **Try the demo:**
   ```bash
   npm run demo
   ```

4. **Test with DVD (if available):**
   ```bash
   juiceit --scan-only
   ```

---

**Need help?** Check the main README.md or COMPLETION_SUMMARY.md for detailed documentation.
