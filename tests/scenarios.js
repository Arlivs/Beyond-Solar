const wait = (p, ms) => p.waitForTimeout(ms);
module.exports = {
  async menu(p, shot) { await p.evaluate(() => { for (const id in RV.bodies) { const r = RV.bodies[id]; if (r.b.terrain) while (r.displaced < 2) displaceBody(r, 1e9); } }); await wait(p, 1500); await shot('menu'); },
  async ksc(p, shot) {
    await p.evaluate(() => Game.newGame('sandbox')); await wait(p, 2000); await shot('ksc');
  },
  async vab(p, shot) {
    await p.evaluate(() => { Game.newGame('sandbox'); Game.openVAB(stockDesigns()[3]); }); await wait(p, 1500); await shot('vab');
  },
  async pad(p, shot) {
    await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns()[2]); }); await wait(p, 2500); await shot('pad');
  },
};
// Full scripted flight inside the page: ascent -> orbit -> map/node -> warp -> deorbit -> landing.
module.exports.flight = async (p, shot) => {
  await p.evaluate(() => {
    Game.newGame('sandbox');
    Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1'));
    const W = Game.world, A = W.active;
    A.throttle = 1; A.sas = true; A.sasMode = 'target';
    Game.stage();
    window.__ap = { phase: 'ascent', log: [] };
    const E = BODY.earth;
    window.__apTick = setInterval(() => {
      const W = Game.world; if (!W) return; const A = W.active; const ap = window.__ap;
      if (!A || A.destroyed) { ap.phase = 'dead'; return; }
      const up = V.norm(A.r), east = V.norm(V.cross([0, 0, 1], up));
      const alt = V.len(A.r) - E.R;
      const el = elFromState(A.r, A.v, E.mu, Game.g.ut);
      const running = A.parts.some(q => !q.dead && q.st.eng && q.st.eng.on && !q.st.eng.out);
      if (ap.phase === 'ascent') {
        const k = Math.min(1, Math.max(0, (alt - 800) / 45000)), elev = (90 - 88 * Math.pow(k, 0.55)) * Math.PI / 180;
        A.targetDir = V.add(V.scale(up, Math.sin(elev)), V.scale(east, Math.cos(elev)));
        if (!running && A.stageIdx < A.stages.length) Game.stage();
        if (el.ra - E.R > 82000) { A.throttle = 0; ap.phase = 'coast'; ap.log.push('coast at ' + Game.g.ut.toFixed(0)); }
      } else if (ap.phase === 'coast') {
        A.sasMode = 'pro';
        const tAp = elTimeAtNu(el, Math.PI, Game.g.ut) - Game.g.ut;
        if (alt > 70500 && tAp < 30) { A.throttle = 1; ap.phase = 'circ'; Game.stopWarp(); }
        else if (alt > 70500 && Game.world.warp < 2 && tAp > 90) Game.world.warp = 2;
      } else if (ap.phase === 'circ') {
        A.sasMode = 'pro';
        if (!running && A.stageIdx < A.stages.length) Game.stage();
        if (el.rp - E.R > 74000) { A.throttle = 0; ap.phase = 'orbit'; ap.log.push(`orbit Ap ${(el.ra - E.R) / 1e3 | 0} Pe ${(el.rp - E.R) / 1e3 | 0} t=${Game.g.ut | 0}`); }
      }
    }, 50);
  });
  await wait(p, 4000); await shot('f_liftoff');
  await p.evaluate(() => { Game.world.physWarp = 3; });
  await wait(p, 12000); await shot('f_ascent');
  // let it reach orbit (poll)
  for (let i = 0; i < 90; i++) {
    const ph = await p.evaluate(() => window.__ap.phase + ' ' + (V.len(Game.world.active.r) - BODY.earth.R).toFixed(0) + ' ut=' + Game.g.ut.toFixed(0) + ' fps');
    if (i % 10 === 0) console.log(ph);
    if (ph.startsWith('orbit') || ph.startsWith('dead')) break;
    await wait(p, 2000);
  }
  console.log(await p.evaluate(() => JSON.stringify(window.__ap.log)));
  await shot('f_orbit');
  await p.evaluate(() => Game.toggleMap()); await wait(p, 1500); await shot('f_map');
  // add a node half an orbit ahead with +300 prograde and check trajectory
  const nd = await p.evaluate(() => {
    const A = Game.world.active; const el = elFromState(A.r, A.v, A.body.mu, Game.g.ut);
    Game.addNodeAt(Game.g.ut + el.T * 0.3); Game.nodeStep = 100; Game.nodeEdit('pro', 1); Game.nodeEdit('pro', 1); Game.nodeEdit('pro', 1);
    const tr = Game.world.traj; return tr.map(x => x.body.id + ':' + x.end).join(' ');
  });
  console.log('traj with node:', nd);
  await wait(p, 1200); await shot('f_node');
  await p.evaluate(() => { Game.nodeEdit('del'); Game.toggleMap(); Game.world.warp = 5; });
  await wait(p, 3000);
  console.log(await p.evaluate(() => 'after warp ut=' + Game.g.ut.toFixed(0) + ' sit=' + situationText(Game.world.active, Game.g.ut)));
  await p.evaluate(() => Game.stopWarp());
  await wait(p, 1000); await shot('f_orbit2');
};
module.exports.career = async (p, shot) => {
  const out = await p.evaluate(() => {
    const L = [];
    Game.newGame('career');
    const g = Game.g;
    L.push(`start funds ${g.funds} sci ${g.science} offers ${g.contracts.offered.map(c => c.type).join(',')}`);
    for (const c of [...g.contracts.offered]) if (c.type === 'alt' || c.type === 'science') acceptContract(g, c.id);
    L.push(`accepted ${g.contracts.active.map(c => c.title).join(' | ')}, funds ${g.funds}`);
    const hop = stockDesigns().filter(d => designAllowed(g, d));
    L.push('allowed stock: ' + hop.map(d => d.name).join(','));
    Game.launch(hop[0]);
    const A = Game.world.active;
    const pod = A.parts.find(p => PART[p.id].command);
    let r = runExperiment(g, A, pod, 'crew'); L.push('crew report on pad: ' + (r.error || r.value.toFixed(2)));
    A.sas = true; A.sasMode = 'stab'; Game.stage();
    AP.step(60);
    L.push(`after burn alt ${AP.alt() | 0} sit ${sciSituation(A)}`);
    r = runExperiment(g, A, pod, 'crew'); L.push('crew report flying: ' + (r.error || r.value.toFixed(2)));
    // fall with chutes
    let k = 0; while (!A.landed && !A.destroyed && k++ < 4000) AP.step(1, () => { if (A.stageIdx < A.stages.length && V.dot(A.v, V.norm(A.r)) < 0) Game.stage(); });
    L.push(`landed=${A.landed} destroyed=${A.destroyed} maxAlt ${A.maxAlt | 0}`);
    const before = g.science;
    Game.recover();
    L.push(`recovered: sci +${(g.science - before).toFixed(2)} funds ${g.funds | 0}, milestones ${Object.keys(g.milestones).join(',')}, done contracts ${g.contracts.done.length}`);
    L.push('screen ' + Game.screen + ' vessels ' + g.vessels.length);
    const t = TECH.find(t => techAvailable(g, t) && t.cost <= g.science);
    L.push('research ' + (t ? t.id + ' ' + researchTech(g, t.id) : 'none affordable') + ' techs ' + g.techs.join(','));
    ui.closeModal();
    return L.join('\n');
  });
  console.log(out);
  await shot('career_ksc');
  await p.evaluate(() => Game.openScreen('rnd')); await wait(p, 600); await shot('rnd');
  await p.evaluate(() => Game.openScreen('mc')); await wait(p, 600); await shot('mc');
};
module.exports.orbit = async (p, shot) => {
  const out = await p.evaluate(() => {
    const L = [];
    Game.newGame('sandbox');
    Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1'));
    L.push(AP.toOrbit(80000));
    L.push('log ' + AP.log.join(','));
    L.push(AP.deorbitAndLand(30000));
    const A = AP.A();
    L.push('situation ' + situationText(A, Game.g.ut));
    return L.join('\n');
  });
  console.log(out);
  await wait(p, 1500); await shot('o_landed');
};
module.exports.moon = async (p, shot) => {
  const out = await p.evaluate(() => {
    const L = [];
    Game.newGame('sandbox');
    Game.launch(stockDesigns().find(d => d.name === 'Лунник'));
    const A = AP.A(), E = BODY.earth, M = BODY.moon;
    // teleport to a 100 km circular orbit and shed the launch stages (ascent is covered by the orbit test)
    unlock(A); A.prelaunch = false; A.prelaunchHold = false;
    const rr = E.R + 100000; A.r = [rr, 0, 0]; A.v = [0, Math.sqrt(E.mu / rr), 0];
    Game.stage(); Game.stage(); Game.stage();
    for (const q of A.parts) if (!q.dead && q.st.eng) q.st.eng.on = false;
    updateLoaded();
    L.push(`in orbit, stage ${A.stageIdx}/${A.stages.length}, mass ${(massProps(A).m / 1000).toFixed(2)} t, vessels ${Game.world.vessels.length}`);
    // find a departure time on the current orbit that gives a Moon encounter with ~1000 m/s prograde
    const el = AP.el();
    let found = null;
    for (let dv = 900; dv < 970 && !found; dv += 4) {
      for (let f = 0.02; f < 1; f += 0.01) {
        const t = Game.g.ut + el.T * f;
        const tr = predictTrajectory(E, A.r, A.v, Game.g.ut, { nodes: [{ t, dv: [dv, 0, 0] }], maxPatches: 4 });
        if (tr.some(x => x.body === M)) { found = { t, dv }; break; }
      }
    }
    if (!found) return L.concat('no encounter found').join('\n');
    Game.addNodeAt(found.t); Game.world.selNode = 0; A.nodes[0].dv = [found.dv, 0, 0]; A.nodes[0].vTarget = null; computeTraj();
    L.push(`node at +${(found.t - Game.g.ut) | 0}s dv ${found.dv}, traj ${Game.world.traj.map(x => x.body.id + ':' + x.end).join(' ')}`);
    Game.nodeEdit('warp', 0);
    let g = 0; while (Game.world.warpTo != null && g++ < 5000) AP.step(1);
    L.push(`warped to ut ${Game.g.ut | 0}, node in ${(A.nodes[0].t - Game.g.ut) | 0}s, burn ${A.nodes[0].dvTotal.toFixed(0)}`);
    A.sas = true; A.sasMode = 'node'; AP.step(60);
    g = 0;
    while (A.nodes.length && g++ < 4000) AP.step(1, () => { const n = A.nodes[0]; if (!n) return; const fwd = Q.rot(A.q, [0, 1, 0]); A.throttle = (A.nodeBurn && V.dot(fwd, V.norm(A.nodeBurn)) > 0.97) ? (n.dvTotal > 30 ? 1 : 0.15) : 0; if (!AP.running() && A.throttle > 0 && A.stageIdx < A.stages.length - 2) Game.stage(); });
    A.throttle = 0;
    computeTraj();
    { const e2 = AP.el(); L.push(`after burn: Ap ${(e2.ra - E.R) / 1e3 | 0} km (Moon at ${M.el.a / 1e3 | 0}), traj ${Game.world.traj.map(x => x.body.id + ':' + x.end).join(' ')} stage ${A.stageIdx}`); }
    // warp until SOI change
    Game.world.warp = 6; g = 0;
    while (A.body === E && g++ < 20000) AP.step(1, () => { if (Game.world.warp === 0 && A.body === E) Game.world.warp = 6; });
    L.push(`now in SOI ${A.body.id} at ut ${Game.g.ut | 0}, alt ${(AP.alt() / 1e3) | 0} km`);
    const em = AP.el();
    L.push(`moon orbit: e ${em.e.toFixed(3)} Pe ${((em.rp - M.R) / 1e3).toFixed(0)} km; milestones ${Object.keys(Game.g.milestones).join(',')}`);
    return L.join('\n');
  });
  console.log(out);
  await p.evaluate(() => Game.toggleMap()); await wait(p, 2000); await shot('moon_map');
};
// drive the VAB with real mouse events like a player
module.exports.vabmouse = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.openVAB({ name: 'Тест', stack: [], stages: [] }); });
  await wait(p, 800);
  const card = async (name) => { await p.click(`.pcard:has-text("${name}")`); await wait(p, 150); };
  const tab = async (name) => { await p.click(`#v-tabs button:has-text("${name}")`); await wait(p, 150); };
  const nodeAt = async (i) => p.evaluate((i) => { const n = vabStackNodes()[i]; const s = vabScreen(n.pos); return s; }, i);
  const clickAt = async (xy) => { await p.mouse.move(xy[0], xy[1]); await wait(p, 120); await p.mouse.down(); await p.mouse.up(); await wait(p, 250); };
  // pod
  await tab('Командные'); await card('Капсула К-1'); await clickAt(await nodeAt(0));
  // tank below the pod (node index: last stack bottom)
  await tab('Баки'); await card('Бак Т1-800');
  let nodes = await p.evaluate(() => vabStackNodes().length);
  await clickAt(await nodeAt(nodes - 1));
  await card('Бак Т1-800'); nodes = await p.evaluate(() => vabStackNodes().length); await clickAt(await nodeAt(nodes - 1));
  await tab('Двигатели'); await card('ЖРД «Шарнир»'); nodes = await p.evaluate(() => vabStackNodes().length); await clickAt(await nodeAt(nodes - 1));
  // parachute on top
  await tab('Оборудование'); await card('Парашют П-16'); await clickAt(await nodeAt(0));
  // fins x4 radially on the lowest tank: aim at the tank's surface
  await tab('Аэродинамика'); await p.click('#v-sym button:has-text("×4")'); await card('Стабилизатор');
  const tankXY = await p.evaluate(() => { const it = VAB.layout.filter(x => x.role === 'stack' && x.id === 'tank_t1xl').pop(); return vabScreen([it.pos[0] + 0.62, it.pos[1] - 1.2, it.pos[2]]); });
  await clickAt(tankXY);
  // radial boosters x2: radial decoupler then SRB onto it
  await p.click('#v-sym button:has-text("×2")');
  await tab('Разделение'); await card('Радиальный расстыковщик');
  const tank2 = await p.evaluate(() => { const it = VAB.layout.filter(x => x.role === 'stack' && x.id === 'tank_t1xl')[0]; return vabScreen([it.pos[0], it.pos[1], it.pos[2] + 0.62]); });
  await clickAt(tank2);
  await tab('Двигатели'); await card('РДТТ «Молот»');
  const colNode = await p.evaluate(() => { const i = vabStackNodes().findIndex(n => n.act.type === 'col'); return i; });
  if (colNode >= 0) await clickAt(await nodeAt(colNode));
  const res = await p.evaluate(() => ({ parts: VAB.layout.map(x => x.id + (x.role !== 'stack' ? '(' + x.role + ')' : '')).join(', '), stages: VAB.design.stages.map(s => s.map(u => VAB.layout.find(x => x.uid === u).id).join('+')).join(' | ') }));
  console.log('parts:', res.parts); console.log('stages:', res.stages);
  await wait(p, 500); await shot('vabmouse');
  // undo works
  await p.keyboard.press('Control+z'); await wait(p, 300);
  console.log('after undo parts:', await p.evaluate(() => VAB.layout.length));
  await p.click('#v-launch'); await wait(p, 2500); await shot('vabmouse_pad');
  console.log('screen:', await p.evaluate(() => Game.screen + ' ' + Game.world.active.parts.length));
};
module.exports.saves = async (p, shot) => {
  const out = await p.evaluate(() => {
    const L = [];
    Game.newGame('career');
    Game.g.techs = TECH.map(t => t.id); // give all parts for the test
    Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1'));
    L.push(AP.toOrbit(80000));
    // drop booster, keep upper stage in orbit
    const A = AP.A();
    const before = { ut: Game.g.ut, r: A.r.slice(), id: A.id, parts: A.parts.filter(q => !q.dead).length, funds: Game.g.funds };
    Game.quickSave();
    AP.step(100);
    Game.quickLoad();
    const B = Game.world.active;
    L.push(`quickload: same vessel ${B.id === before.id}, ut ${before.ut | 0} -> ${Game.g.ut | 0}, dr ${V.dist(B.r, before.r).toFixed(3)} m, parts ${B.parts.filter(q => !q.dead).length}/${before.parts}, screen ${Game.screen}`);
    // leave to KSC (vessel is in stable orbit -> persists)
    Game.leaveFlight();
    L.push(`after leave: screen ${Game.screen}, persisted vessels ${Game.g.vessels.length}`);
    // tracking station: warp a bit and fly it again
    Game.openTracking();
    Game.trackSelect(Game.world.vessels[0].id);
    Game.world.warp = 4;
    for (let i = 0; i < 30; i++) trackFrame(0.1);
    Game.world.warp = 0;
    L.push(`tracking: ut ${Game.g.ut | 0}, ${situationText(Game.world.vessels[0], Game.g.ut)}`);
    return L.join('\n');
  });
  console.log(out);
  await wait(p, 1500); await shot('track');
  const out2 = await p.evaluate(() => {
    Game.flyVessel(Game.world.vessels[0].id);
    const A = Game.world.active;
    AP.step(20);
    return `fly again: screen ${Game.screen}, ${situationText(A, Game.g.ut)}, alt ${(AP.alt() / 1e3).toFixed(1)} km`;
  });
  console.log(out2);
  await wait(p, 1500); await shot('track_fly');
  // export/import roundtrip via JSON
  const out3 = await p.evaluate(() => {
    const json = JSON.stringify(gameToJSON(Game.g));
    const g2 = JSON.parse(json);
    return `json bytes ${json.length}, vessels ${g2.vessels.length}, techs ${g2.techs.length}`;
  });
  console.log(out3);
};
module.exports.perf = async (p, shot) => {
  const out = await p.evaluate(() => {
    Game.newGame('sandbox');
    Game.launch(stockDesigns().find(d => d.name === 'Лунник'));
    const A = Game.world.active; A.throttle = 1; A.sas = true; Game.stage();
    const realDraw = drawFrame, realNav = drawNavball;
    window.drawFrame = () => {}; window.drawNavball = () => {};
    const res = {};
    const time = (label, n, fn) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); res[label] = ((performance.now() - t0) / n).toFixed(2) + ' ms'; };
    time('flightFrame 1x (cpu, 30 parts, near ground)', 60, () => flightFrame(1 / 60));
    Game.world.physWarp = 3;
    time('flightFrame 4x physics', 30, () => flightFrame(1 / 60));
    Game.world.physWarp = 0;
    Game.toggleMap();
    time('flightFrame map mode', 30, () => flightFrame(1 / 60));
    time('predictTrajectory (LEO, moon check)', 20, () => predictTrajectory(BODY.earth, [BODY.earth.R + 1e5, 0, 0], [0, 2330, 0], Game.g.ut, { maxPatches: 6 }));
    window.drawFrame = realDraw; window.drawNavball = realNav;
    return JSON.stringify(res, null, 1);
  });
  console.log(out);
};
module.exports.reentry = async (p, shot) => {
  await p.evaluate(() => {
    Game.newGame('sandbox');
    Game.launch(makeDesign('Капсула', ['chute_s', 'pod_k1', 'shield_s1']));
    const A = Game.world.active, E = BODY.earth;
    unlock(A); A.prelaunch = false; A.prelaunchHold = false;
    const r0 = E.R + 52000;
    A.r = [r0, 0, 0];
    const horiz = 2250, down = -260;
    A.v = [down, horiz + 150, 0];
    const back = V.norm(V.neg(A.v)), side = V.norm(V.cross(back, [0, 0, 1]));
    A.q = Q.fromBasis(side, back, V.cross(side, back));
    A.sas = true; A.sasMode = 'retro';
    for (const q of A.parts) if (PART[q.id].chute) q.st.chute = 'armed';
    Game.world.cam.dist = 14; Game.world.cam.pitch = 0.25; Game.world.cam.yaw = 1.2;
    AP.step(200);
  });
  await wait(p, 1500); await shot('reentry');
  const s = await p.evaluate(() => { const A = Game.world.active; return `alt ${(AP.alt() / 1e3).toFixed(1)} km, flux ${(A.heatFlux / 1e6).toFixed(2)} MW/m2, chute ${A.parts.find(q => PART[q.id].chute).st.chute}`; });
  console.log(s);
  await p.evaluate(() => { let g = 0; const A = Game.world.active; while (AP.alt() > 600 && g++ < 6000) AP.step(1); });
  await wait(p, 1500); await shot('chute');
  console.log(await p.evaluate(() => { const A = Game.world.active; return `alt ${AP.alt().toFixed(0)} m, v ${V.len(V.sub(A.v, V.cross(bodyOmega(A.body), A.r))).toFixed(1)} m/s, chute ${A.parts.find(q => PART[q.id].chute).st.chute}`; }));
};
module.exports.moonland = async (p, shot) => {
  const out = await p.evaluate(() => {
    Game.newGame('sandbox');
    const d = makeDesign('Посадочный', ['chute_s', 'pod_k1', 'shield_s1', 'dec_s1', { id: 'tank_t1l', r: [{ sym: 4, y: -0.2, part: 'legs' }] }, 'eng_terrier']);
    Game.launch(d);
    const A = Game.world.active;
    Game.toggleLegs();
    placeOnPad(A, Game.g.ut, { body: 'moon', lat: 0.05, lon: 0.9 });
    A.prelaunch = false; A.prelaunchHold = false; A.situation = 'LANDED';
    Game.world.cam.dist = 16; Game.world.cam.pitch = 0.18; Game.world.cam.yaw = 2.2;
    // hop: lift off and land again to exercise contacts on the Moon
    unlock(A); A.throttle = 0.45; A.sas = true; A.sasMode = 'stab'; A.sasHold = null; Game.stage();
    AP.step(60);
    const peak = AP.alt();
    A.throttle = 0; let g = 0;
    while (!A.landed && !A.destroyed && g++ < 3000) AP.step(1, () => { const vs = V.dot(A.v, V.norm(A.r)); A.throttle = vs < -4 ? 0.6 : 0; });
    return `hop peak ${peak.toFixed(0)} m, landed=${!!A.landed} destroyed=${!!A.destroyed} parts ${A.parts.filter(q => !q.dead).length}, ut ${Game.g.ut | 0}, milestones ${Object.keys(Game.g.milestones).join(',')}`;
  });
  console.log(out);
  await wait(p, 2000); await shot('moonland');
};
module.exports.dialogs = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('career'); });
  await wait(p, 500);
  await p.click('#k-save'); await wait(p, 300); await p.click('#s-new'); await wait(p, 300);
  await p.click('#k-vab'); await wait(p, 500);
  await p.click('#v-load'); await wait(p, 300); await shot('dlg_craft');
  await p.click('.vitem[data-src="stock"]'); await wait(p, 400);
  await p.click('#v-save'); await wait(p, 200);
  await p.click('#v-launch'); await wait(p, 1200);
  await p.keyboard.press('F1'); await wait(p, 300); await shot('dlg_help'); await p.keyboard.press('F1'); await wait(p, 200);
  await p.keyboard.press('Escape'); await wait(p, 300); await shot('dlg_pause');
  await p.click('#modal button:has-text("Загрузить")'); await wait(p, 300); await shot('dlg_load');
  await p.keyboard.press('Escape'); await wait(p, 200);
  await p.keyboard.press('Space'); await wait(p, 1500);
  await p.keyboard.down('ShiftLeft'); await wait(p, 800); await p.keyboard.up('ShiftLeft');
  await p.keyboard.press('KeyT'); await p.keyboard.down('KeyD'); await wait(p, 600); await p.keyboard.up('KeyD');
  await p.keyboard.press('KeyM'); await wait(p, 800); await p.keyboard.press('KeyM'); await wait(p, 300);
  console.log(await p.evaluate(() => { const A = Game.world.active; return `keys: launched=${A.launchUT != null} thr=${A.throttle.toFixed(2)} sas=${A.sas} alt=${(V.len(A.r) - A.body.R).toFixed(1)} crafts=${Object.keys(Game.g.crafts).join(',')} saves=${listSaves().length}`; }));
  await p.click('#h-menu'); await wait(p, 300);
  await p.click('#modal button:has-text("Вернуться в цех")'); await wait(p, 800);
  console.log('after revert to VAB:', await p.evaluate(() => Game.screen + ' funds ' + Game.g.funds));
};
module.exports.terrainbench = async (p) => {
  const out = await p.evaluate(() => {
    const r = [];
    const dirs = Array.from({ length: 3000 }, (_, i) => V.norm([Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.37)]));
    for (const id of ['earth', 'moon', 'mars']) for (const mw of [3, 200]) {
      const b = BODY[id]; let s = 0;
      for (let k = 0; k < 2; k++) { const t0 = performance.now(); for (const d of dirs) s += terrainHeight(b, d, mw); if (k) r.push(`${id} mw=${mw}: ${((performance.now() - t0) * 1000 / dirs.length).toFixed(2)} us`); }
    }
    return r.join('\n');
  });
  console.log(out);
};
module.exports.shadowdbg = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.openVAB(stockDesigns()[3]); });
  await wait(p, 2000);
  const info = await p.evaluate(() => {
    const k = VAB.key;
    let casters = 0; VAB.scene.traverse(o => { if (o.isMesh && o.castShadow) casters++; });
    return { enabled: RV.renderer.shadowMap.enabled, cast: k.castShadow, map: !!k.shadow.map, mapSize: k.shadow.mapSize.toArray(), casters, type: RV.renderer.shadowMap.type, sunCast: RV.sunLight.castShadow, autoUpdate: RV.renderer.shadowMap.autoUpdate, needsUpdate: RV.renderer.shadowMap.needsUpdate };
  });
  console.log(JSON.stringify(info));
};
// a set of representative frames for visual review
module.exports.gallery = async (p, shot) => {
  const full = () => p.evaluate(() => { for (const id in RV.bodies) { const r = RV.bodies[id]; if (r.b.terrain && r.displaced < 2 && ['earth', 'moon'].includes(id)) while (r.displaced < 2) displaceBody(r, 1e9); } });
  const settle = async (ms) => { await p.evaluate(() => { if (RV.patch.job) while (RV.patch.job) runPatchJob(RV.patch.body, 1e9); }); await wait(p, ms || 1500); await p.evaluate(() => { if (RV.patch.job) while (RV.patch.job) runPatchJob(RV.patch.body, 1e9); }); await wait(p, 600); };
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1')); const W = Game.world; W.cam.yaw = -1.6; W.cam.pitch = 0.3; W.cam.dist = 30; });
  await full(); await settle(2500); await shot('g1_pad');
  await p.evaluate(() => { const A = AP.A(); A.throttle = 1; A.sas = true; A.sasMode = 'stab'; Game.stage(); });
  await wait(p, 4000); await shot('g2_liftoff');
  await p.evaluate(() => { const A = AP.A(); A.sasMode = 'target'; AP.step(300, () => { const up = V.norm(A.r), east = V.norm(V.cross([0, 0, 1], up)); const k = Math.min(1, Math.max(0, (AP.alt() - 800) / 45000)), e = (90 - 88 * Math.pow(k, 0.55)) * Math.PI / 180; A.targetDir = V.add(V.scale(up, Math.sin(e)), V.scale(east, Math.cos(e))); }); Game.world.cam.dist = 30; Game.world.cam.pitch = -0.1; });
  await settle(2000); await shot('g3_ascent');
  await p.evaluate(() => { const A = AP.A(), E = BODY.earth; unlock(A); const rr = E.R + 120000; const ang = 0.3; A.r = [rr * Math.cos(ang), rr * Math.sin(ang), 0]; A.v = [-Math.sin(ang) * Math.sqrt(E.mu / rr), Math.cos(ang) * Math.sqrt(E.mu / rr), 0]; A.throttle = 0; A.sasMode = 'pro'; Game.world.cam.dist = 25; Game.world.cam.pitch = 0.35; Game.world.cam.yaw = 2.6; Game.g.ut = 3000; });
  await settle(2500); await shot('g4_orbit');
  await p.evaluate(() => Game.toggleMap()); await wait(p, 2000); await shot('g5_map'); await p.evaluate(() => Game.toggleMap());
  await p.evaluate(() => {
    Game.newGame('sandbox');
    const d = makeDesign('Посадочный', ['chute_s', 'pod_k1', 'shield_s1', 'dec_s1', { id: 'tank_t1l', r: [{ sym: 4, y: -0.2, part: 'legs' }] }, 'eng_terrier']);
    Game.launch(d); const A = Game.world.active; Game.toggleLegs();
    placeOnPad(A, Game.g.ut, { body: 'moon', lat: 0.3, lon: -0.6 }); A.prelaunch = false; A.prelaunchHold = false;
    Game.world.cam.dist = 22; Game.world.cam.pitch = 0.12; Game.world.cam.yaw = 0.8;
    // choose a time with the sun low over the site for long shadows
    const M = BODY.moon; let best = 0, bt = 0;
    for (let t = 0; t < M.rotPeriod; t += M.rotPeriod / 200) { const rel = bodyFixedToInertial(M, t, A.lock.pf); const e = V.dot(V.norm(rel), V.norm(V.neg(bodyAbsPos(M, t)))); if (e > 0.18 && e < 0.32) { bt = t; best = 1; break; } }
    if (best) { Game.g.ut = bt; applyLock(A, bt); }
  });
  await p.evaluate(() => { const r = RV.bodies.moon; while (r.displaced < 2) displaceBody(r, 1e9); });
  await settle(2500); await shot('g6_moon');
  await p.evaluate(() => { Game.world.cam.dist = 3000; Game.world.cam.pitch = 0.5; });
  await settle(2000); await shot('g7_moon_high');
  await p.evaluate(() => {
    Game.newGame('sandbox');
    Game.launch(makeDesign('Капсула', ['chute_s', 'pod_k1', 'shield_s1']));
    const A = Game.world.active, E = BODY.earth;
    unlock(A); A.prelaunch = false; A.prelaunchHold = false;
    A.r = [E.R + 42000, 0, 0]; A.v = [-300, 2300, 0];
    const back = V.norm(V.neg(A.v)), side = V.norm(V.cross(back, [0, 0, 1]));
    A.q = Q.fromBasis(side, back, V.cross(side, back)); A.sas = true; A.sasMode = 'retro';
    Game.world.cam.dist = 16; Game.world.cam.pitch = 0.3; Game.world.cam.yaw = 2.2; Game.g.ut = 2000;
    AP.step(20);
  });
  await settle(2500); await shot('g8_reentry');
};
module.exports.shadowdbg2 = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1')); const W = Game.world; W.cam.yaw = -1.6; W.cam.pitch = 0.3; W.cam.dist = 30; });
  await wait(p, 2500);
  const info = await p.evaluate(() => {
    const L = RV.sunLight, sc = L.shadow.camera;
    const vw = Game.world.views.get(Game.world.active.id);
    const wp = new THREE.Vector3(); vw.group.getWorldPosition(wp);
    const lp = L.position.clone(), tp = L.target.position.clone();
    // project rocket position into the shadow camera
    sc.updateMatrixWorld(); const pr = wp.clone().applyMatrix4(sc.matrixWorldInverse);
    return { light: lp.toArray().map(x => +x.toFixed(1)), target: tp.toArray().map(x => +x.toFixed(1)), rocket: wp.toArray().map(x => +x.toFixed(1)),
      inShadowCam: pr.toArray().map(x => +x.toFixed(1)), lrtb: [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far], catcher: RV.shadowCatcher.visible, catcherPos: RV.shadowCatcher.position.toArray().map(x => +x.toFixed(1)),
      shadowMapMatrix: !!L.shadow.map, castCount: (() => { let n = 0; vw.group.traverse(o => { if (o.isMesh && o.castShadow) n++; }); return n; })(), lightInt: L.intensity, deckRecv: (() => { let n = 0; RV.ksc.traverse(o => { if (o.isMesh && o.receiveShadow) n++; }); return n; })() };
  });
  console.log(JSON.stringify(info));
};
module.exports.shadowdbg3 = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1')); });
  await wait(p, 1500);
  const info = await p.evaluate(() => {
    const out = [];
    const orig = window.renderWorld;
    window.renderWorld = function (t, camAbs, q, opts) { out.push({ camPrev: RV.camAbs.map(x => x.toExponential(4)), camNew: camAbs.map(x => x.toExponential(4)), shadow: opts.shadow && opts.shadow.pos.toArray().map(x => x.toExponential(3)) }); return orig.apply(this, arguments); };
    renderFlight(0.016); renderFlight(0.016);
    window.renderWorld = orig;
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
};
module.exports.shadowdbg4 = async (p, shot) => {
  await p.evaluate(() => {
    window.__log = [];
    const orig = window.renderWorld;
    window.renderWorld = function (t, camAbs, q, opts) { if (window.__log.length < 12) window.__log.push(Game.screen + ' prev=' + RV.camAbs.map(x => x.toExponential(3)).join(',') + ' new=' + camAbs.map(x => x.toExponential(3)).join(',') + ' sh=' + (opts.shadow ? opts.shadow.pos.toArray().map(x => x.toExponential(2)).join(',') : '-')); return orig.apply(this, arguments); };
    Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Орбитер-1'));
  });
  await wait(p, 3000);
  console.log((await p.evaluate(() => window.__log)).join('\n'));
};
module.exports.vab2 = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.openVAB(makeDesign('Тест', ['chute_s', 'pod_k1', 'dec_s1', 'tank_t1xl', 'tank_t1xl', 'eng_swivel'])); });
  await wait(p, 1200);
  const L = (s) => console.log(s);
  const count = () => p.evaluate(() => VAB.layout.length);
  const partXY = (id, k, dy, dz) => p.evaluate(([id, k, dy, dz]) => { const it = VAB.layout.filter(x => x.id === id)[k || 0]; return vabScreen([it.pos[0] + (dz ? 0 : 0), it.pos[1] + (dy || 0), it.pos[2] + (dz || 0)]); }, [id, k, dy, dz]);
  const click = async (xy, opt) => { await p.mouse.move(xy[0], xy[1]); await wait(p, 120); if (opt && opt.alt) await p.keyboard.down('Alt'); await p.mouse.down({ button: opt && opt.right ? 'right' : 'left' }); await p.mouse.up({ button: opt && opt.right ? 'right' : 'left' }); if (opt && opt.alt) await p.keyboard.up('Alt'); await wait(p, 250); };
  L('start parts ' + await count());
  // a) pick the lower tank (takes the engine too) and drop it on the catalogue -> deleted
  await click(await partXY('tank_t1xl', 1));
  L('held: ' + await p.evaluate(() => VAB.held && VAB.held.kind + ':' + (VAB.held.parts || []).map(x => x.id).join('+')) + ', parts now ' + await count());
  const pal = await p.evaluate(() => { const r = document.querySelector('#v-plist').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 200]; });
  await p.mouse.move(pal[0], pal[1]); await wait(p, 200); await shot('vab2_overcat');
  await p.mouse.down(); await p.mouse.up(); await wait(p, 300);
  L('after catalogue click: held ' + await p.evaluate(() => !!VAB.held) + ', parts ' + await count());
  // b) undo restores
  await p.keyboard.press('Control+z'); await wait(p, 300);
  L('after undo: parts ' + await count());
  // c) pick + right-click cancel puts it back
  await click(await partXY('eng_swivel'));
  L('picked engine, parts ' + await count());
  await click([700, 450], { right: true });
  L('after right-click cancel: parts ' + await count() + ' held ' + await p.evaluate(() => !!VAB.held));
  // d) surface-attach a tank directly onto the side of the upper tank, sym x2, then an engine under it
  await p.click('#v-sym button:has-text("×2")');
  await p.click('#v-tabs button:has-text("Баки")'); await p.click('.pcard:has-text("Бак Т1-400")');
  await click(await partXY('tank_t1xl', 0, 0, 0.63));
  L('surface tank: ' + await p.evaluate(() => VAB.layout.filter(x => x.role === 'column').map(x => x.id).join(',')));
  await p.click('#v-tabs button:has-text("Двигатели")'); await p.click('.pcard:has-text("ЖРД «Опора»")');
  const colNode = await p.evaluate(() => { const n = vabStackNodes().filter(n => n.act.type === 'col'); const best = n.reduce((a, b) => (b.pos[1] < a.pos[1] ? b : a)); return vabScreen(best.pos); });
  await click(colNode);
  L('columns now: ' + await p.evaluate(() => VAB.layout.filter(x => x.role === 'column').map(x => x.id).join(',')));
  // e) drag the root (pod) upward by ~120 px
  const y0 = await p.evaluate(() => VAB.rocketY);
  const pod = await partXY('pod_k1');
  await p.mouse.move(pod[0], pod[1]); await p.mouse.down(); for (let i = 1; i <= 12; i++) { await p.mouse.move(pod[0], pod[1] - i * 10); await wait(p, 40); } await p.mouse.up(); await wait(p, 300);
  L(`rocketY ${y0.toFixed(1)} -> ${(await p.evaluate(() => VAB.rocketY)).toFixed(1)}`);
  await shot('vab2_built');
  // f) staging drag-and-drop: move the parachute into a new stage at the bottom (fires first)
  const before = await p.evaluate(() => JSON.stringify(VAB.design.stages.map(s => s.map(u => VAB.layout.find(x => x.uid === u).id))));
  await p.locator('#v-stl .si:has-text("Парашют")').dragTo(p.locator('#v-stl .gap').last()); await wait(p, 300);
  const after = await p.evaluate(() => JSON.stringify(VAB.design.stages.map(s => s.map(u => VAB.layout.find(x => x.uid === u).id))));
  L('stages before ' + before); L('stages after  ' + after);
  // g) launch and reorder a stage in flight
  await p.evaluate(() => Game.launch(JSON.parse(JSON.stringify(VAB.design)))); await wait(p, 1500);
  const fb = await p.evaluate(() => JSON.stringify(Game.world.active.stages.map(s => [...new Set(s.map(r => Game.world.active.parts[r].id))])));
  await p.locator('#h-stl .si:has-text("Парашют")').dragTo(p.locator('#h-stl .stage').first()); await wait(p, 400);
  const fa = await p.evaluate(() => JSON.stringify(Game.world.active.stages.map(s => [...new Set(s.map(r => Game.world.active.parts[r].id))])));
  L('flight stages before ' + fb); L('flight stages after  ' + fa);
  await shot('vab2_flight');
};
module.exports.planets = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(makeDesign('Зонд', ['probe_p0', 'tank_t0s', 'eng_spark'])); });
  for (const [id, dist, ang] of [['moon', 3.2, 0.8], ['mars', 3.0, 0.9], ['venus', 3.0, 0.7], ['jupiter', 3.4, 0.7], ['saturn', 4.8, 0.55], ['titan', 3.0, 0.7], ['europa', 3.0, 0.8], ['io', 3.0, 0.8]]) {
    await p.evaluate(([id, dist, ang]) => {
      const W = Game.world, A = W.active, b = BODY[id];
      unlock(A); A.prelaunch = false; A.prelaunchHold = false; A.body = b;
      // place the probe on the sunlit side, slightly toward the terminator
      const sun = V.norm(V.neg(bodyAbsPos(b, Game.g.ut)));
      const side = V.norm(V.cross(sun, [0, 0, 1]));
      const dir = V.norm(V.add(V.scale(sun, Math.cos(ang)), V.scale(side, Math.sin(ang))));
      A.r = V.scale(V.norm(V.add(dir, [0, 0, 0.25])), b.R * dist); A.v = [0, 0, 0];
      W.cam.dist = 8; W.cam.pitch = -1.2; W.cam.yaw = 0;
      if (!W.map) Game.toggleMap();
      MAP.focus = { kind: 'body', id }; MAP.dist = b.R * dist * 0.95; MAP.pitch = 0.25; MAP.yaw = Math.atan2(dir[1], dir[0]) + 0.6;
      const r = RV.bodies[id]; if (r.b.terrain) while (r.displaced < 2) displaceBody(r, 1e9);
    }, [id, dist, ang]);
    await wait(p, 1800); await shot('pl_' + id);
  }
};
module.exports.perf2 = async (p) => {
  const out = await p.evaluate(() => {
    const res = {};
    Game.newGame('sandbox');
    Game.launch(stockDesigns().find(d => d.name === 'Лунник'));
    for (const id of ['earth', 'moon']) { const r = RV.bodies[id]; const t0 = performance.now(); while (r.displaced < 2) displaceBody(r, 1e9); res['displace ' + id] = (performance.now() - t0).toFixed(0) + ' ms (one-time, sliced 3 ms/frame in game)'; }
    const b = BODY.earth;
    RV.patch.body = null; updateGroundPatch(b, [b.R + 300, 0, 0], 0); while (RV.patch.job) runPatchJob(b, 1e9);
    const t0 = performance.now(); startPatchJob(b, V.norm([1, 0.2, 0.1]), 300); while (RV.patch.job) runPatchJob(b, 1e9); res['patch rebuild earth'] = (performance.now() - t0).toFixed(1) + ' ms (sliced 4.5 ms/frame)';
    RV.patch.body = null; updateGroundPatch(BODY.moon, [BODY.moon.R + 300, 0, 0], 0); while (RV.patch.job) runPatchJob(BODY.moon, 1e9);
    const t1 = performance.now(); startPatchJob(BODY.moon, V.norm([1, 0.2, 0.1]), 300); while (RV.patch.job) runPatchJob(BODY.moon, 1e9); res['patch rebuild moon'] = (performance.now() - t1).toFixed(1) + ' ms';
    const A = Game.world.active; A.throttle = 1; A.sas = true; Game.stage();
    const realScene = renderScene, realNav = drawNavball;
    window.renderScene = () => {}; window.drawNavball = () => {};
    const time = (label, n, fn) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); res[label] = ((performance.now() - t) / n).toFixed(2) + ' ms'; };
    time('flightFrame (cpu, liftoff, 27 parts, FX)', 60, () => flightFrame(1 / 60));
    Game.world.physWarp = 3;
    time('flightFrame 4x physics', 30, () => flightFrame(1 / 60));
    window.renderScene = realScene; window.drawNavball = realNav;
    return JSON.stringify(res, null, 1);
  });
  console.log(out);
};
module.exports.liftoff = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Лунник')); const W = Game.world; W.cam.yaw = -1.3; W.cam.pitch = 0.08; W.cam.dist = 70; const r = RV.bodies.earth; while (r.displaced < 2) displaceBody(r, 1e9); });
  await wait(p, 2500);
  await p.evaluate(() => { const A = AP.A(); A.throttle = 1; A.sas = true; A.sasMode = 'stab'; Game.stage(); });
  for (let i = 1; i <= 3; i++) { await wait(p, 5000); await shot('lo_' + i); }
};
module.exports.fxdbg = async (p, shot) => {
  await p.evaluate(() => { Game.newGame('sandbox'); Game.launch(stockDesigns().find(d => d.name === 'Лунник')); const W = Game.world; W.cam.yaw = -1.3; W.cam.pitch = 0.08; W.cam.dist = 70; });
  await wait(p, 1500);
  await p.evaluate(() => { const A = AP.A(); A.throttle = 1; A.sas = true; A.sasMode = 'stab'; Game.stage(); });
  await wait(p, 2500);
  console.log(await p.evaluate(() => { const kinds = {}; for (const f of FX.list) kinds[f.kind] = (kinds[f.kind] || 0) + 1; const f0 = FX.list[FX.list.length - 1]; return JSON.stringify({ n: FX.list.length, kinds, draw: FX.geo.drawRange, last: f0 && { rel: V.sub(f0.p, RV.camAbs).map(x => +x.toFixed(1)), size: f0.s0, age: +f0.age.toFixed(2) }, visible: FX.points.visible, inScene: !!FX.points.parent, warp: Game.world.warp, map: Game.world.map, gnd: !!Game.world.active._gnd, radar: Game.world.active.radarAlt }); }));
};
