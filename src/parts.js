'use strict';
// Part catalog. Units: mass t (dry), resources t (ELEC in units), thrust kN (vacuum),
// torque kN*m, sizes m, cost in funds. LFO = liquid fuel + oxidizer as one propellant.

const CATS = [
  ['pod', 'Командные'], ['tank', 'Баки'], ['engine', 'Двигатели'], ['coupling', 'Разделение'],
  ['aero', 'Аэродинамика'], ['wheels', 'Колёса'], ['utility', 'Оборудование'], ['science', 'Наука'],
];

const RES_NAMES = { LFO: 'Топливо', SOLID: 'Твёрдое', MONO: 'Монотопливо', ELEC: 'Электричество', XENON: 'Ксенон', ABLATOR: 'Абляция' };
// price per tonne of each resource (funds)
const RES_COST = { LFO: 160, SOLID: 120, MONO: 1200, ELEC: 0, XENON: 40000, ABLATOR: 500 };

const P = [];
function part(o) { P.push(o); }

// ---- command ----
part({ id: 'pod_k1', name: 'Капсула К-1', cat: 'pod', tech: 'start', cost: 600, mass: 0.80, attach: 'stack', shape: 'pod',
  dTop: 0.625, dBot: 1.25, h: 1.05, res: { ELEC: 50, MONO: 0.03 }, command: { crew: 1, torque: 3 }, maxTemp: 2050, crash: 14, nose: 0.5,
  desc: 'Одноместная капсула. Маховик, батарея, доклад экипажа.' });
part({ id: 'pod_k3', name: 'Капсула К-3', cat: 'pod', tech: 'command_modules', cost: 3800, mass: 2.6, attach: 'stack', shape: 'pod',
  dTop: 1.25, dBot: 2.5, h: 1.65, res: { ELEC: 150, MONO: 0.12 }, command: { crew: 3, torque: 15 }, maxTemp: 2050, crash: 14, nose: 0.5,
  desc: 'Трёхместная капсула для дальних экспедиций.' });
part({ id: 'pod_cockpit', name: 'Кабина «Стриж»', cat: 'pod', tech: 'aviation', cost: 1600, mass: 1.0, attach: 'stack', shape: 'cockpit',
  dTop: 0, dBot: 1.25, h: 2.0, res: { ELEC: 60, MONO: 0.02 }, command: { crew: 1, torque: 4 }, maxTemp: 1900, crash: 16, nose: 0.12,
  desc: 'Обтекаемая одноместная кабина для самолётов и космопланов. Ставится носом вверх по стеку.' });
part({ id: 'probe_p0', name: 'Зонд ПЗ-0', cat: 'pod', tech: 'flight_control', cost: 450, mass: 0.08, attach: 'stack', shape: 'probe',
  dTop: 0.625, dBot: 0.625, h: 0.35, res: { ELEC: 10 }, command: { crew: 0, torque: 0.5, elecUse: 0.02 }, maxTemp: 1200, crash: 8,
  desc: 'Беспилотное управление. Требует электричество.' });
part({ id: 'probe_p1', name: 'Зонд ПЗ-1', cat: 'pod', tech: 'electrics', cost: 1100, mass: 0.2, attach: 'stack', shape: 'probe',
  dTop: 1.25, dBot: 1.25, h: 0.4, res: { ELEC: 40 }, command: { crew: 0, torque: 3, elecUse: 0.03 }, maxTemp: 1200, crash: 8,
  desc: 'Тяжёлый блок управления 1.25 м с маховиком.' });

// ---- tanks ----
const tank = (id, name, tech, d, h, dry, lfo, cost, extra) => part(Object.assign({ id, name, cat: 'tank', tech, cost, mass: dry, attach: 'stack',
  shape: 'tank', dTop: d, dBot: d, h, res: { LFO: lfo }, maxTemp: 2000, crash: 6, desc: `Топливо+окислитель ${lfo} т.` }, extra || {}));
tank('tank_t0s', 'Бак Т0-200', 'propulsion_systems', 0.625, 0.55, 0.025, 0.2, 70);
tank('tank_t1s', 'Бак Т1-100', 'basic_rocketry', 1.25, 0.55, 0.0625, 0.5, 150);
tank('tank_t1m', 'Бак Т1-200', 'basic_rocketry', 1.25, 1.1, 0.125, 1.0, 275);
tank('tank_t1l', 'Бак Т1-400', 'general_rocketry', 1.25, 1.9, 0.25, 2.0, 500);
tank('tank_t1xl', 'Бак Т1-800', 'adv_rocketry', 1.25, 3.75, 0.5, 4.0, 800);
tank('tank_t2m', 'Бак Т2-16', 'heavy_rocketry', 2.5, 1.9, 1.0, 8.0, 1550);
tank('tank_t2l', 'Бак Т2-32', 'heavy_rocketry', 2.5, 3.75, 2.0, 16.0, 3000);
tank('tank_t2xl', 'Бак Т2-64', 'heavier_rocketry', 2.5, 7.5, 4.0, 32.0, 5750);
tank('tank_t3m', 'Бак Т3-36', 'very_heavy', 3.75, 3.75, 4.5, 36.0, 6500);
tank('tank_t3l', 'Бак Т3-72', 'very_heavy', 3.75, 7.5, 9.0, 72.0, 12500);
tank('tank_a21', 'Бак-переходник А-21', 'heavier_rocketry', 0, 1.9, 0.5, 4.0, 800, { dTop: 1.25, dBot: 2.5, shape: 'adapterTank' });
part({ id: 'mono_s1', name: 'Бак монотоплива М-1', cat: 'tank', tech: 'command_modules', cost: 330, mass: 0.15, attach: 'stack', shape: 'monoTank',
  dTop: 1.25, dBot: 1.25, h: 0.45, res: { MONO: 0.6 }, maxTemp: 2000, crash: 6, desc: 'Монотопливо для РСУ.' });
part({ id: 'mono_r', name: 'Радиальный бак М-0', cat: 'tank', tech: 'flight_control', cost: 150, mass: 0.03, attach: 'radial', shape: 'monoRadial',
  h: 0.5, w: 0.3, depth: 0.3, res: { MONO: 0.12 }, maxTemp: 2000, crash: 8, desc: 'Малый радиальный бак монотоплива.' });
part({ id: 'xenon_r', name: 'Ксеноновый бак КР-1', cat: 'tank', tech: 'ion', cost: 2500, mass: 0.054, attach: 'radial', shape: 'xenonRadial',
  h: 0.6, w: 0.35, depth: 0.35, res: { XENON: 0.072 }, maxTemp: 2000, crash: 6, desc: 'Ксенон для ионного двигателя.' });
part({ id: 'xenon_s', name: 'Ксеноновый бак КС-1', cat: 'tank', tech: 'ion', cost: 2200, mass: 0.054, attach: 'stack', shape: 'xenonTank',
  dTop: 0.625, dBot: 0.625, h: 0.6, res: { XENON: 0.07 }, maxTemp: 2000, crash: 6, desc: 'Ксенон, стековый 0.625 м.' });

// ---- engines ----
const eng = (id, name, tech, d, h, mass, thrust, ispSL, ispVac, gimbal, cost, extra) => part(Object.assign({ id, name, cat: 'engine', tech, cost, mass,
  attach: 'stack', shape: 'engine', dTop: d, dBot: d, h, bell: 0.85, engine: { thrust, ispSL, ispVac, prop: 'LFO', gimbal, throttle: true },
  maxTemp: 2400, crash: 7, desc: `Тяга ${thrust} кН (вак.), УИ ${ispSL}/${ispVac} с.` }, extra || {}));
eng('eng_spark', 'ЖРД «Искра»', 'propulsion_systems', 0.625, 0.55, 0.13, 20, 265, 320, 3, 240);
eng('eng_reliant', 'ЖРД «Опора»', 'basic_rocketry', 1.25, 1.35, 1.25, 240, 265, 310, 0, 1100);
eng('eng_swivel', 'ЖРД «Шарнир»', 'general_rocketry', 1.25, 1.35, 1.5, 215, 250, 320, 3, 1200);
eng('eng_terrier', 'ЖРД «Терьер»', 'adv_rocketry', 1.25, 0.95, 0.5, 60, 85, 345, 4, 390, { bell: 0.9 });
eng('eng_poodle', 'ЖРД «Пудель»', 'propulsion_systems', 2.5, 1.6, 1.75, 250, 90, 350, 4.5, 1300, { bell: 0.75 });
eng('eng_skipper', 'ЖРД «Шкипер»', 'heavy_rocketry', 2.5, 2.3, 3, 650, 280, 320, 2, 5300);
eng('eng_mainsail', 'ЖРД «Грот»', 'heavier_rocketry', 2.5, 2.9, 6, 1500, 285, 310, 2, 13000);
eng('eng_mammoth', 'ЖРД «Мамонт»', 'very_heavy', 3.75, 3.6, 15, 4000, 295, 315, 2, 39000);
eng('eng_nerv', 'ЯРД «Атом»', 'nuclear', 1.25, 3.0, 3, 60, 185, 800, 0, 10000, { bell: 0.7, shape: 'nuclear' });
// air-breathing: only in an oxygen atmosphere (Earth); thrust follows air density and Mach number
eng('jet_basic', 'ТРД «Сокол»', 'aviation', 1.25, 1.6, 1.2, 90, 3200, 3200, 1, 1800, { shape: 'jet',
  engine: { thrust: 90, ispSL: 3200, ispVac: 3200, prop: 'LFO', gimbal: 1, throttle: true, air: { peak: 0.9, machMax: 3.0, spool: 1.6 } },
  desc: 'Турбореактивный, 90 кН. Только в кислородной атмосфере, до ~3 М. Топлива тратит в 10 раз меньше ракетного.' });
eng('jet_turbo', 'ТРД «Вихрь»', 'supersonic', 1.25, 2.4, 2.1, 130, 2600, 2600, 1, 4200, { shape: 'jet',
  engine: { thrust: 130, ispSL: 2600, ispVac: 2600, prop: 'LFO', gimbal: 1, throttle: true, air: { peak: 2.8, machMax: 5.6, spool: 2.2 } },
  desc: 'Турбореактивный с форсажем, 130 кН, до ~5.5 М: разгоняет космоплан почти до орбитальной скорости.' });
eng('eng_ion', 'ИД «Ион»', 'ion', 0.625, 0.4, 0.25, 2, 100, 4200, 0, 8000, { shape: 'ion',
  engine: { thrust: 2, ispSL: 100, ispVac: 4200, prop: 'XENON', gimbal: 0, throttle: true, elec: 8.74 }, desc: 'Тяга 2 кН, УИ 4200 с. Ксенон + 8.7 эл/с.' });

// ---- solid boosters ----
const srb = (id, name, tech, d, h, dry, solid, thrust, ispSL, ispVac, cost) => part({ id, name, cat: 'engine', tech, cost, mass: dry, attach: 'stack',
  shape: 'srb', dTop: d, dBot: d, h, bell: 0.6, res: { SOLID: solid }, engine: { thrust, ispSL, ispVac, prop: 'SOLID', gimbal: 0, throttle: false },
  maxTemp: 2000, crash: 7, desc: `Твердотопливный. Тяга ${thrust} кН, горит ~${Math.round(solid / (thrust / (ispVac * G0)))} с. Не выключается.` });
srb('srb_flea', 'РДТТ «Блоха»', 'start', 1.25, 1.5, 0.45, 1.05, 192, 140, 165, 116);
srb('srb_hammer', 'РДТТ «Молот»', 'basic_rocketry', 1.25, 3.3, 0.75, 2.81, 227, 170, 195, 175);
srb('srb_thumper', 'РДТТ «Ударник»', 'general_rocketry', 1.25, 5.2, 1.5, 6.15, 300, 175, 210, 450);
srb('srb_kickback', 'РДТТ «Отдача»', 'adv_rocketry', 1.25, 9.4, 4.5, 19.5, 670, 195, 220, 2700);
srb('srb_big', 'РДТТ «Колосс»', 'heavier_rocketry', 2.5, 11, 9, 50, 2000, 200, 230, 6000);

// ---- coupling / structural ----
const dec = (id, name, tech, d, h, mass, cost) => part({ id, name, cat: 'coupling', tech, cost, mass, attach: 'stack', shape: 'decoupler',
  dTop: d, dBot: d, h, decoupler: 'stack', maxTemp: 2000, crash: 9, desc: 'Отделяет нижнюю часть ракеты. Сам уходит вместе с ней.' });
dec('dec_s0', 'Расстыковщик Р-0', 'propulsion_systems', 0.625, 0.12, 0.01, 200);
dec('dec_s1', 'Расстыковщик Р-1', 'engineering101', 1.25, 0.2, 0.04, 300);
dec('dec_s2', 'Расстыковщик Р-2', 'heavy_rocketry', 2.5, 0.25, 0.4, 600);
dec('dec_s3', 'Расстыковщик Р-3', 'very_heavy', 3.75, 0.3, 0.8, 900);
part({ id: 'dec_r', name: 'Радиальный расстыковщик', cat: 'coupling', tech: 'general_rocketry', cost: 400, mass: 0.025, attach: 'radial',
  shape: 'radialDecoupler', h: 0.6, w: 0.3, depth: 0.15, decoupler: 'radial', mount: true, maxTemp: 2000, crash: 8,
  desc: 'Крепит боковой блок (ускоритель) и отстреливает его. На него ставятся баки и двигатели.' });
const adapt = (id, name, tech, dTop, dBot, h, mass, cost) => part({ id, name, cat: 'coupling', tech, cost, mass, attach: 'stack', shape: 'adapter',
  dTop, dBot, h, maxTemp: 2000, crash: 8, desc: `Переходник ${dBot} → ${dTop} м.` });
adapt('adapt_10', 'Переходник 1.25→0.625', 'gen_construction', 0.625, 1.25, 0.5, 0.04, 120);
adapt('adapt_21', 'Переходник 2.5→1.25', 'heavy_rocketry', 1.25, 2.5, 0.8, 0.15, 300);
adapt('adapt_32', 'Переходник 3.75→2.5', 'very_heavy', 2.5, 3.75, 1.2, 0.3, 600);
const dockPart = (id, name, d, h, mass, cost, size) => part({ id, name, cat: 'coupling', tech: 'docking', cost, mass, attach: 'stack', shape: 'dock',
  dTop: d, dBot: d, h, dock: { size }, maxTemp: 2000, crash: 9,
  desc: `Свободный торец стыкуется с таким же узлом ${d} м другого корабля: подойдите соосно медленнее 1 м/с. Через стык течёт топливо.` });
dockPart('dock_s', 'Стыковочный узел С-1', 0.625, 0.22, 0.02, 280, 0);
dockPart('dock_m', 'Стыковочный узел С-2', 1.25, 0.3, 0.05, 380, 1);

// ---- aero ----
const nose = (id, name, tech, d, h, mass, cost) => part({ id, name, cat: 'aero', tech, cost, mass, attach: 'stack', shape: 'cone',
  dTop: 0, dBot: d, h, nose: 0.15, maxTemp: 2400, crash: 9, desc: 'Снижает лобовое сопротивление.' });
nose('nose_s0', 'Обтекатель 0.625', 'gen_construction', 0.625, 0.5, 0.01, 120);
nose('nose_s1', 'Обтекатель 1.25', 'stability', 1.25, 1.0, 0.03, 240);
nose('nose_s2', 'Обтекатель 2.5', 'heavy_rocketry', 2.5, 1.8, 0.15, 400);
// wings: radial, span outward (depth), chord along the fuselage (h); lift with stall, induced drag
const wing = (id, name, tech, span, chord, area, mass, cost, extra) => part(Object.assign({ id, name, cat: 'aero', tech, cost, mass, attach: 'radial', shape: 'wing',
  h: chord, w: 0.12, depth: span, wing: { area, k: 4.6, stall: 15 }, maxTemp: 2200, crash: 14, desc: `Подъёмная сила, площадь ${area} м². Срыв потока при угле атаки больше ~15°.` }, extra || {}));
wing('wing_s', 'Крыло К-1', 'aviation', 2.4, 1.3, 2.6, 0.12, 300);
wing('wing_m', 'Крыло К-2', 'aviation', 3.6, 1.8, 5.4, 0.26, 550);
wing('wing_d', 'Дельта-крыло', 'supersonic', 3.4, 3.2, 7.2, 0.38, 950, { sweep: 0.8, wing: { area: 7.2, k: 3.6, stall: 22 }, desc: 'Дельта: меньше подъёмная сила, зато срыв на больших углах (~22°). Для космопланов.' });
part({ id: 'elevon', name: 'Элевон', cat: 'aero', tech: 'aviation', cost: 250, mass: 0.05, attach: 'radial', shape: 'elevon', h: 0.65, w: 0.08, depth: 1.2,
  wing: { area: 1.0, k: 4.2, stall: 18, ctrl: 22 }, maxTemp: 2200, crash: 12,
  desc: 'Руль: сам работает на тангаж, рыскание или крен — в зависимости от того, где стоит. Ставьте у хвоста и на концах крыльев.' });
part({ id: 'fin', name: 'Стабилизатор', cat: 'aero', tech: 'stability', cost: 150, mass: 0.05, attach: 'radial', shape: 'fin',
  h: 1.0, w: 0.04, depth: 0.65, fin: { area: 0.55 }, maxTemp: 2400, crash: 12, desc: 'Аэродинамическая устойчивость. Ставьте у хвоста.' });
part({ id: 'fin_big', name: 'Большой стабилизатор', cat: 'aero', tech: 'heavy_rocketry', cost: 300, mass: 0.12, attach: 'radial', shape: 'fin',
  h: 1.8, w: 0.06, depth: 1.1, fin: { area: 1.6 }, maxTemp: 2400, crash: 12, desc: 'Для тяжёлых ракет.' });

// ---- utility ----
const chute = (id, name, tech, attach, d, h, mass, full, safe, cost, desc) => part({ id, name, cat: 'utility', tech, cost, mass, attach,
  shape: attach === 'radial' ? 'chuteRadial' : 'chute', dTop: d * 0.6, dBot: d, h, w: 0.35, depth: 0.3,
  chute: { semi: full * 0.012, full, minP: 0.01, deployAlt: 1000, safe }, maxTemp: 2400, crash: 12, desc });
chute('chute_s', 'Парашют П-16', 'start', 'stack', 0.625, 0.35, 0.1, 500, 330, 420, 'Ставится на верх капсулы. Раскрывается в атмосфере.');
chute('chute_r', 'Радиальный парашют', 'survivability', 'radial', 0.3, 0.6, 0.1, 450, 330, 400, 'Крепится на борт.');
chute('chute_drogue', 'Тормозной парашют', 'survivability', 'stack', 0.625, 0.35, 0.075, 70, 650, 400, 'Раскрывается на большой скорости.');
chute('chute_l', 'Парашют П-25', 'command_modules', 'stack', 1.25, 0.5, 0.25, 1900, 330, 1000, 'Большой купол для тяжёлых капсул.');
const shield = (id, name, tech, d, h, mass, abl, cost) => part({ id, name, cat: 'utility', tech, cost, mass, attach: 'stack', shape: 'shield',
  dTop: d, dBot: d * 1.04, h, res: { ABLATOR: abl }, shield: true, maxTemp: 3300, crash: 9, desc: 'Защищает при входе в атмосферу. Направьте его вперёд по полёту.' });
shield('shield_s1', 'Теплощит Т-1', 'survivability', 1.25, 0.2, 0.1, 0.2, 300);
shield('shield_s2', 'Теплощит Т-2', 'command_modules', 2.5, 0.3, 0.6, 0.8, 900);
shield('shield_s3', 'Теплощит Т-3', 'very_heavy', 3.75, 0.35, 1.3, 1.8, 1700);
part({ id: 'wheel_s0', name: 'Маховик РМ-0', cat: 'utility', tech: 'flight_control', cost: 300, mass: 0.05, attach: 'stack', shape: 'wheel',
  dTop: 0.625, dBot: 0.625, h: 0.2, wheel: { torque: 1.5 }, maxTemp: 2000, crash: 9, desc: 'Момент 1.5 кН·м, тратит электричество.' });
part({ id: 'wheel_s1', name: 'Маховик РМ-1', cat: 'utility', tech: 'stability', cost: 600, mass: 0.1, attach: 'stack', shape: 'wheel',
  dTop: 1.25, dBot: 1.25, h: 0.3, wheel: { torque: 6 }, maxTemp: 2000, crash: 9, desc: 'Момент 6 кН·м, тратит электричество.' });
part({ id: 'battery_s', name: 'Батарея Б-100', cat: 'utility', tech: 'electrics', cost: 80, mass: 0.005, attach: 'radial', shape: 'battery',
  h: 0.35, w: 0.25, depth: 0.12, res: { ELEC: 100 }, maxTemp: 1200, crash: 8, desc: '100 ед. заряда.' });
part({ id: 'battery_l', name: 'Батарея Б-1000', cat: 'utility', tech: 'electrics', cost: 880, mass: 0.05, attach: 'stack', shape: 'batteryStack',
  dTop: 1.25, dBot: 1.25, h: 0.25, res: { ELEC: 1000 }, maxTemp: 1200, crash: 8, desc: '1000 ед. заряда.' });
part({ id: 'solar_s', name: 'Солнечная панель СП-1', cat: 'utility', tech: 'electrics', cost: 75, mass: 0.005, attach: 'radial', shape: 'solar',
  h: 0.5, w: 0.5, depth: 0.05, solar: { rate: 0.35 }, maxTemp: 1200, crash: 6, desc: '0.35 эл/с на орбите Земли.' });
part({ id: 'solar_l', name: 'Раскладная панель СП-6', cat: 'utility', tech: 'adv_electrics', cost: 380, mass: 0.025, attach: 'radial', shape: 'solarBig',
  h: 0.7, w: 0.3, depth: 0.1, solar: { rate: 1.64 }, maxTemp: 1200, crash: 6, desc: '1.64 эл/с на орбите Земли.' });
part({ id: 'legs', name: 'Посадочная опора', cat: 'utility', tech: 'gen_construction', cost: 440, mass: 0.05, attach: 'radial', shape: 'legs',
  h: 1.0, w: 0.2, depth: 0.25, legs: { len: 1.3, crash: 12 }, maxTemp: 2000, crash: 10, desc: 'Клавиша G. Мягкая посадка до 12 м/с.' });
part({ id: 'legs_l', name: 'Большая опора', cat: 'utility', tech: 'adv_exploration', cost: 800, mass: 0.12, attach: 'radial', shape: 'legs',
  h: 1.6, w: 0.3, depth: 0.35, legs: { len: 2.2, crash: 14 }, maxTemp: 2000, crash: 12, desc: 'Для тяжёлых посадочных модулей.' });
part({ id: 'rcs', name: 'Блок РСУ', cat: 'utility', tech: 'flight_control', cost: 45, mass: 0.04, attach: 'radial', shape: 'rcs',
  h: 0.25, w: 0.2, depth: 0.18, rcs: { thrust: 1, isp: 240 }, maxTemp: 2000, crash: 8, desc: 'Ориентация и сдвиг (клавиша R, IJKLHN).' });
part({ id: 'antenna', name: 'Антенна А-1', cat: 'utility', tech: 'engineering101', cost: 300, mass: 0.005, attach: 'radial', shape: 'antenna',
  h: 0.9, w: 0.05, depth: 0.08, antenna: { rate: 3.3 }, maxTemp: 1500, crash: 7, desc: 'Передача научных данных домой.' });

// ---- wheels: radial, the wheel sits `reach` outward along the attachment direction; point it down (-Z) ----
part({ id: 'gear_s', name: 'Шасси Ш-1', cat: 'wheels', tech: 'aviation', cost: 450, mass: 0.04, attach: 'radial', shape: 'gear', h: 0.5, w: 0.26, depth: 0.22,
  gear: { reach: 0.75, r: 0.22, travel: 0.25, steer: 25, crash: 14, retract: true }, maxTemp: 1800, crash: 14,
  desc: 'Убирающееся шасси (G). B — тормоз, A/D — руление передней стойкой. Крепите вниз (на «брюхо»).' });
part({ id: 'gear_l', name: 'Шасси Ш-2', cat: 'wheels', tech: 'supersonic', cost: 900, mass: 0.12, attach: 'radial', shape: 'gear', h: 0.7, w: 0.36, depth: 0.3,
  gear: { reach: 1.05, r: 0.32, travel: 0.35, steer: 20, crash: 18, retract: true }, maxTemp: 1800, crash: 18, desc: 'Усиленное шасси для тяжёлых самолётов.' });
part({ id: 'wheel_rover', name: 'Колесо В-1', cat: 'wheels', tech: 'ground_vehicles', cost: 600, mass: 0.08, attach: 'radial', shape: 'roverWheel', h: 0.75, w: 0.36, depth: 0.25,
  gear: { reach: 0.36, r: 0.36, travel: 0.16, steer: 30, crash: 10, motor: { force: 1.0, speed: 11, elec: 0.6 } }, maxTemp: 1500, crash: 10,
  desc: 'Ведущее колесо: W/S — газ, A/D — руль, B — тормоз. Тратит электричество. Крепите вниз.' });

// ---- science ----
const sci = (id, name, tech, exp, cost, mass, extra, desc) => part(Object.assign({ id, name, cat: 'science', tech, cost, mass, attach: 'radial',
  shape: 'sci', h: 0.3, w: 0.18, depth: 0.12, sci: exp, maxTemp: 1500, crash: 8, desc }, extra || {}));
sci('sci_thermo', 'Термометр', 'engineering101', 'temperature', 900, 0.005, null, 'Замер температуры в любой ситуации.');
sci('sci_baro', 'Барометр', 'basic_science', 'pressure', 880, 0.005, null, 'Замер давления в атмосфере или на поверхности.');
sci('sci_goo', 'Контейнер с гелем', 'basic_science', 'goo', 800, 0.05, { shape: 'goo', h: 0.5, w: 0.35, depth: 0.3 }, 'Одноразовый эксперимент. Данные ценны при возвращении.');
sci('sci_seismic', 'Сейсмометр', 'adv_exploration', 'seismic', 1500, 0.005, null, 'Только на поверхности.');
sci('sci_grav', 'Гравиметр', 'adv_exploration', 'gravity', 2200, 0.005, null, 'На поверхности или в космосе.');
sci('sci_atmo', 'Анализатор атмосферы', 'adv_exploration', 'atmosphere', 3000, 0.1, { h: 0.5, w: 0.3, depth: 0.2 }, 'В атмосфере.');
part({ id: 'sci_scanner', name: 'Картограф МК-1', cat: 'science', tech: 'remote_sensing', cost: 3600, mass: 0.06, attach: 'radial', shape: 'scanner',
  h: 0.45, w: 0.3, depth: 0.25, scanner: { fov: 12, minAlt: 0.02, maxAlt: 1.5, elec: 0.4 }, maxTemp: 1500, crash: 8,
  desc: 'На орбите снимает полосу поверхности под собой: открывает биомы в Атласе и приносит науку за покрытие. Тратит электричество.' });
part({ id: 'sci_matbay', name: 'Отсек материаловедения', cat: 'science', tech: 'science_tech', cost: 880, mass: 0.2, attach: 'stack', shape: 'matbay',
  dTop: 1.25, dBot: 1.25, h: 0.8, sci: 'materials', maxTemp: 1500, crash: 8, desc: 'Одноразовый, очень ценный эксперимент.' });

// not in the catalogue: an astronaut on EVA and a planted flag (each is a one-part vessel)
part({ id: 'kerbal', name: 'Космонавт', cat: 'pod', tech: 'start', hidden: true, cost: 0, mass: 0.094, attach: 'stack', shape: 'kerbal',
  dTop: 0.42, dBot: 0.42, h: 1.25, command: { crew: 1, torque: 0.1 }, kerbal: true, maxTemp: 900, crash: 9, desc: '' });
part({ id: 'flag', name: 'Флаг', cat: 'utility', tech: 'start', hidden: true, cost: 0, mass: 0.02, attach: 'stack', shape: 'flag',
  dTop: 0.06, dBot: 0.3, h: 2.6, flag: true, maxTemp: 1500, crash: 30, desc: '' });

const PART = {};
for (const p of P) {
  p.res = p.res || {};
  p.wetMass = p.mass + Object.entries(p.res).reduce((s, [k, v]) => s + (k === 'ELEC' ? 0 : v), 0);
  p.fullCost = p.cost + Object.entries(p.res).reduce((s, [k, v]) => s + (RES_COST[k] || 0) * (k === 'ELEC' ? 0 : v), 0);
  p.stageable = !!(p.engine || p.decoupler || p.chute);
  if (p.attach === 'stack') { p.dTop = p.dTop == null ? p.dBot : p.dTop; p.dBot = p.dBot == null ? p.dTop : p.dBot; }
  PART[p.id] = p;
}
const PARTS = P;

// ---- experiments ----
// situations: L landed, FL flying low, FH flying high, SL space low, SH space high
const SIT_NAMES = { L: 'на поверхности', FL: 'в нижней атмосфере', FH: 'в верхней атмосфере', SL: 'на низкой орбите', SH: 'в высоком космосе' };
const SIT_INDEX = { L: 0, FL: 1, FH: 2, SL: 3, SH: 4 };
const EXPERIMENTS = {
  crew: { name: 'Доклад экипажа', base: 5, cap: 5, xmit: 1.0, sits: 'L FL FH SL SH' },
  temperature: { name: 'Замер температуры', base: 8, cap: 8, xmit: 0.5, sits: 'L FL FH SL SH' },
  pressure: { name: 'Замер давления', base: 12, cap: 12, xmit: 0.5, sits: 'L FL FH', needAtm: true },
  goo: { name: 'Наблюдение за гелем', base: 10, cap: 13, xmit: 0.3, sits: 'L FL FH SL SH', single: true },
  materials: { name: 'Материаловедение', base: 25, cap: 32, xmit: 0.35, sits: 'L FL FH SL SH', single: true },
  seismic: { name: 'Сейсмика', base: 20, cap: 22, xmit: 0.45, sits: 'L' },
  gravity: { name: 'Гравиметрия', base: 20, cap: 22, xmit: 0.4, sits: 'L SL SH' },
  atmosphere: { name: 'Анализ атмосферы', base: 20, cap: 24, xmit: 0.6, sits: 'L FL FH', needAtm: true },
  mapping: { name: 'Картографирование', base: 30, cap: 30, xmit: 1, sits: 'SL SH', auto: true },
  eva: { name: 'Доклад из скафандра', base: 8, cap: 8, xmit: 1.0, sits: 'L FL FH SL SH', byEva: true },
  sample: { name: 'Образец грунта', base: 30, cap: 40, xmit: 0.25, sits: 'L', byEva: true, solid: true },
};

// ---- tech tree ----
// [id, name, cost, prerequisites (any one unlocks), column, row]
const TECH = [
  ['start', 'Начало', 0, [], 0, 3],
  ['basic_rocketry', 'Основы ракетостроения', 5, ['start'], 1, 2],
  ['engineering101', 'Инженерия 101', 5, ['start'], 1, 4],
  ['basic_science', 'Основы науки', 5, ['start'], 1, 6],
  ['survivability', 'Живучесть', 15, ['basic_rocketry'], 2, 1],
  ['general_rocketry', 'Общее ракетостроение', 20, ['basic_rocketry'], 2, 2],
  ['stability', 'Устойчивость', 18, ['engineering101'], 2, 4],
  ['adv_rocketry', 'Продвинутые ракеты', 45, ['general_rocketry'], 3, 2],
  ['gen_construction', 'Конструкции', 45, ['general_rocketry', 'engineering101'], 3, 3],
  ['flight_control', 'Управление полётом', 45, ['stability'], 3, 4],
  ['science_tech', 'Научные технологии', 45, ['basic_science', 'survivability'], 3, 6],
  ['heavy_rocketry', 'Тяжёлые ракеты', 90, ['adv_rocketry'], 4, 1],
  ['command_modules', 'Командные модули', 90, ['flight_control', 'survivability'], 4, 4],
  ['electrics', 'Электрика', 90, ['science_tech'], 4, 6],
  ['propulsion_systems', 'Двигательные системы', 160, ['adv_rocketry', 'gen_construction'], 5, 2],
  ['adv_exploration', 'Исследование тел', 160, ['science_tech', 'gen_construction'], 5, 5],
  ['docking', 'Стыковка', 160, ['command_modules', 'gen_construction'], 5, 3],
  ['aviation', 'Авиация', 40, ['stability'], 3, 5],
  ['ground_vehicles', 'Наземная техника', 90, ['aviation', 'electrics'], 4, 5],
  ['supersonic', 'Сверхзвуковая авиация', 220, ['aviation', 'propulsion_systems'], 5, 6],
  ['remote_sensing', 'Дистанционное зондирование', 200, ['adv_exploration', 'electrics'], 6, 4],
  ['heavier_rocketry', 'Сверхтяжёлые ракеты', 300, ['heavy_rocketry'], 6, 1],
  ['adv_electrics', 'Продвинутая электрика', 300, ['electrics'], 6, 6],
  ['very_heavy', 'Гигантские ракеты', 550, ['heavier_rocketry'], 7, 0],
  ['nuclear', 'Ядерные двигатели', 550, ['heavier_rocketry', 'propulsion_systems'], 7, 2],
  ['ion', 'Ионные двигатели', 550, ['adv_electrics', 'propulsion_systems'], 7, 5],
].map(([id, name, cost, req, col, row]) => ({ id, name, cost, req, col, row, parts: P.filter(p => p.tech === id && !p.hidden).map(p => p.id) }));
const TECH_BY_ID = Object.fromEntries(TECH.map(t => [t.id, t]));
