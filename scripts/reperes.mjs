/**
 * Calque « repères » de l'hologramme : les lieux de « Paris occulte » posés sur la carte.
 *
 * - Un lieu allume le vrai bâtiment (ou monument) le plus proche de ses coordonnées, à la couleur de sa faction ;
 *   s'il n'y a pas de bâtiment à moins de 40 m, une balise au sol le remplace.
 * - Un siège qui a des portes (le Royaume du Conseil) est un royaume superposé : un anneau lumineux en hauteur,
 *   relié par un faisceau à chacune de ses portes. La hauteur code le caché : au sol le visible, en l'air le superposé.
 * - L'ascenseur de la Sérénité n'a pas de balise au sol : son repère est le dirigeable lui-même, amarré en hauteur
 *   au-dessus de la coupole des Galeries Lafayette, avec la colonne de l'ascenseur et sa cabine qui monte.
 * - Chaque lieu a une étiquette (icône, nom quand on est assez près) ; un clic ouvre sa fiche et centre la vue.
 * - Le MJ voit aussi les lieux non révélés (en pointillés) ; les joueurs ne les reçoivent pas du tout (voir carte.mjs).
 */
import { segmentsPalais, HAUT_PALAIS } from "./palais.mjs";
import { segmentsSerenite, segmentsCabine, BAS_NACELLE } from "./serenite.mjs";
import { versCarte } from "./geo.mjs";
import { VR } from "./paris-hologram.mjs";

/** Distance maximale entre un lieu et le centre du bâtiment allumé (m) */
const RAYON_BATIMENT = 40;
/** En deçà de cette distance de caméra, les noms des lieux s'affichent */
const DISTANCE_NOMS = 2.4;
/** Hauteur de l'anneau d'un royaume au-dessus du sol (unités de scène, 1 = 1 km) */
const HAUTEUR_ROYAUME = 0.45, RAYON_ROYAUME = 0.37;
/**
 * Échelle du palais du Conseil, fixe : ses coins (demi-diagonale 3,45 unités → 0,31) tiennent à l'intérieur de
 * l'anneau doré (bord intérieur 0,93 × 0,37 ≈ 0,34)
 */
const ECHELLE_PALAIS = 0.3 / 3.3;
/** La Sérénité : lieu porteur, hauteur de l'axe de l'enveloppe, échelle (modèle de 10 de long → 350 m, exagéré) */
const ID_SERENITE = "ascenseur-serenite", HAUTEUR_SERENITE = 0.42, ECHELLE_SERENITE = 0.035;
/** Abscisse (unités du modèle) du salon sous la proue, où arrive l'ascenseur */
const SALON_SERENITE = -2.5;
/** Couleurs du royaume du Conseil : fil de fer bleu pâle, laiton doré */
const COULEUR_FIL = "#bff6ff", COULEUR_OR = "#ffd27a";

export const TYPES = {
  siege: { nom: "Siège", icone: "fa-landmark" },
  node: { nom: "Node", icone: "fa-gem" },
  refuge: { nom: "Refuge", icone: "fa-house-chimney" },
  acces: { nom: "Accès", icone: "fa-door-open" },
  porte: { nom: "Porte", icone: "fa-archway" },
  usine: { nom: "Usine", icone: "fa-industry" },
  evenement: { nom: "Événement", icone: "fa-star" },
  autre: { nom: "Lieu", icone: "fa-location-dot" }
};

const echapper = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paragraphes = t => echapper(t).split(/\n+/).filter(Boolean).map(p => `<p>${p}</p>`).join("");

export class CalqueReperes {
  /**
   * @param {object} THREE
   * @param {object} scene      scène Three.js
   * @param {HTMLElement} conteneur  zone de la scène (étiquettes, fiche, liste)
   * @param {{selection: function(object): void}} rappels  selection(repere) : centrer la vue
   */
  constructor(THREE, scene, conteneur, rappels) {
    this.THREE = THREE; this.scene = scene; this.conteneur = conteneur; this.rappels = rappels;
    this.groupe = new THREE.Group(); this.groupe.renderOrder = 3; scene.add(this.groupe);
    this.reperes = [];
    this.anneaux = [];
    this.cabines = [];   // { m, bas, haut } : cabines d'ascenseur qui montent en boucle
    this.selection = null;
    this.carte = null;
    this.fiche = null;
    this.liste = null;
  }

  /** Couleur lisible sur le fond sombre (les couleurs de faction très foncées sont éclaircies) */
  #couleur(hex) {
    const c = new this.THREE.Color(/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : "#9ff3ff");
    const hsl = {}; c.getHSL(hsl);
    if ( hsl.l < 0.58 ) c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), 0.58);
    return c;
  }

  #materiau(couleur, opacite) {
    return new this.THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: opacite, blending: this.THREE.AdditiveBlending, depthWrite: false });
  }

  #maille(geo, couleur, opacite) {
    return new this.THREE.Mesh(geo, new this.THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: opacite,
      blending: this.THREE.AdditiveBlending, depthWrite: false, side: this.THREE.DoubleSide }));
  }

  /** Cylindre fin entre deux points (faisceau) */
  #faisceau(a, b, rayon, couleur, opacite) {
    const T = this.THREE, dir = new T.Vector3().subVectors(b, a), long = dir.length();
    const m = this.#maille(new T.CylinderGeometry(rayon, rayon, long, 6, 1, true), couleur, opacite);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /** Vide le calque (géométries, matériaux, étiquettes) */
  vider() {
    this.groupe.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.groupe.clear();
    for ( const r of this.reperes ) r.etiquette.remove();
    this.reperes = []; this.anneaux = []; this.cabines = [];
  }

  detruire() {
    this.vider();
    this.scene.remove(this.groupe);
    this.fiche?.remove(); this.liste?.remove();
  }

  /**
   * (Re)construit les repères.
   * @param {object} carte  carte courante (carte.mjs) : lieux, factions, complete (vue du MJ)
   * @param {object} ville  ville construite (sol, batimentProche, contourBatiment)
   */
  construire(carte, ville) {
    this.vider();
    this.carte = carte;
    if ( !ville || !carte?.lieux ) return;
    const T = this.THREE, factions = carte.factions ?? {};
    const sol = (x, y) => ville.sol(x, y) * VR / 1000;
    const lieux = Object.entries(carte.lieux).map(([id, l]) => ({ id, ...l }));
    // Royaumes : sièges dont la faction a des portes
    const portesPar = {};
    for ( const l of lieux ) if ( l.type === "porte" && l.faction ) (portesPar[l.faction] ??= []).push(l);
    const royaumes = new Set(lieux.filter(l => l.type === "siege" && portesPar[l.faction]).map(l => l.id));

    for ( const l of lieux ) {
      const [x, y] = versCarte(l.lon, l.lat), z = sol(x, y);
      const pied = new T.Vector3(x / 1000, z, -y / 1000);
      const couleur = this.#couleur(factions[l.faction]?.couleur);
      const cache = carte.complete && !l.pj;
      const op = cache ? 0.45 : 1;
      const r = { id: l.id, lieu: l, pied, couleur, cache, objets: [], ancre: null, pulsation: [] };

      if ( l.id === ID_SERENITE ) {
        // Dirigeable amarré en hauteur ; le salon (sous la proue) est à l'aplomb de l'ascenseur
        const s = ECHELLE_SERENITE, or = new T.Color(COULEUR_OR);
        const axe = pied.clone().setY(z + HAUTEUR_SERENITE);
        const centre = axe.clone(); centre.x -= SALON_SERENITE * s;
        const gs = new T.BufferGeometry(); gs.setAttribute("position", new T.BufferAttribute(segmentsSerenite(), 3));
        const nef = new T.LineSegments(gs, new T.LineBasicMaterial({ color: new T.Color(COULEUR_FIL), transparent: true,
          opacity: 0.8 * op, blending: T.AdditiveBlending, depthWrite: false }));
        nef.scale.setScalar(s); nef.position.copy(centre); nef.renderOrder = 3;
        this.groupe.add(nef); r.objets.push(nef);
        // Colonne de l'ascenseur (sans câble : un faisceau de laiton) et cabine qui monte
        const haut = axe.clone().setY(axe.y + BAS_NACELLE * s);
        const col = this.#faisceau(pied, haut, 0.0025, or, 0.5 * op); this.groupe.add(col); r.pulsation.push({ m: col, base: 0.5 * op });
        const gc = new T.BufferGeometry(); gc.setAttribute("position", new T.BufferAttribute(segmentsCabine(), 3));
        const cabine = new T.LineSegments(gc, this.#materiau(or, op)); cabine.scale.setScalar(0.014); cabine.position.copy(pied);
        this.groupe.add(cabine); this.cabines.push({ m: cabine, bas: pied.y, haut: haut.y - 0.014 });
        r.ancre = centre.clone().setY(axe.y + 1.25 * s + 0.03);
        // La vue se centre au milieu du dirigeable (entre le dessous de la nacelle et le haut de l'enveloppe)
        r.vue = centre.clone().setY(axe.y + (BAS_NACELLE + 1.25) / 2 * s);
      } else if ( royaumes.has(l.id) ) {
        // Royaume superposé : anneau double en hauteur, faisceau central fin vers le sol
        const centre = pied.clone().setY(z + HAUTEUR_ROYAUME);
        const or = new T.Color("#ffd27a");
        const a1 = this.#maille(new T.RingGeometry(RAYON_ROYAUME * 0.93, RAYON_ROYAUME, 96), or, 0.85 * op);
        const a2 = this.#maille(new T.RingGeometry(RAYON_ROYAUME * 0.62, RAYON_ROYAUME * 0.66, 6), couleur, 0.7 * op);
        for ( const a of [a1, a2] ) { a.rotation.x = -Math.PI / 2; a.position.copy(centre); this.groupe.add(a); }
        this.anneaux.push(a2);
        const voile = this.#maille(new T.CircleGeometry(RAYON_ROYAUME, 64), or, 0.08 * op);
        voile.rotation.x = -Math.PI / 2; voile.position.copy(centre); this.groupe.add(voile);
        this.groupe.add(this.#faisceau(pied, centre, 0.002, or, 0.5 * op));
        // Palais classique en fil de fer posé sur l'anneau
        const gp = new T.BufferGeometry(); gp.setAttribute("position", new T.BufferAttribute(segmentsPalais(), 3));
        const palais = new T.LineSegments(gp, new T.LineBasicMaterial({ color: new T.Color("#bff6ff"), transparent: true,
          opacity: 0.8 * op, blending: T.AdditiveBlending, depthWrite: false }));
        palais.scale.setScalar(ECHELLE_PALAIS); palais.position.copy(centre).setY(centre.y + 0.002); palais.renderOrder = 3;
        this.groupe.add(palais); r.objets.push(palais);
        // Un faisceau vers chaque porte connue de ce client
        for ( const p of portesPar[l.faction] ) {
          const [px, py] = versCarte(p.lon, p.lat), bas = new T.Vector3(px / 1000, sol(px, py), -py / 1000);
          const dir = new T.Vector3(bas.x - centre.x, 0, bas.z - centre.z).normalize();
          const haut = centre.clone().addScaledVector(dir, RAYON_ROYAUME);
          const f = this.#faisceau(bas, haut, 0.0025, or, 0.75 * (carte.complete && !p.pj ? 0.45 : 1));
          this.groupe.add(f); r.pulsation.push({ m: f, base: f.material.opacity });
        }
        r.ancre = centre.clone().setY(centre.y + HAUT_PALAIS * ECHELLE_PALAIS + 0.03);
        r.vue = centre.clone().setY(centre.y + 1.5 * ECHELLE_PALAIS);  // la vue se centre sur l'anneau, pas sur le sol
      } else {
        const bat = (l.type !== "porte") ? ville.batimentProche(x, y, RAYON_BATIMENT) : null;
        if ( bat ) {
          const { positions, sommet } = ville.contourBatiment(bat.calque, bat.i);
          const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(positions, 3));
          const lignes = new T.LineSegments(geo, this.#materiau(couleur, op)); lignes.renderOrder = 3;
          this.groupe.add(lignes); r.pulsation.push({ m: lignes, base: op });
          r.ancre = sommet.clone().setY(sommet.y + 0.03);
        } else {
          // Balise : anneau au sol et tige courte
          const anneau = this.#maille(new T.RingGeometry(0.018, 0.024, 32), couleur, 0.9 * op);
          anneau.rotation.x = -Math.PI / 2; anneau.position.copy(pied).setY(z + 0.002); this.groupe.add(anneau);
          const tige = this.#faisceau(pied, pied.clone().setY(z + 0.12), 0.0018, couleur, 0.9 * op);
          this.groupe.add(tige); r.pulsation.push({ m: anneau, base: 0.9 * op });
          r.ancre = pied.clone().setY(z + 0.13);
        }
      }
      r.vue ??= r.ancre.clone().setY(pied.y);  // point regardé quand on choisit ce lieu
      r.etiquette = this.#etiquette(r);
      this.reperes.push(r);
    }
    this.#majListe();
    if ( this.selection && !this.reperes.some(r => r.id === this.selection) ) this.fermerFiche();
    else if ( this.selection ) this.ouvrirFiche(this.selection, { centrer: false });
  }

  #etiquette(r) {
    const el = document.createElement("div");
    el.className = `holo-etiquette repere${r.cache ? " cache" : ""}`;
    el.dataset.id = r.id;
    el.style.setProperty("--faction", `#${r.couleur.getHexString()}`);
    el.innerHTML = `<i class="fa-solid ${(TYPES[r.lieu.type] ?? TYPES.autre).icone}" inert></i><span class="nom"></span>${r.cache ? '<i class="fa-solid fa-eye-slash cache-icone" inert></i>' : ""}`;
    el.querySelector(".nom").textContent = r.lieu.nom;
    el.title = r.lieu.nom;
    el.addEventListener("click", ev => { ev.stopPropagation(); this.ouvrirFiche(r.id); });
    this.conteneur.appendChild(el);
    return el;
  }

  /** Fiche d'un lieu (et centrage de la vue) */
  ouvrirFiche(id, { centrer = true } = {}) {
    const r = this.reperes.find(x => x.id === id); if ( !r ) return;
    this.selection = id;
    for ( const x of this.reperes ) x.etiquette.classList.toggle("choisi", x.id === id);
    const l = r.lieu, f = this.carte.factions?.[l.faction], t = TYPES[l.type] ?? TYPES.autre;
    this.fiche ??= Object.assign(document.createElement("aside"), { className: "holo-fiche" });
    if ( !this.fiche.isConnected ) this.conteneur.appendChild(this.fiche);
    this.fiche.style.setProperty("--faction", `#${r.couleur.getHexString()}`);
    const complet = this.carte.complete;
    this.fiche.innerHTML = `<header><i class="fa-solid ${t.icone}" inert></i><h3>${echapper(l.nom)}</h3>
        <button type="button" class="fermer" aria-label="Fermer"><i class="fa-solid fa-xmark" inert></i></button></header>
      <div class="meta">${echapper(t.nom)}${f ? ` · <span class="pastille-faction"></span>${echapper(f.nom)}` : ""}${l.arr ? ` · ${l.arr === 1 ? "1er" : `${l.arr}e`} arr.` : ""}</div>
      ${r.cache ? '<div class="alerte"><i class="fa-solid fa-eye-slash" inert></i> Non révélé aux joueurs</div>' : ""}
      ${complet ? `<h4>Texte des joueurs</h4>${paragraphes(l.texte_joueurs) || '<p class="vide">(aucun)</p>'}<h4>Notes du MJ</h4>${paragraphes(l.texte) || '<p class="vide">(aucune)</p>'}`
        : (paragraphes(l.texte) || '<p class="vide">Pas de description.</p>')}`;
    this.fiche.querySelector(".fermer").addEventListener("click", () => this.fermerFiche());
    if ( centrer ) this.rappels.selection?.(r);
  }

  fermerFiche() {
    this.selection = null;
    this.fiche?.remove();
    for ( const x of this.reperes ) x.etiquette.classList.remove("choisi");
  }

  /** Liste des lieux : recherche, filtres par type et par faction */
  basculerListe() {
    if ( this.liste?.isConnected ) { this.liste.remove(); return false; }
    this.liste ??= this.#creerListe();
    this.conteneur.appendChild(this.liste);
    this.#majListe();
    this.liste.querySelector("input").focus();
    return true;
  }

  #creerListe() {
    const el = document.createElement("aside");
    el.className = "holo-lieux";
    el.innerHTML = `<input type="search" placeholder="Chercher un lieu" aria-label="Chercher un lieu">
      <div class="filtres"><select data-filtre="type" aria-label="Type"></select><select data-filtre="faction" aria-label="Faction"></select></div>
      <ul></ul><div class="compte"></div>`;
    el.addEventListener("input", () => this.#majListe());
    el.addEventListener("pointerdown", ev => ev.stopPropagation());
    el.addEventListener("wheel", ev => ev.stopPropagation());
    return el;
  }

  #majListe() {
    const el = this.liste; if ( !el?.isConnected || !this.carte ) return;
    const sType = el.querySelector("[data-filtre=type]"), sFac = el.querySelector("[data-filtre=faction]");
    const choixType = sType.value, choixFac = sFac.value;
    const factions = this.carte.factions ?? {};
    const presents = new Set(this.reperes.map(r => r.lieu.faction).filter(Boolean));
    sType.innerHTML = `<option value="">Type : tous</option>${Object.entries(TYPES).filter(([k]) => this.reperes.some(r => r.lieu.type === k))
      .map(([k, t]) => `<option value="${k}">${echapper(t.nom)}</option>`).join("")}`;
    sFac.innerHTML = `<option value="">Faction : toutes</option>${[...presents].sort((a, b) => (factions[a]?.nom ?? a).localeCompare(factions[b]?.nom ?? b, "fr"))
      .map(k => `<option value="${echapper(k)}">${echapper(factions[k]?.nom ?? k)}</option>`).join("")}`;
    sType.value = choixType; sFac.value = choixFac;
    const q = el.querySelector("input").value.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const norm = t => String(t ?? "").toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const vus = this.reperes.filter(r => (!sType.value || r.lieu.type === sType.value) && (!sFac.value || r.lieu.faction === sFac.value)
      && (!q || norm(r.lieu.nom).includes(q) || norm(r.lieu.texte).includes(q) || norm(r.lieu.texte_joueurs).includes(q)))
      .sort((a, b) => a.lieu.nom.localeCompare(b.lieu.nom, "fr"));
    const ul = el.querySelector("ul"); ul.replaceChildren();
    for ( const r of vus ) {
      const li = document.createElement("li");
      li.className = r.cache ? "cache" : "";
      li.style.setProperty("--faction", `#${r.couleur.getHexString()}`);
      li.innerHTML = `<i class="fa-solid ${(TYPES[r.lieu.type] ?? TYPES.autre).icone}" inert></i><span></span>${r.cache ? '<i class="fa-solid fa-eye-slash" inert></i>' : ""}`;
      li.querySelector("span").textContent = r.lieu.nom;
      li.addEventListener("click", () => this.ouvrirFiche(r.id));
      ul.appendChild(li);
    }
    el.querySelector(".compte").textContent = `${vus.length} lieu${vus.length > 1 ? "x" : ""} sur ${this.reperes.length}`;
  }

  /** À chaque image : pulsation, rotation des anneaux, position des étiquettes */
  animer(C, w, h, v, dist) {
    const t = performance.now() / 1000;
    for ( const a of this.anneaux ) a.rotation.z = t * 0.25;
    for ( const c of this.cabines ) c.m.position.y = c.bas + (c.haut - c.bas) * ((t / 6) % 1);
    this.conteneur.classList.toggle("reperes-proches", dist < DISTANCE_NOMS);
    for ( const r of this.reperes ) {
      for ( const p of r.pulsation ) p.m.material.opacity = p.base * (0.78 + 0.22 * Math.sin(t * 2.2 + r.pied.x * 7));
      v.copy(r.ancre).project(C);
      r.etiquette.hidden = !this.groupe.visible || v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
      r.etiquette.style.left = `${(v.x + 1) / 2 * w}px`; r.etiquette.style.top = `${(1 - v.y) / 2 * h}px`;
    }
  }
}
