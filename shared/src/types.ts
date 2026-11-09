export type TitleKind = 'series' | 'event';
export type Strictness = 'chill' | 'careful' | 'paranoid';
export type MemoryStatus = 'none' | 'building' | 'ready' | 'low_confidence' | 'error';
export type BibleSource = 'model' | 'user' | 'hybrid';

export interface EpisodeMark {
  season: number;
  episode: number;
  ordinal: number;
}

export interface TitleState {
  id: string;
  name: string;
  kind: TitleKind;
  /** 마지막으로 본 화의 시즌 통산 순번. 0 = 아직 안 봄. event는 0 또는 1 */
  progress: number;
  totalEpisodes: number | null;
  shieldOn: boolean;
  memory: MemoryStatus;
  /** 관련성 게이트용 정규화 용어(별칭, 인물명 등) */
  gateTerms: string[];
  episodes: EpisodeMark[];
  source: BibleSource;
}

export interface HubState {
  /** 상태가 바뀔 때마다 1씩 증가 */
  rev: number;
  shieldOn: boolean;
  strictness: Strictness;
  locale: 'system' | 'ko' | 'en';
  titles: TitleState[];
}

export type ItemKind = 'comment' | 'post' | 'title' | 'snippet';

export interface ClassifyItem {
  id: string;
  text: string;
  kind: ItemKind;
}

export interface ClassifyRequest {
  /** Hub에만 기록하며 LLM에는 전송하지 않는다 */
  host: string;
  /** 최대 3 */
  titleIds: string[];
  /** 최대 40 */
  items: ClassifyItem[];
}

/** 화면에 표시되는 이유는 이 코드에서 라벨로만 변환한다. 모델의 자유 문장은 사용하지 않는다 */
export type ReasonCode = 'plot' | 'ending' | 'twist' | 'reaction' | 'later_episode';

/** 0 무관·안전, 1 암시·반응, 2 전개 노출, 3 핵심 반전·결말 노출 */
export type Level = 0 | 1 | 2 | 3;

export interface Verdict {
  id: string;
  hash: string;
  titleId: string | null;
  /** 드러내는 가장 뒤쪽 화의 통산 순번. null = 위치 불명 */
  revealsOrdinal: number | null;
  level: Level;
  reason: ReasonCode | null;
  cached: boolean;
}

export interface ClassifyResponse {
  stateRev: number;
  verdicts: Verdict[];
  meta: { latencyMs: number; cacheHits: number; llmCalls: number };
}

export type Decision = 'blocked' | 'shown' | 'revealed' | 'reported_wrong';

export interface UnspoilEvent {
  ts: number;
  host: string;
  titleId: string | null;
  decision: Decision;
  reason: ReasonCode | null;
  cached: boolean;
  latencyMs: number | null;
}

export const REASON_CODES: ReasonCode[] = [
  'plot',
  'ending',
  'twist',
  'reaction',
  'later_episode',
];

export const LEVELS: Level[] = [0, 1, 2, 3];
