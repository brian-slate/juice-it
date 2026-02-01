#!/usr/bin/env node
/**
 * Test Runner - Runs all test suites
 *
 * Usage: node test/run-all-tests.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testFiles = [
    'juiceit.test.js',
    'prompts.test.js',
    'runtime-analysis.test.js',
    'openai-api.test.js',
    'naming.test.js',
    'e2e-dry-run.test.js'
];

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║              JuiceIt Test Suite Runner                     ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

let allPassed = true;
const results = [];

for (const testFile of testFiles) {
    const testPath = path.join(__dirname, testFile);
    console.log(`\n▶ Running ${testFile}...`);
    console.log('─'.repeat(60));

    const result = spawnSync('node', [testPath], {
        stdio: 'inherit',
        encoding: 'utf-8'
    });

    const passed = result.status === 0;
    results.push({ file: testFile, passed });

    if (!passed) {
        allPassed = false;
        console.log(`\n❌ ${testFile} FAILED (exit code: ${result.status})`);
    }
}

// Summary
console.log('\n');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║                    Test Summary                            ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

results.forEach(r => {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${r.file}`);
});

console.log('');
console.log('─'.repeat(60));

if (allPassed) {
    console.log('  🎉 All test suites passed!');
    console.log('─'.repeat(60));
    console.log('');
    process.exit(0);
} else {
    console.log('  ⚠️  Some tests failed!');
    console.log('─'.repeat(60));
    console.log('');
    process.exit(1);
}
