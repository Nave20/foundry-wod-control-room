// Tests des insignes d'unités : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { svgInsigne, IDS_INSIGNES } from "../scripts/insignes.mjs";

test("39 insignes : 9 planètes et 30 écussons", () => {
  assert.equal(IDS_INSIGNES.length, 39);
  assert.deepEqual(IDS_INSIGNES.slice(0, 3), ["p1", "p2", "p3"]);
  assert.equal(IDS_INSIGNES.at(-1), "e30");
});

test("écusson : emblème et galons", () => {
  const s = svgInsigne("e12", "#fff", 40);
  assert.match(s, /^<svg[^>]*width="40"/);
  assert.ok(s.includes("M11 20q9-9 18 0"), "emblème œil");     // e12 : 2e emblème, chevrons
  assert.ok(s.includes("M12 33l8-3 8 3"), "chevrons");
  assert.ok(!svgInsigne("e02", "#fff", 40).includes("M12 33l8-3"), "e02 sans galon");
  assert.ok(svgInsigne("e30", "#fff", 40).includes("M13 7h14"), "e30 : barrettes");
});

test("planète : autant d'étoiles que son rang", () => {
  const etoiles = s => (s.match(/stroke="none"/g) ?? []).length;
  assert.equal(etoiles(svgInsigne("p9", "#ffd27a", 52)), 9);
  assert.equal(etoiles(svgInsigne("p1", "#ffd27a", 52)), 1);
});

test("identifiants de découpe uniques, ids inconnus vides", () => {
  const id = s => s.match(/clipPath id="([^"]+)"/)[1];
  assert.notEqual(id(svgInsigne("p3", "#fff", 28)), id(svgInsigne("p3", "#fff", 28)));
  assert.equal(svgInsigne("zz", "#fff", 28), "");
  assert.equal(svgInsigne("", "#fff", 28), "");
});
