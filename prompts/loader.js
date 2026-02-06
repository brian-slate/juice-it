/**
 * Prompt Loader and Template Interpolation
 *
 * Loads prompt templates from markdown files and interpolates variables.
 * This keeps prompts maintainable and separate from application logic.
 */

const fs = require('fs');
const path = require('path');

// Cache for loaded templates
const templateCache = new Map();

/**
 * Load a prompt template from a markdown file
 * @param {string} templateName - Name of the template (without .md extension)
 * @returns {string} The template content
 */
function loadTemplate(templateName) {
    // Check cache first
    if (templateCache.has(templateName)) {
        return templateCache.get(templateName);
    }

    const templatePath = path.join(__dirname, `${templateName}.md`);

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Prompt template not found: ${templatePath}`);
    }

    const content = fs.readFileSync(templatePath, 'utf8');
    templateCache.set(templateName, content);
    return content;
}

/**
 * Interpolate variables in a template
 * Variables are in the format {{variableName}}
 *
 * @param {string} template - The template string
 * @param {Object} variables - Key-value pairs of variables to interpolate
 * @param {Object} options - Optional settings
 * @param {boolean} options.silent - Suppress warnings for missing variables (default: false)
 * @returns {string} The interpolated template
 */
function interpolate(template, variables, options = {}) {
    const { silent = false } = options;
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (Object.hasOwn(variables, key)) {
            const value = variables[key];
            // Handle objects/arrays by converting to JSON string
            if (typeof value === 'object') {
                return JSON.stringify(value, null, 2);
            }
            return String(value);
        }
        // Leave unmatched variables as-is (for debugging)
        if (!silent) {
            console.warn(`Warning: Template variable '${key}' not provided`);
        }
        return match;
    });
}

/**
 * Load and interpolate a prompt template
 * @param {string} templateName - Name of the template
 * @param {Object} variables - Variables to interpolate
 * @returns {string} The rendered prompt
 */
function renderPrompt(templateName, variables = {}) {
    const template = loadTemplate(templateName);
    return interpolate(template, variables);
}

/**
 * Clear the template cache (useful for development/testing)
 */
function clearCache() {
    templateCache.clear();
}

/**
 * Build the TMDB match prompts
 * @param {Object} params - Parameters for the prompt
 * @returns {{ system: string, user: string }} System and user prompts
 */
function buildTmdbMatchPrompts({ volumeName, numTitles, trackDurations, movieResults, tvResults, userQuery = null, extractedInfo = null, lsdvdMetadata = null }) {
    const tmdbData = {
        movies: movieResults.slice(0, 5).map(m => ({
            id: m.id,
            title: m.title,
            year: m.release_date ? m.release_date.split('-')[0] : null,
            overview: m.overview ? m.overview.substring(0, 200) : ''
        })),
        tvShows: tvResults.slice(0, 5).map(s => ({
            id: s.id,
            name: s.name,
            firstAirYear: s.first_air_date ? s.first_air_date.split('-')[0] : null,
            overview: s.overview ? s.overview.substring(0, 200) : ''
        }))
    };

    // Build user query context section
    let userQueryContext = 'No user query provided - matching based on disc volume name only.';
    if (userQuery) {
        userQueryContext = `**User's Search Query**: "${userQuery}"`;
    }

    // Build extracted info context section (from AI query parsing)
    let extractedContext = 'No pre-parsed query information available.';
    if (extractedInfo) {
        const parts = [];
        parts.push(`**Extracted Title**: "${extractedInfo.searchQuery}"`);
        if (extractedInfo.season) parts.push(`**Season**: ${extractedInfo.season}`);
        if (extractedInfo.disc) parts.push(`**Disc**: ${extractedInfo.disc}`);
        if (extractedInfo.year) parts.push(`**Year**: ${extractedInfo.year}`);
        parts.push(`**Media Type**: ${extractedInfo.isTV ? 'TV Show' : 'Movie/Unknown'}`);
        if (extractedInfo.isBoxSet) parts.push(`**Box Set**: Yes (multi-disc set detected)`);
        parts.push(`**Extraction Confidence**: ${(extractedInfo.confidence * 100).toFixed(0)}%`);
        if (extractedInfo.clarificationNeeded) {
            parts.push(`**Clarification Needed**: ${extractedInfo.clarificationNeeded}`);
        }
        extractedContext = parts.join('\n');
    }

    // Build lsdvd metadata section
    let lsdvdContext = 'Extended disc metadata not available.';
    if (lsdvdMetadata) {
        const parts = [];
        parts.push(`**Disc Title (from lsdvd)**: ${lsdvdMetadata.discTitle || 'unknown'}`);
        if (lsdvdMetadata.discId) parts.push(`**Disc ID**: ${lsdvdMetadata.discId}`);
        if (lsdvdMetadata.longestTrack) parts.push(`**Longest Track**: ${lsdvdMetadata.longestTrack}`);

        // Add track chapter summary (useful for distinguishing episodes from menus)
        if (lsdvdMetadata.tracks) {
            const trackSummary = Object.entries(lsdvdMetadata.tracks)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                .slice(0, 10) // Limit to first 10 tracks
                .map(([num, t]) => `Track ${num}: ${t.chapters} chapters, ${t.audioStreams} audio`)
                .join(' | ');
            parts.push(`**Track Overview**: ${trackSummary}`);
        }
        lsdvdContext = parts.join('\n');
    }

    const system = renderPrompt('tmdb-match-system', {});
    const user = renderPrompt('tmdb-match-user', {
        volumeName,
        numTitles,
        trackDurations: JSON.stringify(trackDurations),
        tmdbData: JSON.stringify(tmdbData, null, 2),
        userQueryContext,
        extractedContext,
        lsdvdContext
    });

    return { system, user };
}

/**
 * Build the track mapping prompts (Option C: Raw data + soft guidance)
 * @param {Object} params - Parameters for the prompt
 * @param {string|null} params.volumeName - DVD volume name (may contain disc info like S3D1)
 * @param {number|null} params.discNumber - User-specified disc number (may be overall box set number)
 * @param {number|null} params.startEpisodeOverride - User-specified starting episode (1-based)
 * @param {Array|null} params.enhancedTrackData - Enhanced track data from buildEnhancedTrackData()
 * @returns {{ system: string, user: string }} System and user prompts
 */
function buildTrackMappingPrompts({ metadata, trackDurations, runtimeAnalysis, lsdvdMetadata, unrippableTracks = [], volumeName = null, discNumber = null, startEpisodeOverride = null, enhancedTrackData = null }) {
    const episodes = metadata.episodes || [];
    const totalEpisodes = episodes.length;
    const showOverview = metadata.showOverview || null;

    // Build episode table (raw data, no analysis)
    const episodeTable = episodes.map((ep, _i) =>
        `| ${ep.episode_number} | ${ep.runtime || '?'} min | ${ep.name || 'Untitled'} |`
    ).join('\n');
    const episodeTableFormatted = `| Ep# | Runtime | Title |\n|-----|---------|-------|\n${episodeTable}`;

    // Build raw track table - use enhanced data if available for richer chapter info
    const trackInfo = Object.entries(trackDurations)
        .map(([trackNum, duration]) => ({ trackNum: parseInt(trackNum), duration }))
        .sort((a, b) => a.trackNum - b.trackNum);

    // If we have enhanced track data (with chapter details), build a richer table
    let trackTableFormatted;
    if (enhancedTrackData && enhancedTrackData.length > 0) {
        const trackTableRows = enhancedTrackData.map(t => {
            // Build chapter info string for episode boundary detection
            let chapterInfo = `${t.chapters}`;
            if (t.chapterDetails && t.chapterDetails.length > 0 && t.chapters <= 10) {
                // For tracks with ≤10 chapters, show chapter lengths (helps identify episode boundaries)
                const chapterLengths = t.chapterDetails.map(ch => `${ch.lengthMinutes}m`).join(', ');
                chapterInfo = `${t.chapters} (${chapterLengths})`;
            } else if (t.chapterDetails && t.chapterDetails.length > 0) {
                // For many chapters, just show count and total pattern
                const avgChapterLen = (t.durationMinutes / t.chapters).toFixed(1);
                chapterInfo = `${t.chapters} (~${avgChapterLen}m each)`;
            }

            // Audio language summary
            const audioLangs = t.audioLanguages.length > 0
                ? t.audioLanguages.map(a => a.langCode).join('/')
                : '?';

            // Mark unrippable
            const rippableMarker = t.isUnrippable ? ' ⊘' : '';

            return `| ${t.track}${rippableMarker} | ${t.durationMinutes} min | ${chapterInfo} | ${audioLangs} |`;
        }).join('\n');

        trackTableFormatted = `| Track | Duration | Chapters | Audio |\n|-------|----------|----------|-------|\n${trackTableRows}`;
    } else {
        // Fallback to basic track table
        const trackTableRows = trackInfo.map(t => {
            let lsdvdInfo = '';
            if (lsdvdMetadata && lsdvdMetadata.tracks && lsdvdMetadata.tracks[t.trackNum]) {
                const track = lsdvdMetadata.tracks[t.trackNum];
                lsdvdInfo = ` | ${track.chapters} | ${track.audioStreams} | ${track.subpictures}`;
            } else {
                lsdvdInfo = ' | ? | ? | ?';
            }
            return `| ${t.trackNum} | ${t.duration} min${lsdvdInfo} |`;
        }).join('\n');

        trackTableFormatted = lsdvdMetadata
            ? `| Track | Duration | Chapters | Audio | Subs |\n|-------|----------|----------|-------|------|\n${trackTableRows}`
            : `| Track | Duration |\n|-------|----------|\n${trackInfo.map(t => `| ${t.trackNum} | ${t.duration} min |`).join('\n')}`;
    }

    // Build lsdvd info section
    let lsdvdInfo = 'Extended disc metadata not available (lsdvd not installed or failed).';
    if (lsdvdMetadata) {
        let discPatternInfo = '';
        if (lsdvdMetadata.discPatterns && lsdvdMetadata.discPatterns.patterns.length > 0) {
            const patternList = lsdvdMetadata.discPatterns.patterns
                .map(p => `- Pattern "${p.raw}": ${JSON.stringify(p.values)}`)
                .join('\n');
            discPatternInfo = `

**Detected Disc Position Patterns** (use these to determine starting episode):
${patternList}

Season indicators: ${lsdvdMetadata.discPatterns.seasonIndicators.length > 0 ? lsdvdMetadata.discPatterns.seasonIndicators.map(s => s.value).join(', ') : 'none found'}
Disc indicators: ${lsdvdMetadata.discPatterns.discIndicators.length > 0 ? lsdvdMetadata.discPatterns.discIndicators.map(d => d.value).join(', ') : 'none found'}`;
        }

        lsdvdInfo = `**Disc Title**: ${lsdvdMetadata.discTitle || 'unknown'}
**Disc ID**: ${lsdvdMetadata.discId || 'unknown'}
**Longest Track**: ${lsdvdMetadata.longestTrack || '?'}${discPatternInfo}

*Note: "Chapters" indicates internal chapter markers. "Audio" is number of audio streams. "Subs" is subtitle tracks.*`;
    }

    // Build show overview section for multi-disc context
    let showOverviewText = 'Show overview not available.';
    if (showOverview) {
        const seasonLines = showOverview.seasons
            .filter(s => s.seasonNumber > 0) // Exclude specials (season 0)
            .map(s => `  Season ${s.seasonNumber}: ${s.episodeCount} episodes`)
            .join('\n');
        showOverviewText = `**Total Seasons**: ${showOverview.numberOfSeasons}
**Total Episodes**: ${showOverview.numberOfEpisodes}

**Episodes per Season**:
${seasonLines}`;
    }

    // Build runtime summary (soft guidance, not directives)
    let runtimeSummary = 'No episode runtime data available from TMDB to compute statistics.';
    if (runtimeAnalysis) {
        runtimeSummary = `Based on TMDB episode data:
- Show appears to be **${runtimeAnalysis.format}**
- Episode runtimes range from **${runtimeAnalysis.min}** to **${runtimeAnalysis.max}** min (average: ${runtimeAnalysis.avg} min)
- Variance between episodes: ${runtimeAnalysis.variance} min
- A tolerance of approximately **±${runtimeAnalysis.tolerance} min** seems reasonable given this variance`;
    }

    // Build computational hints with SOFT language (suggestions, not rules)
    let computationalHints = 'No additional observations available.';
    if (runtimeAnalysis) {
        const minValid = runtimeAnalysis.min - runtimeAnalysis.tolerance;
        const maxValid = runtimeAnalysis.max + runtimeAnalysis.tolerance;
        const avgRuntime = runtimeAnalysis.avg;

        // Count tracks that fall in/out of the suggested range
        const inRangeCount = trackInfo.filter(t => t.duration >= minValid && t.duration <= maxValid).length;
        const outOfRangeCount = trackInfo.filter(t => t.duration > 0 && (t.duration < minValid || t.duration > maxValid)).length;
        const zeroTracks = trackInfo.filter(t => t.duration === 0).length;

        // Detect multi-episode track pattern (common in animated series)
        const doubleEpMin = (avgRuntime * 2) - runtimeAnalysis.tolerance;
        const doubleEpMax = (avgRuntime * 2) + runtimeAnalysis.tolerance;
        const doubleEpTracks = trackInfo.filter(t => t.duration >= doubleEpMin && t.duration <= doubleEpMax).length;

        // Detect "Play All" track (sum of all episode tracks or very long)
        const sumOfNonZeroTracks = trackInfo.filter(t => t.duration > 0 && t.duration < avgRuntime * 3).reduce((sum, t) => sum + t.duration, 0);
        const playAllCandidates = trackInfo.filter(t => t.duration > avgRuntime * 5 || (t.duration >= sumOfNonZeroTracks * 0.9 && t.duration <= sumOfNonZeroTracks * 1.1));

        const hints = [];
        hints.push(`- Tracks with durations between **${minValid}-${maxValid} min** *might* be single episodes (${inRangeCount} tracks fall in this range)`);

        // Multi-episode pattern hint
        if (doubleEpTracks > 0) {
            hints.push(`- **MULTI-EPISODE PATTERN DETECTED**: ${doubleEpTracks} track(s) are ~${avgRuntime * 2} min (2× episode runtime of ${avgRuntime} min) - these likely contain 2 episodes each`);
        }

        // "Play All" track hint
        if (playAllCandidates.length > 0) {
            const playAllTracks = playAllCandidates.map(t => t.trackNum).join(', ');
            hints.push(`- **PLAY ALL TRACK DETECTED**: Track(s) ${playAllTracks} appear to be "Play All" compilations - consider skipping these`);
        }

        if (outOfRangeCount > 0 && doubleEpTracks === 0) {
            hints.push(`- ${outOfRangeCount} track(s) have durations outside the single-episode range - these *could* be menus, extras, or bonus content`);
        }

        if (zeroTracks > 0) {
            hints.push(`- ${zeroTracks} track(s) have 0 min duration - these are likely placeholders or failed scans`);
        }

        hints.push(`- The show expects **${episodes.length} episodes** for this season - but this disc may only contain a portion of them`);

        if (lsdvdMetadata && lsdvdMetadata.longestTrack) {
            hints.push(`- lsdvd indicates track ${lsdvdMetadata.longestTrack} is the longest - this *might* be a "Play All" compilation`);
        }

        computationalHints = hints.join('\n');
    }

    // Build unrippable tracks warning section
    let unrippableInfo = 'No tracks marked as unrippable.';
    if (unrippableTracks && unrippableTracks.length > 0) {
        unrippableInfo = `The following tracks are **unrippable** (copy-protected, stuck during scan, or 0 duration):

**Track numbers**: ${unrippableTracks.join(', ')}

⚠️ **CRITICAL**: Never suggest ripping these tracks. Always mark them as \`shouldSkip: true\` with reasoning "Unrippable track (copy-protected or invalid)".`;
    }

    // Build disc context section for multi-disc sets
    // Use track-count-based inference instead of assuming 2-disc sets
    let discContext = '';

    // Count episode-like tracks to infer how many episodes are on this disc
    let estimatedEpisodeCount = 0;
    if (runtimeAnalysis && runtimeAnalysis.avg > 0) {
        const avgRuntime = runtimeAnalysis.avg;
        const tolerance = runtimeAnalysis.tolerance || 5;

        // Count single-episode tracks
        const singleEpTracks = trackInfo.filter(t =>
            t.duration >= avgRuntime - tolerance && t.duration <= avgRuntime + tolerance
        ).length;

        // Count multi-episode tracks (2x average runtime)
        const multiEpTracks = trackInfo.filter(t =>
            t.duration >= avgRuntime * 2 - tolerance && t.duration <= avgRuntime * 2 + tolerance
        ).length;

        estimatedEpisodeCount = singleEpTracks + (multiEpTracks * 2);
    }

    // Handle user-specified start episode override
    if (startEpisodeOverride && startEpisodeOverride > 0 && totalEpisodes > 0) {
        const endEpisode = Math.min(startEpisodeOverride + Math.max(estimatedEpisodeCount, 1) - 1, totalEpisodes);
        discContext = `### 1E. Multi-Disc Context (USER SPECIFIED)

**User confirmed**: Episodes start at Episode ${startEpisodeOverride}.
Map tracks to Episodes ${startEpisodeOverride}-${endEpisode}.
First episode track should use episodeIndex=${startEpisodeOverride - 1}.

Season ${metadata.season} has ${totalEpisodes} total episodes.
`;
    } else if (discNumber && discNumber > 1 && totalEpisodes > 0) {
        // Let AI determine starting episode by counting episodes on this disc
        discContext = `### 1E. Multi-Disc Context (REQUIRES YOUR ANALYSIS)

**User query mentioned Disc ${discNumber}** for Season ${metadata.season}. IGNORE the user's disc number - check the **DVD Volume Name** above instead.

⚠️ **CRITICAL: Calculate Starting Episode from Track Analysis**

**Step 1: Identify the disc number from volume name**
Look for patterns: \`DISC_ONE\`, \`DISC_TWO\`, \`D1\`, \`D2\`, \`S${metadata.season}D1\`, \`S${metadata.season}D2\`, etc.

**Step 2: If this is NOT Disc 1, count episodes on THIS disc**
1. Count episode-length tracks (exclude Play All, menus, extras)
2. For each track, determine episodes it contains by comparing track duration to TMDB episode runtimes:
   - Track ~1x episode runtime → 1 episode
   - Track ~2x episode runtime → 2 episodes
   - Track matching a specific longer episode (check TMDB data!) → 1 episode
3. Sum up total episodes on this disc

**Step 3: Calculate starting episode**
\`\`\`
startEpisode = totalSeasonEpisodes - episodesOnThisDisc + 1
\`\`\`

**Example for Season ${metadata.season} (${totalEpisodes} episodes):**
- If this disc has 6 tracks with ~22 min each (11 min episodes)
- Check TMDB: Is there a double-length episode (22 min single)?
- If 5 tracks × 2 eps + 1 track × 1 double-length ep = 11 episodes
- startEpisode = ${totalEpisodes} - 11 + 1 = ${totalEpisodes - 11 + 1}

**IMPORTANT: Check TMDB episode runtimes!**
Some episodes are double-length (22+ min) - these take a full track for just 1 episode.
A season finale or special is often double-length. Look at the runtime column in the episode table above.

**If volume name indicates Disc 1:**
- Episodes start from Episode 1 (episodeIndex=0)

**Verification:** After calculating, verify the episode titles match expectations. The first episode title on this disc should logically follow the last episode on the previous disc.
`;
    } else if (discNumber === 1) {
        discContext = `### 1E. Multi-Disc Context

**This is Disc 1** of the set. Episodes should start from Episode 1 (episodeIndex=0).
`;
    }

    const system = renderPrompt('track-mapping-system', {});
    const user = renderPrompt('track-mapping-user', {
        showName: metadata.name,
        season: metadata.season,
        episodeCount: totalEpisodes,
        volumeName: volumeName || 'unknown',
        episodeTable: episodeTableFormatted,
        trackTable: trackTableFormatted,
        lsdvdInfo,
        unrippableInfo,
        discContext,
        runtimeSummary,
        computationalHints,
        showOverview: showOverviewText
    });

    return { system, user };
}

/**
 * Build the mapping validation prompts
 * @param {Object} params - Parameters for the prompt
 * @returns {{ system: string, user: string }} System and user prompts
 */
function buildMappingValidationPrompts({
    volumeName,
    numTitles,
    trackDurations,
    userQuery = null,
    extractedInfo = null,
    matchedTitle,
    matchedType,
    seasonNumber,
    totalEpisodes,
    mappingResults,
    episodes = null  // TMDB episode list for cross-reference
}) {
    // Build user query context
    let userQueryContext = 'No user query provided - matching based on disc volume name only.';
    if (userQuery) {
        userQueryContext = `**User's Search Query**: "${userQuery}"`;
    }

    // Build extracted info context
    let extractedContext = 'No pre-parsed query information available.';
    if (extractedInfo) {
        const parts = [];
        parts.push(`**Extracted Title**: "${extractedInfo.searchQuery}"`);
        if (extractedInfo.season) parts.push(`**Season**: ${extractedInfo.season}`);
        if (extractedInfo.disc) parts.push(`**Disc**: ${extractedInfo.disc}`);
        if (extractedInfo.year) parts.push(`**Year**: ${extractedInfo.year}`);
        parts.push(`**Media Type**: ${extractedInfo.isTV ? 'TV Show' : 'Movie/Unknown'}`);
        if (extractedInfo.isBoxSet) parts.push(`**Box Set**: Yes (multi-disc set detected)`);
        parts.push(`**Extraction Confidence**: ${(extractedInfo.confidence * 100).toFixed(0)}%`);
        extractedContext = parts.join('\n');
    }

    // Calculate mapped episode range and build detailed track mapping info
    let mappedEpisodeRange = 'N/A';
    let mappedEpisodeCount = 0;
    let trackMappingDetails = 'No detailed mapping data available.';

    if (mappingResults && mappingResults.mappings) {
        const episodeIndices = new Set();
        const detailLines = [];

        for (const mapping of mappingResults.mappings) {
            if (mapping.episodeIndex !== null && mapping.episodeIndex !== undefined && !mapping.shouldSkip) {
                episodeIndices.add(mapping.episodeIndex);
                if (mapping.episodeEndIndex !== null && mapping.episodeEndIndex !== undefined) {
                    for (let i = mapping.episodeIndex; i <= mapping.episodeEndIndex; i++) {
                        episodeIndices.add(i);
                    }
                }
            }

            // Build detail line for this track
            const trackNum = mapping.trackNum;
            const duration = mapping.trackDuration || '?';
            const confidence = mapping.confidence !== undefined ? `${Math.round(mapping.confidence * 100)}%` : '?';

            if (mapping.shouldSkip) {
                const skipReason = mapping.extraType || 'skipped';
                const desc = mapping.extraDescription || '';
                detailLines.push(`| ${trackNum} | ${duration} min | SKIP (${skipReason}${desc ? ': ' + desc : ''}) | ${confidence} |`);
            } else if (mapping.episodeIndex !== null && mapping.episodeIndex !== undefined) {
                const epStart = mapping.episodeIndex + 1; // 1-based
                const epEnd = mapping.episodeEndIndex !== null && mapping.episodeEndIndex !== undefined
                    ? mapping.episodeEndIndex + 1
                    : epStart;
                const epRange = epStart === epEnd ? `E${epStart}` : `E${epStart}-E${epEnd}`;

                // Include episode titles from TMDB data if available
                let epTitles = '';
                if (episodes && episodes.length > 0) {
                    const startEp = episodes.find(e => e.episode_number === epStart);
                    const endEp = epStart !== epEnd ? episodes.find(e => e.episode_number === epEnd) : null;
                    if (startEp) {
                        epTitles = endEp
                            ? ` "${startEp.name}" & "${endEp.name}"`
                            : ` "${startEp.name}"`;
                    }
                }
                detailLines.push(`| ${trackNum} | ${duration} min | ${epRange}${epTitles} | ${confidence} |`);
            } else {
                detailLines.push(`| ${trackNum} | ${duration} min | unmapped | ${confidence} |`);
            }
        }

        if (detailLines.length > 0) {
            trackMappingDetails = `| Track | Duration | Mapping | Confidence |\n|-------|----------|---------|------------|\n${detailLines.join('\n')}`;
        }

        if (episodeIndices.size > 0) {
            const sorted = Array.from(episodeIndices).sort((a, b) => a - b);
            const firstEp = sorted[0] + 1; // Convert to 1-based
            const lastEp = sorted[sorted.length - 1] + 1;
            mappedEpisodeRange = `Episodes ${firstEp}-${lastEp}`;
            mappedEpisodeCount = episodeIndices.size;
        }
    }

    // Build TMDB episode reference list so AI can verify episode titles match
    let tmdbEpisodeList = 'TMDB episode data not available.';
    if (episodes && episodes.length > 0) {
        const episodeLines = episodes.slice(0, 30).map(ep => // Limit to first 30 to avoid token bloat
            `| ${ep.episode_number} | ${ep.name || 'Untitled'} | ${ep.runtime || '?'} min |`
        );
        tmdbEpisodeList = `| Ep# | Title | Runtime |\n|-----|-------|--------|\n${episodeLines.join('\n')}`;
        if (episodes.length > 30) {
            tmdbEpisodeList += `\n... and ${episodes.length - 30} more episodes`;
        }
    }

    const system = renderPrompt('mapping-validation-system', {});
    const user = renderPrompt('mapping-validation-user', {
        userQueryContext,
        extractedContext,
        volumeName,
        numTitles,
        trackDurations: JSON.stringify(trackDurations),
        matchedTitle: matchedTitle || 'Unknown',
        matchedType: matchedType || 'unknown',
        seasonNumber: seasonNumber || 'N/A',
        totalEpisodes: totalEpisodes || 0,
        mappedEpisodeCount,
        mappedEpisodeRange,
        tracksMatched: mappingResults?.summary?.tracksMatched || 0,
        tracksSkipped: mappingResults?.summary?.tracksSkipped || 0,
        overallConfidence: Math.round((mappingResults?.overallConfidence || 0) * 100),
        trackMappingDetails,
        tmdbEpisodeList
    });

    return { system, user };
}

/**
 * Build the query extraction prompts
 * @param {string} userQuery - The user's raw query
 * @returns {{ system: string, user: string }} System and user prompts
 */
function buildQueryExtractionPrompts(userQuery) {
    const system = loadTemplate('query-extraction-system');
    const user = `Extract the TMDB search information from this user query: "${userQuery}"`;
    return { system, user };
}

module.exports = {
    loadTemplate,
    interpolate,
    renderPrompt,
    clearCache,
    buildTmdbMatchPrompts,
    buildTrackMappingPrompts,
    buildMappingValidationPrompts,
    buildQueryExtractionPrompts
};
