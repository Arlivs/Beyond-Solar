const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js']);
const { BODY, BODIES, terrainHeight, groundHeight, groundAt, V, KSC, surfacePoint } = G;
const rnd = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const dirs = Array.from({ length: 4000 }, () => { const u = rnd() * 2 - 1, t = rnd() * 6.283, s = Math.sqrt(1 - u * u); return [s * Math.cos(t), s * Math.sin(t), u]; });
for (const id of ['earth', 'moon', 'mars', 'mercury', 'venus', 'titan', 'europa', 'io', 'phobos', 'callisto', 'pluto']) {
  const b = BODY[id];
  for (const mw of [3, 50, 2000]) {
    const t0 = process.hrtime.bigint();
    let mn = 1e9, mx = -1e9, sea = 0;
    for (const d of dirs) { const h = terrainHeight(b, d, mw); mn = Math.min(mn, h); mx = Math.max(mx, h); if (h < 0) sea++; }
    const us = Number(process.hrtime.bigint() - t0) / 1e3 / dirs.length;
    if (mw === 3) console.log(`${id.padEnd(8)} R=${(b.R / 1e3).toFixed(0)}km h ${mn.toFixed(0)}..${mx.toFixed(0)} m  below0 ${(100 * sea / dirs.length).toFixed(0)}%  hMax ${b.hMax.toFixed(0)}  ${us.toFixed(2)} us/sample (full detail)`);
    else console.log(`         minWave ${mw} m: ${us.toFixed(2)} us/sample`);
  }
}
const E = BODY.earth, kd = V.norm(surfacePoint(E, KSC.lat, KSC.lon, 0));
const hs = [0, 500, 1500, 3000, 6000, 12000].map(m => { const e1 = V.perp(kd); const d = V.norm(V.addS(kd, e1, m / E.R)); return `${m}m:${terrainHeight(E, d, 3).toFixed(1)}`; });
console.log('KSC profile:', hs.join('  '));
const g = groundAt(E, 0, G.bodyFixedToInertial(E, 0, V.scale(kd, E.R)));
console.log('ground at KSC: h', g.h.toFixed(2), 'normal·up', V.dot(g.nF, kd).toFixed(5), 'water', g.water);
