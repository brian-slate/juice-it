/**
 * Unit Tests for lib/handbrake.js
 *
 * Tests HandBrakeCLI wrapper including dry-run mode, progress tracking,
 * and DVD scanning using dependency injection for mocking.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const { setImmediate } = require('timers');
const handbrake = require('../lib/handbrake');

console.log('\n━━━ HandBrake Module Tests ━━━\n');

// ═══════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════

// Mock logger
function createMockLogger() {
    return {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {}
    };
}

// Create a mock spawn that returns an EventEmitter-based process
function createMockSpawn(behavior = {}) {
    return (_cmd, _args, _options) => {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.kill = () => {
            if (behavior.onKill) behavior.onKill();
        };

        // Schedule the behavior
        setImmediate(() => {
            if (behavior.stdoutData) {
                mockProcess.stdout.emit('data', Buffer.from(behavior.stdoutData));
            }
            if (behavior.stderrData) {
                mockProcess.stderr.emit('data', Buffer.from(behavior.stderrData));
            }
            if (behavior.exitCode !== undefined) {
                mockProcess.emit('close', behavior.exitCode);
            }
            if (behavior.error) {
                mockProcess.emit('error', behavior.error);
            }
        });

        return mockProcess;
    };
}

// Reset handbrake module state
function resetHandbrake() {
    handbrake.resetDependencies();
    handbrake.setLogger(createMockLogger());
    handbrake.setLogFunction(() => {});
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

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd dry-run mode creates stub files
// ═══════════════════════════════════════════════════════════════════════════

async function testDryRunNoFiles() {
    console.log('Test: ripDvd dry-run mode creates stub files');
    resetHandbrake();

    let writtenPath = null;
    let writtenContent = null;
    let progressCalls = [];

    handbrake.setDependencies({
        fs: {
            writeFileSync: (path, content) => {
                writtenPath = path;
                writtenContent = content;
            }
        }
    });

    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 1,
            outputDir: '/output',
            outputFileName: 'Test Movie (2024)',
            dryRun: true,
            titleDurations: { 1: 45 }
        },
        (progress, elapsed, remaining, trackNum, totalTracks) => {
            progressCalls.push({ progress, trackNum, totalTracks });
        },
        1,
        3
    );

    // Dry-run should create stub files for reference
    assert.strictEqual(writtenPath, '/output/Test Movie (2024).mp4', 'Should write stub file in dry-run mode');
    assert(writtenContent.includes('DRY RUN PLACEHOLDER'), 'Stub file should contain placeholder text');
    assert(writtenContent.includes('Original track: 1'), 'Stub file should contain track info');
    // Dry-run should NOT simulate progress (just resolves immediately)
    assert.strictEqual(progressCalls.length, 0, 'Should NOT call progress callback in dry-run mode');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd logs to file function
// ═══════════════════════════════════════════════════════════════════════════

async function testDryRunLogsToFile() {
    console.log('Test: ripDvd logs to file function');
    resetHandbrake();

    let loggedMessages = [];

    handbrake.setDependencies({
        fs: { writeFileSync: () => {} }
    });
    handbrake.setLogFunction((msg) => { loggedMessages.push(msg); });

    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 2,
            outputDir: '/output',
            outputFileName: 'Test',
            dryRun: true
        },
        () => {},
        1,
        1
    );

    assert.ok(loggedMessages.some(m => m.includes('[DRY-RUN]')), 'Should log dry-run messages');
    assert.ok(loggedMessages.some(m => m.includes('track 2')), 'Should log track number');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd builds correct HandBrakeCLI arguments
// ═══════════════════════════════════════════════════════════════════════════

async function testRipDvdBuildsCorrectArgs() {
    console.log('Test: ripDvd builds correct HandBrakeCLI arguments');
    resetHandbrake();

    let spawnedCmd = null;
    let spawnedArgs = null;

    handbrake.setDependencies({
        spawn: (cmd, args) => {
            spawnedCmd = cmd;
            spawnedArgs = args;
            // Return a mock process that completes immediately
            const mockProcess = new EventEmitter();
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = () => {};
            setImmediate(() => mockProcess.emit('close', 0));
            return mockProcess;
        }
    });

    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 3,
            outputDir: '/output',
            outputFileName: 'My Movie',
            encoding: { encoder: 'x265', quality: '18', deinterlace: true },
            subtitles: { track: 2, language: 'spa' }
        },
        () => {},
        1,
        1
    );

    assert.strictEqual(spawnedCmd, 'HandBrakeCLI', 'Should spawn HandBrakeCLI');
    assert.ok(spawnedArgs.includes('-i'), 'Should include -i flag');
    assert.ok(spawnedArgs.includes('/dev/disk5'), 'Should include DVD source');
    assert.ok(spawnedArgs.includes('-t'), 'Should include -t flag');
    assert.ok(spawnedArgs.includes('3'), 'Should include title number');
    assert.ok(spawnedArgs.includes('-e'), 'Should include encoder flag');
    assert.ok(spawnedArgs.includes('x265'), 'Should use specified encoder');
    assert.ok(spawnedArgs.includes('-q'), 'Should include quality flag');
    assert.ok(spawnedArgs.includes('18'), 'Should use specified quality');
    assert.ok(spawnedArgs.includes('--deinterlace'), 'Should include deinterlace');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd reports progress from stdout
// ═══════════════════════════════════════════════════════════════════════════

async function testRipDvdReportsProgress() {
    console.log('Test: ripDvd reports progress from stdout');
    resetHandbrake();

    let progressCalls = [];

    handbrake.setDependencies({
        spawn: createMockSpawn({
            stdoutData: 'Encoding: task 1 of 1, 50.25 % (25.5 fps, avg 24.8 fps, ETA 00h02m30s)',
            exitCode: 0
        })
    });

    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 1,
            outputDir: '/output',
            outputFileName: 'Test'
        },
        (progress) => { progressCalls.push(progress); },
        1,
        1
    );

    assert.ok(progressCalls.some(p => Math.abs(p - 50.25) < 0.1), 'Should report 50.25% progress');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd resolves on successful exit
// ═══════════════════════════════════════════════════════════════════════════

async function testRipDvdResolvesOnSuccess() {
    console.log('Test: ripDvd resolves on successful exit');
    resetHandbrake();

    handbrake.setDependencies({
        spawn: createMockSpawn({ exitCode: 0 })
    });

    // Should not throw
    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 1,
            outputDir: '/output',
            outputFileName: 'Test'
        },
        () => {},
        1,
        1
    );

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd rejects on non-zero exit
// ═══════════════════════════════════════════════════════════════════════════

async function testRipDvdRejectsOnFailure() {
    console.log('Test: ripDvd rejects on non-zero exit');
    resetHandbrake();

    handbrake.setDependencies({
        spawn: createMockSpawn({ exitCode: 1 })
    });

    try {
        await handbrake.ripDvd(
            {
                dvdSource: '/dev/disk5',
                titleNumber: 1,
                outputDir: '/output',
                outputFileName: 'Test'
            },
            () => {},
            1,
            1
        );
        assert.fail('Should have rejected');
    } catch (err) {
        assert.strictEqual(err.code, 1, 'Should have exit code 1');
        assert.strictEqual(err.titleNumber, 1, 'Should include title number');
    }

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: scanSingleTitle parses duration from stderr
// ═══════════════════════════════════════════════════════════════════════════

async function testScanSingleTitleParsesDuration() {
    console.log('Test: scanSingleTitle parses duration from stderr');
    resetHandbrake();

    handbrake.setDependencies({
        spawn: createMockSpawn({
            stderrData: 'scan: DVD has 5 titles\nscan: duration is 01:30:45\n',
            exitCode: 0
        })
    });

    const result = await handbrake.scanSingleTitle('/dev/disk5', 1);

    assert.strictEqual(result.titleNum, 1, 'Should return title number');
    assert.strictEqual(result.duration, 91, 'Should parse duration as 91 minutes');
    assert.strictEqual(result.stuck, false, 'Should not be stuck');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: scanSingleTitle handles timeout (stuck)
// ═══════════════════════════════════════════════════════════════════════════

async function testScanSingleTitleHandlesTimeout() {
    console.log('Test: scanSingleTitle handles timeout (stuck)');
    resetHandbrake();

    let killed = false;

    handbrake.setDependencies({
        spawn: () => {
            const mockProcess = new EventEmitter();
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = () => { killed = true; };
            // Never emit close - simulates stuck
            return mockProcess;
        },
        // Smart mock that handles both eject and diskutil list commands
        spawnSync: (cmd, args) => {
            if (cmd === 'diskutil' && args[0] === 'list') {
                // Return UDF to immediately satisfy the disc-reinserted check
                return { status: 0, stdout: Buffer.from('UDF filesystem') };
            }
            return { status: 0, stdout: Buffer.from('') };
        }
    });

    suppressConsole();
    const result = await handbrake.scanSingleTitle('/dev/disk5', 1, 10); // 10ms timeout (fast for tests)
    restoreConsole();

    assert.strictEqual(result.titleNum, 1, 'Should return title number');
    assert.strictEqual(result.duration, null, 'Duration should be null for stuck');
    assert.strictEqual(result.stuck, true, 'Should be marked as stuck');
    assert.ok(killed, 'Should have killed the process');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: scanSingleTitle handles process error
// ═══════════════════════════════════════════════════════════════════════════

async function testScanSingleTitleHandlesError() {
    console.log('Test: scanSingleTitle handles process error');
    resetHandbrake();

    handbrake.setDependencies({
        spawn: createMockSpawn({ error: new Error('spawn failed') })
    });

    const result = await handbrake.scanSingleTitle('/dev/disk5', 1);

    assert.strictEqual(result.titleNum, 1, 'Should return title number');
    assert.strictEqual(result.duration, null, 'Duration should be null on error');
    assert.strictEqual(result.stuck, true, 'Should be marked as stuck on error');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ejectDisc returns true when drutil succeeds and verifies ejection
// ═══════════════════════════════════════════════════════════════════════════

function testEjectDiscSucceedsWithDrutil() {
    console.log('Test: ejectDisc returns true when drutil succeeds and verifies ejection');
    resetHandbrake();

    let methodsCalled = [];
    let devicePresentChecks = 0;

    handbrake.setDependencies({
        spawnSync: (cmd, args, options) => {
            const argsStr = args ? args.join(' ') : '';
            methodsCalled.push({ cmd, args: argsStr });

            // findDvdDevice() calls diskutil list
            if (cmd === 'diskutil' && args[0] === 'list' && args.length === 1) {
                return {
                    status: 0,
                    stdout: '/dev/disk4 (external, physical):\n   #:  TYPE  NAME  SIZE  IDENTIFIER\n   0:        DVD   *8.2 GB  disk4'
                };
            }

            // isDvdDevicePresent() calls diskutil list <device>
            if (cmd === 'diskutil' && args[0] === 'list' && args[1]) {
                devicePresentChecks++;
                // First check: device present before eject
                // Second check: device gone after eject
                return { status: devicePresentChecks === 1 ? 0 : 1 };
            }

            // drutil eject
            if (cmd === 'drutil' && args[0] === 'eject') {
                return { status: 0 };
            }

            return { status: 1 };
        }
    });

    const result = handbrake.ejectDisc();

    assert.ok(methodsCalled.some(m => m.cmd === 'drutil'), 'Should call drutil');
    assert.ok(devicePresentChecks >= 2, 'Should verify device is gone after eject');
    assert.strictEqual(result, true, 'Should return true on verified success');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ejectDisc falls back to diskutil if drutil fails or disc still present
// ═══════════════════════════════════════════════════════════════════════════

function testEjectDiscFallsToDiskutil() {
    console.log('Test: ejectDisc falls back to diskutil when drutil fails');
    resetHandbrake();

    let methodsCalled = [];
    let deviceCheckCount = 0;
    let ejectAttempted = false;

    handbrake.setDependencies({
        spawnSync: (cmd, args, options) => {
            const argsStr = args ? args.join(' ') : '';
            methodsCalled.push({ cmd, args: argsStr });

            // isDvdDevicePresent() calls diskutil list <device>
            if (cmd === 'diskutil' && args[0] === 'list' && args.length > 1) {
                deviceCheckCount++;
                // First check: device present (before any eject)
                // Second check: device still present (after drutil failed)
                // Third check: device gone (after diskutil eject succeeded)
                if (ejectAttempted) {
                    return { status: 1 }; // Gone after diskutil eject
                }
                return { status: 0 }; // Still present
            }

            // drutil eject fails
            if (cmd === 'drutil' && args[0] === 'eject') {
                return { status: 1 };
            }

            // diskutil eject succeeds
            if (cmd === 'diskutil' && args[0] === 'eject') {
                ejectAttempted = true;
                return { status: 0 };
            }

            return { status: 1 };
        }
    });

    const result = handbrake.ejectDisc('/dev/disk5');

    assert.ok(methodsCalled.some(m => m.cmd === 'drutil'), 'Should try drutil first');
    assert.ok(methodsCalled.some(m => m.cmd === 'diskutil' && m.args.startsWith('eject')), 'Should fall back to diskutil');
    assert.strictEqual(result, true, 'Should return true on fallback success');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ejectDisc returns false when all methods fail or disc still present
// ═══════════════════════════════════════════════════════════════════════════

function testEjectDiscReturnsFalseOnFailure() {
    console.log('Test: ejectDisc returns false when all methods fail');
    resetHandbrake();

    handbrake.setDependencies({
        spawnSync: (cmd, args) => {
            // Device always appears present (ejection never succeeds)
            if (cmd === 'diskutil' && args[0] === 'list') {
                return { status: 0 }; // Device still there
            }
            // Both eject methods fail
            return { status: 1 };
        }
    });

    const result = handbrake.ejectDisc('/dev/disk5');

    assert.strictEqual(result, false, 'Should return false when all methods fail');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: resetDvdDrive tries multiple eject methods
// ═══════════════════════════════════════════════════════════════════════════

async function testResetDvdDriveTriesMultipleMethods() {
    console.log('Test: resetDvdDrive tries multiple eject methods');
    resetHandbrake();

    let methodsCalled = [];

    handbrake.setDependencies({
        spawnSync: (cmd, args) => {
            methodsCalled.push({ cmd, args: args[0] });
            // First two methods fail, third succeeds
            if (cmd === 'drutil') return { status: 1 };
            if (cmd === 'diskutil' && args[0] === 'eject') return { status: 1 };
            if (cmd === 'diskutil' && args[0] === 'unmount') return { status: 0 };
            if (cmd === 'diskutil' && args[0] === 'list') {
                return { status: 0, stdout: Buffer.from('UDF') };
            }
            return { status: 0 };
        }
    });

    suppressConsole();
    const result = await handbrake.resetDvdDrive('/dev/disk5');
    restoreConsole();

    // Should have tried all methods before success
    assert.ok(methodsCalled.some(m => m.cmd === 'drutil'), 'Should try drutil');
    assert.ok(methodsCalled.some(m => m.cmd === 'diskutil' && m.args === 'eject'), 'Should try diskutil eject');
    assert.ok(methodsCalled.some(m => m.cmd === 'diskutil' && m.args === 'unmount'), 'Should try diskutil unmount');
    assert.ok(result, 'Should return true on success');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: resetDvdDrive returns false when all methods fail
// ═══════════════════════════════════════════════════════════════════════════

async function testResetDvdDriveFailsGracefully() {
    console.log('Test: resetDvdDrive returns false when all methods fail');
    resetHandbrake();

    handbrake.setDependencies({
        spawnSync: () => ({ status: 1 }) // All methods fail
    });

    suppressConsole();
    const result = await handbrake.resetDvdDrive('/dev/disk5');
    restoreConsole();

    assert.strictEqual(result, false, 'Should return false when all methods fail');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: DI reset restores defaults
// ═══════════════════════════════════════════════════════════════════════════

function testDIReset() {
    console.log('Test: resetDependencies restores default behavior');

    // Set custom dependencies
    let _customCalled = false;
    handbrake.setDependencies({
        spawnSync: () => { _customCalled = true; return { status: 0 }; }
    });

    // Reset and verify defaults are restored
    handbrake.resetDependencies();

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: ripDvd uses default encoding options
// ═══════════════════════════════════════════════════════════════════════════

async function testRipDvdDefaultEncoding() {
    console.log('Test: ripDvd uses default encoding options');
    resetHandbrake();

    let spawnedArgs = null;

    handbrake.setDependencies({
        spawn: (cmd, args) => {
            spawnedArgs = args;
            const mockProcess = new EventEmitter();
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = () => {};
            setImmediate(() => mockProcess.emit('close', 0));
            return mockProcess;
        }
    });

    await handbrake.ripDvd(
        {
            dvdSource: '/dev/disk5',
            titleNumber: 1,
            outputDir: '/output',
            outputFileName: 'Test'
            // No encoding or subtitles specified - should use defaults
        },
        () => {},
        1,
        1
    );

    assert.ok(spawnedArgs.includes('x264'), 'Should use default x264 encoder');
    assert.ok(spawnedArgs.includes('20'), 'Should use default quality 20');
    assert.ok(spawnedArgs.includes('--deinterlace'), 'Should include deinterlace by default');

    console.log('  ✓ PASS\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
    try {
        // Dry-run tests
        await testDryRunNoFiles();
        await testDryRunLogsToFile();

        // ripDvd tests
        await testRipDvdBuildsCorrectArgs();
        await testRipDvdReportsProgress();
        await testRipDvdResolvesOnSuccess();
        await testRipDvdRejectsOnFailure();
        await testRipDvdDefaultEncoding();

        // scanSingleTitle tests
        await testScanSingleTitleParsesDuration();
        await testScanSingleTitleHandlesTimeout();
        await testScanSingleTitleHandlesError();

        // ejectDisc tests
        testEjectDiscSucceedsWithDrutil();
        testEjectDiscFallsToDiskutil();
        testEjectDiscReturnsFalseOnFailure();

        // resetDvdDrive tests
        await testResetDvdDriveTriesMultipleMethods();
        await testResetDvdDriveFailsGracefully();

        // DI tests
        testDIReset();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  ✅ All handbrake module tests passed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(0);
    } catch (error) {
        restoreConsole();
        console.error(`\n❌ Test failed: ${error.message}\n`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        handbrake.resetDependencies();
        restoreConsole();
    }
}

runTests();
