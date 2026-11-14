"""
Mini-serveur de la salle de contrôle (preuve de concept).

Une seule source de vérité pour les unités (nom, force, statut) et pour la carte de Paris (lieux, factions,
territoires, tirés de l'artefact « Paris occulte »), partagée par :
- Foundry : API HTTP sur 127.0.0.1 (le module « Salle de contrôle » la lit et l'écrit) ;
- un artefact Claude : serveur MCP local (mode « mcp », lancé par l'application Claude).
Les deux modes lisent et écrivent le même fichier JSON. Python 3.10+, bibliothèque standard seulement.

Usage :
    python control_room_server.py http   [--port 30010] [--donnees CHEMIN]
    python control_room_server.py mcp    [--donnees CHEMIN]
Fichier de données par défaut : %LOCALAPPDATA%\\wod-control-room\\data.json (créé au premier lancement).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION_SERVEUR = "0.5.0"
PORT_DEFAUT = 30010
# Mêmes statuts que la Réserve du Conseil de « Rolling in the Deep »
STATUTS = ("disponible", "engage", "blesse", "perdu", "absent", "vide")
ID_UNITE = re.compile(r"[A-Za-z0-9_-]{1,64}")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# Seules les pages servies depuis la machine elle-même peuvent appeler l'API (Foundry sur localhost)
ORIGINE_LOCALE = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
# Carte : types de lieux de « Paris occulte », couleurs, bornes de Paris (avec une marge : La Défense en fait partie)
TYPES_LIEU = ("siege", "node", "refuge", "acces", "porte", "usine", "evenement", "autre")
COULEUR = re.compile(r"#[0-9a-fA-F]{6}")
BORNES = {"lon": (2.15, 2.55), "lat": (48.78, 48.95)}
TAILLE_CARTE = 600_000  # octets au plus pour PUT /carte


def chemin_defaut() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(base) / "wod-control-room" / "data.json"


class Magasin:
    """
    Le fichier de données : { version, unites: { id: unité }, date_jeu, seq, en_attente: [ { seq, id, champs | supprime } ] }.

    Les unités suivent la Réserve du Conseil de « Rolling in the Deep », qui est la référence : la page envoie toute
    la réserve (synchroniser). Chaque modification faite ailleurs (Foundry, page de liaison) est appliquée tout de suite
    ici ET mise en attente, jusqu'à ce que la page l'ait reportée dans sa base (acquitter).
    """

    def __init__(self, chemin: Path):
        self.chemin = Path(chemin)
        self.verrou = threading.Lock()
        if not self.chemin.exists():
            self.chemin.parent.mkdir(parents=True, exist_ok=True)
            self._ecrire({"version": 0, "unites": {}})

    def lire(self) -> dict:
        with self.verrou:
            return self._lire()

    def _lire(self) -> dict:
        try:
            d = json.loads(self.chemin.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            d = {}
        d.setdefault("version", 0)
        d.setdefault("unites", {})
        d.setdefault("seq", 0)
        d.setdefault("en_attente", [])
        return d

    def public(self) -> dict:
        """Ce que voient Foundry et les pages : sans la file d'attente interne"""
        d = self.lire()
        return {"version": d["version"], "unites": d["unites"], "date_jeu": d.get("date_jeu", "")}

    def _ecrire(self, d: dict):
        # Écriture atomique : fichier temporaire puis remplacement (l'autre mode ne lit jamais un fichier à moitié écrit)
        fd, tmp = tempfile.mkstemp(dir=self.chemin.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.chemin)

    def _attente(self, d: dict, uid: str, changement: dict):
        d["seq"] += 1
        d["en_attente"].append({"seq": d["seq"], "id": uid, **changement})
        del d["en_attente"][:-500]  # borne : la page n'a peut-être pas été ouverte depuis longtemps

    def modifier(self, uid: str, champs: dict) -> dict:
        """Crée ou modifie une unité (depuis Foundry ou la page de liaison) ; renvoie l'état public."""
        propre = valider(champs)
        uid = verifier_id(uid)
        with self.verrou:
            d = self._lire()
            nouvelle = uid not in d["unites"]
            u = d["unites"].get(uid, {"nom": uid, "force": 0, "statut": "disponible"})
            u.update(propre)
            d["unites"][uid] = u
            d["version"] += 1
            self._attente(d, uid, {"champs": dict(u) if nouvelle else propre})
            self._ecrire(d)
        return self.public()

    def supprimer(self, uid: str) -> dict:
        with self.verrou:
            d = self._lire()
            if d["unites"].pop(uid, None) is not None:
                d["version"] += 1
                self._attente(d, uid, {"supprime": True})
                self._ecrire(d)
        return self.public()

    def synchroniser(self, unites: dict, date_jeu: str = "") -> dict:
        """La page « Rolling in the Deep » envoie toute sa réserve : elle remplace les unités, sauf les changements
        locaux pas encore reportés dans la page, qui restent appliqués par-dessus."""
        if not isinstance(unites, dict) or len(unites) > 300:
            raise ValueError("unites : objet de 300 unités au plus")
        propres = {verifier_id(uid): valider(u) for uid, u in unites.items()}
        if date_jeu and not DATE.fullmatch(str(date_jeu)):
            raise ValueError("date_jeu : AAAA-MM-JJ")
        with self.verrou:
            d = self._lire()
            for c in d["en_attente"]:
                if c.get("supprime"):
                    propres.pop(c["id"], None)
                else:
                    propres[c["id"]] = {**propres.get(c["id"], {}), **c["champs"]}
            change = propres != d["unites"] or bool(date_jeu and date_jeu != d.get("date_jeu"))
            if change:
                d["unites"] = propres
                if date_jeu:
                    d["date_jeu"] = date_jeu
                d["version"] += 1
                self._ecrire(d)
            return {"version": d["version"], "change": change, "en_attente": len(d["en_attente"])}

    def carte(self) -> dict:
        """La carte de Paris : { version, maj, lieux, factions, arrondissements, quartiers } (vide au départ)"""
        d = self.lire()
        c = d.get("carte") or {}
        return {"version": c.get("version", 0), "maj": c.get("maj", ""),
                **{k: c.get(k, {}) for k in ("lieux", "factions", "arrondissements", "quartiers")}}

    def remplacer_carte(self, carte) -> dict:
        """« Paris occulte » est la référence : la carte envoyée remplace entièrement la précédente."""
        propre = valider_carte(carte)
        with self.verrou:
            d = self._lire()
            avant = d.get("carte") or {}
            change = any(avant.get(k, {}) != propre[k] for k in propre)
            version = avant.get("version", 0)
            if change:
                version += 1
                d["carte"] = {"version": version, "maj": time.strftime("%Y-%m-%dT%H:%M:%S"), **propre}
                self._ecrire(d)
            return {"version": version, "change": change, "lieux": len(propre["lieux"])}

    def changements(self) -> dict:
        with self.verrou:
            return {"en_attente": self._lire()["en_attente"]}

    def acquitter(self, jusqua: int) -> dict:
        if isinstance(jusqua, bool) or not isinstance(jusqua, int):
            raise ValueError("jusqua : entier")
        with self.verrou:
            d = self._lire()
            avant = len(d["en_attente"])
            d["en_attente"] = [c for c in d["en_attente"] if c["seq"] > jusqua]
            if len(d["en_attente"]) != avant:
                self._ecrire(d)
            return {"en_attente": len(d["en_attente"])}


def verifier_id(uid) -> str:
    uid = str(uid).strip()
    if not ID_UNITE.fullmatch(uid):
        raise ValueError("identifiant d'unité invalide (lettres, chiffres, _ et -, 64 caractères au plus)")
    return uid


def entier(cle: str, v, mini: int, maxi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not mini <= v <= maxi:
        raise ValueError(f"{cle} : entier de {mini} à {maxi}")
    return int(v)


TEXTES = {"groupe": 60, "lieu": 80, "arete": 60, "notes": 600, "mission": 300}


def texte(cle: str, v, maxi: int, vide: bool = True) -> str:
    v = "" if v is None else v
    if not isinstance(v, str) or len(v.strip()) > maxi or (not vide and not v.strip()):
        raise ValueError(f"{cle} : texte de {maxi} caractères au plus" + ("" if vide else ", non vide"))
    return v.strip()


def booleen(cle: str, v) -> bool:
    if not isinstance(v, bool):
        raise ValueError(f"{cle} : vrai ou faux")
    return v


def faction_id(cle: str, v) -> str:
    v = texte(cle, v, 64)
    if v and not ID_UNITE.fullmatch(v):
        raise ValueError(f"{cle} : identifiant de faction invalide")
    return v


def champs_connus(cle: str, objet, autorises: set) -> dict:
    if not isinstance(objet, dict):
        raise ValueError(f"{cle} : objet attendu")
    inconnus = set(objet) - autorises
    if inconnus:
        raise ValueError(f"{cle} : champ inconnu ({', '.join(sorted(inconnus))})")
    return objet


def valider_carte(carte) -> dict:
    """Vérifie une carte complète ; renvoie une copie propre ou lève ValueError."""
    carte = champs_connus("carte", carte, {"lieux", "factions", "arrondissements", "quartiers", "version", "maj"})
    lieux, factions, arrs, quartiers = (carte.get(k, {}) for k in ("lieux", "factions", "arrondissements", "quartiers"))
    for cle, bloc, maxi in (("lieux", lieux, 500), ("factions", factions, 100), ("arrondissements", arrs, 20), ("quartiers", quartiers, 80)):
        if not isinstance(bloc, dict) or len(bloc) > maxi:
            raise ValueError(f"{cle} : objet de {maxi} éléments au plus")
    propre = {"lieux": {}, "factions": {}, "arrondissements": {}, "quartiers": {}}
    for lid, l in lieux.items():
        lid = verifier_id(lid)
        champs_connus(f"lieu {lid}", l, {"nom", "type", "faction", "lon", "lat", "arr", "texte", "texte_joueurs", "pj"})
        if l.get("type") not in TYPES_LIEU:
            raise ValueError(f"lieu {lid} : type parmi {', '.join(TYPES_LIEU)}")
        coords = {}
        for k in ("lon", "lat"):
            v = l.get(k)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not BORNES[k][0] <= v <= BORNES[k][1]:
                raise ValueError(f"lieu {lid} : {k} hors de Paris")
            coords[k] = float(v)
        arr = l.get("arr", 0)
        propre["lieux"][lid] = {
            "nom": texte(f"lieu {lid} : nom", l.get("nom"), 120, vide=False), "type": l["type"],
            "faction": faction_id(f"lieu {lid} : faction", l.get("faction", "")), **coords,
            "arr": entier(f"lieu {lid} : arr", arr, 0, 20) if arr else 0,
            "texte": texte(f"lieu {lid} : texte", l.get("texte", ""), 3000),
            "texte_joueurs": texte(f"lieu {lid} : texte_joueurs", l.get("texte_joueurs", ""), 3000),
            "pj": booleen(f"lieu {lid} : pj", l.get("pj", False))}
    for fid, f in factions.items():
        fid = verifier_id(fid)
        champs_connus(f"faction {fid}", f, {"nom", "couleur", "groupe", "motif", "ordre"})
        if not COULEUR.fullmatch(str(f.get("couleur", ""))):
            raise ValueError(f"faction {fid} : couleur #rrggbb")
        propre["factions"][fid] = {"nom": texte(f"faction {fid} : nom", f.get("nom"), 80, vide=False), "couleur": f["couleur"].lower(),
                                   "groupe": texte(f"faction {fid} : groupe", f.get("groupe", ""), 40),
                                   "motif": texte(f"faction {fid} : motif", f.get("motif", ""), 20),
                                   "ordre": entier(f"faction {fid} : ordre", f.get("ordre", 0), 0, 99999)}
    for n, a in arrs.items():
        if not (str(n).isdigit() and 1 <= int(n) <= 20):
            raise ValueError(f"arrondissement {n} : numéro de 1 à 20")
        champs_connus(f"arrondissement {n}", a, {"controle", "pj", "titre", "resume"})
        propre["arrondissements"][str(int(n))] = {
            "controle": faction_id(f"arrondissement {n} : controle", a.get("controle", "")),
            "pj": booleen(f"arrondissement {n} : pj", a.get("pj", False)),
            "titre": texte(f"arrondissement {n} : titre", a.get("titre", ""), 120),
            "resume": texte(f"arrondissement {n} : resume", a.get("resume", ""), 3000)}
    for code, q in quartiers.items():
        if not (str(code).isdigit() and 1 <= int(code) <= 80):
            raise ValueError(f"quartier {code} : numéro de 1 à 80")
        champs_connus(f"quartier {code}", q, {"ar", "nom", "controle", "pj"})
        propre["quartiers"][str(int(code))] = {
            "ar": entier(f"quartier {code} : ar", q.get("ar"), 1, 20),
            "nom": texte(f"quartier {code} : nom", q.get("nom", ""), 80),
            "controle": faction_id(f"quartier {code} : controle", q.get("controle", "")),
            "pj": booleen(f"quartier {code} : pj", q.get("pj", False))}
    return propre


def valider(champs: dict) -> dict:
    if not isinstance(champs, dict):
        raise ValueError("objet attendu")
    propre = {}
    for cle, v in champs.items():
        if cle == "nom":
            v = str(v).strip()
            if not v or len(v) > 120:
                raise ValueError("nom vide ou trop long (120 caractères au plus)")
        elif cle == "force":  # puissance de la Réserve : 0 (rang vide) à 4 (redoutable)
            v = entier(cle, v, 0, 4)
        elif cle == "membres":
            v = entier(cle, v, 0, 999)
        elif cle == "ordre":
            v = entier(cle, v, 0, 99999)
        elif cle == "retour":
            v = str(v or "")
            if v and not DATE.fullmatch(v):
                raise ValueError("retour : date AAAA-MM-JJ ou vide")
        elif cle == "affectation":
            if v is not None and not (isinstance(v, dict) and len(json.dumps(v)) <= 300):
                raise ValueError("affectation : objet court ou null")
        elif cle == "statut":
            if v not in STATUTS:
                raise ValueError(f"statut : une valeur parmi {', '.join(STATUTS)}")
        elif cle in TEXTES:
            v = str(v or "").strip()
            if len(v) > TEXTES[cle]:
                raise ValueError(f"{cle} : {TEXTES[cle]} caractères au plus")
        elif cle == "composition":
            if not isinstance(v, list) or len(v) > 12 or any(not isinstance(x, str) or not x.strip() or len(x) > 40 for x in v):
                raise ValueError("composition : liste de 12 textes au plus, de 40 caractères au plus")
            v = [x.strip() for x in v]
        else:
            raise ValueError(f"champ inconnu : {cle}")
        propre[cle] = v
    return propre


# ---------------------------------------------------------------- HTTP (Foundry)

def fabriquer_gestionnaire(magasin: Magasin):
    class Gestionnaire(BaseHTTPRequestHandler):
        server_version = f"ControlRoom/{VERSION_SERVEUR}"

        def log_message(self, *args):  # silencieux
            pass

        def _cors(self):
            origine = self.headers.get("Origin", "")
            if ORIGINE_LOCALE.match(origine):
                self.send_header("Access-Control-Allow-Origin", origine)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _repondre(self, code: int, corps: dict):
            brut = json.dumps(corps, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(brut)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(brut)

        def _origine_refusee(self) -> bool:
            origine = self.headers.get("Origin")
            if origine and not ORIGINE_LOCALE.match(origine):
                self._repondre(403, {"erreur": "origine non autorisée"})
                return True
            return False

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self._origine_refusee():
                return
            if self.path == "/sante":
                return self._repondre(200, {"ok": True, "serveur": "control-room", "version": VERSION_SERVEUR})
            if self.path == "/unites":
                return self._repondre(200, magasin.public())
            if self.path == "/carte":
                return self._repondre(200, magasin.carte())
            self._repondre(404, {"erreur": "inconnu"})

        def do_PUT(self):
            if self._origine_refusee():
                return
            if self.path == "/carte":
                try:
                    taille = int(self.headers.get("Content-Length") or 0)
                    if taille > TAILLE_CARTE:
                        raise ValueError("carte trop grande")
                    return self._repondre(200, magasin.remplacer_carte(json.loads(self.rfile.read(taille) or b"{}")))
                except ValueError as e:
                    return self._repondre(400, {"erreur": str(e)})
            m = re.fullmatch(r"/unites/([^/]+)", self.path)
            if not m:
                return self._repondre(404, {"erreur": "inconnu"})
            try:
                taille = int(self.headers.get("Content-Length") or 0)
                if taille > 10_000:
                    raise ValueError("requête trop grande")
                champs = json.loads(self.rfile.read(taille) or b"{}")
                if not isinstance(champs, dict):
                    raise ValueError("objet JSON attendu")
                self._repondre(200, magasin.modifier(m.group(1), champs))
            except ValueError as e:
                self._repondre(400, {"erreur": str(e)})

        def do_DELETE(self):
            if self._origine_refusee():
                return
            m = re.fullmatch(r"/unites/([^/]+)", self.path)
            if not m:
                return self._repondre(404, {"erreur": "inconnu"})
            self._repondre(200, magasin.supprimer(m.group(1)))

    return Gestionnaire


def lancer_http(magasin: Magasin, port: int):
    # 127.0.0.1 seulement : le serveur n'est jamais joignable depuis un autre ordinateur
    serveur = ThreadingHTTPServer(("127.0.0.1", port), fabriquer_gestionnaire(magasin))
    print(f"Salle de contrôle : http://127.0.0.1:{port} (données : {magasin.chemin})", flush=True)
    serveur.serve_forever()


# ---------------------------------------------------------------- Serveur pour Foundry, vu depuis le mode MCP

def http_en_ligne(port: int = PORT_DEFAUT) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/sante", timeout=1) as r:
            return json.loads(r.read()).get("serveur") == "control-room"
    except (OSError, ValueError):
        return False


def demarrer_http(port: int = PORT_DEFAUT) -> dict:
    """Lance le serveur pour Foundry dans sa propre fenêtre (comme start-server.cmd), s'il ne tourne pas déjà."""
    if http_en_ligne(port):
        return {"en_ligne": True, "deja_lance": True, "port": port}
    lanceur = Path(__file__).resolve().parent.parent / "start-server.cmd"
    if os.name == "nt" and lanceur.exists():
        # « start » ouvre une nouvelle fenêtre : le serveur n'hérite pas du canal MCP et survit à l'application Claude
        subprocess.Popen(["cmd", "/c", "start", "", str(lanceur)], cwd=str(lanceur.parent),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "http", "--port", str(port)],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    for _ in range(20):  # jusqu'à 5 s pour démarrer
        time.sleep(0.25)
        if http_en_ligne(port):
            return {"en_ligne": True, "deja_lance": False, "port": port}
    return {"en_ligne": False, "deja_lance": False, "port": port}


# ---------------------------------------------------------------- MCP (artefact Claude)

OUTILS = [
    {"name": "lister_unites", "description": "Liste les unités de la salle de contrôle (nom, force, statut) et la version des données.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "title": "Lister les unités"}},
    {"name": "modifier_unite", "description": "Crée ou modifie une unité : nom, force (puissance 0 à 4), statut (disponible, engage, blesse, perdu, absent, vide), groupe, membres, arete, notes, mission, retour (AAAA-MM-JJ).",
     "inputSchema": {"type": "object", "required": ["id"], "additionalProperties": False, "properties": {
         "id": {"type": "string", "description": "Identifiant de l'unité (a-z, 0-9, _ et -)"},
         "nom": {"type": "string"}, "force": {"type": "integer", "minimum": 0, "maximum": 4},
         "membres": {"type": "integer", "minimum": 0}, "arete": {"type": "string"}, "notes": {"type": "string"},
         "mission": {"type": "string"}, "retour": {"type": "string"},
         "statut": {"type": "string", "enum": list(STATUTS)},
         "groupe": {"type": "string", "description": "Groupe d'affichage (Rédempteurs, Alliés du Conseil…)"},
         "composition": {"type": "array", "items": {"type": "string"}, "maxItems": 12, "description": "Membres ou caractéristiques"},
         "lieu": {"type": "string", "description": "Lieu ou affectation"}}},
     "annotations": {"readOnlyHint": False, "title": "Modifier une unité"}},
    {"name": "synchroniser_reserve", "description": "Remplace les unités par la Réserve du Conseil de Rolling in the Deep (les changements faits dans Foundry et pas encore reportés restent appliqués).",
     "inputSchema": {"type": "object", "required": ["unites"], "additionalProperties": False, "properties": {
         "unites": {"type": "object", "description": "{ id: unité }"}, "date_jeu": {"type": "string", "description": "Date en jeu AAAA-MM-JJ"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "title": "Synchroniser la Réserve"}},
    {"name": "recuperer_changements", "description": "Changements faits dans Foundry (ou la page de liaison) pas encore reportés dans Rolling in the Deep.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "title": "Changements en attente"}},
    {"name": "acquitter_changements", "description": "Retire de la file les changements reportés (numéro de séquence inclus).",
     "inputSchema": {"type": "object", "required": ["jusqua"], "additionalProperties": False, "properties": {"jusqua": {"type": "integer"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "title": "Acquitter les changements"}},
    {"name": "etat_serveur_foundry", "description": "Indique si le serveur pour Foundry (HTTP, 127.0.0.1:30010) est lancé.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "title": "État du serveur pour Foundry"}},
    {"name": "lancer_serveur_foundry", "description": "Lance le serveur pour Foundry dans sa propre fenêtre, s'il ne tourne pas déjà.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "title": "Lancer le serveur pour Foundry"}},
    {"name": "lire_carte", "description": "Carte de Paris de la table de contrôle : lieux, factions, arrondissements, quartiers (tirés de « Paris occulte »).",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "title": "Lire la carte"}},
    {"name": "synchroniser_carte", "description": "Remplace la carte de Paris par celle de « Paris occulte » : lieux { id: { nom, type, faction, lon, lat, arr, texte, texte_joueurs, pj } }, factions { id: { nom, couleur, groupe, motif, ordre } }, arrondissements { n: { controle, pj, titre, resume } }, quartiers { code: { ar, nom, controle, pj } }.",
     "inputSchema": {"type": "object", "required": ["lieux"], "additionalProperties": False, "properties": {
         "lieux": {"type": "object"}, "factions": {"type": "object"}, "arrondissements": {"type": "object"}, "quartiers": {"type": "object"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "title": "Synchroniser la carte"}},
]


def traiter_mcp(magasin: Magasin, message: dict):
    """Une requête JSON-RPC MCP → la réponse (None pour une notification)"""
    methode, ident, params = message.get("method"), message.get("id"), message.get("params") or {}
    if ident is None:
        return None
    try:
        if methode == "initialize":
            resultat = {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "control-room", "version": VERSION_SERVEUR}}
        elif methode == "ping":
            resultat = {}
        elif methode == "tools/list":
            resultat = {"tools": OUTILS}
        elif methode == "tools/call":
            nom, args = params.get("name"), dict(params.get("arguments") or {})
            if nom == "lister_unites":
                donnees = magasin.public()
            elif nom == "synchroniser_reserve":
                donnees = magasin.synchroniser(args.get("unites"), args.get("date_jeu") or "")
            elif nom == "recuperer_changements":
                donnees = magasin.changements()
            elif nom == "acquitter_changements":
                donnees = magasin.acquitter(args.get("jusqua"))
            elif nom == "modifier_unite":
                donnees = magasin.modifier(args.pop("id", ""), args)
            elif nom == "etat_serveur_foundry":
                donnees = {"en_ligne": http_en_ligne(), "port": PORT_DEFAUT}
            elif nom == "lancer_serveur_foundry":
                donnees = demarrer_http()
            elif nom == "lire_carte":
                donnees = magasin.carte()
            elif nom == "synchroniser_carte":
                donnees = magasin.remplacer_carte(args)
            else:
                return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32602, "message": f"outil inconnu : {nom}"}}
            resultat = {"content": [{"type": "text", "text": json.dumps(donnees, ensure_ascii=False)}],
                        "structuredContent": donnees}
        else:
            return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": f"méthode inconnue : {methode}"}}
    except ValueError as e:
        resultat = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    return {"jsonrpc": "2.0", "id": ident, "result": resultat}


def lancer_mcp(magasin: Magasin):
    # Transport stdio : un message JSON par ligne ; rien d'autre ne doit sortir sur stdout
    for ligne in sys.stdin:
        ligne = ligne.strip()
        if not ligne:
            continue
        try:
            message = json.loads(ligne)
        except ValueError:
            continue
        reponse = traiter_mcp(magasin, message)
        if reponse is not None:
            sys.stdout.write(json.dumps(reponse, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def main(argv=None):
    p = argparse.ArgumentParser(description="Mini-serveur de la salle de contrôle")
    p.add_argument("mode", choices=["http", "mcp"])
    p.add_argument("--port", type=int, default=PORT_DEFAUT)
    p.add_argument("--donnees", type=Path, default=None)
    a = p.parse_args(argv)
    magasin = Magasin(a.donnees or chemin_defaut())
    if a.mode == "http":
        lancer_http(magasin, a.port)
    else:
        lancer_mcp(magasin)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    main()
