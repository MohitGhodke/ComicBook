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

const STORYBOARD_PLAN_SCHEMA = {
  name: 'storyboard_plan',
  schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
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

  // ── Step 3: Interactions (from idea + characters) ────────────────────────────
  async draftInteractions(ctx: StoryContext, signal?: AbortSignal): Promise<string> {
    const system =
      'You are a comic book story editor. Using the idea and the characters, write the scene beats for this chapter: ' +
      'how the characters meet and interact, what each wants, where they clash, and how it resolves. ' +
      'Give 4 to 7 concrete beats, specific to THESE characters and this idea. Keep it tight and vivid.\n' +
      'CRITICAL: beats are SCENES, not moments — the story must TRAVEL. Spread the beats across DIFFERENT locations ' +
      'and times (start each beat by naming where/when), and cover the FULL scope of the idea: if it promises a ' +
      'chase, a city, a journey or a deadline, those must appear as beats. NEVER compress the whole chapter into ' +
      'one room or one continuous conversation — that makes every drawn page look identical.\n' +
      'Return ONLY the beats as short prose or a short numbered list — no preamble.';
    return this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + '\n\nWrite the scene beats.' },
      ],
      { temperature: 0.75, maxTokens: 1200, signal },
    );
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
  async planStoryboard(ctx: StoryContext, count: number, signal?: AbortSignal): Promise<string[]> {
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
      'and let consecutive pages flow: a page should pick up where the previous one left off or clearly follow from it.\n\n' +
      `PAGE FUNCTIONS (write one summary for each, in this order):\n${roleList}\n\n` +
      `Return ONLY {"pages":[{"summary":""}]} with exactly ${count} items, in this order.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + `\n\nWrite the ${count} page summaries as JSON.` },
      ],
      { temperature: 0.7, maxTokens: 1200, schema: STORYBOARD_PLAN_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.pages) ? parsed.pages : [];
    return list.map((p: any) => String(p?.summary ?? '').trim()).filter((s: string) => s.length > 0);
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
    beats: string[],
    pageIdx: number,
    memory: StoryboardMemory,
    signal?: AbortSignal,
  ): Promise<SuggestedPage> {
    const summary = beats[pageIdx] ?? '';
    const plan = await this.planPage(ctx, beats, pageIdx, memory, signal);
    const want = panelCountFor(plan.layout);
    const panels: SuggestedPanel[] = [];
    // Each panel also sees the one drawn just before it, so the camera varies.
    let prevImage = memory.lastImage;
    for (let j = 0; j < want; j++) {
      const slot = plan.panels[j] ?? { beat: summary, dialogue: '', dialogueKind: 'speech' as BubbleKind };
      const description = (await this.describePanel(ctx, summary, slot, j, want, prevImage, signal)) || slot.beat || summary;
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
    beats: string[],
    pageIdx: number,
    memory: StoryboardMemory,
    signal?: AbortSignal,
  ): Promise<{ layout: LayoutId; panels: PanelPlanSlot[] }> {
    const total = beats.length;
    const index = pageIdx + 1;
    const summary = beats[pageIdx] ?? '';
    const outline = beats
      .map((b, i) => `${i + 1}. ${b}${i === pageIdx ? '   ← THIS PAGE' : ''}`)
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
    // shot. Fall back to the full cast when the beat names nobody.
    const inShot = charactersNamedIn(ctx.characters, `${slot.beat} ${slot.dialogue}`);
    const cast = inShot
      .map((c) => `- ${c.name.trim()}: ${c.appearance!.trim()}`)
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
 * Falls back to the whole described cast when nobody is named, so a vague
 * beat still renders consistent characters.
 */
function charactersNamedIn(
  characters: StoryContext['characters'],
  text: string,
): StoryContext['characters'] {
  const cast = (characters || []).filter((c) => c.name?.trim() && c.appearance?.trim());
  const hay = (text || '').toLowerCase();
  if (!hay.trim()) return cast;
  const named = cast.filter((c) => {
    const first = c.name!.trim().split(/\s+/)[0].toLowerCase();
    return hay.includes(c.name!.trim().toLowerCase()) || (first.length >= 3 && hay.includes(first));
  });
  return named.length ? named : cast;
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
