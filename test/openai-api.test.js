/**
 * Tests for OpenAI API Integration
 *
 * These tests verify that the OpenAI SDK is correctly configured
 * and that the API paths we use are available. This prevents regressions
 * when the SDK version changes.
 */

const assert = require('assert');
const path = require('path');

// ============================================================================
// OPENAI SDK STRUCTURE TESTS
// ============================================================================

console.log('\n━━━ OpenAI SDK Structure Tests ━━━\n');

function testOpenAISdkImport() {
    console.log('Test: OpenAI SDK can be imported');

    const OpenAI = require('openai');
    assert.strictEqual(typeof OpenAI, 'function', 'OpenAI should be a constructor');

    console.log('  ✓ PASS\n');
}

function testOpenAIClientCreation() {
    console.log('Test: OpenAI client can be created');

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: 'test-key' });

    assert.strictEqual(typeof client, 'object', 'Client should be an object');
    assert.strictEqual(typeof client.chat, 'object', 'Client should have chat property');

    console.log('  ✓ PASS\n');
}

function testChatCompletionsExists() {
    console.log('Test: chat.completions exists');

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: 'test-key' });

    assert.strictEqual(typeof client.chat.completions, 'object', 'chat.completions should exist');
    assert.strictEqual(typeof client.chat.completions.create, 'function', 'chat.completions.create should be a function');

    console.log('  ✓ PASS\n');
}

function testChatCompletionsParseExists() {
    console.log('Test: chat.completions.parse exists (for structured outputs)');

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: 'test-key' });

    // This is the critical test - parse() must be on chat.completions, NOT beta.chat.completions
    assert.strictEqual(typeof client.chat.completions.parse, 'function',
        'chat.completions.parse should be a function (required for structured outputs)');

    console.log('  ✓ PASS\n');
}

function testBetaApiStructure() {
    console.log('Test: beta API structure (for reference)');

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: 'test-key' });

    // Document the beta structure - it does NOT have chat.completions
    assert.strictEqual(typeof client.beta, 'object', 'beta should exist');
    // beta.chat should NOT exist (or if it does, it should NOT have completions.parse)
    const betaChatExists = client.beta.chat !== undefined;
    const betaChatCompletionsParseExists = client.beta?.chat?.completions?.parse !== undefined;

    // Log the actual structure for documentation
    console.log(`    beta.chat exists: ${betaChatExists}`);
    console.log(`    beta.chat.completions.parse exists: ${betaChatCompletionsParseExists}`);

    // The key assertion: if beta.chat.completions.parse doesn't exist, that's expected
    // Our code should use client.chat.completions.parse instead
    if (!betaChatCompletionsParseExists) {
        console.log('    Note: Using client.chat.completions.parse for structured outputs (correct)');
    }

    console.log('  ✓ PASS\n');
}

// ============================================================================
// ZOD RESPONSE FORMAT TESTS
// ============================================================================

console.log('━━━ Zod Response Format Tests ━━━\n');

function testZodResponseFormatImport() {
    console.log('Test: zodResponseFormat helper can be imported');

    const { zodResponseFormat } = require('openai/helpers/zod');
    assert.strictEqual(typeof zodResponseFormat, 'function', 'zodResponseFormat should be a function');

    console.log('  ✓ PASS\n');
}

function testZodResponseFormatWithSchema() {
    console.log('Test: zodResponseFormat creates valid response format');

    const { z } = require('zod');
    const { zodResponseFormat } = require('openai/helpers/zod');

    const testSchema = z.object({
        name: z.string(),
        value: z.number()
    });

    const format = zodResponseFormat(testSchema, 'test_format');

    assert.strictEqual(typeof format, 'object', 'Should return an object');
    assert.strictEqual(format.type, 'json_schema', 'Type should be json_schema');
    assert.strictEqual(typeof format.json_schema, 'object', 'Should have json_schema property');
    assert.strictEqual(format.json_schema.name, 'test_format', 'Name should match');

    console.log('  ✓ PASS\n');
}

function testZodSchemaConversion() {
    console.log('Test: Zod schema converts to valid JSON schema');

    const { z } = require('zod');
    const { zodResponseFormat } = require('openai/helpers/zod');

    // Test with a schema similar to our TmdbMatchSchema
    const schema = z.object({
        selectedId: z.number().nullable(),
        selectedType: z.enum(['tv', 'movie']).nullable(),
        confidence: z.number().min(0).max(1),
        reasoning: z.string()
    });

    const format = zodResponseFormat(schema, 'tmdb_match');
    const jsonSchema = format.json_schema.schema;

    assert.strictEqual(jsonSchema.type, 'object', 'Schema type should be object');
    assert.strictEqual(typeof jsonSchema.properties, 'object', 'Should have properties');
    assert.strictEqual(typeof jsonSchema.properties.selectedId, 'object', 'Should have selectedId');
    assert.strictEqual(typeof jsonSchema.properties.confidence, 'object', 'Should have confidence');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// INTEGRATION PATH TESTS
// ============================================================================

console.log('━━━ Integration Path Tests ━━━\n');

function testCorrectApiPathInCode() {
    console.log('Test: juiceit.js uses correct API path (chat.completions.parse)');

    const fs = require('fs');
    const juiceitPath = path.join(__dirname, '../juiceit.js');
    const content = fs.readFileSync(juiceitPath, 'utf8');

    // Should use chat.completions.parse, NOT beta.chat.completions.parse
    const usesCorrectPath = content.includes('openai.chat.completions.parse');
    const usesWrongPath = content.includes('openai.beta.chat.completions.parse');

    assert.strictEqual(usesCorrectPath, true,
        'Code should use openai.chat.completions.parse for structured outputs');
    assert.strictEqual(usesWrongPath, false,
        'Code should NOT use openai.beta.chat.completions.parse (deprecated path)');

    console.log('  ✓ PASS\n');
}

function testZodImportInCode() {
    console.log('Test: juiceit.js imports Zod correctly');

    const fs = require('fs');
    const juiceitPath = path.join(__dirname, '../juiceit.js');
    const content = fs.readFileSync(juiceitPath, 'utf8');

    const importsZod = content.includes("require('zod')") || content.includes('require("zod")');
    const importsZodHelper = content.includes('zodResponseFormat');

    assert.strictEqual(importsZod, true, 'Code should import zod');
    assert.strictEqual(importsZodHelper, true, 'Code should import zodResponseFormat');

    console.log('  ✓ PASS\n');
}

function testSchemaFilesExist() {
    console.log('Test: Schema files exist and export correctly');

    const schemas = require('../prompts/schemas');

    assert.strictEqual(typeof schemas.TmdbMatchSchema, 'object', 'TmdbMatchSchema should exist');
    assert.strictEqual(typeof schemas.TrackMappingResponseSchema, 'object', 'TrackMappingResponseSchema should exist');
    assert.strictEqual(typeof schemas.TmdbMatchSchema.safeParse, 'function', 'Schema should have safeParse method');

    console.log('  ✓ PASS\n');
}

function testPromptLoaderExists() {
    console.log('Test: Prompt loader exists and exports correctly');

    const loader = require('../prompts/loader');

    assert.strictEqual(typeof loader.buildTmdbMatchPrompts, 'function', 'buildTmdbMatchPrompts should exist');
    assert.strictEqual(typeof loader.buildTrackMappingPrompts, 'function', 'buildTrackMappingPrompts should exist');
    assert.strictEqual(typeof loader.loadTemplate, 'function', 'loadTemplate should exist');
    assert.strictEqual(typeof loader.interpolate, 'function', 'interpolate should exist');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// AI CONFIG TESTS
// ============================================================================

console.log('━━━ AI Config Tests ━━━\n');

function testAiConfigExists() {
    console.log('Test: AI config file exists and can be loaded');

    const aiConfig = require('../config/ai-config');
    assert.strictEqual(typeof aiConfig, 'object', 'aiConfig should be an object');

    console.log('  ✓ PASS\n');
}

function testAiConfigHasRequiredFields() {
    console.log('Test: AI config has all required fields');

    const aiConfig = require('../config/ai-config');

    // Model settings
    assert.strictEqual(typeof aiConfig.model, 'string', 'model should be a string');
    assert.strictEqual(typeof aiConfig.temperature, 'number', 'temperature should be a number');
    assert.strictEqual(aiConfig.temperature >= 0 && aiConfig.temperature <= 2, true, 'temperature should be 0-2');

    // Response format settings
    assert.strictEqual(typeof aiConfig.useStructuredOutput, 'boolean', 'useStructuredOutput should be boolean');

    // Timeout settings
    assert.strictEqual(typeof aiConfig.slowResponseWarningSeconds, 'number', 'slowResponseWarningSeconds should be number');

    // Schema names
    assert.strictEqual(typeof aiConfig.schemaNames, 'object', 'schemaNames should be object');
    assert.strictEqual(typeof aiConfig.schemaNames.tmdbMatch, 'string', 'schemaNames.tmdbMatch should be string');
    assert.strictEqual(typeof aiConfig.schemaNames.trackMapping, 'string', 'schemaNames.trackMapping should be string');

    // Diagnostic settings
    assert.strictEqual(typeof aiConfig.diagnosticShowFullPrompts, 'boolean', 'diagnosticShowFullPrompts should be boolean');
    assert.strictEqual(typeof aiConfig.diagnosticShowFullResponses, 'boolean', 'diagnosticShowFullResponses should be boolean');

    console.log('  ✓ PASS\n');
}

function testAiConfigUsedInCode() {
    console.log('Test: juiceit.js imports and uses AI config');

    const fs = require('fs');
    const juiceitPath = path.join(__dirname, '../juiceit.js');
    const content = fs.readFileSync(juiceitPath, 'utf8');

    const importsConfig = content.includes("require('./config/ai-config')");
    const usesModel = content.includes('aiConfig.model');
    const usesTemperature = content.includes('aiConfig.temperature');
    const usesSchemaNames = content.includes('aiConfig.schemaNames');

    assert.strictEqual(importsConfig, true, 'Code should import ai-config');
    assert.strictEqual(usesModel, true, 'Code should use aiConfig.model');
    assert.strictEqual(usesTemperature, true, 'Code should use aiConfig.temperature');
    assert.strictEqual(usesSchemaNames, true, 'Code should use aiConfig.schemaNames');

    console.log('  ✓ PASS\n');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

try {
    // OpenAI SDK Structure Tests
    testOpenAISdkImport();
    testOpenAIClientCreation();
    testChatCompletionsExists();
    testChatCompletionsParseExists();
    testBetaApiStructure();

    // Zod Response Format Tests
    testZodResponseFormatImport();
    testZodResponseFormatWithSchema();
    testZodSchemaConversion();

    // Integration Path Tests
    testCorrectApiPathInCode();
    testZodImportInCode();
    testSchemaFilesExist();
    testPromptLoaderExists();

    // AI Config Tests
    testAiConfigExists();
    testAiConfigHasRequiredFields();
    testAiConfigUsedInCode();

    console.log('━'.repeat(60));
    console.log('  ✅ All OpenAI API tests passed!');
    console.log('━'.repeat(60));
    console.log('');

    process.exit(0);
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}
