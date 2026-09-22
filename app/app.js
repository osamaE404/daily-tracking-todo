import { COLORS, PRIORITIES, VIEWS, dayOffset, dueLabel, isOverdue, localDate, matches, newTask, nextOccurrence, repeatLabel, taskRows } from './model.js';
import { openStore } from './store.js';
import { createCalendar } from './calendar.js';

const $ = selector => document.querySelector(selector);
const status = message => { $('#status').textContent = message; };
const attempt = action => Promise.resolve().then(action).catch(error => status(error.message));
let state, view = 'all', selected, draft, original, dirty = false, collectionEditing, subtaskParent;
const collapsed = new Set(), collapsedFolders = new Set();
const store = await openStore(next => { state = next; render(); }, status).catch(error => {
  status('Cannot open device storage. Enable browser storage and reload before adding tasks.'); throw error;
});
state = store.state;

function element(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, label, className) {
  const node = element('button', className, text); node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  node.onclick = () => attempt(action); return node;
}
function collections(kind) { return Object.values(state.collections).filter(item => !item.deleted && item.kind === kind).sort((a, b) => a.title.localeCompare(b.title)); }
function count(id) { return Object.values(state.tasks).filter(task => matches(task, id, state.collections)).length; }
function discardDraft() { return !dirty || confirm('Discard the unsaved changes to this task?'); }
function closeNavigation() { document.body.classList.remove('nav-open'); $('#main').inert = false; $('#details').inert = false; $('#open-nav').focus(); }
function openNavigation() {
  document.body.classList.add('nav-open');
  if (innerWidth < 720) { $('#main').inert = true; $('#details').inert = true; }
  $('#close-nav').focus();
}
function chooseView(id) {
  if (!discardDraft()) return;
  dirty = false; view = id; selected = null; draft = null; closeDetails(false); closeNavigation(); render();
}
function navItem(id, name, icon, color) {
  const node = button('', () => chooseView(id), null, 'nav-item'); node.dataset.view = id;
  node.dataset.color = color || 'blue'; node.setAttribute('aria-current', view === id ? 'page' : 'false');
  node.append(element('span', 'nav-icon', icon), element('span', 'nav-title', name), element('span', 'count', count(id)));
  return node;
}
function renderNavigation() {
  const icons = { all: '▤', today: '☀', tomorrow: '↗', week: '▦', inbox: '▱', done: '✓' };
  $('#views').replaceChildren(...Object.entries(VIEWS).map(([id, name]) => navItem(id, name, icons[id])));
  const list = $('#collections'); list.replaceChildren();
  for (const folder of collections('folder')) {
    const group = element('div', 'folder-row');
    const toggle = button(collapsedFolders.has(folder.id) ? '›' : '⌄', () => { collapsedFolders.has(folder.id) ? collapsedFolders.delete(folder.id) : collapsedFolders.add(folder.id); renderNavigation(); }, `Toggle folder ${folder.title}`);
    toggle.setAttribute('aria-expanded', String(!collapsedFolders.has(folder.id)));
    group.append(toggle, navItem(folder.id, folder.title, '▱', folder.color)); list.append(group);
    if (!collapsedFolders.has(folder.id)) {
      const children = element('div', 'folder-children');
      for (const item of collections('list').filter(item => item.parent === folder.id)) children.append(navItem(item.id, item.title, '▤', item.color));
      list.append(children);
    }
  }
  for (const item of collections('list').filter(item => !item.parent)) list.append(navItem(item.id, item.title, '▤', item.color));
  if (!list.children.length) list.append(element('p', 'nav-hint', 'Create a list for an area of your life. Use folders to group lists.'));
  $('#tags').replaceChildren(...collections('tag').map(tag => navItem(tag.id, tag.title, '#', tag.color)));
  if (!collections('tag').length) $('#tags').append(element('p', 'nav-hint', 'Tags connect tasks across lists.'));
  document.querySelectorAll('.bottom-nav [data-view]').forEach(node => node.setAttribute('aria-current', node.dataset.view === view ? 'page' : 'false'));
}
function checkTask(task) {
  const label = element('label', 'check-label'); label.dataset.priority = task.priority;
  const check = element('input', 'task-check'); check.type = 'checkbox'; check.checked = task.done;
  check.setAttribute('aria-label', `${task.done ? 'Mark incomplete' : 'Complete'}: ${task.title} (${PRIORITIES[task.priority]})`);
  check.onchange = () => attempt(() => store.update(next => {
    const changed = next.tasks[task.id]; changed.done = check.checked; next.pending[task.id] = true;
    if (check.checked) {
      const occurrence = nextOccurrence(changed);
      if (occurrence && !next.tasks[occurrence.id]) { next.tasks[occurrence.id] = occurrence; next.pending[occurrence.id] = true; }
    }
  }));
  label.append(check); return label;
}
function row({ task, depth = 0, count = 0, context = false }) {
  const node = element('div', `task-row${task.done ? ' done' : ''}${task.id === selected ? ' selected' : ''}${context ? ' context' : ''}`);
  node.dataset.id = task.id; node.dataset.priority = task.priority; node.style.setProperty('--depth', depth);
  if (count) {
    const toggle = button(collapsed.has(task.id) ? '›' : '⌄', () => { collapsed.has(task.id) ? collapsed.delete(task.id) : collapsed.add(task.id); render(); }, `Toggle subtasks of ${task.title}`, 'branch');
    toggle.setAttribute('aria-expanded', String(!collapsed.has(task.id))); node.append(toggle);
  } else node.append(element('span', 'branch-space'));
  node.append(checkTask(task));
  const title = button('', () => openTask(task.id), `Edit ${task.title}`, 'task-name'); title.append(element('strong', '', task.title));
  const meta = element('span', 'task-meta');
  if (task.pinned) meta.append(element('span', '', 'Pinned'));
  if (task.priority) meta.append(element('span', 'priority-label', PRIORITIES[task.priority]));
  if (task.due) meta.append(element('span', `due${isOverdue(task) ? ' overdue' : ''}`, `${isOverdue(task) ? 'Overdue · ' : ''}${dueLabel(task.due)}`));
  if (task.repeat) meta.append(element('span', '', `↻ ${repeatLabel(task.repeat)}`));
  const list = state.collections[task.list_id];
  if (list) { const label = element('span', 'list-label', list.title); label.dataset.color = list.color; meta.append(label); }
  for (const id of task.tags) {
    const tag = state.collections[id]; if (!tag) continue;
    const label = element('span', 'tag', `#${tag.title}`); label.dataset.color = tag.color; meta.append(label);
  }
  if (depth) meta.append(element('span', '', `Subtask · level ${depth}`));
  if (count) meta.append(element('span', '', `${count} subtask${count === 1 ? '' : 's'}`));
  title.append(meta); node.append(title); return node;
}
function render() {
  renderNavigation();
  const name = VIEWS[view] || state.collections[view]?.title || 'All tasks';
  $('#view-title').textContent = name; document.title = `${name} · Todo`; $('#view-count').textContent = count(view);
  $('#edit-collection').hidden = !state.collections[view];
  $('#edit-collection').textContent = `Edit ${state.collections[view]?.kind || 'list'}`;
  $('#title').placeholder = `Add a task to ${state.collections[view]?.kind === 'list' ? name : 'Inbox'}`;
  const rows = taskRows(state.tasks, view, state.collections, collapsed, $('#sort').value, $('#search').value);
  const list = $('#tasks'); list.replaceChildren(); let previousGroup;
  for (const item of rows) {
    const group = item.task.pinned ? 'Pinned' : item.task.done ? 'Completed' : isOverdue(item.task) ? 'Overdue' : item.task.due ? 'Scheduled' : 'No date';
    if (!item.depth && group !== previousGroup) { list.append(element('div', `group-heading${group === 'Overdue' ? ' overdue' : ''}`, group)); previousGroup = group; }
    list.append(row(item));
  }
  if (!rows.length) {
    const empty = element('div', 'empty-list'); empty.append(element('span', 'empty-check', '✓'), element('h2', '', $('#search').value ? 'No matching tasks' : 'Nothing in this view yet'), element('p', '', $('#search').value ? 'Try another search or choose a different view.' : 'Add a task above, or choose another list.'));
    list.append(empty);
  }
  $('#conflicts').replaceChildren();
  for (const [records, collection] of [[state.conflicts, false], [state.collectionConflicts, true]]) for (const [id, remote] of Object.entries(records)) {
    const notice = element('div', 'conflict');
    notice.append(element('p', '', `Another device changed “${remote.title}”. Export a backup before choosing if you need both versions.`), button('Keep this device', () => store.resolve(id, collection, false)), button('Use server version', () => store.resolve(id, collection, true)));
    $('#conflicts').append(notice);
  }
  if (selected && !dirty) fillEditor(state.tasks[selected]);
  else if (selected) renderSubtasks();
}
function populateSelect(select, items, empty, value) {
  select.replaceChildren(new Option(empty, ''));
  for (const item of items) select.add(new Option(item.parent ? `${state.collections[item.parent]?.title} / ${item.title}` : item.title, item.id));
  select.value = value || '';
}
function fillEditor(task) {
  if (!task) return;
  draft = structuredClone(task); original = structuredClone(task);
  const form = $('#edit'); form.hidden = false; $('#detail-empty').hidden = true;
  for (const key of ['title', 'notes', 'priority']) form.elements[key].value = task[key];
  populateSelect($('#task-list'), collections('list'), 'Inbox', task.list_id);
  renderTags(); renderSubtasks(); updateDraftControls();
  $('#edit-status').textContent = 'No unsaved changes';
}
function renderTags() {
  $('#task-tags').replaceChildren();
  for (const tag of collections('tag')) {
    const label = element('label', 'tag-choice'); label.dataset.color = tag.color;
    const check = element('input'); check.type = 'checkbox'; check.value = tag.id; check.checked = draft.tags.includes(tag.id); check.name = 'tags';
    label.append(check, document.createTextNode(`#${tag.title}`)); $('#task-tags').append(label);
  }
}
function renderSubtasks() {
  $('#detail-subtasks').replaceChildren(...Object.values(state.tasks).filter(task => !task.deleted && task.parent === selected).map(task => row({ task })));
}
function updateDraftControls() {
  $('#schedule span').textContent = dueLabel(draft.due);
  $('#repeat span').textContent = repeatLabel(draft.repeat);
  $('#priority').dataset.priority = $('#priority').value;
  $('#pin').setAttribute('aria-pressed', String(draft.pinned)); $('#pin').textContent = draft.pinned ? 'Pinned' : 'Pin';
}
function markDirty() { dirty = true; $('#edit-status').textContent = 'Unsaved changes'; updateDraftControls(); }
function openTask(id) {
  if (!discardDraft()) return;
  dirty = false; selected = id; fillEditor(state.tasks[id]); document.body.classList.add('detail-open');
  if (innerWidth < 1150) { $('#main').inert = true; $('#navigation').inert = true; }
  render(); $('#edit-title').focus();
}
function closeDetails(confirmChanges = true) {
  if (confirmChanges && !discardDraft()) return;
  dirty = false; selected = null; draft = null; document.body.classList.remove('detail-open');
  $('#main').inert = false; $('#navigation').inert = false; $('#edit').hidden = true; $('#detail-empty').hidden = false;
  $('#title').focus();
}
async function addTask(title, parent = null) {
  const id = crypto.randomUUID();
  await store.update(next => {
    const inherited = parent ? next.tasks[parent] : null;
    next.tasks[id] = newTask(title, { id, parent, list_id: inherited?.list_id || (next.collections[view]?.kind === 'list' ? view : null),
      tags: inherited ? [...inherited.tags] : next.collections[view]?.kind === 'tag' ? [view] : [],
      due: parent ? '' : view === 'today' ? localDate() : view === 'tomorrow' ? dayOffset(1) : view === 'week' ? localDate() : '' });
    next.pending[id] = true;
  });
  return id;
}
function openCollection(kind, item) {
  collectionEditing = item?.id;
  const form = $('#collection-form'); form.reset(); form.elements.kind.value = item?.kind || kind; form.elements.kind.disabled = Boolean(item);
  form.elements.title.value = item?.title || '';
  populateSelect(form.elements.parent, collections('folder'), 'No folder', item?.parent);
  $('#collection-heading').textContent = item ? `Edit ${item.kind}` : `New ${kind}`;
  $('#folder-field').hidden = form.elements.kind.value !== 'list'; $('#color-options').replaceChildren();
  for (const color of COLORS) {
    const label = element('label', 'color-choice'); label.dataset.color = color;
    const input = element('input'); input.type = 'radio'; input.name = 'color'; input.value = color; input.checked = color === (item?.color || 'blue');
    label.append(input, document.createTextNode(color)); $('#color-options').append(label);
  }
  $('#collection-dialog').showModal(); form.elements.title.focus();
}

const showCalendar = createCalendar(due => {
  const dateChanged = draft.due.slice(0, 10) !== due.slice(0, 10);
  draft.due = due;
  if (!due) draft.repeat = null;
  else if (dateChanged && draft.repeat) draft.repeat.anchor = due.slice(0, 10);
  markDirty();
});
$('#schedule').onclick = () => showCalendar(draft.due);
$('#repeat').onclick = () => {
  if (!draft.due) { $('#edit-status').textContent = 'Choose a date before adding a repeat.'; showCalendar(''); return; }
  const form = $('#repeat-form'), repeat = draft.repeat || { unit: 'day', interval: 1, end: '', anchor: draft.due.slice(0, 10) };
  form.elements.unit.value = repeat.unit; form.elements.interval.value = repeat.interval; form.elements.end.value = repeat.end;
  $('#repeat-dialog').showModal();
};
$('#repeat-form').onsubmit = event => {
  event.preventDefault(); const form = event.target;
  draft.repeat = { unit: form.elements.unit.value, interval: Number(form.elements.interval.value), end: form.elements.end.value, anchor: draft.repeat?.anchor || draft.due.slice(0, 10) };
  markDirty(); $('#repeat-dialog').close();
};
$('#clear-repeat').onclick = () => { draft.repeat = null; markDirty(); $('#repeat-dialog').close(); };
$('#pin').onclick = () => { draft.pinned = !draft.pinned; markDirty(); };
$('#edit').oninput = markDirty;
$('#edit').onsubmit = event => {
  event.preventDefault(); const form = event.target; const id = selected;
  const fields = { title: form.elements.title.value.trim(), notes: form.elements.notes.value, priority: Number(form.elements.priority.value), list_id: form.elements.list_id.value || null,
    tags: [...form.querySelectorAll('[name="tags"]:checked')].map(input => input.value), due: draft.due, pinned: draft.pinned, repeat: draft.repeat };
  const baseline = structuredClone(original);
  attempt(async () => {
    if (!fields.title) throw new Error('Give the task a title before saving.');
    await store.update(next => {
      for (const key of Object.keys(fields)) if (JSON.stringify(next.tasks[id][key]) !== JSON.stringify(baseline[key])) throw new Error('This task changed while you were editing. Copy your draft, then reopen the task before saving.');
      Object.assign(next.tasks[id], fields); next.pending[id] = true;
    });
    dirty = false; fillEditor(state.tasks[id]); $('#edit-status').textContent = 'Saved on this device';
  });
};
$('#add').onsubmit = event => {
  event.preventDefault(); const title = $('#title').value.trim(); if (!title) return;
  const submit = event.submitter || $('#add button'); submit.disabled = true;
  attempt(async () => { await addTask(title); $('#title').value = ''; $('#title').focus(); }).finally(() => { submit.disabled = false; });
};
$('#add-subtask').onclick = () => { subtaskParent = selected; $('#subtask-form').reset(); $('#subtask-dialog').showModal(); };
$('#delete-task').onclick = () => {
  const descendants = [], queue = [selected];
  while (queue.length) { const id = queue.pop(); descendants.push(id); queue.push(...Object.values(state.tasks).filter(task => !task.deleted && task.parent === id).map(task => task.id)); }
  if (!confirm(descendants.length === 1 ? 'Delete this task?' : `Delete this task and its ${descendants.length - 1} subtasks?`)) return;
  attempt(async () => {
    await store.update(next => { for (const id of descendants) { next.tasks[id].deleted = true; next.pending[id] = true; } });
    closeDetails(false); render();
  });
};
$('#subtask-form').onsubmit = event => {
  event.preventDefault(); const title = event.target.elements.title.value.trim(); if (!title) return;
  attempt(async () => { await addTask(title, subtaskParent); collapsed.delete(subtaskParent); $('#subtask-dialog').close(); render(); });
};
document.querySelectorAll('[data-create]').forEach(node => node.onclick = () => openCollection(node.dataset.create));
$('#edit-collection').onclick = () => openCollection('', state.collections[view]);
$('#collection-form').elements.kind.onchange = event => { $('#folder-field').hidden = event.target.value !== 'list'; };
$('#collection-form').onsubmit = event => {
  event.preventDefault(); const form = event.target, kind = form.elements.kind.value, id = collectionEditing || crypto.randomUUID();
  const fields = { kind, title: form.elements.title.value.trim(), color: form.elements.color.value, parent: kind === 'list' ? form.elements.parent.value || null : null };
  attempt(async () => {
    if (!fields.title) throw new Error('Give the collection a name.');
    await store.update(next => { next.collections[id] = { id, revision: 0, deleted: false, ...next.collections[id], ...fields }; next.pendingCollections[id] = true; });
    $('#collection-dialog').close();
    if (draft) { const currentList = $('#task-list').value; populateSelect($('#task-list'), collections('list'), 'Inbox', currentList); draft.tags = [...$('#task-tags input:checked')].map(input => input.value); renderTags(); }
  });
};
$('#close-detail').onclick = () => { closeDetails(); render(); };
$('#open-nav').onclick = openNavigation; $('#bottom-lists').onclick = openNavigation; $('#close-nav').onclick = closeNavigation;
document.querySelectorAll('.bottom-nav [data-view]').forEach(node => node.onclick = () => chooseView(node.dataset.view));
$('#search').oninput = render; $('#sort').onchange = render;
$('#connect').onclick = () => $('#connection').showModal();
$('#unlock').onsubmit = event => { event.preventDefault(); const token = event.target.elements.token.value; event.target.reset(); $('#connection').close(); attempt(() => store.connect(token)); };
$('#lock').onclick = () => { store.lock(); $('#connection').close(); };
$('#sync').onclick = () => attempt(() => store.synchronize());
$('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `todo-${localDate()}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
addEventListener('online', () => attempt(() => store.synchronize()));
addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (document.body.classList.contains('nav-open')) closeNavigation(); else closeDetails();
});
addEventListener('resize', () => {
  $('#main').inert = (innerWidth < 720 && document.body.classList.contains('nav-open')) || (innerWidth < 1150 && document.body.classList.contains('detail-open'));
  $('#navigation').inert = innerWidth < 1150 && document.body.classList.contains('detail-open');
});
render(); status('Ready. Tasks save on this device first.');
if (sessionStorage.getItem('todo-sync-token') && navigator.onLine) attempt(() => store.synchronize());
