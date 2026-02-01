# JuiceIt 🎬

A smart DVD ripper with automatic metadata lookup and episode naming. Rip entire TV series or movies with intelligent track detection, TMDB metadata integration, and interactive episode mapping.

## Features

- 🔍 **Auto DVD Detection** - Automatically detects inserted DVDs
- 📺 **Smart Metadata Lookup** - Fetches TV show and movie info from TMDB
- 🤖 **AI-Powered Mapping** (Optional) - Uses OpenAI to intelligently map tracks to episodes
  - Automatic TMDB match selection
  - Handles complex disc layouts (non-sequential episodes, menus, extras)
  - Smart skip detection for menus and bonus content
  - Confidence scoring for each decision
- 📋 **Episode Naming** - Automatically names episodes (e.g., `S01E01_Episode_Title.mp4`)
- 🎯 **Track Categorization** - Identifies menus, extras, episodes, and full disc rips
- 💾 **Intelligent Caching** - Remembers disc info for faster re-rips
- 🎨 **Beautiful Progress UI** - Real-time progress bars with time estimates
- 🔄 **Interactive Mapping** - Review and adjust episode assignments before ripping
- 📦 **Homebrew Installation** - Install globally with `brew install`

## Installation

### Via Homebrew (Recommended)

```bash
brew tap brian-slate/juiceit
brew install juiceit
```

### Manual Installation

**Prerequisites:**
- [Node.js](https://nodejs.org/) v14 or higher
- [HandBrakeCLI](https://handbrake.fr/) - `brew install handbrake`
- [libdvdcss](https://www.videolan.org/developers/libdvdcss/) - `brew install libdvdcss`
- [ffmpeg](https://ffmpeg.org/) - `brew install ffmpeg`
- [lsdvd](http://sourceforge.net/projects/lsdvd/) - `brew install lsdvd` - Extended disc metadata for AI mapping

```bash
git clone https://github.com/brian-slate/juice-it.git
cd juice-it
npm install
```

## Setup

After installation, configure your API keys:

### TMDB API Key (Required)

1. **Get a free API key** from [TMDB](https://www.themoviedb.org/settings/api)
   - Sign up at https://www.themoviedb.org/signup
   - Go to Settings → API
   - Request API key (select "Developer")
   - Copy your "API Key (v3 auth)"

### OpenAI API Key (Optional - Enables AI Features)

2. **Get an OpenAI API key** from [OpenAI Platform](https://platform.openai.com/api-keys)
   - Create an account at https://platform.openai.com/signup
   - Go to API Keys and create a new key
   - **Cost:** ~$0.001-0.002 per disc (uses GPT-4o-mini)
   - **Benefits:**
     - Automatic TMDB match selection
     - Intelligent track-to-episode mapping
     - Handles complex disc layouts automatically
     - Auto-detects menus and extras

### Run Setup

3. **Configure both keys:**
   ```bash
   juiceit --setup
   ```
   
   The setup will:
   - Prompt for TMDB key (press Enter to use rate-limited demo key)
   - Optionally prompt for OpenAI key (press Enter to skip)
   - Validate both keys
   - Save securely to `~/.config/juice-it/config.json`
   
   **Quick start:** You can press Enter for both prompts to get started immediately with:
   - Demo TMDB key (rate limited)
   - No AI features (manual selection and mapping)

4. **Start ripping!**
   ```bash
   juiceit
   ```

> **Note:** JuiceIt includes a demo TMDB key for testing, but it's rate-limited. 
> We recommend getting your own free key for best performance.
> 
> **AI features are optional** - JuiceIt works great without OpenAI, you'll just need
> to manually select TMDB matches and review track mappings.

## Installation (Old)

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/juice-it.git
   cd juice-it
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. (Optional) Install globally for easier access:

   ```bash
   npm install -g .
   ```

## Usage

### Basic Usage (Auto-detection)

Simply insert a DVD and run:

```bash
juiceit
```

JuiceIt will:
1. Auto-detect the DVD
2. Scan all tracks and durations
3. Look up metadata from TMDB
4. Let you select the correct show/movie
5. Rip all tracks with proper names
6. Show interactive mapping for episode assignment

### Command Line Options

```bash
juiceit [options]

Options:
  --help              Show help message
  --setup             Configure TMDB API key
  --output DIR        Output directory (default: <disc_name>_<date>)
  --dvdSource PATH    DVD device path (auto-detected if omitted)
  --quality N         Encoding quality 0-51 (default: 20)
  --no-deinterlace    Disable deinterlacing
  --no-lookup         Skip metadata lookup, use disc name
  --scan-only         Scan disc and show metadata without ripping
  --rename-only       Rename existing files using metadata
  --verbose           Show detailed HandBrakeCLI output
```

### Examples

**Scan a disc without ripping:**
```bash
juiceit --scan-only
```

**Skip metadata lookup:**
```bash
juiceit --no-lookup
```

**Rename previously ripped files:**
```bash
juiceit --rename-only --output ./my_ripped_dvd/
```

## Creating a Release

To create a new release of the tool, follow these steps:

1. **Bump the Version and Create a Tarball**:
   Run the following command to bump the version, create a changelog, tag the release, and create a tarball:

   ```bash
   npm run release
   ```

   This command will:
   - Update the version in `package.json`.
   - Generate a `CHANGELOG.md` file.
   - Create a Git tag for the release.
   - Create a tarball named `juice-it-vX.Y.Z.tar.gz` (where `X.Y.Z` is the new version).

2. **Push Changes to GitHub**:
   After running the release command, push the changes and tags to your GitHub repository:

   ```bash
   git push --follow-tags
   ```

## Legal Disclaimer

⚠️ **Important:** This tool is intended for **personal use only** to create backup copies of DVDs you legally own.

- DVD decryption legality varies by country and jurisdiction
- In the US, circumventing DVD CSS encryption may violate the DMCA
- Users are solely responsible for ensuring their use complies with local laws
- The authors assume no liability for misuse of this software

**You must own the physical DVD to legally rip it in most jurisdictions.**

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

<img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" width="100">

Metadata provided by [The Movie Database (TMDB)](https://www.themoviedb.org/).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Development

Contributing to JuiceIt? Here's how to test your changes:

### Local Testing Workflow

```bash
# 1. Make your changes
vim juiceit.js

# 2. Commit
git add -A
git commit -m "Your message"

# 3. Update Homebrew installation
./bin/update-homebrew.sh

# 4. Test
juiceit --help
```

### Testing

```bash
# Run automated tests
npm test

# Try the interactive demo
npm run demo

# Test with a real DVD
juiceit --scan-only
```

### Documentation

- `NPM_COMMANDS.md` - All npm scripts and testing commands
- `RELEASE.md` - How to create a new release
- `PUBLISH_TAP.md` - Publishing your tap to GitHub (recommended)
- `HOMEBREW_DISTRIBUTION.md` - Advanced distribution options
- `COMPLETION_SUMMARY.md` - Implementation details
- `IMPLEMENTATION_PLAN_*.md` - Feature specifications

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Acknowledgments

- [HandBrake](https://handbrake.fr/) - Video transcoding
- [libdvdcss](https://www.videolan.org/developers/libdvdcss/) - DVD decryption
- [TMDB](https://www.themoviedb.org/) - Metadata API
- [FFmpeg](https://ffmpeg.org/) - Video analysis
