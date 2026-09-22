import { normalize } from './model.js?v=6';

export async function openStore(onChange, status) {
  const request = indexedDB.open('gharawi-todo', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('state');
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const channel = new BroadcastChannel('gharawi-todo-updates');
  let token = sessionStorage.getItem('todo-sync-token') || '';
  let queue = Promise.resolve();
  let state = await read();
  function read() {
    return new Promise((resolve, reject) => {
      const get = db.transaction('state').objectStore('state').get('main');
      get.onsuccess = () => resolve(normalize(get.result)); get.onerror = () => reject(get.error);
    });
  }
  async function save(next) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(next, 'main');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local save aborted'));
    });
    state = next; onChange(state); channel.postMessage('saved');
  }
  function run(action) {
    const operation = queue.then(() => navigator.locks.request('gharawi-todo-write', async () => { state = await read(); return action(); }));
    queue = operation.catch(error => status(error.message));
    return operation;
  }
  channel.onmessage = () => run(async () => onChange(state)).catch(() => {});
  async function synchronize() {
    if (!token) { status('Saved on this device. Connect sync to share with your other devices.'); return; }
    await run(async () => {
      // One lock across the request prevents another tab from overwriting the snapshot.
      let more;
      do {
        const collectionIds = Object.keys(state.pendingCollections).filter(id => !state.collectionConflicts[id]).slice(0, 500);
        const ids = Object.keys(state.pending).filter(id => !state.conflicts[id]).slice(0, 500 - collectionIds.length);
        status('Synchronizing…');
        const response = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ schema: 2, cursor: state.cursor, changes: ids.map(id => state.tasks[id]), collections: collectionIds.map(id => state.collections[id]) }),
          signal: AbortSignal.timeout(15000), cache: 'no-store' }).catch(() => { throw new Error('Offline or unreachable. Your edits remain saved on this device.'); });
        if (!response.ok) throw new Error(response.status === 401 ? 'Sync token rejected. Open Sync settings to reconnect.' : `Sync failed (${response.status}). Your edits are safe locally. Close older Todo windows and retry.`);
        const result = await response.json(); const next = structuredClone(state);
        for (const [records, conflicts, pending, values, accepted] of [
          [result.records, result.conflicts, 'pending', 'tasks', ids],
          [result.collections, result.collection_conflicts, 'pendingCollections', 'collections', collectionIds],
        ]) {
          const conflictKey = values === 'tasks' ? 'conflicts' : 'collectionConflicts';
          for (const record of conflicts) next[conflictKey][record.id] = record;
          for (const id of accepted) if (!next[conflictKey][id]) delete next[pending][id];
          for (const record of records) if (!next[pending][record.id]) next[values][record.id] = record;
        }
        next.cursor = result.cursor; await save(normalize(next));
        more = ids.length + collectionIds.length === 500 && [...Object.keys(state.pending).filter(id => !state.conflicts[id]), ...Object.keys(state.pendingCollections).filter(id => !state.collectionConflicts[id])].length > 0;
      } while (more);
      const count = Object.keys(state.pending).length + Object.keys(state.pendingCollections).length;
      status(count ? `${count} change(s) need attention. Review sync conflicts below.` : 'Saved on this device and synchronized.');
    });
  }
  async function update(mutate) {
    await run(async () => {
      const next = structuredClone(state); mutate(next); await save(next); status('Saved on this device.');
    });
    if (token && navigator.onLine) synchronize().catch(() => {});
  }
  return {
    get state() { return state; }, update, synchronize,
    connect(value) { token = value; sessionStorage.setItem('todo-sync-token', token); return synchronize(); },
    lock() { token = ''; sessionStorage.removeItem('todo-sync-token'); status('Sync locked. Local tasks stay on this device.'); },
    async resolve(id, collection, useServer) {
      await update(next => {
        const values = collection ? 'collections' : 'tasks', conflicts = collection ? 'collectionConflicts' : 'conflicts', pending = collection ? 'pendingCollections' : 'pending';
        next[values][id] = useServer ? next[conflicts][id] : { ...next[values][id], revision: next[conflicts][id].revision };
        delete next[conflicts][id]; if (useServer) delete next[pending][id]; else next[pending][id] = true;
      });
    },
  };
}
