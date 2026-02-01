#!/usr/bin/env node
/**
 * JuiceIt Script
 *
 * This script rips all tracks from a DVD using HandBrakeCLI.
 *
 * Usage:
 *   node juiceit.js [options]
 *
 * Options:
 *   --help      Show this help message
 *   --output    Specify the output directory
 *   --dvdSource Specify the DVD source (e.g., /dev/disk5)
 *   --quality   Set the encoding quality (e.g., 20)
 *   --no-deinterlace  Disable deinterlacing
 *   --subtitles  Specify the subtitle track number (default: 1)
 *   --sub-lang   Specify the subtitle language code (default: eng)
 *   --verbose   Show detailed technical output
 *
 * Example:
 *   node juiceit.js --output /path/to/output --dvdSource /dev/disk5
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
const { Select, Input, AutoComplete } = require('enquirer');
const OpenAI = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

// Prompt templates and schemas
const { buildTmdbMatchPrompts, buildTrackMappingPrompts } = require('./prompts/loader');
const { TmdbMatchSchema, TrackMappingResponseSchema } = require('./prompts/schemas');

// AI configuration
const aiConfig = require('./config/ai-config');

// ==================== LOGGING ====================

let logStream = null;
const skippedTracks = [];

function initializeLog(outputDir, volumeName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logFileName = `juiceit_${volumeName}_${timestamp}.log`;
    const logFilePath = path.join(outputDir, logFileName);
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    log(`JuiceIt DVD Ripper Log`);
    log(`DVD: ${volumeName}`);
    log(`Started: ${new Date().toISOString()}`);
    log(`Output Directory: ${outputDir}`);
    log('='.repeat(70));
    return logFilePath;
}

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    if (logStream) {
        logStream.write(logMessage);
    }
}

function closeLog() {
    if (logStream) {
        log('='.repeat(70));
        log(`Finished: ${new Date().toISOString()}`);
        logStream.end();
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
        if (options.verbose) {
            console.log(`Error searching TMDB: ${error.message}`);
        }
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
        if (options.verbose) {
            console.log(`Error fetching season details: ${error.message}`);
        }
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
            if (options.verbose) {
                console.log('\n[AI] No OpenAI key configured, skipping AI call');
            }
            return null;
        }

        // Use structured output if schema provided and config allows
        const useStructured = schema && schemaName && aiConfig.useStructuredOutput;

        if (options.verbose) {
            console.log('\n[AI] Calling OpenAI API...');
            console.log(`[AI] Model: ${aiConfig.model}`);
            console.log(`[AI] Temperature: ${aiConfig.temperature}`);
            console.log('[AI] Structured output:', useStructured ? 'Yes (Zod schema)' : 'No (JSON mode)');
            console.log('[AI] System message:', systemMessage.substring(0, 100) + '...');
            console.log('[AI] User message length:', userMessage.length, 'chars');
        }
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
                    if (options.verbose) {
                        console.log(`[AI] Refusal: ${response.choices[0].message.refusal}`);
                    }
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

        if (options.verbose) {
            console.log(`[AI] Response received in ${elapsed}ms`);
            console.log('[AI] Tokens used:', tokenUsage.total_tokens);
            console.log('[AI] Response:', JSON.stringify(result, null, 2));
        }
        log(`AI: Response received in ${elapsed}ms`);
        log(`AI: Tokens - prompt: ${tokenUsage.prompt_tokens}, completion: ${tokenUsage.completion_tokens}, total: ${tokenUsage.total_tokens}`);
        log(`AI: Response: ${JSON.stringify(result)}`);

        return result;
    } catch (error) {
        if (options.verbose) {
            console.log(`\n[AI] Error: ${error.message}`);
        }
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
        if (options.verbose) {
            console.log('[AI] Starting TMDB match selection');
            console.log('[AI] Analyzing:', volumeName, 'with', numTitles, 'tracks');
            console.log('[AI] Track durations:', JSON.stringify(trackDurations));
            console.log('[AI] TMDB results: ', movieResults.length, 'movies,', tvResults.length, 'TV shows');
        }
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
            if (options.verbose) {
                console.log('[AI] Selected ID:', result.selectedId);
                console.log('[AI] Season:', result.season || 'N/A');
            }
            log(`AI TMDB selection: ${JSON.stringify(result)}`);
        } else if (options.verbose) {
            console.log('[AI] No match selected or low confidence');
        }

        return result;
    } catch (error) {
        if (options.verbose) {
            console.log(`\nAI selection error: ${error.message}`);
        }
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
        if (options.verbose) {
            console.log('[AI] Starting track mapping (Option C: raw data + soft guidance)');
            console.log('[AI] Track count:', Object.keys(trackDurations).length);
            console.log('[AI] Content type:', metadata.type);
            console.log('[AI] Episodes available:', metadata.episodes ? metadata.episodes.length : 'N/A');
            console.log('[AI] lsdvd metadata:', lsdvdMetadata ? 'available' : 'not available');
        }
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
                if (options.verbose) {
                    console.log(`[AI]   Track ${m.trackNum}: ${action}${episodeName} (${(m.confidence * 100).toFixed(0)}% - ${m.reasoning})`);
                }
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
        if (options.verbose) {
            console.log(`\nAI mapping error: ${error.message}`);
        }
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
        validate(value) {
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
                validate(value) {
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

async function lookupMetadata(volumeName, numTitles, trackDurations = null) {
    console.log('\n🔍 Looking up metadata...');
    
    // Clean up the volume name for searching
    const cleanName = volumeName.replace(/_/g, ' ').replace(/\s+D\d+$/i, '').trim();
    const mediaType = guessMediaType(numTitles);
    
    log(`Searching for: "${cleanName}" (guessing type: ${mediaType})`);
    
    // Search both movie and TV
    const movieResults = await searchTMDB(cleanName, false);
    const tvResults = await searchTMDB(cleanName, true);
    
    // Try AI-powered selection if available and we have track durations
    const config = loadConfig();
    if (config.openaiApiKey && trackDurations) {
        const aiSelection = await aiSelectTmdbMatch(volumeName, numTitles, trackDurations, movieResults, tvResults);
        
        if (aiSelection && aiSelection.selectedId && aiSelection.confidence >= 0.8) {
            // AI is confident - use its selection
            const selectedResult = aiSelection.selectedType === 'tv' 
                ? tvResults.find(s => s.id === aiSelection.selectedId)
                : movieResults.find(m => m.id === aiSelection.selectedId);
            
            if (selectedResult) {
                if (aiSelection.selectedType === 'tv') {
                    const season = aiSelection.season || 1;
                    const seasonDetails = await getTVSeasonDetails(selectedResult.id, season);
                    console.log(`\n   ✨ AI auto-selected: ${selectedResult.name} - Season ${season}`);
                    return {
                        type: 'tv',
                        name: selectedResult.name,
                        season: season,
                        episodes: seasonDetails ? seasonDetails.episodes : null,
                        aiSelected: true
                    };
                } else {
                    console.log(`\n   ✨ AI auto-selected: ${selectedResult.title}`);
                    return {
                        type: 'movie',
                        name: selectedResult.title,
                        year: selectedResult.release_date ? selectedResult.release_date.split('-')[0] : null,
                        aiSelected: true
                    };
                }
            }
        } else if (aiSelection) {
            console.log(`\n   ℹ️  AI confidence too low (${(aiSelection.confidence * 100).toFixed(0)}%), showing manual selection...`);
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
    choices.push({ name: 'Enter custom name/prefix', value: { type: 'custom' } });
    choices.push({ name: `Use disc name: "${volumeName}"`, value: { type: 'disc' } });
    
    if (choices.length === 2) {
        // No results found
        console.log('⚠️  No metadata found online\n');
        log('No metadata found');
        return { type: 'disc', volumeName };
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
            result(name) {
                return this.focused.value;
            }
        });
        
        const selected = await prompt.run();
        log(`User selected: ${JSON.stringify(selected)}`);
        
        if (selected.type === 'custom') {
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
            
            return {
                type: 'tv',
                name: selected.data.name,
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

// Process command-line arguments
args.forEach((arg, index) => {
    if (arg === '--help') {
        options.showHelp = true;
    } else if (arg === '--output' && args[index + 1]) {
        options.outputDir = args[index + 1]; // Set outputDir from argument
    } else if (arg === '--dvdSource' && args[index + 1]) {
        options.dvdSource = args[index + 1]; // Set dvdSource from argument
    } else if (arg === '--quality' && args[index + 1]) {
        options.encoding.quality = args[index + 1]; // Set quality from argument
    } else if (arg === '--no-deinterlace') {
        options.encoding.deinterlace = false; // Disable deinterlacing
    } else if (arg === '--subtitles' && args[index + 1]) {
        options.subtitles.track = parseInt(args[index + 1], 10); // Set subtitle track from argument
    } else if (arg === '--sub-lang' && args[index + 1]) {
        options.subtitles.language = args[index + 1]; // Set subtitle language from argument
    } else if (arg === '--verbose') {
        options.verbose = true; // Enable verbose output
    } else if (arg === '--no-lookup') {
        options.noLookup = true; // Skip metadata lookup
    } else if (arg === '--rename-only') {
        options.renameOnly = true; // Only rename existing files
    } else if (arg === '--scan-only') {
        options.scanOnly = true; // Only scan and show metadata
    } else if (arg === '--setup') {
        options.runSetup = true; // Run API key setup
    } else if (arg === '--plan') {
        options.planOnly = true; // Only create a plan, don't rip
    } else if (arg === '--yes' || arg === '-y') {
        options.autoAccept = true; // Auto-accept AI mapping without prompts
    } else if (arg === '--diagnose') {
        options.diagnose = true; // Run diagnostic mode - detailed mapping analysis
    }
});

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
                    if (options.verbose) {
                        console.log(`Cleaned up old cache: ${file.name}`);
                    }
                } catch (err) {
                    if (options.verbose) {
                        console.log(`Could not delete cache file ${file.name}: ${err.message}`);
                    }
                }
            });
        }
    } catch (error) {
        if (options.verbose) {
            console.log(`Error cleaning up cache: ${error.message}`);
        }
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
        console.error("HandBrakeCLI is not installed. Please install it using 'brew install handbrake' to use this script.");
        process.exit(1);
    }
}

// Check if libdvdcss is installed
function checkLibdvdcss() {
    const result = spawnSync('brew', ['list', 'libdvdcss']);
    if (result.error || result.status !== 0) {
        console.error("libdvdcss is not installed. Please install it using 'brew install libdvdcss' to use this script.");
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
        if (options.verbose) {
            console.log('[lsdvd] Not installed, skipping extended metadata');
        }
        return null;
    }

    try {
        const result = spawnSync('lsdvd', [dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        if (result.error || result.status !== 0) {
            if (options.verbose) {
                console.log('[lsdvd] Failed to read disc:', result.stderr || result.error?.message);
            }
            return null;
        }

        const output = result.stdout + result.stderr; // lsdvd outputs to both
        return parseLsdvdOutput(output);
    } catch (error) {
        if (options.verbose) {
            console.log('[lsdvd] Error:', error.message);
        }
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
        if (options.verbose) {
            console.error("Error detecting DVD drives:", error);
        }
        return [];
    }
}

// Function to detect the DVD source automatically
async function detectDvdSource() {
    const drives = detectAllDvdDrives();
    
    if (drives.length === 0) {
        return null;
    } else if (drives.length === 1) {
        return drives[0].device;
    } else {
        // Multiple drives found - show interactive selection
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
        
        // Show AI status
        if (!config.openaiApiKey) {
            console.log('');
            console.log('ℹ️  AI-powered mapping is NOT enabled');
            console.log('   To enable automatic track mapping and TMDB selection:');
            console.log('   1. Get an OpenAI API key: https://platform.openai.com/api-keys');
            console.log('   2. Run: juiceit --setup');
            console.log('   Cost: ~$0.001 per disc');
            console.log('');
        } else {
            console.log('');
            console.log('✨ AI-powered mapping is enabled!');
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
        console.error("No DVD source detected. Please provide a valid DVD source using --dvdSource.");
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
        // Updated arguments for HandBrakeCLI with conditional deinterlacing, subtitles, and additional options
        const args = [
            '-i', options.dvdSource,
            '-o', outputFilePath,
            '-e', options.encoding.encoder,
            '-q', options.encoding.quality,
            '-t', titleNumber.toString(),
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
        
        if (options.verbose) {
            console.log(`⚙️ Running HandBrakeCLI with command: HandBrakeCLI ${args.join(' ')}`);
        }

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
            if (options.verbose) {
                console.log(`\n[handbrake-info]: ${dataStr}`);
            }
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

// Get volume name using diskutil
function getVolumeName() {
    try {
        const output = execSync(`diskutil info ${options.dvdSource}`).toString();
        const match = output.match(/Volume Name:\s*(.+)/);
        return match ? match[1].trim() : null; // Return the Volume Name if found
    } catch (error) {
        console.error("Error fetching volume name:", error);
        return null;
    }
}

// Get number of titles with caching and duration information
async function getNumberOfTitles() {
    process.stdout.write('🔍 Scanning disc...');
    const volumeName = getVolumeName(); // Get the current volume name
    const cacheFilePath = getCacheFilePath();

    if (options.verbose) {
        console.log(`\nCurrent Volume Name: ${volumeName}`);
        console.log(`Cache file path: ${cacheFilePath}`);
    }

    // Check if cache exists
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));

        if (options.verbose) {
            console.log(`\nCached Volume Name: ${cacheData.volumeName}`);
            console.log(`Comparing cached volume name "${cacheData.volumeName}" with current volume name "${volumeName}"`);
        }

        if (cacheData.volumeName === volumeName) {
            console.log(` ✓ Found ${cacheData.numTitles} title${cacheData.numTitles > 1 ? 's' : ''} (cached)`);
            console.log('');
            // Store title durations globally if available
            if (cacheData.titleDurations) {
                global.dvdTitleDurations = cacheData.titleDurations;
            }
            return cacheData.numTitles;
        } else if (options.verbose) {
            console.log("Volume names do not match. Cache will be ignored.");
        }
    } else if (options.verbose) {
        console.log("Cache does not exist. Fetching title information from the disc.");
    }

    // Fetch title information if cache is not valid
    // Use spawn with real-time output for track-by-track progress display
    console.log('');

    // Use --previews 0:0 to skip preview generation entirely - we only need title/duration info
    const args = ['-i', options.dvdSource, '--title', '0', '--scan', '--previews', '0:0'];

    if (options.verbose) {
        console.log(`Running: HandBrakeCLI ${args.join(' ')}`);
    }

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

        const processData = (data) => {
            if (resolved) return; // Stop processing after we resolve

            const chunk = data.toString();
            output += chunk;

            if (options.verbose) {
                process.stdout.write(chunk);
            }

            // Check for total title count
            const totalMatch = chunk.match(/scan: DVD has (\d+) title/);
            if (totalMatch) {
                totalTitles = parseInt(totalMatch[1], 10);
                console.log(`   Found ${totalTitles} title${totalTitles > 1 ? 's' : ''} - scanning each...`);
            }

            // Check for current title being scanned and show progress
            const scanningMatch = chunk.match(/scan: scanning title (\d+)/);
            if (scanningMatch) {
                const currentTitle = parseInt(scanningMatch[1], 10);
                if (currentTitle > lastReportedTitle) {
                    lastReportedTitle = currentTitle;
                    process.stdout.write(`\r   Scanning track ${currentTitle}${totalTitles > 0 ? ' of ' + totalTitles : ''}...`);
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

                // Kill process once we have all title durations - HandBrakeCLI hangs on post-processing
                if (totalTitles > 0 && scannedTitlesCount >= totalTitles) {
                    resolved = true;
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');
                    handbrakeProcess.kill('SIGTERM');
                    resolve({ code: 0, output, titleDurations, totalTitles });
                }
            }
        };

        handbrakeProcess.stdout.on('data', processData);
        handbrakeProcess.stderr.on('data', processData);

        handbrakeProcess.on('error', (error) => {
            if (!resolved) {
                reject(new Error(`HandBrakeCLI failed to start: ${error.message}`));
            }
        });

        handbrakeProcess.on('close', (code) => {
            if (!resolved) {
                // Clear the scanning line
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                resolve({ code, output, titleDurations, totalTitles });
            }
        });
    });

    const { code, output, titleDurations, totalTitles } = scanResult;

    if (code === 0 || output.includes('scan: DVD has')) {
        const match = output.match(/scan: DVD has (\d+) title/);
        if (match) {
            const numTitles = parseInt(match[1], 10);
            console.log(`✓ Found ${numTitles} title${numTitles > 1 ? 's' : ''}`);
            console.log('');

            // Use durations collected during scanning (we kill process early before final output)
            const finalDurations = { ...titleDurations };

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

            if (options.verbose) {
                console.log(`Cache created with Volume Name: ${volumeName}, Titles: ${numTitles}`);
                console.log(`Title durations:`, finalDurations);
            }
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

// Helper function to categorize track by duration
function categorizeTrack(duration) {
    if (duration < 2) {
        return 'menu';
    } else if (duration < 10) {
        return 'extra';
    } else if (duration >= 20 && duration <= 45) {
        return 'episode';
    } else if (duration > 90) {
        return 'full_disc';
    } else {
        return 'unknown';
    }
}

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
        if (options.verbose) {
            console.log(`Error getting duration for ${filePath}: ${error.message}`);
        }
    }
    return null;
}

// Helper function for sprintf-style formatting
function sprintf(format, ...args) {
    let i = 0;
    return format.replace(/%0?(\d*)d/g, (match, width) => {
        const num = args[i++];
        return width ? String(num).padStart(parseInt(width), '0') : String(num);
    });
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Helper function to determine if track should show warning
function shouldWarn(fileSize, duration) {
    const MB = 1024 * 1024;
    return fileSize < 50 * MB || duration < 5;
}

async function renameExistingFiles() {
    try {
        const volumeName = getVolumeName();
        
        // For rename-only mode, output directory must be specified
        if (!options.outputDir) {
            console.error('\n❌ Error: --output directory must be specified when using --rename-only\n');
            return;
        }
        
        if (!fs.existsSync(options.outputDir)) {
            console.error(`\n❌ Error: Output directory "${options.outputDir}" does not exist\n`);
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
                    if (options.verbose) {
                        console.log('DVD title durations:', dvdTitleDurations);
                    }
                }
            } catch (error) {
                if (options.verbose) {
                    console.log(`Could not load cache: ${error.message}`);
                }
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
        const filesWithDuration = allFiles.map((f, index) => {
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
        
        // Determine base file name based on metadata
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'movie') {
            const year = metadata.year ? `_${metadata.year}` : '';
            baseFileName = `${metadata.name}${year}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'custom') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        }
        
        let renameCount = 0;
        
        for (let i = 0; i < existingFiles.length; i++) {
            const oldFile = existingFiles[i];
            const titleNumber = i + 1;
            let newFileName;
            
            // Generate filename based on metadata type
            if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[i]) {
                const episode = metadata.episodes[i];
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(episode.episode_number).padStart(2, '0');
                const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
                newFileName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}.mp4`;
            } else if (metadata.type === 'tv') {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(titleNumber).padStart(2, '0');
                newFileName = `${baseFileName}_S${seasonNum}E${episodeNum}.mp4`;
            } else if (numTitles === 1) {
                newFileName = `${baseFileName}.mp4`;
            } else {
                newFileName = `${baseFileName}_${titleNumber}.mp4`;
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
        console.error(`\n❌ Error during renaming: ${error}\n`);
        if (logStream) {
            log(`Fatal error: ${error}`);
            closeLog();
        }
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

    // Auto-accept if --yes flag is used AND using AI mapping (not sequential fallback)
    if (options.autoAccept) {
        if (usingSequentialFallback) {
            console.log('  ⚠️  Cannot auto-accept: Using sequential mapping (requires manual review)');
            console.log('  ⚠️  Sequential mapping may assign tracks to wrong episodes.');
            console.log('  ⚠️  Please review and adjust mappings before proceeding.\n');
            // Fall through to manual review
        } else if (hasAI) {
            console.log('  ✓ Auto-accepting AI mapping (--yes flag)\n');

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
        } else {
            // No AI but also not sequential fallback (e.g., movies) - auto-accept is fine
            console.log('  ✓ Auto-accepting mapping (--yes flag)\n');

            // Finalize mappings
            for (const mapping of proposedMappings) {
                if (mapping.status === 'pending') {
                    mapping.status = mapping.proposedName;
                }
            }
            return proposedMappings;
        }
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
            metadata.episodes.forEach((ep, idx) => {
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

// Interactive review and mapping function (AFTER ripping - for backwards compatibility)
async function reviewAndMapEpisodes(proposedMappings, metadata, volumeName, baseFileName, outputDir) {
    console.log('\n' + '━'.repeat(60));
    console.log('  📋 Review Track Mappings');
    console.log('━'.repeat(60));
    console.log('');
    
    // Display track table
    console.log('  Track  Size       Duration  Status  Proposed Name');
    console.log('  -----  ---------  --------  ------  ' + '-'.repeat(40));
    
    for (const mapping of proposedMappings) {
        const trackStr = String(mapping.trackNum).padStart(2);
        const sizeStr = formatFileSize(mapping.fileSize).padEnd(9);
        const durationStr = `${mapping.duration} min`.padEnd(8);
        const statusIcon = mapping.status === 'skip' ? '⏭' : (shouldWarn(mapping.fileSize, mapping.duration) ? '⚠️' : '✓');
        const proposedName = mapping.proposedName || mapping.filename;
        console.log(`  ${trackStr}     ${sizeStr}  ${durationStr}  ${statusIcon}     ${proposedName}`);
    }
    
    console.log('');
    
    // Main menu loop
    while (true) {
        const mainMenu = new Select({
            message: 'What would you like to do?',
            choices: [
                'Edit Track Mapping',
                'Re-search TMDB and Re-auto-map',
                'Accept All and Finalize',
                'Cancel (keep generic track names)'
            ]
        });
        
        try {
            const choice = await mainMenu.run();
            
            if (choice === 'Edit Track Mapping') {
                await editTrackMapping(proposedMappings, metadata, baseFileName);
            } else if (choice === 'Re-search TMDB and Re-auto-map') {
                const newMetadata = await reAutoMap(volumeName, proposedMappings.length);
                if (newMetadata) {
                    metadata = newMetadata;
                    // Re-calculate proposed names
                    for (let i = 0; i < proposedMappings.length; i++) {
                        proposedMappings[i].proposedName = calculateProposedName(i, metadata, baseFileName, proposedMappings.length);
                    }
                }
            } else if (choice === 'Accept All and Finalize') {
                await finalizeRenames(proposedMappings, outputDir);
                return true;
            } else {
                console.log('\n  ✓ Keeping generic track names\n');
                return false;
            }
        } catch (err) {
            console.log('\n  ✓ Operation cancelled\n');
            return false;
        }
        
        // Redisplay table after action
        console.log('');
        console.log('  Track  Size       Duration  Status  Proposed Name');
        console.log('  -----  ---------  --------  ------  ' + '-'.repeat(40));
        
        for (const mapping of proposedMappings) {
            const trackStr = String(mapping.trackNum).padStart(2);
            const sizeStr = formatFileSize(mapping.fileSize).padEnd(9);
            const durationStr = `${mapping.duration} min`.padEnd(8);
            const statusIcon = mapping.status === 'skip' ? '⏭' : (shouldWarn(mapping.fileSize, mapping.duration) ? '⚠️' : '✓');
            const proposedName = mapping.proposedName || mapping.filename;
            console.log(`  ${trackStr}     ${sizeStr}  ${durationStr}  ${statusIcon}     ${proposedName}`);
        }
        console.log('');
    }
}

// Edit individual track mapping
async function editTrackMapping(proposedMappings, metadata, baseFileName) {
    // Select track
    const trackChoices = proposedMappings.map(m => {
        const warn = shouldWarn(m.fileSize, m.duration) ? '⚠️ ' : '';
        const skip = m.status === 'skip' ? '(SKIP) ' : '';
        return {
            name: `${warn}${skip}Track ${m.trackNum}: ${m.proposedName || m.filename} (${formatFileSize(m.fileSize)}, ${m.duration}min)`,
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
        metadata.episodes.forEach((ep, idx) => {
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
        mapping.proposedName = '(will not rename)';
        console.log(`\n  ✓ Track ${selectedTrack} marked to skip\n`);
        log(`Track ${selectedTrack} marked to skip`);
    } else {
        mapping.status = 'rename';
        mapping.proposedName = assignment;
        console.log(`\n  ✓ Track ${selectedTrack} reassigned to: ${assignment}\n`);
        log(`Track ${selectedTrack} reassigned to: ${assignment}`);
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

// Finalize renames
async function finalizeRenames(proposedMappings, outputDir) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬 Finalizing Renames');
    console.log('━'.repeat(60));
    console.log('');
    
    let renameCount = 0;
    let skipCount = 0;
    
    for (const mapping of proposedMappings) {
        if (mapping.status === 'skip') {
            console.log(`  ⏭  Track ${mapping.trackNum}: Skipped`);
            log(`Track ${mapping.trackNum} skipped (marked as extra)`);
            skipCount++;
            continue;
        }
        
        const oldPath = path.join(outputDir, mapping.filename);
        const newPath = path.join(outputDir, mapping.proposedName);
        
        if (mapping.filename === mapping.proposedName) {
            console.log(`  ⏭  Track ${mapping.trackNum}: ${mapping.filename} (unchanged)`);
            continue;
        }
        
        if (fs.existsSync(newPath) && oldPath !== newPath) {
            console.log(`  ⚠️  Track ${mapping.trackNum}: ${mapping.filename}`);
            console.log(`      → ${mapping.proposedName} (target exists, skipping)`);
            log(`Skipped rename ${mapping.filename} -> ${mapping.proposedName}: target exists`);
            skipCount++;
            continue;
        }
        
        try {
            fs.renameSync(oldPath, newPath);
            console.log(`  ✓ Track ${mapping.trackNum}: ${mapping.filename}`);
            console.log(`    → ${mapping.proposedName}`);
            log(`Renamed: ${mapping.filename} -> ${mapping.proposedName}`);
            renameCount++;
        } catch (error) {
            console.log(`  ❌ Track ${mapping.trackNum}: Failed to rename ${mapping.filename}`);
            console.log(`      Error: ${error.message}`);
            log(`Error renaming ${mapping.filename}: ${error.message}`);
        }
    }
    
    console.log('');
    console.log('━'.repeat(60));
    if (renameCount > 0) {
        console.log(`  ⚡ Renamed ${renameCount} file(s) successfully!`);
    }
    if (skipCount > 0) {
        console.log(`  ⏭  Skipped ${skipCount} file(s)`);
    }
    console.log('━'.repeat(60));
    console.log('');
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
        if (options.verbose) {
            console.log(`Error loading plan: ${error.message}`);
        }
        return null;
    }
}

// Helper to calculate proposed name
function calculateProposedName(index, metadata, baseFileName, numTitles) {
    const titleNumber = index + 1;
    
    if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[index]) {
        const episode = metadata.episodes[index];
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(episode.episode_number).padStart(2, '0');
        const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
        return `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}.mp4`;
    } else if (metadata.type === 'tv') {
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(titleNumber).padStart(2, '0');
        return `${baseFileName}_S${seasonNum}E${episodeNum}.mp4`;
    } else if (numTitles === 1) {
        return `${baseFileName}.mp4`;
    } else {
        return `${baseFileName}_${titleNumber}.mp4`;
    }
}

async function ripAllTracks() {
    let logFilePath = null;
    let successCount = 0;
    
    try {
        const volumeName = getVolumeName(); // Get the DVD volume name
        
        // Set default output directory before any operations
        setDefaultOutputDir(volumeName);
        
        printBanner(volumeName); // Show the banner

        const numTitles = await getNumberOfTitles(); // Get the number of titles

        if (numTitles === 0) {
            console.log('❌ No titles found on disc. Exiting.\n');
            log('No titles found on disc');
            return;
        }
        
        // Lookup metadata unless disabled (pass track durations for AI)
        let metadata = null;
        if (!options.noLookup) {
            metadata = await lookupMetadata(volumeName, numTitles, global.dvdTitleDurations);
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
        
        // Determine base file name based on metadata
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'movie') {
            const year = metadata.year ? `_${metadata.year}` : '';
            baseFileName = `${metadata.name}${year}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'custom') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
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
                while (!aiMappingResult && !useSequentialMapping) {
                    aiMappingResult = await aiMapTracks(global.dvdTitleDurations, metadata, lsdvdMetadata);

                    if (!aiMappingResult) {
                        log('ERROR: AI mapping failed');
                        console.log('');
                        console.log('  ❌ AI mapping failed!');
                        console.log('');

                        // Ask user what to do
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
                    }
                }
            } else if (metadata.type === 'tv' && !config.openaiApiKey) {
                // No AI key configured - warn user and ask what to do
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
                // Movie or no track durations - sequential is fine
                useSequentialMapping = true;
            }

            // Build proposed mappings with track info before ripping
        for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
            const trackDuration = global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : null;
            let proposedName;
            let status = 'pending';
            let aiReasoning = null;
            let aiConfidence = null;

            // Use AI mapping if available
            if (aiMappingResult && aiMappingResult.mappings) {
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
                    if (options.verbose) {
                        console.log(`[AI] Track ${titleNumber}: Not analyzed by AI, marking as skip`);
                    }
                }
            } else if (useSequentialMapping) {
                // User explicitly chose sequential mapping
                proposedName = calculateProposedName(titleNumber - 1, metadata, baseFileName, numTitles);
                if (metadata.type === 'tv') {
                    aiReasoning = '⚠️ Sequential mapping (user selected) - verify track assignments';
                    aiConfidence = 0;
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
        } // End of "if no plan loaded" block
        
        // Interactive review BEFORE ripping (skip if using existing plan directly)
        let mappingsToRip;
        const skipReview = existingPlan && proposedMappings.some(m => m.status !== 'pending' && m.status !== 'skip');
        
        if (skipReview) {
            // Already finalized from existing plan
            mappingsToRip = proposedMappings;
            log('Skipping review - using finalized plan');
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
        console.log('  🎬 Starting rip...');
        console.log('━'.repeat(60));
        console.log('');

        // Log final mapping table before ripping
        log('=== FINAL TRACK TO FILENAME MAPPINGS ===');
        for (const mapping of mappingsToRip) {
            const status = mapping.status === 'skip' ? 'SKIP' : mapping.status;
            log(`Track ${mapping.trackNum} (${mapping.duration} min) → ${status}`);
        }
        log('=== END FINAL MAPPINGS ===');

        // Rip only the tracks that weren't marked as skip
        for (const mapping of mappingsToRip) {
            if (mapping.status === 'skip') {
                continue;
            }
            
            const titleNumber = mapping.trackNum;
            const finalFileName = mapping.status; // status contains the final filename
            
            console.log(`  ⚙️  Track ${titleNumber} of ${numTitles}: ${finalFileName}`);

            try {
                await ripDvd(titleNumber, finalFileName.replace('.mp4', ''), titleNumber, numTitles, (progress, elapsed, remaining, trackNum, totalTracks) => {
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
                console.log(`  ℹ️  Skipped ${skippedTracks.length} track(s):`);
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
    } catch (error) {
        console.error(`\n❌ Error during ripping: ${error}\n`);
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
  node juiceit.js [options]

Options:
  --help            Show this help message
  --setup           Configure TMDB API key for metadata lookup
  --output          Specify the output directory (default: <disc_name>_<date>)
  --dvdSource       Specify the DVD source path (e.g., /dev/disk5)
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

Example:
  node juiceit.js --output /path/to/output --dvdSource /dev/disk5
  node juiceit.js --verbose  # Show detailed HandBrakeCLI output
  node juiceit.js --no-lookup  # Skip metadata lookup and use disc name
  node juiceit.js --rename-only --output ./output  # Rename existing files
`);

}

// Check for dependencies before starting
checkHandBrakeCLI();
checkLibdvdcss();