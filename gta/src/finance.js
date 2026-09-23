'use strict';
/* =====================================================================
 * finance.js — 큰돈 버는 방법: 주식 · 부동산 임대 · 무역/밀수 창고 · 대형 강도(헤이스트) · 중앙은행 · 국회 로비
 *
 *  장소(world.js): stock 증권거래소 · realty 부동산 · wh_harbor/wh_iron/wh_north 창고 · heist 작전실 ·
 *                  cbank 중앙은행 · assembly 국회의사당. 모두 FinUI 패널(#finui)로 연다.
 *  Finance.update(dt)는 main.js에서 매 프레임 호출. 저장은 Finance.save() → Save.write의 finance.
 *  법(LAWS)은 다른 파일에서 Finance.law('id')로 확인한다 (사업세·총기·군 장비 등).
 * ===================================================================== */

const COMPANIES = [
  { id: 'NHT', name: '네온 하버 테크', p: 180, vol: 0.022, biz: 'biz_tower' },
  { id: 'HBL', name: '하버 물류', p: 64, vol: 0.018, biz: 'biz_logi' },
  { id: 'SSR', name: '선셋 리조트', p: 92, vol: 0.02, biz: 'biz_hotel' },
  { id: 'IVS', name: '아이언 밸리 제철', p: 41, vol: 0.016, biz: 'biz_factory' },
  { id: 'NMB', name: '네온 모터스', p: 128, vol: 0.024, biz: 'biz_auto' },
  { id: 'DMC', name: '다이아몬드 카지노', p: 240, vol: 0.03, biz: 'biz_casino' },
];
const NEWS = [
  ['신제품 발표로 기대감', 0.12], ['분기 실적 어닝 서프라이즈', 0.18], ['대형 계약 수주', 0.1], ['외국 투자 유치', 0.08],
  ['CEO 횡령 의혹', -0.16], ['공장 화재', -0.12], ['실적 부진', -0.1], ['규제 당국 조사 착수', -0.14],
];
const ESTATES = [
  { id: 'e_hills', name: '웨스트 힐즈 단독주택', price: 60000, rent: 300 },
  { id: 'e_studio', name: '노스 게이트 원룸 건물', price: 120000, rent: 650 },
  { id: 'e_shops', name: '하버 포인트 상가', price: 150000, rent: 800 },
  { id: 'e_apt', name: '미드타운 아파트 10세대', price: 220000, rent: 1200 },
  { id: 'e_condo', name: '코랄 베이 해변 콘도', price: 350000, rent: 2000 },
  { id: 'e_office', name: '다운타운 오피스 한 층', price: 600000, rent: 3500 },
  { id: 'e_villa', name: '레이크뷰 빌라 단지', price: 900000, rent: 5500 },
  { id: 'e_pent', name: '스카이라인 펜트하우스', price: 2500000, rent: 16000 },
];
const WAREHOUSES = { wh_harbor: { name: '하버 창고', price: 120000 }, wh_iron: { name: '밸리 창고', price: 90000 }, wh_north: { name: '노스 창고', price: 150000 } };
const WH_CAP = 60;
const LAWS = {
  biztax: { name: '사업세 인하법', cost: 150000, desc: '사업체 수입 +20%' },
  rent: { name: '임대료 상한 폐지법', cost: 120000, desc: '임대 수입 +30%' },
  gun: { name: '총기 규제 완화법', cost: 80000, desc: '총포상 가격 -30%' },
  harbor: { name: '항만 규제 완화법', cost: 200000, desc: '창고 단속 확률 절반, 화물 판매가 +15%' },
  police: { name: '치안 예산 삭감법', cost: 250000, desc: '경찰을 따돌리기 쉬워진다' },
  mil: { name: '군 장비 민간 판매법', cost: 300000, desc: '전차·헬기·전투기 가격 -30%' },
};
const HEISTS = {
  casino: { name: '다이아몬드 카지노 금고', target: 'biz_casino', payout: 1500000, stars: 4, hold: 20, guards: 8,
    preps: [{ t: 'pay', name: '드릴 장비 구입', cost: 60000 }, { t: 'fetch', name: '경비 교대표 훔치기', guards: 4 }, { t: 'steal', name: '탈출용 슈퍼카 확보', veh: 'super' }] },
  cbank: { name: '중앙은행 금고', target: 'cbank', payout: 3000000, stars: 5, hold: 30, guards: 12,
    preps: [{ t: 'pay', name: '해커 고용', cost: 150000 }, { t: 'fetch', name: '금고 설계도 탈취', guards: 6 }, { t: 'steal', name: '현금수송 장갑차 탈취', veh: 'armored' }] },
  harbor: { name: '하버 물류 화물 강탈', target: 'biz_logi', payout: 800000, stars: 3, hold: 15, guards: 6,
    preps: [{ t: 'pay', name: '무기 준비', cost: 30000 }, { t: 'steal', name: '화물 밴 확보', veh: 'van' }] },
};

const Finance = {
  cash: null, shares: {}, estate: {}, wh: {}, laws: {}, vote: null, bank: { dep: 0, debt: 0 }, heist: { done: {}, prep: {}, cool: {} },
  job: null, stockT: 0, newsT: 120, rentT: 0, intT: 0, raidT: 240,
  load(sv) {
    sv = sv || {};
    this.cash = null;
    this.prices = COMPANIES.map((c, i) => (sv.prices && sv.prices[i]) || c.p);
    this.hist = this.prices.map(p => [p]);
    this.shares = sv.shares || {}; this.estate = sv.estate || {}; this.wh = sv.wh || {}; this.laws = sv.laws || {};
    this.bank = Object.assign({ dep: 0, debt: 0 }, sv.bank);
    this.heist = Object.assign({ done: {}, prep: {}, cool: {} }, sv.heist);
    this.vote = null; this.job = null; this.stockT = 0; this.newsT = 120; this.rentT = 0; this.intT = 0; this.raidT = 240;
  },
  save() { return { prices: this.prices.map(p => Math.round(p * 100) / 100), shares: this.shares, estate: this.estate, wh: this.wh, laws: this.laws, bank: { dep: Math.round(this.bank.dep), debt: Math.round(this.bank.debt) }, heist: { done: this.heist.done, prep: this.heist.prep, cool: {} } }; },
  law(id) { return !!this.laws[id]; },
  rentPerMin() { return Math.round(ESTATES.filter(e => this.estate[e.id]).reduce((a, e) => a + e.rent, 0) * (this.law('rent') ? 1.3 : 1)); },
  stockValue() { return COMPANIES.reduce((a, c, i) => a + (this.shares[c.id] || 0) * this.prices[i], 0); },
  netWorth() {
    const est = ESTATES.filter(e => this.estate[e.id]).reduce((a, e) => a + e.price, 0);
    const wh = Object.keys(this.wh).filter(k => this.wh[k].owned).reduce((a, k) => a + WAREHOUSES[k].price + this.wh[k].legal * 1000 + this.wh[k].contra * 3000, 0);
    return Math.round(this.bank.dep - this.bank.debt + this.stockValue() + est + wh);
  },
  loanLimit() { return Math.max(50000, Math.round((this.netWorth() + this.bank.debt + Math.max(0, Game.player.money)) * 0.5)); },

  // ---------- 매 프레임 ----------
  update(dt) {
    const P = Game.player;
    // 주가: 20초마다 무작위 걸음 + 가끔 뉴스
    this.stockT += dt;
    if (this.stockT >= 20) {
      this.stockT = 0;
      COMPANIES.forEach((c, i) => {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.4; // 대충 정규분포
        const own = c.biz && Biz.has(c.biz) ? 0.002 : 0; // 관련 사업체를 가지고 있으면 조금 오른다
        this.prices[i] = clamp(this.prices[i] * Math.exp(own + 0.0004 + c.vol * g), 2, 99999);
        this.hist[i].push(this.prices[i]); if (this.hist[i].length > 40) this.hist[i].shift();
      });
    }
    this.newsT -= dt;
    if (this.newsT <= 0) { this.newsT = rand(150, 300); const i = randi(0, COMPANIES.length - 1), [h, d] = pick(NEWS); this.shock(i, d * rand(0.7, 1.3), h); }
    // 임대 수입 (1분마다)
    const rent = this.rentPerMin();
    if (rent > 0) {
      this.rentT += dt;
      if (this.rentT >= 60) {
        this.rentT -= 60; let amt = rent;
        if (chance(0.08)) { const fix = Math.round(rent * rand(0.3, 0.8)); amt -= fix; UI.toast(`세입자 민원 — 수리비 -$${fix.toLocaleString()}`); }
        P.money += amt; Sfx.cash(); UI.toast(`임대 수입 +$${amt.toLocaleString()}`);
      }
    }
    // 중앙은행 이자 (1분마다: 예금 0.2%, 대출 0.6%)
    this.intT += dt;
    if (this.intT >= 60) {
      this.intT -= 60;
      if (this.bank.dep > 0) this.bank.dep *= 1.002;
      if (this.bank.debt > 0) {
        this.bank.debt *= 1.006;
        if (this.bank.debt > this.loanLimit() * 1.2) { const take = Math.min(this.bank.dep, this.bank.debt); this.bank.dep -= take; this.bank.debt -= take; if (take > 0) UI.toast(`연체 — 예금에서 $${Math.round(take).toLocaleString()} 자동 상환`); }
      }
    }
    // 밀수품 단속
    if (Object.values(this.wh).some(w => w.owned && w.contra > 0)) {
      this.raidT -= dt;
      if (this.raidT <= 0) {
        this.raidT = 240;
        const ch = 0.12 * (this.law('harbor') ? 0.5 : 1) * (Empire.support.off >= 40 ? 0.5 : 1);
        if (chance(ch)) { const k = pick(Object.keys(this.wh).filter(k => this.wh[k].owned && this.wh[k].contra > 0)), w = this.wh[k], lost = Math.ceil(w.contra * 0.3); w.contra -= lost; UI.big('창고 단속!', `${WAREHOUSES[k].name}에서 밀수품 ${lost}상자를 압수당했다`, 3, '#ff4d4d'); Save.write(); }
      }
    }
    // 국회 표결
    if (this.vote) {
      this.vote.t -= dt;
      if (this.vote.t <= 0) {
        const L = LAWS[this.vote.id], ok = chance(this.passChance());
        if (ok) { this.laws[this.vote.id] = true; Sfx.passed(); UI.big('법안 통과!', `${L.name} — ${L.desc}`, 3.5, '#9be15d'); }
        else { Sfx.failed(); UI.big('법안 부결', `${L.name} — 로비 자금은 돌아오지 않는다`, 3, '#ff4d4d'); }
        this.vote = null; Save.write();
      }
    }
    if (this.job) this.updateJob(dt);
    Heist.update(dt);
  },
  shock(i, d, headline) {
    this.prices[i] = clamp(this.prices[i] * (1 + d), 2, 99999);
    this.hist[i].push(this.prices[i]); if (this.hist[i].length > 40) this.hist[i].shift();
    const c = COMPANIES[i];
    if (headline) UI.toast(`📈 뉴스: ${c.name}(${c.id}) ${headline} ${d > 0 ? '▲' : '▼'}${Math.abs(d * 100).toFixed(0)}%`);
  },
  passChance() { return clamp(0.35 + Empire.support.off / 120 + Empire.support.civ / 300, 0.35, 0.95); },

  // ---------- 주식 ----------
  buy(i, n) {
    const P = Game.player, c = COMPANIES[i], cost = Math.ceil(this.prices[i] * n * 1.005);
    if (P.money < cost) { UI.toast('돈이 모자란다'); return; }
    P.money -= cost; this.shares[c.id] = (this.shares[c.id] || 0) + n; Sfx.cash();
    // 큰 매수는 주가를 조금 올린다
    this.prices[i] *= 1 + Math.min(0.05, cost / 5e6);
  },
  sell(i, n) {
    const P = Game.player, c = COMPANIES[i]; n = Math.min(n, this.shares[c.id] || 0); if (!n) return;
    const got = Math.floor(this.prices[i] * n * 0.995);
    this.shares[c.id] -= n; P.money += got; Sfx.cash(); UI.toast(`${c.id} ${n}주 매도 +$${got.toLocaleString()}`);
    this.prices[i] *= 1 - Math.min(0.05, got / 5e6);
  },

  // ---------- 창고: 화물 운송 일 ----------
  startRun(k, kind) {
    const P = Game.player, W = World.places[k], w = this.wh[k];
    if (this.job || Heist.active) { UI.toast('이미 진행 중인 일이 있다'); return; }
    if (kind === 'contra') {
      if (P.money < 15000) { UI.toast('인수 대금 $15,000이 필요하다'); return; }
      P.money -= 15000;
      const m = pick(World.marinas || [W]); const s = roadsideSpot(m.x, m.y, 20, 160);
      const car = new Car('van', s.x, s.y, s.a, { persistent: true, color: '#3a3f47' }); Game.cars.push(car);
      this.job = { kind, k, car, dest: W, crates: 10, stage: 'go' };
      UI.big('밀수품 인수', '부두 근처의 밴을 창고로 가져와라', 2.6, '#ff9f43');
    } else {
      const crates = w.legal + w.contra; if (!crates) { UI.toast('팔 화물이 없다'); return; }
      const s = roadsideSpot(W.x, W.y, 6, 60);
      const car = new Car('truck', s.x, s.y, s.a, { persistent: true, color: '#b0452f' }); Game.cars.push(car);
      // 멀리 떨어진 구매자
      const cands = Object.values(World.places).filter(p => p && p.x !== undefined && dist(p.x, p.y, W.x, W.y) > 600);
      const B = cands.length ? pick(cands) : { x: MW * T - W.x, y: MH * T - W.y };
      const dest = sidewalkNear(B.x, B.y);
      this.job = { kind: 'sell', k, car, dest, legal: w.legal, contra: w.contra, stage: 'go' };
      w.legal = 0; w.contra = 0;
      if (this.job.contra > 0 && chance(0.5)) { Wanted.set(Math.max(Wanted.stars, 2)); UI.toast('밀수품 냄새를 맡은 경찰이 따라붙는다!'); }
      UI.big('화물 판매', '트럭을 구매자에게 몰고 가라', 2.6, '#ffd166');
    }
  },
  updateJob(dt) {
    const J = this.job, P = Game.player;
    if (P.dead || J.car.dead || J.car.sunk || !Game.cars.includes(J.car)) {
      UI.big('운송 실패', '화물 차량을 잃었다', 2.4, '#ff4d4d'); Sfx.failed();
      if (J.car) J.car.persistent = false; this.job = null; UI.objective(''); return;
    }
    const inCar = P.car === J.car;
    UI.objective(inCar ? (J.kind === 'sell' ? '구매자에게 트럭을 몰고 가라' : '창고로 밴을 몰고 가라') : '화물 차량에 타라');
    if (inCar && dist(J.car.x, J.car.y, J.dest.x, J.dest.y) < 10 && J.car.speed < 4) {
      const w = this.wh[J.k];
      if (J.kind === 'contra') { w.contra = Math.min(WH_CAP - w.legal, w.contra + J.crates); UI.big('밀수품 입고', `+${J.crates}상자 (창고 ${w.legal + w.contra}/${WH_CAP})`, 2.4, '#9be15d'); }
      else {
        const mul = this.law('harbor') ? 1.15 : 1, got = Math.round((J.legal * 1350 + J.contra * 4500) * mul);
        Game.player.money += got; UI.big('화물 판매 완료', `+$${got.toLocaleString()}`, 2.6, '#9be15d');
      }
      Sfx.passed(); J.car.persistent = false; exitCar(P, true); this.job = null; UI.objective(''); Save.write();
    }
  },
  targets() {
    const out = [];
    if (this.job) out.push(Game.player.car === this.job.car ? { x: this.job.dest.x, y: this.job.dest.y, c: '#ffd166', big: true } : { x: this.job.car.x, y: this.job.car.y, c: '#6fe0ff' });
    return out.concat(Heist.targets());
  },
};

// ---------- 대형 강도 ----------
const Heist = {
  active: null,
  prepDone(id, i) { return !!(Finance.heist.prep[id] && Finance.heist.prep[id][i]); },
  ready(id) { return HEISTS[id].preps.every((_, i) => this.prepDone(id, i)); },
  markPrep(id, i) { Finance.heist.prep[id] = Finance.heist.prep[id] || {}; Finance.heist.prep[id][i] = true; Save.write(); },
  startPrep(id, i) {
    const H = HEISTS[id], S = H.preps[i], P = Game.player, base = World.places.heist;
    if (this.active || Finance.job) { UI.toast('이미 진행 중인 일이 있다'); return; }
    if (S.t === 'pay') { if (P.money < S.cost) { UI.toast('돈이 모자란다'); return; } P.money -= S.cost; Sfx.cash(); this.markPrep(id, i); UI.toast(`준비 완료: ${S.name}`); return; }
    if (S.t === 'fetch') {
      const far = Object.values(World.places).filter(p => p && p.x !== undefined && dist(p.x, p.y, P.px, P.py) > 300 && dist(p.x, p.y, P.px, P.py) < 900);
      const at = sidewalkNear(...(far.length ? (q => [q.x + 20, q.y + 20])(pick(far)) : [P.px + 300, P.py]));
      this.active = { id, i, kind: 'fetch', at, guards: [], spawned: false };
      UI.big(S.name, '표시된 곳에서 물건을 빼 와라 — 경비가 있다', 2.6, '#c77dff');
    } else {
      const s = roadsideSpot(P.px, P.py, 250, 700);
      const car = new Car(S.veh, s.x, s.y, s.a, { persistent: true }); Game.cars.push(car);
      if (S.veh === 'armored') { for (let k = 0; k < 2; k++) { const g = spawnPed('guard', s.x + rand(-4, 4), s.y + rand(-4, 4)); Object.assign(g, { persistent: true, state: 'idle', weapon: 'rifle', homeX: g.x, homeY: g.y }); } }
      this.active = { id, i, kind: 'steal', car, dest: base };
      UI.big(S.name, `${VTYPES[S.veh].name}을(를) 작전실로 가져와라`, 2.6, '#c77dff');
    }
  },
  startFinale(id) {
    const H = HEISTS[id], T0 = World.places[H.target];
    if (this.active || Finance.job) { UI.toast('이미 진행 중인 일이 있다'); return; }
    if (!T0) { UI.toast('목표 장소가 없다'); return; }
    this.active = { id, kind: 'finale', stage: 'go', at: T0, t: 0, wave: 0 };
    UI.big(`${H.name} 작전 개시`, `목표로 가서 ${H.hold}초 버텨라`, 3, '#ff4d4d');
  },
  fail(why) {
    const A = this.active; if (!A) return;
    if (A.car) A.car.persistent = false;
    for (const g of A.guards || []) g.persistent = false;
    this.active = null; UI.objective(''); Sfx.failed(); UI.big('작전 실패', why, 2.6, '#ff4d4d');
  },
  update(dt) {
    const A = this.active; if (!A) return;
    const P = Game.player, H = HEISTS[A.id];
    if (P.dead) { this.fail('쓰러졌다'); return; }
    if (A.kind === 'fetch') {
      if (!A.spawned && dist(P.px, P.py, A.at.x, A.at.y) < 80) {
        A.spawned = true;
        for (let k = 0; k < H.preps[A.i].guards; k++) { const g = spawnPed('guard', A.at.x + rand(-6, 6), A.at.y + rand(-6, 6)); Object.assign(g, { persistent: true, state: 'idle', weapon: pick(['smg', 'rifle', 'pistol']), homeX: g.x, homeY: g.y }); A.guards.push(g); }
      }
      UI.objective(`${H.preps[A.i].name}: 표시된 곳으로`);
      if (!P.car && dist(P.x, P.y, A.at.x, A.at.y) < 3) {
        for (const g of A.guards) { g.persistent = false; if (!g.dead) g.state = 'chase'; }
        this.markPrep(A.id, A.i); this.active = null; UI.objective(''); Sfx.passed(); UI.big('준비 완료', H.preps[A.i].name, 2.4, '#9be15d');
      }
    } else if (A.kind === 'steal') {
      if (A.car.dead || !Game.cars.includes(A.car)) { this.fail('차량이 부서졌다'); return; }
      const inCar = P.car === A.car;
      UI.objective(inCar ? '작전실로 몰고 가라' : `${VTYPES[A.car.type].name}에 타라`);
      if (inCar && dist(A.car.x, A.car.y, A.dest.x, A.dest.y) < 12 && A.car.speed < 4) {
        if (Wanted.stars > 0) { UI.objective('경찰을 따돌린 뒤 세워라'); return; }
        A.car.persistent = false; exitCar(P, true); A.car.remove = true;
        this.markPrep(A.id, A.i); this.active = null; UI.objective(''); Sfx.passed(); UI.big('준비 완료', H.preps[A.i].name, 2.4, '#9be15d');
      }
    } else if (A.kind === 'finale') {
      if (A.stage === 'go') {
        UI.objective(`${H.name}: 목표로 가라`);
        if (!P.car && dist(P.x, P.y, A.at.x, A.at.y) < 8) { A.stage = 'hold'; Wanted.set(H.stars); Wanted.seen = true; scarePeds(A.at.x, A.at.y, 50); UI.big('금고 공략 중!', `${H.hold}초 동안 버텨라`, 2, '#ff4d4d'); }
      } else if (A.stage === 'hold') {
        A.t += dt;
        if (dist(P.px, P.py, A.at.x, A.at.y) > 16) { this.fail('목표에서 너무 멀어졌다'); return; }
        const wave = Math.floor(A.t / (H.hold / 3));
        if (wave >= A.wave && A.wave < 3) {
          A.wave++;
          for (let k = 0; k < Math.ceil(H.guards / 3); k++) { const s = sidewalkNear(A.at.x + rand(-30, 30), A.at.y + rand(-30, 30), 12); const g = spawnPed('guard', s.x, s.y); Object.assign(g, { state: 'chase', weapon: pick(['smg', 'rifle', 'shotgun']), hp: 130, maxHp: 130 }); }
        }
        UI.objective(`금고 여는 중… ${Math.min(100, Math.round(A.t / H.hold * 100))}% — 목표 근처를 지켜라`);
        if (A.t >= H.hold) {
          A.stage = 'escape';
          const far = Object.values(World.places).filter(p => p && p.x !== undefined && dist(p.x, p.y, A.at.x, A.at.y) > 700);
          const d = far.length ? pick(far) : { x: MW * T - A.at.x, y: MH * T - A.at.y };
          A.drop = sidewalkNear(d.x, d.y);
          UI.big('금고 확보!', '은신 지점으로 도주 — 경찰을 따돌려라', 2.6, '#ffd166');
        }
      } else {
        UI.objective(Wanted.stars ? '은신 지점으로 도주 — 경찰을 따돌려야 끝난다' : '은신 지점으로 가라');
        if (dist(P.px, P.py, A.drop.x, A.drop.y) < 10 && Wanted.stars === 0) {
          const cut = Math.round(H.payout * (Gangs.mine ? 0.9 : 0.8)); // 조직이 있으면 인력 수수료가 적다
          P.money += cut; Finance.heist.done[A.id] = (Finance.heist.done[A.id] || 0) + 1; Finance.heist.prep[A.id] = {};
          const ci = COMPANIES.findIndex(c => c.biz === H.target); if (ci >= 0) Finance.shock(ci, -0.25, '강도 피해');
          this.active = null; UI.objective(''); Sfx.passed(); UI.big(`${H.name} 성공!`, `+$${cut.toLocaleString()} (팀 몫 제외)`, 4, '#9be15d'); Save.write();
        }
      }
    }
  },
  targets() {
    const A = this.active; if (!A) return [];
    if (A.kind === 'fetch') return [{ x: A.at.x, y: A.at.y, c: '#c77dff', big: true }];
    if (A.kind === 'steal') return [Game.player.car === A.car ? { x: A.dest.x, y: A.dest.y, c: '#c77dff', big: true } : { x: A.car.x, y: A.car.y, c: '#6fe0ff' }];
    if (A.stage === 'escape') return [{ x: A.drop.x, y: A.drop.y, c: '#9be15d', big: true }];
    return [{ x: A.at.x, y: A.at.y, c: '#ff4d4d', big: true }];
  },
};

// ---------- 패널 UI ----------
const FinUI = {
  kind: null,
  open(kind) { this.kind = kind; Game.state = 'fin'; document.getElementById('finui').hidden = false; this.render(); },
  close() { document.getElementById('finui').hidden = true; if (Game.state === 'fin') Game.state = 'play'; Game.shopCool = 4; },
  render() {
    const k = this.kind, P = Game.player, F = Finance;
    const body = document.getElementById('fin-body'); body.innerHTML = '';
    const set = (t, s) => { document.getElementById('fin-title').textContent = t; document.getElementById('fin-sub').textContent = s; };
    document.getElementById('fin-money').textContent = `현금 $${Math.round(P.money).toLocaleString()} · 순자산 $${(F.netWorth() + Math.round(P.money)).toLocaleString()}`;
    const row = (title, desc, btns = [], canvas) => {
      const r = document.createElement('div'); r.className = 'fin-row';
      if (canvas) r.append(canvas);
      const info = document.createElement('div'); info.className = 'fin-info'; info.innerHTML = `<b>${title}</b><span>${desc || ''}</span>`; r.append(info);
      const box = document.createElement('div'); box.className = 'fin-btns';
      for (const [label, fn, on = true, cls = ''] of btns) { const b = document.createElement('button'); b.className = 'btn small ' + cls; b.textContent = label; b.disabled = !on; b.onclick = () => { fn(); this.render(); }; box.append(b); }
      r.append(box); body.append(r);
    };
    const $ = n => '$' + Math.round(n).toLocaleString();
    if (k === 'stock') {
      set('증권거래소', '20초마다 주가가 움직인다 · 뉴스에 주의 · 관련 사업체를 가지면 주가가 조금씩 오른다 · 수수료 0.5%');
      COMPANIES.forEach((c, i) => {
        const h = F.hist[i], p = F.prices[i], ch = h.length > 1 ? (p / h[0] - 1) * 100 : 0, own = F.shares[c.id] || 0;
        const cv = document.createElement('canvas'); cv.width = 70; cv.height = 34; const g = cv.getContext('2d');
        const lo = Math.min(...h), hi = Math.max(...h);
        g.strokeStyle = ch >= 0 ? '#3ee07a' : '#ff5a5a'; g.lineWidth = 1.5; g.beginPath();
        if (h.length < 2) { g.moveTo(1, 17); g.lineTo(69, 17); }
        else h.forEach((v, j) => { const x = j / (h.length - 1) * 68 + 1, y = 32 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * 30; j ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
        row(`${c.id} ${c.name} · $${p.toFixed(2)} <i style="color:${ch >= 0 ? '#3ee07a' : '#ff5a5a'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch).toFixed(1)}%</i>`, `보유 ${own.toLocaleString()}주${own ? ` (${$(own * p)})` : ''}`,
          [['10주', () => F.buy(i, 10), P.money >= p * 10], ['100주', () => F.buy(i, 100), P.money >= p * 100], ['1000주', () => F.buy(i, 1000), P.money >= p * 1000], ['전부 매도', () => F.sell(i, own), own > 0, 'ghost']], cv);
      });
      row('주식 평가액', $(F.stockValue()));
    } else if (k === 'realty') {
      set('하버 부동산', `건물을 사 두면 1분마다 임대료가 들어온다${F.law('rent') ? ' · 임대료 상한 폐지법 +30%' : ''}`);
      row(`임대 수입 합계 ${$(F.rentPerMin())}/분`, '가끔 세입자 수리비가 나간다');
      for (const e of ESTATES) {
        const own = F.estate[e.id];
        row(e.name, `${own ? '소유 중 · ' : ''}임대료 ${$(e.rent * (F.law('rent') ? 1.3 : 1))}/분 · 매입가 ${$(e.price)}`,
          own ? [['매각', () => { P.money += Math.round(e.price * 0.85); delete F.estate[e.id]; Sfx.cash(); UI.toast(`${e.name} 매각 (+${$(e.price * 0.85)})`); Save.write(); }, true, 'ghost']] :
            [[$(e.price), () => { if (P.money < e.price) return; P.money -= e.price; F.estate[e.id] = true; Sfx.passed(); UI.toast(`${e.name} 매입!`); Save.write(); }, P.money >= e.price]]);
      }
    } else if (WAREHOUSES[k]) {
      const W = WAREHOUSES[k], w = F.wh[k];
      set(W.name, '무역품은 안전하고, 밀수품은 비싸게 팔리지만 단속·경찰 추격 위험이 있다');
      if (!w || !w.owned) { row(`${W.name} 매입`, `용량 ${WH_CAP}상자`, [[$(W.price), () => { if (P.money < W.price) return; P.money -= W.price; F.wh[k] = { owned: true, legal: 0, contra: 0 }; Sfx.passed(); Save.write(); }, P.money >= W.price]]); return; }
      const n = w.legal + w.contra;
      row(`재고 ${n}/${WH_CAP}상자`, `무역품 ${w.legal} · 밀수품 ${w.contra} · 예상 판매가 ${$((w.legal * 1350 + w.contra * 4500) * (F.law('harbor') ? 1.15 : 1))}`);
      row('무역품 10상자 구입', '상자당 $1,000 → 판매 $1,350 (안전)', [['$10,000', () => { if (P.money < 10000 || n + 10 > WH_CAP) return; P.money -= 10000; w.legal += 10; Sfx.cash(); Save.write(); }, P.money >= 10000 && n + 10 <= WH_CAP]]);
      row('밀수품 인수 작전', '$15,000 선불 · 부두의 밴을 창고로 가져오면 10상자 (판매 상자당 $4,500)', [['시작', () => { this.close(); F.startRun(k, 'contra'); }, n + 10 <= WH_CAP && !F.job && !Heist.active]]);
      row('화물 판매 운송', '트럭으로 먼 곳의 구매자에게 — 밀수품이 있으면 경찰이 붙을 수 있다', [['출발', () => { this.close(); F.startRun(k, 'sell'); }, n > 0 && !F.job && !Heist.active]]);
    } else if (k === 'cbank') {
      const B = F.bank;
      set('네온 중앙은행', '예금은 1분마다 0.2% 이자 · 대출은 1분마다 0.6% · 연체가 심하면 예금에서 자동 상환');
      row(`예금 ${$(B.dep)}`, '예금한 돈은 죽거나 잡혀도 잃지 않는다', [['전부 입금', () => { B.dep += P.money; P.money = 0; Sfx.cash(); Save.write(); }, P.money > 0], ['$10,000 입금', () => { B.dep += 10000; P.money -= 10000; Sfx.cash(); Save.write(); }, P.money >= 10000], ['$10,000 출금', () => { B.dep -= 10000; P.money += 10000; Sfx.cash(); Save.write(); }, B.dep >= 10000], ['전부 출금', () => { P.money += Math.floor(B.dep); B.dep = 0; Sfx.cash(); Save.write(); }, B.dep >= 1, 'ghost']]);
      row(`대출 ${$(B.debt)} / 한도 ${$(F.loanLimit())}`, '한도 = 순자산의 절반 (최소 $50,000)', [['$50,000 대출', () => { B.debt += 50000; P.money += 50000; Sfx.cash(); Save.write(); }, B.debt + 50000 <= F.loanLimit()], ['상환', () => { const r = Math.min(P.money, B.debt); P.money -= r; B.debt -= r; if (B.debt < 1) B.debt = 0; Sfx.cash(); Save.write(); }, B.debt > 0 && P.money > 0, 'ghost']]);
      row('금고', '중앙은행 금고를 털고 싶다면 작전실에서 준비하라', []);
    } else if (k === 'assembly') {
      set('국회의사당', `로비 자금을 대면 법안이 표결에 부쳐진다 · 통과 확률 ${Math.round(F.passChance() * 100)}% (공무원·시민 지지가 높을수록 ↑)`);
      if (F.vote) row(`표결 중: ${LAWS[F.vote.id].name}`, `${Math.ceil(F.vote.t)}초 뒤 결과`);
      for (const id in LAWS) {
        const L = LAWS[id];
        row(`${L.name}${F.laws[id] ? ' ✔ 시행 중' : ''}`, `${L.desc} · 로비 ${$(L.cost)}`, F.laws[id] ? [] : [['로비', () => { if (P.money < L.cost || F.vote) return; P.money -= L.cost; F.vote = { id, t: 60 }; Sfx.cash(); UI.toast(`${L.name} 표결은 1분 뒤`); }, P.money >= L.cost && !F.vote]]);
      }
    } else if (k === 'heist') {
      set('작전실', '준비 작업을 모두 끝내면 대형 강도를 실행할 수 있다 · 성공하면 몫의 80%(조직이 있으면 90%)');
      for (const id in HEISTS) {
        const H = HEISTS[id], rd = Heist.ready(id);
        row(`${H.name} — ${$(H.payout)}`, `수배 ★${H.stars} · 성공 ${F.heist.done[id] || 0}회`, [['실행', () => { this.close(); Heist.startFinale(id); }, rd && !Heist.active && !F.job, 'primary']]);
        H.preps.forEach((S, i) => row(`　· ${S.name}${Heist.prepDone(id, i) ? ' ✔' : ''}`, S.t === 'pay' ? `비용 ${$(S.cost)}` : S.t === 'fetch' ? `경비 ${S.guards}명` : `${VTYPES[S.veh].name}을(를) 작전실로`, Heist.prepDone(id, i) ? [] : [[S.t === 'pay' ? $(S.cost) : '시작', () => { if (S.t !== 'pay') this.close(); Heist.startPrep(id, i); }, !Heist.active && !F.job && (S.t !== 'pay' || P.money >= S.cost)]]));
      }
    }
  },
};
for (const k of ['stock', 'realty', 'cbank', 'assembly', 'heist', ...Object.keys(WAREHOUSES)]) { SHOPS[k] = { title: '', sub: '', items: () => [], panel: () => FinUI.open(k) }; EXTRA_PLACES.push([k, k]); }
EXTRA_ICONS.push({ key: 'stock', ch: '주', c: '#6fe0ff', label: '증권거래소' }, { key: 'realty', ch: '부', c: '#ffd166', label: '부동산 (임대)' }, { key: 'cbank', ch: '중', c: '#ffd700', label: '중앙은행 (예금·대출)' }, { key: 'assembly', ch: '국', c: '#e8e2d0', label: '국회 (로비)' }, { key: 'heist', ch: '작', c: '#c77dff', label: '작전실 (대형 강도)' },
  ...Object.keys(WAREHOUSES).map(k => ({ key: k, ch: '창', c: () => (Finance.wh[k] && Finance.wh[k].owned ? '#7ae68f' : '#b0b8c4'), label: WAREHOUSES[k].name })));
Object.assign(PLACE_MARK, { stock: '#6fe0ff', realty: '#ffd166', cbank: '#ffd700', assembly: '#e8e2d0', heist: '#c77dff', wh_harbor: '#b0b8c4', wh_iron: '#b0b8c4', wh_north: '#b0b8c4' });
