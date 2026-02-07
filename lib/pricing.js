/**
 * Pricing Calculator for AI Operations
 *
 * Estimates costs based on OpenAI pricing and typical token usage.
 */

const path = require('path');
const fs = require('fs');

/**
 * Load pricing data from config
 * @returns {Object} Pricing data
 */
function loadPricingData() {
    const pricingPath = path.join(__dirname, '../config/pricing.json');
    return JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
}

/**
 * Calculate estimated cost for a single disc
 * @param {string} modelName - OpenAI model name (e.g., 'gpt-4o')
 * @returns {Object} Cost breakdown
 */
function calculateDiscCost(modelName = 'gpt-4o') {
    const pricing = loadPricingData();
    const model = pricing.models[modelName];

    if (!model) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    const inputTokens = pricing.estimatedTokensPerDisc.input;
    const outputTokens = pricing.estimatedTokensPerDisc.output;

    const inputCost = (inputTokens / 1000000) * model.inputCostPer1M;
    const outputCost = (outputTokens / 1000000) * model.outputCostPer1M;
    const totalCost = inputCost + outputCost;

    return {
        model: modelName,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
        totalCost,
        formattedCost: `$${totalCost.toFixed(4)}`
    };
}

/**
 * Get pricing comparison for all models
 * @returns {Array} Array of cost comparisons
 */
function getAllModelComparison() {
    const pricing = loadPricingData();
    const models = Object.keys(pricing.models);

    return models.map(modelName => {
        const cost = calculateDiscCost(modelName);
        return {
            model: modelName,
            description: pricing.models[modelName].description,
            costPerDisc: cost.formattedCost,
            cost10Discs: `$${(cost.totalCost * 10).toFixed(2)}`,
            cost100Discs: `$${(cost.totalCost * 100).toFixed(2)}`
        };
    });
}

/**
 * Format pricing table for display
 * @returns {string} Formatted table
 */
function formatPricingTable() {
    const comparison = getAllModelComparison();
    const pricing = loadPricingData();

    let output = '\n';
    output += '━'.repeat(80) + '\n';
    output += '  💰 AI Model Pricing Estimates\n';
    output += '━'.repeat(80) + '\n\n';
    output += `  Based on typical usage: ~${pricing.estimatedTokensPerDisc.input.toLocaleString()} input + ${pricing.estimatedTokensPerDisc.output.toLocaleString()} output tokens per disc\n`;
    output += `  ${pricing.estimatedTokensPerDisc.note}\n\n`;

    comparison.forEach(model => {
        output += `  ${model.model}\n`;
        output += `    ${model.description}\n`;
        output += `    Cost per disc: ${model.costPerDisc}\n`;
        output += `    10 discs: ${model.cost10Discs}  |  100 discs: ${model.cost100Discs}\n\n`;
    });

    output += '  💡 Tip: Start with gpt-4o-mini ($0.0018/disc) for most discs.\n';
    output += '     Only use gpt-4o ($0.0400/disc) for complex multi-disc box sets.\n';
    output += '━'.repeat(80) + '\n';

    return output;
}

/**
 * Get recommended model based on disc characteristics
 * @param {number} numTracks - Number of tracks on disc
 * @param {boolean} isBoxSet - Whether this is a box set
 * @returns {Object} Recommendation
 */
function getRecommendedModel(numTracks = 20, isBoxSet = false) {
    if (isBoxSet || numTracks > 30) {
        return {
            model: 'gpt-4o',
            reason: 'Complex multi-disc box set with many tracks - needs strongest model',
            estimatedCost: calculateDiscCost('gpt-4o').formattedCost
        };
    } else if (numTracks > 15) {
        return {
            model: 'gpt-4o-mini',
            reason: 'Standard TV season disc - mini model is sufficient',
            estimatedCost: calculateDiscCost('gpt-4o-mini').formattedCost
        };
    } else {
        return {
            model: 'gpt-4o-mini',
            reason: 'Simple disc with few tracks - mini model is perfect',
            estimatedCost: calculateDiscCost('gpt-4o-mini').formattedCost
        };
    }
}

module.exports = {
    loadPricingData,
    calculateDiscCost,
    getAllModelComparison,
    formatPricingTable,
    getRecommendedModel
};
