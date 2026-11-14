# Étape 4 : déployer les unités sur la carte (Control Room 0.4.0)

Document de conception, 14/11/2026. Il complète l'étape 4 du plan de la table de contrôle (vault, `Projets/Dev/WoD Homebrew/Plan - table de contrôle.md`) et ses décisions D1 à D10. Les choix du MJ sont marqués **MJ** ; les choix laissés au concepteur sont marqués *choix du concepteur* et peuvent être corrigés.

## Intention

Pendant la partie, les joueurs disent au MJ où ils envoient leurs forces (Rédempteurs, alliés du Conseil). Le MJ doit pouvoir poser une unité sur un lieu de l'hologramme en un geste, la voir sur la carte et la rappeler, tous les joueurs voyant le résultat. L'hologramme devient la carte d'état-major de la campagne.

Réussite : en séance, le MJ glisse une carte d'unité sur l'Opéra, tape éventuellement une mission, et tout le monde voit un symbole tactique au-dessus de l'Opéra ; au survol, la liste des unités présentes ; « Rappeler » la renvoie chez elle.

## Objectifs

1. Une unité est soit **à résidence** (son lieu par défaut), soit **déployée** sur un lieu. **MJ**
2. Glisser-déposer d'une carte d'unité du panneau vers un lieu (carte 3D ou liste « Lieux »), MJ seul.
3. Symbole tactique par groupe et par lieu, avec compteur ; infobulle au survol ; clic qui ouvre le groupe dans le panneau. **MJ** (option C des maquettes)
4. Un insigne par unité, visible sur sa carte du panneau et dans l'infobulle. **MJ**
5. Le changement repart vers « Rolling in the Deep », qui affiche le lieu de déploiement. **MJ**

## Non-objectifs (pour cette étape)

- Déployer sur un arrondissement entier ou sur un point libre de la carte : à creuser plus tard. **MJ**
- Déployer sur un lieu non révélé : inutile, ce sont les joueurs qui choisissent. **MJ**
- Retoucher la liste des unités (noms, groupes, résidences) : chantier séparé, plus tard. **MJ** Le code doit fonctionner avec la liste actuelle, y compris des unités sans résidence.
- Mode briefing (étape 5).

## Anti-objectifs

- Une icône par unité sur la carte (D7) : toujours une icône par groupe et par lieu.
- Un client de joueur qui reçoit l'identifiant d'un lieu non révélé (D8).
- Un déploiement perdu à la synchronisation suivante de « Rolling in the Deep ».
- Une baisse de fluidité notable de l'hologramme (D10).

## Règles métier

| Règle | Détail |
|---|---|
| Lieux cibles | Les lieux révélés de la carte (`pj` vrai), y compris le Royaume du Conseil (`siege-conseil`, dépôt sur le palais) et la Sérénité (`ascenseur-serenite`, dépôt sur le dirigeable). **MJ** |
| Unités déployables | Ni du groupe « À gagner » (pas encore gagnées), ni absentes. **MJ** Ni blessées, perdues ou vides. *Choix du concepteur.* Une unité déjà engagée peut être redéployée ailleurs (déplacement). |
| Déployer | `repere` = id du lieu, `statut` = `engage`, `mission` = texte saisi (facultatif, peut rester vide). **MJ** |
| Rappeler | `repere` vide, `statut` = `disponible`, `mission` et `retour` vidés (*choix du concepteur*). L'unité revient à sa résidence. **MJ** |
| Ce qui fait foi | Sur la carte, seul `repere` dit si une unité est déployée (*choix du concepteur*). Une unité `engage` sans `repere` (5 aujourd'hui, en mission hors carte) n'apparaît ni sur un lieu ni à sa résidence. Quand le statut passe à `disponible`, `perdu`, `vide` ou `absent`, quelle que soit la source (Foundry, MCP, « Rolling in the Deep »), le serveur vide `repere` ; `blesse` le garde (unité blessée sur place). |
| Lieu caché ou retiré ensuite | La validation stricte de `repere` (lieu existant et révélé) ne vaut qu'à la saisie (Foundry, MCP). La synchronisation ne refuse jamais une unité pour son `repere` ou sa `residence` : elle les garde (*choix du concepteur*). Lieu redevenu caché : le symbole reste chez le MJ, jamais chez les joueurs. Lieu retiré de la carte : le symbole n'est affiché nulle part, la donnée reste jusqu'au prochain rappel ou déploiement. |
| Résidence | `residence` = id d'un lieu, ou vide. Unité non déployée et sans résidence : absente de la carte (toujours dans le panneau). La résidence se règle par un clic droit sur la carte d'unité (« Définir la résidence », choix dans la liste des lieux) ; *choix du concepteur*. Les vraies résidences viendront avec la retouche de la liste. |

## Données (serveur local, point central)

Nouveaux champs d'unité, validés par `valider()` et décrits dans l'outil MCP `modifier_unite` :

| Champ | Valeur | Validation |
|---|---|---|
| `repere` | id de lieu ou `""` | à la saisie : doit exister dans la carte et être révélé, refus clair sinon ; à la synchronisation : format seul |
| `residence` | id de lieu ou `""` | à la saisie : doit exister dans la carte (révélé ou non) ; à la synchronisation : format seul |
| `insigne` | id d'insigne ou `""` | format `p1`…`p9` (planètes) ou `e01`…`e30` (écussons) |

Le champ texte `lieu` existant reste pour l'affichage libre.

**Conservation à la synchronisation** (*choix du concepteur*, indispensable) : `synchroniser()` remplace aujourd'hui toutes les unités par celles de « Rolling in the Deep ». Tant que la page ne connaît pas ces trois champs, le serveur doit les conserver pour chaque unité dont l'entrée synchronisée ne les fournit pas, même après `acquitter`. Tests à l'appui.

**Attribution des insignes** (*choix du concepteur*) : faite par le serveur pour toute unité sans insigne, à la création ou à la synchronisation, puis enregistrée.
- Groupe « Rédempteurs » : la planète trouvée dans le nom (Mercure p1, Vénus p2, Terre p3, Mars p4, Jupiter p5, Saturne p6, Uranus p7, Neptune p8, Pluton p9 ; insensible à la casse et aux accents).
- Autres unités, ou Rédempteur sans planète reconnue : le premier écusson libre, dans l'ordre de la planche.
- Le MJ peut changer l'insigne par clic droit sur la carte d'unité (« Changer d'insigne », planche en grille). Deux unités ne partagent pas un écusson ; s'il n'en reste plus, `""` (pas d'insigne affiché).

## Apparence (maquettes validées par le MJ le 14/11/2026)

**Insignes**, dessinés en SVG fil de fer dans le module (aucune image externe), couleur selon le statut comme le cadre de la carte :
- Écussons `e01`…`e30` : écusson commun ; 10 emblèmes (étoile, œil, clé, flamme, croissant, couronne, épée, tour, ailes, sablier) × 3 galons (aucun, deux chevrons dessous, deux barrettes dessus). Création originale dans l'esprit des grades de jeux tactiques. **MJ**
- Planètes `p1`…`p9` : disque avec le trait distinctif de la planète (cratères de Mercure, nuages de Vénus, continents et Lune de la Terre, calotte de Mars, bandes et tache de Jupiter, anneau de Saturne, anneau vertical d'Uranus, tache de Neptune, cœur de Pluton), entouré d'une orbite pointillée portant **autant d'étoiles que le rang de la planète**. **MJ**
- Les maquettes de référence (code SVG validé) sont dans `docs/superpowers/specs/2026-11-14-insignes-maquettes.html` ; le concepteur reprend ce dessin tel quel dans un fichier `scripts/insignes.mjs`.

**Carte d'unité du panneau** : l'insigne occupe une colonne à gauche (52 px), sur toute la hauteur ; le reste de la carte est inchangé. Le pied montre le lieu de déploiement puis, s'il y a lieu, `⌂ résidence`. **MJ**

**Symbole tactique sur la carte 3D** : rectangle d'état-major par groupe et par lieu, au bout d'une tige au-dessus du lieu, avec le compteur en pastille dans un coin. Plein pour les unités déployées, pointillé et pâle pour les unités à résidence (un lieu peut porter les deux). Plusieurs groupes : symboles côte à côte. Emblème intérieur et couleur par groupe : Rédempteurs or `#ffd27a`, Alliés du Conseil cyan pâle `#bff6ff` ; motif intérieur *choix du concepteur*. Rendu en étiquettes HTML comme les étiquettes de lieux existantes, ou en sprites, *choix du concepteur* selon la fluidité.

**Infobulle au survol du symbole** : groupe, nombre et nom du lieu en tête ; une ligne par unité avec insigne (28 px), nom, statut et puissance ; bouton « Rappeler » pour le MJ seul. Clic sur le symbole : le panneau ouvre ce groupe et met ses cartes en évidence. **MJ**

**Glisser** : pendant le glisser d'une carte déployable, les lieux cibles s'allument (balise, bâtiment, palais, Sérénité, lignes de la liste « Lieux ») ; une carte non déployable ne se glisse pas, avec une infobulle qui dit pourquoi.

**Dépôt** : petite fenêtre « Mission (facultatif) » avec « Déployer » et « Annuler ». **MJ**

## Boutons de l'hologramme

- « Repères » (existant) : masque les lieux ; les symboles d'unités **restent visibles**. **MJ**
- Nouveau bouton « Unités » : masque ou montre les symboles d'unités. **MJ**

## Joueurs

Les joueurs voient les symboles et l'infobulle (sans « Rappeler », sans glisser). Ils ne reçoivent jamais un id de lieu non révélé : une résidence sur un lieu caché n'apparaît pas chez eux. Aujourd'hui la copie des unités est un réglage de monde (`copie`) lisible par tous ; le concepteur choisit comment filtrer `repere` et `residence` avant qu'ils n'atteignent un joueur (copie filtrée à part, ou passage par la carte filtrée de `carte.mjs`).

## Serveur éteint

La carte, les symboles déjà reçus et le ping marchent ; glisser, rappeler et changer d'insigne sont refusés avec une notification claire.

## « Rolling in the Deep » (en fin d'étape)

La page doit conserver `repere`, `residence` et `insigne` reçus par la file des changements et afficher le lieu de déploiement dans la Réserve. Lire l'artefact avant de le modifier ; le champ existant `affectation` (objet court, aujourd'hui vide) y a peut-être un sens, à vérifier avant de le réutiliser ou de l'ignorer.

## Vérifications

- Tests serveur : validation des trois champs, refus d'un lieu non révélé pour `repere`, conservation à la synchronisation, attribution des insignes (planètes, écussons libres, unicité).
- Tests JS (fonctions pures) : regroupement des unités par lieu, groupe et état ; choix des unités déployables.
- Foundry, deux clients (MJ et joueur), serveur allumé puis éteint, images par seconde dans les deux qualités avant et après.
- Version 0.4.0, README et plan de la vault à jour ; push seulement après accord du MJ et vérification dans Foundry.
