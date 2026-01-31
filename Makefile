.PHONY: help test demo install reinstall release

help:
	@echo "JuiceIt Development Commands"
	@echo ""
	@echo "  make install    - Install npm dependencies"
	@echo "  make test       - Run automated tests"
	@echo "  make demo       - Run interactive mapping demo"
	@echo "  make reinstall  - Reinstall in Homebrew for local testing"
	@echo "  make release    - Create a new release (see RELEASE.md)"
	@echo ""
	@echo "Local Testing Workflow:"
	@echo "  1. Edit code"
	@echo "  2. Commit changes"
	@echo "  3. make reinstall"
	@echo "  4. Test with 'juiceit' command"
	@echo ""

install:
	@echo "Installing dependencies..."
	npm install

test:
	npm test

demo:
	npm run demo

reinstall:
	@echo "Reinstalling in Homebrew for testing..."
	@./bin/update-homebrew.sh

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
