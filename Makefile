.PHONY: help test test-core test-prompts test-runtime test-openai demo install reinstall reinstall-release release diagnose

help:
	@echo "JuiceIt Development Commands"
	@echo ""
	@echo "  make install           - Install npm dependencies"
	@echo "  make test              - Run all automated tests"
	@echo "  make test-core         - Run core functionality tests only"
	@echo "  make test-prompts      - Run prompt/schema tests only"
	@echo "  make test-runtime      - Run runtime analysis tests only"
	@echo "  make test-openai       - Run OpenAI API integration tests only"
	@echo "  make demo              - Run interactive mapping demo"
	@echo "  make diagnose          - Run diagnostic mode (analyze disc and mapping)"
	@echo "  make reinstall         - Link to local code (npm link, runs tests first)"
	@echo "  make reinstall-release - Install from latest GitHub release"
	@echo "  make release           - Create a new release (see RELEASE.md)"
	@echo ""
	@echo "Local Development:"
	@echo "  1. make reinstall      (links local code, changes are instant)"
	@echo "  2. Edit code"
	@echo "  3. Test with 'juiceit' or 'juice-it' (no rebuild needed!)"
	@echo ""

install:
	@echo "Installing dependencies..."
	npm install

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

demo:
	npm run demo

diagnose:
	@echo "Running diagnostic mode..."
	@node juiceit.js --diagnose

reinstall:
	@./bin/update-homebrew.sh --local

reinstall-release:
	@./bin/update-homebrew.sh --release

release:
	@echo "Creating release..."
	@echo ""
	@echo "This will run 'npm run release' which requires:"
	@echo "  - Version bumped in package.json"
	@echo "  - GitHub CLI (gh) installed"
	@echo ""
	@echo "For manual release process, see RELEASE.md"
	@echo ""
	@read -p "Continue? (y/N) " answer; \
	if [ "$$answer" = "y" ] || [ "$$answer" = "Y" ]; then \
		npm run release; \
	else \
		echo "Cancelled. See RELEASE.md for manual process."; \
	fi
