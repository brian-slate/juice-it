/**
 * JuiceIt Display Utilities
 *
 * Formatted console output helpers for progress bars, tables, and diagnostic output.
 * These are pure display functions with no side effects beyond console output.
 */

/**
 * Create an ASCII progress bar
 * @param {number} progress - Progress percentage (0-100)
 * @param {number} width - Width of the bar in characters (default: 20)
 * @returns {string} Formatted progress bar string like "[████████░░░░] 75.00%"
 */
function createProgressBar(progress, width = 20) {
    const percentage = Math.min(100, Math.max(0, parseFloat(progress)));
    const filledWidth = Math.round((percentage / 100) * width);
    const emptyWidth = width - filledWidth;
    const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
    return `[${bar}] ${percentage.toFixed(2)}%`;
}

/**
 * Format seconds into human-readable time
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time like "5m 30s" or "1h 23m"
 */
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

/**
 * Print the ASCII orange logo with colors (compact braille art)
 */
function printOrangeLogo() {
    // ANSI color codes
    const g = '\x1b[32m';   // green for leaf
    const o = '\x1b[38;5;208m';  // 256-color orange
    const w = '\x1b[97m';   // bright white for eyes
    const r = '\x1b[0m';    // reset

    console.log('');
    console.log(`                  ${g}⣀⣤⣤⣀${r}`);
    console.log(`                  ${g}██████⣤${r}`);
    console.log(`           ${g}⣿⣿  ⣀████${r}${o}⣿⣿⣿⣿⣿⣀${r}`);
    console.log(`           ${g}⣿███████${r}${o}⣿⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`            ${g}⣿████${r}${o}⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`        ${o}⣀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀${r}`);
    console.log(`       ${o}⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`      ${o}⣿⣿⣿⣿⣿⣿${r}  ${w}◕${r}    ${w}◕${r}  ${o}⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`      ${o}⣿⣿⣿⣿              ⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`      ${o}⣿⣿⣿⣿      ${r}‿${o}       ⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`      ${o}⣿⣿⣿⣿              ⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`      ${o}⣿⣿⣿⣿⣿⣿          ⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`       ${o}⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿${r}`);
    console.log(`        ${o}⣀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀${r}`);
    console.log(`           ${o}⣀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀${r}`);
    console.log('');
}

/**
 * Print the main application banner
 * @param {string} volumeName - DVD volume name
 * @param {string} outputDir - Output directory path
 * @param {number} quality - Encoding quality (CRF value)
 */
function printBanner(volumeName, outputDir, quality) {
    printOrangeLogo();
    console.log('━'.repeat(60));
    console.log('  🍊  Juice-It DVD Ripper');
    console.log('━'.repeat(60));
    console.log(`  Disc:    "${volumeName}"`);
    console.log(`  Output:  ${outputDir}/`);
    console.log(`  Quality: Fresh-Squeezed 1080p (CRF ${quality})`);
    console.log('━'.repeat(60));
    console.log('');
}

/**
 * Print a diagnostic section header
 * @param {string} title - Section title
 */
function printDiagnosticSection(title) {
    console.log('┌' + '─'.repeat(78) + '┐');
    console.log('│' + `  ${title}`.padEnd(78) + '│');
    console.log('└' + '─'.repeat(78) + '┘');
    console.log('');
}

/**
 * Print text with indentation (for multi-line prompts/responses)
 * @param {string} text - Text to print
 * @param {string} indent - Indentation prefix (default: '  ')
 */
function printIndentedText(text, indent = '  ') {
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach(line => {
        console.log(indent + line);
    });
}

/**
 * Print track analysis table (just facts - no analysis)
 * @param {number} numTitles - Total number of titles
 * @param {Object} trackDurations - Map of track numbers to durations
 */
function printTrackAnalysisTable(numTitles, trackDurations) {
    console.log('  ┌─────────┬──────────┐');
    console.log('  │  Track  │ Duration │');
    console.log('  ├─────────┼──────────┤');

    for (let i = 1; i <= numTitles; i++) {
        const duration = trackDurations[i] || 0;
        const trackStr = String(i).padStart(4);
        const durationStr = duration > 0 ? `${duration} min`.padStart(6) : '  —   ';
        console.log(`  │  ${trackStr}   │ ${durationStr}  │`);
    }
    console.log('  └─────────┴──────────┘');
    console.log('');
}

/**
 * Print episode table from TMDB data
 * @param {Array} episodes - Array of episode objects with episode_number, runtime, name
 */
function printEpisodeTable(episodes) {
    console.log('  Episode List:');
    console.log('  ┌─────┬─────────┬─────────────────────────────────────────────────┐');
    console.log('  │ Ep# │ Runtime │ Title                                           │');
    console.log('  ├─────┼─────────┼─────────────────────────────────────────────────┤');
    episodes.forEach(ep => {
        const epNum = String(ep.episode_number).padStart(2);
        const runtime = ep.runtime ? `${ep.runtime} min`.padStart(6) : '  ? min';
        const title = (ep.name || 'Unknown').substring(0, 47).padEnd(47);
        console.log(`  │  ${epNum} │ ${runtime} │ ${title} │`);
    });
    console.log('  └─────┴─────────┴─────────────────────────────────────────────────┘');
    console.log('');
}

/**
 * Print detailed mapping results table
 * @param {Array} mappings - Array of mapping objects from AI
 * @param {Array} episodes - Array of episode objects from TMDB
 */
function printMappingResultsTable(mappings, episodes) {
    console.log('  Detailed Mapping Table:');
    console.log('  ┌───────┬──────────┬────────┬─────────────────┬──────┬────────────────────────────────┐');
    console.log('  │ Track │ Duration │ Action │ Episode         │ Conf │ Reasoning                      │');
    console.log('  ├───────┼──────────┼────────┼─────────────────┼──────┼────────────────────────────────┤');

    for (const m of mappings) {
        const trackStr = String(m.trackNum).padStart(4);
        const durationStr = `${m.trackDuration} min`.padStart(6);

        let action, episode;
        if (m.shouldSkip) {
            action = '⏭ SKIP';
            episode = '—'.padEnd(15);
        } else {
            action = '✓ MAP ';
            const epIndex = m.episodeIndex;
            const epName = episodes[epIndex]?.name || 'Unknown';
            episode = `E${epIndex + 1}: ${epName}`.substring(0, 15).padEnd(15);
        }

        const conf = `${(m.confidence * 100).toFixed(0)}%`.padStart(4);
        const reason = (m.reasoning || '').substring(0, 30).padEnd(30);

        console.log(`  │ ${trackStr}  │ ${durationStr}  │ ${action} │ ${episode} │ ${conf} │ ${reason} │`);
    }
    console.log('  └───────┴──────────┴────────┴─────────────────┴──────┴────────────────────────────────┘');
    console.log('');
}

/**
 * Print a simple separator line
 * @param {number} width - Width of separator (default: 60)
 * @param {string} char - Character to use (default: '━')
 */
function printSeparator(width = 60, char = '━') {
    console.log(char.repeat(width));
}

/**
 * Print a boxed message
 * @param {string} message - Message to display
 * @param {number} width - Box width (default: 60)
 */
function printBox(message, width = 60) {
    console.log('┌' + '─'.repeat(width - 2) + '┐');
    console.log('│' + `  ${message}`.padEnd(width - 2) + '│');
    console.log('└' + '─'.repeat(width - 2) + '┘');
}

module.exports = {
    createProgressBar,
    formatTime,
    printOrangeLogo,
    printBanner,
    printDiagnosticSection,
    printIndentedText,
    printTrackAnalysisTable,
    printEpisodeTable,
    printMappingResultsTable,
    printSeparator,
    printBox
};
