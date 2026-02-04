/**
 * JuiceIt HandBrakeCLI Wrapper
 *
 * Handles DVD encoding using HandBrakeCLI with progress reporting.
 * Includes stuck detection and automatic drive reset capabilities.
 */

const childProcess = require('child_process');
const path = require('path');
const fsModule = require('fs');

// ==================== DEPENDENCY INJECTION ====================

// Dependencies with defaults
let deps = {
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
    fs: fsModule
};

/**
 * Set dependencies for testing
 * @param {Object} newDeps - Object with dependency overrides
 */
function setDependencies(newDeps) {
    deps = { ...deps, ...newDeps };
}

/**
 * Reset dependencies to defaults (for test cleanup)
 */
function resetDependencies() {
    deps = {
        spawn: childProcess.spawn,
        spawnSync: childProcess.spawnSync,
        fs: fsModule
    };
}

// Lazy-loaded logger with DI support
let logger = null;

/**
 * Set logger instance directly (for DI)
 * @param {Object} loggerInstance - Logger instance
 */
function setLogger(loggerInstance) {
    logger = loggerInstance;
}

function getLogger() {
    if (!logger) {
        const { getLogger: createLogger } = require('./logger');
        logger = createLogger();
    }
    return logger;
}

// File logging function (will be set by caller)
let logToFile = () => {};

/**
 * Set the file logging function
 * @param {Function} fn - Function to log to file
 */
function setLogFunction(fn) {
    logToFile = fn;
}

/**
 * Reset the DVD drive after a stuck read (eject and wait for remount)
 * @param {string} dvdSource - The DVD device path
 * @returns {Promise<boolean>} True if reset was successful
 */
async function resetDvdDrive(dvdSource) {
    return new Promise((resolve) => {
        getLogger().debug('Resetting DVD drive to clear stuck I/O...');
        console.log('   🔄 Resetting DVD drive...');

        // Try multiple eject methods - drutil is most forceful (talks to firmware)
        let ejected = false;

        // Method 1: drutil eject (most forceful - direct to drive firmware)
        const drutilResult = deps.spawnSync('drutil', ['eject'], { timeout: 5000 });
        if (drutilResult.status === 0) {
            ejected = true;
            getLogger().debug('Ejected via drutil');
        }

        // Method 2: diskutil eject
        if (!ejected) {
            const diskutilResult = deps.spawnSync('diskutil', ['eject', dvdSource], { timeout: 5000 });
            if (diskutilResult.status === 0) {
                ejected = true;
                getLogger().debug('Ejected via diskutil eject');
            }
        }

        // Method 3: diskutil unmount force
        if (!ejected) {
            const unmountResult = deps.spawnSync('diskutil', ['unmount', 'force', dvdSource], { timeout: 5000 });
            if (unmountResult.status === 0) {
                ejected = true;
                getLogger().debug('Ejected via diskutil unmount force');
            }
        }

        if (!ejected) {
            console.log('   ⚠️  Could not eject disc - you may need to unplug/replug the drive');
            getLogger().debug('All eject methods failed');
            resolve(false);
            return;
        }

        console.log('   📀 Disc ejected - please reinsert to continue...');

        // Wait for disc to be reinserted and mounted
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max wait for user to reinsert
        const checkInterval = setInterval(() => {
            attempts++;

            // Check if any DVD is mounted
            const result = deps.spawnSync('diskutil', ['list'], { timeout: 5000 });
            const output = result.stdout?.toString() || '';

            // Look for optical media (UDF filesystem typically)
            if (output.includes('UDF') || output.includes(dvdSource.replace('/dev/', ''))) {
                clearInterval(checkInterval);
                // Give it a moment to fully mount
                setTimeout(() => {
                    console.log('   ✓ DVD drive reset complete');
                    getLogger().debug('DVD drive reset successful');
                    resolve(true);
                }, 2000);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.log('   ⚠️  Timeout waiting for disc - please reinsert and try again');
                getLogger().debug('DVD drive reset timeout - disc not remounted');
                resolve(false);
            } else if (attempts % 15 === 0) {
                console.log(`   ⏳ Waiting for disc to be reinserted... (${attempts}s)`);
            }
        }, 1000);
    });
}

/**
 * Rip a single DVD track with progress output
 *
 * @param {Object} options - Ripping options
 * @param {string} options.dvdSource - DVD device path
 * @param {number} options.titleNumber - Title number to rip
 * @param {string} options.outputDir - Output directory path
 * @param {string} options.outputFileName - Output filename (without .mp4)
 * @param {Object} options.encoding - Encoding settings {encoder, quality, deinterlace}
 * @param {Object} options.subtitles - Subtitle settings {track, language}
 * @param {boolean} options.dryRun - If true, create stub file instead of actual rip
 * @param {Object} options.titleDurations - Map of track numbers to durations (for dry-run)
 * @param {Function} onProgress - Progress callback (progress, elapsed, remaining, trackNum, totalTracks)
 * @param {number} trackNum - Current track number for progress display
 * @param {number} totalTracks - Total tracks for progress display
 * @returns {Promise<void>}
 */
function ripDvd(options, onProgress, trackNum, totalTracks) {
    const {
        dvdSource,
        titleNumber,
        outputDir,
        outputFileName,
        encoding = { encoder: 'x264', quality: '20', deinterlace: true },
        subtitles = { track: 1, language: 'eng' },
        dryRun = false,
        titleDurations = {}
    } = options;

    return new Promise((resolve, reject) => {
        const outputFilePath = path.join(outputDir, `${outputFileName}.mp4`);

        // Dry-run mode: create stub file instead of actual ripping
        if (dryRun) {
            logToFile(`[DRY-RUN] Would rip track ${titleNumber} to: ${outputFileName}.mp4`);

            // Simulate progress updates
            const totalSteps = 10;
            const stepDelay = 100; // 100ms per step (total ~1s simulation)
            let step = 0;

            const progressInterval = setInterval(() => {
                step++;
                const progress = (step / totalSteps) * 100;
                const elapsed = step * (stepDelay / 1000);
                const remaining = ((totalSteps - step) * stepDelay) / 1000;
                onProgress(progress, elapsed, remaining, trackNum, totalTracks);

                if (step >= totalSteps) {
                    clearInterval(progressInterval);

                    // Create stub file with metadata comment
                    const trackDuration = titleDurations[titleNumber] || 0;
                    const stubContent = `[DRY-RUN STUB FILE]
Track: ${titleNumber}
Filename: ${outputFileName}.mp4
Duration: ${trackDuration} minutes
Created: ${new Date().toISOString()}
Command would be: HandBrakeCLI -i ${dvdSource} -t ${titleNumber} -o ${outputFilePath}
`;
                    deps.fs.writeFileSync(outputFilePath, stubContent);
                    logToFile(`[DRY-RUN] Created stub file: ${outputFilePath}`);
                    resolve();
                }
            }, stepDelay);

            return;
        }

        // Build HandBrakeCLI arguments
        const args = [
            '-i', dvdSource,
            '-o', outputFilePath,
            '-e', encoding.encoder,
            '-q', encoding.quality,
            '-t', titleNumber.toString(),
            '--all-audio', // Include ALL audio tracks from the source
            '--subtitle', subtitles.track.toString(), // Include the specified subtitle track
            '--decomb', // Use decomb filter for deinterlacing
            '--detelecine', // Use detelecine filter
            '--rate', '30', // Set frame rate to 30 fps
            '--preset', 'HQ 1080p30 Surround' // Use a valid preset
        ];

        // Add deinterlace option if enabled
        if (encoding.deinterlace) {
            args.push('--deinterlace');
        }

        // Log the HandBrakeCLI command
        logToFile(`Starting track ${titleNumber}: ${outputFileName}`);
        logToFile(`Command: HandBrakeCLI ${args.join(' ')}`);

        getLogger().debug(`Running HandBrakeCLI with command: HandBrakeCLI ${args.join(' ')}`);

        const startTime = Date.now();
        const handbrakeProcess = deps.spawn('HandBrakeCLI', args);
        let lastProgress = 0;
        let errorOutput = '';
        let resolved = false;

        // Stuck detection: track last activity time for both scanning and encoding phases
        let lastActivityTime = Date.now();
        let lastScanPercent = null;
        let isEncoding = false;
        const STUCK_TIMEOUT_MS = 60000; // 60 seconds without progress = stuck

        // Check for stuck process every 10 seconds
        const stuckCheckInterval = setInterval(() => {
            if (resolved) {
                clearInterval(stuckCheckInterval);
                return;
            }

            const timeSinceActivity = Date.now() - lastActivityTime;
            if (timeSinceActivity > STUCK_TIMEOUT_MS) {
                clearInterval(stuckCheckInterval);
                resolved = true;
                const phase = isEncoding ? 'encoding' : 'scanning';
                const stuckMsg = `Track ${titleNumber} stuck during ${phase} (no progress for ${STUCK_TIMEOUT_MS/1000}s)`;
                logToFile(stuckMsg);
                getLogger().debug(`STUCK DETECTION: ${stuckMsg}`);
                handbrakeProcess.kill('SIGKILL');
                reject({ code: null, errorOutput: stuckMsg, titleNumber, stuck: true });
            }
        }, 10000);

        handbrakeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            logToFile(`[stdout] ${output.trim()}`);
            const progressMatch = output.match(/Encoding:.* (\d{1,3}\.\d{1,2}) %/);
            if (progressMatch && progressMatch[1]) {
                isEncoding = true;
                const progress = parseFloat(progressMatch[1]);
                if (progress !== lastProgress) {
                    lastProgress = progress;
                    lastActivityTime = Date.now(); // Progress = activity
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const estimatedTotal = progress > 0 ? (elapsedSeconds / progress) * 100 : 0;
                    const remainingSeconds = estimatedTotal - elapsedSeconds;
                    onProgress(progress, elapsedSeconds, remainingSeconds, trackNum, totalTracks);
                }
            }
        });

        handbrakeProcess.stderr.on('data', (data) => {
            const dataStr = data.toString();
            errorOutput += dataStr;
            logToFile(`[stderr] ${dataStr.trim()}`);
            getLogger().debug(`[handbrake-info]: ${dataStr.trim()}`);

            // Track scanning phase progress to detect stuck scans
            const scanMatch = dataStr.match(/Scanning title \d+ of \d+, (\d+\.\d+) %/);
            if (scanMatch) {
                const scanPercent = parseFloat(scanMatch[1]);
                if (lastScanPercent === null || scanPercent > lastScanPercent) {
                    lastScanPercent = scanPercent;
                    lastActivityTime = Date.now(); // Scan progress = activity
                }
            }

            // Also count other meaningful output as activity (title info, duration, etc.)
            if (dataStr.includes('duration:') || dataStr.includes('+ title') ||
                dataStr.includes('autocrop:') || dataStr.includes('audio tracks:')) {
                lastActivityTime = Date.now();
            }
        });

        handbrakeProcess.on('close', (code) => {
            if (resolved) return; // Already handled by stuck detection
            resolved = true;
            clearInterval(stuckCheckInterval);

            if (code === 0) {
                logToFile(`Track ${titleNumber} completed successfully`);
                resolve();
            } else {
                logToFile(`Track ${titleNumber} failed with exit code ${code}`);
                logToFile(`Error output: ${errorOutput}`);
                reject({ code, errorOutput, titleNumber });
            }
        });
    });
}

/**
 * Scan a single title with timeout (for fallback when full scan gets stuck)
 * @param {string} dvdSource - DVD device path
 * @param {number} titleNum - Title number to scan
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<{titleNum: number, duration: number|null, stuck: boolean}>}
 */
async function scanSingleTitle(dvdSource, titleNum, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const args = ['-i', dvdSource, '--title', String(titleNum), '--scan', '--previews', '0:0'];
        const handbrakeProcess = deps.spawn('HandBrakeCLI', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let _output = '';
        let duration = null;
        let resolved = false;

        const timeout = setTimeout(async () => {
            if (!resolved) {
                resolved = true;
                handbrakeProcess.kill('SIGKILL'); // Use SIGKILL for immediate termination
                // Reset the drive to clear kernel I/O stuck state
                await resetDvdDrive(dvdSource);
                resolve({ titleNum, duration: null, stuck: true });
            }
        }, timeoutMs);

        const processData = (data) => {
            if (resolved) return;
            const chunk = data.toString();
            _output += chunk;

            // Parse duration
            const durationMatch = chunk.match(/scan: duration is (\d{2}):(\d{2}):(\d{2})/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1], 10);
                const mins = parseInt(durationMatch[2], 10);
                const secs = parseInt(durationMatch[3], 10);
                duration = hours * 60 + mins + Math.round(secs / 60);
            }
        };

        handbrakeProcess.stdout.on('data', processData);
        handbrakeProcess.stderr.on('data', processData);

        handbrakeProcess.on('close', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ titleNum, duration, stuck: false });
            }
        });

        handbrakeProcess.on('error', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ titleNum, duration: null, stuck: true });
            }
        });
    });
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    setLogger,
    setLogFunction,
    // Functions
    resetDvdDrive,
    ripDvd,
    scanSingleTitle
};
