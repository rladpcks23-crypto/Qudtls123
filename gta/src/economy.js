'use strict';
/* =====================================================================
 * economy.js — 가방(들고 다니는 음식·약), 체력 유지제, 차량 매매상 「네온 모터스」
 *
 *  · 음식·약은 체력이 가득해도 살 수 있고, 그럴 땐 가방에 넣어 둔다 (최대 10개).
 *    PC는 B, 모바일은 [가방] 버튼 — 지금 가장 필요한 것을 알아서 꺼내 쓴다.
 *  · 체력 유지제: 90초 동안 체력이 계속 차오르고 달리기 체력이 줄지 않는다.
 *  · 네온 모터스(D): 타고 온 차를 팔거나(훔친 차는 싸게, 산 차는 60%) 새 차·전차·헬기·전투기를 산다.
 * ===================================================================== */

const CONSUMABLES = {
  burger: { name: '치즈 버거', hp: 25 }, set: { name: '더블 버거 세트', hp: 60, stam: 1 }, fries: { name: '감자튀김', hp: 10 },
  cola: { name: '콜라', stam: 1 }, onigiri: { name: '삼각김밥', hp: 12 }, ramen: { name: '컵라면', hp: 20 },
  energy: { name: '에너지 드링크', stam: 1, boost: 60 }, medkit: { name: '구급상자', hp: 100 },
  vital: { name: '체력 유지제', vital: 90 },
  bandage: { name: '붕대', hp: 35 }, painkiller: { name: '진통제', guard: 60 },
};

const Bag = {
  MAX: 10,
  count() { const b = Game.player.bag || {}; let n = 0; for (const k in b) n += b[k]; return n; },
  add(id) {
    const P = Game.player; P.bag = P.bag || {};
    if (this.count() >= this.MAX) { UI.toast('가방이 가득 찼다 (10개)'); return false; }
    P.bag[id] = (P.bag[id] || 0) + 1; return true;
  },
  // 효과 적용 (먹기)
  apply(id) {
    const P = Game.player, it = CONSUMABLES[id]; if (!it) return;
    if (it.hp) P.hp = Math.min(P.maxHp, P.hp + it.hp);
    if (it.stam) { P.stamina = 1; P.exhausted = false; }
    if (it.boost) P.boostT = it.boost;
    if (it.vital) P.vitalT = it.vital;
    if (it.guard) P.guardT = it.guard;
    Sfx.tone({ f0: 520, f1: 780, dur: 0.12, type: 'triangle', vol: 0.18 });
  },
  use(id) {
    const P = Game.player; if (!P.bag || !(P.bag[id] > 0)) return false;
    P.bag[id]--; if (!P.bag[id]) delete P.bag[id];
    this.apply(id); UI.toast(`${CONSUMABLES[id].name} 사용 (가방 ${this.count()}개 남음)`);
    return true;
  },
  // 지금 가장 필요한 것: 체력 → 낭비가 적은 음식부터, 지쳤으면 음료, 아니면 체력 유지제
  useBest() {
    const P = Game.player, b = P.bag || {};
    if (P.dead) return;
    const have = Object.keys(b).filter(k => b[k] > 0);
    if (!have.length) { UI.toast('가방이 비었다 — 버거 샷·편의점에서 사 두자'); return; }
    const miss = P.maxHp - P.hp;
    if (miss > 1) {
      const heals = have.filter(k => CONSUMABLES[k].hp).sort((a, c) => CONSUMABLES[a].hp - CONSUMABLES[c].hp);
      const fit = heals.find(k => CONSUMABLES[k].hp >= miss) || heals[heals.length - 1];
      if (fit) { this.use(fit); return; }
      if (b.vital) { this.use('vital'); return; }
    }
    if (P.stamina < 0.6 || P.exhausted) { const d = have.find(k => CONSUMABLES[k].stam); if (d) { this.use(d); return; } }
    if (b.vital && !(P.vitalT > 0)) { this.use('vital'); return; }
    UI.toast('지금은 먹을 필요가 없다');
  },
  // 가방 열기: 게임이 잠시 멈추고, 원하는 물건을 골라 바로 쓴다 (언제 어디서나 · 운전 중에도)
  DESC: { burger: '체력 +25', set: '체력 +60 · 달리기 가득', fries: '체력 +10', cola: '달리기 가득', onigiri: '체력 +12', ramen: '체력 +20', energy: '60초 지치지 않음', medkit: '체력 완전 회복', vital: '90초 체력 계속 회복', bandage: '체력 +35', painkiller: '60초 받는 피해 -40%' },
  open() {
    const P = Game.player;
    if (P.dead || (Game.state !== 'play' && Game.state !== 'bag')) return;
    if (Game.state === 'bag') { this.close(); return; }
    Game.state = 'bag'; this.el = document.getElementById('bagui'); this.el.hidden = false;
    this.render();
  },
  close() { if (this.el) this.el.hidden = true; if (Game.state === 'bag') Game.state = 'play'; },
  render() {
    const P = Game.player, b = P.bag || {}, L = document.getElementById('bag-list');
    document.getElementById('bag-stat').textContent = `체력 ${Math.round(P.hp)}/${P.maxHp} · 달리기 ${Math.round(P.stamina * 100)}% · ${this.count()}/${this.MAX}개${P.vitalT > 0 ? ` · 체력 유지 ${Math.ceil(P.vitalT)}초` : ''}`;
    L.innerHTML = '';
    const ids = Object.keys(b).filter(k => b[k] > 0);
    if (!ids.length) L.innerHTML = '<div class="cz-note">비어 있다 — 버거 샷·편의점·약국에서 [가방에]로 사 두자</div>';
    for (const id of ids) {
      const row = document.createElement('div'); row.className = 'bag-it';
      const cv = document.createElement('canvas'); cv.width = 44; cv.height = 34; const g = cv.getContext('2d'); g.translate(22, 17); drawItemIcon(g, id, 22);
      const info = document.createElement('div'); info.innerHTML = `${CONSUMABLES[id].name} ×${b[id]}<span>${this.DESC[id] || ''}</span>`;
      const btn = document.createElement('button'); btn.className = 'btn small'; btn.textContent = '사용';
      btn.onclick = () => { this.use(id); this.render(); };
      row.append(cv, info, btn); L.append(row);
    }
  },
  update(dt) {
    const P = Game.player;
    if (P.guardT > 0) P.guardT -= dt;
    if (P.vitalT > 0 && !P.dead) {
      P.vitalT -= dt;
      P.hp = Math.min(P.maxHp, P.hp + 6 * dt);
      P.stamina = Math.min(1, P.stamina + dt * 0.5); P.exhausted = false;
    }
  },
};

// ---------- 차량 매매상 ----------
const VEHICLE_PRICES = { compact: 3000, sedan: 5000, bike: 4500, van: 6000, muscle: 9000, truck: 12000, sports: 18000, super: 42000, hyper: 450000, taxi: 5000, police: 15000, swat: 30000, ambulance: 12000, armored: 60000, bus: 25000, tank: 180000, airliner: 900000, milheli: 150000, jet: 220000 };
const DEALER_STOCK = ['compact', 'sedan', 'bike', 'van', 'muscle', 'sports', 'super', 'hyper', 'truck', 'armored', 'jetski', 'speedboat', 'tank', 'milheli', 'jet'];
Object.assign(VEHICLE_PRICES, { jetski: 7000, speedboat: 26000 });

const Dealer = {
  sellable(c) {
    if (!c || c.dead || c.burnT > 0) return '망가진 차는 받지 않는다';
    if (c.mission || (Jobs.active && Jobs.active.car === c)) return '미션·업무 차량은 팔 수 없다';
    if (!c.owned && Wanted.stars > 0) return '수배 중인 훔친 차는 받지 않는다';
    return null;
  },
  price(c) {
    const base = VEHICLE_PRICES[c.type] || 3000, hpK = 0.3 + 0.7 * clamp(c.hp / c.maxHp, 0, 1);
    const hot = ['police', 'swat', 'ambulance', 'taxi'].includes(c.type), mil = ['tank', 'milheli', 'jet'].includes(c.type);
    const f = c.owned ? 0.6 : hot ? 0.15 : mil ? 0.2 : 0.35;
    return Math.round(base * f * hpK / 10) * 10;
  },
  sell() {
    const P = Game.player, c = P.car;
    const why = this.sellable(c); if (why) { UI.toast(why); return; }
    const amt = this.price(c);
    exitCar(P, true); c.remove = true; Fleet.drop(c);
    P.money += amt; Sfx.cash(); UI.toast(`${c.label || c.V.name} 판매 +$${amt.toLocaleString()}`); Save.write();
    for (const sp of World.parking) if (sp.car === c) { sp.car = null; sp.cd = 60; }
  },
  // 차량을 내어 준다: 헬기는 마당, 전투기는 가까운 긴 직선 도로 시작점, 나머지는 앞 도로
  deliver(type, D = World.places.dealer, color) {
    const P = Game.player;
    let x, y, a;
    if (type === 'milheli') { x = D.x; y = D.y; a = 0; }
    else if (VTYPES[type].special === 'boat') { // 보트는 가장 가까운 마리나로
      const m = (World.marinas || []).slice().sort((p, q) => dist(p.x, p.y, D.x, D.y) - dist(q.x, q.y, D.x, D.y))[0];
      x = m.x + rand(-3, 3); y = m.y + rand(-3, 3); a = m.a;
    }
    else if (type === 'jet') {
      let best = null, bd = 1e18;
      for (const e of World.edgesList) {
        const A = World.nodes[e[0]], B = World.nodes[e[1]], L = dist(A.x, A.y, B.x, B.y);
        if (L < 55) continue;
        const d = dist(A.x, A.y, D.x, D.y); if (d < bd) { bd = d; best = e; }
      }
      const sp = best ? laneSpot(best, true, 12) : roadsideSpot(D.x, D.y, 8, 40); x = sp.x; y = sp.y; a = sp.a;
    } else { const sp = roadsideSpot(D.x, D.y, 6, 40); x = sp.x; y = sp.y; a = sp.a; }
    for (const q of Game.cars) if (q !== P.car && !q.persistent && dist2(q.x, q.y, x, y) < 100) q.remove = true;
    const c = new Car(type, x, y, a, { persistent: true, color });
    c.owned = true; c.alt = 0; c.label = `내 ${c.V.name}`;
    Game.cars.push(c); Game.waypoint = { x, y };
    return c;
  },
  cost(type) { const sp = VTYPES[type].special; return Math.round(VEHICLE_PRICES[type] * (sp === 'boat' && Biz.has('biz_surf') ? 0.5 : 1) * (sp && sp !== 'boat' && Finance.law('mil') ? 0.7 : 1)); },
  buy(type) {
    const P = Game.player, price = this.cost(type);
    if (P.money < price) return;
    P.money -= price; Sfx.cash();
    const c = this.deliver(type); Fleet.add(c);
    Save.write();
    UI.toast(`${VTYPES[type].name} 구매! ${type === 'jet' ? '근처 긴 직선 도로에서 이륙할 수 있다' : type === 'milheli' ? '매장 마당에 헬기가 있다' : VTYPES[type].special === 'boat' ? '가장 가까운 마리나에 띄워 뒀다' : '매장 앞에 세워 뒀다'} (지도에 웨이포인트)`);
  },
};

SHOPS.dealer = {
  title: '네온 모터스', sub: '중고차 매입 · 신차 · 군용 장비 (군 불하품)',
  items: () => {
    const P = Game.player, c = P.car, out = [];
    if (c) {
      const why = Dealer.sellable(c);
      out.push({ id: 'sell', veh: c.type, name: `타고 온 ${c.label || c.V.name} 팔기`, price: 0, sellPrice: why ? 0 : Dealer.price(c), desc: why || (c.owned ? '내가 산 차 — 구입가의 60%' : '훔친 차 — 싸게 매입, 차 상태에 따라 값이 다르다'), ok: () => !why, fn: () => { Dealer.sell(); Shop.close(); } });
    }
    for (const t of DEALER_STOCK) out.push({ id: 'veh_' + t, veh: t, name: VTYPES[t].name, price: Dealer.cost(t), desc: VTYPES[t].special === 'boat' ? `보트 — 최고 ${Math.round(VTYPES[t].vmax * 3.6)}km/h, 가까운 마리나로 배달` : t === 'tank' ? '라이노 전차 — 주포·기관총' : t === 'milheli' ? '헌터 공격 헬기 — 기관포·로켓·유도미사일' : t === 'jet' ? '라저 전투기 — 기관포·유도미사일·로켓' : `최고 ${Math.round(VTYPES[t].vmax * 3.6)}km/h · 내구 ${VTYPES[t].hp}`, fn: () => { Dealer.buy(t); Shop.close(); } });
    return out;
  },
};

// ---------- 내 차고: 산 차량·보관한 차를 저장하고 꺼낸다. 부서지면 보험으로 복구 ----------
const Fleet = {
  MAX: 12,
  list() { return Game.fleet || (Game.fleet = []); },
  add(c, color) {
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: c.type, color: color || c.color, wrecked: false };
    this.list().push(e); c.fleetId = e.id; c.owned = true; c.persistent = true; c.label = `내 ${c.V.name}`;
    return e;
  },
  drop(c) { if (c.fleetId) Game.fleet = this.list().filter(e => e.id !== c.fleetId); c.fleetId = null; },
  carOf(e) { return Game.cars.find(c => c.fleetId === e.id && !c.dead && c.burnT <= 0); },
  // 부서진 내 차량은 '폐차' 표시 → 차고에서 보험 수리
  update() {
    for (const c of Game.cars) if (c.fleetId && (c.dead || c.burnT > 0)) {
      const e = this.list().find(q => q.id === c.fleetId); if (e && !e.wrecked) { e.wrecked = true; UI.toast(`내 ${c.V.name}이(가) 부서졌다 — 내 차고에서 보험으로 복구할 수 있다`); }
      c.fleetId = null;
    }
  },
  store() {
    const P = Game.player, c = P.car; if (!c) return;
    if (c.mission || (Jobs.active && Jobs.active.car === c)) { UI.toast('미션·업무 차량은 보관할 수 없다'); return; }
    if (!c.fleetId) { if (this.list().length >= this.MAX) { UI.toast(`차고가 가득 찼다 (${this.MAX}대)`); return; } this.add(c); }
    exitCar(P, true); c.remove = true;
    UI.toast(`${c.V.name} 보관 — 저장됐다`); Save.write();
  },
  takeOut(e) {
    if (this.carOf(e)) { const c = this.carOf(e); Game.waypoint = { x: c.x, y: c.y }; UI.toast('이미 밖에 있다 — 지도에 위치 표시'); return; }
    const c = Dealer.deliver(e.type, World.places.mygarage, e.color); c.fleetId = e.id; e.wrecked = false;
    UI.toast(`${c.V.name}을(를) 꺼냈다`);
  },
  insurance(e) { return Math.round((VEHICLE_PRICES[e.type] || 3000) * 0.08 * (Biz.has('biz_auto') ? 0.5 : 1) / 10) * 10; },
};
SHOPS.mygarage = {
  title: '내 차고', sub: '산 차량과 보관한 차는 저장된다 · 부서진 차는 보험으로 복구',
  items: () => {
    const P = Game.player, out = [];
    if (P.car) out.push({ id: 'store', veh: P.car.type, name: `타고 온 ${P.car.V.name} 보관`, price: 0, desc: P.car.fleetId ? '내 차 — 차고에 넣는다' : '이 차를 내 차로 등록해 보관한다', ok: () => true, fn: () => { Fleet.store(); Shop.close(); } });
    for (const e of Fleet.list()) {
      const out_ = Fleet.carOf(e), ins = Fleet.insurance(e);
      out.push({ id: 'fleet_' + e.id, veh: e.type, name: `${VTYPES[e.type].name}${e.wrecked ? ' (폐차)' : out_ ? ' (밖에 있음)' : ''}`, price: e.wrecked ? ins : 0,
        desc: e.wrecked ? `보험 수리 $${ins.toLocaleString()} 후 꺼내기` : out_ ? '지도에 위치 표시' : '꺼내기',
        ok: () => true, fn: () => { if (e.wrecked) { if (P.money < ins) return; P.money -= ins; Sfx.cash(); } Fleet.takeOut(e); Shop.close(); Save.write(); } });
    }
    if (!out.length) out.push({ id: 'none', name: '비어 있다', price: 0, desc: '네온 모터스에서 차를 사거나, 아무 차나 몰고 와서 보관하자', ok: () => false });
    return out;
  },
};

// ---------- 사업체: 사 두면 1분마다 수입이 바로 들어온다. 5단계까지 업그레이드 ----------
const BUSINESSES = {
  biz_wash: { name: '스파클 세차장', price: 150000, perMin: 900, desc: '작지만 꾸준한 현금 장사' },
  biz_bar: { name: '선셋 비치 바', price: 250000, perMin: 1500, desc: '해변 손님이 끊이지 않는다' },
  biz_burger: { name: '버거 샷 가맹점', price: 400000, perMin: 2400, desc: '버거 샷 음식 반값' },
  biz_surf: { name: '서핑·보트 대여점', price: 550000, perMin: 3300, desc: '네온 모터스 보트 반값' },
  biz_taxi: { name: '하버 택시 회사', price: 700000, perMin: 4200, desc: '택시 기사 일 보수 +25%' },
  biz_club: { name: '네온 나이트클럽', price: 1200000, perMin: 7200, desc: '다운타운의 밤을 책임지는 클럽' },
  biz_logi: { name: '하버 물류창고', price: 1600000, perMin: 9600, desc: '밀수 운반 보수 +25%' },
  biz_hotel: { name: '스카이라인 호텔', price: 2500000, perMin: 15000, desc: '호텔에서 쉬면 체력·방탄복 가득(은신처처럼 저장)' },
  biz_factory: { name: '아이언 밸리 제철소', price: 3200000, perMin: 19000, desc: '가장 많이 버는 일반 사업체' },
  biz_mart: { name: '24 편의점 본사', price: 300000, perMin: 1800, desc: '편의점·약국 물건 반값' },
  biz_gymchain: { name: '파워 피트니스 본사', price: 450000, perMin: 2700, desc: '체육관 훈련 무료' },
  biz_auto: { name: '네온 정비소', price: 650000, perMin: 3900, desc: '페인트샵 무료 · 내 차고 보험 수리 반값' },
  biz_cinema: { name: '네온 시네마', price: 900000, perMin: 5400, desc: '다운타운 문화의 중심' },
  biz_marina: { name: '마리나 요트 클럽', price: 1400000, perMin: 8400, desc: '바다 사업의 큰손' },
  biz_tower: { name: '네온 방송국', price: 4000000, perMin: 24000, desc: '도시 전체에 광고 — 모든 사업체 수입 +10%' },
  biz_cafe: { name: '카페 파리지앵', price: 200000, perMin: 1200, desc: '에투알 광장 옆 노천카페' },
  biz_bakery: { name: '불랑제리 네온', price: 180000, perMin: 1100, desc: '아침마다 줄 서는 빵집' },
  biz_bistro: { name: '비스트로 에투알', price: 350000, perMin: 2100, desc: '광장이 보이는 레스토랑' },
  biz_gas1: { name: '네온 주유소 노스', price: 280000, perMin: 1700, desc: '북쪽 길목의 주유소' },
  biz_gas2: { name: '네온 주유소 사우스', price: 280000, perMin: 1700, desc: '남쪽 길목의 주유소' },
  biz_market: { name: '올드 타운 시장', price: 500000, perMin: 3000, desc: '없는 게 없는 재래시장' },
  biz_brewery: { name: '러스트 양조장', price: 600000, perMin: 3600, desc: '도시 맥주의 절반을 만든다' },
  biz_spa: { name: '레이크뷰 스파', price: 700000, perMin: 4200, desc: '호숫가 온천' },
  biz_gallery: { name: '루미에르 미술관', price: 800000, perMin: 4800, desc: '관광객이 몰리는 미술관' },
  biz_golf: { name: '파인 크레스트 골프 클럽', price: 1100000, perMin: 6600, desc: '부자들의 사교장' },
  biz_pharma: { name: '로즈우드 제약', price: 1800000, perMin: 10800, desc: '약국 물건이 끊기지 않는다' },
  biz_mall: { name: '하버 쇼핑몰', price: 2000000, perMin: 12000, desc: '주말마다 붐비는 쇼핑몰' },
  biz_dept: { name: '갤러리 네온 백화점', price: 2200000, perMin: 13200, desc: '명품관이 들어선 백화점' },
  biz_arena: { name: '네온 아레나', price: 2800000, perMin: 16800, desc: '경기와 콘서트가 열리는 경기장 (랜드마크)' },
  biz_opera: { name: '네온 오페라 하우스', price: 3000000, perMin: 18000, desc: '돔 지붕의 오페라 극장 (랜드마크)' },
  biz_towerview: { name: '네온 타워 전망대', price: 3500000, perMin: 21000, desc: '센트럴 파크의 140m 철탑 (랜드마크)' },
  biz_airhotel: { name: '에어포트 호텔', price: 1300000, perMin: 7800, desc: '공항 옆 호텔 — 환승객이 끊이지 않는다' },
  biz_airport: { name: '네온 국제공항 면세·항공', price: 6000000, perMin: 36000, desc: '섬 최대의 사업 — 공항 주인은 여객기를 공짜로 몬다' },
  biz_casino: { name: '다이아몬드 카지노', price: 5000000, perMin: 30000, desc: '베팅 한도 10배 · 카지노에서 잃은 돈의 20% 환급' },
};
const BIZ_MULT = [1, 1.5, 2.2, 3.1, 4.3];       // 단계별 수입 배율
const BIZ_UPG = [0.35, 0.6, 1.0, 1.6];          // 다음 단계 업그레이드 비용 = 구입가 × 이 값
const BIZ_UPG_NAME = ['리모델링', '확장 공사', '프리미엄 브랜딩', '플래그십 단계'];
const Biz = {
  t: 0,
  owned() { return Game.props || (Game.props = {}); },
  lv(k) { const o = this.owned()[k]; return o ? o.lv || 1 : 0; },
  perMin(k) { const B = BUSINESSES[k], L = this.lv(k); return L ? Math.round(B.perMin * BIZ_MULT[L - 1] * (this.has('biz_tower') && k !== 'biz_tower' ? 1.1 : 1) * (Finance.law('biztax') ? 1.2 : 1) * (1 + 0.05 * (Game.player.eduLv || 0))) : 0; },
  total() { return Object.keys(this.owned()).reduce((a, k) => a + (BUSINESSES[k] ? this.perMin(k) : 0), 0); },
  // 실제 플레이 1분마다 소유한 사업체 수입이 바로 입금된다
  update(dt) {
    const O = this.owned();
    for (const k in O) if (O[k].safe) { Game.player.money += Math.floor(O[k].safe); O[k].safe = 0; } // 예전 저장(금고) 정산
    if (!Object.keys(O).length) { this.t = 0; return; }
    this.t += dt;
    if (this.t >= 60) {
      this.t -= 60;
      const amt = this.total(); if (amt <= 0) return;
      Game.player.money += amt; Sfx.cash();
      UI.toast(`사업 수입 +$${amt.toLocaleString()} (${Object.keys(O).length}곳)`);
    }
  },
  buy(k) {
    const B = BUSINESSES[k], P = Game.player;
    if (this.owned()[k] || P.money < B.price) return;
    P.money -= B.price; this.owned()[k] = { lv: 1 }; Sfx.passed();
    UI.big('사업체 인수!', `${B.name} — 1분마다 $${this.perMin(k).toLocaleString()}`, 3, '#ffd166'); Save.write();
  },
  upgradeCost(k) { const L = this.lv(k); return L && L < 5 ? Math.round(BUSINESSES[k].price * BIZ_UPG[L - 1]) : 0; },
  upgrade(k) {
    const P = Game.player, c = this.upgradeCost(k);
    if (!c || P.money < c) return;
    P.money -= c; this.owned()[k].lv++; Sfx.passed();
    UI.big(`${BUSINESSES[k].name} ${this.lv(k)}단계`, `1분마다 $${this.perMin(k).toLocaleString()}`, 2.6, '#ffd166'); Save.write();
  },
  has(k) { return !!this.owned()[k]; },
};
for (const [k, B] of Object.entries(BUSINESSES)) {
  PLACE_MARK[k] = k === 'biz_casino' ? '#ff5d8f' : '#ffd166';
  SHOPS[k] = {
    title: B.name, sub: B.desc,
    items: () => {
      const L = Biz.lv(k), out = [];
      if (k === 'biz_casino') out.push({ id: 'casino_play', name: '카지노 입장 — 룰렛 · 슬롯머신 · 블랙잭', price: 0, btn: '입장', desc: `베팅 한도 $${Casino.limit().toLocaleString()}${L ? ' (소유주 VIP)' : ''}`, ok: () => true, fn: () => { Shop.close(); Casino.open(); } });
      if (!L) out.push({ id: 'buybiz', name: `${B.name} 인수`, price: B.price, desc: `1분마다 $${B.perMin.toLocaleString()} · 5단계까지 업그레이드 (최대 ×${BIZ_MULT[4]})`, ok: () => true, fn: () => { Biz.buy(k); Shop.close(); } });
      else {
        const c = Biz.upgradeCost(k);
        out.push({ id: 'bizinfo', name: `소유 중 · ${L}단계 · 1분마다 $${Biz.perMin(k).toLocaleString()}`, price: 0, desc: `${'★'.repeat(L)}${'☆'.repeat(5 - L)} · 내 사업체 ${Object.keys(Biz.owned()).length}곳, 합계 1분 $${Biz.total().toLocaleString()}`, ok: () => false });
        if (c) out.push({ id: 'bizup', name: `${BIZ_UPG_NAME[L - 1]} → ${L + 1}단계`, price: c, desc: `1분 수입 $${Biz.perMin(k).toLocaleString()} → $${Math.round(B.perMin * BIZ_MULT[L]).toLocaleString()}`, ok: () => true, fn: () => { Biz.upgrade(k); Shop.open(k); } });
        if (k === 'biz_hotel') out.push({ id: 'rest', name: '스위트룸에서 쉬기', price: 0, btn: '쉬기', desc: '체력·방탄복 가득, 저장', ok: () => Wanted.stars === 0, fn: () => { const P = Game.player; P.hp = P.maxHp; P.armor = 100; Game.clock = (Game.clock + 240) % 1440; Save.write(); Shop.close(); UI.big('저장 완료', '호텔 스위트룸에서 푹 쉬었다', 2.4, '#9be15d'); } });
      }
      return out;
    },
  };
}

// 가게 목록 아이콘: 차종 실루엣
function drawVehIcon(g, type) {
  const V = VTYPES[type], sp = V.special, col = V.colors[0];
  g.save();
  if (sp === 'milheli') { g.fillStyle = col; g.beginPath(); g.ellipse(-2, 0, 11, 5, 0, 0, TAU); g.fill(); g.fillRect(-26, -1.5, 18, 3); g.strokeStyle = '#222'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-18, -14); g.lineTo(14, 14); g.moveTo(-18, 14); g.lineTo(14, -14); g.stroke(); }
  else if (sp === 'jet') { g.fillStyle = col; g.beginPath(); g.moveTo(26, 0); g.lineTo(-20, -3); g.lineTo(-24, 0); g.lineTo(-20, 3); g.closePath(); g.fill(); g.beginPath(); g.moveTo(4, 0); g.lineTo(-10, -16); g.lineTo(-14, -16); g.lineTo(-8, 0); g.lineTo(-14, 16); g.lineTo(-10, 16); g.closePath(); g.fill(); }
  else if (sp === 'tank') { g.fillStyle = '#15171a'; g.fillRect(-22, -12, 44, 5); g.fillRect(-22, 7, 44, 5); g.fillStyle = col; g.fillRect(-20, -8, 40, 16); g.beginPath(); g.arc(-2, 0, 7, 0, TAU); g.fill(); g.fillRect(2, -1.5, 22, 3); }
  else { const l = Math.min(44, V.L * 6.5), w = Math.min(18, V.W * 6.5); g.fillStyle = col; roundRect(g, -l / 2, -w / 2, l, w, 3); g.fill(); g.fillStyle = '#1b2735'; g.fillRect(-l * 0.05, -w / 2 + 2, l * 0.28, w - 4); }
  g.restore();
}
