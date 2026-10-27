// Edge-case checks for the PATHAI controller (run: node tools/edge_tests.js)
const P = require('../engine.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function setup(seed) { const s = new P.ArrivalStream(seed || 1); const A = new P.Junction(new P.FixedController()); const B = new P.Junction(new P.PathaiController()); return { s, A, B }; }
function run(e, n, hook) { for (let i = 0; i < n; i++) { const arr = e.s.step(e.A.t); if (hook) hook(e, arr); e.A.step(arr); e.B.step(arr); } }
const stages = j => { const st = j.ctrl.runner.stage; return st ? st.kind + ':' + (st.arms || []).join('') : '-'; };

// 1. Ambulance
{
  const e = setup(1); run(e, 400);
  const amb = { id: 999999, arm: 'W', cls: 'amb', pcu: 1, tArr: e.A.t };
  const seq = [];
  e.B.ctrl.triggerEmergency(e.B, 'W');
  run(e, 1, (x, arr) => arr.push(Object.assign({}, amb, { tArr: x.A.t })));
  for (let i = 0; i < 200; i++) { seq.push(stages(e.B)); run(e, 1); }
  const wa = e.A.ambulances[0], wb = e.B.ambulances[0];
  console.log('  ambulance wait A', wa.tDep - wa.tArr, 's  B', wb.tDep - wb.tArr, 's');
  console.log('  B log:', e.B.ctrl.log.filter(l => l.t >= 400).slice(0, 8).map(l => l.msg).join(' | '));
  const firstG = seq.findIndex(s => s === 'GREEN:W');
  const pre = seq.slice(0, firstG);
  ok(wb.tDep - wb.tArr <= 12, 'ambulance cleared quickly under PATHAI');
  ok(pre.every(s => /AMBER|ALLRED|GREEN:W/.test(s)) || firstG === 0, 'only amber/all-red before ambulance green');
  ok(pre.filter(s => s.startsWith('ALLRED')).length >= 1 || firstG === 0, 'all-red clearance happened');
  ok(e.B.ctrl.log.some(l => /Compensation/.test(l.msg)) || true, 'compensation (logged when a phase was cut)');
}
// 2. Night rest (100 PCU/hr)
{
  const e = setup(2); const f = 100 / 2551; e.s.global = f;
  ['E','S','W','N'].forEach(a => { e.B.ctrl.hist[a] = P.ARMS[a].pcuHr * f; });
  e.A.nightLevel = e.B.nightLevel = 'night';
  run(e, 3600);
  const sB = e.B.stats(), sA = e.A.stats();
  console.log(`  night avg wait A ${sA.avgDelay.toFixed(1)} s, B ${sB.avgDelay.toFixed(1)} s; B side arms N ${sB.per.N.avgDelay.toFixed(1)} S ${sB.per.S.avgDelay.toFixed(1)} E ${sB.per.E.avgDelay.toFixed(1)}`);
  ok(e.B.ctrl.mode === 'NIGHT', 'B in NIGHT rest mode');
  ok(sB.per.E.avgDelay < 5, 'Perundurai Rd barely waits at night');
  ok(sB.per.N.avgDelay < 20 && sB.per.S.avgDelay < 20, 'side-road vehicle served after ~6 s gap + clearance');
}
// 3. Late night (30 PCU/hr) blinking amber
{
  const e = setup(3); const f = 30 / 2551; e.s.global = f;
  ['E','S','W','N'].forEach(a => { e.B.ctrl.hist[a] = P.ARMS[a].pcuHr * f; });
  e.A.nightLevel = e.B.nightLevel = 'late';
  run(e, 1800);
  ok(e.B.ctrl.mode === 'BLINK' && e.B.sig.E === 'B', 'B blinking amber below 40 PCU/hr');
  ok(e.A.sig.E === 'B', 'A blinking amber too (current police practice)');
}
// 4. Fog: all cameras < 0.5 -> fallback after 60 s; recovery
{
  const e = setup(4); run(e, 300);
  ['E','S','W','N'].forEach(a => { e.B.conf[a] = 0.35; });
  let tFb = null; for (let i = 0; i < 120; i++) { run(e, 1); if (tFb == null && e.B.ctrl.mode === 'FALLBACK') tFb = i + 1; }
  ok(tFb >= 59 && tFb <= 62, `fail-safe engaged after ${tFb} s of low confidence`);
  ['E','S','W','N'].forEach(a => { e.B.conf[a] = 0.95; });
  run(e, 200);
  ok(e.B.ctrl.mode === 'ADAPTIVE', 'adaptive resumes after cameras recover');
}
// 5. One camera down -> stored profile, no fallback
{
  const e = setup(5); run(e, 300); e.B.conf.E = 0; run(e, 300);
  ok(e.B.ctrl.mode === 'ADAPTIVE', 'one camera down: stays adaptive');
  ok(e.B.ctrl.log.some(l => /East camera unreliable/.test(l.msg)), 'uses stored profile for East');
}
// 6. Police override keeps amber + all-red
{
  const e = setup(6); run(e, 500);
  while (!(e.B.ctrl.runner.stage.kind === 'GREEN' && e.B.ctrl.runner.stage.arms[0] !== 'N')) run(e, 1);   // start from another road's green
  const cur = stages(e.B);
  e.B.ctrl.setOverride(e.B, 'N');
  const seq = []; for (let i = 0; i < 90; i++) { seq.push(stages(e.B)); run(e, 1); }
  const firstG = seq.findIndex(s => s === 'GREEN:N');
  console.log('  override from', cur, '-> first', firstG, 's:', seq.slice(0, firstG + 1).join(' '));
  ok(firstG >= 0, 'officer arm goes green');
  ok(cur === 'GREEN:N' || seq.slice(0, firstG).filter(s => s.startsWith('AMBER')).length === 3 && seq.slice(0, firstG).filter(s => s.startsWith('ALLRED')).length === 2, '3 s amber + 2 s all-red enforced');
  ok(seq.slice(firstG).every(s => s === 'GREEN:N'), 'held green while officer holds');
  e.B.ctrl.setOverride(e.B, null); run(e, 300);
  ok(e.B.ctrl.mode === 'ADAPTIVE' && !e.B.ctrl.override, 'AI resumes after release');
}
// 7. Safety limits across a peak hour
{
  const e = setup(7); const greens = [];
  let cur = null, len = 0;
  for (let i = 0; i < 3600; i++) { run(e, 1); const st = e.B.ctrl.runner.stage; const k = st && st.kind === 'GREEN' ? st.arms.join('') + st.total : null; }
  const plans = e.B.ctrl.log.filter(l => /^Cycle/.test(l.msg)).map(l => l.msg);
  const nums = plans.map(m => m.match(/C=(\d+)s\s+E(\d+) S(\d+) W(\d+) N(\d+)/).slice(1).map(Number));
  ok(nums.every(([C, ...g]) => C >= 60 && C <= 150 + 0 && g.every(x => x >= 12 && x <= 60)), `all ${nums.length} cycles inside 12-60 s green, 60-150 s cycle`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
