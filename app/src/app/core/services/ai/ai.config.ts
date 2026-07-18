import { Injectable } from '@angular/core';

const URL_KEY = 'comic-studio-ai-url';
const MODEL_KEY = 'comic-studio-ai-model';

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
}
