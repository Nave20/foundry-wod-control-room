import { test } from "node:test";
import assert from "node:assert/strict";
import { aDiffuser } from "../scripts/diffusion.mjs";

test("premiere_lecture_sans_effet", () => {
  assert.deepEqual(aDiffuser(null, { seq: 7, quoi: "carte" }), { action: "rien", vu: 7 });
});

test("nouvelle_diffusion", () => {
  assert.deepEqual(aDiffuser(7, { seq: 8, quoi: "carte" }), { action: "montrer", vu: 8 });
});

test("meme_numero_sans_effet", () => {
  assert.deepEqual(aDiffuser(8, { seq: 8, quoi: "carte" }), { action: "rien", vu: 8 });
});

test("serveur_redemarre", () => {
  assert.deepEqual(aDiffuser(8, { seq: 1, quoi: "carte" }), { action: "rien", vu: 1 });
  assert.equal(aDiffuser(1, { seq: 2, quoi: "carte" }).action, "montrer");
});

test("quoi_inconnu", () => {
  assert.deepEqual(aDiffuser(1, { seq: 2, quoi: "autre" }), { action: "rien", vu: 2 });
});
