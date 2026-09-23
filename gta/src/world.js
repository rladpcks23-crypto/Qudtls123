'use strict';
/* =====================================================================
 * world.js — 절차적 도시 생성 + 공간 질의
 *
 * 참고: Parish & Müller, "Procedural Modeling of Cities" (SIGGRAPH 2001)
 *   - 도로망을 먼저 만들고 → 도로로 둘러싸인 블록 → 블록을 필지(lot)로 분할 →
 *     필지마다 구역(district) 규칙에 맞는 건물을 세우는 파이프라인을 단순화해 사용.
 *   - 격자 도로에서 일부 구간을 제거해 슈퍼블록/T자 교차로를 만들어 단조로움을 줄인다.
 * 시야/탄도 판정: Amanatides & Woo, "A Fast Voxel Traversal Algorithm" (1987) 의 DDA.
 * ===================================================================== */

const T = 4;               // 타일 한 칸 = 4m (차선 폭)
const MW = 480, MH = 480;  // 타일 수 → 1920m × 1920m 도시 (v2.5에서 190 → 480 확장; 3D는 청크 단위로 스트리밍)
const TL = { WATER: 0, ROAD: 1, WALK: 2, BUILD: 3, GRASS: 4, SAND: 5, LOT: 6, PLAZA: 7, DOCK: 8, RUNWAY: 9 };
const DIST = { DOWNTOWN: 0, MIDTOWN: 1, RESID: 2, HARBOR: 3, BEACH: 4, PARK: 5, COAST: 6, BASE: 7, INDUSTRY: 8 };
const DIST_NAMES = ['다운타운', '미드타운', '웨스트 힐즈', '하버 포인트', '선셋 비치', '센트럴 파크', '해안 산책로', '포트 네온 기지', '아이언 밸리'];
// 동네: 이름 · 구역 종류 · 씨앗 위치(맵 비율) · w(작을수록 넓게 퍼짐)
const HOODS = [
  { name: '다운타운', d: 0, u: 0.52, v: 0.5, w: 0.8 },
  { name: '미드타운', d: 1, u: 0.4, v: 0.36 }, { name: '노스 게이트', d: 1, u: 0.55, v: 0.2 }, { name: '유니언 스퀘어', d: 1, u: 0.66, v: 0.4 },
  { name: '올드 타운', d: 1, u: 0.42, v: 0.64 }, { name: '리버사이드', d: 1, u: 0.66, v: 0.66 },
  { name: '웨스트 힐즈', d: 2, u: 0.1, v: 0.3 }, { name: '파인 크레스트', d: 2, u: 0.28, v: 0.16 }, { name: '레이크뷰', d: 2, u: 0.8, v: 0.16 }, { name: '로즈우드', d: 2, u: 0.14, v: 0.5 },
  { name: '하버 포인트', d: 3, u: 0.93, v: 0.4 }, { name: '터미널 아일랜드', d: 3, u: 0.93, v: 0.68 },
  { name: '선셋 비치', d: 4, u: 0.5, v: 0.95 }, { name: '코랄 베이', d: 4, u: 0.8, v: 0.94 }, { name: '팜 쇼어', d: 4, u: 0.2, v: 0.95 },
  { name: '아이언 밸리', d: 8, u: 0.18, v: 0.7 }, { name: '러스트 야드', d: 8, u: 0.34, v: 0.8 },
];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 동 남 서 북 (화면 좌표, y 아래로)
const rightOf = d => [-DIRS[d][1], DIRS[d][0]];   // 우측통행: 진행 방향의 오른쪽 차선
const LIGHT_CYCLE = 23;

const World = {
  tiles: null, roadK: null, region: null, dist: null,
  VX: [], HY: [], NX: 0, NY: 0, nodes: [], blocks: [], buildings: [], trees: [], lamps: [],
  parking: [], places: {}, edgesList: [], mini: null, bIndex: null,
};

const tIdx = (tx, ty) => tx + ty * MW;
function tileAt(x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return TL.WATER;
  return World.tiles[tx + ty * MW];
}
// 사람이 헤엄칠 수 있는 판정(물은 막히지 않음) · 보트 판정(물이 아닌 곳은 전부 막힘)
function solidNoWater(tx, ty) { if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return true; return World.tiles[tx + ty * MW] === TL.BUILD; }
function solidBoat(tx, ty) { if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false; return World.tiles[tx + ty * MW] !== TL.WATER; }
function solidTile(tx, ty) { return solidT(tx, ty); }
function solidT(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return true;
  const t = World.tiles[tx + ty * MW];
  return t === TL.WATER || t === TL.BUILD;
}
function blocksSight(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return true;
  return World.tiles[tx + ty * MW] === TL.BUILD;
}
// 현재 위치의 동네 이름 (블록 밖이면 구역 이름)
function hoodAt(x, y) {
  const tx = clamp(Math.floor(x / T), 0, MW - 1), ty = clamp(Math.floor(y / T), 0, MH - 1), i = tx + ty * MW;
  const b = World.region[i] >= 0 ? World.blocks[World.region[i]] : null;
  if (b && b.park) return b.park;
  if (World.dist[i] === DIST.PARK) return '공원';
  const h = World.hoodT ? World.hoodT[i] : 255;
  return h < 255 ? World.hoods[h].name : DIST_NAMES[World.dist[i]];
}
function districtAt(x, y) {
  const tx = clamp(Math.floor(x / T), 0, MW - 1), ty = clamp(Math.floor(y / T), 0, MH - 1);
  return World.dist[tx + ty * MW];
}

// DDA 광선 추적: 건물 타일에 닿기까지의 거리(없으면 maxD)
function rayWall(x0, y0, dx, dy, maxD) {
  let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
  if (blocksSight(tx, ty)) return 0;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(T / dx) : 1e9, tDY = dy !== 0 ? Math.abs(T / dy) : 1e9;
  let tMX = dx !== 0 ? (dx > 0 ? ((tx + 1) * T - x0) / dx : (tx * T - x0) / dx) : 1e9;
  let tMY = dy !== 0 ? (dy > 0 ? ((ty + 1) * T - y0) / dy : (ty * T - y0) / dy) : 1e9;
  let t = 0;
  while (t < maxD) {
    if (tMX < tMY) { t = tMX; tMX += tDX; tx += stepX; }
    else { t = tMY; tMY += tDY; ty += stepY; }
    if (t >= maxD) break;
    if (blocksSight(tx, ty)) return t;
  }
  return maxD;
}
function losClear(x0, y0, x1, y1) {
  const d = dist(x0, y0, x1, y1);
  if (d < 0.01) return true;
  return rayWall(x0, y0, (x1 - x0) / d, (y1 - y0) / d, d) >= d - 0.01;
}

// ---------------------------------------------------------------------
function genWorld(seed) {
  const R = mulberry32(seed);
  const rr = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1));
  const rpick = a => a[Math.floor(R() * a.length)];
  const W = World;
  W.tiles = new Uint8Array(MW * MH).fill(TL.GRASS);
  W.roadK = new Uint8Array(MW * MH);   // 1 세로도로 2 가로도로 3 교차로
  W.region = new Int16Array(MW * MH).fill(-1);
  W.dist = new Uint8Array(MW * MH).fill(DIST.COAST);
  W.bIndex = new Int16Array(MW * MH).fill(-1);
  W.blocks = []; W.buildings = []; W.trees = []; W.lamps = []; W.parking = []; W.places = {};
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MW && y < MH) W.tiles[x + y * MW] = t; };
  const get = (x, y) => (x >= 0 && y >= 0 && x < MW && y < MH) ? W.tiles[x + y * MW] : TL.WATER;

  // 1) 바다 경계
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (x < 3 || y < 3 || x >= MW - 15 || y >= MH - 11) set(x, y, TL.WATER); // 동·남쪽은 보트가 다닐 만큼 넓은 바다

  // 2) 도로선 (블록 폭 9~14타일, 도로 2타일)
  W.VX = []; W.HY = [];
  for (let x = 7; x + 2 <= MW - 17; x += 2 + ri(9, 14)) W.VX.push(x);
  for (let y = 34; y + 2 <= MH - 19; y += 2 + ri(9, 14)) W.HY.push(y); // 북쪽 y<32는 군사 기지
  const NX = W.NX = W.VX.length, NY = W.NY = W.HY.length;

  // 3) 도로 그래프: 모든 구간으로 시작 → 일부 제거(슈퍼블록)
  const hE = [], vE = [];
  for (let i = 0; i < NX; i++) { hE.push([]); vE.push([]); for (let j = 0; j < NY; j++) { hE[i].push(i < NX - 1); vE[i].push(j < NY - 1); } }
  const deg = (i, j) => (i > 0 && hE[i - 1][j] ? 1 : 0) + (hE[i][j] ? 1 : 0) + (j > 0 && vE[i][j - 1] ? 1 : 0) + (vE[i][j] ? 1 : 0);
  const touched = new Set();
  const cands = [];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (i < NX - 1 && j > 0 && j < NY - 1) cands.push(['h', i, j]);
    if (j < NY - 1 && i > 0 && i < NX - 1) cands.push(['v', i, j]);
  }
  for (let k = cands.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [cands[k], cands[m]] = [cands[m], cands[k]]; }
  for (const [t, i, j] of cands) {
    const a = `${i},${j}`, b = t === 'h' ? `${i + 1},${j}` : `${i},${j + 1}`;
    if (touched.has(a) || touched.has(b)) continue;
    const u = (W.VX[i] + 1) / MW, v = (W.HY[j] + 1) / MH;
    if (Math.hypot(u - 0.52, v - 0.52) < 0.16) continue; // 다운타운은 촘촘한 격자 유지
    if (R() > 0.2) continue;
    const bi = t === 'h' ? i + 1 : i, bj = t === 'h' ? j : j + 1;
    if (deg(i, j) - 1 < 2 || deg(bi, bj) - 1 < 2) continue;
    if (t === 'h') hE[i][j] = false; else vE[i][j] = false;
    touched.add(a); touched.add(b);
  }

  // 노드
  W.nodes = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const n = { id: W.nodes.length, i, j, x: (W.VX[i] + 1) * T, y: (W.HY[j] + 1) * T, adj: [-1, -1, -1, -1], light: null };
    W.nodes.push(n);
  }
  const nid = (i, j) => i + j * NX;
  W.edgesList = [];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (hE[i][j]) { W.nodes[nid(i, j)].adj[0] = nid(i + 1, j); W.nodes[nid(i + 1, j)].adj[2] = nid(i, j); W.edgesList.push([nid(i, j), nid(i + 1, j)]); }
    if (vE[i][j]) { W.nodes[nid(i, j)].adj[1] = nid(i, j + 1); W.nodes[nid(i, j + 1)].adj[3] = nid(i, j); W.edgesList.push([nid(i, j), nid(i, j + 1)]); }
  }
  for (const n of W.nodes) {
    const d = n.adj.filter(a => a >= 0).length;
    if (d >= 3) n.light = { off: rr(0, LIGHT_CYCLE) };
    n.deg = d;
  }

  // 4) 도로 칠하기
  const paintRoad = (x, y, k) => { set(x, y, TL.ROAD); W.roadK[x + y * MW] = k; };
  for (const n of W.nodes) { const x = W.VX[n.i], y = W.HY[n.j]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) paintRoad(x + a, y + b, 3); }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (hE[i][j]) for (let x = W.VX[i] + 2; x < W.VX[i + 1]; x++) { paintRoad(x, W.HY[j], 2); paintRoad(x, W.HY[j] + 1, 2); }
    if (vE[i][j]) for (let y = W.HY[j] + 2; y < W.HY[j + 1]; y++) { paintRoad(W.VX[i], y, 1); paintRoad(W.VX[i] + 1, y, 1); }
  }

  // 5) 블록 찾기 (순환도로 내부의 비도로 영역을 flood fill)
  const bx0 = W.VX[0] + 2, bx1 = W.VX[NX - 1] - 1, by0 = W.HY[0] + 2, by1 = W.HY[NY - 1] - 1;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    if (get(x, y) === TL.ROAD || W.region[tIdx(x, y)] >= 0) continue;
    const id = W.blocks.length, stack = [[x, y]];
    let x0 = x, y0 = y, x1 = x, y1 = y;
    W.region[tIdx(x, y)] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
        if (get(nx, ny) === TL.ROAD || W.region[tIdx(nx, ny)] >= 0) continue;
        W.region[tIdx(nx, ny)] = id; stack.push([nx, ny]);
      }
    }
    W.blocks.push({ id, x0, y0, x1, y1 });
  }

  // 구역 배정: 동네(hood) 씨앗점에 가장 가까운 블록끼리 묶는다(보로노이 + 약간의 흔들림) → 큰 맵에서도 동네가 다양하다
  W.hoods = HOODS.map(h => ({ ...h, sx: 0, sy: 0, n: 0 }));
  for (const b of W.blocks) {
    const u = (b.x0 + b.x1) / 2 / MW, v = (b.y0 + b.y1) / 2 / MH;
    let best = 0, bd = 1e9;
    W.hoods.forEach((h, i) => { const d = Math.hypot(u - h.u, v - h.v) * (1 + 0.35 * (hash2(b.x0 * 3 + i, b.y0 * 7) - 0.5)) * (h.w || 1); if (d < bd) { bd = d; best = i; } });
    if (Math.hypot(u - 0.52, v - 0.5) < 0.09) best = 0; // 도심 한가운데는 항상 다운타운
    b.hood = best; b.district = W.hoods[best].d;
    b.area = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  }
  // 공원: 가장 큰 미드타운/주택가 블록(센트럴 파크) + 동네 공원 몇 개
  const parkC = W.blocks.filter(b => b.district === DIST.MIDTOWN || b.district === DIST.RESID).sort((a, b) => b.area - a.area);
  // 센트럴 파크: 다운타운 북쪽의 블록 여러 개를 통째로 공원으로 (사이 도로는 공원 산책 도로가 된다)
  for (const b of W.blocks) if (Math.hypot((b.x0 + b.x1) / 2 / MW - 0.47, (b.y0 + b.y1) / 2 / MH - 0.29) < 0.065) { b.district = DIST.PARK; b.park = '센트럴 파크'; }
  if (!W.blocks.some(b => b.park) && parkC[0]) { parkC[0].district = DIST.PARK; parkC[0].park = '센트럴 파크'; }
  const extra = parkC.slice(3).filter(b => b.area > 60 && b.district !== DIST.PARK);
  for (let k = 0; k < Math.round(MW * MH / 12000) && extra.length; k++) { const b = extra.splice(Math.floor(R() * extra.length), 1)[0]; b.district = DIST.PARK; }
  W.hoodT = new Uint8Array(MW * MH).fill(255);

  const addTree = (x, y, kind) => W.trees.push({ x, y, kind, r: kind === 'palm' ? 2.2 : rr(1.9, 2.8), h: kind === 'palm' ? rr(7, 9) : rr(5, 8), hue: R() });
  const addBuilding = (x0, y0, x1, y1, h, kind, color) => {
    const b = { id: W.buildings.length, x0, y0, x1, y1, h, kind, color, seed: R(), lit: R() };
    W.buildings.push(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { set(x, y, TL.BUILD); W.bIndex[tIdx(x, y)] = b.id; }
    return b;
  };
  const addParkingRow = (x0, y0, x1, y1) => {
    // LOT 영역 안에 주차칸(차 머리는 남/북)
    const w = x1 - x0 + 1;
    if (w < 2) return;
    for (let x = x0 * T + 1.6; x + 1.6 <= (x1 + 1) * T; x += 3.2) {
      W.parking.push({ x, y: y0 * T + T * 0.5 + 0.6, a: -Math.PI / 2, car: null, cd: 0 });
      if (y1 - y0 >= 2) W.parking.push({ x, y: (y1 + 1) * T - T * 0.5 - 0.6, a: Math.PI / 2, car: null, cd: 0 });
    }
  };
  const subdivide = (x0, y0, x1, y1, minS, maxS, out) => {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if ((w > maxS && w >= minS * 2) || (h > maxS && h >= minS * 2)) {
      if (w >= h && w >= minS * 2) { const s = x0 + ri(minS, w - minS) - 1; subdivide(x0, y0, s, y1, minS, maxS, out); subdivide(s + 1, y0, x1, y1, minS, maxS, out); return; }
      if (h >= minS * 2) { const s = y0 + ri(minS, h - minS) - 1; subdivide(x0, y0, x1, s, minS, maxS, out); subdivide(x0, s + 1, x1, y1, minS, maxS, out); return; }
    }
    out.push({ x0, y0, x1, y1 });
  };
  const PAL = {
    tower: ['#5b6b82', '#44546b', '#6f7a8c', '#3e4a5e', '#7a6f8c', '#51677a', '#8a8f99', '#2f3d52'],
    mid: ['#9a7b63', '#7d8a70', '#a38e70', '#8b6f6a', '#6f7f8f', '#b09a7c', '#826b5a'],
    house: ['#c65d4a', '#9c5a3c', '#5e6f86', '#7b8c5a', '#a8744f', '#6b5b7b', '#b8864e'],
    ware: ['#7a7f86', '#8a8074', '#6d7a73', '#908c83'],
    beach: ['#e0a96d', '#6cc0c4', '#e7d8b0', '#d47a6a', '#8fc1a0'],
    cont: ['#b03a2e', '#1f6f9b', '#c8871f', '#2f7d4a', '#7a3b8f', '#5a6570'],
    factory: ['#8b5a44', '#7a7266', '#6e6a5f', '#96806a', '#5f6b72'],
  };

  for (const b of W.blocks) {
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      W.dist[tIdx(x, y)] = b.district; W.hoodT[tIdx(x, y)] = b.hood;
      set(x, y, (x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1) ? TL.WALK : TL.GRASS);
    }
    b.loop = { x0: (b.x0 + 0.5) * T, y0: (b.y0 + 0.5) * T, x1: (b.x1 + 0.5) * T, y1: (b.y1 + 0.5) * T };
    b.loop.w = b.loop.x1 - b.loop.x0; b.loop.h = b.loop.y1 - b.loop.y0; b.loop.P = 2 * (b.loop.w + b.loop.h);
    const ix0 = b.x0 + 1, iy0 = b.y0 + 1, ix1 = b.x1 - 1, iy1 = b.y1 - 1;
    b.lots = [];
    if (ix1 < ix0 || iy1 < iy0) continue;
    if (b.district === DIST.PARK) {
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) set(x, y, TL.GRASS);
      const mx = Math.floor((ix0 + ix1) / 2), my = Math.floor((iy0 + iy1) / 2);
      for (let x = ix0; x <= ix1; x++) set(x, my, TL.PLAZA);
      for (let y = iy0; y <= iy1; y++) set(mx, y, TL.PLAZA);
      // 연못
      const pcx = (ix0 + mx) / 2, pcy = (iy0 + my) / 2, prx = (mx - ix0) / 2 - 0.8, pry = (my - iy0) / 2 - 0.8;
      if (prx > 1 && pry > 1) for (let y = iy0; y < my; y++) for (let x = ix0; x < mx; x++) if (((x + 0.5 - pcx) / prx) ** 2 + ((y + 0.5 - pcy) / pry) ** 2 < 1) set(x, y, TL.WATER);
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
        if (get(x, y) !== TL.GRASS) continue;
        const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === TL.WATER || get(x + dx, y + dy) === TL.PLAZA);
        if (!nearWater && R() < 0.33) addTree((x + rr(0.25, 0.75)) * T, (y + rr(0.25, 0.75)) * T, 'tree');
      }
      b.lots.push({ x0: ix0, y0: iy0, x1: ix1, y1: iy1, park: true });
      continue;
    }
    const lotSize = { [DIST.DOWNTOWN]: [3, 6], [DIST.MIDTOWN]: [3, 5], [DIST.RESID]: [4, 5], [DIST.HARBOR]: [5, 9], [DIST.BEACH]: [4, 6], [DIST.INDUSTRY]: [5, 8] }[b.district];
    const lots = [];
    subdivide(ix0, iy0, ix1, iy1, lotSize[0], lotSize[1], lots);
    for (const L of lots) {
      L.edge = L.x0 === ix0 || L.x1 === ix1 || L.y0 === iy0 || L.y1 === iy1;
      L.block = b;
      b.lots.push(L);
      const w = L.x1 - L.x0 + 1, h = L.y1 - L.y0 + 1;
      const cx = (L.x0 + L.x1 + 1) / 2 / MW, cy = (L.y0 + L.y1 + 1) / 2 / MH;
      if (b.district === DIST.DOWNTOWN) {
        if (R() < 0.12) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.PLAZA); L.kind = 'plaza'; if (w >= 3 && h >= 3) addTree((L.x0 + w / 2) * T, (L.y0 + h / 2) * T, 'tree'); continue; }
        const core = 1 - clamp(Math.hypot(cx - 0.52, cy - 0.52) / 0.17, 0, 1);
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(18, 30) + core * rr(10, 32), 'tower', rpick(PAL.tower));
      } else if (b.district === DIST.MIDTOWN) {
        if (R() < 0.25 && w >= 2 && h >= 3) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.LOT); L.kind = 'lot'; addParkingRow(L.x0, L.y0, L.x1, L.y1); continue; }
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(9, 22), 'mid', rpick(PAL.mid));
      } else if (b.district === DIST.RESID && R() < 0.35) { // 주택가 속 동네 가게(상가)
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(6, 11), 'mid', rpick(PAL.mid));
      } else if (b.district === DIST.RESID) {
        const x0 = L.x0 + (w > 3 ? 1 : 0), y0 = L.y0 + (h > 3 ? 1 : 0), x1 = L.x1 - (w > 4 ? 1 : 0), y1 = L.y1 - (h > 4 ? 1 : 0);
        L.b = addBuilding(x0, y0, x1, y1, rr(5, 8), 'house', rpick(PAL.house));
        for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) if (get(x, y) === TL.GRASS && R() < 0.12) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
      } else if (b.district === DIST.HARBOR) {
        if (R() < 0.4) {
          for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.DOCK);
          L.kind = 'yard';
          for (let y = L.y0; y + 1 <= L.y1; y += 3) for (let x = L.x0; x <= L.x1; x += 2) if (R() < 0.55) addBuilding(x, y, x, Math.min(y + 1, L.y1), 2.6 * ri(1, 2), 'container', rpick(PAL.cont));
          continue;
        }
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(7, 12), 'warehouse', rpick(PAL.ware));
      } else if (b.district === DIST.INDUSTRY) { // 아이언 밸리 산업단지: 큰 공장, 야적장, 굴뚝
        if (R() < 0.28 && w >= 2 && h >= 3) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.LOT); L.kind = 'lot'; addParkingRow(L.x0, L.y0, L.x1, L.y1); continue; }
        if (R() < 0.2) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.DOCK); L.kind = 'yard'; for (let y = L.y0; y + 1 <= L.y1; y += 3) for (let x = L.x0; x <= L.x1; x += 2) if (R() < 0.5) addBuilding(x, y, x, Math.min(y + 1, L.y1), 2.6, 'container', rpick(PAL.cont)); continue; }
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(8, 15), 'warehouse', rpick(PAL.factory));
      } else { // BEACH
        if (R() < 0.3) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.LOT); L.kind = 'lot'; addParkingRow(L.x0, L.y0, L.x1, L.y1); continue; }
        for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.SAND);
        const x0 = L.x0 + (w > 3 ? 1 : 0), y0 = L.y0, x1 = L.x1, y1 = L.y1 - (h > 3 ? 1 : 0);
        L.b = addBuilding(x0, y0, x1, y1, rr(4, 9), 'shop', rpick(PAL.beach));
        if (R() < 0.6) addTree((L.x0 + 0.5) * T, (L.y1 + 0.5) * T, 'palm');
      }
    }
  }

  // 6) 순환도로 바깥: 동쪽 부두, 남쪽 해변, 서/북 해안 산책로
  const lastX = W.VX[NX - 1] + 1, lastY = W.HY[NY - 1] + 1, firstX = W.VX[0], firstY = W.HY[0];
  for (let y = 3; y < MH - 4; y++) for (let x = 3; x < MW - 4; x++) {
    const t = get(x, y);
    if (t === TL.ROAD || t === TL.WATER || W.region[tIdx(x, y)] >= 0) continue;
    const adjRoad = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => get(x + dx, y + dy) === TL.ROAD);
    if (x > lastX) {
      W.dist[tIdx(x, y)] = DIST.HARBOR;
      set(x, y, adjRoad ? TL.WALK : TL.DOCK);
    } else if (y > lastY) {
      W.dist[tIdx(x, y)] = DIST.BEACH;
      set(x, y, adjRoad ? TL.WALK : (y <= lastY + 3 ? TL.PLAZA : TL.SAND));
    } else {
      W.dist[tIdx(x, y)] = DIST.COAST;
      set(x, y, adjRoad ? TL.WALK : TL.GRASS);
    }
  }
  // 마리나: 부두·해변에 붙은 바다 칸 (보트가 세워지는 곳)
  W.marinas = [];
  const coastOK = (x, y) => get(x, y) === TL.WATER && get(x + 1, y) === TL.WATER && get(x, y + 1) === TL.WATER && get(x - 1, y) === TL.WATER;
  for (let y = W.HY[1]; y < MH - 16; y += 22) { const x = MW - 14; if (coastOK(x + 1, y) && get(x - 1, y) !== TL.WATER) W.marinas.push({ x: (x + 1.5) * T, y: (y + 0.5) * T, a: Math.PI / 2, car: null, cd: 0 }); }
  for (let x = 20; x < MW - 30; x += 30) { const y = MH - 10; if (coastOK(x, y + 1)) W.marinas.push({ x: (x + 0.5) * T, y: (y + 1.5) * T, a: 0, car: null, cd: 0 }); }
  // 부두: 컨테이너 줄 + 창고 몇 동
  for (let y = W.HY[0]; y < lastY - 2; y += 4) {
    for (let x = lastX + 3; x < MW - 7; x += 2) if (R() < 0.5 && get(x, y) === TL.DOCK && get(x, y + 1) === TL.DOCK) addBuilding(x, y, x, y + 1, 2.6 * ri(1, 3), 'container', rpick(PAL.cont));
  }
  // 해변 야자수 & 해안 나무
  for (let x = 6; x < MW - 6; x += 1) {
    if (R() < 0.18 && get(x, lastY + 2) === TL.PLAZA) addTree((x + 0.5) * T, (lastY + 2.5) * T, 'palm');
    if (R() < 0.08 && get(x, lastY + 7) === TL.SAND) addTree((x + 0.5) * T, (lastY + 7.5) * T, 'palm');
  }
  for (let y = 4; y < MH - 4; y++) for (let x = 4; x < MW - 4; x++) {
    if (W.dist[tIdx(x, y)] === DIST.COAST && get(x, y) === TL.GRASS && R() < 0.1) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
  }

  // 6-2) 포트 네온 군사 기지 (GTA V의 포트 잔쿠도처럼 들어가면 ★★★★)
  {
    const X0 = 6, X1 = Math.min(MW - 7, 183), Y0 = 5, Y1 = 30; // 기지는 북서쪽 (맵이 커져도 크기 고정)
    let gx = W.VX[0]; for (const x of W.VX) if (Math.abs(x - 64) < Math.abs(gx - 64)) gx = x; // 정문 = 가운데쯤 세로 도로의 연장선
    W.trees = W.trees.filter(t => !(t.x >= (X0 - 1) * T && t.x <= (X1 + 2) * T && t.y <= (Y1 + 1) * T));
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { set(x, y, (x + y) % 11 === 0 && y > 26 ? TL.GRASS : TL.DOCK); W.dist[tIdx(x, y)] = DIST.BASE; }
    for (let y = Y0 + 4; y <= Y0 + 8; y++) for (let x = X0 + 6; x <= X1 - 6; x++) set(x, y, TL.RUNWAY);   // 활주로 (약 500m)
    for (let y = Y0 + 9; y <= Y0 + 12; y++) for (let x = X0 + 14; x <= X1 - 20; x++) set(x, y, TL.LOT);  // 계류장
    for (let y = Y0 + 12; y <= Y1 + 3; y++) for (let x = gx; x <= gx + 1; x++) set(x, y, TL.LOT);       // 정문 진입로
    for (let y = Y1 + 1; y <= Y1 + 3; y++) for (let x = gx; x <= gx + 1; x++) { set(x, y, TL.ROAD); W.roadK[tIdx(x, y)] = 1; }
    const clear = (x0, x1) => x1 < gx - 1 || x0 > gx + 2;
    const wall = (x0, y0, x1, y1) => addBuilding(x0, y0, x1, y1, 2.8, 'fence', '#6b6f63');
    wall(X0, Y0, X1, Y0); wall(X0, Y0 + 1, X0, Y1); wall(X1, Y0 + 1, X1, Y1);
    wall(X0 + 1, Y1, gx - 1, Y1); wall(gx + 2, Y1, X1 - 1, Y1);
    const W_ = [];
    const bld = (x0, y0, x1, y1, h, kind, col) => { if (clear(x0, x1)) W_.push(addBuilding(x0, y0, x1, y1, h, kind, col)); };
    for (const hx of [X0 + 12, X0 + 24, X0 + 36]) bld(hx, Y0 + 14, hx + 8, Y0 + 20, 11, 'hangar', '#5f6b4f');
    bld(gx + 5, Y0 + 14, gx + 6, Y0 + 15, 26, 'ctower', '#8a8f82');
    bld(gx + 10, Y0 + 17, gx + 18, Y0 + 21, 7, 'barracks', '#6d7358');
    bld(gx - 13, Y0 + 22, gx - 5, Y0 + 24, 6, 'barracks', '#6d7358');
    for (const [x, y] of [[X0 + 1, Y0 + 1], [X1 - 1, Y0 + 1], [X0 + 1, Y1 - 1], [X1 - 1, Y1 - 1]]) addBuilding(x, y, x, y, 9, 'watchtower', '#7a6a4a');
    // 헬기 착륙장 두 곳 + 전차 주차장
    W.helipads = [];
    const hpX = X1 - 38;
    for (const k of [0, 1]) { const cx = hpX + k * 8; for (let y = Y0 + 14; y <= Y0 + 19; y++) for (let x = cx; x <= cx + 5; x++) set(x, y, TL.LOT); W.helipads.push({ x: (cx + 3) * T, y: (Y0 + 17) * T }); }
    for (let y = Y0 + 21; y <= Y1 - 2; y++) for (let x = X1 - 24; x <= X1 - 3; x++) set(x, y, TL.LOT);
    W.base = { rx0: (X0 + 6) * T, rx1: (X1 - 6) * T, x0: (X0 + 1) * T, y0: (Y0 + 1) * T, x1: X1 * T, y1: Y1 * T, gate: { x: (gx + 1) * T, y: (Y1 + 0.5) * T },
      spots: {
        tanks: [{ x: (X1 - 20) * T, y: (Y1 - 5) * T, a: -Math.PI / 2 }, { x: (X1 - 12) * T, y: (Y1 - 5) * T, a: -Math.PI / 2 }],
        helis: W.helipads.map(h => ({ x: h.x, y: h.y, a: 0 })),
        jets: [{ x: (X0 + 10) * T, y: (Y0 + 5) * T + 1, a: 0 }, { x: (X0 + 10) * T, y: (Y0 + 8) * T, a: 0 }], // 활주로 서쪽 끝, 동쪽을 향해
      },
      guards: [{ x: (gx - 1) * T, y: (Y1 - 2) * T }, { x: (gx + 3) * T, y: (Y1 - 2) * T }, { x: (X0 + 20) * T, y: (Y0 + 23) * T }, { x: (gx + 14) * T, y: (Y0 + 23) * T }, { x: (X1 - 30) * T, y: (Y0 + 20) * T }, { x: (X1 - 14) * T, y: (Y1 - 3) * T }, { x: (X0 + 60) * T, y: (Y0 + 12) * T }, { x: (X0 + 90) * T, y: (Y0 + 12) * T }],
    };
  }

  // 기지 정문 앞 인도: 국방 후원 창구
  {
    const gt = W.base.gate, tx0 = Math.floor(gt.x / T) + 3, ty0 = Math.floor(gt.y / T) + 3;
    let spot = null;
    for (let r = 0; r < 14 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) { if (get(tx0 + dx, ty0 + dy) === TL.WALK) { spot = { x: (tx0 + dx + 0.5) * T, y: (ty0 + dy + 0.5) * T }; break; } }
    if (spot) W.places.milgate = { ...spot, label: '기지 정문 (국방 후원)' };
  }
  // 7) 특수 장소
  const edgeLots = (d, pred) => W.blocks.filter(b => b.district === d).flatMap(b => b.lots.filter(L => L.edge && !L.used && pred(L)));
  const doorOf = (L) => {
    // 필지와 맞닿은 인도 칸의 중심
    const b = L.block;
    const mx = Math.floor((L.x0 + L.x1) / 2), my = Math.floor((L.y0 + L.y1) / 2);
    if (L.y1 === b.y1 - 1) return { x: (mx + 0.5) * T, y: (b.y1 + 0.5) * T, face: 1 };
    if (L.y0 === b.y0 + 1) return { x: (mx + 0.5) * T, y: (b.y0 + 0.5) * T, face: 3 };
    if (L.x0 === b.x0 + 1) return { x: (b.x0 + 0.5) * T, y: (my + 0.5) * T, face: 2 };
    return { x: (b.x1 + 0.5) * T, y: (my + 0.5) * T, face: 0 };
  };
  const centerish = (L, u, v) => Math.hypot((L.x0 + L.x1) / 2 / MW - u, (L.y0 + L.y1) / 2 / MH - v);
  const choose = (list, u, v) => list.sort((a, b) => centerish(a, u, v) - centerish(b, u, v))[0];
  const makePlace = (key, L, kind, color, label) => {
    if (!L) return;
    L.used = true;
    if (L.b) { L.b.kind = kind; L.b.color = color; L.b.label = label; L.b.h = Math.max(L.b.h, kind === 'police' ? 16 : 12); }
    W.places[key] = { ...doorOf(L), lot: L, label };
  };
  makePlace('hospital', choose(edgeLots(DIST.MIDTOWN, L => L.b && L.b.kind === 'mid'), 0.42, 0.3), 'hospital', '#e9ecef', '병원');
  makePlace('police', choose(edgeLots(DIST.DOWNTOWN, L => L.b && L.b.kind === 'tower'), 0.46, 0.5), 'police', '#2c3e66', '경찰서');
  makePlace('ammu', choose(edgeLots(DIST.MIDTOWN, L => L.b && L.b.kind === 'mid'), 0.6, 0.62), 'ammu', '#3b3b3b', '총포상');
  const hosp2 = choose(edgeLots(DIST.RESID, L => L.b && L.b.kind === 'house'), 0.2, 0.7);
  if (hosp2) makePlace('clinic', hosp2, 'hospital', '#e9ecef', '의원');
  // 상점: 총포상 2호점, 버거 가게 2곳, 편의점 3곳 / 직업 게시판: 고용센터(합법), 브로커(불법)
  const bld = k => L => L.b && L.b.kind === k;
  makePlace('ammu2', choose(edgeLots(DIST.HARBOR, bld('warehouse')), 0.86, 0.22), 'ammu', '#3b3b3b', '총포상');
  makePlace('burger', choose(edgeLots(DIST.BEACH, bld('shop')), 0.55, 0.8), 'burger', '#f3d9b1', '버거 샷');
  makePlace('burger2', choose(edgeLots(DIST.MIDTOWN, bld('mid')), 0.36, 0.3), 'burger', '#f3d9b1', '버거 샷');
  makePlace('mart', choose(edgeLots(DIST.RESID, bld('house')), 0.25, 0.45), 'mart', '#dfe8e0', '24 편의점');
  makePlace('mart2', choose(edgeLots(DIST.DOWNTOWN, bld('tower')), 0.6, 0.36), 'mart', '#dfe8e0', '24 편의점');
  makePlace('mart3', choose(edgeLots(DIST.HARBOR, bld('warehouse')), 0.8, 0.62), 'mart', '#dfe8e0', '24 편의점');
  makePlace('safehouse', choose(edgeLots(DIST.RESID, bld('house')), 0.3, 0.38), 'safehouse', '#e8d9b0', '집');
  makePlace('jobcenter', choose(edgeLots(DIST.MIDTOWN, bld('mid')), 0.48, 0.5), 'jobcenter', '#c9d6e8', '고용센터');
  makePlace('broker', choose(edgeLots(DIST.HARBOR, bld('warehouse')), 0.76, 0.45), 'broker', '#2d2433', '브로커');
  // 살 수 있는 사업체 (economy.js의 BUSINESSES)
  makePlace('biz_club', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.55, 0.5), 'biz', '#2a1f3d', '네온 나이트클럽');
  makePlace('biz_wash', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.62, 0.3), 'biz', '#cfe3f0', '스파클 세차장');
  makePlace('biz_taxi', choose(edgeLots(DIST.HARBOR, L => !L.used && bld('warehouse')(L)), 0.82, 0.55), 'biz', '#f2c14e', '하버 택시 회사');
  makePlace('biz_bar', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.4, 0.8), 'biz', '#e0a96d', '선셋 비치 바');
  makePlace('biz_factory', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.2, 0.6), 'biz', '#8b5a44', '아이언 밸리 제철소');
  makePlace('biz_burger', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.42, 0.62), 'biz', '#f3d9b1', '버거 샷 가맹점');
  makePlace('biz_surf', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.7, 0.82), 'biz', '#6cc0c4', '서핑·보트 대여점');
  makePlace('biz_logi', choose(edgeLots(DIST.HARBOR, L => !L.used && bld('warehouse')(L)), 0.85, 0.3), 'biz', '#7a7f86', '하버 물류창고');
  makePlace('biz_hotel', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.44, 0.44), 'biz', '#c9b27a', '스카이라인 호텔');
  makePlace('biz_mart', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.3, 0.45), 'biz', '#dfe8e0', '24 편의점 본사');
  makePlace('biz_auto', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.3, 0.55), 'biz', '#5f6b72', '네온 정비소');
  makePlace('biz_cinema', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.55, 0.66), 'biz', '#8a2d4a', '네온 시네마');
  makePlace('biz_marina', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.85, 0.82), 'biz', '#e7d8b0', '마리나 요트 클럽');
  makePlace('biz_gymchain', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.62, 0.46), 'biz', '#3b3b3b', '파워 피트니스 본사');
  makePlace('biz_tower', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.5, 0.52), 'biz', '#1f2f4f', '네온 방송국');
  // 상호작용 건물: 옷가게 · 체육관 · 약국 · 은행 + 가게 분점
  makePlace('clothes', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.44, 0.58), 'clothes', '#f4d6e8', '빈티지 부티크');
  makePlace('clothes2', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.28, 0.82), 'clothes', '#f4d6e8', '비치 웨어');
  makePlace('gym', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.36, 0.52), 'gym', '#2b2b2b', '체육관');
  makePlace('pharmacy', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.6, 0.4), 'pharmacy', '#e8fff0', '약국');
  makePlace('pharmacy2', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.18, 0.68), 'pharmacy', '#e8fff0', '약국');
  makePlace('bank', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.5, 0.4), 'bank', '#c9b27a', '네온 시티은행');
  makePlace('ammu3', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.25, 0.64), 'ammu', '#3b3b3b', '총포상');
  makePlace('burger3', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.58, 0.44), 'burger', '#f3d9b1', '버거 샷');
  makePlace('burger4', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.22, 0.56), 'burger', '#f3d9b1', '버거 샷');
  makePlace('mart4', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.5, 0.3), 'mart', '#dfe8e0', '24 편의점');
  makePlace('mart5', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.62, 0.8), 'mart', '#dfe8e0', '24 편의점');
  // 네 조직의 본부
  makePlace('hq_dragon', choose(edgeLots(DIST.HARBOR, L => !L.used && bld('warehouse')(L)), 0.8, 0.45), 'hq', '#1f8a4c', '청룡파 본부');
  makePlace('hq_wave', choose(edgeLots(DIST.BEACH, L => !L.used && bld('shop')(L)), 0.5, 0.86), 'hq', '#e07a1f', '파도파 본부');
  makePlace('hq_iron', choose(edgeLots(DIST.INDUSTRY, L => !L.used && bld('warehouse')(L)), 0.14, 0.6), 'hq', '#5b7fa6', '아이언 본부');
  makePlace('hq_cobra', choose(edgeLots(DIST.MIDTOWN, L => !L.used && bld('mid')(L)), 0.66, 0.36), 'hq', '#8a3bd1', '코브라 본부');
  // v2.5 큰 맵: 외곽 동네에도 병원·경찰서, 국가·경제 기관
  const anyLot = (u, v, kinds) => choose(W.blocks.flatMap(b => b.lots.filter(L => L.edge && !L.used && L.b && kinds.includes(L.b.kind))), u, v);
  makePlace('hospital2', anyLot(0.78, 0.2, ['mid', 'house', 'shop']), 'hospital', '#e9ecef', '레이크뷰 병원');
  makePlace('hospital3', anyLot(0.3, 0.84, ['mid', 'warehouse', 'shop']), 'hospital', '#e9ecef', '러스트 야드 병원');
  makePlace('police2', anyLot(0.2, 0.25, ['mid', 'house']), 'police', '#2c3e66', '웨스트 경찰서');
  makePlace('police3', anyLot(0.8, 0.8, ['mid', 'shop', 'warehouse']), 'police', '#2c3e66', '코랄 베이 경찰서');
  makePlace('cityhall', anyLot(0.5, 0.45, ['tower']), 'gov', '#e8e2d0', '네온 시청');
  makePlace('assembly', anyLot(0.55, 0.24, ['mid', 'tower']), 'gov', '#d9d2bd', '국회의사당');
  makePlace('cbank', anyLot(0.47, 0.52, ['tower']), 'bank', '#c9b27a', '네온 중앙은행');
  makePlace('stock', anyLot(0.56, 0.47, ['tower']), 'biz', '#1f2f4f', '증권거래소');
  makePlace('realty', anyLot(0.4, 0.42, ['mid', 'tower']), 'biz', '#9a7b63', '하버 부동산');
  makePlace('wh_harbor', anyLot(0.9, 0.5, ['warehouse']), 'warehouse', '#7a7f86', '하버 창고');
  makePlace('wh_iron', anyLot(0.22, 0.74, ['warehouse']), 'warehouse', '#6e6a5f', '밸리 창고');
  makePlace('wh_north', anyLot(0.7, 0.14, ['mid', 'warehouse', 'house']), 'warehouse', '#8a8074', '노스 창고');
  makePlace('heist', anyLot(0.34, 0.3, ['mid', 'house']), 'hq', '#2d2433', '작전실');
  makePlace('biz_casino', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.58, 0.6), 'casino', '#1d1233', '다이아몬드 카지노');
  // 차고형 장소: 필지를 비워 LOT으로 만든다
  const makeLotPlace = (key, L, label) => {
    if (!L) return;
    if (L.b) { for (let y = L.b.y0; y <= L.b.y1; y++) for (let x = L.b.x0; x <= L.b.x1; x++) { set(x, y, TL.LOT); W.bIndex[tIdx(x, y)] = -1; } L.b.removed = true; L.b = null; }
    for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) if (get(x, y) !== TL.LOT) { set(x, y, TL.LOT); W.bIndex[tIdx(x, y)] = -1; }
    W.buildings.forEach(bb => { if (!bb.removed && bb.x0 >= L.x0 && bb.x1 <= L.x1 && bb.y0 >= L.y0 && bb.y1 <= L.y1) bb.removed = true; });
    W.trees = W.trees.filter(t => !(t.x >= L.x0 * T && t.x <= (L.x1 + 1) * T && t.y >= L.y0 * T && t.y <= (L.y1 + 1) * T));
    W.parking = W.parking.filter(p => !(p.x >= L.x0 * T && p.x <= (L.x1 + 1) * T && p.y >= L.y0 * T && p.y <= (L.y1 + 1) * T));
    L.kind = key;
    W.places[key] = { x: (L.x0 + L.x1 + 1) / 2 * T, y: (L.y0 + L.y1 + 1) / 2 * T, lot: L, label, door: doorOf(L) };
  };
  makeLotPlace('spray', choose(edgeLots(DIST.MIDTOWN, L => (L.x1 - L.x0) >= 2 && (L.y1 - L.y0) >= 2), 0.3, 0.45), '페인트샵');
  makeLotPlace('spray2', choose(edgeLots(DIST.BEACH, L => (L.x1 - L.x0) >= 2 && (L.y1 - L.y0) >= 2), 0.75, 0.8), '페인트샵');
  makeLotPlace('mygarage', choose(edgeLots(DIST.RESID, L => !L.used && (L.x1 - L.x0) >= 3 && (L.y1 - L.y0) >= 3), 0.3, 0.42), '내 차고');
  makeLotPlace('dealer', choose(edgeLots(DIST.INDUSTRY, L => (L.x1 - L.x0) >= 3 && (L.y1 - L.y0) >= 3), 0.26, 0.58) || choose(edgeLots(DIST.MIDTOWN, L => (L.x1 - L.x0) >= 3 && (L.y1 - L.y0) >= 3), 0.4, 0.6), '네온 모터스');
  makeLotPlace('garage', choose(edgeLots(DIST.HARBOR, L => (L.x1 - L.x0) >= 2 && (L.y1 - L.y0) >= 2), 0.8, 0.35), '차고');
  W.buildings = W.buildings.filter(b => !b.removed);
  W.bIndex.fill(-1);
  W.buildings.forEach((b, i) => { b.id = i; for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) W.bIndex[tIdx(x, y)] = i; });

  // 8) 가로등: 교차로 모서리 + 긴 구간 중간
  for (const n of W.nodes) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = n.x + sx * T * 1.5, y = n.y + sy * T * 1.5;
    if (tileAt(x, y) === TL.WALK) W.lamps.push({ x, y });
  }
  for (const [a, b] of W.edgesList) {
    const A = W.nodes[a], B = W.nodes[b], L = dist(A.x, A.y, B.x, B.y);
    const dx = (B.x - A.x) / L, dy = (B.y - A.y) / L;
    for (let s = 22; s < L - 16; s += 22) for (const side of [-1, 1]) {
      const x = A.x + dx * s + (-dy) * side * T * 1.5, y = A.y + dy * s + dx * side * T * 1.5;
      if (tileAt(x, y) === TL.WALK) W.lamps.push({ x, y });
    }
  }
  // 트리 충돌 공간 해시
  W.treeGrid = new Map();
  for (const t of W.trees) { const k = Math.floor(t.x / 8) + ',' + Math.floor(t.y / 8); if (!W.treeGrid.has(k)) W.treeGrid.set(k, []); W.treeGrid.get(k).push(t); }

  buildSpatial();
  buildMinimap();
}

// ---------- 공간 인덱스 (맵이 커져서 '전체 목록에서 무작위로 고르기'·'전체 훑기'를 피한다) ----------
const GRID_CS = 64; // 칸 크기(m)
function gridMake(items, fx, fy) {
  const m = new Map();
  for (const it of items) { const k = Math.floor(fx(it) / GRID_CS) * 4096 + Math.floor(fy(it) / GRID_CS); let l = m.get(k); if (!l) m.set(k, l = []); l.push(it); }
  return m;
}
function gridQuery(m, x, y, r, out = []) {
  const c0 = Math.floor((x - r) / GRID_CS), c1 = Math.floor((x + r) / GRID_CS), d0 = Math.floor((y - r) / GRID_CS), d1 = Math.floor((y + r) / GRID_CS);
  for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) { const l = m.get(a * 4096 + b); if (l) for (const it of l) out.push(it); }
  return out;
}
function buildSpatial() {
  const W = World, N = W.nodes;
  W.edgeGrid = gridMake(W.edgesList, e => (N[e[0]].x + N[e[1]].x) / 2, e => (N[e[0]].y + N[e[1]].y) / 2);
  W.nodeGrid = gridMake(N, n => n.x, n => n.y);
  W.blockGrid = gridMake(W.blocks, b => (b.x0 + b.x1 + 1) / 2 * T, b => (b.y0 + b.y1 + 1) / 2 * T);
}
// 반경 r 안(대략)의 도로 구간 / 블록 — 구간 길이만큼 여유를 둔다
const edgesNear = (x, y, r) => gridQuery(World.edgeGrid, x, y, r + 40);
const blocksNear = (x, y, r) => gridQuery(World.blockGrid, x, y, r + 40);

function treesNear(x, y) {
  const out = [], cx = Math.floor(x / 8), cy = Math.floor(y / 8);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = World.treeGrid.get((cx + a) + ',' + (cy + b)); if (l) out.push(...l); }
  return out;
}

const MINI_COL = { [TL.WATER]: '#1d4e6e', [TL.ROAD]: '#c9ccd2', [TL.WALK]: '#8b8f96', [TL.BUILD]: '#39404c', [TL.GRASS]: '#3f6b3a', [TL.SAND]: '#c9b37c', [TL.LOT]: '#5d6168', [TL.PLAZA]: '#8f8577', [TL.DOCK]: '#6b6f73', [TL.RUNWAY]: '#2a2c30' };
function buildMinimap() {
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d'), img = g.createImageData(MW, MH);
  for (let i = 0; i < MW * MH; i++) {
    const n = parseInt(MINI_COL[World.tiles[i]].slice(1), 16);
    img.data[i * 4] = (n >> 16) & 255; img.data[i * 4 + 1] = (n >> 8) & 255; img.data[i * 4 + 2] = n & 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  World.mini = c;
}

// ---------- 도로 그래프 질의 ----------
function lightState(node, dir) {
  if (!node.light) return 'g';
  const t = ((Game.time + node.light.off) % LIGHT_CYCLE);
  const ns = dir === 1 || dir === 3;
  if (ns) return t < 9 ? 'g' : t < 11.5 ? 'y' : 'r';
  return t < 11.5 ? 'r' : t < 20.5 ? 'g' : 'y';
}
function nearestNode(x, y) {
  let best = null, bd = 1e18;
  for (let r = 70; r < 5000 && !best; r *= 2) {
    for (const n of gridQuery(World.nodeGrid, x, y, r)) { const d = dist2(x, y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  }
  if (!best) for (const n of World.nodes) { const d = dist2(x, y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  return best;
}
// 가장 가까운 도로 구간과 그 위의 위치
function nearestEdge(x, y) {
  let best = null, bd = 1e18;
  let list = gridQuery(World.edgeGrid, x, y, 110);
  if (!list.length) list = World.edgesList;
  for (const [a, b] of list) {
    const A = World.nodes[a], B = World.nodes[b];
    const L = dist(A.x, A.y, B.x, B.y), dx = (B.x - A.x) / L, dy = (B.y - A.y) / L;
    const s = clamp((x - A.x) * dx + (y - A.y) * dy, 0, L);
    const px = A.x + dx * s, py = A.y + dy * s, d = dist2(x, y, px, py);
    if (d < bd) { bd = d; best = { A, B, s, L, dx, dy, px, py, d: Math.sqrt(d) }; }
  }
  return best;
}
const dirBetween = (A, B) => (B.x > A.x + 1 ? 0 : B.x < A.x - 1 ? 2 : B.y > A.y ? 1 : 3);
// 너비 우선 탐색으로 노드 경로 (경찰 추격용)
function nodePath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = new Int32Array(World.nodes.length).fill(-2);
  const q = [fromId]; prev[fromId] = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === toId) break;
    for (const n of World.nodes[c].adj) if (n >= 0 && prev[n] === -2) { prev[n] = c; q.push(n); }
  }
  if (prev[toId] === -2) return null;
  const path = [];
  for (let c = toId; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}
// 블록 인도 루프 위의 점 (s: 둘레 파라미터)
function loopPoint(loop, s) {
  s = ((s % loop.P) + loop.P) % loop.P;
  if (s < loop.w) return [loop.x0 + s, loop.y0];
  s -= loop.w; if (s < loop.h) return [loop.x1, loop.y0 + s];
  s -= loop.h; if (s < loop.w) return [loop.x1 - s, loop.y1];
  s -= loop.w; return [loop.x0, loop.y1 - s];
}
function loopParam(loop, x, y) {
  // 가장 가까운 변으로 투영
  const cands = [
    [Math.abs(y - loop.y0), clamp(x - loop.x0, 0, loop.w)],
    [Math.abs(x - loop.x1), loop.w + clamp(y - loop.y0, 0, loop.h)],
    [Math.abs(y - loop.y1), loop.w + loop.h + clamp(loop.x1 - x, 0, loop.w)],
    [Math.abs(x - loop.x0), 2 * loop.w + loop.h + clamp(loop.y1 - y, 0, loop.h)],
  ];
  cands.sort((a, b) => a[0] - b[0]);
  return cands[0][1];
}
function blockAt(x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return null;
  const r = World.region[tIdx(tx, ty)];
  return r >= 0 ? World.blocks[r] : null;
}
// 목표 근처의 인도 지점 찾기 (미션 배치용)
function sidewalkNear(x, y, minD = 0) {
  let best = null, bd = 1e18;
  for (let k = 0; k < 400; k++) {
    const tx = Math.floor(x / T) + randi(-14, 14), ty = Math.floor(y / T) + randi(-14, 14);
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) continue;
    if (World.tiles[tIdx(tx, ty)] !== TL.WALK) continue;
    const px = (tx + 0.5) * T, py = (ty + 0.5) * T, d = dist2(px, py, x, y);
    if (d >= minD * minD && d < bd) { bd = d; best = { x: px, y: py }; }
  }
  if (best) return best;
  // 근처에 인도가 없으면(기지·바다 쪽) 링을 넓혀 가며 가장 가까운 인도를 찾는다 — 제자리를 돌려주면 기지 안에 목표가 생긴다
  const cx = clamp(Math.floor(x / T), 0, MW - 1), cy = clamp(Math.floor(y / T), 0, MH - 1);
  for (let r = 1; r < MW; r++) {
    for (let k = -r; k <= r; k++) for (const [tx, ty] of [[cx + k, cy - r], [cx + k, cy + r], [cx - r, cy + k], [cx + r, cy + k]]) {
      if (tx < 0 || ty < 0 || tx >= MW || ty >= MH || World.tiles[tIdx(tx, ty)] !== TL.WALK) continue;
      const px = (tx + 0.5) * T, py = (ty + 0.5) * T, d = dist2(px, py, x, y);
      if (d >= minD * minD && d < bd) { bd = d; best = { x: px, y: py }; }
    }
    if (best) return best;
  }
  return { x, y };
}
// 차선 위 임의 지점 (스폰용): 구간, 방향, 위치 반환
function laneSpot(edge, forward, s) {
  const [a, b] = edge;
  const A = World.nodes[forward ? a : b], B = World.nodes[forward ? b : a];
  const d = dirBetween(A, B), r = rightOf(d);
  const L = dist(A.x, A.y, B.x, B.y);
  s = clamp(s, 2 * T + 3, L - 2 * T - 3);
  return { x: A.x + DIRS[d][0] * s + r[0] * T * 0.5, y: A.y + DIRS[d][1] * s + r[1] * T * 0.5, a: Math.atan2(DIRS[d][1], DIRS[d][0]), A, B, d };
}

// ---------- 보행자 횡단 규칙 ----------
// 횡단보도 = 교차로 바로 옆 도로 칸(흰 줄무늬). 그 도로의 차량 신호가 빨간불일 때만 건널 수 있다.
function isCrosswalk(tx, ty) {
  if (tx < 1 || ty < 1 || tx >= MW - 1 || ty >= MH - 1) return false;
  const i = tIdx(tx, ty), rk = World.roadK;
  if (World.tiles[i] !== TL.ROAD) return false;
  if (rk[i] === 1) return rk[i - MW] === 3 || rk[i + MW] === 3;
  if (rk[i] === 2) return rk[i - 1] === 3 || rk[i + 1] === 3;
  return false;
}
// 0: 도로 아님, 1: 합법 횡단(횡단보도 + 보행 신호), 2: 무단횡단
function jayStatus(x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tileAt(x, y) !== TL.ROAD) return 0;
  if (!isCrosswalk(tx, ty)) return 2;
  const n = nearestNode(x, y);
  if (!n.light) return 1;
  const carDir = World.roadK[tIdx(tx, ty)] === 1 ? 1 : 0; // 세로 도로면 남북 신호
  return lightState(n, carDir) === 'r' ? 1 : 2;
}
