'use strict';
/* =====================================================================
 * stunts.js — 차량 손상 · 스턴트 점프 · 레이스
 *
 *  · 차량 손상: 부딪힌 쪽(앞·뒤·왼쪽·오른쪽)이 찌그러지고, 세게 받으면 전조등이 깨지고 유리에 금이 간다.
 *    총으로 바퀴 근처를 맞히면 타이어가 터진다(c.flat). 페인트샵·HESOYAM으로 고친다.
 *  · 스턴트 점프: 도시 곳곳의 점프대(14곳)를 빠르게 타면 날아오른다. 처음 성공한 점프대는
 *    '유니크 스턴트 점프'로 기록되고(슬로모션) 보상 $2,000. 지도에 '점' 표시.
 *  · 레이스(지도 '경'): 길거리 레이스 3곳(AI 3대와 대결, 베팅), 보트 레이스·항공 레이스(타임 트라이얼, 금·은·동)
 * ===================================================================== */

// ---------- 차량 손상 ----------
const CarDamage = {
  // 부딪힌 지점(월드 좌표) → 차의 앞·뒤·좌·우 중 어디인지
  side(c, hx, hy) {
    const cs = Math.cos(c.a), sn = Math.sin(c.a), dx = hx - c.x, dy = hy - c.y;
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    return Math.abs(lx) / (c.L / 2) > Math.abs(ly) / (c.W / 2) ? (lx > 0 ? 'f' : 'r') : (ly > 0 ? 'rs' : 'ls');
  },
  hit(c, hx, hy, amt) {
    if (c.V.special || amt <= 0) return;
    const d = c.dmgParts || (c.dmgParts = { f: 0, r: 0, ls: 0, rs: 0, glass: 0 });
    const s = this.side(c, hx, hy);
    d[s] = Math.min(1, d[s] + amt);
    if (s === 'f' && d.f > 0.35) d.glass = Math.min(1, d.glass + amt * 0.6);
  },
  bullet(c, hx, hy) {
    if (c.V.special) return;
    const cs = Math.cos(c.a), sn = Math.sin(c.a), dx = hx - c.x, dy = hy - c.y;
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    const d = c.dmgParts || (c.dmgParts = { f: 0, r: 0, ls: 0, rs: 0, glass: 0 });
    d.glass = Math.min(1, d.glass + 0.08);
    // 바퀴 근처(앞뒤 축, 옆면)면 타이어가 터진다
    if (!c.flat && Math.abs(Math.abs(lx) - c.L * 0.3) < 0.7 && Math.abs(ly) > c.W / 2 - 0.55 && chance(0.45)) {
      c.flat = true; Sfx.noiseBurst({ x: c.x, y: c.y, dur: 0.35, freq: 2600, vol: 0.6, sweep: 0.3 });
      if (c === Game.player.car) UI.toast('타이어가 터졌다!');
    }
  },
  // render.js drawCar 안(차 로컬 좌표)에서 호출
  draw(c, L, W) {
    const d = c.dmgParts; if (!d || c.dead) return;
    ctx.fillStyle = 'rgba(20,20,22,0.55)';
    const dent = (k, poly) => { if (k < 0.12) return; ctx.globalAlpha = Math.min(1, k * 1.3); ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; };
    dent(d.f, [[L / 2, -W / 2], [L / 2 - 0.5 - d.f * 0.8, -W * 0.2], [L / 2 - 0.3, 0], [L / 2 - 0.6 - d.f * 0.6, W * 0.25], [L / 2, W / 2]]);
    dent(d.r, [[-L / 2, -W / 2], [-L / 2 + 0.4 + d.r * 0.7, -W * 0.15], [-L / 2 + 0.25, W * 0.1], [-L / 2, W / 2]]);
    dent(d.ls, [[-L * 0.3, -W / 2], [-L * 0.1, -W / 2 + 0.25 + d.ls * 0.25], [L * 0.1, -W / 2 + 0.15], [L * 0.3, -W / 2]]);
    dent(d.rs, [[-L * 0.3, W / 2], [-L * 0.05, W / 2 - 0.25 - d.rs * 0.25], [L * 0.15, W / 2 - 0.1], [L * 0.3, W / 2]]);
    if (d.glass > 0.2) { // 앞유리 금
      ctx.strokeStyle = `rgba(230,240,255,${Math.min(0.9, d.glass)})`; ctx.lineWidth = 0.05;
      const x0 = L * 0.14; ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = k * 1.25 + 0.3; ctx.moveTo(x0, 0); ctx.lineTo(x0 + Math.cos(a) * 0.5, Math.sin(a) * W * 0.3); }
      ctx.stroke();
    }
    if (c.flat) { ctx.fillStyle = '#555'; for (const [x, y] of [[L * 0.3, W / 2 - 0.1], [L * 0.3, -W / 2 + 0.1], [-L * 0.3, W / 2 - 0.1], [-L * 0.3, -W / 2 + 0.1]]) ctx.fillRect(x - 0.4, y - 0.06, 0.8, 0.12); }
  },
  headlightsOK(c) { return !(c.dmgParts && c.dmgParts.f > 0.6); },
};
// 충돌 지점 기록 → 손상 부위
{
  const oImp = Car.prototype.impulseStatic;
  Car.prototype.impulseStatic = function (px, py, nx, ny, e, mu) { const v = oImp.call(this, px, py, nx, ny, e, mu); if (v > 0) { this._hx = px; this._hy = py; } return v; };
  const oHit = Car.prototype.onImpact;
  Car.prototype.onImpact = function (v, other) {
    const cd = this.hitCD > 0; oHit.call(this, v, other);
    if (cd || v <= 5) return;
    const hx = other ? other.x : (this._hx ?? this.x + Math.cos(this.a) * this.L / 2), hy = other ? other.y : (this._hy ?? this.y + Math.sin(this.a) * this.L / 2);
    CarDamage.hit(this, hx, hy, (v - 5) * 0.045);
  };
}

// ---------- 점프 (공중 물리) ----------
{
  const oStep = Car.prototype.step;
  Car.prototype.step = function (dt) {
    if (!(this.jz > 0)) return oStep.call(this, dt);
    // 공중: 바퀴 힘 없이 관성으로 날아간다
    this.jz += this.jvz * dt; this.jvz -= 19 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.a = angNorm(this.a + this.w * dt * 0.4);
    this.jpitch = clamp(-this.jvz * 0.03, -0.35, 0.35);
    if (this.jz <= 0) { this.jz = 0; this.jpitch = 0; Stunts.land(this, -this.jvz); this.jvz = 0; }
  };
}

const Stunts = {
  ramps: null, done: {}, air: null,
  save() { return { done: this.done }; },
  load(o) { this.done = (o && o.done) || {}; this.air = null; Game.slowmo = false; },
  // 14곳: 길고 곧은 도로 구간 가운데, 한쪽 차선 위 (결정적으로 고른다)
  build() {
    const W = World, out = [];
    const cand = W.edgesList.map((e, i) => ({ e, i, L: dist(W.nodes[e[0]].x, W.nodes[e[0]].y, W.nodes[e[1]].x, W.nodes[e[1]].y) })).filter(q => q.L >= 60);
    cand.sort((p, q) => hash2(p.i * 3, 7) - hash2(q.i * 3, 7));
    for (const q of cand) {
      if (out.length >= 14) break;
      const fwd = hash2(q.i, 11) < 0.5, sp = laneSpot(q.e, fwd, q.L * 0.45);
      if (tileAt(sp.x, sp.y) !== TL.ROAD || out.some(r => dist(r.x, r.y, sp.x, sp.y) < 260)) continue;
      out.push({ id: 'j' + out.length, x: sp.x, y: sp.y, a: sp.a });
    }
    this.ramps = out;
    // 지도 표시
    for (const r of out) { W.places['jump_' + r.id] = { x: r.x, y: r.y, label: '스턴트 점프대' }; }
    EXTRA_ICONS.push(...out.map(r => ({ key: 'jump_' + r.id, ch: '점', c: () => (Stunts.done[r.id] ? '#7ae68f' : '#ffb347'), label: '스턴트 점프대 (유니크 점프)' })));
  },
  update(dt) {
    if (!this.ramps) this.build();
    const P = Game.player, c = P.car;
    if (!c || c.V.special || c.dead || c.jz > 0) return;
    const sp = c.vf || 0;
    if (sp < 12) return;
    for (const r of this.ramps) {
      if (Math.abs(r.x - c.x) > 10 || Math.abs(r.y - c.y) > 10) continue;
      const ca = Math.cos(r.a), sa = Math.sin(r.a), dx = c.x - r.x, dy = c.y - r.y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(v) > 1.9 || u < -3 || u > 3) continue;
      const along = Math.cos(c.a - r.a); if (along < 0.75) continue;
      c.jz = 0.3; c.jvz = Math.min(15, sp * 0.33); c.w *= 0.3;
      this.air = { r, x0: c.x, y0: c.y, t0: Game.time, sp };
      if (!this.done[r.id] && sp > 20) Game.slowmo = true;
      Sfx.tone({ f0: 200, f1: 90, dur: 0.25, type: 'square', vol: 0.3 });
      break;
    }
  },
  land(c, vz) {
    Sfx.crash(c.x, c.y, vz * 1.2); for (let k = 0; k < 8; k++) Particles.spark(c.x + rand(-1, 1), c.y + rand(-1, 1));
    if (vz > 9) { c.damage((vz - 9) * 3, null); CarDamage.hit(c, c.x + Math.cos(c.a) * c.L / 2, c.y + Math.sin(c.a) * c.L / 2, 0.08); }
    Game.slowmo = false;
    const A = this.air; this.air = null;
    if (!A || c !== Game.player.car) return;
    const d = dist(A.x0, A.y0, c.x, c.y), air = Game.time - A.t0;
    Cam.shake = Math.max(Cam.shake, 0.4);
    if (tileAt(c.x, c.y) === TL.WATER) return;
    if (!this.done[A.r.id] && d > 22 && A.sp > 20) {
      this.done[A.r.id] = true; const n = Object.keys(this.done).length;
      Game.player.money += 2000; Sfx.passed();
      UI.big(`유니크 스턴트 점프 ${n}/${this.ramps.length}`, `${Math.round(d)}m · 체공 ${air.toFixed(1)}초 · +$2,000`, 3, '#ffb347');
      if (n === this.ramps.length) { Game.player.money += 50000; UI.toast('모든 스턴트 점프 완료! 보너스 +$50,000'); }
      Save.write();
    } else if (d > 10) UI.toast(`점프 ${Math.round(d)}m · 체공 ${air.toFixed(1)}초${!this.done[A.r.id] ? ' — 더 빠르게 (72km/h 이상) 타면 유니크 점프' : ''}`);
  },
  props() {
    if (!this.ramps) return [];
    return this.ramps.map(r => ({
      x: r.x, y: r.y, a: r.a, w: 6, d: 3.2, h: 1.2, pitch: 0.2, c: this.done[r.id] ? '#6f8f6f' : '#d9a441',
      draw(g) { // 2D: 쐐기 모양 + 화살표
        const grd = g.createLinearGradient(-3, 0, 3, 0); grd.addColorStop(0, '#7a5a25'); grd.addColorStop(1, Stunts.done[r.id] ? '#9fbf9f' : '#f2c14e');
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-2.6, -1.4, 6, 3.2);
        g.fillStyle = grd; g.fillRect(-3, -1.6, 6, 3.2);
        g.fillStyle = '#2a1f10'; for (let s = -2.4; s < 3; s += 1.2) { g.beginPath(); g.moveTo(s, -0.9); g.lineTo(s + 0.7, 0); g.lineTo(s, 0.9); g.lineTo(s + 0.25, 0); g.closePath(); g.fill(); }
      },
    }));
  },
};
Props.providers.push(() => Stunts.props());
SaveExt.mods.stunts = Stunts;

// 플레이어를 차에 바로 태운다 (레이스·일 시작용)
function putPlayerIn(c) { const P = Game.player; P.car = c; c.driver = 'player'; c.ai = null; c.driverKind = null; c.siren = false; c.everDriven = true; UI.car(c.label || c.V.name); }

// ---------- 레이스 ----------
const RACE_BETS = [5000, 25000, 100000];
const Races = {
  cur: null, best: {}, wins: 0, starts: null, cool: 0,
  save() { return { best: this.best, wins: this.wins }; },
  load(o) { this.best = (o && o.best) || {}; this.wins = (o && o.wins) || 0; if (this.cur) this.cleanup(); this.cur = null; },
  // 시작 지점: 길거리 3곳(서로 먼 교차로), 보트 1곳(마리나), 항공 1곳(공항)
  build() {
    const W = World, nodes = W.nodes.filter(n => n.deg >= 3 && tileAt(n.x, n.y) === TL.ROAD);
    const picks = [];
    const target = [[0.35, 0.35], [0.62, 0.55], [0.4, 0.72]];
    for (const [u, v] of target) {
      let best = null, bd = 1e9; for (const n of nodes) { const d = dist(n.x, n.y, u * CITY_W * T, v * CITY_H * T); if (d < bd && !picks.some(p => dist(p.x, p.y, n.x, n.y) < 300)) { bd = d; best = n; } }
      if (best) picks.push(best);
    }
    this.starts = [];
    picks.forEach((n, i) => { const s = sidewalkNear(n.x + 10, n.y + 10, 4); this.starts.push({ key: 'race' + (i + 1), kind: 'street', node: n, x: s.x, y: s.y, name: ['다운타운 서킷', '리버사이드 스프린트', '올드 타운 러시'][i] }); });
    const mar = (W.marinas || [])[0]; if (mar) this.starts.push({ key: 'race_boat', kind: 'boat', x: mar.x, y: mar.y, name: '해안 보트 레이스' });
    if (W.airport) { const s = sidewalkNear(W.airport.cx * T, (W.airport.by1 + 6) * T, 12); this.starts.push({ key: 'race_air', kind: 'air', x: s.x, y: s.y, name: '스카이 링 레이스' }); }
    for (const s of this.starts) {
      W.places[s.key] = { x: s.x, y: s.y, label: s.name }; PLACE_MARK[s.key] = '#ff4fd8';
      EXTRA_ICONS.push({ key: s.key, ch: '경', c: '#ff4fd8', label: '레이스 (베팅·타임 트라이얼)' });
      EXTRA_PLACES.push([s.key, s.key]);
      SHOPS[s.key] = { title: s.name, get sub() { return Races.subOf(s); }, items: () => Races.menu(s) };
    }
  },
  subOf(s) { return s.kind === 'street' ? `AI 레이서 3대와 체크포인트 레이스 · 우승 상금 = 베팅 ×3 + $5,000 · 통산 우승 ${this.wins}회` : `타임 트라이얼 · 최고 기록 ${this.best[s.key] ? this.best[s.key].toFixed(1) + '초' : '없음'}`; },
  menu(s) {
    if (s.kind === 'street') return RACE_BETS.map(b => ({ id: 'bet' + b, name: `$${b.toLocaleString()} 걸고 출전`, price: b, btn: '출전', desc: `1위 +$${(b * 3 + 5000).toLocaleString()} · 2위 +$${(b * 1.5).toLocaleString()} · 3위 +$${(b * 0.5).toLocaleString()} · 차가 없으면 스포츠카를 준다`, ok: () => !this.cur, fn: () => { Shop.close(); this.start(s, b); } }));
    const g = this.goldTime(s);
    return [{ id: 'tt', name: '출발 — ' + (s.kind === 'boat' ? '스피드보트 지급' : '공격 헬기 지급'), price: 0, btn: '출발', desc: `금 ${g.toFixed(0)}초 $50,000 · 은 ${(g * 1.3).toFixed(0)}초 $25,000 · 동 ${(g * 1.7).toFixed(0)}초 $10,000`, ok: () => !this.cur, fn: () => { Shop.close(); this.start(s, 0); } }];
  },
  // 경로
  streetRoute(s) {
    const W = World; let n = s.node, prevDir = -1; const nodes = [n], seen = new Set([n.id]);
    let h = hash2(n.id, 5) * 1000;
    for (let k = 0; k < 10; k++) {
      const opts = [0, 1, 2, 3].filter(d => n.adj[d] >= 0 && !seen.has(n.adj[d]) && d !== (prevDir + 2) % 4);
      if (!opts.length) break;
      opts.sort((a, b) => (a === prevDir ? -1 : 0) - (b === prevDir ? -1 : 0));
      h = (h * 9301 + 49297) % 233280; const d = h / 233280 < 0.55 && opts.includes(prevDir) ? prevDir : opts[Math.floor(h / 233280 * opts.length)];
      n = W.nodes[n.adj[d]]; nodes.push(n); seen.add(n.id); prevDir = d;
    }
    return nodes;
  },
  loopPts(s, n, radius, alt) { // 보트·항공: 섬 둘레를 따라가는 점
    const cx = CITY_W * T / 2, cy = CITY_H * T / 2, a0 = Math.atan2(s.y - cy, s.x - cx), pts = [];
    for (let k = 1; k <= n; k++) {
      const a = a0 + k * (s.kind === 'air' ? TAU / n : 1.9 / n);
      if (s.kind === 'air') { pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius * 0.9, alt }); continue; }
      // 보트: 중심에서 바깥으로 가다 첫 바다 칸 + 30m
      let r = 100, x = 0, y = 0; for (; r < CITY_W * T; r += 8) { x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r; if (tileAt(x, y) === TL.WATER && tileAt(x + Math.cos(a) * 16, y + Math.sin(a) * 16) === TL.WATER) break; }
      pts.push({ x: clamp(x + Math.cos(a) * 30, 30, CITY_W * T - 30), y: clamp(y + Math.sin(a) * 30, 30, CITY_H * T - 30) });
    }
    return pts;
  },
  goldTime(s) {
    const pts = s.kind === 'boat' ? this.loopPts(s, 8, 0, 0) : this.loopPts(s, 10, Math.min(CITY_W, CITY_H) * T * 0.34, 22);
    let L = 0, px = s.x, py = s.y; for (const p of pts) { L += dist(px, py, p.x, p.y); px = p.x; py = p.y; }
    return L / (s.kind === 'boat' ? 24 : 30) * 1.15;
  },
  start(s, bet) {
    const P = Game.player;
    if (bet && P.money < bet) { UI.toast('베팅할 돈이 부족하다'); return; }
    if (Missions.active) Missions.abort('레이스에 나가느라 미션을 잠시 내려놓는다');
    if (Jobs.active) Jobs.stop('레이스 출전');
    P.money -= bet;
    const R = this.cur = { s, bet, kind: s.kind, cp: 0, t: -3.5, racers: [], cars: [] };
    if (s.kind === 'street') {
      const nodes = this.streetRoute(s); R.nodes = nodes; R.cps = nodes.slice(1).map(n => ({ x: n.x, y: n.y }));
      const A = nodes[0], B = nodes[1], d = dirBetween(A, B), r = rightOf(d);
      // 플레이어 차
      let car = P.car && !P.car.V.special && !P.car.dead ? P.car : null;
      if (!car) { car = new Car('sports', A.x, A.y, 0, { persistent: true }); Game.cars.push(car); if (P.car) exitCar(P, true); putPlayerIn(car); }
      const place = (c, row, lane) => { c.x = A.x + DIRS[d][0] * (3 * T - row * 7) + r[0] * (lane ? T * 0.5 : -T * 0.5); c.y = A.y + DIRS[d][1] * (3 * T - row * 7) + r[1] * (lane ? T * 0.5 : -T * 0.5); c.a = Math.atan2(DIRS[d][1], DIRS[d][0]); c.vx = c.vy = c.w = 0; };
      for (const q of Game.cars) if (q !== car && !q.persistent && dist(q.x, q.y, A.x, A.y) < 60) q.remove = true;
      place(car, 0, 1); R.grid = [[car, 0, 1]];
      // AI 레이서 3대: 경로 전체를 미리 깐다
      const route = []; for (let k = 0; k < nodes.length - 1; k++) { const a = nodes[k], b = nodes[k + 1], dd = dirBetween(a, b); pushLane(route, a, b, dd, k === 0 ? 3 * T : 0, 38); const nx = nodes[k + 2]; if (nx && dirBetween(b, nx) !== dd) route[route.length - 1].v = 11; delete route[route.length - 1].stop; }
      const types = ['super', 'sports', 'muscle'];
      for (let i = 0; i < 3; i++) {
        const c = new Car(types[i], A.x, A.y, 0, { persistent: true }); c.driver = 'ai'; c.driverKind = 'racer'; Game.cars.push(c);
        place(c, i === 0 ? 0 : 1, i === 0 ? 0 : i === 1 ? 1 : 0);
        trafficFromHere(c, 'flee'); const last = nodes.length - 1;
        Object.assign(c.ai, { route: route.map(p => ({ ...p })), cruiseFlee: 30 + i * 3 + rand(0, 3), from: nodes[last - 1].id, to: nodes[last].id, dir: dirBetween(nodes[last - 1], nodes[last]) });
        R.racers.push({ car: c, cp: 0, done: false, name: ['블레이즈', '스네이크', '토니'][i] }); R.grid.push([c, i === 0 ? 0 : 1, i === 0 ? 0 : i === 1 ? 1 : 0]); R.cars.push(c);
      }
      R.place = place;
    } else {
      const boat = s.kind === 'boat';
      R.cps = boat ? this.loopPts(s, 8, 0, 0) : this.loopPts(s, 10, Math.min(CITY_W, CITY_H) * T * 0.34, 22);
      if (P.car) exitCar(P, true);
      let x = s.x, y = s.y;
      if (boat) { const m = World.marinas[0]; const a = m.a; x = m.x + Math.cos(a) * 14; y = m.y + Math.sin(a) * 14; }
      const c = new Car(boat ? 'speedboat' : 'milheli', x, y, Math.atan2(R.cps[0].y - y, R.cps[0].x - x), { persistent: true }); Game.cars.push(c); R.cars.push(c);
      putPlayerIn(c); R.vehicle = c;
      R.gold = this.goldTime(s);
    }
    UI.big(s.name, s.kind === 'street' ? `베팅 $${bet.toLocaleString()} — 체크포인트 ${R.cps.length}곳` : `체크포인트 ${R.cps.length}곳 — 금 ${R.gold.toFixed(0)}초`, 2.5, '#ff4fd8');
  },
  pos(R) { // 순위: 체크포인트 수 → 다음 체크포인트까지 거리
    const P = Game.player;
    const me = { cp: R.cp, d: R.cps[R.cp] ? dist(P.px, P.py, R.cps[R.cp].x, R.cps[R.cp].y) : 0 };
    return 1 + R.racers.filter(q => q.cp > me.cp || (q.cp === me.cp && q.car && R.cps[q.cp] && dist(q.car.x, q.car.y, R.cps[q.cp].x, R.cps[q.cp].y) < me.d)).length;
  },
  update(dt) {
    if (!this.starts) this.build();
    this.cool -= dt;
    const P = Game.player;
    // 차에 탄 채로 시작 지점에 멈추면 메뉴
    if (!this.cur && P.car && P.car.speed < 2 && this.cool <= 0 && Game.state === 'play') for (const s of this.starts) if (dist(P.px, P.py, s.x, s.y) < 6) { this.cool = 6; Shop.open(s.key); return; }
    const R = this.cur; if (!R) return;
    R.t += dt;
    if (R.t < 0) { // 출발 신호
      for (const [c, row, lane] of R.grid || []) R.place(c, row, lane);
      if (R.vehicle) { R.vehicle.vx = R.vehicle.vy = 0; }
      const n = Math.ceil(-R.t); if (n !== R.count) { R.count = n; if (n <= 3) { UI.big(String(n), '', 0.8, '#ff4fd8'); Sfx.tone({ f0: 440, f1: 440, dur: 0.2, type: 'square', vol: 0.3 }); } }
      return;
    }
    if (!R.go) { R.go = true; UI.big('출발!', '', 0.8, '#7ae68f'); Sfx.tone({ f0: 880, f1: 880, dur: 0.4, type: 'square', vol: 0.35 }); }
    // 실패: 차가 부서지거나 오래 내렸을 때
    if (P.dead || !P.car || P.car.dead) { R.outT = (R.outT || 0) + dt; if (R.outT > 8 || P.dead) { this.finish(false, '레이스에서 이탈했다'); return; } } else R.outT = 0;
    const cpR = R.kind === 'air' ? 16 : R.kind === 'boat' ? 14 : 13;
    const next = R.cps[R.cp];
    if (next && dist(P.px, P.py, next.x, next.y) < cpR) {
      R.cp++; Sfx.tone({ f0: 1200, f1: 1600, dur: 0.1, type: 'triangle', vol: 0.3 });
      if (R.cp >= R.cps.length) { this.finish(true); return; }
    }
    for (const q of R.racers) {
      if (q.done || !q.car || q.car.dead) continue;
      const c = R.cps[q.cp]; if (c && dist(q.car.x, q.car.y, c.x, c.y) < 16) { q.cp++; if (q.cp >= R.cps.length) { q.done = true; q.t = R.t; } }
      if (q.car.ai && q.car.driver === 'ai') q.car.ai.ignoreT = 1; // 앞차에 막혀도 밀고 나간다
    }
    if (R.t > 420) this.finish(false, '시간 초과');
  },
  finish(ok, why) {
    const R = this.cur, P = Game.player; if (!R) return;
    if (!ok) { UI.big('레이스 실패', why || '', 2.5, '#ff4d4d'); Sfx.failed(); this.cleanup(); return; }
    if (R.kind === 'street') {
      const rank = 1 + R.racers.filter(q => q.done).length;
      const pay = rank === 1 ? R.bet * 3 + 5000 : rank === 2 ? R.bet * 1.5 : rank === 3 ? R.bet * 0.5 : 0;
      P.money += pay; if (rank === 1) this.wins++;
      UI.big(`${rank}위로 들어왔다!`, pay ? `상금 +$${pay.toLocaleString()} · 기록 ${R.t.toFixed(1)}초` : `4위 — 베팅한 $${R.bet.toLocaleString()}을 잃었다`, 3.2, rank === 1 ? '#f2c14e' : '#ff4fd8');
      if (rank === 1) Sfx.passed(); else Sfx.failed();
    } else {
      const t = R.t, g = R.gold, key = R.s.key, prev = this.best[key];
      const medal = t <= g ? '금' : t <= g * 1.3 ? '은' : t <= g * 1.7 ? '동' : null;
      const pay = medal === '금' ? 50000 : medal === '은' ? 25000 : medal === '동' ? 10000 : 0;
      P.money += pay; if (!prev || t < prev) this.best[key] = t;
      UI.big(medal ? `${medal}메달!` : '완주', `${t.toFixed(1)}초${pay ? ` · +$${pay.toLocaleString()}` : ''}${!prev || t < prev ? ' · 최고 기록!' : ''}`, 3.2, medal ? '#f2c14e' : '#ff4fd8');
      Sfx.passed();
    }
    this.cleanup(); Save.write();
  },
  cleanup() {
    const R = this.cur; if (!R) return;
    for (const c of R.cars) { c.persistent = false; if (c.driver === 'ai' && c.ai) c.ai.mode = 'traffic'; }
    this.cur = null; this.cool = 8;
  },
  targets() {
    const R = this.cur; if (!R || R.t < -3) return [];
    const out = []; const a = R.cps[R.cp], b = R.cps[R.cp + 1];
    if (a) out.push({ x: a.x, y: a.y, c: '#ff4fd8', big: true }); if (b) out.push({ x: b.x, y: b.y, c: '#b36fb0' });
    return out;
  },
  hud() {
    const R = this.cur; if (!R) return null;
    const time = `${Math.floor(Math.max(0, R.t) / 60)}:${String(Math.floor(Math.max(0, R.t) % 60)).padStart(2, '0')}`;
    return R.kind === 'street' ? `레이스 ${this.pos(R)}/4위 · 체크포인트 ${R.cp}/${R.cps.length} · ${time}` : `${R.s.name} · 체크포인트 ${R.cp}/${R.cps.length} · ${time} (금 ${R.gold.toFixed(0)}초)`;
  },
  props() {
    const R = this.cur; if (!R) return [];
    const out = [];
    for (const [i, p] of [[R.cp, R.cps[R.cp]], [R.cp + 1, R.cps[R.cp + 1]]]) {
      if (!p) continue;
      const last = i === R.cps.length - 1, col = last ? '#f2f2f2' : i === R.cp ? '#ff4fd8' : '#8a4f86', z = p.alt || 0;
      // 기둥 두 개 + 윗보 (항공은 공중 고리)
      const a = i + 1 < R.cps.length ? Math.atan2(R.cps[i + 1].y - p.y, R.cps[i + 1].x - p.x) + Math.PI / 2 : 0, ca = Math.cos(a), sa = Math.sin(a), hw = R.kind === 'air' ? 8 : 6;
      out.push({ x: p.x + ca * hw, y: p.y + sa * hw, w: 0.6, d: 0.6, h: 5, z, c: col, glow: true, no2d: true });
      out.push({ x: p.x - ca * hw, y: p.y - sa * hw, w: 0.6, d: 0.6, h: 5, z, c: col, glow: true, no2d: true });
      out.push({ x: p.x, y: p.y, a, w: hw * 2, d: 0.5, h: 0.6, z: z + 5, c: col, glow: true, no2d: true });
      out.push({ x: p.x, y: p.y, no3d: true, draw(g) { g.strokeStyle = col; g.lineWidth = 0.5; g.globalAlpha = 0.85; g.beginPath(); g.arc(0, 0, R.kind === 'air' ? 10 : 8, 0, TAU); g.stroke(); if (last) { g.fillStyle = '#fff'; for (let k = -3; k < 3; k++) g.fillRect(k * 1.2, -0.6, 0.6, 0.6); } g.globalAlpha = 1; } });
    }
    return out;
  },
};
Props.providers.push(() => Races.props());
SaveExt.mods.races = Races;
