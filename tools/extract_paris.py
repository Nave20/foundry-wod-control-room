"""
Extrait de la BD TOPO de Paris (IGN, GeoPackage) un fichier binaire léger pour l'hologramme :
bâtiments (contour simplifié + hauteur), Seine et plans d'eau, limites des 20 arrondissements.

Usage :
    python -I extract_paris.py <fichier .gpkg> <fichier de sortie .bin> [--surface-min 30] [--tolerance 1.5]

Données : IGN BD TOPO, Licence Ouverte 2.0 (à citer « IGN BD TOPO »). Coordonnées Lambert-93 en mètres,
recentrées sur Paris et arrondies au mètre.

Format du fichier (little endian) :
    "PRS2" | uint32 taille de l'en-tête JSON | en-tête JSON (UTF-8 ; calques, monuments, grille de relief)
    puis, pour chaque calque (ordre de l'en-tête) : uint32 nb d'anneaux | uint16[nb] nb de points par anneau
        | si calque à hauteur : uint16[nb] hauteur (m) + uint8[nb] altitude du sol (m au-dessus de alt0)
        | int16[2 × points] x, y
    puis la grille de relief : uint8[l × h] altitude du sol (m au-dessus de alt0), ligne par ligne.
    (alignement : chaque bloc commence sur un multiple de 2 octets)
"""
import json
import math
import sqlite3
import struct
import sys
from array import array

CENTRE = (652000, 6862000)  # Lambert-93, environ l'île de la Cité
ALT0 = 15  # altitude de référence (m) : les altitudes du sol sont stockées au-dessus


def lire_wkb(b, i=0):
    """Polygones (anneaux extérieurs et intérieurs) d'une géométrie WKB : liste de polygones = liste d'anneaux [(x, y)]"""
    ordre = "<" if b[i] == 1 else ">"
    (typ,) = struct.unpack_from(ordre + "I", b, i + 1)
    i += 5
    dims = 2
    if typ & 0x80000000:
        dims += 1
    if typ & 0x40000000:
        dims += 1
    base = typ & 0x0FFFFFFF
    if base >= 3000:
        dims, base = 4, base - 3000
    elif base >= 2000:
        dims, base = 3, base - 2000
    elif base >= 1000:
        dims, base = 3, base - 1000
    if base == 3:  # Polygon
        (n,) = struct.unpack_from(ordre + "I", b, i)
        i += 4
        anneaux = []
        for _ in range(n):
            (np_,) = struct.unpack_from(ordre + "I", b, i)
            i += 4
            pts = struct.unpack_from(ordre + "d" * (np_ * dims), b, i)
            i += 8 * np_ * dims
            anneaux.append([(pts[k], pts[k + 1]) for k in range(0, len(pts), dims)])
        return [anneaux], i
    if base in (6, 7):  # MultiPolygon, GeometryCollection
        (n,) = struct.unpack_from(ordre + "I", b, i)
        i += 4
        polys = []
        for _ in range(n):
            p, i = lire_wkb(b, i)
            polys.extend(p)
        return polys, i
    if base in (2, 5):  # LineString, MultiLineString : ignorés ici
        return [], len(b)
    return [], len(b)


def geometrie_gpkg(blob):
    """En-tête GeoPackage (« GP », version, drapeaux, srs, enveloppe) puis WKB"""
    if not blob or blob[:2] != b"GP":
        return []
    drapeaux = blob[3]
    enveloppe = (drapeaux >> 1) & 0x07
    taille = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(enveloppe, 0)
    return lire_wkb(blob, 8 + taille)[0]


def douglas_peucker(pts, tol):
    if len(pts) < 4:
        return pts
    # Anneau fermé (premier point = dernier) : couper au point le plus éloigné du départ, puis simplifier chaque moitié
    if pts[0] == pts[-1]:
        x0, y0 = pts[0]
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
        if 0 < k < len(pts) - 1:
            return douglas_peucker(pts[:k + 1], tol)[:-1] + douglas_peucker(pts[k:], tol)
        return pts
    garder = [False] * len(pts)
    garder[0] = garder[-1] = True
    pile = [(0, len(pts) - 1)]
    while pile:
        a, b = pile.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        lg = math.hypot(dx, dy) or 1e-9
        dmax, imax = 0, -1
        for k in range(a + 1, b):
            px, py = pts[k]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / lg
            if d > dmax:
                dmax, imax = d, k
        if dmax > tol:
            garder[imax] = True
            pile += [(a, imax), (imax, b)]
    return [p for p, g in zip(pts, garder) if g]


def surface(pts):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def quantifier(pts):
    q = []
    for x, y in pts:
        qx, qy = round(x - CENTRE[0]), round(y - CENTRE[1])
        if not (-32768 <= qx <= 32767 and -32768 <= qy <= 32767):
            return None
        if not q or (qx, qy) != q[-1]:
            q.append((qx, qy))
    if len(q) > 1 and q[0] == q[-1]:
        q.pop()
    return q if len(q) >= 3 else None


class Calque:
    """Contours ; avec_hauteur : hauteur (uint16, m) et altitude du sol (uint8, m au-dessus de ALT0) par contour"""

    def __init__(self, nom, avec_hauteur=False):
        self.nom, self.avec_hauteur = nom, avec_hauteur
        self.longueurs, self.hauteurs, self.sols, self.coords = array("H"), array("H"), array("B"), array("h")

    def ajouter(self, pts, hauteur=0, sol=ALT0):
        pts = pts[:65535]
        self.longueurs.append(len(pts))
        if self.avec_hauteur:
            self.hauteurs.append(max(1, min(65535, round(hauteur))))
            self.sols.append(max(0, min(255, round(sol - ALT0))))
        for x, y in pts:
            self.coords.append(x)
            self.coords.append(y)

    def octets(self):
        corps = struct.pack("<I", len(self.longueurs)) + self.longueurs.tobytes()
        if self.avec_hauteur:
            s = self.sols.tobytes()
            corps += self.hauteurs.tobytes() + s + (b"\0" if len(s) % 2 else b"")
        return corps + self.coords.tobytes()


# Monuments : repérés par leur toponyme IGN ; leurs bâtiments sont gardés en haute définition (rayon en m).
# « modele » : le client ajoute un modèle dessiné (la base ne donne qu'une emprise et une hauteur).
MONUMENTS = [
    {"nom": "Tour Eiffel", "x": 648219, "y": 6862257, "rayon": 90, "modele": "eiffel"},
    {"nom": "Notre-Dame", "x": 652297, "y": 6861640, "rayon": 90, "modele": "notre-dame"},
    {"nom": "Louvre", "x": 651304, "y": 6862517, "rayon": 330, "modele": "pyramide"},
    {"nom": "Sacré-Cœur", "x": 651823, "y": 6865398, "rayon": 70, "modele": "sacre-coeur"},
    {"nom": "Arc de Triomphe", "x": 648294, "y": 6863983, "rayon": 40},
    {"nom": "Tour Montparnasse", "x": 650237, "y": 6860440, "rayon": 60},
    {"nom": "Invalides", "x": 649562, "y": 6861940, "rayon": 160},
    {"nom": "Opéra", "x": 650990, "y": 6863710, "rayon": 90},
    {"nom": "Centre Pompidou", "x": 652530, "y": 6862610, "rayon": 80},
]


def monument_de(cx, cy):
    for m in MONUMENTS:
        if (cx - m["x"]) ** 2 + (cy - m["y"]) ** 2 <= m["rayon"] ** 2:
            return m
    return None


def grille_relief(points, pas=100):
    """Grille d'altitude du sol (moyenne des bâtiments par case, trous comblés par diffusion)"""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, y0 = min(xs) - pas, min(ys) - pas
    l, h = int((max(xs) - x0) // pas) + 2, int((max(ys) - y0) // pas) + 2
    somme, nb = [0.0] * (l * h), [0] * (l * h)
    for x, y, z in points:
        i = int((x - x0) // pas) + int((y - y0) // pas) * l
        somme[i] += z
        nb[i] += 1
    val = [somme[i] / nb[i] if nb[i] else None for i in range(l * h)]
    for _ in range(400):
        vides = [i for i, v in enumerate(val) if v is None]
        if not vides:
            break
        nouv = val[:]
        for i in vides:
            x, y = i % l, i // l
            vois = [val[j] for j in (i - 1 if x else -1, i + 1 if x < l - 1 else -1, i - l, i + l) if 0 <= j < l * h and val[j] is not None]
            if vois:
                nouv[i] = sum(vois) / len(vois)
        val = nouv
    # léger lissage pour un relief doux
    lisse = val[:]
    for i in range(l * h):
        x, y = i % l, i // l
        vois = [val[j] for j in (i, i - 1 if x else i, i + 1 if x < l - 1 else i, i - l if y else i, i + l if y < h - 1 else i)]
        lisse[i] = sum(v for v in vois if v is not None) / len(vois)
    octets = bytes(max(0, min(255, round((v or ALT0) - ALT0))) for v in lisse)
    return {"x0": round(x0 - CENTRE[0]), "y0": round(y0 - CENTRE[1]), "pas": pas, "l": l, "h": h, "alt0": ALT0}, octets


def main(gpkg, sortie, surface_min=30.0, tolerance=1.5):
    c = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    bat, mon, eau, arr = Calque("batiments", True), Calque("monuments", True), Calque("eau"), Calque("arrondissements")
    vus = ignores = 0
    sols = []
    for geom, h, etages, legere, sol in c.execute(
            "select geometrie, hauteur, nombre_d_etages, construction_legere, altitude_minimale_sol from batiment "
            "where etat_de_l_objet is null or etat_de_l_objet = 'En service'"):
        vus += 1
        if legere in (1, "1", "Oui", True):
            ignores += 1
            continue
        hauteur = h if h and h > 0 else ((etages or 0) * 3 or 6)
        for poly in geometrie_gpkg(geom):
            ext = poly[0]
            cx, cy = sum(p[0] for p in ext) / len(ext), sum(p[1] for p in ext) / len(ext)
            if sol and sol > 0:
                sols.append((cx, cy, sol))
            m = monument_de(cx, cy)
            if m:
                q = quantifier(douglas_peucker(ext, 0.3))
                if q and m.get("modele") != "eiffel":
                    mon.ajouter(q, hauteur, sol or ALT0)
                continue
            if surface(ext) < surface_min:
                ignores += 1
                continue
            q = quantifier(douglas_peucker(ext, tolerance))
            if q:
                bat.ajouter(q, hauteur, sol or ALT0)
    grille, octets_grille = grille_relief(sols)
    for (geom,) in c.execute("select geometrie from surface_hydrographique"):
        for poly in geometrie_gpkg(geom):
            for anneau in poly:
                q = quantifier(douglas_peucker(anneau, 2.0))
                if q and surface(q) > 200:
                    eau.ajouter(q)
    noms = []
    for geom, nom, num in c.execute(
            "select geometrie, nom_officiel, numero_de_l_arrondissement_municipal from arrondissement_municipal order by 3"):
        for poly in geometrie_gpkg(geom):
            q = quantifier(douglas_peucker(poly[0], 3.0))
            if q:
                arr.ajouter(q)
                noms.append({"numero": num, "nom": nom, "centre": [round(sum(p[0] for p in q) / len(q)), round(sum(p[1] for p in q) / len(q))]})
    monuments = [{"nom": m["nom"], "x": m["x"] - CENTRE[0], "y": m["y"] - CENTRE[1], "modele": m.get("modele")} for m in MONUMENTS]
    entete = json.dumps({
        "source": "IGN BD TOPO 3.5, Paris (D075), édition 2026-09-15, Licence Ouverte 2.0",
        "centre_lambert93": CENTRE, "unite": "metre", "alt0": ALT0,
        "calques": [k.nom for k in (bat, mon, eau, arr)], "avec_hauteur": ["batiments", "monuments"],
        "arrondissements": noms, "monuments": monuments, "relief": grille,
        "parametres": {"surface_min_m2": surface_min, "tolerance_m": tolerance}
    }, ensure_ascii=False).encode("utf-8")
    entete += b" " * ((-(8 + len(entete))) % 2)
    with open(sortie, "wb") as f:
        f.write(b"PRS2" + struct.pack("<I", len(entete)) + entete)
        for k in (bat, mon, eau, arr):
            f.write(k.octets())
        f.write(octets_grille)
    print(f"Bâtiments : {len(bat.longueurs)} ({vus} lus, {ignores} ignorés) ; monuments : {len(mon.longueurs)} contours ; "
          f"relief {grille['l']}×{grille['h']} cases de {grille['pas']} m, altitude {ALT0} à {ALT0 + max(octets_grille)} m")


if __name__ == "__main__":
    args = sys.argv[1:]
    opts = {"--surface-min": 30.0, "--tolerance": 1.5}
    for k in list(opts):
        if k in args:
            j = args.index(k)
            opts[k] = float(args[j + 1])
            del args[j:j + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    main(args[0], args[1], opts["--surface-min"], opts["--tolerance"])
