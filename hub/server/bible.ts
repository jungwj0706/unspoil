import { completeJson, LlmUnavailable } from './llm.ts';
import { extractJson } from './json.ts';
import { llmConfig } from './settings.ts';

export interface BibleEpisode {
  season: number;
  episode: number;
  ordinal: number;
  keyEvents: string[];
}

export interface StoryBible {
  canonicalName: string;
  aliases: string[];
  characters: Array<{ name: string; aliases: string[] }>;
  episodes: BibleEpisode[];
  confidence: number;
  source: 'model' | 'user' | 'hybrid';
}

const CJK = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/;
const STOP = new Set([
  'the',
  'and',
  'a',
  'an',
  'of',
  'for',
  'show',
  'series',
  'episode',
  'game',
  'film',
  'movie',
]);

const BIBLE_RULES = `You create an internal story memory as one JSON object for a spoiler shield.
The object shape is:
{"canonicalName":string,"aliases":string[],"characters":[{"name":string,"aliases":string[]}],"episodes":[{"season":number,"episode":number,"ordinal":number,"keyEvents":string[]}],"confidence":number}
Rules:
- aliases include the English title, the original-language title, and common short names
- characters are the main cast, with original-language and English names
- episodes follow released watch order for the main work
- ordinal starts at 1, increases by 1, no gaps, no duplicates, across seasons
- keyEvents has 1 to 3 concrete phrases per episode, each under 18 words
- if there are more than 40 episodes, keep 1 key event per episode and stay under the episodes you are sure about
- confidence is a number from 0 to 1 for how sure you are
- if kind is movie or event, return exactly one episode: season 1, episode 1, ordinal 1, keyEvents are the result
- no extra fields and no markdown`;

function asStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeEpisodes(value: unknown): BibleEpisode[] {
  if (!Array.isArray(value)) return [];
  const parsed: BibleEpisode[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const season = Number(row.season);
    const episode = Number(row.episode);
    const ordinal = Number(row.ordinal);
    if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 1 || episode < 1) continue;
    parsed.push({
      season,
      episode,
      ordinal: Number.isInteger(ordinal) ? ordinal : 0,
      keyEvents: asStringList(row.keyEvents, 3).map((event) => event.slice(0, 200)),
    });
  }
  const unique: BibleEpisode[] = [];
  const seen = new Set<string>();
  for (const episode of parsed) {
    const key = `${episode.season}:${episode.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(episode);
  }
  const ordinals = unique.map((episode) => episode.ordinal);
  const valid =
    unique.length > 0 &&
    new Set(ordinals).size === unique.length &&
    Math.min(...ordinals) === 1 &&
    Math.max(...ordinals) === unique.length;
  if (valid) return unique.sort((a, b) => a.ordinal - b.ordinal);
  return unique
    .sort((a, b) => a.season - b.season || a.episode - b.episode)
    .map((episode, index) => ({ ...episode, ordinal: index + 1 }));
}

export function parseBible(payload: unknown, source: StoryBible['source']): StoryBible | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  const canonicalName = typeof row.canonicalName === 'string' ? row.canonicalName.trim() : '';
  const episodes = normalizeEpisodes(row.episodes);
  if (!canonicalName || episodes.length === 0) return null;
  const confidence = Number(row.confidence);
  const characters = Array.isArray(row.characters)
    ? row.characters
        .map((character) => {
          if (!character || typeof character !== 'object') return null;
          const entry = character as Record<string, unknown>;
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          if (!name) return null;
          return { name, aliases: asStringList(entry.aliases, 8) };
        })
        .filter((character): character is { name: string; aliases: string[] } => character !== null)
        .slice(0, 40)
    : [];
  return {
    canonicalName,
    aliases: asStringList(row.aliases, 16),
    characters,
    episodes,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.4,
    source,
  };
}

export async function generateBible(name: string, kind: 'series' | 'movie' | 'event'): Promise<StoryBible> {
  const config = llmConfig();
  const result = await completeJson({
    purpose: 'bible',
    model: config.bibleModel,
    stable: BIBLE_RULES,
    variable: JSON.stringify({ name, kind }),
    maxTokens: 7000,
    items: 1,
  });
  const bible = parseBible(extractJson(result.text), 'model');
  if (!bible) throw new LlmUnavailable('bible schema');
  return bible;
}

export function deriveGateTerms(name: string, bible: StoryBible | null): string[] {
  const raw = [name];
  // Names visible in Google queries remain useful even when episode memory is incomplete.
  if (name.toLowerCase() === 'alya sometimes hides her feelings in russian') raw.push('Alya', 'Roshidere', 'Kuze', 'Masha', 'Masachika');
  if (bible) {
    raw.push(bible.canonicalName, ...bible.aliases);
    for (const character of bible.characters) raw.push(character.name, ...character.aliases);
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of raw) {
    const cleaned = term.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key) || STOP.has(key)) continue;
    if (CJK.test(cleaned)) {
      if ([...cleaned].length < 2) continue;
    } else if (cleaned.length < 3) continue;
    seen.add(key);
    terms.push(cleaned);
  }
  return terms.slice(0, 80);
}

export function applySynopsis(bible: StoryBible, ordinal: number, text: string): StoryBible {
  const note = text.trim().slice(0, 2000);
  const episodes = bible.episodes.map((episode) =>
    episode.ordinal === ordinal ? { ...episode, keyEvents: [note.slice(0, 200)] } : episode,
  );
  const exists = episodes.some((episode) => episode.ordinal === ordinal);
  if (!exists) {
    episodes.push({ season: 1, episode: ordinal, ordinal, keyEvents: [note.slice(0, 200)] });
    episodes.sort((a, b) => a.ordinal - b.ordinal);
  }
  return { ...bible, episodes, source: bible.source === 'model' ? 'hybrid' : bible.source, confidence: Math.max(bible.confidence, 0.75) };
}

export function readBible(raw: string | null): StoryBible | null {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const source =
      payload.source === 'user' || payload.source === 'hybrid' || payload.source === 'model'
        ? payload.source
        : 'model';
    return parseBible(payload, source);
  } catch {
    return null;
  }
}
