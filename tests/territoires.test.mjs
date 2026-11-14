// Tests du calcul des territoires par arrondissement : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { territoires, camp, CAMPS } from "../scripts/territoires.mjs";

const FACTIONS = {
  vampires: { nom: "Camarilla", groupe: "Vampires" }, sabbat: { nom: "Sabbat", groupe: "Vampires" },
  anarchs: { nom: "Anarchs", groupe: "Vampires" },
  hermes: { nom: "Ordre d'Hermès", groupe: "Mages" }, ether: { nom: "Fils de l'Éther", groupe: "Mages" },
  verbenae: { nom: "Verbenae", groupe: "Mages" },
  "crocs-argent": { nom: "Crocs d'argent", groupe: "Garous" }, nwo: { nom: "NOM", groupe: "Technocratie" },
  disputee: { nom: "Zone disputée", groupe: "Autres", motif: "hachures" }, "marche-gris": { nom: "Marché gris", groupe: "Autres" }
};
const carte = (arrondissements, quartiers) => ({ factions: FACTIONS, arrondissements, quartiers });

test("le camp qui tient le plus de quartiers l'emporte, factions internes confondues", () => {
  // 19e : disputé, Sabbat, sans faction (hérite des Anarchs de l'arrondissement), Verbenae → Vampires 2 / Mages 1
  const t = territoires(carte({ 19: { controle: "anarchs" } },
    { 73: { ar: 19, controle: "disputee" }, 74: { ar: 19, controle: "sabbat" }, 75: { ar: 19, controle: "" }, 76: { ar: 19, controle: "verbenae" } }));
  assert.equal(t["19"].camp, "vampires");
});

test("la faction de l'arrondissement ne compte que pour ses quartiers sans faction propre", () => {
  const t = territoires(carte({ 3: { controle: "vampires" } },
    { 9: { ar: 3, controle: "ether" }, 10: { ar: 3, controle: "hermes" }, 11: { ar: 3, controle: "ether" }, 12: { ar: 3, controle: "" } }));
  assert.equal(t["3"].camp, "mages");
  assert.equal(t["3"].faction, "ether");  // faction la plus présente du camp gagnant (mode détaillé)
});

test("un quartier absent de la base prend la faction de son arrondissement (quartier n dans ⌈n/4⌉)", () => {
  const t = territoires(carte({ 8: { controle: "vampires" } }, {}));
  assert.deepEqual(t["8"], { camp: "vampires", faction: "vampires" });
});

test("le Marché gris compte chez les Mages", () => {
  assert.equal(camp("marche-gris", FACTIONS), "mages");
  const t = territoires(carte({}, { 33: { ar: 9, controle: "marche-gris" }, 34: { ar: 9, controle: "hermes" }, 35: { ar: 9, controle: "vampires" } }));
  assert.equal(t["9"].camp, "mages");
});

test("plus de zones disputées : les quartiers disputés ne comptent pas", () => {
  const t = territoires(carte({ 2: { controle: "disputee" } },
    { 5: { ar: 2, controle: "disputee" }, 6: { ar: 2, controle: "ether" } }));
  assert.equal(t["2"].camp, "mages");
  assert.ok(Object.values(t).every(v => v.camp !== "disputee"));
});

test("égalité : arbitrage du MJ, sinon le camp de l'arrondissement, sinon neutre", () => {
  // 7e arbitré Technocratie, même si l'arrondissement est donné à la Camarilla
  const t7 = territoires(carte({ 7: { controle: "vampires" } }, { 25: { ar: 7, controle: "nwo" }, 26: { ar: 7, controle: "nwo" } }));
  assert.equal(t7["7"].camp, "technocratie");
  // 5e (non arbitré), égalité Vampires / Mages, arrondissement Camarilla → Vampires
  const t5 = territoires(carte({ 5: { controle: "vampires" } },
    { 17: { ar: 5, controle: "hermes" }, 18: { ar: 5, controle: "hermes" } }));
  assert.equal(t5["5"].camp, "vampires");
  // égalité sans arbitrage ni faction d'arrondissement → neutre
  const t6 = territoires(carte({}, { 21: { ar: 6, controle: "hermes" }, 22: { ar: 6, controle: "vampires" } }));
  assert.equal(t6["6"], undefined);
});

test("rien de connu : arrondissement absent (neutre)", () => {
  const t = territoires(carte({ 5: { controle: "" } }, { 20: { ar: 5, controle: "" } }));
  assert.equal(t["5"], undefined);
});

test("camps du mode simplifié", () => {
  assert.equal(camp("sabbat", FACTIONS), "vampires");
  assert.equal(camp("ether", FACTIONS), "mages");
  assert.equal(camp("crocs-argent", FACTIONS), "garous");
  assert.equal(camp("nwo", FACTIONS), "technocratie");
  assert.equal(camp("disputee", FACTIONS), null);
  assert.equal(camp("inconnue", FACTIONS), "autre");
  for ( const c of ["vampires", "mages", "garous", "technocratie", "autre"] ) assert.ok(CAMPS[c]?.couleur);
});
