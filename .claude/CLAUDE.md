# Claude Code Instructions for JuiceIt

## Project Overview

JuiceIt is a smart DVD ripper with automatic metadata lookup (TMDB) and AI-powered episode mapping (OpenAI). It's a Node.js CLI tool distributed via Homebrew.

---

## Project Structure

```
juice-it/
├── juiceit.js          # Main application (3400+ lines)
├── lib/
│   ├── cli.js          # CLI argument parsing
│   ├── disc.js         # Disc detection and scanning
│   ├── handbrake.js    # HandBrakeCLI integration + disc ejection
│   ├── interactive.js  # Interactive mode UI
│   ├── logger.js       # Logging utility (USE THIS for debug)
│   ├── mapping.js      # Track-to-episode mapping
│   ├── metadata.js     # TMDB metadata lookup
│   ├── naming.js       # Plex-compatible file naming
│   ├── pricing.js      # AI cost estimation
│   ├── rip.js          # Core ripping logic
│   └── setup.js        # First-run setup
├── prompts/
│   ├── loader.js       # Prompt template system
│   ├── schemas.js      # Zod schemas for AI responses
│   └── *.md            # Prompt templates
├── config/
│   ├── ai-config.js    # AI model configuration
│   └── pricing.json    # AI pricing data
├── test/               # Test suites
├── homebrew/           # Homebrew formula
├── .husky/
│   ├── pre-commit      # Lint-staged + tests (skipped by --no-verify)
│   └── commit-msg      # Conventional commit format validation
├── .claude/
│   ├── rules/          # Coding conventions (loaded at startup)
│   │   ├── logging.md  # Logger vs console.log conventions
│   │   ├── testing.md  # Test requirements and checklist
│   │   └── commands.md # Makefile-first command usage
│   └── skills/
│       └── release/    # /release skill (commit + release workflow)
└── Makefile            # Canonical dev commands (always check here first)
```

---

## Key Technical Details

- **AI Provider**: OpenAI (gpt-4o-mini) with Zod structured outputs
- **Metadata**: TMDB API for TV show/movie information
- **Disc scanning**: HandBrakeCLI + lsdvd
- **Package manager**: npm
- **Distribution**: Homebrew tap (brian-slate/juiceit)

### TV vs Movie Handling

- **Detection**: `guessMediaType(numTitles)` - if disc has >=3 titles, it's likely TV; otherwise movie
- **TV Shows**: Get AI-powered episode mapping (track->episode), season metadata from TMDB
- **Movies**: Get title and year from TMDB, single main file
- **Extras**: Both types can have extras - use `--include-extras` to rip them

### Plex-Compatible File Naming

All files are named in Plex-compatible format:

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

**The Makefile is the single source of truth for all dev commands.** See `.claude/rules/commands.md` for the full list of do's and don'ts.

Key targets: `make verify` (lint+test), `make test`, `make lint`, `make release`

---

## Committing and Releasing Changes

Use the `/release` skill. It handles the full workflow: analyze changes, generate commit message, `make verify`, commit, push, and `make release`.

---

## Common Tasks

### Adding a new CLI flag
1. Add to options parsing in `lib/cli.js`
2. Add to help text in `lib/help.js`
3. Use `logger.debug()` for any debug output related to the flag

### Adding debug output
See `.claude/rules/logging.md` for conventions.

### Adding or fixing tests
See `.claude/rules/testing.md` for requirements.
