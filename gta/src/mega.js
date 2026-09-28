'use strict';
/* =====================================================================
 * mega.js — 초대형 프로젝트 (v2.19): 지도에 내 건물이 생긴다
 *
 *  돈만 내는 게 아니라  [착공(대금)] → [준비 의뢰 미션] → [공사(실시간 몇 분, 크레인)] → [완공: 지도가 바뀐다]
 *    · 실버 피크 케이블카·전망대 $5천만 — 숲길 아래 역에서 정상까지 케이블카, 정상에서 낙하산 점프, 1분 $40만
 *    · 솔트 레이크 리조트 $8천만 — 호수 북쪽 호텔 세 동과 광장, 숙박(저장·회복)·스파, 1분 $65만
 *    · 샌디 밸리 카지노 호텔 $1억 2천만 — 사막 카지노(베팅 한도 2배), 1분 $100만
 *    · 개인 섬 $2억 — 바다 위의 내 섬: 빌라(저장), 헬리패드(헬기), 부두(보트)
 *  완공 기록은 저장되고, 불러오면 같은 자리에 다시 짓는다 (World에 건물·타일을 덧붙인다).
 *  관리: 카운티 개발청(샌디 밸리) 또는 하버 개발 창의 [초대형 프로젝트].
 * ===================================================================== */

const MEGA_DEFS = {
  cable: { name: '실버 피크 케이블카·전망대', cost: 50e6, min: 8, income: 400000, prep: 'm_cable' },
  resort: { name: '솔트 레이크 리조트', cost: 80e6, min: 10, income: 650000, prep: 'm_resort' },
  casino: { name: '샌디 밸리 카지노 호텔', cost: 120e6, min: 12, income: 1000000, prep: 'm_casino' },
  island: { name: '개인 섬', cost: 200e6, min: 15, income: 0, prep: 'm_island' },
};

// ---------- 실행 중 지도 고치기 (타일·건물 추가 → 미니맵·3D 청크 갱신) ----------
const WorldEdit = {
  touch(x0, y0, x1, y1) {
    const W = World; spatialViews();
    if (W.mini) { const g = W.mini.getContext('2d'), s = W.mini.width / MW; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = W.tiles[tIdx(x, y)]; g.fillStyle = t === TL.ROCK ? rockColor(W.rockH[tIdx(x, y)]) : MINI_COL[t]; g.fillRect(x * s, y * s, s, s); } if (View3D.underTex) View3D.underTex.needsUpdate = true; }
    if (View3D.chunks) { const CS = View3D.CS; for (let cy = Math.floor(y0 * T / CS); cy <= Math.floor((y1 + 1) * T / CS); cy++) for (let cx = Math.floor(x0 * T / CS); cx <= Math.floor((x1 + 1) * T / CS); cx++) { const k = cx + cy * View3D.NCX, ch = View3D.chunks.get(k); if (ch) { View3D.disposeChunk(ch); View3D.chunks.delete(k); } } }
  },
  tiles(x0, y0, x1, y1, fn) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = fn(x, y); if (t !== undefined && t !== null) { const i = tIdx(x, y); World.tiles[i] = t; World.rockH[i] = 0; if (t !== TL.BUILD) World.bIndex[i] = -1; } } },
  building(x0, y0, x1, y1, h, kind, color, label) {
    const W = World;
    if (W.buildings.some(b => b.mega && b.x0 === x0 && b.y0 === y0)) return null;
    const b = { id: W.buildings.length, x0, y0, x1, y1, h, kind, color, seed: hash2(x0, y0), lit: 0.8, mega: true, label };
    W.buildings.push(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = tIdx(x, y); W.tiles[i] = TL.BUILD; W.bIndex[i] = b.id; }
    W.trees = W.trees.filter(t => !(t.x >= x0 * T - 2 && t.x <= (x1 + 1) * T + 2 && t.y >= y0 * T - 2 && t.y <= (y1 + 1) * T + 2));
    W.parking = W.parking.filter(q => !(q.x >= x0 * T && q.x <= (x1 + 1) * T && q.y >= y0 * T && q.y <= (y1 + 1) * T));
    for (const c of Game.cars || []) if (!c.persistent && c.x >= x0 * T && c.x <= (x1 + 1) * T && c.y >= y0 * T && c.y <= (y1 + 1) * T) c.remove = true;
    if (View3D.bucket) { const CS = View3D.CS, k = clamp(Math.floor((x0 + x1 + 1) / 2 * T / CS), 0, View3D.NCX - 1) + clamp(Math.floor((y0 + y1 + 1) / 2 * T / CS), 0, View3D.NCY - 1) * View3D.NCX; View3D.bucket[k].b.push(b); }
    return b;
  },
  tree(x, y, kind) { const t = { x, y, kind, r: kind === 'palm' ? 2.2 : 2.2, h: kind === 'palm' ? rand(7, 9) : rand(5, 8), hue: Math.random() }; World.trees.push(t); if (View3D.bucket) { const CS = View3D.CS; View3D.bucket[clamp(Math.floor(x / CS), 0, View3D.NCX - 1) + clamp(Math.floor(y / CS), 0, View3D.NCY - 1) * View3D.NCX].trees.push(t); } const k = Math.floor(x / 8) + ',' + Math.floor(y / 8); if (!World.treeGrid.has(k)) World.treeGrid.set(k, []); World.treeGrid.get(k).push(t); },
  place(key, x, y, label, shop, ch, col) { World.places[key] = { x, y, label }; if (shop && !EXTRA_PLACES.some(e => e[0] === key)) { EXTRA_PLACES.push([key, shop]); EXTRA_ICONS.push({ key, ch, c: col, label }); } PLACE_MARK[key] = col; },
};

// 개인 섬 자리: 바다 한가운데 (반지름 20칸 + 여유 8칸이 모두 물인 곳) — 결정적으로 찾는다
function islandSite() {
  for (const [cx, cy] of [[606, 598], [640, 590], [620, 610], [650, 575], [600, 20], [660, 30], [1385, 330]]) {
    let ok = true; for (let y = cy - 28; y <= cy + 28 && ok; y += 2) for (let x = cx - 28; x <= cx + 28; x += 2) { if (Math.hypot(x - cx, y - cy) > 28) continue; if (x < 2 || y < 2 || x >= MW - 2 || y >= MH - 2 || World.tiles[tIdx(x, y)] !== TL.WATER) { ok = false; break; } }
    if (ok) return { cx, cy };
  }
  return null;
}

const Mega = {
  st: {}, t: 0, applied: {}, meshes: null,
  save() { return { st: this.st }; },
  load(o) { this.st = (o && o.st) || {}; },
  done(k) { return this.st[k] && this.st[k].stage === 'done'; },
  perMin() { return Object.keys(MEGA_DEFS).reduce((a, k) => a + (this.done(k) ? MEGA_DEFS[k].income : 0), 0); },
  site(k) {
    if (k === 'cable') return { x: 1067.5 * T, y: 173.5 * T };
    if (k === 'resort') return { x: 1005 * T, y: 256 * T };
    if (k === 'casino') return { x: 953.5 * T, y: 430 * T };
    if (k === 'island') { const s = this.isl || (this.isl = islandSite()); return s ? { x: s.cx * T, y: s.cy * T } : null; } // 지은 뒤엔 물이 아니므로 처음 찾은 자리를 기억
  },
  begin(k) {
    const D = MEGA_DEFS[k], P = Game.player; if (this.st[k]) return;
    if (P.money < D.cost) { UI.toast('돈이 모자라다'); return; }
    P.money -= D.cost; this.st[k] = { stage: 'prep' }; Sfx.passed();
    UI.big('착공 계약!', `${D.name} — 준비 의뢰를 끝내면 공사가 시작된다`, 3.2, '#ffd166'); Save.write();
  },
  update(dt) {
    if (!World.county) return;
    if (!this.office) { this.office = true; const t = (World.county.towns || []).find(q => q.name === '샌디 밸리'); if (t) { const s = sidewalkNear(t.x - 30, t.y + 40, 4); WorldEdit.place('c_megaoffice', s.x, s.y, '레드 카운티 개발청 (초대형 프로젝트)', 'mega', '開', '#ffd166'); } }
    for (const k of Object.keys(MEGA_DEFS)) if (this.done(k) && !this.applied[k]) this.apply(k);
    if (this.done('cable') && View3D.scene && !this.meshes) this.cableMesh();
    this.animate(Game.time);
    this.t += dt;
    if (this.t >= 1) {
      const step = this.t; this.t = 0;
      for (const k of Object.keys(MEGA_DEFS)) { const s = this.st[k]; if (!s || s.stage !== 'build') continue; s.left -= step; if (s.left <= 0) { s.stage = 'done'; this.apply(k); Sfx.passed(); UI.big('완공!', `${MEGA_DEFS[k].name}이(가) 문을 열었다`, 4, '#ffd166'); Msgs.add('레드 카운티 개발청', `${MEGA_DEFS[k].name} 완공을 축하드립니다.`); Save.write(); } }
      this.incT = (this.incT || 0) + step;
      if (this.incT >= 60) { this.incT -= 60; const n = this.perMin(); if (n) { Game.player.money += n; UI.toast(`초대형 프로젝트 수입 +$${n.toLocaleString()}`); } }
    }
  },
  prepDone(k) { const s = this.st[k]; if (!s || s.stage !== 'prep') return; s.stage = 'build'; s.left = MEGA_DEFS[k].min * 60; UI.big('공사 시작', `${MEGA_DEFS[k].name} — ${MEGA_DEFS[k].min}분 뒤 완공`, 3, '#ffd166'); Save.write(); },
  // 공사 중 크레인 (2D·3D 소품)
  props() {
    const out = [];
    for (const k of Object.keys(MEGA_DEFS)) {
      const s = this.st[k]; if (!s || s.stage !== 'build') continue; const p = this.site(k); if (!p) continue;
      const prog = 1 - s.left / (MEGA_DEFS[k].min * 60);
      out.push({ x: p.x, y: p.y, w: 20, d: 14, h: 4 + prog * 30, c: '#b8b0a0', no2d: false }, { x: p.x + 12, y: p.y - 9, w: 1.2, d: 1.2, h: 48, c: '#f2c14e', no2d: true }, { x: p.x + 2, y: p.y - 9, w: 22, d: 1, h: 1, z: 48, c: '#f2c14e', no2d: true });
    }
    return out;
  },
  apply(k) {
    this.applied[k] = true;
    const W = World, E = WorldEdit;
    if (k === 'cable') {
      E.tiles(1062, 166, 1074, 181, (x, y) => W.tiles[tIdx(x, y)] === TL.ROAD ? null : TL.PLAZA);
      E.building(1065, 169, 1071, 175, 9, 'mid', '#c9ced6', '케이블카 하부역');
      E.place('c_cable', 1063.5 * T, 172.5 * T, '실버 피크 케이블카', 'cablecar', '缆', '#6fe0ff');
      W.mapLabels.push({ name: '케이블카', x: 1060 * T, y: 160 * T, small: true });
      E.touch(1060, 164, 1076, 183);
    } else if (k === 'resort') {
      E.tiles(978, 240, 1032, 268, (x, y) => [TL.GRASS, TL.SAND].includes(W.tiles[tIdx(x, y)]) ? TL.PLAZA : null);
      E.building(984, 248, 993, 259, 42, 'tower', '#e8e2d0', '솔트 레이크 리조트 A');
      E.building(999, 244, 1010, 256, 56, 'tower', '#d4c4a8', '솔트 레이크 리조트 본관');
      E.building(1016, 248, 1025, 259, 38, 'tower', '#c9ced6', '솔트 레이크 리조트 B');
      for (let x = 982; x < 1030; x += 6) E.tree(x * T, 265 * T, 'palm');
      E.place('c_resort', 1005 * T, 262 * T, '솔트 레이크 리조트', 'resort', '宿', '#ffd166');
      W.mapLabels.push({ name: '리조트', x: 1005 * T, y: 238 * T, small: true });
      E.touch(976, 238, 1034, 270);
    } else if (k === 'casino') {
      E.tiles(942, 420, 966, 448, (x, y) => [TL.GRASS, TL.SAND].includes(W.tiles[tIdx(x, y)]) ? (y >= 438 ? TL.LOT : TL.PLAZA) : null);
      const b = E.building(946, 422, 961, 434, 28, 'tower', '#7a2d6b', '샌디 밸리 카지노 호텔'); if (b) b.lit = 1;
      for (let x = 944; x <= 964; x += 3) W.parking.push({ x: x * T, y: 442 * T, a: -Math.PI / 2, car: null, cd: 0 });
      E.place('c_casino', 953.5 * T, 436.5 * T, '샌디 밸리 카지노 호텔', 'dcasino', '♦', '#ff4fd8');
      W.mapLabels.push({ name: '사막 카지노', x: 953 * T, y: 416 * T, small: true });
      E.touch(940, 418, 968, 450);
    } else if (k === 'island') {
      const s = this.isl || (this.isl = islandSite()); if (!s) return; const { cx, cy } = s, R = 20;
      E.tiles(cx - R, cy - R, cx + R, cy + R, (x, y) => { const d = Math.hypot(x - cx, y - cy); return d < R - 3 ? TL.GRASS : d < R ? TL.SAND : null; });
      E.tiles(cx - 3, cy + 6, cx + 3, cy + 12, () => TL.PLAZA); // 헬리패드
      E.tiles(cx + R - 2, cy - 1, cx + R + 8, cy + 1, () => TL.DOCK); // 부두
      E.building(cx - 6, cy - 8, cx + 5, cy - 1, 12, 'mid', '#f2f2f2', '개인 섬 빌라');
      for (let a = 0; a < TAU; a += 0.55) E.tree((cx + Math.cos(a) * (R - 5)) * T, (cy + Math.sin(a) * (R - 5)) * T, 'palm');
      E.place('c_island', cx * T, (cy + 1.5) * T, '개인 섬 빌라 (저장·휴식)', 'safehouse', '島', '#9be15d');
      W.marinas.push({ x: (cx + R + 11) * T, y: cy * T, a: 0, car: null, cd: 0, island: true });
      this.heliSpot = { x: cx * T, y: (cy + 9) * T };
      W.mapLabels.push({ name: '개인 섬', x: cx * T, y: (cy - R - 4) * T });
      E.touch(cx - R - 1, cy - R - 1, cx + R + 10, cy + R + 1);
    }
  },
  // 케이블카: 하부역 → 실버 피크 정상 (탑·케이블·곤돌라) — 3D 전역 메시
  cableMesh() {
    const S = View3D.scene, a = { x: 1068 * T, y: 172 * T }, b = { x: 975 * T, y: 112 * T }, N = 7, pts = [];
    for (let k = 0; k <= N; k++) { const f = k / N, x = lerp(a.x, b.x, f), y = lerp(a.y, b.y, f), g = mountainH(x / T, y / T); pts.push({ x, y, g, top: g + (k === N ? 6 : 16) }); }
    const grp = new THREE.Group(), steel = View3D.mat('#9aa3ad'), dark = View3D.mat('#2b2d31');
    for (const p of pts.slice(1, -1)) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, p.top - p.g + 2, 6), steel); m.position.set(p.x, (p.top + p.g) / 2 - 1, p.y); grp.add(m); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), steel); arm.position.set(p.x, p.top, p.y); grp.add(arm); }
    for (let k = 0; k < N; k++) { const p = pts[k], q = pts[k + 1], L = Math.hypot(q.x - p.x, q.y - p.y, q.top - p.top); for (const off of [-2, 2]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, L, 4), dark); c.position.set((p.x + q.x) / 2, (p.top + q.top) / 2, (p.y + q.y) / 2 + off); c.lookAt(q.x, q.top, q.y + off); c.rotateX(Math.PI / 2); grp.add(c); } }
    const top = pts[N]; const st = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), View3D.mat('#c9ced6')); st.position.set(top.x, top.g + 3.5, top.y); grp.add(st);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 16), View3D.mat('#8a6d4a')); deck.position.set(top.x, top.g + 7.3, top.y); grp.add(deck);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 2.4), View3D.mat('#d7263d')); grp.add(cab); this.cab = { mesh: cab, pts };
    S.add(grp); this.meshes = grp;
  },
  animate(t) { // 곤돌라가 오르내린다 (view3d 렌더 전에 부르기)
    if (!this.cab) return; const { mesh, pts } = this.cab, N = pts.length - 1, u = (Math.sin(t * 0.05) * 0.5 + 0.5) * N, k = Math.min(N - 1, Math.floor(u)), f = u - k, p = pts[k], q = pts[k + 1];
    mesh.position.set(lerp(p.x, q.x, f), lerp(p.top, q.top, f) - 2.4, lerp(p.y, q.y, f));
  },
};
SaveExt.mods.mega = Mega;
Props.providers.push(() => Mega.props());
Props.providers.push(() => { // 2D: 케이블 선 (가는 상자)
  if (!Mega.done('cable')) return [];
  const a = { x: 1068 * T, y: 172 * T }, b = { x: 975 * T, y: 112 * T }, L = dist(a.x, a.y, b.x, b.y);
  return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x), w: L, d: 0.3, h: 0.1, z: 30, c: '#2b2d31', no3d: true }];
});

// ---------- 창 ----------
SHOPS.mega = {
  title: '초대형 프로젝트', get sub() { return `착공(대금) → 준비 의뢰 → 공사 → 완공 · 완공 수입 1분 $${Mega.perMin().toLocaleString()}`; },
  items: () => Object.entries(MEGA_DEFS).map(([k, D]) => {
    const s = Mega.st[k], P = Game.player;
    if (!s) return { id: 'mg_' + k, name: D.name, price: D.cost, btn: '착공', desc: `${D.income ? `완공 후 1분 $${D.income.toLocaleString()}` : '빌라(저장) · 헬리패드 · 부두'} · 공사 ${D.min}분`, ok: () => P.money >= D.cost, fn: () => { Mega.begin(k); Shop.open('mega'); } };
    if (s.stage === 'prep') { const def = SIDE_DEFS.find(d => d.id === D.prep); return { id: 'mg_' + k, name: `${D.name} — 준비 의뢰`, price: 0, btn: '시작', desc: def ? def.title : '', ok: () => !Missions.active && !!def, fn: () => { Shop.close(); Missions.startSide(def); } }; }
    if (s.stage === 'build') return { id: 'mg_' + k, name: `${D.name} — 공사 중`, price: 0, btn: `${Math.ceil(s.left / 60)}분`, desc: '크레인이 돌아가고 있다', ok: () => false, fn: () => { } };
    const p = Mega.site(k); return { id: 'mg_' + k, name: `${D.name} — 완공`, price: 0, btn: '위치', desc: D.income ? `1분 수입 $${D.income.toLocaleString()}` : '내 섬', ok: () => !!p, fn: () => { Game.waypoint = { x: p.x, y: p.y }; UI.toast('지도에 표시했다'); Shop.close(); } };
  }),
};
if (SHOPS.devco) { const _i = SHOPS.devco.items; SHOPS.devco.items = function () { const l = _i.call(this); l.unshift({ id: 'megalink', name: '초대형 프로젝트 (케이블카 · 리조트 · 사막 카지노 · 개인 섬)', price: 0, btn: '열기', desc: '지도가 바뀌는 대공사', ok: () => true, fn: () => Shop.open('mega') }); return l; }; }
SHOPS.cablecar = {
  title: '실버 피크 케이블카', sub: '정상 전망대 — 125m 높이에서 낙하산으로 뛰어내릴 수 있다',
  items: () => [{ id: 'ride', name: '정상으로 (낙하산 점프)', price: 500, btn: '탑승', desc: '정상 전망대에서 낙하산으로 뛰어내린다 · WASD로 방향', ok: () => Game.player.money >= 500 && !Game.player.car, fn: () => { const P = Game.player; P.money -= 500; Shop.close(); summitJump(); } }],
};
function summitJump() {
  const P = Game.player, x = 975.5 * T, y = 112.5 * T, h = mountainH(975.5, 112.5);
  const a = Math.atan2(172 - 112, 1068 - 975); // 케이블카 하부역 쪽으로 활공
  P.x = x; P.y = y; P.alt = h + 25; P.vz = 4.5; P.chute = true; P.paraT = 1.4; P.vx = Math.cos(a) * 7; P.vy = Math.sin(a) * 7; P.a = a;
  UI.big('실버 피크 정상', '낙하산을 펴고 뛰어내렸다! (WASD로 방향)', 3, '#6fe0ff');
}
SHOPS.resort = {
  title: '솔트 레이크 리조트', sub: '호숫가 스위트룸과 스파',
  items: () => [
    { id: 'stay', name: '스위트룸 숙박 (저장 · 체력·방탄 가득)', price: 5000, btn: '숙박', desc: '다음 날 아침까지 쉰다', ok: () => Game.player.money >= 5000, fn: () => { const P = Game.player; P.money -= 5000; P.hp = P.maxHp; P.armor = 100; Game.clock = (Math.floor(Game.clock / 1440) + 1) * 1440 + 8 * 60; Save.write(); Shop.close(); UI.big('푹 쉬었다', '저장 완료 · 아침 8시', 2.5, '#ffd166'); } },
    { id: 'spa', name: '스파', price: 1500, btn: '이용', desc: '체력 가득', ok: () => Game.player.money >= 1500, fn: () => { const P = Game.player; P.money -= 1500; P.hp = P.maxHp; Shop.close(); UI.toast('개운하다!'); } },
  ],
};
SHOPS.dcasino = {
  title: '샌디 밸리 카지노 호텔', get sub() { return `사막의 카지노 — 베팅 한도 $${Casino.limit().toLocaleString()}`; },
  items: () => [{ id: 'play', name: '카지노 입장 — 룰렛 · 슬롯 · 블랙잭', price: 0, btn: '입장', desc: '내 카지노 (베팅 한도 2배)', ok: () => true, fn: () => { Shop.close(); Casino.open(); } }],
};
{ const _lim = Casino.limit.bind(Casino); Casino.limit = () => _lim() * (Mega.done('casino') ? 2 : 1); }

// ---------- 준비 의뢰 ----------
SIDE_DEFS.push(
  Object.assign(stepsDef({
    title: '케이블카 부지 확보', reward: 0,
    intro: [['개발청 담당자', '실버 피크 기슭 공사 부지에 불법 캠프가 있습니다. 아이언 놈들이죠.'], ['개발청 담당자', '치워 주시면 측량을 시작하겠습니다.']],
    outro: [['개발청 담당자', '측량 끝. 공사를 시작합니다!']],
    steps: [
      { t: 'go', at: () => cty(1066, 186), text: '케이블카 부지로 (숲길)', r: 12 },
      { t: 'kill', at: () => cty(1072, 176), n: 6, gang: 'iron', text: '불법 캠프의 조직원을 처리하라' },
      { t: 'hold', at: () => cty(1067, 180), sec: 8, text: '측량 중 — 자리를 지켜라' },
    ],
  }), { id: 'm_cable', kind: 'mega', onDone: () => Mega.prepDone('cable') }),
  Object.assign(stepsDef({
    title: '리조트 토지 계약', reward: 0,
    intro: [['개발청 담당자', '호숫가 땅 주인이 계약서를 도시 변호사에게 맡겼어요.'], ['개발청 담당자', '변호사 차를 가져와서 계약서를 리조트 부지까지 가져다주세요. 빨리요!']],
    outro: [['개발청 담당자', '서명 완료! 리조트 공사를 시작합니다.']],
    steps: [
      { t: 'steal', type: 'sedan', color: '#1b1b1f', text: '변호사의 검은 세단을 훔쳐라' },
      { t: 'deliver', at: () => cty(1005, 268), timer: 420, text: '계약서를 솔트 레이크 리조트 부지로', r: 14 },
    ],
  }), { id: 'm_resort', kind: 'mega', onDone: () => Mega.prepDone('resort') }),
  Object.assign(stepsDef({
    title: '카지노 허가와 퇴거', reward: 0,
    intro: [['개발청 담당자', '카지노는 시청 허가가 필요해요. 서류를 내고,'], ['개발청 담당자', '부지에 버티는 코브라 놈들을 치워 주세요.']],
    outro: [['개발청 담당자', '허가 났습니다. 사막에 불을 밝히죠!']],
    steps: [
      { t: 'hold', at: () => World.places.cityhall ? sidewalkNear(World.places.cityhall.x, World.places.cityhall.y, 5) : at(0.5, 0.45), sec: 6, text: '시청에 허가 서류 제출', r: 8 },
      { t: 'kill', at: () => cty(953, 440), n: 7, gang: 'cobra', text: '카지노 부지의 코브라 조직원을 처리하라' },
      { t: 'evade', stars: 2, text: '보안관을 따돌려라' },
    ],
  }), { id: 'm_casino', kind: 'mega', onDone: () => Mega.prepDone('casino') }),
  Object.assign(stepsDef({
    title: '섬 측량', reward: 0,
    intro: [['개발청 담당자', '바다 한가운데 매립 허가가 났어요. 보트로 가서 측량해 주세요.']],
    outro: [['개발청 담당자', '측량 완료. 이제 모래를 부어 섬을 만듭니다!']],
    steps: [
      { t: 'steal', type: 'speedboat', color: '#f2f2f2', at: () => { const m = (World.marinas || [])[0]; return { x: m.x, y: m.y, a: m.a }; }, text: '보트에 타라' },
      { t: 'hold', at: () => { const s = Mega.site('island'); return s || at(0.9, 0.9); }, sec: 10, r: 18, text: '섬 부지에서 측량 (보트 위에서)' },
    ],
  }), { id: 'm_island', kind: 'mega', onDone: () => Mega.prepDone('island') }),
);

// ---------- 전체 지도: 개발 부지 표시 (N) — 빈 필지 · 공사 중 · 완공 · 초대형 프로젝트 부지 ----------
function drawDevSites(c, ox, oy, k, ox0, oy0, mw, mh) {
  const inView = (x, y) => x > ox0 - 20 && y > oy0 - 20 && x < ox0 + mw + 20 && y < oy0 + mh + 20, big = MapView.z >= 2.2;
  const rect = (L, fill, stroke) => { const x = ox + L.x0 * T * k, y = oy + L.y0 * T * k, w = Math.max(4, (L.x1 - L.x0 + 1) * T * k), h = Math.max(4, (L.y1 - L.y0 + 1) * T * k); if (!inView(x, y)) return null; c.fillStyle = fill; c.fillRect(x, y, w, h); c.strokeStyle = stroke; c.lineWidth = 1.5; c.strokeRect(x, y, w, h); return [x + w / 2, y]; };
  const busy = new Set(Dev.list.map(p => p.x0 + ',' + p.y0));
  let nFree = 0;
  for (const L of Dev.lots()) { if (busy.has(L.x0 + ',' + L.y0)) continue; nFree++; rect(L, 'rgba(111,224,255,0.35)', '#6fe0ff'); }
  for (const p of Dev.list) { const at = rect(p, p.done ? 'rgba(122,230,143,0.6)' : 'rgba(255,159,28,0.7)', p.done ? '#7ae68f' : '#ff9f1c'); if (at && (big || !p.done)) txt(c, p.done ? DEV_KINDS[p.kind].name : `공사 ${Math.ceil(p.left / 60)}분`, at[0], at[1] - 4, `700 11px ${FONT_KR}`, p.done ? '#7ae68f' : '#ffb347', 'rgba(0,0,0,0.9)', 3, 'center'); }
  for (const [key, D] of Object.entries(MEGA_DEFS)) {
    const p = Mega.site(key); if (!p) continue; const s = Mega.st[key], x = ox + p.x * k, y = oy + p.y * k; if (!inView(x, y)) continue;
    const col = !s ? '#ffd166' : s.stage === 'done' ? '#7ae68f' : s.stage === 'build' ? '#ff9f1c' : '#f2e6bf';
    c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash(s ? [] : [5, 4]); c.beginPath(); c.arc(x, y, Math.max(9, 60 * k), 0, TAU); c.stroke(); c.setLineDash([]);
    const tag = !s ? `예정지 · $${(D.cost / 1e6).toLocaleString()}M` : s.stage === 'prep' ? '준비 의뢰 중' : s.stage === 'build' ? `공사 ${Math.ceil(s.left / 60)}분` : '완공';
    txt(c, D.name, x, y - Math.max(12, 60 * k) - 14, `700 12px ${FONT_KR}`, col, 'rgba(0,0,0,0.9)', 3, 'center');
    txt(c, tag, x, y - Math.max(12, 60 * k) - 1, `600 11px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 3, 'center');
  }
  const s = `개발 부지 — 하늘색: 빈 필지 ${nFree}곳 (하버 개발 창에서 착공) · 주황: 공사 중 · 초록: 완공 · 점선 원: 초대형 프로젝트 예정지`;
  c.font = `600 12px ${FONT_KR}`; const w = c.measureText(s).width + 16;
  c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(ox0 + 6, oy0 + 6, w, 22); txt(c, s, ox0 + 14, oy0 + 22, `600 12px ${FONT_KR}`, '#6fe0ff', null);
}
const openDevMap = () => { Shop.close(); Game.showDev = true; Game.state = 'map'; };
{ const _i = SHOPS.devco.items; SHOPS.devco.items = function () { const l = _i.call(this); l.unshift({ id: 'devmap', name: '지도에서 개발 부지 보기', price: 0, btn: '지도', desc: '빈 필지 · 공사 중 · 완공 건물 · 초대형 프로젝트 예정지를 전체 지도에 표시한다 (지도에서 N 키)', ok: () => true, fn: openDevMap }); return l; }; }
{ const _i = SHOPS.mega.items; SHOPS.mega.items = function () { const l = _i.call(this); l.unshift({ id: 'megamap', name: '지도에서 예정지·공사 현장 보기', price: 0, btn: '지도', desc: '초대형 프로젝트 네 곳의 위치 (지도에서 N 키)', ok: () => true, fn: openDevMap }); return l; }; }
