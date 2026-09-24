'use strict';
/* =====================================================================
 * events.js — 살아 있는 도시
 *
 *  · 날씨: 맑음 · 비 · 폭풍(번개·천둥, 바람) · 안개 — 화면 오른쪽 위 시계 옆에 표시
 *  · 경찰 추격 강화: 검문소 앞 스파이크 스트립(밟으면 타이어 펑크), 밤에는 헬기 서치라이트(3D에도),
 *    ★5가 오래가면 현상금 사냥꾼, ★2부터 경찰 무전
 *  · 랜덤 이벤트(1~2분마다, 화면 밖 가까운 곳): 날치기 · 현금수송차 사고 · 조직 거래 현장 · 교통사고 부상자 ·
 *    강도 도주 차량 · 건물 화재. 파란 '!' 표시로 알려 주고, 도와주거나(보상·시민 지지) 털 수 있다(돈·수배)
 *  · 화재: 불길(파티클)이 번지고, 소방차가 출동한다. 고용센터의 [소방관] 일로 직접 끌 수 있다(소방차 물대포)
 *  · Props: 다른 모듈도 쓰는 공용 소품 목록(2D·3D 모두 그린다) — 스파이크·경주 체크포인트·점프대 등
 * ===================================================================== */

// ---------- 공용 소품 (2D·3D) ----------
// 모듈이 Props.providers에 함수를 넣으면, 그 함수가 돌려준 { x, y, a, w, d, h, z, c, glow } 상자들을 그린다.
const Props = {
  providers: [],
  collect(P, R) {
    const out = [];
    for (const f of this.providers) { try { for (const o of f() || []) if (Math.abs(o.x - P.px) < R && Math.abs(o.y - P.py) < R) out.push(o); } catch (e) { } }
    return out;
  },
  draw2D() { // render.js의 월드 좌표 변환 안에서 호출
    const P = Game.player; if (!P) return;
    for (const o of this.collect(P, Math.max(Cam.vw, Cam.vh) / 2 + 20)) {
      ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a || 0);
      if (o.draw) o.draw(ctx);
      else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-o.w / 2 + 0.25, -o.d / 2 + 0.25, o.w, o.d);
        ctx.fillStyle = o.c; ctx.fillRect(-o.w / 2, -o.d / 2, o.w, o.d);
        if (o.stripe) { ctx.fillStyle = o.stripe; for (let s = -o.w / 2; s < o.w / 2; s += 0.9) ctx.fillRect(s, -o.d / 2, 0.45, o.d); }
      }
      ctx.restore();
    }
  },
};

// ---------- 날씨 ----------
const WEATHER_NAMES = { clear: '맑음', rain: '비', storm: '폭풍', fog: '안개' };
const Weather = {
  type: 'clear', fog: 0, flash: 0, thunderT: 0, boltT: 8,
  pick() { const r = Math.random(); return r < 0.45 ? 'clear' : r < 0.7 ? 'rain' : r < 0.82 ? 'storm' : 'fog'; },
  set(type) { this.type = type; const W = Game.weather; W.rain = type === 'rain' || type === 'storm'; W.nextT = rand(110, 260); if (type !== 'clear') UI.toast(`날씨: ${WEATHER_NAMES[type]}${type === 'storm' ? ' — 길이 미끄럽다, 조심해서 운전하자' : type === 'fog' ? ' — 앞이 잘 안 보인다' : ''}`); },
  update(dt) {
    const W = Game.weather;
    W.nextT -= dt;
    if (W.nextT <= 0) { let t = this.pick(); if (t === this.type) t = this.pick(); this.set(t); }
    const target = this.type === 'storm' ? 1.6 : this.type === 'rain' ? 1 : 0;
    W.intensity = smooth(W.intensity, target, 0.3, dt);
    W.wet = 1 - 0.12 * Math.min(1, W.intensity) - (this.type === 'storm' ? 0.06 : 0);
    this.fog = smooth(this.fog, this.type === 'fog' ? 1 : this.type === 'storm' ? 0.3 : 0, 0.25, dt);
    Game.wind = Math.sin(Game.time * 0.05) * (this.type === 'storm' ? 2.2 : 0.8);
    // 번개·천둥
    this.flash = Math.max(0, this.flash - dt * 2.8);
    if (this.type === 'storm' && W.intensity > 1) {
      this.boltT -= dt;
      if (this.boltT <= 0) { this.boltT = rand(5, 14); this.flash = 1; this.thunderT = rand(0.4, 2.2); }
    }
    if (this.thunderT > 0) { this.thunderT -= dt; if (this.thunderT <= 0 && Sfx.ok && !Sfx.muted) { Sfx.noiseBurst({ dur: 2.6, freq: 180, type: 'lowpass', vol: 1.1, sweep: 0.5 }); Sfx.tone({ f0: 60, f1: 28, dur: 1.8, vol: 0.6 }); } }
  },
  // 화면 전체 덮개: 안개 + 번개 번쩍임 (2D·3D 공통, 화면 좌표)
  drawOverlay() {
    const c = ctx; c.setTransform(1, 0, 0, 1, 0, 0);
    const w = canvas.width, h = canvas.height;
    if (this.fog > 0.02) {
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.12, w / 2, h / 2, Math.max(w, h) * 0.62);
      g.addColorStop(0, `rgba(196,204,214,${0.12 * this.fog})`); g.addColorStop(1, `rgba(196,204,214,${0.72 * this.fog})`);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    if (this.flash > 0.02) { c.fillStyle = `rgba(235,240,255,${0.55 * this.flash})`; c.fillRect(0, 0, w, h); }
  },
  save() { return { type: this.type }; },
  load(o) { this.type = (o && o.type) || 'clear'; this.fog = this.type === 'fog' ? 1 : 0; const W = Game.weather; W.rain = this.type === 'rain' || this.type === 'storm'; W.intensity = W.rain ? 1 : 0; },
};
SaveExt.mods.weather = Weather;

// ---------- 경찰 추격 강화 ----------
const Pursuit = {
  spikes: [], hunters: [], hunterT: 0, radioT: 8, spot: null,
  reset() { this.spikes = []; this.hunters = []; this.hunterT = 0; this.radioT = 8; },
  addSpike(x, y, a, len) { this.spikes.push({ x, y, a, len, t: 100 }); },
  update(dt) {
    const P = Game.player;
    // 스파이크: 차가 밟으면 타이어 펑크
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]; s.t -= dt;
      if (s.t <= 0 || dist(s.x, s.y, P.px, P.py) > 320) { this.spikes.splice(i, 1); continue; }
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      for (const c of Game.cars) {
        if (c.dead || c.flat || c.V.special || (c.driverKind === 'cop' && c.driver === 'ai')) continue;
        const dx = c.x - s.x, dy = c.y - s.y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        if (Math.abs(u) < s.len / 2 + 0.5 && Math.abs(v) < 1.1 + c.L / 3) {
          c.flat = true; Sfx.noiseBurst({ x: c.x, y: c.y, dur: 0.5, freq: 3200, vol: 0.7, sweep: 0.3 });
          for (let k = 0; k < 6; k++) Particles.spark(c.x, c.y);
          if (c === P.car) UI.big('타이어 펑크!', '스파이크를 밟았다 — 페인트샵이나 정비소에서 고쳐라', 2.4, '#ff8a3d');
        }
      }
    }
    // 펑크 난 차: 불꽃 (속도 제한은 vehicles.js)
    for (const c of Game.cars) if (c.flat && !c.dead && c.speed > 6 && Math.random() < dt * 8) Particles.spark(c.x - Math.cos(c.a) * c.L * 0.3, c.y - Math.sin(c.a) * c.L * 0.3);
    // 헬기 서치라이트 목표 (3D용)
    const H = Police.heli;
    if (H && !H.dead && !H.leave) { const tx = Wanted.seen ? P.px : Wanted.searchX, ty = Wanted.seen ? P.py : Wanted.searchY; this.spot = this.spot || { x: tx, y: ty }; this.spot.x = smooth(this.spot.x, lerp(H.x, tx, 0.85), 3, dt); this.spot.y = smooth(this.spot.y, lerp(H.y, ty, 0.85), 3, dt); }
    else this.spot = null;
    // 밤에 서치라이트가 비추면 들킨다
    if (this.spot && Wanted.stars > 0 && nightFactor() > 0.4 && dist(this.spot.x, this.spot.y, P.px, P.py) < 8) { Wanted.seen = true; Wanted.lkpX = P.px; Wanted.lkpY = P.py; Wanted.evadeT = 0; }
    // 현상금 사냥꾼: ★5가 25초 넘게 이어지면
    this.hunters = this.hunters.filter(h => Game.peds.includes(h) && !h.dead);
    if (Wanted.stars >= 5) this.hunterT += dt; else this.hunterT = Math.max(0, this.hunterT - dt * 2);
    if (this.hunterT > 25 && !this.hunters.length && !P.dead) { this.hunterT = 0; this.spawnHunters(); }
    if (Wanted.stars === 0 && this.hunters.length) { for (const h of this.hunters) { h.persistent = false; h.state = 'flee'; h.fleeT = 8; h.fearX = P.px; h.fearY = P.py; } this.hunters = []; }
    // 경찰 무전
    if (Wanted.stars >= 2 && !Missions.active) {
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.radioT = rand(14, 24);
        const dir = ['북', '남', '동', '서'][Math.floor(((Math.atan2(P.vy || 0, P.vx || 1) + Math.PI * 2.25) % TAU) / (Math.PI / 2)) % 4];
        const hood = World.hoods[(blockAt(P.px, P.py) || { hood: 0 }).hood];
        const car = P.car ? `${P.car.V.name}` : '도보';
        const lines = Wanted.seen
          ? [`용의자 ${hood ? hood.name : ''} 부근, ${car}로 ${dir}쪽 이동 중. 전 차량 추격 바람.`, `용의자 확인. ★${Wanted.stars} 등급, 무장 가능성 높음.`, `${hood ? hood.name : '시내'}에 추가 병력 요청한다.`]
          : [`용의자를 놓쳤다. 마지막 목격 지점 중심으로 수색하라.`, `헬기, 서치라이트로 ${hood ? hood.name : '구역'} 수색 바람.`, `검문소 설치 완료, 주요 도로 차단 중.`];
        UI.dialog([['경찰 무전', pick(lines)]]);
      }
    }
  },
  spawnHunters() {
    const P = Game.player;
    const sp = P.car ? offscreenLaneSpot(90, 150) : null;
    if (sp) {
      const c = new Car('muscle', sp.x, sp.y, sp.a, { persistent: true, color: '#111317' });
      c.driver = 'ai'; c.driverKind = 'gang'; c.ai = { mode: 'hunt', repath: 0 }; Game.cars.push(c);
      c.hunterCar = true;
    }
    for (let i = 0; i < 3; i++) {
      const w = eventWalkSpot(40, 75); if (!w) continue;
      const h = spawnPed('civ', w.x, w.y);
      Object.assign(h, { persistent: true, state: 'chase', hunter: true, hp: 150, maxHp: 150, weapon: pick(['rifle', 'shotgun', 'smg']), shirt: '#16181c', pants: '#0d0e10', hat: '#2b2b2b', nameTag: '현상금 사냥꾼' });
      this.hunters.push(h);
    }
    UI.big('현상금 사냥꾼!', '네 목에 걸린 현상금을 노리고 사냥꾼들이 왔다', 3, '#ff4d4d');
  },
  props() { return this.spikes.map(s => ({ x: s.x, y: s.y, a: s.a, w: s.len, d: 0.7, h: 0.12, c: '#24262a', stripe: '#c9ccd2' })); },
};
Props.providers.push(() => Pursuit.props());

// 밤 정도 (0 낮 ~ 1 한밤)
function nightFactor() { const a = ambientAt(Game.clock / 60); return clamp(1 - (a[0] + a[1] + a[2]) / 3 * 1.1, 0, 1); }

// ---------- 화재 ----------
VTYPES.firetruck = { name: '소방차', L: 7.6, W: 2.5, mass: 6500, Fe: 18500, vmax: 36, grip: 1.0, cs: 4.4, steer: 0.46, hp: 420, colors: ['#c8201e'], style: 'fire' };
const Blazes = {
  list: [], trucks: [], t: 90,
  reset() { this.list = []; this.trucks = []; this.t = 90; },
  start(x, y, big = 1) {
    const f = { x, y, hp: 100 * big, maxHp: 100 * big, r: 2.2 + big, t: 0, big, spread: 18 };
    this.list.push(f); return f;
  },
  near(x, y, r) { return this.list.filter(f => dist(f.x, f.y, x, y) < r + f.r); },
  douse(x, y, r, amt) { for (const f of this.list) if (dist(f.x, f.y, x, y) < r + f.r) f.hp -= amt; },
  update(dt) {
    const P = Game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t += dt;
      if (f.hp <= 0) { this.list.splice(i, 1); for (let k = 0; k < 8; k++) Particles.smoke(f.x + rand(-2, 2), f.y + rand(-2, 2), 1.4, '#b8bcc2'); if (f.onOut) f.onOut(f); continue; }
      if (dist(f.x, f.y, P.px, P.py) < 160) {
        const n = Math.min(4, 1 + f.big * 1.5) * (TUNE.particles > 300 ? 1 : 0.5);
        for (let k = 0; k < n; k++) Particles.fire(f.x + rand(-f.r, f.r) * 0.7, f.y + rand(-f.r, f.r) * 0.7, 1 + f.big * 0.3);
        if (Math.random() < dt * 6) Particles.smoke(f.x + rand(-f.r, f.r), f.y + rand(-f.r, f.r), 1.3 + f.big * 0.4, '#3a3a3a');
      }
      // 불 위의 사람·차는 탄다
      if (!P.dead && !P.car && dist(f.x, f.y, P.x, P.y) < f.r) P.damage(14 * dt, null, 0, 0, 'fire');
      for (const c of Game.cars) if (!c.dead && dist(f.x, f.y, c.x, c.y) < f.r + 1 && c.speed < 2) c.damage && c.damage(6 * dt, null);
      // 오래 두면 번진다 (최대 6곳)
      f.spread -= dt;
      if (f.spread <= 0 && this.list.length < 6 && f.hp > f.maxHp * 0.5) { f.spread = rand(18, 30); const a = rand(0, TAU); const nx = f.x + Math.cos(a) * rand(4, 7), ny = f.y + Math.sin(a) * rand(4, 7); if (tileAt(nx, ny) !== TL.WATER && tileAt(nx, ny) !== TL.ROAD) this.start(nx, ny, 0.8); }
    }
    this.updateTrucks(dt);
  },
  // 소방차 자동 출동 (플레이어가 소방관 일을 하고 있지 않을 때)
  updateTrucks(dt) {
    this.trucks = this.trucks.filter(o => Game.cars.includes(o.car) && !o.car.dead);
    for (const o of this.trucks) {
      const c = o.car, f = o.fire;
      if (!this.list.includes(f)) { if (o.stage !== 'leave') { o.stage = 'leave'; c.siren = false; c.persistent = false; if (c.driver === 'ai') { c.ai = { mode: 'traffic', route: [] }; trafficFromHere(c, 'traffic'); } } continue; }
      if (c.driver !== 'ai') continue;
      const d = dist(c.x, c.y, f.x, f.y);
      if (o.stage === 'drive' && d < 22) { o.stage = 'spray'; c.ai = { mode: 'parked' }; }
      if (o.stage === 'spray') { this.douse(f.x, f.y, 3, 9 * dt); if (Math.random() < 0.6) waterSpray(c.x, c.y, f.x, f.y); }
    }
    if (Jobs.active && Jobs.active.id === 'firefighter') return;
    for (const f of this.list) {
      if (f.truck || f.t < 6 || this.trucks.length >= 2 || dist(f.x, f.y, Game.player.px, Game.player.py) > 200) continue;
      const sp = offscreenLaneSpot(60, 140); if (!sp) continue;
      const c = new Car('firetruck', sp.x, sp.y, sp.a, { persistent: true });
      c.driver = 'ai'; c.driverKind = 'medic'; c.siren = true;
      trafficFromHere(c, 'ems'); c.ai.goalD = bfsDist(nearestNode(f.x, f.y).id); c.ai.cruiseFlee = 16;
      Game.cars.push(c); f.truck = c; this.trucks.push({ car: c, fire: f, stage: 'drive' });
    }
  },
  props() { return []; },
};
function waterSpray(x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0) + rand(-0.15, 0.15), d = dist(x0, y0, x1, y1);
  Particles.add({ t: 'water', x: x0 + Math.cos(a) * 2, y: y0 + Math.sin(a) * 2, vx: Math.cos(a) * d * 1.6, vy: Math.sin(a) * d * 1.6, life: 0.55, max: 0.55, size: rand(0.25, 0.45) });
}

// 소방관 일 (고용센터): 소방차로 불을 끈다 — 소방차에 탄 채 공격 키(클릭/Ctrl)로 물대포
JOBS.firefighter = { legal: true, name: '소방관', desc: '소방차를 몰고 도시 곳곳의 불을 끈다. 불 가까이 가서 클릭(또는 Ctrl)을 누르면 물대포. 빨리 끌수록 보너스.', vehicle: 'firetruck', label: '소방차' };
Jobs.u_firefighter = function (j, dt, P) {
  if (!j.fire || !Blazes.list.includes(j.fire)) {
    if (j.fire) { // 방금 껐다
      const bonus = Math.max(0, Math.round((90 - j.fireT) * 12));
      this.pay(j, 900 + j.streak * 150 + bonus, `불을 껐다${bonus ? ` (빠른 진화 +$${bonus})` : ''}`); j.streak++; Empire.support.civ = Math.round((Empire.support.civ + 0.6) * 10) / 10;
      j.fire = null; j.waitT = 3;
    }
    j.waitT = (j.waitT || 0) - dt; if (j.waitT > 0) { this.obj(j, '다음 신고를 기다리는 중…'); return; }
    const s = this.farSpot(P.px, P.py, 180, 420);
    j.fire = Blazes.start(s.x + rand(-2, 2), s.y + rand(-2, 2), 1.3); j.fire.truck = j.car; j.fireT = 0;
    UI.toast('화재 신고! 지도에 표시된 곳으로 출동하라');
  }
  j.fireT += dt;
  const f = j.fire, d = Math.round(dist(P.px, P.py, f.x, f.y));
  j.blips = [{ x: f.x, y: f.y, c: '#ff6b3d', big: true }];
  const fires = Blazes.near(f.x, f.y, 14).length;
  this.obj(j, d > 26 ? `화재 현장까지 ${d}m` : `클릭/Ctrl을 누른 채 불 쪽을 겨눠 물대포 — 불길 ${fires}곳 · ${Math.round(Math.max(0, f.hp))}%`);
  if (j.fireT > 150) { UI.toast('불이 너무 커져 다른 대원이 맡았다'); Blazes.list = Blazes.list.filter(q => dist(q.x, q.y, f.x, f.y) > 16); j.fire = null; j.streak = 0; j.waitT = 3; }
};
// 물대포 (소방차 운전 중 공격 키)
const WaterCannon = {
  update(dt) {
    const P = Game.player, c = P.car;
    if (!c || c.type !== 'firetruck' || c.dead) return;
    const firing = Input.mouse.down || keyDown('ControlLeft', 'KeyJ') || (Pad.active && Pad.rt > 0.4) || Input.touch.fire;
    if (!firing) return;
    // 겨누는 방향: 3D는 카메라 방향, 2D는 마우스 방향
    let a;
    if (Game.view !== 'top' && View3D.ok) a = View3D.yaw;
    else { const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y); a = Math.atan2(wy - c.y, wx - c.x); }
    // 조준 보조: 겨눈 방향 쪽 불을 먼저, 없으면 20m 안의 가장 가까운 불
    let best = null, bs = 1e9;
    for (const f of [...Blazes.list, ...Fires.list]) { const d = dist(c.x, c.y, f.x, f.y); if (d > 20) continue; const da = Math.abs(angNorm(Math.atan2(f.y - c.y, f.x - c.x) - a)); const sc = d + (da < 0.9 ? 0 : 30); if (sc < bs) { bs = sc; best = f; } }
    if (best) a = Math.atan2(best.y - c.y, best.x - c.x);
    const tx = c.x + Math.cos(a) * 16, ty = c.y + Math.sin(a) * 16;
    for (let k = 0; k < 3; k++) waterSpray(c.x, c.y, tx, ty);
    for (let s = 4; s <= 18; s += 3) Blazes.douse(c.x + Math.cos(a) * s, c.y + Math.sin(a) * s, 2.5, 22 * dt);
    for (const f of Fires.list) for (let s = 4; s <= 18; s += 3) if (dist(f.x, f.y, c.x + Math.cos(a) * s, c.y + Math.sin(a) * s) < f.r + 2.5) f.t -= 3 * dt; // 화염병·화염방사기 불도 끈다
    // 사람은 밀려 넘어진다
    for (const p of Game.peds) if (!p.dead && !p.car && dist(p.x, p.y, tx, ty) < 5 && chance(dt * 3)) { p.vx += Math.cos(a) * 8; p.vy += Math.sin(a) * 8; p.downT = Math.max(p.downT, 1.2); }
  },
};

// 인도 위 지점: 화면 밖을 먼저 찾고, 없으면 거리만 맞춘 인도
function eventWalkSpot(minD, maxD) {
  const s = offscreenWalkSpot(minD, maxD) || offscreenWalkSpot(minD * 1.4, maxD * 1.6); if (s) return s;
  const P = Game.player;
  for (let k = 0; k < 12; k++) { const a = rand(0, TAU), r = rand(minD, maxD), q = sidewalkNear(P.px + Math.cos(a) * r, P.py + Math.sin(a) * r, 6); if (q && dist(q.x, q.y, P.px, P.py) > minD * 0.7) return q; }
  return null;
}

// ---------- 랜덤 이벤트 ----------
const RE_TYPES = ['snatch', 'armored', 'deal', 'accident', 'getaway', 'fire'];
const Events = {
  cur: null, t: 45, done: {},
  reset() { if (this.cur) this.end(''); this.cur = null; this.t = 45; },
  save() { return { done: this.done }; },
  load(o) { this.done = (o && o.done) || {}; this.reset(); Pursuit.reset(); Blazes.reset(); },
  targets() {
    const e = this.cur; if (!e) return [];
    const P = Game.player, pts = e.marks ? e.marks() : [];
    return pts.filter(q => dist(q.x, q.y, P.px, P.py) < 260).map(q => ({ x: q.x, y: q.y, c: q.c || '#4fc3ff', big: q.big }));
  },
  busy() { return Missions.active || (Jobs.active && Jobs.active.id !== 'taxi') || GangJob.active || Gangs.war || BankRob.on || Wanted.stars >= 3 || Game.state !== 'play'; },
  update(dt) {
    Pursuit.update(dt); Blazes.update(dt); WaterCannon.update(dt); // 날씨는 main.simulate에서 (메뉴 화면에서도 돈다)
    const P = Game.player; if (!P || P.dead) return;
    if (this.cur) {
      const e = this.cur; e.t += dt;
      const far = e.x !== undefined && dist(e.x, e.y, P.px, P.py) > 330;
      if (e.t > (e.limit || 150) || far) { this.end(far ? '' : e.timeoutMsg || ''); return; }
      try { e.update(dt, P); } catch (err) { console.error(err); this.end(''); }
      return;
    }
    this.t -= dt;
    if (this.t > 0 || this.busy()) return;
    this.t = rand(70, 130);
    const type = pick(RE_TYPES);
    try { const e = this['make_' + type](P); if (e) { e.type = type; e.t = 0; this.cur = e; } } catch (err) { console.error(err); this.cur = null; }
  },
  end(msg) {
    const e = this.cur; if (!e) return;
    for (const q of e.ents || []) if (q) { q.persistent = false; q.evMark = false; }
    this.cur = null;
    if (msg) UI.toast(msg);
  },
  win(type, msg) { this.done[type] = (this.done[type] || 0) + 1; Sfx.passed(); UI.big('도시 이벤트', msg, 2.6, '#4fc3ff'); this.end(''); Save.write(); },
  // 공통: 이벤트 시작 알림
  announce(title, sub) { UI.toast(`${title} — ${sub} (파란 표시)`); Sfx.tone({ f0: 880, f1: 1320, dur: 0.18, type: 'triangle', vol: 0.25 }); },

  // 1) 날치기: 도둑을 잡아 가방을 되찾는다 → 주인에게 돌려주면 사례금 + 시민 지지, 가지면 돈
  make_snatch(P) {
    const w = eventWalkSpot(50, 90); if (!w) return null;
    const victim = spawnPed('civ', w.x, w.y), thief = spawnPed('civ', w.x + 1.5, w.y);
    Object.assign(victim, { persistent: true, state: 'idle', nameTag: '피해자' });
    Object.assign(thief, { persistent: true, state: 'flee', fleeT: 999, fearX: w.x, fearY: w.y, hp: 45, maxHp: 45, shirt: '#3b3b3b', hat: '#1a1a1a', nameTag: '날치기', walkSpeed: 1.8 });
    Talk.say(victim, '도둑이야! 내 가방!', 3, true);
    this.announce('날치기 발생', '도둑을 쫓아 쓰러뜨려라');
    return {
      x: w.x, y: w.y, ents: [victim, thief], stage: 'chase', limit: 120, timeoutMsg: '날치기가 도망쳤다',
      marks() { return this.stage === 'chase' ? [{ x: thief.x, y: thief.y, big: true, c: '#4fc3ff' }] : this.stage === 'return' ? [{ x: victim.x, y: victim.y, big: true, c: '#8df28d' }] : []; },
      update(dt, P) {
        this.x = P.px; this.y = P.py;
        if (this.stage === 'chase') {
          if (!thief.dead && thief.downT <= 0) { thief.state = 'flee'; thief.fleeT = 99; thief.fearX = P.px; thief.fearY = P.py; }
          if ((thief.dead || thief.downT > 0) && dist(P.px, P.py, thief.x, thief.y) < 3) {
            this.stage = 'return'; this.rt = 0;
            UI.big('가방 회수!', '주인(초록 표시)에게 돌려주면 사례금 $800 + 시민 지지 · 45초 안에 안 가면 가방은 네 것 ($1,500)', 3.4, '#4fc3ff');
          }
          if (victim.dead) { Events.end('피해자가 쓰러졌다'); }
        } else if (this.stage === 'return') {
          this.rt += dt;
          if (!victim.dead && dist(P.px, P.py, victim.x, victim.y) < 3.5) { P.money += 800; Empire.support.civ += 1.5; Talk.say(victim, '정말 고마워요!', 2.5, true); Events.win('snatch', '가방을 돌려줬다 +$800 · 시민 지지 +1.5'); }
          else if (this.rt > 45 || victim.dead) { P.money += 1500; Sfx.cash(); Events.end('가방 속 현금을 챙겼다 +$1,500'); }
        }
      },
    };
  },
  // 2) 현금수송차 사고: 부서진 트럭 옆에 돈가방, 경비원 둘 — 털면 ★2
  make_armored(P) {
    const sp = offscreenLaneSpot(70, 140); if (!sp) return null;
    const c = new Car('armored', sp.x, sp.y, sp.a + rand(-0.6, 0.6), { persistent: true }); c.hp = c.maxHp * 0.25; c.ai = { mode: 'parked' }; c.driver = null; Game.cars.push(c);
    const bags = [];
    for (let k = 0; k < 3; k++) bags.push(addPickup('cash', sp.x + rand(-4, 4), sp.y + rand(-4, 4), { amount: randi(2000, 4500), temp: 150 }));
    const guards = [];
    for (let k = 0; k < 2; k++) { const g = spawnPed('cop', sp.x + rand(-3, 3), sp.y + rand(-3, 3)); Object.assign(g, { persistent: true, state: 'idle', shirt: '#4a4f3a', nameTag: '경비원', guard: true }); guards.push(g); }
    this.announce('현금수송차 사고', '돈가방이 흩어졌다 — 가져가면 수배');
    return {
      x: sp.x, y: sp.y, ents: [c, ...guards], limit: 150, timeoutMsg: '견인차가 사고 현장을 정리했다',
      marks() { return bags.filter(b => Game.pickups.includes(b)).map(b => ({ x: b.x, y: b.y, c: '#3fbf5f' })).concat([{ x: sp.x, y: sp.y, big: true }]); },
      update(dt, P) {
        if (Math.random() < dt * 2) Particles.smoke(c.x, c.y, 1.2, '#555');
        const left = bags.filter(b => Game.pickups.includes(b)).length;
        if (left < bags.length && !this.robbed) { this.robbed = true; Wanted.set(Math.max(2, Wanted.stars)); for (const g of guards) if (!g.dead) g.state = 'chase'; UI.toast('경비원: 멈춰! 그 돈 내려놔!'); }
        if (!left) Events.win('armored', '현금수송차의 돈가방을 모두 챙겼다');
      },
    };
  },
  // 3) 조직 거래 현장: 가방을 두고 거래 중 — 덮치면 큰돈 (같은 조직이면 생기지 않는다)
  make_deal(P) {
    const g = pick(GANG_IDS.filter(x => x !== Gangs.mine && GANGS[x])); if (!g) return null;
    const w = eventWalkSpot(60, 110); if (!w) return null;
    const men = [];
    for (let k = 0; k < 4; k++) { const p = spawnPed('gang', w.x + rand(-3, 3), w.y + rand(-3, 3)); setGang(p, g); Object.assign(p, { persistent: true, state: 'idle', homeX: w.x, homeY: w.y, weapon: pick(['smg', 'pistol', 'shotgun']) }); men.push(p); }
    const case_ = addPickup('cash', w.x, w.y, { amount: randi(8000, 15000), temp: 170 });
    this.announce('조직 거래 현장', `${GANGS[g].name}가 거래 중 — 가방을 빼앗아라`);
    return {
      x: w.x, y: w.y, ents: men, limit: 170, timeoutMsg: '거래가 끝나 조직원들이 흩어졌다',
      marks() { return Game.pickups.includes(case_) ? [{ x: case_.x, y: case_.y, big: true }] : []; },
      update(dt, P) {
        if (!this.hot && dist(P.px, P.py, w.x, w.y) < 14) { this.hot = true; for (const m of men) if (!m.dead) { m.state = 'chase'; Talk.say(m, '누구야!', 1.8, true); } }
        if (!Game.pickups.includes(case_)) { if (Gangs.mine) Gangs.addRep(40, '라이벌 거래 습격'); Events.win('deal', `${GANGS[g].name}의 거래 가방을 빼앗았다`); }
      },
    };
  },
  // 4) 교통사고 부상자: 차에 태워 병원으로 (75초)
  make_accident(P) {
    const sp = offscreenLaneSpot(70, 140); if (!sp) return null;
    const c = new Car(pick(['sedan', 'compact', 'van']), sp.x, sp.y, sp.a + rand(-1, 1), { persistent: true }); c.hp = c.maxHp * 0.2; c.ai = { mode: 'parked' }; c.driver = null; Game.cars.push(c);
    const s = sidewalkNear(sp.x, sp.y, 4); const inj = spawnPed('civ', s.x, s.y); Object.assign(inj, { persistent: true, state: 'idle', downT: 9999, nameTag: '부상자' });
    this.announce('교통사고', '부상자를 차에 태워 병원으로 옮기면 보상');
    const hosp = () => { let best = null, bd = 1e9; for (const k of ['hospital', 'hospital2', 'hospital3', 'clinic']) { const h = World.places[k]; if (h) { const d = dist(h.x, h.y, Game.player.px, Game.player.py); if (d < bd) { bd = d; best = h; } } } return best; };
    return {
      x: sp.x, y: sp.y, ents: [c, inj], stage: 'pick', limit: 200, timeoutMsg: '구급차가 먼저 왔다',
      marks() { if (this.stage === 'pick') return [{ x: inj.x, y: inj.y, big: true }]; const h = hosp(); return h ? [{ x: h.x, y: h.y, big: true, c: '#e0443e' }] : []; },
      update(dt, P) {
        if (Math.random() < dt * 2) Particles.smoke(c.x, c.y, 1, '#666');
        if (inj.dead && this.stage === 'pick') { Events.end('부상자가 숨졌다'); return; }
        if (this.stage === 'pick') {
          if (P.car && !P.car.V.special && P.car.speed < 2 && dist(P.car.x, P.car.y, inj.x, inj.y) < 6) { this.stage = 'drive'; this.dt = 0; inj.remove = true; UI.big('부상자 탑승', '75초 안에 병원(빨간 표시)으로!', 2.4, '#4fc3ff'); }
          else if (!P.car && dist(P.px, P.py, inj.x, inj.y) < 4 && !this.hint) { this.hint = true; UI.toast('차를 가져와 부상자 옆에 세우면 태운다'); }
        } else {
          this.dt += dt; const h = hosp(); this.x = P.px; this.y = P.py;
          UI.objective(`부상자를 병원으로: ${Math.max(0, Math.ceil(75 - this.dt))}초 · ${h ? Math.round(dist(P.px, P.py, h.x, h.y)) : '?'}m`);
          if (this.dt > 75 || !P.car) { UI.objective(''); Events.end(!P.car ? '차에서 내려 부상자를 놓쳤다' : '시간 안에 병원에 가지 못했다'); return; }
          if (h && dist(P.px, P.py, h.x, h.y) < 12) { UI.objective(''); P.money += 1000; Empire.support.civ += 2; Events.win('accident', '부상자를 살렸다 +$1,000 · 시민 지지 +2'); }
        }
      },
    };
  },
  // 5) 강도 도주 차량: 경찰을 따돌리는 차를 부수면 현상금
  make_getaway(P) {
    const sp = offscreenLaneSpot(60, 120); if (!sp) return null;
    const c = new Car('sports', sp.x, sp.y, sp.a, { persistent: true, color: '#2b2f36' });
    c.driver = 'ai'; c.driverKind = 'target'; trafficFromHere(c, 'flee'); c.ai.cruiseFlee = 30; Game.cars.push(c);
    this.announce('강도 도주 차량', '은행 강도가 달아난다 — 차를 부수면 현상금 $2,500');
    return {
      x: sp.x, y: sp.y, ents: [c], limit: 140, timeoutMsg: '강도들이 도시를 빠져나갔다',
      marks() { return [{ x: c.x, y: c.y, big: true }]; },
      update(dt, P) {
        this.x = c.x; this.y = c.y;
        if (!Game.cars.includes(c)) { Events.end(''); return; }
        if (c.dead || c.hp < c.maxHp * 0.15 || c.driver !== 'ai') {
          const pos = { x: c.x, y: c.y }; addPickup('cash', pos.x + 2, pos.y, { amount: 2500, temp: 90 });
          Empire.support.off += 1; Events.win('getaway', '강도 차량을 멈췄다 — 현상금 $2,500을 챙겨라 · 공무원 지지 +1');
        }
      },
    };
  },
  // 6) 건물 화재: 소방차가 오지만 먼저 끄면(소방차) 보상
  make_fire(P) {
    const s = eventWalkSpot(80, 150); if (!s) return null;
    const f = Blazes.start(s.x, s.y, 1.2);
    this.announce('화재 발생', '불이 났다 — 소방차가 출동한다');
    return {
      x: s.x, y: s.y, ents: [], limit: 180, timeoutMsg: '',
      marks() { return Blazes.list.includes(f) ? [{ x: f.x, y: f.y, big: true, c: '#ff6b3d' }] : []; },
      update(dt, P) {
        if (!Blazes.near(f.x, f.y, 14).length) { const mine = P.car && P.car.type === 'firetruck' && dist(P.px, P.py, f.x, f.y) < 40; if (mine) { P.money += 1200; Events.win('fire', '불을 껐다 +$1,200'); } else Events.end('소방대가 불을 껐다'); }
      },
    };
  },
};
SaveExt.mods.events = Events;
