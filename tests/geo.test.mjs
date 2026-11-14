// Tests de la conversion longitude/latitude ↔ Lambert-93 : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { versLambert, versLonLat, CENTRE } from "../scripts/geo.mjs";

// Points de contrôle (Lambert-93 en mètres, valeurs de référence IGN à quelques mètres près)
const POINTS = {
  "tour Eiffel": { lon: 2.294481, lat: 48.858370, x: 648237, y: 6862271 },
  "Notre-Dame": { lon: 2.349902, lat: 48.852968, x: 652300, y: 6861640 },
  "Sacré-Cœur": { lon: 2.343076, lat: 48.886705, x: 651824, y: 6865392 }
};

test("longitude, latitude → Lambert-93 (moins de 15 m d'écart)", () => {
  for ( const [nom, p] of Object.entries(POINTS) ) {
    const [x, y] = versLambert(p.lon, p.lat);
    assert.ok(Math.hypot(x - p.x, y - p.y) < 15, `${nom} : ${x.toFixed(0)}, ${y.toFixed(0)}`);
  }
});

test("aller-retour exact (moins d'un millimètre)", () => {
  for ( const p of Object.values(POINTS) ) {
    const [x, y] = versLambert(p.lon, p.lat);
    const [lon, lat] = versLonLat(x, y);
    assert.ok(Math.abs(lon - p.lon) < 1e-8 && Math.abs(lat - p.lat) < 1e-8);
  }
});

test("le centre du fichier de Paris tombe sur l'île de la Cité", () => {
  const [lon, lat] = versLonLat(...CENTRE);
  assert.ok(Math.abs(lon - 2.347) < 0.01 && Math.abs(lat - 48.855) < 0.01, `${lon}, ${lat}`);
});
