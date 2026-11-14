/**
 * Modèles détaillés en fil de fer des lieux de la campagne qui sont de vrais bâtiments (demande du MJ, 14/11/2026),
 * dans le même esprit que les monuments de paris-hologram.mjs (tour Eiffel, Notre-Dame…).
 * Chaque modèle renvoie une liste de points [x, y, z] pris deux à deux (segments) : x, y en m depuis le centre des
 * fichiers, z en m au-dessus du sol. Positions et orientations relevées sur les contours IGN de paris.bin.
 */

const tourne = (cx, cy, a) => (x, y) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];

/** Outils de dessin dans un repère local (cx, cy) tourné de a (radians) */
function outils(s, cx, cy, a) {
  const R = tourne(cx, cy, a), Q = (x, y, z) => [...R(x, y), z];
  const seg = (x1, y1, z1, x2, y2, z2) => s.push(Q(x1, y1, z1), Q(x2, y2, z2));
  /** Pavé d'arêtes */
  const boite = (x, y, w, d, z1, z2) => {
    const c = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
    for ( let i = 0; i < 4; i++ ) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4];
      seg(ax, ay, z1, bx, by, z1); seg(ax, ay, z2, bx, by, z2); seg(ax, ay, z1, ax, ay, z2);
    }
  };
  /** Cercle horizontal */
  const cercle = (x, y, r, z, n = 24) => {
    for ( let k = 0; k < n; k++ ) {
      const u = k / n * Math.PI * 2, v = (k + 1) / n * Math.PI * 2;
      seg(x + Math.cos(u) * r, y + Math.sin(u) * r, z, x + Math.cos(v) * r, y + Math.sin(v) * r, z);
    }
  };
  /** Cylindre : n côtés, gen génératrices */
  const cylindre = (x, y, r, z1, z2, n = 16, gen = n) => {
    cercle(x, y, r, z1, n); cercle(x, y, r, z2, n);
    for ( let k = 0; k < gen; k++ ) {
      const u = k / gen * Math.PI * 2;
      seg(x + Math.cos(u) * r, y + Math.sin(u) * r, z1, x + Math.cos(u) * r, y + Math.sin(u) * r, z2);
    }
  };
  /** Coupole (demi-ellipsoïde de rayon r et de hauteur h) */
  const coupole = (x, y, r, z, h, n = 12, lat = 5) => {
    for ( let j = 0; j < lat; j++ ) cercle(x, y, r * Math.cos(j / lat * Math.PI / 2), z + h * Math.sin(j / lat * Math.PI / 2), n);
    for ( let k = 0; k < n; k++ ) {
      const u = k / n * Math.PI * 2;
      for ( let j = 0; j < lat; j++ ) {
        const t1 = j / lat * Math.PI / 2, t2 = (j + 1) / lat * Math.PI / 2;
        seg(x + Math.cos(u) * r * Math.cos(t1), y + Math.sin(u) * r * Math.cos(t1), z + h * Math.sin(t1),
          x + Math.cos(u) * r * Math.cos(t2), y + Math.sin(u) * r * Math.cos(t2), z + h * Math.sin(t2));
      }
    }
  };
  /** nb colonnes alignées de (x1, y1) à (x2, y2) */
  const colonnade = (x1, y1, x2, y2, nb, z1, z2) => {
    for ( let i = 0; i < nb; i++ ) {
      const t = nb > 1 ? i / (nb - 1) : 0, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      seg(x, y, z1, x, y, z2);
    }
  };
  /** Flèche à base carrée de côté w */
  const fleche = (x, y, w, z1, z2) => {
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x + u * w / 2, y + v * w / 2]);
    for ( let i = 0; i < 4; i++ ) { seg(...c[i], z1, ...c[(i + 1) % 4], z1); seg(...c[i], z1, x, y, z2); }
  };
  return { seg, boite, cercle, cylindre, coupole, colonnade, fleche };
}

/**
 * Position (m depuis le centre des fichiers) et orientation (radians) de chaque modèle. rayon : les contours IGN dont le
 * centre tombe dans ce rayon ne sont plus dessinés (le modèle les remplace) ; absent = on garde tout (Colonne Médicis
 * contre la Bourse de commerce, temple de la Sibylle).
 */
export const MONUMENTS_LIEUX = [
  { nom: "Colonne Médicis", x: -182, y: 716, modele: "medicis" },
  { nom: "Tour Saint-Jacques", x: 230, y: 193, rayon: 8, angle: -0.31, modele: "saintJacques" },
  { nom: "Opéra Garnier", x: -1012, y: 1731, rayon: 85, angle: 1.827, modele: "garnier" },
  { nom: "Palais Brongniart", x: -313, y: 1436, rayon: 40, angle: 1.257, modele: "brongniart" },
  { nom: "Grande Arche", x: -8028, y: 4111, rayon: 70, angle: 0.995, modele: "arche" },
  { nom: "Géode", x: 3086, y: 4251, rayon: 20, modele: "geode" },
  { nom: "Donjon de Vincennes", x: 6511, y: -1555, rayon: 34, angle: -0.1, modele: "vincennes" },
  { nom: "Maison de la Radio", x: -4955, y: -375, rayon: 85, modele: "radio" },
  { nom: "Observatoire de Paris", x: -700, y: -2191, rayon: 26, angle: -0.035, modele: "observatoire" },
  { nom: "Temple de la Sibylle", x: 2731, y: 2722, modele: "sibylle" }
];

export const MODELES_LIEUX = {
  /** Colonne dorique creuse de 31 m, cage armillaire de l'astrologue au sommet */
  medicis(cx, cy) {
    const s = [], o = outils(s, cx, cy, 0);
    o.boite(0, 0, 4.5, 4.5, 0, 2);
    o.cylindre(0, 0, 1.6, 2, 28, 12, 12);
    for ( let z = 4; z < 28; z += 3 ) o.cercle(0, 0, 1.65, z, 12);   // tambours
    o.boite(0, 0, 4, 4, 28, 28.8);                                   // abaque
    const zc = 31, r = 1.6;
    o.cercle(0, 0, r, zc, 16);
    for ( let k = 0; k < 16; k++ ) {
      const u = k / 16 * Math.PI * 2, v = (k + 1) / 16 * Math.PI * 2;
      o.seg(Math.cos(u) * r, 0, zc + Math.sin(u) * r, Math.cos(v) * r, 0, zc + Math.sin(v) * r);
      o.seg(0, Math.cos(u) * r, zc + Math.sin(u) * r, 0, Math.cos(v) * r, zc + Math.sin(v) * r);
    }
    return s;
  },

  /** Tour gothique de 52 m, baies en ogive, quatre pinacles d'angle, statue de saint Jacques */
  saintJacques(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a);
    o.boite(0, 0, 10, 10, 0, 46);
    for ( const z of [12, 24, 36] ) o.boite(0, 0, 10.4, 10.4, z, z + 0.6);   // cordons
    for ( const [u, v] of [[-1, 0], [1, 0], [0, -1], [0, 1]] ) {
      for ( const z of [26, 38] ) {
        o.seg(u * 5.1 - v * 2, v * 5.1 - u * 2, z, u * 5.1, v * 5.1, z + 7);
        o.seg(u * 5.1 + v * 2, v * 5.1 + u * 2, z, u * 5.1, v * 5.1, z + 7);
      }
    }
    for ( const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] ) o.fleche(u * 4.6, v * 4.6, 1.6, 46, 52);
    o.cylindre(3, 3, 0.6, 46, 49, 6, 3); o.seg(3, 3, 49, 3, 3, 52.5);
    return s;
  },

  /** Opéra : façade à loggia au sud, coupole de la salle, cage de scène à fronton, groupe d'Apollon, pavillons */
  garnier(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a);   // axe local x : vers le nord-nord-ouest, façade côté x négatif
    o.boite(-58, 0, 30, 70, 0, 30);
    o.colonnade(-73.5, -28, -73.5, 28, 16, 12, 26);
    o.coupole(-58, -30, 7, 30, 6, 8, 3); o.coupole(-58, 30, 7, 30, 6, 8, 3);
    o.cylindre(-12, 0, 26, 0, 32, 24, 12);
    o.coupole(-12, 0, 26, 32, 12, 16, 4);
    o.cylindre(-12, 0, 3, 44, 50, 8, 4);
    o.boite(34, 0, 40, 56, 0, 44);
    o.seg(14, -28, 44, 14, 0, 56); o.seg(14, 28, 44, 14, 0, 56);
    o.seg(54, -28, 44, 54, 0, 52); o.seg(54, 28, 44, 54, 0, 52);
    o.seg(14, 0, 56, 54, 0, 52);
    o.seg(14, 0, 56, 14, 0, 62); o.cercle(14, 0, 2, 60, 8);
    o.boite(-12, -56, 30, 18, 0, 22); o.boite(-12, 56, 30, 18, 0, 22);
    o.coupole(-12, -56, 9, 22, 5, 10, 3); o.coupole(-12, 56, 9, 22, 5, 10, 3);
    return s;
  },

  /** Palais Brongniart : temple à péristyle de 64 colonnes */
  brongniart(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a), L = 69, W = 41, H = 17;
    o.boite(0, 0, L + 4, W + 4, 0, 2.5);
    o.boite(0, 0, L - 10, W - 10, 2.5, H + 2);
    o.boite(0, 0, L, W, H, H + 2.5);
    o.colonnade(-L / 2, -W / 2, L / 2, -W / 2, 20, 2.5, H);
    o.colonnade(-L / 2, W / 2, L / 2, W / 2, 20, 2.5, H);
    o.colonnade(-L / 2, -W / 2 + 3.4, -L / 2, W / 2 - 3.4, 12, 2.5, H);
    o.colonnade(L / 2, -W / 2 + 3.4, L / 2, W / 2 - 3.4, 12, 2.5, H);
    o.boite(0, 0, L - 18, W - 18, H + 2.5, H + 6);
    return s;
  },

  /** Grande Arche : cube évidé de 110 m, étages, « nuage » sous l'arche */
  arche(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a), c = 56, e = 19, H = 110;
    o.boite(0, 0, 2 * c, 2 * c, H - 8, H);
    o.boite(0, -c + e / 2, 2 * c, e, 0, H - 8);
    o.boite(0, c - e / 2, 2 * c, e, 0, H - 8);
    for ( let z = 10; z < H - 8; z += 10 ) {
      o.seg(-c, -c, z, -c, -c + e, z); o.seg(-c, c, z, -c, c - e, z);
      o.seg(c, -c, z, c, -c + e, z); o.seg(c, c, z, c, c - e, z);
    }
    o.boite(0, 0, 70, 30, 38, 42);
    return s;
  },

  /** Géode : sphère de 36 m sur son bassin (hauteurs divisées par 2 : l'hologramme double les hauteurs, elle reste ronde) */
  geode(cx, cy) {
    const s = [], o = outils(s, cx, cy, 0), r = 18, rz = 9, zc = 9;
    for ( let j = -4; j <= 4; j++ ) o.cercle(0, 0, r * Math.cos(j / 5 * Math.PI / 2), zc + rz * Math.sin(j / 5 * Math.PI / 2), 20);
    for ( let k = 0; k < 10; k++ ) {
      const u = k / 10 * Math.PI;
      for ( let j = 0; j < 20; j++ ) {
        const t1 = j / 20 * Math.PI * 2, t2 = (j + 1) / 20 * Math.PI * 2;
        o.seg(Math.cos(u) * r * Math.cos(t1), Math.sin(u) * r * Math.cos(t1), zc + rz * Math.sin(t1),
          Math.cos(u) * r * Math.cos(t2), Math.sin(u) * r * Math.cos(t2), zc + rz * Math.sin(t2));
      }
    }
    o.cercle(0, 0, 30, 0.5, 32);
    return s;
  },

  /** Donjon de Vincennes : tour carrée de 52 m, tourelles d'angle, mâchicoulis, chemise */
  vincennes(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a), coins = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    o.boite(0, 0, 16, 16, 0, 46);
    for ( const [u, v] of coins ) { o.cylindre(u * 8, v * 8, 2.5, 0, 49, 8, 4); o.fleche(u * 8, v * 8, 5, 49, 52); }
    o.boite(0, 0, 18, 18, 44, 46);
    o.boite(0, 0, 50, 50, 0, 20);
    for ( const [u, v] of coins ) o.cylindre(u * 25, v * 25, 3, 0, 22, 8, 4);
    return s;
  },

  /** Maison de la Radio : couronnes circulaires et tour centrale de 68 m */
  radio(cx, cy) {
    const s = [], o = outils(s, cx, cy, 0);
    o.cylindre(0, 0, 80, 0, 28, 48, 24);
    o.cylindre(0, 0, 62, 0, 22, 40, 0);
    o.cylindre(0, 0, 44, 0, 14, 32, 0);
    o.boite(0, 0, 18, 30, 0, 68);
    for ( let z = 14; z < 68; z += 9 ) o.boite(0, 0, 18, 30, z, z);
    return s;
  },

  /** Observatoire de Paris : bâtiment de Perrault, tours octogonales, coupole Arago */
  observatoire(cx, cy, a) {
    const s = [], o = outils(s, cx, cy, a);
    o.boite(0, 0, 40, 26, 0, 24);
    o.cylindre(-24, -6, 8, 0, 24, 8, 8); o.cylindre(24, -6, 8, 0, 24, 8, 8);
    o.cylindre(0, 15, 6, 0, 20, 8, 8);
    o.cylindre(24, -6, 7, 24, 28, 16, 8); o.coupole(24, -6, 7, 28, 7, 14, 4);
    o.seg(23, -6, 28, 23, -6, 35); o.seg(25, -6, 28, 25, -6, 35);
    return s;
  },

  /** Temple de la Sibylle : rotonde au sommet du rocher des Buttes-Chaumont */
  sibylle(cx, cy) {
    const s = [], o = outils(s, cx, cy, 0), roc = 30;
    for ( let k = 0; k < 9; k++ ) {
      const u = k / 9 * Math.PI * 2, r1 = 22 + (k % 3) * 4, r2 = 9 + (k % 2) * 3;
      o.seg(Math.cos(u) * r1, Math.sin(u) * r1, 0, Math.cos(u) * r2, Math.sin(u) * r2, roc);
    }
    o.cercle(0, 0, 9, roc, 9);
    o.cylindre(0, 0, 5, roc, roc + 1, 16, 0);
    for ( let k = 0; k < 10; k++ ) {
      const u = k / 10 * Math.PI * 2;
      o.seg(Math.cos(u) * 4.5, Math.sin(u) * 4.5, roc + 1, Math.cos(u) * 4.5, Math.sin(u) * 4.5, roc + 8);
    }
    o.cercle(0, 0, 4.8, roc + 8, 16); o.coupole(0, 0, 4.8, roc + 8.5, 3, 10, 3);
    return s;
  }
};
