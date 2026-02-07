---
name: release
description: Commit and release workflow. Use when user says "commit", "release", "commit and release", "push", or any variation. Analyzes changes, generates commit message, verifies code quality, commits, pushes, and creates a versioned release.
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[patch|minor|major]"
---

# Commit and Release Workflow

This workflow ensures all changes are properly committed, tested once, and released efficiently.

## Test-Once Strategy

Without optimization, tests would run 3 times: manually, in pre-commit hook, and in the release script. This workflow runs them exactly ONCE:

1. **`make verify`** (Step 3) — Runs lint + full test suite. This is the ONLY test run.
2. **`git commit --no-verify`** (Step 4) — Safe because `make verify` just passed. The pre-commit hook would run the same lint + tests redundantly. The `commit-msg` hook still runs to validate conventional commit format.
3. **`make release`** (Step 7) — The Makefile targets pass `--skip-tests` to the release script, since we already verified in step 3.

**Never use `--no-verify` unless `make verify` passed immediately before.** If you modify any files after `make verify`, you must re-run it before committing.

## Git Hooks

The project has two git hooks (via husky):
- **`pre-commit`** — Runs lint-staged (ESLint auto-fix) + `npm test`.
- **`commit-msg`** — Validates conventional commit format (e.g., `feat: ...`, `fix: ...`).

**Note:** `--no-verify` skips BOTH hooks. This is safe in the `/release` workflow because:
- Tests already passed via `make verify`
- This skill generates the commit message in conventional format

The `commit-msg` hook still protects manual human commits (which don't use `--no-verify`). The release script's version bump commit (`chore: Bump version to X.X.X`) also uses `--no-verify` when `--skip-tests` is active, avoiding a redundant pre-commit test run. When running `make release-with-tests`, the version bump commit goes through hooks normally.

## Steps

### Step 1: Analyze All Changes

```bash
git status
git diff --stat
git diff --name-only
```

Review staged, unstaged, and untracked files.

### Step 2: Generate Commit Message

Create a commit message using conventional commits:
- `feat:` — New features
- `fix:` — Bug fixes
- `refactor:` — Refactoring/cleanup
- `docs:` — Documentation
- `test:` — Tests
- `chore:` — Build/release/config

Rules:
- Brief, clear summary (50-72 chars for title)
- Bullet points for key changes in body
- Focus on WHAT changed and WHY, not HOW
- Does NOT include Co-Authored-By (per global CLAUDE.md)

### Step 3: Verify Code Quality ONCE

```bash
git add -A
make verify        # Runs lint + tests (single command)
git add -A         # Re-stage any eslint auto-fixes
```

This is the ONLY time tests run in the entire workflow. If tests fail, fix and re-run `make verify`.

### Step 4: Commit with --no-verify

```bash
git commit --no-verify -m "$(cat <<'EOF'
[commit message here]
EOF
)"
```

Why `--no-verify` is safe: we just ran `make verify` which does everything the pre-commit hook does. Skipping avoids redundant test runs.

When NOT to use `--no-verify`:
- If you didn't run `make verify` first
- If tests failed and you're "trying anyway"
- If you modified files after running `make verify`

### Step 5: Push to Remote

```bash
git push origin main
```

If push fails (behind remote):
```bash
git pull --rebase origin main
git push origin main
```

### Step 6: Determine Release Type

Map commit type to version bump:
- `fix:` / `chore:` / `docs:` / `refactor:` / `test:` → `make release` (patch)
- `feat:` → `make release-minor` (minor)
- `BREAKING CHANGE:` or `!` → `make release-major` (major)

If user passed an argument (e.g., `/release minor`), use that: $ARGUMENTS

### Step 7: Execute Release

```bash
make release          # patch
make release-minor    # minor
make release-major    # major
```

The release script (with `--skip-tests`) will:
1. Check for uncommitted changes
2. Bump version in package.json
3. Commit and tag
4. Push tag to GitHub
5. Create GitHub release
6. Update Homebrew formula
7. Push Homebrew changes

### Step 8: Verify Success

```bash
git describe --tags
```

## Error Handling

### Tests Fail (Step 3)
Fix the issues. If this was a bug fix, add a regression test per project rules. Re-run `make verify`, re-stage, then proceed.

### Push Fails
```bash
git pull --rebase origin main
git push origin main
```

### Release Fails
Check `git status` for unexpected changes. Fix and re-run the release command.

## Testing Requirements

Per project rules: **Always add tests for bug fixes**. If committing a fix:
1. Verify there's a test that reproduces the bug
2. Verify the test passes with the fix
3. Note this in the commit message
