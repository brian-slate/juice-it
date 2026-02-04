/**
 * JuiceIt File Rename Operations
 *
 * Handles renaming existing video files with proper Plex-compatible names.
 */

const fsModule = require('fs');
const path = require('path');

const discModule = require('./disc');
const { sanitizeForPlex, buildBaseFileName } = require('./naming');
const { printSeparator } = require('./display');

// ==================== DEPENDENCY INJECTION ====================

// Dependencies with defaults
let deps = {
    fs: fsModule,
    disc: discModule
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
        fs: fsModule,
        disc: discModule
    };
}

// Dependencies injected via setters
let logger = null;
let logFn = () => {};
let initializeLogFn = () => {};
let closeLogFn = () => {};
let lookupMetadataFn = null;

/**
 * Set the logger instance
 */
function setLogger(loggerInstance) {
    logger = loggerInstance;
}

/**
 * Set logging functions
 */
function setLogFunctions(log, initializeLog, closeLog) {
    logFn = log;
    initializeLogFn = initializeLog;
    closeLogFn = closeLog;
}

/**
 * Set metadata lookup function
 */
function setMetadataLookup(lookupFn) {
    lookupMetadataFn = lookupFn;
}

/**
 * Rename existing files using metadata
 *
 * @param {Object} options - CLI options
 */
async function renameExistingFiles(options) {
    try {
        const volumeName = deps.disc.getVolumeName(options.dvdSource);

        // For rename-only mode, output directory must be specified
        if (!options.outputDir) {
            logger.error('\n❌ Error: --output directory must be specified when using --rename-only\n');
            return;
        }

        if (!deps.fs.existsSync(options.outputDir)) {
            logger.error(`\n❌ Error: Output directory "${options.outputDir}" does not exist\n`);
            return;
        }

        console.log('');
        printSeparator();
        console.log('  🏷️  JuiceIt File Renamer');
        printSeparator();
        console.log(`  DVD:     "${volumeName}"`);
        console.log(`  Output:  ${options.outputDir}/`);
        printSeparator();
        console.log('');

        // Load DVD title durations from cache if available
        const cacheFilePath = deps.disc.getCacheFilePath(volumeName);
        let dvdTitleDurations = null;
        if (deps.fs.existsSync(cacheFilePath)) {
            try {
                const cacheData = JSON.parse(deps.fs.readFileSync(cacheFilePath));
                if (cacheData.volumeName === volumeName && cacheData.titleDurations) {
                    dvdTitleDurations = cacheData.titleDurations;
                    console.log(`💿 Using DVD track durations from disc scan\n`);
                    logger.debug(`DVD title durations: ${JSON.stringify(dvdTitleDurations)}`);
                }
            } catch (error) {
                logger.debug(`Could not load cache: ${error.message}`);
            }
        }

        // Find existing files in output directory
        const allFiles = deps.fs.readdirSync(options.outputDir)
            .filter(f => f.endsWith('.mp4') && !f.startsWith('.'))
            .sort();

        if (allFiles.length === 0) {
            console.log('❌ No MP4 files found in output directory\n');
            return;
        }

        console.log(`📂 Analyzing ${allFiles.length} file(s)...\n`);

        // Get duration for each file
        const filesWithDuration = allFiles.map((f, _index) => {
            const filePath = path.join(options.outputDir, f);
            const duration = deps.disc.getVideoDuration(filePath);
            const stats = deps.fs.statSync(filePath);

            // Try to extract track number from filename (e.g., LOOK_AROUND_YOU_3.mp4 -> track 3)
            let trackNumber = null;
            const trackMatch = f.match(/_([\d]+)\.mp4$/);
            if (trackMatch) {
                trackNumber = parseInt(trackMatch[1], 10);
            }

            // Get DVD duration if available
            let dvdDuration = null;
            if (dvdTitleDurations && trackNumber && dvdTitleDurations[trackNumber]) {
                dvdDuration = dvdTitleDurations[trackNumber];
            }

            return {
                name: f,
                duration,
                dvdDuration,
                trackNumber,
                size: stats.size,
                path: filePath
            };
        }).filter(f => f.duration !== null);

        // Sort by filename to maintain track order
        filesWithDuration.sort((a, b) => {
            if (a.trackNumber && b.trackNumber) {
                return a.trackNumber - b.trackNumber;
            }
            return a.name.localeCompare(b.name);
        });

        // Use file count as numTitles for metadata lookup
        const numTitles = filesWithDuration.length;

        let metadata = null;
        if (!options.noLookup && lookupMetadataFn) {
            metadata = await lookupMetadataFn(volumeName, numTitles);
        } else {
            metadata = { type: 'disc', volumeName };
        }

        // Filter files based on metadata
        let episodeFiles = [];
        let extraFiles = [];

        if (metadata.type === 'tv' && metadata.episodes) {
            // For TV shows with episode data, use expected runtime to filter
            const expectedCount = metadata.episodes.length;
            const avgRuntime = metadata.episodes.reduce((sum, ep) => sum + (ep.runtime || 25), 0) / expectedCount;
            const minRuntime = Math.max(5, avgRuntime * 0.7);
            const maxRuntime = Math.min(60, avgRuntime * 1.5);

            console.log(`📺 Expected ${expectedCount} episodes (~${Math.round(avgRuntime)} min each)\n`);
            logFn(`Expected runtime range: ${Math.round(minRuntime)}-${Math.round(maxRuntime)} minutes`);

            const candidateFiles = filesWithDuration.filter(f => f.duration >= minRuntime && f.duration <= maxRuntime);
            episodeFiles = candidateFiles.slice(0, expectedCount);
            extraFiles = filesWithDuration.filter(f => !episodeFiles.includes(f));
        } else {
            episodeFiles = filesWithDuration.filter(f => f.duration >= 5 && f.duration <= 60);
            extraFiles = filesWithDuration.filter(f => f.duration < 5 || f.duration > 60);
        }

        if (extraFiles.length > 0) {
            console.log('📌 Skipping non-episode files:');
            extraFiles.forEach(f => {
                let reason;
                if (f.duration < 5) {
                    reason = 'too short (likely menu/extra)';
                } else if (f.duration > 60) {
                    reason = 'too long (likely full disc rip)';
                } else {
                    reason = 'does not match expected episode runtime';
                }
                console.log(`   ⏭  ${f.name} (${f.duration} min - ${reason})`);
                logFn(`Skipping ${f.name}: ${f.duration} min (${reason})`);
            });
            console.log('');
        }

        const existingFiles = episodeFiles.map(f => f.name);

        if (existingFiles.length === 0) {
            console.log('❌ No valid episode files found\n');
            return;
        }

        console.log(`✓ Found ${existingFiles.length} episode file(s) to rename\n`);

        const logFilePath = initializeLogFn(options.outputDir, volumeName);
        logFn(`Rename mode - Metadata: ${JSON.stringify(metadata)}`);

        // Determine base file name based on metadata
        const baseFileName = buildBaseFileName(metadata, volumeName);

        let renameCount = 0;

        for (let i = 0; i < existingFiles.length; i++) {
            const oldFile = existingFiles[i];
            const titleNumber = i + 1;
            let newFileName;

            // Generate filename based on metadata type (Plex-compatible format)
            if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[i]) {
                const episode = metadata.episodes[i];
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(episode.episode_number).padStart(2, '0');
                const episodeTitle = episode.name ? ` - ${sanitizeForPlex(episode.name)}` : '';
                newFileName = `${baseFileName} - s${seasonNum}e${episodeNum}${episodeTitle}.mp4`;
            } else if (metadata.type === 'tv') {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(titleNumber).padStart(2, '0');
                newFileName = `${baseFileName} - s${seasonNum}e${episodeNum}.mp4`;
            } else if (numTitles === 1) {
                newFileName = `${baseFileName}.mp4`;
            } else {
                newFileName = `${baseFileName} - Part ${titleNumber}.mp4`;
            }

            const oldPath = path.join(options.outputDir, oldFile);
            const newPath = path.join(options.outputDir, newFileName);

            if (oldFile === newFileName) {
                console.log(`  ⏭  ${oldFile} (unchanged)`);
                logFn(`File unchanged: ${oldFile}`);
            } else if (deps.fs.existsSync(newPath) && oldPath !== newPath) {
                console.log(`  ⚠️  ${oldFile}`);
                console.log(`    → ${newFileName} (target exists, skipping to prevent overwrite)`);
                logFn(`Skipped rename ${oldFile} -> ${newFileName}: target file already exists`);
            } else {
                try {
                    deps.fs.renameSync(oldPath, newPath);
                    console.log(`  ✓ ${oldFile}`);
                    console.log(`    → ${newFileName}`);
                    logFn(`Renamed: ${oldFile} -> ${newFileName}`);
                    renameCount++;
                } catch (error) {
                    console.log(`  ❌ Failed to rename ${oldFile}: ${error.message}`);
                    logFn(`Error renaming ${oldFile}: ${error.message}`);
                }
            }
        }

        console.log('');
        printSeparator();
        if (renameCount > 0) {
            console.log(`  ⚡ Renamed ${renameCount} file(s) successfully!`);
        } else {
            console.log(`  ℹ️  No files needed renaming`);
        }
        printSeparator();

        if (logFilePath) {
            const relativeLogPath = path.relative(process.cwd(), logFilePath);
            console.log(`  📄 Log: ${relativeLogPath}`);
        }
        console.log('');

        closeLogFn();
    } catch (error) {
        logger.error(`\n❌ Error during renaming: ${error}\n`);
        closeLogFn();
    }
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    setLogger,
    setLogFunctions,
    setMetadataLookup,
    renameExistingFiles
};
