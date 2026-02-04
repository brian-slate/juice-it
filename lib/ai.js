/**
 * AI Module - OpenAI-powered analysis for JuiceIt
 *
 * Handles all AI interactions including:
 * - Query extraction from user input
 * - TMDB match selection
 * - Track-to-episode mapping
 * - Mapping validation
 */

const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');

// AI configuration
const aiConfig = require('../config/ai-config');

// Prompt templates and schemas
const { buildTmdbMatchPrompts, buildTrackMappingPrompts, buildMappingValidationPrompts, buildQueryExtractionPrompts } = require('../prompts/loader');
const { QueryExtractionSchema, TmdbMatchSchema, TrackMappingResponseSchema, MappingValidationSchema } = require('../prompts/schemas');

// Lazy-loaded logger
let logger = null;
function getLogger() {
    if (!logger) {
        const { getLogger: createLogger } = require('./logger');
        logger = createLogger();
    }
    return logger;
}

// File logging function (will be set by main module)
let logToFile = () => {};

/**
 * Set the file logging function
 * @param {Function} fn - Function to log to file
 */
function setLogFunction(fn) {
    logToFile = fn;
}

// Options reference (set by main module)
let globalOptions = {};

/**
 * Set the global options reference
 * @param {Object} opts - Options object from main module
 */
function setOptions(opts) {
    globalOptions = opts;
}

// Config loader (will be set by main module)
let loadConfigFn = () => ({});

/**
 * Set the config loader function
 * @param {Function} fn - Function to load config
 */
function setConfigLoader(fn) {
    loadConfigFn = fn;
}

/**
 * Validate an OpenAI API key
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} True if valid
 */
async function validateOpenAiApiKey(apiKey) {
    try {
        const openai = new OpenAI({ apiKey });
        await openai.chat.completions.create({
            model: aiConfig.model,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 5
        });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Call OpenAI with optional structured output validation
 *
 * @param {string} systemMessage - System prompt for the AI
 * @param {string} userMessage - User prompt with the task details
 * @param {Object} opts - Optional configuration
 * @param {z.ZodSchema} opts.schema - Zod schema for structured output validation
 * @param {string} opts.schemaName - Name for the response format (required if schema provided)
 * @returns {Promise<Object|null>} Parsed and validated response, or null on error
 */
async function callOpenAI(systemMessage, userMessage, opts = {}) {
    const { schema, schemaName } = opts;

    try {
        const config = loadConfigFn();
        if (!config.openaiApiKey) {
            getLogger().debug('[AI] No OpenAI key configured, skipping AI call');
            return null;
        }

        // Use structured output if schema provided and config allows
        const useStructured = schema && schemaName && aiConfig.useStructuredOutput;

        getLogger().debug('[AI] Calling OpenAI API...');
        getLogger().debug(`[AI] Model: ${aiConfig.model}`);
        getLogger().debug(`[AI] Temperature: ${aiConfig.temperature}`);
        getLogger().debug(`[AI] Structured output: ${useStructured ? 'Yes (Zod schema)' : 'No (JSON mode)'}`);
        getLogger().debug(`[AI] System message: ${systemMessage.substring(0, 100)}...`);
        getLogger().debug(`[AI] User message length: ${userMessage.length} chars`);
        logToFile(`AI: Calling OpenAI API with ${aiConfig.model}`);
        logToFile(`AI: Temperature: ${aiConfig.temperature}`);
        logToFile(`AI: Structured output: ${useStructured ? 'Yes (Zod schema)' : 'No (JSON mode)'}`);
        logToFile(`AI: User message length: ${userMessage.length} chars`);
        logToFile('AI: === PROMPT START ===');
        logToFile(`AI: System: ${systemMessage}`);
        logToFile(`AI: User: ${userMessage}`);
        logToFile('AI: === PROMPT END ===');

        const openai = new OpenAI({
            apiKey: config.openaiApiKey
            // No timeout - we wait for AI to complete, showing progress messages
        });

        const startTime = Date.now();

        // Show clean progress indicator (update once per second)
        process.stdout.write('   ⏳ Waiting for AI');
        const progressInterval = setInterval(() => {
            process.stdout.write('.');
        }, 1000);

        let result;
        let tokenUsage;
        try {
            if (useStructured) {
                // Use structured output with Zod schema validation
                const response = await openai.chat.completions.parse({
                    model: aiConfig.model,
                    messages: [
                        { role: 'system', content: systemMessage },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: aiConfig.temperature,
                    response_format: zodResponseFormat(schema, schemaName)
                });

                tokenUsage = response.usage;

                // Handle refusals
                if (response.choices[0].message.refusal) {
                    logToFile(`AI: Refusal: ${response.choices[0].message.refusal}`);
                    getLogger().debug(`[AI] Refusal: ${response.choices[0].message.refusal}`);
                    return null;
                }

                // Get the parsed and validated result
                result = response.choices[0].message.parsed;
            } else {
                // Fallback to JSON mode for backward compatibility
                const response = await openai.chat.completions.create({
                    model: aiConfig.model,
                    messages: [
                        { role: 'system', content: systemMessage },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: aiConfig.temperature,
                    response_format: { type: 'json_object' }
                });

                tokenUsage = response.usage;
                const content = response.choices[0].message.content;
                result = JSON.parse(content);
            }
        } finally {
            clearInterval(progressInterval);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(` done (${elapsed}s)\n`);
        }

        const elapsed = Date.now() - startTime;

        getLogger().debug(`[AI] Response received in ${elapsed}ms`);
        getLogger().debug(`[AI] Tokens used: ${tokenUsage.total_tokens}`);
        getLogger().debug(`[AI] Response: ${JSON.stringify(result, null, 2)}`);
        logToFile(`AI: Response received in ${elapsed}ms`);
        logToFile(`AI: Tokens - prompt: ${tokenUsage.prompt_tokens}, completion: ${tokenUsage.completion_tokens}, total: ${tokenUsage.total_tokens}`);
        logToFile(`AI: Response: ${JSON.stringify(result)}`);

        return result;
    } catch (error) {
        getLogger().debug(`[AI] Error: ${error.message}`);
        logToFile(`AI API error: ${error.message}`);
        return null;
    }
}

/**
 * AI-powered query extraction (clean user input for TMDB search)
 * @param {string} userQuery - Raw user query
 * @returns {Promise<Object|null>} Extracted query info or null
 */
async function aiExtractSearchQuery(userQuery) {
    try {
        getLogger().debug(`[AI] Extracting search query from: "${userQuery}"`);

        const { system: systemPrompt, user: userPrompt } = buildQueryExtractionPrompts(userQuery);

        const result = await callOpenAI(systemPrompt, userPrompt, {
            schema: QueryExtractionSchema,
            schemaName: 'query_extraction'
        });

        if (result) {
            getLogger().debug(`[AI] Extracted: "${result.searchQuery}" (season: ${result.season}, disc: ${result.disc}, year: ${result.year}, isBoxSet: ${result.isBoxSet}, confidence: ${result.confidence})`);
            if (result.clarificationNeeded) {
                getLogger().debug(`[AI] Clarification needed: ${result.clarificationNeeded}`);
            }
            if (result.suggestedSearches?.length) {
                getLogger().debug(`[AI] Suggested searches: ${result.suggestedSearches.map(s => s.query).join(', ')}`);
            }
            logToFile(`AI query extraction: ${JSON.stringify(result)}`);
        }

        return result;
    } catch (error) {
        getLogger().debug(`[AI] Query extraction error: ${error.message}`);
        return null;
    }
}

/**
 * AI-powered TMDB match selection
 * @param {string} volumeName - DVD volume name
 * @param {number} numTitles - Number of titles on disc
 * @param {Object} trackDurations - Track durations
 * @param {Array} movieResults - TMDB movie search results
 * @param {Array} tvResults - TMDB TV search results
 * @param {string|null} userQuery - User's search query
 * @param {Object|null} extractedInfo - AI-extracted query info
 * @param {Object|null} lsdvdMetadata - lsdvd disc metadata
 * @returns {Promise<Object|null>} Selection result or null
 */
async function aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults, userQuery = null, extractedInfo = null, lsdvdMetadata = null) {
    try {
        if (!globalOptions.diagnose) {
            console.log('\n🧠 Analyzing disc and selecting best match...');
        }
        getLogger().debug('[AI] Starting TMDB match selection');
        getLogger().debug(`[AI] Analyzing: ${volumeName} with ${numTitles} tracks`);
        if (userQuery) {
            getLogger().debug(`[AI] User query: "${userQuery}"`);
        }
        if (extractedInfo) {
            getLogger().debug(`[AI] Extracted info: ${JSON.stringify(extractedInfo)}`);
        }
        if (lsdvdMetadata) {
            getLogger().debug(`[AI] lsdvd disc title: ${lsdvdMetadata.discTitle || 'unknown'}`);
        }
        getLogger().debug(`[AI] Track durations: ${JSON.stringify(trackDurations)}`);
        getLogger().debug(`[AI] TMDB results: ${movieResults.length} movies, ${tvResults.length} TV shows`);
        logToFile('AI: Starting TMDB match selection');
        logToFile(`AI: Disc - ${volumeName} with ${numTitles} tracks`);
        if (userQuery) {
            logToFile(`AI: User query - "${userQuery}"`);
        }
        if (extractedInfo) {
            logToFile(`AI: Extracted info - ${JSON.stringify(extractedInfo)}`);
        }
        logToFile(`AI: Track durations - ${JSON.stringify(trackDurations)}`);
        logToFile(`AI: TMDB results - ${movieResults.length} movies, ${tvResults.length} TV shows`);

        // Build prompts from templates
        const { system, user } = buildTmdbMatchPrompts({
            volumeName,
            numTitles,
            trackDurations,
            movieResults,
            tvResults,
            userQuery,
            extractedInfo,
            lsdvdMetadata
        });

        // Call OpenAI with structured output validation
        const result = await callOpenAI(system, user, {
            schema: TmdbMatchSchema,
            schemaName: aiConfig.schemaNames.tmdbMatch
        });

        if (result && result.selectedId) {
            console.log(`   ✓ Auto-selected: ${result.selectedType === 'tv' ? 'TV' : 'Movie'} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
            console.log(`   Reasoning: ${result.reasoning}`);
            getLogger().debug(`[AI] Selected ID: ${result.selectedId}`);
            getLogger().debug(`[AI] Season: ${result.season || 'N/A'}`);
            logToFile(`AI TMDB selection: ${JSON.stringify(result)}`);
        } else {
            getLogger().debug('[AI] No match selected or low confidence');
        }

        return result;
    } catch (error) {
        getLogger().debug(`AI selection error: ${error.message}`);
        return null;
    }
}

/**
 * AI-powered validation of mapping results
 * Determines if warnings are truly needed or if the mapping is expected for multi-disc sets
 */
async function aiValidateMappingResults({
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
    episodes = null
}) {
    try {
        getLogger().debug('[AI] Starting mapping validation');
        getLogger().debug(`[AI] Validating: ${matchedTitle} Season ${seasonNumber}`);
        getLogger().debug(`[AI] Mapped ${mappingResults?.summary?.tracksMatched || 0} tracks`);
        logToFile('AI: Starting mapping validation');

        // Build prompts from templates
        const { system, user } = buildMappingValidationPrompts({
            volumeName,
            numTitles,
            trackDurations,
            userQuery,
            extractedInfo,
            matchedTitle,
            matchedType,
            seasonNumber,
            totalEpisodes,
            mappingResults,
            episodes
        });

        // Call OpenAI with structured output validation
        const result = await callOpenAI(system, user, {
            schema: MappingValidationSchema,
            schemaName: 'mapping_validation'
        });

        if (result) {
            getLogger().debug(`[AI] Validation result: isValid=${result.isValid}, concerns=${result.concerns.length}`);
            logToFile(`AI validation result: ${JSON.stringify(result)}`);
        }

        return result;
    } catch (error) {
        getLogger().debug(`[AI] Validation error: ${error.message}`);
        // On error, return a permissive result (don't block the user)
        return {
            isValid: true,
            concerns: [],
            summary: 'Unable to validate (AI error) - proceeding with mapping',
            expectedOnDisc: null,
            reasoning: `Validation failed: ${error.message}`
        };
    }
}

/**
 * Analyze episode metadata to derive show-specific runtime characteristics
 * @param {Array} episodes - Array of episode objects with runtime
 * @returns {Object|null} Runtime analysis or null if no data
 */
function analyzeEpisodeRuntimes(episodes) {
    if (!episodes || episodes.length === 0) {
        return null;
    }

    const runtimes = episodes.map(ep => ep.runtime || 0).filter(r => r > 0);
    if (runtimes.length === 0) {
        return null;
    }

    const min = Math.min(...runtimes);
    const max = Math.max(...runtimes);
    const avg = Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
    const variance = max - min;

    // Calculate a reasonable tolerance based on the show's own variance
    let tolerance;
    if (variance <= 2) {
        tolerance = 2; // Very consistent show (e.g., all 9 min)
    } else if (variance <= 5) {
        tolerance = 3; // Somewhat consistent
    } else if (variance <= 10) {
        tolerance = 5; // Moderate variance
    } else {
        tolerance = Math.ceil(variance / 2); // High variance, be more flexible
    }

    // Determine show format
    let format;
    if (avg <= 15) {
        format = 'short-form (web series, shorts)';
    } else if (avg <= 35) {
        format = 'half-hour format (sitcom, animation, etc.)';
    } else if (avg <= 50) {
        format = 'hour format (drama, procedural)';
    } else if (avg <= 70) {
        format = 'extended episode format';
    } else {
        format = 'movie/special length';
    }

    return {
        min,
        max,
        avg,
        variance,
        tolerance,
        format,
        runtimes,
        episodeCount: episodes.length
    };
}

/**
 * Count episode-like tracks based on duration patterns
 * Used to estimate how many episodes are on a disc for multi-disc inference
 *
 * @param {Object} trackDurations - Object mapping track numbers to durations in minutes
 * @param {Object} metadata - Metadata with episodes array containing TMDB episode data
 * @returns {number} Estimated number of episodes on this disc
 */
function countEpisodeLikeTracks(trackDurations, metadata) {
    const episodes = metadata.episodes || [];
    if (episodes.length === 0 || !trackDurations) return 0;

    // Calculate average episode runtime from TMDB data
    const runtimes = episodes.map(e => e.runtime).filter(r => r > 0);
    const avgRuntime = runtimes.length > 0
        ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length
        : 22; // Default for animation

    // Use tolerance based on variance
    const minRuntime = Math.min(...runtimes);
    const maxRuntime = Math.max(...runtimes);
    const variance = maxRuntime - minRuntime;
    const tolerance = variance <= 5 ? 3 : Math.max(5, Math.ceil(variance / 2));

    const tracks = Object.entries(trackDurations)
        .map(([num, dur]) => ({ num: parseInt(num), dur }))
        .filter(t => t.dur > 0); // Exclude 0-duration tracks

    // Count single-episode tracks (within tolerance of average runtime)
    const singleEpTracks = tracks.filter(t =>
        t.dur >= avgRuntime - tolerance && t.dur <= avgRuntime + tolerance
    ).length;

    // Count multi-episode tracks (approximately 2x average runtime)
    const multiEpTracks = tracks.filter(t =>
        t.dur >= avgRuntime * 2 - tolerance && t.dur <= avgRuntime * 2 + tolerance
    ).length;

    // Each multi-episode track counts as 2 episodes
    return singleEpTracks + (multiEpTracks * 2);
}

/**
 * AI-powered track mapping (Option C: Raw data + soft guidance)
 * @param {Object} trackDurations - Track durations
 * @param {Object} metadata - Show/movie metadata
 * @param {Object|null} lsdvdMetadata - lsdvd disc metadata
 * @param {Array} unrippableTracks - List of unrippable track numbers
 * @param {number|null} discNumber - Disc number for multi-disc sets
 * @param {string|null} volumeName - DVD volume name (may contain disc info like S3D1)
 * @param {number|null} startEpisodeOverride - User-specified start episode
 * @returns {Promise<Object|null>} Mapping result or null
 */
async function aiMapTracks(trackDurations, metadata, lsdvdMetadata = null, unrippableTracks = [], discNumber = null, volumeName = null, startEpisodeOverride = null) {
    try {
        console.log('\n🧠 Mapping tracks to episodes...');
        getLogger().debug(`[AI] Starting track mapping (Option C: raw data + soft guidance)${discNumber ? `, disc ${discNumber}` : ''}${startEpisodeOverride ? `, start ep override: ${startEpisodeOverride}` : ''}`);
        getLogger().debug(`[AI] Track count: ${Object.keys(trackDurations).length}`);
        getLogger().debug(`[AI] Content type: ${metadata.type}`);
        getLogger().debug(`[AI] Episodes available: ${metadata.episodes ? metadata.episodes.length : 'N/A'}`);
        getLogger().debug(`[AI] lsdvd metadata: ${lsdvdMetadata ? 'available' : 'not available'}`);
        getLogger().debug(`[AI] Unrippable tracks: ${unrippableTracks.length > 0 ? unrippableTracks.join(', ') : 'none'}`);
        logToFile('AI: Starting track mapping (Option C)');
        logToFile(`AI: Track count - ${Object.keys(trackDurations).length}`);
        logToFile(`AI: Unrippable tracks - ${unrippableTracks.length > 0 ? unrippableTracks.join(', ') : 'none'}`);
        logToFile(`AI: Content type - ${metadata.type}`);
        logToFile(`AI: Episodes - ${metadata.episodes ? metadata.episodes.length : 'N/A'}`);
        logToFile(`AI: lsdvd metadata - ${lsdvdMetadata ? 'available' : 'not available'}`);
        if (startEpisodeOverride) {
            logToFile(`AI: Start episode override - ${startEpisodeOverride}`);
        }

        // Analyze episode runtimes for soft guidance (not hard rules)
        const episodes = metadata.episodes || [];
        const runtimeAnalysis = analyzeEpisodeRuntimes(episodes);

        // Build prompts from templates (Option C structure with raw data + soft guidance)
        const { system, user } = buildTrackMappingPrompts({
            metadata,
            trackDurations,
            runtimeAnalysis,
            lsdvdMetadata,
            unrippableTracks,
            volumeName,
            discNumber,
            startEpisodeOverride
        });

        // Call OpenAI with structured output validation
        const result = await callOpenAI(system, user, {
            schema: TrackMappingResponseSchema,
            schemaName: aiConfig.schemaNames.trackMapping
        });

        if (result && result.mappings) {
            const skipCount = result.mappings.filter(m => m.shouldSkip).length;
            const mapCount = result.mappings.length - skipCount;
            console.log(`   ✓ Mapped ${mapCount} tracks, marked ${skipCount} to skip`);
            console.log(`   Overall confidence: ${(result.overallConfidence * 100).toFixed(0)}%`);

            // Log detailed mappings
            logToFile('AI: === MAPPING RESULTS ===');
            result.mappings.forEach(m => {
                const action = m.shouldSkip ? 'SKIP' : `Episode ${m.episodeIndex !== null ? m.episodeIndex + 1 : '?'}`;
                const episodeName = !m.shouldSkip && m.episodeIndex !== null && episodes[m.episodeIndex]
                    ? ` (${episodes[m.episodeIndex].name})` : '';
                logToFile(`AI: Track ${m.trackNum} (${m.trackDuration} min) → ${action}${episodeName} [${(m.confidence * 100).toFixed(0)}%] - ${m.reasoning}`);
                getLogger().debug(`[AI]   Track ${m.trackNum}: ${action}${episodeName} (${(m.confidence * 100).toFixed(0)}% - ${m.reasoning})`);
            });
            logToFile('AI: === END MAPPING RESULTS ===');
            logToFile(`AI track mapping full response: ${JSON.stringify(result)}`);
            return result;
        } else {
            // Smart mapping failed - show prominent warning
            console.log('   ⚠️  Smart mapping FAILED - will fall back to sequential mapping');
            console.log('   ⚠️  This may result in incorrect track-to-episode assignments!');
            logToFile('AI: MAPPING FAILED - falling back to sequential mapping');
            return null;
        }
    } catch (error) {
        getLogger().debug(`AI mapping error: ${error.message}`);
        return null;
    }
}

/**
 * Check if OpenAI API key is configured
 * @returns {boolean} True if API key is available
 */
function hasOpenAiKey() {
    const config = loadConfigFn();
    return !!config.openaiApiKey;
}

module.exports = {
    // Configuration
    setLogFunction,
    setOptions,
    setConfigLoader,

    // Validation
    validateOpenAiApiKey,
    hasOpenAiKey,

    // Core AI functions
    callOpenAI,
    aiExtractSearchQuery,
    aiSelectTmdbMatch,
    aiValidateMappingResults,
    aiMapTracks,

    // Helper functions
    analyzeEpisodeRuntimes,
    countEpisodeLikeTracks
};
