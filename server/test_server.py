import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from control_room_server import Magasin, attribuer_insignes, fabriquer_gestionnaire, traiter_mcp  # noqa: E402

ICI = Path(__file__).parent


class TestMagasin(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.m = Magasin(Path(self.dossier.name) / "d.json")

    def tearDown(self):
        self.dossier.cleanup()

    def test_creation_et_modification(self):
        self.assertEqual(self.m.public(), {"version": 0, "unites": {}, "date_jeu": ""})
        d = self.m.modifier("verbenae", {"nom": "Verbenae de Montreuil", "force": 3})
        self.assertEqual(d["version"], 1)
        self.assertEqual(d["unites"]["verbenae"], {"nom": "Verbenae de Montreuil", "force": 3, "statut": "disponible", "insigne": "e01"})
        d = self.m.modifier("verbenae", {"statut": "engage", "retour": "2019-05-03"})
        self.assertEqual((d["version"], d["unites"]["verbenae"]["force"]), (2, 3))

    def test_valeurs_refusees(self):
        for champs in ({"force": 5}, {"force": "3"}, {"force": True}, {"statut": "parti"}, {"nom": ""}, {"pirate": 1},
                       {"retour": "demain"}, {"membres": -1}, {"notes": "x" * 601}):
            with self.assertRaises(ValueError, msg=champs):
                self.m.modifier("a", champs)
        with self.assertRaises(ValueError):
            self.m.modifier("../x", {"force": 1})
        self.assertEqual(self.m.lire()["version"], 0)

    def test_champs_affichage(self):
        d = self.m.modifier("a", {"groupe": "Alliés du Conseil", "composition": ["4 mages", "Arété 3"], "lieu": "La Chapelle"})
        self.assertEqual(d["unites"]["a"]["composition"], ["4 mages", "Arété 3"])
        for champs in ({"composition": "pas une liste"}, {"composition": [""]}, {"lieu": "x" * 81}):
            with self.assertRaises(ValueError, msg=champs):
                self.m.modifier("a", champs)

    def test_synchro_rolling(self):
        """Rolling envoie la réserve ; un changement Foundry pas encore reporté survit à la synchro suivante"""
        r = self.m.synchroniser({"r-mars": {"nom": "Mars", "force": 3, "statut": "engage"}, "ether": {"nom": "Éther", "force": 2}}, "2019-04-20")
        self.assertTrue(r["change"])
        self.assertEqual(self.m.public()["date_jeu"], "2019-04-20")
        self.assertFalse(self.m.synchroniser({"r-mars": {"nom": "Mars", "force": 3, "statut": "engage"}, "ether": {"nom": "Éther", "force": 2}})["change"])
        self.m.modifier("r-mars", {"statut": "blesse"})        # depuis Foundry
        self.m.supprimer("ether")
        att = self.m.changements()["en_attente"]
        self.assertEqual([(c["id"], c.get("champs"), c.get("supprime")) for c in att],
                         [("r-mars", {"statut": "blesse"}, None), ("ether", None, True)])
        # Rolling n'a pas encore vu ces changements : sa synchro ne doit pas les écraser
        self.m.synchroniser({"r-mars": {"nom": "Mars", "force": 3, "statut": "engage"}, "ether": {"nom": "Éther", "force": 2}})
        u = self.m.public()["unites"]
        self.assertEqual((u["r-mars"]["statut"], "ether" in u), ("blesse", False))
        self.assertEqual(self.m.acquitter(att[-1]["seq"]), {"en_attente": 0})
        self.m.synchroniser({"r-mars": {"nom": "Mars", "force": 3, "statut": "blesse"}})
        self.assertEqual(list(self.m.public()["unites"]), ["r-mars"])
        with self.assertRaises(ValueError):
            self.m.synchroniser({"../x": {"nom": "a"}})

    def test_creation_mise_en_attente_complete(self):
        self.m.modifier("garde", {"nom": "Garde du Node", "force": 1})
        self.assertEqual(self.m.changements()["en_attente"][0]["champs"], {"nom": "Garde du Node", "force": 1, "statut": "disponible"})

    def test_suppression(self):
        self.m.modifier("a", {"force": 1})
        self.assertEqual(self.m.supprimer("a")["unites"], {})


CARTE = {
    "lieux": {
        "siege-conseil": {"nom": "Royaume du Conseil", "type": "siege", "faction": "conseil", "lon": 2.34845, "lat": 48.8882,
                          "arr": 18, "texte": "Note du MJ", "texte_joueurs": "Le siège du Conseil.", "pj": True},
        "porte-goutte-or": {"nom": "Porte de la Goutte-d'Or", "type": "porte", "faction": "conseil", "lon": 2.354, "lat": 48.8855,
                            "arr": 18, "texte": "", "texte_joueurs": "", "pj": False}},
    "factions": {"conseil": {"nom": "Conseil de Paris", "couleur": "#2f5aa8", "groupe": "Mages", "motif": "", "ordre": 1}},
    "arrondissements": {"18": {"controle": "conseil", "pj": True, "titre": "Le 18e", "resume": ""}},
    "quartiers": {"72": {"ar": 18, "nom": "La Chapelle", "controle": "conseil", "pj": True}}
}


class TestCarte(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.m = Magasin(Path(self.dossier.name) / "d.json")

    def tearDown(self):
        self.dossier.cleanup()

    def test_vide_puis_remplacee(self):
        self.assertEqual(self.m.carte(), {"version": 0, "maj": "", "lieux": {}, "factions": {}, "arrondissements": {}, "quartiers": {}})
        r = self.m.remplacer_carte(CARTE)
        self.assertEqual((r["version"], r["change"], r["lieux"]), (1, True, 2))
        c = self.m.carte()
        self.assertEqual(c["lieux"]["porte-goutte-or"]["pj"], False)
        self.assertTrue(c["maj"])
        # Même carte : rien ne change, la version reste
        self.assertEqual(self.m.remplacer_carte(CARTE)["change"], False)
        self.assertEqual(self.m.carte()["version"], 1)
        # Les unités ne sont pas touchées
        self.assertEqual(self.m.public()["unites"], {})

    def test_carte_refusee(self):
        import copy
        def avec(chemin, valeur):
            c = copy.deepcopy(CARTE); d = c
            for k in chemin[:-1]: d = d[k]
            d[chemin[-1]] = valeur
            return c
        mauvaises = [
            avec(["lieux", "siege-conseil", "lon"], 3.5),          # hors de Paris
            avec(["lieux", "siege-conseil", "type"], "chateau"),
            avec(["lieux", "siege-conseil", "nom"], ""),
            avec(["lieux", "siege-conseil", "pj"], "oui"),
            avec(["lieux", "../x"], CARTE["lieux"]["siege-conseil"]),
            avec(["factions", "conseil", "couleur"], "bleu"),
            avec(["arrondissements", "21"], {"controle": "", "pj": False}),
            avec(["quartiers", "72", "ar"], 25),
            avec(["lieux", "siege-conseil", "pirate"], 1),
            "pas une carte",
        ]
        for c in mauvaises:
            with self.assertRaises(ValueError, msg=str(c)[:80]):
                self.m.remplacer_carte(c)
        self.assertEqual(self.m.carte()["version"], 0)


CARTE_DEPLOIEMENT = {
    "lieux": {
        "opera": {"nom": "Opéra Garnier", "type": "autre", "lon": 2.3316, "lat": 48.8719, "pj": True},
        "cave": {"nom": "Cave cachée", "type": "refuge", "lon": 2.35, "lat": 48.86, "pj": False}},
    "factions": {}, "arrondissements": {}, "quartiers": {}
}


class TestDeploiement(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.m = Magasin(Path(self.dossier.name) / "d.json")
        self.m.remplacer_carte(CARTE_DEPLOIEMENT)

    def tearDown(self):
        self.dossier.cleanup()

    def test_deployer_sur_lieu_revele(self):
        d = self.m.modifier("r-mercure", {"repere": "opera", "statut": "engage"})
        self.assertEqual(d["unites"]["r-mercure"]["repere"], "opera")

    def test_refus_lieu_cache_ou_inconnu(self):
        for lid in ("cave", "nulle-part"):
            with self.assertRaises(ValueError, msg=lid):
                self.m.modifier("r-mercure", {"repere": lid})
        with self.assertRaises(ValueError):
            self.m.modifier("r", {"residence": "nulle-part"})

    def test_residence_peut_etre_cachee(self):
        self.assertEqual(self.m.modifier("r", {"residence": "cave"})["unites"]["r"]["residence"], "cave")

    def test_statut_rappel_vide_repere(self):
        self.m.modifier("r", {"repere": "opera", "statut": "engage"})
        self.assertEqual(self.m.modifier("r", {"statut": "perdu"})["unites"]["r"]["repere"], "")

    def test_blesse_garde_repere(self):
        self.m.modifier("r", {"repere": "opera", "statut": "engage"})
        self.assertEqual(self.m.modifier("r", {"statut": "blesse"})["unites"]["r"]["repere"], "opera")

    def test_synchro_conserve_les_champs_locaux(self):
        self.m.modifier("r", {"repere": "opera", "residence": "cave", "statut": "engage"})
        self.m.acquitter(10 ** 6)
        self.m.synchroniser({"r": {"nom": "R", "statut": "engage"}})
        u = self.m.public()["unites"]["r"]
        self.assertEqual((u["repere"], u["residence"]), ("opera", "cave"))

    def test_synchro_statut_rappel_vide_repere(self):
        self.m.modifier("r", {"repere": "opera", "statut": "engage"})
        self.m.acquitter(10 ** 6)
        self.m.synchroniser({"r": {"nom": "R", "statut": "perdu"}})
        self.assertEqual(self.m.public()["unites"]["r"]["repere"], "")

    def test_ecusson_deja_pris_refuse(self):
        self.m.modifier("a", {"nom": "A"})
        self.m.modifier("b", {"nom": "B"})
        pris = self.m.public()["unites"]["a"]["insigne"]
        with self.assertRaises(ValueError):
            self.m.modifier("b", {"insigne": pris})
        self.m.modifier("a", {"insigne": pris})  # garder le sien est permis

    def test_repere_seul_engage_l_unite(self):
        d = self.m.modifier("r", {"nom": "R", "repere": "opera"})
        self.assertEqual((d["unites"]["r"]["repere"], d["unites"]["r"]["statut"]), ("opera", "engage"))

    def test_synchro_insigne_vide_conserve(self):
        self.m.modifier("r", {"nom": "R", "insigne": "e07"})
        self.m.acquitter(10 ** 6)
        self.m.synchroniser({"r": {"nom": "R", "insigne": ""}})
        self.assertEqual(self.m.public()["unites"]["r"]["insigne"], "e07")

    def test_synchro_repere_vide_envoye_rappelle(self):
        """Comportement figé pour l'étape 9 : la page ne doit envoyer `repere` que si elle le tient du serveur"""
        self.m.modifier("r", {"repere": "opera", "statut": "engage"})
        self.m.acquitter(10 ** 6)
        self.m.synchroniser({"r": {"nom": "R", "statut": "engage", "repere": ""}})
        self.assertEqual(self.m.public()["unites"]["r"]["repere"], "")

    def test_synchro_ne_refuse_pas_un_lieu_cache(self):
        self.m.synchroniser({"r": {"nom": "R", "repere": "cave", "statut": "engage"}})
        self.assertEqual(self.m.public()["unites"]["r"]["repere"], "cave")


class TestInsignes(unittest.TestCase):
    def test_planete_depuis_le_nom(self):
        u = {"a": {"nom": "Rédempteurs de Neptune", "groupe": "Rédempteurs"},
             "b": {"nom": "Rédempteur de Pluton (K. Varga)", "groupe": "Rédempteurs"},
             "c": {"nom": "Rédempteurs de la Terre", "groupe": "Rédempteurs"}}
        self.assertTrue(attribuer_insignes(u))
        self.assertEqual([u[k]["insigne"] for k in "abc"], ["p8", "p9", "p3"])

    def test_ecussons_libres_dans_l_ordre(self):
        u = {"x": {"nom": "X", "insigne": "e01"}, "y": {"nom": "Y", "ordre": 2}, "z": {"nom": "Z", "ordre": 1}}
        attribuer_insignes(u)
        self.assertEqual((u["z"]["insigne"], u["y"]["insigne"]), ("e02", "e03"))

    def test_redempteur_sans_planete_prend_un_ecusson(self):
        u = {"a": {"nom": "Rédempteurs inconnus", "groupe": "Rédempteurs"}}
        attribuer_insignes(u)
        self.assertEqual(u["a"]["insigne"], "e01")

    def test_plus_d_ecusson_libre(self):
        u = {f"u{i}": {"nom": f"U{i}", "insigne": f"e{i:02d}"} for i in range(1, 31)}
        u["neuf"] = {"nom": "Neuf"}
        attribuer_insignes(u)
        self.assertEqual(u["neuf"]["insigne"], "")

    def test_insigne_existant_conserve(self):
        u = {"a": {"nom": "A", "insigne": "e07"}}
        self.assertFalse(attribuer_insignes(u))
        self.assertEqual(u["a"]["insigne"], "e07")

    def test_attribue_a_la_creation_et_a_la_synchro(self):
        with tempfile.TemporaryDirectory() as dossier:
            m = Magasin(Path(dossier) / "d.json")
            m.synchroniser({"a": {"nom": "A"}, "b": {"nom": "B"}})
            u = m.public()["unites"]
            self.assertEqual(sorted((u["a"]["insigne"], u["b"]["insigne"])), ["e01", "e02"])
            # Rolling ne connaît pas l'insigne : il est conservé
            m.synchroniser({"a": {"nom": "A"}, "b": {"nom": "B"}})
            self.assertEqual(m.public()["unites"], u)

    def test_attribue_au_demarrage(self):
        with tempfile.TemporaryDirectory() as dossier:
            f = Path(dossier) / "d.json"
            f.write_text(json.dumps({"version": 4, "unites": {"r": {"nom": "Rédempteurs de Mars", "groupe": "Rédempteurs"}}}), encoding="utf-8")
            d = Magasin(f).public()
            self.assertEqual((d["version"], d["unites"]["r"]["insigne"]), (5, "p4"))


class TestHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dossier = tempfile.TemporaryDirectory()
        cls.m = Magasin(Path(cls.dossier.name) / "d.json")
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), fabriquer_gestionnaire(cls.m))
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.dossier.cleanup()

    def appel(self, methode, chemin, corps=None, origine="http://localhost:30000"):
        req = urllib.request.Request(self.url + chemin, method=methode,
                                     data=json.dumps(corps).encode() if corps is not None else None,
                                     headers={"Content-Type": "application/json", **({"Origin": origine} if origine else {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}"), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), e.headers

    def test_sante_et_cors(self):
        code, corps, entetes = self.appel("GET", "/sante")
        self.assertEqual((code, corps["ok"]), (200, True))
        self.assertEqual(entetes["Access-Control-Allow-Origin"], "http://localhost:30000")

    def test_ecriture_lecture(self):
        code, corps, _ = self.appel("PUT", "/unites/garde", {"nom": "Garde du Node", "force": 2})
        self.assertEqual(code, 200)
        code, corps, _ = self.appel("GET", "/unites")
        self.assertEqual(corps["unites"]["garde"]["force"], 2)

    def test_carte(self):
        code, corps, _ = self.appel("PUT", "/carte", CARTE)
        self.assertEqual((code, corps["lieux"]), (200, 2))
        code, corps, _ = self.appel("GET", "/carte")
        self.assertEqual((code, corps["lieux"]["siege-conseil"]["nom"]), (200, "Royaume du Conseil"))
        self.assertEqual(self.appel("PUT", "/carte", {"lieux": []})[0], 400)
        self.assertEqual(self.appel("GET", "/carte", origine="https://site-pirate.example")[0], 403)

    def test_refus(self):
        self.assertEqual(self.appel("PUT", "/unites/garde", {"force": 99})[0], 400)
        self.assertEqual(self.appel("GET", "/unites", origine="https://site-pirate.example")[0], 403)
        self.assertEqual(self.appel("GET", "/ailleurs")[0], 404)


class TestMCP(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.m = Magasin(Path(self.dossier.name) / "d.json")

    def tearDown(self):
        self.dossier.cleanup()

    def test_outils(self):
        r = traiter_mcp(self.m, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
        self.assertEqual(r["result"]["serverInfo"]["name"], "control-room")
        self.assertIsNone(traiter_mcp(self.m, {"jsonrpc": "2.0", "method": "notifications/initialized"}))
        noms = [o["name"] for o in traiter_mcp(self.m, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})["result"]["tools"]]
        self.assertEqual(noms, ["lister_unites", "modifier_unite", "synchroniser_reserve", "recuperer_changements",
                                "acquitter_changements", "etat_serveur_foundry", "lancer_serveur_foundry",
                                "lire_carte", "synchroniser_carte"])
        r = traiter_mcp(self.m, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                 "params": {"name": "modifier_unite", "arguments": {"id": "a", "force": 4}}})
        self.assertEqual(r["result"]["structuredContent"]["unites"]["a"]["force"], 4)
        r = traiter_mcp(self.m, {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                                 "params": {"name": "modifier_unite", "arguments": {"id": "a", "force": 5}}})
        self.assertTrue(r["result"]["isError"])

    def test_processus_stdio(self):
        """Le vrai processus, comme l'application Claude le lance"""
        entree = "\n".join(json.dumps(m) for m in [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "lister_unites", "arguments": {}}}]) + "\n"
        p = subprocess.run([sys.executable, str(ICI / "control_room_server.py"), "mcp", "--donnees", str(self.m.chemin)],
                           input=entree, capture_output=True, text=True, encoding="utf-8", timeout=20)
        lignes = [json.loads(l) for l in p.stdout.splitlines() if l.strip()]
        self.assertEqual([l["id"] for l in lignes], [1, 2])
        self.assertEqual(lignes[1]["result"]["structuredContent"]["unites"], {})


if __name__ == "__main__":
    unittest.main()
