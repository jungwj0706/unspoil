import type { Decision, ReasonCode } from '../../shared/src/types.ts';
import { REASON_CODES } from '../../shared/src/types.ts';
import { db } from './db.ts';
import { llmConfig, num } from './settings.ts';

const DECISIONS = new Set<Decision>(['blocked', 'shown', 'revealed', 'reported_wrong']);

export interface IncomingEvent {
  ts?: number;
  host?: string;
  titleId?: string | null;
  decision?: string;
  reason?: string | null;
  cached?: boolean;
  latencyMs?: number | null;
}

export function recordEvents(events: IncomingEvent[]) {
  const insert = db.prepare(
    `INSERT INTO events (ts, host, title_id, decision, reason, cached, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of events.slice(0, 100)) {
    if (!event.decision || !DECISIONS.has(event.decision as Decision)) continue;
    const reason =
      event.reason && REASON_CODES.includes(event.reason as ReasonCode) ? event.reason : null;
    insert.run(
      Number.isFinite(event.ts) ? Number(event.ts) : Date.now(),
      String(event.host ?? 'unknown').slice(0, 200),
      event.titleId ? String(event.titleId).slice(0, 80) : null,
      event.decision,
      reason,
      event.cached ? 1 : 0,
      Number.isFinite(event.latencyMs) ? Math.round(Number(event.latencyMs)) : null,
    );
  }
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

export function report() {
  const counts = db
    .prepare('SELECT decision, COUNT(*) AS count FROM events GROUP BY decision')
    .all() as Array<{ decision: string; count: number }>;
  const byDecision = Object.fromEntries(counts.map((row) => [row.decision, row.count]));
  const latencies = (
    db.prepare('SELECT latency_ms FROM events WHERE latency_ms IS NOT NULL').all() as Array<{
      latency_ms: number;
    }>
  ).map((row) => row.latency_ms);
  const usage = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM llm_usage`,
    )
    .get() as { input_tokens: number; cached_input_tokens: number; output_tokens: number };
  const prices = llmConfig();
  const freshInput = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  const cost =
    (freshInput / 1_000_000) * prices.priceInput +
    (usage.cached_input_tokens / 1_000_000) * prices.priceCached +
    (usage.output_tokens / 1_000_000) * prices.priceOutput;
  const comments = num('stat_comments');
  const pairs = num('stat_pairs');
  const hits = num('stat_cache_hits');
  const today = startOfToday();
  const protectedTitles = db
    .prepare(
      `SELECT COUNT(DISTINCT title_id) AS count
       FROM events WHERE ts >= ? AND title_id IS NOT NULL`,
    )
    .get(today) as { count: number };
  const perTitle = db
    .prepare(
      `SELECT title_id, COUNT(*) AS count
       FROM events WHERE ts >= ? AND decision = 'blocked' AND title_id IS NOT NULL
       GROUP BY title_id`,
    )
    .all(today) as Array<{ title_id: string; count: number }>;
  const events = db
    .prepare(
      `SELECT ts, host, title_id, decision, reason, cached, latency_ms
       FROM events ORDER BY id DESC LIMIT 20`,
    )
    .all() as Array<{
    ts: number;
    host: string;
    title_id: string | null;
    decision: string;
    reason: string | null;
    cached: number;
    latency_ms: number | null;
  }>;
  const names = db.prepare('SELECT id, name FROM titles').all() as Array<{ id: string; name: string }>;
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  return {
    blocked: byDecision.blocked ?? 0,
    shown: byDecision.shown ?? 0,
    reportedWrong: byDecision.reported_wrong ?? 0,
    cacheHitRate: pairs > 0 ? hits / pairs : 0,
    latencyP50: median(latencies),
    costPerThousand: comments > 0 ? (cost / comments) * 1000 : 0,
    titlesToday: protectedTitles.count,
    perTitle: Object.fromEntries(perTitle.map((row) => [row.title_id, row.count])),
    events: events.map((event) => ({
      ts: event.ts,
      host: event.host,
      titleId: event.title_id,
      titleName: event.title_id ? (nameOf.get(event.title_id) ?? null) : null,
      decision: event.decision,
      reason: event.reason,
      cached: event.cached === 1,
      latencyMs: event.latency_ms,
    })),
  };
}
