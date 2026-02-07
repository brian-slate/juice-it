.PHONY: help test test-core test-prompts test-runtime test-openai test-query demo install use-local use-homebrew release release-minor release-major diagnose lint verify

help:
	@echo "JuiceIt Development Commands"
	@echo ""
	@echo "Setup & Installation:"
	@echo "  make install          - Install npm dependencies"
	@echo "  make use-local        - Use LOCAL source code (npm link)"
	@echo "  make use-homebrew     - Use HOMEBREW release version"
	@echo ""
	@echo "Testing & Quality:"
	@echo "  make lint             - Run ESLint and auto-fix issues"
	@echo "  make verify           - Run lint + full test suite (USE BEFORE COMMIT)"
	@echo "  make test             - Run all automated tests"
	@echo "  make test-core        - Run core functionality tests only"
	@echo "  make test-prompts     - Run prompt/schema tests only"
	@echo "  make test-runtime     - Run runtime analysis tests only"
	@echo "  make test-openai      - Run OpenAI API integration tests only"
	@echo "  make test-query QUERY=\"your query\" - Test AI query extraction for TMDB"
	@echo "  make demo             - Run interactive mapping demo"
	@echo "  make diagnose         - Run diagnostic mode (analyze disc and mapping)"
	@echo ""
	@echo "Releasing:"
	@echo "  make release          - Create patch release (1.2.3 -> 1.2.4)"
	@echo "  make release-minor    - Create minor release (1.2.3 -> 1.3.0)"
	@echo "  make release-major    - Create major release (1.2.3 -> 2.0.0)"
	@echo ""
	@echo "Typical Workflow:"
	@echo "  1. make use-local     # Switch to local source code"
	@echo "  2. Edit juiceit.js    # Make changes"
	@echo "  3. juice-it --help    # Test immediately (no rebuild!)"
	@echo "  4. make test          # Run tests"
	@echo "  5. make release       # Publish when ready"
	@echo "  6. make use-homebrew  # Switch back to released version"
	@echo ""

install:
	@echo "Installing dependencies..."
	npm install

lint:
	@echo "Running ESLint..."
	@npx eslint . --fix

verify:
	@echo "Verifying code quality..."
	@$(MAKE) lint
	@echo ""
	@$(MAKE) test

test:
	npm test

test-core:
	npm run test:core

test-prompts:
	npm run test:prompts

test-runtime:
	npm run test:runtime

test-openai:
	npm run test:openai

test-query:
	@node test/test-query-extraction.js "$(QUERY)"

demo:
	npm run demo

diagnose:
	@echo "Running diagnostic mode..."
	@node juiceit.js --diagnose

# Use local source code (npm link)
use-local:
	@./bin/update-homebrew.sh --local

# Use Homebrew release version
use-homebrew:
	@./bin/update-homebrew.sh --release

release:
	@./bin/release.sh patch --skip-tests

release-minor:
	@./bin/release.sh minor --skip-tests

release-major:
	@./bin/release.sh major --skip-tests

# Force full validation (run tests even if pre-commit already did)
release-with-tests:
	@./bin/release.sh patch

release-minor-with-tests:
	@./bin/release.sh minor

release-major-with-tests:
	@./bin/release.sh major
