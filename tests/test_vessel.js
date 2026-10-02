const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js']);
const { stockDesigns, buildVessel, simulateStages, designCost, designMass, layoutDesign, PART, massProps, partsDetachedBy } = G;
for (const d of stockDesigns()) {
  const v = buildVessel(d);
  const mp = massProps(v);
  console.log(`\n== ${d.name}: ${v.parts.length} parts, ${designMass(d).toFixed(2)} t, cost ${designCost(d).toFixed(0)}, stages ${JSON.stringify(v.stages.map(s => s.map(r => v.parts[r].id)))}`);
  console.log('  com', mp.com.map(x => x.toFixed(2)).join(','), 'I', mp.I.map(x => x.toExponential(2)).join(','));
  const vac = simulateStages(v, 0), sl = simulateStages(v, 1);
  let tv = 0, ts = 0;
  vac.forEach((s, i) => { tv += s.dv; ts += sl[i].dv; console.log(`  stage ${s.stage}: dv vac ${s.dv.toFixed(0)} / SL ${sl[i].dv.toFixed(0)} m/s, burn ${s.time.toFixed(1)} s, TWR(SL) ${sl[i].twr.toFixed(2)}, m ${(s.m0/1000).toFixed(2)}->${(s.m1/1000).toFixed(2)} t`); });
  console.log(`  total dv vac ${tv.toFixed(0)} m/s, SL ${ts.toFixed(0)}`);
}
