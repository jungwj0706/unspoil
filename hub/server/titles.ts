import { applySynopsis, generateBible, readBible, type StoryBible } from './bible.ts';
import { db, type TitleRow } from './db.ts';
import { bumpRev, llmConfig } from './settings.ts';
import { hubState } from './state.ts';

const running = new Set<string>();

function rowOf(id: string): TitleRow | undefined {
  return db.prepare('SELECT * FROM titles WHERE id = ?').get(id) as TitleRow | undefined;
}

function saveBible(id: string, bible: StoryBible, memory: string) {
  const current = rowOf(id);
  const version = (current?.bible_version ?? 0) + 1;
  db.prepare(
    `UPDATE titles
     SET bible_json = ?, bible_version = ?, memory_status = ?, total_episodes = ?
     WHERE id = ?`,
  ).run(JSON.stringify(bible), version, memory, bible.episodes.length, id);
  bumpRev();
}

export function scheduleBible(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    const row = rowOf(id);
    if (!row) return;
    db.prepare(`UPDATE titles SET memory_status = 'building' WHERE id = ?`).run(id);
    bumpRev();
    try {
      const bible = await generateBible(row.name, row.kind !== 'series' ? 'event' : 'series');
      const memory = bible.confidence < llmConfig().confidenceThreshold ? 'low_confidence' : 'ready';
      saveBible(id, bible, memory);
    } catch (error) {
      db.prepare(`UPDATE titles SET memory_status = 'error' WHERE id = ?`).run(id);
      bumpRev();
      const message = error instanceof Error ? error.message : 'bible failed';
      console.error(`bible failed: ${message}`);
    } finally {
      running.delete(id);
    }
  })();
}

export function createTitle(name: string, kind: 'series' | 'movie' | 'event', progress: number) {
  const id = crypto.randomUUID();
  const max = kind !== 'series' ? 1 : 500;
  const next = Math.max(0, Math.min(max, Math.round(progress)));
  db.prepare(
    `INSERT INTO titles
      (id, name, kind, progress, total_episodes, shield_on, memory_status, bible_json, bible_version, created_at)
     VALUES (?, ?, ?, ?, NULL, 1, 'building', NULL, 0, ?)`,
  ).run(id, name.trim(), kind, next, Date.now());
  bumpRev();
  scheduleBible(id);
  return hubState();
}

export function deleteTitle(id: string) {
  const result = db.prepare('DELETE FROM titles WHERE id = ?').run(id);
  if (result.changes === 0) return null;
  db.prepare('DELETE FROM verdicts WHERE title_id = ?').run(id);
  db.prepare('DELETE FROM overrides WHERE title_id = ?').run(id);
  bumpRev();
  return hubState();
}

export function setProgress(id: string, progress: number) {
  const row = rowOf(id);
  if (!row) return null;
  const cap = row.kind !== 'series' ? 1 : row.total_episodes ?? 500;
  const next = Math.max(0, Math.min(cap, Math.round(progress)));
  db.prepare('UPDATE titles SET progress = ? WHERE id = ?').run(next, id);
  bumpRev();
  return hubState();
}

export function setTitleShield(id: string, shieldOn: boolean) {
  const row = rowOf(id);
  if (!row) return null;
  db.prepare('UPDATE titles SET shield_on = ? WHERE id = ?').run(shieldOn ? 1 : 0, id);
  bumpRev();
  return hubState();
}

export function addSynopsis(id: string, ordinal: number, text: string) {
  const row = rowOf(id);
  if (!row) return null;
  const current = readBible(row.bible_json) ?? {
    canonicalName: row.name,
    aliases: [row.name],
    characters: [],
    episodes: [],
    confidence: 0.75,
    source: 'user' as const,
  };
  const bible = applySynopsis(current, Math.max(1, Math.round(ordinal)), text);
  bible.source = 'hybrid';
  saveBible(id, bible, 'ready');
  return hubState();
}
