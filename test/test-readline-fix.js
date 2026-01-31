#!/usr/bin/env node

/**
 * Test to verify readline interface doesn't crash
 * 
 * Issue: ERR_USE_AFTER_CLOSE errors when using multiple enquirer prompts
 * 
 * This test simulates the workflow to catch the bug
 */

const { Select } = require('enquirer');

async function testMultiplePrompts() {
    console.log('Testing multiple prompt workflow...\n');
    
    try {
        // First prompt (like metadata selection)
        const prompt1 = new Select({
            message: 'Select media type:',
            choices: ['TV Show', 'Movie', 'Custom']
        });
        
        const choice1 = await prompt1.run();
        console.log(`Selected: ${choice1}\n`);
        
        // Second prompt (like interactive mapping menu)
        const prompt2 = new Select({
            message: 'What to do?',
            choices: ['Edit', 'Accept', 'Cancel']
        });
        
        const choice2 = await prompt2.run();
        console.log(`Selected: ${choice2}\n`);
        
        console.log('✅ Test passed - no readline errors');
        return true;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('   Code:', error.code);
        return false;
    }
}

// Run test if called directly
if (require.main === module) {
    testMultiplePrompts()
        .then(success => process.exit(success ? 0 : 1))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}

module.exports = { testMultiplePrompts };
