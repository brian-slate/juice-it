# Mapping Validation - User Prompt

Validate this episode mapping result comprehensively. You are the sole decision-maker for what warnings the user sees.

---

## SECTION 1: CONTEXT

### 1A. User's Original Query
{{userQueryContext}}

### 1B. Extracted Information
{{extractedContext}}

---

## SECTION 2: DISC INFORMATION

- **Volume Name**: "{{volumeName}}"
- **Total Tracks**: {{numTitles}}
- **Track Durations (minutes)**: {{trackDurations}}

---

## SECTION 3: MATCHED CONTENT

### 3A. TMDB Match
- **Title**: {{matchedTitle}}
- **Type**: {{matchedType}}
- **Season**: {{seasonNumber}}
- **Total Episodes in Season**: {{totalEpisodes}}

### 3B. Mapping Summary
- **Episodes Mapped**: {{mappedEpisodeCount}}
- **Episode Range**: {{mappedEpisodeRange}}
- **Tracks Matched**: {{tracksMatched}}
- **Tracks Skipped**: {{tracksSkipped}}
- **Overall Confidence**: {{overallConfidence}}%

### 3C. Detailed Track Mappings
{{trackMappingDetails}}

### 3D. TMDB Episode Reference (for verification)
{{tmdbEpisodeList}}

---

## SECTION 4: YOUR TASK

**CRITICAL**: Use the TMDB episode list above to verify that mapped episode TITLES match their episode numbers. For example, if Track 2 is mapped to E1-E2, check that the track's content (from the original mapping) matches TMDB episodes 1 and 2.

Perform a comprehensive validation of this mapping:

1. **Episode Accuracy**: Do the episode numbers and range make sense?
2. **Confidence Check**: Are any mappings suspiciously low confidence?
3. **Content Match**: Does this match what the user requested?
4. **Track Analysis**: Are the right tracks being included/skipped?
5. **Multi-Disc Context**: If part of a set, is partial content expected?

### Produce your assessment:
- `isValid`: Is the overall mapping correct?
- `concerns`: Array of any problems found (with severity: error/warning/info)
- `summary`: Brief user-friendly summary
- `expectedOnDisc`: What content you'd expect (e.g., "Episodes 15-26 of Season 2")
- `reasoning`: Your detailed analysis

**Important**: You decide what warnings the user sees. If everything looks good, return an empty concerns array.
