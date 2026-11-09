import { anyTermMatches, formatProgress, resolveLocale, shouldBlock, t, type Locale } from '../../shared/src/index.ts';
import type { HubState, ItemKind, TitleState, Verdict } from '../../shared/src/types.ts';
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

document.documentElement.dataset.unspoilGate = 'unknown';

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
    });
  }
  return false;
});

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) inspect(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', () => {
  updateGate();
  scanExisting();
});

window.setTimeout(() => {
  if (gate !== 'unknown') return;
  gate = state?.strictness === 'paranoid' ? 'on' : 'off';
  document.documentElement.dataset.unspoilGate = gate;
  if (gate === 'on') scanExisting();
}, 2000);

window.addEventListener('scroll', () => scheduleChips(), { passive: true });
window.addEventListener('resize', () => scheduleChips());

function acceptState(next: HubState | null, nextOnline: boolean, previous: HubState | null) {
  const before = progressOnly(previous);
  state = next;
  online = nextOnline;
  updateGate();
  if (gate === 'on' || gate === 'unknown') scanExisting();
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
  return title.kind === 'event'
    ? t(locale(), title.progress > 0 ? 'progress.seen' : 'progress.unseen')
    : formatProgress(locale(), title.progress, title.episodes);
}

function locale(): Locale {
  return resolveLocale(state?.locale ?? 'system', navigator.language);
}

function updateGate() {
  if (!state?.shieldOn || !state.titles.some((title) => title.shieldOn && title.gateTerms.length)) {
    gate = 'off';
    document.documentElement.dataset.unspoilGate = 'off';
    return;
  }
  const terms = state.titles.filter((title) => title.shieldOn).flatMap((title) => title.gateTerms);
  if (anyTermMatches(pageBlob(), terms)) gate = 'on';
  else if (gate !== 'on') gate = 'unknown';
  document.documentElement.dataset.unspoilGate = gate;
}

function pageBlob(): string {
  return [
    document.title,
    document.querySelector('h1')?.textContent ?? '',
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
    location.pathname + location.search,
    ...(adapter?.pageHints(document) ?? []),
  ].join('\n');
}

function chosenTitles(): TitleState[] {
  if (!state) return [];
  const ready = state.titles.filter(
    (title) => title.shieldOn && (title.memory === 'ready' || title.memory === 'low_confidence'),
  );
  const matched = ready.filter((title) => anyTermMatches(pageBlob(), title.gateTerms));
  return (matched.length ? matched : ready).slice(0, 3);
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
  const generic = element.matches('p, li, blockquote, article, [role="article"]');
  if (!generic || element.closest('nav, header, footer, textarea, input, button, .unspoil-float')) return;
  if (gate === 'on' && textOf(element).length >= 40) track(element, 'comment', undefined, 40);
  if (gate === 'off' && textOf(element).length >= 40 && termHit(element)) track(element, 'comment', undefined, 40);
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
  const text = textOf(element).slice(0, 500);
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
    revealed: current?.revealed ?? false,
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
    const text = textOf(element).slice(0, 500);
    if (text === info.text) return;
    info.text = text;
    info.verdicts = [];
    info.revealed = false;
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

async function flush() {
  window.clearTimeout(timer);
  timer = 0;
  const titles = chosenTitles();
  if (!online || !state?.shieldOn || titles.length === 0) {
    if (!online) for (const element of queue) setStatus(element, 'offline');
    return;
  }
  const batch = [...queue].sort(byViewport).slice(0, 30);
  for (const element of batch) queue.delete(element);
  const items = batch.map((element) => {
    const info = meta.get(element)!;
    return { id: idOf(element), text: info.text, kind: info.kind };
  });
  let response: { ok?: boolean; offline?: boolean; response?: { verdicts: Verdict[]; meta?: { latencyMs: number } } };
  try {
    response = await chrome.runtime.sendMessage({
      type: 'classify',
      host: location.host,
      titleIds: titles.map((title) => title.id),
      items,
    });
  } catch {
    response = { offline: true };
  }
  if (!response?.ok) {
    for (const element of batch) setStatus(element, response?.offline ? 'offline' : 'failed');
    return;
  }
  const grouped = new Map<string, Verdict[]>();
  for (const verdict of response.response?.verdicts ?? []) {
    grouped.set(verdict.id, [...(grouped.get(verdict.id) ?? []), verdict]);
  }
  const events: UnspoilEvent[] = [];
  const latency = response.response?.meta?.latencyMs ?? null;
  for (const element of batch) {
    const info = meta.get(element);
    if (!info) continue;
    const found = grouped.get(idOf(element));
    if (!found?.length) {
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
  if (!info.verdicts.length) return 'pending';
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
  if (status === 'blocked' && !element.hasAttribute('data-unspoil-bound')) {
    element.setAttribute('data-unspoil-bound', '1');
    element.tabIndex = 0;
    element.addEventListener('click', onReveal, true);
    element.addEventListener('keydown', onKey, true);
  }
  syncChip(element);
}

function onReveal(event: Event) {
  const element = event.currentTarget;
  if (!(element instanceof Element) || element.getAttribute('data-unspoil') !== 'blocked') return;
  event.preventDefault();
  event.stopPropagation();
  reveal(element);
}

function onKey(event: Event) {
  if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
  const element = event.currentTarget;
  if (element instanceof Element) reveal(element);
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
      :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button { border: 0; background: #6d4aff; color: white; border-radius: 999px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
      .tip { margin-top: 6px; background: #1c1b22; color: white; border-radius: 12px; padding: 8px 10px; font-size: 12px; max-width: 220px; }
      .ghost { background: white; color: #4b2ec4; margin-left: 6px; }
    </style><button type="button"></button><div class="tip" hidden></div>`;
    shadow.querySelector('button')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = element.getAttribute('data-unspoil');
      if (current === 'blocked') reveal(element);
      else if (current === 'revealed') reportSafe(element);
    });
    shadow.querySelector('button')?.addEventListener('mouseenter', () => showTip(element, true));
    shadow.querySelector('button')?.addEventListener('focus', () => showTip(element, true));
    shadow.querySelector('button')?.addEventListener('mouseleave', () => showTip(element, false));
    shadow.querySelector('button')?.addEventListener('blur', () => showTip(element, false));
    document.documentElement.appendChild(host);
    chips.set(element, host);
  }
  const button = host.shadowRoot?.querySelector('button');
  if (button) button.textContent = chipLabel(element, status as Status);
  scheduleChips();
}

function chipLabel(element: Element, status: Status): string {
  if (status === 'offline') return t(locale(), 'overlay.offline');
  if (status === 'failed') return t(locale(), 'overlay.failed');
  if (status === 'revealed') return t(locale(), 'overlay.notSpoiler');
  if (element.closest('[data-unspoil-card="on"]')) return t(locale(), 'overlay.spoilerInside');
  return t(locale(), 'overlay.brand');
}

function showTip(element: Element, open: boolean) {
  const tip = chips.get(element)?.shadowRoot?.querySelector('.tip');
  if (!(tip instanceof HTMLElement)) return;
  if (!open || element.getAttribute('data-unspoil') !== 'blocked') {
    tip.hidden = true;
    return;
  }
  const verdict = blockingOf(element);
  const where = verdict?.revealsOrdinal
    ? formatProgress(locale(), verdict.revealsOrdinal, state?.titles.find((title) => title.id === verdict.titleId)?.episodes ?? [])
    : t(locale(), 'reason.unknown');
  const reason = verdict?.reason ? t(locale(), `reason.${verdict.reason}`) : t(locale(), 'reason.unknown');
  tip.textContent = verdict?.revealsOrdinal ? `${where} · ${reason} · ${t(locale(), 'overlay.reveal')}` : `${t(locale(), 'reason.unknown')} · ${t(locale(), 'overlay.reveal')}`;
  tip.hidden = false;
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
      host.style.top = `${Math.max(8, rect.top + 8)}px`;
      host.style.left = `${Math.max(8, rect.left + 8)}px`;
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
