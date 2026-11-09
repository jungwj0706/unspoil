import type { HubState, Strictness, UnspoilEvent } from '../../shared/src/types.ts';

const DEFAULT_BASE = 'http://127.0.0.1:47821';

let token = '';
let base = DEFAULT_BASE;
let state: HubState | null = null;
let online = false;
let since = -1;

async function load() {
  const stored = await chrome.storage.local.get(['token', 'base', 'state']);
  token = typeof stored.token === 'string' ? stored.token : '';
  base = typeof stored.base === 'string' && stored.base ? stored.base : DEFAULT_BASE;
  state = (stored.state as HubState | undefined) ?? null;
  since = state?.rev ?? -1;
}

function authHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    'X-Unspoil-Token': token,
    'X-Unspoil-Client': 'extension',
  };
}

async function broadcast() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'state', state, online });
      } catch {
        // 콘텐츠 스크립트가 없는 탭
      }
    }),
  );
}

async function pull() {
  if (!token) {
    online = false;
    return;
  }
  try {
    const health = await fetch(`${base}/v1/health`);
    if (!health.ok) throw new Error('health');
    const response = await fetch(`${base}/v1/state?since=${since}`, { headers: authHeaders() });
    if (!response.ok) throw new Error('state');
    const body = (await response.json()) as HubState & { unchanged?: boolean; rev: number };
    const wasOnline = online;
    online = true;
    if (!body.unchanged) {
      state = body;
      since = body.rev;
      await chrome.storage.local.set({ state });
      await broadcast();
    } else if (!wasOnline) {
      await broadcast();
    }
  } catch {
    if (online) {
      online = false;
      await broadcast();
    } else {
      online = false;
    }
  }
}

async function writeState(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('write');
  const next = (await response.json()) as HubState;
  state = next;
  since = next.rev;
  online = true;
  await chrome.storage.local.set({ state });
  await broadcast();
  return next;
}

let ready = Promise.resolve();

async function boot() {
  await load();
  await pull();
  setInterval(() => void pull(), 1000);
}

ready = boot();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void ready
    .then(() => handle(message as Record<string, unknown>, sender))
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, offline: true }));
  return true;
});

async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  if (message.type === 'getState') return { state, online, hasToken: Boolean(token) };
  if (message.type === 'connect') {
    token = String(message.token ?? '').trim();
    if (typeof message.base === 'string' && message.base) base = message.base;
    since = -1;
    await chrome.storage.local.set({ token, base });
    await pull();
    return { ok: online, state, online, hasToken: Boolean(token) };
  }
  if (message.type === 'badge' && sender.tab?.id !== undefined) {
    const count = Number(message.count) || 0;
    await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '', tabId: sender.tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: '#6d4aff', tabId: sender.tab.id });
    return { ok: true };
  }
  if (!token) return { ok: false, offline: true };
  if (message.type === 'classify') {
    const response = await fetch(`${base}/v1/classify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        host: message.host,
        titleIds: message.titleIds,
        items: message.items,
      }),
    });
    if (!response.ok) return { ok: false, offline: response.status >= 500 || response.status === 0 };
    online = true;
    return { ok: true, response: await response.json() };
  }
  if (message.type === 'progress') {
    await writeState(`/v1/titles/${message.id}/progress`, { progress: message.progress });
    return { ok: true, state };
  }
  if (message.type === 'strictness') {
    await writeState('/v1/settings', { strictness: message.strictness as Strictness });
    return { ok: true, state };
  }
  if (message.type === 'shield') {
    await writeState('/v1/settings', { shieldOn: message.shieldOn });
    return { ok: true, state };
  }
  if (message.type === 'feedback') {
    const response = await fetch(`${base}/v1/feedback`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ hash: message.hash, titleId: message.titleId, label: 'safe' }),
    });
    return { ok: response.ok };
  }
  if (message.type === 'events') {
    await fetch(`${base}/v1/events`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ events: message.events as UnspoilEvent[] }),
    });
    return { ok: true };
  }
  return { ok: false };
}

void ready;
