# JuiceIt Project Status

## Current Branch: `interactive-episode-mapping`

Last updated: 2026-01-30

---

## Completed Features ✅

### Core Functionality
- ✅ DVD ripping with HandBrakeCLI integration
- ✅ Automatic DVD detection via drutil
- ✅ No arguments required - just run `juiceit`
- ✅ Track duration scanning and caching
- ✅ Track categorization (menu, extra, episode, full disc)
- ✅ System cache management (keeps last 10 cache files)
- ✅ Rename-only mode for existing rips

### Metadata & Naming
- ✅ TMDB API integration for TV shows and movies
- ✅ Automatic media type detection (TV vs Movie)
- ✅ Interactive metadata selection with arrow keys
- ✅ Season/episode naming (S01E01 format)
- ✅ Episode name lookup with proper formatting
- ✅ Fallback to disc name when metadata unavailable

### User Experience
- ✅ Beautiful progress bars with time estimates
- ✅ Professional banner and UI
- ✅ Progress dots during 60-90 second disc scanning
- ✅ "Parsing tracks" status indicator
- ✅ Detailed timestamped logging
- ✅ Track summary with categorization before ripping
- ✅ Fixed display bugs (no more "remaininggngg" artifact)

### Installation & Distribution
- ✅ Homebrew formula created
- ✅ Global `juiceit` command via brew install
- ✅ Removed node-pty dependency (native module issues)
- ✅ MIT License added
- ✅ Legal disclaimers and TMDB attribution
- ✅ Comprehensive README with setup instructions
- ✅ .gitignore for test outputs

### Workflow Modes
- ✅ `--scan-only`: Preview disc without ripping
- ✅ `--rename-only`: Rename existing files with metadata
- ✅ `--no-lookup`: Skip metadata, use disc name
- ✅ `--verbose`: Show HandBrakeCLI output

---

## Planned Features 📋

### Priority 1: TMDB API Key Management
**Status:** Implementation plan created
**File:** `IMPLEMENTATION_PLAN_API_KEY.md`
**Estimated Time:** 2-3 hours

**Features:**
- `--setup` flag to configure personal API key
- API key validation before saving
- Stored in ~/.config/juice-it/config.json (0600 permissions)
- Warning when using demo key
- Homebrew post-install caveats with setup instructions
- README documentation

**Acceptance Criteria:**
- [ ] User can run `juiceit --setup`
- [ ] API key validated via TMDB test request
- [ ] Config file created with proper permissions
- [ ] Demo key fallback with warning
- [ ] Post-install message in Homebrew
- [ ] README documents setup process

### Priority 2: Interactive Episode Mapping
**Status:** Implementation plan created
**File:** `IMPLEMENTATION_PLAN_INTERACTIVE_MAPPING.md`
**Estimated Time:** 7-10 hours

**Features:**
- Rip all tracks with generic names (track_01.mp4, etc.)
- Interactive review screen after ripping
- Display track #, file size, duration, proposed name
- Warning indicators for suspicious files (< 50MB or < 5min)
- Reassign individual tracks to different episodes
- Mark tracks as "skip" (no episode name)
- Re-search TMDB and re-auto-map all tracks
- "Accept All" to finalize renames
- "Cancel" to keep generic names

**Acceptance Criteria:**
- [ ] All tracks ripped with track_XX.mp4 names
- [ ] Review screen shows all track details
- [ ] Arrow key navigation works
- [ ] Can reassign individual tracks
- [ ] Can mark tracks to skip
- [ ] Can re-search TMDB
- [ ] Accept All finalizes renames
- [ ] Cancel preserves generic names
- [ ] Warning icons for suspicious tracks
- [ ] Log records all renames

**Test Case:**
Look Around You Series 1 disc where track 1 (512KB menu) should be reassigned, and track 3 (229MB) is the real episode 1.

---

## Known Issues 🐛

### Current Branch (interactive-episode-mapping)
- None currently - clean slate for new features

### Main Branch (improve-output-ui)
- None reported

---

## Testing Checklist

### Before Merging to Main
- [ ] API Key Management
  - [ ] Fresh install test (brew caveats message)
  - [ ] Setup with invalid key (error handling)
  - [ ] Setup with valid key (success)
  - [ ] Config file permissions (0600)
  - [ ] Demo key warning shown
  - [ ] User key used when configured

- [ ] Interactive Mapping
  - [ ] Look Around You problem case
  - [ ] Normal disc with correct order
  - [ ] Re-search TMDB workflow
  - [ ] Cancel during review
  - [ ] File already exists handling
  - [ ] Skip marked tracks not renamed

- [ ] End-to-End
  - [ ] Fresh brew install → setup → rip disc
  - [ ] Verify all features work together
  - [ ] Check log file completeness
  - [ ] Verify cache cleanup working

---

## File Locations

### Implementation Plans
- `IMPLEMENTATION_PLAN_API_KEY.md` - API key management spec
- `IMPLEMENTATION_PLAN_INTERACTIVE_MAPPING.md` - Interactive mapping spec
- `PROJECT_STATUS.md` - This file

### Main Code
- `juiceit.js` - Main application (1200+ lines)
- `package.json` - Dependencies and metadata
- `bin/juiceit` - Executable wrapper for brew

### Distribution
- `homebrew/Formula/juiceit.rb` - Homebrew formula
- `LICENSE` - MIT License
- `README.md` - User documentation
- `.gitignore` - Git exclusions

### Cache & Output
- `~/Library/Caches/juice-it/*.json` - Disc scan cache (auto-cleaned)
- `./<disc_name>_<date>/` - Output directories
- Log files in output directories

---

## Branch Strategy

### `improve-output-ui` (stable)
All completed features. Ready for use.
Last commit: "Update Homebrew formula to use local git for testing"

### `interactive-episode-mapping` (development)
New features in progress:
1. API Key Management (not started)
2. Interactive Mapping (not started)

### Merge Strategy
1. Implement and test API Key Management
2. Commit and test thoroughly
3. Implement and test Interactive Mapping
4. Commit and test thoroughly
5. Merge to `improve-output-ui` when both complete
6. Tag release version

---

## Homebrew Distribution

### Current Setup (Local Testing)
```bash
brew tap-new brianslate/juiceit  # Already done
cp homebrew/Formula/juiceit.rb /opt/homebrew/Library/Taps/brianslate/homebrew-juiceit/Formula/
brew install brianslate/juiceit/juiceit
```

### Public Distribution (Future)
1. Create GitHub repo: `homebrew-juiceit`
2. Push formula to repo
3. Update formula to use GitHub releases instead of local path
4. Users install with:
   ```bash
   brew tap brian-slate/juiceit
   brew install juiceit
   ```

### For Homebrew Core (Optional)
Submit PR to homebrew-core for wider distribution.

---

## Next Steps

1. **Implement API Key Management** (~2-3 hours)
   - Follow IMPLEMENTATION_PLAN_API_KEY.md
   - Test with checklist
   - Commit

2. **Implement Interactive Mapping** (~7-10 hours)
   - Follow IMPLEMENTATION_PLAN_INTERACTIVE_MAPPING.md
   - Test with Look Around You disc
   - Test edge cases
   - Commit

3. **End-to-End Testing** (~1 hour)
   - Brew uninstall/reinstall cycle
   - Fresh user experience
   - Multiple discs

4. **Documentation** (~30 minutes)
   - Update README if needed
   - Create release notes
   - Update PROJECT_STATUS.md

5. **Release** (~30 minutes)
   - Merge to improve-output-ui
   - Tag version
   - Create GitHub release
   - Update Homebrew formula with release URL

---

## Questions & Decisions

### Answered
- ✅ Should we use shared demo key or require user keys?
  - **Decision:** Support both. Demo key with warning, encourage setup.

- ✅ Should interactive mapping be default or opt-in?
  - **Decision:** Default for all rips. Improves accuracy.

- ✅ What to do about node-pty dependency?
  - **Decision:** Removed. Enquirer works without it.

### Open
- Should we add a config option to disable interactive review?
- Should we support custom metadata sources beyond TMDB?
- Should we add support for multi-disc TV sets?

---

## Performance Notes

- Disc scanning: 60-90 seconds (HandBrakeCLI scan)
- Cache hit: < 1 second to load track info
- TMDB lookup: 1-2 seconds per search
- Ripping: ~5-10 minutes per 22-minute episode (depends on CPU)

---

## Support & Contributions

For bugs or feature requests, see GitHub issues.
For discussions, see GitHub discussions.

Contributions welcome! See IMPLEMENTATION_PLAN_*.md files for detailed specs.
