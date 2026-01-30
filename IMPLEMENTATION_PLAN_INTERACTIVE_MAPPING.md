# Implementation Plan: Interactive Episode Mapping

## Objective
Allow users to review and adjust episode-to-track mappings after ripping, preventing issues where tracks are incorrectly assigned (e.g., a 512KB menu file named as Episode 1).

## User Story
As a user ripping a TV series, I want to review the proposed episode names for each ripped track and reassign them if needed, so that my files are correctly named before finalization.

## Problem Statement
Current behavior:
- Episodes are named during ripping based on track order
- If track order doesn't match episode order, files get wrong names
- Example: Look Around You S01E01_Maths.mp4 is 512KB (menu), while track 3 is 229MB (real episode 1)
- No way to fix without manual file renaming

## Requirements

### Functional Requirements
1. Rip ALL tracks without skipping (even menus/extras)
2. Use generic names during ripping (track_01.mp4, track_02.mp4, etc.)
3. Store proposed episode mappings based on metadata
4. Show interactive review screen after ripping completes
5. Display: track number, file size, duration, proposed name
6. Allow user to select and reassign individual tracks
7. Provide option to re-search TMDB and re-auto-map
8. Finalize renames only when user accepts
9. Option to mark tracks as "skip" (no episode name)

### Non-Functional Requirements
- UI must be navigable with arrow keys
- File operations must be atomic (no partial renames)
- Must handle user cancellation gracefully
- Process must be reversible until confirmation
- Large file sizes must be displayed in human-readable format

## Implementation Steps

### 1. Modify Ripping Phase
**File:** juiceit.js (ripAllTracks function, lines 1053-1246)

**Changes:**
```javascript
// After metadata lookup (line 1125)
const proposedMappings = []; // Store track -> name mappings

// In ripping loop (replace lines 1138-1172)
for (let titleNumber = 1; titleNumber <= numTitles; titleNumber++) {
    // Use generic track name for ripping
    const outputFileName = `track_${String(titleNumber).padStart(2, '0')}`;
    
    // Calculate what the proposed final name would be
    let proposedName = null;
    if (metadata.type === 'tv' && metadata.episodes && metadata.episodes[titleNumber - 1]) {
        const episode = metadata.episodes[titleNumber - 1];
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(episode.episode_number).padStart(2, '0');
        const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
        proposedName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}`;
    } else if (metadata.type === 'tv') {
        const seasonNum = String(metadata.season).padStart(2, '0');
        const episodeNum = String(titleNumber).padStart(2, '0');
        proposedName = `${baseFileName}_S${seasonNum}E${episodeNum}`;
    } else {
        // For movies/other
        const trackDuration = global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : null;
        const category = trackDuration ? categorizeTrack(trackDuration) : null;
        if (category && category !== 'episode') {
            proposedName = `${baseFileName}_${titleNumber}_${category}`;
        } else {
            proposedName = `${baseFileName}_${titleNumber}`;
        }
    }
    
    // Store mapping (will populate file size after ripping)
    proposedMappings.push({
        trackNumber: titleNumber,
        filename: `${outputFileName}.mp4`,
        proposedName: proposedName,
        fileSize: null, // Will be filled after ripping
        duration: global.dvdTitleDurations ? global.dvdTitleDurations[titleNumber] : null,
        status: 'pending' // pending | skip
    });
    
    console.log(`  ⚙️  Track ${titleNumber} of ${numTitles}: ${outputFileName} → ${proposedName}`);
    
    // Rip with generic name...
}

// After ripping loop completes (before line 1215)
// Update file sizes
proposedMappings.forEach(mapping => {
    const filePath = path.join(options.outputDir, mapping.filename);
    if (fs.existsSync(filePath)) {
        mapping.fileSize = fs.statSync(filePath).size;
    }
});
```

### 2. Create Interactive Review UI
**File:** juiceit.js (new async function)

```javascript
async function reviewAndMapEpisodes(mappings, metadata, outputDir, volumeName) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  📋 Episode Mapping Review');
    console.log('━'.repeat(60));
    console.log('');
    console.log('Review the proposed episode assignments below.');
    console.log('You can reassign tracks before finalizing.');
    console.log('');
    
    let currentMappings = [...mappings];
    let continueReview = true;
    
    while (continueReview) {
        // Show current mappings table
        console.log('');
        console.log('Current Mappings:');
        console.log('─'.repeat(60));
        console.log(sprintf('%-6s %-10s %-8s %s', 'Track', 'Size', 'Duration', 'Proposed Name'));
        console.log('─'.repeat(60));
        
        currentMappings.forEach(m => {
            const sizeStr = formatFileSize(m.fileSize);
            const durationStr = m.duration ? `${m.duration}min` : 'N/A';
            const nameStr = m.status === 'skip' ? '[SKIP]' : m.proposedName;
            const warningIcon = shouldWarn(m) ? '⚠️ ' : '   ';
            console.log(sprintf('%s%-4d  %-10s %-8s %s', warningIcon, m.trackNumber, sizeStr, durationStr, nameStr));
        });
        console.log('─'.repeat(60));
        console.log('');
        
        // Show warnings summary
        const warnings = currentMappings.filter(m => shouldWarn(m));
        if (warnings.length > 0) {
            console.log(`⚠️  ${warnings.length} track(s) may need review (small size or duration mismatch)`);
            console.log('');
        }
        
        // Main menu
        const choices = [
            { name: '✏️  Edit a track mapping', value: 'edit' },
            { name: '🔍 Re-search TMDB and re-map', value: 'research' },
            { name: '✅ Accept all and finalize', value: 'accept' },
            { name: '❌ Cancel and keep generic names', value: 'cancel' }
        ];
        
        const mainPrompt = new Select({
            name: 'action',
            message: 'What would you like to do?',
            choices: choices
        });
        
        try {
            const action = await mainPrompt.run();
            
            switch (action) {
                case 'edit':
                    await editTrackMapping(currentMappings, metadata);
                    break;
                case 'research':
                    const newMetadata = await lookupMetadata(volumeName, currentMappings.length);
                    if (newMetadata) {
                        currentMappings = reAutoMap(currentMappings, newMetadata);
                        metadata = newMetadata;
                    }
                    break;
                case 'accept':
                    await finalizeRenames(currentMappings, outputDir);
                    continueReview = false;
                    break;
                case 'cancel':
                    console.log('');
                    console.log('Keeping generic track names. You can rename later with --rename-only');
                    console.log('');
                    continueReview = false;
                    break;
            }
        } catch (error) {
            console.log('');
            console.log('Review cancelled.');
            console.log('');
            continueReview = false;
        }
    }
}

// Helper to detect suspicious mappings
function shouldWarn(mapping) {
    if (mapping.status === 'skip') return false;
    if (mapping.fileSize && mapping.fileSize < 50 * 1024 * 1024) return true; // < 50MB
    if (mapping.duration && mapping.duration < 5) return true; // < 5 minutes
    return false;
}

// Format file size
function formatFileSize(bytes) {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}
```

### 3. Implement Edit Track Mapping
**File:** juiceit.js (new async function)

```javascript
async function editTrackMapping(mappings, metadata) {
    // Select which track to edit
    const trackChoices = mappings.map(m => ({
        name: `Track ${m.trackNumber}: ${m.proposedName} (${formatFileSize(m.fileSize)})`,
        value: m.trackNumber
    }));
    trackChoices.push({ name: '← Back', value: null });
    
    const trackPrompt = new Select({
        name: 'track',
        message: 'Select track to edit:',
        choices: trackChoices
    });
    
    try {
        const selectedTrack = await trackPrompt.run();
        if (selectedTrack === null) return; // Back
        
        const mapping = mappings.find(m => m.trackNumber === selectedTrack);
        
        // Build reassignment choices
        const reassignChoices = [];
        
        if (metadata.type === 'tv' && metadata.episodes) {
            metadata.episodes.forEach((ep, idx) => {
                const seasonNum = String(metadata.season).padStart(2, '0');
                const episodeNum = String(ep.episode_number).padStart(2, '0');
                reassignChoices.push({
                    name: `S${seasonNum}E${episodeNum} - ${ep.name}`,
                    value: idx
                });
            });
        }
        
        reassignChoices.push({ name: '[Mark as extra/menu - SKIP]', value: 'skip' });
        reassignChoices.push({ name: '← Back', value: null });
        
        const reassignPrompt = new Select({
            name: 'newMapping',
            message: `Reassign Track ${selectedTrack} to:`,
            choices: reassignChoices
        });
        
        const newMapping = await reassignPrompt.run();
        
        if (newMapping === null) {
            return; // Back
        } else if (newMapping === 'skip') {
            mapping.status = 'skip';
            mapping.proposedName = null;
            console.log('');
            console.log(`✓ Track ${selectedTrack} marked to skip`);
            console.log('');
        } else {
            // Reassign to selected episode
            const episode = metadata.episodes[newMapping];
            const baseFileName = metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const seasonNum = String(metadata.season).padStart(2, '0');
            const episodeNum = String(episode.episode_number).padStart(2, '0');
            const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
            mapping.proposedName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}`;
            mapping.status = 'pending';
            console.log('');
            console.log(`✓ Track ${selectedTrack} → ${mapping.proposedName}`);
            console.log('');
        }
    } catch (error) {
        // User cancelled
        return;
    }
}
```

### 4. Implement Re-Auto-Map
**File:** juiceit.js (new function)

```javascript
function reAutoMap(mappings, newMetadata) {
    const baseFileName = newMetadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    return mappings.map((mapping, idx) => {
        let newProposedName;
        
        if (newMetadata.type === 'tv' && newMetadata.episodes && newMetadata.episodes[idx]) {
            const episode = newMetadata.episodes[idx];
            const seasonNum = String(newMetadata.season).padStart(2, '0');
            const episodeNum = String(episode.episode_number).padStart(2, '0');
            const episodeName = episode.name ? `_${episode.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
            newProposedName = `${baseFileName}_S${seasonNum}E${episodeNum}${episodeName}`;
        } else if (newMetadata.type === 'tv') {
            const seasonNum = String(newMetadata.season).padStart(2, '0');
            const episodeNum = String(mapping.trackNumber).padStart(2, '0');
            newProposedName = `${baseFileName}_S${seasonNum}E${episodeNum}`;
        } else {
            newProposedName = `${baseFileName}_${mapping.trackNumber}`;
        }
        
        return {
            ...mapping,
            proposedName: newProposedName,
            status: 'pending' // Reset skip status
        };
    });
}
```

### 5. Implement Finalize Renames
**File:** juiceit.js (new async function)

```javascript
async function finalizeRenames(mappings, outputDir) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  ✨ Finalizing Renames');
    console.log('━'.repeat(60));
    console.log('');
    
    let renamedCount = 0;
    let skippedCount = 0;
    
    for (const mapping of mappings) {
        if (mapping.status === 'skip') {
            console.log(`  ⏭  Track ${mapping.trackNumber}: Skipped`);
            skippedCount++;
            continue;
        }
        
        const oldPath = path.join(outputDir, mapping.filename);
        const newPath = path.join(outputDir, `${mapping.proposedName}.mp4`);
        
        if (!fs.existsSync(oldPath)) {
            console.log(`  ⚠️  Track ${mapping.trackNumber}: File not found, skipping`);
            continue;
        }
        
        if (fs.existsSync(newPath) && oldPath !== newPath) {
            console.log(`  ⚠️  Track ${mapping.trackNumber}: Target exists, skipping`);
            continue;
        }
        
        try {
            fs.renameSync(oldPath, newPath);
            console.log(`  ✓ Track ${mapping.trackNumber}: ${mapping.proposedName}`);
            log(`Renamed: ${mapping.filename} → ${mapping.proposedName}.mp4`);
            renamedCount++;
        } catch (error) {
            console.log(`  ❌ Track ${mapping.trackNumber}: Failed - ${error.message}`);
            log(`Error renaming ${mapping.filename}: ${error.message}`);
        }
    }
    
    console.log('');
    console.log('━'.repeat(60));
    console.log(`  ⚡ Renamed ${renamedCount} file(s), skipped ${skippedCount}`);
    console.log('━'.repeat(60));
    console.log('');
}
```

### 6. Integration
**File:** juiceit.js (modify ripAllTracks)

After ripping loop completes (line ~1213), add:

```javascript
// After all ripping is done
if (successCount > 0) {
    // Update file sizes in mappings
    proposedMappings.forEach(mapping => {
        const filePath = path.join(options.outputDir, mapping.filename);
        if (fs.existsSync(filePath)) {
            mapping.fileSize = fs.statSync(filePath).size;
        }
    });
    
    // Show interactive review
    await reviewAndMapEpisodes(proposedMappings, metadata, options.outputDir, volumeName);
}
```

### 7. Add sprintf Utility
**File:** juiceit.js (add helper function)

```javascript
// Simple sprintf for table formatting
function sprintf(format, ...args) {
    let i = 0;
    return format.replace(/%(-?)(\d*)([sd])/g, (match, leftAlign, width, type) => {
        const arg = args[i++];
        let str = type === 'd' ? String(arg) : String(arg);
        const padding = width ? parseInt(width) - str.length : 0;
        if (padding > 0) {
            const pad = ' '.repeat(padding);
            str = leftAlign ? str + pad : pad + str;
        }
        return str;
    });
}
```

## Acceptance Criteria

### Must Have
- [ ] All tracks ripped with generic names (track_01.mp4, etc.)
- [ ] Proposed mappings stored with track number, size, duration, proposed name
- [ ] Interactive review screen displays after ripping
- [ ] Review screen shows: track #, file size (MB), duration (min), proposed name
- [ ] User can navigate with arrow keys
- [ ] User can select and reassign individual tracks
- [ ] User can mark tracks as "skip"
- [ ] User can re-search TMDB and re-auto-map all tracks
- [ ] "Accept All" finalizes renames
- [ ] "Cancel" keeps generic names
- [ ] Files < 50MB or < 5min duration show warning icon
- [ ] Skipped tracks not renamed
- [ ] Log file records all renames

### Should Have
- [ ] Clear table formatting with aligned columns
- [ ] File sizes in human-readable format (MB/GB)
- [ ] Warning summary showing count of suspicious tracks
- [ ] Graceful handling of Ctrl-C cancellation
- [ ] "Back" option in all submenus
- [ ] Confirmation that renames succeeded

### Nice to Have
- [ ] Auto-suggest best matches based on file size
- [ ] Swap two tracks option
- [ ] Preview mode showing before/after names
- [ ] Undo last assignment

## Testing Plan

### 1. Look Around You Test (Problem Case)
- Insert Look Around You Series 1 disc
- Run `juiceit`
- Verify all 23 tracks ripped with track_XX.mp4 names
- Review screen should show track 1 (512KB) with warning
- Reassign track 1 to "Skip"
- Reassign track 3 (229MB) to S01E01_Maths
- Accept all and verify correct renames

### 2. Normal Order Test
- Find disc where episodes are in correct track order
- Verify auto-mapping works correctly
- Accept all without edits

### 3. Re-Search Test
- Start rip with wrong metadata selection
- Use "Re-search TMDB" option
- Select correct show/season
- Verify all tracks re-mapped correctly

### 4. Cancellation Test
- Start review process
- Cancel during track selection
- Verify generic names preserved

### 5. File Already Exists Test
- Create a file with target name
- Try to finalize
- Verify skips without overwriting

## Files Modified
- juiceit.js (major refactoring of ripAllTracks, add 5+ new functions)

## Estimated Time
- Implementation: 4-6 hours
- Testing: 2 hours
- Bug fixes: 1-2 hours
- **Total: 7-10 hours**

## Dependencies
- enquirer (Select, Input) - already installed
- fs, path (built-in)

## Risks & Mitigations
- **Risk:** Complex UI state management
  - **Mitigation:** Keep mappings array as single source of truth
  
- **Risk:** User confusion about workflow
  - **Mitigation:** Clear instructions and helpful menu labels

- **Risk:** File rename failures
  - **Mitigation:** Try/catch on each rename, continue on failure

- **Risk:** Breaking existing workflow
  - **Mitigation:** Thorough testing, consider feature flag

## Future Enhancements
- Smart auto-fix based on file sizes
- Batch operations (mark multiple as skip)
- Export/import mapping configurations
- Save preferred mappings for multi-disc sets
