import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = await mkdtemp(join(tmpdir(), 'todo-smoke-'));
const base = 'http://127.0.0.1:18080';
const token = 'test-only-token-with-at-least-32-characters';
const server = Bun.spawn(['target/release/gharawi-todo'], { env: { ...process.env, TODO_SYNC_TOKEN: token, TODO_LISTEN: '127.0.0.1:18080', TODO_DB: join(scratch, 'test.db') }, stdout:'ignore', stderr:'inherit' });
let chrome;
let socket;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { try { if (await check()) return; } catch {} await sleep(100); }
  throw new Error(`Timed out waiting for: ${check.toString()}`);
}
try {
  await until(async () => (await fetch(`${base}/api/health`)).ok);
  const request = (body, secret = token) => fetch(`${base}/api/sync`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${secret}`}, body:JSON.stringify({schema:2,collections:[],...body}) });
  assert.equal((await request({cursor:0,changes:[]}, 'wrong')).status, 401);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/src/main.rs`)).status, 404);
  assert.equal((await fetch(`${base}/manifest.webmanifest`).then(r=>r.json())).start_url, '/app/');
  chrome = Bun.spawn(['google-chrome-stable', '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=19227', `--user-data-dir=${join(scratch, 'chrome')}`, `${base}/app/`], {stdout:'ignore',stderr:'ignore'});
  await until(async () => (await fetch('http://127.0.0.1:19227/json')).ok);
  const pages = await fetch('http://127.0.0.1:19227/json').then(r=>r.json());
  const page = pages.find(page=>page.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let sequence = 0;
  const waiting = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id) { waiting.get(message.id)?.(message); waiting.delete(message.id); }
  };
  const call = (method, params={}) => new Promise((resolve,reject)=>{
    const id = ++sequence;
    waiting.set(id, message=>message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const capture = async name => {
    const result = await call('Page.captureScreenshot', {format:'png',fromSurface:true});
    await writeFile(join(scratch, name), Buffer.from(result.data, 'base64'));
  };
  await call('Runtime.enable'); await call('Network.enable');
  await until(()=>evaluate("document.querySelector('#status')?.textContent.includes('Ready')"));
  await evaluate('navigator.serviceWorker.ready.then(() => true)');
  await evaluate('window.__beforeSmokeReload = true');
  await call('Page.reload');
  await until(()=>evaluate("!window.__beforeSmokeReload && document.readyState === 'complete' && Boolean(navigator.serviceWorker.controller) && document.querySelector('#status')?.textContent.includes('Ready')"));
  await evaluate("document.querySelector('[data-create=list]').click();document.querySelector('#collection-form [name=title]').value='Work';document.querySelector('#collection-form').requestSubmit()");
  await until(()=>evaluate("document.querySelector('#collections').textContent.includes('Work')"));
  await evaluate("document.querySelector('[data-create=tag]').click();document.querySelector('#collection-form [name=title]').value='Next';document.querySelector('#collection-form').requestSubmit()");
  await until(()=>evaluate("document.querySelector('#tags').textContent.includes('Next')"));
  await evaluate("[...document.querySelectorAll('#collections .nav-item')].find(node=>node.textContent.includes('Work')).click()");
  await call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate("document.querySelector('#title').value='Offline smoke task';document.querySelector('#add').requestSubmit()");
  try {
    await until(()=>evaluate("document.querySelector('#tasks').textContent.includes('Offline smoke task')"));
  } catch (error) {
    const diagnostics = await evaluate("new Promise(resolve=>{const open=indexedDB.open('gharawi-todo');open.onsuccess=()=>{const get=open.result.transaction('state').objectStore('state').get('main');get.onsuccess=()=>resolve({status:document.querySelector('#status')?.textContent,tasks:document.querySelector('#tasks')?.textContent,title:document.querySelector('#title')?.value,state:get.result})}})");
    throw new Error(`${error.message}; browser=${JSON.stringify(diagnostics)}; exceptions=${JSON.stringify(errors)}`);
  }
  await evaluate("document.querySelector('.task-name').click()");
  await evaluate("document.querySelector('#priority').value='3';document.querySelector('#priority').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#task-tags input').click();document.querySelector('#schedule').click();document.querySelector('#calendar [data-offset=\"1\"]').click();document.querySelector('#date-form').requestSubmit();document.querySelector('#repeat').click();document.querySelector('#repeat-form [name=interval]').value='3';document.querySelector('#repeat-form').requestSubmit();document.querySelector('#edit').requestSubmit()");
  await until(()=>evaluate("document.querySelector('#tasks').textContent.includes('High') && document.querySelector('#tasks').textContent.includes('Tomorrow') && document.querySelector('#tasks').textContent.includes('#Next') && document.querySelector('#tasks').textContent.includes('Every 3 days')"));
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await capture('desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await capture('mobile-detail.png');
  await evaluate("document.querySelector('#close-detail').click()");
  await capture('mobile-list.png');
  await evaluate("document.querySelector('.task-check').click()");
  await until(()=>evaluate("document.querySelectorAll('.task-row').length === 1 && document.querySelector('#tasks').textContent.includes('Every 3 days')"));
  await evaluate('window.__beforeOfflineReload = true');
  await call('Page.reload');
  await until(()=>evaluate("!window.__beforeOfflineReload && document.readyState === 'complete' && document.querySelector('#tasks')?.textContent.includes('Offline smoke task')"));
  await call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`document.querySelector('#unlock input').value=${JSON.stringify(token)};document.querySelector('#unlock').requestSubmit()`);
  try {
    await until(()=>evaluate("document.querySelector('#status').textContent.includes('synchronized')"));
  } catch (error) {
    throw new Error(`${error.message}; status=${await evaluate("document.querySelector('#status').textContent")}; exceptions=${JSON.stringify(errors)}`);
  }
  const snapshot = await request({cursor:0,changes:[]}).then(r=>r.json());
  assert.equal(snapshot.records[0].title, 'Offline smoke task');
  assert.equal(snapshot.records[0].priority, 3);
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.records.filter(record=>record.done).length, 1);
  assert.equal(snapshot.collections.length, 2);
  const stale = {...snapshot.records[0], title:'Remote change'};
  assert.equal((await request({cursor:snapshot.cursor,changes:[stale]})).status,200);
  const conflict = await request({cursor:snapshot.cursor,changes:[{...stale,title:'Stale local change'}]}).then(r=>r.json());
  assert.equal(conflict.conflicts.length,1);
  for (const width of [390, 768, 1440]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,`overflow at ${width}`);
  }
  await call('Page.navigate',{url:base});
  await until(()=>evaluate("Boolean(document.querySelector('[data-install]'))"));
  await evaluate("document.querySelector('[data-install]').click()");
  await until(()=>evaluate("document.querySelector('#install-help').open"));
  assert.deepEqual(errors,[]);
  console.log(`PASS: API, private files, PWA shell, collections, scheduling, deterministic recurrence, offline save/reload, sync conflicts, responsive app, install fallback. Screenshots: ${scratch}`);
} finally {
  socket?.close(); chrome?.kill(); server.kill();
}
