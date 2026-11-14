/**
 * Ping lumineux sur l'hologramme de Paris, partagé par le socket du module (sans le mini-serveur : il marche même
 * serveur éteint). Un joueur pointe un endroit, tous ceux qui ont l'hologramme ouvert voient une colonne de lumière.
 * Le MJ peut en plus « appeler les caméras » : la vue de chacun se centre sur son ping.
 */
const ID = "wod-control-room";
const CANAL = `module.${ID}`;
/** Délai minimal entre deux pings d'un même joueur (ms) */
const INTERVALLE = 1000;
/** Limites de Paris (avec une marge) : un ping hors de ces bornes est ignoré */
const BORNES = { lonMin: 2.2, lonMax: 2.5, latMin: 48.8, latMax: 48.93 };

let dernierEnvoi = 0;
const derniersRecus = new Map();

const fenetre = () => foundry.applications.instances.get("hologramme-paris");

/** Couleur du joueur, en nombre (0xRRGGBB) */
function couleurDe(user) {
  const c = Number(user?.color);
  return Number.isFinite(c) ? c : 0x9ff3ff;
}

function valide(d) {
  return d && (d.type === "ping") && Number.isFinite(d.lon) && Number.isFinite(d.lat)
    && (d.lon >= BORNES.lonMin) && (d.lon <= BORNES.lonMax) && (d.lat >= BORNES.latMin) && (d.lat <= BORNES.latMax);
}

/** Affiche un ping dans la fenêtre ouverte de ce client (s'il y en a une) */
function afficher(d, user) {
  const f = fenetre();
  if ( !f?.rendered ) return;
  f.afficherPing({ lon: d.lon, lat: d.lat, couleur: couleurDe(user), nom: user?.name ?? "?", appel: !!d.appel && !!user?.isGM });
}

/**
 * Envoie un ping à tous (et l'affiche ici : le socket ne renvoie pas le message à son auteur).
 * @param {number} lon
 * @param {number} lat
 * @param {{appel?: boolean}} [options]  appel : le MJ centre la vue de tous sur le ping
 * @returns {boolean} false si le ping est refusé (trop rapproché ou hors de Paris)
 */
export function envoyerPing(lon, lat, { appel = false } = {}) {
  const maintenant = Date.now();
  if ( maintenant - dernierEnvoi < INTERVALLE ) return false;
  const d = { type: "ping", lon: Math.round(lon * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6, appel: appel && game.user.isGM };
  if ( !valide(d) ) return false;
  dernierEnvoi = maintenant;
  game.socket.emit(CANAL, d);
  afficher(d, game.user);
  return true;
}

/** À appeler une fois, au « ready » */
export function ecouterPings() {
  game.socket.on(CANAL, (d, expediteur) => {
    if ( !valide(d) ) return;
    // L'expéditeur vient du serveur de Foundry : un joueur ne peut pas se faire passer pour un autre
    const user = game.users.get(expediteur);
    if ( !user ) return;
    const maintenant = Date.now();
    if ( maintenant - (derniersRecus.get(user.id) ?? 0) < INTERVALLE * 0.8 ) return;
    derniersRecus.set(user.id, maintenant);
    afficher(d, user);
  });
}
