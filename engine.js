/*
 * PATHAI simulation engine — Surampatti Four Road Junction, Erode
 * Shared by the browser app (index.html) and the Node test runner (tools/experiments.js).
 *
 * Every junction number below comes from our Round 1 worksheet. Anything that is an
 * assumption (not measured by us) is marked ASSUMPTION and is listed in the app's "Data" panel.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- data
  const CLASSES = {
    tw:   { label: '2-wheeler',  pcu: 0.5, len: 2.0, color: '#4f8df5', idleLph: 0.157, co2PerL: 2.31 },
    car:  { label: 'Car',        pcu: 1.0, len: 4.2, color: '#e8eef7', idleLph: 0.663, co2PerL: 2.31 },
    auto: { label: 'Auto',       pcu: 0.8, len: 2.8, color: '#f5c542', idleLph: 0.376, co2PerL: 2.31 },
    lcv:  { label: 'LCV',        pcu: 1.4, len: 5.0, color: '#9b7bf0', idleLph: 0.752, co2PerL: 2.68 },
    bus:  { label: 'Bus/Truck',  pcu: 3.0, len: 10.5, color: '#f08a4b', idleLph: 0.900, co2PerL: 2.68 },
    amb:  { label: 'Ambulance',  pcu: 1.0, len: 5.0, color: '#ffffff', idleLph: 0.752, co2PerL: 2.68 },
  };

  // Round 1, slide 2 (10-minute peak count, 18:15-18:25 weekday) and slide 3 (signal study).
  // mix10 = vehicles per class in those 10 minutes. ASSUMPTION: only the East two-wheeler count (190)
  // is from our notes; the other classes were split so each arm reproduces its measured PCU/hr.
  const ARMS = {
    E: { id: 'E', name: 'East', road: 'Perundurai Road (SH-96)', toward: 'City Core / GH Flyover',
         width: 7.5, sat: 3938, veh10: 260, pcuHr: 1043, waitMeasured: 128, queueMeasured: 110,
         mix10: { tw: 190, car: 38, auto: 20, lcv: 7, bus: 5 } },
    S: { id: 'S', name: 'South', road: 'Surampatti Naal Road', toward: 'Erode Jn Railway Station',
         width: 5.5, sat: 2888, veh10: 119, pcuHr: 469, waitMeasured: 47, queueMeasured: 38,
         mix10: { tw: 89, car: 16, auto: 9, lcv: 3, bus: 2 } },
    W: { id: 'W', name: 'West', road: 'Perundurai Road (SH-96)', toward: 'Thindal / Colleges',
         width: 7.5, sat: 3938, veh10: 168, pcuHr: 659, waitMeasured: 46, queueMeasured: 45,
         mix10: { tw: 127, car: 22, auto: 12, lcv: 4, bus: 3 } },
    N: { id: 'N', name: 'North', road: 'Mohan Kumaramangalam Road', toward: 'Teachers Colony',
         width: 5.5, sat: 2888, veh10: 97, pcuHr: 380, waitMeasured: 44, queueMeasured: 30,
         mix10: { tw: 74, car: 13, auto: 6, lcv: 2, bus: 2 } },
  };
  const ORDER = ['E', 'S', 'W', 'N'];

  // ASSUMPTION: in a standing queue one PCU uses 5.5 m of lane (about 4 m car + 1.5 m gap),
  // and an approach of width w has w/3.5 m lanes (IRC standard lane = 3.5 m).
  const M_PER_PCU = {};
  ORDER.forEach(a => { M_PER_PCU[a] = 5.5 * 3.5 / ARMS[a].width; });

  const FIXED = { green: 27, amber: 3, allRed: 0 };            // Round 1 slide 3 (stopwatch, 3 cycles)
  const RULES = {                                                // Round 1 slides 3-5
    lostPerPhase: 5, amber: 3, allRed: 2, minG: 12, maxG: 60, minC: 60, maxC: 150,
    starvation: 120, drift: 0.20, emergencyHold: 90, nightRest: 120, nightBlink: 40, sideGap: 6,
    histWeight: 0.3, ewma: 0.3, confLow: 0.5, confMinute: 60,
  };

  // ---------------------------------------------------------------- helpers
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function poisson(rng, lam) {
    const L = Math.exp(-lam); let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sum = arr => arr.reduce((s, x) => s + x, 0);

  // Webster's method, exactly as on Round 1 slide 4: y = D/S, Y = sum y, C = (1.5L+5)/(1-Y), G = (C-L) y/Y
  function webster(demandPcuHr, opts) {
    const o = Object.assign({ L: 20, clampG: true, cap: 0.9 }, opts || {});
    const y = {}; ORDER.forEach(a => { y[a] = demandPcuHr[a] / ARMS[a].sat; });
    const Y = sum(ORDER.map(a => y[a]));
    const Craw = (1.5 * o.L + 5) / (1 - Math.min(Y, o.cap));
    const C = clamp(Craw, RULES.minC, RULES.maxC);
    const G = {};
    ORDER.forEach(a => {
      let g = Y > 0 ? (C - o.L) * y[a] / Y : (C - o.L) / 4;
      if (o.clampG) g = clamp(g, RULES.minG, RULES.maxG);
      G[a] = g;
    });
    return { y, Y, Craw, C, G };
  }

  // ---------------------------------------------------------------- arrivals
  // One generator feeds BOTH controllers, so they see the identical vehicles, in the same order, in the same second.
  class ArrivalStream {
    constructor(seed) {
      this.seed = seed;
      this.rng = {}; ORDER.forEach((a, i) => { this.rng[a] = mulberry32(seed * 7919 + i * 104729 + 17); });
      this.nextId = 1;
      this.mult = { E: 1, S: 1, W: 1, N: 1 };   // live sliders
      this.global = 1;                          // night / profile multiplier
    }
    step(t) {
      const out = [];
      ORDER.forEach(a => {
        const arm = ARMS[a], r = this.rng[a];
        // Draw at a fixed 3x ceiling and thin, so changing a slider never shifts the random stream.
        const lamMax = arm.veh10 * 6 / 3600 * 3;
        const n = poisson(r, lamMax);
        const keep = clamp(this.mult[a] * this.global / 3, 0, 1);
        for (let k = 0; k < n; k++) {
          const u = r(), c = r();
          if (u >= keep) continue;
          let acc = 0, cls = 'tw';
          for (const key in arm.mix10) { acc += arm.mix10[key] / arm.veh10; if (c < acc) { cls = key; break; } }
          out.push({ id: this.nextId++, arm: a, cls, pcu: CLASSES[cls].pcu, tArr: t });
        }
      });
      return out;
    }
  }

  // ---------------------------------------------------------------- signal stage runner
  // Stages: GREEN(arms) -> AMBER(arms) -> ALLRED -> next GREEN.  Also REST (night) and BLINK.
  class StageRunner {
    constructor(amber, allRed) { this.amber = amber; this.allRed = allRed; this.stage = null; this.pending = null; }
    signalOf(arm) {
      const s = this.stage; if (!s) return 'R';
      if (s.kind === 'BLINK') return 'B';
      if ((s.kind === 'GREEN' || s.kind === 'REST') && s.arms.includes(arm)) return 'G';
      if (s.kind === 'AMBER' && s.arms.includes(arm)) return 'A';
      return 'R';
    }
    // Ask for `arms` to go green as soon as safely possible. Amber and all-red are never skipped.
    request(arms, green, tag) {
      const s = this.stage;
      const same = s && (s.kind === 'GREEN' || s.kind === 'REST') && arms.length === s.arms.length && arms.every(a => s.arms.includes(a));
      if (same) { s.kind = 'GREEN'; s.rem = green; s.total = green; s.tag = tag; this.pending = null; return 'hold'; }
      this.pending = { arms, green, tag };
      if (s && (s.kind === 'GREEN' || s.kind === 'REST')) {
        const cut = s.kind === 'GREEN' ? s.rem : 0;
        this.stage = { kind: 'AMBER', arms: s.arms, rem: this.amber, total: this.amber, cutFrom: s.arms, cutLeft: cut };
        return 'cut';
      }
      if (s && s.kind === 'BLINK') { this.stage = { kind: 'ALLRED', arms: [], rem: Math.max(1, this.allRed), total: this.allRed }; }
      return 'queued';
    }
  }

  // ---------------------------------------------------------------- controllers
  class FixedController {
    constructor() {
      this.label = 'A · Fixed timer'; this.kind = 'fixed';
      this.runner = new StageRunner(FIXED.amber, FIXED.allRed);
      this.idx = -1; this.mode = 'FIXED'; this.log = []; this.cycle = 0;
      this.plan = { C: 120, G: { E: 27, S: 27, W: 27, N: 27 } };
    }
    next(j) {
      if (j.nightLevel === 'late') return { kind: 'BLINK', arms: [], rem: Infinity };   // police already blink below 40 PCU/hr
      this.idx = (this.idx + 1) % 4; if (this.idx === 0) this.cycle++;
      const a = ORDER[this.idx];
      return { kind: 'GREEN', arms: [a], rem: FIXED.green, total: FIXED.green };
    }
    onSecond(j) {
      if (j.nightLevel !== 'late' && this.runner.stage && this.runner.stage.kind === 'BLINK') this.runner.stage = null;
      if (j.nightLevel === 'late' && this.runner.stage && this.runner.stage.kind !== 'BLINK') this.runner.stage = { kind: 'BLINK', arms: [], rem: Infinity };
    }
  }

  class PathaiController {
    constructor(opts) {
      opts = opts || {};
      this.label = 'B · PATHAI adaptive'; this.kind = 'pathai';
      this.runner = new StageRunner(RULES.amber, RULES.allRed);
      this.hist = {}; ORDER.forEach(a => { this.hist[a] = ARMS[a].pcuHr; });   // stored 15-min profile for this weekday slot
      this.ew = Object.assign({}, this.hist);
      this.arrPcu = { E: 0, S: 0, W: 0, N: 0 };
      this.carry = { E: 0, S: 0, W: 0, N: 0 };
      this.comp = { E: 0, S: 0, W: 0, N: 0 };
      this.lastGreenEnd = { E: 0, S: 0, W: 0, N: 0 };
      this.served = new Set(['E', 'S', 'W', 'N']);
      this.cycleStart = 0; this.cycle = 0; this.prevG = null; this.prevC = 128;
      this.plan = null; this.mode = 'ADAPTIVE'; this.log = [];
      this.lowSince = null; this.okSince = null;
      this.emergency = null; this.override = null; this.sideWait = null;
      this.useQueueOrder = opts.useQueueOrder !== false;
      this.useCarry = opts.useCarry !== false;
      this.minG = opts.minG || RULES.minG;
      this.histWeight = opts.histWeight != null ? opts.histWeight : RULES.histWeight;
    }
    say(j, msg, level) { this.log.push({ t: j.t, msg, level: level || 'info' }); if (this.log.length > 200) this.log.shift(); }

    estimateDemand(j) {
      const d = {};
      ORDER.forEach(a => {
        const conf = j.conf[a];
        // Camera trusted: blend live count with stored profile. Camera not trusted: stored profile only.
        const q = conf >= RULES.confLow ? this.histWeight * this.hist[a] + (1 - this.histWeight) * this.ew[a] : this.hist[a];
        d[a] = q + (this.useCarry ? this.carry[a] * 3600 / this.prevC : 0);
      });
      return d;
    }

    newCycle(j) {
      const Tc = j.t - this.cycleStart;
      if (Tc > 0) {
        ORDER.forEach(a => {
          if (j.conf[a] >= RULES.confLow) {
            const m = this.arrPcu[a] * 3600 / Tc;
            this.ew[a] = (1 - RULES.ewma) * this.ew[a] + RULES.ewma * m;
          }
          this.arrPcu[a] = 0;
        });
      }
      this.cycleStart = j.t; this.cycle++;
      const d = this.estimateDemand(j);
      const w = webster(d, { L: 4 * RULES.lostPerPhase });
      const G = {};
      ORDER.forEach(a => {
        let g = clamp(w.G[a], this.minG, RULES.maxG);
        if (this.prevG) g = clamp(g, this.prevG[a] * (1 - RULES.drift), this.prevG[a] * (1 + RULES.drift));
        G[a] = Math.round(clamp(g, this.minG, RULES.maxG));
      });
      // keep the cycle inside 60-150 s after rounding and the drift cap
      const Lt = 4 * RULES.lostPerPhase;
      while (sum(ORDER.map(a => G[a])) + Lt > RULES.maxC) { const big = ORDER.reduce((m, a) => G[a] > G[m] ? a : m, 'E'); G[big]--; }
      while (sum(ORDER.map(a => G[a])) + Lt < RULES.minC) { const sm = ORDER.reduce((m, a) => G[a] < G[m] ? a : m, 'E'); G[sm]++; }
      this.prevG = Object.assign({}, G);
      const C = sum(ORDER.map(a => G[a])) + Lt;
      this.prevC = C;
      this.plan = { C, G, Y: w.Y, y: w.y, demand: d, Craw: w.Craw };
      this.served = new Set();
      this.say(j, `Cycle ${this.cycle}: Y=${w.Y.toFixed(2)}  C=${C}s  E${G.E} S${G.S} W${G.W} N${G.N}`);
    }

    fallbackPlan() { return { C: 128, G: { E: 27, S: 27, W: 27, N: 27 } }; }

    totalDemandEstimate() { return sum(ORDER.map(a => this.hist[a])); }

    next(j) {
      // Night operation (Round 1 slide 5)
      const tot = this.totalDemandEstimate();
      if (this.mode !== 'FALLBACK' && !this.override && !this.emergency) {
        if (tot < RULES.nightBlink) { this.mode = 'BLINK'; return { kind: 'BLINK', arms: [], rem: Infinity }; }
        if (tot < RULES.nightRest) {
          this.mode = 'NIGHT';
          const side = ['N', 'S'].find(a => j.queues[a].length > 0 && !this.servedNight?.has(a));
          if (this.nightSide) { this.nightSide = null; return { kind: 'REST', arms: ['E', 'W'], rem: Infinity }; }
          if (side) { this.nightSide = side; return { kind: 'GREEN', arms: [side], rem: RULES.minG, total: RULES.minG }; }
          return { kind: 'REST', arms: ['E', 'W'], rem: Infinity };
        }
        if (this.mode === 'NIGHT' || this.mode === 'BLINK') { this.mode = 'ADAPTIVE'; this.say(j, 'Traffic back above 120 PCU/hr: adaptive cycling resumes'); this.served = new Set(ORDER); }
      }
      if (this.mode === 'FALLBACK') {
        const fp = this.fallbackPlan();
        this.fbIdx = ((this.fbIdx == null ? -1 : this.fbIdx) + 1) % 4;
        const a = ORDER[this.fbIdx];
        return { kind: 'GREEN', arms: [a], rem: fp.G[a], total: fp.G[a] };
      }
      if (this.served.size >= 4) this.newCycle(j);
      const cands = ORDER.filter(a => !this.served.has(a));
      let pick = null;
      const starving = cands.filter(a => j.t - this.lastGreenEnd[a] >= RULES.starvation);
      if (starving.length) {
        pick = starving.sort((a, b) => this.lastGreenEnd[a] - this.lastGreenEnd[b])[0];
        this.say(j, `Starvation guard: ${ARMS[pick].name} waited ${j.t - this.lastGreenEnd[pick]}s, goes next`, 'warn');
      } else if (this.useQueueOrder) {
        pick = cands.sort((a, b) => j.queuePcu(b) - j.queuePcu(a))[0];   // longest queue first
      } else pick = cands[0];
      this.served.add(pick);
      let g = this.plan.G[pick];
      if (this.comp[pick] > 0) {
        const add = this.comp[pick]; g = Math.min(RULES.maxG, g + add); this.comp[pick] = 0;
        this.say(j, `Compensation: +${add}s green to ${ARMS[pick].name} after emergency`);
      }
      return { kind: 'GREEN', arms: [pick], rem: g, total: g };
    }

    // Called once per simulated second before signals are read.
    onSecond(j) {
      // --- camera health / fail-safe
      const low = ORDER.filter(a => j.conf[a] < RULES.confLow);
      const down = ORDER.filter(a => j.conf[a] <= 0.01);
      if (low.length >= 2) { if (this.lowSince == null) this.lowSince = j.t; } else this.lowSince = null;
      if (this.mode !== 'FALLBACK' && (down.length >= 2 || (this.lowSince != null && j.t - this.lowSince >= RULES.confMinute))) {
        this.mode = 'FALLBACK'; this.fbIdx = null;
        this.say(j, 'ALARM: camera confidence < 0.5 for 60 s. Fail-safe: fixed 27 s plan, console alerted', 'alarm');
      }
      if (this.mode === 'FALLBACK') {
        if (low.length === 0) { if (this.okSince == null) this.okSince = j.t; } else this.okSince = null;
        if (this.okSince != null && j.t - this.okSince >= 30) {
          this.mode = 'ADAPTIVE'; this.served = new Set(ORDER); this.okSince = null;
          this.say(j, 'Cameras healthy for 30 s: adaptive control resumes', 'ok');
        }
      }
      if (this._lastLow !== low.join() && low.length === 1 && this.mode !== 'FALLBACK') {
        this.say(j, `${ARMS[low[0]].name} camera unreliable: using its stored 15-min profile`, 'warn');
      }
      this._lastLow = low.join();

      // --- night: side-road vehicle waits for a 6 s gap, then gets green
      const st = this.runner.stage;
      if (this.mode === 'NIGHT' && st && st.kind === 'REST') {
        const side = ['N', 'S'].find(a => j.queues[a].length > 0);
        if (side) {
          if (this.sideWait == null) this.sideWait = j.t;
          if (j.t - this.sideWait >= RULES.sideGap) { st.kind = 'GREEN'; st.rem = 1; this.sideWait = null; }
        } else this.sideWait = null;
      }
      if ((this.mode === 'NIGHT' || this.mode === 'BLINK') && st) {
        const tot = this.totalDemandEstimate();
        if (tot >= RULES.nightRest && (st.kind === 'REST' || st.kind === 'BLINK')) { st.kind = 'GREEN'; st.rem = 1; }
        if (this.mode === 'NIGHT' && tot < RULES.nightBlink && st.kind === 'REST') { st.kind = 'GREEN'; st.rem = 1; }
        if (this.mode === 'BLINK' && tot >= RULES.nightBlink && st.kind === 'BLINK') { st.kind = 'GREEN'; st.rem = 1; this.mode = 'NIGHT'; }
      }

      // --- emergency hold
      const e = this.emergency;
      if (e) {
        const s = this.runner.stage;
        if (s && s.kind === 'GREEN' && s.arms[0] === e.arm && s.tag === 'emergency') {
          if (e.greenAt == null) { e.greenAt = j.t; this.say(j, `${ARMS[e.arm].name} green held for ambulance (max 90 s)`, 'alarm'); }
          const amb = j.ambulances.find(v => v.arm === e.arm && v.tArr >= e.t0 - 1);
          const gone = !!amb && amb.tDep != null;   // released only once the ambulance has actually crossed
          if (gone || j.t - e.greenAt >= RULES.emergencyHold) {
            s.rem = gone ? 3 : 1;   // let the ambulance clear the box, then release
            this.say(j, gone ? `Ambulance cleared in ${j.t - e.t0}s. Releasing hold` : 'Hold limit 90 s reached. Releasing', 'ok');
            if (e.cutArm && e.cutLeft > 0) this.comp[e.cutArm] += Math.round(e.cutLeft);
            this.served.add(e.arm);
            this.emergency = null;
          } else s.rem = Math.max(s.rem, 2);
        }
      }
      // --- manual override: hold the officer's arm green
      const o = this.override;
      if (o) { const s = this.runner.stage; if (s && s.kind === 'GREEN' && s.tag === 'override') s.rem = Math.max(s.rem, 2); }
    }

    // ---- external events
    triggerEmergency(j, arm) {
      if (this.emergency) return;
      if (this.mode === 'FALLBACK') this.say(j, 'Emergency during fail-safe: preemption still allowed (radio tag)', 'warn');
      this.emergency = { arm, t0: j.t, greenAt: null };
      this.say(j, `Siren/beacon classifier ✓ + radio tag ✓ : ambulance on ${ARMS[arm].name} arm`, 'alarm');
      const s = this.runner.stage;
      const res = this.runner.request([arm], 999, 'emergency');
      if (res === 'cut') {
        this.emergency.cutArm = s.arms.length === 1 ? s.arms[0] : null;
        this.emergency.cutLeft = this.runner.stage.cutLeft;
        this.say(j, `Cutting ${s.arms.map(a => ARMS[a].name).join('+')} green: amber 3 s → all-red 2 s (never skipped)`, 'warn');
      } else if (res === 'hold') this.say(j, `${ARMS[arm].name} already green: extending`, 'warn');
      this.say(j, 'Priority packet sent to the next 3 junctions toward the GH', 'info');
    }
    setOverride(j, arm) {
      if (arm == null) {
        if (this.override) {
          this.override = null; this.say(j, 'Officer released control: AI resumes from a fresh cycle', 'ok');
          const s = this.runner.stage; if (s && s.kind === 'GREEN') s.rem = Math.min(s.rem, 1);
          this.served = new Set(ORDER);
        }
        return;
      }
      this.override = { arm, t0: j.t };
      this.say(j, `POLICE OVERRIDE: officer selects ${ARMS[arm].name}. AI is advisory only`, 'alarm');
      const r = this.runner.request([arm], 999, 'override');
      if (r === 'cut') this.say(j, 'Safety interval still enforced: amber 3 s + all-red 2 s', 'warn');
    }
  }

  // ---------------------------------------------------------------- junction
  class Junction {
    constructor(controller, opts) {
      opts = opts || {};
      this.ctrl = controller; this.t = 0;
      this.warm = opts.warmup != null ? opts.warmup : 0;
      this.mEnd = opts.measureEnd != null ? opts.measureEnd : Infinity;
      this.queues = { E: [], S: [], W: [], N: [] };
      this.credit = { E: 0, S: 0, W: 0, N: 0 };
      this.conf = { E: 0.95, S: 0.94, W: 0.95, N: 0.93 };
      this.nightLevel = 'off';
      this.sig = { E: 'R', S: 'R', W: 'R', N: 'R' };
      this.recent = [];                  // recently departed vehicles (for animation)
      this.all = [];                     // every vehicle (for exact stats)
      this.series = [];                  // queue PCU sampled every 10 s
      this.maxQ = { E: 0, S: 0, W: 0, N: 0 };
      this.greenSec = { E: 0, S: 0, W: 0, N: 0 };
      this.arrPcuWin = { E: 0, S: 0, W: 0, N: 0 };
      this.ambulances = [];
      this.sigHist = [];                 // per-second signal states 'ESWN' (for the timeline)
    }
    inWin(t) { return t >= this.warm && t < this.mEnd; }
    queuePcu(a) { let s = 0; for (const v of this.queues[a]) s += v.pcu; return s; }
    queueM(a) { return this.queuePcu(a) * M_PER_PCU[a]; }

    addVehicles(list) {
      for (const src of list) {
        const v = Object.assign({}, src, { tDep: null, stopped: false });
        this.all.push(v);
        if (v.cls === 'amb') this.ambulances.push(v);
        if (this.ctrl.arrPcu) this.ctrl.arrPcu[v.arm] += v.pcu;
        if (this.inWin(v.tArr)) this.arrPcuWin[v.arm] += v.pcu;
        const free = this.sig[v.arm] === 'G' && this.queues[v.arm].length === 0 && this.credit[v.arm] > -1;
        if (free) { v.tDep = this.t; this.credit[v.arm] -= v.pcu; this.recent.push(v); }
        else { v.stopped = true; this.queues[v.arm].push(v); }
      }
    }

    // advance the signal for this second
    signals() {
      const c = this.ctrl, r = c.runner;
      c.onSecond(this);
      if (!r.stage) r.stage = c.next(this);
      ORDER.forEach(a => { this.sig[a] = r.signalOf(a); });
      this.sigHist.push(ORDER.map(a => this.sig[a]).join(''));
      if (this.sigHist.length > 900) this.sigHist.shift();
    }

    discharge() {
      ORDER.forEach(a => {
        const q = this.queues[a], s = this.sig[a];
        if (s === 'G') {
          if (this.inWin(this.t)) this.greenSec[a]++;
          this.credit[a] = Math.min(this.credit[a] + ARMS[a].sat / 3600, 3);
          // Ambulance: vehicles ahead pull aside, it leaves after a 3 s clearance
          const ai = q.findIndex(v => v.cls === 'amb');
          if (ai > 0 && this.t - (q[ai].greenSeen ?? (q[ai].greenSeen = this.t)) >= 3) { const [amb] = q.splice(ai, 1); amb.tDep = this.t; this.recent.push(amb); }
          while (q.length && this.credit[a] >= q[0].pcu - 1e-9) {
            const v = q.shift(); this.credit[a] -= v.pcu; v.tDep = this.t; this.recent.push(v);
          }
          if (!q.length) this.credit[a] = Math.min(this.credit[a], 0.5);
        } else if (s === 'B') {
          // Blinking amber: give-way. Each vehicle stops and looks for 2 s; one vehicle per arm every 2 s.
          if (q.length && this.t - q[0].tArr >= 2 && (this.t % 2 === 0)) { const v = q.shift(); v.tDep = this.t; this.recent.push(v); }
        } else {
          this.credit[a] = 0;
        }
      });
    }

    endOfSecond() {
      const r = this.ctrl.runner, s = r.stage;
      ORDER.forEach(a => { const p = this.queuePcu(a); if (this.inWin(this.t) && p > this.maxQ[a]) this.maxQ[a] = p; });
      if (this.t % 10 === 0) this.series.push({ t: this.t, q: ORDER.reduce((o, a) => (o[a] = this.queuePcu(a), o), {}) });
      if (this.series.length > 2000) this.series.shift();
      if (this.recent.length > 300) this.recent.splice(0, this.recent.length - 300);
      // stage countdown
      if (s && s.rem !== Infinity) {
        s.rem--;
        if (s.rem <= 0) {
          if (s.kind === 'GREEN' || s.kind === 'REST') {
            s.arms.forEach(a => {
              if (this.ctrl.lastGreenEnd) this.ctrl.lastGreenEnd[a] = this.t;
              if (this.ctrl.carry) this.ctrl.carry[a] = this.queuePcu(a);
            });
            r.stage = r.amber > 0 ? { kind: 'AMBER', arms: s.arms, rem: r.amber, total: r.amber } : null;
            if (!r.stage && r.allRed > 0) r.stage = { kind: 'ALLRED', arms: [], rem: r.allRed, total: r.allRed };
          } else if (s.kind === 'AMBER') {
            r.stage = r.allRed > 0 ? { kind: 'ALLRED', arms: [], rem: r.allRed, total: r.allRed } : null;
            if (!r.stage && r.pending) { r.stage = Object.assign({ kind: 'GREEN', rem: r.pending.green, total: r.pending.green }, { arms: r.pending.arms, tag: r.pending.tag }); r.pending = null; }
          } else if (s.kind === 'ALLRED') {
            r.stage = null;
            if (r.pending) { r.stage = { kind: 'GREEN', arms: r.pending.arms, rem: r.pending.green, total: r.pending.green, tag: r.pending.tag }; r.pending = null; }
          } else r.stage = null;
        }
      }
      this.t++;
      if (!r.stage) r.stage = this.ctrl.next(this);   // so the next phase is already visible between steps
    }

    step(arrivals) {
      this.signals();
      this.addVehicles(arrivals);
      this.discharge();
      this.endOfSecond();
    }

    // Exact statistics over the measurement window [warm, measureEnd).
    // Delay of a vehicle that arrived in the window is counted until it actually leaves (the run continues after the window).
    stats() {
      const t0 = this.warm, t1 = Math.min(this.t, this.mEnd), win = Math.max(1, t1 - t0);
      const per = {}; ORDER.forEach(a => { per[a] = { n: 0, dep: 0, delay: 0, stops: 0, maxQ: this.maxQ[a], maxQm: this.maxQ[a] * M_PER_PCU[a] }; });
      let n = 0, dep = 0, depPcu = 0, delay = 0, stops = 0, fuel = 0, co2 = 0, idleVehSec = 0;
      for (const v of this.all) {
        if (v.tArr < t0 || v.tArr >= t1) continue;
        const d = (v.tDep != null ? v.tDep : this.t) - v.tArr;
        const p = per[v.arm];
        n++; p.n++; delay += d; p.delay += d; idleVehSec += d;
        if (v.stopped) { stops++; p.stops++; }
        const c = CLASSES[v.cls]; fuel += d / 3600 * c.idleLph; co2 += d / 3600 * c.idleLph * c.co2PerL;
      }
      for (const v of this.all) if (v.tDep != null && v.tDep >= t0 && v.tDep < t1) { dep++; depPcu += v.pcu; per[v.arm].dep++; }
      ORDER.forEach(a => {
        const p = per[a];
        p.avgDelay = p.n ? p.delay / p.n : 0;
        const cap = ARMS[a].sat * this.greenSec[a] / win;
        p.x = cap > 0 ? (this.arrPcuWin[a] * 3600 / win) / cap : 0;
        p.clearedHr = p.dep * 3600 / win;
      });
      return {
        window: win, arrived: n, cleared: dep, clearedHr: dep * 3600 / win, pcuHr: depPcu * 3600 / win,
        avgDelay: n ? delay / n : 0, stopsPerVeh: n ? stops / n : 0, idleVehHr: idleVehSec / 3600,
        fuelL: fuel, co2kg: co2, per,
        maxQueueM: Math.max(...ORDER.map(a => per[a].maxQm)), maxQueuePcu: Math.max(...ORDER.map(a => per[a].maxQ)),
        ambulances: this.ambulances.map(v => ({ arm: v.arm, wait: v.tDep != null ? v.tDep - v.tArr : null })),
      };
    }
  }

  // ---------------------------------------------------------------- paired experiment (headless)
  // profile(t) -> arrival multiplier. Both controllers get the identical arrival list.
  function runPaired(seed, opts) {
    opts = opts || {};
    const warm = opts.warmup || 0, mEnd = opts.measureEnd || 900, dur = opts.duration || mEnd + 900;
    const stream = new ArrivalStream(seed);
    if (opts.mult) Object.assign(stream.mult, opts.mult);
    const A = new Junction(new FixedController(), { warmup: warm, measureEnd: mEnd });
    const B = new Junction(new PathaiController(opts.pathai), { warmup: warm, measureEnd: mEnd });
    for (let t = 0; t < dur; t++) {
      stream.global = opts.profile ? opts.profile(t) : 1;
      const arr = stream.step(t);
      if (opts.events && opts.events[t]) opts.events[t](A, B, arr);
      A.step(arr); B.step(arr);
    }
    return { A: A.stats(), B: B.stats(), Aj: A, Bj: B };
  }

  const API = { CLASSES, ARMS, ORDER, M_PER_PCU, FIXED, RULES, webster, mulberry32, ArrivalStream, StageRunner,
    FixedController, PathaiController, Junction, runPaired };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.PATHAI = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
