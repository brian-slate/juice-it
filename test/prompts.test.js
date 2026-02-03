/**
 * Tests for Prompt Loader and Zod Schemas
 *
 * Tests the prompt template loading, variable interpolation,
 * and structured output schema validation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Import modules under test
const {
    loadTemplate,
    interpolate,
    clearCache,
    buildTmdbMatchPrompts,
    buildTrackMappingPrompts,
    buildMappingValidationPrompts
} = require('../prompts/loader');

const {
    TmdbMatchSchema,
    TrackMappingSchema,
    RuntimeAnalysisSchema,
    MappingSummarySchema,
    TrackMappingResponseSchema,
    QueryExtractionSchema,
    SuggestedSearchSchema,
    MappingConcernSchema,
    MappingValidationSchema
} = require('../prompts/schemas');

// Test directories
const TEST_ROOT = path.join(__dirname, 'test-output');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Setup and teardown
function setup() {
    if (!fs.existsSync(TEST_ROOT)) {
        fs.mkdirSync(TEST_ROOT, { recursive: true });
    }
    if (!fs.existsSync(FIXTURES_DIR)) {
        fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
    clearCache(); // Clear template cache between tests
}

function teardown() {
    // Clean up test fixtures if needed
}

// ============================================================================
// PROMPT LOADER TESTS
// ============================================================================

console.log('\n━━━ Prompt Loader Tests ━━━\n');

function testLoadTemplate() {
    console.log('Test: loadTemplate loads existing templates');
    setup();

    // Test loading each template file
    const templateNames = [
        'tmdb-match-system',
        'tmdb-match-user',
        'track-mapping-system',
        'track-mapping-user'
    ];

    templateNames.forEach(name => {
        const content = loadTemplate(name);
        assert.strictEqual(typeof content, 'string', `Template ${name} should return a string`);
        assert.strictEqual(content.length > 0, true, `Template ${name} should not be empty`);
    });

    teardown();
    console.log('  ✓ PASS\n');
}

function testLoadTemplateNotFound() {
    console.log('Test: loadTemplate throws for missing templates');
    setup();

    try {
        loadTemplate('non-existent-template');
        assert.fail('Should have thrown an error');
    } catch (error) {
        assert.strictEqual(error.message.includes('not found'), true, 'Error should mention template not found');
    }

    teardown();
    console.log('  ✓ PASS\n');
}

function testInterpolateBasic() {
    console.log('Test: interpolate replaces variables');
    setup();

    const template = 'Hello {{name}}, you have {{count}} messages.';
    const result = interpolate(template, { name: 'Alice', count: 5 });

    assert.strictEqual(result, 'Hello Alice, you have 5 messages.', 'Variables should be replaced');

    teardown();
    console.log('  ✓ PASS\n');
}

function testInterpolateObjects() {
    console.log('Test: interpolate converts objects to JSON');
    setup();

    const template = 'Data: {{data}}';
    const result = interpolate(template, { data: { key: 'value', num: 42 } });

    assert.strictEqual(result.includes('"key": "value"'), true, 'Object should be JSON stringified');
    assert.strictEqual(result.includes('"num": 42'), true, 'Object values should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testInterpolateArrays() {
    console.log('Test: interpolate converts arrays to JSON');
    setup();

    const template = 'Items: {{items}}';
    const result = interpolate(template, { items: [1, 2, 3] });

    assert.strictEqual(result.includes('['), true, 'Array should be JSON stringified');
    assert.strictEqual(result.includes('1'), true, 'Array values should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testInterpolateMissingVariables() {
    console.log('Test: interpolate leaves unmatched variables');
    setup();

    const template = 'Hello {{name}}, your ID is {{id}}.';
    // Use silent: true to suppress warning during test (we're testing intentional missing var)
    const result = interpolate(template, { name: 'Bob' }, { silent: true });

    assert.strictEqual(result, 'Hello Bob, your ID is {{id}}.', 'Missing variables should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildTmdbMatchPrompts() {
    console.log('Test: buildTmdbMatchPrompts creates valid prompts');
    setup();

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'TEST_DVD_DISC_1',
        numTitles: 8,
        trackDurations: [10, 10, 10, 10, 10, 10, 2, 5],
        movieResults: [
            { id: 123, title: 'Test Movie', release_date: '2020-05-15', overview: 'A test movie about testing.' }
        ],
        tvResults: [
            { id: 456, name: 'Test Show', first_air_date: '2019-03-01', overview: 'A test TV show.' }
        ]
    });

    assert.strictEqual(typeof prompts.system, 'string', 'System prompt should be a string');
    assert.strictEqual(typeof prompts.user, 'string', 'User prompt should be a string');
    assert.strictEqual(prompts.user.includes('TEST_DVD_DISC_1'), true, 'User prompt should contain volume name');
    assert.strictEqual(prompts.user.includes('8'), true, 'User prompt should contain track count');
    assert.strictEqual(prompts.user.includes('Test Movie'), true, 'User prompt should contain movie results');
    assert.strictEqual(prompts.user.includes('Test Show'), true, 'User prompt should contain TV results');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildTrackMappingPrompts() {
    console.log('Test: buildTrackMappingPrompts creates valid prompts (Option C)');
    setup();

    const metadata = {
        name: 'Test Show',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Pilot', runtime: 22 },
            { episode_number: 2, name: 'Second Episode', runtime: 23 }
        ]
    };

    const runtimeAnalysis = {
        min: 22,
        max: 23,
        avg: 22,
        variance: 1,
        tolerance: 2,
        format: 'half-hour format (sitcom, animation, etc.)',
        episodeCount: 2
    };

    // Option C: Pass raw data, function handles formatting internally
    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 22, 2: 23 },
        runtimeAnalysis,
        lsdvdMetadata: null // Optional lsdvd metadata
    });

    assert.strictEqual(typeof prompts.system, 'string', 'System prompt should be a string');
    assert.strictEqual(typeof prompts.user, 'string', 'User prompt should be a string');
    assert.strictEqual(prompts.user.includes('Test Show'), true, 'User prompt should contain show name');
    assert.strictEqual(prompts.user.includes('Pilot'), true, 'User prompt should contain episode name');
    // Option C uses soft guidance, check for suggestion language
    assert.strictEqual(prompts.user.includes('might'), true, 'User prompt should contain soft guidance language');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTemplateCache() {
    console.log('Test: Template caching works correctly');
    setup();

    // Load template twice
    const content1 = loadTemplate('tmdb-match-system');
    const content2 = loadTemplate('tmdb-match-system');

    assert.strictEqual(content1, content2, 'Cached template should be identical');

    // Clear cache and reload
    clearCache();
    const content3 = loadTemplate('tmdb-match-system');

    assert.strictEqual(content1, content3, 'Reloaded template should be identical');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// ZOD SCHEMA TESTS
// ============================================================================

console.log('━━━ Zod Schema Validation Tests ━━━\n');

function testTmdbMatchSchemaValid() {
    console.log('Test: TmdbMatchSchema validates correct data');
    setup();

    const validData = {
        selectedId: 12345,
        selectedType: 'tv',
        confidence: 0.95,
        reasoning: 'Volume name matches show title exactly',
        season: 1
    };

    const result = TmdbMatchSchema.safeParse(validData);
    assert.strictEqual(result.success, true, 'Valid data should pass validation');
    assert.strictEqual(result.data.selectedId, 12345, 'Data should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchSchemaWithNull() {
    console.log('Test: TmdbMatchSchema accepts null values');
    setup();

    const nullData = {
        selectedId: null,
        selectedType: null,
        confidence: 0.1,
        reasoning: 'No good match found',
        season: null
    };

    const result = TmdbMatchSchema.safeParse(nullData);
    assert.strictEqual(result.success, true, 'Null values should be accepted');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchSchemaInvalidType() {
    console.log('Test: TmdbMatchSchema rejects invalid selectedType');
    setup();

    const invalidData = {
        selectedId: 123,
        selectedType: 'invalid', // Should be 'tv' or 'movie'
        confidence: 0.5,
        reasoning: 'Test'
    };

    const result = TmdbMatchSchema.safeParse(invalidData);
    assert.strictEqual(result.success, false, 'Invalid type should fail validation');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchSchemaInvalidConfidence() {
    console.log('Test: TmdbMatchSchema rejects out-of-range confidence');
    setup();

    const tooHigh = {
        selectedId: 123,
        selectedType: 'movie',
        confidence: 1.5, // Should be 0.0-1.0
        reasoning: 'Test'
    };

    const tooLow = {
        selectedId: 123,
        selectedType: 'movie',
        confidence: -0.1, // Should be 0.0-1.0
        reasoning: 'Test'
    };

    const resultHigh = TmdbMatchSchema.safeParse(tooHigh);
    const resultLow = TmdbMatchSchema.safeParse(tooLow);

    assert.strictEqual(resultHigh.success, false, 'Confidence > 1 should fail');
    assert.strictEqual(resultLow.success, false, 'Confidence < 0 should fail');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingSchemaValid() {
    console.log('Test: TrackMappingSchema validates correct data');
    setup();

    const validMapping = {
        trackNum: 1,
        trackDuration: 22,
        episodeIndex: 0,
        episodeRuntime: 22,
        durationDifference: 0,
        shouldSkip: false,
        confidence: 0.99,
        reasoning: 'Exact duration match'
    };

    const result = TrackMappingSchema.safeParse(validMapping);
    assert.strictEqual(result.success, true, 'Valid mapping should pass');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingSchemaSkipped() {
    console.log('Test: TrackMappingSchema validates skipped tracks');
    setup();

    const skippedMapping = {
        trackNum: 5,
        trackDuration: 2,
        episodeIndex: null,
        episodeRuntime: null,
        durationDifference: null,
        shouldSkip: true,
        confidence: 0.95,
        reasoning: 'Duration too short - likely menu'
    };

    const result = TrackMappingSchema.safeParse(skippedMapping);
    assert.strictEqual(result.success, true, 'Skipped mapping should pass');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingSchemaWithExtraType() {
    console.log('Test: TrackMappingSchema validates extraType and extraDescription for Play All');
    setup();

    // Play All compilation track
    const playAllMapping = {
        trackNum: 1,
        trackDuration: 180,
        episodeIndex: null,
        episodeRuntime: null,
        durationDifference: null,
        shouldSkip: true,
        extraType: 'other',
        extraDescription: 'Play All',
        confidence: 1.0,
        reasoning: 'Play All compilation track - all episodes concatenated'
    };

    const result = TrackMappingSchema.safeParse(playAllMapping);
    assert.strictEqual(result.success, true, 'Play All mapping with extraType should pass');
    assert.strictEqual(result.data.extraType, 'other', 'extraType should be "other"');
    assert.strictEqual(result.data.extraDescription, 'Play All', 'extraDescription should be "Play All"');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingSchemaExtraTypeValidation() {
    console.log('Test: TrackMappingSchema validates all valid extraType values');
    setup();

    const validTypes = ['behindthescenes', 'deleted', 'featurette', 'interview', 'scene', 'short', 'trailer', 'other'];

    validTypes.forEach(type => {
        const mapping = {
            trackNum: 1,
            trackDuration: 10,
            episodeIndex: null,
            episodeRuntime: null,
            durationDifference: null,
            shouldSkip: true,
            extraType: type,
            extraDescription: `Test ${type}`,
            confidence: 0.9,
            reasoning: `Test for ${type}`
        };

        const result = TrackMappingSchema.safeParse(mapping);
        assert.strictEqual(result.success, true, `extraType "${type}" should be valid`);
    });

    // Test invalid extraType
    const invalidMapping = {
        trackNum: 1,
        trackDuration: 10,
        episodeIndex: null,
        episodeRuntime: null,
        durationDifference: null,
        shouldSkip: true,
        extraType: 'invalid_type',
        confidence: 0.9,
        reasoning: 'Test'
    };

    const invalidResult = TrackMappingSchema.safeParse(invalidMapping);
    assert.strictEqual(invalidResult.success, false, 'Invalid extraType should fail validation');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingResponseSchemaValid() {
    console.log('Test: TrackMappingResponseSchema validates complete response');
    setup();

    const validResponse = {
        runtimeAnalysis: {
            episodeRuntimeRange: '9-10 min',
            toleranceUsed: 2,
            validTrackRange: '7-12 min'
        },
        mappings: [
            {
                trackNum: 1,
                trackDuration: 9,
                episodeIndex: 0,
                episodeRuntime: 9,
                durationDifference: 0,
                shouldSkip: false,
                confidence: 0.98,
                reasoning: 'Exact match'
            },
            {
                trackNum: 2,
                trackDuration: 2,
                episodeIndex: null,
                episodeRuntime: null,
                durationDifference: null,
                shouldSkip: true,
                confidence: 0.99,
                reasoning: 'Menu track'
            }
        ],
        summary: {
            tracksMatched: 1,
            tracksSkipped: 1,
            episodesFound: 1,
            episodesExpected: 1
        },
        overallConfidence: 0.95
    };

    const result = TrackMappingResponseSchema.safeParse(validResponse);
    assert.strictEqual(result.success, true, 'Complete response should pass validation');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingResponseSchemaMissingField() {
    console.log('Test: TrackMappingResponseSchema rejects missing fields');
    setup();

    const missingMappings = {
        runtimeAnalysis: {
            episodeRuntimeRange: '9-10 min',
            toleranceUsed: 2,
            validTrackRange: '7-12 min'
        },
        // missing: mappings
        summary: {
            tracksMatched: 1,
            tracksSkipped: 0,
            episodesFound: 1,
            episodesExpected: 1
        },
        overallConfidence: 0.95
    };

    const result = TrackMappingResponseSchema.safeParse(missingMappings);
    assert.strictEqual(result.success, false, 'Missing mappings should fail');

    teardown();
    console.log('  ✓ PASS\n');
}

function testRuntimeAnalysisSchemaValid() {
    console.log('Test: RuntimeAnalysisSchema validates correctly');
    setup();

    const validAnalysis = {
        episodeRuntimeRange: '22-24 min',
        toleranceUsed: 3,
        validTrackRange: '19-27 min'
    };

    const result = RuntimeAnalysisSchema.safeParse(validAnalysis);
    assert.strictEqual(result.success, true, 'Valid analysis should pass');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMappingSummarySchemaValid() {
    console.log('Test: MappingSummarySchema validates correctly');
    setup();

    const validSummary = {
        tracksMatched: 8,
        tracksSkipped: 4,
        episodesFound: 8,
        episodesExpected: 8
    };

    const result = MappingSummarySchema.safeParse(validSummary);
    assert.strictEqual(result.success, true, 'Valid summary should pass');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

console.log('━━━ Edge Case Tests ━━━\n');

function testEmptyMovieResults() {
    console.log('Test: buildTmdbMatchPrompts handles empty results');
    setup();

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'UNKNOWN_DISC',
        numTitles: 1,
        trackDurations: [120],
        movieResults: [],
        tvResults: []
    });

    assert.strictEqual(typeof prompts.system, 'string', 'Should still return system prompt');
    assert.strictEqual(typeof prompts.user, 'string', 'Should still return user prompt');
    assert.strictEqual(prompts.user.includes('UNKNOWN_DISC'), true, 'Should contain volume name');

    teardown();
    console.log('  ✓ PASS\n');
}

function testNullRuntimeAnalysis() {
    console.log('Test: buildTrackMappingPrompts handles null runtime analysis');
    setup();

    const metadata = {
        name: 'Unknown Show',
        season: 1,
        episodes: []
    };

    // Option C: Pass raw data, function handles formatting internally
    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 30 },
        runtimeAnalysis: null,
        lsdvdMetadata: null
    });

    assert.strictEqual(typeof prompts.system, 'string', 'Should still return system prompt');
    assert.strictEqual(typeof prompts.user, 'string', 'Should still return user prompt');
    assert.strictEqual(prompts.user.includes('Unknown Show'), true, 'Should contain show name');
    assert.strictEqual(prompts.user.includes('not available'), true, 'Should indicate missing runtime data');

    teardown();
    console.log('  ✓ PASS\n');
}

function testSpecialCharactersInVolumeName() {
    console.log('Test: Special characters in volume name are handled');
    setup();

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'DVD_"TEST"_<>&\'',
        numTitles: 1,
        trackDurations: [90],
        movieResults: [],
        tvResults: []
    });

    assert.strictEqual(prompts.user.includes('DVD_"TEST"_<>&\''), true, 'Special chars should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testLongOverviewTruncation() {
    console.log('Test: Long overviews are truncated in TMDB prompts');
    setup();

    const longOverview = 'A'.repeat(500); // 500 chars, should be truncated to 200

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'TEST',
        numTitles: 1,
        trackDurations: [90],
        movieResults: [
            { id: 1, title: 'Test', release_date: '2020-01-01', overview: longOverview }
        ],
        tvResults: []
    });

    // The overview in the prompt should be truncated
    const overviewMatch = prompts.user.match(/"overview":\s*"(A+)"/);
    if (overviewMatch) {
        assert.strictEqual(overviewMatch[1].length <= 200, true, 'Overview should be truncated to 200 chars');
    }

    teardown();
    console.log('  ✓ PASS\n');
}

function testBoundaryConfidenceValues() {
    console.log('Test: Boundary confidence values (0.0 and 1.0)');
    setup();

    const zeroConfidence = {
        selectedId: 1,
        selectedType: 'movie',
        confidence: 0.0,
        reasoning: 'No confidence'
    };

    const fullConfidence = {
        selectedId: 1,
        selectedType: 'movie',
        confidence: 1.0,
        reasoning: 'Full confidence'
    };

    const resultZero = TmdbMatchSchema.safeParse(zeroConfidence);
    const resultFull = TmdbMatchSchema.safeParse(fullConfidence);

    assert.strictEqual(resultZero.success, true, 'Confidence 0.0 should be valid');
    assert.strictEqual(resultFull.success, true, 'Confidence 1.0 should be valid');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildTrackMappingWithLsdvd() {
    console.log('Test: buildTrackMappingPrompts includes lsdvd metadata (Option C)');
    setup();

    const metadata = {
        name: 'Test Show',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 10 },
            { episode_number: 2, name: 'Episode 2', runtime: 10 }
        ]
    };

    const runtimeAnalysis = {
        min: 10,
        max: 10,
        avg: 10,
        variance: 0,
        tolerance: 2,
        format: 'short-form (web series, shorts)',
        episodeCount: 2
    };

    // Simulate lsdvd metadata
    const lsdvdMetadata = {
        discTitle: 'TEST_DISC',
        discId: 'abc123def456',
        longestTrack: 3,
        tracks: {
            1: { length: '00:10:00.000', durationMinutes: 10, chapters: 1, cells: 1, audioStreams: 2, subpictures: 1 },
            2: { length: '00:10:00.000', durationMinutes: 10, chapters: 1, cells: 1, audioStreams: 2, subpictures: 1 },
            3: { length: '00:22:00.000', durationMinutes: 22, chapters: 5, cells: 3, audioStreams: 2, subpictures: 1 }
        }
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 10, 2: 10, 3: 22 },
        runtimeAnalysis,
        lsdvdMetadata
    });

    assert.strictEqual(typeof prompts.user, 'string', 'User prompt should be a string');
    assert.strictEqual(prompts.user.includes('TEST_DISC'), true, 'User prompt should contain disc title');
    assert.strictEqual(prompts.user.includes('abc123def456'), true, 'User prompt should contain disc ID');
    assert.strictEqual(prompts.user.includes('Chapters'), true, 'User prompt should include chapter info');
    assert.strictEqual(prompts.user.includes('Audio'), true, 'User prompt should include audio stream info');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTrackMappingPromptContainsExtraTypeGuidance() {
    console.log('Test: Track mapping system prompt contains Play All and extraType guidance');
    setup();

    const systemPrompt = loadTemplate('track-mapping-system');

    // Check for Play All guidance
    assert.strictEqual(systemPrompt.includes('Play All'), true, 'System prompt should mention Play All');
    assert.strictEqual(systemPrompt.includes('extraType'), true, 'System prompt should mention extraType');
    assert.strictEqual(systemPrompt.includes('extraDescription'), true, 'System prompt should mention extraDescription');

    // Check for valid extra types
    assert.strictEqual(systemPrompt.includes('"other"'), true, 'System prompt should mention "other" extra type');
    assert.strictEqual(systemPrompt.includes('"featurette"'), true, 'System prompt should mention "featurette" extra type');
    assert.strictEqual(systemPrompt.includes('"deleted"'), true, 'System prompt should mention "deleted" extra type');

    teardown();
    console.log('  ✓ PASS\n');
}

function testOptionCNoPreLabeling() {
    console.log('Test: Option C prompts do NOT include pre-computed CANDIDATE/SKIP labels');
    setup();

    const metadata = {
        name: 'Test Show',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 10 }
        ]
    };

    const runtimeAnalysis = {
        min: 10,
        max: 10,
        avg: 10,
        variance: 0,
        tolerance: 2,
        format: 'short-form (web series, shorts)',
        episodeCount: 1
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 10, 2: 2, 3: 30 }, // Track 2 and 3 would have been labeled SKIP in old system
        runtimeAnalysis,
        lsdvdMetadata: null
    });

    // Option C should NOT include pre-computed CANDIDATE/SKIP labels
    assert.strictEqual(prompts.user.includes('→ CANDIDATE'), false, 'Should NOT contain pre-labeled CANDIDATE');
    assert.strictEqual(prompts.user.includes('→ SKIP'), false, 'Should NOT contain pre-labeled SKIP');

    // But should include soft guidance
    assert.strictEqual(prompts.user.includes('might'), true, 'Should include soft guidance language');
    assert.strictEqual(prompts.user.includes('could'), true, 'Should include suggestion language');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// MULTI-DISC CONTEXT TESTS
// ============================================================================

function testMultiDiscContextIncluded() {
    console.log('Test: Multi-disc context included for Disc 2+');
    setup();

    const metadata = {
        name: 'Ed, Edd n Eddy',
        season: 1,
        episodes: Array.from({ length: 26 }, (_, i) => ({
            episode_number: i + 1,
            name: `Episode ${i + 1}`,
            runtime: 11
        }))
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 136, 2: 22, 3: 22 },
        runtimeAnalysis: { min: 11, max: 11, avg: 11, variance: 0, tolerance: 2, format: 'short-form' },
        lsdvdMetadata: null,
        discNumber: 2  // Disc 2 - should trigger multi-disc context
    });

    // Should include multi-disc context section
    assert.strictEqual(prompts.user.includes('Multi-Disc Context'), true, 'Should include Multi-Disc Context section');
    assert.strictEqual(prompts.user.includes('This is Disc 2'), true, 'Should mention this is Disc 2');
    assert.strictEqual(prompts.user.includes('**NOT** start from Episode 1'), true, 'Should warn not to start from episode 1');
    assert.strictEqual(prompts.user.includes('episodeIndex=14'), true, 'Should provide example with offset');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMultiDiscContextNotIncludedForDisc1() {
    console.log('Test: Multi-disc context NOT included for Disc 1');
    setup();

    const metadata = {
        name: 'Test Show',
        season: 1,
        episodes: [{ episode_number: 1, name: 'Episode 1', runtime: 22 }]
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 22 },
        runtimeAnalysis: { min: 22, max: 22, avg: 22, variance: 0, tolerance: 2, format: 'half-hour' },
        lsdvdMetadata: null,
        discNumber: 1  // Disc 1 - should NOT have offset warning
    });

    // Should NOT include "NOT start from Episode 1" warning for Disc 1
    assert.strictEqual(prompts.user.includes('**NOT** start from Episode 1'), false, 'Should NOT warn about episode offset for Disc 1');
    // Should still mention it's Disc 1
    assert.strictEqual(prompts.user.includes('This is Disc 1'), true, 'Should mention this is Disc 1');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// QUERY EXTRACTION SCHEMA TESTS
// ============================================================================

function testQueryExtractionSchemaValid() {
    console.log('Test: QueryExtractionSchema validates correct data');
    setup();

    const validData = {
        searchQuery: 'Ed, Edd n Eddy',
        season: 1,
        disc: 2,
        year: 1999,
        isTV: true,
        isBoxSet: true,
        suggestedSearches: null,
        clarificationNeeded: null,
        confidence: 0.95,
        reasoning: 'Extracted title with season and disc numbers'
    };

    const result = QueryExtractionSchema.safeParse(validData);
    assert.strictEqual(result.success, true, 'Should validate correct QueryExtraction data');

    teardown();
    console.log('  ✓ PASS\n');
}

function testQueryExtractionSchemaWithSuggestedSearches() {
    console.log('Test: QueryExtractionSchema validates data with suggestedSearches');
    setup();

    const dataWithSuggestions = {
        searchQuery: 'The Lord of the Rings',
        season: null,
        disc: null,
        year: null,
        isTV: false,
        isBoxSet: false,
        suggestedSearches: [
            { query: 'Lord of the Rings', reason: 'without "The"' },
            { query: 'LOTR', reason: 'common abbreviation' }
        ],
        clarificationNeeded: null,
        confidence: 0.8,
        reasoning: 'Movie title extracted, provided alternatives for better search'
    };

    const result = QueryExtractionSchema.safeParse(dataWithSuggestions);
    assert.strictEqual(result.success, true, 'Should validate QueryExtraction with suggestedSearches');
    assert.strictEqual(result.data.suggestedSearches.length, 2, 'Should have 2 suggested searches');

    teardown();
    console.log('  ✓ PASS\n');
}

function testQueryExtractionSchemaConfidenceBounds() {
    console.log('Test: QueryExtractionSchema validates confidence boundary values');
    setup();

    const zeroConfidence = {
        searchQuery: 'Unknown Show',
        season: null,
        disc: null,
        year: null,
        isTV: false,
        isBoxSet: false,
        suggestedSearches: null,
        clarificationNeeded: 'Cannot determine if TV show or movie',
        confidence: 0.0,
        reasoning: 'Ambiguous query with low confidence'
    };

    const fullConfidence = {
        searchQuery: 'Breaking Bad',
        season: 5,
        disc: null,
        year: 2008,
        isTV: true,
        isBoxSet: false,
        suggestedSearches: null,
        clarificationNeeded: null,
        confidence: 1.0,
        reasoning: 'Well-known show with explicit season number'
    };

    const resultZero = QueryExtractionSchema.safeParse(zeroConfidence);
    const resultFull = QueryExtractionSchema.safeParse(fullConfidence);

    assert.strictEqual(resultZero.success, true, 'Confidence 0.0 should be valid');
    assert.strictEqual(resultFull.success, true, 'Confidence 1.0 should be valid');

    teardown();
    console.log('  ✓ PASS\n');
}

function testQueryExtractionSchemaWithClarification() {
    console.log('Test: QueryExtractionSchema validates clarificationNeeded field');
    setup();

    const needsClarification = {
        searchQuery: 'The Office',
        season: null,
        disc: 1,
        year: null,
        isTV: true,
        isBoxSet: true,
        suggestedSearches: [
            { query: 'The Office US', reason: 'US version' },
            { query: 'The Office UK', reason: 'UK original' }
        ],
        clarificationNeeded: 'US or UK version? Also, disc specified but no season - which season is this disc from?',
        confidence: 0.6,
        reasoning: 'Title is ambiguous between US/UK versions, disc without season needs clarification'
    };

    const result = QueryExtractionSchema.safeParse(needsClarification);
    assert.strictEqual(result.success, true, 'Should validate QueryExtraction with clarificationNeeded');
    assert.strictEqual(result.data.clarificationNeeded !== null, true, 'Should have clarificationNeeded');
    assert.strictEqual(result.data.clarificationNeeded.includes('US or UK'), true, 'Should contain clarification question');

    teardown();
    console.log('  ✓ PASS\n');
}

function testSuggestedSearchSchemaValid() {
    console.log('Test: SuggestedSearchSchema validates standalone');
    setup();

    const validSuggestion = {
        query: 'Avatar: The Way of Water',
        reason: 'Full title with subtitle'
    };

    const result = SuggestedSearchSchema.safeParse(validSuggestion);
    assert.strictEqual(result.success, true, 'Should validate correct SuggestedSearch data');
    assert.strictEqual(result.data.query, 'Avatar: The Way of Water', 'Query should be preserved');
    assert.strictEqual(result.data.reason, 'Full title with subtitle', 'Reason should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMultiDiscContextForDisc3Plus() {
    console.log('Test: Multi-disc context for Disc 3+ calculates different episode range');
    setup();

    const metadata = {
        name: 'Long Running Show',
        season: 1,
        episodes: Array.from({ length: 50 }, (_, i) => ({
            episode_number: i + 1,
            name: `Episode ${i + 1}`,
            runtime: 22
        }))
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 22, 2: 22, 3: 22 },
        runtimeAnalysis: { min: 22, max: 22, avg: 22, variance: 0, tolerance: 2, format: 'half-hour' },
        lsdvdMetadata: null,
        discNumber: 3  // Disc 3
    });

    // Should include multi-disc context for Disc 3
    assert.strictEqual(prompts.user.includes('This is Disc 3'), true, 'Should mention this is Disc 3');
    assert.strictEqual(prompts.user.includes('**NOT** start from Episode 1'), true, 'Should warn not to start from episode 1');
    // Episode range should be different from Disc 2
    assert.strictEqual(prompts.user.includes('episodeIndex'), true, 'Should include episodeIndex guidance');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMultiDiscContextNullDiscNumber() {
    console.log('Test: Multi-disc context absent when discNumber is null');
    setup();

    const metadata = {
        name: 'Test Show',
        season: 1,
        episodes: [{ episode_number: 1, name: 'Episode 1', runtime: 22 }]
    };

    const prompts = buildTrackMappingPrompts({
        metadata,
        trackDurations: { 1: 22 },
        runtimeAnalysis: { min: 22, max: 22, avg: 22, variance: 0, tolerance: 2, format: 'half-hour' },
        lsdvdMetadata: null,
        discNumber: null  // No disc number
    });

    // Should NOT include multi-disc context when discNumber is null
    assert.strictEqual(prompts.user.includes('Multi-Disc Context'), false, 'Should NOT include Multi-Disc Context when null');
    assert.strictEqual(prompts.user.includes('This is Disc'), false, 'Should NOT mention disc number');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// TMDB SELECTION CONTEXT TESTS
// ============================================================================

function testTmdbMatchPromptsWithExtractedInfo() {
    console.log('Test: buildTmdbMatchPrompts includes extractedInfo context');
    setup();

    const extractedInfo = {
        searchQuery: 'Breaking Bad',
        season: 3,
        disc: 1,
        year: 2008,
        isTV: true,
        isBoxSet: false,
        suggestedSearches: null,
        clarificationNeeded: null,
        confidence: 0.95,
        reasoning: 'Clear TV show query'
    };

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'BREAKING_BAD_S3_D1',
        numTitles: 8,
        trackDurations: [45, 47, 48, 46, 47, 45, 46, 48],
        movieResults: [],
        tvResults: [{ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', overview: 'A high school chemistry teacher...' }],
        userQuery: 'Breaking Bad season 3',
        extractedInfo
    });

    // Should include extracted info section
    assert.strictEqual(prompts.user.includes('Pre-Parsed Query Information'), true, 'Should include Pre-Parsed section');
    assert.strictEqual(prompts.user.includes('Breaking Bad'), true, 'Should include extracted title');
    assert.strictEqual(prompts.user.includes('Season**: 3'), true, 'Should include extracted season');
    assert.strictEqual(prompts.user.includes('TV Show'), true, 'Should indicate TV media type');
    assert.strictEqual(prompts.user.includes('95%'), true, 'Should include confidence percentage');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchPromptsWithLsdvdMetadata() {
    console.log('Test: buildTmdbMatchPrompts includes lsdvd metadata context');
    setup();

    const lsdvdMetadata = {
        discTitle: 'BREAKING_BAD_SEASON_3',
        discId: 'abc123xyz',
        longestTrack: 1,
        tracks: {
            1: { chapters: 5, audioStreams: 2, subpictures: 1 },
            2: { chapters: 4, audioStreams: 2, subpictures: 1 },
            3: { chapters: 3, audioStreams: 2, subpictures: 1 }
        }
    };

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'DVD_VOLUME',
        numTitles: 3,
        trackDurations: [45, 47, 48],
        movieResults: [],
        tvResults: [],
        lsdvdMetadata
    });

    // Should include lsdvd metadata section
    assert.strictEqual(prompts.user.includes('Disc Title (from lsdvd)'), true, 'Should include lsdvd disc title label');
    assert.strictEqual(prompts.user.includes('BREAKING_BAD_SEASON_3'), true, 'Should include disc title value');
    assert.strictEqual(prompts.user.includes('abc123xyz'), true, 'Should include disc ID');
    assert.strictEqual(prompts.user.includes('chapters'), true, 'Should include chapter counts');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchPromptsWithBoxSetFlag() {
    console.log('Test: buildTmdbMatchPrompts shows box set detection');
    setup();

    const extractedInfo = {
        searchQuery: 'Ed, Edd n Eddy',
        season: 1,
        disc: 2,
        year: null,
        isTV: true,
        isBoxSet: true,  // Box set detected
        suggestedSearches: null,
        clarificationNeeded: null,
        confidence: 0.9,
        reasoning: 'TV show with disc number indicates box set'
    };

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'EENE_S1_D2',
        numTitles: 12,
        trackDurations: [22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22],
        movieResults: [],
        tvResults: [{ id: 3123, name: 'Ed, Edd n Eddy', first_air_date: '1999-01-04', overview: 'Three best friends...' }],
        extractedInfo
    });

    // Should include box set flag
    assert.strictEqual(prompts.user.includes('Box Set'), true, 'Should indicate box set detection');
    assert.strictEqual(prompts.user.includes('multi-disc'), true, 'Should mention multi-disc');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchPromptsWithClarificationNeeded() {
    console.log('Test: buildTmdbMatchPrompts shows clarification needed');
    setup();

    const extractedInfo = {
        searchQuery: 'The Office',
        season: null,
        disc: 1,
        year: null,
        isTV: true,
        isBoxSet: true,
        suggestedSearches: [
            { query: 'The Office US', reason: 'US version' },
            { query: 'The Office UK', reason: 'UK version' }
        ],
        clarificationNeeded: 'US or UK version? Which season?',
        confidence: 0.5,
        reasoning: 'Ambiguous title'
    };

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'THE_OFFICE_D1',
        numTitles: 6,
        trackDurations: [22, 22, 22, 22, 22, 22],
        movieResults: [],
        tvResults: [],
        extractedInfo
    });

    // Should include clarification needed
    assert.strictEqual(prompts.user.includes('Clarification Needed'), true, 'Should show clarification needed label');
    assert.strictEqual(prompts.user.includes('US or UK'), true, 'Should include the clarification question');

    teardown();
    console.log('  ✓ PASS\n');
}

function testTmdbMatchPromptsDefaultsWithoutContext() {
    console.log('Test: buildTmdbMatchPrompts shows defaults when no context provided');
    setup();

    const prompts = buildTmdbMatchPrompts({
        volumeName: 'UNKNOWN_DISC',
        numTitles: 1,
        trackDurations: [120],
        movieResults: [],
        tvResults: []
        // No userQuery, extractedInfo, or lsdvdMetadata
    });

    // Should show default messages
    assert.strictEqual(prompts.user.includes('No user query provided'), true, 'Should indicate no user query');
    assert.strictEqual(prompts.user.includes('No pre-parsed query information'), true, 'Should indicate no extracted info');
    assert.strictEqual(prompts.user.includes('Extended disc metadata not available'), true, 'Should indicate no lsdvd');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// MAPPING VALIDATION SCHEMA TESTS
// ============================================================================

function testMappingConcernSchemaValid() {
    console.log('Test: MappingConcernSchema validates correct data');
    setup();

    const validConcern = {
        severity: 'warning',
        message: 'Episode numbers may be incorrect',
        suggestion: 'Verify episode titles match expected content'
    };

    const result = MappingConcernSchema.safeParse(validConcern);
    assert.strictEqual(result.success, true, 'Valid concern should pass validation');

    // Test with null suggestion
    const concernWithNullSuggestion = {
        severity: 'info',
        message: 'This is informational',
        suggestion: null
    };
    const nullResult = MappingConcernSchema.safeParse(concernWithNullSuggestion);
    assert.strictEqual(nullResult.success, true, 'Concern with null suggestion should be valid');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMappingConcernSchemaSeverityValues() {
    console.log('Test: MappingConcernSchema validates all severity levels');
    setup();

    const severities = ['info', 'warning', 'error'];
    severities.forEach(severity => {
        const concern = {
            severity,
            message: `Test ${severity}`,
            suggestion: null
        };
        const result = MappingConcernSchema.safeParse(concern);
        assert.strictEqual(result.success, true, `Severity "${severity}" should be valid`);
    });

    // Invalid severity should fail
    const invalidConcern = {
        severity: 'critical',
        message: 'Test',
        suggestion: null
    };
    const invalidResult = MappingConcernSchema.safeParse(invalidConcern);
    assert.strictEqual(invalidResult.success, false, 'Invalid severity should fail');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMappingValidationSchemaValid() {
    console.log('Test: MappingValidationSchema validates correct data');
    setup();

    const validValidation = {
        isValid: true,
        concerns: [],
        summary: 'Mapping looks correct for a multi-disc set',
        expectedOnDisc: 'Episodes 15-26 of Season 2',
        reasoning: 'The disc contains the second half of Season 2, which is expected for Disc 4 of a box set.'
    };

    const result = MappingValidationSchema.safeParse(validValidation);
    assert.strictEqual(result.success, true, 'Valid validation should pass');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMappingValidationSchemaWithConcerns() {
    console.log('Test: MappingValidationSchema validates with concerns array');
    setup();

    const validationWithConcerns = {
        isValid: false,
        concerns: [
            {
                severity: 'error',
                message: 'Episodes mapped to wrong season',
                suggestion: 'Verify the correct season was selected'
            },
            {
                severity: 'warning',
                message: 'Low confidence on track 3',
                suggestion: 'Review track 3 mapping manually'
            }
        ],
        summary: 'Several issues detected with the mapping',
        expectedOnDisc: null,
        reasoning: 'The episode titles do not match the expected content for Season 2.'
    };

    const result = MappingValidationSchema.safeParse(validationWithConcerns);
    assert.strictEqual(result.success, true, 'Validation with concerns should pass');
    assert.strictEqual(result.data.concerns.length, 2, 'Should have 2 concerns');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildMappingValidationPrompts() {
    console.log('Test: buildMappingValidationPrompts creates valid prompts');
    setup();

    const prompts = buildMappingValidationPrompts({
        volumeName: 'ED_EDD_N_EDDY_S2D3',
        numTitles: 8,
        trackDurations: { 1: 180, 2: 23, 3: 23, 4: 23, 5: 23, 6: 23, 7: 23, 8: 23 },
        userQuery: 'Ed Edd n Eddy season 2 disc 3',
        extractedInfo: {
            searchQuery: 'Ed, Edd n Eddy',
            season: 2,
            disc: 3,
            isTV: true,
            isBoxSet: true,
            confidence: 0.95
        },
        matchedTitle: 'Ed, Edd n Eddy',
        matchedType: 'tv',
        seasonNumber: 2,
        totalEpisodes: 26,
        mappingResults: {
            mappings: [
                { trackNum: 2, episodeIndex: 14, episodeEndIndex: 15, shouldSkip: false },
                { trackNum: 3, episodeIndex: 16, episodeEndIndex: 17, shouldSkip: false }
            ],
            summary: { tracksMatched: 6, tracksSkipped: 2 },
            overallConfidence: 0.92
        }
    });

    // Verify system prompt exists
    assert.ok(prompts.system.length > 0, 'System prompt should exist');
    assert.strictEqual(prompts.system.includes('DVD expert'), true, 'System prompt should identify role');
    assert.strictEqual(prompts.system.includes('Multi-Disc'), true, 'System prompt should mention multi-disc');

    // Verify user prompt contains expected sections
    assert.strictEqual(prompts.user.includes('Ed Edd n Eddy season 2 disc 3'), true, 'Should include user query');
    assert.strictEqual(prompts.user.includes('Ed, Edd n Eddy'), true, 'Should include matched title');
    assert.strictEqual(prompts.user.includes('26'), true, 'Should include total episodes');
    assert.strictEqual(prompts.user.includes('Box Set'), true, 'Should indicate box set');
    assert.strictEqual(prompts.user.includes('92%'), true, 'Should include overall confidence');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildMappingValidationPromptsMinimal() {
    console.log('Test: buildMappingValidationPrompts handles minimal data');
    setup();

    const prompts = buildMappingValidationPrompts({
        volumeName: 'UNKNOWN_DISC',
        numTitles: 1,
        trackDurations: { 1: 100 },
        matchedTitle: 'Movie Title',
        matchedType: 'movie',
        seasonNumber: null,
        totalEpisodes: 0,
        mappingResults: null
        // No userQuery, extractedInfo
    });

    assert.ok(prompts.system.length > 0, 'System prompt should exist');
    assert.ok(prompts.user.length > 0, 'User prompt should exist');
    assert.strictEqual(prompts.user.includes('No user query provided'), true, 'Should show default query message');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

try {
    // Prompt Loader Tests
    testLoadTemplate();
    testLoadTemplateNotFound();
    testInterpolateBasic();
    testInterpolateObjects();
    testInterpolateArrays();
    testInterpolateMissingVariables();
    testBuildTmdbMatchPrompts();
    testBuildTrackMappingPrompts();
    testTemplateCache();

    // Zod Schema Tests
    testTmdbMatchSchemaValid();
    testTmdbMatchSchemaWithNull();
    testTmdbMatchSchemaInvalidType();
    testTmdbMatchSchemaInvalidConfidence();
    testTrackMappingSchemaValid();
    testTrackMappingSchemaSkipped();
    testTrackMappingSchemaWithExtraType();
    testTrackMappingSchemaExtraTypeValidation();
    testTrackMappingResponseSchemaValid();
    testTrackMappingResponseSchemaMissingField();
    testRuntimeAnalysisSchemaValid();
    testMappingSummarySchemaValid();

    // Edge Case Tests
    testEmptyMovieResults();
    testNullRuntimeAnalysis();
    testSpecialCharactersInVolumeName();
    testLongOverviewTruncation();
    testBoundaryConfidenceValues();

    // Option C Tests (lsdvd and soft guidance)
    testBuildTrackMappingWithLsdvd();
    testOptionCNoPreLabeling();

    // Extra Type Tests (Play All, etc.)
    testTrackMappingPromptContainsExtraTypeGuidance();

    // Multi-Disc Context Tests
    testMultiDiscContextIncluded();
    testMultiDiscContextNotIncludedForDisc1();

    // QueryExtractionSchema Tests
    testQueryExtractionSchemaValid();
    testQueryExtractionSchemaWithSuggestedSearches();
    testQueryExtractionSchemaConfidenceBounds();
    testQueryExtractionSchemaWithClarification();
    testSuggestedSearchSchemaValid();

    // Additional Multi-Disc Context Tests
    testMultiDiscContextForDisc3Plus();
    testMultiDiscContextNullDiscNumber();

    // TMDB Selection Context Tests
    testTmdbMatchPromptsWithExtractedInfo();
    testTmdbMatchPromptsWithLsdvdMetadata();
    testTmdbMatchPromptsWithBoxSetFlag();
    testTmdbMatchPromptsWithClarificationNeeded();
    testTmdbMatchPromptsDefaultsWithoutContext();

    // Mapping Validation Schema Tests
    testMappingConcernSchemaValid();
    testMappingConcernSchemaSeverityValues();
    testMappingValidationSchemaValid();
    testMappingValidationSchemaWithConcerns();
    testBuildMappingValidationPrompts();
    testBuildMappingValidationPromptsMinimal();

    console.log('━'.repeat(60));
    console.log('  ✅ All prompt/schema tests passed!');
    console.log('━'.repeat(60));
    console.log('');

    process.exit(0);
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    teardown();
    process.exit(1);
}
