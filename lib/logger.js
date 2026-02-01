/**
 * JuiceIt Logger
 *
 * A structured logging utility with support for:
 * - Log levels (debug, info, warn, error)
 * - Console output with verbosity control
 * - File logging with timestamps
 * - Colored console output
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

// Log level definitions
const LOG_LEVELS = {
    debug: { priority: 0, color: colors.gray, label: 'DEBUG' },
    info: { priority: 1, color: colors.blue, label: 'INFO' },
    warn: { priority: 2, color: colors.yellow, label: 'WARN' },
    error: { priority: 3, color: colors.red, label: 'ERROR' }
};

class Logger {
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.fileStream = null;
        this.filePath = null;
        this.consoleLevel = this.verbose ? 'debug' : 'info';
        this.fileLevel = 'debug'; // Always log everything to file
        this.prefix = options.prefix || '';
    }

    /**
     * Initialize file logging
     * @param {string} outputDir - Directory for log file
     * @param {string} identifier - Unique identifier for log file name
     * @returns {string} Path to the log file
     */
    initFileLogging(outputDir, identifier) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const logFileName = `juiceit_${identifier}_${timestamp}.log`;
        this.filePath = path.join(outputDir, logFileName);
        this.fileStream = fs.createWriteStream(this.filePath, { flags: 'a' });

        // Write header
        this._writeToFile('='.repeat(70));
        this._writeToFile(`JuiceIt DVD Ripper Log`);
        this._writeToFile(`Identifier: ${identifier}`);
        this._writeToFile(`Started: ${new Date().toISOString()}`);
        this._writeToFile(`Output Directory: ${outputDir}`);
        this._writeToFile('='.repeat(70));

        return this.filePath;
    }

    /**
     * Close file logging
     */
    close() {
        if (this.fileStream) {
            this._writeToFile('='.repeat(70));
            this._writeToFile(`Ended: ${new Date().toISOString()}`);
            this._writeToFile('='.repeat(70));
            this.fileStream.end();
            this.fileStream = null;
        }
    }

    /**
     * Set verbose mode
     * @param {boolean} verbose
     */
    setVerbose(verbose) {
        this.verbose = verbose;
        this.consoleLevel = verbose ? 'debug' : 'info';
    }

    /**
     * Internal: write to file with timestamp
     */
    _writeToFile(message) {
        if (this.fileStream) {
            const timestamp = new Date().toISOString();
            this.fileStream.write(`[${timestamp}] ${message}\n`);
        }
    }

    /**
     * Internal: log at specified level
     */
    _log(level, message, options = {}) {
        const levelConfig = LOG_LEVELS[level];
        if (!levelConfig) return;

        const timestamp = new Date().toISOString();
        const prefix = this.prefix ? `[${this.prefix}] ` : '';

        // File logging - always log debug and above
        if (this.fileStream && levelConfig.priority >= LOG_LEVELS[this.fileLevel].priority) {
            this._writeToFile(`[${levelConfig.label}] ${prefix}${message}`);
        }

        // Console logging - respect verbosity settings
        const shouldShowOnConsole =
            levelConfig.priority >= LOG_LEVELS[this.consoleLevel].priority ||
            options.forceConsole;

        if (shouldShowOnConsole && !options.fileOnly) {
            const coloredLabel = `${levelConfig.color}[${levelConfig.label}]${colors.reset}`;

            if (level === 'error') {
                console.error(`${coloredLabel} ${prefix}${message}`);
            } else if (level === 'warn') {
                console.warn(`${coloredLabel} ${prefix}${message}`);
            } else if (this.verbose || options.forceConsole) {
                // In verbose mode, show all levels with labels
                console.log(`${coloredLabel} ${prefix}${message}`);
            } else if (level === 'info' && !options.quiet) {
                // In normal mode, info messages print without labels (cleaner output)
                console.log(message);
            }
        }
    }

    /**
     * Debug level - only shown in verbose mode, always logged to file
     * Use for: internal state, API calls, detailed progress
     */
    debug(message, options = {}) {
        this._log('debug', message, options);
    }

    /**
     * Info level - shown to user, logged to file
     * Use for: progress updates, status messages
     */
    info(message, options = {}) {
        this._log('info', message, options);
    }

    /**
     * Warn level - always shown, logged to file
     * Use for: non-fatal issues, degraded functionality
     */
    warn(message, options = {}) {
        this._log('warn', message, { ...options, forceConsole: true });
    }

    /**
     * Error level - always shown, logged to file
     * Use for: failures, exceptions
     */
    error(message, options = {}) {
        this._log('error', message, { ...options, forceConsole: true });
    }

    /**
     * Log to file only (no console output)
     * Use for: detailed data dumps, API responses
     */
    fileOnly(message) {
        this._log('debug', message, { fileOnly: true });
    }

    /**
     * Log section header (for visual organization in logs)
     */
    section(title) {
        const separator = '─'.repeat(50);
        this._writeToFile('');
        this._writeToFile(separator);
        this._writeToFile(title);
        this._writeToFile(separator);
    }

    /**
     * Log structured data (JSON)
     */
    data(label, data) {
        this._writeToFile(`${label}:`);
        this._writeToFile(JSON.stringify(data, null, 2));
    }

    /**
     * Create a child logger with a prefix
     */
    child(prefix) {
        const childLogger = new Logger({
            verbose: this.verbose,
            prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix
        });
        childLogger.fileStream = this.fileStream;
        childLogger.filePath = this.filePath;
        return childLogger;
    }
}

// Singleton instance for global use
let globalLogger = null;

/**
 * Get or create the global logger instance
 */
function getLogger(options = {}) {
    if (!globalLogger) {
        globalLogger = new Logger(options);
    } else if (options.verbose !== undefined) {
        globalLogger.setVerbose(options.verbose);
    }
    return globalLogger;
}

/**
 * Create a new logger instance (for testing or isolated use)
 */
function createLogger(options = {}) {
    return new Logger(options);
}

module.exports = {
    Logger,
    getLogger,
    createLogger,
    LOG_LEVELS
};
