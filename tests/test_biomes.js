// Biomes and mapping: every biome of a set occurs, landmarks resolve, a polar scanner covers the Moon on rails.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'biomes.js', 'career.js']);
const { V, BODY, biomeAt, biomeSet, makeDesign, buildVessel, scanTick, scanGrid, scanCoverage, newGame, mappingCredit, surfacePoint, KSC, elFromState } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (const id of ['earth', 'moon', 'mars', 'titan', 'europa', 'mercury', 'phobos']) {
  const b = BODY[id], cnt = {};
  for (let i = 0; i < 4000; i++) { const u = rnd() * 2 - 1, t = rnd() * 6.283, s = Math.sqrt(1 - u * u); const k = biomeAt(b, [s * Math.cos(t), s * Math.sin(t), u]); cnt[k] = (cnt[k] || 0) + 1; }
  const set = biomeSet(b).map(x => x[0]).filter(x => x !== 'ksc');
  const missing = set.filter(x => !cnt[x]);
  ok(!missing.length, `${b.name}: ${Object.entries(cnt).map(([k, n]) => k + ' ' + (n / 40).toFixed(0) + '%').join(', ')}${missing.length ? ' — нет: ' + missing.join(',') : ''}`);
}
const E = BODY.earth;
ok(biomeAt(E, V.norm(surfacePoint(E, KSC.lat, KSC.lon, 0))) === 'ksc', 'the space centre is its own biome');
ok(biomeAt(BODY.moon, [0, 0, 1]) === 'polar', 'Moon north pole is polar');
// polar orbit around the Moon, 60 km, scanned on rails for 3 days
{
  const g = newGame('career'), M = BODY.moon;
  const v = buildVessel(makeDesign('Картограф', ['probe_p1', { id: 'battery_l', r: [{ sym: 1, part: 'sci_scanner' }] }]), 'К');
  const R = M.R + 60000, vc = Math.sqrt(M.mu / R);
  v.body = M; v.r = [R, 0, 0]; v.v = [0, 0, vc]; v.q = [0, 0, 0, 1]; v.w = [0, 0, 0];
  v.rails = { landed: false, patch: { body: M, el: elFromState(v.r, v.v, M.mu, 0) } };
  const cache = {}; let t = 0, cov = 0, sci = 0;
  const day = G.DAY;
  // the Moon turns under a polar orbit once per ~27 game days: half a turn shows (nearly) all of it
  for (let k = 0; k < 28; k++) { scanTick(g, v, t, t + day / 2, cache); t += day / 2; cov = scanCoverage(cache.moon); sci += mappingCredit(g, 'moon', cov); }
  ok(cov > 0.85, `polar mapper covered ${(cov * 100).toFixed(0)}% of the Moon in 14 days, +${sci.toFixed(1)} science`);
  ok(scanGrid(g, 'moon') === cache.moon, 'grid is cached per body');
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exitCode = fails ? 1 : 0;
