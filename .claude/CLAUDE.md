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

## Testing

Always run tests after changes:

```bash
npm test
```

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
