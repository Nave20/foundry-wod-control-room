/**
 * Calque « Territoires » de l'hologramme : le fil de fer des bâtiments de chaque arrondissement prend la couleur du camp
 * (ou de la faction) qui le tient, avec un liseré et un rideau lumineux le long des limites.
 * Éteint par défaut (la carte garde son dégradé bleu d'origine) ; deux modes une fois allumé :
 * - simplifié : rouge vampires, bleu indigo mages, vert garous, gris Technocratie ;
 * - détaillé : la couleur de la faction la plus présente du camp gagnant, d'après « Paris occulte ».
 * Règle de contrôle : voir territoires.mjs.
 */
import { territoires, CAMPS } from "./territoires.mjs";

export const MODES = { off: "Territoires", simple: "Territoires : simplifié", detail: "Territoires : détaillé" };
const ORDRE_MODES = ["off", "simple", "detail"];
export const modeSuivant = m => ORDRE_MODES[(ORDRE_MODES.indexOf(m) + 1) % ORDRE_MODES.length];

/** Hauteur du rideau lumineux des limites (unités de scène : 1 = 1 km) */
const RIDEAU = 0.045;

const echapper = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export class CalqueTerritoires {
  constructor(THREE, scene, conteneur) {
    this.THREE = THREE; this.scene = scene; this.conteneur = conteneur;
    this.groupe = new THREE.Group(); scene.add(this.groupe);
    this.legende = null;
    this.ville = null;         // ville dont le fil de fer est teinté
    this.parArr = {};          // numéro → { nom, couleur }
  }

  /** Couleur lisible sur fond sombre */
  #couleur(hex) {
    const c = new this.THREE.Color(/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : CAMPS.autre.couleur);
    const hsl = {}; c.getHSL(hsl);
    if ( hsl.l < 0.5 ) c.setHSL(hsl.h, hsl.s, 0.5);
    return c;
  }

  vider() {
    this.groupe.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.groupe.clear();
    this.ville?.teinterBatiments?.(null);
    this.ville = null;
    this.parArr = {};
    this.legende?.remove(); this.legende = null;
  }

  detruire() {
    this.vider();
    this.scene.remove(this.groupe);
  }

  /**
   * @param {object} carte  carte courante (complète pour le MJ, filtrée pour les joueurs)
   * @param {object} ville  ville construite (zonesArrondissements, teinterBatiments)
   * @param {"off"|"simple"|"detail"} mode
   */
  construire(carte, ville, mode) {
    this.vider();
    if ( mode === "off" || !ville || !carte ) return;
    // Copie des joueurs : le camp réel est fourni par le MJ (carte.territoires) ; carte complète : calculé ici
    const T = this.THREE, factions = carte.factions ?? {}, t = carte.complete ? territoires(carte) : (carte.territoires ?? territoires(carte));
    const presents = new Map(), teintes = new Map();  // clé de légende → { nom, couleur } ; numéro → [r, g, b]
    for ( const z of ville.zonesArrondissements() ) {
      const tn = t[String(z.numero)]; if ( !tn ) continue;
      const fac = factions[tn.faction], cp = CAMPS[tn.camp] ?? CAMPS.autre;
      const couleur = this.#couleur(mode === "simple" ? cp.couleur : (fac?.couleur ?? cp.couleur));
      const nom = mode === "simple" ? cp.nom : (fac?.nom ?? tn.faction);
      presents.set(mode === "simple" ? tn.camp : tn.faction, { nom, couleur: `#${couleur.getHexString()}` });
      this.parArr[z.numero] = { nom, couleur };
      teintes.set(z.numero, [couleur.r, couleur.g, couleur.b]);
      // Liseré
      const gb = new T.BufferGeometry(); gb.setAttribute("position", new T.BufferAttribute(z.bord, 3));
      const lis = new T.LineSegments(gb, new T.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.85,
        blending: T.AdditiveBlending, depthWrite: false }));
      lis.renderOrder = 2; this.groupe.add(lis);
      // Rideau lumineux bas le long de la limite (couleur en bas, noir en haut : invisible en mélange additif)
      const b = z.bord, nb = b.length / 6, pos = new Float32Array(nb * 18), col = new Float32Array(nb * 18);
      for ( let k = 0; k < nb; k++ ) {
        const o = k * 6, ax = b[o], ay = b[o + 1], az = b[o + 2], bx = b[o + 3], by = b[o + 4], bz = b[o + 5];
        pos.set([ax, ay, az, bx, by, bz, bx, by + RIDEAU, bz, ax, ay, az, bx, by + RIDEAU, bz, ax, ay + RIDEAU, az], k * 18);
        const c0 = [couleur.r, couleur.g, couleur.b], c1 = [0, 0, 0];
        col.set([...c0, ...c0, ...c1, ...c0, ...c1, ...c1], k * 18);
      }
      const gr = new T.BufferGeometry();
      gr.setAttribute("position", new T.BufferAttribute(pos, 3)); gr.setAttribute("color", new T.BufferAttribute(col, 3));
      const rideau = new T.Mesh(gr, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8,
        blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      rideau.renderOrder = 2; this.groupe.add(rideau);
    }
    ville.teinterBatiments?.(teintes);
    this.ville = ville;
    this.#legende(presents, mode);
  }

  #legende(presents, mode) {
    if ( !presents.size ) return;
    const el = document.createElement("div");
    el.className = "holo-legende";
    const lignes = [...presents.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .map(p => `<li><span class="echantillon" style="--c:${p.couleur}"></span>${echapper(p.nom)}</li>`).join("");
    el.innerHTML = `<div class="titre">${mode === "simple" ? "Territoires" : "Territoires (détail)"}</div><ul>${lignes}</ul>`;
    this.conteneur.appendChild(el);
    this.legende = el;
  }

  /** Bulle des pastilles d'arrondissement : « 18e : Conseil de Paris » quand le calque est allumé */
  titrer(etiquettes) {
    for ( const e of etiquettes ) {
      if ( !e.el.classList.contains("arrondissement") ) continue;
      const info = this.parArr[parseInt(e.el.textContent, 10)];
      e.el.title = info ? `${e.el.textContent} : ${info.nom}` : "";
      e.el.style.setProperty("--territoire", info ? `#${info.couleur.getHexString()}` : "");
      e.el.classList.toggle("avec-territoire", !!info);
    }
  }
}
