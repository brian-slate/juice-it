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

        printBannerFn(volumeName, options.outputDir, options.encoding?.quality || 20); // Show the banner

        // Show smart mapping/mode status after banner
        const config = configLoader();
        // Full smart mode requires BOTH OpenAI (for track mapping) and TMDB (for metadata lookup)
        const hasFullSmartMode = !!(config.openaiApiKey && config.tmdbApiKey);
        const hasTmdbOnly = !config.openaiApiKey && config.tmdbApiKey;

        if (options.rawMode) {
            // Raw mode message will be shown later
        } else if (!hasFullSmartMode) {
            if (hasTmdbOnly) {
                console.log('  ℹ️  Smart mapping: disabled (no OpenAI key)');
                console.log('     TMDB lookups available. Run "juice-it --setup" for full smart mapping.');
            } else if (config.openaiApiKey && !config.tmdbApiKey) {
                console.log('  ℹ️  Smart mapping: disabled (no TMDB key)');
                console.log('     Run "juice-it --setup" to configure API keys.');
            } else {
                console.log('  ℹ️  Smart mapping: disabled (no API keys)');
                console.log('     Run "juice-it --setup" to enable automatic track mapping.');
            }
            console.log('');
        } else {
            console.log('  ✓ Smart mapping: enabled');
            console.log('');
        }

        // Scan disc with dual-tool validation - store results locally, not in globals
        const scanResult = await discModule.scanDiscWithValidation(options.dvdSource, volumeName, options);
        const numTitles = scanResult.numTitles;
        titleDurations = scanResult.titleDurations;
        unrippableTracks = scanResult.unrippableTracks;
        const scanWarning = scanResult.scanWarning;
        const enhancedTrackData = scanResult.enhancedTrackData || null;

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
            console.log('    2. Run with --verbose for more details: juice-it --verbose');
            console.log('');
            logFn('No titles found on disc');
            return { successCount: 0, skippedTracks, mappingSkippedTracks };
        }

        // Add scan warning if lsdvd and HandBrake disagreed on track count
        if (scanWarning) {
            autoModeWarnings.push(scanWarning);
        }

        // Use lsdvd data from scan result (already collected during dual-scan validation)
        // If not available from scan, get it separately for disc pattern extraction
        let lsdvdMetadata = scanResult.lsdvdData || null;
        if (!lsdvdMetadata && !options.rawMode) {
            lsdvdMetadata = discModule.getLsdvdMetadata(options.dvdSource, volumeName);
        }
        // Add disc pattern extraction if not already present
        if (lsdvdMetadata && !lsdvdMetadata.discPatterns) {
            lsdvdMetadata.discPatterns = discModule.parseDiscPatternFromTitle(lsdvdMetadata.discTitle, volumeName);
        }
        if (options.verbose && lsdvdMetadata) {
            console.log('[lsdvd] Extended metadata collected for smart mapping');
            if (lsdvdMetadata.discPatterns?.patterns?.length > 0) {
                console.log('[lsdvd] Disc patterns detected:', lsdvdMetadata.discPatterns.patterns.map(p => p.raw).join(', '));
            }
            if (enhancedTrackData) {
                console.log(`[lsdvd] Enhanced track data: ${enhancedTrackData.length} tracks with chapter info`);
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
                { searchQuery: options.searchQuery, unrippableTracks, enhancedTrackData }
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
                // Naked invocation: try best-effort auto-detection if full smart mode is available
                // Full smart mode requires BOTH OpenAI (for detection) AND TMDB (for lookup)
                // Otherwise, proceed with generic track naming (no interactive prompts)

                if (hasFullSmartMode && lsdvdMetadata && lsdvdMetadata.discTitle) {
                    // Try AI-based query extraction from disc title
                    console.log('');
                    console.log('  🔍 Analyzing disc for auto-detection...');
                    const discQuery = lsdvdMetadata.discTitle;
                    const extractedInfo = await aiModule.aiExtractSearchQuery(discQuery);

                    if (extractedInfo && extractedInfo.confidence >= 0.7) {
                        // Confident - proceed with auto lookup
                        console.log(`   ✓ Detected: "${extractedInfo.searchQuery}" (${Math.round(extractedInfo.confidence * 100)}% confidence)`);
                        if (extractedInfo.season) {
                            console.log(`   ✓ Season: ${extractedInfo.season}`);
                        }
                        if (extractedInfo.disc) {
                            console.log(`   ✓ Disc: ${extractedInfo.disc}`);
                        }

                        metadata = await metadataModule.lookupMetadata(
                            volumeName, numTitles, titleDurations,
                            { searchQuery: extractedInfo.searchQuery, extractedInfo },
                            lsdvdMetadata
                        );

                        if (metadata) {
                            // Success - continue with this metadata
                            logFn(`Best-effort auto-detection: Using "${extractedInfo.searchQuery}" from disc title`);
                        }
                    } else if (extractedInfo) {
                        // Low confidence - log it but proceed with generic naming
                        console.log(`   ⚠️  Low confidence (${Math.round(extractedInfo.confidence * 100)}%) - using generic track names`);
                        if (extractedInfo.searchQuery) {
                            console.log(`   Best guess was: "${extractedInfo.searchQuery}"`);
                        }
                        console.log('   Tip: Run with a search query for better results, e.g.:');
                        console.log(`        juice-it "${extractedInfo.searchQuery || 'Show Name'}"`);
                        logFn(`Best-effort auto-detection: Low confidence (${extractedInfo.confidence}), using generic naming`);
                    }
                }

                // If no metadata yet (no smart mode, or detection failed), use generic disc metadata
                // This proceeds directly to confirmation without forcing interactive mode
                if (!metadata) {
                    console.log('');
                    console.log('  📀 Using Generic Track Names');
                    console.log('');
                    console.log(`  Tracks will be named: ${volumeName} - Track 1.mp4, ${volumeName} - Track 2.mp4, etc.`);
                    if (!hasFullSmartMode) {
                        console.log('');
                        console.log('  Tip: For episode/movie naming, either:');
                        console.log('    • Run with a search query: juice-it "Show Name"');
                        console.log('    • Or configure API keys: juice-it --setup');
                    }
                    console.log('');
                    logFn('Using generic track naming (no metadata lookup)');
                    metadata = { type: 'disc', volumeName };
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
                    aiMappingResult = await aiModule.aiMapTracks(titleDurations, metadata, lsdvdMetadata, unrippableTracks || [], metadata.discNumber, volumeName, null, enhancedTrackData);

                    if (!aiMappingResult) {
                        logFn('ERROR: Smart mapping failed');

                        if (options.interactive) {
                            // Interactive mode: ask user what to do
                            console.log('');
                            console.log('  ❌ Smart mapping failed!');
                            console.log('');

                            const failureChoices = [
                                { name: 'Retry smart mapping', value: 'retry' },
                                { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - NOT RECOMMENDED', value: 'sequential' },
                                { name: 'Cancel and exit', value: 'cancel' }
                            ];
                            const failureMenu = new Select({
                                message: 'How would you like to proceed?',
                                choices: failureChoices
                            });

                            try {
                                const selectedName = await failureMenu.run();
                                const choiceObj = failureChoices.find(c => c.name === selectedName);
                                const choice = choiceObj ? choiceObj.value : selectedName;
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
                            console.log('    • Run: juice-it --interactive  (to manually verify assignments)');
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

                    const noAiChoices = [
                        { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - may be incorrect', value: 'sequential' },
                        { name: 'Cancel and configure smart mapping (run: juice-it --setup)', value: 'cancel' }
                    ];
                    const noAiMenu = new Select({
                        message: 'How would you like to proceed?',
                        choices: noAiChoices
                    });

                    try {
                        const selectedName = await noAiMenu.run();
                        const choiceObj = noAiChoices.find(c => c.name === selectedName);
                        const choice = choiceObj ? choiceObj.value : selectedName;
                        if (choice === 'sequential') {
                            console.log('\n  ⚠️  Using sequential mapping...\n');
                            logFn('User chose sequential mapping (no API key)');
                            useSequentialMapping = true;
                        } else {
                            console.log('\n  ℹ️  Run `juice-it --setup` to configure your OpenAI API key.\n');
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
                    console.log('    • Run: juice-it --setup  (to add OpenAI API key)');
                    console.log('    • Or run: juice-it --interactive  (to manually review assignments)');
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

        // Show warnings BEFORE ripping and give user choice to continue or not
        if (autoModeWarnings.length > 0 && !options.rawMode) {
            console.log('');
            printSeparatorFn();
            console.log('  ⚠️  Warnings Detected');
            printSeparatorFn();
            console.log('');
            console.log('  The following issues were found during automatic processing:');
            console.log('');
            autoModeWarnings.forEach(warning => {
                console.log(`    • ${warning}`);
            });
            console.log('');

            // If in interactive mode, already reviewed, just show warning and continue
            if (options.interactive) {
                console.log('  (You are in interactive mode - continue to rip)');
                console.log('');
            } else {
                // Non-interactive mode with warnings: ask user what to do
                const { Select } = require('enquirer');
                try {
                    const warningChoices = [
                        { name: '🍊 Continue with ripping', value: 'continue' },
                        { name: '📋 Switch to interactive mode (review mappings)', value: 'interactive' },
                        { name: '❌ Cancel', value: 'cancel' }
                    ];
                    const warningPrompt = new Select({
                        message: 'How would you like to proceed?',
                        choices: warningChoices
                    });
                    const warningSelected = await warningPrompt.run();
                    // enquirer returns name not value, so find the matching choice
                    const warningObj = warningChoices.find(c => c.name === warningSelected);
                    const warningChoice = warningObj ? warningObj.value : warningSelected;

                    if (warningChoice === 'cancel') {
                        console.log('');
                        console.log('  ℹ️  Ripping cancelled.');
                        console.log('');
                        return { successCount: 0, skippedTracks, mappingSkippedTracks };
                    } else if (warningChoice === 'interactive') {
                        // Switch to interactive mode - redo the review
                        console.log('');
                        console.log('  📋 Switching to interactive mode...');
                        console.log('');
                        mappingsToRip = await interactiveModule.reviewAndMapEpisodesBeforeRip(
                            proposedMappings, metadata, volumeName, baseFileName,
                            { interactive: true, planOnly: options.planOnly, verbose: options.verbose }
                        );

                        if (!mappingsToRip || mappingsToRip.length === 0) {
                            console.log('');
                            console.log('  ℹ️  Ripping cancelled.');
                            console.log('');
                            return { successCount: 0, skippedTracks, mappingSkippedTracks };
                        }
                    }
                    // 'continue' falls through to ripping
                } catch (e) {
                    // User cancelled prompt (Ctrl+C)
                    console.log('');
                    console.log('  ℹ️  Ripping cancelled.');
                    console.log('');
                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                }
            }
        }

        // Always show "Ready to Juice?" confirmation before starting (unless raw mode)
        if (!options.rawMode) {
            const confirmation = await interactiveModule.confirmBeforeRip(
                mappingsToRip, metadata, { searchQuery: options.searchQuery, interactive: options.interactive, rawMode: options.rawMode }
            );

            logger.debug(`Confirmation result: action="${confirmation?.action}"`);

            if (confirmation.action === 'cancel') {
                console.log('');
                console.log('  ℹ️  Ripping cancelled.');
                console.log('');
                return { successCount: 0, skippedTracks, mappingSkippedTracks };
            } else if (confirmation.action === 'edit') {
                // Edit mappings - go through interactive edit flow
                console.log('');
                mappingsToRip = await interactiveModule.reviewAndMapEpisodesBeforeRip(
                    proposedMappings, metadata, volumeName, baseFileName,
                    { interactive: true, planOnly: options.planOnly, verbose: options.verbose }
                );

                if (!mappingsToRip || mappingsToRip.length === 0) {
                    console.log('');
                    console.log('  ℹ️  Ripping cancelled.');
                    console.log('');
                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                }
            } else if (confirmation.action === 'search' && confirmation.newQuery) {
                // Re-search with new query - restart the metadata lookup
                console.log('');
                console.log('  🔍 Re-searching with new query...');
                console.log('');

                // Re-lookup metadata with the new query
                const newMetadata = await metadataModule.lookupMetadata(
                    volumeName, numTitles, titleDurations,
                    { searchQuery: confirmation.newQuery, interactive: false },
                    lsdvdMetadata
                );

                if (newMetadata && newMetadata.type !== 'cancel') {
                    // Update metadata and recalculate mappings
                    metadata = newMetadata;
                    baseFileName = buildBaseFileNameFn(metadata);
                    options.outputDir = buildPlexFolderPathFn(metadata, process.cwd());

                    // Re-map tracks with new metadata
                    if (metadata.type === 'tv' && config.openaiApiKey) {
                        const newMappingResult = await aiModule.aiMapTracks(
                            titleDurations, metadata, lsdvdMetadata, unrippableTracks,
                            metadata.discNumber || null, volumeName, null, enhancedTrackData
                        );
                        if (newMappingResult) {
                            proposedMappings = mappingModule.buildProposedMappingsFromAI(
                                newMappingResult, metadata, numTitles, titleDurations,
                                { mainOnly: options.mainOnly, unrippableTracks }
                            );
                        } else {
                            proposedMappings = mappingModule.buildSequentialMappings(
                                metadata, numTitles, titleDurations,
                                { mainOnly: options.mainOnly, unrippableTracks }
                            );
                        }
                    } else {
                        proposedMappings = mappingModule.buildSequentialMappings(
                            metadata, numTitles, titleDurations,
                            { mainOnly: options.mainOnly, unrippableTracks, mainFeatureTrack: mappingModule.findMainFeatureTrack(titleDurations) }
                        );
                    }

                    // Finalize and set mappingsToRip
                    for (const mapping of proposedMappings) {
                        if (mapping.status === 'pending') {
                            mapping.status = mapping.proposedName;
                        }
                    }
                    mappingsToRip = proposedMappings;

                    // Show confirmation again with new results
                    const reConfirmation = await interactiveModule.confirmBeforeRip(
                        mappingsToRip, metadata, { searchQuery: confirmation.newQuery, interactive: options.interactive, rawMode: options.rawMode }
                    );

                    if (reConfirmation.action === 'cancel') {
                        console.log('');
                        console.log('  ℹ️  Ripping cancelled.');
                        console.log('');
                        return { successCount: 0, skippedTracks, mappingSkippedTracks };
                    } else if (reConfirmation.action !== 'rip') {
                        // Handle 'edit' or 'interactive' from re-confirmation
                        if (reConfirmation.action === 'edit' || reConfirmation.action === 'interactive') {
                            mappingsToRip = await interactiveModule.reviewAndMapEpisodesBeforeRip(
                                proposedMappings, metadata, volumeName, baseFileName,
                                { interactive: true, planOnly: options.planOnly, verbose: options.verbose }
                            );
                            if (!mappingsToRip || mappingsToRip.length === 0) {
                                console.log('');
                                console.log('  ℹ️  Ripping cancelled.');
                                console.log('');
                                return { successCount: 0, skippedTracks, mappingSkippedTracks };
                            }
                        }
                    }
                    // 'rip' action continues to ripping
                } else {
                    console.log('');
                    console.log('  ⚠️  Search failed or cancelled. Continuing with original mappings.');
                    console.log('');
                }
            } else if (confirmation.action === 'interactive') {
                // Switch to full interactive mode
                console.log('');
                console.log('  📋 Switching to interactive mode...');
                console.log('');
                mappingsToRip = await interactiveModule.reviewAndMapEpisodesBeforeRip(
                    proposedMappings, metadata, volumeName, baseFileName,
                    { interactive: true, planOnly: options.planOnly, verbose: options.verbose }
                );

                if (!mappingsToRip || mappingsToRip.length === 0) {
                    console.log('');
                    console.log('  ℹ️  Ripping cancelled.');
                    console.log('');
                    return { successCount: 0, skippedTracks, mappingSkippedTracks };
                }
            } else if (confirmation.action !== 'rip') {
                // Unknown action - treat as cancel for safety
                logger.debug(`Unknown confirmation action: "${confirmation.action}" - treating as cancel`);
                console.log('');
                console.log('  ℹ️  Ripping cancelled.');
                console.log('');
                return { successCount: 0, skippedTracks, mappingSkippedTracks };
            }
            // 'rip' action continues to start ripping
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
            console.log('  🍊 Fresh squeezed! All tracks juiced successfully!');
            if (unrippableCount > 0) {
                console.log(`     (${unrippableCount} copy-protected track${unrippableCount > 1 ? 's were' : ' was'} not attempted)`);
            }
        } else if (successCount > 0) {
            console.log(`  🍊 Juicing complete: ${successCount} of ${totalToRip} tracks squeezed`);
            if (skippedTracks.length > 0) {
                console.log('');
                console.log(`  ❌ ${skippedTracks.length} track(s) got stuck in the juicer:`);
                skippedTracks.forEach(({ track, reason }) => {
                    console.log(`     • Track ${track}: ${reason}`);
                });
            }
            if (unrippableCount > 0) {
                console.log(`     (${unrippableCount} copy-protected track${unrippableCount > 1 ? 's were' : ' was'} not attempted)`);
            }
        } else {
            console.log('  ✗ No tracks were successfully juiced');
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
                console.log('     juice-it');
                console.log('');
            }
            console.log('     Or for a raw rip of everything:');
            console.log('     juice-it --raw');
            console.log('');
        }

        // Show brief reminder of warnings that occurred (user already saw them before ripping)
        if (autoModeWarnings.length > 0) {
            console.log('');
            console.log(`  ⚠️  Reminder: ${autoModeWarnings.length} warning(s) occurred during processing.`);
            console.log('     Review your ripped files to verify they are correct.');
            console.log('');
        }

        // Eject disc on completion (unless --no-eject or --dry-run)
        if (options.ejectOnComplete && !options.dryRun && successCount > 0) {
            console.log('  📀 Ejecting disc...');
            const ejected = handbrakeModule.ejectDisc(options.dvdSource);
            if (ejected) {
                console.log('  ✓ Disc ejected\n');
            } else {
                console.log('  ⚠️  Could not eject disc automatically\n');
            }
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
