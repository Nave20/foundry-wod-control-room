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
from control_room_server import Magasin, fabriquer_gestionnaire, traiter_mcp  # noqa: E402

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
        self.assertEqual(d["unites"]["verbenae"], {"nom": "Verbenae de Montreuil", "force": 3, "statut": "disponible"})
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
                                "acquitter_changements", "etat_serveur_foundry", "lancer_serveur_foundry"])
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
