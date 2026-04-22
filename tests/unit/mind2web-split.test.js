/**
 * Tests for the Mind2Web website-hash-stratified dev/eval split.
 *
 * Two layers:
 *   1. Unit tests on buildSplit() with synthetic summaries (fast, deterministic).
 *   2. Committed-artifact tests that read data/mind2web-split.json and verify
 *      the real split satisfies the memo's gates. These do NOT regenerate —
 *      regeneration requires the 13GB corpus.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const splitter = require(path.resolve(__dirname, '../../scripts/mind2web-split.js'));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SPLIT_PATH = path.join(REPO_ROOT, 'data/mind2web-split.json');
const SUMMARIES_PATH = path.join(REPO_ROOT, 'data/mind2web-summaries.json');

// Synthetic fixture: 12 websites, varying task counts, primitive mixes.
function makeSyntheticSummaries() {
    const sites = [
        { website: 'alpha',   n_tasks: 20, prim: { button: 5, link: 3 } },
        { website: 'bravo',   n_tasks: 15, prim: { button: 4, link: 2, form_input: 6 } },
        { website: 'charlie', n_tasks:  8, prim: { link: 7, form_input: 1 } },
        { website: 'delta',   n_tasks: 25, prim: { button: 10, form_input: 3 } },
        { website: 'echo',    n_tasks:  5, prim: { heading: 2 } },
        { website: 'foxtrot', n_tasks: 12, prim: { button: 2, link: 4 } },
        { website: 'golf',    n_tasks: 18, prim: { link: 8, icon_image: 2 } },
        { website: 'hotel',   n_tasks: 10, prim: { form_input: 5 } },
        { website: 'india',   n_tasks:  6, prim: { button: 3 } },
        { website: 'juliet',  n_tasks: 22, prim: { button: 6, link: 6, form_input: 2 } },
        { website: 'kilo',    n_tasks: 11, prim: { button: 4, nav_item: 3 } },
        { website: 'lima',    n_tasks:  7, prim: { link: 3, form_input: 2 } },
    ];
    const out = [];
    let aid = 0;
    for (const s of sites) {
        for (let i = 0; i < s.n_tasks; i++) {
            const per_primitive = Object.fromEntries(
                Object.entries(s.prim).map(([k, v]) => [k, v])
            );
            const n_actions = Object.values(per_primitive).reduce((a, b) => a + b, 0);
            out.push({
                website: s.website,
                annotation_id: `syn-${(aid++).toString().padStart(4, '0')}`,
                domain: 'Test',
                n_actions,
                per_primitive,
            });
        }
    }
    return out;
}

describe('buildSplit — unit tests on synthetic corpus', () => {
    const summaries = makeSyntheticSummaries();
    const totalTasks = summaries.reduce((a, _) => a + 1, 0);

    it('dev/eval are disjoint (no website straddle)', () => {
        const split = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const devSet = new Set(split.dev_websites);
        for (const w of split.eval_websites) expect(devSet.has(w)).toBe(false);
    });

    it('every website is in exactly one of dev/eval', () => {
        const split = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const all = new Set([...split.dev_websites, ...split.eval_websites]);
        const sourceWebsites = new Set(summaries.map(s => s.website));
        expect(all).toEqual(sourceWebsites);
    });

    it('dev task fraction is within 5% of target', () => {
        // Tighter than integration test because synthetic data is balanced.
        const split = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const frac = split.stats.dev.tasks / split.stats.total.tasks;
        expect(Math.abs(frac - 0.3333)).toBeLessThan(0.05);
    });

    it('is deterministic for the same seed', () => {
        const s1 = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const s2 = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    });

    it('is invariant under task-order permutation', () => {
        const shuffled = [...summaries].reverse();
        const s1 = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const s2 = splitter.buildSplit(shuffled, { seed: 42, dev_fraction: 0.3333 });
        expect(s1.dev_websites).toEqual(s2.dev_websites);
        expect(s1.eval_websites).toEqual(s2.eval_websites);
    });

    it('produces a different split under a different seed', () => {
        const s42 = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        const s43 = splitter.buildSplit(summaries, { seed: 43, dev_fraction: 0.3333 });
        // Either the dev set differs or the order within a set differs.
        expect(s42.dev_websites).not.toEqual(s43.dev_websites);
    });

    it('stats tally matches source summaries', () => {
        const split = splitter.buildSplit(summaries, { seed: 42, dev_fraction: 0.3333 });
        expect(split.stats.total.tasks).toBe(totalTasks);
        const totalActions = summaries.reduce((a, s) => a + s.n_actions, 0);
        expect(split.stats.total.actions).toBe(totalActions);
    });
});

describe('primitive tag → bucket mapping', () => {
    const cases = [
        ['button', 'button'],
        ['a', 'link'], ['link', 'link'],
        ['textbox', 'form_input'], ['combobox', 'form_input'],
        ['checkbox', 'form_input'], ['searchbox', 'form_input'],
        ['input', 'form_input'], ['select', 'form_input'],
        ['img', 'icon_image'], ['svg', 'icon_image'], ['path', 'icon_image'],
        ['tab', 'nav_item'], ['menuitem', 'nav_item'],
        ['h1', 'heading'], ['heading', 'heading'],
        ['span', 'other'], ['div', 'other'], ['unknown', 'other'],
    ];
    for (const [tag, expected] of cases) {
        it(`${tag} → ${expected}`, () => {
            expect(splitter.mapTagToPrimitive(tag)).toBe(expected);
        });
    }
});

// Committed-artifact tests — verify data/mind2web-split.json satisfies the
// memo's gates. Skipped if the artifact is missing (e.g., on a fresh clone
// before the corpus has been processed).
const splitFileExists = fs.existsSync(SPLIT_PATH);
const describeIfSplit = splitFileExists ? describe : describe.skip;

describeIfSplit('committed data/mind2web-split.json', () => {
    let split;
    beforeAll(() => { split = JSON.parse(fs.readFileSync(SPLIT_PATH, 'utf-8')); });

    it('has no website straddle', () => {
        const devSet = new Set(split.dev_websites);
        for (const w of split.eval_websites) expect(devSet.has(w)).toBe(false);
    });

    it('dev + eval task count totals 1009', () => {
        expect(split.stats.dev.tasks + split.stats.eval.tasks).toBe(split.stats.total.tasks);
        expect(split.stats.total.tasks).toBe(1009);
    });

    it('dev task fraction is within 1% of 1/3', () => {
        const frac = split.stats.dev.tasks / split.stats.total.tasks;
        expect(Math.abs(frac - 0.3333)).toBeLessThan(0.01);
    });

    it('per-primitive dev N meets the bin-2 bootstrap gate (≥430 each)', () => {
        // Plan-agent Step 2 gate: per-primitive dev N ≥ 430 for button/link/form_input
        for (const p of splitter.PRIMARY_PRIMITIVES) {
            const n = split.stats.dev.per_primitive[p] || 0;
            expect(n).toBeGreaterThanOrEqual(430);
        }
    });

    it('frozen flag is false before Step 5 audit', () => {
        // frozen=true must not be set before the dev-run audit passes.
        expect(split.frozen).toBe(false);
    });

    it('config_hash_prefix matches current Arm-0 config', () => {
        const hasher = require(path.join(REPO_ROOT, 'scripts/mind2web-config-hash.js'));
        const cfg = hasher.loadConfig(path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json'));
        expect(split.config_hash_prefix).toBe(hasher.hashPrefix(cfg));
    });
});

// Summaries-artifact regression: if summaries.json changes shape, the split
// generator will silently produce a different split. This test catches that.
const summariesExists = fs.existsSync(SUMMARIES_PATH);
const describeIfSummaries = summariesExists ? describe : describe.skip;

describeIfSummaries('committed data/mind2web-summaries.json', () => {
    let summaries;
    beforeAll(() => { summaries = JSON.parse(fs.readFileSync(SUMMARIES_PATH, 'utf-8')); });

    it('has schema_version 1 and 1009 tasks', () => {
        expect(summaries.schema_version).toBe(1);
        expect(summaries.n_tasks).toBe(1009);
        expect(summaries.summaries.length).toBe(1009);
    });

    it('rebuilding split from summaries matches committed split', () => {
        const split = splitter.buildSplit(summaries.summaries, { seed: 42, dev_fraction: 0.3333 });
        const committed = JSON.parse(fs.readFileSync(SPLIT_PATH, 'utf-8'));
        expect(split.dev_websites).toEqual(committed.dev_websites);
        expect(split.eval_websites).toEqual(committed.eval_websites);
    });
});
