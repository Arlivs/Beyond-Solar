'use strict';
// Game state: career / sandbox progress, science, contracts, milestones, saves.

const SAVE_VERSION = 1;

// opts: { start: ut of the starting date, race: true for the 1957 space race (rival + build times) }
function newGame(mode, name, opts) {
  opts = opts || {};
  const g = {
    v: SAVE_VERSION, mode, name: name || (opts.race ? 'Космическая гонка' : mode === 'career' ? 'Карьера' : 'Песочница'), created: Date.now(),
    ut: opts.start != null ? kscMorning(opts.start) : 0, race: opts.race ? { items: {} } : null, builds: [],
    funds: 25000, science: 0, rep: 0,
    techs: mode === 'career' ? ['start'] : TECH.map(t => t.id),
    subjects: {}, milestones: {}, records: { alt: 0 },
    contracts: { offered: [], active: [], done: [], failed: [], seq: 1, lastGen: -1e9 },
    crafts: {}, vessels: [], lastCraft: null, stats: { launches: 0, recoveries: 0 },
  };
  initCrew(g);
  if (mode === 'career') refreshOffers(g);
  return g;
}
const isCareer = (g) => g.mode === 'career';
// first moment after t when the sun is ~15 degrees up over the space centre (a morning start)
function kscMorning(t) {
  const E = BODY.earth, up0 = V.norm(surfacePoint(E, KSC.lat, KSC.lon, 0));
  const elev = (tt) => V.dot(bodyFixedToInertial(E, tt, up0), V.norm(V.neg(bodyAbsPos(E, tt))));
  for (let k = 0; k <= 400; k++) { const tt = t + E.rotPeriod * k / 400, a = elev(tt), b = elev(tt + E.rotPeriod / 400); if (a < 0.26 && b >= 0.26) return tt; }
  return t;
}

// ---- astronaut corps ----
// status: ready | flight (aboard vessel c.vessel) | kia | missing (stranded, waiting for rescue)
const CREW_ROLES = { pilot: 'Пилот', engineer: 'Инженер', scientist: 'Учёный' };
const CREW_ROLE_HINT = {
  pilot: 'Режимы SAS на кораблях без зонда: ур. 0 — стабилизация, 1 — прогрейд/ретрогрейд, 2 — нормаль и радиальные, 3 — цель и манёвр.',
  engineer: 'В открытом космосе перепаковывает использованные парашюты.',
  scientist: 'Перезапускает одноразовые эксперименты (гель, материаловедение); +25% к науке экипажа.',
};
const CREW_NAMES = ['Вера Ковалёва', 'Игорь Светлов', 'Марк Ветров', 'Лидия Громова', 'Олег Северов', 'Анна Лучинина', 'Пётр Звягин', 'Нина Орехова',
  'Тимур Каримов', 'Елена Сабурова', 'Глеб Рогов', 'Дарья Кедрова', 'Савва Ершов', 'Ирина Полозова', 'Артём Березин', 'Майя Тихонова', 'Роман Шестаков',
  'Ксения Былинкина', 'Лев Ярцев', 'Полина Зарецкая'];
const XP_LEVELS = [2, 8, 16, 32, 64];
function crewLevel(c) { let l = 0; while (l < XP_LEVELS.length && c.xp >= XP_LEVELS[l]) l++; return l; }
function crewById(g, id) { return (g.crew || []).find(c => c.id === id) || null; }
function newKerbal(g, role, name) {
  g.crewSeq = (g.crewSeq || 0) + 1;
  const used = new Set((g.crew || []).map(c => c.name));
  name = name || CREW_NAMES.find(n => !used.has(n)) || 'Космонавт ' + g.crewSeq;
  return { id: 'k' + g.crewSeq, name, role, xp: 0, status: 'ready', vessel: null, flights: 0, log: {} };
}
function initCrew(g) {
  if (g.crew) return;
  g.crew = [];
  for (const r of ['pilot', 'pilot', 'engineer', 'scientist']) g.crew.push(newKerbal(g, r));
  g.crew[0].xp = g.crew[1].xp = 2;          // the first pilots can already hold prograde
}
function hireCost(g) { return 9000 + 3500 * g.crew.filter(c => c.status === 'ready' || c.status === 'flight').length; }
function hireKerbal(g, role) {
  const cost = isCareer(g) ? hireCost(g) : 0;
  if (isCareer(g) && g.funds < cost) return null;
  spend(g, cost);
  const k = newKerbal(g, role); g.crew.push(k);
  return k;
}
// XP for having been somewhere: Earth gives only for space / orbit, other bodies scale with difficulty
function xpFor(bodyId, kind) {
  const b = BODY[bodyId];
  if (bodyId === 'earth') return { space: 0.5, orbit: 1 }[kind] || 0;
  return ({ soi: 1, orbit: 1.5, landed: 2.3, flag: 0.5 }[kind] || 0) * (1 + b.diff * 0.5);
}
// a crew member experienced something (logged; turned into XP when they come home)
function crewLog(g, id, bodyId, kind) {
  const c = crewById(g, id); if (!c) return;
  const L = c.log[bodyId] || (c.log[bodyId] = {});
  if (!L[kind]) L[kind] = 1;
}
function crewOf(v) { const out = []; for (const p of v.parts) if (!p.dead && p.crew) out.push(...p.crew); return out; }
// recovered at home: logged experience becomes XP
function crewHome(g, id) {
  const c = crewById(g, id); if (!c) return 0;
  let gain = 0;
  for (const b in c.log) for (const k in c.log[b]) if (c.log[b][k] === 1) { gain += xpFor(b, k); c.log[b][k] = 2; }
  const lv = crewLevel(c);
  c.xp += gain; c.flights++; c.status = 'ready'; c.vessel = null;
  return { gain, up: crewLevel(c) > lv };
}
function crewLost(g, id) {
  const c = crewById(g, id); if (!c) return;
  if (isCareer(g)) { c.status = 'kia'; c.vessel = null; g.rep -= 5; }
  else { c.status = 'ready'; c.vessel = null; }       // sandbox: nobody really dies
}
// seat ready crew in a new vessel's pods: the design's explicit choice, otherwise pilots first
function assignCrew(g, v, design) {
  const ready = g.crew.filter(c => c.status === 'ready');
  const take = (id) => { const i = ready.findIndex(c => c.id === id); if (i < 0) return null; return ready.splice(i, 1)[0]; };
  const pods = v.parts.filter(p => PART[p.id].command && PART[p.id].command.crew > 0);
  for (const p of pods) {
    p.crew = [];
    const want = design.crew && design.crew[p.uid];
    if (want) { for (const id of want) { const c = take(id); if (c && p.crew.length < PART[p.id].command.crew) p.crew.push(c.id); } continue; }
    while (p.crew.length < PART[p.id].command.crew && ready.length) {
      const i = Math.max(0, p.crew.length === 0 ? ready.findIndex(c => c.role === 'pilot') : 0);
      p.crew.push(ready.splice(i, 1)[0].id);
    }
  }
  for (const id of crewOf(v)) { const c = crewById(g, id); c.status = 'flight'; c.vessel = v.id; }
}
// best pilot level aboard; null = no restriction (sandbox, probe core, or a pre-crew save)
function sasLevel(g, v) {
  if (!isCareer(g)) return null;
  if (v.parts.some(p => !p.dead && PART[p.id].command && !PART[p.id].command.crew)) return null;
  if (v.parts.some(p => !p.dead && PART[p.id].command && PART[p.id].command.crew && !p.crew)) return null;
  let lv = -1;
  for (const id of crewOf(v)) { const c = crewById(g, id); if (c && c.role === 'pilot') lv = Math.max(lv, crewLevel(c)); }
  return lv;
}
const SAS_LEVEL = { stab: 0, pro: 1, retro: 1, normal: 2, anti: 2, radout: 2, radin: 2, target: 3, antitarget: 3, node: 3 };
function sasAllowed(g, v, mode) { const lv = sasLevel(g, v); return lv == null || (mode === 'stab' ? lv >= -1 : lv >= SAS_LEVEL[mode]); }

// ---- tech ----
function partUnlocked(g, id) { return g.techs.includes(PART[id].tech); }
function techAvailable(g, t) { return !g.techs.includes(t.id) && (t.req.length === 0 || t.req.some(r => g.techs.includes(r))); }
function researchTech(g, id) {
  const t = TECH_BY_ID[id];
  if (!t || !techAvailable(g, t) || g.science < t.cost) return false;
  g.science -= t.cost; g.techs.push(id);
  return true;
}
function designAllowed(g, design) { return designPartIds(design).every(id => partUnlocked(g, id)); }

// ---- funds ----
function spend(g, x) { if (!isCareer(g)) return true; if (g.funds < x) return false; g.funds -= x; return true; }
function earn(g, x) { if (isCareer(g)) g.funds += x; }

// ---- science ----
// subjects: experiment x body x situation, plus the biome for landed / low-flight data
function subjectId(exp, bodyId, sit, biome) { return exp + '@' + bodyId + ':' + sit + (biome ? '/' + biome : ''); }
function subjectTitle(exp, bodyId, sit, biome) { const bm = biome && biomeById(BODY[bodyId], biome); return `${EXPERIMENTS[exp].name}: ${BODY[bodyId].name}${bm ? ' (' + bm.name + ')' : ''}, ${SIT_NAMES[sit]}`; }
function sciMult(body, sit) { return body.sci[SIT_INDEX[sit]] || 0; }
function subjectRemaining(g, exp, bodyId, sit, biome) {
  const e = EXPERIMENTS[exp], m = sciMult(BODY[bodyId], sit);
  return Math.max(0, e.cap * m - (g.subjects[subjectId(exp, bodyId, sit, biome)] || 0));
}
// value if credited now
function dataValue(g, d, transmit) {
  const e = EXPERIMENTS[d.exp], m = sciMult(BODY[d.body], d.sit);
  const full = e.base * m * (transmit ? e.xmit : 1) * (d.bonus || 1);
  return Math.min(full, subjectRemaining(g, d.exp, d.body, d.sit, d.biome));
}
function creditData(g, d, transmit) {
  const x = dataValue(g, d, transmit);
  if (x <= 0) return 0;
  const id = subjectId(d.exp, d.body, d.sit, d.biome);
  g.subjects[id] = (g.subjects[id] || 0) + x;
  if (isCareer(g)) g.science += x;
  contractEvent(g, 'science', { exp: d.exp, body: d.body, sit: d.sit });
  return x;
}
// can experiment exp run here?
function expAvailable(exp, v) {
  const e = EXPERIMENTS[exp], sit = sciSituation(v), b = v.body;
  if (!e.sits.split(' ').includes(sit)) return { ok: false, why: 'не работает ' + SIT_NAMES[sit] };
  if (e.needAtm && !b.atm) return { ok: false, why: 'нет атмосферы' };
  if (sciMult(b, sit) <= 0) return { ok: false, why: 'здесь нечего изучать' };
  if (e.auto) return { ok: false, why: 'идёт само на орбите' };
  return { ok: true, sit, biome: vesselBiome(v, v._ut != null ? v._ut : 0) };
}
// run the experiment of part p (or crew report from pod); returns data or {error}
function runExperiment(g, v, p, exp) {
  const a = expAvailable(exp, v);
  if (!a.ok) return { error: a.why };
  const e = EXPERIMENTS[exp];
  if (exp === 'crew' || e.byEva) {
    if (p.data.some(d => d.exp === exp && d.body === v.body.id && d.sit === a.sit && d.biome === a.biome)) return { error: 'такие данные уже есть' };
    if (e.solid && (v.body.gas || !v.body.terrain)) return { error: 'здесь нет грунта' };
  } else {
    if (p.data.length) return { error: 'данные уже собраны' };
    if (e.single && p.st.used) return { error: 'эксперимент израсходован' };
  }
  const d = { exp, body: v.body.id, sit: a.sit, biome: a.biome || undefined, title: subjectTitle(exp, v.body.id, a.sit, a.biome) };
  // science done by a scientist (crew / EVA reports, samples) is worth a quarter more
  if (exp === 'crew' || e.byEva) { const ids = p.crew || []; if (ids.some(id => { const c = crewById(g, id); return c && c.role === 'scientist'; })) d.bonus = 1.25; }
  p.data.push(d);
  if (e.single) p.st.used = true;
  return { data: d, value: dataValue(g, d, false), xmit: dataValue(g, d, true) };
}

// mapping science: credited as coverage grows (5% steps); returns the new science
function mappingCredit(g, bodyId, coverage) {
  const b = BODY[bodyId], cap = EXPERIMENTS.mapping.cap * sciMult(b, 'SL');
  const id = subjectId('mapping', bodyId, 'SL'), have = g.subjects[id] || 0;
  const x = cap * Math.floor(coverage * 20) / 20 - have;
  if (x <= 0.01) return 0;
  g.subjects[id] = have + x;
  if (isCareer(g)) g.science += x;
  return x;
}

// ---- recovery ----
function recoveryFactor(v) {
  if (v.body.id !== 'earth') return 0;
  const ll = latLon(v.body, v._ut || 0, v.r);
  const d = Math.acos(clamp(Math.cos(ll.lat) * Math.cos(ll.lon - KSC.lon), -1, 1)) * v.body.R;
  return clamp(1 - d / (Math.PI * v.body.R) * 0.4, 0.6, 1) * 0.98;
}
function recoverVessel(g, v) {
  const f = recoveryFactor(v);
  let funds = 0, sci = 0;
  const items = [];
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    let c = d.cost;
    for (const k in p.res) c += (RES_COST[k] || 0) * (k === 'ELEC' ? 0 : p.res[k]);
    funds += c * f;
    for (const dt of p.data) { const x = creditData(g, dt, false); sci += x; items.push([dt.title, x]); }
  }
  earn(g, funds);
  g.stats.recoveries++;
  const crew = [];
  for (const id of crewOf(v)) { const r = crewHome(g, id); const c = crewById(g, id); if (c) crew.push([c.name, r]); }
  // returns
  const ret = [];
  const fb = v.flags.bodies || {};
  if (fb.earth && fb.earth.orbit) ret.push(milestone(g, 'return_orbit'));
  for (const id in fb) {
    if (id === 'earth') continue;
    ret.push(milestone(g, 'return_' + id));
    contractEvent(g, 'recovered', { flags: fb, body: id });
  }
  contractEvent(g, 'recovered', { flags: fb, crew: crewOf(v) });
  return { funds: isCareer(g) ? funds : 0, sci, items, factor: f, milestones: ret.filter(Boolean), crew };
}

// ---- milestones ----
function milestoneDef(id) {
  const fixed = {
    launch: ['Первый запуск', 2000, 0, 2],
    alt_5k: ['Высота 5 км', 1500, 1, 1], alt_10k: ['Высота 10 км', 2500, 2, 1], alt_20k: ['Высота 20 км', 3500, 3, 2],
    alt_40k: ['Высота 40 км', 5000, 4, 2],
    space: ['Первый выход в космос', 9000, 6, 5], orbit_earth: ['Первая орбита Земли', 15000, 10, 8],
    return_orbit: ['Возвращение с орбиты', 10000, 8, 6], escape_earth: ['Покинуть сферу Земли', 18000, 12, 8],
    dock: ['Первая стыковка', 20000, 12, 10], eva: ['Первый выход в открытый космос', 15000, 10, 8],
  };
  if (fixed[id]) return fixed[id];
  if (id === 'station') return ['Орбитальная станция', 30000, 15, 12];
  const m = id.match(/^(orbit_crew|land_crew|rover|soi|orbit|land|return|walk|flag)_(\w+)$/);
  if (!m || !BODY[m[2]]) return null;
  const b = BODY[m[2]], k = 1 + b.diff * 0.8;
  const T = { soi: ['Пролёт: ', 8000, 6], orbit: ['Орбита: ', 12000, 10], land: ['Посадка: ', 20000, 18], return: ['Возвращение с тела: ', 24000, 14],
    walk: ['Прогулка по поверхности: ', 15000, 12], flag: ['Флаг: ', 9000, 8], orbit_crew: ['Люди на орбите: ', 16000, 10], land_crew: ['Люди на поверхности: ', 30000, 22],
    rover: ['Ровер: ', 15000, 12] }[m[1]];
  return [T[0] + b.name, Math.round(T[1] * k / 100) * 100, Math.round(T[2] * k), Math.round(5 * k)];
}
function milestone(g, id) {
  if (g.milestones[id]) return null;
  const d = milestoneDef(id);
  if (!d) return null;
  g.milestones[id] = g.ut || 1;
  earn(g, d[1]);
  if (isCareer(g)) { g.science += d[2]; g.rep += d[3]; }
  const race = raceOnMilestone(g, id);
  if (race) (g._notify || (() => {}))(race.first ? `🏆 Мы первые: ${race.it.title}! +${fmtMoney(race.r.funds)}, +${race.r.rep} репутации` : `${race.it.title}: соперник успел раньше`);
  return { id, title: d[0], funds: d[1], sci: d[2] };
}
// called ~1 Hz by the flight scene; returns newly reached milestones
function progressTick(g, v, ut) {
  const out = [];
  const b = v.body, alt = V.len(v.r) - b.R;
  const fb = v.flags.bodies || (v.flags.bodies = {});
  const f = fb[b.id] || (fb[b.id] = {});
  f.soi = true;
  if (b.id !== 'earth') out.push(milestone(g, 'soi_' + b.id));
  if (b.id === 'earth') {
    if (alt > g.records.alt) g.records.alt = alt;
    for (const [k, h] of [['alt_5k', 5e3], ['alt_10k', 1e4], ['alt_20k', 2e4], ['alt_40k', 4e4]]) if (alt > h) out.push(milestone(g, k));
    if (alt > b.atm.top) out.push(milestone(g, 'space'));
  } else if (BODY.earth && !isDescendant(b, BODY.earth)) out.push(milestone(g, 'escape_earth'));
  const el = elFromState(v.r, v.v, b.mu, ut);
  const safe = b.R + (b.atm ? b.atm.top : Math.min(10000, b.R * 0.05));
  if (el.e < 1 && el.rp > safe && el.ra < b.soi && !v.landed) { f.orbit = true; out.push(milestone(g, 'orbit_' + b.id)); }
  if (v.landed && !v.prelaunch && b.id !== 'earth') { f.landed = true; out.push(milestone(g, 'land_' + b.id)); }
  if (v.landed && !v.prelaunch && b.id === 'earth' && v.launchUT != null) f.landed = true;
  if (v.parts.some(p => !p.dead && PART[p.id].kerbal)) {
    if (sciSituation(v)[0] === 'S') out.push(milestone(g, 'eva'));
    if ((v.landed || v.inContact) && b.id !== 'earth') out.push(milestone(g, 'walk_' + b.id));
  }
  const crewed = isCrewed(v) || v.parts.some(p => !p.dead && PART[p.id].kerbal);
  if (crewed && f.orbit && el.e < 1 && el.rp > safe && !v.landed) out.push(milestone(g, 'orbit_crew_' + b.id));
  if (crewed && (v.landed || v.inContact) && !v.prelaunch && b.id !== 'earth') out.push(milestone(g, 'land_crew_' + b.id));
  if (b.id !== 'earth' && v.inContact && v.parts.some(p => !p.dead && PART[p.id].gear && PART[p.id].gear.motor) &&
    V.len(V.sub(v.v, V.cross(bodyOmega(b), v.r))) > 2) out.push(milestone(g, 'rover_' + b.id));
  if (crewed && f.orbit && !v.landed && v.edges.some(e => e.dock && !e.cut)) out.push(milestone(g, 'station'));
  for (const id of crewOf(v)) {
    if (b.id !== 'earth') crewLog(g, id, b.id, 'soi');
    else if (alt > b.atm.top) crewLog(g, id, 'earth', 'space');
    if (f.orbit && v.body === b && el.e < 1 && el.rp > safe) crewLog(g, id, b.id, 'orbit');
    if (v.landed && !v.prelaunch && b.id !== 'earth') crewLog(g, id, b.id, 'landed');
  }
  contractTick(g, v, ut, el);
  return out.filter(Boolean);
}
function isDescendant(b, anc) { for (let c = b; c; c = c.parent) if (c === anc) return true; return false; }

// ---- contracts ----
const CONTRACT_TYPES = {
  alt: 'Рекорд высоты', space: 'Выход в космос', orbit: 'Выход на орбиту', flyby: 'Пролёт', land: 'Посадка',
  return: 'Посадка и возвращение', science: 'Научные данные', satellite: 'Спутник',
  eva: 'Выход в открытый космос', flag: 'Флаг', rescue: 'Спасение', dock: 'Стыковка',
};
function reachableBodies(g) {
  let maxDiff = 0;
  for (const b of BODIES) if (g.milestones['soi_' + b.id]) maxDiff = Math.max(maxDiff, b.diff);
  if (!g.milestones.orbit_earth) return [BODY.earth];
  return BODIES.filter(b => b.id !== 'sun' && b.diff <= maxDiff + 1);
}
function makeContract(g, rnd) {
  const bodies = reachableBodies(g);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const types = [];
  if (!g.milestones.space) { types.push('alt', 'alt', 'space', 'science'); }
  else if (!g.milestones.orbit_earth) { types.push('orbit', 'science', 'science'); }
  else {
    types.push('orbit', 'flyby', 'land', 'return', 'science', 'science', 'satellite', 'eva', 'rescue', 'flag');
    if (g.techs.includes('docking')) types.push('dock');
  }
  const type = pick(types);
  const solid = (x) => !x.gas && x.vis.type !== 'star';
  let b = pick(bodies.filter(x => type === 'land' || type === 'return' || type === 'flag' ? solid(x) && x.id !== 'earth' : type === 'rescue' ? x.id === 'earth' || x.id === 'moon' : type === 'dock' ? solid(x) : true));
  if (!b) b = BODY.earth;
  if ((type === 'flyby' || type === 'land' || type === 'return') && b.id === 'earth') b = bodies.find(x => x.id === 'moon') || BODY.moon;
  const k = 1 + b.diff * 0.9;
  const c = { id: 'c' + g.contracts.seq++, type, body: b.id, state: 'offered', made: g.ut };
  let funds = 0, sci = 0;
  switch (type) {
    case 'alt': {
      const opts = [6000, 12000, 25000, 50000].filter(h => h > g.records.alt);
      c.alt = opts.length ? opts[0] : 50000;
      c.title = `Поднимитесь выше ${(c.alt / 1000).toFixed(0)} км`;
      c.desc = 'Наберите высоту над Землёй. Подойдёт любой аппарат.';
      funds = 3000 + c.alt * 0.12; sci = 2 + c.alt / 10000;
      break;
    }
    case 'space':
      c.title = 'Достигните космоса'; c.desc = `Пересеките границу атмосферы Земли (${BODY.earth.atm.top / 1000} км).`;
      funds = 14000; sci = 8; break;
    case 'orbit':
      c.title = `Выйдите на орбиту: ${b.name}`; c.desc = `Стабильная орбита вокруг тела «${b.name}» с перицентром выше атмосферы.`;
      funds = (b.id === 'earth' ? 20000 : 26000 * k); sci = 10 * k; break;
    case 'flyby':
      c.title = `Пролёт: ${b.name}`; c.desc = `Войдите в сферу влияния тела «${b.name}».`;
      funds = 17000 * k; sci = 8 * k; break;
    case 'land':
      c.title = `Посадка: ${b.name}`; c.desc = `Совершите мягкую посадку на «${b.name}».`;
      funds = 40000 * k; sci = 20 * k; break;
    case 'return':
      c.title = `Слетайте на «${b.name}» и вернитесь`; c.desc = `Посадите аппарат на «${b.name}», затем верните его на Землю и спишите в ЦУПе.`;
      funds = 60000 * k; sci = 30 * k; break;
    case 'science': {
      const sits = ['L', 'FL', 'FH', 'SL', 'SH'].filter(s => sciMult(b, s) > 0 && (s[0] !== 'F' || b.atm) && !(s === 'L' && b.gas));
      const sit = pick(sits.length ? sits : ['SL']);
      const exps = Object.keys(EXPERIMENTS).filter(e => EXPERIMENTS[e].sits.split(' ').includes(sit) && (!EXPERIMENTS[e].needAtm || b.atm) &&
        (e === 'crew' || PARTS.some(p => p.sci === e && partUnlocked(g, p.id))));
      const exp = pick(exps.length ? exps : ['crew']);
      Object.assign(c, { exp, sit });
      c.title = `${EXPERIMENTS[exp].name}: ${b.name}`; c.desc = `Получите данные «${EXPERIMENTS[exp].name}» ${SIT_NAMES[sit]} (${b.name}) и передайте их или верните на Землю.`;
      funds = 6000 * k * (1 + sciMult(b, sit) * 0.15); sci = 6 * k; break;
    }
    case 'eva':
      c.title = `Выход в открытый космос: ${b.name}`; c.desc = `Выйдите в открытый космос на орбите или в сфере влияния тела «${b.name}» (кнопка «Выход» у члена экипажа).`;
      funds = 16000 * k; sci = 6 * k; break;
    case 'flag':
      c.title = `Флаг: ${b.name}`; c.desc = `Высадитесь на «${b.name}», выйдите из капсулы и поставьте флаг (F).`;
      funds = 45000 * k; sci = 22 * k; break;
    case 'dock':
      c.title = `Стыковка на орбите: ${b.name}`; c.desc = `Состыкуйте два аппарата на орбите тела «${b.name}». Нужны стыковочные узлы одного размера.`;
      funds = 30000 * k; sci = 12 * k; break;
    case 'rescue': {
      const kn = newKerbal(g, pick(['pilot', 'engineer', 'scientist']));
      c.kerbal = { name: kn.name, role: kn.role };
      c.alt = b.id === 'earth' ? 90000 + rnd() * 160000 : 15000 + rnd() * 70000;
      c.title = `Спасение: ${kn.name}`; c.desc = `${CREW_ROLES[kn.role]} ${kn.name} застрял(а) в капсуле без топлива на орбите «${b.name}» около ${fmtDist(c.alt)}. Сблизьтесь, заберите космонавта через выход в открытый космос (нужно свободное место) и верните на Землю. Спасённый вступит в отряд.`;
      funds = 32000 * k; sci = 6 * k; break;
    }
    case 'satellite': {
      const base = b.R + (b.atm ? b.atm.top : b.R * 0.05);
      const lo = base + (b.R * (0.1 + rnd() * 0.6));
      const hi = lo * (1 + rnd() * 0.8);
      c.ap = hi; c.pe = lo; c.tol = 0.12;
      c.inc = rnd() < 0.5 ? null : Math.round(rnd() * 8) * 10;
      c.title = `Спутник на орбите: ${b.name}`;
      c.desc = `Беспилотный аппарат (без экипажа) на орбите «${b.name}»: апоцентр ${fmtDist(hi - b.R)}, перицентр ${fmtDist(lo - b.R)} (±12%)` + (c.inc != null ? `, наклонение ${c.inc}° ±5°.` : '.');
      funds = 24000 * k + (c.inc ? 6000 : 0); sci = 8 * k; break;
    }
  }
  c.advance = Math.round(funds * 0.2 / 100) * 100;
  c.reward = Math.round(funds * 0.8 / 100) * 100;
  c.sci = Math.round(sci);
  c.rep = Math.round(3 * k);
  c.penalty = Math.round(funds * 0.25 / 100) * 100;
  c.days = Math.round((type === 'alt' || type === 'space' ? 60 : 120) * (1 + b.diff * 1.5));
  return c;
}
function refreshOffers(g, force) {
  const C = g.contracts;
  C.offered = C.offered.filter(c => c.state === 'offered');
  const rnd = rng((g.contracts.seq * 7919 + Math.floor(g.ut / DAY)) >>> 0);
  let tries = 0;
  while (C.offered.length < 5 && tries++ < 40) {
    const c = makeContract(g, rnd);
    const dupe = [...C.offered, ...C.active].some(x => x.title === c.title);
    const doneSame = c.type !== 'science' && c.type !== 'satellite' && [...C.done].some(x => x.title === c.title);
    if (!dupe && !doneSame) C.offered.push(c);
  }
  C.lastGen = g.ut;
}
function acceptContract(g, id) {
  const C = g.contracts, i = C.offered.findIndex(c => c.id === id);
  if (i < 0 || C.active.length >= 6) return false;
  const c = C.offered.splice(i, 1)[0];
  c.state = 'active'; c.accepted = g.ut; c.deadline = g.ut + c.days * DAY;
  C.active.push(c);
  if (c.type === 'rescue') spawnRescue(g, c);
  earn(g, c.advance);
  refreshOffers(g);
  return true;
}
// a stranded astronaut in a dead capsule on a circular equatorial orbit
function spawnRescue(g, c) {
  const k = newKerbal(g, c.kerbal.role, c.kerbal.name);
  k.status = 'missing'; g.crew.push(k); c.kid = k.id;
  const b = BODY[c.body], v = buildVessel(makeDesign(`Капсула «${k.name}»`, ['pod_k1']), `Капсула «${k.name}»`);
  v.parts[0].crew = [k.id]; v.parts[0].res.MONO = 0; v.parts[0].res.ELEC = 5;
  const R = b.R + c.alt, vc = Math.sqrt(b.mu / R), a = Math.random() * TAU;
  v.body = b; v.r = [R * Math.cos(a), R * Math.sin(a), 0]; v.v = [-vc * Math.sin(a), vc * Math.cos(a), 0];
  v.q = Q.axisAngle([1, 0, 0], Math.random() * 3); v.w = [0, 0, 0];
  k.vessel = v.id;
  g.vessels.push(serializeVessel(v));
}
function declineContract(g, id) {
  const C = g.contracts; C.offered = C.offered.filter(c => c.id !== id); refreshOffers(g);
}
function cancelContract(g, id) {
  const C = g.contracts, i = C.active.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = C.active.splice(i, 1)[0];
  c.state = 'failed'; C.failed.push(c);
  earn(g, -c.penalty); g.rep -= c.rep;
}
function completeContract(g, c) {
  const C = g.contracts;
  C.active = C.active.filter(x => x !== c);
  c.state = 'done'; c.doneAt = g.ut; C.done.push(c);
  earn(g, c.reward);
  if (isCareer(g)) { g.science += c.sci; g.rep += c.rep; }
  (g._notify || (() => {}))(`Контракт выполнен: ${c.title}  +${fmtMoney(c.reward)}  +${c.sci} науки`);
}
function contractTick(g, v, ut, el) {
  if (!isCareer(g)) return;
  const b = v.body, alt = V.len(v.r) - b.R;
  for (const c of [...g.contracts.active]) {
    if (ut > c.deadline) { cancelContract(g, c.id); (g._notify || (() => {}))('Контракт провален (срок): ' + c.title); continue; }
    if (c.body !== b.id) continue;
    let ok = false;
    const evaOn = v.parts.some(p => !p.dead && PART[p.id].kerbal);
    switch (c.type) {
      case 'eva': ok = evaOn && !v.landed && !v.inContact && (!b.atm || alt > b.atm.top); break;
      case 'alt': ok = alt > c.alt; break;
      case 'space': ok = b.atm && alt > b.atm.top; break;
      case 'orbit': ok = el.e < 1 && el.rp > b.R + (b.atm ? b.atm.top : 5000) && el.ra < b.soi && !v.landed; break;
      case 'flyby': ok = true; break;
      case 'land': ok = v.landed && !v.prelaunch; break;
      case 'satellite': {
        const crewed = isCrewed(v), probe = v.parts.some(p => !p.dead && PART[p.id].command && !PART[p.id].command.crew);
        ok = !crewed && probe && el.e < 1 && Math.abs(el.ra - c.ap) < c.ap * c.tol && Math.abs(el.rp - c.pe) < c.pe * c.tol &&
          (c.inc == null || Math.abs(el.inc / DEG - c.inc) < 5);
        break;
      }
    }
    if (ok) completeContract(g, c);
  }
}
function contractEvent(g, type, d) {
  if (!isCareer(g)) return;
  for (const c of [...g.contracts.active]) {
    if (type === 'science' && c.type === 'science' && c.exp === d.exp && c.body === d.body && c.sit === d.sit) completeContract(g, c);
    if (type === 'recovered' && c.type === 'return' && d.flags[c.body] && d.flags[c.body].landed) completeContract(g, c);
    if (type === 'recovered' && c.type === 'rescue' && d.crew && d.crew.includes(c.kid)) completeContract(g, c);
    if (type === 'flag' && c.type === 'flag' && c.body === d.body) completeContract(g, c);
    if (type === 'docked' && c.type === 'dock' && d.a.body.id === c.body && !d.a.landed) completeContract(g, c);
  }
}

// ---- alarms (time warp stops before them) ----
function addAlarm(g, a) {
  g.alarms = g.alarms || [];
  a.id = 'a' + (g.alarmSeq = (g.alarmSeq || 0) + 1);
  g.alarms.push(a); g.alarms.sort((x, y) => x.t - y.t);
  return a;
}
function removeAlarm(g, id) { g.alarms = (g.alarms || []).filter(a => a.id !== id); }

// ---- vessel (de)serialization ----
function serializeVessel(v) {
  return {
    id: v.id, name: v.name, body: v.body.id, r: v.r, v: v.v, q: v.q, w: v.w || [0, 0, 0], lock: v.lock || null,
    landed: !!v.landed, prelaunch: !!v.prelaunch, parts: v.parts.map(p => ({
      id: p.id, uid: p.uid, k: p.k, pos: p.pos, dir: p.dir, ang: p.ang, role: p.role, res: p.res, T: p.T, st: p.st, data: p.data,
      dead: !!p.dead, pEdge: p.pEdge, q: p.q || undefined, portDir: p.portDir, origName: p.origName, crew: p.crew,
    })), edges: v.edges, stages: v.stages, stageIdx: v.stageIdx, throttle: 0, sas: v.sas, sasMode: v.sasMode, rcs: v.rcs,
    flags: v.flags, maxAlt: v.maxAlt, design: v.design, launchUT: v.launchUT, debris: !!v.debris, nodes: v.nodes || [],
    craftName: v.craftName || null, ctrlPort: v.ctrlPort != null ? v.ctrlPort : null, site: v.site || null,
  };
}
function deserializeVessel(s) {
  const v = Object.assign({}, s);
  v.body = BODY[s.body];
  v.parts = s.parts.map((p, i) => Object.assign({}, p, { rid: i }));
  v.nodes = (s.nodes || []).map(n => Object.assign({}, n));
  vesselTopology(v);
  v._comPrev = massProps(v).com.slice();
  return v;
}

// ---- persistence (localStorage) ----
const LS_PREFIX = 'orbita.';
function lsGet(k, d) { try { const x = localStorage.getItem(LS_PREFIX + k); return x == null ? d : JSON.parse(x); } catch (e) { return d; } }
function lsSet(k, val) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(val)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* ignore */ } }
function gameToJSON(g) {
  flushScans(g);
  const o = {};
  for (const k in g) if (k[0] !== '_') o[k] = g[k];
  return JSON.parse(JSON.stringify(o));
}
function saveSlot(slot, g, label) {
  const data = gameToJSON(g);
  const ok = lsSet('save.' + slot, data);
  const idx = lsGet('saves', []).filter(s => s.slot !== slot);
  idx.unshift({ slot, name: g.name, label: label || '', mode: g.mode, ut: g.ut, date: Date.now(), funds: g.funds, science: g.science });
  lsSet('saves', idx.slice(0, 30));
  return ok;
}
function loadSlot(slot) {
  const g = lsGet('save.' + slot, null);
  if (!g || g.v !== SAVE_VERSION) return null;
  initCrew(g);                 // saves from before the astronaut corps
  g.builds = g.builds || [];
  return g;
}
function listSaves() { return lsGet('saves', []); }
function deleteSlot(slot) { lsDel('save.' + slot); lsSet('saves', listSaves().filter(s => s.slot !== slot)); }
