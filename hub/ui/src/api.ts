import type { HubState, Strictness, TitleKind } from '@unspoil/shared';

export interface SettingsView {
  provider: string;
  baseUrl: string;
  model: string;
  bibleModel: string;
  hasKey: boolean;
  keyMask: string;
  priceInput: number;
  priceCached: number;
  priceOutput: number;
  port: number;
  token: string;
  version: string;
  extensionSeenAt: number | null;
  locale: 'system' | 'ko' | 'en';
  strictness: Strictness;
  shieldOn: boolean;
}

export interface ReportEvent {
  ts: number;
  host: string;
  titleId: string | null;
  titleName: string | null;
  decision: string;
  reason: string | null;
  cached: boolean;
  latencyMs: number | null;
}

export interface Report {
  blocked: number;
  shown: number;
  reportedWrong: number;
  cacheHitRate: number;
  latencyP50: number | null;
  costPerThousand: number;
  titlesToday: number;
  perTitle: Record<string, number>;
  events: ReportEvent[];
}

export interface ProofRow {
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

export interface Proof {
  empty?: boolean;
  generatedAt?: string;
  note?: string;
  rows?: ProofRow[];
}

export type LiveState = HubState & { extensionSeenAt?: number | null };

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || 'request failed');
  return body;
}

export const api = {
  state: (since: number) => send<LiveState & { unchanged?: boolean }>(`/v1/state?since=${since}`),
  settings: () => send<SettingsView>('/v1/settings'),
  saveSettings: (patch: Record<string, unknown>) =>
    send<LiveState>('/v1/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  report: () => send<Report>('/v1/report'),
  proof: () => send<Proof>('/v1/proof'),
  createTitle: (name: string, kind: TitleKind, progress: number) =>
    send<LiveState>('/v1/titles', { method: 'POST', body: JSON.stringify({ name, kind, progress }) }),
  progress: (id: string, progress: number) =>
    send<LiveState>(`/v1/titles/${id}/progress`, { method: 'PUT', body: JSON.stringify({ progress }) }),
  shield: (id: string, shieldOn: boolean) =>
    send<LiveState>(`/v1/titles/${id}/shield`, { method: 'PUT', body: JSON.stringify({ shieldOn }) }),
  remove: (id: string) => send<LiveState>(`/v1/titles/${id}`, { method: 'DELETE' }),
  retry: (id: string) => send<LiveState>(`/v1/titles/${id}/retry-bible`, { method: 'POST' }),
  synopsis: (id: string, ordinal: number, text: string) =>
    send<LiveState>(`/v1/titles/${id}/synopsis`, {
      method: 'POST',
      body: JSON.stringify({ ordinal, text }),
    }),
  reset: () => send<LiveState>('/v1/reset', { method: 'POST' }),
};
