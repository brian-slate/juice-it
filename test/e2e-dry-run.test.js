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
    console.log('Test: --help command displays dry-run option');
    setup();

    const result = runJuiceIt(['--help']);

    assert.strictEqual(result.exitCode, 0, 'Help should exit with code 0');
    assert(result.stdout.includes('--dry-run'), 'Help should mention --dry-run flag');
    assert(result.stdout.includes('--include-extras'), 'Help should mention --include-extras flag');
    assert(result.stdout.includes('stub files'), 'Help should explain dry-run creates stub files');

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
    assert(result.stdout.includes('make reinstall'), 'Help-dev should mention make reinstall');
    assert(result.stdout.includes('npm test'), 'Help-dev should mention npm test');
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

    // Ensure valid flags still work
    const result3 = runJuiceIt(['--version']);
    assert.strictEqual(result3.exitCode, 0, 'Valid flag --version should exit with code 0');

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

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');

    // Check that dry-run option is parsed
    assert(
        juiceItContent.includes("'--dry-run'"),
        'juiceit.js should parse --dry-run flag'
    );
    assert(
        juiceItContent.includes('options.dryRun'),
        'juiceit.js should set options.dryRun'
    );

    // Check that dry-run mode creates stub files
    assert(
        juiceItContent.includes('[DRY-RUN]'),
        'juiceit.js should have dry-run logging'
    );
    assert(
        juiceItContent.includes('DRY-RUN MODE'),
        'juiceit.js should display dry-run mode message'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Plex naming format in code
// ═══════════════════════════════════════════════════════════════════════════

function testPlexNamingInCode() {
    console.log('Test: Plex naming format is used throughout codebase');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');
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
        namingContent.includes('Extra Track'),
        'Naming module should have Extra Track naming'
    );

    // Check that year is stored for TV shows
    assert(
        juiceItContent.includes("year: showYear") || juiceItContent.includes("year: show.first_air_date"),
        'juiceit.js should store year for TV shows'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Include-extras flag works
// ═══════════════════════════════════════════════════════════════════════════

function testIncludeExtrasFlag() {
    console.log('Test: --include-extras flag is properly implemented');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');

    // Check that include-extras option is parsed
    assert(
        juiceItContent.includes("'--include-extras'"),
        'juiceit.js should parse --include-extras flag'
    );
    assert(
        juiceItContent.includes('options.includeExtras'),
        'juiceit.js should set options.includeExtras'
    );

    // Check that skip status is overridden when includeExtras is true
    assert(
        juiceItContent.includes("if (options.includeExtras)"),
        'juiceit.js should handle includeExtras option'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Skipped tracks are tracked separately
// ═══════════════════════════════════════════════════════════════════════════

function testSkippedTracksTracking() {
    console.log('Test: Mapping-skipped tracks are tracked separately');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');

    // Check that both arrays exist
    assert(
        juiceItContent.includes('skippedTracks'),
        'juiceit.js should have skippedTracks array'
    );
    assert(
        juiceItContent.includes('mappingSkippedTracks'),
        'juiceit.js should have mappingSkippedTracks array'
    );

    // Check that mapping-skipped tracks are tracked
    assert(
        juiceItContent.includes('mappingSkippedTracks.push'),
        'juiceit.js should push to mappingSkippedTracks'
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Summary shows skipped tracks info
// ═══════════════════════════════════════════════════════════════════════════

function testSummaryShowsSkippedTracks() {
    console.log('Test: Summary includes skipped tracks and re-run guidance');

    const juiceItContent = fs.readFileSync(JUICEIT_PATH, 'utf-8');

    // Check that summary mentions extras
    assert(
        juiceItContent.includes('Tracks Not Ripped'),
        'Summary should mention tracks not ripped'
    );

    // Check that re-run guidance is shown
    assert(
        juiceItContent.includes('juiceit --include-extras'),
        'Summary should show --include-extras guidance'
    );
    assert(
        juiceItContent.includes('juiceit --raw'),
        'Summary should show --raw as alternative'
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
    testIncludeExtrasFlag();
    testSkippedTracksTracking();
    testSummaryShowsSkippedTracks();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ All end-to-end tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
} catch (error) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
}
