export interface CatalogTitle {
  id: string; name: string; original: string; year: string; kind: 'movie' | 'series'; category: string; color: string; aliases: string[];
}
export const catalog: CatalogTitle[] = [
  { id: 'movie-299534', name: 'Avengers: Endgame', original: '어벤져스: 엔드게임', year: '2019', kind: 'movie', category: 'Movie', color: '#64498b', aliases: ['endgame', '어벤져스', '엔드게임'] },
  { id: 'tv-93405', name: 'Squid Game', original: '오징어 게임', year: '2021', kind: 'series', category: 'Series', color: '#a84964', aliases: ['오징어게임'] },
  { id: 'tv-1429', name: 'Attack on Titan', original: '進撃の巨人 · 진격의 거인', year: '2013', kind: 'series', category: 'Anime', color: '#62775b', aliases: ['진격의 거인', '진격의거인', 'aot'] },
  { id: 'tv-66732', name: 'Stranger Things', original: '기묘한 이야기', year: '2016', kind: 'series', category: 'Series', color: '#994f39', aliases: [] },
  { id: 'movie-27205', name: 'Inception', original: '인셉션', year: '2010', kind: 'movie', category: 'Movie', color: '#426779', aliases: [] },
  { id: 'movie-157336', name: 'Interstellar', original: '인터스텔라', year: '2014', kind: 'movie', category: 'Movie', color: '#897b56', aliases: [] },
  { id: 'movie-496243', name: 'Parasite', original: '기생충', year: '2019', kind: 'movie', category: 'Movie', color: '#496454', aliases: [] },
  { id: 'tv-1396', name: 'Breaking Bad', original: '브레이킹 배드', year: '2008', kind: 'series', category: 'Series', color: '#637743', aliases: [] },
  { id: 'tv-85937', name: 'Demon Slayer: Kimetsu no Yaiba', original: '鬼滅の刃 · 귀멸의 칼날', year: '2019', kind: 'series', category: 'Anime', color: '#36827b', aliases: ['귀멸의칼날'] },
  { id: 'tv-60059', name: 'Better Call Saul', original: '베터 콜 사울', year: '2015', kind: 'series', category: 'Series', color: '#ad813b', aliases: [] },
];
catalog.push({ id: 'tv-120089', name: 'SPY x FAMILY', original: 'SPY×FAMILY', year: '2022', kind: 'series', category: 'Anime', color: '#64877b', aliases: ['Spy Family', '스파이 패밀리', '스파이패밀리', 'スパイファミリー'] });
const remote = new Map<string, CatalogTitle>();
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s:·]/g, '');
export function catalogEntry(id: string) { return catalog.find(t => t.id === id) ?? remote.get(id); }
export function catalogByName(name: string) { return [...catalog, ...remote.values()].find(t => normalize(t.name) === normalize(name) || normalize(t.original) === normalize(name)); }
export async function searchCatalog(query: string) {
  const q = normalize(query.trim().slice(0, 120));
  const local = catalog.filter(t => !q || normalize([t.name, t.original, ...t.aliases].join(' ')).includes(q));
  const token = process.env.TMDB_READ_TOKEN;
  if (!token || !q) return { results: local, source: 'starter' };
  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('query', query); url.searchParams.set('language', 'en-US'); url.searchParams.set('include_adult', 'false');
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    const body = await response.json() as { results: Array<Record<string, any>> };
    for (const r of body.results) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const t: CatalogTitle = { id: `${r.media_type === 'tv' ? 'tv' : 'movie'}-${r.id}`, name: r.title ?? r.name, original: r.original_title ?? r.original_name, year: (r.release_date ?? r.first_air_date ?? '').slice(0, 4), kind: r.media_type === 'movie' ? 'movie' : 'series', category: r.media_type === 'movie' ? 'Movie' : r.genre_ids?.includes(16) ? 'Anime' : 'Series', color: '#5b6d64', aliases: [] };
      remote.set(t.id, t);
    }
    const ids = body.results.map(r => `${r.media_type === 'tv' ? 'tv' : 'movie'}-${r.id}`);
    return { results: [...local, ...ids.map(id => remote.get(id)).filter((t): t is CatalogTitle => Boolean(t) && !local.some(l => l.id === t!.id))].slice(0, 12), source: 'tmdb' };
  } catch { return { results: local, source: 'starter', warning: 'Live catalog is unavailable. Showing the starter collection.' }; }
}
