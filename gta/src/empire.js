'use strict';
/* =====================================================================
 * empire.js — 조직 보스 · 계약 · 내 조직 세우기 · 조직원 수 · 보스 암살단 · 국가 기관 후원
 *
 *  · 각 조직의 보스는 본부 앞에 서 있다(지도에 왕관). 플레이어는 보스를 공격할 수 없다(무적).
 *    조직 가입 = 보스와 계약. 평판 1000이 되면 보스와 '후계 계약'($50,000)을 맺고 보스가 된다.
 *  · 조직을 고르지 않고 은신처에서 '내 조직'을 세울 수도 있다($25,000, 이름·색 선택, 처음부터 보스).
 *  · 플레이어가 보스가 되면 라이벌 조직이 몇 분마다 암살단을 보낸다.
 *  · 조직원 수 = 구역 × 4 + 경제력(현금 + 사업체·임대 수입 + 자산) + 지지도. 부하 호출 수·구역 수입·전쟁 병력에 반영.
 *  · 후원: 병원·경찰서·군 기지·시청에 기부하면 시민 지지(civ)·공무원 지지(off)가 오른다.
 *      병원 → 치료비 면제 / 경찰 → 수배가 빨리 풀리고 벌금·몰수 감면 / 군 → 기지 무단 진입 수배 없음 / 시청 → 둘 다
 * ===================================================================== */

const BOSS_INFO = {
  dragon: { name: '용 회장', shirt: '#0f3d24', hat: '#1d1d1f' },
  wave: { name: '마야 "파도" 리', shirt: '#a8521a', hat: null },
  iron: { name: '모루 박', shirt: '#2f4760', hat: '#7a7f86' },
  cobra: { name: '뱀눈 카이', shirt: '#4d1f7a', hat: '#ff5d8f' },
};
const OWN_NAMES = ['블랙 선', '네온 울프', '골든 타이거', '크림슨 크로우', '실버 팽', '나이트 아울', '스틸 로터스', '레드 문'];
const OWN_COLS = ['#d7263d', '#f2c14e', '#2ec4b6', '#e8e8e8', '#ff5d8f', '#9be15d', '#3a86ff', '#ff9f1c'];
const SUPPORT_SITES = {
  hospital: { label: '병원', civ: 1, off: 0.3, perk: '치료비 면제 (지지 20 이상)' },
  police: { label: '경찰', civ: 0.3, off: 1, perk: '수배가 빨리 풀리고 체포 벌금·무기 몰수 감면 (공무원 지지 30 이상)' },
  military: { label: '군', civ: 0.2, off: 1, perk: '기지에 들어가도 수배되지 않는다 (공무원 지지 60 이상)' },
  cityhall: { label: '시청', civ: 0.8, off: 0.8, perk: '시민·공무원 지지 모두 오른다' },
};

const Empire = {
  support: { civ: 0, off: 0 }, given: {}, own: null, draft: { n: 0, c: 0 }, hitT: 300, hit: null, bossPeds: {}, tick: 0, noHitMsgT: 0,
  load(sv) {
    sv = sv || {};
    this.support = Object.assign({ civ: 0, off: 0 }, sv.support); this.given = sv.given || {};
    this.own = sv.own || null; this.hitT = 300; this.hit = null; this.bossPeds = {};
    if (this.own) this.registerOwn();
    else { delete GANGS.own; const i = GANG_IDS.indexOf('own'); if (i >= 0) GANG_IDS.splice(i, 1); }
  },
  save() { return { support: this.support, given: this.given, own: this.own }; },
  registerOwn() {
    const o = this.own;
    GANGS.own = { name: o.name, shirt: o.color, band: shade(o.color, -0.3), pants: '#1d1d1f', color: o.color, hq: 'safehouse', short: o.name[0] };
    if (!GANG_IDS.includes('own')) GANG_IDS.push('own');
  },
  // ---------- 경제력 · 조직원 수 ----------
  econ() {
    const P = Game.player;
    return Math.max(0, P.money) + Biz.total() * 60 + (typeof Finance !== 'undefined' ? Finance.netWorth() : 0);
  },
  members(g) {
    const base = Gangs.count(g) * 4;
    if (g !== Gangs.mine) return base + 20;
    const e = this.econ();
    return base + 6 + Math.floor(Math.sqrt(e / 1000) * 3) + Math.floor((this.support.civ + this.support.off) / 4);
  },
  backupSize() {
    const m = this.members(Gangs.mine);
    return Gangs.rank === 2 ? Math.min(10, 4 + Math.floor(m / 30)) : Math.min(4, 2 + Math.floor(m / 40));
  },
  incomeMul() { return 1 + Math.min(2, this.members(Gangs.mine) / 200); },
  // ---------- 매 프레임 ----------
  update(dt) {
    const P = Game.player;
    this.tick -= dt;
    if (this.tick <= 0) { this.tick = 1; this.updateBosses(); }
    // 경찰 후원: 수배가 빨리 풀린다
    if (Wanted.stars > 0 && Wanted.evadeT > 0) Wanted.evadeT += dt * ((this.support.off >= 30 ? 0.6 : 0) + (Finance.law('police') ? 0.5 : 0));
    // 보스가 되면 암살단
    if (Gangs.mine && Gangs.rank === 2 && !Missions.active && !P.dead) {
      if (!this.hit) { this.hitT -= dt; if (this.hitT <= 0) this.sendHit(); }
    }
    if (this.hit) this.updateHit(dt);
  },
  bossOf(g) { return this.bossPeds[g] && !this.bossPeds[g].remove && Game.peds.includes(this.bossPeds[g]) ? this.bossPeds[g] : null; },
  updateBosses() {
    const P = Game.player;
    for (const g of GANG_IDS) {
      if (g === 'own') continue;
      const HQ = World.places[GANGS[g].hq]; if (!HQ) continue;
      const mineBoss = Gangs.mine === g && Gangs.rank === 2; // 내가 보스면 NPC 보스는 없다
      const d = dist(P.px, P.py, HQ.x, HQ.y), b = this.bossOf(g);
      if (b && (d > 170 || mineBoss)) { b.remove = true; for (const q of b.guards || []) q.remove = true; delete this.bossPeds[g]; continue; }
      if (!b && !mineBoss && d < 130) {
        const I = BOSS_INFO[g], side = HQ.face === 0 || HQ.face === 2 ? [0, 2.4] : [2.4, 0];
        const p = spawnPed('gang', HQ.x + side[0], HQ.y + side[1]); setGang(p, g);
        Object.assign(p, { persistent: true, invuln: true, stay: true, state: 'idle', homeX: p.x, homeY: p.y, nameTag: `♛ ${I.name} (${GANGS[g].name} 보스)`, bossNpc: g, shirt: I.shirt, hat: I.hat || undefined, weapon: 'pistol' });
        p.guards = [];
        for (const s of [-1, 1]) {
          const q = spawnPed('gang', p.x + s * 1.6 * (side[1] ? 1 : 0) + (side[0] ? 1.4 : 0), p.y + s * 1.6 * (side[0] ? 1 : 0) + (side[1] ? 1.4 : 0)); setGang(q, g);
          Object.assign(q, { persistent: true, stay: true, state: 'idle', homeX: q.x, homeY: q.y, weapon: 'rifle', hp: 160, maxHp: 160 });
          p.guards.push(q);
        }
        this.bossPeds[g] = p;
      }
    }
  },
  // 보스를 때리려 하면 (무적) 한마디
  bossHit(p) {
    if (this.noHitMsgT > Game.time) return;
    this.noHitMsgT = Game.time + 4;
    Talk.say(p, pick(['감히 누구한테?', '계약서나 읽고 와라.', '내 경호원들이 가만있지 않을 거다.']), 2, true);
    UI.toast('조직 보스는 공격할 수 없다');
  },
  // ---------- 암살단 ----------
  sendHit() {
    const P = Game.player;
    const rivals = GANG_IDS.filter(g => g !== Gangs.mine && Gangs.count(g) > 0);
    if (!rivals.length) { this.hitT = 300; return; }
    const g = pick(rivals), n = Math.min(7, 3 + Math.floor(Gangs.count(g) / 20));
    const men = [];
    for (let i = 0; i < n; i++) {
      const s = offscreenWalkSpot(40, 75); if (!s) continue;
      const q = spawnPed('gang', s.x, s.y); setGang(q, g);
      Object.assign(q, { persistent: true, state: 'chase', hitman: true, hp: 140, maxHp: 140, armor: 40, weapon: pick(['smg', 'rifle', 'shotgun', 'magnum']) });
      men.push(q);
    }
    if (!men.length) { this.hitT = 30; return; }
    const off = Math.min(0.5, this.support.off / 200); // 공무원 지지가 높으면 덜 온다
    this.hitT = rand(200, 380) * (1 + off);
    this.hit = { g, men, t: 0 };
    UI.big('암살단 습격!', `${GANGS[g].name}가 보스인 너를 노린다 — ${men.length}명`, 3, '#ff4d4d'); Sfx.tone({ f0: 300, f1: 180, dur: 0.5, type: 'sawtooth', vol: 0.25 });
  },
  updateHit(dt) {
    const H = this.hit, P = Game.player; H.t += dt;
    for (const q of H.men) if (!q.dead && q.state !== 'chase' && dist2(q.x, q.y, P.px, P.py) < 90 * 90) q.state = 'chase';
    const left = H.men.filter(q => !q.dead && !q.remove && Game.peds.includes(q)).length;
    if (P.dead || H.t > 150 || !left) {
      for (const q of H.men) q.persistent = false;
      if (!left && !P.dead) { P.money += 2500; Gangs.addRep(80, '암살단 격퇴'); Sfx.passed(); UI.big('암살단 격퇴', '+$2,500', 2.4, '#9be15d'); }
      this.hit = null;
    }
  },
  targets() {
    if (!this.hit) return [];
    return this.hit.men.filter(q => !q.dead).map(q => ({ x: q.x, y: q.y, c: '#ff4d4d' }));
  },
  // ---------- 내 조직 세우기 ----------
  found() {
    const P = Game.player, cost = 25000;
    if (Gangs.mine) { UI.toast('이미 조직에 속해 있다 — 먼저 탈퇴해야 한다'); return; }
    if (P.money < cost) { UI.toast('창설 자금 $25,000이 필요하다'); return; }
    P.money -= cost;
    this.own = { name: OWN_NAMES[this.draft.n], color: OWN_COLS[this.draft.c] };
    this.registerOwn();
    // 시작 구역: 은신처가 있는 블록 + 이웃 중립 블록 2개
    const SH = World.places.safehouse, home = blockAt(SH.x, SH.y) || (SH.lot && SH.lot.block);
    if (home) {
      Gangs.turf[home.id] = 'own';
      const cx = (home.x0 + home.x1) / 2, cy = (home.y0 + home.y1) / 2;
      blocksNear(cx * T, cy * T, 90).filter(b => b !== home && !Gangs.turf[b.id]).sort((a, b) => dist(a.x0, a.y0, cx, cy) - dist(b.x0, b.y0, cx, cy)).slice(0, 2).forEach(b => { Gangs.turf[b.id] = 'own'; });
    }
    Gangs.mine = 'own'; Gangs.rank = 2; Gangs.rep = 0;
    Sfx.passed(); UI.big(`${this.own.name} 창설!`, '너는 보스다 — 라이벌 조직의 암살단을 조심해라', 3.5, this.own.color);
    Save.write();
  },
  // ---------- 후원 ----------
  donate(site, amt) {
    const P = Game.player, S = SUPPORT_SITES[site];
    if (P.money < amt) return;
    P.money -= amt;
    const pts = Math.sqrt(amt / 1000) * 3; // 큰 돈일수록 효율은 줄어든다
    this.support.civ = Math.round((this.support.civ + pts * S.civ) * 10) / 10;
    this.support.off = Math.round((this.support.off + pts * S.off) * 10) / 10;
    this.given[site] = (this.given[site] || 0) + amt;
    Sfx.cash(); UI.toast(`${S.label} 후원 $${amt.toLocaleString()} — 시민 지지 ${Math.round(this.support.civ)} · 공무원 지지 ${Math.round(this.support.off)}`);
    Save.write();
  },
  donateItems(site) {
    const S = SUPPORT_SITES[site], sup = this.support;
    return [
      { id: 'sup_info', name: `${S.label} 후원 — 누적 $${(this.given[site] || 0).toLocaleString()}`, price: 0, desc: `시민 지지 ${Math.round(sup.civ)} · 공무원 지지 ${Math.round(sup.off)} · ${S.perk} · 지지가 높으면 조직원이 늘어난다`, ok: () => false },
      ...[5000, 25000, 100000].map(a => ({ id: 'sup_' + a, name: `$${a.toLocaleString()} 기부`, price: a, btn: '기부', desc: `지지 +${(Math.sqrt(a / 1000) * 3).toFixed(1)} (시민 ×${S.civ} · 공무원 ×${S.off})`, ok: () => true, fn: () => { this.donate(site, a); Shop.open(this.shopOf(site)); } })),
    ];
  },
  shopOf(site) { return site === 'military' ? 'milgate' : site === 'cityhall' ? 'cityhall' : site === 'police' ? 'police_st' : 'hospital_st'; },
  // 병원비 면제 여부 · 체포 감면
  freeHospital() { return this.support.civ >= 20; },
  lenient() { return this.support.off >= 30; },
  baseAccess() { return this.support.off >= 60; },
};

// ---------- 가게(상호작용) ----------
SHOPS.hospital_st = { title: '병원', sub: '후원하면 시민 지지가 오르고, 지지 20 이상이면 치료비가 무료다', items: () => Empire.donateItems('hospital') };
SHOPS.police_st = { title: '경찰서', sub: '후원하면 공무원 지지가 오른다 — 지지 30 이상이면 수배가 빨리 풀린다', items: () => Empire.donateItems('police') };
SHOPS.milgate = { title: '포트 네온 기지 정문', sub: '국방 후원 — 공무원 지지 60 이상이면 기지에 들어가도 수배되지 않는다', items: () => Empire.donateItems('military') };
SHOPS.cityhall = { title: '네온 시청', sub: '시민과 공무원 모두의 지지를 얻는다', items: () => Empire.donateItems('cityhall') };
for (const k of ['hospital', 'clinic', 'hospital2', 'hospital3']) EXTRA_PLACES.push([k, 'hospital_st']);
for (const k of ['police', 'police2', 'police3']) EXTRA_PLACES.push([k, 'police_st']);
EXTRA_PLACES.push(['cityhall', 'cityhall'], ['milgate', 'milgate']);
EXTRA_ICONS.push({ key: 'cityhall', ch: '시', c: '#e8e2d0', label: '시청 (후원)' });
Object.assign(PLACE_MARK, { cityhall: '#e8e2d0', milgate: '#8f9b6a', hospital: '#e0443e', clinic: '#e0443e', hospital2: '#e0443e', hospital3: '#e0443e', police: '#4b8fe8', police2: '#4b8fe8', police3: '#4b8fe8' });

// 은신처: 쉬기·저장 + 내 조직 세우기
SHOPS.safehouse = {
  title: '은신처', get sub() { return Empire.own ? `${Empire.own.name} 본부` : '쉬면 저장된다 · 여기서 내 조직을 세울 수 있다'; },
  items: () => {
    const out = [{ id: 'rest', name: '6시간 자기 (저장)', price: 0, btn: '자기', desc: '체력 회복 · 수배 중에는 못 잔다', ok: () => Wanted.stars === 0, fn: () => { Shop.close(); Safehouse.use(); } }];
    if (!Gangs.mine) {
      const d = Empire.draft;
      out.push({ id: 'own_name', name: `조직 이름: ${OWN_NAMES[d.n]}`, price: 0, btn: '바꾸기', desc: '다음 이름', ok: () => true, fn: () => { d.n = (d.n + 1) % OWN_NAMES.length; Shop.open('safehouse'); } });
      out.push({ id: 'own_col', name: '조직 색', price: 0, btn: '바꾸기', desc: `지금: ${OWN_COLS[d.c]}`, ok: () => true, fn: () => { d.c = (d.c + 1) % OWN_COLS.length; Shop.open('safehouse'); } });
      out.push({ id: 'own_found', name: `'${OWN_NAMES[d.n]}' 창설 — 너는 보스가 된다`, price: 25000, btn: '창설', desc: '은신처 블록과 이웃 2블록이 첫 구역 · 조직원 수는 경제력과 지지도에 비례', ok: () => true, fn: () => { Empire.found(); Shop.close(); } });
    } else if (Gangs.mine === 'own') {
      out.push({ id: 'own_info', name: `${Empire.own.name} · 구역 ${Gangs.count('own')}블록 · 조직원 ${Empire.members('own')}명`, price: 0, desc: `평판 ${Gangs.rep} · 부하 호출 ${Empire.backupSize()}명 · 구역 수입 ×${Empire.incomeMul().toFixed(2)}`, ok: () => false });
      out.push({ id: 'gjob1', name: '보호비 수금', price: 0, btn: '시작', desc: '평판 +40, 돈 $300씩', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('collect'); } });
      out.push({ id: 'gjob2', name: '구역 습격 — 이웃 라이벌 블록', price: 0, btn: '시작', desc: '성공하면 그 블록이 우리 구역', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('raid'); } });
      out.push({ id: 'gcall', name: `부하 부르기 (${Empire.backupSize()}명)`, price: 0, btn: '호출', desc: 'K 키 / 일시정지 메뉴에서도 된다', ok: () => true, fn: () => { Shop.close(); Gangs.callBackup(); } });
      out.push({ id: 'gwar', name: '전쟁 선포 — 이웃 라이벌 블록 습격', price: 0, btn: '선포', desc: '대규모 전쟁을 지금 시작한다', ok: () => !Gangs.war, fn: () => { Shop.close(); Gangs.declareWar('own'); } });
    }
    return out;
  },
};
