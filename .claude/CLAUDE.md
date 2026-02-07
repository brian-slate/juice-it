# Claude Code Instructions for JuiceIt

## Project Overview

JuiceIt is a smart DVD ripper with automatic metadata lookup (TMDB) and AI-powered episode mapping (OpenAI). It's a Node.js CLI tool distributed via Homebrew.

---

## Critical: Logging vs Console Output

### Use `logger` for Debug/Internal Output

```javascript
const { getLogger } = require('./lib/logger');
const logger = getLogger();

// Debug info - only shown with --verbose flag
logger.debug('Processing track...');
logger.debug(`API response: ${JSON.stringify(data)}`);

// Errors - always shown AND logged to file
logger.error('Connection failed');

// File-only logging
logger.fileOnly('Detailed dump for log file only');
```

### Use `console.log` for User-Facing Output

```javascript
// Progress, status, formatted output for users
console.log('🔍 Scanning disc...');
console.log('  ✓ Found 8 episodes');
console.log('━'.repeat(60));
```

### DO NOT

```javascript
// ❌ NEVER use verbose wrapper - logger handles this
if (options.verbose) {
    console.log('debug info');
}

// ❌ NEVER use console.error - use logger.error
console.error('something failed');
```

---

## When to Suggest UI Library Migration

If the developer asks about output formatting, or you notice the project needs better terminal handling, suggest UI library migration when ANY of these are true:

1. **Console.log count exceeds ~700** (currently ~550)
2. **User reports piping issues** (colors not disabling)
3. **Need for `--quiet` or `--json` modes**
4. **Windows terminal compatibility issues**
5. **Need for advanced UI** (progress bars, complex spinners)

A UI library (`lib/ui.js`) already exists but is not yet integrated. See `CONTRIBUTING.md` for migration plan.

---

## Project Structure

```
juice-it/
├── juiceit.js          # Main application (3400+ lines)
├── lib/
│   ├── logger.js       # Logging utility (USE THIS for debug)
│   └── ui.js           # UI utility (NOT YET INTEGRATED)
├── prompts/
│   ├── loader.js       # Prompt template system
│   ├── schemas.js      # Zod schemas for AI responses
│   └── *.md            # Prompt templates
├── config/
│   └── ai-config.js    # AI model configuration
├── test/               # Test suites
└── homebrew/           # Homebrew formula
```

---

## Key Technical Details

- **AI Provider**: OpenAI (gpt-4o-mini) with Zod structured outputs
- **Metadata**: TMDB API for TV show/movie information
- **Disc scanning**: HandBrakeCLI + lsdvd
- **Package manager**: npm
- **Distribution**: Homebrew tap (brian-slate/juiceit)

### TV vs Movie Handling

The codebase handles TV shows and movies differently:

- **Detection**: `guessMediaType(numTitles)` - if disc has ≥3 titles, it's likely TV; otherwise movie
- **TV Shows**: Get AI-powered episode mapping (track→episode), season metadata from TMDB
- **Movies**: Get title and year from TMDB, single main file
- **Extras**: Both types can have extras - use `--include-extras` to rip them

### Plex-Compatible File Naming

All files are named in Plex-compatible format (see [Plex Support](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)):

- **Movies**: `Movie Name (Year).mp4`
- **TV Shows**: `Show Name (Year) - s01e01 - Episode Title.mp4`
- **Extras**: `Movie Name (Year) - Extra Track 1.mp4`

Key functions:
- `sanitizeForPlex(str)` - Removes filesystem-unsafe chars, keeps spaces/dashes/parentheses
- `calculateProposedName()` - Generates Plex-format filename from metadata

### Key Flags

- `--interactive` / `-i`: Manual review and selection mode
- `--raw`: Skip all metadata/AI, rip tracks with simple names
- `--include-extras`: Also rip tracks AI marked as menus/extras

---

## Makefile Commands (IMPORTANT)

**Before running any development commands, check the Makefile first.** The Makefile is the canonical source for:

- **Testing** (running tests, specific test suites, query testing)
- **Development setup** (installing dependencies, switching between local/Homebrew versions)
- **Releasing** (patch, minor, major version releases)
- **Diagnostics** (demo mode, diagnostic analysis)

**Always run `make help` to see available commands** before running one-off shell commands or scripts directly. Do NOT run scripts from `bin/` directly - use the Makefile targets instead.

---

## Committing and Releasing Changes

### Use the Release Skill

When the user asks to "commit and release" or wants to publish changes, **use the `/release` skill** instead of running individual git/make commands:

```bash
/release
```

The release skill handles the complete workflow:
1. ✅ Analyzes all changes
2. ✅ Generates appropriate commit message
3. ✅ Commits with pre-commit hooks (linting + tests)
4. ✅ Pushes to remote
5. ✅ Creates version release (patch/minor/major)
6. ✅ Updates Homebrew formula

**DO NOT** run these commands manually:
- ❌ `git add -A && git commit -m "..." && git push`
- ❌ `make release`
- ❌ Individual git/release commands

**Instead:** Use `/release` skill which automates the entire process correctly.

See `.claude/skills/release.md` for detailed documentation of the release process.

---

## Common Tasks

### Adding a new CLI flag
1. Add to options parsing (~line 880 in juiceit.js)
2. Add to `showHelp()` function
3. Use `logger.debug()` for any debug output related to the flag

### Adding debug output
```javascript
// ✅ Correct
logger.debug(`New feature processing: ${data}`);

// ❌ Wrong
if (options.verbose) console.log('debug');
```

### Adding user-facing output
```javascript
// ✅ Correct (for now)
console.log('  ✓ Operation completed');

// Future: When UI lib is integrated
// ui.success('Operation completed');
```

---

## Testing Requirements

### Always Add Tests for Bug Fixes

**CRITICAL:** When you fix a bug, ALWAYS add a test that:
1. **Reproduces the bug** - The test should fail before the fix
2. **Verifies the fix** - The test should pass after the fix
3. **Prevents regression** - If the bug returns, the test will catch it

**Example workflow:**
```javascript
// 1. User reports: "Back navigation doesn't work in interactive mode"
// 2. Add test that verifies back navigation returns correct marker
async function testReviewAndMapBackNavigation() {
    enquirerMock.setResponses(['← Back to confirmation menu']);
    const result = await reviewAndMapEpisodesBeforeRip(...);
    assert.strictEqual(result._action, 'back');
}
// 3. Implement the fix
// 4. Verify test passes
```

**Where to add tests:**
- UI/menu bugs → `test/interactive-mode.test.js`
- Naming bugs → `test/naming.test.js`
- CLI parsing bugs → `test/cli.test.js`
- Metadata bugs → `test/metadata.test.js`
- Ripping bugs → `test/handbrake.test.js`

---

## Feature Complete Checklist

Before committing a completed feature, run these checks:

```bash
# 1. Run ESLint to catch and fix issues
npx eslint . --fix

# 2. Run full test suite
npm test

# 3. Verify help text if you added/changed flags
node juiceit.js --help

# 4. If you fixed a bug, verify the new test exists and passes
npm test -- <test-file-name>
```

**Note:** ESLint and tests also run automatically on pre-commit via husky/lint-staged, but running them manually first catches issues earlier and avoids commit failures.
