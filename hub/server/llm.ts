import { db } from './db.ts';
import { apiKey, llmConfig } from './settings.ts';

export class LlmUnavailable extends Error {
  constructor(message = 'llm unavailable') {
    super(message);
  }
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

let active = 0;
const waiters: Array<() => void> = [];

function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      fn().then(resolve, reject).finally(() => {
        active -= 1;
        waiters.shift()?.();
      });
    };
    if (active < 4) run();
    else waiters.push(run);
  });
}

interface ChatBody {
  choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

async function callModel(
  model: string,
  stable: string,
  variable: string,
  maxTokens: number,
  reasoning: boolean,
): Promise<LlmResult> {
  const key = apiKey();
  if (!key) throw new LlmUnavailable('missing api key');
  const config = llmConfig();
  const payload: Record<string, unknown> = {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: stable },
      { role: 'user', content: variable },
    ],
  };
  if (reasoning) payload.reasoning_effort = 'low';
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LlmUnavailable('llm timeout');
  }
  if (response.status === 400 && reasoning) {
    return callModel(model, stable, variable, maxTokens, false);
  }
  if (!response.ok) throw new LlmUnavailable(`llm ${response.status}`);
  const body = (await response.json()) as ChatBody;
  const message = body.choices?.[0]?.message;
  const text = message?.content || message?.reasoning || '';
  if (!text.trim()) throw new LlmUnavailable('empty llm response');
  const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    text,
    model,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    cachedInputTokens: cached,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

export async function completeJson(options: {
  purpose: 'bible' | 'classify';
  model: string;
  stable: string;
  variable: string;
  maxTokens: number;
  items: number;
}): Promise<LlmResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await withSlot(() =>
        callModel(options.model, options.stable, options.variable, options.maxTokens, true),
      );
      db.prepare(
        `INSERT INTO llm_usage
          (ts, purpose, model, input_tokens, cached_input_tokens, output_tokens, items)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        Date.now(),
        options.purpose,
        result.model,
        result.inputTokens,
        result.cachedInputTokens,
        result.outputTokens,
        options.items,
      );
      return result;
    } catch (error) {
      last = error;
    }
  }
  if (last instanceof LlmUnavailable) throw last;
  throw new LlmUnavailable('llm failed');
}
