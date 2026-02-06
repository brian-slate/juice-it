/**
 * JuiceIt Metadata Lookup
 *
 * Orchestrates TMDB searches and AI-powered content matching.
 * Handles both automatic and interactive metadata selection flows.
 */

const { Select, Input } = require('enquirer');

// Lazy-loaded modules
let tmdb = null;
let ai = null;
let logger = null;

function getTmdb() {
    if (!tmdb) {
        tmdb = require('./tmdb');
    }
    return tmdb;
}

function getAi() {
    if (!ai) {
        ai = require('./ai');
    }
    return ai;
}

function getLogger() {
    if (!logger) {
        const { getLogger: createLogger } = require('./logger');
        logger = createLogger();
    }
    return logger;
}

// File logging function (will be set by caller)
let logToFile = () => {};

/**
 * Helper to get the value from a Select choice
 * enquirer's Select returns the 'name' not 'value' when using object choices
 * @param {string} selectedName - The name returned by Select.run()
 * @param {Array} choices - The choices array passed to Select
 * @returns {string} The value if found, otherwise the selectedName
 */
function getChoiceValue(selectedName, choices) {
    const choice = choices.find(c => c.name === selectedName);
    return choice ? choice.value : selectedName;
}

/**
 * Set the file logging function
 * @param {Function} fn - Function to log to file
 */
function setLogFunction(fn) {
    logToFile = fn;
}

// Config loader (will be set by caller)
let loadConfigFn = () => ({});

/**
 * Set the config loader function
 * @param {Function} fn - Function to load config
 */
function setConfigLoader(fn) {
    loadConfigFn = fn;
}

/**
 * Guess media type based on disc characteristics
 *
 * This function uses heuristics when AI extraction isn't available.
 * When track durations are provided, it makes a smarter determination.
 *
 * @param {number} numTitles - Number of titles on the disc
 * @param {Object|null} trackDurations - Optional map of track numbers to durations (minutes)
 * @returns {'tv'|'movie'} - Best guess at media type
 */
function guessMediaType(numTitles, trackDurations = null) {
    // If we have track durations, use smarter heuristics
    if (trackDurations && Object.keys(trackDurations).length > 0) {
        const durations = Object.values(trackDurations).filter(d => d > 0);

        if (durations.length === 0) {
            // No valid durations, fall back to count-based guess
            return numTitles >= 3 ? 'tv' : 'movie';
        }

        const maxDuration = Math.max(...durations);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

        // Movie indicators:
        // - Has exactly one track over 60 minutes (feature film)
        // - Total tracks <= 3 (feature + maybe 1-2 extras)
        const longTracks = durations.filter(d => d >= 60);
        if (longTracks.length === 1 && numTitles <= 3) {
            return 'movie';
        }

        // TV indicators:
        // - Multiple tracks with similar durations (within 30% of each other)
        // - Average duration between 10-50 minutes (typical episode length)
        // - More than 3 tracks that are NOT very short (< 5 min = likely menus/extras)
        const episodeLengthTracks = durations.filter(d => d >= 8 && d <= 65);
        if (episodeLengthTracks.length >= 3) {
            // Check if tracks have similar durations (TV episodes tend to be consistent)
            const variance = Math.max(...episodeLengthTracks) - Math.min(...episodeLengthTracks);
            const varianceRatio = variance / avgDuration;

            // If variance is less than 50% of average, likely TV episodes
            if (varianceRatio < 0.5 && avgDuration >= 8 && avgDuration <= 65) {
                return 'tv';
            }
        }

        // If longest track is movie-length (75+ minutes), assume movie with extras
        if (maxDuration >= 75) {
            return 'movie';
        }
    }

    // Fallback: simple count-based guess
    // Movies typically have 1-2 titles (feature + extras)
    // TV shows typically have 3+ titles (episodes)
    return numTitles >= 3 ? 'tv' : 'movie';
}

/**
 * Main metadata lookup function
 *
 * Searches TMDB for movie/TV matches and uses AI to select the best match.
 * Falls back to interactive selection if AI confidence is low.
 *
 * @param {string} volumeName - DVD volume name
 * @param {number} numTitles - Number of titles on disc
 * @param {Object|null} trackDurations - Track durations map
 * @param {Object} searchOptions - Search options {searchQuery, interactive}
 * @param {Object|null} lsdvdMetadata - Extended disc metadata from lsdvd
 * @returns {Promise<Object|null>} Metadata object or null if cancelled
 */
async function lookupMetadata(volumeName, numTitles, trackDurations = null, searchOptions = {}, lsdvdMetadata = null) {
    const { searchTMDB, getTVSeasonDetails, getTVShowDetails, multiQueryTMDBSearch } = getTmdb();
    const { aiExtractSearchQuery, aiSelectTmdbMatch } = getAi();
    const config = loadConfigFn();

    console.log('\n🔍 Looking up the goods...');

    // Use provided search title or clean up the volume name for searching
    let cleanName;
    let extractedInfo = null; // AI-extracted season/disc/year info

    if (searchOptions.searchQuery) {
        // Try AI-powered query extraction if OpenAI is configured
        if (config.openaiApiKey) {
            console.log('   Squeezing out the details...');
            extractedInfo = await aiExtractSearchQuery(searchOptions.searchQuery);
        }

        if (extractedInfo && extractedInfo.searchQuery) {
            cleanName = extractedInfo.searchQuery;
            console.log(`   Using provided title: "${cleanName}"`);
            if (extractedInfo.season) {
                console.log(`   Detected season: ${extractedInfo.season}`);
            }
            // Show disc numbers - both box set disc and season disc if they differ
            const boxSetDisc = extractedInfo.disc;
            const seasonDiscInfo = lsdvdMetadata?.discPatterns?.patterns?.find(p => p.pattern === 'S#D#');
            const seasonDisc = seasonDiscInfo?.values?.disc;

            if (boxSetDisc && seasonDisc && boxSetDisc !== seasonDisc) {
                // Show both when they differ
                console.log(`   Box set disc: ${boxSetDisc}`);
                console.log(`   Season disc: ${seasonDisc} (of season ${extractedInfo.season || seasonDiscInfo?.values?.season || '?'})`);
            } else if (boxSetDisc) {
                console.log(`   Detected disc: ${boxSetDisc}`);
            } else if (seasonDisc) {
                console.log(`   Detected disc: ${seasonDisc}`);
            }
            if (extractedInfo.year) {
                console.log(`   Detected year: ${extractedInfo.year}`);
            }

            // Season clarification: if disc is specified without season for TV content
            if (extractedInfo.disc && !extractedInfo.season && extractedInfo.isTV) {
                console.log(`\n   ⚠️  You specified disc ${extractedInfo.disc} but not which season.`);
                console.log('   For multi-disc-per-season box sets, disc number ≠ season number.\n');

                try {
                    const seasonPrompt = new Input({
                        message: 'Which season is this disc from? (press Enter to skip)',
                        initial: ''
                    });
                    const seasonInput = await seasonPrompt.run();

                    if (seasonInput && seasonInput.trim()) {
                        const parsedSeason = parseInt(seasonInput.trim(), 10);
                        if (!isNaN(parsedSeason) && parsedSeason > 0) {
                            extractedInfo.season = parsedSeason;
                            console.log(`   ✓ Using season ${parsedSeason}\n`);
                        }
                    }
                } catch (e) {
                    // User cancelled or input error - continue without season
                    getLogger().debug(`Season clarification prompt cancelled: ${e.message}`);
                }
            }
        } else {
            // Fallback to regex-based cleanup if AI fails or not available
            cleanName = searchOptions.searchQuery.trim()
                .replace(/\s+D\d+$/i, '')                    // Remove "D1", "D2" at end
                .replace(/\s+disc\s*\d*$/i, '')              // Remove "disc 1", "disc" at end
                .replace(/\s+season\s*\d*$/i, '')            // Remove "season 1", "season" at end
                .replace(/\s+s\d+$/i, '')                    // Remove "s01", "s1" at end
                .replace(/\s+the\s+complete\s+series$/i, '') // Remove "the complete series"
                .replace(/\s+complete\s+series$/i, '')       // Remove "complete series"
                .replace(/\s+box\s*set$/i, '')               // Remove "box set", "boxset"
                .replace(/\s+collection$/i, '')              // Remove "collection"
                .replace(/\s{2,}/g, ' ')                     // Normalize multiple spaces
                .trim();
            console.log(`   Using provided title: "${cleanName}"`);
            if (cleanName !== searchOptions.searchQuery.trim()) {
                getLogger().debug(`Cleaned search query: "${searchOptions.searchQuery}" → "${cleanName}"`);
            }
        }
    } else {
        // Clean up volume name: remove underscores, disc indicators (D1, DISC 1, etc.)
        cleanName = volumeName
            .replace(/_/g, ' ')
            .replace(/\s+D\d+$/i, '')      // Remove "D1", "D2" at end
            .replace(/DISC\s*\d+$/i, '')   // Remove "DISC 1", "DISC1" at end
            .trim();
    }
    const mediaType = extractedInfo?.isTV ? 'tv' : guessMediaType(numTitles, trackDurations);
    const searchYear = extractedInfo?.year || null;
    const isBoxSet = extractedInfo?.isBoxSet || false;

    logToFile(`Searching for: "${cleanName}" (guessing type: ${mediaType}${searchYear ? `, year: ${searchYear}` : ''}${isBoxSet ? ', box set' : ''})`);

    // Use multi-query search if we have AI extraction with suggested alternatives
    let movieResults, tvResults;
    if (extractedInfo && extractedInfo.suggestedSearches?.length > 0) {
        console.log('   Searching TMDB (with fallback queries)...');
        const searchResults = await multiQueryTMDBSearch(extractedInfo);
        movieResults = searchResults.movieResults;
        tvResults = searchResults.tvResults;
    } else {
        // Standard single-query search
        movieResults = await searchTMDB(cleanName, false, searchYear);
        tvResults = await searchTMDB(cleanName, true, searchYear);
    }

    // Try AI-powered selection if available and we have track durations
    if (config.openaiApiKey && trackDurations) {
        const aiSelection = await aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults, searchOptions.searchQuery, extractedInfo, lsdvdMetadata);

        if (aiSelection && aiSelection.selectedId) {
            const selectedResult = aiSelection.selectedType === 'tv'
                ? tvResults.find(s => s.id === aiSelection.selectedId)
                : movieResults.find(m => m.id === aiSelection.selectedId);

            // Auto-select if confidence is 60% or higher
            // Below 60%: prompt user for confirmation even in auto mode
            const shouldAutoSelect = aiSelection.confidence >= 0.6;

            if (selectedResult && shouldAutoSelect) {
                const confidenceStr = aiSelection.confidence >= 0.8 ? '' : ` (${(aiSelection.confidence * 100).toFixed(0)}% confidence)`;
                if (aiSelection.selectedType === 'tv') {
                    // Use season from: AI extraction season > AI selection > default 1
                    // NOTE: disc number is NOT used as season - multi-disc-per-season sets break this assumption
                    let season = extractedInfo?.season || aiSelection.season || 1;
                    const showYear = selectedResult.first_air_date ? selectedResult.first_air_date.split('-')[0] : null;

                    // For box sets without explicit season, show season picker with episode counts
                    if (isBoxSet && !extractedInfo?.season) {
                        const showDetails = await getTVShowDetails(selectedResult.id);
                        if (showDetails && showDetails.numberOfSeasons > 1) {
                            console.log(`\n   📦 Box set detected: ${selectedResult.name}`);
                            console.log(`   This show has ${showDetails.numberOfSeasons} seasons:`);

                            // Build season choices with episode counts
                            const seasonChoices = showDetails.seasons
                                .filter(s => s.seasonNumber > 0) // Exclude "specials" (season 0)
                                .map(s => ({
                                    name: `Season ${s.seasonNumber} (${s.episodeCount} episodes)`,
                                    value: s.seasonNumber
                                }));

                            if (seasonChoices.length > 1) {
                                try {
                                    const seasonSelect = new Select({
                                        message: 'Which season is this disc from?',
                                        choices: seasonChoices
                                    });
                                    season = await seasonSelect.run();
                                    console.log(`   ✓ Using Season ${season}\n`);
                                } catch (e) {
                                    getLogger().debug(`Season selection cancelled: ${e.message}`);
                                    // Default to season 1 if cancelled
                                }
                            }
                        }
                    }

                    const seasonDetails = await getTVSeasonDetails(selectedResult.id, season);
                    // Fetch show overview for AI context (total seasons, episode counts)
                    const showOverview = await getTVShowDetails(selectedResult.id);
                    console.log(`\n   ✨ Auto-selected: ${selectedResult.name} - Season ${season}${confidenceStr}`);
                    return {
                        type: 'tv',
                        tmdbId: selectedResult.id,
                        name: selectedResult.name,
                        year: showYear,
                        season: season,
                        episodes: seasonDetails ? seasonDetails.episodes : null,
                        showOverview: showOverview || null,
                        aiSelected: true,
                        discNumber: extractedInfo?.disc || null
                    };
                } else {
                    console.log(`\n   ✨ Auto-selected: ${selectedResult.title}${confidenceStr}`);
                    return {
                        type: 'movie',
                        tmdbId: selectedResult.id,
                        name: selectedResult.title,
                        year: selectedResult.release_date ? selectedResult.release_date.split('-')[0] : null,
                        aiSelected: true
                    };
                }
            } else if (aiSelection.confidence < 0.6) {
                // Low confidence - show interactive confirmation
                return await handleLowConfidenceMatch(
                    aiSelection, selectedResult, cleanName, volumeName, numTitles,
                    trackDurations, searchOptions, extractedInfo
                );
            }
        }
    }

    // In automatic mode without AI: use first result or prompt for title if no results
    if (!searchOptions.interactive) {
        if (mediaType === 'tv' && tvResults.length > 0) {
            const show = tvResults[0];
            const seasonDetails = await getTVSeasonDetails(show.id, 1);
            const showOverview = await getTVShowDetails(show.id);
            const showYear = show.first_air_date ? show.first_air_date.split('-')[0] : null;
            console.log(`\n   📺 Auto-selected: ${show.name} - Season 1`);
            return {
                type: 'tv',
                tmdbId: show.id,
                name: show.name,
                year: showYear,
                season: 1,
                episodes: seasonDetails ? seasonDetails.episodes : null,
                showOverview: showOverview || null,
                discNumber: extractedInfo?.disc || null
            };
        } else if (movieResults.length > 0) {
            const movie = movieResults[0];
            console.log(`\n   🎬 Auto-selected: ${movie.title}`);
            return {
                type: 'movie',
                tmdbId: movie.id,
                name: movie.title,
                year: movie.release_date ? movie.release_date.split('-')[0] : null
            };
        } else {
            // No TMDB results found - show interactive options
            return await handleNoResults(cleanName, volumeName, numTitles, trackDurations, searchOptions);
        }
    }

    // Interactive mode - show selection menu
    return await showSelectionMenu(
        movieResults, tvResults, mediaType, cleanName, volumeName,
        numTitles, trackDurations, searchOptions, extractedInfo
    );
}

/**
 * Handle low confidence AI match - show confirmation options
 */
async function handleLowConfidenceMatch(aiSelection, selectedResult, cleanName, volumeName, numTitles, trackDurations, searchOptions, extractedInfo) {
    const { getTVSeasonDetails, getTVShowDetails } = getTmdb();

    const suggestion = selectedResult
        ? (aiSelection.selectedType === 'tv' ? selectedResult.name : selectedResult.title)
        : null;

    console.log(`\n   ⚠️  Match confidence too low (${(aiSelection.confidence * 100).toFixed(0)}%)`);
    console.log(`   The disc name "${cleanName}" doesn't clearly match any known title.`);
    if (suggestion) {
        console.log(`   Best guess: "${suggestion}"\n`);
    } else {
        console.log('');
    }

    // Build choices for low-confidence confirmation
    const lowConfChoices = [];
    if (selectedResult) {
        const suggestionLabel = aiSelection.selectedType === 'tv'
            ? `📺 Accept: ${selectedResult.name}`
            : `🎬 Accept: ${selectedResult.title}`;
        lowConfChoices.push({ name: suggestionLabel, value: 'accept' });
    }
    lowConfChoices.push({ name: '🔍 Search for a different title...', value: 'search' });
    lowConfChoices.push({ name: '📀 Skip metadata (raw rip)', value: 'raw' });
    lowConfChoices.push({ name: '❌ Cancel', value: 'cancel' });

    try {
        const confirmPrompt = new Select({
            message: 'What would you like to do?',
            choices: lowConfChoices
        });
        const choice = getChoiceValue(await confirmPrompt.run(), lowConfChoices);

        if (choice === 'accept' && selectedResult) {
            if (aiSelection.selectedType === 'tv') {
                const season = extractedInfo?.season || aiSelection.season || 1;
                const seasonDetails = await getTVSeasonDetails(selectedResult.id, season);
                const showOverview = await getTVShowDetails(selectedResult.id);
                const showYear = selectedResult.first_air_date ? selectedResult.first_air_date.split('-')[0] : null;
                console.log(`\n   ✓ Accepted: ${selectedResult.name} - Season ${season}\n`);
                return {
                    type: 'tv',
                    tmdbId: selectedResult.id,
                    name: selectedResult.name,
                    year: showYear,
                    season: season,
                    episodes: seasonDetails ? seasonDetails.episodes : null,
                    showOverview: showOverview || null,
                    discNumber: extractedInfo?.disc || null
                };
            } else {
                console.log(`\n   ✓ Accepted: ${selectedResult.title}\n`);
                return {
                    type: 'movie',
                    tmdbId: selectedResult.id,
                    name: selectedResult.title,
                    year: selectedResult.release_date ? selectedResult.release_date.split('-')[0] : null
                };
            }
        } else if (choice === 'search') {
            const searchPrompt = new Input({
                message: 'Enter search query:',
                initial: cleanName
            });
            const newQuery = await searchPrompt.run();
            if (newQuery && newQuery.trim()) {
                return lookupMetadata(volumeName, numTitles, trackDurations, {
                    ...searchOptions,
                    searchQuery: newQuery.trim()
                });
            }
            searchOptions.interactive = true;
            return lookupMetadata(volumeName, numTitles, trackDurations, searchOptions);
        } else if (choice === 'raw') {
            console.log('\n  📀 Raw Rip Mode\n');
            console.log('  Skipping metadata lookup and smart mapping.');
            console.log('  Tracks will be named: ' + volumeName + '_1.mp4, ' + volumeName + '_2.mp4, etc.\n');
            return { type: 'raw', volumeName };
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Handle no TMDB results found
 */
async function handleNoResults(cleanName, volumeName, numTitles, trackDurations, searchOptions) {
    console.log(`\n   ⚠️  No TMDB results found for "${cleanName}"`);
    console.log('   The disc name may not match the actual title.\n');

    const noResultsChoices = [
        { name: '🔍 Search for a different title...', value: 'search' },
        { name: '📀 Skip metadata (raw rip)', value: 'raw' },
        { name: '❌ Cancel', value: 'cancel' }
    ];

    try {
        const noResultsPrompt = new Select({
            message: 'What would you like to do?',
            choices: noResultsChoices
        });
        const choice = getChoiceValue(await noResultsPrompt.run(), noResultsChoices);

        if (choice === 'search') {
            const searchPrompt = new Input({
                message: 'Enter search query:',
                initial: cleanName
            });
            const newQuery = await searchPrompt.run();
            if (newQuery && newQuery.trim()) {
                return lookupMetadata(volumeName, numTitles, trackDurations, {
                    ...searchOptions,
                    searchQuery: newQuery.trim()
                });
            }
            searchOptions.interactive = true;
            return lookupMetadata(volumeName, numTitles, trackDurations, searchOptions);
        } else if (choice === 'raw') {
            console.log('\n  📀 Raw Rip Mode\n');
            console.log('  Skipping metadata lookup and smart mapping.');
            console.log('  Tracks will be named: ' + volumeName + '_1.mp4, ' + volumeName + '_2.mp4, etc.\n');
            return { type: 'raw', volumeName };
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Show interactive selection menu
 */
async function showSelectionMenu(movieResults, tvResults, mediaType, cleanName, volumeName, numTitles, trackDurations, searchOptions, extractedInfo) {
    const { searchTMDB, getTVSeasonDetails, getTVShowDetails } = getTmdb();

    const choices = [];

    // Add TV results first if we think it's a TV show
    if (mediaType === 'tv') {
        tvResults.slice(0, 5).forEach(show => {
            const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
            choices.push({
                name: `TV: ${show.name} ${year}`,
                value: { type: 'tv', data: show },
                hint: show.overview ? show.overview.substring(0, 80) + '...' : ''
            });
        });
        movieResults.slice(0, 3).forEach(movie => {
            const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
            choices.push({
                name: `Movie: ${movie.title} ${year}`,
                value: { type: 'movie', data: movie },
                hint: movie.overview ? movie.overview.substring(0, 80) + '...' : ''
            });
        });
    } else {
        movieResults.slice(0, 5).forEach(movie => {
            const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
            choices.push({
                name: `Movie: ${movie.title} ${year}`,
                value: { type: 'movie', data: movie },
                hint: movie.overview ? movie.overview.substring(0, 80) + '...' : ''
            });
        });
        tvResults.slice(0, 3).forEach(show => {
            const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
            choices.push({
                name: `TV: ${show.name} ${year}`,
                value: { type: 'tv', data: show },
                hint: show.overview ? show.overview.substring(0, 80) + '...' : ''
            });
        });
    }

    // Add options for manual entry and using disc name
    choices.push({ name: '🔍 Search for a different title...', value: { type: 'search' } });
    choices.push({ name: `📀 Use disc name: "${volumeName}" (raw rip)`, value: { type: 'disc' } });

    if (choices.length === 2) {
        // No TMDB results found - show helpful message
        console.log(`⚠️  No results found for "${cleanName}"\n`);
        console.log('   The disc name may not match the actual title.');
        console.log('   You can search for the correct title below.\n');
        logToFile('No TMDB results found, showing search prompt');
    }

    try {
        const prompt = new Select({
            name: 'media',
            message: 'Select the correct match:',
            choices: choices.map(c => ({
                name: c.name,
                value: c.value,
                hint: c.hint
            })),
            result(_name) {
                return this.focused.value;
            }
        });

        const selected = await prompt.run();
        logToFile(`User selected: ${JSON.stringify(selected)}`);

        if (selected.type === 'search') {
            const searchPrompt = new Input({
                message: 'Enter the actual title to search for:',
                initial: ''
            });
            const searchTitle = await searchPrompt.run();
            logToFile(`User searching for: ${searchTitle}`);

            if (!searchTitle.trim()) {
                console.log('   No title entered, using disc name.\n');
                return { type: 'disc', volumeName };
            }

            // Search TMDB with the new title
            console.log(`\n🔍 Searching for "${searchTitle}"...\n`);
            const newMovieResults = await searchTMDB(searchTitle, false);
            const newTvResults = await searchTMDB(searchTitle, true);

            if (newMovieResults.length === 0 && newTvResults.length === 0) {
                console.log(`   ⚠️  No results found for "${searchTitle}" either.\n`);
                return lookupMetadata(volumeName, numTitles, trackDurations, searchOptions);
            }

            // Build new choices from search results
            const newChoices = [];
            newMovieResults.slice(0, 5).forEach(movie => {
                const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
                newChoices.push({
                    name: `Movie: ${movie.title} ${year}`,
                    value: { type: 'movie', data: movie },
                    hint: movie.overview ? movie.overview.substring(0, 80) + '...' : ''
                });
            });
            newTvResults.slice(0, 5).forEach(show => {
                const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
                newChoices.push({
                    name: `TV: ${show.name} ${year}`,
                    value: { type: 'tv', data: show },
                    hint: show.overview ? show.overview.substring(0, 80) + '...' : ''
                });
            });
            newChoices.push({ name: '🔍 Search for a different title...', value: { type: 'search' } });
            newChoices.push({ name: `📀 Use disc name: "${volumeName}" (raw rip)`, value: { type: 'disc' } });

            console.log(`   ✓ Found ${newMovieResults.length} movies, ${newTvResults.length} TV shows\n`);

            const newPrompt = new Select({
                name: 'media',
                message: 'Select the correct match:',
                choices: newChoices.map(c => ({
                    name: c.name,
                    value: c.value,
                    hint: c.hint
                })),
                result(_name) {
                    return this.focused.value;
                }
            });

            const newSelected = await newPrompt.run();
            logToFile(`User selected from new search: ${JSON.stringify(newSelected)}`);

            if (newSelected.type === 'search') {
                return lookupMetadata(volumeName, numTitles, trackDurations, searchOptions);
            } else if (newSelected.type === 'disc') {
                return { type: 'disc', volumeName };
            } else if (newSelected.type === 'tv') {
                const seasonPrompt = new Input({
                    message: 'Enter season number (default: 1):',
                    initial: '1',
                    validate(value) {
                        return /^\d+$/.test(value) || 'Please enter a valid number';
                    }
                });
                const season = parseInt(await seasonPrompt.run());
                const seasonDetails = await getTVSeasonDetails(newSelected.data.id, season);
                const showOverview = await getTVShowDetails(newSelected.data.id);
                const showYear = newSelected.data.first_air_date ? newSelected.data.first_air_date.split('-')[0] : null;
                return {
                    type: 'tv',
                    tmdbId: newSelected.data.id,
                    name: newSelected.data.name,
                    year: showYear,
                    season: season,
                    episodes: seasonDetails ? seasonDetails.episodes : null,
                    showOverview: showOverview || null,
                    discNumber: null
                };
            } else {
                return {
                    type: 'movie',
                    tmdbId: newSelected.data.id,
                    name: newSelected.data.title,
                    year: newSelected.data.release_date ? newSelected.data.release_date.split('-')[0] : null
                };
            }
        } else if (selected.type === 'disc') {
            return { type: 'disc', volumeName };
        } else if (selected.type === 'tv') {
            const seasonPrompt = new Input({
                message: 'Enter season number (default: 1):',
                initial: '1',
                validate(value) {
                    return /^\d+$/.test(value) || 'Please enter a valid number';
                }
            });
            const season = parseInt(await seasonPrompt.run());
            logToFile(`User selected season: ${season}`);

            const seasonDetails = await getTVSeasonDetails(selected.data.id, season);
            const showOverview = await getTVShowDetails(selected.data.id);
            const showYear = selected.data.first_air_date ? selected.data.first_air_date.split('-')[0] : null;

            return {
                type: 'tv',
                tmdbId: selected.data.id,
                name: selected.data.name,
                year: showYear,
                season: season,
                episodes: seasonDetails ? seasonDetails.episodes : null,
                showOverview: showOverview || null,
                discNumber: extractedInfo?.disc || null
            };
        } else {
            return {
                type: 'movie',
                tmdbId: selected.data.id,
                name: selected.data.title,
                year: selected.data.release_date ? selected.data.release_date.split('-')[0] : null
            };
        }
    } catch (error) {
        console.log('\nUsing disc name as fallback\n');
        logToFile('User cancelled selection or error occurred');
        return { type: 'disc', volumeName };
    }
}

/**
 * Guided metadata selection for naked invocations (juice-it with no arguments)
 * Shows disc info, searches TMDB, and presents an interactive menu
 *
 * @param {string} volumeName - DVD volume name
 * @param {number} numTitles - Number of titles on disc
 * @param {Object} trackDurations - Track durations map
 * @returns {Promise<Object|null>} Metadata object or null if cancelled
 */
async function guidedMetadataSelection(volumeName, numTitles, trackDurations) {
    const { searchTMDB, getTVSeasonDetails, getTVShowDetails } = getTmdb();

    // Clean up volume name for initial search
    const cleanName = volumeName
        .replace(/_/g, ' ')
        .replace(/\s+D\d+$/i, '')
        .replace(/DISC\s*\d+$/i, '')
        .trim();

    const mediaType = guessMediaType(numTitles, trackDurations);

    console.log('\n🔍 Searching TMDB...');
    logToFile(`Guided selection: searching for "${cleanName}" (guessing type: ${mediaType})`);

    // Search both movie and TV
    let movieResults = await searchTMDB(cleanName, false);
    let tvResults = await searchTMDB(cleanName, true);

    // Loop to allow re-searching
    while (true) {
        const choices = [];

        // Add TV results first if we think it's a TV show
        if (mediaType === 'tv') {
            tvResults.slice(0, 5).forEach(show => {
                const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
                choices.push({
                    name: `📺 ${show.name} ${year}`,
                    value: { type: 'tv', data: show },
                    hint: show.overview ? show.overview.substring(0, 60) + '...' : ''
                });
            });
            movieResults.slice(0, 5).forEach(movie => {
                const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
                choices.push({
                    name: `🎬 ${movie.title} ${year}`,
                    value: { type: 'movie', data: movie },
                    hint: movie.overview ? movie.overview.substring(0, 60) + '...' : ''
                });
            });
        } else {
            movieResults.slice(0, 5).forEach(movie => {
                const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
                choices.push({
                    name: `🎬 ${movie.title} ${year}`,
                    value: { type: 'movie', data: movie },
                    hint: movie.overview ? movie.overview.substring(0, 60) + '...' : ''
                });
            });
            tvResults.slice(0, 5).forEach(show => {
                const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
                choices.push({
                    name: `📺 ${show.name} ${year}`,
                    value: { type: 'tv', data: show },
                    hint: show.overview ? show.overview.substring(0, 60) + '...' : ''
                });
            });
        }

        // Add utility options
        choices.push({ name: '🔍 Search with different query...', value: { type: 'search' } });
        choices.push({ name: '📀 Skip metadata (raw rip)', value: { type: 'raw' } });
        choices.push({ name: '❌ Cancel', value: { type: 'cancel' } });

        // Show message if no TMDB results
        if (movieResults.length === 0 && tvResults.length === 0) {
            console.log(`\n   ⚠️  No TMDB results found for "${cleanName}"`);
            console.log('   You can search for a different title or enter one manually.\n');
        }

        try {
            const selectPrompt = new Select({
                message: 'Select a title or action:',
                choices: choices
            });

            const selected = getChoiceValue(await selectPrompt.run(), choices);

            if (selected.type === 'cancel') {
                return null;
            }

            if (selected.type === 'raw') {
                console.log('\n  📀 Raw Rip Mode\n');
                console.log('  Skipping metadata lookup and smart mapping.');
                console.log('  Tracks will be named: ' + volumeName + '_1.mp4, ' + volumeName + '_2.mp4, etc.\n');
                return { type: 'raw', volumeName };
            }

            if (selected.type === 'search') {
                const searchPrompt = new Input({
                    message: 'Enter search query:',
                    initial: cleanName
                });
                const newQuery = await searchPrompt.run();
                if (newQuery && newQuery.trim()) {
                    console.log(`\n🔍 Searching for "${newQuery}"...\n`);
                    movieResults = await searchTMDB(newQuery, false);
                    tvResults = await searchTMDB(newQuery, true);
                }
                continue; // Loop back to show results
            }

            // Handle TV show selection - prompt for season
            if (selected.type === 'tv') {
                const show = selected.data;
                const showYear = show.first_air_date ? show.first_air_date.split('-')[0] : null;

                const seasonPrompt = new Input({
                    message: `Which season of "${show.name}"?`,
                    initial: '1',
                    validate(value) {
                        const num = parseInt(value, 10);
                        if (isNaN(num) || num < 1) {
                            return 'Please enter a valid season number';
                        }
                        return true;
                    }
                });

                const seasonInput = await seasonPrompt.run();
                const season = parseInt(seasonInput, 10);

                console.log(`\n   ✓ Selected: ${show.name} - Season ${season}\n`);

                const seasonDetails = await getTVSeasonDetails(show.id, season);
                const showOverview = await getTVShowDetails(show.id);

                return {
                    type: 'tv',
                    tmdbId: show.id,
                    name: show.name,
                    year: showYear,
                    season: season,
                    episodes: seasonDetails ? seasonDetails.episodes : null,
                    showOverview: showOverview || null,
                    discNumber: null  // Guided selection doesn't track disc number
                };
            }

            // Handle movie selection
            if (selected.type === 'movie') {
                const movie = selected.data;
                console.log(`\n   ✓ Selected: ${movie.title}\n`);
                return {
                    type: 'movie',
                    tmdbId: movie.id,
                    name: movie.title,
                    year: movie.release_date ? movie.release_date.split('-')[0] : null
                };
            }

        } catch (error) {
            // User cancelled with Ctrl+C
            return null;
        }
    }
}

module.exports = {
    setLogFunction,
    setConfigLoader,
    guessMediaType,
    lookupMetadata,
    guidedMetadataSelection
};
