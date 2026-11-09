import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { outputFiles } = await build({ entryPoints: ['extension/src/content.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' });
const script = outputFiles[0].text;
const css = fs.readFileSync('extension/isolate.css', 'utf8');
const title = { id: 'spy', name: 'SPY x FAMILY', kind: 'series', progress: 2, totalEpisodes: 37, shieldOn: true, memory: 'ready', gateTerms: ['Spy Family'], episodes: [], source: 'model' };
const initial = { rev: 1, shieldOn: true, strictness: 'careful', locale: 'en', titles: [title] };
const page = '<h1>Spy Family discussion</h1><shreddit-comment id="parent"><div slot="comment" id="safe">I love the soundtrack.</div><shreddit-comment><div slot="comment" id="spoiler">A future plot SPOILER is revealed here.</div></shreddit-comment></shreddit-comment>';
async function until(fn) { const end = Date.now() + 2000; while (!fn()) { if (Date.now() > end) throw new Error('condition timed out'); await new Promise(r => setTimeout(r, 10)); } }
function harness({ state = initial, online = true, classify, html = page, url = 'https://www.reddit.com/r/SpyxFamily/comments/example/', fetch } = {}) {
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
 w.eval(script);
 return { w, messages, errors, close: () => {w.dispatchEvent(new w.Event('pagehide')); w.close();}, state: s => listeners.forEach(f => f({type:'state',state:s,online:true}, {}, ()=>{})) };
}
test('Reddit starts concealed before state or model response, then independently releases safe comments', async () => {
 const h = harness();
 try {
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).opacity, '0');
  await until(() => h.w.document.querySelector('#spoiler').dataset.unspoil === 'blocked');
  assert.equal(h.w.document.querySelector('#safe').dataset.unspoil, 'safe');
  assert.equal(h.w.document.querySelector('#parent').hasAttribute('data-unspoil'), false);
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).opacity, '0');
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
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).opacity, '0');
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
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#new')).opacity,'0');
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
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('#spoiler')).opacity,'0');
 } finally {h.close();}
});
