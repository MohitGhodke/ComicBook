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
    // One logical completion, including the "starved mid-reasoning" retry:
    // reasoning models spend an unpredictable share of the token budget
    // "thinking" before the answer appears in `content`; if the budget runs out
    // mid-reasoning, retry once with a much larger allowance.
    const budget = opts.maxTokens ?? 400;
    const attempt = async (): Promise<string> => {
      let out = await this.completeOnce(messages, opts, budget);
      if (out === null) out = await this.completeOnce(messages, opts, budget * 4);
      if (out === null) {
        throw new Error(
          'The model used all its tokens thinking, even after retrying with a larger budget. ' +
            'Pick a smaller/non-reasoning model, or turn off thinking in your local server.',
        );
      }
      return out;
    };
    // Transient server failures — a dropped connection, a 5xx, or LM Studio's
    // intermittent gpt-oss "Channel Error" (a 400 from the model runtime) — are
    // usually one-offs. Retry a couple of times with a short backoff so a single
    // hiccup doesn't fail the caller's whole flow. A real cancel is never retried.
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await attempt();
      } catch (e: any) {
        if (e?.name === 'AbortError' || opts.signal?.aborted) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 350 * (i + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('chat request failed');
  }

  /** One completion attempt. Returns null when the model starved mid-reasoning. */
  private async completeOnce(messages: AiMessage[], opts: ChatOptions, maxTokens: number): Promise<string | null> {
    const body: Record<string, unknown> = {
      model: await this.resolveModel(),
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: maxTokens,
      stream: false,
    };
    // Structured output is opt-in: grammar-constrained decoding degrades some
    // local models into "…" filler. When off (the default), callers still ask
    // for JSON in the prompt and parse defensively. See AiConfig.structuredOutput.
    if (opts.schema && this.cfg.structuredOutput) {
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
    if (!res.ok) {
      // Include the server's message (e.g. LM Studio's "Channel Error") so a
      // genuine, non-transient failure is legible instead of a bare status code.
      const detail = await res.text().catch(() => '');
      throw new Error(`chat request failed: ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const content = stripThinking(choice?.message?.content ?? '');
    // Some servers put chain-of-thought in `reasoning_content` and the answer
    // in `content`; if the budget ran out during reasoning, `content` is empty
    // (or is one truncated <think> block) with finish_reason "length".
    if (!content && choice?.finish_reason === 'length') return null;
    return content;
  }
}

/**
 * Remove chain-of-thought a reasoning model leaks into `content` as
 * <think>…</think> blocks. An unclosed <think> means the reply was cut off
 * mid-reasoning — everything from it onward is thinking, not answer.
 */
function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  return out.trim();
}
