'use strict';
/* =====================================================================
 * billionaire.js — 억만장자 콘텐츠 (v2.21): 수백억 달러를 쓰는 곳
 *
 *  · 도시 매입: 동네(도시 17 + 카운티 10)를 통째로 산다 ($6억 ~ $80억). 1분마다 땅값의 0.03% 수입,
 *    내 동네에선 수배가 빨리 풀린다. 10곳 · 도시 전부 · 전부를 사면 칭호와 에투알 광장에 내 동상.
 *  · 우주 계획: 사막에 우주 기지($50억) → 통신 위성($80억) → 유인 달 탐사($400억) → 화성 이주선($1,500억)
 *    단계마다 준비 기간 뒤 발사대에서 직접 발사 버튼 — 로켓이 불꽃과 연기를 뿜으며 하늘로 올라간다.
 *  · 네온 스카이 타워 II ($200억): 다운타운에 320m 세계 최고층 — 도시 어디서나 보인다. 전망대에서 낙하산 점프.
 *  · 초호화 요트 '네온 레이디' ($30억): 34m 요트, 가까운 마리나로 부른다.
 *  · 사설 군대: 경호팀 4명(고용 $5억 + 1분 $200만), 전차 $10억 · 공격 헬기 $20억 · 전투기 $30억 (사면 어디서나 호출).
 *  휴대폰(I)의 [억만장자] 앱에서 모두 관리한다.
 * ===================================================================== */

GANGS.pmc = { name: '네온 시큐리티', shirt: '#17181c', band: '#c9d1d9', pants: '#17181c', color: '#c9d1d9', short: '경' };
{ const _f = Gangs.friendly.bind(Gangs); Gangs.friendly = p => (p && p.pmc) || _f(p); }

VTYPES.megayacht = { name: '네온 레이디 (초호화 요트)', L: 34, W: 8, mass: 400000, Fe: 1, vmax: 20, grip: 1, cs: 5, steer: 0.32, hp: 4000, colors: ['#f4f4f4'], style: 'boat', special: 'boat', accel: 2.2, armor: 0.85 };
if (typeof VEHICLE_PRICES !== 'undefined') VEHICLE_PRICES.megayacht = 3e9;

const HOOD_PRICE = { [DIST.DOWNTOWN]: 8e9, [DIST.MIDTOWN]: 3e9, [DIST.RESID]: 1.5e9, [DIST.HARBOR]: 2.5e9, [DIST.BEACH]: 2e9, [DIST.INDUSTRY]: 1.8e9 };
const COUNTY_TOWNS = ['샌디 밸리', '파인 베이', '골든 필즈', '레드 록'];
function hoodPrice(i) { const h = World.hoods[i]; if (h.county) return COUNTY_TOWNS.includes(h.name) ? 1e9 : 6e8; return HOOD_PRICE[h.d] || 1.5e9; }
const SPACE = [
  { name: '우주 기지 건설', cost: 5e9, min: 6, desc: '레드 메사 사막에 발사대·관제센터·조립동' },
  { name: '통신 위성 발사', cost: 8e9, min: 3, desc: '위성: 어디서든 수배가 더 빨리 풀린다', cut: [['관제센터', '위성 궤도 진입 성공! 이제 도시 어디서든 경찰 무전을 먼저 듣는다.']] },
  { name: '유인 달 탐사', cost: 4e10, min: 6, desc: '달 관광 사업: 1분 수입 $5천만', cut: [['관제센터', '…착륙했습니다. 달 표면에 네온 하버 깃발이 섰습니다!'], ['네온 뉴스', '"도시의 왕, 이제는 달의 주인" — 전 세계가 네온 하버를 본다.']] },
  { name: '화성 이주선', cost: 1.5e11, min: 10, desc: '인류 최초의 화성 도시 — 엔딩', cut: [['관제센터', '화성 이주선 발사 성공. 도착까지 7개월.'], ['마담 윤', '거리의 꼬마가 우주까지 갔네. 이제 더 올라갈 곳도 없겠어.'], ['네온 하버', '— 우주의 왕 —']] },
];
const PMC_VEH = { tank: { type: 'tank', name: '라이노 전차', cost: 1e9 }, heli: { type: 'milheli', name: '헌터 공격 헬기', cost: 2e9 }, jet: { type: 'jet', name: '라저 전투기', cost: 3e9 } };

const Bill = {
  hoods: {}, space: { stage: 0, state: 'none', left: 0 }, tower: { state: 'none', left: 0, lot: null }, yacht: false, pmc: {}, guardsOn: false, titles: {},
  t: 0, applied: {}, launch: null, guards: [], summonCD: 0,
  save() { return { hoods: this.hoods, space: this.space, tower: this.tower, yacht: this.yacht, pmc: this.pmc, guardsOn: this.guardsOn, titles: this.titles }; },
  load(o) { o = o || {}; this.hoods = o.hoods || {}; this.space = o.space || { stage: 0, state: 'none', left: 0 }; this.tower = o.tower || { state: 'none', left: 0, lot: null }; this.yacht = !!o.yacht; this.pmc = o.pmc || {}; this.guardsOn = !!o.guardsOn; this.titles = o.titles || {}; this.applied = {}; this.launch = null; this.guards = []; },
  pay(cost) { const P = Game.player; if (P.money < cost) { UI.toast(`돈이 모자라다 ($${fmtB(cost)} 필요)`); return false; } P.money -= cost; Sfx.cash(); return true; },
  hoodIncome() { return Object.keys(this.hoods).reduce((a, i) => a + hoodPrice(+i) * 0.0003, 0); },
  perMin() { return Math.round(this.hoodIncome() + (this.tower.state === 'done' ? 3e7 : 0) + (this.space.stage >= 3 ? 5e7 : 0) - (this.guardsOn ? 2e6 : 0)); },
  ownedCount(county) { return Object.keys(this.hoods).filter(i => !!World.hoods[i].county === county).length; },

  // ---------- 도시 매입 ----------
  buyHood(i) {
    if (this.hoods[i] || !this.pay(hoodPrice(i))) return;
    this.hoods[i] = 1; const h = World.hoods[i];
    UI.big(`${h.name} 매입!`, `1분 수입 $${fmtB(hoodPrice(i) * 0.0003)} · 이 동네에선 수배가 빨리 풀린다`, 3, '#ffd700');
    const city = World.hoods.filter(q => !q.county).length, cty = World.hoods.filter(q => q.county).length, n = Object.keys(this.hoods).length;
    if (n >= 10 && !this.titles.ten) { this.titles.ten = 1; setTimeout(() => UI.big('칭호: 땅의 주인', '동네 10곳을 가졌다', 3.5, '#ffd700'), 3200); }
    if (this.ownedCount(false) >= city && !this.titles.city) { this.titles.city = 1; setTimeout(() => { UI.big('칭호: 도시의 주인', '네온 하버의 모든 동네가 네 것이다 — 에투알 광장에 동상이 섰다', 4.5, '#ffd700'); this.applyStatue(); }, 3400); }
    if (n >= city + cty && !this.titles.all) { this.titles.all = 1; setTimeout(() => UI.big('칭호: 섬과 대륙의 주인', '도시와 카운티 전부를 샀다', 4.5, '#ffd700'), 8000); }
    Save.write();
  },
  inOwnedHood(x, y) { const tx = clamp(Math.floor(x / T), 0, MW - 1), ty = clamp(Math.floor(y / T), 0, MH - 1), h = World.hoodT ? World.hoodT[tx + ty * MW] : 255; return h < 255 && !!this.hoods[h]; },
  applyStatue() {
    if (this.applied.statue || !World.etoile) return; this.applied.statue = true;
    const E = World.etoile; World.decos.push({ t: 'spire', x: (E.cx + 0.5) * T, y: (E.cy + 0.5) * T, z: 4, h: 10, c: '#d4af37' });
    WorldEdit.building(E.cx - 1, E.cy - 1, E.cx + 1, E.cy + 1, 4, 'arch', '#d4af37', '내 동상 (도시의 주인)');
    if (View3D.bucket) { const CS = View3D.CS, k = clamp(Math.floor((E.cx + 0.5) * T / CS), 0, View3D.NCX - 1) + clamp(Math.floor((E.cy + 0.5) * T / CS), 0, View3D.NCY - 1) * View3D.NCX; View3D.bucket[k].decos.push(World.decos[World.decos.length - 1]); }
    WorldEdit.touch(E.cx - 2, E.cy - 2, E.cx + 2, E.cy + 2);
  },

  // ---------- 우주 계획 ----------
  padX: 737.5 * T, padY: 446.5 * T,
  spaceBegin() {
    const S = this.space, D = SPACE[S.stage]; if (!D || S.state !== 'none') return;
    if (!this.pay(D.cost)) return;
    S.state = 'build'; S.left = D.min * 60; UI.big(D.name, `${D.min}분 뒤 ${S.stage === 0 ? '완공' : '발사 준비 완료'}`, 3, '#6fe0ff'); Save.write();
  },
  applyBase() {
    if (this.applied.base) return; this.applied.base = true; const E = WorldEdit, W = World;
    E.tiles(712, 426, 763, 467, (x, y) => [TL.GRASS, TL.SAND].includes(W.tiles[tIdx(x, y)]) ? TL.PLAZA : null);
    E.building(716, 430, 725, 437, 10, 'mid', '#d0d4da', '네온 우주센터 관제동');
    E.building(748, 452, 758, 463, 34, 'warehouse', '#e8ecef', '로켓 조립동');
    E.place('c_space', 721 * T, 439 * T, '네온 우주센터', 'spaceport', '宇', '#6fe0ff');
    W.mapLabels.push({ name: '우주 기지', x: 737 * T, y: 422 * T, small: true });
    E.touch(710, 424, 765, 469);
  },
  launchNow() {
    const S = this.space; if (S.state !== 'ready' || this.launch) return;
    this.launch = { t: 0, stage: S.stage }; S.state = 'flying';
    UI.big('발사 10초 전', `${SPACE[S.stage].name} — 발사대에서 떨어져 지켜보자`, 3, '#ff9f1c');
  },
  rocketAlt() { const L = this.launch; if (!L || L.t < 10) return 0; const t = L.t - 10; return 0.5 * 7 * t * t; },
  updateLaunch(dt) {
    const L = this.launch; if (!L) return; L.t += dt;
    const x = this.padX, y = this.padY, alt = this.rocketAlt();
    if (L.t > 7 && L.t < 10) { if (chance(dt * 12)) Particles.smoke(x + rand(-8, 8), y + rand(-8, 8), 2.5, '#d8d8d8'); }
    if (L.t >= 10) {
      for (let k = 0; k < 3; k++) Particles.smoke(x + rand(-6, 6), y + rand(-6, 6), 3, k ? '#e8e8e8' : '#ffb347');
      if (L.t < 14) { Cam.shake = Math.max(Cam.shake, 0.5); if (!L.boom) { L.boom = true; Sfx.explode && Sfx.explode(x, y, 3); } }
    }
    if (L.t > 36) {
      const S = this.space, D = SPACE[L.stage]; this.launch = null; S.stage = L.stage + 1; S.state = 'none';
      UI.big('발사 성공!', D.desc, 4, '#6fe0ff'); Msgs.add('네온 우주센터', `${D.name} 성공.`); Save.write();
      if (D.cut && typeof Cutscene !== 'undefined') setTimeout(() => Cutscene.play([[D.name, '— 우주 계획 —'], ...D.cut], () => { }), 2500);
    }
  },

  // ---------- 네온 스카이 타워 II ----------
  // 다운타운엔 빈 필지가 없어서, 에투알 광장 가까운 큰 빌딩(5×5칸 이상)을 헐고 다시 짓는다
  towerLot() {
    if (this.tower.lot) return this.tower.lot;
    const E = World.etoile, ex = (E ? E.cx : CITY_W / 2) * T, ey = (E ? E.cy : CITY_H / 2) * T;
    const busy = b => Object.values(World.places).some(q => q && q.x >= b.x0 * T - 6 && q.x <= (b.x1 + 1) * T + 6 && q.y >= b.y0 * T - 6 && q.y <= (b.y1 + 1) * T + 6);
    const l = World.buildings.filter(b => !b.county && !b.mega && !b.dev && (b.kind === 'tower' || b.kind === 'mid') && b.x1 - b.x0 >= 4 && b.y1 - b.y0 >= 4 && b.x1 < CITY_W && b.y1 < CITY_H && !busy(b))
      .sort((a, b) => dist((a.x0 + a.x1) / 2 * T, (a.y0 + a.y1) / 2 * T, ex, ey) - dist((b.x0 + b.x1) / 2 * T, (b.y0 + b.y1) / 2 * T, ex, ey))[0];
    return l ? (this.tower.lot = { x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 }) : null;
  },
  towerBegin() { const L = this.towerLot(); if (!L || this.tower.state !== 'none') { if (!L) UI.toast('다시 지을 빌딩을 찾지 못했다'); return; } if (!this.pay(2e10)) return; this.tower.state = 'build'; this.tower.left = 15 * 60; UI.big('네온 스카이 타워 II 착공', '에투알 광장 옆 빌딩을 헐고 15분 뒤 320m 세계 최고층', 3, '#ffd700'); Save.write(); },
  applyTower() {
    if (this.applied.tower) return; const L = this.tower.lot; if (!L) return; this.applied.tower = true;
    const b = World.buildings.find(q => q.x0 === L.x0 && q.y0 === L.y0 && q.x1 === L.x1 && q.y1 === L.y1);
    if (b) Object.assign(b, { h: 320, kind: 'tower', color: '#8fa8c0', lit: 0.9, mega: true, label: '네온 스카이 타워 II' });
    else WorldEdit.building(L.x0, L.y0, L.x1, L.y1, 320, 'tower', '#8fa8c0', '네온 스카이 타워 II');
    const [px, py] = openSpotNear((L.x0 + L.x1 + 1) / 2 * T, (L.y1 + 1) * T + 3);
    WorldEdit.place('c_tower2', px, py, '네온 스카이 타워 II 전망대', 'tower2', '塔', '#ffd700');
    World.mapLabels.push({ name: '스카이 타워 II', x: (L.x0 + L.x1 + 1) / 2 * T, y: (L.y0 - 3) * T, small: true });
    WorldEdit.touch(L.x0 - 1, L.y0 - 1, L.x1 + 1, L.y1 + 3);
  },
  towerJump() {
    const L = this.tower.lot, P = Game.player; if (!L) return;
    P.x = (L.x1 + 1) * T + 14; P.y = (L.y0 + L.y1 + 1) / 2 * T; P.alt = 330; P.vz = 4.5; P.chute = true; P.paraT = 1.4; P.vx = 7; P.vy = 0; P.a = 0;
    UI.big('네온 스카이 타워 II 전망대', '320m에서 낙하산으로 뛰어내렸다! (WASD로 방향)', 3, '#ffd700');
  },

  // ---------- 요트 · 사설 군대 ----------
  nearestMarina() { const P = Game.player; let b = null, bd = 1e18; for (const m of World.marinas || []) { const d = dist2(m.x, m.y, P.px, P.py); if (d < bd) { bd = d; b = m; } } return b; },
  callYacht() {
    const m = this.nearestMarina(); if (!m) return;
    for (const c of Game.cars) if (c.type === 'megayacht' && c.owned) c.remove = true;
    const a = m.a || 0, x = m.x + Math.cos(a) * 30, y = m.y + Math.sin(a) * 30;
    const c = new Car('megayacht', tileAt(x, y) === TL.WATER ? x : m.x, tileAt(x, y) === TL.WATER ? y : m.y, a, { persistent: true }); c.owned = true; c.label = '내 요트 네온 레이디'; Game.cars.push(c);
    Game.waypoint = { x: c.x, y: c.y }; UI.toast('네온 레이디가 가까운 마리나에 도착했다 (지도 표시)');
  },
  callVehicle(k) {
    if (this.summonCD > 0) { UI.toast(`호출 대기 ${Math.ceil(this.summonCD)}초`); return; }
    const V = PMC_VEH[k], P = Game.player; let x, y, a = 0;
    if (k === 'tank') { const s = roadsideSpot(P.px, P.py, 15, 60); x = s.x; y = s.y; a = s.a || 0; }
    else { const [ox, oy] = openSpotNear(P.px + 20, P.py + 10); x = ox; y = oy; }
    const c = new Car(V.type, x, y, a, { persistent: true }); c.alt = 0; c.label = `내 ${V.name}`; c.owned = true; Game.cars.push(c);
    this.summonCD = 45; Game.waypoint = { x, y }; UI.toast(`${V.name} 도착 (지도 표시)`);
  },
  spawnGuards() {
    const P = Game.player; this.guards = this.guards.filter(p => Game.peds.includes(p) && !p.dead);
    for (let k = this.guards.length; k < 4; k++) {
      const [x, y] = openSpotNear(P.px + rand(-6, 6), P.py + rand(-6, 6));
      const p = spawnPed('gang', x, y); setGang(p, 'pmc');
      Object.assign(p, { persistent: true, state: 'pmc', pmc: true, hp: 260, maxHp: 260, armor: 100, weapon: pick(['rifle', 'smg', 'rifle']), nameTag: '경호원', hat: '#0d0d10' });
      this.guards.push(p);
    }
  },
  update(dt) {
    const P = Game.player; if (!P || !World.county) return;
    this.summonCD -= dt;
    if (this.space.stage >= 1) this.applyBase();
    if (this.tower.state === 'done') this.applyTower();
    if (this.titles.city) this.applyStatue();
    this.updateLaunch(dt);
    if (View3D.scene) this.rocket3D();
    // 수배: 내 동네·위성
    if (Wanted.stars > 0 && Wanted.evadeT > 0) Wanted.evadeT += dt * ((this.inOwnedHood(P.px, P.py) ? 0.5 : 0) + (this.space.stage >= 2 ? 0.3 : 0));
    // 경호팀
    if (this.guardsOn && !P.dead) { this.gT = (this.gT || 0) - dt; if (this.gT <= 0) { this.gT = 20; this.spawnGuards(); } }
    this.t += dt;
    if (this.t >= 1) {
      const step = this.t; this.t = 0; const S = this.space;
      if (S.state === 'build') { S.left -= step; if (S.left <= 0) { if (S.stage === 0) { S.stage = 1; S.state = 'none'; this.applyBase(); UI.big('네온 우주센터 완공', '관제센터에서 다음 단계를 진행하자', 3.5, '#6fe0ff'); } else { S.state = 'ready'; UI.big('발사 준비 완료', `${SPACE[S.stage].name} — 네온 우주센터에서 발사`, 3.5, '#6fe0ff'); } Save.write(); } }
      const Tw = this.tower; if (Tw.state === 'build') { Tw.left -= step; if (Tw.left <= 0) { Tw.state = 'done'; this.applyTower(); UI.big('네온 스카이 타워 II 완공', '세계 최고층 320m — 도시 어디서나 보인다', 4, '#ffd700'); Save.write(); } }
      this.incT = (this.incT || 0) + step;
      if (this.incT >= 60) { this.incT -= 60; const n = this.perMin(); if (n) { P.money += n; UI.toast(`억만장자 수입 ${n >= 0 ? '+' : '-'}$${fmtB(Math.abs(n))}${this.guardsOn ? ' (경호팀 유지비 포함)' : ''}`); } }
    }
  },
  props() {
    const out = [];
    const S = this.space;
    if (S.stage >= 1 && (S.state === 'ready' || S.state === 'flying')) { const alt = this.rocketAlt(); if (alt < 80) { out.push({ x: this.padX, y: this.padY, w: 6, d: 6, h: 55, z: alt, c: '#f2f4f7', no3d: true }); if (this.launch && this.launch.t >= 10) out.push({ x: this.padX, y: this.padY, w: 5, d: 5, h: 12, z: Math.max(0, alt - 12), c: '#ff9f1c', glow: true, no3d: true }); } }
    if (S.stage >= 1) out.push({ x: this.padX + 12, y: this.padY, w: 3, d: 3, h: 70, c: '#c8201e', no2d: true });
    if (S.state === 'build' && S.stage === 0) out.push({ x: this.padX, y: this.padY, w: 30, d: 30, h: 8 + 20 * (1 - S.left / (SPACE[0].min * 60)), c: '#b8b0a0' });
    const Tw = this.tower; if (Tw.state === 'build' && Tw.lot) { const L = Tw.lot, prog = 1 - Tw.left / 900; out.push({ x: (L.x0 + L.x1 + 1) / 2 * T, y: (L.y0 + L.y1 + 1) / 2 * T, w: (L.x1 - L.x0 + 1) * T - 2, d: (L.y1 - L.y0 + 1) * T - 2, h: 20 + prog * 300, c: '#8fa8c0' }, { x: (L.x1 + 1) * T - 3, y: L.y0 * T + 3, w: 1.5, d: 1.5, h: 40 + prog * 310, c: '#ffb400' }); }
    return out;
  },
  // 3D: 발사대 로켓 (몸통 · 띠 · 원뿔 · 날개 · 불꽃) — 전역 메시
  rocket3D() {
    if (!View3D.scene) return;
    const show = this.space.stage >= 1 && (this.space.state === 'ready' || this.space.state === 'flying');
    if (!this.rk) {
      const g = new THREE.Group(), m = c => new THREE.MeshLambertMaterial({ color: c });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 48, 16), m('#f2f4f7')); body.position.y = 24; g.add(body);
      for (const yy of [12, 30]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 2, 16), m('#15161a')); b.position.y = yy; g.add(b); }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(3, 9, 16), m('#c8201e')); nose.position.y = 52.5; g.add(nose);
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 4), m('#15161a')); f.position.set(Math.cos(k * Math.PI / 2) * 3.4, 4, Math.sin(k * Math.PI / 2) * 3.4); f.rotation.y = -k * Math.PI / 2; g.add(f); }
      const fl = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 12), new THREE.MeshBasicMaterial({ color: 0xffb347 })); fl.rotation.x = Math.PI; fl.position.y = -7; g.add(fl);
      g.position.set(this.padX, 0, this.padY); View3D.scene.add(g); this.rk = { g, fl };
    }
    this.rk.g.visible = show; this.rk.g.position.y = this.rocketAlt(); this.rk.fl.visible = !!(this.launch && this.launch.t >= 10); this.rk.fl.scale.y = 1 + Math.random() * 0.4;
    // 스카이 타워 II: 멀리서도 보이는 전역 메시 (가까우면 청크 건물이 덮는다)
    if (this.tower.state === 'done' && this.tower.lot && !this.tw3) {
      const L = this.tower.lot, w = (L.x1 - L.x0 + 1) * T - 1, d = (L.y1 - L.y0 + 1) * T - 1;
      const mat = new THREE.MeshLambertMaterial({ color: '#7f96ad', fog: false }), g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 318, d), mat); b.position.set((L.x0 + L.x1 + 1) / 2 * T, 159, (L.y0 + L.y1 + 1) / 2 * T); g.add(b);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 60, 8), new THREE.MeshLambertMaterial({ color: '#d0d4da', fog: false })); sp.position.set(b.position.x, 350, b.position.z); g.add(sp);
      const lt = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2d2d })); lt.position.set(b.position.x, 381, b.position.z); g.add(lt);
      View3D.scene.add(g); this.tw3 = g;
    }
  },
};
SaveExt.mods.billion = Bill;
Props.providers.push(() => Bill.props());
const fmtB = n => n >= 1e8 ? `${(n / 1e8).toLocaleString(undefined, { maximumFractionDigits: 1 })}억` : Math.round(n).toLocaleString();

// 경호원 AI: 플레이어를 따라다니며 적(쫓아오는 경찰·라이벌·표적)을 쏜다
function pmcAI(p, dt) {
  const P = Game.player;
  if (!Bill.guardsOn || dist2(p.x, p.y, P.px, P.py) > 200 * 200) { p.remove = true; return; }
  if (p.foe && (p.foe.dead || !Game.peds.includes(p.foe) || dist2(p.x, p.y, p.foe.x, p.foe.y) > 35 * 35)) p.foe = null;
  if (!p.foe) { let best = null, bd = 22 * 22; for (const q of Game.peds) { if (q.dead || q === p || q.car || q.pmc || q.kind === 'animal' || q.kind === 'dog' || Gangs.friendly(q)) continue; const hostile = q.state === 'chase' || q.state === 'fight' || q.kind === 'target' || (q.kind === 'gang' && q.state === 'escort' && false); if (!hostile) continue; const d2 = dist2(q.x, q.y, P.px, P.py); if (d2 < bd) { bd = d2; best = q; } } p.foe = best; }
  if (p.foe) { feudAI(p, dt); p.state = 'pmc'; return; }
  const d = dist(p.x, p.y, P.px, P.py);
  if (P.car) { if (d > 6) pedSeek(p, P.px, P.py, 7, dt, 14); else { p.vx *= 0.8; p.vy *= 0.8; } }
  else if (d > 3) pedSeek(p, P.px - Math.cos(P.a) * 2.5, P.py - Math.sin(P.a) * 2.5, d > 10 ? 7.5 : 4.5, dt, 14);
  else { p.vx *= 0.8; p.vy *= 0.8; }
}

// ---------- 창 ----------
SHOPS.citybuy = {
  title: '도시 매입', get sub() { const c = World.hoods.filter(q => !q.county).length, k = World.hoods.filter(q => q.county).length; return `도시 ${Bill.ownedCount(false)}/${c} · 카운티 ${Bill.ownedCount(true)}/${k} · 땅 수입 1분 $${fmtB(Bill.hoodIncome())} · 내 동네에선 수배가 빨리 풀린다`; },
  items: () => World.hoods.map((h, i) => ({ h, i })).sort((a, b) => (!!Bill.hoods[a.i] - !!Bill.hoods[b.i]) || hoodPrice(b.i) - hoodPrice(a.i)).map(({ h, i }) => ({
    id: 'hood_' + i, name: `${h.name}${h.county ? ' (카운티)' : ''}${Bill.hoods[i] ? ' — 내 땅' : ''}`, price: Bill.hoods[i] ? 0 : hoodPrice(i), btn: Bill.hoods[i] ? '소유' : '매입',
    desc: `1분 수입 $${fmtB(hoodPrice(i) * 0.0003)}`, ok: () => !Bill.hoods[i], fn: () => { Bill.buyHood(i); Shop.open('citybuy'); },
  })),
};
SHOPS.spaceport = {
  title: '네온 우주센터', get sub() { const S = Bill.space; return `단계 ${S.stage}/${SPACE.length}${S.state === 'build' ? ` · 준비 중 ${Math.ceil(S.left / 60)}분` : S.state === 'ready' ? ' · 발사 준비 완료!' : ''}`; },
  items: () => {
    const S = Bill.space, out = [];
    SPACE.forEach((D, k) => {
      const done = S.stage > k, cur = S.stage === k;
      if (done) out.push({ id: 'sp' + k, name: `${D.name} — 완료`, price: 0, btn: '✓', desc: D.desc, ok: () => false, fn: () => { } });
      else if (cur && S.state === 'ready') out.push({ id: 'sp' + k, name: `${D.name} — 발사!`, price: 0, btn: '발사', desc: '카운트다운 10초 · 발사대(빨간 탑 옆)에서 떨어져서 보자', ok: () => !Bill.launch, fn: () => { Shop.close(); Bill.launchNow(); } });
      else if (cur && S.state === 'build') out.push({ id: 'sp' + k, name: `${D.name} — 준비 중`, price: 0, btn: `${Math.ceil(S.left / 60)}분`, desc: D.desc, ok: () => false, fn: () => { } });
      else if (cur) out.push({ id: 'sp' + k, name: D.name, price: D.cost, btn: '진행', desc: `${D.desc} · 준비 ${D.min}분`, ok: () => Game.player.money >= D.cost && !Bill.launch, fn: () => { Bill.spaceBegin(); Shop.open('spaceport'); } });
      else out.push({ id: 'sp' + k, name: `${D.name} (잠김)`, price: D.cost, btn: '잠김', desc: D.desc, ok: () => false, fn: () => { } });
    });
    return out;
  },
};
SHOPS.tower2 = {
  title: '네온 스카이 타워 II', sub: '320m 세계 최고층 · 1분 임대 $3천만',
  items: () => [{ id: 'jump', name: '전망대 낙하산 점프', price: 1000, btn: '점프', desc: '320m 전망대에서 낙하산으로 뛰어내린다', ok: () => Game.player.money >= 1000 && !Game.player.car, fn: () => { Game.player.money -= 1000; Shop.close(); Bill.towerJump(); } }],
};
SHOPS.billion = {
  title: '억만장자', get sub() { return `억만장자 수입 1분 $${fmtB(Bill.perMin())}`; },
  items: () => {
    const P = Game.player, S = Bill.space, Tw = Bill.tower, out = [];
    out.push({ id: 'b_city', name: `도시 매입 — ${Object.keys(Bill.hoods).length}/${World.hoods.length}곳`, price: 0, btn: '열기', desc: '동네를 통째로 산다 ($6억~$80억)', ok: () => true, fn: () => Shop.open('citybuy') });
    const sd = SPACE[S.stage];
    if (S.stage === 0 && S.state === 'none') out.push({ id: 'b_space', name: '우주 계획 1단계: 우주 기지 건설', price: sd.cost, btn: '착공', desc: sd.desc + ' · 이후 단계는 우주센터에서', ok: () => P.money >= sd.cost, fn: () => { Bill.spaceBegin(); Shop.open('billion'); } });
    else out.push({ id: 'b_space', name: `우주 계획 — ${S.stage >= SPACE.length ? '화성까지 완료' : S.state === 'ready' ? `${sd.name} 발사 준비 완료` : S.state === 'build' ? `${sd.name} 준비 중 ${Math.ceil(S.left / 60)}분` : `다음: ${sd.name} ($${fmtB(sd.cost)})`}`, price: 0, btn: '위치', desc: '네온 우주센터 (레드 메사 사막)', ok: () => true, fn: () => { Game.waypoint = { x: Bill.padX, y: Bill.padY }; UI.toast('지도에 우주센터를 표시했다'); } });
    if (Tw.state === 'none') out.push({ id: 'b_tower', name: '네온 스카이 타워 II (320m 세계 최고층)', price: 2e10, btn: '착공', desc: '다운타운 에투알 광장 옆 빌딩을 헐고 다시 짓는다 · 15분 공사 · 1분 $3천만 · 전망대 낙하산', ok: () => P.money >= 2e10, fn: () => { Bill.towerBegin(); Shop.open('billion'); } });
    else out.push({ id: 'b_tower', name: `네온 스카이 타워 II — ${Tw.state === 'done' ? '완공' : `공사 ${Math.ceil(Tw.left / 60)}분`}`, price: 0, btn: '위치', desc: '다운타운', ok: () => !!Tw.lot, fn: () => { const L = Tw.lot; Game.waypoint = { x: (L.x0 + L.x1 + 1) / 2 * T, y: (L.y1 + 2) * T }; UI.toast('지도에 표시했다'); } });
    out.push(Bill.yacht ? { id: 'b_yacht', name: '초호화 요트 네온 레이디 — 부르기', price: 0, btn: '호출', desc: '가장 가까운 마리나로', ok: () => true, fn: () => { Shop.close(); Bill.callYacht(); } }
      : { id: 'b_yacht', name: '초호화 요트 네온 레이디 (34m)', price: 3e9, btn: '구입', desc: '헬리패드가 있는 떠다니는 저택 · 어느 마리나로든 부른다', ok: () => P.money >= 3e9, fn: () => { if (!Bill.pay(3e9)) return; Bill.yacht = true; Save.write(); Shop.close(); Bill.callYacht(); } });
    out.push(Bill.pmc.guards ? { id: 'b_guard', name: `경호팀 (4명) — ${Bill.guardsOn ? '동행 중' : '대기'}`, price: 0, btn: Bill.guardsOn ? '해산' : '부르기', desc: '동행 중엔 1분 유지비 $200만', ok: () => true, fn: () => { Bill.guardsOn = !Bill.guardsOn; if (Bill.guardsOn) Bill.spawnGuards(); Save.write(); Shop.open('billion'); } }
      : { id: 'b_guard', name: '사설 경호팀 고용 (4명, 소총·방탄)', price: 5e8, btn: '고용', desc: '어디든 따라다니며 적과 경찰을 막는다 · 동행 중 1분 유지비 $200만', ok: () => P.money >= 5e8, fn: () => { if (!Bill.pay(5e8)) return; Bill.pmc.guards = true; Bill.guardsOn = true; Bill.spawnGuards(); Save.write(); Shop.open('billion'); } });
    for (const [k, V] of Object.entries(PMC_VEH)) out.push(Bill.pmc[k] ? { id: 'b_' + k, name: `내 ${V.name} — 호출`, price: 0, btn: '호출', desc: '근처로 보낸다 (45초마다)', ok: () => true, fn: () => { Shop.close(); Bill.callVehicle(k); } }
      : { id: 'b_' + k, name: `사설 군대: ${V.name}`, price: V.cost, btn: '구입', desc: '사면 어디서든 부를 수 있다', ok: () => P.money >= V.cost, fn: () => { if (!Bill.pay(V.cost)) return; Bill.pmc[k] = true; Save.write(); Shop.open('billion'); } });
    return out;
  },
};
// 시청 창에 [도시 매입]
{ const _i = SHOPS.cityhall.items; SHOPS.cityhall.items = function () { const l = _i.call(this); l.unshift({ id: 'citybuy', name: '도시 매입 — 동네를 통째로 사들인다', price: 0, btn: '열기', desc: `$6억~$80억 · 지금 ${Object.keys(Bill.hoods).length}곳`, ok: () => true, fn: () => Shop.open('citybuy') }); return l; }; }

// 휴대폰: [억만장자] 앱 (홈 화면에 추가 → 누르면 억만장자 창)
{
  const _show = Phone.show.bind(Phone);
  Phone.show = function (sc) {
    if (sc === 'billion') { this.close(); Shop.open('billion'); return; }
    _show(sc);
    if (sc === 'home') { const G = this.el.querySelector('.ph-grid'); if (G) { const a = document.createElement('button'); a.className = 'ph-app'; a.innerHTML = `<div class="ph-ico" style="background:#d4af37">₩</div>억만장자`; a.onclick = () => this.show('billion'); G.append(a); } }
  };
}
// 업적
ACH.push(['landlord', '도시의 주인', '도시의 모든 동네를 샀다', () => !!Bill.titles.city], ['moon', '달의 주인', '유인 달 탐사 성공', () => Bill.space.stage >= 3], ['mars', '우주의 왕', '화성 이주선 발사', () => Bill.space.stage >= 4], ['sky2', '하늘을 찌르다', '네온 스카이 타워 II 완공', () => Bill.tower.state === 'done']);
