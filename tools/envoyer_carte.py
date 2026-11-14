"""
Envoie la carte de « Paris occulte » au mini-serveur (route PUT /carte), qui la relaie à Foundry.

    python tools/envoyer_carte.py <dossier exporté> [--port 30010] [--fichier carte.json]

Le dossier exporté contient la base de l'artefact, un fichier JSON par document : lieux/, factions/,
arrondissements/, quartiers/ (c'est ce que produit l'outil ArtifactData de Claude avec « out_dir »).
--fichier : écrit la carte dans un fichier au lieu de l'envoyer (pour vérifier).
« Paris occulte » reste la référence : la carte envoyée remplace la précédente.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

TYPES = {"siege", "node", "refuge", "acces", "porte", "usine", "evenement"}


def lire_collection(dossier: Path, nom: str) -> dict:
    """{ id du document: contenu } ; accepte les fichiers bruts ou enveloppés dans { data: … }"""
    docs = {}
    for f in sorted((dossier / nom).glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        docs[f.stem] = d.get("data", d) if isinstance(d, dict) else d
    return docs


def construire_carte(dossier: Path) -> tuple[dict, list]:
    """Base de « Paris occulte » → carte du serveur ; renvoie aussi la liste de ce qui a été écarté"""
    ecartes = []
    lieux = {}
    for lid, l in lire_collection(dossier, "lieux").items():
        if not isinstance(l.get("lon"), (int, float)) or not isinstance(l.get("lat"), (int, float)):
            ecartes.append(f"lieu {lid} : pas de coordonnées")
            continue
        lieux[lid] = {
            "nom": str(l.get("nom") or lid).strip(), "type": l.get("type") if l.get("type") in TYPES else "autre",
            "faction": l.get("faction") or "", "lon": l["lon"], "lat": l["lat"], "arr": int(l.get("arr") or 0),
            "texte": l.get("description") or "", "texte_joueurs": l.get("texte_joueurs") or "", "pj": bool(l.get("pj"))}
    factions = {fid: {"nom": f.get("nom") or fid, "couleur": f.get("couleur") or "#7f7f86", "groupe": f.get("groupe") or "",
                      "motif": f.get("motif") or "", "ordre": int(f.get("ordre") or 0)}
                for fid, f in lire_collection(dossier, "factions").items()}
    arrondissements = {}
    for aid, a in lire_collection(dossier, "arrondissements").items():
        n = str(a.get("n") or aid.lstrip("a"))
        arrondissements[n] = {"controle": a.get("controle") or "", "pj": bool(a.get("pj")),
                              "titre": a.get("titre") or "", "resume": a.get("resume") or ""}
    quartiers = {}
    for qid, q in lire_collection(dossier, "quartiers").items():
        code = str(q.get("code") or qid.lstrip("q"))
        quartiers[code] = {"ar": int(q.get("ar") or 0), "nom": q.get("nom") or "", "controle": q.get("controle") or "",
                           "pj": bool(q.get("pj"))}
    return {"lieux": lieux, "factions": factions, "arrondissements": arrondissements, "quartiers": quartiers}, ecartes


def envoyer(carte: dict, port: int) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/carte", method="PUT", data=json.dumps(carte).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def main(argv=None):
    p = argparse.ArgumentParser(description="Envoie la carte de « Paris occulte » au mini-serveur")
    p.add_argument("dossier", type=Path)
    p.add_argument("--port", type=int, default=30010)
    p.add_argument("--fichier", type=Path)
    a = p.parse_args(argv)
    carte, ecartes = construire_carte(a.dossier)
    for e in ecartes:
        print("écarté :", e)
    print(f"{len(carte['lieux'])} lieux ({sum(l['pj'] for l in carte['lieux'].values())} révélés), {len(carte['factions'])} factions, "
          f"{len(carte['arrondissements'])} arrondissements, {len(carte['quartiers'])} quartiers")
    if a.fichier:
        a.fichier.write_text(json.dumps(carte, ensure_ascii=False, indent=1), encoding="utf-8")
        print("→", a.fichier)
        return
    try:
        print("serveur :", envoyer(carte, a.port))
    except urllib.error.HTTPError as e:
        sys.exit(f"refusé par le serveur : {e.read().decode('utf-8', 'replace')}")
    except OSError as e:
        sys.exit(f"serveur injoignable sur le port {a.port} : {e}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
