/**
 * Salle de contrôle (preuve de concept) : unités synchronisées avec le mini-serveur local.
 *
 * - Seul le MJ actif parle au mini-serveur (http://127.0.0.1:<port>) : il relit les données toutes les 3 s et
 *   recopie chaque changement dans un réglage du monde, que Foundry transmet aux joueurs.
 * - Serveur absent : le module est bloqué. Un avertissement au démarrage, une fenêtre qui explique quoi faire,
 *   aucune écriture ; le MJ réessaie tout seul toutes les 15 s et le module se débloque dès que le serveur répond.
 * - Aucune erreur n'est levée hors du module : chaque appel réseau est borné dans le temps et rattrapé.
 */
import { Hologramme } from "./hologram.mjs";

const ID = "wod-control-room";
const DELAI_APPEL = 2500;
const INTERVALLE_CONNECTE = 3000;
const INTERVALLE_HORS_LIGNE = 15000;
// Statuts de la Réserve du Conseil (« Rolling in the Deep » est la référence)
const STATUTS = ["disponible", "engage", "blesse", "perdu", "absent", "vide"];

/** État de la connexion vu par ce client (MJ actif seulement) */
let etat = "inconnu";
let minuterie = null;
let premierEssai = true;
/** Avertissement permanent affiché au démarrage, retiré quand le serveur répond */
let avertissement = null;

const url = chemin => `http://127.0.0.1:${game.settings.get(ID, "port")}${chemin}`;
const loc = (cle, data) => data ? game.i18n.format(`SALLE.${cle}`, data) : game.i18n.localize(`SALLE.${cle}`);
const estMjActif = () => game.user.isGM && (game.users.activeGM?.isSelf ?? false);
const copie = () => game.settings.get(ID, "copie") ?? { etat: "inconnu", donnees: { version: 0, unites: {} } };

/** Appel au mini-serveur, borné dans le temps. Renvoie { ok, code, corps } ; ne lève jamais. */
async function appel(methode, chemin, corps) {
  try {
    const r = await fetch(url(chemin), {
      method: methode, cache: "no-store", signal: AbortSignal.timeout(DELAI_APPEL),
      headers: corps ? { "Content-Type": "application/json" } : undefined,
      body: corps ? JSON.stringify(corps) : undefined
    });
    let json = null;
    try { json = await r.json(); } catch { /* corps vide ou illisible */ }
    return { ok: r.ok, code: r.status, corps: json, joignable: true };
  } catch {
    return { ok: false, code: 0, corps: null, joignable: false };
  }
}

/** Réponse valide du serveur : { version: nombre, unites: objet } */
function donneesValides(d) {
  return d && Number.isInteger(d.version) && d.unites && (typeof d.unites === "object") && !Array.isArray(d.unites);
}

/** Recopie l'état et les données dans le réglage du monde, seulement s'ils ont changé */
async function publier(nouvelEtat, donnees) {
  const avant = copie();
  const d = donnees ?? avant.donnees;
  if ( (avant.etat === nouvelEtat) && (avant.donnees?.version === d.version) ) return;
  await game.settings.set(ID, "copie", { etat: nouvelEtat, donnees: d });
}

function changerEtat(nouvel) {
  if ( nouvel === etat ) return;
  const ancien = etat;
  etat = nouvel;
  if ( nouvel === "hors_ligne" ) {
    if ( premierEssai ) {
      avertissement = ui.notifications.warn(loc("AvertissementDemarrage", { port: game.settings.get(ID, "port") }), { permanent: true });
    }
    else if ( ancien === "connecte" ) ui.notifications.error(loc("Perdu"));
  } else if ( (nouvel === "connecte") && (ancien === "hors_ligne") ) {
    // L'avertissement permanent du démarrage n'a plus lieu d'être
    if ( avertissement ) {
      try { ui.notifications.remove(avertissement.id ?? avertissement); } catch { /* déjà fermé */ }
      avertissement = null;
    }
    ui.notifications.info(loc("Reconnecte"));
  }
}

/** Un tour de vérification : santé + données ; programme le suivant */
async function verifier() {
  clearTimeout(minuterie);
  if ( !estMjActif() ) return;
  const r = await appel("GET", "/unites");
  if ( r.ok && donneesValides(r.corps) ) {
    changerEtat("connecte");
    await publier("connecte", r.corps);
  } else {
    changerEtat("hors_ligne");
    await publier("hors_ligne");
  }
  premierEssai = false;
  minuterie = setTimeout(verifier, etat === "connecte" ? INTERVALLE_CONNECTE : INTERVALLE_HORS_LIGNE);
}

/** Modification envoyée par le MJ ; rien n'est tenté si le serveur est hors ligne */
async function modifier(uid, champs) {
  if ( !estMjActif() || (etat !== "connecte") ) return;
  const r = await appel("PUT", `/unites/${encodeURIComponent(uid)}`, champs);
  if ( r.ok && donneesValides(r.corps) ) return publier("connecte", r.corps);
  if ( !r.joignable ) return verifier();
  ui.notifications.warn(loc("Refuse", { erreur: r.corps?.erreur ?? r.code }));
  SalleDeControle.instance?.render();
}

/** Identifiant d'unité à partir d'un nom : « Garde du Node » → « garde-du-node » (unique) */
function nouvelId(nom, existants) {
  const base = nom.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 34) || "unite";
  let id = base;
  for ( let i = 2; existants.includes(id); i++ ) id = `${base}-${i}`;
  return id;
}

/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SalleDeControle extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "salle-de-controle",
    classes: ["salle-de-controle"],
    window: { title: "SALLE.Titre", icon: "fa-solid fa-satellite-dish", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      reessayer: () => verifier(),
      hologramme: () => new Hologramme().render({ force: true }),
      ajouter: SalleDeControle.#ajouter
    }
  };

  static PARTS = { corps: { template: `modules/${ID}/templates/control-room.hbs` } };

  static ouvrir() {
    SalleDeControle.instance ??= new SalleDeControle();
    return SalleDeControle.instance.render({ force: true });
  }

  async _prepareContext() {
    const c = copie();
    const sansMj = !game.users.activeGM;
    const connecte = (c.etat === "connecte") && !sansMj;
    const unites = Object.entries(c.donnees?.unites ?? {})
      .filter(([, u]) => u.statut !== "absent")  // « À gagner » : pas encore au Conseil
      .map(([id, u]) => ({ id, nom: u.nom, force: u.force, membres: u.membres ?? "", arete: u.arete ?? "", statuts: STATUTS.map(s => ({ cle: s, nom: loc(`Statuts.${s}`), choisi: s === u.statut })),
        statutNom: loc(`Statuts.${u.statut}`) }))
      .sort((a, b) => (c.donnees.unites[a.id].ordre ?? 999) - (c.donnees.unites[b.id].ordre ?? 999) || a.nom.localeCompare(b.nom, "fr"));
    return {
      connecte, unites,
      etatCle: sansMj ? "sansMj" : (c.etat ?? "inconnu"),
      etatNom: loc(`Etat.${sansMj ? "sansMj" : (c.etat ?? "inconnu")}`),
      editable: connecte && estMjActif(),
      estMj: game.user.isGM,
      aDesDonnees: unites.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if ( !context.editable ) return;
    for ( const champ of this.element.querySelectorAll("[data-champ]") ) {
      champ.addEventListener("change", ev => {
        const el = ev.currentTarget;
        const valeur = el.dataset.champ === "force" ? Number(el.value) : el.value;
        modifier(el.closest("[data-unite]").dataset.unite, { [el.dataset.champ]: valeur });
      });
    }
  }

  static async #ajouter() {
    const champ = this.element.querySelector("input[name=nouveau]");
    const nom = champ?.value.trim();
    if ( !nom ) return;
    const id = nouvelId(nom, Object.keys(copie().donnees?.unites ?? {}));
    await modifier(id, { nom, force: 1, statut: "disponible" });
  }

  _onClose(options) {
    super._onClose(options);
    SalleDeControle.instance = null;
  }
}

/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(ID, "port", {
    name: "SALLE.Port", hint: "SALLE.PortAide", scope: "world", config: true, restricted: true,
    type: new foundry.data.fields.NumberField({ required: true, nullable: false, integer: true, min: 1024, max: 65535, initial: 30010 }),
    default: 30010,
    onChange: () => { premierEssai = true; verifier(); }
  });
  // Dernière copie des données, transmise par Foundry à tous les clients
  // Densité de l'hologramme, propre à chaque PC : automatique (mesurée au premier lancement), complète ou légère
  game.settings.register(ID, "qualite", {
    name: "Qualité de l'hologramme", hint: "Automatique : la fluidité est mesurée au premier lancement sur ce PC ; la qualité complète est gardée si elle passe bien.",
    scope: "client", config: true, type: String, default: "auto",
    choices: { auto: "Automatique", complet: "Complète (419 000 bâtiments)", leger: "Légère (184 000 bâtiments)" }
  });
  game.settings.register(ID, "qualiteMesuree", { scope: "client", config: false, type: String, default: "" });
  game.settings.register(ID, "copie", {
    scope: "world", config: false, type: Object, default: { etat: "inconnu", donnees: { version: 0, unites: {} } },
    onChange: () => SalleDeControle.instance?.render()
  });
});

Hooks.once("ready", () => {
  game.modules.get(ID).api = { ouvrir: () => SalleDeControle.ouvrir(), hologramme: () => new Hologramme().render({ force: true }) };
  if ( estMjActif() ) verifier();
});

// Le MJ actif change (un autre MJ se connecte ou part) : seul le nouveau MJ actif interroge le serveur
Hooks.on("userConnected", () => {
  if ( estMjActif() ) { if ( etat === "inconnu" ) verifier(); }
  else clearTimeout(minuterie);
  SalleDeControle.instance?.render();
});

// Bouton dans l'onglet des acteurs
Hooks.on("renderActorDirectory", (app, html) => {
  const racine = html instanceof HTMLElement ? html : html?.[0];
  const pied = racine?.querySelector(".directory-footer") ?? racine;
  if ( !pied || pied.querySelector(".salle-ouvrir") ) return;
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "salle-ouvrir";
  bouton.innerHTML = `<i class="fa-solid fa-satellite-dish" inert></i> ${loc("Ouvrir")}`;
  bouton.addEventListener("click", () => SalleDeControle.ouvrir());
  pied.append(bouton);
});
