/**
 * Zod Schemas for AI Response Validation
 *
 * These schemas define the expected structure of AI responses,
 * enabling structured outputs with the OpenAI API.
 */

const { z } = require('zod');

// Schema for query extraction (cleaning user input before TMDB search)
const QueryExtractionSchema = z.object({
    searchQuery: z.string().describe('The cleaned title to search TMDB (just the show/movie name, no extra words)'),
    season: z.number().nullable().describe('Season number if mentioned by user, or null'),
    disc: z.number().nullable().describe('Disc number if mentioned by user, or null'),
    year: z.number().nullable().describe('Year if mentioned by user (e.g., "Avatar 2009"), or null'),
    isTV: z.boolean().describe('Whether this appears to be a TV show (vs movie)'),
    reasoning: z.string().describe('Brief explanation of extraction')
});

// Schema for TMDB match selection response
const TmdbMatchSchema = z.object({
    selectedId: z.number().nullable().describe('TMDB ID of the selected match, or null if no good match'),
    selectedType: z.enum(['tv', 'movie']).nullable().describe('Type of content: tv or movie'),
    confidence: z.number().min(0).max(1).describe('Confidence score from 0.0 to 1.0'),
    reasoning: z.string().describe('Brief explanation of why this match was selected'),
    season: z.number().nullable().optional().describe('For TV shows, the likely season number based on disc name')
});

// Valid Plex/Jellyfin extra types for skipped tracks
// See: https://support.plex.tv/articles/local-files-for-trailers-and-extras/
const VALID_EXTRA_TYPES = ['behindthescenes', 'deleted', 'featurette', 'interview', 'scene', 'short', 'trailer', 'other'];

// Schema for individual track mapping
const TrackMappingSchema = z.object({
    trackNum: z.number().describe('The DVD track number'),
    trackDuration: z.number().describe('Duration of the track in minutes'),
    episodeIndex: z.number().nullable().describe('0-based index of the FIRST episode, or null if skipping'),
    episodeEndIndex: z.number().nullable().optional().describe('0-based index of the LAST episode if this track contains multiple episodes (e.g., episodeIndex=0, episodeEndIndex=1 means episodes 1-2)'),
    episodeRuntime: z.number().nullable().describe('Expected runtime from TMDB for single episode, or null if skipping'),
    durationDifference: z.number().nullable().describe('Difference between track duration and expected total runtime'),
    shouldSkip: z.boolean().describe('Whether this track should be skipped'),
    extraType: z.enum(['behindthescenes', 'deleted', 'featurette', 'interview', 'scene', 'short', 'trailer', 'other']).nullable().optional().describe('For skipped tracks: the type of extra content (e.g., "other" for Play All compilations, "deleted" for deleted scenes, "featurette" for bonus features)'),
    extraDescription: z.string().nullable().optional().describe('For skipped tracks: brief description of the extra (e.g., "Play All", "Behind the Scenes", "Deleted Scene")'),
    confidence: z.number().min(0).max(1).describe('Confidence score for this mapping'),
    reasoning: z.string().describe('Explanation of why this track was mapped or skipped')
});

// Schema for runtime analysis included in mapping response
const RuntimeAnalysisSchema = z.object({
    episodeRuntimeRange: z.string().describe('Range of episode runtimes (e.g., "9-10 min")'),
    toleranceUsed: z.number().describe('Tolerance in minutes used for matching'),
    validTrackRange: z.string().describe('Valid track duration range (e.g., "7-12 min")')
});

// Schema for mapping summary
const MappingSummarySchema = z.object({
    tracksMatched: z.number().describe('Number of tracks matched to episodes'),
    tracksSkipped: z.number().describe('Number of tracks skipped'),
    episodesFound: z.number().describe('Number of episodes found on the disc'),
    episodesExpected: z.number().describe('Number of episodes expected from TMDB')
});

// Complete schema for track mapping response
const TrackMappingResponseSchema = z.object({
    runtimeAnalysis: RuntimeAnalysisSchema,
    mappings: z.array(TrackMappingSchema).describe('Mapping details for each track'),
    summary: MappingSummarySchema,
    overallConfidence: z.number().min(0).max(1).describe('Overall confidence in the mapping')
});

module.exports = {
    VALID_EXTRA_TYPES,
    QueryExtractionSchema,
    TmdbMatchSchema,
    TrackMappingSchema,
    RuntimeAnalysisSchema,
    MappingSummarySchema,
    TrackMappingResponseSchema
};
