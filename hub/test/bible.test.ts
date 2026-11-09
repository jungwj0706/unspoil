import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveGateTerms, normalizeEpisodes, parseBible, readBible } from '../server/bible.ts';
import { parseModelItems } from '../server/classify.ts';
import { extractJson } from '../server/json.ts';

test('episode ordinals are repaired into a continuous watch order', () => {
  const episodes = normalizeEpisodes([
    { season: 1, episode: 2, ordinal: 9, keyEvents: ['second'] },
    { season: 1, episode: 2, ordinal: 3, keyEvents: ['duplicate'] },
    { season: 1, episode: 1, ordinal: 4, keyEvents: ['first'] },
  ]);
  assert.deepEqual(
    episodes.map((episode) => episode.ordinal),
    [1, 2],
  );
  assert.equal(episodes[0].keyEvents[0], 'first');
});

test('valid ordinals stay untouched', () => {
  const episodes = normalizeEpisodes([
    { season: 1, episode: 2, ordinal: 2, keyEvents: ['b'] },
    { season: 1, episode: 1, ordinal: 1, keyEvents: ['a'] },
  ]);
  assert.equal(episodes[0].ordinal, 1);
  assert.equal(episodes[1].episode, 2);
});

test('bible round trip keeps hybrid source and hides nothing required', () => {
  const bible = parseBible(
    {
      canonicalName: 'Squid Game',
      aliases: ['오징어 게임'],
      characters: [{ name: 'Gi-hun', aliases: ['성기훈'] }],
      episodes: [{ season: 1, episode: 1, ordinal: 1, keyEvents: ['red light'] }],
      confidence: 0.9,
    },
    'model',
  );
  assert.ok(bible);
  bible.source = 'hybrid';
  const again = readBible(JSON.stringify(bible));
  assert.equal(again?.source, 'hybrid');
  assert.equal(again?.episodes[0].keyEvents[0], 'red light');
  assert.deepEqual(deriveGateTerms('Squid Game', again), ['Squid Game', '오징어 게임', 'Gi-hun', '성기훈']);
});

test('model items drop prose and force safe when unrelated', () => {
  const parsed = parseModelItems(
    extractJson('note\n{"items":[{"id":"a","about_title":false,"season":9,"episode":9,"level":3,"reason":"ending"},{"id":"b","about_title":"true","season":"6","episode":"6","level":2,"reason":"plot"}]}'),
  );
  assert.equal(parsed.get('a')?.level, 0);
  assert.equal(parsed.get('a')?.reason, null);
  assert.equal(parsed.get('b')?.season, 6);
  assert.equal(parsed.get('b')?.level, 2);
  assert.equal(parsed.get('b')?.reason, 'plot');
});

test('malformed model relevance cannot silently become a safe verdict', () => {
  assert.equal(parseModelItems({ items: [{ id: 'bad', level: 3, reason: 'ending' }] }).size, 0);
});
