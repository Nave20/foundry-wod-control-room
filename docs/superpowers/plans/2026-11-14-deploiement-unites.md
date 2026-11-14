# Déploiement des unités (Control Room 0.4.0) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le MJ glisse une unité sur un lieu de l'hologramme ; tout le monde voit un symbole tactique par groupe au-dessus du lieu, avec infobulle, insignes et rappel vers la résidence.

**Architecture:** le serveur local porte trois nouveaux champs d'unité (`repere`, `residence`, `insigne`), les valide, les conserve à la synchronisation et attribue les insignes. Côté Foundry, des fonctions pures (`deploiement.mjs`, `insignes.mjs`) décident du regroupement, du filtrage joueurs et du dessin ; un nouveau calque HTML (`unites-calque.mjs`) place les symboles au-dessus des repères existants ; le panneau des unités devient source de glisser-déposer.

**Tech Stack:** Python 3 (stdlib, `unittest`), Foundry VTT V14 (ApplicationV2, réglages), Three.js déjà chargé par l'hologramme, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-14-deploiement-unites-design.md` (maquettes : `docs/superpowers/specs/2026-11-14-insignes-maquettes.html`).

## Global Constraints

- Textes d'interface en français ; nouvelles clés dans `lang/fr.json` sous `SALLE.`.
- Lieux cibles = lieux de la carte avec `pj` vrai, dont `siege-conseil` et `ascenseur-serenite`.
- Groupe non déployable : `"À gagner"`. Statuts non déployables : `absent`, `blesse`, `perdu`, `vide`.
- Statuts qui vident `repere` : `disponible`, `perdu`, `vide`, `absent` ; `blesse` le garde.
- Insignes : `p1`…`p9` (Mercure, Vénus, Terre, Mars, Jupiter, Saturne, Uranus, Neptune, Pluton), `e01`…`e30` (emblème `(n-1) % 10`, galons `floor((n-1)/10)`, dessin exact de la maquette).
- Couleurs de groupe : Rédempteurs `#ffd27a`, Alliés du Conseil `#bff6ff`, autres `#9fd8e8`.
- Un client de joueur ne reçoit jamais l'id d'un lieu non révélé (D8). Pas d'icône par unité sur la carte (D7).
- Tests : `node --test tests/*.test.mjs` et `python -m unittest discover -s server` (préfixe `PYTHONUTF8=1`).
- **Pas de commit par tâche** : le MJ valide chaque commit et chaque push. Un seul commit en fin de plan (tâche 8), après vérification dans Foundry et accord du MJ. Identité git : noreply du dépôt, jamais d'adresse personnelle.

## Review Focus

1. Synchronisation de « Rolling in the Deep » après un déploiement puis `acquitter` : le déploiement doit survivre (test dans la tâche 1).
2. Une unité passée `perdu` par la page alors qu'elle est déployée : elle disparaît du lieu (test dans la tâche 1).
3. Résidence sur un lieu caché : visible chez le MJ, absente de la copie des joueurs (test dans la tâche 3).
4. Deux unités sans insigne créées dans la même synchronisation : écussons distincts, dans l'ordre (test dans la tâche 2).
5. Dépôt quand le serveur est hors ligne : refus avec notification, rien ne bouge sur la carte (vérification Foundry, tâche 8).

---

### Task 1: Serveur — champs `repere` et `residence`, règles de statut, conservation

**Files:**
- Modify: `server/control_room_server.py` (`valider`, `Magasin.modifier`, `Magasin.synchroniser`, schéma MCP `modifier_unite`)
- Test: `server/test_server.py` (nouvelle classe `TestDeploiement`)

**Interfaces:**
- Produces: constantes `LOCAUX = ("repere", "residence", "insigne")`, `STATUTS_RAPPEL = ("disponible", "perdu", "vide", "absent")` ; `valider(champs, carte=None)` ; `Magasin.modifier(uid, champs)` qui valide `repere`/`residence` contre `self.carte()`.

- [ ] **Step 1: Write the failing tests** (`TestDeploiement`, carte de test avec `opera` révélé et `cave` caché)

```python
def test_deployer_sur_lieu_revele(self):
    d = self.m.modifier("r-mercure", {"repere": "opera", "statut": "engage"})
    self.assertEqual(d["unites"]["r-mercure"]["repere"], "opera")
def test_refus_lieu_cache_ou_inconnu(self):
    for lid in ("cave", "nulle-part"):
        with self.assertRaises(ValueError): self.m.modifier("r-mercure", {"repere": lid})
def test_residence_peut_etre_cachee(self):
    self.assertEqual(self.m.modifier("r", {"residence": "cave"})["unites"]["r"]["residence"], "cave")
def test_statut_rappel_vide_repere(self):
    self.m.modifier("r", {"repere": "opera", "statut": "engage"})
    self.assertEqual(self.m.modifier("r", {"statut": "perdu"})["unites"]["r"]["repere"], "")
def test_blesse_garde_repere(self): ...  # statut "blesse" → repere toujours "opera"
def test_synchro_conserve_les_champs_locaux(self):
    self.m.modifier("r", {"repere": "opera", "residence": "cave", "statut": "engage"})
    self.m.acquitter(10**6)
    self.m.synchroniser({"r": {"nom": "R", "statut": "engage"}})
    u = self.m.public()["unites"]["r"]; self.assertEqual((u["repere"], u["residence"]), ("opera", "cave"))
def test_synchro_statut_rappel_vide_repere(self): ...  # page envoie statut "perdu" → repere ""
def test_synchro_ne_refuse_pas_un_lieu_cache(self):
    self.m.synchroniser({"r": {"nom": "R", "repere": "cave"}})  # ne lève pas
```

- [ ] **Step 2: Run** `PYTHONUTF8=1 python -m unittest server.test_server.TestDeploiement -v` (depuis la racine du module, ou `discover -s server`) — Expected: FAIL (champ inconnu : repere).

- [ ] **Step 3: Implement.** `valider` accepte `repere`, `residence` (id au format `ID_UNITE` ou `""`) et `insigne` (`p[1-9]|e(0[1-9]|[12]\d|30)` ou `""`). Avec `carte` fournie (saisie), `repere` doit être un lieu `pj` et `residence` un lieu existant ; sans `carte` (synchronisation), format seul. Après application des champs, dans `modifier` comme dans `synchroniser`, si `statut ∈ STATUTS_RAPPEL` alors `repere = ""`. Dans `synchroniser`, pour chaque unité déjà connue, recopier les `LOCAUX` absents de l'entrée reçue. Ajouter les trois champs au schéma MCP `modifier_unite` (descriptions en français).

- [ ] **Step 4: Run** toute la suite serveur — Expected: PASS (14 anciens + nouveaux).

### Task 2: Serveur — attribution des insignes

**Files:**
- Modify: `server/control_room_server.py` (fonction `attribuer_insignes`, appelée à la fin de `modifier` et de `synchroniser`)
- Test: `server/test_server.py` (`TestInsignes`) ; mettre à jour l'assertion exacte de `test_creation_et_modification` (ajout de `"insigne": "e01"`)

**Interfaces:**
- Produces: `attribuer_insignes(unites: dict) -> bool` (modifie sur place, renvoie True si au moins un insigne a été posé). Ne passe pas par la file `en_attente`.

- [ ] **Step 1: Write the failing tests**

```python
def test_planete_depuis_le_nom(self):
    u = {"a": {"nom": "Rédempteurs de Neptune", "groupe": "Rédempteurs"}, "b": {"nom": "Rédempteur de Pluton (K. Varga)", "groupe": "Rédempteurs"}}
    attribuer_insignes(u); self.assertEqual((u["a"]["insigne"], u["b"]["insigne"]), ("p8", "p9"))
def test_ecussons_libres_dans_l_ordre(self):
    u = {"x": {"nom": "X", "insigne": "e01"}, "y": {"nom": "Y", "ordre": 2}, "z": {"nom": "Z", "ordre": 1}}
    attribuer_insignes(u); self.assertEqual((u["z"]["insigne"], u["y"]["insigne"]), ("e02", "e03"))
def test_redempteur_sans_planete_prend_un_ecusson(self): ...  # "Rédempteurs inconnus" → "e01"
def test_plus_d_ecusson_libre(self): ...  # 30 écussons pris → nouvelle unité garde ""
def test_insigne_existant_conserve(self): ...  # "insigne": "e07" reste "e07"
```

- [ ] **Step 2: Run** — Expected: FAIL (`attribuer_insignes` introuvable).
- [ ] **Step 3: Implement.** Planète cherchée comme mot entier dans le nom normalisé (sans accents, minuscules) pour le groupe `Rédempteurs` (« la terre » → p3). Ordre d'attribution des écussons : `ordre` puis nom. Une unité qui a un insigne non vide le garde ; `""` ou absent = à attribuer.
- [ ] **Step 4: Run** toute la suite serveur — Expected: PASS.

### Task 3: Fonctions pures du déploiement

**Files:**
- Create: `scripts/deploiement.mjs`
- Test: `tests/deploiement.test.mjs`

**Interfaces:**
- Produces:
  - `deployable(u) -> { ok: boolean, raison: string }` (raisons : `"À gagner"`, `"Absente"`, `"Indisponible"`, `"Perdue"`, `"Vide"`).
  - `regrouper(unites, lieux) -> Map<lieuId, Array<{ groupe, etat: "deploye"|"residence", ids: string[] }>>` : `repere` non vide → déployée sur ce lieu ; sinon `statut !== "engage"` et `residence` → à résidence ; lieux absents de `lieux` ignorés ; groupes triés (Rédempteurs, Alliés du Conseil, puis alphabétique), `deploye` avant `residence`.
  - `filtrerUnites(unites, lieux) -> unites` : copie où `repere` et `residence` qui ne pointent pas vers un lieu `pj` sont vidés.
  - `GROUPES = { "Rédempteurs": { couleur: "#ffd27a" }, "Alliés du Conseil": { couleur: "#bff6ff" } }`, `couleurGroupe(g)`.

- [ ] **Step 1: Write the failing tests** : unité « À gagner » refusée ; `blesse` refusée ; `engage` acceptée (déplacement) ; regroupement de 3 Rédempteurs dont 2 sur `opera` et 1 à résidence `opera` → deux entrées `deploye` (2) et `residence` (1) ; `engage` sans repère absente du résultat ; lieu inconnu ignoré ; `filtrerUnites` vide une résidence sur un lieu `pj: false` et garde celle sur un lieu `pj: true`.
- [ ] **Step 2: Run** `node --test tests/deploiement.test.mjs` — Expected: FAIL (module introuvable).
- [ ] **Step 3: Implement** les quatre exports.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

### Task 4: Insignes en SVG

**Files:**
- Create: `scripts/insignes.mjs`
- Test: `tests/insignes.test.mjs`

**Interfaces:**
- Produces: `svgInsigne(id: string, couleur: string, taille: number) -> string` (balise `<svg>` complète, `""` pour un id vide ou inconnu) ; `IDS_INSIGNES: string[]` (`p1`…`p9`, `e01`…`e30`).

- [ ] **Step 1: Write the failing tests** : 39 ids ; `svgInsigne("e12", "#fff", 40)` contient l'emblème « œil » et les chevrons ; `svgInsigne("p9", …)` contient 9 étoiles (9 `<path` d'étoile) ; ids de `clipPath` uniques entre deux appels ; `svgInsigne("zz")` vaut `""`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** en reprenant exactement les tracés de `2026-11-14-insignes-maquettes.html` (fonctions `ecusson` et `planete`), avec un compteur pour les ids de `clipPath`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

### Task 5: Liaison Foundry — copie MJ complète, copie joueurs filtrée, API de modification

**Files:**
- Modify: `scripts/control-room.mjs` (`publier`, `modifier`, réglages, `api`)
- Modify: `lang/fr.json`

**Interfaces:**
- Consumes: `filtrerUnites` (tâche 3), `carteMj` de `carte.mjs`.
- Produces: réglage client `unitesMj` (`{ version, unites }`, MJ seul) ; le réglage monde `copie` reçoit `filtrerUnites(unites, carteMj.lieux)` ; `unitesCourantes() -> { etat, unites }` exportée (MJ : `unitesMj` si présent, sinon `copie`) ; `api.modifierUnite(uid, champs) -> Promise<boolean>` (false et notification `SALLE.HorsLigne` si serveur hors ligne ou refus).

- [ ] **Step 1:** `publier` écrit `unitesMj` (si MJ) puis la copie filtrée ; republier quand la carte change (`publierCarte` → refiltrage).
- [ ] **Step 2:** `modifier` renvoie un booléen ; hors ligne : `ui.notifications.warn(loc("HorsLigne"))`.
- [ ] **Step 3:** `hologram.mjs` (`#majUnites`) et `units-panel.mjs` lisent `unitesCourantes()` ; le crochet `updateSetting` écoute aussi `unitesMj`.
- [ ] **Step 4: Verify** dans Foundry (MJ) : `game.settings.get("wod-control-room","copie").donnees.unites` ne contient aucun `residence` vers un lieu caché après avoir posé une résidence cachée via `api.modifierUnite`.

### Task 6: Panneau des unités — insigne, pied, glisser, menu contextuel

**Files:**
- Modify: `scripts/units-panel.mjs`, `styles/control-room.css`, `lang/fr.json`

**Interfaces:**
- Consumes: `svgInsigne`, `deployable`, `api.modifierUnite`, noms des lieux (`carteCourante().lieux`).
- Produces: cartes `.pnl-carte` `draggable` (MJ et `deployable(u).ok`) avec `dataTransfer` type `application/x-wod-unite` = id ; événement DOM `wod-unite-glisse` (`detail: { id, actif: boolean }`) émis sur le conteneur au début et à la fin du glisser ; méthode `PanneauUnites.montrerGroupe(groupe: string)` (ouvre le groupe, classe `.evidence` 2 s sur ses cartes).

- [ ] **Step 1:** colonne insigne 52 px à gauche de `.int` (grille), couleur `var(--c)` ; pied : nom du lieu de `repere` puis `⌂ ` + nom de la résidence.
- [ ] **Step 2:** glisser : carte non déployable → `draggable=false` et `title` = raison.
- [ ] **Step 3:** clic droit (MJ) : menu « Rappeler » (si `repere`), « Définir la résidence » (liste des lieux, recherche simple, option « Aucune »), « Changer d'insigne » (grille des 39 insignes, ceux déjà pris grisés). Rappeler envoie `{ repere: "", statut: "disponible", mission: "", retour: "" }`.
- [ ] **Step 4: Verify** dans Foundry : cartes avec insignes, glisser refusé pour « À gagner », menu fonctionnel.

### Task 7: Calque des unités sur l'hologramme et dépôt

**Files:**
- Create: `scripts/unites-calque.mjs`
- Modify: `scripts/hologram.mjs` (bouton `data-holo="voirUnites"`, branchement), `scripts/reperes.mjs` (cibles de dépôt), `styles/control-room.css`, `lang/fr.json`

**Interfaces:**
- Consumes: `regrouper`, `couleurGroupe`, `svgInsigne`, `CalqueReperes.reperes` (`r.id`, `r.ancre`, `r.etiquette`), `PanneauUnites.montrerGroupe`, `api.modifierUnite`.
- Produces: `class CalqueUnites { constructor(conteneur, rappels: { montrerGroupe(g) }) ; maj(unites, reperes) ; animer(C, w, h, v) ; basculerVisibilite() -> boolean ; detruire() }` ; `CalqueReperes.activerDepot(actif: boolean)` et rappel `depot(lieuId, uniteId)`.

- [ ] **Step 1:** symboles HTML `.holo-unite` (rectangle d'état-major 46 × 34, motif par groupe, pastille compteur, pointillé pâle pour `residence`), placés à `r.ancre` projetée, décalés vers le haut ; plusieurs groupes côte à côte. Visibles même repères masqués ; cachés par le bouton « Unités ».
- [ ] **Step 2:** infobulle au survol : en-tête groupe · nombre · lieu ; une ligne par unité (insigne 28 px, nom, statut, puissance) ; « Rappeler » si MJ. Clic sur le symbole → `montrerGroupe`.
- [ ] **Step 3:** dépôt : sur `wod-unite-glisse` actif, `activerDepot(true)` rend visibles et accepte le dépôt sur les étiquettes des lieux `pj` (y compris palais et Sérénité, même repères masqués) et les lignes de la liste « Lieux » ; surbrillance (`.cible`) et pulsation renforcée. Dépôt → fenêtre `DialogV2` « Mission (facultatif) » → `modifierUnite(id, { repere, statut: "engage", mission })`.
- [ ] **Step 4: Verify** dans Foundry : déployer une unité sur l'Opéra, puis une autre du même groupe (compteur 2), une sur la Sérénité ; survol, clic, rappel ; boutons « Repères » et « Unités » ; images par seconde mesurées avant et après, qualités légère et complète.

### Task 8: Vérification, version, documentation

**Files:**
- Modify: `module.json` (0.4.0), `README.md`, plan de la vault (étape 4 : fait)

- [ ] **Step 1:** les deux suites de tests passent.
- [ ] **Step 2:** deux clients (MJ « Claude » et un joueur) : le joueur voit les symboles des lieux révélés, pas de « Rappeler », pas de glisser ; résidence cachée invisible.
- [ ] **Step 3:** serveur éteint : symboles toujours affichés, déploiement refusé avec notification ; rallumé : tout repart.
- [x] **Step 4:** demander au MJ l'accord pour commiter (les retouches d'avant l'étape 4 dans un commit à part, puis l'étape 4) et pour pousser.

### Task 9 (fin d'étape, après accord du MJ) : « Rolling in the Deep »

- [x] Lire l'artefact (action `read`), y compris le sens d'`affectation`.
- [x] Conserver `repere`, `residence`, `insigne` reçus et afficher le lieu de déploiement dans la Réserve ; republier après accord du MJ.

Fait le 14/11/2026 (page « Rolling in the Deep », versions 19 à 23), vérifié par le MJ (Mercure déployée à la Tour Eiffel) :

- Ruling : `repere`, `residence`, `insigne` ne sont ni écrits dans la base de la page ni renvoyés ; la page les affiche
  d'après `lister_unites`. Coût si faux : la page ne montre rien quand le serveur est éteint.
- Décision du MJ : report automatique conservé, plus un journal « Reçu de Foundry » (collection `journal_pont`, document
  `s<seq>`, 40 derniers) ; une file reportée deux fois (deux fenêtres ouvertes) ne double plus le journal.
- Décision du MJ : pas de date de retour automatique pour une unité engagée depuis Foundry ; un déploiement efface une
  ancienne date de retour.
- Constat : le serveur MCP lancé par l'application Claude gardait le code d'avant la 0.4.0 et a effacé repères et
  insignes à la synchronisation ; corrigé en relançant l'application (README).
- Constat : après la relance, l'application annulait l'envoi automatique (confirmation non affichée) ; bouton
  « Renvoyer à Foundry », et renvoi de l'état final après chaque acquittement.
