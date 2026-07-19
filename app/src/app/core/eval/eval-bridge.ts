import { inject, Injectable, isDevMode } from '@angular/core';
import { ComicAssistant, StoryContext, SuggestedCharacter, SuggestedPage } from '../services/ai/comic-assistant';
import { AiConfig } from '../services/ai/ai.config';
import { AiService } from '../services/ai/ai.service';
import { AiMessage, ChatOptions } from '../services/ai/ai.model';

/**
 * Everything one full pipeline run produces, captured step by step. This is the
 * exact hand-off chain the wizard uses (idea → characters → beats → pages), so
 * an eval can measure whether the "thread" survives each step.
 */
export interface EvalArtifacts {
  rawIdea: string;
  /** Step 1 output. */
  title: string;
  logline: string;
  /** Step 2 output. */
  characters: SuggestedCharacter[];
  /** Step 3 output (the scene beats / synopsis). */
  beats: string;
  /** Step 4 output. */
  pages: SuggestedPage[];
  /** Provenance so a report says which model/server produced this. */
  model: string;
  baseUrl: string;
  pageCount: number;
}

export interface EvalRunOptions {
  pageCount?: number;
  /** Point the run at a specific local server / model just for this run. */
  baseUrl?: string;
  model?: string;
}

/**
 * DEV-ONLY test seam. When the app runs under `ng serve`, this exposes the real
 * comic pipeline on `window.__comicEval` so an end-to-end eval (Playwright) can
 * drive the actual four steps against the actual local model and read back
 * structured artifacts — instead of scraping the DOM. It is gated on
 * {@link isDevMode} and never attaches in a production build.
 *
 * It reuses the very same {@link ComicAssistant} the wizard uses and mirrors the
 * wizard's hand-off exactly: the refined LOGLINE (not the raw idea) becomes the
 * downstream `idea`, the beats become the `synopsis`. So what it measures is the
 * real product, not a parallel reimplementation.
 */
@Injectable({ providedIn: 'root' })
export class EvalBridge {
  private assistant = inject(ComicAssistant);
  private cfg = inject(AiConfig);
  private ai = inject(AiService);

  /** Run the whole pipeline once, capturing every step's output. */
  async run(rawIdea: string, opts: EvalRunOptions = {}): Promise<EvalArtifacts> {
    if (opts.baseUrl) this.cfg.baseUrl = opts.baseUrl;
    if (opts.model !== undefined) this.cfg.model = opts.model;
    const pageCount = Math.min(Math.max(opts.pageCount ?? 6, 1), 12);

    // Step 1 — Idea. The wizard uses the refined logline downstream.
    const shaped = await this.assistant.shapeIdea(rawIdea);
    const ctx: StoryContext = { idea: shaped.logline || rawIdea, characters: [] };

    // Step 2 — Characters (fed by the idea).
    const characters = await this.assistant.suggestCharacters(ctx);
    ctx.characters = characters.map((c) => ({ name: c.name, appearance: c.appearance, traits: c.traits }));

    // Step 3 — Interactions / beats (fed by idea + characters). Becomes synopsis.
    const beats = await this.assistant.draftInteractions(ctx);
    ctx.synopsis = beats;

    // Step 4 — Pages (fed by idea + characters + beats).
    const pages = await this.assistant.storyboardPages(ctx, pageCount);

    return {
      rawIdea,
      title: shaped.title,
      logline: shaped.logline,
      characters,
      beats,
      pages,
      model: this.cfg.model,
      baseUrl: this.cfg.baseUrl,
      pageCount,
    };
  }

  /** Passthrough to the same on-device model — used by the LLM-judge step. */
  chat(messages: AiMessage[], opts?: ChatOptions): Promise<string> {
    return this.ai.chat(messages, opts);
  }

  isAvailable(): Promise<boolean> {
    return this.ai.isAvailable();
  }

  listModels(): Promise<string[]> {
    return this.ai.listModels();
  }
}

/** Attach the bridge to `window.__comicEval`, but only under `ng serve`. */
export function installEvalBridge(bridge: EvalBridge): void {
  if (typeof window !== 'undefined' && isDevMode()) {
    (window as unknown as { __comicEval?: EvalBridge }).__comicEval = bridge;
  }
}
