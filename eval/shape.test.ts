import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

interface Item {
  id: string;
  lang: string;
  category: string;
  split: string;
  revealsOrdinal: number | null;
  expectBlocked: boolean;
  text: string;
}

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'labeled.json');
const set = JSON.parse(fs.readFileSync(file, 'utf8')) as { progress: number; items: Item[] };

test('label set matches the promised mix', () => {
  const items = set.items;
  assert.equal(set.progress, 5);
  assert.equal(items.length, 30);
  assert.equal(new Set(items.map((item) => item.id)).size, 30);
  const count = (pick: (item: Item) => boolean) => items.filter(pick).length;
  assert.equal(count((item) => item.split === 'dev'), 20);
  assert.equal(count((item) => item.split === 'heldout'), 10);
  assert.deepEqual(
    Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((category) => [category, count((item) => item.category === category)])),
    { A: 8, B: 6, C: 5, D: 6, E: 5 },
  );
  assert.deepEqual(
    Object.fromEntries(['ko', 'en', 'ja', 'es'].map((lang) => [lang, count((item) => item.lang === lang)])),
    { ko: 12, en: 12, ja: 3, es: 3 },
  );
  for (const item of items) {
    assert.ok(item.text.trim().length > 0);
    const later = item.category === 'A' || item.category === 'B';
    assert.equal(item.expectBlocked, later);
    if (later) assert.ok((item.revealsOrdinal ?? 0) > set.progress);
    if (item.category === 'D') assert.ok((item.revealsOrdinal ?? 99) <= set.progress);
  }
});
