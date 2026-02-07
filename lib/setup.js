/**
 * JuiceIt API Key Setup Wizard
 *
 * Interactive wizard for configuring TMDB and OpenAI API keys.
 * Both keys are required for smart episode naming.
 * Without keys, falls back to basic track naming (Track_1.mp4, etc.)
 */

const enquirer = require('enquirer');
const tmdbModule = require('./tmdb');
const aiModule = require('./ai');
const pricing = require('./pricing');
const aiConfig = require('../config/ai-config');

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
 * 1. TMDB API key (for metadata - FREE)
 * 2. OpenAI API key (for smart mapping - paid)
 *
 * BOTH keys are required for smart episode naming.
 * Users can skip setup and use basic naming instead.
 */
async function runSetup() {
    const config = getConfig();

    console.log('');
    console.log('━'.repeat(60));
    console.log('  🎬 JuiceIt Setup');
    console.log('━'.repeat(60));
    console.log('');
    console.log('  JuiceIt can rip DVDs in two modes:');
    console.log('');
    console.log('  📀 Basic Mode (no API keys needed)');
    console.log('     Files named: Track_1.mp4, Track_2.mp4, etc.');
    console.log('     You rename them manually afterward.');
    console.log('');
    console.log('  ✨ Smart Mode (requires BOTH API keys)');
    console.log('     Files named: "Show Name - s01e01 - Episode Title.mp4"');
    console.log('     Automatic episode detection and naming.');
    console.log('');
    // Calculate cost for default model
    const defaultModel = aiConfig.model;
    const costEstimate = pricing.calculateDiscCost(defaultModel);

    console.log('  For Smart Mode you need:');
    console.log('    • TMDB API key (FREE - for episode metadata)');
    console.log(`    • OpenAI API key (${costEstimate.formattedCost} per disc using ${defaultModel})`);
    console.log('');

    const settings = config.load();
    let hasTmdbKey = false;
    let hasOpenAiKey = false;

    // Ask if user wants to set up smart naming
    const setupChoice = new deps.Select({
        message: 'How would you like to use JuiceIt?',
        choices: [
            { name: 'Smart Mode - Set up API keys for automatic episode naming (recommended)', value: 'smart' },
            { name: 'Basic Mode - Skip setup, use simple track names', value: 'basic' }
        ]
    });

    try {
        const mode = await setupChoice.run();

        if (mode === 'basic') {
            console.log('');
            console.log('━'.repeat(60));
            console.log('  📀 Basic Mode Selected');
            console.log('━'.repeat(60));
            console.log('');
            console.log('  Files will be named Track_1.mp4, Track_2.mp4, etc.');
            console.log('');
            console.log('  💡 You can enable Smart Mode anytime by running:');
            console.log('     juice-it --setup');
            console.log('');

            // Save empty config to mark setup as complete
            config.save(settings);
            return;
        }

        // ========== TMDB API KEY ==========
        console.log('');
        console.log('━'.repeat(60));
        console.log('  Step 1 of 2: TMDB API Key (FREE)');
        console.log('━'.repeat(60));
        console.log('');
        console.log('  TMDB provides episode titles and metadata.');
        console.log('  ✅ 100% FREE - no payment ever');
        console.log('  ✅ Takes ~2 minutes to get');
        console.log('');
        console.log('  📋 How to get your free TMDB API key:');
        console.log('    1. Sign up at https://www.themoviedb.org/signup');
        console.log('    2. Go to https://www.themoviedb.org/settings/api');
        console.log('    3. Click "Create" → "Developer"');
        console.log('    4. Fill form (App name: "JuiceIt", URL: leave blank)');
        console.log('    5. Copy "API Key (v3 auth)"');
        console.log('');

        const tmdbPrompt = new deps.Input({
            message: 'Enter your TMDB API key (or press Enter to skip):',
            validate(_value) {
                return true; // Allow empty to skip
            }
        });

        const tmdbApiKey = await tmdbPrompt.run();

        if (tmdbApiKey && tmdbApiKey.trim().length > 0) {
            console.log('');
            console.log('🔍 Validating TMDB API key...');

            const isTmdbValid = await deps.validateTmdbApiKey(tmdbApiKey);

            if (isTmdbValid) {
                settings.tmdbApiKey = tmdbApiKey.trim();
                hasTmdbKey = true;
                console.log('✅ TMDB API key validated!');
            } else {
                console.log('❌ Invalid TMDB API key.');
            }
        } else {
            console.log('');
            console.log('⏭️  Skipping TMDB key.');
        }

        // ========== OPENAI API KEY ==========
        console.log('');
        console.log('━'.repeat(60));
        console.log('  Step 2 of 2: OpenAI API Key');
        console.log('━'.repeat(60));
        console.log('');
        console.log(`  OpenAI analyzes disc tracks to match episodes (${costEstimate.formattedCost}/disc).`);
        console.log('');
        console.log('  📋 How to get your OpenAI API key:');
        console.log('    1. Go to https://platform.openai.com/api-keys');
        console.log('    2. Sign in or create account');
        console.log('    3. Click "Create new secret key"');
        console.log('    4. Copy the key (starts with "sk-")');
        console.log('');

        const openAiPrompt = new deps.Input({
            message: 'Enter your OpenAI API key (or press Enter to skip):',
            validate(_value) {
                return true; // Allow empty to skip
            }
        });

        const openAiApiKey = await openAiPrompt.run();

        if (openAiApiKey && openAiApiKey.trim().length > 0) {
            console.log('');
            console.log('🔍 Validating OpenAI API key...');

            const isOpenAiValid = await deps.validateOpenAiApiKey(openAiApiKey);

            if (isOpenAiValid) {
                settings.openaiApiKey = openAiApiKey.trim();
                hasOpenAiKey = true;
                console.log('✅ OpenAI API key validated!');
            } else {
                console.log('❌ Invalid OpenAI API key.');
            }
        } else {
            console.log('');
            console.log('⏭️  Skipping OpenAI key.');
        }

        // Save config
        config.save(settings);

        // ========== SUMMARY ==========
        console.log('');
        console.log('━'.repeat(60));
        console.log('  Setup Complete!');
        console.log('━'.repeat(60));
        console.log('');
        console.log(`  Config saved to: ${config.getConfigPath()}`);
        console.log('');

        if (hasTmdbKey && hasOpenAiKey) {
            console.log('  ✨ Smart Mode: ENABLED');
            console.log('     Your DVDs will be ripped with proper episode names!');
        } else if (hasTmdbKey || hasOpenAiKey) {
            console.log('  ⚠️  Partial Setup');
            console.log('     Smart Mode requires BOTH keys to work.');
            if (!hasTmdbKey) console.log('     ❌ Missing: TMDB API key');
            if (!hasOpenAiKey) console.log('     ❌ Missing: OpenAI API key');
            console.log('');
            console.log('  📀 Using Basic Mode (Track_1.mp4, Track_2.mp4, etc.)');
            console.log('');
            console.log('  💡 Run `juice-it --setup` to add missing keys.');
        } else {
            console.log('  📀 Basic Mode: Files named Track_1.mp4, Track_2.mp4, etc.');
            console.log('');
            console.log('  💡 Run `juice-it --setup` anytime to enable Smart Mode.');
        }

        console.log('');
        console.log('  Ready to rip! Insert a DVD and run:');
        console.log('    juice-it "Show Name season 1"');
        console.log('');

    } catch (error) {
        // User cancelled (Ctrl+C)
        console.log('');
        console.log('Setup cancelled.');
        console.log('');
        console.log('💡 Run `juice-it --setup` anytime to configure API keys.');
        console.log('');

        // Save whatever we have
        config.save(settings);
        deps.exit(0);
    }
}

/**
 * Check if setup is needed (first run with no config)
 * @returns {boolean} True if config file doesn't exist
 */
function shouldRunFirstTimeSetup() {
    const config = getConfig();
    return config.isFirstRun();
}

/**
 * Check if smart mapping is fully configured
 * @returns {boolean} True if both TMDB and OpenAI keys are present
 */
function isSmartMappingEnabled() {
    const config = getConfig();
    const settings = config.load();
    return !!(settings.tmdbApiKey && settings.openaiApiKey);
}

module.exports = {
    // Dependency injection (for testing)
    setDependencies,
    resetDependencies,
    setConfigLoader,
    // Functions
    runSetup,
    shouldRunFirstTimeSetup,
    isSmartMappingEnabled,
    // Alias for backward compatibility
    run: runSetup
};
