# Logging vs Console Output

## Use `logger` for Debug/Internal Output

```javascript
const { getLogger } = require('./lib/logger');
const logger = getLogger();

logger.debug('Processing track...');       // Only shown with --verbose
logger.error('Connection failed');          // Always shown AND logged to file
logger.fileOnly('Detailed dump');           // File only
```

## Use `console.log` for User-Facing Output

```javascript
console.log('  ✓ Found 8 episodes');       // Progress, status, formatted text
```

## DO NOT

```javascript
// NEVER use verbose wrapper - logger handles this
if (options.verbose) { console.log('debug info'); }

// NEVER use console.error - use logger.error
console.error('something failed');
```

## UI Library Migration Triggers

Suggest migrating to `lib/ui.js` (exists but not yet integrated) when ANY of these are true:
1. Console.log count exceeds ~700 (currently ~550)
2. User reports piping issues (colors not disabling)
3. Need for `--quiet` or `--json` modes
4. Windows terminal compatibility issues
5. Need for advanced UI (progress bars, complex spinners)

See `CONTRIBUTING.md` for migration plan.
