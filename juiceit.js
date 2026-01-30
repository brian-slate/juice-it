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
    console.log(`  Output:  ${path.basename(options.outputDir)}/`);
    console.log(`  Quality: HQ 1080p30 (CRF ${options.encoding.quality})`);
    console.log('━'.repeat(60));
    console.log('');
}

// Centralized argument processing
const args = process.argv.slice(2);
const options = {
    outputDir: path.join(process.cwd(), 'output'), // Default to 'output' subdirectory
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
    }
});

// Ensure the output directory exists
if (!fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
}

// Define the cache file path as a hidden file
const cacheFilePath = path.join(options.outputDir, '.dvd_cache.json');
if (options.verbose) {
    console.log(`Cache file path: ${cacheFilePath}`);
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

// Function to detect the DVD source automatically
function detectDvdSource() {
    try {
        const output = execSync('drutil status').toString();
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes('Type: DVD-ROM')) { // Check for DVD-ROM type
                const parts = line.trim().split(/\s+/);
                const diskIdentifier = parts[parts.length - 1]; // Extract the last part which is the device identifier
                return diskIdentifier; // e.g., /dev/disk5
            }
        }
    } catch (error) {
        console.error("Error detecting DVD source:", error);
    }
    return null; // Return null if no DVD source is found
}

// Set dvdSource if not provided
if (!options.dvdSource) {
    options.dvdSource = detectDvdSource(); // Automatically detect DVD source
}

// Fallback if no DVD source is detected
if (!options.dvdSource) {
    console.error("No DVD source detected. Please provide a valid DVD source using --dvdSource.");
    process.exit(1);
}

// Show help if requested
if (options.showHelp || args.length === 0) {
    showHelp();
    process.exit(0);
}

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

// Get number of titles with caching
async function getNumberOfTitles() {
    process.stdout.write('🔍 Scanning disc...');
    const volumeName = getVolumeName(); // Get the current volume name

    if (options.verbose) {
        console.log(`\nCurrent Volume Name: ${volumeName}`);
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

                    // Cache the title information with volume name
                    fs.writeFileSync(cacheFilePath, JSON.stringify({ volumeName, numTitles }));
                    if (options.verbose) {
                        console.log(`Cache created with Volume Name: ${volumeName} and Number of Titles: ${numTitles}`);
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

// Clear cache if the volume name changes
if (fs.existsSync(cacheFilePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));
    const currentVolumeName = getVolumeName();
    if (cacheData.volumeName !== currentVolumeName) {
        fs.unlinkSync(cacheFilePath); // Clear the cache
        if (options.verbose) {
            console.log("Cache cleared due to volume name change.");
        }
    }
}

async function ripAllTracks() {
    let logFilePath = null;
    let successCount = 0;
    
    try {
        const volumeName = getVolumeName(); // Get the DVD volume name
        printBanner(volumeName); // Show the banner
        
        logFilePath = initializeLog(options.outputDir, volumeName); // Initialize the log

        const numTitles = await getNumberOfTitles(); // Get the number of titles
        const baseFileName = volumeName || 'Track'; // Use volume name or fallback to 'Track'

        if (numTitles === 0) {
            console.log('❌ No titles found on disc. Exiting.\n');
            log('No titles found on disc');
            return;
        }

        for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
            // If there's only one title, use just the volume name; otherwise append title number
            const outputFileName = numTitles === 1 ? baseFileName : `${baseFileName}_${titleNumber}`;

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
                console.log(`      ✓ Saved to output/${outputFileName}.mp4`);
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
            console.log(`  📄 Log: output/${path.basename(logFilePath)}`);
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

// Start the ripping process
ripAllTracks();

// Show help function
function showHelp() {
    console.log(`
Usage:
  node juiceit.js [options]

Options:
  --help        Show this help message
  --output      Specify the output directory
  --dvdSource   Specify the DVD source path (e.g., /dev/disk5)
  --quality     Set the encoding quality (e.g., 20)
  --no-deinterlace  Disable deinterlacing
  --subtitles   Specify the subtitle track number (default: 1)
  --sub-lang    Specify the subtitle language code (default: eng)
  --verbose     Show detailed technical output

Example:
  node juiceit.js --output /path/to/output --dvdSource /dev/disk5
  node juiceit.js --verbose  # Show detailed HandBrakeCLI output
`);

}

// Check for dependencies before starting
checkHandBrakeCLI();
checkLibdvdcss();