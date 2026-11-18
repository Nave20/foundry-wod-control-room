# Control Room — World of Darkness, Paris

A Foundry VTT (V14) module: a holographic 3D map of the real city of Paris (IGN BD TOPO buildings, relief and landmarks)
and a live panel of units, kept in sync with a small server running on the GM's computer. A Claude artifact can read
and update the same data through that server (MCP), so a change on one side shows on the other.

**This module needs its mini-server** (folder `server/`, Python 3.10+, no other dependency). Without it, the module stays
locked and changes nothing. The interface is in French for now; an English translation is planned.

Map data: **IGN BD TOPO**, Licence Ouverte 2.0 (Etalab). `tools/extract_paris.py` rebuilds `data/*.bin` from the IGN
GeoPackage for Paris (département 75).

---

## Salle de contrôle (preuve de concept)

> **Ce module ne fonctionne pas seul.** Il a besoin du **mini-serveur** fourni dans le dossier `server/`,
> lancé sur l'ordinateur du MJ. Sans serveur, le module reste **bloqué** : un avertissement s'affiche au
> démarrage, la fenêtre explique quoi faire, et rien n'est lu ni modifié. Il se débloque tout seul dès que
> le serveur répond (le MJ réessaie toutes les 15 secondes).

## Ce que fait le module

Le groupe « Salle de contrôle » de la barre d'outils, à gauche, ouvre l'hologramme de Paris d'un clic ; son second outil ouvre la fenêtre des unités (nom, force, statut). Dans l'hologramme, le bouton « Repères » masque les lieux pour lire la carte (le palais du Conseil et la Sérénité restent).

- Le **mini-serveur** garde ces données dans un fichier sur l'ordinateur du MJ. C'est la seule source de vérité.
- **Foundry** : chaque MJ lit le serveur toutes les 3 secondes ; seul le MJ actif transmet les changements aux joueurs.
  Le MJ peut modifier la force, le statut, ou ajouter une unité ; les joueurs voient tout en lecture seule.
- **Un artefact Claude** peut lire et modifier les mêmes données par le même serveur (mode MCP). Une modification d'un
  côté apparaît de l'autre.

### Déployer les unités (0.4.0)

- **Glisser-déposer (MJ)** : faire glisser une carte d'unité du panneau sur un lieu révélé de l'hologramme (étiquette,
  palais du Conseil, Sérénité) ou sur une ligne de la liste « Lieux ». Une mission facultative est demandée ; l'unité
  passe « engagée ». Les unités « À gagner », absentes, blessées, perdues ou vides ne se déploient pas.
- **Symboles d'état-major** : au-dessus de chaque lieu occupé, un symbole par groupe avec le nombre d'unités (plein :
  déployées ; pointillé : à résidence). Au survol, la liste des unités et « Rappeler » ; un clic ouvre le groupe dans le
  panneau. Le bouton « Unités » masque les symboles ; ils restent visibles quand les repères sont masqués.
- **Clic droit sur une carte d'unité (MJ)** : Rappeler (retour à la résidence, statut disponible), définir la
  résidence, changer d'insigne.
- **Insignes** : planète des Rédempteurs (autant d'étoiles que son rang depuis le Soleil) ou écusson parmi 30,
  attribués par le serveur. Les champs `repere`, `residence` et `insigne` sont gardés par le serveur même quand
  « Rolling in the Deep » ne les connaît pas. Les joueurs ne reçoivent jamais un lieu caché.

### Lieux de « Paris occulte » sur l'hologramme

Le mini-serveur garde aussi la carte de Paris tirée de l'artefact « Paris occulte » : lieux, factions, arrondissements
et quartiers. « Paris occulte » reste la référence ; la carte envoyée remplace la précédente.

- **Envoyer la carte** : voir la documentation de Campaign Console (le serveur reçoit la carte et la relaie à Foundry).
- **Foundry** : le MJ actif relit la carte avec les unités. Il garde la carte complète sur son PC ; les joueurs reçoivent
  seulement les lieux révélés, avec le texte prévu pour eux.
- **Hologramme** : chaque lieu allume le vrai bâtiment le plus proche (à la couleur de sa faction), ou une balise au sol
  s'il n'y en a pas à moins de 40 m. Le Royaume du Conseil flotte en anneau doré au-dessus du 18e, relié à ses portes.
  Un clic sur une étiquette ouvre la fiche du lieu ; le bouton **Lieux** ouvre la liste, avec recherche et filtres.
  Le MJ voit aussi les lieux non révélés, en pointillés.

### Territoires par arrondissement

Le bouton **Territoires** de l'hologramme teinte chaque arrondissement selon la faction qui le tient (éteint par défaut,
pour garder la carte bleue). Un clic de plus passe du mode **simplifié** (rouge vampires, bleu mages, vert garous, gris
Technocratie, hachures pour les zones disputées) au mode **détaillé** (couleur de chaque faction), puis l'éteint.
Les bâtiments ne sont pas teintés : un aplat au sol, un liseré et un rideau lumineux bas le long des limites. Une
légende s'affiche, et la bulle de chaque pastille d'arrondissement donne sa faction.

Faction d'un arrondissement : celle que « Paris occulte » lui donne ; sinon la faction majoritaire de ses quartiers ;
à égalité, ou si un quartier est disputé, il est disputé. Les joueurs voient le résultat de la même règle appliquée aux
seuls arrondissements et quartiers révélés (`scripts/territoires.mjs`, testé).

### Ping lumineux sur l'hologramme

Dans la fenêtre « Hologramme de Paris », **Alt + clic** sur la carte (ou bouton **Ping**, puis clic) fait monter une
colonne de lumière à cet endroit, avec une onde au sol et le nom du joueur à sa couleur. Tous ceux qui ont l'hologramme
ouvert la voient pendant 10 secondes. Le MJ peut faire **Alt + Maj + clic** pour centrer en plus la vue de tous sur
son ping.

Le ping passe par le socket de Foundry (pas par le mini-serveur) : il marche même serveur éteint. Un ping par seconde
et par joueur au plus ; un joueur ne peut pas déplacer la vue des autres.

## Le mini-serveur : Campaign Console

Le serveur (données des unités, carte de Paris, pont MCP vers un artefact Claude) ne fait plus partie de ce module : il
est fourni par **Campaign Console**. Lance Campaign Console, ou son `start-server.cmd` dans son dossier, sur l'ordinateur
du MJ. Il écoute sur `http://127.0.0.1:30010` (seulement cet ordinateur). Si le port change, le reporter dans les
réglages du module, dans Foundry. Installation, données et branchement MCP : voir la documentation de Campaign Console.

### « Rolling in the Deep » (Réserve du Conseil)

Le pont entre la page « Rolling in the Deep » et Foundry est désormais géré par Campaign Console (plus de file de
changements côté module : Foundry lit et écrit directement `GET /unites`, `GET /carte` et `PUT /unites/:id`).

## Tests

Conversion longitude, latitude ↔ Lambert-93, calcul des territoires, déploiement :

```
node --test tests/
```
