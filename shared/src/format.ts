import type { EpisodeMark } from './types.ts';
import type { Locale } from './i18n.ts';
import { t } from './i18n.ts';

export function formatProgress(
  locale: Locale,
  progress: number,
  episodes: EpisodeMark[],
): string {
  if (progress <= 0) return t(locale, 'progress.notStarted');
  const mark = episodes.find((episode) => episode.ordinal === progress);
  const hasSeason = episodes.some((episode) => episode.season > 0);
  if (mark && hasSeason) return `S${mark.season} E${mark.episode}`;
  return t(locale, 'progress.episode', { n: progress });
}
