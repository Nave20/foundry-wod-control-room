/**
 * Panneau latéral des unités : groupes repliables, cartes au cadre « interface », animées à l'ouverture et à la fermeture.
 * Les données viennent du réglage « copie » (mini-serveur). Une mise à jour des données modifie les cartes sur place,
 * sans rejouer l'animation ; seules les nouvelles cartes s'allument.
 */
// Statuts et puissance (0 à 4) de la Réserve du Conseil de « Rolling in the Deep »
const STATUTS = { disponible: "Disponible", engage: "Engagée", blesse: "Indisponible", perdu: "Perdue", absent: "À gagner", vide: "Vide" };
const PUISSANCE_MAX = 4;
const ordre = u => u.ordre ?? 999;
const dateCourte = s => { const [a, m, j] = String(s).split("-"); return j ? `${j}/${m}` : s; };
const SIGNES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@";
const reduit = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const DECOR = '<i class="scan"></i><i class="coin"></i><i class="hachures"></i><i class="barre-haut"></i><i class="barre-bas"></i><i class="encoche"></i><i class="tri"></i>';

export class PanneauUnites {
  /** @param {HTMLElement} racine */
  constructor(racine) {
    this.racine = racine;
    this.ouverts = new Set();    // groupes dépliés
    this.connus = new Set();     // groupes déjà vus (un nouveau groupe s'ouvre par défaut)
    this.unites = {};
  }

  /** Nouvelles données : { id: unité } */
  maj(unites) {
    // Les unités « À gagner » ne sont pas encore au Conseil : elles n'apparaissent pas dans la salle de contrôle
    this.unites = Object.fromEntries(Object.entries(unites ?? {}).filter(([, u]) => u.statut !== "absent"));
    const groupes = this.#groupes();
    for ( const g of groupes.keys() ) if ( !this.connus.has(g) ) { this.connus.add(g); this.ouverts.add(g); }
    // Groupes : créer ou retirer les blocs, dans l'ordre alphabétique
    const blocs = new Map([...this.racine.querySelectorAll(":scope > .pnl-groupe")].map(b => [b.dataset.groupe, b]));
    for ( const [g, b] of blocs ) if ( !groupes.has(g) ) b.remove();
    for ( const [g, ids] of groupes ) {
      let bloc = blocs.get(g);
      if ( !bloc ) {
        bloc = document.createElement("div"); bloc.className = "pnl-groupe"; bloc.dataset.groupe = g;
        bloc.innerHTML = `<div class="pnl-titre" role="button" tabindex="0"><span class="pnl-nom"></span><span class="pnl-trait"></span><span class="pnl-nb"></span></div><div class="pnl-liste"></div>`;
        bloc.querySelector(".pnl-nom").textContent = g.toUpperCase();
        const titre = bloc.querySelector(".pnl-titre");
        const basculer = () => this.basculer(g);
        titre.addEventListener("click", basculer);
        titre.addEventListener("keydown", ev => { if ( ["Enter", " "].includes(ev.key) ) { ev.preventDefault(); basculer(); } });
        this.racine.append(bloc);
      }
      bloc.querySelector(".pnl-nb").textContent = ids.length;
      bloc.querySelector(".pnl-titre").classList.toggle("ouvert", this.ouverts.has(g));
      if ( this.ouverts.has(g) ) this.#remplir(bloc, ids, false);
    }
    // Groupes dans l'ordre de la Réserve (celui de leur première unité)
    const rang = g => Math.min(...(groupes.get(g) ?? []).map(id => ordre(this.unites[id])));
    [...this.racine.querySelectorAll(":scope > .pnl-groupe")].sort((a, b) => rang(a.dataset.groupe) - rang(b.dataset.groupe))
      .forEach(b => this.racine.append(b));
    if ( !groupes.size ) this.racine.innerHTML = `<p class="pnl-vide">Aucune unité.</p>`;
    else this.racine.querySelector(".pnl-vide")?.remove();
  }

  #groupes() {
    const groupes = new Map();
    for ( const [id, u] of Object.entries(this.unites) ) {
      const g = (u.groupe || "Unités").trim();
      if ( !groupes.has(g) ) groupes.set(g, []);
      groupes.get(g).push(id);
    }
    for ( const ids of groupes.values() ) ids.sort((a, b) => ordre(this.unites[a]) - ordre(this.unites[b]) || this.unites[a].nom.localeCompare(this.unites[b].nom, "fr"));
    return groupes;
  }

  basculer(g) {
    const bloc = this.racine.querySelector(`:scope > .pnl-groupe[data-groupe="${CSS.escape(g)}"]`); if ( !bloc ) return;
    const ouvrir = !this.ouverts.has(g);
    bloc.querySelector(".pnl-titre").classList.toggle("ouvert", ouvrir);
    if ( ouvrir ) { this.ouverts.add(g); this.#remplir(bloc, this.#groupes().get(g) ?? [], true); }
    else { this.ouverts.delete(g); this.#fermer(bloc); }
  }

  /** Cartes du groupe : mises à jour sur place, nouvelles cartes animées (toutes si `animer`) */
  #remplir(bloc, ids, animer) {
    const liste = bloc.querySelector(".pnl-liste");
    clearTimeout(liste._fermeture); liste.hidden = false;
    if ( animer ) liste.replaceChildren();
    const existantes = new Map([...liste.children].map(c => [c.dataset.id, c]));
    for ( const [id, c] of existantes ) if ( !ids.includes(id) ) c.remove();
    let rang = 0;
    ids.forEach(id => {
      let carte = existantes.get(id);
      const neuve = !carte;
      if ( neuve ) { carte = this.#creer(id); }
      liste.append(carte);
      this.#ecrire(carte, this.unites[id], neuve ? rang++ : null);
    });
  }

  #creer(id) {
    const c = document.createElement("div"); c.className = "pnl-carte"; c.dataset.id = id;
    c.innerHTML = `<div class="int">${DECOR}<div class="haut"><b></b><span class="st"></span></div>`
      + `<div class="jauge">${"<i></i>".repeat(PUISSANCE_MAX)}</div><div class="chips"></div><div class="pied"><span>PUISSANCE <em></em></span><span class="lieu"></span></div></div>`;
    return c;
  }

  /** Remplit une carte ; `rang` (nombre) = carte qui s'allume, avec ce décalage dans la cascade */
  #ecrire(c, u, rang) {
    const anim = (rang !== null) && !reduit();
    c.classList.toggle("mission", u.statut === "engage");
    c.classList.toggle("blessee", u.statut === "blesse");
    c.classList.toggle("perdue", ["perdu", "vide"].includes(u.statut));
    c.classList.toggle("absente", u.statut === "absent");
    c.querySelector(".st").textContent = STATUTS[u.statut] ?? u.statut;
    c.querySelector("em").textContent = `${u.force ?? 0}/${PUISSANCE_MAX}`;
    // Pied : où l'unité est engagée et quand elle revient
    const lieu = c.querySelector(".lieu");
    const engagee = ["engage", "blesse"].includes(u.statut);
    lieu.textContent = engagee ? [u.mission, u.retour ? `retour ${dateCourte(u.retour)}` : ""].filter(Boolean).join(" · ") : (u.lieu ?? "");
    lieu.title = engagee ? (u.mission ?? "") : (u.notes ?? "");
    // Étiquettes : nombre de mages et Arété (ou l'ancienne composition)
    const etiquettes = u.composition?.length ? u.composition
      : [u.membres ? `${u.membres} mage${u.membres > 1 ? "s" : ""}` : "", u.arete ? `Arété ${u.arete}` : ""].filter(Boolean);
    const chips = c.querySelector(".chips");
    chips.replaceChildren(...etiquettes.map((t, k) => {
      const s = document.createElement("span"); s.textContent = t; s.title = t;
      if ( anim ) s.style.animationDelay = `${0.55 + rang * 0.12 + k * 0.06}s`;
      return s;
    }));
    chips.hidden = !etiquettes.length;
    const nom = c.querySelector("b"), segments = [...c.querySelectorAll(".jauge i")];
    if ( !anim ) {
      nom.textContent = u.nom;
      segments.forEach((s, i) => s.classList.toggle("p", i < u.force));
      return;
    }
    c.classList.remove("sortie"); c.classList.add("anime");
    c.style.setProperty("--retard", `${rang * 0.12}s`);
    const base = rang * 120;
    this.#decrypter(nom, u.nom, base + 300);
    segments.forEach(s => s.classList.remove("p"));
    segments.slice(0, u.force).forEach((s, i) => setTimeout(() => s.classList.add("p"), base + 450 + i * 55));
  }

  #decrypter(el, txt, delai) {
    let t = 0; el.textContent = "";
    setTimeout(() => {
      const id = setInterval(() => {
        t += 1; const fixe = Math.floor(t / 2);
        el.textContent = txt.split("").map((ch, i) => (i < fixe || ch === " ") ? ch : SIGNES[Math.floor(Math.random() * SIGNES.length)])
          .join("").slice(0, Math.min(txt.length, t + 2));
        if ( fixe >= txt.length ) { clearInterval(id); el.textContent = txt; }
      }, 28);
    }, delai);
  }

  /** Fermeture : jauge qui se vide, nom brouillé, repli en un trait, de la dernière carte à la première */
  #fermer(bloc) {
    const liste = bloc.querySelector(".pnl-liste");
    const cartes = [...liste.children].reverse();
    if ( reduit() || !cartes.length ) { liste.hidden = true; liste.replaceChildren(); return; }
    cartes.forEach((c, i) => {
      const d = i * 90;
      setTimeout(() => {
        [...c.querySelectorAll(".jauge i.p")].reverse().forEach((s, k) => setTimeout(() => s.classList.remove("p"), k * 25));
        const b = c.querySelector("b"), txt = b.textContent; let t = 0;
        const id = setInterval(() => { t++; b.textContent = txt.split("").map((ch, k) => (ch === " " || k < txt.length - t * 2)
          ? (Math.random() < t / 6 ? SIGNES[Math.floor(Math.random() * SIGNES.length)] : ch) : "").join(""); if ( t > 8 ) clearInterval(id); }, 30);
      }, d);
      setTimeout(() => { c.classList.remove("anime"); void c.offsetWidth; c.classList.add("sortie"); }, d + 120);
    });
    liste._fermeture = setTimeout(() => { liste.hidden = true; liste.replaceChildren(); }, cartes.length * 90 + 600);
  }
}
