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
 * Uses JSON output (-Oj -x) for rich structured data including:
 * - Chapter timestamps (for episode boundary detection)
 * - Audio track languages and formats
 * - Subtitle tracks and languages
 * - Video format (NTSC/PAL), resolution, aspect ratio
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
        // First try JSON output for rich metadata
        const jsonResult = deps.spawnSync('lsdvd', ['-Oj', '-x', dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        let metadata = null;

        if (!jsonResult.error && jsonResult.status === 0) {
            metadata = parseLsdvdJsonOutput(jsonResult.stdout);
        }

        // Fall back to text parsing if JSON fails
        if (!metadata) {
            getLogger().debug('[lsdvd] JSON output failed, falling back to text mode');
            const textResult = deps.spawnSync('lsdvd', [dvdSource], {
                encoding: 'utf8',
                timeout: 30000
            });

            if (!textResult.error && textResult.status === 0) {
                const output = textResult.stdout + textResult.stderr;
                metadata = parseLsdvdOutput(output);
            }
        }

        if (!metadata) {
            getLogger().debug('[lsdvd] Failed to parse disc metadata');
            return null;
        }

        // Add disc pattern extraction for AI context
        metadata.discPatterns = parseDiscPatternFromTitle(metadata.discTitle, volumeName);
        getLogger().debug(`[lsdvd] Disc patterns extracted: ${JSON.stringify(metadata.discPatterns)}`);

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
 * Parse lsdvd JSON output (-Oj -x format) for rich track data
 * This includes chapters, audio streams, subtitles, and video format info
 *
 * @param {string} jsonOutput - JSON string from lsdvd -Oj -x
 * @returns {Object|null} Parsed metadata with enhanced track info
 */
function parseLsdvdJsonOutput(jsonOutput) {
    try {
        const data = JSON.parse(jsonOutput);

        const metadata = {
            discTitle: data.title || 'unknown',
            discId: data.disc_id || null,
            device: data.device || null,
            videoFormat: data.video_format || null, // NTSC or PAL
            tracks: {},
            longestTrack: null
        };

        // Find longest track
        let maxLength = 0;

        if (data.track && Array.isArray(data.track)) {
            for (const track of data.track) {
                const trackNum = track.ix;
                const lengthSeconds = track.length || 0;
                const durationMinutes = Math.round(lengthSeconds / 60);

                // Track longest
                if (lengthSeconds > maxLength) {
                    maxLength = lengthSeconds;
                    metadata.longestTrack = trackNum;
                }

                // Extract chapter timestamps for episode boundary detection
                const chapters = [];
                if (track.chapter && Array.isArray(track.chapter)) {
                    for (const ch of track.chapter) {
                        chapters.push({
                            index: ch.ix,
                            lengthSeconds: ch.length || 0,
                            startCell: ch.startcell
                        });
                    }
                }

                // Extract audio streams (language info can help identify content)
                const audioStreams = [];
                if (track.audio && Array.isArray(track.audio)) {
                    for (const audio of track.audio) {
                        audioStreams.push({
                            index: audio.ix,
                            langCode: audio.langcode || 'und',
                            language: audio.language || 'Unknown',
                            format: audio.format || 'Unknown',
                            channels: audio.channels || 0,
                            frequency: audio.frequency || 0
                        });
                    }
                }

                // Extract subtitle tracks
                const subtitles = [];
                if (track.subp && Array.isArray(track.subp)) {
                    for (const sub of track.subp) {
                        subtitles.push({
                            index: sub.ix,
                            langCode: sub.langcode || 'und',
                            language: sub.language || 'Unknown',
                            content: sub.content || 'Unknown' // e.g., "Normal", "Large", "Director Comments"
                        });
                    }
                }

                // Video format details
                const videoDetails = {
                    width: track.width || 0,
                    height: track.height || 0,
                    aspectRatio: track.aspect || 'Unknown',
                    fps: track.fps || 0,
                    format: track.format || 'Unknown', // NTSC or PAL
                    df: track.df || 'Unknown' // display format info
                };

                metadata.tracks[trackNum] = {
                    lengthSeconds,
                    durationMinutes,
                    // Legacy fields for compatibility
                    length: formatDuration(lengthSeconds),
                    chapters: chapters.length,
                    cells: track.cells || 0,
                    audioStreams: audioStreams.length,
                    subpictures: subtitles.length,
                    // Enhanced data
                    chapterDetails: chapters,
                    audioDetails: audioStreams,
                    subtitleDetails: subtitles,
                    videoDetails,
                    // Angles (some DVDs have multiple viewing angles)
                    angles: track.angles || 1
                };
            }
        }

        return metadata;
    } catch (error) {
        getLogger().debug(`[lsdvd] JSON parse error: ${error.message}`);
        return null;
    }
}

/**
 * Format seconds to HH:MM:SS.mmm string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${secs.padStart(6, '0')}`;
}

/**
 * Run lsdvd scan with JSON output for rich track data
 * Uses -Oj -x flags for JSON output with extended metadata
 *
 * @param {string} dvdSource - The DVD device path
 * @returns {Object|null} { trackCount, tracks, chapters, etc } or null if unavailable
 */
function runLsdvdScan(dvdSource) {
    if (!checkLsdvd()) {
        getLogger().debug('[lsdvd] Not installed, skipping dual-scan validation');
        return null;
    }

    try {
        // Use -Oj for JSON output, -x for extended info (chapters, audio, subtitles)
        const result = deps.spawnSync('lsdvd', ['-Oj', '-x', dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        if (result.error || result.status !== 0) {
            getLogger().debug(`[lsdvd] JSON scan failed: ${result.stderr || result.error?.message}`);
            // Fall back to text parsing if JSON fails
            return runLsdvdScanFallback(dvdSource);
        }

        const jsonOutput = result.stdout;
        const metadata = parseLsdvdJsonOutput(jsonOutput);

        if (!metadata) {
            getLogger().debug('[lsdvd] JSON parsing failed, falling back to text mode');
            return runLsdvdScanFallback(dvdSource);
        }

        const trackCount = Object.keys(metadata.tracks).length;
        getLogger().debug(`[lsdvd JSON] Found ${trackCount} tracks with extended metadata`);

        return {
            trackCount,
            tracks: metadata.tracks,
            discTitle: metadata.discTitle,
            discId: metadata.discId,
            videoFormat: metadata.videoFormat,
            longestTrack: metadata.longestTrack,
            isJsonParsed: true // Flag to indicate rich data is available
        };
    } catch (error) {
        getLogger().debug(`[lsdvd] Error: ${error.message}`);
        return runLsdvdScanFallback(dvdSource);
    }
}

/**
 * Fallback lsdvd scan using text output (for older lsdvd versions)
 * @param {string} dvdSource - The DVD device path
 * @returns {Object|null} Basic track info or null
 */
function runLsdvdScanFallback(dvdSource) {
    try {
        const result = deps.spawnSync('lsdvd', [dvdSource], {
            encoding: 'utf8',
            timeout: 30000
        });

        if (result.error || result.status !== 0) {
            getLogger().debug(`[lsdvd text] Failed to read disc: ${result.stderr || result.error?.message}`);
            return null;
        }

        const output = result.stdout + result.stderr;
        const metadata = parseLsdvdOutput(output);

        if (!metadata) {
            return null;
        }

        const trackCount = Object.keys(metadata.tracks).length;
        getLogger().debug(`[lsdvd text] Found ${trackCount} tracks (text mode)`);

        return {
            trackCount,
            tracks: metadata.tracks,
            discTitle: metadata.discTitle,
            discId: metadata.discId,
            isJsonParsed: false
        };
    } catch (error) {
        getLogger().debug(`[lsdvd text fallback] Error: ${error.message}`);
        return null;
    }
}

/**
 * Compare HandBrake and lsdvd scan results
 * @param {Object} handbrakeResult - Result from scanDisc()
 * @param {Object} lsdvdResult - Result from runLsdvdScan()
 * @returns {Object} { match: boolean, handbrakeCount, lsdvdCount, discrepancy }
 */
function compareScanResults(handbrakeResult, lsdvdResult) {
    const handbrakeCount = handbrakeResult?.numTitles || 0;
    const lsdvdCount = lsdvdResult?.trackCount || 0;

    // If lsdvd wasn't available, we can't compare
    if (!lsdvdResult) {
        return {
            match: true, // Assume OK if we can't compare
            handbrakeCount,
            lsdvdCount: null,
            discrepancy: null,
            reason: 'lsdvd not available'
        };
    }

    // Compare track counts
    const match = handbrakeCount === lsdvdCount;
    const discrepancy = match ? null : {
        missing: lsdvdCount - handbrakeCount,
        handbrakeCount,
        lsdvdCount
    };

    if (!match) {
        getLogger().debug(`[SCAN MISMATCH] HandBrake found ${handbrakeCount} tracks, lsdvd found ${lsdvdCount}`);
    } else {
        getLogger().debug(`[SCAN MATCH] Both tools found ${handbrakeCount} tracks`);
    }

    return { match, handbrakeCount, lsdvdCount, discrepancy };
}

/**
 * Merge track durations from HandBrake and lsdvd
 * Uses lsdvd as fallback when HandBrake reports 0 duration (common with copy-protected tracks)
 *
 * @param {Object} handbrakeResult - Result from scanDisc() { titleDurations: {track: minutes} }
 * @param {Object} lsdvdResult - Result from runLsdvdScan() { tracks: {track: {durationMinutes}} }
 * @returns {Object} { mergedDurations, durationDiscrepancies, fallbacksUsed }
 */
function mergeDurations(handbrakeResult, lsdvdResult) {
    const mergedDurations = { ...handbrakeResult?.titleDurations };
    const durationDiscrepancies = [];
    const fallbacksUsed = [];

    if (!lsdvdResult || !lsdvdResult.tracks) {
        return { mergedDurations, durationDiscrepancies, fallbacksUsed };
    }

    // For each track, compare and potentially use lsdvd duration as fallback
    for (const [trackStr, lsdvdTrack] of Object.entries(lsdvdResult.tracks)) {
        const trackNum = parseInt(trackStr, 10);
        const handbrakeMinutes = mergedDurations[trackNum] || 0;
        const lsdvdMinutes = lsdvdTrack.durationMinutes || 0;

        // Case 1: HandBrake returned 0 but lsdvd has a duration - use lsdvd as fallback
        if (handbrakeMinutes === 0 && lsdvdMinutes > 0) {
            mergedDurations[trackNum] = lsdvdMinutes;
            fallbacksUsed.push({
                track: trackNum,
                handbrake: 0,
                lsdvd: lsdvdMinutes,
                reason: 'HandBrake reported 0, using lsdvd duration'
            });
            getLogger().debug(`[DURATION] Track ${trackNum}: HandBrake=0min, using lsdvd=${lsdvdMinutes}min`);
        }
        // Case 2: HandBrake doesn't have this track at all - add from lsdvd
        else if (!(trackNum in mergedDurations) && lsdvdMinutes > 0) {
            mergedDurations[trackNum] = lsdvdMinutes;
            fallbacksUsed.push({
                track: trackNum,
                handbrake: null,
                lsdvd: lsdvdMinutes,
                reason: 'Track missing from HandBrake, added from lsdvd'
            });
            getLogger().debug(`[DURATION] Track ${trackNum}: missing from HandBrake, using lsdvd=${lsdvdMinutes}min`);
        }
        // Case 3: Both have durations - check for significant discrepancy (>2 minutes difference)
        else if (handbrakeMinutes > 0 && lsdvdMinutes > 0) {
            const diff = Math.abs(handbrakeMinutes - lsdvdMinutes);
            if (diff > 2) {
                durationDiscrepancies.push({
                    track: trackNum,
                    handbrake: handbrakeMinutes,
                    lsdvd: lsdvdMinutes,
                    diff
                });
                getLogger().debug(`[DURATION] Track ${trackNum}: HandBrake=${handbrakeMinutes}min vs lsdvd=${lsdvdMinutes}min (diff=${diff}min)`);
            }
        }
    }

    // Log summary
    if (fallbacksUsed.length > 0) {
        getLogger().debug(`[DURATION] Used lsdvd fallback for ${fallbacksUsed.length} track(s)`);
    }
    if (durationDiscrepancies.length > 0) {
        getLogger().debug(`[DURATION] Found ${durationDiscrepancies.length} duration discrepancy(ies)`);
    }

    return { mergedDurations, durationDiscrepancies, fallbacksUsed };
}

/**
 * Build enhanced track table for AI with chapter and audio data
 * This enriches the data passed to AI for better episode boundary detection
 *
 * @param {Object} mergedDurations - { track: minutes }
 * @param {Object} lsdvdResult - Result from runLsdvdScan() with extended data
 * @param {Array} unrippableTracks - List of unrippable track numbers
 * @returns {Array} Enhanced track info for AI consumption
 */
function buildEnhancedTrackData(mergedDurations, lsdvdResult, unrippableTracks = []) {
    const enhancedTracks = [];

    const sortedTracks = Object.entries(mergedDurations)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    for (const [trackStr, durationMinutes] of sortedTracks) {
        const trackNum = parseInt(trackStr, 10);
        const isUnrippable = unrippableTracks.includes(trackNum);

        const trackInfo = {
            track: trackNum,
            durationMinutes,
            isUnrippable,
            // Default values if no lsdvd data
            chapters: 0,
            chapterDetails: null,
            audioLanguages: [],
            subtitleLanguages: [],
            videoDetails: null
        };

        // Enrich with lsdvd data if available
        if (lsdvdResult?.tracks?.[trackNum]) {
            const lsdvdTrack = lsdvdResult.tracks[trackNum];

            trackInfo.chapters = lsdvdTrack.chapters || 0;

            // Include chapter timestamps for AI to detect episode boundaries
            if (lsdvdTrack.chapterDetails && lsdvdTrack.chapterDetails.length > 0) {
                trackInfo.chapterDetails = lsdvdTrack.chapterDetails.map(ch => ({
                    index: ch.index,
                    lengthMinutes: Math.round((ch.lengthSeconds || 0) / 60 * 10) / 10 // 1 decimal place
                }));
            }

            // Audio languages (can indicate main content vs commentary)
            if (lsdvdTrack.audioDetails && lsdvdTrack.audioDetails.length > 0) {
                trackInfo.audioLanguages = lsdvdTrack.audioDetails.map(a => ({
                    language: a.language,
                    langCode: a.langCode,
                    format: a.format
                }));
            }

            // Subtitle languages (can indicate region/content type)
            if (lsdvdTrack.subtitleDetails && lsdvdTrack.subtitleDetails.length > 0) {
                trackInfo.subtitleLanguages = lsdvdTrack.subtitleDetails.map(s => ({
                    language: s.language,
                    langCode: s.langCode,
                    content: s.content
                }));
            }

            // Video details
            if (lsdvdTrack.videoDetails) {
                trackInfo.videoDetails = lsdvdTrack.videoDetails;
            }
        }

        enhancedTracks.push(trackInfo);
    }

    return enhancedTracks;
}

/**
 * Scan disc with dual-tool validation and retry on mismatch
 * Uses both HandBrakeCLI and lsdvd, retries if they disagree
 * Merges duration data for robustness (lsdvd as fallback for 0-duration tracks)
 *
 * @param {string} dvdSource - The DVD device path
 * @param {string} volumeName - The DVD volume name
 * @param {Object} options - Options object with verbose, interactive flags
 * @returns {Promise<{numTitles: number, titleDurations: Object, unrippableTracks: Array, scanWarning: string|null, lsdvdData: Object, enhancedTrackData: Array}>}
 */
async function scanDiscWithValidation(dvdSource, volumeName, options = {}) {
    const maxRetries = 1;
    let retryCount = 0;
    let lastHandbrakeResult = null;
    let lastLsdvdResult = null;
    let comparison = null;

    while (retryCount <= maxRetries) {
        // Run HandBrake scan (primary - has duration info we need)
        // Use quiet mode for retries so we don't confuse the user with multiple "What's on the menu" outputs
        const isRetry = retryCount > 0;
        const handbrakeResult = await scanDisc(dvdSource, volumeName, { ...options, _quietMenu: isRetry });
        lastHandbrakeResult = handbrakeResult;

        // Run lsdvd scan for validation (now with JSON output for rich metadata)
        const lsdvdResult = runLsdvdScan(dvdSource);
        lastLsdvdResult = lsdvdResult;

        // Compare results
        comparison = compareScanResults(handbrakeResult, lsdvdResult);

        if (comparison.match) {
            // Scans agree - merge durations and proceed with confidence
            const { mergedDurations, durationDiscrepancies, fallbacksUsed } = mergeDurations(handbrakeResult, lsdvdResult);

            // Build enhanced track data with chapters for AI
            const enhancedTrackData = buildEnhancedTrackData(
                mergedDurations,
                lsdvdResult,
                handbrakeResult.unrippableTracks || []
            );

            // Log any fallbacks used (technical info - move to debug for cleaner output)
            if (fallbacksUsed.length > 0) {
                getLogger().debug(`Used lsdvd duration for ${fallbacksUsed.length} track(s) where HandBrake reported 0`);
            }

            return {
                ...handbrakeResult,
                titleDurations: mergedDurations, // Use merged durations
                scanWarning: null,
                lsdvdData: lsdvdResult,
                enhancedTrackData,
                durationDiscrepancies,
                fallbacksUsed
            };
        }

        // Scans disagree
        if (retryCount < maxRetries) {
            console.log('');
            console.log(`   ⚠️  Scan discrepancy detected: HandBrake found ${comparison.handbrakeCount} tracks, lsdvd found ${comparison.lsdvdCount}`);
            console.log('   🔄 Retrying scan to verify...');
            console.log('');
            retryCount++;
        } else {
            // Exhausted retries - warn user but proceed
            break;
        }
    }

    // After all retries, we still have a mismatch
    // Use the larger count as the "truth" (a tool missing tracks is more common than finding phantom ones)
    const useHandbrake = (comparison.handbrakeCount >= comparison.lsdvdCount);

    const warningMessage = `Scan tools disagree on track count: HandBrake=${comparison.handbrakeCount}, lsdvd=${comparison.lsdvdCount}. ` +
        `Using ${useHandbrake ? 'HandBrake' : 'lsdvd'} result. Some tracks may be missed due to read errors or copy protection.`;

    // Merge durations even on mismatch to get the most complete data possible
    const { mergedDurations, durationDiscrepancies, fallbacksUsed } = mergeDurations(lastHandbrakeResult, lastLsdvdResult);

    // Build enhanced track data
    const enhancedTrackData = buildEnhancedTrackData(
        mergedDurations,
        lastLsdvdResult,
        lastHandbrakeResult?.unrippableTracks || []
    );

    // Show final summary since the retry scan was quiet
    if (lastHandbrakeResult && mergedDurations) {
        const scannedUnrippable = lastHandbrakeResult.unrippableTracks || [];
        const sortedTracks = Object.entries(mergedDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        const rippableCount = sortedTracks.filter(([track]) => !scannedUnrippable.includes(parseInt(track))).length;
        const unrippableCount = scannedUnrippable.length;

        // Clean summary
        const parts = [`${rippableCount} rippable`];
        if (unrippableCount > 0) {
            parts.push(`${unrippableCount} protected`);
        }
        console.log(`   ${parts.join(', ')} (after retry)`);
        console.log('');

        // Detailed track list only in verbose mode
        if (options.verbose) {
            console.log('📋 Track details:');
            sortedTracks.forEach(([track, duration]) => {
                const trackNum = parseInt(track);
                const isUnrippable = scannedUnrippable.includes(trackNum);
                const wasFallback = fallbacksUsed.some(f => f.track === trackNum);
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
                if (wasFallback) {
                    category += ' [lsdvd]';
                }
                console.log(`   ${icon}Track ${track}: ${duration} min${category}`);
            });
            console.log('');
        }
    }

    // Simplified warning - technical details to verbose
    console.log('   ⚠️  Disc read issues detected - some tracks may be copy-protected');
    getLogger().debug(`SCAN WARNING: HandBrake=${comparison.handbrakeCount}, lsdvd=${comparison.lsdvdCount}`);
    console.log('');

    getLogger().debug(`[SCAN WARNING] ${warningMessage}`);

    return {
        ...lastHandbrakeResult,
        titleDurations: mergedDurations, // Use merged durations
        scanWarning: warningMessage,
        lsdvdData: lastLsdvdResult,
        enhancedTrackData,
        durationDiscrepancies,
        fallbacksUsed
    };
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
 * Scan the DVD and get the number of titles with duration information
 * Returns structured results instead of using global state
 *
 * @param {string} dvdSource - The DVD device path
 * @param {string} volumeName - The DVD volume name
 * @param {Object} options - Options object with verbose flag
 * @returns {Promise<{numTitles: number, titleDurations: Object, unrippableTracks: Array}>}
 */
async function scanDisc(dvdSource, volumeName, options = {}) {
    // Simple, clean progress indicator for users
    process.stdout.write('🍊 Reading disc');

    // No caching - always scan fresh to avoid stale data issues

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
        let lastDotTime = Date.now();
        const DOT_INTERVAL = 500; // Show a dot every 500ms for progress

        // Stuck detection timer - check every 5 seconds
        const stuckCheckInterval = setInterval(() => {
            if (resolved) {
                clearInterval(stuckCheckInterval);
                return;
            }

            const timeSinceProgress = Date.now() - lastProgressTime;
            if (timeSinceProgress > STUCK_TIMEOUT_MS && scannedTitlesCount > 0) {
                clearInterval(stuckCheckInterval);
                process.stdout.write('\n');
                const stuckMsg = `Title ${stuckTitle || lastReportedTitle} appears stuck (no progress for ${STUCK_TIMEOUT_MS/1000}s)`;
                console.log(`   ⚠️  ${stuckMsg} - skipping remaining titles`);
                getLogger().debug(`STUCK DETECTION: ${stuckMsg}, last %: ${lastScanPercentage}`);
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

            // Only show raw HandBrake output in verbose mode
            if (options.verbose) {
                process.stdout.write(chunk);
            }

            // Check for total title count
            const totalMatch = chunk.match(/scan: DVD has (\d+) title/);
            if (totalMatch) {
                totalTitles = parseInt(totalMatch[1], 10);
                getLogger().debug(`Found ${totalTitles} titles on disc`);
                lastProgressTime = Date.now();
            }

            // Check for current title being scanned
            const scanningMatch = chunk.match(/scan: scanning title (\d+)/);
            if (scanningMatch) {
                const currentTitle = parseInt(scanningMatch[1], 10);
                if (currentTitle > lastReportedTitle) {
                    lastReportedTitle = currentTitle;
                    stuckTitle = currentTitle;
                    lastScanPercentage = null;
                    lastProgressTime = Date.now();
                    getLogger().debug(`Scanning track ${currentTitle} of ${totalTitles}`);

                    // Simple dot progress for non-verbose mode
                    if (!options.verbose) {
                        const now = Date.now();
                        if (now - lastDotTime >= DOT_INTERVAL) {
                            process.stdout.write('.');
                            lastDotTime = now;
                        }
                    }
                }
            }

            // Track scan percentage within a title - if it changes, we're making progress
            const percentMatch = chunk.match(/Scanning title \d+ of \d+, (\d+\.\d+) %/);
            if (percentMatch) {
                const currentPercent = parseFloat(percentMatch[1]);
                if (lastScanPercentage === null || currentPercent > lastScanPercentage) {
                    lastScanPercentage = currentPercent;
                    lastProgressTime = Date.now();
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
                lastProgressTime = Date.now();
                stuckTitle = null;

                // Mark 0-duration tracks as unrippable (copy-protected or invalid)
                if (totalMinutes === 0 && !unrippableTracks.includes(lastReportedTitle)) {
                    unrippableTracks.push(lastReportedTitle);
                    getLogger().debug(`Track ${lastReportedTitle}: 0 duration - marking as unrippable`);
                }

                // Kill process once we have all title durations - HandBrakeCLI hangs on post-processing
                if (totalTitles > 0 && scannedTitlesCount >= totalTitles) {
                    resolved = true;
                    clearInterval(stuckCheckInterval);
                    if (!options.verbose) {
                        process.stdout.write(' done\n');
                    }
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
                // End the progress line
                if (!options.verbose) {
                    process.stdout.write(' done\n');
                }
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
                console.log(`   ⚠️  ${skippedCount} track(s) couldn't be read (copy-protected)`);
                getLogger().debug(`COPY PROTECTION: Skipping tracks ${stuckAtTitle + 1}-${numTitles} to avoid kernel I/O issues`);
            }

            // Clean summary line
            console.log(`✓ Found ${numTitles} track${numTitles !== 1 ? 's' : ''} on disc`);
            console.log('');

            // Display track duration summary (skip if this is a retry scan - we'll show the final result)
            const sortedTracks = Object.entries(finalDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
            const rippableCount = sortedTracks.filter(([track]) => !scannedUnrippable.includes(parseInt(track))).length;
            const unrippableCount = scannedUnrippable.length;

            if (!options._quietMenu) {
                // Show clean summary for regular users
                const parts = [`${rippableCount} rippable`];
                if (unrippableCount > 0) {
                    parts.push(`${unrippableCount} protected`);
                }
                console.log(`   ${parts.join(', ')}`);
                console.log('');

                // Only show detailed track list in verbose mode
                if (options.verbose) {
                    console.log('📋 Track details:');
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
                }
            }

            // No caching - scan fresh every time to avoid stale data
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
    parseLsdvdJsonOutput,
    parseDiscPatternFromTitle,

    // DVD detection
    detectAllDvdDrives,
    detectDvdSource,
    getVolumeName,

    // Cache management (kept for backwards compatibility, but no longer used)
    getCacheDir,
    getCacheFilePath,
    cleanupOldCacheFiles,
    loadFromCache,
    saveToCache,

    // Disc scanning
    resetDvdDrive,
    scanDisc,
    scanDiscWithValidation,
    runLsdvdScan,
    compareScanResults,
    mergeDurations,
    buildEnhancedTrackData,
    setDefaultOutputDir,
    getVideoDuration
};
