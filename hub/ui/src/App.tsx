import { useEffect, useRef, useState } from 'react';
import { openRevealDialog, shouldBlock, type TitleState, type Verdict } from '@unspoil/shared';
import { api, type LiveState, type CatalogTitle, type SettingsView } from './api';

export function App() {
  const [state, setState] = useState<LiveState | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogTitle[]>([]);
  const [source, setSource] = useState('starter');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CatalogTitle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [remove, setRemove] = useState('');
  const search = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<LiveState>) {
    try { setError(''); setState(await action()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
  }
  useEffect(() => {
    let alive = true;
    const pull = () => void api.state(-1).then(s => { if (alive) setState(s); }).catch(() => { if (alive) setError('Cannot reach your local Hub. Restart Unspoil, then refresh this page.'); });
    pull(); void api.settings().then(s => { if (alive) setSettings(s); }).catch(() => {});
    const timer = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true; setSearching(true);
    const timer = setTimeout(() => void api.catalog(query).then(r => {
      if (alive) { setResults(r.results); setSource(r.warning ? 'unavailable' : r.source); }
    }).catch(() => { if (alive) setError('Title search is unavailable. Please try again.'); }).finally(() => { if (alive) setSearching(false); }), 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    if (!settings?.token) return;
    const pair = () => window.postMessage({type:'unspoil:pair', token:settings.token}, window.location.origin);
    const requested = (e: MessageEvent) => { if (e.source === window && e.origin === window.location.origin && e.data?.type === 'unspoil:request-pair') pair(); };
    window.addEventListener('message', requested); pair();
    return () => window.removeEventListener('message', requested);
  }, [settings?.token]);
  const linked = Boolean(state?.extensionSeenAt && Date.now() - state.extensionSeenAt < 6000);
  const focusSearch = () => { search.current?.scrollIntoView({behavior:'smooth',block:'center'}); search.current?.focus({preventScroll:true}); };
  const inLibrary = (name: string) => state?.titles.some(t => t.name.toLowerCase() === name.toLowerCase());

  return <div className="shell">
    <header className="header">
      <a className="brand" href="/" aria-label="Unspoil home"><ShieldIcon />unspoil<span>.</span></a>
      <nav aria-label="Main navigation"><a href="#library">Your library</a><a href="#experience">How it works</a></nav>
      <button className={`connection ${linked ? 'connected' : ''}`} onClick={() => setSetup(!setup)} aria-expanded={setup}><i/>{linked ? 'Browser connected' : 'Connect browser'}<span>↗</span></button>
    </header>
    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    <main>
      {settings && (!settings.hasKey || !linked) && <div className="notice readiness" role="status"><span><strong>{!settings.hasKey ? 'Your AI connection needs setup.' : 'One more step: connect your browser.'}</strong> {!settings.hasKey ? 'Add GROQ_API_KEY to .env and restart the Hub.' : 'Open this Hub in the Chrome profile with Unspoil installed.'}</span><button onClick={() => setSetup(true)}>Setup instructions ↗</button></div>}
      {setup && <section className="setup" aria-label="Browser setup"><div><p className="eyebrow">Browser setup</p><h2>A small extension.<br/>A quieter internet.</h2><p>In Chrome, open Extensions, turn on Developer mode, and load <code>extension/dist</code>. Refresh this Hub in the same Chrome profile to connect automatically.</p><p>If automatic pairing doesn’t work, paste this code into the Unspoil extension.</p><button className="secondary" onClick={() => settings && void navigator.clipboard.writeText(settings.token).catch(() => setError('Clipboard unavailable. Select and copy the pairing code.'))}>Copy pairing code</button><code className="pairing">{settings?.token ?? 'Loading…'}</code></div><div className="setup-status"><span className="status-label">{settings?.hasKey ? '✓ AI connection configured' : 'AI connection not configured'}</span><span className="status-label">{linked ? '✓ Browser connected' : 'Browser waiting for connection'}</span><p>Unspoil checks text on YouTube, Reddit, X, and Google search results. It doesn’t inspect images, video, or audio.</p><button className="text-button" onClick={() => setSetup(false)}>Close instructions ×</button></div></section>}
      <section className="intro-section">
        <div><p className="eyebrow">Your personal spoiler shield</p><h1>A good story.<br/><em>On your terms.</em></h1><p className="intro">Tell us where you stopped watching.<br/>We’ll keep the next part out of your feed.</p><button className="primary" onClick={focusSearch}>Add a story <span>+</span></button></div>
        <aside className="field-note"><span className="note-number">A note for anyone catching up</span><p>You shouldn’t have to<br/>quit the conversation<br/>to keep the surprise.</p><div className="note-rule"/><span>Read what you’ve seen.<br/>Leave the rest for later.</span></aside>
      </section>
      <section className="library" id="library">
        <div className="section-heading"><div><p className="eyebrow">Your place, saved</p><h2>Currently watching<span className="count">{state?.titles.length ?? 0}</span></h2></div><button className={`shield-toggle ${state?.shieldOn ? 'on' : ''}`} role="switch" aria-checked={state?.shieldOn ?? false} disabled={!state} onClick={() => state && void run(() => api.saveSettings({shieldOn:!state.shieldOn}))}><i/>Shield {state?.shieldOn ? 'on' : 'paused'}</button></div>
        {!state && <p className="empty-list" role="status">Loading your library…</p>}
        {state && !state.titles.length && <div className="empty-list"><p>Your library starts with the story you’re in the middle of.</p><button className="text-button" onClick={focusSearch}>Find your first title ↓</button></div>}
        <div className="watchlist">{state?.titles.map((t,i) => <article className={`watch-row ${t.shieldOn ? '' : 'paused'}`} key={t.id}>
          <span className="watch-index">{String(i+1).padStart(2,'0')}</span><div className="watch-title"><h3>{t.name}</h3><p>{t.memory === 'building' ? 'Preparing story memory. Text stays blurred while we check.' : t.memory === 'error' ? 'Limited episode knowledge. Uncertain plot details stay blurred.' : t.memory === 'low_confidence' ? 'Some episode details are uncertain. Extra caution is on.' : t.kind === 'series' ? 'Episodes watched across all seasons' : 'Keep it unwatched until you’ve seen the whole film'}</p></div>
          <ProgressControl title={t} onChange={n => void run(() => api.progress(t.id,n))}/>
          <button className="row-shield" aria-pressed={t.shieldOn} aria-label={`${t.shieldOn ? 'Pause' : 'Enable'} protection for ${t.name}`} onClick={() => void run(() => api.shield(t.id,!t.shieldOn))}><span className={t.shieldOn ? 'status-dot' : 'status-dot paused'}/>{t.shieldOn ? 'Protected' : 'Paused'}</button>
          {t.memory === 'error' && <button className="text-button retry" onClick={() => void run(() => api.retry(t.id))}>Retry memory</button>}
          <button className="delete" aria-label={`Remove ${t.name}`} onClick={() => { if (remove === t.id) { void run(() => api.remove(t.id));setRemove(''); } else setRemove(t.id); }}>{remove === t.id ? 'Remove?' : '×'}</button>{remove === t.id && <button className="text-button" onClick={() => setRemove('')}>Cancel</button>}
        </article>)}</div>
      </section>
      <section className="collection" aria-labelledby="find-heading">
        <div className="section-heading"><h2 id="find-heading">Find your next story</h2><span className="section-note">Films, series, and anime</span></div>
        <div className="search-wrap"><SearchIcon/><input ref={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by title, in any language" aria-label="Search movies, series and anime" autoComplete="off"/>{query && <button aria-label="Clear search" onClick={()=>setQuery('')}>×</button>}</div>
        <div className="search-meta" aria-live="polite"><span>{searching ? 'Searching titles…' : query ? `${results.length} matching titles` : 'Start with a familiar title'}</span><span>{source==='tmdb' ? 'Title data by TMDB' : source==='unavailable' ? 'Live search unavailable · showing saved titles' : 'Curated collection'}</span></div>
        <div className="discover">{(query ? results : results.slice(0,6)).map(t => <button className="discover-card" key={t.id} disabled={inLibrary(t.name)} onClick={()=>setSelected(t)}><span className="title-art" style={{background:t.color}} aria-hidden="true">{t.name.replace(/^(the|a) /i,'').split(/\s+/).slice(0,2).map(s=>s[0]).join('')}</span><span className="discover-copy"><strong>{t.name}</strong><span>{t.category} · {t.year}{t.original && t.original!==t.name ? ` · ${t.original}` : ''}</span></span><span className="add-icon">{inLibrary(t.name) ? '✓' : '+'}</span></button>)}</div>
        {!searching && !results.length && <p className="empty-list">No matches. Try the English or original title.{source!=='tmdb' && ' Worldwide search requires TMDB_READ_TOKEN in your .env file.'}</p>}
      </section>
      <section className="experience" id="experience"><div className="experience-copy"><p className="eyebrow">A little preview</p><h2>Same conversation.<br/><em>Nothing given away.</em></h2><p>A comment can be harmless to someone who’s caught up, and a spoiler to you.</p><p>Move the episode slider to see the difference. Or click a blurred comment to try the reveal flow.</p><p className="sample-label">Fictional example. This slider won’t change your library.</p></div><Experience/></section>
      <section className="try-live"><div><p className="eyebrow">Ready when you are</p><h2>Take it into your browser.</h2><p>Your saved progress follows you to supported feeds. For a controlled test, try the live fan forum.</p></div><a className="secondary" href="/demo/">Open test forum ↗</a></section>
    </main>
    <footer><a className="brand" href="/">unspoil.</a><span>For everyone still catching up.</span><button className="text-button" onClick={()=>{setSetup(true);window.scrollTo({top:0,behavior:'smooth'});}}>Browser setup ↗</button></footer>
    {selected && <AddTitleDialog title={selected} busy={busy} onClose={()=>!busy && setSelected(null)} onAdd={async progress=>{setBusy(true);try{setState(await api.createTitle(selected.id,progress));setSelected(null);}catch(e){setError(e instanceof Error?e.message:'Could not save this title.');}finally{setBusy(false);}}}/>}
  </div>;
}

function ShieldIcon(){return <svg width="26" height="30" viewBox="0 0 26 30" fill="none" aria-hidden="true"><path d="M13 2L24 6V14C24 20 19 25 13 28C7 25 2 20 2 14V6L13 2Z" stroke="currentColor" strokeWidth="1.8"/><path d="M8 11V15C8 21 18 21 18 15V11" stroke="currentColor" strokeWidth="2"/></svg>;}
function SearchIcon(){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6"/><path d="M16 16L21 21" stroke="currentColor" strokeWidth="1.6"/></svg>;}
function ProgressControl({title,onChange}:{title:TitleState;onChange:(n:number)=>void}){
  const [draft,setDraft]=useState(String(title.progress));
  useEffect(()=>setDraft(String(title.progress)),[title.progress]);
  if(title.kind!=='series')return <button className="movie-progress" onClick={()=>onChange(title.progress?0:1)}>{title.progress?'✓ Watched':'Not watched yet'}</button>;
  const save=()=>{const n=Number(draft);if(draft!=='' && Number.isInteger(n) && n>=0 && n<=(title.totalEpisodes??500)){if(n!==title.progress)onChange(n);}else setDraft(String(title.progress));};
  const step=(delta:number)=>{const value=Number(draft);const next=Math.max(0,Math.min(title.totalEpisodes??500,(draft!=='' && Number.isInteger(value)?value:title.progress)+delta));setDraft(String(next));if(next!==title.progress)onChange(next);};
  return <div className="progress-control"><button aria-label={`Previous episode of ${title.name}`} disabled={title.progress===0} onMouseDown={e=>e.preventDefault()} onClick={()=>step(-1)}>−</button><label><span>Episode</span><input aria-label={`Episodes watched of ${title.name}`} type="number" min={0} max={title.totalEpisodes??500} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label><button aria-label={`Next episode of ${title.name}`} disabled={title.progress>=(title.totalEpisodes??500)} onMouseDown={e=>e.preventDefault()} onClick={()=>step(1)}>+</button></div>;
}
function AddTitleDialog({title,busy,onClose,onAdd}:{title:CatalogTitle;busy:boolean;onClose:()=>void;onAdd:(n:number)=>Promise<void>}){
 const ref=useRef<HTMLDialogElement>(null);const [progress,setProgress]=useState(0);
 useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="add-dialog" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClick={e=>{if(e.target===e.currentTarget && !busy)onClose();}}><section><button className="close" aria-label="Close" disabled={busy} onClick={onClose}>×</button><p className="eyebrow">Add to your library</p><h2>{title.name}</h2><p className="dialog-meta">{title.category} · {title.year}</p><form onSubmit={e=>{e.preventDefault();void onAdd(progress);}}><label>{title.kind==='movie'?'Have you seen it?':'How many episodes have you finished?'}{title.kind==='movie'?<select autoFocus value={progress} onChange={e=>setProgress(Number(e.target.value))}><option value={0}>Not yet — keep the surprises</option><option value={1}>Yes — I’ve watched it</option></select>:<input autoFocus type="number" min={0} max={500} required value={progress} onChange={e=>setProgress(Number(e.target.value))}/>}</label><p className="hint">{title.kind==='movie'?'We’ll keep plot details blurred until you mark the film watched.':'Count episodes across all seasons. Enter 0 if you haven’t started.'}</p><button className="primary full" disabled={busy}>{busy?'Saving…':'Save my place'}<span>→</span></button></form></section></dialog>;
}
function Experience(){
 const [progress,setProgress]=useState(2);
 const [revealed,setRevealed]=useState<number[]>([]);
 const [warned,setWarned]=useState<number[]>([]);
 const closeDialog=useRef<(()=>void)|undefined>(undefined);
 useEffect(()=>()=>closeDialog.current?.(),[]);
 const example:TitleState={id:'sample',name:'The Midnight Letters',kind:'series',progress,totalEpisodes:8,shieldOn:true,memory:'ready',gateTerms:[],episodes:[],source:'model'};
 const rows=[{name:'Maya',initial:'M',text:'The soundtrack alone deserves its own fan club.',ep:0,level:0},{name:'Jules',initial:'J',text:'The hidden letter finally explains the midnight meeting.',ep:3,level:2},{name:'Nora',initial:'N',text:'That final reveal changes everything about the narrator.',ep:8,level:3}];
 return <div className="feed"><header className="feed-heading"><div><strong>The Midnight Letters</strong><span>A fictional fan conversation</span></div><span className="preview-tag">Preview</span></header><div className="feed-progress"><label htmlFor="preview-progress">You’ve watched <strong>{progress===0?'nothing yet':`episode ${progress}`}</strong></label><input id="preview-progress" aria-label="Preview watch progress" type="range" min={0} max={8} value={progress} onChange={e=>{closeDialog.current?.();setProgress(Number(e.target.value));setRevealed([]);setWarned([]);}}/><span>0<span>8</span></span></div>{rows.map((row,i)=>{
 const verdict:Verdict={id:String(i),hash:'',titleId:'sample',revealsOrdinal:row.ep,level:row.level as 0|2|3,reason:row.level?'plot':null,cached:true};
 const blocked=shouldBlock(verdict,example,'careful')&&!revealed.includes(i);
 return <article className="feed-post" key={i}><span className={`avatar a${i}`} aria-hidden="true">{row.initial}</span><div className="post-content"><span className="post-user">{row.name}<small>just now</small></span><div className={`post-body ${blocked?'is-blurred':''}`}><p aria-hidden={blocked}>{row.text}</p>{blocked&&<button className={`preview-veil ${warned.includes(i)?'warning':''}`} aria-label={warned.includes(i)?'Spoiler warning. Review before revealing':'Blurred comment. Click for spoiler details'} onClick={e=>{if(!warned.includes(i)){setWarned([...warned,i]);return;}closeDialog.current=openRevealDialog({returnFocus:e.currentTarget,onConfirm:()=>setRevealed(v=>[...v,i])});}}><span>{warned.includes(i)?<>This comment may contain spoilers.<small>Click to review before revealing</small></>:'Unspoil · click for details'}</span></button>}</div><span className="post-note">{blocked?`Beyond your episode · Ep ${row.ep}`:revealed.includes(i)?'Revealed by you':row.level?'You’ve caught up to this':'No plot details'}</span></div></article>;
 })}<p className="feed-footer">Blur first. Check the context. Let the safe parts through.</p></div>;
}
