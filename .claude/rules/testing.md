# Testing Requirements

## Always Add Tests for Bug Fixes

When you fix a bug, ALWAYS add a test that:
1. **Reproduces the bug** - The test should fail before the fix
2. **Verifies the fix** - The test should pass after the fix
3. **Prevents regression** - If the bug returns, the test will catch it

## Where to Add Tests

- UI/menu bugs → `test/interactive-mode.test.js`
- Naming bugs → `test/naming.test.js`
- CLI parsing bugs → `test/cli.test.js`
- Metadata bugs → `test/metadata.test.js`
- Ripping bugs → `test/handbrake.test.js`
- Track mapping bugs → `test/mapping.test.js`

## Feature Complete Checklist

Before committing a completed feature:

```bash
# 1. Run lint + full test suite (single command)
make verify

# 2. Verify help text if you added/changed flags
node juiceit.js --help

# 3. If you fixed a bug, verify the new test exists and passes
make test
```

## Use Makefile Targets

Always use Makefile targets instead of explicit commands:
- `make verify` (not `npx eslint . --fix && npm test`)
- `make test` (not `npm test`)
- `make lint` (not `npx eslint . --fix`)
- `make release` (not `./bin/release.sh`)

This prevents documentation drift as commands evolve.
