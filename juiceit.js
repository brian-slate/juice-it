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

// Centralized argument processing
const args = process.argv.slice(2);
const options = {
    outputDir: process.cwd(), // Default to current process location
    dvdSource: null, // Initialize dvdSource
    encoding: {
        encoder: 'x264', // Default encoder
        quality: '20',    // Default quality
        deinterlace: true, // Default to enabled
    },
    subtitles: {
        track: 1, // Default to the first subtitle track
        language: 'eng' // Default to English
    }
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
    }
});

// Ensure the output directory exists
if (!fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
}

// Define the cache file path as a hidden file
const cacheFilePath = path.join(options.outputDir, '.dvd_cache.json');
console.log(`Cache file path: ${cacheFilePath}`); // Log the cache file path

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
function ripDvd(titleNumber, outputFileName, onProgress) {
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
        console.log(`⚙️ Running HandBrakeCLI with command: HandBrakeCLI ${args.join(' ')}`);

        const handbrakeProcess = spawn('HandBrakeCLI', args);

        handbrakeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            const progressMatch = output.match(/Encoding:.* (\d{1,3}\.\d{1,2}) %/);
            if (progressMatch && progressMatch[1]) {
                const progress = progressMatch[1];
                onProgress(progress);
            }
        });

        handbrakeProcess.stderr.on('data', (data) => {
            console.log(`\n[handbrake-info]: ${data}`);
        });

        handbrakeProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(`HandBrakeCLI process exited with code ${code}`);
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
    console.log('Fetching disc title information...');
    const volumeName = getVolumeName(); // Get the current volume name
    console.log(`Current Volume Name: ${volumeName}`);

    // Check if cache exists
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath));
        console.log(`Cached Volume Name: ${cacheData.volumeName}`);
        
        // Log the comparison result
        console.log(`Comparing cached volume name "${cacheData.volumeName}" with current volume name "${volumeName}"`);
        
        if (cacheData.volumeName === volumeName) {
            console.log(`Using cached title information: ${cacheData.numTitles} titles found.`);
            return cacheData.numTitles;
        } else {
            console.log("Volume names do not match. Cache will be ignored.");
        }
    } else {
        console.log("Cache does not exist. Fetching title information from the disc.");
    }

    // Fetch title information if cache is not valid
    return new Promise((resolve, reject) => {
        const args = ['-i', options.dvdSource, '--title', '0', '--scan'];

        const handbrakeProcess = pty.spawn('HandBrakeCLI', args, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: process.env.HOME,
            env: process.env
        });

        let output = '';

        handbrakeProcess.on('data', function(data) {
            console.log(data);
            output += data;
        });

        handbrakeProcess.on('exit', (exitCode) => {
            if (exitCode === 0) {
                const match = output.match(/scan: DVD has (\d+) title/);
                if (match) {
                    const numTitles = parseInt(match[1], 10);
                    console.log(`Number of titles: ${numTitles}`);
                    
                    // Cache the title information with volume name
                    fs.writeFileSync(cacheFilePath, JSON.stringify({ volumeName, numTitles }));
                    console.log(`Cache created with Volume Name: ${volumeName} and Number of Titles: ${numTitles}`);
                    resolve(numTitles);
                } else {
                    console.log("No titles found.");
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
        console.log("Cache cleared due to volume name change.");
    }
}

async function ripAllTracks() {
    try {
        const numTitles = await getNumberOfTitles(); // Get the number of titles

        for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
            const outputFileName = `Track_${titleNumber}`;
            console.log(`Ripping ${outputFileName}...`);
            await ripDvd(titleNumber, outputFileName, (progress) => {
                // Overwrite the same line for progress updates
                process.stdout.write(`\rProgress: ${progress}%`);
            });
            // Move to the next line after each track is done
            console.log(); // This will create a new line after each track is completed
        }
        console.log('⚡️ Ripping Complete');
    } catch (error) {
        console.error(`Error during ripping: ${error}`);
    }
}

// Start the ripping process
console.log("Starting juiceit.js");
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

Example:
  node juiceit.js --output /path/to/output --dvdSource /dev/disk5
`);

}

// Check for dependencies before starting
checkHandBrakeCLI();
checkLibdvdcss();