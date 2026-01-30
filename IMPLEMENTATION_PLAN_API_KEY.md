# Implementation Plan: TMDB API Key Management

## Objective
Allow users to configure their own TMDB API key instead of using a shared demo key, improving rate limiting and compliance with TMDB ToS.

## User Story
As a user installing JuiceIt, I want to easily set up my own TMDB API key so that I can use the metadata lookup features without rate limiting issues.

## Requirements

### Functional Requirements
1. Store API key in user config file (~/.config/juice-it/config.json)
2. Provide `--setup` flag to configure API key interactively
3. Validate API key by making test request to TMDB
4. Show helpful message on first run without configured key
5. Fall back to demo key if no user key configured (with warning)
6. Display post-install instructions via Homebrew caveats

### Non-Functional Requirements
- Config file must be created with appropriate permissions (0600)
- API key must not be logged or displayed in plain text
- Setup process must be user-friendly with clear instructions
- Error messages must be helpful and actionable

## Implementation Steps

### 1. Create Config Management Module
**File:** Add functions to juiceit.js

```javascript
// Get config directory path
function getConfigDir() {
    const os = require('os');
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), '.config', 'juice-it');
    } else if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'juice-it');
    } else {
        return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'juice-it');
    }
}

// Load config from file
function loadConfig() {
    const configPath = path.join(getConfigDir(), 'config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return {};
}

// Save config to file
function saveConfig(config) {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    const configPath = path.join(configDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
```

### 2. Add API Key Validation
**File:** juiceit.js

```javascript
async function validateTmdbApiKey(apiKey) {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/configuration', {
            params: { api_key: apiKey }
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}
```

### 3. Implement --setup Flag
**File:** juiceit.js (add to argument processing)

```javascript
} else if (arg === '--setup') {
    options.runSetup = true;
}
```

### 4. Create Setup Workflow
**File:** Add async function to juiceit.js

```javascript
async function runSetup() {
    console.log('');
    console.log('━'.repeat(60));
    console.log('  🔑 JuiceIt TMDB API Key Setup');
    console.log('━'.repeat(60));
    console.log('');
    console.log('To use metadata lookup, you need a free TMDB API key.');
    console.log('');
    console.log('📋 Steps to get your API key:');
    console.log('  1. Create account at https://www.themoviedb.org/signup');
    console.log('  2. Go to https://www.themoviedb.org/settings/api');
    console.log('  3. Request an API key (choose "Developer" option)');
    console.log('  4. Copy your "API Key (v3 auth)"');
    console.log('');
    
    const prompt = new Input({
        message: 'Enter your TMDB API key:',
        validate(value) {
            return value.length > 0 || 'API key cannot be empty';
        }
    });
    
    try {
        const apiKey = await prompt.run();
        
        console.log('');
        console.log('🔍 Validating API key...');
        
        const isValid = await validateTmdbApiKey(apiKey);
        
        if (isValid) {
            const config = loadConfig();
            config.tmdbApiKey = apiKey;
            saveConfig(config);
            
            console.log('✅ API key validated and saved!');
            console.log('');
            console.log(`Config saved to: ${path.join(getConfigDir(), 'config.json')}`);
            console.log('');
            console.log('You can now use JuiceIt with metadata lookup.');
            console.log('');
        } else {
            console.log('❌ Invalid API key. Please check and try again.');
            console.log('');
            console.log('Run `juiceit --setup` to try again.');
            console.log('');
            process.exit(1);
        }
    } catch (error) {
        console.log('');
        console.log('Setup cancelled.');
        console.log('');
        process.exit(0);
    }
}
```

### 5. Update TMDB API Key Usage
**File:** juiceit.js (modify TMDB_API_KEY constant)

```javascript
// Load API key from config or use demo key
const config = loadConfig();
const TMDB_API_KEY = config.tmdbApiKey || 'REMOVED_API_KEY'; // Demo key fallback

// Show warning if using demo key
if (!config.tmdbApiKey && !options.noLookup && !options.showHelp && !options.runSetup) {
    console.log('');
    console.log('⚠️  Using demo TMDB API key (rate limited)');
    console.log('   Get your free API key: https://www.themoviedb.org/settings/api');
    console.log('   Run: juiceit --setup');
    console.log('');
}
```

### 6. Add --setup Handler
**File:** juiceit.js (before async initialization)

```javascript
// Show help if requested (do this before async operations)
if (options.showHelp) {
    showHelp();
    process.exit(0);
}

// Run setup if requested
if (options.runSetup) {
    (async () => {
        await runSetup();
    })();
    return; // Exit early
}
```

### 7. Update Homebrew Formula
**File:** homebrew/Formula/juiceit.rb

Add caveats section:

```ruby
def caveats
  <<~EOS
    🎬 JuiceIt installed successfully!
    
    📋 Next Steps:
    1. Get a free TMDB API key:
       https://www.themoviedb.org/settings/api
    
    2. Run setup:
       juiceit --setup
    
    3. Insert a DVD and run:
       juiceit
    
    For help: juiceit --help
  EOS
end
```

### 8. Update README
**File:** README.md

Add section:

```markdown
## Setup

After installation, configure your TMDB API key:

1. **Get a free API key** from [TMDB](https://www.themoviedb.org/settings/api)
   - Sign up at https://www.themoviedb.org/signup
   - Go to Settings → API
   - Request API key (select "Developer")
   - Copy your "API Key (v3 auth)"

2. **Run setup:**
   ```bash
   juiceit --setup
   ```

3. **Start ripping!**
   ```bash
   juiceit
   ```

> **Note:** JuiceIt includes a demo API key for testing, but it's rate-limited. 
> We recommend getting your own free key for best performance.
```

## Acceptance Criteria

### Must Have
- [ ] User can run `juiceit --setup` to configure API key
- [ ] API key is validated before saving
- [ ] API key is stored in ~/.config/juice-it/config.json with 0600 permissions
- [ ] User-configured key is used instead of demo key when available
- [ ] Warning is shown when using demo key (except with --no-lookup)
- [ ] Homebrew formula shows setup instructions after install
- [ ] README documents setup process
- [ ] --setup can be run multiple times to update key

### Should Have
- [ ] Clear error messages for invalid API keys
- [ ] Helpful instructions with exact URLs
- [ ] Config file path shown after successful setup
- [ ] Graceful handling of setup cancellation (Ctrl-C)

### Nice to Have
- [ ] `juiceit --config` to show current config path and whether key is set
- [ ] Option to remove API key and revert to demo key
- [ ] Check API key validity on first metadata lookup

## Testing Plan

1. **Fresh Install Test**
   - Install via Homebrew
   - Verify caveats message appears
   - Run `juiceit` without setup → should show demo key warning
   - Run `juiceit --setup` → configure key
   - Run `juiceit` again → no warning, uses user key

2. **Invalid Key Test**
   - Run `juiceit --setup` with invalid key
   - Verify rejection and helpful error message

3. **Key Update Test**
   - Run `juiceit --setup` with valid key
   - Run again with different key
   - Verify update works

4. **Permission Test**
   - Check config.json has 0600 permissions
   - Verify config directory has 0700 permissions

5. **Cancellation Test**
   - Run `juiceit --setup`
   - Press Ctrl-C during prompt
   - Verify graceful exit

## Files Modified
- juiceit.js (add config management, setup workflow, API key loading)
- homebrew/Formula/juiceit.rb (add caveats section)
- README.md (add Setup section)

## Estimated Time
- Implementation: 1-2 hours
- Testing: 30 minutes
- Documentation: 30 minutes
- **Total: 2-3 hours**

## Dependencies
- enquirer (already installed)
- axios (already installed)
- fs, path, os (built-in)

## Risks & Mitigations
- **Risk:** Users skip setup and complain about rate limiting
  - **Mitigation:** Show prominent warning when using demo key
  
- **Risk:** Config file permissions too permissive
  - **Mitigation:** Explicitly set 0600 on file, 0700 on directory

- **Risk:** TMDB API changes
  - **Mitigation:** Validation request uses stable /configuration endpoint
