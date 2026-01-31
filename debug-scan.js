#!/usr/bin/env node

const { spawn } = require('child_process');

const handbrakeProcess = spawn('HandBrakeCLI', ['-i', '/dev/disk5', '--title', '0', '--scan'], {
    stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';

handbrakeProcess.stdout.on('data', function(data) {
    output += data.toString();
});

handbrakeProcess.stderr.on('data', function(data) {
    output += data.toString();
});

handbrakeProcess.on('close', (exitCode) => {
    console.log('=== PARSING DURATIONS ===\n');
    
    const titleDurations = {};
    const titleMatches = output.matchAll(/\+ title (\d+):[\s\S]*?\+ duration: (\d{2}):(\d{2}):(\d{2})/g);
    
    for (const titleMatch of titleMatches) {
        const titleNum = parseInt(titleMatch[1], 10);
        const hours = parseInt(titleMatch[2], 10);
        const mins = parseInt(titleMatch[3], 10);
        const secs = parseInt(titleMatch[4], 10);
        const totalMinutes = hours * 60 + mins + Math.round(secs / 60);
        titleDurations[titleNum] = totalMinutes;
        console.log(`Track ${titleNum}: ${totalMinutes} min`);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total tracks parsed: ${Object.keys(titleDurations).length}`);
    console.log('Durations:', JSON.stringify(titleDurations, null, 2));
});
