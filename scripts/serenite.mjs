/**
 * La Sérénité, dirigeable Belle Époque amarré dans l'Umbra au-dessus des Grands Boulevards : enveloppe souple tenue par
 * des suspentes, longue nacelle en passerelle à la Santos-Dumont, hélice arrière, empennage en croix.
 * Option B choisie par le MJ le 14/11/2026, sans les ballonnets d'Éther.
 * Coordonnées en unités du modèle : 10 de long (x, proue côté x négatif), y vers le haut avec l'axe de l'enveloppe à 0,
 * nacelle vers y = −2,4, z en travers.
 */

/** Rayon de l'enveloppe le long de l'axe (t de 0 à 1, de la proue à la poupe) */
const profil = t => 1.25 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.9))), 0.7);

function boite(p, x, y, z, w, h, d) {
  const X = [x - w / 2, x + w / 2], Y = [y, y + h], Z = [z - d / 2, z + d / 2];
  for ( const a of X ) for ( const b of Y ) p.push(a, b, Z[0], a, b, Z[1]);
  for ( const a of X ) for ( const c of Z ) p.push(a, Y[0], c, a, Y[1], c);
  for ( const b of Y ) for ( const c of Z ) p.push(X[0], b, c, X[1], b, c);
}

/** Bas de la nacelle (unités du modèle) : point d'arrivée de l'ascenseur */
export const BAS_NACELLE = -2.4;

/** Segments du dirigeable : Float32Array [x, y, z, x, y, z, …] */
export function segmentsSerenite() {
  const p = [], L = 10, anneaux = 8, longerons = 10, N = 40;
  // Enveloppe : anneaux et fuseaux
  for ( let a = 0; a <= anneaux; a++ ) {
    const t = a / anneaux, x = -L / 2 + t * L, r = profil(t);
    for ( let k = 0; k < longerons; k++ ) {
      const u = k / longerons * Math.PI * 2, v = (k + 1) / longerons * Math.PI * 2;
      p.push(x, Math.cos(u) * r, Math.sin(u) * r, x, Math.cos(v) * r, Math.sin(v) * r);
    }
  }
  for ( let k = 0; k < longerons; k++ ) {
    const u = k / longerons * Math.PI * 2;
    for ( let i = 0; i < N; i++ ) {
      const t1 = i / N, t2 = (i + 1) / N, r1 = profil(t1), r2 = profil(t2);
      p.push(-L / 2 + t1 * L, Math.cos(u) * r1, Math.sin(u) * r1, -L / 2 + t2 * L, Math.cos(u) * r2, Math.sin(u) * r2);
    }
  }
  // Suspentes vers la nacelle
  for ( let i = 0; i < 10; i++ ) {
    const x = -3.6 + i * 0.8;
    p.push(x, -1.05, 0.35, x - 0.2, -1.9, 0.25, x, -1.05, -0.35, x - 0.2, -1.9, -0.25);
  }
  // Nacelle-passerelle et ses hublots
  boite(p, -0.3, BAS_NACELLE, 0, 7, 0.5, 0.5);
  for ( let i = 0; i < 14; i++ ) p.push(-3.6 + i * 0.5, -2.3, 0.26, -3.6 + i * 0.5, -2.0, 0.26);
  // Hélice arrière
  const hx = 3.4, hy = -2.15, hr = 0.45;
  for ( let k = 0; k < 3; k++ ) { const u = k / 3 * Math.PI * 2; p.push(hx, hy, 0, hx, hy + Math.cos(u) * hr, Math.sin(u) * hr); }
  for ( let k = 0; k < 16; k++ ) {
    const u = k / 16 * Math.PI * 2, v = (k + 1) / 16 * Math.PI * 2;
    p.push(hx, hy + Math.cos(u) * hr, Math.sin(u) * hr, hx, hy + Math.cos(v) * hr, Math.sin(v) * hr);
  }
  // Empennage en croix
  const x0 = L / 2 - 1.6, h = 1;
  for ( const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]] ) {
    p.push(x0, a * 0.35, b * 0.35, x0 + 1.5, a * h, b * h, x0 + 1.5, a * h, b * h, x0 + 1.9, a * h * 0.6, b * h * 0.6,
      x0 + 1.9, a * h * 0.6, b * h * 0.6, x0 + 1.6, 0, 0);
  }
  return new Float32Array(p);
}

/** Cabine de verre et de laiton (cube unité centré en x et z, de y = 0 à 1) */
export function segmentsCabine() {
  const p = []; boite(p, 0, 0, 0, 0.75, 1, 0.75);
  p.push(-0.375, 0.5, 0.375, 0.375, 0.5, 0.375, -0.375, 0.5, -0.375, 0.375, 0.5, -0.375);
  return new Float32Array(p);
}
