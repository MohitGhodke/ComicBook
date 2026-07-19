// @ts-check
/**
 * Deterministic "does the thread survive?" evaluator.
 *
 * Given the artifacts of one pipeline run (idea → characters → beats → pages),
 * it runs a handful of cheap, fully-repeatable checks that each encode one of
 * the continuity failures we keep seeing: a defined character vanishing from the
 * art, a scene beat getting dropped, an ending that pays off something the pages
 * never set up, the story never leaving one room, repeated lines.
 *
 * No model call here — this is the fast, objective half of the report. Pure
 * functions, no dependencies, so it also runs offline against a fixture.
 *
 * @typedef {{ name: string, appearance?: string, traits?: string }} EvalCharacter
 * @typedef {{ description?: string, dialogue?: string, dialogueKind?: string }} EvalPanel
 * @typedef {{ layout?: string, panels: EvalPanel[] }} EvalPage
 * @typedef {{ rawIdea?: string, title?: string, logline?: string, characters: EvalCharacter[], beats: string, pages: EvalPage[], model?: string, baseUrl?: string, pageCount?: number }} EvalArtifacts
 * @typedef {{ id: string, label: string, weight: number, pass: boolean, score: number, summary: string, details: string[] }} Check
 * @typedef {{ checks: Check[], passed: number, total: number, score: number }} Scorecard
 */

const PANEL_COUNT = { splash: 1, strip3: 3, grid4: 4, feature3: 3, six: 6 };

const STOPWORDS = new Set(
  ('the a an and or but of to in on at for with from into over under about as by is are was were be been being ' +
    'this that these those they them their there here then than when where while who whom whose which what how ' +
    'his her him she he it its our your my we you i not no yes will would could should must can may might do does ' +
    'did done have has had having just only even also very more most some any each other another such own same ' +
    'through between across around after before during against toward towards upon within without behind beside ' +
    'front back next last first one two three four five their theirs himself herself themselves').split(/\s+/),
);

const norm = (s) => (s || '').toLowerCase();
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';

/** Text a single page contributes (art briefs + spoken lines). */
function pageText(page) {
  return (page.panels || []).map((p) => `${p.description || ''} ${p.dialogue || ''}`).join(' ');
}

/** Mirror of the app's charactersNamedIn: full name, or a first name of length >= 3. */
function textNamesCharacter(text, name) {
  const hay = norm(text);
  const full = norm(name).trim();
  if (full && hay.includes(full)) return true;
  const first = norm(firstName(name));
  return first.length >= 3 && hay.includes(first);
}

/** Content tokens worth tracking: longer words minus stopwords, plus proper nouns. */
function sigTokens(text) {
  const out = new Set();
  const raw = text || '';
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z'-]+/g)) {
    const w = m[0];
    const lw = w.toLowerCase();
    const isProper = /^[A-Z]/.test(w) && w.length >= 4;
    if ((lw.length >= 5 || isProper) && !STOPWORDS.has(lw)) out.add(lw);
  }
  return out;
}

/** Split the Step-3 beats blob into individual beats. */
export function splitBeats(beats) {
  const t = (beats || '').trim();
  if (!t) return [];
  const numbered = t.split(/\n(?=\s*\d+[.)]\s)/).map((s) => s.trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered;
  const paras = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) return paras;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** CHECK 1 — every defined character appears in at least one drawn panel. */
/** @param {EvalArtifacts} a @returns {Check} */
function characterCoverage(a) {
  const cast = (a.characters || []).filter((c) => c.name && c.name.trim());
  const pages = a.pages || [];
  const details = [];
  const missing = [];
  for (const c of cast) {
    const hits = [];
    pages.forEach((pg, i) => {
      if (textNamesCharacter(pageText(pg), c.name)) hits.push(i + 1);
    });
    if (hits.length === 0) missing.push(c.name);
    details.push(`${c.name}: ${hits.length ? `pages ${hits.join(', ')}` : 'ABSENT from every panel'}`);
  }
  const score = cast.length ? (cast.length - missing.length) / cast.length : 1;
  return {
    id: 'character-coverage',
    label: 'Character coverage',
    weight: 0.25,
    pass: missing.length === 0,
    score,
    summary: missing.length
      ? `${missing.length}/${cast.length} defined characters never make it into a panel: ${missing.join(', ')}`
      : `all ${cast.length} defined characters appear in the pages`,
    details,
  };
}

/** CHECK 2 — every Step-3 beat leaves a fingerprint in the pages. */
/** @param {EvalArtifacts} a @returns {Check} */
function beatCoverage(a) {
  const beats = splitBeats(a.beats);
  const allText = (a.pages || []).map(pageText).join(' ');
  const pageTokens = sigTokens(allText);
  const details = [];
  const dropped = [];
  const REPRESENTED = 0.2; // fraction of a beat's distinctive tokens that must surface
  for (let i = 0; i < beats.length; i++) {
    const toks = [...sigTokens(beats[i])];
    if (!toks.length) continue;
    const matched = toks.filter((t) => pageTokens.has(t));
    const ratio = matched.length / toks.length;
    const ok = ratio >= REPRESENTED;
    if (!ok) dropped.push(i + 1);
    const preview = beats[i].replace(/\s+/g, ' ').slice(0, 70);
    details.push(`Beat ${i + 1} [${(ratio * 100).toFixed(0)}% surfaced]${ok ? '' : ' ← DROPPED'}: ${preview}…`);
  }
  const counted = details.length || 1;
  const score = (counted - dropped.length) / counted;
  return {
    id: 'beat-coverage',
    label: 'Beat coverage',
    weight: 0.25,
    pass: dropped.length === 0,
    score,
    summary: dropped.length
      ? `${dropped.length}/${counted} scene beats barely reach the pages (beats ${dropped.join(', ')})`
      : `all ${counted} scene beats surface in the pages`,
    details,
  };
}

/**
 * CHECK 3 — late reveals must be planted. A concept the STORY promised (it
 * appears in the idea or beats) should not first surface in the back half of the
 * book with nothing earlier: that is a payoff with no setup. We only judge
 * promised concepts, so incidental late vocabulary (a new prop in the climax)
 * doesn't count against the run.
 */
/** @param {EvalArtifacts} a @returns {Check} */
function setupBeforePayoff(a) {
  const pages = a.pages || [];
  const n = pages.length;
  if (n < 2) {
    return {
      id: 'setup-before-payoff',
      label: 'Setup before payoff',
      weight: 0.2,
      pass: true,
      score: 1,
      summary: 'too few pages to assess setup/payoff',
      details: [],
    };
  }
  // A concept is STORY-SIGNIFICANT (worth demanding a setup for) if it is named
  // in the premise, is a character, or recurs across the idea+beats. One-off set
  // dressing that only *can* appear at the climax (a "pedestal", a "guardian")
  // is not held to the setup/payoff rule — we're measuring craft, not vocabulary.
  const premise = sigTokens(`${a.logline || ''} ${a.rawIdea || ''}`);
  const charTokens = new Set();
  for (const c of a.characters || []) {
    for (const part of norm(c.name).split(/\s+/)) if (part.length >= 3) charTokens.add(part);
  }
  const counts = new Map();
  for (const m of `${a.logline || ''} ${a.rawIdea || ''} ${a.beats || ''}`.matchAll(/[A-Za-z][A-Za-z'-]+/g)) {
    const lw = m[0].toLowerCase();
    counts.set(lw, (counts.get(lw) || 0) + 1);
  }
  const significant = (t) => premise.has(t) || charTokens.has(t) || (counts.get(t) || 0) >= 2;
  const backHalfStart = Math.ceil(n / 2); // 0-based index where the back half begins
  const firstSeen = new Map();
  pages.forEach((pg, i) => {
    for (const t of sigTokens(pageText(pg))) if (!firstSeen.has(t)) firstSeen.set(t, i);
  });
  const present = [...firstSeen.keys()].filter(significant);
  const unplanted = present.filter((t) => firstSeen.get(t) >= backHalfStart);
  const details = unplanted.map(
    (t) => `"${t}" (promised by the idea/beats) first appears on page ${firstSeen.get(t) + 1} with no earlier setup`,
  );
  const score = present.length ? (present.length - unplanted.length) / present.length : 1;
  return {
    id: 'setup-before-payoff',
    label: 'Setup before payoff',
    weight: 0.2,
    pass: unplanted.length === 0,
    score,
    summary: unplanted.length
      ? `${unplanted.length} promised idea(s) pay off in the back half with no earlier setup: ${unplanted.join(', ')}`
      : 'promised ideas are all planted before the back half',
    details,
  };
}

/** CHECK 4 — no dialogue line is spoken twice. */
/** @param {EvalArtifacts} a @returns {Check} */
function dialogueUniqueness(a) {
  const seen = new Map();
  for (let i = 0; i < (a.pages || []).length; i++) {
    for (const p of a.pages[i].panels || []) {
      const line = (p.dialogue || '').trim();
      if (!line) continue;
      const key = line.toLowerCase();
      (seen.get(key) || seen.set(key, []).get(key)).push(i + 1);
    }
  }
  const dupes = [...seen.entries()].filter(([, pgs]) => pgs.length > 1);
  const total = [...seen.values()].length || 1;
  return {
    id: 'dialogue-uniqueness',
    label: 'Dialogue uniqueness',
    weight: 0.1,
    pass: dupes.length === 0,
    score: (total - dupes.length) / total,
    summary: dupes.length ? `${dupes.length} line(s) repeated across pages` : 'every line is spoken exactly once',
    details: dupes.map(([line, pgs]) => `"${line}" on pages ${pgs.join(', ')}`),
  };
}

/** CHECK 5 — the story physically travels (best-effort location estimate). */
/** @param {EvalArtifacts} a @returns {Check} */
function locationTravel(a) {
  const gaz =
    /\b(room|hall|corridor|tunnel|vault|chamber|street|city|rooftop|roof|alley|forest|desert|mountain|valley|bridge|dock|harbou?r|ship|ruins?|castle|wall|gate|camp|bunker|lab|office|kitchen|bar|market|field|cave|temple|station|platform|yard|basement|attic|garden|beach|river|cliff|prison|cell|arena|square|plaza|checkpoint|perimeter|outpost|sub-?level)\b/gi;
  const perPage = (a.pages || []).map((pg) => {
    const found = new Set();
    for (const m of pageText(pg).matchAll(gaz)) found.add(m[0].toLowerCase().replace(/-/g, ''));
    return found;
  });
  const distinct = new Set();
  for (const s of perPage) for (const loc of s) distinct.add(loc);
  const captions = (a.pages || []).reduce(
    (n, pg) => n + (pg.panels || []).filter((p) => p.dialogueKind === 'narration' && (p.dialogue || '').trim()).length,
    0,
  );
  const pageCount = (a.pages || []).length || 1;
  const need = Math.max(2, Math.ceil(pageCount / 2));
  const estimate = Math.max(distinct.size, captions);
  return {
    id: 'location-travel',
    label: 'Location travel',
    weight: 0.1,
    pass: estimate >= need,
    score: Math.min(1, estimate / need),
    summary: `~${distinct.size} distinct location word(s), ${captions} scene-change caption(s) across ${pageCount} pages (want ≥ ${need})`,
    details: [`locations seen: ${[...distinct].join(', ') || '(none detected)'}`],
  };
}

/** CHECK 6 — pages are structurally sound (panel counts match, no empty art). */
/** @param {EvalArtifacts} a @returns {Check} */
function structuralIntegrity(a) {
  const problems = [];
  (a.pages || []).forEach((pg, i) => {
    const want = PANEL_COUNT[pg.layout] ?? null;
    const got = (pg.panels || []).length;
    if (want !== null && got !== want) problems.push(`page ${i + 1}: layout "${pg.layout}" wants ${want} panels, has ${got}`);
    (pg.panels || []).forEach((p, j) => {
      if (!(p.description || '').trim()) problems.push(`page ${i + 1} panel ${j + 1}: empty art brief`);
    });
  });
  const totalPanels = (a.pages || []).reduce((n, pg) => n + (pg.panels || []).length, 0) || 1;
  return {
    id: 'structural-integrity',
    label: 'Structural integrity',
    weight: 0.1,
    pass: problems.length === 0,
    score: Math.max(0, (totalPanels - problems.length) / totalPanels),
    summary: problems.length ? `${problems.length} structural problem(s)` : 'all pages well-formed',
    details: problems,
  };
}

/**
 * Run every check and roll them into a weighted scorecard.
 * @param {EvalArtifacts} artifacts
 * @returns {Scorecard}
 */
export function evaluateContinuity(artifacts) {
  const checks = [
    characterCoverage(artifacts),
    beatCoverage(artifacts),
    setupBeforePayoff(artifacts),
    dialogueUniqueness(artifacts),
    locationTravel(artifacts),
    structuralIntegrity(artifacts),
  ];
  const passed = checks.filter((c) => c.pass).length;
  const wsum = checks.reduce((s, c) => s + c.weight, 0) || 1;
  const score = checks.reduce((s, c) => s + c.weight * c.score, 0) / wsum;
  return { checks, passed, total: checks.length, score };
}

/** Human-readable one-screen summary for the console. */
export function formatScorecard(sc) {
  const lines = [`CONTINUITY SCORECARD — ${sc.passed}/${sc.total} checks passed · weighted ${(sc.score * 100).toFixed(0)}%`, ''];
  for (const c of sc.checks) {
    lines.push(`${c.pass ? '✓ PASS' : '✗ FAIL'}  ${c.label} (${(c.score * 100).toFixed(0)}%) — ${c.summary}`);
    for (const d of c.details) lines.push(`         · ${d}`);
  }
  return lines.join('\n');
}
