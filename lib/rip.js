/**
 * JuiceIt Rip Operations
 *
 * Handles the main DVD ripping workflow including track scanning,
 * metadata lookup, AI mapping, and HandBrakeCLI encoding.
 */

const path = require('path');
const { Select } = require('enquirer');

// Dependencies injected via setters
let logger = null;
let logFn = () => {};
let initializeLogFn = () => {};
let closeLogFn = () => {};
let configLoader = null;

// Module dependencies (injected)
let discModule = null;
let mappingModule = null;
let interactiveModule = null;
let handbrakeModule = null;
let metadataModule = null;
let aiModule = null;

// Display functions (injected)
let printBannerFn = null;
let printSeparatorFn = null;
let createProgressBarFn = null;
let formatTimeFn = null;

// Naming functions (injected)
let buildBaseFileNameFn = null;
let buildPlexFolderPathFn = null;

/**
 * Set the logger instance
 */
function setLogger(loggerInstance) {
    logger = loggerInstance;
}

/**
 * Set logging functions
 */
function setLogFunctions(log, initializeLog, closeLog) {
    logFn = log;
    initializeLogFn = initializeLog;
    closeLogFn = closeLog;
}

/**
 * Set config loader function
 */
function setConfigLoader(loader) {
    configLoader = loader;
}

/**
 * Set module dependencies
 */
function setModules(modules) {
    discModule = modules.disc;
    mappingModule = modules.mapping;
    interactiveModule = modules.interactive;
    handbrakeModule = modules.handbrake;
    metadataModule = modules.metadata;
    aiModule = modules.ai;
}

/**
 * Set display functions
 */
function setDisplayFunctions(fns) {
    printBannerFn = fns.printBanner;
    printSeparatorFn = fns.printSeparator;
    createProgressBarFn = fns.createProgressBar;
    formatTimeFn = fns.formatTime;
}

/**
 * Set naming functions
 */
function setNamingFunctions(fns) {
    buildBaseFileNameFn = fns.buildBaseFileName;
    buildPlexFolderPathFn = fns.buildPlexFolderPath;
}

/**
 * Wrapper for handbrake.ripDvd - bridges interface to module
 */
function ripDvd(options, titleNumber, outputFileName, trackNum, totalTracks, onProgress, titleDurations) {
    const ripOptions = {
        dvdSource: options.dvdSource,
        titleNumber,
        outputDir: options.outputDir,
        outputFileName,
        encoding: options.encoding,
        subtitles: options.subtitles,
        dryRun: options.dryRun,
        titleDurations: titleDurations || {}
    };
    return handbrakeModule.ripDvd(ripOptions, onProgress, trackNum, totalTracks);
}

/**
 * Main ripping workflow
 *
 * @param {Object} options - CLI options
 * @returns {Promise<Object>} Result with successCount, skippedTracks, mappingSkippedTracks
 */
async function ripAllTracks(options) {
    let logFilePath = null;
    let successCount = 0;

    // Local state - no globals
    let titleDurations = {};
    let unrippableTracks = [];
    const skippedTracks = []; // Tracks that failed during ripping
    const mappingSkippedTracks = []; // Tracks skipped due to AI mapping (menus, extras, etc.)
    const autoModeWarnings = []; // Warnings from automatic mode

    try {
        const volumeName = discModule.getVolumeName(options.dvdSource);

        // Set default output directory before any operations
        options.outputDir = discModule.setDefaultOutputDir(volumeName, options.outputDir);

        // Initialize file logging early so scan operations are logged
        logFilePath = initializeLogFn(options.outputDir, volumeName);
        logFn(`JuiceIt session started - Volume: ${volumeName}, Source: ${options.dvdSource}`);
        logFn(`Options: scanOnly=${options.scanOnly}, verbose=${options.verbose}, interactive=${options.interactive}`);

        printBannerFn(volumeName); // Show the banner

        // Show smart mapping/mode status after banner
        const config = configLoader();
        if (options.rawMode) {
            // Raw mode message will be shown later
        } else if (!config.openaiApiKey) {
            console.log('  ℹ️  Smart mapping: disabled (no API key)');
            console.log('     Run "juiceit --setup" to enable automatic track mapping');
            console.log('');
        } else {
            console.log('  ✓ Smart mapping: enabled');
            console.log('');
        }

        // Scan disc - store results locally, not in globals
        const scanResult = await discModule.scanDisc(options.dvdSource, volumeName, options);
        const numTitles = scanResult.numTitles;
        titleDurations = scanResult.titleDurations;
        unrippableTracks = scanResult.unrippableTracks;

        if (numTitles === 0) {
            console.log('');
            console.log('  ❌ No Titles Found');
            console.log('');
            console.log('  Could not find any video titles on this disc.');
            console.log('');
            console.log('  Possible causes:');
            console.log('    • The disc may be damaged or dirty');
            console.log('    • The disc format may not be supported');
            console.log('    • The disc may still be loading (wait and try again)');
            console.log('');
            console.log('  What you can try:');
            console.log('    1. Clean the disc and try again');
            console.log('    2. Run with --verbose for more details: juiceit --verbose');
            console.log('');
            logFn('No titles found on disc');
            return { successCount: 0, skippedTracks, mappingSkippedTracks };
        }

        // Get lsdvd metadata early for context in AI decisions
        // This provides disc title, chapter counts, and track details that help with TMDB selection
        let lsdvdMetadata = null;
        if (!options.rawMode) {
            lsdvdMetadata = discModule.getLsdvdMetadata(options.dvdSource);
            if (options.verbose && lsdvdMetadata) {
                console.log('[lsdvd] Extended metadata collected for smart mapping');
            }
        }

        // Lookup metadata unless disabled (pass track durations for AI)
        let metadata = null;
        let proposedMappingsFromStepThrough = null;

        if (options.rawMode) {
            // Raw mode: skip all metadata lookup, just use simple track names
            console.log('');
            console.log('  📀 Raw Rip Mode');
            console.log('');
            console.log('  Skipping metadata lookup and smart mapping.');
            console.log('  Tracks will be named: ' + volumeName + '_1.mp4, ' + volumeName + '_2.mp4, etc.');
            console.log('');
            logger.debug('Raw mode enabled - skipping metadata lookup');
            metadata = { type: 'raw', volumeName };
        } else if (options.interactive && options.searchQuery) {
            // ENHANCED INTERACTIVE MODE: step-through with review points
            // This mode provides review/adjustment points after each AI decision
            logger.debug('Using enhanced interactive step-through mode');
            logFn('Using enhanced interactive step-through mode');

            const result = await interactiveModule.interactiveStepThrough(
                volumeName,
                numTitles,
                titleDurations,
                lsdvdMetadata,
                { searchQuery: options.searchQuery }
            );

            if (!result) {
                console.log('\n  ✓ Operation cancelled\n');
                return { successCount: 0, skippedTracks, mappingSkippedTracks };
            }

            metadata = result.metadata;
            proposedMappingsFromStepThrough = result.proposedMappings;
        } else if (!options.noLookup) {
            const hasUserQuery = !!options.searchQuery;
            const isInteractive = options.interactive;

            if (!hasUserQuery && !isInteractive) {
                // Naked invocation: show guided selection menu
                metadata = await metadataModule.guidedMetadataSelection(volumeName, numTitles, titleDurations);
                if (!metadata) {
                    console.log('\n  Selection cancelled.\n');
                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                }
            } else {
                // User provided query or --interactive (without query): existing behavior
                metadata = await metadataModule.lookupMetadata(volumeName, numTitles, titleDurations, {
                    searchQuery: options.searchQuery
                }, lsdvdMetadata);
                if (!metadata) {
                    console.log('\n  Selection cancelled.\n');
                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                }
            }
        } else {
            metadata = { type: 'disc', volumeName };
        }

        // If scan-only mode, display metadata and exit
        if (options.scanOnly) {
            console.log('');
            printSeparatorFn();
            console.log('  📋 Metadata Summary');
            printSeparatorFn();
            if (metadata.type === 'tv') {
                console.log(`  Type:    TV Show`);
                console.log(`  Title:   ${metadata.name}`);
                console.log(`  Season:  ${metadata.season}`);
                if (metadata.episodes) {
                    console.log(`  Episodes: ${metadata.episodes.length}`);
                    console.log('');
                    console.log('  Episode List:');
                    metadata.episodes.forEach((ep, i) => {
                        console.log(`    ${i + 1}. S${String(metadata.season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')} - ${ep.name} (${ep.runtime} min)`);
                    });
                }
            } else if (metadata.type === 'movie') {
                console.log(`  Type:  Movie`);
                console.log(`  Title: ${metadata.name}`);
                if (metadata.year) {
                    console.log(`  Year:  ${metadata.year}`);
                }
            } else {
                console.log(`  Type:  Using disc name`);
                console.log(`  Title: ${metadata.volumeName || volumeName}`);
            }
            printSeparatorFn();
            console.log('');
            console.log('✅ Scan complete. Run without --scan-only to start ripping.');
            console.log('');
            return { successCount: 0, skippedTracks, mappingSkippedTracks };
        }

        logFilePath = initializeLogFn(options.outputDir, volumeName); // Initialize the log

        // Log DVD track durations if available
        if (titleDurations) {
            logFn('DVD Track Durations:');
            Object.entries(titleDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([track, duration]) => {
                logFn(`  Track ${track}: ${duration} minutes`);
            });
        }

        logFn(`Metadata: ${JSON.stringify(metadata)}`);

        // Determine base file name based on metadata (Plex-compatible format)
        // Using let since it may be overwritten from existing plan
        let baseFileName = buildBaseFileNameFn(metadata, volumeName);

        // Check for existing plan (skip if we came from step-through mode)
        const existingPlan = proposedMappingsFromStepThrough ? null : mappingModule.loadPlan(options.outputDir);
        let proposedMappings = proposedMappingsFromStepThrough || [];

        if (existingPlan) {
            console.log('');
            console.log('📄 Found existing rip plan!');
            console.log(`   Created: ${new Date(existingPlan.createdAt).toLocaleString()}`);
            console.log(`   Tracks to rip: ${existingPlan.mappings.filter(m => m.status !== 'skip').length}`);
            console.log('');

            try {
                const usePlanPrompt = new Select({
                    message: 'What would you like to do?',
                    choices: [
                        'Use existing plan and start ripping',
                        'Review/edit existing plan',
                        'Delete and create new plan'
                    ]
                });

                const choice = await usePlanPrompt.run();

                if (choice === 'Use existing plan and start ripping') {
                    proposedMappings = mappingModule.mappingsFromPlan(existingPlan, true);
                    metadata = existingPlan.metadata;
                    baseFileName = existingPlan.baseFileName;
                    console.log('\n✓ Using existing plan, starting rip...\n');
                    logFn('Using existing rip plan, skipping review');
                } else if (choice === 'Review/edit existing plan') {
                    proposedMappings = mappingModule.mappingsFromPlan(existingPlan, false);
                    metadata = existingPlan.metadata;
                    baseFileName = existingPlan.baseFileName;
                    console.log('\n✓ Loading plan for review...\n');
                    logFn('Loading existing plan for review');
                } else {
                    mappingModule.deletePlan(options.outputDir);
                    console.log('\n✓ Deleted existing plan, creating new...\n');
                    logFn('User chose to delete plan and create new');
                }
            } catch (error) {
                console.log('\nCancelled.\n');
                return { successCount: 0, skippedTracks, mappingSkippedTracks };
            }
        }

        // If no plan loaded, create new mappings
        if (proposedMappings.length === 0) {
            // Try AI-powered track mapping if available
            let aiMappingResult = null;
            let useSequentialMapping = false;

            if (config.openaiApiKey && titleDurations && metadata.type === 'tv') {
                // Note: lsdvdMetadata was already retrieved earlier for TMDB selection context

                // Attempt smart mapping with retry loop on failure
                let retryAttempt = 0;
                const maxAutoRetries = 2; // Auto-retry up to 2 times in automatic mode

                while (!aiMappingResult && !useSequentialMapping) {
                    aiMappingResult = await aiModule.aiMapTracks(titleDurations, metadata, lsdvdMetadata, unrippableTracks || [], metadata.discNumber, volumeName);

                    if (!aiMappingResult) {
                        logFn('ERROR: Smart mapping failed');

                        if (options.interactive) {
                            // Interactive mode: ask user what to do
                            console.log('');
                            console.log('  ❌ Smart mapping failed!');
                            console.log('');

                            const failureMenu = new Select({
                                message: 'How would you like to proceed?',
                                choices: [
                                    { name: 'Retry smart mapping', value: 'retry' },
                                    { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - NOT RECOMMENDED', value: 'sequential' },
                                    { name: 'Cancel and exit', value: 'cancel' }
                                ]
                            });

                            try {
                                const choice = await failureMenu.run();
                                if (choice === 'retry') {
                                    retryAttempt++;
                                    console.log(`\n  🔄 Retrying smart mapping (attempt ${retryAttempt + 1})...\n`);
                                    logFn(`Retrying smart mapping, attempt ${retryAttempt + 1}`);
                                    continue;
                                } else if (choice === 'sequential') {
                                    console.log('\n  ⚠️  Using sequential mapping - this may produce incorrect results!\n');
                                    logFn('User chose sequential mapping after smart mapping failure');
                                    useSequentialMapping = true;
                                } else {
                                    console.log('\n  ✓ Cancelled.\n');
                                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                                }
                            } catch (err) {
                                console.log('\n  ✓ Cancelled.\n');
                                return { successCount: 0, skippedTracks, mappingSkippedTracks };
                            }
                        } else {
                            // Automatic mode: auto-retry a few times, then fallback
                            retryAttempt++;
                            if (retryAttempt <= maxAutoRetries) {
                                console.log(`  ⚠️  Smart mapping failed, retrying (${retryAttempt}/${maxAutoRetries})...`);
                                logFn(`Auto-retrying smart mapping, attempt ${retryAttempt}`);
                                continue;
                            }

                            // All retries exhausted - fallback to sequential
                            console.log('');
                            console.log('  ⚠️  Smart Mapping Failed');
                            console.log('');
                            console.log('  Could not intelligently map DVD tracks to episodes.');
                            console.log('  This can happen due to network issues or API problems.');
                            console.log('');
                            console.log('  Falling back to sequential mapping (Track 1→Episode 1, etc.)');
                            console.log('');
                            console.log('  ⚠️  WARNING: Episode assignments may be incorrect!');
                            console.log('');
                            console.log('  For better results, try:');
                            console.log('    • Run again later (if this was a temporary issue)');
                            console.log('    • Run: juiceit --interactive  (to manually verify assignments)');
                            console.log('');
                            logFn('Auto mode: Smart mapping failed, using sequential fallback');
                            useSequentialMapping = true;
                            autoModeWarnings.push('Smart mapping failed - used sequential mapping (episodes may be mislabeled)');
                        }
                    }
                }
            } else if (metadata.type === 'tv' && !config.openaiApiKey) {
                // No OpenAI key configured
                if (options.interactive) {
                    // Interactive mode: ask user what to do
                    console.log('');
                    console.log('  ⚠️  Smart mapping not available (no OpenAI API key configured)');
                    console.log('  ⚠️  Without smart mapping, track-to-episode mapping may be incorrect.');
                    console.log('');

                    const noAiMenu = new Select({
                        message: 'How would you like to proceed?',
                        choices: [
                            { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - may be incorrect', value: 'sequential' },
                            { name: 'Cancel and configure smart mapping (run: juiceit --setup)', value: 'cancel' }
                        ]
                    });

                    try {
                        const choice = await noAiMenu.run();
                        if (choice === 'sequential') {
                            console.log('\n  ⚠️  Using sequential mapping...\n');
                            logFn('User chose sequential mapping (no API key)');
                            useSequentialMapping = true;
                        } else {
                            console.log('\n  ℹ️  Run `juiceit --setup` to configure your OpenAI API key.\n');
                            return { successCount: 0, skippedTracks, mappingSkippedTracks };
                        }
                    } catch (err) {
                        console.log('\n  ✓ Cancelled.\n');
                        return { successCount: 0, skippedTracks, mappingSkippedTracks };
                    }
                } else {
                    // Automatic mode: continue with sequential mapping, but warn clearly
                    console.log('');
                    console.log('  ⚠️  Smart Mapping Not Configured');
                    console.log('');
                    console.log('  Intelligent episode mapping is not available.');
                    console.log('  Using sequential mapping (Track 1→Episode 1, Track 2→Episode 2, etc.)');
                    console.log('');
                    console.log('  ⚠️  WARNING: This may result in incorrect episode assignments!');
                    console.log('     DVDs often have menus, extras, or out-of-order episodes.');
                    console.log('');
                    console.log('  For better results:');
                    console.log('    • Run: juiceit --setup  (to add OpenAI API key)');
                    console.log('    • Or run: juiceit --interactive  (to manually review assignments)');
                    console.log('');
                    logFn('Auto mode: Using sequential mapping (no API key configured)');
                    useSequentialMapping = true;
                    autoModeWarnings.push('Smart mapping not configured - used sequential mapping (episodes may be mislabeled)');
                }
            } else {
                // Movie or no track durations - sequential is fine
                useSequentialMapping = true;
            }

            // For movies: determine the main feature track (longest track)
            const mainFeatureTrack = metadata.type === 'movie' ? mappingModule.findMainFeatureTrack(titleDurations) : null;
            if (mainFeatureTrack) {
                const duration = titleDurations[mainFeatureTrack];
                logger.debug(`[Movie] Main feature track: ${mainFeatureTrack} (${duration} min)`);
                logFn(`Movie mode: Main feature is Track ${mainFeatureTrack} (${duration} min)`);
            }

            // Build proposed mappings using mapping module
            if (aiMappingResult) {
                proposedMappings = mappingModule.buildProposedMappingsFromAI(
                    aiMappingResult, metadata, numTitles, titleDurations,
                    { mainOnly: options.mainOnly, unrippableTracks }
                );
            } else {
                proposedMappings = mappingModule.buildSequentialMappings(
                    metadata, numTitles, titleDurations,
                    { mainOnly: options.mainOnly, unrippableTracks, mainFeatureTrack }
                );
            }

            // AI-powered validation of episode mapping results (TV shows only)
            // Let AI be the sole decision-maker for what warnings to show
            if (metadata.type === 'tv' && metadata.episodes && aiMappingResult && aiMappingResult.mappings && !options.interactive) {
                // Build comprehensive extractedInfo for validation context
                const validationExtractedInfo = {
                    searchQuery: metadata.name,
                    season: metadata.season,
                    disc: metadata.discNumber || null,
                    isTV: true,
                    isBoxSet: metadata.discNumber ? true : false,
                    confidence: 1.0 // We have confirmed metadata at this point
                };

                const validationResult = await aiModule.aiValidateMappingResults({
                    volumeName,
                    numTitles,
                    trackDurations: titleDurations,
                    userQuery: options.searchQuery,
                    extractedInfo: validationExtractedInfo,
                    matchedTitle: metadata.name,
                    matchedType: 'tv',
                    seasonNumber: metadata.season,
                    totalEpisodes: metadata.episodes.length,
                    mappingResults: aiMappingResult,
                    episodes: metadata.episodes  // TMDB episode list for cross-reference
                });

                // AI determines all warnings - no procedural pre-filtering
                if (validationResult) {
                    logger.debug(`[AI] Mapping validation: isValid=${validationResult.isValid}`);
                    logger.debug(`[AI] Summary: ${validationResult.summary}`);
                    if (validationResult.expectedOnDisc) {
                        logger.debug(`[AI] Expected on disc: ${validationResult.expectedOnDisc}`);
                    }

                    // Add any concerns the AI identified as warnings/errors
                    if (validationResult.concerns && validationResult.concerns.length > 0) {
                        const actionableConcerns = validationResult.concerns.filter(
                            c => c.severity === 'error' || c.severity === 'warning'
                        );
                        if (actionableConcerns.length > 0) {
                            for (const concern of actionableConcerns) {
                                autoModeWarnings.push(concern.message);
                            }
                        }
                    }
                }
            }
        } // End of "if no plan loaded" block

        // Interactive review BEFORE ripping (skip if using existing plan directly or in raw mode)
        let mappingsToRip;
        const skipReview = options.rawMode ||
            (existingPlan && proposedMappings.some(m => m.status !== 'pending' && m.status !== 'skip'));

        if (skipReview) {
            // Raw mode or already finalized from existing plan
            mappingsToRip = proposedMappings;
            // Finalize all pending mappings for raw mode
            if (options.rawMode) {
                for (const m of mappingsToRip) {
                    if (m.status === 'pending') {
                        m.status = m.proposedName;
                    }
                }
                logger.debug('Raw mode: auto-finalized all track mappings');
            } else {
                logFn('Skipping review - using finalized plan');
            }
        } else {
            console.log('');
            mappingsToRip = await interactiveModule.reviewAndMapEpisodesBeforeRip(
                proposedMappings, metadata, volumeName, baseFileName,
                { interactive: options.interactive, planOnly: options.planOnly, verbose: options.verbose }
            );

            if (!mappingsToRip || mappingsToRip.length === 0) {
                console.log('');
                console.log('  ℹ️  Ripping cancelled.');
                console.log('');
                return { successCount: 0, skippedTracks, mappingSkippedTracks };
            }
        }

        console.log('');
        printSeparatorFn();
        if (options.dryRun) {
            console.log('  🧪 DRY-RUN MODE - Creating stub files (no actual ripping)');
        } else {
            console.log('  🎬 Starting rip...');
        }
        printSeparatorFn();
        console.log('');

        // Show movie-specific info
        if (metadata.type === 'movie') {
            const mainTrack = mappingsToRip.find(m => m.status !== 'skip' && m.status !== 'unrippable' && m.aiReasoning === 'Main feature (longest track)');
            const extrasToRip = mappingsToRip.filter(m => m.status !== 'skip' && m.status !== 'unrippable' && m.aiReasoning && (m.aiReasoning.includes('featurette') || m.aiReasoning.includes('bonus'))).length;
            const extrasSkipped = mappingsToRip.filter(m => m.status === 'skip').length;
            const unrippableCount = mappingsToRip.filter(m => m.status === 'unrippable').length;

            if (mainTrack) {
                console.log(`  🎬 Movie: Ripping main feature (Track ${mainTrack.trackNum}, ${mainTrack.duration} min)`);
                if (extrasToRip > 0) {
                    console.log(`     Plus ${extrasToRip} bonus track(s) as featurettes`);
                }
                if (extrasSkipped > 0 && options.mainOnly) {
                    console.log(`     ${extrasSkipped} extra track(s) skipped (--main-only mode)`);
                }
                if (unrippableCount > 0) {
                    console.log(`     ${unrippableCount} track(s) unrippable (copy-protected/invalid)`);
                }
                console.log('');
            }
        }

        // Log final mapping table before ripping
        logFn('=== FINAL TRACK TO FILENAME MAPPINGS ===');
        for (const m of mappingsToRip) {
            let status;
            if (m.status === 'skip') {
                status = 'SKIP';
            } else if (m.status === 'unrippable') {
                status = 'UNRIPPABLE';
            } else {
                status = m.status;
            }
            logFn(`Track ${m.trackNum} (${m.duration} min) → ${status}`);
        }
        logFn('=== END FINAL MAPPINGS ===');

        // Rip tracks (skip those marked as skip or unrippable)
        for (const m of mappingsToRip) {
            if (m.status === 'skip') {
                // Track this as a mapping-skipped track
                mappingSkippedTracks.push({
                    track: m.trackNum,
                    duration: m.duration,
                    reason: m.aiReasoning || 'AI marked as menu/extra'
                });
                continue;
            }

            if (m.status === 'unrippable') {
                // Never attempt unrippable tracks
                logger.debug(`Track ${m.trackNum}: Not attempting (unrippable - ${m.aiReasoning})`);
                continue;
            }

            const titleNumber = m.trackNum;
            const finalFileName = m.status; // status contains the final filename

            console.log(`  ⚙️  Track ${titleNumber} of ${numTitles}: ${finalFileName}`);

            try {
                await ripDvd(options, titleNumber, finalFileName.replace('.mp4', ''), titleNumber, numTitles, (progress, elapsed, remaining, _trackNum, _totalTracks) => {
                    // Overwrite the same line for progress updates
                    const progressBar = createProgressBarFn(progress);
                    const elapsedStr = formatTimeFn(elapsed);
                    const remainingStr = remaining > 0 ? formatTimeFn(remaining) : 'calculating...';
                    process.stdout.write(`\r      ${progressBar} | ${elapsedStr} elapsed | ~${remainingStr} remaining`);
                }, titleDurations);

                // Clear the progress line and show completion
                process.stdout.write('\r' + ' '.repeat(100) + '\r');
                console.log(`      ${createProgressBarFn(100)} | Complete!`);
                const relativePath = path.relative(process.cwd(), path.join(options.outputDir, finalFileName));
                console.log(`      ✓ Saved to ${relativePath}`);
                console.log('');

                successCount++;
            } catch (error) {
                // Clear the progress line
                process.stdout.write('\r' + ' '.repeat(100) + '\r');

                // Determine skip reason from error output
                let skipReason = 'Unknown error';
                if (error.errorOutput) {
                    if (error.errorOutput.includes('No title found')) {
                        skipReason = 'No valid title found';
                    } else if (error.errorOutput.includes('scan: unrecognized file type')) {
                        skipReason = 'Unrecognized or corrupted track';
                    } else {
                        skipReason = `HandBrakeCLI error (exit code ${error.code})`;
                    }
                }

                console.log(`      ⏭  Skipped (${skipReason})`);
                console.log('');
                skippedTracks.push({ track: titleNumber, reason: skipReason });
                logFn(`Skipped track ${titleNumber}: ${skipReason}`);
            }
        }

        printSeparatorFn();
        // Exclude both 'skip' (AI-mapped extras) and 'unrippable' (copy-protected) from count
        const totalToRip = mappingsToRip.filter(m => m.status !== 'skip' && m.status !== 'unrippable').length;
        const unrippableCount = mappingsToRip.filter(m => m.status === 'unrippable').length;

        if (successCount === totalToRip) {
            console.log('  ⚡ All tracks ripped successfully!');
            if (unrippableCount > 0) {
                console.log(`     (${unrippableCount} copy-protected track${unrippableCount > 1 ? 's were' : ' was'} not attempted)`);
            }
        } else if (successCount > 0) {
            console.log(`  ⚡ Ripping complete: ${successCount} of ${totalToRip} tracks successful`);
            if (skippedTracks.length > 0) {
                console.log('');
                console.log(`  ❌ ${skippedTracks.length} track(s) failed during ripping:`);
                skippedTracks.forEach(({ track, reason }) => {
                    console.log(`     • Track ${track}: ${reason}`);
                });
            }
            if (unrippableCount > 0) {
                console.log(`     (${unrippableCount} copy-protected track${unrippableCount > 1 ? 's were' : ' was'} not attempted)`);
            }
        } else {
            console.log('  ✗ No tracks were successfully ripped');
        }
        printSeparatorFn();
        console.log('');

        logFn('Ripping completed');
        logFn(`Successfully ripped: ${successCount}/${totalToRip} tracks`);
        if (skippedTracks.length > 0) {
            logFn(`Failed tracks: ${JSON.stringify(skippedTracks)}`);
        }
        if (mappingSkippedTracks.length > 0) {
            logFn(`Mapping-skipped tracks: ${JSON.stringify(mappingSkippedTracks)}`);
        }

        console.log('');
        if (logFilePath) {
            const relativeLogPath = path.relative(process.cwd(), logFilePath);
            console.log(`  📄 Log: ${relativeLogPath}`);
        }
        console.log('');

        if (skippedTracks.length > 0) {
            console.log('  💡 Check the log file for detailed error information');
            console.log('');
        }

        // Show Plex folder recommendation if we have metadata with TMDB ID
        const plexPath = buildPlexFolderPathFn(metadata);
        if (plexPath && successCount > 0) {
            printSeparatorFn();
            console.log('  📂 Plex Folder Structure');
            printSeparatorFn();
            console.log('');
            console.log('  For Plex to correctly identify this content, use:');
            console.log('');
            if (metadata.type === 'tv') {
                console.log(`    TV Shows/`);
                console.log(`      └── ${plexPath.showFolder}/`);
                console.log(`            └── ${plexPath.seasonFolder}/`);
                console.log(`                  └── [your ripped files]`);
            } else {
                console.log(`    Movies/`);
                console.log(`      └── ${plexPath.showFolder}/`);
                console.log(`            └── [your ripped file]`);
            }
            console.log('');
            if (metadata.tmdbId) {
                console.log(`  The {tmdb-${metadata.tmdbId}} tag ensures exact matching in Plex.`);
            }
            console.log('');
        }

        // Show summary of tracks skipped due to mapping (menus, extras, etc.)
        if (mappingSkippedTracks.length > 0 && !options.includeExtras) {
            printSeparatorFn();
            console.log('  📋 Tracks Not Ripped (Extras/Menus)');
            printSeparatorFn();
            console.log('');
            console.log(`  ${mappingSkippedTracks.length} track(s) were skipped:`);
            console.log('');
            mappingSkippedTracks.forEach(({ track, duration, reason }) => {
                const shortReason = reason && reason.length > 50 ? reason.substring(0, 47) + '...' : reason;
                console.log(`    • Track ${track} (${duration} min): ${shortReason || 'menu/extra'}`);
            });
            console.log('');
            if (options.mainOnly) {
                console.log('  💡 To also rip extras, remove the --main-only flag:');
                console.log('');
                console.log('     juiceit');
                console.log('');
            }
            console.log('     Or for a raw rip of everything:');
            console.log('     juiceit --raw');
            console.log('');
        }

        // Show summary of any automatic mode warnings
        if (autoModeWarnings.length > 0) {
            printSeparatorFn();
            console.log('  ⚠️  IMPORTANT - Review Needed');
            printSeparatorFn();
            console.log('');
            console.log('  The following issues occurred during automatic processing:');
            console.log('');
            autoModeWarnings.forEach(warning => {
                console.log(`    • ${warning}`);
            });
            console.log('');
            console.log('  Recommendations:');
            console.log('    1. Review the ripped files to verify they are correct');
            console.log('    2. For more control, use: juiceit --interactive');
            console.log('    3. For smart mapping, run: juiceit --setup');
            console.log('');
        }

        return { successCount, skippedTracks, mappingSkippedTracks };
    } catch (error) {
        logger.error(`\n❌ Error during ripping: ${error}\n`);
        logFn(`Fatal error: ${error}`);
        return { successCount, skippedTracks, mappingSkippedTracks };
    } finally {
        closeLogFn();
    }
}

module.exports = {
    setLogger,
    setLogFunctions,
    setConfigLoader,
    setModules,
    setDisplayFunctions,
    setNamingFunctions,
    ripAllTracks
};
