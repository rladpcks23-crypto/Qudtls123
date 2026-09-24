'use strict';
/* =====================================================================
 * tycoon.js — 큰돈을 굴리고 쓰는 곳
 *
 *  · 네온 홀딩스(지도 '홀'): 상장사 지분을 모아 51%면 경영권 인수 → 1분 배당 + 관련 사업체 수입 +15%.
 *    라이벌 재벌 '강 회장'도 지분을 사들인다. 그가 먼저 51%를 넘기면 그 회사는 뺏긴다(35% 이상이면 적대적 인수 가능)
 *  · 하버 개발(지도 '개'): 빈 주차장 필지에 아파트·오피스·초고층을 올린다. 공사가 끝나면 지도에 진짜 건물이 서고 임대 수입이 들어온다
 *  · 사업체 경영 이벤트: 파업·경쟁 가게·세무조사·인플루언서·보호비 — 두 가지 중 골라 대응 (고르지 않으면 20초 뒤 2번)
 *  · 힐탑 저택(지도 '저'): 쉬기·금고·경비원·헬기장, 럭셔리 수집품(수입 +2%씩), 금고를 노리는 강도 습격
 *  · 시청: 시장 선거 출마(선거 자금 + 시민 지지) → 시장이 되면 사업세 인하·치안 예산·조직 단속·판공비
 *  · 카지노 VIP: 현금 $1,000만 이상이거나 시장이면 베팅 한도 $500만
 * ===================================================================== */

const TOTAL_SHARES = 100000;
const Tycoon = {
  rival: {}, acq: {}, mods: {}, t: 0, rivT: 60, evT: 200, ev: null,
  vault: 0, mansion: false, guards: false, heli: false, coll: {}, raid: null, raidT: 600,
  mayor: false, elect: null, mayorPerks: {}, crackDay: -1,
  save() { return { rival: this.rival, acq: this.acq, vault: this.vault, mansion: this.mansion, guards: this.guards, heli: this.heli, coll: this.coll, mayor: this.mayor, elect: this.elect, mayorPerks: this.mayorPerks, crackDay: this.crackDay, dev: Dev.save() }; },
  load(o) {
    o = o || {};
    this.rival = o.rival || {}; for (const c of COMPANIES) if (this.rival[c.id] === undefined) this.rival[c.id] = Math.round(TOTAL_SHARES * (0.05 + hash2(c.id.length, c.p) * 0.2));
    this.acq = o.acq || {}; this.mods = {}; this.vault = o.vault || 0; this.mansion = !!o.mansion; this.guards = !!o.guards; this.heli = !!o.heli; this.coll = o.coll || {};
    this.mayor = !!o.mayor; this.elect = o.elect || null; this.mayorPerks = o.mayorPerks || {}; this.crackDay = o.crackDay ?? -1; this.raid = null; this.ev = null; closeBizEvent();
    Dev.load(o.dev);
  },
  stake(c) { return (Finance.shares[c.id] || 0) / TOTAL_SHARES; },
  // 사업체 수입 배율: 경영 이벤트 · 인수 회사 · 수집품 · 시장 사업세
  bizMul(k) {
    let m = 1;
    const md = this.mods[k]; if (md && md.until > Game.time) m *= md.mul; else if (md) delete this.mods[k];
    for (const c of COMPANIES) if (this.acq[c.id] === 'me' && c.biz === k) m *= 1.15;
    m *= 1 + 0.02 * Object.keys(this.coll).length;
    if (this.mayor && this.mayorPerks.tax) m *= 1.25;
    return m;
  },
  dividends() { let s = 0; COMPANIES.forEach((c, i) => { if (this.acq[c.id] === 'me') s += Finance.prices[i] * TOTAL_SHARES * 0.0008; }); return Math.round(s); },
  update(dt) {
    const P = Game.player;
    // 1분마다: 배당 · 개발 임대 · 시장 판공비
    this.t += dt;
    if (this.t >= 60) {
      this.t -= 60;
      const d = this.dividends(), r = Dev.rent(), s = this.mayor ? 20000 : 0, tot = d + r + s;
      if (tot > 0) { P.money += tot; UI.toast(`지주·개발 수입 +$${tot.toLocaleString()}${d ? ` (배당 $${d.toLocaleString()})` : ''}${r ? ` (임대 $${r.toLocaleString()})` : ''}${s ? ' (판공비)' : ''}`); }
    }
    // 라이벌 재벌이 지분을 사들인다
    this.rivT -= dt;
    if (this.rivT <= 0) {
      this.rivT = rand(70, 130);
      const c = pick(COMPANIES.filter(q => !this.acq[q.id])); if (c) {
        const add = Math.round(TOTAL_SHARES * rand(0.01, 0.04) * (this.stake(c) > 0.3 ? 1.8 : 1));
        this.rival[c.id] = Math.min(TOTAL_SHARES - (Finance.shares[c.id] || 0), this.rival[c.id] + add);
        if (this.rival[c.id] / TOTAL_SHARES > 0.5) { this.acq[c.id] = 'rival'; Msgs.add('경제 뉴스', `강 회장, ${c.name} 경영권 인수!`); }
        else if (this.stake(c) > 0.2 && add > 0) Msgs.add('경제 뉴스', `강 회장이 ${c.name} 지분을 늘렸다 (${Math.round(this.rival[c.id] / TOTAL_SHARES * 100)}%)`);
      }
    }
    Dev.update(dt);
    this.updateBizEvent(dt);
    this.updateRaid(dt);
    // 선거
    if (this.elect && Gangs.day >= this.elect.day) this.election();
  },
  buyStake(c, frac) {
    const i = COMPANIES.indexOf(c), n = Math.round(TOTAL_SHARES * frac), free = TOTAL_SHARES - (Finance.shares[c.id] || 0) - this.rival[c.id];
    if (free <= 0) { UI.toast('시장에 남은 주식이 없다 — 적대적 인수를 노려라'); return; }
    const k = Math.min(n, free), cost = Math.round(Finance.prices[i] * k * 1.08), P = Game.player;
    if (P.money < cost) { UI.toast(`$${cost.toLocaleString()}이 필요하다`); return; }
    P.money -= cost; Finance.shares[c.id] = (Finance.shares[c.id] || 0) + k; Finance.prices[i] *= 1 + 0.4 * k / TOTAL_SHARES; Sfx.cash();
    UI.toast(`${c.name} 지분 ${Math.round(this.stake(c) * 100)}% 보유`);
    if (this.stake(c) > 0.5 && !this.acq[c.id]) this.takeover(c);
  },
  takeover(c) { this.acq[c.id] = 'me'; Sfx.passed(); UI.big('경영권 인수!', `${c.name} — 1분 배당 + 관련 사업체 수입 +15%`, 3.2, '#ffd166'); Save.write(); },
  hostile(c) {
    const i = COMPANIES.indexOf(c), n = Math.round(TOTAL_SHARES * 0.2), cost = Math.round(Finance.prices[i] * n * 1.6), P = Game.player;
    if (P.money < cost) { UI.toast(`$${cost.toLocaleString()}이 필요하다`); return; }
    P.money -= cost; this.rival[c.id] = Math.max(0, this.rival[c.id] - n); Finance.shares[c.id] = (Finance.shares[c.id] || 0) + n; Sfx.cash();
    if (this.stake(c) > 0.5) this.takeover(c); else { this.acq[c.id] = this.rival[c.id] / TOTAL_SHARES > 0.5 ? 'rival' : null; UI.toast(`${c.name} 지분 ${Math.round(this.stake(c) * 100)}%`); }
  },

  // ---------- 사업체 경영 이벤트 ----------
  updateBizEvent(dt) {
    if (this.ev) { this.ev.t -= dt; if (this.ev.t <= 0) this.resolve(1); return; }
    this.evT -= dt; if (this.evT > 0 || Game.state !== 'play' || Missions.active) return;
    this.evT = rand(240, 420);
    const own = Object.keys(Biz.owned()).filter(k => BUSINESSES[k]); if (!own.length) return;
    const k = pick(own), B = BUSINESSES[k], pm = Math.max(1000, Biz.perMin(k));
    const E = pick([
      { title: `${B.name}: 직원 파업`, q: '직원들이 임금 인상을 요구하며 파업했다.', a: [`임금 인상 ($${(pm * 3).toLocaleString()})`, () => this.pay(pm * 3)], b: ['거절한다 (8분간 수입 -60%)', () => this.mod(k, 0.4, 480)] },
      { title: `${B.name}: 경쟁 가게 등장`, q: '길 건너에 똑같은 가게가 생겼다.', a: [`광고 공세 ($${(pm * 4).toLocaleString()}, 10분간 수입 +25%)`, () => { if (this.pay(pm * 4)) this.mod(k, 1.25, 600); }], b: ['무시한다 (10분간 수입 -30%)', () => this.mod(k, 0.7, 600)] },
      { title: `${B.name}: 세무조사`, q: '국세청이 장부를 보자고 한다.', a: [`성실하게 낸다 ($${(pm * 6).toLocaleString()})`, () => this.pay(pm * 6)], b: [`뇌물을 준다 ($${(pm * 2).toLocaleString()}, 들키면 수배·벌금)`, () => { if (!this.pay(pm * 2)) return; if (chance(0.45)) { Wanted.set(Math.max(2, Wanted.stars)); this.pay(pm * 10, true); UI.toast('뇌물이 들통났다! 수배 + 벌금'); } else UI.toast('조사관이 눈감아 줬다'); }] },
      { title: `${B.name}: 인플루언서 방문`, q: '유명 인플루언서가 가게를 찍고 싶다고 한다.', a: [`초대한다 ($${(pm * 2).toLocaleString()}, 15분간 수입 +50%)`, () => { if (this.pay(pm * 2)) this.mod(k, 1.5, 900); }], b: ['거절한다', () => { }] },
      { title: `${B.name}: 보호비 요구`, q: '동네 건달들이 보호비를 내라고 한다.', a: [`낸다 ($${(pm * 3).toLocaleString()})`, () => this.pay(pm * 3)], b: ['거절한다 (건달들이 가게를 습격한다)', () => { this.mod(k, 0.6, 300); const q = World.places[k]; if (q) { for (let n = 0; n < 4; n++) { const w = sidewalkNear(q.x + rand(-8, 8), q.y + rand(-8, 8)); const g = spawnPed('gang', w.x, w.y); setGang(g, pick(GANG_IDS.filter(x => x !== Gangs.mine))); g.state = 'idle'; g.homeX = q.x; g.homeY = q.y; } UI.toast(`${B.name} 앞에 건달들이 몰려왔다 — 쫓아내면 수입이 돌아온다`); } }] },
    ]);
    this.ev = { ...E, k, t: 20 }; openBizEvent(this.ev);
  },
  resolve(i) { const E = this.ev; if (!E) return; this.ev = null; closeBizEvent(); (i === 0 ? E.a : E.b)[1](); },
  pay(n, force) { const P = Game.player; n = Math.round(n); if (P.money < n && !force) { UI.toast('돈이 부족하다'); return false; } P.money -= n; Sfx.cash(); return true; },
  mod(k, mul, sec) { this.mods[k] = { mul, until: Game.time + sec }; UI.toast(`${BUSINESSES[k].name} 수입 ×${mul} (${Math.round(sec / 60)}분)`); },

  // ---------- 저택 금고 습격 ----------
  updateRaid(dt) {
    const P = Game.player, M = World.places.mansion;
    if (!this.raid) {
      if (!this.mansion || this.vault < 5e6 || !M) return;
      this.raidT -= dt; if (this.raidT > 0 || Missions.active || Game.state !== 'play') return;
      this.raidT = rand(600, 900);
      this.raid = { t: 90, men: [] };
      Msgs.add('저택 경비', `금고를 노리는 강도가 들이닥쳤습니다! 90초 안에 와 주세요!${this.guards ? ' (경비원이 버티는 중)' : ''}`);
      UI.big('저택 습격!', '90초 안에 저택으로 가서 강도를 막아라', 3, '#ff4d4d');
      return;
    }
    const R = this.raid; R.t -= dt;
    if (!R.men.length && dist(P.px, P.py, M.x, M.y) < 120) { for (let k = 0; k < 6; k++) { const w = sidewalkNear(M.x + rand(-10, 10), M.y + rand(-10, 10)); const g = spawnPed('gang', w.x, w.y); setGang(g, 'lotus'); Object.assign(g, { persistent: true, state: 'chase', weapon: pick(['smg', 'rifle', 'shotgun']), hp: 120, maxHp: 120, raid: true }); R.men.push(g); } }
    if (R.men.length && R.men.every(g => g.dead)) { this.raid = null; P.money += 50000; UI.big('금고를 지켰다', '+$50,000 사례금', 2.6, '#7ae68f'); return; }
    if (R.t <= 0) { const loss = Math.round(this.vault * (this.guards ? 0.05 : 0.2)); this.vault -= loss; for (const g of R.men) g.persistent = false; this.raid = null; UI.big('금고를 털렸다', `-$${loss.toLocaleString()}`, 3, '#ff4d4d'); Save.write(); }
  },
  raidTargets() { const R = this.raid, M = World.places.mansion; if (!R || !M) return []; return R.men.length ? R.men.filter(g => !g.dead).map(g => ({ x: g.x, y: g.y, c: '#ff4d4d' })) : [{ x: M.x, y: M.y, c: '#ff4d4d', big: true }]; },

  // ---------- 선거 ----------
  election() {
    const E = this.elect; this.elect = null;
    const ch = clamp(0.2 + E.fund / 1.2e8 + (Empire.support.civ + Empire.support.off) / 400, 0.05, 0.92);
    if (chance(ch)) { this.mayor = true; Sfx.passed(); UI.big('시장 당선!', '시청에서 정책을 정할 수 있다 · 1분 판공비 $20,000', 4, '#ffd166'); Msgs.add('네온 뉴스', '네온 하버 새 시장 당선! 재계 출신 첫 시장'); }
    else { Sfx.failed(); UI.big('낙선', `당선 확률 ${Math.round(ch * 100)}%였다 — 지지도를 올리고 다시 도전하자`, 3.5, '#ff4d4d'); }
    Save.write();
  },
};
SaveExt.mods.tycoon = Tycoon;

// Biz.perMin에 배율을 곱한다
{ const o = Biz.perMin.bind(Biz); Biz.perMin = k => Math.round(o(k) * Tycoon.bizMul(k)); }
// 카지노 VIP
{ const o = Casino.limit.bind(Casino); Casino.limit = () => (Game.player && (Game.player.money >= 1e7 || Tycoon.mayor)) ? Math.max(5e6, o()) : o(); }
// 시장 치안 예산: 수배가 더 빨리 풀린다
{ const o = Empire.update ? Empire.update.bind(Empire) : null; if (o) Empire.update = dt => { o(dt); if (Tycoon.mayor && Tycoon.mayorPerks.police && Wanted.stars > 0 && Wanted.evadeT > 0) Wanted.evadeT += dt * 0.8; }; }

// 경영 이벤트 창 (게임을 멈추지 않는다)
function openBizEvent(E) {
  closeBizEvent();
  const box = document.createElement('div'); box.id = 'biz-event';
  box.style.cssText = 'position:fixed;left:24px;bottom:220px;z-index:65;width:340px;background:rgba(12,14,20,.94);border:1px solid #ffd166;border-radius:12px;padding:12px 14px;color:#fff;font-family:inherit;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  box.innerHTML = `<b style="color:#ffd166;font-size:15px">📈 ${E.title}</b><div style="font-size:13px;color:#cfd6e0;margin:6px 0 10px">${E.q}</div>`;
  [E.a, E.b].forEach((o, i) => { const b = document.createElement('button'); b.className = 'btn small'; b.style.cssText = 'display:block;width:100%;margin-top:6px;text-align:left'; b.textContent = `${i + 1}) ${o[0]}`; b.onclick = () => Tycoon.resolve(i); box.append(b); });
  const t = document.createElement('div'); t.style.cssText = 'font-size:11px;color:#8b93a1;margin-top:8px'; t.textContent = '20초 안에 고르지 않으면 2번'; box.append(t);
  document.body.append(box);
}
function closeBizEvent() { const b = document.getElementById('biz-event'); if (b) b.remove(); }

// ---------- 부동산 개발 ----------
const DEV_KINDS = {
  apt: { name: '아파트 단지', h: 22, cost: 2e6, sec: 180, rent: 18000, color: '#c9b79c', kind: 'mid' },
  office: { name: '오피스 빌딩', h: 42, cost: 6e6, sec: 300, rent: 60000, color: '#6f7f99', kind: 'tower' },
  sky: { name: '초고층 타워', h: 95, cost: 1.8e7, sec: 480, rent: 200000, color: '#4d6a8c', kind: 'tower', big: true },
};
const Dev = {
  list: [], cand: null,
  save() { return this.list.map(p => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, kind: p.kind, left: p.left, done: p.done })); },
  load(a) { this.list = []; this.cand = null; for (const p of a || []) { this.list.push({ ...p }); if (p.done) raiseBuilding(p); } },
  rent() { return this.list.filter(p => p.done).reduce((a, p) => a + DEV_KINDS[p.kind].rent, 0); },
  // 빈 주차장 필지 (길가, 3×3 이상)
  lots() {
    if (this.cand) return this.cand;
    const out = [];
    for (const b of World.blocks) for (const L of b.lots || []) {
      if (L.kind !== 'lot' || L.x1 - L.x0 < 2 || L.y1 - L.y0 < 2) continue;
      let ok = true; for (let y = L.y0; y <= L.y1 && ok; y++) for (let x = L.x0; x <= L.x1; x++) if (World.tiles[tIdx(x, y)] !== TL.LOT) { ok = false; break; }
      if (!ok || Object.values(World.places).some(q => q && q.x >= L.x0 * T - 6 && q.x <= (L.x1 + 1) * T + 6 && q.y >= L.y0 * T - 6 && q.y <= (L.y1 + 1) * T + 6)) continue;
      out.push({ x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, dist: b.district, cx: (L.x0 + L.x1 + 1) / 2 * T, cy: (L.y0 + L.y1 + 1) / 2 * T });
    }
    return (this.cand = out);
  },
  price(L) { return L.dist === DIST.DOWNTOWN ? 1.5 : L.dist === DIST.MIDTOWN ? 1.2 : 1; },
  start(L, kind) {
    const K = DEV_KINDS[kind], cost = Math.round(K.cost * this.price(L)), P = Game.player;
    if (K.big && (L.x1 - L.x0 < 3 || L.y1 - L.y0 < 3)) { UI.toast('초고층은 4×4 이상 필지에만 지을 수 있다'); return; }
    if (P.money < cost) { UI.toast(`$${cost.toLocaleString()}이 필요하다`); return; }
    if (this.list.some(p => p.x0 === L.x0 && p.y0 === L.y0)) { UI.toast('이미 개발 중인 필지다'); return; }
    P.money -= cost; Sfx.cash();
    this.list.push({ x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, kind, left: K.sec, done: false });
    UI.big('착공!', `${K.name} — ${Math.round(K.sec / 60)}분 뒤 완공 · 1분 임대 $${K.rent.toLocaleString()}`, 3, '#ffd166'); Save.write();
  },
  update(dt) {
    for (const p of this.list) if (!p.done) { p.left -= dt; if (p.left <= 0) { p.done = true; raiseBuilding(p); Sfx.passed(); UI.big('완공!', `${DEV_KINDS[p.kind].name}이(가) 도시에 섰다`, 3, '#ffd166'); Msgs.add('하버 개발', `${DEV_KINDS[p.kind].name} 준공식을 마쳤습니다.`); Save.write(); } }
  },
  props() { // 공사 중: 크레인 + 가림막
    const out = [];
    for (const p of this.list) if (!p.done) {
      const cx = (p.x0 + p.x1 + 1) / 2 * T, cy = (p.y0 + p.y1 + 1) / 2 * T, w = (p.x1 - p.x0 + 1) * T, d = (p.y1 - p.y0 + 1) * T, prog = 1 - p.left / DEV_KINDS[p.kind].sec, H = DEV_KINDS[p.kind].h * prog;
      out.push({ x: cx, y: cy, w: w - 1, d: d - 1, h: Math.max(1, H), c: '#9aa3ad', stripe: '#c9a43a' });
      out.push({ x: cx + w / 2 - 1.5, y: cy - d / 2 + 1.5, w: 1.2, d: 1.2, h: DEV_KINDS[p.kind].h + 12, c: '#f2c14e', no2d: true });
      out.push({ x: cx + w / 2 - 1.5 - 8, y: cy - d / 2 + 1.5, w: 20, d: 1, h: 1, z: DEV_KINDS[p.kind].h + 12, c: '#f2c14e', no2d: true });
    }
    return out;
  },
};
Props.providers.push(() => Dev.props());
// 필지를 건물로 바꾼다 (2D·3D·미니맵·충돌 모두)
function raiseBuilding(p) {
  const K = DEV_KINDS[p.kind], W = World;
  if (W.buildings.some(b => b.dev && b.x0 === p.x0 && b.y0 === p.y0)) return; // 같은 세계에서 저장을 다시 불러와도 두 번 짓지 않는다
  const b = { id: W.buildings.length, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, h: K.h, kind: K.kind, color: K.color, seed: hash2(p.x0, p.y0), lit: 0.6, dev: true, label: K.name };
  W.buildings.push(b);
  for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) { const i = tIdx(x, y); W.tiles[i] = TL.BUILD; if (W.bIndex) W.bIndex[i] = b.id; }
  W.parking = W.parking.filter(q => !(q.x >= p.x0 * T && q.x <= (p.x1 + 1) * T && q.y >= p.y0 * T && q.y <= (p.y1 + 1) * T));
  for (const c of Game.cars || []) if (!c.persistent && c.x >= p.x0 * T && c.x <= (p.x1 + 1) * T && c.y >= p.y0 * T && c.y <= (p.y1 + 1) * T) c.remove = true;
  if (W.mini) { const g = W.mini.getContext('2d'), s = W.mini.width / MW; g.fillStyle = MINI_COL[TL.BUILD]; g.fillRect(p.x0 * s, p.y0 * s, (p.x1 - p.x0 + 1) * s, (p.y1 - p.y0 + 1) * s); }
  if (View3D.bucket) { const CS = View3D.CS, cx = clamp(Math.floor((p.x0 + p.x1 + 1) / 2 * T / CS), 0, View3D.NCX - 1), cy = clamp(Math.floor((p.y0 + p.y1 + 1) / 2 * T / CS), 0, View3D.NCY - 1), k = cx + cy * View3D.NCX; View3D.bucket[k].b.push(b); const ch = View3D.chunks.get(k); if (ch) { View3D.disposeChunk(ch); View3D.chunks.delete(k); } }
  if (Dev.cand) Dev.cand = Dev.cand.filter(L => !(L.x0 === p.x0 && L.y0 === p.y0));
}

// ---------- 장소 · 메뉴 ----------
const LUXURY = [
  { id: 'goldhyper', name: '네온 골드 하이퍼 (한정판)', price: 8e6, give: () => { const c = Dealer.deliver('hyper', World.places.mansion || World.places.mygarage, '#d4af37'); Fleet.add(c, '#d4af37'); } },
  { id: 'supers', name: '슈퍼카 컬렉션 5대', price: 1.2e7, give: () => { for (const col of ['#e0262b', '#1f6feb', '#f2f2f2', '#111', '#ffd23f']) Fleet.list().length < Fleet.MAX && Fleet.list().push({ id: Math.random().toString(36).slice(2, 9), type: 'super', color: col, wrecked: false }); } },
  { id: 'yacht', name: '메가 요트 "네온 퀸"', price: 3e7, give: () => { UI.toast('요트가 마리나에 정박했다 (보트 무료 대여)'); } },
  { id: 'jet', name: '개인 전용기', price: 5e7, give: () => { UI.toast('전용기가 공항 게이트에 배치됐다 (여객기 무료 탑승)'); } },
  { id: 'art', name: '명화 컬렉션', price: 2e7, give: () => { } },
  { id: 'island', name: '개인 섬 개발권', price: 1e8, give: () => { UI.toast('도시 부자 순위 1위!'); } },
];
{
  let built = false;
  const build = () => {
    if (built || !World.places) return; built = true;
    const W = World, st = W.places.stock || W.places.cbank, re = W.places.realty || st;
    const near = (q, dx, dy) => sidewalkNear(q.x + dx, q.y + dy, 8);
    if (st) W.places.holdings = near(st, 30, 10);
    if (re) W.places.devco = near(re, -30, 12);
    // 저택: 웨스트 힐즈(주택가)의 조용한 곳
    let best = null, bd = 1e9; for (const b of W.blocks) { if (b.district !== DIST.RESID) continue; const d = Math.hypot((b.x0 + b.x1) / 2 / MW - 0.2, (b.y0 + b.y1) / 2 / MH - 0.45); if (d < bd) { bd = d; best = b; } }
    if (best) W.places.mansion = sidewalkNear((best.x0 + best.x1) / 2 * T, (best.y0 + best.y1) / 2 * T, 2);
    for (const [k, ch, c, l] of [['holdings', '홀', '#ffd166', '네온 홀딩스 (기업 인수)'], ['devco', '개', '#9be15d', '하버 개발 (부동산 개발)'], ['mansion', '저', '#f2d479', '힐탑 저택 (금고·수집품)']]) {
      if (!W.places[k]) continue; PLACE_MARK[k] = c; EXTRA_ICONS.push({ key: k, ch, c, label: l }); EXTRA_PLACES.push([k, k]);
    }
  };
  const oU = Tycoon.update.bind(Tycoon); Tycoon.update = dt => { build(); oU(dt); };
}
SHOPS.holdings = {
  title: '네온 홀딩스', get sub() { return `지분 51%면 경영권 · 라이벌: 강 회장 · 1분 배당 $${Tycoon.dividends().toLocaleString()}`; },
  items: () => COMPANIES.map((c, i) => {
    const me = Tycoon.stake(c), rv = Tycoon.rival[c.id] / TOTAL_SHARES, st = Tycoon.acq[c.id];
    const status = st === 'me' ? '내 회사 ✔' : st === 'rival' ? '강 회장 소유' : '';
    if (st === 'me') return { id: 'co_' + c.id, name: `${c.name} — ${status}`, price: 0, desc: `지분 ${Math.round(me * 100)}% · 1분 배당 $${Math.round(Finance.prices[i] * TOTAL_SHARES * 0.0008).toLocaleString()}${c.biz ? ` · ${BUSINESSES[c.biz]?.name || ''} 수입 +15%` : ''}`, ok: () => false };
    if (st === 'rival') return { id: 'co_' + c.id, name: `${c.name} — ${status} (강 ${Math.round(rv * 100)}%)`, price: Math.round(Finance.prices[i] * TOTAL_SHARES * 0.2 * 1.6), btn: '적대적 인수', desc: `내 지분 ${Math.round(me * 100)}% — 35% 이상이면 강 회장 지분 20%를 웃돈 주고 빼앗는다`, ok: () => me >= 0.35, fn: () => { Tycoon.hostile(c); Shop.open('holdings'); } };
    return { id: 'co_' + c.id, name: `${c.name} — 나 ${Math.round(me * 100)}% · 강 회장 ${Math.round(rv * 100)}%`, price: Math.round(Finance.prices[i] * TOTAL_SHARES * 0.05 * 1.08), btn: '5% 매입', desc: `주가 $${Finance.prices[i].toFixed(0)} · 51%가 되면 경영권 인수 (사면 주가가 오른다)`, ok: () => true, fn: () => { Tycoon.buyStake(c, 0.05); Shop.open('holdings'); } };
  }),
};
SHOPS.devco = {
  title: '하버 개발', get sub() { const n = Dev.list.filter(p => p.done).length; return `빈 주차장 필지에 건물을 올린다 · 완공 ${n}동 · 1분 임대 $${Dev.rent().toLocaleString()}`; },
  items: () => {
    const P = Game.player, out = [];
    for (const p of Dev.list) out.push({ id: 'dv_' + p.x0 + '_' + p.y0, name: `${DEV_KINDS[p.kind].name} ${p.done ? '— 완공' : `— 공사 중 ${Math.ceil(p.left / 60)}분 남음`}`, price: 0, btn: '위치', desc: p.done ? `1분 임대 $${DEV_KINDS[p.kind].rent.toLocaleString()}` : '크레인이 서 있다', ok: () => true, fn: () => { Game.waypoint = { x: (p.x0 + p.x1 + 1) / 2 * T, y: (p.y0 + p.y1 + 1) / 2 * T }; UI.toast('지도에 표시했다'); Shop.close(); } });
    const lots = Dev.lots().filter(L => !Dev.list.some(p => p.x0 === L.x0 && p.y0 === L.y0)).sort((a, b) => dist(a.cx, a.cy, P.px, P.py) - dist(b.cx, b.cy, P.px, P.py)).slice(0, 4);
    for (const L of lots) for (const kind of ['apt', 'office', 'sky']) {
      const K = DEV_KINDS[kind], cost = Math.round(K.cost * Dev.price(L));
      if (K.big && (L.x1 - L.x0 < 3 || L.y1 - L.y0 < 3)) continue;
      out.push({ id: `nl_${L.x0}_${L.y0}_${kind}`, name: `${K.name} — ${Math.round(dist(L.cx, L.cy, P.px, P.py))}m 떨어진 필지 (${L.x1 - L.x0 + 1}×${L.y1 - L.y0 + 1})`, price: cost, btn: '착공', desc: `${Math.round(K.sec / 60)}분 공사 · 1분 임대 $${K.rent.toLocaleString()} · 본전까지 약 ${Math.round(cost / K.rent)}분`, ok: () => true, fn: () => { Dev.start(L, kind); Shop.close(); } });
    }
    if (!lots.length) out.push({ id: 'nolot', name: '가까운 빈 필지가 없다', price: 0, desc: '다른 동네에서 다시 와 보자', ok: () => false });
    return out;
  },
};
SHOPS.mansion = {
  title: '힐탑 저택', get sub() { return Tycoon.mansion ? `금고 $${Math.round(Tycoon.vault).toLocaleString()} · 수집품 ${Object.keys(Tycoon.coll).length}/${LUXURY.length} (사업 수입 +${Object.keys(Tycoon.coll).length * 2}%)` : '도시에서 가장 비싼 집 — $25,000,000'; },
  items: () => {
    const P = Game.player, T_ = Tycoon, out = [];
    if (!T_.mansion) return [{ id: 'buy', name: '힐탑 저택 구입', price: 25e6, btn: '구입', desc: '쉬기·저장, 금고, 경비원, 헬기장, 럭셔리 수집품', ok: () => true, fn: () => { if (P.money < 25e6) return; P.money -= 25e6; T_.mansion = true; Sfx.passed(); UI.big('저택 주인!', '힐탑 저택을 샀다', 3, '#f2d479'); Save.write(); Shop.open('mansion'); } }];
    out.push({ id: 'rest', name: '침실에서 쉬기 (저장)', price: 0, btn: '쉬기', desc: '체력·방탄복 가득', ok: () => Wanted.stars === 0, fn: () => { P.hp = P.maxHp; P.armor = 100; Game.clock = (Game.clock + 360) % 1440; Save.write(); Shop.close(); UI.big('힐탑 저택', '푹 쉬었다 — 저장됐다', 2.4, '#f2d479'); } });
    out.push({ id: 'dep', name: `금고에 $1,000,000 넣기`, price: 1e6, btn: '입금', desc: '금고가 $500만을 넘으면 가끔 강도가 노린다', ok: () => true, fn: () => { P.money -= 1e6; T_.vault += 1e6; Shop.open('mansion'); } });
    out.push({ id: 'depall', name: `현금 전부 금고에`, price: 0, btn: '전부', desc: `$${Math.round(P.money).toLocaleString()}`, ok: () => P.money > 0, fn: () => { T_.vault += P.money; P.money = 0; Shop.open('mansion'); } });
    out.push({ id: 'wd', name: `금고에서 전부 꺼내기`, price: 0, btn: '출금', desc: `$${Math.round(T_.vault).toLocaleString()}`, ok: () => T_.vault > 0, fn: () => { P.money += T_.vault; T_.vault = 0; Shop.open('mansion'); } });
    out.push({ id: 'guard', name: T_.guards ? '경비원 고용 중' : '경비원 고용', price: T_.guards ? 0 : 1e6, btn: '고용', desc: '금고를 털려도 5%만 잃는다 (없으면 20%)', ok: () => !T_.guards, fn: () => { P.money -= 1e6; T_.guards = true; Shop.open('mansion'); } });
    out.push({ id: 'heli', name: T_.heli ? '헬기장 — 헬기 부르기' : '헬기장 짓기', price: T_.heli ? 0 : 3e6, btn: T_.heli ? '호출' : '짓기', desc: T_.heli ? '저택 앞에 공격 헬기가 온다' : '저택에서 언제든 헬기를 부른다', ok: () => true, fn: () => { if (!T_.heli) { P.money -= 3e6; T_.heli = true; Shop.open('mansion'); return; } Shop.close(); const s = roadsideSpot(P.px, P.py, 8, 40); const c = new Car('milheli', s.x, s.y, 0, { persistent: true }); Game.cars.push(c); UI.toast('헬기가 도착했다'); } });
    for (const L of LUXURY) out.push({ id: 'lx_' + L.id, name: `${T_.coll[L.id] ? '✔ ' : ''}${L.name}`, price: T_.coll[L.id] ? 0 : L.price, btn: '구입', desc: T_.coll[L.id] ? '소장 중 — 사업 수입 +2%' : '수집품 하나마다 모든 사업 수입 +2%', ok: () => !T_.coll[L.id], fn: () => { if (P.money < L.price) return; P.money -= L.price; T_.coll[L.id] = true; L.give(); Sfx.passed(); UI.big('수집품 획득', L.name, 2.6, '#f2d479'); Save.write(); Shop.open('mansion'); } });
    return out;
  },
};
// 시청: 시장 선거 · 시장 정책
{
  const base = SHOPS.cityhall.items;
  SHOPS.cityhall.items = () => {
    const out = base(), P = Game.player, T_ = Tycoon;
    if (!T_.mayor) {
      if (T_.elect) out.push({ id: 'elect_wait', name: `선거 운동 중 — 선거일까지 ${Math.max(0, T_.elect.day - Gangs.day)}일`, price: 0, desc: `선거 자금 $${T_.elect.fund.toLocaleString()} · 시민·공무원 지지가 높을수록 유리`, ok: () => false });
      else for (const f of [1e7, 3e7, 6e7]) out.push({ id: 'elect_' + f, name: `시장 선거 출마 — 선거 자금 $${(f / 1e6).toFixed(0)}00만`, price: f, btn: '출마', desc: `시민 지지 40 이상 · 게임 속 하루 뒤 개표 · 예상 당선 확률 ${Math.round(clamp(0.2 + f / 1.2e8 + (Empire.support.civ + Empire.support.off) / 400, 0.05, 0.92) * 100)}%`, ok: () => Empire.support.civ >= 40, fn: () => { if (P.money < f) return; P.money -= f; T_.elect = { fund: f, day: Gangs.day + 1 }; UI.big('시장 선거 출마!', '내일 개표한다', 3, '#ffd166'); Save.write(); Shop.close(); } });
    } else {
      out.push({ id: 'm_info', name: '네온 하버 시장', price: 0, desc: '1분 판공비 $20,000', ok: () => false });
      out.push({ id: 'm_tax', name: `사업세 인하 ${T_.mayorPerks.tax ? '(시행 중)' : ''}`, price: 0, btn: '시행', desc: '모든 사업체 수입 +25%', ok: () => !T_.mayorPerks.tax, fn: () => { T_.mayorPerks.tax = true; UI.toast('사업세 인하 시행'); Shop.open('cityhall'); } });
      out.push({ id: 'm_pol', name: `치안 예산 조정 ${T_.mayorPerks.police ? '(시행 중)' : ''}`, price: 0, btn: '시행', desc: '수배가 훨씬 빨리 풀린다', ok: () => !T_.mayorPerks.police, fn: () => { T_.mayorPerks.police = true; UI.toast('경찰이 느슨해졌다'); Shop.open('cityhall'); } });
      out.push({ id: 'm_crack', name: '조직 단속 (7일에 한 번)', price: 0, btn: '단속', desc: '우리 조직을 뺀 모든 조직의 구역 20%가 주인 없는 땅이 된다', ok: () => Gangs.day - T_.crackDay >= 7, fn: () => { T_.crackDay = Gangs.day; let n = 0; for (const k in Gangs.turf) if (Gangs.turf[k] !== Gangs.mine && chance(0.2)) { delete Gangs.turf[k]; n++; } UI.big('조직 단속', `라이벌 구역 ${n}블록을 비웠다`, 3, '#ffd166'); Save.write(); Shop.close(); } });
    }
    return out;
  };
}
