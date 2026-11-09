import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { outputFiles } = await build({ entryPoints: ['extension/src/content.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' });
const script = outputFiles[0].text;
const css = fs.readFileSync('extension/isolate.css', 'utf8');
const title = { id: 'spy', name: 'SPY x FAMILY', kind: 'series', progress: 2, totalEpisodes: 37, shieldOn: true, memory: 'ready', gateTerms: ['SPY x FAMILY', 'Spy Family'], episodes: [], source: 'model' };
const initial = { rev: 1, shieldOn: true, strictness: 'careful', locale: 'en', titles: [title] };
const page = '<h1>Spy Family discussion</h1><shreddit-comment id="parent"><div slot="comment" id="safe">I love the soundtrack.</div><shreddit-comment><div slot="comment" id="spoiler">A future plot SPOILER is revealed here.</div></shreddit-comment></shreddit-comment>';
async function until(fn) { const end = Date.now() + 2000; while (!fn()) { if (Date.now() > end) throw new Error('condition timed out'); await new Promise(r => setTimeout(r, 10)); } }
function harness({ state = initial, online = true, classify, html = page, url = 'https://www.reddit.com/r/SpyxFamily/comments/example/', fetch, beforeEval } = {}) {
 const dom = new JSDOM(`<style>${css}</style>${html}`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
 const w = dom.window;
 if (fetch) w.fetch = fetch;
 const messages = [], listeners = [], errors = [];
 w.addEventListener('error', e => errors.push(e.error));
 w.chrome = {runtime: {onMessage: {addListener: f => listeners.push(f)}, sendMessage: (m, cb) => {
  messages.push(m);
  if (m.type === 'getState') { queueMicrotask(() => cb({state, online})); return; }
  if (m.type === 'classify') return classify ? classify(m) : Promise.resolve({ok:true,response:{verdicts:m.items.flatMap(i => m.titleIds.map(id => ({id:i.id,hash:i.id,titleId:i.text.includes('SPOILER') ? id : null,level:i.text.includes('SPOILER') ? 3 : 0,revealsOrdinal:5,reason:'plot',cached:false})))}});
  return Promise.resolve({ok:true});
 }}};
 beforeEval?.(w);
 w.eval(script);
 return { w, messages, errors, close: () => {w.dispatchEvent(new w.Event('pagehide')); w.close();}, state: s => listeners.forEach(f => f({type:'state',state:s,online:true}, {}, ()=>{})) };
}
test('Reddit starts concealed before state or model response, then independently releases safe comments', async () => {
 const h = harness();
 try {
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).filter, 'blur(12px)');
  await until(() => h.w.document.querySelector('#spoiler').dataset.unspoil === 'blocked');
  assert.equal(h.w.document.querySelector('#safe').dataset.unspoil, 'safe');
  assert.equal(h.w.document.querySelector('#parent').hasAttribute('data-unspoil'), false);
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).filter, 'blur(12px)');
  h.state({...initial,rev:2,titles:[{...title,progress:5}]});
  await until(() => h.w.document.querySelector('#spoiler').dataset.unspoil === 'safe');
  assert.deepEqual(h.errors, []);
 } finally { h.close(); }
});
test('missing pairing state never releases Reddit text', async () => {
 const h = harness({state:null,online:false});
 try {
  await until(() => h.w.document.querySelector('#spoiler').dataset.unspoil === 'offline');
  assert.equal(h.w.document.documentElement.dataset.unspoilGate, 'unknown');
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).filter, 'blur(12px)');
  assert.equal(h.messages.some(m => m.type === 'classify'), false);
  assert.deepEqual(h.errors, []);
 } finally {h.close();}
});
test('a spoiler after character 500 is classified and remains concealed', async () => {
 const h = harness({html:`<shreddit-comment><div slot="comment" id="long">${'Harmless discussion. '.repeat(40)}SPOILER ending.</div></shreddit-comment>`});
 try {
  await until(() => h.w.document.querySelector('#long').dataset.unspoil === 'blocked');
  const items=h.messages.filter(m=>m.type==='classify').flatMap(m=>m.items);
  assert.ok(items.length > 1);
  assert.ok(items.some(i=>i.text.includes('SPOILER')));
 } finally {h.close();}
});
test('new comments stay concealed while AI is unavailable', async () => {
 const h = harness({classify:async()=>({ok:false,offline:true})});
 try {
  const c=h.w.document.createElement('shreddit-comment'); c.innerHTML='<div slot="comment" id="new">A new SPOILER appeared.</div>'; h.w.document.body.append(c);
  await until(()=>h.w.document.querySelector('#new').dataset.unspoil==='offline');
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#new')).filter,'blur(12px)');
 } finally {h.close();}
});
test('Hub accepts pairing only from its own page origin', async () => {
 const h=harness({url:'http://127.0.0.1:47821/',html:'<main>Hub</main>',fetch:async path=>{assert.equal(path,'/v1/settings');return {ok:true,json:async()=>({token:'local-test-token'})};}});
 try {
  h.w.dispatchEvent(new h.w.MessageEvent('message', {source:h.w,origin:'https://evil.example',data:{type:'unspoil:pair',token:'wrong'}}));
  assert.equal(h.messages.some(m=>m.type==='connect'),false);
  h.w.dispatchEvent(new h.w.MessageEvent('message', {source:h.w,origin:'http://127.0.0.1:47821',data:{type:'unspoil:pair',token:'local-test-token'}}));
  await until(()=>h.messages.some(m=>m.type==='connect'));
  assert.equal(h.messages.find(m=>m.type==='connect').base,'http://127.0.0.1:47821');
  assert.equal(h.w.document.querySelector('[data-unspoil]'),null);
 } finally {h.close();}
});
test('one missing model verdict keeps that comment hidden without hiding completed safe comments', async () => {
 const h = harness({classify:async m=>({ok:true,response:{verdicts:m.items.filter(i=>!i.text.includes('SPOILER')).flatMap(i=>m.titleIds.map(id=>({id:i.id,hash:i.id,titleId:null,level:0,revealsOrdinal:null,reason:null,cached:false})))}})});
 try {
  await until(()=>h.w.document.querySelector('#safe').dataset.unspoil==='safe');
  assert.equal(h.w.document.querySelector('#spoiler').dataset.unspoil,'failed');
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).filter,'blur(12px)');
 } finally {h.close();}
});

function veil(h) { return Array.from(h.w.document.querySelectorAll('.unspoil-float')).map(host=>host.shadowRoot?.querySelector('button')).find(button=>button?.dataset.stage==='idle' || button?.dataset.stage==='warning'); }
test('blur requires warning, explicit confirmation, and preserves blur when cancelled', async () => {
 const h=harness();
 try {
  const node=h.w.document.querySelector('#spoiler');
  await until(()=>node.dataset.unspoil==='blocked');
  const surface=veil(h);
  assert.ok(surface);
  assert.equal(h.w.getComputedStyle(node).opacity,'1');
  surface.click();
  assert.equal(surface.dataset.stage,'warning');
  assert.match(surface.textContent,/may contain spoilers/);
  assert.equal(node.dataset.unspoil,'blocked');
  assert.equal(h.w.document.querySelector('#unspoil-reveal-dialog'),null);
  surface.click();
  let dialog=h.w.document.querySelector('#unspoil-reveal-dialog');
  assert.ok(dialog);
  assert.equal(dialog.shadowRoot.activeElement.className,'cancel');
  dialog.shadowRoot.querySelector('.cancel').click();
  assert.equal(node.dataset.unspoil,'blocked');
  surface.click();
  dialog=h.w.document.querySelector('#unspoil-reveal-dialog');
  dialog.shadowRoot.querySelector('.confirm').click();
  assert.equal(node.dataset.unspoil,'revealed');
  assert.equal(h.w.getComputedStyle(node).filter,'blur(0)');
  assert.equal(h.messages.filter(m=>m.type==='events').flatMap(m=>m.events).filter(e=>e.decision==='revealed').length,1);
 } finally {h.close();}
});
test('confirmation cannot reveal replacement text in a recycled comment node', async () => {
 const h=harness();
 try {
  const node=h.w.document.querySelector('#spoiler');
  await until(()=>node.dataset.unspoil==='blocked');
  const surface=veil(h); surface.click();surface.click();
  const dialog=h.w.document.querySelector('#unspoil-reveal-dialog');
  node.textContent='A different SPOILER replaces this comment.';
  await until(()=>node.dataset.unspoil==='pending');
  dialog.shadowRoot.querySelector('.confirm').click();
  assert.notEqual(node.dataset.unspoil,'revealed');
 } finally {h.close();}
});

test('Google AI overview is blurred before classification and uses the relevant story only', async () => {
 const h=harness({url:'https://www.google.com/search?q=does+anya+know',state:{...initial,titles:[title,{...title,id:'movie',name:'Unrelated Movie',gateTerms:['unrelated movie']}]},html:'<div class="M8OgIe"><div data-scope-id="turn">SPY x FAMILY contains a future SPOILER here.</div></div><div id="rso"></div>'});
 try {
  const overview=h.w.document.querySelector('.M8OgIe');
  assert.equal(h.w.getComputedStyle(overview).filter,'blur(12px)');
  await until(()=>overview.dataset.unspoil==='blocked');
  assert.equal(h.w.document.querySelector('[data-scope-id="turn"]').hasAttribute('data-unspoil'),false);
  assert.ok(h.messages.filter(m=>m.type==='classify').every(m=>m.titleIds.length===1&&m.titleIds[0]==='spy'));
 } finally {h.close();}
});
test('Google hidden metadata is not sent as hundreds of text chunks', async () => {
 const h=harness({url:'https://www.google.com/search?q=spy+family',html:`<div class="M8OgIe">SPY x FAMILY SPOILER.<script type="application/json">${'hidden metadata '.repeat(2000)}</script></div>`,beforeEval:w=>Object.defineProperty(w.document.querySelector('.M8OgIe'),'innerText',{get:()=> 'SPY x FAMILY SPOILER.'})});
 try {
  await until(()=>h.w.document.querySelector('.M8OgIe').dataset.unspoil==='blocked');
  assert.equal(h.messages.filter(m=>m.type==='classify').flatMap(m=>m.items).length,1);
 } finally {h.close();}
});
test('rate limiting holds blur and waits instead of retrying immediately', async () => {
 const h=harness({classify:async()=>({ok:false,retryAfterMs:15000})});
 try {
  await until(()=>h.w.document.querySelector('#spoiler').dataset.unspoil==='waiting');
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).filter,'blur(12px)');
  assert.equal(h.messages.filter(m=>m.type==='classify').length,1);
  h.state(initial);h.state(initial);
  await new Promise(r=>setTimeout(r,80));
  assert.equal(h.messages.filter(m=>m.type==='classify').length,1);
 } finally {h.close();}
});

test('completed Google results survive a later rate-limited batch', async () => {
 let calls=0;
 const h=harness({url:'https://www.google.com/search?q=spy+family',html:`<div id="rso">${Array.from({length:10},(_,i)=>`<h3 id="result-${i}">A harmless recommendation ${i}</h3>`).join('')}</div>`,classify:async m=>{
  calls++;if(calls===2)return {ok:false,retryAfterMs:15000};
  return {ok:true,response:{verdicts:m.items.map(i=>({id:i.id,hash:i.id,titleId:null,level:0,revealsOrdinal:null,reason:null,cached:false}))}};
 }});
 try {
  await until(()=>h.w.document.querySelector('#result-9').dataset.unspoil==='waiting');
  assert.equal(h.w.document.querySelector('#result-0').dataset.unspoil,'safe');
  assert.equal(calls,2);
 } finally {h.close();}
});
