# TMDB Match Selection - User Prompt

Analyze this DVD disc and determine which TMDB entry is correct.

## Disc Information

- **Volume Name**: "{{volumeName}}"
- **Total Tracks**: {{numTitles}}
- **Track Durations (minutes)**: {{trackDurations}}

## TMDB Search Results

{{tmdbData}}

## Task

Determine which TMDB entry is the correct match for this disc.

### Consider

1. Does the volume name match any title (accounting for abbreviations)?
2. Does the track count suggest TV show (multiple episodes) or movie?
3. Do track durations align with typical TV episode length (~20-45min) or movie length (>90min)?

### Response

Provide your selection with:
- The TMDB ID of the best match (or null if no good match)
- Whether it's a TV show or movie
- Your confidence level (0.0 to 1.0)
- Brief reasoning explaining your choice
- For TV shows: the likely season number based on the disc name
