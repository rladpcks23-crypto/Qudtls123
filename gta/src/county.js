'use strict';
/* =====================================================================
 * county.js — 레드 카운티: 도시 섬 동쪽 바다 건너의 시골 (v2.17)
 *
 * GTA5의 블레인 카운티를 참고한 구성: 긴 다리 두 개로 도시 고속도로와 이어지고,
 *   사막(레드 메사) · 호수(솔트 레이크) · 큰 산(실버 피크)과 작은 산(블랙 리지) · 메사 ·
 *   침엽수 숲(블랙우드) · 농장(골든 필즈) · 사막 마을(샌디 밸리)과 경비행장 · 북쪽 어촌(파인 베이).
 * 도시는 genCity가 예전과 똑같이 640×640으로 만든다 → widenWorld가 배열을 넓힌다 → genCounty가 붙인다.
 * 도시 쪽 번호(블록·건물·노드)는 그대로라 예전 저장(조직 구역·개발 필지)이 깨지지 않는다.
 * ===================================================================== */

// 배열 폭을 넓힌다 (도시 칸은 그대로 복사, 새 칸은 바다)
function widenWorld(nw, nh) {
  const W = World, ow = MW, oh = MH, n0 = ow * oh;
  const fillOf = { tiles: TL.WATER, region: -1, bIndex: -1, dist: DIST.COAST, hoodT: 255 };
  for (const k of Object.keys(W)) {
    const a = W[k];
    if (!ArrayBuffer.isView(a) || a.length !== n0) continue;
    const b = new a.constructor(nw * nh); if (fillOf[k] !== undefined) b.fill(fillOf[k]);
    for (let y = 0; y < oh; y++) b.set(a.subarray(y * ow, y * ow + ow), y * nw);
    W[k] = b;
  }
  MW = nw; MH = nh;
}

// 산 높이(m) — 타일 좌표(실수). 3D 산 메시와 막힌 칸(ROCK)이 같은 함수를 쓴다
function mountainH(tx, ty) {
  let h = 0;
  for (const m of World.mountains || []) {
    const dx = tx - m.x, dy = ty - m.y, d2 = dx * dx + dy * dy;
    if (d2 >= m.rMax * m.rMax) continue;
    const a = Math.atan2(dy, dx), r = m.r * (1 + m.n1 * Math.sin(3 * a + m.p1) + m.n2 * Math.sin(7 * a + m.p2) + 0.04 * Math.sin(13 * a + m.p1 * 2));
    const q = Math.sqrt(d2) / r; if (q >= 1) continue;
    let v;
    if (m.mesa) { const s = clamp((1 - q) / 0.28, 0, 1); v = m.h * s * s * (3 - 2 * s) * (0.95 + 0.05 * Math.sin(dx * 0.7) * Math.cos(dy * 0.6)); }
    else v = m.h * Math.pow(1 - q, 1.45) * (1 + 0.13 * Math.sin(dx * 0.29 + m.p1) * Math.sin(dy * 0.25 + m.p2));
    if (v > h) h = v;
  }
  return h;
}

// 산길 위의 높이(m): 실버 피크 산길·정상 광장 칸이면 산 표면 높이, 아니면 0 (3D 위치·카메라·오르막 물리)
function groundZ(x, y) {
  const M = World.mtMask; if (!M) return 0;
  const tx = Math.floor(x / T), ty = Math.floor(y / T); if (tx < 0 || ty < 0 || tx >= MW || ty >= MH || !M[tx + ty * MW]) return 0;
  return mountainH(x / T, y / T);
}

const COUNTY_ZONES = [ // 동네 이름 (카운티 칸의 위치 이름) · w가 작을수록 좁다
  { name: '샌디 밸리', x: 900, y: 438, w: 0.55 },
  { name: '파인 베이', x: 1300, y: 58, w: 0.55 },
  { name: '골든 필즈', x: 1235, y: 470, w: 0.9 },
  { name: '레드 메사 사막', x: 830, y: 530, w: 1 },
  { name: '실버 피크', x: 975, y: 112, w: 0.8 },
  { name: '솔트 레이크', x: 1010, y: 335, w: 0.9 },
  { name: '블랙우드 숲', x: 1170, y: 120, w: 1 },
  { name: '블랙 리지', x: 1250, y: 290, w: 0.8 },
  { name: '레드 카운티 평원', x: 790, y: 240, w: 1 },
  { name: '레드 록', x: 720, y: 304, w: 0.5 },
];

function genCounty(seed) {
  const W = World, R = mulberry32((seed ^ 0x2c1b3c6d) >>> 0), rr = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1));
  const rpick = a => a[Math.floor(R() * a.length)];
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const set = (x, y, t) => { if (inMap(x, y)) W.tiles[x + y * MW] = t; };
  const get = (x, y) => inMap(x, y) ? W.tiles[x + y * MW] : TL.WATER;
  const ph = [0, 0, 0, 0, 0, 0].map(() => R() * TAU);
  W.rockH = new Uint8Array(MW * MH);
  W.hwEdges = new Set();
  W.mapLabels = [];
  W.county = { x0: CITY_W, farms: [], fish: [], towns: [] };

  // ---------- 1) 땅: 도시 땅에서 34칸 넘게 떨어진 해안선 ----------
  const cityMaxX = new Int16Array(MH).fill(-1);
  for (let y = 0; y < CITY_H; y++) for (let x = CITY_W - 1; x >= CITY_W - 260; x--) if (W.tiles[x + y * MW] !== TL.WATER) { cityMaxX[y] = x; break; }
  const westX = new Int16Array(MH);
  for (let y = 0; y < MH; y++) {
    let m = -1; for (let d = -34; d <= 34; d++) { const yy = y + d; if (yy >= 0 && yy < MH) m = Math.max(m, cityMaxX[yy]); }
    westX[y] = Math.max(Math.round(669 + 11 * Math.sin(y * 0.019 + ph[0]) + 5 * Math.sin(y * 0.071 + ph[1]) + 2 * Math.sin(y * 0.2)), m + 36);
  }
  // v2.21: 진짜 섬처럼 — 굽은 해안선 + 만(물이 파고든 곳)으로 네모난 윤곽을 깬다
  const eastX = y => Math.round(MW - 24 + 9 * Math.sin(y * 0.019 + ph[2]) + 4 * Math.sin(y * 0.07 + ph[3]) + 2 * Math.sin(y * 0.2));
  const northY = x => Math.round(14 + 9 * Math.sin(x * 0.014 + ph[4]) + 3 * Math.sin(x * 0.061) + 1.5 * Math.sin(x * 0.19));
  const southY = x => Math.round(MH - 24 + 8 * Math.sin(x * 0.017 + ph[5]) + 3 * Math.sin(x * 0.07 + ph[0]) + 1.5 * Math.sin(x * 0.21));
  const BAYS = [ // [cx, cy, rx, ry] 타일 — 바깥 순환도로가 없는 귀퉁이·해안을 파고든다
    [640, -40, 300, 205], // 북서 큰 만 (실버 피크 앞바다)
    [650, 655, 165, 118], // 남서 만 (사막 해안)
    [1205, -12, 95, 38], [1412, 238, 62, 70], [1410, 520, 58, 46], [1015, 662, 80, 52], // 북·동·남 작은 만
    [1440, -30, 95, 72], [1440, 675, 110, 78], // 북동·남동 귀퉁이 둥글게
  ];
  const inBay = (x, y) => BAYS.some(([cx, cy, rx, ry]) => { const a = Math.atan2(y - cy, x - cx); return Math.hypot((x - cx) / rx, (y - cy) / ry) < 1 + 0.06 * Math.sin(5 * a + cx) + 0.035 * Math.sin(11 * a + cy); });
  const land = (x, y) => y >= 0 && y < MH && x >= westX[y] && x <= eastX(y) && y >= northY(x) && y <= southY(x) && !inBay(x, y);
  const lake = { x: 1010, y: 335, rx: 100, ry: 52 };
  const lakeR = (x, y) => { const a = Math.atan2(y - lake.y, x - lake.x); return Math.hypot((x - lake.x) / lake.rx, (y - lake.y) / lake.ry) / (1 + 0.08 * Math.sin(3 * a + ph[1]) + 0.05 * Math.sin(5 * a + ph[2])); };
  const desert = (x, y) => { const n = 16 * Math.sin(x * 0.021 + ph[3]) + 12 * Math.sin(y * 0.026 + ph[4]); return (y > 382 + n && x < 1140 + n) || (x < 830 + n && y > 290 + n); };
  const zone = new Uint8Array(MW * MH).fill(255);
  const hood0 = W.hoods.length;
  for (const z of COUNTY_ZONES) W.hoods.push({ name: z.name, d: DIST.COAST, u: z.x / MW, v: z.y / MH, county: true });
  for (let y = 0; y < MH; y++) for (let x = CITY_W; x < MW; x++) {
    if (!land(x, y)) continue;
    const i = x + y * MW, lr = lakeR(x, y);
    let t = desert(x, y) ? TL.SAND : TL.GRASS;
    if (lr < 1) t = TL.WATER;
    else if (lr < 1.07) t = TL.SAND; // 호숫가 모래
    else if (!land(x + 3, y) || !land(x - 3, y) || !land(x, y + 3) || !land(x, y - 3)) t = TL.SAND; // 바닷가
    W.tiles[i] = t;
    let best = 0, bd = 1e9;
    COUNTY_ZONES.forEach((z, k) => { const d = Math.hypot(x - z.x, y - z.y) * z.w; if (d < bd) { bd = d; best = k; } });
    W.hoodT[i] = hood0 + best;
  }
  for (const z of COUNTY_ZONES) W.mapLabels.push({ name: z.name, x: z.x * T, y: z.y * T });

  // ---------- 2) 산 · 메사 ----------
  W.mountains = [
    { name: '실버 피크', x: 975, y: 112, r: 58, h: 125 },
    { name: '블랙 리지', x: 1250, y: 290, r: 34, h: 62 },
    { x: 780, y: 330, r: 17, h: 34, mesa: true },
    { x: 790, y: 545, r: 15, h: 28, mesa: true },
    { x: 1080, y: 440, r: 13, h: 24, mesa: true },
  ];
  for (const m of W.mountains) { m.n1 = m.mesa ? rr(0.05, 0.1) : rr(0.07, 0.11); m.n2 = rr(0.03, 0.05); m.p1 = R() * TAU; m.p2 = R() * TAU; m.rMax = m.r * (1 + m.n1 + m.n2 + 0.04); }
  for (const m of W.mountains) {
    const r = Math.ceil(m.rMax) + 1;
    for (let y = m.y - r; y <= m.y + r; y++) for (let x = m.x - r; x <= m.x + r; x++) {
      if (!inMap(x, y) || get(x, y) === TL.WATER) continue;
      const h = mountainH(x + 0.5, y + 0.5), i = x + y * MW;
      if (h >= 2) { W.tiles[i] = TL.ROCK; W.rockH[i] = Math.min(255, Math.round(h)); }
      else if (h > 0.3 && W.tiles[i] === TL.GRASS && !m.mesa) W.tiles[i] = TL.SAND; // 산기슭 흙
    }
  }

  // ---------- 3) 다리: 도시 고속도로 두 줄의 동쪽 끝에서 바다를 건넌다 ----------
  let maxWest = 0; for (let y = 30; y < MH - 30; y++) maxWest = Math.max(maxWest, westX[y]);
  const XA = Math.max(700, maxWest + 10), X2 = 880, X3 = 1150, XB = 1330, YN = 40, YS = 590;
  const onAirport = (x, y) => W.airport && x >= W.airport.bx0 && x <= W.airport.bx1 && y >= W.airport.by0 && y <= W.airport.by1;
  const bridgeOK = n => {
    const y0 = W.HY[n.j];
    for (let x = W.VX[n.i] + 2; x < XA; x++) for (let y = y0 - 1; y <= y0 + 2; y++) {
      const t = get(x, y);
      if (t === TL.BUILD || t === TL.RUNWAY || t === TL.ROCK || onAirport(x, y)) return false; // 해안 부두(DOCK) 칸은 다리가 지나가도 된다
      if (x < CITY_W && W.region[x + y * MW] >= 0) return false; // 도시 블록 안을 가로지르지 않는다
      if (x >= CITY_W && y0 > 150 && y0 < 560 && t === TL.WATER && x > westX[y] + 2) return false; // 카운티 호수로 빠지지 않게
    }
    return true;
  };
  const endNode = j => { let best = null; for (const n of W.nodes) if (n.deg && n.j === j && (!best || n.i > best.i)) best = n; return best; };
  const pickBridge = (target, lo, hi) => {
    let best = null, bs = 1e9;
    for (let j = 1; j < W.NY - 1; j++) {
      const y = W.HY[j]; if (y < lo || y > hi) continue;
      const n = endNode(j); if (!n || n.adj[0] >= 0 || !bridgeOK(n)) continue;
      const sc = Math.abs(y - target) + (W.hwH.has(j) ? 0 : 60);
      if (sc < bs) { bs = sc; best = n; }
    }
    return best;
  };
  const bN = pickBridge(0.3 * CITY_H, 110, 300), bS = pickBridge(0.76 * CITY_H, 380, 560);
  const yN = bN ? W.HY[bN.j] : 192, yS = bS ? W.HY[bS.j] : 486;

  // ---------- 4) 길: 선(가로·세로) → 교차점마다 노드 ----------
  const HL = [], VL = [];
  VL.push({ x: XA, y0: yN, y1: yS }, { x: X2, y0: yN, y1: YS }, { x: X3, y0: YN, y1: YS }, { x: XB, y0: YN, y1: YS }); // 서쪽 끝길은 북서·남서 만 때문에 두 간선 사이만
  HL.push({ y: YN, x0: 1060, x1: XB }, { y: YS, x0: X2, x1: XB });
  VL.push({ x: 1060, y0: YN, y1: yN }); // 블랙우드 숲길 (실버 피크 동쪽)
  HL.push({ y: 304, x0: XA + 36, x1: X2 }, { y: 380, x0: X3, x1: XB }); // 평원 가로길 · 목장길
  HL.push({ y: yN, x0: bN ? W.VX[bN.i] : XA, x1: XB, hw: true, from: bN }, { y: yS, x0: bS ? W.VX[bS.i] : XA, x1: XB, hw: true, from: bS });
  const towns = [
    { name: '샌디 밸리', xs: [X2, X2 + 12, X2 + 24, X2 + 36, X2 + 48], ys: [420, 432, 444, 456] },
    { name: '레드 록', xs: [XA, XA + 12, XA + 24, XA + 36], ys: [292, 304, 316] },
    { name: '파인 베이', xs: [XB - 60, XB - 48, XB - 36, XB - 24, XB - 12, XB], ys: [YN, YN + 12, YN + 24, YN + 36] },
    { name: '골든 필즈', xs: [X3, X3 + 12, X3 + 24, X3 + 36], ys: [400, 412, 424] },
  ];
  for (const tw of towns) {
    const x0 = tw.xs[0], x1 = tw.xs[tw.xs.length - 1], y0 = tw.ys[0], y1 = tw.ys[tw.ys.length - 1];
    for (const x of tw.xs) if (!VL.some(l => l.x === x && l.y0 <= y0 && l.y1 >= y1)) VL.push({ x, y0, y1, town: tw });
    for (const y of tw.ys) if (!HL.some(l => l.y === y && l.x0 <= x0 && l.x1 >= x1)) HL.push({ y, x0, x1, town: tw });
    tw.box = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
  // 노드
  const nodeAt = new Map(), cNodes = [];
  const key = (x, y) => x + ',' + y;
  const addNode = (x, y) => {
    const k = key(x, y); if (nodeAt.has(k)) return nodeAt.get(k);
    const n = { id: W.nodes.length, i: -1, j: -1, x: (x + 1) * T, y: (y + 1) * T, tx: x, ty: y, adj: [-1, -1, -1, -1], light: null, county: true };
    W.nodes.push(n); nodeAt.set(k, n); cNodes.push(n); return n;
  };
  for (const l of HL) if (l.from) { const n = l.from; n.tx = W.VX[n.i]; n.ty = W.HY[n.j]; nodeAt.set(key(n.tx, n.ty), n); }
  for (const h of HL) for (const v of VL) if (v.x >= h.x0 && v.x <= h.x1 && h.y >= v.y0 && h.y <= v.y1) addNode(v.x, h.y);
  for (const h of HL) { addNode(h.x1, h.y); if (!h.from) addNode(h.x0, h.y); }
  for (const v of VL) { addNode(v.x, v.y0); addNode(v.x, v.y1); }
  // 도로 칠하기
  const bridgeTiles = [];
  const paint = (x, y, k) => { if (!inMap(x, y)) return; const i = x + y * MW; if (x < CITY_W) bridgeTiles.push(i); W.tiles[i] = TL.ROAD; W.rockH[i] = 0; if (W.roadK[i] !== 3) W.roadK[i] = (W.roadK[i] && W.roadK[i] !== k) ? 3 : k; };
  const link = (A, B, horiz, hw) => {
    if (horiz) { A.adj[0] = B.id; B.adj[2] = A.id; for (let x = A.tx + 2; x < B.tx; x++) { paint(x, A.ty, 2); paint(x, A.ty + 1, 2); } }
    else { A.adj[1] = B.id; B.adj[3] = A.id; for (let y = A.ty + 2; y < B.ty; y++) { paint(A.tx, y, 1); paint(A.tx + 1, y, 1); } }
    W.edgesList.push([A.id, B.id]);
    if (hw) W.hwEdges.add(Math.min(A.id, B.id) + ',' + Math.max(A.id, B.id));
  };
  for (const n of cNodes) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const i = (n.tx + a) + (n.ty + b) * MW; W.tiles[i] = TL.ROAD; W.roadK[i] = 3; W.rockH[i] = 0; }
  for (const h of HL) {
    const ns = [...nodeAt.values()].filter(n => n.ty === h.y && n.tx >= h.x0 && n.tx <= h.x1).sort((a, b) => a.tx - b.tx);
    for (let k = 0; k + 1 < ns.length; k++) link(ns[k], ns[k + 1], true, h.hw);
  }
  for (const v of VL) {
    const ns = [...nodeAt.values()].filter(n => n.tx === v.x && n.ty >= v.y0 && n.ty <= v.y1).sort((a, b) => a.ty - b.ty);
    for (let k = 0; k + 1 < ns.length; k++) link(ns[k], ns[k + 1], false, false);
  }
  // 4차선 다리·간선: 바깥 차선 + 지도 주황색
  const hwLane = (x, y) => { if (!inMap(x, y)) return; const i = x + y * MW; if (x < CITY_W) bridgeTiles.push(i); if (W.tiles[i] === TL.ROAD) { if (W.roadK[i] !== 6) W.roadK[i] = 3; return; } W.tiles[i] = TL.ROAD; W.roadK[i] = 6; W.rockH[i] = 0; };
  for (const h of HL) if (h.hw) {
    const xs = h.from ? W.VX[h.from.i] + 2 : h.x0;
    for (let x = xs; x <= h.x1 + 1; x++) { hwLane(x, h.y - 1); hwLane(x, h.y + 2); for (let d = 0; d < 2; d++) W.hwLine[x + (h.y + d) * MW] = 1; }
  }
  for (const n of [...nodeAt.values()]) {
    n.deg = n.adj.filter(a => a >= 0).length;
    const town = towns.find(tw => n.tx >= tw.box.x0 && n.tx <= tw.box.x1 && n.ty >= tw.box.y0 && n.ty <= tw.box.y1);
    if (n.county && n.deg >= 3 && town) n.light = { off: rr(0, LIGHT_CYCLE) };
  }
  const roadAt = (x, y) => get(x, y) === TL.ROAD;
  const nearRoad = (x0, y0, x1, y1, m) => { for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) if (roadAt(x, y)) return true; return false; };

  // ---------- 4-5) 실버 피크 산길 (v2.20): 숲길에서 정상까지 1.6바퀴 나선 도로 + 정상 광장 ----------
  {
    const m = W.mountains[0]; W.mtMask = new Uint8Array(MW * MH); W.mtPath = [];
    const mark = (px, py, rad, tile) => { for (let y = Math.floor(py - rad); y <= Math.ceil(py + rad); y++) for (let x = Math.floor(px - rad); x <= Math.ceil(px + rad); x++) { if (!inMap(x, y) || Math.hypot(x + 0.5 - px, y + 0.5 - py) > rad) continue; const i = x + y * MW, t = W.tiles[i]; if (t === TL.WATER || t === TL.BUILD || (t === TL.ROAD && W.roadK[i] !== 5)) continue; W.tiles[i] = tile; if (tile === TL.ROAD) W.roadK[i] = 5; W.mtMask[i] = 1; } };
    const r0 = m.rMax + 2, turns = 1.6, N = 900;
    for (let k = 0; k <= N; k++) { const f = k / N, a = -f * turns * TAU, r = r0 - (r0 - 7) * f, x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r; mark(x, y, 1.6, TL.ROAD); if (k % 6 === 0) W.mtPath.push({ x: x * T, y: y * T }); }
    mark(m.x, m.y, 6.5, TL.PLAZA); // 정상 광장
    for (let x = Math.floor(m.x + r0); x < 1060; x++) mark(x + 0.5, m.y + 0.5, 1.2, TL.ROAD); // 숲길까지 잇는 길
    W.mtPath.unshift({ x: 1059 * T, y: (m.y + 0.5) * T });
    W.mapLabels.push({ name: '산길', x: (m.x + r0 + 6) * T, y: (m.y - 4) * T, small: true });
  }

  // ---------- 5) 마을 블록 ----------
  const PALH = ['#c65d4a', '#9c5a3c', '#5e6f86', '#7b8c5a', '#a8744f', '#6b5b7b', '#b8864e', '#d9c7a0', '#8aa0a8'];
  const addBuilding = (x0, y0, x1, y1, h, kind, color) => {
    const b = { id: W.buildings.length, x0, y0, x1, y1, h, kind, color, seed: R(), lit: R(), county: true };
    W.buildings.push(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = x + y * MW; W.tiles[i] = TL.BUILD; W.bIndex[i] = b.id; }
    return b;
  };
  const clearArea = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(x, y) === TL.ROAD || get(x, y) === TL.BUILD || get(x, y) === TL.ROCK || get(x, y) === TL.WATER || get(x, y) === TL.RUNWAY) return false; return true; };
  const places = []; // [key, shop, x, y, label, mark, icon]
  const townSpecial = {
    '샌디 밸리': [['c_mart1', 'mart', '#7ae68f', '#39404c', '편', '샌디 밸리 편의점'], ['c_burger1', 'burger', '#ffb347', '#c65d4a', '버', '사막 다이너'], ['c_ammu1', 'ammu', '#ff6b5a', '#6b6f73', '총', '샌디 밸리 총포상'], ['c_clinic1', 'hospital_st', '#e0443e', '#e9ecef', 'H', '샌디 밸리 의원'], ['c_sheriff1', 'police_st', '#4b8fe8', '#2c3e66', 'P', '카운티 보안관']],
    '파인 베이': [['c_mart2', 'mart', '#7ae68f', '#39404c', '편', '파인 베이 잡화점'], ['c_burger2', 'burger', '#ffb347', '#5e6f86', '버', '어부의 식당'], ['c_clothes1', 'clothes', '#e07aff', '#7b5a8c', '옷', '파인 베이 옷가게'], ['c_clinic2', 'hospital_st', '#e0443e', '#e9ecef', 'H', '파인 베이 의원'], ['c_sheriff2', 'police_st', '#4b8fe8', '#2c3e66', 'P', '파인 베이 보안관']],
    '골든 필즈': [['c_mart3', 'mart', '#7ae68f', '#39404c', '편', '골든 필즈 농협 마트']],
    '레드 록': [['c_burger3', 'burger', '#ffb347', '#a8744f', '버', '레드 록 바비큐'], ['c_ammu2', 'ammu', '#ff6b5a', '#6b6f73', '총', '레드 록 사냥용품']],
  };
  for (const tw of towns) {
    const specials = [...(townSpecial[tw.name] || [])], z = COUNTY_ZONES.findIndex(q => q.name === tw.name);
    const cells = [];
    for (let a = 0; a + 1 < tw.xs.length; a++) for (let c = 0; c + 1 < tw.ys.length; c++) cells.push([tw.xs[a], tw.ys[c]]);
    let lotLeft = 2;
    cells.forEach(([gx, gy], ci) => {
      const x0 = gx + 2, y0 = gy + 2, x1 = gx + 11, y1 = gy + 11;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(x, y) === TL.ROAD || get(x, y) === TL.ROCK) return;
      const id = W.blocks.length;
      const b = { id, x0, y0, x1, y1, district: DIST.RESID, hood: hood0 + z, area: 100, county: true, lots: [] };
      W.blocks.push(b);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = x + y * MW; W.region[i] = id; W.dist[i] = DIST.RESID; W.hoodT[i] = hood0 + z; W.bIndex[i] = -1;
        W.tiles[i] = (x === x0 || x === x1 || y === y0 || y === y1) ? TL.WALK : TL.GRASS;
      }
      b.loop = { x0: (x0 + 0.5) * T, y0: (y0 + 0.5) * T, x1: (x1 + 0.5) * T, y1: (y1 + 0.5) * T };
      b.loop.w = b.loop.x1 - b.loop.x0; b.loop.h = b.loop.y1 - b.loop.y0; b.loop.P = 2 * (b.loop.w + b.loop.h);
      for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const lx0 = x0 + 1 + qx * 4, ly0 = y0 + 1 + qy * 4, L = { x0: lx0, y0: ly0, x1: lx0 + 3, y1: ly0 + 3, edge: true, used: false, b: null };
        b.lots.push(L);
        if (lotLeft > 0 && ci % 3 === 1 && qx === 1 && qy === 1) { // 빈 필지(주차장) — 하버 개발로 건물을 올릴 수 있다
          lotLeft--; L.kind = 'lot';
          for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) W.tiles[x + y * MW] = TL.LOT;
          W.parking.push({ x: (L.x0 + 1) * T, y: (L.y0 + 1) * T, a: -Math.PI / 2, car: null, cd: 0 }, { x: (L.x0 + 3) * T, y: (L.y0 + 1) * T, a: -Math.PI / 2, car: null, cd: 0 });
          continue;
        }
        // 건물은 인도 쪽 모서리에 붙인다 (문 = 바로 앞 인도 칸)
        const bx0 = qx ? lx0 + 1 : lx0, by0 = qy ? ly0 + 1 : ly0, bx1 = bx0 + 2, by1 = by0 + 2;
        const doorX = bx0 + 1, doorY = qy ? y1 : y0;
        const sp = specials.length && (ci + qx + qy) % 2 === 0 ? specials.shift() : null;
        if (sp) {
          const kind = sp[1] === 'hospital_st' ? 'hospital' : sp[1] === 'police_st' ? 'police' : 'shop';
          L.b = addBuilding(bx0, by0, bx1, by1, kind === 'shop' ? 6 : 8, kind, sp[3]); L.b.label = sp[5]; L.used = true;
          places.push({ key: sp[0], shop: sp[1], x: (doorX + 0.5) * T, y: (doorY + 0.5) * T, label: sp[5], mark: sp[2], ch: sp[4] });
        } else {
          const shop = R() < 0.3;
          L.b = addBuilding(bx0, by0, bx1, by1, shop ? rr(6, 9) : rr(4, 6), shop ? 'mid' : 'house', shop ? rpick(['#a38e70', '#8b6f6a', '#b09a7c', '#6f7f8f']) : rpick(PALH));
          if (!shop && R() < 0.6) W.trees.push({ x: (qx ? lx0 : lx0 + 3) * T + T / 2, y: (qy ? ly0 : ly0 + 3) * T + T / 2, kind: tw.name === '파인 베이' ? 'pine' : tw.name === '샌디 밸리' ? 'palm' : 'tree', r: rr(1.8, 2.4), h: rr(5, 8), hue: R() });
        }
      }
    });
    // 교차로 모서리 가로등
    for (const n of cNodes) {
      if (!(n.tx >= tw.box.x0 && n.tx <= tw.box.x1 && n.ty >= tw.box.y0 && n.ty <= tw.box.y1)) continue;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = n.x + sx * T * 1.5, y = n.y + sy * T * 1.5; if (tileAt(x, y) === TL.WALK) W.lamps.push({ x, y }); }
    }
  }
  // 파인 베이 교회 첨탑
  { const b = W.buildings.find(q => q.county && q.kind === 'house' && W.hoods[W.hoodT[q.x0 + q.y0 * MW]]?.name === '파인 베이'); if (b) { b.kind = 'church'; b.h = 9; b.color = '#e8e2d0'; W.decos.push({ t: 'spire', x: (b.x0 + 1.5) * T, y: (b.y0 + 1.5) * T, z: 9, h: 12, c: '#e8e2d0' }); } }

  // ---------- 6) 길가 시설: 주유소 · 농가 · 목장 ----------
  // 길 옆 빈 땅 찾기: (x, y)에서 가장 가까운, 크기 w×h이고 길에서 1칸 떨어진 곳
  const spotNear = (x, y, w, h, side) => {
    for (let r = 0; r < 14; r++) for (const [dx, dy] of side) {
      const X = x + dx * (r + 1), Y = y + dy * (r + 1), x0 = dx < 0 ? X - w + 1 : dx > 0 ? X : X - (w >> 1), y0 = dy < 0 ? Y - h + 1 : dy > 0 ? Y : Y - (h >> 1);
      if (clearArea(x0 - 1, y0 - 1, x0 + w, y0 + h) && x0 >= CITY_W) return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    }
    return null;
  };
  const gas = (key, label, x, y, side) => {
    const s = spotNear(x, y, 8, 6, side); if (!s) return;
    for (let yy = s.y0; yy <= s.y1; yy++) for (let xx = s.x0; xx <= s.x1; xx++) W.tiles[xx + yy * MW] = TL.LOT;
    const b = addBuilding(s.x0 + 5, s.y0 + 1, s.x0 + 7, s.y0 + 3, 4.5, 'shop', '#f2f4f7'); b.label = label;
    W.decos.push({ t: 'lintel', x0: (s.x0 + 0.6) * T, x1: (s.x0 + 4.4) * T, y0: (s.y0 + 1) * T, y1: (s.y0 + 4.8) * T, z0: 4.2, z1: 4.8, c: '#d33b2c' }); // 주유 캐노피
    places.push({ key, shop: 'mart', x: (s.x0 + 4.5) * T, y: (s.y0 + 2.5) * T, label, mark: '#7ae68f', ch: '편' });
    W.parking.push({ x: (s.x0 + 1.5) * T, y: (s.y0 + 5) * T, a: 0, car: null, cd: 0 });
  };
  gas('c_gas1', '68번 국도 주유소', XA + 2, yN + 12, [[1, 0], [0, 1]]);
  gas('c_gas2', '사막 휴게소', X2 + 2, yS - 6, [[1, 0], [0, -1]]);
  gas('c_gas3', '호숫가 주유소', X3 - 1, yN + 30, [[-1, 0]]);
  gas('c_gas4', '해안 주유소', XB - 1, YS - 6, [[-1, 0], [0, -1]]);
  // 농가 (집 + 붉은 헛간 + 사일로)
  const farm = (x, y, side) => {
    const s = spotNear(x, y, 12, 10, side); if (!s) return;
    for (let yy = s.y0; yy <= s.y1; yy++) for (let xx = s.x0; xx <= s.x1; xx++) W.tiles[xx + yy * MW] = TL.SAND;
    addBuilding(s.x0 + 1, s.y0 + 1, s.x0 + 3, s.y0 + 3, rr(4, 5), 'house', rpick(['#e8e2d0', '#c65d4a', '#d9c7a0']));
    W.county.farms.push({ x: (s.x0 + 4.5) * T, y: (s.y0 + 7.5) * T, fx: (s.x0 + (side[0][0] > 0 ? 16 : -4)) * T, fy: (s.y0 + 5) * T });
    addBuilding(s.x0 + 6, s.y0 + 1, s.x0 + 10, s.y0 + 5, 7, 'warehouse', '#9c3b2e');
    addBuilding(s.x0 + 7, s.y0 + 7, s.x0 + 8, s.y0 + 8, 9, 'tank', '#b8bcb4');
    W.decos.push({ t: 'tankcyl', x: (s.x0 + 8) * T, y: (s.y0 + 8) * T, r: 4, z: 9, c: '#c9ccc4' });
  };
  for (const [x, y, sd] of [[X3 + 2, 220, [[1, 0]]], [X3 + 2, 300, [[1, 0]]], [XB - 1, 360, [[-1, 0]]], [X3 + 2, 520, [[1, 0]]], [XB - 1, 540, [[-1, 0]]], [1240, YS - 1, [[0, -1]]], [XA + 2, 380, [[1, 0]]], [1100, YN + 1, [[0, 1]]]]) farm(x, y, sd);
  // 외딴 집 (목장·오두막)
  for (let k = 0; k < 26; k++) {
    const l = rpick(VL.filter(v => !v.town)), y = ri(l.y0 + 8, l.y1 - 8), sd = R() < 0.5 ? [[1, 0]] : [[-1, 0]];
    const s = spotNear(l.x + (sd[0][0] > 0 ? 2 : -1), y, 4, 4, sd); if (!s) continue;
    addBuilding(s.x0, s.y0, s.x0 + 2, s.y0 + 2, rr(3.5, 5), 'house', rpick(PALH));
  }
  // 밭: 골든 필즈 동쪽·남쪽 (흙 이랑)
  for (let y = 436; y < 584; y++) for (let x = 1192; x < 1322; x++) {
    const i = x + y * MW; if (W.tiles[i] !== TL.GRASS && W.tiles[i] !== TL.SAND) continue;
    if (nearRoad(x, y, x, y, 1)) continue;
    const field = (Math.floor(x / 24) + Math.floor(y / 20)) % 3;
    if (field === 0) W.tiles[i] = (y % 2) ? TL.SAND : TL.GRASS; else if (field === 1) W.tiles[i] = (x % 2) ? TL.SAND : TL.GRASS;
  }

  // ---------- 7) 경비행장 (샌디 밸리 남쪽) ----------
  {
    const ry0 = 560, rx0 = 940, rx1 = 1110;
    for (let y = ry0; y < ry0 + 4; y++) for (let x = rx0; x <= rx1; x++) if (get(x, y) !== TL.ROAD) set(x, y, TL.RUNWAY);
    for (let y = ry0 + 4; y <= ry0 + 12; y++) for (let x = 996; x <= 1030; x++) if (get(x, y) !== TL.ROAD) set(x, y, TL.LOT);
    for (let y = ry0 + 13; y < YS; y++) for (let x = 1016; x <= 1018; x++) if (get(x, y) !== TL.ROAD) set(x, y, TL.LOT);
    const hg = addBuilding(1000, ry0 + 6, 1009, ry0 + 11, 8, 'hangar', '#8a929c'); hg.label = '샌디 밸리 비행장';
    W.decos.push({ t: 'vault', x0: 1000 * T, x1: 1010 * T, y0: (ry0 + 6) * T, y1: (ry0 + 12) * T, z: 8, c: '#9aa3ad' });
    W.runways.push({ x0: rx0 * T, y0: ry0 * T, x1: (rx1 + 1) * T, y1: (ry0 + 4) * T, county: true });
    W.places.c_airfield = { x: 1020 * T, y: (ry0 + 8) * T, label: '샌디 밸리 비행장' };
    W.mapLabels.push({ name: '비행장', x: 1025 * T, y: (ry0 - 4) * T, small: true });
  }

  // ---------- 7-2) 파인 베이 부두 (어선·보트) · 호숫가 낚시터 ----------
  {
    const py = YN + 20, px0 = XB + 3;
    let px1 = px0; while (px1 < MW - 2 && get(px1, py) !== TL.WATER) px1++;
    px1 += 12;
    for (let x = px0; x <= px1; x++) for (let y = py - 1; y <= py + 1; y++) if (get(x, y) !== TL.ROAD && get(x, y) !== TL.BUILD) set(x, y, TL.DOCK);
    W.county.fish.push({ x: (px1 - 1) * T, y: (py + 0.5) * T, kind: 'pier' }, { x: (px1 - 6) * T, y: (py + 0.5) * T, kind: 'pier' });
    W.marinas.push({ x: (px1 + 4) * T, y: (py - 3) * T, a: 0, car: null, cd: 0, county: true }, { x: (px1 + 4) * T, y: (py + 4) * T, a: 0, car: null, cd: 0, county: true });
    W.mapLabels.push({ name: '부두', x: (px1 - 4) * T, y: (py - 4) * T, small: true });
    for (const a of [0.4, 1.9, 3.3, 4.6]) { const x = lake.x + Math.cos(a) * lake.rx * 1.1, y = lake.y + Math.sin(a) * lake.ry * 1.12; W.county.fish.push({ x: x * T, y: y * T, kind: 'lake' }); }
    W.marinas.push({ x: (lake.x + lake.rx * 0.9) * T, y: lake.y * T, a: Math.PI, car: null, cd: 0, county: true });
    for (const tw of towns) W.county.towns.push({ name: tw.name, x: (tw.box.x0 + tw.box.x1) / 2 * T, y: (tw.box.y0 + tw.box.y1) / 2 * T });
  }

  // ---------- 8) 장소 등록 ----------
  const hasPM = typeof PLACE_MARK !== 'undefined', hasEP = typeof EXTRA_PLACES !== 'undefined';
  for (const p of places) {
    W.places[p.key] = { x: p.x, y: p.y, label: p.label };
    if (p.shop === 'hospital_st' || p.shop === 'police_st') { W.branches = W.branches || []; W.branches.push({ key: p.key, kind: p.shop, ch: p.ch, c: p.mark, label: p.label }); }
    else if (hasEP) { EXTRA_PLACES.push([p.key, p.shop]); EXTRA_ICONS.push({ key: p.key, ch: p.ch, c: p.mark, label: p.label }); }
    if (hasPM) PLACE_MARK[p.key] = p.mark;
  }
  W.landmarks.push({ name: '실버 피크', x: 975 * T, y: 112 * T }, { name: '솔트 레이크', x: lake.x * T, y: lake.y * T });

  // ---------- 9) 나무: 블랙우드 침엽수림 · 초원 · 사막 선인장 · 해변 야자 ----------
  const treeOK = (x, y) => { const t = get(x, y); return (t === TL.GRASS || t === TL.SAND) && !nearRoad(x, y, x, y, 2) && W.region[x + y * MW] < 0 && W.bIndex[x + y * MW] < 0; };
  const forest = (x, y) => { const n = 14 * Math.sin(x * 0.05 + ph[2]) + 10 * Math.sin(y * 0.07 + ph[5]); return x > 1050 + n && x < 1262 + n && y > 52 + n * 0.5 && y < 205 + n; };
  for (let y = 0; y < MH; y++) for (let x = CITY_W; x < MW; x++) {
    const i = x + y * MW, t = W.tiles[i]; if (t !== TL.GRASS && t !== TL.SAND) continue;
    const h = hash2(x * 7 + 3, y * 11 + 5);
    if (t === TL.GRASS && forest(x, y)) { if (h < 0.075 && treeOK(x, y)) W.trees.push({ x: (x + rr(0.2, 0.8)) * T, y: (y + rr(0.2, 0.8)) * T, kind: 'pine', r: rr(1.6, 2.3), h: rr(8, 13), hue: R() }); }
    else if (t === TL.GRASS) { if (h < 0.006 && treeOK(x, y)) W.trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, kind: 'tree', r: rr(2, 2.9), h: rr(5, 8), hue: R() }); }
    else if (desert(x, y) && lakeR(x, y) > 1.12) { if (h < 0.0045 && treeOK(x, y)) W.trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, kind: 'cactus', r: 0.5, h: rr(2.4, 4.2), hue: R() }); }
    else if (h < 0.012 && y > 560 && treeOK(x, y)) W.trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, kind: 'palm', r: 2.2, h: rr(7, 9), hue: R() });
  }
  // 산에 가까운 침엽수 (실버 피크 기슭)
  for (let k = 0; k < 900; k++) {
    const a = R() * TAU, m = W.mountains[0], d = m.r * rr(0.55, 1.25), x = Math.floor(m.x + Math.cos(a) * d), y = Math.floor(m.y + Math.sin(a) * d);
    if (!inMap(x, y)) continue;
    const h = mountainH(x + 0.5, y + 0.5);
    if (get(x, y) === TL.ROCK && h > 55) continue;
    if (get(x, y) === TL.ROCK || treeOK(x, y)) W.trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, kind: 'pine', r: rr(1.5, 2.1), h: rr(7, 11), hue: R(), z: h });
  }

  // ---------- 10) 다리에 덮인 도시 쪽 나무·가로등·주차칸 치우기 ----------
  const bt = new Set(bridgeTiles);
  const onBridge = (x, y) => bt.has(Math.floor(x / T) + Math.floor(y / T) * MW);
  W.trees = W.trees.filter(t => !onBridge(t.x, t.y));
  W.lamps = W.lamps.filter(l => !onBridge(l.x, l.y));
  W.parking = W.parking.filter(p => !onBridge(p.x, p.y));
  W.countyInfo = { bridges: [bN && bN.id, bS && bS.id], yN, yS, XA, nodes: cNodes.length, blocks: W.blocks.filter(b => b.county).length };
}

// v2.21: 공항 섬·군 기지 섬을 본섬에 붙인다 — 바다를 사이에 둔 따로 떨어진 섬이 아니라 섬 안의 기반 시설처럼.
// 섬과 본섬 사이의 좁은 바다를 '닫기'(넓혔다 좁히기)로 메워 부드러운 땅목(지협)을 만든다. 도로·건물은 그대로.
function joinIslets() {
  const W = World, jobs = [];
  // 섬 둘레 타원 안에서만 메운다 (이음새가 곧은 선이 되지 않게)
  if (W.airport) { const A = W.airport; jobs.push({ cx: A.cx, cy: A.cy, ex: A.rx + 46, ey: A.ry + 46, r: 34, dock: 5 }); }
  if (W.base && W.base.island) { const B = W.base; jobs.push({ cx: (B.x0 + B.x1) / 2 / T, cy: (B.y0 + B.y1) / 2 / T, ex: (B.x1 - B.x0) / 2 / T + 40, ey: (B.y1 - B.y0) / 2 / T + 44, r: 48, dock: 2 }); }
  if (!jobs.length) return;
  const w = CITY_W, h = CITY_H, n = w * h, BIG = 1e6;
  const dt = seed => { // 체스판 거리 변환 (seed(i)가 참인 칸까지 거리 ×3)
    const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = seed(i) ? 0 : BIG;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = x + y * w; let v = d[i]; if (x) v = Math.min(v, d[i - 1] + 3); if (y) { v = Math.min(v, d[i - w] + 3); if (x) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); } d[i] = v; }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = x + y * w; let v = d[i]; if (x < w - 1) v = Math.min(v, d[i + 1] + 3); if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x) v = Math.min(v, d[i + w - 1] + 4); } d[i] = v; }
    return d;
  };
  const tl = i => W.tiles[(i % w) + Math.floor(i / w) * MW];
  const near = dt(i => { const t = tl(i); return t !== TL.WATER && t !== TL.ROAD && t !== TL.DOCK; }); // 다리·부두는 땅으로 치지 않는다
  const dockNear = (x, y, m) => { for (let yy = y - m; yy <= y + m; yy++) for (let xx = x - m; xx <= x + m; xx++) if (xx >= 0 && yy >= 0 && xx < MW && yy < MH && W.tiles[xx + yy * MW] === TL.DOCK) return true; return false; };
  const marinaNear = (x, y) => (W.marinas || []).some(m => Math.hypot(m.x / T - x, m.y / T - y) < 16);
  const joined = W.joined = new Uint8Array(MW * MH);
  for (const J of jobs) {
  const r3 = J.r * 3, far = dt(i => near[i] > r3 || i < w * 2 || i >= n - w * 2 || i % w < 2); // 지도 가장자리 밖은 열린 바다
  for (let y = Math.max(2, Math.floor(J.cy - J.ey)); y <= Math.min(h - 3, J.cy + J.ey); y++) for (let x = Math.max(2, Math.floor(J.cx - J.ex)); x <= Math.min(w - 3, J.cx + J.ex); x++) {
    const a = Math.atan2(y - J.cy, x - J.cx), e = Math.hypot((x - J.cx) / J.ex, (y - J.cy) / J.ey) / (1 + 0.1 * Math.sin(3 * a + J.cx) + 0.06 * Math.sin(7 * a + J.cy));
    const i = x + y * w, k = x + y * MW;
    if (e >= 1 || W.tiles[k] !== TL.WATER || far[i] <= r3 + (hash2(x >> 3, y >> 3) - 0.5) * 24) continue;
    if (dockNear(x, y, J.dock) || marinaNear(x, y)) continue;
    W.tiles[k] = TL.GRASS; W.dist[k] = DIST.PARK; joined[k] = 1;
  }
  }
  // 가는 모래 줄·외톨이 칸은 다시 바다로 (두 번)
  const landN = (x, y) => { let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && W.tiles[(x + dx) + (y + dy) * MW] !== TL.WATER) c++; return c; };
  for (let pass = 0; pass < 3; pass++) for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { const k = x + y * MW; if (joined[k] && landN(x, y) < 4) { W.tiles[k] = TL.WATER; W.dist[k] = DIST.COAST; joined[k] = 0; } }
  // 옛 섬 해안의 모래 띠: 이제 물가가 아니면 풀밭으로
  const wetNear = (x, y) => { for (let d = 1; d <= 3; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (W.tiles[(x + dx) + (y + dy) * MW] === TL.WATER) return true; return false; };
  for (const J of jobs) for (let y = Math.max(3, Math.floor(J.cy - J.ey)); y <= Math.min(h - 4, J.cy + J.ey); y++) for (let x = Math.max(3, Math.floor(J.cx - J.ex)); x <= Math.min(w - 4, J.cx + J.ex); x++) {
    const k = x + y * MW; if (W.tiles[k] === TL.SAND && !joined[k] && W.region[k] < 0 && !wetNear(x, y)) W.tiles[k] = TL.GRASS;
  }
  // 새 땅 가장자리는 모래, 안쪽엔 나무 조금
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const k = x + y * MW; if (!joined[k]) continue;
    if (wetNear(x, y)) W.tiles[k] = TL.SAND;
    else if (hash2(x >> 2, y >> 2) < 0.4 && hash2(x, y) < 0.05) W.trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, kind: hash2(y, x) < 0.3 ? 'palm' : 'tree', r: 2.3, h: 6.5, hue: hash2(x * 3, y) });
  }
}
