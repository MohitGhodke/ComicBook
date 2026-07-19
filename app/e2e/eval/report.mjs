// @ts-check
/**
 * Turn one run (artifacts + deterministic scorecard + optional AI judgement)
 * into a durable report: a machine-readable JSON and a readable Markdown file,
 * plus a console summary. Written under e2e/eval/reports/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolved from the process CWD (the `app/` dir, whether run via `npm run eval`
// or `node`), which avoids `import.meta` — Playwright transpiles .mjs as CJS.
export const REPORTS_DIR = resolve('e2e/eval/reports');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function mdScorecard(sc) {
  const rows = sc.checks
    .map((c) => `| ${c.pass ? '✅' : '❌'} | ${c.label} | ${(c.score * 100).toFixed(0)}% | ${c.summary} |`)
    .join('\n');
  const details = sc.checks
    .filter((c) => c.details && c.details.length)
    .map((c) => `**${c.label}**\n${c.details.map((d) => `- ${d}`).join('\n')}`)
    .join('\n\n');
  return (
    `## Deterministic scorecard — ${sc.passed}/${sc.total} passed · weighted ${(sc.score * 100).toFixed(0)}%\n\n` +
    `| | Check | Score | Summary |\n|---|---|---|---|\n${rows}\n\n### Details\n\n${details}\n`
  );
}

function mdJudge(j) {
  if (!j) return '## AI judge\n\n_(skipped)_\n';
  const s = j.scores;
  const lost = j.lost.length
    ? j.lost.map((l) => `- **[${l.lostBetween}]** ${l.detail}`).join('\n')
    : '- _(none reported)_';
  return (
    `## AI judge (continuity rubric, /5)\n\n` +
    `| Character thread | Setup/payoff | Beat fidelity | Location variety |\n|---|---|---|---|\n` +
    `| ${s.characterThread} | ${s.setupPayoff} | ${s.beatFidelity} | ${s.locationVariety} |\n\n` +
    `**What was lost, and where:**\n\n${lost}\n\n> ${j.summary}\n`
  );
}

function mdArtifacts(a) {
  const chars = (a.characters || []).map((c) => `- **${c.name}** — ${c.appearance || ''} _(${c.traits || ''})_`).join('\n');
  const pages = (a.pages || [])
    .map((pg, i) => {
      const panels = (pg.panels || [])
        .map((p, j) => `  ${j + 1}. \`${p.dialogueKind || 'speech'}\` "${p.dialogue || ''}" — ${p.description || ''}`)
        .join('\n');
      return `**Page ${i + 1}** (\`${pg.layout}\`)\n${panels}`;
    })
    .join('\n\n');
  return (
    `## Captured run\n\n**Model:** \`${a.model || '(default)'}\` @ \`${a.baseUrl || ''}\`\n\n` +
    `**Idea (refined):** ${a.logline || a.rawIdea || ''}\n\n` +
    `### Characters (Step 2)\n${chars}\n\n### Scene beats (Step 3)\n\n\`\`\`\n${(a.beats || '').trim()}\n\`\`\`\n\n### Pages (Step 4)\n\n${pages}\n`
  );
}

/**
 * Write the JSON + Markdown report and return their paths + a console string.
 * @param {{ artifacts: object, scorecard: object, judge?: object|null, label?: string }} input
 */
export function writeReport({ artifacts, scorecard, judge = null, label = 'run' }) {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const base = `${stamp()}__${(label || 'run').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const jsonPath = join(REPORTS_DIR, `${base}.json`);
  const mdPath = join(REPORTS_DIR, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify({ artifacts, scorecard, judge }, null, 2));

  const md =
    `# Continuity report — ${artifacts.title || label}\n\n` +
    `_${new Date().toISOString()}_\n\n` +
    mdScorecard(scorecard) +
    '\n' +
    mdJudge(judge) +
    '\n' +
    mdArtifacts(artifacts);
  writeFileSync(mdPath, md);

  return { jsonPath, mdPath };
}
