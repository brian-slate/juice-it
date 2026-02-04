# Track Mapping - User Prompt

Map DVD tracks to episodes using the information below.

---

## SECTION 1: RAW DATA (No Pre-Analysis)

### 1A. TMDB Episode Data

**Show**: {{showName}}
**Season**: {{season}}
**Episode Count**: {{episodeCount}}
**DVD Volume Name**: {{volumeName}}

{{episodeTable}}

### 1B. DVD Track Data (from disc scan)

{{trackTable}}

### 1C. Extended Disc Metadata (from lsdvd)

{{lsdvdInfo}}

### 1D. Unrippable Tracks

{{unrippableInfo}}

---

## SECTION 2: COMPUTATIONAL ANALYSIS (For Context Only)

> **Important**: The analysis below is provided as additional context. You should use your own judgment when making mapping decisions. The computed values are suggestions, not rules.

### Runtime Statistics (derived from TMDB data)

{{runtimeSummary}}

### Observations

The following observations *might* be helpful:

{{computationalHints}}

{{discContext}}

---

## SECTION 3: YOUR TASK

Analyze the raw data above and determine which DVD tracks correspond to which episodes.

### Guidelines

1. **FIRST: Determine the starting episode** - Check Section 1E (Multi-Disc Context) above to calculate which episode this disc starts at. Do NOT assume Episode 1!
2. **Use runtime as the primary matching factor** - TMDB episode runtimes are the best indicator
3. **Detect multi-episode tracks** - If a track is ~2x, 3x, or 4x the episode runtime, it likely contains multiple episodes bundled together (common in animated series). Use `episodeEndIndex` to indicate the range.
4. **Skip ONLY "Play All" tracks** - Long tracks (≈ sum of all episodes) are "Play All" compilations and should be skipped. This is the ONLY type of track that should be skipped.
5. **Classify bonus content (but DON'T skip it)** - Featurettes, behind-the-scenes, interviews, deleted scenes, etc. should be RIPPED with proper `extraType` classification for Plex naming
6. **Consider the full picture** - A track's chapters, audio streams, and position may provide context
7. **Assign episodes sequentially from the calculated starting point** - Once you determine the starting episode, assign in order from there
8. **Disc may be part of a set** - If volume name shows "DISC_TWO" or similar, this is NOT Disc 1 - calculate the starting episode using the "count from end" method

### What to Include in Your Response

For each track, provide:
- Whether it should be mapped to an episode or skipped
- If mapped, which episode(s):
  - `episodeIndex`: 0-based index of the first episode
  - `episodeEndIndex`: (optional) 0-based index of the last episode if this track contains multiple episodes
  - Example: Track with episodes 1-2 would have episodeIndex=0, episodeEndIndex=1
- **For bonus/extra content** (featurettes, interviews, etc.) - DO NOT SKIP, just classify:
  - Set `shouldSkip: false` (so it gets ripped)
  - `extraType`: One of "featurette", "behindthescenes", "deleted", "interview", "trailer", "short", "scene"
  - `extraDescription`: Brief label like "Making Of", "Bonus Feature", "Deleted Scene"
- **For "Play All" tracks ONLY** - these should be skipped:
  - Set `shouldSkip: true`
  - `extraType: "other"`, `extraDescription: "Play All"`
- Your confidence level (0.0 to 1.0)
- Brief reasoning for your decision

Also include:
- Overall mapping confidence
- Summary of tracks matched vs skipped
- Any runtime analysis you performed
