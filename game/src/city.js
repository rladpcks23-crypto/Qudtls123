// Procedural harbour city: road grid, blocks of buildings, parks, props.
// Everything static is merged into a handful of meshes so the draw call count stays low.
import * as THREE from 'three';
import { makeRng, randRange, randInt, pick, clamp, lerp as lerpN } from './util.js';
import * as TX from './textures.js';

export const S = 80;            // grid cell (road centre to road centre)
export const ROAD = 18;         // road width
export const N = 8;             // blocks per axis
export const HALF = N * S / 2;  // city half-extent
export const LANE = 4.4;        // lane offset from road centre
const SIDEWALK_H = 0.22;

/** World coordinate of road line index i (0..N). */
export const roadLine = i => i * S - HALF;

/** Nearest road line index for a coordinate. */
export const nearestLine = v => clamp(Math.round((v + HALF) / S), 0, N);

export function onRoad(x, z) {
  const dx = Math.abs(x - roadLine(nearestLine(x)));
  const dz = Math.abs(z - roadLine(nearestLine(z)));
  return dx < ROAD / 2 || dz < ROAD / 2;
}

class Arrays {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  quad(a, b, c, d, nx, ny, nz, uv, col) {
    const P = this.p, NO = this.n, U = this.u, C = this.c;
    const push = (v, uu, vv) => {
      P.push(v[0], v[1], v[2]); NO.push(nx, ny, nz); U.push(uu, vv);
      C.push(col[0], col[1], col[2]);
    };
    push(a, uv[0], uv[1]); push(b, uv[2], uv[3]); push(c, uv[4], uv[5]);
    push(a, uv[0], uv[1]); push(c, uv[4], uv[5]); push(d, uv[6], uv[7]);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.p.length === 0; }
}

function wall(A, x0, z0, x1, z1, y0, y1, col, tw, th, uo, vo) {
  const len = Math.hypot(x1 - x0, z1 - z0), h = y1 - y0;
  const u0 = uo, u1 = uo + len / tw, v0 = vo, v1 = vo + h / th;
  A.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0],
    -(z1 - z0) / len, 0, (x1 - x0) / len, [u0, v0, u1, v0, u1, v1, u0, v1], col);
}

function boxSides(A, x0, z0, x1, z1, y0, y1, col, tw, th, uo, vo) {
  wall(A, x1, z0, x0, z0, y0, y1, col, tw, th, uo, vo);   // -z
  wall(A, x1, z1, x1, z0, y0, y1, col, tw, th, uo, vo);   // +x
  wall(A, x0, z1, x1, z1, y0, y1, col, tw, th, uo, vo);   // +z
  wall(A, x0, z0, x0, z1, y0, y1, col, tw, th, uo, vo);   // -x
}

function topFace(A, x0, z0, x1, z1, y, col, tw) {
  const u = (x1 - x0) / tw, v = (z1 - z0) / tw;
  A.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0],
    0, 1, 0, [0, 0, 0, v, u, v, u, 0], col);
}

function boxAll(A, x0, z0, x1, z1, y0, y1, col, tw, th) {
  boxSides(A, x0, z0, x1, z1, y0, y1, col, tw, th, 0, 0);
  topFace(A, x0, z0, x1, z1, y1, col, tw);
}

export class City {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    this.rng = makeRng(0x4e454f4e);
    this.solids = [];                  // {x0,z0,x1,z1,h} axis aligned colliders
    this.grid = new Map();             // spatial hash of solid indices
    this.cellSize = 20;
    this.blocks = [];                  // minimap data
    this.lamps = [];                   // emissive lamp positions (night glow sprites)
    this.parks = [];
    this.spawnRoadPoints = [];
    this.sidewalkPoints = [];
  }

  key(cx, cz) { return cx + ',' + cz; }

  addSolid(x0, z0, x1, z1, h) {
    const i = this.solids.length;
    this.solids.push({ x0, z0, x1, z1, h });
    const c0 = Math.floor(x0 / this.cellSize), c1 = Math.floor(x1 / this.cellSize);
    const d0 = Math.floor(z0 / this.cellSize), d1 = Math.floor(z1 / this.cellSize);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const k = this.key(cx, cz);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
      a.push(i);
    }
  }

  /** Solids overlapping a circle. */
  near(x, z, r) {
    const out = [], seen = new Set();
    const c0 = Math.floor((x - r) / this.cellSize), c1 = Math.floor((x + r) / this.cellSize);
    const d0 = Math.floor((z - r) / this.cellSize), d1 = Math.floor((z + r) / this.cellSize);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const a = this.grid.get(this.key(cx, cz)); if (!a) continue;
      for (const i of a) if (!seen.has(i)) { seen.add(i); out.push(this.solids[i]); }
    }
    return out;
  }

  build() {
    const rng = this.rng;
    const facades = [0, 1, 2, 3].map(i => TX.facade(i, 1000 + i * 77));
    const concreteTex = TX.concrete(), asphaltTex = TX.asphalt(), grassTex = TX.grass();

    const fa = [0, 1, 2, 3].map(() => new Arrays());
    const roofA = new Arrays(), walkA = new Arrays(), markA = new Arrays();
    const propA = new Arrays(), neonA = new Arrays();
    const treeA = new Arrays(), leafA = new Arrays(), grassA = new Arrays();

    // ---- ground -----------------------------------------------------------
    const groundMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: .95, metalness: .02, envMapIntensity: .35 });
    asphaltTex.repeat.set(N * S / 8, N * S / 8);
    this.groundMat = groundMat;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(N * S + 40, N * S + 40), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    // harbour water around the island
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0b2033, roughness: .08, metalness: .85, transparent: true, opacity: .96
    });
    const water = this.water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 1, 1), waterMat);
    water.rotation.x = -Math.PI / 2; water.position.y = -1.4;
    this.scene.add(water);

    // sea wall
    const wallCol = [.62, .64, .66];
    const E = HALF + 14;
    boxAll(walkA, -E - 3, -E - 3, E + 3, -E, -2, 1.1, wallCol, 6, 3);
    boxAll(walkA, -E - 3, E, E + 3, E + 3, -2, 1.1, wallCol, 6, 3);
    boxAll(walkA, -E - 3, -E, -E, E, -2, 1.1, wallCol, 6, 3);
    boxAll(walkA, E, -E, E + 3, E, -2, 1.1, wallCol, 6, 3);
    this.addSolid(-E - 3, -E - 3, E + 3, -E, 1.1);
    this.addSolid(-E - 3, E, E + 3, E + 3, 1.1);
    this.addSolid(-E - 3, -E, -E, E, 1.1);
    this.addSolid(E, -E, E + 3, E, 1.1);

    // ---- road markings ----------------------------------------------------
    const white = [.58, .59, .57], yellow = [.55, .44, .12];
    for (let i = 0; i <= N; i++) {
      const c = roadLine(i);
      for (let j = 0; j < N; j++) {
        const a = roadLine(j) + ROAD / 2 + 1, b = roadLine(j + 1) - ROAD / 2 - 1;
        for (let t = a; t < b; t += 9) {          // dashes along X roads and Z roads
          const e = Math.min(t + 5, b);
          topFace(markA, t, c - 0.22, e, c + 0.22, 0.03, white, 4);
          topFace(markA, c - 0.22, t, c + 0.22, e, 0.03, white, 4);
        }
        // lane edge lines
        topFace(markA, a, c - ROAD / 2 + 1.1, b, c - ROAD / 2 + 1.5, 0.03, yellow, 4);
        topFace(markA, a, c + ROAD / 2 - 1.5, b, c + ROAD / 2 - 1.1, 0.03, yellow, 4);
        topFace(markA, c - ROAD / 2 + 1.1, a, c - ROAD / 2 + 1.5, b, 0.03, yellow, 4);
        topFace(markA, c + ROAD / 2 - 1.5, a, c + ROAD / 2 - 1.1, b, 0.03, yellow, 4);
      }
      // crosswalks at every intersection
      for (let j = 0; j <= N; j++) {
        const d = roadLine(j);
        for (let k = -3; k <= 3; k++) {
          topFace(markA, c - ROAD / 2 - 3.4, d + k * 2.2 - .5, c - ROAD / 2 - 0.6, d + k * 2.2 + .5, 0.035, white, 4);
          topFace(markA, c + ROAD / 2 + 0.6, d + k * 2.2 - .5, c + ROAD / 2 + 3.4, d + k * 2.2 + .5, 0.035, white, 4);
          topFace(markA, c + k * 2.2 - .5, d - ROAD / 2 - 3.4, c + k * 2.2 + .5, d - ROAD / 2 - 0.6, 0.035, white, 4);
          topFace(markA, c + k * 2.2 - .5, d + ROAD / 2 + 0.6, c + k * 2.2 + .5, d + ROAD / 2 + 3.4, 0.035, white, 4);
        }
      }
    }

    // ---- blocks -----------------------------------------------------------
    const maxD = Math.hypot(HALF, HALF);
    for (let bi = 0; bi < N; bi++) {
      for (let bj = 0; bj < N; bj++) {
        const x0 = roadLine(bi) + ROAD / 2, x1 = roadLine(bi + 1) - ROAD / 2;
        const z0 = roadLine(bj) + ROAD / 2, z1 = roadLine(bj + 1) - ROAD / 2;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const dist = Math.hypot(cx, cz) / maxD;             // 0 downtown .. 1 outskirts
        const r = rng();
        const kind = r < 0.10 ? 'park' : r < 0.17 ? 'lot' : 'built';

        // raised sidewalk slab for the whole block
        boxAll(walkA, x0 - 2.6, z0 - 2.6, x1 + 2.6, z1 + 2.6, -0.4, SIDEWALK_H, [.72, .73, .75], 6, 2);
        this.blocks.push({ x0, z0, x1, z1, kind });

        // sidewalk waypoints (pedestrians loop the block)
        const inset = 1.4;
        this.sidewalkPoints.push(
          { x: x0 - inset, z: z0 - inset }, { x: x1 + inset, z: z0 - inset },
          { x: x1 + inset, z: z1 + inset }, { x: x0 - inset, z: z1 + inset });

        if (kind === 'park') {
          topFace(grassA, x0, z0, x1, z1, SIDEWALK_H + 0.02, [1, 1, 1], 10);
          this.parks.push({ cx, cz });
          const trees = randInt(rng, 6, 12);
          for (let t = 0; t < trees; t++) {
            const tx = randRange(rng, x0 + 4, x1 - 4), tz = randRange(rng, z0 + 4, z1 - 4);
            const h = randRange(rng, 4.5, 8);
            boxAll(treeA, tx - .35, tz - .35, tx + .35, tz + .35, 0, h, [.36, .26, .18], 2, 4);
            const rr = randRange(rng, 2.2, 3.4);
            const shade = randRange(rng, .8, 1.15);
            boxAll(leafA, tx - rr, tz - rr, tx + rr, tz + rr, h * .55, h + rr * .9,
              [.26 * shade, .48 * shade, .28 * shade], 4, 4);
            this.addSolid(tx - .5, tz - .5, tx + .5, tz + .5, h);
          }
          // a few benches
          for (let t = 0; t < 4; t++) {
            const tx = randRange(rng, x0 + 6, x1 - 6), tz = randRange(rng, z0 + 6, z1 - 6);
            boxAll(propA, tx - 1.2, tz - .35, tx + 1.2, tz + .35, .3, .55, [.4, .3, .22], 2, 1);
          }
          continue;
        }

        if (kind === 'lot') {                                // parking lot / plaza
          topFace(walkA, x0, z0, x1, z1, SIDEWALK_H + 0.01, [.55, .56, .58], 8);
          for (let s = 0; s < 6; s++) {
            const sx = x0 + 5 + s * ((x1 - x0 - 10) / 5);
            topFace(markA, sx - .15, z0 + 4, sx + .15, z0 + 14, SIDEWALK_H + .04, white, 4);
            topFace(markA, sx - .15, z1 - 14, sx + .15, z1 - 4, SIDEWALK_H + .04, white, 4);
          }
          this.spawnRoadPoints.push({ x: cx, z: cz, parked: true });
          continue;
        }

        // subdivide the block into lots
        const cols = randInt(rng, 2, 3), rows = randInt(rng, 2, 3);
        const lw = (x1 - x0) / cols, lh = (z1 - z0) / rows;
        for (let a = 0; a < cols; a++) {
          for (let b = 0; b < rows; b++) {
            if (rng() < 0.06) continue;                       // empty lot
            const m = randRange(rng, 0.8, 2.2);
            const bx0 = x0 + a * lw + m, bx1 = x0 + (a + 1) * lw - m;
            const bz0 = z0 + b * lh + m, bz1 = z0 + (b + 1) * lh - m;
            const style = randInt(rng, 0, 3);
            const A = fa[style];
            const tall = Math.pow(1 - dist, 2.1);
            let h = randRange(rng, 9, 20) + tall * randRange(rng, 20, 82);
            if (rng() < 0.08) h *= 1.5;                       // occasional spike
            // warm stone / cool glass mix so the skyline is not one flat colour
            const warm = rng() < .45;
            const hue = warm ? randRange(rng, .045, .11) : randRange(rng, .53, .62);
            const sat = warm ? randRange(rng, .12, .42) : randRange(rng, .05, .26);
            const lit = randRange(rng, .52, 1.05);
            const tc = new THREE.Color().setHSL(hue, sat, clamp(lit * .5, .1, .85));
            const col = [tc.r * 1.9, tc.g * 1.9, tc.b * 1.9];
            const uo = rng() * 8, vo = 0;

            boxSides(A, bx0, bz0, bx1, bz1, 0, h, col, 4, 3.6, uo, vo);
            topFace(roofA, bx0 - .3, bz0 - .3, bx1 + .3, bz1 + .3, h, [.34, .35, .37], 4);
            boxSides(roofA, bx0 - .3, bz0 - .3, bx1 + .3, bz1 + .3, h - .5, h + .5, [.3, .31, .33], 4, 2);
            this.addSolid(bx0, bz0, bx1, bz1, h);

            // setback tower
            if (h > 34 && rng() < 0.5) {
              const s2 = randRange(rng, .45, .72);
              const w2 = (bx1 - bx0) * s2 / 2, d2 = (bz1 - bz0) * s2 / 2;
              const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
              const h2 = h + randRange(rng, 8, 30);
              boxSides(A, mx - w2, mz - d2, mx + w2, mz + d2, h, h2, col, 4, 3.6, uo, vo);
              topFace(roofA, mx - w2 - .3, mz - d2 - .3, mx + w2 + .3, mz + d2 + .3, h2, [.34, .35, .37], 4);
              // antenna mast + aircraft light
              if (rng() < .5) {
                boxAll(propA, mx - .12, mz - .12, mx + .12, mz + .12, h2, h2 + randRange(rng, 4, 11), [.3, .3, .32], 1, 4);
                this.lamps.push({ x: mx, y: h2 + 10, z: mz, color: 0xff3355, size: 1.3 });
              }
            } else if (rng() < .6) {
              // rooftop clutter
              for (let k = 0; k < randInt(rng, 1, 3); k++) {
                const px = randRange(rng, bx0 + 1, bx1 - 3), pz = randRange(rng, bz0 + 1, bz1 - 3);
                boxAll(propA, px, pz, px + randRange(rng, 1.2, 2.4), pz + randRange(rng, 1.2, 2.4),
                  h, h + randRange(rng, .8, 2.2), [.42, .43, .45], 2, 2);
              }
            }

            // ground-floor shopfront + neon sign facing the street
            const side = randInt(rng, 0, 3);
            const neonCols = [[1, .18, .42], [.22, .88, 1], [.64, .42, 1], [1, .78, .25], [.25, 1, .6]];
            const nc = pick(rng, neonCols);
            const sw = clamp(Math.min(bx1 - bx0, bz1 - bz0) * .3, 1.8, 4.6);
            const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
            const ny0 = randRange(rng, 4.2, 8.5), ny1 = ny0 + randRange(rng, .8, 1.7);
            if (side === 0) neonA.quad(
              [mx - sw, ny0, bz0 - .2], [mx + sw, ny0, bz0 - .2], [mx + sw, ny1, bz0 - .2], [mx - sw, ny1, bz0 - .2],
              0, 0, -1, [0, 0, 1, 0, 1, 1, 0, 1], nc);
            else if (side === 1) neonA.quad(
              [mx + sw, ny0, bz1 + .2], [mx - sw, ny0, bz1 + .2], [mx - sw, ny1, bz1 + .2], [mx + sw, ny1, bz1 + .2],
              0, 0, 1, [0, 0, 1, 0, 1, 1, 0, 1], nc);
            else if (side === 2) neonA.quad(
              [bx0 - .2, ny0, mz - sw], [bx0 - .2, ny0, mz + sw], [bx0 - .2, ny1, mz + sw], [bx0 - .2, ny1, mz - sw],
              -1, 0, 0, [0, 0, 1, 0, 1, 1, 0, 1], nc);
            else neonA.quad(
              [bx1 + .2, ny0, mz + sw], [bx1 + .2, ny0, mz - sw], [bx1 + .2, ny1, mz - sw], [bx1 + .2, ny1, mz + sw],
              1, 0, 0, [0, 0, 1, 0, 1, 1, 0, 1], nc);
            this.lamps.push({ x: mx, y: (ny0 + ny1) / 2, z: mz, color: new THREE.Color(nc[0], nc[1], nc[2]).getHex(), size: sw * 1.5, dim: true });

          }
        }
      }
    }

    this.placeShops();

    // ---- street furniture -------------------------------------------------
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = roadLine(i), z = roadLine(j);
        // traffic light masts on each corner of the intersection
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const px = x + sx * (ROAD / 2 + 1.6), pz = z + sz * (ROAD / 2 + 1.6);
          boxAll(propA, px - .16, pz - .16, px + .16, pz + .16, 0, 5.2, [.22, .23, .25], 1, 4);
          boxAll(propA, px - .32, pz - .32, px + .32, pz + .32, 4.3, 5.2, [.14, .15, .17], 1, 1);
          this.lamps.push({ x: px, y: 4.9, z: pz, color: 0x2fff7a, size: .75 });
        }
      }
      // street lamps along both road axes
      for (let t = -HALF + 12; t <= HALF - 12; t += 26) {
        const c = roadLine(i);
        for (const s of [-1, 1]) {
          const px = c + s * (ROAD / 2 + 1.1);
          boxAll(propA, px - .14, t - .14, px + .14, t + .14, 0, 7.4, [.26, .27, .3], 1, 5);
          boxAll(propA, px - s * 1.6, t - .18, px, t + .18, 7.1, 7.4, [.26, .27, .3], 1, 1);
          this.lamps.push({ x: px - s * 1.4, y: 7.0, z: t, color: 0xffd9a0, size: 1.9, pool: 9 });

          const pz = c + s * (ROAD / 2 + 1.1);
          boxAll(propA, t - .14, pz - .14, t + .14, pz + .14, 0, 7.4, [.26, .27, .3], 1, 5);
          boxAll(propA, t - .18, pz - s * 1.6, t + .18, pz, 7.1, 7.4, [.26, .27, .3], 1, 1);
          this.lamps.push({ x: t, y: 7.0, z: pz - s * 1.4, color: 0xffd9a0, size: 1.9, pool: 9 });
        }
      }
    }

    // ---- distant skyline across the water ---------------------------------
    const farA = new Arrays();
    for (let i = 0; i < 120; i++) {
      const ang = this.rng() * Math.PI * 2, rad = randRange(this.rng, HALF + 160, HALF + 700);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      const w = randRange(this.rng, 14, 46), h = randRange(this.rng, 20, 150);
      boxAll(farA, x - w / 2, z - w / 2, x + w / 2, z + w / 2, -2, h, [.1, .13, .19], 20, 20);
    }

    // ---- materials & meshes ----------------------------------------------
    const add = (arrays, mat, shadow = true) => {
      if (arrays.empty) return null;
      const m = new THREE.Mesh(arrays.geometry(), mat);
      m.castShadow = shadow; m.receiveShadow = shadow;
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.scene.add(m);
      return m;
    };

    this.facadeMats = facades.map(f => new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0, roughness: .72, metalness: .12, vertexColors: true,
      envMapIntensity: .45
    }));
    fa.forEach((A, i) => add(A, this.facadeMats[i]));

    add(roofA, new THREE.MeshStandardMaterial({ map: concreteTex, roughness: .95, vertexColors: true, envMapIntensity: .4 }));
    add(walkA, new THREE.MeshStandardMaterial({ map: concreteTex, roughness: .9, vertexColors: true, envMapIntensity: .4 }));
    add(propA, new THREE.MeshStandardMaterial({ roughness: .7, metalness: .45, vertexColors: true }));
    add(treeA, new THREE.MeshStandardMaterial({ roughness: .95, vertexColors: true }));
    add(leafA, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, flatShading: true }));
    add(grassA, new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, vertexColors: true }));

    const markMat = new THREE.MeshStandardMaterial({ roughness: .8, vertexColors: true });
    const mk = add(markA, markMat, false); if (mk) mk.receiveShadow = true;

    this.neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    add(neonA, this.neonMat, false);

    const far = add(farA, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, fog: true }), false);
    if (far) far.renderOrder = -1;

    this.buildLampGlows();
    this.buildRoadSpawns();
  }

  /** Three fixed storefronts: gun shop, dealership, convenience store. */
  placeShops() {
    const rng = this.rng;
    const built = this.blocks.filter(b => b.kind === 'built');
    const defs = [
      { key: 'gun', label: 'AMMU', sub: '무기상', hex: '#ff2e6a', color: 0xff2e6a },
      { key: 'car', label: 'MOTORS', sub: '차량 대리점', hex: '#38e0ff', color: 0x38e0ff },
      { key: 'store', label: '24H', sub: '편의점', hex: '#3ce08a', color: 0x3ce08a },
    ];
    const glowTex = TX.glow();
    this.shops = [];
    for (const d of defs) {
      let site = null;
      for (let i = 0; i < 80; i++) {
        const b = pick(rng, built);
        const cx = (b.x0 + b.x1) / 2;
        const far = this.shops.every(s => Math.hypot(s.x - cx, s.z - (b.z0 - 4)) > 170);
        if (far) { site = b; break; }
      }
      site = site || pick(rng, built);
      const x = (site.x0 + site.x1) / 2, z = site.z0 - 4.2;

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 2.8),
        new THREE.MeshBasicMaterial({ map: TX.sign(d.label, d.sub, d.hex), transparent: true, toneMapped: false })
      );
      sign.position.set(x, 6.2, site.z0 - 0.35);
      sign.rotation.y = Math.PI;
      this.scene.add(sign);

      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 13),
        new THREE.MeshBasicMaterial({
          map: glowTex, color: d.color, transparent: true, opacity: .34,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.07, z);
      ring.renderOrder = 3;
      this.scene.add(ring);

      this.lamps.push({ x, y: 6.2, z: site.z0 - 0.5, color: d.color, size: 5, dim: true });
      this.shops.push({ key: d.key, x, z, color: d.color, deliver: { x, z: site.z0 - 12 } });
    }
  }

  /** Warm pools of light on the tarmac under each street lamp. */
  buildLightPools(tex) {
    const pos = [], uv = [], idx = [];
    let n = 0;
    for (const l of this.lamps) {
      if (!l.pool) continue;
      const r = l.pool * 0.42, y = 0.06;
      pos.push(l.x - r, y, l.z - r, l.x + r, y, l.z - r, l.x + r, y, l.z + r, l.x - r, y, l.z + r);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      n += 4;
    }
    if (!n) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: tex, color: 0xffcf95, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0, toneMapped: false
    });
    this.pools = new THREE.Mesh(g, this.poolMat);
    this.pools.renderOrder = 2;
    this.pools.matrixAutoUpdate = false;
    this.scene.add(this.pools);
  }

  /** Cheap night lighting: additive sprites instead of hundreds of real lights. */
  buildLampGlows() {
    const tex = TX.glow();
    this.buildLightPools(tex);
    const groups = new Map();
    for (const l of this.lamps) {
      const k = l.color + '|' + (l.dim ? 1 : 0);
      let g = groups.get(k); if (!g) groups.set(k, g = []);
      g.push(l);
    }
    this.glowMeshes = [];
    for (const [k, list] of groups) {
      const color = parseInt(k.split('|')[0], 10);
      const dim = k.endsWith('|1');
      const mat = new THREE.SpriteMaterial({
        map: tex, color, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: dim ? .38 : .6, toneMapped: false
      });
      const g = new THREE.Group();
      for (const l of list) {
        const s = new THREE.Sprite(mat);
        s.position.set(l.x, l.y, l.z);
        s.scale.setScalar(l.size);
        g.add(s);
      }
      this.scene.add(g);
      this.glowMeshes.push({ group: g, mat, dim });
    }
  }

  buildRoadSpawns() {
    // points along every lane, used to spawn traffic and parked cars
    for (let i = 0; i <= N; i++) {
      const c = roadLine(i);
      for (let t = -HALF + 20; t < HALF - 20; t += 30) {
        this.spawnRoadPoints.push({ x: c - LANE, z: t, dir: [0, 1] });
        this.spawnRoadPoints.push({ x: c + LANE, z: t, dir: [0, -1] });
        this.spawnRoadPoints.push({ x: t, z: c + LANE, dir: [1, 0] });
        this.spawnRoadPoints.push({ x: t, z: c - LANE, dir: [-1, 0] });
      }
    }
  }

  /** Rain makes the tarmac glossy so the city lights smear across it. */
  setWet(w) {
    if (!this.groundMat) return;
    this.groundMat.roughness = lerpN(.95, .34, w);
    this.groundMat.metalness = lerpN(.02, .45, w);
  }

  /** Night factor 0..1 drives window lights, neon and lamp glows. */
  setNight(n) {
    for (const m of this.facadeMats) m.emissiveIntensity = n * 1.35;
    if (this.neonMat) this.neonMat.opacity = 1;
    if (this.poolMat) {
      this.poolMat.opacity = n * 0.28;
      this.pools.visible = n > 0.05;
    }
    for (const g of this.glowMeshes) {
      g.mat.opacity = (g.dim ? .4 : .62) * Math.max(0.06, n);
      g.group.visible = n > 0.04;
    }
    if (this.water) this.water.material.color.setHex(n > .5 ? 0x060f1a : 0x0b2033);
  }

  /** Push a circle of radius r out of every solid it overlaps. Returns true if moved. */
  resolveCircle(pos, r, maxHeight = 1.2) {
    let hit = false;
    for (const s of this.near(pos.x, pos.z, r + 1)) {
      if (s.h < maxHeight) continue;
      const cx = clamp(pos.x, s.x0, s.x1), cz = clamp(pos.z, s.z0, s.z1);
      let dx = pos.x - cx, dz = pos.z - cz;
      let d = Math.hypot(dx, dz);
      if (d > r) continue;
      hit = true;
      if (d < 1e-4) {
        // centre is inside: push out through the nearest face
        const dl = pos.x - s.x0, dr = s.x1 - pos.x, db = pos.z - s.z0, df = s.z1 - pos.z;
        const m = Math.min(dl, dr, db, df);
        if (m === dl) pos.x = s.x0 - r; else if (m === dr) pos.x = s.x1 + r;
        else if (m === db) pos.z = s.z0 - r; else pos.z = s.z1 + r;
      } else {
        dx /= d; dz /= d;
        pos.x = cx + dx * r; pos.z = cz + dz * r;
      }
    }
    // keep everyone inside the sea wall
    const lim = HALF + 10;
    pos.x = clamp(pos.x, -lim, lim); pos.z = clamp(pos.z, -lim, lim);
    return hit;
  }

  randomRoadPoint(rng) {
    if (!this._lanePts) this._lanePts = this.spawnRoadPoints.filter(p => p.dir);
    return pick(rng, this._lanePts);
  }
}
