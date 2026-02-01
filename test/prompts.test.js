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
    buildTrackMappingPrompts
} = require('../prompts/loader');

const {
    TmdbMatchSchema,
    TrackMappingSchema,
    RuntimeAnalysisSchema,
    MappingSummarySchema,
    TrackMappingResponseSchema
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
