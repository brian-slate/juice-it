/**
 * JuiceIt Configuration Management
 *
 * Handles loading and saving of user configuration including API keys.
 * Configuration is stored in platform-specific locations:
 * - macOS: ~/.config/juice-it/config.json
 * - Windows: %APPDATA%/juice-it/config.json
 * - Linux: $XDG_CONFIG_HOME/juice-it/config.json or ~/.config/juice-it/config.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the platform-specific configuration directory path
 * @returns {string} Path to the config directory
 */
function getConfigDir() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), '.config', 'juice-it');
    } else if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'juice-it');
    } else {
        return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'juice-it');
    }
}

/**
 * Get the full path to the config file
 * @returns {string} Path to config.json
 */
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}

/**
 * Load configuration from file
 * @returns {Object} Configuration object (empty object if no config exists)
 */
function load() {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            return {};
        }
    }
    return {};
}

/**
 * Save configuration to file
 * Creates the config directory if it doesn't exist
 * @param {Object} config - Configuration object to save
 */
function save(config) {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Check if a specific config key exists and has a truthy value
 * @param {string} key - Config key to check
 * @returns {boolean} True if key exists and has a truthy value
 */
function has(key) {
    const config = load();
    return !!config[key];
}

/**
 * Check if this is a first run (no config file exists)
 * @returns {boolean} True if config file doesn't exist
 */
function isFirstRun() {
    const configPath = getConfigPath();
    return !fs.existsSync(configPath);
}

/**
 * Check if setup has been completed (config file exists, regardless of contents)
 * @returns {boolean} True if setup has been run at least once
 */
function hasCompletedSetup() {
    const configPath = getConfigPath();
    return fs.existsSync(configPath);
}

/**
 * Get a specific config value
 * @param {string} key - Config key to get
 * @param {*} defaultValue - Default value if key doesn't exist
 * @returns {*} Config value or default
 */
function get(key, defaultValue = null) {
    const config = load();
    return config[key] !== undefined ? config[key] : defaultValue;
}

/**
 * Set a specific config value
 * @param {string} key - Config key to set
 * @param {*} value - Value to set
 */
function set(key, value) {
    const config = load();
    config[key] = value;
    save(config);
}

// Backward compatibility aliases
const loadConfig = load;
const saveConfig = save;

module.exports = {
    getConfigDir,
    getConfigPath,
    load,
    save,
    has,
    get,
    set,
    isFirstRun,
    hasCompletedSetup,
    // Legacy aliases for backward compatibility
    loadConfig,
    saveConfig
};
