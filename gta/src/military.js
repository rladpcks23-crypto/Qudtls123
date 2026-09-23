'use strict';
/* =====================================================================
 * military.js — 포트 네온 군사 기지: 전차 · 공격 헬기 · 전투기 · 경비병
 *
 * GTA V의 포트 잔쿠도처럼: 울타리 안에 들어가면 경고 후 수배 ★★★★,
 * 안에는 탈 수 있는 탱크(라이노), 공격 헬기(헌터), 전투기(라저)가 세워져 있다.
 * 조종은 아케이드식:
 *  · 전차: 제자리 회전, 느리지만 무겁고(차를 밀어붙여 부순다) 포탑은 조준 방향을 따라 돈다.
 *  · 헬기: 가속하면 자동으로 떠올라 순항 고도 유지, 하차 버튼 = 착륙.
 *  · 전투기: 활주로에서 속도를 붙이면 이륙, 속도가 떨어지면 고도가 내려간다. 하차 버튼 = 착륙 접근.
 *  공중에서는 지상 충돌을 무시하지만, 고도보다 높은 건물에 부딪히면 추락한다.
 * ===================================================================== */

Object.assign(VTYPES, {
  tank: { name: '라이노 전차', L: 7.2, W: 3.5, mass: 40000, Fe: 1, vmax: 11, grip: 3, cs: 6, steer: 0.9, hp: 2200, colors: ['#4b5a3a'], style: 'tank', special: 'tank', armor: 0.15 },
  milheli: { name: '헌터 공격 헬기', L: 9, W: 2.4, mass: 5000, Fe: 1, vmax: 36, grip: 1, cs: 5, steer: 1.5, hp: 700, colors: ['#4a5540'], style: 'milheli', special: 'heli', armor: 0.5 },
  jet: { name: '라저 전투기', L: 12, W: 3, mass: 9000, Fe: 1, vmax: 78, grip: 1, cs: 5, steer: 0.9, hp: 600, colors: ['#8a929c'], style: 'jet', special: 'jet', armor: 0.5 },
});
// 그 자리 건물 옥상 높이 (건물이 없으면 0)
function roofAt(x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return 0;
  const bi = World.bIndex[tIdx(tx, ty)];
  return bi >= 0 && World.buildings[bi] ? World.buildings[bi].h : 0;
}
// 막힌 칸(건물·물) 안에 있을 때 가장 가까운 빈 칸 중심 (옥상에 내린 사람을 길로 내려보낼 때)
function openSpotNear(x, y) {
  const cx = Math.floor(x / T), cy = Math.floor(y / T);
  if (!solidT(cx, cy)) return [x, y];
  for (let r = 1; r < 40; r++) {
    let best = null, bd = 1e18;
    for (let k = -r; k <= r; k++) for (const [tx, ty] of [[cx + k, cy - r], [cx + k, cy + r], [cx - r, cy + k], [cx + r, cy + k]]) {
      if (solidT(tx, ty)) continue;
      const px = (tx + 0.5) * T, py = (ty + 0.5) * T, d = dist2(px, py, x, y);
      if (d < bd) { bd = d; best = [px, py]; }
    }
    if (best) return best;
  }
  return [x, y];
}
const isAir = c => c && (c.V.special === 'heli' || c.V.special === 'jet');
const airborne = c => c && c.alt > 1.2;

// ---------- 특수 차량 물리 ----------
function specialStep(c, dt) {
  const V = c.V, inp = c.in, raw = inp.raw || 0;
  c.alt = c.alt || 0;
  if (V.special === 'tank') {
    const want = c.driver ? raw * (raw > 0 ? V.vmax : 6) : 0;
    c.spd = smooth(c.spd || 0, want, raw ? 1.4 : 3, dt);
    c.w = (c.driver ? inp.st * V.steer : 0) * (raw < -0.1 ? -1 : 1);
    c.a = angNorm(c.a + c.w * dt);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    // 외부 충격 속도는 금방 사라지게(무거운 궤도차)
    const ex = c.vx - cs * c.vf, ey = c.vy - sn * c.vf;
    c.vx = cs * c.spd + ex * Math.exp(-6 * dt); c.vy = sn * c.spd + ey * Math.exp(-6 * dt);
  } else if (V.special === 'heli') {
    // 옥상 착륙: 수직으로 내려오면 지붕 위에 선다 (옆에서 들이받으면 아래 충돌 판정으로 추락)
    const roof = roofAt(c.x, c.y);
    const flying = c.driver && !c.landing && c.burnT <= 0 && (c.alt - roof > 0.5 || Math.abs(raw) > 0.1 || Math.abs(inp.st) > 0.1 || inp.up);
    const target = flying ? 72 : roof;
    c.alt = c.alt < target ? Math.min(target, c.alt + 8 * dt) : Math.max(target, c.alt - (c.landing ? 7 : 5) * dt);
    if (c.landing && c.alt <= roof + 0.05) { c.landing = false; if (c.driver === 'player') UI.toast(roof > 0 ? '옥상에 착륙했다' : '착륙 완료'); }
    c.rotor = (c.rotor || 0) + dt * (c.alt > 0.1 || flying ? 42 : 4);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    if (c.alt > 3) {
      c.vx += cs * raw * 16 * dt; c.vy += sn * raw * 16 * dt;
      c.vx *= Math.exp(-0.9 * dt); c.vy *= Math.exp(-0.9 * dt);
      const sp = Math.hypot(c.vx, c.vy); if (sp > V.vmax) { c.vx *= V.vmax / sp; c.vy *= V.vmax / sp; }
      c.w = inp.st * V.steer;
    } else { c.vx *= Math.exp(-4 * dt); c.vy *= Math.exp(-4 * dt); c.w = c.alt > 0.5 ? inp.st * 0.8 : 0; }
    c.a = angNorm(c.a + c.w * dt);
  } else if (V.special === 'boat') {
    // 보트: 물 위에서만 추진, 옆으로 미끄러지며(물) 속도가 있어야 방향이 잘 돈다. 물 밖(좌초)이면 거의 못 움직인다
    const wet = tileAt(c.x, c.y) === TL.WATER;
    c.spd = c.spd || 0;
    if (c.driver && c.burnT <= 0 && wet) c.spd += raw * (raw > 0 ? V.accel : V.accel * 0.8) * dt;
    c.spd *= Math.exp(-(wet ? (raw ? 0.35 : 0.8) : 6) * dt);
    c.spd = clamp(c.spd, -8, V.vmax);
    c.w = (c.driver ? inp.st * V.steer * clamp(Math.abs(c.spd) / 7, 0.35, 1) : 0) * (c.spd < -0.5 ? -1 : 1);
    c.a = angNorm(c.a + c.w * dt);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    const lat = (-c.vx * sn + c.vy * cs) * Math.exp(-2.2 * dt); // 옆미끄럼(물)
    c.vx = cs * c.spd - sn * lat; c.vy = sn * c.spd + cs * lat;
    c.bob = (c.bob || 0) + dt * (2 + Math.abs(c.spd) * 0.15);
    if (wet && Math.abs(c.spd) > 4 && Math.random() < 0.6) Particles.splash(c.x - cs * c.L * 0.5 + rand(-0.4, 0.4), c.y - sn * c.L * 0.5 + rand(-0.4, 0.4));
  } else { // jet
    c.spd = c.spd || 0;
    const air = c.alt > 1.2;
    if (c.driver && c.burnT <= 0) {
      if (raw > 0) c.spd += raw * 15 * dt; else if (raw < 0) c.spd += raw * 20 * dt;
      if (!raw && !air) c.spd *= Math.exp(-0.5 * dt);
    } else c.spd *= Math.exp(-2 * dt);
    c.spd = clamp(c.spd, air ? 20 : 0, V.vmax);
    if (c.landing) c.spd = Math.max(air ? 20 : 0, c.spd - 6 * dt);
    const takeoff = 34;
    if (c.landing) c.alt = Math.max(0, c.alt - 7 * dt);
    else if (c.spd >= takeoff) c.alt = Math.min(95, c.alt + (c.spd - 30) * 0.35 * dt * 2);
    else if (c.alt > 0) c.alt = Math.max(0, c.alt - ((takeoff - c.spd) * 0.6 + 2) * dt);
    if (c.landing && c.alt <= 0.05) { c.landing = false; UI.toast('착륙 완료 — 브레이크로 멈춘 뒤 내려라'); }
    c.w = inp.st * V.steer * (air ? 1 : clamp(c.spd / 12, 0, 0.45));
    c.bank = smooth(c.bank || 0, air ? -inp.st * 0.7 : 0, 4, dt);
    c.a = angNorm(c.a + c.w * dt);
    c.vx = Math.cos(c.a) * c.spd; c.vy = Math.sin(c.a) * c.spd;
  }
  c.x += c.vx * dt; c.y += c.vy * dt;
  c.vf = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a); c.vl = -c.vx * Math.sin(c.a) + c.vy * Math.cos(c.a);
  c.steer = inp.st * 0.4; c.skid = false;
  // 지도 밖으로 나가면 되돌린다
  const m = 20, WX = MW * T, WY = MH * T;
  if (c.x < m || c.y < m || c.x > WX - m || c.y > WY - m) {
    c.x = clamp(c.x, m, WX - m); c.y = clamp(c.y, m, WY - m);
    if (isAir(c)) { c.a = angNorm(c.a + Math.PI * 0.9); if (c.driver === 'player') UI.toast('작전 구역 끝 — 기수를 돌린다'); }
  }
  // 공중 충돌: 현재 고도보다 높은 건물
  if (c.alt > 1.2 && !c.dead) {
    const tx = Math.floor(c.x / T), ty = Math.floor(c.y / T);
    const bi = tx >= 0 && ty >= 0 && tx < MW && ty < MH ? World.bIndex[tIdx(tx, ty)] : -1;
    if (bi >= 0 && World.buildings[bi] && World.buildings[bi].h > c.alt + 0.3) { c.damage(9999, null); c.burnT = 0.01; if (c.driver === 'player') UI.toast('건물에 충돌했다!'); }
  }
}

// ---------- 무기 ----------
// 탑승 무기: 차량마다 무기 목록이 있고 Q/E(모바일 [무기])로 바꾼다. 스페이스(모바일 두 번째 버튼)는 보조 무기.
const VWEAP = {
  shell: { name: '주포', short: '주포', cd: 1.3 },
  mg: { name: '동축 기관총', short: '기관총', cd: 0.1 },
  cannon: { name: '기관포', short: '기관포', cd: 0.08 },
  rockets: { name: '로켓 포드', short: '로켓', cd: 0.3 },
  homing: { name: '유도 미사일', short: '유도탄', cd: 1.1 },
};
const VSET = { tank: ['shell', 'mg'], heli: ['cannon', 'rockets', 'homing'], jet: ['cannon', 'homing', 'rockets'] };
const vWeapons = c => VSET[c.V.special] || [];
const hasVW = c => !!(c && VSET[c.V.special]); // 탑승 무기가 있는 차량 (보트는 일반 차처럼 창밖 사격)
const vWeapon = c => vWeapons(c)[(c.vw || 0) % vWeapons(c).length];
function cycleVWeapon(c, dir) {
  const n = vWeapons(c).length; if (!n) return;
  c.vw = ((c.vw || 0) + dir + n) % n; UI.weaponFlash = 1;
  UI.toast(`무기: ${VWEAP[vWeapon(c)].name}`);
}

const MilFire = {
  aim(c) {
    if (Game.view !== 'top' && View3D.ok) return View3D.yaw;
    if (!Input.usingTouch && !Pad.active) { const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y); return Math.atan2(wy - c.y, wx - c.x); }
    if (Pad.active && (Pad.rx || Pad.ry)) return Math.atan2(Pad.ry, Pad.rx);
    // 터치: 앞쪽의 가장 가까운 적/차량 자동 조준 (락온 중이면 그 목표)
    if (c.lock && c.lockT > 0.3) return Math.atan2(c.lock.y - c.y, c.lock.x - c.x);
    let best = null, bs = 1e9;
    for (const q of [...Game.peds, ...Game.cars]) {
      if (q === c || q.dead || (q.kind !== 'car' && (q.kind === 'dog' || q.car))) continue;
      const d = dist(q.x, q.y, c.x, c.y); if (d > 60 || d < 2) continue;
      const da = Math.abs(angNorm(Math.atan2(q.y - c.y, q.x - c.x) - c.a)); if (da > 0.8) continue;
      const hostile = q.state === 'chase' || q.driverKind === 'cop' || q.driverKind === 'army' || q.kind === 'swat' || q.kind === 'cop';
      const sc = d * (hostile ? 0.5 : 1) + da * 20; if (sc < bs) { bs = sc; best = q; }
    }
    return best ? Math.atan2(best.y - c.y, best.x - c.x) : c.a;
  },
  shell(c, ang, speed, radius, dmg, from, by = Game.player, air = false, target = null, turn = 0) {
    Game.projectiles.push({ type: 'rocket', x: from[0], y: from[1], vx: Math.cos(ang) * speed + c.vx, vy: Math.sin(ang) * speed + c.vy, life: target ? 4 : 2.4, by, a: ang, big: radius, dmg, air, alt: air ? c.alt || 0 : 0, target, turn });
    Sfx.shot(from[0], from[1], 'rocket'); Effects.flash(from[0], from[1], 8, 0.12);
    if (by === Game.player) crime('gunfire', from[0], from[1]);
  },
  // 락온: 조준 방향 원뿔 안의 목표를 0.8초 겨누면 고정. 공중에 있으면 공중 목표를 우선한다.
  lockUpdate(c, dt, ang) {
    const air = airborne(c), H = Police.heli;
    let best = null, bs = 1e9;
    const cands = Game.cars.filter(q => q !== c && !q.dead && q.burnT <= 0 && !q.owned);
    if (H && !H.dead) cands.push(H);
    for (const q of cands) {
      const d = dist(q.x, q.y, c.x, c.y); if (d > 190 || d < 8) continue;
      const da = Math.abs(angNorm(Math.atan2(q.y - c.y, q.x - c.x) - ang)); if (da > 0.42) continue;
      const qAir = q.kind === 'heli' || airborne(q), hostile = q.driverKind === 'army' || q.driverKind === 'cop' || q.kind === 'heli';
      const sc = da * 120 + d * 0.25 - (qAir === air ? 25 : 0) - (hostile ? 20 : 0);
      if (sc < bs) { bs = sc; best = q; }
    }
    if (best !== c.lock) { c.lock = best; c.lockT = 0; c.lockBeep = false; }
    else if (best) {
      c.lockT += dt;
      if (c.lockT > 0.8 && !c.lockBeep) { c.lockBeep = true; if (c.driver === 'player') Sfx.tone({ f0: 1500, f1: 1500, dur: 0.12, type: 'square', vol: 0.18 }); }
    }
  },
  fire(c, w, ang) {
    const P = Game.player, key = 'cd_' + w;
    if ((c[key] || 0) > 0) return;
    c[key] = VWEAP[w].cd;
    const sp = c.V.special, nose = sp === 'jet' ? c.a : ang;
    if (w === 'shell') {
      const t = c.turret ?? c.a, tip = [c.x + Math.cos(t) * 5.5, c.y + Math.sin(t) * 5.5];
      this.shell(c, t, 60, 8, 230, tip); c.vx -= Math.cos(t) * 1.5; c.vy -= Math.sin(t) * 1.5; Cam.shake = Math.max(Cam.shake, 0.35); buzz(80);
    } else if (w === 'mg') {
      fireWeapon(P, 'smg', (c.turret ?? c.a) + gauss() * 0.05, 1);
    } else if (w === 'cannon') {
      fireWeapon(P, 'rifle', nose + gauss() * 0.04, 1);
    } else {
      const side = (c.side = -(c.side || 1));
      const from = [c.x + Math.cos(c.a) * 3 - Math.sin(c.a) * side * 1.5, c.y + Math.sin(c.a) * 3 + Math.cos(c.a) * side * 1.5];
      if (w === 'rockets') this.shell(c, nose + gauss() * 0.03, sp === 'jet' ? 95 : 70, 6, 140, from, P, airborne(c) && airTargetAlong(c, nose));
      else {
        const T_ = c.lock && c.lockT > 0.8 ? c.lock : null;
        const qAir = T_ ? T_.kind === 'heli' || airborne(T_) : airborne(c) && airTargetAlong(c, nose);
        this.shell(c, T_ ? Math.atan2(T_.y - c.y, T_.x - c.x) : nose, 62, 8, 240, from, P, qAir, T_, 3.2);
        if (!T_ && !(c.nlT > Game.time)) { c.nlT = Game.time + 10; UI.toast('락온 없이 발사 — 목표를 조준선에 0.8초 겨누면 유도된다'); }
      }
    }
  },
  update(c, dt, firing, alt) {
    for (const k of Object.keys(VWEAP)) if (c['cd_' + k] > 0) c['cd_' + k] -= dt;
    const ang = this.aim(c), sp = c.V.special;
    if (sp === 'tank') {
      const d = angNorm(ang - (c.turret ?? c.a));
      c.turret = angNorm((c.turret ?? c.a) + clamp(d, -1.8 * dt, 1.8 * dt));
    } else this.lockUpdate(c, dt, sp === 'jet' ? c.a : ang);
    if (firing) this.fire(c, vWeapon(c), ang);
    if (alt) this.fire(c, sp === 'tank' ? 'mg' : 'homing', ang);
  },
};
// 락온 표시 (화면 좌표)
function drawLockHUD() {
  const P = Game.player, c = P.car;
  if (!c || !c.V.special || c.V.special === 'tank' || !c.lock) return;
  const q = c.lock, qa = q.kind === 'heli' ? q.alt : (q.alt || 0);
  let sx, sy;
  if (Game.view !== 'top' && View3D.ok) { const r = View3D.project(q.x, q.y, qa + 1.5); if (!r) return; [sx, sy] = r; }
  else { const [wx, wy] = qa > 1.2 ? proj(q.x, q.y, Math.min(qa, Cam.H - 20)) : [q.x, q.y]; [sx, sy] = toScreen(wx, wy); }
  const locked = c.lockT > 0.8, k = locked ? 1 : 1.6 - Math.min(0.6, c.lockT * 0.75), r = 18 * k;
  const g = ctx; g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.strokeStyle = locked ? '#ff3b3b' : '#f2c14e'; g.lineWidth = 2.5;
  for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.moveTo(sx + ax * r, sy + ay * r * 0.4); g.lineTo(sx + ax * r, sy + ay * r); g.lineTo(sx + ax * r * 0.4, sy + ay * r); g.stroke(); }
  txt(g, locked ? 'LOCK' : '조준 중', sx, sy - r - 6, `700 12px ${FONT_NUM}`, locked ? '#ff3b3b' : '#f2c14e', 'rgba(0,0,0,0.9)', 3, 'center');
}

// ---------- 기지 관리 (차량 배치 · 경비병 · 출입 경보) ----------
const Military = {
  slots: [], warnT: 0, warned: false, soldiers: [],
  reset() { this.slots = []; this.soldiers = []; this.warnT = 0; this.warned = false; },
  inside(x, y) { const B = World.base; return B && x > B.x0 && x < B.x1 && y > B.y0 && y < B.y1; },
  update(dt) {
    const B = World.base; if (!B) return;
    const P = Game.player;
    // 전차가 굴러오면 시민들이 달아난다
    if (P.car && P.car.type === 'tank' && !P.car.dead && chance(dt * 1.5)) scarePeds(P.car.x, P.car.y, P.car.speed > 1 ? 26 : 14);
    const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
    const near = Math.abs(P.px - cx) < (B.x1 - B.x0) / 2 + 150 && P.py < B.y1 + 160;
    if (!this.slots.length) {
      for (const s of B.spots.tanks) this.slots.push({ s, type: 'tank', car: null, cool: 0 });
      for (const s of B.spots.helis) this.slots.push({ s, type: 'milheli', car: null, cool: 0 });
      for (const s of B.spots.jets) this.slots.push({ s, type: 'jet', car: null, cool: 0 });
    }
    for (const sl of this.slots) {
      const c = sl.car;
      const gone = !c || !Game.cars.includes(c) || c.dead || (c !== P.car && dist(c.x, c.y, sl.s.x, sl.s.y) > 30);
      if (gone && c) { sl.car = null; sl.cool = 45; if (c !== P.car && Game.cars.includes(c) && !c.dead && dist(c.x, c.y, P.px, P.py) > 150) c.remove = true; }
      sl.cool -= dt;
      if (!sl.car && near && sl.cool <= 0 && dist(sl.s.x, sl.s.y, P.px, P.py) > 25 && !Game.cars.some(q => dist2(q.x, q.y, sl.s.x, sl.s.y) < 36)) {
        const car = new Car(sl.type, sl.s.x, sl.s.y, sl.s.a, { persistent: true }); car.alt = 0; car.military = true;
        Game.cars.push(car); sl.car = car;
      }
    }
    // 경비병
    this.soldiers = this.soldiers.filter(p => Game.peds.includes(p) && !p.dead);
    if (near && this.soldiers.length < B.guards.length && !this.spawnCD) {
      for (const g of B.guards) {
        if (this.soldiers.some(p => p.homeX === g.x && p.homeY === g.y) || onScreen(g.x, g.y, 4) && this.soldiers.length) continue;
        const p = spawnPed('swat', g.x, g.y);
        Object.assign(p, { soldier: true, persistent: true, state: 'idle', homeX: g.x, homeY: g.y, shirt: '#4b5a3a', pants: '#3b4a2e', hair: '#3b4a2e', weapon: 'rifle', hp: 140, maxHp: 140 });
        this.soldiers.push(p);
      }
    }
    if (!near) { for (const p of this.soldiers) p.remove = true; this.soldiers = []; }
    // 출입 경보
    const inside = this.inside(P.px, P.py) && !P.dead;
    if (inside && Wanted.stars < 4 && !Game.noWanted) {
      if (!this.warned) { this.warned = true; UI.big('군사 제한구역', '5초 안에 나가지 않으면 사살 명령이 떨어진다', 2.5, '#ff4d4d'); Sfx.tone({ f0: 900, f1: 600, dur: 0.6, type: 'sawtooth', vol: 0.2 }); }
      this.warnT += dt;
      if (this.warnT > 5) { Wanted.set(4); Wanted.seen = true; UI.toast('기지 경보 발령! 수배 ★★★★'); }
    } else if (!inside) { this.warnT = 0; this.warned = false; }
    if (Wanted.stars > 0) for (const p of this.soldiers) if (p.state !== 'chase' && dist2(p.x, p.y, P.px, P.py) < 110 * 110) { p.state = 'chase'; if (chance(0.3)) Talk.say(p, pick(['침입자다!', '사격 개시!', '기지 봉쇄!']), 2, true); }
  },
};

// ---------- 2D 그리기 ----------
function drawMilVehicle(c) { // drawCar 안(차 좌표계)에서 호출
  const L = c.L, W = c.W, st = c.V.style, dead = c.dead;
  if (st === 'tank') {
    ctx.fillStyle = '#15171a'; ctx.fillRect(-L / 2, -W / 2, L, 0.8); ctx.fillRect(-L / 2, W / 2 - 0.8, L, 0.8);
    ctx.fillStyle = '#2b2d31'; const off = ((c.trackT = (c.trackT || 0) + (c.vf || 0) * 0.05) % 0.8 + 0.8) % 0.8;
    for (let x = -L / 2 + off; x < L / 2; x += 0.8) { ctx.fillRect(x, -W / 2, 0.15, 0.8); ctx.fillRect(x, W / 2 - 0.8, 0.15, 0.8); }
    ctx.fillStyle = dead ? '#26272a' : c.color; ctx.fillRect(-L / 2 + 0.3, -W / 2 + 0.7, L - 0.6, W - 1.4);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-L / 2 + 0.3, W / 2 - 1.1, L - 0.6, 0.4);
    ctx.save(); ctx.rotate(angNorm((c.turret ?? c.a) - c.a));
    ctx.fillStyle = dead ? '#1d1e21' : shade(c.color, -0.15); ctx.beginPath(); ctx.ellipse(-0.3, 0, 1.9, 1.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dead ? '#111' : '#2f3a26'; ctx.fillRect(1.2, -0.18, 4.3, 0.36);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(-0.8, -0.4, 0.4, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
  if (st === 'milheli') {
    ctx.fillStyle = dead ? '#26272a' : c.color;
    ctx.fillRect(-4.6, -0.25, 3.6, 0.5); ctx.fillRect(-4.8, -1, 0.35, 2);
    ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2735'; ctx.beginPath(); ctx.ellipse(1.6, 0, 0.9, 0.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f3a26'; ctx.fillRect(-0.6, -1.9, 1.2, 0.5); ctx.fillRect(-0.6, 1.4, 1.2, 0.5);
    ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 0.22;
    const r = c.rotor || 0; for (let k = 0; k < 4; k++) { const a = r + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.stroke(); }
    if ((c.alt || 0) > 0.1) { ctx.fillStyle = 'rgba(40,40,40,0.12)'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill(); }
    return;
  }
  // 전투기
  const col = dead ? '#26272a' : c.color;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(3.5, -0.6); ctx.lineTo(-5.5, -0.6); ctx.lineTo(-6, 0); ctx.lineTo(-5.5, 0.6); ctx.lineTo(3.5, 0.6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(1.2, -0.5); ctx.lineTo(-2.2, -4.6); ctx.lineTo(-3.4, -4.6); ctx.lineTo(-2.4, -0.5); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(1.2, 0.5); ctx.lineTo(-2.2, 4.6); ctx.lineTo(-3.4, 4.6); ctx.lineTo(-2.4, 0.5); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-4.4, -0.4); ctx.lineTo(-5.8, -2); ctx.lineTo(-6.2, -2); ctx.lineTo(-5.6, -0.4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-4.4, 0.4); ctx.lineTo(-5.8, 2); ctx.lineTo(-6.2, 2); ctx.lineTo(-5.6, 0.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b2735'; ctx.beginPath(); ctx.ellipse(2.8, 0, 1.1, 0.35, 0, 0, TAU); ctx.fill();
  if (!dead && (c.spd || 0) > 20) { ctx.fillStyle = `rgba(255,${150 + Math.random() * 80 | 0},60,0.8)`; ctx.beginPath(); ctx.ellipse(-6.4, 0, 0.8 + Math.random() * 0.4, 0.3, 0, 0, TAU); ctx.fill(); }
}
// 공중에 뜬 기체: 건물 위에 원근 투영해서 그린다
function drawAirborne(amb) {
  for (const c of Game.cars) {
    if (!airborne(c)) continue;
    if (Math.abs(c.x - Cam.x) > Cam.vw / 2 + 30 || Math.abs(c.y - Cam.y) > Cam.vh / 2 + 30) continue;
    const [x, y] = proj(c.x, c.y, c.alt), f = Cam.H / (Cam.H - Math.min(c.alt, Cam.H - 20));
    ctx.save(); ctx.translate(x, y); ctx.rotate(c.a); ctx.scale(f, f);
    drawMilVehicle(c);
    ctx.restore();
  }
  const P = Game.player;
  if (!P.car && P.alt > 1.2) {
    const [x, y] = proj(P.x, P.y, P.alt), f = Cam.H / (Cam.H - Math.min(P.alt, Cam.H - 20));
    ctx.save(); ctx.translate(x, y); ctx.scale(f, f);
    if (P.chute) { // 낙하산 캐노피
      ctx.save(); ctx.rotate(P.a);
      ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 0.06;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.9, s * 2.3); ctx.stroke(); }
      for (let k = 0; k < 5; k++) { ctx.fillStyle = k % 2 ? '#f2f2f2' : '#e0443e'; ctx.fillRect(0.3, -2.5 + k, 1.3, 1); }
      ctx.restore();
    }
    ctx.translate(-P.x, -P.y); drawPed(P);
    ctx.restore();
  }
}
function drawAirShadows(sv) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  const P = Game.player;
  if (!P.car && P.alt > 1.2) { ctx.beginPath(); ctx.ellipse(P.x + (sv ? sv[0] : 0.2) * P.alt * 0.4, P.y + (sv ? sv[1] : 0.3) * P.alt * 0.4, P.chute ? 1.4 : 0.5, P.chute ? 1.4 : 0.5, 0, 0, TAU); ctx.fill(); }
  for (const c of Game.cars) {
    if (!airborne(c)) continue;
    ctx.save(); ctx.translate(c.x + (sv ? sv[0] : 0.2) * c.alt * 0.4, c.y + (sv ? sv[1] : 0.3) * c.alt * 0.4); ctx.rotate(c.a);
    ctx.beginPath(); ctx.ellipse(0, 0, c.L / 2, c.V.special === 'jet' ? 3.5 : 1.3, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
}

// ---------- 낙하산 탈출 ----------
// 비행 중 하차 버튼: 첫 번째 = 착륙, 1.6초 안에 한 번 더 = 뛰어내리기(낙하산). 조종사를 잃은 기체는 추락해 폭발한다.
const Para = {
  bail(P, c) {
    P.car = null; c.driver = null; c.in.raw = 0; c.in.st = 0; c.landing = false;
    c.hp = 0; c.burnT = 99; // 땅에 닿는 순간 폭발 (vehicles.js 추락 처리)
    const s = Math.sin(c.a), co = Math.cos(c.a);
    P.x = c.x - s * (c.W / 2 + 1.5); P.y = c.y + co * (c.W / 2 + 1.5);
    P.alt = c.alt; P.paraT = 0; P.vz = 0; P.chute = false; P.vx = c.vx * 0.6; P.vy = c.vy * 0.6; P.a = c.a;
    UI.toast('탈출! 잠시 뒤 낙하산이 펴진다 — 방향키로 조종');
    Sfx.tone({ x: P.x, y: P.y, f0: 500, f1: 200, dur: 0.3, type: 'triangle', vol: 0.3 });
  },
  update(P, dt) {
    let mx = 0, my = 0;
    if (keyDown('KeyW', 'ArrowUp')) my -= 1; if (keyDown('KeyS', 'ArrowDown')) my += 1;
    if (keyDown('KeyA', 'ArrowLeft')) mx -= 1; if (keyDown('KeyD', 'ArrowRight')) mx += 1;
    if (Pad.active && (Pad.lx || Pad.ly)) { mx = Pad.lx; my = Pad.ly; }
    if (Input.touch.on) { mx = Input.touch.jx; my = Input.touch.jy; }
    const mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; }
    if (Cam.rot) { const c = Math.cos(Cam.rot), s = Math.sin(Cam.rot); [mx, my] = [mx * c - my * s, mx * s + my * c]; }
    P.paraT += dt;
    const open = P.paraT > 1.3;
    if (open && !P.chute) { P.chute = true; Sfx.tone({ x: P.x, y: P.y, f0: 260, f1: 120, dur: 0.3, type: 'triangle', vol: 0.3 }); buzz(40); }
    P.vz = smooth(P.vz, open ? 4.5 : 24, open ? 1.6 : 0.9, dt);
    const hs = open ? 7 : 3;
    P.vx = smooth(P.vx, mx * hs + Game.wind * 0.6, open ? 1.3 : 0.4, dt); P.vy = smooth(P.vy, my * hs, open ? 1.3 : 0.4, dt);
    if (mag > 0.1) P.a = Math.atan2(my, mx);
    P.x = clamp(P.x + P.vx * dt, 8, MW * T - 8); P.y = clamp(P.y + P.vy * dt, 8, MH * T - 8);
    P.alt -= P.vz * dt; P.moving = 0; P.cd -= dt; P.hitFlash -= dt; P.flash -= dt;
    // 건물 옥상보다 낮아지면 거기서 착지(가장자리로 밀려 내려온다)
    const roof = roofAt(P.x, P.y);
    if (P.alt <= roof) {
      const hard = P.vz > 12;
      P.alt = 0; P.chute = false; P.vz = 0; P.vx *= 0.3; P.vy *= 0.3;
      if (hard) P.damage(999, null, 0, 0, 'fall');
      else { P.downT = 0.6; UI.toast(roof > 0 ? '옥상에 착지 — 비상계단으로 내려왔다' : '착지!'); }
      if (roof > 0) [P.x, P.y] = openSpotNear(P.x, P.y);
      pedStatic(P);
    }
  },
};

// ---------- 군 공중 추격 (수배 ★4 이상에서 비행 중이거나 기지 안, ★5면 어디서든) ----------
const AirPatrol = {
  units: [], cd: 0,
  reset() { this.units = []; this.cd = 0; },
  playerAir() { const P = Game.player; return (P.car && airborne(P.car)) || P.alt > 1.2; },
  update(dt) {
    const P = Game.player, s = Wanted.stars;
    this.units = this.units.filter(c => Game.cars.includes(c) && !c.dead && c.burnT <= 0);
    const want = P.dead ? 0 : s >= 5 ? 2 : s >= 4 && (this.playerAir() || Military.inside(P.px, P.py)) ? 1 : 0;
    this.cd -= dt;
    if (this.units.length < want && this.cd <= 0) { this.cd = 30; this.spawn(); }
  },
  spawn() {
    const P = Game.player, a = rand(0, TAU), d = 230;
    const x = clamp(P.px + Math.cos(a) * d, 30, MW * T - 30), y = clamp(P.py + Math.sin(a) * d, 30, MH * T - 30);
    // 플레이어가 전투기를 타고 있으면 전투기가 요격하러 온다
    const jet = P.car && P.car.V.special === 'jet' && chance(0.75);
    const c = new Car(jet ? 'jet' : 'milheli', x, y, Math.atan2(P.py - y, P.px - x), { persistent: true });
    c.alt = jet ? 85 : 72; c.driver = 'ai'; c.driverKind = 'army'; c.ai = { mode: 'air', fireT: 3, gunT: 1.5, burst: 0 };
    if (jet) c.spd = 55;
    c.hp = c.maxHp = jet ? 260 : 320; c.color = jet ? '#5b636b' : '#3d4636'; c.label = jet ? '적 전투기' : '군 공격 헬기';
    Game.cars.push(c); this.units.push(c);
    UI.toast(jet ? '적 전투기가 요격하러 온다!' : '군 공격 헬기가 출격했다!');
  },
};
function airDrive(c, dt) {
  const P = Game.player, ai = c.ai, inp = c.in;
  const leave = (Wanted.stars === 0 && !ai.stay) || P.dead;
  let tx = P.px, ty = P.py;
  if (leave) {
    const a = Math.atan2(c.y - P.py, c.x - P.px); tx = c.x + Math.cos(a) * 100; ty = c.y + Math.sin(a) * 100;
    if (dist(c.x, c.y, P.px, P.py) > 260) c.remove = true;
  }
  const d = dist(c.x, c.y, tx, ty), da = angNorm(Math.atan2(ty - c.y, tx - c.x) - c.a);
  const isJet = c.V.special === 'jet';
  inp.hb = false; inp.up = true;
  if (isJet) { inp.st = clamp(da * 1.6, -1, 1); inp.raw = 1; } // 전투기: 속도를 유지하며 선회, 지나쳐 가면 다시 돌아온다
  else { inp.st = clamp(da * 2, -1, 1); inp.raw = leave ? 1 : d > 70 ? 1 : d > 35 ? 0.35 : -0.3; }
  if (leave || c.alt < 20) return;
  ai.fireT -= dt; ai.gunT -= dt;
  const hitAir = AirPatrol.playerAir(), ang = Math.atan2(P.py + (P.car ? P.car.vy : P.vy) * 0.4 - c.y, P.px + (P.car ? P.car.vx : P.vx) * 0.4 - c.x);
  const pilot = { kind: 'army', car: c, x: c.x, y: c.y, px: c.x, py: c.y, vx: c.vx, vy: c.vy };
  // 적 미사일은 약하게 유도된다 (빠르게 선회하거나 건물 뒤로 피하면 빗나간다)
  if (d < (isJet ? 150 : 95) && Math.abs(da) < 0.35 && ai.fireT <= 0) {
    ai.fireT = rand(2.8, 4.2) * (isJet ? 1.3 : 1);
    if (hitAir) UI.toast('미사일 경보! 급선회로 피하라');
    MilFire.shell(c, ang, 55, 6, 110, [c.x + Math.cos(c.a) * 3, c.y + Math.sin(c.a) * 3], pilot, hitAir, P.car || P, 1.1);
  }
  if (d < (isJet ? 110 : 70) && Math.abs(da) < (isJet ? 0.15 : 0.5) && ai.gunT <= 0) {
    ai.gunT = 0.1; ai.burst++;
    if (ai.burst > 10) { ai.burst = 0; ai.gunT = rand(1.2, 2); }
    fireWeapon(pilot, 'rifle', ang + gauss() * 0.07, 0.8);
  }
}
// 조준선 근처에 떠 있는 적 기체가 있으면 미사일을 공중으로 쏜다
function airTargetAlong(c, ang) {
  for (const q of Game.cars) {
    if (q === c || q.dead || !airborne(q)) continue;
    const d = dist(q.x, q.y, c.x, c.y); if (d > 140) continue;
    if (Math.abs(angNorm(Math.atan2(q.y - c.y, q.x - c.x) - ang)) < 0.3) return true;
  }
  return false;
}
