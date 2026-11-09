import { getSetting, setSetting } from './db.ts';

export const VERSION = '0.1.0';

const DEFAULTS: Record<string, string> = {
  shield_on: '1',
  strictness: 'careful',
  locale: 'system',
  provider: 'groq',
  base_url: 'https://api.groq.com/openai/v1',
  model: 'openai/gpt-oss-120b',
  bible_model: 'openai/gpt-oss-120b',
  price_input: '0.15',
  price_cached: '0.15',
  price_output: '0.6',
  confidence_threshold: '0.6',
  stat_comments: '0',
  stat_pairs: '0',
  stat_cache_hits: '0',
  rev: '0',
};

export function ensureDefaults() {
  if (!getSetting('token')) setSetting('token', crypto.randomUUID().replaceAll('-', ''));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (getSetting(key) === null) setSetting(key, value);
  }
  if (!getSetting('api_key')) {
    const fromEnv = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
    if (fromEnv) setSetting('api_key', fromEnv);
  }
}

export function token(): string {
  return getSetting('token') ?? '';
}

export function rev(): number {
  return Number(getSetting('rev') ?? '0');
}

export function bumpRev(): number {
  const next = rev() + 1;
  setSetting('rev', String(next));
  return next;
}

export function flag(key: string): boolean {
  return getSetting(key) === '1';
}

export function num(key: string): number {
  return Number(getSetting(key) ?? '0');
}

export function addStat(key: string, amount: number) {
  setSetting(key, String(num(key) + amount));
}

export function apiKey(): string {
  return getSetting('api_key') || process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
}

export function llmConfig() {
  return {
    provider: getSetting('provider') ?? 'groq',
    baseUrl: (getSetting('base_url') ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    model: getSetting('model') ?? 'openai/gpt-oss-120b',
    bibleModel: getSetting('bible_model') ?? getSetting('model') ?? 'openai/gpt-oss-120b',
    apiKey: apiKey(),
    priceInput: num('price_input'),
    priceCached: num('price_cached'),
    priceOutput: num('price_output'),
    confidenceThreshold: num('confidence_threshold') || 0.6,
  };
}
