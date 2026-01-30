#!/usr/bin/env node
/**
 * JuiceIt Script
 *
 * This script rips all tracks from a DVD using HandBrakeCLI.
 *
 * Usage:
 *   node juiceit.js [options]
 *
 * Options:
 *   --help      Show this help message
 *   --output    Specify the output directory
 *   --dvdSource Specify the DVD source (e.g., /dev/disk5)
 *   --quality   Set the encoding quality (e.g., 20)
 *   --no-deinterlace  Disable deinterlacing
 *   --subtitles  Specify the subtitle track number (default: 1)
 *   --sub-lang   Specify the subtitle language code (default: eng)
 *   --verbose   Show detailed technical output
 *
 * Example:
 *   node juiceit.js --output /path/to/output --dvdSource /dev/disk5
 *
 * Requirements:
 *   - Node.js
 *   - HandBrakeCLI
 *   - node-pty
 *   - libdvdcss (for encrypted DVDs)
 */

const { execSync, spawn, spawnSync } = require('child_process'); // Ensure spawn is imported
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Select, Input, AutoComplete } = require('enquirer');

// ==================== LOGGING ====================

let logStream = null;
const skippedTracks = [];

function initializeLog(outputDir, volumeName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logFileName = `juiceit_${volumeName}_${timestamp}.log`;
    const logFilePath = path.join(outputDir, logFileName);
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    log(`JuiceIt DVD Ripper Log`);
    log(`DVD: ${volumeName}`);
    log(`Started: ${new Date().toISOString()}`);
    log(`Output Directory: ${outputDir}`);
    log('='.repeat(70));
    return logFilePath;
}

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    if (logStream) {
        logStream.write(logMessage);
    }
}

function closeLog() {
    if (logStream) {
        log('='.repeat(70));
        log(`Finished: ${new Date().toISOString()}`);
        logStream.end();
    }
}

// ==================== METADATA LOOKUP ====================

const TMDB_API_KEY = 'REMOVED_API_KEY'; // Read-only demo key

async function searchTMDB(query, isTV = false) {
    try {
        const endpoint = isTV ? 'search/tv' : 'search/movie';
        const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, {
            params: {
                api_key: TMDB_API_KEY,
                query: query,
                language: 'en-US'
            }
        });
        return response.data.results || [];
    } catch (error) {
        if (options.verbose) {
            console.log(`Error searching TMDB: ${error.message}`);
        }
        return [];
    }
}

async function getTVSeasonDetails(tvId, seasonNumber) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}`, {
            params: {
                api_key: TMDB_API_KEY,
                language: 'en-US'
            }
        });
        return response.data;
    } catch (error) {
        if (options.verbose) {
            console.log(`Error fetching season details: ${error.message}`);
        }
        return null;
    }
}

function guessMediaType(numTitles) {
    // If there are multiple titles (usually 2+), it's likely a TV show
    // Movies typically have 1-2 titles (feature + extras)
    return numTitles >= 3 ? 'tv' : 'movie';
}

async function lookupMetadata(volumeName, numTitles) {
    console.log('\n🔍 Looking up metadata...');
    
    // Clean up the volume name for searching
    const cleanName = volumeName.replace(/_/g, ' ').replace(/\s+D\d+$/i, '').trim();
    const mediaType = guessMediaType(numTitles);
    
    log(`Searching for: "${cleanName}" (guessing type: ${mediaType})`);
    
    // Search both movie and TV
    const movieResults = await searchTMDB(cleanName, false);
    const tvResults = await searchTMDB(cleanName, true);
    
    const choices = [];
    
    // Add TV results first if we think it's a TV show
    if (mediaType === 'tv') {
        tvResults.slice(0, 5).forEach(show => {
            const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
            choices.push({
                name: `TV: ${show.name} ${year}`,
                value: { type: 'tv', data: show },
                hint: show.overview ? show.overview.substring(0, 80) + '...' : ''
            });
        });
        movieResults.slice(0, 3).forEach(movie => {
            const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
            choices.push({
                name: `Movie: ${movie.title} ${year}`,
                value: { type: 'movie', data: movie },
                hint: movie.overview ? movie.overview.substring(0, 80) + '...' : ''
            });
        });
    } else {
        movieResults.slice(0, 5).forEach(movie => {
            const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
            choices.push({
                name: `Movie: ${movie.title} ${year}`,
                value: { type: 'movie', data: movie },
                hint: movie.overview ? movie.overview.substring(0, 80) + '...' : ''
            });
        });
        tvResults.slice(0, 3).forEach(show => {
            const year = show.first_air_date ? `(${show.first_air_date.split('-')[0]})` : '';
            choices.push({
                name: `TV: ${show.name} ${year}`,
                value: { type: 'tv', data: show },
                hint: show.overview ? show.overview.substring(0, 80) + '...' : ''
            });
        });
    }
    
    // Add options for manual entry and using disc name
    choices.push({ name: 'Enter custom name/prefix', value: { type: 'custom' } });
    choices.push({ name: `Use disc name: "${volumeName}"`, value: { type: 'disc' } });
    
    if (choices.length === 2) {
        // No results found
        console.log('⚠️  No metadata found online\n');
        log('No metadata found');
        return { type: 'disc', volumeName };
    }
    
    try {
        // Use Select instead of AutoComplete to avoid regex issues with special characters
        const prompt = new Select({
            name: 'media',
            message: 'Select the correct match:',
            choices: choices.map(c => ({
                name: c.name,
                value: c.value,
                hint: c.hint
            })),
            result(name) {
                return this.focused.value;
            }
        });
        
        const selected = await prompt.run();
        log(`User selected: ${JSON.stringify(selected)}`);
        
        if (selected.type === 'custom') {
            const namePrompt = new Input({
                message: 'Enter name or prefix for episodes:',
                initial: cleanName
            });
            const customName = await namePrompt.run();
            log(`User entered custom name: ${customName}`);
            return { type: 'custom', name: customName };
        } else if (selected.type === 'disc') {
            return { type: 'disc', volumeName };
        } else if (selected.type === 'tv') {
            // For TV shows, ask about season
            const seasonPrompt = new Input({
                message: 'Enter season number (default: 1):',
                initial: '1',
                validate(value) {
                    return /^\d+$/.test(value) || 'Please enter a valid number';
                }
            });
            const season = parseInt(await seasonPrompt.run());
            log(`User selected season: ${season}`);
            
            // Fetch episode details
            const seasonDetails = await getTVSeasonDetails(selected.data.id, season);
            
            return {
                type: 'tv',
                name: selected.data.name,
                season: season,
                episodes: seasonDetails ? seasonDetails.episodes : null
            };
        } else {
            return {
                type: 'movie',
                name: selected.data.title,
                year: selected.data.release_date ? selected.data.release_date.split('-')[0] : null
            };
        }
    } catch (error) {
        // User cancelled or error occurred
        console.log('\nUsing disc name as fallback\n');
        log('User cancelled selection or error occurred');
        return { type: 'disc', volumeName };
    }
}

// ==================== DISPLAY HELPERS ====================

// Create a progress bar
function createProgressBar(progress, width = 20) {
    const percentage = Math.min(100, Math.max(0, parseFloat(progress)));
    const filledWidth = Math.round((percentage / 100) * width);
    const emptyWidth = width - filledWidth;
    const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
    return `[${bar}] ${percentage.toFixed(2)}%`;
}

// Format time in seconds to human readable
function formatTime(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

// Print a clean header banner
function printBanner(volumeName) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬  JuiceIt DVD Ripper');
    console.log('━'.repeat(60));
    console.log(`  DVD:     "${volumeName}"`);
    console.log(`  Output:  ${options.outputDir}/`);
    console.log(`  Quality: HQ 1080p30 (CRF ${options.encoding.quality})`);
    console.log('━'.repeat(60));
    console.log('');
}

// Centralized argument processing
const args = process.argv.slice(2);
const options = {
    outputDir: null, // Will be set dynamically based on disc name + datestamp
    dvdSource: null, // Initialize dvdSource
    encoding: {
        encoder: 'x264', // Default encoder
        quality: '20',    // Default quality
        deinterlace: true, // Default to enabled
    },
    subtitles: {
        track: 1, // Default to the first subtitle track
        language: 'eng' // Default to English
    },
    verbose: false // Default to clean output
};

// Process command-line arguments
args.forEach((arg, index) => {
    if (arg === '--help') {
        options.showHelp = true;
    } else if (arg === '--output' && args[index + 1]) {
        options.outputDir = args[index + 1]; // Set outputDir from argument
    } else if (arg === '--dvdSource' && args[index + 1]) {
        options.dvdSource = args[index + 1]; // Set dvdSource from argument
    } else if (arg === '--quality' && args[index + 1]) {
        options.encoding.quality = args[index + 1]; // Set quality from argument
    } else if (arg === '--no-deinterlace') {
        options.encoding.deinterlace = false; // Disable deinterlacing
    } else if (arg === '--subtitles' && args[index + 1]) {
        options.subtitles.track = parseInt(args[index + 1], 10); // Set subtitle track from argument
    } else if (arg === '--sub-lang' && args[index + 1]) {
        options.subtitles.language = args[index + 1]; // Set subtitle language from argument
    } else if (arg === '--verbose') {
        options.verbose = true; // Enable verbose output
    } else if (arg === '--no-lookup') {
        options.noLookup = true; // Skip metadata lookup
    } else if (arg === '--rename-only') {
        options.renameOnly = true; // Only rename existing files
    } else if (arg === '--scan-only') {
        options.scanOnly = true; // Only scan and show metadata
    }
});

// Helper function to set default output directory
function setDefaultOutputDir(volumeName) {
    if (!options.outputDir) {
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const safeName = volumeName.replace(/[^a-zA-Z0-9_-]/g, '_');
        options.outputDir = path.join(process.cwd(), `${safeName}_${timestamp}`);
    }
    // Ensure the output directory exists
    if (!fs.existsSync(options.outputDir)) {
        fs.mkdirSync(options.outputDir, { recursive: true });
    }
}

// Cache file path will be set dynamically
function getCacheFilePath() {
    // Use system cache directory instead of polluting output folder
    const os = require('os');
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
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Use volume name in cache filename to support multiple discs
    const volumeName = getVolumeName();
    const safeVolumeName = volumeName ? volumeName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
    return path.join(cacheDir, `${safeVolumeName}.json`);
}

// Check if HandBrakeCLI is installed
function checkHandBrakeCLI() {
    const result = spawnSync('HandBrakeCLI', ['--version']);
    if (result.error || result.status !== 0) {
        console.error("HandBrakeCLI is not installed. Please install it using 'brew install handbrake' to use this script.");
        process.exit(1);
    }
}

// Check if libdvdcss is installed
function checkLibdvdcss() {
    const result = spawnSync('brew', ['list', 'libdvdcss']);
    if (result.error || result.status !== 0) {
        console.error("libdvdcss is not installed. Please install it using 'brew install libdvdcss' to use this script.");
        process.exit(1);
    }
}

// Function to detect all DVD drives
function detectAllDvdDrives() {
    try {
        const diskListOutput = execSync('diskutil list').toString();
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
        console.error("Error detecting DVD drives:", error);
        return [];
    }
}

// Function to detect the DVD source automatically
async function detectDvdSource() {
    const drives = detectAllDvdDrives();
    
    if (drives.length === 0) {
        return null;
    } else if (drives.length === 1) {
        return drives[0].device;
    } else {
        // Multiple drives found - show interactive selection
        console.log('\n📀 Multiple DVD drives detected:\n');
        
        const choices = drives.map(d => ({
            name: `${d.device} - "${d.name}" (${d.size})`,
            value: d.device
        }));
        
        try {
            const prompt = new Select({
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

// Show help if requested (do this before async operations)
if (options.showHelp || args.length === 0) {
    showHelp();
    process.exit(0);
}

// Async initialization function
(async () => {
    // Set dvdSource if not provided
    if (!options.dvdSource) {
        options.dvdSource = await detectDvdSource(); // Automatically detect DVD source
    }

    // Fallback if no DVD source is detected
    if (!options.dvdSource) {
        console.error("No DVD source detected. Please provide a valid DVD source using --dvdSource.");
        process.exit(1);
    }

    // Start the ripping or renaming process
    if (options.renameOnly) {
        await renameExistingFiles();
    } else {
        await ripAllTracks();
    }
})();

// Function to rip DVD with progress output
function ripDvd(titleNumber, outputFileName, trackNum, totalTracks, onProgress) {
    return new Promise((resolve, reject) => {
        const outputFilePath = path.join(options.outputDir, `${outputFileName}.mp4`); // Use options.outputDir
        // Updated arguments for HandBrakeCLI with conditional deinterlacing, subtitles, and additional options
        const args = [
            '-i', options.dvdSource,
            '-o', outputFilePath,
            '-e', options.encoding.encoder,
            '-q', options.encoding.quality,
            '-t', titleNumber.toString(),
            '--subtitle', options.subtitles.track.toString(), // Include the specified subtitle track
            '--decomb', // Use decomb filter for deinterlacing
            '--detelecine', // Use detelecine filter
            '--rate', '30', // Set frame rate to 30 fps
            '--preset', 'HQ 1080p30 Surround' // Use a valid preset
        ];

        // Add deinterlace option if enabled
        if (options.encoding.deinterlace) {
            args.push('--deinterlace');
        }

        // Log the HandBrakeCLI command
        log(`Starting track ${titleNumber}: ${outputFileName}`);
        log(`Command: HandBrakeCLI ${args.join(' ')}`);
        
        if (options.verbose) {
            console.log(`⚙️ Running HandBrakeCLI with command: HandBrakeCLI ${args.join(' ')}`);
        }

        const startTime = Date.now();
        const handbrakeProcess = spawn('HandBrakeCLI', args);
        let lastProgress = 0;
        let errorOutput = '';

        handbrakeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            log(`[stdout] ${output.trim()}`);
            const progressMatch = output.match(/Encoding:.* (\d{1,3}\.\d{1,2}) %/);
            if (progressMatch && progressMatch[1]) {
                const progress = parseFloat(progressMatch[1]);
                if (progress !== lastProgress) {
                    lastProgress = progress;
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
            log(`[stderr] ${dataStr.trim()}`);
            if (options.verbose) {
                console.log(`\n[handbrake-info]: ${dataStr}`);
            }
        });

        handbrakeProcess.on('close', (code) => {
            if (code === 0) {
                log(`Track ${titleNumber} completed successfully`);
                resolve();
            } else {
                log(`Track ${titleNumber} failed with exit code ${code}`);
                log(`Error output: ${errorOutput}`);
                reject({ code, errorOutput, titleNumber });
            }
        });
    });
}

// Get volume name using diskutil
function getVolumeName() {
    try {
        const output = execSync(`diskutil info ${options.dvdSource}`).toString();
        const match = output.match(/Volume Name:\s*(.+)/);
        return match ? match[1].trim() : null; // Return the Volume Name if found
    } catch (error) {
        console.error("Error fetching volume name:", error);
        return null;
    }
}

// Get number of titles with caching and duration information
async function getNumberOfTitles() {
    process.stdout.write('🔍 Scanning disc...');
    const volumeName = getVolumeName(); // Get the current volume name
    const cacheFilePath = getCacheFilePath();

    if (options.verbose) {
        console.log(`\nCurrent Volume Name: ${volumeName}`);
        console.log(`Cache file path: ${cacheFilePath}`);
    }

    // Check if cache exists
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));

        if (options.verbose) {
            console.log(`\nCached Volume Name: ${cacheData.volumeName}`);
            console.log(`Comparing cached volume name "${cacheData.volumeName}" with current volume name "${volumeName}"`);
        }

        if (cacheData.volumeName === volumeName) {
            console.log(` ✓ Found ${cacheData.numTitles} title${cacheData.numTitles > 1 ? 's' : ''} (cached)`);
            console.log('');
            // Store title durations globally if available
            if (cacheData.titleDurations) {
                global.dvdTitleDurations = cacheData.titleDurations;
            }
            return cacheData.numTitles;
        } else if (options.verbose) {
            console.log("Volume names do not match. Cache will be ignored.");
        }
    } else if (options.verbose) {
        console.log("Cache does not exist. Fetching title information from the disc.");
    }

    // Fetch title information if cache is not valid
    return new Promise((resolve, reject) => {
        const args = ['-i', options.dvdSource, '--title', '0', '--scan'];

        const handbrakeProcess = spawn('HandBrakeCLI', args);

        let output = '';

        handbrakeProcess.stdout.on('data', function(data) {
            const dataStr = data.toString();
            if (options.verbose) {
                process.stdout.write(dataStr);
            }
            output += dataStr;
        });

        handbrakeProcess.stderr.on('data', function(data) {
            const dataStr = data.toString();
            if (options.verbose) {
                process.stdout.write(dataStr);
            }
            output += dataStr;
        });

        handbrakeProcess.on('close', (exitCode) => {
            if (exitCode === 0) {
                const match = output.match(/scan: DVD has (\d+) title/);
                if (match) {
                    const numTitles = parseInt(match[1], 10);
                    console.log(` ✓ Found ${numTitles} title${numTitles > 1 ? 's' : ''}`);
                    console.log('');

                    // Parse title durations from HandBrakeCLI output
                    const titleDurations = {};
                    // Match format: "+ title 1:" followed by "  + duration: 00:27:45"
                    const titleMatches = output.matchAll(/\+ title (\d+):[\s\S]*?\+ duration: (\d{2}):(\d{2}):(\d{2})/g);
                    for (const titleMatch of titleMatches) {
                        const titleNum = parseInt(titleMatch[1], 10);
                        const hours = parseInt(titleMatch[2], 10);
                        const mins = parseInt(titleMatch[3], 10);
                        const secs = parseInt(titleMatch[4], 10);
                        const totalMinutes = hours * 60 + mins + Math.round(secs / 60);
                        titleDurations[titleNum] = totalMinutes;
                    }
                    
                    // Store globally for use during ripping
                    global.dvdTitleDurations = titleDurations;

                    // Display track duration summary
                    console.log('\n📋 Track Summary:');
                    const sortedTracks = Object.entries(titleDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
                    sortedTracks.forEach(([track, duration]) => {
                        let category = '';
                        if (duration < 5) {
                            category = ' (menu/extra)';
                        } else if (duration > 60) {
                            category = ' (full disc)';
                        } else if (duration >= 20 && duration <= 35) {
                            category = ' (episode)';
                        }
                        console.log(`   Track ${track}: ${duration} min${category}`);
                    });
                    console.log('');

                    // Cache the title information with volume name and durations
                    fs.writeFileSync(cacheFilePath, JSON.stringify({ 
                        volumeName, 
                        numTitles,
                        titleDurations,
                        scannedAt: new Date().toISOString()
                    }, null, 2));
                    
                    if (options.verbose) {
                        console.log(`Cache created with Volume Name: ${volumeName}, Titles: ${numTitles}`);
                        console.log(`Title durations:`, titleDurations);
                    }
                    resolve(numTitles);
                } else {
                    console.log(" ✗ No titles found.");
                    console.log('');
                    resolve(0);
                }
            } else {
                reject(`HandBrakeCLI process exited with code ${exitCode}`);
            }
        });
    });
}

// Clear cache if the volume name changes (will be checked in getNumberOfTitles)

// Helper function to categorize track by duration
function categorizeTrack(duration) {
    if (duration < 2) {
        return 'menu';
    } else if (duration < 10) {
        return 'extra';
    } else if (duration >= 20 && duration <= 45) {
        return 'episode';
    } else if (duration > 90) {
        return 'full_disc';
    } else {
        return 'unknown';
    }
}

// Helper function to get video duration in minutes
function getVideoDuration(filePath) {
    try {
        const result = spawnSync('ffprobe', [
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
        if (options.verbose) {
            console.log(`Error getting duration for ${filePath}: ${error.message}`);
        }
    }
    return null;
}

async function renameExistingFiles() {
    try {
        const volumeName = getVolumeName();
        
        // For rename-only mode, output directory must be specified
        if (!options.outputDir) {
            console.error('\n❌ Error: --output directory must be specified when using --rename-only\n');
            return;
        }
        
        if (!fs.existsSync(options.outputDir)) {
            console.error(`\n❌ Error: Output directory "${options.outputDir}" does not exist\n`);
            return;
        }
        
        console.log('');
        console.log('━'.repeat(60));
        console.log('  🏷️  JuiceIt File Renamer');
        console.log('━'.repeat(60));
        console.log(`  DVD:     "${volumeName}"`);
        console.log(`  Output:  ${options.outputDir}/`);
        console.log('━'.repeat(60));
        console.log('');
        
        // Load DVD title durations from cache if available
        const cacheFilePath = getCacheFilePath();
        let dvdTitleDurations = null;
        if (fs.existsSync(cacheFilePath)) {
            try {
                const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));
                if (cacheData.volumeName === volumeName && cacheData.titleDurations) {
                    dvdTitleDurations = cacheData.titleDurations;
                    console.log(`💿 Using DVD track durations from disc scan\n`);
                    if (options.verbose) {
                        console.log('DVD title durations:', dvdTitleDurations);
                    }
                }
            } catch (error) {
                if (options.verbose) {
                    console.log(`Could not load cache: ${error.message}`);
                }
            }
        }
        
        // Find existing files in output directory
        const allFiles = fs.readdirSync(options.outputDir)
            .filter(f => f.endsWith('.mp4') && !f.startsWith('.'))
            .sort();
        
        if (allFiles.length === 0) {
            console.log('❌ No MP4 files found in output directory\n');
            return;
        }
        
        console.log(`📂 Analyzing ${allFiles.length} file(s)...\n`);
        
        // Get duration for each file
        const filesWithDuration = allFiles.map((f, index) => {
            const filePath = path.join(options.outputDir, f);
            const duration = getVideoDuration(filePath);
            const stats = fs.statSync(filePath);
            
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
        
        // Use file count as numTitles for metadata lookup (use total count for better type detection)
        const numTitles = filesWithDuration.length;
        
        let metadata = null;
        if (!options.noLookup) {
            metadata = await lookupMetadata(volumeName, numTitles);
        } else {
            metadata = { type: 'disc', volumeName };
        }
        
        // Now filter files based on metadata
        let episodeFiles = [];
        let extraFiles = [];
        
        if (metadata.type === 'tv' && metadata.episodes) {
            // For TV shows with episode data, use expected runtime to filter
            const expectedCount = metadata.episodes.length;
            const avgRuntime = metadata.episodes.reduce((sum, ep) => sum + (ep.runtime || 25), 0) / expectedCount;
            const minRuntime = Math.max(5, avgRuntime * 0.7); // 70% of average runtime
            const maxRuntime = Math.min(60, avgRuntime * 1.5); // 150% of average runtime
            
            console.log(`📺 Expected ${expectedCount} episodes (~${Math.round(avgRuntime)} min each)\n`);
            log(`Expected runtime range: ${Math.round(minRuntime)}-${Math.round(maxRuntime)} minutes`);
            
            // Filter by runtime and take only expected count
            const candidateFiles = filesWithDuration.filter(f => f.duration >= minRuntime && f.duration <= maxRuntime);
            episodeFiles = candidateFiles.slice(0, expectedCount);
            extraFiles = filesWithDuration.filter(f => !episodeFiles.includes(f));
        } else {
            // For movies or when no episode data, use simple filtering
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
                log(`Skipping ${f.name}: ${f.duration} min (${reason})`);
            });
            console.log('');
        }
        
        const existingFiles = episodeFiles.map(f => f.name);
        
        if (existingFiles.length === 0) {
            console.log('❌ No valid episode files found\n');
            return;
        }
        
        console.log(`✓ Found ${existingFiles.length} episode file(s) to rename\n`);
        
        const logFilePath = initializeLog(options.outputDir, volumeName);
        log(`Rename mode - Metadata: ${JSON.stringify(metadata)}`);
        
        // Determine base file name based on metadata
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'movie') {
            const year = metadata.year ? `_${metadata.year}` : '';
            baseFileName = `${metadata.name}${year}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'custom') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        }
        
        let renameCount = 0;
        
        for (let i = 0; i < existingFiles.length; i++) {
            const oldFile = existingFiles[i];
            const titleNumber = i + 1;
            let newFileName;
            
            // Generate filename based on metadata type
            if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[i]) {
                const episode = metadata.episodes[i];
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(episode.episode_number).padStart(2, '0');
                const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
                newFileName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}.mp4`;
            } else if (metadata.type === 'tv') {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(titleNumber).padStart(2, '0');
                newFileName = `${baseFileName}_S${seasonNum}E${episodeNum}.mp4`;
            } else if (numTitles === 1) {
                newFileName = `${baseFileName}.mp4`;
            } else {
                newFileName = `${baseFileName}_${titleNumber}.mp4`;
            }
            
            const oldPath = path.join(options.outputDir, oldFile);
            const newPath = path.join(options.outputDir, newFileName);
            
            if (oldFile === newFileName) {
                console.log(`  ⏭  ${oldFile} (unchanged)`);
                log(`File unchanged: ${oldFile}`);
            } else if (fs.existsSync(newPath) && oldPath !== newPath) {
                console.log(`  ⚠️  ${oldFile}`);
                console.log(`    → ${newFileName} (target exists, skipping to prevent overwrite)`);
                log(`Skipped rename ${oldFile} -> ${newFileName}: target file already exists`);
            } else {
                try {
                    fs.renameSync(oldPath, newPath);
                    console.log(`  ✓ ${oldFile}`);
                    console.log(`    → ${newFileName}`);
                    log(`Renamed: ${oldFile} -> ${newFileName}`);
                    renameCount++;
                } catch (error) {
                    console.log(`  ❌ Failed to rename ${oldFile}: ${error.message}`);
                    log(`Error renaming ${oldFile}: ${error.message}`);
                }
            }
        }
        
        console.log('');
        console.log('━'.repeat(60));
        if (renameCount > 0) {
            console.log(`  ⚡ Renamed ${renameCount} file(s) successfully!`);
        } else {
            console.log(`  ℹ️  No files needed renaming`);
        }
        console.log('━'.repeat(60));
        
        if (logFilePath) {
            const relativeLogPath = path.relative(process.cwd(), logFilePath);
            console.log(`  📄 Log: ${relativeLogPath}`);
        }
        console.log('');
        
        closeLog();
    } catch (error) {
        console.error(`\n❌ Error during renaming: ${error}\n`);
        if (logStream) {
            log(`Fatal error: ${error}`);
            closeLog();
        }
    }
}

async function ripAllTracks() {
    let logFilePath = null;
    let successCount = 0;
    
    try {
        const volumeName = getVolumeName(); // Get the DVD volume name
        
        // Set default output directory before any operations
        setDefaultOutputDir(volumeName);
        
        printBanner(volumeName); // Show the banner

        const numTitles = await getNumberOfTitles(); // Get the number of titles

        if (numTitles === 0) {
            console.log('❌ No titles found on disc. Exiting.\n');
            log('No titles found on disc');
            return;
        }
        
        // Lookup metadata unless disabled
        let metadata = null;
        if (!options.noLookup) {
            metadata = await lookupMetadata(volumeName, numTitles);
        } else {
            metadata = { type: 'disc', volumeName };
        }
        
        // If scan-only mode, display metadata and exit
        if (options.scanOnly) {
            console.log('\n' + '━'.repeat(60));
            console.log('  📋 Metadata Summary');
            console.log('━'.repeat(60));
            if (metadata.type === 'tv') {
                console.log(`  Type:    TV Show`);
                console.log(`  Title:   ${metadata.name}`);
                console.log(`  Season:  ${metadata.season}`);
                if (metadata.episodes) {
                    console.log(`  Episodes: ${metadata.episodes.length}`);
                    console.log('');
                    console.log('  Episode List:');
                    metadata.episodes.forEach((ep, i) => {
                        console.log(`    ${i + 1}. S${String(metadata.season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')} - ${ep.name} (${ep.runtime} min)`);
                    });
                }
            } else if (metadata.type === 'movie') {
                console.log(`  Type:  Movie`);
                console.log(`  Title: ${metadata.name}`);
                if (metadata.year) {
                    console.log(`  Year:  ${metadata.year}`);
                }
            } else {
                console.log(`  Type:  Using disc name`);
                console.log(`  Title: ${metadata.volumeName || volumeName}`);
            }
            console.log('━'.repeat(60));
            console.log('');
            console.log('✅ Scan complete. Run without --scan-only to start ripping.');
            console.log('');
            return;
        }
        
        logFilePath = initializeLog(options.outputDir, volumeName); // Initialize the log
        
        // Log DVD track durations if available
        if (global.dvdTitleDurations) {
            log('DVD Track Durations:');
            Object.entries(global.dvdTitleDurations).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([track, duration]) => {
                log(`  Track ${track}: ${duration} minutes`);
            });
        }
        
        log(`Metadata: ${JSON.stringify(metadata)}`);
        
        // Determine base file name based on metadata
        let baseFileName = volumeName;
        if (metadata.type === 'tv') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'movie') {
            const year = metadata.year ? `_${metadata.year}` : '';
            baseFileName = `${metadata.name}${year}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (metadata.type === 'custom') {
            baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        }

        for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
            let outputFileName;
            
            // Get track duration for categorization
            const trackDuration = global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : null;
            const category = trackDuration ? categorizeTrack(trackDuration) : null;
            
            // Generate filename based on metadata type
            if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[titleNumber - 1]) {
                const episode = metadata.episodes[titleNumber - 1];
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(episode.episode_number).padStart(2, '0');
                const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
                outputFileName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}`;
            } else if (metadata.type === 'tv') {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(titleNumber).padStart(2, '0');
                outputFileName = `${baseFileName}_S${seasonNum}E${episodeNum}`;
            } else if (metadata.type === 'movie') {
                // For movies, use category labels
                if (category && category !== 'episode') {
                    outputFileName = numTitles === 1 ? baseFileName : `${baseFileName}_${titleNumber}_${category}`;
                } else {
                    outputFileName = numTitles === 1 ? baseFileName : `${baseFileName}_${titleNumber}`;
                }
            } else {
                // For disc name fallback, always include category
                if (numTitles === 1) {
                    outputFileName = baseFileName;
                } else if (category) {
                    outputFileName = `${baseFileName}_${titleNumber}_${category}`;
                } else {
                    outputFileName = `${baseFileName}_${titleNumber}`;
                }
            }

            console.log(`  ⚙️  Track ${titleNumber} of ${numTitles}: ${outputFileName}`);

            try {
                await ripDvd(titleNumber, outputFileName, titleNumber, numTitles, (progress, elapsed, remaining, trackNum, totalTracks) => {
                    // Overwrite the same line for progress updates
                    const progressBar = createProgressBar(progress);
                    const elapsedStr = formatTime(elapsed);
                    const remainingStr = remaining > 0 ? formatTime(remaining) : 'calculating...';
                    process.stdout.write(`\r      ${progressBar} | ${elapsedStr} elapsed | ~${remainingStr} remaining`);
                });

                // Move to the next line and show completion
                console.log(`\r      ${createProgressBar(100)} | Complete!`);
                const relativePath = path.relative(process.cwd(), path.join(options.outputDir, `${outputFileName}.mp4`));
                console.log(`      ✓ Saved to ${relativePath}`);
                console.log('');
                successCount++;
            } catch (error) {
                // Clear the progress line
                process.stdout.write('\r' + ' '.repeat(100) + '\r');
                
                // Determine skip reason from error output
                let skipReason = 'Unknown error';
                if (error.errorOutput) {
                    if (error.errorOutput.includes('No title found')) {
                        skipReason = 'No valid title found';
                    } else if (error.errorOutput.includes('scan: unrecognized file type')) {
                        skipReason = 'Unrecognized or corrupted track';
                    } else {
                        skipReason = `HandBrakeCLI error (exit code ${error.code})`;
                    }
                }
                
                console.log(`      ⏭  Skipped (${skipReason})`);
                console.log('');
                skippedTracks.push({ track: titleNumber, reason: skipReason });
                log(`Skipped track ${titleNumber}: ${skipReason}`);
            }
        }

        console.log('━'.repeat(60));
        if (successCount === numTitles) {
            console.log('  ⚡ All tracks ripped successfully!');
        } else if (successCount > 0) {
            console.log(`  ⚡ Ripping complete: ${successCount} of ${numTitles} tracks successful`);
            if (skippedTracks.length > 0) {
                console.log('');
                console.log(`  ℹ️  Skipped ${skippedTracks.length} track(s):`);
                skippedTracks.forEach(({ track, reason }) => {
                    console.log(`     • Track ${track}: ${reason}`);
                });
            }
        } else {
            console.log('  ✗ No tracks were successfully ripped');
        }
        console.log('━'.repeat(60));
        
        if (logFilePath) {
            const relativeLogPath = path.relative(process.cwd(), logFilePath);
            console.log(`  📄 Log: ${relativeLogPath}`);
        }
        console.log('');
        
        if (skippedTracks.length > 0) {
            console.log('  💡 Check the log file for detailed error information');
            console.log('');
        }
    } catch (error) {
        console.error(`\n❌ Error during ripping: ${error}\n`);
        log(`Fatal error: ${error}`);
    } finally {
        closeLog();
    }
}

// Show help function
function showHelp() {
    console.log(`
Usage:
  node juiceit.js [options]

Options:
  --help            Show this help message
  --output          Specify the output directory (default: <disc_name>_<date>)
  --dvdSource       Specify the DVD source path (e.g., /dev/disk5)
  --quality         Set the encoding quality (e.g., 20)
  --no-deinterlace  Disable deinterlacing
  --no-lookup       Skip online metadata lookup
  --rename-only     Only rename existing files using metadata (no ripping)
  --scan-only       Scan disc and show metadata without ripping
  --subtitles       Specify the subtitle track number (default: 1)
  --sub-lang        Specify the subtitle language code (default: eng)
  --verbose         Show detailed technical output

Example:
  node juiceit.js --output /path/to/output --dvdSource /dev/disk5
  node juiceit.js --verbose  # Show detailed HandBrakeCLI output
  node juiceit.js --no-lookup  # Skip metadata lookup and use disc name
  node juiceit.js --rename-only --output ./output  # Rename existing files
`);

}

// Check for dependencies before starting
checkHandBrakeCLI();
checkLibdvdcss();