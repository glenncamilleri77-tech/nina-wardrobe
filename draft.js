// Keeps an unfinished add/edit form safe across reloads, updates and the app being closed.
// Fields go to localStorage; chosen photos go to IndexedDB (as bytes, which every browser can store).
const DB_NAME = 'nina-wardrobe-drafts';
let suffix = '';
export const setDraftScope = (demo) => { suffix = demo ? '-demo' : ''; };
const lsKey = () => 'nina-wardrobe-draft' + suffix;
const fileKey = () => 'files' + suffix;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function withStore(mode, fn) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => { d.close(); resolve(req && req.result); };
    t.onerror = t.onabort = () => { d.close(); reject(t.error); };
  });
}

export function saveDraftFields(form, names = {}) {
  if (!form) return;
  try {
    localStorage.setItem(lsKey(), JSON.stringify({
      key: form.key, mode: form.mode, itemId: form.itemId || null, category_id: form.category_id, subIds: form.subIds,
      colour: form.colour, name: form.name, notes: form.notes, cover: form.cover, photoCount: form.files.length, savedAt: Date.now(),
      category_name: names.category || null, sub_names: names.subs || [],
    }));
  } catch { /* storage full or private mode: nothing else we can do */ }
}

let fileJob = Promise.resolve();
export function saveDraftFiles(form) {
  if (!form) return fileJob;
  const files = form.files.map((x) => x.file);
  fileJob = fileJob.then(async () => {
    try {
      const packed = await Promise.all(files.map(async (f) => ({ buf: await f.arrayBuffer(), name: f.name, type: f.type, lastModified: f.lastModified })));
      await withStore('readwrite', (s) => s.put(packed, fileKey()));
    } catch (e) { console.warn('Could not keep draft photos', e); }
  });
  return fileJob;
}

export async function loadDraft() {
  let fields = null;
  try { fields = JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch {}
  if (!fields) return null;
  let files = [];
  try {
    const packed = (await withStore('readonly', (s) => s.get(fileKey()))) || [];
    files = packed.map((p) => new File([p.buf], p.name || 'photo.jpg', { type: p.type || 'image/jpeg', lastModified: p.lastModified || Date.now() }));
  } catch (e) { console.warn('Could not read draft photos', e); }
  return { ...fields, files };
}

export async function clearDraft() {
  try { localStorage.removeItem(lsKey()); } catch {}
  await fileJob.catch(() => {});
  try { await withStore('readwrite', (s) => s.delete(fileKey())); } catch {}
}
