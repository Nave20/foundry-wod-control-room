/**
 * Territoires par arrondissement, à partir de la carte de « Paris occulte » (fonctions pures, testées : node --test tests/).
 *
 * Règle (plan de la table de contrôle, étape 3 bis, décidée par le MJ le 14/11/2026) :
 * 1. chaque arrondissement a 4 quartiers (le quartier n est dans l'arrondissement ⌈n/4⌉) ; un quartier sans faction
 *    propre, ou absent de la base, prend la faction de son arrondissement (comme l'affiche « Paris occulte ») ;
 * 2. on compte par camp, sans distinguer les factions internes (Anarchs = Vampires, Marché gris = Mages…) ;
 *    les quartiers disputés ne comptent pas, il n'y a plus de zone disputée ;
 * 3. le camp qui tient le plus de quartiers contrôle l'arrondissement ;
 * 4. à égalité : l'arbitrage du MJ, sinon le camp de la faction de l'arrondissement, sinon neutre (absent du résultat).
 * Pour les joueurs, la même règle s'applique à leur copie filtrée : seuls les arrondissements et quartiers révélés comptent.
 */

/** Faction des zones disputées dans « Paris occulte » */
export const DISPUTEE = "disputee";

/** Camps du mode simplifié (rouge vampires, bleu indigo mages, vert garous, gris Technocratie) */
export const CAMPS = {
  vampires: { nom: "Vampires", couleur: "#e0283c" },
  mages: { nom: "Mages", couleur: "#5a3cff" },
  garous: { nom: "Garous", couleur: "#2fd05a" },
  technocratie: { nom: "Technocratie", couleur: "#9aa4b3" },
  autre: { nom: "Autres", couleur: "#d8a64a" }
};

const GROUPES = { vampires: "vampires", mages: "mages", garous: "garous", technocratie: "technocratie" };
/** Factions rangées dans « Autres » par « Paris occulte » mais rattachées à un camp par le MJ */
const RATTACHEES = { "marche-gris": "mages" };
/** Égalités tranchées par le MJ (14/11/2026) : ne valent que si ce camp fait partie des ex æquo */
export const ARBITRAGES = { 7: "technocratie", 13: "vampires", 16: "garous" };

/**
 * Camp d'une faction, d'après son groupe dans « Paris occulte ».
 * @returns {"vampires"|"mages"|"garous"|"technocratie"|"autre"|null}  null pour une zone disputée
 */
export function camp(faction, factions = {}) {
  if ( !faction || faction === DISPUTEE || factions[faction]?.motif === "hachures" ) return null;
  if ( RATTACHEES[faction] ) return RATTACHEES[faction];
  const groupe = String(factions[faction]?.groupe ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return GROUPES[groupe] ?? "autre";
}

/**
 * Camp de chaque arrondissement connu.
 * @param {{factions?: object, arrondissements?: object, quartiers?: object}} carte
 * @returns {Record<string, {camp: string, faction: string}>}  numéro → camp, et faction la plus présente de ce camp
 */
export function territoires(carte) {
  const factions = carte.factions ?? {}, resultat = {};
  for ( let n = 1; n <= 20; n++ ) {
    const arr = carte.arrondissements?.[String(n)];
    const parCamp = {};  // camp → { total, factions: { id: nombre } }
    for ( let k = 4 * n - 3; k <= 4 * n; k++ ) {
      const q = carte.quartiers?.[String(k)];
      const f = q?.controle || arr?.controle;
      const cp = camp(f, factions); if ( !cp ) continue;
      const e = (parCamp[cp] ??= { total: 0, factions: {} });
      e.total++; e.factions[f] = (e.factions[f] ?? 0) + 1;
    }
    const max = Math.max(0, ...Object.values(parCamp).map(e => e.total));
    if ( !max ) continue;
    const entete = Object.keys(parCamp).filter(c => parCamp[c].total === max);
    let gagnant = entete[0];
    if ( entete.length > 1 ) {
      const parArr = camp(arr?.controle, factions);
      gagnant = [ARBITRAGES[n], parArr].find(c => c && entete.includes(c));
      if ( !gagnant ) continue;
    }
    const fs = parCamp[gagnant].factions;
    const faction = Object.keys(fs).sort((a, b) => (fs[b] - fs[a]) || ((b === arr?.controle) - (a === arr?.controle)))[0];
    resultat[String(n)] = { camp: gagnant, faction };
  }
  return resultat;
}
