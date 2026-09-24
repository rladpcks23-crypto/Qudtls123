'use strict';
/* =====================================================================
 * gangs.js — 네 조직의 구역(블록 단위) · 5일마다 대규모 갱 전쟁 · 플레이어의 조직 생활
 *
 *  · 구역: 도시 블록마다 주인 조직이 있다(없으면 중립). 지도에서 [갱단 구역]으로 본다.
 *  · 전면전: 5일마다(또는 보스가 선포) 두 조직이 전체 병력으로 붙는다. 맞닿은 블록마다 전선 전투,
 *    병력이 바닥난 쪽은 궤멸해 남은 구역을 모두 잃고 7일 뒤 본거지에서 재건한다.
 *  · 조직 관리: 어디서나 O 키 — 지도에서 넓힐 블록을 골라 습격할 수 있다.
 *  · 플레이어: 조직 하나에만 들어갈 수 있다. 조직원 → 파트너(평판 300) → 보스(평판 1000 + 보스 결투)
 *    조직원: 같은 조직은 아군, 라이벌은 자기 구역에서 공격해 온다 / 파트너: 부하 2명 호출, 구역 수입 일부
 *    보스: 부하 호출, 구역 수입 전부, 전면전 선포·휴전
 * ===================================================================== */

Object.assign(GANGS, {
  iron: { name: '아이언 형제단', shirt: '#5b7fa6', band: '#c0c7d0', pants: '#2b2f3a' },
  cobra: { name: '네온 코브라', shirt: '#8a3bd1', band: '#ff5d8f', pants: '#1a1a1a' },
});
Object.assign(GANGS.dragon, { color: '#1f8a4c', hq: 'hq_dragon', short: '청' });
Object.assign(GANGS.wave, { color: '#e07a1f', hq: 'hq_wave', short: '파' });
Object.assign(GANGS.iron, { color: '#5b7fa6', hq: 'hq_iron', short: '철' });
Object.assign(GANGS.cobra, { color: '#b05ce8', hq: 'hq_cobra', short: '코' });
const GANG_IDS = ['dragon', 'wave', 'iron', 'cobra'];
const RANKS = ['조직원', '파트너', '보스'];

const Gangs = {
  turf: {}, fallen: {}, mine: null, rep: 0, rank: 0, day: 0, lastClock: 0, nextWar: 5, war: null, callCD: 0, incomeT: 0, boss: null,
  // 처음 구역: 하버 → 청룡파, 해변 → 파도파, 산업단지 → 아이언, 미드타운 동쪽 → 코브라
  initTurf() {
    this.turf = {};
    // 동네별 첫 주인 (다운타운·주택가·나머지 미드타운은 중립)
    const HOME = { '하버 포인트': 'dragon', '터미널 아일랜드': 'dragon', '선셋 비치': 'wave', '코랄 베이': 'wave', '팜 쇼어': 'wave', '아이언 밸리': 'iron', '러스트 야드': 'iron', '유니언 스퀘어': 'cobra', '리버사이드': 'cobra' };
    for (const b of World.blocks) {
      if (b.district === DIST.PARK) continue;
      const g = HOME[World.hoods[b.hood].name];
      if (g) this.turf[b.id] = g;
    }
  },
  load(sv) {
    this.war = null; this.exp = null; this.callCD = 0; this.incomeT = 0; this.boss = null;
    if (sv) { this.turf = sv.turf || {}; this.mine = sv.mine || null; this.rep = sv.rep || 0; this.rank = sv.rank || 0; this.day = sv.day || 0; this.nextWar = sv.nextWar || this.day + 5; this.fallen = sv.fallen || {}; if (!Object.keys(this.turf).length) this.initTurf(); }
    else { this.initTurf(); this.fallen = {}; this.mine = null; this.rep = 0; this.rank = 0; this.day = 0; this.nextWar = 5; }
    this.lastClock = Game.clock;
  },
  save() { return { turf: this.turf, mine: this.mine, rep: this.rep, rank: this.rank, day: this.day, nextWar: this.nextWar, fallen: this.fallen }; },
  count(g) { let n = 0; for (const k in this.turf) if (this.turf[k] === g) n++; return n; },
  ownerAt(x, y) { const b = blockAt(x, y); return b ? this.turf[b.id] || null : null; },
  friendly(p) { return p && p.kind === 'gang' && this.mine && p.gang === this.mine && !p.mission; },
  addRep(n, why) {
    if (!this.mine) return;
    this.rep = Math.max(0, this.rep + n);
    if (why && n) UI.toast(`${GANGS[this.mine].name} 평판 ${n > 0 ? '+' : ''}${n} (${why})`);
    if (this.rank === 0 && this.rep >= 300) { this.rank = 1; UI.big('파트너 승격!', `${GANGS[this.mine].name}의 파트너 — 부하 2명 호출, 구역 수입 분배`, 3, GANGS[this.mine].color); }
  },
  join(g) {
    if (this.mine) return;
    this.mine = g; this.rep = 0; this.rank = 0;
    UI.big(`${GANGS[g].name} 가입`, '조직원 — 라이벌 조직은 자기 구역에서 너를 노린다', 3, GANGS[g].color); Save.write();
  },
  leave() {
    if (!this.mine) return;
    const g = this.mine; this.mine = null; this.rep = 0; this.rank = 0;
    if (g === 'own') { UI.toast(`${GANGS.own.name}을(를) 해산했다`); for (const k in this.turf) if (this.turf[k] === 'own') delete this.turf[k]; Empire.own = null; Empire.load(Empire.save()); Save.write(); return; }
    for (const p of Game.peds) if (p.kind === 'gang' && p.gang === g && !p.dead) { if (p.state === 'escort') p.remove = true; }
    UI.toast(`${GANGS[g].name}을(를) 떠났다`); Save.write();
  },

  update(dt) {
    const P = Game.player;
    // 날짜: 시계가 자정을 넘으면 하루
    if (Game.clock < this.lastClock - 600) { this.day++; this.revive(); if (this.day >= this.nextWar && !this.war) this.startWar(); }
    this.lastClock = Game.clock;
    this.callCD -= dt;
    // 파트너·보스 구역 수입 (1분마다)
    if (this.mine && this.rank >= 1) {
      this.incomeT += dt;
      if (this.incomeT >= 60) { this.incomeT -= 60; const amt = Math.round(this.count(this.mine) * (this.rank === 2 ? 150 : 30) * Empire.incomeMul()); if (amt > 0) { P.money += amt; Sfx.cash(); UI.toast(`조직 구역 수입 +$${amt.toLocaleString()} (${this.count(this.mine)}블록)`); } }
    }
    if (this.war) this.updateWar(dt);
    if (this.exp) this.updateExp(dt);
    if (this.boss) this.updateBoss();
  },

  // ---------- 대규모 갱 전쟁 ----------
  borderPairs() {
    const out = [];
    for (const a of World.blocks) {
      const ga = this.turf[a.id]; if (!ga) continue;
      for (const b of World.blocks) {
        const gb = this.turf[b.id]; if (!gb || gb === ga || b.id <= a.id) continue;
        const touch = a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3 && a.y0 <= b.y1 + 3 && b.y0 <= a.y1 + 3;
        if (touch) out.push([a, b]);
      }
    }
    return out;
  },
  // ---------- 전면전: 조직 전체 대 전체 ----------
  // 두 조직이 맞닿은 블록 한 쌍이 '전선'. 전선마다 전투가 벌어지고 이긴 쪽이 상대 블록을 가져간다.
  // 병력(전쟁 시작 때 조직원 수)은 쓰러진 조직원만큼, 전투에서 질 때마다 처음 병력의 25%씩 준다.
  // 병력이 바닥나거나 구역을 모두 잃은 조직은 궤멸 → 남은 구역이 전부 승자에게 넘어간다 (7일 뒤 본거지에서 재건).
  pairsBetween(A, D) {
    return this.borderPairs().filter(([a, b]) => (this.turf[a.id] === A && this.turf[b.id] === D) || (this.turf[a.id] === D && this.turf[b.id] === A))
      .map(([a, b]) => this.turf[a.id] === A ? [a, b] : [b, a]);
  },
  ours(w = this.war) { return !!(w && this.mine && (w.A === this.mine || w.D === this.mine)); },
  startWar(A, D) {
    if (this.war) return false;
    if (!A || !D) { // 날짜가 되면 저절로: 맞닿은 두 조직 (우리 조직이 걸릴 확률이 높다)
      let pairs = this.borderPairs(); if (!pairs.length) { this.nextWar = this.day + 5; return false; }
      if (this.mine && chance(0.6)) { const mp = pairs.filter(([a, b]) => this.turf[a.id] === this.mine || this.turf[b.id] === this.mine); if (mp.length) pairs = mp; }
      const [a, b] = pick(pairs); [A, D] = chance(0.5) ? [this.turf[a.id], this.turf[b.id]] : [this.turf[b.id], this.turf[a.id]];
    }
    if (!this.pairsBetween(A, D).length) { UI.toast(`${GANGS[D].name}와(과) 맞닿은 구역이 없다 — 먼저 구역을 넓혀 붙어라`); return false; }
    this.nextWar = this.day + 5;
    const pow = g => Math.max(30, Empire.members(g));
    const w = this.war = { A, D, pow: { [A]: pow(A), [D]: pow(D) }, fronts: 0, won: { [A]: 0, [D]: 0 }, t: 0 };
    w.pow0 = { ...w.pow };
    UI.big('전면전!', `${GANGS[A].name} 전체 vs ${GANGS[D].name} 전체 — 한쪽이 궤멸할 때까지`, 3.5, '#ff4d4d');
    UI.toast(this.ours(w) ? `우리 조직의 전면전이다! 전선(빨간 화살표)으로 가서 싸워라 — 병력 ${w.pow[this.mine]} vs ${w.pow[this.mine === A ? D : A]}` : `${GANGS[A].name}와(과) ${GANGS[D].name}의 전면전 — 휘말리지 않게 조심`);
    this.nextFront();
    return true;
  },
  nextFront() {
    const w = this.war, pr = this.pairsBetween(w.A, w.D), P = Game.player;
    if (!pr.length) { this.stopWar('더 이상 맞닿은 구역이 없어 전쟁이 멈췄다'); return; }
    const cen = b => [(b.x0 + b.x1 + 1) / 2 * T, (b.y0 + b.y1 + 1) / 2 * T];
    const f = this.ours(w) ? pr.sort((p, q) => dist(...cen(p[1]), P.px, P.py) - dist(...cen(q[1]), P.px, P.py))[0] : pick(pr);
    w.fa = f[0]; w.blk = f[1]; [w.x, w.y] = cen(w.blk);
    w.bt = 0; w.wave = 0; w.sim = false; w.auto = false; w.fronts++;
    if (this.ours(w) && w.fronts > 1) UI.toast(`다음 전선 ${w.fronts}: 지도·화살표의 빨간 표시로 가라`);
  },
  spawnWave() {
    const w = this.war; w.wave++;
    const L = w.blk.loop;
    const size = g => Math.min(w.pow[g], g === this.mine ? Math.min(12, 6 + Math.floor(Empire.members(g) / 25)) : 7); // 내 조직은 조직원 수만큼 병력이 는다
    for (const [g, side] of [[w.A, 0], [w.D, 1]]) for (let i = 0; i < size(g); i++) {
      const [x, y] = loopPoint(L, rand(0, L.P) * 0.5 + side * L.P * 0.5);
      const p = spawnPed('gang', x, y); setGang(p, g);
      Object.assign(p, { persistent: true, war: w, hp: 110, maxHp: 110, state: 'idle', homeX: w.x + rand(-4, 4), homeY: w.y + rand(-4, 4) });
      if (chance(0.5)) p.weapon = pick(['smg', 'pistol', 'shotgun', 'rifle']);
    }
  },
  updateWar(dt) {
    const w = this.war, P = Game.player, ours = this.ours(w);
    w.t += dt; w.bt += dt;
    // 쓰러진 전투원만큼 그 조직의 병력이 준다
    for (const p of Game.peds) if (p.war === w && p.dead && !p.warDead) { p.warDead = true; w.pow[p.gang] = Math.max(0, w.pow[p.gang] - 1); }
    if (!w.sim && dist(w.x, w.y, P.px, P.py) < 250) { w.sim = true; w.bt = 0; this.spawnWave(); }
    // 현장에 없으면 병력 비율로 판정 (우리 전쟁은 달려갈 시간을 준다)
    if (!w.sim) { if (w.bt > (ours ? 150 : 40)) { w.auto = true; const a = w.pow[w.A], d = w.pow[w.D]; this.endBattle(chance(a / (a + d + 0.01)) ? w.A : w.D); } return; }
    const alive = g => Game.peds.filter(p => p.war === w && p.gang === g && !p.dead).length;
    const a = alive(w.A), d = alive(w.D);
    // 전투원을 서로에게 붙인다
    for (const p of Game.peds) if (p.war === w && !p.dead && p.state === 'idle' && !p.foe) {
      let best = null, bd = 60 * 60;
      for (const q of Game.peds) if (q.war === w && !q.dead && q.gang !== p.gang) { const d2 = dist2(p.x, p.y, q.x, q.y); if (d2 < bd) { bd = d2; best = q; } }
      if (best) { p.foe = best; p.state = 'feud'; }
    }
    if ((a === 0 || d === 0) && w.wave < 3 && w.bt < 150 && w.pow[w.A] > 0 && w.pow[w.D] > 0) { this.spawnWave(); return; }
    if (a === 0 || d === 0 || w.bt > 180 || !w.pow[w.A] || !w.pow[w.D]) this.endBattle(a > d ? w.A : a < d ? w.D : w.pow[w.A] >= w.pow[w.D] ? w.A : w.D);
  },
  releaseFighters(w) { for (const p of Game.peds) if (p.war === w) { p.persistent = false; p.war = null; if (!p.dead) { p.state = 'idle'; p.foe = null; } } },
  endBattle(win) {
    const w = this.war, lose = win === w.A ? w.D : w.A;
    const taken = win === w.A ? w.blk : w.fa; this.turf[taken.id] = win; // 이긴 쪽이 전선의 상대 블록을 가져간다
    w.pow[lose] = Math.max(0, w.pow[lose] - Math.ceil(w.pow0[lose] * 0.25)); w.won[win]++;
    this.releaseFighters(w);
    const ours = this.ours(w);
    if (ours || dist(w.x, w.y, Game.player.px, Game.player.py) < 300)
      UI.toast(`전선 ${w.fronts}: ${GANGS[win].name} 승리 — ${GANGS[lose].name} 블록 1개 차지${w.auto ? ' (현장에 없어 병력 비율로 판정)' : ''} · 병력 ${GANGS[w.A].name} ${w.pow[w.A]} / ${GANGS[w.D].name} ${w.pow[w.D]}`);
    if (this.mine === win) { this.addRep(100, '전선 승리'); Game.player.money += 3000; }
    else if (this.mine === lose) this.addRep(-20, '전선 패배');
    if (w.pow[lose] <= 0 || this.count(lose) === 0) { this.endWar(win); return; }
    Save.write();
    this.nextFront();
  },
  endWar(win) {
    const w = this.war; if (!w) return;
    this.war = null; this.releaseFighters(w);
    const lose = win === w.A ? w.D : w.A;
    let n = 0; for (const k in this.turf) if (this.turf[k] === lose) { this.turf[k] = win; n++; } // 궤멸: 남은 구역 전부
    this.fallen[lose] = this.day;
    UI.big(`${GANGS[win].name} 전면전 승리`, `${GANGS[lose].name} 궤멸 — 남은 구역 ${n}블록을 모두 차지`, 4, GANGS[win].color);
    if (this.mine === win) { this.addRep(500, '전면전 승리'); Game.player.money += 50000; UI.toast('전면전 승리 보너스 +$50,000'); }
    else if (this.mine === lose) { this.addRep(-200, '전면전 패배'); UI.toast('우리 조직이 궤멸했다 — 7일 뒤 본거지에서 재건한다'); }
    else UI.toast(`갱 전쟁 결과: ${GANGS[lose].name}가 궤멸해 ${GANGS[win].name}가 ${n}블록을 가져갔다 · 지도(M → G)에서 확인`);
    Save.write();
  },
  stopWar(msg) {
    const w = this.war; if (!w) return;
    this.war = null; this.releaseFighters(w);
    UI.big('전쟁 종료', msg, 3, '#cccccc'); Save.write();
  },
  // 휴전 (보스): 돈을 내고 전면전을 멈춘다. 그때까지 뺏고 뺏긴 블록은 그대로
  truce() {
    const P = Game.player, cost = 20000;
    if (!this.war || !this.ours()) return;
    if (P.money < cost) { UI.toast(`휴전 협상금 $${cost.toLocaleString()}이 필요하다`); return; }
    P.money -= cost; this.addRep(-50, '휴전'); this.stopWar('휴전 협정 — 지금까지의 구역은 그대로');
  },
  // 궤멸한 조직은 7일 뒤 본거지 블록과 이웃 중립 블록 2개로 재건한다
  revive() {
    for (const g of GANG_IDS) {
      if (this.fallen[g] === undefined || this.count(g) > 0 || this.day - this.fallen[g] < 7) continue;
      const H = World.places[GANGS[g].hq]; if (!H) continue;
      const home = blockAt(H.x, H.y) || (H.lot && H.lot.block); if (!home) continue;
      if (this.turf[home.id] && this.turf[home.id] === this.mine && g !== this.mine) continue; // 플레이어 구역은 빼앗지 않는다
      this.turf[home.id] = g; delete this.fallen[g];
      const cx = (home.x0 + home.x1) / 2, cy = (home.y0 + home.y1) / 2;
      blocksNear(cx * T, cy * T, 90).filter(b => b !== home && !this.turf[b.id]).slice(0, 2).forEach(b => { this.turf[b.id] = g; });
      UI.toast(`${GANGS[g].name}가 본거지에서 재건했다`);
    }
  },
  // HUD에 띄울 전쟁 상황 (우리 전쟁이거나 가까운 전쟁만)
  warStatus() {
    const w = this.war; if (!w) return null;
    const P = Game.player, d = Math.round(dist(w.x, w.y, P.px, P.py)), ours = this.ours(w);
    if (!ours && d > 300) return null;
    const side = !ours ? '' : w.A === this.mine ? ' (우리가 선공)' : ' (우리가 방어)';
    const head = `전면전${side} · 병력 ${GANGS[w.A].name} ${w.pow[w.A]} vs ${GANGS[w.D].name} ${w.pow[w.D]} · 전선 ${w.fronts}`;
    if (!w.sim) return `${head} · 전선까지 ${d}m — 250m 안에 들어가면 싸움 시작 (${Math.max(0, Math.ceil((ours ? 150 : 40) - w.bt))}초 뒤 병력 비율로 자동 판정)`;
    const alive = g => Game.peds.filter(p => p.war === w && p.gang === g && !p.dead).length;
    return `${head} · ${w.wave}/3차 ${alive(w.A)}명 vs ${alive(w.D)}명 · 남은 ${Math.max(0, Math.ceil(180 - w.bt))}초`;
  },
  onKill(p, by) {
    if (by !== Game.player || p.kind !== 'gang' || !this.mine || p.mission) return;
    if (p.gang === this.mine) this.addRep(-30, '같은 조직원을 죽였다');
    else this.addRep(this.war && p.war === this.war ? 15 : 6, '라이벌 처치');
  },

  // ---------- 부하 호출 (파트너 2명 · 보스 4명) ----------
  callBackup() {
    const P = Game.player;
    if (!this.mine || this.rank < 1) { UI.toast('파트너 이상만 부하를 부를 수 있다'); return; }
    if (this.callCD > 0) { UI.toast(`부하는 ${Math.ceil(this.callCD)}초 뒤에 부를 수 있다`); return; }
    this.callCD = 45;
    const n = Empire.backupSize();
    for (let i = 0; i < n; i++) {
      const s = sidewalkNear(P.px + rand(-12, 12), P.py + rand(-12, 12), 4);
      const p = spawnPed('gang', s.x, s.y); setGang(p, this.mine);
      Object.assign(p, { persistent: true, state: 'escort', escort: true, hp: 150, maxHp: 150, weapon: pick(['smg', 'rifle', 'shotgun']) });
    }
    UI.toast(`부하 ${n}명이 달려온다`); Sfx.tone({ f0: 500, f1: 900, dur: 0.2, type: 'triangle', vol: 0.2 });
  },

  // 전쟁 선포 (보스): 이웃 라이벌 블록 하나를 골라 습격
  // 우리 구역에 맞닿은 주인 없는 블록 중 가장 가까운 것
  neutralNeighbor(g) {
    const own = World.blocks.filter(b => this.turf[b.id] === g), P = Game.player;
    let best = null, bd = Infinity;
    for (const b of World.blocks) {
      if (this.turf[b.id] || !b.loop || b.airport || b.district === DIST.AIRPORT) continue;
      if (!own.some(a => a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3 && a.y0 <= b.y1 + 3 && b.y0 <= a.y1 + 3)) continue;
      const d = dist((b.x0 + b.x1) / 2 * T, (b.y0 + b.y1) / 2 * T, P.px, P.py); if (d < bd) { bd = d; best = b; }
    }
    return best;
  },
  // 전면전 선포 (보스): 상대 조직을 골라 전체 대 전체로 붙는다
  declareWar(g, target) {
    if (this.war) { UI.toast('이미 전쟁 중이다'); return; }
    if (!target) { const pr = this.borderPairs().filter(([a, b]) => this.turf[a.id] === g || this.turf[b.id] === g); if (!pr.length) { UI.toast('맞닿은 라이벌 구역이 없다 — 먼저 구역을 넓혀라'); return; } const [a, b] = pick(pr); target = this.turf[a.id] === g ? this.turf[b.id] : this.turf[a.id]; }
    this.startWar(g, target);
  },
  // ---------- 부하 파견: 이웃 블록 여러 곳을 부하들이 한꺼번에 차지하러 간다 (플레이어는 안 가도 된다) ----------
  // 주인 없는 블록은 거의 성공, 라이벌 블록은 우리와 상대 조직원 수에 따라 성공률이 정해진다.
  expCost(b) { return this.turf[b.id] ? 12000 : 4000; },
  expChance(b) {
    const r = this.turf[b.id]; if (!r) return 0.92;
    const a = Empire.members(this.mine), d = Empire.members(r);
    return clamp(0.3 + 0.5 * a / (a + d), 0.4, 0.85);
  },
  // 우리 구역에서 바깥으로 자라듯 n곳을 고른다 (고른 블록도 다음 블록의 이웃으로 친다)
  expPlan(n) {
    const g = this.mine, P = Game.player, taken = new Set(World.blocks.filter(b => this.turf[b.id] === g).map(b => b.id)), out = [];
    const touch = (a, b) => a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3 && a.y0 <= b.y1 + 3 && b.y0 <= a.y1 + 3;
    const mine = () => World.blocks.filter(b => taken.has(b.id));
    for (let i = 0; i < n; i++) {
      const own = mine();
      let best = null, bs = Infinity;
      for (const b of World.blocks) {
        if (taken.has(b.id) || !b.loop || b.airport || b.district === DIST.AIRPORT || b.district === DIST.PARK) continue;
        if (own.length && !own.some(a => touch(a, b))) continue;
        const d = dist((b.x0 + b.x1) / 2 * T, (b.y0 + b.y1) / 2 * T, P.px, P.py) * (this.turf[b.id] ? 1.6 : 1); // 주인 없는 곳 먼저
        if (d < bs) { bs = d; best = b; }
      }
      if (!best) break;
      taken.add(best.id); out.push(best);
    }
    return out;
  },
  expedition(n) {
    if (this.exp) { UI.toast('이미 부하들이 나가 있다'); return; }
    const list = this.expPlan(n); if (!list.length) { UI.toast('넓힐 수 있는 이웃 블록이 없다'); return; }
    const cost = list.reduce((a, b) => a + this.expCost(b), 0), P = Game.player;
    if (P.money < cost) { UI.toast(`파견 비용 $${cost.toLocaleString()}이 필요하다`); return; }
    P.money -= cost;
    this.exp = { list, t: 40 + 8 * list.length, T: 40 + 8 * list.length };
    UI.big('부하 파견', `${list.length}곳으로 출발 — ${Math.round(this.exp.t)}초 뒤 결과 (지도에 주황 테두리)`, 3, GANGS[this.mine].color);
  },
  updateExp(dt) {
    const E = this.exp; E.t -= dt;
    if (E.t > 0) return;
    this.exp = null;
    if (!this.mine) return;
    let ok = 0, fail = 0;
    for (const b of E.list) {
      if (this.turf[b.id] === this.mine) { ok++; continue; }
      if (chance(this.expChance(b))) { this.turf[b.id] = this.mine; ok++; } else fail++;
    }
    if (ok) this.addRep(20 * ok, '부하 파견');
    UI.big('부하 파견 결과', `${ok}곳 차지${fail ? ` · ${fail}곳 실패 (라이벌에게 밀렸다)` : ''} — 우리 구역 ${this.count(this.mine)}블록`, 3.5, GANGS[this.mine].color);
    Save.write();
  },
  expStatus() { const E = this.exp; return E ? `부하 파견 중: ${E.list.length}곳 · ${Math.max(0, Math.ceil(E.t))}초 뒤 결과` : null; },
  // 우리 구역에 맞닿은 블록인가 (구역 넓히기 대상). 구역이 하나도 없으면 아무 블록이나
  raidable(b) {
    const g = this.mine; if (!g || !b || !b.loop || b.airport || b.district === DIST.AIRPORT || b.district === DIST.PARK || this.turf[b.id] === g) return false;
    const own = World.blocks.filter(a => this.turf[a.id] === g);
    if (b.county && !own.some(a => a.county)) return true; // 레드 카운티: 아직 발판이 없으면 아무 마을 블록이나 첫 거점으로 칠 수 있다
    return !own.length || own.some(a => a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3 && a.y0 <= b.y1 + 3 && b.y0 <= a.y1 + 3);
  },
  // 후계 계약: 평판 1000 파트너가 보스에게 은퇴 자금을 주고 자리를 물려받는다 (보스는 공격할 수 없다)
  succeed() {
    const P = Game.player, cost = 50000;
    if (P.money < cost) { UI.toast('은퇴 자금 $50,000이 필요하다'); return; }
    P.money -= cost; this.rank = 2;
    UI.big(`${GANGS[this.mine].name}의 보스!`, '후계 계약 체결 — 이제 라이벌 조직이 너를 노린다', 3.5, GANGS[this.mine].color); Sfx.passed(); Save.write();
  },
  // ---------- (구버전) 보스 결투 ----------
  challenge() {
    const HQ = World.places[GANGS[this.mine].hq], P = Game.player;
    const b = spawnPed('gang', HQ.x + 4, HQ.y + 4); setGang(b, this.mine);
    Object.assign(b, { persistent: true, hp: 400, maxHp: 400, weapon: 'rifle', state: 'chase', nameTag: '현 보스', bossDuel: true });
    for (let i = 0; i < 2; i++) { const g = spawnPed('gang', HQ.x + rand(-6, 6), HQ.y + rand(-6, 6)); setGang(g, this.mine); Object.assign(g, { persistent: true, state: 'chase', bossDuel: true, weapon: 'smg' }); }
    this.boss = b; UI.big('보스 결투', '현 보스와 경호원을 쓰러뜨려라', 2.6, '#ff4d4d');
  },
  updateBoss() {
    const b = this.boss;
    if (Game.player.dead) { for (const p of Game.peds) if (p.bossDuel) p.remove = true; this.boss = null; UI.toast('결투에서 졌다'); return; }
    if (b.dead) {
      for (const p of Game.peds) if (p.bossDuel && !p.dead) { p.state = 'idle'; p.persistent = false; p.bossDuel = false; }
      this.boss = null; this.rank = 2;
      UI.big(`${GANGS[this.mine].name}의 보스!`, '부하 4명 호출 · 구역 수입 전부 · 전쟁 선포', 3.5, GANGS[this.mine].color); Sfx.passed(); Save.write();
    }
  },
};

// 호위 부하: 플레이어를 따라다니며 근처 적(라이벌 조직원, 플레이어를 노리는 자)을 공격
function escortAI(p, dt) {
  const P = Game.player;
  if (!Gangs.mine || p.gang !== Gangs.mine || dist2(p.x, p.y, P.px, P.py) > 150 * 150) { p.remove = true; return; }
  if (p.foe && (p.foe.dead || !Game.peds.includes(p.foe) || dist2(p.x, p.y, p.foe.x, p.foe.y) > 30 * 30)) p.foe = null;
  if (!p.foe) {
    let best = null, bd = 18 * 18;
    for (const q of Game.peds) {
      if (q.dead || q === p || q.car || Gangs.friendly(q)) continue;
      const hostile = (q.kind === 'gang' && q.gang !== Gangs.mine) || q.state === 'chase' || q.state === 'fight';
      if (!hostile) continue;
      const d2 = dist2(q.x, q.y, P.px, P.py); if (d2 < bd) { bd = d2; best = q; }
    }
    p.foe = best;
  }
  if (p.foe) { feudAI(p, dt); p.state = 'escort'; return; }
  const d = dist(p.x, p.y, P.px, P.py);
  if (P.car) { if (d > 6) pedSeek(p, P.px, P.py, 6.5, dt, 14); else { p.vx *= 0.8; p.vy *= 0.8; } }
  else if (d > 3) pedSeek(p, P.px - Math.cos(P.a) * 2, P.py - Math.sin(P.a) * 2, d > 10 ? 7 : 4.5, dt, 14);
  else { p.vx *= 0.8; p.vy *= 0.8; }
}

// ---------- 조직 본부 (가입 · 승급 · 일) ----------
for (const g of GANG_IDS) {
  PLACE_MARK['hq_' + g] = GANGS[g].color;
  SHOPS['hq_' + g] = {
    title: `${GANGS[g].name} 본부`, get sub() { return Gangs.mine === g ? '우리 조직의 본부' : Gangs.mine ? '라이벌 조직 — 조심해라' : '조직에 들어가면 같은 조직은 아군, 라이벌은 적이 된다'; },
    items: () => {
      const G = GANGS[g], out = [], mine = Gangs.mine;
      out.push({ id: 'ginfo', name: `${G.name} · 구역 ${Gangs.count(g)}블록`, price: 0, desc: `다음 대규모 전쟁까지 ${Math.max(0, Gangs.nextWar - Gangs.day)}일`, ok: () => false });
      const B = BOSS_INFO[g];
      out.push({ id: 'gmem', name: `보스: ${B.name} · 조직원 약 ${Empire.members(g)}명`, price: 0, desc: '보스는 누구도 건드릴 수 없다', ok: () => false });
      if (!mine) out.push({ id: 'gjoin', name: `${B.name}와(과) 계약서에 서명 — 조직원이 된다`, price: 0, btn: '계약', desc: '조직은 하나만 고를 수 있다 · 같은 조직은 아군, 라이벌은 적', ok: () => true, fn: () => { Gangs.join(g); Shop.close(); } });
      else if (mine !== g) out.push({ id: 'grival', name: '라이벌 조직의 본부다', price: 0, desc: `너는 ${GANGS[mine].name}의 ${RANKS[Gangs.rank]}`, ok: () => false });
      else {
        const nextNeed = Gangs.rank === 0 ? `파트너까지 평판 ${Math.max(0, 300 - Gangs.rep)}` : Gangs.rank === 1 ? (Gangs.rep >= 1000 ? '후계 계약 가능!' : `후계 계약까지 평판 ${1000 - Gangs.rep}`) : '보스';
        out.push({ id: 'grank', name: `나: ${RANKS[Gangs.rank]} · 평판 ${Gangs.rep}`, price: 0, desc: nextNeed, ok: () => false });
        out.push({ id: 'gjob1', name: '보호비 수금 — 우리 구역 가게 3곳을 돈다', price: 0, btn: '시작', desc: '평판 +40, 돈 $300씩', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('collect'); } });
        out.push({ id: 'gpick', name: '구역 넓히기 — 지도에서 블록 고르기', price: 0, btn: '지도', desc: '우리 구역에 맞닿은 블록(노란 테두리)을 누른다', ok: () => !GangJob.active, fn: openTurfPicker });
        out.push({ id: 'gjob2', name: '구역 습격 — 이웃 블록 자동 선택', price: 0, btn: '시작', desc: '라이벌 블록: 조직원 8명 처치(평판 +150, $3,000) · 주인 없는 블록: 건달 5명(평판 +80, $1,500)', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('raid'); } });
        if (Gangs.rank >= 1) out.push({ id: 'gcall', name: `부하 부르기 (${Empire.backupSize()}명)`, price: 0, btn: '호출', desc: '어디서든 PC H 길게 대신 여기서, 또는 일시정지 메뉴', ok: () => true, fn: () => { Shop.close(); Gangs.callBackup(); } });
        if (Gangs.rank === 1 && Gangs.rep >= 1000) out.push({ id: 'gboss', name: `후계 계약 — ${BOSS_INFO[g].name}의 자리를 물려받는다`, price: 50000, btn: '계약', desc: '보스가 된다: 부하 최대 10명, 구역 수입 전부, 전쟁 선포 · 대신 라이벌 암살단이 온다', ok: () => true, fn: () => { Shop.close(); Gangs.succeed(); } });
        if (Gangs.rank === 2) out.push({ id: 'gwar', name: '전면전 선포 — 상대 조직 고르기', price: 0, btn: '열기', desc: '조직 전체 대 전체 · 어디서나 O 키로도 연다', ok: () => true, fn: () => { Shop.open('gang'); } });
        out.push({ id: 'gleave', name: '조직 탈퇴', price: 0, btn: '탈퇴', desc: '계급과 평판을 잃는다', ok: () => true, fn: () => { Gangs.leave(); Shop.close(); } });
      }
      return out;
    },
  };
}

// ---------- 조직 일 ----------
const GangJob = {
  active: null,
  start(kind, pickBlk) {
    const P = Game.player, g = Gangs.mine;
    if (kind === 'collect') {
      const own = World.blocks.filter(b => Gangs.turf[b.id] === g);
      if (!own.length) { UI.toast('우리 구역이 없다'); return; }
      // 우리 구역 안의 실제 가게(가게·사업체 건물) 앞 인도 → 플레이어에게서 가까운 순서로 3곳 (서로 40m 이상 떨어지게)
      const cands = [];
      for (const b of own) for (const L of b.lots || []) {
        if (!L.b || !['mid', 'shop', 'tower', 'biz', 'burger', 'mart', 'pharmacy', 'clothes', 'gym', 'ammu'].includes(L.b.kind)) continue;
        const [x, y] = loopPoint(b.loop, loopParam(b.loop, (L.x0 + L.x1 + 1) / 2 * T, (L.y0 + L.y1 + 1) / 2 * T));
        cands.push({ x, y, name: L.b.label || (L.b.kind === 'tower' ? '빌딩 상가' : '동네 가게') });
      }
      if (!cands.length) for (const b of own) { const [x, y] = loopPoint(b.loop, rand(0, b.loop.P)); cands.push({ x, y, name: '동네 가게' }); }
      const stops = []; let cx = P.px, cy = P.py;
      for (let i = 0; i < 3 && cands.length; i++) {
        cands.sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy));
        const s = cands.find(c => stops.every(o => dist(o.x, o.y, c.x, c.y) > 40)) || cands[0];
        stops.push(s); cands.splice(cands.indexOf(s), 1); cx = s.x; cy = s.y;
      }
      this.active = { kind, stops, t: 0, total: stops.length };
      UI.big('보호비 수금', `우리 구역 가게 ${stops.length}곳 — 화살표·지도의 표시로 가서 가게 앞에 멈춰라`, 3, GANGS[g].color);
    } else {
      const pr = Gangs.borderPairs().filter(([a, b]) => Gangs.turf[a.id] === g || Gangs.turf[b.id] === g);
      let blk, rival, neutral = false;
      if (pickBlk) { // 지도에서 고른 블록
        blk = pickBlk; rival = Gangs.turf[blk.id];
        if (!rival) { rival = pick(GANG_IDS.filter(x => x !== g)); neutral = true; }
      } else if (pr.length) { const [a, b] = pick(pr); blk = Gangs.turf[a.id] === g ? b : a; rival = Gangs.turf[blk.id]; }
      else { // 이웃에 라이벌이 없으면 우리 구역에 붙은 주인 없는 블록을 떠돌이 건달에게서 빼앗는다
        blk = Gangs.neutralNeighbor(g);
        if (!blk) { UI.toast('넓힐 수 있는 이웃 블록이 없다'); return; }
        rival = pick(GANG_IDS.filter(x => x !== g)); neutral = true;
      }
      const cx = (blk.x0 + blk.x1 + 1) / 2 * T, cy = (blk.y0 + blk.y1 + 1) / 2 * T;
      this.active = { kind, blk, rival, neutral, x: cx, y: cy, spawned: false, foes: [], t: 0 };
      UI.toast(neutral ? '구역 넓히기: 주인 없는 이웃 블록의 건달을 몰아내라 (지도·화살표 표시)' : `구역 습격: ${GANGS[rival].name} 구역으로 가라`);
    }
  },
  update(dt) {
    const J = this.active; if (!J) return;
    const P = Game.player;
    if (P.dead || !Gangs.mine) { this.active = null; UI.objective(''); return; }
    J.t += dt;
    if (J.kind === 'collect') {
      const s = J.stops[0];
      const d = Math.round(dist(P.px, P.py, s.x, s.y));
      UI.objective(`보호비 수금 ${J.total - J.stops.length + 1}/${J.total}: ${s.name}까지 ${d}m — 가게 앞(노란 원)에 멈춰라`);
      if (d < 7 && (!P.car || P.car.speed < 4)) {
        const done = J.stops.shift(); P.money += 300; Sfx.cash(); Effects.text(P.px, P.py - 1, '+$300');
        UI.toast(`${done.name} 주인이 보호비를 냈다 +$300${J.stops.length ? ` — 다음 가게로 (남은 ${J.stops.length}곳)` : ''}`);
        if (!J.stops.length) { Gangs.addRep(40, '보호비 수금'); this.active = null; UI.objective(''); Save.write(); }
      }
    } else {
      if (!J.spawned && dist(P.px, P.py, J.x, J.y) < 70) {
        J.spawned = true;
        for (let i = 0; i < (J.neutral ? 5 : 8); i++) { const [x, y] = loopPoint(J.blk.loop, rand(0, J.blk.loop.P)); const q = spawnPed('gang', x, y); setGang(q, J.rival); Object.assign(q, { persistent: true, state: 'chase', raid: true, weapon: pick(['smg', 'pistol', 'shotgun', 'rifle']) }); J.foes.push(q); }
        UI.big('습격 개시!', J.neutral ? '떠돌이 건달 5명' : `${GANGS[J.rival].name} 조직원 8명`, 2, '#ff4d4d');
      }
      const left = J.foes.filter(q => !q.dead).length;
      UI.objective(J.spawned ? `${J.neutral ? '건달' : '라이벌 조직원'} 처치: 남은 ${left}명` : J.neutral ? '주인 없는 이웃 블록으로 가라' : `${GANGS[J.rival].name} 구역으로 가라`);
      if (J.spawned && !left) {
        Gangs.turf[J.blk.id] = Gangs.mine;
        const extra = World.blocks.filter(b => !Gangs.turf[b.id] && b.loop && !b.airport && b.district !== DIST.PARK && b.district !== DIST.AIRPORT && b.x0 <= J.blk.x1 + 3 && J.blk.x0 <= b.x1 + 3 && b.y0 <= J.blk.y1 + 3 && J.blk.y0 <= b.y1 + 3).slice(0, 2);
        for (const b of extra) Gangs.turf[b.id] = Gangs.mine; // 소문이 나서 옆의 주인 없는 블록도 따라온다
        if (extra.length) UI.toast(`소문이 퍼져 옆의 주인 없는 블록 ${extra.length}곳도 우리 구역이 됐다`);
        Gangs.addRep(J.neutral ? 80 : 150, J.neutral ? '구역 넓히기 성공' : '구역 습격 성공'); P.money += J.neutral ? 1500 : 3000; Sfx.passed();
        UI.big('구역 확보!', `${GANGS[Gangs.mine].name} 구역 ${Gangs.count(Gangs.mine)}블록`, 3, GANGS[Gangs.mine].color);
        for (const q of J.foes) q.persistent = false;
        this.active = null; UI.objective(''); Save.write();
      }
    }
  },
  targets() {
    const J = this.active; if (!J) return [];
    if (J.kind === 'collect') return J.stops.map((s, i) => ({ x: s.x, y: s.y, c: i ? '#b8a15a' : '#f2c14e', big: !i }));
    return [{ x: J.x, y: J.y, c: '#ff4d4d', big: true }];
  },
};

// ---------- 조직 관리 (어디서나 O 키 / 일시정지 메뉴) ----------
function openTurfPicker() {
  Shop.close(); Game.pickTurf = true; Game.showTurf = true; Game.state = 'map';
  if (MapView.cx === null) MapView.reset(); MapView.z = Math.max(MapView.z, 2.5); MapView.center(Game.player.px, Game.player.py);
}
SHOPS.gang = {
  title: '조직 관리', get sub() { return Gangs.mine ? `${GANGS[Gangs.mine].name} · ${RANKS[Gangs.rank]} · 평판 ${Gangs.rep} — 어디서나 O 키로 연다` : '아직 조직이 없다'; },
  items: () => {
    const g = Gangs.mine, out = [];
    if (!g) {
      out.push({ id: 'gnone', name: '조직에 들어가거나 직접 세워라', price: 0, desc: '조직 본부(지도의 청·파·철·코 표시)에서 가입 · 은신처에서 $25,000으로 창설', ok: () => false });
      return out;
    }
    out.push({ id: 'ginfo2', name: `${GANGS[g].name} · 구역 ${Gangs.count(g)}블록 · 조직원 ${Empire.members(g)}명`, price: 0, desc: `다음 자동 전쟁까지 ${Math.max(0, Gangs.nextWar - Gangs.day)}일`, ok: () => false });
    const W = Gangs.war;
    if (W && Gangs.ours()) {
      out.push({ id: 'gwarinfo', name: `전면전 중: ${GANGS[W.A].name} ${W.pow[W.A]} vs ${GANGS[W.D].name} ${W.pow[W.D]}`, price: 0, desc: `전선 ${W.fronts} · 화살표를 따라 전선으로 가라`, ok: () => false });
      if (Gangs.rank === 2) out.push({ id: 'gtruce', name: '휴전 협상', price: 20000, btn: '휴전', desc: '전쟁을 멈춘다 · 지금까지 뺏고 뺏긴 블록은 그대로 · 평판 -50', ok: () => true, fn: () => { Shop.close(); Gangs.truce(); } });
    }
    if (GangJob.active) out.push({ id: 'gstop', name: '진행 중인 조직 활동 그만두기', price: 0, btn: '그만두기', desc: GangJob.active.kind === 'collect' ? '보호비 수금' : '구역 습격', ok: () => true, fn: () => { for (const q of GangJob.active.foes || []) q.persistent = false; GangJob.active = null; UI.objective(''); Shop.close(); } });
    out.push({ id: 'gpick', name: '구역 넓히기 — 지도에서 블록 고르기', price: 0, btn: '지도', desc: '우리 구역에 맞닿은 블록(노란 테두리)을 누르면 습격 시작 · 라이벌 8명 / 주인 없는 블록 5명', ok: () => !GangJob.active, fn: openTurfPicker });
    if (Gangs.rank >= 1) for (const n of [3, 6, 12]) {
      const plan = Gangs.expPlan(n), cost = plan.reduce((a, b) => a + Gangs.expCost(b), 0), riv = plan.filter(b => Gangs.turf[b.id]).length;
      out.push({ id: 'gexp' + n, name: `부하 파견 — 이웃 블록 ${plan.length}곳 한꺼번에 (나는 안 가도 된다)`, price: cost, btn: '파견', desc: plan.length ? `주인 없는 곳 ${plan.length - riv} (성공 92%) · 라이벌 ${riv}${riv ? ` (성공 ${Math.round(Gangs.expChance(plan.find(b => Gangs.turf[b.id])) * 100)}% 안팎)` : ''} · ${40 + 8 * plan.length}초 뒤 결과` : '넓힐 수 있는 블록이 없다', ok: () => !Gangs.exp && plan.length > 0, fn: () => { Shop.close(); Gangs.expedition(n); } });
    }
    else out.push({ id: 'gexpno', name: '부하 파견은 파트너부터', price: 0, desc: '평판 300이면 파트너 · 조직을 직접 세우면 처음부터 보스', ok: () => false });
    if (Gangs.exp) out.push({ id: 'gexpst', name: Gangs.expStatus(), price: 0, desc: '결과가 나오면 알려 준다', ok: () => false });
    out.push({ id: 'graid', name: '구역 습격 — 가까운 이웃 블록 자동 선택', price: 0, btn: '시작', desc: '라이벌 블록이 있으면 그쪽, 없으면 주인 없는 블록', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('raid'); } });
    out.push({ id: 'gcol', name: '보호비 수금 — 우리 구역 가게 3곳', price: 0, btn: '시작', desc: '평판 +40, 가게마다 $300', ok: () => !GangJob.active, fn: () => { Shop.close(); GangJob.start('collect'); } });
    if (Gangs.rank >= 1) out.push({ id: 'gcall2', name: `부하 부르기 (${Empire.backupSize()}명)`, price: 0, btn: '호출', desc: 'K 키로도 부른다', ok: () => true, fn: () => { Shop.close(); Gangs.callBackup(); } });
    if (Gangs.rank === 2) for (const r of GANG_IDS) {
      if (r === g || !Gangs.count(r)) continue;
      const touch = Gangs.pairsBetween(g, r).length;
      out.push({ id: 'gwar_' + r, name: `전면전 선포 — ${GANGS[r].name} (구역 ${Gangs.count(r)} · 조직원 ${Empire.members(r)}명)`, price: 0, btn: '선포', desc: touch ? `맞닿은 전선 ${touch}곳 · 한쪽이 궤멸할 때까지 싸운다 · 이기면 상대 구역 전부 + $50,000` : '맞닿은 구역이 없다 — 먼저 구역을 넓혀 붙어라', ok: () => !Gangs.war && touch > 0, fn: () => { Shop.close(); Gangs.declareWar(g, r); } });
    }
    else out.push({ id: 'gwarno', name: '전면전 선포는 보스만 할 수 있다', price: 0, desc: '파트너 평판 1000 → 본부에서 후계 계약 · 또는 은신처에서 조직 창설', ok: () => false });
    return out;
  },
};

// 전체 지도 위 구역 그리기
function drawTurfOverlay(c, ox, oy, k, bx = ox, by = oy) {
  for (const b of World.blocks) {
    const g = Gangs.turf[b.id]; if (!g) continue;
    c.fillStyle = GANGS[g].color; c.globalAlpha = 0.42;
    c.fillRect(ox + b.x0 * T * k, oy + b.y0 * T * k, (b.x1 - b.x0 + 1) * T * k, (b.y1 - b.y0 + 1) * T * k);
    c.globalAlpha = 1;
  }
  if (Gangs.exp) { c.strokeStyle = '#ff9f1c'; c.lineWidth = 2.5; for (const b of Gangs.exp.list) c.strokeRect(ox + b.x0 * T * k, oy + b.y0 * T * k, (b.x1 - b.x0 + 1) * T * k, (b.y1 - b.y0 + 1) * T * k); }
  if (Gangs.war) { const w = Gangs.war; c.strokeStyle = '#ff3b3b'; c.lineWidth = 3; c.strokeRect(ox + w.blk.x0 * T * k, oy + w.blk.y0 * T * k, (w.blk.x1 - w.blk.x0 + 1) * T * k, (w.blk.y1 - w.blk.y0 + 1) * T * k); }
  let y = by + 10; ox = bx;
  c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(ox + 8, y - 4, 280, 20 * GANG_IDS.length + (Gangs.mine ? 26 : 8));
  for (const g of GANG_IDS) {
    c.fillStyle = GANGS[g].color; c.fillRect(ox + 16, y + 3, 12, 12);
    txt(c, `${GANGS[g].name}  ${Gangs.count(g)}블록 · ${Empire.members(g)}명${Gangs.mine === g ? '  ← 내 조직' : ''}`, ox + 34, y + 14, `600 13px ${FONT_KR}`, '#fff', null);
    y += 20;
  }
  if (Gangs.mine) txt(c, `나: ${RANKS[Gangs.rank]} · 평판 ${Gangs.rep} · 전쟁까지 ${Math.max(0, Gangs.nextWar - Gangs.day)}일`, ox + 16, y + 12, `600 12px ${FONT_KR}`, '#ffd166', null);
}
