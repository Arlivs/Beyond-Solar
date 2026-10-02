'use strict';
// Biomes: named regions of every solid body, derived from its terrain (height bands by quantile, poles, seas and
// a few landmarks). Landed and low-flight science counts separately in each biome. Mapping satellites reveal them.

const BIOME_GRID = { nLat: 90, nLon: 180 };          // 2-degree cells for scanning and the atlas

// height quantiles of a body's terrain (coarse, cached): [q20, q50, q80]
function bodyHeightQuantiles(b) {
  if (b._hq) return b._hq;
  const r = rng(7919 + b.R | 0), hs = [];
  for (let i = 0; i < 2000; i++) { const u = r() * 2 - 1, t = r() * TAU, s = Math.sqrt(1 - u * u); hs.push(terrainHeight(b, [s * Math.cos(t), s * Math.sin(t), u], 2000)); }
  hs.sort((a, c) => a - c);
  return (b._hq = [hs[400], hs[1000], hs[1600]]);
}

const BIOME_SETS = {
  earth: [['ksc', 'Космодром', '#e8b51c'], ['polar', 'Полярные шапки', '#e8f1f6'], ['deep', 'Глубокий океан', '#1c3f78'], ['shelf', 'Мелководье', '#3f7fb8'],
    ['plains', 'Равнины', '#5b8f3a'], ['hills', 'Холмы', '#8a9a4a'], ['mountains', 'Горы', '#8a7a68']],
  moon: [['polar', 'Полюса', '#dcdcd8'], ['maria', 'Моря', '#4a4a4c'], ['low', 'Низины', '#77767a'], ['plains', 'Равнины', '#9c9a98'], ['high', 'Нагорья', '#c4c0b8']],
  mars: [['polar', 'Полярные шапки', '#f2ece6'], ['volcano', 'Вулканическое плато', '#7a2a12'], ['low', 'Низменности', '#a0441e'], ['plains', 'Равнины', '#c2562a'], ['high', 'Высокогорья', '#d98a5a']],
  titan: [['sea', 'Метановые моря', '#2a2014'], ['polar', 'Полярные районы', '#c9a46a'], ['dunes', 'Дюны', '#a5662a'], ['high', 'Возвышенности', '#e8b866']],
  ice: [['polar', 'Полюса', '#ffffff'], ['cracks', 'Разломы', '#9a6a44'], ['low', 'Ледяные низины', '#c9d4dc'], ['high', 'Ледяные гряды', '#eef3f6']],
  small: [['lead', 'Ведущая сторона', '#8f8379'], ['trail', 'Ведомая сторона', '#5a5047']],
  rocky: [['polar', 'Полюса', '#d8d4ce'], ['low', 'Низины', '#6a655e'], ['plains', 'Равнины', '#958e85'], ['high', 'Нагорья', '#c0b8ac']],
};
function biomeSet(b) {
  if (b.id === 'earth' || b.id === 'moon' || b.id === 'mars' || b.id === 'titan') return BIOME_SETS[b.id];
  if (b.id === 'phobos' || b.id === 'deimos') return BIOME_SETS.small;
  if (b.terrain && b.terrain.kind === 'ice') return BIOME_SETS.ice;
  return BIOME_SETS.rocky;
}
function biomeById(b, id) { const s = biomeSet(b).find(x => x[0] === id); return s ? { id: s[0], name: s[1], color: s[2] } : null; }

// biome id at a planet-fixed unit direction
function biomeAt(b, d) {
  if (!b.terrain) return null;
  const lat = Math.asin(clamp(d[2], -1, 1)) / DEG, lon = Math.atan2(d[1], d[0]);
  const h = terrainHeight(b, d, 2000), q = bodyHeightQuantiles(b), T = b.terrain;
  switch (b.id) {
    case 'earth':
      if (Math.hypot(d[0] - _KSC_DIR[0], d[1] - _KSC_DIR[1], d[2] - _KSC_DIR[2]) * b.R < 4000) return 'ksc';
      if (Math.abs(lat) > 66) return 'polar';
      if (h < -1500) return 'deep';
      if (h < 0) return 'shelf';
      return h < 300 ? 'plains' : h < 1500 ? 'hills' : 'mountains';
    case 'moon':
      if (Math.abs(lat) > 70) return 'polar';
      return h < q[0] ? 'maria' : h < q[1] ? 'low' : h < q[2] ? 'plains' : 'high';
    case 'mars': {
      if (Math.abs(lat) > 65) return 'polar';
      const c = V.norm(T.bulge[0]);
      if (V.dot(d, c) > 0.93) return 'volcano';
      return h < q[0] ? 'low' : h < q[2] ? 'plains' : 'high';
    }
    case 'titan':
      if (h < T.sea) return 'sea';
      if (Math.abs(lat) > 60) return 'polar';
      return h < q[1] ? 'dunes' : 'high';
    case 'phobos': case 'deimos':
      return Math.cos(lon) > 0 ? 'lead' : 'trail';
  }
  if (T.kind === 'ice') {
    if (Math.abs(lat) > 70) return 'polar';
    if (T.cracks) { const N = _noiseFor(T.seed), k = T.cracks[0]; if (Math.pow(1 - Math.abs(N(d[0] * k + 50, d[1] * k, d[2] * k)), 12) > 0.35) return 'cracks'; }
    return h < q[1] ? 'low' : 'high';
  }
  if (Math.abs(lat) > 70) return 'polar';
  return h < q[0] ? 'low' : h < q[2] ? 'plains' : 'high';
}
// biome under a vessel (planet-fixed), only where it matters for science (landed, low flight)
function vesselBiome(v, t) {
  const b = v.body; if (!b.terrain) return null;
  const sit = sciSituation(v);
  if (sit !== 'L' && sit !== 'FL') return null;
  return biomeAt(b, V.norm(inertialToBodyFixed(b, t, v.r)));
}

// ---- mapping satellites ----
// decoded grids live in g._scan (not saved); g.scans holds base64 bitsets (saved, see flushScans)
function scanGrid(g, bodyId) {
  g._scan = g._scan || {};
  if (g._scan[bodyId]) return g._scan[bodyId];
  const s = (g.scans || {})[bodyId], out = new Uint8Array(BIOME_GRID.nLat * BIOME_GRID.nLon);
  if (s) { const bin = atob(s); for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1; }
  return (g._scan[bodyId] = out);
}
function flushScans(g) { for (const id in g._scan || {}) if (g._scanDirty && g._scanDirty[id]) { scanStore(g, id, g._scan[id]); g._scanDirty[id] = false; } }
function scanStore(g, bodyId, grid) {
  g.scans = g.scans || {};
  const n = grid.length, bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (grid[i]) bytes[i >> 3] |= 1 << (i & 7);
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  g.scans[bodyId] = btoa(bin);
}
function scanCoverage(grid) {
  // area-weighted share of scanned cells
  let a = 0, s = 0;
  for (let j = 0; j < BIOME_GRID.nLat; j++) { const w = Math.cos(((j + 0.5) / BIOME_GRID.nLat * 180 - 90) * DEG); for (let i = 0; i < BIOME_GRID.nLon; i++) { a += w; if (grid[j * BIOME_GRID.nLon + i]) s += w; } }
  return s / a;
}
// swath under a scanner between t0 and t1 (rails or physics); returns cells newly revealed
function scanTick(g, v, t0, t1, cache) {
  const b = v.body;
  if (!b.terrain || v.landed || v.lock || v.destroyed) return 0;
  const sc = v.parts.find(p => !p.dead && PART[p.id].scanner && p.st.scan !== false);
  if (!sc) return 0;
  const alt = V.len(v.r) - b.R, S = PART[sc.id].scanner;
  if (alt < (b.atm ? b.atm.top : 0) + S.minAlt * b.R || alt > S.maxAlt * b.R) return 0;
  if (vesselRes(v, 'ELEC') < 0.01) return 0;
  const el = v.rails && v.rails.patch && v.rails.patch.body === b ? v.rails.patch.el : elFromState(v.r, v.v, b.mu, t1);
  const grid = scanGrid(g, b.id);
  cache[b.id] = grid;
  const half = Math.min(Math.atan(alt * Math.tan(S.fov * DEG) / b.R), 0.35);
  const span = t1 - t0, n = Math.max(1, Math.min(1500, Math.ceil(span / ((isFinite(el.T) ? el.T : 3600) / 600))));
  let added = 0;
  for (let k = 0; k <= n; k++) {
    const t = t0 + span * k / n;
    const d = V.norm(inertialToBodyFixed(b, t, elState(el, t).r));
    const lat = Math.asin(d[2]), lon = Math.atan2(d[1], d[0]);
    const j0 = Math.max(0, Math.floor((lat - half) / DEG / 2 + 45)), j1 = Math.min(BIOME_GRID.nLat - 1, Math.floor((lat + half) / DEG / 2 + 45));
    for (let j = j0; j <= j1; j++) {
      const cl = Math.max(0.05, Math.cos(((j + 0.5) * 2 - 90) * DEG));
      const dl = Math.min(Math.PI, half / cl);
      const i0 = Math.floor((lon - dl) / DEG / 2), i1 = Math.floor((lon + dl) / DEG / 2);
      for (let i = i0; i <= i1; i++) {
        const ii = ((i % BIOME_GRID.nLon) + BIOME_GRID.nLon) % BIOME_GRID.nLon, c = j * BIOME_GRID.nLon + ((ii + 90) % BIOME_GRID.nLon);
        if (!grid[c]) { grid[c] = 1; added++; }
      }
    }
  }
  return added;
}
// grid cell index -> planet-fixed direction of its centre (lon from -180)
function cellDir(j, i) {
  const lat = ((j + 0.5) * 2 - 90) * DEG, lon = ((i + 0.5) * 2 - 180) * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
