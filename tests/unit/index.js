/**
 * Unit test entry point.
 *
 * Loads each test suite (which registers describe/it blocks via test-runner)
 * then calls run() to execute them all and print a summary.
 *
 * Usage:
 *   node tests/unit/index.js
 *
 * Exit code: 0 = all pass, 1 = any failures.
 */

'use strict';

const { run } = require('./test-runner');

// Each require() call registers test suites against the shared test-runner.
// The order here determines print order; test files are independent.
require('./oklab-utils.test.js');
require('./gestalt-processor.test.js');
require('./color-saliency-map.test.js');

// Run after all suites are registered.
run();
