import type { ItemKind } from '../../shared/src/types.ts';

export interface AdapterTarget {
  selectors: string[];
  kind: ItemKind;
  card?: string;
  threadRoot?: string;
}

export interface SiteAdapter {
  id: string;
  matches(host: string): boolean;
  targets: AdapterTarget[];
  pageHints(doc: Document): string[];
}

const youtube: SiteAdapter = {
  id: 'youtube',
  matches: (host) => host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com',
  targets: [
    {
      selectors: [
        'ytd-comment-view-model #content-text',
        'ytd-comment-renderer #content-text',
        'ytd-comment-thread-renderer #content-text',
      ],
      kind: 'comment',
      threadRoot: 'ytd-comments',
    },
    {
      selectors: [
        'ytd-watch-metadata h1 yt-formatted-string',
        'h1.ytd-watch-metadata yt-formatted-string',
        '#title h1 yt-formatted-string',
      ],
      kind: 'title',
    },
    {
      selectors: [
        'ytd-compact-video-renderer #video-title',
        'ytd-video-renderer #video-title',
        'ytd-rich-item-renderer #video-title',
        'ytd-reel-item-renderer #video-title',
      ],
      kind: 'title',
      card: 'ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, ytd-reel-item-renderer',
    },
  ],
  pageHints: (doc) => [
    doc.querySelector('ytd-watch-metadata h1')?.textContent ?? '',
    new URLSearchParams(location.search).get('search_query') ?? '',
  ],
};

const x: SiteAdapter = {
  id: 'x',
  matches: (host) => host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com'),
  targets: [
    {
      selectors: ['article[data-testid="tweet"] [data-testid="tweetText"]'],
      kind: 'post',
      card: 'article[data-testid="tweet"]',
      threadRoot: '[data-testid="primaryColumn"]',
    },
  ],
  pageHints: (doc) => [doc.querySelector('[data-testid="tweetText"]')?.textContent ?? ''],
};

const reddit: SiteAdapter = {
  id: 'reddit',
  matches: (host) => host === 'www.reddit.com' || host === 'old.reddit.com' || host.endsWith('.reddit.com'),
  targets: [
    {
      selectors: ['shreddit-comment', '[slot="comment"]', '.Comment .usertext-body', '[id^="t1_"] .md'],
      kind: 'comment',
      threadRoot: 'shreddit-post, .commentarea',
    },
    {
      selectors: ['shreddit-post [slot="text-body"]', '.thing.link .usertext-body', 'h1'],
      kind: 'post',
      card: 'shreddit-post, .thing.link',
    },
  ],
  pageHints: (doc) => [doc.querySelector('h1')?.textContent ?? ''],
};

const demo: SiteAdapter = {
  id: 'demo',
  matches: (host) => host === '127.0.0.1' || host === 'localhost',
  targets: [
    {
      selectors: ['.unspoil-demo .comment-body'],
      kind: 'comment',
      threadRoot: '.unspoil-demo',
    },
  ],
  pageHints: (doc) => [
    doc.querySelector('.forum-title')?.textContent ?? '',
    doc.querySelector('h1')?.textContent ?? '',
  ],
};

const adapters = [youtube, x, reddit, demo];

export function adapterFor(host: string): SiteAdapter | null {
  if (!location.pathname.startsWith('/demo') && (host === '127.0.0.1' || host === 'localhost')) {
    return adapters.find((adapter) => adapter.id !== 'demo' && adapter.matches(host)) ?? null;
  }
  return adapters.find((adapter) => adapter.matches(host)) ?? null;
}
