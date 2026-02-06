# Future Enhancement: Subtitle Information for AI Context

> **Status**: Documentation only (not implemented)
> **Purpose**: Explore how subtitle track metadata could improve AI episode mapping accuracy

---

## Overview

DVD subtitle tracks contain valuable metadata that could help the AI make better track-to-episode mapping decisions. This document outlines potential uses and implementation approaches.

---

## Available Subtitle Data

From lsdvd JSON output (`-Oj -x`), each track's subtitle information includes:

```json
{
  "subp": [
    {
      "ix": 1,
      "langcode": "en",
      "language": "English",
      "content": "Normal"
    },
    {
      "ix": 2,
      "langcode": "en",
      "language": "English",
      "content": "Director Comments"
    },
    {
      "ix": 3,
      "langcode": "es",
      "language": "Espanol",
      "content": "Normal"
    }
  ]
}
```

### Key Fields

| Field | Description | AI Relevance |
|-------|-------------|--------------|
| `langcode` | ISO language code (en, es, fr, etc.) | Region detection, content type |
| `language` | Full language name | Human-readable context |
| `content` | Subtitle type/purpose | Content classification |

---

## Potential AI Uses

### 1. Episode vs Extra Detection

**Pattern**: Episode tracks typically have "Normal" subtitles in multiple languages.

| Track Type | Typical Subtitle Pattern |
|------------|-------------------------|
| Episodes | Multiple languages (en, es, fr), all "Normal" |
| Commentary | Single language with "Director Comments" or "Commentary" |
| Featurettes | Often no subtitles, or English only |
| Menus | No subtitles or minimal |

**AI Prompt Addition**:
```
Track 3: 22 min, 3 subtitle tracks (en/es/fr - all Normal)
Track 4: 22 min, 1 subtitle track (en - Director Comments)
Track 5: 5 min, no subtitles

→ AI can infer Track 4 is likely a commentary/alternate version, not an episode
→ Track 5 with no subtitles is likely a featurette or menu
```

### 2. Closed Captioning vs Standard Subtitles

Some DVDs distinguish between:
- **CC (Closed Captioning)**: Full sound descriptions, intended for deaf/HoH viewers
- **Standard subtitles**: Translation or dialogue only

Episodes typically have both; extras often have neither or only one.

### 3. Language-Based Region Detection

Subtitle languages can indicate the disc's target market:

| Languages | Likely Region |
|-----------|--------------|
| en, es, fr | North American release |
| en, de, it, es | European release |
| en, ja | Japanese import with English subs |
| No subtitles | Possibly bootleg/backup |

This could help disambiguate between different regional releases of the same show.

### 4. "Forced" Subtitle Detection

Some DVDs have "forced" subtitle tracks for:
- Foreign language portions in primarily English content
- On-screen text translations
- Signs and written content

These are typically marked in the `content` field and are common in:
- Anime (Japanese text on screen)
- Shows with multilingual dialogue
- Period pieces with historical text

---

## Implementation Approach

### Data Extraction (Already Implemented)

The `parseLsdvdJsonOutput()` function already extracts subtitle data:

```javascript
// In lib/disc.js - already implemented
subtitles.push({
    index: sub.ix,
    langCode: sub.langcode || 'und',
    language: sub.language || 'Unknown',
    content: sub.content || 'Unknown'
});
```

### Prompt Integration (Not Yet Implemented)

To use this data, we would need to:

1. **Update track table in prompts/loader.js**:
```javascript
// Add subtitle summary to track row
const subSummary = t.subtitleLanguages.length > 0
    ? t.subtitleLanguages.map(s => s.langCode).join('/')
    : 'none';
const subTypes = t.subtitleLanguages.length > 0
    ? [...new Set(t.subtitleLanguages.map(s => s.content))].join(', ')
    : '';
```

2. **Update AI prompt template**:
```markdown
| Track | Duration | Chapters | Audio | Subtitles | Sub Types |
|-------|----------|----------|-------|-----------|-----------|
| 1 | 137 min | 12 | en/es | en/es/fr | Normal |
| 2 | 23 min | 2 | en/es | en/es/fr | Normal |
| 3 | 23 min | 2 | en | en | Commentary |
| 4 | 5 min | 1 | en | none | - |
```

3. **Add AI guidance in system prompt**:
```markdown
## Subtitle Patterns for Content Classification

- **Episodes**: Usually have multiple "Normal" subtitle tracks
- **Commentary tracks**: May have "Director Comments" or "Commentary" subtitle
- **Featurettes/Extras**: Often have no subtitles or English only
- **Menus**: Typically no subtitles

Use subtitle presence and type as a secondary indicator when:
- Track duration is ambiguous
- Distinguishing between episode and bonus content
```

---

## Trade-offs

### Pros
- More accurate episode vs extra classification
- Helps identify commentary tracks (which should be extras, not episodes)
- Could detect alternate versions (director's cut, etc.)

### Cons
- Adds complexity to prompts (more tokens)
- Not all DVDs have consistent subtitle metadata
- Diminishing returns - duration and chapters are usually sufficient

### Recommendation

**Low priority enhancement** - The chapter count and duration are usually sufficient for accurate mapping. Subtitle data would be most useful for:
- Detecting commentary versions of episodes
- Distinguishing between very similar duration tracks
- International releases with unusual track arrangements

---

## Example Scenario Where Subtitles Help

**Problem**: A TV DVD has two 22-minute tracks with identical chapter counts. Which is the episode and which is the commentary version?

| Track | Duration | Chapters | Current Data |
|-------|----------|----------|--------------|
| 3 | 22 min | 4 | Could be either |
| 4 | 22 min | 4 | Could be either |

**With subtitle data**:

| Track | Duration | Chapters | Subtitles | Likely Content |
|-------|----------|----------|-----------|----------------|
| 3 | 22 min | 4 | en/es/fr (Normal) | Episode |
| 4 | 22 min | 4 | en (Director Comments) | Commentary extra |

The AI can now correctly identify Track 4 as a commentary track that should be classified as an extra, not as an episode duplicate.

---

## Files That Would Need Changes

| File | Change |
|------|--------|
| `prompts/loader.js` | Add subtitle columns to track table |
| `prompts/track-mapping-system.md` | Add subtitle pattern guidance |
| `prompts/track-mapping-user.md` | Add subtitle column to track table template |

---

## Estimated Effort

- **Implementation**: ~2-3 hours
- **Testing**: ~1 hour (need DVDs with various subtitle patterns)
- **Risk**: Low (additive change, doesn't break existing functionality)
