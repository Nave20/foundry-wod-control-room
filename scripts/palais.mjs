/**
 * Palais classique en fil de fer posé sur l'anneau du royaume du Conseil : soubassement, colonnade, entablement,
 * fronton, tambour et coupole (esprit Panthéon ou Institut de France). Choisi par le MJ le 14/11/2026.
 * Coordonnées en unités du modèle : 6 de long (x), 3,4 de profondeur (z), environ 4,3 de haut (y), centré sur l'origine.
 */
const cercle = (r, y, n) => {
  const p = [];
  for ( let i = 0; i < n; i++ ) {
    const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
    p.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r);
  }
  return p;
};

function boite(p, x, y, z, w, h, d) {
  const X = [x - w / 2, x + w / 2], Y = [y, y + h], Z = [z - d / 2, z + d / 2];
  for ( const a of X ) for ( const b of Y ) p.push(a, b, Z[0], a, b, Z[1]);
  for ( const a of X ) for ( const c of Z ) p.push(a, Y[0], c, a, Y[1], c);
  for ( const b of Y ) for ( const c of Z ) p.push(X[0], b, c, X[1], b, c);
}

function colonne(p, x, z, y0, h, r) {
  const n = 6;
  for ( let i = 0; i < n; i++ ) {
    const a = i / n * Math.PI * 2;
    p.push(x + Math.cos(a) * r, y0, z + Math.sin(a) * r, x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r);
  }
  const c = cercle(r, y0 + h, n);
  for ( let i = 0; i < c.length; i += 3 ) p.push(c[i] + x, c[i + 1], c[i + 2] + z);
}

function coupole(p, r, y, lat, lon) {
  for ( let j = 0; j < lat; j++ ) { const t = j / lat * Math.PI / 2; p.push(...cercle(r * Math.cos(t), y + r * Math.sin(t), lon)); }
  for ( let i = 0; i < lon; i++ ) {
    const a = i / lon * Math.PI * 2;
    for ( let j = 0; j < lat; j++ ) {
      const t0 = j / lat * Math.PI / 2, t1 = (j + 1) / lat * Math.PI / 2;
      p.push(Math.cos(a) * r * Math.cos(t0), y + r * Math.sin(t0), Math.sin(a) * r * Math.cos(t0),
        Math.cos(a) * r * Math.cos(t1), y + r * Math.sin(t1), Math.sin(a) * r * Math.cos(t1));
    }
  }
}

/** Hauteur du sommet (flèche de la lanterne comprise), en unités du modèle */
export const HAUT_PALAIS = 4.3;

/** Segments du palais : Float32Array [x, y, z, x, y, z, …] */
export function segmentsPalais() {
  const p = [];
  boite(p, 0, 0, 0, 6, 0.25, 3.4);
  boite(p, 0, 0.25, 0, 5.6, 0.15, 3);
  for ( let i = 0; i < 10; i++ ) { colonne(p, -2.5 + i * 5 / 9, 1.35, 0.4, 1.6, 0.09); colonne(p, -2.5 + i * 5 / 9, -1.35, 0.4, 1.6, 0.09); }
  for ( let i = 1; i < 5; i++ ) { colonne(p, -2.5, -1.35 + i * 2.7 / 5, 0.4, 1.6, 0.09); colonne(p, 2.5, -1.35 + i * 2.7 / 5, 0.4, 1.6, 0.09); }
  boite(p, 0, 2, 0, 5.6, 0.25, 3);
  // Frontons et faîtage
  p.push(-2.8, 2.25, 1.5, 0, 3, 1.5, 0, 3, 1.5, 2.8, 2.25, 1.5, -2.8, 2.25, -1.5, 0, 3, -1.5, 0, 3, -1.5, 2.8, 2.25, -1.5, 0, 3, 1.5, 0, 3, -1.5);
  // Tambour, coupole, lanterne
  p.push(...cercle(0.9, 2.25, 24), ...cercle(0.9, 2.9, 24));
  for ( let i = 0; i < 12; i++ ) { const a = i / 12 * Math.PI * 2; p.push(Math.cos(a) * 0.9, 2.25, Math.sin(a) * 0.9, Math.cos(a) * 0.9, 2.9, Math.sin(a) * 0.9); }
  coupole(p, 0.9, 2.9, 5, 16);
  for ( let i = 0; i < 4; i++ ) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4, b = (i + 1) / 4 * Math.PI * 2 + Math.PI / 4;
    p.push(Math.cos(a) * 0.08, 3.8, Math.sin(a) * 0.08, 0, HAUT_PALAIS, 0, Math.cos(a) * 0.08, 3.8, Math.sin(a) * 0.08, Math.cos(b) * 0.08, 3.8, Math.sin(b) * 0.08);
  }
  return new Float32Array(p);
}
