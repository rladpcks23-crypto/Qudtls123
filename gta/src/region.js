'use strict';
/* =====================================================================
 * region.js — 지역별 경제 (v2.19)
 *
 *  · 카운티 가게 인수: 주유소 4 · 다이너/식당/바비큐 3 · 편의점 3 · 골든 필즈 농장 · 파인 베이 수산 · 샌디 밸리 비행장
 *    (가게 창·주유소 정비 창·사무소에서 산다) → 1분마다 수입. 학교 경영 강의 보너스가 붙는다.
 *  · 지역 일거리 (여러 번 할 수 있다)
 *      골든 필즈 수확: 트랙터로 밭 갈기 → 수확물 트럭을 올드 타운 시장까지 (농장 주인이면 보수 2배)
 *      파인 베이 어업: 부두의 보트로 바다의 부표 3곳을 돌고 부두로 (수산 주인이면 2배)
 *      비행장 화물 운송: 비행장의 화물 트럭을 하버 물류창고까지, 수배 없이 (비행장 주인이면 +60%)
 *  · 지역 물가: 카운티 주유소 기름값 20% 싸다
 * ===================================================================== */

const COUNTY_BIZ = {
  c_gas1: { name: '68번 국도 주유소', price: 450000, perMin: 2600 }, c_gas2: { name: '사막 휴게소', price: 380000, perMin: 2200 },
  c_gas3: { name: '호숫가 주유소', price: 420000, perMin: 2400 }, c_gas4: { name: '해안 주유소', price: 400000, perMin: 2300 },
  c_burger1: { name: '사막 다이너', price: 300000, perMin: 1900 }, c_burger2: { name: '어부의 식당', price: 320000, perMin: 2000 }, c_burger3: { name: '레드 록 바비큐', price: 280000, perMin: 1800 },
  c_mart1: { name: '샌디 밸리 편의점', price: 250000, perMin: 1600 }, c_mart2: { name: '파인 베이 잡화점', price: 250000, perMin: 1600 }, c_mart3: { name: '골든 필즈 농협 마트', price: 260000, perMin: 1650 },
  c_farm: { name: '골든 필즈 농장', price: 1200000, perMin: 6500, desc: '수확 일 보수 2배' },
  c_fishery: { name: '파인 베이 수산', price: 900000, perMin: 5000, desc: '어업 일 보수 2배' },
  c_airfield: { name: '샌디 밸리 비행장', price: 2500000, perMin: 14000, desc: '화물 운송 보수 +60%' },
};

const Region = {
  own: {}, t: 0, placed: false,
  save() { return { own: this.own }; },
  load(o) { this.own = (o && o.own) || {}; },
  has(k) { return !!this.own[k]; },
  perMin() { const P = Game.player; return Math.round(Object.keys(this.own).reduce((a, k) => a + (COUNTY_BIZ[k] ? COUNTY_BIZ[k].perMin : 0), 0) * (1 + 0.05 * (P.eduLv || 0))); },
  buy(k) {
    const B = COUNTY_BIZ[k], P = Game.player; if (!B || this.own[k]) return;
    if (P.money < B.price) { UI.toast('돈이 모자라다'); return; }
    P.money -= B.price; this.own[k] = 1; Sfx.passed(); UI.big('인수 완료', `${B.name} — 1분 수입 $${B.perMin.toLocaleString()}${B.desc ? ' · ' + B.desc : ''}`, 3, '#7ae68f'); Save.write();
  },
  item(k) { // 가게 창 끝에 붙는 '인수' 항목
    const B = COUNTY_BIZ[k]; if (!B) return null;
    return { id: 'own_' + k, name: this.own[k] ? `${B.name} — 내 가게` : `${B.name} 인수`, price: this.own[k] ? 0 : B.price, btn: this.own[k] ? '소유' : '인수', desc: `1분 수입 $${B.perMin.toLocaleString()}${B.desc ? ' · ' + B.desc : ''}`, ok: () => !this.own[k], fn: () => { this.buy(k); Shop.close(); } };
  },
  place() {
    const W = World, C = W.county; if (this.placed || !C) return; this.placed = true;
    const gf = (C.towns || []).find(t => t.name === '골든 필즈'), farm = gf && (C.farms || []).slice().sort((a, b) => dist(a.x, a.y, gf.x, gf.y) - dist(b.x, b.y, gf.x, gf.y))[0];
    if (farm) { const s = sidewalkNear(farm.x, farm.y, 2); const [x, y] = openSpotNear(farm.x + 6, farm.y); W.places.c_farm = { x, y, label: '골든 필즈 농장 사무소', farm }; }
    const pier = (C.fish || []).find(f => f.kind === 'pier'); if (pier) { const [x, y] = openSpotNear(pier.x - 34, pier.y - 8); W.places.c_fishery = { x, y, label: '파인 베이 수산' }; }
    for (const [k, sh, ch, c, l] of [['c_farm', 'farmoffice', '농', '#c8a868', '농장 (수확 일)'], ['c_fishery', 'fishery', '어', '#4fc3ff', '수산 (어업 일)'], ['c_airfield', 'airfield', '✈', '#9aa3ad', '비행장 (화물 운송)']]) {
      if (!W.places[k]) continue; EXTRA_PLACES.push([k, sh]); EXTRA_ICONS.push({ key: k, ch, c, label: l }); PLACE_MARK[k] = c;
    }
  },
  update(dt) {
    if (!World.county) return;
    this.place();
    this.t += dt;
    if (this.t >= 60) { this.t -= 60; const n = this.perMin(); if (n > 0) { Game.player.money += n; UI.toast(`카운티 사업 수입 +$${n.toLocaleString()}`); } }
  },
};
SaveExt.mods.region = Region;

// 가게 창에 인수 항목 붙이기 (어느 가게 문으로 들어왔는지는 Shop.placeKey)
for (const sh of ['mart', 'burger']) {
  const S = SHOPS[sh]; if (!S) continue; const _items = S.items;
  S.items = function () { const l = _items.call(this); const k = Shop.placeKey; if (k && COUNTY_BIZ[k]) { const it = Region.item(k); if (it) l.push(it); } return l; };
}
{ // 주유소 정비 창: 카운티 주유소 인수 + 기름값 20% 할인
  const _items = SHOPS.fuelstop.items;
  SHOPS.fuelstop.items = function () { const l = _items.call(this); const k = Fuel.visited; if (k && COUNTY_BIZ[k]) { const it = Region.item(k); if (it) l.push(it); } return l; };
  const _pp = Fuel.pricePct.bind(Fuel);
  Fuel.pricePct = c => { const p = _pp(c); return Fuel.visited && COUNTY_BIZ[Fuel.visited] ? Math.max(2, Math.round(p * 0.8)) : p; };
}

// ---------- 지역 일거리 (의뢰 틀을 그대로 쓴다) ----------
// 새 단계: 트랙터로 밭 갈기 / 바다 부표 돌기
STEP.plow = {
  start(m, s) {
    const f = World.places.c_farm && World.places.c_farm.farm; const fx = f ? f.fx : Game.player.px, fy = f ? f.fy : Game.player.py;
    m.st.field = { x: fx, y: fy }; m.st.d = 0; m.st.last = null;
    if (!(Game.player.car && Game.player.car.type === 'tractor')) { const [x, y] = openSpotNear(fx - 10, fy); m.st.car = missionCar(m, 'tractor', x, y, 0); }
    m.blips = [{ x: fx, y: fy, c: '#c8a868', big: true }];
  },
  update(m, s, dt) {
    const P = Game.player, c = P.car, F = m.st.field;
    if (!c || c.type !== 'tractor') { Missions.obj(m, '트랙터에 타라'); if (m.st.car) m.blips = [{ ent: m.st.car, c: '#4fb3ff' }]; return; }
    m.blips = [{ x: F.x, y: F.y, c: '#c8a868', big: true }];
    const onField = dist(c.x, c.y, F.x, F.y) < 70 && [TL.SAND, TL.GRASS].includes(tileAt(c.x, c.y));
    if (onField && m.st.last) m.st.d += dist(c.x, c.y, m.st.last.x, m.st.last.y);
    m.st.last = { x: c.x, y: c.y };
    if (onField && chance(dt * 6)) Particles.smoke(c.x - Math.cos(c.a) * 2, c.y - Math.sin(c.a) * 2, 0.8, '#b89a6a');
    Missions.obj(m, onField ? `밭 갈기 ${Math.min(100, Math.round(m.st.d / s.meters * 100))}%` : `밭(갈색 표시)으로 — ${Math.round(dist(c.x, c.y, F.x, F.y))}m`);
    if (m.st.d >= s.meters) return 'next';
  },
};
STEP.buoys = {
  start(m, s) {
    const P = Game.player, pts = [];
    for (let k = 0; k < 400 && pts.length < 3; k++) { const a = rand(-1.2, 1.2), r = rand(140, 380), x = P.px + Math.cos(a) * r, y = P.py + Math.sin(a) * r; if (tileAt(x, y) === TL.WATER && tileAt(x + 12, y) === TL.WATER && tileAt(x, y + 12) === TL.WATER && !pts.some(q => dist(q.x, q.y, x, y) < 90)) pts.push({ x, y }); }
    m.st.pts = pts; m.st.k = 0;
    const ms = m; Props.providers.push(() => (Missions.active === ms && ms.st.pts) ? ms.st.pts.slice(ms.st.k).map(q => ({ x: q.x, y: q.y, w: 1.2, d: 1.2, h: 1.6, c: '#ff7a2f', glow: true })) : []);
  },
  update(m, s) {
    const P = Game.player, q = m.st.pts[m.st.k]; if (!q) return 'next';
    if (!P.car || P.car.V.special !== 'boat') { Missions.obj(m, '보트에 타라'); return; }
    m.blips = [{ x: q.x, y: q.y, c: '#ff7a2f', big: true }];
    Missions.obj(m, `그물 걷기: 부표 ${m.st.k + 1}/${m.st.pts.length} — ${Math.round(dist(P.px, P.py, q.x, q.y))}m`);
    if (dist(P.px, P.py, q.x, q.y) < 12) { m.st.k++; Sfx.pickup(); UI.toast(`고기 ${randi(20, 60)}kg을 끌어올렸다`); }
  },
};

const WORK_DEFS = {
  harvest: Object.assign(stepsDef({
    title: '골든 필즈 수확', reward: 12000,
    intro: [['농장 관리인', '밭 갈 사람이 필요했는데 잘 왔어요. 트랙터로 밭을 한 바퀴 갈고,'], ['농장 관리인', '수확물 트럭을 도시 올드 타운 시장까지 몰아다 주세요.']],
    outro: [['농장 관리인', '올해 농사는 풍년이겠네요!']],
    steps: [
      { t: 'plow', meters: 500, text: '밭 갈기' },
      { t: 'steal', type: 'truck', color: '#c8a868', at: () => { const q = World.places.c_farm; const [x, y] = openSpotNear(q.x + 8, q.y + 6); return { x, y, a: 0 }; }, text: '수확물 트럭에 타라' },
      { t: 'deliver', at: () => { const q = World.places.biz_market || World.places.mart; return sidewalkNear(q.x, q.y, 6); }, timer: 420, text: '올드 타운 시장으로 수확물을 옮겨라', r: 12, drop: true },
    ],
  }), { id: 'w_harvest', kind: 'work', owner: 'c_farm', bonusK: 1 }),
  fishing: Object.assign(stepsDef({
    title: '파인 베이 어업', reward: 9000,
    intro: [['선장 모리스', '그물을 걷으러 갈 손이 모자라. 부두의 보트로 부표 세 개를 돌고 돌아와.']],
    outro: [['선장 모리스', '오늘 저녁은 생선 파티다!']],
    steps: [
      { t: 'go', at: () => { const f = (World.county.fish || []).find(q => q.kind === 'pier'); return f ? { x: f.x, y: f.y } : Game.player; }, text: '부두 끝으로', r: 8 },
      { t: 'steal', type: 'speedboat', color: '#e8e8e8', at: () => { const mar = (World.marinas || []).find(q => q.county); return { x: mar.x, y: mar.y, a: mar.a }; }, text: '어선(보트)에 타라' },
      { t: 'buoys', text: '부표 돌기' },
      { t: 'deliver', at: () => { const mar = (World.marinas || []).find(q => q.county); return { x: mar.x - 6, y: mar.y }; }, text: '부두로 돌아가 고기를 내려라', r: 16 },
    ],
  }), { id: 'w_fishing', kind: 'work', owner: 'c_fishery', bonusK: 1 }),
  freight: Object.assign(stepsDef({
    title: '비행장 화물 운송', reward: 15000,
    intro: [['비행장 관제사', '방금 들어온 화물이야. 하버 물류창고까지, 경찰 눈에 띄지 말고.']],
    outro: [['비행장 관제사', '깔끔하군. 다음 편도 부탁해.']],
    steps: [
      { t: 'steal', type: 'truck', color: '#9aa3ad', at: () => { const q = World.places.c_airfield; const [x, y] = openSpotNear(q.x + 10, q.y); return { x, y, a: 0 }; }, text: '화물 트럭에 타라' },
      { t: 'deliver', at: () => { const q = World.places.biz_logi || World.places.wh_harbor || World.places.garage; return sidewalkNear(q.x, q.y, 6); }, timer: 480, clean: true, text: '하버 물류창고로 화물을 옮겨라', r: 12, drop: true },
    ],
  }), { id: 'w_freight', kind: 'work', owner: 'c_airfield', bonusK: 0.6 }),
};
for (const d of Object.values(WORK_DEFS)) { const _s = d.start; d.start = m => { m.bonus = Region.has(d.owner) ? Math.round(d.reward * d.bonusK) : 0; _s(m); }; }

const workShop = (k, title, sub, work) => ({
  title, get sub() { return `${sub}${Region.has(k) ? ' · 내 사업장' : ''}`; },
  items: () => [
    { id: 'work', name: `일하기: ${WORK_DEFS[work].title}`, price: 0, btn: '시작', desc: `보수 $${WORK_DEFS[work].reward.toLocaleString()}${Region.has(k) ? ` + 주인 보너스 $${Math.round(WORK_DEFS[work].reward * WORK_DEFS[work].bonusK).toLocaleString()}` : ''} · 여러 번 할 수 있다`, ok: () => !Missions.active, fn: () => { Shop.close(); Missions.startSide(WORK_DEFS[work]); } },
    Region.item(k),
  ].filter(Boolean),
});
SHOPS.farmoffice = workShop('c_farm', '골든 필즈 농장', '트랙터로 밭을 갈고 수확물을 도시로', 'harvest');
SHOPS.fishery = workShop('c_fishery', '파인 베이 수산', '보트로 그물을 걷고 부두로', 'fishing');
SHOPS.airfield = workShop('c_airfield', '샌디 밸리 비행장', '화물을 도시 물류창고로', 'freight');
