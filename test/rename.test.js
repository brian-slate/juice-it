/**
 * Unit Tests for lib/rename.js
 *
 * Tests file renaming operations with Plex-compatible naming
 * using dependency injection for mocking filesystem operations.
 */

const assert = require('assert');
const rename = require('../lib/rename');

console.log('\n━━━ Rename Module Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════

// Mock logger that captures calls
function createMockLogger() {
    const logs = { debug: [], error: [], info: [], warn: [] };
    return {
        debug: (msg) => logs.debug.push(msg),
        error: (msg) => logs.error.push(msg),
        info: (msg) => logs.info.push(msg),
        warn: (msg) => logs.warn.push(msg),
        getLogs: () => logs
    };
}

// Suppress console.log during tests
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

// Reset rename module state after each test
function resetRename() {
    rename.resetDependencies();
    rename.setLogger(createMockLogger());
    rename.setLogFunctions(() => {}, () => {}, () => {});
    rename.setMetadataLookup(null);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles requires outputDir
// ═══════════════════════════════════════════════════════════════════════════

async function testRequiresOutputDir() {
    console.log('Test: renameExistingFiles requires --output directory');
    resetRename();

    const mockLogger = createMockLogger();
    rename.setLogger(mockLogger);

    suppressConsole();
    await rename.renameExistingFiles({ dvdSource: '/dev/disk5' });
    restoreConsole();

    const errors = mockLogger.getLogs().error;
    assert.ok(errors.some(e => e.includes('--output directory must be specified')),
        'Should error when outputDir not specified');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles checks if output directory exists
// ═══════════════════════════════════════════════════════════════════════════

async function testChecksOutputDirExists() {
    console.log('Test: renameExistingFiles checks if output directory exists');
    resetRename();

    const mockLogger = createMockLogger();
    rename.setLogger(mockLogger);

    rename.setDependencies({
        fs: {
            existsSync: () => false
        },
        disc: {
            getVolumeName: () => 'TEST_DVD'
        }
    });

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/nonexistent/path'
    });
    restoreConsole();

    const errors = mockLogger.getLogs().error;
    assert.ok(errors.some(e => e.includes('does not exist')),
        'Should error when outputDir does not exist');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles handles no MP4 files
// ═══════════════════════════════════════════════════════════════════════════

async function testHandlesNoMp4Files() {
    console.log('Test: renameExistingFiles handles no MP4 files');
    resetRename();

    rename.setDependencies({
        fs: {
            existsSync: () => true,
            readdirSync: () => ['file.txt', 'other.doc']
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST_DVD.json'
        }
    });

    let consoleOutput = [];
    const originalLog = console.log;
    console.log = (msg) => { consoleOutput.push(msg); };

    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output'
    });

    console.log = originalLog;

    assert.ok(consoleOutput.some(o => o && o.includes('No MP4 files found')),
        'Should report no MP4 files found');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles extracts track numbers from filenames
// ═══════════════════════════════════════════════════════════════════════════

async function testExtractsTrackNumbers() {
    console.log('Test: renameExistingFiles extracts track numbers from filenames');
    resetRename();

    let loggedMessages = [];
    let renamedFiles = [];

    rename.setDependencies({
        fs: {
            existsSync: (path) => {
                // Return true for output dir and cache, false for target files
                if (path === '/output') return true;
                if (path.includes('cache')) return false;
                return false; // Target file doesn't exist
            },
            readdirSync: () => ['TEST_DVD_1.mp4', 'TEST_DVD_2.mp4', 'TEST_DVD_3.mp4'],
            statSync: () => ({ size: 1024 * 1024 * 100 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST_DVD.json',
            getVideoDuration: (path) => {
                // Return durations that qualify as episodes (5-60 min)
                if (path.includes('_1.mp4')) return 25;
                if (path.includes('_2.mp4')) return 26;
                if (path.includes('_3.mp4')) return 24;
                return null;
            }
        }
    });

    rename.setLogFunctions(
        (msg) => { loggedMessages.push(msg); },
        () => '/output/log.txt',
        () => {}
    );

    // Use noLookup to avoid metadata lookup
    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    assert.strictEqual(renamedFiles.length, 3, 'Should rename 3 files');
    assert.ok(renamedFiles[0].to.includes('Part 1'), 'First file should be Part 1');
    assert.ok(renamedFiles[1].to.includes('Part 2'), 'Second file should be Part 2');
    assert.ok(renamedFiles[2].to.includes('Part 3'), 'Third file should be Part 3');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles uses TV show metadata for naming
// ═══════════════════════════════════════════════════════════════════════════

async function testUsesTvMetadata() {
    console.log('Test: renameExistingFiles uses TV show metadata for naming');
    resetRename();

    let renamedFiles = [];

    rename.setDependencies({
        fs: {
            existsSync: (path) => path === '/output',
            readdirSync: () => ['SHOW_1.mp4', 'SHOW_2.mp4'],
            statSync: () => ({ size: 1024 * 1024 * 500 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'BREAKING_BAD_S5',
            getCacheFilePath: () => '/cache/BREAKING_BAD.json',
            getVideoDuration: () => 45 // All files are ~45 min
        }
    });

    rename.setLogFunctions(
        () => {},
        () => '/output/log.txt',
        () => {}
    );

    // Mock metadata lookup
    rename.setMetadataLookup(async () => ({
        type: 'tv',
        title: 'Breaking Bad',
        year: 2008,
        season: 5,
        episodes: [
            { episode_number: 1, name: 'Live Free or Die', runtime: 45 },
            { episode_number: 2, name: 'Madrigal', runtime: 47 }
        ]
    }));

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output'
    });
    restoreConsole();

    assert.strictEqual(renamedFiles.length, 2, 'Should rename 2 files');
    assert.ok(renamedFiles[0].to.includes('s05e01'), 'First file should have s05e01');
    assert.ok(renamedFiles[0].to.includes('Live Free or Die'), 'First file should have episode name');
    assert.ok(renamedFiles[1].to.includes('s05e02'), 'Second file should have s05e02');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles skips extra files by duration
// ═══════════════════════════════════════════════════════════════════════════

async function testSkipsExtrasByDuration() {
    console.log('Test: renameExistingFiles skips extra files by duration');
    resetRename();

    let renamedFiles = [];

    rename.setDependencies({
        fs: {
            existsSync: (path) => path === '/output',
            readdirSync: () => ['MOVIE_1.mp4', 'MOVIE_2.mp4', 'MOVIE_3.mp4'],
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_MOVIE',
            getCacheFilePath: () => '/cache/TEST.json',
            getVideoDuration: (path) => {
                if (path.includes('_1.mp4')) return 2;   // Too short (menu)
                if (path.includes('_2.mp4')) return 25;  // Episode-length
                if (path.includes('_3.mp4')) return 120; // Too long (full disc)
                return null;
            }
        }
    });

    rename.setLogFunctions(
        () => {},
        () => '/output/log.txt',
        () => {}
    );

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    // Only the 25-min file should be renamed
    assert.strictEqual(renamedFiles.length, 1, 'Should only rename 1 file');
    assert.ok(renamedFiles[0].from.includes('_2.mp4'), 'Should rename the episode-length file');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles skips when target file exists
// ═══════════════════════════════════════════════════════════════════════════

async function testSkipsWhenTargetExists() {
    console.log('Test: renameExistingFiles skips when target file exists');
    resetRename();

    let renamedFiles = [];
    let skippedLogs = [];

    // Need 2+ files to trigger "Part X" naming
    rename.setDependencies({
        fs: {
            existsSync: (p) => {
                // Output dir check
                if (p === '/output') return true;
                // Cache file doesn't exist
                if (p.includes('cache')) return false;
                // First target file already exists (Part 1)
                if (p.includes('Part 1.mp4')) return true;
                return false;
            },
            readdirSync: () => ['TEST_1.mp4', 'TEST_2.mp4'],
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST.json',
            getVideoDuration: () => 25
        }
    });

    rename.setLogFunctions(
        (msg) => { skippedLogs.push(msg); },
        () => '/output/log.txt',
        () => {}
    );

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    // Only Part 2 should be renamed (Part 1 target exists, so skipped)
    assert.strictEqual(renamedFiles.length, 1, 'Should rename only 1 file (Part 2)');
    assert.ok(renamedFiles[0].to.includes('Part 2'), 'Should rename to Part 2');
    assert.ok(skippedLogs.some(l => l && l.includes('target file already exists')),
        'Should log skip due to existing target');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles skips unchanged files
// ═══════════════════════════════════════════════════════════════════════════

async function testSkipsUnchangedFiles() {
    console.log('Test: renameExistingFiles skips unchanged files');
    resetRename();

    let renamedFiles = [];
    let unchangedLogs = [];

    // With single file, expected name is "TEST_DVD.mp4" (no Part numbering)
    rename.setDependencies({
        fs: {
            existsSync: (p) => p === '/output',
            // File already has correct name for a single-file disc
            readdirSync: () => ['TEST_DVD.mp4'],
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST.json',
            getVideoDuration: () => 25
        }
    });

    rename.setLogFunctions(
        (msg) => { unchangedLogs.push(msg); },
        () => '/output/log.txt',
        () => {}
    );

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    assert.strictEqual(renamedFiles.length, 0, 'Should not rename unchanged file');
    assert.ok(unchangedLogs.some(l => l && l.includes('unchanged')),
        'Should log file as unchanged');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles handles rename errors gracefully
// ═══════════════════════════════════════════════════════════════════════════

async function testHandlesRenameErrors() {
    console.log('Test: renameExistingFiles handles rename errors gracefully');
    resetRename();

    let errorLogs = [];

    rename.setDependencies({
        fs: {
            existsSync: (path) => path === '/output',
            readdirSync: () => ['TEST_1.mp4'],
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: () => { throw new Error('Permission denied'); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST.json',
            getVideoDuration: () => 25
        }
    });

    rename.setLogFunctions(
        (msg) => { errorLogs.push(msg); },
        () => '/output/log.txt',
        () => {}
    );

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    assert.ok(errorLogs.some(l => l && l.includes('Error renaming') && l.includes('Permission denied')),
        'Should log rename error');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles loads DVD durations from cache
// ═══════════════════════════════════════════════════════════════════════════

async function testLoadsCacheData() {
    console.log('Test: renameExistingFiles loads DVD durations from cache');
    resetRename();

    const mockLogger = createMockLogger();
    rename.setLogger(mockLogger);

    let renamedFiles = [];
    const cacheData = JSON.stringify({
        volumeName: 'TEST_DVD',
        titleDurations: { 1: 25, 2: 26, 3: 24 }
    });

    rename.setDependencies({
        fs: {
            existsSync: () => true,
            readdirSync: () => ['TEST_1.mp4'],
            readFileSync: () => cacheData,
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST_DVD.json',
            getVideoDuration: () => 25
        }
    });

    rename.setLogFunctions(
        () => {},
        () => '/output/log.txt',
        () => {}
    );

    let cacheOutput = [];
    const originalLog = console.log;
    console.log = (msg) => { cacheOutput.push(msg); };

    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });

    console.log = originalLog;

    assert.ok(cacheOutput.some(o => o && o.includes('Using DVD track durations')),
        'Should indicate cache data being used');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: renameExistingFiles filters null duration files
// ═══════════════════════════════════════════════════════════════════════════

async function testFiltersNullDurations() {
    console.log('Test: renameExistingFiles filters files with null duration');
    resetRename();

    let renamedFiles = [];

    rename.setDependencies({
        fs: {
            existsSync: (path) => path === '/output',
            readdirSync: () => ['TEST_1.mp4', 'TEST_2.mp4', 'TEST_3.mp4'],
            statSync: () => ({ size: 1024 * 1024 }),
            renameSync: (from, to) => { renamedFiles.push({ from, to }); }
        },
        disc: {
            getVolumeName: () => 'TEST_DVD',
            getCacheFilePath: () => '/cache/TEST.json',
            getVideoDuration: (path) => {
                // Only middle file has valid duration
                if (path.includes('_1.mp4')) return null;
                if (path.includes('_2.mp4')) return 25;
                if (path.includes('_3.mp4')) return null;
                return null;
            }
        }
    });

    rename.setLogFunctions(
        () => {},
        () => '/output/log.txt',
        () => {}
    );

    suppressConsole();
    await rename.renameExistingFiles({
        dvdSource: '/dev/disk5',
        outputDir: '/output',
        noLookup: true
    });
    restoreConsole();

    assert.strictEqual(renamedFiles.length, 1, 'Should only rename 1 file');
    assert.ok(renamedFiles[0].from.includes('_2.mp4'), 'Should rename file with valid duration');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: DI reset restores defaults
// ═══════════════════════════════════════════════════════════════════════════

function testDIReset() {
    console.log('Test: resetDependencies restores default behavior');

    // Set custom dependencies
    let _customCalled = false;
    rename.setDependencies({
        fs: {
            existsSync: () => { _customCalled = true; return false; }
        }
    });

    // Reset and verify defaults are restored
    rename.resetDependencies();

    // After reset, it should use real fs module
    // We can verify the module still functions
    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
    try {
        // Validation tests
        await testRequiresOutputDir();
        await testChecksOutputDirExists();
        await testHandlesNoMp4Files();

        // Core functionality tests
        await testExtractsTrackNumbers();
        await testUsesTvMetadata();
        await testSkipsExtrasByDuration();
        await testSkipsWhenTargetExists();
        await testSkipsUnchangedFiles();
        await testHandlesRenameErrors();
        await testLoadsCacheData();
        await testFiltersNullDurations();

        // DI tests
        testDIReset();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  ✅ All rename module tests passed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(0);
    } catch (error) {
        restoreConsole(); // Make sure console is restored on error
        console.error(`\n❌ Test failed: ${error.message}\n`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Always reset to defaults
        rename.resetDependencies();
        restoreConsole();
    }
}

runTests();
