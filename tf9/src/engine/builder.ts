import * as THREE from 'three';

/**
 * Low-level geometry kit. Everything is built around the engine axis (+X),
 * with radius r and angle phi measured from +Y toward +Z.
 * A GeoBuilder collects solid triangles (for occlusion and shading) and
 * line segments (the visible drawing) for one object.
 */

export type V3 = [number, number, number];
export type Profile = Array<[number, number]>; // [axial x, radius r]

export const TAU = Math.PI * 2;

export const cyl = (x: number, r: number, phi: number): V3 => [x, r * Math.cos(phi), r * Math.sin(phi)];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const v3 = { sub, add, mul, cross, dot, norm };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface LatheOpts {
  segs?: number;
  phi0?: number;
  phi1?: number;
  /** profile is a closed polygon (a solid cross-section) */
  closed?: boolean;
  /** draw rings at these profile indices; 'kinks' = auto at corners; 'all' = every point */
  rings?: number[] | 'kinks' | 'all' | 'none';
  /** for sectors: fill the cut faces (closed profiles only) */
  caps?: boolean;
  /** extra meridian lines (full-circle lathes), count around */
  meridians?: number;
  meridianPhase?: number;
}

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  line: number[] = [];

  vert(p: V3, n: V3): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  seg(a: V3, b: V3) {
    this.line.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  polyline(pts: V3[], closed = false) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1]);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1], pts[0]);
  }

  /** Quad with explicit shared normal; winding fixed to agree with the normal. */
  quad(a: V3, b: V3, c: V3, d: V3, n?: V3) {
    const g = norm(cross(sub(b, a), sub(d, a)));
    const nn = n ?? g;
    const flip = dot(g, nn) < 0;
    const ia = this.vert(a, nn), ib = this.vert(b, nn), ic = this.vert(c, nn), id = this.vert(d, nn);
    if (flip) { this.tri(ia, ic, ib); this.tri(ia, id, ic); }
    else { this.tri(ia, ib, ic); this.tri(ia, ic, id); }
  }

  /**
   * Parametric surface from a grid of points [row][col]. Normals are taken
   * from neighbouring grid points; `flip` reverses them.
   */
  grid(P: V3[][], flip = false) {
    const R = P.length, C = P[0].length;
    const base = this.pos.length / 3;
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const di = sub(P[Math.min(i + 1, R - 1)][j], P[Math.max(i - 1, 0)][j]);
        const dj = sub(P[i][Math.min(j + 1, C - 1)], P[i][Math.max(j - 1, 0)]);
        let n = norm(cross(di, dj));
        if (flip) n = mul(n, -1);
        this.vert(P[i][j], n);
      }
    }
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < C - 1; j++) {
        const a = base + i * C + j, b = a + 1, c = a + C + 1, d = a + C;
        if (flip) { this.tri(a, c, b); this.tri(a, d, c); }
        else { this.tri(a, b, c); this.tri(a, c, d); }
      }
    }
  }

  ring(x: number, r: number, segs = 64, phi0 = 0, phi1 = TAU) {
    const full = Math.abs(phi1 - phi0 - TAU) < 1e-6;
    const n = full ? segs : Math.max(2, Math.round(segs * (phi1 - phi0) / TAU));
    let prev = cyl(x, r, phi0);
    for (let i = 1; i <= n; i++) {
      const p = cyl(x, r, phi0 + (phi1 - phi0) * (i / n));
      this.seg(prev, p);
      prev = p;
    }
  }

  /** Surface of revolution of a profile around the X axis. */
  lathe(profile: Profile, o: LatheOpts = {}) {
    const phi0 = o.phi0 ?? 0, phi1 = o.phi1 ?? TAU;
    const full = Math.abs(phi1 - phi0 - TAU) < 1e-6;
    const segs = Math.max(3, Math.round((o.segs ?? 72) * (phi1 - phi0) / TAU));
    const pts = profile;
    const nP = pts.length;
    const edges = o.closed ? nP : nP - 1;
    // centroid of the cross-section, used to orient normals outward
    let cx = 0, cr = 0;
    for (const [x, r] of pts) { cx += x; cr += r; }
    cx /= nP; cr /= nP;

    for (let e = 0; e < edges; e++) {
      const [x0, r0] = pts[e];
      const [x1, r1] = pts[(e + 1) % nP];
      const dx = x1 - x0, dr = r1 - r0;
      let nx = -dr, nr = dx;
      if (o.closed) {
        const mx = (x0 + x1) / 2 - cx, mr = (r0 + r1) / 2 - cr;
        if (nx * mx + nr * mr < 0) { nx = -nx; nr = -nr; }
      } else if (nr < 0) { nx = -nx; nr = -nr; }
      const nl = Math.hypot(nx, nr) || 1;
      nx /= nl; nr /= nl;
      const base = this.pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const phi = phi0 + (phi1 - phi0) * (i / segs);
        const c = Math.cos(phi), s = Math.sin(phi);
        const n: V3 = [nx, nr * c, nr * s];
        this.vert([x0, r0 * c, r0 * s], n);
        this.vert([x1, r1 * c, r1 * s], n);
      }
      for (let i = 0; i < segs; i++) {
        const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
        // orient by comparing geometric normal with stored normal
        const pa: V3 = [this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2]];
        const pb: V3 = [this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]];
        const pd: V3 = [this.pos[d * 3], this.pos[d * 3 + 1], this.pos[d * 3 + 2]];
        const g = cross(sub(pb, pa), sub(pd, pa));
        const sn: V3 = [this.nor[a * 3], this.nor[a * 3 + 1], this.nor[a * 3 + 2]];
        if (dot(g, sn) < 0) { this.tri(a, c, b); this.tri(a, d, c); }
        else { this.tri(a, b, c); this.tri(a, c, d); }
      }
    }

    // rings
    let ringIdx: number[] = [];
    if (o.rings === 'all') ringIdx = pts.map((_, i) => i);
    else if (o.rings === 'none') ringIdx = [];
    else if (Array.isArray(o.rings)) ringIdx = o.rings;
    else ringIdx = kinks(pts, !!o.closed, 18);
    for (const i of ringIdx) {
      const [x, r] = pts[i];
      if (r > 1e-4) this.ring(x, r, segs * (full ? 1 : TAU / (phi1 - phi0)), phi0, phi1);
    }

    if (o.meridians && full) {
      for (let m = 0; m < o.meridians; m++) {
        const phi = (o.meridianPhase ?? 0) + (m / o.meridians) * TAU;
        this.polyline(pts.map(([x, r]) => cyl(x, r, phi)), !!o.closed);
      }
    }

    if (!full) {
      for (const phi of [phi0, phi1]) {
        this.polyline(pts.map(([x, r]) => cyl(x, r, phi)), !!o.closed);
        if (o.caps && o.closed) this.capProfile(pts, phi);
      }
    }
  }

  /** Fill a closed profile polygon lying in the meridian plane at `phi`. */
  capProfile(pts: Profile, phi: number) {
    const contour = pts.map(([x, r]) => new THREE.Vector2(x, r));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const n: V3 = [0, -Math.sin(phi), Math.cos(phi)];
    const base = this.pos.length / 3;
    for (const [x, r] of pts) this.vert(cyl(x, r, phi), n);
    for (const f of faces) this.tri(base + f[0], base + f[1], base + f[2]);
  }

  /** Hexagonal bolt head sitting on a surface point with outward normal `n`. */
  bolt(c: V3, n: V3, size: number, height: number, ref?: V3) {
    n = norm(n);
    let u = ref ? norm(cross(n, ref)) : norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = cross(n, u);
    u = norm(u);
    const top: V3[] = [], bot: V3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const d = add(mul(u, Math.cos(a) * size), mul(w, Math.sin(a) * size));
      bot.push(add(c, d));
      top.push(add(add(c, d), mul(n, height)));
    }
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const mid = norm(add(sub(bot[i], c), sub(bot[j], c)));
      this.quad(bot[i], bot[j], top[j], top[i], mid);
    }
    const tc = add(c, mul(n, height));
    const ic = this.vert(tc, n);
    const ids = top.map((p) => this.vert(p, n));
    for (let i = 0; i < 6; i++) this.tri(ic, ids[i], ids[(i + 1) % 6]);
    this.polyline(top, true);
  }

  /** Bolt circle on an axial face (heads face ±X) or a radial surface (heads face outward). */
  boltCircle(x: number, r: number, count: number, size: number, facing: 'front' | 'back' | 'out' | 'in', phase = 0, phi0 = 0, phi1 = TAU) {
    const full = Math.abs(phi1 - phi0 - TAU) < 1e-6;
    for (let i = 0; i < count; i++) {
      const t = full ? i / count : (i + 0.5) / count;
      const phi = phi0 + (phi1 - phi0) * t + phase;
      const c = cyl(x, r, phi);
      const radial: V3 = [0, Math.cos(phi), Math.sin(phi)];
      const n: V3 = facing === 'front' ? [-1, 0, 0] : facing === 'back' ? [1, 0, 0] : facing === 'out' ? radial : mul(radial, -1);
      const ref: V3 = facing === 'front' || facing === 'back' ? radial : [1, 0, 0];
      this.bolt(c, n, size, size * 0.7, ref);
    }
  }

  /** Box from 8 corners: bottom face a0..a3, top face b0..b3 (same order). */
  box(a: V3[], b: V3[], lines = true) {
    const faces: Array<[V3, V3, V3, V3]> = [
      [a[0], a[1], a[2], a[3]], [b[0], b[3], b[2], b[1]],
      [a[0], b[0], b[1], a[1]], [a[1], b[1], b[2], a[2]],
      [a[2], b[2], b[3], a[3]], [a[3], b[3], b[0], a[0]],
    ];
    const ctr = mul([a, b].flat().reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / 8);
    for (const f of faces) {
      const fc = mul(add(add(f[0], f[1]), add(f[2], f[3])), 0.25);
      const g = norm(cross(sub(f[1], f[0]), sub(f[3], f[0])));
      const n = dot(g, sub(fc, ctr)) < 0 ? mul(g, -1) : g;
      this.quad(f[0], f[1], f[2], f[3], n);
    }
    if (lines) {
      this.polyline(a, true);
      this.polyline(b, true);
      for (let i = 0; i < 4; i++) this.seg(a[i], b[i]);
    }
  }

  /** Box in cylindrical coordinates: axial [x0,x1], radial [r0,r1], angular [p0,p1]. */
  cylBox(x0: number, x1: number, r0: number, r1: number, p0: number, p1: number, lines = true) {
    this.box(
      [cyl(x0, r0, p0), cyl(x1, r0, p0), cyl(x1, r0, p1), cyl(x0, r0, p1)],
      [cyl(x0, r1, p0), cyl(x1, r1, p0), cyl(x1, r1, p1), cyl(x0, r1, p1)],
      lines,
    );
  }

  /** Small circle drawn on a cylindrical surface (dilution holes, ports). */
  surfaceCircle(x: number, r: number, phi: number, rad: number, n = 10) {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      pts.push(cyl(x + Math.cos(a) * rad, r * 1.004, phi + (Math.sin(a) * rad) / r));
    }
    this.polyline(pts, true);
  }

  solidGeometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Indices of profile points where the outline turns sharply. */
export function kinks(pts: Profile, closed: boolean, degrees: number): number[] {
  const out: number[] = [];
  const n = pts.length;
  const lim = Math.cos((degrees * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[i - 1];
    const next = closed ? pts[(i + 1) % n] : pts[i + 1];
    if (!prev || !next) { out.push(i); continue; }
    const ax = pts[i][0] - prev[0], ar = pts[i][1] - prev[1];
    const bx = next[0] - pts[i][0], br = next[1] - pts[i][1];
    const c = (ax * bx + ar * br) / ((Math.hypot(ax, ar) * Math.hypot(bx, br)) || 1);
    if (c < lim) out.push(i);
  }
  return out;
}

/** Points on an arc in the (x, r) plane, for rounded lips and fillets. */
export function arc(cx: number, cr: number, rad: number, a0: number, a1: number, n: number): Profile {
  const out: Profile = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    out.push([cx + Math.cos(a) * rad, cr + Math.sin(a) * rad]);
  }
  return out;
}

export interface BladeRowOpts {
  count: number;
  x: number;
  rHub: number;
  rTip: number;
  chordHub: number;
  chordTip: number;
  /** chord angle from the axis, radians (twist = tip - hub) */
  staggerHub: number;
  staggerTip: number;
  camberHub: number;
  camberTip: number;
  thickHub: number;
  thickTip: number;
  /** axial offset of the tip relative to hub (sweep) */
  sweep?: number;
  /** angular offset of the tip (lean), radians */
  lean?: number;
  spanN?: number;
  chordN?: number;
  phase?: number;
  /** span fractions where a chord-section line is drawn */
  sections?: number[];
  /** sink the root this far into the hub */
  rootInset?: number;
  /** draw the root outline */
  rootLine?: boolean;
}

/**
 * A row of twisted, cambered blades. Each blade is an airfoil (NACA-style
 * thickness on a parabolic camber line) stacked along span with stagger,
 * chord, camber and thickness varying from hub to tip.
 */
export function bladeRow(g: GeoBuilder, o: BladeRowOpts) {
  const S = o.spanN ?? 4, C = o.chordN ?? 7;
  const spans = new Set<number>();
  for (let i = 0; i < S; i++) spans.add(i / (S - 1));
  for (const s of o.sections ?? []) spans.add(s);
  const sList = [...spans].sort((a, b) => a - b);
  const uList: number[] = [];
  for (let j = 0; j < C; j++) uList.push((1 - Math.cos((Math.PI * j) / (C - 1))) / 2);

  for (let b = 0; b < o.count; b++) {
    const th0 = (o.phase ?? 0) + (b / o.count) * TAU;
    const up: V3[][] = [], lo: V3[][] = [];
    for (const s of sList) {
      const r = lerp(o.rHub - (o.rootInset ?? 0.004), o.rTip, s);
      const c = lerp(o.chordHub, o.chordTip, s);
      const twistS = Math.pow(s, 0.85);
      const beta = lerp(o.staggerHub, o.staggerTip, twistS);
      const k = lerp(o.camberHub, o.camberTip, s);
      const tau = lerp(o.thickHub, o.thickTip, s);
      const sweep = (o.sweep ?? 0) * s * s;
      const lean = (o.lean ?? 0) * s * s;
      const cb = Math.cos(beta), sb = Math.sin(beta);
      const rowU: V3[] = [], rowL: V3[] = [];
      for (const u of uList) {
        const yc = k * c * 4 * u * (1 - u);
        const yt = 5 * tau * c * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
        for (const [sign, row] of [[1, rowU], [-1, rowL]] as const) {
          const a = u * c - c / 2;
          const bb = yc + sign * yt;
          const axial = o.x + sweep + a * cb - bb * sb;
          const tang = a * sb + bb * cb;
          row.push(cyl(axial, r, th0 + lean + tang / r));
        }
      }
      up.push(rowU);
      lo.push(rowL);
    }
    g.grid(up, false);
    g.grid(lo, true);
    // tip cap and trailing-edge strip
    const last = sList.length - 1;
    for (let j = 0; j < C - 1; j++) g.quad(up[last][j], up[last][j + 1], lo[last][j + 1], lo[last][j]);
    for (let i = 0; i < last; i++) g.quad(up[i][C - 1], up[i + 1][C - 1], lo[i + 1][C - 1], lo[i][C - 1]);

    // drawing: leading edge, trailing edge, tip outline, sections
    g.polyline(up.map((row) => row[0]));
    g.polyline(up.map((row, i) => mul(add(row[C - 1], lo[i][C - 1]), 0.5)));
    g.polyline(up[last]);
    g.polyline(lo[last]);
    if (o.rootLine) { g.polyline(up[0]); g.polyline(lo[0]); }
    for (const s of o.sections ?? []) {
      const i = sList.indexOf(s);
      if (i > 0 && i < last) g.polyline(up[i]);
    }
  }
}
