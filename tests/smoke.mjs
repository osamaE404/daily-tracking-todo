import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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
  const request = (body, secret = token) => fetch(`${base}/api/sync`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${secret}`}, body:JSON.stringify(body) });
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
  await call('Runtime.enable'); await call('Network.enable');
  await until(()=>evaluate("document.querySelector('#status')?.textContent.includes('Ready')"));
  await evaluate('navigator.serviceWorker.ready.then(() => true)');
  await call('Page.reload');
  await until(()=>evaluate("Boolean(navigator.serviceWorker.controller) && document.querySelector('#status')?.textContent.includes('Ready')"));
  await call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate("document.querySelector('#title').value='Offline smoke task';document.querySelector('#add').requestSubmit()");
  await until(()=>evaluate("document.querySelector('#tasks').textContent.includes('Offline smoke task')"));
  await call('Page.reload');
  await until(()=>evaluate("document.querySelector('#tasks')?.textContent.includes('Offline smoke task')"));
  await call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`document.querySelector('#unlock input').value=${JSON.stringify(token)};document.querySelector('#unlock').requestSubmit()`);
  await until(()=>evaluate("document.querySelector('#status').textContent.includes('synchronized')"));
  const snapshot = await request({cursor:0,changes:[]}).then(r=>r.json());
  assert.equal(snapshot.records[0].title, 'Offline smoke task');
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
  console.log('PASS: authenticated API, private files blocked, PWA shell, offline save/reload, reconnect sync, conflicts, responsive app, install fallback.');
} finally {
  socket?.close(); chrome?.kill(); server.kill();
}
