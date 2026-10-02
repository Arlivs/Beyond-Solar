'use strict';
// Flight recorder and replays: every flight is recorded in the background (20 Hz of game time); a replay plays
// it back with the same vessel models, plumes, smoke and re-entry fire, through cinematic cameras, and can be
// exported as a video straight from the canvas.

const REC = { data: null, max: 40000 };

// part snapshot: geometry + the states that change the look
function recParts(v) {
  return v.parts.map(p => ({ id: p.id, pos: p.pos, dir: p.dir, ang: p.ang, q: p.q, portDir: p.portDir, k: p.k, uid: p.uid, crew: p.crew }));
}
function recSig(v) { return v.parts.map(p => (p.dead ? 'x' : 'o') + (p.st.chute ? p.st.chute[0] : '') + (p.st.legs ? 'L' : '') + (p.st.gear === false ? 'g' : '')).join(''); }
function recState(v) { return v.parts.map(p => [p.dead ? 1 : 0, p.st.chute || null, p.st.legs ? 1 : 0, p.st.gear === false ? 0 : 1, p.st.chuteT || 0]); }

function recStart(W, name) {
  REC.data = { name, t0: Game.g.ut, frames: [], vessels: {}, lastT: -1e18, launchUT: W.active && W.active.launchUT };
}
function recFrame(W, t) {
  const D = REC.data; if (!D || !W || D.frames.length >= REC.max) return;
  if (D.launchUT == null && W.active && W.active.launchUT != null) D.launchUT = W.active.launchUT;   // set on the first stage
  const step = W.warp > 0 ? Math.max(0.05, Game.warpRate() * 0.05) : 0.05;
  if (t - D.lastT < step) return;
  D.lastT = t;
  const vs = [];
  for (const v of W.vessels) {
    if (!v.loaded || (v.destroyed && v.parts.every(p => p.dead))) continue;
    let rv = D.vessels[v.id];
    if (!rv || rv.n !== v.parts.length) {
      // first sight, or parts were added (docking): a new generation of this vessel
      rv = D.vessels[v.id] = { name: v.name, n: v.parts.length, gens: (rv ? rv.gens : []).concat([recParts(v)]), sig: '' };
    }
    const eng = [];
    for (const p of v.parts) if (p.st.eng) eng.push(p.st.eng.on && !p.st.eng.out && !p.dead ? +(p.st.eng.thr || 0).toFixed(3) : 0);
    const f = { id: v.id, g: rv.gens.length - 1, b: v.body.id, r: v.r.slice(), q: v.q.slice(), e: eng, h: Math.round(v.heatFlux || 0), c: !!v.inContact };
    const sig = recSig(v);
    if (sig !== rv.sig) { rv.sig = sig; f.s = recState(v); }
    vs.push(f);
  }
  D.frames.push({ t, a: W.active ? W.active.id : null, vs });
}

// ---------------------------------------------------------------- playback
const RPL = { on: false, t: 0, speed: 1, playing: true, cam: 'auto', views: new Map(), stCache: new Map(), focus: null, orbit: { yaw: 0.6, pitch: 0.15, dist: 30 }, shot: null, recorder: null };

function rplIndex(D, t) {   // last frame with frame.t <= t
  let lo = 0, hi = D.frames.length - 1;
  if (t <= D.frames[0].t) return 0;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D.frames[m].t <= t) lo = m; else hi = m; }
  return lo;
}
// the vessel `id` at time t: interpolated pose, the latest known part states, a finite-difference velocity
function rplVessel(D, i, id) {
  const F0 = D.frames[i], F1 = D.frames[Math.min(i + 1, D.frames.length - 1)];
  const a = F0.vs.find(x => x.id === id); if (!a) return null;
  const b = F1.vs.find(x => x.id === id && x.b === a.b) || a;
  const span = F1.t - F0.t, k = span > 0 ? clamp((RPL.t - F0.t) / span, 0, 1) : 0;
  let q1 = b.q; if (a.q[0] * q1[0] + a.q[1] * q1[1] + a.q[2] * q1[2] + a.q[3] * q1[3] < 0) q1 = q1.map(c => -c);
  // latest discrete state at or before frame i (cached: playback mostly moves forward)
  const ck = id + '#' + a.g, c = RPL.stCache.get(ck);
  let st = null, stop = 0;
  if (c && c.i <= i) { st = c.st; stop = c.i + 1; }
  for (let j = i; j >= stop; j--) { const x = D.frames[j].vs.find(y => y.id === id); if (x && x.s && x.g === a.g) { st = x.s; break; } }
  RPL.stCache.set(ck, { i, st });
  return { a, r: V.lerp(a.r, b.r, k), q: Q.norm(a.q.map((c, n) => c + (q1[n] - c) * k)), vel: span > 0 ? V.scale(V.sub(b.r, a.r), 1 / span) : [0, 0, 0], st };
}
// a stand-in vessel object that VesselView and the effects code can read
function rplFake(D, id, gen) {
  const rv = D.vessels[id];
  const parts = rv.gens[gen].map((p, i) => Object.assign({}, p, { rid: i, st: {}, res: {}, data: [], dead: false }));
  for (const p of parts) { const d = PART[p.id]; if (d.engine) p.st.eng = { on: false, thr: 0 }; if (d.chute) p.st.chute = 'stowed'; if (d.legs) p.st.legs = false; }
  return { id, name: rv.name, parts, edges: [], body: BODY.earth, r: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], launchUT: D.launchUT, massDirty: true };
}

Game.openReplay = function () {
  const D = REC.data;
  if (!D || D.frames.length < 4) { ui.toast('Записи полёта пока нет', 'bad'); return; }
  RPL.prevScreen = Game.screen;
  if (Game.world) for (const vw of Game.world.views.values()) vw.group.visible = false;
  RPL.on = true; RPL.t = D.frames[0].t; RPL.speed = 1; RPL.playing = true; RPL.cam = 'auto'; RPL.shot = null; RPL.focus = null;
  Game.screen = 'replay';
  mapSetVisible(false);
  ui.replay();
};
Game.closeReplay = function () {
  Game.stopVideo();
  for (const e of RPL.views.values()) { RV.scene.remove(e.vw.group); e.vw.dispose(); }
  RPL.views.clear(); RPL.stCache.clear(); RPL.on = false; FX.list.length = 0;
  if (RPL.prevScreen === 'flight' && Game.world) { Game.screen = 'flight'; ui.flight(); }
  else Game.toKSC();
};

// camera placement for the current shot; returns {camAbs, look, up, fov}
function rplCamera(D, focus, bAbs, dt) {
  const b = focus.body, pos = V.add(bAbs, focus.r), up = V.norm(focus.r);
  const size = Math.max(4, focus._size || 10);
  let mode = RPL.cam;
  if (mode === 'auto') {
    // director: tower shots for the ascent near the ground, then alternate fly-bys and chase shots
    const alt = V.len(focus.r) - b.R, sinceLaunch = D.launchUT != null ? RPL.t - D.launchUT : 1e9;
    const want = alt < 4000 && sinceLaunch < 60 && b.id === 'earth' ? 'tower' : (Math.floor(RPL.t / 9) % 2 ? 'flyby' : 'chase');
    if (!RPL.shot || RPL.shot.mode !== want) RPL.shot = { mode: want, since: RPL.t };
    mode = want;
  }
  let north = V.reject([0, 0, 1], up); if (V.len(north) < 1e-6) north = V.reject([1, 0, 0], up); north = V.norm(north);
  const east = V.cross(north, up);
  if (mode === 'tower') {
    // a long lens 600 m from the pad, low on the ground; zoom follows the distance
    if (!RPL.tower || RPL.tower.vid !== focus.id) {
      const k = kscFrame(), eye = V.add(V.add(k.pf, V.scale(k.upF, 8)), V.add(V.scale(k.eastF, -420), V.scale(k.southF, 430)));
      RPL.tower = { vid: focus.id, eyeF: eye };
    }
    const eye = V.add(bodyAbsPos(BODY.earth, RPL.t), bodyFixedToInertial(BODY.earth, RPL.t, RPL.tower.eyeF));
    const d = V.dist(eye, pos);
    return { camAbs: eye, look: V.sub(pos, eye), up: V.norm(V.sub(eye, bodyAbsPos(BODY.earth, RPL.t))), fov: clamp(2 * Math.atan(size * 2.2 / d) / DEG, 3, 55) };
  }
  if (mode === 'flyby') {
    // a point ahead on the path; re-placed when the vessel has gone by
    const vel = focus.vel, sp = V.len(vel);
    const far = !RPL.fly || RPL.fly.vid !== focus.id || V.dist(V.add(bAbs, RPL.fly.rel), pos) > size * 6 + 120 + sp * 1.2;
    if (far) {
      const dir = sp > 1 ? V.scale(vel, 1 / sp) : V.norm(V.cross(up, [0, 0, 1]));
      const side = V.norm(V.cross(dir, up));
      const ahead = Math.min(sp * 3, size * 4 + 80);
      RPL.fly = { vid: focus.id, rel: V.add(V.add(focus.r, V.scale(dir, ahead)), V.add(V.scale(side, size * 1.6 + 12), V.scale(up, size * 0.4 + 3))) };
    }
    const eye = V.add(bAbs, RPL.fly.rel), d = V.dist(eye, pos);
    return { camAbs: eye, look: V.sub(pos, eye), up, fov: clamp(2 * Math.atan(size * 1.4 / d) / DEG, 8, 60) };
  }
  // chase / orbit: like the flight camera; the orbit mode drifts slowly around the vessel
  const c = RPL.orbit;
  if (mode === 'orbit' || RPL.cam === 'auto') c.yaw += dt * 0.12;
  const dist = Math.max(c.dist, size * 1.8 + 6);
  const hz = V.add(V.scale(north, -Math.cos(c.yaw)), V.scale(east, Math.sin(c.yaw)));
  const off = V.scale(V.add(V.scale(hz, Math.cos(c.pitch)), V.scale(up, Math.sin(c.pitch))), dist);
  return { camAbs: V.add(pos, off), look: V.neg(off), up, fov: RV.fov || 55 };
}

function replayFrame(dt) {
  const D = REC.data; if (!D) return;
  if (RPL.playing) RPL.t = Math.min(D.frames[D.frames.length - 1].t, RPL.t + dt * RPL.speed);
  if (RPL.playing && RPL.t >= D.frames[D.frames.length - 1].t) { RPL.playing = false; if (RPL.recorder) Game.stopVideo(); }
  const i = rplIndex(D, RPL.t), F = D.frames[i];
  const fid = F.a && F.vs.some(x => x.id === F.a) ? F.a : F.vs[0] && F.vs[0].id;
  // stand-ins for every vessel in this frame
  const live = new Set();
  let focus = null;
  for (const fv of F.vs) {
    const key = fv.id + '#' + fv.g;
    let e = RPL.views.get(key);
    if (!e) { const fake = rplFake(D, fv.id, fv.g); const vw = new VesselView(fake); RV.scene.add(vw.group); e = { vw, fake }; RPL.views.set(key, e); }
    live.add(key);
    const s = rplVessel(D, i, fv.id), v = e.fake;
    v.body = BODY[fv.b]; v.r = s.r; v.q = s.q; v.v = s.vel; v.heatFlux = s.a.h; v.inContact = s.a.c;
    if (s.st) v.parts.forEach((p, n) => { const x = s.st[n]; if (!x) return; p.dead = !!x[0]; if (p.st.chute !== undefined) { p.st.chute = x[1] || 'stowed'; p.st.chuteT = x[4]; } if (p.st.legs !== undefined) p.st.legs = !!x[2]; p.st.gear = x[3] ? true : false; });
    let k = 0; for (const p of v.parts) if (p.st.eng) { const th = s.a.e[k++] || 0; p.st.eng.on = th > 0; p.st.eng.thr = th; p.st.eng.out = false; }
    v.massDirty = true; v._mp = null;
    if (fv.id === fid) { focus = v; v._size = e.vw.bounds.size; v.vel = s.vel; }
  }
  for (const [key, e] of RPL.views) if (!live.has(key)) e.vw.group.visible = false;
  if (!focus) return;
  const t = RPL.t, bAbs = bodyAbsPos(focus.body, t);
  const cam = rplCamera(D, focus, bAbs, dt);
  RV.camAbs = cam.camAbs;
  const b = focus.body, camRel = V.sub(cam.camAbs, bAbs), L = lightAt(b, camRel, t), vl = lightAt(b, focus.r, t);
  const comAbs = V.add(bAbs, focus.r);
  renderWorld(t, cam.camAbs, lookQuat(cam.look, cam.up), { focusBody: b, focusRel: camRel, skyLight: L.skyLight, sunFactor: vl.sun, near: 0.1, fov: cam.fov,
    shadow: { pos: relT(comAbs), size: (focus._size || 10) * 0.75 + 4 } });
  const fxDt = RPL.playing ? dt * RPL.speed : 0;
  for (const key of live) {
    const e = RPL.views.get(key), v = e.fake;
    e.vw.group.visible = !v.parts.every(p => p.dead);
    const alt = V.len(v.r) - v.body.R, atm = atmAt(v.body, alt);
    const air = Q.invRot(v.q, V.sub(v.v, V.cross(bodyOmega(v.body), v.r)));
    e.vw.update(t, air, atm.p, fxDt);
    const hf = v.heatFlux || 0, gl = clamp((hf - 2.5e5) / 2.5e6, 0, 1);
    e.vw.glow.visible = gl > 0.01 && V.len(air) > 50;
    if (e.vw.glow.visible) {
      const fwd = V.norm(air), lead = V.add(massProps(v).com, V.scale(fwd, e.vw.bounds.size * 0.45));
      e.vw.glow.position.set(lead[0], lead[1], lead[2]);
      e.vw.glow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(fwd[0], fwd[1], fwd[2]));
      const u = e.vw.glow.material.uniforms;
      u.uR0.value = e.vw.bounds.maxR * 1.08 + 0.15; u.uExp.value = 0.45; u.uLen.value = e.vw.bounds.size * (0.9 + gl * 2.2) + 2;
      u.uI.value = 0.06 + gl * 0.5; u.uThr.value = 1; u.uP.value = 0; u.uT.value = t;
    }
    if (fxDt > 0 && fxDt < 1) spawnVesselFX(v, t, fxDt, atm, air, hf);
  }
  updateSites(t, b);
  const l = lightAt(b, focus.r, t), kL = 0.08 + 0.92 * l.sun * smooth(-0.1, 0.15, l.elev) + l.skyLight * 0.2;
  fxUpdate(fxDt > 0 && fxDt < 1 ? fxDt : 0, [kL, kL * 0.97, kL * 0.93]);
  drawFrame();
  ui.replayHud(D, focus);
}

// ---------------------------------------------------------------- video export
Game.startVideo = function () {
  const cv = RV.renderer.domElement;
  if (!cv.captureStream || typeof MediaRecorder === 'undefined') { ui.toast('Этот браузер не умеет записывать видео с холста', 'bad'); return; }
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(x => MediaRecorder.isTypeSupported(x));
  if (!mime) { ui.toast('Нет подходящего видеокодека', 'bad'); return; }
  const rec = new MediaRecorder(cv.captureStream(60), { mimeType: mime, videoBitsPerSecond: 14e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orbita_${(REC.data.name || 'flight').replace(/\s+/g, '_')}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast(`Видео сохранено: ${(blob.size / 1e6).toFixed(1)} МБ`, 'good', 4000);
  };
  rec.start(250);
  RPL.recorder = rec; RPL.playing = true;
  document.body.classList.add('recording');
  // an HTML badge over the canvas: not in the captured frames, click (or Esc) to stop
  const ind = document.createElement('div'); ind.id = 'rec-ind'; ind.textContent = '● ЗАПИСЬ — щелчок или Esc, чтобы остановить';
  ind.onclick = () => { Game.stopVideo(); ui.replayHud(null, null, true); };
  document.body.appendChild(ind);
};
Game.stopVideo = function () {
  if (!RPL.recorder) return;
  const r = RPL.recorder; RPL.recorder = null;
  document.body.classList.remove('recording');
  const ind = document.getElementById('rec-ind'); if (ind) ind.remove();
  if (r.state !== 'inactive') r.stop();
};
