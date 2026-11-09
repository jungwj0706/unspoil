import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { anyTermMatches } from '../shared/src/gate.ts';
import { shouldBlock } from '../shared/src/decide.ts';
import type { HubState, TitleState, Verdict } from '../shared/src/types.ts';

interface Item {
  id: string;
  lang: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E';
  split: 'dev' | 'heldout';
  revealsOrdinal: number | null;
  expectBlocked: boolean;
  text: string;
}

interface LabelSet {
  progress: number;
  strictness: 'careful';
  titleHint: string;
  items: Item[];
}

interface Row {
  method: 'keyword' | 'unspoil';
  slice: 'all' | 'heldout';
  miss: number;
  missOf: number;
  over: number;
  overOf: number;
  dShown: number;
  dOf: number;
  n: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = process.env.UNSPOIL_BASE || `http://127.0.0.1:${process.env.UNSPOIL_PORT || 47821}`;
const labels = JSON.parse(fs.readFileSync(path.join(here, 'labeled.json'), 'utf8')) as LabelSet;

function token(): string {
  if (process.env.UNSPOIL_TOKEN) return process.env.UNSPOIL_TOKEN;
  const file = path.join(root, 'data/unspoil.db');
  if (!fs.existsSync(file)) fail('hub를 한 번 실행한 뒤 다시 시도');
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'token'`).get() as { value: string } | undefined;
  db.close();
  if (!row?.value) fail('연결 토큰이 없음');
  return row.value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-unspoil-token': token(),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) fail(`${pathname} ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function pickTitle(state: HubState): TitleState {
  const ready = state.titles.filter((title) => title.memory === 'ready' || title.memory === 'low_confidence');
  const named = ready.find((title) => /squid|오징어/i.test(title.name));
  const title = named ?? ready.find((item) => item.kind === 'series') ?? ready[0];
  if (!title) fail('기억이 준비된 작품이 없음. 작품을 추가하고 키를 저장한 뒤 다시 실행');
  return title;
}

function score(items: Item[], blocked: (item: Item) => boolean): Omit<Row, 'method' | 'slice'> {
  const spoilers = items.filter((item) => item.expectBlocked);
  const safe = items.filter((item) => !item.expectBlocked);
  const early = items.filter((item) => item.category === 'D');
  return {
    miss: spoilers.filter((item) => !blocked(item)).length,
    missOf: spoilers.length,
    over: safe.filter((item) => blocked(item)).length,
    overOf: safe.length,
    dShown: early.filter((item) => !blocked(item)).length,
    dOf: early.length,
    n: items.length,
  };
}

async function classify(titleId: string): Promise<Map<string, Verdict>> {
  const found = new Map<string, Verdict>();
  for (let index = 0; index < labels.items.length; index += 10) {
    const batch = labels.items.slice(index, index + 10);
    const response = await api<{ verdicts: Verdict[] }>('/v1/classify', {
      method: 'POST',
      headers: { 'x-unspoil-nocache': '1' },
      body: JSON.stringify({
        host: 'eval',
        titleIds: [titleId],
        items: batch.map((item) => ({ id: item.id, text: item.text, kind: 'comment' })),
      }),
    });
    for (const verdict of response.verdicts) {
      if (verdict.titleId === titleId || verdict.titleId === null) found.set(verdict.id, verdict);
    }
  }
  return found;
}

const state = await api<HubState>('/v1/state');
const title = pickTitle(state);
const atProgress: TitleState = { ...title, progress: labels.progress, shieldOn: true };
const verdicts = await classify(title.id);
// 응답이 없으면 확장은 흐림을 유지하므로, 평가에서도 차단으로 센다
const modelBlocked = (item: Item) => {
  const verdict = verdicts.get(item.id);
  return !verdict || shouldBlock(verdict, atProgress, labels.strictness);
};
const keywordBlocked = (item: Item) => anyTermMatches(item.text, title.gateTerms);

const slices = [
  ['all', labels.items],
  ['heldout', labels.items.filter((item) => item.split === 'heldout')],
] as const;

const rows: Row[] = [];
for (const [slice, items] of slices) {
  rows.push({ method: 'keyword', slice, ...score(items, keywordBlocked) });
  rows.push({ method: 'unspoil', slice, ...score(items, modelBlocked) });
}

const report = {
  generatedAt: new Date().toISOString(),
  note: `sanity set, n=${labels.items.length}, careful, progress ${labels.progress}, ${title.name}`,
  rows,
};
fs.writeFileSync(path.join(here, 'report.json'), JSON.stringify(report, null, 2));
for (const row of rows) {
  console.log(
    `${row.method} ${row.slice}: miss ${row.miss}/${row.missOf}, over ${row.over}/${row.overOf}, D shown ${row.dShown}/${row.dOf}`,
  );
}
