/**
 * Fenêtre « Hologramme de Paris » : bâtiments réels (IGN BD TOPO) posés sur le relief, monuments en haute définition,
 * unités du mini-serveur en direct. Three.js est chargé depuis un CDN pour l'instant (à embarquer dans le module).
 */
import { lireParis, construireParis, PALETTES } from "./paris-hologram.mjs";
import { PanneauUnites } from "./units-panel.mjs";

const ID = "wod-control-room";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";
let THREE = null, donnees = null;

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

/** Mètres Lambert-93 (relatifs au centre du fichier) → latitude, longitude approchées (précision de l'ordre de la dizaine de mètres dans Paris) */
function latLon(x, y) {
  // Points d'appui : tour Eiffel et Notre-Dame
  const lon = 2.2945 + (x - (648219 - 652000)) * (2.3499 - 2.2945) / ((652297 - 648219));
  const lat = 48.8584 + (y - (6862257 - 6862000)) * (48.8530 - 48.8584) / ((6861640 - 6862257));
  return [lat, lon];
}

export class Hologramme extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "hologramme-paris", classes: ["hologramme-paris"],
    window: { title: "Hologramme de Paris", icon: "fa-solid fa-city", resizable: true },
    position: { width: 1180, height: 720 }
  };

  #mode = "tech";
  #verticales = false;
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

  /** Centre la vue sur un monument (nom tel qu'affiché) */
  centrer(nom) {
    const e = this.#scene?.etiquettes.find(x => x.el.textContent === nom); if ( !e ) return false;
    this.#cam.vers = (e.pied ?? e.v).clone(); this.#cam.distVers = 1.1; return true;
  }

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "holo";
    div.innerHTML = `<div class="holo-barre">
        <button type="button" data-holo="verticales">Arêtes verticales</button>
        <button type="button" data-holo="umbra">Vue Umbra</button>
        <button type="button" data-holo="masquage" class="actif">Masquage et fondu</button></div>
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
      if ( !donnees ) {
        const r = await fetch(`modules/${ID}/data/paris-light.bin`);
        if ( !r.ok ) throw new Error(`fichier introuvable (${r.status})`);
        donnees = lireParis(await r.arrayBuffer());
      }
      await this.#etape(`${donnees.calques.batiments.nb.toLocaleString("fr-FR")} bâtiments reçus · relief et monuments`, 0.55);
      await this.#etape("Construction de la ville", 0.7);
      const barre = this.element.querySelector(".boot-barre i");
      if ( barre ) { barre.style.transition = "transform 2.5s cubic-bezier(.2,.6,.4,1)"; barre.style.transform = "scaleX(.95)"; }
    } catch(err) {
      etat.textContent = `Hologramme indisponible : ${err.message}`;
      this.element.querySelector(".boot-lignes")?.append(Object.assign(document.createElement("div"), { className: "boot-ligne erreur", textContent: `> Échec : ${err.message}` }));
      return;
    }
    etat.textContent = `${donnees.calques.batiments.nb.toLocaleString("fr-FR")} bâtiments, relief et monuments · IGN BD TOPO, Licence Ouverte 2.0`;
    this.element.querySelector("[data-holo=verticales]").addEventListener("click", ev => {
      this.#verticales = !this.#verticales; ev.currentTarget.classList.toggle("actif", this.#verticales); this.#reconstruire(); });
    this.element.querySelector("[data-holo=masquage]").addEventListener("click", ev => {
      this.#masquage = !this.#masquage; ev.currentTarget.classList.toggle("actif", this.#masquage); this.#reconstruire(); });
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
  }

  #majUnites() {
    const zone = this.element?.querySelector(".holo-panneau"); if ( !zone ) return;
    this.#panneau ??= new PanneauUnites(zone);
    const c = game.settings.get(ID, "copie");
    const unites = c.donnees?.unites ?? {};
    this.#panneau.maj(unites);
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
    sc.ville = construireParis(THREE, donnees, { mode: this.#mode, verticales: this.#verticales, masquage: this.#masquage });
    sc.S.add(sc.ville.groupe); sc.R.setClearColor(PALETTES[this.#mode].fond);
    // Fondu : les traits s'éteignent vers la couleur du fond en s'éloignant de la caméra
    sc.S.fog = this.#masquage ? new THREE.Fog(PALETTES[this.#mode].fond, 1, 10) : null;
    sc.etiquettes = sc.ville.etiquettes.map(e => {
      const el = document.createElement("div"); el.className = `holo-etiquette ${e.classe}`; el.textContent = e.texte;
      if ( e.classe === "monument" ) el.addEventListener("click", ev => { ev.stopPropagation(); this.centrer(e.texte); });
      sc.conteneur.appendChild(el); return { el, v: e.position, pied: e.pied };
    });
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
    const [lat, lon] = latLon(cam.cible.x * 1000, -cam.cible.z * 1000);
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
    this.#reconstruire();
    if ( !matchMedia("(prefers-reduced-motion: reduce)").matches ) this.#scene.ville.groupe.scale.y = 0.02;  // la ville s'élèvera
    const cam = this.#cam; cam.cible = new THREE.Vector3(-0.8, 0, 0); let glisse = null;
    el.addEventListener("pointerdown", e => { if ( e.target.closest(".holo-etiquette") ) return; glisse = { x: e.clientX, y: e.clientY, a: cam.az, b: cam.el }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => { if ( !glisse ) return; cam.az = glisse.a - (e.clientX - glisse.x) * 0.006; cam.el = Math.max(0.1, Math.min(1.45, glisse.b + (e.clientY - glisse.y) * 0.004)); });
    el.addEventListener("pointerup", () => glisse = null);
    el.addEventListener("wheel", e => { e.preventDefault(); e.stopPropagation(); cam.distVers = null; cam.dist = Math.max(0.25, Math.min(18, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });
    const v = new THREE.Vector3(); let prec = performance.now();
    const boucle = () => {
      const maintenant = performance.now(), dt = Math.min(0.05, (maintenant - prec) / 1000); prec = maintenant;
      if ( !this.rendered ) { R.dispose(); return; }  // fenêtre fermée : on libère la carte graphique
      const w = el.clientWidth, h = el.clientHeight;
      if ( (R.domElement.width !== Math.round(w * R.getPixelRatio())) || (R.domElement.height !== Math.round(h * R.getPixelRatio())) ) {
        R.setSize(w, h, false); R.domElement.style.width = "100%"; R.domElement.style.height = "100%"; C.aspect = w / h; C.updateProjectionMatrix();
      }
      if ( !document.hidden && !this.minimized ) {  // pause quand la fenêtre est réduite ou l'onglet caché
        if ( !glisse ) cam.az += 0.0008;
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
        this.#majHud(cam);
        for ( const e of this.#scene.etiquettes ) {
          v.copy(e.v).project(C);
          e.el.hidden = v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
          e.el.style.left = `${(v.x + 1) / 2 * w}px`; e.el.style.top = `${(1 - v.y) / 2 * h}px`;
        }
      }
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
    Hooks.on("updateSetting", s => { if ( s.key === `${ID}.copie` ) this.#majUnites(); });
  }
}
