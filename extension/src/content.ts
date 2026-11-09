import { openRevealDialog, anyTermMatches, formatProgress, resolveLocale, shouldBlock, t, type Locale } from '../../shared/src/index.ts';
import type { HubState, ItemKind, TitleState, Verdict, UnspoilEvent } from '../../shared/src/types.ts';
import { adapterFor, type AdapterTarget } from './adapters.ts';

type Status = 'pending' | 'safe' | 'blocked' | 'revealed' | 'offline' | 'failed';

interface Tracked {
  kind: ItemKind;
  card?: string;
  text: string;
  verdicts: Verdict[];
  revealed: boolean;
  tries: number;
  logged: boolean;
}

const adapter = adapterFor(location.host);
const tracked = new Set<Element>();
const meta = new WeakMap<Element, Tracked>();
const queue = new Set<Element>();
const overrides = new Set<string>();
let state: HubState | null = null;
let online = false;
let gate: 'unknown' | 'on' | 'off' = 'unknown';
let timer = 0;
let seq = 0;
let meltToken = 0;
function coverageKey() { return chosenTitles().map(t => `${t.id}:${t.memory}`).join('|'); }

const isHub = location.origin === 'http://127.0.0.1:47821' && !location.pathname.startsWith('/demo');
if (isHub) {
  // Read the pairing credential only from our local Hub; never from arbitrary pages.
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'unspoil:pair') return;
    const token = event.data.token;
    if (typeof token === 'string' && token) void chrome.runtime.sendMessage({type:'connect', token, base:location.origin});
  });
  const requestPair = () => window.postMessage({type:'unspoil:request-pair'}, location.origin);
  requestPair();
  window.setInterval(requestPair, 5000);

} else {
if (document.documentElement) document.documentElement.dataset.unspoilGate = 'unknown';

chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
  acceptState(response?.state ?? null, Boolean(response?.online), null);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'state') acceptState(message.state ?? null, Boolean(message.online), state);
  if (message?.type === 'pageInfo') {
    sendResponse({
      blockedCount: countBlocked(),
      matchedTitleIds: chosenTitles().map((title) => title.id),
      gate,
      scannedCount: tracked.size,
      online,
    });
  }
  return false;
});

const pageObserver = new MutationObserver((records) => {
  const previousGate = gate;
  updateGate();
  if (gate === 'on' && previousGate !== 'on') scanExisting();
  for (const record of records) {
    for (const node of record.addedNodes) inspect(node);
  }
});
pageObserver.observe(document, { childList: true, subtree: true });
window.addEventListener('pagehide', () => pageObserver.disconnect(), {once:true});

document.addEventListener('DOMContentLoaded', () => {
  updateGate();
  scanExisting();
});

window.setTimeout(() => {
  if (gate !== 'unknown') return;
  if (!state) {
    const notice = document.createElement('div');
    notice.className = 'unspoil-float';
    notice.style.cssText = 'bottom:20px;right:20px';
    notice.attachShadow({mode:'open'}).innerHTML = '<style>a{display:block;background:#283d36;color:white;padding:16px;border-radius:12px;font:13px system-ui;text-decoration:none}</style><a href="http://127.0.0.1:47821/" target="_blank" rel="noopener">Unspoil is waiting for your library. Open Hub to connect ↗</a>';
    document.documentElement.appendChild(notice);
    const removeNotice = () => { if (state) notice.remove(); else window.setTimeout(removeNotice, 1000); }; removeNotice();
    return;
  }
  gate = state.strictness === 'paranoid' ? 'on' : 'off';
  document.documentElement.dataset.unspoilGate = gate;
  if (gate === 'on') scanExisting();
}, 2000);

window.addEventListener('scroll', () => scheduleChips(), { passive: true });
window.addEventListener('resize', () => scheduleChips());

}

function acceptState(next: HubState | null, nextOnline: boolean, previous: HubState | null) {
  const before = progressOnly(previous);
  const oldCoverage = coverageKey();
  state = next;
  online = nextOnline;
  updateGate();
  scanExisting();
  if (oldCoverage !== coverageKey()) {
    for (const element of tracked) {
      const info = meta.get(element);
      if (!info) continue;
      info.verdicts = []; info.revealed = false;
      setStatus(element, 'pending'); queue.add(element);
    }
  }
  for (const element of tracked) {
    const info = meta.get(element);
    const status = element.getAttribute('data-unspoil');
    if (info && info.verdicts.length === 0 && (status === 'offline' || status === 'failed' || status === 'pending')) {
      queue.add(element);
    }
  }
  const unlock: Element[] = [];
  for (const element of tracked) redecide(element, unlock);
  if (unlock.length) melt(unlock);
  if (before && progressOnly(state) !== before) {
    toast(t(locale(), 'overlay.moved', { label: afterLabel(), count: unlock.length }));
  }
  if (queue.size) scheduleFlush();
  updateBadge();
  scheduleChips();
}

function progressOnly(value: HubState | null): string {
  if (!value) return '';
  return value.titles.map((title) => `${title.id}:${title.progress}`).join(',');
}

function afterLabel(): string {
  const title = chosenTitles()[0] ?? state?.titles[0];
  if (!title) return '';
  return title.kind !== 'series'
    ? t(locale(), title.progress > 0 ? 'progress.seen' : 'progress.unseen')
    : formatProgress(locale(), title.progress, title.episodes);
}

function locale(): Locale {
  return resolveLocale(state?.locale ?? 'system', navigator.language);
}

function updateGate() {
  if (!document.documentElement) return;
  if (!state) { gate = 'unknown'; document.documentElement.dataset.unspoilGate = gate; return; }
  if (!state.shieldOn || !state.titles.some((title) => title.shieldOn && title.gateTerms.length)) {
    gate = 'off';
    document.documentElement.dataset.unspoilGate = 'off';
    return;
  }
  const terms = state.titles.filter((title) => title.shieldOn).flatMap((title) => title.gateTerms);
  if (adapter || anyTermMatches(pageBlob(), terms)) gate = 'on';
  else if (gate !== 'on') gate = 'unknown';
  document.documentElement.dataset.unspoilGate = gate;
}

function pageBlob(): string {
  return [
    document.title,
    document.querySelector('h1')?.textContent ?? '',
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
    decodeURIComponent(location.pathname + location.search),
    ...(adapter?.pageHints(document) ?? []),
  ].join('\n');
}

function chosenTitles(): TitleState[] {
  if (!state) return [];
  const ready = state.titles.filter(
    (title) => title.shieldOn,
  );
  // A dedicated Reddit thread has a known story context. Do not let an unrelated
  // library title's model failure stall every comment in that conversation.
  if (adapter?.id === 'reddit' && location.pathname.includes('/comments/')) {
    const matched = ready.filter(title => anyTermMatches(pageBlob(), title.gateTerms));
    if (matched.length) return matched;
  }
  return ready;
}

function scanExisting() {
  if (document.body) inspect(document.body);
}

function inspect(node: Node) {
  if (!(node instanceof Element)) return;
  if (node.classList.contains('unspoil-float') || node.id === 'unspoil-toast') return;
  consider(node);
  if (node.shadowRoot) {
    for (const child of node.shadowRoot.children) inspect(child);
  }
  for (const child of node.children) inspect(child);
}

function consider(element: Element) {
  const target = matchingTarget(element);
  if (target) {
    if (gate === 'off' && !termHit(element) && !threadHit(element)) return;
    track(element, target.kind, target.card, 1);
    return;
  }
  if (adapter) return;
  if (element.parentElement?.closest('[data-unspoil]')) return;
  if (element.querySelector('p, li, blockquote, h1, h2, h3, article, [role="article"]')) return;
  const generic = element.matches('p, li, blockquote, h1, h2, h3, td, dd, article, [role="article"]') || (element.matches('div, span') && !element.children.length);
  if (!generic || element.closest('nav, header, footer, textarea, input, button, .unspoil-float')) return;
  if (gate === 'on' && textOf(element).length >= 15) track(element, 'comment', undefined, 15);
  if (gate !== 'on' && textOf(element).length >= 15 && termHit(element)) track(element, 'comment', undefined, 15);
}

function matchingTarget(element: Element): AdapterTarget | null {
  if (!adapter) return null;
  for (const target of adapter.targets) {
    if (target.selectors.some((selector) => safeMatches(element, selector))) return target;
  }
  return null;
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function termHit(element: Element): boolean {
  const terms = state?.titles.filter((title) => title.shieldOn).flatMap((title) => title.gateTerms) ?? [];
  return anyTermMatches(textOf(element), terms);
}

function threadHit(element: Element): boolean {
  if (state?.strictness !== 'paranoid' || !adapter) return false;
  const terms = state.titles.filter((title) => title.shieldOn).flatMap((title) => title.gateTerms);
  return adapter.targets.some((target) => {
    if (!target.threadRoot) return false;
    const root = element.closest(target.threadRoot);
    return Boolean(root && anyTermMatches(root.textContent ?? '', terms));
  });
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function track(element: Element, kind: ItemKind, card: string | undefined, minimum: number, forced = false) {
  const text = textOf(element);
  if (text.length < minimum) return;
  const current = meta.get(element);
  if (current?.text === text) return;
  if (!forced && !current && tracked.size >= 300) {
    defer(element, kind, card, minimum);
    return;
  }
  meta.set(element, {
    kind,
    card,
    text,
    verdicts: [],
    revealed: false,
    tries: 0,
    logged: false,
  });
  tracked.add(element);
  setStatus(element, 'pending');
  queue.add(element);
  if (!current) watch(element);
  scheduleFlush();
}

const deferred: Array<{ element: Element; kind: ItemKind; card?: string; minimum: number }> = [];
let watcher: IntersectionObserver | null = null;

function defer(element: Element, kind: ItemKind, card: string | undefined, minimum: number) {
  deferred.push({ element, kind, card, minimum });
  watcher ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof Element)) continue;
      const index = deferred.findIndex((job) => job.element === entry.target);
      if (index < 0) continue;
      const job = deferred.splice(index, 1)[0];
      watcher?.unobserve(job.element);
      track(job.element, job.kind, job.card, job.minimum, true);
    }
  });
  watcher.observe(element);
}

function watch(element: Element) {
  new MutationObserver(() => {
    const info = meta.get(element);
    if (!info) return;
    const text = textOf(element);
    if (text === info.text) return;
    info.text = text;
    info.verdicts = [];
    info.revealed = false;
    warned.delete(element);
    info.logged = false;
    info.tries = 0;
    setStatus(element, 'pending');
    queue.add(element);
    scheduleFlush();
  }).observe(element, { characterData: true, subtree: true, childList: true });
}

function scheduleFlush() {
  if (queue.size >= 30) void flush();
  else if (!timer) timer = window.setTimeout(() => void flush(), 50);
}

let flushing = false;
async function flush() {
  window.clearTimeout(timer); timer = 0;
  if (flushing) return;
  flushing = true;
  try { await flushBatch(); } finally { flushing = false; if (queue.size && online) scheduleFlush(); }
}
async function flushBatch() {
  window.clearTimeout(timer);
  timer = 0;
  const titles = chosenTitles();
  if (!online || !state?.shieldOn || titles.length === 0) {
    if (!online) for (const element of queue) setStatus(element, 'offline');
    else queue.clear();
    return;
  }
  const batch = [...queue].sort(byViewport).slice(0, 30);
  for (const element of batch) queue.delete(element);
  const requestCoverage = coverageKey();
  const snapshots = new Map(batch.map(element => [element, meta.get(element)!.text]));
  const owners = new Map<string, string>();
  const chunkCounts = new Map<Element, number>();
  const items = batch.flatMap(element => {
    const info = meta.get(element)!;
    // Every chunk must be judged; never release a post based only on its prefix.
    const chunks = info.text.match(/[\s\S]{1,500}/g) ?? [];
    chunkCounts.set(element, chunks.length);
    return chunks.map((text, index) => { const id = `${idOf(element)}_${index}`; owners.set(id, idOf(element)); return { id, text, kind: info.kind }; });
  });
  let response: { ok?: boolean; offline?: boolean; response?: { verdicts: Verdict[]; meta?: { latencyMs: number } } } | undefined;
  try {
    const verdicts: Verdict[] = [];
    for (let start = 0; start < titles.length; start += 3) {
      for (let offset = 0; offset < items.length; offset += 8) {
        const part = await chrome.runtime.sendMessage({ type: 'classify', host: location.host, titleIds: titles.slice(start, start + 3).map(t => t.id), items: items.slice(offset, offset + 8) });
        if (!part?.ok) { response = part; break; }
        verdicts.push(...part.response.verdicts);
      }
      if (response) break;
    }
    response ??= { ok: true, response: { verdicts } };
  } catch {
    response = { offline: true };
  }
  if (!response?.ok) {
    for (const element of batch) {
      const info = meta.get(element)!;
      setStatus(element, response?.offline ? 'offline' : 'failed');
      info.tries += 1;
      if (info.tries < 3) window.setTimeout(() => { queue.add(element); scheduleFlush(); }, 1500 * info.tries);
    }
    return;
  }
  const grouped = new Map<string, Verdict[]>();
  for (const verdict of response.response?.verdicts ?? []) {
    const owner = owners.get(verdict.id);
    if (owner) grouped.set(owner, [...(grouped.get(owner) ?? []), verdict]);
  }
  const events: UnspoilEvent[] = [];
  const latency = response.response?.meta?.latencyMs ?? null;
  for (const element of batch) {
    const info = meta.get(element);
    if (!info) continue;
    if (snapshots.get(element) !== info.text || requestCoverage !== coverageKey()) { queue.add(element); continue; }
    const found = grouped.get(idOf(element));
    if (found?.length !== titles.length * (chunkCounts.get(element) ?? 0)) {
      info.tries += 1;
      setStatus(element, 'failed');
      if (info.tries < 2) {
        window.setTimeout(() => {
          queue.add(element);
          scheduleFlush();
        }, 1200);
      }
      continue;
    }
    info.verdicts = found;
    const decision = redecide(element, []);
    if (!info.logged && (decision === 'blocked' || decision === 'shown')) {
      info.logged = true;
      const verdict = info.verdicts.find((item) => item.titleId) ?? info.verdicts[0];
      events.push({
        ts: Date.now(),
        host: location.host,
        titleId: verdict?.titleId ?? titles[0]?.id ?? null,
        decision,
        reason: decision === 'blocked' ? blockingOf(element)?.reason ?? null : null,
        cached: Boolean(verdict?.cached),
        latencyMs: latency,
      });
    }
  }
  if (events.length) void chrome.runtime.sendMessage({ type: 'events', events });
  if (queue.size) scheduleFlush();
  updateBadge();
  scheduleChips();
}

function redecide(element: Element, unlock: Element[]): 'blocked' | 'shown' | 'revealed' | 'pending' {
  const info = meta.get(element);
  if (!info) return 'pending';
  if (!state) { setStatus(element, 'offline'); return 'pending'; }
  if (!state.shieldOn || !state.titles.some(t => t.shieldOn)) { setStatus(element, 'safe'); paintCard(element, false); return 'shown'; }
  if (!info.verdicts.length) {
    setStatus(element, online ? 'pending' : 'offline');
    return 'pending';
  }
  if (info.revealed) {
    setStatus(element, 'revealed');
    paintCard(element, false);
    return 'revealed';
  }
  const blocked = blockingOf(element);
  if (blocked) {
    setStatus(element, 'blocked');
    paintCard(element, true);
    return 'blocked';
  }
  paintCard(element, false);
  if (element.getAttribute('data-unspoil') === 'blocked') unlock.push(element);
  else setStatus(element, 'safe');
  return 'shown';
}

function blockingOf(element: Element): Verdict | null {
  const info = meta.get(element);
  if (!info || !state?.shieldOn) return null;
  for (const verdict of info.verdicts) {
    if (overrides.has(`${verdict.hash}:${verdict.titleId}`)) continue;
    const title = state.titles.find((item) => item.id === verdict.titleId);
    if (shouldBlock(verdict, title, state.strictness)) return verdict;
  }
  return null;
}

function melt(elements: Element[]) {
  const token = ++meltToken;
  const visible: Element[] = [];
  const hidden: Element[] = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    (rect.bottom > 0 && rect.top < innerHeight ? visible : hidden).push(element);
  }
  visible.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  [...visible, ...hidden].forEach((element, index) => {
    window.setTimeout(() => {
      if (token !== meltToken) return;
      if (!blockingOf(element)) setStatus(element, 'safe');
    }, index * 40);
  });
}

function setStatus(element: Element, status: Status) {
  element.setAttribute('data-unspoil', status);
  if (status === 'safe' || status === 'revealed') element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', 'true');
  syncChip(element);
}

const warned = new WeakSet<Element>();
function requestReveal(element: Element, trigger: HTMLButtonElement) {
  if (element.getAttribute('data-unspoil') !== 'blocked') return;
  if (!warned.has(element)) { warned.add(element); syncChip(element); return; }
  const original = meta.get(element)?.text;
  openRevealDialog({ returnFocus: trigger, onConfirm: () => {
    // A recycled feed node may have changed while the confirmation was open.
    if (element.isConnected && meta.get(element)?.text === original && element.getAttribute('data-unspoil') === 'blocked') reveal(element);
  }});
}

function reveal(element: Element) {
  const info = meta.get(element);
  if (!info) return;
  info.revealed = true;
  setStatus(element, 'revealed');
  paintCard(element, false);
  const verdict = blockingOf(element) ?? info.verdicts.find((item) => item.titleId);
  if (verdict?.titleId) {
    void chrome.runtime.sendMessage({
      type: 'events',
      events: [
        {
          ts: Date.now(),
          host: location.host,
          titleId: verdict.titleId,
          decision: 'revealed',
          reason: verdict.reason,
          cached: verdict.cached,
          latencyMs: null,
        },
      ],
    });
  }
  updateBadge();
}

function paintCard(element: Element, blocked: boolean) {
  const info = meta.get(element);
  if (!info?.card) return;
  const card = element.closest(info.card);
  if (!card) return;
  if (blocked) card.setAttribute('data-unspoil-card', 'on');
  else card.removeAttribute('data-unspoil-card');
}

function idOf(element: Element): string {
  const current = element.getAttribute('data-unspoil-id');
  if (current) return current;
  const id = `n${seq++}`;
  element.setAttribute('data-unspoil-id', id);
  return id;
}

function byViewport(a: Element, b: Element): number {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const av = ar.bottom > 0 && ar.top < innerHeight ? 0 : 1;
  const bv = br.bottom > 0 && br.top < innerHeight ? 0 : 1;
  return av - bv || ar.top - br.top;
}

function countBlocked(): number {
  let count = 0;
  for (const element of tracked) if (element.getAttribute('data-unspoil') === 'blocked') count += 1;
  return count;
}

function updateBadge() {
  void chrome.runtime.sendMessage({ type: 'badge', count: countBlocked() });
}

const chips = new Map<Element, HTMLElement>();
let chipFrame = 0;

function syncChip(element: Element) {
  const status = element.getAttribute('data-unspoil');
  if (!status || status === 'safe') {
    chips.get(element)?.remove();
    chips.delete(element);
    return;
  }
  let host = chips.get(element);
  if (!host) {
    host = document.createElement('div');
    host.className = 'unspoil-float';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light;display:block}
      button{font:inherit;cursor:pointer;color:#263a2c;border:0;background:transparent;padding:0}button:focus-visible{outline:3px solid #8eaa73;outline-offset:3px}
      .surface{width:100%;height:100%;min-height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(245,248,241,.10);text-align:center;position:relative}
      .label{display:block;padding:5px 10px;border-radius:6px;background:rgba(255,254,250,.94);box-shadow:0 1px 5px #00000012;font-size:12px;line-height:1.4;color:#46523f}
      .surface[data-stage="idle"] .label{position:absolute;right:4px;bottom:2px;font-size:11px;padding:2px 7px;opacity:.82}
      .surface[data-stage="warning"] .label{font-size:14px;padding:10px 16px;box-shadow:0 2px 12px #0001}
      .label small{display:block;font-size:12px;color:#69735f;margin-top:3px}.feedback{height:auto;pointer-events:auto;text-align:left;justify-content:flex-start;background:none}.feedback .label{font-size:12px;padding:3px 8px}
      @media(prefers-reduced-motion:no-preference){.label{transition:opacity .2s,transform .2s}.surface:hover .label{opacity:1}}
    </style><button type="button" class="surface"><span class="label"></span></button>`;
    shadow.querySelector('button')!.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const current = element.getAttribute('data-unspoil');
      const button = event.currentTarget as HTMLButtonElement;
      if (current === 'blocked') requestReveal(element, button);
      else if (current === 'revealed') reportSafe(element);
      else if (current === 'failed' || current === 'offline') {
        const info = meta.get(element); if (info) info.tries = 0;
        setStatus(element, 'pending'); queue.add(element); scheduleFlush();
      }
    });
    document.documentElement.appendChild(host);
    chips.set(element, host);
  }
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>('button')!;
  const label = button.querySelector('.label')!;
  const stage = status === 'blocked' ? warned.has(element) ? 'warning' : 'idle' : status;
  button.dataset.stage = stage;
  button.classList.toggle('feedback', status === 'revealed');
  button.disabled = status === 'pending';
  label.replaceChildren();
  if (status === 'blocked' && stage === 'warning') {
    label.textContent = 'This comment may contain spoilers.';
    const hint = document.createElement('small'); hint.textContent = 'Click to review before revealing'; label.append(hint);
    button.setAttribute('aria-label', 'Spoiler warning. Review before revealing this comment');
  } else {
    label.textContent = status === 'blocked' ? 'Unspoil · click for details' : status === 'pending' ? 'Checking for spoilers…' : status === 'revealed' ? 'Not a spoiler? Let us know' : status === 'offline' ? 'Offline · click to retry' : 'Couldn’t check · click to retry';
    button.setAttribute('aria-label', status === 'blocked' ? 'Blurred comment. Click for spoiler details' : label.textContent);
  }
  scheduleChips();
}

function reportSafe(element: Element) {
  const info = meta.get(element);
  const verdict = info?.verdicts.find((item) => item.titleId && item.hash);
  if (!info || !verdict?.titleId || !verdict.hash) return;
  overrides.add(`${verdict.hash}:${verdict.titleId}`);
  info.revealed = false;
  setStatus(element, 'safe');
  void chrome.runtime.sendMessage({ type: 'feedback', hash: verdict.hash, titleId: verdict.titleId });
  chips.get(element)?.remove();
  chips.delete(element);
}

function scheduleChips() {
  if (chipFrame) return;
  chipFrame = window.requestAnimationFrame(() => {
    chipFrame = 0;
    for (const [element, host] of chips) {
      if (!element.isConnected) {
        host.remove();
        chips.delete(element);
        continue;
      }
      const rect = element.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
      host.hidden = !visible;
      if (!visible) continue;
      const revealed = element.getAttribute('data-unspoil') === 'revealed';
      host.style.top = `${revealed ? rect.bottom : rect.top}px`;
      host.style.left = `${rect.left}px`;
      host.style.width = `${rect.width}px`;
      host.style.height = revealed ? '24px' : `${rect.height}px`;
    }
  });
}

function toast(message: string) {
  if (!message.trim()) return;
  let element = document.getElementById('unspoil-toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'unspoil-toast';
    element.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#1c1b22;color:white;padding:12px 16px;border-radius:999px;font:14px -apple-system,BlinkMacSystemFont,sans-serif';
    document.documentElement.appendChild(element);
  }
  element.textContent = message;
  window.setTimeout(() => element?.remove(), 3000);
}
