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

Une fenêtre « Salle de contrôle » (bouton en bas de l'onglet des acteurs) liste les unités : nom, force, statut.

- Le **mini-serveur** garde ces données dans un fichier sur l'ordinateur du MJ. C'est la seule source de vérité.
- **Foundry** : seul le MJ actif interroge le serveur, toutes les 3 secondes, et transmet les changements aux joueurs.
  Le MJ peut modifier la force, le statut, ou ajouter une unité ; les joueurs voient tout en lecture seule.
- **Un artefact Claude** peut lire et modifier les mêmes données par le même serveur (mode MCP). Une modification d'un
  côté apparaît de l'autre.

## Installer et lancer le mini-serveur

Il faut **Python 3.10 ou plus récent** ; aucune autre installation.

Le plus simple : **double-cliquer sur `start-server.cmd`** dans le dossier du module
(`Data/modules/wod-control-room`). Une fenêtre noire s'ouvre : laisse-la ouverte pendant la partie, ferme-la
pour arrêter le serveur.

En ligne de commande, depuis le dossier du module :

```
python server/control_room_server.py http
```

Le serveur écoute sur `http://127.0.0.1:30010` (seulement cet ordinateur : il n'est jamais joignable depuis
Internet ni depuis le réseau local). Le port se change avec `--port` ; il faut alors le reporter dans les réglages du
module, dans Foundry.

Les données sont dans `%LOCALAPPDATA%\wod-control-room\data.json` (option `--donnees` pour un autre fichier).

## Brancher un artefact Claude (facultatif)

Dans l'application Claude (bureau), déclarer le serveur local dans la configuration des serveurs MCP :

```json
"mcpServers": {
  "control-room": {
    "command": "python",
    "args": ["<chemin du module>/server/control_room_server.py", "mcp"]
  }
}
```

L'artefact appelle alors `host:control-room` (outils `lister_unites` et `modifier_unite`). Seul le propriétaire de
l'artefact, dans l'application Claude, peut joindre ce serveur.

## Tests du serveur

```
python -m unittest server/test_server.py
```
