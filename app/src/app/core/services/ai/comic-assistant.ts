import { Injectable, inject } from '@angular/core';
import { AiService } from './ai.service';
import { styleBlock } from '../../style/art-style';
import { ArtStyle } from '../../style/art-styles';
import { cleanDialogue } from '../../util/text';
import { BubbleKind, LayoutId } from '../../models/comic.model';
import { LAYOUTS, panelCountFor } from '../../models/layout';

/** The story so far — passed into every helper so each step builds on the last. */
export interface StoryContext {
  idea: string;
  characters: { name: string; appearance?: string; traits?: string }[];
  synopsis?: string;
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
}

export interface SuggestedPage {
  /** The panel layout the AI chose for this page's moment. */
  layout: LayoutId;
  panels: SuggestedPanel[];
}

export interface ShapedIdea {
  /** A short, evocative comic title suggested from the idea. */
  title: string;
  /** The refined premise/logline. */
  logline: string;
}

const SHAPED_IDEA_SCHEMA = {
  name: 'shaped_idea',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      logline: { type: 'string' },
    },
    required: ['title', 'logline'],
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

const REVIEW_SCHEMA = {
  name: 'review',
  schema: {
    type: 'object',
    properties: {
      suggestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['suggestions'],
  },
};

/** One plant→payoff pair: something set up early so a later moment lands. */
interface SetupPair {
  plant: string;
  payoff: string;
}

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

const PAGE_PLAN_SCHEMA = {
  name: 'page_plan',
  schema: {
    type: 'object',
    properties: {
      layout: { type: 'string', enum: ['splash', 'strip3', 'grid4', 'feature3', 'six'] },
      panels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            beat: { type: 'string' },
            dialogue: { type: 'string' },
            dialogueKind: { type: 'string', enum: ['speech', 'thought', 'narration'] },
          },
          required: ['beat', 'dialogue', 'dialogueKind'],
        },
      },
    },
    required: ['layout', 'panels'],
  },
};

/** One planned panel slot: the action beat plus its line, before the art brief. */
interface PanelPlanSlot {
  beat: string;
  dialogue: string;
  dialogueKind: BubbleKind;
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
  /** The final panel image of the previous page — the moment to move on FROM. */
  lastImage: string;
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

  // ── Step 1: Idea (the entry point) ───────────────────────────────────────────
  /**
   * Refine a rough idea into a polished logline AND propose a comic title. The
   * idea is the starting point — the user shouldn't have to name the book first;
   * a good title falls out of a clear premise.
   */
  async shapeIdea(rough: string, signal?: AbortSignal): Promise<ShapedIdea> {
    const system =
      'You are a comic book story editor. From the user\'s rough idea, do two things: ' +
      '(1) rewrite it into a single vivid logline — 2–3 sentences covering the protagonist, what they want, ' +
      'the central conflict, the stakes, and the tone; and ' +
      '(2) propose a short, evocative comic book title (2 to 5 words, no subtitle, no quotation marks). ' +
      'Return ONLY a JSON object of the form {"title":"","logline":""}.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: rough.trim() },
      ],
      { temperature: 0.7, maxTokens: 800, schema: SHAPED_IDEA_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    return {
      title: String(parsed?.title ?? '').trim(),
      logline: String(parsed?.logline ?? '').trim(),
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

  // ── Step 4: Pages — batched "plan → expand", same as characters ──────────────
  /**
   * Storyboard in two phases so a small model stays coherent over many pages:
   *   1. plan — outline the arc as `count` one-line page beats.
   *   2. expand — one focused call per page for its caption + dialogue.
   * `onProgress` streams pages so the UI fills them in one at a time.
   */
  async storyboardPages(
    ctx: StoryContext,
    count: number,
    onProgress?: PageProgress,
    signal?: AbortSignal,
  ): Promise<SuggestedPage[]> {
    const beats = await this.planStoryboard(ctx, count, signal);
    const memory: StoryboardMemory = { layouts: [], lines: [], lastImage: '' };
    const out: SuggestedPage[] = [];
    for (let i = 0; i < beats.length; i++) {
      // Each page sees the whole outline PLUS what earlier pages actually wrote
      // (layouts, spoken lines, the last image) so it must move on, not repeat.
      const page = await this.writePage(ctx, beats, i, memory, signal);
      memory.layouts.push(page.layout);
      for (const p of page.panels) if (p.dialogue) memory.lines.push(p.dialogue);
      const last = page.panels[page.panels.length - 1];
      if (last?.description) memory.lastImage = last.description;
      out.push(page);
      onProgress?.(i + 1, beats.length, page);
    }
    return out;
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
      '(6) for each page, list the characters (by their exact names from the cast) who appear on it. ' +
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
   * Phase 2: write ONE page in two focused steps (same plan → expand pattern
   * as characters, one level down):
   *   2a. {@link planPage} — choose the layout and script the page: one action
   *       micro-beat + one dialogue line per panel. Dialogue is planned page-wide
   *       so the conversation alternates properly.
   *   2b. {@link describePanel} — ONE call PER PANEL that turns its micro-beat
   *       into the final self-contained art brief. A small model writing one
   *       frame at a time is far sharper than one writing six at once.
   */
  async writePage(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    memory: StoryboardMemory,
    signal?: AbortSignal,
  ): Promise<SuggestedPage> {
    const summary = beats[pageIdx]?.summary ?? '';
    // The cast this page is meant to feature — used as the "who's in frame"
    // fallback when a panel beat names nobody, so unnamed panels stop defaulting
    // to the whole ensemble.
    const assigned = beats[pageIdx]?.characters ?? [];
    const pageCast = ctx.characters.filter(
      (c) => c.name?.trim() && c.appearance?.trim() && assigned.some((n) => nameInText(n, c.name ?? '') || nameInText(c.name ?? '', n)),
    );
    const plan = await this.planPage(ctx, beats, pageIdx, memory, signal);
    const want = panelCountFor(plan.layout);
    const panels: SuggestedPanel[] = [];
    // Each panel also sees the one drawn just before it, so the camera varies.
    let prevImage = memory.lastImage;
    for (let j = 0; j < want; j++) {
      const slot = plan.panels[j] ?? { beat: summary, dialogue: '', dialogueKind: 'speech' as BubbleKind };
      const description = (await this.describePanel(ctx, summary, slot, j, want, prevImage, pageCast, signal)) || slot.beat || summary;
      prevImage = description;
      panels.push({ description, dialogue: slot.dialogue, dialogueKind: slot.dialogueKind });
    }
    return { layout: plan.layout, panels };
  }

  /**
   * Phase 2a: script ONE page — pick the layout and write each panel's action
   * micro-beat and dialogue line. This call is small on purpose: no visual
   * detail yet, just WHAT happens and WHO says what, informed by everything
   * already written (so nothing repeats).
   */
  private async planPage(
    ctx: StoryContext,
    beats: PageBeat[],
    pageIdx: number,
    memory: StoryboardMemory,
    signal?: AbortSignal,
  ): Promise<{ layout: LayoutId; panels: PanelPlanSlot[] }> {
    const total = beats.length;
    const index = pageIdx + 1;
    const summary = beats[pageIdx]?.summary ?? '';
    const pageCharacters = beats[pageIdx]?.characters ?? [];
    const outline = beats
      .map((b, i) => `${i + 1}. ${b.summary}${i === pageIdx ? '   ← THIS PAGE' : ''}`)
      .join('\n');
    const system =
      'You are a comic book writer scripting ONE page of a longer story. It must ADVANCE the story: depict THIS ' +
      'page\'s beat as a NEW moment, never a redraw or re-staging of anything already shown.\n' +
      'HARD RULE — ONE SCENE PER PAGE: every panel on this page happens in the SAME location within the same ' +
      'continuous moment. Never cut to a different place, a different time, or a parallel group of characters ' +
      'mid-page. If the beat implies travel or several places, show only the destination — the most dramatic one.\n' +
      'BRIDGE SCENE CHANGES: if this page happens in a different place or time than the page before it, panel 1 ' +
      'must carry a short narration caption naming the new place/time (e.g. "Two days later — the launch site.") ' +
      'with dialogueKind "narration". That caption is how the reader follows the jump.\n' +
      'FIRST choose the panel layout that fits this moment:\n' +
      '- splash = one big dramatic full-page panel (a reveal, a huge emotional beat)\n' +
      '- strip3 = 3 stacked panels (steady beats, a short exchange)\n' +
      '- grid4 = 4 panels in a 2x2 (back-and-forth, a small montage)\n' +
      '- feature3 = 1 large panel + 2 small (a hero moment plus two reactions)\n' +
      '- six = 6 panels (fast, busy action)\n' +
      'Vary the book\'s rhythm: do NOT choose the same layout as the previous page (see LAYOUTS ALREADY USED) ' +
      'unless this moment truly demands it.\n' +
      'THEN write one entry per panel:\n' +
      '- "beat": ONE concrete sentence of what visibly HAPPENS in that panel — the action and who is in frame ' +
      '(name them). Every panel must show a DIFFERENT action; the page must move from its first panel to its last. ' +
      'Do NOT put every character in every panel — cut like a film editor: a close-up on one face, an insert of ' +
      'hands or an object, a two-shot, and only occasionally the full group.\n' +
      '- "dialogue": the one line spoken or thought in that panel, 12 words or fewer. Characters must talk TO each ' +
      'other — alternate speakers across panels like a real conversation, and react to what was just said. ' +
      'Words only: NEVER a speaker name or "Name:" label, never two characters\' words in one panel, no stage ' +
      'directions, no parentheses () or brackets []. Leave "" ONLY for a deliberate silent beat. ' +
      'NEVER reuse a line from LINES ALREADY SPOKEN — every line in the book is said exactly once.\n' +
      '- "dialogueKind": "speech" = said aloud; "thought" = private inner thought; "narration" = a short ' +
      'scene-setting caption like "Later, on the rooftop." (use sparingly). Use "speech" when dialogue is "".\n' +
      'The number of panels MUST match the layout (splash=1, strip3=3, grid4=4, feature3=3, six=6). ' +
      'Return ONLY {"layout":"","panels":[{"beat":"","dialogue":"","dialogueKind":"speech"}]}.';
    const user =
      this.contextBlock(ctx) +
      `\n\nFULL STORY OUTLINE (all ${total} pages, in order):\n${outline}` +
      (memory.layouts.length
        ? `\n\nLAYOUTS ALREADY USED (pages 1–${memory.layouts.length}, in order): ${memory.layouts.join(', ')}`
        : '') +
      (memory.lastImage
        ? `\n\nTHE PREVIOUS PAGE ENDED ON THIS IMAGE (move on from it — new action, never re-stage it):\n${memory.lastImage}`
        : '') +
      (memory.lines.length
        ? `\n\nLINES ALREADY SPOKEN (never repeat any of these):\n${memory.lines
            .slice(-30)
            .map((l) => `- ${l}`)
            .join('\n')}`
        : '') +
      (pageCharacters.length
        ? `\n\nCHARACTERS ON THIS PAGE — you MUST name EACH of these in at least one panel's "beat": ${pageCharacters.join(', ')}`
        : '') +
      `\n\nWrite ONLY page ${index} of ${total} — its beat: ${summary}\nScript this page as JSON.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.75, maxTokens: 1000, schema: PAGE_PLAN_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    let layout = validLayout(parsed?.layout);
    // Break a layout rut in code too: three identical layouts in a row gets
    // swapped to the same-panel-count sibling, so the plan's panels still fit.
    const [prev2, prev1] = memory.layouts.slice(-2);
    if (memory.layouts.length >= 2 && layout === prev1 && layout === prev2) {
      if (layout === 'feature3') layout = 'strip3';
      else if (layout === 'strip3') layout = 'feature3';
    }
    const rawPanels = Array.isArray(parsed?.panels) ? parsed.panels : [];
    const panels: PanelPlanSlot[] = rawPanels
      .map((p: any) => {
        const dialogue = cleanDialogue(String(p?.dialogue ?? ''));
        return {
          beat: String(p?.beat ?? '').trim(),
          dialogue: DIALOGUE_JUNK.test(dialogue) ? '' : dialogue,
          dialogueKind: validBubbleKind(p?.dialogueKind),
        };
      })
      .filter((p: PanelPlanSlot) => p.beat.length > 0 || p.dialogue.length > 0);
    // Backstop the coverage guarantee: any character this page must feature but
    // that the model failed to name gets written into a panel beat, so the art
    // brief renders them (charactersNamedIn keys off the beat text).
    if (panels.length) {
      for (const name of pageCharacters) {
        if (panels.some((p) => nameInText(`${p.beat} ${p.dialogue}`, name))) continue;
        const target = panels.reduce((a, b) => (a.beat.length <= b.beat.length ? a : b));
        target.beat = `${target.beat} ${name} is present in the frame.`.trim();
      }
    }
    return { layout, panels };
  }

  /**
   * Phase 2b: the final art brief for EXACTLY ONE panel — the "one prompt per
   * image" call. The model does one job: turn this panel's micro-beat into a
   * vivid, self-contained snapshot an image generator can draw with no other
   * context. Seeing the previous panel's brief forces camera variety.
   */
  private async describePanel(
    ctx: StoryContext,
    pageSummary: string,
    slot: PanelPlanSlot,
    index: number,
    total: number,
    prevImage: string,
    pageCast: StoryContext['characters'],
    signal?: AbortSignal,
  ): Promise<string> {
    const system =
      'You are a comic artist writing the art brief for EXACTLY ONE panel. An image generator will draw this single ' +
      'frame from your paragraph alone — it cannot see the story, the other panels, or any other context. Describe ' +
      'ONLY what the camera literally sees at this instant, like a photo caption, in present tense: the shot type ' +
      '(close-up / medium / wide / over-the-shoulder / bird\'s-eye / low angle), WHO is visible (name them) with ' +
      'their exact pose and facial expression, the action frozen mid-moment, the setting and background, and the ' +
      'time of day and lighting. One paragraph, 40–80 words. Never mention the plot, feelings, sound, the past or ' +
      'future, or anything off-screen; never put written text, captions or speech inside the image. Choose a ' +
      'DIFFERENT camera angle or distance than the previous panel so the page has visual rhythm. ' +
      'Show ONLY the characters this panel\'s action names — do NOT add the rest of the cast to the frame. ' +
      'Return ONLY the paragraph — no preamble, no quotes, no JSON.';
    // Only hand the model the characters this panel actually involves — giving
    // it the whole cast every time is how every frame becomes the same group
    // shot. When the beat names nobody, fall back to THIS PAGE's cast (not the
    // whole book), so the frame stays focused on who the page is about.
    const named = charactersNamedIn(ctx.characters, `${slot.beat} ${slot.dialogue}`);
    const scope = named.length
      ? named
      : pageCast.length
        ? pageCast
        : ctx.characters.filter((c) => c.name?.trim() && c.appearance?.trim());
    const cast = scope
      .map((c) => `- ${c.name!.trim()}: ${c.appearance!.trim()}`)
      .join('\n');
    const user =
      (cast ? `CHARACTERS (keep each looking exactly like this):\n${cast}\n\n` : '') +
      `SCENE (this page): ${pageSummary}\n` +
      `THIS PANEL (${index + 1} of ${total}) SHOWS: ${slot.beat || pageSummary}\n` +
      (slot.dialogue
        ? `While this happens, a character is ${slot.dialogueKind === 'thought' ? 'thinking' : 'saying'}: ` +
          `"${slot.dialogue}" — convey it through expression and body language only; no text in the image.\n`
        : '') +
      (prevImage ? `\nPREVIOUS PANEL, for contrast — pick a different camera: ${prevImage}\n` : '') +
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
  ): Promise<string> {
    const front =
      'You are a comic book cover art director. Describe the SUBJECT and COMPOSITION for the FRONT COVER of this comic: ' +
      'the focal character(s) and their pose, the setting, and the mood. Make it iconic and eye-catching, and leave clear ' +
      'space at the top for the title text. Describe ONLY what is depicted — do NOT mention art style, medium, colour palette, ' +
      'or aspect ratio (those are fixed and added separately). Return ONE paragraph, no preamble, no quotation marks.';
    const back =
      'You are a comic book cover art director. Describe the SUBJECT and COMPOSITION for the BACK COVER of this comic. ' +
      'It should COMPLEMENT the front, not repeat it: a quieter, more atmospheric single scene or recurring motif from the story, ' +
      'with clear empty space for a short synopsis blurb and small credits at the bottom. Describe ONLY what is depicted — ' +
      'do NOT mention art style, medium, colour palette, or aspect ratio (those are fixed and added separately). ' +
      'Return ONE paragraph, no preamble, no quotation marks.';
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
    return `${heading}\n${composition}\n\n${styleBlock(style)}`;
  }

  // ── Editor: qualitative review ───────────────────────────────────────────────
  /**
   * Read the whole comic and return a few concrete, actionable suggestions to
   * make it better (pacing, clarity, character, theme, art direction). This
   * complements the deterministic "what's missing" checks the editor runs
   * locally — the AI adds craft feedback the checklist can't.
   */
  async reviewComic(ctx: StoryContext, stats: string, signal?: AbortSignal): Promise<string[]> {
    const system =
      'You are a seasoned comics editor giving a creator feedback. From the comic\'s story and structure, ' +
      'give 3 to 5 specific, actionable suggestions to improve it — pacing, character clarity, theme, dialogue, or art direction. ' +
      'Each suggestion should be one concrete sentence the creator can act on. Do not restate the plot. ' +
      'Return ONLY a JSON object of the form {"suggestions":["",""]}.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + '\n\nSTRUCTURE: ' + stats + '\n\nReturn the suggestions JSON.' },
      ],
      { temperature: 0.6, maxTokens: 1600, schema: REVIEW_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return list.map((s: any) => String(s ?? '').trim()).filter((s: string) => s.length > 0);
  }

  /** Compact, readable summary of the story so far for prompting. */
  private contextBlock(ctx: StoryContext): string {
    const lines: string[] = [];
    if (ctx.idea?.trim()) lines.push(`IDEA: ${ctx.idea.trim()}`);
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
