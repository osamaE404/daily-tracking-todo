const $ = selector => document.querySelector(selector);
const status = message => { $('#status').textContent = message; };
const open = indexedDB.open('gharawi-todo', 1);
open.onupgradeneeded = () => open.result.createObjectStore('state');
const db = await new Promise((resolve, reject) => {
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
}).catch(error => { status('Device storage is unavailable. Enable browser storage and reload before adding tasks.'); throw error; });
const stored = await new Promise((resolve, reject) => {
  const request = db.transaction('state').objectStore('state').get('main');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
let state = stored || { cursor: 0, tasks: {}, pending: {}, conflicts: {} };
let token = sessionStorage.getItem('todo-sync-token') || '';
let view = 'all';
let editing;
const collapsed = new Set();
let work = Promise.resolve();
function enqueue(action) {
  work = work.then(action).catch(error => status(error.message || 'Operation failed. Your pending work remains on this device.'));
  return work;
}
async function save(next) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(next, 'main');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local save aborted'));
  });
  state = next;
  render();
}
function localDate(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}
function matches(task) {
  if (view === 'done') return task.done;
  if (view === 'all') return true;
  if (task.done || !task.due) return false;
  const today = localDate(new Date());
  const end = new Date(); end.setDate(end.getDate() + 6);
  return task.due.slice(0, 10) <= (view === 'today' ? today : localDate(end));
}
function button(text, action, label) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text;
  if (label) element.setAttribute('aria-label', label);
  element.addEventListener('click', action);
  return element;
}
function render() {
  const list = $('#tasks'); list.replaceChildren();
  const tasks = Object.values(state.tasks).filter(task => !task.deleted);
  const children = new Map();
  for (const task of tasks) {
    const key = tasks.some(parent => parent.id === task.parent) ? task.parent : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(task);
  }
  const sort = (a, b) => $('#sort').value === 'priority'
    ? b.priority - a.priority || a.title.localeCompare(b.title)
    : (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title);
  const seen = new Set();
  function row(task, depth = 0) {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    const branch = children.get(task.id) || [];
    if (matches(task)) {
      const element = document.createElement('div'); element.className = `task-row${task.done ? ' done' : ''}`;
      element.style.setProperty('--depth', depth);
      if (branch.length) {
        const toggle = button(collapsed.has(task.id) ? '+' : '−', () => { collapsed.has(task.id) ? collapsed.delete(task.id) : collapsed.add(task.id); render(); }, `Toggle subtasks of ${task.title}`);
        toggle.setAttribute('aria-expanded', String(!collapsed.has(task.id))); element.append(toggle);
      }
      const label = document.createElement('label'); label.className = 'check-label';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = task.done;
      check.setAttribute('aria-label', `Complete ${task.title}`);
      check.onchange = () => enqueue(() => change({ ...task, done: check.checked }));
      label.append(check); element.append(label);
      const title = button('', () => edit(task)); title.className = 'task-name';
      const strong = document.createElement('strong'); strong.textContent = task.title;
      const meta = document.createElement('small'); meta.textContent = [task.due && new Date(task.due).toLocaleString(), ['','Low','Medium','High'][task.priority]].filter(Boolean).join(' · ');
      title.append(strong, meta); element.append(title);
      element.append(button('+', () => { const title = prompt('Subtask title'); if (title?.trim()) enqueue(() => create(title, task.id)); }, `Add subtask to ${task.title}`));
      list.append(element);
    }
    if (!collapsed.has(task.id) || view !== 'all') branch.sort(sort).forEach(child => row(child, depth + 1));
  }
  (children.get(null) || []).sort(sort).forEach(task => row(task));
  if (!list.children.length) { const empty = document.createElement('p'); empty.textContent = 'Nothing here yet. Add a task or choose another view.'; list.append(empty); }
  for (const [id, remote] of Object.entries(state.conflicts)) {
    const notice = document.createElement('div'); notice.className = 'conflict';
    const text = document.createElement('p'); text.textContent = `Both devices edited “${state.tasks[id]?.title}”. Server version: “${remote.title}”. Choose which to keep, or export a backup first.`;
    notice.append(text, button('Keep this device', () => enqueue(() => resolveConflict(id, false))), button('Use server version', () => enqueue(() => resolveConflict(id, true))));
    list.prepend(notice);
  }
}
async function change(task) {
  const next = structuredClone(state); next.tasks[task.id] = task; next.pending[task.id] = true;
  await save(next); status('Saved on this device.');
  if (token && navigator.onLine) enqueue(synchronize);
}
async function create(title, parent = null) {
  await change({ id: crypto.randomUUID(), title: title.trim(), notes: '', due: '', priority: 0, parent, done: false, deleted: false, revision: 0 });
}
async function resolveConflict(id, useServer) {
  const next = structuredClone(state);
  next.tasks[id] = useServer ? next.conflicts[id] : { ...next.tasks[id], revision: next.conflicts[id].revision };
  delete next.conflicts[id];
  if (useServer) delete next.pending[id];
  await save(next); await synchronize();
}
async function synchronize() {
  if (!token) { status('Saved locally. Connect private sync to use another device.'); return; }
  const ids = Object.keys(state.pending).filter(id => !state.conflicts[id]).slice(0, 500);
  status('Synchronizing…');
  const response = await fetch('/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cursor: state.cursor, changes: ids.map(id => state.tasks[id]) }),
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  }).catch(() => { throw new Error('Connection unavailable. Your edits are saved locally and will retry when you reconnect.'); });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sync token was rejected. Reconnect with your private token.' : `Sync failed (${response.status}). Pending edits remain saved locally.`);
  const result = await response.json();
  const next = structuredClone(state);
  for (const conflict of result.conflicts) next.conflicts[conflict.id] = conflict;
  for (const id of ids) if (!next.conflicts[id]) delete next.pending[id];
  for (const record of result.records) if (!next.pending[record.id]) next.tasks[record.id] = record;
  next.cursor = result.cursor;
  await save(next);
  const pending = Object.keys(state.pending).length;
  status(pending ? `${pending} local edit(s) pending. Resolve any conflicts shown below.` : 'Saved here and synchronized with your server.');
}
function edit(task) {
  editing = task.id;
  const form = $('#edit');
  for (const key of ['title','notes','due','priority']) form.elements[key].value = task[key];
  $('#editor').showModal();
}
$('#add').onsubmit = event => {
  event.preventDefault(); const title = $('#title').value;
  enqueue(async () => { await create(title); $('#title').value = ''; });
};
$('#edit').onsubmit = event => {
  event.preventDefault(); const data = new FormData(event.target); const id = editing;
  enqueue(async () => { await change({ ...state.tasks[id], title: data.get('title').trim(), notes: data.get('notes'), due: data.get('due'), priority: Number(data.get('priority')) }); $('#editor').close(); });
};
document.querySelectorAll('[data-view]').forEach(item => item.onclick = () => {
  view = item.dataset.view;
  document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === item)));
  render();
});
$('#sort').onchange = render;
$('#connect').onclick = () => $('#connection').showModal();
$('#unlock').onsubmit = event => {
  event.preventDefault(); token = new FormData(event.target).get('token');
  sessionStorage.setItem('todo-sync-token', token); event.target.reset(); $('#connection').close(); enqueue(synchronize);
};
$('#lock').onclick = () => { token = ''; sessionStorage.removeItem('todo-sync-token'); $('#connection').close(); status('Sync locked. Local tasks remain on this device.'); };
$('#sync').onclick = () => enqueue(synchronize);
$('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `todo-${localDate(new Date())}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
addEventListener('online', () => enqueue(synchronize));
render(); status('Ready. Tasks save on this device first.');
if (token && navigator.onLine) enqueue(synchronize);
