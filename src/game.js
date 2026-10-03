'use strict';
// Main loop, scenes, flight world (vessels, warp, camera), input, career glue.

const Game = {
  g: null, screen: 'menu', world: null, keys: {}, precise: false, nodeStep: 1, last: 0,
  warpLevels: [1, 5, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000],
  physLevels: [1, 2, 3, 4],
  mouse: { down: false, x: 0, y: 0, moved: 0, btn: 0 },
};

// ================================================================ boot
function boot() {
  const canvas = document.getElementById('c');
  try { initRenderer(canvas); } catch (e) { document.body.innerHTML = '<p style="color:#fff;padding:40px">WebGL недоступен: ' + e.message + '</p>'; return; }
  initMaterials(); initFX(); initNavball(); initMap(document.getElementById('maplayer')); initVAB(); initAudio();
  ui.init();
  setupInput(canvas);
  window.addEventListener('beforeunload', (e) => { if (Game.screen === 'flight') { e.preventDefault(); e.returnValue = ''; } });
  Game.toMenu();
  Game.last = performance.now();
  requestAnimationFrame(loop);
  // a craft link (#craft=...) opens the rocket in a sandbox
  if (/craft=ORB1/.test(location.hash)) craftDecode(location.hash).then(d => {
    history.replaceState(null, '', location.href.split('#')[0]);
    ui.modal('Ракета по ссылке', `<p>«${esc(d.name)}» · ${layoutDesign(d).length} деталей · ${fmtMoney(designCost(d))}</p>`, [
      { label: 'Открыть в песочнице', cls: 'acc', onClick: () => { Game.newGame('sandbox'); Game.openVAB(d); } }, { label: 'Отмена' }]);
  }).catch(e => ui.toast('Ссылка на ракету повреждена: ' + esc(e.message), 'bad'));
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, Math.max(0, (now - Game.last) / 1000));
  Game.last = now;
  try {
    adaptResolution(dt);
    sndFrame(Game.screen);
    setOrigin(sceneSystem());
    switch (Game.screen) {
      case 'menu': renderMenuBg(now); break;
      case 'ksc': case 'rnd': case 'mc': renderKscBg(); break;
      case 'vab': vabRender(); break;
      case 'flight': flightFrame(dt); break;
      case 'track': trackFrame(dt); break;
      case 'replay': replayFrame(dt); break;
    }
  } catch (e) {
    console.error(e);
    Game.lastError = e.message + ' @ ' + String(e.stack || '').split('\n')[1];   // read by the test harness
    if (!Game._errShown) { Game._errShown = true; ui.toast('Ошибка: ' + esc(e.message), 'bad', 8000); setTimeout(() => { Game._errShown = false; }, 8000); }
  }
}

function lookQuat(lookDir, upDir) {
  const m = new THREE.Matrix4();
  const up = toT(upDir).normalize(), dir = toT(lookDir).normalize();
  if (Math.abs(up.dot(dir)) > 0.9995) up.set(0, 0, 1).cross(dir).normalize();
  m.lookAt(new THREE.Vector3(0, 0, 0), dir, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function renderMenuBg(now) {
  const t = 86400 * 3 + now / 1000 * 40;
  const E = BODY.earth;
  const eAbs = bodyAbsPos(E, t);
  const sunDir = V.norm(V.neg(eAbs));
  const side = V.norm(V.cross(sunDir, [0, 0, 1]));
  const dir = V.norm(V.add(V.add(V.scale(sunDir, 0.55), V.scale(side, -0.8)), [0, 0, 0.25]));
  const camAbs = V.add(eAbs, V.scale(dir, E.R * 2.6));
  const look = V.add(V.sub(eAbs, camAbs), V.scale(side, -E.R * 0.9));
  renderWorld(t, camAbs, lookQuat(look, [0, 0, 1]), { near: 100 });
  hideFlightObjects();
  drawFrame();
}

function kscFrame() {
  const b = BODY.earth;
  const pf = surfacePoint(b, KSC.lat, KSC.lon, 0);
  const upF = V.norm(pf), eastF = V.norm(V.cross([0, 0, 1], upF)), southF = V.neg(V.cross(upF, eastF));
  return { pf, upF, eastF, southF };
}
function renderKscBg() {
  const t = Game.g.ut;
  const b = BODY.earth, k = kscFrame();
  const eyeF = V.add(V.add(V.add(k.pf, V.scale(k.upF, 30)), V.scale(k.eastF, 150)), V.scale(k.southF, 210));
  const tgtF = V.add(V.add(k.pf, V.scale(k.upF, 20)), V.scale(k.eastF, -60));
  const eAbs = bodyAbsPos(b, t);
  const eye = V.add(eAbs, bodyFixedToInertial(b, t, eyeF));
  const tgt = V.add(eAbs, bodyFixedToInertial(b, t, tgtF));
  const up = bodyFixedToInertial(b, t, k.upF);
  const sunDir = V.norm(V.neg(eAbs));
  const skyL = smooth(-0.15, 0.25, V.dot(up, sunDir));
  renderWorld(t, eye, lookQuat(V.sub(tgt, eye), up), { focusBody: b, focusRel: V.sub(eye, eAbs), skyLight: skyL, near: 0.5 });
  hideFlightObjects();
  drawFrame();
}
function hideFlightObjects() {
  if (Game.world) for (const vw of Game.world.views.values()) vw.group.visible = false;
  for (const l of MAP.patchLines) l.visible = false;
  for (const id in MAP.bodyLines) MAP.bodyLines[id].visible = false;
  for (const m of (RV.siteMeshes || new Map()).values()) m.visible = false;
  FX.list.length = 0; fxUpdate(0);
}

// ================================================================ scenes
Game.toMenu = function () {
  Game.leaveWorld();
  Game.screen = 'menu';
  ui.menu();
};
Game.newGame = function (mode, opts) {
  setSciFi(opts && opts.scifi);
  Game.g = newGame(mode, null, opts);
  Game.g._notify = (m) => ui.toast(m, 'acc', 5000);
  Game.autosave();
  Game.toKSC();
  ui.toast(opts && opts.race ? `${fmtDay(Game.g.ut)}. Космическая гонка началась: ${RIVAL} идёт по настоящей хронологии. Ракеты собираются не мгновенно — следите за календарём.` :
    mode === 'career' ? 'Карьера начата. Загляните в ЦУП за контрактами и в цех — соберите первую ракету.' : 'Песочница: все детали открыты.', 'good', 7000);
};
Game.raceNews = function () {
  for (const it of raceTick(Game.g)) ui.toast(`Новости: ${RIVAL} — ${it.title.toLowerCase()} (${fmtDay(it.ut)})`, 'bad', 7000);
};
// jump the calendar forward (waiting for a build): every vessel moves on rails, scanners map, contracts expire
Game.skipTo = function (t1) {
  const g = Game.g; if (!(t1 > g.ut)) return;
  const a = nextAlarm(null, g.ut); if (a && a.t < t1) { t1 = a.t; fireAlarm(a, false); }
  const vs = g.vessels.map(s => { try { return deserializeVessel(s); } catch (e) { return null; } }).filter(Boolean);
  for (const v of vs) {
    enterRails(v, g.ut);
    let tt = g.ut;
    for (let k = 0; k < 40 && tt < t1; k++) { const r = railsAdvance(v, tt, t1); if (r.event === 'impact') { v.destroyed = true; break; } if (!r.event) break; tt = r.t; }
  }
  scanAll(vs, g.ut, t1);
  if (SCIFI.on) for (const v of vs) if (!v.destroyed) produceExotic(v, t1 - g.ut);
  for (const v of vs) if (v.destroyed) loseCrew(v.parts);
  g.vessels = vs.filter(v => !v.destroyed).map(serializeVessel);
  g.ut = t1;
  for (const c of [...((isCareer(g) && g.contracts.active) || [])]) if (g.ut > c.deadline) { cancelContract(g, c.id); ui.toast('Контракт провален (срок): ' + esc(c.title), 'bad', 5000); }
  Game.raceNews();
  Game.autosave();
};

Game.toKSC = function () {
  Game.leaveWorld();
  mapSetVisible(false);
  VAB.active = false;
  Game.screen = 'ksc';
  ui.ksc();
};
Game.openScreen = function (s) { Game.screen = s; ui[s](); };
Game.openVAB = function (design) {
  Game.screen = 'vab';
  vabOpen(design ? JSON.parse(JSON.stringify(design)) : (Game.g.lastCraft ? JSON.parse(JSON.stringify(Game.g.lastCraft)) : null));
  ui.vab();
};
Game.saveCraft = function (d) {
  const c = JSON.parse(JSON.stringify(d));
  Game.g.crafts[c.name] = c;
  Game.autosave();
};
Game.leaveWorld = function () {
  const W = Game.world;
  if (!W) return;
  for (const vw of W.views.values()) { RV.scene.remove(vw.group); vw.dispose(); }
  W.views.clear();
  Game.world = null;
  FX.list.length = 0;
  ui.closeModal();
};

// ================================================================ world
function makeWorld() {
  const W = {
    vessels: [], active: null, views: new Map(), warp: 0, physWarp: 0, acc: 0, map: false,
    cam: { yaw: -0.5, pitch: 0.12, dist: 30 }, traj: null, trajT: -1, launch: null, selNode: -1, target: null,
    progT: 0, loadT: 0, trackSel: null, warpTo: null, dvT: -1, dvCache: null,
  };
  for (const s of Game.g.vessels) {
    try { const v = deserializeVessel(s); W.vessels.push(v); } catch (e) { console.warn('bad vessel', e); }
  }
  for (const v of W.vessels) { v.loaded = false; enterRails(v, Game.g.ut); }
  return W;
}

function vesselHooks(v) {
  return { event: (type, d) => Game.onEvent(v, type, d) };
}

Game.onEvent = function (v, type, d) {
  const W = Game.world; if (!W) return;
  const A = W.active, g = Game.g, t = g.ut;
  switch (type) {
    case 'split': {
      const c = d.child;
      c.loaded = true; c.rails = null;
      W.vessels.push(c);
      if (!c.debris) ui.toast('Отделён аппарат: ' + esc(c.name), '', 2500);
      break;
    }
    case 'explode': {
      const p = d.part;
      const mp = massProps(v);
      const abs = V.add(V.add(bodyAbsPos(v.body, t), v.r), Q.rot(v.q, V.sub(p.pos, mp.com)));
      fxExplosion(abs, V.add(bodyAbsState(v.body, t).v, v.v), clamp(PART[p.id].mass * 1.5 + 0.6, 0.6, 3));
      sndAt('explosion', abs, { size: clamp(PART[p.id].mass * 1.5 + 0.6, 0.6, 3), vessel: v });
      if (v === A) ui.toast(`Разрушено: ${esc(PART[p.id].name)} (${esc(d.why)})`, 'bad');
      loseCrew([p]);
      break;
    }
    case 'destroyed':
      loseCrew(v.parts);
      if (v === A) { W.lostActive = true; setTimeout(() => ui.destroyed(d.why), 900); }
      break;
    case 'launch':
      v.launchUT = t;
      g.stats.launches++;
      { const m = milestone(g, 'launch'); if (m) ui.toast(`Достижение: ${m.title}`, 'acc'); }
      break;
    case 'flameout': if (v === A && PART[d.part.id].engine.prop !== 'SOLID') ui.toast('Двигатель остановлен: нет топлива', '', 2000); break;
    case 'chute': if (v === A) { ui.toast(d.state === 'semi' ? 'Парашют раскрыт частично' : 'Парашют раскрыт полностью', '', 2000); sndAt('chute', null, { vessel: v, full: d.state === 'full' }); } break;
    case 'touch': if (v === A && performance.now() - (Game._touchT || 0) > 300) { Game._touchT = performance.now(); sndAt(d.water ? 'splash' : 'touch', null, { vessel: v, speed: d.speed }); } break;
    case 'chuteRip': if (v === A) ui.toast('Парашют оторвало: слишком высокая скорость', 'bad'); break;
    case 'landed': if (v === A && !v.prelaunch) ui.toast(`Посадка: ${v.body.name}`, 'good'); break;
  }
};

// crew aboard these parts is lost (career) or sent home (sandbox)
function loseCrew(parts) {
  const g = Game.g;
  for (const p of parts) {
    if (!p.crew || !p.crew.length) continue;
    for (const id of p.crew) { const c = crewById(g, id); if (!c) continue; crewLost(g, id); ui.toast(isCareer(g) ? `Погиб${c.name.endsWith('а') ? 'ла' : ''}: ${esc(c.name)}` : `${esc(c.name)} спасён(а) — песочница`, isCareer(g) ? 'bad' : '', 4000); }
    p.crew = [];
  }
}

Game.launch = function (design, site, fromBuild) {
  const g = Game.g;
  if (g.race && !fromBuild && design && design.stack.length) { ui.buildDlg(design, site); return; }
  if (!design || !design.stack.length) { ui.toast('Ракета пуста', 'bad'); return; }
  if (!designHasCommand(design)) { ui.toast('Нужен командный модуль: капсула или зонд', 'bad'); return; }
  if (isCareer(g) && !designAllowed(g, design)) { ui.toast('В ракете есть неизученные детали', 'bad'); return; }
  const cost = designCost(design);
  const snapshot = JSON.stringify(gameToJSON(g));
  if (!fromBuild && isCareer(g) && g.funds < cost) { ui.modal('Не хватает средств', `Стоимость ракеты ${fmtMoney(cost)}, на счету ${fmtMoney(g.funds)}.`); return; }
  // vessels left on the pad are recovered automatically
  const padLeft = g.vessels.filter(s => s.prelaunch);
  if (padLeft.length) {
    for (const s of padLeft) recoverVessel(g, deserializeVessel(s));
    g.vessels = g.vessels.filter(s => !s.prelaunch);
  }
  if (!fromBuild) spend(g, cost);
  g.lastCraft = JSON.parse(JSON.stringify(design));
  Game.leaveWorld();
  const W = Game.world = makeWorld();
  const v = buildVessel(design, design.name);
  v.craftName = design.name;
  assignCrew(g, v, design);
  site = site || design.site || 'pad';
  // a space base (science fiction): roll out next to an orbital shipyard, or beside it on the ground
  const yard = typeof site === 'string' && site.startsWith('yard:') ? W.vessels.find(x => x.id === site.slice(5) && !x.destroyed) : null;
  if (yard) placeAtYard(v, yard, g.ut);
  else if (site === 'runway') placeOnRunway(v, g.ut); else placeOnPad(v, g.ut);
  // landing gear starts extended, landing legs folded
  if (v.parts.some(p => PART[p.id].gear && PART[p.id].gear.retract)) v.legs = true;
  v.loaded = true;
  W.vessels.push(v);
  W.active = v;
  W.launch = { snapshot, design: JSON.parse(JSON.stringify(design)) };
  W.cam.dist = Math.max(12, vesselBounds(v).size * 1.6 + 6);
  W.cam.pitch = 0.05;
  enterFlight();
  recStart(W, design.name);
  ui.toast(site === 'runway' ? 'На полосе. ПРОБЕЛ — запуск двигателей, Shift — тяга, B — тормоз, A/D — руление, S — взять на себя. F1 — управление.' : 'На старте. ПРОБЕЛ — зажигание, Shift — тяга, T — SAS. F1 — управление.', '', 6000);
  const pods = v.parts.filter(p => p.crew);
  if (pods.length && !crewOf(v).length) ui.toast(hasControl(v) ? 'Капсула без экипажа: свободных космонавтов нет' : 'Капсула без экипажа и без зонда: кораблём нельзя управлять', 'bad', 6000);
};

// a new vessel beside a shipyard: 250 m behind it on the same orbit, or 150 m from it on the ground
function placeAtYard(v, yard, ut) {
  if (yard.lock) {
    const b = yard.body, ll = latLon(b, ut, yard.r);
    placeOnPad(v, ut, { body: b.id, lat: ll.lat, lon: ll.lon + 150 / (b.R * Math.max(Math.cos(ll.lat), 0.05)) });
    v.prelaunchHold = false;
    return;
  }
  v.body = yard.body;
  v.r = V.addS(yard.r, V.norm(yard.v), -250); v.v = yard.v.slice();
  v.q = Q.fromTo([0, 1, 0], V.norm(yard.v)); v.w = [0, 0, 0];
  v.lock = null; v.landed = false; v.prelaunch = false; v.prelaunchHold = false; v.situation = 'SPACE';
  v.site = 'yard';
}
// shipyards among the vessels in flight (science fiction)
function shipyards(g) { return SCIFI.on ? g.vessels.filter(s => !s.debris && s.parts.some(p => !p.dead && PART[p.id] && PART[p.id].yard)) : []; }

function enterFlight() {
  mapSetVisible(false);
  Game.screen = 'flight';
  Game.world.map = false;
  ui.flight();
  updateLoaded(true);
}

// which vessels are simulated with physics
function updateLoaded(force) {
  const W = Game.world, A = W.active, t = Game.g.ut;
  const keep = [];
  for (const v of W.vessels) {
    if (v.destroyed) {
      const vw = W.views.get(v.id);
      if (vw && v !== A) { RV.scene.remove(vw.group); W.views.delete(v.id); }
      if (v === A) keep.push(v);
      continue;
    }
    let want = false;
    if (v === A) want = true;
    else if (A && !A.destroyed && v.body === A.body && V.dist(v.r, A.r) < 2500) want = true;
    if (want && !v.loaded) {
      v.loaded = true;
      if (v.rails && W.warp === 0) { v.rails = null; if (v.lock) applyLock(v, t); }
    } else if (!want && v.loaded) {
      v.loaded = false;
      const alt = V.len(v.r) - v.body.R;
      const inAtm = v.body.atm && alt < v.body.atm.top && !v.lock;
      if (v.debris || inAtm) { const vw = W.views.get(v.id); if (vw) { RV.scene.remove(vw.group); W.views.delete(v.id); } loseCrew(v.parts); continue; }
      enterRails(v, t);
    }
    if (!v.loaded && !v.rails) enterRails(v, t);
    keep.push(v);
  }
  W.vessels = keep;
  for (const id in BODY) if (BODY[id].void && !keep.some(v => v.body === BODY[id])) dropVoid(BODY[id]);   // open-space frames nobody uses
  // views
  for (const v of W.vessels) {
    if (v.loaded && !W.views.has(v.id)) { const vw = new VesselView(v); RV.scene.add(vw.group); W.views.set(v.id, vw); }
    if (!v.loaded && W.views.has(v.id)) { const vw = W.views.get(v.id); RV.scene.remove(vw.group); W.views.delete(v.id); }
  }
  void force;
}

Game.warpRate = function () { const W = Game.world; if (!W) return 1; return W.warp > 0 ? Game.warpLevels[W.warp] : Game.physLevels[W.physWarp]; };

function railsAllowed(A) {
  if (!A) return true;
  if (A.lock) return true;
  if (A.prelaunch) return true;
  const alt = V.len(A.r) - A.body.R;
  if (A.body.atm && alt < A.body.atm.top) return false;
  if (A.inContact) return false;
  if (A.body.terrain && alt < A.body.hMax + 2000) {
    const el = elFromState(A.r, A.v, A.body.mu, Game.g.ut);
    if (el.rp < A.body.R + A.body.hMax) return false;
  }
  // a burn (or a deployed sail) goes on under warp while SAS holds the attitude
  if (thrustWanted(A) && (A.throttle > 0 || A.parts.some(p => !p.dead && p.st.eng && p.st.eng.on && !p.st.eng.out && !PART[p.id].engine.throttle))) return railsThrustOK(A);
  if (sailDeployed(A)) return railsThrustOK(A);
  return true;
}
function railsWhyNot(A) {
  const alt = V.len(A.r) - A.body.R;
  if (A.body.atm && alt < A.body.atm.top) return 'в атмосфере — только физическое ускорение';
  if (A.inContact) return 'аппарат касается поверхности';
  if (A.body.terrain && alt < A.body.hMax + 2000) return 'орбита задевает рельеф';
  return 'тяга без SAS — включите SAS (T), чтобы жечь под ускорением';
}
// the two fastest rates (×10⁸, ×10⁹) only far from planets: in orbit around a star or between stars
function warpCap(A) { return !A || A.lock || A.landed || A.body.star ? Game.warpLevels.length - 1 : Game.warpLevels.indexOf(10000000); }
Game.warpUp = function (phys) {
  const W = Game.world; if (!W) return;
  const A = W.active;
  if (phys || (W.warp === 0 && A && !railsAllowed(A))) {
    if (W.warp > 0) return;
    if (!phys) ui.toast('Ускорение на рельсах невозможно: ' + railsWhyNot(A), '', 2500);
    W.physWarp = Math.min(Game.physLevels.length - 1, W.physWarp + 1);
    return;
  }
  W.physWarp = 0;
  if (W.warp >= warpCap(A)) { if (warpCap(A) < Game.warpLevels.length - 1) ui.toast('×10⁸ и ×10⁹ — только вне сфер влияния планет', '', 2000); return; }
  W.warp = Math.min(warpCap(A), W.warp + 1);
};
Game.warpDown = function () {
  const W = Game.world; if (!W) return;
  W.warpTo = null;
  if (W.warp > 0) { W.warp--; if (W.warp === 0) exitRailsLoaded(); }
  else W.physWarp = Math.max(0, W.physWarp - 1);
};
Game.stopWarp = function () { const W = Game.world; if (!W) return; W.warpTo = null; if (W.warp > 0) { W.warp = 0; exitRailsLoaded(); } W.physWarp = 0; };
function exitRailsLoaded() {
  const W = Game.world, t = Game.g.ut;
  for (const v of W.vessels) if (v.loaded && v.rails) { v.rails = null; v.w = [0, 0, 0]; if (v.lock) applyLock(v, t); }
}

// ================================================================ flight simulation
function readControls(dt) {
  const k = Game.keys, s = Game.precise ? 0.3 : 1;
  const ax = (a, b) => ((k[a] ? 1 : 0) - (k[b] ? 1 : 0)) * s;
  return {
    pitch: ax('KeyW', 'KeyS'), yaw: ax('KeyD', 'KeyA'), roll: ax('KeyE', 'KeyQ'),
    ty: ax('KeyH', 'KeyN'), tz: ax('KeyI', 'KeyK'), tx: ax('KeyL', 'KeyJ'),
    thr: (k.ShiftLeft || k.ShiftRight ? 1 : 0) - (k.ControlLeft || k.ControlRight ? 1 : 0),
    brake: k.KeyB ? 1 : 0,
  };
}

// ---------------------------------------------------------------- alarms
// earliest pending alarm: explicit ones, plus the active vessel's next manoeuvre while auto-stop is on
function nextAlarm(W, t) {
  const g = Game.g; let best = null;
  for (const a of g.alarms || []) if (a.t > t && (!best || a.t < best.t)) best = a;
  const A = W && W.active;
  if (g.autoNodeAlarm !== false && A && !A.destroyed && A.nodes && A.nodes.length && Game.screen === 'flight') {
    const info = nodeInfo(A), tn = A.nodes[0].t - (info && info.burn ? info.burn / 2 : 0) - 30;
    if (tn > t + 1 && (!best || tn < best.t)) best = { t: tn, title: 'Манёвр', auto: true };
  }
  return best;
}
function fireAlarm(a, stopWarp) {
  if (stopWarp) Game.stopWarp();
  const vs = a.vid && Game.world && Game.world.vessels.find(v => v.id === a.vid);
  ui.toast(`⏰ ${esc(a.title)}${vs ? ' · ' + esc(vs.name) : ''}`, 'acc', 5000);
  if (!a.auto) removeAlarm(Game.g, a.id);
}
// warp step [t0, t1]: clamp to the next alarm and fire it
function alarmClamp(W, t0, t1) {
  const a = nextAlarm(W, t0);
  if (a && a.t <= t1) { fireAlarm(a, true); return a.t; }
  return t1;
}
function alarmsPassed(t0, t1) {
  for (const a of (Game.g.alarms || []).slice()) if (a.t > t0 && a.t <= t1) fireAlarm(a, false);
}

// mapping satellites, every vessel that carries a scanner (on rails or loaded)
function scanAll(vessels, t0, t1) {
  const g = Game.g, cache = {};
  for (const v of vessels) if (!v.destroyed && v.parts.some(p => !p.dead && PART[p.id].scanner)) { if (scanTick(g, v, t0, t1, cache) > 0) (g._scanDirty = g._scanDirty || {})[v.body.id] = true; }
  const now = performance.now();
  for (const id in cache) {
    if (!(g._scanDirty || {})[id] || now - ((g._scanT = g._scanT || {})[id] || 0) < 1000) continue;
    g._scanT[id] = now;
    const cov = scanCoverage(cache[id]), x = mappingCredit(g, id, cov);
    const pct = Math.floor(cov * 10) * 10, last = (g._scanPct = g._scanPct || {})[id];
    if (last == null) g._scanPct[id] = pct;
    else if (pct > last) { g._scanPct[id] = pct; ui.toast(`Картографирование: ${BODY[id].name} — ${pct}%${x > 0 ? ` · +${x.toFixed(1)} науки` : ''}`, 'good', 3500); }
  }
}

function simulate(dt) {
  const W = Game.world, g = Game.g, A = W.active;
  const ctl = readControls(dt);
  W.ctl = ctl;
  if (A && !A.destroyed) {
    if (ctl.thr) { A.throttle = clamp(A.throttle + ctl.thr * dt * 0.9, 0, 1); }
    if (W.warp > 0 && A.throttle > 0 && thrustWanted(A) && !railsThrustOK(A)) { Game.stopWarp(); ui.toast('Ускорение времени остановлено: тяга без SAS', '', 1500); }
  }
  // auto warp-to
  if (W.warpTo != null) {
    const rem = W.warpTo - g.ut;
    if (rem <= 0.5) { Game.stopWarp(); ui.toast('Время манёвра близко', '', 2000); }
    else if (!A || railsAllowed(A)) {
      let lvl = 0;
      for (let i = 1; i <= warpCap(A); i++) if (Game.warpLevels[i] * dt * 4 < rem) lvl = i;
      if (lvl !== W.warp) { W.warp = lvl; W.physWarp = 0; if (lvl === 0) exitRailsLoaded(); }
    }
  }
  // warp bubble (science fiction): the ship is carried, everything else coasts on rails; time warp still applies
  if (A && !A.destroyed && A.warpOn) {
    const t0 = g.ut;
    let t1 = alarmClamp(W, t0, t0 + dt * (W.warp > 0 ? Game.warpLevels[W.warp] : 1));
    for (const v of W.vessels) if (v !== A && !v.rails && !v.destroyed) enterRails(v, t0);
    A.rails = null; A.w = [0, 0, 0];
    const res = warpAdvance(A, t0, t1);
    t1 = res.t;
    for (const v of W.vessels) if (v !== A && !v.destroyed) railsAdvance(v, t0, t1);
    g.ut = t1; W.acc = 0; W.traj = null;
    if (res.event) {
      A.warpOn = false; W.warp = 0; W.warpTo = null; exitRailsLoaded(); W.trajT = -1;
      ui.toast({ arrive: `Выход из варпа: ${res.body ? res.body.name : ''}`, close: `Выход из варпа: слишком близко к ${A.body.name}`, empty: 'Варп сорван: кончилась экзотическая материя',
        power: 'Варп сорван: ядру не хватает тока' }[res.event], res.event === 'arrive' ? 'acc' : 'bad', 4000);
    }
    return;
  }
  if (W.warp > 0) {
    if (A && !A.destroyed && !railsAllowed(A)) { W.warp = 0; exitRailsLoaded(); ui.toast('Ускорение невозможно: ' + railsWhyNot(A), '', 2500); return; }
    const t0 = g.ut;
    let t1 = t0 + dt * Game.warpLevels[W.warp];
    if (W.warpTo != null) t1 = Math.min(t1, W.warpTo);
    t1 = alarmClamp(W, t0, t1);
    for (const v of W.vessels) if (!v.rails && !v.destroyed) { if (v.body.void) { const vb = v.body; voidLeave(v); if (!W.vessels.some(o => o.body === vb)) dropVoid(vb); } enterRails(v, t0); }
    if (W.warp > warpCap(A)) W.warp = warpCap(A);
    if (A && !A.destroyed) {
      const powered = !A.rails.landed && railsPowered(A);
      const res = powered ? railsPoweredAdvance(A, t0, t1, 600) : railsAdvance(A, t0, t1);
      if (powered) t1 = res.t;   // a heavy burn may not get through the whole warp step
      if (res.event) {
        t1 = res.t;
        W.warp = 0; W.warpTo = null;
        if (res.event === 'soi') ui.toast(`Сфера влияния: ${A.body.name}`, 'acc');
        if (res.event === 'atmo') ui.toast(`Вход в атмосферу: ${A.body.name}`, 'acc');
        if (res.event === 'impact') ui.toast(`Внимание: поверхность близко!`, 'bad');
        if (res.event === 'burnout') ui.toast('Тяга прекратилась: кончилось топливо или ток', 'bad');
        W.trajT = -1;
      }
    }
    for (const v of W.vessels) if (v !== A && !v.destroyed) { const r = railsAdvance(v, t0, t1); if (r.event === 'impact' && !v.loaded) { v.destroyed = true; } }
    if (SCIFI.on) for (const v of W.vessels) if (!v.destroyed) produceExotic(v, t1 - t0);
    scanAll(W.vessels, t0, t1);
    g.ut = t1;
    if (W.warp === 0) exitRailsLoaded();
    W.acc = 0;
    return;
  }
  const tPhys0 = g.ut;
  // physics
  const k = Game.physLevels[W.physWarp];
  W.acc += dt * k;
  const t0 = g.ut;
  let n = 0;
  const loaded = W.vessels.filter(v => v.loaded && !v.destroyed);
  while (W.acc >= PHYS_DT) {
    W.acc -= PHYS_DT;
    for (const v of loaded) {
      if (v.destroyed) continue;
      if (v.rails) { v.rails = null; if (v.lock) applyLock(v, g.ut); }
      const alt = v.radarAlt != null ? v.radarAlt : V.len(v.r) - v.body.R;
      const near = !v.body.gas && alt < (v._bnd ? v._bnd.size : 40) + 80;
      const sub = near ? 4 : 1;
      const eva = isKerbalVessel(v);
      if (eva && v === A) evaStep(v, evaInput(), PHYS_DT);
      for (let i = 0; i < sub && !v.destroyed; i++) physicsStep(v, PHYS_DT / sub, g.ut + i * PHYS_DT / sub, v === A && !eva ? ctl : {}, vesselHooks(v));
      if (!v.destroyed && checkSOI(v, g.ut + PHYS_DT)) { if (v === A) { ui.toast(`Сфера влияния: ${v.body.name}`, 'acc'); W.trajT = -1; } }
      if (v === A && !v.destroyed) v.maxAlt = Math.max(v.maxAlt || 0, V.len(v.r) - v.body.R);
    }
    for (const m of dockingStep(loaded, PHYS_DT, A)) Game.onDock(m);
    // vessels split off during this step join the simulation next step
    for (const v of W.vessels) if (v.loaded && !loaded.includes(v) && !v.destroyed) loaded.push(v);
    g.ut += PHYS_DT;
    if (++n > 60 * k) { W.acc = 0; break; }
  }
  alarmsPassed(tPhys0, g.ut);
  if (g.ut > tPhys0) scanAll(W.vessels, tPhys0, g.ut);
  for (const v of W.vessels) if (!v.loaded && !v.destroyed && v.rails) railsAdvance(v, t0, g.ut);
}

// camera-relative EVA input (WASD walk / fly, Shift-Ctrl up-down, Space jump, R jetpack)
function evaInput() {
  const W = Game.world, A = W.active, c = W.cam, k = Game.keys;
  const up = V.norm(A.r);
  let north = V.reject([0, 0, 1], up); if (V.len(north) < 1e-6) north = V.reject([1, 0, 0], up); north = V.norm(north);
  const east = V.cross(north, up);
  const hz = V.add(V.scale(north, -Math.cos(c.yaw)), V.scale(east, Math.sin(c.yaw)));
  const fwd = V.neg(V.norm(V.add(V.scale(hz, Math.cos(c.pitch)), V.scale(up, Math.sin(c.pitch)))));
  const right = V.norm(V.cross(fwd, up)), camUp = V.cross(right, fwd);
  const ax = (a, b) => (k[a] ? 1 : 0) - (k[b] ? 1 : 0);
  const jump = Game._evaJump; Game._evaJump = false;
  return { fwd, right, up: camUp, mz: ax('KeyW', 'KeyS'), mx: ax('KeyD', 'KeyA'), my: (k.ShiftLeft || k.ShiftRight ? 1 : 0) - (k.ControlLeft || k.ControlRight ? 1 : 0), jump, jet: !!A.evaJet };
}

// the star system the scene happens in: the floating origin for "absolute" positions (see bodies.js)
function sceneSystem() {
  const W = Game.world;
  if (!W) return null;
  if (Game.screen === 'flight' && W.active) return W.active.body.sys;
  if (Game.screen === 'track') { const v = W.vessels.find(x => x.id === W.trackSel); return v ? v.body.sys : MAP.focus.kind === 'body' ? BODY[MAP.focus.id].sys : null; }
  return null;
}

function flightFrame(dt) {
  const W = Game.world, g = Game.g;
  if (!W) return;
  const A = W.active;
  const ut0 = g.ut;
  simulate(dt);
  // particles must advance by the time the world actually advanced (whole PHYS_DT steps), not the
  // frame time: Earth moves ~9 km/s, so any mismatch shows up as smoke jumping tens of metres
  W.simDt = g.ut - ut0;
  // far from every body, fly with physics in a frame of its own (precision); the vessels loaded around come along
  if (W.warp === 0 && A && !A.destroyed && A.loaded && !A.lock) {
    const star = A.body, vb = voidEnter(A);
    if (vb) {
      for (const v of W.vessels) if (v !== A && v.loaded && v.body === star) { v.r = V.sub(v.r, vb.el.r0); v.body = vb; }
      W.trajT = -1;
    }
  }
  setOrigin(sceneSystem());   // the active vessel may have crossed into another star system this frame
  const now = performance.now();
  if (now - W.loadT > 400) { W.loadT = now; updateLoaded(); }
  // career progress
  if (A && !A.destroyed && now - W.progT > 1000) {
    W.progT = now;
    const ms = progressTick(g, A, g.ut);
    for (const c of crewAgeTick(g, W.vessels, g.ut)) ui.toast(`Смерть от старости в полёте: ${esc(c.name)}, ${fmtYears(crewAge(c))}`, 'bad', 6000);
    for (const m of ms) ui.toast(`Достижение: ${esc(m.title)} ${isCareer(g) ? `+${fmtMoney(m.funds)} +${m.sci} науки` : ''}`, 'acc', 5000);
    Game.raceNews();
    for (const r of siteCheck(g, A, g.ut)) ui.toast(r.what === 'found' ? `Найдено место посадки ${esc(r.s.name)} (${fmtDist(r.dist)})${isCareer(g) ? ` · +${r.sci.toFixed(0)} науки` : ''}` : `Осмотрено место посадки ${esc(r.s.name)}${isCareer(g) ? ` · +${r.sci.toFixed(0)} науки` : ''}`, 'acc', 5000);
  }
  // trajectory
  if (A && !A.destroyed && (now - W.trajT > (W.map ? 250 : 600) || W.trajT < 0)) { W.trajT = now; computeTraj(); }
  // landing prediction while coming down (conic ends in the atmosphere / ground, or already flying low)
  if (A && !A.destroyed && now - (W.impT || 0) > 1000) {
    W.impT = now;
    const p0 = W.traj && W.traj[0];
    // ballistic only: not for winged craft, powered flight, or something already rolling on the ground
    const winged = A.parts.some(p => !p.dead && PART[p.id].wing);
    const down = !A.landed && !A.lock && !A.inContact && !A.body.gas && !winged && !(A.thrustNow > 0) &&
      ((p0 && (p0.end === 'atmo' || p0.end === 'impact')) || (A.body.atm && V.len(A.r) - A.body.R < A.body.atm.top));
    W.impact = down ? predictImpact(A, g.ut) : null;
  }
  renderFlight(dt);
  recFrame(W, g.ut);
  sndFlight(W);
  ui.hud();
  if (W.map) ui.mnv(A, A && A.nodes && A.nodes[W.selNode], nodeInfo(A));
}

function computeTraj() {
  const W = Game.world, A = W.active, t = Game.g.ut;
  if (!A || A.landed || A.prelaunch || A.destroyed || A.warpOn) { W.traj = null; if (A) A.nodeBurn = null; return; }
  A.nodes = A.nodes || [];
  try { W.traj = predictTrajectory(A.body, A.r, A.v, t, { nodes: A.nodes, maxPatches: 7 }); }
  catch (e) { console.warn(e); W.traj = null; }
  A.nodeBurn = null;
  if (A.nodes.length && W.traj) {
    const nd = A.nodes[0];
    let s = null, tgtV = null;
    const pt = W.traj.find(p => p.end === 'node' && Math.abs(p.t1 - nd.t) < 1e-3);
    if (pt && nd.t > t) {
      s = elState(pt.el, nd.t);
      if (!nd.vTarget || nd.bodyId !== pt.body.id) { nd.vTarget = V.add(s.v, dvLocalToWorld(s.r, s.v, nd.dv)); nd.rTarget = s.r; nd.bodyId = pt.body.id; }
      nd.rTarget = s.r;
      tgtV = nd.vTarget;
    } else if (nd.t <= t && nd.vTarget && nd.bodyId === A.body.id) {
      // node time has passed mid-burn: compare against the target orbit propagated to now
      const elT = elFromState(nd.rTarget, nd.vTarget, A.body.mu, nd.t);
      tgtV = elState(elT, t).v;
      s = { r: A.r, v: A.v };
    } else if (nd.t <= t) {
      s = { r: A.r, v: A.v };
      if (!nd.vTarget) { nd.vTarget = V.add(s.v, dvLocalToWorld(s.r, s.v, nd.dv)); nd.rTarget = s.r; nd.bodyId = A.body.id; nd.t = t; }
      tgtV = nd.vTarget;
    }
    if (s && tgtV) {
      const burn = V.sub(tgtV, s.v);
      nd.dvTotal = V.len(burn);
      nd.dv = dvWorldToLocal(s.r, s.v, burn);
      A.nodeBurn = burn;
      if (nd.dvTotal < 0.25 && (nd.t <= t + 60 || A.throttle > 0)) {
        A.nodes.shift(); W.selNode = -1; A.nodeBurn = null;
        ui.toast('Манёвр выполнен', 'good');
        if (A.sasMode === 'node') A.sasMode = 'stab', A.sasHold = null;
        W.traj = predictTrajectory(A.body, A.r, A.v, t, { nodes: A.nodes, maxPatches: 7 });
      }
    }
  }
  // target closest approach
  const tv = targetVessel(W);
  W.closest = tv ? closestApproachVessel(W.traj, tv, t) : W.target ? closestApproach(W.traj, W.target) : null;
}

function nodeInfo(A) {
  if (!A || !A.nodes || !A.nodes.length) return null;
  const nd = A.nodes[Game.world.selNode] || A.nodes[0];
  const th = stageThrust(A);
  if (!th || th.F <= 0) return { burn: 0 };
  const m = massProps(A).m, dv = nd.dvTotal != null ? nd.dvTotal : V.len(nd.dv);
  const ve = th.F / th.mdot;
  const burn = m * (1 - Math.exp(-dv / ve)) / th.mdot;
  return { burn };
}
// vacuum thrust & mass flow of running engines, or the next stage's engines
function stageThrust(v) {
  let F = 0, md = 0;
  const add = (p) => { const e = PART[p.id].engine; const m = engineMdot(e); F += m * e.ispVac * G0; md += m; };
  for (const p of v.parts) if (!p.dead && p.st.eng && p.st.eng.on && !p.st.eng.out) add(p);
  if (F === 0) for (let s = v.stageIdx; s < v.stages.length && F === 0; s++) for (const rid of v.stages[s]) { const p = v.parts[rid]; if (p && !p.dead && p.st.eng) add(p); }
  return F > 0 ? { F, mdot: md } : null;
}

Game.flightDVList = function (v) {
  const W = Game.world; if (!W) return null;
  const now = performance.now();
  if (W.dvCache && W.dvCache.v === v && now - W.dvT < 500) return W.dvCache.list;
  const alt = V.len(v.r) - v.body.R;
  const p = atmAt(v.body, alt).p;
  const list = simulateStages(v, p, v.body.g0);
  W.dvCache = { v, list }; W.dvT = now;
  return list;
};
Game.flightDV = function (v) {
  const list = Game.flightDVList(v);
  if (!list || !list.length) return null;
  const total = list.reduce((s, x) => s + x.dv, 0);
  const cur = list[0].dv;
  const m = massProps(v).m;
  const twr = (v.thrustNow || list[0].thrust) / (m * v.body.g0); // relative to surface gravity of the current body
  return { cur, total, twr };
};
Game.stageResources = function (v) {
  const doms = new Set(); let solid = 0, solidMax = 0;
  for (const p of v.parts) {
    if (p.dead || !p.st.eng || !p.st.eng.on) continue;
    const e = PART[p.id].engine;
    if (e.prop === 'SOLID') { solid += p.res.SOLID || 0; solidMax += PART[p.id].res.SOLID; }
    else if (e.prop === 'LFO' && v.domain[p.rid] >= 0) doms.add(v.domain[p.rid]);
  }
  let cur = solid, max = solidMax;
  for (const d of doms) for (const rid of v.domains[d]) { const p = v.parts[rid]; if (!p.dead) { cur += p.res.LFO || 0; max += PART[p.id].res.LFO || 0; } }
  return max > 0 ? { cur, max } : null;
};

// ---------------------------------------------------------------- camera & render
function flightCamera() {
  const W = Game.world, A = W.active, t = Game.g.ut;
  const tgt = V.add(bodyAbsPos(A.body, t), A.r);
  const up = V.norm(A.r);
  let north = V.reject([0, 0, 1], up);
  if (V.len(north) < 1e-6) north = V.reject([1, 0, 0], up);
  north = V.norm(north);
  const east = V.cross(north, up);
  const c = W.cam;
  const hz = V.add(V.scale(north, -Math.cos(c.yaw)), V.scale(east, Math.sin(c.yaw)));
  const off = V.scale(V.add(V.scale(hz, Math.cos(c.pitch)), V.scale(up, Math.sin(c.pitch))), c.dist);
  let camAbs = V.add(tgt, off);
  // keep the camera above the terrain
  const b = A.body, bAbs = bodyAbsPos(b, t);
  const rel = V.sub(camAbs, bAbs);
  if (!b.gas) {
    const rl = V.len(rel);
    if (rl - b.R < b.hMax + 200) {
      const gh = groundHeight(b, V.norm(inertialToBodyFixed(b, t, rel)), 8);
      const minR = b.R + gh + 1.5;
      if (rl < minR) camAbs = V.add(bAbs, V.scale(V.norm(rel), minR));
    }
  }
  return { camAbs, quat: lookQuat(V.sub(tgt, camAbs), up), up };
}

// sky brightness and sun visibility at a point near a body
function lightAt(b, rel, t) {
  const alt = V.len(rel) - b.R;
  const sunDir = V.norm(V.sub(bodyAbsPos(b.host, t), bodyAbsPos(b, t)));
  const elev = V.dot(V.norm(rel), sunDir);
  const dens = b.atm && alt < b.atm.top ? Math.exp(-Math.max(0, alt) / b.atm.H) * clamp(Math.sqrt(b.atm.p0 / 101.325), 0.05, 1.5) : 0;
  const skyLight = clamp(dens * 1.5, 0, 1) * smooth(-0.15, 0.25, elev);
  return { skyLight, sun: sunExposure(b, rel, t) > 0 ? 1 : 0.03, elev };
}

function renderFlight(dt) {
  const W = Game.world, A = W.active, t = Game.g.ut;
  let camAbs, quat, opts;
  const av = A && W.views.get(A.id);
  if (W.map) {
    const mc = mapCameraAbs(t, A);
    camAbs = mc.abs; quat = mapCameraQuat(mc.look);
    opts = { map: true, near: Math.max(1, MAP.dist * 1e-4), far: Math.max(1e14, MAP.dist * 1e4) };
  } else {
    const c = flightCamera();
    camAbs = c.camAbs; quat = c.quat;
    RV.camAbs = camAbs;   // positions below are camera-relative for *this* frame (bodies move km per frame)
    const b = A.body, camRel = V.sub(camAbs, bodyAbsPos(b, t));
    const L = lightAt(b, camRel, t);
    const vl = lightAt(b, A.r, t);
    opts = { focusBody: b, focusRel: camRel, skyLight: L.skyLight, sunFactor: vl.sun, near: 0.1 };
    // science fiction: near light speed the sky crowds forward and shifts colour (velocity in the local star frame);
    // inside a warp bubble the same look stands for the streaming stars
    if (SCIFI.on) {
      const vs = V.add(bodyAbsState(b, t).v, A.v), bl = V.len(vs) / C_LIGHT;
      if (A.warpOn) opts.beta = V.scale(Q.rot(ctrlQ(A), [0, 1, 0]), Math.min(0.97, 0.55 + 0.1 * Math.log10(A.warpF || 10)));
      else if (bl > 1e-3) opts.beta = V.scale(V.norm(vs), Math.min(bl, 0.9999));
    }
    // shadow box around the active vessel + a catcher disc on the ground under it
    if (av) {
      const mp = massProps(A);
      const bnd = av.bounds;
      const comAbs = V.add(bodyAbsPos(b, t), A.r);
      const comT = relT(comAbs);
      opts.shadow = { pos: comT, size: bnd.size * 0.75 + 4 };
      if (!b.gas && (!A._gnd || A.lock) && V.len(A.r) - b.R < b.hMax + 500) { A._gnd = null; const g0 = vesselGround(A, t); A.radarAlt = V.len(A.r) - b.R - g0.h; }
      const gnd = A._gnd;
      const radar = A.radarAlt != null ? A.radarAlt : V.len(A.r) - b.R;
      if (!b.gas && gnd && radar < bnd.size * 3 + 30) {
        const pg = V.add(bodyAbsPos(b, t), V.scale(V.norm(A.r), b.R + gnd.h + 0.12));
        opts.catcher = { pos: relT(pg), normal: toT(gnd.n).normalize(), size: bnd.size * 1.6 + 8 };
      }
      const ec = av.engineCenter();
      if (ec) {
        const local = V.sub(ec.pos, mp.com);
        opts.engineLight = { pos: relT(V.add(comAbs, Q.rot(A.q, local))), power: Math.min(1400, 120 + Math.sqrt(ec.thrust) * 22), range: 30 + Math.sqrt(ec.thrust) * 1.6 };
      }
    }
  }
  renderWorld(t, camAbs, quat, opts);
  // vessels
  for (const v of W.vessels) {
    const vw = W.views.get(v.id);
    if (!vw) continue;
    vw.group.visible = !W.map && !(v.destroyed && v.parts.every(p => p.dead));
    if (!vw.group.visible) continue;
    const alt = V.len(v.r) - v.body.R;
    const atm = atmAt(v.body, alt);
    const air = Q.invRot(v.q, V.sub(v.v, V.cross(bodyOmega(v.body), v.r)));
    vw.update(t, air, atm.p, dt);
    // re-entry plasma
    const hf = v.heatFlux || 0;
    const gl = clamp((hf - 2.5e5) / 2.5e6, 0, 1);
    vw.glow.visible = gl > 0.01 && V.len(air) > 50;
    if (vw.glow.visible) {
      const mp = massProps(v), bnd = vw.bounds;
      const fwd = V.norm(air);
      const lead = V.add(mp.com, V.scale(fwd, bnd.size * 0.45));
      vw.glow.position.set(lead[0], lead[1], lead[2]);
      vw.glow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(fwd[0], fwd[1], fwd[2]));
      const u = vw.glow.material.uniforms;
      u.uR0.value = bnd.maxR * 1.08 + 0.15; u.uExp.value = 0.45; u.uLen.value = bnd.size * (0.9 + gl * 2.2) + 2;
      u.uI.value = 0.06 + gl * 0.5; u.uThr.value = 1; u.uP.value = 0; u.uT.value = t;
    }
    if (W.warp === 0 && !W.map) spawnVesselFX(v, t, W.simDt, atm, air, hf);
  }
  // searchlights (pool of two) on the active vessel
  let si = 0;
  const avw = A && !W.map && W.views.get(A.id);
  if (avw && vesselRes(A, 'ELEC') > 0.01) for (const p of A.parts) {
    if (si >= RV.spots.length) break;
    const d = PART[p.id];
    if (p.dead || !d.light || !p.st.light) continue;
    const lens = avw.parts.get(p.rid).getObjectByName('lens'), sp = RV.spots[si++];
    lens.updateWorldMatrix(true, false);
    sp.position.setFromMatrixPosition(lens.matrixWorld);
    sp.target.position.copy(lens.localToWorld(new THREE.Vector3(0, 10, 0)));
    sp.target.updateMatrixWorld();
    sp.intensity = d.light.power; sp.distance = d.light.range; sp.angle = d.light.angle;
    // the same beam for the terrain shader (planets do not use three.js lights)
    SPOT_U.p.value[si - 1].copy(sp.position);
    SPOT_U.d.value[si - 1].copy(sp.target.position).sub(sp.position).normalize();
    SPOT_U.k.value[si - 1].set(d.light.power * 0.0035, d.light.range, Math.cos(d.light.angle), Math.cos(d.light.angle * 0.55));
  }
  for (; si < RV.spots.length; si++) { RV.spots[si].intensity = 0; SPOT_U.k.value[si].x = 0; }
  // historic landing sites near the camera
  if (!W.map && A) updateSites(t, A.body);
  else for (const m of (RV.siteMeshes || new Map()).values()) m.visible = false;
  if (W.warp > 0) FX.list.length = 0;
  let fxLight = [1, 1, 1];
  if (A && !W.map) { const l = lightAt(A.body, A.r, t); const k = 0.08 + 0.92 * l.sun * smooth(-0.1, 0.15, l.elev) + l.skyLight * 0.2; fxLight = [k, k * 0.97, k * 0.93]; }
  fxUpdate(W.warp > 0 ? 0 : W.simDt, fxLight);
  if (W.map) mapUpdate(t, A, W.traj, {
    target: W.target, selNode: W.selNode, closest: W.closest, vessels: W.vessels, setTarget: (id) => Game.setTarget(id), impact: W.impact,
    focusBody: (id) => { MAP.focus = { kind: 'body', id }; MAP.dist = Math.max(BODY[id].R * 4, Math.min(MAP.dist, BODY[id].soi * 2 || 1e12)); ui.toast(`Фокус: ${BODY[id].name}. <a style="color:#9cf;cursor:pointer" onclick="Game.setTarget('${id}')">Сделать целью</a>`, '', 3500); },
    focusVessel: () => { MAP.focus = { kind: 'vessel' }; },
    selectNode: (i) => { W.selNode = i; },
  });
  drawFrame();
  if (A && !A.destroyed) {
    const up = V.norm(A.r);
    let north = V.reject([0, 0, 1], up); if (V.len(north) < 1e-6) north = [1, 0, 0]; north = V.norm(north);
    const ts = targetState(W, t);
    A.tgtRel = ts ? V.sub(V.add(bodyAbsState(A.body, t).v, A.v), ts.v) : null;
    if (!ts && A.speedMode === 'target') A.speedMode = 'auto';
    const sv = navVelocity(A);
    const dirs = {};
    if (V.len(sv) > 0.1) {
      const pro = V.norm(sv), nrm = V.norm(V.cross(A.r, sv)), rad = V.cross(pro, nrm);
      Object.assign(dirs, { pro, retro: V.neg(pro), normal: nrm, anti: V.neg(nrm), radout: rad, radin: V.neg(rad) });
    }
    if (A.nodeBurn && V.len(A.nodeBurn) > 0.01) dirs.node = V.norm(A.nodeBurn);
    if (ts) { dirs.target = V.norm(V.sub(ts.r, V.add(bodyAbsPos(A.body, t), A.r))); dirs.antitarget = V.neg(dirs.target); A.targetDir = dirs.target; }
    else A.targetDir = null;
    updateNavball({ q: ctrlQ(A) }, up, north, dirs);
    drawNavball(Math.round(RV.w / 2 - 210 + 115), RV.h - 196, 190);
  }
}

function updateSites(t, b) {
  RV.siteMeshes = RV.siteMeshes || new Map();
  const g = Game.g, bAbs = bodyAbsPos(b, t);
  for (const s of SITES) {
    let m = RV.siteMeshes.get(s.id);
    const here = s.body === b.id && siteExists(g, s);
    if (!here) { if (m) m.visible = false; continue; }
    const d = siteDir(s), pF = V.scale(d, b.R + siteGround(s));
    const abs = V.add(bAbs, bodyFixedToInertial(b, t, pF));
    if (V.dist(abs, RV.camAbs) > 40000) { if (m) m.visible = false; continue; }
    if (!m) { m = buildSiteMesh(s); RV.scene.add(m); RV.siteMeshes.set(s.id, m); }
    m.visible = true;
    relT(abs, m.position);
    quatT(Q.mul(bodyRotQuat(b, t), Q.fromTo([0, 1, 0], d)), m.quaternion);
  }
}

function spawnVesselFX(v, t, dt, atm, air, hf) {
  const near = V.dist(V.add(bodyAbsPos(v.body, t), v.r), RV.camAbs) < 5000;
  if (!near || dt <= 0) return;
  const b = v.body;
  const bs = bodyAbsState(b, t);
  const om = bodyOmega(b);
  const windV = V.add(bs.v, V.cross(om, v.r));
  const mp = massProps(v);
  const hull = V.add(bs.r, v.r);
  const vRel = V.sub(v.v, V.cross(om, v.r));
  const up = V.norm(v.r);
  const R = (a, s) => (Math.random() - 0.5) * s + a;
  for (const p of v.parts) {
    if (p.dead || !p.st.eng || !p.st.eng.on || p.st.eng.out || !(p.st.eng.thr > 0.02)) continue;
    const d = PART[p.id];
    const ex = V.add(hull, Q.rot(v.q, V.sub(partPt(p, [0, -d.h / 2 - 0.4, 0]), mp.com)));
    const back = Q.rot(v.q, V.neg(partAxis(p)));
    const thr = p.st.eng.thr;
    const solid = d.engine.prop === 'SOLID';
    if (atm.p > 0.015 && !['XENON', 'FUSION', 'ANTIMAT'].includes(d.engine.prop) && !d.engine.air) {   // turbines and plasma drives leave no smoke trail
      const rate = (solid ? 5 : 2.5) * thr * Math.min(1, atm.p * 3) * dt * 60;
      for (let i = 0; i < rate; i++) {
        if (Math.random() > 0.75) continue;
        const jit = [R(0, 1), R(0, 1), R(0, 1)];
        const pv = V.add(V.add(windV, V.scale(back, 18 + Math.random() * 25)), V.scale(jit, 7));
        const pos = V.add(V.addS(ex, vRel, -Math.random() * dt), V.scale(back, Math.random() * 3 + (solid ? 2 : 4)));
        fxSpawn(pos, pv, 'smoke', (d.dBot || 1) * (solid ? 1.5 : 1.15), 5 + Math.random() * 6, windV);
      }
    }
    // the exhaust hits the ground: launch clouds / landing dust spread out along the surface
    const groundAbs = V.add(bs.r, V.scale(up, b.R + (v._gnd ? v._gnd.h : 0)));
    const hitH = V.dot(V.sub(ex, groundAbs), up);
    const reach = 25 + Math.sqrt(d.engine.thrust) * 1.2;
    if (!b.gas && hitH < reach && hitH > -5 && V.dot(back, up) < -0.5) {
      const ground = V.sub(ex, V.scale(up, Math.max(0, hitH - 0.5)));
      const kind = b.atm ? (v.launchUT != null && Game.g.ut - v.launchUT < 30 && b.id === 'earth' ? 'steam' : 'smoke') : 'dust';
      const n = (b.atm ? 6 : 4) * thr * (1 - hitH / reach) * dt * 60;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const hd = V.norm(V.reject([Math.cos(a), Math.sin(a), R(0, 0.4)], up));
        const sp = 20 + Math.random() * 40;
        const pv = V.add(V.add(windV, V.scale(hd, sp)), V.scale(up, 2 + Math.random() * 6));
        fxSpawn(V.add(ground, V.scale(hd, 2 + Math.random() * 4)), pv, kind, 2.4 + Math.random() * 2.5, 3 + Math.random() * 5, windV);
      }
    }
  }
  // EVA jetpack: small cold-gas puffs from the backpack
  const kp = v.parts.length === 1 && PART[v.parts[0].id].kerbal ? v.parts[0] : null;
  if (kp && kp.st.jet > 0.05) {
    for (let n = 40 * dt; n > 0; n--) {
      if (n < 1 && Math.random() > n) break;
      const pos = V.add(hull, Q.rot(v.q, V.sub(partPt(kp, [R(0, 0.2), -0.12, -0.26]), mp.com)));
      fxSpawn(pos, V.add(V.add(bs.v, v.v), Q.rot(v.q, [R(0, 1.5), R(0, 1.5), -2 - Math.random() * 2])), 'steam', 0.12 + Math.random() * 0.1, 0.5 + Math.random() * 0.4, V.add(bs.v, v.v));
    }
  }
  if (hf > 1.2e6) {
    // hot gas peeling off the rim of the leading face; rate is per simulated second and each puff is
    // spread back along this step's drift, so the trail is a continuous streak rather than beads
    const lead = Q.rot(v.q, V.norm(air));
    const bnd = v._bnd || vesselBounds(v);
    const e1 = V.norm(V.perp(lead)), e2 = V.cross(lead, e1);
    const face = V.add(hull, V.scale(lead, bnd.size * 0.45));
    const drift = V.scale(vRel, -0.1);
    const n = (250 + 350 * Math.min(1, (hf - 1.2e6) / 2e6)) * dt;
    for (let i = 0; i < n; i++) {
      if (i + 1 > n && Math.random() > n - i) break;
      const a = Math.random() * TAU, rr = bnd.maxR * (0.7 + Math.random() * 0.35);
      const pos = V.addS(V.add(face, V.add(V.scale(e1, Math.cos(a) * rr), V.scale(e2, Math.sin(a) * rr))), drift, Math.random() * dt);
      fxSpawn(pos, V.add(windV, V.scale(vRel, 0.9)), 'fire', 0.8 + Math.random() * 0.5, 0.14, windV);
    }
  }
}

// ================================================================ flight actions
Game.stage = function () {
  const W = Game.world; if (!W || !W.active || W.active.destroyed) return;
  const A = W.active;
  if (!hasControl(A)) { ui.toast('Нет управления (нет электричества?)', 'bad'); return; }
  if (A.stageIdx >= A.stages.length) { ui.toast('Ступеней больше нет', '', 1500); return; }
  if (W.warp > 0) Game.stopWarp();
  const fired = A.stages[A.stageIdx] || [];
  const out = activateStage(A, Game.g.ut, vesselHooks(A));
  if (fired.some(r => PART[A.parts[r].id].decoupler)) sndAt('decouple', null, { vessel: A });
  if (fired.some(r => PART[A.parts[r].id].engine)) sndAt('ignite', null, { vessel: A, level: 0.8 });
  for (const c of out) if (!W.vessels.includes(c)) { c.loaded = true; W.vessels.push(c); }
  updateLoaded();
  W.trajT = -1; W.dvT = -1;
};
// drag a stage item (part template uid) from stage `from` to `to` (or a new stage inserted at `to`)
Game.moveStage = function (uid, from, to, newStage) {
  const W = Game.world, A = W && W.active; if (!A) return;
  if (from < A.stageIdx || to < A.stageIdx) return;
  const items = (A.stages[from] || []).filter(r => A.parts[r] && A.parts[r].uid === uid);
  if (!items.length) return;
  const fired = A.stages.slice(0, A.stageIdx);
  const rest = moveStageItem(A.stages.slice(A.stageIdx), from - A.stageIdx, items, to - A.stageIdx, newStage);
  A.stages = fired.concat(rest);
  W.dvT = -1;
  const el = document.getElementById('h-stages'); if (el) el._sig = null;
};
Game.toggleSAS = function () { const A = Game.world && Game.world.active; if (!A) return; A.sas = !A.sas; A.sasHold = null; if (!A.sasMode) A.sasMode = 'stab'; sndUi('beep'); };
Game.setSASMode = function (m) {
  const A = Game.world && Game.world.active; if (!A) return;
  if (!sasAllowed(Game.g, A, m)) { const need = SAS_LEVEL[m]; ui.toast(need ? `Нужен пилот ${need}-го уровня или зонд` : 'Нужен пилот или зонд', 'bad', 2500); return; }
  if (m === 'node' && !A.nodeBurn) { ui.toast('Нет манёвра', '', 1500); return; }
  if ((m === 'target' || m === 'antitarget') && !Game.world.target) { ui.toast('Цель не выбрана: на карте щёлкните по телу или аппарату', '', 2500); return; }
  A.sas = true; A.sasMode = m; A.sasHold = null;
};
Game.toggleRCS = function () { const A = Game.world && Game.world.active; if (A) A.rcs = !A.rcs; };
Game.toggleLegs = function () {
  const A = Game.world && Game.world.active; if (!A) return;
  A.legs = !A.legs;
  sndAt('legs', null, { vessel: A });
  for (const p of A.parts) if (!p.dead && PART[p.id].legs) p.st.legs = A.legs;
  for (const p of A.parts) if (!p.dead && PART[p.id].gear && PART[p.id].gear.retract) p.st.gear = A.legs;
  if (A.lock && !A.legs) { /* stays locked */ }
  A._bnd = null;
};
Game.toggleWarpDrive = function () {
  const W = Game.world, A = W && W.active; if (!A) return;
  if (A.warpOn) { A.warpOn = false; W.warp = 0; exitRailsLoaded(); W.trajT = -1; ui.toast('Варп выключен', '', 1500); return; }
  const why = warpWhyNot(A);
  if (why) { ui.toast('Варп невозможен: ' + why, 'bad', 2500); return; }
  A.warpF = A.warpF || 10; A.warpOn = true; A.throttle = 0;
  ui.toast(`Варп ${A.warpF}c — курс по носу корабля${A.sas ? '' : ' (включите SAS, чтобы держать направление)'}`, 'acc', 2500);
};
Game.warpFactor = function (d) {
  const A = Game.world && Game.world.active; if (!A) return;
  const i = WARP_FACTORS.indexOf(A.warpF || 10);
  A.warpF = WARP_FACTORS[clamp(i + d, 0, WARP_FACTORS.length - 1)];
};
Game.toggleLights = function () {
  const A = Game.world && Game.world.active; if (!A) return;
  const ls = A.parts.filter(p => !p.dead && PART[p.id].light);
  if (!ls.length) { ui.toast('Нет прожекторов', '', 1200); return; }
  const on = !ls.some(p => p.st.light);
  for (const p of ls) p.st.light = on;
  ui.toast(on ? 'Прожекторы включены' : 'Прожекторы выключены', '', 1200);
};
Game.toggleSpeedMode = function () {
  const W = Game.world, A = W && W.active; if (!A) return;
  const cur = navSpeedMode(A);
  A.speedMode = cur === 'surface' ? 'orbit' : cur === 'orbit' && W.target ? 'target' : 'surface';
};
Game.toggleMap = function () {
  const W = Game.world; if (!W) return;
  W.map = !W.map;
  mapSetVisible(W.map);
  if (W.map) {
    MAP.focus = { kind: 'vessel' };
    const A = W.active;
    MAP.dist = A ? Math.max(A.body.R * 3.2, V.len(A.r) * 2.2) : 3e6;
  } else ui.mnv(null, null);
  W.trajT = -1;
};
Game.setTarget = function (id) {
  const W = Game.world; if (!W) return;
  if (W.active && id === 'v:' + W.active.id) return;
  W.target = W.target === id ? null : id;
  ui.toast(W.target ? 'Цель: ' + esc(targetName(W)) : 'Цель снята', '', 2000);
  W.trajT = -1;
};
// target is a body id or 'v:<vessel id>'
function targetVessel(W) {
  if (!W || !W.target || !W.target.startsWith('v:')) return null;
  const v = W.vessels.find(x => x.id === W.target.slice(2));
  return v && !v.destroyed ? v : null;
}
function targetName(W) { const tv = targetVessel(W); return tv ? tv.name : W.target && BODY[W.target] ? BODY[W.target].name : ''; }
// heliocentric position / velocity of the current target
function targetState(W, t) {
  if (!W.target) return null;
  if (W.target.startsWith('v:')) {
    const tv = targetVessel(W);
    if (!tv) { W.target = null; return null; }
    const bs = bodyAbsState(tv.body, t);
    return { r: V.add(bs.r, tv.r), v: V.add(bs.v, tv.v), vessel: tv };
  }
  return BODY[W.target] ? bodyAbsState(BODY[W.target], t) : null;
}
Game.onDock = function (m) {
  const W = Game.world, g = Game.g;
  for (const v of [m.keep, m.gone]) { const vw = W.views.get(v.id); if (vw) { RV.scene.remove(vw.group); vw.dispose(); W.views.delete(v.id); } }
  W.vessels = W.vessels.filter(v => v !== m.gone);
  if (W.active === m.gone) W.active = m.keep;
  for (const id of crewOf(m.keep)) { const c = crewById(g, id); if (c) c.vessel = m.keep.id; }
  if (W.target === 'v:' + m.gone.id || W.target === 'v:' + m.keep.id) W.target = null;
  updateLoaded();
  W.trajT = -1; W.dvT = -1;
  sndAt('dock', null, { vessel: m.keep });
  ui.toast(`Стыковка: ${esc(m.keep.name)} + ${esc(m.gone.name)}`, 'good', 3000);
  const ms = milestone(g, 'dock'); if (ms) ui.toast(`Достижение: ${esc(ms.title)}`, 'acc');
  contractEvent(g, 'docked', { a: m.keep, b: m.gone });
};
Game.undock = function (rid) {
  const W = Game.world, A = W && W.active; if (!A) return;
  const out = undock(A, +rid, vesselHooks(A));
  for (const c of out) { if (!W.vessels.includes(c)) { c.loaded = true; W.vessels.push(c); } for (const id of crewOf(c)) { const k = crewById(Game.g, id); if (k) k.vessel = c.id; } }
  if (A.ctrlPort != null && A.parts[A.ctrlPort] && A.parts[A.ctrlPort].dead) A.ctrlPort = null;
  updateLoaded();
  W.trajT = -1; W.dvT = -1;
  sndAt('decouple', null, { vessel: A, level: 0.6 });
  if (out.length) ui.toast('Расстыковка: ' + esc(out[0].name), '', 2500);
};
Game.switchVessel = function (dir) {
  const W = Game.world; if (!W || !W.active) return;
  const list = W.vessels.filter(v => v.loaded && !v.destroyed && !v.debris);
  if (list.length < 2) return;
  const i = list.indexOf(W.active);
  W.active = list[(i + dir + list.length) % list.length];
  W.cam.dist = Math.max(10, vesselBounds(W.active).size * 1.6 + 6);
  W.trajT = -1; W.dvT = -1; W.selNode = -1;
  ui.toast('Управление: ' + esc(W.active.name), '', 2000);
};

// ---------------------------------------------------------------- EVA
Game.eva = function (rid, kid) {
  const W = Game.world, A = W && W.active, g = Game.g; if (!A) return;
  const p = A.parts[+rid], c = crewById(g, kid);
  if (!p || p.dead || !p.crew || !p.crew.includes(kid) || !c) return;
  if (W.warp > 0) Game.stopWarp();
  const air = V.sub(A.v, V.cross(bodyOmega(A.body), A.r));
  if (A.body.atm && V.len(A.r) - A.body.R < A.body.atm.top && V.len(air) > 40) { ui.toast('Слишком быстро для выхода в атмосфере', 'bad'); return; }
  const k = buildVessel(makeDesign(c.name, ['kerbal']), c.name);
  k.parts[0].crew = [kid];
  p.crew = p.crew.filter(x => x !== kid);
  const mp = massProps(A), hl = hatchLocal(p);
  const arm = Q.rot(A.q, V.sub(hl, mp.com));
  const out = Q.rot(A.q, Q.rot(partQ(p), [1, 0, 0]));
  const upL = V.norm(A.r);
  k.body = A.body;
  k.r = V.addS(V.add(A.r, arm), out, 0.25);
  k.v = V.add(V.add(A.v, V.cross(Q.rot(A.q, A.w), arm)), A.lock ? [0, 0, 0] : V.scale(out, 0.3));
  if (A.lock) k.v = V.cross(bodyOmega(A.body), k.r);
  const up = A.lock || A.landed ? upL : Q.rot(A.q, [0, 1, 0]);
  k.q = Q.fromBasis(V.norm(V.cross(up, V.reject(out, up))), up, V.norm(V.reject(out, up)));
  k.w = [0, 0, 0];
  k.launchUT = A.launchUT; k.loaded = true; k.isEva = true;
  k.parts[0].st.evaFuel = EVA.fuel;
  c.vessel = k.id;
  W.vessels.push(k); W.active = k;
  updateLoaded();
  W.cam.dist = 5; W.cam.pitch = 0.2; W.trajT = -1; W.dvT = -1;
  sndAt('decouple', null, { vessel: k, level: 0.25 });
  ui.toast(`${esc(c.name)} в открытом космосе. WASD — движение, Shift/Ctrl — вверх/вниз, R — ранец, Пробел — прыжок, B — в люк, F — флаг`, '', 7000);
};
Game.board = function () {
  const W = Game.world, k = W && W.active, g = Game.g; if (!k || !isKerbalVessel(k)) return;
  const h = nearestHatch(W.vessels, k);
  if (!h) { ui.toast('Рядом нет люка со свободным местом (подойдите ближе 2.5 м)', 'bad', 2500); return; }
  const kp = kerbalPart(k), kid = kp.crew[0];
  h.part.crew = (h.part.crew || []).concat([kid]);
  h.part.data.push(...kp.data);
  const c = crewById(g, kid); if (c) c.vessel = h.vessel.id;
  kp.crew = []; k.destroyed = true;
  const vw = W.views.get(k.id); if (vw) { RV.scene.remove(vw.group); vw.dispose(); W.views.delete(k.id); }
  W.vessels = W.vessels.filter(x => x !== k);
  if (W.target === 'v:' + h.vessel.id) W.target = null;
  W.active = h.vessel;
  W.cam.dist = Math.max(10, vesselBounds(h.vessel).size * 1.6 + 6);
  updateLoaded(); W.trajT = -1; W.dvT = -1;
  sndAt('dock', null, { vessel: h.vessel, level: 0.4 });
  ui.toast(`${esc(c ? c.name : '')} на борту «${esc(h.vessel.name)}»`, 'good', 2500);
};
Game.plantFlag = function () {
  const W = Game.world, k = W && W.active, g = Game.g; if (!k || !isKerbalVessel(k)) return;
  const b = k.body, t = g.ut;
  if (!(k.inContact || k.lock) || b.gas || !b.terrain) { ui.toast('Флаг ставится только стоя на поверхности', 'bad', 2000); return; }
  const kid = kerbalPart(k).crew[0], c = crewById(g, kid);
  const face = Q.rot(k.q, [0, 0, 1]);
  const pos = V.addS(k.r, V.norm(V.reject(face, V.norm(k.r))), 1.2);
  const f = buildVessel(makeDesign('Флаг', ['flag']), `Флаг · ${b.name}`);
  f.body = b;
  const dF = V.norm(inertialToBodyFixed(b, t, pos)), h = PART.flag.h;
  const gh = groundHeight(b, dF, 2);
  const upF = dF, eastF = V.norm(V.cross([0, 0, 1], upF)), southF = V.neg(V.cross(upF, eastF));
  f.lock = { pf: V.scale(dF, b.R + gh + h / 2 + 0.01), qf: Q.mul(Q.fromBasis(eastF, upF, southF), Q.axisAngle([0, 1, 0], Math.random() * TAU)) };
  f.landed = true; f.w = [0, 0, 0]; f._comPrev = massProps(f).com.slice();
  applyLock(f, t);
  f.loaded = true; f.flagBy = c ? c.name : ''; f.flagUT = t;
  W.vessels.push(f); updateLoaded();
  g.stats.flags = (g.stats.flags || 0) + 1;
  crewLog(g, kid, b.id, 'flag');
  const ms = milestone(g, 'flag_' + b.id); if (ms) ui.toast(`Достижение: ${esc(ms.title)}`, 'acc');
  contractEvent(g, 'flag', { body: b.id });
  sndAt('touch', null, { vessel: k, speed: 2 });
  ui.toast(`Флаг установлен: ${esc(b.name)}`, 'good', 2500);
};
// parts on nearby vessels the astronaut can reach (3 m)
function evaReach(W, k) {
  const out = [];
  for (const v of W.vessels) {
    if (v === k || v.destroyed || v.body !== k.body || V.dist(v.r, k.r) > 60) continue;
    const mp = massProps(v);
    for (const p of v.parts) if (!p.dead && V.dist(V.add(v.r, Q.rot(v.q, V.sub(p.pos, mp.com))), k.r) < 3 + colRadius(PART[p.id])) out.push({ v, p });
  }
  return out;
}
Game.evaWork = function (what) {
  const W = Game.world, k = W && W.active, g = Game.g; if (!k || !isKerbalVessel(k)) return;
  const c = crewById(g, kerbalPart(k).crew[0]);
  let n = 0;
  for (const { v, p } of evaReach(W, k)) {
    const d = PART[p.id];
    if (what === 'repack' && d.chute && p.st.chute !== 'stowed' && p.st.chute !== 'armed') { p.st.chute = 'stowed'; p.st.chuteT = 0; n++; if (v.stageIdx >= v.stages.length || !v.stages.slice(v.stageIdx).some(s => s.includes(p.rid))) v.stages.push([p.rid]); }
    if (what === 'reset' && d.sci && EXPERIMENTS[d.sci].single && p.st.used && !p.data.length) { p.st.used = false; n++; }
  }
  if (what === 'repack') ui.toast(n ? `${esc(c.name)}: перепаковано парашютов — ${n}` : 'Рядом нет использованных парашютов', n ? 'good' : '', 2200);
  if (what === 'reset') ui.toast(n ? `${esc(c.name)}: эксперименты готовы к повтору — ${n}` : 'Рядом нет использованных экспериментов без данных', n ? 'good' : '', 2200);
};

Game.scienceList = function (v) {
  const g = Game.g, out = [];
  const antenna = v.parts.some(p => !p.dead && PART[p.id].antenna);
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    if (d.kerbal) {
      for (const exp of ['eva', 'sample']) {
        const e = EXPERIMENTS[exp], a = expAvailable(exp, v);
        const have = p.data.filter(x => x.exp === exp).length;
        if (exp === 'sample' && a.ok && (v.body.gas || !v.body.terrain)) continue;
        out.push({ name: e.name, status: (a.ok ? `здесь: ≈${dataValue(g, { exp, body: v.body.id, sit: a.sit }, false).toFixed(1)} науки` : a.why) + (have ? ` · с собой ${have}` : ''),
          buttons: [{ a: 'run', r: p.rid, x: exp, label: exp === 'sample' ? 'Взять образец' : 'Доклад', dis: !a.ok }] });
      }
      continue;
    }
    if (d.command && d.command.crew > 0 && !out.some(x => x.crew)) {
      const a = expAvailable('crew', v);
      const pod = p;
      const reports = pod.data.filter(x => x.exp === 'crew');
      const prev = a.ok ? dataValue(g, { exp: 'crew', body: v.body.id, sit: a.sit }, false) : 0;
      out.push({ crew: true, name: 'Доклад экипажа', status: (a.ok ? `здесь: ≈${prev.toFixed(1)} науки` : a.why) + (reports.length ? ` · собрано ${reports.length}` : ''),
        buttons: [{ a: 'run', r: p.rid, x: 'crew', label: 'Доклад', dis: !a.ok }, ...(reports.length && antenna ? [{ a: 'xmit', r: p.rid, label: 'Передать' }] : [])] });
    }
    if (d.sci) {
      const e = EXPERIMENTS[d.sci];
      const a = expAvailable(d.sci, v);
      let status;
      if (p.data.length) { const x = p.data[0]; status = `данные: ${x.title.split(': ')[1] || ''} — ${dataValue(g, x, false).toFixed(1)} (передача ${dataValue(g, x, true).toFixed(1)})`; }
      else if (e.single && p.st.used) status = 'израсходован';
      else status = a.ok ? `здесь: ≈${dataValue(g, { exp: d.sci, body: v.body.id, sit: a.sit }, false).toFixed(1)} науки` : a.why;
      const btns = [];
      if (!p.data.length && !(e.single && p.st.used)) btns.push({ a: 'run', r: p.rid, x: d.sci, label: 'Провести', dis: !a.ok });
      if (p.data.length && antenna) btns.push({ a: 'xmit', r: p.rid, label: 'Передать' });
      if (p.data.length && !e.single) btns.push({ a: 'discard', r: p.rid, label: 'Сбросить' });
      out.push({ name: e.name, status, buttons: btns });
    }
  }
  return out;
};

Game.action = function (a, r, x) {
  const W = Game.world, A = W && W.active, g = Game.g;
  if (!A) return;
  const p = r != null && r !== '' ? A.parts[+r] : null;
  switch (a) {
    case 'run': {
      const res = runExperiment(g, A, p, x);
      if (res.error) ui.toast(esc(res.error), 'bad', 2000);
      else ui.toast(`${esc(res.data.title)}: ${res.value.toFixed(1)} науки при возвращении, ${res.xmit.toFixed(1)} при передаче`, 'good', 4500);
      break;
    }
    case 'xmit': {
      const ant = A.parts.find(q => !q.dead && PART[q.id].antenna);
      if (!ant) { ui.toast('Нужна антенна', 'bad'); return; }
      const list = p.data.slice();
      let total = 0;
      for (const d of list) {
        const need = 10;
        if (vesselRes(A, 'ELEC') < need) { ui.toast('Не хватает электричества для передачи', 'bad'); break; }
        poolDraw(A, allRids(A), 'ELEC', need);
        total += creditData(g, d, true);
        p.data.splice(p.data.indexOf(d), 1);
      }
      if (list.length) ui.toast(`Передано: +${total.toFixed(1)} науки`, 'good');
      break;
    }
    case 'discard': p.data = []; break;
    case 'recover': Game.recover(); break;
    case 'chutes': for (const q of A.parts) if (!q.dead && q.st.chute === 'stowed') q.st.chute = 'armed'; ui.toast('Парашюты взведены: раскроются при безопасной скорости', '', 2500); break;
    case 'legs': Game.toggleLegs(); break;
    case 'solar': for (const q of A.parts) if (!q.dead && PART[q.id].solar) q.st.solar = !q.st.solar; break;
    case 'undock': Game.undock(r); break;
    case 'eva': Game.eva(r, x); return;
    case 'jet': A.evaJet = !A.evaJet; break;
    case 'board': Game.board(); return;
    case 'flag': Game.plantFlag(); break;
    case 'repack': case 'reset': Game.evaWork(a); break;
    case 'scan': for (const q of A.parts) if (!q.dead && PART[q.id].scanner) q.st.scan = q.st.scan === false; break;
    case 'atlas': ui.atlas(A.body.id); return;
    case 'xfer': Game.autoTransfer(); break;
    case 'refine': Game.refineTransfer(); break;
    case 'match': Game.matchVelocity(); break;
    case 'ctrl': A.ctrlPort = A.ctrlPort === +r ? null : +r; A.sasHold = null; ui.toast(A.ctrlPort != null ? 'Управление от стыковочного узла' : 'Управление от корабля', '', 1800); break;
    case 'ksc': Game.leaveFlight(); break;
    case 'warp': Game.toggleWarpDrive(); break;
    case 'warpup': Game.warpFactor(1); break;
    case 'warpdn': Game.warpFactor(-1); break;
  }
  if (ui.root.querySelector('#h-act')) ui.root.querySelector('#h-act')._h = null;
  ui.hud(true);
};

// ---------------------------------------------------------------- automatic transfers
// periapsis to aim for at a body: above the atmosphere, or a low orbit
function aimPe(b) { return b.atm ? b.atm.top + 15000 : Math.max(10000, b.R * 0.05); }
Game.autoTransfer = function () {
  const W = Game.world, A = W && W.active, g = Game.g, t = g.ut; if (!A || A.landed || A.prelaunch) return;
  const tv = targetVessel(W), tb = !tv && W.target ? BODY[W.target] : null;
  const el = elFromState(A.r, A.v, A.body.mu, t);
  if (el.e >= 1) { ui.toast('Сначала выйдите на замкнутую орбиту', 'bad'); return; }
  const done = (nd, tgt, want, what) => {
    if (!nd) { ui.toast('Не удалось построить перелёт', 'bad'); return; }
    A.nodes = [{ t: nd.t, dv: nd.dv.slice() }];
    W.selNode = A.nodes.length - 1; computeTraj();
    ui.toast(`${what}: уточняю…`, '', 2500);
    refineNode(A, tgt, want, Game.g.ut, (best) => {
      computeTraj();
      const msg = tgt.vessel ? `сближение ${fmtDist(best.d)}` : best.enc ? `встреча, перицентр ${fmtDist(best.pe)}` : `промах ${fmtDist(best.d)}`;
      ui.toast(`${what}: ${msg}. Δv ${V.len(A.nodes[A.nodes.length - 1].dv).toFixed(0)} м/с`, best.enc || tgt.vessel ? 'good' : 'bad', 5000);
    });
  };
  if (tv) {
    if (tv.body !== A.body) { ui.toast('Цель в другой сфере влияния', 'bad'); return; }
    done(hohmannNode(A, { vessel: tv }, t), { vessel: tv }, 0, 'Перелёт к ' + tv.name);
  } else if (tb && tb.parent === A.body) {
    done(hohmannNode(A, { body: tb }, t), { body: tb }, aimPe(tb), 'Перелёт к ' + tb.name);
  } else if (tb && A.body.parent && tb.parent === A.body.parent) {
    ui.toast('Ищу лучшее окно перелёта…', '', 2500);
    porkchop(A.body, tb, t + 3600, { nx: 70, ny: 45 }, (G) => {
      if (!G.best) { ui.toast('Окно не найдено', 'bad'); return; }
      const tr = transferAt(G, G.best.td, G.best.tof);
      done(ejectionNode(A, tr.vinf, G.best.td, Game.g.ut), { body: tb }, aimPe(tb), `Окно через ${fmtDur(G.best.td - Game.g.ut, true)} → ${tb.name}`);
    });
  } else ui.toast('Автоперелёт: цель должна вращаться вокруг того же тела, что и вы, или вокруг его родителя', 'bad', 4000);
};
Game.refineTransfer = function () {
  const W = Game.world, A = W && W.active; if (!A || !A.nodes || !A.nodes.length) { ui.toast('Нет манёвра', 'bad'); return; }
  const tv = targetVessel(W), tb = !tv && W.target ? BODY[W.target] : null;
  if (!tv && !tb) { ui.toast('Выберите цель', 'bad'); return; }
  ui.toast('Уточняю манёвр…', '', 2000);
  refineNode(A, tv ? { vessel: tv } : { body: tb }, tb ? aimPe(tb) : 0, Game.g.ut, (best) => {
    computeTraj();
    ui.toast(tv ? `Сближение ${fmtDist(best.d)}` : best.enc ? `Встреча, перицентр ${fmtDist(best.pe)}` : `Промах ${fmtDist(best.d)}`, best.enc || tv ? 'good' : 'bad', 4000);
  });
};
Game.matchVelocity = function () {
  const W = Game.world, A = W && W.active, tv = targetVessel(W); if (!A || !tv) return;
  const nd = matchVelocityNode(A, tv, Game.g.ut);
  if (!nd) { ui.toast('Нет точки сближения впереди', 'bad'); return; }
  A.nodes = A.nodes || []; A.nodes.push({ t: nd.t, dv: nd.dv }); A.nodes.sort((a, b) => a.t - b.t);
  W.selNode = A.nodes.findIndex(x => x.t === nd.t); computeTraj();
  ui.toast(`Уравнять скорость: ${V.len(nd.dv).toFixed(1)} м/с через ${fmtDur(nd.t - Game.g.ut, true)}`, 'good', 3500);
};

// ---------------------------------------------------------------- maneuver nodes
Game.addNodeAt = function (t) {
  const W = Game.world, A = W.active;
  if (!A) return;
  A.nodes = A.nodes || [];
  if (A.nodes.length >= 4) { ui.toast('Не больше 4 манёвров', '', 1500); return; }
  A.nodes.push({ t, dv: [0, 0, 0] });
  A.nodes.sort((a, b) => a.t - b.t);
  W.selNode = A.nodes.findIndex(n => n.t === t);
  computeTraj();
};
Game.nodeEdit = function (m, d) {
  const W = Game.world, A = W.active;
  const nd = A && A.nodes && A.nodes[W.selNode];
  if (!nd) return;
  const step = Game.nodeStep;
  if (m === 'pro') nd.dv[0] += step * d;
  else if (m === 'nrm') nd.dv[1] += step * d;
  else if (m === 'rad') nd.dv[2] += step * d;
  else if (m === 't') nd.t = Math.max(Game.g.ut + 1, nd.t + d);
  else if (m === 'orb') { const el = elFromState(A.r, A.v, A.body.mu, Game.g.ut); if (el.e < 1) nd.t += el.T * d; }
  else if (m === 'del') { A.nodes.splice(W.selNode, 1); W.selNode = -1; ui.mnv(null, null); computeTraj(); return; }
  else if (m === 'warp') {
    const info = nodeInfo(A);
    W.warpTo = nd.t - (info && info.burn ? info.burn / 2 : 0) - 20;
    if (W.warpTo <= Game.g.ut) { W.warpTo = null; ui.toast('Манёвр уже близко', '', 1500); }
    return;
  }
  nd.vTarget = null; nd.dvTotal = null;
  computeTraj();
};
Game.nodeSetDV = function (i, val) {
  const W = Game.world, A = W.active;
  const nd = A && A.nodes && A.nodes[W.selNode];
  if (!nd) return;
  nd.dv[i] = val; nd.vTarget = null; nd.dvTotal = null;
  computeTraj();
};

// ---------------------------------------------------------------- leaving flight
function vesselStable(v, t) {
  if (v.destroyed) return false;
  if (v.lock || v.landed) return true;
  const b = v.body;
  const el = elFromState(v.r, v.v, b.mu, t);
  const floor = b.R + (b.atm ? b.atm.top : 0);
  if (V.len(v.r) < floor) return false;
  return true;
}
function persistWorld() {
  const W = Game.world, g = Game.g, t = g.ut;
  if (!W) return;
  const keep = [];
  for (const v of W.vessels) {
    if (v.destroyed || v.debris) continue;
    if (v.prelaunch) { recoverVessel(g, v); continue; }
    if (!vesselStable(v, t)) { loseCrew(v.parts); continue; }
    keep.push(serializeVessel(v));
  }
  g.vessels = keep;
  g.activeVesselId = null;
}
Game.leaveFlight = function (force) {
  const W = Game.world; if (!W) { Game.toKSC(); return; }
  const A = W.active, t = Game.g.ut;
  const go = () => { persistWorld(); Game.autosave(); Game.toKSC(); };
  if (force || !A || A.destroyed || A.prelaunch) { go(); return; }
  if (A.landed && A.body.id === 'earth') {
    ui.modal('Аппарат на Земле', 'Вернуть его в ЦУП (наука и часть стоимости) или оставить на месте?', [
      { label: 'Вернуть', cls: 'acc', onClick: () => Game.recover() }, { label: 'Оставить', onClick: go }, { label: 'Отмена' }]);
    return;
  }
  if (!vesselStable(A, t)) {
    ui.modal('Аппарат в полёте', 'Он находится в атмосфере или на суборбитальной траектории и будет потерян. Выйти?', [
      { label: 'Выйти', cls: 'danger', onClick: go }, { label: 'Отмена' }]);
    return;
  }
  go();
};
Game.recover = function () {
  const W = Game.world, A = W && W.active, g = Game.g;
  if (!A) return;
  const r = recoverVessel(g, A);
  A.destroyed = true;
  showRecovery(r, A.name);
  persistWorld(); Game.autosave(); Game.toKSC();
};
function showRecovery(r, name) {
  const g = Game.g;
  ui.modal('Аппарат возвращён', `<p><b>${esc(name)}</b></p>
    ${isCareer(g) ? `<p>Возмещение: <b class="accent">${fmtMoney(r.funds)}</b> (${Math.round(r.factor * 100)}% стоимости)</p>` : ''}
    <p>Наука: <b style="color:#7fd0ff">+${r.sci.toFixed(1)}</b></p>
    ${r.items.map(([n, x]) => `<div class="dim">${esc(n)} — ${x.toFixed(1)}</div>`).join('')}
    ${r.milestones.map(m => `<div class="accent">Достижение: ${esc(m.title)}</div>`).join('')}
    ${(r.crew || []).map(([n, x]) => `<div>${esc(n)}: опыт +${x.gain.toFixed(1)}${x.up ? ' <span class="accent">— новый уровень!</span>' : ''}</div>`).join('')}`);
}
Game.revert = function (kind) {
  const W = Game.world; if (!W || !W.launch) return;
  const L = W.launch;
  Game.g = JSON.parse(L.snapshot);
  Game.g._notify = (m) => ui.toast(m, 'acc', 5000);
  Game.leaveWorld();
  if (kind === 'launch') Game.launch(L.design);
  else Game.openVAB(L.design);
};

// ================================================================ tracking station
Game.openTracking = function () {
  Game.leaveWorld();
  const W = Game.world = makeWorld();
  W.map = true;
  Game.screen = 'track';
  mapSetVisible(true);
  MAP.focus = { kind: 'body', id: 'earth' };
  MAP.dist = BODY.earth.R * 40;
  ui.track();
};
function trackFrame(dt) {
  const W = Game.world, g = Game.g; if (!W) return;
  if (W.warp > 0) {
    const t0 = g.ut;
    let t1 = t0 + dt * Game.warpLevels[W.warp];
    if (W.warpTo != null) { t1 = Math.min(t1, W.warpTo); if (t1 >= W.warpTo) { W.warp = 0; W.warpTo = null; } }
    t1 = alarmClamp(W, t0, t1);
    for (const v of W.vessels) if (!v.destroyed) { if (!v.rails) enterRails(v, t0); const r = railsAdvance(v, t0, t1); if (r.event === 'impact') v.destroyed = true; if (SCIFI.on) produceExotic(v, t1 - t0); }
    scanAll(W.vessels, t0, t1);
    g.ut = t1;
  }
  const now = performance.now();
  const sel = W.vessels.find(v => v.id === W.trackSel);
  if (sel && (now - (W.trajT || 0) > 300)) { W.trajT = now; W.traj = sel.landed ? null : predictTrajectory(sel.body, sel.r, sel.v, g.ut, { nodes: sel.nodes || [], maxPatches: 6 }); }
  if (!sel) W.traj = null;
  const mc = mapCameraAbs(g.ut, sel);
  renderWorld(g.ut, mc.abs, mapCameraQuat(mc.look), { map: true, near: Math.max(1, MAP.dist * 1e-4), far: Math.max(1e14, MAP.dist * 1e4) });
  for (const vw of W.views.values()) vw.group.visible = false;
  FX.list.length = 0; fxUpdate(0);
  mapUpdate(g.ut, sel, W.traj, {
    focusBody: (id) => { MAP.focus = { kind: 'body', id }; MAP.dist = Math.max(BODY[id].R * 4, Math.min(MAP.dist, BODY[id].soi * 2 || 1e12)); },
    focusVessel: () => { MAP.focus = { kind: 'vessel' }; }, selectNode: () => {},
  });
  drawFrame();
  if (now - (W.listT || 0) > 600) {
    W.listT = now;
    for (const c of crewAgeTick(g, W.vessels, g.ut)) ui.toast(`Смерть от старости в полёте: ${esc(c.name)}, ${fmtYears(crewAge(c))}`, 'bad', 6000);
    ui.trackList(); Game.raceNews();
    const wr = $('#t-wr'); if (wr) wr.textContent = '×' + Game.warpRate().toLocaleString('ru-RU') + ' · ' + fmtDate(g.ut);
  }
}
Game.trackSelect = function (id) {
  const W = Game.world; W.trackSel = id;
  const v = W.vessels.find(x => x.id === id);
  if (v) { MAP.focus = { kind: 'vessel' }; MAP.dist = Math.max(v.body.R * 3, V.len(v.r) * 2.5); }
  W.trajT = 0; ui.trackList();
};
Game.flyVessel = function (id) {
  const W = Game.world;
  const v = W.vessels.find(x => x.id === id);
  if (!v) return;
  W.warp = 0; W.active = v; W.launch = null;
  v.loaded = false; v.rails = v.rails || null;
  W.cam.dist = Math.max(10, vesselBounds(v).size * 1.6 + 6);
  if (v.rails) { v.rails = null; if (v.lock) applyLock(v, Game.g.ut); }
  enterFlight();
  recStart(W, v.name);
};
Game.recoverTracked = function (id) {
  const W = Game.world, v = W.vessels.find(x => x.id === id);
  if (!v) return;
  const r = recoverVessel(Game.g, v);
  v.destroyed = true;
  W.vessels = W.vessels.filter(x => x !== v);
  showRecovery(r, v.name);
  persistWorld(); Game.autosave(); ui.trackList();
};
Game.terminate = function (id) {
  const W = Game.world;
  const tv = W.vessels.find(x => x.id === id); if (tv) loseCrew(tv.parts);
  W.vessels = W.vessels.filter(x => x.id !== id);
  W.trackSel = null;
  persistWorld(); Game.autosave(); ui.trackList();
};

// ================================================================ saves
Game.saveTo = function (slot, label) {
  const W = Game.world, g = Game.g;
  if (Game.screen === 'flight' && W) {
    g.vessels = W.vessels.filter(v => !v.destroyed && !v.debris).map(serializeVessel);
    g.activeVesselId = W.active && !W.active.destroyed ? W.active.id : null;
  }
  const ok = saveSlot(slot, g, label);
  ui.toast(ok ? 'Игра сохранена' : 'Не удалось сохранить (хранилище браузера недоступно)', ok ? 'good' : 'bad', 2000);
};
Game.autosave = function () { if (Game.g && Game.screen !== 'flight') saveSlot('auto', Game.g, 'авто'); };
Game.quickSave = function () { if (Game.g) Game.saveTo('quick', 'быстрое'); };
Game.quickLoad = function () { const s = loadSlot('quick'); if (!s) { ui.toast('Нет быстрого сохранения', 'bad'); return; } Game.loadSlot('quick'); };
Game.loadSlot = function (slot) {
  const g = loadSlot(slot);
  if (!g) { ui.toast('Сохранение повреждено или устарело', 'bad'); return; }
  Game.applyLoaded(g);
};
Game.applyLoaded = function (g) {
  Game.leaveWorld();
  initCrew(g); g.builds = g.builds || [];      // saves (or imported files) from before the corps / build queue
  setSciFi(g.scifi);
  Game.g = g;
  g._notify = (m) => ui.toast(m, 'acc', 5000);
  if (g.activeVesselId && g.vessels.some(s => s.id === g.activeVesselId)) {
    const W = Game.world = makeWorld();
    const A = W.vessels.find(v => v.id === g.activeVesselId);
    W.active = A;
    A.rails = null; if (A.lock) applyLock(A, g.ut);
    W.cam.dist = Math.max(10, vesselBounds(A).size * 1.6 + 6);
    enterFlight();
    ui.toast('Загружено', 'good', 1500);
  } else { Game.toKSC(); ui.toast('Загружено', 'good', 1500); }
};
Game.exportFile = function () {
  const W = Game.world, g = Game.g;
  if (!g) return;
  if (Game.screen === 'flight' && W) { g.vessels = W.vessels.filter(v => !v.destroyed && !v.debris).map(serializeVessel); g.activeVesselId = W.active ? W.active.id : null; }
  const blob = new Blob([JSON.stringify(gameToJSON(g))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orbita_${(g.name || 'save').replace(/\s+/g, '_')}_${Math.floor(g.ut / DAY)}d.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
Game.importFile = function () {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    f.text().then(txt => {
      try { const g = JSON.parse(txt); if (g.v !== SAVE_VERSION || !g.mode) throw new Error('формат'); Game.applyLoaded(g); }
      catch (e) { ui.toast('Не удалось прочитать файл: ' + esc(e.message), 'bad'); }
    });
  };
  inp.click();
};

// ================================================================ input
function setupInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const first = !Game.keys[e.code];
    Game.keys[e.code] = true;
    if (['F5', 'F9', 'Tab', 'Space', 'F1', 'Slash'].includes(e.code)) e.preventDefault();
    if (e.code === 'F1') { ui.help(); return; }
    if (!first) return;
    if (Game.screen === 'flight') flightKey(e);
    else if (Game.screen === 'track') { if (e.code === 'Period') Game.warpUp(); if (e.code === 'Comma') Game.warpDown(); if (e.code === 'Slash') Game.stopWarp(); if (e.code === 'Escape') Game.toKSC(); }
    else if (Game.screen === 'vab') vabKey(e);
    else if (Game.screen === 'replay') {
      if (e.code === 'Escape') { if (RPL.recorder) { Game.stopVideo(); ui.replayHud(null, null, true); } else Game.closeReplay(); }
      if (e.code === 'Space') RPL.playing = !RPL.playing;
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { const D = REC.data; RPL.t = clamp(RPL.t + (e.code === 'ArrowRight' ? 10 : -10) * Math.max(1, RPL.speed), D.frames[0].t, D.frames[D.frames.length - 1].t); }
    }
    else if (Game.screen === 'ksc' || Game.screen === 'rnd' || Game.screen === 'mc') { if (e.code === 'Escape' && Game.screen !== 'ksc') Game.toKSC(); }
  });
  window.addEventListener('keyup', (e) => { Game.keys[e.code] = false; });
  window.addEventListener('blur', () => { Game.keys = {}; });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    Game.mouse = { down: true, x: e.clientX, y: e.clientY, moved: 0, btn: e.button };
    if (Game.screen === 'vab' && e.button === 0) vabDragStart(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => {
    const M = Game.mouse;
    if (Game.screen === 'vab') {
      if (VAB.drag) { vabDragMove(e.clientX, e.clientY); M.moved += 5; return; }
      if (!M.down) { const pal = e.target.closest && e.target.closest('#vab .pal'); vabMouseMove(e.clientX, e.clientY, !!pal && !!VAB.held); }
    }
    if (!M.down) return;
    const dx = e.clientX - M.x, dy = e.clientY - M.y;
    M.x = e.clientX; M.y = e.clientY; M.moved += Math.abs(dx) + Math.abs(dy);
    if (M.moved < 4) return;
    if (Game.screen === 'vab') {
      if (M.btn === 2) VAB.camY = clamp(VAB.camY - dy * VAB.dist * 0.002, 0.5, Math.max(4, VAB.height + 4));
      else { VAB.yaw += dx * 0.006; VAB.pitch = clamp(VAB.pitch + dy * 0.004, -0.4, 1.3); }
    } else if (Game.screen === 'replay') {
      RPL.orbit.yaw -= dx * 0.005; RPL.orbit.pitch = clamp(RPL.orbit.pitch + dy * 0.004, -1.45, 1.45);
      if (RPL.cam === 'auto') { RPL.cam = 'chase'; ui.replayHud(null, null, true); }
    } else if (Game.world && (Game.world.map || Game.screen === 'track')) {
      MAP.yaw -= dx * 0.005; MAP.pitch = clamp(MAP.pitch + dy * 0.005, -1.5, 1.5);
    } else if (Game.world) {
      const c = Game.world.cam;
      c.yaw -= dx * 0.005; c.pitch = clamp(c.pitch + dy * 0.004, -1.45, 1.45);
    }
  });
  window.addEventListener('mouseup', (e) => {
    const M = Game.mouse;
    if (VAB.drag) { vabDragEnd(); M.down = false; if (M.moved < 4) vabClick(e.clientX, e.clientY, e.shiftKey, e.altKey); return; }
    if (!M.down) return;
    M.down = false;
    if (M.moved >= 4) return;
    if (Game.screen === 'vab') {
      if (M.btn === 2) vabCancelHeld();
      else if (e.target === canvas) vabClick(e.clientX, e.clientY, e.shiftKey, e.altKey);
    } else if (Game.screen === 'flight' && Game.world && Game.world.map && e.target === canvas && M.btn === 0) {
      const pk = mapPick(e.clientX, e.clientY, 14);
      if (pk && pk.t > Game.g.ut + 1) Game.addNodeAt(pk.t);
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.pow(1.0015, e.deltaY);
    if (Game.screen === 'replay') { RPL.orbit.dist = clamp(RPL.orbit.dist * f, 3, 30000); return; }
    if (Game.screen === 'vab') {
      if (e.shiftKey) VAB.camY = clamp(VAB.camY - e.deltaY * 0.01, 0.5, Math.max(4, VAB.height + 4));
      else VAB.dist = clamp(VAB.dist * f, 3, 200);
    } else if (Game.world && (Game.world.map || Game.screen === 'track')) {
      const fb = mapFocusBody(Game.world.active);
      MAP.dist = clamp(MAP.dist * f, (fb ? fb.R : 1e3) * 1.3, 2e17);
    } else if (Game.world) {
      Game.world.cam.dist = clamp(Game.world.cam.dist * f, 3, 30000);
    }
  }, { passive: false });
}

function flightKey(e) {
  const W = Game.world; if (!W) return;
  const A = W.active;
  switch (e.code) {
    case 'Space': if (A && isKerbalVessel(A)) Game._evaJump = true; else Game.stage(); break;
    case 'KeyT': Game.toggleSAS(); break;
    case 'KeyR': if (A && isKerbalVessel(A)) { A.evaJet = !A.evaJet; ui.toast(A.evaJet ? 'Ранец включён' : 'Ранец выключен', '', 1200); } else Game.toggleRCS(); break;
    case 'KeyB': if (A && isKerbalVessel(A)) Game.board(); break;
    case 'KeyF': if (A && isKerbalVessel(A)) Game.plantFlag(); break;
    case 'KeyG': Game.toggleLegs(); break;
    case 'KeyU': Game.toggleLights(); break;
    case 'KeyV': if (SCIFI.on) Game.toggleWarpDrive(); break;
    case 'KeyM': Game.toggleMap(); break;
    case 'KeyZ': if (A) A.throttle = 1; break;
    case 'KeyX': if (A) A.throttle = 0; break;
    case 'Period': Game.warpUp(e.altKey); break;
    case 'Comma': Game.warpDown(); break;
    case 'Slash': Game.stopWarp(); break;
    case 'CapsLock': Game.precise = !Game.precise; break;
    case 'BracketLeft': Game.switchVessel(-1); break;
    case 'BracketRight': Game.switchVessel(1); break;
    case 'F5': Game.quickSave(); break;
    case 'F9': Game.quickLoad(); break;
    case 'Escape': if ($('#modal')) ui.closeModal(); else if (W.map) Game.toggleMap(); else ui.pause(); break;
    case 'Tab':
      if (W.map) {
        const ids = ['vessel', ...BODIES.map(b => b.id)];
        const cur = MAP.focus.kind === 'vessel' ? 'vessel' : MAP.focus.id;
        const nx = ids[(ids.indexOf(cur) + 1) % ids.length];
        MAP.focus = nx === 'vessel' ? { kind: 'vessel' } : { kind: 'body', id: nx };
        if (nx !== 'vessel') MAP.dist = BODY[nx].R * 6;
      }
      break;
    case 'Delete': if (W.map && A && A.nodes && W.selNode >= 0) Game.nodeEdit('del'); break;
  }
}

function vabKey(e) {
  if (e.code === 'KeyX' && !e.ctrlKey && !e.metaKey) vabCycleSym();
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); vabDiscardHeld(); }
  if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) vabRedo(); else vabUndo(); }
  if (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); vabRedo(); }
  if (e.code === 'Escape') vabCancelHeld();
}

window.addEventListener('DOMContentLoaded', boot);
