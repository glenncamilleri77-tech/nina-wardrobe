// Hand-drawn category icons: bone line + faint fill, oxblood accent. 64x64 grid.
const A = 'class="acc"'; // accent (oxblood)
const S = 'class="sil"'; // main silhouette (bone outline, faint fill)
const L = 'class="ln"';  // detail line, no fill

const ICONS = {
  dresses: `
    <path ${S} d="M24 14 Q28 19 32 16 Q36 19 40 14 Q43 16 42 21 L39 31 Q42 45 45 58 L19 58 Q22 45 25 31 L22 21 Q21 16 24 14 Z"/>
    <path ${L} d="M24 14 V6 M40 14 V6"/>
    <path ${A} d="M25 31 Q32 33.5 39 31" fill="none"/>`,
  tops: `
    <path ${S} d="M25 12 Q32 21 39 12 L44.5 13.5 Q49 15.5 49.5 21 L44.5 22.5 C39 29 38 37 42 46 Q32 48.5 22 46 C26 37 25 29 19.5 22.5 L14.5 21 Q15 15.5 19.5 13.5 Z"/>
    <path ${A} d="M25 12 Q32 21 39 12" fill="none"/>`,
  skirts: `
    <rect ${A} x="20" y="12" width="24" height="7" rx="1.5"/>
    <path ${S} d="M20 19 L11 49 Q32 54 53 49 L44 19 Z"/>
    <path ${L} d="M26.5 19 L22 51.5 M32 19 V52.5 M37.5 19 L42 51.5"/>`,
  trousers: `
    <rect ${S} x="21" y="6" width="22" height="6" rx="1.5"/>
    <path ${S} d="M21 12 L13 58 H29 L32 27 L35 58 H51 L43 12 Z"/>
    <path ${L} stroke-opacity=".55" d="M26 13 L21 57 M38 13 L43 57"/>
    <circle ${A} cx="32" cy="9" r="1.8"/>`,
  coats: `
    <path ${S} d="M25 4 L17.5 7 Q13.5 8 13 13 L10.5 45 L15.5 46 L17 21 L13.5 62 H50.5 L47 21 L48.5 46 L53.5 45 L51 13 Q50.5 8 46.5 7 L39 4 Z"/>
    <path ${L} d="M25 4 L21 10.5 L24.5 13 L22.8 15 L32 26 L41.2 15 L39.5 13 L43 10.5 L39 4 M32 26 V62 M19 50 H25 M39 50 H45"/>
    <circle ${A} cx="28.5" cy="32" r="1.8"/><circle ${A} cx="35.5" cy="32" r="1.8"/>
    <circle ${A} cx="28.5" cy="40" r="1.8"/><circle ${A} cx="35.5" cy="40" r="1.8"/>`,
  outerwear: `
    <path ${S} d="M24 11 L15 14 Q11 15 10 20 L8 46 L13.5 47 L15.5 29 L15.5 43 H48.5 L48.5 29 L50.5 47 L56 46 L54 20 Q53 15 49 14 L40 11 Z"/>
    <path ${L} d="M24 11 L19 20 L27 27 M40 11 L46 21 L37 25 M15.5 38 H48.5"/>
    <path ${A} d="M38 12 L37 25 L27 31 V43" fill="none"/>
    <circle ${A} cx="19" cy="20" r="1.3"/><circle ${A} cx="46" cy="21" r="1.3"/>`,
  shoes: `
    <path ${S} d="M23 6 H37 V30 Q38 37 46 40 L54 43 Q58.5 45 57.5 50 V52 H33 Q29 46.5 25 47 L23.5 58 H19.5 L18.5 46 Q17 39 20 31 Z"/>
    <path ${L} d="M33 52 H57.5"/>
    <path ${A} d="M18.8 47.5 L19.5 58 H23.5 L24.6 48" fill-opacity=".9"/>
    <path ${L} stroke-opacity=".55" d="M30 8 V28"/>`,
  accessories: `
    <path ${S} d="M23 26 Q23 11 32 11 Q41 11 41 26" fill="none"/>
    <path ${S} d="M14 26 H50 L54 54 Q54 57 51 57 H13 Q10 57 10 54 Z"/>
    <path ${L} d="M14 26 L32 39 L50 26"/>
    <circle ${A} cx="32" cy="39" r="2.6"/>`,
  _default: `
    <path ${L} d="M32 14 a5 5 0 1 1 5 5 Q32 20 32 25 L8 44 Q6 47 10 47 H54 Q58 47 56 44 L32 25"/>`,
};

export function catSvg(name, cls = 'ci') {
  const body = ICONS[String(name || '').trim().toLowerCase()] || ICONS._default;
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
}
// Standalone SVG (with its own colours) for demo sample pictures.
export function catSvgStandalone(name, bg, w = 600, h = 800) {
  const body = ICONS[String(name || '').trim().toLowerCase()] || ICONS._default;
  const size = w * 0.62, x = (w - size) / 2, y = (h - size) / 2 - h * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>
    .sil{fill:#e9dcc6;fill-opacity:.13;stroke:#e9dcc6;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
    .ln{fill:none;stroke:#e9dcc6;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .acc{fill:#c8324c;stroke:#c8324c;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}</style>
    <rect width="100%" height="100%" fill="${bg}"/><svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg></svg>`;
}
export const ICON_NAMES = Object.keys(ICONS).filter((k) => k !== '_default');
