// @ts-check
/**
 * The qualitative half of the report: an LLM-as-judge continuity rubric.
 *
 * The deterministic checks catch mechanical drops (a name that never appears, a
 * repeated line). This asks the model to read the whole run the way an editor
 * would and say WHAT important material was lost and, crucially, BETWEEN WHICH
 * STEPS. It is run against the same on-device model via window.__comicEval.chat,
 * so it needs no cloud.
 */

const JUDGE_SCHEMA = {
  name: 'continuity_judgement',
  schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: {
          characterThread: { type: 'integer' },
          setupPayoff: { type: 'integer' },
          beatFidelity: { type: 'integer' },
          locationVariety: { type: 'integer' },
        },
        required: ['characterThread', 'setupPayoff', 'beatFidelity', 'locationVariety'],
      },
      lost: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            detail: { type: 'string' },
            lostBetween: { type: 'string', enum: ['idea→characters', 'characters→beats', 'beats→pages', 'within-pages'] },
          },
          required: ['detail', 'lostBetween'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['scores', 'lost', 'summary'],
  },
};

/** Compact, readable dump of the run for the judge to read. */
function renderArtifacts(a) {
  const chars = (a.characters || [])
    .map((c) => `- ${c.name}: ${c.appearance || ''} (${c.traits || ''})`)
    .join('\n');
  const pages = (a.pages || [])
    .map((pg, i) => {
      const panels = (pg.panels || [])
        .map((p, j) => `   ${j + 1}. [${p.dialogueKind || 'speech'}] "${p.dialogue || ''}" — ${p.description || ''}`)
        .join('\n');
      return `PAGE ${i + 1} (layout ${pg.layout}):\n${panels}`;
    })
    .join('\n\n');
  return (
    `IDEA (refined logline): ${a.logline || a.rawIdea || ''}\n\n` +
    `CHARACTERS (Step 2):\n${chars}\n\n` +
    `SCENE BEATS (Step 3):\n${(a.beats || '').trim()}\n\n` +
    `PAGES (Step 4):\n${pages}`
  );
}

/**
 * Build the chat request for the judge.
 * @returns {{ messages: {role:string,content:string}[], options: object }}
 */
export function buildJudgeRequest(a) {
  const system =
    'You are a comics story editor auditing an AI pipeline that builds a comic in four steps: ' +
    '(1) idea → (2) characters → (3) scene beats → (4) pages/panels. Each step is supposed to carry ' +
    "ALL of the previous steps' important material forward. You are given the actual output of one run. " +
    'Judge how well the THREAD survived. Score each dimension 0–5 (5 = nothing lost): ' +
    'characterThread (does every defined character keep a role in the pages?), ' +
    'setupPayoff (are reveals on the last pages set up earlier?), ' +
    'beatFidelity (do the Step-3 beats actually appear in the pages?), ' +
    'locationVariety (does the story travel, or is it stuck in one place?). ' +
    'Then list each important piece of material that was LOST, and for each name the step boundary where it ' +
    'disappeared (idea→characters, characters→beats, beats→pages, or within-pages). Be specific and concrete; ' +
    'cite the character/beat/line. Do not praise; focus on what broke. ' +
    'Return ONLY JSON matching the schema.';
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: renderArtifacts(a) + '\n\nAudit this run. Return the judgement JSON.' },
    ],
    options: { temperature: 0.3, maxTokens: 1600, schema: JUDGE_SCHEMA },
  };
}

/** Tolerant parse of the judge's reply (handles stray prose / fences). */
export function parseJudge(raw) {
  if (!raw) return null;
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let obj = tryParse(raw);
  if (!obj) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) obj = tryParse(raw.slice(start, end + 1));
  }
  if (!obj) return null;
  return {
    scores: {
      characterThread: Number(obj?.scores?.characterThread ?? 0),
      setupPayoff: Number(obj?.scores?.setupPayoff ?? 0),
      beatFidelity: Number(obj?.scores?.beatFidelity ?? 0),
      locationVariety: Number(obj?.scores?.locationVariety ?? 0),
    },
    lost: Array.isArray(obj?.lost) ? obj.lost : [],
    summary: String(obj?.summary ?? '').trim(),
  };
}
