/**
 * JuiceIt UI Output Utility
 *
 * Centralized user-facing output with consistent styling.
 * Separates UI concerns from logging/debugging.
 *
 * Features:
 * - Consistent formatting and colors
 * - Terminal detection (disables colors when piped)
 * - Quiet mode support
 * - JSON output mode for scripting
 * - Progress indicators and spinners
 */

// Check if output is a TTY (interactive terminal)
const isTTY = process.stdout.isTTY;

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

// Emoji/symbols with fallbacks for non-Unicode terminals
const symbols = {
    success: '✓',
    error: '✗',
    warning: '⚠️',
    info: 'ℹ️',
    arrow: '→',
    bullet: '•',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
};

class UI {
    constructor(options = {}) {
        this.quiet = options.quiet || false;
        this.jsonMode = options.json || false;
        this.noColor = options.noColor || !isTTY;
        this.indent = 0;
        this._spinnerInterval = null;
        this._spinnerFrame = 0;
    }

    /**
     * Apply color if colors are enabled
     */
    _color(colorName, text) {
        if (this.noColor) return text;
        return `${colors[colorName]}${text}${colors.reset}`;
    }

    /**
     * Get current indent string
     */
    _getIndent() {
        return '  '.repeat(this.indent);
    }

    /**
     * Core output method - respects quiet mode
     */
    _write(message, { force = false, newline = true } = {}) {
        if (this.quiet && !force) return;
        if (this.jsonMode) return; // In JSON mode, suppress normal output

        if (newline) {
            console.log(message);
        } else {
            process.stdout.write(message);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Basic Output Methods
    // ─────────────────────────────────────────────────────────────

    /**
     * Print a blank line
     */
    blank() {
        this._write('');
    }

    /**
     * Print plain text
     */
    text(message) {
        this._write(`${this._getIndent()}${message}`);
    }

    /**
     * Print dimmed/subtle text
     */
    dim(message) {
        this._write(`${this._getIndent()}${this._color('dim', message)}`);
    }

    /**
     * Print bold text
     */
    bold(message) {
        this._write(`${this._getIndent()}${this._color('bold', message)}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Status Messages
    // ─────────────────────────────────────────────────────────────

    /**
     * Success message (green checkmark)
     */
    success(message) {
        this._write(`${this._getIndent()}${this._color('green', symbols.success)} ${message}`);
    }

    /**
     * Error message (red X) - always shown even in quiet mode
     */
    error(message) {
        this._write(`${this._getIndent()}${this._color('red', symbols.error)} ${message}`, { force: true });
    }

    /**
     * Warning message (yellow)
     */
    warn(message) {
        this._write(`${this._getIndent()}${this._color('yellow', `${symbols.warning}  ${message}`)}`);
    }

    /**
     * Info message (blue)
     */
    info(message) {
        this._write(`${this._getIndent()}${this._color('blue', `${symbols.info}  ${message}`)}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Formatting Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Print a horizontal rule/separator
     */
    separator(char = '─', length = 60) {
        this._write(char.repeat(length));
    }

    /**
     * Print a section header with box drawing
     */
    section(title) {
        this.blank();
        this._write(`┌${'─'.repeat(title.length + 4)}┐`);
        this._write(`│  ${this._color('bold', title)}  │`);
        this._write(`└${'─'.repeat(title.length + 4)}┘`);
        this.blank();
    }

    /**
     * Print a banner (for app header)
     */
    banner(lines) {
        this._write('╔' + '═'.repeat(78) + '╗');
        lines.forEach(line => {
            const padded = line.padEnd(76);
            this._write(`║  ${padded}  ║`);
        });
        this._write('╚' + '═'.repeat(78) + '╝');
    }

    /**
     * Print a bulleted list
     */
    list(items, bullet = symbols.bullet) {
        items.forEach(item => {
            this._write(`${this._getIndent()}  ${bullet} ${item}`);
        });
    }

    /**
     * Print a key-value pair
     */
    keyValue(key, value, keyWidth = 15) {
        const paddedKey = key.padEnd(keyWidth);
        this._write(`${this._getIndent()}${this._color('dim', paddedKey)} ${value}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Progress Indicators
    // ─────────────────────────────────────────────────────────────

    /**
     * Start a spinner with message
     */
    startSpinner(message) {
        if (!isTTY || this.quiet) {
            this._write(`${message}...`);
            return;
        }

        this._spinnerMessage = message;
        this._spinnerFrame = 0;

        this._spinnerInterval = setInterval(() => {
            const frame = symbols.spinner[this._spinnerFrame % symbols.spinner.length];
            process.stdout.write(`\r${this._getIndent()}${frame} ${this._spinnerMessage}`);
            this._spinnerFrame++;
        }, 80);
    }

    /**
     * Stop spinner with final status
     */
    stopSpinner(finalMessage, status = 'success') {
        if (this._spinnerInterval) {
            clearInterval(this._spinnerInterval);
            this._spinnerInterval = null;
        }

        if (!isTTY || this.quiet) return;

        const symbol = status === 'success'
            ? this._color('green', symbols.success)
            : this._color('red', symbols.error);

        process.stdout.write(`\r${this._getIndent()}${symbol} ${finalMessage}\n`);
    }

    /**
     * Update spinner message
     */
    updateSpinner(message) {
        this._spinnerMessage = message;
    }

    /**
     * Print a progress bar
     */
    progressBar(current, total, width = 30, label = '') {
        if (!isTTY) return;

        const percent = Math.round((current / total) * 100);
        const filled = Math.round((current / total) * width);
        const empty = width - filled;

        const bar = this._color('green', '█'.repeat(filled)) + this._color('dim', '░'.repeat(empty));
        const percentStr = `${percent}%`.padStart(4);

        process.stdout.write(`\r${this._getIndent()}${bar} ${percentStr} ${label}`);

        if (current >= total) {
            process.stdout.write('\n');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Indentation Control
    // ─────────────────────────────────────────────────────────────

    /**
     * Increase indent level
     */
    push() {
        this.indent++;
        return this;
    }

    /**
     * Decrease indent level
     */
    pop() {
        this.indent = Math.max(0, this.indent - 1);
        return this;
    }

    /**
     * Reset indent to 0
     */
    resetIndent() {
        this.indent = 0;
        return this;
    }

    // ─────────────────────────────────────────────────────────────
    // JSON Output Mode
    // ─────────────────────────────────────────────────────────────

    /**
     * Output JSON (for scripting/piping)
     */
    json(data) {
        console.log(JSON.stringify(data, null, 2));
    }

    /**
     * Output compact JSON (single line)
     */
    jsonCompact(data) {
        console.log(JSON.stringify(data));
    }

    // ─────────────────────────────────────────────────────────────
    // Mode Setters
    // ─────────────────────────────────────────────────────────────

    setQuiet(quiet) {
        this.quiet = quiet;
        return this;
    }

    setJsonMode(jsonMode) {
        this.jsonMode = jsonMode;
        return this;
    }

    setNoColor(noColor) {
        this.noColor = noColor;
        return this;
    }
}

// Singleton instance
let globalUI = null;

function getUI(options = {}) {
    if (!globalUI) {
        globalUI = new UI(options);
    }
    return globalUI;
}

function createUI(options = {}) {
    return new UI(options);
}

module.exports = {
    UI,
    getUI,
    createUI,
    colors,
    symbols,
    isTTY
};
