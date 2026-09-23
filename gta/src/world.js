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

const ENABLE_BASE = false; // v2.8: 군 기지는 잠시 뺀다 (군 장비는 공항 군수 화물 구역에)
const T = 4;               // 타일 한 칸 = 4m (차선 폭)
const MW = 640, MH = 640;  // 타일 수 → 2560m × 2560m 섬 (v2.8에서 480 → 640 확장; 3D는 청크 단위로 스트리밍)
const TL = { WATER: 0, ROAD: 1, WALK: 2, BUILD: 3, GRASS: 4, SAND: 5, LOT: 6, PLAZA: 7, DOCK: 8, RUNWAY: 9 };
const DIST = { DOWNTOWN: 0, MIDTOWN: 1, RESID: 2, HARBOR: 3, BEACH: 4, PARK: 5, COAST: 6, BASE: 7, INDUSTRY: 8, AIRPORT: 9 };
const DIST_NAMES = ['다운타운', '미드타운', '웨스트 힐즈', '하버 포인트', '선셋 비치', '센트럴 파크', '해안 산책로', '포트 네온 기지', '아이언 밸리', '네온 국제공항'];
// 동네: 이름 · 구역 종류 · 씨앗 위치(맵 비율) · w(작을수록 넓게 퍼짐)
const HOODS = [
  { name: '다운타운', d: 0, u: 0.52, v: 0.5, w: 0.8 },
  { name: '미드타운', d: 1, u: 0.38, v: 0.42 }, { name: '노스 게이트', d: 1, u: 0.52, v: 0.3 }, { name: '유니언 스퀘어', d: 1, u: 0.66, v: 0.42 },
  { name: '올드 타운', d: 1, u: 0.46, v: 0.64 }, { name: '리버사이드', d: 1, u: 0.62, v: 0.62 },
  { name: '웨스트 힐즈', d: 2, u: 0.1, v: 0.45 }, { name: '파인 크레스트', d: 2, u: 0.3, v: 0.26 }, { name: '레이크뷰', d: 2, u: 0.72, v: 0.3 }, { name: '로즈우드', d: 2, u: 0.2, v: 0.4 },
  { name: '하버 포인트', d: 3, u: 0.88, v: 0.54 }, { name: '터미널 아일랜드', d: 3, u: 0.8, v: 0.66 },
  { name: '선셋 비치', d: 4, u: 0.52, v: 0.8 }, { name: '코랄 베이', d: 4, u: 0.72, v: 0.78 }, { name: '팜 쇼어', d: 4, u: 0.2, v: 0.76 },
  { name: '아이언 밸리', d: 8, u: 0.28, v: 0.56 }, { name: '러스트 야드', d: 8, u: 0.34, v: 0.72 },
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
  const tx = clamp(Math.floor(x / T), 0, MW - 1), ty = clamp(Math.floor(y / T), 0, MH - 1);
  let i = tx + ty * MW;
  if (World.region[i] < 0 && World.tiles[i] === TL.ROAD) for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { const j = clamp(tx + dx, 0, MW - 1) + clamp(ty + dy, 0, MH - 1) * MW; if (World.region[j] >= 0) { i = j; break; } } // 도로 위면 옆 블록의 동네
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
    const u = (W.VX[i] + 1) / MW, v = (W.HY[j] + 1) / MH, dc = Math.hypot(u - 0.52, v - 0.5);
    if ((touched.has(a) || touched.has(b)) && (dc < 0.3 || R() < 0.5)) continue; // 외곽은 슈퍼블록이 이어져 불규칙한 큰 블록이 된다
    if (dc < 0.13) continue; // 다운타운은 촘촘한 격자 유지 (밀도가 높을수록 블록이 작다)
    if (R() > 0.12 + dc * 0.75) continue;
    const bi = t === 'h' ? i + 1 : i, bj = t === 'h' ? j : j + 1;
    if (deg(i, j) - 1 < 2 || deg(bi, bj) - 1 < 2) continue;
    if (t === 'h') hE[i][j] = false; else vE[i][j] = false;
    touched.add(a); touched.add(b);
  }

  // 에투알(별) 광장: 도심 한가운데 교차로 하나를 없애고 주변 네 블록을 합쳐 원형 광장을 만든다
  {
    const tx = 0.52 * MW, ty = 0.5 * MH;
    let ei = 1, ej = 1;
    for (let i = 1; i < NX - 1; i++) if (Math.abs(W.VX[i] - tx) < Math.abs(W.VX[ei] - tx)) ei = i;
    for (let j = 1; j < NY - 1; j++) if (Math.abs(W.HY[j] - ty) < Math.abs(W.HY[ej] - ty)) ej = j;
    hE[ei - 1][ej] = hE[ei][ej] = false; vE[ei][ej - 1] = vE[ei][ej] = false;
    W.etoile = { i: ei, j: ej, cx: W.VX[ei] + 1, cy: W.HY[ej] + 1 }; // 타일 좌표(교차로 한가운데)
  }
  // 섬: 블록(격자 칸) 단위로 땅/바다를 정한다 → 건물이 물 위에 서지 않는다.
  //   해안선 = 찌그러진 타원 + 사인파 잡음, 서쪽에서 남쪽 바다로 흐르는 강(다리로 건넌다), 북서쪽 군 기지 반도
  const ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU, R() * TAU];
  const coastN = (u, v) => { const a = Math.atan2(v - 0.52, u - 0.5); return 0.07 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 5 + ph[1]) + 0.03 * Math.sin(a * 9 + ph[2]) + 0.02 * Math.sin(a * 14 + ph[3]); };
  // 자메이카처럼 동서로 긴 섬: 본섬 + 가늘어지는 동쪽 꼬리 + 기지가 있는 북서쪽 언덕 + 남쪽 곶, 남쪽 해안엔 만(灣) 두 개
  const E = (u, v, cx, cy, rx, ry) => Math.hypot((u - cx) / rx, (v - cy) / ry);
  const landAt = (u, v) => {
    const n = coastN(u, v) * 0.6;
    const inside = Math.min(E(u, v, 0.47, 0.52, 0.42, 0.33), E(u, v, 0.83, 0.58, 0.14, 0.11), E(u, v, 0.21, 0.2, 0.16, 0.14), E(u, v, 0.52, 0.84, 0.06, 0.08)) < 1 + n;
    const bay = E(u, v, 0.64, 0.87, 0.075, 0.07) < 1 || E(u, v, 0.33, 0.87, 0.06, 0.05) < 1;
    return inside && !bay;
  };
  const riverAt = (u, v) => (u > 0.1 && u < 0.41 && Math.abs(v - (0.64 + 0.03 * Math.sin(u * 14 + ph[4]))) < 0.013) || (v >= 0.62 && Math.abs(u - (0.4 + 0.02 * Math.sin(v * 12))) < 0.012);
  W.rural = (u, v) => u < 0.12 || u > 0.87; // 섬 양 끝은 숲과 농가
  const cellLand = [], cellRiver = [];
  for (let i = 0; i < NX - 1; i++) { cellLand.push([]); cellRiver.push([]); for (let j = 0; j < NY - 1; j++) {
    const u = (W.VX[i] + W.VX[i + 1] + 2) / 2 / MW, v = (W.HY[j] + W.HY[j + 1] + 2) / 2 / MH;
    const base = ENABLE_BASE && j <= 1 && W.VX[i + 1] <= MW * 0.36 + 3; // 기지로 이어지는 땅
    const riv = !base && riverAt(u, v) && landAt(u, v) && Math.hypot(u - 0.52, v - 0.5) > 0.12;
    cellRiver[i].push(riv); cellLand[i].push((landAt(u, v) || base) && !riv);
  } }
  const cellAir = cellLand.map(r => r.map(() => false)); // (v2.10부터 공항은 격자 칸이 아니라 따로 만든 매립 섬)
  W.cellAir = cellAir;
  const cl = (i, j) => i >= 0 && j >= 0 && i < NX - 1 && j < NY - 1 && cellLand[i][j];
  const ca = (i, j) => i >= 0 && j >= 0 && i < NX - 1 && j < NY - 1 && cellAir[i][j];
  const cr = (i, j) => i >= 0 && j >= 0 && i < NX - 1 && j < NY - 1 && cellRiver[i][j];
  // 도로 구간은 옆 칸 중 하나라도 땅이면 남긴다. 양쪽이 강이면(또는 땅-강) 다리로 남긴다
  //   다리는 양 끝이 둑(땅에 닿은 교차로)일 때만 — 강 한가운데를 따라가는 도로는 만들지 않는다
  const nodeLand = (i, j) => cl(i - 1, j - 1) || cl(i, j - 1) || cl(i - 1, j) || cl(i, j);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (i < NX - 1 && hE[i][j] && !(cl(i, j - 1) || cl(i, j) || (cr(i, j - 1) && cr(i, j) && nodeLand(i, j) && nodeLand(i + 1, j) && (i % 2 === 0)))) hE[i][j] = false;
    if (j < NY - 1 && vE[i][j] && !(cl(i - 1, j) || cl(i, j) || (cr(i - 1, j) && cr(i, j) && nodeLand(i, j) && nodeLand(i, j + 1) && (j % 2 === 0)))) vE[i][j] = false;
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) { // 공항 안쪽 도로는 없앤다 (둘레 도로만 남김)
    if (i < NX - 1 && ca(i, j - 1) && ca(i, j)) hE[i][j] = false;
    if (j < NY - 1 && ca(i - 1, j) && ca(i, j)) vE[i][j] = false;
  }
  // 섬 가운데와 이어지지 않은 도로 조각은 없앤다
  {
    const st = [W.etoile.i + 1, W.etoile.j], seen = new Set([st.join()]), q = [st];
    const nb = (i, j) => { const o = []; if (i < NX - 1 && hE[i][j]) o.push([i + 1, j]); if (i > 0 && hE[i - 1][j]) o.push([i - 1, j]); if (j < NY - 1 && vE[i][j]) o.push([i, j + 1]); if (j > 0 && vE[i][j - 1]) o.push([i, j - 1]); return o; };
    while (q.length) { const [i, j] = q.pop(); for (const n of nb(i, j)) { const k = n.join(); if (!seen.has(k)) { seen.add(k); q.push(n); } } }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) if (!seen.has(i + ',' + j)) { if (i < NX - 1) hE[i][j] = false; if (j < NY - 1) vE[i][j] = false; if (i > 0) hE[i - 1][j] = false; if (j > 0) vE[i][j - 1] = false; }
    for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NY - 1; j++) if (cellLand[i][j] && !cellAir[i][j] && ![[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].some(([a, b]) => seen.has(a + ',' + b))) cellLand[i][j] = false;
  }
  W.cellLand = cellLand; W.cellRiver = cellRiver;
  // 고속도로: 가로 2줄 · 세로 2줄 (4차선, AI가 빠르게 달린다)
  const pickLine = (arr, f, avoid) => { let best = 1; for (let k = 1; k < arr.length - 1; k++) if (k !== avoid && Math.abs(arr[k] - f) < Math.abs(arr[best] - f)) best = k; return best; };
  W.hwH = new Set([pickLine(W.HY, 0.3 * MH, W.etoile.j), pickLine(W.HY, 0.76 * MH, W.etoile.j)]);
  W.hwV = new Set([pickLine(W.VX, 0.27 * MW, W.etoile.i), pickLine(W.VX, 0.75 * MW, W.etoile.i)]);

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
  for (const n of W.nodes) { if (!n.deg) continue; const x = W.VX[n.i], y = W.HY[n.j]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) paintRoad(x + a, y + b, 3); }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (hE[i][j]) for (let x = W.VX[i] + 2; x < W.VX[i + 1]; x++) { paintRoad(x, W.HY[j], 2); paintRoad(x, W.HY[j] + 1, 2); }
    if (vE[i][j]) for (let y = W.HY[j] + 2; y < W.HY[j + 1]; y++) { paintRoad(W.VX[i], y, 1); paintRoad(W.VX[i] + 1, y, 1); }
  }

  const nearAirport = b => { const A = W.airport; if (!A) return false; return b.x1 >= A.bx0 - 40 && b.x0 <= A.bx1 + 40 && b.y1 >= A.by0 - 40 && b.y0 <= A.by1 + 40; };
  // ---------- 에투알 광장 · 대로 · 랜드마크 (파리식 방사형 구조) ----------
  W.decos = []; W.landmarks = []; W.runways = [];
  function buildEtoile(b, ix0, iy0, ix1, iy1) {
    const cx = W.etoile.cx, cy = W.etoile.cy, Rr = Math.min(cx - ix0, ix1 + 1 - cx, cy - iy0, iy1 + 1 - cy) - 0.6;
    W.etoile.R = Rr;
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      set(x, y, d < Rr ? TL.PLAZA : TL.GRASS);
      if (d >= Rr && R() < 0.35) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
    }
    // 둥근 가로수 · 네 분수
    for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; addTree((cx + Math.cos(a) * (Rr - 0.9)) * T, (cy + Math.sin(a) * (Rr - 0.9)) * T, 'tree'); }
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, fx = Math.round(cx + Math.cos(a) * Rr * 0.5 - 1), fy = Math.round(cy + Math.sin(a) * Rr * 0.5 - 1); for (let y = fy; y < fy + 2; y++) for (let x = fx; x < fx + 2; x++) set(x, y, TL.WATER); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + Math.PI / 8; W.lamps.push({ x: (cx + Math.cos(a) * Rr * 0.72) * T, y: (cy + Math.sin(a) * Rr * 0.72) * T }); }
    // 네온 개선문: 기둥 두 개(가운데로 지나갈 수 있다) + 3D 아치 윗부분
    addBuilding(cx - 3, cy - 1, cx - 2, cy, 24, 'arch', '#d8cdb4').label = '개선문';
    addBuilding(cx + 1, cy - 1, cx + 2, cy, 24, 'arch', '#d8cdb4');
    W.decos.push({ t: 'lintel', x0: (cx - 3) * T, y0: (cy - 1) * T, x1: (cx + 3) * T, y1: (cy + 1) * T, z0: 24, z1: 31, c: '#d8cdb4' });
    b.lots = [];
    W.landmarks.push({ name: '네온 개선문', x: cx * T, y: cy * T });
  }
  // 공항: 평행 활주로 두 개 + 유도로 + 가운데 터미널(여객동 + 탑승동 날개) + 관제탑 + 격납고 + 주차장
  // 공항 부지 고르기: 본섬 가까운 넓은 빈 바다 (블록을 만들기 전에 자리만 잡아 둔다 → 주변 블록은 저밀도 완충 지대)
  function reserveAirport() {
    const rx = 96, ry = 58, M = 7;
    let best = null, bd = 1e9;
    for (let cy = ry + M + 3; cy < MH - ry - M - 3; cy += 6) for (let cx = rx + M + 3; cx < MW - rx - M - 3; cx += 6) {
      let ok = true;
      for (let y = cy - ry - M; y <= cy + ry + M && ok; y += 2) for (let x = cx - rx - M; x <= cx + rx + M; x += 2) { if (((x - cx) / (rx + M)) ** 2 + ((y - cy) / (ry + M)) ** 2 > 1) continue; if (get(x, y) !== TL.WATER) { ok = false; break; } }
      if (!ok) continue;
      let near = 1e9; for (let r = rx + M; r < rx + 70 && near > 1e8; r += 2) for (let a = 0; a < TAU; a += 0.06) { const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * ry / rx); if (x > 0 && y > 0 && x < MW && y < MH && get(x, y) !== TL.WATER) { near = r; break; } }
      const sc = near + (cy / MH) * 40; // 비슷하면 북쪽
      if (sc < bd) { bd = sc; best = { cx, cy }; }
    }
    if (!best) return;
    const { cx, cy } = best, ph2 = R() * TAU;
    // 매립지 해안선: 한쪽이 길쭉하게 튀어나온 불규칙한 모양 (인천공항 영종도처럼)
    const shape = (x, y) => { const a = Math.atan2((y - cy) / ry, (x - cx) / rx); const r = 1 + 0.07 * Math.sin(a * 2 + ph2) + 0.05 * Math.sin(a * 5 + ph2 * 2) + 0.025 * Math.sin(a * 11); return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < r * r; };
    const inner = (x, y) => shape(x, y) && shape(x + 3, y) && shape(x - 3, y) && shape(x, y + 3) && shape(x, y - 3);
    W.airport = { marks: [], cx, cy, rx, ry, shape, inner, bx0: cx - rx - 8, bx1: cx + rx + 8, by0: cy - ry - 8, by1: cy + ry + 8 };
  }
  function buildAirportIsland() {
    const A = W.airport; if (!A) return;
    const { cx, cy, rx, ry, shape, inner } = A;
    for (let y = cy - ry - 8; y <= cy + ry + 8; y++) for (let x = cx - rx - 8; x <= cx + rx + 8; x++) if (shape(x, y)) { set(x, y, inner(x, y) ? TL.GRASS : TL.SAND); W.dist[tIdx(x, y)] = DIST.AIRPORT; }
    const pv = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inner(x, y)) set(x, y, t); };
    const span = y => { let a = cx, b = cx; while (inner(a - 1, y)) a--; while (inner(b + 1, y)) b++; return [a, b]; };
    // 평행 활주로 두 줄 (섬 폭에 맞춰 길이가 정해진다) + 평행 유도로 + 연결 유도로 (비스듬한 고속 탈출 유도로 포함)
    const rA = cy - Math.round(ry * 0.62), rB = cy + Math.round(ry * 0.5);
    for (const ry0 of [rA, rB]) {
      const [a0, a1] = span(ry0 + 2), x0 = Math.max(a0, span(ry0)[0], span(ry0 + 5)[0]) + 4, x1 = Math.min(a1, span(ry0)[1], span(ry0 + 5)[1]) - 4;
      pv(x0, ry0, x1, ry0 + 5, TL.RUNWAY); W.runways.push({ x0: x0 * T, y0: ry0 * T, x1: (x1 + 1) * T, y1: (ry0 + 6) * T });
      const ty = ry0 < cy ? ry0 + 9 : ry0 - 5;
      pv(x0 + 4, ty, x1 - 4, ty + 1, TL.LOT); A.marks.push([(x0 + 4) * T, (ty + 1) * T, (x1 - 3) * T, (ty + 1) * T]);
      for (let x = x0 + 8; x < x1 - 6; x += 24) { const y0 = Math.min(ry0 + 6, ty + 2), y1 = Math.max(ry0 - 1, ty - 1); pv(x, Math.min(y0, y1), x + 1, Math.max(y0, y1), TL.LOT); }
      for (let k = 0; k < 7; k++) { pv(Math.round((x0 + x1) / 2) + (ry0 < cy ? k : -k) * 2, ry0 < cy ? ry0 + 6 + k : ry0 - 1 - k, Math.round((x0 + x1) / 2) + (ry0 < cy ? k : -k) * 2 + 2, ry0 < cy ? ry0 + 6 + k : ry0 - 1 - k, TL.LOT); }
      if (ry0 === rA) A.takeoff = { x: (x0 + 3) * T, y: (ry0 + 3) * T, a: 0 };
    }
    // 둥근 계류장 (타원) + 가운데 터미널 + 긴 탑승동 두 줄 + 좌우 날개
    const ay0 = rA + 13, ay1 = rB - 9, my = Math.round((ay0 + ay1) / 2), mx = cx, arx = Math.round(rx * 0.55), ary = Math.round((ay1 - ay0) / 2);
    for (let y = ay0; y <= ay1; y++) for (let x = mx - arx; x <= mx + arx; x++) if (((x - mx) / arx) ** 2 + ((y - my) / (ary + 0.5)) ** 2 < 1 && inner(x, y)) set(x, y, TL.LOT);
    const tw = Math.round(arx * 0.3), th = Math.max(3, Math.round(ary * 0.28));
    // 현대식 터미널: 건물(충돌·2D 지붕)은 상자지만 3D는 유리 벽 + 물결 지붕 + 기둥 (View3D.addDeco 'glass')
    const glass = (x0, y0, x1, y1, h, roof) => W.decos.push({ t: 'glass', x0: x0 * T, y0: y0 * T, x1: (x1 + 1) * T, y1: (y1 + 1) * T, h, roof });
    const term = addBuilding(mx - tw, my - th, mx + tw, my + th, 18, 'terminal', '#dfe6ec'); term.label = '네온 국제공항'; glass(mx - tw, my - th, mx + tw, my + th, 18, 'wave');
    for (const s of [-1, 1]) { const x0 = s < 0 ? mx - tw - 14 : mx + tw + 1, x1 = s < 0 ? mx - tw - 1 : mx + tw + 14; addBuilding(x0, my - 1, x1, my + 1, 10, 'terminal', '#d3dce4'); glass(x0, my - 1, x1, my + 1, 10, 'tube'); }
    const cA = my - th - Math.max(5, Math.round((ary - th) / 2)), cB = my + th + Math.max(5, Math.round((ary - th) / 2));
    const cw = Math.round(tw * 1.3);
    for (const c of [cA, cB]) {
      addBuilding(mx - cw, c - 1, mx + cw, c + 1, 10, 'terminal', '#d3dce4'); glass(mx - cw, c - 1, mx + cw, c + 1, 10, 'tube');
      const y0 = Math.min(c, my) + 2, y1 = Math.max(c, my) - 2; if (y1 >= y0) { addBuilding(mx - 1, y0, mx + 1, y1, 7, 'terminal', '#c9d3dc'); glass(mx - 1, y0, mx + 1, y1, 7, 'tube'); }
    }
    // 관제탑: 가는 원통 기둥 + 유리 관제실
    const ct = addBuilding(mx + arx + 4, my - 1, mx + arx + 5, my, 44, 'ctower', '#e8ecef'); ct.label = '관제탑';
    W.decos.push({ t: 'tower2', x: (mx + arx + 5) * T, y: my * T, h: 44 });
    addBuilding(mx + arx + 9, my - 8, mx + arx + 18, my - 2, 12, 'warehouse', '#9aa3ad').label = '화물 청사';
    pv(mx + arx + 8, my - 9, mx + arx + 19, my + 6, TL.LOT);
    for (let k = 0; k < 3; k++) { const hx = mx - arx - 14 - k * 11; pv(hx - 1, my - 5, hx + 9, my + 5, TL.LOT); addBuilding(hx, my - 3, hx + 7, my + 3, 10, 'hangar', '#7a8290'); W.decos.push({ t: 'vault', x0: hx * T, y0: (my - 3) * T, x1: (hx + 8) * T, y1: (my + 4) * T, z: 10, c: '#b8c0c8' }); }
    // 게이트 (탑승동 바깥쪽에 4개씩 + 날개 끝 2개) · 탑승교 · 유도선(노란 선) · 지상 조업 차량
    A.gates = [];
    const addGate = (gx, gy, a, bx, by) => {
      A.gates.push({ x: (gx + 0.5) * T, y: (gy + 0.5) * T, a, car: null, cd: 0 });
      W.decos.push({ t: 'jetbridge', x0: (bx + 0.5) * T, y0: by * T, x1: (gx + 0.5) * T + Math.cos(a) * 9, y1: (gy + 0.5) * T + Math.sin(a) * 9 });
      A.marks.push([(gx + 0.5) * T, (gy + 0.5) * T - Math.sin(a) * 40, (gx + 0.5) * T, (gy + 0.5) * T + Math.sin(a) * 16]);
      W.decos.push({ t: 'gse', x: (gx + 0.5) * T + 7, y: (gy + 0.5) * T + Math.sin(a) * 12 });
    };
    for (let k = 0; k < 4; k++) { const gx = mx - cw + Math.round((k + 0.5) * cw * 2 / 4); addGate(gx, cA - 8, Math.PI / 2, gx, cA - 1); addGate(gx, cB + 8, -Math.PI / 2, gx, cB + 2); }
    addGate(mx - tw - 10, my - 8, Math.PI / 2, mx - tw - 10, my - 1); addGate(mx + tw + 10, my + 8, -Math.PI / 2, mx + tw + 10, my + 2);
    // 계류장 조명탑 · 활주로 등화
    for (let k = -2; k <= 2; k++) W.decos.push({ t: 'mast', x: (mx + k * Math.round(arx * 0.4)) * T, y: (my + (k % 2 ? -ary + 2 : ary - 2)) * T, h: 26 });
    for (const r of W.runways.slice(-2)) {
      const pts = []; for (let x = r.x0; x <= r.x1; x += 30) { pts.push([x, r.y0 + 0.4, 0]); pts.push([x, r.y1 - 0.4, 0]); }
      for (let y = r.y0 + 2; y < r.y1 - 1; y += 3) { pts.push([r.x0 + 0.5, y, 1]); pts.push([r.x1 - 0.5, y, 2]); }
      W.decos.push({ t: 'rlights', x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, pts });
    }
    // 공항 안 도로(섬 둘레를 도는 순환로) · 나무
    for (let a = 0; a < TAU; a += 0.003) { const x = Math.round(cx + Math.cos(a) * (rx - 7)), y = Math.round(cy + Math.sin(a) * (ry - 5)); if (inner(x, y) && get(x, y) === TL.GRASS) { set(x, y, TL.LOT); if (get(x, y + 1) === TL.GRASS) set(x, y + 1, TL.LOT); } }
    for (let k = 0; k < 90; k++) { const x = cx - rx + Math.floor(R() * rx * 2), y = cy - ry + Math.floor(R() * ry * 2); if (inner(x, y) && get(x, y) === TL.GRASS && get(x + 1, y) === TL.GRASS && get(x, y + 1) === TL.GRASS) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree'); }
    // 둑길 (본섬 도로까지) + 정문 옆 주차장 · 공항 문
    const gate = linkToRoad(cx, cy, inner, shape) || { x: cx, y: cy + ry };
    const px = clamp(gate.x, cx - rx + 12, cx + rx - 20), py = clamp(gate.y, cy - ry + 10, cy + ry - 10);
    let pkx = px, pky = py; for (let k = 0; k < 30 && !(inner(pkx, pky) && inner(pkx + 12, pky + 8)); k++) { pkx += Math.sign(cx - pkx); pky += Math.sign(cy - pky); }
    pv(pkx, pky, pkx + 12, pky + 8, TL.LOT); for (let y = pky + 1; y <= pky + 6; y += 3) addParkingRow(pkx + 1, y, pkx + 11, y + 2);
    W.places.biz_airport = { x: (pkx + 6) * T, y: (pky - 1) * T, face: 1, label: '네온 국제공항', lot: { x0: pkx, y0: pky, x1: pkx + 12, y1: pky + 8, block: null, b: term } };
    // 군수 화물 구역 (기지가 없을 때만 쓰인다)
    W.helipads = W.helipads || [];
    W.depot = { door: { x: (mx - arx - 20) * T, y: (my + 8) * T }, spots: { tanks: [{ x: (mx - arx - 25) * T, y: (my + 8) * T, a: 0 }, { x: (mx - arx - 15) * T, y: (my + 8) * T, a: 0 }], helis: [{ x: (mx - arx - 25) * T, y: (my - 8) * T, a: 0 }, { x: (mx - arx - 15) * T, y: (my - 8) * T, a: 0 }], jets: A.takeoff ? [{ x: A.takeoff.x, y: A.takeoff.y - 6, a: 0 }, { x: A.takeoff.x, y: A.takeoff.y + 6, a: 0 }] : [] } };
    W.landmarks.push({ name: '네온 국제공항', x: (mx + 0.5) * T, y: (my + 0.5) * T });
  }
  // 섬(공항·기지)에서 본섬의 가장 가까운 도로까지 둑길을 깐다. 섬 가장자리 정문 타일을 돌려준다
  function linkToRoad(cx, cy, inner, shape) {
    let tx = -1, ty = -1, td = 1e9;
    for (let y = 2; y < MH - 2; y += 2) for (let x = 2; x < MW - 2; x += 2) { const i = tIdx(x, y); if (W.tiles[i] === TL.ROAD && W.roadK[i] >= 1 && W.roadK[i] <= 3 && !shape(x, y)) { const d = Math.hypot(x - cx, (y - cy) * 1.2); if (d < td) { td = d; tx = x; ty = y; } } }
    if (tx < 0) return null;
    const L = Math.hypot(tx - cx, ty - cy), ux = (tx - cx) / L, uy = (ty - cy) / L;
    let gate = null;
    for (let s = 0; s < L; s += 0.5) {
      const x = Math.round(cx + ux * s), y = Math.round(cy + uy * s);
      if (!gate && !inner(x, y) && shape(x, y)) gate = { x, y };
      if (inner(x, y)) continue;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = x + ox, Y = y + oy, i = tIdx(X, Y); if (W.tiles[i] === TL.ROAD || W.tiles[i] === TL.BUILD) continue; set(X, Y, TL.ROAD); W.roadK[i] = 4; }
    }
    if (gate) for (let s = 2; s < 16; s++) { const x = Math.round(gate.x - ux * s), y = Math.round(gate.y - uy * s); for (let o = -1; o <= 1; o++) { if (inner(x + o, y) && get(x + o, y) !== TL.RUNWAY && get(x + o, y) !== TL.BUILD) set(x + o, y, TL.LOT); if (inner(x, y + o) && get(x, y + o) !== TL.RUNWAY && get(x, y + o) !== TL.BUILD) set(x, y + o, TL.LOT); } }
    return gate;
  }
  function carveBoulevards() {
    const cx = W.etoile.cx, cy = W.etoile.cy, R0 = (W.etoile.R || 8) + 2, Lmax = 0.1 * MW, ringR = 0.14 * MW; // 광장 둘레만 짧은 방사로 (모든 길이 중심으로 모이지는 않는다)
    const mask = new Uint8Array(MW * MH);
    const rays = []; for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; rays.push([Math.cos(a), Math.sin(a)]); }
    const carve = (x, y) => {
      if (x < 1 || y < 1 || x >= MW - 1 || y >= MH - 1) return;
      const i = tIdx(x, y), t = W.tiles[i];
      if (t === TL.ROAD || t === TL.WATER || t === TL.RUNWAY || t === TL.DOCK || t === TL.SAND || W.dist[i] === DIST.BASE || W.dist[i] === DIST.AIRPORT || W.region[i] === (W.etoile.block ? W.etoile.block.id : -9) || (W.blocks[W.region[i]] && W.blocks[W.region[i]].airport)) return;
      if (t === TL.BUILD) { const bb = W.buildings[W.bIndex[i]]; if (bb && !bb.removed) { bb.removed = true; for (let yy = bb.y0; yy <= bb.y1; yy++) for (let xx = bb.x0; xx <= bb.x1; xx++) { set(xx, yy, TL.GRASS); W.bIndex[tIdx(xx, yy)] = -1; } } }
      set(x, y, TL.ROAD); W.roadK[i] = 4; mask[i] = 1;
    };
    for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      let hit = Math.abs(d - ringR * 0.5) < 1.4;
      if (!hit && d > R0 && d < Lmax) for (const [ux, uy] of rays) { const al = dx * ux + dy * uy; if (al > 0 && Math.abs(dx * uy - dy * ux) < 1.6) { hit = true; break; } }
      if (hit) carve(x, y);
    }
    // 가로수와 가로등 (대로 양옆)
    const side = (x, y, tree) => { const tx = Math.floor(x), ty = Math.floor(y); if (tx < 1 || ty < 1 || tx >= MW - 1 || ty >= MH - 1) return; const t = W.tiles[tIdx(tx, ty)]; if (t === TL.ROAD || t === TL.WATER || t === TL.BUILD || W.dist[tIdx(tx, ty)] === DIST.BASE) return; if (tree) addTree(x * T, y * T, 'tree'); else W.lamps.push({ x: x * T, y: y * T }); };
    for (const [ux, uy] of rays) for (let s = R0 + 2, k = 0; s < Lmax; s += 2.6, k++) for (const sg of [-1, 1]) side(cx + ux * s - uy * sg * 2.1, cy + uy * s + ux * sg * 2.1, k % 4 !== 0);
    for (const rr of [ringR * 0.5]) for (let a = 0, k = 0; a < TAU; a += 2.6 / rr, k++) for (const sg of [-1, 1]) side(cx + Math.cos(a) * (rr + sg * 2.1), cy + Math.sin(a) * (rr + sg * 2.1), k % 4 !== 0);
    // 옛길: 동네 중심끼리 이어지는 구불구불한 길 (Parish & Müller의 '전역 목표 + 지역 제약' 방식을 흉내:
    //   목표 방향으로 가되 잡음으로 굽고, 물을 만나면 비껴간다. 격자와 상관없이 비스듬히 지나가 자연스러운 길이 된다)
    const hoodC = W.hoods.map(h => ({ x: h.u * MW, y: h.v * MH }));
    const pairs = new Set();
    hoodC.forEach((a, i) => hoodC.map((b, j) => [j, Math.hypot(a.x - b.x, a.y - b.y)]).filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]).slice(0, 2).forEach(([j]) => pairs.add(Math.min(i, j) + ',' + Math.max(i, j))));
    const landT = (x, y) => { const t = get(Math.floor(x), Math.floor(y)); return t !== TL.WATER; };
    const trace = (ax, ay, bx, by, wid, seed) => {
      let x = ax, y = ay, h = Math.atan2(by - y, bx - x);
      for (let k = 0; k < 3000; k++) {
        const want = Math.atan2(by - y, bx - x) + 0.55 * Math.sin(k * 0.021 + seed) + 0.25 * Math.sin(k * 0.067 + seed * 2.3);
        let dh = angNorm(want - h); h += clamp(dh, -0.045, 0.045);
        let nx = x + Math.cos(h) * 0.7, ny = y + Math.sin(h) * 0.7;
        if (!landT(nx + Math.cos(h) * 3, ny + Math.sin(h) * 3)) { // 물 앞: 좌우로 비껴간다
          let ok = false; for (const s of [0.5, -0.5, 1, -1, 1.5, -1.5]) { const h2 = h + s; if (landT(x + Math.cos(h2) * 4, y + Math.sin(h2) * 4)) { h = h2; ok = true; break; } }
          if (!ok) return; nx = x + Math.cos(h) * 0.7; ny = y + Math.sin(h) * 0.7;
        }
        x = nx; y = ny;
        for (let oy = -wid; oy <= wid; oy++) for (let ox = -wid; ox <= wid; ox++) if (ox * ox + oy * oy <= wid * wid + 0.5) carve(Math.floor(x) + ox, Math.floor(y) + oy);
        if (k % 9 === 0) side(x - Math.sin(h) * (wid + 1.6), y + Math.cos(h) * (wid + 1.6), k % 27 !== 0);
        if (Math.hypot(bx - x, by - y) < 3) return;
      }
    };
    let sd = 1;
    for (const key of pairs) { const [i, j] = key.split(',').map(Number); trace(hoodC[i].x, hoodC[i].y, hoodC[j].x, hoodC[j].y, 1, sd++ * 1.7); }
    // 해안을 따라 도는 해안도로 (텐서장 유선처럼 경계에 평행): 바다에서 일정 거리인 곳을 잇는다
    {
      const dW = new Float32Array(MW * MH).fill(1e9), q = [];
      for (let i = 0; i < MW * MH; i++) if (W.tiles[i] === TL.WATER && !W.riverT[i]) { dW[i] = 0; q.push(i); }
      // 두 번 훑는 거리 변환(chamfer 3-4) — 모서리가 둥글어진다
      const pass = (fwd) => { const s = fwd ? 1 : -1; for (let y = fwd ? 1 : MH - 2; fwd ? y < MH - 1 : y > 0; y += s) for (let x = fwd ? 1 : MW - 2; fwd ? x < MW - 1 : x > 0; x += s) { const i = tIdx(x, y); let v = dW[i]; v = Math.min(v, dW[i - s] + 3, dW[i - s * MW] + 3, dW[i - s * MW - s] + 4, dW[i - s * MW + s] + 4); dW[i] = v; } };
      pass(true); pass(false);
      const Rc = 14 * 3; // 약 14타일 안쪽
      for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) { const d = dW[tIdx(x, y)]; if (d >= Rc - 3 && d < Rc + 3 && hash2(x >> 5, y >> 5) < 0.75) carve(x, y); }
    }
    // 골목: 큰 블록 한가운데를 가르는 좁은 길 (roadK 5)
    for (const b of W.blocks) {
      if (b.etoile || b.landmark || b.rural || b.airport || b.district === DIST.PARK || b.district === DIST.DOWNTOWN) continue;
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
      const alley = (x, y) => { const i = tIdx(x, y), t = W.tiles[i]; if (t === TL.ROAD || t === TL.WATER) return; if (t === TL.BUILD) { const bb = W.buildings[W.bIndex[i]]; if (bb && !bb.removed) { bb.removed = true; for (let yy = bb.y0; yy <= bb.y1; yy++) for (let xx = bb.x0; xx <= bb.x1; xx++) { set(xx, yy, TL.GRASS); W.bIndex[tIdx(xx, yy)] = -1; } } } set(x, y, TL.ROAD); W.roadK[i] = 5; mask[i] = 2; };
      if (w >= 13 && R() < 0.8) { const x = Math.floor((b.x0 + b.x1) / 2); for (let y = b.y0 + 1; y < b.y1; y++) alley(x, y); }
      if (h >= 13 && R() < 0.5) { const y = Math.floor((b.y0 + b.y1) / 2); for (let x = b.x0 + 1; x < b.x1; x++) alley(x, y); }
    }
    // 대로 위의 나무·주차칸 치우고, 헐린 건물의 필지는 비운다
    const inMask = (x, y) => mask[tIdx(clamp(Math.floor(x / T), 0, MW - 1), clamp(Math.floor(y / T), 0, MH - 1))];
    W.trees = W.trees.filter(t => !inMask(t.x, t.y));
    W.parking = W.parking.filter(p => !inMask(p.x, p.y));
    for (const b of W.blocks) for (const L of b.lots || []) if (L.b && L.b.removed) { L.b = null; L.used = true; }
    W.boulevardMask = mask;
  }
  // 블록 하나를 통째로 비우고 랜드마크를 세운다
  function landmarkBlock(u, v, pred, build) {
    const cands = W.blocks.filter(b => !b.etoile && !b.landmark && pred(b) && b.x1 - b.x0 >= 9 && b.y1 - b.y0 >= 9);
    if (!cands.length) return null;
    const b = cands.sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 / MW - u, (p.y0 + p.y1) / 2 / MH - v) - Math.hypot((q.x0 + q.x1) / 2 / MW - u, (q.y0 + q.y1) / 2 / MH - v))[0];
    b.landmark = true;
    const ix0 = b.x0 + 1, iy0 = b.y0 + 1, ix1 = b.x1 - 1, iy1 = b.y1 - 1;
    for (const L of b.lots || []) { if (L.b) L.b.removed = true; L.b = null; L.used = true; }
    for (const bb of W.buildings) if (!bb.removed && bb.x0 >= ix0 && bb.x1 <= ix1 && bb.y0 >= iy0 && bb.y1 <= iy1) bb.removed = true;
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) { set(x, y, TL.PLAZA); W.bIndex[tIdx(x, y)] = -1; }
    W.trees = W.trees.filter(t => !(t.x >= ix0 * T && t.x <= (ix1 + 1) * T && t.y >= iy0 * T && t.y <= (iy1 + 1) * T));
    W.parking = W.parking.filter(p => !(p.x >= ix0 * T && p.x <= (ix1 + 1) * T && p.y >= iy0 * T && p.y <= (iy1 + 1) * T));
    const mx = Math.floor((ix0 + ix1) / 2), my = Math.floor((iy0 + iy1) / 2);
    const main = build(b, ix0, iy0, ix1, iy1, mx, my);
    b.lots = [];
    const door = { x: (mx + 0.5) * T, y: (b.y1 + 0.5) * T, face: 1 };
    return { b, main, door };
  }
  function buildMilitaryIsland() {
    const rx = 58, ry = 36, M = 8;
    // 1) 바다만 있는 자리 중 본섬에 가장 가까운 곳
    let best = null, bd = 1e9;
    for (let cy = ry + M + 4; cy < MH - ry - M - 4; cy += 6) for (let cx = rx + M + 4; cx < MW - rx - M - 4; cx += 6) {
      let ok = true;
      for (let y = cy - ry - M; y <= cy + ry + M && ok; y += 2) for (let x = cx - rx - M; x <= cx + rx + M; x += 2) { if (((x - cx) / (rx + M)) ** 2 + ((y - cy) / (ry + M)) ** 2 > 1) continue; if (get(x, y) !== TL.WATER) { ok = false; break; } }
      if (!ok) continue;
      let near = 1e9; for (let r = rx + M; r < rx + 60 && near > 1e8; r += 2) for (let a = 0; a < TAU; a += 0.08) { const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * ry / rx); if (x > 0 && y > 0 && x < MW && y < MH && get(x, y) !== TL.WATER) { near = r; break; } }
      const W2 = W.airport ? Math.hypot(cx - W.airport.cx, cy - W.airport.cy) : 1e9;
      const score = near + (W2 < 260 ? 300 : 0);
      if (score < bd) { bd = score; best = { cx, cy }; }
    }
    if (!best) return;
    const { cx, cy } = best;
    const shape = (x, y) => { const a = Math.atan2((y - cy) / ry, (x - cx) / rx); const r = 1 + 0.08 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + 0.4) + 0.03 * Math.sin(a * 13); return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < r * r; };
    const inner = (x, y) => shape(x, y) && shape(x + 3, y) && shape(x - 3, y) && shape(x, y + 3) && shape(x, y - 3);
    for (let y = cy - ry - 4; y <= cy + ry + 4; y++) for (let x = cx - rx - 4; x <= cx + rx + 4; x++) {
      if (!shape(x, y)) continue; const i = tIdx(x, y);
      set(x, y, inner(x, y) ? TL.GRASS : TL.SAND); W.dist[i] = DIST.BASE;
    }
    const pave = (x0, y0, x1, y1, t = TL.LOT) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inner(x, y)) set(x, y, t); };
    // 활주로 + 평행 유도로 + 연결 유도로
    const rwy = cy - 12, rx0 = cx - rx + 14, rx1 = cx + rx - 14;
    pave(rx0, rwy, rx1, rwy + 5, TL.RUNWAY); W.runways.push({ x0: rx0 * T, y0: rwy * T, x1: (rx1 + 1) * T, y1: (rwy + 6) * T });
    pave(rx0 + 4, rwy + 8, rx1 - 4, rwy + 9); for (let x = rx0 + 6; x < rx1 - 4; x += 24) pave(x, rwy + 6, x + 1, rwy + 7);
    // 섬을 한 바퀴 도는 기지 도로
    for (let a = 0; a < TAU; a += 0.004) { const x = Math.round(cx + Math.cos(a) * (rx - 9)), y = Math.round(cy + Math.sin(a) * (ry - 8)); if (inner(x, y) && get(x, y) === TL.GRASS) { set(x, y, TL.LOT); if (inner(x + 1, y) && get(x + 1, y) === TL.GRASS) set(x + 1, y, TL.LOT); } }
    const mk = (x0, y0, x1, y1, h, kind, col) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!inner(x, y) || get(x, y) === TL.RUNWAY) return null; return addBuilding(x0, y0, x1, y1, h, kind, col); };
    // 격납고(아치 지붕) 계류장
    pave(cx - rx + 16, cy - 1, cx - 14, cy + 9);
    for (let k = 0; k < 3; k++) { const hx = cx - rx + 18 + k * 11; if (mk(hx, cy + 1, hx + 8, cy + 7, 8, 'hangar', '#5f6b4f')) W.decos.push({ t: 'vault', x0: hx * T, y0: (cy + 1) * T, x1: (hx + 9) * T, y1: (cy + 8) * T, z: 8, c: '#56604a' }); }
    // 관제탑 · 레이더
    if (mk(cx - 8, cy - 1, cx - 7, cy, 26, 'ctower', '#8a8f82')) W.decos.push({ t: 'cab', x: (cx - 7) * T, y: cy * T, z: 26, c: '#2b4a5a' });
    if (mk(cx - 3, cy + 1, cx - 2, cy + 2, 7, 'radar', '#7a8070')) W.decos.push({ t: 'dome', x: (cx - 2) * T, y: (cy + 2) * T, r: 5, z: 7, c: '#e8e8e8' });
    // 연병장 + 막사
    const px0 = cx + 2, py0 = cy + 4; pave(px0, py0, px0 + 12, py0 + 6, TL.PLAZA);
    for (let k = 0; k < 3; k++) { mk(px0 + k * 4 + 1, py0 - 3, px0 + k * 4 + 3, py0 - 2, 6, 'barracks', '#6d7358'); mk(px0 + k * 4 + 1, py0 + 8, px0 + k * 4 + 3, py0 + 9, 6, 'barracks', '#6d7358'); }
    // 연료 탱크 · 전차 주차장 · 헬기장
    const fx = cx + 18, fy = cy + 1; pave(fx, fy, fx + 10, fy + 8);
    for (const [dx, dy] of [[2, 2], [7, 2], [2, 6], [7, 6]]) if (mk(fx + dx - 1, fy + dy - 1, fx + dx, fy + dy, 6, 'tank', '#b8bcb4')) W.decos.push({ t: 'tankcyl', x: (fx + dx) * T, y: (fy + dy) * T, r: 5, z: 6, c: '#c9ccc4' });
    const tpx = cx + 32; pave(tpx, cy - 2, tpx + 12, cy + 8);
    W.helipads = [];
    for (const k of [0, 1]) { const hx = cx + 4 + k * 8, hy = cy + 16; pave(hx, hy - 3, hx + 5, hy + 2); W.helipads.push({ x: (hx + 3) * T, y: hy * T }); }
    // 부두 두 개 + 정박한 군함 (동쪽 바다)
    let ex = cx + rx; while (ex > cx && get(ex, cy + 4) === TL.WATER) ex--;
    for (const dy of [-2, 10]) { for (let k = 0; k < 26; k++) for (let d = 0; d < 3; d++) if (get(ex + k, cy + dy + d) === TL.WATER) { set(ex + k, cy + dy + d, TL.DOCK); W.dist[tIdx(ex + k, cy + dy + d)] = DIST.BASE; } }
    const ship = addBuilding(ex + 6, cy + 3, ex + 24, cy + 7, 7, 'ship', '#5d6670'); ship.label = '구축함';
    W.decos.push({ t: 'spire', x: (ex + 12) * T, y: (cy + 5) * T, z: 7, h: 12, c: '#4a525c' });
    // 울타리: 안쪽 경계를 따라 (정문 자리는 비운다)
    const fence = (x, y) => inner(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inner(x + dx, y + dy));
    // 2) 둑길: 섬 가장자리에서 본섬 도로까지
    const gate = linkToRoad(cx, cy, inner, shape);
    const gP = gate || { x: cx, y: cy + ry };
    for (let y = cy - ry; y <= cy + ry; y++) { let x = cx - rx; while (x <= cx + rx) { if (!fence(x, y) || Math.hypot(x - gP.x, y - gP.y) < 4 || get(x, y) === TL.LOT || get(x, y) === TL.RUNWAY) { x++; continue; } let x2 = x; while (x2 + 1 <= cx + rx && fence(x2 + 1, y) && Math.hypot(x2 + 1 - gP.x, y - gP.y) >= 4 && get(x2 + 1, y) !== TL.LOT) x2++; addBuilding(x, y, x2, y, 2.8, 'fence', '#6b6f63'); x = x2 + 1; } }
    // 나무
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (inner(x, y) && get(x, y) === TL.GRASS && hash2(x >> 2, y >> 2) < 0.3 && R() < 0.35) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
    W.base = { rx0: rx0 * T, rx1: (rx1 + 1) * T, x0: (cx - rx) * T, y0: (cy - ry) * T, x1: (cx + rx) * T, y1: (cy + ry) * T, gate: { x: (gP.x + 0.5) * T, y: (gP.y + 0.5) * T }, island: true,
      spots: {
        tanks: [{ x: (tpx + 3) * T, y: (cy + 3) * T, a: -Math.PI / 2 }, { x: (tpx + 9) * T, y: (cy + 3) * T, a: -Math.PI / 2 }],
        helis: W.helipads.map(h => ({ x: h.x, y: h.y, a: 0 })),
        jets: [{ x: (rx0 + 4) * T, y: (rwy + 1.5) * T, a: 0 }, { x: (rx0 + 4) * T, y: (rwy + 4.5) * T, a: 0 }],
      },
      guards: [[-4, 4], [4, 4], [-30, 6], [-10, -3], [14, 12], [30, 0], [-40, -4], [20, -6]].map(([dx, dy]) => ({ x: (cx + dx) * T, y: (cy + dy) * T })),
    };
    W.landmarks.push({ name: '포트 네온 기지', x: cx * T, y: cy * T });
  }
  // 페리의 '근린주구'(Perry, 1929): 동네 한가운데 초등학교 + 공원 (가게는 가장자리 큰길에)
  function buildNeighborhoods() {
    W.schools = [];
    W.hoods.forEach((h, i) => {
      if (h.d === DIST.DOWNTOWN) return;
      const r = landmarkBlock(h.u, h.v, b => !b.rural && !b.airport && b.district !== DIST.PARK && Math.hypot((b.x0 + b.x1) / 2 / MW - h.u, (b.y0 + b.y1) / 2 / MH - h.v) < 0.08, (b, ix0, iy0, ix1, iy1, mx, my) => {
        for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) set(x, y, TL.GRASS);
        const half = Math.floor((ix0 + ix1) / 2);
        for (let y = iy0 + 1; y < iy1; y++) for (let x = half + 1; x < ix1; x++) if (R() < 0.18) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
        for (let y = iy0; y <= iy1; y++) set(half, y, TL.PLAZA);
        const m = addBuilding(ix0 + 1, iy0 + 1, Math.max(ix0 + 2, half - 2), Math.max(iy0 + 2, Math.min(iy1 - 1, iy0 + 5)), 12, 'school', '#c98f5a'); m.label = `${h.name} 학교`;
        for (let y = Math.min(iy1 - 1, iy0 + 7); y < iy1; y++) for (let x = ix0 + 1; x < half - 1; x++) set(x, y, TL.SAND); // 운동장
        return m;
      });
      if (r) { r.b.district = DIST.PARK; r.b.park = `${h.name} 공원`; r.b.smallPark = true; W.places['school' + i] = { ...r.door, label: `${h.name} 학교`, lot: { x0: r.b.x0 + 1, y0: r.b.y0 + 1, x1: r.b.x1 - 1, y1: r.b.y1 - 1, block: r.b, b: r.main } }; W.schools.push('school' + i); }
    });
  }
  function buildLandmarks() {
    const core = b => b.district === DIST.DOWNTOWN || b.district === DIST.MIDTOWN;
    const place = (key, r, label) => { if (r) W.places[key] = { ...r.door, lot: { x0: r.b.x0 + 1, y0: r.b.y0 + 1, x1: r.b.x1 - 1, y1: r.b.y1 - 1, block: r.b, b: r.main }, label }; };
    // 네온 오페라 하우스: 돔 지붕
    place('biz_opera', landmarkBlock(0.6, 0.44, core, (b, ix0, iy0, ix1, iy1, mx, my) => {
      const w = Math.min(4, Math.floor((ix1 - ix0) / 2) - 1), h = Math.min(3, Math.floor((iy1 - iy0) / 2) - 1);
      const m = addBuilding(mx - w, my - h, mx + w, my + h, 18, 'opera', '#d9c9a3'); m.label = '오페라 하우스';
      W.decos.push({ t: 'dome', x: (mx + 0.5) * T, y: (my + 0.5) * T, r: Math.min(w, h) * T * 0.9, z: 18, c: '#6f9a86' });
      for (const [x, y] of [[ix0 + 1, iy0 + 1], [ix1 - 1, iy0 + 1], [ix0 + 1, iy1 - 1], [ix1 - 1, iy1 - 1]]) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
      W.landmarks.push({ name: '네온 오페라 하우스', x: (mx + 0.5) * T, y: (my + 0.5) * T });
      return m;
    }), '네온 오페라 하우스');
    // 노트르담식 대성당: 본당 + 앞쪽 쌍탑 + 첨탑
    landmarkBlock(0.44, 0.6, core, (b, ix0, iy0, ix1, iy1, mx, my) => {
      const top = Math.max(iy0 + 1, my - 5), bot = Math.min(iy1 - 1, my + 4);
      const m = addBuilding(mx - 2, top + 3, mx + 2, bot, 20, 'church', '#cfc6b0'); m.label = '대성당';
      addBuilding(mx - 3, top, mx - 1, top + 2, 36, 'church', '#c7bda5'); addBuilding(mx + 1, top, mx + 3, top + 2, 36, 'church', '#c7bda5');
      W.decos.push({ t: 'spire', x: (mx + 0.5) * T, y: ((top + 3 + bot) / 2 + 0.5) * T, z: 20, h: 22, c: '#5d6670' });
      W.landmarks.push({ name: '네온 대성당', x: (mx + 0.5) * T, y: (my + 0.5) * T });
      return m;
    });
    // 네온 아레나(경기장)
    place('biz_arena', landmarkBlock(0.64, 0.64, core, (b, ix0, iy0, ix1, iy1) => {
      const m = addBuilding(ix0 + 1, iy0 + 1, ix1 - 1, iy1 - 2, 16, 'arena', '#9aa3ad'); m.label = '네온 아레나';
      W.landmarks.push({ name: '네온 아레나', x: (ix0 + ix1 + 1) / 2 * T, y: (iy0 + iy1 + 1) / 2 * T });
      return m;
    }), '네온 아레나');
    // 네온 타워(에펠탑 느낌): 센트럴 파크 한가운데
    const cp = W.blocks.filter(b => b.park === '센트럴 파크').sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0))[0];
    if (cp) {
      const mx = Math.floor((cp.x0 + cp.x1) / 2), my = Math.floor((cp.y0 + cp.y1) / 2);
      for (let y = my - 4; y <= my + 5; y++) for (let x = mx - 4; x <= mx + 5; x++) if (x > cp.x0 && x < cp.x1 && y > cp.y0 && y < cp.y1) set(x, y, TL.PLAZA);
      W.trees = W.trees.filter(t => !(Math.abs(t.x / T - mx - 0.5) < 5.5 && Math.abs(t.y / T - my - 0.5) < 5.5));
      const m = addBuilding(mx - 1, my - 1, mx + 2, my + 2, 55, 'eiffel', '#8a6d4a'); m.label = '네온 타워';
      W.decos.push({ t: 'eiffel', x: (mx + 1) * T, y: (my + 1) * T, h: 140, c: '#8a6d4a' });
      W.places.biz_towerview = { x: (mx + 1) * T, y: (my + 4.5) * T, face: 1, label: '네온 타워 전망대' };
      W.landmarks.push({ name: '네온 타워', x: (mx + 1) * T, y: (my + 1) * T });
    }
  }

  // 4-2) 고속도로 바깥 차선 (roadK 6 = 가로 바깥 차선, 7 = 세로 바깥 차선)
  const hwLane = (x, y, k) => { if (x < 0 || y < 0 || x >= MW || y >= MH) return; const i = tIdx(x, y); if (W.tiles[i] === TL.ROAD) { if (W.roadK[i] !== k) W.roadK[i] = 3; return; } set(x, y, TL.ROAD); W.roadK[i] = k; };
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (i < NX - 1 && hE[i][j] && W.hwH.has(j)) for (let x = W.VX[i]; x < W.VX[i + 1] + 2; x++) { hwLane(x, W.HY[j] - 1, 6); hwLane(x, W.HY[j] + 2, 6); }
    if (j < NY - 1 && vE[i][j] && W.hwV.has(i)) for (let y = W.HY[j]; y < W.HY[j + 1] + 2; y++) { hwLane(W.VX[i] - 1, y, 7); hwLane(W.VX[i] + 2, y, 7); }
  }
  W.hwLine = new Uint8Array(MW * MH);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (i < NX - 1 && hE[i][j] && W.hwH.has(j)) for (let x = W.VX[i]; x < W.VX[i + 1] + 2; x++) for (let d = 0; d < 2; d++) W.hwLine[tIdx(x, W.HY[j] + d)] = 1;
    if (j < NY - 1 && vE[i][j] && W.hwV.has(i)) for (let y = W.HY[j]; y < W.HY[j + 1] + 2; y++) for (let d = 0; d < 2; d++) W.hwLine[tIdx(W.VX[i] + d, y)] = 1;
  }
  // 4-3) 바다·강 칸은 물로 (그 위를 지나는 도로 = 다리)
  //   도로가 없는 줄(칸 사이 띠)은 닿은 칸이 모두 땅일 때만 땅이다 (아니면 블록이 바다 위로 새어 나간다)
  const inBaseArea = (x, y) => ENABLE_BASE && x >= 3 && x <= MW * 0.36 + 5 && y >= 3 && y < W.HY[0];
  const colI = new Int16Array(MW).fill(-1), colS = new Uint8Array(MW), rowJ = new Int16Array(MH).fill(-1), rowS = new Uint8Array(MH);
  for (let i = 0; i < NX; i++) for (let x = W.VX[i]; x < (i < NX - 1 ? W.VX[i + 1] : W.VX[i] + 2); x++) { colI[x] = i; colS[x] = x < W.VX[i] + 2 ? 1 : 0; }
  for (let j = 0; j < NY; j++) for (let y = W.HY[j]; y < (j < NY - 1 ? W.HY[j + 1] : W.HY[j] + 2); y++) { rowJ[y] = j; rowS[y] = y < W.HY[j] + 2 ? 1 : 0; }
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (get(x, y) === TL.ROAD || inBaseArea(x, y)) continue;
    const i = colI[x], j = rowJ[y];
    if (i < 0 || j < 0) { set(x, y, TL.WATER); continue; }
    const xs = colS[x] ? [i - 1, i] : [i], ys = rowS[y] ? [j - 1, j] : [j];
    let land = true; for (const a of xs) for (const b of ys) if (!cl(a, b)) land = false;
    if (!land) set(x, y, TL.WATER);
  }
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const outside = x < W.VX[0] || y < W.HY[0] || x > W.VX[NX - 1] + 1 || y > W.HY[NY - 1] + 1;
    if (outside && !inBaseArea(x, y)) set(x, y, TL.WATER);
  }

  reserveAirport();

  // 5) 블록 찾기 (순환도로 내부의 비도로 영역을 flood fill)
  const bx0 = W.VX[0] + 2, bx1 = W.VX[NX - 1] - 1, by0 = W.HY[0] + 2, by1 = W.HY[NY - 1] - 1;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    if (get(x, y) === TL.ROAD || get(x, y) === TL.WATER || W.region[tIdx(x, y)] >= 0) continue;
    const id = W.blocks.length, stack = [[x, y]];
    let x0 = x, y0 = y, x1 = x, y1 = y;
    W.region[tIdx(x, y)] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
        if (get(nx, ny) === TL.ROAD || get(nx, ny) === TL.WATER || W.region[tIdx(nx, ny)] >= 0) continue;
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
  const eb = W.blocks[W.region[tIdx(W.etoile.cx, W.etoile.cy)]];
  if (eb) { eb.district = DIST.PARK; eb.park = '에투알 광장'; eb.etoile = true; W.etoile.block = eb; }

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
    if (b.etoile) { buildEtoile(b, ix0, iy0, ix1, iy1); continue; }
    if (W.rural((b.x0 + b.x1) / 2 / MW, (b.y0 + b.y1) / 2 / MH) && b.district !== DIST.HARBOR) { // 섬 끝의 숲·농가
      b.rural = true;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) { set(x, y, TL.GRASS); if (R() < 0.22) addTree((x + rr(0.2, 0.8)) * T, (y + rr(0.2, 0.8)) * T, 'tree'); }
      const L = { x0: ix0 + 1, y0: iy0 + 1, x1: Math.min(ix1 - 1, ix0 + 4), y1: Math.min(iy1 - 1, iy0 + 4), edge: true, block: b };
      if (L.x1 > L.x0 && L.y1 > L.y0) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.GRASS); W.trees = W.trees.filter(t => !(t.x >= L.x0 * T && t.x <= (L.x1 + 1) * T && t.y >= L.y0 * T && t.y <= (L.y1 + 1) * T)); L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(5, 7), 'house', rpick(PAL.house)); b.lots.push(L); }
      continue;
    }
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
      if (nearAirport(b)) { // 공항 완충 지대: 소음 때문에 낮은 밀도 — 물류창고 드문드문, 나머지는 풀밭
        if (R() < 0.3) L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(7, 11), 'warehouse', rpick(PAL.ware));
        else { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.GRASS); if (R() < 0.5) addTree((L.x0 + w / 2) * T, (L.y0 + h / 2) * T, 'tree'); L.kind = 'field'; }
        continue;
      }
      if (b.district === DIST.DOWNTOWN) {
        if (R() < 0.12) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.PLAZA); L.kind = 'plaza'; if (w >= 3 && h >= 3) addTree((L.x0 + w / 2) * T, (L.y0 + h / 2) * T, 'tree'); continue; }
        const core = 1 - clamp(Math.hypot(cx - 0.52, cy - 0.52) / 0.17, 0, 1);
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(18, 30) + core * rr(10, 32), 'tower', rpick(PAL.tower));
      } else if (b.district === DIST.MIDTOWN) {
        if (R() < 0.25 && w >= 2 && h >= 3) { for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) set(x, y, TL.LOT); L.kind = 'lot'; addParkingRow(L.x0, L.y0, L.x1, L.y1); continue; }
        L.b = addBuilding(L.x0, L.y0, L.x1, L.y1, rr(9, 22), 'mid', rpick(PAL.mid));
      } else if (b.district === DIST.RESID && R() < 0.55) { // 주택가 속 동네 가게(상가)
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

  // 6) 해안: 섬 둘레에 폭이 들쭉날쭉한 해안(산책로 → 남쪽 모래사장 / 동쪽 부두 / 나머지 풀밭·바위)
  const lastX = W.VX[NX - 1] + 1, lastY = W.HY[NY - 1] + 1;
  const riverT = new Uint8Array(MW * MH);
  for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NY - 1; j++) if (cellRiver[i][j]) for (let y = W.HY[j] + 2; y < W.HY[j + 1]; y++) for (let x = W.VX[i] + 2; x < W.VX[i + 1]; x++) riverT[tIdx(x, y)] = 1;
  W.riverT = riverT;
  const dL = new Uint8Array(MW * MH).fill(255); let front = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const i = tIdx(x, y); if (W.tiles[i] !== TL.WATER) { dL[i] = 0; front.push(i); } }
  for (let d = 1; d <= 6 && front.length; d++) {
    const nx = [];
    for (const i of front) { const x = i % MW, y = (i / MW) | 0; for (const [ax, ay] of DIRS) { const X = x + ax, Y = y + ay; if (X < 0 || Y < 0 || X >= MW || Y >= MH) continue; const j = tIdx(X, Y); if (dL[j] === 255 && !riverT[j]) { dL[j] = d; nx.push(j); } } }
    front = nx;
  }
  const cxT = MW * 0.5, cyT = MH * 0.52;
  for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
    const i = tIdx(x, y), d = dL[i];
    if (W.tiles[i] !== TL.WATER || d === 255 || d === 0 || riverT[i]) continue;
    const width = 2 + Math.round(2.5 * (0.5 + 0.5 * Math.sin(x * 0.11 + ph[0]) * Math.cos(y * 0.13 + ph[1])));
    if (d > width) continue;
    const u = (x - cxT) / MW, v = (y - cyT) / MH, ang = Math.atan2(v, u);
    const south = v > 0.18 && Math.abs(ang - Math.PI / 2) < 1.0, east = u > 0.2 && Math.abs(ang) < 0.9;
    if (inBaseArea(x, y)) continue;
    W.dist[i] = east ? DIST.HARBOR : south ? DIST.BEACH : DIST.COAST;
    set(x, y, d === 1 ? TL.WALK : east ? TL.DOCK : south ? TL.SAND : TL.GRASS);
  }
  // 블록 밖 남은 땅(기지 앞 등): 도로 옆은 인도, 나머지 풀밭
  for (let y = 3; y < MH - 4; y++) for (let x = 3; x < MW - 4; x++) {
    const t = get(x, y);
    if (t !== TL.GRASS || W.region[tIdx(x, y)] >= 0) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === TL.ROAD)) set(x, y, TL.WALK);
  }
  // 마리나: 해안에 붙은 넓은 바다 (보트가 세워지는 곳)
  W.marinas = [];
  const coastOK = (x, y) => get(x, y) === TL.WATER && get(x + 1, y) === TL.WATER && get(x, y + 1) === TL.WATER && get(x - 1, y) === TL.WATER && get(x, y - 1) === TL.WATER && !riverT[tIdx(x, y)];
  for (let k = 0; k < 400 && W.marinas.length < 18; k++) {
    const a = k / 400 * TAU * 3 + R() * 0.02;
    for (let r = 0.25; r < 0.55; r += 0.004) {
      const x = Math.round(cxT + Math.cos(a) * r * MW), y = Math.round(cyT + Math.sin(a) * r * MH);
      if (x < 4 || y < 4 || x >= MW - 4 || y >= MH - 4) break;
      if (!coastOK(x, y)) continue;
      const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const t = get(x - dx * 2, y - dy * 2); return t === TL.WALK || t === TL.DOCK || t === TL.SAND; });
      const px = (x + 0.5) * T, py = (y + 0.5) * T;
      if (shore && !W.marinas.some(m => dist(m.x, m.y, px, py) < 110)) W.marinas.push({ x: px, y: py, a: Math.atan2(py - cyT * T, px - cxT * T), car: null, cd: 0 });
      break;
    }
  }
  // 동쪽 항구 부두(바다로 길게 뻗은 잔교)
  for (let y = Math.floor(MH * 0.4); y < MH * 0.72; y += 14) {
    let x = MW - 3; while (x > MW / 2 && get(x, y) === TL.WATER) x--;
    if (x <= MW / 2 || W.dist[tIdx(x, y)] !== DIST.HARBOR && get(x, y) !== TL.DOCK && get(x, y) !== TL.WALK) continue;
    for (let k = 1; k <= 12 && x + k < MW - 3; k++) for (let d = 0; d < 2; d++) if (get(x + k, y + d) === TL.WATER && !riverT[tIdx(x + k, y + d)]) { set(x + k, y + d, TL.DOCK); W.dist[tIdx(x + k, y + d)] = DIST.HARBOR; }
  }
  // 부두 컨테이너 · 해변 야자수 · 해안 나무
  for (let y = 4; y < MH - 5; y += 3) for (let x = 4; x < MW - 5; x += 2) if (get(x, y) === TL.DOCK && get(x, y + 1) === TL.DOCK && get(x + 1, y) === TL.DOCK && R() < 0.3) addBuilding(x, y, x, y + 1, 2.6 * ri(1, 3), 'container', rpick(PAL.cont));
  for (let y = 4; y < MH - 4; y++) for (let x = 4; x < MW - 4; x++) {
    const t = get(x, y);
    if (t === TL.SAND && R() < 0.05) addTree((x + 0.5) * T, (y + 0.5) * T, 'palm');
    else if (t === TL.GRASS && W.region[tIdx(x, y)] < 0 && !inBaseArea(x, y) && R() < 0.14) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
  }

  // 6-2) 포트 네온 군사 기지 (GTA V의 포트 잔쿠도처럼 들어가면 ★★★★)
  //   네모 상자가 아니라 진짜 기지처럼: 모서리를 깎은 울타리, 활주로 + 평행 유도로 + 연결 유도로, 아치 지붕 격납고,
  //   관제탑·레이더 돔, 연료 탱크, 연병장을 둘러싼 막사, 기지 안 도로, 나무 숲
  W.base = null; W.helipads = W.helipads || [];
  if (ENABLE_BASE) {
    const X0 = 6, X1 = Math.min(MW - 7, Math.round(MW * 0.36)), Y0 = 5, Y1 = 30, C = 7;
    let gx = W.VX[0]; for (const x of W.VX) if (Math.abs(x - 64) < Math.abs(gx - 64)) gx = x; // 정문 = 가운데쯤 세로 도로의 연장선
    const inside = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && Math.min(x - X0 + y - Y0, X1 - x + y - Y0, x - X0 + Y1 - y, X1 - x + Y1 - y) >= C;
    W.trees = W.trees.filter(t => !(t.x >= (X0 - 1) * T && t.x <= (X1 + 2) * T && t.y <= (Y1 + 1) * T));
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { if (!inside(x, y)) { set(x, y, TL.GRASS); continue; } set(x, y, TL.GRASS); W.dist[tIdx(x, y)] = DIST.BASE; }
    const pave = (x0, y0, x1, y1, t = TL.LOT) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) set(x, y, t); };
    pave(X0 + 8, Y0 + 4, X1 - 8, Y0 + 8, TL.RUNWAY);                       // 활주로 (약 650m)
    W.runways.push({ x0: (X0 + 8) * T, y0: (Y0 + 4) * T, x1: (X1 - 7) * T, y1: (Y0 + 9) * T });
    pave(X0 + 12, Y0 + 11, X1 - 12, Y0 + 12);                             // 평행 유도로
    for (let x = X0 + 14; x < X1 - 12; x += 28) pave(x, Y0 + 9, x + 1, Y0 + 10); // 연결 유도로
    pave(X0 + 10, Y0 + 13, X0 + 48, Y0 + 22);                             // 격납고 앞 계류장
    pave(X0 + 8, Y1 - 5, X1 - 8, Y1 - 4);                                 // 기지 안 순환 도로
    pave(gx, Y0 + 12, gx + 1, Y1 + 3);                                     // 정문 진입로
    for (let y = Y1 + 1; y <= Y1 + 3; y++) for (let x = gx; x <= gx + 1; x++) { set(x, y, TL.ROAD); W.roadK[tIdx(x, y)] = 1; }
    const clear = (x0, x1) => x1 < gx - 1 || x0 > gx + 2;
    const bld = (x0, y0, x1, y1, h, kind, col) => clear(x0, x1) ? addBuilding(x0, y0, x1, y1, h, kind, col) : null;
    // 아치 지붕 격납고 3동
    for (const hx of [X0 + 12, X0 + 24, X0 + 36]) { const hb = bld(hx, Y0 + 15, hx + 8, Y0 + 20, 8, 'hangar', '#5f6b4f'); if (hb) W.decos.push({ t: 'vault', x0: hx * T, y0: (Y0 + 15) * T, x1: (hx + 9) * T, y1: (Y0 + 21) * T, z: 8, c: '#56604a' }); }
    // 관제탑 + 레이더 돔
    const ct = bld(gx + 5, Y0 + 14, gx + 6, Y0 + 15, 26, 'ctower', '#8a8f82'); if (ct) W.decos.push({ t: 'cab', x: (gx + 6) * T, y: (Y0 + 15) * T, z: 26, c: '#2b4a5a' });
    const rd = bld(gx + 24, Y0 + 15, gx + 25, Y0 + 16, 7, 'radar', '#7a8070'); if (rd) W.decos.push({ t: 'dome', x: (gx + 25) * T, y: (Y0 + 16) * T, r: 5, z: 7, c: '#e8e8e8' });
    // 연병장 + 막사 (ㄷ자로 둘러싼 작은 건물들)
    const px0 = gx + 34, py0 = Y0 + 15;
    pave(px0, py0, px0 + 12, py0 + 6, TL.PLAZA);
    for (let k = 0; k < 3; k++) { bld(px0 + k * 4 + 1, py0 - 3, px0 + k * 4 + 3, py0 - 2, 6, 'barracks', '#6d7358'); bld(px0 + k * 4 + 1, py0 + 8, px0 + k * 4 + 3, py0 + 9, 6, 'barracks', '#6d7358'); }
    bld(px0 + 14, py0 + 1, px0 + 15, py0 + 5, 7, 'barracks', '#737a5c');
    bld(gx - 13, Y0 + 22, gx - 5, Y0 + 23, 6, 'barracks', '#6d7358');
    // 연료 탱크 4기
    const fx = X1 - 58, fy = Y0 + 15; pave(fx, fy, fx + 11, fy + 7);
    for (const [dx, dy] of [[2, 2], [7, 2], [2, 6], [7, 6]]) { bld(fx + dx - 1, fy + dy - 1, fx + dx, fy + dy, 6, 'tank', '#b8bcb4'); W.decos.push({ t: 'tankcyl', x: (fx + dx) * T, y: (fy + dy) * T, r: 5, z: 6, c: '#c9ccc4' }); }
    // 울타리: 깎인 모서리를 따라 (가로로 이어진 칸은 한 건물로 합친다) + 정문 틈 + 모서리 감시탑
    const edge = (x, y) => inside(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy));
    for (let y = Y0; y <= Y1; y++) {
      let x = X0;
      while (x <= X1) {
        if (!edge(x, y) || (y === Y1 && x >= gx && x <= gx + 1)) { x++; continue; }
        let x2 = x; while (x2 + 1 <= X1 && edge(x2 + 1, y) && !(y === Y1 && x2 + 1 >= gx && x2 + 1 <= gx + 1)) x2++;
        if (get(x, y) !== TL.RUNWAY) addBuilding(x, y, x2, y, 2.8, 'fence', '#6b6f63');
        x = x2 + 1;
      }
    }
    for (const [x, y] of [[X0 + C, Y0 + 1], [X1 - C, Y0 + 1], [X0 + C, Y1 - 1], [X1 - C, Y1 - 1], [X0 + 1, Y0 + C], [X1 - 1, Y0 + C]]) if (get(x, y) !== TL.BUILD) addBuilding(x, y, x, y, 9, 'watchtower', '#7a6a4a');
    // 헬기 착륙장 두 곳 + 전차 주차장
    W.helipads = [];
    const hpX = X1 - 38;
    for (const k of [0, 1]) { const cx = hpX + k * 8; pave(cx, Y0 + 14, cx + 5, Y0 + 19); W.helipads.push({ x: (cx + 3) * T, y: (Y0 + 17) * T }); }
    pave(X1 - 24, Y0 + 21, X1 - 10, Y1 - 6);
    // 풀밭 곳곳 나무
    for (let y = Y0 + 13; y < Y1 - 5; y++) for (let x = X0 + 4; x <= X1 - 4; x++) if (inside(x, y) && get(x, y) === TL.GRASS && hash2(x * 0.3 | 0, y * 0.3 | 0) < 0.35 && R() < 0.3) addTree((x + 0.5) * T, (y + 0.5) * T, 'tree');
    W.base = { rx0: (X0 + 8) * T, rx1: (X1 - 7) * T, x0: (X0 + 1) * T, y0: (Y0 + 1) * T, x1: X1 * T, y1: Y1 * T, gate: { x: (gx + 1) * T, y: (Y1 + 0.5) * T },
      spots: {
        tanks: [{ x: (X1 - 20) * T, y: (Y1 - 8) * T, a: -Math.PI / 2 }, { x: (X1 - 13) * T, y: (Y1 - 8) * T, a: -Math.PI / 2 }],
        helis: W.helipads.map(h => ({ x: h.x, y: h.y, a: 0 })),
        jets: [{ x: (X0 + 12) * T, y: (Y0 + 5) * T + 1, a: 0 }, { x: (X0 + 12) * T, y: (Y0 + 8) * T, a: 0 }], // 활주로 서쪽 끝, 동쪽을 향해
      },
      guards: [{ x: (gx - 1) * T, y: (Y1 - 2) * T }, { x: (gx + 3) * T, y: (Y1 - 2) * T }, { x: (X0 + 20) * T, y: (Y0 + 23) * T }, { x: (gx + 14) * T, y: (Y0 + 23) * T }, { x: (X1 - 30) * T, y: (Y0 + 20) * T }, { x: (X1 - 14) * T, y: (Y1 - 3) * T }, { x: (X0 + 60) * T, y: (Y0 + 13) * T }, { x: (X0 + 90) * T, y: (Y0 + 13) * T }],
    };
  }

  // 6-2b) 군사 섬 (참고: 바다 위 군사 기지 섬 위성 사진) — 본섬 옆 바다에 따로 떨어진 섬, 둑길로 연결
  buildAirportIsland();
  buildMilitaryIsland();

  // 6-3) 파리처럼: 에투알 광장에서 뻗는 8개의 가로수 대로 + 둥근 그랑 불바르 + 랜드마크
  carveBoulevards();
  buildLandmarks();
  buildNeighborhoods();

  // 기지 정문 앞 인도: 국방 후원 창구
  {
    const gt = W.base ? W.base.gate : W.depot ? W.depot.door : { x: MW * T / 2, y: MH * T / 2 }, tx0 = Math.floor(gt.x / T) + 3, ty0 = Math.floor(gt.y / T) + 3;
    let spot = null;
    for (let r = 0; r < 14 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) { if (get(tx0 + dx, ty0 + dy) === TL.WALK) { spot = { x: (tx0 + dx + 0.5) * T, y: (ty0 + dy + 0.5) * T }; break; } }
    if (!W.base && W.depot) spot = { x: W.depot.door.x, y: W.depot.door.y - 2 * T };
    if (W.base && W.base.island) spot = sidewalkNearT(W.base.gate.x, W.base.gate.y) || { x: W.base.gate.x + 3 * T, y: W.base.gate.y };
    if (spot) W.places.milgate = { ...spot, label: W.base ? '기지 정문 (국방 후원)' : '국방부 출장소 (국방 후원)' };
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
  // v2.6 사업체 13곳 추가 (카페·주유소·쇼핑몰·시장·미술관·백화점·양조장·골프장·스파·제약·빵집·비스트로)
  for (const [k, u, v, kinds, col, label] of [
    ['biz_cafe', 0.5, 0.47, ['tower', 'mid'], '#8a5a3c', '카페 파리지앵'], ['biz_bakery', 0.42, 0.4, ['mid', 'house'], '#e9c98a', '불랑제리 네온'],
    ['biz_bistro', 0.56, 0.52, ['tower', 'mid'], '#7a2d3a', '비스트로 에투알'], ['biz_gas1', 0.3, 0.2, ['mid', 'house', 'warehouse'], '#d7263d', '네온 주유소 노스'],
    ['biz_gas2', 0.7, 0.78, ['mid', 'shop', 'warehouse'], '#d7263d', '네온 주유소 사우스'], ['biz_mall', 0.84, 0.46, ['warehouse', 'mid'], '#5b7fa6', '하버 쇼핑몰'],
    ['biz_market', 0.4, 0.66, ['mid'], '#c46f1b', '올드 타운 시장'], ['biz_gallery', 0.47, 0.36, ['mid', 'tower'], '#f2f2f2', '루미에르 미술관'],
    ['biz_dept', 0.57, 0.4, ['tower'], '#2b2d42', '갤러리 네온 백화점'], ['biz_brewery', 0.34, 0.82, ['warehouse'], '#6b4a2a', '러스트 양조장'],
    ['biz_golf', 0.26, 0.14, ['house', 'mid'], '#3f8a3a', '파인 크레스트 골프 클럽'], ['biz_spa', 0.8, 0.18, ['house', 'mid'], '#6fe0ff', '레이크뷰 스파'],
    ['biz_pharma', 0.15, 0.5, ['mid', 'house', 'warehouse'], '#3ee07a', '로즈우드 제약'],
  ]) makePlace(k, anyLot(u, v, kinds), 'biz', col, label);
  // 동네마다 생활 시설 두 곳 (편의점 + 버거/약국/옷/총포상/체육관 돌아가며)
  W.branches = [];
  const BR = [['burger', '버', '#ffb347', '버거 샷', '#f3d9b1'], ['pharmacy', '약', '#3ee07a', '약국', '#e8fff0'], ['clothes', '옷', '#e07aff', '옷가게', '#f4d6e8'], ['ammu', '총', '#ff6b5a', '총포상', '#3b3b3b'], ['gym', '체', '#ff9f43', '체육관', '#2b2b2b']];
  W.hoods.forEach((h, i) => {
    const sets = [['mart', '편', '#7ae68f', '24 편의점', '#dfe8e0'], BR[i % BR.length]];
    sets.forEach(([kind, ch, c, label, bc], k) => {
      const L = anyLot(h.u + (k ? 0.025 : -0.02), h.v + (k ? -0.02 : 0.02), ['mid', 'house', 'shop', 'warehouse', 'tower']);
      if (!L) return; const key = `br${i}${k}`;
      makePlace(key, L, kind, bc, label); W.branches.push({ key, kind, ch, c, label }); if (typeof PLACE_MARK !== 'undefined') PLACE_MARK[key] = c;
    });
  });
  makePlace('biz_casino', choose(edgeLots(DIST.DOWNTOWN, L => !L.used && bld('tower')(L)), 0.58, 0.6), 'casino', '#1d1233', '다이아몬드 카지노');
  // 긴급 시설 커버리지 배치 (Toregas et al. 1971, 위치 집합 커버링의 탐욕 근사):
  //   모든 교차로가 반경 안에 들 때까지, 아직 못 덮은 교차로를 가장 많이 덮는 필지에 시설을 하나씩 더한다
  const cover = (kind, existing, radius, maxN, col, label, bk, shop, ch, icol) => {
    const dem = W.nodes.filter(n => n.deg), covered = new Uint8Array(W.nodes.length);
    const mark = (x, y) => { for (const n of dem) if (Math.hypot(n.x - x, n.y - y) < radius) covered[n.id] = 1; };
    for (const k of existing) if (W.places[k]) mark(W.places[k].x, W.places[k].y);
    const cands = W.blocks.flatMap(b => b.lots.filter(L => L.edge && !L.used && L.b && ['mid', 'house', 'shop', 'warehouse', 'tower'].includes(L.b.kind)));
    for (let n = 1; n <= maxN; n++) {
      if (dem.every(d => covered[d.id])) break;
      let best = null, bs = 0;
      for (let c = 0; c < cands.length; c += 3) { const L = cands[c]; if (L.used) continue; const x = (L.x0 + L.x1 + 1) / 2 * T, y = (L.y0 + L.y1 + 1) / 2 * T; let sc = 0; for (const d of dem) if (!covered[d.id] && Math.hypot(d.x - x, d.y - y) < radius) sc++; if (sc > bs) { bs = sc; best = L; } }
      if (!best || bs < 3) break;
      const key = `${kind}_c${n}`; makePlace(key, best, bk, col, label); mark(W.places[key].x, W.places[key].y);
      W.branches.push({ key, kind: shop, ch, c: icol, label });
    }
  };
  cover('hospital', ['hospital', 'clinic', 'hospital2', 'hospital3'], 520, 6, '#e9ecef', '종합병원', 'hospital', 'hospital_st', 'H', '#e0443e');
  cover('police', ['police', 'police2', 'police3'], 560, 6, '#2c3e66', '경찰서', 'police', 'police_st', 'P', '#4b8fe8');
  cover('fire', [], 480, 8, '#b3261e', '소방서', 'fire', 'fire_st', '소', '#ff6b3d');
  const nearA = W.airport && anyLot(W.airport.cx / MW, (W.airport.by1 + 30) / MH, ['warehouse', 'mid', 'house']);
  if (nearA) makePlace('biz_airhotel', nearA, 'biz', '#8fb3c9', '에어포트 호텔');
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
  W.nodeGrid = gridMake(N.filter(n => n.deg), n => n.x, n => n.y);
  W.blockGrid = gridMake(W.blocks, b => (b.x0 + b.x1 + 1) / 2 * T, b => (b.y0 + b.y1 + 1) / 2 * T);
}
// 반경 r 안(대략)의 도로 구간 / 블록 — 구간 길이만큼 여유를 둔다
const edgesNear = (x, y, r) => gridQuery(World.edgeGrid, x, y, r + 40);
const blocksNear = (x, y, r) => gridQuery(World.blockGrid, x, y, r + 40);

// 가까운 인도 (결정적 탐색, 생성 중에 쓴다)
function sidewalkNearT(x, y) {
  const cx = Math.floor(x / T), cy = Math.floor(y / T);
  for (let r = 3; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= MW || Y >= MH) continue; if (World.tiles[tIdx(X, Y)] === TL.WALK) return { x: (X + 0.5) * T, y: (Y + 0.5) * T }; }
  return null;
}
function treesNear(x, y) {
  const out = [], cx = Math.floor(x / 8), cy = Math.floor(y / 8);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = World.treeGrid.get((cx + a) + ',' + (cy + b)); if (l) out.push(...l); }
  return out;
}

const MINI_COL = { [TL.WATER]: '#1d4e6e', [TL.ROAD]: '#c9ccd2', [TL.WALK]: '#8b8f96', [TL.BUILD]: '#39404c', [TL.GRASS]: '#3f6b3a', [TL.SAND]: '#c9b37c', [TL.LOT]: '#5d6168', [TL.PLAZA]: '#8f8577', [TL.DOCK]: '#6b6f73', [TL.RUNWAY]: '#2a2c30' };
function buildMinimap() {
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d'), img = g.createImageData(MW, MH);
  const bm = World.boulevardMask, E = World.etoile;
  for (let i = 0; i < MW * MH; i++) {
    let col = MINI_COL[World.tiles[i]];
    // 지도 색: 옛길·해안도로·방사로·골목은 일반 도로와 같은 색 계열(골목은 조금 어둡게), 고속도로만 주황
    if (bm && bm[i] === 2) col = '#aeb2b9';
    else if (World.tiles[i] === TL.ROAD && (World.roadK[i] >= 6 || (World.hwLine && World.hwLine[i]))) col = '#f0a04b';
    if (E && E.R && Math.hypot(i % MW + 0.5 - E.cx, Math.floor(i / MW) + 0.5 - E.cy) < E.R && World.tiles[i] === TL.PLAZA) col = '#f2e6bf';
    const n = parseInt(col.slice(1), 16);
    img.data[i * 4] = (n >> 16) & 255; img.data[i * 4 + 1] = (n >> 8) & 255; img.data[i * 4 + 2] = n & 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  World.mini = c;
}

// 고속도로 구간인가 (노드 id 두 개)
function edgeHighway(a, b) {
  const A = World.nodes[a], B = World.nodes[b]; if (!A || !B || !World.hwH) return false;
  return A.j === B.j ? World.hwH.has(A.j) : A.i === B.i ? World.hwV.has(A.i) : false;
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
  if (!best) for (const n of World.nodes) { if (!n.deg) continue; const d = dist2(x, y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
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
  const rk = World.roadK[tIdx(tx, ty)]; if (rk === 4 || rk === 5) return 0; // 대로·골목은 보행자도 다닌다
  if (!isCrosswalk(tx, ty)) return 2;
  const n = nearestNode(x, y);
  if (!n.light) return 1;
  const carDir = World.roadK[tIdx(tx, ty)] === 1 ? 1 : 0; // 세로 도로면 남북 신호
  return lightState(n, carDir) === 'r' ? 1 : 2;
}
