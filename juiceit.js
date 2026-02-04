#!/usr/bin/env node
/**
 * JuiceIt - Smart DVD Ripper
 *
 * This script rips all tracks from a DVD using HandBrakeCLI.
 *
 * Usage:
 *   juice-it                              Guided selection (scan disc, pick from results)
 *   juice-it "title or show info"         Search with your description
 *   juice-it [options]
 *
 * Examples:
 *   juice-it                              # Interactive: scan disc, show matches
 *   juice-it "Ed, Edd n Eddy season 2"    # TV show with season
 *   juice-it "Avatar 2009"                # Movie with year
 *   juice-it --raw                        # Skip metadata, use disc name
 *   juice-it -i                           # Full interactive mode
 *
 * Requirements:
 *   - Node.js
 *   - HandBrakeCLI
 *   - libdvdcss (for encrypted DVDs)
 */

// ==================== MODULAR IMPORTS ====================

// Logger
const { getLogger } = require('./lib/logger');

// Configuration management
const config = require('./lib/config');

// Plex-compatible naming utilities
const { sanitizeForPlex, calculateProposedName, buildExtrasFileName, buildPlexFolderPath, buildBaseFileName } = require('./lib/naming');

// Display/formatting helpers
const { createProgressBar, formatTime, printBanner, printSeparator } = require('./lib/display');

// DVD detection and scanning
const disc = require('./lib/disc');

// HandBrakeCLI wrapper
const handbrake = require('./lib/handbrake');

// TMDB API module
const tmdb = require('./lib/tmdb');

// AI module
const ai = require('./lib/ai');

// Metadata orchestration
const metadata = require('./lib/metadata');

// Track mapping utilities
const mapping = require('./lib/mapping');

// CLI argument parsing
const cli = require('./lib/cli');

// Help text
const help = require('./lib/help');

// Interactive review workflows
const interactive = require('./lib/interactive');

// Setup wizard
const setup = require('./lib/setup');

// Diagnostic mode
const diagnostic = require('./lib/diagnostic');

// File rename operations
const rename = require('./lib/rename');

// Rip operations
const rip = require('./lib/rip');

// ==================== LOGGING ====================

// Global logger instance - initialized after options are parsed
let logger = null;

// Legacy functions that wrap the new logger (for gradual migration)
function initializeLog(outputDir, volumeName) {
    return logger.initFileLogging(outputDir, volumeName);
}

function log(message) {
    if (logger) {
        logger.fileOnly(message);
    }
}

function closeLog() {
    if (logger) {
        logger.close();
    }
}

// ==================== CONFIG MANAGEMENT ====================

const { load: loadConfig } = config;

// ==================== METADATA LOOKUP ====================

// Initialize TMDB API key from config
const settings = loadConfig();
if (settings.tmdbApiKey) {
    tmdb.setApiKey(settings.tmdbApiKey);
}

// Initialize AI module with required dependencies
// Note: This must happen after logger is initialized (in the main flow)
function initializeAiModule() {
    ai.setConfigLoader(loadConfig);
    ai.setLogFunction(log);
    ai.setOptions(options);
    // Also initialize other modules that need config/log
    metadata.setConfigLoader(loadConfig);
    metadata.setLogFunction(log);
    mapping.setLogFunction(log);
    handbrake.setLogFunction(log);
    interactive.setLogFunction(log);
    interactive.setConfigLoader(loadConfig);
}

// AI functions for test exports
const { analyzeEpisodeRuntimes, countEpisodeLikeTracks } = ai;

// Metadata functions for rename module initialization
const { lookupMetadata } = metadata;

// ==================== ARGUMENT PROCESSING ====================

// Parse command-line arguments using CLI module
const options = cli.parseArgs(process.argv.slice(2));

// Handle unknown arguments
if (options._unknownArg) {
    cli.handleUnknownArg(options._unknownArg);
}

// Initialize the logger with verbosity setting
logger = getLogger({ verbose: options.verbose });

// Initialize the AI module with required dependencies
initializeAiModule();

// Initialize the rename module with required dependencies
rename.setLogger(logger);
rename.setLogFunctions(log, initializeLog, closeLog);
rename.setMetadataLookup(lookupMetadata);

// Initialize the rip module with required dependencies
rip.setLogger(logger);
rip.setLogFunctions(log, initializeLog, closeLog);
rip.setConfigLoader(loadConfig);
rip.setModules({
    disc,
    mapping,
    interactive,
    handbrake,
    metadata,
    ai
});
rip.setDisplayFunctions({
    printBanner,
    printSeparator,
    createProgressBar,
    formatTime
});
rip.setNamingFunctions({
    buildBaseFileName,
    buildPlexFolderPath
});

// ==================== DISC FUNCTIONS (via disc module) ====================

// Skip main execution in test mode - only export test functions
if (process.env.JUICEIT_TEST_MODE === 'true') {
    // Test mode - skip all execution, just export functions for testing
} else {
    // Show help if requested (do this before async operations)
    if (options.showHelp) {
        help.showHelp();
        process.exit(0);
    }

    // Show developer help if requested
    if (options.showHelpDev) {
        help.showDeveloperHelp();
        process.exit(0);
    }

    // Show version if requested
    if (options.showVersion) {
        help.showVersion();
        process.exit(0);
    }

// Check for first-run setup (no config exists yet)
if (config.isFirstRun() && !options.runSetup && !options.showHelp && !options.showVersion && !options.rawMode) {
    (async () => {
        console.log('');
        console.log('━'.repeat(60));
        console.log('  👋 Welcome to JuiceIt!');
        console.log('━'.repeat(60));
        console.log('');
        console.log('  This appears to be your first run.');
        console.log('  Let\'s set up your API keys for the best experience.');
        console.log('');
        await setup.runSetup();
    })();
    // Exit early - setup will guide the user
} else if (options.runSetup) {
    // Run setup if explicitly requested
    (async () => {
        await setup.runSetup();
    })();
    // Exit early - don't continue to ripping
} else if (options.diagnose) {
    // Run diagnostic mode (using lib/diagnostic.js module)
    (async () => {
        await diagnostic.runDiagnosticMode(options);
    })();
} else {
    // Async initialization function
    (async () => {
        // Set dvdSource if not provided
        if (!options.dvdSource) {
            options.dvdSource = await disc.detectDvdSource(options);
        }

    // Fallback if no DVD source is detected
    if (!options.dvdSource) {
        console.log('');
        console.log('  ❌ No DVD Detected');
        console.log('');
        console.log('  Could not find a DVD drive with a disc inserted.');
        console.log('');
        console.log('  What you can try:');
        console.log('    1. Make sure a DVD is inserted and the disc has finished loading');
        console.log('    2. Wait a few seconds and try again');
        console.log('    3. Manually specify the DVD path: juiceit --dvdSource /dev/diskN');
        console.log('');
        console.log('  To find your DVD device, run: diskutil list');
        console.log('');
        process.exit(1);
    }

        // Start the ripping or renaming process
        if (options.renameOnly) {
            await rename.renameExistingFiles(options);
        } else {
            await rip.ripAllTracks(options);
        }
    })();
}
} // End of test mode else block

// ==================== EXPORTS FOR TESTING ====================
// These exports are used by the test suite to verify interactive mode functionality
// They are not part of the public API and may change without notice

if (process.env.JUICEIT_TEST_MODE === 'true') {
    module.exports = {
        // Helper functions (from ai module)
        countEpisodeLikeTracks,
        analyzeEpisodeRuntimes,

        // Mapping functions (from mapping module)
        buildMappingFilename: mapping.buildMappingFilename,
        // Wrapper that reads unrippableTracks from globals for test compatibility
        buildProposedMappingsFromAI: (aiMappingResult, metadata, numTitles, trackDurations) =>
            mapping.buildProposedMappingsFromAI(aiMappingResult, metadata, numTitles, trackDurations, {
                unrippableTracks: global.unrippableTracks || [],
                mainOnly: options.mainOnly
            }),

        // Interactive functions (from interactive module)
        displayMappingTable: interactive.displayMappingTable,
        reviewTmdbMatch: interactive.reviewTmdbMatch,
        reviewTrackMapping: interactive.reviewTrackMapping,
        reviewFinalMappings: interactive.reviewFinalMappings,
        editIndividualTrack: interactive.editIndividualTrack,
        interactiveStepThrough: interactive.interactiveStepThrough,

        // Utility functions (re-exported from naming.js)
        sanitizeForPlex,
        calculateProposedName,
        buildExtrasFileName,

        // For test setup
        _setOptions: (opts) => { Object.assign(options, opts); },
        _setGlobals: (globals) => { Object.assign(global, globals); },
        _getOptions: () => options,
        _initLogger: () => {
            if (!logger) {
                const { getLogger } = require('./lib/logger');
                logger = getLogger();
            }
        }
    };
} else {
    // Check for dependencies before starting (skip in test mode)
    disc.checkHandBrakeCLI();
    disc.checkLibdvdcss();
}