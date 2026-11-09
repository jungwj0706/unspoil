import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBlock } from '../src/decide.ts';
import { formatProgress } from '../src/format.ts';
import { anyTermMatches, termMatches } from '../src/gate.ts';
import { hashText, normalizeText } from '../src/hash.ts';
import { t } from '../src/i18n.ts';
import type { TitleState, Verdict } from '../src/types.ts';

const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function title(partial: Partial<TitleState> = {}): TitleState {
  return {
    id: 't1',
    name: 'Squid Game',
    kind: 'series',
    progress: 5,
    totalEpisodes: 9,
    shieldOn: true,
    memory: 'ready',
    gateTerms: ['squid game', '기훈'],
    episodes: [],
    source: 'model',
    ...partial,
  };
}

function verdict(partial: Partial<Verdict> = {}): Verdict {
  return {
    id: 'c1',
    hash: 'abc',
    titleId: 't1',
    revealsOrdinal: 9,
    level: 2,
    reason: 'plot',
    cached: false,
    ...partial,
  };
}

test('normalize collapses case, width, and spaces', () => {
  assert.equal(normalizeText('  Hello   WORLD '), 'hello world');
  assert.equal(normalizeText('Ｈｅｌｌｏ'), 'hello');
  assert.equal(normalizeText(`line\n\nbreak`), 'line break');
  assert.equal(normalizeText('가'.repeat(600)).length, 500);
});

test('hash matches known sha-256 vectors', async () => {
  assert.equal(await hashText('hello'), HELLO_SHA);
  assert.equal(await hashText('  HELLO '), HELLO_SHA);
  assert.equal(await hashText('Ｈｅｌｌｏ'), HELLO_SHA);
  const spaced = await hashText('squid   game');
  const tight = await hashText('squid game');
  assert.equal(spaced, tight);
  const korean = await hashText('오징어 게임');
  assert.match(korean, /^[0-9a-f]{64}$/);
  assert.notEqual(korean, HELLO_SHA);
});

test('shouldBlock follows progress and strictness', () => {
  const show = title();
  assert.equal(shouldBlock(verdict(), undefined, 'careful'), false);
  assert.equal(shouldBlock(verdict(), title({ shieldOn: false }), 'careful'), false);
  assert.equal(shouldBlock(verdict({ titleId: null, level: 0 }), show, 'careful'), false);
  assert.equal(shouldBlock(verdict({ titleId: 'other' }), show, 'careful'), false);
  assert.equal(shouldBlock(verdict({ level: 0 }), show, 'careful'), false);
  assert.equal(shouldBlock(verdict({ level: 1 }), show, 'careful'), false);
  assert.equal(shouldBlock(verdict({ level: 1 }), show, 'paranoid'), true);
  assert.equal(shouldBlock(verdict({ level: 2 }), show, 'chill'), false);
  assert.equal(shouldBlock(verdict({ level: 3 }), show, 'chill'), true);
  assert.equal(shouldBlock(verdict({ revealsOrdinal: 5 }), show, 'careful'), false);
  assert.equal(shouldBlock(verdict({ revealsOrdinal: 6 }), show, 'careful'), true);
  assert.equal(shouldBlock(verdict({ revealsOrdinal: null }), show, 'careful'), true);
});

test('gate terms respect script length and latin word boundaries', () => {
  assert.equal(termMatches('I love Squid Game theories', 'squid game'), true);
  assert.equal(termMatches('gamer news today', 'game'), false);
  assert.equal(termMatches('기훈이 우산을 골랐다', '기훈'), true);
  assert.equal(termMatches('기', '기'), false);
  assert.equal(termMatches('the magician arrived', 'gi'), false);
  assert.equal(anyTermMatches('player 067 was here', ['067']), true);
  assert.equal(anyTermMatches('player 067 was here', ['player 067']), true);
});

test('copy and progress labels stay spoiler-free', () => {
  assert.equal(t('en', 'reason.plot'), 'Plot');
  assert.equal(t('ko', 'reason.twist'), '반전');
  assert.equal(t('en', 'overlay.moved', { label: 'Ep 9', count: 14 }), 'Moved to Ep 9 · 14 unlocked');
  assert.equal(formatProgress('en', 0, []), 'Not started');
  assert.equal(
    formatProgress('en', 5, [{ season: 1, episode: 5, ordinal: 5 }]),
    'S1 E5',
  );
  assert.equal(formatProgress('ko', 5, []), '5화');
});
