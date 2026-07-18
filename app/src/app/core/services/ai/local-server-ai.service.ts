import { Injectable, inject } from '@angular/core';
import { AiService } from './ai.service';
import { AiConfig } from './ai.config';
import { AiMessage, ChatOptions } from './ai.model';

/**
 * Talks to a local, OpenAI-compatible inference server (LM Studio, Ollama,
 * mlx-lm, LM Studio, …) over plain fetch. Everything stays on the user's
 * machine/LAN — no cloud.
 */
@Injectable({ providedIn: 'root' })
export class LocalServerAiService extends AiService {
  private cfg = inject(AiConfig);
  private cachedModels: string[] | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/models`, { method: 'GET' });
    if (!res.ok) throw new Error(`models request failed: ${res.status}`);
    const data = await res.json();
    const ids: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
    this.cachedModels = ids;
    return ids;
  }

  private async resolveModel(): Promise<string> {
    if (this.cfg.model) return this.cfg.model;
    const ids = this.cachedModels ?? (await this.listModels());
    return ids[0] ?? 'local-model';
  }

  async chat(messages: AiMessage[], opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: await this.resolveModel(),
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 400,
      stream: false,
    };
    if (opts.schema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema },
      };
    }

    const res = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`chat request failed: ${res.status}`);
    const data = await res.json();
    const choice = data?.choices?.[0];
    const content = (choice?.message?.content ?? '').trim();
    // Reasoning models emit chain-of-thought into `reasoning_content` and the
    // answer into `content`. If the token budget runs out during reasoning the
    // server returns finish_reason "length" with an empty `content` — surface
    // that clearly instead of returning nothing.
    if (!content && choice?.finish_reason === 'length') {
      throw new Error('The model used all its tokens before answering. Try again (or pick a smaller/non-reasoning model).');
    }
    return content;
  }
}
