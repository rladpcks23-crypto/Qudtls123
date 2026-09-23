'use strict';
/* =====================================================================
 * police.js — 수배(Wanted) 시스템, 목격자 신고, 경찰 배차, 헬기, 검문
 *
 * 설계 근거 (GTA 시리즈 분석):
 *  - GTA III/2: 범죄 점수(heat)가 누적되어 별 1~5개로 환산, 별이 높을수록 투입 전력 증가
 *    (1★ 도보 순경 → 2★ 순찰차 → 3★ 헬기·검문 → 4★ SWAT → 5★ 총력)
 *  - GTA V: '시야(Line of Sight)' 중심. 경찰이 플레이어를 놓치면 별이 깜빡이고
 *    마지막 목격 지점(LKP)을 중심으로 수색 원이 생긴다. 원 밖에서 일정 시간 들키지 않으면 해제.
 *  - 시민 목격자가 휴대폰으로 신고하므로, 경찰이 직접 보지 않아도 지연 후 수배가 붙는다.
 *  - 페인트샵(Pay 'n' Spray): 들키지 않은 상태로 들어가면 도색 + 수배 해제.
 * ===================================================================== */

const HEAT_STARS = [0, 1, 160, 380, 750, 1400];
const CRIMES = {
  assault: { heat: 14, min: 1, name: '폭행' },
  hitPed: { heat: 14, min: 1, name: '보행자 충격' },
  kill: { heat: 45, min: 1, name: '살인' },
  hitCop: { heat: 60, min: 1, name: '경찰 폭행' },
  killCop: { heat: 170, min: 2, name: '경찰 살해' },
  gunfire: { heat: 5, min: 1, name: '총기 발포' },
  carjack: { heat: 22, min: 1, name: '차량 강탈' },
  stealCop: { heat: 110, min: 2, name: '경찰차 절도' },
  explosion: { heat: 70, min: 2, name: '폭발' },
  destroyCar: { heat: 35, min: 1, name: '차량 파괴' },
  crash: { heat: 3, min: 0, name: '교통사고', copOnly: true },
  theft: { heat: 12, min: 1, name: '절도' },
  robbery: { heat: 380, min: 2, name: '강도' },
};

const Wanted = {
  heat: 0, stars: 0, seen: false, lkpX: 0, lkpY: 0, searchX: 0, searchY: 0, evadeT: 0, searchT: 0,
  reports: [], bustT: 0, flashT: 0, lastSeenT: 0,
  get radius() { return 40 + this.stars * 22; },
  reset() { this.heat = 0; this.stars = 0; this.reports = []; this.evadeT = 0; this.seen = false; this.bustT = 0; },
  add(heat, min) {
    if (Game.noWanted) return;
    const before = this.stars;
    this.heat = Math.max(this.heat + heat, HEAT_STARS[min] || 0);
    let s = 0; for (let i = 1; i < HEAT_STARS.length; i++) if (this.heat >= HEAT_STARS[i]) s = i;
    this.stars = Math.max(this.stars, s);
    const P = Game.player;
    if (this.stars > before) {
      this.lkpX = P.px; this.lkpY = P.py; this.searchX = P.px; this.searchY = P.py; this.evadeT = 0;
      UI.starPulse = 1.2;
      if (before === 0) this.seen = true;
    }
  },
  set(stars) { this.heat = Math.max(this.heat, HEAT_STARS[stars]); this.add(0, stars); this.seen = true; const P = Game.player; this.lkpX = P.px; this.lkpY = P.py; },
  drop(n) { this.stars = Math.max(0, this.stars - n); this.heat = HEAT_STARS[this.stars]; if (this.stars === 0) this.clear(); },
  clear(msg) {
    if (this.stars > 0 && msg) UI.toast(msg);
    this.reset();
    for (const p of Game.peds) if ((p.kind === 'cop' || p.kind === 'swat') && p.state === 'chase') { if (p.soldier) p.state = 'idle'; else returnToWalk(p); }
  },
};

// 경찰의 시야 판정: 도보 경찰 38m, 순찰차 46m, 헬기는 반경 42m(건물 무시)
function copCanSee(x, y) {
  for (const p of Game.peds) {
    if (p.dead || p.downT > 0 || (p.kind !== 'cop' && p.kind !== 'swat')) continue;
    if (dist2(p.x, p.y, x, y) < 38 * 38 && losClear(p.x, p.y, x, y)) return true;
  }
  for (const c of Game.cars) {
    if (c.dead || c.driver !== 'ai' || c.driverKind !== 'cop') continue;
    if (dist2(c.x, c.y, x, y) < 46 * 46 && losClear(c.x, c.y, x, y)) return true;
  }
  const H = Police.heli;
  if (H && !H.dead && dist2(H.x, H.y, x, y) < 42 * 42) return true;
  return false;
}

function crime(type, x, y) {
  const P = Game.player;
  if (P.dead || Game.state !== 'play') return;
  const c = CRIMES[type]; if (!c) return;
  if (type === 'gunfire' || type === 'explosion') scarePeds(x, y, type === 'gunfire' ? 26 : 45);
  if (copCanSee(x, y) || copCanSee(P.px, P.py)) {
    if (c.min === 0 && Wanted.stars === 0 && !chance(0.3)) return;
    Wanted.add(c.heat, Math.max(c.min, 1));
    Wanted.seen = true; Wanted.lkpX = P.px; Wanted.lkpY = P.py;
    return;
  }
  if (c.copOnly) return;
  // 시민 목격자 → 지연 신고
  if (Wanted.reports.length > 4) return;
  let wit = null, bd = 30 * 30;
  for (const p of Game.peds) {
    if (p.dead || p.kind !== 'civ') continue;
    const d = dist2(p.x, p.y, x, y);
    if (d < bd && losClear(p.x, p.y, x, y)) { bd = d; wit = p; }
  }
  if (wit && (type !== 'gunfire' || chance(0.25))) Wanted.reports.push({ wit, t: rand(3.5, 6), heat: c.heat * 0.8, min: Math.max(1, c.min - (c.min > 2 ? 1 : 0)), x, y });
}

const Police = {
  heli: null, dispatchT: 0, roadblockT: 12,
  reset() { this.heli = null; this.dispatchT = 0; this.roadblockT = 12; },
  update(dt) {
    const P = Game.player;
    // 목격자 신고 처리
    for (let i = Wanted.reports.length - 1; i >= 0; i--) {
      const r = Wanted.reports[i]; r.t -= dt;
      if (r.wit.dead) { Wanted.reports.splice(i, 1); continue; }
      if (r.t <= 0) {
        Wanted.reports.splice(i, 1);
        Wanted.add(r.heat, r.min);
        Wanted.lkpX = r.x; Wanted.lkpY = r.y; Wanted.searchX = r.x; Wanted.searchY = r.y;
        UI.toast('목격자가 경찰에 신고했다!');
      }
    }
    if (Wanted.stars === 0) { Wanted.bustT = 0; this.heliLeave(dt); return; }
    // 시야 → 마지막 목격 지점 / 수색
    Wanted.seen = copCanSee(P.px, P.py);
    if (Wanted.seen) {
      Wanted.lkpX = P.px; Wanted.lkpY = P.py; Wanted.searchX = P.px; Wanted.searchY = P.py; Wanted.evadeT = 0; Wanted.lastSeenT = Game.time;
    } else {
      Wanted.searchT -= dt;
      if (Wanted.searchT <= 0) {
        Wanted.searchT = 3;
        const a = rand(0, TAU), r = rand(0, Wanted.radius * 0.6);
        // 수색 지점은 LKP 주변을 배회하되 플레이어 쪽으로 약간 기운다(GTA V의 '추정' 수색).
        Wanted.searchX = lerp(Wanted.lkpX + Math.cos(a) * r, P.px, 0.15); Wanted.searchY = lerp(Wanted.lkpY + Math.sin(a) * r, P.py, 0.15);
      }
      const out = dist(P.px, P.py, Wanted.lkpX, Wanted.lkpY) > Wanted.radius;
      if (out) Wanted.evadeT += dt;
      if (Wanted.evadeT > 4 + Wanted.stars * 2) { Wanted.clear('경찰을 따돌렸다'); Sfx.passed(); return; }
    }
    // 체포(BUSTED): 별 1~3개에서 경찰이 붙잡으면
    let near = false;
    if (Wanted.stars <= 3) for (const p of Game.peds) {
      if (p.dead || p.downT > 0 || (p.kind !== 'cop' && p.kind !== 'swat')) continue;
      const d = dist(p.x, p.y, P.px, P.py);
      if (!P.car && d < 1.5 && Math.hypot(P.vx, P.vy) < 3) near = true;
      if (P.car && d < P.car.W / 2 + 1.7 && P.car.speed < 1.2) near = true;
    }
    Wanted.bustT = near ? Wanted.bustT + dt : Math.max(0, Wanted.bustT - dt * 2);
    if (Wanted.bustT > (P.car ? 2 : 1.3)) { Game.busted(); return; }
    // 배차
    this.dispatchT -= dt;
    if (this.dispatchT <= 0) { this.dispatchT = 1; this.dispatch(); }
    if (Wanted.stars >= 3 && P.car && P.car.speed > 10) { this.roadblockT -= dt; if (this.roadblockT <= 0) { this.roadblockT = rand(18, 28); this.roadblock(); } }
    this.updateHeli(dt);
  },
  dispatch() {
    const P = Game.player, s = Wanted.stars;
    const wantCars = [0, 0, 2, 3, 4, 5][s], wantFoot = [0, 2, 2, 3, 3, 4][s];
    let cars = 0, foot = 0;
    for (const c of Game.cars) if (c.driver === 'ai' && c.driverKind === 'cop' && c.ai && c.ai.mode === 'chase') {
      if (dist(c.x, c.y, P.px, P.py) > 230) { c.ai.mode = 'traffic'; c.siren = false; c.persistent = false; continue; }
      cars++;
    }
    for (const p of Game.peds) if (!p.dead && (p.kind === 'cop' || p.kind === 'swat') && p.state === 'chase') foot++;
    // 순찰 중인 가까운 경찰차도 합류
    for (const c of Game.cars) if (cars < wantCars && c.driver === 'ai' && c.driverKind === 'cop' && c.ai && c.ai.mode !== 'chase' && c.ai.mode !== 'block' && dist(c.x, c.y, P.px, P.py) < 150) { c.ai = { mode: 'chase', repath: 0 }; c.siren = true; cars++; }
    for (const p of Game.peds) if (foot < wantFoot && !p.dead && p.kind === 'cop' && p.state !== 'chase' && dist(p.x, p.y, P.px, P.py) < 80) { p.state = 'chase'; foot++; }
    if (cars < wantCars) {
      const type = s >= 4 && chance(0.4) ? 'swat' : 'police';
      const spot = offscreenLaneSpot(80, 130);
      if (spot) {
        const c = new Car(type, spot.x, spot.y, spot.a);
        c.driver = 'ai'; c.driverKind = 'cop'; c.crew = type === 'swat' ? 4 : 2; c.siren = true; c.persistent = false;
        c.ai = { mode: 'chase', repath: 0 };
        const sp = type === 'swat' ? 12 : 16; c.vx = Math.cos(spot.a) * sp; c.vy = Math.sin(spot.a) * sp;
        Game.cars.push(c);
      }
    }
    if (foot < wantFoot && !P.car && Game.peds.length < 110) {
      const sp = offscreenWalkSpot(40, 70);
      if (sp) { const p = spawnPed(s >= 4 && chance(0.4) ? 'swat' : 'cop', sp.x, sp.y); p.state = 'chase'; }
    }
    if (s >= 3 && !this.heli) this.spawnHeli();
  },
  roadblock() {
    const P = Game.player, c = P.car;
    const ahead = { x: c.x + c.vx * 7, y: c.y + c.vy * 7 };
    let best = null, bd = 1e18;
    for (const n of World.nodes) {
      const d = dist(n.x, n.y, P.px, P.py); if (d < 80 || d > 170 || onScreen(n.x, n.y, 10)) continue;
      const dd = dist2(n.x, n.y, ahead.x, ahead.y); if (dd < bd) { bd = dd; best = n; }
    }
    if (!best) return;
    // 플레이어 쪽 진입로에 차 두 대를 가로로 세운다
    let dirIn = 0, bdot = -1e9;
    for (let d = 0; d < 4; d++) { if (best.adj[d] < 0) continue; const o = World.nodes[best.adj[d]]; const dot = ((o.x - best.x) * (P.px - best.x) + (o.y - best.y) * (P.py - best.y)) / (dist(o.x, o.y, best.x, best.y) * (dist(P.px, P.py, best.x, best.y) || 1)); if (dot > bdot) { bdot = dot; dirIn = d; } }
    const [dx, dy] = DIRS[dirIn], [rx, ry] = [-dy, dx];
    const bx = best.x + dx * (2 * T + 4), by = best.y + dy * (2 * T + 4);
    for (const side of [-1, 1]) {
      const car = new Car('police', bx + rx * side * 2.2, by + ry * side * 2.2, Math.atan2(ry, rx) + (side < 0 ? Math.PI : 0) + rand(-0.2, 0.2));
      car.driver = 'ai'; car.driverKind = 'cop'; car.siren = true; car.ai = { mode: 'block' }; car.crew = 0; Game.cars.push(car);
      const cop = spawnPed('cop', bx + rx * side * 2.2 + dx * 3, by + ry * side * 2.2 + dy * 3); cop.state = 'chase';
    }
    UI.toast('전방에 경찰 검문소!');
  },
  spawnHeli() {
    const P = Game.player, a = rand(0, TAU);
    this.heli = { kind: 'heli', x: P.px + Math.cos(a) * 160, y: P.py + Math.sin(a) * 160, vx: 0, vy: 0, a: 0, hp: 650, dead: false, alt: 30, rotor: 0, cd: 2, orbit: rand(0, TAU), fall: 0, leave: false };
  },
  heliLeave(dt) {
    const H = this.heli; if (!H) return;
    if (H.dead) { this.updateHeli(dt); return; }
    H.leave = true; this.updateHeli(dt);
    if (dist(H.x, H.y, Game.player.px, Game.player.py) > 220) this.heli = null;
  },
  updateHeli(dt) {
    const H = this.heli; if (!H) return;
    const P = Game.player;
    H.rotor += dt * 30;
    if (H.dead) {
      H.fall += dt; H.alt -= dt * (6 + H.fall * 10); H.a += dt * 6; H.x += H.vx * dt; H.y += H.vy * dt;
      if (Math.random() < 0.8) { Particles.smoke(H.x, H.y, 1.8, '#222'); Particles.fire(H.x, H.y, 1); }
      if (H.alt <= 0) { explode(H.x, H.y, 9, 180, null, null); this.heli = null; }
      return;
    }
    if (H.hp <= 0) { H.dead = true; crime('killCop', H.x, H.y); Sfx.explosion(H.x, H.y); Effects.boom(H.x, H.y, 4); return; }
    let tx, ty;
    if (H.leave) { const a = Math.atan2(H.y - P.py, H.x - P.px); tx = H.x + Math.cos(a) * 50; ty = H.y + Math.sin(a) * 50; }
    else {
      H.orbit += dt * 0.35;
      const bx = Wanted.seen ? P.px : Wanted.searchX, by = Wanted.seen ? P.py : Wanted.searchY;
      tx = bx + Math.cos(H.orbit) * 16; ty = by + Math.sin(H.orbit) * 16;
    }
    const dx = tx - H.x, dy = ty - H.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(26, d * 0.8);
    H.vx = smooth(H.vx, dx / d * sp, 1.2, dt); H.vy = smooth(H.vy, dy / d * sp, 1.2, dt);
    H.x += H.vx * dt; H.y += H.vy * dt;
    const face = Math.atan2(P.py - H.y, P.px - H.x);
    H.a = H.a + angNorm(face - H.a) * Math.min(1, dt * 2);
    H.cd -= dt;
    if (!H.leave && Wanted.stars >= 4 && Wanted.seen && d < 60 && dist(H.x, H.y, P.px, P.py) < 45 && H.cd <= 0) {
      H.cd = 0.12; H.burst = (H.burst || 0) + 1; if (H.burst > 8) { H.burst = 0; H.cd = 1.6; }
      const ang = Math.atan2(P.py - H.y, P.px - H.x) + gauss() * 0.08;
      const shooter = { kind: 'heli', px: H.x, py: H.y, x: H.x, y: H.y, vx: 0, vy: 0, car: null };
      fireWeapon(shooter, 'smg', ang, 0.8);
    }
  },
};

// 화면 밖 스폰 지점
function onScreen(x, y, m = 0) {
  const hw = Cam.vw / 2 + m, hh = Cam.vh / 2 + m;
  return Math.abs(x - Cam.x) < hw && Math.abs(y - Cam.y) < hh;
}
function offscreenLaneSpot(minD, maxD) {
  const P = Game.player;
  for (let k = 0; k < 30; k++) {
    const e = pick(World.edgesList), A = World.nodes[e[0]], B = World.nodes[e[1]];
    const t = Math.random(), x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t);
    const d = dist(x, y, P.px, P.py);
    if (d < minD || d > maxD || onScreen(x, y, 8)) continue;
    const L = dist(A.x, A.y, B.x, B.y);
    // 플레이어 쪽으로 향하는 방향을 고른다
    const fwd = ((B.x - A.x) * (P.px - x) + (B.y - A.y) * (P.py - y)) > 0;
    const spot = laneSpot(e, fwd, fwd ? t * L : (1 - t) * L);
    let free = true; for (const c of Game.cars) if (dist2(c.x, c.y, spot.x, spot.y) < 64) { free = false; break; }
    if (free) return spot;
  }
  return null;
}
function offscreenWalkSpot(minD, maxD) {
  const P = Game.player;
  for (let k = 0; k < 40; k++) {
    const a = rand(0, TAU), r = rand(minD, maxD), x = P.px + Math.cos(a) * r, y = P.py + Math.sin(a) * r;
    if (onScreen(x, y, 4)) continue;
    const t = tileAt(x, y);
    if (t === TL.WALK || t === TL.PLAZA) return { x, y };
  }
  return null;
}

// ---------- 무단횡단 단속 ----------
// 플레이어가 횡단보도가 아닌 곳이나 빨간불(보행자 기준)에 도로를 건너다 경찰 눈에 띄면
//  · 도보 경찰: 호루라기 → 걸어와서 딱지(벌금 $50). 도망치면(멀어지거나 차에 타면) 수배 ★1
//  · 순찰차: 확성기 경고 + 벌금 $30
//  · 90초 안에 세 번 걸리면 상습범으로 수배 ★1
// 무단횡단하는 시민도 경찰이 보면 딱지를 뗀다.
const Jay = {
  t: 0, cd: 0, cop: null, copT: 0, count: 0, countT: 0, npcCop: null, npcT: 0,
  reset() { if (this.cop && !this.cop.dead) returnToWalk(this.cop); if (this.npcCop && !this.npcCop.dead) returnToWalk(this.npcCop); this.t = 0; this.cd = 0; this.cop = null; this.npcCop = null; this.count = 0; },
  whistle(x, y) { Sfx.tone({ x, y, f0: 2700, f1: 3000, dur: 0.18, type: 'square', vol: 0.14 }); setTimeout(() => Sfx.tone({ x, y, f0: 2750, f1: 3100, dur: 0.35, type: 'square', vol: 0.14 }), 220); },
  seenBy(x, y, footR, carR) {
    let cop = null, bd = footR * footR;
    for (const p of Game.peds) {
      if (p.dead || p.downT > 0 || p.kind !== 'cop' || p.state === 'chase' || p.state === 'ticket') continue;
      const d = dist2(p.x, p.y, x, y); if (d < bd && losClear(p.x, p.y, x, y)) { bd = d; cop = p; }
    }
    if (cop) return { cop };
    for (const c of Game.cars) if (!c.dead && c.driver === 'ai' && c.driverKind === 'cop' && dist2(c.x, c.y, x, y) < carR * carR && losClear(c.x, c.y, x, y)) return { car: c };
    return null;
  },
  update(dt) {
    const P = Game.player;
    this.cd -= dt; this.countT -= dt; if (this.countT <= 0) this.count = 0;
    this.updateNpc(dt);
    if (this.cop) { this.chase(dt); return; }
    if (P.car || P.dead || Wanted.stars > 0 || P.alt > 0 || Game.time - (P.bornT || 0) < 5) { this.t = 0; return; }
    const st = jayStatus(P.x, P.y);
    // 차에 타고 내리느라 길가에 선 경우는 봐준다
    const nearCar = st === 2 && Game.cars.some(c => c.speed < 1 && dist2(c.x, c.y, P.x, P.y) < 3.6 * 3.6);
    if (st === 2 && !nearCar) this.t += dt; else this.t = Math.max(0, this.t - dt * 2);
    UI.jay = st === 2 && !nearCar ? this.t : 0;
    if (this.t < 0.9 || this.cd > 0) return;
    const w = this.seenBy(P.x, P.y, 30, 40);
    if (!w) return;
    this.cd = 25; this.t = 0;
    if (w.cop) {
      this.cop = w.cop; this.copT = 0; w.cop.state = 'ticket'; w.cop.ticketTarget = Game.player;
      this.whistle(w.cop.x, w.cop.y);
      Effects.text(w.cop.x, w.cop.y - 1.2, '삐익!', '#ffe066');
      UI.toast('경찰: 거기 서요! 무단횡단입니다 — 그 자리에서 기다리면 벌금만 낸다');
    } else {
      w.car.sirenBlip = 1;
      Sfx.tone({ x: w.car.x, y: w.car.y, f0: 700, f1: 1400, dur: 0.4, type: 'triangle', vol: 0.2 });
      this.fine(30, '순찰차 확성기: 무단횡단 하지 마세요! 벌금');
    }
  },
  chase(dt) {
    const c = this.cop, P = Game.player;
    if (c.dead || c.downT > 0 || Wanted.stars > 0 || P.dead) { if (!c.dead && c.state === 'ticket') returnToWalk(c); this.cop = null; return; }
    this.copT += dt;
    const d = dist(c.x, c.y, P.px, P.py);
    if (d < 1.8 && !P.car) {
      this.fine(50, '무단횡단 딱지: 벌금');
      Effects.text(c.x, c.y - 1.2, '딱지 발부', '#9fd0ff');
      c.state = 'idle'; c.homeX = c.x; c.homeY = c.y; c.wt = 0; setTimeout(() => { if (!c.dead && c.state === 'idle') returnToWalk(c); }, 2500);
      this.cop = null; return;
    }
    if (d > 28 || this.copT > 16 || P.car) {
      this.cop = null; c.state = 'chase'; c.ticketTarget = null;
      Wanted.add(0, 1); Wanted.seen = true; Wanted.lkpX = P.px; Wanted.lkpY = P.py;
      UI.toast('단속에 불응했다! 수배 ★1');
    }
  },
  fine(amt, msg) {
    const P = Game.player, paid = Math.min(P.money, amt);
    P.money -= paid;
    Effects.text(P.px, P.py - 1, `-$${paid}`, '#ff8a80');
    UI.toast(`${msg} -$${paid}`);
    this.count++; this.countT = 90;
    if (this.count >= 3) { this.count = 0; Wanted.add(0, 1); UI.toast('상습 무단횡단으로 수배됐다! ★1'); }
  },
  // 시민 무단횡단
  npcSeen(p) {
    if (this.npcCop || p.ticketed) return;
    const w = this.seenBy(p.x, p.y, 26, 0);
    if (!w || !w.cop || w.cop === this.cop) return;
    p.ticketed = true;
    this.npcCop = w.cop; this.npcT = 0; w.cop.state = 'ticket'; w.cop.ticketTarget = p;
    this.whistle(w.cop.x, w.cop.y);
    Effects.text(p.x, p.y - 1.2, '무단횡단!', '#ffe066');
  },
  updateNpc(dt) {
    const c = this.npcCop; if (!c) return;
    const p = c.ticketTarget;
    this.npcT += dt;
    if (c.dead || c.state !== 'ticket' || !p || p.dead || this.npcT > 15) { if (!c.dead && c.state === 'ticket') returnToWalk(c); this.npcCop = null; return; }
    if (dist2(c.x, c.y, p.x, p.y) < 1.8 * 1.8) {
      Effects.text(p.x, p.y - 1.2, '딱지 발부', '#9fd0ff');
      if (p.state === 'walk' || p.state === 'cross') { p.state = 'idle'; p.homeX = p.x; p.homeY = p.y; p.wt = 0; setTimeout(() => { if (!p.dead && p.state === 'idle') returnToWalk(p); }, 2500); }
      c.state = 'idle'; c.homeX = c.x; c.homeY = c.y; c.wt = 0; setTimeout(() => { if (!c.dead && c.state === 'idle') returnToWalk(c); }, 2500);
      this.npcCop = null;
    }
  },
};
