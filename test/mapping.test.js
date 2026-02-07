/**
 * Mapping Module Tests
 *
 * Tests for lib/mapping.js functionality including:
 * - buildProposedMappingsFromAI()
 * - --main-only flag behavior
 * - --rip-all flag behavior
 * - Extra track handling (Play All, featurettes, etc.)
 */

const assert = require('assert');
const mapping = require('../lib/mapping');

console.log('\n━━━ Mapping Module Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test: Default behavior - skip Play All, rip other extras
// ═══════════════════════════════════════════════════════════════════════════

function testDefaultBehavior() {
    console.log('Test: Default behavior - skip Play All, rip other extras');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 22, season_number: 1 },
            { episode_number: 2, name: 'Episode 2', runtime: 22, season_number: 1 }
        ]
    };

    const aiMappingResult = {
        mappings: [
            { trackNum: 1, episodeIndex: 0, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 1' },
            { trackNum: 2, episodeIndex: 1, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 2' },
            { trackNum: 3, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', confidence: 0.90, reasoning: 'Play All compilation' },
            { trackNum: 4, shouldSkip: true, extraType: 'featurette', extraDescription: 'Behind the Scenes', confidence: 0.85, reasoning: 'Bonus featurette' }
        ]
    };

    const trackDurations = { 1: 22, 2: 22, 3: 44, 4: 5 };

    const result = mapping.buildProposedMappingsFromAI(
        aiMappingResult,
        metadata,
        4,
        trackDurations,
        { mainOnly: false, ripAll: false, unrippableTracks: [] }
    );

    // Episode tracks should be mapped
    assert.strictEqual(result[0].status, 'pending', 'Track 1 (episode) should be pending');
    assert(result[0].proposedName.includes('s01e01'), 'Track 1 should be mapped to episode 1');

    assert.strictEqual(result[1].status, 'pending', 'Track 2 (episode) should be pending');
    assert(result[1].proposedName.includes('s01e02'), 'Track 2 should be mapped to episode 2');

    // Play All should be skipped (default behavior)
    assert.strictEqual(result[2].status, 'skip', 'Track 3 (Play All) should be skipped by default');
    assert(result[2].proposedName.includes('will skip'), 'Track 3 should show skip message');

    // Featurette should be ripped
    assert.strictEqual(result[3].status, 'pending', 'Track 4 (featurette) should be pending');
    assert(result[3].proposedName.includes('featurette'), 'Track 4 should be mapped to featurette');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: --rip-all flag - rip Play All tracks
// ═══════════════════════════════════════════════════════════════════════════

function testRipAllBehavior() {
    console.log('Test: --rip-all flag - rip Play All tracks');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 22, season_number: 1 }
        ]
    };

    const aiMappingResult = {
        mappings: [
            { trackNum: 1, episodeIndex: 0, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 1' },
            { trackNum: 2, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', confidence: 0.90, reasoning: 'Play All compilation' },
            { trackNum: 3, shouldSkip: true, extraType: 'featurette', extraDescription: 'Behind the Scenes', confidence: 0.85, reasoning: 'Bonus featurette' }
        ]
    };

    const trackDurations = { 1: 22, 2: 22, 3: 5 };

    const result = mapping.buildProposedMappingsFromAI(
        aiMappingResult,
        metadata,
        3,
        trackDurations,
        { mainOnly: false, ripAll: true, unrippableTracks: [] }
    );

    // Episode should be mapped
    assert.strictEqual(result[0].status, 'pending', 'Track 1 (episode) should be pending');

    // Play All should be ripped with --rip-all
    assert.strictEqual(result[1].status, 'pending', 'Track 2 (Play All) should be pending with --rip-all');
    assert(result[1].proposedName.includes('other'), 'Track 2 should be mapped to other type');
    assert(result[1].aiReasoning.includes('--rip-all mode'), 'Track 2 reasoning should mention --rip-all');

    // Featurette should still be ripped
    assert.strictEqual(result[2].status, 'pending', 'Track 3 (featurette) should be pending');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: --main-only flag - skip all extras
// ═══════════════════════════════════════════════════════════════════════════

function testMainOnlyBehavior() {
    console.log('Test: --main-only flag - skip all extras');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 22, season_number: 1 }
        ]
    };

    const aiMappingResult = {
        mappings: [
            { trackNum: 1, episodeIndex: 0, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 1' },
            { trackNum: 2, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', confidence: 0.90, reasoning: 'Play All compilation' },
            { trackNum: 3, shouldSkip: true, extraType: 'featurette', extraDescription: 'Behind the Scenes', confidence: 0.85, reasoning: 'Bonus featurette' }
        ]
    };

    const trackDurations = { 1: 22, 2: 22, 3: 5 };

    const result = mapping.buildProposedMappingsFromAI(
        aiMappingResult,
        metadata,
        3,
        trackDurations,
        { mainOnly: true, ripAll: false, unrippableTracks: [] }
    );

    // Episode should be mapped
    assert.strictEqual(result[0].status, 'pending', 'Track 1 (episode) should be pending');

    // All extras should be skipped with --main-only
    assert.strictEqual(result[1].status, 'skip', 'Track 2 (Play All) should be skipped with --main-only');
    assert(result[1].aiReasoning.includes('--main-only mode'), 'Track 2 reasoning should mention --main-only');

    assert.strictEqual(result[2].status, 'skip', 'Track 3 (featurette) should be skipped with --main-only');
    assert(result[2].aiReasoning.includes('--main-only mode'), 'Track 3 reasoning should mention --main-only');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: --main-only overrides --rip-all
// ═══════════════════════════════════════════════════════════════════════════

function testMainOnlyOverridesRipAll() {
    console.log('Test: --main-only overrides --rip-all');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 22, season_number: 1 }
        ]
    };

    const aiMappingResult = {
        mappings: [
            { trackNum: 1, episodeIndex: 0, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 1' },
            { trackNum: 2, shouldSkip: true, extraType: 'other', extraDescription: 'Play All', confidence: 0.90, reasoning: 'Play All compilation' }
        ]
    };

    const trackDurations = { 1: 22, 2: 22 };

    // Both flags set - mainOnly should win
    const result = mapping.buildProposedMappingsFromAI(
        aiMappingResult,
        metadata,
        2,
        trackDurations,
        { mainOnly: true, ripAll: true, unrippableTracks: [] }
    );

    // Episode should be mapped
    assert.strictEqual(result[0].status, 'pending', 'Track 1 (episode) should be pending');

    // Extra should be skipped (mainOnly wins)
    assert.strictEqual(result[1].status, 'skip', 'Track 2 should be skipped when both mainOnly and ripAll are true');
    assert(result[1].aiReasoning.includes('--main-only mode'), 'Reasoning should mention --main-only, not --rip-all');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Non-'other' extras are ripped by default
// ═══════════════════════════════════════════════════════════════════════════

function testNonOtherExtrasRipped() {
    console.log('Test: Non-other extras (featurettes, deleted scenes) are ripped by default');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Episode 1', runtime: 22, season_number: 1 }
        ]
    };

    const aiMappingResult = {
        mappings: [
            { trackNum: 1, episodeIndex: 0, shouldSkip: false, confidence: 0.95, reasoning: 'Episode 1' },
            { trackNum: 2, shouldSkip: true, extraType: 'featurette', confidence: 0.90, reasoning: 'Featurette' },
            { trackNum: 3, shouldSkip: true, extraType: 'deleted', confidence: 0.85, reasoning: 'Deleted scene' },
            { trackNum: 4, shouldSkip: true, extraType: 'interview', confidence: 0.80, reasoning: 'Interview' }
        ]
    };

    const trackDurations = { 1: 22, 2: 5, 3: 3, 4: 10 };

    const result = mapping.buildProposedMappingsFromAI(
        aiMappingResult,
        metadata,
        4,
        trackDurations,
        { mainOnly: false, ripAll: false, unrippableTracks: [] }
    );

    // All non-'other' extras should be ripped
    assert.strictEqual(result[1].status, 'pending', 'Track 2 (featurette) should be pending');
    assert(result[1].proposedName.includes('featurette'), 'Track 2 should include featurette type');

    assert.strictEqual(result[2].status, 'pending', 'Track 3 (deleted) should be pending');
    assert(result[2].proposedName.includes('deleted'), 'Track 3 should include deleted type');

    assert.strictEqual(result[3].status, 'pending', 'Track 4 (interview) should be pending');
    assert(result[3].proposedName.includes('interview'), 'Track 4 should include interview type');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

try {
    testDefaultBehavior();
    testRipAllBehavior();
    testMainOnlyBehavior();
    testMainOnlyOverridesRipAll();
    testNonOtherExtrasRipped();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ All mapping module tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}
