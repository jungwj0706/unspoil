import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const dataDir = path.join(repoRoot, 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'unspoil.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

export interface TitleRow {
  id: string;
  name: string;
  kind: string;
  progress: number;
  total_episodes: number | null;
  shield_on: number;
  memory_status: string;
  bible_json: string | null;
  bible_version: number;
  created_at: number;
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
