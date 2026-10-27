// Produces every number used on Slides 6-8 (run: node tools/slide_numbers.js > results.json)
const P = require('../engine.js');
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rng = a => [Math.min(...a), Math.max(...a)];
function summ(list) {
  const o = {};
  ['cleared', 'clearedHr', 'avgDelay', 'maxQueueM', 'maxQueuePcu', 'stopsPerVeh', 'idleVehHr', 'fuelL', 'co2kg', 'arrived'].forEach(k => { const v = list.map(s => s[k]); o[k] = { mean: mean(v), range: rng(v) }; });
  o.per = {}; P.ORDER.forEach(a => { o.per[a] = {}; ['avgDelay', 'maxQm', 'x', 'dep', 'n'].forEach(k => { const v = list.map(s => s.per[a][k]); o.per[a][k] = { mean: mean(v), range: rng(v) }; }); });
  o.worstArm = mean(list.map(s => Math.max(...P.ORDER.map(a => s.per[a].avgDelay))));
  return o;
}
const seeds = [1, 2, 3, 4, 5];
const peak = seeds.map(s => P.runPaired(s, { measureEnd: 900, duration: 1800 }));
const hour = seeds.map(s => P.runPaired(s, { measureEnd: 3600, duration: 4500 }));
const out = { peak15: { A: summ(peak.map(r => r.A)), B: summ(peak.map(r => r.B)) }, hour60: { A: summ(hour.map(r => r.A)), B: summ(hour.map(r => r.B)) } };

// variants = "what we changed"
const variants = { v1_profile_only: { histWeight: 1, useCarry: false, useQueueOrder: false }, v2_live_counts: { useCarry: false, useQueueOrder: false }, v3_carry: { useQueueOrder: false }, v4_final: {} };
out.variants = {};
for (const [k, o] of Object.entries(variants)) { const r = seeds.map(s => P.runPaired(s, { pathai: o, measureEnd: 900, duration: 1800 }).B); out.variants[k] = { avgDelay: mean(r.map(x => x.avgDelay)), worstArm: mean(r.map(x => Math.max(...P.ORDER.map(a => x.per[a].avgDelay)))), north: mean(r.map(x => x.per.N.avgDelay)) }; }

// ambulance: 20 trials (4 seeds x 5 trigger times inside the peak)
const amb = { A: [], B: [] };
for (const seed of [1, 2, 3, 4]) for (const t0 of [130, 290, 450, 610, 770]) {
  const ev = {}; ev[t0] = (A, B, arr) => { arr.push({ id: 900000 + t0, arm: 'W', cls: 'amb', pcu: 1, tArr: t0 }); B.ctrl.triggerEmergency(B, 'W'); };
  const r = P.runPaired(seed, { measureEnd: 900, duration: 1100, events: ev });
  amb.A.push(r.A.ambulances[0].wait); amb.B.push(r.B.ambulances[0].wait);
}
out.ambulance = { A: { mean: mean(amb.A), range: rng(amb.A) }, B: { mean: mean(amb.B), range: rng(amb.B) }, trials: amb.A.length };
console.log(JSON.stringify(out, null, 1));
