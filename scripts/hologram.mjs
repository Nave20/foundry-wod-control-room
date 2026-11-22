/**
 * Fenêtre « Hologramme de Paris » : bâtiments réels (IGN BD TOPO) posés sur le relief, monuments en haute définition,
 * unités du mini-serveur en direct, lieux de « Paris occulte » (repères, royaume du Conseil), pings. Three.js est chargé depuis un CDN pour l'instant (à embarquer dans le module).
 */
import { lireParis, construireParis, PALETTES, VR } from "./paris-hologram.mjs";
import { PanneauUnites } from "./units-panel.mjs";
import { versCarte, depuisCarte } from "./geo.mjs";
import { envoyerPing } from "./ping.mjs";
import { CalqueReperes } from "./reperes.mjs";
import { CalqueUnites } from "./unites-calque.mjs";
import { deployable } from "./deploiement.mjs";
import { carteCourante, unitesCourantes, CROCHET, CROCHET_UNITES } from "./carte.mjs";
import { CalqueTerritoires, MODES, modeSuivant } from "./territoires-calque.mjs";

const ID = "wod-control-room";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";
let THREE = null;
/** Données de Paris par niveau de qualité (chargées une fois par session) */
const DONNEES = {};
const FICHIERS = { complet: "paris.bin", leger: "paris-light.bin" };
const NOMS_NIVEAU = { complet: "complète", leger: "légère" };
async function chargerNiveau(n) {
  if ( !DONNEES[n] ) {
    const r = await fetch(`modules/${ID}/data/${FICHIERS[n]}`);
    if ( !r.ok ) throw new Error(`fichier introuvable (${r.status})`);
    DONNEES[n] = lireParis(await r.arrayBuffer());
  }
  return DONNEES[n];
}
/** Qualité voulue : réglage du joueur, ou mesure faite sur ce PC en mode automatique (légère tant qu'on n'a pas mesuré) */
function niveauVoulu() {
  const r = game.settings.get(ID, "qualite");
  return r === "auto" ? (game.settings.get(ID, "qualiteMesuree") || "leger") : r;
}

const { ApplicationV2 } = foundry.applications.api;

/** Durée minimale de chaque ligne de l'écran d'initialisation (ms) */
const DUREE_ETAPE = 450;

/** Habillage « salle de contrôle » posé sur la vue (aucune interaction : la souris passe au travers) */
const HUD = `<div class="holo-hud" aria-hidden="true"><div class="balayage"></div><div class="vignette"></div>
  <span class="coin c1"></span><span class="coin c2"></span><span class="coin c3"></span><span class="coin c4"></span>
  <div class="bandeau"><div><b>CONSEIL DE PARIS</b> · SALLE DE CONTRÔLE<div class="sous">PROJECTION HOLOGRAPHIQUE · IGN BD TOPO</div></div>
    <div style="text-align:right"><span class="chaud hud-date"></span><div class="sous hud-heure"></div></div></div>
  <svg class="compas" viewBox="-32 -32 64 64"><circle r="26" fill="none" stroke="#2c6f86"/><g class="hud-rose">
    <path d="M0,-22 L4,0 L0,4 L-4,0 Z" fill="#fff0d0"/><path d="M0,22 L4,0 L0,-4 L-4,0 Z" fill="#2c6f86"/>
    <text y="-27" text-anchor="middle" font-size="8" fill="#e6fbff">N</text></g></svg>
  <div class="reticule"></div>
  <div class="pied"><div class="hud-serveur"><span class="pastille"></span><span class="texte"></span></div>
    <div style="text-align:center">VISÉE <span class="chaud hud-visee"></span><div class="sous hud-cap"></div></div><div></div></div></div>`;

/** Durée de vie d'un ping (ms) ; il s'éteint pendant les 2 dernières secondes */
const DUREE_PING = 10000;
/** Un clic : moins de 5 px de déplacement et moins d'une demi-seconde (au-delà, c'est une rotation de la vue) */
const CLIC = { px: 5, ms: 500 };

export class Hologramme extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "hologramme-paris", classes: ["hologramme-paris"],
    window: { title: "Hologramme de Paris", icon: "fa-solid fa-city", resizable: true },
    position: { width: 1180, height: 720 }
  };

  #mode = "tech";
  /** Masquage des traits cachés + fondu avec la distance (bouton avant / après) */
  #masquage = true;
  #scene = null;
  #panneau = null;
  /** Allumage : début (ms) ; null quand il est terminé. Le panneau des unités attend la fin. */
  #allumage = null;
  #pret = false;
  /** Heure de la dernière ligne de l'écran d'initialisation (chaque étape reste au moins DUREE_ETAPE ms à l'écran) */
  #dernierPas = 0;
  #hud = null;
  /** Caméra : cible regardée, distance, angles ; la cible glisse vers « vers » quand on clique un monument */
  #cam = { az: 0.4, el: 0.7, dist: 7, cible: null, vers: null, distVers: null };
  #niveau = null;
  #donnees = null;
  /** Mesure de fluidité en cours (mode automatique, premier lancement sur ce PC) */
  #mesure = null;

  /** Pings en cours : { debut, groupe, onde, coeur, halo, etiquette, ancre } */
  #pings = [];
  /** Calque des lieux de « Paris occulte » (scripts/reperes.mjs) et crochet de mise à jour de la carte */
  #reperes = null;
  /** Symboles des unités au-dessus des lieux */
  #calqueUnites = null;
  #crochetCarte = null;
  #crochetCopie = null;
  #crochetUnites = null;
  /** Calque des territoires par arrondissement : éteint par défaut, puis simplifié ou détaillé */
  #territoires = null;
  #modeTerritoires = "off";
  /** Mode « ping » : le prochain clic sur la carte envoie un ping (bouton de la barre) */
  #modePing = false;
  /** Rotation automatique de la vue (bouton de la barre, mémorisé pour chaque joueur) */
  #rotation = true;

  /**
   * Position dans la scène d'un point donné par sa longitude et sa latitude, posé sur le relief.
   * @param {number} lon
   * @param {number} lat
   * @param {number} [hauteur]  hauteur au-dessus du sol, en unités de scène (1 = 1 km)
   */
  positionCarte(lon, lat, hauteur = 0) {
    const [x, y] = versCarte(lon, lat);
    const sol = this.#scene?.ville?.sol?.(x, y) ?? 0;
    return new THREE.Vector3(x / 1000, sol * VR / 1000 + hauteur, -y / 1000);
  }

  /**
   * Point de la carte sous le pointeur : rayon lancé depuis la caméra jusqu'au relief.
   * @returns {{lon: number, lat: number, point: object}|null}  null si le rayon ne touche pas le sol
   */
  #pointSous(clientX, clientY) {
    const sc = this.#scene; if ( !sc?.ville ) return null;
    const r = sc.R.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), sc.C);
    const o = ray.ray.origin, dir = ray.ray.direction;
    const sous = p => p.y <= sc.ville.sol(p.x * 1000, -p.z * 1000) * VR / 1000;
    // Marche le long du rayon (pas de 10 m), puis affinage par dichotomie
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    let t0 = 0, t1 = null;
    for ( let t = 0; t < 40; t += 0.01 ) { p.copy(o).addScaledVector(dir, t); if ( sous(p) ) { t1 = t; break; } t0 = t; }
    if ( t1 === null ) return null;
    for ( let i = 0; i < 20; i++ ) { const m = (t0 + t1) / 2; q.copy(o).addScaledVector(dir, m); if ( sous(q) ) t1 = m; else t0 = m; }
    p.copy(o).addScaledVector(dir, t1);
    const [lon, lat] = depuisCarte(p.x * 1000, -p.z * 1000);
    return { lon, lat, point: p };
  }

  /** Clic sur la carte (sans rotation) : ping avec Alt ou en mode ping ; Alt + Maj (MJ) : ping et appel des caméras */
  #clic(e) {
    if ( !(e.altKey || this.#modePing) ) return;
    const pt = this.#pointSous(e.clientX, e.clientY);
    if ( !pt ) return;
    const envoye = envoyerPing(pt.lon, pt.lat, { appel: e.shiftKey && game.user.isGM });
    if ( envoye && this.#modePing ) this.#basculerModePing(false);
  }

  #basculerModePing(actif = !this.#modePing) {
    this.#modePing = actif;
    this.element?.querySelector("[data-holo=ping]")?.classList.toggle("actif", actif);
    this.element?.querySelector(".holo-scene")?.classList.toggle("mode-ping", actif);
  }

  /**
   * Affiche un ping : colonne de lumière qui monte, onde au sol, nom du joueur. Appelé par scripts/ping.mjs.
   * @param {{lon: number, lat: number, couleur: number, nom: string, appel?: boolean}} p
   */
  afficherPing({ lon, lat, couleur, nom, appel = false }) {
    const sc = this.#scene; if ( !sc?.ville ) return;
    const pied = this.positionCarte(lon, lat), H = 1.1, ADD = THREE.AdditiveBlending;
    const mat = opacite => new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: opacite, blending: ADD, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const groupe = new THREE.Group(); groupe.position.copy(pied);
    // Colonne : un cœur fin et un halo plus large, le pied au sol
    const coeur = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, H, 8, 1, true), mat(0.95));
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, H, 16, 1, true), mat(0.22));
    for ( const m of [coeur, halo] ) { m.geometry.translate(0, H / 2, 0); m.renderOrder = 5; groupe.add(m); }
    // Onde au sol
    const onde = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), mat(0.9));
    onde.rotation.x = -Math.PI / 2; onde.position.y = 0.003; onde.renderOrder = 5; groupe.add(onde);
    sc.S.add(groupe);
    const etiquette = document.createElement("div");
    etiquette.className = "holo-etiquette ping";
    etiquette.textContent = nom;
    etiquette.style.setProperty("--ping", `#${couleur.toString(16).padStart(6, "0")}`);
    sc.conteneur.appendChild(etiquette);
    this.#pings.push({ debut: performance.now(), groupe, onde, coeur, halo, etiquette, ancre: pied.clone().setY(pied.y + H) });
    if ( appel ) { this.#cam.vers = pied.clone(); this.#cam.distVers = 1.6; }
  }

  /** Animation et extinction des pings (appelé à chaque image) */
  #animerPings(C, w, h, v) {
    const maintenant = performance.now();
    for ( const p of [...this.#pings] ) {
      const age = maintenant - p.debut;
      if ( age > DUREE_PING ) {
        this.#scene.S.remove(p.groupe);
        p.groupe.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        p.etiquette.remove();
        this.#pings.splice(this.#pings.indexOf(p), 1);
        continue;
      }
      const montee = Math.min(1, age / 400), fin = Math.min(1, Math.max(0, (DUREE_PING - age) / 2000));
      p.coeur.scale.y = p.halo.scale.y = 1 - Math.pow(1 - montee, 3);
      p.coeur.material.opacity = 0.95 * fin;
      p.halo.material.opacity = (0.16 + 0.08 * Math.sin(age / 180)) * fin;
      // Onde : deux secondes par vague, de 10 à 250 m
      const vague = (age % 2000) / 2000;
      p.onde.scale.setScalar(0.01 + vague * 0.24);
      p.onde.material.opacity = 0.9 * (1 - vague) * fin;
      v.copy(p.ancre).project(C);
      p.etiquette.hidden = v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
      p.etiquette.style.left = `${(v.x + 1) / 2 * w}px`; p.etiquette.style.top = `${(1 - v.y) / 2 * h}px`;
      p.etiquette.style.opacity = String(fin);
    }
  }

  /** Centre la vue sur un monument (nom tel qu'affiché) */
  centrer(nom) {
    const e = this.#scene?.etiquettes.find(x => x.el.textContent === nom); if ( !e ) return false;
    this.#cam.vers = (e.pied ?? e.v).clone(); this.#cam.distVers = e.el.classList.contains("arrondissement") ? 2.6 : 1.1; return true;
  }

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "holo";
    div.innerHTML = `<div class="holo-barre">
        <button type="button" data-holo="umbra">Vue Umbra</button>
        <button type="button" data-holo="masquage" class="actif">Masquage et fondu</button>
        <button type="button" data-holo="territoires" title="Teinte chaque arrondissement selon la faction qui le tient (cliquer pour changer de mode)"><i class="fa-solid fa-chess-board" inert></i> <span>Territoires</span></button>
        <button type="button" data-holo="voirLieux" class="actif" title="Afficher ou masquer les repères des lieux (le palais du Conseil et la Sérénité restent visibles)"><i class="fa-solid fa-eye" inert></i> <span>Repères</span></button>
        <button type="button" data-holo="voirUnites" class="actif" title="Afficher ou masquer les symboles des unités déployées et à résidence"><i class="fa-solid fa-chess-rook" inert></i> <span>Unités</span></button>
        <button type="button" data-holo="lieux" title="Liste des lieux de Paris occulte, avec recherche et filtres"><i class="fa-solid fa-list" inert></i> Lieux</button>
        <button type="button" data-holo="rotation" class="actif" title="Arrêter ou relancer la rotation automatique de la vue"><i class="fa-solid fa-pause" inert></i> <span>Rotation</span></button>
        <button type="button" data-holo="ping" title="Cliquer ensuite sur la carte (raccourci : Alt + clic ; MJ : Alt + Maj + clic pour centrer la vue de tous)"><i class="fa-solid fa-location-crosshairs" inert></i> Ping</button>
        <select data-holo="qualite" title="Densité de la ville">
          <option value="auto">Qualité : automatique</option><option value="complet">Qualité : complète</option><option value="leger">Qualité : légère</option>
        </select></div>
      <div class="holo-corps"><div class="holo-scene">${HUD}<div class="holo-boot"><div class="boot-titre">CONSEIL DE PARIS</div><div class="boot-lignes"></div><div class="boot-barre"><i></i></div></div></div><aside class="holo-panneau"></aside></div>
      <p class="holo-etat">Chargement de Paris…</p>`;
    return div;
  }

  _replaceHTML(result, content) { if ( !content.querySelector(".holo") ) content.replaceChildren(result); if ( this.#pret ) this.#majUnites(); }

  /** Écran d'initialisation : une ligne de plus, la barre de progression avance */
  async #etape(texte, progres) {
    const boot = this.element?.querySelector(".holo-boot"); if ( !boot ) return;
    // Rythme minimal : sur un PC rapide, l'écran d'initialisation dure quand même environ 2 secondes
    if ( !matchMedia("(prefers-reduced-motion: reduce)").matches ) {
      const attente = DUREE_ETAPE - (performance.now() - this.#dernierPas);
      if ( this.#dernierPas && (attente > 0) ) await new Promise(r => setTimeout(r, attente));
    }
    this.#dernierPas = performance.now();
    const l = document.createElement("div"); l.className = "boot-ligne"; l.textContent = `> ${texte}`;
    boot.querySelector(".boot-lignes").append(l);
    boot.querySelector(".boot-barre i").style.transform = `scaleX(${progres})`;
    await new Promise(r => setTimeout(r, 30));  // laisser le navigateur afficher la ligne (fonctionne aussi en arrière-plan)
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Le chargement se fait à part : la fenêtre s'affiche tout de suite, à sa taille, avec l'écran d'initialisation
    setTimeout(() => this.#charger(), 0);
  }

  async #charger() {
    const etat = this.element.querySelector(".holo-etat");
    try {
      await this.#etape("Ouverture de la projection holographique", 0.05);
      THREE ??= await import(THREE_URL);
      await this.#etape("Liaison IGN BD TOPO · Paris", 0.25);
      this.#niveau = niveauVoulu();
      this.#donnees = await chargerNiveau(this.#niveau);
      await this.#etape(`${this.#donnees.calques.batiments.nb.toLocaleString("fr-FR")} bâtiments reçus · relief et monuments`, 0.55);
      await this.#etape("Construction de la ville", 0.7);
      const barre = this.element.querySelector(".boot-barre i");
      if ( barre ) { barre.style.transition = "transform 2.5s cubic-bezier(.2,.6,.4,1)"; barre.style.transform = "scaleX(.95)"; }
    } catch(err) {
      etat.textContent = `Hologramme indisponible : ${err.message}`;
      this.element.querySelector(".boot-lignes")?.append(Object.assign(document.createElement("div"), { className: "boot-ligne erreur", textContent: `> Échec : ${err.message}` }));
      return;
    }
    this.#majEtat();
    const choix = this.element.querySelector("[data-holo=qualite]");
    choix.value = game.settings.get(ID, "qualite");
    choix.addEventListener("change", async ev => {
      const valeur = ev.currentTarget.value;
      await game.settings.set(ID, "qualite", valeur);
      if ( valeur === "auto" ) await game.settings.set(ID, "qualiteMesuree", "");  // nouvelle mesure
      const n = niveauVoulu();
      if ( n !== this.#niveau ) await this.#changerNiveau(n);
      if ( valeur === "auto" ) this.#mesure = { debut: performance.now() + 500, images: 0 };
    });
    this.element.querySelector("[data-holo=masquage]").addEventListener("click", ev => {
      this.#masquage = !this.#masquage; ev.currentTarget.classList.toggle("actif", this.#masquage); this.#reconstruire(); });
    this.element.querySelector("[data-holo=ping]").addEventListener("click", () => this.#basculerModePing());
    const btnRotation = this.element.querySelector("[data-holo=rotation]");
    const majRotation = () => {
      btnRotation.classList.toggle("actif", this.#rotation);
      btnRotation.querySelector("i").className = `fa-solid ${this.#rotation ? "fa-pause" : "fa-play"}`;
      btnRotation.querySelector("span").textContent = this.#rotation ? "Rotation" : "Rotation arrêtée";
    };
    this.#rotation = game.settings.get(ID, "rotation"); majRotation();
    btnRotation.addEventListener("click", () => { this.#rotation = !this.#rotation; majRotation(); game.settings.set(ID, "rotation", this.#rotation); });
    this.element.querySelector("[data-holo=territoires]").addEventListener("click", ev => {
      this.#modeTerritoires = modeSuivant(this.#modeTerritoires);
      ev.currentTarget.classList.toggle("actif", this.#modeTerritoires !== "off");
      ev.currentTarget.querySelector("span").textContent = MODES[this.#modeTerritoires];
      this.#majTerritoires();
    });
    this.element.querySelector("[data-holo=voirLieux]").addEventListener("click", ev => {
      const visibles = !this.#reperes?.basculerVisibilite();
      ev.currentTarget.classList.toggle("actif", visibles);
      ev.currentTarget.querySelector("i").className = `fa-solid ${visibles ? "fa-eye" : "fa-eye-slash"}`;
    });
    this.element.querySelector("[data-holo=voirUnites]").addEventListener("click", ev => {
      ev.currentTarget.classList.toggle("actif", !!this.#calqueUnites?.basculerVisibilite());
    });
    this.element.querySelector("[data-holo=lieux]").addEventListener("click", ev => {
      ev.currentTarget.classList.toggle("actif", !!this.#reperes?.basculerListe()); });
    this.element.querySelector("[data-holo=umbra]").addEventListener("click", ev => {
      this.#mode = this.#mode === "tech" ? "umbra" : "tech"; ev.currentTarget.classList.toggle("actif", this.#mode === "umbra"); this.#reconstruire(); });
    this.#demarrer();
    const barreFin = this.element.querySelector(".boot-barre i"); if ( barreFin ) barreFin.style.transition = "transform .45s linear";
    await this.#etape("Synchronisation des unités", 1);
    await new Promise(r => setTimeout(r, DUREE_ETAPE));  // la dernière ligne et la barre pleine restent un instant
    // Fin de l'écran d'initialisation : la ville s'élève
    this.element.querySelector(".holo-boot")?.classList.add("fin");
    this.#allumage = matchMedia("(prefers-reduced-motion: reduce)").matches ? null : performance.now();
    if ( !this.#allumage ) this.#finAllumage();
  }

  /** Fin de l'allumage : étiquettes visibles, cartes des unités en cascade */
  #finAllumage() {
    this.#allumage = null; this.#pret = true;
    this.element?.querySelector(".holo-scene")?.classList.add("allumee");
    this.element?.querySelector(".holo-boot")?.remove();
    this.#majUnites();
    // Mode automatique, première fois sur ce PC : on mesure la fluidité pendant 3 secondes
    if ( (game.settings.get(ID, "qualite") === "auto") && !game.settings.get(ID, "qualiteMesuree") ) {
      this.#mesure = { debut: performance.now() + 500, images: 0 };
    }
  }

  #majEtat() {
    const etat = this.element?.querySelector(".holo-etat"); if ( !etat || !this.#donnees ) return;
    etat.textContent = `${this.#donnees.calques.batiments.nb.toLocaleString("fr-FR")} bâtiments (qualité ${NOMS_NIVEAU[this.#niveau]}), relief et monuments · IGN BD TOPO, Licence Ouverte 2.0`;
  }

  /**
   * Change la densité de la ville. Le calcul fige l'écran une à deux secondes : on remet donc l'écran de chargement
   * (mêmes lignes, même barre), puis la ville s'élève à nouveau.
   */
  async #changerNiveau(n, { automatique = false } = {}) {
    const scene = this.element?.querySelector(".holo-scene"); if ( !scene ) return;
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scene.querySelector(".holo-boot")?.remove();
    const boot = document.createElement("div");
    boot.className = "holo-boot";
    boot.innerHTML = `<div class="boot-titre">CONSEIL DE PARIS</div><div class="boot-lignes"></div><div class="boot-barre"><i></i></div>`;
    scene.append(boot);
    this.#dernierPas = 0;
    await this.#etape(automatique ? `Adaptation à ce PC : qualité ${NOMS_NIVEAU[n]}` : `Passage en qualité ${NOMS_NIVEAU[n]}`, 0.15);
    this.#donnees = await chargerNiveau(n);
    this.#niveau = n;
    await this.#etape(`${this.#donnees.calques.batiments.nb.toLocaleString("fr-FR")} bâtiments reçus`, 0.5);
    await this.#etape("Reconstruction de la ville", 0.7);
    const barre = boot.querySelector(".boot-barre i");
    if ( barre ) { barre.style.transition = "transform 2.5s cubic-bezier(.2,.6,.4,1)"; barre.style.transform = "scaleX(.95)"; }
    await new Promise(r => setTimeout(r, 60));
    this.#reconstruire();
    if ( !reduit ) this.#scene.ville.groupe.scale.y = 0.02;  // la ville s'élèvera de nouveau
    this.#majEtat();
    if ( barre ) barre.style.transition = "transform .45s linear";
    await this.#etape("Projection prête", 1);
    await new Promise(r => setTimeout(r, DUREE_ETAPE));
    boot.classList.add("fin");
    if ( reduit ) { boot.remove(); return; }
    this.#allumage = performance.now();
  }

  /** Mesure de fluidité : images rendues pendant 3 s. En légère : 50 images/s ou plus → complète. En complète : moins de 40 → légère. */
  #mesurer() {
    const m = this.#mesure, maintenant = performance.now();
    if ( maintenant < m.debut ) return;
    m.images++;
    const duree = maintenant - m.debut;
    if ( duree < 3000 ) return;
    const ips = m.images / (duree / 1000);
    this.#mesure = null;
    const n = this.#niveau === "complet" ? (ips >= 40 ? "complet" : "leger") : (ips >= 50 ? "complet" : "leger");
    game.settings.set(ID, "qualiteMesuree", n);
    if ( n !== this.#niveau ) {
      ui.notifications.info(`Hologramme : qualité ${NOMS_NIVEAU[n]} choisie pour ce PC (${Math.round(ips)} images/s mesurées).`);
      this.#changerNiveau(n, { automatique: true });
    }
  }

  #majUnites() {
    const zone = this.element?.querySelector(".holo-panneau"); if ( !zone ) return;
    if ( !this.#panneau ) {
      this.#panneau = new PanneauUnites(zone);
      zone.addEventListener("wod-unite-glisse", ev => this.#reperes?.activerDepot(ev.detail.actif));
    }
    const c = unitesCourantes();
    const unites = c.unites;
    this.#panneau.maj(unites, carteCourante().lieux);
    this.#calqueUnites?.maj(unites, this.#reperes?.reperes);
    // Pied de l'habillage : état du serveur et unités
    const n = Object.keys(unites).length, ok = c.etat === "connecte";
    const etat = this.element.querySelector(".hud-serveur");
    if ( etat ) {
      etat.querySelector(".pastille").classList.toggle("ko", !ok);
      etat.querySelector(".texte").textContent = `${ok ? "SERVEUR CONNECTÉ" : "SERVEUR HORS LIGNE"} · ${n} UNITÉ${n > 1 ? "S" : ""}`;
    }
  }

  #reconstruire() {
    const sc = this.#scene; if ( !sc ) return;
    if ( sc.ville ) { sc.S.remove(sc.ville.groupe); sc.ville.groupe.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    sc.etiquettes.forEach(e => e.el.remove());
    sc.ville = construireParis(THREE, this.#donnees, { mode: this.#mode, verticales: false, masquage: this.#masquage });
    sc.S.add(sc.ville.groupe); sc.R.setClearColor(PALETTES[this.#mode].fond);
    // Fondu : les traits s'éteignent vers la couleur du fond en s'éloignant de la caméra
    sc.S.fog = this.#masquage ? new THREE.Fog(PALETTES[this.#mode].fond, 1, 10) : null;
    sc.etiquettes = sc.ville.etiquettes.map(e => {
      const el = document.createElement("div"); el.className = `holo-etiquette ${e.classe}`; el.textContent = e.texte;
      if ( ["monument", "arrondissement"].includes(e.classe) ) el.addEventListener("click", ev => { ev.stopPropagation(); this.centrer(e.texte); });
      sc.conteneur.appendChild(el); return { el, v: e.position, pied: e.pied };
    });
    // Les repères dépendent du relief et des bâtiments : ils sont refaits avec la ville
    this.#reperes?.construire(carteCourante(), sc.ville);
    this.#majTerritoires();
    this.#majUnites();
  }

  /** (Re)construit le calque des territoires et la bulle des pastilles d'arrondissement */
  #majTerritoires() {
    const sc = this.#scene; if ( !sc || !this.#territoires ) return;
    this.#territoires.construire(carteCourante(), sc.ville, this.#modeTerritoires);
    this.#territoires.titrer(sc.etiquettes);
  }

  /** Unité déposée sur un lieu (MJ) : mission facultative, puis déploiement (statut engagé) */
  async #deployer(lieu, id) {
    const u = unitesCourantes().unites[id]; if ( !u || !game.user.isGM ) return;
    const dep = deployable(u);
    if ( !dep.ok ) return ui.notifications.warn(`${u.nom} : non déployable (${dep.raison}).`);
    const nomLieu = carteCourante().lieux?.[lieu]?.nom ?? lieu;
    const r = await foundry.applications.api.DialogV2.input({
      window: { title: `Déployer ${u.nom}` },
      content: `<p>Vers : <b>${foundry.utils.escapeHTML(nomLieu)}</b></p><label>Mission (facultatif) <input type="text" name="mission" maxlength="300" autofocus></label>`,
      ok: { label: "Déployer", icon: "fa-solid fa-person-walking-arrow-right" }, rejectClose: false
    });
    if ( !r ) return;
    await game.modules.get(ID).api.modifierUnite(id, { repere: lieu, statut: "engage", mission: String(r.mission ?? "").trim() });
  }

  /** Lieu choisi (étiquette ou liste) : la vue glisse vers lui */
  #allerVers(repere) {
    this.#cam.vers = repere.vue.clone();
    this.#cam.distVers = Math.min(this.#cam.dist, 1.1);
  }

  _onClose(options) {
    super._onClose(options);
    if ( this.#crochetCarte !== null ) Hooks.off(CROCHET, this.#crochetCarte);
    if ( this.#crochetCopie !== null ) Hooks.off("updateSetting", this.#crochetCopie);
    if ( this.#crochetUnites !== null ) Hooks.off(CROCHET_UNITES, this.#crochetUnites);
    this.#crochetCopie = this.#crochetUnites = null;
    this.#reperes?.detruire();
    this.#calqueUnites?.detruire();
    this.#territoires?.detruire();
  }

  /** Habillage : compas, cap, inclinaison, visée, heure (appelé à chaque image) */
  #majHud(cam) {
    const h = this.element; if ( !h ) return;
    const cap = (((-cam.az * 180 / Math.PI) % 360) + 360) % 360;
    h.querySelector(".hud-rose")?.setAttribute("transform", `rotate(${(-cap).toFixed(1)})`);
    const now = Date.now();
    if ( (now - (this.#hud ?? 0)) < 250 ) return;  // le texte ne change que 4 fois par seconde
    this.#hud = now;
    h.querySelector(".hud-cap").textContent = `CAP ${String(Math.round(cap)).padStart(3, "0")}° · SITE ${Math.round(cam.el * 180 / Math.PI)}°`;
    const [lon, lat] = depuisCarte(cam.cible.x * 1000, -cam.cible.z * 1000);
    h.querySelector(".hud-visee").textContent = `${lat.toFixed(4)} N · ${lon.toFixed(4)} E`;
    const d = new Date(now);
    h.querySelector(".hud-heure").textContent = d.toLocaleTimeString("fr-FR");
    h.querySelector(".hud-date").textContent = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
  }

  #demarrer() {
    const el = this.element.querySelector(".holo-scene");
    const R = new THREE.WebGLRenderer({ antialias: true }); R.setPixelRatio(Math.min(2, devicePixelRatio));
    el.appendChild(R.domElement);
    const S = new THREE.Scene(), C = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.#scene = { R, S, C, conteneur: el, etiquettes: [], ville: null };
    // Onde de balayage de l'allumage : un anneau lumineux qui part du centre et traverse la ville
    const onde = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128), new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    onde.rotation.x = -Math.PI / 2; onde.position.set(-0.8, 0.05, 0); onde.renderOrder = 4; onde.visible = false; S.add(onde);
    this.#scene.onde = onde;
    this.#reperes = new CalqueReperes(THREE, S, el, { selection: r => this.#allerVers(r), depot: (lieu, unite) => this.#deployer(lieu, unite) });
    this.#calqueUnites = new CalqueUnites(el, { montrerGroupe: g => this.#panneau?.montrerGroupe(g) });
    this.#territoires = new CalqueTerritoires(THREE, S, el);
    this.#crochetCarte = Hooks.on(CROCHET, () => { this.#reperes?.construire(carteCourante(), this.#scene?.ville); this.#majTerritoires(); this.#majUnites(); });
    this.#reconstruire();
    if ( !matchMedia("(prefers-reduced-motion: reduce)").matches ) this.#scene.ville.groupe.scale.y = 0.02;  // la ville s'élèvera
    const cam = this.#cam; cam.cible = new THREE.Vector3(-0.8, 0, 0); let glisse = null;
    el.addEventListener("pointerdown", e => { if ( e.target.closest(".holo-etiquette, .holo-fiche, .holo-lieux") ) return; glisse = { x: e.clientX, y: e.clientY, a: cam.az, b: cam.el, t: performance.now() }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => { if ( !glisse ) return; cam.az = glisse.a - (e.clientX - glisse.x) * 0.006; cam.el = Math.max(0.1, Math.min(1.45, glisse.b + (e.clientY - glisse.y) * 0.004)); });
    el.addEventListener("pointerup", e => {
      // Clic sans rotation : on remet la vue où elle était et on traite le clic (ping)
      if ( glisse && (Math.hypot(e.clientX - glisse.x, e.clientY - glisse.y) < CLIC.px) && (performance.now() - glisse.t < CLIC.ms) ) {
        cam.az = glisse.a; cam.el = glisse.b; this.#clic(e);
      }
      glisse = null;
    });
    el.addEventListener("keydown", e => { if ( (e.key === "Escape") && this.#modePing ) { e.stopPropagation(); this.#basculerModePing(false); } });
    el.addEventListener("wheel", e => { if ( e.target.closest(".holo-fiche, .holo-lieux") ) return; e.preventDefault(); e.stopPropagation(); cam.distVers = null; cam.dist = Math.max(0.25, Math.min(18, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });
    const v = new THREE.Vector3(); let prec = performance.now();
    const boucle = () => {
      const maintenant = performance.now(), dt = Math.min(0.05, (maintenant - prec) / 1000); prec = maintenant;
      if ( !this.rendered ) { R.dispose(); return; }  // fenêtre fermée : on libère la carte graphique
      const w = el.clientWidth, h = el.clientHeight;
      if ( (R.domElement.width !== Math.round(w * R.getPixelRatio())) || (R.domElement.height !== Math.round(h * R.getPixelRatio())) ) {
        R.setSize(w, h, false); R.domElement.style.width = "100%"; R.domElement.style.height = "100%"; C.aspect = w / h; C.updateProjectionMatrix();
      }
      if ( !document.hidden && !this.minimized ) {  // pause quand la fenêtre est réduite ou l'onglet caché
        if ( !glisse && this.#rotation ) cam.az += 0.0008;
        if ( cam.vers ) { cam.cible.lerp(cam.vers, 0.08); if ( cam.cible.distanceTo(cam.vers) < 0.001 ) cam.vers = null; }
        if ( cam.distVers ) { cam.dist += (cam.distVers - cam.dist) * 0.08; if ( Math.abs(cam.dist - cam.distVers) < 0.01 ) cam.distVers = null; }
        const { az, el: el2, dist, cible } = cam;
        C.position.set(cible.x + Math.sin(az) * Math.cos(el2) * dist, cible.y + Math.sin(el2) * dist, cible.z + Math.cos(az) * Math.cos(el2) * dist);
        this.#scene.ville?.animer?.(dt);
        if ( this.#allumage ) {
          const p = Math.min(1, (performance.now() - this.#allumage) / 2200), e = 1 - Math.pow(1 - p, 3);
          const g = this.#scene.ville?.groupe; if ( g ) g.scale.y = 0.02 + 0.98 * Math.min(1, e * 1.15);
          const o = this.#scene.onde; o.visible = p < 1; o.scale.setScalar(0.05 + e * 16); o.material.opacity = 0.9 * (1 - p);
          if ( p >= 1 ) { g && (g.scale.y = 1); this.#finAllumage(); }
        }
        if ( S.fog ) { S.fog.near = dist * 0.55; S.fog.far = dist * 2.4; }
        C.lookAt(cible); R.render(S, C);
        if ( this.#mesure ) this.#mesurer();
        this.#majHud(cam);
        this.#animerPings(C, w, h, v);
        if ( this.#reperes ) { this.#reperes.groupe.visible = !this.#allumage; this.#reperes.animer(C, w, h, v, cam.dist); }
        this.#calqueUnites?.animer(C, w, h, v, !this.#allumage);
        if ( this.#territoires ) this.#territoires.groupe.visible = !this.#allumage;
        for ( const e of this.#scene.etiquettes ) {
          v.copy(e.v).project(C);
          e.el.hidden = v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
          e.el.style.left = `${(v.x + 1) / 2 * w}px`; e.el.style.top = `${(1 - v.y) / 2 * h}px`;
        }
      }
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
    this.#crochetCopie = Hooks.on("updateSetting", s => { if ( s.key === `${ID}.copie` ) this.#majUnites(); });
    this.#crochetUnites = Hooks.on(CROCHET_UNITES, () => this.#majUnites());
  }
}
