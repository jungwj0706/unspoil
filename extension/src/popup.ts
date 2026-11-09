import { formatProgress, resolveLocale, t, type Locale, type TitleState } from '../../shared/src/index.ts';
import type { HubState, Strictness } from '../../shared/src/types.ts';

interface PageInfo {
  scannedCount?: number;
  gate?: string;
  blockedCount?: number;
  matchedTitleIds?: string[];
}

interface Status {
  state: HubState | null;
  online: boolean;
  hasToken: boolean;
}

const app = document.querySelector('#app');
let expanded = false;
let page: PageInfo = {};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'state') void boot();
});

void boot();

async function boot() {
  const status = (await chrome.runtime.sendMessage({ type: 'getState' })) as Status;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    try {
      page = (await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' })) as PageInfo;
    } catch {
      page = {};
    }
  }
  render(status);
}

function render(status: Status) {
  if (!app) return;
  app.replaceChildren();
  if (!status.hasToken) {
    app.append(connectForm());
    return;
  }
  const locale = 'en' as const;
  const head = document.createElement('div');
  head.className = 'row';
  const statusLine = document.createElement('div');
  statusLine.className = 'row';
  const dot = document.createElement('i');
  dot.className = status.online ? 'dot on' : 'dot';
  const label = document.createElement('strong');
  label.textContent = status.online ? t(locale, 'popup.connected') : t(locale, 'popup.openHub');
  statusLine.append(dot, label);
  const shield = document.createElement('button');
  shield.className = 'switch';
  shield.textContent = t(locale, 'home.shield');
  shield.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'shield', shieldOn: !status.state?.shieldOn }).then(() => boot());
  });
  head.append(statusLine, shield);
  app.append(head);
  const diagnostic = document.createElement('p');
  diagnostic.className = 'muted';
  diagnostic.textContent = !status.online
    ? 'Not protecting this tab: open the local Hub to reconnect.'
    : !status.state?.shieldOn ? 'Shield is paused. Turn it on to protect this tab.'
    : page.scannedCount === undefined ? 'Refresh this tab to activate the updated extension.'
    : `${page.scannedCount} text blocks detected · ${page.blockedCount ?? 0} spoilers hidden`;
  app.append(diagnostic);
  if ((page.blockedCount ?? 0) > 0) {
    const here = document.createElement('p');
    here.className = 'here';
    here.textContent = t(locale, 'popup.blockedHere', { count: page.blockedCount ?? 0 });
    app.append(here);
  }
  const titles = ordered(status.state, page.matchedTitleIds ?? []);
  const visible = expanded ? titles : titles.slice(0, 3);
  if (titles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t(locale, 'popup.noTitles');
    app.append(empty);
  }
  for (const title of visible) app.append(titleCard(title, locale));
  if (titles.length > 3) {
    const more = document.createElement('button');
    more.className = 'ghost';
    more.textContent = expanded ? t(locale, 'popup.less') : t(locale, 'popup.more');
    more.addEventListener('click', () => {
      expanded = !expanded;
      void boot();
    });
    app.append(more);
  }
  app.append(strictness(locale, status.state?.strictness ?? 'careful'));
}

function ordered(state: HubState | null, matched: string[]): TitleState[] {
  const titles = [...(state?.titles ?? [])];
  return titles.sort((a, b) => Number(matched.includes(b.id)) - Number(matched.includes(a.id)));
}

function titleCard(title: TitleState, locale: Locale): HTMLElement {
  const card = document.createElement('article');
  card.className = 'title';
  const name = document.createElement('strong');
  name.textContent = title.name;
  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  const minus = document.createElement('button');
  minus.textContent = '−';
  const plus = document.createElement('button');
  plus.textContent = '+';
  const read = document.createElement('div');
  const number = document.createElement('strong');
  const caption = document.createElement('span');
  caption.className = 'muted';
  const cap = title.kind !== 'series' ? 1 : title.totalEpisodes ?? 99;
  number.textContent = title.kind !== 'series'
    ? t(locale, title.progress > 0 ? 'progress.seen' : 'progress.unseen')
    : String(title.progress);
  caption.textContent = title.kind !== 'series'
    ? t(locale, title.progress > 0 ? 'progress.seen' : 'progress.unseen')
    : formatProgress(locale, title.progress, title.episodes);
  read.append(number, caption);
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(cap, title.progress + delta));
    if (next === title.progress) return;
    void chrome.runtime.sendMessage({ type: 'progress', id: title.id, progress: next }).then(() => boot());
  };
  minus.addEventListener('click', () => move(-1));
  plus.addEventListener('click', () => move(1));
  stepper.append(minus, read, plus);
  card.append(name, stepper);
  return card;
}

function strictness(locale: Locale, current: Strictness): HTMLElement {
  const wrap = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'muted';
  label.textContent = t(locale, 'popup.strictness');
  const segment = document.createElement('div');
  segment.className = 'segment';
  for (const value of ['chill', 'careful', 'paranoid'] as const) {
    const button = document.createElement('button');
    button.textContent = t(locale, `strict.${value}`);
    if (value === current) button.classList.add('on');
    button.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'strictness', strictness: value }).then(() => boot());
    });
    segment.append(button);
  }
  wrap.append(label, segment);
  return wrap;
}

function connectForm(): HTMLElement {
  const form = document.createElement('form');
  form.className = 'connect';
  const locale = resolveLocale('en', navigator.language);
  const title = document.createElement('h1');
  title.textContent = 'Unspoil';
  const input = document.createElement('input');
  input.placeholder = t(locale, 'popup.tokenPlaceholder');
  input.required = true;
  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = t(locale, 'popup.connect');
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent = 'Open http://127.0.0.1:47821/ to connect automatically, or paste its pairing code below.';
  form.append(title, help, input, button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void chrome.runtime.sendMessage({ type: 'connect', token: input.value.trim() }).then(() => boot());
  });
  return form;
}
