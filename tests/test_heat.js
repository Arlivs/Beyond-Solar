// Re-entry heating calibration: capsule entering Earth's atmosphere from LEO and from a lunar return.
const [hk, aj] = [process.argv[2], process.argv[3]];
const repl = [];
if (hk) repl.push([/const HEAT_K = [^;]+;/, `const HEAT_K = ${hk};`]);
if (aj) repl.push([/const ABLATE_J = [^;]+;/, `const ABLATE_J = ${aj};`]);
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js'], repl);
const { V, Q, BODY, PART, makeDesign, buildVessel, physicsStep, activateStage, PHYS_DT, massProps } = G;
const E = BODY.earth;
function run(label, spec, apo) {
  const v = buildVessel(makeDesign('t', spec));
  v.body = E;
  const r0 = E.R + 75000, rp = E.R + 32000, ra = apo;
  const a = (rp + ra) / 2, sp = Math.sqrt(E.mu * (2 / r0 - 1 / a));
  const h = Math.sqrt(E.mu * a * (1 - ((ra - rp) / (ra + rp)) ** 2));
  const vt = h / r0, vr = -Math.sqrt(Math.max(0, sp * sp - vt * vt));
  v.r = [r0, 0, 0]; v.v = [vr, vt, 0];
  // point retrograde (nose against velocity): local +Y = -v
  const back = V.norm(V.neg(v.v));
  const side = V.norm(V.cross(back, [0, 0, 1]));
  v.q = Q.fromBasis(side, back, V.cross(side, back));
  v.w = [0, 0, 0]; v.sas = true; v.sasMode = 'retro';
  v._comPrev = massProps(v).com.slice();
  let ut = 0, maxT = {}, ev = [];
  const hooks = { event: (t, x) => { if (t === 'explode' || t === 'destroyed') ev.push(t + ':' + (x.part ? PART[x.part.id].name : x.why)); } };
  for (const p of v.parts) if (PART[p.id].chute) p.st.chute = 'armed';
  let peakFlux = 0, peakG = 0;
  while (ut < 1500 && !v.destroyed && !v.landed) {
    physicsStep(v, PHYS_DT, ut, {}, hooks); ut += PHYS_DT;
    for (const p of v.parts) if (!p.dead) maxT[PART[p.id].name] = Math.max(maxT[PART[p.id].name] || 0, p.T);
    peakFlux = Math.max(peakFlux, v.heatFlux || 0); if (V.len(v.r) - E.R > 15000) peakG = Math.max(peakG, v.accel || 0);
  }
  const sh = v.parts.find(p => PART[p.id].shield);
  console.log(`${label.padEnd(26)} entry ${sp.toFixed(0)} m/s | peak flux ${(peakFlux / 1e3).toFixed(0)} kW/m2, ${peakG.toFixed(1)} g | ${Object.entries(maxT).map(([k, t]) => k + ' ' + t.toFixed(0) + 'K').join(', ')} | ablator ${sh ? (100 * (1 - sh.res.ABLATOR / PART[sh.id].res.ABLATOR)).toFixed(0) + '% used' : '-'} | ${v.destroyed ? 'DESTROYED' : v.landed ? 'landed' : 'flying'} ${ev.join(' ')}`);
}
const moonApo = BODY.moon.el.a;
run('LEO + shield', ['chute_s', 'pod_k1', 'shield_s1'], E.R + 120000);
run('LEO no shield', ['chute_s', 'pod_k1'], E.R + 120000);
run('Moon return + shield', ['chute_s', 'pod_k1', 'shield_s1'], moonApo);
run('Moon return no shield', ['chute_s', 'pod_k1'], moonApo);
run('Escape-speed+ (Mars) shld', ['chute_s', 'pod_k1', 'shield_s1'], -1e9);
