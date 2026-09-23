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
  update(dt) {
    const P = Game.player;
    if (P.vitalT > 0 && !P.dead) {
      P.vitalT -= dt;
      P.hp = Math.min(P.maxHp, P.hp + 6 * dt);
      P.stamina = Math.min(1, P.stamina + dt * 0.5); P.exhausted = false;
    }
  },
};

// ---------- 차량 매매상 ----------
const VEHICLE_PRICES = { compact: 3000, sedan: 5000, bike: 4500, van: 6000, muscle: 9000, truck: 12000, sports: 18000, super: 42000, taxi: 5000, police: 15000, swat: 30000, ambulance: 12000, armored: 60000, bus: 25000, tank: 180000, milheli: 150000, jet: 220000 };
const DEALER_STOCK = ['compact', 'sedan', 'bike', 'van', 'muscle', 'sports', 'super', 'truck', 'armored', 'tank', 'milheli', 'jet'];

const Dealer = {
  sellable(c) {
    if (!c || c.dead || c.burnT > 0) return '망가진 차는 받지 않는다';
    if (c.mission || (Jobs.active && Jobs.active.car === c)) return '미션·업무 차량은 팔 수 없다';
    if (!c.owned && Wanted.stars > 0) return '수배 중인 훔친 차는 받지 않는다';
    return null;
  },
  price(c) {
    const base = VEHICLE_PRICES[c.type] || 3000, hpK = 0.3 + 0.7 * clamp(c.hp / c.maxHp, 0, 1);
    const hot = ['police', 'swat', 'ambulance', 'taxi'].includes(c.type), mil = !!c.V.special;
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
  buy(type) {
    const P = Game.player, price = VEHICLE_PRICES[type];
    if (P.money < price) return;
    P.money -= price; Sfx.cash();
    const c = this.deliver(type); Fleet.add(c);
    Save.write();
    UI.toast(`${VTYPES[type].name} 구매! ${type === 'jet' ? '근처 긴 직선 도로에서 이륙할 수 있다' : type === 'milheli' ? '매장 마당에 헬기가 있다' : '매장 앞에 세워 뒀다'} (지도에 웨이포인트)`);
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
    for (const t of DEALER_STOCK) out.push({ id: 'veh_' + t, veh: t, name: VTYPES[t].name, price: VEHICLE_PRICES[t], desc: t === 'tank' ? '라이노 전차 — 주포·기관총' : t === 'milheli' ? '헌터 공격 헬기 — 기관포·로켓·유도미사일' : t === 'jet' ? '라저 전투기 — 기관포·유도미사일·로켓' : `최고 ${Math.round(VTYPES[t].vmax * 3.6)}km/h · 내구 ${VTYPES[t].hp}`, fn: () => { Dealer.buy(t); Shop.close(); } });
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
  insurance(e) { return Math.round((VEHICLE_PRICES[e.type] || 3000) * 0.08 / 10) * 10; },
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
        ok: () => true, fn: () => { Fleet.takeOut(e); Shop.close(); Save.write(); } });
    }
    if (!out.length) out.push({ id: 'none', name: '비어 있다', price: 0, desc: '네온 모터스에서 차를 사거나, 아무 차나 몰고 와서 보관하자', ok: () => false });
    return out;
  },
};

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
