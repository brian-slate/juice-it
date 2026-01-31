.PHONY: help test demo install update release

help:
	@echo "JuiceIt Development Commands"
	@echo ""
	@echo "  make test      - Run automated tests"
	@echo "  make demo      - Run interactive mapping demo"
	@echo "  make install   - Install/update Homebrew installation"
	@echo "  make release   - Create a new release (see RELEASE.md for details)"
	@echo ""
	@echo "Local Testing Workflow:"
	@echo "  1. Edit code"
	@echo "  2. Commit changes"
	@echo "  3. make install"
	@echo "  4. Test with 'juiceit' command"
	@echo ""

test:
	npm test

demo:
	npm run demo

install:
	@echo "Updating Homebrew installation..."
	@./bin/update-homebrew.sh

update: install

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
