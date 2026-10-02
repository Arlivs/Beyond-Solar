// Real calendar + space race: dates, first/late/rival settlement, sites appearing, build queue, site discovery.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'biomes.js', 'career.js', 'race.js']);
const { V, BODY, newGame, milestone, raceTick, raceScore, RACE, RACE_START, SITES, siteExists, siteCheck, siteDir, startBuild, buildDays, stockDesigns,
  fmtDay, fmtDate, dateToUt, DAY, buildVessel, makeDesign, placeOnPad, bodyFixedToInertial } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const g = newGame('career', null, { race: true, start: RACE_START });
ok(/^[12] янв 1957/.test(fmtDay(g.ut)), `race starts ${fmtDate(g.ut)} (morning at the space centre)`);
const f0 = g.funds;
milestone(g, 'orbit_earth');
ok(g.race.items.sat && g.race.items.sat.by === 'us' && g.funds > f0 + 20000, `satellite before 4 Oct 1957 is ours (+${g.funds - f0})`);
g.ut = dateToUt(Date.UTC(1959, 2, 1));
const news = raceTick(g);
ok(news.map(x => x.id).join() === 'moonfly', `by March 1959 the rival has: ${news.map(x => x.title).join(', ')}`);
ok(!siteExists(g, SITES.find(s => s.id === 'luna9')), 'no Luna-9 site before the rival lands');
g.ut = dateToUt(Date.UTC(1966, 2, 1)); raceTick(g);
ok(siteExists(g, SITES.find(s => s.id === 'luna9')) && g.race.items.moonland.by === 'rival', 'after Feb 1966 the rival has landed and its site exists');
milestone(g, 'dock');
ok(g.race.items.dock.by === 'us', 'docking before 16 Mar 1966 still ours');
const sc = raceScore(g);
ok(sc.us === 2 && sc.rival >= 5, `score ${sc.us}:${sc.rival}`);
// builds are sequential
const d = stockDesigns().find(x => x.name === 'Орбитер-1');
const b1 = startBuild(g, d), b2 = startBuild(g, d);
ok(Math.abs(b2.ready - b1.ready - buildDays(d) * DAY) < 1e-3, `Орбитер-1 takes ${buildDays(d)} days, the second waits for the first`);
// site discovery in a 2026 career: land near Apollo 11, then walk up to it
const g2 = newGame('career', null, { start: dateToUt(Date.UTC(2026, 9, 2)) });
const ap = SITES.find(s => s.id === 'apollo11'), M = BODY.moon;
const v = buildVessel(makeDesign('Л', ['probe_p1']), 'Л');
placeOnPad(v, g2.ut, { body: 'moon', lat: (ap.lat + 0.3) * Math.PI / 180, lon: ap.lon * Math.PI / 180 });
v.prelaunch = false;
const found = siteCheck(g2, v, g2.ut);
ok(found.length === 1 && found[0].what === 'found', `landing ${found[0] && (found[0].dist / 1000).toFixed(1)} km away finds ${ap.name}`);
const k = buildVessel(makeDesign('К', ['kerbal']), 'К'); k.parts[0].crew = ['k1'];
placeOnPad(k, g2.ut, { body: 'moon', lat: ap.lat * Math.PI / 180 + 10 / M.R, lon: ap.lon * Math.PI / 180 });
k.prelaunch = false;
const insp = siteCheck(g2, k, g2.ut);
ok(insp.some(x => x.what === 'inspected'), 'an astronaut 10 m away inspects it');
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exitCode = fails ? 1 : 0;
