/**
 * JuiceIt Help Text
 *
 * Contains help messages for the CLI.
 */

/**
 * Show main help message
 */
function showHelp() {
    console.log(`
Usage:
  juice-it                              Guided selection (scan disc, pick from results)
  juice-it "title or show info"         Search with your description
  juice-it [options]

Examples:
  juice-it                              # Interactive: scan disc, show matches
  juice-it "Ed, Edd n Eddy season 2"    # TV show with season
  juice-it "Avatar 2009"                # Movie with year
  juice-it "The Office US s03 disc 2"   # Detailed query for AI
  juice-it --raw                        # Skip metadata, use disc name
  juice-it -i                           # Full interactive mode

Options:
  --help            Show this help message
  --setup           Configure API keys (TMDB for metadata, OpenAI for smart naming)
                    First run auto-triggers setup; use this to reconfigure
  --output          Specify the output directory (default: <disc_name>_<date>)
  --dvdSource       Specify the DVD source path (e.g., /dev/disk5)
  --quality         Set the encoding quality (e.g., 20)
  --no-deinterlace  Disable deinterlacing
  --no-lookup       Skip online metadata lookup
  --plan            Create a rip plan and exit (don't rip yet)
  --rename-only     Only rename existing files using metadata (no ripping)
  --scan-only       Scan disc and show metadata without ripping
  --diagnose        Run diagnostic mode - detailed mapping analysis for debugging
  --subtitles       Specify the subtitle track number (default: 1)
  --sub-lang        Specify the subtitle language code (default: eng)
  --verbose         Show detailed technical output
  --interactive, -i Full interactive mode (manual track selection and review)
  --raw             Raw rip mode - skip metadata lookup and smart mapping
                    Rips all tracks with simple names (discname_1.mp4, etc.)
  --main-only       Only rip main content (skip extras/bonus features)
                    Movies: Only the main feature (longest track)
                    TV shows: Only episode tracks (intelligently mapped)
  --start-episode   Override the starting episode number for multi-disc sets
                    Example: juice-it "Show Name s5" --start-episode 14
  --dry-run         Create stub files instead of actual ripping
                    Useful for testing the workflow without waiting for encoding
  --no-eject        Don't eject disc after ripping completes
                    By default, the disc is ejected when done
  --help-dev        Show developer commands (make, npm, testing)
  --version, -v     Show version number
`);
}

/**
 * Show developer help message
 */
function showDeveloperHelp() {
    console.log(`
JuiceIt - Developer Commands

Setup & Installation:
  make help                   Show all make targets
  make install                Install npm dependencies
  make use-local              Use LOCAL source code (npm link)
  make use-homebrew           Use HOMEBREW release version

  Workflow:
    1. make use-local         (switch to local source code)
    2. Edit juiceit.js        (make changes)
    3. juice-it --help        (test immediately, no rebuild!)
    4. make test              (run tests)
    5. make release           (publish when ready)
    6. make use-homebrew      (switch back to released version)

Testing:
  make test                   Run all automated tests
  make test-core              Core functionality tests only
  make test-prompts           Prompt/schema tests only
  make test-runtime           Runtime analysis tests only
  make test-openai            OpenAI API integration tests only
  make demo                   Run interactive mapping demo

Debugging:
  juice-it --diagnose         Detailed mapping analysis for debugging
  juice-it --verbose          Show HandBrakeCLI output during ripping
  juice-it --dry-run          Create stub files instead of encoding

Releasing:
  make release                Create patch release (1.2.3 -> 1.2.4)
  make release-minor          Create minor release (1.2.3 -> 1.3.0)
  make release-major          Create major release (1.2.3 -> 2.0.0)

File Locations:
  Config:     ~/.config/juice-it/config.json
  Cache:      ~/Library/Caches/juice-it/*.json
  Logs:       ./<output_dir>/juiceit_*.log

Cleanup:
  rm -rf test/test-output              Clean test artifacts
  rm -rf ~/Library/Caches/juice-it     Clean disc cache
  rm -rf ~/.config/juice-it            Clean config (removes API keys)

Documentation:
  README.md                   Main documentation
  CONTRIBUTING.md             Development guidelines
`);
}

/**
 * Show version number
 */
function showVersion() {
    const pkg = require('../package.json');
    console.log(`juice-it v${pkg.version}`);
}

module.exports = {
    showHelp,
    showDeveloperHelp,
    showVersion
};
