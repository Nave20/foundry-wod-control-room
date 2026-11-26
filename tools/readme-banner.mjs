// Génère la bannière animée du README (.github/assets/banner.svg), dans le style du profil GitHub Nave20.
// Lancer depuis la racine du dépôt :  node tools/readme-banner.mjs
// Polices système seulement : GitHub affiche le SVG dans une balise <img>, qui ne charge aucune police externe.
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '.github/assets';
mkdirSync(OUT, { recursive: true });

const C = {
  canvas: '#12141a', line: '#2a2f3a', ink: '#f3f4f6', muted: '#9aa3b2', dim: '#5d6573',
  coral: '#ff5f45', amber: '#ffb21e', teal: '#14c8a8', sky: '#3d9bff',
};
const SANS = `'Segoe UI', -apple-system, 'Helvetica Neue', Ubuntu, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace`;
const MW = 0.6;
const r = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mono(x, y, str, size, fill, extra = '') {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fill}" textLength="${r(str.length * size * MW)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve" ${extra}>${esc(str)}</text>`;
}

// Frappe : largeur de 0 à n caractères, maintien, effacement (même logique que le profil).
function typingValues(n, cw, { start, type, hold, erase }, dur) {
  const kt = [0], vals = [0];
  const push = (t, v) => { kt.push(r(Math.min(t / dur, 1))); vals.push(r(v)); };
  for (let i = 1; i <= n; i++) push(start + (type * i) / n, i * cw);
  const e0 = start + type + hold, steps = Math.min(n, 12);
  for (let i = 1; i <= steps; i++) push(e0 + (erase * i) / steps, (n - Math.round((n * i) / steps)) * cw);
  if (kt[kt.length - 1] < 1) { kt.push(1); vals.push(vals[vals.length - 1]); }
  for (let i = 1; i < kt.length; i++) if (kt[i] <= kt[i - 1]) kt[i] = r(kt[i - 1] + 0.0001);
  kt[kt.length - 1] = 1;
  return { keyTimes: kt.join(';'), values: vals.join(';') };
}

// Générateur pseudo-aléatoire fixe : la bannière est identique à chaque génération.
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// Immeuble en perspective isométrique : base au point (x, y), largeur w, profondeur d, hauteur h.
function block(x, y, w, d, h, col) {
  const a = 0.5;
  const top = [[x, y - h], [x + w, y - h - w * a], [x + w + d, y - h - w * a + d * a], [x + d, y - h + d * a]];
  const left = [[x, y], [x, y - h], [x + d, y - h + d * a], [x + d, y + d * a]];
  const right = [[x + d, y + d * a], [x + d, y - h + d * a], [x + w + d, y - h - w * a + d * a], [x + w + d, y - w * a + d * a]];
  const p = (pts) => pts.map(([px, py]) => `${r(px)},${r(py)}`).join(' ');
  return `<polygon points="${p(left)}" fill="${col}" fill-opacity=".10"/>`
    + `<polygon points="${p(right)}" fill="${col}" fill-opacity=".05"/>`
    + `<polygon points="${p(top)}" fill="${col}" fill-opacity=".22"/>`;
}

function skyline() {
  let out = '';
  // Grille d'îlots sur un plan isométrique, du fond vers l'avant pour l'ordre de dessin.
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 9; col++) {
      if (rnd() < 0.22) continue;
      const x = 640 + col * 62 + row * 30;
      const y = 120 + row * 26 - col * 31 + 140;
      const tall = rnd() < 0.12;
      const h = tall ? 70 + rnd() * 50 : 14 + rnd() * 34;
      if (x > 1230 || y - h < 30) continue;
      out += block(x, y, 22 + rnd() * 14, 14 + rnd() * 10, h, tall ? C.teal : C.sky);
    }
  }
  return out;
}

function banner() {
  const W = 1200, H = 320, dur = 13.5;
  const phrases = [
    'a holographic 3D map of the real Paris',
    'live units, synced with your table',
    'Foundry VTT V14 · World of Darkness',
  ];
  const size = 22, cw = size * MW, x0 = 72, y0 = 240;
  let typed = '', clips = '';
  phrases.forEach((p, i) => {
    const v = typingValues(p.length, cw, { start: i * 4.5 + 0.2, type: 1.6, hold: 2, erase: 0.5 }, dur);
    clips += `<clipPath id="tp${i}"><rect x="${x0}" y="${y0 - 26}" height="36" width="0"><animate attributeName="width" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${v.keyTimes}" values="${v.values}"/></rect></clipPath>`;
    typed += `<g clip-path="url(#tp${i})">${mono(x0, y0, p, size, C.ink)}</g>`;
    typed += `<rect y="${y0 - 19}" width="11" height="24" fill="${C.amber}" x="${x0}"><animate attributeName="x" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${v.keyTimes}" values="${v.values.split(';').map((w) => r(x0 + +w + 3)).join(';')}"/>`
      + `<animate attributeName="opacity" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${r((i * 4.5) / dur) || 0.0001};${r(((i + 1) * 4.5) / dur)};1" values="0;1;0;0"/></rect>`;
  });
  const glow = (cx, cy, rad, col, path, d) =>
    `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${col}" opacity=".6"><animateTransform attributeName="transform" type="translate" dur="${d}s" repeatCount="indefinite" values="${path}" calcMode="spline" keySplines="${Array(path.split(';').length - 1).fill('.45 0 .55 1').join(';')}"/></circle>`;
  // La Seine : une courbe lumineuse qui traverse la ville.
  const seine = 'M600 300 C720 250 800 300 900 250 S1060 170 1220 200';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Control Room: a holographic 3D map of Paris for Foundry VTT">
<defs>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#ffffff" opacity=".07"/></pattern>
  <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="${C.canvas}"/><stop offset=".5" stop-color="${C.canvas}" stop-opacity=".88"/><stop offset="1" stop-color="${C.canvas}" stop-opacity="0"/></linearGradient>
  <linearGradient id="name" x1="0" x2="1"><stop offset="0" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>
  ${clips}
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="${C.canvas}"/>
  <g filter="url(#soft)">
    ${glow(900, 150, 170, C.sky, '0 0;-50 30;30 50;0 0', 18)}
    ${glow(1100, 260, 120, C.teal, '0 0;40 -40;-30 -10;0 0', 21)}
  </g>
  <g>${skyline()}</g>
  <path d="${seine}" fill="none" stroke="${C.teal}" stroke-width="3" stroke-opacity=".7" stroke-linecap="round"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W * 0.72}" height="${H}" fill="url(#fade)"/>
  ${mono(x0, 80, '~/foundry $ load paris --3d', 18, C.muted)}
  <text x="${x0 - 4}" y="186" font-family="${SANS}" font-size="100" font-weight="800" letter-spacing="-4" fill="url(#name)">Control Room</text>
  ${mono(x0, y0, '>', size, C.teal, `transform="translate(-26 0)"`)}
  ${typed}
  ${mono(x0, 288, 'proof of concept · interface in French', 15, C.dim)}
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.line}"/>
</g>
</svg>`;
}

writeFileSync(`${OUT}/banner.svg`, banner());
console.log(`${OUT}/banner.svg`);
