/**
 * JuiceIt Naming Utilities
 *
 * Plex-compatible file naming for movies and TV shows.
 * See: https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/
 */

/**
 * Sanitize a string for use in filenames (Plex-friendly)
 * Keeps spaces, letters, numbers, dashes, parentheses, and common punctuation
 *
 * @param {string} str - Input string to sanitize
 * @returns {string} - Sanitized string safe for filenames
 */
function sanitizeForPlex(str) {
    if (!str) return '';
    return str
        .replace(/[<>:"/\\|?*]/g, '') // Remove filesystem-unsafe characters
        .replace(/\s+/g, ' ')          // Normalize multiple spaces
        .trim();
}

/**
 * Calculate the proposed filename in Plex-compatible format
 *
 * Movies: "Movie Name (Year).mp4"
 * TV Shows: "Show Name (Year) - s01e01 - Episode Title.mp4"
 *
 * @param {number} index - Zero-based index of the track
 * @param {Object} metadata - Metadata object with type, name, year, season, episodes
 * @param {string} baseFileName - Base filename (already includes year for proper format)
 * @param {number} numTitles - Total number of titles on disc
 * @returns {string} - Plex-compatible filename
 */
function calculateProposedName(index, metadata, baseFileName, numTitles) {
    const titleNumber = index + 1;

    if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[index]) {
        const episode = metadata.episodes[index];
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(episode.episode_number).padStart(2, '0');
        const episodeTitle = episode.name ? ` - ${sanitizeForPlex(episode.name)}` : '';
        // Plex format: "Show Name (Year) - s01e01 - Episode Title.mp4"
        return `${baseFileName} - s${seasonNum}e${episodeNum}${episodeTitle}.mp4`;
    } else if (metadata.type === 'tv') {
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(titleNumber).padStart(2, '0');
        // Plex format without episode title
        return `${baseFileName} - s${seasonNum}e${episodeNum}.mp4`;
    } else if (numTitles === 1) {
        // Movie: just the base filename (already includes year in parentheses)
        return `${baseFileName}.mp4`;
    } else {
        // Movie with multiple tracks (extras, etc.)
        return `${baseFileName} - Part ${titleNumber}.mp4`;
    }
}

/**
 * Build the base filename from metadata (Plex-compatible format)
 *
 * @param {Object} metadata - Metadata object with type, name, year
 * @param {string} fallbackName - Fallback name if metadata doesn't provide one
 * @returns {string} - Base filename like "Movie Name (2024)" or "Show Name (2020)"
 */
function buildBaseFileName(metadata, fallbackName) {
    if (!metadata) {
        return sanitizeForPlex(fallbackName);
    }

    if (metadata.type === 'tv' || metadata.type === 'movie') {
        const yearStr = metadata.year ? ` (${metadata.year})` : '';
        return sanitizeForPlex(`${metadata.name}${yearStr}`);
    } else if (metadata.type === 'custom') {
        return sanitizeForPlex(metadata.name);
    }

    return sanitizeForPlex(fallbackName);
}

/**
 * Generate an extras filename for skipped tracks (Plex-compatible)
 *
 * Plex format for extras: MovieName (Year)-[type]-Description.ext
 * Valid types: behindthescenes, deleted, featurette, interview, scene, short, trailer, other
 * See: https://support.plex.tv/articles/local-files-for-trailers-and-extras/
 *
 * @param {string} baseFileName - Base filename (e.g., "Movie Name (2024)")
 * @param {number} trackNum - Track number
 * @param {string} extraType - Type of extra (default: 'featurette')
 * @returns {string} - Plex-compatible extras filename
 */
function buildExtrasFileName(baseFileName, trackNum, extraType = 'featurette') {
    // Plex format: MovieName (Year)-type-Description.ext
    return `${baseFileName}-${extraType}-Bonus ${trackNum}.mp4`;
}

module.exports = {
    sanitizeForPlex,
    calculateProposedName,
    buildBaseFileName,
    buildExtrasFileName
};
