import { Injectable, inject } from '@angular/core';
import { AiService } from './ai.service';
import { styleBlock } from '../../style/art-style';

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

export interface SuggestedPage {
  caption: string;
  dialogue: string;
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

const ONE_PAGE_SCHEMA = {
  name: 'page',
  schema: {
    type: 'object',
    properties: {
      caption: { type: 'string' },
      dialogue: { type: 'string' },
    },
    required: ['caption', 'dialogue'],
  },
};

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
      'Give 4 to 7 concrete beats, specific to THESE characters and this idea. Keep it tight and vivid. ' +
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
    const out: SuggestedPage[] = [];
    for (let i = 0; i < beats.length; i++) {
      const page = await this.writePage(ctx, beats[i], i + 1, beats.length, signal);
      out.push(page);
      onProgress?.(i + 1, beats.length, page);
    }
    return out;
  }

  /** Phase 1: outline the arc as one-line page beats. */
  async planStoryboard(ctx: StoryContext, count: number, signal?: AbortSignal): Promise<string[]> {
    const system =
      `You are a comic book writer. Outline an ordered sequence of exactly ${count} comic pages that together ` +
      'tell a complete mini-arc, consistent with the idea, characters and beats. For each page give a one-line ' +
      `summary of what happens on it. Return ONLY {"pages":[{"summary":""}]} with exactly ${count} items.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + `\n\nOutline ${count} pages as JSON.` },
      ],
      { temperature: 0.7, maxTokens: 1200, schema: STORYBOARD_PLAN_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.pages) ? parsed.pages : [];
    return list.map((p: any) => String(p?.summary ?? '').trim()).filter((s: string) => s.length > 0);
  }

  /** Phase 2: write ONE page's caption + dialogue from its beat — focused call. */
  async writePage(ctx: StoryContext, summary: string, index: number, total: number, signal?: AbortSignal): Promise<SuggestedPage> {
    const system =
      'You are a comic book writer. Write ONE page of the comic: a short caption (the narration for the panel) ' +
      'and dialogue (what a character says on this page; may be an empty string). Stay consistent with the story ' +
      'and this page\'s beat, and match the pacing of its position in the sequence. ' +
      'Return ONLY a JSON object of the form {"caption":"","dialogue":""}.';
    const user =
      this.contextBlock(ctx) +
      `\n\nThis is page ${index} of ${total}. Page beat: ${summary}\n\nWrite this page as JSON.`;
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 700, schema: ONE_PAGE_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    return {
      caption: String(parsed?.caption ?? '').trim() || summary,
      dialogue: String(parsed?.dialogue ?? '').trim(),
    };
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
    return `${heading}\n${composition}\n\n${styleBlock()}`;
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
