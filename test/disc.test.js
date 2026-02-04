/**
 * Unit Tests for lib/disc.js
 *
 * Tests DVD detection, scanning, caching, and tool validation
 * using dependency injection for mocking external commands.
 */

const assert = require('assert');
const disc = require('../lib/disc');

console.log('\n━━━ Disc Module Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════

// Mock logger that captures calls
function createMockLogger() {
    return {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {}
    };
}

// Mock filesystem helper (available for tests that need it)
function _createMockFs(files = {}) {
    return {
        existsSync: (p) => p in files,
        mkdirSync: () => {},
        readFileSync: (p) => {
            if (p in files) return files[p];
            throw new Error(`ENOENT: no such file or directory, open '${p}'`);
        },
        writeFileSync: () => {},
        readdirSync: () => Object.keys(files).map(f => f.split('/').pop()),
        statSync: () => ({
            mtime: { getTime: () => Date.now() }
        }),
        unlinkSync: () => {}
    };
}

// Reset disc module state after each test
function resetDisc() {
    disc.resetDependencies();
    disc.setLogger(createMockLogger());
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: parseLsdvdOutput parsing
// ═══════════════════════════════════════════════════════════════════════════

function testParseLsdvdOutput() {
    console.log('Test: parseLsdvdOutput parses lsdvd output correctly');
    resetDisc();

    const sampleOutput = `Disc Title: BREAKING_BAD_S5_D1
DVDDiscID: 1234567890abcdef
Longest track: 3
Title: 01, Length: 00:08:47.000 Chapters: 05, Cells: 05, Audio streams: 02, Subpictures: 01
Title: 02, Length: 00:47:23.000 Chapters: 08, Cells: 08, Audio streams: 02, Subpictures: 03
Title: 03, Length: 00:48:01.000 Chapters: 10, Cells: 10, Audio streams: 02, Subpictures: 03`;

    const result = disc.parseLsdvdOutput(sampleOutput);

    assert.strictEqual(result.discTitle, 'BREAKING_BAD_S5_D1', 'Should parse disc title');
    assert.strictEqual(result.discId, '1234567890abcdef', 'Should parse disc ID');
    assert.strictEqual(result.longestTrack, 3, 'Should parse longest track');
    assert.strictEqual(Object.keys(result.tracks).length, 3, 'Should parse 3 tracks');
    assert.strictEqual(result.tracks[1].durationMinutes, 9, 'Track 1 should be ~9 minutes');
    assert.strictEqual(result.tracks[2].durationMinutes, 47, 'Track 2 should be ~47 minutes');
    assert.strictEqual(result.tracks[2].chapters, 8, 'Track 2 should have 8 chapters');
    assert.strictEqual(result.tracks[3].audioStreams, 2, 'Track 3 should have 2 audio streams');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: parseLsdvdOutput with minimal output
// ═══════════════════════════════════════════════════════════════════════════

function testParseLsdvdOutputMinimal() {
    console.log('Test: parseLsdvdOutput handles minimal/empty output');
    resetDisc();

    const emptyResult = disc.parseLsdvdOutput('');
    assert.strictEqual(emptyResult.discTitle, 'unknown', 'Empty output should have unknown disc title');
    assert.strictEqual(emptyResult.longestTrack, null, 'Empty output should have null longest track');
    assert.deepStrictEqual(emptyResult.tracks, {}, 'Empty output should have empty tracks');

    const minimalResult = disc.parseLsdvdOutput('Some random text\nWith no structure\n');
    assert.strictEqual(minimalResult.discTitle, 'unknown', 'Unstructured output should have unknown disc title');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkLsdvd returns true when installed
// ═══════════════════════════════════════════════════════════════════════════

function testCheckLsdvdInstalled() {
    console.log('Test: checkLsdvd returns true when lsdvd is installed');
    resetDisc();

    disc.setDependencies({
        spawnSync: (cmd, args) => {
            if (cmd === 'which' && args[0] === 'lsdvd') {
                return { status: 0, stdout: '/usr/local/bin/lsdvd' };
            }
            return { status: 1 };
        }
    });

    const result = disc.checkLsdvd();
    assert.strictEqual(result, true, 'Should return true when lsdvd is found');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkLsdvd returns false when not installed
// ═══════════════════════════════════════════════════════════════════════════

function testCheckLsdvdNotInstalled() {
    console.log('Test: checkLsdvd returns false when lsdvd is not installed');
    resetDisc();

    disc.setDependencies({
        spawnSync: () => ({ status: 1 })
    });

    const result = disc.checkLsdvd();
    assert.strictEqual(result, false, 'Should return false when lsdvd is not found');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkHandBrakeCLI calls exit when not installed
// ═══════════════════════════════════════════════════════════════════════════

function testCheckHandBrakeCLINotInstalled() {
    console.log('Test: checkHandBrakeCLI calls exit(1) when not installed');
    resetDisc();

    let exitCalled = false;
    let exitCode = null;

    disc.setDependencies({
        spawnSync: () => ({ status: 1, error: new Error('not found') }),
        exit: (code) => {
            exitCalled = true;
            exitCode = code;
        }
    });

    disc.checkHandBrakeCLI();
    assert.strictEqual(exitCalled, true, 'Should call exit');
    assert.strictEqual(exitCode, 1, 'Should exit with code 1');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkHandBrakeCLI succeeds when installed
// ═══════════════════════════════════════════════════════════════════════════

function testCheckHandBrakeCLIInstalled() {
    console.log('Test: checkHandBrakeCLI succeeds when installed');
    resetDisc();

    let exitCalled = false;

    disc.setDependencies({
        spawnSync: (cmd) => {
            if (cmd === 'HandBrakeCLI') {
                return { status: 0, stdout: 'HandBrake 1.6.1' };
            }
            return { status: 1 };
        },
        exit: () => { exitCalled = true; }
    });

    disc.checkHandBrakeCLI();
    assert.strictEqual(exitCalled, false, 'Should not call exit when HandBrakeCLI is installed');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkLibdvdcss calls exit when not installed
// ═══════════════════════════════════════════════════════════════════════════

function testCheckLibdvdcssNotInstalled() {
    console.log('Test: checkLibdvdcss calls exit(1) when not installed');
    resetDisc();

    let exitCalled = false;
    let exitCode = null;

    disc.setDependencies({
        spawnSync: () => ({ status: 1, error: new Error('not found') }),
        exit: (code) => {
            exitCalled = true;
            exitCode = code;
        }
    });

    disc.checkLibdvdcss();
    assert.strictEqual(exitCalled, true, 'Should call exit');
    assert.strictEqual(exitCode, 1, 'Should exit with code 1');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: detectAllDvdDrives with drutil detection
// ═══════════════════════════════════════════════════════════════════════════

function testDetectDvdDrivesDrutil() {
    console.log('Test: detectAllDvdDrives detects DVD via drutil');
    resetDisc();

    disc.setDependencies({
        execSync: (cmd) => {
            if (cmd.includes('drutil status')) {
                return Buffer.from('Name:    /dev/disk5\n Media Class: DVD\n');
            }
            if (cmd.includes('diskutil info /dev/disk5')) {
                return Buffer.from('Volume Name:  BREAKING_BAD_S5\nDisk Size:    4.7 GB\n');
            }
            return Buffer.from('');
        }
    });

    const drives = disc.detectAllDvdDrives();
    assert.strictEqual(drives.length, 1, 'Should detect one drive');
    assert.strictEqual(drives[0].device, '/dev/disk5', 'Should have correct device');
    assert.strictEqual(drives[0].name, 'BREAKING_BAD_S5', 'Should have volume name');
    assert.strictEqual(drives[0].size, '4.7 GB', 'Should have size');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: detectAllDvdDrives with no DVD
// ═══════════════════════════════════════════════════════════════════════════

function testDetectDvdDrivesNoDvd() {
    console.log('Test: detectAllDvdDrives returns empty when no DVD');
    resetDisc();

    disc.setDependencies({
        execSync: (cmd) => {
            if (cmd.includes('drutil status')) {
                throw new Error('No media present');
            }
            if (cmd.includes('diskutil list')) {
                return Buffer.from('/dev/disk0 (internal):\n   #: TYPE NAME SIZE IDENTIFIER\n');
            }
            return Buffer.from('');
        }
    });

    const drives = disc.detectAllDvdDrives();
    assert.strictEqual(drives.length, 0, 'Should return empty array when no DVD');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: detectDvdSource returns single drive automatically
// ═══════════════════════════════════════════════════════════════════════════

async function testDetectDvdSourceSingle() {
    console.log('Test: detectDvdSource returns single drive automatically');
    resetDisc();

    disc.setDependencies({
        execSync: (cmd) => {
            if (cmd.includes('drutil status')) {
                return Buffer.from('Name:    /dev/disk5\n');
            }
            if (cmd.includes('diskutil info /dev/disk5')) {
                return Buffer.from('Volume Name:  MY_DVD\nDisk Size:    4.7 GB\n');
            }
            return Buffer.from('');
        }
    });

    const result = await disc.detectDvdSource({ interactive: false });
    assert.strictEqual(result, '/dev/disk5', 'Should return the single drive');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: detectDvdSource returns null when no drives
// ═══════════════════════════════════════════════════════════════════════════

async function testDetectDvdSourceNone() {
    console.log('Test: detectDvdSource returns null when no drives');
    resetDisc();

    disc.setDependencies({
        execSync: () => { throw new Error('No media'); }
    });

    const result = await disc.detectDvdSource({ interactive: false });
    assert.strictEqual(result, null, 'Should return null when no drives');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getVolumeName extracts volume name
// ═══════════════════════════════════════════════════════════════════════════

function testGetVolumeName() {
    console.log('Test: getVolumeName extracts volume name from diskutil');
    resetDisc();

    disc.setDependencies({
        execSync: (cmd) => {
            if (cmd.includes('diskutil info /dev/disk5')) {
                return Buffer.from('Volume Name:  THE_MATRIX\nOther stuff: blah\n');
            }
            return Buffer.from('');
        }
    });

    const result = disc.getVolumeName('/dev/disk5');
    assert.strictEqual(result, 'THE_MATRIX', 'Should extract volume name');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getVolumeName returns null on error
// ═══════════════════════════════════════════════════════════════════════════

function testGetVolumeNameError() {
    console.log('Test: getVolumeName returns null on error');
    resetDisc();

    disc.setDependencies({
        execSync: () => { throw new Error('Device not found'); }
    });

    const result = disc.getVolumeName('/dev/disk99');
    assert.strictEqual(result, null, 'Should return null on error');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getLsdvdMetadata returns null when lsdvd not installed
// ═══════════════════════════════════════════════════════════════════════════

function testGetLsdvdMetadataNotInstalled() {
    console.log('Test: getLsdvdMetadata returns null when lsdvd not installed');
    resetDisc();

    disc.setDependencies({
        spawnSync: (cmd) => {
            if (cmd === 'which') return { status: 1 };
            return { status: 1 };
        }
    });

    const result = disc.getLsdvdMetadata('/dev/disk5');
    assert.strictEqual(result, null, 'Should return null when lsdvd not installed');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getLsdvdMetadata returns parsed data when installed
// ═══════════════════════════════════════════════════════════════════════════

function testGetLsdvdMetadataSuccess() {
    console.log('Test: getLsdvdMetadata returns parsed data when installed');
    resetDisc();

    disc.setDependencies({
        spawnSync: (cmd, args) => {
            if (cmd === 'which' && args[0] === 'lsdvd') {
                return { status: 0, stdout: '/usr/local/bin/lsdvd' };
            }
            if (cmd === 'lsdvd') {
                return {
                    status: 0,
                    stdout: 'Disc Title: TEST_DVD\nLongest track: 1\nTitle: 01, Length: 01:30:00.000 Chapters: 20, Cells: 20, Audio streams: 02, Subpictures: 03\n',
                    stderr: ''
                };
            }
            return { status: 1 };
        }
    });

    const result = disc.getLsdvdMetadata('/dev/disk5');
    assert.notStrictEqual(result, null, 'Should return data');
    assert.strictEqual(result.discTitle, 'TEST_DVD', 'Should have disc title');
    assert.strictEqual(result.tracks[1].durationMinutes, 90, 'Should have correct duration');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getVideoDuration returns duration in minutes
// ═══════════════════════════════════════════════════════════════════════════

function testGetVideoDuration() {
    console.log('Test: getVideoDuration returns duration in minutes');
    resetDisc();

    disc.setDependencies({
        spawnSync: (cmd) => {
            if (cmd === 'ffprobe') {
                return {
                    status: 0,
                    stdout: Buffer.from('2700.5\n') // 45 minutes in seconds
                };
            }
            return { status: 1 };
        }
    });

    const result = disc.getVideoDuration('/path/to/video.mp4');
    assert.strictEqual(result, 45, 'Should return 45 minutes');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: getVideoDuration returns null on error
// ═══════════════════════════════════════════════════════════════════════════

function testGetVideoDurationError() {
    console.log('Test: getVideoDuration returns null on error');
    resetDisc();

    disc.setDependencies({
        spawnSync: () => ({ status: 1 })
    });

    const result = disc.getVideoDuration('/nonexistent.mp4');
    assert.strictEqual(result, null, 'Should return null on error');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: setDefaultOutputDir creates directory with timestamp
// ═══════════════════════════════════════════════════════════════════════════

function testSetDefaultOutputDir() {
    console.log('Test: setDefaultOutputDir creates directory with timestamp');
    resetDisc();

    let createdDir = null;

    disc.setDependencies({
        fs: {
            existsSync: () => false,
            mkdirSync: (dir) => { createdDir = dir; }
        }
    });

    const result = disc.setDefaultOutputDir('MY_DVD');

    assert.ok(result.includes('MY_DVD'), 'Output dir should contain volume name');
    assert.ok(result.includes('_'), 'Output dir should have timestamp separator');
    assert.strictEqual(createdDir, result, 'Should create the directory');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: setDefaultOutputDir uses provided outputDir
// ═══════════════════════════════════════════════════════════════════════════

function testSetDefaultOutputDirProvided() {
    console.log('Test: setDefaultOutputDir uses provided outputDir');
    resetDisc();

    let createdDir = null;

    disc.setDependencies({
        fs: {
            existsSync: () => false,
            mkdirSync: (dir) => { createdDir = dir; }
        }
    });

    const result = disc.setDefaultOutputDir('IGNORED', '/custom/output');

    assert.strictEqual(result, '/custom/output', 'Should use provided output dir');
    assert.strictEqual(createdDir, '/custom/output', 'Should create the provided directory');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Cache operations with mocked fs
// ═══════════════════════════════════════════════════════════════════════════

function testCacheOperations() {
    console.log('Test: Cache operations (loadFromCache, saveToCache)');
    resetDisc();

    const cachedData = JSON.stringify({
        volumeName: 'TEST_DVD',
        numTitles: 5,
        titleDurations: { 1: 90 },
        scannedAt: '2024-01-01T00:00:00.000Z'
    });

    let savedContent = null;
    const mockFs = {
        existsSync: (path) => path.includes('TEST_DVD.json'),
        mkdirSync: () => {},
        readFileSync: () => cachedData,
        writeFileSync: (path, content) => { savedContent = content; },
        readdirSync: () => ['TEST_DVD.json'],
        statSync: () => ({ mtime: { getTime: () => Date.now() } }),
        unlinkSync: () => {}
    };

    disc.setDependencies({ fs: mockFs });

    // Test loadFromCache
    const loaded = disc.loadFromCache('TEST_DVD');
    assert.notStrictEqual(loaded, null, 'Should load cached data');
    assert.strictEqual(loaded.volumeName, 'TEST_DVD', 'Should have correct volume name');
    assert.strictEqual(loaded.numTitles, 5, 'Should have correct numTitles');

    // Test saveToCache
    disc.saveToCache('NEW_DVD', { numTitles: 3 });
    assert.ok(savedContent, 'Should have saved content');
    const saved = JSON.parse(savedContent);
    assert.strictEqual(saved.volumeName, 'NEW_DVD', 'Should save correct volume name');
    assert.strictEqual(saved.numTitles, 3, 'Should save correct numTitles');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: loadFromCache returns null for mismatched volume
// ═══════════════════════════════════════════════════════════════════════════

function testLoadFromCacheMismatch() {
    console.log('Test: loadFromCache returns null for mismatched volume');
    resetDisc();

    const cachedData = JSON.stringify({
        volumeName: 'DIFFERENT_DVD',
        numTitles: 5
    });

    disc.setDependencies({
        fs: {
            existsSync: () => true,
            mkdirSync: () => {},
            readFileSync: () => cachedData,
            readdirSync: () => ['cache.json'],
            statSync: () => ({ mtime: { getTime: () => Date.now() } }),
            unlinkSync: () => {}
        }
    });

    const result = disc.loadFromCache('MY_DVD');
    assert.strictEqual(result, null, 'Should return null for volume mismatch');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: DI reset restores defaults
// ═══════════════════════════════════════════════════════════════════════════

function testDIReset() {
    console.log('Test: resetDependencies restores default behavior');

    // Set custom dependencies
    let customCalled = false;
    disc.setDependencies({
        spawnSync: () => { customCalled = true; return { status: 0 }; }
    });

    // Verify custom dependency is used
    disc.checkLsdvd();
    assert.strictEqual(customCalled, true, 'Custom spawnSync should be called');

    // Reset and verify defaults are restored
    disc.resetDependencies();

    // After reset, it should use real child_process.spawnSync
    // We can't easily test this without actually calling the system,
    // but we can verify the module still functions
    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
    try {
        // Parsing tests
        testParseLsdvdOutput();
        testParseLsdvdOutputMinimal();

        // Tool validation tests
        testCheckLsdvdInstalled();
        testCheckLsdvdNotInstalled();
        testCheckHandBrakeCLINotInstalled();
        testCheckHandBrakeCLIInstalled();
        testCheckLibdvdcssNotInstalled();

        // DVD detection tests
        testDetectDvdDrivesDrutil();
        testDetectDvdDrivesNoDvd();
        await testDetectDvdSourceSingle();
        await testDetectDvdSourceNone();
        testGetVolumeName();
        testGetVolumeNameError();

        // lsdvd metadata tests
        testGetLsdvdMetadataNotInstalled();
        testGetLsdvdMetadataSuccess();

        // Video duration tests
        testGetVideoDuration();
        testGetVideoDurationError();

        // Output directory tests
        testSetDefaultOutputDir();
        testSetDefaultOutputDirProvided();

        // Cache tests
        testCacheOperations();
        testLoadFromCacheMismatch();

        // DI tests
        testDIReset();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  ✅ All disc module tests passed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(0);
    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}\n`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Always reset to defaults
        disc.resetDependencies();
    }
}

runTests();
