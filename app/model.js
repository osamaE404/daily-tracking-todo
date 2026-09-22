export const COLORS = ['blue', 'red', 'amber', 'green', 'purple', 'teal'];
export const PRIORITIES = ['No priority', 'Low', 'Medium', 'High'];
export const VIEWS = { all: 'All tasks', today: 'Today', tomorrow: 'Tomorrow', week: 'Next 7 days', inbox: 'Inbox', done: 'Completed' };

export function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function dayOffset(offset, today = new Date()) {
  const date = new Date(today); date.setDate(date.getDate() + offset);
  return localDate(date);
}
export function normalize(stored) {
  const state = stored || { cursor: 0, tasks: {}, pending: {}, conflicts: {} };
  state.collections ||= {}; state.pendingCollections ||= {}; state.collectionConflicts ||= {};
  for (const task of Object.values(state.tasks)) {
    task.list_id ??= null; task.tags ||= []; task.pinned ??= false; task.repeat ??= null; task.series_source ??= null;
  }
  return state;
}
export function newTask(title, fields = {}) {
  return { id: crypto.randomUUID(), title: title.trim(), notes: '', due: '', priority: 0, parent: null,
    done: false, deleted: false, revision: 0, list_id: null, tags: [], pinned: false, repeat: null, series_source: null, ...fields };
}
export function repeatLabel(repeat) {
  if (!repeat) return 'Does not repeat';
  const units = { day: 'day', week: 'week', month: 'month', year: 'year' };
  return repeat.interval === 1 ? `Every ${units[repeat.unit]}` : `Every ${repeat.interval} ${units[repeat.unit]}s`;
}
export function nextOccurrence(task) {
  if (!task.repeat || !task.due) return null;
  const repeat = task.repeat, date = task.due.slice(0, 10), anchorValue = repeat.anchor || date;
  const current = new Date(`${date}T12:00`), anchor = new Date(`${anchorValue}T12:00`);
  if (repeat.unit === 'day') current.setDate(current.getDate() + repeat.interval);
  else if (repeat.unit === 'week') current.setDate(current.getDate() + 7 * repeat.interval);
  else if (repeat.unit === 'month') {
    const target = current.getFullYear() * 12 + current.getMonth() + repeat.interval;
    const year = Math.floor(target / 12), month = ((target % 12) + 12) % 12;
    current.setFullYear(year, month, Math.min(anchor.getDate(), new Date(year, month + 1, 0).getDate()));
  } else {
    const year = current.getFullYear() + repeat.interval, month = anchor.getMonth();
    current.setFullYear(year, month, Math.min(anchor.getDate(), new Date(year, month + 1, 0).getDate()));
  }
  const nextDate = localDate(current);
  if (repeat.end && nextDate > repeat.end) return null;
  const base = task.id.split('@')[0];
  return { ...structuredClone(task), id: `${base}@${nextDate}`, due: nextDate + task.due.slice(10), done: false, deleted: false, revision: 0, parent: task.parent, series_source: task.id };
}
export function matches(task, view, collections, today = new Date()) {
  if (task.deleted) return false;
  if (view === 'done') return task.done;
  if (task.done) return false;
  const date = task.due.slice(0, 10);
  switch (view) {
    case 'all': return true;
    case 'inbox': return !task.list_id;
    case 'today': return Boolean(date && date <= localDate(today));
    case 'tomorrow': return date === dayOffset(1, today);
    case 'week': return Boolean(date && date <= dayOffset(6, today));
  }
  const collection = collections[view];
  if (collection?.kind === 'tag') return task.tags.includes(view);
  if (collection?.kind === 'folder') return collections[task.list_id]?.parent === view;
  return task.list_id === view;
}
export function dueLabel(due, today = new Date()) {
  if (!due) return 'No date';
  const date = due.slice(0, 10);
  let label = date === localDate(today) ? 'Today' : date === dayOffset(1, today) ? 'Tomorrow'
    : new Date(`${date}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: Number(date.slice(0, 4)) !== today.getFullYear() ? 'numeric' : undefined });
  if (due.includes('T')) label += `, ${due.slice(11, 16)}`;
  return label;
}
export function isOverdue(task) {
  return !task.done && Boolean(task.due) && (task.due.length === 10 ? task.due < localDate() : new Date(task.due) < new Date());
}
export function taskRows(tasks, view, collections, collapsed, sort = 'due', search = '') {
  const live = Object.values(tasks).filter(task => !task.deleted);
  const visible = new Set(live.filter(task => matches(task, view, collections) && `${task.title} ${task.notes}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(task => task.id));
  // Keep ancestors as context, including a completed parent of an unfinished child.
  for (const id of [...visible]) {
    let parent = tasks[id].parent;
    const visited = new Set([id]);
    while (parent && tasks[parent] && !tasks[parent].deleted && !visited.has(parent)) {
      visited.add(parent); visible.add(parent); parent = tasks[parent].parent;
    }
  }
  const children = new Map();
  for (const task of live) {
    const key = tasks[task.parent] && !tasks[task.parent].deleted ? task.parent : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(task);
  }
  const compare = (a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'priority' ? b.priority - a.priority : (a.due || '9999').localeCompare(b.due || '9999')) || a.title.localeCompare(b.title);
  const stack = (children.get(null) || []).sort(compare).reverse().map(task => ({ task, depth: 0 }));
  const rows = []; const visited = new Set();
  while (stack.length) {
    const { task, depth } = stack.pop();
    if (visited.has(task.id) || !visible.has(task.id)) continue;
    visited.add(task.id);
    const branch = (children.get(task.id) || []).filter(child => visible.has(child.id)).sort(compare);
    rows.push({ task, depth, count: branch.length, context: !matches(task, view, collections) });
    if (!collapsed.has(task.id) || search) for (const child of branch.toReversed()) stack.push({ task: child, depth: depth + 1 });
  }
  return rows;
}
