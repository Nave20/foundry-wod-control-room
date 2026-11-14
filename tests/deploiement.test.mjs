// Tests des règles de déploiement des unités : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deployable, regrouper, filtrerUnites, couleurGroupe } from "../scripts/deploiement.mjs";

const LIEUX = { opera: { nom: "Opéra", pj: true }, cave: { nom: "Cave", pj: false }, serenite: { nom: "Sérénité", pj: true } };

test("unités déployables", () => {
  assert.equal(deployable({ groupe: "À gagner", statut: "disponible" }).ok, false);
  assert.equal(deployable({ groupe: "À gagner", statut: "disponible" }).raison, "À gagner");
  assert.deepEqual(deployable({ groupe: "Rédempteurs", statut: "blesse" }), { ok: false, raison: "Indisponible" });
  for ( const [statut, raison] of [["absent", "Absente"], ["perdu", "Perdue"], ["vide", "Vide"]] ) {
    assert.deepEqual(deployable({ statut }), { ok: false, raison });
  }
  assert.equal(deployable({ groupe: "Rédempteurs", statut: "engage" }).ok, true);   // déplacement
  assert.equal(deployable({ groupe: "Alliés du Conseil", statut: "disponible" }).ok, true);
});

test("regroupement par lieu, groupe et état", () => {
  const unites = {
    a: { groupe: "Rédempteurs", statut: "engage", repere: "opera" },
    b: { groupe: "Rédempteurs", statut: "engage", repere: "opera" },
    c: { groupe: "Rédempteurs", statut: "disponible", residence: "opera" },
    d: { groupe: "Alliés du Conseil", statut: "engage", repere: "opera" },
    e: { groupe: "Rédempteurs", statut: "engage" },                          // en mission hors carte
    f: { groupe: "Rédempteurs", statut: "engage", residence: "serenite" },  // engagée : pas à résidence
    g: { groupe: "Rédempteurs", statut: "engage", repere: "inconnu" }
  };
  const r = regrouper(unites, LIEUX);
  assert.deepEqual([...r.keys()], ["opera"]);
  assert.deepEqual(r.get("opera"), [
    { groupe: "Rédempteurs", etat: "deploye", ids: ["a", "b"] },
    { groupe: "Rédempteurs", etat: "residence", ids: ["c"] },
    { groupe: "Alliés du Conseil", etat: "deploye", ids: ["d"] }
  ]);
});

test("copie des joueurs : jamais un lieu caché", () => {
  const u = { a: { nom: "A", residence: "cave", repere: "opera" }, b: { nom: "B", residence: "opera", repere: "cave" } };
  const f = filtrerUnites(u, LIEUX);
  assert.deepEqual(f, { a: { nom: "A", residence: "", repere: "opera" }, b: { nom: "B", residence: "opera", repere: "" } });
  assert.equal(u.a.residence, "cave");  // l'original n'est pas touché
});

test("couleurs des groupes", () => {
  assert.equal(couleurGroupe("Rédempteurs"), "#ffd27a");
  assert.equal(couleurGroupe("Alliés du Conseil"), "#bff6ff");
  assert.equal(couleurGroupe("Autre"), "#9fd8e8");
});

test("pas à résidence : unités à gagner, perdues ou vides", () => {
  const u = {
    a: { groupe: "À gagner", statut: "absent", residence: "opera" },
    b: { groupe: "Rédempteurs", statut: "perdu", residence: "opera" },
    c: { groupe: "Rédempteurs", statut: "vide", residence: "opera" },
    d: { groupe: "Rédempteurs", statut: "blesse", residence: "opera" }
  };
  assert.deepEqual(regrouper(u, LIEUX).get("opera"), [{ groupe: "Rédempteurs", etat: "residence", ids: ["d"] }]);
});
