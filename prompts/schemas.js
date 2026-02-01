/**
 * Zod Schemas for AI Response Validation
 *
 * These schemas define the expected structure of AI responses,
 * enabling structured outputs with the OpenAI API.
 */

const { z } = require('zod');

// Schema for TMDB match selection response
const TmdbMatchSchema = z.object({
    selectedId: z.number().nullable().describe('TMDB ID of the selected match, or null if no good match'),
    selectedType: z.enum(['tv', 'movie']).nullable().describe('Type of content: tv or movie'),
    confidence: z.number().min(0).max(1).describe('Confidence score from 0.0 to 1.0'),
    reasoning: z.string().describe('Brief explanation of why this match was selected'),
    season: z.number().nullable().optional().describe('For TV shows, the likely season number based on disc name')
});

// Schema for individual track mapping
const TrackMappingSchema = z.object({
    trackNum: z.number().describe('The DVD track number'),
    trackDuration: z.number().describe('Duration of the track in minutes'),
    episodeIndex: z.number().nullable().describe('0-based index of the episode, or null if skipping'),
    episodeRuntime: z.number().nullable().describe('Expected runtime from TMDB, or null if skipping'),
    durationDifference: z.number().nullable().describe('Difference between track duration and episode runtime'),
    shouldSkip: z.boolean().describe('Whether this track should be skipped'),
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
    TmdbMatchSchema,
    TrackMappingSchema,
    RuntimeAnalysisSchema,
    MappingSummarySchema,
    TrackMappingResponseSchema
};
