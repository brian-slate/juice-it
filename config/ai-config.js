/**
 * AI Configuration
 *
 * Centralized configuration for AI model settings, parameters,
 * and behavior. Edit these values to tune AI performance.
 */

module.exports = {
    // =========================================================================
    // MODEL SETTINGS
    // =========================================================================

    /**
     * The OpenAI model to use for all AI operations.
     * Options: 'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'
     * gpt-4o-mini is recommended for cost-effectiveness (~$0.001/disc)
     */
    model: 'gpt-4o-mini',

    /**
     * Temperature controls randomness in responses.
     * Lower = more deterministic, higher = more creative.
     * Range: 0.0 to 2.0
     * Recommended: 0.1 for consistent, reliable mapping
     */
    temperature: 0.1,

    // =========================================================================
    // RESPONSE FORMAT SETTINGS
    // =========================================================================

    /**
     * Whether to use structured outputs with Zod schema validation.
     * When true: Uses OpenAI's structured output feature (guaranteed schema conformance)
     * When false: Uses JSON mode (valid JSON but no schema enforcement)
     */
    useStructuredOutput: true,

    // =========================================================================
    // TIMEOUT & RETRY SETTINGS
    // =========================================================================

    /**
     * Warning threshold in seconds - show message if AI takes longer than this
     */
    slowResponseWarningSeconds: 30,

    /**
     * Maximum retries on transient failures (network errors, rate limits)
     * Set to 0 to disable retries
     */
    maxRetries: 0,

    // =========================================================================
    // SCHEMA NAMES (for structured outputs)
    // =========================================================================

    /**
     * Schema names passed to OpenAI's structured output API.
     * These are identifiers for the response format.
     */
    schemaNames: {
        tmdbMatch: 'tmdb_match',
        trackMapping: 'track_mapping'
    },

    // =========================================================================
    // DIAGNOSTIC SETTINGS
    // =========================================================================

    /**
     * Whether to show full prompts in diagnostic mode
     */
    diagnosticShowFullPrompts: true,

    /**
     * Whether to show full AI responses in diagnostic mode
     */
    diagnosticShowFullResponses: true,

    /**
     * Maximum characters to show for prompts in diagnostic (0 = unlimited)
     */
    diagnosticMaxPromptChars: 0,

    /**
     * Maximum characters to show for responses in diagnostic (0 = unlimited)
     */
    diagnosticMaxResponseChars: 0
};
