'use strict';
// Procedural sound (WebAudio, no sample files). Continuous beds are looped noise buffers shaped by
// filters whose parameters follow the flight state every frame; events are short synthesized one-shots.
// Vacuum rule: only structure-borne sound reaches the camera (low-passed rumble, no roar/hiss/wind).

const SND = {
  ctx: null, G: null, vol: 0.6, ui: true, mode: null, started: false,
  bufs: null, last: new Map(),
};

function sndSettingsLoad() {
  try { const v = localStorage.getItem('orbita.vol'); if (v != null) SND.vol = clamp(+v, 0, 1); SND.ui = localStorage.getItem('orbita.uisnd') !== '0'; } catch (e) { /* ignore */ }
}
function sndSetVolume(v) {
  SND.vol = clamp(v, 0, 1);
  try { localStorage.setItem('orbita.vol', String(SND.vol)); } catch (e) { /* ignore */ }
  if (SND.G) SND.G.master.gain.setTargetAtTime(SND.vol, SND.ctx.currentTime, 0.05);
}
function sndSetUi(on) { SND.ui = !!on; try { localStorage.setItem('orbita.uisnd', on ? '1' : '0'); } catch (e) { /* ignore */ } }

// ---- noise buffers (shared by every context of the same sample rate) ----
function sndMakeBuffers(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 2.5);
  const mk = (fill) => { const b = ctx.createBuffer(1, n, sr); fill(b.getChannelData(0)); return b; };
  const r = rng(4242);
  const white = mk(d => { for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; });
  const pink = mk(d => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  });
  const brown = mk(d => { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
  // sparse decaying impulses over a little rumble: solid motors, plasma, gravel
  const crackle = mk(d => {
    let env = 0, sgn = 1, l = 0;
    for (let i = 0; i < n; i++) {
      if (r() < 0.0016) { env = 0.3 + r() * 0.7; sgn = r() < 0.5 ? -1 : 1; }
      env *= 0.985; l = (l + 0.02 * (r() * 2 - 1)) / 1.02;
      d[i] = sgn * env * (r() * 0.6 + 0.4) + l * 0.8;
    }
  });
  return { white, pink, brown, crackle };
}

// ---- graph: continuous layers ----
function sndBuildGraph(ctx, dest) {
  const bufs = sndMakeBuffers(ctx);
  const master = ctx.createGain(); master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  master.connect(comp); comp.connect(dest);
  const world = ctx.createGain(); world.gain.value = 1; world.connect(master);   // ducked in map view
  const src = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; };
  const filt = (type, f, q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q == null ? 0.707 : q; return x; };
  const gain = (to) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(to || world); return g; };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
  // slow random modulator (turbulence / gusts): brown noise low-passed to a few Hz
  const wobble = (hz, depth, param) => { const g = ctx.createGain(); g.gain.value = depth; chain(src(bufs.brown), filt('lowpass', hz, 0.5), g); g.connect(param); return g; };
  const L = {};
  // engines: rumble (structure + air), roar (air only), hiss (close, air only), solid crackle, ion whine
  L.rumbleF = filt('lowpass', 140, 0.8); L.rumble = gain(); chain(src(bufs.brown), L.rumbleF, L.rumble);
  L.roarF = filt('bandpass', 520, 0.55); L.roar = gain(); chain(src(bufs.pink), L.roarF, L.roar);
  L.roarMod = wobble(9, 0, L.roar.gain);
  L.hissF = filt('bandpass', 3200, 0.8); L.hiss = gain(); chain(src(bufs.pink), L.hissF, L.hiss);
  L.crackF = filt('bandpass', 1300, 0.45); L.crack = gain(); chain(src(bufs.crackle), L.crackF, L.crack);
  // turbine: a whine that climbs with the spool plus a hollow roar
  L.jetO = ctx.createOscillator(); L.jetO.type = 'sawtooth'; L.jetO.frequency.value = 300;
  L.jetW = filt('bandpass', 1200, 4); L.jet = gain(); L.jetO.connect(L.jetW); L.jetW.connect(L.jet); L.jetO.start();
  L.jetN = gain(); chain(src(bufs.pink), filt('bandpass', 900, 0.7), L.jetN);
  L.ion = gain(); { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 132; const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 2950; const g2 = ctx.createGain(); g2.gain.value = 0.18; o.connect(L.ion); o2.connect(g2); g2.connect(L.ion); o.start(); o2.start(); L.ionO = o2; }
  // air: wind (speed -> pitch, dynamic pressure -> level), re-entry plasma roar + crackle
  L.windF = filt('bandpass', 400, 0.9); L.wind = gain(); chain(src(bufs.pink), L.windF, L.wind);
  L.windMod = wobble(0.7, 0, L.wind.gain);
  L.plasmaF = filt('lowpass', 500, 0.7); L.plasma = gain(); chain(src(bufs.brown), L.plasmaF, L.plasma);
  L.plasmaC = gain(); chain(src(bufs.crackle), filt('bandpass', 900, 0.6), L.plasmaC);
  // RCS: hissing puffs
  L.rcsF = filt('highpass', 1800, 0.6); L.rcsLP = filt('lowpass', 9000, 0.6); L.rcs = gain(); chain(src(bufs.white), L.rcsF, L.rcsLP, L.rcs);
  // ambience beds (not ducked by the map)
  L.cabin = gain(master); chain(src(bufs.brown), filt('lowpass', 240, 0.6), L.cabin);
  L.hall = gain(master); chain(src(bufs.brown), filt('lowpass', 170, 0.6), L.hall);
  L.breeze = gain(master); chain(src(bufs.pink), filt('bandpass', 380, 0.5), L.breeze); L.breezeMod = wobble(0.4, 0, L.breeze.gain);
  L.drone = gain(master);
  { const lp = filt('lowpass', 520, 1.2); lp.connect(L.drone); for (const [f, ty] of [[55, 'triangle'], [82.6, 'triangle'], [110.3, 'sine']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(lp); o.start(); } const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); }
  return { ctx, master, world, bufs, L, last: new Map() };
}

// smoothed parameter change; skips when the target barely moved (keeps automation lists short)
function sndSet(G, param, v, tau) {
  const prev = G.last.get(param);
  if (prev != null && Math.abs(prev - v) <= Math.max(1e-4, Math.abs(prev) * 0.01)) return;
  G.last.set(param, v);
  param.setTargetAtTime(v, G.ctx.currentTime, tau || 0.08);
}

// P: {lfo: liquid kN, srb: solid kN, ion: 0..1, p: atm pressure (atm), dist: camera m, speed: air m/s, dynP: Pa,
//     heat: W/m2, rcs: 0..1, crewed, landedAir, map, alive}
function sndApplyFlight(G, P) {
  const L = G.L;
  const air = clamp(P.p, 0, 1.5), airF = Math.sqrt(Math.min(1, air));
  const loud = (kN) => clamp(Math.log10(1 + kN / 15) / 2.4, 0, 1);
  const lq = loud(P.lfo || 0), sl = loud(P.srb || 0), eng = Math.max(lq, sl);
  // through air the sound falls off with distance; in vacuum it is the hull we are attached to
  const att = air > 0.002 ? 1 / (1 + Math.max(0, P.dist - 20) / 90) : 1;
  const hf = 1 / (1 + P.dist / 600);                           // air absorption of highs
  const alive = P.alive ? 1 : 0;
  sndSet(G, L.rumble.gain, alive * (0.75 * eng + 0.25 * sl) * (0.55 + 0.45 * airF) * lerp(1, att, airF));
  sndSet(G, L.rumbleF.frequency, 70 + 160 * eng + 260 * airF * hf);
  sndSet(G, L.roar.gain, alive * 0.55 * eng * airF * att);
  sndSet(G, L.roarMod.gain, alive * 0.35 * eng * airF * att);
  sndSet(G, L.roarF.frequency, (380 + 380 * eng) * (0.6 + 0.4 * hf));
  sndSet(G, L.hiss.gain, alive * 0.07 * eng * airF * att * hf);
  sndSet(G, L.crack.gain, alive * 0.55 * sl * (0.25 + 0.75 * airF) * lerp(1, att, airF));
  sndSet(G, L.crackF.frequency, lerp(380, 1500, airF * hf));
  sndSet(G, L.ion.gain, alive * 0.025 * clamp(P.ion || 0, 0, 1));
  const jt = loud(P.jet || 0);
  sndSet(G, L.jet.gain, alive * 0.06 * jt * (0.35 + 0.65 * airF) * att);
  sndSet(G, L.jetO.frequency, 240 + 900 * (P.spool || 0));
  sndSet(G, L.jetW.frequency, 700 + 2600 * (P.spool || 0));
  sndSet(G, L.jetN.gain, alive * 0.3 * jt * airF * att);
  const q = clamp(Math.sqrt(Math.max(0, P.dynP || 0)) / 170, 0, 1);
  sndSet(G, L.wind.gain, alive * (0.5 * q + (P.landedAir ? 0.05 : 0)) * airF);
  sndSet(G, L.windMod.gain, alive * 0.25 * q * airF);
  sndSet(G, L.windF.frequency, clamp(260 + (P.speed || 0) * 1.1, 260, 3800));
  const pl = clamp(((P.heat || 0) - 3e5) / 3e6, 0, 1);
  sndSet(G, L.plasma.gain, alive * 0.6 * pl);
  sndSet(G, L.plasmaF.frequency, 320 + 900 * pl);
  sndSet(G, L.plasmaC.gain, alive * 0.32 * pl);
  sndSet(G, L.rcs.gain, alive * 0.22 * clamp(P.rcs || 0, 0, 1) * (0.55 + 0.45 * airF));
  sndSet(G, L.rcsLP.frequency, lerp(1400, 9000, airF));
  sndSet(G, L.cabin.gain, P.alive && P.crewed && air < 0.01 ? 0.035 : 0, 0.5);
  sndSet(G, G.world.gain, P.map ? 0.45 : 1, 0.2);
}
function sndBeds(G, mode) {
  const L = G.L;
  sndSet(G, L.hall.gain, mode === 'vab' ? 0.09 : 0, 0.4);
  sndSet(G, L.breeze.gain, mode === 'ksc' ? 0.06 : 0, 0.6);
  sndSet(G, L.breezeMod.gain, mode === 'ksc' ? 0.04 : 0, 0.6);
  sndSet(G, L.drone.gain, mode === 'menu' ? 0.05 : mode === 'track' ? 0.03 : 0, 0.8);
  if (mode !== 'flight') sndApplyFlight(G, { alive: false, p: 0, dist: 0 });
}

// ---- lifecycle ----
function sndStart() {
  if (SND.started) { if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    SND.ctx = new AC();
    SND.G = sndBuildGraph(SND.ctx, SND.ctx.destination);
    SND.G.master.gain.value = SND.vol;
    SND.started = true;
  } catch (e) { console.warn('audio', e); SND.ctx = null; SND.G = null; }
}
function initAudio() {
  sndSettingsLoad();
  const kick = () => sndStart();
  window.addEventListener('pointerdown', kick, true);
  window.addEventListener('keydown', kick, true);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button, .card, .vitem, .pcard, .tnode, .mbtn')) sndUi('click'); }, true);
}
// once per frame from the main loop
function sndFrame(screen) {
  if (!SND.G) return;
  if (SND.mode !== screen) { SND.mode = screen; sndBeds(SND.G, screen); }
}

// flight state -> parameters (called from flightFrame)
function sndFlight(W) {
  if (!SND.G) return;
  const A = W.active;
  const P = { alive: !!(A && !A.destroyed) && W.warp === 0, p: 0, dist: W.cam.dist, map: W.map };
  if (P.alive) {
    let lfo = 0, srb = 0, ion = 0, jet = 0, spool = 0;
    for (const p of A.parts) {
      const e = p.st.eng;
      if (p.dead || !e || !e.on) continue;
      const d = PART[p.id].engine;
      if (d.air) { spool = Math.max(spool, e.spool || 0); jet += d.thrust * (e.thr || 0); continue; }
      if (e.out || !(e.thr > 0.01)) continue;
      if (d.prop === 'SOLID') srb += d.thrust * e.thr; else if (d.prop === 'XENON') ion += e.thr; else lfo += d.thrust * e.thr;
    }
    const b = A.body, alt = V.len(A.r) - b.R;
    const air = V.sub(A.v, V.cross(bodyOmega(b), A.r));
    const c = W.ctl || {};
    const rcsOn = A.rcs && vesselRes(A, 'MONO') > 0 && A.parts.some(p => !p.dead && PART[p.id].rcs);
    const rot = A.ctlOut ? Math.abs(A.ctlOut[0]) + Math.abs(A.ctlOut[1]) + Math.abs(A.ctlOut[2]) : 0;
    const kp = isKerbalVessel(A) ? kerbalPart(A) : null;
    if (kp) {
      // footsteps on every half stride; the jetpack hisses like RCS
      const ph = Math.floor((kp._ph || 0) / Math.PI);
      if (kp.st.walk > 0.2 && ph !== kp._stepN) { kp._stepN = ph; sndAt('step', null, { vessel: A, level: 0.6 }); }
    }
    Object.assign(P, {
      lfo, srb, ion, jet, spool, p: atmAt(b, alt).p, speed: V.len(air), dynP: A.dynP || 0, heat: A.heatFlux || 0,
      rcs: kp ? clamp((kp.st.jet || 0) / EVA.jetAcc, 0, 1) * 0.7 : rcsOn ? clamp(Math.abs(c.tx || 0) + Math.abs(c.ty || 0) + Math.abs(c.tz || 0) + rot * 0.5, 0, 1) : 0,
      crewed: isCrewed(A), landedAir: (A.landed || A.prelaunch) && !!b.atm,
    });
  }
  sndApplyFlight(SND.G, P);
}

// ---- one-shots ----
// level: 0..1 before distance attenuation; dist in metres (0 = at the camera / on our hull)
function sndShot(kind, opt) {
  const G = SND.G; if (!G || SND.ctx.state !== 'running') return;
  opt = opt || {};
  const ctx = G.ctx, t = ctx.currentTime, B = G.bufs;
  const vacuum = opt.vacuum && !opt.onHull;
  if (vacuum) return;                                            // nothing carries sound to us
  const dist = opt.dist || 0;
  const att = 1 / (1 + Math.max(0, dist - 15) / 120);
  const muffle = opt.onHull && opt.vacuum ? 0.25 : 1;            // through the structure: dull
  const out = ctx.createGain(); out.gain.value = 1; out.connect(opt.ui ? G.master : G.world);
  const end = (node, dur) => setTimeout(() => { try { node.disconnect(); } catch (e) { /* ignore */ } }, (dur + 0.3) * 1000);
  const noise = (buf, type, f0, f1, q, peak, attack, decay) => {
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0 * muffle + 40, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1 * muffle), t + attack + decay);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5, attack + decay + 0.05);
  };
  const tone = (type, f0, f1, peak, attack, decay, delay) => {
    const t0 = t + (delay || 0);
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + attack + decay);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + attack + decay + 0.05);
  };
  const k = (opt.level == null ? 1 : opt.level) * att;
  switch (kind) {
    case 'explosion': {
      const s = clamp(opt.size || 1, 0.3, 3);
      noise(B.white, 'lowpass', 4000, 90, 0.7, 0.9 * k, 0.008, 1.2 + s * 0.8);
      noise(B.crackle, 'bandpass', 1400, 300, 0.6, 0.5 * k, 0.01, 0.9 + s * 0.5);
      tone('sine', 70, 28, 0.9 * k, 0.01, 0.7 + s * 0.3);
      end(out, 3.5); break;
    }
    case 'dock':
      noise(B.white, 'bandpass', 1400, 500, 1.1, 0.5 * k, 0.003, 0.25);
      tone('sine', 140, 60, 0.55 * k, 0.004, 0.35);
      tone('square', 420, 410, 0.025 * k, 0.01, 0.12, 0.35);
      end(out, 0.9); break;
    case 'decouple':
      noise(B.white, 'bandpass', 1800, 400, 0.9, 0.55 * k, 0.003, 0.18);
      tone('sine', 110, 45, 0.6 * k, 0.004, 0.25);
      end(out, 0.6); break;
    case 'ignite':
      noise(B.brown, 'lowpass', 900, 120, 0.7, 0.8 * k, 0.05, 1.4);
      tone('sine', 60, 35, 0.5 * k, 0.03, 0.9);
      end(out, 1.8); break;
    case 'chute':
      noise(B.pink, 'bandpass', 250, 1600, 1.2, 0.35 * k, 0.25, 0.5);
      if (opt.full) noise(B.white, 'bandpass', 900, 500, 0.8, 0.45 * k, 0.005, 0.12);
      end(out, 1); break;
    case 'legs':
      tone('sawtooth', 170, 250, 0.05 * k, 0.05, 0.75);
      noise(B.white, 'bandpass', 900, 700, 2, 0.05 * k, 0.05, 0.7);
      end(out, 1.1); break;
    case 'touch':
      tone('sine', 80, 40, clamp(0.25 + (opt.speed || 0) * 0.08, 0.2, 0.9) * k, 0.005, 0.35);
      noise(B.crackle, 'lowpass', 1200, 200, 0.7, 0.35 * k, 0.005, 0.3);
      end(out, 0.7); break;
    case 'step':
      noise(B.crackle, 'lowpass', 1100, 300, 0.7, 0.16 * k, 0.004, 0.12);
      end(out, 0.3); break;
    case 'splash':
      noise(B.white, 'lowpass', 2500, 300, 0.6, 0.6 * k, 0.02, 1.4);
      end(out, 1.8); break;
    case 'click':
      tone('sine', 1500, 1100, 0.035 * k, 0.002, 0.03); end(out, 0.1); break;
    case 'beep':
      tone('sine', opt.f || 880, opt.f || 880, 0.06 * k, 0.005, 0.09); end(out, 0.2); break;
    case 'chime':
      tone('sine', 784, 784, 0.07 * k, 0.01, 0.35); tone('sine', 1175, 1175, 0.06 * k, 0.01, 0.5, 0.12); end(out, 0.9); break;
    case 'bad':
      tone('square', 196, 180, 0.03 * k, 0.005, 0.16); end(out, 0.3); break;
    case 'attach':
      noise(B.white, 'bandpass', 2200, 900, 1.2, 0.12 * k, 0.002, 0.07); tone('sine', 300, 180, 0.12 * k, 0.003, 0.09); end(out, 0.3); break;
    case 'pick':
      tone('sine', 520, 700, 0.05 * k, 0.003, 0.06); end(out, 0.2); break;
    case 'trash':
      noise(B.pink, 'bandpass', 1600, 300, 1, 0.12 * k, 0.02, 0.25); end(out, 0.4); break;
  }
}
function sndUi(kind) { if (SND.ui) sndShot(kind, { ui: true }); }

// helper for world events: distance from the camera and whether sound can reach it
function sndAt(kind, abs, opt) {
  if (!SND.G) return;
  const W = Game.world, A = W && W.active;
  const o = Object.assign({}, opt || {});
  o.dist = abs ? V.dist(abs, RV.camAbs) : 0;
  if (A) {
    const p = atmAt(A.body, V.len(A.r) - A.body.R).p;
    o.vacuum = p < 0.002;
    if (o.vessel === A) o.onHull = true;
  }
  sndShot(kind, o);
}
