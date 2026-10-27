/*
 * PATHAI 3D view — Surampatti Four Road Junction in Three.js.
 *
 * This file only DRAWS. The engine (engine.js) alone decides when each vehicle may cross the stop line;
 * the 3D vehicles follow those decisions with simple car-following physics (the Intelligent Driver Model):
 * they cruise at 40 km/h, brake for the vehicle ahead or for a red light, wait, and pull away when the
 * engine releases them. None of the numbers on the slides come from this file.
 *
 * Buildings, trees and street lights are decoration, not a survey of the real junction.
 * World units are metres: x = east, z = south, y = up. India drives on the LEFT.
 */
(function () {
  'use strict';
  const T = window.THREE, P = window.PATHAI;
  if (!T || !P) { window.PATHAI3D = { ready: false }; return; }
  const { ARMS, ORDER, CLASSES, M_PER_PCU } = P;

  // ---------------------------------------------------------------- layout
  const HALF = { EW: 7.5, NS: 5.5 };                                  // approach width = half the carriageway
  const STOP = { E: HALF.NS + 5, W: HALF.NS + 5, N: HALF.EW + 5, S: HALF.EW + 5 };   // stop line from centre
  const ROAD = { E: 260, W: 260, N: 200, S: 200 };                     // drawn length of each approach
  const DIR = { E: [-1, 0], W: [1, 0], N: [0, 1], S: [0, -1] };       // direction of travel
  const LANES = { E: [1.25, 3.75, 6.2], W: [1.25, 3.75, 6.2], N: [1.4, 4.1], S: [1.4, 4.1] };
  const V0 = 11.1, V0_AMB = 14;                                        // 40 km/h, ambulance 50 km/h
  const LEAD = {}; ORDER.forEach(a => { LEAD[a] = ROAD[a] / V0; });     // seconds from road end to stop line
  const LOOKAHEAD = Math.ceil(Math.max(...ORDER.map(a => LEAD[a]))) + 1;

  function pos(a, d, off) {          // point d m behind the stop line, off m left of the centre line
    const [dx, dz] = DIR[a];
    return [-dx * STOP[a] - dx * d + dz * off, -dz * STOP[a] - dz * d - dx * off];
  }
  const heading = a => Math.atan2(-DIR[a][1], DIR[a][0]);

  // Standing gap chosen per approach so a queue of vehicles occupies the same road length the engine uses
  // (1 PCU = 5.5 m of a 3.5 m lane). Computed from the Round 1 vehicle mix; nothing is tuned by hand.
  const S0 = {};
  ORDER.forEach(a => {
    const m = ARMS[a].mix10, n = ARMS[a].veh10;
    let pcu = 0, len = 0; for (const k in m) { pcu += m[k] * CLASSES[k].pcu; len += m[k] * CLASSES[k].len; }
    S0[a] = Math.max(1.2, M_PER_PCU[a] * pcu / n * LANES[a].length - len / n);
  });

  // ---------------------------------------------------------------- vehicle models (merged solids, vertex colours)
  // Each part is a small solid (box, extruded side profile, cylinder, sphere) baked into one geometry per
  // model; paint pieces are tinted per vehicle. Front = +x, up = +y, z = across the vehicle.
  const tmpColor = new T.Color();
  const Y_AXIS = new T.Vector3(0, 1, 0), tmpQ = new T.Quaternion(), tmpV = new T.Vector3();
  function piece(geo, color, x, y, z, ry, rz) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = tmpColor.set(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(arr, 3));
    return g;
  }
  const box = (w, h, d, color, x, y, z, ry, rz) => piece(new T.BoxGeometry(w, h, d), color, x, y, z, ry, rz);
  const ball = (r, color, x, y, z, sx, sy, sz) => { const g = new T.SphereGeometry(r, 12, 9); if (sx) g.scale(sx, sy, sz); return piece(g, color, x, y, z); };
  const cyl = (r, len, color, x, y, z, seg) => { const g = new T.CylinderGeometry(r, r, len, seg || 12); g.rotateX(Math.PI / 2); return piece(g, color, x, y, z); };  // axis along z
  // A rounded bar between two points (limbs, forks, pillars, frame tubes).
  function limb(x1, y1, z1, x2, y2, z2, r, color, r2) {
    const d = tmpV.set(x2 - x1, y2 - y1, z2 - z1), len = d.length();
    const g = new T.CylinderGeometry(r2 === undefined ? r : r2, r, len, 8);
    g.applyQuaternion(tmpQ.setFromUnitVectors(Y_AXIS, d.normalize()));
    return piece(g, color, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  }
  // Side profile [[x, y], ...] extruded across `width` (centred on z = 0), with a small rounded edge.
  function ext(profile, width, color, x, y, z, bevel) {
    const sh = new T.Shape(); profile.forEach(([px, py], i) => (i ? sh.lineTo(px, py) : sh.moveTo(px, py)));
    const b = bevel || 0;
    const g = new T.ExtrudeGeometry(sh, { depth: Math.max(0.01, width - 2 * b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 1, curveSegments: 1, steps: 1 });
    g.translate(0, 0, -(width - 2 * b) / 2);
    return piece(g, color, x, y, z);
  }
  // Wheel: dark tyre, silver hub on both faces, dark centre cap.
  function wheel(r, w, x, y, z) {
    const out = [cyl(r, w, '#15171c', x, y, z, 16)];
    [1, -1].forEach(s => { out.push(cyl(r * 0.6, w * 0.3, '#aeb6c2', x, y, z + s * w * 0.5, 14), cyl(r * 0.2, w * 0.4, '#2b2f38', x, y, z + s * w * 0.5, 8)); });
    return out;
  }
  const flat = a => [].concat(...a);
  function merge(list) {
    let n = 0; list.forEach(g => { n += g.attributes.position.count; });
    const p = new Float32Array(n * 3), nn = new Float32Array(n * 3), c = new Float32Array(n * 3);
    let o = 0;
    list.forEach(g => { p.set(g.attributes.position.array, o); nn.set(g.attributes.normal.array, o); c.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; });
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(p, 3));
    out.setAttribute('normal', new T.BufferAttribute(nn, 3));
    out.setAttribute('color', new T.BufferAttribute(c, 3));
    out.computeBoundingSphere();
    return out;
  }
  const W_ = '#ffffff', GLASS = '#1c2733', DARK = '#23262d', SKIN = '#c08a5b', TYRE = '#15171c', STEEL = '#9ca3af', BLACK = '#111318';
  // Each model: paint (tinted per vehicle), fixed (own colours), brake + head lamps, optional beacon.
  function buildModels() {
    const M = {};

    // ---- motorcycle with rider (about 2 m long)
    M.tw = {
      paint: [limb(-0.30, 0.9, 0, -0.1, 1.42, 0, 0.17, W_, 0.2),                       // shirt: torso leaning to the bars
        ball(0.2, W_, -0.1, 1.38, 0, 1, 0.8, 1.3)],                                      // shoulders
      fixed: flat([wheel(0.3, 0.11, 0.66, 0.3, 0), wheel(0.3, 0.11, -0.66, 0.3, 0)]).concat([
        box(0.45, 0.27, 0.3, '#3f4651', 0.05, 0.5, 0), box(0.2, 0.22, 0.24, '#2b303a', 0.22, 0.62, 0),                   // engine block
        ball(0.2, '#2f3640', 0.18, 0.88, 0, 1.45, 0.75, 0.85), box(0.5, 0.06, 0.3, '#1c2027', -0.28, 0.76, 0),           // tank, seat
        box(0.55, 0.1, 0.34, '#2a2f38', -0.62, 0.74, 0, 0, 0.18), box(0.34, 0.025, 0.14, '#252a33', 0.68, 0.64, 0),       // rear cowl, front mudguard
        limb(0.66, 0.3, 0.07, 0.5, 0.98, 0.07, 0.022, STEEL), limb(0.66, 0.3, -0.07, 0.5, 0.98, -0.07, 0.022, STEEL),    // forks
        limb(0.5, 1.0, 0.33, 0.5, 1.0, -0.33, 0.02, BLACK), cyl(0.032, 0.12, BLACK, 0.5, 1.0, 0.3), cyl(0.032, 0.12, BLACK, 0.5, 1.0, -0.3),
        ball(0.12, '#d5dae1', 0.6, 0.96, 0, 0.8, 1, 1.05), box(0.06, 0.1, 0.1, BLACK, 0.48, 1.12, 0),                    // lamp housing, cluster
        limb(0.5, 1.0, 0.33, 0.44, 1.12, 0.36, 0.014, BLACK), limb(0.5, 1.0, -0.33, 0.44, 1.12, -0.36, 0.014, BLACK),      // mirror stalks
        box(0.07, 0.05, 0.09, BLACK, 0.44, 1.14, 0.37), box(0.07, 0.05, 0.09, BLACK, 0.44, 1.14, -0.37),
        limb(0.12, 0.3, 0.18, -0.78, 0.36, 0.18, 0.05, '#b8bec8'), box(0.07, 0.05, 0.05, '#52575f', -0.84, 0.37, 0.18),    // exhaust
        limb(0.66, 0.3, 0, 0.0, 0.5, 0, 0.03, '#2b303a'), limb(-0.66, 0.3, 0, 0.0, 0.46, 0, 0.03, '#2b303a'),             // frame tubes
        box(0.2, 0.07, 0.34, '#252a33', 0.18, 0.2, 0),
        // rider: trousers, shoes, arms, head, helmet
        limb(-0.3, 0.88, 0.14, 0.14, 0.72, 0.2, 0.095, '#27303f'), limb(-0.3, 0.88, -0.14, 0.14, 0.72, -0.2, 0.095, '#27303f'),
        limb(0.14, 0.72, 0.2, 0.06, 0.3, 0.22, 0.075, '#27303f'), limb(0.14, 0.72, -0.2, 0.06, 0.3, -0.22, 0.075, '#27303f'),
        box(0.26, 0.07, 0.1, '#16181d', 0.12, 0.27, 0.22), box(0.26, 0.07, 0.1, '#16181d', 0.12, 0.27, -0.22),
        limb(-0.1, 1.38, 0.21, 0.5, 1.0, 0.3, 0.055, SKIN, 0.045), limb(-0.1, 1.38, -0.21, 0.5, 1.0, -0.3, 0.055, SKIN, 0.045),
        ball(0.115, SKIN, 0.0, 1.64, 0), ball(0.14, '#1f2937', -0.02, 1.7, 0, 1.1, 0.8, 1.0), box(0.06, 0.07, 0.2, '#0b0e14', 0.1, 1.66, 0)]),
      brake: [box(0.05, 0.08, 0.16, W_, -0.92, 0.72, 0)], head: [box(0.05, 0.1, 0.12, W_, 0.71, 0.96, 0)] };

    // ---- hatchback / sedan (4.2 m)
    M.car = {
      paint: [ext([[-2.08, 0.32], [2.06, 0.32], [2.1, 0.6], [1.9, 0.82], [1.0, 0.92], [-1.5, 0.95], [-2.04, 0.88], [-2.1, 0.62]], 1.7, W_, 0, 0, 0, 0.06),   // body tub + bonnet + boot
        ext([[-1.06, 1.4], [0.52, 1.4], [0.5, 1.47], [-1.03, 1.47]], 1.5, W_, 0, 0, 0, 0.02),                                                            // roof
        box(0.1, 0.5, 1.52, W_, -0.25, 1.16, 0),                                                                                                          // B pillar
        limb(0.5, 1.45, 0.76, 1.0, 0.9, 0.76, 0.045, W_), limb(0.5, 1.45, -0.76, 1.0, 0.9, -0.76, 0.045, W_),                                           // A pillars
        limb(-1.05, 1.45, 0.76, -1.45, 0.9, 0.76, 0.05, W_), limb(-1.05, 1.45, -0.76, -1.45, 0.9, -0.76, 0.05, W_)],                                    // C pillars
      fixed: flat([wheel(0.33, 0.24, 1.3, 0.33, 0.76), wheel(0.33, 0.24, 1.3, 0.33, -0.76), wheel(0.33, 0.24, -1.3, 0.33, 0.76), wheel(0.33, 0.24, -1.3, 0.33, -0.76)]).concat([
        ext([[-1.46, 0.9], [-1.0, 1.42], [0.5, 1.42], [1.0, 0.9]], 1.54, GLASS, 0, 0, 0, 0),                                                              // glasshouse
        box(0.14, 0.2, 1.66, '#20242b', 2.1, 0.42, 0), box(0.14, 0.2, 1.66, '#20242b', -2.1, 0.42, 0),                                                    // bumpers
        box(0.04, 0.13, 0.85, BLACK, 2.12, 0.64, 0), box(0.03, 0.1, 0.36, '#f1f5f9', 2.19, 0.42, 0), box(0.03, 0.1, 0.36, '#fde047', -2.17, 0.42, 0),  // grille, plates
        box(1.9, 0.06, 1.68, '#14161b', 0, 0.3, 0),                                                                                                       // sill
        box(0.16, 0.09, 0.1, BLACK, 1.0, 1.0, 0.93), box(0.16, 0.09, 0.1, BLACK, 1.0, 1.0, -0.93),                                                       // mirrors
        box(0.5, 0.02, 0.02, '#2c313a', -0.25, 0.9, 0.86), box(0.5, 0.02, 0.02, '#2c313a', -0.25, 0.9, -0.86),
        box(0.12, 0.03, 0.06, '#aab1bd', -0.55, 0.86, 0.865), box(0.12, 0.03, 0.06, '#aab1bd', 0.35, 0.86, 0.865), box(0.12, 0.03, 0.06, '#aab1bd', -0.55, 0.86, -0.865), box(0.12, 0.03, 0.06, '#aab1bd', 0.35, 0.86, -0.865)]),
      brake: [box(0.05, 0.14, 0.34, W_, -2.14, 0.74, 0.6), box(0.05, 0.14, 0.34, W_, -2.14, 0.74, -0.6)],
      head: [box(0.05, 0.13, 0.32, W_, 2.13, 0.74, 0.58), box(0.05, 0.13, 0.32, W_, 2.13, 0.74, -0.58)] };

    // ---- auto-rickshaw (2.8 m): yellow body, dark canopy, driver and two passengers
    M.auto = {
      paint: [ext([[0.3, 0.32], [1.0, 0.32], [1.38, 0.46], [1.42, 0.82], [1.12, 1.2], [0.62, 1.3], [0.3, 1.0]], 1.0, W_, 0, 0, 0, 0.07),               // nose cowl
        ext([[-1.35, 0.32], [0.45, 0.32], [0.45, 0.66], [-1.35, 0.7]], 1.36, W_, 0, 0, 0, 0.05),                                                        // passenger tub
        box(0.62, 0.05, 0.3, W_, 1.1, 0.58, 0), box(0.58, 0.07, 0.2, W_, -0.92, 0.55, 0.64), box(0.58, 0.07, 0.2, W_, -0.92, 0.55, -0.64),            // mudguards
        ext([[-1.38, 1.68], [0.66, 1.72], [0.74, 1.8], [-1.38, 1.82]], 1.42, W_, 0, 0, 0, 0.02)],                                                       // roof skin
      fixed: flat([wheel(0.26, 0.15, 1.12, 0.26, 0), wheel(0.26, 0.17, -0.92, 0.26, 0.64), wheel(0.26, 0.17, -0.92, 0.26, -0.64)]).concat([
        ext([[-1.4, 1.8], [0.7, 1.84], [0.78, 1.9], [-1.4, 1.9]], 1.4, '#171b22', 0, 0, 0, 0.02),                                                       // dark canopy
        ext([[0.6, 1.8], [0.68, 1.8], [1.06, 1.2], [0.98, 1.18]], 1.0, GLASS, 0, 0, 0, 0),                                                              // windscreen
        limb(0.62, 1.8, 0.5, 1.0, 1.2, 0.5, 0.03, '#171b22'), limb(0.62, 1.8, -0.5, 1.0, 1.2, -0.5, 0.03, '#171b22'),
        limb(-1.3, 1.78, 0.66, -1.3, 0.7, 0.66, 0.03, '#171b22'), limb(-1.3, 1.78, -0.66, -1.3, 0.7, -0.66, 0.03, '#171b22'),
        limb(0.2, 1.78, 0.68, 0.2, 0.7, 0.68, 0.025, '#171b22'), limb(0.2, 1.78, -0.68, 0.2, 0.7, -0.68, 0.025, '#171b22'),
        box(0.5, 0.24, 1.2, '#1e293b', -0.7, 0.82, 0), box(0.1, 0.55, 1.2, '#1e293b', -1.22, 1.08, 0),                                                // passenger bench + back
        box(0.42, 0.08, 0.5, '#111827', 0.0, 0.76, 0),                                                                                                  // driver seat
        limb(-0.05, 0.84, 0, 0.0, 1.3, 0, 0.14, '#9a8f7d', 0.17), ball(0.1, SKIN, 0.03, 1.46, 0), ball(0.11, '#171717', 0.01, 1.5, 0, 1, 0.7, 1),       // driver
        limb(0.0, 1.28, 0.16, 0.74, 0.98, 0.34, 0.045, SKIN, 0.04), limb(0.0, 1.28, -0.16, 0.74, 0.98, -0.34, 0.045, SKIN, 0.04),
        limb(0.78, 0.98, 0.36, 0.78, 0.98, -0.36, 0.022, BLACK),
        limb(-0.1, 0.8, 0.14, 0.4, 0.72, 0.14, 0.07, '#27303f'), limb(-0.1, 0.8, -0.14, 0.4, 0.72, -0.14, 0.07, '#27303f'),
        limb(1.12, 0.26, 0.0, 1.0, 0.95, 0.0, 0.025, STEEL),                                                                                            // fork
        limb(-0.88, 0.78, 0.3, -0.88, 1.2, 0.3, 0.13, '#6d5f8c', 0.15), ball(0.095, SKIN, -0.88, 1.34, 0.3), ball(0.1, '#171717', -0.89, 1.37, 0.3, 1, 0.65, 1),   // passengers
        limb(-0.88, 0.78, -0.3, -0.88, 1.2, -0.3, 0.13, '#b55a5a', 0.15), ball(0.095, SKIN, -0.88, 1.34, -0.3), ball(0.1, '#171717', -0.89, 1.37, -0.3, 1, 0.65, 1),
        box(0.1, 0.12, 1.2, '#20242b', -1.4, 0.4, 0), box(0.04, 0.13, 0.3, '#fde047', -1.4, 0.55, 0),                                                    // rear bumper + plate
        box(0.08, 0.06, 0.08, BLACK, 0.7, 1.28, 0.55), box(0.08, 0.06, 0.08, BLACK, 0.7, 1.28, -0.55)]),                                                // mirrors
      brake: [box(0.05, 0.12, 0.2, W_, -1.38, 0.62, 0.52), box(0.05, 0.12, 0.2, W_, -1.38, 0.62, -0.52)],
      head: [box(0.05, 0.16, 0.22, W_, 1.43, 0.78, 0)] };

    // ---- light commercial pickup (5 m)
    M.lcv = {
      paint: [ext([[0.9, 0.5], [2.46, 0.5], [2.52, 0.86], [2.3, 1.1], [1.82, 1.78], [0.9, 1.8]], 1.78, W_, 0, 0, 0, 0.06),
        box(0.1, 0.55, 1.8, W_, 1.15, 1.45, 0)],
      fixed: flat([wheel(0.37, 0.26, 1.75, 0.37, 0.82), wheel(0.37, 0.26, 1.75, 0.37, -0.82), wheel(0.37, 0.26, -1.4, 0.37, 0.82), wheel(0.37, 0.26, -1.4, 0.37, -0.82)]).concat([
        ext([[2.26, 1.12], [1.86, 1.72], [1.96, 1.72], [2.34, 1.12]], 1.62, GLASS, 0, 0, 0, 0), box(0.8, 0.5, 1.82, GLASS, 1.5, 1.45, 0),               // windscreen + side glass
        box(3.5, 0.12, 1.9, '#475569', -0.75, 0.62, 0), box(3.5, 0.62, 0.08, '#6b7280', -0.75, 1.0, 0.91), box(3.5, 0.62, 0.08, '#6b7280', -0.75, 1.0, -0.91),
        box(0.08, 0.62, 1.9, '#6b7280', -2.5, 1.0, 0), box(0.08, 0.62, 1.9, '#6b7280', 0.98, 1.0, 0), box(3.4, 0.05, 1.7, '#8b6b45', -0.75, 0.7, 0),   // cargo bed
        box(0.14, 0.22, 1.8, '#20242b', 2.54, 0.5, 0), box(0.04, 0.16, 0.8, BLACK, 2.54, 0.8, 0),
        box(0.16, 0.1, 0.1, BLACK, 2.0, 1.55, 1.0), box(0.16, 0.1, 0.1, BLACK, 2.0, 1.55, -1.0)]),
      brake: [box(0.05, 0.14, 0.3, W_, -2.54, 0.72, 0.7), box(0.05, 0.14, 0.3, W_, -2.54, 0.72, -0.7)],
      head: [box(0.05, 0.14, 0.3, W_, 2.54, 0.85, 0.65), box(0.05, 0.14, 0.3, W_, 2.54, 0.85, -0.65)] };

    // ---- bus (10.5 m)
    const busPillars = []; for (let i = -4; i <= 4; i++) busPillars.push(box(0.12, 0.95, 2.5, W_, i * 1.1 - 0.2, 2.3, 0));
    M.bus = {
      paint: [box(10.5, 1.55, 2.45, W_, 0, 1.25, 0), box(10.5, 0.35, 2.45, W_, 0, 2.95, 0), box(10.5, 0.08, 2.5, '#e5e7eb', 0, 1.9, 0)].concat(busPillars),
      fixed: flat([wheel(0.5, 0.3, 3.4, 0.5, 1.08), wheel(0.5, 0.3, 3.4, 0.5, -1.08), wheel(0.5, 0.3, -3.2, 0.5, 1.08), wheel(0.5, 0.3, -3.2, 0.5, -1.08)]).concat([
        box(9.8, 0.95, 2.4, GLASS, -0.2, 2.3, 0), box(0.06, 1.1, 2.1, GLASS, 5.26, 2.15, 0), box(10.3, 0.12, 2.3, '#cbd5e1', 0, 3.18, 0),
        box(0.12, 0.3, 2.0, '#20242b', 5.28, 0.6, 0), box(0.05, 0.28, 1.6, '#fbbf24', 5.27, 2.95, 0), box(0.05, 0.3, 0.9, BLACK, 5.27, 1.0, 0),
        box(0.2, 0.4, 0.1, BLACK, 4.8, 2.3, 1.32), box(0.2, 0.4, 0.1, BLACK, 4.8, 2.3, -1.32), box(0.8, 0.5, 0.06, '#475569', -5.3, 1.3, 0)]),
      brake: [box(0.05, 0.22, 0.4, W_, -5.26, 0.95, 1.0), box(0.05, 0.22, 0.4, W_, -5.26, 0.95, -1.0)],
      head: [box(0.05, 0.2, 0.4, W_, 5.28, 0.85, 0.95), box(0.05, 0.2, 0.4, W_, 5.28, 0.85, -0.95)] };

    // ---- truck (10.5 m)
    const ribs = []; for (let i = -3; i <= 3; i++) ribs.push(box(0.1, 0.1, 2.55, '#5b3a0a', i * 1.05 - 1.15, 3.24, 0));
    M.truck = {
      paint: [ext([[3.2, 0.9], [5.2, 0.9], [5.24, 2.0], [4.95, 2.45], [4.3, 3.05], [3.2, 3.05]], 2.45, W_, 0, 0, 0, 0.06)],
      fixed: flat([wheel(0.5, 0.3, 4.0, 0.5, 1.08), wheel(0.5, 0.3, 4.0, 0.5, -1.08), wheel(0.5, 0.3, -2.4, 0.5, 1.08), wheel(0.5, 0.3, -2.4, 0.5, -1.08),
        wheel(0.5, 0.3, -3.6, 0.5, 1.08), wheel(0.5, 0.3, -3.6, 0.5, -1.08)]).concat(ribs).concat([
        ext([[5.1, 2.0], [4.4, 2.95], [4.7, 2.95], [5.2, 2.15]], 2.1, GLASS, 0, 0, 0, 0), box(0.9, 0.5, 2.48, GLASS, 4.0, 2.55, 0),
        box(8.0, 2.3, 2.45, '#a16207', -1.15, 2.0, 0), box(8.0, 0.15, 2.5, '#713f12', -1.15, 3.2, 0), box(10.2, 0.3, 1.6, '#1f2937', 0, 0.75, 0),
        box(0.14, 0.3, 2.3, '#20242b', 5.28, 0.78, 0), box(0.05, 0.4, 1.3, BLACK, 5.27, 1.5, 0),
        limb(3.3, 0.9, 1.3, 3.3, 3.5, 1.3, 0.07, STEEL), box(0.16, 0.5, 0.1, BLACK, 4.7, 2.5, 1.4), box(0.16, 0.5, 0.1, BLACK, 4.7, 2.5, -1.4)]),
      brake: [box(0.05, 0.22, 0.4, W_, -5.16, 0.95, 1.0), box(0.05, 0.22, 0.4, W_, -5.16, 0.95, -1.0)],
      head: [box(0.05, 0.2, 0.4, W_, 5.26, 0.9, 0.95), box(0.05, 0.2, 0.4, W_, 5.26, 0.9, -0.95)] };

    // ---- ambulance (5 m)
    M.amb = {
      paint: [ext([[-2.5, 0.5], [2.5, 0.5], [2.54, 0.9], [2.3, 1.15], [1.8, 2.0], [-2.5, 2.1]], 1.95, W_, 0, 0, 0, 0.06)],
      fixed: flat([wheel(0.37, 0.26, 1.7, 0.37, 0.86), wheel(0.37, 0.26, 1.7, 0.37, -0.86), wheel(0.37, 0.26, -1.6, 0.37, 0.86), wheel(0.37, 0.26, -1.6, 0.37, -0.86)]).concat([
        ext([[2.26, 1.2], [1.86, 1.9], [1.96, 1.9], [2.34, 1.2]], 1.7, GLASS, 0, 0, 0, 0), box(1.0, 0.55, 1.98, GLASS, 1.45, 1.6, 0),
        box(5.02, 0.22, 1.99, '#dc2626', 0, 1.05, 0), box(0.5, 0.14, 1.99, '#dc2626', -0.8, 1.75, 0), box(0.14, 0.5, 1.99, '#dc2626', -0.8, 1.75, 0),
        box(0.14, 0.22, 1.9, '#20242b', 2.55, 0.5, 0), box(0.14, 0.22, 1.9, '#20242b', -2.55, 0.5, 0), box(0.04, 0.16, 0.8, BLACK, 2.55, 0.85, 0),
        box(0.16, 0.1, 0.1, BLACK, 1.9, 1.5, 1.05), box(0.16, 0.1, 0.1, BLACK, 1.9, 1.5, -1.05)]),
      brake: [box(0.05, 0.16, 0.3, W_, -2.53, 0.8, 0.7), box(0.05, 0.16, 0.3, W_, -2.53, 0.8, -0.7)],
      head: [box(0.05, 0.14, 0.3, W_, 2.57, 0.8, 0.65), box(0.05, 0.14, 0.3, W_, 2.57, 0.8, -0.65)],
      beacon: [box(0.3, 0.16, 0.55, '#ff2020', 1.2, 2.17, 0.42), box(0.3, 0.16, 0.55, '#2a6bff', 1.2, 2.17, -0.42)] };

    const out = {};
    for (const k in M) { out[k] = {}; for (const part in M[k]) out[k][part] = merge(M[k][part]); }
    return out;
  }
  const LEN = { tw: 2.0, car: 4.2, auto: 2.8, lcv: 5.0, bus: 10.5, truck: 10.5, amb: 5.0 };
  const IDM = {    // max accel a, comfortable brake b, time headway T
    tw: { a: 2.2, b: 3.0, T: 0.6 }, car: { a: 1.8, b: 3.0, T: 0.9 }, auto: { a: 1.4, b: 2.6, T: 0.9 },
    lcv: { a: 1.4, b: 2.6, T: 1.0 }, bus: { a: 1.0, b: 2.2, T: 1.2 }, truck: { a: 0.9, b: 2.2, T: 1.2 }, amb: { a: 2.4, b: 3.5, T: 0.7 } };
  const CAP = { tw: 900, car: 260, auto: 200, lcv: 110, bus: 70, truck: 70, amb: 6 };
  const PALETTE = {
    tw: ['#ef4444', '#3b82f6', '#f8fafc', '#22c55e', '#f59e0b', '#a855f7', '#0ea5e9', '#f472b6', '#64748b', '#fde047'],
    car: ['#f1f5f9', '#f1f5f9', '#f1f5f9', '#e2e8f0', '#9ca3af', '#9ca3af', '#4b5563', '#b91c1c', '#1d4ed8', '#111827', '#7c2d12'],
    auto: ['#facc15', '#facc15', '#facc15', '#eab308', '#16a34a'],
    lcv: ['#f8fafc', '#2563eb', '#16a34a', '#f8fafc', '#facc15'],
    bus: ['#1d4ed8', '#b91c1c', '#0f766e', '#ea580c', '#7c3aed'],
    truck: ['#ea580c', '#1e40af', '#b91c1c', '#ca8a04', '#15803d'],
    amb: ['#f8fafc'] };

  // ---------------------------------------------------------------- scene
  let renderer, scene, camera, sun, hemi, ready = false;
  let models, staticLamps, poolMesh, skyTex;
  const VJ = {};            // per-junction visual state: { group, meshes, lanes, amb, ... }
  const SIGNAL_POS = {};    // arm -> world position of the signal head (for the countdown overlay)

  const seeded = s => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  function noiseTexture(base, spread, size, rep) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    const r = seeded(size * 13 + spread);
    for (let i = 0; i < size * size / 6; i++) {
      const v = (r() - 0.5) * spread; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
    }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function radialTexture(inner, outer) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function skyTexture(top, mid, bottom) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  function plane(w, d, mat, x, y, z) {
    const m = new T.Mesh(new T.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; return m;
  }

  function buildStatic() {
    const R = seeded(2024);
    const ground = new T.MeshStandardMaterial({ map: noiseTexture('#7d8a52', 0.22, 256, [90, 90]), roughness: 1 });
    scene.add(plane(1400, 1400, ground, 0, -0.02, 0));
    const asphalt = new T.MeshStandardMaterial({ map: noiseTexture('#3a3d44', 0.18, 256, [60, 2]), roughness: 0.95 });
    const asphaltNS = new T.MeshStandardMaterial({ map: noiseTexture('#3a3d44', 0.18, 256, [2, 40]), roughness: 0.95 });
    const EWL = 640, NSL = 520;
    scene.add(plane(EWL * 2, HALF.EW * 2 + 1, asphalt, 0, 0, 0));
    const nsLen = NSL - HALF.EW;
    scene.add(plane(HALF.NS * 2 + 1, nsLen, asphaltNS, 0, 0.001, -(HALF.EW + 0.5 + nsLen / 2) + 0.5));
    scene.add(plane(HALF.NS * 2 + 1, nsLen, asphaltNS, 0, 0.001, (HALF.EW + 0.5 + nsLen / 2) - 0.5));

    // footpaths, kerbs, markings, buildings, trees, lamps: merged into a few meshes
    const walk = [], marks = [], yellow = [], decor = [], kerb = [];
    const FP = 3.0, ky = 0.09;
    const ewEdge = HALF.EW + 0.5, nsEdge = HALF.NS + 0.5;
    // E-W footpaths (north & south side), split at the side roads
    [[-EWL, -nsEdge - FP], [nsEdge + FP, EWL]].forEach(([x0, x1]) => [1, -1].forEach(sg => {
      walk.push(box(x1 - x0, 0.18, FP, '#a8a29e', (x0 + x1) / 2, ky, sg * (ewEdge + FP / 2)));
    }));
    [[-NSL, -ewEdge - FP], [ewEdge + FP, NSL]].forEach(([z0, z1]) => [1, -1].forEach(sg => {
      walk.push(box(FP, 0.18, z1 - z0, '#a8a29e', sg * (nsEdge + FP / 2), ky, (z0 + z1) / 2));
    }));
    // corner plazas
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => walk.push(box(FP, 0.18, FP, '#a8a29e', sx * (nsEdge + FP / 2), ky, sz * (ewEdge + FP / 2))));
    // black-and-yellow kerb stones for 40 m around the junction
    for (let k = 0; k < 40; k++) {
      const col = k % 2 ? '#111827' : '#facc15', off = nsEdge + FP + k + 0.5;
      [1, -1].forEach(sx => [1, -1].forEach(sz => {
        kerb.push(box(1, 0.22, 0.25, col, sx * off, 0.11, sz * (ewEdge + 0.05)));
        kerb.push(box(0.25, 0.22, 1, col, sx * (nsEdge + 0.05), 0.11, sz * (ewEdge + FP + k + 0.5)));
      }));
    }
    // centre lines (double yellow) from each stop line outward
    ORDER.forEach(a => {
      const L = ROAD[a] + 120, s0 = STOP[a];
      const along = a === 'E' || a === 'W';
      const sg = a === 'E' || a === 'S' ? 1 : -1;
      [-0.18, 0.18].forEach(o => {
        if (along) yellow.push(box(L, 0.012, 0.12, '#eab308', sg * (s0 + L / 2), 0.012, o));
        else yellow.push(box(0.12, 0.012, L, '#eab308', o, 0.012, sg * (s0 + L / 2)));
      });
      // lane dashes on both halves of the arm
      const offs = along ? [2.5, 5.0] : [2.75];
      offs.forEach(o => [1, -1].forEach(side => {
        for (let d = 2; d < L; d += 9) {
          if (along) marks.push(box(3, 0.012, 0.12, '#e5e7eb', sg * (s0 + d + 1.5), 0.012, side * o));
          else marks.push(box(0.12, 0.012, 3, '#e5e7eb', side * o, 0.012, sg * (s0 + d + 1.5)));
        }
      }));
      // stop line across the inbound half, and the zebra crossing between stop line and junction box
      const half = along ? HALF.EW : HALF.NS;
      const [sx, sz] = pos(a, 0, half / 2);
      if (along) marks.push(box(0.4, 0.014, half, '#f8fafc', sx, 0.013, sz));
      else marks.push(box(half, 0.014, 0.4, '#f8fafc', sx, 0.013, sz));
      for (let o = -half + 0.5; o < half - 0.3; o += 1.1) {
        const [zx, zz] = pos(a, -2.5, o);
        if (along) marks.push(box(3.6, 0.014, 0.55, '#f1f5f9', zx, 0.013, zz));
        else marks.push(box(0.55, 0.014, 3.6, '#f1f5f9', zx, 0.013, zz));
      }
    });
    // buildings along all four roads (decorative)
    const BCOL = ['#e7d7b8', '#cfe3dc', '#f1c9a5', '#bccbe6', '#e9b9bc', '#d6d3d1', '#f6e3a1', '#c7d2a6', '#e2c6e6', '#f3f0e8'];
    const SIGN = ['#dc2626', '#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04'];
    const street = (along, sg, side) => {
      let d = (along ? 16 : 34) + R() * 4;
      const max = along ? EWL - 40 : NSL - 40;
      const edge = (along ? ewEdge : nsEdge) + FP;
      while (d < max) {
        const w = 7 + R() * 12, depth = 9 + R() * 8, nf = 1 + Math.floor(R() * R() * 3), FH = 3.2;
        const h = 3.6 + (nf - 1) * FH + R() * 0.6, set = 1.5 + R() * 3;
        const c = BCOL[Math.floor(R() * BCOL.length)];
        const mid = sg * (d + w / 2), v0 = edge + set;
        // local frame: u runs along the street, v runs from the building front away from the road
        const B = (sw, sh, sd, color, u, y, v) => along
          ? box(sw, sh, sd, color, mid + u, y, side * (v0 + v))
          : box(sd, sh, sw, color, side * (v0 + v), y, mid + u);
        const bw = w - 0.6, accent = SIGN[Math.floor(R() * SIGN.length)];
        decor.push(B(bw, h, depth, c, 0, h / 2, depth / 2));
        decor.push(B(bw + 0.5, 0.35, depth + 0.4, '#f5f5f4', 0, h + 0.17, depth / 2));                      // cornice / roof slab
        decor.push(B(bw + 0.2, 0.5, 0.25, c, 0, h + 0.6, 0.15), B(bw + 0.2, 0.5, 0.25, c, 0, h + 0.6, depth - 0.15),    // parapet
          B(0.25, 0.5, depth, c, -bw / 2 + 0.1, h + 0.6, depth / 2), B(0.25, 0.5, depth, c, bw / 2 - 0.1, h + 0.6, depth / 2));
        decor.push(B(bw + 0.1, 0.18, 0.12, '#78716c', 0, 3.15, -0.05));                                         // plinth line above the shopfront
        // shopfront: shutters / glass, a proper door, a sign board and an awning
        const doorU = (R() - 0.5) * (bw - 4);
        decor.push(B(bw - 1.0, 2.5, 0.14, '#3b4658', 0, 1.35, -0.06));
        for (let u = -bw / 2 + 1.2; u < bw / 2 - 1.2; u += 1.2) decor.push(B(0.05, 2.5, 0.05, '#4b5563', u, 1.35, -0.14));  // shutter ribs
        decor.push(B(1.3, 2.35, 0.2, '#f1f5f9', doorU, 1.28, -0.1), B(1.05, 2.2, 0.22, '#7c4a2d', doorU, 1.22, -0.12), B(0.1, 0.1, 0.1, '#facc15', doorU + 0.35, 1.2, -0.25));
        decor.push(B(bw - 0.8, 0.8, 0.18, accent, 0, 3.0 + 0.0, -0.2), B(bw - 1.3, 0.18, 0.2, '#f8fafc', 0, 3.0, -0.31));   // sign board + lettering strip
        const awn = SIGN[Math.floor(R() * SIGN.length)];
        for (let i = 0; i < 6; i++) decor.push(B((bw - 1.0) / 6, 0.1, 0.9, i % 2 ? '#f8fafc' : awn, -bw / 2 + 0.5 + (i + 0.5) * (bw - 1.0) / 6, 2.75, -0.5));
        // upper floors: window grid with frames and sills, balconies on some
        const cols = Math.max(2, Math.floor((bw - 1.2) / 2.3)), pitch = (bw - 1.2) / cols;
        for (let f = 1; f < nf; f++) {
          const yc = 3.6 + (f - 1) * FH + FH / 2 - 0.1;
          decor.push(B(bw + 0.1, 0.16, 0.14, '#d6d3d1', 0, 3.6 + (f - 1) * FH + 0.05, -0.04));                    // floor band
          const balc = R() < 0.35;
          for (let i = 0; i < cols; i++) {
            const u = -bw / 2 + 0.6 + (i + 0.5) * pitch;
            decor.push(B(1.15, 1.5, 0.1, '#f1f5f9', u, yc, -0.04), B(0.95, 1.3, 0.12, R() < 0.12 ? '#fde68a' : '#2f4c66', u, yc, -0.07),
              B(0.04, 1.3, 0.14, '#f1f5f9', u, yc, -0.09), B(1.3, 0.1, 0.28, '#e7e5e4', u, yc - 0.8, -0.14));
          }
          if (balc) {
            decor.push(B(bw - 1.4, 0.14, 1.1, '#cbd5e1', 0, yc - 0.95, -0.55));
            for (let u = -bw / 2 + 0.9; u < bw / 2 - 0.8; u += 0.5) decor.push(B(0.04, 0.8, 0.04, '#374151', u, yc - 0.5, -1.05));
            decor.push(B(bw - 1.4, 0.05, 0.06, '#374151', 0, yc - 0.1, -1.05));
          }
        }
        if (nf === 1) { for (let i = 0; i < cols; i++) { const u = -bw / 2 + 0.6 + (i + 0.5) * pitch; decor.push(B(0.9, 0.45, 0.1, '#2f4c66', u, 3.62 + 0.0, -0.04)); } }
        // side walls (seen where there is a gap or at the corners): windows on every floor
        for (let f = 0; f < nf; f++) {
          const ys = (f ? 3.6 + (f - 1) * FH + FH / 2 - 0.1 : 1.9);
          for (let v = 2.0; v < depth - 1.2; v += 2.7) [-1, 1].forEach(sd => decor.push(
            B(0.1, 1.5, 1.15, '#f1f5f9', sd * (bw / 2 + 0.02), ys, v), B(0.12, 1.3, 0.95, '#2f4c66', sd * (bw / 2 + 0.05), ys, v)));
        }
        // roof: stair head, water tank on legs, aerial
        const ru = (R() - 0.5) * (bw - 4), rv = depth * (0.3 + R() * 0.4);
        decor.push(B(2.2, 2.2, 2.2, '#d6d3d1', ru, h + 1.1, rv), B(0.9, 1.6, 0.1, '#7c4a2d', ru, h + 0.8, rv - 1.12));
        if (R() < 0.7) {
          const tu = (R() - 0.5) * (bw - 3), tv = depth * (0.55 + R() * 0.3), tx = along ? mid + tu : side * (v0 + tv), tz = along ? side * (v0 + tv) : mid + tu;
          decor.push(piece(new T.CylinderGeometry(0.75, 0.75, 1.3, 12), '#111827', tx, h + 1.35, tz));
          [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(([a, b]) => decor.push(box(0.08, 0.7, 0.08, '#6b7280', tx + a, h + 0.35, tz + b)));
        }
        d += w + (R() < 0.18 ? 6 + R() * 10 : 0.2);
      }
    };
    [[true, 1], [true, -1], [false, 1], [false, -1]].forEach(([along, sg]) => [1, -1].forEach(side => street(along, sg, side)));
    // trees on the footpaths
    const tree = (x, z, s) => {
      decor.push(piece(new T.CylinderGeometry(0.18 * s, 0.25 * s, 2.6 * s, 6), '#5b4636', x, 1.3 * s, z));
      decor.push(piece(new T.IcosahedronGeometry(2.2 * s, 0), R() < 0.5 ? '#3f7a3a' : '#4f8a3c', x, 3.6 * s, z));
      decor.push(piece(new T.IcosahedronGeometry(1.5 * s, 0), '#5b9a45', x + 0.8 * s, 4.4 * s, z - 0.4 * s));
    };
    const lampHeads = [];
    const lamp = (x, z, ox, oz) => {
      decor.push(piece(new T.CylinderGeometry(0.09, 0.13, 8, 6), '#6b7280', x, 4, z));
      decor.push(box(Math.abs(ox) ? 1.6 : 0.12, 0.1, Math.abs(oz) ? 1.6 : 0.12, '#6b7280', x + ox * 0.8, 8, z + oz * 0.8));
      lampHeads.push(box(Math.abs(ox) ? 0.7 : 0.35, 0.12, Math.abs(oz) ? 0.7 : 0.35, '#ffffff', x + ox * 1.5, 7.92, z + oz * 1.5));
      return [x + ox * 1.5, z + oz * 1.5];
    };
    const pools = [];
    for (let d = 22; d < 300; d += 34) {
      [1, -1].forEach(sg => {
        const tx = sg * (d + 6), tz1 = ewEdge + 1.6;
        tree(tx, tz1, 0.9 + R() * 0.4); tree(sg * (d + 17), -tz1, 0.9 + R() * 0.4);
        pools.push(lamp(sg * d, ewEdge + 0.6, 0, -1)); pools.push(lamp(sg * (d + 17), -(ewEdge + 0.6), 0, 1));
        if (d < 230) {
          tree(nsEdge + 1.6, sg * (d + 8), 0.9 + R() * 0.4); tree(-(nsEdge + 1.6), sg * (d + 20), 0.9 + R() * 0.4);
          pools.push(lamp(nsEdge + 0.6, sg * d, -1, 0)); pools.push(lamp(-(nsEdge + 0.6), sg * (d + 17), 1, 0));
        }
      });
    }
    const std = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const flat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    const add = (list, mat, cast) => { const m = new T.Mesh(merge(list), mat); m.receiveShadow = true; m.castShadow = !!cast; scene.add(m); return m; };
    add(walk, std); add(kerb, std); add(marks, flat); add(yellow, flat); add(decor, std, true);
    staticLamps = new T.Mesh(merge(lampHeads), new T.MeshBasicMaterial({ vertexColors: true, color: '#ffe2a8' }));
    scene.add(staticLamps);
    // light pools under street lamps (only visible at dusk / night)
    const pg = new T.PlaneGeometry(16, 16); pg.rotateX(-Math.PI / 2);
    poolMesh = new T.InstancedMesh(pg, new T.MeshBasicMaterial({ map: radialTexture('rgba(255,214,150,0.55)', 'rgba(255,214,150,0)'), transparent: true, depthWrite: false, blending: T.AdditiveBlending }), pools.length);
    const mm = new T.Matrix4();
    pools.forEach(([x, z], i) => { mm.makeTranslation(x, 0.03, z); poolMesh.setMatrixAt(i, mm); });
    poolMesh.frustumCulled = false; scene.add(poolMesh);

    // signal poles: one on the left kerb of each approach, mast arm over the inbound lanes
    ORDER.forEach(a => {
      const half = a === 'E' || a === 'W' ? HALF.EW : HALF.NS;
      const [px, pz] = pos(a, 1.2, half + 1.3);
      const [hx, hz] = pos(a, 1.2, half * 0.55);
      const g = [];
      g.push(piece(new T.CylinderGeometry(0.14, 0.18, 6.2, 8), '#374151', px, 3.1, pz));
      const along = a === 'E' || a === 'W';
      g.push(box(along ? 0.18 : Math.abs(px - hx) + 0.3, 0.18, along ? Math.abs(pz - hz) + 0.3 : 0.18, '#374151', (px + hx) / 2, 5.9, (pz + hz) / 2));
      const hb = box(0.45, 1.5, 0.55, '#0b0f17', hx, 5.05, hz); g.push(hb);
      // a second head on the pole at eye level, as in Erode
      g.push(box(0.45, 1.5, 0.55, '#0b0f17', px, 3.0, pz));
      g.push(box(0.5, 0.42, 0.62, '#0b0f17', px, 4.15, pz));        // countdown display box
      const m = new T.Mesh(merge(g), std); m.castShadow = true; scene.add(m);
      SIGNAL_POS[a] = { head: [hx, 5.05, hz], pole: [px, 3.0, pz], count: [px, 4.15, pz] };
    });
  }

  // lamp discs for one junction's signals (each junction has its own signal states)
  function buildSignalLamps(group) {
    const lamps = {};
    const disc = new T.CylinderGeometry(0.17, 0.17, 0.06, 14); disc.rotateZ(Math.PI / 2);
    const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    ORDER.forEach(a => {
      const [dx, dz] = DIR[a], face = [-dx * 0.3, -dz * 0.3];
      lamps[a] = {};
      ['R', 'A', 'G'].forEach((k, i) => {
        const mats = [];
        ['head', 'pole'].forEach(where => {
          const [x, y, z] = SIGNAL_POS[a][where];
          const mat = new T.MeshBasicMaterial({ color: '#111' });
          const m = new T.Mesh(disc, mat); m.position.set(x + face[0], y + 0.45 - i * 0.45, z + face[1]); m.rotation.y = heading(a) + Math.PI;
          group.add(m);
          const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#fff', transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
          glow.scale.set(1.15, 1.15, 1); glow.position.copy(m.position); glow.position.x += face[0]; glow.position.z += face[1]; glow.visible = false;
          group.add(glow);
          mats.push({ mat, glow });
        });
        lamps[a][k] = mats;
      });
    });
    return lamps;
  }
  const LAMP = { R: ['#ff2a2a', '#2a0b0b'], A: ['#ffb020', '#2a1d05'], G: ['#22ff6a', '#06240f'] };

  function makeJunctionGroup() {
    const group = new T.Group();
    const meshes = {};
    const paintMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 });
    const fixedMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const lampMat = new T.MeshBasicMaterial({ color: '#ffffff' });
    const beaconMat = new T.MeshBasicMaterial({ color: '#ffffff', vertexColors: true });
    const white = new T.Color('#ffffff');
    for (const k in models) {
      const cap = CAP[k], m = {};
      ['paint', 'fixed', 'brake', 'head', 'beacon'].forEach(part => {
        if (!models[k][part]) return;
        const mat = part === 'paint' ? paintMat : part === 'fixed' ? fixedMat : part === 'beacon' ? beaconMat : lampMat;
        const im = new T.InstancedMesh(models[k][part], mat, cap);
        im.frustumCulled = false; im.count = 0;
        if (part === 'paint' || part === 'fixed') { im.castShadow = true; im.receiveShadow = part === 'paint'; }
        if (part !== 'fixed') for (let i = 0; i < cap; i++) im.setColorAt(i, white);
        group.add(im); m[part] = im;
      });
      meshes[k] = m;
    }
    // headlight beams on the road
    const bg = new T.PlaneGeometry(1, 1); bg.rotateX(-Math.PI / 2); bg.translate(0.5, 0, 0);
    const beams = new T.InstancedMesh(bg, new T.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: T.AdditiveBlending }), 1400);
    beams.frustumCulled = false; beams.count = 0; group.add(beams);
    // engine queue length, drawn as a red strip along the kerb of each approach
    const qbar = {};
    ORDER.forEach(a => {
      const g = new T.PlaneGeometry(1, 0.5); g.rotateX(-Math.PI / 2); g.translate(0.5, 0, 0);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.85, depthWrite: false }));
      const half = a === 'E' || a === 'W' ? HALF.EW : HALF.NS;
      const [x, z] = pos(a, 0, half - 0.3); m.position.set(x, 0.035, z); m.rotation.y = heading(a) + Math.PI; m.scale.x = 0.001;
      group.add(m); qbar[a] = m;
    });
    const lamps = buildSignalLamps(group);
    return { group, meshes, beams, qbar, lamps };
  }
  function beamTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, 'rgba(255,236,190,0.55)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 26); g.lineTo(128, 0); g.lineTo(128, 64); g.lineTo(0, 38); g.closePath(); g.fill();
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  function init() {
    try {
      const canvas = document.createElement('canvas');
      renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch (e) { console.warn('WebGL not available, using the 2D view', e); return false; }
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(38, 1, 0.5, 2000);
    hemi = new T.HemisphereLight('#bcd3ff', '#5b4a32', 1.2); scene.add(hemi);
    sun = new T.DirectionalLight('#ffd2a0', 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 700;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
    scene.add(sun); scene.add(sun.target);
    models = buildModels();
    buildStatic();
    ready = true;
    setLighting('off');
    return true;
  }

  let lightKey = null;
  function setLighting(night) {
    if (lightKey === night) return; lightKey = night;
    const L = {
      off:   { sky: ['#40639c', '#e9a978', '#f6c79a'], fog: '#e4b48e', sun: ['#ffc48a', 2.4], hemi: ['#c6d6ff', '#6b5536', 1.15], dir: [-160, 70, 40], lamps: 0.55, beams: 0.35, exp: 1.0 },
      night: { sky: ['#030712', '#0b1530', '#1b2547'], fog: '#111a33', sun: ['#9db4ff', 0.5], hemi: ['#3b4f86', '#14100b', 0.45], dir: [80, 160, -60], lamps: 1, beams: 1, exp: 1.25 },
      late:  { sky: ['#01030a', '#060c1f', '#101935'], fog: '#0a1126', sun: ['#8aa2f0', 0.35], hemi: ['#2c3d6e', '#0d0a07', 0.35], dir: [80, 160, -60], lamps: 1, beams: 1, exp: 1.3 },
    }[night] || null;
    if (!L) return;
    if (skyTex) skyTex.dispose();
    skyTex = skyTexture(...L.sky); scene.background = skyTex;
    scene.fog = new T.Fog(L.fog, 220, 640);
    sun.color.set(L.sun[0]); sun.intensity = L.sun[1];
    sun.position.set(L.dir[0], L.dir[1], L.dir[2]); sun.target.position.set(0, 0, 0);
    hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
    staticLamps.material.color.setScalar(L.lamps);
    poolMesh.visible = L.lamps > 0.6; poolMesh.material.opacity = 1;
    renderer.toneMappingExposure = L.exp;
    lightState = L;
  }
  let lightState = null;

  // ---------------------------------------------------------------- visual traffic
  // feed = { A: Junction, B: Junction, arrivals: {E:[],S:[],W:[],N:[]} (every arrival, incl. future ones, in time order) }
  let feed = null;
  function bind(f) {
    feed = f;
    ['A', 'B'].forEach(k => {
      if (!VJ[k]) { const g = makeJunctionGroup(); scene.add(g.group); VJ[k] = g; }
      const v = VJ[k];
      v.j = f[k]; v.tf = 0; v.ptr = { E: 0, S: 0, W: 0, N: 0, AMB: 0 }; v.eng = new Map(); v.engIdx = 0;
      v.lanes = {}; ORDER.forEach(a => { v.lanes[a] = LANES[a].map(() => []); });
      v.amb = []; v.backlog = { E: [], S: [], W: [], N: [] };
    });
  }

  const visCls = v => v.cls === 'bus' ? (v.id % 3 === 0 ? 'truck' : 'bus') : v.cls;

  function spawn(V, src) {
    const a = src.arm, cls = visCls(src);
    const due = Math.max(0, src.tArr - V.tf);           // seconds until the engine counts it as arrived
    const veh = { id: src.id, arm: a, cls, len: LEN[cls], p: IDM[cls], released: false, gone: false,
      color: PALETTE[cls][(src.id * 7 + 3) % PALETTE[cls].length], braking: false, acc: 0 };
    if (cls === 'amb') {
      veh.d = Math.min(ROAD[a], V0_AMB * due); veh.v = V0_AMB; veh.v0 = V0_AMB; veh.off = 0.55; veh.lane = -1;
      V.amb.push(veh); return true;
    }
    // choose the lane with the most room at the far end (buses stay out of the kerb lane)
    const lanes = V.lanes[a];
    let best = -1, room = -Infinity;
    lanes.forEach((L, i) => {
      if ((cls === 'bus' || cls === 'truck') && i === lanes.length - 1 && lanes.length > 2) return;
      const tail = L[L.length - 1];
      const r = tail ? ROAD[a] - (tail.d + tail.len / 2) : 1e9;
      if (r > room + 0.01 || (Math.abs(r - room) < 0.01 && (src.id % 2))) { room = r; best = i; }
    });
    const tail = lanes[best][lanes[best].length - 1];
    veh.lane = best; veh.off = LANES[a][best]; veh.offT = veh.off;
    veh.v0 = V0; veh.v = tail ? Math.min(V0, tail.v + 1) : V0;
    // enter at the far end, or out of sight behind it if the lane is busy there (a safe following gap)
    const safe = tail ? tail.d + (tail.len + veh.len) / 2 + S0[a] + veh.v * veh.p.T * 1.2 : -1e9;
    veh.d = Math.max(Math.min(ROAD[a], V0 * due + veh.len / 2), safe);
    if (veh.d > ROAD[a] + 120) return false;
    lanes[best].push(veh);
    return true;
  }

  function engineCopy(V, id) {
    const all = V.j.all;
    while (V.engIdx < all.length) { const e = all[V.engIdx++]; V.eng.set(e.id, e); }
    return V.eng.get(id);
  }

  function idm(veh, gap, dv, s0w) {
    const p = veh.p, s0 = s0w != null ? s0w : veh.cls === 'amb' ? 1.5 : S0[veh.arm];
    const sStar = s0 + Math.max(0, veh.v * p.T + veh.v * dv / (2 * Math.sqrt(p.a * p.b)));
    return p.a * (1 - Math.pow(veh.v / veh.v0, 4) - Math.pow(sStar / Math.max(gap, 0.05), 2));
  }

  function stepVehicle(V, veh, lead, dt) {
    const sig = V.j.sig[veh.arm];
    if (!veh.released) {
      const e = engineCopy(V, veh.id);
      if (e && e.tDep != null && e.tDep <= V.tf + 0.5) veh.released = true;
      veh.queued = !!(e && e.tDep == null);
    }
    let acc = idm(veh, 1e4, 0);
    if (lead) {
      const gap = veh.d - lead.d - (veh.len + lead.len) / 2;
      acc = Math.min(acc, idm(veh, gap, veh.v - lead.v));
    }
    // The stop line is a wall until the engine releases this vehicle: while its signal is not green, once the
    // engine has it waiting in the queue, or when the countdown shows the green will end before it gets there.
    if (!veh.released) {
      const gap = veh.d - veh.len / 2 - 0.4;
      let wall = sig !== 'G' || veh.queued;
      if (!wall && gap > 0) {
        const st = V.j.ctrl.runner.stage;
        const rem = st && st.kind === 'GREEN' && st.arms.includes(veh.arm) ? st.rem - (V.tf % 1) : Infinity;
        wall = gap / Math.max(veh.v, 2) > rem - 0.5;
      }
      if (wall && gap > -1) {
        // brake smoothly: never harder than the stop needs (plus a margin), never softer
        const g = Math.max(gap, 0.05), need = veh.v * veh.v / (2 * g);
        acc = Math.min(acc, Math.max(idm(veh, g, veh.v, 0.3), -need * 1.2 - (need > 0.2 ? 0.3 : 0)));
      }
    }
    acc = Math.max(acc, -8);
    let nv = veh.v + acc * dt;
    if (nv < 0) nv = 0;
    veh.d -= (veh.v + nv) / 2 * dt;
    veh.v = nv; veh.acc = acc;
    if (lead) {   // never overlap the vehicle ahead
      const minD = lead.d + (veh.len + lead.len) / 2 + 0.3;
      if (veh.d < minD) { veh.d = minD; veh.v = Math.min(veh.v, lead.v); }
    }
    veh.braking = acc < -0.7 || (veh.v < 0.6 && veh.d > -1);
  }

  function advanceOne(V, dt) {
    const tf = V.tf;
    // spawn: a vehicle enters the far end of the road LEAD seconds before the engine counts it as arrived
    ORDER.forEach(a => {
      const list = feed.arrivals[a];
      const bl = V.backlog[a];
      while (bl.length && spawn(V, bl[0])) bl.shift();
      while (V.ptr[a] < list.length) {
        const src = list[V.ptr[a]];
        if (src.tArr - LEAD[a] > tf) break;
        V.ptr[a]++;
        if (bl.length || !spawn(V, src)) bl.push(src);
      }
    });
    const al = feed.arrivals.AMB;
    while (V.ptr.AMB < al.length && al[V.ptr.AMB].tArr - ROAD[al[V.ptr.AMB].arm] / V0_AMB <= tf) spawn(V, al[V.ptr.AMB++]);
    ORDER.forEach(a => {
      V.lanes[a].forEach(L => {
        for (let i = 0; i < L.length; i++) stepVehicle(V, L[i], i ? L[i - 1] : null, dt);
        while (L.length && L[0].d < -(2 * STOP[a] + ROAD[a] + 40)) L.shift();
      });
    });
    // ambulances: drive along the centre line; vehicles in the inner lane pull towards the kerb
    V.amb.forEach(m => {
      stepVehicle(V, m, null, dt);
      const L0 = V.lanes[m.arm][0], L1 = V.lanes[m.arm][1];
      L0.forEach(v => { if (v.d > -2 * STOP[m.arm] && m.d - v.d < 35 && m.d - v.d > -8) v.offT = LANES[m.arm][0] + 1.1; });
      if (L1) L1.forEach(v => { if (m.d - v.d < 35 && m.d - v.d > -8) v.offT = LANES[m.arm][1] + 0.5; });
    });
    V.amb = V.amb.filter(m => m.d > -(2 * STOP[m.arm] + ROAD[m.arm] + 40));
    ORDER.forEach(a => V.lanes[a].forEach(L => L.forEach(v => {
      v.off += (v.offT - v.off) * Math.min(1, dt * 1.5);
      v.offT = LANES[a][v.lane];
    })));
    V.tf += dt;
  }

  function advance(tf) {
    if (!ready || !feed) return;
    ['A', 'B'].forEach(k => {
      const V = VJ[k];
      if (tf < V.tf - 1e-6) return;
      let guard = 0;
      while (V.tf < tf - 1e-6 && guard++ < 20000) {
        const dt = Math.min(tf - V.tf, tf - V.tf > 30 ? 0.25 : 0.1);
        advanceOne(V, dt);
      }
    });
    // forget arrivals that both views have already spawned
    ORDER.forEach(a => {
      const k = Math.min(VJ.A.ptr[a], VJ.B.ptr[a]);
      if (k > 400) { feed.arrivals[a].splice(0, k); VJ.A.ptr[a] -= k; VJ.B.ptr[a] -= k; }
    });
    // and engine vehicles that have left the picture
    ['A', 'B'].forEach(k => { const V = VJ[k]; if (V.eng.size > 3000) { const keep = new Set(); ORDER.forEach(a => V.lanes[a].forEach(L => L.forEach(v => keep.add(v.id)))); V.amb.forEach(v => keep.add(v.id)); V.backlog && ORDER.forEach(a => V.backlog[a].forEach(v => keep.add(v.id))); for (const id of V.eng.keys()) if (!keep.has(id)) V.eng.delete(id); } });
  }

  // ---------------------------------------------------------------- per-frame instance upload
  const mtx = new T.Matrix4(), q = new T.Quaternion(), yAxis = new T.Vector3(0, 1, 0), vpos = new T.Vector3(), one = new T.Vector3(1, 1, 1);
  const cBrakeOn = new T.Color('#ff1a1a'), cBrakeOff = new T.Color('#5a0d0d'), cHeadDay = new T.Color('#e5e7eb'), cHeadNight = new T.Color('#fff4d6');
  const cBeaconOn = new T.Color('#ffffff'), cOff = new T.Color('#2a2a2a'), paintC = new T.Color();
  const beamScale = { tw: [8, 2.2], car: [14, 4], auto: [10, 3], lcv: [15, 4.4], bus: [18, 5.4], truck: [18, 5.4], amb: [16, 4.4] };

  function upload(V, simT) {
    const counts = {}; for (const k in V.meshes) counts[k] = 0;
    const night = lightState && lightState.beams > 0.5;
    let nb = 0;
    const put = veh => {
      const k = veh.cls, m = V.meshes[k], i = counts[k];
      if (i >= CAP[k]) return;
      const [x, z] = pos(veh.arm, veh.d, veh.off);
      if (veh.d > ROAD[veh.arm] + 5) return;
      q.setFromAxisAngle(yAxis, heading(veh.arm) + (veh.offT !== undefined ? (veh.offT - veh.off) * -0.08 * Math.min(1, veh.v / 3) : 0));
      // tiny dip when braking hard, so the stop is visible
      vpos.set(x, veh.braking && veh.acc < -1.5 ? -0.03 : 0, z);
      mtx.compose(vpos, q, one);
      m.paint.setMatrixAt(i, mtx); m.fixed.setMatrixAt(i, mtx); m.brake.setMatrixAt(i, mtx); m.head.setMatrixAt(i, mtx);
      m.paint.setColorAt(i, paintC.set(veh.color));
      m.brake.setColorAt(i, veh.braking ? cBrakeOn : cBrakeOff);
      m.head.setColorAt(i, night ? cHeadNight : cHeadDay);
      if (m.beacon) { const on = Math.floor(simT * 5) % 2 === 0; m.beacon.setMatrixAt(i, mtx); m.beacon.setColorAt(i, on ? cBeaconOn : cOff); }
      counts[k] = i + 1;
      if (night && nb < 1400) {
        const [L, W] = beamScale[k];
        mtx.compose(vpos.set(x + DIR[veh.arm][0] * veh.len / 2, 0.04, z + DIR[veh.arm][1] * veh.len / 2), q, vpos2.set(L, 1, W));
        V.beams.setMatrixAt(nb++, mtx);
      }
    };
    ORDER.forEach(a => V.lanes[a].forEach(L => L.forEach(put)));
    V.amb.forEach(put);
    for (const k in V.meshes) {
      const m = V.meshes[k];
      for (const part in m) { m[part].count = counts[k]; m[part].instanceMatrix.needsUpdate = true; if (m[part].instanceColor) m[part].instanceColor.needsUpdate = true; }
    }
    V.beams.count = nb; V.beams.instanceMatrix.needsUpdate = true; V.beams.visible = night;
    // signals
    const blinkOn = Math.floor(simT * 1.5) % 2 === 0;
    ORDER.forEach(a => {
      const s = V.j.sig[a];
      ['R', 'A', 'G'].forEach(k => {
        const lit = s === k || (s === 'B' && k === 'A' && blinkOn);
        V.lamps[a][k].forEach(({ mat, glow }) => { mat.color.set(LAMP[k][lit ? 0 : 1]); glow.visible = lit; glow.material.color.set(LAMP[k][0]); });
      });
      const qm = V.j.queueM(a);
      V.qbar[a].scale.x = Math.max(0.001, Math.min(qm, ROAD[a]));
    });
  }
  const vpos2 = new T.Vector3();

  // ---------------------------------------------------------------- camera
  const CAMS = {
    overview: { target: [34, 0, 0], yaw: 0.22, pitch: 1.02, dist: 165 },
    top:      { target: [30, 0, 0], yaw: 0, pitch: 1.5, dist: 330 },
    east:     { target: [-4, 0, 3.75], yaw: Math.PI / 2, pitch: 0.17, dist: 105 },
    street:   { target: [0, 2, -2], yaw: 0.1, pitch: 0.15, dist: 50 },
    follow:   { target: [0, 0, 0], yaw: -1.75, pitch: 0.42, dist: 38 },
  };
  const cam = { mode: 'overview', target: CAMS.overview.target.slice(), yaw: CAMS.overview.yaw, pitch: CAMS.overview.pitch, dist: CAMS.overview.dist };
  function setCamera(name) {
    const c = CAMS[name] || CAMS.overview; cam.mode = name;
    cam.target = c.target.slice(); cam.yaw = c.yaw; cam.pitch = c.pitch; cam.dist = c.dist;
  }
  function followTarget(key) {
    for (const k of [key, key === 'A' ? 'B' : 'A']) {
      const V = VJ[k]; if (!V) continue;
      const m = V.amb.find(x => x.d > -(2 * STOP[x.arm] + 60));
      if (m) { const [x, z] = pos(m.arm, m.d, m.off); return [x, 1, z]; }
    }
    return null;
  }
  function placeCamera(aspect, key) {
    if (cam.mode === 'follow') { const t = followTarget(key); if (t) cam.target = t; }
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw));
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  function orbit(dx, dy) { cam.yaw -= dx * 0.008; cam.pitch = Math.max(0.05, Math.min(1.53, cam.pitch + dy * 0.006)); }
  function pan(dx, dy) {
    const s = cam.dist * 0.0022, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    cam.target[0] -= (dx * cy + dy * sy / Math.max(0.3, Math.sin(cam.pitch))) * s;
    cam.target[2] -= (-dx * sy + dy * cy / Math.max(0.3, Math.sin(cam.pitch))) * s;
    if (cam.mode === 'follow') cam.mode = 'free';
  }
  function zoom(f) { cam.dist = Math.max(12, Math.min(600, cam.dist * f)); }

  // ---------------------------------------------------------------- draw into a 2D canvas
  // Renders junction `key` into the rectangle (x, y, w, h) of ctx (logical units; the pixel size is read
  // from the context transform). Returns a projector for overlays, or null if 3D is unavailable.
  function draw(ctx, key, x, y, w, h, simT, night) {
    if (!ready || !VJ[key] || !VJ[key].j) return null;
    setLighting(night);
    const tr = ctx.getTransform();
    const pw = Math.max(16, Math.round(w * Math.hypot(tr.a, tr.b))), ph = Math.max(16, Math.round(h * Math.hypot(tr.c, tr.d)));
    const cv = renderer.domElement;
    if (cv.width !== pw || cv.height !== ph) renderer.setSize(pw, ph, false);
    VJ.A.group.visible = key === 'A'; VJ.B.group.visible = key === 'B';
    upload(VJ[key], simT);
    placeCamera(pw / ph, key);
    renderer.render(scene, camera);
    ctx.drawImage(cv, x, y, w, h);
    const v3 = new T.Vector3();
    return function project(px, py, pz) {
      v3.set(px, py, pz).project(camera);
      if (v3.z > 1 || v3.z < -1) return null;
      return [x + (v3.x + 1) / 2 * w, y + (1 - v3.y) / 2 * h];
    };
  }

  // world positions that the 2D overlay labels hang on
  function anchors(key) {
    const V = VJ[key]; const out = { signals: {}, queue: {}, labels: {}, hidden: {} };
    ORDER.forEach(a => {
      out.signals[a] = SIGNAL_POS[a].count;
      const half = a === 'E' || a === 'W' ? HALF.EW : HALF.NS;
      const qm = V && V.j ? V.j.queueM(a) : 0;
      const [qx, qz] = pos(a, Math.min(qm, ROAD[a] - 10), half - 0.3);
      const [sx, sz] = pos(a, 0, half - 0.3);
      out.queue[a] = { m: qm, at: [qx, 0.3, qz], stop: [sx, 0.3, sz] };
      const [lx, lz] = pos(a, a === 'E' || a === 'W' ? 95 : 70, -HALF[a === 'E' || a === 'W' ? 'EW' : 'NS'] - 6);
      out.labels[a] = [lx, 0.5, lz];
      out.hidden[a] = V ? V.backlog[a].length : 0;
    });
    out.north = [[0, 0, 0], [0, 0, -30]];
    return out;
  }

  window.PATHAI3D = {
    get ready() { return ready; }, init, bind, advance, draw, anchors, setCamera, orbit, pan, zoom,
    get camMode() { return cam.mode; }, LOOKAHEAD, LEAD, ROAD, V0_AMB,
    debug: () => VJ,
  };
})();
