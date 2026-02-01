/**
 * Tests for Runtime Analysis and Core Functions
 *
 * Tests the analyzeEpisodeRuntimes function and related logic
 * using fixture data for various show types.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Since juiceit.js doesn't export functions, we'll recreate the function for testing
// This should match the implementation in juiceit.js exactly

/**
 * Analyze episode metadata to derive show-specific runtime characteristics
 * (Copied from juiceit.js for testing)
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

// Load fixture
function loadFixture(name) {
    const fixturePath = path.join(__dirname, 'fixtures', name);
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

// ============================================================================
// RUNTIME ANALYSIS TESTS
// ============================================================================

console.log('\n━━━ Runtime Analysis Tests ━━━\n');

function testShortFormShow() {
    console.log('Test: Short-form show (Look Around You style, 9-10 min)');

    const fixture = loadFixture('episodes-short-form.json');
    const result = analyzeEpisodeRuntimes(fixture.episodes);

    assert.notStrictEqual(result, null, 'Result should not be null');
    assert.strictEqual(result.min, fixture.expected.min, `Min should be ${fixture.expected.min}`);
    assert.strictEqual(result.max, fixture.expected.max, `Max should be ${fixture.expected.max}`);
    assert.strictEqual(result.avg, fixture.expected.avg, `Avg should be ${fixture.expected.avg}`);
    assert.strictEqual(result.variance, fixture.expected.variance, `Variance should be ${fixture.expected.variance}`);
    assert.strictEqual(result.tolerance, fixture.expected.tolerance, `Tolerance should be ${fixture.expected.tolerance}`);
    assert.strictEqual(result.format, fixture.expected.format, `Format should be "${fixture.expected.format}"`);
    assert.strictEqual(result.episodeCount, fixture.episodes.length, 'Episode count should match');

    console.log('  ✓ PASS\n');
}

function testSitcomShow() {
    console.log('Test: Half-hour sitcom (The Office style, 21-24 min)');

    const fixture = loadFixture('episodes-sitcom.json');
    const result = analyzeEpisodeRuntimes(fixture.episodes);

    assert.notStrictEqual(result, null, 'Result should not be null');
    assert.strictEqual(result.min, fixture.expected.min, `Min should be ${fixture.expected.min}`);
    assert.strictEqual(result.max, fixture.expected.max, `Max should be ${fixture.expected.max}`);
    assert.strictEqual(result.avg, fixture.expected.avg, `Avg should be ${fixture.expected.avg}`);
    assert.strictEqual(result.variance, fixture.expected.variance, `Variance should be ${fixture.expected.variance}`);
    assert.strictEqual(result.tolerance, fixture.expected.tolerance, `Tolerance should be ${fixture.expected.tolerance}`);
    assert.strictEqual(result.format, fixture.expected.format, `Format should be "${fixture.expected.format}"`);

    console.log('  ✓ PASS\n');
}

function testDramaShow() {
    console.log('Test: Hour-long drama (Breaking Bad style, 45-58 min)');

    const fixture = loadFixture('episodes-drama.json');
    const result = analyzeEpisodeRuntimes(fixture.episodes);

    assert.notStrictEqual(result, null, 'Result should not be null');
    assert.strictEqual(result.min, fixture.expected.min, `Min should be ${fixture.expected.min}`);
    assert.strictEqual(result.max, fixture.expected.max, `Max should be ${fixture.expected.max}`);
    assert.strictEqual(result.avg, fixture.expected.avg, `Avg should be ${fixture.expected.avg}`);
    assert.strictEqual(result.variance, fixture.expected.variance, `Variance should be ${fixture.expected.variance}`);
    assert.strictEqual(result.tolerance, fixture.expected.tolerance, `Tolerance should be ${fixture.expected.tolerance}`);
    assert.strictEqual(result.format, fixture.expected.format, `Format should be "${fixture.expected.format}"`);

    console.log('  ✓ PASS\n');
}

function testMixedMissingRuntimes() {
    console.log('Test: Episodes with missing runtime data');

    const fixture = loadFixture('episodes-mixed-missing.json');
    const result = analyzeEpisodeRuntimes(fixture.episodes);

    assert.notStrictEqual(result, null, 'Result should not be null');
    assert.strictEqual(result.min, fixture.expected.min, `Min should be ${fixture.expected.min}`);
    assert.strictEqual(result.max, fixture.expected.max, `Max should be ${fixture.expected.max}`);
    assert.strictEqual(result.avg, fixture.expected.avg, `Avg should be ${fixture.expected.avg}`);
    // Episode count should be original count, not filtered count
    assert.strictEqual(result.episodeCount, fixture.episodes.length, 'Episode count should be original length');
    // Runtimes array should only contain valid runtimes
    assert.strictEqual(result.runtimes.length, 3, 'Only 3 valid runtimes should be counted');

    console.log('  ✓ PASS\n');
}

function testEmptyEpisodes() {
    console.log('Test: Empty episodes array');

    const result = analyzeEpisodeRuntimes([]);
    assert.strictEqual(result, null, 'Empty array should return null');

    console.log('  ✓ PASS\n');
}

function testNullEpisodes() {
    console.log('Test: Null episodes');

    const result = analyzeEpisodeRuntimes(null);
    assert.strictEqual(result, null, 'Null should return null');

    console.log('  ✓ PASS\n');
}

function testUndefinedEpisodes() {
    console.log('Test: Undefined episodes');

    const result = analyzeEpisodeRuntimes(undefined);
    assert.strictEqual(result, null, 'Undefined should return null');

    console.log('  ✓ PASS\n');
}

function testAllZeroRuntimes() {
    console.log('Test: All episodes with zero runtime');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 0 },
        { episode_number: 2, name: 'Ep 2', runtime: 0 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result, null, 'All zero runtimes should return null');

    console.log('  ✓ PASS\n');
}

function testSingleEpisode() {
    console.log('Test: Single episode');

    const episodes = [
        { episode_number: 1, name: 'Pilot', runtime: 45 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.notStrictEqual(result, null, 'Single episode should not return null');
    assert.strictEqual(result.min, 45, 'Min should be 45');
    assert.strictEqual(result.max, 45, 'Max should be 45');
    assert.strictEqual(result.variance, 0, 'Variance should be 0');
    assert.strictEqual(result.tolerance, 2, 'Tolerance should be 2 for zero variance');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// TOLERANCE CALCULATION TESTS
// ============================================================================

console.log('━━━ Tolerance Calculation Tests ━━━\n');

function testToleranceForZeroVariance() {
    console.log('Test: Tolerance for zero variance (all same runtime)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 30 },
        { episode_number: 2, name: 'Ep 2', runtime: 30 },
        { episode_number: 3, name: 'Ep 3', runtime: 30 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.variance, 0, 'Variance should be 0');
    assert.strictEqual(result.tolerance, 2, 'Tolerance should be 2 for variance <= 2');

    console.log('  ✓ PASS\n');
}

function testToleranceForSmallVariance() {
    console.log('Test: Tolerance for small variance (3-5 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 20 },
        { episode_number: 2, name: 'Ep 2', runtime: 22 },
        { episode_number: 3, name: 'Ep 3', runtime: 24 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.variance, 4, 'Variance should be 4');
    assert.strictEqual(result.tolerance, 3, 'Tolerance should be 3 for variance 3-5');

    console.log('  ✓ PASS\n');
}

function testToleranceForModerateVariance() {
    console.log('Test: Tolerance for moderate variance (6-10 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 40 },
        { episode_number: 2, name: 'Ep 2', runtime: 45 },
        { episode_number: 3, name: 'Ep 3', runtime: 48 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.variance, 8, 'Variance should be 8');
    assert.strictEqual(result.tolerance, 5, 'Tolerance should be 5 for variance 6-10');

    console.log('  ✓ PASS\n');
}

function testToleranceForHighVariance() {
    console.log('Test: Tolerance for high variance (>10 min)');

    const episodes = [
        { episode_number: 1, name: 'Pilot', runtime: 58 },
        { episode_number: 2, name: 'Ep 2', runtime: 42 },
        { episode_number: 3, name: 'Finale', runtime: 75 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.variance, 33, 'Variance should be 33');
    assert.strictEqual(result.tolerance, 17, 'Tolerance should be ceil(33/2) = 17');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// FORMAT CLASSIFICATION TESTS
// ============================================================================

console.log('━━━ Format Classification Tests ━━━\n');

function testFormatShortForm() {
    console.log('Test: Format classification - short form (<=15 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 8 },
        { episode_number: 2, name: 'Ep 2', runtime: 10 },
        { episode_number: 3, name: 'Ep 3', runtime: 12 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.format, 'short-form (web series, shorts)', 'Format should be short-form');

    console.log('  ✓ PASS\n');
}

function testFormatHalfHour() {
    console.log('Test: Format classification - half hour (16-35 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 22 },
        { episode_number: 2, name: 'Ep 2', runtime: 23 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.format, 'half-hour format (sitcom, animation, etc.)', 'Format should be half-hour');

    console.log('  ✓ PASS\n');
}

function testFormatHourLong() {
    console.log('Test: Format classification - hour long (36-50 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 42 },
        { episode_number: 2, name: 'Ep 2', runtime: 45 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.format, 'hour format (drama, procedural)', 'Format should be hour format');

    console.log('  ✓ PASS\n');
}

function testFormatExtended() {
    console.log('Test: Format classification - extended (51-70 min)');

    const episodes = [
        { episode_number: 1, name: 'Ep 1', runtime: 55 },
        { episode_number: 2, name: 'Ep 2', runtime: 60 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.format, 'extended episode format', 'Format should be extended');

    console.log('  ✓ PASS\n');
}

function testFormatMovieLength() {
    console.log('Test: Format classification - movie/special (>70 min)');

    const episodes = [
        { episode_number: 1, name: 'Special', runtime: 90 }
    ];

    const result = analyzeEpisodeRuntimes(episodes);
    assert.strictEqual(result.format, 'movie/special length', 'Format should be movie/special');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// TRACK CANDIDATE LOGIC TESTS
// ============================================================================

console.log('━━━ Track Candidate Logic Tests ━━━\n');

function testTrackCandidateIdentification() {
    console.log('Test: Identify candidate tracks based on runtime analysis');

    const fixture = loadFixture('track-durations-look-around-you.json');
    const episodeFixture = loadFixture('episodes-short-form.json');

    const runtimeAnalysis = analyzeEpisodeRuntimes(episodeFixture.episodes);

    // Check each track to see if it's a candidate
    const candidates = [];
    const skips = [];

    for (const [trackNum, duration] of Object.entries(fixture.tracks)) {
        const inRange = duration >= (runtimeAnalysis.min - runtimeAnalysis.tolerance) &&
                       duration <= (runtimeAnalysis.max + runtimeAnalysis.tolerance) &&
                       duration > 0;

        if (inRange) {
            candidates.push(parseInt(trackNum));
        } else {
            skips.push(parseInt(trackNum));
        }
    }

    // Verify candidates match expected
    assert.deepStrictEqual(
        candidates.sort((a, b) => a - b),
        fixture.expectedEpisodeTracks.sort((a, b) => a - b),
        'Candidate tracks should match expected episode tracks'
    );

    // Verify skips match expected
    assert.deepStrictEqual(
        skips.sort((a, b) => a - b),
        fixture.expectedSkipTracks.sort((a, b) => a - b),
        'Skip tracks should match expected'
    );

    console.log('  ✓ PASS\n');
}

function testTrackOutsideRange() {
    console.log('Test: Track 2 (13 min) should be outside range for 9-10 min show');

    const episodeFixture = loadFixture('episodes-short-form.json');
    const runtimeAnalysis = analyzeEpisodeRuntimes(episodeFixture.episodes);

    const track2Duration = 13;
    const minValid = runtimeAnalysis.min - runtimeAnalysis.tolerance; // 9 - 2 = 7
    const maxValid = runtimeAnalysis.max + runtimeAnalysis.tolerance; // 10 + 2 = 12

    const isCandidate = track2Duration >= minValid && track2Duration <= maxValid;

    assert.strictEqual(isCandidate, false, 'Track 2 (13 min) should NOT be a candidate');
    assert.strictEqual(track2Duration > maxValid, true, `13 min > ${maxValid} max valid duration`);

    console.log('  ✓ PASS\n');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

try {
    // Runtime Analysis Tests
    testShortFormShow();
    testSitcomShow();
    testDramaShow();
    testMixedMissingRuntimes();
    testEmptyEpisodes();
    testNullEpisodes();
    testUndefinedEpisodes();
    testAllZeroRuntimes();
    testSingleEpisode();

    // Tolerance Calculation Tests
    testToleranceForZeroVariance();
    testToleranceForSmallVariance();
    testToleranceForModerateVariance();
    testToleranceForHighVariance();

    // Format Classification Tests
    testFormatShortForm();
    testFormatHalfHour();
    testFormatHourLong();
    testFormatExtended();
    testFormatMovieLength();

    // Track Candidate Logic Tests
    testTrackCandidateIdentification();
    testTrackOutsideRange();

    console.log('━'.repeat(60));
    console.log('  ✅ All runtime analysis tests passed!');
    console.log('━'.repeat(60));
    console.log('');

    process.exit(0);
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}
