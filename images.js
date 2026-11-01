// Client-side photo preparation: fix rotation, shrink, compress, read the date taken.

const FULL_MAX = 1600, FULL_Q = 0.85, THUMB_MAX = 480, THUMB_Q = 0.8;

export function localISODate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// A photo problem with a friendly explanation plus the technical reason (shown in small print).
export class PhotoError extends Error {
  constructor(friendly, tech) { super(friendly); this.name = 'PhotoError'; this.friendly = friendly; this.tech = tech; }
}

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
// Work out the real format from the first bytes (names and MIME types from phones are unreliable).
export function sniff(buf) {
  const b = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
  const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && str(1, 3) === 'PNG') return 'png';
  if (str(0, 3) === 'GIF') return 'gif';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return 'webp';
  if (str(4, 4) === 'ftyp') {
    const size = Math.min(b.length, (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0 || b.length);
    const brands = [str(8, 4)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(str(o, 4));
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.some((x) => HEIC_BRANDS.includes(x))) return 'heic';
  }
  return 'unknown';
}
const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic' };
const why = (e) => (e && (e.message || e.name || String(e))) || 'unknown error';

const bitmap = (blob, opts = {}) => createImageBitmap(blob, { imageOrientation: 'from-image', ...opts });
function imgElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image element could not decode')); };
    img.src = url;
  });
}
let heicLib = null;
async function decodeHeic(blob) {
  heicLib = heicLib || import('./vendor/heic-to.js');        // ~3 MB, only loaded when a HEIC photo turns up
  const { heicTo } = await heicLib;
  return heicTo({ blob, type: 'bitmap', options: { imageOrientation: 'from-image' } });
}

async function readBytes(file) {
  if (!file || !file.size) {
    throw new PhotoError("This photo seems to be empty. If it's stored in Google Photos or the cloud, open it there first so it downloads to the phone, then try again.",
      `empty file (${file?.name || 'no name'}, ${file?.size ?? '?'} bytes)`);
  }
  try { return await file.arrayBuffer(); } catch (e) {
    throw new PhotoError("The phone wouldn't hand this photo over. If it's in Google Photos or the cloud, open it there first so it downloads, or pick it from the Gallery app, then try again.",
      `could not read file: ${e.name}: ${e.message}`);
  }
}

// Decode any photo we can: normal formats natively, HEIC/HEIF (Samsung/iPhone camera) with a bundled decoder,
// and very large photos by letting the browser shrink them while decoding.
async function loadImage(file) {
  const buf = await readBytes(file);
  const kind = sniff(buf);
  const blob = new Blob([buf], { type: MIME[kind] || file.type || '' });
  const tried = [];
  const attempts = kind === 'heic'
    ? [['heic decoder', () => decodeHeic(blob)], ['native', () => bitmap(blob)]]
    : [['native', () => bitmap(blob)], ['native resized', () => bitmap(blob, { resizeWidth: 2400, resizeQuality: 'high' })],
       ['image element', () => imgElement(blob)], ['heic decoder', () => decodeHeic(blob)]];
  for (const [name, fn] of attempts) {
    try { const img = await fn(); if ((img.width || img.naturalWidth) > 0) return img; tried.push(`${name}: zero size`); }
    catch (e) { tried.push(`${name}: ${why(e)}`); }
  }
  const tech = `${file.name || 'photo'} · ${file.type || 'no type'} · detected ${kind} · ${Math.round(file.size / 1024)} KB · ${tried.join(' | ')}`;
  throw new PhotoError(kind === 'heic'
    ? "This photo is in Samsung/iPhone HEIC format and couldn't be converted. Try another photo, or in the Camera settings turn off \u2018High efficiency pictures\u2019."
    : "Sorry, this photo can't be opened. Please try a different one.", tech);
}

function shrink(src, w0, h0, max, quality) {
  const s = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new PhotoError("The phone ran out of memory shrinking this photo. Please try again or pick a smaller one.", `canvas toBlob returned null (${w}x${h})`))), 'image/jpeg', quality));
}

export async function preparePhoto(file) {
  const img = await loadImage(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const full = await shrink(img, w0, h0, FULL_MAX, FULL_Q);
  const thumb = await shrink(img, w0, h0, THUMB_MAX, THUMB_Q);
  if (img.close) img.close();
  const takenOn = (await exifDate(file)) || localISODate(new Date(file.lastModified || Date.now()));
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h, takenOn };
}

// Minimal EXIF reader: returns 'YYYY-MM-DD' from DateTimeOriginal (or DateTime), else null.
export async function exifDate(file) {
  try {
    if (!/jpe?g/i.test(file.type || '')) return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o < v.byteLength - 10) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return readTiff(v, o + 10);
      o += 2 + len;
    }
  } catch { /* ignore */ }
  return null;
}

function readTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
  const ifd = (off) => {
    const n = u16(t + off), out = {};
    for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; out[u16(e)] = { count: u32(e + 4), at: e + 8 }; }
    return out;
  };
  const str = (en) => {
    const p = en.count > 4 ? t + u32(en.at) : en.at;
    let s = '';
    for (let i = 0; i < en.count - 1; i++) s += String.fromCharCode(v.getUint8(p + i));
    return s;
  };
  const ifd0 = ifd(u32(t + 4));
  let s = null;
  if (ifd0[0x8769]) { const sub = ifd(u32(ifd0[0x8769].at)); if (sub[0x9003]) s = str(sub[0x9003]); }
  if (!s && ifd0[0x0132]) s = str(ifd0[0x0132]);
  const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
