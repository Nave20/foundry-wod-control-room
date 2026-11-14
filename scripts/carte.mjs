/**
 * Carte de Paris (lieux, factions, territoires) relayée par le mini-serveur, qui la tient de « Paris occulte ».
 *
 * - Le MJ actif relit GET /carte avec les unités. Il garde la carte complète dans un réglage de son PC (« carteMj »),
 *   qui n'est jamais envoyé aux joueurs.
 * - Les joueurs reçoivent une copie filtrée dans un réglage du monde (« carteJoueurs ») : seulement les lieux
 *   révélés, avec le texte prévu pour eux. Un client de joueur ne reçoit donc jamais un lieu caché.
 *   Les territoires, eux, sont tous visibles (choix du MJ, 14/11/2026) : arrondissements, quartiers et camp réel de
 *   chaque arrondissement (« territoires », calculé sur la carte complète).
 * - Le crochet « wodControlRoomCarte » prévient les fenêtres ouvertes quand la carte change.
 */
import { territoires } from "./territoires.mjs";

const ID = "wod-control-room";
export const CROCHET = "wodControlRoomCarte";
const VIDE = { version: 0, maj: "", lieux: {}, factions: {}, arrondissements: {}, quartiers: {} };

export function registerCarteSettings() {
  game.settings.register(ID, "carteJoueurs", {
    scope: "world", config: false, type: Object, default: VIDE,
    onChange: () => { if ( !game.user.isGM ) Hooks.callAll(CROCHET); }
  });
  game.settings.register(ID, "carteMj", { scope: "client", config: false, type: Object, default: VIDE });
}

/** Carte vue par ce client : complète pour le MJ (si son PC l'a reçue), filtrée pour les joueurs */
export function carteCourante() {
  if ( game.user.isGM ) {
    const mj = game.settings.get(ID, "carteMj");
    if ( mj?.version ) return { ...mj, complete: true };
  }
  return { ...(game.settings.get(ID, "carteJoueurs") ?? VIDE), complete: false };
}

/** Ce que les joueurs ont le droit de voir */
export function filtrer(c) {
  const lieux = {}, arrondissements = {}, quartiers = {};
  for ( const [id, l] of Object.entries(c.lieux ?? {}) ) {
    if ( l.pj ) lieux[id] = { nom: l.nom, type: l.type, faction: l.faction, lon: l.lon, lat: l.lat, arr: l.arr, texte: l.texte_joueurs ?? "" };
  }
  for ( const [n, a] of Object.entries(c.arrondissements ?? {}) ) arrondissements[n] = { controle: a.controle, titre: a.titre };
  for ( const [n, q] of Object.entries(c.quartiers ?? {}) ) quartiers[n] = { ar: q.ar, nom: q.nom, controle: q.controle };
  const terr = territoires(c);
  return { version: c.version, maj: c.maj, lieux, factions: c.factions ?? {}, arrondissements, quartiers, territoires: terr };
}

/**
 * Carte reçue du serveur par le MJ actif : garde la version complète sur son PC, publie la version filtrée.
 * Ne fait rien si la version n'a pas changé.
 */
export async function publierCarte(c) {
  if ( !c || !Number.isInteger(c.version) || !c.lieux ) return;
  const avant = game.settings.get(ID, "carteMj");
  if ( avant?.version === c.version && avant?.maj === c.maj ) return;
  await game.settings.set(ID, "carteMj", c);
  const publique = filtrer(c);
  const ancienne = game.settings.get(ID, "carteJoueurs");
  if ( JSON.stringify(ancienne) !== JSON.stringify(publique) ) await game.settings.set(ID, "carteJoueurs", publique);
  Hooks.callAll(CROCHET);
}
