# Mapping Validation - User Prompt

Validate this episode mapping result and determine if it's correct.

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

### 3B. Mapping Results
- **Episodes Mapped**: {{mappedEpisodeCount}}
- **Episode Range**: {{mappedEpisodeRange}}
- **Tracks Matched**: {{tracksMatched}}
- **Tracks Skipped**: {{tracksSkipped}}
- **Overall Confidence**: {{overallConfidence}}%

---

## SECTION 4: YOUR TASK

Assess whether this mapping is correct and expected:

1. **Consider the context**: Is this a multi-disc set? Would partial season content be expected?
2. **Check episode range**: Do the mapped episodes make sense for this disc?
3. **Verify confidence**: Are the confidence scores acceptable?
4. **Identify real problems**: Only flag genuine concerns, not expected multi-disc behavior

### Respond with:
- Whether the mapping is valid
- Any genuine concerns (empty array if none)
- A brief summary for the user
- What content you'd expect on this disc
- Your reasoning
