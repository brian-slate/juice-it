/**
 * Tests for Plex-compatible naming utilities
 */

const assert = require('assert');
const {
    sanitizeForPlex,
    calculateProposedName,
    buildBaseFileName,
    buildExtrasFileName,
    buildPlexFolderPath
} = require('../lib/naming');

console.log('\n━━━ Plex Naming Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeForPlex() Tests
// ═══════════════════════════════════════════════════════════════════════════

console.log('━━━ sanitizeForPlex() Tests ━━━\n');

function testSanitizeBasic() {
    console.log('Test: sanitizeForPlex removes unsafe characters');

    assert.strictEqual(sanitizeForPlex('Movie: The Beginning'), 'Movie The Beginning');
    assert.strictEqual(sanitizeForPlex('What If?'), 'What If');
    assert.strictEqual(sanitizeForPlex('Test<>File'), 'TestFile');
    assert.strictEqual(sanitizeForPlex('Path/To\\File'), 'PathToFile');
    assert.strictEqual(sanitizeForPlex('Name|With|Pipes'), 'NameWithPipes');
    assert.strictEqual(sanitizeForPlex('Quote"Test"Here'), 'QuoteTestHere');

    console.log('  ✓ PASS\n');
}

function testSanitizePreservesValidChars() {
    console.log('Test: sanitizeForPlex preserves spaces, dashes, parentheses');

    assert.strictEqual(sanitizeForPlex('Movie Name'), 'Movie Name');
    assert.strictEqual(sanitizeForPlex('Movie (2024)'), 'Movie (2024)');
    assert.strictEqual(sanitizeForPlex('Show - Episode'), 'Show - Episode');
    assert.strictEqual(sanitizeForPlex("It's A Test"), "It's A Test");

    console.log('  ✓ PASS\n');
}

function testSanitizeNormalizesSpaces() {
    console.log('Test: sanitizeForPlex normalizes multiple spaces');

    assert.strictEqual(sanitizeForPlex('Too   Many    Spaces'), 'Too Many Spaces');
    assert.strictEqual(sanitizeForPlex('  Leading Spaces'), 'Leading Spaces');
    assert.strictEqual(sanitizeForPlex('Trailing Spaces  '), 'Trailing Spaces');

    console.log('  ✓ PASS\n');
}

function testSanitizeHandlesEmpty() {
    console.log('Test: sanitizeForPlex handles empty/null input');

    assert.strictEqual(sanitizeForPlex(''), '');
    assert.strictEqual(sanitizeForPlex(null), '');
    assert.strictEqual(sanitizeForPlex(undefined), '');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// calculateProposedName() Tests
// ═══════════════════════════════════════════════════════════════════════════

console.log('━━━ calculateProposedName() Tests ━━━\n');

function testMovieSingleTitle() {
    console.log('Test: Movie with single title');

    const metadata = { type: 'movie', name: 'Avatar', year: '2009' };
    const result = calculateProposedName(0, metadata, 'Avatar (2009)', 1);

    assert.strictEqual(result, 'Avatar (2009).mp4');

    console.log('  ✓ PASS\n');
}

function testMovieMultipleTitles() {
    console.log('Test: Movie with multiple titles (extras)');

    const metadata = { type: 'movie', name: 'Avatar', year: '2009' };

    const result1 = calculateProposedName(0, metadata, 'Avatar (2009)', 3);
    const result2 = calculateProposedName(1, metadata, 'Avatar (2009)', 3);
    const result3 = calculateProposedName(2, metadata, 'Avatar (2009)', 3);

    assert.strictEqual(result1, 'Avatar (2009) - Part 1.mp4');
    assert.strictEqual(result2, 'Avatar (2009) - Part 2.mp4');
    assert.strictEqual(result3, 'Avatar (2009) - Part 3.mp4');

    console.log('  ✓ PASS\n');
}

function testTVShowWithEpisodes() {
    console.log('Test: TV show with episode metadata');

    const metadata = {
        type: 'tv',
        name: 'Breaking Bad',
        year: '2008',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'Pilot' },
            { episode_number: 2, name: 'Cat\'s in the Bag...' },
            { episode_number: 3, name: '...And the Bag\'s in the River' }
        ]
    };

    const result1 = calculateProposedName(0, metadata, 'Breaking Bad (2008)', 3);
    const result2 = calculateProposedName(1, metadata, 'Breaking Bad (2008)', 3);
    const result3 = calculateProposedName(2, metadata, 'Breaking Bad (2008)', 3);

    assert.strictEqual(result1, 'Breaking Bad (2008) - s01e01 - Pilot.mp4');
    assert.strictEqual(result2, "Breaking Bad (2008) - s01e02 - Cat's in the Bag....mp4");
    assert.strictEqual(result3, "Breaking Bad (2008) - s01e03 - ...And the Bag's in the River.mp4");

    console.log('  ✓ PASS\n');
}

function testTVShowWithoutEpisodeNames() {
    console.log('Test: TV show without episode metadata');

    const metadata = {
        type: 'tv',
        name: 'Unknown Show',
        year: '2020',
        season: 2,
        episodes: null
    };

    const result1 = calculateProposedName(0, metadata, 'Unknown Show (2020)', 4);
    const result2 = calculateProposedName(1, metadata, 'Unknown Show (2020)', 4);

    assert.strictEqual(result1, 'Unknown Show (2020) - s02e01.mp4');
    assert.strictEqual(result2, 'Unknown Show (2020) - s02e02.mp4');

    console.log('  ✓ PASS\n');
}

function testTVShowSeasonPadding() {
    console.log('Test: Season and episode number padding');

    const metadata = {
        type: 'tv',
        name: 'Long Show',
        year: '2015',
        season: 10,
        episodes: [
            { episode_number: 15, name: 'Big Episode' }
        ]
    };

    const result = calculateProposedName(0, metadata, 'Long Show (2015)', 1);

    assert.strictEqual(result, 'Long Show (2015) - s10e15 - Big Episode.mp4');

    console.log('  ✓ PASS\n');
}

function testEpisodeWithUnsafeChars() {
    console.log('Test: Episode title with unsafe characters');

    const metadata = {
        type: 'tv',
        name: 'Test Show',
        year: '2020',
        season: 1,
        episodes: [
            { episode_number: 1, name: 'What If?: The Beginning' }
        ]
    };

    const result = calculateProposedName(0, metadata, 'Test Show (2020)', 1);

    // Colon and question mark should be removed
    assert.strictEqual(result, 'Test Show (2020) - s01e01 - What If The Beginning.mp4');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// buildBaseFileName() Tests
// ═══════════════════════════════════════════════════════════════════════════

console.log('━━━ buildBaseFileName() Tests ━━━\n');

function testBuildBaseFileNameMovie() {
    console.log('Test: buildBaseFileName for movie');

    const metadata = { type: 'movie', name: 'Avatar', year: '2009' };
    const result = buildBaseFileName(metadata, 'FALLBACK');

    assert.strictEqual(result, 'Avatar (2009)');

    console.log('  ✓ PASS\n');
}

function testBuildBaseFileNameTV() {
    console.log('Test: buildBaseFileName for TV show');

    const metadata = { type: 'tv', name: 'Breaking Bad', year: '2008' };
    const result = buildBaseFileName(metadata, 'FALLBACK');

    assert.strictEqual(result, 'Breaking Bad (2008)');

    console.log('  ✓ PASS\n');
}

function testBuildBaseFileNameNoYear() {
    console.log('Test: buildBaseFileName without year');

    const metadata = { type: 'movie', name: 'Unknown Movie', year: null };
    const result = buildBaseFileName(metadata, 'FALLBACK');

    assert.strictEqual(result, 'Unknown Movie');

    console.log('  ✓ PASS\n');
}

function testBuildBaseFileNameCustom() {
    console.log('Test: buildBaseFileName for custom type');

    const metadata = { type: 'custom', name: 'My Custom Name' };
    const result = buildBaseFileName(metadata, 'FALLBACK');

    assert.strictEqual(result, 'My Custom Name');

    console.log('  ✓ PASS\n');
}

function testBuildBaseFileNameFallback() {
    console.log('Test: buildBaseFileName with null metadata');

    const result = buildBaseFileName(null, 'DISC_NAME');

    assert.strictEqual(result, 'DISC_NAME');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// buildExtrasFileName() Tests
// ═══════════════════════════════════════════════════════════════════════════

console.log('━━━ buildExtrasFileName() Tests ━━━\n');

function testBuildExtrasFileName() {
    console.log('Test: buildExtrasFileName generates Plex-compatible format');

    // Default type is 'featurette'
    const result1 = buildExtrasFileName('Avatar (2009)', 1);
    const result2 = buildExtrasFileName('Avatar (2009)', 5);

    // Plex format: MovieName (Year)-type-Description.mp4
    assert.strictEqual(result1, 'Avatar (2009)-featurette-Bonus 1.mp4');
    assert.strictEqual(result2, 'Avatar (2009)-featurette-Bonus 5.mp4');

    // Test with custom extra type
    const result3 = buildExtrasFileName('Avatar (2009)', 1, 'deleted');
    assert.strictEqual(result3, 'Avatar (2009)-deleted-Bonus 1.mp4');

    console.log('  ✓ PASS\n');
}

function testBuildExtrasFileNameWithDescription() {
    console.log('Test: buildExtrasFileName with custom description (Play All, etc.)');

    // Play All compilation track with 'other' type
    const result1 = buildExtrasFileName('Ed, Edd n Eddy (1999)', 1, 'other', 'Play All');
    assert.strictEqual(result1, 'Ed, Edd n Eddy (1999)-other-Play All.mp4');

    // Behind the scenes with custom description
    const result2 = buildExtrasFileName('Avatar (2009)', 2, 'behindthescenes', 'Making of Avatar');
    assert.strictEqual(result2, 'Avatar (2009)-behindthescenes-Making of Avatar.mp4');

    // Trailer with description
    const result3 = buildExtrasFileName('Movie Name (2024)', 1, 'trailer', 'Theatrical Trailer');
    assert.strictEqual(result3, 'Movie Name (2024)-trailer-Theatrical Trailer.mp4');

    // Null description should fall back to "Bonus X"
    const result4 = buildExtrasFileName('Movie Name (2024)', 3, 'featurette', null);
    assert.strictEqual(result4, 'Movie Name (2024)-featurette-Bonus 3.mp4');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// buildPlexFolderPath() Tests
// ═══════════════════════════════════════════════════════════════════════════

console.log('━━━ buildPlexFolderPath() Tests ━━━\n');

function testPlexFolderPathTV() {
    console.log('Test: buildPlexFolderPath for TV show with TMDB ID');

    const metadata = {
        type: 'tv',
        tmdbId: 606,
        name: 'Ed, Edd n Eddy',
        year: '1999',
        season: 1
    };
    const result = buildPlexFolderPath(metadata);

    assert.strictEqual(result.showFolder, 'Ed, Edd n Eddy (1999) {tmdb-606}');
    assert.strictEqual(result.seasonFolder, 'Season 01');
    assert.strictEqual(result.fullPath, 'Ed, Edd n Eddy (1999) {tmdb-606}/Season 01/');

    console.log('  ✓ PASS\n');
}

function testPlexFolderPathMovie() {
    console.log('Test: buildPlexFolderPath for movie with TMDB ID');

    const metadata = {
        type: 'movie',
        tmdbId: 19995,
        name: 'Avatar',
        year: '2009'
    };
    const result = buildPlexFolderPath(metadata);

    assert.strictEqual(result.showFolder, 'Avatar (2009) {tmdb-19995}');
    assert.strictEqual(result.seasonFolder, null);
    assert.strictEqual(result.fullPath, 'Avatar (2009) {tmdb-19995}/');

    console.log('  ✓ PASS\n');
}

function testPlexFolderPathWithoutTmdbId() {
    console.log('Test: buildPlexFolderPath without TMDB ID');

    const metadata = {
        type: 'tv',
        name: 'Some Show',
        year: '2020',
        season: 3
    };
    const result = buildPlexFolderPath(metadata);

    // Should work without ID, just no {tmdb-xxx} suffix
    assert.strictEqual(result.showFolder, 'Some Show (2020)');
    assert.strictEqual(result.seasonFolder, 'Season 03');
    assert.strictEqual(result.fullPath, 'Some Show (2020)/Season 03/');

    console.log('  ✓ PASS\n');
}

function testPlexFolderPathNullMetadata() {
    console.log('Test: buildPlexFolderPath with null/invalid metadata');

    assert.strictEqual(buildPlexFolderPath(null), null);
    assert.strictEqual(buildPlexFolderPath({}), null);
    assert.strictEqual(buildPlexFolderPath({ type: 'custom' }), null);

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

try {
    // sanitizeForPlex tests
    testSanitizeBasic();
    testSanitizePreservesValidChars();
    testSanitizeNormalizesSpaces();
    testSanitizeHandlesEmpty();

    // calculateProposedName tests
    testMovieSingleTitle();
    testMovieMultipleTitles();
    testTVShowWithEpisodes();
    testTVShowWithoutEpisodeNames();
    testTVShowSeasonPadding();
    testEpisodeWithUnsafeChars();

    // buildBaseFileName tests
    testBuildBaseFileNameMovie();
    testBuildBaseFileNameTV();
    testBuildBaseFileNameNoYear();
    testBuildBaseFileNameCustom();
    testBuildBaseFileNameFallback();

    // buildExtrasFileName tests
    testBuildExtrasFileName();
    testBuildExtrasFileNameWithDescription();

    // buildPlexFolderPath tests
    testPlexFolderPathTV();
    testPlexFolderPathMovie();
    testPlexFolderPathWithoutTmdbId();
    testPlexFolderPathNullMetadata();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ All Plex naming tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
} catch (error) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
}
