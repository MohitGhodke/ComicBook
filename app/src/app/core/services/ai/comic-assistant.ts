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

const CHARACTERS_SCHEMA = {
  name: 'characters',
  schema: {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            appearance: { type: 'string' },
            traits: { type: 'string' },
          },
          required: ['name', 'appearance', 'traits'],
        },
      },
    },
    required: ['characters'],
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

const PAGES_SCHEMA = {
  name: 'pages',
  schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            caption: { type: 'string' },
            dialogue: { type: 'string' },
          },
          required: ['caption', 'dialogue'],
        },
      },
    },
    required: ['pages'],
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

  // ── Step 2: Characters (inferred from the idea) ──────────────────────────────
  async suggestCharacters(ctx: StoryContext, signal?: AbortSignal): Promise<SuggestedCharacter[]> {
    const existing = ctx.characters.map((c) => c.name).filter(Boolean);
    const system =
      'You are a comic book story editor. From the story context, propose the key characters the story needs — ' +
      'including any character implied by the idea (for example, a person the idea says did something). ' +
      'For each character give: name, appearance (one vivid sentence), and traits (one sentence on personality and role). ' +
      'Propose 2 to 4 characters. Do NOT repeat characters that are already listed. ' +
      'Return ONLY a JSON object of the form {"characters":[{"name":"","appearance":"","traits":""}]}.';
    const user =
      this.contextBlock(ctx) +
      (existing.length ? `\n\nAlready created (do not repeat): ${existing.join(', ')}` : '') +
      '\n\nReturn the characters JSON.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 1600, schema: CHARACTERS_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.characters) ? parsed.characters : [];
    return list
      .map((c: any) => ({
        name: String(c?.name ?? '').trim(),
        appearance: String(c?.appearance ?? '').trim(),
        traits: String(c?.traits ?? '').trim(),
      }))
      .filter((c: SuggestedCharacter) => c.name.length > 0);
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

  // ── Step 4: Pages (storyboard from everything) ───────────────────────────────
  async storyboardPages(ctx: StoryContext, count: number, signal?: AbortSignal): Promise<SuggestedPage[]> {
    const system =
      `You are a comic book writer. Turn the story into an ordered sequence of ${count} comic pages that flow one to the next ` +
      'and tell a complete mini-arc consistent with the characters and beats. ' +
      'For each page give a short caption (the narration for that panel) and dialogue (what a character says on that page; may be an empty string). ' +
      'Return ONLY a JSON object of the form {"pages":[{"caption":"","dialogue":""}]}.';
    const raw = await this.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: this.contextBlock(ctx) + `\n\nWrite ${count} pages as JSON.` },
      ],
      { temperature: 0.7, maxTokens: 2600, schema: PAGES_SCHEMA, signal },
    );
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.pages) ? parsed.pages : [];
    return list
      .map((p: any) => ({
        caption: String(p?.caption ?? '').trim(),
        dialogue: String(p?.dialogue ?? '').trim(),
      }))
      .filter((p: SuggestedPage) => p.caption.length > 0 || p.dialogue.length > 0);
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
