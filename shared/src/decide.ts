import type { Strictness, TitleState, Verdict } from './types.ts';

const THRESHOLD: Record<Strictness, number> = { chill: 3, careful: 2, paranoid: 1 };

/** 가림 여부를 결정하는 유일한 함수. Hub 테스트와 확장이 같은 규칙을 쓴다 */
export function shouldBlock(
  v: Verdict,
  title: TitleState | undefined,
  strictness: Strictness,
): boolean {
  if (!title || !title.shieldOn) return false;
  if (v.titleId === null || v.titleId !== title.id || v.level === 0) return false;
  if (v.level < THRESHOLD[strictness]) return false;
  // 위치를 모르면 보수적으로 "앞선 내용"으로 취급한다
  return v.revealsOrdinal === null || v.revealsOrdinal > title.progress;
}
