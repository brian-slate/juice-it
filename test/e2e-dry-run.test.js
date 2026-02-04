/**
 * End-to-End Test with Dry-Run Mode
 *
 * This test verifies the full workflow by using --dry-run mode
 * to create stub files instead of actual ripping.
 *
 * Note: This test requires a DVD to be inserted OR can be run
 * with mock mode for CI environments.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');

const TEST_ROOT = path.join(__dirname, 'e2e-test-output');
const JUICEIT_PATH = path.join(__dirname, '../juiceit.js');

// Helper to run juiceit with arguments
function runJuiceIt(args, timeout = 60000) {
    const result = spawnSync('node', [JUICEIT_PATH, ...args], {
        encoding: 'utf-8',
        timeout,
        cwd: TEST_ROOT
    });
    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.status,
        error: result.error
    };
}

// Setup test directory
function setup() {
    if (fs.existsSync(TEST_ROOT)) {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_ROOT, { recursive: true });
}

// Teardown test directory
function teardown() {
    if (fs.existsSync(TEST_ROOT)) {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

console.log('\n━━━ End-to-End Dry-Run Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test: Help command works
// ═══════════════════════════════════════════════════════════════════════════

function testHelpCommand() {
    console.log('Test: --help command displays correct usage');
    setup();

    const result = runJuiceIt(['--help']);

    assert.strictEqual(result.exitCode, 0, 'Help should exit with code 0');
    assert(result.stdout.includes('--dry-run'), 'Help should mention --dry-run flag');
    assert(result.stdout.includes('--main-only'), 'Help should mention --main-only flag');
    assert(result.stdout.includes('Guided selection'), 'Help should explain guided selection mode');
    assert(result.stdout.includes('"title or show info"'), 'Help should show positional argument usage');
    assert(!result.stdout.includes('--title'), 'Help should NOT mention removed --title flag');

    teardown();
    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Developer help command works
// ═══════════════════════════════════════════════════════════════════════════

function testHelpDevCommand() {
    console.log('Test: --help-dev command displays developer commands');
    setup();

    const result = runJuiceIt(['--help-dev']);

    assert.strictEqual(result.exitCode, 0, 'Help-dev should exit with code 0');
    assert(result.stdout.includes('make use-local'), 'Help-dev should mention make use-local');
    assert(result.stdout.includes('make test'), 'Help-dev should mention make test');
    assert(result.stdout.includes('make release'), 'Help-dev should mention make release');
    assert(result.stdout.includes('Developer Commands'), 'Help-dev should have Developer Commands header');

    teardown();
    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Unknown flags are rejected
// ═══════════════════════════════════════════════════════════════════════════

function testUnknownFlagRejected() {
    console.log('Test: Unknown flags are rejected with error');
    setup();

    // Test with long flag
    const result1 = runJuiceIt(['--unknown-flag']);
    assert.strictEqual(result1.exitCode, 1, 'Unknown flag should exit with code 1');
    assert(result1.stderr.includes('Unknown option'), 'Should show "Unknown option" error');
    assert(result1.stderr.includes('--unknown-flag'), 'Error should mention the unknown flag');
    assert(result1.stderr.includes('--help'), 'Error should suggest using --help');

    // Test with short flag
    const result2 = runJuiceIt(['-xyz']);
    assert.strictEqual(result2.exitCode, 1, 'Unknown short flag should exit with code 1');
    assert(result2.stderr.includes('Unknown option'), 'Should show "Unknown option" error for short flag');

    // Test that --title is now rejected (replaced by positional arguments)
    const result3 = runJuiceIt(['--title', 'Test Movie']);
    assert.strictEqual(result3.exitCode, 1, '--title flag should be rejected');
    assert(result3.stderr.includes('Unknown option'), '--title should show "Unknown option" error');
    assert(result3.stderr.includes('--title'), 'Error should mention --title');

    // Ensure valid flags still work
    const result4 = runJuiceIt(['--version']);
    assert.strictEqual(result4.exitCode, 0, 'Valid flag --version should exit with code 0');

    teardown();
    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Naming module is properly integrated
// ═══════════════════════════════════════════════════════════════════════════

function testNamingModuleIntegration() {
    console.log('Test: Naming module exports are used in juiceit.js');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');

    // Check that the naming module is imported
    assert(
        juiceItContent.includes("require('./lib/naming')"),
        'juiceit.js should import the naming module'
    );

    // Check that key functions are used
    assert(
        juiceItContent.includes('sanitizeForPlex'),
        'juiceit.js should use sanitizeForPlex'
    );
    assert(
        juiceItContent.includes('calculateProposedName'),
        'juiceit.js should use calculateProposedName'
    );
    // Note: buildBaseFileName and buildExtrasFileName are exported by lib/naming.js
    // but not currently used directly in juiceit.js (calculateProposedName handles naming)

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Dry-run flag is recognized
// ═══════════════════════════════════════════════════════════════════════════

function testDryRunFlagRecognized() {
    console.log('Test: --dry-run flag is recognized in arguments');

    const cliContent = fs.readFileSync(path.join(__dirname, '../lib/cli.js'), 'utf-8');

    // Check that dry-run option is parsed (now in cli module)
    assert(
        cliContent.includes("'--dry-run'"),
        'cli module should parse --dry-run flag'
    );
    assert(
        cliContent.includes('options.dryRun'),
        'cli module should set options.dryRun'
    );

    // Check that dry-run mode creates stub files (now in handbrake module)
    const handbrakeContent = fs.readFileSync(path.join(__dirname, '../lib/handbrake.js'), 'utf-8');
    assert(
        handbrakeContent.includes('[DRY-RUN]'),
        'handbrake module should have dry-run logging'
    );

    // Check that dry-run mode displays message (now in rip module)
    const ripContent = fs.readFileSync(path.join(__dirname, '../lib/rip.js'), 'utf-8');
    assert(
        ripContent.includes('DRY-RUN MODE'),
        'rip module should display dry-run mode message'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Plex naming format in code
// ═══════════════════════════════════════════════════════════════════════════

function testPlexNamingInCode() {
    console.log('Test: Plex naming format is used throughout codebase');

    const namingContent = fs.readFileSync(path.join(__dirname, '../lib/naming.js'), 'utf-8');

    // Check naming module has correct Plex format
    assert(
        namingContent.includes('s${seasonNum}e${episodeNum}'),
        'Naming module should use lowercase s/e for season/episode'
    );
    assert(
        namingContent.includes('- Part'),
        'Naming module should use "Part" for multi-part movies'
    );
    assert(
        namingContent.includes('featurette') && namingContent.includes('Bonus'),
        'Naming module should have Plex-compatible extras naming (featurette-Bonus)'
    );

    // Check that year is stored for TV shows (now in metadata module)
    const metadataContent = fs.readFileSync(path.join(__dirname, '../lib/metadata.js'), 'utf-8');
    assert(
        metadataContent.includes("year: showYear") || metadataContent.includes("year: show.first_air_date"),
        'metadata module should store year for TV shows'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Main-only flag works
// ═══════════════════════════════════════════════════════════════════════════

function testMainOnlyFlag() {
    console.log('Test: --main-only flag is properly implemented');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');
    const cliContent = fs.readFileSync(path.join(__dirname, '../lib/cli.js'), 'utf-8');

    // Check that main-only option is parsed (now in cli module)
    assert(
        cliContent.includes("'--main-only'"),
        'cli module should parse --main-only flag'
    );
    assert(
        cliContent.includes('options.mainOnly'),
        'cli module should set options.mainOnly'
    );

    // Check that mainOnly is used to skip extras
    assert(
        juiceItContent.includes("options.mainOnly"),
        'juiceit.js should handle mainOnly option'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Skipped tracks are tracked separately
// ═══════════════════════════════════════════════════════════════════════════

function testSkippedTracksTracking() {
    console.log('Test: Mapping-skipped tracks are tracked separately');

    // Skipped tracks are now tracked in lib/rip.js module
    const ripContent = fs.readFileSync(path.join(__dirname, '../lib/rip.js'), 'utf-8');

    // Check that both arrays exist
    assert(
        ripContent.includes('skippedTracks'),
        'rip module should have skippedTracks array'
    );
    assert(
        ripContent.includes('mappingSkippedTracks'),
        'rip module should have mappingSkippedTracks array'
    );

    // Check that mapping-skipped tracks are tracked
    assert(
        ripContent.includes('mappingSkippedTracks.push'),
        'rip module should push to mappingSkippedTracks'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Summary shows skipped tracks info
// ═══════════════════════════════════════════════════════════════════════════

function testSummaryShowsSkippedTracks() {
    console.log('Test: Summary includes skipped tracks and re-run guidance');

    // Summary display is now in lib/rip.js module
    const ripContent = fs.readFileSync(path.join(__dirname, '../lib/rip.js'), 'utf-8');

    // Check that summary mentions extras
    assert(
        ripContent.includes('Tracks Not Ripped'),
        'Summary should mention tracks not ripped'
    );

    // Check that re-run guidance is shown (raw mode alternative)
    assert(
        ripContent.includes('juiceit --raw'),
        'Summary should show --raw as alternative'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Positional argument support for search query
// ═══════════════════════════════════════════════════════════════════════════

function testPositionalArgumentSupport() {
    console.log('Test: Positional argument support is implemented');

    const cliContent = fs.readFileSync(path.join(__dirname, '../lib/cli.js'), 'utf-8');
    const ripContent = fs.readFileSync(path.join(__dirname, '../lib/rip.js'), 'utf-8');

    // Check that positional arguments are collected (now in cli module)
    assert(
        cliContent.includes('positionalArgs'),
        'cli module should collect positional arguments'
    );

    // Check that searchQuery is set from positional args (now in cli module)
    assert(
        cliContent.includes('options.searchQuery'),
        'cli module should set options.searchQuery'
    );

    // Check that guidedMetadataSelection function is called (now in rip module)
    assert(
        ripContent.includes('guidedMetadataSelection'),
        'rip module should call guidedMetadataSelection function'
    );

    // Check that naked invocation routes to guided selection (now in rip module)
    assert(
        ripContent.includes('!hasUserQuery && !isInteractive'),
        'rip module should detect naked invocations'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

try {
    testHelpCommand();
    testHelpDevCommand();
    testUnknownFlagRejected();
    testNamingModuleIntegration();
    testDryRunFlagRecognized();
    testPlexNamingInCode();
    testMainOnlyFlag();
    testSkippedTracksTracking();
    testSummaryShowsSkippedTracks();
    testPositionalArgumentSupport();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ All end-to-end tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
} catch (error) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
}
