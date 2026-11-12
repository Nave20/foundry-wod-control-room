"""
Mini-serveur de la salle de contrôle (preuve de concept).

Une seule source de vérité pour les unités (nom, force, statut), partagée par :
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
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION_SERVEUR = "0.2.0"
PORT_DEFAUT = 30010
STATUTS = ("disponible", "en_mission", "blessee", "perdue")
# Seules les pages servies depuis la machine elle-même peuvent appeler l'API (Foundry sur localhost)
ORIGINE_LOCALE = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


def chemin_defaut() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(base) / "wod-control-room" / "data.json"


class Magasin:
    """Le fichier de données : { version, unites: { id: { nom, force, statut } } }"""

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
        return d

    def _ecrire(self, d: dict):
        # Écriture atomique : fichier temporaire puis remplacement (l'autre mode ne lit jamais un fichier à moitié écrit)
        fd, tmp = tempfile.mkstemp(dir=self.chemin.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.chemin)

    def modifier(self, uid: str, champs: dict) -> dict:
        """Crée ou modifie une unité ; renvoie l'état complet. Lève ValueError si une valeur est invalide."""
        propre = valider(champs)
        uid = str(uid).strip()
        if not re.fullmatch(r"[a-z0-9_-]{1,40}", uid):
            raise ValueError("identifiant d'unité invalide (a-z, 0-9, _ et -, 40 caractères au plus)")
        with self.verrou:
            d = self._lire()
            u = d["unites"].get(uid, {"nom": uid, "force": 0, "statut": "disponible"})
            u.update(propre)
            d["unites"][uid] = u
            d["version"] += 1
            self._ecrire(d)
            return d

    def supprimer(self, uid: str) -> dict:
        with self.verrou:
            d = self._lire()
            if d["unites"].pop(uid, None) is not None:
                d["version"] += 1
                self._ecrire(d)
            return d


def valider(champs: dict) -> dict:
    propre = {}
    for cle, v in (champs or {}).items():
        if cle == "nom":
            v = str(v).strip()
            if not v or len(v) > 80:
                raise ValueError("nom vide ou trop long (80 caractères au plus)")
        elif cle == "force":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not 0 <= v <= 10:
                raise ValueError("force : entier de 0 à 10")
            v = int(v)
        elif cle == "statut":
            if v not in STATUTS:
                raise ValueError(f"statut : une valeur parmi {', '.join(STATUTS)}")
        elif cle in ("groupe", "lieu"):
            v = str(v).strip()
            if len(v) > 80:
                raise ValueError(f"{cle} : 80 caractères au plus")
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
                return self._repondre(200, magasin.lire())
            self._repondre(404, {"erreur": "inconnu"})

        def do_PUT(self):
            if self._origine_refusee():
                return
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


# ---------------------------------------------------------------- MCP (artefact Claude)

OUTILS = [
    {"name": "lister_unites", "description": "Liste les unités de la salle de contrôle (nom, force, statut) et la version des données.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "title": "Lister les unités"}},
    {"name": "modifier_unite", "description": "Crée ou modifie une unité : nom, force (0 à 10), statut (disponible, en_mission, blessee, perdue), groupe, composition (liste de textes courts), lieu.",
     "inputSchema": {"type": "object", "required": ["id"], "additionalProperties": False, "properties": {
         "id": {"type": "string", "description": "Identifiant de l'unité (a-z, 0-9, _ et -)"},
         "nom": {"type": "string"}, "force": {"type": "integer", "minimum": 0, "maximum": 10},
         "statut": {"type": "string", "enum": list(STATUTS)},
         "groupe": {"type": "string", "description": "Groupe d'affichage (Rédempteurs, Alliés du Conseil…)"},
         "composition": {"type": "array", "items": {"type": "string"}, "maxItems": 12, "description": "Membres ou caractéristiques"},
         "lieu": {"type": "string", "description": "Lieu ou affectation"}}},
     "annotations": {"readOnlyHint": False, "title": "Modifier une unité"}},
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
                donnees = magasin.lire()
            elif nom == "modifier_unite":
                donnees = magasin.modifier(args.pop("id", ""), args)
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
