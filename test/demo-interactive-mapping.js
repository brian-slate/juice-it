#!/usr/bin/env node

/**
 * Interactive Mapping Demo
 * 
 * This script demonstrates the interactive episode mapping feature
 * using mock MP4 files. It simulates the "Look Around You" scenario
 * where track 1 is a small menu file that needs to be reassigned.
 */

const fs = require('fs');
const path = require('path');

// Import the functions we need to test (we'll need to require juiceit.js functions)
// For now, we'll inline the key functions to make this standalone

const { Select } = require('enquirer');

// Mock output directory
const DEMO_DIR = path.join(__dirname, 'demo-output');

// Helper functions (copied from juiceit.js for standalone demo)
function formatFileSize(bytes) {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function shouldWarn(fileSize, duration) {
    const MB = 1024 * 1024;
    return fileSize < 50 * MB || duration < 5;
}

function sprintf(format, ...args) {
    let i = 0;
    return format.replace(/%0?(\d*)d/g, (match, width) => {
        const num = args[i++];
        return width ? String(num).padStart(parseInt(width), '0') : String(num);
    });
}

// Create mock MP4 files
function createMockMP4(outputPath, sizeInMB, _durationInSeconds) {
    const sizeInBytes = sizeInMB * 1024 * 1024;
    const buffer = Buffer.alloc(sizeInBytes, 0);
    
    // Write minimal MP4 header
    buffer.write('ftyp', 4);
    buffer.writeUInt32BE(20, 0);
    buffer.write('isom', 8);
    
    fs.writeFileSync(outputPath, buffer);
}

// Setup demo environment
function setupDemo() {
    console.log('\n🎬 Interactive Mapping Demo Setup\n');
    
    // Clean and create demo directory
    if (fs.existsSync(DEMO_DIR)) {
        fs.rmSync(DEMO_DIR, { recursive: true });
    }
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    
    // Create mock files simulating "Look Around You" disc
    console.log('Creating mock DVD tracks...\n');
    
    const mockTracks = [
        { num: 1, size: 0.5, duration: 1, desc: 'Menu (problematic - assigned to Episode 1)' },
        { num: 2, size: 118, duration: 11, desc: 'Episode 1 Commentary' },
        { num: 3, size: 229, duration: 10, desc: 'Episode 1 (real episode)' },
        { num: 4, size: 118, duration: 11, desc: 'Episode 2 Commentary' },
        { num: 5, size: 230, duration: 10, desc: 'Episode 2' },
    ];
    
    mockTracks.forEach(track => {
        const filename = sprintf('track_%02d.mp4', track.num);
        const filepath = path.join(DEMO_DIR, filename);
        createMockMP4(filepath, track.size, track.duration);
        console.log(`  ✓ ${filename} (${track.size}MB) - ${track.desc}`);
    });
    
    console.log('\n✓ Demo files created in:', DEMO_DIR);
    console.log('');
}

// Simulate the proposed mappings
function createProposedMappings() {
    return [
        {
            trackNum: 1,
            filename: 'track_01.mp4',
            proposedName: 'Look_Around_You_S01E01_Maths.mp4',
            fileSize: 0.5 * 1024 * 1024,
            duration: 1,
            status: 'rename'
        },
        {
            trackNum: 2,
            filename: 'track_02.mp4',
            proposedName: 'Look_Around_You_S01E01_Maths_Commentary.mp4',
            fileSize: 118 * 1024 * 1024,
            duration: 11,
            status: 'rename'
        },
        {
            trackNum: 3,
            filename: 'track_03.mp4',
            proposedName: 'Look_Around_You_S01E02_Water.mp4',
            fileSize: 229 * 1024 * 1024,
            duration: 10,
            status: 'rename'
        },
        {
            trackNum: 4,
            filename: 'track_04.mp4',
            proposedName: 'Look_Around_You_S01E02_Water_Commentary.mp4',
            fileSize: 118 * 1024 * 1024,
            duration: 11,
            status: 'rename'
        },
        {
            trackNum: 5,
            filename: 'track_05.mp4',
            proposedName: 'Look_Around_You_S01E03_Germs.mp4',
            fileSize: 230 * 1024 * 1024,
            duration: 10,
            status: 'rename'
        }
    ];
}

// Mock metadata
const metadata = {
    type: 'tv',
    name: 'Look Around You',
    season: 1,
    episodes: [
        { episode_number: 1, name: 'Maths', runtime: 10 },
        { episode_number: 2, name: 'Water', runtime: 10 },
        { episode_number: 3, name: 'Germs', runtime: 10 },
        { episode_number: 4, name: 'Ghosts', runtime: 10 },
        { episode_number: 5, name: 'Sulphur', runtime: 10 }
    ]
};

// Interactive review function (simplified version)
async function reviewAndMapEpisodes(proposedMappings, metadata) {
    console.log('\n' + '━'.repeat(60));
    console.log('  📋 Review Track Mappings');
    console.log('━'.repeat(60));
    console.log('');
    
    let continueReview = true;
    
    while (continueReview) {
        // Display track table
        console.log('  Track  Size       Duration  Status  Proposed Name');
        console.log('  -----  ---------  --------  ------  ' + '-'.repeat(40));
        
        for (const mapping of proposedMappings) {
            const trackStr = String(mapping.trackNum).padStart(2);
            const sizeStr = formatFileSize(mapping.fileSize).padEnd(9);
            const durationStr = `${mapping.duration} min`.padEnd(8);
            const statusIcon = mapping.status === 'skip' ? '⏭' : (shouldWarn(mapping.fileSize, mapping.duration) ? '⚠️' : '✓');
            const proposedName = mapping.status === 'skip' ? '(will not rename)' : mapping.proposedName;
            console.log(`  ${trackStr}     ${sizeStr}  ${durationStr}  ${statusIcon}     ${proposedName}`);
        }
        
        console.log('');
        
        // Show warnings
        const warnings = proposedMappings.filter(m => m.status !== 'skip' && shouldWarn(m.fileSize, m.duration));
        if (warnings.length > 0) {
            console.log(`⚠️  ${warnings.length} track(s) may need review (small size or short duration)`);
            console.log('');
        }
        
        // Main menu
        const mainMenu = new Select({
            message: 'What would you like to do?',
            choices: [
                'Edit Track Mapping',
                'Accept All and Finalize',
                'Cancel (keep generic track names)'
            ]
        });
        
        try {
            const choice = await mainMenu.run();
            
            if (choice === 'Edit Track Mapping') {
                await editTrackMapping(proposedMappings, metadata);
            } else if (choice === 'Accept All and Finalize') {
                await finalizeRenames(proposedMappings);
                continueReview = false;
            } else {
                console.log('\n  ✓ Keeping generic track names\n');
                continueReview = false;
            }
        } catch (err) {
            console.log('\n  ✓ Operation cancelled\n');
            continueReview = false;
        }
    }
}

// Edit track mapping
async function editTrackMapping(proposedMappings, metadata) {
    // Select track
    const trackChoices = proposedMappings.map(m => {
        const warn = shouldWarn(m.fileSize, m.duration) ? '⚠️ ' : '';
        const skip = m.status === 'skip' ? '(SKIP) ' : '';
        return {
            name: `${warn}${skip}Track ${m.trackNum}: ${m.proposedName || m.filename} (${formatFileSize(m.fileSize)}, ${m.duration}min)`,
            value: m.trackNum
        };
    });
    
    trackChoices.push({ name: '← Back', value: null });
    
    const trackSelector = new Select({
        message: 'Select track to edit:',
        choices: trackChoices
    });
    
    try {
        const selectedTrack = await trackSelector.run();
        if (selectedTrack === null) return;
        
        const mapping = proposedMappings.find(m => m.trackNum === selectedTrack);
        
        // Build episode choices
        const episodeChoices = [];
        metadata.episodes.forEach((ep, idx) => {
            const seasonNum = String(metadata.season).padStart(2, '0');
            const episodeNum = String(ep.episode_number).padStart(2, '0');
            const episodeName = ep.name ? `_${ep.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
            const proposedName = `${metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_S${seasonNum}E${episodeNum}${episodeName}.mp4`;
            episodeChoices.push({
                name: `S${seasonNum}E${episodeNum} - ${ep.name} (${ep.runtime}min)`,
                value: { index: idx, name: proposedName }
            });
        });
        
        episodeChoices.push({ name: 'Mark as Extra/Skip', value: 'skip' });
        episodeChoices.push({ name: '← Back', value: null });
        
        const assignmentMenu = new Select({
            message: `Reassign Track ${selectedTrack} to:`,
            choices: episodeChoices
        });
        
        const assignment = await assignmentMenu.run();
        
        if (assignment === null) {
            return;
        } else if (assignment === 'skip') {
            mapping.status = 'skip';
            mapping.proposedName = null;
            console.log(`\n  ✓ Track ${selectedTrack} marked to skip\n`);
        } else {
            mapping.status = 'rename';
            mapping.proposedName = assignment.name;
            console.log(`\n  ✓ Track ${selectedTrack} reassigned to: ${assignment.name}\n`);
        }
    } catch (error) {
        return;
    }
}

// Finalize renames
async function finalizeRenames(proposedMappings) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬 Finalizing Renames');
    console.log('━'.repeat(60));
    console.log('');
    
    let renameCount = 0;
    let skipCount = 0;
    
    for (const mapping of proposedMappings) {
        if (mapping.status === 'skip') {
            console.log(`  ⏭  Track ${mapping.trackNum}: Skipped`);
            skipCount++;
            continue;
        }
        
        const oldPath = path.join(DEMO_DIR, mapping.filename);
        const newPath = path.join(DEMO_DIR, mapping.proposedName);
        
        if (!fs.existsSync(oldPath)) {
            console.log(`  ⚠️  Track ${mapping.trackNum}: File not found, skipping`);
            continue;
        }
        
        if (fs.existsSync(newPath) && oldPath !== newPath) {
            console.log(`  ⚠️  Track ${mapping.trackNum}: Target exists, skipping`);
            continue;
        }
        
        try {
            fs.renameSync(oldPath, newPath);
            console.log(`  ✓ Track ${mapping.trackNum}: ${mapping.proposedName}`);
            renameCount++;
        } catch (error) {
            console.log(`  ❌ Track ${mapping.trackNum}: Failed - ${error.message}`);
        }
    }
    
    console.log('');
    console.log('━'.repeat(60));
    console.log(`  ⚡ Renamed ${renameCount} file(s), skipped ${skipCount}`);
    console.log('━'.repeat(60));
    console.log('');
    
    // Show final files
    console.log('📁 Final files in demo directory:');
    const files = fs.readdirSync(DEMO_DIR).sort();
    files.forEach(file => {
        const stats = fs.statSync(path.join(DEMO_DIR, file));
        console.log(`   ${file} (${formatFileSize(stats.size)})`);
    });
    console.log('');
}

// Main demo
async function runDemo() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     Interactive Episode Mapping Demo - Look Around You    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    setupDemo();
    
    console.log('━'.repeat(60));
    console.log('  📋 Scenario: Look Around You Series 1');
    console.log('━'.repeat(60));
    console.log('');
    console.log('Problem: Track 1 is a 512KB menu but was auto-assigned to');
    console.log('         Episode 1 (Maths). The real Episode 1 is Track 3.');
    console.log('');
    console.log('Solution: Use interactive mapping to:');
    console.log('  1. Mark Track 1 as "Skip" (it\'s just a menu)');
    console.log('  2. Reassign Track 3 to Episode 1 (Maths)');
    console.log('');
    console.log('Press Enter to start interactive review...');
    console.log('━'.repeat(60));
    
    // Wait for user
    await new Promise(resolve => {
        process.stdin.once('data', resolve);
    });
    
    const mappings = createProposedMappings();
    await reviewAndMapEpisodes(mappings, metadata);
    
    console.log('✅ Demo complete! Check', DEMO_DIR, 'to see the results.');
    console.log('');
}

// Run if called directly
if (require.main === module) {
    runDemo().catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
}
