# Contributing to JuiceIt

## Development Guidelines

### Code Style

- Use ES6+ features (const/let, arrow functions, template literals)
- Prefer async/await over callbacks
- Keep functions focused and single-purpose

---

## Logging & Output Architecture

JuiceIt separates output into two categories:

### 1. Logger (`lib/logger.js`) - For Debugging & Files

Use the logger for:
- Debug information (only shown with `--verbose`)
- Error messages that need consistent formatting
- Internal state logging to files
- API call tracing

```javascript
const { getLogger } = require('./lib/logger');
const logger = getLogger();

// Debug - only shown with --verbose, always logged to file
logger.debug('Processing track 5...');
logger.debug(`API response: ${JSON.stringify(data)}`);

// Errors - always shown to user AND logged to file
logger.error('Failed to connect to TMDB API');

// File only - never shown to console
logger.fileOnly('Detailed internal state dump...');
```

**IMPORTANT**: Do NOT use `console.error()` directly. Use `logger.error()` instead.

### 2. Console Output (`console.log`) - For User-Facing UI

Use `console.log` for:
- Progress messages shown to users
- Formatted output (tables, banners, sections)
- Interactive prompts and menus
- Success/completion messages with emoji

```javascript
// User-facing output - keep as console.log
console.log('🔍 Scanning disc...');
console.log('━'.repeat(60));
console.log('  ✓ Found 8 episodes');
```

### What NOT to Do

```javascript
// ❌ WRONG - Don't use if (options.verbose) wrapper
if (options.verbose) {
    console.log('Debug info here');
}

// ✅ RIGHT - Logger handles verbose internally
logger.debug('Debug info here');

// ❌ WRONG - Don't use console.error directly
console.error('Something failed');

// ✅ RIGHT - Use logger for errors
logger.error('Something failed');
```

---

## Future: UI Library Migration

### Current State

We currently use raw `console.log()` for ~550 user-facing output calls. This works well but has limitations:

- No automatic color disabling when output is piped
- No built-in support for quiet mode (`--quiet`)
- No JSON output mode for scripting
- Inconsistent formatting if multiple developers contribute

### The Plan

A UI library (`lib/ui.js`) has been created but is **not yet integrated**. The migration should happen when:

#### Triggers for Migration

| Trigger | Description |
|---------|-------------|
| **Console.log count > 700** | Project has grown significantly |
| **Need for --quiet mode** | Users request suppressing non-essential output |
| **Need for --json mode** | Users want structured output for scripting |
| **Piping issues reported** | Colors/spinners break when piping to files |
| **Windows terminal issues** | Unicode/color problems on Windows |
| **New complex UI needed** | Progress bars, multi-line spinners, etc. |

#### Migration Steps (When Ready)

1. **Add chalk dependency** (44KB) for color handling:
   ```bash
   npm install chalk
   ```

2. **Update `lib/ui.js`** to use chalk internally

3. **Gradually migrate** console.log calls to ui.* methods:
   ```javascript
   // Before
   console.log('  ✓ Task completed');

   // After
   const { getUI } = require('./lib/ui');
   const ui = getUI();
   ui.success('Task completed');
   ```

4. **Add CLI flags**:
   - `--quiet` - Suppress non-essential output
   - `--json` - Output structured JSON
   - `--no-color` - Disable colors

#### Recommended Libraries (When Needed)

| Need | Library | Size |
|------|---------|------|
| Colors | `chalk` | 44 KB |
| Spinners | `ora` | 52 KB |
| Progress bars | `cli-progress` | 89 KB |
| Box drawing | `boxen` | 48 KB |

**Start with chalk only** - it handles 80% of terminal edge cases.

---

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:core      # Core functionality
npm run test:prompts   # Prompt/schema validation
npm run test:runtime   # Runtime analysis
npm run test:openai    # OpenAI API integration
```

---

## Pull Request Guidelines

1. Run `npm test` and ensure all tests pass
2. Use the logger for debug output, not `console.log` with verbose checks
3. Keep user-facing output as `console.log` (until UI lib migration)
4. Update documentation if adding new features
