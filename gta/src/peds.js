'use strict';
/* =====================================================================
 * peds.js — 보행자, 플레이어, 무기/전투, 폭발, 파티클, 픽업
 *
 * 보행자 이동: Craig Reynolds, "Steering Behaviors For Autonomous Characters" (GDC 1999)
 *   - seek(인도 루프 추종), flee(위협에서 도망), separation(군중 분리), evasion(차 피하기)
 * 추격 길찾기: 플레이어를 원점으로 하는 BFS 거리장(Dijkstra map / flow field).
 *   경찰·조직원 수십 명이 경로 하나를 공유하므로 A*를 개별로 돌리는 것보다 싸다.
 *   (Amit Patel, Red Blob Games "Flow Field Pathfinding" 정리 참고)
 * ===================================================================== */

const SKINS = ['#f3cfb1', '#e2b08a', '#c98f65', '#9a6444', '#6b4330'];
const HAIRS = ['#1d1a18', '#3b2618', '#6d4a2a', '#b88a4a', '#d9d2c5', '#8a2d1f'];
const SHIRTS = ['#d64545', '#3f7cc9', '#e3b23c', '#4aa35a', '#8a5cc9', '#e07a3f', '#f0f0f0', '#2f3a4a', '#c95a9a', '#39a8a0'];
const PANTS = ['#2b2f3a', '#3b4a6b', '#5a4a3a', '#1e1e1e', '#6b6b6b', '#c2b280'];

const WEAPONS = {
  fist: { name: '주먹', melee: true, dmg: 11, rate: 0.42, range: 1.35 },
  bat: { name: '야구방망이', melee: true, dmg: 30, rate: 0.62, range: 1.7 },
  pistol: { name: '권총', dmg: 26, rate: 0.3, spread: 0.035, range: 45, snd: 'pistol', price: 250, pack: 36 },
  smg: { name: '기관단총', dmg: 13, rate: 0.085, spread: 0.075, range: 38, snd: 'smg', auto: true, price: 900, pack: 150 },
  shotgun: { name: '샷건', dmg: 12, pellets: 8, rate: 0.9, spread: 0.2, range: 22, snd: 'shotgun', price: 1300, pack: 20 },
  rifle: { name: '돌격소총', dmg: 24, rate: 0.11, spread: 0.035, range: 60, snd: 'pistol', auto: true, price: 3000, pack: 120 },
  grenade: { name: '수류탄', throw: true, rate: 0.9, price: 700, pack: 5 },
  rocket: { name: '로켓 런처', proj: true, rate: 1.3, snd: 'rocket', price: 6000, pack: 6 },
  knife: { name: '전투용 칼', melee: true, dmg: 24, rate: 0.32, range: 1.3, price: 150 },
  katana: { name: '카타나', melee: true, dmg: 48, rate: 0.55, range: 2.0, price: 900 },
  magnum: { name: '매그넘 리볼버', dmg: 62, rate: 0.55, spread: 0.02, range: 55, snd: 'shotgun', price: 1800, pack: 24 },
  sniper: { name: '저격총', dmg: 130, rate: 1.4, spread: 0.003, range: 150, snd: 'shotgun', price: 9000, pack: 20 },
  minigun: { name: '미니건', dmg: 14, rate: 0.035, spread: 0.09, range: 48, snd: 'smg', auto: true, price: 25000, pack: 500 },
  flamer: { name: '화염방사기', flame: true, rate: 0.06, range: 8, auto: true, price: 12000, pack: 300 },
  molotov: { name: '화염병', throw: true, molotov: true, rate: 0.9, price: 900, pack: 5 },
};
const WEAPON_ORDER = ['fist', 'knife', 'bat', 'katana', 'pistol', 'magnum', 'smg', 'shotgun', 'rifle', 'minigun', 'sniper', 'flamer', 'grenade', 'molotov', 'rocket'];
// 불길(화염병·화염방사기): 잠시 남아 들어온 사람·차를 태운다
const Fires = {
  list: [],
  add(x, y, r, t, by) { if (this.list.length > 40) this.list.shift(); this.list.push({ x, y, r, t, by, tick: 0 }); },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t -= dt; f.tick -= dt;
      if (Math.random() < 0.8) Particles.fire(f.x + rand(-f.r, f.r) * 0.7, f.y + rand(-f.r, f.r) * 0.7, 1.2);
      if (f.tick <= 0) {
        f.tick = 0.3;
        const P = Game.player;
        for (const p of [...Game.peds, P]) if (!p.dead && !p.car && !(p.alt > 1.2) && dist2(p.x, p.y, f.x, f.y) < f.r * f.r) p.damage(p === P ? 6 : 14, f.by, 0, 0, 'fire');
        for (const c of Game.cars) if (!c.dead && !(c.alt > 1.2) && dist2(c.x, c.y, f.x, f.y) < (f.r + 1.5) ** 2) c.damage(8, f.by === P ? P : null);
        scarePeds(f.x, f.y, 12);
      }
      if (f.t <= 0) this.list.splice(i, 1);
    }
  },
};

class Ped {
  constructor(kind, x, y) {
    this.kind = kind; this.id = _eid++;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.a = rand(-Math.PI, Math.PI);
    this.r = 0.36; this.dead = false; this.deadT = 0; this.downT = 0; this.anim = Math.random() * 10;
    this.state = 'walk'; this.block = null; this.s = 0; this.dir = chance(0.5) ? 1 : -1;
    this.walkSpeed = rand(1.1, 1.6); this.fleeT = 0; this.fearX = x; this.fearY = y;
    this.cd = rand(0.2, 1); this.car = null; this.weapon = 'fist'; this.moving = 0; this.persistent = false;
    this.skin = pick(SKINS); this.hair = pick(HAIRS); this.shirt = pick(SHIRTS); this.pants = pick(PANTS);
    this.hp = 60; this.aimT = 0; this.flash = 0; this.hitFlash = 0;
    if (kind === 'cop') { this.hp = 100; this.shirt = '#1f3b73'; this.pants = '#16223d'; this.hair = '#101010'; this.weapon = 'pistol'; this.walkSpeed = 1.3; }
    if (kind === 'swat') { this.hp = 160; this.shirt = '#20252b'; this.pants = '#15181c'; this.hair = '#20252b'; this.weapon = 'rifle'; }
    if (kind === 'gang') { this.gang = 'dragon'; this.hp = 80; this.shirt = '#1f8a4c'; this.pants = '#1a1a1a'; this.weapon = chance(0.35) ? 'smg' : chance(0.5) ? 'pistol' : 'bat'; this.state = 'idle'; }
    if (kind === 'target') { this.hp = 120; this.shirt = '#f2f2f2'; this.pants = '#111'; this.weapon = 'pistol'; this.state = 'idle'; }
    this.maxHp = this.hp;
  }
  get px() { return this.car ? this.car.x : this.x; }
  get py() { return this.car ? this.car.y : this.y; }
  get alive() { return !this.dead; }

  damage(amt, by, dx = 0, dy = 0, kind = 'bullet') {
    if (this.dead || this.invuln) return;
    if (this === Game.player) this.lastHurt = Game.time;
    // 난이도: NPC가 플레이어에게 주는 피해는 줄인다(GTA도 플레이어 피격 배율이 낮다)
    if (this === Game.player && by && by !== this) amt *= 0.4;
    if (this === Game.player && this.guardT > 0) amt *= 0.6; // 진통제
    if (this.armor) { const ab = Math.min(this.armor, amt * 0.8); this.armor -= ab; amt -= ab; }
    this.hp -= amt; this.hitFlash = 0.12;
    if (this === Game.player && amt > 1) buzz(Math.min(60, 15 + amt));
    this.vx += dx * (kind === 'melee' ? 3 : 1.2); this.vy += dy * (kind === 'melee' ? 3 : 1.2);
    for (let i = 0; i < Math.min(8, amt / 3); i++) Particles.blood(this.x, this.y, dx, dy);
    if (this.hp <= 0) { this.die(by, dx, dy); return; }
    if (this === Game.player) return;
    if (kind === 'melee' && chance(0.35)) this.downT = 0.9;
    const byPlayer = by === Game.player;
    if (this.kind === 'civ') { this.state = 'flee'; this.fleeT = 10; this.fearX = by ? by.px : this.x - dx; this.fearY = by ? by.py : this.y - dy; if (byPlayer) crime('assault', this.x, this.y); if (byPlayer && chance(0.12) && this.hp > 20) { this.state = 'fight'; } }
    else if (this.kind === 'cop' || this.kind === 'swat') { this.state = 'chase'; if (byPlayer) crime('hitCop', this.x, this.y); }
    else if (this.kind === 'gang' || this.kind === 'guard' || this.kind === 'target') { if (byPlayer) aggroGang(this.x, this.y, this.kind, this.gang); }
  }
  die(by, dx, dy) {
    this.dead = true; this.hp = 0; this.deadT = 0;
    this.vx += dx * 2; this.vy += dy * 2;
    Decals.blood(this.x, this.y);
    if (this === Game.player) return;
    const byPlayer = by === Game.player;
    if (byPlayer) {
      if (this.kind === 'cop' || this.kind === 'swat') crime('killCop', this.x, this.y);
      else if (this.kind === 'civ') crime('kill', this.x, this.y);
      // 돈 떨어뜨리기 (GTA 전통)
      const amt = this.kind === 'gang' ? randi(20, 90) : this.kind === 'civ' ? randi(5, 45) : 0;
      if (amt > 0) addPickup('cash', this.x + rand(-0.5, 0.5), this.y + rand(-0.5, 0.5), { amount: amt, temp: 30 });
      if ((this.kind === 'cop' || this.kind === 'gang' || this.kind === 'swat') && this.weapon !== 'fist' && chance(0.6)) addPickup('weapon', this.x + rand(-0.8, 0.8), this.y + rand(-0.8, 0.8), { wname: this.weapon, amount: Math.ceil((WEAPONS[this.weapon].pack || 1) / 3), temp: 30 });
    }
    scarePeds(this.x, this.y, 18);
    Missions.onKill(this, by); Gangs.onKill(this, by);
  }
}

// ---------- 플레이어 ----------
class PlayerPed extends Ped {
  constructor(x, y) {
    super('player', x, y);
    this.shirt = '#f2f2f2'; this.pants = '#34495e'; this.skin = '#e2b08a'; this.hair = '#1d1a18';
    this.hp = 100; this.maxHp = 100; this.armor = 0; this.money = 0; this.displayMoney = 0;
    this.inv = { fist: Infinity }; this.weapon = 'fist'; this.state = 'player';
    this.aim = 0; this.bustT = 0; this.stamina = 1; this.exhausted = false; this.boostT = 0; this.alt = 0;
    this.bornT = typeof Game !== 'undefined' ? Game.time || 0 : 0; // 막 태어난(리스폰) 직후 몇 초는 단속 유예
  }
}

function giveWeapon(p, w, ammo) {
  if (!(w in p.inv)) p.inv[w] = 0;
  if (WEAPONS[w].melee) p.inv[w] = Infinity; else p.inv[w] += ammo;
  if (p === Game.player && (p.weapon === 'fist' || p.weapon === 'bat')) p.weapon = w;
}
function cycleWeapon(p, dir) {
  const owned = WEAPON_ORDER.filter(w => p.inv[w] > 0);
  let i = owned.indexOf(p.weapon); if (i < 0) i = 0;
  p.weapon = owned[(i + dir + owned.length) % owned.length];
  UI.weaponFlash = 1;
}

// ---------- 공격 ----------
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function fireWeapon(shooter, wname, ang, accuracy = 1) {
  const W = WEAPONS[wname];
  const isPlayer = shooter === Game.player;
  const ox = shooter.px + Math.cos(ang) * (shooter.car ? shooter.car.W / 2 + 0.6 : 0.6), oy = shooter.py + Math.sin(ang) * (shooter.car ? shooter.car.W / 2 + 0.6 : 0.6);
  if (W.melee) {
    Sfx.shot(ox, oy, 'punch');
    const targets = [...Game.peds, Game.player].filter(p => p !== shooter && !p.dead && !p.car);
    for (const p of targets) {
      const d = dist(p.x, p.y, shooter.x, shooter.y);
      if (d > W.range + p.r) continue;
      const da = Math.abs(angNorm(Math.atan2(p.y - shooter.y, p.x - shooter.x) - ang));
      if (da > 0.9) continue;
      p.damage(W.dmg, shooter, Math.cos(ang), Math.sin(ang), 'melee');
      Sfx.hit(p.x, p.y);
      break;
    }
    for (const c of Game.cars) if (dist(c.x, c.y, ox, oy) < c.L / 2) { c.damage(W.dmg * 0.1, isPlayer ? shooter : null); }
    return;
  }
  if (W.flame) { // 화염방사기: 앞쪽 부채꼴을 태운다
    const P = Game.player;
    for (let k = 0; k < 3; k++) { const a = ang + rand(-0.18, 0.18), d = rand(1, W.range); Particles.fire(ox + Math.cos(a) * d, oy + Math.sin(a) * d, 1.3); }
    if (Math.random() < 0.3) Sfx.tone({ x: ox, y: oy, f0: 180, f1: 120, dur: 0.12, type: 'sawtooth', vol: 0.06 });
    const hitCone = (x, y) => { const d = dist(x, y, ox, oy); return d < W.range && Math.abs(angNorm(Math.atan2(y - oy, x - ox) - ang)) < 0.28 && losClear(ox, oy, x, y); };
    for (const p of [...Game.peds, P]) if (p !== shooter && !p.dead && !p.car && hitCone(p.x, p.y)) p.damage(p === P ? 1.5 : 5, shooter, Math.cos(ang) * 0.3, Math.sin(ang) * 0.3, 'fire');
    for (const c of Game.cars) if (c !== shooter.car && !c.dead && hitCone(c.x, c.y)) c.damage(2.5, isPlayer ? shooter : null);
    if (isPlayer && Math.random() < 0.2) crime('gunfire', ox, oy);
    if (Math.random() < 0.08) Fires.add(ox + Math.cos(ang) * W.range * 0.7, oy + Math.sin(ang) * W.range * 0.7, 1.6, 2.5, shooter);
    return;
  }
  if (W.throw) {
    Sfx.shot(ox, oy, 'throw');
    const sp = 14;
    Game.projectiles.push({ type: 'grenade', molotov: !!W.molotov, x: ox, y: oy, vx: Math.cos(ang) * sp + (shooter.vx || 0) * 0.5, vy: Math.sin(ang) * sp + (shooter.vy || 0) * 0.5, z: 1, vz: 5, fuse: W.molotov ? 0.9 : 2.2, by: shooter });
    if (isPlayer) crime('gunfire', ox, oy);
    return;
  }
  if (W.proj) {
    Sfx.shot(ox, oy, 'rocket');
    Game.projectiles.push({ type: 'rocket', x: ox, y: oy, vx: Math.cos(ang) * 38, vy: Math.sin(ang) * 38, life: 2.6, by: shooter, a: ang });
    Effects.flash(ox, oy, 6, 0.1);
    if (isPlayer) crime('gunfire', ox, oy);
    return;
  }
  Sfx.shot(ox, oy, W.snd);
  Effects.flash(ox, oy, 5, 0.05);
  shooter.flash = 0.06;
  Particles.shell(ox, oy, ang);
  const pellets = W.pellets || 1;
  for (let k = 0; k < pellets; k++) {
    const a = ang + gauss() * W.spread * (1 / (accuracy * (isPlayer ? shooter.aimSkill || 1 : 1)));
    const dx = Math.cos(a), dy = Math.sin(a);
    let maxD = rayWall(ox, oy, dx, dy, W.range);
    let hit = null, hitD = maxD;
    const testCircle = (cx, cy, r) => {
      const fx = ox - cx, fy = oy - cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
      const disc = b * b - c; if (disc < 0) return -1;
      const t = -b - Math.sqrt(disc); return t > 0 ? t : -1;
    };
    for (const p of Game.peds) {
      if (p.dead || p === shooter || p.car) continue;
      if (Math.abs(p.x - ox) > hitD + 1 && Math.abs(p.y - oy) > hitD + 1) continue;
      const t = testCircle(p.x, p.y, p.r + 0.15); if (t > 0 && t < hitD) { hitD = t; hit = p; }
    }
    const P = Game.player;
    if (!isPlayer && !P.dead && !P.car) { const t = testCircle(P.x, P.y, P.r + 0.1); if (t > 0 && t < hitD) { hitD = t; hit = P; } }
    for (const c of Game.cars) {
      if (c === shooter.car) continue;
      if (dist2(c.x, c.y, ox, oy) > (hitD + c.L) ** 2) continue;
      for (const [cx, cy] of c.circles()) { const t = testCircle(cx, cy, c.r); if (t > 0 && t < hitD) { hitD = t; hit = c; } }
    }
    if (Police.heli && !Police.heli.dead && shooter.kind !== 'heli' && (isPlayer)) {
      const t = testCircle(Police.heli.x, Police.heli.y, 3.2); if (t > 0 && t < hitD) { hitD = t; hit = Police.heli; }
    }
    const hx = ox + dx * hitD, hy = oy + dy * hitD;
    Effects.tracer(ox, oy, hx, hy, isPlayer ? '#ffe9a8' : '#ffb38a');
    if (hit) {
      if (hit.kind === 'car') {
        hit.damage(W.dmg * 0.35, isPlayer ? shooter : null);
        Particles.spark(hx, hy); Sfx.hit(hx, hy);
        if (hit.driver === 'player' && !isPlayer) P.damage(W.dmg * 0.25 * (hit.V.armor || 1), shooter, 0, 0, 'car'); // 장갑차량은 탑승자도 보호
        if (hit.driver === 'ai' && hit.ai && hit.driverKind === 'civ') { hit.ai.panic = true; if (chance(0.15)) bailOut(hit, true); }
        if (isPlayer && hit.type === 'police') crime('hitCop', hx, hy);
      } else if (hit.kind === 'heli') { hit.hp -= W.dmg; Particles.spark(hx, hy); if (isPlayer) crime('hitCop', hx, hy); }
      else hit.damage(W.dmg, shooter, dx, dy);
    } else if (maxD < W.range) { Particles.spark(hx - dx * 0.1, hy - dy * 0.1); }
  }
  if (isPlayer) crime('gunfire', ox, oy);
  else scarePeds(ox, oy, 14);
}

// ---------- 폭발 ----------
function explode(x, y, radius, dmg, by, source, alt = 0) {
  Sfx.explosion(x, y);
  Effects.boom(x, y, radius);
  Decals.scorch(x, y, radius * 0.45);
  const dc = dist(x, y, Cam.x, Cam.y);
  Cam.shake = Math.max(Cam.shake, clamp(1.6 - dc / 60, 0, 1.4));
  if (dc < 40) buzz(120);
  for (let i = 0; i < 40; i++) Particles.fire(x + rand(-radius, radius) * 0.35, y + rand(-radius, radius) * 0.35, 2);
  for (let i = 0; i < 18; i++) Particles.smoke(x + rand(-2, 2), y + rand(-2, 2), 2.5, '#303030');
  for (let i = 0; i < 16; i++) Particles.debris(x, y);
  const P = Game.player;
  const peds = [...Game.peds, P];
  for (const p of peds) {
    if (p.dead) continue;
    if (p.car) { if (p === P && p.car === source) P.damage(999, by, 0, 0, 'explosion'); continue; }
    if (Math.abs((p.alt || 0) - alt) > radius) continue;
    const d = dist(p.x, p.y, x, y);
    if (d < radius) { const f = 1 - d / radius; const nx = (p.x - x) / (d || 1), ny = (p.y - y) / (d || 1); p.downT = 1.5; p.damage(dmg * f * (p === P ? 0.6 : 1), by, nx * 6 * f, ny * 6 * f, 'explosion'); }
  }
  for (const c of Game.cars) {
    if (c === source || Math.abs((c.alt || 0) - alt) > radius) continue; // 높이가 다른 기체는 폭발에 휘말리지 않는다
    const d = dist(c.x, c.y, x, y);
    if (d < radius * 1.3) {
      const f = 1 - d / (radius * 1.3), nx = (c.x - x) / (d || 1), ny = (c.y - y) / (d || 1);
      c.vx += nx * 9 * f; c.vy += ny * 9 * f; c.w += rand(-2, 2) * f;
      c.damage(dmg * f * 1.4, by === P ? P : null);
      if (c.driver === 'ai' && c.ai) c.ai.panic = true;
    }
  }
  const H = Police.heli;
  if (H && !H.dead && dist(H.x, H.y, x, y) < radius + 2) { H.hp -= dmg * 2; }
  if (by === P) crime(source && source.kind === 'car' ? 'destroyCar' : 'explosion', x, y);
  scarePeds(x, y, 45);
  if (source && source.kind === 'car') Missions.onCarDestroyed(source, by);
}

function updateProjectiles(dt) {
  const arr = Game.projectiles;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    if (p.type === 'rocket') {
      p.life -= dt;
      // 유도: 목표 쪽으로 제한된 속도로 선회
      if (p.target) {
        const Q = p.target, gone = Q.dead || (Q.kind === 'car' && (!Game.cars.includes(Q) || Q.burnT > 0)) || (Q.kind === 'heli' && Police.heli !== Q);
        if (gone) p.target = null;
        else {
          const cur = Math.atan2(p.vy, p.vx), sp = Math.hypot(p.vx, p.vy);
          const na = cur + clamp(angNorm(Math.atan2(Q.y - p.y, Q.x - p.x) - cur), -p.turn * dt, p.turn * dt);
          p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; p.a = na;
          const qa = Q.kind === 'heli' ? Q.alt : (Q.alt || 0);
          p.air = qa > 1.2;
          if (dist2(Q.x, Q.y, p.x, p.y) < 9) { p.alt = qa; explode(p.x, p.y, p.big || 7, p.dmg || 150, p.by, null, qa); if (Q.kind === 'heli') Q.hp -= (p.dmg || 150) * 2; arr.splice(i, 1); continue; }
        }
      }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      Particles.smoke(p.x, p.y, 0.8, '#d0d0d0'); if (Math.random() < 0.7) Particles.fire(p.x, p.y, 0.6);
      // p.air: 공중 목표를 노린 미사일 (지상 물체·건물은 지나친다)
      let boom = p.life <= 0 || !p.air && solidT(Math.floor(nx / T), Math.floor(ny / T)) && tileAt(nx, ny) === TL.BUILD;
      if (!boom) for (const c of Game.cars) { if (c === (p.by.car || null) || (c.alt > 1.2) !== !!p.air) continue; if (dist2(c.x, c.y, nx, ny) < (c.L / 2 + (p.air ? 1.5 : 0.3)) ** 2) { boom = true; p.alt = c.alt || 0; break; } }
      if (!boom && !p.air) for (const q of Game.peds) { if (!q.dead && q !== p.by && !q.car && dist2(q.x, q.y, nx, ny) < 0.8) { boom = true; break; } }
      const PP = Game.player;
      if (!boom && p.by !== PP && !PP.car && !PP.dead && (PP.alt > 1.2) === !!p.air && dist2(PP.x, PP.y, nx, ny) < (p.air ? 3 : 0.8)) { boom = true; if (p.air) p.alt = PP.alt; }
      const H = Police.heli; if (!boom && H && !H.dead && p.by === Game.player && dist2(H.x, H.y, nx, ny) < 12) boom = true;
      p.x = nx; p.y = ny;
      if (boom) { explode(p.x, p.y, p.big || 7, p.dmg || 150, p.by, null, p.alt || 0); arr.splice(i, 1); }
    } else if (p.type === 'grenade') {
      p.fuse -= dt;
      p.vz -= 18 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.4; p.vx *= 0.7; p.vy *= 0.7; }
      let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (solidT(Math.floor(nx / T), Math.floor(p.y / T))) { p.vx = -p.vx * 0.5; nx = p.x; }
      if (solidT(Math.floor(p.x / T), Math.floor(ny / T))) { p.vy = -p.vy * 0.5; ny = p.y; }
      p.x = nx; p.y = ny;
      if (p.fuse <= 0) {
        if (p.molotov) { Fires.add(p.x, p.y, 3.2, 5, p.by); Sfx.tone({ x: p.x, y: p.y, f0: 400, f1: 90, dur: 0.4, type: 'sawtooth', vol: 0.2 }); for (let k = 0; k < 20; k++) Particles.fire(p.x + rand(-2, 2), p.y + rand(-2, 2), 1.6); if (p.by === Game.player) crime('explosion', p.x, p.y); }
        else explode(p.x, p.y, 7, 130, p.by, null);
        arr.splice(i, 1);
      }
    }
  }
}

// ---------- 공포 전파 ----------
function scarePeds(x, y, r) {
  for (const p of Game.peds) {
    if (p.dead || p.car) continue;
    if (p.kind === 'civ' && !p.invuln && dist2(p.x, p.y, x, y) < r * r && p.state !== 'fight') { if (p.state !== 'flee' && chance(0.3)) Talk.line(p, 'scream'); p.state = 'flee'; p.fleeT = rand(6, 11); p.fearX = x; p.fearY = y; }
  }
}
function aggroGang(x, y, kind, gang) {
  for (const p of Game.peds) {
    if (p.dead) continue;
    if (p.kind === 'gang' && gang && p.gang !== gang) continue;
    if (Gangs.friendly(p) || p.escort) continue; // 내 조직원은 나를 공격하지 않는다
    if ((p.kind === 'gang' || p.kind === 'guard' || (p.kind === 'target' && kind !== 'gang')) && dist2(p.x, p.y, x, y) < 45 * 45) { if (p.kind === 'target' && p.mission && p.mission.onAlert) p.mission.onAlert(); else p.state = 'chase'; }
  }
}

// ---------- 흐름장(flow field) 길찾기 ----------
const Nav = {
  N: 90, ox: 0, oy: 0, d: null, t: 0,
  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.35;
    const N = this.N, P = Game.player;
    if (!this.d) this.d = new Int16Array(N * N);
    const d = this.d; d.fill(-1);
    const ptx = Math.floor(P.px / T), pty = Math.floor(P.py / T);
    this.ox = ptx - (N >> 1); this.oy = pty - (N >> 1);
    const q = new Int32Array(N * N); let h = 0, t = 0;
    const sx = ptx - this.ox, sy = pty - this.oy;
    d[sx + sy * N] = 0; q[t++] = sx + sy * N;
    while (h < t) {
      const c = q[h++], cx = c % N, cy = (c / N) | 0, cd = d[c];
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = nx + ny * N; if (d[ni] >= 0) continue;
        if (solidT(nx + this.ox, ny + this.oy)) continue;
        d[ni] = cd + 1; q[t++] = ni;
      }
    }
  },
  dir(x, y) {
    const N = this.N, tx = Math.floor(x / T) - this.ox, ty = Math.floor(y / T) - this.oy;
    if (tx < 1 || ty < 1 || tx >= N - 1 || ty >= N - 1 || !this.d) return null;
    const c = this.d[tx + ty * N]; if (c < 0) return null;
    let best = c, bx = 0, by = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const v = this.d[tx + dx + (ty + dy) * N];
      if (v < 0 || v >= best) continue;
      if (dx && dy && (this.d[tx + dx + ty * N] < 0 || this.d[tx + (ty + dy) * N] < 0)) continue;
      best = v; bx = dx; by = dy;
    }
    if (best === c) return null;
    const gx = (tx + bx + this.ox + 0.5) * T, gy = (ty + by + this.oy + 0.5) * T;
    const l = dist(x, y, gx, gy) || 1;
    return [(gx - x) / l, (gy - y) / l];
  },
};

// ---------- 보행자 AI ----------
function spawnPed(kind, x, y) {
  const p = new Ped(kind, x, y);
  Game.peds.push(p);
  return p;
}
function pedSeek(p, tx, ty, speed, dt, accel = 12) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  let dvx = 0, dvy = 0;
  if (d > 0.05) { const s = Math.min(speed, d * 3); dvx = dx / d * s; dvy = dy / d * s; }
  p.vx = smooth(p.vx, dvx, accel * 0.5, dt); p.vy = smooth(p.vy, dvy, accel * 0.5, dt);
}
function returnToWalk(p) {
  let b = blockAt(p.x, p.y);
  if (!b) { let bd = 1e18; for (const bb of World.blocks) { const d = dist2(p.x, p.y, (bb.loop.x0 + bb.loop.x1) / 2, (bb.loop.y0 + bb.loop.y1) / 2); if (d < bd) { bd = d; b = bb; } } }
  p.block = b; p.s = loopParam(b.loop, p.x, p.y); p.state = 'walk'; p.seg = -1;
}
function segOf(loop, s) { s = ((s % loop.P) + loop.P) % loop.P; return s < loop.w ? 0 : s < loop.w + loop.h ? 1 : s < 2 * loop.w + loop.h ? 2 : 3; }

function updatePed(p, dt) {
  p.hitFlash -= dt; p.flash -= dt;
  if (p.dead) { p.deadT += dt; p.vx *= Math.exp(-4 * dt); p.vy *= Math.exp(-4 * dt); p.x += p.vx * dt; p.y += p.vy * dt; pedStatic(p); return; }
  if (p.downT > 0) { p.downT -= dt; p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt); p.x += p.vx * dt; p.y += p.vy * dt; pedStatic(p); return; }
  p.cd -= dt;
  const P = Game.player;
  switch (p.state) {
    case 'walk': {
      if (!p.block) { returnToWalk(p); break; }
      const L = p.block.loop;
      p.s += p.dir * p.walkSpeed * dt;
      const seg = segOf(L, p.s);
      if (p.seg !== undefined && p.seg !== -1 && seg !== p.seg && chance(0.3)) {
        // 모퉁이: 길 건너기
        const [cx, cy] = loopPoint(L, p.s);
        const outs = [];
        if (Math.abs(cx - L.x0) < 1) outs.push([-1, 0]); if (Math.abs(cx - L.x1) < 1) outs.push([1, 0]);
        if (Math.abs(cy - L.y0) < 1) outs.push([0, -1]); if (Math.abs(cy - L.y1) < 1) outs.push([0, 1]);
        const o = outs.length ? pick(outs) : null;
        if (o) {
          const tx = cx + o[0] * 3 * T, ty = cy + o[1] * 3 * T, nb = blockAt(tx, ty);
          if (nb && tileAt(tx, ty) === TL.WALK) {
            p.state = 'cross'; p.tx = tx; p.ty = ty; p.nb = nb; p.waitT = rand(0.3, 1.2); p.jay = false; p.holdT = 0;
            p.crossNode = nearestNode((cx + tx) / 2, (cy + ty) / 2); p.crossCarDir = o[0] !== 0 ? 1 : 0; // 가로로 건너면 세로 도로(남북 신호)
          }
        }
      }
      p.seg = seg;
      // 가끔 블록 중간에서 무단횡단하는 시민
      if (p.kind === 'civ' && chance(dt * 0.006)) {
        const [cx, cy] = loopPoint(L, p.s), out = [[0, -1], [1, 0], [0, 1], [-1, 0]][seg];
        const tx = cx + out[0] * 3 * T, ty = cy + out[1] * 3 * T, nb = blockAt(tx, ty);
        const mid = tileAt(cx + out[0] * 1.5 * T, cy + out[1] * 1.5 * T);
        if (nb && nb !== p.block && tileAt(tx, ty) === TL.WALK && mid === TL.ROAD) { p.state = 'cross'; p.tx = tx; p.ty = ty; p.nb = nb; p.waitT = rand(0, 0.5); p.jay = true; p.crossNode = null; }
      }
      const [tx, ty] = loopPoint(L, p.s + p.dir * 0.6);
      if (dist2(tx, ty, p.x, p.y) > 36) p.s = loopParam(L, p.x, p.y);
      pedSeek(p, tx, ty, p.walkSpeed * 1.2, dt);
      dodgeCars(p);
      break;
    }
    case 'cross': {
      p.holdT = (p.holdT || 0) + dt;
      // 준법 시민은 차량 신호가 빨간불이 될 때까지 기다린다 (30초가 지나면 포기하고 건넘)
      const onRoad = tileAt(p.x, p.y) === TL.ROAD;
      const mustWait = !p.jay && !onRoad && p.crossNode && p.crossNode.light && lightState(p.crossNode, p.crossCarDir) !== 'r' && p.holdT < 30;
      if (p.waitT > 0 || mustWait) { p.waitT -= dt; p.vx *= 0.8; p.vy *= 0.8; if (!mustWait || p.holdT > 0.5) p.a = Math.atan2(p.ty - p.y, p.tx - p.x); break; }
      if (p.jay && onRoad) Jay.npcSeen(p);
      pedSeek(p, p.tx, p.ty, p.walkSpeed * (p.jay ? 1.8 : 1.3), dt);
      if (dist2(p.x, p.y, p.tx, p.ty) < 0.8) { p.block = p.nb; p.s = loopParam(p.block.loop, p.x, p.y); p.state = 'walk'; p.seg = -1; p.dir = chance(0.5) ? 1 : -1; }
      dodgeCars(p);
      break;
    }
    case 'flee': {
      p.fleeT -= dt;
      let dx = p.x - p.fearX, dy = p.y - p.fearY; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      // 벽이면 옆으로 꺾는다
      for (let k = 0; k < 4; k++) {
        if (!solidT(Math.floor((p.x + dx * 1.6) / T), Math.floor((p.y + dy * 1.6) / T))) break;
        [dx, dy] = k % 2 ? [dy, -dx] : [-dy, dx];
      }
      pedSeek(p, p.x + dx * 5, p.y + dy * 5, 5.2, dt, 16);
      dodgeCars(p);
      if (p.fleeT <= 0) { if (p.kind === 'civ') returnToWalk(p); else p.state = p.kind === 'cop' ? 'patrol' : 'idle'; }
      break;
    }
    case 'dog': updateDog(p, dt); return;
    case 'handsup': Aim.updatePed(p, dt); break;
    case 'feud': feudAI(p, dt); break;
    case 'escort': escortAI(p, dt); break;
    case 'idle': {
      if (p.homeX === undefined) { p.homeX = p.x; p.homeY = p.y; }
      if (p.stay) { pedSeek(p, p.homeX, p.homeY, 1, dt); if (!P.dead && dist2(p.x, p.y, P.px, P.py) < 100) p.a = Math.atan2(P.py - p.y, P.px - p.x); break; }
      if (p.kind === 'gang') gangLook(p, dt);
      if (!p.wt || p.wt <= 0) { p.wt = rand(2, 5); p.wx = p.homeX + rand(-3, 3); p.wy = p.homeY + rand(-3, 3); if (solidT(Math.floor(p.wx / T), Math.floor(p.wy / T))) { p.wx = p.homeX; p.wy = p.homeY; } }
      p.wt -= dt;
      pedSeek(p, p.wx, p.wy, 0.9, dt);
      dodgeCars(p);
      if ((p.kind === 'gang' || p.kind === 'guard') && !Gangs.friendly(p) && !P.dead && dist2(p.x, p.y, P.px, P.py) < 8 * 8 && WEAPONS[P.weapon] && !WEAPONS[P.weapon].melee && !P.car && chance(dt * 0.5)) { aggroGang(p.x, p.y, 'gang', p.gang); Talk.line(p, 'gang'); }
      break;
    }
    case 'patrol': {
      if (p.block) { p.state = 'walk'; } else returnToWalk(p);
      break;
    }
    case 'fight': case 'chase': {
      combatAI(p, dt);
      break;
    }
    case 'ticket': { // 무단횡단 단속: 대상에게 걸어가 딱지를 뗀다
      const tg = p.ticketTarget || Game.player;
      const tx = tg.px !== undefined ? tg.px : tg.x, ty = tg.py !== undefined ? tg.py : tg.y;
      p.a = Math.atan2(ty - p.y, tx - p.x);
      if (dist2(p.x, p.y, tx, ty) > 1.4 * 1.4) pedSeek(p, tx, ty, tg === Game.player ? 4.2 : 3.2, dt, 14); else { p.vx *= 0.7; p.vy *= 0.7; }
      break;
    }
    case 'goto': {
      pedSeek(p, p.tx, p.ty, p.runSpeed || 5, dt, 14);
      if (dist2(p.x, p.y, p.tx, p.ty) < 1.2) { if (p.onArrive) p.onArrive(p); else p.state = 'idle'; }
      break;
    }
  }
  // 분리(separation)
  if (p.state === 'walk' || p.state === 'cross' || p.state === 'idle') {
    for (const q of Game.peds) {
      if (q === p || q.dead || q.car) continue;
      const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 < 0.8 && d2 > 1e-6) { const d = Math.sqrt(d2); p.vx += dx / d * 2.5 * dt * 10; p.vy += dy / d * 2.5 * dt * 10; }
    }
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  const sp = Math.hypot(p.vx, p.vy);
  p.moving = sp;
  if (sp > 0.2 && p.state !== 'chase' && p.state !== 'fight') p.a = Math.atan2(p.vy, p.vx);
  p.anim += sp * dt * 2.4;
  pedStatic(p);
}

// 경찰/조직원 전투 AI
function combatAI(p, dt) {
  const P = Game.player;
  if (P.dead) { p.state = p.kind === 'civ' ? 'flee' : 'idle'; if (p.kind === 'cop') returnToWalk(p); return; }
  const isCop = p.kind === 'cop' || p.kind === 'swat';
  if (isCop && Wanted.stars === 0) { if (p.soldier) p.state = 'idle'; else returnToWalk(p); return; }
  let tx = P.px, ty = P.py;
  if (isCop && !Wanted.seen) { tx = Wanted.searchX; ty = Wanted.searchY; }
  const d = dist(p.x, p.y, tx, ty);
  const W = WEAPONS[p.weapon];
  const range = W.melee ? W.range : Math.min(W.range, 26);
  const see = d < 34 && losClear(p.x, p.y, P.px, P.py) && (!isCop || Wanted.seen);
  const mayShoot = !W.melee && see && d < range && (!isCop || Wanted.stars >= 2 || P.car && Wanted.stars >= 2);
  if (see) p.a = Math.atan2(P.py - p.y, P.px - p.x);
  if (see && chance(dt * 0.15)) Talk.line(p, isCop ? 'cop' : p.kind === 'civ' ? 'rage' : 'gang');
  if (mayShoot) {
    // 사격 자세: 약간 옆걸음
    p.strafe = (p.strafe || (chance(0.5) ? 1 : -1));
    if (chance(dt * 0.4)) p.strafe *= -1;
    const nx = -Math.sin(p.a) * p.strafe, ny = Math.cos(p.a) * p.strafe;
    const want = d > range * 0.7 ? 2.5 : 0;
    pedSeek(p, p.x + Math.cos(p.a) * want + nx * 1.2, p.y + Math.sin(p.a) * want + ny * 1.2, 2.2, dt);
    p.aimT += dt;
    if (p.cd <= 0 && p.aimT > 0.45) {
      p.cd = W.rate * (W.auto ? 1 : 1) + (W.auto ? 0 : rand(0.3, 0.9));
      if (W.auto) { p.burst = (p.burst || 0) + 1; if (p.burst > 6) { p.cd = rand(0.8, 1.6); p.burst = 0; } }
      const acc = p.kind === 'swat' ? 1.2 : p.kind === 'cop' ? 0.75 : 0.55;
      const lead = P.car ? 0.25 : 0.1;
      const ang = Math.atan2(P.py + (P.car ? P.car.vy : P.vy) * lead - p.y, P.px + (P.car ? P.car.vx : P.vx) * lead - p.x);
      fireWeapon(p, p.weapon, ang + gauss() * 0.06 / acc, acc);
    }
    return;
  }
  p.aimT = 0;
  const run = isCop ? 5.6 : 5.0;
  if (W.melee && see && d < 1.1) {
    p.vx *= 0.7; p.vy *= 0.7;
    if (p.cd <= 0 && !P.car && !(isCop && Wanted.stars <= 1)) { p.cd = W.rate + 0.3; fireWeapon(p, p.weapon, p.a); }
    return;
  }
  if (see && d < 12) pedSeek(p, tx, ty, run, dt, 14);
  else {
    const nd = (tx === P.px && ty === P.py) ? Nav.dir(p.x, p.y) : null;
    if (nd) pedSeek(p, p.x + nd[0] * 3, p.y + nd[1] * 3, run, dt, 14);
    else pedSeek(p, tx, ty, run, dt, 14);
    if (!see && p.vx * p.vx + p.vy * p.vy > 1) p.a = Math.atan2(p.vy, p.vx);
  }
  if (p.kind === 'civ' && d > 30) { returnToWalk(p); }
}

// 차 피하기 (Reynolds evasion)
function dodgeCars(p) {
  for (const c of Game.cars) {
    const sp = c.speed; if (sp < 5 || c.alt > 1.2) continue;
    const dx = p.x - c.x, dy = p.y - c.y; if (dx * dx + dy * dy > 144) continue;
    const t = (dx * c.vx + dy * c.vy) / (sp * sp); if (t < 0 || t > 0.9) continue;
    const cx = dx - c.vx * t, cy = dy - c.vy * t;
    if (cx * cx + cy * cy < 2.2 * 2.2) {
      const l = Math.hypot(cx, cy) || 1, nx = cx / l || -c.vy / sp, ny = cy / l || c.vx / sp;
      if (chance(0.7)) { p.vx += nx * 6; p.vy += ny * 6; }
      if (p.kind === 'civ') Talk.line(p, 'near');
      if (p.kind === 'civ') { p.state = 'flee'; p.fleeT = 3; p.fearX = c.x; p.fearY = c.y; }
      return;
    }
  }
}

// 보행자-지형 충돌
function pedStatic(p) {
  const r = p.r, solidT = p === Game.player ? solidNoWater : solidTile; // 플레이어만 물에 들어가 헤엄칠 수 있다
  const tx0 = Math.floor((p.x - r) / T), tx1 = Math.floor((p.x + r) / T), ty0 = Math.floor((p.y - r) / T), ty1 = Math.floor((p.y + r) / T);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!solidT(tx, ty)) continue;
    const px = clamp(p.x, tx * T, tx * T + T), py = clamp(p.y, ty * T, ty * T + T);
    const dx = p.x - px, dy = p.y - py, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 < 1e-8) { // 벽 안: 가장 가까운 면으로
        const l = p.x - tx * T, rr_ = tx * T + T - p.x, u = p.y - ty * T, dn = ty * T + T - p.y, m = Math.min(l, rr_, u, dn);
        if (m === l) p.x = tx * T - r; else if (m === rr_) p.x = tx * T + T + r; else if (m === u) p.y = ty * T - r; else p.y = ty * T + T + r;
        continue;
      }
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      p.x += nx * (r - d); p.y += ny * (r - d);
      const vn = p.vx * nx + p.vy * ny; if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    }
  }
  for (const t of treesNear(p.x, p.y)) {
    const dx = p.x - t.x, dy = p.y - t.y, d2 = dx * dx + dy * dy, rs = r + 0.4;
    if (d2 < rs * rs && d2 > 1e-6) { const d = Math.sqrt(d2); p.x += dx / d * (rs - d); p.y += dy / d * (rs - d); }
  }
}

// 보행자-차량 충돌 (치임)
function pedCarCollide(p, car) {
  if (car.alt > 1.2 || p.alt > 1.2 || p.car || dist2(p.x, p.y, car.x, car.y) > (car.brad + 0.6) ** 2) return;
  for (const [cx, cy] of car.circles()) {
    const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy, rs = car.r + p.r;
    if (d2 >= rs * rs || d2 < 1e-8) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    p.x += nx * (rs - d); p.y += ny * (rs - d);
    const rx = cx - car.x, ry = cy - car.y;
    const cvx = car.vx - car.w * ry, cvy = car.vy + car.w * rx;
    const vn = (cvx - p.vx) * nx + (cvy - p.vy) * ny;
    if (car.type === 'tank' && vn > 0.8 && !p.dead && p !== Game.player) { p.damage(300, car.driver === 'player' ? Game.player : null, nx, ny, 'car'); continue; }
    if (vn > 4.5 && !p.dead) {
      const by = car.driver === 'player' ? Game.player : null;
      p.vx = cvx * 0.8 + nx * 3; p.vy = cvy * 0.8 + ny * 3;
      p.downT = 1.6;
      if (by && p !== Game.player) crime('hitPed', p.x, p.y);
      p.damage((vn - 4) * 9, by, nx, ny, 'car');
      Sfx.hit(p.x, p.y);
      car.vx *= 0.96; car.vy *= 0.96;
      if (car.driver === 'ai' && car.ai && car.driverKind === 'civ') car.ai.panic = true;
    } else if (vn > 0) { p.vx += nx * vn; p.vy += ny * vn; }
    else if (p.dead) { p.vx = cvx * 0.5; p.vy = cvy * 0.5; }
  }
}

// ---------- 파티클 ----------
const Particles = {
  list: [],
  add(o) { if (this.list.length > TUNE.particles) this.list.shift(); this.list.push(o); },
  spark(x, y) { for (let i = 0; i < 3; i++) this.add({ t: 'spark', x, y, vx: rand(-8, 8), vy: rand(-8, 8), life: 0.25, max: 0.25, size: 0.12 }); },
  blood(x, y, dx, dy) { this.add({ t: 'blood', x, y, vx: dx * rand(1, 4) + rand(-1.5, 1.5), vy: dy * rand(1, 4) + rand(-1.5, 1.5), life: 0.5, max: 0.5, size: rand(0.1, 0.22) }); },
  fire(x, y, s = 1) { this.add({ t: 'fire', x, y, vx: rand(-1, 1) * s, vy: rand(-1, 1) * s, life: rand(0.3, 0.7), max: 0.7, size: rand(0.5, 1.2) * s }); },
  smoke(x, y, s = 1, col = '#8a8a8a') { this.add({ t: 'smoke', x, y, vx: rand(-0.6, 0.6) + Game.wind * 0.8, vy: rand(-0.6, 0.6), life: rand(1.2, 2.4) * Math.min(1.5, s), max: 2.4 * Math.min(1.5, s), size: rand(0.6, 1.0) * s, col }); },
  debris(x, y) { const a = rand(0, TAU), s = rand(6, 16); this.add({ t: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.6, 1.2), max: 1.2, size: rand(0.15, 0.4), rot: rand(0, 6) }); },
  shell(x, y, a) { const s = a + Math.PI / 2; this.add({ t: 'shell', x, y, vx: Math.cos(s) * rand(2, 4), vy: Math.sin(s) * rand(2, 4), life: 0.5, max: 0.5, size: 0.08 }); },
  splash(x, y) { this.add({ t: 'splash', x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 0.3 }); },
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]; p.life -= dt;
      if (p.life <= 0) { if (p.t === 'blood' && Math.random() < 0.4) Decals.drop(p.x, p.y, p.size); L.splice(i, 1); continue; }
      const drag = p.t === 'smoke' ? 0.6 : p.t === 'fire' ? 1.5 : 3;
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t === 'smoke') p.size += dt * 0.9;
    }
  },
};
// ---------- 데칼(바닥 흔적) ----------
const Decals = {
  skids: [], blood_: [], scorch_: [],
  skid(x1, y1, x2, y2) { this.skids.push([x1, y1, x2, y2, Game.time]); if (this.skids.length > 1600) this.skids.splice(0, 200); },
  blood(x, y) { this.blood_.push({ x, y, r: rand(0.5, 0.9), t: Game.time }); if (this.blood_.length > 120) this.blood_.shift(); },
  drop(x, y, s) { this.blood_.push({ x, y, r: s * 1.3, t: Game.time }); if (this.blood_.length > 120) this.blood_.shift(); },
  scorch(x, y, r) { this.scorch_.push({ x, y, r, t: Game.time, rot: rand(0, TAU) }); if (this.scorch_.length > 40) this.scorch_.shift(); },
};
// ---------- 이펙트 ----------
const Effects = {
  tracers: [], flashes: [], booms: [], texts: [],
  tracer(x1, y1, x2, y2, c) { this.tracers.push({ x1, y1, x2, y2, c, life: 0.06 }); },
  flash(x, y, r, life) { this.flashes.push({ x, y, r, life, max: life }); },
  boom(x, y, r) { this.booms.push({ x, y, r, life: 0.7, max: 0.7 }); this.flash(x, y, r * 4, 0.5); },
  text(x, y, s, c = '#8df28d') { this.texts.push({ x, y, s, c, life: 1.4, max: 1.4 }); },
  update(dt) {
    for (const k of ['tracers', 'flashes', 'booms', 'texts']) {
      const a = this[k];
      for (let i = a.length - 1; i >= 0; i--) { a[i].life -= dt; if (k === 'texts') a[i].y -= dt * 1.5; if (a[i].life <= 0) a.splice(i, 1); }
    }
  },
};

// ---------- 픽업 ----------
function addPickup(type, x, y, o = {}) {
  const p = { type, x, y, bob: Math.random() * 6, respawn: o.respawn || 0, wname: o.wname, amount: o.amount || 0, temp: o.temp || 0, taken: false, id: o.id, cool: 0 };
  Game.pickups.push(p); return p;
}
function updatePickups(dt) {
  const P = Game.player;
  for (let i = Game.pickups.length - 1; i >= 0; i--) {
    const k = Game.pickups[i];
    k.bob += dt * 3;
    if (k.temp) { k.temp -= dt; if (k.temp <= 0) { Game.pickups.splice(i, 1); continue; } }
    if (k.taken) { k.cool -= dt; if (k.cool <= 0) k.taken = false; continue; }
    if (P.dead || (P.car && P.car.alt > 1.2) || P.alt > 1.2) continue;
    const reach = P.car ? 2.6 : 1.2;
    if (dist2(k.x, k.y, P.px, P.py) > reach * reach) continue;
    if (P.car && k.type !== 'cash' && k.type !== 'package' && k.type !== 'bribe') continue;
    let took = true;
    if (k.type === 'cash') { P.money += k.amount; Sfx.cash(); Effects.text(k.x, k.y, '+$' + k.amount); }
    else if (k.type === 'weapon') { giveWeapon(P, k.wname, k.amount || WEAPONS[k.wname].pack); Sfx.pickup(); UI.toast(`${WEAPONS[k.wname].name} 획득`); }
    else if (k.type === 'health') { if (P.hp >= P.maxHp) took = false; else { P.hp = P.maxHp; Sfx.pickup(); UI.toast('체력 회복'); } }
    else if (k.type === 'armor') { if (P.armor >= 100) took = false; else { P.armor = 100; Sfx.pickup(); UI.toast('방탄복 착용'); } }
    else if (k.type === 'bribe') { if (Wanted.stars === 0) took = false; else { Wanted.drop(1); Sfx.pickup(); UI.toast('뇌물: 수배 단계 -1'); } }
    else if (k.type === 'package') { Game.packages.add(k.id); Sfx.passed(); P.money += 1000; UI.big(`숨겨진 꾸러미 ${Game.packages.size}/${Game.packageTotal}`, '+$1,000', 2.5); Save.write(); }
    if (!took) continue;
    if (k.respawn) { k.taken = true; k.cool = k.respawn; }
    else Game.pickups.splice(i, 1);
  }
}
