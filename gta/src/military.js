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
    const flying = c.driver && !c.landing && (c.alt > 0.5 || Math.abs(raw) > 0.1 || Math.abs(inp.st) > 0.1 || inp.up);
    const target = flying ? 72 : 0;
    c.alt = c.alt < target ? Math.min(target, c.alt + 8 * dt) : Math.max(target, c.alt - (c.landing ? 7 : 5) * dt);
    if (c.landing && c.alt <= 0.05) { c.landing = false; UI.toast('착륙 완료'); }
    c.rotor = (c.rotor || 0) + dt * (c.alt > 0.1 || flying ? 42 : 4);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    if (c.alt > 3) {
      c.vx += cs * raw * 16 * dt; c.vy += sn * raw * 16 * dt;
      c.vx *= Math.exp(-0.9 * dt); c.vy *= Math.exp(-0.9 * dt);
      const sp = Math.hypot(c.vx, c.vy); if (sp > V.vmax) { c.vx *= V.vmax / sp; c.vy *= V.vmax / sp; }
      c.w = inp.st * V.steer;
    } else { c.vx *= Math.exp(-4 * dt); c.vy *= Math.exp(-4 * dt); c.w = c.alt > 0.5 ? inp.st * 0.8 : 0; }
    c.a = angNorm(c.a + c.w * dt);
  } else { // jet
    c.spd = c.spd || 0;
    const air = c.alt > 1.2;
    if (c.driver) {
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
    if (bi >= 0 && World.buildings[bi] && World.buildings[bi].h > c.alt) { c.damage(9999, null); c.burnT = 0.01; UI.toast('건물에 충돌했다!'); }
  }
}

// ---------- 무기 ----------
const MilFire = {
  aim(c) {
    const P = Game.player;
    if (Game.view !== 'top' && View3D.ok) return View3D.yaw;
    if (!Input.usingTouch && !Pad.active) { const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y); return Math.atan2(wy - c.y, wx - c.x); }
    if (Pad.active && (Pad.rx || Pad.ry)) return Math.atan2(Pad.ry, Pad.rx);
    // 터치: 앞쪽의 가장 가까운 적/차량 자동 조준
    let best = null, bs = 1e9;
    for (const q of [...Game.peds, ...Game.cars]) {
      if (q === c || q.dead || (q.kind !== 'car' && (q.kind === 'dog' || q.car))) continue;
      const d = dist(q.x, q.y, c.x, c.y); if (d > 60 || d < 2) continue;
      const da = Math.abs(angNorm(Math.atan2(q.y - c.y, q.x - c.x) - c.a)); if (da > 0.8) continue;
      const hostile = q.state === 'chase' || q.driverKind === 'cop' || q.kind === 'swat' || q.kind === 'cop';
      const sc = d * (hostile ? 0.5 : 1) + da * 20; if (sc < bs) { bs = sc; best = q; }
    }
    return best ? Math.atan2(best.y - c.y, best.x - c.x) : c.a;
  },
  shell(c, ang, speed, radius, dmg, from) {
    const P = Game.player;
    Game.projectiles.push({ type: 'rocket', x: from[0], y: from[1], vx: Math.cos(ang) * speed + c.vx, vy: Math.sin(ang) * speed + c.vy, life: 2.4, by: P, a: ang, big: radius, dmg });
    Sfx.shot(from[0], from[1], 'rocket'); Effects.flash(from[0], from[1], 8, 0.12); crime('gunfire', from[0], from[1]);
  },
  update(c, dt, firing, alt) {
    const P = Game.player, V = c.V;
    c.fireCD = (c.fireCD || 0) - dt; c.altCD = (c.altCD || 0) - dt;
    const ang = this.aim(c);
    if (V.special === 'tank') {
      const d = angNorm(ang - (c.turret ?? c.a));
      c.turret = angNorm((c.turret ?? c.a) + clamp(d, -1.8 * dt, 1.8 * dt));
      if ((firing || alt) && c.fireCD <= 0) {
        c.fireCD = 1.3; const t = c.turret, tip = [c.x + Math.cos(t) * 5.5, c.y + Math.sin(t) * 5.5];
        this.shell(c, t, 60, 8, 230, tip); c.vx -= Math.cos(t) * 1.5; c.vy -= Math.sin(t) * 1.5; Cam.shake = Math.max(Cam.shake, 0.35); buzz(80);
      }
      return;
    }
    // 헬기·전투기: 기관포(발사) + 미사일(드리프트/스페이스)
    if (firing && c.fireCD <= 0) {
      c.fireCD = V.special === 'jet' ? 0.07 : 0.09;
      const a = V.special === 'jet' ? c.a : ang;
      fireWeapon(P, 'rifle', a + gauss() * 0.04, 1);
    }
    if (alt && c.altCD <= 0) {
      c.altCD = 0.7;
      const side = (c.side = -(c.side || 1));
      const from = [c.x + Math.cos(c.a) * 3 - Math.sin(c.a) * side * 1.5, c.y + Math.sin(c.a) * 3 + Math.cos(c.a) * side * 1.5];
      this.shell(c, V.special === 'jet' ? c.a : ang, V.special === 'jet' ? 95 : 60, 7, 180, from);
    }
  },
};

// ---------- 기지 관리 (차량 배치 · 경비병 · 출입 경보) ----------
const Military = {
  slots: [], warnT: 0, warned: false, soldiers: [],
  reset() { this.slots = []; this.soldiers = []; this.warnT = 0; this.warned = false; },
  inside(x, y) { const B = World.base; return B && x > B.x0 && x < B.x1 && y > B.y0 && y < B.y1; },
  update(dt) {
    const B = World.base; if (!B) return;
    const P = Game.player;
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
}
function drawAirShadows(sv) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const c of Game.cars) {
    if (!airborne(c)) continue;
    ctx.save(); ctx.translate(c.x + (sv ? sv[0] : 0.2) * c.alt * 0.4, c.y + (sv ? sv[1] : 0.3) * c.alt * 0.4); ctx.rotate(c.a);
    ctx.beginPath(); ctx.ellipse(0, 0, c.L / 2, c.V.special === 'jet' ? 3.5 : 1.3, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
}
