import { isConfigured, supabaseBackend, demoBackend } from './db.js';
import { catSvg } from './icons.js';
import { setDraftScope, saveDraftFields, saveDraftFiles, loadDraft, clearDraft } from './draft.js';
import { preparePhoto, localISODate } from './images.js';

// ------------------------------------------------------------------ state
let db = null;
let S = { cats: [], subs: [], items: [], links: [], photos: [] };
let colourFilter = localStorage.getItem('colourFilter') || 'all';
let form = null;            // add/edit form state
let galleryStart = null;    // photo id to show first after re-render
const view = document.getElementById('view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const byId = (arr, id) => arr.find((x) => x.id === id);
const catOf = (id) => byId(S.cats, id);
const subsOf = (catId) => S.subs.filter((s) => s.category_id === catId).sort((a, b) => a.sort - b.sort);
const itemSubIds = (itemId) => S.links.filter((l) => l.item_id === itemId).map((l) => l.subcategory_id);
const photosOf = (itemId) => S.photos.filter((p) => p.item_id === itemId);
const passColour = (it) => colourFilter === 'all' || it.colour === colourFilter;
const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const itemTitle = (it) => it.name || `${catOf(it.category_id)?.name || 'Item'}`;
function coverOf(it) {
  const ps = photosOf(it.id);
  return byId(ps, it.cover_photo_id) || ps[0] || null;
}
const thumbUrl = (p) => (p ? db.photoUrl(p.thumb_path || p.path) : '');
const fullUrl = (p) => db.photoUrl(p.path);

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
const BAT = '<svg class="bat" viewBox="0 0 64 28" aria-hidden="true"><path fill="currentColor" d="M32 6c1.4-2.6 2.4-3.6 3-6 .6 2.6.4 4.6 0 6 5.6-4.4 16.8-5.4 29 1-6 1.2-8.6 4.6-9.4 9-3-3-7.2-3.4-10.2-.8-1.6-2.8-5-3.6-7.6-1.8-1.4 2.6-3.4 6.4-4.8 14.6-1.4-8.2-3.4-12-4.8-14.6-2.6-1.8-6-1-7.6 1.8-3-2.6-7.2-2.2-10.2.8C8.6 11.6 6 8.2 0 7c12.2-6.4 23.4-5.4 29-1-.4-1.4-.6-3.4 0-6 .6 2.4 1.6 3.4 3 6z"/></svg>';
const MOON = '<svg class="moon" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M40 4a28 28 0 1 0 20 46A24 24 0 0 1 40 4z"/></svg>';
const divider = (glyph = '✠') => `<div class="divider" aria-hidden="true"><span>${glyph}</span></div>`;
const swatch = (c) => `<span class="swatch ${c}" aria-hidden="true"></span>`;
const COLOUR_LABEL = { black: `${swatch('black')}Black`, 'non-black': `${swatch('non-black')}Non-black` };
const catIcon = (c) => catSvg(c.name);

async function reload() { S = await db.loadAll(); }
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

// ------------------------------------------------------------------ small UI helpers
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}
let busyEl = null;
function busy(msg) {
  if (!msg) { busyEl?.remove(); busyEl = null; return; }
  if (!busyEl) { busyEl = document.createElement('div'); busyEl.className = 'busy'; document.body.appendChild(busyEl); }
  busyEl.innerHTML = `<div class="busy-box"><div class="spinner"></div><p>${esc(msg)}</p></div>`;
}
function modal({ title, body = '', buttons }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal-back';
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      ${title ? `<h2>${esc(title)}</h2>` : ''}${body}
      <div class="modal-buttons">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(m);
    const input = m.querySelector('input');
    if (input) { setTimeout(() => input.focus(), 50); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.querySelector('.btn.primary')?.click(); }); }
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (e.target === m) { m.remove(); resolve(null); return; }
      if (!b) return;
      const btn = buttons[+b.dataset.i];
      const val = btn.value === 'input' ? input.value : btn.value;
      m.remove(); resolve(val);
    });
  });
}
const confirmBox = (title, text, yes = 'Delete') =>
  modal({ title, body: `<p>${esc(text)}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: yes, value: true, kind: 'danger' }] });
async function ask(title, value = '', type = 'text') {
  const v = await modal({ title, body: `<input class="field" type="${type}" value="${esc(value)}">`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'input', kind: 'primary' }] });
  return v === null || v === undefined ? null : String(v).trim();
}
// Technical reason shown in small print under friendly messages, so problems can be diagnosed from a screenshot.
function techOf(err) {
  if (!err) return '';
  if (err.tech) return err.tech;
  const bits = [err.name && err.name !== 'Error' ? err.name : '', err.message || String(err)];
  const code = err.statusCode || err.status || err.code;
  if (code) bits.push(`(${code})`);
  return bits.filter(Boolean).join(': ').slice(0, 400);
}
function errorBody(err) {
  const f = friendly(err), t = techOf(err);
  return `<p>${esc(f)}</p>${t && t !== f ? `<p class="tech">Details: ${esc(t)}</p>` : ''}`;
}
function friendly(err) {
  console.error(err);
  if (err?.friendly) return err.friendly;
  const m = String(err?.message || err);
  if (/fetch|network|Failed to fetch|Load failed/i.test(m)) return 'No internet connection. Please try again when you are online.';
  if (/Invalid login|invalid_credentials|invalid.*(email|password)/i.test(m)) return "Email or password doesn't match. Check capital letters in the password, and that the email is spelt right.";
  if (/Email not confirmed/i.test(m)) return 'This email has not been confirmed yet. Ask Glenn to check the setup.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries in a row. Please wait a minute, then try again.';
  if (/signup|not allowed/i.test(m)) return 'New sign-ups are switched off. Use your existing email and password.';
  if (/duplicate|unique/i.test(m)) return 'That name is already used here.';
  if (/foreign key|violates/i.test(m)) return 'This is still in use, so it can\'t be removed yet.';
  return 'Something went wrong: ' + m;
}
async function attempt(fn, msg) {
  try { if (msg) busy(msg); await fn(); } catch (e) { busy(); await modal({ title: 'Something went wrong', body: errorBody(e), buttons: [{ label: 'OK', value: true, kind: 'primary' }] }); return false; }
  busy(); return true;
}

function colourBar() {
  const opt = (v, label) => `<button class="seg ${colourFilter === v ? 'on' : ''}" data-act="colour" data-v="${v}">${label}</button>`;
  return `<div class="segbar" role="group" aria-label="Colour">${opt('all', 'All')}${opt('black', COLOUR_LABEL.black)}${opt('non-black', COLOUR_LABEL['non-black'])}</div>`;
}
const top = (title, { back, right = '', title: big = false } = {}) => `<header class="top${big ? ' home' : ''}">
  ${back ? `<button class="icon-btn" data-go="${back}" aria-label="Back">‹</button>` : '<span class="icon-spacer"></span>'}
  <h1${big ? ' class="title"' : ''}>${esc(title)}</h1>${right || '<span class="icon-spacer"></span>'}</header>`;
const fab = (hash) => `<button class="fab" data-go="${hash}" aria-label="Add a new item">+</button>`;

function itemGrid(items) {
  if (!items.length) return '';
  return `<div class="item-grid">${items.map((it) => {
    const p = coverOf(it);
    return `<button class="item-card" data-go="#/item/${it.id}">
      ${p ? `<img loading="lazy" src="${esc(thumbUrl(p))}" alt="">` : '<div class="noimg">📷</div>'}
      ${it.name ? `<span class="item-name">${esc(it.name)}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ screens
function screenSetup() {
  view.innerHTML = `<div class="centre">
    <div class="logo">${MOON}${BAT}</div><h1 class="title">Nina's Wardrobe</h1>${divider()}
    <p>This app isn't connected to its online storage yet.</p>
    <button class="btn primary big" data-act="demo">Try the demo</button>
    <p class="hint">In the demo nothing is saved.</p></div>`;
}

function screenLogin() {
  view.innerHTML = `<form class="centre" id="login" novalidate>
    <div class="logo">${MOON}${BAT}</div><h1 class="title">Nina's Wardrobe</h1>${divider()}
    <p>Welcome, Nina. Sign in once on this phone or tablet and it will remember you.</p>
    <label class="lbl">Email<input class="field" name="email" type="email" inputmode="email" autocomplete="username"
      autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
    <label class="lbl">Password<span class="pw-wrap"><input class="field" name="password" id="pw" type="password" autocomplete="current-password"
      autocapitalize="off" autocorrect="off" spellcheck="false" required>
      <button type="button" class="eye" id="eye" aria-label="Show password" aria-pressed="false">${EYE}</button></span></label>
    <p class="login-error" id="login-error" role="alert" hidden></p>
    <button class="btn primary big" type="submit">Sign in</button></form>`;
  const pw = view.querySelector('#pw'), eye = view.querySelector('#eye'), errEl = view.querySelector('#login-error');
  eye.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    eye.classList.toggle('on', show);
  });
  view.querySelector('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email') || '').trim().toLowerCase();
    const password = String(f.get('password') || '');
    errEl.hidden = true;
    if (!email || !password) { errEl.textContent = 'Please type your email and password.'; errEl.hidden = false; return; }
    let ok = true;
    busy('Signing in…');
    try { await db.signIn(email, password); } catch (err) { ok = false; errEl.textContent = friendly(err); errEl.hidden = false; }
    busy();
    if (ok) { signedIn = true; await attempt(reload, 'Opening your wardrobe…'); if (!(await offerDraft())) go('#/'); }
  });
}

function screenHome() {
  const tiles = S.cats.slice().sort((a, b) => a.sort - b.sort).map((c) => {
    const items = S.items.filter((i) => i.category_id === c.id && passColour(i));
    const newest = items.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const p = newest && coverOf(newest);
    return `<button class="cat-tile" data-go="#/cat/${c.id}">
      ${p ? `<img loading="lazy" src="${esc(thumbUrl(p))}" alt="">` : `<span class="cat-icon">${catIcon(c)}</span>`}
      <span class="cat-label"><b>${esc(c.name)}</b><small>${items.length} ${items.length === 1 ? 'item' : 'items'}</small></span></button>`;
  }).join('');
  view.innerHTML = `${top("Nina's Wardrobe", { title: true, right: '<button class="icon-btn" data-go="#/manage" aria-label="Settings">⚙︎</button>' })}
    ${db.demo ? '<div class="demo-flag">Demo: nothing is saved</div>' : ''}
    <main class="pad">${colourBar()}${divider('🦇')}<div class="cat-grid">${tiles}</div>
    ${S.cats.length ? '' : '<p class="empty">No categories yet. Tap ⚙︎ to add some.</p>'}</main>${fab('#/add')}`;
}

function screenCategory(catId, subId) {
  const c = catOf(catId);
  if (!c) return go('#/');
  const subs = subsOf(c.id);
  let items = S.items.filter((i) => i.category_id === c.id && passColour(i));
  if (subId) { const ids = new Set(S.links.filter((l) => l.subcategory_id === subId).map((l) => l.item_id)); items = items.filter((i) => ids.has(i.id)); }
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const chip = (id, label) => `<button class="chip ${(subId || '') === id ? 'on' : ''}" data-go="#/cat/${c.id}${id ? '/' + id : ''}">${esc(label)}</button>`;
  view.innerHTML = `${top(c.name, { back: '#/' })}
    <main class="pad">
      ${subs.length ? `<div class="chips scroll">${chip('', 'All')}${subs.map((s) => chip(s.id, cap(s.name))).join('')}</div>` : ''}
      ${colourBar()}
      ${itemGrid(items) || `<div class="empty"><p>Nothing here yet.</p><button class="btn primary" data-go="#/add/${c.id}${subId ? '/' + subId : ''}">+ Add ${esc(c.name.toLowerCase())}</button></div>`}
    </main>${fab(`#/add/${c.id}${subId ? '/' + subId : ''}`)}`;
}

function screenItem(itemId) {
  const it = byId(S.items, itemId);
  if (!it) return go('#/');
  const c = catOf(it.category_id);
  const cover = coverOf(it);
  const ps = photosOf(it.id).sort((a, b) => (a.id === cover?.id ? -1 : b.id === cover?.id ? 1 : b.taken_on.localeCompare(a.taken_on) || b.created_at.localeCompare(a.created_at)));
  const subs = itemSubIds(it.id).map((id) => byId(S.subs, id)).filter(Boolean).sort((a, b) => a.sort - b.sort);
  view.innerHTML = `${top(itemTitle(it), { back: `#/cat/${it.category_id}`, right: `<button class="icon-btn" data-go="#/edit/${it.id}" aria-label="Edit">✎</button>` })}
    <div class="gallery" id="gallery">${ps.map((p) => `<figure class="slide" data-id="${p.id}"><img src="${esc(fullUrl(p))}" alt="" ${p === ps[0] ? '' : 'loading="lazy"'}></figure>`).join('')
      || '<figure class="slide"><div class="noimg big">📷</div></figure>'}</div>
    ${ps.length > 1 ? `<div class="dots">${ps.map((p, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>` : ''}
    <main class="pad">
      ${ps.length ? `<div class="photo-bar">
        <span id="photo-date" class="photo-date"></span>
        <span id="cover-badge" class="badge">✦ Cover</span>
      </div>
      <div class="row">
        <button class="btn" id="make-cover" data-act="make-cover">✦ Set as cover</button>
        <button class="btn" data-act="photo-date">☾ Change date</button>
        <button class="btn danger-text" data-act="delete-photo">Delete photo</button>
      </div>` : ''}
      <label class="btn primary big file-btn">✚ Add photos<input type="file" accept="image/*,image/heic,image/heif,.heic,.heif" multiple data-act="add-photos" hidden></label>
      <section class="info">
        <p class="meta">${esc(c?.name || '')} · ${COLOUR_LABEL[it.colour]} · ${ps.length} ${ps.length === 1 ? 'photo' : 'photos'}</p>
        ${subs.length ? `<div class="chips">${subs.map((s) => `<button class="chip on" data-go="#/cat/${c.id}/${s.id}">${esc(cap(s.name))}</button>`).join('')}</div>` : ''}
        ${it.notes ? `<p class="notes">${esc(it.notes)}</p>` : ''}
        <p class="hint">Added ${fmtDate(it.created_at.slice(0, 10))}</p>
      </section>
      <div class="row end"><button class="btn" data-go="#/edit/${it.id}">✎ Edit details</button>
      <button class="btn danger" data-act="delete-item">Delete item</button></div>
    </main>`;
  setupGallery(it, ps);
}

function setupGallery(it, ps) {
  const g = document.getElementById('gallery');
  if (!g || !ps.length) return;
  const dots = [...document.querySelectorAll('.dots span')];
  const update = () => {
    const i = Math.round(g.scrollLeft / g.clientWidth);
    const p = ps[Math.max(0, Math.min(ps.length - 1, i))];
    g.dataset.current = p.id;
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    document.getElementById('photo-date').textContent = `☾ ${fmtDate(p.taken_on)}${ps.length > 1 ? `  ·  ${i + 1} of ${ps.length}` : ''}`;
    const isCover = p.id === (coverOf(it)?.id);
    document.getElementById('cover-badge').style.visibility = isCover ? 'visible' : 'hidden';
    document.getElementById('make-cover').disabled = isCover;
  };
  g.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  if (galleryStart) { const k = ps.findIndex((p) => p.id === galleryStart); galleryStart = null; if (k > 0) requestAnimationFrame(() => { g.scrollLeft = k * g.clientWidth; update(); }); }
  update();
}

function screenForm(mode, a, b) {
  if (!form || form.key !== location.hash) {
    if (mode === 'edit') {
      const it = byId(S.items, a);
      if (!it) return go('#/');
      form = { key: location.hash, mode, itemId: it.id, files: [], cover: 0, category_id: it.category_id, subIds: itemSubIds(it.id), colour: it.colour, name: it.name || '', notes: it.notes || '' };
    } else {
      form = { key: location.hash, mode, files: [], cover: 0, category_id: catOf(a) ? a : null, subIds: b ? [b] : [], colour: null, name: '', notes: '' };
    }
    form.orig = snapshot(form);
  }
  const cats = S.cats.slice().sort((x, y) => x.sort - y.sort);
  const back = mode === 'edit' ? `#/item/${form.itemId}` : (form.category_id ? `#/cat/${form.category_id}` : '#/');
  view.innerHTML = `${top(mode === 'edit' ? 'Edit details' : 'Add an item', { back })}
    <main class="pad form">
      ${mode === 'add' ? `<section><h2><span class="step"><span class="step-n">1</span></span> Photos</h2>
        <div id="previews" class="previews"></div>
        <label class="btn big file-btn">✚ Take or choose photos<input type="file" accept="image/*,image/heic,image/heif,.heic,.heif" multiple data-act="form-photos" hidden></label>
        <p class="hint" id="cover-hint"></p></section>` : ''}
      <section><h2><span class="step"><span class="step-n">${mode === 'add' ? 2 : 1}</span></span> Category</h2>
        <div class="choice-grid">${cats.map((c) => `<button class="choice ${form.category_id === c.id ? 'on' : ''}" data-act="pick-cat" data-id="${c.id}">${catIcon(c)} ${esc(c.name)}</button>`).join('')}</div></section>
      <section id="subs-section"></section>
      <section><h2><span class="step"><span class="step-n">${mode === 'add' ? 4 : 3}</span></span> Colour</h2>
        <div class="choice-grid two">
          <button class="choice ${form.colour === 'black' ? 'on' : ''}" data-act="pick-colour" data-v="black">${COLOUR_LABEL.black}</button>
          <button class="choice ${form.colour === 'non-black' ? 'on' : ''}" data-act="pick-colour" data-v="non-black">${COLOUR_LABEL['non-black']}</button></div></section>
      <section><h2>Name <small>(optional)</small></h2>
        <input class="field" id="f-name" placeholder="e.g. Red wedding dress" value="${esc(form.name)}"></section>
      <section><h2>Notes <small>(optional)</small></h2>
        <textarea class="field" id="f-notes" rows="3" placeholder="e.g. Bought in Valletta, needs dry cleaning">${esc(form.notes)}</textarea></section>
      <button class="btn primary big sticky" data-act="save-form">${mode === 'edit' ? 'Save changes' : 'Save to my wardrobe'}</button>
    </main>`;
  renderSubs(); renderPreviews();
  view.querySelector('#f-name').addEventListener('input', (e) => { form.name = e.target.value; persistSoon(); });
  view.querySelector('#f-notes').addEventListener('input', (e) => { form.notes = e.target.value; persistSoon(); });
}

function renderSubs() {
  const el = document.getElementById('subs-section');
  if (!el) return;
  const subs = form.category_id ? subsOf(form.category_id) : [];
  const n = form.mode === 'add' ? 3 : 2;
  el.innerHTML = !form.category_id ? '' : subs.length
    ? `<h2><span class="step"><span class="step-n">${n}</span></span> Subcategories <small>(tick all that fit)</small></h2>
       <div class="chips wrap">${subs.map((s) => `<button class="chip tick ${form.subIds.includes(s.id) ? 'on' : ''}" data-act="toggle-sub" data-id="${s.id}">${esc(cap(s.name))}</button>`).join('')}</div>`
    : `<h2><span class="step"><span class="step-n">${n}</span></span> Subcategories</h2><p class="hint">${esc(catOf(form.category_id).name)} has no subcategories.</p>`;
}

function renderPreviews() {
  const el = document.getElementById('previews');
  if (!el) return;
  el.innerHTML = form.files.map((f, i) => `<div class="preview ${i === form.cover ? 'cover' : ''} ${f.state || ''}">
    <img src="${f.url}" alt="" data-act="pick-cover" data-i="${i}" onerror="this.classList.add('broken')">
    ${f.state === 'pending' ? '<span class="prev-wait" aria-label="Getting photo ready"><span class="spinner small"></span></span>' : ''}
    ${f.state === 'bad' ? `<span class="prev-bad">Can't open this photo<small>${esc(techOf(f.err)).slice(0, 160)}</small></span>` : ''}
    ${i === form.cover ? '<span class="badge">✦ Cover</span>' : ''}
    <button class="remove" data-act="remove-file" data-i="${i}" aria-label="Remove photo">×</button></div>`).join('');
  const h = document.getElementById('cover-hint');
  if (h) h.textContent = form.files.length > 1 ? 'Tap a photo to make it the cover.' : '';
}

function screenManage() {
  const cats = S.cats.slice().sort((a, b) => a.sort - b.sort);
  view.innerHTML = `${top('Categories', { back: '#/' })}
    <main class="pad">
      <p class="hint">Tap a name to rename or delete it.</p>
      ${cats.map((c) => {
        const n = S.items.filter((i) => i.category_id === c.id).length;
        return `<section class="card">
          <button class="card-title" data-act="cat-menu" data-id="${c.id}">${catIcon(c)} ${esc(c.name)} <small>${n} ${n === 1 ? 'item' : 'items'}</small></button>
          <div class="chips wrap">${subsOf(c.id).map((s) => `<button class="chip" data-act="sub-menu" data-id="${s.id}">${esc(cap(s.name))}</button>`).join('')}
            <button class="chip add" data-act="add-sub" data-id="${c.id}">+ Add</button></div></section>`;
      }).join('')}
      <button class="btn primary big" data-act="add-cat">+ New category</button>
      <section class="card help">
        <h2>Put the app on your home screen</h2>
        <p><b>iPhone / iPad:</b> open this page in Safari, tap the Share button <span aria-hidden="true">⬆️</span>, then “Add to Home Screen”.</p>
        <p><b>Android:</b> open in Chrome, tap the ⋮ menu, then “Add to Home screen” or “Install app”.</p>
      </section>
      ${db.demo ? '' : '<button class="btn" data-act="sign-out">Sign out</button>'}
    </main>`;
}

// ------------------------------------------------------------------ actions
// Photos are prepared (decoded, rotated, shrunk) on the phone first; any that can't be opened are skipped
// and reported, so one odd photo never blocks the rest.
let prepChain = Promise.resolve();
function makeEntry(file) {
  const x = { file, url: URL.createObjectURL(file), state: 'pending' };
  x.prep = prepChain = prepChain.then(async () => {
    try { x.img = await preparePhoto(file); x.state = 'ok'; URL.revokeObjectURL(x.url); x.url = URL.createObjectURL(x.img.thumb); }
    catch (e) { x.err = e; x.state = 'bad'; console.warn('Photo could not be prepared', e); }
    if (form && form.files.includes(x)) renderPreviews();
  });
  return x;
}
async function preparePhotos(files) {
  const good = [], bad = [];
  for (let i = 0; i < files.length; i++) {
    busy(files.length > 1 ? `Getting photo ${i + 1} of ${files.length} ready…` : 'Getting the photo ready…');
    try { good.push(await preparePhoto(files[i])); } catch (e) { console.warn('Photo could not be prepared', e); bad.push({ name: files[i].name, err: e }); }
  }
  return { good, bad };
}
async function uploadPhotos(itemId, imgs) {
  let firstId = null;
  for (let i = 0; i < imgs.length; i++) {
    busy(imgs.length > 1 ? `Saving photo ${i + 1} of ${imgs.length}…` : 'Saving photo…');
    const p = await db.addPhoto(itemId, imgs[i]);
    firstId = firstId || p.id;
  }
  return firstId;
}
async function reportBadPhotos(bad, total) {
  if (!bad.length) return;
  const title = bad.length === total ? (total === 1 ? "This photo can't be opened" : "These photos can't be opened")
    : `${bad.length} of ${total} photos couldn't be added`;
  const msgs = [...new Set(bad.map((b) => b.err?.friendly || "Sorry, this photo can't be opened. Please try a different one."))];
  const body = msgs.map((m) => `<p>${esc(m)}</p>`).join('') + bad.map((b) => `<p class="tech">Details: ${esc(techOf(b.err))}</p>`).join('');
  await modal({ title, body, buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
}

const actions = {
  demo() { db = demoBackend(); setDraftScope(true); start(); },
  colour(el) { colourFilter = el.dataset.v; localStorage.setItem('colourFilter', colourFilter); render(); },

  async 'make-cover'() {
    const g = document.getElementById('gallery'); const it = byId(S.items, location.hash.split('/')[2]);
    if (await attempt(async () => { await db.setCover(it.id, g.dataset.current); await reload(); })) { toast('Cover photo changed'); galleryStart = null; render(); }
  },
  async 'photo-date'() {
    const g = document.getElementById('gallery'); const p = byId(S.photos, g.dataset.current);
    const v = await ask('When was this photo taken?', p.taken_on, 'date');
    if (!v) return;
    if (await attempt(async () => { await db.setPhotoDate(p.id, v); await reload(); })) { galleryStart = p.id; render(); }
  },
  async 'delete-photo'() {
    const g = document.getElementById('gallery'); const p = byId(S.photos, g.dataset.current);
    if (photosOf(p.item_id).length === 1 && !(await confirmBox('Delete the only photo?', 'This item will have no photo left.'))) return;
    else if (photosOf(p.item_id).length > 1 && !(await confirmBox('Delete this photo?', 'The item and its other photos stay.'))) return;
    if (await attempt(async () => { await db.deletePhoto(p); await reload(); }, 'Deleting…')) { toast('Photo deleted'); render(); }
  },
  async 'delete-item'() {
    const it = byId(S.items, location.hash.split('/')[2]);
    if (!(await confirmBox('Delete this item?', `“${itemTitle(it)}” and all its photos will be removed for good.`))) return;
    if (await attempt(async () => { await db.deleteItem(it, photosOf(it.id)); await reload(); }, 'Deleting…')) { toast('Item deleted'); go(`#/cat/${it.category_id}`); }
  },
  async 'add-photos'(el) {
    const files = [...el.files]; el.value = '';
    if (!files.length) return;
    const itemId = location.hash.split('/')[2];
    let first = null, bad = [], added = 0;
    const ok = await attempt(async () => {
      const r = await preparePhotos(files); bad = r.bad; added = r.good.length;
      if (added) { first = await uploadPhotos(itemId, r.good); await reload(); }
    });
    if (ok) {
      if (added) { toast(added > 1 ? `${added} photos added` : 'Photo added'); galleryStart = first; render(); }
      await reportBadPhotos(bad, files.length);
    }
  },

  'form-photos'(el) {
    for (const f of el.files) form.files.push(makeEntry(f));
    el.value = ''; renderPreviews(); persist(true);
  },
  'pick-cover'(el) { form.cover = +el.dataset.i; renderPreviews(); persist(); },
  'remove-file'(el) {
    const i = +el.dataset.i; URL.revokeObjectURL(form.files[i].url); form.files.splice(i, 1);
    if (form.cover >= form.files.length) form.cover = 0; else if (i < form.cover) form.cover--;
    renderPreviews(); persist(true);
  },
  'pick-cat'(el) {
    if (form.category_id !== el.dataset.id) form.subIds = [];
    form.category_id = el.dataset.id;
    view.querySelectorAll('[data-act="pick-cat"]').forEach((b) => b.classList.toggle('on', b === el));
    renderSubs(); persist();
  },
  'toggle-sub'(el) {
    const id = el.dataset.id;
    form.subIds = form.subIds.includes(id) ? form.subIds.filter((x) => x !== id) : [...form.subIds, id];
    el.classList.toggle('on'); persist();
  },
  'pick-colour'(el) {
    form.colour = el.dataset.v;
    view.querySelectorAll('[data-act="pick-colour"]').forEach((b) => b.classList.toggle('on', b === el)); persist();
  },
  async 'save-form'() {
    const missing = [];
    if (form.mode === 'add' && !form.files.length) missing.push('add at least one photo');
    if (!form.category_id) missing.push('pick a category');
    if (!form.colour) missing.push('pick black or non-black');
    if (missing.length) { await modal({ title: 'Nearly there', body: `<p>Please ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.</p>`, buttons: [{ label: 'OK', value: true, kind: 'primary' }] }); return; }
    const f = { category_id: form.category_id, colour: form.colour, name: form.name.trim(), notes: form.notes.trim(), subIds: form.subIds };
    let itemId = form.itemId, bad = [], total = 0, noneGood = false;
    const ok = await attempt(async () => {
      if (form.mode === 'edit') { busy('Saving…'); await db.updateItem(itemId, f); }
      else {
        const order = [form.files[form.cover], ...form.files.filter((_, i) => i !== form.cover)];
        total = order.length;
        busy('Getting photos ready…');
        await Promise.all(order.map((x) => x.prep));
        const good = order.filter((x) => x.state === 'ok').map((x) => x.img);
        bad = order.filter((x) => x.state !== 'ok').map((x) => ({ name: x.file.name, err: x.err }));
        if (!good.length) { noneGood = true; return; }
        busy('Saving…');
        const it = await db.createItem(f); itemId = it.id;
        const coverId = await uploadPhotos(itemId, good);
        await db.setCover(itemId, coverId);
      }
      await reload();
    });
    if (ok && noneGood) { await reportBadPhotos(bad, total); return; }   // nothing saved; she stays on the form (draft kept)
    if (ok) { form.files.forEach((x) => URL.revokeObjectURL(x.url)); const edit = form.mode === 'edit'; form = null; await clearDraft(); toast(edit ? 'Saved' : 'Added to your wardrobe 🎉'); go(`#/item/${itemId}`); await reportBadPhotos(bad, total); }
    else if (form.mode === 'add' && itemId && !form.itemId) { await reload(); form = null; await clearDraft(); go(`#/item/${itemId}`); }
  },

  async 'add-cat'() {
    const name = await ask('New category name');
    if (!name) return;
    if (await attempt(async () => { await db.addCategory(name, Math.max(0, ...S.cats.map((c) => c.sort)) + 1); await reload(); })) render();
  },
  async 'cat-menu'(el) {
    const c = catOf(el.dataset.id);
    const choice = await modal({ title: c.name, buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Rename', value: 'ren', kind: 'primary' }] });
    if (choice === 'ren') {
      const name = await ask('Rename category', c.name);
      if (name && name !== c.name && await attempt(async () => { await db.renameCategory(c.id, name); await reload(); })) render();
    } else if (choice === 'del') {
      const n = S.items.filter((i) => i.category_id === c.id).length;
      if (n) { await modal({ title: 'Not empty', body: `<p>${esc(c.name)} still has ${n} ${n === 1 ? 'item' : 'items'}. Move them to another category (Edit details) or delete them first.</p>`, buttons: [{ label: 'OK', value: true, kind: 'primary' }] }); return; }
      if (await confirmBox(`Delete ${c.name}?`, 'Its subcategories will be removed too.') && await attempt(async () => { await db.deleteCategory(c.id); await reload(); })) render();
    }
  },
  async 'add-sub'(el) {
    const c = catOf(el.dataset.id);
    const name = await ask(`New subcategory in ${c.name}`);
    if (!name) return;
    if (await attempt(async () => { await db.addSub(c.id, name, Math.max(0, ...subsOf(c.id).map((s) => s.sort)) + 1); await reload(); })) render();
  },
  async 'sub-menu'(el) {
    const s = byId(S.subs, el.dataset.id);
    const choice = await modal({ title: cap(s.name), buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Rename', value: 'ren', kind: 'primary' }] });
    if (choice === 'ren') {
      const name = await ask('Rename subcategory', s.name);
      if (name && name !== s.name && await attempt(async () => { await db.renameSub(s.id, name); await reload(); })) render();
    } else if (choice === 'del') {
      const n = S.links.filter((l) => l.subcategory_id === s.id).length;
      if (await confirmBox(`Delete “${cap(s.name)}”?`, n ? `The ${n} ${n === 1 ? 'item' : 'items'} in it will stay in ${catOf(s.category_id).name}.` : 'It has no items.')
        && await attempt(async () => { await db.deleteSub(s.id); await reload(); })) render();
    }
  },
  async 'sign-out'() {
    if (!(await confirmBox('Sign out?', 'You will need your email and password to sign in again.', 'Sign out'))) return;
    await db.signOut(); signedIn = false; S = { cats: [], subs: [], items: [], links: [], photos: [] }; render();
  },
};

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const a = e.target.closest('[data-act]');
  if (a && a.tagName !== 'INPUT' && actions[a.dataset.act]) { e.preventDefault(); actions[a.dataset.act](a); }
});
document.addEventListener('change', (e) => {
  const a = e.target.closest('input[data-act]');
  if (a && actions[a.dataset.act]) actions[a.dataset.act](a);
});

// ------------------------------------------------------------------ drafts (never lose an unfinished form)
function snapshot(f) { return JSON.stringify([f.category_id, [...f.subIds].sort(), f.colour, f.name.trim(), f.notes.trim()]); }
function isDirty(f) { return !!f && (f.files.length > 0 || snapshot(f) !== f.orig); }
let persistTimer = null;
function persist(withFiles = false) {
  clearTimeout(persistTimer);
  if (!form) return;
  const c = catOf(form.category_id);
  saveDraftFields(form, { category: c?.name, subs: S.subs.filter((x) => form.subIds.includes(x.id)).map((x) => x.name) });
  if (withFiles) saveDraftFiles(form);
}
function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(() => persist(), 400); }
const flushDraft = () => { if (form) persist(); };
window.addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });

// Offer to carry on with a form that was interrupted. Returns true if it took her back to it.
async function offerDraft() {
  const d = await loadDraft().catch(() => null);
  if (!d) return false;
  const item = d.mode === 'edit' ? byId(S.items, d.itemId) : null;
  const usable = d.mode === 'add' || item;
  const hasContent = d.files.length || d.name?.trim() || d.notes?.trim() || d.colour || (d.mode === 'edit');
  if (!usable || !hasContent) { await clearDraft(); return false; }
  const lc = (x) => String(x || '').trim().toLowerCase();
  const cat = catOf(d.category_id) || S.cats.find((c) => d.category_name && lc(c.name) === lc(d.category_name));
  const what = d.mode === 'edit' ? `editing “${esc(itemTitle(item))}”` : `adding an item${cat ? ` to ${esc(cat.name)}` : ''}`;
  const photos = d.files.length ? ` with ${d.files.length} ${d.files.length === 1 ? 'photo' : 'photos'}` : '';
  const yes = await modal({ title: 'Continue where you left off?', body: `<p>You were ${what}${photos}, but it wasn't saved yet.</p>`,
    buttons: [{ label: 'Start fresh', value: false }, { label: 'Continue', value: true, kind: 'primary' }] });
  if (!yes) { await clearDraft(); return false; }
  const catOk = !!cat;
  const catSubs = catOk ? S.subs.filter((x) => x.category_id === cat.id) : [];
  const subIds = catSubs.filter((x) => (d.subIds || []).includes(x.id) || (d.sub_names || []).some((n) => lc(n) === lc(x.name))).map((x) => x.id);
  form = { key: d.key, mode: d.mode, itemId: d.itemId || undefined, files: d.files.map(makeEntry),
    cover: Math.min(d.cover || 0, Math.max(0, d.files.length - 1)), category_id: catOk ? cat.id : null, subIds,
    colour: d.colour || null, name: d.name || '', notes: d.notes || '' };
  if (d.mode === 'edit') form.orig = snapshot({ category_id: item.category_id, subIds: itemSubIds(item.id), colour: item.colour, name: item.name || '', notes: item.notes || '' });
  else form.orig = snapshot({ category_id: null, subIds: [], colour: null, name: '', notes: '' });
  if (location.hash === d.key) render(); else location.hash = d.key;
  return true;
}

// ------------------------------------------------------------------ router
let signedIn = false;
async function render() {
  if (!db) return screenSetup();
  if (!db.demo && !signedIn) { signedIn = !!(await db.session().catch(() => null)); if (!signedIn) return screenLogin(); }
  const [, page, a, b] = (location.hash || '#/').split('/');
  if (page !== 'add' && page !== 'edit' && form) {
    if (isDirty(form)) {
      const leave = await modal({ title: 'Leave without saving?', body: '<p>What you have filled in so far will be lost.</p>',
        buttons: [{ label: 'Keep editing', value: false, kind: 'primary' }, { label: 'Discard', value: true, kind: 'danger' }] });
      if (!leave) { location.hash = form.key; return; }
    }
    form.files.forEach((x) => URL.revokeObjectURL(x.url)); form = null; await clearDraft();
  }
  window.scrollTo(0, 0);
  if (page === 'cat') screenCategory(a, b);
  else if (page === 'item') screenItem(a);
  else if (page === 'add') screenForm('add', a, b);
  else if (page === 'edit') screenForm('edit', a);
  else if (page === 'manage') screenManage();
  else screenHome();
}
window.addEventListener('hashchange', render);

async function start() {
  if (!db.demo) {
    signedIn = !!(await db.session().catch(() => null));
    if (!signedIn) return screenLogin();
  }
  busy('Opening your wardrobe…');
  try { await reload(); } catch (e) { busy(); view.innerHTML = `<div class="centre"><p>${esc(friendly(e))}</p><button class="btn primary big" onclick="location.reload()">Try again</button></div>`; return; }
  busy();
  if (!(await offerDraft())) render();
}

const wantDemo = new URLSearchParams(location.search).has('demo');
setDraftScope(wantDemo);
if (wantDemo) db = demoBackend();
else if (isConfigured()) db = supabaseBackend();
if (db) start(); else render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false, pendingReload = false;
  // Only reload for a new version when nothing could be lost: no add/edit form, no upload or save running,
  // no pop-up open and nothing typed on the sign-in screen. Otherwise wait until she next opens the app.
  const safeToReload = () => !form && !busyEl && !document.querySelector('.modal-back')
    && !document.querySelector('#login input[name=email]')?.value && !document.querySelector('#pw')?.value;
  const reloadIfSafe = () => { if (reloading || !pendingReload || !safeToReload()) return; reloading = true; location.reload(); };
  window.__wardrobeSafeToReload = safeToReload; // used by the automated tests
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    pendingReload = true; reloadIfSafe();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reloadIfSafe(); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update().catch(() => {}); document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); }); })
    .catch(() => {});
}
