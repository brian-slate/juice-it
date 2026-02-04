/**
 * JuiceIt Track Mapping Utilities
 *
 * Handles building proposed mappings from AI results, and plan persistence.
 */

const fs = require('fs');
const path = require('path');

const { sanitizeForPlex, calculateProposedName, buildExtrasFileName } = require('./naming');

// Lazy-loaded logger
let logger = null;
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
 * Set the file logging function
 * @param {Function} fn - Function to log to file
 */
function setLogFunction(fn) {
    logToFile = fn;
}

/**
 * Build proposed mappings array from AI mapping results
 *
 * @param {Object|null} aiMappingResult - AI mapping results
 * @param {Object} metadata - Content metadata
 * @param {number} numTitles - Total number of titles on disc
 * @param {Object} trackDurations - Map of track numbers to durations
 * @param {Object} options - Options {mainOnly, unrippableTracks}
 * @returns {Array} Array of proposed mapping objects
 */
function buildProposedMappingsFromAI(aiMappingResult, metadata, numTitles, trackDurations, options = {}) {
    const { mainOnly = false, unrippableTracks = [] } = options;
    const proposedMappings = [];
    const yearStr = metadata.year ? ` (${metadata.year})` : '';
    const baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);

    for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
        const trackDuration = trackDurations ? trackDurations[titleNumber] : null;
        let proposedName;
        let status = 'pending';
        let aiReasoning = null;
        let aiConfidence = null;

        // Mark tracks as unrippable (0, null, or undefined duration = unrippable)
        if (trackDuration === 0 || trackDuration === null || trackDuration === undefined) {
            status = 'unrippable';
            proposedName = '(unrippable - 0 duration)';
            aiReasoning = 'Track has 0 duration (copy-protected or invalid)';
        } else if (unrippableTracks.includes(titleNumber)) {
            status = 'unrippable';
            proposedName = '(unrippable - stuck during scan)';
            aiReasoning = 'Track caused scan to hang (likely copy-protected)';
        } else if (aiMappingResult && aiMappingResult.mappings) {
            const aiMapping = aiMappingResult.mappings.find(m => m.trackNum === titleNumber);
            if (aiMapping) {
                if (aiMapping.customFilename && aiMapping.proposedName) {
                    // User edited this filename
                    proposedName = aiMapping.proposedName;
                    aiReasoning = 'User-edited filename';
                } else if (aiMapping.shouldSkip) {
                    const extraType = aiMapping.extraType || 'featurette';
                    const extraDescription = aiMapping.extraDescription || null;

                    if (extraType === 'other' || mainOnly) {
                        status = 'skip';
                        proposedName = '(will skip - ' + (extraDescription || extraType) + ')';
                        aiReasoning = aiMapping.reasoning + (mainOnly ? ' (--main-only mode)' : ' (redundant compilation)');
                    } else {
                        proposedName = buildExtrasFileName(baseFileName, titleNumber, extraType, extraDescription);
                        aiReasoning = aiMapping.reasoning + ' (ripping as bonus content)';
                    }
                } else if (aiMapping.episodeIndex !== null && metadata.episodes && metadata.episodes[aiMapping.episodeIndex]) {
                    const endIndex = aiMapping.episodeEndIndex !== undefined ? aiMapping.episodeEndIndex : null;
                    proposedName = calculateProposedName(aiMapping.episodeIndex, metadata, baseFileName, numTitles, endIndex);
                } else if (aiMapping.extraType && aiMapping.extraType !== 'other') {
                    // Bonus content to rip (shouldSkip=false with extraType set)
                    proposedName = buildExtrasFileName(baseFileName, titleNumber, aiMapping.extraType, aiMapping.extraDescription);
                    aiReasoning = aiMapping.reasoning + ' (ripping as bonus content)';
                } else {
                    proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
                }
                aiReasoning = aiReasoning || aiMapping.reasoning;
                aiConfidence = aiMapping.confidence;
            } else {
                // AI didn't analyze this track
                if (mainOnly) {
                    status = 'skip';
                    proposedName = '(will skip)';
                    aiReasoning = 'AI did not analyze this track (--main-only mode)';
                } else {
                    proposedName = buildExtrasFileName(baseFileName, titleNumber);
                    aiReasoning = 'AI did not analyze - ripping as bonus content';
                }
                aiConfidence = null;
            }
        } else {
            // No AI result - use sequential or default
            proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
        }

        proposedMappings.push({
            trackNum: titleNumber,
            filename: null,
            proposedName: proposedName,
            fileSize: 0,
            duration: trackDuration || 0,
            status: status,
            aiReasoning: aiReasoning,
            aiConfidence: aiConfidence
        });
    }

    return proposedMappings;
}

/**
 * Build proposed mappings using sequential assignment (no AI)
 *
 * @param {Object} metadata - Content metadata
 * @param {number} numTitles - Total number of titles on disc
 * @param {Object} trackDurations - Map of track numbers to durations
 * @param {Object} options - Options {mainOnly, unrippableTracks, mainFeatureTrack}
 * @returns {Array} Array of proposed mapping objects
 */
function buildSequentialMappings(metadata, numTitles, trackDurations, options = {}) {
    const { mainOnly = false, unrippableTracks = [], mainFeatureTrack = null } = options;
    const proposedMappings = [];
    const yearStr = metadata.year ? ` (${metadata.year})` : '';
    const baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);

    for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
        const trackDuration = trackDurations ? trackDurations[titleNumber] : null;
        let proposedName;
        let status = 'pending';
        let aiReasoning = null;
        let aiConfidence = null;

        // Mark tracks as unrippable (0, null, or undefined duration = unrippable)
        if (trackDuration === 0 || trackDuration === null || trackDuration === undefined) {
            status = 'unrippable';
            proposedName = '(unrippable - 0 duration)';
            aiReasoning = 'Track has 0 duration (copy-protected or invalid)';
        } else if (unrippableTracks.includes(titleNumber)) {
            status = 'unrippable';
            proposedName = '(unrippable - stuck during scan)';
            aiReasoning = 'Track caused scan to hang (likely copy-protected)';
        } else if (metadata.type === 'movie' && mainFeatureTrack !== null) {
            // Movie handling
            if (titleNumber === mainFeatureTrack) {
                proposedName = `${baseFileName}.mp4`;
                aiReasoning = 'Main feature (longest track)';
                aiConfidence = 1.0;
            } else if (mainOnly) {
                status = 'skip';
                proposedName = '(will skip - extra)';
                aiReasoning = 'Extra/bonus content (--main-only mode)';
                aiConfidence = 1.0;
            } else {
                proposedName = buildExtrasFileName(baseFileName, titleNumber);
                aiReasoning = 'Bonus content (featurette)';
                aiConfidence = 1.0;
            }
        } else {
            // TV shows or no track durations - use original sequential logic
            proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
            if (metadata.type === 'tv') {
                aiReasoning = '⚠️ Sequential mapping (user selected) - verify track assignments';
                aiConfidence = 0;
            }
        }

        proposedMappings.push({
            trackNum: titleNumber,
            filename: null,
            proposedName: proposedName,
            fileSize: 0,
            duration: trackDuration || 0,
            status: status,
            aiReasoning: aiReasoning,
            aiConfidence: aiConfidence
        });
    }

    return proposedMappings;
}

/**
 * Finalize proposed mappings (convert pending to final filenames)
 *
 * @param {Array} proposedMappings - Array of proposed mappings
 * @returns {Array} Array with finalized mappings
 */
function finalizeMappings(proposedMappings) {
    for (const mapping of proposedMappings) {
        if (mapping.status === 'pending') {
            mapping.status = mapping.proposedName;
        }
    }
    return proposedMappings;
}

/**
 * Save rip plan to file
 *
 * @param {string} outputDir - Output directory path
 * @param {Array} proposedMappings - Array of proposed mappings
 * @param {Object} metadata - Content metadata
 * @param {string} volumeName - DVD volume name
 * @param {string} baseFileName - Base filename for Plex
 */
function savePlan(outputDir, proposedMappings, metadata, volumeName, baseFileName) {
    const planPath = path.join(outputDir, 'juiceit-plan.json');

    const plan = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        volumeName,
        baseFileName,
        metadata,
        mappings: proposedMappings.map(m => ({
            trackNum: m.trackNum,
            duration: m.duration,
            status: m.status,
            proposedName: m.proposedName,
            aiReasoning: m.aiReasoning,
            aiConfidence: m.aiConfidence
        }))
    };

    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    logToFile(`Plan saved to: ${planPath}`);

    console.log('');
    console.log('┃'.repeat(60));
    console.log('  📄 Rip Plan Saved');
    console.log('┃'.repeat(60));
    console.log(`  Location: ${path.relative(process.cwd(), planPath)}`);
    console.log('');
    console.log('  Summary:');
    const toRip = proposedMappings.filter(m => m.status !== 'skip').length;
    const toSkip = proposedMappings.filter(m => m.status === 'skip').length;
    console.log(`    • ${toRip} track(s) to rip`);
    console.log(`    • ${toSkip} track(s) to skip`);
    console.log('');
    console.log('  To execute this plan:');
    console.log(`    juiceit`);
    console.log('┃'.repeat(60));
    console.log('');
}

/**
 * Load rip plan from file
 *
 * @param {string} outputDir - Output directory path
 * @returns {Object|null} Plan object or null if not found
 */
function loadPlan(outputDir) {
    const planPath = path.join(outputDir, 'juiceit-plan.json');

    if (!fs.existsSync(planPath)) {
        return null;
    }

    try {
        const planData = fs.readFileSync(planPath, 'utf8');
        const plan = JSON.parse(planData);
        logToFile(`Loaded plan from: ${planPath}`);
        return plan;
    } catch (error) {
        getLogger().debug(`Error loading plan: ${error.message}`);
        return null;
    }
}

/**
 * Delete existing plan file
 *
 * @param {string} outputDir - Output directory path
 */
function deletePlan(outputDir) {
    const planPath = path.join(outputDir, 'juiceit-plan.json');
    if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
    }
}

/**
 * Reconstruct proposed mappings from a saved plan
 *
 * @param {Object} plan - Loaded plan object
 * @param {boolean} finalize - Whether to finalize status (true for immediate rip)
 * @returns {Array} Array of proposed mapping objects
 */
function mappingsFromPlan(plan, finalize = false) {
    return plan.mappings.map(m => ({
        trackNum: m.trackNum,
        filename: null,
        proposedName: m.proposedName,
        fileSize: 0,
        duration: m.duration,
        status: finalize && m.status === 'pending' ? m.proposedName : m.status,
        aiReasoning: m.aiReasoning,
        aiConfidence: m.aiConfidence
    }));
}

/**
 * Find the main feature track for movies (longest track)
 *
 * @param {Object} trackDurations - Map of track numbers to durations
 * @returns {number|null} Track number of main feature or null
 */
function findMainFeatureTrack(trackDurations) {
    if (!trackDurations || Object.keys(trackDurations).length === 0) {
        return null;
    }

    let maxDuration = 0;
    let mainTrack = null;

    for (const [trackNum, duration] of Object.entries(trackDurations)) {
        if (duration > maxDuration) {
            maxDuration = duration;
            mainTrack = parseInt(trackNum, 10);
        }
    }

    return mainTrack;
}

/**
 * Build a filename from a mapping (helper for display)
 *
 * @param {Object} mapping - Mapping object
 * @param {Object} metadata - Content metadata
 * @returns {string} Formatted filename
 */
function buildMappingFilename(mapping, metadata) {
    if (mapping.shouldSkip) {
        return `(skip - ${mapping.extraType || 'other'})`;
    }

    if (mapping.episodeIndex === null || mapping.episodeIndex === undefined) {
        return '(unmapped)';
    }

    const episodes = metadata.episodes || [];
    const ep = episodes[mapping.episodeIndex];
    if (!ep) return '(invalid episode)';

    const yearStr = metadata.year ? ` (${metadata.year})` : '';
    const baseName = sanitizeForPlex(`${metadata.name}${yearStr}`);
    const seasonNum = String(metadata.season).padStart(2, '0');
    const episodeNum = String(ep.episode_number).padStart(2, '0');

    if (mapping.episodeEndIndex !== null && mapping.episodeEndIndex !== undefined) {
        const endEp = episodes[mapping.episodeEndIndex];
        const endEpisodeNum = String(endEp?.episode_number || mapping.episodeEndIndex + 1).padStart(2, '0');
        return `${baseName} - s${seasonNum}e${episodeNum}-e${endEpisodeNum}.mp4`;
    }

    const episodeTitle = ep.name ? ` - ${sanitizeForPlex(ep.name)}` : '';
    return `${baseName} - s${seasonNum}e${episodeNum}${episodeTitle}.mp4`;
}

module.exports = {
    setLogFunction,
    buildProposedMappingsFromAI,
    buildSequentialMappings,
    finalizeMappings,
    savePlan,
    loadPlan,
    deletePlan,
    mappingsFromPlan,
    findMainFeatureTrack,
    buildMappingFilename
};
