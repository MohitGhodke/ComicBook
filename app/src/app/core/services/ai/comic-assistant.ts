import { Injectable, inject } from '@angular/core';
import { AiService } from './ai.service';
import { styleBlock } from '../../style/art-style';
import { ArtStyle } from '../../style/art-styles';
import { cleanDialogue } from '../../util/text';
import { BubbleKind, LayoutId } from '../../models/comic.model';
import { LAYOUTS, panelCountFor } from '../../models/layout';
import {
  StoryBible, Scene, Section, BibleCharacter, ContinuityState, SetupPair,
  STORY_BIBLE_SCHEMA_VERSION, userField, aiField, emptyField,
} from '../../models/story-bible.model';
import { newId } from '../../util/id';
import { timestamp } from '../../util/time';

/** The story so far — passed into every helper so each step builds on the last. */
export interface StoryContext {
  idea: string;
  /** The AI-refined logline. When present it DRIVES generation; `idea` stays as the raw seed. */
  premise?: string;
  characters: { name: string; appearance?: string; traits?: string }[];
  synopsis?: string;
  /** The story's world / place — kept in every prompt so nothing drifts out of it. */
  setting?: string;
  /** The time period / era. */
  era?: string;
  /** Genre + mood. */
  tone?: string;
}

export interface SuggestedCharacter {
  name: string;
  appearance: string;
  traits: string;
}

/** One slot from the character plan: who they are, before full design. */
export interface CharacterPlan {
  name: string;
  role: string;
}

/** Progress callback for the batched (plan → expand) character flow. */
export type CharacterProgress = (done: number, total: number, latest: SuggestedCharacter) => void;

/** Progress callback for the batched (plan → expand) storyboard flow. */
export type PageProgress = (done: number, total: number, latest: SuggestedPage) => void;

export interface SuggestedPanel {
  description: string;
  dialogue: string;
  dialogueKind: BubbleKind;
  /** Narration caption on the panel (scene premise / bridge / context). */
  narration: string;
  /** Who speaks the dialogue line (cast name). */
  speaker: string;
  /** The staging direction (shot/framing/juxtaposition) that drove the art brief. */
  staging?: string;
}

export interface SuggestedPage {
  /** The panel layout the AI chose for this page's moment. */
  layout: LayoutId;
  panels: SuggestedPanel[];
  /**
   * This page's scene written as narrative PROSE — the readable "good story" that
   * the dialogue and art briefs were derived from. Streamed alongside the page so
   * the "Read the full story" reading is available before the pages are even saved.
   */
  prose?: string;
}

export interface ShapedIdea {
  /** A short, evocative comic title suggested from the idea. */
  title: string;
  /** The refined premise/logline. */
  logline: string;
  /** The world/place the story happens in. */
  setting: string;
  /** The time period. */
  era: string;
  /** Genre + mood. */
  tone: string;
}

const SHAPED_IDEA_SCHEMA = {
  name: 'shaped_idea',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      logline: { type: 'string' },
      setting: { type: 'string' },
      era: { type: 'string' },
      tone: { type: 'string' },
    },
    required: ['title', 'logline', 'setting', 'era', 'tone'],
  },
};

/** Bounds for AI-suggested interior page counts (always an EVEN number in range). */
export const PAGE_COUNT_MIN = 4;
export const PAGE_COUNT_MAX = 30;

const PAGE_COUNT_SCHEMA = {
  name: 'page_count',
  schema: {
    type: 'object',
    properties: { pages: { type: 'integer' } },
    required: ['pages'],
  },
};

const CHARACTER_PLAN_SCHEMA = {
  name: 'character_plan',
  schema: {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
          },
          required: ['name', 'role'],
        },
      },
    },
    required: ['characters'],
  },
};

const ONE_CHARACTER_SCHEMA = {
  name: 'character',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      appearance: { type: 'string' },
      traits: { type: 'string' },
    },
    required: ['name', 'appearance', 'traits'],
  },
};

/** The dramatic architecture a chapter's beats must deliver (Step 3, pass A). */
interface StorySpine {
  want: string;
  flaw: string;
  dramaticQuestion: string;
  climax: string;
  resolution: string;
  setups: SetupPair[];
}

const STORY_SPINE_SCHEMA = {
  name: 'story_spine',
  schema: {
    type: 'object',
    properties: {
      want: { type: 'string' },
      flaw: { type: 'string' },
      dramaticQuestion: { type: 'string' },
      climax: { type: 'string' },
      resolution: { type: 'string' },
      setups: {
        type: 'array',
        items: {
          type: 'object',
          properties: { plant: { type: 'string' }, payoff: { type: 'string' } },
          required: ['plant', 'payoff'],
        },
      },
    },
    required: ['want', 'flaw', 'dramaticQuestion', 'climax', 'resolution', 'setups'],
  },
};

const STORYBOARD_PLAN_SCHEMA = {
  name: 'storyboard_plan',
  schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            characters: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'characters'],
        },
      },
    },
    required: ['pages'],
  },
};

/**
 * The VISUAL DIRECTION pass — the "adapt prose into a comic" step. AFTER the prose
 * and BEFORE any words, this decides how to TELL THE SCENE IN PICTURES: the shot
 * list. For each panel it fixes the frozen MOMENT, the one story point the image
 * must CONVEY on its own, and the STAGING (shot + framing + what shares the frame)
 * that makes the picture carry that meaning. The letterer and the art briefs then
 * SERVE this — so the images do the storytelling instead of illustrating captions.
 */
const STAGE_SCENE_SCHEMA = {
  name: 'scene_staging',
  schema: {
    type: 'object',
    properties: {
      // 'six' is intentionally omitted: six tiny panels leave no room for the art
      // once captions and dialogue are lettered on. Max 4 panels per page.
      layout: { type: 'string', enum: ['splash', 'strip3', 'grid4', 'feature3'] },
      // The one physical SET the whole page shares — the fixed geography (key
      // features and where characters stand) that every panel is drawn inside, so
      // the images read as one continuous space instead of a new room each frame.
      stage: { type: 'string' },
      panels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            moment: { type: 'string' },
            conveys: { type: 'string' },
            staging: { type: 'string' },
          },
          required: ['moment', 'conveys', 'staging'],
        },
      },
    },
    required: ['layout', 'stage', 'panels'],
  },
};

/**
 * The LETTERING pass — words for an already-staged page. Given each panel's staged
 * moment (what it shows / must convey), it adds ONLY the text the page needs:
 * gap-filler captions and real dialogue. It never re-decides the visuals.
 */
const PAGE_PLAN_SCHEMA = {
  name: 'page_lettering',
  schema: {
    type: 'object',
    properties: {
      panels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            narration: { type: 'string' },
            speaker: { type: 'string' },
            dialogue: { type: 'string' },
            dialogueKind: { type: 'string', enum: ['speech', 'thought', 'narration'] },
          },
          required: ['narration', 'speaker', 'dialogue', 'dialogueKind'],
        },
      },
    },
    required: ['panels'],
  },
};

/**
 * The continuity pass (one call per scene, BEFORE its panels are written). Given
 * where the previous scene ended and this scene's beat, it fixes the concrete,
 * physical world-state — the single place, the time, who is on stage, and the
 * CAUSAL link back to the previous scene. This is the anti-teleport anchor: it is
 * what stops an "inside the hut" scene from being drawn before the "let's go to
 * the hut" scene, and what pins every panel's art to one real location.
 */
const SCENE_STATE_SCHEMA = {
  name: 'scene_state',
  schema: {
    type: 'object',
    properties: {
      location: { type: 'string' },
      time: { type: 'string' },
      present: { type: 'array', items: { type: 'string' } },
      mood: { type: 'string' },
      continuesFrom: { type: 'string' },
      reveals: { type: 'string' },
    },
    required: ['location', 'time', 'present', 'continuesFrom', 'reveals'],
  },
};

/** One staged visual beat: how a panel TELLS the story in a picture, before words. */
interface StagedPanel {
  /** The frozen instant this frame captures. */
  moment: string;
  /** The one story point the reader must GRASP from this image alone. */
  conveys: string;
  /** Shot + framing + in-frame juxtaposition that makes the picture carry it. */
  staging: string;
}

/** A staged panel joined with its lettering — the full plan handed to the art brief. */
interface PanelPlanSlot extends StagedPanel {
  dialogue: string;
  dialogueKind: BubbleKind;
  /** Narration caption for the panel (a gap-filler; the image carries the story). */
  narration: string;
  /** Who speaks the dialogue line (cast name). */
  speaker: string;
}

/**
 * One planned page: its one-line summary plus the cast expected to appear on it.
 * The characters list is what makes the "every character reaches a panel"
 * guarantee possible — it flows from the storyboard plan into each page's script.
 */
interface PageBeat {
  summary: string;
  characters: string[];
}

/**
 * Rolling memory of what earlier pages ACTUALLY wrote (not just planned).
 * Passed into every subsequent page so a small model physically cannot
 * re-stage the same shot, re-say the same line, or pick the same layout
 * page after page — the three failure modes of writing pages blind.
 */
interface StoryboardMemory {
  /** Layouts already chosen, in page order. */
  layouts: LayoutId[];
  /** Every dialogue line already spoken anywhere in the book. */
  lines: string[];
  /** The final panel image of the previous page — the moment to CONTINUE from. */
  lastImage: string;
  /**
   * The previous page's one-line story summary — the narrative thread this page
   * must pick up. Without it, each page only knows what NOT to repeat, never
   * what to continue, and the book reads as disconnected scenes.
   */
  prevSummary: string;
  /**
   * Cast names the reader has already MET, in order of first appearance. A
   * character NOT in this list is a newcomer on the page that introduces them —
   * and their entrance must be set up, not sprung (the "who is this?" problem).
   */
  introduced: string[];
}

/** Model sometimes leaks the dialogueKind enum (or a "none" filler) into the dialogue field. */
const DIALOGUE_JUNK = /^(speech|thought|narration|none|n\/?a|empty|null|silence|silent|no dialogue\.?|\.{3}|…)$/i;

function validLayout(v: any): LayoutId {
  return LAYOUTS.some((l) => l.id === v) ? (v as LayoutId) : 'strip3';
}

function validBubbleKind(v: any): BubbleKind {
  return v === 'thought' || v === 'narration' ? v : 'speech';
}

/**
 * A distinct dramatic FUNCTION for each page, sized to the page count. Assigning
 * every page a DIFFERENT job is the reliable way to stop a small model from
 * writing the same beat N times — each page is forced to do something the others
 * don't (setup ≠ inciting incident ≠ climax ≠ resolution).
 */
function beatFunctions(count: number): string[] {
  if (count <= 1) return ['the ENTIRE story in one page — setup, turn and payoff'];
  if (count === 2)
    return [
      'SETUP + INCITING INCIDENT: introduce who and where, then the event that kicks off the story',
      'CLIMAX + RESOLUTION: the peak moment and how it ends',
    ];
  if (count === 3)
    return [
      'SETUP: introduce the protagonist, the place, and their normal situation',
      'TURN: the central conflict erupts and forces a choice',
      'RESOLUTION: the outcome — how it ends and what has changed',
    ];
  const fns = [
    'SETUP: introduce the protagonist, the place, and their normal world',
    'INCITING INCIDENT: the event that disrupts the normal world and starts the story',
  ];
  const middle = count - 4;
  for (let i = 0; i < middle; i++) {
    fns.push(
      `RISING ACTION ${i + 1}: a NEW development — a different moment, place or obstacle that raises the stakes ` +
        `(must NOT repeat an earlier page)`,
    );
  }
  fns.push('CLIMAX: the peak confrontation or turning point the whole story has been building toward');
  fns.push('RESOLUTION: the aftermath — how it ends and how things have CHANGED since page 1');
  return fns;
}

/**
 * High-level, provider-agnostic comic-writing helpers. Prompt engineering lives
 * here once; it works against whatever {@link AiService} is wired in (local
 * server today, WebLLM or Electron-native later).
 *
 * Every task receives the accumulated {@link StoryContext} so the steps stay
 * connected: characters are inferred from the idea, beats from the characters,
 * pages from the beats. The chain is what makes a coherent comic at the end.
 */
@Injectable({ providedIn: 'root' })
export class ComicAssistant {
  private ai = inject(AiService);

  isAvailable(): Promise<boolean> {
    return this.ai.isAvailable();
  }

  listModels(): Promise<string[]> {
    return this.ai.listModels();
  }

  // ── Step 1: Idea — refine the premise AND develop the world in one pass ──────
  /**
   * Refine a rough idea into a polished logline, propose a comic title, and
   * develop the world it happens in (setting / era / tone) — all in one call,
   * since they're one coherent decision, not three separate ones. Any
   * setting/era/tone the writer already typed is kept as-is and everything
   * else is built around it; the caller applies proposed world fields only to
   * whichever the user left blank, preserving authored input.
   */
  async shapeIdea(
    rough: string,
    existingWorld?: { setting?: string; era?: string; tone?: string },
    signal?: AbortSignal,
  ): Promise<ShapedIdea> {
    const system =
      'You are a comic book story editor. From the user\'s rough idea, do three things, all part of ONE coherent ' +
      'story: (1) rewrite it into a single vivid logline — 2–3 sentences covering the protagonist, what they want, ' +
      'the central conflict, the stakes, and the tone; (2) propose a short, evocative comic book title (2 to 5 ' +
      'words, no subtitle, no quotation marks); (3) propose the world it happens in — SETTING (the place/world), ' +
      'ERA (the time period), and TONE (genre + mood) — all clearly belonging together and consistent with the ' +
      'logline. If the writer already gave a setting/era/tone, keep it exactly as given and build the rest around ' +
      'it — never contradict a provided value. Return ONLY a JSON object of the form ' +
      '{"title":"","logline":"","setting":"","era":"","tone":""}.';
    const provided = (label: string, v: string | undefined) =>
      `${label}: ${v?.trim() ? v.trim() : '— (not given — you invent it)'}`;
    const user =
      rough.trim() +
      '\n\n' +
      [
        provided('Existing setting', existingWorld?.setting),
        provided('Existing era', existingWorld?.era),
        provided('Existing tone', existingWorld?.tone),
      ].join('\n');
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 1200, schema: SHAPED_IDEA_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const str = (v: any) => String(v ?? '').trim();
    return {
      title: str(parsed?.title),
      logline: str(parsed?.logline),
      setting: str(parsed?.setting),
      era: str(parsed?.era),
      tone: str(parsed?.tone),
    };
  }

  // ── Step 2: Characters — batched "plan → expand" for small-model reliability ──
  /**
   * Suggest characters in two phases so a small local model stays accurate:
   *   1. plan — decide WHO is in the story and HOW MANY (honours explicit counts
   *      in the idea, e.g. "six colleagues" → six).
   *   2. expand — one focused call per character for a rich, detailed design.
   * `onProgress` fires after each character so the UI can fill them in one by one.
   */
  async suggestCharacters(
    ctx: StoryContext,
    onProgress?: CharacterProgress,
    signal?: AbortSignal,
  ): Promise<SuggestedCharacter[]> {
    const plan = await this.planCharacters(ctx, signal);
    const out: SuggestedCharacter[] = [];
    for (let i = 0; i < plan.length; i++) {
      const full = await this.describeCharacter(ctx, plan[i], signal);
      out.push(full);
      onProgress?.(i + 1, plan.length, full);
    }
    return out;
  }

  /** Phase 1: who's in the story and how many — small, reliable output. */
  async planCharacters(ctx: StoryContext, signal?: AbortSignal): Promise<CharacterPlan[]> {
    const existing = ctx.characters.map((c) => c.name).filter(Boolean);
    const system =
      'You are a comic book story editor. Read the idea and list the characters the story needs — ' +
      'including anyone implied by it (for example, a person the idea says did something). ' +
      'IMPORTANT: if the idea states or clearly implies a specific number of characters (e.g. "six colleagues", ' +
      '"a pair of rivals", "three sisters"), return EXACTLY that many. Otherwise pick a sensible number (2 to 6). ' +
      'For each, give a name and a short one-line role. Do NOT repeat characters already listed. ' +
      'Return ONLY a JSON object of the form {"characters":[{"name":"","role":""}]}.';
    const user =
      this.contextBlock(ctx) +
      (existing.length ? `\n\nAlready created (do not repeat): ${existing.join(', ')}` : '') +
      '\n\nList the characters as JSON.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.6, maxTokens: 900, schema: CHARACTER_PLAN_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.characters) ? parsed.characters : [];
    return list
      .map((c: any) => ({ name: String(c?.name ?? '').trim(), role: String(c?.role ?? '').trim() }))
      .filter((c: CharacterPlan) => c.name.length > 0);
  }

  /** Phase 2: fully design ONE character — a focused call for higher quality. */
  async describeCharacter(ctx: StoryContext, plan: CharacterPlan, signal?: AbortSignal): Promise<SuggestedCharacter> {
    const system =
      'You are a comic book character designer. Given the story and ONE character, write a rich design for that ' +
      'character: appearance (one vivid sentence — age, build, clothing, distinctive features) and traits ' +
      '(one sentence — personality, role, and what drives them). Keep them consistent with the story. ' +
      'Return ONLY a JSON object of the form {"name":"","appearance":"","traits":""}.';
    const user =
      this.contextBlock(ctx) +
      `\n\nCHARACTER: ${plan.name}${plan.role ? ` — ${plan.role}` : ''}\n\nDesign this character as JSON.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 700, schema: ONE_CHARACTER_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    return {
      name: String(parsed?.name ?? '').trim() || plan.name,
      appearance: String(parsed?.appearance ?? '').trim(),
      traits: String(parsed?.traits ?? '').trim() || plan.role,
    };
  }

  // ── Step 3: Interactions — structure-first so the beats have real craft ──────
  /**
   * Write the scene beats in two passes, because a good story is architecture the
   * user can't supply and the model must:
   *   A. {@link planStorySpine} — decide the dramatic structure FIRST: the
   *      protagonist's want and flaw, the dramatic question, the climax, the
   *      resolution, and the plant→payoff pairs (what must be set up early so the
   *      ending lands).
   *   B. {@link writeBeatsFromSpine} — write the beats FROM that spine, so every
   *      payoff is planted earlier and emotional stakes are earned before they're
   *      exploited. This is what makes "setup before payoff" hold.
   */
  async draftInteractions(ctx: StoryContext, signal?: AbortSignal): Promise<string> {
    const spine = await this.planStorySpine(ctx, signal);
    return this.writeBeatsFromSpine(ctx, spine, signal);
  }

  /** Pass A — the dramatic architecture the beats must deliver. */
  private async planStorySpine(ctx: StoryContext, signal?: AbortSignal): Promise<StorySpine> {
    const system =
      'You are a comic book STORY EDITOR. The writer has an idea and characters but needs YOU to supply the ' +
      'dramatic craft. Before any scenes exist, define the story architecture: ' +
      'want (what the protagonist is after), flaw (the inner wound or blind spot that makes it hard), ' +
      'dramaticQuestion (the single suspense question the whole story answers), ' +
      'climax (the peak turn that answers it), resolution (how it ends and what has CHANGED in the protagonist). ' +
      'Then list 2 to 4 SETUPS: each is something PLANTED early so a later moment lands. For each, give the ' +
      '"plant" (what the reader sees/learns early) and the "payoff" (the later moment it makes land). Any twist, ' +
      'betrayal, or emotional blow in this story MUST have a setup here — nothing important may come from nowhere. ' +
      'Return ONLY JSON matching the schema.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + '\n\nDefine the story architecture as JSON.' },
      ],
      { temperature: 0.6, maxTokens: 1200, schema: STORY_SPINE_SCHEMA, signal },
    );
    const p = parseJsonObject(raw);
    const str = (v: any) => String(v ?? '').trim();
    return {
      want: str(p?.want),
      flaw: str(p?.flaw),
      dramaticQuestion: str(p?.dramaticQuestion),
      climax: str(p?.climax),
      resolution: str(p?.resolution),
      setups: Array.isArray(p?.setups)
        ? p.setups.map((s: any) => ({ plant: str(s?.plant), payoff: str(s?.payoff) })).filter((s: SetupPair) => s.plant || s.payoff)
        : [],
    };
  }

  /** Pass B — write the beats FROM the spine, planting every payoff first. */
  private async writeBeatsFromSpine(ctx: StoryContext, spine: StorySpine, signal?: AbortSignal): Promise<string> {
    const arch = [
      spine.want && `- Protagonist wants: ${spine.want}`,
      spine.flaw && `- Inner flaw/wound: ${spine.flaw}`,
      spine.dramaticQuestion && `- Dramatic question: ${spine.dramaticQuestion}`,
      spine.climax && `- Climax: ${spine.climax}`,
      spine.resolution && `- Resolution / what changes: ${spine.resolution}`,
      spine.setups.length &&
        `- Setups to PLANT early and PAY OFF later:\n${spine.setups
          .map((s, i) => `   ${i + 1}. PLANT: ${s.plant}  →  PAYOFF: ${s.payoff}`)
          .join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n');
    const system =
      'You are a comic book story editor writing the scene beats for one chapter, working from a story ' +
      'architecture you were given. Write 4 to 7 concrete beats as a numbered list. CRAFT RULES (non-negotiable): ' +
      '(1) the opening beat(s) establish the protagonist\'s normal world, their want and flaw, and PLANT every ' +
      'listed setup — the reader must SEE each plant before its payoff; ' +
      '(2) any emotional stake or loss must be ESTABLISHED in an early beat before a later beat exploits it; ' +
      '(3) each beat is CAUSED by the one before it — rising tension, not a list of events; ' +
      '(4) a late beat delivers the CLIMAX (the payoff of the dramatic question), and every payoff points back to ' +
      'an earlier plant; (5) the final beat shows the RESOLUTION — what has changed since the start.\n' +
      'Keep the staging vivid: beats are SCENES that TRAVEL — start each by naming where/when, and move through ' +
      'DIFFERENT locations and times; never trap the whole chapter in one room. ' +
      'Weave the setups in INVISIBLY, as natural story — do NOT annotate them: never write the words "PLANT", ' +
      '"PAYOFF", "SETUP", or any label/parenthetical marking craft. ' +
      'Return ONLY the numbered beats — no preamble, no headings, no labels.';
    const user =
      this.contextBlock(ctx) +
      (arch ? `\n\nSTORY ARCHITECTURE (deliver ALL of this through the beats):\n${arch}` : '') +
      '\n\nWrite the scene beats now.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 1400, signal },
    );
    // Safety net: strip any craft scaffolding the model leaked into the prose,
    // so the author never sees "(PLANT 1)" style labels in their beats.
    return stripCraftLabels(raw);
  }

  // ── Step 4: Pages — how long should the book be? ─────────────────────────────
  /**
   * Let the editor size the book to the STORY: enough pages to tell it completely
   * and at a good pace — never cut short, never padded. Returns an EVEN interior
   * page count in [MIN, MAX] (even so the book pairs into spreads and carries its
   * own front + back cover).
   */
  async suggestPageCount(ctx: StoryContext, signal?: AbortSignal): Promise<number> {
    const system =
      'You are a comic book editor deciding the LENGTH of a comic. From the story below, decide how many interior ' +
      'comic PAGES it needs to be told COMPLETELY and at a TIGHT, fast pace — every important beat gets room to land, ' +
      'but nothing is padded, stretched, or repeated. A tight comic that moves is ALWAYS better than a long one that ' +
      'sags and gets boring; when in doubt, choose FEWER pages. HEURISTIC: roughly ONE page per distinct beat the ' +
      'story actually has. Count the real beats (use the STORY BEATS if given). A single-scene incident is 4–6 pages; ' +
      'a typical short story is 8–10 pages; only a genuinely large story with many locations and turns goes past 12, ' +
      'and only a sprawling epic approaches 30. Do NOT default to a big number, and NEVER pad a simple story just to ' +
      'feel "complete". The number MUST be EVEN. ' +
      `Reply with ONLY a JSON object {"pages": N} where N is an even integer between ${PAGE_COUNT_MIN} and ${PAGE_COUNT_MAX}.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + '\n\nHow many pages does this story need? Return the JSON.' },
      ],
      { temperature: 0.4, maxTokens: 500, schema: PAGE_COUNT_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    let n = Number(parsed?.pages);
    if (!Number.isFinite(n)) {
      const m = String(raw).match(/\d+/); // fall back to the first number in the reply
      n = m ? Number(m[0]) : 6;
    }
    n = Math.round(n);
    n = Math.min(PAGE_COUNT_MAX, Math.max(PAGE_COUNT_MIN, n));
    if (n % 2 !== 0) n += 1; // even — the book pairs into spreads
    return Math.min(PAGE_COUNT_MAX, n);
  }

  // ── Step 4: Pages — batched "plan → expand", same as characters ──────────────
  /**
   * Storyboard as a stream of pages. Thin wrapper over {@link generateScenes} —
   * the SAME state-driven engine the Story Bible uses — so the eval/preview path
   * gets identical continuity guarantees. `onProgress` streams pages one at a time.
   */
  async storyboardPages(
    ctx: StoryContext,
    count: number,
    onProgress?: PageProgress,
    signal?: AbortSignal,
  ): Promise<SuggestedPage[]> {
    const { pages } = await this.generateScenes(ctx, count, onProgress, signal);
    return pages;
  }

  /**
   * Compose the whole story as ONE {@link StoryBible} JSON — the single source of
   * truth that DRIVES generation (not a record written after the fact). Every
   * level is generated top-down from the same tree so the story stays one thread
   * and the cast stays locked:
   *   world + locked cast (from ctx) → spine → scenes (each with a real, chained
   *   continuity state) → sections (panels) → art briefs.
   *
   * The scene continuity state is computed BEFORE each scene's panels and feeds
   * into both the script and the art briefs, so pages physically chain instead of
   * teleporting. Streams each finished scene as a page via `onProgress` for the
   * live preview; the returned bible is persisted and projected to the reader.
   */
  async composeStoryBible(
    ctx: StoryContext,
    count: number,
    onProgress?: PageProgress,
    signal?: AbortSignal,
  ): Promise<StoryBible> {
    const { scenes, spine } = await this.generateScenes(ctx, count, onProgress, signal);
    return assembleBible(ctx, spine, scenes);
  }

  /**
   * The one state-driven generation engine both public entry points use. It makes
   * the Story Bible the DRIVER of generation:
   *   1. spine — the dramatic architecture (captured in the bible, not discarded).
   *   2. beats — the scene outline, distributed from the author's beats.
   *   3. per scene, IN CAUSAL ORDER:
   *        a. {@link planSceneState} fixes the concrete continuity (where/when/who
   *           + the causal link from the previous scene's exit) FIRST;
   *        b. {@link writePage} scripts and draws the scene INSIDE that state, so
   *           the panels can't drift out of the location or jump ahead of the
   *           story;
   *        c. the scene records its real entry/exit state, and the next scene
   *           chains from this one's exit.
   * Returns the projected pages (for the preview/eval) alongside the scenes and
   * spine (for the bible) — one generation, two shapes of the same result.
   */
  private async generateScenes(
    ctx: StoryContext,
    count: number,
    onProgress?: PageProgress,
    signal?: AbortSignal,
  ): Promise<{ pages: SuggestedPage[]; scenes: Scene[]; spine: StorySpine }> {
    const spine = await this.planStorySpine(ctx, signal);
    const beats = await this.planStoryboard(ctx, count, signal);
    const memory: StoryboardMemory = { layouts: [], lines: [], lastImage: '', prevSummary: '', introduced: [] };
    const pages: SuggestedPage[] = [];
    const scenes: Scene[] = [];
    // The continuity chain: each scene's entry is derived from the previous
    // scene's exit, so the world can never teleport between pages.
    let prevExit = emptyState();
    // The prose chain: each scene's prose continues from the last one's, so the
    // "good story" layer reads as one connected narrative, not disjoint beats.
    let prevProse = '';
    // EVERY per-scene call is individually resilient. A local runtime hiccup
    // (e.g. LM Studio's intermittent gpt-oss "Channel Error") on any one call
    // must NOT abort the whole book — the scene degrades to a sensible fallback
    // and generation keeps going in the background. Only a real cancel stops it.
    const rethrowIfAbort = (e: any) => {
      if (e?.name === 'AbortError' || signal?.aborted) throw e;
    };
    for (let i = 0; i < beats.length; i++) {
      // 1. Continuity — fall back to carrying the previous scene's state forward.
      let state: { entry: ContinuityState; exit: ContinuityState };
      try {
        state = await this.planSceneState(ctx, beats, i, prevExit, signal);
      } catch (e) {
        rethrowIfAbort(e);
        state = { entry: prevExit, exit: prevExit };
      }
      // 2. Prose — the quality anchor the dialogue and art briefs derive from.
      //    On failure, degrade to summary-driven generation (empty prose).
      let prose = '';
      try {
        prose = await this.writeSceneProse(ctx, beats, i, state.entry, prevProse, signal);
      } catch (e) {
        rethrowIfAbort(e);
        prose = '';
      }
      // 3. The page script itself — on failure, emit a minimal one-panel page
      //    from the beat/prose so the book still completes and stays editable.
      let page: SuggestedPage;
      try {
        page = await this.writePage(ctx, beats, i, memory, state.entry, prose, signal);
      } catch (e) {
        rethrowIfAbort(e);
        page = fallbackPage(beats[i], prose);
      }
      page.prose = prose;
      memory.layouts.push(page.layout);
      for (const p of page.panels) if (p.dialogue) memory.lines.push(p.dialogue);
      const last = page.panels[page.panels.length - 1];
      if (last?.description) memory.lastImage = last.description;
      memory.prevSummary = beats[i]?.summary ?? '';
      pages.push(page);
      scenes.push(beatToScene(beats[i], page, state, prose));
      prevExit = state.exit;
      prevProse = prose;
      onProgress?.(i + 1, beats.length, page);
    }
    return { pages, scenes, spine };
  }

  /**
   * The PROSE pass for ONE scene — the quality anchor. BEFORE any panel is
   * scripted or drawn, write the scene as vivid narrative prose the way a
   * novelist would: the concrete action, what the characters do and notice, and
   * the emotional turn it delivers. It is grounded in the pre-computed continuity
   * state (so it can't wander out of the location/time) and chained from the
   * previous scene's prose (so the book reads as one story). Both the dialogue
   * script ({@link planPage}) and the art briefs ({@link describePanel}) are then
   * DERIVED from this — the root fix for generic dialogue and wonky scene
   * descriptions, since they now inherit the specificity of real prose.
   */
  private async writeSceneProse(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    entry: ContinuityState,
    prevProse: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const summary = beats[pageIdx]?.summary ?? '';
    const total = beats.length;
    const isFirst = pageIdx === 0;
    const isLast = pageIdx === total - 1;
    const job = isFirst
      ? 'OPEN the story: establish the place, the mood, and the character(s) in their normal world before anything turns.'
      : isLast
        ? 'CLOSE the story: deliver the final turn and show what has CHANGED since the beginning.'
        : 'ADVANCE the story: this scene is the direct consequence of the one before it and pushes toward the climax.';
    const system =
      'You are an acclaimed graphic-novel writer drafting ONE scene of a comic as NARRATIVE PROSE — the polished ' +
      'story a reader would love, not a list of shots. Write 3 to 5 sentences of vivid, specific prose in the ' +
      'PRESENT TENSE that tell what happens in THIS scene: the concrete action, what the characters do and notice, ' +
      'and the emotional turn the scene delivers. Ground every sentence in the fixed continuity you are given — do ' +
      'NOT relocate the scene, change its time, or add characters who are not on stage. Write with restraint and ' +
      'specificity: concrete sensory detail and real stakes, NO purple filler, NO clichés, NO meta-language about ' +
      'panels, pages, or cameras. This is the STORY itself. Return ONLY the prose paragraph — no heading, no label, ' +
      'no quotation marks.';
    const stateBlock =
      '\n\nSCENE CONTINUITY (obey exactly):\n' +
      `- LOCATION: ${entry.location || summary}\n` +
      (entry.time ? `- TIME: ${entry.time}\n` : '') +
      (entry.present.length ? `- ON STAGE (only these characters): ${entry.present.join(', ')}\n` : '') +
      (entry.knowledge ? `- HOW WE GOT HERE (carry this forward — do not restart elsewhere): ${entry.knowledge}\n` : '');
    const user =
      this.contextBlock(ctx) +
      stateBlock +
      (prevProse
        ? `\n\nTHE PREVIOUS SCENE, in full (continue directly from it — same thread, its very next moment):\n${prevProse}`
        : '') +
      `\n\nTHIS SCENE (${pageIdx + 1} of ${total}) — its job: ${job}\nWhat happens: ${summary}` +
      '\n\nWrite this scene as prose now.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.8, maxTokens: 700, signal },
    );
    return (raw ?? '').replace(/\s+/g, ' ').replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
  }

  /**
   * The continuity pass for ONE scene — the fix for the story teleporting between
   * pages. Runs BEFORE the scene's panels are written. Given the previous scene's
   * exit state and this scene's beat, it fixes the concrete, physical world-state:
   * the single location, the time, exactly who is on stage, and — critically — the
   * CAUSAL link that brings the characters here from where the last scene left
   * them. That state then constrains both the script and every art brief, so a
   * scene cannot open somewhere with no path from the one before it.
   */
  private async planSceneState(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    prevExit: ContinuityState,
    signal?: AbortSignal,
  ): Promise<{ entry: ContinuityState; exit: ContinuityState }> {
    const summary = beats[pageIdx]?.summary ?? '';
    const assigned = beats[pageIdx]?.characters ?? [];
    const castNames = ctx.characters.map((c) => (c.name ?? '').trim()).filter(Boolean);
    const isFirst = pageIdx === 0;
    const prevBlock = isFirst
      ? 'This is the FIRST scene of the story — establish the opening location, time, and who is present.'
      : 'THE PREVIOUS SCENE ENDED HERE (this scene must chain directly from it):\n' +
        `- Location: ${prevExit.location || '(unspecified)'}\n` +
        `- Time: ${prevExit.time || '(unspecified)'}\n` +
        `- On stage: ${prevExit.present.join(', ') || '(nobody named)'}\n` +
        `- What it set in motion: ${prevExit.knowledge || '(nothing noted)'}`;
    const system =
      'You are the CONTINUITY SUPERVISOR for a comic. Your ONLY job is to keep the world physically consistent from ' +
      'scene to scene so the finished comic reads as one continuous story and never teleports. For THIS scene, given ' +
      'where the previous scene ended and this scene\'s beat, determine its CONCRETE, PHYSICAL continuity:\n' +
      '- location: the single place this scene happens. ONE place only — a scene never spans two locations.\n' +
      '- time: when it happens, relative to the last scene (e.g. "moments later", "that night", "the next morning").\n' +
      '- present: the EXACT cast names physically on stage in this scene (choose only from the cast).\n' +
      '- continuesFrom: ONE sentence naming the CAUSAL link from the previous scene — the thing the characters just ' +
      'did or decided that physically brings them to THIS location. If the previous scene had them deciding to seek ' +
      'shelter, this scene must show them travelling to or arriving at that shelter — NEVER already in an unrelated ' +
      'place with no path from the last scene. For the first scene, describe the starting situation instead.\n' +
      '- mood: the emotional temperature of the scene, in a few words.\n' +
      '- reveals: ONE sentence on what CHANGES or what the reader now knows by the end of this scene — the thread the ' +
      'NEXT scene will pick up.\n' +
      'HARD RULE: the location, the time, and who is present must all follow logically from the previous scene. A ' +
      'character may be present here only if they were present before or their arrival is explained by continuesFrom. ' +
      'Nothing and no one may appear from nowhere. Return ONLY JSON matching the schema.';
    const user =
      this.contextBlock(ctx) +
      (castNames.length ? `\n\nCAST: ${castNames.join(', ')}` : '') +
      `\n\n${prevBlock}` +
      `\n\nTHIS SCENE'S BEAT (page ${pageIdx + 1} of ${beats.length}): ${summary}` +
      (assigned.length ? `\nCHARACTERS THE STORY ASSIGNS TO THIS SCENE: ${assigned.join(', ')}` : '') +
      '\n\nDetermine this scene\'s continuity as JSON.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.4, maxTokens: 700, schema: SCENE_STATE_SCHEMA, signal },
    );
    const p = parseJsonObject(raw);
    const str = (v: any) => String(v ?? '').trim();
    const named = Array.isArray(p?.present) ? canonicalCast(p.present.map((n: any) => str(n)), castNames) : [];
    // Fall back to the cast the outline assigned this page if the model named no
    // valid stage — the scene is never left with an empty cast.
    const present = named.length ? named : canonicalCast(assigned, castNames);
    const location = str(p?.location);
    const time = str(p?.time);
    const mood = str(p?.mood);
    // One scene = one place, so entry and exit share location/time/cast; the
    // difference the NEXT scene needs is the thread: entry carries how we got
    // here, exit carries what this scene set in motion.
    const entry: ContinuityState = { location, time, present, props: {}, mood, knowledge: str(p?.continuesFrom) };
    const exit: ContinuityState = { location, time, present, props: {}, mood, knowledge: str(p?.reveals) || str(p?.continuesFrom) };
    return { entry, exit };
  }

  /**
   * Phase 1: outline a COMPLETE, PROGRESSING arc. Each page is pinned to a
   * distinct dramatic function (see {@link beatFunctions}) so a small model
   * can't write the same beat repeatedly — every page must do a different job
   * and advance from the one before.
   */
  async planStoryboard(ctx: StoryContext, count: number, signal?: AbortSignal): Promise<PageBeat[]> {
    const beats = parseBeats(ctx.synopsis ?? '');
    const castNames = ctx.characters.map((c) => (c.name ?? '').trim()).filter(Boolean);
    // Beats-as-spine: when the author has Step-3 beats, the pages are DISTRIBUTED
    // from them (never re-invented), so nothing the author wrote gets dropped.
    // Only fall back to inventing an arc when there are no usable beats.
    let pages =
      beats.length >= 2
        ? await this.distributeBeats(ctx, beats, count, signal)
        : await this.inventArc(ctx, count, signal);
    // Normalize to exactly `count` pages.
    pages = pages.slice(0, count);
    while (pages.length < count) pages.push({ summary: beats[pages.length] ?? ctx.idea, characters: [] });
    // Map assigned names to the real cast, then guarantee every defined character
    // lands on at least one page — the root fix for characters vanishing.
    for (const p of pages) p.characters = canonicalCast(p.characters, castNames);
    return ensureCastAssigned(pages, castNames);
  }

  /**
   * Beats-as-spine: map the author's Step-3 beats onto exactly `count` pages,
   * covering every beat and inventing nothing. This is the key change — the beats
   * become the authoritative outline instead of loose context a fresh plan ignores.
   */
  private async distributeBeats(
    ctx: StoryContext,
    beats: string[],
    count: number,
    signal?: AbortSignal,
  ): Promise<PageBeat[]> {
    const numbered = beats.map((b, i) => `Beat ${i + 1}: ${b}`).join('\n');
    const cast = ctx.characters.map((c) => c.name?.trim()).filter(Boolean).join(', ');
    const system =
      `You are a comic book writer turning a story's SCENE BEATS into exactly ${count} comic pages. ` +
      'You are given the numbered beats. DISTRIBUTE them across the pages — do NOT invent a new story. ' +
      'HARD RULES: (1) every beat must be represented on some page; never drop one — especially the LAST beat, ' +
      'which is the climax; (2) never add events that are not in the beats; (3) keep the beats in order; ' +
      '(4) if there are more pages than beats, split the richest beats across consecutive pages; if there are more ' +
      'beats than pages, combine adjacent beats onto one page, but the final page must still deliver the last beat; ' +
      '(5) each page is ONE scene — one location, one continuous moment; start each summary by naming where/when; ' +
      '(6) consecutive pages must read as ONE continuous chain — each page follows as a direct consequence of the ' +
      'one before it and leads into the next; a reader must never feel the story jumped from one page to the next ' +
      'without connection; ' +
      '(7) for each page, list the characters (by their exact names from the cast) who appear on it. ' +
      `Return ONLY {"pages":[{"summary":"","characters":[""]}]} with exactly ${count} items, in order.`;
    const user =
      this.contextBlock(ctx) +
      `\n\nCAST: ${cast}` +
      `\n\nSCENE BEATS (distribute ALL of these across ${count} pages, in order — the last beat is the climax and must appear):\n${numbered}` +
      `\n\nWrite the ${count} pages as JSON.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.6, maxTokens: 1400, schema: STORYBOARD_PLAN_SCHEMA, signal },
    );
    return parsePageBeats(raw);
  }

  /** No beats to build on: invent a complete, progressing arc (original behavior). */
  private async inventArc(ctx: StoryContext, count: number, signal?: AbortSignal): Promise<PageBeat[]> {
    const fns = beatFunctions(count);
    const roleList = fns.map((f, i) => `Page ${i + 1} — ${f}`).join('\n');
    const system =
      `You are a comic book writer plotting ONE complete, self-contained story across exactly ${count} pages. ` +
      'Each page below has a DIFFERENT dramatic job. Write one concrete one-line summary per page that fulfils ITS ' +
      'job, specific to this idea and these characters. HARD RULES: (1) no two pages may show the same action, place ' +
      'or moment — each page must clearly ADVANCE from the previous one (a new development, a change of place, time ' +
      'or situation); (2) the story must visibly MOVE — where things are by the last page must be clearly different ' +
      'from page 1; (3) tell it through characters INTERACTING (talking, reacting, clashing), not one character ' +
      'repeating the same activity; (4) set up the idea early and pay it off at the end; ' +
      '(5) START each summary with where and when it happens (e.g. "That night, on the rooftop — ...") and move the ' +
      'story through DIFFERENT locations and times — never set every page in the same room; ' +
      '(6) each page is ONE scene: one location, one continuous moment. NEVER combine two scenes or two places into ' +
      'a single page summary — if the story has more events than pages, keep the strongest scenes and drop the rest, ' +
      'and let consecutive pages flow: a page should pick up where the previous one left off or clearly follow from it; ' +
      '(7) for each page, list the characters (by their exact names) who appear on it.\n\n' +
      `PAGE FUNCTIONS (write one summary for each, in this order):\n${roleList}\n\n` +
      `Return ONLY {"pages":[{"summary":"","characters":[""]}]} with exactly ${count} items, in this order.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + `\n\nWrite the ${count} page summaries as JSON.` },
      ],
      { temperature: 0.7, maxTokens: 1200, schema: STORYBOARD_PLAN_SCHEMA, signal },
    );
    return parsePageBeats(raw);
  }

  /**
   * Phase 2: write ONE page as a COMIC (pictures do the storytelling) in three
   * focused steps — each a smaller, sharper prompt than one monolith:
   *   2a. {@link stageScene} — the VISUAL DIRECTOR. Adapts the prose into a shot
   *       list: the layout and, per panel, the frozen MOMENT, what the picture
   *       must CONVEY, and the STAGING that makes the image carry it. This is what
   *       turns "illustrated prose" into a comic.
   *   2b. {@link planPage} — the LETTERER. Serves that shot list with only the
   *       words the page needs: gap-filler captions and real dialogue (never a
   *       retelling of the picture).
   *   2c. {@link describePanel} — ONE call PER PANEL that turns the staged beat
   *       into the final art brief, aimed at making the picture CONVEY its point.
   */
  async writePage(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    memory: StoryboardMemory,
    entry: ContinuityState,
    prose: string,
    signal?: AbortSignal,
  ): Promise<SuggestedPage> {
    const summary = beats[pageIdx]?.summary ?? '';
    // The cast this page is meant to feature — used as the "who's in frame"
    // fallback when a panel names nobody, so unnamed panels stop defaulting to
    // the whole ensemble.
    const assigned = beats[pageIdx]?.characters ?? [];
    const pageCast = ctx.characters.filter(
      (c) => c.name?.trim() && c.appearance?.trim() && assigned.some((n) => nameInText(n, c.name ?? '') || nameInText(c.name ?? '', n)),
    );
    // Who appears here for the FIRST time — their entrance must be introduced,
    // not sprung on the reader ("who is this?"). Names are canonicalised to the cast.
    const pageCastNames = pageCast.map((c) => c.name!.trim());
    const newcomers = pageCastNames.filter(
      (n) => !memory.introduced.some((s) => s.toLowerCase() === n.toLowerCase()),
    );
    // 2a. Stage the page visually — the shot list that tells the story in pictures.
    const staged = await this.stageScene(ctx, beats, pageIdx, memory, newcomers, entry, prose, signal);
    // The characters making their FIRST appearance here, with their traits — the
    // letterer introduces WHO they are (a comic character-intro caption) so a new
    // face is never a nameless stranger.
    const newcomerInfo = newcomers.map((n) => ({
      name: n,
      traits: (ctx.characters.find((c) => (c.name ?? '').trim() === n)?.traits ?? '').trim(),
    }));
    // Mark newcomers met, so later pages don't re-introduce them.
    for (const n of newcomers) memory.introduced.push(n);
    // 2b. Letter it — captions + dialogue that SERVE the staged shots.
    const words = await this.planPage(ctx, staged.panels, summary, prose, memory, {
      isFirstPage: pageIdx === 0,
      newcomers: newcomerInfo,
    }, signal);
    const want = panelCountFor(staged.layout);
    const panels: SuggestedPanel[] = [];
    // The within-page continuity chain: each panel continues the SET and positions
    // of the one drawn just before it. It starts EMPTY — panel 1 opens the scene's
    // set fresh (the previous page is a different scene, so it must NOT carry that
    // page's final image forward as "same space").
    let prevImage = '';
    for (let j = 0; j < want; j++) {
      const shot = staged.panels[j] ?? { moment: summary, conveys: summary, staging: '' };
      const w = words[j] ?? { narration: '', speaker: '', dialogue: '', dialogueKind: 'speech' as BubbleKind };
      const slot: PanelPlanSlot = { ...shot, ...w };
      const description = (await this.describePanel(ctx, summary, slot, j, want, prevImage, pageCast, entry, prose, staged.stage, signal)) || shot.moment || summary;
      prevImage = description;
      panels.push({
        description,
        dialogue: w.dialogue,
        dialogueKind: w.dialogueKind,
        narration: w.narration,
        speaker: w.speaker,
        staging: shot.staging,
      });
    }
    return { layout: staged.layout, panels };
  }

  /**
   * Phase 2a: the VISUAL DIRECTOR — adapt this scene's prose into a comic SHOT
   * LIST. This is the fix for "illustrated prose": instead of captioning one
   * sentence per panel and drawing it literally, it decides how to TELL THE STORY
   * IN PICTURES. It picks the layout and, per panel, the frozen MOMENT, the one
   * thing the image must CONVEY on its own, and the STAGING (shot + framing + what
   * shares the frame) that makes the picture carry it. Words come later.
   */
  private async stageScene(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    memory: StoryboardMemory,
    newcomers: string[],
    entry: ContinuityState,
    prose: string,
    signal?: AbortSignal,
  ): Promise<{ layout: LayoutId; stage: string; panels: StagedPanel[] }> {
    const total = beats.length;
    const index = pageIdx + 1;
    const summary = beats[pageIdx]?.summary ?? '';
    const pageCharacters = beats[pageIdx]?.characters ?? [];
    const system =
      'You are a comics artist adapting a written scene into a VISUAL comic page. Your job is to TELL THIS STORY IN ' +
      'PICTURES so a reader understands it from the ART, before reading a single word.\n' +
      'ONE CONTINUOUS SEQUENCE IN ONE SET (this is what makes the images read as a STORY and not scattered ' +
      'pictures — get this right above all else):\n' +
      '- FIRST fix the "stage": the single physical space this whole page happens in, described concretely — its ' +
      'key features and WHERE EACH ONE SITS (e.g. "the vault door on the left wall, the spiral stairwell down the ' +
      'centre, the guard\'s console by the right window"), plus where the characters START. Every panel is drawn ' +
      'INSIDE this same set with those features in the SAME places, so the reader is never disoriented.\n' +
      '- THEN make the panels FLOW: each panel is the NEXT INSTANT in that space — one continuous action broken ' +
      'into beats — so the reader\'s eye travels from frame to frame and can follow WHAT LEADS TO WHAT. Between ' +
      'panels, keep the characters roughly where they were and the space unchanged; move only the CAMERA. Never cut ' +
      'to a disconnected view that makes the reader lose the thread.\n' +
      'THINK IN VISUAL BEATS, NOT SENTENCES: do NOT put one prose sentence in each panel. Choose the few MOMENTS ' +
      'whose PICTURE carries the story — the setup, the turn, and the PAYOFF. NEVER drop the scene\'s climax to ' +
      'illustrate the setup twice, and never draw the same moment in two panels.\n' +
      'SHOW THE SCENE, NOT A LINEUP (most important): show the characters TOGETHER, interacting in the scene\'s ' +
      'shared action, and INCLUDE the central shared moment the prose is about (e.g. the crew huddled over the ' +
      'holo-map plotting). Do NOT give each character a solo panel — a page of one-per-panel portraits is a lineup, ' +
      'not a story; use a solo close-up only for a real beat. BUT "together" means the characters who are ACTUALLY ' +
      'in the scene together: a character the prose shows WATCHING from a distance, hidden, or PURSUING the others ' +
      '(a detective tailing them) is NOT part of the group — stage them SEPARATE, in the background or at a ' +
      'distance, never shoulder-to-shoulder or interacting with them.\n' +
      'MAKE THE IMAGE DO THE WORK — for each panel decide three things:\n' +
      '- "moment": the exact instant to FREEZE (the peak of the action, caught mid-motion), a beat LATER than the ' +
      'previous panel.\n' +
      '- "conveys": the ONE story point the reader must GRASP from this picture alone — a fact, a cause, a ' +
      'relationship, or an irony. This is the panel\'s reason to exist.\n' +
      '- "staging": the shot (close-up / medium / wide / over-the-shoulder / low / high / aerial) and the framing, ' +
      'placing the camera WITHIN THE SET — note where the framed people and features sit relative to the set, so ' +
      'the space stays consistent frame to frame. Put in one frame WHAT PROVES "conveys": stage CAUSE AND EFFECT ' +
      'together (the scooter SLAMMING into the panel as it springs open — not a scooter idling in a hallway) and ' +
      'DRAMATIC IRONY together (the thieves slipping past BELOW the guard who looks the wrong way). Vary the shot ' +
      'from the previous panel for rhythm, but keep the SAME set and positions.\n' +
      'HARD RULES: (1) ONE place, one continuous moment for the whole page — the fixed LOCATION below; never cut to ' +
      'another place or time. (2) CAST LOCK: show ONLY the story\'s defined characters — NEVER invent a stranger, ' +
      'guard, servant, or background crowd. (3) each character in CHARACTERS ON THIS PAGE must appear — but satisfy ' +
      'this by putting them IN FRAME TOGETHER in the shared-action panels, NOT by giving each a panel of their own; ' +
      'introduce a NEWCOMER by STAGING their entrance INTO the group (how they come into the scene), not springing ' +
      'them fully arrived. (4) unless this is page 1, this page is the DIRECT CONSEQUENCE of the one before it — ' +
      'continue the same thread, do not restart.\n' +
      'FIRST pick the layout that fits the NUMBER of visual beats you need (MAX 4 panels — captions and dialogue ' +
      'need room, so never cram more): splash = 1 big dramatic panel; strip3 = 3 stacked; grid4 = 4 in a 2x2; ' +
      'feature3 = 1 large + 2 small. Vary it from the previous page (see LAYOUTS ALREADY USED). The panel count ' +
      'MUST match the layout (splash=1, strip3=3, grid4=4, feature3=3).\n' +
      'Keep "stage", and each panel\'s "moment", "conveys" and "staging", SHORT — a phrase or one line each, not a ' +
      'paragraph (the art writer expands them later). Brevity keeps your output valid.\n' +
      'Return ONLY {"layout":"","stage":"","panels":[{"moment":"","conveys":"","staging":""}]}.';
    const stateBlock =
      '\n\nSCENE CONTINUITY (fixed — every panel obeys this; do NOT relocate or re-time any panel):\n' +
      `- LOCATION (every panel is set HERE): ${entry.location || summary}\n` +
      (entry.time ? `- TIME: ${entry.time}\n` : '') +
      (entry.present.length ? `- ON STAGE (only these characters are physically here): ${entry.present.join(', ')}\n` : '') +
      (entry.knowledge
        ? `- HOW WE ARRIVED HERE (this page is the direct consequence of this): ${entry.knowledge}\n`
        : '');
    const user =
      this.contextBlock(ctx) +
      stateBlock +
      (prose
        ? '\n\nSCENE, WRITTEN OUT (this is exactly what happens — adapt THIS into visual beats; show its turn and ' +
          `its payoff, and add nothing that is not in it):\n${prose}`
        : `\n\nTHIS SCENE: ${summary}`) +
      (memory.layouts.length
        ? `\n\nLAYOUTS ALREADY USED (pages 1–${memory.layouts.length}, in order): ${memory.layouts.join(', ')}`
        : '') +
      (memory.lastImage
        ? `\n\nThe previous page's final image was:\n${memory.lastImage}\n` +
          'Move the story FORWARD from here — do not redraw this exact shot.'
        : '') +
      (pageCharacters.length
        ? `\n\nCHARACTERS ON THIS PAGE — each must appear in at least one panel: ${pageCharacters.join(', ')}`
        : '') +
      (newcomers.length
        ? `\n\nNEW ON THIS PAGE — the reader has NOT met ${
            newcomers.length === 1 ? 'this character' : 'these characters'
          } yet; STAGE their entrance:\n${newcomers
            .map((n) => {
              const c = ctx.characters.find((x) => (x.name ?? '').trim() === n);
              return `- ${n}${c?.traits?.trim() ? ` — ${c.traits.trim()}` : ''}`;
            })
            .join('\n')}`
        : '') +
      (index === 1
        ? '\n\nTHIS IS PAGE 1 — THE OPENING. Panel 1 MUST be a WIDE ESTABLISHING shot of the place itself at its ' +
          'time of day (empty of people), so the reader feels WHERE and WHEN we are; then introduce the ' +
          'protagonist in the later panels. Prefer a multi-panel layout, not a single splash.'
        : '') +
      `\n\nStage page ${index} of ${total} as JSON.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 1500, schema: STAGE_SCENE_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    let layout = validLayout(parsed?.layout);
    // Backstop: never let a page be six tiny panels — there is no room for the art
    // once it is lettered. Downgrade to the roomier 4-panel grid.
    if (layout === 'six') layout = 'grid4';
    // Break a layout rut in code too: three identical layouts in a row gets
    // swapped to the same-panel-count sibling, so the plan's panels still fit.
    const [prev2, prev1] = memory.layouts.slice(-2);
    if (memory.layouts.length >= 2 && layout === prev1 && layout === prev2) {
      if (layout === 'feature3') layout = 'strip3';
      else if (layout === 'strip3') layout = 'feature3';
    }
    // The shared SET — the one physical space every panel is drawn inside. Fall
    // back to the fixed location so the continuity anchor is never empty.
    const stage = String(parsed?.stage ?? '').trim() || (entry.location || summary);
    const rawPanels = Array.isArray(parsed?.panels) ? parsed.panels : [];
    const panels: StagedPanel[] = rawPanels
      .map((p: any) => ({
        moment: String(p?.moment ?? '').trim(),
        conveys: String(p?.conveys ?? '').trim(),
        staging: String(p?.staging ?? '').trim(),
      }))
      .filter((p: StagedPanel) => p.moment.length > 0 || p.staging.length > 0);
    // RESILIENCE: if the model returned no usable panels (a long prompt can make a
    // small local model emit an empty/truncated "panels" array), synthesise a shot
    // list from the prose so the letterer still runs — an empty staging must NEVER
    // silently strip the page of narration and dialogue. Each sentence of the prose
    // becomes a beat, padded to the layout's panel count.
    if (!panels.length) {
      const want = panelCountFor(layout);
      const bits = (prose || summary)
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < want; i++) {
        panels.push({ moment: bits[i] ?? bits[bits.length - 1] ?? summary, conveys: '', staging: '' });
      }
      // Page 1 must still OPEN on the place, not mid-action — keep the establishing
      // shot even when the fallback fires, so the book has a proper starting frame.
      if (index === 1 && panels.length) {
        panels[0] = {
          moment: `Wide establishing shot of ${entry.location || summary}${entry.time ? `, ${entry.time}` : ''} — the place itself, empty of people, setting where and when we are.`,
          conveys: '',
          staging: '',
        };
      }
    }
    // Backstop the coverage guarantee: any required character the director failed
    // to place gets written into the shortest moment, so the art brief renders
    // them. On page 1 the opening establishing panel (index 0) stays peopleless.
    const coverable = index === 1 && panels.length > 1 ? panels.slice(1) : panels;
    if (coverable.length) {
      for (const name of pageCharacters) {
        if (panels.some((p) => nameInText(`${p.moment} ${p.conveys} ${p.staging}`, name))) continue;
        const target = coverable.reduce((a, b) => (a.moment.length <= b.moment.length ? a : b));
        target.moment = `${target.moment} ${name} is present in the frame.`.trim();
      }
    }
    return { layout, stage, panels };
  }

  /**
   * Phase 2b: the LETTERER — the WORDS for an already-staged page: the captions
   * and the dialogue that make it read as a story. A comic with no words is not
   * finished, so this actively writes narration and character dialogue (the comedy
   * and the personalities live here) — while refusing hollow filler and lines that
   * merely restate the picture. Returns one lettering entry per panel, in order.
   */
  private async planPage(
    ctx: StoryContext,
    staged: StagedPanel[],
    summary: string,
    prose: string,
    memory: StoryboardMemory,
    opts: { isFirstPage: boolean; newcomers: { name: string; traits: string }[] },
    signal?: AbortSignal,
  ): Promise<Array<{ narration: string; speaker: string; dialogue: string; dialogueKind: BubbleKind }>> {
    const shots = staged
      .map((p, i) => `Panel ${i + 1} — shows: ${p.moment || summary}${p.conveys ? ` | must convey: ${p.conveys}` : ''}`)
      .join('\n');
    const castNames = ctx.characters.map((c) => (c.name ?? '').trim()).filter(Boolean);
    const system =
      'You are the LETTERER for a comic page whose pictures are already staged. For each panel you are told what it ' +
      'SHOWS. Add the WORDS that make the page read as a story — captions and dialogue. A comic with no words is ' +
      'NOT finished: most panels that have people in them carry EITHER a caption OR a spoken line — rarely both, ' +
      'since a long caption AND a bubble crowd out the art (a nearly silent page is also a FAILURE).\n' +
      'KEEP EVERY CAPTION SHORT — a phrase or ONE sentence, never a paragraph; it shares the small panel with the ' +
      'picture. NARRATION (captions): give panel 1 of the page a short caption that sets the scene. Use a later ' +
      'caption to carry the story between images — a beat the picture cannot show, a turn, a passage of time, a ' +
      'touch of wit, or to INTRODUCE a new character (see NEW CHARACTERS below). Do NOT merely restate what the ' +
      'picture already shows (no "He slips on the wet floor" under a picture of him slipping).\n' +
      'DIALOGUE — LET THE CHARACTERS TALK: write short, natural, IN-CHARACTER lines that fit the moment — banter, ' +
      'reactions, plans, panic, arguments. This is where the comedy and the personalities live, so give people ' +
      'something to say on most panels they appear in. Base each line on what is happening and how THAT character ' +
      '(see their traits) would say it. FORBIDDEN: hollow filler ("What the—!"), lines that just narrate the ' +
      'picture ("The door is closing!"), and puns or stand-up quips. When several characters share the page, make ' +
      'it a real back-and-forth where each line answers the last.\n' +
      'WHO IS BEING SPOKEN TO: a line is aimed at whoever shares the action with the speaker. NEVER address a ' +
      'character who is only watching from a distance, hidden, or is the group\'s pursuer/adversary — the crew do ' +
      'NOT chat or banter with the detective hunting them (read the traits to see who is on which side). Do NOT ' +
      'drop another character\'s NAME into a line unless it truly matters — real people rarely say each other\'s ' +
      'names.\n' +
      '- "speaker": the EXACT cast name of who says/thinks the line; "" only on a genuinely silent panel.\n' +
      '- "dialogueKind": "speech" = aloud, "thought" = inner. Use "speech" when "dialogue" is "".\n' +
      'Words only: never put a "Name:" label inside dialogue, never two speakers in one panel, no parentheses or ' +
      'brackets. NEVER reuse a line from LINES ALREADY SPOKEN. Return ONLY ' +
      '{"panels":[{"narration":"","speaker":"","dialogue":"","dialogueKind":"speech"}]} with exactly one entry per ' +
      'panel listed below, in order.';
    const user =
      (castNames.length ? `CAST (only these may speak — match each line to their voice):\n${ctx.characters
        .filter((c) => c.name?.trim())
        .map((c) => `- ${c.name!.trim()}${c.traits?.trim() ? `: ${c.traits.trim()}` : ''}`)
        .join('\n')}\n` : '') +
      (prose
        ? `\nSCENE, WRITTEN OUT (base the words on what happens and what each character would say here):\n${prose}\n`
        : `\nSCENE: ${summary}\n`) +
      `\nTHE STAGED PANELS (letter each, in order):\n${shots}` +
      (opts.isFirstPage
        ? '\n\nTHIS IS THE OPENING OF THE COMIC: panel 1\'s caption must HOOK the reader and frame the premise in one ' +
          'short line — the world, who these people are, and what they are after, like the opening line of a comic ' +
          '(e.g. "In Neo-Tokyo, three of the worst thieves alive dream of one big score"). Not just the weather.'
        : '') +
      (opts.newcomers.length
        ? `\n\nNEW CHARACTERS — first seen on THIS page. On the panel where each first clearly appears, add a SHORT ` +
          `caption that introduces WHO they are: their name plus a characterising phrase from their traits, so the ` +
          `reader knows them at a glance (e.g. "CLUMSY — self-appointed mastermind, mostly chaos"):\n${opts.newcomers
            .map((n) => `- ${n.name}${n.traits ? `: ${n.traits}` : ''}`)
            .join('\n')}`
        : '') +
      (memory.lines.length
        ? `\n\nLINES ALREADY SPOKEN (never repeat any):\n${memory.lines.slice(-14).map((l) => `- ${l}`).join('\n')}`
        : '') +
      '\n\nLetter these panels as JSON.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 900, schema: PAGE_PLAN_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const rawPanels = Array.isArray(parsed?.panels) ? parsed.panels : [];
    // Align one lettering entry to each staged panel; a missing entry is silent.
    return staged.map((_, i) => {
      const p = rawPanels[i] ?? {};
      const dialogue = cleanDialogue(String(p?.dialogue ?? ''));
      const rawSpeaker = String(p?.speaker ?? '').trim();
      const speaker = castNames.find((n) => nameInText(rawSpeaker, n) || nameInText(n, rawSpeaker)) ?? '';
      const narration = String(p?.narration ?? '').trim();
      return {
        narration: DIALOGUE_JUNK.test(narration) ? '' : narration,
        speaker,
        dialogue: DIALOGUE_JUNK.test(dialogue) ? '' : dialogue,
        dialogueKind: validBubbleKind(p?.dialogueKind),
      };
    });
  }

  /**
   * Phase 2c: the final art brief for EXACTLY ONE panel — the "one prompt per
   * image" call. The model does one job: turn this panel's staged beat into a
   * vivid snapshot an image generator can draw, composed so the picture CONVEYS
   * the beat's story point AND continues the previous panel — same SET, same
   * positions, the very next instant — so the page reads as one connected
   * sequence rather than scattered illustrations.
   */
  private async describePanel(
    ctx: StoryContext,
    pageSummary: string,
    slot: PanelPlanSlot,
    index: number,
    total: number,
    prevImage: string,
    pageCast: StoryContext['characters'],
    entry: ContinuityState,
    sceneProse: string,
    stage: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const system =
      'You are a comic artist writing the art brief for EXACTLY ONE panel. An image generator will draw this single ' +
      'frame from your paragraph alone — it cannot see the story, the other panels, or any other context. Your goal ' +
      'is to make the PICTURE TELL THE STORY: compose the frame so a reader GRASPS what this panel must CONVEY ' +
      '(given below) from the image alone, following the STAGING direction (the shot, the framing, and what is ' +
      'placed in the frame together — e.g. cause and effect in one shot, or two characters positioned to show an ' +
      'irony). Keep everything you describe literal and visible. Describe ' +
      'ONLY what the camera literally sees at this instant, like a photo caption, in present tense: the shot type ' +
      '(close-up / medium / wide / over-the-shoulder / bird\'s-eye / low angle), WHO is visible (name them) with ' +
      'their exact pose and facial expression, the action frozen mid-moment, the setting and background, and the ' +
      'time of day and lighting. One paragraph, 40–80 words. Never mention the plot, feelings, sound, the past or ' +
      'future, or anything off-screen; never put written text, captions or speech inside the image.\n' +
      'WRITE A SELF-CONTAINED BRIEF: the image generator draws THIS frame alone. Describe the set and the ' +
      'characters\' positions concretely and fresh here, so it stays consistent with the rest of the page — but ' +
      'NEVER refer to another panel: your paragraph must not contain "before", "previous", "still", "same as", ' +
      '"unchanged", or "no new". Keep the room, objects and light consistent; change only the camera. ' +
      'Show ONLY the characters this panel\'s action names — do NOT add the rest of the cast to the frame, and NEVER ' +
      'invent any other person: no extra bystanders, guards, soldiers, servants, or background crowds may appear. ' +
      'If the panel names no character, show only the setting, empty of people. ' +
      'Return ONLY the paragraph — no preamble, no quotes, no JSON.';
    // Only hand the model the characters this panel actually involves — giving
    // it the whole cast every time is how every frame becomes the same group
    // shot. When the beat names nobody, fall back to THIS PAGE's cast (not the
    // whole book), so the frame stays focused on who the page is about.
    const named = charactersNamedIn(ctx.characters, `${slot.moment} ${slot.conveys} ${slot.dialogue}`);
    const scope = named.length
      ? named
      : pageCast.length
        ? pageCast
        : ctx.characters.filter((c) => c.name?.trim() && c.appearance?.trim());
    const cast = scope
      .map((c) => `- ${c.name!.trim()}: ${c.appearance!.trim()}`)
      .join('\n');
    // The shared world — pinned into every panel so the setting/era doesn't drift
    // from frame to frame (the "ruins → marble palace" failure).
    const world = [ctx.setting?.trim(), ctx.era?.trim()].filter(Boolean).join(' · ');
    // This scene's FIXED location — the hard anchor that stops the art brief from
    // inventing a different place than the dialogue is set in (the "campfire on a
    // bridge" failure). Every panel of the page shares it.
    const place = entry.location?.trim();
    const when = entry.time?.trim();
    const user =
      (world ? `WORLD (every panel is set in this exact world — keep it consistent): ${world}\n\n` : '') +
      (place
        ? `LOCATION (this panel is physically HERE — draw THIS place and no other; do not invent a different setting): ${place}${when ? ` — ${when}` : ''}\n\n`
        : '') +
      (stage
        ? `THE SET (the ONE physical space this whole page shares — draw these features in the SAME positions in ` +
          `every panel so the reader stays oriented): ${stage}\n\n`
        : '') +
      (cast ? `CHARACTERS (keep each looking exactly like this):\n${cast}\n\n` : '') +
      `SCENE (this page): ${pageSummary}\n` +
      (sceneProse ? `WHAT IS HAPPENING (the full scene — draw a moment true to it): ${sceneProse}\n` : '') +
      `THIS PANEL (${index + 1} of ${total}) FREEZES: ${slot.moment || pageSummary}\n` +
      (slot.conveys ? `THE READER MUST UNDERSTAND FROM THIS PICTURE ALONE: ${slot.conveys}\n` : '') +
      (slot.staging ? `STAGE IT LIKE THIS (shot, framing, what shares the frame): ${slot.staging}\n` : '') +
      (slot.dialogue
        ? `While this happens, ${slot.speaker?.trim() ? slot.speaker.trim() : 'a character'} is ` +
          `${slot.dialogueKind === 'thought' ? 'thinking' : 'saying'}: "${slot.dialogue}" — show it on ${
            slot.speaker?.trim() ? 'their' : 'the character\'s'
          } face and body language only; put NO text, letters, or speech bubbles in the image.\n`
        : '') +
      (prevImage
        ? `\nPREVIOUS PANEL (REFERENCE ONLY — keep this frame's set, objects and character positions consistent ` +
          `with it and show the very next instant, but do NOT mention or refer to it in your brief; describe THIS ` +
          `frame from scratch): ${prevImage}\n`
        : '') +
      '\nWrite the art brief for this one panel.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Generous ceiling: a reasoning model thinks before it answers, and a
      // non-reasoning one just stops early — a high cap costs nothing.
      { temperature: 0.7, maxTokens: 1200, signal },
    );
    return (raw ?? '')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
      .trim();
  }

  // ── Assemble: cover art prompt ───────────────────────────────────────────────
  /**
   * Write a single vivid image-generation prompt for the FRONT COVER, drawn from
   * the whole story. The author pastes it into their image tool, then uploads
   * the result as the cover (image generation stays manual/off-device).
   */
  async coverPrompt(
    ctx: StoryContext,
    title: string,
    style: ArtStyle,
    side: 'front' | 'back' = 'front',
    signal?: AbortSignal,
    author?: string,
  ): Promise<string> {
    const front =
      'You are a comic book cover art director. Describe the SUBJECT and COMPOSITION for the FRONT COVER of this comic: ' +
      'the focal character(s) and their pose, the setting, and the mood. Make it iconic and eye-catching. The top THIRD of the ' +
      'frame must be left completely empty — no character, object, or background detail may extend into it — because that ' +
      'band is reserved for the title text and shelf thumbnails crop into the very top edge of the image. Compose the scene ' +
      'entirely in the lower two-thirds of the frame. Describe ONLY what is depicted — do NOT mention art style, medium, colour ' +
      'palette, or aspect ratio (those are fixed and added separately). Return ONE paragraph, no preamble, no quotation marks.';
    const back =
      'You are a comic book cover art director. Describe the SUBJECT and COMPOSITION for the BACK COVER of this comic. ' +
      'It should COMPLEMENT the front, not repeat it: a quieter, more atmospheric single scene or recurring motif from the story, ' +
      'with clear empty space for a short synopsis blurb (and, if given, a credit line below it) in the lower portion of the frame. ' +
      'That empty space must stop short of the very bottom edge — leave a margin of at least the bottom tenth of the frame ' +
      'completely clear of text as well as art, since preview thumbnails crop into the bottom edge just as they do the top. ' +
      'Describe ONLY what is depicted — do NOT mention art style, medium, colour palette, or aspect ratio (those are fixed and ' +
      'added separately). Return ONE paragraph, no preamble, no quotation marks.';
    const user =
      (title?.trim() ? `TITLE: ${title.trim()}\n` : '') +
      this.contextBlock(ctx) +
      `\n\nDescribe the ${side} cover.`;
    const composition = await this.ai.chat(
      [
        { role: 'system', content: side === 'back' ? back : front },
        { role: 'user', content: user },
      ],
      { temperature: 0.8, maxTokens: 1200, signal },
    );
    if (!composition) return composition;
    // Bake in the shared style + aspect ratio so every cover matches the pages.
    const heading = `${side === 'back' ? 'Back' : 'Front'} cover of the comic book${title?.trim() ? ` "${title.trim()}"` : ''}.`;
    if (side === 'front') {
      // Don't rely on the composition LLM to have preserved the margin
      // instruction (it's told to describe only the scene, so it can drop
      // compositional directives) — bake it into the final prompt directly,
      // stated up front and in the strongest terms, so it always survives
      // into what actually gets pasted into the image tool.
      const marginBlock =
        'CRITICAL — TOP MARGIN (do not skip this): the top 25% of the image, all the way from the very top edge down, ' +
        'must be completely empty flat background with absolutely NO character, face, object, or foreground detail crossing ' +
        'into it. This band is reserved for the title text and is the first part cut off by preview thumbnails, so anything ' +
        'placed there will be lost. Compose the entire scene — every character and object — within the lower 75% of the frame only.';
      return `${heading}\n\n${marginBlock}\n\n${composition}\n\n${styleBlock(style)}`;
    } else {
      // Real books print a premise blurb on the back cover — reuse the same
      // story description the author already wrote, rather than having the
      // model paraphrase it, and ask the art to render it as jacket copy.
      const blurb = ctx.idea?.trim();
      const blurbBlock = blurb
        ? `\n\nIn the empty space reserved for the synopsis, render this exact blurb text as clean, readable typography: "${blurb}"`
        : '';
      // Only mention an author credit at all when one was actually given —
      // otherwise the image model tends to invent a fake byline on its own.
      const creditBlock = author?.trim()
        ? `\n\nBelow the blurb, render a small credit line: "by ${author.trim()}" — keep it well clear of the very bottom edge, with a visible empty margin beneath it, so it isn't cropped in preview thumbnails`
        : '\n\nDo NOT render any "written by", "by", or author credit text anywhere on the cover — none was given.';
      return `${heading}\n${composition}${blurbBlock}${creditBlock}\n\n${styleBlock(style)}`;
    }
  }

  /** Compact, readable summary of the story so far for prompting. */
  private contextBlock(ctx: StoryContext): string {
    const lines: string[] = [];
    // The refined premise is the authoritative logline that drives generation; the
    // raw idea is kept alongside it as the author's own-words seed.
    if (ctx.premise?.trim()) lines.push(`PREMISE: ${ctx.premise.trim()}`);
    if (ctx.idea?.trim()) lines.push(`IDEA: ${ctx.idea.trim()}`);
    // The locked world — every step inherits it, so prose and art stay coherent.
    if (ctx.setting?.trim()) lines.push(`SETTING: ${ctx.setting.trim()}`);
    if (ctx.era?.trim()) lines.push(`ERA: ${ctx.era.trim()}`);
    if (ctx.tone?.trim()) lines.push(`TONE: ${ctx.tone.trim()}`);
    const named = ctx.characters.filter((c) => c.name?.trim());
    if (named.length) {
      lines.push('CHARACTERS:');
      for (const c of named) {
        const bits = [c.name.trim()];
        if (c.appearance?.trim()) bits.push(c.appearance.trim());
        if (c.traits?.trim()) bits.push(`(${c.traits.trim()})`);
        lines.push(`- ${bits.join(' — ')}`);
      }
    }
    if (ctx.synopsis?.trim()) lines.push(`STORY BEATS: ${ctx.synopsis.trim()}`);
    return lines.join('\n');
  }
}

/**
 * The characters whose name (or distinctive first name) appears in the text.
 * Returns ONLY the matched characters (possibly empty) — the caller decides the
 * fallback, so an unnamed panel can default to the page's cast rather than the
 * whole book.
 */
function charactersNamedIn(
  characters: StoryContext['characters'],
  text: string,
): StoryContext['characters'] {
  const cast = (characters || []).filter((c) => c.name?.trim() && c.appearance?.trim());
  const hay = (text || '').toLowerCase();
  if (!hay.trim()) return [];
  return cast.filter((c) => nameInText(hay, c.name ?? ''));
}

/** Does the text name this character — full name, or a first name of length >= 3? */
function nameInText(text: string, name: string): boolean {
  const hay = (text || '').toLowerCase();
  const full = (name || '').trim().toLowerCase();
  if (!full) return false;
  if (hay.includes(full)) return true;
  const first = full.split(/\s+/)[0] ?? '';
  return first.length >= 3 && hay.includes(first);
}

/**
 * Remove craft scaffolding a model sometimes leaves in the beats — "(**PLANT 1**)",
 * "PAYOFF:", "SETUP" — so the author only ever reads clean story prose.
 */
function stripCraftLabels(text: string): string {
  return (text || '')
    .replace(/\(?\s*\**\s*(plants?|payoffs?|set[- ]?ups?)\b\s*\d*\s*:?\s*\**\s*\)?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

/** Split the Step-3 beats blob into individual beats (numbered / paragraphs / sentences). */
function parseBeats(synopsis: string): string[] {
  const t = (synopsis || '').trim();
  if (!t) return [];
  const numbered = t.split(/\n(?=\s*\d+[.)]\s)/).map((s) => s.trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered;
  const paras = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) return paras;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Parse a storyboard-plan reply into page beats (summary + assigned cast). */
function parsePageBeats(raw: string): PageBeat[] {
  const parsed = parseJsonObject(raw);
  const list = Array.isArray(parsed?.pages) ? parsed.pages : [];
  return list
    .map((p: any) => ({
      summary: String(p?.summary ?? '').trim(),
      characters: Array.isArray(p?.characters)
        ? p.characters.map((n: any) => String(n ?? '').trim()).filter(Boolean)
        : [],
    }))
    .filter((p: PageBeat) => p.summary.length > 0);
}

/** Keep only assigned names that match a real cast member, mapped to the canonical name. */
function canonicalCast(assigned: string[], castNames: string[]): string[] {
  const out: string[] = [];
  for (const raw of assigned || []) {
    const hit = castNames.find((c) => nameInText(raw, c) || nameInText(c, raw));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Guarantee every defined character is assigned to at least one page, so no one
 * silently drops out of the whole book. Unassigned characters go to the
 * least-populated page, spreading the ensemble instead of piling onto one frame.
 */
function ensureCastAssigned(pages: PageBeat[], castNames: string[]): PageBeat[] {
  if (!pages.length) return pages;
  const assigned = new Set(pages.flatMap((p) => p.characters.map((n) => n.toLowerCase())));
  for (const name of castNames) {
    if (assigned.has(name.toLowerCase())) continue;
    let idx = 0;
    for (let i = 1; i < pages.length; i++) if (pages[i].characters.length < pages[idx].characters.length) idx = i;
    pages[idx].characters.push(name);
    assigned.add(name.toLowerCase());
  }
  return pages;
}

/**
 * A minimal one-panel page for when a scene's scripting call fails. It keeps the
 * book complete (no missing page, no aborted run) and stays fully editable: the
 * author can add art, dialogue and a better layout by hand. Uses the scene prose
 * (or the beat summary) as the panel's description so it isn't blank.
 */
function fallbackPage(beat: PageBeat | undefined, prose: string): SuggestedPage {
  const text = (prose || beat?.summary || '').trim();
  return {
    layout: 'splash',
    panels: [{ description: text, dialogue: '', dialogueKind: 'speech', narration: '', speaker: '' }],
    prose,
  };
}

/** A blank continuity state — filled properly by the scene-state work later. */
function emptyState(): ContinuityState {
  return { location: '', time: '', present: [], props: {}, mood: '', knowledge: '' };
}

/**
 * One generated page (beat + panels + its computed continuity) → a Bible scene.
 * The entry/exit states are the REAL chained states the scene was generated
 * under — not empty stubs — so the bible records the actual continuity that
 * drove the art, and a later regeneration can chain from it.
 */
function beatToScene(
  beat: PageBeat,
  page: SuggestedPage,
  state: { entry: ContinuityState; exit: ContinuityState },
  prose: string,
): Scene {
  const sections: Section[] = page.panels.map((panel) => ({
    id: newId('section'),
    moment: aiField(panel.description ?? ''),
    cameraHint: aiField(panel.staging ?? ''),
    speaker: aiField(panel.speaker ?? ''),
    line: aiField(panel.dialogue ?? ''),
    dialogueKind: panel.dialogueKind ?? 'speech',
    narration: aiField(panel.narration ?? ''),
    artPrompt: aiField(panel.description ?? ''),
  }));
  return {
    id: newId('scene'),
    prose: aiField(prose ?? ''),
    goal: aiField(beat?.summary ?? ''),
    conflict: aiField(''),
    turn: aiField(state.exit.knowledge ?? ''),
    entryState: aiField(state.entry),
    exitState: aiField(state.exit),
    layout: page.layout,
    sections,
  };
}

/** Assemble the full Story Bible JSON from the world, the spine, and the scenes. */
function assembleBible(ctx: StoryContext, spine: StorySpine, scenes: Scene[]): StoryBible {
  const now = timestamp();
  const roster = ctx.characters.map((c) => c.name?.trim()).filter(Boolean).join(', ');
  const characters: BibleCharacter[] = ctx.characters
    .filter((c) => c.name?.trim())
    .map((c) => ({
      id: newId('char'),
      name: userField(c.name.trim()),
      appearance: userField(c.appearance?.trim() ?? ''),
      traits: userField(c.traits?.trim() ?? ''),
      role: emptyField(''),
      arc: emptyField(''),
    }));
  return {
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    id: newId('bible'),
    title: emptyField(''),
    createdAt: now,
    updatedAt: now,
    setup: {
      // The author's own words (the raw idea) is the intake seed; the refined
      // logline lives on the spine below. Both are recorded so the bible carries
      // the full idea → premise provenance on its own (export/import fidelity).
      premise: userField(ctx.idea?.trim() ?? ''),
      characters: userField(roster),
      setting: userField(ctx.setting?.trim() ?? ''),
      era: userField(ctx.era?.trim() ?? ''),
      tone: userField(ctx.tone?.trim() ?? ''),
      storyline: userField(ctx.synopsis?.trim() ?? ''),
    },
    spine: {
      // The refined premise IS the logline; fall back to the raw idea if the
      // author never ran the refinement.
      logline: ctx.premise?.trim() ? userField(ctx.premise.trim()) : aiField(ctx.idea?.trim() ?? ''),
      theme: emptyField(''),
      dramaticQuestion: aiField(spine.dramaticQuestion),
      climax: aiField(spine.climax),
      resolution: aiField(spine.resolution),
      setups: aiField(spine.setups.map((s) => ({ plant: s.plant, payoff: s.payoff }))),
      visualStyle: { palette: '', rendering: '', styleId: '' },
    },
    characters,
    scenes,
    draft: true,
  };
}

/** Parse a JSON object from a model reply, tolerating stray prose or code fences. */
function parseJsonObject(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to the first {...} block in the text.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
