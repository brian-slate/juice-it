# Commit and Release Workflow Guide

**Trigger**: When user says "commit and release" or similar
**Type**: Workflow guide (not a system-invocable skill)
**Description**: Automates the complete commit and release workflow for JuiceIt

**IMPORTANT**: This is a workflow guide for Claude to follow, not an invocable skill. When the user asks to "commit and release", follow these steps directly.

This workflow ensures all changes are properly committed, tested once, and released efficiently.

## What This Skill Does

1. **Analyzes Changes**: Reviews all modified and untracked files
2. **Generates Commit Message**: Creates a high-level summary of changes
3. **Commits Changes**: Stages and commits all changes (pre-commit hooks handle linting/testing)
4. **Pushes to Remote**: Pushes the commit to the main branch
5. **Creates Release**: Uses Makefile to create appropriate version release
6. **Verifies Success**: Confirms release was created successfully

## When to Use This Skill

- After completing a feature or bug fix
- When you have uncommitted changes ready for release
- When the user asks to "commit and release" or similar

## Skill Execution Steps

### Step 1: Analyze All Changes

Run these commands to understand what changed:

```bash
git status
git diff --stat
git diff --name-only
```

Review both staged and unstaged changes, plus untracked files.

### Step 2: Generate High-Level Commit Message

Based on the changes, create a commit message that:
- Starts with conventional commit type: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Provides a brief, clear summary (50-72 chars for title)
- Includes bullet points for key changes in the body
- Does NOT include Co-Authored-By (per global CLAUDE.md rules)

**Categorize changes:**
- New features → `feat:`
- Bug fixes → `fix:`
- Refactoring/cleanup → `refactor:`
- Documentation → `docs:`
- Tests → `test:`
- Build/release/config → `chore:`

### Step 3: Verify Code Quality ONCE (Before Commit)

```bash
# Stage all changes first
git add -A

# Run lint + tests via Makefile target
make verify

# If eslint made changes, re-stage them
git add -A
```

**What `make verify` does:**
- Runs `make lint` (ESLint with auto-fix)
- Runs `make test` (full test suite)
- Single command for complete verification

**IMPORTANT**: This is the ONLY time tests run in the entire workflow. If tests fail, fix them and re-run `make verify`. Don't proceed to commit until it passes.

### Step 4: Commit with --no-verify (Skip Pre-Commit Hook)

```bash
# Tests already passed above, so skip pre-commit hook to avoid redundancy
git commit --no-verify -m "$(cat <<'EOF'
[Your generated commit message here]
EOF
)"
```

**Why --no-verify is safe here:**
- ✅ We just ran ESLint and fixed all issues
- ✅ We just ran full test suite and everything passed
- ✅ Pre-commit hook would just repeat what we already did
- ✅ This saves ~30-60 seconds on every commit

**OPTIMIZED TESTING STRATEGY**:
- ✅ **Run tests ONCE** before commit (manually)
- ✅ **Use --no-verify** to skip redundant pre-commit hook
- ✅ **Release script skips tests** (uses --skip-tests flag)
- 🎯 **Result**: Tests run 1 time instead of 3 times

**When NOT to use --no-verify:**
- ❌ If you didn't run tests manually first
- ❌ If tests failed and you're "trying anyway"
- ❌ If you modified files after running tests

### Step 5: Push to Remote

```bash
# Push to main branch
git push origin main
```

If push fails (e.g., behind remote), pull with rebase first:
```bash
git pull --rebase origin main
git push origin main
```

### Step 6: Determine Release Type

Check the commit type to determine release version:
- `fix:` → Patch release (1.2.3 → 1.2.4)
- `feat:` → Minor release (1.2.3 → 1.3.0)
- `BREAKING CHANGE:` or `!` → Major release (1.2.3 → 2.0.0)
- `chore:`, `docs:`, `refactor:`, `test:` → Patch release

### Step 7: Read Makefile for Release Commands

```bash
make help | grep -A 5 "release"
```

Available commands:
- `make release` - Patch release (bug fixes)
- `make release-minor` - Minor release (new features)
- `make release-major` - Major release (breaking changes)

### Step 8: Execute Release

```bash
# For patch/fix
make release

# For minor/feat
make release-minor

# For major/breaking
make release-major
```

The release script will:
1. Check for uncommitted changes (should be none now)
2. Run full test suite
3. Bump version in package.json
4. Create git tag
5. Push tag to remote
6. Update Homebrew formula
7. Push Homebrew changes

### Step 9: Verify Release Success

```bash
# Check the new version
git describe --tags

# Verify tag was pushed
git ls-remote --tags origin

# Check Homebrew formula was updated
cat homebrew/juiceit.rb | grep "version"
```

## Error Handling

### If Tests Fail (Step 3)

**Verification Failures:**
```bash
# Fix the issues (lint or test failures)
# Add regression test if this was a bug fix (per CLAUDE.md requirements)

# Re-run verification
make verify

# Re-stage any changes
git add -A

# Once passing, proceed to commit with --no-verify
```

**IMPORTANT**: Don't skip to commit if tests are failing. Fix the issues first.

### If Push Fails

**Remote is ahead:**
```bash
git pull --rebase origin main
# Resolve any conflicts
git push origin main
```

**Authentication issues:**
- Check GitHub credentials/SSH keys
- User may need to authenticate

### If Release Fails

**Uncommitted changes:**
- Should not happen if you followed steps above
- Check `git status` - there may be auto-generated changes

**Test failures during release:**
```bash
# Release script runs tests again
# Fix any issues and re-run release command
make release
```

**Homebrew formula issues:**
- Check `homebrew/juiceit.rb` syntax
- Verify Homebrew tap repository is accessible

## Important Notes

### DO NOT Skip Hooks

Never use `--no-verify` or `--no-gpg-sign` unless explicitly instructed by the user. The pre-commit hooks are there to ensure code quality.

### Commit Message Quality

- Be specific but concise
- Focus on WHAT changed and WHY, not HOW
- Group related changes together
- Use bullet points for multiple changes

### Testing Requirements

Per CLAUDE.md: **Always add tests for bug fixes**. If committing a fix:
1. Verify there's a test that would have caught the bug
2. Verify the test now passes
3. Document this in the commit message

### Version Semantics

Follow semantic versioning (semver):
- **Patch** (1.2.3 → 1.2.4): Bug fixes, no new features
- **Minor** (1.2.3 → 1.3.0): New features, backward compatible
- **Major** (1.2.3 → 2.0.0): Breaking changes

### Global Rules

From `~/.claude/CLAUDE.md`:
- **NEVER** add Co-Authored-By lines for Claude or AI tools
- Commits should only attribute human authors

## Example Execution

**Scenario**: User fixed disc ejection bug and wants to release

```bash
# 1. Analyze changes
git status
# Shows: lib/handbrake.js, test/handbrake.test.js modified

git diff --stat
# Shows changes to ejection logic and tests

# 2. Verify code quality ONCE
git add -A
make verify      # Runs lint + tests
git add -A       # Re-stage any eslint fixes

# 3. Generate commit message
# Type: fix (bug fix)
# Summary: Verify disc ejection actually happens

# 4. Commit with --no-verify (already verified)
git commit --no-verify -m "fix: Verify disc ejection actually happens

The ejectDisc() function now verifies that the disc was physically
ejected instead of just trusting the exit code. Adds auto-detection
of DVD devices and checks device presence before/after ejection.

Changes:
- Add isDvdDevicePresent() helper to check if DVD device exists
- Add findDvdDevice() to auto-detect external DVD drives
- Enhance ejectDisc() to wait and verify ejection succeeded
- Update tests to verify new ejection verification behavior

Fixes issue where ejectDisc reported success but disc remained in drive."

# ✅ Commit succeeds (no hooks run - we already verified)

# 5. Push
git push origin main

# 6. Release (patch - it's a fix)
make release     # Uses --skip-tests flag

# Release script runs:
# - Skips tests (already verified in step 2)
# - Bumps version 1.8.18 → 1.8.19
# - Creates git tag v1.8.19
# - Pushes tag
# - Updates homebrew/juiceit.rb
# - Commits and pushes Homebrew formula

# 7. Verify
git describe --tags
# v1.8.19

# ✅ Release complete!
```

## Summary

This skill automates the complete release workflow while maintaining code quality through pre-commit hooks. It ensures:
- ✅ All changes are committed with clear messages
- ✅ Code passes linting and tests before commit
- ✅ Changes are pushed to remote
- ✅ Appropriate version bump is applied
- ✅ Release is tagged and published
- ✅ Homebrew formula is updated

**Remember**: Let pre-commit hooks do their job - don't skip them!
