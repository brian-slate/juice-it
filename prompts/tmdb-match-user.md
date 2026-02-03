# TMDB Match Selection - User Prompt

Analyze this DVD disc and determine which TMDB entry is correct.

---

## SECTION 1: USER CONTEXT

### 1A. User's Search Query
{{userQueryContext}}

### 1B. Pre-Parsed Query Information (from AI extraction)
{{extractedContext}}

---

## SECTION 2: DISC INFORMATION

### 2A. Volume Name and Tracks
- **Volume Name**: "{{volumeName}}"
- **Total Tracks**: {{numTitles}}
- **Track Durations (minutes)**: {{trackDurations}}

### 2B. Extended Disc Metadata (from lsdvd)
{{lsdvdContext}}

---

## SECTION 3: TMDB SEARCH RESULTS

{{tmdbData}}

---

## SECTION 4: YOUR TASK

Determine which TMDB entry is the correct match for this disc.

### Prioritization Rules

1. **Trust pre-parsed info first** - If the user specified a title, season, or year in their query, prioritize that information
2. **isTV flag matters** - If the extraction indicates this is a TV show (`isTV: true`), strongly prefer TV show results
3. **Box set awareness** - If `isBoxSet: true`, this is likely one disc in a multi-disc set (disc ≠ season)
4. **Volume name as fallback** - Use the disc volume name as additional context, not primary matching
5. **Track patterns help** - Multiple similar-duration tracks suggest TV show; one long track suggests movie

### Consider

1. Does the extracted/searched title match any TMDB result?
2. Does the track count suggest TV show (multiple episodes) or movie?
3. Do track durations align with typical TV episode length (~20-45min) or movie length (>90min)?
4. Does the lsdvd disc title provide additional clues?
5. Do the chapter counts per track help identify content type? (Episodes typically have 1-3 chapters)

### Response

Provide your selection with:
- The TMDB ID of the best match (or null if no good match)
- Whether it's a TV show or movie
- Your confidence level (0.0 to 1.0)
- Brief reasoning explaining your choice
- For TV shows: the likely season number (use the extracted season if provided, otherwise infer from disc name)
