// @ts-check
/**
 * Offline regression for the evaluator itself — no app, no model.
 *
 * Runs the deterministic checks against the golden "Echoes of Doubt" fixture
 * (a run where the thread is known to have broken) and asserts the evaluator
 * catches the exact gaps we reverse-engineered from the rendered comic:
 *   - Commander Valerius and Sergeant Kael never reach the pages,
 *   - at least one scene beat is dropped,
 *   - the setup/payoff check is exercised.
 *
 * Run: `node e2e/eval/selftest.mjs`  (or `npm run eval:selftest`)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateContinuity, formatScorecard } from './continuity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'echoes-of-doubt.json'), 'utf8'));

const sc = evaluateContinuity(fixture);
console.log(formatScorecard(sc));
console.log('');

const failures = [];
const check = (id) => sc.checks.find((c) => c.id === id);

// 1. Character coverage must FAIL and name both dropped characters.
const cov = check('character-coverage');
if (cov.pass) failures.push('expected character-coverage to FAIL (Valerius & Kael are absent from the pages)');
for (const who of ['Valerius', 'Kael']) {
  if (!cov.summary.includes(who)) failures.push(`expected character-coverage to name the missing "${who}"`);
}
// Elias and Anya SHOULD be found — the check must not be a blanket fail.
for (const who of ['Elias', 'Anya']) {
  const line = cov.details.find((d) => d.startsWith(who));
  if (!line || line.includes('ABSENT')) failures.push(`expected "${who}" to be found in the pages`);
}

// 2. Beat coverage must FAIL (dropped beats) with at least one flagged beat.
const beat = check('beat-coverage');
if (beat.pass) failures.push('expected beat-coverage to FAIL (some Step-3 beats barely surface)');

// 3. Setup/payoff check must run and produce a score in [0,1].
const setup = check('setup-before-payoff');
if (!(setup.score >= 0 && setup.score <= 1)) failures.push('setup-before-payoff score out of range');

// 4. Sanity: the scorecard is not a perfect score (this run is a known-bad run).
if (sc.passed === sc.total) failures.push('expected the known-bad fixture to fail at least one check');

if (failures.length) {
  console.error('SELF-TEST FAILED:');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`SELF-TEST PASSED — evaluator flags the known gaps (${sc.passed}/${sc.total} checks passed on the bad run, as expected).`);
