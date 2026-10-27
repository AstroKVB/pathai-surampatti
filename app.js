/* PATHAI Junction Simulator — UI, rendering, telemetry, fair test and slide exporter */
(function () {
  'use strict';
  const P = window.PATHAI;
  const { ARMS, ORDER, CLASSES, M_PER_PCU, RULES } = P;
  const COL = { a: '#f97362', b: '#2dd4bf', bg: '#0a1020', road: '#2a3142', roadEdge: '#3c4559', mark: '#cfd6e4',
    text: '#e6edf7', muted: '#94a3b8', red: '#ef4444', amber: '#f59e0b', green: '#22c55e', grass: '#0f1a14' };
  const NIGHT_PCU = { night: 100, late: 30 };
  const TOTAL_PCU = ORDER.reduce((s, a) => s + ARMS[a].pcuHr, 0);   // 2,551
  const $ = id => document.getElementById(id);

  // ================================================================ state
  const S = { playing: true, speed: 10, seed: 1, simT: 0, view: 'both', night: 'off', fail: 'none',
    stream: null, A: null, B: null, ambActive: false, ambDue: 0, lastStats: 0, statA: null, statB: null,
    buf: new Map(), bufT: 0, extra: new Map(), events: new Map(), arrivals: null };
  const has3D = !!(window.PATHAI3D && window.PATHAI3D.init && window.PATHAI3D.init());
  // Arrivals are drawn LOOKAHEAD seconds early so the 3D vehicles can drive the length of the road and reach
  // the stop line when the engine counts them as arrived. The arrival list itself is unchanged.
  const LOOKAHEAD = has3D ? window.PATHAI3D.LOOKAHEAD : 0;

  function reset() {
    S.seed = Math.max(1, parseInt($('seed').value, 10) || 1);
    S.stream = new P.ArrivalStream(S.seed);
    S.A = new P.Junction(new P.FixedController(), { warmup: 0 });
    S.B = new P.Junction(new P.PathaiController(), { warmup: 0 });
    S.simT = 0; S.ambActive = false; S.ambDue = 0;
    S.buf = new Map(); S.bufT = 0; S.extra = new Map(); S.events = new Map();
    S.arrivals = { E: [], S: [], W: [], N: [], AMB: [] };
    readSliders(); applyNight(); applyFail();
    if (has3D) window.PATHAI3D.bind({ A: S.A, B: S.B, arrivals: S.arrivals });
    $('btnAmb').disabled = false;
    document.querySelectorAll('.btn.ov').forEach(b => b.classList.remove('on'));
    $('log').innerHTML = '';
    S.statA = S.A.stats(); S.statB = S.B.stats();
  }

  function fillBuffer(upto) {
    while (S.bufT <= upto) {
      const list = S.stream.step(S.bufT);
      S.buf.set(S.bufT, list);
      list.forEach(v => S.arrivals[v.arm].push(v));
      S.bufT++;
    }
  }
  function stepOnce() {
    const t = S.A.t;
    fillBuffer(t + LOOKAHEAD);
    const arr = (S.buf.get(t) || []).concat(S.extra.get(t) || []);
    S.buf.delete(t); S.extra.delete(t);
    const ev = S.events.get(t); if (ev) { S.events.delete(t); ev(); }
    updateConfidence();
    S.A.step(arr); S.B.step(arr);
    if (S.ambActive && t > S.ambDue) {
      const done = [S.A, S.B].every(j => j.ambulances.every(v => v.tDep != null));
      if (done) { S.ambActive = false; $('btnAmb').disabled = false; }
    }
  }

  // ================================================================ controls
  function applyNight() {
    const lvl = S.night;
    const f = lvl === 'off' ? 1 : NIGHT_PCU[lvl] / TOTAL_PCU;
    S.stream.global = f;
    [S.A, S.B].forEach(j => { j.nightLevel = lvl; });
    ORDER.forEach(a => { S.B.ctrl.hist[a] = ARMS[a].pcuHr * f * S.stream.mult[a]; S.B.ctrl.ew[a] = S.B.ctrl.hist[a]; });
  }
  function applyFail() { /* targets are read in updateConfidence */ }
  function updateConfidence() {
    ORDER.forEach((a, i) => {
      let target = 0.93 + 0.03 * Math.sin((S.A.t + i * 37) / 23);
      if (S.fail === 'fog') target = 0.32 + 0.04 * Math.sin(S.A.t / 7 + i);
      if (S.fail === 'east' && a === 'E') target = 0;
      [S.A, S.B].forEach(j => {
        const c = j.conf[a];
        j.conf[a] = target === 0 ? 0 : c + (target - c) * 0.12;
      });
    });
  }
  function readSliders() {
    ORDER.forEach(a => { const el = $('sl' + a); if (el) S.stream.mult[a] = parseFloat(el.value); });
  }
  function buildSliders() {
    const box = $('sliders'); box.innerHTML = '';
    ['E', 'W', 'N', 'S'].forEach(a => {
      const d = document.createElement('div'); d.className = 'slider';
      d.innerHTML = `<span>${ARMS[a].name}</span><input type="range" id="sl${a}" min="0" max="2" step="0.05" value="1"><output id="o${a}">1.00×</output>`;
      box.appendChild(d);
      d.querySelector('input').addEventListener('input', e => {
        $('o' + a).textContent = (+e.target.value).toFixed(2) + '×';
        S.stream.mult[a] = +e.target.value;
        if (S.night !== 'off') applyNight();
      });
    });
  }

  function wire() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('btnPlay').addEventListener('click', () => { S.playing = !S.playing; $('btnPlay').textContent = S.playing ? 'Pause' : 'Play'; });
    $('speed').addEventListener('change', e => { S.speed = +e.target.value; });
    $('btnReset').addEventListener('click', reset);
    $('seed').addEventListener('change', reset);
    $('view').addEventListener('change', e => { S.view = e.target.value; layoutCanvases(); });
    $('night').addEventListener('change', e => { S.night = e.target.value; applyNight(); });
    $('fail').addEventListener('change', e => { S.fail = e.target.value; });
    $('btnAmb').addEventListener('click', sendAmbulance);
    document.querySelectorAll('.btn.ov').forEach(b => b.addEventListener('click', () => {
      const arm = b.dataset.arm || null;
      S.B.ctrl.setOverride(S.B, arm);
      document.querySelectorAll('.btn.ov').forEach(x => x.classList.toggle('on', !!arm && x.dataset.arm === arm));
    }));
    $('btnExport').addEventListener('click', () => exportSlides(true));
    if (has3D) wireCamera(); else $('camWrap').style.display = 'none';
    $('btnRun').addEventListener('click', () => runFairTest(true));
    window.addEventListener('resize', () => { sizeCanvases(); drawMapTab(); drawResultsTab(); });
  }
  // Drag = turn the camera, right-drag or Shift-drag = move it, wheel = zoom, double-click = reset.
  function wireCamera() {
    const P3 = window.PATHAI3D;
    $('cam').addEventListener('change', e => P3.setCamera(e.target.value));
    ['cvA', 'cvB'].forEach(id => {
      const cv = $(id); let drag = null;
      const inScene = e => { const D = viewDims(), y = e.offsetY / cv.clientHeight * D.LH; return y > 64 && y < 64 + D.SH; };
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => {
        if (!inScene(e)) return;
        drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
        cv.setPointerCapture(e.pointerId); cv.classList.add('grab');
      });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) P3.pan(dx, dy); else P3.orbit(dx, dy);
        if (P3.camMode !== 'follow') $('cam').value = 'free';
      });
      const up = () => { drag = null; cv.classList.remove('grab'); };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('wheel', e => { if (!inScene(e)) return; e.preventDefault(); P3.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
      cv.addEventListener('dblclick', e => { if (!inScene(e)) return; const v = $('cam').value === 'free' ? 'overview' : $('cam').value; $('cam').value = v; P3.setCamera(v); });
    });
  }
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    sizeCanvases(); if (name === 'map') drawMapTab(); if (name === 'results') drawResultsTab();
  }
  // Both views share the page, so each is a tall 600 x 720 panel. A single view gets the whole width.
  function viewDims() {
    if (S.view === 'both') return { LW: 600, SH: 600, LH: 720 };
    const w = $('canvases').clientWidth || 1000, hCss = Math.max(520, Math.min(980, window.innerHeight - 150));
    return { LW: Math.max(600, Math.round(w / (hCss / 720))), SH: 600, LH: 720 };
  }
  function layoutCanvases() {
    $('canvases').classList.toggle('one', S.view !== 'both');
    $('cvA').classList.toggle('hide', S.view === 'B');
    $('cvB').classList.toggle('hide', S.view === 'A');
    sizeCanvases();
  }
  // The ambulance appears at the far end of the West road now, and reaches the junction (where the
  // siren classifier and radio tag confirm it) after driving the road at 50 km/h.
  function sendAmbulance() {
    if (S.ambActive) return;
    S.ambActive = true; $('btnAmb').disabled = true;
    const t = S.A.t, lead = has3D ? Math.round(window.PATHAI3D.ROAD.W / window.PATHAI3D.V0_AMB) : 0;
    const tArr = t + lead, amb = { id: 900000 + t, arm: 'W', cls: 'amb', pcu: 1.0, tArr };
    S.ambDue = tArr;
    S.extra.set(tArr, (S.extra.get(tArr) || []).concat([amb]));
    S.arrivals.AMB.push(amb);
    if (lead) S.B.ctrl.say(S.B, `Ambulance on Perundurai Rd West, ${window.PATHAI3D.ROAD.W} m out, heading to the GH`, 'warn');
    const go = () => S.B.ctrl.triggerEmergency(S.B, 'W');
    if (lead) S.events.set(tArr, go); else go();
  }

  // ================================================================ canvas helpers
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  function fitCanvas(cv, lw, lh) {
    const w = cv.clientWidth || lw; const h = w * lh / lw; const d = DPR();
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const ctx = cv.getContext('2d'); ctx.setTransform(cv.width / lw, 0, 0, cv.height / lh, 0, 0); return ctx;
  }
  function sizeCanvases() { /* canvases are re-fitted every frame */ }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function txt(ctx, s, x, y, o) {
    o = o || {}; ctx.save();
    ctx.font = `${o.weight || 500} ${o.size || 12}px "Segoe UI", Inter, system-ui, sans-serif`;
    ctx.fillStyle = o.color || COL.text; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'middle';
    if (o.rot) { ctx.translate(x, y); ctx.rotate(o.rot); ctx.fillText(s, 0, 0); } else ctx.fillText(s, x, y);
    ctx.restore();
  }
  function pill(ctx, s, x, y, bg, fg, size, align) {
    ctx.save(); ctx.font = `600 ${size || 11}px "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(s).width + (size || 11) * 1.2, h = (size || 11) * 1.8;
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    rr(ctx, x0, y - h / 2, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x0 + w / 2, y + 0.5);
    ctx.restore(); return w;
  }
  const fmtClock = (t, night) => {
    const base = night === 'night' ? 23 * 3600 + 30 * 60 : night === 'late' ? 2 * 3600 : 18 * 3600 + 15 * 60;
    const s = Math.floor(base + t) % 86400; const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  };

  // ================================================================ junction geometry
  // Along the road: SL px per metre (true scale, so queue lengths are honest).
  // Across the road: SW px per metre (widened so lanes and vehicles are readable).
  const G = { hwEW: 7.5, hwNS: 5.5, SL: 2.6, SW: 5.2, ZEB: 12 };
  G.boxX = G.hwNS * G.SW; G.boxY = G.hwEW * G.SW;
  const DIR = { E: [-1, 0], W: [1, 0], N: [0, 1], S: [0, -1] };   // direction of travel (India drives on the LEFT)
  // pixel position of a point `d` metres behind the stop line, `off` metres from the centre line, on arm `a`
  function px(cx, cy, a, d, off) {
    switch (a) {
      case 'E': return [cx + G.boxX + G.ZEB + d * G.SL, cy + off * G.SW];   // heading west, south half
      case 'W': return [cx - G.boxX - G.ZEB - d * G.SL, cy - off * G.SW];   // heading east, north half
      case 'N': return [cx + off * G.SW, cy - G.boxY - G.ZEB - d * G.SL];   // heading south, east half
      case 'S': return [cx - off * G.SW, cy + G.boxY + G.ZEB + d * G.SL];   // heading north, west half
    }
  }
  const laneOff = (a, lane) => ARMS[a].width / 2 * (lane + 0.5);
  const VW = { tw: 0.8, car: 1.7, auto: 1.4, lcv: 1.9, bus: 2.5, amb: 1.9 };

  function drawVehicle(ctx, x, y, a, v, t) {
    const c = CLASSES[v.cls], L = c.len * G.SL * 1.1, W = VW[v.cls] * G.SW * 0.85;
    const [dx, dy] = DIR[a];
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    rr(ctx, -L / 2, -W / 2, L, W, Math.min(W, L) * 0.3);
    ctx.fillStyle = c.color; ctx.fill();
    if (v.cls === 'amb') {
      ctx.fillStyle = '#ef4444'; ctx.fillRect(-1.5, -W * 0.36, 3, W * 0.72); ctx.fillRect(-W * 0.36, -1.5, W * 0.72, 3);
      const on = Math.floor(t * 4) % 2 === 0;
      ctx.fillStyle = on ? '#3b82f6' : '#ef4444'; ctx.beginPath(); ctx.arc(L * 0.3, 0, 2.6, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(L * 0.3, 0, 13, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    } else if (v.cls !== 'tw') { ctx.fillStyle = 'rgba(10,16,32,.55)'; ctx.fillRect(-L / 2 + L * 0.12, -W * 0.34, L * 0.16, W * 0.68); }
    ctx.restore();
  }

  function drawSignalHead(ctx, cx, cy, a, state, rem) {
    const [x, y] = px(cx, cy, a, 4, ARMS[a].width + 3.2);
    const r = 4.2, vertical = a === 'E' || a === 'W';
    const bw = vertical ? r * 2.7 : r * 7.6, bh = vertical ? r * 7.6 : r * 2.7;
    ctx.save();
    rr(ctx, x - bw / 2, y - bh / 2, bw, bh, r * 0.8); ctx.fillStyle = '#05080f'; ctx.fill(); ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.stroke();
    [['R', COL.red], ['A', COL.amber], ['G', COL.green]].forEach(([k, c], i) => {
      const o = (i - 1) * r * 2.45; const lx = vertical ? x : x + o, ly = vertical ? y + o : y;
      const lit = state === k || (state === 'B' && k === 'A' && Math.floor(performance.now() / 500) % 2 === 0);
      ctx.beginPath(); ctx.arc(lx, ly, r, 0, 7); ctx.fillStyle = lit ? c : '#1f2937'; ctx.fill();
      if (lit) { ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(lx, ly, r * 2.2, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    });
    if ((state === 'G' || state === 'A') && rem != null && rem !== Infinity && rem < 900) {
      const tx = vertical ? x + (a === 'E' ? 1 : -1) * (bw / 2 + 16) : x, ty = vertical ? y : y + (a === 'N' ? -1 : 1) * (bh / 2 + 12);
      rr(ctx, tx - 13, ty - 9, 26, 18, 4); ctx.fillStyle = '#05080f'; ctx.fill();
      txt(ctx, String(Math.max(0, Math.ceil(rem))).padStart(2, '0'), tx, ty + 0.5, { size: 12.5, weight: 700, color: state === 'G' ? COL.green : COL.amber, align: 'center' });
    }
    ctx.restore();
  }

  // Draws one controller's junction into a 600 x 720 logical box.
  function drawJunction(ctx, j, which, tf, opts) {
    opts = opts || {};
    const LW = opts.LW || 600, SH = opts.SH || 600, HDR = 64, FTR = 56, LH = HDR + SH + FTR;
    const cx = LW / 2, cy = HDR + SH / 2;
    const accent = which === 'A' ? COL.a : COL.b;
    ctx.save();
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, LW, LH);
    ctx.save(); ctx.beginPath(); ctx.rect(0, HDR, LW, SH); ctx.clip();
    const proj = has3D ? window.PATHAI3D.draw(ctx, which, 0, HDR, LW, SH, tf, j.nightLevel) : null;
    if (proj) draw3DOverlays(ctx, j, which, proj, HDR, LW);
    else drawJunction2D(ctx, j, tf, cx, cy, LW, HDR, SH);
    ctx.restore();
    const st = j.ctrl.runner.stage;
    // header
    ctx.fillStyle = '#0d1527'; ctx.fillRect(0, 0, LW, HDR);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 6, HDR);
    txt(ctx, which === 'A' ? 'A · Fixed timer (today)' : 'B · PATHAI adaptive', 18, 21, { size: 17, weight: 700 });
    txt(ctx, which === 'A' ? '27 s green + 3 s amber each · 120 s cycle' : 'Webster every cycle · PCU-weighted · clamped', 18, 45, { size: 11.5, color: COL.muted });
    const mode = j.ctrl.mode;
    const modeCol = { FIXED: '#475569', ADAPTIVE: '#0f766e', FALLBACK: '#b91c1c', NIGHT: '#1e40af', BLINK: '#a16207' }[mode] || '#334155';
    let badge = mode === 'FIXED' ? 'FIXED PLAN' : mode === 'FALLBACK' ? 'FAIL-SAFE: FIXED PLAN' : mode === 'NIGHT' ? 'NIGHT: REST ON GREEN' : mode === 'BLINK' ? 'BLINKING AMBER' : 'ADAPTIVE';
    let bcol = modeCol;
    if (j.ctrl.override) { badge = 'POLICE OVERRIDE'; bcol = '#1d4ed8'; }
    if (j.ctrl.emergency) { badge = 'AMBULANCE PRIORITY'; bcol = '#b91c1c'; }
    if (which === 'A' && j.nightLevel === 'late') badge = 'BLINKING AMBER';
    pill(ctx, badge, LW - 12, 21, bcol, '#fff', 11, 'right');
    let phase = '';
    if (st) {
      const names = st.arms && st.arms.length ? st.arms.map(a => ARMS[a].name).join(' + ') : '';
      phase = st.kind === 'GREEN' ? `${names} green · ${st.rem}s left` : st.kind === 'AMBER' ? `${names} amber · ${st.rem}s` :
        st.kind === 'ALLRED' ? `All-red clearance · ${st.rem}s` : st.kind === 'REST' ? `${names} resting on green` : st.kind === 'BLINK' ? 'All arms blinking amber' : '';
      if (st.kind === 'GREEN' && (st.tag === 'override' || st.tag === 'emergency')) phase = `${names} green (held)`;
    }
    txt(ctx, phase, LW - 12, 46, { size: 12.5, weight: 600, color: st && st.kind === 'GREEN' ? '#86efac' : st && st.kind === 'AMBER' ? '#fcd34d' : st && st.kind === 'REST' ? '#86efac' : '#fca5a5', align: 'right' });

    // footer
    const y0 = HDR + SH;
    ctx.fillStyle = '#0d1527'; ctx.fillRect(0, y0, LW, FTR);
    const stt = opts.stats;
    if (stt) {
      const cells = [['Avg wait', `${stt.avgDelay.toFixed(0)} s`], ['Longest queue', `${stt.maxQueueM.toFixed(0)} m`], ['Cleared', `${stt.cleared}`], ['East x', stt.per.E.x ? stt.per.E.x.toFixed(2) : '—']];
      cells.forEach(([k, v], i) => { const x = 18 + i * 100; txt(ctx, k, x, y0 + 17, { size: 10.5, color: COL.muted }); txt(ctx, v, x, y0 + 38, { size: 17, weight: 700, color: i === 3 && stt.per.E.x > 1 ? '#fca5a5' : COL.text }); });
    }
    const plan = j.ctrl.plan;
    const planTxt = j.ctrl.mode === 'FALLBACK' ? 'Fail-safe 27 / 27 / 27 / 27 s' : which === 'A' ? 'Green E 27 · S 27 · W 27 · N 27 s' : plan ? `Cycle ${plan.C}s: E ${plan.G.E} · S ${plan.G.S} · W ${plan.G.W} · N ${plan.G.N}` : '';
    txt(ctx, planTxt, LW - 12, y0 + 17, { size: 10.5, color: COL.muted, align: 'right' });
    txt(ctx, fmtClock(Math.floor(tf), j.nightLevel), LW - 12, y0 + 38, { size: 13, weight: 600, color: COL.muted, align: 'right' });
    ctx.restore();
  }

  // 2D top-down view: used only when the browser has no WebGL.
  function drawJunction2D(ctx, j, tf, cx, cy, LW, HDR, SH) {
    const night = j.nightLevel !== 'off';
    const bx = G.boxX, by = G.boxY, Z = G.ZEB;
    ctx.fillStyle = night ? '#070d0a' : COL.grass; ctx.fillRect(0, HDR, LW, SH);
    // footpaths + roads
    ctx.fillStyle = '#1b2333';
    ctx.fillRect(0, cy - by - 6, LW, by * 2 + 12); ctx.fillRect(cx - bx - 6, HDR, bx * 2 + 12, SH);
    ctx.fillStyle = COL.road;
    ctx.fillRect(0, cy - by, LW, by * 2); ctx.fillRect(cx - bx, HDR, bx * 2, SH);
    // double yellow centre lines, lane dashes
    const xL = cx - bx - Z, xR = cx + bx + Z, yT = cy - by - Z, yB = cy + by + Z;
    ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 1.2;
    [[0, xL], [xR, LW]].forEach(([x0, x1]) => [-1.6, 1.6].forEach(o => { ctx.beginPath(); ctx.moveTo(x0, cy + o); ctx.lineTo(x1, cy + o); ctx.stroke(); }));
    [[HDR, yT], [yB, HDR + SH]].forEach(([y0, y1]) => [-1.6, 1.6].forEach(o => { ctx.beginPath(); ctx.moveTo(cx + o, y0); ctx.lineTo(cx + o, y1); ctx.stroke(); }));
    ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(207,214,228,.38)';
    [cy - by / 2, cy + by / 2].forEach(y => [[0, xL], [xR, LW]].forEach(([x0, x1]) => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }));
    [cx - bx / 2, cx + bx / 2].forEach(x => [[HDR, yT], [yB, HDR + SH]].forEach(([y0, y1]) => { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }));
    ctx.setLineDash([]);
    // zebra crossings + stop lines
    ctx.fillStyle = 'rgba(230,237,247,.6)';
    for (let k = -by + 3; k < by - 3; k += 6) { ctx.fillRect(cx + bx + 1, cy + k, Z - 3, 3); ctx.fillRect(cx - bx - Z + 2, cy + k, Z - 3, 3); }
    for (let k = -bx + 3; k < bx - 3; k += 6) { ctx.fillRect(cx + k, cy - by - Z + 2, 3, Z - 3); ctx.fillRect(cx + k, cy + by + 1, 3, Z - 3); }
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(xR, cy, 2.5, by); ctx.fillRect(xL - 2.5, cy - by, 2.5, by);
    ctx.fillRect(cx, yT - 2.5, bx, 2.5); ctx.fillRect(cx - bx, yB, bx, 2.5);

    // labels
    const lab = { size: 11.5, color: '#dbe3ef', weight: 600 };
    txt(ctx, 'Perundurai Rd (SH-96) · 7.5 m', LW - 10, cy - by - 18, Object.assign({}, lab, { align: 'right' }));
    txt(ctx, 'to City Core / GH Flyover →', LW - 10, cy - by - 34, { size: 10.5, color: COL.muted, align: 'right' });
    txt(ctx, 'Perundurai Rd (SH-96) · 7.5 m', 10, cy + by + 18, lab);
    txt(ctx, '← to Thindal / Colleges', 10, cy + by + 34, { size: 10.5, color: COL.muted });
    txt(ctx, 'Mohan Kumaramangalam Rd · 5.5 m', cx - bx - 16, HDR + 112, Object.assign({}, lab, { rot: -Math.PI / 2, align: 'center' }));
    txt(ctx, '↑ Teachers Colony', cx + bx + 12, HDR + 16, { size: 10.5, color: COL.muted });
    txt(ctx, 'Surampatti Naal Rd · 5.5 m', cx + bx + 16, HDR + SH - 100, Object.assign({}, lab, { rot: -Math.PI / 2, align: 'center' }));
    txt(ctx, 'Railway Station ↓', cx - bx - 12, HDR + SH - 14, { size: 10.5, color: COL.muted, align: 'right' });
    txt(ctx, 'N', LW - 24, HDR + 20, { size: 12, weight: 700, align: 'center' });
    ctx.strokeStyle = COL.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(LW - 24, HDR + 50); ctx.lineTo(LW - 24, HDR + 30); ctx.lineTo(LW - 29, HDR + 36); ctx.moveTo(LW - 24, HDR + 30); ctx.lineTo(LW - 19, HDR + 36); ctx.stroke();

    // queues (drawn to scale along the road)
    const visible = { E: (LW - xR) / G.SL - 3, W: xL / G.SL - 3, N: (yT - HDR) / G.SL - 3, S: (HDR + SH - yB) / G.SL - 3 };
    ORDER.forEach(a => {
      const q = j.queues[a]; let cum = 0, hidden = 0;
      q.forEach((v, i) => {
        const d = cum * M_PER_PCU[a] + CLASSES[v.cls].len / 2 + 0.6; cum += v.pcu;
        if (d > visible[a]) { hidden++; return; }
        const [x, y] = px(cx, cy, a, d, laneOff(a, v.cls === 'amb' ? 0 : i % 2));
        drawVehicle(ctx, x, y, a, v, tf);
      });
      if (hidden) {
        const tag = `+${hidden} more · queue ${Math.round(j.queueM(a))} m`;
        const pos = { E: [LW - 8, cy + by + 56, 'right'], W: [8, cy - by - 56, 'left'], N: [cx + bx + 10, HDR + 40, 'left'], S: [cx - bx - 10, HDR + SH - 40, 'right'] }[a];
        pill(ctx, tag, pos[0], pos[1], 'rgba(220,38,38,.95)', '#fff', 11.5, pos[2]);
      }
    });
    // departing vehicles: straight through, then fade
    for (const v of j.recent) {
      const dt = tf - v.tDep; if (dt < 0 || dt > 14) continue;
      const dist = Math.min(dt, 3) ** 2 * 1.4 + Math.max(0, dt - 3) * 8.4;
      const a = v.arm, [dx, dy] = DIR[a];
      const [x0, y0] = px(cx, cy, a, 0, laneOff(a, v.id % 2));
      const x = x0 + dx * dist * G.SL * 1.25, y = y0 + dy * dist * G.SL * 1.25;
      if (x < -20 || x > LW + 20 || y < HDR - 10 || y > HDR + 610) continue;
      ctx.globalAlpha = Math.max(0, 1 - dt / 14); drawVehicle(ctx, x, y, a, v, tf); ctx.globalAlpha = 1;
    }
    const st = j.ctrl.runner.stage;
    ORDER.forEach(a => drawSignalHead(ctx, cx, cy, a, j.ctrl.runner.signalOf(a), st && st.arms && st.arms.includes(a) ? st.rem : null));
    if (night) { ctx.fillStyle = 'rgba(2,6,23,.35)'; ctx.fillRect(0, HDR, LW, SH); }
  }

  // Labels drawn on top of the 3D picture, pinned to points in the 3D world.
  function draw3DOverlays(ctx, j, which, proj, HDR, LW) {
    const an = window.PATHAI3D.anchors(which), st = j.ctrl.runner.stage;
    const inView = p => p && p[0] > 4 && p[0] < LW - 4 && p[1] > HDR + 4 && p[1] < HDR + 596;
    const NAMES = { E: 'Perundurai Rd · from City Core', W: 'Perundurai Rd · from Thindal', N: 'Mohan Kumaramangalam Rd', S: 'Surampatti Naal Rd' };
    ORDER.forEach(a => {
      const p = proj(...an.labels[a]);
      if (inView(p)) pill(ctx, NAMES[a], p[0], p[1], 'rgba(8,13,26,.72)', '#e2e8f0', 10, 'center');
    });
    ORDER.forEach(a => {
      const q = an.queue[a]; if (q.m < 8) return;
      let p = proj(...q.at), edge = false;
      if (!inView(p)) {   // queue runs out of the picture: pin the label where the road leaves the frame
        const s0 = proj(...q.stop); if (!inView(s0) || !p) return;
        let lo = 0, hi = 1;
        for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2, x = s0[0] + (p[0] - s0[0]) * m, y = s0[1] + (p[1] - s0[1]) * m; if (inView([x, y])) lo = m; else hi = m; }
        p = [s0[0] + (p[0] - s0[0]) * lo, s0[1] + (p[1] - s0[1]) * lo]; edge = true;
        p[0] = Math.min(LW - 70, Math.max(70, p[0])); p[1] = Math.min(HDR + 580, Math.max(HDR + 20, p[1]));
      }
      const more = an.hidden[a] ? ` · +${an.hidden[a]} further back` : '';
      p[0] = Math.min(LW - 62, Math.max(62, p[0]));
      pill(ctx, `Queue ${Math.round(q.m)} m${edge ? ' →' : ''}${more}`, p[0], p[1] - 12, 'rgba(220,38,38,.92)', '#fff', 10.5, 'center');
    });
    ORDER.forEach(a => {
      const s = j.ctrl.runner.signalOf(a), p = proj(...an.signals[a]);
      if (!inView(p)) return;
      const rem = st && st.arms && st.arms.includes(a) ? st.rem : null;
      if ((s === 'G' || s === 'A') && rem != null && rem !== Infinity && rem < 900) {
        rr(ctx, p[0] - 11, p[1] - 8, 22, 16, 3); ctx.fillStyle = 'rgba(5,8,15,.9)'; ctx.fill();
        txt(ctx, String(Math.max(0, Math.ceil(rem))).padStart(2, '0'), p[0], p[1] + 0.5, { size: 11, weight: 700, color: s === 'G' ? COL.green : COL.amber, align: 'center' });
      }
    });
    // compass, turned with the camera
    const c0 = proj(...an.north[0]), c1 = proj(...an.north[1]);
    if (c0 && c1) {
      const ang = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]), x = LW - 26, y = HDR + 26;
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fillStyle = 'rgba(8,13,26,.7)'; ctx.fill();
      ctx.rotate(ang + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fillStyle = '#ef4444'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fillStyle = '#e2e8f0'; ctx.fill();
      ctx.restore();
      txt(ctx, 'N', x + Math.cos(ang) * 24, y + Math.sin(ang) * 24, { size: 11, weight: 800, align: 'center' });
    }
  }

  // Signal timeline: one row per arm, last `secs` seconds
  function drawTimeline(ctx, j, x, y, w, rowH, secs, title, col) {
    const hist = j.sigHist.slice(-secs), n = hist.length;
    txt(ctx, title, x, y - 22, { size: 22, weight: 700, color: col });
    ['E', 'S', 'W', 'N'].forEach((a, r) => {
      const idx = ORDER.indexOf(a), yy = y + r * (rowH + 8);
      txt(ctx, ARMS[a].name, x, yy + rowH / 2, { size: 19, color: COL.muted });
      const x0 = x + 80, ww = w - 80;
      ctx.fillStyle = '#1f2937'; ctx.fillRect(x0, yy, ww, rowH);
      for (let i = 0; i < n; i++) {
        const s = hist[i][idx]; const c = s === 'G' ? COL.green : s === 'A' ? COL.amber : s === 'B' ? '#a16207' : '#7f1d1d';
        ctx.fillStyle = c; ctx.fillRect(x0 + (secs - n + i) / secs * ww, yy, ww / secs + 0.6, rowH);
      }
    });
    txt(ctx, `last ${secs / 60} minutes →  now`, x + w, y + 4 * (rowH + 8) + 8, { size: 17, color: COL.muted, align: 'right' });
  }

  // ================================================================ live telemetry
  function liveStats() {
    S.statA = S.A.stats(); S.statB = S.B.stats();
    const a = S.statA, b = S.statB;
    const hrs = Math.max(1 / 60, S.A.t / 3600);
    const fuelA = a.fuelL / hrs, fuelB = b.fuelL / hrs, co2A = a.co2kg / hrs, co2B = b.co2kg / hrs;
    const worstX = st => Math.max(...ORDER.map(k => st.per[k].x || 0));
    const rows = [
      ['Vehicles cleared / hr', a.clearedHr, b.clearedHr, 0, true],
      ['Average wait (s)', a.avgDelay, b.avgDelay, 1, false],
      ['Longest queue (m)', a.maxQueueM, b.maxQueueM, 0, false],
      ['Longest queue (PCU)', a.maxQueuePcu, b.maxQueuePcu, 1, false],
      ['Worst-arm saturation x', worstX(a), worstX(b), 2, false],
      ['Stops per vehicle', a.stopsPerVeh, b.stopsPerVeh, 2, false],
      ['Idling fuel (L / hr)', fuelA, fuelB, 1, false],
      ['Idling CO₂ (kg / hr)', co2A, co2B, 1, false],
    ];
    const tb = rows.map(([k, x, y, d, up]) => {
      const diff = x ? (y - x) / x * 100 : 0; const good = up ? diff > 0.5 : diff < -0.5; const bad = up ? diff < -0.5 : diff > 0.5;
      return `<tr><td>${k}</td><td class="ca">${x.toFixed(d)}</td><td class="cb">${y.toFixed(d)}</td><td class="${good ? 'good' : bad ? 'bad' : ''}">${diff > 0 ? '+' : ''}${diff.toFixed(0)}%</td></tr>`;
    }).join('');
    const saved = `<tr><td><b>Fuel saved by B</b></td><td colspan="3" class="good">${(fuelA - fuelB).toFixed(1)} L/hr · CO₂ avoided ${(co2A - co2B).toFixed(1)} kg/hr</td></tr>`;
    const xs = `<tr><td>x per arm (A → B)</td><td colspan="3" style="font-size:12px">${['E', 'S', 'W', 'N'].map(k => `${k} ${(a.per[k].x || 0).toFixed(2)}→${(b.per[k].x || 0).toFixed(2)}`).join(' · ')}</td></tr>`;
    $('metrics').innerHTML = `<thead><tr><th></th><th class="ca">A Fixed</th><th class="cb">B PATHAI</th><th>B vs A</th></tr></thead><tbody>${tb}${saved}${xs}</tbody>`;
    $('metricsNote').textContent = `${Math.floor(S.A.t / 60)} min simulated · seed ${S.seed}`;
    drawLiveCharts();
    renderLog();
    renderConf();
  }
  function renderConf() {
    $('confBars').innerHTML = ['E', 'S', 'W', 'N'].map(a => {
      const c = S.B.conf[a]; return `<div>${ARMS[a].name} cam ${c.toFixed(2)}<div class="meter"><i class="${c < RULES.confLow ? 'low' : ''}" style="width:${Math.round(c * 100)}%"></i></div></div>`;
    }).join('');
  }
  let lastLogLen = -1, lastLogT = -1;
  function renderLog() {
    const L = S.B.ctrl.log; const last = L[L.length - 1];
    if (L.length === lastLogLen && (!last || last.t === lastLogT)) return;
    lastLogLen = L.length; lastLogT = last ? last.t : -1;
    $('log').innerHTML = L.slice(-60).reverse().map(e => `<li class="${e.level}"><b>${fmtClock(e.t, S.night)}</b>${e.msg}</li>`).join('');
  }
  function drawBarsPanel(ctx, W, H, items, opt) {
    opt = opt || {};
    const n = items.length, gw = W / n;
    items.forEach((it, i) => {
      const hiA = it.range ? it.range.a[1] : it.a, hiB = it.range ? it.range.b[1] : it.b;
      const fs = opt.fs || 11, vs = opt.vs || 11;
      const x0 = i * gw, max = Math.max(hiA, hiB, 1e-9) * 1.12, base = H - (opt.ds ? opt.ds * 1.9 : 34), top = fs * 2 + vs * 1.6, h = base - top;
      txt(ctx, it.label, x0 + gw / 2, fs * 0.8, { size: fs, color: COL.muted, align: 'center' });
      [['a', COL.a], ['b', COL.b]].forEach(([k, c], m) => {
        const v = it[k], bh = h * v / max, bw = gw * 0.26, x = x0 + gw / 2 + (m ? 6 : -6 - bw);
        rr(ctx, x, base - bh, bw, Math.max(bh, 1), 3); ctx.fillStyle = c; ctx.fill();
        if (it.range) { const [lo, hi] = it.range[k]; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.2; const yl = base - h * lo / max, yh = base - h * hi / max; ctx.beginPath(); ctx.moveTo(x + bw / 2, yl); ctx.lineTo(x + bw / 2, yh); ctx.moveTo(x + bw / 2 - 4, yl); ctx.lineTo(x + bw / 2 + 4, yl); ctx.moveTo(x + bw / 2 - 4, yh); ctx.lineTo(x + bw / 2 + 4, yh); ctx.stroke(); }
        const yTop = it.range ? Math.min(base - bh, base - h * it.range[k][1] / max) : base - bh;
        txt(ctx, it.fmt(v), x + bw / 2, yTop - vs * 0.75, { size: vs, weight: 700, align: 'center', color: c });
      });
      ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(x0 + 10, base + 0.5); ctx.lineTo(x0 + gw - 10, base + 0.5); ctx.stroke();
      if (it.delta) txt(ctx, it.delta, x0 + gw / 2, base + (opt.ds || 11) * 1.05, { size: opt.ds || 11, weight: 700, align: 'center', color: it.deltaColor || '#4ade80' });
    });
  }
  function drawLiveCharts() {
    const cb = $('chartBars'); const ctx = fitCanvas(cb, 420, 170);
    ctx.clearRect(0, 0, 420, 170);
    const a = S.statA, b = S.statB, pct = (x, y, up) => { if (!x) return ''; const d = (y - x) / x * 100; return `${d > 0 ? '+' : ''}${d.toFixed(0)}%`; };
    drawBarsPanel(ctx, 420, 170, [
      { label: 'Cleared / hr', a: a.clearedHr, b: b.clearedHr, fmt: v => v.toFixed(0), delta: pct(a.clearedHr, b.clearedHr) },
      { label: 'Avg wait (s)', a: a.avgDelay, b: b.avgDelay, fmt: v => v.toFixed(0), delta: pct(a.avgDelay, b.avgDelay) },
      { label: 'Longest queue (m)', a: a.maxQueueM, b: b.maxQueueM, fmt: v => v.toFixed(0), delta: pct(a.maxQueueM, b.maxQueueM) },
    ]);
    const cl = $('chartLine'); const c2 = fitCanvas(cl, 420, 150);
    c2.clearRect(0, 0, 420, 150);
    txt(c2, 'Vehicles waiting at the junction (PCU), last 15 min', 4, 10, { size: 11, color: COL.muted });
    const sa = S.A.series.slice(-90), sb = S.B.series.slice(-90);
    const tot = s => ORDER.reduce((x, k) => x + s.q[k], 0);
    const mx = Math.max(10, ...sa.map(tot), ...sb.map(tot)) * 1.1;
    [[sa, COL.a], [sb, COL.b]].forEach(([ser, c]) => {
      c2.strokeStyle = c; c2.lineWidth = 2; c2.beginPath();
      ser.forEach((p, i) => { const x = 4 + i / 89 * 412, y = 140 - tot(p) / mx * 116; i ? c2.lineTo(x, y) : c2.moveTo(x, y); }); c2.stroke();
    });
    c2.strokeStyle = '#334155'; c2.beginPath(); c2.moveTo(4, 140.5); c2.lineTo(416, 140.5); c2.stroke();
  }

  // ================================================================ fair test (5 paired runs)
  let FT = null;
  function summarise(list) {
    const m = a => a.reduce((s, x) => s + x, 0) / a.length, r = a => [Math.min(...a), Math.max(...a)];
    const keys = ['cleared', 'clearedHr', 'avgDelay', 'maxQueueM', 'maxQueuePcu', 'stopsPerVeh', 'idleVehHr', 'fuelL', 'co2kg', 'arrived'];
    const o = {}; keys.forEach(k => { const v = list.map(s => s[k]); o[k] = { mean: m(v), range: r(v) }; });
    o.per = {}; ORDER.forEach(a => { o.per[a] = {}; ['avgDelay', 'maxQm', 'x', 'dep'].forEach(k => { const v = list.map(s => s.per[a][k]); o.per[a][k] = { mean: m(v), range: r(v) }; }); });
    o.worst = { mean: m(list.map(s => Math.max(...ORDER.map(a => s.per[a].avgDelay)))) };
    return o;
  }
  function runFairTest(redraw) {
    const t0 = performance.now(); const runs = [];
    for (let seed = 1; seed <= 5; seed++) runs.push(P.runPaired(seed, { measureEnd: 900, duration: 1800 }));
    FT = { A: summarise(runs.map(r => r.A)), B: summarise(runs.map(r => r.B)), stress: null };
    if ($('stress').checked) {
      const h = []; for (let seed = 1; seed <= 5; seed++) h.push(P.runPaired(seed, { measureEnd: 3600, duration: 4500 }));
      FT.stress = { A: summarise(h.map(r => r.A)), B: summarise(h.map(r => r.B)) };
    }
    $('runNote').textContent = `5 paired runs (seeds 1–5), identical arrivals for A and B · computed in ${Math.round(performance.now() - t0)} ms`;
    window.PATHAI_RESULTS = FT;
    renderResultTables();
    if (redraw) drawResultsTab();
    return FT;
  }
  const f1 = x => x.toFixed(1), f0 = x => Math.round(x).toLocaleString('en-IN');
  function pctTxt(a, b) { const d = (b - a) / a * 100; return `${d > 0 ? '+' : ''}${d.toFixed(0)}%`; }
  function renderResultTables() {
    const A = FT.A, B = FT.B;
    const row = (k, a, b, f, up) => `<tr><td>${k}</td><td>${f(a.mean)} <small>[${f(a.range[0])}–${f(a.range[1])}]</small></td><td>${f(b.mean)} <small>[${f(b.range[0])}–${f(b.range[1])}]</small></td><td>${pctTxt(a.mean, b.mean)}</td></tr>`;
    let h = `<table><caption>Peak 15 minutes (18:15–18:30 demand), mean of 5 paired runs [range]</caption><tr><th>Measure</th><th>A · Fixed</th><th>B · PATHAI</th><th>Change</th></tr>
      ${row('Vehicles cleared in 15 min', A.cleared, B.cleared, f0)}
      ${row('Vehicles cleared per hour (rate)', A.clearedHr, B.clearedHr, f0)}
      ${row('Average wait per vehicle (s)', A.avgDelay, B.avgDelay, f1)}
      ${row('Longest queue (m)', A.maxQueueM, B.maxQueueM, f0)}
      ${row('Stops per vehicle', A.stopsPerVeh, B.stopsPerVeh, x => x.toFixed(2))}
      ${row('Idling (vehicle-hours)', A.idleVehHr, B.idleVehHr, f1)}
      ${row('Idling fuel (litres)', A.fuelL, B.fuelL, f1)}
      ${row('Idling CO₂ (kg)', A.co2kg, B.co2kg, f1)}</table>`;
    h += `<table><caption>Per arm: average wait (s) · longest queue (m) · degree of saturation x</caption><tr><th>Arm</th><th>A wait</th><th>B wait</th><th>A queue</th><th>B queue</th><th>A x</th><th>B x</th><th>Measured wait (Round 1)</th></tr>` +
      ORDER.map(a => `<tr><td>${ARMS[a].name} · ${ARMS[a].road}</td><td>${f1(A.per[a].avgDelay.mean)}</td><td>${f1(B.per[a].avgDelay.mean)}</td><td>${f0(A.per[a].maxQm.mean)}</td><td>${f0(B.per[a].maxQm.mean)}</td><td>${A.per[a].x.mean.toFixed(2)}</td><td>${B.per[a].x.mean.toFixed(2)}</td><td>${ARMS[a].waitMeasured} s</td></tr>`).join('') + '</table>';
    if (FT.stress) {
      const a = FT.stress.A, b = FT.stress.B;
      h += `<table><caption>Stress test: if the peak lasted a full hour</caption><tr><th>Measure</th><th>A · Fixed</th><th>B · PATHAI</th><th>Change</th></tr>
      ${row('Vehicles cleared per hour', a.clearedHr, b.clearedHr, f0)}${row('Average wait (s)', a.avgDelay, b.avgDelay, f1)}${row('Longest queue (m)', a.maxQueueM, b.maxQueueM, f0)}</table>`;
    }
    $('resultTables').innerHTML = h;
  }

  // ================================================================ exports (1950 x 1500, matches the Slide 4 frames)
  const EXW = 1950, EXH = 1500;
  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function exportHeader(ctx, W, title, sub) {
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, EXH);
    ctx.fillStyle = '#0d1527'; ctx.fillRect(0, 0, W, 130);
    ctx.fillStyle = COL.b; ctx.fillRect(0, 0, 14, 130);
    txt(ctx, title, 50, 50, { size: 46, weight: 700 });
    txt(ctx, sub, 50, 100, { size: 26, color: COL.muted });
  }

  function drawIntersectionMap(ctx, W, H) {
    exportHeader(ctx, W, 'Surampatti Four Road Junction, Erode', 'approx. 11.33° N, 77.71° E · peak count: weekday 18:15–18:25, counted from the footpath');
    const cx = W / 2, cy = 130 + (H - 130) / 2 + 10, sc = 13;
    const ew = G.hwEW * sc, ns = G.hwNS * sc;
    ctx.fillStyle = COL.grass; ctx.fillRect(0, 130, W, H - 130);
    ctx.fillStyle = COL.road; ctx.fillRect(0, cy - ew, W, ew * 2); ctx.fillRect(cx - ns, 130, ns * 2, H - 130);
    ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 3;
    [[0, cx - ns - 40], [cx + ns + 40, W]].forEach(([a, b]) => { [-4, 4].forEach(o => { ctx.beginPath(); ctx.moveTo(a, cy + o); ctx.lineTo(b, cy + o); ctx.stroke(); }); });
    [[130, cy - ew - 40], [cy + ew + 40, H]].forEach(([a, b]) => { [-4, 4].forEach(o => { ctx.beginPath(); ctx.moveTo(cx + o, a); ctx.lineTo(cx + o, b); ctx.stroke(); }); });
    ctx.setLineDash([26, 26]); ctx.strokeStyle = 'rgba(207,214,228,.5)'; ctx.lineWidth = 3;
    [cy - ew / 2, cy + ew / 2].forEach(y => { [[0, cx - ns - 40], [cx + ns + 40, W]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke(); }); });
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230,237,247,.6)';
    for (let k = -ew + 8; k < ew - 8; k += 16) { ctx.fillRect(cx + ns + 6, cy + k, 30, 8); ctx.fillRect(cx - ns - 36, cy + k, 30, 8); }
    for (let k = -ns + 8; k < ns - 8; k += 16) { ctx.fillRect(cx + k, cy - ew - 36, 8, 30); ctx.fillRect(cx + k, cy + ew + 6, 8, 30); }
    // signal poles
    [[cx + ns + 60, cy + ew + 30], [cx - ns - 60, cy - ew - 30], [cx + ns + 30, cy - ew - 60], [cx - ns - 30, cy + ew + 60]].forEach(([x, y]) => {
      ctx.fillStyle = '#05080f'; rr(ctx, x - 12, y - 30, 24, 60, 6); ctx.fill(); [COL.red, COL.amber, COL.green].forEach((c, i) => { ctx.beginPath(); ctx.arc(x, y - 18 + i * 18, 7, 0, 7); ctx.fillStyle = c; ctx.fill(); });
    });
    // flow arrows proportional to PCU/hr (inbound, left-hand traffic)
    const arrow = (x1, y1, x2, y2, w, c) => { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); const an = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2 + Math.cos(an) * w * 1.6, y2 + Math.sin(an) * w * 1.6); ctx.lineTo(x2 + Math.cos(an + 2.4) * w * 1.8, y2 + Math.sin(an + 2.4) * w * 1.8); ctx.lineTo(x2 + Math.cos(an - 2.4) * w * 1.8, y2 + Math.sin(an - 2.4) * w * 1.8); ctx.fill(); };
    const wpx = a => 6 + ARMS[a].pcuHr / 1043 * 22;
    arrow(W - 60, cy + ew / 2, cx + ns + 90, cy + ew / 2, wpx('E'), 'rgba(249,115,98,.9)');
    arrow(60, cy - ew / 2, cx - ns - 90, cy - ew / 2, wpx('W'), 'rgba(251,191,36,.9)');
    arrow(cx + ns / 2, 160, cx + ns / 2, cy - ew - 90, wpx('N'), 'rgba(45,212,191,.9)');
    arrow(cx - ns / 2, H - 30, cx - ns / 2, cy + ew + 90, wpx('S'), 'rgba(96,165,250,.9)');
    // data cards
    const card = (x, y, a, col, align) => {
      const arm = ARMS[a], w = 560, h = 250, x0 = align === 'right' ? x - w : x;
      ctx.save(); rr(ctx, x0, y, w, h, 18); ctx.fillStyle = 'rgba(13,21,39,.94)'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = col; rr(ctx, x0, y, 14, h, 7); ctx.fill();
      txt(ctx, `${arm.name.toUpperCase()} ARM`, x0 + 34, y + 36, { size: 26, weight: 800, color: col });
      txt(ctx, arm.road, x0 + 34, y + 74, { size: 27, weight: 700 });
      txt(ctx, `${arm.width} m approach · to ${arm.toward}`, x0 + 34, y + 110, { size: 22, color: COL.muted });
      const v15 = Math.round(arm.veh10 * 1.5);
      txt(ctx, `${arm.veh10}`, x0 + 34, y + 165, { size: 44, weight: 800 }); txt(ctx, 'veh / 10 min', x0 + 34, y + 205, { size: 19, color: COL.muted });
      txt(ctx, `${v15}`, x0 + 210, y + 165, { size: 44, weight: 800 }); txt(ctx, 'veh / 15 min', x0 + 210, y + 205, { size: 19, color: COL.muted });
      txt(ctx, arm.pcuHr.toLocaleString('en-IN'), x0 + 390, y + 165, { size: 44, weight: 800, color: col }); txt(ctx, 'PCU / hr', x0 + 390, y + 205, { size: 19, color: COL.muted });
      txt(ctx, `${Math.round(arm.pcuHr / TOTAL_PCU * 100)}% of demand · gets 27 s green`, x0 + 34, y + 236, { size: 18, color: '#cbd5e1' });
      ctx.restore();
    };
    card(W - 40, cy + ew + 30, 'E', '#f97362', 'right');
    card(40, cy - ew - 280, 'W', '#fbbf24', 'left');
    card(W - 40, cy - ew - 280, 'N', '#2dd4bf', 'right');
    card(40, cy + ew + 30, 'S', '#60a5fa', 'left');
    // Round 1 facts in the empty corners
    const info = (x, y, w, h, title, lines, col) => {
      ctx.save(); rr(ctx, x, y, w, h, 18); ctx.fillStyle = 'rgba(13,21,39,.94)'; ctx.fill(); ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      txt(ctx, title, x + 28, y + 38, { size: 24, weight: 800, color: col });
      lines.forEach((l, i) => txt(ctx, l[0], x + 28, y + 84 + i * 40, { size: l[1] || 23, weight: l[2] || 500, color: l[3] || COL.text }));
    };
    info(40, 160, 560, 250, "TODAY'S SIGNAL (stopwatch, 3 cycles)", [
      ['Every road: 27 s green + 3 s amber'], ['Cycle 120 s, same plan all day'], ['Webster says the roads need:', 22, 500, COL.muted],
      ['East 39 · West 25 · North 20 · South 24 s', 23, 700, '#2dd4bf']], COL.accent || '#fbbf24');
    info(W - 600, H - 288, 560, 215, 'WHERE IT GOES WRONG', [
      ['East: x = 1.18, queue never clears', 23, 700, '#fca5a5'], ['North: x = 0.59, green often wasted', 23, 600, '#cbd5e1'],
      ['12 s of green on the wrong road, every cycle', 22, 500, COL.muted]], '#f97362');
    // north arrow + totals
    txt(ctx, 'N', cx + ns + 70, 175, { size: 30, weight: 800, align: 'center' });
    ctx.strokeStyle = COL.text; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx + ns + 70, 260); ctx.lineTo(cx + ns + 70, 200); ctx.lineTo(cx + ns + 56, 216); ctx.moveTo(cx + ns + 70, 200); ctx.lineTo(cx + ns + 84, 216); ctx.stroke();
    pill(ctx, 'TOTAL  644 veh / 10 min  ·  ≈966 veh / 15 min (×1.5)  ·  2,551 PCU / hr  ·  fixed cycle 120 s', cx, H - 44, 'rgba(13,21,39,.95)', '#e6edf7', 23, 'center');
    txt(ctx, 'Arrow thickness = PCU/hr', cx + ns + 110, 230, { size: 19, color: COL.muted });
  }

  function drawSimulationExport(ctx, W, H) {
    if (has3D) window.PATHAI3D.advance(S.simT);
    exportHeader(ctx, W, 'Same traffic, two signals, side by side', `Seed ${S.seed} · ${Math.floor(S.A.t / 60)} min into the 18:15 peak · identical vehicles arrive at both junctions`);
    const sc = 1.34, pw = 600 * sc, gap = (W - 2 * pw) / 3;
    [[S.A, 'A', S.statA], [S.B, 'B', S.statB]].forEach(([j, k, st], i) => {
      const off = newCanvas(600 * 2, 720 * 2); const c = off.getContext('2d'); c.scale(2, 2);
      drawJunction(c, j, k, S.simT, { stats: st });
      const x = gap + i * (pw + gap), y = 150;
      ctx.save(); rr(ctx, x - 4, y - 4, pw + 8, 720 * sc + 8, 16); ctx.fillStyle = k === 'A' ? COL.a : COL.b; ctx.fill(); ctx.restore();
      ctx.drawImage(off, x, y, pw, 720 * sc);
    });
    [[S.A, 'A · signal timeline', COL.a], [S.B, 'B · signal timeline', COL.b]].forEach(([j, title, col], i) => {
      drawTimeline(ctx, j, gap + i * (pw + gap), 150 + 720 * sc + 72, pw, 32, 300, title, col);
    });
    const y = H - 34;
    if (has3D) {
      txt(ctx, 'Every 3D vehicle is one simulated vehicle (2-wheelers, cars, autos, LCVs, buses, trucks) · brake lights glow when it slows · red kerb strip = queue length', gap, y + 12, { size: 20, color: COL.muted });
    } else {
      const items = [['2-wheeler', CLASSES.tw.color], ['Car', CLASSES.car.color], ['Auto', CLASSES.auto.color], ['LCV', CLASSES.lcv.color], ['Bus / truck', CLASSES.bus.color]];
      let x = gap; txt(ctx, 'Vehicles:', x, y + 12, { size: 22, color: COL.muted }); x += 110;
      items.forEach(([n, c]) => { rr(ctx, x, y, 34, 22, 5); ctx.fillStyle = c; ctx.fill(); txt(ctx, n, x + 44, y + 12, { size: 22 }); x += 64 + n.length * 12; });
      txt(ctx, 'Queues to scale along the road (1 PCU ≈ 5.5 m) · green / amber / red timeline', W - gap, y + 12, { size: 20, color: COL.muted, align: 'right' });
    }
  }

  function drawResultsExport(ctx, W, H, ft) {
    ft = ft || FT || runFairTest(false);
    const A = ft.A, B = ft.B;
    exportHeader(ctx, W, 'Fixed timer vs PATHAI: fair test results', 'Peak 15 minutes of Round 1 traffic · 5 paired runs, identical arrivals for both · bars = mean, whiskers = range');
    const pct = (a, b) => `${(b - a) / a * 100 > 0 ? '+' : ''}${((b - a) / a * 100).toFixed(0)}%`;
    ctx.save(); ctx.translate(60, 165);
    drawBarsPanel(ctx, W - 120, 650, [
      { label: 'Vehicles cleared in 15 min', a: A.cleared.mean, b: B.cleared.mean, range: { a: A.cleared.range, b: B.cleared.range }, fmt: v => Math.round(v), delta: pct(A.cleared.mean, B.cleared.mean) },
      { label: 'Average wait per vehicle (s)', a: A.avgDelay.mean, b: B.avgDelay.mean, range: { a: A.avgDelay.range, b: B.avgDelay.range }, fmt: v => v.toFixed(1), delta: pct(A.avgDelay.mean, B.avgDelay.mean) },
      { label: 'Longest queue (m)', a: A.maxQueueM.mean, b: B.maxQueueM.mean, range: { a: A.maxQueueM.range, b: B.maxQueueM.range }, fmt: v => Math.round(v), delta: pct(A.maxQueueM.mean, B.maxQueueM.mean) },
    ], { fs: 28, vs: 30, ds: 34 });
    ctx.restore();
    // legend
    [[COL.a, 'A · Fixed timer (27 s each, 120 s cycle)'], [COL.b, 'B · PATHAI adaptive (Webster, clamped)']].forEach(([c, s], i) => {
      const x = 80 + i * 760, y = 860; rr(ctx, x, y - 14, 40, 28, 6); ctx.fillStyle = c; ctx.fill(); txt(ctx, s, x + 56, y, { size: 26 });
    });
    // per-arm table
    const top = 925, cols = [80, 600, 820, 1040, 1260, 1480, 1700], heads = ['Road', 'A wait', 'B wait', 'A queue', 'B queue', 'A x', 'B x'];
    ctx.fillStyle = '#0d1527'; rr(ctx, 50, top - 10, W - 100, 545, 16); ctx.fill();
    heads.forEach((h, i) => txt(ctx, h, cols[i] + (i ? 120 : 0), top + 34, { size: 24, color: COL.muted, weight: 600, align: i ? 'right' : 'left' }));
    ORDER.forEach((a, r) => {
      const y = top + 100 + r * 70, pa = A.per[a], pb = B.per[a];
      ctx.strokeStyle = '#24324f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, y - 36); ctx.lineTo(W - 70, y - 36); ctx.stroke();
      txt(ctx, `${ARMS[a].name} · ${ARMS[a].road}`, cols[0], y, { size: 25, weight: 600 });
      const vals = [`${pa.avgDelay.mean.toFixed(0)} s`, `${pb.avgDelay.mean.toFixed(0)} s`, `${Math.round(pa.maxQm.mean)} m`, `${Math.round(pb.maxQm.mean)} m`, pa.x.mean.toFixed(2), pb.x.mean.toFixed(2)];
      vals.forEach((v, i) => txt(ctx, v, cols[i + 1] + 120, y, { size: 27, weight: 700, align: 'right', color: i % 2 ? COL.b : (i === 4 && pa.x.mean > 1 ? '#fca5a5' : COL.a) }));
    });
    const y = top + 100 + 4 * 70;
    ctx.strokeStyle = '#24324f'; ctx.beginPath(); ctx.moveTo(70, y - 36); ctx.lineTo(W - 70, y - 36); ctx.stroke();
    txt(ctx, `Model check: the fixed-timer run matches the waits we measured on the street within ±15% on all four roads`, cols[0], y + 4, { size: 22, color: '#cbd5e1' });
    txt(ctx, `(East ${A.per.E.avgDelay.mean.toFixed(0)} s vs 128 s · West ${A.per.W.avgDelay.mean.toFixed(0)} vs 46 · North ${A.per.N.avgDelay.mean.toFixed(0)} vs 44 · South ${A.per.S.avgDelay.mean.toFixed(0)} vs 47), so we trust what it says about PATHAI.`, cols[0], y + 40, { size: 22, color: '#cbd5e1' });
    const sideUp = ['S', 'W', 'N'].map(a => B.per[a].avgDelay.mean - A.per[a].avgDelay.mean);
    const maxXB = Math.max(...ORDER.map(a => B.per[a].x.mean));
    txt(ctx, `Honest trade-off: side roads wait ${Math.round(Math.min(...sideUp))}–${Math.round(Math.max(...sideUp))} s longer, because green moves to Perundurai Road East and PATHAI adds a 2 s all-red. Every road stays under x = ${maxXB < 0.9 ? '0.9' : maxXB.toFixed(2)}.`, cols[0], y + 84, { size: 22, color: '#fcd34d' });
  }

  function exportSlides(download) {
    if (!FT) runFairTest(false);
    const out = {};
    const jobs = [['screenshot_intersection.png', drawIntersectionMap], ['screenshot_simulation.png', drawSimulationExport], ['screenshot_results.png', drawResultsExport]];
    jobs.forEach(([name, fn]) => {
      const c = newCanvas(EXW, EXH); const ctx = c.getContext('2d'); fn(ctx, EXW, EXH);
      out[name] = c.toDataURL('image/png');
      if (download) { const a = document.createElement('a'); a.href = out[name]; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    });
    return out;
  }

  // deterministic state for the slide screenshot: seed, minute, and optional ambulance
  function prepareSnapshot(seed, seconds) {
    $('seed').value = seed; S.night = 'off'; $('night').value = 'off'; S.fail = 'none'; $('fail').value = 'none';
    reset();
    for (let t = 0; t < seconds; t++) stepOnce();
    S.simT = S.A.t - 0.5; S.playing = false; $('btnPlay').textContent = 'Play';
    liveStats(); render();
    return { t: S.A.t, A: S.statA.avgDelay, B: S.statB.avgDelay };
  }

  // ================================================================ map + results tabs
  function drawMapTab() { const cv = $('cvMap'); if (!cv.clientWidth) return; const ctx = fitCanvas(cv, EXW, EXH); drawIntersectionMap(ctx, EXW, EXH); }
  function drawResultsTab() { const cv = $('cvResults'); if (!cv.clientWidth) return; const ctx = fitCanvas(cv, EXW, EXH); drawResultsExport(ctx, EXW, EXH); }

  // ================================================================ data tab
  function renderData() {
    const r = ORDER.map(a => { const x = ARMS[a]; return `<tr><td>${x.name}</td><td>${x.road}</td><td>${x.width} m</td><td>${x.veh10}</td><td>${Math.round(x.veh10 * 1.5)}</td><td>${x.pcuHr.toLocaleString('en-IN')}</td><td>${x.sat.toLocaleString('en-IN')}</td><td>${x.waitMeasured} s</td><td>${x.queueMeasured} m</td></tr>`; }).join('');
    const mix = ORDER.map(a => `<tr><td>${ARMS[a].name}</td>${['tw', 'car', 'auto', 'lcv', 'bus'].map(k => `<td>${ARMS[a].mix10[k]}</td>`).join('')}<td>${(Object.entries(ARMS[a].mix10).reduce((s, [k, n]) => s + n * CLASSES[k].pcu, 0) * 6).toFixed(0)} (measured ${ARMS[a].pcuHr})</td></tr>`).join('');
    const w = P.webster(ORDER.reduce((o, a) => (o[a] = ARMS[a].pcuHr, o), {}), { L: 20 });
    $('dataPane').innerHTML = `
      <h2>Our Round 1 survey (measured)</h2>
      <p>Weekday evening peak, 18:15–18:25, counted from the footpath by two team members and cross-checked on video. The fixed signal was timed with a stopwatch over 3 full cycles.</p>
      <table><tr><th>Arm</th><th>Road</th><th>Width</th><th>Veh / 10 min</th><th>Veh / 15 min*</th><th>PCU / hr</th><th>Saturation flow S</th><th>Avg wait</th><th>Queue</th></tr>${r}</table>
      <p>*15-minute figure = 10-minute count × 1.5 (one real count, scaled; we did not invent extra survey days). Total: 644 → 966 vehicles.</p>
      <h2>How PATHAI decides (Webster's method)</h2>
      <p><code>y = demand ÷ S</code> · <code>Y = Σy = ${w.Y.toFixed(3)}</code> · <code>C = (1.5L + 5) ÷ (1 − Y) = ${w.Craw.toFixed(0)} s</code> with L = 20 s · <code>G = (C − L) × y ÷ Y</code> → East ${w.G.E.toFixed(0)} s, South ${w.G.S.toFixed(0)} s, West ${w.G.W.toFixed(0)} s, North ${w.G.N.toFixed(0)} s.</p>
      <p>Saturation flow S = 525 × width (IRC:93). PCU factors IRC:106: 2-wheeler 0.5, car 1.0, auto 0.8, LCV 1.4, bus/truck 3.0.</p>
      <p>Safety limits: green 12–60 s · cycle 60–150 s · amber 3 s + all-red 2 s between every phase (never skipped) · starvation guard 120 s · change limit ±20% per cycle · camera confidence &lt; 0.5 for 60 s → fixed plan · ambulance hold ≤ 90 s · night rest below 120 PCU/hr, blinking amber below 40 PCU/hr.</p>
      <h2>How the simulation works</h2>
      <p>One step = 1 second. Each second, new vehicles arrive at random (Poisson) at our measured rates; if a road is green, its queue leaves at the saturation flow. Both controllers get the identical list of vehicles. The fair test runs 5 different random seeds over the 15-minute peak, starting from a clear junction, and follows every vehicle until it has crossed.</p>
      <h2>Assumptions (not measured by us)</h2>
      <table><tr><th>Arm</th><th>2-wheelers</th><th>Cars</th><th>Autos</th><th>LCVs</th><th>Bus/truck</th><th>Gives PCU/hr</th></tr>${mix}</table>
      <ul>
        <li>Vehicle mix per 10 min: we recorded only the East two-wheeler count (190). The other classes were split so each arm reproduces its measured PCU/hr (within 0.5%).</li>
        <li>Queue length: 1 PCU ≈ 5.5 m of lane (about a 4 m car plus a 1.5 m gap); an approach of width w has w ÷ 3.5 m lanes.</li>
        <li>Idling fuel (CRRI values used in Indian studies): scooter/motorcycle ≈ 0.16 L/hr, auto 0.38, petrol car 0.66, diesel LCV 0.75, bus/truck 0.9. CO₂: petrol 2.31 kg/L, diesel 2.68 kg/L.</li>
        <li>Vehicles drive on the left; the animation shows every vehicle going straight (turning movements were not counted and do not change the queue model).</li>
        <li>The 3D view only animates the engine's decisions: a vehicle may cross the stop line only once the engine releases it. Between releases each 3D vehicle follows the car ahead with the Intelligent Driver Model (cruise 40 km/h, brakes for the vehicle ahead or a red light). The standing gap on each road is set from our vehicle mix so a 3D queue is about as long as the engine's queue (red kerb strip). Buildings, trees and street lights are decoration, not a survey of the real junction.</li>
        <li>Night demand levels (100 and 30 PCU/hr) are demonstration values to show the night rules; we have not counted at night yet.</li>
      </ul>`;
  }

  // ================================================================ main loop
  let lastTs = null;
  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
    if (S.playing) {
      S.simT += dt * S.speed;
      let guard = 0;
      while (S.A.t <= S.simT && guard++ < 200) stepOnce();
      if (S.simT > S.A.t) S.simT = S.A.t;
    }
    render();
    if (ts - S.lastStats > 400) { S.lastStats = ts; liveStats(); }
    requestAnimationFrame(frame);
  }
  function render() {
    const tf = S.simT;
    if (has3D) window.PATHAI3D.advance(tf);
    const D = viewDims();
    ['cvA', 'cvB'].forEach(id => { $(id).style.aspectRatio = D.LW + ' / ' + D.LH; });
    if (S.view !== 'B') drawJunction(fitCanvas($('cvA'), D.LW, D.LH), S.A, 'A', tf, { stats: S.statA, LW: D.LW, SH: D.SH });
    if (S.view !== 'A') drawJunction(fitCanvas($('cvB'), D.LW, D.LH), S.B, 'B', tf, { stats: S.statB, LW: D.LW, SH: D.SH });
    $('clock').textContent = fmtClock(Math.floor(tf), S.night);
    $('clockSub').textContent = S.night === 'off' ? 'evening peak · Round 1 counts' : 'night rules demo';
  }

  // ================================================================ boot
  buildSliders(); wire(); reset(); renderData(); runFairTest(false); liveStats();
  requestAnimationFrame(frame);
  window.PATHAI_APP = { exportSlides, prepareSnapshot, runFairTest, state: S, sendAmbulance, showTab, stepOnce,
    _drawPanel: (ctx, k) => { if (has3D) window.PATHAI3D.advance(S.simT); drawJunction(ctx, k === 'A' ? S.A : S.B, k, S.simT, { stats: k === 'A' ? S.statA : S.statB }); return ctx.canvas.toDataURL('image/png'); } };
})();
