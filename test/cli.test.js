/**
 * Unit Tests for lib/cli.js
 *
 * Tests the CLI argument parser with various flag combinations,
 * positional arguments, and edge cases.
 */

const assert = require('assert');
const { DEFAULT_OPTIONS, parseArgs } = require('../lib/cli');

console.log('\n━━━ CLI Argument Parser Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test: DEFAULT_OPTIONS structure
// ═══════════════════════════════════════════════════════════════════════════

function testDefaultOptions() {
    console.log('Test: DEFAULT_OPTIONS has correct structure');

    assert.strictEqual(DEFAULT_OPTIONS.outputDir, null, 'outputDir should default to null');
    assert.strictEqual(DEFAULT_OPTIONS.dvdSource, null, 'dvdSource should default to null');
    assert.strictEqual(DEFAULT_OPTIONS.verbose, false, 'verbose should default to false');
    assert.strictEqual(DEFAULT_OPTIONS.encoding.encoder, 'x264', 'encoder should default to x264');
    assert.strictEqual(DEFAULT_OPTIONS.encoding.quality, '20', 'quality should default to 20');
    assert.strictEqual(DEFAULT_OPTIONS.encoding.deinterlace, true, 'deinterlace should default to true');
    assert.strictEqual(DEFAULT_OPTIONS.subtitles.track, 1, 'subtitles.track should default to 1');
    assert.strictEqual(DEFAULT_OPTIONS.subtitles.language, 'eng', 'subtitles.language should default to eng');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Empty args returns defaults
// ═══════════════════════════════════════════════════════════════════════════

function testEmptyArgs() {
    console.log('Test: Empty args returns defaults');

    const options = parseArgs([]);

    assert.strictEqual(options.outputDir, null);
    assert.strictEqual(options.dvdSource, null);
    assert.strictEqual(options.verbose, false);
    assert.strictEqual(options.ejectOnComplete, true, 'ejectOnComplete should default to true');
    assert.strictEqual(options.showHelp, undefined);
    assert.strictEqual(options.searchQuery, undefined);

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Boolean flags
// ═══════════════════════════════════════════════════════════════════════════

function testBooleanFlags() {
    console.log('Test: Boolean flags are parsed correctly');

    // Test --help
    let options = parseArgs(['--help']);
    assert.strictEqual(options.showHelp, true, '--help should set showHelp');

    // Test --help-dev
    options = parseArgs(['--help-dev']);
    assert.strictEqual(options.showHelpDev, true, '--help-dev should set showHelpDev');

    // Test --version and -v
    options = parseArgs(['--version']);
    assert.strictEqual(options.showVersion, true, '--version should set showVersion');
    options = parseArgs(['-v']);
    assert.strictEqual(options.showVersion, true, '-v should set showVersion');

    // Test --verbose
    options = parseArgs(['--verbose']);
    assert.strictEqual(options.verbose, true, '--verbose should set verbose');

    // Test --no-deinterlace
    options = parseArgs(['--no-deinterlace']);
    assert.strictEqual(options.encoding.deinterlace, false, '--no-deinterlace should disable deinterlace');

    // Test --no-lookup
    options = parseArgs(['--no-lookup']);
    assert.strictEqual(options.noLookup, true, '--no-lookup should set noLookup');

    // Test --rename-only
    options = parseArgs(['--rename-only']);
    assert.strictEqual(options.renameOnly, true, '--rename-only should set renameOnly');

    // Test --scan-only
    options = parseArgs(['--scan-only']);
    assert.strictEqual(options.scanOnly, true, '--scan-only should set scanOnly');

    // Test --setup
    options = parseArgs(['--setup']);
    assert.strictEqual(options.runSetup, true, '--setup should set runSetup');

    // Test --plan
    options = parseArgs(['--plan']);
    assert.strictEqual(options.planOnly, true, '--plan should set planOnly');

    // Test --interactive and -i
    options = parseArgs(['--interactive']);
    assert.strictEqual(options.interactive, true, '--interactive should set interactive');
    options = parseArgs(['-i']);
    assert.strictEqual(options.interactive, true, '-i should set interactive');

    // Test --diagnose
    options = parseArgs(['--diagnose']);
    assert.strictEqual(options.diagnose, true, '--diagnose should set diagnose');

    // Test --main-only
    options = parseArgs(['--main-only']);
    assert.strictEqual(options.mainOnly, true, '--main-only should set mainOnly');

    // Test --dry-run
    options = parseArgs(['--dry-run']);
    assert.strictEqual(options.dryRun, true, '--dry-run should set dryRun');

    // Test --no-eject
    options = parseArgs(['--no-eject']);
    assert.strictEqual(options.ejectOnComplete, false, '--no-eject should set ejectOnComplete to false');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: --raw flag sets multiple options
// ═══════════════════════════════════════════════════════════════════════════

function testRawFlag() {
    console.log('Test: --raw flag sets rawMode and noLookup');

    const options = parseArgs(['--raw']);

    assert.strictEqual(options.rawMode, true, '--raw should set rawMode');
    assert.strictEqual(options.noLookup, true, '--raw should also set noLookup');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Value flags consume next argument
// ═══════════════════════════════════════════════════════════════════════════

function testValueFlags() {
    console.log('Test: Value flags consume next argument');

    // Test --output
    let options = parseArgs(['--output', '/path/to/output']);
    assert.strictEqual(options.outputDir, '/path/to/output', '--output should set outputDir');

    // Test --dvdSource
    options = parseArgs(['--dvdSource', '/dev/disk5']);
    assert.strictEqual(options.dvdSource, '/dev/disk5', '--dvdSource should set dvdSource');

    // Test --quality
    options = parseArgs(['--quality', '18']);
    assert.strictEqual(options.encoding.quality, '18', '--quality should set encoding.quality');

    // Test --subtitles
    options = parseArgs(['--subtitles', '2']);
    assert.strictEqual(options.subtitles.track, 2, '--subtitles should set subtitles.track');

    // Test --sub-lang
    options = parseArgs(['--sub-lang', 'spa']);
    assert.strictEqual(options.subtitles.language, 'spa', '--sub-lang should set subtitles.language');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Value flags without value don't crash
// ═══════════════════════════════════════════════════════════════════════════

function testValueFlagsWithoutValue() {
    console.log('Test: Value flags at end of args (no value) are handled');

    // These should not crash, just not set the value
    let options = parseArgs(['--output']);
    assert.strictEqual(options.outputDir, null, '--output without value should leave outputDir null');

    options = parseArgs(['--quality']);
    assert.strictEqual(options.encoding.quality, '20', '--quality without value should leave default');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Positional arguments become searchQuery
// ═══════════════════════════════════════════════════════════════════════════

function testPositionalArguments() {
    console.log('Test: Positional arguments become searchQuery');

    // Single positional arg
    let options = parseArgs(['Avatar 2009']);
    assert.strictEqual(options.searchQuery, 'Avatar 2009', 'Single positional should become searchQuery');

    // Multiple positional args joined with space
    options = parseArgs(['Ed,', 'Edd', 'n', 'Eddy', 'season', '2']);
    assert.strictEqual(options.searchQuery, 'Ed, Edd n Eddy season 2', 'Multiple positionals joined');

    // Positional with flags
    options = parseArgs(['--verbose', 'The Matrix', '1999']);
    assert.strictEqual(options.searchQuery, 'The Matrix 1999', 'Positionals extracted around flags');
    assert.strictEqual(options.verbose, true, 'Flag should still work');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Value flag values are not included in positionals
// ═══════════════════════════════════════════════════════════════════════════

function testValueFlagConsumption() {
    console.log('Test: Value flag values not included in positional args');

    const options = parseArgs(['--output', '/tmp/out', 'My Movie']);

    assert.strictEqual(options.outputDir, '/tmp/out', 'output should be set');
    assert.strictEqual(options.searchQuery, 'My Movie', 'searchQuery should not include output path');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Unknown flags set _unknownArg
// ═══════════════════════════════════════════════════════════════════════════

function testUnknownFlags() {
    console.log('Test: Unknown flags are captured in _unknownArg');

    // Long flag
    let options = parseArgs(['--unknown-flag']);
    assert.strictEqual(options._unknownArg, '--unknown-flag', 'Unknown long flag captured');

    // Short flag
    options = parseArgs(['-xyz']);
    assert.strictEqual(options._unknownArg, '-xyz', 'Unknown short flag captured');

    // Last unknown flag wins (each overwrites previous)
    options = parseArgs(['--foo', '--bar']);
    assert.strictEqual(options._unknownArg, '--bar', 'Last unknown flag captured');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Multiple flags combined
// ═══════════════════════════════════════════════════════════════════════════

function testMultipleFlagsCombined() {
    console.log('Test: Multiple flags work together');

    const options = parseArgs([
        '--verbose',
        '--dry-run',
        '--output', '/tmp/test',
        '--quality', '22',
        '-i',
        'Breaking Bad season 3'
    ]);

    assert.strictEqual(options.verbose, true, 'verbose set');
    assert.strictEqual(options.dryRun, true, 'dryRun set');
    assert.strictEqual(options.outputDir, '/tmp/test', 'outputDir set');
    assert.strictEqual(options.encoding.quality, '22', 'quality set');
    assert.strictEqual(options.interactive, true, 'interactive set');
    assert.strictEqual(options.searchQuery, 'Breaking Bad season 3', 'searchQuery set');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Does not mutate DEFAULT_OPTIONS
// ═══════════════════════════════════════════════════════════════════════════

function testNoMutation() {
    console.log('Test: parseArgs does not mutate DEFAULT_OPTIONS');

    const originalQuality = DEFAULT_OPTIONS.encoding.quality;

    parseArgs(['--quality', '99']);

    assert.strictEqual(DEFAULT_OPTIONS.encoding.quality, originalQuality,
        'DEFAULT_OPTIONS should not be mutated');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

try {
    testDefaultOptions();
    testEmptyArgs();
    testBooleanFlags();
    testRawFlag();
    testValueFlags();
    testValueFlagsWithoutValue();
    testPositionalArguments();
    testValueFlagConsumption();
    testUnknownFlags();
    testMultipleFlagsCombined();
    testNoMutation();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ All CLI parser tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
} catch (error) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
}
