/**
 * JuiceIt API Key Setup Wizard
 *
 * Interactive wizard for configuring TMDB and OpenAI API keys.
 */

const enquirer = require('enquirer');
const tmdbModule = require('./tmdb');
const aiModule = require('./ai');

// ==================== DEPENDENCY INJECTION ====================

// Dependencies with defaults
let deps = {
    Input: enquirer.Input,
    Select: enquirer.Select,
    validateTmdbApiKey: tmdbModule.validateTmdbApiKey,
    validateOpenAiApiKey: aiModule.validateOpenAiApiKey,
    exit: (code) => process.exit(code)
};

/**
 * Set dependencies for testing
 * @param {Object} newDeps - Object with dependency overrides
 */
function setDependencies(newDeps) {
    deps = { ...deps, ...newDeps };
}

/**
 * Reset dependencies to defaults (for test cleanup)
 */
function resetDependencies() {
    deps = {
        Input: enquirer.Input,
        Select: enquirer.Select,
        validateTmdbApiKey: tmdbModule.validateTmdbApiKey,
        validateOpenAiApiKey: aiModule.validateOpenAiApiKey,
        exit: (code) => process.exit(code)
    };
}

// Config module loader (set via setConfigLoader to avoid circular deps)
let configLoader = null;

/**
 * Set the config loader module
 * @param {Object} loader - Config module with load(), save(), getConfigDir()
 */
function setConfigLoader(loader) {
    configLoader = loader;
}

/**
 * Get config module (lazy load if not set)
 */
function getConfig() {
    if (!configLoader) {
        configLoader = require('./config');
    }
    return configLoader;
}

/**
 * Run the interactive API key setup wizard
 *
 * Guides the user through setting up:
 * 1. TMDB API key (optional - free demo key available)
 * 2. OpenAI API key (required for smart mapping)
 */
async function runSetup() {
    const config = getConfig();

    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬 Welcome to JuiceIt Setup');
    console.log('━'.repeat(60));
    console.log('');
    console.log('  JuiceIt can rip DVDs in two modes:');
    console.log('');
    console.log('  📀 Basic Mode (no setup required)');
    console.log('     Rips tracks as: Track_1.mp4, Track_2.mp4, etc.');
    console.log('');
    console.log('  ✨ Smart Mode (requires OpenAI API key)');
    console.log('     Rips tracks with proper names like:');
    console.log('     "Show Name - s01e01 - Episode Title.mp4"');
    console.log('');
    console.log('  Let\'s configure your API keys...');
    console.log('');

    const settings = config.load();

    // ========== TMDB API KEY (Required - but FREE) ==========
    console.log('━'.repeat(60));
    console.log('  🎬 TMDB API Key (FREE)');
    console.log('━'.repeat(60));
    console.log('');
    console.log('  TMDB provides episode names and metadata.');
    console.log('  ✅ 100% FREE - no payment required, ever');
    console.log('  ✅ Takes ~2 minutes to get your key');
    console.log('');
    console.log('  📋 How to get your free TMDB API key:');
    console.log('    1. Sign up at https://www.themoviedb.org/signup');
    console.log('    2. Go to https://www.themoviedb.org/settings/api');
    console.log('    3. Click "Create" or "Request an API Key"');
    console.log('    4. Choose "Developer" and fill in the form');
    console.log('       (App name: "JuiceIt", URL: can be blank)');
    console.log('    5. Copy your "API Key (v3 auth)"');
    console.log('');

    const tmdbPrompt = new deps.Input({
        message: 'Enter your TMDB API key:',
        validate(value) {
            if (!value || value.trim().length === 0) {
                return 'TMDB API key is required. Get your free key at https://www.themoviedb.org/settings/api';
            }
            return true;
        }
    });

    try {
        const tmdbApiKey = await tmdbPrompt.run();

        console.log('');
        console.log('🔍 Validating TMDB API key...');

        const isTmdbValid = await deps.validateTmdbApiKey(tmdbApiKey);

        if (isTmdbValid) {
            settings.tmdbApiKey = tmdbApiKey;
            console.log('✅ TMDB API key validated!');
        } else {
            console.log('❌ Invalid TMDB API key.');
            console.log('   Please check your key and run `juiceit --setup` again.');
            console.log('');
            console.log('   Get your free key at: https://www.themoviedb.org/settings/api');
            deps.exit(1);
        }

        // ========== OPENAI API KEY (Required for Smart Mapping) ==========
        console.log('');
        console.log('━'.repeat(60));
        console.log('  🧠 OpenAI API Key (For Smart Mapping)');
        console.log('━'.repeat(60));
        console.log('');
        console.log('  Smart mapping uses AI to:');
        console.log('    • Match disc tracks to correct episodes');
        console.log('    • Skip menus and "Play All" tracks automatically');
        console.log('    • Handle multi-episode tracks (common in animated series)');
        console.log('    • Name files properly for Plex/Jellyfin');
        console.log('');
        console.log('  💰 Cost: ~$0.01-0.02 per disc (uses GPT-4o)');
        console.log('');
        console.log('  ⚠️  Without an OpenAI key:');
        console.log('     Files will be named "Track_1.mp4", "Track_2.mp4", etc.');
        console.log('     You\'ll need to manually rename them afterward.');
        console.log('');

        const skipOpenAI = new deps.Select({
            message: 'Do you want to configure OpenAI for smart mapping?',
            choices: [
                'Yes - I want proper episode names (recommended)',
                'No - I\'ll manually rename files'
            ]
        });

        const openAiChoice = await skipOpenAI.run();

        if (openAiChoice.startsWith('Yes')) {
            console.log('');
            console.log('📋 To get an OpenAI API key:');
            console.log('   1. Go to https://platform.openai.com/api-keys');
            console.log('   2. Sign in or create an account');
            console.log('   3. Click "Create new secret key"');
            console.log('   4. Copy the key (starts with "sk-")');
            console.log('');

            const openAiPrompt = new deps.Input({
                message: 'Enter your OpenAI API key:',
                validate(value) {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter an API key or press Ctrl+C to cancel';
                    }
                    return true;
                }
            });

            const openAiApiKey = await openAiPrompt.run();

            if (openAiApiKey && openAiApiKey.trim().length > 0) {
                console.log('');
                console.log('🔍 Validating OpenAI API key...');

                const isOpenAiValid = await deps.validateOpenAiApiKey(openAiApiKey);

                if (isOpenAiValid) {
                    settings.openaiApiKey = openAiApiKey;
                    console.log('✅ OpenAI API key validated!');
                } else {
                    console.log('❌ Invalid OpenAI API key.');
                    console.log('   Smart mapping will not be available.');
                    console.log('   Run `juiceit --setup` to try again.');
                }
            }
        } else {
            console.log('');
            console.log('ℹ️  Skipping OpenAI setup.');
            console.log('   Files will be named Track_1.mp4, Track_2.mp4, etc.');
            console.log('   You can add smart mapping later: juiceit --setup');
        }

        // Save config
        config.save(settings);

        // ========== SUMMARY ==========
        console.log('');
        console.log('━'.repeat(60));
        console.log('  ✅ Setup Complete!');
        console.log('━'.repeat(60));
        console.log('');
        console.log(`  Config saved to: ${config.getConfigPath()}`);
        console.log('');

        if (settings.openaiApiKey) {
            console.log('  ✨ Smart mapping: ENABLED');
            console.log('     Your DVDs will be ripped with proper episode names.');
        } else {
            console.log('  📀 Basic mode: Files will be named Track_1.mp4, etc.');
            console.log('     Run `juiceit --setup` anytime to enable smart mapping.');
        }
        console.log('');
        console.log('  Ready to rip! Insert a DVD and run:');
        console.log('    juiceit "Show Name season 1"');
        console.log('');

    } catch (error) {
        console.log('');
        console.log('Setup cancelled.');
        console.log('');
        deps.exit(0);
    }
}

/**
 * Check if setup is needed and show appropriate message
 * @returns {boolean} True if setup should be run
 */
function shouldRunFirstTimeSetup() {
    const config = getConfig();
    return config.isFirstRun();
}

/**
 * Show a brief reminder about smart mapping if not configured
 */
function showSmartMappingReminder() {
    const config = getConfig();
    const settings = config.load();

    if (!settings.openaiApiKey) {
        console.log('');
        console.log('━'.repeat(60));
        console.log('  💡 Tip: Enable Smart Mapping');
        console.log('━'.repeat(60));
        console.log('');
        console.log('  Without smart mapping, files are named Track_1.mp4, etc.');
        console.log('  With smart mapping, you get proper episode names.');
        console.log('');
        console.log('  Run: juiceit --setup');
        console.log('━'.repeat(60));
        console.log('');
    }
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    setConfigLoader,
    // Functions
    runSetup,
    shouldRunFirstTimeSetup,
    showSmartMappingReminder,
    // Alias for backward compatibility
    run: runSetup
};
