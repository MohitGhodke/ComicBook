import { AiMessage, ChatOptions } from './ai.model';

/**
 * Transport seam for on-device language models.
 *
 * v1 is `LocalServerAiService` (an OpenAI-compatible localhost server). Later
 * providers — WebLLM (in-browser WebGPU) or an Electron-native runtime
 * (node-llama-cpp / MLX) — implement the same contract, so the wizard and the
 * {@link ComicAssistant} never change. No cloud calls anywhere.
 */
export abstract class AiService {
  /** True if a model server is reachable right now. */
  abstract isAvailable(): Promise<boolean>;

  /** Model ids the server currently has available. */
  abstract listModels(): Promise<string[]>;

  /** Single-turn chat completion; returns the assistant's text. */
  abstract chat(messages: AiMessage[], opts?: ChatOptions): Promise<string>;
}
