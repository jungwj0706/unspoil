const CJK = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/;

export function normalizeForMatch(input: string): string {
  return input.normalize('NFKC').toLowerCase();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function termMatches(haystack: string, term: string): boolean {
  const needle = normalizeForMatch(term).trim();
  if (!needle) return false;
  const text = normalizeForMatch(haystack);
  if (CJK.test(needle)) {
    if ([...needle].length < 2) return false;
    return text.includes(needle);
  }
  if (needle.length < 3) return false;
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`, 'i');
  return pattern.test(text);
}

export function anyTermMatches(haystack: string, terms: string[]): boolean {
  return terms.some((term) => termMatches(haystack, term));
}
