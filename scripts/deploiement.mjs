/**
 * Règles du déploiement des unités (étape 4, décidées par le MJ le 14/11/2026) : fonctions pures, testées
 * (node --test tests/*.test.mjs).
 * - Une unité est déployée sur un lieu (`repere`) ou à résidence (`residence`, si elle n'est pas engagée ailleurs).
 * - Le groupe « À gagner » et les unités absentes, blessées, perdues ou vides ne se déploient pas.
 * - Les joueurs ne reçoivent jamais l'identifiant d'un lieu caché.
 */

export const GROUPE_A_GAGNER = "À gagner";

/** Couleur et rang d'affichage des groupes connus */
export const GROUPES = {
  "Rédempteurs": { couleur: "#ffd27a", rang: 0 },
  "Alliés du Conseil": { couleur: "#bff6ff", rang: 1 }
};
const COULEUR_AUTRE = "#9fd8e8";
export const couleurGroupe = g => GROUPES[g]?.couleur ?? COULEUR_AUTRE;
const nomGroupe = u => (u.groupe || "Unités").trim();

const REFUS = { absent: "Absente", blesse: "Indisponible", perdu: "Perdue", vide: "Vide" };

/** Une unité peut-elle être glissée sur un lieu ? */
export function deployable(u) {
  if ( nomGroupe(u) === GROUPE_A_GAGNER ) return { ok: false, raison: GROUPE_A_GAGNER };
  if ( REFUS[u.statut] ) return { ok: false, raison: REFUS[u.statut] };
  return { ok: true, raison: "" };
}

/**
 * Unités présentes sur chaque lieu connu.
 * @returns {Map<string, Array<{groupe: string, etat: "deploye"|"residence", ids: string[]}>>}
 */
export function regrouper(unites, lieux) {
  const parLieu = new Map();
  for ( const [id, u] of Object.entries(unites ?? {}) ) {
    let lieu = u.repere, etat = "deploye";
    if ( !lieu ) {
      // En mission hors carte, sans résidence, ou pas (plus) au Conseil
      if ( !u.residence || ["engage", "absent", "perdu", "vide"].includes(u.statut) ) continue;
      lieu = u.residence; etat = "residence";
    }
    if ( !lieux?.[lieu] ) continue;
    const groupes = parLieu.get(lieu) ?? parLieu.set(lieu, []).get(lieu);
    const g = nomGroupe(u);
    let e = groupes.find(x => x.groupe === g && x.etat === etat);
    if ( !e ) groupes.push(e = { groupe: g, etat, ids: [] });
    e.ids.push(id);
  }
  const rang = g => GROUPES[g]?.rang ?? 9;
  for ( const groupes of parLieu.values() ) {
    groupes.sort((a, b) => rang(a.groupe) - rang(b.groupe) || a.groupe.localeCompare(b.groupe, "fr")
      || (a.etat === "deploye" ? -1 : 1) - (b.etat === "deploye" ? -1 : 1));
    for ( const e of groupes ) e.ids.sort();
  }
  return parLieu;
}

/** Copie des unités pour les joueurs : déploiement et résidence vidés s'ils désignent un lieu non révélé */
export function filtrerUnites(unites, lieux) {
  const visible = id => !!lieux?.[id]?.pj;
  return Object.fromEntries(Object.entries(unites ?? {}).map(([id, u]) => {
    const c = { ...u };
    for ( const cle of ["repere", "residence"] ) if ( c[cle] && !visible(c[cle]) ) c[cle] = "";
    return [id, c];
  }));
}
