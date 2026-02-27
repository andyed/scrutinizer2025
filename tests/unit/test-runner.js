/**
 * Minimal test runner using Node.js built-in assert.
 *
 * No external dependencies required. Run with:
 *   node tests/unit/test-runner.js
 *
 * Each suite file is registered via addSuite(). Results are printed
 * to stdout with pass/fail counts and a non-zero exit code on failure.
 */

const assert = require('assert');

let suites = [];
let currentSuite = null;
let passCount = 0;
let failCount = 0;

/**
 * Register a test suite (mirrors describe()).
 * @param {string} name - Suite name
 * @param {Function} fn  - Function that calls it() tests
 */
function describe(name, fn) {
    currentSuite = { name, tests: [] };
    suites.push(currentSuite);
    fn();
    currentSuite = null;
}

/**
 * Register a single test case (mirrors it()).
 * @param {string} name - Test case name
 * @param {Function} fn  - Test function (sync; throw = failure)
 */
function it(name, fn) {
    if (!currentSuite) throw new Error('it() called outside describe()');
    currentSuite.tests.push({ name, fn });
}

/**
 * Run all registered suites and print results.
 */
async function run() {
    for (const suite of suites) {
        console.log(`\n  ${suite.name}`);
        for (const test of suite.tests) {
            try {
                await test.fn();
                console.log(`    PASS  ${test.name}`);
                passCount++;
            } catch (err) {
                console.error(`    FAIL  ${test.name}`);
                // Indent the error message for readability
                const lines = (err.message || String(err)).split('\n');
                lines.forEach(l => console.error(`          ${l}`));
                failCount++;
            }
        }
    }

    const total = passCount + failCount;
    console.log(`\n  ${passCount}/${total} tests passed`);

    if (failCount > 0) {
        console.error(`  ${failCount} test(s) FAILED`);
        process.exitCode = 1;
    } else {
        console.log('  All tests passed.');
    }
}

module.exports = { describe, it, assert, run };
