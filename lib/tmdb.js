/**
 * TMDB (The Movie Database) API Module
 *
 * Handles all TMDB API interactions for metadata lookup.
 * This module is stateless - API key must be passed in or loaded via getApiKey().
 */

const axios = require('axios');

// Lazy-loaded logger (only used for debug output)
let logger = null;
function getLogger() {
    if (!logger) {
        const { getLogger: createLogger } = require('./logger');
        logger = createLogger();
    }
    return logger;
}

// API key management
let _apiKey = null;

/**
 * Set the TMDB API key for this module
 * @param {string} apiKey - The TMDB API key
 */
function setApiKey(apiKey) {
    _apiKey = apiKey;
}

/**
 * Get the current API key, loading from config if not set
 * @returns {string} The TMDB API key
 */
function getApiKey() {
    if (_apiKey) return _apiKey;

    // Load from config as fallback
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    const configDir = process.platform === 'darwin'
        ? path.join(os.homedir(), '.config', 'juice-it')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'juice-it');
    const configPath = path.join(configDir, 'config.json');

    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.tmdbApiKey) {
                _apiKey = config.tmdbApiKey;
                return _apiKey;
            }
        }
    } catch (error) {
        // Ignore config read errors
    }

    // Demo key fallback
    return 'REMOVED_API_KEY';
}

/**
 * Search TMDB for movies or TV shows
 * @param {string} query - Search query
 * @param {boolean} isTV - Whether to search TV shows (true) or movies (false)
 * @param {string|null} year - Optional year filter
 * @returns {Promise<Array>} Search results
 */
async function searchTMDB(query, isTV = false, year = null) {
    try {
        const endpoint = isTV ? 'search/tv' : 'search/movie';
        const params = {
            api_key: getApiKey(),
            query: query,
            language: 'en-US'
        };

        // Add year filter if provided (helps disambiguate titles like "Avatar")
        // Movies use "year", TV shows use "first_air_date_year"
        if (year) {
            if (isTV) {
                params.first_air_date_year = year;
            } else {
                params.year = year;
            }
            getLogger().debug(`TMDB search: "${query}" (${isTV ? 'TV' : 'movie'}, year: ${year})`);
        } else {
            getLogger().debug(`TMDB search: "${query}" (${isTV ? 'TV' : 'movie'})`);
        }

        const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params });
        return response.data.results || [];
    } catch (error) {
        getLogger().debug(`Error searching TMDB: ${error.message}`);
        return [];
    }
}

/**
 * Get detailed information about a TV season
 * @param {number} tvId - TMDB TV show ID
 * @param {number} seasonNumber - Season number
 * @returns {Promise<Object|null>} Season details or null on error
 */
async function getTVSeasonDetails(tvId, seasonNumber) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}`, {
            params: {
                api_key: getApiKey(),
                language: 'en-US'
            }
        });
        return response.data;
    } catch (error) {
        getLogger().debug(`Error fetching season details: ${error.message}`);
        return null;
    }
}

/**
 * Get TV show overview (number of seasons, total episodes, etc.)
 * Useful for box sets to understand disc→season mapping
 * @param {number} tvId - TMDB TV show ID
 * @returns {Promise<Object|null>} Show details or null on error
 */
async function getTVShowDetails(tvId) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}`, {
            params: {
                api_key: getApiKey(),
                language: 'en-US'
            }
        });
        const data = response.data;
        return {
            id: data.id,
            name: data.name,
            numberOfSeasons: data.number_of_seasons,
            numberOfEpisodes: data.number_of_episodes,
            seasons: data.seasons?.map(s => ({
                seasonNumber: s.season_number,
                episodeCount: s.episode_count,
                name: s.name
            })) || [],
            firstAirDate: data.first_air_date
        };
    } catch (error) {
        getLogger().debug(`Error fetching TV show details: ${error.message}`);
        return null;
    }
}

/**
 * Multi-query TMDB search with fallback to alternative searches
 * @param {Object} extractedInfo - AI-extracted search info with suggestedSearches
 * @returns {Promise<{movieResults: Array, tvResults: Array}>}
 */
async function multiQueryTMDBSearch(extractedInfo) {
    const { searchQuery, year, isTV, suggestedSearches } = extractedInfo;
    let allMovieResults = [];
    let allTVResults = [];

    // Primary search
    getLogger().debug(`[Multi-Query] Primary search: "${searchQuery}"`);
    const primaryMovies = await searchTMDB(searchQuery, false, year);
    const primaryTV = await searchTMDB(searchQuery, true, year);

    allMovieResults = [...primaryMovies];
    allTVResults = [...primaryTV];

    // If primary search has few results and we have suggested alternatives, try them
    const needsAlternatives = (isTV && primaryTV.length < 3) || (!isTV && primaryMovies.length < 3);

    if (needsAlternatives && suggestedSearches?.length > 0) {
        getLogger().debug(`[Multi-Query] Primary search has few results, trying ${suggestedSearches.length} alternatives...`);

        for (const alt of suggestedSearches.slice(0, 2)) { // Limit to 2 alternatives
            getLogger().debug(`[Multi-Query] Alternative search: "${alt.query}" (${alt.reason})`);

            const altMovies = await searchTMDB(alt.query, false, year);
            const altTV = await searchTMDB(alt.query, true, year);

            // Add unique results (by ID)
            const existingMovieIds = new Set(allMovieResults.map(m => m.id));
            const existingTVIds = new Set(allTVResults.map(t => t.id));

            for (const movie of altMovies) {
                if (!existingMovieIds.has(movie.id)) {
                    allMovieResults.push(movie);
                }
            }
            for (const tv of altTV) {
                if (!existingTVIds.has(tv.id)) {
                    allTVResults.push(tv);
                }
            }
        }

        getLogger().debug(`[Multi-Query] Combined results: ${allMovieResults.length} movies, ${allTVResults.length} TV shows`);
    }

    return { movieResults: allMovieResults, tvResults: allTVResults };
}

/**
 * Validate a TMDB API key
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} True if valid
 */
async function validateTmdbApiKey(apiKey) {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/configuration', {
            params: { api_key: apiKey },
            timeout: 5000
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

module.exports = {
    setApiKey,
    getApiKey,
    searchTMDB,
    getTVSeasonDetails,
    getTVShowDetails,
    multiQueryTMDBSearch,
    validateTmdbApiKey
};
