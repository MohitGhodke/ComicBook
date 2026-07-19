# Story-continuity eval

Measures how well a comic's **thread survives the wizard** — whether the material
in the idea, characters, and beats actually makes it into the pages, or leaks out
between steps (the recurring "we keep losing details" problem).

It's an **eval harness, not a pass/fail test**: the model is non-deterministic, so
the deliverable is a per-run **report**, and the continuity checks are recorded as
_soft_ expectations (they show red for tracking but don't abort the suite).

## What it does

1. Loads the real app (`ng serve`) and, through the dev-only `window.__comicEval`
   bridge, runs the **actual pipeline** (`ComicAssistant`) against your **local
   model** — the same code the wizard uses, mirroring its hand-off exactly
   (refined logline → characters → beats → pages).
2. Captures the artifact at each step.
3. Scores continuity two ways:
   - **Deterministic scorecard** (`eval/continuity.mjs`) — character coverage,
     beat coverage, setup-before-payoff, dialogue uniqueness, location travel,
     structural integrity.
   - **AI judge** (`eval/judge.mjs`) — the same on-device model rates the thread
     0–5 per dimension and lists what was lost **and between which steps**.
4. Writes `eval/reports/<timestamp>__<label>.{json,md}` and attaches them to the
   Playwright run.

## Run it

```bash
# one-time
npx playwright install chromium

# offline: prove the evaluator catches known gaps (no app, no model)
npm run eval:selftest

# full run against your local model (start the model server first)
EVAL_BASE_URL=http://192.168.0.228:1234 npm run eval
```

### Env knobs

| Var | Default | Meaning |
|---|---|---|
| `EVAL_IDEA` | the "Echoes of Doubt" idea | the Step-1 idea to run |
| `EVAL_PAGES` | `3` | page count (each page = many model calls; keep small) |
| `EVAL_BASE_URL` | app default | local OpenAI-compatible server URL |
| `EVAL_MODEL` | server's first model | model id to use |
| `EVAL_LABEL` | `echoes-of-doubt` | filename label for the report |

If no model server is reachable, the live test **skips** (with a message); the
offline self-test still runs.

## Files

- `story-continuity.spec.ts` — the Playwright driver.
- `eval/continuity.mjs` — deterministic checks (shared with the self-test).
- `eval/judge.mjs` — LLM-judge prompt + parser.
- `eval/report.mjs` — JSON + Markdown report writer.
- `eval/fixtures/echoes-of-doubt.json` — golden known-bad run for the self-test.
- `eval/selftest.mjs` — offline regression for the evaluator itself.
