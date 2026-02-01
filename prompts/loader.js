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
function buildTmdbMatchPrompts({ volumeName, numTitles, trackDurations, movieResults, tvResults }) {
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

    const system = renderPrompt('tmdb-match-system', {});
    const user = renderPrompt('tmdb-match-user', {
        volumeName,
        numTitles,
        trackDurations: JSON.stringify(trackDurations),
        tmdbData: JSON.stringify(tmdbData, null, 2)
    });

    return { system, user };
}

/**
 * Build the track mapping prompts (Option C: Raw data + soft guidance)
 * @param {Object} params - Parameters for the prompt
 * @returns {{ system: string, user: string }} System and user prompts
 */
function buildTrackMappingPrompts({ metadata, trackDurations, runtimeAnalysis, lsdvdMetadata }) {
    const episodes = metadata.episodes || [];

    // Build episode table (raw data, no analysis)
    const episodeTable = episodes.map((ep, _i) =>
        `| ${ep.episode_number} | ${ep.runtime || '?'} min | ${ep.name || 'Untitled'} |`
    ).join('\n');
    const episodeTableFormatted = `| Ep# | Runtime | Title |\n|-----|---------|-------|\n${episodeTable}`;

    // Build raw track table (no CANDIDATE/SKIP labels - just facts)
    const trackInfo = Object.entries(trackDurations)
        .map(([trackNum, duration]) => ({ trackNum: parseInt(trackNum), duration }))
        .sort((a, b) => a.trackNum - b.trackNum);

    const trackTableRows = trackInfo.map(t => {
        // Get lsdvd info if available
        let lsdvdInfo = '';
        if (lsdvdMetadata && lsdvdMetadata.tracks && lsdvdMetadata.tracks[t.trackNum]) {
            const track = lsdvdMetadata.tracks[t.trackNum];
            lsdvdInfo = ` | ${track.chapters} | ${track.audioStreams} | ${track.subpictures}`;
        } else {
            lsdvdInfo = ' | ? | ? | ?';
        }
        return `| ${t.trackNum} | ${t.duration} min${lsdvdInfo} |`;
    }).join('\n');

    const trackTableFormatted = lsdvdMetadata
        ? `| Track | Duration | Chapters | Audio | Subs |\n|-------|----------|----------|-------|------|\n${trackTableRows}`
        : `| Track | Duration |\n|-------|----------|\n${trackInfo.map(t => `| ${t.trackNum} | ${t.duration} min |`).join('\n')}`;

    // Build lsdvd info section
    let lsdvdInfo = 'Extended disc metadata not available (lsdvd not installed or failed).';
    if (lsdvdMetadata) {
        lsdvdInfo = `**Disc Title**: ${lsdvdMetadata.discTitle || 'unknown'}
**Disc ID**: ${lsdvdMetadata.discId || 'unknown'}
**Longest Track**: ${lsdvdMetadata.longestTrack || '?'}

*Note: "Chapters" indicates internal chapter markers. "Audio" is number of audio streams. "Subs" is subtitle tracks.*`;
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

        // Count tracks that fall in/out of the suggested range
        const inRangeCount = trackInfo.filter(t => t.duration >= minValid && t.duration <= maxValid).length;
        const outOfRangeCount = trackInfo.filter(t => t.duration > 0 && (t.duration < minValid || t.duration > maxValid)).length;
        const zeroTracks = trackInfo.filter(t => t.duration === 0).length;

        const hints = [];
        hints.push(`- Tracks with durations between **${minValid}-${maxValid} min** *might* be episodes (${inRangeCount} tracks fall in this range)`);

        if (outOfRangeCount > 0) {
            hints.push(`- ${outOfRangeCount} track(s) have durations outside this range - these *could* be menus, extras, or bonus content, but use your judgment`);
        }

        if (zeroTracks > 0) {
            hints.push(`- ${zeroTracks} track(s) have 0 min duration - these are likely placeholders or failed scans`);
        }

        hints.push(`- The show expects **${episodes.length} episodes** - you should aim to find this many matching tracks`);

        if (lsdvdMetadata && lsdvdMetadata.longestTrack) {
            hints.push(`- lsdvd indicates track ${lsdvdMetadata.longestTrack} is the longest - this *might* be a full-disc compilation or main feature`);
        }

        computationalHints = hints.join('\n');
    }

    const system = renderPrompt('track-mapping-system', {});
    const user = renderPrompt('track-mapping-user', {
        showName: metadata.name,
        season: metadata.season,
        episodeCount: episodes.length,
        episodeTable: episodeTableFormatted,
        trackTable: trackTableFormatted,
        lsdvdInfo,
        runtimeSummary,
        computationalHints
    });

    return { system, user };
}

module.exports = {
    loadTemplate,
    interpolate,
    renderPrompt,
    clearCache,
    buildTmdbMatchPrompts,
    buildTrackMappingPrompts
};
