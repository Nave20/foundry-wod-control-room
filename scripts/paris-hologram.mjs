/**
 * Moteur commun de l'hologramme de Paris (Foundry et page d'aperçu) : lecture du fichier PRS2 et construction
 * de la scène Three.js. Unités de scène : 1 = 1 km ; relief exagéré ×VR, hauteurs des bâtiments ×VB.
 */
import { MONUMENTS_LIEUX, MODELES_LIEUX } from "./monuments-lieux.mjs";

export const VR = 4, VB = 2;
const K = 0.001;

/** Lit un fichier PRS2 (voir tools/extract_paris.py) */
export function lireParis(buf) {
  const dv = new DataView(buf);
  const magie = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if ( magie !== "PRS2" ) throw new Error(`format ${magie} non pris en charge (PRS2 attendu)`);
  const n = dv.getUint32(4, true);
  const entete = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  let o = 8 + n; const calques = {};
  for ( const nom of entete.calques ) {
    const nb = dv.getUint32(o, true); o += 4;
    const longueurs = new Uint16Array(buf, o, nb); o += nb * 2;
    let hauteurs = null, sols = null;
    if ( entete.avec_hauteur.includes(nom) ) {
      hauteurs = new Uint16Array(buf, o, nb); o += nb * 2;
      sols = new Uint8Array(buf, o, nb); o += nb + (nb % 2);
    }
    let total = 0; for ( let i = 0; i < nb; i++ ) total += longueurs[i];
    calques[nom] = { nb, longueurs, hauteurs, sols, coords: new Int16Array(buf, o, total * 2) }; o += total * 4;
  }
  const g = entete.relief;
  const relief = new Uint8Array(buf, o, g.l * g.h);
  return { entete, calques, relief, taille: buf.byteLength };
}

export const PALETTES = {
  tech: { bas: [0.05, 0.33, 0.48], haut: [0.55, 0.95, 1], mon: [1, 0.95, 0.75], eau: 0x9ff3ff, arr: 0x2a7f9c, sol: 0x0e3a4c, fond: 0x030b12 },
  umbra: { bas: [0.32, 0.12, 0.48], haut: [1, 0.78, 0.4], mon: [1, 0.9, 1], eau: 0xb67cff, arr: 0x8a6a2a, sol: 0x2a1640, fond: 0x0b0614 }
};

/**
 * Construit la ville. Renvoie { groupe, etiquettes: [{texte, position, classe}], segments }.
 * @param {object} THREE
 * @param {object} d  Données lues par lireParis
 * @param {{mode?: string, verticales?: boolean, masquage?: boolean}} options
 *   masquage : faces sombres opaques (bâtiments et relief) qui cachent les traits situés derrière
 */
export function construireParis(THREE, d, { mode = "tech", verticales = false, masquage = true } = {}) {
  const pal = PALETTES[mode], g = d.entete.relief, ADD = THREE.AdditiveBlending;
  const groupe = new THREE.Group(); let segments = 0;

  // Altitude du sol (m au-dessus de alt0) en un point (coordonnées en m depuis le centre), interpolée dans la grille
  const sol = (x, y) => {
    const fx = Math.max(0, Math.min(g.l - 1.001, (x - g.x0) / g.pas)), fy = Math.max(0, Math.min(g.h - 1.001, (y - g.y0) / g.pas));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, R = d.relief;
    const a = R[j * g.l + i], b = R[j * g.l + i + 1], c = R[(j + 1) * g.l + i], e = R[(j + 1) * g.l + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  // Les bâtiments sont posés sur le terrain (et non sur leur altitude IGN propre) : le toit part du terrain au centre du
  // contour, le pied de chaque mur suit le terrain sous lui, légèrement enfoncé pour ne jamais flotter.
  const ENFONCE = 1.5;
  const baseContour = (c, p, n) => {
    let sx = 0, sy = 0; for ( let j = 0; j < n; j++ ) { sx += c.coords[(p + j) * 2]; sy += c.coords[(p + j) * 2 + 1]; }
    return sol(sx / n, sy / n);
  };
  const P = (x, y, base, h = 0) => [x * K, (base * VR + h * VB) * K, -y * K];  // m → scène (y Lambert = nord → -z)

  function lignes(pos, col, opacite, couleur) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    if ( col ) geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: !!col, color: couleur ?? 0xffffff, transparent: true, opacity: opacite, blending: ADD, depthWrite: false, fog: true });
    segments += pos.length / 6;
    const l = new THREE.LineSegments(geo, mat); l.renderOrder = 1; groupe.add(l); return l;
  }

  // Faces opaques de la couleur du fond : écrivent la profondeur, légèrement repoussées pour que les traits posés dessus restent visibles
  let triangles = 0;
  function faces(pos, index) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if ( index ) geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.MeshBasicMaterial({ color: pal.fond, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 0; groupe.add(m);
    triangles += (index ? index.length : pos.length / 3) / 3;
    return m;
  }

  // Contours extrudés (bâtiments, monuments) : toit à sol + hauteur, arêtes verticales en option
  // Contours IGN remplacés par un modèle détaillé (centre du contour dans le rayon du modèle) : ni traits ni faces
  function exclusions(c) {
    const ex = new Uint8Array(c.nb), mods = MONUMENTS_LIEUX.filter(m => m.rayon);
    let p = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      const n = c.longueurs[i]; let sx = 0, sy = 0;
      for ( let j = 0; j < n; j++ ) { sx += c.coords[(p + j) * 2]; sy += c.coords[(p + j) * 2 + 1]; }
      const x = sx / n, y = sy / n;
      ex[i] = mods.some(m => (x - m.x) ** 2 + (y - m.y) ** 2 <= m.rayon ** 2) ? 1 : 0;
      p += n;
    }
    return ex;
  }

  const exclusPar = new Map();  // calque → contours remplacés par un modèle (aussi ignorés par batimentProche)
  function extrudes(c, couleurs, avecVerticales, opacite) {
    const exclus = exclusions(c); exclusPar.set(c, exclus);
    let segs = 0; for ( let i = 0; i < c.nb; i++ ) if ( !exclus[i] ) segs += c.longueurs[i] * (avecVerticales ? 2 : 1);
    const pos = new Float32Array(segs * 6), col = new Float32Array(segs * 6);
    const debuts = new Uint32Array(c.nb + 1);  // début de chaque contour dans col (recoloration des territoires)
    let k = 0, p = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      debuts[i] = k;
      if ( exclus[i] ) { p += c.longueurs[i]; continue; }
      const n = c.longueurs[i], hh = c.hauteurs[i], t = Math.min(1, hh / 45), z0 = baseContour(c, p, n);
      const [r, gg, b] = couleurs(t);
      for ( let j = 0; j < n; j++ ) {
        const a = (p + j) * 2, bb = (p + (j + 1) % n) * 2;
        pos.set([...P(c.coords[a], c.coords[a + 1], z0, hh), ...P(c.coords[bb], c.coords[bb + 1], z0, hh)], k);
        col.set([r, gg, b, r, gg, b], k); k += 6;
        if ( avecVerticales ) {
          pos.set([...P(c.coords[a], c.coords[a + 1], sol(c.coords[a], c.coords[a + 1]) - ENFONCE), ...P(c.coords[a], c.coords[a + 1], z0, hh)], k);
          col.set([r * 0.3, gg * 0.3, b * 0.3, r, gg, b], k); k += 6;
        }
      }
      p += n;
    }
    debuts[c.nb] = k;
    if ( masquage ) masques(c, exclus);
    const l = lignes(pos, col, opacite);
    l.userData = { debuts, origine: col.slice(), verticales: avecVerticales };
    return l;
  }

  // Toits (triangulés) et murs des contours extrudés
  function masques(c, exclus) {
    const pos = [], idx = []; let p = 0, v = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      if ( exclus?.[i] ) { p += c.longueurs[i]; continue; }
      const n = c.longueurs[i], hh = c.hauteurs[i], z0 = baseContour(c, p, n);
      const contour = [];
      for ( let j = 0; j < n; j++ ) contour.push(new THREE.Vector2(c.coords[(p + j) * 2], c.coords[(p + j) * 2 + 1]));
      // sommets : toit (n) puis pied (n)
      for ( const q of contour ) pos.push(...P(q.x, q.y, z0, hh));
      for ( const q of contour ) pos.push(...P(q.x, q.y, sol(q.x, q.y) - ENFONCE));
      for ( const [a, b, e] of THREE.ShapeUtils.triangulateShape(contour, []) ) idx.push(v + a, v + b, v + e);
      for ( let j = 0; j < n; j++ ) { const k = (j + 1) % n; idx.push(v + j, v + k, v + n + j, v + k, v + n + k, v + n + j); }
      v += 2 * n; p += n;
    }
    faces(new Float32Array(pos), v > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
  }
  const degrade = t => pal.bas.map((v, q) => v + (pal.haut[q] - v) * t);
  const traitsBatiments = extrudes(d.calques.batiments, degrade, verticales, 0.75);
  extrudes(d.calques.monuments, () => pal.mon, true, 0.95);

  // Contours posés sur le relief (eau, arrondissements)
  function draped(c, z, opacite, couleur) {
    const pos = []; let p = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      const n = c.longueurs[i];
      for ( let j = 0; j < n; j++ ) {
        const a = (p + j) * 2, b = (p + (j + 1) % n) * 2;
        const ax = c.coords[a], ay = c.coords[a + 1], bx = c.coords[b], by = c.coords[b + 1];
        pos.push(...P(ax, ay, sol(ax, ay), z), ...P(bx, by, sol(bx, by), z));
      }
      p += n;
    }
    return lignes(pos, null, opacite, couleur);
  }
  draped(d.calques.eau, 0.5, 0.95, pal.eau);
  // Limites des arrondissements : ligne de lumière blanc chaud, halo au sol, rideau de rayons irréguliers, poussières
  // qui montent. Une limite commune à deux arrondissements n'est tracée qu'une fois.
  const LUMIERE = new THREE.Color(0xfff0d0), temps = { value: 0 };
  const segs = [];
  {
    const c = d.calques.arrondissements, vus = new Map(), cle = (x, y) => `${Math.round(x / 40)},${Math.round(y / 40)}`;
    let p = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      const n = c.longueurs[i];
      for ( let j = 0; j < n; j++ ) {
        const a = (p + j) * 2, b = (p + (j + 1) % n) * 2;
        const ax = c.coords[a], ay = c.coords[a + 1], bx = c.coords[b], by = c.coords[b + 1];
        const L = Math.hypot(bx - ax, by - ay); if ( L < 1 ) continue;
        // déjà tracé par l'arrondissement voisin ? (milieu et quarts proches d'un segment existant)
        const pts = [0.25, 0.5, 0.75].map(t => cle(ax + (bx - ax) * t, ay + (by - ay) * t));
        if ( pts.filter(k => vus.has(k)).length >= 2 ) continue;
        pts.forEach(k => vus.set(k, true));
        segs.push([ax, ay, bx, by, L]);
      }
      p += n;
    }
  }
  const vsFaille = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
  const matFaille = (fs, derivees) => new THREE.ShaderMaterial({ uniforms: { t: temps, c: { value: LUMIERE } }, vertexShader: vsFaille,
    fragmentShader: fs, extensions: { derivatives: !!derivees }, blending: ADD, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  {
    const HALO = 40, RIDEAU = 160;  // m : demi-largeur du halo, hauteur du rideau (avant exagération)
    const hp = [], hu = [], hi = [], rp = [], ru = [], ri = []; let s = 0, hv = 0, rv = 0;
    for ( const [ax, ay, bx, by, L] of segs ) {
      const nx = -(by - ay) / L * HALO, ny = (bx - ax) / L * HALO, za = sol(ax, ay), zb = sol(bx, by), u0 = s / 1000, u1 = (s + L) / 1000;
      hp.push(...P(ax + nx, ay + ny, za, 1.5), ...P(ax - nx, ay - ny, za, 1.5), ...P(bx + nx, by + ny, zb, 1.5), ...P(bx - nx, by - ny, zb, 1.5));
      hu.push(u0, 0, u0, 1, u1, 0, u1, 1); hi.push(hv, hv + 1, hv + 2, hv + 1, hv + 3, hv + 2); hv += 4;
      rp.push(...P(ax, ay, za, 0), ...P(ax, ay, za, RIDEAU), ...P(bx, by, zb, 0), ...P(bx, by, zb, RIDEAU));
      ru.push(u0, 0, u0, 1, u1, 0, u1, 1); ri.push(rv, rv + 1, rv + 2, rv + 1, rv + 3, rv + 2); rv += 4;
      s += L;
    }
    const ruban = (pos, uv, idx, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; groupe.add(m);
    };
    ruban(hp, hu, hi, matFaille("uniform vec3 c;varying vec2 vUv;void main(){float d=abs(vUv.y-.5)*2.;"
      + "float a=exp(-d*d*10.)*.45+exp(-d*d*260.)*1.3;gl_FragColor=vec4(c*a,1.);}"));
    ruban(rp, ru, ri, matFaille("uniform vec3 c;uniform float t;varying vec2 vUv;float h1(float n){return fract(sin(n*127.1)*43758.5453);}"
      + "float couche(float x,float h,float g,float presence){float id=floor(x);float f=fract(x);if(h1(id+g)>presence)return 0.;"
      + "float centre=.15+.7*h1(id+g+3.);float larg=.03+.09*h1(id+g+5.);float w=max(larg,fwidth(x)*1.2);float att=larg/w;"
      + "float d=(f-centre)/w;float force=(.3+.7*h1(id+g+9.))*att;float lg=.25+.75*pow(h1(id+g+13.),.7);"
      + "float ond=.7+.3*sin(t*(.4+.5*h1(id+g+17.))+id*2.3);return exp(-d*d*2.)*force*ond*pow(max(0.,1.-h/lg),1.5);}"
      + "void main(){float h=vUv.y;float x=vUv.x*40.;"
      + "float r=couche(x*.6,h,1.,.55)+couche(x*.25+.37,h,31.,.5)*.8+couche(x*1.3+.71,h,67.,.35)*.45;"
      + "gl_FragColor=vec4(c*(r*1.6+pow(1.-h,4.)*.5),1.);}", true));
    // ligne de lumière au ras du sol
    lignes(segs.flatMap(([ax, ay, bx, by]) => [...P(ax, ay, sol(ax, ay), 2), ...P(bx, by, sol(bx, by), 2)]), null, 1, 0xfffaf0).renderOrder = 2;
  }
  // Poussières : naissent sur les limites, montent en dérivant, s'éteignent
  const NP = 5000, total = segs.reduce((a, q) => a + q[4], 0);
  const pp = new Float32Array(NP * 3), age = new Float32Array(NP), vie = new Float32Array(NP);
  const naitre = i => {
    let r = Math.random() * total, q = segs[0];
    for ( const seg of segs ) { r -= seg[4]; if ( r <= 0 ) { q = seg; break; } }
    const t = Math.random(), x = q[0] + (q[2] - q[0]) * t + (Math.random() - 0.5) * 12, y = q[1] + (q[3] - q[1]) * t + (Math.random() - 0.5) * 12;
    pp.set(P(x, y, sol(x, y), Math.random() * 6), i * 3); age[i] = 0; vie[i] = 2.5 + Math.random() * 3.5;
  };
  for ( let i = 0; i < NP; i++ ) { naitre(i); age[i] = Math.random() * vie[i]; }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pp, 3)); pg.setAttribute("age", new THREE.BufferAttribute(age, 1)); pg.setAttribute("vie", new THREE.BufferAttribute(vie, 1));
  const poussieres = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: { c: { value: LUMIERE } },
    vertexShader: "attribute float age;attribute float vie;varying float a;void main(){a=sin(age/vie*3.1416);vec4 mv=modelViewMatrix*vec4(position,1.);"
      + "gl_PointSize=clamp((1.+1.4*a)*(5./-mv.z),1.,4.);gl_Position=projectionMatrix*mv;}",
    fragmentShader: "uniform vec3 c;varying float a;void main(){vec2 p=gl_PointCoord-.5;float d=1.-smoothstep(0.,.5,length(p));gl_FragColor=vec4(c*d*a,1.);}",
    blending: ADD, transparent: true, depthWrite: false }));
  poussieres.renderOrder = 3; groupe.add(poussieres);
  const montee = 0.075;  // unités de scène par seconde (le rideau fait environ 0,3)
  const animer = dt => {
    temps.value += dt;
    for ( let i = 0; i < NP; i++ ) {
      age[i] += dt;
      if ( age[i] > vie[i] ) naitre(i);
      else { pp[i * 3 + 1] += dt * montee; pp[i * 3] += Math.sin(age[i] * 2 + i) * dt * 0.002; }
    }
    pg.attributes.position.needsUpdate = true; pg.attributes.age.needsUpdate = true; pg.attributes.vie.needsUpdate = true;
  };

  // Grille du relief (toutes les 200 m) : montre les buttes
  const pos = [];
  for ( let j = 0; j < g.h; j += 2 ) for ( let i = 0; i + 2 < g.l; i += 2 ) {
    const x = g.x0 + i * g.pas, y = g.y0 + j * g.pas, x2 = x + 2 * g.pas;
    pos.push(...P(x, y, sol(x, y)), ...P(x2, y, sol(x2, y)));
  }
  for ( let i = 0; i < g.l; i += 2 ) for ( let j = 0; j + 2 < g.h; j += 2 ) {
    const x = g.x0 + i * g.pas, y = g.y0 + j * g.pas, y2 = y + 2 * g.pas;
    pos.push(...P(x, y, sol(x, y)), ...P(x, y2, sol(x, y2)));
  }
  lignes(pos, null, 0.35, pal.sol);

  // Sol opaque : la butte cache ce qui est derrière elle
  if ( masquage ) {
    const sp = new Float32Array(g.l * g.h * 3), si = [];
    for ( let j = 0; j < g.h; j++ ) for ( let i = 0; i < g.l; i++ ) {
      const x = g.x0 + i * g.pas, y = g.y0 + j * g.pas; sp.set(P(x, y, d.relief[j * g.l + i] - 1), (j * g.l + i) * 3);
      if ( (i < g.l - 1) && (j < g.h - 1) ) { const a = j * g.l + i; si.push(a, a + 1, a + g.l, a + 1, a + g.l + 1, a + g.l); }
    }
    faces(sp, new Uint32Array(si));
  }

  // Modèles dessinés des monuments les plus reconnaissables
  const etiquettes = [];
  for ( const m of d.entete.monuments ) {
    const base = sol(m.x, m.y);
    const pts = MODELES[m.modele]?.(m.x, m.y, 0) ?? [];  // modèles en hauteur relative, posés sur le relief
    if ( pts.length ) lignes(pts.flatMap(([x, y, z]) => P(x, y, base, z)), null, 1, mode === "tech" ? 0xfff2c0 : 0xffe0ff);
    const haut = { eiffel: 340, "notre-dame": 110, pyramide: 50, "sacre-coeur": 110 }[m.modele] ?? 80;
    etiquettes.push({ texte: m.nom, position: new THREE.Vector3(...P(m.x, m.y, base, haut)), pied: new THREE.Vector3(...P(m.x, m.y, base, 0)), classe: "monument" });
  }
  // Modèles détaillés des lieux de la campagne qui sont de vrais bâtiments (sans étiquette : le repère du lieu la porte)
  for ( const m of MONUMENTS_LIEUX ) {
    const base = sol(m.x, m.y), pts = MODELES_LIEUX[m.modele](m.x, m.y, m.angle ?? 0);
    lignes(pts.flatMap(([x, y, z]) => P(x, y, base, z)), null, 0.95, mode === "tech" ? 0xfff2c0 : 0xffe0ff);
  }
  for ( const a of d.entete.arrondissements ) {
    etiquettes.push({ texte: Number(a.numero) === 1 ? "1er" : `${Number(a.numero)}e`, position: new THREE.Vector3(...P(a.centre[0], a.centre[1], sol(a.centre[0], a.centre[1]), 20)), pied: new THREE.Vector3(...P(a.centre[0], a.centre[1], sol(a.centre[0], a.centre[1]), 0)), classe: "arrondissement" });
  }
  /**
   * Bâtiment (ou monument) le plus proche d'un point, par le centre de son contour.
   * @param {number} x  m depuis le centre des fichiers
   * @param {number} y
   * @param {number} rayon  distance maximale (m)
   * @returns {{calque: string, i: number, distance: number}|null}
   */
  const batimentProche = (x, y, rayon) => {
    // Sur un modèle détaillé, pas de surbrillance d'un volume IGN (le repère prend alors une balise au sol)
    if ( MONUMENTS_LIEUX.some(m => m.rayon && (x - m.x) ** 2 + (y - m.y) ** 2 <= (m.rayon + rayon) ** 2) ) return null;
    let meilleur = null;
    for ( const nom of ["monuments", "batiments"] ) {
      const ix = indexContours(d, nom), r2 = rayon * rayon, ex = exclusPar.get(d.calques[nom]);
      for ( let i = 0; i < ix.nb; i++ ) {
        if ( ex?.[i] ) continue;
        const dx = ix.cx[i] - x, dy = ix.cy[i] - y, d2 = dx * dx + dy * dy;
        if ( (d2 <= r2) && (!meilleur || d2 < meilleur.d2) ) meilleur = { calque: nom, i, d2 };
      }
    }
    return meilleur && { calque: meilleur.calque, i: meilleur.i, distance: Math.sqrt(meilleur.d2) };
  };
  /** Arêtes d'un bâtiment (toit et verticales), en positions de scène : Float32Array de segments */
  const contourBatiment = (nom, i) => {
    const c = d.calques[nom], ix = indexContours(d, nom), p = ix.debut[i], n = c.longueurs[i], hh = c.hauteurs[i];
    const z0 = baseContour(c, p, n), pos = [];
    for ( let j = 0; j < n; j++ ) {
      const a = (p + j) * 2, b = (p + (j + 1) % n) * 2, xa = c.coords[a], ya = c.coords[a + 1];
      pos.push(...P(xa, ya, z0, hh), ...P(c.coords[b], c.coords[b + 1], z0, hh));
      pos.push(...P(xa, ya, sol(xa, ya) - ENFONCE), ...P(xa, ya, z0, hh));
    }
    return { positions: new Float32Array(pos), sommet: new THREE.Vector3(...P(ix.cx[i], ix.cy[i], z0, hh)) };
  };
  /**
   * Surfaces des arrondissements posées sur le relief (calque des territoires) : triangles redécoupés jusqu'à
   * 120 m de côté pour suivre le relief, contour en segments. Coordonnées de texture en mètres / 60 (hachures).
   * @returns {Array<{numero: number, triangles: Float32Array, uv: Float32Array, bord: Float32Array}>}
   */
  const zonesArrondissements = () => {
    const c = d.calques.arrondissements, zones = [], MAX = 120, DESSUS = 3;  // m au-dessus du sol
    let p = 0;
    for ( let i = 0; i < c.nb; i++ ) {
      const n = c.longueurs[i], contour = [];
      for ( let j = 0; j < n; j++ ) contour.push(new THREE.Vector2(c.coords[(p + j) * 2], c.coords[(p + j) * 2 + 1]));
      const tri = [], uv = [], bord = [];
      const decouper = (a, b, e) => {
        const ab = a.distanceTo(b), be = b.distanceTo(e), ea = e.distanceTo(a), m = Math.max(ab, be, ea);
        if ( m <= MAX ) {
          for ( const q of [a, b, e] ) { tri.push(...P(q.x, q.y, sol(q.x, q.y) + DESSUS)); uv.push(q.x / 60, q.y / 60); }
          return;
        }
        if ( m === ab ) { const mm = a.clone().lerp(b, 0.5); decouper(a, mm, e); decouper(mm, b, e); }
        else if ( m === be ) { const mm = b.clone().lerp(e, 0.5); decouper(a, b, mm); decouper(a, mm, e); }
        else { const mm = e.clone().lerp(a, 0.5); decouper(a, b, mm); decouper(mm, b, e); }
      };
      for ( const [a, b, e] of THREE.ShapeUtils.triangulateShape(contour, []) ) decouper(contour[a], contour[b], contour[e]);
      for ( let j = 0; j < n; j++ ) {
        const a = contour[j], b = contour[(j + 1) % n], pas = Math.max(1, Math.ceil(a.distanceTo(b) / 60));
        for ( let k = 0; k < pas; k++ ) {
          const u = a.clone().lerp(b, k / pas), v = a.clone().lerp(b, (k + 1) / pas);
          bord.push(...P(u.x, u.y, sol(u.x, u.y) + DESSUS + 1), ...P(v.x, v.y, sol(v.x, v.y) + DESSUS + 1));
        }
      }
      zones.push({ numero: Number(d.entete.arrondissements[i]?.numero), triangles: new Float32Array(tri), uv: new Float32Array(uv), bord: new Float32Array(bord) });
      p += n;
    }
    return zones;
  };
  /**
   * Teinte le fil de fer des bâtiments par arrondissement (calque des territoires), en gardant le dégradé selon la
   * hauteur : sombre au pied, la couleur pâlie vers le blanc au sommet des tours.
   * @param {Map<number, number[]>|null} couleurs  numéro d'arrondissement → [r, g, b] ; null ou absent = couleur d'origine
   */
  const teinterBatiments = couleurs => {
    const { debuts, origine, verticales: v } = traitsBatiments.userData;
    const attr = traitsBatiments.geometry.getAttribute("color"), col = attr.array;
    col.set(origine);
    if ( couleurs?.size ) {
      const c = d.calques.batiments, arr = arrondissementDesBatiments(d);
      for ( let i = 0; i < c.nb; i++ ) {
        const C = couleurs.get(arr[i]); if ( !C ) continue;
        const t = Math.min(1, c.hauteurs[i] / 45), f = 0.45 + 0.55 * t, w = 0.3 * t;
        const r = (C[0] * (1 - w) + w) * f, g2 = (C[1] * (1 - w) + w) * f, b = (C[2] * (1 - w) + w) * f;
        for ( let k = debuts[i]; k < debuts[i + 1]; k += v ? 12 : 6 ) {
          col.set([r, g2, b, r, g2, b], k);
          if ( v ) col.set([r * 0.3, g2 * 0.3, b * 0.3, r, g2, b], k + 6);
        }
      }
    }
    attr.needsUpdate = true;
  };
  return { groupe, etiquettes, segments, triangles, sol, masquage, animer, batimentProche, contourBatiment, zonesArrondissements, teinterBatiments };
}

/** Index des contours d'un calque : début de chaque contour et centre (calculé une fois par fichier chargé) */
const INDEX = new WeakMap();
function indexContours(d, nom) {
  let parFichier = INDEX.get(d);
  if ( !parFichier ) { parFichier = {}; INDEX.set(d, parFichier); }
  if ( parFichier[nom] ) return parFichier[nom];
  const c = d.calques[nom], nb = c.nb;
  const debut = new Uint32Array(nb), cx = new Float32Array(nb), cy = new Float32Array(nb);
  let p = 0;
  for ( let i = 0; i < nb; i++ ) {
    const n = c.longueurs[i]; let sx = 0, sy = 0;
    for ( let j = 0; j < n; j++ ) { sx += c.coords[(p + j) * 2]; sy += c.coords[(p + j) * 2 + 1]; }
    debut[i] = p; cx[i] = sx / n; cy[i] = sy / n; p += n;
  }
  return (parFichier[nom] = { nb, debut, cx, cy });
}

/**
 * Arrondissement de chaque bâtiment (numéro, 0 si hors de Paris), par le centre de son contour : calculé une fois par
 * fichier chargé (boîte englobante puis point dans le polygone).
 */
const ARR_BATIMENTS = new WeakMap();
function arrondissementDesBatiments(d) {
  if ( ARR_BATIMENTS.has(d) ) return ARR_BATIMENTS.get(d);
  const c = d.calques.arrondissements, polys = [];
  let p = 0;
  for ( let i = 0; i < c.nb; i++ ) {
    const n = c.longueurs[i], xs = new Float32Array(n), ys = new Float32Array(n);
    for ( let j = 0; j < n; j++ ) { xs[j] = c.coords[(p + j) * 2]; ys[j] = c.coords[(p + j) * 2 + 1]; }
    polys.push({ numero: Number(d.entete.arrondissements[i]?.numero) || 0, xs, ys,
      x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    p += n;
  }
  const dedans = (q, x, y) => {
    let r = false;
    for ( let i = 0, j = q.xs.length - 1; i < q.xs.length; j = i++ ) {
      if ( ((q.ys[i] > y) !== (q.ys[j] > y)) && (x < (q.xs[j] - q.xs[i]) * (y - q.ys[i]) / (q.ys[j] - q.ys[i]) + q.xs[i]) ) r = !r;
    }
    return r;
  };
  const ix = indexContours(d, "batiments"), res = new Uint8Array(ix.nb);
  for ( let i = 0; i < ix.nb; i++ ) {
    const x = ix.cx[i], y = ix.cy[i];
    for ( const q of polys ) if ( x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1 && dedans(q, x, y) ) { res[i] = q.numero; break; }
  }
  ARR_BATIMENTS.set(d, res);
  return res;
}

/* -------------------------------------------- */
/*  Modèles : listes de segments [x, y, z] en m  */
/* -------------------------------------------- */

/** Rotation autour de (cx, cy) */
const tourne = (cx, cy, a) => (x, y) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];

const MODELES = {
  eiffel(cx, cy, z0) {
    const s = [], R = tourne(cx, cy, -0.04);
    // demi-diagonale de la tour selon la hauteur (pieds à 88 m du centre au sol, sommet à 330 m)
    const profil = [[0, 88], [57, 52], [115, 27], [180, 15], [276, 6], [300, 2.5]];
    const r = z => { for ( let i = 1; i < profil.length; i++ ) if ( z <= profil[i][0] ) {
      const [z1, r1] = profil[i - 1], [z2, r2] = profil[i]; return r1 + (r2 - r1) * (z - z1) / (z2 - z1); } return 2.5; };
    const coin = (k, z) => { const a = k * Math.PI / 2, rr = r(z); return [...R(Math.cos(a) * rr, Math.sin(a) * rr), z0 + z]; };
    const niveaux = [0, 20, 39, 57, 75, 95, 115, 145, 180, 215, 250, 276, 300];
    for ( let k = 0; k < 4; k++ ) {
      for ( let i = 1; i < niveaux.length; i++ ) {
        const a = niveaux[i - 1], b = niveaux[i];
        s.push(coin(k, a), coin(k, b));                              // arêtes
        s.push(coin(k, a), coin((k + 1) % 4, b), coin((k + 1) % 4, a), coin(k, b));  // croisillons
      }
      for ( const z of [57, 115, 276] ) s.push(coin(k, z), coin((k + 1) % 4, z));     // plateformes
      // arche entre deux pieds
      for ( let i = 0; i < 12; i++ ) {
        const t1 = i / 12, t2 = (i + 1) / 12;
        const arc = t => { const p = coin(k, 0), q = coin((k + 1) % 4, 0), m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
          return [m[0] + (x - m[0]) * 0.86, m[1] + (y - m[1]) * 0.86, z0 + 8 + 31 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) * 2, 2)))]; };
        s.push(arc(t1), arc(t2));
      }
    }
    s.push([cx, cy, z0 + 300], [cx, cy, z0 + 330]);                  // antenne
    return s;
  },

  "notre-dame"(cx, cy, z0) {
    const s = [], R = tourne(cx, cy, -0.36);  // nef orientée ouest-nord-ouest → est-sud-est
    const boite = (x1, y1, x2, y2, h1, h2) => {
      const c = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => R(x, y));
      for ( let i = 0; i < 4; i++ ) { const a = c[i], b = c[(i + 1) % 4];
        s.push([...a, z0 + h2], [...b, z0 + h2], [...a, z0 + h1], [...a, z0 + h2]); }
    };
    boite(-62, 8, -50, 20, 0, 69); boite(-62, -20, -50, -8, 0, 69);  // tours de la façade
    boite(-62, -8, -50, 8, 0, 45);                                    // pignon entre les tours
    const flèche = R(14, 0);
    for ( let k = 0; k < 8; k++ ) { const a = k * Math.PI / 4, b = R(14 + Math.cos(a) * 4, Math.sin(a) * 4);
      s.push([...b, z0 + 33], [...flèche, z0 + 96]); }
    return s;
  },

  pyramide(cx, cy, z0) {
    const s = [], px = 651262 - 652000, py = 6862545 - 6862000, R = tourne(px, py, -0.04);  // pyramide de la cour Napoléon
    const c = [[-17.5, -17.5], [17.5, -17.5], [17.5, 17.5], [-17.5, 17.5]].map(([x, y]) => R(x, y)), sommet = [px, py, z0 + 21.6];
    for ( let i = 0; i < 4; i++ ) {
      s.push([...c[i], z0], [...c[(i + 1) % 4], z0], [...c[i], z0], sommet);
      for ( let k = 1; k < 5; k++ ) { const t = k / 5;  // treillis de la verrière
        const a = c[i], b = c[(i + 1) % 4], p = (q, t2) => [q[0] + (sommet[0] - q[0]) * t2, q[1] + (sommet[1] - q[1]) * t2, z0 + 21.6 * t2];
        s.push(p(a, t), p(b, t)); }
    }
    return s;
  },

  "sacre-coeur"(cx, cy, z0) {
    const s = [];
    const dome = (x, y, r, zb, zh, n = 10) => {
      for ( let k = 0; k < n; k++ ) { const a = k / n * Math.PI * 2;
        for ( let i = 0; i < 8; i++ ) { const t1 = i / 8 * Math.PI / 2, t2 = (i + 1) / 8 * Math.PI / 2;
          s.push([x + Math.cos(a) * r * Math.cos(t1), y + Math.sin(a) * r * Math.cos(t1), zb + (zh - zb) * Math.sin(t1)],
                 [x + Math.cos(a) * r * Math.cos(t2), y + Math.sin(a) * r * Math.cos(t2), zb + (zh - zb) * Math.sin(t2)]); } }
      for ( let k = 0; k < n; k++ ) { const a = k / n * Math.PI * 2, b = (k + 1) / n * Math.PI * 2;
        s.push([x + Math.cos(a) * r, y + Math.sin(a) * r, zb], [x + Math.cos(b) * r, y + Math.sin(b) * r, zb]); }
    };
    dome(cx, cy, 16, z0 + 48, z0 + 80, 14);                       // grand dôme
    s.push([cx, cy, z0 + 80], [cx, cy, z0 + 92]);                  // lanterne
    for ( const [dx, dy] of [[-22, -18], [22, -18], [-22, 18], [22, 18]] ) dome(cx + dx, cy + dy, 6, z0 + 30, z0 + 44, 8);
    s.push([cx, cy + 45, z0], [cx, cy + 45, z0 + 94]);             // campanile
    return s;
  }
};
