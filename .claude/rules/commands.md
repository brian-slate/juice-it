# Command Usage Rules

## Prefer Makefile Targets

The Makefile is the single source of truth for development commands. This prevents documentation drift and ensures consistency.

**Key targets:**
- `make verify` — lint + test (before committing)
- `make test` — run full test suite
- `make lint` — ESLint with auto-fix
- `make release` — patch release
- `make release-minor` — minor release
- `make release-major` — major release
- `make help` — see all available targets

## When a Target Doesn't Exist

If you need to run a command and no Makefile target covers it:

1. **Check if an existing target can be extended** to handle the use case
2. **If it's a one-off** (e.g., debugging, exploration), run the command directly — that's fine
3. **If it's a repeatable workflow** that will be used again, add a new Makefile target for it:
   - Add the target to the Makefile
   - Add it to the `help` target's output
   - Add it to the `.PHONY` list
   - Use it going forward instead of the raw command

## Avoid Direct Equivalents

When a Makefile target already exists, always prefer it over the raw command:
- `make test` over `npm test`
- `make lint` over `npx eslint . --fix`
- `make release` over `./bin/release.sh`

## Committing and Releasing

Use the `/release` skill. It handles the full workflow with the test-once strategy.

If doing a manual commit (not a full release), still use `make verify` before committing.
