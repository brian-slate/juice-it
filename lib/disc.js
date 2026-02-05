/**
 * JuiceIt DVD Disc Operations
 *
 * Handles DVD detection, scanning, and metadata collection.
 * Includes both HandBrakeCLI-based scanning and lsdvd extended metadata.
 */

const childProcess = require('child_process');
const path = require('path');
const fsModule = require('fs');
const os = require('os');
const enquirer = require('enquirer');

// ==================== DEPENDENCY INJECTION ====================
// These can be overridden for testing via setter functions

let deps = {
    execSync: childProcess.execSync,
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
    fs: fsModule,
    Select: enquirer.Select,
    exit: (code) => process.exit(code)
};

/**
 * Set dependencies for testing (dependency injection)
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
        execSync: childProcess.execSync,
        spawn: childProcess.spawn,
        spawnSync: childProcess.spawnSync,
        fs: fsModule,
        Select: enquirer.Select,
        exit: (code) => process.exit(code)
    };
}

// Lazy-loaded logger with DI support
let logger = null;
let loggerFactory = null;

/**
 * Set logger instance directly (for DI)
 * @param {Object} loggerInstance - Logger instance
 */
function setLogger(loggerInstance) {
    logger = loggerInstance;
}

function getLogger() {
    if (!logger) {
        if (loggerFactory) {
            logger = loggerFactory();
        } else {
            const { getLogger: createLogger } = require('./logger');
            logger = createLogger();
        }
    }
    return logger;
}

// ==================== TOOL VALIDATION ====================

/**
 * Check if lsdvd is available (optional - provides additional metadata)
 * @returns {boolean} True if lsdvd is installed
 */
function checkLsdvd() {
    const result = deps.spawnSync('which', ['lsdvd']);
    return result.status === 0;
}

/**
 * Check if HandBrakeCLI is installed (required)
 * @throws {Error} If HandBrakeCLI is not installed
 */
function checkHandBrakeCLI() {
    const result = deps.spawnSync('HandBrakeCLI', ['--version']);
    if (result.error || result.status !== 0) {
        getLogger().error("HandBrakeCLI is not installed. Please install it using 'brew install handbrake' to use this script.");
        deps.exit(1);
    }
}

/**
 * Check if libdvdcss is installed (required for encrypted DVDs)
 * @throws {Error} If libdvdcss is not installed
 */
function checkLibdvdcss() {
    const result = deps.spawnSync('brew', ['list', 'libdvdcss']);
    if (result.error || result.status !== 0) {
        getLogger().error("libdvdcss is not installed. Please install it using 'brew install libdvdcss' to use this script.");
        deps.exit(1);
    }
}

// ==================== LSDVD METADATA ====================

/**
 * Get extended disc metadata using lsdvd
 * Returns additional info like chapters, audio streams, and subtitles per track
 * This provides context that HandBrakeCLI's scan doesn't give us
 *
 * @param {string} dvdSource - The DVD device path
 * @param {string|null} volumeName - Optional volume name for pattern extraction
 * @returns {Object|null} Parsed lsdvd data or null if unavailable
 */
function getLsdvdMetadata(dvdSource, volumeName = null) {
    if (!checkLsdvd()) {
        getLogger().debug('[lsdvd] Not installed, skipping extended metadata');
        return null;
    }

    try {
        const result = deps.spawnSync('lsdvd', [dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        if (result.error || result.status !== 0) {
            getLogger().debug(`[lsdvd] Failed to read disc: ${result.stderr || result.error?.message}`);
            return null;
        }

        const output = result.stdout + result.stderr; // lsdvd outputs to both
        const metadata = parseLsdvdOutput(output);

        // Add disc pattern extraction for AI context
        if (metadata) {
            metadata.discPatterns = parseDiscPatternFromTitle(metadata.discTitle, volumeName);
            getLogger().debug(`[lsdvd] Disc patterns extracted: ${JSON.stringify(metadata.discPatterns)}`);
        }

        return metadata;
    } catch (error) {
        getLogger().debug(`[lsdvd] Error: ${error.message}`);
        return null;
    }
}

/**
 * Parse disc position patterns from disc title (raw extraction, not inference)
 * Extracts patterns like S02D03, SEASON_2_D3, DISC_TWO, _D2, etc.
 * AI will interpret what these patterns mean.
 *
 * @param {string} discTitle - lsdvd disc title (e.g., "BREAKING_BAD_S5_D1")
 * @param {string} volumeName - Volume name from diskutil (may differ from discTitle)
 * @returns {Object} Raw pattern data for AI to interpret
 */
function parseDiscPatternFromTitle(discTitle, volumeName) {
    const patterns = [];
    const result = {
        patterns,
        rawDiscTitle: discTitle || null,
        rawVolumeName: volumeName || null,
        // Raw extracted values (AI interprets meaning)
        seasonIndicators: [],
        discIndicators: [],
        partIndicators: []
    };

    // Combine both sources for pattern extraction
    const sources = [
        { source: 'discTitle', text: discTitle },
        { source: 'volumeName', text: volumeName }
    ].filter(s => s.text);

    for (const { source, text } of sources) {
        const normalizedText = text.toUpperCase();

        // Pattern: S##D## (e.g., S02D03, S5D1)
        const sdPattern = normalizedText.match(/S(\d+)D(\d+)/);
        if (sdPattern) {
            patterns.push({
                source,
                pattern: 'S#D#',
                raw: sdPattern[0],
                values: { season: parseInt(sdPattern[1], 10), disc: parseInt(sdPattern[2], 10) }
            });
            result.seasonIndicators.push({ source, value: parseInt(sdPattern[1], 10), pattern: sdPattern[0] });
            result.discIndicators.push({ source, value: parseInt(sdPattern[2], 10), pattern: sdPattern[0] });
        }

        // Pattern: SEASON_#_D# or SEASON#_DISC# (e.g., SEASON_2_D3, SEASON2_DISC1)
        const seasonDiscPattern = normalizedText.match(/SEASON[_\s]?(\d+)[_\s]D(?:ISC)?[_\s]?(\d+)/);
        if (seasonDiscPattern) {
            patterns.push({
                source,
                pattern: 'SEASON_#_DISC_#',
                raw: seasonDiscPattern[0],
                values: { season: parseInt(seasonDiscPattern[1], 10), disc: parseInt(seasonDiscPattern[2], 10) }
            });
            result.seasonIndicators.push({ source, value: parseInt(seasonDiscPattern[1], 10), pattern: seasonDiscPattern[0] });
            result.discIndicators.push({ source, value: parseInt(seasonDiscPattern[2], 10), pattern: seasonDiscPattern[0] });
        }

        // Pattern: Just season indicator (e.g., SEASON_3, S3, SEASON3)
        const seasonOnlyPattern = normalizedText.match(/(?:SEASON[_\s]?|(?<![A-Z])S)(\d+)(?![DE\d])/);
        if (seasonOnlyPattern && !sdPattern && !seasonDiscPattern) {
            patterns.push({
                source,
                pattern: 'SEASON_#',
                raw: seasonOnlyPattern[0],
                values: { season: parseInt(seasonOnlyPattern[1], 10) }
            });
            result.seasonIndicators.push({ source, value: parseInt(seasonOnlyPattern[1], 10), pattern: seasonOnlyPattern[0] });
        }

        // Pattern: DISC_# or D# at end (e.g., DISC_2, _D1, DISC1)
        const discOnlyPattern = normalizedText.match(/(?:DISC[_\s]?|[_\s]D)(\d+)(?:\s|$|[_])/);
        if (discOnlyPattern && !sdPattern && !seasonDiscPattern) {
            patterns.push({
                source,
                pattern: 'DISC_#',
                raw: discOnlyPattern[0],
                values: { disc: parseInt(discOnlyPattern[1], 10) }
            });
            result.discIndicators.push({ source, value: parseInt(discOnlyPattern[1], 10), pattern: discOnlyPattern[0] });
        }

        // Pattern: DISC_ONE, DISC_TWO, etc. (word-based disc numbers)
        const wordDiscPattern = normalizedText.match(/DISC[_\s]?(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)/);
        if (wordDiscPattern) {
            const wordToNum = {
                'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5,
                'SIX': 6, 'SEVEN': 7, 'EIGHT': 8, 'NINE': 9, 'TEN': 10
            };
            const discNum = wordToNum[wordDiscPattern[1]];
            patterns.push({
                source,
                pattern: 'DISC_WORD',
                raw: wordDiscPattern[0],
                values: { disc: discNum }
            });
            result.discIndicators.push({ source, value: discNum, pattern: wordDiscPattern[0] });
        }

        // Pattern: PART_# or PT# (multi-part movies or multi-disc single features)
        const partPattern = normalizedText.match(/(?:PART[_\s]?|PT[_\s]?)(\d+)/);
        if (partPattern) {
            patterns.push({
                source,
                pattern: 'PART_#',
                raw: partPattern[0],
                values: { part: parseInt(partPattern[1], 10) }
            });
            result.partIndicators.push({ source, value: parseInt(partPattern[1], 10), pattern: partPattern[0] });
        }

        // Pattern: BOX_SET, COMPLETE_SERIES indicators
        if (normalizedText.includes('BOX') || normalizedText.includes('COMPLETE') || normalizedText.includes('COLLECTION')) {
            patterns.push({
                source,
                pattern: 'BOX_SET_INDICATOR',
                raw: text,
                values: { isBoxSet: true }
            });
        }
    }

    return result;
}

/**
 * Parse lsdvd text output into structured data
 *
 * @param {string} output - Raw lsdvd output
 * @returns {Object} Parsed metadata
 */
function parseLsdvdOutput(output) {
    const metadata = {
        discTitle: 'unknown',
        discId: null,
        longestTrack: null,
        tracks: {}
    };

    const lines = output.split('\n');

    for (const line of lines) {
        // Parse disc title
        const discTitleMatch = line.match(/^Disc Title:\s*(.+)$/i);
        if (discTitleMatch) {
            metadata.discTitle = discTitleMatch[1].trim();
            continue;
        }

        // Parse DVD Disc ID
        const discIdMatch = line.match(/^DVDDiscID:\s*(.+)$/i);
        if (discIdMatch) {
            metadata.discId = discIdMatch[1].trim();
            continue;
        }

        // Parse longest track
        const longestMatch = line.match(/^Longest track:\s*(\d+)$/i);
        if (longestMatch) {
            metadata.longestTrack = parseInt(longestMatch[1], 10);
            continue;
        }

        // Parse track info: Title: 01, Length: 00:08:47.000 Chapters: 01, Cells: 01, Audio streams: 03, Subpictures: 02
        const trackMatch = line.match(/^Title:\s*(\d+),\s*Length:\s*([\d:.]+)\s*Chapters:\s*(\d+),\s*Cells:\s*(\d+),\s*Audio streams:\s*(\d+),\s*Subpictures:\s*(\d+)/i);
        if (trackMatch) {
            const trackNum = parseInt(trackMatch[1], 10);
            const length = trackMatch[2];
            const chapters = parseInt(trackMatch[3], 10);
            const cells = parseInt(trackMatch[4], 10);
            const audioStreams = parseInt(trackMatch[5], 10);
            const subpictures = parseInt(trackMatch[6], 10);

            // Parse length to minutes
            const [hours, mins, secs] = length.split(':').map(parseFloat);
            const durationMinutes = Math.round(hours * 60 + mins + secs / 60);

            metadata.tracks[trackNum] = {
                length,
                durationMinutes,
                chapters,
                cells,
                audioStreams,
                subpictures
            };
        }
    }

    return metadata;
}

// ==================== DVD DETECTION ====================

/**
 * Detect all DVD drives with inserted discs
 * @returns {Array<{device: string, name: string, size: string}>} Array of detected drives
 */
function detectAllDvdDrives() {
    try {
        // First, try drutil to detect DVD in drive
        try {
            const drutilOutput = deps.execSync('drutil status 2>/dev/null').toString();
            const deviceMatch = drutilOutput.match(/Name:\s+(\/dev\/disk\d+)/);

            if (deviceMatch) {
                const device = deviceMatch[1];
                // Get volume info from diskutil
                try {
                    const diskInfo = deps.execSync(`diskutil info ${device} 2>/dev/null`).toString();
                    const volumeMatch = diskInfo.match(/Volume Name:\s+(.+)/);
                    const sizeMatch = diskInfo.match(/Disk Size:\s+([\d.]+\s+[GMK]B)/);

                    const name = volumeMatch ? volumeMatch[1].trim() : 'DVD';
                    const size = sizeMatch ? sizeMatch[1].trim() : 'Unknown';

                    return [{ device, name, size }];
                } catch (e) {
                    // If diskutil fails, still return the device
                    return [{ device, name: 'DVD', size: 'Unknown' }];
                }
            }
        } catch (e) {
            // drutil not available or no DVD, continue to fallback
        }

        // Fallback: scan diskutil list for external disks
        const diskListOutput = deps.execSync('diskutil list 2>/dev/null').toString();
        const drives = [];

        // Find all external physical disks
        const diskMatches = diskListOutput.matchAll(/(\/dev\/disk\d+) \(external, physical\):[\s\S]*?TYPE NAME\s+SIZE\s+IDENTIFIER[\s\S]*?0:\s+(.+?)\s+(\d+\.\d+ [GMK]B)/g);

        for (const match of diskMatches) {
            const device = match[1];
            const name = match[2].trim();
            const size = match[3];

            // Verify it's actually a DVD by checking size (DVDs are typically 4.7GB or 8.5GB)
            const sizeNum = parseFloat(size);
            const unit = size.match(/[GMK]B$/)[0];

            if (unit === 'GB' && sizeNum > 0 && sizeNum < 20) {
                drives.push({ device, name, size });
            }
        }

        return drives;
    } catch (error) {
        getLogger().debug(`Error detecting DVD drives: ${error.message}`);
        return [];
    }
}

/**
 * Detect the DVD source automatically, prompting if multiple drives found
 * @param {Object} options - Options object with interactive flag
 * @returns {Promise<string|null>} DVD device path or null if not found/cancelled
 */
async function detectDvdSource(options = {}) {
    const drives = detectAllDvdDrives();

    if (drives.length === 0) {
        return null;
    } else if (drives.length === 1) {
        getLogger().debug(`Single DVD drive detected: ${drives[0].device}`);
        return drives[0].device;
    } else {
        // Multiple drives found
        getLogger().debug(`Multiple DVD drives detected: ${drives.length}`);

        if (!options.interactive) {
            // Automatic mode: cannot proceed with multiple drives
            console.log('');
            console.log('  ❌ Multiple DVD Drives Detected');
            console.log('');
            console.log('  Found more than one DVD drive with a disc inserted:');
            console.log('');
            drives.forEach(d => {
                console.log(`    • ${d.device} - "${d.name}" (${d.size})`);
            });
            console.log('');
            console.log('  In automatic mode, JuiceIt cannot determine which disc to rip.');
            console.log('');
            console.log('  Options:');
            console.log('    1. Specify the drive: juice-it --dvdSource /dev/diskN');
            console.log('    2. Use interactive mode: juice-it --interactive');
            console.log('       (This will let you select the disc to rip)');
            console.log('');
            deps.exit(1);
        }

        // Interactive mode: show selection prompt
        console.log('\n📀 Multiple DVD drives detected:\n');

        const choices = drives.map(d => ({
            name: `${d.device} - "${d.name}" (${d.size})`,
            value: d.device
        }));

        try {
            const prompt = new deps.Select({
                name: 'drive',
                message: 'Select DVD drive:',
                choices: choices
            });

            return await prompt.run();
        } catch (error) {
            console.log('\nSelection cancelled\n');
            return null;
        }
    }
}

/**
 * Get volume name using diskutil
 * @param {string} dvdSource - The DVD device path
 * @returns {string|null} Volume name or null if not found
 */
function getVolumeName(dvdSource) {
    try {
        const output = deps.execSync(`diskutil info ${dvdSource}`).toString();
        const match = output.match(/Volume Name:\s*(.+)/);
        return match ? match[1].trim() : null;
    } catch (error) {
        getLogger().error("Error fetching volume name:", error);
        return null;
    }
}

// ==================== CACHE MANAGEMENT ====================

/**
 * Get the platform-specific cache directory
 * @returns {string} Path to cache directory
 */
function getCacheDir() {
    let cacheDir;

    if (process.platform === 'darwin') {
        // macOS: ~/Library/Caches/juice-it
        cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'juice-it');
    } else if (process.platform === 'win32') {
        // Windows: %LOCALAPPDATA%\juice-it\cache
        cacheDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'juice-it', 'cache');
    } else {
        // Linux/Unix: ~/.cache/juice-it
        cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'juice-it');
    }

    // Ensure cache directory exists
    if (!deps.fs.existsSync(cacheDir)) {
        deps.fs.mkdirSync(cacheDir, { recursive: true });
    }

    return cacheDir;
}

/**
 * Clean up old cache files, keeping only the most recent N files
 * @param {number} maxFiles - Maximum number of cache files to keep (default: 10)
 */
function cleanupOldCacheFiles(maxFiles = 10) {
    const cacheDir = getCacheDir();
    try {
        if (!deps.fs.existsSync(cacheDir)) return;

        const files = deps.fs.readdirSync(cacheDir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(cacheDir, f),
                mtime: deps.fs.statSync(path.join(cacheDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime); // Sort by most recent first

        // Delete files beyond maxFiles
        if (files.length > maxFiles) {
            const filesToDelete = files.slice(maxFiles);
            filesToDelete.forEach(file => {
                try {
                    deps.fs.unlinkSync(file.path);
                    getLogger().debug(`Cleaned up old cache: ${file.name}`);
                } catch (err) {
                    getLogger().debug(`Could not delete cache file ${file.name}: ${err.message}`);
                }
            });
        }
    } catch (error) {
        getLogger().debug(`Error cleaning up cache: ${error.message}`);
    }
}

/**
 * Get the cache file path for a specific volume
 * @param {string} volumeName - DVD volume name
 * @returns {string} Path to cache file
 */
function getCacheFilePath(volumeName) {
    const cacheDir = getCacheDir();
    cleanupOldCacheFiles(10);
    const safeVolumeName = volumeName ? volumeName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
    return path.join(cacheDir, `${safeVolumeName}.json`);
}

/**
 * Load scan results from cache if valid
 * @param {string} volumeName - DVD volume name
 * @returns {Object|null} Cached scan results or null if not found/invalid
 */
function loadFromCache(volumeName) {
    const cacheFilePath = getCacheFilePath(volumeName);

    if (deps.fs.existsSync(cacheFilePath)) {
        try {
            const cacheData = JSON.parse(deps.fs.readFileSync(cacheFilePath, 'utf8'));
            if (cacheData.volumeName === volumeName) {
                getLogger().debug(`Cache hit for volume: ${volumeName}`);
                return cacheData;
            }
            getLogger().debug("Volume names do not match. Cache will be ignored.");
        } catch (error) {
            getLogger().debug(`Error reading cache: ${error.message}`);
        }
    } else {
        getLogger().debug("Cache does not exist. Fetching title information from the disc.");
    }

    return null;
}

/**
 * Save scan results to cache
 * @param {string} volumeName - DVD volume name
 * @param {Object} scanResults - Scan results to cache
 */
function saveToCache(volumeName, scanResults) {
    const cacheFilePath = getCacheFilePath(volumeName);
    deps.fs.writeFileSync(cacheFilePath, JSON.stringify({
        volumeName,
        ...scanResults,
        scannedAt: new Date().toISOString()
    }, null, 2));
    getLogger().debug(`Cache created with Volume Name: ${volumeName}`);
}

// ==================== DISC SCANNING ====================

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
 * Scan the DVD and get the number of titles with duration information
 * Returns structured results instead of using global state
 *
 * @param {string} dvdSource - The DVD device path
 * @param {string} volumeName - The DVD volume name
 * @param {Object} options - Options object with verbose flag
 * @returns {Promise<{numTitles: number, titleDurations: Object, unrippableTracks: Array}>}
 */
async function scanDisc(dvdSource, volumeName, options = {}) {
    process.stdout.write('🔍 Scanning disc...');

    // Check cache first
    const cached = loadFromCache(volumeName);
    if (cached) {
        console.log(` ✓ Found ${cached.numTitles} title${cached.numTitles > 1 ? 's' : ''} (cached)`);
        console.log('');
        return {
            numTitles: cached.numTitles,
            titleDurations: cached.titleDurations || {},
            unrippableTracks: cached.unrippableTracks || []
        };
    }

    // Fetch title information from disc
    console.log('');

    // Use --previews 0:0 to skip preview generation entirely - we only need title/duration info
    const args = ['-i', dvdSource, '--title', '0', '--scan', '--previews', '0:0'];

    getLogger().debug(`Running: HandBrakeCLI ${args.join(' ')}`);

    // Use Promise-wrapped spawn for real-time output
    const scanResult = await new Promise((resolve, reject) => {
        const handbrakeProcess = deps.spawn('HandBrakeCLI', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        let totalTitles = 0;
        let lastReportedTitle = 0;
        let scannedTitlesCount = 0;
        const titleDurations = {};
        let resolved = false;
        let lastProgressTime = Date.now();
        let lastScanPercentage = null;
        let stuckTitle = null;
        const unrippableTracks = []; // Track 0-duration and stuck tracks
        const STUCK_TIMEOUT_MS = 30000; // 30 seconds without ANY progress = stuck

        // Stuck detection timer - check every 5 seconds
        const stuckCheckInterval = setInterval(() => {
            if (resolved) {
                clearInterval(stuckCheckInterval);
                return;
            }

            const timeSinceProgress = Date.now() - lastProgressTime;
            if (timeSinceProgress > STUCK_TIMEOUT_MS && scannedTitlesCount > 0) {
                clearInterval(stuckCheckInterval);
                process.stdout.write('\r' + ' '.repeat(60) + '\r');
                const stuckMsg = `Title ${stuckTitle || lastReportedTitle} appears stuck (no progress for ${STUCK_TIMEOUT_MS/1000}s, last %: ${lastScanPercentage})`;
                console.log(`   ⚠️  ${stuckMsg} - skipping remaining titles`);
                getLogger().debug(`STUCK DETECTION: ${stuckMsg}`);
                getLogger().debug(`Scanned ${scannedTitlesCount} of ${totalTitles} titles before stuck`);
                getLogger().debug(`Durations collected: ${JSON.stringify(titleDurations)}`);
                // Use SIGKILL for immediate termination (SIGTERM can leave zombies on stuck I/O)
                handbrakeProcess.kill('SIGKILL');
                // Mark stuck track and all subsequent tracks as unrippable
                const stuckTrack = stuckTitle || lastReportedTitle;
                for (let t = stuckTrack; t <= totalTitles; t++) {
                    if (!unrippableTracks.includes(t)) {
                        unrippableTracks.push(t);
                    }
                }
                // Reset the DVD drive to clear kernel I/O stuck state, then resolve
                setTimeout(async () => {
                    if (!resolved) {
                        resolved = true;
                        // Reset the drive to stop kernel read-retry loop
                        await resetDvdDrive(dvdSource);
                        resolve({ code: 0, output, titleDurations, totalTitles, stuckAtTitle: stuckTrack, unrippableTracks });
                    }
                }, 500);
            }
        }, 5000);

        const processData = (data) => {
            if (resolved) return; // Stop processing after we resolve

            const chunk = data.toString();
            output += chunk;

            if (options.verbose) {
                process.stdout.write(chunk); // Keep raw output for verbose mode
            }

            // Check for total title count
            const totalMatch = chunk.match(/scan: DVD has (\d+) title/);
            if (totalMatch) {
                totalTitles = parseInt(totalMatch[1], 10);
                console.log(`   Found ${totalTitles} title${totalTitles > 1 ? 's' : ''} - scanning each...`);
                lastProgressTime = Date.now();
            }

            // Check for current title being scanned and show progress
            const scanningMatch = chunk.match(/scan: scanning title (\d+)/);
            if (scanningMatch) {
                const currentTitle = parseInt(scanningMatch[1], 10);
                if (currentTitle > lastReportedTitle) {
                    lastReportedTitle = currentTitle;
                    stuckTitle = currentTitle; // Track which title we're on in case it gets stuck
                    lastScanPercentage = null; // Reset percentage tracking for new title
                    lastProgressTime = Date.now(); // New title = progress
                    process.stdout.write(`\r   Scanning track ${currentTitle}${totalTitles > 0 ? ' of ' + totalTitles : ''}...`);
                }
            }

            // Track scan percentage within a title - if it changes, we're making progress
            const percentMatch = chunk.match(/Scanning title \d+ of \d+, (\d+\.\d+) %/);
            if (percentMatch) {
                const currentPercent = parseFloat(percentMatch[1]);
                if (lastScanPercentage === null || currentPercent > lastScanPercentage) {
                    lastScanPercentage = currentPercent;
                    lastProgressTime = Date.now(); // Percentage increased = progress
                }
            }

            // Parse duration for completed titles
            const durationMatch = chunk.match(/scan: duration is (\d{2}):(\d{2}):(\d{2})/);
            if (durationMatch && lastReportedTitle > 0) {
                const hours = parseInt(durationMatch[1], 10);
                const mins = parseInt(durationMatch[2], 10);
                const secs = parseInt(durationMatch[3], 10);
                const totalMinutes = hours * 60 + mins + Math.round(secs / 60);
                titleDurations[lastReportedTitle] = totalMinutes;
                scannedTitlesCount++;
                lastProgressTime = Date.now(); // Reset stuck timer on progress
                stuckTitle = null; // Clear stuck title since this one completed

                // Mark 0-duration tracks as unrippable (copy-protected or invalid)
                if (totalMinutes === 0 && !unrippableTracks.includes(lastReportedTitle)) {
                    unrippableTracks.push(lastReportedTitle);
                    getLogger().debug(`Track ${lastReportedTitle}: 0 duration - marking as unrippable`);
                }

                // Kill process once we have all title durations - HandBrakeCLI hangs on post-processing
                if (totalTitles > 0 && scannedTitlesCount >= totalTitles) {
                    resolved = true;
                    clearInterval(stuckCheckInterval);
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');
                    handbrakeProcess.kill('SIGKILL');
                    setTimeout(() => resolve({ code: 0, output, titleDurations, totalTitles, unrippableTracks }), 500);
                }
            }
        };

        handbrakeProcess.stdout.on('data', processData);
        handbrakeProcess.stderr.on('data', processData);

        handbrakeProcess.on('error', (error) => {
            if (!resolved) {
                clearInterval(stuckCheckInterval);
                reject(new Error(`HandBrakeCLI failed to start: ${error.message}`));
            }
        });

        handbrakeProcess.on('close', (code) => {
            if (!resolved) {
                clearInterval(stuckCheckInterval);
                // Clear the scanning line
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                resolve({ code, output, titleDurations, totalTitles, unrippableTracks });
            }
        });
    });

    const { code, output, titleDurations, totalTitles: _totalTitles, stuckAtTitle, unrippableTracks: scannedUnrippable = [] } = scanResult;

    if (code === 0 || output.includes('scan: DVD has')) {
        const match = output.match(/scan: DVD has (\d+) title/);
        if (match) {
            const numTitles = parseInt(match[1], 10);

            // Use durations collected during scanning (we kill process early before final output)
            const finalDurations = { ...titleDurations };

            // If we got stuck, skip remaining tracks (they're likely all copy-protected)
            if (stuckAtTitle && stuckAtTitle < numTitles) {
                const skippedCount = numTitles - stuckAtTitle;
                console.log(`   ℹ️  Skipping ${skippedCount} remaining track(s) (likely copy-protected)`);
                getLogger().debug(`COPY PROTECTION: Skipping tracks ${stuckAtTitle + 1}-${numTitles} to avoid kernel I/O issues`);
            }

            console.log(`✓ Found ${numTitles} title${numTitles > 1 ? 's' : ''}`);
            console.log('');

            // Display track duration summary
            console.log('📋 Track Summary:');
            const sortedTracks = Object.entries(finalDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
            const rippableCount = sortedTracks.filter(([track]) => !scannedUnrippable.includes(parseInt(track))).length;
            const unrippableCount = scannedUnrippable.length;

            console.log(`   ${rippableCount} rippable track${rippableCount !== 1 ? 's' : ''}`);
            if (unrippableCount > 0) {
                console.log(`   ${unrippableCount} unrippable track${unrippableCount !== 1 ? 's' : ''} (copy-protected/invalid)`);
            }
            console.log('');

            sortedTracks.forEach(([track, duration]) => {
                const trackNum = parseInt(track);
                const isUnrippable = scannedUnrippable.includes(trackNum);

                let category = '';
                let icon = '  ';

                if (isUnrippable) {
                    category = ' ⊘ unrippable';
                    icon = '⊘ ';
                } else if (duration < 5) {
                    category = ' (menu/extra)';
                } else if (duration > 60) {
                    category = ' (main feature)';
                } else if (duration >= 20 && duration <= 35) {
                    category = ' (episode)';
                }
                console.log(`   ${icon}Track ${track}: ${duration} min${category}`);
            });
            console.log('');

            // Save to cache
            saveToCache(volumeName, {
                numTitles,
                titleDurations: finalDurations,
                unrippableTracks: scannedUnrippable
            });

            getLogger().debug(`Title durations: ${JSON.stringify(finalDurations)}`);

            return {
                numTitles,
                titleDurations: finalDurations,
                unrippableTracks: scannedUnrippable
            };
        } else {
            console.log(" ✗ No titles found.");
            console.log('');
            return { numTitles: 0, titleDurations: {}, unrippableTracks: [] };
        }
    } else {
        throw new Error(`HandBrakeCLI process exited with code ${code}`);
    }
}

/**
 * Helper function to set default output directory
 * @param {string} volumeName - DVD volume name
 * @param {string|null} outputDir - Existing output directory or null
 * @returns {string} Output directory path
 */
function setDefaultOutputDir(volumeName, outputDir = null) {
    if (outputDir) {
        // Ensure the output directory exists
        if (!deps.fs.existsSync(outputDir)) {
            deps.fs.mkdirSync(outputDir, { recursive: true });
        }
        return outputDir;
    }

    // Use local date and time for unique folder per run
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`; // YYYY-MM-DD_HH-MM-SS
    const safeName = volumeName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const newOutputDir = path.join(process.cwd(), `${safeName}_${timestamp}`);

    // Ensure the output directory exists
    if (!deps.fs.existsSync(newOutputDir)) {
        deps.fs.mkdirSync(newOutputDir, { recursive: true });
    }

    return newOutputDir;
}

/**
 * Helper function to get video duration in minutes using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {number|null} Duration in minutes or null if failed
 */
function getVideoDuration(filePath) {
    try {
        const result = deps.spawnSync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);
        if (result.status === 0) {
            const seconds = parseFloat(result.stdout.toString().trim());
            return Math.round(seconds / 60); // Return duration in minutes
        }
    } catch (error) {
        getLogger().debug(`Error getting duration for ${filePath}: ${error.message}`);
    }
    return null;
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    setLogger,

    // Tool validation
    checkLsdvd,
    checkHandBrakeCLI,
    checkLibdvdcss,

    // lsdvd metadata
    getLsdvdMetadata,
    parseLsdvdOutput,
    parseDiscPatternFromTitle,

    // DVD detection
    detectAllDvdDrives,
    detectDvdSource,
    getVolumeName,

    // Cache management
    getCacheDir,
    getCacheFilePath,
    cleanupOldCacheFiles,
    loadFromCache,
    saveToCache,

    // Disc scanning
    resetDvdDrive,
    scanDisc,
    setDefaultOutputDir,
    getVideoDuration
};
