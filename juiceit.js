#!/usr/bin/env node
/**
 * JuiceIt - Smart DVD Ripper
 *
 * This script rips all tracks from a DVD using HandBrakeCLI.
 *
 * Usage:
 *   juice-it [options]
 *
 * Options:
 *   --help      Show this help message
 *   --output    Specify the output directory
 *   --dvdSource Specify the DVD source (e.g., /dev/disk5)
 *   --title     Specify the movie/show title for TMDB lookup
 *   --quality   Set the encoding quality (e.g., 20)
 *   --no-deinterlace  Disable deinterlacing
 *   --subtitles  Specify the subtitle track number (default: 1)
 *   --sub-lang   Specify the subtitle language code (default: eng)
 *   --verbose   Show detailed technical output
 *
 * Example:
 *   juice-it --output /path/to/output --dvdSource /dev/disk5
 *
 * Requirements:
 *   - Node.js
 *   - HandBrakeCLI
 *   - libdvdcss (for encrypted DVDs)
 */

const { execSync, spawn, spawnSync } = require('child_process'); // Ensure spawn is imported
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Select, Input } = require('enquirer');
const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');

// Prompt templates and schemas
const { buildTmdbMatchPrompts, buildTrackMappingPrompts } = require('./prompts/loader');
const { TmdbMatchSchema, TrackMappingResponseSchema } = require('./prompts/schemas');

// AI configuration
const aiConfig = require('./config/ai-config');

// Logger
const { getLogger } = require('./lib/logger');

// Plex-compatible naming utilities
const { sanitizeForPlex, calculateProposedName } = require('./lib/naming');

// ==================== LOGGING ====================

// Global logger instance - initialized after options are parsed
let logger = null;
const skippedTracks = []; // Tracks that failed during ripping
const mappingSkippedTracks = []; // Tracks skipped due to AI mapping (menus, extras, etc.)

// Legacy functions that wrap the new logger (for gradual migration)
function initializeLog(outputDir, volumeName) {
    return logger.initFileLogging(outputDir, volumeName);
}

function log(message) {
    if (logger) {
        logger.fileOnly(message);
    }
}

function closeLog() {
    if (logger) {
        logger.close();
    }
}

// ==================== CONFIG MANAGEMENT ====================

// Get config directory path
function getConfigDir() {
    const os = require('os');
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), '.config', 'juice-it');
    } else if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'juice-it');
    } else {
        return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'juice-it');
    }
}

// Load config from file
function loadConfig() {
    const configPath = path.join(getConfigDir(), 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            return {};
        }
    }
    return {};
}

// Save config to file
function saveConfig(config) {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    const configPath = path.join(configDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ==================== METADATA LOOKUP ====================

// Load API key from config or use demo key
const config = loadConfig();
const TMDB_API_KEY = config.tmdbApiKey || 'REMOVED_API_KEY'; // Demo key fallback

async function searchTMDB(query, isTV = false) {
    try {
        const endpoint = isTV ? 'search/tv' : 'search/movie';
        const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, {
            params: {
                api_key: TMDB_API_KEY,
                query: query,
                language: 'en-US'
            }
        });
        return response.data.results || [];
    } catch (error) {
        logger.debug(`Error searching TMDB: ${error.message}`);
        return [];
    }
}

async function getTVSeasonDetails(tvId, seasonNumber) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}`, {
            params: {
                api_key: TMDB_API_KEY,
                language: 'en-US'
            }
        });
        return response.data;
    } catch (error) {
        logger.debug(`Error fetching season details: ${error.message}`);
        return null;
    }
}

// Validate TMDB API key
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

// Validate OpenAI API key
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

// ==================== AI HELPERS ====================

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
        const config = loadConfig();
        if (!config.openaiApiKey) {
            logger.debug('[AI] No OpenAI key configured, skipping AI call');
            return null;
        }

        // Use structured output if schema provided and config allows
        const useStructured = schema && schemaName && aiConfig.useStructuredOutput;

        logger.debug('[AI] Calling OpenAI API...');
        logger.debug(`[AI] Model: ${aiConfig.model}`);
        logger.debug(`[AI] Temperature: ${aiConfig.temperature}`);
        logger.debug(`[AI] Structured output: ${useStructured ? 'Yes (Zod schema)' : 'No (JSON mode)'}`);
        logger.debug(`[AI] System message: ${systemMessage.substring(0, 100)}...`);
        logger.debug(`[AI] User message length: ${userMessage.length} chars`);
        log(`AI: Calling OpenAI API with ${aiConfig.model}`);
        log(`AI: Temperature: ${aiConfig.temperature}`);
        log(`AI: Structured output: ${useStructured ? 'Yes (Zod schema)' : 'No (JSON mode)'}`);
        log(`AI: User message length: ${userMessage.length} chars`);
        log('AI: === PROMPT START ===');
        log(`AI: System: ${systemMessage}`);
        log(`AI: User: ${userMessage}`);
        log('AI: === PROMPT END ===');

        const openai = new OpenAI({
            apiKey: config.openaiApiKey
            // No timeout - we wait for AI to complete, showing progress messages
        });

        const startTime = Date.now();

        // Show clean progress indicator (update once per second)
        process.stdout.write('   ⏳ Waiting for AI');
        const progressInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write('.');
            if (elapsed === aiConfig.slowResponseWarningSeconds) {
                process.stdout.write(' (taking longer than expected)');
            }
        }, 1000);

        let result;
        let tokenUsage;
        try {
            if (useStructured) {
                // Use structured output with Zod schema validation
                // Note: In OpenAI SDK v6+, parse() is on chat.completions, not beta.chat.completions
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
                    log(`AI: Refusal: ${response.choices[0].message.refusal}`);
                    logger.debug(`[AI] Refusal: ${response.choices[0].message.refusal}`);
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

        logger.debug(`[AI] Response received in ${elapsed}ms`);
        logger.debug(`[AI] Tokens used: ${tokenUsage.total_tokens}`);
        logger.debug(`[AI] Response: ${JSON.stringify(result, null, 2)}`);
        log(`AI: Response received in ${elapsed}ms`);
        log(`AI: Tokens - prompt: ${tokenUsage.prompt_tokens}, completion: ${tokenUsage.completion_tokens}, total: ${tokenUsage.total_tokens}`);
        log(`AI: Response: ${JSON.stringify(result)}`);

        return result;
    } catch (error) {
        logger.debug(`[AI] Error: ${error.message}`);
        log(`AI API error: ${error.message}`);
        return null;
    }
}

// AI-powered TMDB match selection
async function aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults) {
    try {
        if (!options.diagnose) {
            console.log('\n🤖 Using AI to analyze disc and select best match...');
        }
        logger.debug('[AI] Starting TMDB match selection');
        logger.debug(`[AI] Analyzing: ${volumeName} with ${numTitles} tracks`);
        logger.debug(`[AI] Track durations: ${JSON.stringify(trackDurations)}`);
        logger.debug(`[AI] TMDB results: ${movieResults.length} movies, ${tvResults.length} TV shows`);
        log('AI: Starting TMDB match selection');
        log(`AI: Disc - ${volumeName} with ${numTitles} tracks`);
        log(`AI: Track durations - ${JSON.stringify(trackDurations)}`);
        log(`AI: TMDB results - ${movieResults.length} movies, ${tvResults.length} TV shows`);

        // Build prompts from templates
        const { system, user } = buildTmdbMatchPrompts({
            volumeName,
            numTitles,
            trackDurations,
            movieResults,
            tvResults
        });

        // Call OpenAI with structured output validation
        const result = await callOpenAI(system, user, {
            schema: TmdbMatchSchema,
            schemaName: aiConfig.schemaNames.tmdbMatch
        });

        if (result && result.selectedId) {
            console.log(`   ✓ AI selected: ${result.selectedType === 'tv' ? 'TV' : 'Movie'} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
            console.log(`   Reasoning: ${result.reasoning}`);
            logger.debug(`[AI] Selected ID: ${result.selectedId}`);
            logger.debug(`[AI] Season: ${result.season || 'N/A'}`);
            log(`AI TMDB selection: ${JSON.stringify(result)}`);
        } else {
            logger.debug('[AI] No match selected or low confidence');
        }

        return result;
    } catch (error) {
        logger.debug(`AI selection error: ${error.message}`);
        return null;
    }
}

// Analyze episode metadata to derive show-specific runtime characteristics
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
    // If episodes are consistent (variance < 5 min), use tighter tolerance
    // If episodes vary more, use looser tolerance
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

// AI-powered track mapping (Option C: Raw data + soft guidance)
async function aiMapTracks(trackDurations, metadata, lsdvdMetadata = null) {
    try {
        console.log('\n🤖 Using AI to map tracks to episodes...');
        logger.debug('[AI] Starting track mapping (Option C: raw data + soft guidance)');
        logger.debug(`[AI] Track count: ${Object.keys(trackDurations).length}`);
        logger.debug(`[AI] Content type: ${metadata.type}`);
        logger.debug(`[AI] Episodes available: ${metadata.episodes ? metadata.episodes.length : 'N/A'}`);
        logger.debug(`[AI] lsdvd metadata: ${lsdvdMetadata ? 'available' : 'not available'}`);
        log('AI: Starting track mapping (Option C)');
        log(`AI: Track count - ${Object.keys(trackDurations).length}`);
        log(`AI: Content type - ${metadata.type}`);
        log(`AI: Episodes - ${metadata.episodes ? metadata.episodes.length : 'N/A'}`);
        log(`AI: lsdvd metadata - ${lsdvdMetadata ? 'available' : 'not available'}`);

        // Analyze episode runtimes for soft guidance (not hard rules)
        const episodes = metadata.episodes || [];
        const runtimeAnalysis = analyzeEpisodeRuntimes(episodes);

        // Build prompts from templates (Option C structure with raw data + soft guidance)
        // Note: buildTrackMappingPrompts now handles all formatting internally
        const { system, user } = buildTrackMappingPrompts({
            metadata,
            trackDurations,
            runtimeAnalysis,
            lsdvdMetadata
        });

        // Call OpenAI with structured output validation
        const result = await callOpenAI(system, user, {
            schema: TrackMappingResponseSchema,
            schemaName: aiConfig.schemaNames.trackMapping
        });

        if (result && result.mappings) {
            const skipCount = result.mappings.filter(m => m.shouldSkip).length;
            const mapCount = result.mappings.length - skipCount;
            console.log(`   ✓ AI mapped ${mapCount} tracks, marked ${skipCount} to skip`);
            console.log(`   Overall confidence: ${(result.overallConfidence * 100).toFixed(0)}%`);

            // Log detailed mappings
            log('AI: === MAPPING RESULTS ===');
            result.mappings.forEach(m => {
                const action = m.shouldSkip ? 'SKIP' : `Episode ${m.episodeIndex !== null ? m.episodeIndex + 1 : '?'}`;
                const episodeName = !m.shouldSkip && m.episodeIndex !== null && episodes[m.episodeIndex]
                    ? ` (${episodes[m.episodeIndex].name})` : '';
                log(`AI: Track ${m.trackNum} (${m.trackDuration} min) → ${action}${episodeName} [${(m.confidence * 100).toFixed(0)}%] - ${m.reasoning}`);
                logger.debug(`[AI]   Track ${m.trackNum}: ${action}${episodeName} (${(m.confidence * 100).toFixed(0)}% - ${m.reasoning})`);
            });
            log('AI: === END MAPPING RESULTS ===');
            log(`AI track mapping full response: ${JSON.stringify(result)}`);
            return result;
        } else {
            // AI mapping failed - show prominent warning
            console.log('   ⚠️  AI mapping FAILED - will fall back to sequential mapping');
            console.log('   ⚠️  This may result in incorrect track-to-episode assignments!');
            log('AI: MAPPING FAILED - falling back to sequential mapping');
            return null;
        }
    } catch (error) {
        logger.debug(`AI mapping error: ${error.message}`);
        return null;
    }
}

// Setup workflow for API key configuration
async function runSetup() {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🔑 JuiceIt API Key Setup');
    console.log('━'.repeat(60));
    console.log('');
    
    const config = loadConfig();
    
    // TMDB API Key Setup (Required)
    console.log('🎬 TMDB API Key (Required for metadata lookup)');
    console.log('');
    console.log('📋 Steps to get your TMDB API key:');
    console.log('  1. Create account at https://www.themoviedb.org/signup');
    console.log('  2. Go to https://www.themoviedb.org/settings/api');
    console.log('  3. Request an API key (choose "Developer" option)');
    console.log('  4. Copy your "API Key (v3 auth)"');
    console.log('');
    
    const tmdbPrompt = new Input({
        message: 'Enter your TMDB API key (or press Enter to use demo key):',
        validate(_value) {
            return true; // Allow blank for demo key
        }
    });
    
    try {
        const tmdbApiKey = await tmdbPrompt.run();
        
        if (tmdbApiKey && tmdbApiKey.trim().length > 0) {
            console.log('');
            console.log('🔍 Validating TMDB API key...');
            
            const isTmdbValid = await validateTmdbApiKey(tmdbApiKey);
            
            if (isTmdbValid) {
                config.tmdbApiKey = tmdbApiKey;
                console.log('✅ TMDB API key validated!');
            } else {
                console.log('❌ Invalid TMDB API key. Please check and try again.');
                console.log('');
                console.log('Run `juiceit --setup` to try again.');
                console.log('');
                process.exit(1);
            }
        } else {
            // Use demo key
            console.log('');
            console.log('ℹ️  Using demo TMDB API key (rate limited)');
            console.log('   Get your free key at: https://www.themoviedb.org/settings/api');
            config.tmdbApiKey = 'REMOVED_API_KEY';
        }
        
        // OpenAI API Key Setup (Optional)
        console.log('');
        console.log('━'.repeat(60));
        console.log('🤖 OpenAI API Key (Optional - enables AI-powered track mapping)');
        console.log('');
        console.log('AI features:');
        console.log('  • Automatic TMDB match selection');
        console.log('  • Intelligent track-to-episode mapping');
        console.log('  • Auto-detection of menus and extras');
        console.log('  • Handles complex disc layouts automatically');
        console.log('');
        console.log('📋 To get an OpenAI API key:');
        console.log('  1. Go to https://platform.openai.com/api-keys');
        console.log('  2. Create a new API key');
        console.log('  3. Typical cost: $0.001-0.002 per disc (uses GPT-4o-mini)');
        console.log('');
        
        const skipOpenAI = new Select({
            message: 'Do you want to configure OpenAI for AI features?',
            choices: ['Yes', 'No (skip AI features)']
        });
        
        const openAiChoice = await skipOpenAI.run();
        
        if (openAiChoice === 'Yes') {
            const openAiPrompt = new Input({
                message: 'Enter your OpenAI API key (or press Enter to skip):',
                validate(_value) {
                    return true; // Allow blank to skip
                }
            });
            
            const openAiApiKey = await openAiPrompt.run();
            
            if (openAiApiKey && openAiApiKey.trim().length > 0) {
                console.log('');
                console.log('🔍 Validating OpenAI API key...');
                
                const isOpenAiValid = await validateOpenAiApiKey(openAiApiKey);
                
                if (isOpenAiValid) {
                    config.openaiApiKey = openAiApiKey;
                    console.log('✅ OpenAI API key validated!');
                    console.log('');
                    console.log('✨ AI features are now enabled!');
                } else {
                    console.log('❌ Invalid OpenAI API key.');
                    console.log('   Continuing without AI features.');
                }
            } else {
                console.log('');
                console.log('ℹ️  No OpenAI key provided. Continuing without AI features.');
                console.log('   You can add it later by running `juiceit --setup` again.');
            }
        } else {
            console.log('');
            console.log('ℹ️  Skipping OpenAI setup. You can add it later by running `juiceit --setup` again.');
        }
        
        // Save config
        saveConfig(config);
        
        console.log('');
        console.log('━'.repeat(60));
        console.log(`✅ Setup complete! Config saved to: ${path.join(getConfigDir(), 'config.json')}`);
        console.log('━'.repeat(60));
        console.log('');
        console.log('You can now use JuiceIt with metadata lookup.');
        if (config.openaiApiKey) {
            console.log('✨ AI-powered track mapping is enabled!');
        }
        console.log('');
        
    } catch (error) {
        console.log('');
        console.log('Setup cancelled.');
        console.log('');
        process.exit(0);
    }
}

function guessMediaType(numTitles) {
    // If there are multiple titles (usually 2+), it's likely a TV show
    // Movies typically have 1-2 titles (feature + extras)
    return numTitles >= 3 ? 'tv' : 'movie';
}

async function lookupMetadata(volumeName, numTitles, trackDurations = null, searchOptions = {}) {
    console.log('\n🔍 Looking up metadata...');

    // Use provided search title or clean up the volume name for searching
    let cleanName;
    if (searchOptions.searchTitle) {
        cleanName = searchOptions.searchTitle.trim();
        console.log(`   Using provided title: "${cleanName}"`);
    } else {
        cleanName = volumeName.replace(/_/g, ' ').replace(/\s+D\d+$/i, '').trim();
    }
    const mediaType = guessMediaType(numTitles);
    
    log(`Searching for: "${cleanName}" (guessing type: ${mediaType})`);
    
    // Search both movie and TV
    const movieResults = await searchTMDB(cleanName, false);
    const tvResults = await searchTMDB(cleanName, true);
    
    // Try AI-powered selection if available and we have track durations
    const config = loadConfig();
    if (config.openaiApiKey && trackDurations) {
        const aiSelection = await aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults);

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
                    const season = aiSelection.season || 1;
                    const seasonDetails = await getTVSeasonDetails(selectedResult.id, season);
                    const showYear = selectedResult.first_air_date ? selectedResult.first_air_date.split('-')[0] : null;
                    console.log(`\n   ✨ AI auto-selected: ${selectedResult.name} - Season ${season}${confidenceStr}`);
                    return {
                        type: 'tv',
                        name: selectedResult.name,
                        year: showYear,
                        season: season,
                        episodes: seasonDetails ? seasonDetails.episodes : null,
                        aiSelected: true
                    };
                } else {
                    console.log(`\n   ✨ AI auto-selected: ${selectedResult.title}${confidenceStr}`);
                    return {
                        type: 'movie',
                        name: selectedResult.title,
                        year: selectedResult.release_date ? selectedResult.release_date.split('-')[0] : null,
                        aiSelected: true
                    };
                }
            } else if (aiSelection.confidence < 0.6) {
                // Low confidence - exit with helpful instructions
                const suggestion = selectedResult
                    ? (aiSelection.selectedType === 'tv' ? selectedResult.name : selectedResult.title)
                    : null;

                console.log(`\n   ⚠️  AI confidence too low (${(aiSelection.confidence * 100).toFixed(0)}%)`);
                console.log(`   The disc name "${cleanName}" doesn't clearly match any known title.`);
                if (suggestion) {
                    console.log(`   Best guess: "${suggestion}" (but not confident enough to auto-select)\n`);
                } else {
                    console.log('');
                }
                console.log('━'.repeat(60));
                console.log('  To rip this disc, use one of these options:\n');
                console.log('  1. Specify the title:');
                console.log('     juice-it --title "Movie Name"');
                console.log('     juice-it --title "TV Show Name"\n');
                console.log('  2. Use interactive mode to search and select:');
                console.log('     juice-it --interactive\n');
                console.log('  3. Skip metadata lookup entirely (raw rip):');
                console.log('     juice-it --raw');
                console.log('━'.repeat(60) + '\n');
                process.exit(1);
            }
        }
    }

    // In automatic mode without AI: use first result or prompt for title if no results
    if (!options.interactive) {
        if (mediaType === 'tv' && tvResults.length > 0) {
            const show = tvResults[0];
            const seasonDetails = await getTVSeasonDetails(show.id, 1);
            const showYear = show.first_air_date ? show.first_air_date.split('-')[0] : null;
            console.log(`\n   📺 Auto-selected: ${show.name} - Season 1`);
            return {
                type: 'tv',
                name: show.name,
                year: showYear,
                season: 1,
                episodes: seasonDetails ? seasonDetails.episodes : null
            };
        } else if (movieResults.length > 0) {
            const movie = movieResults[0];
            console.log(`\n   🎬 Auto-selected: ${movie.title}`);
            return {
                type: 'movie',
                name: movie.title,
                year: movie.release_date ? movie.release_date.split('-')[0] : null
            };
        } else {
            // No TMDB results found - exit with helpful instructions
            console.log(`\n   ❌ Couldn't identify disc automatically`);
            console.log(`   The disc name "${cleanName}" doesn't match any known titles.\n`);
            console.log('━'.repeat(60));
            console.log('  To rip this disc, use one of these options:\n');
            console.log('  1. Specify the title:');
            console.log('     juice-it --title "Movie Name"');
            console.log('     juice-it --title "TV Show Name"\n');
            console.log('  2. Use interactive mode to search and select:');
            console.log('     juice-it --interactive\n');
            console.log('  3. Skip metadata lookup entirely (raw rip):');
            console.log('     juice-it --raw');
            console.log('━'.repeat(60) + '\n');
            process.exit(1);
        }
    }
    
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
    choices.push({ name: 'Enter custom name/prefix (skip TMDB)', value: { type: 'custom' } });
    choices.push({ name: `Use disc name: "${volumeName}"`, value: { type: 'disc' } });

    if (choices.length === 3) {
        // No TMDB results found - show helpful message but STILL show the prompt
        // so users can search for a different title or enter custom name
        console.log(`⚠️  No results found for "${cleanName}"\n`);
        console.log('   The disc name may not match the actual title.');
        console.log('   You can search for the correct title below.\n');
        log('No TMDB results found, showing search prompt');
    }
    
    try {
        // Use Select instead of AutoComplete to avoid regex issues with special characters
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
        log(`User selected: ${JSON.stringify(selected)}`);
        
        if (selected.type === 'search') {
            // User wants to search for a different title
            const searchPrompt = new Input({
                message: 'Enter the actual title to search for:',
                initial: ''
            });
            const searchTitle = await searchPrompt.run();
            log(`User searching for: ${searchTitle}`);

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
                // Recursive: let them try again or choose another option
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
            newChoices.push({ name: 'Enter custom name/prefix (skip TMDB)', value: { type: 'custom' } });
            newChoices.push({ name: `Use disc name: "${volumeName}"`, value: { type: 'disc' } });

            console.log(`   ✓ Found ${newMovieResults.length} movies, ${newTvResults.length} TV shows\n`);

            // Show new selection prompt
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
            log(`User selected from new search: ${JSON.stringify(newSelected)}`);

            // Handle the new selection (recursively process)
            if (newSelected.type === 'search') {
                return lookupMetadata(volumeName, numTitles, trackDurations, searchOptions);
            } else if (newSelected.type === 'custom') {
                const customPrompt = new Input({
                    message: 'Enter name or prefix for episodes:',
                    initial: searchTitle
                });
                const customName = await customPrompt.run();
                return { type: 'custom', name: customName };
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
                const showYear = newSelected.data.first_air_date ? newSelected.data.first_air_date.split('-')[0] : null;
                return {
                    type: 'tv',
                    name: newSelected.data.name,
                    year: showYear,
                    season: season,
                    episodes: seasonDetails ? seasonDetails.episodes : null
                };
            } else {
                return {
                    type: 'movie',
                    name: newSelected.data.title,
                    year: newSelected.data.release_date ? newSelected.data.release_date.split('-')[0] : null
                };
            }
        } else if (selected.type === 'custom') {
            const namePrompt = new Input({
                message: 'Enter name or prefix for episodes:',
                initial: cleanName
            });
            const customName = await namePrompt.run();
            log(`User entered custom name: ${customName}`);
            return { type: 'custom', name: customName };
        } else if (selected.type === 'disc') {
            return { type: 'disc', volumeName };
        } else if (selected.type === 'tv') {
            // For TV shows, ask about season
            const seasonPrompt = new Input({
                message: 'Enter season number (default: 1):',
                initial: '1',
                validate(value) {
                    return /^\d+$/.test(value) || 'Please enter a valid number';
                }
            });
            const season = parseInt(await seasonPrompt.run());
            log(`User selected season: ${season}`);

            // Fetch episode details
            const seasonDetails = await getTVSeasonDetails(selected.data.id, season);
            const showYear = selected.data.first_air_date ? selected.data.first_air_date.split('-')[0] : null;

            return {
                type: 'tv',
                name: selected.data.name,
                year: showYear,
                season: season,
                episodes: seasonDetails ? seasonDetails.episodes : null
            };
        } else {
            return {
                type: 'movie',
                name: selected.data.title,
                year: selected.data.release_date ? selected.data.release_date.split('-')[0] : null
            };
        }
    } catch (error) {
        // User cancelled or error occurred
        console.log('\nUsing disc name as fallback\n');
        log('User cancelled selection or error occurred');
        return { type: 'disc', volumeName };
    }
}

// ==================== DISPLAY HELPERS ====================

// Create a progress bar
function createProgressBar(progress, width = 20) {
    const percentage = Math.min(100, Math.max(0, parseFloat(progress)));
    const filledWidth = Math.round((percentage / 100) * width);
    const emptyWidth = width - filledWidth;
    const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
    return `[${bar}] ${percentage.toFixed(2)}%`;
}

// Format time in seconds to human readable
function formatTime(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

// Print a clean header banner
function printBanner(volumeName) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬  JuiceIt DVD Ripper');
    console.log('━'.repeat(60));
    console.log(`  DVD:     "${volumeName}"`);
    console.log(`  Output:  ${options.outputDir}/`);
    console.log(`  Quality: HQ 1080p30 (CRF ${options.encoding.quality})`);
    console.log('━'.repeat(60));
    console.log('');
}

// Centralized argument processing
const args = process.argv.slice(2);
const options = {
    outputDir: null, // Will be set dynamically based on disc name + datestamp
    dvdSource: null, // Initialize dvdSource
    encoding: {
        encoder: 'x264', // Default encoder
        quality: '20',    // Default quality
        deinterlace: true, // Default to enabled
    },
    subtitles: {
        track: 1, // Default to the first subtitle track
        language: 'eng' // Default to English
    },
    verbose: false // Default to clean output
};

// Track which argument indices are consumed as values for flags like --output, --dvdSource, etc.
const consumedIndices = new Set();

// Process command-line arguments
args.forEach((arg, index) => {
    // Skip if this index is a value for a previous flag
    if (consumedIndices.has(index)) {
        return;
    }

    if (arg === '--help') {
        options.showHelp = true;
    } else if (arg === '--help-dev') {
        options.showHelpDev = true;
    } else if (arg === '--version' || arg === '-v') {
        options.showVersion = true;
    } else if (arg === '--output' && args[index + 1]) {
        options.outputDir = args[index + 1];
        consumedIndices.add(index + 1);
    } else if (arg === '--dvdSource' && args[index + 1]) {
        options.dvdSource = args[index + 1];
        consumedIndices.add(index + 1);
    } else if (arg === '--title' && args[index + 1]) {
        options.searchTitle = args[index + 1];
        consumedIndices.add(index + 1);
    } else if (arg === '--quality' && args[index + 1]) {
        options.encoding.quality = args[index + 1];
        consumedIndices.add(index + 1);
    } else if (arg === '--no-deinterlace') {
        options.encoding.deinterlace = false;
    } else if (arg === '--subtitles' && args[index + 1]) {
        options.subtitles.track = parseInt(args[index + 1], 10);
        consumedIndices.add(index + 1);
    } else if (arg === '--sub-lang' && args[index + 1]) {
        options.subtitles.language = args[index + 1];
        consumedIndices.add(index + 1);
    } else if (arg === '--verbose') {
        options.verbose = true;
    } else if (arg === '--no-lookup') {
        options.noLookup = true;
    } else if (arg === '--rename-only') {
        options.renameOnly = true;
    } else if (arg === '--scan-only') {
        options.scanOnly = true;
    } else if (arg === '--setup') {
        options.runSetup = true;
    } else if (arg === '--plan') {
        options.planOnly = true;
    } else if (arg === '--interactive' || arg === '-i') {
        options.interactive = true;
    } else if (arg === '--diagnose') {
        options.diagnose = true;
    } else if (arg === '--raw') {
        options.rawMode = true;
        options.noLookup = true;
    } else if (arg === '--include-extras') {
        options.includeExtras = true;
    } else if (arg === '--dry-run') {
        options.dryRun = true;
    } else if (arg.startsWith('-')) {
        // Unknown flag - show error and exit
        console.error(`Error: Unknown option '${arg}'`);
        console.error(`Run 'juice-it --help' for usage information.`);
        process.exit(1);
    }
});

// Initialize the logger with verbosity setting
logger = getLogger({ verbose: options.verbose });

// Helper function to set default output directory
function setDefaultOutputDir(volumeName) {
    if (!options.outputDir) {
        // Use local date and time for unique folder per run
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`; // YYYY-MM-DD_HH-MM-SS
        const safeName = volumeName.replace(/[^a-zA-Z0-9_-]/g, '_');
        options.outputDir = path.join(process.cwd(), `${safeName}_${timestamp}`);
    }
    // Ensure the output directory exists
    if (!fs.existsSync(options.outputDir)) {
        fs.mkdirSync(options.outputDir, { recursive: true });
    }
}

// Clean up old cache files, keeping only the most recent N files
function cleanupOldCacheFiles(cacheDir, maxFiles = 10) {
    try {
        if (!fs.existsSync(cacheDir)) return;
        
        const files = fs.readdirSync(cacheDir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(cacheDir, f),
                mtime: fs.statSync(path.join(cacheDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime); // Sort by most recent first
        
        // Delete files beyond maxFiles
        if (files.length > maxFiles) {
            const filesToDelete = files.slice(maxFiles);
            filesToDelete.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    logger.debug(`Cleaned up old cache: ${file.name}`);
                } catch (err) {
                    logger.debug(`Could not delete cache file ${file.name}: ${err.message}`);
                }
            });
        }
    } catch (error) {
        logger.debug(`Error cleaning up cache: ${error.message}`);
    }
}

// Cache file path will be set dynamically
function getCacheFilePath() {
    // Use system cache directory instead of polluting output folder
    const os = require('os');
    let cacheDir;
    
    if (process.platform === 'darwin') {
        // macOS: ~/Library/Caches/juice-it
        cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'juice-it');
    } else if (process.platform === 'win32') {
        // Windows: %LOCALAPPDATA%\juice-it\cache
        cacheDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'juice-it', 'cache');
    } else {
        // Linux/Unix: ~/.cache/juice-it
        cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'juice-it');
    }
    
    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Clean up old cache files (keep last 10)
    cleanupOldCacheFiles(cacheDir, 10);
    
    // Use volume name in cache filename to support multiple discs
    const volumeName = getVolumeName();
    const safeVolumeName = volumeName ? volumeName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
    return path.join(cacheDir, `${safeVolumeName}.json`);
}

// Check if HandBrakeCLI is installed
function checkHandBrakeCLI() {
    const result = spawnSync('HandBrakeCLI', ['--version']);
    if (result.error || result.status !== 0) {
        logger.error("HandBrakeCLI is not installed. Please install it using 'brew install handbrake' to use this script.");
        process.exit(1);
    }
}

// Check if libdvdcss is installed
function checkLibdvdcss() {
    const result = spawnSync('brew', ['list', 'libdvdcss']);
    if (result.error || result.status !== 0) {
        logger.error("libdvdcss is not installed. Please install it using 'brew install libdvdcss' to use this script.");
        process.exit(1);
    }
}

// Check if lsdvd is available (optional - provides additional metadata)
function checkLsdvd() {
    const result = spawnSync('which', ['lsdvd']);
    return result.status === 0;
}

/**
 * Get extended disc metadata using lsdvd
 * Returns additional info like chapters, audio streams, and subtitles per track
 * This provides context that HandBrakeCLI's scan doesn't give us
 *
 * @param {string} dvdSource - The DVD device path
 * @returns {Object|null} Parsed lsdvd data or null if unavailable
 */
function getLsdvdMetadata(dvdSource) {
    if (!checkLsdvd()) {
        logger.debug('[lsdvd] Not installed, skipping extended metadata');
        return null;
    }

    try {
        const result = spawnSync('lsdvd', [dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        if (result.error || result.status !== 0) {
            logger.debug(`[lsdvd] Failed to read disc: ${result.stderr || result.error?.message}`);
            return null;
        }

        const output = result.stdout + result.stderr; // lsdvd outputs to both
        return parseLsdvdOutput(output);
    } catch (error) {
        logger.debug(`[lsdvd] Error: ${error.message}`);
        return null;
    }
}

/**
 * Parse lsdvd text output into structured data
 *
 * @param {string} output - Raw lsdvd output
 * @returns {Object} Parsed metadata
 */
function parseLsdvdOutput(output) {
    const metadata = {
        discTitle: 'unknown',
        discId: null,
        longestTrack: null,
        tracks: {}
    };

    const lines = output.split('\n');

    for (const line of lines) {
        // Parse disc title
        const discTitleMatch = line.match(/^Disc Title:\s*(.+)$/i);
        if (discTitleMatch) {
            metadata.discTitle = discTitleMatch[1].trim();
            continue;
        }

        // Parse DVD Disc ID
        const discIdMatch = line.match(/^DVDDiscID:\s*(.+)$/i);
        if (discIdMatch) {
            metadata.discId = discIdMatch[1].trim();
            continue;
        }

        // Parse longest track
        const longestMatch = line.match(/^Longest track:\s*(\d+)$/i);
        if (longestMatch) {
            metadata.longestTrack = parseInt(longestMatch[1], 10);
            continue;
        }

        // Parse track info: Title: 01, Length: 00:08:47.000 Chapters: 01, Cells: 01, Audio streams: 03, Subpictures: 02
        const trackMatch = line.match(/^Title:\s*(\d+),\s*Length:\s*([\d:.]+)\s*Chapters:\s*(\d+),\s*Cells:\s*(\d+),\s*Audio streams:\s*(\d+),\s*Subpictures:\s*(\d+)/i);
        if (trackMatch) {
            const trackNum = parseInt(trackMatch[1], 10);
            const length = trackMatch[2];
            const chapters = parseInt(trackMatch[3], 10);
            const cells = parseInt(trackMatch[4], 10);
            const audioStreams = parseInt(trackMatch[5], 10);
            const subpictures = parseInt(trackMatch[6], 10);

            // Parse length to minutes
            const [hours, mins, secs] = length.split(':').map(parseFloat);
            const durationMinutes = Math.round(hours * 60 + mins + secs / 60);

            metadata.tracks[trackNum] = {
                length,
                durationMinutes,
                chapters,
                cells,
                audioStreams,
                subpictures
            };
        }
    }

    return metadata;
}

// Function to detect all DVD drives
function detectAllDvdDrives() {
    try {
        // First, try drutil to detect DVD in drive
        try {
            const drutilOutput = execSync('drutil status 2>/dev/null').toString();
            const deviceMatch = drutilOutput.match(/Name:\s+(\/dev\/disk\d+)/);
            
            if (deviceMatch) {
                const device = deviceMatch[1];
                // Get volume info from diskutil
                try {
                    const diskInfo = execSync(`diskutil info ${device} 2>/dev/null`).toString();
                    const volumeMatch = diskInfo.match(/Volume Name:\s+(.+)/);
                    const sizeMatch = diskInfo.match(/Disk Size:\s+([\d.]+\s+[GMK]B)/);
                    
                    const name = volumeMatch ? volumeMatch[1].trim() : 'DVD';
                    const size = sizeMatch ? sizeMatch[1].trim() : 'Unknown';
                    
                    return [{ device, name, size }];
                } catch (e) {
                    // If diskutil fails, still return the device
                    return [{ device, name: 'DVD', size: 'Unknown' }];
                }
            }
        } catch (e) {
            // drutil not available or no DVD, continue to fallback
        }
        
        // Fallback: scan diskutil list for external disks
        const diskListOutput = execSync('diskutil list 2>/dev/null').toString();
        const drives = [];
        
        // Find all external physical disks
        const diskMatches = diskListOutput.matchAll(/(\/dev\/disk\d+) \(external, physical\):[\s\S]*?TYPE NAME\s+SIZE\s+IDENTIFIER[\s\S]*?0:\s+(.+?)\s+(\d+\.\d+ [GMK]B)/g);
        
        for (const match of diskMatches) {
            const device = match[1];
            const name = match[2].trim();
            const size = match[3];
            
            // Verify it's actually a DVD by checking size (DVDs are typically 4.7GB or 8.5GB)
            const sizeNum = parseFloat(size);
            const unit = size.match(/[GMK]B$/)[0];
            
            if (unit === 'GB' && sizeNum > 0 && sizeNum < 20) {
                drives.push({ device, name, size });
            }
        }
        
        return drives;
    } catch (error) {
        logger.debug(`Error detecting DVD drives: ${error.message}`);
        return [];
    }
}

// Function to detect the DVD source automatically
async function detectDvdSource() {
    const drives = detectAllDvdDrives();

    if (drives.length === 0) {
        return null;
    } else if (drives.length === 1) {
        logger.debug(`Single DVD drive detected: ${drives[0].device}`);
        return drives[0].device;
    } else {
        // Multiple drives found
        logger.debug(`Multiple DVD drives detected: ${drives.length}`);

        if (!options.interactive) {
            // Automatic mode: cannot proceed with multiple drives
            console.log('');
            console.log('  ❌ Multiple DVD Drives Detected');
            console.log('');
            console.log('  Found more than one DVD drive with a disc inserted:');
            console.log('');
            drives.forEach(d => {
                console.log(`    • ${d.device} - "${d.name}" (${d.size})`);
            });
            console.log('');
            console.log('  In automatic mode, JuiceIt cannot determine which disc to rip.');
            console.log('');
            console.log('  Options:');
            console.log('    1. Specify the drive: juiceit --dvdSource /dev/diskN');
            console.log('    2. Use interactive mode: juiceit --interactive');
            console.log('       (This will let you select the disc to rip)');
            console.log('');
            process.exit(1);
        }

        // Interactive mode: show selection prompt
        console.log('\n📀 Multiple DVD drives detected:\n');

        const choices = drives.map(d => ({
            name: `${d.device} - "${d.name}" (${d.size})`,
            value: d.device
        }));

        try {
            const prompt = new Select({
                name: 'drive',
                message: 'Select DVD drive:',
                choices: choices
            });

            return await prompt.run();
        } catch (error) {
            console.log('\nSelection cancelled\n');
            return null;
        }
    }
}

// Show help if requested (do this before async operations)
if (options.showHelp) {
    showHelp();
    process.exit(0);
}

// Show developer help if requested
if (options.showHelpDev) {
    showDeveloperHelp();
    process.exit(0);
}

// Show version if requested
if (options.showVersion) {
    const pkg = require('./package.json');
    console.log(`juiceit v${pkg.version}`);
    process.exit(0);
}

// Run setup if requested
if (options.runSetup) {
    (async () => {
        await runSetup();
    })();
    // Exit early - don't continue to ripping
} else if (options.diagnose) {
    // Run diagnostic mode
    (async () => {
        await runDiagnosticMode();
    })();
} else {
    // Show API key status messages
    if (!options.noLookup) {
        if (!config.tmdbApiKey) {
            console.log('');
            console.log('⚠️  Using demo TMDB API key (rate limited)');
            console.log('   Get your free API key: https://www.themoviedb.org/settings/api');
            console.log('   Run: juiceit --setup');
            console.log('');
        }
        
    }

    // Async initialization function
    (async () => {
        // Set dvdSource if not provided
        if (!options.dvdSource) {
            options.dvdSource = await detectDvdSource(); // Automatically detect DVD source
        }

    // Fallback if no DVD source is detected
    if (!options.dvdSource) {
        console.log('');
        console.log('  ❌ No DVD Detected');
        console.log('');
        console.log('  Could not find a DVD drive with a disc inserted.');
        console.log('');
        console.log('  What you can try:');
        console.log('    1. Make sure a DVD is inserted and the disc has finished loading');
        console.log('    2. Wait a few seconds and try again');
        console.log('    3. Manually specify the DVD path: juiceit --dvdSource /dev/diskN');
        console.log('');
        console.log('  To find your DVD device, run: diskutil list');
        console.log('');
        process.exit(1);
    }

        // Start the ripping or renaming process
        if (options.renameOnly) {
            await renameExistingFiles();
        } else {
            await ripAllTracks();
        }
    })();
}

// Function to rip DVD with progress output
function ripDvd(titleNumber, outputFileName, trackNum, totalTracks, onProgress) {
    return new Promise((resolve, reject) => {
        const outputFilePath = path.join(options.outputDir, `${outputFileName}.mp4`); // Use options.outputDir

        // Dry-run mode: create stub file instead of actual ripping
        if (options.dryRun) {
            log(`[DRY-RUN] Would rip track ${titleNumber} to: ${outputFileName}.mp4`);

            // Simulate progress updates
            const totalSteps = 10;
            const stepDelay = 100; // 100ms per step (total ~1s simulation)
            let step = 0;

            const progressInterval = setInterval(() => {
                step++;
                const progress = (step / totalSteps) * 100;
                const elapsed = step * (stepDelay / 1000);
                const remaining = ((totalSteps - step) * stepDelay) / 1000;
                onProgress(progress, elapsed, remaining, trackNum, totalTracks);

                if (step >= totalSteps) {
                    clearInterval(progressInterval);

                    // Create stub file with metadata comment
                    const trackDuration = global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : 0;
                    const stubContent = `[DRY-RUN STUB FILE]
Track: ${titleNumber}
Filename: ${outputFileName}.mp4
Duration: ${trackDuration} minutes
Created: ${new Date().toISOString()}
Command would be: HandBrakeCLI -i ${options.dvdSource} -t ${titleNumber} -o ${outputFilePath}
`;
                    fs.writeFileSync(outputFilePath, stubContent);
                    log(`[DRY-RUN] Created stub file: ${outputFilePath}`);
                    resolve();
                }
            }, stepDelay);

            return;
        }

        // Updated arguments for HandBrakeCLI with conditional deinterlacing, subtitles, and additional options
        const args = [
            '-i', options.dvdSource,
            '-o', outputFilePath,
            '-e', options.encoding.encoder,
            '-q', options.encoding.quality,
            '-t', titleNumber.toString(),
            '--all-audio', // Include ALL audio tracks from the source
            '--subtitle', options.subtitles.track.toString(), // Include the specified subtitle track
            '--decomb', // Use decomb filter for deinterlacing
            '--detelecine', // Use detelecine filter
            '--rate', '30', // Set frame rate to 30 fps
            '--preset', 'HQ 1080p30 Surround' // Use a valid preset
        ];

        // Add deinterlace option if enabled
        if (options.encoding.deinterlace) {
            args.push('--deinterlace');
        }

        // Log the HandBrakeCLI command
        log(`Starting track ${titleNumber}: ${outputFileName}`);
        log(`Command: HandBrakeCLI ${args.join(' ')}`);

        logger.debug(`Running HandBrakeCLI with command: HandBrakeCLI ${args.join(' ')}`);

        const startTime = Date.now();
        const handbrakeProcess = spawn('HandBrakeCLI', args);
        let lastProgress = 0;
        let errorOutput = '';

        handbrakeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            log(`[stdout] ${output.trim()}`);
            const progressMatch = output.match(/Encoding:.* (\d{1,3}\.\d{1,2}) %/);
            if (progressMatch && progressMatch[1]) {
                const progress = parseFloat(progressMatch[1]);
                if (progress !== lastProgress) {
                    lastProgress = progress;
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const estimatedTotal = progress > 0 ? (elapsedSeconds / progress) * 100 : 0;
                    const remainingSeconds = estimatedTotal - elapsedSeconds;
                    onProgress(progress, elapsedSeconds, remainingSeconds, trackNum, totalTracks);
                }
            }
        });

        handbrakeProcess.stderr.on('data', (data) => {
            const dataStr = data.toString();
            errorOutput += dataStr;
            log(`[stderr] ${dataStr.trim()}`);
            logger.debug(`[handbrake-info]: ${dataStr.trim()}`);
        });

        handbrakeProcess.on('close', (code) => {
            if (code === 0) {
                log(`Track ${titleNumber} completed successfully`);
                resolve();
            } else {
                log(`Track ${titleNumber} failed with exit code ${code}`);
                log(`Error output: ${errorOutput}`);
                reject({ code, errorOutput, titleNumber });
            }
        });
    });
}

// Reset the DVD drive after a stuck read (eject and wait for remount)
async function resetDvdDrive(dvdSource) {
    return new Promise((resolve) => {
        logger.debug('Resetting DVD drive to clear stuck I/O...');
        console.log('   🔄 Resetting DVD drive...');

        // Try multiple eject methods - drutil is most forceful (talks to firmware)
        let ejected = false;

        // Method 1: drutil eject (most forceful - direct to drive firmware)
        const drutilResult = spawnSync('drutil', ['eject'], { timeout: 5000 });
        if (drutilResult.status === 0) {
            ejected = true;
            logger.debug('Ejected via drutil');
        }

        // Method 2: diskutil eject
        if (!ejected) {
            const diskutilResult = spawnSync('diskutil', ['eject', dvdSource], { timeout: 5000 });
            if (diskutilResult.status === 0) {
                ejected = true;
                logger.debug('Ejected via diskutil eject');
            }
        }

        // Method 3: diskutil unmount force
        if (!ejected) {
            const unmountResult = spawnSync('diskutil', ['unmount', 'force', dvdSource], { timeout: 5000 });
            if (unmountResult.status === 0) {
                ejected = true;
                logger.debug('Ejected via diskutil unmount force');
            }
        }

        if (!ejected) {
            console.log('   ⚠️  Could not eject disc - you may need to unplug/replug the drive');
            logger.debug('All eject methods failed');
            resolve(false);
            return;
        }

        console.log('   📀 Disc ejected - please reinsert to continue...');

        // Wait for disc to be reinserted and mounted
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max wait for user to reinsert
        const checkInterval = setInterval(() => {
            attempts++;

            // Check if any DVD is mounted
            const result = spawnSync('diskutil', ['list'], { timeout: 5000 });
            const output = result.stdout?.toString() || '';

            // Look for optical media (UDF filesystem typically)
            if (output.includes('UDF') || output.includes(dvdSource.replace('/dev/', ''))) {
                clearInterval(checkInterval);
                // Give it a moment to fully mount
                setTimeout(() => {
                    console.log('   ✓ DVD drive reset complete');
                    logger.debug('DVD drive reset successful');
                    resolve(true);
                }, 2000);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.log('   ⚠️  Timeout waiting for disc - please reinsert and try again');
                logger.debug('DVD drive reset timeout - disc not remounted');
                resolve(false);
            } else if (attempts % 15 === 0) {
                console.log(`   ⏳ Waiting for disc to be reinserted... (${attempts}s)`);
            }
        }, 1000);
    });
}

// Scan a single title with timeout (for fallback when full scan gets stuck)
// Kept for potential future use but currently unused (we skip stuck tracks instead)
async function _scanSingleTitle(dvdSource, titleNum, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const args = ['-i', dvdSource, '--title', String(titleNum), '--scan', '--previews', '0:0'];
        const handbrakeProcess = spawn('HandBrakeCLI', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let _output = '';
        let duration = null;
        let resolved = false;

        const timeout = setTimeout(async () => {
            if (!resolved) {
                resolved = true;
                handbrakeProcess.kill('SIGKILL'); // Use SIGKILL for immediate termination
                // Reset the drive to clear kernel I/O stuck state
                await resetDvdDrive(dvdSource);
                resolve({ titleNum, duration: null, stuck: true });
            }
        }, timeoutMs);

        const processData = (data) => {
            if (resolved) return;
            const chunk = data.toString();
            _output += chunk;

            // Parse duration
            const durationMatch = chunk.match(/scan: duration is (\d{2}):(\d{2}):(\d{2})/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1], 10);
                const mins = parseInt(durationMatch[2], 10);
                const secs = parseInt(durationMatch[3], 10);
                duration = hours * 60 + mins + Math.round(secs / 60);
            }
        };

        handbrakeProcess.stdout.on('data', processData);
        handbrakeProcess.stderr.on('data', processData);

        handbrakeProcess.on('close', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ titleNum, duration, stuck: false });
            }
        });

        handbrakeProcess.on('error', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ titleNum, duration: null, stuck: true });
            }
        });
    });
}

// Get volume name using diskutil
function getVolumeName() {
    try {
        const output = execSync(`diskutil info ${options.dvdSource}`).toString();
        const match = output.match(/Volume Name:\s*(.+)/);
        return match ? match[1].trim() : null; // Return the Volume Name if found
    } catch (error) {
        logger.error("Error fetching volume name:", error);
        return null;
    }
}

// Get number of titles with caching and duration information
async function getNumberOfTitles() {
    process.stdout.write('🔍 Scanning disc...');
    const volumeName = getVolumeName(); // Get the current volume name
    const cacheFilePath = getCacheFilePath();

    logger.debug(`Current Volume Name: ${volumeName}`);
    logger.debug(`Cache file path: ${cacheFilePath}`);

    // Check if cache exists
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));

        logger.debug(`Cached Volume Name: ${cacheData.volumeName}`);
        logger.debug(`Comparing cached volume name "${cacheData.volumeName}" with current volume name "${volumeName}"`);

        if (cacheData.volumeName === volumeName) {
            console.log(` ✓ Found ${cacheData.numTitles} title${cacheData.numTitles > 1 ? 's' : ''} (cached)`);
            console.log('');
            // Store title durations globally if available
            if (cacheData.titleDurations) {
                global.dvdTitleDurations = cacheData.titleDurations;
            }
            return cacheData.numTitles;
        } else {
            logger.debug("Volume names do not match. Cache will be ignored.");
        }
    } else {
        logger.debug("Cache does not exist. Fetching title information from the disc.");
    }

    // Fetch title information if cache is not valid
    // Use spawn with real-time output for track-by-track progress display
    console.log('');

    // Use --previews 0:0 to skip preview generation entirely - we only need title/duration info
    const args = ['-i', options.dvdSource, '--title', '0', '--scan', '--previews', '0:0'];

    logger.debug(`Running: HandBrakeCLI ${args.join(' ')}`);

    // Use Promise-wrapped spawn for real-time output
    const scanResult = await new Promise((resolve, reject) => {
        const handbrakeProcess = spawn('HandBrakeCLI', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        let totalTitles = 0;
        let lastReportedTitle = 0;
        let scannedTitlesCount = 0;
        const titleDurations = {};
        let resolved = false;
        let lastProgressTime = Date.now();
        let lastScanPercentage = null;
        let stuckTitle = null;
        const STUCK_TIMEOUT_MS = 30000; // 30 seconds without ANY progress = stuck

        // Stuck detection timer - check every 5 seconds
        const stuckCheckInterval = setInterval(() => {
            if (resolved) {
                clearInterval(stuckCheckInterval);
                return;
            }

            const timeSinceProgress = Date.now() - lastProgressTime;
            if (timeSinceProgress > STUCK_TIMEOUT_MS && scannedTitlesCount > 0) {
                clearInterval(stuckCheckInterval);
                process.stdout.write('\r' + ' '.repeat(60) + '\r');
                const stuckMsg = `Title ${stuckTitle || lastReportedTitle} appears stuck (no progress for ${STUCK_TIMEOUT_MS/1000}s, last %: ${lastScanPercentage})`;
                console.log(`   ⚠️  ${stuckMsg} - skipping remaining titles`);
                logger.debug(`STUCK DETECTION: ${stuckMsg}`);
                logger.debug(`Scanned ${scannedTitlesCount} of ${totalTitles} titles before stuck`);
                logger.debug(`Durations collected: ${JSON.stringify(titleDurations)}`);
                // Use SIGKILL for immediate termination (SIGTERM can leave zombies on stuck I/O)
                handbrakeProcess.kill('SIGKILL');
                // Reset the DVD drive to clear kernel I/O stuck state, then resolve
                setTimeout(async () => {
                    if (!resolved) {
                        resolved = true;
                        // Reset the drive to stop kernel read-retry loop
                        await resetDvdDrive(options.dvdSource);
                        resolve({ code: 0, output, titleDurations, totalTitles, stuckAtTitle: stuckTitle || lastReportedTitle });
                    }
                }, 500);
            }
        }, 5000);

        const processData = (data) => {
            if (resolved) return; // Stop processing after we resolve

            const chunk = data.toString();
            output += chunk;

            if (options.verbose) {
                process.stdout.write(chunk); // Keep raw output for verbose mode
            }

            // Check for total title count
            const totalMatch = chunk.match(/scan: DVD has (\d+) title/);
            if (totalMatch) {
                totalTitles = parseInt(totalMatch[1], 10);
                console.log(`   Found ${totalTitles} title${totalTitles > 1 ? 's' : ''} - scanning each...`);
                lastProgressTime = Date.now();
            }

            // Check for current title being scanned and show progress
            const scanningMatch = chunk.match(/scan: scanning title (\d+)/);
            if (scanningMatch) {
                const currentTitle = parseInt(scanningMatch[1], 10);
                if (currentTitle > lastReportedTitle) {
                    lastReportedTitle = currentTitle;
                    stuckTitle = currentTitle; // Track which title we're on in case it gets stuck
                    lastScanPercentage = null; // Reset percentage tracking for new title
                    lastProgressTime = Date.now(); // New title = progress
                    process.stdout.write(`\r   Scanning track ${currentTitle}${totalTitles > 0 ? ' of ' + totalTitles : ''}...`);
                }
            }

            // Track scan percentage within a title - if it changes, we're making progress
            const percentMatch = chunk.match(/Scanning title \d+ of \d+, (\d+\.\d+) %/);
            if (percentMatch) {
                const currentPercent = parseFloat(percentMatch[1]);
                if (lastScanPercentage === null || currentPercent > lastScanPercentage) {
                    lastScanPercentage = currentPercent;
                    lastProgressTime = Date.now(); // Percentage increased = progress
                }
            }

            // Parse duration for completed titles
            const durationMatch = chunk.match(/scan: duration is (\d{2}):(\d{2}):(\d{2})/);
            if (durationMatch && lastReportedTitle > 0) {
                const hours = parseInt(durationMatch[1], 10);
                const mins = parseInt(durationMatch[2], 10);
                const secs = parseInt(durationMatch[3], 10);
                const totalMinutes = hours * 60 + mins + Math.round(secs / 60);
                titleDurations[lastReportedTitle] = totalMinutes;
                scannedTitlesCount++;
                lastProgressTime = Date.now(); // Reset stuck timer on progress
                stuckTitle = null; // Clear stuck title since this one completed

                // Kill process once we have all title durations - HandBrakeCLI hangs on post-processing
                if (totalTitles > 0 && scannedTitlesCount >= totalTitles) {
                    resolved = true;
                    clearInterval(stuckCheckInterval);
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');
                    handbrakeProcess.kill('SIGKILL');
                    setTimeout(() => resolve({ code: 0, output, titleDurations, totalTitles }), 500);
                }
            }
        };

        handbrakeProcess.stdout.on('data', processData);
        handbrakeProcess.stderr.on('data', processData);

        handbrakeProcess.on('error', (error) => {
            if (!resolved) {
                clearInterval(stuckCheckInterval);
                reject(new Error(`HandBrakeCLI failed to start: ${error.message}`));
            }
        });

        handbrakeProcess.on('close', (code) => {
            if (!resolved) {
                clearInterval(stuckCheckInterval);
                // Clear the scanning line
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                resolve({ code, output, titleDurations, totalTitles });
            }
        });
    });

    const { code, output, titleDurations, totalTitles: _totalTitles, stuckAtTitle } = scanResult;

    if (code === 0 || output.includes('scan: DVD has')) {
        const match = output.match(/scan: DVD has (\d+) title/);
        if (match) {
            const numTitles = parseInt(match[1], 10);

            // Use durations collected during scanning (we kill process early before final output)
            const finalDurations = { ...titleDurations };

            // If we got stuck, skip remaining tracks (they're likely all copy-protected)
            // Trying to scan them individually causes the same kernel I/O stuck issue
            if (stuckAtTitle && stuckAtTitle < numTitles) {
                const skippedCount = numTitles - stuckAtTitle;
                console.log(`   ℹ️  Skipping ${skippedCount} remaining track(s) (likely copy-protected)`);
                logger.debug(`COPY PROTECTION: Skipping tracks ${stuckAtTitle + 1}-${numTitles} to avoid kernel I/O issues`);
            }

            console.log(`✓ Found ${numTitles} title${numTitles > 1 ? 's' : ''}`);
            console.log('');

            // Store globally for use during ripping
            global.dvdTitleDurations = finalDurations;

            // Display track duration summary
            console.log('📋 Track Summary:');
            const sortedTracks = Object.entries(finalDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
            sortedTracks.forEach(([track, duration]) => {
                let category = '';
                if (duration < 5) {
                    category = ' (menu/extra)';
                } else if (duration > 60) {
                    category = ' (full disc)';
                } else if (duration >= 20 && duration <= 35) {
                    category = ' (episode)';
                }
                console.log(`   Track ${track}: ${duration} min${category}`);
            });
            console.log('');

            // Cache the title information with volume name and durations
            fs.writeFileSync(cacheFilePath, JSON.stringify({
                volumeName,
                numTitles,
                titleDurations: finalDurations,
                scannedAt: new Date().toISOString()
            }, null, 2));

            logger.debug(`Cache created with Volume Name: ${volumeName}, Titles: ${numTitles}`);
            logger.debug(`Title durations: ${JSON.stringify(finalDurations)}`);
            return numTitles;
        } else {
            console.log(" ✗ No titles found.");
            console.log('');
            return 0;
        }
    } else {
        throw new Error(`HandBrakeCLI process exited with code ${code}`);
    }
}

// Clear cache if the volume name changes (will be checked in getNumberOfTitles)

// Helper function to get video duration in minutes
function getVideoDuration(filePath) {
    try {
        const result = spawnSync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);
        if (result.status === 0) {
            const seconds = parseFloat(result.stdout.toString().trim());
            return Math.round(seconds / 60); // Return duration in minutes
        }
    } catch (error) {
        logger.debug(`Error getting duration for ${filePath}: ${error.message}`);
    }
    return null;
}

async function renameExistingFiles() {
    try {
        const volumeName = getVolumeName();
        
        // For rename-only mode, output directory must be specified
        if (!options.outputDir) {
            logger.error('\n❌ Error: --output directory must be specified when using --rename-only\n');
            return;
        }
        
        if (!fs.existsSync(options.outputDir)) {
            logger.error(`\n❌ Error: Output directory "${options.outputDir}" does not exist\n`);
            return;
        }
        
        console.log('');
        console.log('━'.repeat(60));
        console.log('  🏷️  JuiceIt File Renamer');
        console.log('━'.repeat(60));
        console.log(`  DVD:     "${volumeName}"`);
        console.log(`  Output:  ${options.outputDir}/`);
        console.log('━'.repeat(60));
        console.log('');
        
        // Load DVD title durations from cache if available
        const cacheFilePath = getCacheFilePath();
        let dvdTitleDurations = null;
        if (fs.existsSync(cacheFilePath)) {
            try {
                const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));
                if (cacheData.volumeName === volumeName && cacheData.titleDurations) {
                    dvdTitleDurations = cacheData.titleDurations;
                    console.log(`💿 Using DVD track durations from disc scan\n`);
                    logger.debug(`DVD title durations: ${JSON.stringify(dvdTitleDurations)}`);
                }
            } catch (error) {
                logger.debug(`Could not load cache: ${error.message}`);
            }
        }
        
        // Find existing files in output directory
        const allFiles = fs.readdirSync(options.outputDir)
            .filter(f => f.endsWith('.mp4') && !f.startsWith('.'))
            .sort();
        
        if (allFiles.length === 0) {
            console.log('❌ No MP4 files found in output directory\n');
            return;
        }
        
        console.log(`📂 Analyzing ${allFiles.length} file(s)...\n`);
        
        // Get duration for each file
        const filesWithDuration = allFiles.map((f, _index) => {
            const filePath = path.join(options.outputDir, f);
            const duration = getVideoDuration(filePath);
            const stats = fs.statSync(filePath);
            
            // Try to extract track number from filename (e.g., LOOK_AROUND_YOU_3.mp4 -> track 3)
            let trackNumber = null;
            const trackMatch = f.match(/_([\d]+)\.mp4$/);
            if (trackMatch) {
                trackNumber = parseInt(trackMatch[1], 10);
            }
            
            // Get DVD duration if available
            let dvdDuration = null;
            if (dvdTitleDurations && trackNumber && dvdTitleDurations[trackNumber]) {
                dvdDuration = dvdTitleDurations[trackNumber];
            }
            
            return { 
                name: f, 
                duration, 
                dvdDuration,
                trackNumber,
                size: stats.size, 
                path: filePath 
            };
        }).filter(f => f.duration !== null);
        
        // Sort by filename to maintain track order
        filesWithDuration.sort((a, b) => {
            if (a.trackNumber && b.trackNumber) {
                return a.trackNumber - b.trackNumber;
            }
            return a.name.localeCompare(b.name);
        });
        
        // Use file count as numTitles for metadata lookup (use total count for better type detection)
        const numTitles = filesWithDuration.length;
        
        let metadata = null;
        if (!options.noLookup) {
            metadata = await lookupMetadata(volumeName, numTitles);
        } else {
            metadata = { type: 'disc', volumeName };
        }
        
        // Now filter files based on metadata
        let episodeFiles = [];
        let extraFiles = [];
        
        if (metadata.type === 'tv' && metadata.episodes) {
            // For TV shows with episode data, use expected runtime to filter
            const expectedCount = metadata.episodes.length;
            const avgRuntime = metadata.episodes.reduce((sum, ep) => sum + (ep.runtime || 25), 0) / expectedCount;
            const minRuntime = Math.max(5, avgRuntime * 0.7); // 70% of average runtime
            const maxRuntime = Math.min(60, avgRuntime * 1.5); // 150% of average runtime
            
            console.log(`📺 Expected ${expectedCount} episodes (~${Math.round(avgRuntime)} min each)\n`);
            log(`Expected runtime range: ${Math.round(minRuntime)}-${Math.round(maxRuntime)} minutes`);
            
            // Filter by runtime and take only expected count
            const candidateFiles = filesWithDuration.filter(f => f.duration >= minRuntime && f.duration <= maxRuntime);
            episodeFiles = candidateFiles.slice(0, expectedCount);
            extraFiles = filesWithDuration.filter(f => !episodeFiles.includes(f));
        } else {
            // For movies or when no episode data, use simple filtering
            episodeFiles = filesWithDuration.filter(f => f.duration >= 5 && f.duration <= 60);
            extraFiles = filesWithDuration.filter(f => f.duration < 5 || f.duration > 60);
        }
        
        if (extraFiles.length > 0) {
            console.log('📌 Skipping non-episode files:');
            extraFiles.forEach(f => {
                let reason;
                if (f.duration < 5) {
                    reason = 'too short (likely menu/extra)';
                } else if (f.duration > 60) {
                    reason = 'too long (likely full disc rip)';
                } else {
                    reason = 'does not match expected episode runtime';
                }
                console.log(`   ⏭  ${f.name} (${f.duration} min - ${reason})`);
                log(`Skipping ${f.name}: ${f.duration} min (${reason})`);
            });
            console.log('');
        }
        
        const existingFiles = episodeFiles.map(f => f.name);
        
        if (existingFiles.length === 0) {
            console.log('❌ No valid episode files found\n');
            return;
        }
        
        console.log(`✓ Found ${existingFiles.length} episode file(s) to rename\n`);
        
        const logFilePath = initializeLog(options.outputDir, volumeName);
        log(`Rename mode - Metadata: ${JSON.stringify(metadata)}`);

        // Determine base file name based on metadata (Plex-compatible format)
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            const yearStr = metadata.year ? ` (${metadata.year})` : '';
            baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);
        } else if (metadata.type === 'movie') {
            const yearStr = metadata.year ? ` (${metadata.year})` : '';
            baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);
        } else if (metadata.type === 'custom') {
            baseFileName = sanitizeForPlex(metadata.name);
        }

        let renameCount = 0;
        
        for (let i = 0; i < existingFiles.length; i++) {
            const oldFile = existingFiles[i];
            const titleNumber = i + 1;
            let newFileName;
            
            // Generate filename based on metadata type (Plex-compatible format)
            if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[i]) {
                const episode = metadata.episodes[i];
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(episode.episode_number).padStart(2, '0');
                const episodeTitle = episode.name ? ` - ${sanitizeForPlex(episode.name)}` : '';
                newFileName = `${baseFileName} - s${seasonNum}e${episodeNum}${episodeTitle}.mp4`;
            } else if (metadata.type === 'tv') {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(titleNumber).padStart(2, '0');
                newFileName = `${baseFileName} - s${seasonNum}e${episodeNum}.mp4`;
            } else if (numTitles === 1) {
                newFileName = `${baseFileName}.mp4`;
            } else {
                newFileName = `${baseFileName} - Part ${titleNumber}.mp4`;
            }
            
            const oldPath = path.join(options.outputDir, oldFile);
            const newPath = path.join(options.outputDir, newFileName);
            
            if (oldFile === newFileName) {
                console.log(`  ⏭  ${oldFile} (unchanged)`);
                log(`File unchanged: ${oldFile}`);
            } else if (fs.existsSync(newPath) && oldPath !== newPath) {
                console.log(`  ⚠️  ${oldFile}`);
                console.log(`    → ${newFileName} (target exists, skipping to prevent overwrite)`);
                log(`Skipped rename ${oldFile} -> ${newFileName}: target file already exists`);
            } else {
                try {
                    fs.renameSync(oldPath, newPath);
                    console.log(`  ✓ ${oldFile}`);
                    console.log(`    → ${newFileName}`);
                    log(`Renamed: ${oldFile} -> ${newFileName}`);
                    renameCount++;
                } catch (error) {
                    console.log(`  ❌ Failed to rename ${oldFile}: ${error.message}`);
                    log(`Error renaming ${oldFile}: ${error.message}`);
                }
            }
        }
        
        console.log('');
        console.log('━'.repeat(60));
        if (renameCount > 0) {
            console.log(`  ⚡ Renamed ${renameCount} file(s) successfully!`);
        } else {
            console.log(`  ℹ️  No files needed renaming`);
        }
        console.log('━'.repeat(60));
        
        if (logFilePath) {
            const relativeLogPath = path.relative(process.cwd(), logFilePath);
            console.log(`  📄 Log: ${relativeLogPath}`);
        }
        console.log('');
        
        closeLog();
    } catch (error) {
        logger.error(`\n❌ Error during renaming: ${error}\n`);
        closeLog();
    }
}

// Interactive review BEFORE ripping - returns mappings ready to rip
async function reviewAndMapEpisodesBeforeRip(proposedMappings, metadata, volumeName, baseFileName) {
    const hasAI = proposedMappings.some(m => m.aiReasoning);
    
    console.log('\n' + '━'.repeat(60));
    if (hasAI) {
        console.log('  📋 Review Track Mappings (AI-Enhanced)');
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
            // No AI, no hardcoded rules - just mark as pending
            statusIcon = '✓';
        }
        
        const proposedName = mapping.proposedName || 'unknown';
        console.log(`  ${trackStr}     ${durationStr}  ${statusIcon}     ${proposedName}`);
        
        // Show AI confidence and reasoning if available (always show confidence, verbose shows full reasoning)
        if (mapping.aiConfidence !== null) {
            const confidenceStr = `${(mapping.aiConfidence * 100).toFixed(0)}%`;
            if (options.verbose && mapping.aiReasoning) {
                console.log(`         AI (${confidenceStr}): ${mapping.aiReasoning}`);
            } else if (mapping.aiReasoning) {
                // Show brief reasoning in non-verbose mode
                const shortReason = mapping.aiReasoning.length > 60 
                    ? mapping.aiReasoning.substring(0, 57) + '...' 
                    : mapping.aiReasoning;
                console.log(`         AI (${confidenceStr}): ${shortReason}`);
            }
        }
    }
    
    if (hasAI) {
        console.log('');
        console.log('  ✨ AI has analyzed and mapped tracks automatically');
        if (!options.verbose) {
            console.log('  ℹ️  Use --verbose to see full AI reasoning for each track');
        }
    }
    
    console.log('');

    // Check if using sequential mapping (user selected fallback - needs manual review)
    const usingSequentialFallback = proposedMappings.some(m => m.aiReasoning && m.aiReasoning.includes('Sequential mapping'));

    // Default behavior: auto-accept AI mapping (unless --interactive flag is set)
    // Sequential fallback always requires interactive review
    if (!options.interactive && !usingSequentialFallback) {
        if (hasAI) {
            console.log('  ✓ Auto-accepting AI mapping\n');
        } else {
            console.log('  ✓ Auto-accepting mapping\n');
        }

        // Save plan if in plan-only mode
        if (options.planOnly) {
            await savePlan(proposedMappings, metadata, volumeName, baseFileName);
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
        console.log('  ⚠️  Using sequential mapping (AI not available or failed)');
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
                await editTrackMappingBeforeRip(proposedMappings, metadata, baseFileName);
            } else if (choice === 'Re-search TMDB and Re-auto-map') {
                const newMetadata = await reAutoMap(volumeName, proposedMappings.length);
                if (newMetadata) {
                    metadata = newMetadata;
                    // Re-calculate proposed names
                    for (let i = 0; i < proposedMappings.length; i++) {
                        if (proposedMappings[i].status !== 'skip') {
                            proposedMappings[i].proposedName = calculateProposedName(i, metadata, baseFileName, proposedMappings.length);
                        }
                    }
                }
            } else if (choice === 'Accept All and Start Ripping') {
                // Save plan if in plan-only mode
                if (options.planOnly) {
                    await savePlan(proposedMappings, metadata, volumeName, baseFileName);
                    console.log('\n  ✓ Plan saved!\n');
                    return null; // Don't proceed to ripping
                }
                
                // Finalize mappings - set status to the final filename
                for (const mapping of proposedMappings) {
                    if (mapping.status === 'pending') {
                        mapping.status = mapping.proposedName; // Final filename
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

// Edit track mapping before ripping
async function editTrackMappingBeforeRip(proposedMappings, metadata, baseFileName) {
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
        
        const trackSelector = new Select({
            message: 'Select track to edit:',
            choices: [...trackChoices, { name: '← Back', value: 'back' }]
        });
        
        const selectedTrack = await trackSelector.run();
        if (selectedTrack === 'back') return;
        
        const mapping = proposedMappings.find(m => m.trackNum === selectedTrack);
        
        // Build episode choices
        const episodeChoices = [];
        if (metadata.type === 'tv' && metadata.episodes) {
            metadata.episodes.forEach((ep, _idx) => {
                const seasonNum = String(metadata.season).padStart(2, '0');
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
        
        const assignment = await assignmentMenu.run();
        if (assignment === 'back') return;
        
        if (assignment === 'SKIP') {
            mapping.status = 'skip';
            mapping.proposedName = '(will skip)';
            console.log(`\n  ✓ Track ${selectedTrack} will be skipped\n`);
            log(`Track ${selectedTrack} marked to skip`);
        } else {
            mapping.status = 'pending'; // Still pending but with new name
            mapping.proposedName = assignment;
            console.log(`\n  ✓ Track ${selectedTrack} reassigned to: ${assignment}\n`);
            log(`Track ${selectedTrack} reassigned to: ${assignment}`);
        }
    } catch (err) {
        // User cancelled (Ctrl-C or ESC) - just return to main menu
        console.log('\n  ← Returning to main menu\n');
    }
}

// Re-search TMDB and re-auto-map
async function reAutoMap(volumeName, numTitles) {
    console.log('\n  🔍 Re-searching TMDB...\n');
    
    try {
        const newMetadata = await lookupMetadata(volumeName, numTitles);
        if (newMetadata && newMetadata.type !== 'disc') {
            console.log(`\n  ✓ Found: ${newMetadata.name}`);
            if (newMetadata.type === 'tv') {
                console.log(`    Season ${newMetadata.season} with ${newMetadata.episodes ? newMetadata.episodes.length : 0} episodes\n`);
            }
            log(`Re-auto-mapped to: ${JSON.stringify(newMetadata)}`);
            return newMetadata;
        } else {
            console.log('\n  ℹ️  No metadata found or search cancelled\n');
            return null;
        }
    } catch (error) {
        console.log(`\n  ❌ Error during search: ${error.message}\n`);
        return null;
    }
}

// Save rip plan to file
async function savePlan(proposedMappings, metadata, volumeName, baseFileName) {
    const planPath = path.join(options.outputDir, 'juiceit-plan.json');
    
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
    log(`Plan saved to: ${planPath}`);
    
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

// Load rip plan from file
function loadPlan() {
    const planPath = path.join(options.outputDir, 'juiceit-plan.json');
    
    if (!fs.existsSync(planPath)) {
        return null;
    }
    
    try {
        const planData = fs.readFileSync(planPath, 'utf8');
        const plan = JSON.parse(planData);
        log(`Loaded plan from: ${planPath}`);
        return plan;
    } catch (error) {
        logger.debug(`Error loading plan: ${error.message}`);
        return null;
    }
}

async function ripAllTracks() {
    let logFilePath = null;
    let successCount = 0;
    
    try {
        const volumeName = getVolumeName(); // Get the DVD volume name
        
        // Set default output directory before any operations
        setDefaultOutputDir(volumeName);

        // Initialize file logging early so scan operations are logged
        logFilePath = initializeLog(options.outputDir, volumeName);
        log(`JuiceIt session started - Volume: ${volumeName}, Source: ${options.dvdSource}`);
        log(`Options: scanOnly=${options.scanOnly}, verbose=${options.verbose}, interactive=${options.interactive}`);

        printBanner(volumeName); // Show the banner

        // Show AI/mode status after banner
        if (options.rawMode) {
            // Raw mode message will be shown later
        } else if (!config.openaiApiKey) {
            console.log('  ℹ️  AI mapping: disabled (no API key)');
            console.log('     Run "juiceit --setup" to enable automatic track mapping');
            console.log('');
        } else {
            console.log('  ✓ AI mapping: enabled');
            console.log('');
        }

        const numTitles = await getNumberOfTitles(); // Get the number of titles

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
            console.log('    2. Run with --verbose for more details: juiceit --verbose');
            console.log('');
            log('No titles found on disc');
            return;
        }
        
        // Lookup metadata unless disabled (pass track durations for AI)
        let metadata = null;
        if (options.rawMode) {
            // Raw mode: skip all metadata lookup, just use simple track names
            console.log('');
            console.log('  📀 Raw Rip Mode');
            console.log('');
            console.log('  Skipping metadata lookup and AI mapping.');
            console.log('  Tracks will be named: ' + volumeName + '_1.mp4, ' + volumeName + '_2.mp4, etc.');
            console.log('');
            logger.debug('Raw mode enabled - skipping metadata lookup');
            metadata = { type: 'raw', volumeName };
        } else if (!options.noLookup) {
            metadata = await lookupMetadata(volumeName, numTitles, global.dvdTitleDurations, {
                searchTitle: options.searchTitle
            });
        } else {
            metadata = { type: 'disc', volumeName };
        }
        
        // If scan-only mode, display metadata and exit
        if (options.scanOnly) {
            console.log('\n' + '━'.repeat(60));
            console.log('  📋 Metadata Summary');
            console.log('━'.repeat(60));
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
            console.log('━'.repeat(60));
            console.log('');
            console.log('✅ Scan complete. Run without --scan-only to start ripping.');
            console.log('');
            return;
        }
        
        logFilePath = initializeLog(options.outputDir, volumeName); // Initialize the log
        
        // Log DVD track durations if available
        if (global.dvdTitleDurations) {
            log('DVD Track Durations:');
            Object.entries(global.dvdTitleDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([track, duration]) => {
                log(`  Track ${track}: ${duration} minutes`);
            });
        }
        
        log(`Metadata: ${JSON.stringify(metadata)}`);

        // Determine base file name based on metadata (Plex-compatible format)
        // Movies: "Movie Name (Year)"
        // TV Shows: "Show Name (Year)"
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            const yearStr = metadata.year ? ` (${metadata.year})` : '';
            baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);
        } else if (metadata.type === 'movie') {
            const yearStr = metadata.year ? ` (${metadata.year})` : '';
            baseFileName = sanitizeForPlex(`${metadata.name}${yearStr}`);
        } else if (metadata.type === 'custom') {
            baseFileName = sanitizeForPlex(metadata.name);
        }

        // Check for existing plan
        const existingPlan = loadPlan();
        let proposedMappings = [];
        
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
                    // Reconstruct proposedMappings from plan and skip review
                    proposedMappings = existingPlan.mappings.map(m => ({
                        trackNum: m.trackNum,
                        filename: null,
                        proposedName: m.proposedName,
                        fileSize: 0,
                        duration: m.duration,
                        status: m.status === 'pending' ? m.proposedName : m.status, // Finalize status
                        aiReasoning: m.aiReasoning,
                        aiConfidence: m.aiConfidence
                    }));
                    
                    metadata = existingPlan.metadata;
                    baseFileName = existingPlan.baseFileName;
                    
                    console.log('');
                    console.log('✓ Using existing plan, starting rip...\n');
                    log('Using existing rip plan, skipping review');
                } else if (choice === 'Review/edit existing plan') {
                    // Load plan for review
                    proposedMappings = existingPlan.mappings.map(m => ({
                        trackNum: m.trackNum,
                        filename: null,
                        proposedName: m.proposedName,
                        fileSize: 0,
                        duration: m.duration,
                        status: m.status,
                        aiReasoning: m.aiReasoning,
                        aiConfidence: m.aiConfidence
                    }));
                    
                    metadata = existingPlan.metadata;
                    baseFileName = existingPlan.baseFileName;
                    
                    console.log('');
                    console.log('✓ Loading plan for review...\n');
                    log('Loading existing plan for review');
                } else {
                    // Delete existing plan and create new
                    const planPath = path.join(options.outputDir, 'juiceit-plan.json');
                    fs.unlinkSync(planPath);
                    console.log('');
                    console.log('✓ Deleted existing plan, creating new...\n');
                    log('User chose to delete plan and create new');
                }
            } catch (error) {
                console.log('\nCancelled.\n');
                return;
            }
        }
        
        // If no plan loaded, create new mappings
        if (proposedMappings.length === 0) {
            // Try AI-powered track mapping if available
            const config = loadConfig();
            let aiMappingResult = null;
            let useSequentialMapping = false;

            if (config.openaiApiKey && global.dvdTitleDurations && metadata.type === 'tv') {
                // Collect lsdvd metadata for additional context (Option C)
                const lsdvdMetadata = getLsdvdMetadata(options.dvdSource);
                if (options.verbose && lsdvdMetadata) {
                    console.log('[lsdvd] Extended metadata collected');
                }

                // Attempt AI mapping with retry loop on failure
                let retryAttempt = 0;
                const maxAutoRetries = 2; // Auto-retry up to 2 times in automatic mode

                while (!aiMappingResult && !useSequentialMapping) {
                    aiMappingResult = await aiMapTracks(global.dvdTitleDurations, metadata, lsdvdMetadata);

                    if (!aiMappingResult) {
                        log('ERROR: AI mapping failed');

                        if (options.interactive) {
                            // Interactive mode: ask user what to do
                            console.log('');
                            console.log('  ❌ AI mapping failed!');
                            console.log('');

                            const failureMenu = new Select({
                                message: 'How would you like to proceed?',
                                choices: [
                                    { name: 'Retry AI mapping', value: 'retry' },
                                    { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - NOT RECOMMENDED', value: 'sequential' },
                                    { name: 'Cancel and exit', value: 'cancel' }
                                ]
                            });

                            try {
                                const choice = await failureMenu.run();
                                if (choice === 'retry') {
                                    retryAttempt++;
                                    console.log(`\n  🔄 Retrying AI mapping (attempt ${retryAttempt + 1})...\n`);
                                    log(`Retrying AI mapping, attempt ${retryAttempt + 1}`);
                                    continue;
                                } else if (choice === 'sequential') {
                                    console.log('\n  ⚠️  Using sequential mapping - this may produce incorrect results!\n');
                                    log('User chose sequential mapping after AI failure');
                                    useSequentialMapping = true;
                                } else {
                                    console.log('\n  ✓ Cancelled.\n');
                                    return;
                                }
                            } catch (err) {
                                console.log('\n  ✓ Cancelled.\n');
                                return;
                            }
                        } else {
                            // Automatic mode: auto-retry a few times, then fallback
                            retryAttempt++;
                            if (retryAttempt <= maxAutoRetries) {
                                console.log(`  ⚠️  AI mapping failed, retrying (${retryAttempt}/${maxAutoRetries})...`);
                                log(`Auto-retrying AI mapping, attempt ${retryAttempt}`);
                                continue;
                            }

                            // All retries exhausted - fallback to sequential
                            console.log('');
                            console.log('  ⚠️  AI Mapping Failed');
                            console.log('');
                            console.log('  The AI could not map DVD tracks to episodes.');
                            console.log('  This can happen due to network issues or API problems.');
                            console.log('');
                            console.log('  Falling back to sequential mapping (Track 1→Episode 1, etc.)');
                            console.log('');
                            console.log('  ⚠️  WARNING: Episode assignments may be incorrect!');
                            console.log('');
                            console.log('  For better results, try:');
                            console.log('    • Run again later (if this was a temporary issue)');
                            console.log('    • Run: juiceit --interactive  (to manually verify assignments)');
                            console.log('');
                            log('Auto mode: AI mapping failed, using sequential fallback');
                            useSequentialMapping = true;
                            global.autoModeWarnings = global.autoModeWarnings || [];
                            global.autoModeWarnings.push('AI mapping failed - used sequential mapping (episodes may be mislabeled)');
                        }
                    }
                }
            } else if (metadata.type === 'tv' && !config.openaiApiKey) {
                // No AI key configured
                if (options.interactive) {
                    // Interactive mode: ask user what to do
                    console.log('');
                    console.log('  ⚠️  AI mapping not available (no OpenAI API key configured)');
                    console.log('  ⚠️  Without AI, track-to-episode mapping may be incorrect.');
                    console.log('');

                    const noAiMenu = new Select({
                        message: 'How would you like to proceed?',
                        choices: [
                            { name: 'Use sequential mapping (Track 1→Ep1, Track 2→Ep2, etc.) - may be incorrect', value: 'sequential' },
                            { name: 'Cancel and configure AI (run: juiceit --setup)', value: 'cancel' }
                        ]
                    });

                    try {
                        const choice = await noAiMenu.run();
                        if (choice === 'sequential') {
                            console.log('\n  ⚠️  Using sequential mapping...\n');
                            log('User chose sequential mapping (no AI key)');
                            useSequentialMapping = true;
                        } else {
                            console.log('\n  ℹ️  Run `juiceit --setup` to configure your OpenAI API key.\n');
                            return;
                        }
                    } catch (err) {
                        console.log('\n  ✓ Cancelled.\n');
                        return;
                    }
                } else {
                    // Automatic mode: continue with sequential mapping, but warn clearly
                    console.log('');
                    console.log('  ⚠️  No AI Configured');
                    console.log('');
                    console.log('  AI-powered episode mapping is not available.');
                    console.log('  Using sequential mapping (Track 1→Episode 1, Track 2→Episode 2, etc.)');
                    console.log('');
                    console.log('  ⚠️  WARNING: This may result in incorrect episode assignments!');
                    console.log('     DVDs often have menus, extras, or out-of-order episodes.');
                    console.log('');
                    console.log('  For better results:');
                    console.log('    • Run: juiceit --setup  (to add OpenAI API key)');
                    console.log('    • Or run: juiceit --interactive  (to manually review assignments)');
                    console.log('');
                    log('Auto mode: Using sequential mapping (no AI key configured)');
                    useSequentialMapping = true;
                    global.autoModeWarnings = global.autoModeWarnings || [];
                    global.autoModeWarnings.push('No AI configured - used sequential mapping (episodes may be mislabeled)');
                }
            } else {
                // Movie or no track durations - sequential is fine
                useSequentialMapping = true;
            }

            // For movies: determine the main feature track (longest track)
            let mainFeatureTrack = null;
            if (metadata.type === 'movie' && global.dvdTitleDurations) {
                // Find the longest track (main feature)
                let maxDuration = 0;
                for (const [trackNum, duration] of Object.entries(global.dvdTitleDurations)) {
                    if (duration > maxDuration) {
                        maxDuration = duration;
                        mainFeatureTrack = parseInt(trackNum, 10);
                    }
                }
                logger.debug(`[Movie] Main feature track: ${mainFeatureTrack} (${maxDuration} min)`);
                log(`Movie mode: Main feature is Track ${mainFeatureTrack} (${maxDuration} min)`);
            }

            // Build proposed mappings with track info before ripping
        for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
            const trackDuration = global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : null;
            let proposedName;
            let status = 'pending';
            let aiReasoning = null;
            let aiConfidence = null;

            // Skip tracks with 0-duration (copy-protected/invalid tracks)
            if (trackDuration === 0) {
                status = 'skip';
                proposedName = '(will skip - 0 duration)';
                aiReasoning = 'Track has 0 duration (likely copy-protected or invalid)';
                aiConfidence = null;
                logger.debug(`Track ${titleNumber}: Skipping (0 duration)`);
            }
            // Use AI mapping if available
            else if (aiMappingResult && aiMappingResult.mappings) {
                const aiMapping = aiMappingResult.mappings.find(m => m.trackNum === titleNumber);
                if (aiMapping) {
                    if (aiMapping.shouldSkip) {
                        status = 'skip';
                        proposedName = '(will skip)';
                    } else if (aiMapping.episodeIndex !== null && metadata.episodes && metadata.episodes[aiMapping.episodeIndex]) {
                        proposedName = calculateProposedName(aiMapping.episodeIndex, metadata, baseFileName, numTitles);
                    } else {
                        proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
                    }
                    aiReasoning = aiMapping.reasoning;
                    aiConfidence = aiMapping.confidence;
                } else {
                    // AI didn't provide a mapping for this track - skip it
                    status = 'skip';
                    proposedName = '(will skip)';
                    aiReasoning = 'AI did not analyze this track';
                    aiConfidence = null;
                    logger.debug(`[AI] Track ${titleNumber}: Not analyzed by AI, marking as skip`);
                }
            } else if (useSequentialMapping) {
                // Movies: only rip the main feature (longest track), skip everything else as extras
                if (metadata.type === 'movie' && mainFeatureTrack !== null) {
                    if (titleNumber === mainFeatureTrack) {
                        // Main feature - use clean movie filename without "Part N"
                        proposedName = `${baseFileName}.mp4`;
                        aiReasoning = 'Main feature (longest track)';
                        aiConfidence = 1.0;
                    } else {
                        // Extras - skip by default (can be ripped with --include-extras)
                        status = 'skip';
                        proposedName = '(will skip - extra)';
                        aiReasoning = `Extra/bonus content (use --include-extras to rip)`;
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
            } else {
                // Shouldn't reach here for TV shows, but fallback just in case
                proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
            }
            
            proposedMappings.push({
                trackNum: titleNumber,
                filename: null, // Will be set during ripping
                proposedName: proposedName,
                fileSize: 0, // Unknown until ripped
                duration: trackDuration || 0,
                status: status,
                aiReasoning: aiReasoning,
                aiConfidence: aiConfidence
            });
        }

            // Check for episode mapping mismatches (TV shows only)
            if (metadata.type === 'tv' && metadata.episodes && aiMappingResult && aiMappingResult.mappings) {
                const expectedEpisodes = metadata.episodes.length;
                const mappedEpisodes = aiMappingResult.mappings.filter(m => !m.shouldSkip && m.episodeIndex !== null);
                const uniqueMappedEpisodes = new Set(mappedEpisodes.map(m => m.episodeIndex)).size;

                if (uniqueMappedEpisodes < expectedEpisodes) {
                    logger.warn(`Episode mismatch: ${uniqueMappedEpisodes}/${expectedEpisodes} episodes mapped`);

                    if (!options.interactive) {
                        // Auto mode: warn but continue
                        console.log('');
                        console.log('  ⚠️  Episode Mapping Mismatch');
                        console.log('');
                        console.log(`  TMDB shows ${expectedEpisodes} episodes for this season,`);
                        console.log(`  but only ${uniqueMappedEpisodes} episodes were found on the disc.`);
                        console.log('');
                        console.log('  Possible causes:');
                        console.log('    • This disc may only contain part of the season');
                        console.log('    • AI may have selected the wrong TV show/season');
                        console.log('    • TMDB may have incomplete data for this disc');
                        console.log('');
                        console.log('  Continuing with available mappings...');
                        console.log('');
                        global.autoModeWarnings = global.autoModeWarnings || [];
                        global.autoModeWarnings.push(`Episode mismatch: only ${uniqueMappedEpisodes} of ${expectedEpisodes} episodes found`);
                    }
                } else if (uniqueMappedEpisodes > expectedEpisodes) {
                    logger.warn(`More episodes mapped (${uniqueMappedEpisodes}) than expected (${expectedEpisodes})`);
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
                for (const mapping of mappingsToRip) {
                    if (mapping.status === 'pending') {
                        mapping.status = mapping.proposedName;
                    }
                }
                logger.debug('Raw mode: auto-finalized all track mappings');
            } else {
                log('Skipping review - using finalized plan');
            }
        } else {
            console.log('');
            mappingsToRip = await reviewAndMapEpisodesBeforeRip(proposedMappings, metadata, volumeName, baseFileName);
            
            if (!mappingsToRip || mappingsToRip.length === 0) {
                console.log('');
                console.log('  ℹ️  Ripping cancelled.');
                console.log('');
                return;
            }
        }
        
        console.log('');
        console.log('━'.repeat(60));
        if (options.dryRun) {
            console.log('  🧪 DRY-RUN MODE - Creating stub files (no actual ripping)');
        } else {
            console.log('  🎬 Starting rip...');
        }
        console.log('━'.repeat(60));
        console.log('');

        // Show movie-specific info
        if (metadata.type === 'movie') {
            const mainTrack = mappingsToRip.find(m => m.status !== 'skip' && m.aiReasoning === 'Main feature (longest track)');
            const extrasCount = mappingsToRip.filter(m => m.status === 'skip' && m.aiReasoning && m.aiReasoning.includes('Extra')).length;
            const zeroCount = mappingsToRip.filter(m => m.status === 'skip' && m.aiReasoning && m.aiReasoning.includes('0 duration')).length;

            if (mainTrack) {
                console.log(`  🎬 Movie: Ripping main feature (Track ${mainTrack.trackNum}, ${mainTrack.duration} min)`);
                if (extrasCount > 0) {
                    console.log(`     ${extrasCount} extra track(s) will be skipped`);
                    console.log(`     Use --include-extras to also rip bonus content`);
                }
                if (zeroCount > 0) {
                    console.log(`     ${zeroCount} invalid track(s) skipped (0 duration)`);
                }
                console.log('');
            }
        }

        // Log final mapping table before ripping
        log('=== FINAL TRACK TO FILENAME MAPPINGS ===');
        for (const mapping of mappingsToRip) {
            const status = mapping.status === 'skip' ? 'SKIP' : mapping.status;
            log(`Track ${mapping.trackNum} (${mapping.duration} min) → ${status}`);
        }
        log('=== END FINAL MAPPINGS ===');

        // Handle --include-extras: override skip status for extras
        if (options.includeExtras) {
            console.log('  ℹ️  --include-extras: Will also rip skipped tracks (menus, extras, etc.)');
            console.log('');
            for (const mapping of mappingsToRip) {
                if (mapping.status === 'skip') {
                    // Generate an extras filename for this track (Plex-compatible)
                    // Format: MovieName (Year)-featurette-Bonus N.mp4
                    const extraName = `${baseFileName}-featurette-Bonus ${mapping.trackNum}.mp4`;
                    mapping.status = extraName;
                    mapping.wasSkipped = true; // Track that this was originally skipped
                    log(`--include-extras: Track ${mapping.trackNum} (was skip) → ${extraName}`);
                }
            }
        }

        // Rip tracks (skip those marked as skip unless --include-extras is used)
        for (const mapping of mappingsToRip) {
            if (mapping.status === 'skip') {
                // Track this as a mapping-skipped track
                mappingSkippedTracks.push({
                    track: mapping.trackNum,
                    duration: mapping.duration,
                    reason: mapping.aiReasoning || 'AI marked as menu/extra'
                });
                continue;
            }

            const titleNumber = mapping.trackNum;
            const finalFileName = mapping.status; // status contains the final filename
            
            console.log(`  ⚙️  Track ${titleNumber} of ${numTitles}: ${finalFileName}`);

            try {
                await ripDvd(titleNumber, finalFileName.replace('.mp4', ''), titleNumber, numTitles, (progress, elapsed, remaining, _trackNum, _totalTracks) => {
                    // Overwrite the same line for progress updates
                    const progressBar = createProgressBar(progress);
                    const elapsedStr = formatTime(elapsed);
                    const remainingStr = remaining > 0 ? formatTime(remaining) : 'calculating...';
                    process.stdout.write(`\r      ${progressBar} | ${elapsedStr} elapsed | ~${remainingStr} remaining`);
                });

                // Clear the progress line and show completion
                process.stdout.write('\r' + ' '.repeat(100) + '\r');
                console.log(`      ${createProgressBar(100)} | Complete!`);
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
                log(`Skipped track ${titleNumber}: ${skipReason}`);
            }
        }

        console.log('━'.repeat(60));
        const totalToRip = mappingsToRip.filter(m => m.status !== 'skip').length;
        if (successCount === totalToRip) {
            console.log('  ⚡ All tracks ripped successfully!');
        } else if (successCount > 0) {
            console.log(`  ⚡ Ripping complete: ${successCount} of ${totalToRip} tracks successful`);
            if (skippedTracks.length > 0) {
                console.log('');
                console.log(`  ❌ ${skippedTracks.length} track(s) failed during ripping:`);
                skippedTracks.forEach(({ track, reason }) => {
                    console.log(`     • Track ${track}: ${reason}`);
                });
            }
        } else {
            console.log('  ✗ No tracks were successfully ripped');
        }
        console.log('━'.repeat(60));
        console.log('');

        log('Ripping completed');
        log(`Successfully ripped: ${successCount}/${totalToRip} tracks`);
        if (skippedTracks.length > 0) {
            log(`Failed tracks: ${JSON.stringify(skippedTracks)}`);
        }
        if (mappingSkippedTracks.length > 0) {
            log(`Mapping-skipped tracks: ${JSON.stringify(mappingSkippedTracks)}`);
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

        // Show summary of tracks skipped due to mapping (menus, extras, etc.)
        if (mappingSkippedTracks.length > 0 && !options.includeExtras) {
            console.log('━'.repeat(60));
            console.log('  📋 Tracks Not Ripped (Extras/Menus)');
            console.log('━'.repeat(60));
            console.log('');
            console.log(`  ${mappingSkippedTracks.length} track(s) were skipped based on AI analysis:`);
            console.log('');
            mappingSkippedTracks.forEach(({ track, duration, reason }) => {
                const shortReason = reason && reason.length > 50 ? reason.substring(0, 47) + '...' : reason;
                console.log(`    • Track ${track} (${duration} min): ${shortReason || 'menu/extra'}`);
            });
            console.log('');
            console.log('  💡 To also rip these tracks (extras, menus, bonus content):');
            console.log('');
            console.log('     juiceit --include-extras');
            console.log('');
            console.log('     Or for a raw rip of everything:');
            console.log('     juiceit --raw');
            console.log('');
        }

        // Show summary of any automatic mode warnings
        if (global.autoModeWarnings && global.autoModeWarnings.length > 0) {
            console.log('━'.repeat(60));
            console.log('  ⚠️  IMPORTANT - Review Needed');
            console.log('━'.repeat(60));
            console.log('');
            console.log('  The following issues occurred during automatic processing:');
            console.log('');
            global.autoModeWarnings.forEach(warning => {
                console.log(`    • ${warning}`);
            });
            console.log('');
            console.log('  Recommendations:');
            console.log('    1. Review the ripped files to verify they are correct');
            console.log('    2. For more control, use: juiceit --interactive');
            console.log('    3. For AI-powered mapping, run: juiceit --setup');
            console.log('');
        }
    } catch (error) {
        logger.error(`\n❌ Error during ripping: ${error}\n`);
        log(`Fatal error: ${error}`);
    } finally {
        closeLog();
    }
}

// Diagnostic mode - detailed mapping analysis for debugging
// Uses shared functions: getVolumeName(), getNumberOfTitles(), lookupMetadata(), aiMapTracks()
async function runDiagnosticMode() {
    const config = loadConfig();

    console.log('');
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + '  🔬 JuiceIt Diagnostic Mode - Mapping Analysis'.padEnd(78) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: DVD SOURCE INFO
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📀 SECTION 1: DVD SOURCE INFORMATION');

    if (!options.dvdSource) {
        options.dvdSource = '/dev/disk4'; // Default
    }
    console.log(`  DVD Source: ${options.dvdSource}`);

    // Use shared getVolumeName() function
    const volumeName = getVolumeName();
    console.log(`  Volume Name: ${volumeName}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: DISC SCAN - TRACK INFORMATION
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🔍 SECTION 2: DISC SCAN - TRACK INFORMATION');

    // Use shared getNumberOfTitles() - this sets global.dvdTitleDurations
    const numTitles = await getNumberOfTitles();
    const trackDurations = global.dvdTitleDurations || {};

    console.log('');
    printTrackAnalysisTable(numTitles, trackDurations);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: ONLINE METADATA (TMDB)
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🌐 SECTION 3: ONLINE METADATA (TMDB)');

    if (!config.tmdbApiKey) {
        console.log('  ❌ No TMDB API key configured. Run: juiceit --setup');
        console.log('');
        return;
    }

    // Clean volume name for search
    const cleanName = volumeName.replace(/_/g, ' ').replace(/D1|D2|DISC|DVD/gi, '').trim();
    console.log(`  Search Query: "${cleanName}"`);
    console.log('');

    // Fetch movie and TV results using shared searchTMDB function
    const movieResults = await searchTMDB(cleanName, false);
    const tvResults = await searchTMDB(cleanName, true);

    console.log(`  TMDB Results: ${movieResults.length} movies, ${tvResults.length} TV shows`);
    console.log('');

    if (tvResults.length > 0) {
        console.log('  TV Shows Found:');
        tvResults.slice(0, 5).forEach((show, i) => {
            console.log(`    ${i + 1}. ${show.name} (${show.first_air_date?.substring(0, 4) || '?'}) - ID: ${show.id}`);
        });
        console.log('');
    }

    if (movieResults.length > 0) {
        console.log('  Movies Found:');
        movieResults.slice(0, 5).forEach((movie, i) => {
            console.log(`    ${i + 1}. ${movie.title} (${movie.release_date?.substring(0, 4) || '?'}) - ID: ${movie.id}`);
        });
        console.log('');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: AI TMDB SELECTION
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('🤖 SECTION 4: AI TMDB SELECTION');

    if (!config.openaiApiKey) {
        console.log('  ❌ No OpenAI API key configured. Run: juiceit --setup');
        console.log('');
        return;
    }

    // Show AI configuration
    console.log('  ⚙️  AI Configuration:');
    console.log(`    Model: ${aiConfig.model}`);
    console.log(`    Temperature: ${aiConfig.temperature}`);
    console.log(`    Structured Output: ${aiConfig.useStructuredOutput ? 'Yes' : 'No'}`);
    console.log('');

    // Build and show full prompts
    const tmdbPrompts = buildTmdbMatchPrompts({
        volumeName,
        numTitles,
        trackDurations,
        movieResults,
        tvResults
    });

    if (aiConfig.diagnosticShowFullPrompts) {
        console.log('  📤 SYSTEM PROMPT:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(tmdbPrompts.system, '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log('');
        console.log('  📤 USER PROMPT:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(tmdbPrompts.user, '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log('');
    }

    // Use shared aiSelectTmdbMatch() function
    const aiSelection = await aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults);

    if (!aiSelection) {
        console.log('  ❌ AI selection failed');
        console.log('');
        return;
    }

    console.log('');
    if (aiConfig.diagnosticShowFullResponses) {
        console.log('  📥 FULL AI RESPONSE:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(JSON.stringify(aiSelection, null, 2), '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    } else {
        console.log('  📥 AI RESPONSE SUMMARY:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log(`  Selected: ${aiSelection.selectedType.toUpperCase()} - ID ${aiSelection.selectedId}`);
        console.log(`  Confidence: ${(aiSelection.confidence * 100).toFixed(0)}%`);
        console.log(`  Reasoning: ${aiSelection.reasoning}`);
        if (aiSelection.season) {
            console.log(`  Season: ${aiSelection.season}`);
        }
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    }
    console.log('');

    // Get full metadata from search results + season details
    let metadata;
    if (aiSelection.selectedType === 'tv') {
        const selectedShow = tvResults.find(s => s.id === aiSelection.selectedId);
        const seasonDetails = await getTVSeasonDetails(aiSelection.selectedId, aiSelection.season || 1);
        metadata = {
            type: 'tv',
            name: selectedShow?.name || 'Unknown',
            season: aiSelection.season || 1,
            episodes: seasonDetails?.episodes || []
        };
    } else {
        const selectedMovie = movieResults.find(m => m.id === aiSelection.selectedId);
        metadata = {
            type: 'movie',
            name: selectedMovie?.title || 'Unknown',
            runtime: selectedMovie?.runtime || null
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: EPISODE/CONTENT DETAILS
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📋 SECTION 5: CONTENT DETAILS FROM TMDB');

    console.log(`  Title: ${metadata.name}`);
    console.log(`  Type: ${metadata.type}`);

    if (metadata.type === 'tv') {
        console.log(`  Season: ${metadata.season}`);
        console.log(`  Episodes: ${metadata.episodes.length}`);
        console.log('');

        // Use shared analyzeEpisodeRuntimes() function
        const runtimeAnalysis = analyzeEpisodeRuntimes(metadata.episodes);

        if (runtimeAnalysis) {
            console.log('  Runtime Analysis (derived from TMDB data):');
            console.log(`    Range: ${runtimeAnalysis.min}-${runtimeAnalysis.max} min`);
            console.log(`    Average: ${runtimeAnalysis.avg} min`);
            console.log(`    Variance: ${runtimeAnalysis.variance} min`);
            console.log(`    Derived Tolerance: ±${runtimeAnalysis.tolerance} min`);
            console.log(`    Valid Track Range: ${runtimeAnalysis.min - runtimeAnalysis.tolerance}-${runtimeAnalysis.max + runtimeAnalysis.tolerance} min`);
            console.log(`    Format: ${runtimeAnalysis.format}`);
            console.log('');
        }

        printEpisodeTable(metadata.episodes);
    } else {
        console.log(`  Runtime: ${metadata.runtime || '?'} min`);
        console.log('');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: AI TRACK MAPPING
    // ═══════════════════════════════════════════════════════════════════════════
    if (metadata.type !== 'tv') {
        console.log('  ℹ️  AI track mapping only applies to TV shows');
        console.log('');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5.5: EXTENDED DISC METADATA (lsdvd)
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('💿 SECTION 5.5: EXTENDED DISC METADATA (lsdvd)');

    const lsdvdMetadata = getLsdvdMetadata(options.dvdSource);

    if (lsdvdMetadata) {
        console.log(`  Disc Title: ${lsdvdMetadata.discTitle}`);
        console.log(`  Disc ID: ${lsdvdMetadata.discId || 'unknown'}`);
        console.log(`  Longest Track: ${lsdvdMetadata.longestTrack || '?'}`);
        console.log('');
        console.log('  Track Details (from lsdvd):');
        console.log('  ┌───────┬──────────┬──────────┬───────┬──────┐');
        console.log('  │ Track │ Duration │ Chapters │ Audio │ Subs │');
        console.log('  ├───────┼──────────┼──────────┼───────┼──────┤');

        const sortedTracks = Object.entries(lsdvdMetadata.tracks)
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

        for (const [trackNum, track] of sortedTracks) {
            const tNum = String(trackNum).padStart(4);
            const dur = `${track.durationMinutes} min`.padStart(6);
            const chap = String(track.chapters).padStart(5);
            const audio = String(track.audioStreams).padStart(3);
            const subs = String(track.subpictures).padStart(2);
            console.log(`  │ ${tNum}  │ ${dur}  │   ${chap}  │  ${audio}  │  ${subs}  │`);
        }
        console.log('  └───────┴──────────┴──────────┴───────┴──────┘');
    } else {
        console.log('  ⚠️  lsdvd not available or failed to read disc');
        console.log('  ℹ️  Install lsdvd (brew install lsdvd) for extended metadata');
    }
    console.log('');

    printDiagnosticSection('🎯 SECTION 6: AI TRACK MAPPING (Option C)');

    console.log('  ℹ️  Using Option C: Raw data + soft guidance (no pre-labeling)');
    console.log('');

    // Get runtime analysis for soft guidance
    const runtimeAnalysis = analyzeEpisodeRuntimes(metadata.episodes);

    // Build full prompts from templates (Option C - no CANDIDATE/SKIP pre-labeling)
    // buildTrackMappingPrompts now handles all formatting internally
    const mappingPrompts = buildTrackMappingPrompts({
        metadata,
        trackDurations,
        runtimeAnalysis,
        lsdvdMetadata
    });

    if (aiConfig.diagnosticShowFullPrompts) {
        console.log('  📤 SYSTEM PROMPT:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(mappingPrompts.system, '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log('');
        console.log('  📤 USER PROMPT:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(mappingPrompts.user, '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log('');
    }

    // Use shared aiMapTracks() function with lsdvd metadata
    const aiMappingResult = await aiMapTracks(trackDurations, metadata, lsdvdMetadata);

    if (!aiMappingResult) {
        console.log('  ❌ AI mapping failed');
        console.log('');
        return;
    }

    console.log('');
    if (aiConfig.diagnosticShowFullResponses) {
        console.log('  📥 FULL AI RESPONSE:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        printIndentedText(JSON.stringify(aiMappingResult, null, 2), '  ');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    } else {
        console.log('  📥 AI RESPONSE SUMMARY:');
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
        console.log(`  Tracks Matched: ${aiMappingResult.summary?.tracksMatched || 0}`);
        console.log(`  Tracks Skipped: ${aiMappingResult.summary?.tracksSkipped || 0}`);
        console.log(`  Overall Confidence: ${((aiMappingResult.overallConfidence || 0) * 100).toFixed(0)}%`);
        console.log('  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: MAPPING RESULTS TABLE
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('📊 SECTION 7: FINAL MAPPING RESULTS');

    console.log('  Runtime Analysis Used:');
    console.log(`    Episode Range: ${aiMappingResult.runtimeAnalysis?.episodeRuntimeRange || '?'}`);
    console.log(`    Tolerance: ±${aiMappingResult.runtimeAnalysis?.toleranceUsed || '?'} min`);
    console.log(`    Valid Track Range: ${aiMappingResult.runtimeAnalysis?.validTrackRange || '?'}`);
    console.log('');

    console.log('  Summary:');
    console.log(`    Tracks Matched: ${aiMappingResult.summary?.tracksMatched || 0}`);
    console.log(`    Tracks Skipped: ${aiMappingResult.summary?.tracksSkipped || 0}`);
    console.log(`    Episodes Expected: ${aiMappingResult.summary?.episodesExpected || 0}`);
    console.log(`    Overall Confidence: ${((aiMappingResult.overallConfidence || 0) * 100).toFixed(0)}%`);
    console.log('');

    printMappingResultsTable(aiMappingResult.mappings, metadata.episodes);

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: POTENTIAL ISSUES
    // ═══════════════════════════════════════════════════════════════════════════
    printDiagnosticSection('⚠️  SECTION 8: POTENTIAL ISSUES');

    const issues = analyzeMappingIssues(aiMappingResult, metadata);

    if (issues.length === 0) {
        console.log('  ✅ No issues detected - mapping looks good!');
    } else {
        issues.forEach(issue => console.log(`  ${issue}`));
    }
    console.log('');

    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + '  Diagnostic Complete'.padEnd(78) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');
    console.log('');
}

// Helper: Print diagnostic section header
function printDiagnosticSection(title) {
    console.log('┌' + '─'.repeat(78) + '┐');
    console.log('│' + `  ${title}`.padEnd(78) + '│');
    console.log('└' + '─'.repeat(78) + '┘');
    console.log('');
}

// Helper: Print text with indentation (for multi-line prompts/responses)
function printIndentedText(text, indent = '  ') {
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach(line => {
        console.log(indent + line);
    });
}

// Helper: Print track table (just facts - no analysis until we have TMDB data)
function printTrackAnalysisTable(numTitles, trackDurations) {
    console.log('  ┌─────────┬──────────┐');
    console.log('  │  Track  │ Duration │');
    console.log('  ├─────────┼──────────┤');

    for (let i = 1; i <= numTitles; i++) {
        const duration = trackDurations[i] || 0;
        const trackStr = String(i).padStart(4);
        const durationStr = duration > 0 ? `${duration} min`.padStart(6) : '  —   ';
        console.log(`  │  ${trackStr}   │ ${durationStr}  │`);
    }
    console.log('  └─────────┴──────────┘');
    console.log('');
}

// Helper: Print episode table
function printEpisodeTable(episodes) {
    console.log('  Episode List:');
    console.log('  ┌─────┬─────────┬─────────────────────────────────────────────────┐');
    console.log('  │ Ep# │ Runtime │ Title                                           │');
    console.log('  ├─────┼─────────┼─────────────────────────────────────────────────┤');
    episodes.forEach(ep => {
        const epNum = String(ep.episode_number).padStart(2);
        const runtime = ep.runtime ? `${ep.runtime} min`.padStart(6) : '  ? min';
        const title = (ep.name || 'Unknown').substring(0, 47).padEnd(47);
        console.log(`  │  ${epNum} │ ${runtime} │ ${title} │`);
    });
    console.log('  └─────┴─────────┴─────────────────────────────────────────────────┘');
    console.log('');
}

// Helper: Print mapping results table
function printMappingResultsTable(mappings, episodes) {
    console.log('  Detailed Mapping Table:');
    console.log('  ┌───────┬──────────┬────────┬─────────────────┬──────┬────────────────────────────────┐');
    console.log('  │ Track │ Duration │ Action │ Episode         │ Conf │ Reasoning                      │');
    console.log('  ├───────┼──────────┼────────┼─────────────────┼──────┼────────────────────────────────┤');

    for (const m of mappings) {
        const trackStr = String(m.trackNum).padStart(4);
        const durationStr = `${m.trackDuration} min`.padStart(6);

        let action, episode;
        if (m.shouldSkip) {
            action = '⏭ SKIP';
            episode = '—'.padEnd(15);
        } else {
            action = '✓ MAP ';
            const epIndex = m.episodeIndex;
            const epName = episodes[epIndex]?.name || 'Unknown';
            episode = `E${epIndex + 1}: ${epName}`.substring(0, 15).padEnd(15);
        }

        const conf = `${(m.confidence * 100).toFixed(0)}%`.padStart(4);
        const reason = (m.reasoning || '').substring(0, 30).padEnd(30);

        console.log(`  │ ${trackStr}  │ ${durationStr}  │ ${action} │ ${episode} │ ${conf} │ ${reason} │`);
    }
    console.log('  └───────┴──────────┴────────┴─────────────────┴──────┴────────────────────────────────┘');
    console.log('');
}

// Helper: Analyze mapping for potential issues
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

// Show help function
function showHelp() {
    console.log(`
Usage:
  juice-it [options]

Options:
  --help            Show this help message
  --setup           Configure TMDB API key for metadata lookup
  --output          Specify the output directory (default: <disc_name>_<date>)
  --dvdSource       Specify the DVD source path (e.g., /dev/disk5)
  --title           Specify the movie/show title for TMDB lookup
                    (useful when disc name is cryptic, e.g., "K0_72")
  --quality         Set the encoding quality (e.g., 20)
  --no-deinterlace  Disable deinterlacing
  --no-lookup       Skip online metadata lookup
  --plan            Create a rip plan and exit (don't rip yet)
  --rename-only     Only rename existing files using metadata (no ripping)
  --scan-only       Scan disc and show metadata without ripping
  --diagnose        Run diagnostic mode - detailed mapping analysis for debugging
  --subtitles       Specify the subtitle track number (default: 1)
  --sub-lang        Specify the subtitle language code (default: eng)
  --verbose         Show detailed technical output
  --interactive, -i Enable interactive mode for manual review and selection
                    (default: fully automatic with AI-powered decisions)
  --raw             Raw rip mode - skip metadata lookup and AI mapping
                    Rips all tracks with simple names (discname_1.mp4, etc.)
  --include-extras  Also rip extras (bonus features, behind-the-scenes, etc.)
                    Movies: Only the main feature is ripped by default
                    TV shows: Only episode tracks are ripped by default
  --dry-run         Create stub files instead of actual ripping
                    Useful for testing the workflow without waiting for encoding
  --help-dev        Show developer commands (make, npm, testing)
  --version, -v     Show version number

Example:
  juice-it --output /path/to/output --dvdSource /dev/disk5
  juice-it --title "Cowboy Bebop"  # Search by title when disc name is cryptic
  juice-it --include-extras        # Also rip bonus features/extras
  juice-it --verbose  # Show detailed HandBrakeCLI output
  juice-it --no-lookup  # Skip metadata lookup and use disc name
  juice-it --rename-only --output ./output  # Rename existing files
  juice-it --raw  # Quick raw rip without metadata or AI
`);
}

// Show developer help function
function showDeveloperHelp() {
    console.log(`
JuiceIt - Developer Commands

Setup & Installation:
  make help                   Show all make targets
  make install                Install npm dependencies
  make use-local              Use LOCAL source code (npm link)
  make use-homebrew               Use HOMEBREW release version

  Workflow:
    1. make use-local         (switch to local source code)
    2. Edit juiceit.js        (make changes)
    3. juice-it --help        (test immediately, no rebuild!)
    4. make test              (run tests)
    5. make release           (publish when ready)
    6. make use-homebrew          (switch back to released version)

Testing:
  make test                   Run all automated tests
  make test-core              Core functionality tests only
  make test-prompts           Prompt/schema tests only
  make test-runtime           Runtime analysis tests only
  make test-openai            OpenAI API integration tests only
  make demo                   Run interactive mapping demo

Debugging:
  juice-it --diagnose         Detailed mapping analysis for debugging
  juice-it --verbose          Show HandBrakeCLI output during ripping
  juice-it --dry-run          Create stub files instead of encoding

Releasing:
  make release                Create patch release (1.2.3 -> 1.2.4)
  make release-minor          Create minor release (1.2.3 -> 1.3.0)
  make release-major          Create major release (1.2.3 -> 2.0.0)

File Locations:
  Config:     ~/.config/juice-it/config.json
  Cache:      ~/Library/Caches/juice-it/*.json
  Logs:       ./<output_dir>/juiceit_*.log

Cleanup:
  rm -rf test/test-output              Clean test artifacts
  rm -rf ~/Library/Caches/juice-it     Clean disc cache
  rm -rf ~/.config/juice-it            Clean config (removes API keys)

Documentation:
  README.md                   Main documentation
  CONTRIBUTING.md             Development guidelines
`);
}

// Check for dependencies before starting
checkHandBrakeCLI();
checkLibdvdcss();