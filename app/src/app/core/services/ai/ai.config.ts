import { Injectable } from '@angular/core';

const URL_KEY = 'comic-studio-ai-url';
const MODEL_KEY = 'comic-studio-ai-model';
const STRUCTURED_KEY = 'comic-studio-ai-structured';

/** Default local inference server (LM Studio / Ollama / mlx-lm on localhost). */
const DEFAULT_URL = 'http://192.168.0.228:1234';

/**
 * Runtime configuration for the local AI provider. Persisted to localStorage so
 * the user can point at a different on-device server or pick another loaded
 * model without a rebuild.
 */
@Injectable({ providedIn: 'root' })
export class AiConfig {
  get baseUrl(): string {
    return localStorage.getItem(URL_KEY) || DEFAULT_URL;
  }
  set baseUrl(v: string) {
    localStorage.setItem(URL_KEY, v.trim().replace(/\/+$/, ''));
  }

  /** Preferred model id; empty means "use the first model the server reports". */
  get model(): string {
    return localStorage.getItem(MODEL_KEY) || '';
  }
  set model(v: string) {
    localStorage.setItem(MODEL_KEY, v);
  }

  /**
   * Whether to constrain replies with server-side structured output
   * (`response_format: json_schema`). Default OFF: grammar-constrained decoding
   * makes some local models (e.g. gpt-oss-20b) emit degenerate "…" filler
   * instead of real prose. With it off we ask for JSON in the prompt and parse
   * defensively (see `parseJsonObject`), which is far more reliable here. Turn
   * on only for a model that demonstrably produces better structured output.
   */
  get structuredOutput(): boolean {
    return localStorage.getItem(STRUCTURED_KEY) === 'true';
  }
  set structuredOutput(v: boolean) {
    localStorage.setItem(STRUCTURED_KEY, String(v));
  }
}
