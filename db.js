import { catSvgStandalone } from './icons.js';
// Data layer. Same interface for the real Supabase backend and the in-memory demo.

const CFG = window.WARDROBE_CONFIG || {};
export const isConfigured = () => !!(CFG.supabaseUrl && CFG.supabaseKey);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

// ------------------------------------------------------------------ Supabase
export function supabaseBackend() {
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nina-wardrobe-auth' },
  });
  const bucket = CFG.bucket || 'photos';
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  async function all(table, order) {
    let out = [];
    for (let from = 0; ; from += 1000) {
      const rows = ok(await sb.from(table).select('*').order(order).range(from, from + 999));
      out = out.concat(rows);
      if (rows.length < 1000) return out;
    }
  }
  const store = () => sb.storage.from(bucket);
  const removeFiles = async (paths) => { if (paths.length) await store().remove(paths); };

  return {
    demo: false,
    async session() { return ok(await sb.auth.getSession()).session; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async loadAll() {
      const [cats, subs, items, links, photos] = await Promise.all([
        all('categories', 'sort'), all('subcategories', 'sort'), all('items', 'created_at'),
        all('item_subcategories', 'item_id'), all('photos', 'created_at'),
      ]);
      return { cats, subs, items, links, photos };
    },
    photoUrl(path) { return store().getPublicUrl(path).data.publicUrl; },

    async addCategory(name, sort) { ok(await sb.from('categories').insert({ name, sort })); },
    async renameCategory(id, name) { ok(await sb.from('categories').update({ name }).eq('id', id)); },
    async deleteCategory(id) { ok(await sb.from('categories').delete().eq('id', id)); },
    async addSub(category_id, name, sort) { ok(await sb.from('subcategories').insert({ category_id, name, sort })); },
    async renameSub(id, name) { ok(await sb.from('subcategories').update({ name }).eq('id', id)); },
    async deleteSub(id) { ok(await sb.from('subcategories').delete().eq('id', id)); },

    async createItem(f) {
      const it = ok(await sb.from('items').insert({
        category_id: f.category_id, colour: f.colour, name: f.name || null, notes: f.notes || null,
      }).select().single());
      await this.setSubs(it.id, f.subIds);
      return it;
    },
    async updateItem(id, f) {
      ok(await sb.from('items').update({
        category_id: f.category_id, colour: f.colour, name: f.name || null, notes: f.notes || null,
      }).eq('id', id));
      await this.setSubs(id, f.subIds);
    },
    async setSubs(item_id, subIds) {
      ok(await sb.from('item_subcategories').delete().eq('item_id', item_id));
      if (subIds.length) ok(await sb.from('item_subcategories').insert(subIds.map((subcategory_id) => ({ item_id, subcategory_id }))));
    },
    async deleteItem(item, photos) {
      ok(await sb.from('items').delete().eq('id', item.id));
      await removeFiles(photos.flatMap((p) => [p.path, p.thumb_path].filter(Boolean)));
    },
    async addPhoto(item_id, img) {
      const id = uuid(), base = `${item_id}/${id}`;
      const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
      ok(await store().upload(`${base}.jpg`, img.full, opts));
      ok(await store().upload(`${base}_t.jpg`, img.thumb, opts));
      return ok(await sb.from('photos').insert({
        id, item_id, path: `${base}.jpg`, thumb_path: `${base}_t.jpg`,
        taken_on: img.takenOn, width: img.width, height: img.height,
      }).select().single());
    },
    async deletePhoto(p) {
      ok(await sb.from('photos').delete().eq('id', p.id));
      await removeFiles([p.path, p.thumb_path].filter(Boolean));
    },
    async setCover(item_id, photo_id) { ok(await sb.from('items').update({ cover_photo_id: photo_id }).eq('id', item_id)); },
    async setPhotoDate(id, taken_on) { ok(await sb.from('photos').update({ taken_on }).eq('id', id)); },
  };
}

// ------------------------------------------------------------------ Demo (in memory)
const SEED = [
  ['Dresses', ['occasion', 'going out', 'edgy', 'long', 'work', 'short', 'jumpsuits', 'non black']],
  ['Tops', ['work', 'going out', 'edgy', 'bodysuits', 'sleeveless', 'sleeves']],
  ['Skirts', ['mini', 'midi', 'long', 'work', 'going out', 'edgy', 'skort']],
  ['Trousers', ['work', 'going out', 'jeans']],
  ['Coats', []],
  ['Outerwear', ['jackets', 'coverups', 'hoodies']],
  ['Shoes', ['boots', 'heels', 'sandals', 'flats']],
  ['Accessories', ['bags', 'belts', 'scarves', 'sunglasses', 'jewellery', 'tights/socks']],
];

function sampleImage(bg, catName) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(catSvgStandalone(catName, bg));
}

export function demoBackend() {
  const d = { cats: [], subs: [], items: [], links: [], photos: [] };
  const urls = new Map();
  const now = () => new Date().toISOString();
  SEED.forEach(([name, subs], i) => {
    const cid = uuid();
    d.cats.push({ id: cid, name, sort: i + 1 });
    subs.forEach((s, j) => d.subs.push({ id: uuid(), category_id: cid, name: s, sort: j + 1 }));
  });
  const sub = (cat, name) => d.subs.find((s) => s.category_id === cat.id && s.name === name).id;
  const samples = [
    ['Dresses', 'black', 'Velvet maxi dress', ['long', 'occasion'], ['#141014', '#1d161b']],
    ['Dresses', 'non-black', 'Oxblood lace dress', ['short', 'going out', 'edgy'], ['#5a0f1c', '#6e1424', '#480b16']],
    ['Dresses', 'black', 'Corset midi dress', ['work'], ['#231a1f']],
    ['Tops', 'black', 'Lace bodysuit', ['bodysuits', 'going out'], ['#18121a']],
    ['Skirts', 'black', 'Pleated leather mini', ['mini', 'edgy'], ['#1a1a1a']],
    ['Shoes', 'black', 'Heeled ankle boots', ['boots', 'heels'], ['#202020']],
    ['Accessories', 'non-black', 'Oxblood handbag', ['bags'], ['#4a1020']],
  ];
  samples.forEach(([catName, colour, name, subs, pics], k) => {
    const cat = d.cats.find((c) => c.name === catName);
    const it = { id: uuid(), category_id: cat.id, colour, name, notes: null, cover_photo_id: null, created_at: new Date(Date.now() - (samples.length - k) * 86400e3).toISOString() };
    d.items.push(it);
    subs.forEach((s) => d.links.push({ item_id: it.id, subcategory_id: sub(cat, s) }));
    pics.forEach((bg, j) => {
      const p = { id: uuid(), item_id: it.id, path: uuid(), thumb_path: null, taken_on: new Date(Date.now() - (pics.length - j) * 20 * 86400e3).toISOString().slice(0, 10), created_at: now() };
      urls.set(p.path, sampleImage(bg, catName));
      d.photos.push(p);
      if (!it.cover_photo_id) it.cover_photo_id = p.id;
    });
  });

  const clone = () => JSON.parse(JSON.stringify(d));
  const pause = () => new Promise((r) => setTimeout(r, 150));
  return {
    demo: true,
    async session() { return { demo: true }; },
    async signIn() {}, async signOut() {},
    async loadAll() { return clone(); },
    photoUrl(path) { return urls.get(path) || ''; },
    async addCategory(name, sort) { d.cats.push({ id: uuid(), name, sort }); },
    async renameCategory(id, name) { d.cats.find((c) => c.id === id).name = name; },
    async deleteCategory(id) {
      if (d.items.some((i) => i.category_id === id)) throw new Error('Category still has items');
      const subIds = d.subs.filter((s) => s.category_id === id).map((s) => s.id);
      d.links = d.links.filter((l) => !subIds.includes(l.subcategory_id));
      d.subs = d.subs.filter((s) => s.category_id !== id);
      d.cats = d.cats.filter((c) => c.id !== id);
    },
    async addSub(category_id, name, sort) { d.subs.push({ id: uuid(), category_id, name, sort }); },
    async renameSub(id, name) { d.subs.find((s) => s.id === id).name = name; },
    async deleteSub(id) { d.subs = d.subs.filter((s) => s.id !== id); d.links = d.links.filter((l) => l.subcategory_id !== id); },
    async createItem(f) {
      const it = { id: uuid(), category_id: f.category_id, colour: f.colour, name: f.name || null, notes: f.notes || null, cover_photo_id: null, created_at: now() };
      d.items.push(it); await this.setSubs(it.id, f.subIds); return { ...it };
    },
    async updateItem(id, f) {
      Object.assign(d.items.find((i) => i.id === id), { category_id: f.category_id, colour: f.colour, name: f.name || null, notes: f.notes || null });
      await this.setSubs(id, f.subIds);
    },
    async setSubs(item_id, subIds) {
      d.links = d.links.filter((l) => l.item_id !== item_id).concat(subIds.map((subcategory_id) => ({ item_id, subcategory_id })));
    },
    async deleteItem(item) {
      d.items = d.items.filter((i) => i.id !== item.id);
      d.photos = d.photos.filter((p) => p.item_id !== item.id);
      d.links = d.links.filter((l) => l.item_id !== item.id);
    },
    async addPhoto(item_id, img) {
      await pause();
      const p = { id: uuid(), item_id, path: uuid(), thumb_path: uuid(), taken_on: img.takenOn, width: img.width, height: img.height, created_at: now() };
      urls.set(p.path, URL.createObjectURL(img.full));
      urls.set(p.thumb_path, URL.createObjectURL(img.thumb));
      d.photos.push(p);
      const it = d.items.find((i) => i.id === item_id);
      if (!it.cover_photo_id) it.cover_photo_id = p.id;
      return { ...p };
    },
    async deletePhoto(p) {
      d.photos = d.photos.filter((x) => x.id !== p.id);
      const it = d.items.find((i) => i.id === p.item_id);
      if (it && it.cover_photo_id === p.id) {
        const rest = d.photos.filter((x) => x.item_id === it.id).sort((a, b) => b.taken_on.localeCompare(a.taken_on));
        it.cover_photo_id = rest[0]?.id || null;
      }
    },
    async setCover(item_id, photo_id) { d.items.find((i) => i.id === item_id).cover_photo_id = photo_id; },
    async setPhotoDate(id, taken_on) { d.photos.find((p) => p.id === id).taken_on = taken_on; },
  };
}
