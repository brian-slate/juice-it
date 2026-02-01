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
2. **Consider the full picture** - A track's chapters, audio streams, and position may provide context
3. **Identify non-content tracks** - Menus, extras, and bonus features typically have different characteristics
4. **Assign episodes sequentially** - Once you identify valid episode tracks, assign them in order

### What to Include in Your Response

For each track, provide:
- Whether it should be mapped to an episode or skipped
- If mapped, which episode (by index, 0-based)
- Your confidence level (0.0 to 1.0)
- Brief reasoning for your decision

Also include:
- Overall mapping confidence
- Summary of tracks matched vs skipped
- Any runtime analysis you performed
