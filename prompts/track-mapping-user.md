# Track Mapping - User Prompt

Map DVD tracks to episodes using the information below.

---

## SECTION 1: RAW DATA (No Pre-Analysis)

### 1A. TMDB Episode Data

**Show**: {{showName}}
**Season**: {{season}}
**Episode Count**: {{episodeCount}}

{{episodeTable}}

### 1B. DVD Track Data (from disc scan)

{{trackTable}}

### 1C. Extended Disc Metadata (from lsdvd)

{{lsdvdInfo}}

### 1D. Unrippable Tracks

{{unrippableInfo}}

{{discContext}}

---

## SECTION 2: COMPUTATIONAL ANALYSIS (For Context Only)

> **Important**: The analysis below is provided as additional context. You should use your own judgment when making mapping decisions. The computed values are suggestions, not rules.

### Runtime Statistics (derived from TMDB data)

{{runtimeSummary}}

### Observations

The following observations *might* be helpful:

{{computationalHints}}

---

## SECTION 3: YOUR TASK

Analyze the raw data above and determine which DVD tracks correspond to which episodes.

### Guidelines

1. **Use runtime as the primary matching factor** - TMDB episode runtimes are the best indicator
2. **Detect multi-episode tracks** - If a track is ~2x, 3x, or 4x the episode runtime, it likely contains multiple episodes bundled together (common in animated series). Use `episodeEndIndex` to indicate the range.
3. **Skip "Play All" tracks** - Long tracks (> sum of several episodes) are usually "Play All" compilations and should be skipped
4. **Consider the full picture** - A track's chapters, audio streams, and position may provide context
5. **Identify non-content tracks** - Menus, extras, and bonus features typically have different characteristics
6. **Assign episodes sequentially** - Once you identify valid episode tracks, assign them in order
7. **Disc may be part of a set** - If the disc is "Disc 1", it likely only has a portion of the season's episodes

### What to Include in Your Response

For each track, provide:
- Whether it should be mapped to an episode or skipped
- If mapped, which episode(s):
  - `episodeIndex`: 0-based index of the first episode
  - `episodeEndIndex`: (optional) 0-based index of the last episode if this track contains multiple episodes
  - Example: Track with episodes 1-2 would have episodeIndex=0, episodeEndIndex=1
- **If skipped, classify the extra type** (IMPORTANT for proper file naming):
  - `extraType`: One of "other", "featurette", "behindthescenes", "deleted", "interview", "trailer", "short", "scene"
  - `extraDescription`: Brief label like "Play All", "Menu", "Bonus Feature"
  - For Play All compilation tracks: use `extraType: "other"`, `extraDescription: "Play All"`
- Your confidence level (0.0 to 1.0)
- Brief reasoning for your decision

Also include:
- Overall mapping confidence
- Summary of tracks matched vs skipped
- Any runtime analysis you performed
