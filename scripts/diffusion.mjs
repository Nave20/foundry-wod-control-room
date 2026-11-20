/**
 * « Montrer aux joueurs » : décide, à partir du compteur `seq` du serveur, s'il faut ouvrir l'hologramme chez les joueurs.
 * Fonction pure (testée sans Foundry). `vu` : dernier `seq` lu depuis le chargement de la page, ou null.
 */
const CONNUS = ["carte", "image"];

/** Même règle que le serveur : seule une copie de portrait de Campaign Console peut être montrée */
const IMAGE_SURE = /^campaign-console\/portraits\/[0-9a-f]{16}\.(jpg|jpeg|png|webp)$/;

/** @param {unknown} chemin  @returns {boolean} */
export function imageSure(chemin) {
  return (typeof chemin === "string") && IMAGE_SURE.test(chemin);
}

/**
 * @param {number|null} vu
 * @param {{seq: number, quoi: string}} recu
 * @returns {{action: "rien"|"montrer", vu: number}}
 */
export function aDiffuser(vu, recu) {
  // Première lecture, ou serveur redémarré (compteur reparti de zéro) : on se cale sans rien montrer
  if ( (vu === null) || (recu.seq <= vu) ) return { action: "rien", vu: recu.seq };
  return { action: CONNUS.includes(recu.quoi) ? "montrer" : "rien", vu: recu.seq };
}
