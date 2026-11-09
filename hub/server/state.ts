import type { BibleSource, EpisodeMark, HubState, MemoryStatus, Strictness, TitleKind, TitleState } from '../../shared/src/types.ts';
import { deriveGateTerms, readBible } from './bible.ts';
import { db, getSetting, type TitleRow } from './db.ts';
import { flag, rev } from './settings.ts';

function memoryOf(value: string): MemoryStatus {
  if (
    value === 'building' ||
    value === 'ready' ||
    value === 'low_confidence' ||
    value === 'error' ||
    value === 'none'
  ) {
    return value;
  }
  return 'none';
}

function episodesOf(raw: string | null): { episodes: EpisodeMark[]; source: BibleSource } {
  const bible = readBible(raw);
  if (!bible) return { episodes: [], source: 'model' };
  return {
    source: bible.source,
    episodes: bible.episodes.map((episode) => ({
      season: episode.season,
      episode: episode.episode,
      ordinal: episode.ordinal,
    })),
  };
}

export function titleState(row: TitleRow): TitleState {
  const bible = readBible(row.bible_json);
  const view = episodesOf(row.bible_json);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'event' ? 'event' : 'series',
    progress: row.progress,
    totalEpisodes: row.total_episodes,
    shieldOn: row.shield_on === 1,
    memory: memoryOf(row.memory_status),
    gateTerms: deriveGateTerms(row.name, bible),
    episodes: view.episodes,
    source: view.source,
  };
}

export function hubState(): HubState {
  const rows = db.prepare('SELECT * FROM titles ORDER BY created_at ASC').all() as unknown as TitleRow[];
  const strictness = getSetting('strictness');
  const locale = getSetting('locale');
  return {
    rev: rev(),
    shieldOn: flag('shield_on'),
    strictness: strictness === 'chill' || strictness === 'paranoid' ? strictness : 'careful',
    locale: locale === 'ko' || locale === 'en' ? locale : 'system',
    titles: rows.map(titleState),
  };
}

export function strictnessOf(value: string | undefined): Strictness {
  return value === 'chill' || value === 'paranoid' || value === 'careful' ? value : 'careful';
}

export function kindOf(value: string | undefined): TitleKind {
  return value === 'event' ? 'event' : 'series';
}
