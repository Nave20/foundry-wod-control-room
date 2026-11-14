/**
 * Conversion longitude, latitude (WGS84, degrés) ↔ Lambert-93 (mètres), formules de l'IGN (projection conique
 * conforme de Lambert, ellipsoïde GRS80). Précision de l'ordre du mètre dans Paris : l'écart WGS84 / RGF93 est négligeable.
 * Sans dépendance : utilisé par la fenêtre de l'hologramme et par les tests (node --test tests/).
 */

/** Centre des fichiers de Paris (tools/extract_paris.py) : les coordonnées de la carte sont relatives à ce point */
export const CENTRE = [652000, 6862000];

// Constantes de Lambert-93
const E = 0.0818191910428158;          // première excentricité de GRS80
const N = 0.7256077650532670;          // exposant de la projection
const C = 11754255.426096;             // constante de la projection (m)
const XS = 700000, YS = 12655612.049876;
const LON0 = 3 * Math.PI / 180;        // méridien d'origine

/** Latitude isométrique */
function latIso(phi) {
  const s = Math.sin(phi);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
}

/** Longitude, latitude (degrés) → [x, y] Lambert-93 (m) */
export function versLambert(lon, lat) {
  const R = C * Math.exp(-N * latIso(lat * Math.PI / 180));
  const g = N * (lon * Math.PI / 180 - LON0);
  return [XS + R * Math.sin(g), YS - R * Math.cos(g)];
}

/** [x, y] Lambert-93 (m) → [longitude, latitude] (degrés) */
export function versLonLat(x, y) {
  const dx = x - XS, dy = y - YS;
  const R = Math.hypot(dx, dy), g = Math.atan2(dx, -dy);
  const L = -Math.log(R / C) / N;
  // Latitude : itération de la latitude isométrique inverse (converge en quelques tours)
  let phi = 2 * Math.atan(Math.exp(L)) - Math.PI / 2;
  for ( let i = 0; i < 12; i++ ) {
    const s = Math.sin(phi);
    const suivant = 2 * Math.atan(Math.pow((1 + E * s) / (1 - E * s), E / 2) * Math.exp(L)) - Math.PI / 2;
    if ( Math.abs(suivant - phi) < 1e-13 ) { phi = suivant; break; }
    phi = suivant;
  }
  return [(LON0 + g / N) * 180 / Math.PI, phi * 180 / Math.PI];
}

/** Longitude, latitude → coordonnées de la carte (m, relatives au centre des fichiers) */
export function versCarte(lon, lat) {
  const [x, y] = versLambert(lon, lat);
  return [x - CENTRE[0], y - CENTRE[1]];
}

/** Coordonnées de la carte (m, relatives au centre) → [longitude, latitude] */
export function depuisCarte(x, y) {
  return versLonLat(x + CENTRE[0], y + CENTRE[1]);
}
