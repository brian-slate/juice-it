/**
 * JuiceIt Diagnostic Mode
 *
 * Detailed mapping analysis for debugging AI-powered track mapping.
 * Shows step-by-step breakdown of the metadata lookup and mapping process.
 */

const {
    printDiagnosticSection,
    printIndentedText,
    printTrackAnalysisTable,
    printEpisodeTable,
    printMappingResultsTable
} = require('./display');
const { buildTmdbMatchPrompts, buildTrackMappingPrompts } = require('../prompts/loader');

// ==================== DEPENDENCY INJECTION ====================

// Default lazy loaders
const defaultLoaders = {
    config: () => require('./config'),
    disc: () => require('./disc'),
    tmdb: () => require('./tmdb'),
    ai: () => require('./ai'),
    aiConfig: () => require('../config/ai-config')
};

// Cached modules (lazy loaded)
let cachedModules = {
    config: null,
    disc: null,
    tmdb: null,
    ai: null,
    aiConfig: null
};

// Dependency injection - module loaders can be overridden for testing
let deps = {
    loaders: { ...defaultLoaders },
    log: console.log.bind(console)
};

/**
 * Set dependencies for testing
 * @param {Object} newDeps - Object with dependency overrides
 *   - loaders: Object with module loader functions (config, disc, tmdb, ai, aiConfig)
 *   - log: Log function for console output
 */
function setDependencies(newDeps) {
    if (newDeps.loaders) {
        deps.loaders = { ...deps.loaders, ...newDeps.loaders };
    }
    if (newDeps.log) {
        deps.log = newDeps.log;
    }
    // Clear cached modules when dependencies change
    cachedModules = {
        config: null,
        disc: null,
        tmdb: null,
        ai: null,
        aiConfig: null
    };
}

/**
 * Reset dependencies to defaults (for test cleanup)
 */
function resetDependencies() {
    deps = {
        loaders: { ...defaultLoaders },
        log: deps.log.bind(console)
    };
    cachedModules = {
        config: null,
        disc: null,
        tmdb: null,
        ai: null,
        aiConfig: null
    };
}

/**
 * Get config module (lazy load with DI support)
 */
function getConfigModule() {
    if (!cachedModules.config) {
        cachedModules.config = deps.loaders.config();
    }
    return cachedModules.config;
}

/**
 * Get disc module (lazy load with DI support)
 */
function getDiscModule() {
    if (!cachedModules.disc) {
        cachedModules.disc = deps.loaders.disc();
    }
    return cachedModules.disc;
}

/**
 * Get tmdb module (lazy load with DI support)
 */
function getTmdbModule() {
    if (!cachedModules.tmdb) {
        cachedModules.tmdb = deps.loaders.tmdb();
    }
    return cachedModules.tmdb;
}

/**
 * Get ai module (lazy load with DI support)
 */
function getAiModule() {
    if (!cachedModules.ai) {
        cachedModules.ai = deps.loaders.ai();
    }
    return cachedModules.ai;
}

/**
 * Get AI config (lazy load with DI support)
 */
function getAiConfig() {
    if (!cachedModules.aiConfig) {
        cachedModules.aiConfig = deps.loaders.aiConfig();
    }
    return cachedModules.aiConfig;
}

/**
 * Analyze mapping for potential issues
 *
 * @param {Object} aiMappingResult - AI mapping result
 * @param {Object} metadata - Content metadata with episodes
 * @returns {Array<string>} Array of issue descriptions
 */
function analyzeMappingIssues(aiMappingResult, metadata) {
    const issues = [];

    // Check for episode count mismatch
    const mappedCount = aiMappingResult.mappings.filter(m => !m.shouldSkip).length;
    const expectedCount = metadata.episodes.length;
    if (mappedCount !== expectedCount) {
        issues.push(`⚠️  Episode count mismatch: ${mappedCount} tracks mapped vs ${expectedCount} episodes expected`);
    }

    // Check for low confidence mappings
    const lowConfidence = aiMappingResult.mappings.filter(m => !m.shouldSkip && m.confidence < 0.7);
    if (lowConfidence.length > 0) {
        issues.push(`⚠️  ${lowConfidence.length} mapping(s) have low confidence (<70%)`);
        lowConfidence.forEach(m => {
            issues.push(`     - Track ${m.trackNum}: ${(m.confidence * 100).toFixed(0)}% confidence`);
        });
    }

    // Check for duration mismatches
    const durationMismatches = aiMappingResult.mappings.filter(m => {
        if (m.shouldSkip || m.episodeIndex === null) return false;
        const epRuntime = metadata.episodes[m.episodeIndex]?.runtime || 0;
        return Math.abs(m.trackDuration - epRuntime) > 3;
    });
    if (durationMismatches.length > 0) {
        issues.push(`⚠️  ${durationMismatches.length} track(s) have >3 min duration difference from episode:`);
        durationMismatches.forEach(m => {
            const epRuntime = metadata.episodes[m.episodeIndex]?.runtime || '?';
            issues.push(`     - Track ${m.trackNum} (${m.trackDuration} min) → Episode ${m.episodeIndex + 1} (${epRuntime} min)`);
        });
    }

    return issues;
}

/**
 * Print lsdvd track details table
 *
 * @param {Object} lsdvdMetadata - lsdvd metadata with tracks
 */
function printLsdvdTrackTable(lsdvdMetadata) {
    deps.log('  Track Details (from lsdvd):');
    deps.log('  ┌───────┬──────────┬──────────┬───────┬──────┐');
    deps.log('  │ Track │ Duration │ Chapters │ Audio │ Subs │');
    deps.log('  ├───────┼──────────┼──────────┼───────┼──────┤');

    const sortedTracks = Object.entries(lsdvdMetadata.tracks)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    for (const [trackNum, track] of sortedTracks) {
        const tNum = String(trackNum).padStart(4);
        const dur = `${track.durationMinutes} min`.padStart(6);
        const chap = String(track.chapters).padStart(5);
        const audio = String(track.audioStreams).padStart(3);
        const subs = String(track.subpictures).padStart(2);
        deps.log(`  │ ${tNum}  │ ${dur}  │   ${chap}  │  ${audio}  │  ${subs}  │`);
    }
    deps.log('  └───────┴──────────┴──────────┴───────┴──────┘');
}

/**
 * Run diagnostic mode - detailed mapping analysis
 *
 * @param {Object} options - CLI options {dvdSource, searchQuery, verbose}
 */
async function runDiagnosticMode(options = {}) {
    const configModule = getConfigModule();
    const discModule = getDiscModule();
    const tmdbModule = getTmdbModule();
    const aiModule = getAiModule();
    const aiCfg = getAiConfig();

    const settings = configModule.load();

    deps.log('');
    deps.log('╔' + '═'.repeat(78) + '╗');
    deps.log('║' + '  🔬 JuiceIt Diagnostic Mode - Mapping Analysis'.padEnd(78) + '║');
    deps.log('╚' + '═'.repeat(78) + '╝');
    deps.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: DVD SOURCE INFO
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📀 SECTION 1: DVD SOURCE INFORMATION');

    const dvdSource = options.dvdSource || '/dev/disk4'; // Default
    deps.log(`  DVD Source: ${dvdSource}`);

    // Use disc module getVolumeName() function
    const volumeName = discModule.getVolumeName(dvdSource);
    deps.log(`  Volume Name: ${volumeName}`);
    deps.log('');

    // Get lsdvd metadata early for use in TMDB selection and track mapping
    const lsdvdMetadata = discModule.getLsdvdMetadata(dvdSource);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: DISC SCAN - TRACK INFORMATION
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🔍 SECTION 2: DISC SCAN - TRACK INFORMATION');

    // Use disc module scanDisc() - returns structured data
    const scanResult = await discModule.scanDisc(dvdSource, volumeName, { verbose: options.verbose });
    const numTitles = scanResult.numTitles;
    const trackDurations = scanResult.titleDurations;
    const unrippableTracks = scanResult.unrippableTracks;

    deps.log('');
    printTrackAnalysisTable(numTitles, trackDurations);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: ONLINE METADATA (TMDB)
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🌐 SECTION 3: ONLINE METADATA (TMDB)');

    if (!settings.tmdbApiKey) {
        deps.log('  ❌ No TMDB API key configured. Run: juice-it --setup');
        deps.log('');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3A: AI QUERY EXTRACTION (NEW)
    // ═══════════════════════════════════════════════════════════════════════════
    let cleanName;
    let extractedInfo = null;
    const rawQuery = options.searchQuery || volumeName.replace(/_/g, ' ').replace(/\s+D\d+$/i, '').replace(/DISC\s*\d+$/i, '').trim();

    deps.log(`  Raw Query: "${rawQuery}"`);

    // Run AI query extraction if OpenAI is configured
    if (settings.openaiApiKey) {
        deps.log('  ⏳ Running AI query extraction...');
        extractedInfo = await aiModule.aiExtractSearchQuery(rawQuery);

        if (extractedInfo) {
            deps.log('  ✓ AI extraction complete\n');
            deps.log('  ┌─────────────────────────────────────────────────────────┐');
            deps.log('  │ AI Query Extraction Results                             │');
            deps.log('  ├─────────────────────────────────────────────────────────┤');
            deps.log(`  │ Clean Query:  "${extractedInfo.searchQuery}"`);
            deps.log(`  │ Is TV Show:   ${extractedInfo.isTV}`);
            deps.log(`  │ Is Box Set:   ${extractedInfo.isBoxSet || false}`);
            deps.log(`  │ Season:       ${extractedInfo.season || 'not specified'}`);
            deps.log(`  │ Disc:         ${extractedInfo.disc || 'not specified'}`);
            deps.log(`  │ Year:         ${extractedInfo.year || 'not specified'}`);
            deps.log(`  │ Confidence:   ${((extractedInfo.confidence || 0) * 100).toFixed(0)}%`);
            if (extractedInfo.clarificationNeeded) {
                deps.log('  ├─────────────────────────────────────────────────────────┤');
                deps.log(`  │ ⚠️  ${extractedInfo.clarificationNeeded}`);
            }
            if (extractedInfo.suggestedSearches?.length > 0) {
                deps.log('  ├─────────────────────────────────────────────────────────┤');
                deps.log('  │ Suggested Alternative Searches:');
                extractedInfo.suggestedSearches.forEach((s, i) => {
                    deps.log(`  │   ${i + 1}. "${s.query}" (${s.reason})`);
                });
            }
            deps.log('  └─────────────────────────────────────────────────────────┘');
            deps.log('');

            cleanName = extractedInfo.searchQuery;
        } else {
            deps.log('  ⚠️  AI extraction failed, using raw query');
            cleanName = rawQuery;
        }
    } else {
        cleanName = rawQuery;
        deps.log('  (No OpenAI key - skipping AI query extraction)');
    }

    deps.log(`  Search Query for TMDB: "${cleanName}"`);
    deps.log('');

    // Fetch movie and TV results using multi-query search if we have extraction info
    let movieResults, tvResults;
    if (extractedInfo && extractedInfo.suggestedSearches?.length > 0) {
        deps.log('  ⏳ Running multi-query TMDB search (with alternatives)...');
        const searchResults = await tmdbModule.multiQueryTMDBSearch(extractedInfo);
        movieResults = searchResults.movieResults;
        tvResults = searchResults.tvResults;
    } else {
        const searchYear = extractedInfo?.year || null;
        movieResults = await tmdbModule.searchTMDB(cleanName, false, searchYear);
        tvResults = await tmdbModule.searchTMDB(cleanName, true, searchYear);
    }

    deps.log(`  TMDB Results: ${movieResults.length} movies, ${tvResults.length} TV shows`);
    deps.log('');

    if (tvResults.length > 0) {
        deps.log('  TV Shows Found:');
        tvResults.slice(0, 5).forEach((show, i) => {
            deps.log(`    ${i + 1}. ${show.name} (${show.first_air_date?.substring(0, 4) || '?'}) - ID: ${show.id}`);
        });
        deps.log('');
    }

    if (movieResults.length > 0) {
        deps.log('  Movies Found:');
        movieResults.slice(0, 5).forEach((movie, i) => {
            deps.log(`    ${i + 1}. ${movie.title} (${movie.release_date?.substring(0, 4) || '?'}) - ID: ${movie.id}`);
        });
        deps.log('');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: AI TMDB SELECTION
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🤖 SECTION 4: AI TMDB SELECTION');

    if (!settings.openaiApiKey) {
        deps.log('  ❌ No OpenAI API key configured. Run: juice-it --setup');
        deps.log('');
        return;
    }

    // Show AI configuration
    deps.log('  ⚙️  AI Configuration:');
    deps.log(`    Model: ${aiCfg.model}`);
    deps.log(`    Temperature: ${aiCfg.temperature}`);
    deps.log(`    Structured Output: ${aiCfg.useStructuredOutput ? 'Yes' : 'No'}`);
    deps.log('');

    // Build and show full prompts (include extractedInfo and lsdvdMetadata for full context)
    const tmdbPrompts = buildTmdbMatchPrompts({
        volumeName,
        numTitles,
        trackDurations,
        movieResults,
        tvResults,
        userQuery: rawQuery,
        extractedInfo,
        lsdvdMetadata
    });

    if (aiCfg.diagnosticShowFullPrompts) {
        deps.log('  📤 SYSTEM PROMPT:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(tmdbPrompts.system, '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log('');
        deps.log('  📤 USER PROMPT:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(tmdbPrompts.user, '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log('');
    }

    // Use ai module aiSelectTmdbMatch() function (pass full context including extractedInfo and lsdvdMetadata)
    const aiSelection = await aiModule.aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults, rawQuery, extractedInfo, lsdvdMetadata);

    if (!aiSelection) {
        deps.log('  ❌ AI selection failed');
        deps.log('');
        return;
    }

    deps.log('');
    if (aiCfg.diagnosticShowFullResponses) {
        deps.log('  📥 FULL AI RESPONSE:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(JSON.stringify(aiSelection, null, 2), '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    } else {
        deps.log('  📥 AI RESPONSE SUMMARY:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log(`  Selected: ${aiSelection.selectedType.toUpperCase()} - ID ${aiSelection.selectedId}`);
        deps.log(`  Confidence: ${(aiSelection.confidence * 100).toFixed(0)}%`);
        deps.log(`  Reasoning: ${aiSelection.reasoning}`);
        if (aiSelection.season) {
            deps.log(`  Season: ${aiSelection.season}`);
        }
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    }
    deps.log('');

    // Get full metadata from search results + season details
    // Use extracted season (from user query) over AI-guessed season
    const season = extractedInfo?.season || aiSelection.season || 1;
    let metadata;
    if (aiSelection.selectedType === 'tv') {
        const selectedShow = tvResults.find(s => s.id === aiSelection.selectedId);
        const seasonDetails = await tmdbModule.getTVSeasonDetails(aiSelection.selectedId, season);
        metadata = {
            type: 'tv',
            tmdbId: aiSelection.selectedId,
            name: selectedShow?.name || 'Unknown',
            season: season,
            episodes: seasonDetails?.episodes || [],
            discNumber: extractedInfo?.disc || null
        };
    } else {
        const selectedMovie = movieResults.find(m => m.id === aiSelection.selectedId);
        metadata = {
            type: 'movie',
            tmdbId: aiSelection.selectedId,
            name: selectedMovie?.title || 'Unknown',
            runtime: selectedMovie?.runtime || null
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: EPISODE/CONTENT DETAILS
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📋 SECTION 5: CONTENT DETAILS FROM TMDB');

    deps.log(`  Title: ${metadata.name}`);
    deps.log(`  Type: ${metadata.type}`);

    if (metadata.type === 'tv') {
        deps.log(`  Season: ${metadata.season}`);
        deps.log(`  Episodes: ${metadata.episodes.length}`);
        deps.log('');

        // Use ai module analyzeEpisodeRuntimes() function
        const runtimeAnalysis = aiModule.analyzeEpisodeRuntimes(metadata.episodes);

        if (runtimeAnalysis) {
            deps.log('  Runtime Analysis (derived from TMDB data):');
            deps.log(`    Range: ${runtimeAnalysis.min}-${runtimeAnalysis.max} min`);
            deps.log(`    Average: ${runtimeAnalysis.avg} min`);
            deps.log(`    Variance: ${runtimeAnalysis.variance} min`);
            deps.log(`    Derived Tolerance: ±${runtimeAnalysis.tolerance} min`);
            deps.log(`    Valid Track Range: ${runtimeAnalysis.min - runtimeAnalysis.tolerance}-${runtimeAnalysis.max + runtimeAnalysis.tolerance} min`);
            deps.log(`    Format: ${runtimeAnalysis.format}`);
            deps.log('');
        }

        printEpisodeTable(metadata.episodes);
    } else {
        deps.log(`  Runtime: ${metadata.runtime || '?'} min`);
        deps.log('');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: AI TRACK MAPPING
    // ═══════════════════════════════════════════════════════════════════════════
    if (metadata.type !== 'tv') {
        deps.log('  ℹ️  AI track mapping only applies to TV shows');
        deps.log('');
        printDiagnosticComplete();
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5.5: EXTENDED DISC METADATA (lsdvd)
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('💿 SECTION 5.5: EXTENDED DISC METADATA (lsdvd)');

    if (lsdvdMetadata) {
        deps.log(`  Disc Title: ${lsdvdMetadata.discTitle}`);
        deps.log(`  Disc ID: ${lsdvdMetadata.discId || 'unknown'}`);
        deps.log(`  Longest Track: ${lsdvdMetadata.longestTrack || '?'}`);
        deps.log('');
        printLsdvdTrackTable(lsdvdMetadata);
    } else {
        deps.log('  ⚠️  lsdvd not available or failed to read disc');
        deps.log('  ℹ️  Install lsdvd (brew install lsdvd) for extended metadata');
    }
    deps.log('');

    printDiagnosticSection('🎯 SECTION 6: AI TRACK MAPPING (Option C)');

    deps.log('  ℹ️  Using Option C: Raw data + soft guidance (no pre-labeling)');
    deps.log('');

    // Get runtime analysis for soft guidance
    const runtimeAnalysis = aiModule.analyzeEpisodeRuntimes(metadata.episodes);

    // Build full prompts from templates (Option C - no CANDIDATE/SKIP pre-labeling)
    // buildTrackMappingPrompts now handles all formatting internally
    const mappingPrompts = buildTrackMappingPrompts({
        metadata,
        trackDurations,
        runtimeAnalysis,
        lsdvdMetadata,
        volumeName,
        discNumber: metadata.discNumber
    });

    if (aiCfg.diagnosticShowFullPrompts) {
        deps.log('  📤 SYSTEM PROMPT:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(mappingPrompts.system, '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log('');
        deps.log('  📤 USER PROMPT:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(mappingPrompts.user, '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log('');
    }

    // Use ai module aiMapTracks() function with lsdvd metadata
    const aiMappingResult = await aiModule.aiMapTracks(trackDurations, metadata, lsdvdMetadata, unrippableTracks || [], metadata.discNumber, volumeName);

    if (!aiMappingResult) {
        deps.log('  ❌ AI mapping failed');
        deps.log('');
        return;
    }

    deps.log('');
    if (aiCfg.diagnosticShowFullResponses) {
        deps.log('  📥 FULL AI RESPONSE:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(JSON.stringify(aiMappingResult, null, 2), '  ');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    } else {
        deps.log('  📥 AI RESPONSE SUMMARY:');
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        deps.log(`  Tracks Matched: ${aiMappingResult.summary?.tracksMatched || 0}`);
        deps.log(`  Tracks Skipped: ${aiMappingResult.summary?.tracksSkipped || 0}`);
        deps.log(`  Overall Confidence: ${((aiMappingResult.overallConfidence || 0) * 100).toFixed(0)}%`);
        deps.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    }
    deps.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: MAPPING RESULTS TABLE
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📊 SECTION 7: FINAL MAPPING RESULTS');

    deps.log('  Runtime Analysis Used:');
    deps.log(`    Episode Range: ${aiMappingResult.runtimeAnalysis?.episodeRuntimeRange || '?'}`);
    deps.log(`    Tolerance: ±${aiMappingResult.runtimeAnalysis?.toleranceUsed || '?'} min`);
    deps.log(`    Valid Track Range: ${aiMappingResult.runtimeAnalysis?.validTrackRange || '?'}`);
    deps.log('');

    deps.log('  Summary:');
    deps.log(`    Tracks Matched: ${aiMappingResult.summary?.tracksMatched || 0}`);
    deps.log(`    Tracks Skipped: ${aiMappingResult.summary?.tracksSkipped || 0}`);
    deps.log(`    Episodes Expected: ${aiMappingResult.summary?.episodesExpected || 0}`);
    deps.log(`    Overall Confidence: ${((aiMappingResult.overallConfidence || 0) * 100).toFixed(0)}%`);
    deps.log('');

    printMappingResultsTable(aiMappingResult.mappings, metadata.episodes);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: POTENTIAL ISSUES
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('⚠️  SECTION 8: POTENTIAL ISSUES');

    const issues = analyzeMappingIssues(aiMappingResult, metadata);

    if (issues.length === 0) {
        deps.log('  ✅ No issues detected - mapping looks good!');
    } else {
        issues.forEach(issue => deps.log(`  ${issue}`));
    }
    deps.log('');

    printDiagnosticComplete();
}

/**
 * Print diagnostic complete footer
 */
function printDiagnosticComplete() {
    deps.log('╔' + '═'.repeat(78) + '╗');
    deps.log('║' + '  Diagnostic Complete'.padEnd(78) + '║');
    deps.log('╚' + '═'.repeat(78) + '╝');
    deps.log('');
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    // Functions
    runDiagnosticMode,
    analyzeMappingIssues,
    // Alias for backward compatibility
    run: runDiagnosticMode
};
