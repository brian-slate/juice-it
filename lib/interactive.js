/**
 * JuiceIt Interactive Review Flows
 *
 * Handles all interactive review workflows including:
 * - TMDB match review (Phase 1)
 * - AI track mapping review (Phase 2)
 * - Final confirmation before ripping (Phase 3)
 * - Track editing utilities
 */

const { Select, Input } = require('enquirer');

const { sanitizeForPlex, calculateProposedName } = require('./naming');
const { buildMappingFilename, buildProposedMappingsFromAI } = require('./mapping');

// Lazy-loaded modules
let metadata = null;
let ai = null;
let logger = null;

function getMetadataModule() {
    if (!metadata) {
        metadata = require('./metadata');
    }
    return metadata;
}

function getAi() {
    if (!ai) {
        ai = require('./ai');
    }
    return ai;
}

function _getLogger() {
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
 * Display a formatted mapping table
 *
 * @param {Array} mappings - Array of AI mapping objects
 * @param {Object} contentMetadata - Metadata with episodes array
 */
function displayMappingTable(mappings, contentMetadata) {
    const episodes = contentMetadata.episodes || [];

    console.log('  Track  Duration  Mapping                              Confidence');
    console.log('  -----  --------  -----------------------------------  ----------');

    for (const m of mappings) {
        const trackStr = String(m.trackNum).padStart(2);
        const durationStr = `${m.trackDuration || '?'} min`.padEnd(8);
        const confidence = m.confidence !== undefined ? `${Math.round(m.confidence * 100)}%` : '?';

        let mappingStr;
        if (m.shouldSkip) {
            const skipType = m.extraType || 'skip';
            const desc = m.extraDescription ? `: ${m.extraDescription}` : '';
            mappingStr = `(skip - ${skipType}${desc})`;
        } else if (m.episodeIndex !== null && m.episodeIndex !== undefined) {
            const epStart = m.episodeIndex + 1;
            const epEnd = m.episodeEndIndex !== null && m.episodeEndIndex !== undefined
                ? m.episodeEndIndex + 1
                : epStart;
            const epRange = epStart === epEnd ? `E${epStart}` : `E${epStart}-E${epEnd}`;

            // Get episode title(s)
            let epTitle = '';
            const startEp = episodes.find(e => e.episode_number === epStart);
            if (startEp) {
                epTitle = startEp.name ? ` "${startEp.name.substring(0, 25)}${startEp.name.length > 25 ? '...' : ''}"` : '';
            }
            mappingStr = `${epRange}${epTitle}`;
        } else {
            mappingStr = '(unmapped)';
        }

        console.log(`  ${trackStr}     ${durationStr}  ${mappingStr.padEnd(35)}  ${confidence}`);
    }
    console.log('');
}

/**
 * Review Point 1: TMDB Match Review (Phase 1 Menu)
 * Shows what AI found and lets user accept, edit search query, or exit
 *
 * @param {Object} contentMetadata - Current metadata from TMDB match (null if lookup failed)
 * @param {string} volumeName - DVD volume name
 * @param {string} currentQuery - Current search query (for pre-filling edit input)
 * @returns {Promise<{action: string, newQuery?: string}>}
 */
async function reviewTmdbMatch(contentMetadata, volumeName, currentQuery = null) {
    console.log('\n' + '━'.repeat(60));
    console.log('  Phase 1: TMDB Match');
    console.log('━'.repeat(60));

    // Display what was found (or no match message)
    if (contentMetadata && contentMetadata.type === 'tv') {
        console.log(`  Match found: "${contentMetadata.name}"`);
        if (contentMetadata.year) console.log(`    Year: ${contentMetadata.year}`);
        console.log(`    Season ${contentMetadata.season} (${contentMetadata.episodes?.length || 0} episodes)`);
        if (contentMetadata.discNumber) {
            console.log(`    Disc: ${contentMetadata.discNumber}`);
        }
    } else if (contentMetadata && contentMetadata.type === 'movie') {
        console.log(`  Match found: "${contentMetadata.name}" (${contentMetadata.year || 'year unknown'})`);
    } else if (contentMetadata && contentMetadata.type === 'custom') {
        console.log(`  Using custom title: "${contentMetadata.name}"`);
    } else if (!contentMetadata) {
        console.log(`  ⚠️  No match found for: "${currentQuery || volumeName}"`);
    } else {
        console.log(`  Using disc name: "${contentMetadata.volumeName || volumeName}"`);
    }
    console.log('');

    const menuChoices = [
        { name: 'Accept and continue', value: 'accept' },
        { name: 'Edit search query...', value: 'edit_query' },
        { name: 'Exit', value: 'exit' }
    ];
    const menu = new Select({
        message: 'What would you like to do?',
        choices: menuChoices
    });

    try {
        const choice = getChoiceValue(await menu.run(), menuChoices);

        if (choice === 'accept') {
            return { action: 'accept' };
        } else if (choice === 'edit_query') {
            // Show helpful tips and prompt for new query (pre-filled with current)
            console.log('');
            console.log('  💡 Tips: Include show/movie name, "season X", "disc X", or year');
            console.log(`  📀 Disc: "${volumeName}"`);
            console.log('');

            const input = new Input({
                message: 'Search query:',
                initial: currentQuery || ''  // Pre-fill with current query
            });
            const newQuery = await input.run();

            if (!newQuery || newQuery.trim() === '') {
                // Empty input - stay on menu (return action that keeps us in Phase 1)
                return { action: 'stay' };
            }
            return { action: 'edit_query', newQuery: newQuery.trim() };
        }

        return { action: choice };
    } catch (err) {
        return { action: 'exit' };
    }
}

/**
 * Review Point 2: Track Mapping Review (Phase 2 Menu)
 * Shows AI mapping results and lets user change start episode, edit tracks, or accept
 *
 * @param {Object} aiMappingResult - AI mapping results
 * @param {Object} contentMetadata - Metadata with episodes
 * @param {Object} trackDurations - Track durations
 * @param {Object} lsdvdMetadata - lsdvd metadata
 * @param {number|null} currentStartEpisode - Current start episode override
 * @returns {Promise<{action: string, newStartEpisode?: number, mappings?: Array}>}
 */
async function reviewTrackMapping(aiMappingResult, contentMetadata, trackDurations, lsdvdMetadata, currentStartEpisode = null) {
    const { countEpisodeLikeTracks } = getAi();
    const episodes = contentMetadata.episodes || [];
    const totalEpisodes = episodes.length;

    // Calculate estimated episode count from tracks
    const estimatedEpCount = countEpisodeLikeTracks(trackDurations, contentMetadata);

    // Infer start episode based on disc position
    let inferredStart = 1;
    if (contentMetadata.discNumber && contentMetadata.discNumber > 1 && totalEpisodes > 0) {
        inferredStart = Math.max(1, totalEpisodes - estimatedEpCount + 1);
    }

    // Display results
    console.log('\n' + '━'.repeat(60));
    console.log('  Phase 2: Smart Track Mapping');
    console.log('━'.repeat(60));
    console.log(`  Start episode: ${currentStartEpisode || inferredStart} (${currentStartEpisode ? 'user override' : 'auto-detected'})`);
    console.log(`    Based on ~${estimatedEpCount} episode tracks, disc ${contentMetadata.discNumber || '1'}, ${totalEpisodes} total episodes`);
    console.log('');

    // Show mapping table
    displayMappingTable(aiMappingResult.mappings, contentMetadata);

    const trackMenuChoices = [
        { name: 'Accept all and continue', value: 'accept' },
        { name: 'Change start episode...', value: 'changeStart' },
        { name: 'Edit individual track...', value: 'editTrack' },
        { name: 'Re-run smart mapping', value: 'remap' },
        { name: '← Back to TMDB match', value: 'back' },
        { name: 'Exit', value: 'exit' }
    ];
    const menu = new Select({
        message: 'What would you like to do?',
        choices: trackMenuChoices
    });

    try {
        const choice = getChoiceValue(await menu.run(), trackMenuChoices);

        if (choice === 'accept') {
            return { action: 'accept', mappings: aiMappingResult.mappings };
        } else if (choice === 'changeStart') {
            // Check if we have episodes to show
            if (episodes.length === 0) {
                console.log('\n  ⚠️  No episode data available from TMDB');
                console.log('  Try re-running smart mapping instead.\n');
                return { action: 'stay' };  // Stay on Phase 2 menu
            }

            // Show ALL episodes from TMDB season with formatted numbers
            const episodeChoices = episodes.map(ep => ({
                name: `E${String(ep.episode_number).padStart(2, '0')}: ${ep.name || 'Untitled'} (${ep.runtime || '?'} min)`,
                value: ep.episode_number
            }));
            episodeChoices.push({ name: '← Cancel', value: 'cancel' });

            const picker = new Select({
                message: 'Select starting episode for this disc:',
                choices: episodeChoices
            });
            const picked = getChoiceValue(await picker.run(), episodeChoices);

            if (picked === 'cancel') {
                return { action: 'stay' };  // Stay on Phase 2 menu (no recursion)
            }
            return { action: 'changeStart', newStartEpisode: picked };
        } else if (choice === 'editTrack') {
            // Edit individual track - mutates mappings in place
            await editIndividualTrack(aiMappingResult.mappings, contentMetadata);
            return { action: 'stay' };  // Stay on Phase 2 menu (no recursion)
        } else if (choice === 'remap') {
            return { action: 'remap' };
        }

        return { action: choice }; // 'back' or 'exit'
    } catch (err) {
        return { action: 'exit' };
    }
}

/**
 * Edit an individual track in the mapping
 *
 * @param {Array} mappings - Array of mapping objects (mutated in place)
 * @param {Object} contentMetadata - Metadata with episodes
 * @returns {Promise<Array>} Updated mappings array
 */
async function editIndividualTrack(mappings, contentMetadata) {
    // Select which track to edit
    const trackChoices = mappings.map(m => {
        const epInfo = m.episodeIndex !== null && m.episodeIndex !== undefined
            ? `E${m.episodeIndex + 1}${m.episodeEndIndex !== null && m.episodeEndIndex !== undefined ? `-E${m.episodeEndIndex + 1}` : ''}`
            : '(skip)';
        return {
            name: `Track ${m.trackNum}: ${epInfo} - ${m.trackDuration || '?'}min [${Math.round((m.confidence || 0) * 100)}%]`,
            value: m.trackNum
        };
    });
    trackChoices.push({ name: '← Back', value: 'back' });

    const trackPicker = new Select({
        message: 'Select track to edit:',
        choices: trackChoices
    });

    try {
        const selectedTrack = getChoiceValue(await trackPicker.run(), trackChoices);
        if (selectedTrack === 'back') return mappings;

        const mapping = mappings.find(m => m.trackNum === selectedTrack);
        if (!mapping) return mappings;

        // Build the current proposed filename for display
        const currentFilename = mapping.proposedName || buildMappingFilename(mapping, contentMetadata);
        console.log(`\n  Current: ${currentFilename}`);
        console.log('');

        // Edit menu for the selected track
        const editMenuChoices = [
            { name: 'Reassign to different episode', value: 'reassign' },
            { name: 'Edit track filename...', value: 'editName' },
            { name: mapping.shouldSkip ? 'Mark as episode (un-skip)' : 'Mark as skip', value: 'toggleSkip' },
            { name: '← Back', value: 'back' }
        ];
        const editMenu = new Select({
            message: `Edit Track ${selectedTrack}:`,
            choices: editMenuChoices
        });

        const editChoice = getChoiceValue(await editMenu.run(), editMenuChoices);

        if (editChoice === 'reassign') {
            // Show all episodes from TMDB season
            const episodeChoices = (contentMetadata.episodes || []).map(ep => ({
                name: `E${ep.episode_number}: ${ep.name || 'Untitled'} (${ep.runtime || '?'}min)`,
                value: ep.episode_number
            }));
            episodeChoices.push({ name: '← Cancel', value: 'cancel' });

            const epPicker = new Select({
                message: 'Assign to episode:',
                choices: episodeChoices
            });
            const newEp = getChoiceValue(await epPicker.run(), episodeChoices);
            if (newEp !== 'cancel') {
                mapping.episodeIndex = newEp - 1;
                mapping.episodeEndIndex = null; // Clear multi-ep
                mapping.shouldSkip = false;
                mapping.proposedName = null; // Clear custom name
                console.log(`  ✓ Track ${selectedTrack} reassigned to Episode ${newEp}`);
                logToFile(`Interactive: Track ${selectedTrack} reassigned to Episode ${newEp}`);
            }
        } else if (editChoice === 'editName') {
            // Edit the entire filename in place
            const input = new Input({
                message: 'Edit filename:',
                initial: currentFilename // Pre-fill with current name for easy editing
            });
            const newName = await input.run();
            if (newName && newName.trim()) {
                mapping.proposedName = newName.trim();
                mapping.customFilename = true; // Flag that user edited this
                console.log(`  ✓ Track ${selectedTrack} renamed to: ${newName.trim()}`);
                logToFile(`Interactive: Track ${selectedTrack} renamed to: ${newName.trim()}`);
            }
        } else if (editChoice === 'toggleSkip') {
            mapping.shouldSkip = !mapping.shouldSkip;
            if (mapping.shouldSkip) {
                mapping.extraType = 'other';
                mapping.extraDescription = 'User marked as skip';
            }
            console.log(`  ✓ Track ${selectedTrack} ${mapping.shouldSkip ? 'will be skipped' : 'will be included'}`);
            logToFile(`Interactive: Track ${selectedTrack} ${mapping.shouldSkip ? 'marked skip' : 'unmarked skip'}`);
        }

        return mappings;
    } catch (err) {
        return mappings;
    }
}

/**
 * Review Point 3: Final Confirmation Before Ripping (Phase 3 Menu)
 *
 * @param {Array} proposedMappings - Array of proposed mappings
 * @param {Object} contentMetadata - Metadata
 * @returns {Promise<{action: string}>}
 */
async function reviewFinalMappings(proposedMappings, _contentMetadata) {
    console.log('\n' + '━'.repeat(60));
    console.log('  Phase 3: Ready to Rip');
    console.log('━'.repeat(60));

    const toRip = proposedMappings.filter(m => m.status !== 'skip' && m.status !== 'unrippable');
    const toSkip = proposedMappings.filter(m => m.status === 'skip');
    const unrippable = proposedMappings.filter(m => m.status === 'unrippable');

    console.log(`  ${toRip.length} track(s) will be ripped:`);
    console.log('');
    for (const m of toRip.slice(0, 10)) { // Show first 10
        console.log(`    ${m.proposedName}`);
    }
    if (toRip.length > 10) {
        console.log(`    ... and ${toRip.length - 10} more`);
    }

    if (toSkip.length > 0) {
        console.log('');
        console.log(`  ${toSkip.length} track(s) will be skipped:`);
        for (const m of toSkip.slice(0, 3)) {
            console.log(`    Track ${m.trackNum} ${m.proposedName}`);
        }
        if (toSkip.length > 3) {
            console.log(`    ... and ${toSkip.length - 3} more`);
        }
    }

    if (unrippable.length > 0) {
        console.log('');
        console.log(`  ${unrippable.length} track(s) unrippable (copy-protected)`);
    }
    console.log('');

    const finalMenuChoices = [
        { name: '▶ START RIPPING', value: 'rip' },
        { name: 'Edit track mappings...', value: 'edit' },
        { name: '← Back to track mapping', value: 'back' },
        { name: 'Exit', value: 'exit' }
    ];
    const menu = new Select({
        message: 'What would you like to do?',
        choices: finalMenuChoices
    });

    try {
        const choice = getChoiceValue(await menu.run(), finalMenuChoices);
        return { action: choice };
    } catch (err) {
        return { action: 'exit' };
    }
}

/**
 * Main orchestration function for enhanced interactive step-through mode
 * Uses a clean state machine design with explicit state transitions
 *
 * States: PHASE_1 (TMDB Match) → PHASE_2 (AI Mapping) → PHASE_3 (Final Review) → DONE/EXIT
 *
 * @param {string} volumeName - DVD volume name
 * @param {number} numTitles - Number of titles on disc
 * @param {Object} trackDurations - Track durations
 * @param {Object} lsdvdMetadata - lsdvd metadata
 * @param {Object} options - Options {searchQuery, unrippableTracks}
 * @returns {Promise<{metadata: Object, proposedMappings: Array}|null>}
 */
async function interactiveStepThrough(volumeName, numTitles, trackDurations, lsdvdMetadata, options = {}) {
    const { lookupMetadata } = getMetadataModule();
    const { aiMapTracks } = getAi();
    const config = loadConfigFn();

    // State variables
    let state = 'PHASE_1';
    let searchQuery = options.searchQuery || null;
    let contentMetadata = null;
    let aiMappingResult = null;
    let proposedMappings = [];
    let startEpisodeOverride = null;
    const unrippableTracks = options.unrippableTracks || [];

    // State machine loop
    while (state !== 'DONE' && state !== 'EXIT') {
        switch (state) {
            case 'PHASE_1': {
                // ========== PHASE 1: TMDB MATCH ==========
                // Run TMDB lookup if we don't have metadata yet
                if (!contentMetadata) {
                    contentMetadata = await lookupMetadata(volumeName, numTitles, trackDurations, {
                        searchQuery: searchQuery
                    }, lsdvdMetadata);
                }

                // Show Phase 1 menu
                const review1 = await reviewTmdbMatch(contentMetadata, volumeName, searchQuery);

                if (review1.action === 'exit') {
                    state = 'EXIT';
                } else if (review1.action === 'edit_query') {
                    // Update search query and clear metadata to force re-lookup
                    searchQuery = review1.newQuery;
                    contentMetadata = null;
                    aiMappingResult = null;  // Clear AI results too
                } else if (review1.action === 'stay') {
                    // User cancelled input - stay in Phase 1
                } else if (review1.action === 'accept') {
                    if (!contentMetadata) {
                        console.log('\n  ⚠️  No metadata to accept. Please edit search query.\n');
                    } else {
                        state = 'PHASE_2';
                    }
                }
                break;
            }

            case 'PHASE_2': {
                // ========== PHASE 2: AI TRACK MAPPING ==========
                // Skip for non-TV content
                if (contentMetadata.type !== 'tv') {
                    state = 'PHASE_3';
                    break;
                }

                // Skip if no OpenAI API key
                if (!config.openaiApiKey) {
                    console.log('\n  ⚠️  Smart mapping not available (no OpenAI API key)');
                    console.log('  Proceeding to final review without smart mapping.\n');
                    state = 'PHASE_3';
                    break;
                }

                // Run smart mapping if we don't have results yet
                if (!aiMappingResult) {
                    aiMappingResult = await aiMapTracks(
                        trackDurations,
                        contentMetadata,
                        lsdvdMetadata,
                        unrippableTracks,
                        contentMetadata.discNumber,
                        startEpisodeOverride
                    );

                    if (!aiMappingResult) {
                        console.log('\n  ❌ Smart mapping failed. Please try again or change options.\n');

                        const failMenuChoices = [
                            { name: 'Retry smart mapping', value: 'retry' },
                            { name: '← Back to TMDB match', value: 'back' },
                            { name: 'Exit', value: 'exit' }
                        ];
                        const failMenu = new Select({
                            message: 'What would you like to do?',
                            choices: failMenuChoices
                        });

                        try {
                            const failChoice = getChoiceValue(await failMenu.run(), failMenuChoices);
                            if (failChoice === 'retry') {
                                // Stay in PHASE_2, aiMappingResult is already null
                            } else if (failChoice === 'back') {
                                state = 'PHASE_1';
                            } else {
                                state = 'EXIT';
                            }
                        } catch (err) {
                            state = 'EXIT';
                        }
                        break;
                    }
                }

                // Show Phase 2 menu
                const review2 = await reviewTrackMapping(aiMappingResult, contentMetadata, trackDurations, lsdvdMetadata, startEpisodeOverride);

                if (review2.action === 'exit') {
                    state = 'EXIT';
                } else if (review2.action === 'back') {
                    state = 'PHASE_1';
                } else if (review2.action === 'changeStart') {
                    // Re-run AI with new start episode
                    startEpisodeOverride = review2.newStartEpisode;
                    aiMappingResult = null;  // Clear to force re-map
                } else if (review2.action === 'remap') {
                    aiMappingResult = null;  // Clear to force re-map
                } else if (review2.action === 'stay') {
                    // User cancelled or edited - stay in Phase 2
                } else if (review2.action === 'accept') {
                    state = 'PHASE_3';
                }
                break;
            }

            case 'PHASE_3': {
                // ========== PHASE 3: BUILD PROPOSED MAPPINGS & FINAL REVIEW ==========
                // Build proposed mappings from AI results
                proposedMappings = buildProposedMappingsFromAI(
                    aiMappingResult,
                    contentMetadata,
                    numTitles,
                    trackDurations,
                    { unrippableTracks }
                );

                // Show Phase 3 menu
                const review3 = await reviewFinalMappings(proposedMappings, contentMetadata);

                if (review3.action === 'exit') {
                    state = 'EXIT';
                } else if (review3.action === 'back') {
                    // Go back to Phase 2 for TV with AI, otherwise Phase 1
                    if (contentMetadata.type === 'tv' && config.openaiApiKey) {
                        state = 'PHASE_2';
                    } else {
                        state = 'PHASE_1';
                    }
                } else if (review3.action === 'edit') {
                    // Edit using the existing edit function
                    await editTrackMappingBeforeRip(proposedMappings, contentMetadata, sanitizeForPlex(`${contentMetadata.name}${contentMetadata.year ? ` (${contentMetadata.year})` : ''}`));
                    // Stay in PHASE_3 to re-show menu
                } else if (review3.action === 'rip') {
                    state = 'DONE';
                }
                break;
            }
        }
    }

    // Handle exit
    if (state === 'EXIT') {
        console.log('\n  ✓ Operation cancelled\n');
        return null;
    }

    // Finalize mappings
    for (const mapping of proposedMappings) {
        if (mapping.status === 'pending') {
            mapping.status = mapping.proposedName;
        }
    }

    return { metadata: contentMetadata, proposedMappings };
}

/**
 * Edit track mapping before ripping (for use with non-step-through flows)
 *
 * @param {Array} proposedMappings - Array of proposed mappings
 * @param {Object} contentMetadata - Content metadata
 * @param {string} baseFileName - Base filename for Plex
 */
async function editTrackMappingBeforeRip(proposedMappings, contentMetadata, baseFileName) {
    try {
        // Select track
        const trackChoices = proposedMappings.map(m => {
            const skip = m.status === 'skip' ? '(SKIP) ' : '';
            const aiConf = m.aiConfidence !== null ? ` [AI: ${(m.aiConfidence * 100).toFixed(0)}%]` : '';
            return {
                name: `${skip}Track ${m.trackNum}: ${m.proposedName || 'unknown'} (${m.duration}min)${aiConf}`,
                value: m.trackNum
            };
        });

        const allTrackChoices = [...trackChoices, { name: '← Back', value: 'back' }];
        const trackSelector = new Select({
            message: 'Select track to edit:',
            choices: allTrackChoices
        });

        const selectedTrack = getChoiceValue(await trackSelector.run(), allTrackChoices);
        if (selectedTrack === 'back') return;

        const mapping = proposedMappings.find(m => m.trackNum === selectedTrack);

        // Build episode choices
        const episodeChoices = [];
        if (contentMetadata.type === 'tv' && contentMetadata.episodes) {
            contentMetadata.episodes.forEach((ep, _idx) => {
                const seasonNum = String(contentMetadata.season).padStart(2, '0');
                const episodeNum = String(ep.episode_number).padStart(2, '0');
                const episodeName = ep.name ? `_${ep.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
                const proposedName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}.mp4`;
                episodeChoices.push({
                    name: `S${seasonNum}E${episodeNum} - ${ep.name} (${ep.runtime}min)`,
                    value: proposedName
                });
            });
        }

        episodeChoices.push({ name: 'Mark as Extra/Skip', value: 'SKIP' });
        episodeChoices.push({ name: '← Back', value: 'back' });

        const assignmentMenu = new Select({
            message: `Reassign Track ${selectedTrack} to:`,
            choices: episodeChoices
        });

        const assignment = getChoiceValue(await assignmentMenu.run(), episodeChoices);
        if (assignment === 'back') return;

        if (assignment === 'SKIP') {
            mapping.status = 'skip';
            mapping.proposedName = '(will skip)';
            console.log(`\n  ✓ Track ${selectedTrack} will be skipped\n`);
            logToFile(`Track ${selectedTrack} marked to skip`);
        } else {
            mapping.status = 'pending'; // Still pending but with new name
            mapping.proposedName = assignment;
            console.log(`\n  ✓ Track ${selectedTrack} reassigned to: ${assignment}\n`);
            logToFile(`Track ${selectedTrack} reassigned to: ${assignment}`);
        }
    } catch (err) {
        // User cancelled (Ctrl-C or ESC) - just return to main menu
        console.log('\n  ← Returning to main menu\n');
    }
}

/**
 * Interactive review BEFORE ripping - returns mappings ready to rip
 *
 * @param {Array} proposedMappings - Array of proposed mappings
 * @param {Object} contentMetadata - Content metadata
 * @param {string} volumeName - DVD volume name
 * @param {string} baseFileName - Base filename for Plex
 * @param {Object} options - Options {interactive, planOnly, verbose}
 * @returns {Promise<Array|null>} Finalized mappings or null if cancelled
 */
async function reviewAndMapEpisodesBeforeRip(proposedMappings, contentMetadata, volumeName, baseFileName, options = {}) {
    const { interactive = false, planOnly = false, verbose = false } = options;

    const hasAI = proposedMappings.some(m => m.aiReasoning);

    console.log('\n' + '━'.repeat(60));
    if (hasAI) {
        console.log('  📋 Review Track Mappings (Smart)');
    } else {
        console.log('  📋 Review Track Mappings (Before Ripping)');
    }
    console.log('━'.repeat(60));
    console.log('');

    // Display track table
    console.log('  Track  Duration  Status  Proposed Name');
    console.log('  -----  --------  ------  ' + '-'.repeat(40));

    for (const mapping of proposedMappings) {
        const trackStr = String(mapping.trackNum).padStart(2);
        const durationStr = `${mapping.duration} min`.padEnd(8);

        // Status icon based on AI confidence or status
        let statusIcon;
        if (mapping.status === 'skip') {
            statusIcon = '⏭';
        } else if (mapping.aiConfidence !== null) {
            statusIcon = mapping.aiConfidence >= 0.7 ? '✓' : '⚠️';
        } else {
            statusIcon = '✓';
        }

        const proposedName = mapping.proposedName || 'unknown';
        console.log(`  ${trackStr}     ${durationStr}  ${statusIcon}     ${proposedName}`);

        // Show confidence and reasoning if available
        if (mapping.aiConfidence !== null) {
            const confidenceStr = `${(mapping.aiConfidence * 100).toFixed(0)}%`;
            if (verbose && mapping.aiReasoning) {
                console.log(`         Match (${confidenceStr}): ${mapping.aiReasoning}`);
            } else if (mapping.aiReasoning) {
                // Show brief reasoning in non-verbose mode
                const shortReason = mapping.aiReasoning.length > 60
                    ? mapping.aiReasoning.substring(0, 57) + '...'
                    : mapping.aiReasoning;
                console.log(`         Match (${confidenceStr}): ${shortReason}`);
            }
        }
    }

    if (hasAI) {
        console.log('');
        console.log('  ✨ Tracks analyzed and mapped automatically');
        if (!verbose) {
            console.log('  ℹ️  Use --verbose to see full reasoning for each track');
        }
    }

    console.log('');

    // Check if using sequential mapping (user selected fallback - needs manual review)
    const usingSequentialFallback = proposedMappings.some(m => m.aiReasoning && m.aiReasoning.includes('Sequential mapping'));

    // Default behavior: auto-accept smart mapping (unless --interactive flag is set)
    // Sequential fallback always requires interactive review
    if (!interactive && !usingSequentialFallback) {
        if (hasAI) {
            console.log('  ✓ Auto-accepting smart mapping\n');
        } else {
            console.log('  ✓ Auto-accepting mapping\n');
        }

        // Save plan if in plan-only mode
        if (planOnly) {
            const { savePlan } = require('./mapping');
            savePlan(options.outputDir, proposedMappings, contentMetadata, volumeName, baseFileName);
            console.log('\n  ✓ Plan saved!\n');
            return null;
        }

        // Finalize mappings
        for (const mapping of proposedMappings) {
            if (mapping.status === 'pending') {
                mapping.status = mapping.proposedName;
            }
        }
        return proposedMappings;
    }

    // Interactive mode or sequential fallback - show review menu
    if (usingSequentialFallback) {
        console.log('  ⚠️  Using sequential mapping (smart mapping not available or failed)');
        console.log('  ⚠️  Sequential mapping may assign tracks to wrong episodes.');
        console.log('  ⚠️  Please review and adjust mappings before proceeding.\n');
    }

    // Main menu loop
    while (true) {
        const mainMenu = new Select({
            message: 'What would you like to do?',
            choices: [
                'Edit Track Mapping',
                'Re-search TMDB and Re-auto-map',
                'Accept All and Start Ripping',
                'Cancel'
            ]
        });

        try {
            const choice = await mainMenu.run();

            if (choice === 'Edit Track Mapping') {
                await editTrackMappingBeforeRip(proposedMappings, contentMetadata, baseFileName);
            } else if (choice === 'Re-search TMDB and Re-auto-map') {
                const { lookupMetadata } = getMetadataModule();
                const newMetadata = await lookupMetadata(volumeName, proposedMappings.length, null, {});
                if (newMetadata && newMetadata.type !== 'disc') {
                    Object.assign(contentMetadata, newMetadata);
                    // Re-calculate proposed names
                    for (let i = 0; i < proposedMappings.length; i++) {
                        if (proposedMappings[i].status !== 'skip') {
                            proposedMappings[i].proposedName = calculateProposedName(i, contentMetadata, baseFileName, proposedMappings.length);
                        }
                    }
                }
            } else if (choice === 'Accept All and Start Ripping') {
                // Save plan if in plan-only mode
                if (planOnly) {
                    const { savePlan } = require('./mapping');
                    savePlan(options.outputDir, proposedMappings, contentMetadata, volumeName, baseFileName);
                    console.log('\n  ✓ Plan saved!\n');
                    return null;
                }

                // Finalize mappings - set status to the final filename
                for (const mapping of proposedMappings) {
                    if (mapping.status === 'pending') {
                        mapping.status = mapping.proposedName;
                    }
                }
                return proposedMappings;
            } else {
                console.log('\n  ✓ Operation cancelled\n');
                return null;
            }
        } catch (err) {
            console.log('\n  ✓ Operation cancelled\n');
            return null;
        }

        // Redisplay table after action
        console.log('');
        console.log('  Track  Duration  Status  Proposed Name');
        console.log('  -----  --------  ------  ' + '-'.repeat(40));

        for (const mapping of proposedMappings) {
            const trackStr = String(mapping.trackNum).padStart(2);
            const durationStr = `${mapping.duration} min`.padEnd(8);
            const statusIcon = mapping.status === 'skip' ? '⏭' : '✓';
            const proposedName = mapping.proposedName || 'unknown';
            console.log(`  ${trackStr}     ${durationStr}  ${statusIcon}     ${proposedName}`);
        }
        console.log('');
    }
}

/**
 * Confirm before ripping - "Ready to Juice?"
 * Shows summary and asks user to confirm before starting encoding.
 *
 * @param {Array} proposedMappings - Array of proposed mapping objects
 * @param {Object} contentMetadata - Content metadata
 * @param {Object} options - Options {searchQuery, interactive}
 * @returns {Promise<{action: string, newQuery?: string}>} User's chosen action
 */
async function confirmBeforeRip(proposedMappings, contentMetadata, options = {}) {
    const toRip = proposedMappings.filter(m => m.status !== 'skip' && m.status !== 'unrippable');
    const toSkip = proposedMappings.filter(m => m.status === 'skip').length;
    const unrippable = proposedMappings.filter(m => m.status === 'unrippable').length;

    console.log('');
    console.log('━'.repeat(60));
    console.log('  🍊 Ready to Juice?');
    console.log('━'.repeat(60));
    console.log('');

    // Show content summary
    if (contentMetadata.type === 'tv') {
        console.log(`  📺 ${contentMetadata.name} - Season ${contentMetadata.season}`);
        if (contentMetadata.year) {
            console.log(`     Year: ${contentMetadata.year}`);
        }
    } else if (contentMetadata.type === 'movie') {
        const yearStr = contentMetadata.year ? ` (${contentMetadata.year})` : '';
        console.log(`  🎬 ${contentMetadata.name}${yearStr}`);
    } else {
        console.log(`  📀 ${contentMetadata.name || 'Custom title'}`);
    }
    console.log('');

    // Show track summary
    console.log(`  Tracks to rip: ${toRip.length}`);
    if (toSkip > 0) {
        console.log(`  Tracks to skip: ${toSkip}`);
    }
    if (unrippable > 0) {
        console.log(`  Unrippable (copy-protected): ${unrippable}`);
    }
    console.log('');

    // Preview first 5 filenames
    if (toRip.length > 0) {
        console.log('  Preview (first 5 files):');
        const preview = toRip.slice(0, 5);
        for (const m of preview) {
            const filename = m.proposedName || m.status || 'unknown';
            // Truncate long filenames
            const displayName = filename.length > 50 ? filename.substring(0, 47) + '...' : filename;
            console.log(`    • ${displayName}`);
        }
        if (toRip.length > 5) {
            console.log(`    ... and ${toRip.length - 5} more`);
        }
        console.log('');
    }

    // Build choices - different options based on context
    const choices = [
        { name: '🍊 Juice it!', value: 'rip' },
        { name: '✏️  Edit mappings', value: 'edit' }
    ];

    // Add re-search option if we can provide a new query
    if (!options.rawMode) {
        choices.push({ name: '🔍 Re-search with different query', value: 'search' });
    }

    // Add full interactive mode option if not already in interactive mode
    if (!options.interactive) {
        choices.push({ name: '📋 Full interactive mode', value: 'interactive' });
    }

    choices.push({ name: '❌ Cancel', value: 'cancel' });

    try {
        const confirmPrompt = new Select({
            message: 'What would you like to do?',
            choices: choices
        });

        const selectedName = await confirmPrompt.run();
        const choice = getChoiceValue(selectedName, choices);

        // Handle re-search: prompt for new query
        if (choice === 'search') {
            const searchPrompt = new Input({
                message: 'Enter new search query:',
                initial: options.searchQuery || ''
            });
            const newQuery = await searchPrompt.run();

            if (newQuery && newQuery.trim()) {
                return { action: 'search', newQuery: newQuery.trim() };
            } else {
                // Empty query - stay where we are
                return confirmBeforeRip(proposedMappings, contentMetadata, options);
            }
        }

        return { action: choice };
    } catch (e) {
        // User cancelled (Ctrl+C)
        return { action: 'cancel' };
    }
}

module.exports = {
    setLogFunction,
    setConfigLoader,
    displayMappingTable,
    reviewTmdbMatch,
    reviewTrackMapping,
    editIndividualTrack,
    reviewFinalMappings,
    interactiveStepThrough,
    editTrackMappingBeforeRip,
    reviewAndMapEpisodesBeforeRip,
    confirmBeforeRip
};
