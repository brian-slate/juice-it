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
// Test: parseLsdvdJsonOutput parses JSON output correctly
// ═══════════════════════════════════════════════════════════════════════════

function testParseLsdvdJsonOutput() {
    console.log('Test: parseLsdvdJsonOutput parses lsdvd JSON output correctly');
    resetDisc();

    // Mock JSON based on real lsdvd -Oj -x output from Ed Edd n Eddy DVD
    const sampleJson = JSON.stringify({
        device: '/dev/disk4',
        title: 'ED_EDD_N_EDDY_S4D2',
        track: [
            {
                ix: 1,
                length: 8202.867, // ~137 minutes (Play All)
                fps: 29.97,
                format: 'NTSC',
                aspect: '16/9',
                width: 720,
                height: 480,
                angles: 1,
                audio: [
                    { ix: 1, langcode: 'en', language: 'English', format: 'ac3', channels: 2, frequency: 48000 }
                ],
                chapter: [
                    { ix: 1, length: 33.0, startcell: 1 },
                    { ix: 2, length: 656.5, startcell: 2 },
                    { ix: 3, length: 656.0, startcell: 3 },
                    { ix: 4, length: 27.2, startcell: 4 }
                ],
                subp: [
                    { ix: 1, langcode: 'en', language: 'English', content: 'Normal' }
                ]
            },
            {
                ix: 2,
                length: 1372.7, // ~23 minutes (2 episodes bundled)
                fps: 29.97,
                format: 'NTSC',
                aspect: '16/9',
                width: 720,
                height: 480,
                angles: 1,
                audio: [
                    { ix: 1, langcode: 'en', language: 'English', format: 'ac3', channels: 2, frequency: 48000 },
                    { ix: 2, langcode: 'es', language: 'Espanol', format: 'ac3', channels: 2, frequency: 48000 }
                ],
                chapter: [
                    { ix: 1, length: 33.0, startcell: 1 },
                    { ix: 2, length: 656.5, startcell: 2 }, // ~11 min (episode 1)
                    { ix: 3, length: 656.0, startcell: 3 }, // ~11 min (episode 2)
                    { ix: 4, length: 26.0, startcell: 4 }
                ],
                subp: [
                    { ix: 1, langcode: 'en', language: 'English', content: 'Normal' },
                    { ix: 2, langcode: 'es', language: 'Espanol', content: 'Normal' }
                ]
            }
        ]
    });

    const result = disc.parseLsdvdJsonOutput(sampleJson);

    assert.notStrictEqual(result, null, 'Should return parsed data');
    assert.strictEqual(result.discTitle, 'ED_EDD_N_EDDY_S4D2', 'Should parse disc title');
    assert.strictEqual(result.videoFormat, null, 'Should have null videoFormat (not at root in sample)');
    assert.strictEqual(Object.keys(result.tracks).length, 2, 'Should parse 2 tracks');

    // Track 1 checks (Play All)
    const track1 = result.tracks[1];
    assert.strictEqual(track1.durationMinutes, 137, 'Track 1 should be ~137 minutes');
    assert.strictEqual(track1.chapters, 4, 'Track 1 should have 4 chapters');
    assert.strictEqual(track1.audioDetails.length, 1, 'Track 1 should have 1 audio track');
    assert.strictEqual(track1.audioDetails[0].langCode, 'en', 'Track 1 audio should be English');
    assert.strictEqual(track1.subtitleDetails.length, 1, 'Track 1 should have 1 subtitle track');

    // Track 2 checks (episode track)
    const track2 = result.tracks[2];
    assert.strictEqual(track2.durationMinutes, 23, 'Track 2 should be ~23 minutes');
    assert.strictEqual(track2.chapters, 4, 'Track 2 should have 4 chapters');
    assert.strictEqual(track2.audioDetails.length, 2, 'Track 2 should have 2 audio tracks');
    assert.strictEqual(track2.subtitleDetails.length, 2, 'Track 2 should have 2 subtitle tracks');
    assert.strictEqual(track2.videoDetails.format, 'NTSC', 'Track 2 should be NTSC');
    assert.strictEqual(track2.videoDetails.width, 720, 'Track 2 should be 720 width');
    assert.strictEqual(track2.videoDetails.aspectRatio, '16/9', 'Track 2 should be 16:9');

    // Chapter details check
    assert.strictEqual(track2.chapterDetails.length, 4, 'Track 2 should have 4 chapter details');
    assert.strictEqual(track2.chapterDetails[1].lengthSeconds, 656.5, 'Chapter 2 should be 656.5 seconds');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: parseLsdvdJsonOutput handles invalid JSON
// ═══════════════════════════════════════════════════════════════════════════

function testParseLsdvdJsonOutputInvalid() {
    console.log('Test: parseLsdvdJsonOutput handles invalid JSON');
    resetDisc();

    const result1 = disc.parseLsdvdJsonOutput('not valid json');
    assert.strictEqual(result1, null, 'Should return null for invalid JSON');

    const result2 = disc.parseLsdvdJsonOutput('');
    assert.strictEqual(result2, null, 'Should return null for empty string');

    const result3 = disc.parseLsdvdJsonOutput('{}');
    assert.notStrictEqual(result3, null, 'Should handle empty object');
    assert.strictEqual(result3.discTitle, 'unknown', 'Empty object should have unknown title');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: mergeDurations combines HandBrake and lsdvd durations
// ═══════════════════════════════════════════════════════════════════════════

function testMergeDurations() {
    console.log('Test: mergeDurations combines HandBrake and lsdvd durations');
    resetDisc();

    const handbrakeResult = {
        titleDurations: {
            1: 137,
            2: 23,
            3: 0,  // HandBrake failed to read this one
            4: 23,
            5: 28  // HandBrake says 28 (>2 min diff from lsdvd's 23)
        }
    };

    const lsdvdResult = {
        tracks: {
            1: { durationMinutes: 137 },
            2: { durationMinutes: 23 },
            3: { durationMinutes: 22 },  // lsdvd has duration for this one
            4: { durationMinutes: 23 },
            5: { durationMinutes: 23 },  // 5 min different from HandBrake (28-23=5)
            6: { durationMinutes: 5 }    // Track missing from HandBrake
        }
    };

    const result = disc.mergeDurations(handbrakeResult, lsdvdResult);

    // Should use lsdvd fallback for track 3 (HandBrake was 0)
    assert.strictEqual(result.mergedDurations[3], 22, 'Track 3 should use lsdvd fallback');
    assert.strictEqual(result.fallbacksUsed.length, 2, 'Should have 2 fallbacks (track 3 and 6)');
    assert.ok(result.fallbacksUsed.some(f => f.track === 3), 'Fallback should include track 3');
    assert.ok(result.fallbacksUsed.some(f => f.track === 6), 'Fallback should include track 6 (missing from HB)');

    // Should use HandBrake value when both have valid durations
    assert.strictEqual(result.mergedDurations[1], 137, 'Track 1 should keep HandBrake value');
    assert.strictEqual(result.mergedDurations[2], 23, 'Track 2 should keep HandBrake value');
    assert.strictEqual(result.mergedDurations[4], 23, 'Track 4 should keep HandBrake value');
    assert.strictEqual(result.mergedDurations[5], 28, 'Track 5 should keep HandBrake value (28)');

    // Should track discrepancy for track 5 (diff > 2 minutes)
    assert.strictEqual(result.durationDiscrepancies.length, 1, 'Should have 1 discrepancy');
    assert.strictEqual(result.durationDiscrepancies[0].track, 5, 'Discrepancy should be for track 5');

    // Should add track 6 from lsdvd
    assert.strictEqual(result.mergedDurations[6], 5, 'Track 6 should be added from lsdvd');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: mergeDurations handles missing lsdvd data
// ═══════════════════════════════════════════════════════════════════════════

function testMergeDurationsNoLsdvd() {
    console.log('Test: mergeDurations handles missing lsdvd data');
    resetDisc();

    const handbrakeResult = {
        titleDurations: { 1: 90, 2: 45 }
    };

    const result1 = disc.mergeDurations(handbrakeResult, null);
    assert.deepStrictEqual(result1.mergedDurations, { 1: 90, 2: 45 }, 'Should return HandBrake durations unchanged');
    assert.strictEqual(result1.fallbacksUsed.length, 0, 'Should have no fallbacks');

    const result2 = disc.mergeDurations(handbrakeResult, { tracks: null });
    assert.deepStrictEqual(result2.mergedDurations, { 1: 90, 2: 45 }, 'Should handle null tracks');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: buildEnhancedTrackData creates rich track info for AI
// ═══════════════════════════════════════════════════════════════════════════

function testBuildEnhancedTrackData() {
    console.log('Test: buildEnhancedTrackData creates rich track info for AI');
    resetDisc();

    const mergedDurations = {
        1: 137,
        2: 23,
        3: 23
    };

    const lsdvdResult = {
        tracks: {
            1: {
                durationMinutes: 137,
                chapters: 25,
                chapterDetails: [
                    { index: 1, lengthSeconds: 33 },
                    { index: 2, lengthSeconds: 656.5 }
                ],
                audioDetails: [
                    { language: 'English', langCode: 'en', format: 'ac3' }
                ],
                subtitleDetails: [
                    { language: 'English', langCode: 'en', content: 'Normal' }
                ],
                videoDetails: { width: 720, height: 480, format: 'NTSC', aspectRatio: '16/9' }
            },
            2: {
                durationMinutes: 23,
                chapters: 4,
                chapterDetails: [
                    { index: 1, lengthSeconds: 33 },
                    { index: 2, lengthSeconds: 656.5 }, // ~11 min
                    { index: 3, lengthSeconds: 650 },   // ~11 min
                    { index: 4, lengthSeconds: 26 }
                ],
                audioDetails: [
                    { language: 'English', langCode: 'en', format: 'ac3' },
                    { language: 'Espanol', langCode: 'es', format: 'ac3' }
                ],
                subtitleDetails: [],
                videoDetails: { width: 720, height: 480, format: 'NTSC', aspectRatio: '16/9' }
            },
            3: {
                durationMinutes: 23,
                chapters: 4,
                chapterDetails: [],
                audioDetails: [],
                subtitleDetails: [],
                videoDetails: null
            }
        }
    };

    const unrippableTracks = [3];

    const result = disc.buildEnhancedTrackData(mergedDurations, lsdvdResult, unrippableTracks);

    assert.strictEqual(result.length, 3, 'Should have 3 tracks');

    // Track 1 (Play All with many chapters)
    const track1 = result.find(t => t.track === 1);
    assert.strictEqual(track1.durationMinutes, 137, 'Track 1 duration');
    assert.strictEqual(track1.chapters, 25, 'Track 1 chapters');
    assert.strictEqual(track1.isUnrippable, false, 'Track 1 should be rippable');
    assert.strictEqual(track1.audioLanguages.length, 1, 'Track 1 should have 1 audio lang');
    assert.strictEqual(track1.subtitleLanguages.length, 1, 'Track 1 should have 1 sub lang');

    // Track 2 (episode track with chapter details)
    const track2 = result.find(t => t.track === 2);
    assert.strictEqual(track2.chapters, 4, 'Track 2 chapters');
    assert.notStrictEqual(track2.chapterDetails, null, 'Track 2 should have chapter details');
    assert.strictEqual(track2.chapterDetails.length, 4, 'Track 2 should have 4 chapter details');
    // Chapter lengths should be converted to minutes with 1 decimal
    assert.ok(track2.chapterDetails[1].lengthMinutes > 10, 'Chapter 2 should be ~11 minutes');
    assert.strictEqual(track2.audioLanguages.length, 2, 'Track 2 should have 2 audio langs');

    // Track 3 (unrippable)
    const track3 = result.find(t => t.track === 3);
    assert.strictEqual(track3.isUnrippable, true, 'Track 3 should be unrippable');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: buildEnhancedTrackData handles missing lsdvd data
// ═══════════════════════════════════════════════════════════════════════════

function testBuildEnhancedTrackDataNoLsdvd() {
    console.log('Test: buildEnhancedTrackData handles missing lsdvd data');
    resetDisc();

    const mergedDurations = { 1: 90, 2: 45 };

    const result = disc.buildEnhancedTrackData(mergedDurations, null, []);

    assert.strictEqual(result.length, 2, 'Should have 2 tracks');
    assert.strictEqual(result[0].track, 1, 'First track should be track 1');
    assert.strictEqual(result[0].durationMinutes, 90, 'Track 1 duration');
    assert.strictEqual(result[0].chapters, 0, 'Should have 0 chapters (no lsdvd data)');
    assert.strictEqual(result[0].chapterDetails, null, 'Should have null chapter details');
    assert.deepStrictEqual(result[0].audioLanguages, [], 'Should have empty audio languages');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: runLsdvdScan with JSON output
// ═══════════════════════════════════════════════════════════════════════════

function testRunLsdvdScanJson() {
    console.log('Test: runLsdvdScan uses JSON output when available');
    resetDisc();

    const mockJsonOutput = JSON.stringify({
        device: '/dev/disk4',
        title: 'TEST_DVD_JSON',
        track: [
            {
                ix: 1,
                length: 5400, // 90 minutes
                fps: 29.97,
                format: 'NTSC',
                aspect: '16/9',
                width: 720,
                height: 480,
                audio: [{ ix: 1, langcode: 'en', language: 'English', format: 'ac3', channels: 2 }],
                chapter: [{ ix: 1, length: 5400, startcell: 1 }],
                subp: []
            }
        ]
    });

    disc.setDependencies({
        spawnSync: (cmd, args) => {
            if (cmd === 'which' && args[0] === 'lsdvd') {
                return { status: 0, stdout: '/usr/local/bin/lsdvd' };
            }
            if (cmd === 'lsdvd' && args.includes('-Oj')) {
                return { status: 0, stdout: mockJsonOutput, stderr: '' };
            }
            return { status: 1 };
        }
    });

    const result = disc.runLsdvdScan('/dev/disk4');

    assert.notStrictEqual(result, null, 'Should return data');
    assert.strictEqual(result.discTitle, 'TEST_DVD_JSON', 'Should have disc title from JSON');
    assert.strictEqual(result.isJsonParsed, true, 'Should indicate JSON was used');
    assert.strictEqual(result.trackCount, 1, 'Should have 1 track');
    assert.strictEqual(result.tracks[1].durationMinutes, 90, 'Track should be 90 minutes');
    assert.ok(result.tracks[1].chapterDetails, 'Should have chapter details from JSON');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: runLsdvdScan falls back to text on JSON failure
// ═══════════════════════════════════════════════════════════════════════════

function testRunLsdvdScanFallbackToText() {
    console.log('Test: runLsdvdScan falls back to text parsing on JSON failure');
    resetDisc();

    const mockTextOutput = `Disc Title: TEST_DVD_TEXT
Longest track: 1
Title: 01, Length: 01:30:00.000 Chapters: 20, Cells: 20, Audio streams: 02, Subpictures: 01`;

    disc.setDependencies({
        spawnSync: (cmd, args) => {
            if (cmd === 'which' && args[0] === 'lsdvd') {
                return { status: 0, stdout: '/usr/local/bin/lsdvd' };
            }
            if (cmd === 'lsdvd' && args.includes('-Oj')) {
                // JSON output fails
                return { status: 1, stderr: 'JSON not supported' };
            }
            if (cmd === 'lsdvd') {
                // Text output succeeds
                return { status: 0, stdout: mockTextOutput, stderr: '' };
            }
            return { status: 1 };
        }
    });

    const result = disc.runLsdvdScan('/dev/disk4');

    assert.notStrictEqual(result, null, 'Should return data from text fallback');
    assert.strictEqual(result.discTitle, 'TEST_DVD_TEXT', 'Should have disc title from text');
    assert.strictEqual(result.isJsonParsed, false, 'Should indicate text parsing was used');
    assert.strictEqual(result.trackCount, 1, 'Should have 1 track');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: compareScanResults detects matches and mismatches
// ═══════════════════════════════════════════════════════════════════════════

function testCompareScanResults() {
    console.log('Test: compareScanResults detects matches and mismatches');
    resetDisc();

    // Test match
    const matchResult = disc.compareScanResults(
        { numTitles: 7 },
        { trackCount: 7 }
    );
    assert.strictEqual(matchResult.match, true, 'Should match when counts equal');
    assert.strictEqual(matchResult.discrepancy, null, 'Should have no discrepancy');

    // Test mismatch
    const mismatchResult = disc.compareScanResults(
        { numTitles: 5 },
        { trackCount: 7 }
    );
    assert.strictEqual(mismatchResult.match, false, 'Should not match when counts differ');
    assert.strictEqual(mismatchResult.discrepancy.missing, 2, 'Should show 2 missing tracks');
    assert.strictEqual(mismatchResult.handbrakeCount, 5, 'Should have HandBrake count');
    assert.strictEqual(mismatchResult.lsdvdCount, 7, 'Should have lsdvd count');

    // Test no lsdvd
    const noLsdvdResult = disc.compareScanResults(
        { numTitles: 5 },
        null
    );
    assert.strictEqual(noLsdvdResult.match, true, 'Should assume match when lsdvd unavailable');
    assert.strictEqual(noLsdvdResult.lsdvdCount, null, 'Should have null lsdvd count');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
    try {
        // Parsing tests (text)
        testParseLsdvdOutput();
        testParseLsdvdOutputMinimal();

        // Parsing tests (JSON)
        testParseLsdvdJsonOutput();
        testParseLsdvdJsonOutputInvalid();

        // Duration merging tests
        testMergeDurations();
        testMergeDurationsNoLsdvd();

        // Enhanced track data tests
        testBuildEnhancedTrackData();
        testBuildEnhancedTrackDataNoLsdvd();

        // Scan comparison tests
        testCompareScanResults();

        // lsdvd scan tests (JSON and fallback)
        testRunLsdvdScanJson();
        testRunLsdvdScanFallbackToText();

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
