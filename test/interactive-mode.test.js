/**
 * Interactive Mode Tests
 *
 * Comprehensive tests for the enhanced interactive step-through mode.
 * These tests verify:
 * - Helper functions work correctly with various inputs
 * - Flow logic handles re-search, back navigation, approvals
 * - User choices (change start episode, edit tracks, etc.) work correctly
 * - All API/AI calls are mocked - we're testing flows, not external services
 */

const assert = require('assert');

// Enable test mode to get exports
process.env.JUICEIT_TEST_MODE = 'true';

// ============================================================================
// ENQUIRER MOCK SYSTEM
// ============================================================================

/**
 * Mock enquirer to simulate user input sequences
 * Each test can define a sequence of responses that will be returned
 * in order when Select.run() or Input.run() is called
 */
const enquirerMock = {
    responses: [],
    callIndex: 0,

    reset() {
        this.responses = [];
        this.callIndex = 0;
    },

    setResponses(responses) {
        this.responses = responses;
        this.callIndex = 0;
    },

    getNextResponse() {
        if (this.callIndex >= this.responses.length) {
            throw new Error(`Enquirer mock: No more responses defined (called ${this.callIndex + 1} times, only ${this.responses.length} responses defined)`);
        }
        return this.responses[this.callIndex++];
    }
};

// Mock the enquirer module
const mockEnquirer = {
    Select: class MockSelect {
        constructor(options) {
            this.options = options;
        }
        async run() {
            const response = enquirerMock.getNextResponse();
            // Find the value for the given choice name if it's a string
            if (typeof response === 'string' && this.options.choices) {
                const choice = this.options.choices.find(c =>
                    (typeof c === 'object' && c.name === response) ||
                    (typeof c === 'object' && c.value === response) ||
                    c === response
                );
                if (choice && typeof choice === 'object' && choice.value !== undefined) {
                    return choice.value;
                }
            }
            return response;
        }
    },
    Input: class MockInput {
        constructor(options) {
            this.options = options;
        }
        async run() {
            return enquirerMock.getNextResponse();
        }
    }
};

// Inject mock before requiring juiceit
require.cache[require.resolve('enquirer')] = {
    id: require.resolve('enquirer'),
    filename: require.resolve('enquirer'),
    loaded: true,
    exports: mockEnquirer
};

// Import the module (with test exports enabled)
const juiceit = require('../juiceit.js');

// ============================================================================
// API/AI MOCK SYSTEM
// ============================================================================

/**
 * Mock API responses for testing flows without real API calls
 */
const apiMocks = {
    lookupMetadata: null,
    aiMapTracks: null,

    reset() {
        this.lookupMetadata = null;
        this.aiMapTracks = null;
    }
};

// ============================================================================
// MOCK DATA FIXTURES
// ============================================================================

const mockTVMetadataShortForm = {
    type: 'tv',
    name: 'Ed, Edd n Eddy',
    year: '1999',
    season: 2,
    tmdbId: 12345,
    discNumber: 4,
    episodes: Array.from({ length: 26 }, (_, i) => ({
        episode_number: i + 1,
        name: `Episode ${i + 1} Title`,
        runtime: 11
    }))
};

const mockTVMetadataHalfHour = {
    type: 'tv',
    name: 'The Office',
    year: '2005',
    season: 3,
    tmdbId: 67890,
    discNumber: 2,
    episodes: Array.from({ length: 24 }, (_, i) => ({
        episode_number: i + 1,
        name: `Episode ${i + 1}`,
        runtime: 22
    }))
};

const mockMovieMetadata = {
    type: 'movie',
    name: 'The Matrix',
    year: '1999',
    tmdbId: 603
};

const mockAIMappingShortForm = {
    mappings: [
        { trackNum: 1, episodeIndex: 16, episodeEndIndex: 17, trackDuration: 22, confidence: 0.95, shouldSkip: false, reasoning: 'Episodes 17-18' },
        { trackNum: 2, episodeIndex: 18, episodeEndIndex: 19, trackDuration: 22, confidence: 0.92, shouldSkip: false, reasoning: 'Episodes 19-20' },
        { trackNum: 3, episodeIndex: 20, episodeEndIndex: 21, trackDuration: 22, confidence: 0.90, shouldSkip: false, reasoning: 'Episodes 21-22' },
        { trackNum: 4, episodeIndex: 22, episodeEndIndex: 23, trackDuration: 22, confidence: 0.88, shouldSkip: false, reasoning: 'Episodes 23-24' },
        { trackNum: 5, episodeIndex: 24, episodeEndIndex: 25, trackDuration: 22, confidence: 0.85, shouldSkip: false, reasoning: 'Episodes 25-26' },
        { trackNum: 6, trackDuration: 110, confidence: 0.99, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', reasoning: 'Play All compilation' },
        { trackNum: 7, trackDuration: 0, confidence: 1.0, shouldSkip: true, extraType: 'other', extraDescription: 'Menu', reasoning: 'Zero duration' }
    ],
    overallConfidence: 0.91,
    summary: { tracksMatched: 5, tracksSkipped: 2 }
};

const mockAIMappingHalfHour = {
    mappings: [
        { trackNum: 1, episodeIndex: 12, episodeEndIndex: null, trackDuration: 22, confidence: 0.95, shouldSkip: false, reasoning: 'Episode 13' },
        { trackNum: 2, episodeIndex: 13, episodeEndIndex: null, trackDuration: 22, confidence: 0.93, shouldSkip: false, reasoning: 'Episode 14' },
        { trackNum: 3, episodeIndex: 14, episodeEndIndex: null, trackDuration: 22, confidence: 0.91, shouldSkip: false, reasoning: 'Episode 15' },
        { trackNum: 4, episodeIndex: 15, episodeEndIndex: null, trackDuration: 22, confidence: 0.89, shouldSkip: false, reasoning: 'Episode 16' },
        { trackNum: 5, trackDuration: 88, confidence: 0.98, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', reasoning: 'Play All' }
    ],
    overallConfidence: 0.93,
    summary: { tracksMatched: 4, tracksSkipped: 1 }
};

const mockTrackDurationsShortForm = { 1: 22, 2: 22, 3: 22, 4: 22, 5: 22, 6: 110, 7: 0 };
const mockTrackDurationsHalfHour = { 1: 22, 2: 22, 3: 22, 4: 22, 5: 88 };

// ============================================================================
// TEST SETUP
// ============================================================================

function setup() {
    juiceit._initLogger();
    juiceit._setOptions({
        verbose: false,
        interactive: true,
        dryRun: true,
        mainOnly: false,
        searchQuery: 'Test Query'
    });
    juiceit._setGlobals({
        dvdTitleDurations: {},
        unrippableTracks: [],
        autoModeWarnings: []
    });
    enquirerMock.reset();
    apiMocks.reset();
}

function teardown() {
    enquirerMock.reset();
    apiMocks.reset();
}

// Suppress console output during tests
let originalConsoleLog;
function suppressConsole() {
    originalConsoleLog = console.log;
    console.log = () => {};
}
function restoreConsole() {
    if (originalConsoleLog) {
        console.log = originalConsoleLog;
    }
}

// ============================================================================
// PART 1: HELPER FUNCTION TESTS
// ============================================================================

console.log('\n━━━ Part 1: Helper Function Tests ━━━\n');

function testCountEpisodeLikeTracksShortForm() {
    console.log('Test: countEpisodeLikeTracks with short-form episodes (11 min)');
    setup();
    const count = juiceit.countEpisodeLikeTracks(mockTrackDurationsShortForm, mockTVMetadataShortForm);
    // 5 tracks at 22 min = 5 double-episode tracks = 10 episodes
    assert.strictEqual(count, 10, 'Should count 10 episodes (5 double-episode tracks)');
    teardown();
    console.log('  ✓ PASS\n');
}

function testCountEpisodeLikeTracksHalfHour() {
    console.log('Test: countEpisodeLikeTracks with half-hour episodes (22 min)');
    setup();
    const count = juiceit.countEpisodeLikeTracks(mockTrackDurationsHalfHour, mockTVMetadataHalfHour);
    assert.strictEqual(count, 4, 'Should count 4 episodes');
    teardown();
    console.log('  ✓ PASS\n');
}

function testCountEpisodeLikeTracksEmpty() {
    console.log('Test: countEpisodeLikeTracks with empty/null inputs');
    setup();
    assert.strictEqual(juiceit.countEpisodeLikeTracks(null, mockTVMetadataHalfHour), 0);
    assert.strictEqual(juiceit.countEpisodeLikeTracks({}, { episodes: [] }), 0);
    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildMappingFilenameVariants() {
    console.log('Test: buildMappingFilename for various mapping types');
    setup();

    // Single episode
    const single = juiceit.buildMappingFilename(
        { trackNum: 1, episodeIndex: 12, episodeEndIndex: null, shouldSkip: false },
        mockTVMetadataHalfHour
    );
    assert.ok(single.includes('s03e13'), 'Single episode should have correct number');

    // Multi-episode
    const multi = juiceit.buildMappingFilename(
        { trackNum: 1, episodeIndex: 16, episodeEndIndex: 17, shouldSkip: false },
        mockTVMetadataShortForm
    );
    assert.ok(multi.includes('s02e17-e18'), 'Multi-episode should have range');

    // Skipped
    const skipped = juiceit.buildMappingFilename(
        { trackNum: 6, episodeIndex: null, shouldSkip: true, extraType: 'other' },
        mockTVMetadataShortForm
    );
    assert.ok(skipped.includes('skip'), 'Skipped should indicate skip');

    // Unmapped
    const unmapped = juiceit.buildMappingFilename(
        { trackNum: 1, episodeIndex: null, shouldSkip: false },
        mockTVMetadataHalfHour
    );
    assert.ok(unmapped.includes('unmapped'), 'Unmapped should indicate unmapped');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildProposedMappingsFromAI() {
    console.log('Test: buildProposedMappingsFromAI transforms AI results correctly');
    setup();

    juiceit._setGlobals({
        unrippableTracks: [7],
        dvdTitleDurations: mockTrackDurationsShortForm
    });

    const mappings = juiceit.buildProposedMappingsFromAI(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        7,
        mockTrackDurationsShortForm
    );

    assert.strictEqual(mappings.length, 7, 'Should have 7 mappings');
    assert.ok(mappings[0].proposedName.includes('s02e17-e18'), 'First track should be episodes 17-18');
    assert.strictEqual(mappings[5].status, 'skip', 'Track 6 (Play All) should be skipped');
    assert.strictEqual(mappings[6].status, 'unrippable', 'Track 7 should be unrippable');
    assert.strictEqual(mappings[0].aiConfidence, 0.95, 'AI confidence should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testBuildProposedMappingsNoAI() {
    console.log('Test: buildProposedMappingsFromAI falls back when no AI result');
    setup();

    juiceit._setGlobals({ unrippableTracks: [], dvdTitleDurations: mockTrackDurationsHalfHour });

    const mappings = juiceit.buildProposedMappingsFromAI(
        null,
        mockTVMetadataHalfHour,
        5,
        mockTrackDurationsHalfHour
    );

    assert.strictEqual(mappings.length, 5, 'Should have 5 mappings');
    assert.ok(mappings[0].proposedName, 'Should have fallback proposed name');

    teardown();
    console.log('  ✓ PASS\n');
}

function testDisplayMappingTableOutput() {
    console.log('Test: displayMappingTable produces valid table output');
    setup();
    suppressConsole();

    let output = '';
    console.log = (msg) => { output += msg + '\n'; };

    juiceit.displayMappingTable(mockAIMappingShortForm.mappings, mockTVMetadataShortForm);

    restoreConsole();

    assert.ok(output.includes('Track'), 'Should have Track header');
    assert.ok(output.includes('E17-E18') || output.includes('E17'), 'Should show episode info');
    assert.ok(output.includes('95%'), 'Should show confidence');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 2: REVIEW TMDB MATCH FLOW TESTS (Phase 1 Menu)
// ============================================================================

console.log('━━━ Part 2: Review TMDB Match Flow Tests ━━━\n');

async function testReviewTmdbMatchAccept() {
    console.log('Test: reviewTmdbMatch - Accept selection');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['accept']);

    const result = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST_VOLUME', 'test query');

    restoreConsole();

    assert.strictEqual(result.action, 'accept', 'Should return accept action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTmdbMatchEditQuery() {
    console.log('Test: reviewTmdbMatch - Edit search query with new query');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['edit_query', 'Breaking Bad season 2']);

    const result = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST_VOLUME', 'old query');

    restoreConsole();

    assert.strictEqual(result.action, 'edit_query', 'Should return edit_query action');
    assert.strictEqual(result.newQuery, 'Breaking Bad season 2', 'Should include new query');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTmdbMatchEditQueryEmpty() {
    console.log('Test: reviewTmdbMatch - Edit query with empty input returns stay');
    setup();
    suppressConsole();

    // Edit query, then empty string should return 'stay' (not recurse)
    enquirerMock.setResponses(['edit_query', '']);

    const result = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST_VOLUME', 'old query');

    restoreConsole();

    assert.strictEqual(result.action, 'stay', 'Should return stay action on empty input');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTmdbMatchNoMatch() {
    console.log('Test: reviewTmdbMatch - Displays "no match" when metadata is null');
    setup();
    suppressConsole();

    let output = '';
    console.log = (msg) => { output += msg + '\n'; };

    enquirerMock.setResponses(['exit']);

    await juiceit.reviewTmdbMatch(null, 'TEST_VOLUME', 'bad query');

    restoreConsole();

    assert.ok(output.includes('No match found'), 'Should display no match message');
    assert.ok(output.includes('bad query'), 'Should show the failed query');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTmdbMatchExit() {
    console.log('Test: reviewTmdbMatch - Exit selection');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['exit']);

    const result = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST_VOLUME', 'test query');

    restoreConsole();

    assert.strictEqual(result.action, 'exit', 'Should return exit action');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 3: REVIEW TRACK MAPPING FLOW TESTS
// ============================================================================

console.log('━━━ Part 3: Review Track Mapping Flow Tests ━━━\n');

async function testReviewTrackMappingAccept() {
    console.log('Test: reviewTrackMapping - Accept all mappings');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['accept']);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'accept', 'Should return accept action');
    assert.ok(result.mappings, 'Should include mappings');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTrackMappingChangeStartEpisode() {
    console.log('Test: reviewTrackMapping - Change start episode');
    setup();
    suppressConsole();

    // Choose "Change start episode", then select episode 15, which returns its value
    enquirerMock.setResponses(['changeStart', 15]);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'changeStart', 'Should return changeStart action');
    assert.strictEqual(result.newStartEpisode, 15, 'Should have new start episode');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTrackMappingChangeStartCancel() {
    console.log('Test: reviewTrackMapping - Change start episode then cancel returns stay');
    setup();
    suppressConsole();

    // Choose change start, cancel - should return 'stay' (no recursion)
    enquirerMock.setResponses(['changeStart', 'cancel']);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'stay', 'Should return stay action after cancelling');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTrackMappingRemap() {
    console.log('Test: reviewTrackMapping - Request AI re-map');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['remap']);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'remap', 'Should return remap action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTrackMappingBack() {
    console.log('Test: reviewTrackMapping - Go back to TMDB match');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['back']);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'back', 'Should return back action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTrackMappingExit() {
    console.log('Test: reviewTrackMapping - Exit');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['exit']);

    const result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm,
        mockTVMetadataShortForm,
        mockTrackDurationsShortForm,
        null,
        null
    );

    restoreConsole();

    assert.strictEqual(result.action, 'exit', 'Should return exit action');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 4: EDIT INDIVIDUAL TRACK TESTS
// ============================================================================

console.log('━━━ Part 4: Edit Individual Track Tests ━━━\n');

async function testEditIndividualTrackReassign() {
    console.log('Test: editIndividualTrack - Reassign to different episode');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));

    // Select track 1, then reassign, then choose episode 20
    enquirerMock.setResponses([1, 'reassign', 20]);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    const track1 = result.find(m => m.trackNum === 1);
    assert.strictEqual(track1.episodeIndex, 19, 'Track 1 should be reassigned to episode index 19 (ep 20)');
    assert.strictEqual(track1.episodeEndIndex, null, 'Multi-episode should be cleared');
    assert.strictEqual(track1.shouldSkip, false, 'Should not be skipped');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testEditIndividualTrackEditFilename() {
    console.log('Test: editIndividualTrack - Edit track filename');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));

    // Select track 2, then edit name, then enter new name
    enquirerMock.setResponses([2, 'editName', 'My Custom Filename.mp4']);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    const track2 = result.find(m => m.trackNum === 2);
    assert.strictEqual(track2.proposedName, 'My Custom Filename.mp4', 'Should have custom filename');
    assert.strictEqual(track2.customFilename, true, 'Should be flagged as custom');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testEditIndividualTrackToggleSkip() {
    console.log('Test: editIndividualTrack - Toggle skip status');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));
    const originalSkipStatus = mappings[0].shouldSkip;

    // Select track 1, then toggle skip
    enquirerMock.setResponses([1, 'toggleSkip']);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    const track1 = result.find(m => m.trackNum === 1);
    assert.strictEqual(track1.shouldSkip, !originalSkipStatus, 'Skip status should be toggled');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testEditIndividualTrackUnmarkSkip() {
    console.log('Test: editIndividualTrack - Unmark previously skipped track');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));
    // Track 6 is marked as skip
    assert.strictEqual(mappings[5].shouldSkip, true, 'Track 6 should start as skipped');

    // Select track 6, then toggle skip (unmark)
    enquirerMock.setResponses([6, 'toggleSkip']);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    const track6 = result.find(m => m.trackNum === 6);
    assert.strictEqual(track6.shouldSkip, false, 'Track 6 should now be un-skipped');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testEditIndividualTrackBack() {
    console.log('Test: editIndividualTrack - Back without editing');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));
    const originalTrack1 = JSON.stringify(mappings[0]);

    // Select back immediately
    enquirerMock.setResponses(['back']);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    assert.strictEqual(JSON.stringify(result[0]), originalTrack1, 'Mappings should be unchanged');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testEditIndividualTrackSelectThenBack() {
    console.log('Test: editIndividualTrack - Select track then back');
    setup();
    suppressConsole();

    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));

    // Select track 1, then back from edit menu
    enquirerMock.setResponses([1, 'back']);

    const result = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    restoreConsole();

    // Should return unchanged mappings
    assert.strictEqual(result.length, mappings.length, 'Should return same number of mappings');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 5: REVIEW FINAL MAPPINGS TESTS
// ============================================================================

console.log('━━━ Part 5: Review Final Mappings Tests ━━━\n');

async function testReviewFinalMappingsRip() {
    console.log('Test: reviewFinalMappings - Start ripping');
    setup();
    suppressConsole();

    const proposedMappings = [
        { trackNum: 1, status: 'pending', proposedName: 'Test - s01e01.mp4' },
        { trackNum: 2, status: 'skip', proposedName: '(skip)' }
    ];

    enquirerMock.setResponses(['rip']);

    const result = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataHalfHour);

    restoreConsole();

    assert.strictEqual(result.action, 'rip', 'Should return rip action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewFinalMappingsEdit() {
    console.log('Test: reviewFinalMappings - Edit mappings');
    setup();
    suppressConsole();

    const proposedMappings = [
        { trackNum: 1, status: 'pending', proposedName: 'Test - s01e01.mp4' }
    ];

    enquirerMock.setResponses(['edit']);

    const result = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataHalfHour);

    restoreConsole();

    assert.strictEqual(result.action, 'edit', 'Should return edit action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewFinalMappingsBack() {
    console.log('Test: reviewFinalMappings - Go back to track mapping');
    setup();
    suppressConsole();

    const proposedMappings = [
        { trackNum: 1, status: 'pending', proposedName: 'Test - s01e01.mp4' }
    ];

    enquirerMock.setResponses(['back']);

    const result = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataHalfHour);

    restoreConsole();

    assert.strictEqual(result.action, 'back', 'Should return back action');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewFinalMappingsExit() {
    console.log('Test: reviewFinalMappings - Exit');
    setup();
    suppressConsole();

    const proposedMappings = [
        { trackNum: 1, status: 'pending', proposedName: 'Test - s01e01.mp4' }
    ];

    enquirerMock.setResponses(['exit']);

    const result = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataHalfHour);

    restoreConsole();

    assert.strictEqual(result.action, 'exit', 'Should return exit action');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 6: EDGE CASES AND ERROR HANDLING
// ============================================================================

console.log('━━━ Part 6: Edge Cases and Error Handling ━━━\n');

function testZeroDurationTracksUnrippable() {
    console.log('Test: Zero duration tracks are marked unrippable');
    setup();

    const trackDurations = { 1: 22, 2: 0, 3: 22 };
    juiceit._setGlobals({ unrippableTracks: [], dvdTitleDurations: trackDurations });

    const mappings = juiceit.buildProposedMappingsFromAI(null, mockTVMetadataHalfHour, 3, trackDurations);

    const track2 = mappings.find(m => m.trackNum === 2);
    assert.strictEqual(track2.status, 'unrippable', 'Zero duration should be unrippable');

    teardown();
    console.log('  ✓ PASS\n');
}

function testGlobalUnrippableTracksRespected() {
    console.log('Test: Global unrippable tracks list is respected');
    setup();

    juiceit._setGlobals({
        unrippableTracks: [2, 3],
        dvdTitleDurations: mockTrackDurationsHalfHour
    });

    const mappings = juiceit.buildProposedMappingsFromAI(
        mockAIMappingHalfHour,
        mockTVMetadataHalfHour,
        5,
        mockTrackDurationsHalfHour
    );

    assert.strictEqual(mappings.find(m => m.trackNum === 2).status, 'unrippable');
    assert.strictEqual(mappings.find(m => m.trackNum === 3).status, 'unrippable');

    teardown();
    console.log('  ✓ PASS\n');
}

function testCustomFilenamePreserved() {
    console.log('Test: User-edited custom filename is preserved');
    setup();

    const mappingWithCustom = JSON.parse(JSON.stringify(mockAIMappingShortForm));
    mappingWithCustom.mappings[0].customFilename = true;
    mappingWithCustom.mappings[0].proposedName = 'User Custom Name.mp4';

    juiceit._setGlobals({ unrippableTracks: [], dvdTitleDurations: mockTrackDurationsShortForm });

    const mappings = juiceit.buildProposedMappingsFromAI(
        mappingWithCustom,
        mockTVMetadataShortForm,
        7,
        mockTrackDurationsShortForm
    );

    assert.strictEqual(mappings[0].proposedName, 'User Custom Name.mp4', 'Custom name should be preserved');

    teardown();
    console.log('  ✓ PASS\n');
}

function testMovieMetadataHandling() {
    console.log('Test: Movie metadata is handled (no episodes)');
    setup();

    juiceit._setGlobals({ unrippableTracks: [], dvdTitleDurations: { 1: 136, 2: 5 } });

    const mappings = juiceit.buildProposedMappingsFromAI(
        null,
        mockMovieMetadata,
        2,
        { 1: 136, 2: 5 }
    );

    assert.strictEqual(mappings.length, 2);
    assert.ok(mappings[0].proposedName.includes('Matrix'), 'Should include movie name');

    teardown();
    console.log('  ✓ PASS\n');
}

async function testReviewTmdbMatchWithMovieMetadata() {
    console.log('Test: reviewTmdbMatch displays movie metadata correctly');
    setup();
    suppressConsole();

    let output = '';
    console.log = (msg) => { output += msg + '\n'; };

    enquirerMock.setResponses(['accept']);

    await juiceit.reviewTmdbMatch(mockMovieMetadata, 'TEST_VOLUME', 'The Matrix');

    restoreConsole();

    assert.ok(output.includes('Matrix'), 'Should display movie name');
    assert.ok(output.includes('1999'), 'Should display year');

    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// PART 7: MULTI-STEP FLOW INTEGRATION TESTS
// ============================================================================

console.log('━━━ Part 7: Multi-Step Flow Integration Tests ━━━\n');

async function testFlowAcceptAllSteps() {
    console.log('Test: Full flow - Accept at every step');
    setup();
    suppressConsole();

    // Step 1: Accept TMDB match
    // Step 2: Accept track mapping
    // Step 3: Start ripping
    enquirerMock.setResponses(['accept', 'accept', 'rip']);

    // We can't easily test interactiveStepThrough without mocking lookupMetadata and aiMapTracks
    // But we can verify the individual review functions chain correctly

    const result1 = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST', 'test query');
    assert.strictEqual(result1.action, 'accept');

    const result2 = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, null
    );
    assert.strictEqual(result2.action, 'accept');

    const proposedMappings = [{ trackNum: 1, status: 'pending', proposedName: 'test.mp4' }];
    const result3 = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataShortForm);
    assert.strictEqual(result3.action, 'rip');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowBackFromTrackMappingToTmdb() {
    console.log('Test: Flow - Back from track mapping to TMDB review');
    setup();
    suppressConsole();

    // First call: back
    // Second call (after going back): accept
    enquirerMock.setResponses(['back', 'accept']);

    const result1 = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, null
    );
    assert.strictEqual(result1.action, 'back', 'First call should return back');

    // Simulate going back and accepting at TMDB review
    const result2 = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST', 'test query');
    assert.strictEqual(result2.action, 'accept', 'Should accept after going back');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowBackFromFinalToTrackMapping() {
    console.log('Test: Flow - Back from final review to track mapping');
    setup();
    suppressConsole();

    enquirerMock.setResponses(['back', 'accept']);

    const proposedMappings = [{ trackNum: 1, status: 'pending', proposedName: 'test.mp4' }];

    const result1 = await juiceit.reviewFinalMappings(proposedMappings, mockTVMetadataShortForm);
    assert.strictEqual(result1.action, 'back', 'Should return back');

    const result2 = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, null
    );
    assert.strictEqual(result2.action, 'accept', 'Should accept after going back');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowEditQueryThenAccept() {
    console.log('Test: Flow - Edit query then accept new results');
    setup();
    suppressConsole();

    // Edit query with new query, then accept
    enquirerMock.setResponses(['edit_query', 'New Show Name', 'accept']);

    const result1 = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST', 'old query');
    assert.strictEqual(result1.action, 'edit_query');
    assert.strictEqual(result1.newQuery, 'New Show Name');

    // Simulate getting new results and accepting
    const result2 = await juiceit.reviewTmdbMatch(mockTVMetadataHalfHour, 'TEST', 'New Show Name');
    assert.strictEqual(result2.action, 'accept');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowChangeStartEpisodeThenAccept() {
    console.log('Test: Flow - Change start episode then accept');
    setup();
    suppressConsole();

    // Change start episode, then accept (simulating re-map with new start)
    enquirerMock.setResponses(['changeStart', 10, 'accept']);

    const result1 = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, null
    );
    assert.strictEqual(result1.action, 'changeStart');
    assert.strictEqual(result1.newStartEpisode, 10);

    // Simulate re-mapping with new start and accepting
    const result2 = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, 10 // startEpisodeOverride
    );
    assert.strictEqual(result2.action, 'accept');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowEditTrackThenAccept() {
    console.log('Test: Flow - Edit individual track then accept');
    setup();
    suppressConsole();

    // Edit track flow: select editTrack, select track 1, reassign to ep 5, then accept
    // Note: reviewTrackMapping calls editIndividualTrack and loops back, so we simulate the full flow
    const mappings = JSON.parse(JSON.stringify(mockAIMappingShortForm.mappings));

    enquirerMock.setResponses([1, 'reassign', 5]);

    const editedMappings = await juiceit.editIndividualTrack(mappings, mockTVMetadataShortForm);

    const track1 = editedMappings.find(m => m.trackNum === 1);
    assert.strictEqual(track1.episodeIndex, 4, 'Track should be reassigned to episode index 4 (ep 5)');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

async function testFlowExitAtAnyPoint() {
    console.log('Test: Flow - Exit works at every review point');
    setup();
    suppressConsole();

    // Test exit at TMDB match
    enquirerMock.setResponses(['exit']);
    let result = await juiceit.reviewTmdbMatch(mockTVMetadataShortForm, 'TEST', 'test query');
    assert.strictEqual(result.action, 'exit', 'Should exit at TMDB match');

    // Test exit at track mapping
    enquirerMock.setResponses(['exit']);
    result = await juiceit.reviewTrackMapping(
        mockAIMappingShortForm, mockTVMetadataShortForm,
        mockTrackDurationsShortForm, null, null
    );
    assert.strictEqual(result.action, 'exit', 'Should exit at track mapping');

    // Test exit at final review
    enquirerMock.setResponses(['exit']);
    result = await juiceit.reviewFinalMappings(
        [{ trackNum: 1, status: 'pending', proposedName: 'test.mp4' }],
        mockTVMetadataShortForm
    );
    assert.strictEqual(result.action, 'exit', 'Should exit at final review');

    restoreConsole();
    teardown();
    console.log('  ✓ PASS\n');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
    try {
        // Part 1: Helper Functions
        testCountEpisodeLikeTracksShortForm();
        testCountEpisodeLikeTracksHalfHour();
        testCountEpisodeLikeTracksEmpty();
        testBuildMappingFilenameVariants();
        testBuildProposedMappingsFromAI();
        testBuildProposedMappingsNoAI();
        testDisplayMappingTableOutput();

        // Part 2: Review TMDB Match (Phase 1)
        await testReviewTmdbMatchAccept();
        await testReviewTmdbMatchEditQuery();
        await testReviewTmdbMatchEditQueryEmpty();
        await testReviewTmdbMatchNoMatch();
        await testReviewTmdbMatchExit();

        // Part 3: Review Track Mapping
        await testReviewTrackMappingAccept();
        await testReviewTrackMappingChangeStartEpisode();
        await testReviewTrackMappingChangeStartCancel();
        await testReviewTrackMappingRemap();
        await testReviewTrackMappingBack();
        await testReviewTrackMappingExit();

        // Part 4: Edit Individual Track
        await testEditIndividualTrackReassign();
        await testEditIndividualTrackEditFilename();
        await testEditIndividualTrackToggleSkip();
        await testEditIndividualTrackUnmarkSkip();
        await testEditIndividualTrackBack();
        await testEditIndividualTrackSelectThenBack();

        // Part 5: Review Final Mappings
        await testReviewFinalMappingsRip();
        await testReviewFinalMappingsEdit();
        await testReviewFinalMappingsBack();
        await testReviewFinalMappingsExit();

        // Part 6: Edge Cases
        testZeroDurationTracksUnrippable();
        testGlobalUnrippableTracksRespected();
        testCustomFilenamePreserved();
        testMovieMetadataHandling();
        await testReviewTmdbMatchWithMovieMetadata();

        // Part 7: Multi-Step Flow Integration
        await testFlowAcceptAllSteps();
        await testFlowBackFromTrackMappingToTmdb();
        await testFlowBackFromFinalToTrackMapping();
        await testFlowEditQueryThenAccept();
        await testFlowChangeStartEpisodeThenAccept();
        await testFlowEditTrackThenAccept();
        await testFlowExitAtAnyPoint();

        console.log('━'.repeat(60));
        console.log('  ✅ All interactive mode tests passed!');
        console.log('━'.repeat(60));
        console.log('');

        process.exit(0);
    } catch (error) {
        restoreConsole();
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        teardown();
        process.exit(1);
    }
}

runAllTests();
