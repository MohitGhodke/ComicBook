import { test, expect, type Page } from '@playwright/test';
// @ts-expect-error — plain ESM helpers, shared with the offline self-test.
import { evaluateContinuity, formatScorecard } from './eval/continuity.mjs';
// @ts-expect-error — plain ESM helper.
import { buildJudgeRequest, parseJudge } from './eval/judge.mjs';
// @ts-expect-error — plain ESM helper.
import { writeReport } from './eval/report.mjs';

/**
 * The shape the dev-only bridge exposes on window (see core/eval/eval-bridge.ts).
 */
interface ComicEval {
  run(idea: string, opts?: { pageCount?: number; baseUrl?: string; model?: string }): Promise<any>;
  chat(messages: { role: string; content: string }[], opts?: any): Promise<string>;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<string[]>;
}
declare global {
  interface Window {
    __comicEval?: ComicEval;
  }
}

// The golden case we reverse-engineered. Override with EVAL_IDEA / EVAL_PAGES.
const GOLDEN_IDEA =
  process.env.EVAL_IDEA ||
  "Haunted by the loss of his family and seeking redemption, Elias, an emotionally scarred former soldier, " +
    "infiltrates a secretive paramilitary group guarding a mystical relic. But when he gets close to proving their " +
    "corruption, he discovers the devastating truth: the enemy isn't external—it's the person he trusted most, " +
    "forcing him to confront not just the conspiracy, but his own broken loyalty and sense of reality.";
const PAGE_COUNT = Number(process.env.EVAL_PAGES || 3);
const BASE_URL = process.env.EVAL_BASE_URL || '';
const MODEL = process.env.EVAL_MODEL || '';
const LABEL = process.env.EVAL_LABEL || 'echoes-of-doubt';

async function waitForBridge(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__comicEval, null, { timeout: 30_000 });
}

test('story continuity — thread survives idea → characters → beats → pages', async ({ page }, testInfo) => {
  test.setTimeout(20 * 60 * 1000);
  await waitForBridge(page);

  // Point at the requested server/model up front so availability reflects it.
  if (BASE_URL) await page.evaluate((u) => localStorage.setItem('comic-studio-ai-url', u), BASE_URL);
  if (MODEL) await page.evaluate((m) => localStorage.setItem('comic-studio-ai-model', m), MODEL);

  const models = await page.evaluate(async () => {
    try {
      return await window.__comicEval!.listModels();
    } catch {
      return [] as string[];
    }
  });
  test.skip(models.length === 0, `No local model reachable${BASE_URL ? ` at ${BASE_URL}` : ''}. Start your server and set EVAL_BASE_URL.`);
  console.log(`\n[eval] model(s): ${models.join(', ')}  ·  pages: ${PAGE_COUNT}`);

  // ── Run the real pipeline, capturing every step's artifact ──────────────────
  const artifacts = await page.evaluate(
    ({ idea, pageCount, baseUrl, model }) =>
      window.__comicEval!.run(idea, { pageCount, baseUrl: baseUrl || undefined, model: model || undefined }),
    { idea: GOLDEN_IDEA, pageCount: PAGE_COUNT, baseUrl: BASE_URL, model: MODEL },
  );

  // Pipeline must actually have produced a full book.
  expect(artifacts.characters.length, 'expected characters from Step 2').toBeGreaterThan(0);
  expect(artifacts.pages.length, 'expected the requested number of pages').toBe(PAGE_COUNT);

  // ── Deterministic scorecard ─────────────────────────────────────────────────
  const scorecard = evaluateContinuity(artifacts);
  console.log('\n' + formatScorecard(scorecard) + '\n');

  // ── LLM-as-judge (same on-device model) ─────────────────────────────────────
  let judge: any = null;
  try {
    const { messages, options } = buildJudgeRequest(artifacts);
    const raw = await page.evaluate(
      ({ messages, options }) => window.__comicEval!.chat(messages, options),
      { messages, options },
    );
    judge = parseJudge(raw);
    if (judge) {
      console.log(
        `[judge] character:${judge.scores.characterThread}/5 setup:${judge.scores.setupPayoff}/5 ` +
          `beats:${judge.scores.beatFidelity}/5 location:${judge.scores.locationVariety}/5`,
      );
      for (const l of judge.lost) console.log(`  · [${l.lostBetween}] ${l.detail}`);
    }
  } catch (e) {
    console.warn('[judge] skipped:', (e as Error).message);
  }

  // ── Persist the report + attach to the Playwright run ───────────────────────
  const { jsonPath, mdPath } = writeReport({ artifacts, scorecard, judge, label: LABEL });
  console.log(`[eval] report: ${mdPath}`);
  await testInfo.attach('continuity-report.md', { path: mdPath, contentType: 'text/markdown' });
  await testInfo.attach('continuity-report.json', { path: jsonPath, contentType: 'application/json' });

  // Continuity findings are recorded as SOFT expectations: the report is the
  // deliverable, and one weak run shouldn't abort the suite — but every failed
  // check still shows up red in the Playwright output for tracking over time.
  for (const c of scorecard.checks) {
    expect.soft(c.pass, `${c.label}: ${c.summary}`).toBeTruthy();
  }
});
