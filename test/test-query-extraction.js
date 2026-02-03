#!/usr/bin/env node
/**
 * Dev Tool: Test AI Query Extraction
 *
 * Tests the AI-powered query extraction that cleans user input before TMDB search.
 *
 * Usage:
 *   node test/test-query-extraction.js "Ed, Edd n Eddy the complete series disc 3"
 *   make test-query QUERY="Avatar 2009"
 */

const axios = require('axios');
const OpenAI = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

// Load config
const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigDir() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), '.config', 'juice-it');
    }
    return path.join(os.homedir(), '.config', 'juice-it');
}

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

// Schema for query extraction
const QueryExtractionSchema = z.object({
    searchQuery: z.string().describe('The cleaned title to search TMDB'),
    season: z.number().nullable().describe('Season number if mentioned'),
    disc: z.number().nullable().describe('Disc number if mentioned'),
    year: z.number().nullable().describe('Year if mentioned'),
    isTV: z.boolean().describe('Whether this appears to be a TV show'),
    reasoning: z.string().describe('Brief explanation')
});

// AI query extraction (same as in juiceit.js)
async function aiExtractSearchQuery(userQuery, openaiApiKey) {
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const systemPrompt = `You extract movie/TV show information from user queries to optimize TMDB API searches.

## TMDB Search API Behavior
TMDB's /search/movie and /search/tv endpoints work as follows:
- The "query" parameter is a TEXT SEARCH that matches against original titles, translated titles, and alternative names
- TMDB does fuzzy matching but works BEST with just the title/name - no extra words
- Extra words like "complete series", "box set", "disc 1" will HURT search results
- The API has separate "year" (movies) and "first_air_date_year" (TV) parameters to filter by year

## Your Task
Given a user's input (which may include extra words), extract:
1. searchQuery: JUST the title/name - remove ALL extra words (disc, season, complete series, box set, collection, etc.)
2. season: Season number if mentioned (null if not)
3. disc: Disc number if mentioned (null if not)
4. year: Year if mentioned - IMPORTANT for disambiguation (null if not)
5. isTV: Whether this appears to be a TV show (has seasons/episodes) vs a movie

## Critical Rules
- searchQuery should be CLEAN - only the actual title that TMDB would recognize
- Keep regional identifiers that are part of the title (e.g., "The Office US" vs "The Office UK")
- Preserve special characters in titles (e.g., "Ed, Edd n Eddy" keeps the commas)
- If user mentions a year (e.g., "Avatar 2009"), extract it separately - don't include in searchQuery
- "s01", "s1", "season 1" all mean season: 1
- "d1", "disc 1", "disk 1" all mean disc: 1

## Examples
- "ed, edd n eddy the complete series disc 3" → searchQuery: "Ed, Edd n Eddy", isTV: true, disc: 3
- "Avatar 2009" → searchQuery: "Avatar", year: 2009, isTV: false
- "avatar the last airbender" → searchQuery: "Avatar: The Last Airbender", isTV: true
- "The Office US season 3 disc 2" → searchQuery: "The Office US", isTV: true, season: 3, disc: 2
- "breaking bad s04" → searchQuery: "Breaking Bad", isTV: true, season: 4
- "lord of the rings extended edition" → searchQuery: "The Lord of the Rings", isTV: false
- "friends complete box set" → searchQuery: "Friends", isTV: true
- "game of thrones GOT s8" → searchQuery: "Game of Thrones", isTV: true, season: 8`;

    const response = await openai.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Extract the TMDB search information from this user query: "${userQuery}"` }
        ],
        response_format: zodResponseFormat(QueryExtractionSchema, 'query_extraction')
    });

    return response.choices[0].message.parsed;
}

// TMDB search function
async function searchTMDB(query, isTV, year, apiKey) {
    const endpoint = isTV ? 'search/tv' : 'search/movie';
    const params = {
        api_key: apiKey,
        query: query,
        language: 'en-US'
    };

    if (year) {
        if (isTV) {
            params.first_air_date_year = year;
        } else {
            params.year = year;
        }
    }

    const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params });
    return response.data.results || [];
}

// Main test function
async function main() {
    const userQuery = process.argv[2];

    if (!userQuery) {
        console.log('\n━━━ AI Query Extraction Test Tool ━━━\n');
        console.log('Usage: node test/test-query-extraction.js "your query here"');
        console.log('       make test-query QUERY="your query here"\n');
        console.log('Examples:');
        console.log('  node test/test-query-extraction.js "Ed, Edd n Eddy the complete series disc 3"');
        console.log('  node test/test-query-extraction.js "Avatar 2009"');
        console.log('  node test/test-query-extraction.js "The Office US season 3 disc 2"');
        console.log('  node test/test-query-extraction.js "breaking bad s04"\n');
        process.exit(0);
    }

    const config = loadConfig();

    if (!config.openaiApiKey) {
        console.error('\n❌ Error: OpenAI API key not configured.');
        console.error('   Run: juice-it --setup\n');
        process.exit(1);
    }

    const tmdbApiKey = config.tmdbApiKey || 'REMOVED_API_KEY';

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🧪 AI Query Extraction Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`  📝 User Query: "${userQuery}"\n`);

    // Step 1: AI extraction
    console.log('  ⏳ Step 1: AI Query Extraction...');
    let extracted;
    try {
        extracted = await aiExtractSearchQuery(userQuery, config.openaiApiKey);
        console.log('  ✓ AI extraction complete\n');

        console.log('  ┌─────────────────────────────────────────────────────────┐');
        console.log('  │ AI Extraction Results                                   │');
        console.log('  ├─────────────────────────────────────────────────────────┤');
        console.log(`  │ Search Query: "${extracted.searchQuery}"`);
        console.log(`  │ Is TV Show:   ${extracted.isTV}`);
        console.log(`  │ Season:       ${extracted.season || 'not specified'}`);
        console.log(`  │ Disc:         ${extracted.disc || 'not specified'}`);
        console.log(`  │ Year:         ${extracted.year || 'not specified'}`);
        console.log('  ├─────────────────────────────────────────────────────────┤');
        console.log(`  │ Reasoning: ${extracted.reasoning}`);
        console.log('  └─────────────────────────────────────────────────────────┘\n');
    } catch (error) {
        console.error(`  ❌ AI extraction failed: ${error.message}\n`);
        process.exit(1);
    }

    // Step 2: TMDB search with extracted query
    console.log('  ⏳ Step 2: TMDB Search...');

    // Search based on AI's determination
    const primaryType = extracted.isTV ? 'TV' : 'Movie';
    const primaryResults = await searchTMDB(
        extracted.searchQuery,
        extracted.isTV,
        extracted.year,
        tmdbApiKey
    );

    // Also search the other type for comparison
    const secondaryResults = await searchTMDB(
        extracted.searchQuery,
        !extracted.isTV,
        extracted.year,
        tmdbApiKey
    );

    console.log('  ✓ TMDB search complete\n');

    // Display results
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log(`  │ TMDB ${primaryType} Results (Primary)                          │`);
    console.log('  ├─────────────────────────────────────────────────────────┤');

    if (primaryResults.length === 0) {
        console.log('  │ No results found                                        │');
    } else {
        primaryResults.slice(0, 5).forEach((result, i) => {
            const title = extracted.isTV ? result.name : result.title;
            const date = extracted.isTV ? result.first_air_date : result.release_date;
            const year = date ? date.split('-')[0] : '????';
            const popularity = result.popularity?.toFixed(1) || '?';
            console.log(`  │ ${i + 1}. ${title} (${year}) - popularity: ${popularity}`);
        });
    }
    console.log('  └─────────────────────────────────────────────────────────┘\n');

    if (secondaryResults.length > 0) {
        const secondaryType = extracted.isTV ? 'Movie' : 'TV';
        console.log('  ┌─────────────────────────────────────────────────────────┐');
        console.log(`  │ TMDB ${secondaryType} Results (Secondary)                        │`);
        console.log('  ├─────────────────────────────────────────────────────────┤');
        secondaryResults.slice(0, 3).forEach((result, i) => {
            const title = !extracted.isTV ? result.name : result.title;
            const date = !extracted.isTV ? result.first_air_date : result.release_date;
            const year = date ? date.split('-')[0] : '????';
            console.log(`  │ ${i + 1}. ${title} (${year})`);
        });
        console.log('  └─────────────────────────────────────────────────────────┘\n');
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (primaryResults.length > 0) {
        const topResult = primaryResults[0];
        const title = extracted.isTV ? topResult.name : topResult.title;
        console.log(`  ✅ SUCCESS: Found "${title}" as top result`);
        if (extracted.season) {
            console.log(`     Season ${extracted.season} will be used for episode lookup`);
        }
    } else {
        console.log('  ⚠️  WARNING: No results found with extracted query');
        console.log('     The AI extraction may need adjustment');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(error => {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
});
