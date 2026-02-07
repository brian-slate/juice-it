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
  --pricing         Show AI cost estimates for current model
  --setup           Configure API keys (TMDB for metadata, OpenAI for smart naming)
                    First run auto-triggers setup; use this to reconfigure

  --output DIR      Specify the output directory for ripped files
                    Default: Creates folder named "<disc_name>_YYYY-MM-DD_HH-MM-SS"
                    Example: --output "/Movies/My Collection"

  --dvdSource PATH  Specify the DVD drive path (auto-detected if not provided)
                    macOS: Usually /dev/disk2, /dev/disk3, etc.
                    Find yours: Run "drutil status" to see mounted disc path
                    Example: --dvdSource /dev/disk5

  --quality N       Control how much compression is applied to the video
                    This is NOT a percentage - it's a quality target level
                    Lower number = Less compression = Better quality = Bigger files
                    Higher number = More compression = Lower quality = Smaller files

                    Recommended values:
                      18 = Excellent quality, near-DVD quality (~2-3 GB per hour)
                      20 = Great quality, good balance (DEFAULT) (~1.5-2 GB per hour)
                      22 = Good quality, smaller files (~1-1.5 GB per hour)
                      24 = Acceptable quality, very small (~800 MB per hour)

                    Range: 18-28 (going below 18 or above 28 rarely makes sense)
                    Example: --quality 18

  --subtitles N     Subtitle track number to include (default: 1 = first track)
                    Track 1 is usually English, track 2 might be commentary/other
                    Use --scan-only first to see available subtitle tracks
                    Example: --subtitles 2

  --sub-lang CODE   Subtitle language using 3-letter ISO 639-2 code (default: eng)
                    Common codes: eng (English), spa (Spanish), fra (French),
                                  deu (German), jpn (Japanese), por (Portuguese)
                    Example: --sub-lang spa

  --start-episode N Override starting episode number for multi-disc TV sets
                    Use when disc 2+ doesn't start at episode 1
                    Example: Season 5 disc 2 starts at episode 14:
                             juice-it "Show Name s5" --start-episode 14

  --no-deinterlace  Disable deinterlacing (keep interlaced video)
                    Most DVDs need deinterlacing; only disable for progressive content
  --no-lookup       Skip online metadata lookup (use disc name only)
  --rename-only     Only rename existing files using metadata (no ripping)
  --scan-only       Scan disc and show metadata without ripping
  --diagnose        Run diagnostic mode - detailed mapping analysis for debugging
  --verbose         Show detailed technical output (HandBrakeCLI progress, API calls)
  --interactive, -i Full interactive mode (manual track selection and review)

  --raw             Raw rip mode - skip metadata lookup and smart mapping
                    Rips all tracks with simple names (discname_1.mp4, etc.)

  --main-only       Only rip main content (skip extras/bonus features)
                    Movies: Only the main feature (longest track)
                    TV shows: Only episode tracks (intelligently mapped)

  --rip-all         Rip all tracks including Play All compilations
                    Default mode skips Play All but rips other extras
                    This flag rips everything the AI identifies

  --dry-run         Test mode - show what would be ripped without encoding
                    Creates empty placeholder files, useful for testing workflow
  --dry-run-auto    Same as --dry-run but auto-accepts without confirmation prompt

  --tmdb-info       Show TMDB episode data without ripping (useful for debugging)
                    Example: juice-it "Show Name s5 & 6" --tmdb-info

  --no-eject        Don't eject disc after ripping completes (default: ejects when done)
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

/**
 * Show pricing information based on configured model
 */
function showPricing() {
    const pricing = require('./pricing');
    const aiConfig = require('../config/ai-config');

    const pricingData = pricing.loadPricingData();
    const currentModel = aiConfig.model;
    const currentCost = pricing.calculateDiscCost(currentModel);

    console.log('');
    console.log('━'.repeat(60));
    console.log('  💰 JuiceIt AI Pricing');
    console.log('━'.repeat(60));
    console.log('');
    console.log(`  Current Model: ${currentModel}`);
    console.log(`  Cost per Disc: ${currentCost.formattedCost}`);
    console.log('');
    console.log('  Estimated Costs:');
    console.log(`    10 discs:  $${(currentCost.totalCost * 10).toFixed(2)}`);
    console.log(`    50 discs:  $${(currentCost.totalCost * 50).toFixed(2)}`);
    console.log(`    100 discs: $${(currentCost.totalCost * 100).toFixed(2)}`);
    console.log('');
    console.log('  Available Models:');

    const allModels = pricing.getAllModelComparison();
    allModels.forEach(model => {
        const isCurrent = model.model === currentModel ? ' (current)' : '';
        console.log(`    ${model.model}${isCurrent}`);
        console.log(`      ${model.description}`);
        console.log(`      Per disc: ${model.costPerDisc}`);
    });

    console.log('');
    console.log('  💡 Change model in: config/ai-config.js');
    console.log('     Set model: \'gpt-4o-mini\' or \'gpt-4o\'');
    console.log('');
    console.log('  ℹ️  Pricing last updated: ' + pricingData.lastUpdated);
    console.log('     Verify current pricing: https://openai.com/api/pricing/');
    console.log('');
    console.log('  Note: Costs based on typical TV disc (~20 tracks).');
    console.log('        Movies and simple discs use fewer tokens.');
    console.log('━'.repeat(60));
    console.log('');
}

module.exports = {
    showHelp,
    showDeveloperHelp,
    showVersion,
    showPricing
};
