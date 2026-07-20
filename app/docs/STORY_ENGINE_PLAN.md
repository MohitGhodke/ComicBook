# Story Engine Rework — the "Story Bible" source of truth

> Status: **planning complete, implementation starting**
> Owner: Comic Studio
> Clean slate: existing books can be discarded — **zero backward-compat required.**

---

## 1. The problem

Generated comics read as disconnected vignettes (see the harvest→goat-chase and
ruins→palace examples). Prompt tuning did not fix it because the failure is
**architectural, not textual**:

- The dramatic spine (`want / flaw / dramaticQuestion / climax / resolution /
  setups`) is **computed then discarded** — flattened into prose beats and never
  seen again by the page writer.
- Those beats become a **prose blob** (`synopsis`) that is later **regex-split
  back into a list** — structured → prose → structure, lossy at every hop.
- Every step re-invents the next layer from concatenated text. There is **no
  persistent, authoritative plan** constraining downstream generation, so the
  model drifts.
- There is **no locked world** (setting / era / palette), so the *art* drifts
  visually too, on top of the narrative drift.

## 2. The solution, in one sentence

Generate **one persistent, hierarchical JSON "Story Bible"** top-down from the
user's idea; every wizard step reads from it and writes exactly **one level
deeper**; downstream nodes may only **elaborate** their parent, never invent new
plot facts. The Bible is the single source of truth and the unit of
export/import.

## 3. Core principles

1. **Single source of truth.** One `StoryBible` per book, persisted to IndexedDB.
   The rendered pages/panels are a **projection** of it, not a parallel truth.
2. **Containment contract.** A child node may add *detail* (visuals, dialogue,
   camera) but never *new story facts*. Scene ⊆ spine; Section ⊆ scene; art ⊆
   section + locked world.
3. **Provenance on every AI-fillable field.** `{ value, source: 'user'|'ai',
   locked }`. Powers UI badges, safe regeneration, and honest export.
4. **Everything editable.** The wizard keeps its shape; every field (including
   AI-generated ones) is editable. Editing sets `source:'user'`, `locked:true`.
   Regeneration never clobbers locked fields; editing a parent soft-flags
   descendants as stale with an opt-in "regenerate downstream."
5. **Continuity is structural, not hoped-for.** Each scene carries `entryState`
   / `exitState` (location, time, who's present, props, mood, what the reader
   knows). **A scene's `entryState` must chain from the prior scene's
   `exitState`.** This makes the thread literal and checkable.
6. **Locked world = visual continuity.** `setting / era / tone / visualStyle`
   are pinned at the root and inherited by every art prompt.
7. **Portable by design.** The Bible serializes to a single JSON that
   reconstructs the book from scratch; already-generated images ride along
   embedded, ungenerated ones are regenerable from their stored prompts.

## 4. Data model (sketch — final names may shift slightly in code)

```ts
interface Authored<T> { value: T; source: 'user' | 'ai'; locked: boolean; }

interface StoryBible {
  schemaVersion: number;
  id: string;
  title: Authored<string>;
  createdAt: number; updatedAt: number;

  // ── Guided intake (Story Setup step) ──
  setup: {
    premise:   Authored<string>;   // the seed; the only "please provide" field
    characters:Authored<string>;   // freeform who's-in-it (expanded into `characters[]`)
    setting:   Authored<string>;   // where — world/place
    era:       Authored<string>;   // when — time period / timeline
    tone:      Authored<string>;   // feel — genre/mood
    storyline: Authored<string>;   // any plot the user already has
  };

  // ── Dramatic spine — PERSISTED now, not discarded ──
  spine: {
    logline:          Authored<string>;
    theme:            Authored<string>;
    dramaticQuestion: Authored<string>;
    climax:           Authored<string>;
    resolution:       Authored<string>;
    setups:           Authored<{ plant: string; payoff: string }[]>;
    visualStyle:      { palette: string; rendering: string; styleId: string };
  };

  characters: BibleCharacter[];
  scenes: Scene[];                 // each ≈ one page
}

interface BibleCharacter {
  id: string;
  name:       Authored<string>;
  appearance: Authored<string>;    // locked visual → art consistency
  traits:     Authored<string>;
  role:       Authored<string>;
  arc:        Authored<string>;
  referenceImageRef?: ImageRef;
}

interface ContinuityState {
  location: string; time: string;
  present: string[];               // character ids on stage
  props: Record<string, string>;   // e.g. { Arun: "curved sword + peacock feather" }
  mood: string;
  knowledge: string;               // what the reader now knows
}

interface Scene {                  // ≈ a page
  id: string;
  mapsToSetup?: string;            // which spine setup/beat this delivers
  goal: Authored<string>;
  conflict: Authored<string>;
  turn: Authored<string>;
  entryState: Authored<ContinuityState>;
  exitState:  Authored<ContinuityState>;   // must chain into next scene's entryState
  layout?: LayoutId;
  sections: Section[];             // each ≈ a panel
}

interface Section {                // ≈ a panel
  id: string;
  moment:     Authored<string>;    // what visibly happens
  cameraHint: Authored<string>;
  speaker:    Authored<string>;
  line:       Authored<string>;    // dialogue text (never a placeholder)
  dialogueKind: BubbleKind;
  artPrompt:  Authored<string>;    // self-contained brief, inherits locked world
  imageRef?:  ImageRef;            // optional; regenerable from artPrompt
  // carried over from the draggable-bubble feature:
  bubbleX?: number; bubbleY?: number; tailX?: number; tailY?: number; tailAngle?: number;
}
```

**Rendering:** a deterministic `bibleToReaderPages(bible)` replaces today's
`toReaderPages(book)` — scenes→pages, sections→panels — so the reader/flipbook
and live preview change minimally.

## 5. Generation pipeline (top-down, containment-enforced)

Each level reuses today's calls, **re-targeted to fill the Bible** and fed only
{ global spine (2 lines) + direct ancestors + neighbor summaries + running
state }:

| Level | Reuses | Produces | Containment guard |
|------|--------|----------|-------------------|
| Idea → Setup | `shapeIdea` (extended) | fills empty setup fields + title, `source:'ai'` | — |
| Setup → Spine | `planStorySpine` (now **persisted**) | `spine` incl. `visualStyle` | — |
| Spine → Characters | `planCharacters`/`describeCharacter` | `characters[]`, anchored to setting/era/tone | every character used later |
| Spine → Scenes | `planStoryboard` (reworked) | `scenes[]` with `entry/exitState` chaining, `mapsToSetup` | states chain; every setup covered; climax present |
| Scene → Sections | `planPage` | `sections[]` within one scene's state | one location/moment; no new facts |
| Section → Art | `describePanel` | `artPrompt` inheriting `visualStyle` + locked appearances + scene state | only what the section+world assert |

**Coverage/validation pass** between levels (deterministic + one light AI
critique): every parent element represented in children? any child inventing?
scene states chain? setups planted & paid? Drift is surfaced with a
"regenerate" affordance rather than silently shipped.

## 6. Wizard mapping (ONE wizard, upgraded in place)

> **Approach (decided):** there is only ever **one** interface — the existing
> `/create` wizard. We evolve it *in place* to be Bible-backed, step by step;
> we do NOT ship a second/parallel creator. The first parallel attempt (a
> `/studio` component) was removed to avoid confusion. Everything below is a
> description of steps *within that one wizard*.


- **Setup** (was "Idea"): 6 guided fields + coaching + explicit "Leave blank —
  AI will invent this." After submit, AI fills gaps; user reviews/edits; lock.
- **Characters:** AI-expanded from `setup.characters` + spine; editable cards.
- **Interactions/Scenes:** scene cards with goal/conflict/turn + state; editable.
- **Pages:** sections + layout + dialogue + art prompt; editable; art upload.
- **Finish:** covers, preview (reader over the projection), export.

Every step: AI-generated values shown with an "AI" badge, fully editable,
edits lock the field, and a parent edit offers "regenerate downstream."

## 7. Export / Import

- **Export:** serialize `StoryBible` to a single `*.comicbible.json`.
  Already-generated images are **embedded** (base64 data-URI `imageRef`s);
  ungenerated sections carry only their `artPrompt`. `schemaVersion` + stable
  node ids included. (Zip bundle is a possible future option if file size bites.)
- **Import:** validate `schemaVersion`, rehydrate embedded images into
  IndexedDB, rebuild the book. **Draft-aware:** an imported draft still lets the
  user generate the missing art from the stored prompts.

## 8. Milestones

Each milestone ends with a working, verifiable app (drive it, don't just typecheck).

- **M0 — Foundation.** `story-bible.model.ts` (types above); storage read/write
  for `StoryBible`; `bibleToReaderPages` projection; ability to clear old books.
  *Verify:* a hand-seeded Bible renders in the reader.
- **M1 — Guided intake + provenance.** Rework Idea → Story Setup (6 fields,
  coaching, "leave blank"); enrichment call fills gaps as `source:'ai'`; fields
  editable & lockable. *Verify:* sparse idea → AI fills setting/era/tone; edits stick.
- **M2 — Persistent spine + world lock.** `planStorySpine` → `spine` (+
  `visualStyle`), editable; wired as the global anchor. *Verify:* spine persists
  and appears in downstream prompts.
- **M3 — Characters in the Bible.** Anchored generation, provenance, editable,
  reference images. *Verify:* characters reflect setting/era; edits lock.
- **M4 — Scenes with continuity state (core fix).** Storyboard → scenes with
  `entry/exitState` chaining + `mapsToSetup`; coverage validation. *Verify:*
  regenerated story has scenes that visibly chain; states connect.
- **M5 — Sections + art prompts + dialogue-bug fix.** `planPage`/`describePanel`
  fill sections inheriting world+character+state; **fix degenerate `If… … …`
  dialogue** (non-empty, non-placeholder). *Verify:* consecutive panels connect;
  dialogue is real; art shares one world.
- **M6 — Editability & regeneration semantics.** Locked-aware regen;
  stale-descendant flagging; "regenerate downstream." *Verify:* edit a parent →
  children flagged, locked edits survive regen.
- **M7 — Coverage/validation hardening.** Cross-level drift checks surfaced with
  fixes. *Verify:* an intentionally broken chain is caught.
- **M8 — Export / Import.** Single-JSON export w/ embedded generated art;
  draft-aware import w/ image rehydration. *Verify:* export → wipe → import
  round-trips a book (art preserved where generated, regenerable otherwise).
- **M9 — End-to-end verification.** Regenerate a full story on the 20B model;
  confirm narrative + visual continuity; export/import; full editability.

## 9. Decisions log

- Intake fields: **premise, characters, setting, era, tone, storyline.** ✅
- Existing books: **discard, no migration.** ✅
- Export: **single JSON, embed already-generated images, regenerate the rest;
  draft imports remain art-generatable.** ✅
- Everything AI-generated is **editable**; wizard shape **unchanged**. ✅
- Sequencing: **under-the-hood source-of-truth first (M0–M5), then edit/regen
  polish, validation, and export/import (M6–M8).** ✅
- Interface: **ONE wizard, upgraded in place.** No parallel/beta creator — the
  removed `/studio` scaffold was a mistake. Evolve `/create` step by step. ✅

## 10. Known bugs & fixes

- **RESOLVED — degenerate `…` output was the primary garbage cause.** Strict
  `json_schema` grammar-constrained decoding made `gpt-oss-20b` emit ellipsis
  filler (`If… … …`, `setting: "......"`) instead of prose. Structured output is
  now **opt-in** (`AiConfig.structuredOutput`, default off); callers ask for JSON
  in the prompt and parse defensively. This alone dramatically improved quality.

## 11. Parked refinements (user-requested, address later)

These are confirmed wants to fold into the milestones below — **do not lose them**:

1. **Narration boxes, co-existing with speech in the SAME frame.** A panel must
   be able to show a narration caption AND a speech/thought line at once (today a
   panel carries a single `dialogueKind`). Requires: `Section` gains an optional
   `narration: Authored<string>` alongside `line`; the reader/preview render both
   a top caption box and a bubble in one panel; the dialogue generator may emit
   both. → **fold into M5** (sections/dialogue) + reader render.
2. **Scene-transition narration to orient the reader.** Continuity is holding,
   but on a page turn the location/time can jump with nothing to anchor the
   reader ("suddenly the character is elsewhere"). When a scene's `entryState`
   differs from the previous scene's `exitState`, panel 1 must carry an
   auto-generated narration caption naming the new place/time (e.g. "Two days
   later — the harbor."). → **fold into M4** (state chaining detects the jump) +
   **M5** (emit the bridging caption). This leans directly on #1's narration box.
