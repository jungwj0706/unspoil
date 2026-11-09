import { catalogEntry, searchCatalog } from './catalog.ts';
import fs from 'node:fs';
import path from 'node:path';
import { getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, repoRoot, setSetting } from './db.ts';
import { LlmUnavailable, LlmRateLimited } from './llm.ts';
import { recordEvents, report, type IncomingEvent } from './report.ts';
import { apiKey, bumpRev, flag, llmConfig, num, rev, token, VERSION } from './settings.ts';
import { hubState } from './state.ts';
import { classify } from './classify.ts';
import { addSynopsis, createTitle, deleteTitle, scheduleBible, setProgress, setTitleShield } from './titles.ts';
import type { ItemKind, Strictness } from '../../shared/src/types.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function fail(c: Context, status: 400 | 401 | 404 | 503, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function authorized(c: Context): boolean {
  const header = c.req.header('X-Unspoil-Token');
  if (header && header === token()) return true;
  return getCookie(c, 'unspoil_token') === token();
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'X-Unspoil-Token, Content-Type, X-Unspoil-NoCache, X-Unspoil-Client',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function safeFile(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const file = path.resolve(root, `.${decoded}`);
  if (!file.startsWith(path.resolve(root))) return null;
  return file;
}

function sendFile(file: string) {
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  return new Response(fs.readFileSync(file), { headers: { 'content-type': type, 'cache-control': 'no-store' } });
}

function settingsView() {
  const config = llmConfig();
  const key = apiKey();
  const locale = hubState().locale;
  const strictness = hubState().strictness;
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    bibleModel: config.bibleModel,
    hasKey: key.length > 0,
    keyMask: '',
    priceInput: config.priceInput,
    priceCached: config.priceCached,
    priceOutput: config.priceOutput,
    port: Number(process.env.UNSPOIL_PORT || 47821),
    token: token(),
    version: VERSION,
    extensionSeenAt: num('extension_seen_at') || null,
    locale,
    strictness,
    shieldOn: flag('shield_on'),
  };
}

const KINDS = new Set<ItemKind>(['comment', 'post', 'title', 'snippet']);

export const app = new Hono();

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  const extension = origin.startsWith('chrome-extension://');
  if (extension && c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (!extension) {
    setCookie(c, 'unspoil_token', token(), { httpOnly: true, sameSite: 'Strict', path: '/' });
  }
  if (c.req.path.startsWith('/v1/') && c.req.path !== '/v1/health') {
    const sameOrigin = c.req.header('Sec-Fetch-Site') === 'same-origin';
    if (!sameOrigin && !authorized(c)) return fail(c, 401, 'unauthorized', 'token mismatch');
  }
  if (c.req.header('X-Unspoil-Client') === 'extension') setSetting('extension_seen_at', String(Date.now()));
  await next();
  if (extension) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }
});

app.get('/v1/health', (c) => c.json({ ok: true, version: VERSION, rev: rev() }));

app.get('/v1/state', (c) => {
  const since = Number(c.req.query('since') ?? '-1');
  const current = rev();
  if (since === current) {
    return c.json({ unchanged: true, rev: current, extensionSeenAt: num('extension_seen_at') || null });
  }
  return c.json({ ...hubState(), extensionSeenAt: num('extension_seen_at') || null });
});

app.get('/v1/settings', (c) => c.json(settingsView()));

app.put('/v1/settings', async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 400, 'bad_request', 'json required');
  let changed = false;
  if (typeof body.shieldOn === 'boolean') {
    setSetting('shield_on', body.shieldOn ? '1' : '0');
    changed = true;
  }
  if (body.strictness === 'chill' || body.strictness === 'careful' || body.strictness === 'paranoid') {
    setSetting('strictness', body.strictness as Strictness);
    changed = true;
  }
  if (body.locale === 'system' || body.locale === 'ko' || body.locale === 'en') {
    setSetting('locale', body.locale);
    changed = true;
  }
  if (typeof body.provider === 'string' && body.provider.trim()) setSetting('provider', body.provider.trim());
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) setSetting('base_url', body.baseUrl.trim());
  if (typeof body.model === 'string' && body.model.trim()) setSetting('model', body.model.trim());
  if (typeof body.bibleModel === 'string' && body.bibleModel.trim()) {
    setSetting('bible_model', body.bibleModel.trim());
  }
  if ('apiKey' in body) return fail(c, 400, 'bad_request', 'Configure GROQ_API_KEY in the server .env file.');
  for (const [field, key] of [
    ['priceInput', 'price_input'],
    ['priceCached', 'price_cached'],
    ['priceOutput', 'price_output'],
  ] as const) {
    if (typeof body[field] === 'number' && Number.isFinite(body[field])) setSetting(key, String(body[field]));
  }
  if (body.regenerateToken === true) setSetting('token', crypto.randomUUID().replaceAll('-', ''));
  if (changed) bumpRev();
  return c.json({ ...hubState(), settings: settingsView() });
});

app.get('/v1/catalog', async (c) => c.json(await searchCatalog(c.req.query('q') ?? '')));

app.post('/v1/titles', async (c) => {
  const body = await readJson(c);
  const entry = typeof body?.catalogId === 'string' ? catalogEntry(body.catalogId) : undefined;
  if (!entry) return fail(c, 400, 'bad_request', 'Choose a title from search results.');
  if (hubState().titles.some(t => t.name.normalize('NFKC').toLowerCase() === entry.name.normalize('NFKC').toLowerCase())) return fail(c, 400, 'bad_request', 'This title is already in your collection.');
  const progress = typeof body?.progress === 'number' && Number.isFinite(body.progress) ? body.progress : 0;
  return c.json(createTitle(entry.name, entry.kind, progress));
});

app.delete('/v1/titles/:id', (c) => {
  const state = deleteTitle(c.req.param('id'));
  if (!state) return fail(c, 404, 'not_found', 'title missing');
  return c.json(state);
});

app.put('/v1/titles/:id/progress', async (c) => {
  const body = await readJson(c);
  if (!body || typeof body.progress !== 'number' || !Number.isFinite(body.progress)) return fail(c, 400, 'bad_request', 'progress required');
  const state = setProgress(c.req.param('id'), body.progress);
  if (!state) return fail(c, 404, 'not_found', 'title missing');
  return c.json(state);
});

app.put('/v1/titles/:id/shield', async (c) => {
  const body = await readJson(c);
  if (!body || typeof body.shieldOn !== 'boolean') return fail(c, 400, 'bad_request', 'shieldOn required');
  const state = setTitleShield(c.req.param('id'), body.shieldOn);
  if (!state) return fail(c, 404, 'not_found', 'title missing');
  return c.json(state);
});

app.post('/v1/titles/:id/retry-bible', (c) => {
  scheduleBible(c.req.param('id'));
  return c.json(hubState());
});

app.post('/v1/titles/:id/synopsis', async (c) => {
  const body = await readJson(c);
  if (!body || typeof body.text !== 'string' || typeof body.ordinal !== 'number') {
    return fail(c, 400, 'bad_request', 'ordinal and text required');
  }
  if (body.text.length > 2000) return fail(c, 400, 'bad_request', 'synopsis too long');
  const state = addSynopsis(c.req.param('id'), body.ordinal, body.text);
  if (!state) return fail(c, 404, 'not_found', 'title missing');
  return c.json(state);
});

app.post('/v1/classify', async (c) => {
  const body = await readJson(c);
  if (!body || !Array.isArray(body.items) || !Array.isArray(body.titleIds)) {
    return fail(c, 400, 'bad_request', 'items and titleIds required');
  }
  if (body.items.length === 0 || body.items.length > 40 || body.titleIds.length > 3) {
    return fail(c, 400, 'bad_request', 'batch size out of range');
  }
  const items = body.items.filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      KINDS.has(item.kind as ItemKind),
  );
  const titleIds = body.titleIds.filter((id) => typeof id === 'string');
  if (items.length !== body.items.length || titleIds.length === 0) {
    return fail(c, 400, 'bad_request', 'invalid items');
  }
  try {
    const result = await classify(
      { host: typeof body.host === 'string' ? body.host.slice(0, 200) : '', titleIds, items },
      c.req.header('X-Unspoil-NoCache') === '1',
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof LlmRateLimited) return c.json({error:{code:'rate_limited',message:'AI is busy; content stays blurred.',retryAfterMs:error.retryAfterMs}},503);
    if (error instanceof LlmUnavailable) return fail(c, 503, 'llm_unavailable', 'llm unavailable');
    return fail(c, 503, 'llm_unavailable', 'llm unavailable');
  }
});

app.post('/v1/feedback', async (c) => {
  const body = await readJson(c);
  if (!body || typeof body.hash !== 'string' || typeof body.titleId !== 'string' || body.label !== 'safe') {
    return fail(c, 400, 'bad_request', 'hash, titleId, label required');
  }
  db.prepare(
    `INSERT INTO overrides (text_hash, title_id, label, created_at)
     VALUES (?, ?, 'safe', ?)
     ON CONFLICT(text_hash, title_id) DO UPDATE SET label = 'safe', created_at = excluded.created_at`,
  ).run(body.hash, body.titleId, Date.now());
  recordEvents([
    {
      host: 'local',
      titleId: body.titleId,
      decision: 'reported_wrong',
      reason: null,
      cached: false,
      latencyMs: null,
    },
  ]);
  return c.json({ ok: true });
});

app.post('/v1/events', async (c) => {
  const body = await readJson(c);
  if (!body || !Array.isArray(body.events)) return fail(c, 400, 'bad_request', 'events required');
  recordEvents(body.events as IncomingEvent[]);
  return c.json({ ok: true });
});

app.get('/v1/report', (c) => c.json(report()));

app.get('/v1/proof', (c) => {
  const file = path.join(repoRoot, 'eval/report.json');
  if (!fs.existsSync(file)) return c.json({ empty: true });
  try {
    return c.json(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
  } catch {
    return c.json({ empty: true });
  }
});

app.post('/v1/reset', (c) => {
  db.exec('DELETE FROM titles; DELETE FROM verdicts; DELETE FROM overrides; DELETE FROM events; DELETE FROM llm_usage;');
  setSetting('stat_comments', '0');
  setSetting('stat_pairs', '0');
  setSetting('stat_cache_hits', '0');
  bumpRev();
  return c.json(hubState());
});

app.get('/', (c) => {
  const index = path.join(repoRoot, 'hub/ui/dist/index.html');
  if (fs.existsSync(index)) return sendFile(index);
  return c.text('Unspoil Hub API');
});

app.get('/demo', (c) => c.redirect('/demo/'));
app.get('/demo/', (c) => {
  const file = path.join(repoRoot, 'demo/index.html');
  if (!fs.existsSync(file)) return c.text('demo not built', 404);
  return sendFile(file);
});
app.get('/demo/*', (c) => {
  const file = safeFile(path.join(repoRoot, 'demo'), c.req.path.replace('/demo', '') || '/index.html');
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return c.text('not found', 404);
  return sendFile(file);
});
app.get('/assets/*', (c) => {
  const file = safeFile(path.join(repoRoot, 'hub/ui/dist'), c.req.path);
  if (!file || !fs.existsSync(file)) return c.text('not found', 404);
  return sendFile(file);
});

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
