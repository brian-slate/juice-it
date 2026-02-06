/**
 * JuiceIt CLI Argument Parser
 *
 * Parses command-line arguments and returns a structured options object.
 */

/**
 * Default options for JuiceIt
 */
const DEFAULT_OPTIONS = {
    outputDir: null,
    dvdSource: null,
    encoding: {
        encoder: 'x264',
        quality: '20',
        deinterlace: true,
    },
    subtitles: {
        track: 1,
        language: 'eng'
    },
    verbose: false,
    ejectOnComplete: true
};

/**
 * Parse command-line arguments
 *
 * @param {string[]} args - Array of command-line arguments (process.argv.slice(2))
 * @returns {Object} Parsed options object
 */
function parseArgs(args) {
    // Clone defaults to avoid mutation
    const options = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));

    // Track which argument indices are consumed as values for flags
    const consumedIndices = new Set();

    // Process command-line arguments
    args.forEach((arg, index) => {
        if (consumedIndices.has(index)) return;

        if (arg === '--help') {
            options.showHelp = true;
        } else if (arg === '--help-dev') {
            options.showHelpDev = true;
        } else if (arg === '--version' || arg === '-v') {
            options.showVersion = true;
        } else if (arg === '--output' && args[index + 1]) {
            options.outputDir = args[index + 1];
            consumedIndices.add(index + 1);
        } else if (arg === '--dvdSource' && args[index + 1]) {
            options.dvdSource = args[index + 1];
            consumedIndices.add(index + 1);
        } else if (arg === '--quality' && args[index + 1]) {
            options.encoding.quality = args[index + 1];
            consumedIndices.add(index + 1);
        } else if (arg === '--no-deinterlace') {
            options.encoding.deinterlace = false;
        } else if (arg === '--subtitles' && args[index + 1]) {
            options.subtitles.track = parseInt(args[index + 1], 10);
            consumedIndices.add(index + 1);
        } else if (arg === '--sub-lang' && args[index + 1]) {
            options.subtitles.language = args[index + 1];
            consumedIndices.add(index + 1);
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--no-lookup') {
            options.noLookup = true;
        } else if (arg === '--rename-only') {
            options.renameOnly = true;
        } else if (arg === '--scan-only') {
            options.scanOnly = true;
        } else if (arg === '--setup') {
            options.runSetup = true;
        } else if (arg === '--plan') {
            options.planOnly = true;
        } else if (arg === '--interactive' || arg === '-i') {
            options.interactive = true;
        } else if (arg === '--diagnose') {
            options.diagnose = true;
        } else if (arg === '--raw') {
            options.rawMode = true;
            options.noLookup = true;
        } else if (arg === '--main-only') {
            options.mainOnly = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--no-eject') {
            options.ejectOnComplete = false;
        } else if (arg.startsWith('-')) {
            // Unknown flag - return error info
            options._unknownArg = arg;
        }
    });

    // Collect positional arguments (non-flag, non-consumed args)
    const positionalArgs = [];
    args.forEach((arg, index) => {
        if (consumedIndices.has(index)) return;
        if (arg.startsWith('-')) return;
        positionalArgs.push(arg);
    });

    // First positional arg(s) become the search query
    if (positionalArgs.length > 0) {
        options.searchQuery = positionalArgs.join(' ');
    }

    return options;
}

/**
 * Handle unknown argument error
 *
 * @param {string} arg - The unknown argument
 */
function handleUnknownArg(arg) {
    console.error(`Error: Unknown option '${arg}'`);
    console.error(`Run 'juice-it --help' for usage information.`);
    process.exit(1);
}

module.exports = {
    DEFAULT_OPTIONS,
    parseArgs,
    handleUnknownArg
};
