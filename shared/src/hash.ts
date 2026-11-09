const MAX_LEN = 500;

export function normalizeText(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

export async function hashText(input: string): Promise<string> {
  const normalized = normalizeText(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
