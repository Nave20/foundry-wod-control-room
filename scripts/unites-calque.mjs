/**
 * Calque des unités sur l'hologramme (étape 4, décision D7 et maquettes validées par le MJ le 14/11/2026) :
 * au-dessus de chaque lieu occupé, un symbole d'état-major par groupe, avec le nombre d'unités en pastille.
 * Plein pour les unités déployées, pointillé et pâle pour les unités à résidence. Au survol : la liste des unités
 * (insigne, nom, statut, puissance, « Rappeler » pour le MJ) ; clic : le panneau ouvre ce groupe.
 * Les symboles restent visibles quand les repères sont masqués ; le bouton « Unités » les masque.
 */
import { regrouper, couleurGroupe } from "./deploiement.mjs";
import { svgInsigne } from "./insignes.mjs";
import { rappeler } from "./units-panel.mjs";

const STATUTS = { disponible: "Disponible", engage: "Engagée", blesse: "Indisponible", perdu: "Perdue", absent: "À gagner", vide: "Vide" };
const echapper = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Motif intérieur du symbole d'état-major, par groupe (croix des Rédempteurs, trait des Alliés, diagonale sinon) */
const MOTIFS = {
  "Rédempteurs": '<path d="M1 1l44 32M45 1L1 33"/>',
  "Alliés du Conseil": '<path d="M1 17h44"/>'
};
const MOTIF_AUTRE = '<path d="M1 33L45 1"/>';

function symbole(groupe, couleur, residence) {
  const pointille = residence ? ' stroke-dasharray="3 2"' : "";
  return `<svg width="46" height="34" viewBox="0 0 46 34" fill="none" stroke="${couleur}" stroke-width="1.4"${pointille} aria-hidden="true">`
    + `<rect x="1" y="1" width="44" height="32"/>${MOTIFS[groupe] ?? MOTIF_AUTRE}</svg>`;
}

export class CalqueUnites {
  /**
   * @param {HTMLElement} conteneur  scène de l'hologramme
   * @param {{montrerGroupe: (groupe: string) => void}} rappels
   */
  constructor(conteneur, rappels) {
    this.conteneur = conteneur; this.rappels = rappels;
    this.piles = [];        // { ancre: Vector3, el }
    this.visible = true;
  }

  /** Reconstruit les symboles à partir des unités et des repères construits (r.id, r.lieu, r.ancre) */
  maj(unites, reperes) {
    for ( const p of this.piles ) p.el.remove();
    this.piles = [];
    const parId = new Map((reperes ?? []).map(r => [r.id, r]));
    const lieux = Object.fromEntries([...parId].map(([id, r]) => [id, r.lieu]));
    for ( const [lieuId, groupes] of regrouper(unites, lieux) ) {
      const r = parId.get(lieuId); if ( !r?.ancre ) continue;
      const el = document.createElement("div"); el.className = "holo-unites-pile";
      for ( const e of groupes ) el.append(this.#symbole(e, r.lieu, unites));
      this.conteneur.appendChild(el);
      this.piles.push({ ancre: r.ancre, el });
    }
  }

  #symbole({ groupe, etat, ids }, lieu, unites) {
    const couleur = couleurGroupe(groupe), residence = etat === "residence";
    const el = document.createElement("div");
    el.className = `holo-unite${residence ? " residence" : ""}`;
    el.style.setProperty("--g", couleur);
    const lignes = ids.map(id => {
      const u = unites[id];
      const rappel = game.user.isGM && !residence ? `<button type="button" data-rappel="${echapper(id)}">Rappeler</button>` : "";
      return `<div class="ligne"><span class="ins" data-insigne="${echapper(u.insigne ?? "")}"></span>`
        + `<div><div class="nom">${echapper(u.nom)}</div><div class="det">${echapper(STATUTS[u.statut] ?? u.statut)} · puissance ${u.force ?? 0}/4</div></div>${rappel}</div>`;
    }).join("");
    el.innerHTML = `${symbole(groupe, couleur, residence)}<b>${ids.length}</b>`
      + `<div class="bulle"><div class="tete"><span>${echapper(groupe.toUpperCase())} · ${ids.length}</span><span>${echapper(lieu.nom)}${residence ? " · résidence" : ""}</span></div>`
      + `${lignes}<div class="aide">Clic : ouvre le groupe dans le panneau</div></div>`;
    for ( const s of el.querySelectorAll("[data-insigne]") ) s.innerHTML = svgInsigne(s.dataset.insigne, couleur, 28);
    el.addEventListener("pointerdown", ev => ev.stopPropagation());  // pas de rotation de la caméra
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      const b = ev.target.closest("[data-rappel]");
      if ( b ) { b.disabled = true; rappeler(b.dataset.rappel); return; }
      this.rappels.montrerGroupe(groupe);
    });
    return el;
  }

  /** Masque ou réaffiche les symboles ; renvoie true s'ils sont désormais visibles */
  basculerVisibilite() {
    this.visible = !this.visible;
    return this.visible;
  }

  /** À chaque image : position des symboles (`actif` faux pendant l'allumage de la ville) */
  animer(C, w, h, v, actif = true) {
    for ( const p of this.piles ) {
      v.copy(p.ancre).project(C);
      p.el.hidden = !this.visible || !actif || v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
      p.el.style.left = `${(v.x + 1) / 2 * w}px`; p.el.style.top = `${(1 - v.y) / 2 * h}px`;
      p.el.classList.toggle("bas", (1 - v.y) / 2 < 0.45);  // haut de la vue : l'infobulle s'ouvre vers le bas
    }
  }

  detruire() {
    for ( const p of this.piles ) p.el.remove();
    this.piles = [];
  }
}
