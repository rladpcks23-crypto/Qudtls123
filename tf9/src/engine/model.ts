import { GeoBuilder, bladeRow, cyl, arc, TAU, type Profile, type V3 } from './builder';
import { BLADES, type Spool } from './spec';

/**
 * TF-9 geometry, 1 unit = 1 m. Axis +X runs from the inlet to the exhaust.
 * Each part returns two builders: `rot` (spins with its spool) and `stat`.
 */

export type Module = 'spinner' | 'fan' | 'case' | 'compressor' | 'combustor' | 'turbine' | 'nozzle' | 'shaft';

export interface Disc { x: number; r0: number; r1: number }

export interface PartDef {
  id: string;
  module: Module;
  /** explode offset in engine frame */
  offset: [number, number, number];
  spool: Spool;
  /** angular pitch of the rotating pattern (for the anti-strobe cap) */
  pitch: number;
  rot: GeoBuilder;
  stat: GeoBuilder;
  discs: Disc[];
  heavy?: boolean;
}

const deg = (d: number) => (d * Math.PI) / 180;

function lin(x: number, x0: number, x1: number, a: number, b: number) {
  return a + (b - a) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
}

function rect(x0: number, x1: number, r0: number, r1: number): Profile {
  return [[x0, r0], [x0, r1], [x1, r1], [x1, r0]];
}

/** ring lines on the outer two corners of a rect() band */
const OUTER = [1, 2];
/** ring lines on the inner two corners of a rect() band */
const INNER = [0, 3];
/** disk profiles (rim, web, bore): rim corners and bore corners */
const DISK = [0, 1, 6, 7];

/* ------------------------------------------------------------------ */

function spinner(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const prof: Profile = [];
  const N = 18;
  const rr = (t: number) => 0.305 * Math.pow(Math.sin((t * Math.PI) / 2), 0.82);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    prof.push([-0.6 + 0.62 * t, rr(t)]);
  }
  prof.push([0.02, 0.2]);
  rot.lathe(prof, { segs: 72, rings: [3, 9, N, N + 1] });
  // painted spiral: shows ground crew whether the fan is turning
  const sp: V3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = 0.08 + 0.9 * (i / 80);
    sp.push(cyl(-0.6 + 0.62 * t, rr(t) * 1.012, t * 1.75 * Math.PI));
  }
  rot.polyline(sp);
  rot.boltCircle(-0.035, rr(0.91) + 0.002, 12, 0.011, 'out', deg(15));
  return { id: 'spinner', module: 'spinner', offset: [-1.3, 0, 0], spool: 'LP', pitch: TAU / BLADES.fan, rot, stat, discs: [] };
}

function fan(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  // disk: rim with sloped platform, web and bore
  rot.lathe([[0.03, 0.12], [0.03, 0.298], [0.38, 0.345], [0.38, 0.27], [0.3, 0.24], [0.3, 0.12]], { closed: true, segs: 96, rings: [0, 1, 2, 3] });
  rot.boltCircle(0.03, 0.22, 18, 0.013, 'front', deg(10));
  bladeRow(rot, {
    count: BLADES.fan, x: 0.2, rHub: 0.322, rTip: 0.972,
    chordHub: 0.19, chordTip: 0.34,
    staggerHub: deg(24), staggerTip: deg(62),
    camberHub: 0.1, camberTip: 0.035,
    thickHub: 0.11, thickTip: 0.035,
    sweep: 0.05, lean: 0.06,
    spanN: 10, chordN: 13, sections: [0.33, 0.66], rootInset: 0.03,
  });
  return { id: 'fan', module: 'fan', offset: [-0.9, 0, 0], spool: 'LP', pitch: TAU / BLADES.fan, rot, stat, discs: [{ x: 0.2, r0: 0.33, r1: 0.97 }], heavy: true };
}

function fanCase(half: 'upper' | 'lower'): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const lip = arc(-0.4, 1.08, 0.05, Math.PI / 2, (3 * Math.PI) / 2, 8);
  const inner: Profile = [[-0.36, 1.012], [-0.28, 0.998], [-0.15, 0.991], [0.0, 0.988], [0.02, 0.981], [0.4, 0.981], [0.42, 0.988], [0.7, 0.99], [1.0, 0.97], [1.3, 0.925], [1.56, 0.876]];
  const te: Profile = [[1.585, 0.884]];
  const outer: Profile = [[1.3, 1.02], [1.0, 1.11], [0.6, 1.165], [0.2, 1.18], [-0.15, 1.166], [-0.33, 1.132]];
  const prof: Profile = [...lip, ...inner, ...te, ...outer];
  const at = (x: number, r: number) => prof.findIndex(([px, pr]) => Math.abs(px - x) < 1e-6 && Math.abs(pr - r) < 1e-6);
  const rings = [4, at(0.02, 0.981), at(0.4, 0.981), at(1.585, 0.884), at(0.6, 1.165), at(-0.15, 1.166), at(1.0, 1.11), at(1.0, 0.97)];
  const up = half === 'upper';
  const phi0 = up ? -Math.PI / 2 : Math.PI / 2;
  const phi1 = phi0 + Math.PI;
  stat.lathe(prof, { closed: true, segs: 112, phi0, phi1, rings, caps: true });
  // inlet attach flange band + bolts
  stat.lathe(rect(-0.2, -0.165, 1.16, 1.192), { closed: true, segs: 112, phi0, phi1, caps: true, rings: OUTER });
  stat.boltCircle(-0.1825, 1.192, 16, 0.009, 'out', 0, phi0, phi1);
  // aft flange band + bolts
  stat.lathe(rect(0.98, 1.01, 1.105, 1.135), { closed: true, segs: 112, phi0, phi1, caps: true, rings: OUTER });
  stat.boltCircle(0.995, 1.135, 16, 0.008, 'out', 0, phi0, phi1);
  // horizontal split flanges, both sides
  const s = up ? 1 : -1;
  for (const side of [1, -1]) {
    const y0 = 0.002 * s, y1 = 0.03 * s;
    const z0 = 1.14 * side, z1 = 1.235 * side;
    const x0 = -0.22, x1 = 0.78;
    const A: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    const B: V3[] = A.map(([x, , z]) => [x, y1, z]);
    stat.box(A, B);
    for (let i = 0; i < 11; i++) {
      const x = -0.17 + (0.9 * i) / 10;
      stat.bolt([x, y1, 1.205 * side], [0, s, 0], 0.011, 0.008, [1, 0, 0]);
    }
  }
  const id = up ? 'caseUpper' : 'caseLower';
  return { id, module: 'case', offset: [-0.55, 1.18 * s, 0], spool: null, pitch: 1, rot, stat, discs: [], heavy: true };
}

/* ------------------------------------------------------------------ */

function lpcStage(i: number): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const hub = (x: number) => lin(x, 0.46, 0.84, 0.4, 0.42);
  const tip = (x: number) => lin(x, 0.46, 0.84, 0.585, 0.53);
  const xr = 0.5 + 0.13 * i, xs = xr + 0.062;
  const h = hub(xr), t = tip(xr);
  rot.lathe([[xr - 0.04, h - 0.026], [xr - 0.04, h], [xr + 0.04, h + 0.003], [xr + 0.04, h - 0.026]], { closed: true, segs: 80, rings: [0, 1, 2] });
  rot.lathe(rect(xr - 0.01, xr + 0.01, 0.2, h - 0.026), { closed: true, segs: 64, rings: INNER });
  rot.boltCircle(xr - 0.01, 0.25, 16, 0.008, 'front', deg(4));
  bladeRow(rot, {
    count: BLADES.lpc[i], x: xr, rHub: h, rTip: t - 0.006,
    chordHub: 0.055, chordTip: 0.062, staggerHub: deg(36), staggerTip: deg(54),
    camberHub: 0.08, camberTip: 0.05, thickHub: 0.08, thickTip: 0.05,
    spanN: 3, chordN: 6,
  });
  const hs = hub(xs), ts = tip(xs);
  bladeRow(stat, {
    count: BLADES.lpcVanes[i], x: xs, rHub: hs, rTip: ts,
    chordHub: 0.045, chordTip: 0.045, staggerHub: deg(-26), staggerTip: deg(-30),
    camberHub: -0.07, camberTip: -0.06, thickHub: 0.07, thickTip: 0.06,
    spanN: 2, chordN: 5,
  });
  stat.lathe(rect(xs - 0.03, xs + 0.03, ts, ts + 0.02), { closed: true, segs: 72, rings: OUTER });
  stat.lathe(rect(xs - 0.026, xs + 0.026, hs - 0.014, hs + 0.002), { closed: true, segs: 72, rings: OUTER });
  return {
    id: `lpc${i + 1}`, module: 'compressor', offset: [-0.52 + 0.12 * i, 0, 0], spool: 'LP',
    pitch: TAU / BLADES.lpc[i], rot, stat, discs: [{ x: xr, r0: h, r1: t }],
  };
}

function hpcStage(i: number): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const hub = (x: number) => lin(x, 0.98, 1.54, 0.29, 0.335);
  const tip = (x: number) => lin(x, 0.98, 1.54, 0.43, 0.385);
  const xr = 1.0 + 0.11 * i, xs = xr + 0.052;
  const h = hub(xr), t = tip(xr);
  // disk cross-section: rim, web, bore
  rot.lathe([
    [xr - 0.026, h], [xr + 0.026, h], [xr + 0.026, h - 0.02], [xr + 0.008, h - 0.02], [xr + 0.008, 0.17],
    [xr + 0.02, 0.17], [xr + 0.02, 0.135], [xr - 0.02, 0.135], [xr - 0.02, 0.17], [xr - 0.008, 0.17],
    [xr - 0.008, h - 0.02], [xr - 0.026, h - 0.02],
  ], { closed: true, segs: 72, rings: DISK });
  rot.boltCircle(xr - 0.008, 0.205, 12, 0.006, 'front', deg(7));
  bladeRow(rot, {
    count: BLADES.hpc[i], x: xr, rHub: h, rTip: t - 0.004,
    chordHub: 0.042, chordTip: 0.036, staggerHub: deg(40), staggerTip: deg(54),
    camberHub: 0.07, camberTip: 0.05, thickHub: 0.07, thickTip: 0.045,
    spanN: 3, chordN: 6,
  });
  const hs = hub(xs), ts = tip(xs);
  bladeRow(stat, {
    count: BLADES.hpcVanes[i], x: xs, rHub: hs, rTip: ts,
    chordHub: 0.034, chordTip: 0.034, staggerHub: deg(-28), staggerTip: deg(-30),
    camberHub: -0.06, camberTip: -0.05, thickHub: 0.07, thickTip: 0.06,
    spanN: 2, chordN: 5,
  });
  stat.lathe(rect(xs - 0.022, xs + 0.022, ts, ts + 0.015), { closed: true, segs: 72, rings: OUTER });
  stat.lathe(rect(xs - 0.02, xs + 0.02, hs - 0.012, hs + 0.002), { closed: true, segs: 72, rings: OUTER });
  if (i <= 1) {
    // variable stator vanes: lever arm per vane + unison ring
    const n = BLADES.hpcVanes[i];
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * TAU;
      const a = cyl(xs, ts + 0.015, phi), b = cyl(xs, ts + 0.03, phi), c = cyl(xs + 0.022, ts + 0.034, phi + 0.02);
      stat.seg(a, b);
      stat.seg(b, c);
    }
    stat.lathe(rect(xs + 0.018, xs + 0.03, ts + 0.032, ts + 0.04), { closed: true, segs: 72, rings: OUTER });
  }
  return {
    id: `hpc${i + 1}`, module: 'compressor', offset: [-0.02 + 0.1 * i, 0, 0], spool: 'HP',
    pitch: TAU / BLADES.hpc[i], rot, stat, discs: [{ x: xr, r0: h, r1: t }],
  };
}

/* ------------------------------------------------------------------ */

export const COMB_CUT = { phi0: deg(100), phi1: deg(370) };

function combustor(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const { phi0, phi1 } = COMB_CUT;
  // outer case with front and rear flanges, cut away to show the liner
  stat.lathe([[1.56, 0.505], [1.56, 0.6], [1.585, 0.6], [1.585, 0.53], [1.95, 0.53], [1.95, 0.58], [1.975, 0.58], [1.975, 0.505]], { closed: true, segs: 112, phi0, phi1, caps: true, rings: [1, 2, 3, 4, 5, 6] });
  stat.boltCircle(1.56, 0.578, 27, 0.008, 'front', 0, phi0, phi1);
  stat.boltCircle(1.975, 0.555, 27, 0.0075, 'back', 0, phi0, phi1);
  // igniters
  for (const p of [deg(205), deg(335)]) {
    stat.cylBox(1.7, 1.725, 0.52, 0.585, p - 0.025, p + 0.025);
    stat.bolt(cyl(1.7125, 0.585, p), [0, Math.cos(p), Math.sin(p)], 0.012, 0.01, [1, 0, 0]);
  }
  // fuel manifold and pigtails
  const tube: Profile = [];
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; tube.push([1.6 + Math.cos(a) * 0.008, 0.64 + Math.sin(a) * 0.008]); }
  stat.lathe(tube, { closed: true, segs: 128, rings: [2, 7] });

  const nN = BLADES.fuelNozzles;
  for (let k = 0; k < nN; k++) {
    const p = ((k + 0.5) / nN) * TAU;
    // pigtail from manifold
    stat.seg(cyl(1.6, 0.632, p), cyl(1.6, 0.6, p));
    // stem through the case, mounting pad on top
    stat.cylBox(1.592, 1.608, 0.415, 0.6, p - 0.014, p + 0.014, false);
    stat.polyline([cyl(1.592, 0.53, p - 0.014), cyl(1.592, 0.6, p - 0.014), cyl(1.608, 0.6, p - 0.014)]);
    stat.cylBox(1.586, 1.614, 0.53, 0.545, p - 0.03, p + 0.03);
    // swirler cup on the dome
    const cup: V3[] = [];
    for (let a = 0; a < 14; a++) {
      const t = (a / 14) * TAU;
      cup.push(cyl(1.607, 0.39 + Math.cos(t) * 0.024, p + (Math.sin(t) * 0.024) / 0.39));
    }
    stat.polyline(cup, true);
  }
  return { id: 'combustor', module: 'combustor', offset: [0.72, 0, 0], spool: null, pitch: 1, rot, stat, discs: [], heavy: true };
}

/** The liner gets its own (emissive) material, so it is built separately. */
export function combustorLiner(): GeoBuilder {
  const g = new GeoBuilder();
  const prof: Profile = [
    [1.96, 0.432], [1.86, 0.452], [1.74, 0.468], [1.66, 0.472],
    [1.632, 0.462], [1.616, 0.432], [1.61, 0.39], [1.616, 0.348], [1.632, 0.322],
    [1.66, 0.312], [1.74, 0.31], [1.86, 0.318], [1.96, 0.332],
  ];
  g.lathe(prof, { segs: 120, rings: [0, 1, 2, 3, 6, 9, 10, 11, 12] });
  for (let k = 0; k < 20; k++) {
    const p = (k / 20) * TAU;
    g.surfaceCircle(1.70, 0.47, p, 0.012);
    g.surfaceCircle(1.80, 0.46, p + Math.PI / 20, 0.008);
    g.surfaceCircle(1.78, 0.314, p + Math.PI / 40, 0.008);
  }
  return g;
}

/* ------------------------------------------------------------------ */

function hptStage(i: number): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const hub = 0.335;
  const tip = (x: number) => lin(x, 2.02, 2.26, 0.43, 0.45);
  const xv = 2.03 + 0.12 * i, xr = xv + 0.056;
  const tv = tip(xv), tr = tip(xr);
  bladeRow(stat, {
    count: BLADES.hptVanes[i], x: xv, rHub: hub, rTip: tv,
    chordHub: 0.046, chordTip: 0.046, staggerHub: deg(-44), staggerTip: deg(-46),
    camberHub: -0.16, camberTip: -0.15, thickHub: 0.18, thickTip: 0.15,
    spanN: 2, chordN: 7,
  });
  stat.lathe(rect(xv - 0.03, xv + 0.03, tv, tv + 0.022), { closed: true, segs: 72, rings: OUTER });
  stat.lathe(rect(xv - 0.028, xv + 0.028, hub - 0.018, hub + 0.002), { closed: true, segs: 72, rings: OUTER });
  bladeRow(rot, {
    count: BLADES.hpt[i], x: xr, rHub: hub, rTip: tr - 0.004,
    chordHub: 0.04, chordTip: 0.036, staggerHub: deg(30), staggerTip: deg(40),
    camberHub: 0.19, camberTip: 0.15, thickHub: 0.16, thickTip: 0.1,
    spanN: 3, chordN: 7,
  });
  rot.lathe([
    [xr - 0.024, hub], [xr + 0.024, hub], [xr + 0.024, hub - 0.022], [xr + 0.012, hub - 0.03], [xr + 0.012, 0.2],
    [xr + 0.032, 0.19], [xr + 0.032, 0.135], [xr - 0.032, 0.135], [xr - 0.032, 0.19], [xr - 0.012, 0.2],
    [xr - 0.012, hub - 0.03], [xr - 0.024, hub - 0.022],
  ], { closed: true, segs: 72, rings: DISK });
  rot.boltCircle(xr - 0.012, 0.25, 16, 0.007, 'front', deg(5));
  return {
    id: `hpt${i + 1}`, module: 'turbine', offset: [1.02 + 0.12 * i, 0, 0], spool: 'HP',
    pitch: TAU / BLADES.hpt[i], rot, stat, discs: [{ x: xr, r0: hub, r1: tr }],
  };
}

function lptStage(i: number): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  const hub = (x: number) => lin(x, 2.3, 2.82, 0.34, 0.36);
  const tip = (x: number) => lin(x, 2.3, 2.82, 0.5, 0.63);
  const xv = 2.32 + 0.165 * i, xr = xv + 0.078;
  const hv = hub(xv), tv = tip(xv), hr = hub(xr), tr = tip(xr);
  bladeRow(stat, {
    count: BLADES.lptVanes[i], x: xv, rHub: hv, rTip: tv,
    chordHub: 0.052, chordTip: 0.052, staggerHub: deg(-34), staggerTip: deg(-36),
    camberHub: -0.12, camberTip: -0.1, thickHub: 0.1, thickTip: 0.08,
    spanN: 3, chordN: 6,
  });
  stat.lathe(rect(xv - 0.034, xv + 0.034, tv, tv + 0.02), { closed: true, segs: 72, rings: OUTER });
  stat.lathe(rect(xv - 0.03, xv + 0.03, hv - 0.016, hv + 0.002), { closed: true, segs: 72, rings: OUTER });
  bladeRow(rot, {
    count: BLADES.lpt[i], x: xr, rHub: hr, rTip: tr - 0.002,
    chordHub: 0.052, chordTip: 0.046, staggerHub: deg(30), staggerTip: deg(50),
    camberHub: 0.14, camberTip: 0.1, thickHub: 0.09, thickTip: 0.05,
    spanN: 4, chordN: 6,
  });
  // interlocking tip shrouds read as one band, with two knife-edge seal fins
  rot.lathe(rect(xr - 0.026, xr + 0.026, tr, tr + 0.01), { closed: true, segs: 96, rings: [0, 1, 2, 3] });
  rot.lathe(rect(xr - 0.014, xr - 0.008, tr + 0.01, tr + 0.024), { closed: true, segs: 96, rings: [1] });
  rot.lathe(rect(xr + 0.008, xr + 0.014, tr + 0.01, tr + 0.024), { closed: true, segs: 96, rings: [2] });
  rot.lathe([
    [xr - 0.02, hr], [xr + 0.02, hr], [xr + 0.02, hr - 0.02], [xr + 0.008, hr - 0.026], [xr + 0.008, 0.21],
    [xr + 0.022, 0.2], [xr + 0.022, 0.08], [xr - 0.022, 0.08], [xr - 0.022, 0.2], [xr - 0.008, 0.21],
    [xr - 0.008, hr - 0.026], [xr - 0.02, hr - 0.02],
  ], { closed: true, segs: 80, rings: DISK });
  rot.boltCircle(xr - 0.008, 0.26, 18, 0.007, 'front', deg(3));
  return {
    id: `lpt${i + 1}`, module: 'turbine', offset: [1.42 + 0.14 * i, 0, 0], spool: 'LP',
    pitch: TAU / BLADES.lpt[i], rot, stat, discs: [{ x: xr, r0: hr, r1: tr }],
  };
}

function nozzle(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  stat.lathe([[2.86, 0.64], [3.1, 0.6], [3.4, 0.53], [3.412, 0.537], [3.4, 0.545], [3.1, 0.622], [2.885, 0.668], [2.885, 0.705], [2.86, 0.705]], { closed: true, segs: 128 });
  stat.boltCircle(2.86, 0.686, 32, 0.0075, 'front', deg(2));
  stat.lathe([[2.86, 0.0], [2.86, 0.36], [2.95, 0.362], [3.2, 0.33], [3.45, 0.26], [3.6, 0.17], [3.7, 0.08], [3.735, 0.0]], { segs: 96, rings: [1, 2, 3, 4, 5] });
  bladeRow(stat, {
    count: BLADES.rearStruts, x: 2.935, rHub: 0.358, rTip: 0.63,
    chordHub: 0.075, chordTip: 0.07, staggerHub: 0, staggerTip: 0,
    camberHub: 0, camberTip: 0, thickHub: 0.14, thickTip: 0.12,
    spanN: 2, chordN: 7, rootLine: true, rootInset: 0.004,
  });
  // aft mount lugs on top
  for (const s of [-1, 1]) {
    stat.cylBox(2.93, 3.03, 0.665, 0.75, s > 0 ? 0.05 : -0.1, s > 0 ? 0.1 : -0.05);
    const p = s * 0.075;
    const hole: V3[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      hole.push(cyl(2.98 + Math.cos(a) * 0.02, 0.715 + Math.sin(a) * 0.02, p + s * 0.026));
    }
    stat.polyline(hole, true);
  }
  return { id: 'nozzle', module: 'nozzle', offset: [2.05, 0, 0], spool: null, pitch: 1, rot, stat, discs: [], heavy: true };
}

/* ------------------------------------------------------------------ */

function lpShaft(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  rot.lathe([[0.06, 0.0], [0.06, 0.075], [0.085, 0.075], [0.085, 0.055], [2.9, 0.055], [2.9, 0.0]], { segs: 48, meridians: 8, rings: [1, 2, 3, 4] });
  for (const x of [0.4, 0.7, 2.84]) {
    rot.lathe(rect(x - 0.016, x + 0.016, 0.055, 0.086), { closed: true, segs: 48, rings: OUTER });
  }
  // splines at both ends
  for (let k = 0; k < 24; k++) {
    const p = (k / 24) * TAU;
    rot.seg(cyl(0.1, 0.0565, p), cyl(0.2, 0.0565, p));
    rot.seg(cyl(2.7, 0.0565, p), cyl(2.8, 0.0565, p));
  }
  return { id: 'lpShaft', module: 'shaft', offset: [1.3, -1.6, 0], spool: 'LP', pitch: TAU / 8, rot, stat, discs: [] };
}

function hpShaft(): PartDef {
  const rot = new GeoBuilder(), stat = new GeoBuilder();
  rot.lathe([[0.94, 0.1], [0.94, 0.19], [0.965, 0.19], [0.965, 0.12], [2.27, 0.12], [2.27, 0.19], [2.295, 0.19], [2.295, 0.1]], { closed: true, segs: 72, meridians: 12 });
  rot.boltCircle(0.94, 0.165, 12, 0.007, 'front');
  rot.boltCircle(2.295, 0.165, 12, 0.007, 'back');
  // #3 ball bearing: races and balls
  rot.lathe(rect(0.89, 0.92, 0.12, 0.13), { closed: true, segs: 64, rings: OUTER });
  rot.lathe(rect(0.89, 0.92, 0.154, 0.164), { closed: true, segs: 64, rings: OUTER });
  for (let k = 0; k < 18; k++) {
    const p = (k / 18) * TAU;
    const ball: V3[] = [];
    for (let a = 0; a < 10; a++) {
      const t = (a / 10) * TAU;
      ball.push(cyl(0.905 + Math.cos(t) * 0.011, 0.142 + Math.sin(t) * 0.011, p));
    }
    rot.polyline(ball, true);
  }
  return { id: 'hpShaft', module: 'shaft', offset: [1.5, -1.25, 0], spool: 'HP', pitch: TAU / 12, rot, stat, discs: [] };
}

export function partDefs(): Array<() => PartDef> {
  return [
    () => fanCase('upper'), () => fanCase('lower'),
    spinner, fan,
    () => lpcStage(0), () => lpcStage(1), () => lpcStage(2),
    () => hpcStage(0), () => hpcStage(1), () => hpcStage(2), () => hpcStage(3), () => hpcStage(4),
    combustor,
    () => hptStage(0), () => hptStage(1),
    () => lptStage(0), () => lptStage(1), () => lptStage(2),
    nozzle, lpShaft, hpShaft,
  ];
}

export const DISASSEMBLY_ORDER = [
  ['caseUpper', 'caseLower'], ['spinner'], ['fan'], ['lpc1'], ['lpc2'], ['lpc3'],
  ['hpc1'], ['hpc2'], ['hpc3'], ['hpc4'], ['hpc5'], ['combustor'],
  ['hpt1'], ['hpt2'], ['lpt1'], ['lpt2'], ['lpt3'], ['nozzle'], ['hpShaft'], ['lpShaft'],
];

export const REASSEMBLY_ORDER = [
  ['lpShaft'], ['hpShaft'], ['nozzle'], ['lpt3'], ['lpt2'], ['lpt1'], ['hpt2'], ['hpt1'], ['combustor'],
  ['hpc5'], ['hpc4'], ['hpc3'], ['hpc2'], ['hpc1'], ['lpc3'], ['lpc2'], ['lpc1'], ['fan'], ['spinner'],
  ['caseUpper', 'caseLower'],
];

export const FOCUS: Record<string, string[]> = {
  fan: ['fan', 'spinner'],
  compressor: ['lpc1', 'lpc2', 'lpc3', 'hpc1', 'hpc2', 'hpc3', 'hpc4', 'hpc5'],
  combustor: ['combustor'],
  turbine: ['hpt1', 'hpt2', 'lpt1', 'lpt2', 'lpt3'],
};

