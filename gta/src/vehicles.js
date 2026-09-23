'use strict';
/* =====================================================================
 * vehicles.js — 차량 물리 + 교통 AI + 경찰 추격 AI
 *
 * 차량 물리: Marco Monster, "Car Physics for Games" (2003)의 2D 자전거 모델.
 *   - 앞/뒤 차축의 슬립각(slip angle) = 차체 횡슬립 + 요레이트 기여 − 조향각
 *   - 횡력 = clamp(−Cα·α, ±grip)·축하중  → 한계를 넘으면 미끄러짐(드리프트)
 *   - 핸드브레이크는 뒤축 그립을 낮춰 오버스티어를 만든다.
 *   - 저속에서는 슬립각 식이 불안정하므로 기구학(kinematic) 모델과 블렌딩.
 * 교통 AI:
 *   - 경로 추종: Pure Pursuit (Coulter, CMU-RI-TR-92-01, 1992)
 *   - 차간 거리: Intelligent Driver Model (Treiber, Hennecke & Helbing, Phys. Rev. E 62, 2000)
 *   - 교차로 신호: 축(동서/남북) 단위 고정 주기 신호.
 * ===================================================================== */

const VTYPES = {
  compact: { name: '브리오', L: 3.9, W: 1.75, mass: 950, Fe: 5200, vmax: 36, grip: 1.15, cs: 5.2, steer: 0.62, hp: 80, colors: ['#e8d44d', '#8fd0e8', '#e87f9a', '#b5e38f', '#f0f0f0'], style: 'compact' },
  sedan: { name: '세다나', L: 4.6, W: 1.9, mass: 1300, Fe: 7200, vmax: 42, grip: 1.2, cs: 5.0, steer: 0.58, hp: 100, colors: ['#3c6fb0', '#a63d3d', '#d0d4d8', '#2e2f33', '#4e7a52', '#8a6d4a', '#6b4a8a'], style: 'sedan' },
  taxi: { name: '택시', L: 4.6, W: 1.9, mass: 1300, Fe: 7200, vmax: 42, grip: 1.2, cs: 5.0, steer: 0.58, hp: 100, colors: ['#f2b705'], style: 'taxi' },
  sports: { name: '반시 GT', L: 4.4, W: 1.95, mass: 1200, Fe: 11500, vmax: 60, grip: 1.45, cs: 5.6, steer: 0.55, hp: 90, colors: ['#e0262b', '#f2c200', '#1d1d1f', '#f07c1b', '#e8e8ea'], style: 'sports' },
  muscle: { name: '스탈리온', L: 4.9, W: 1.95, mass: 1500, Fe: 10500, vmax: 52, grip: 1.05, cs: 4.6, steer: 0.55, hp: 120, colors: ['#1b5e3b', '#6e1414', '#101820', '#c46f1b'], style: 'muscle' },
  van: { name: '버로 밴', L: 5.2, W: 2.1, mass: 2000, Fe: 8200, vmax: 34, grip: 1.0, cs: 4.8, steer: 0.52, hp: 150, colors: ['#dcdcdc', '#6b8fa8', '#8a3b2e', '#556b2f'], style: 'van' },
  truck: { name: '뮬 트럭', L: 7.2, W: 2.4, mass: 4200, Fe: 15000, vmax: 30, grip: 0.95, cs: 4.4, steer: 0.45, hp: 240, colors: ['#e0e0e0', '#b0452f', '#2f5fb0'], style: 'truck' },
  police: { name: '경찰 순찰차', L: 4.8, W: 1.95, mass: 1450, Fe: 10500, vmax: 50, grip: 1.35, cs: 5.4, steer: 0.58, hp: 140, colors: ['#f4f4f4'], style: 'police' },
  swat: { name: 'SWAT 장갑차', L: 5.8, W: 2.3, mass: 3200, Fe: 14500, vmax: 40, grip: 1.1, cs: 5.0, steer: 0.5, hp: 320, colors: ['#1f2328'], style: 'swat' },
  armored: { name: '현금수송 트럭', L: 6.4, W: 2.4, mass: 5000, Fe: 16000, vmax: 30, grip: 1.0, cs: 4.6, steer: 0.45, hp: 700, colors: ['#3d4a3a'], style: 'armored' },
};
const TRAFFIC_MIX = ['sedan', 'sedan', 'sedan', 'compact', 'compact', 'taxi', 'van', 'muscle', 'sports', 'truck', 'sedan', 'compact'];

let _eid = 1;
class Car {
  constructor(type, x, y, a, opt = {}) {
    const V = VTYPES[type];
    this.kind = 'car'; this.id = _eid++; this.type = type; this.V = V;
    this.x = x; this.y = y; this.a = a; this.vx = 0; this.vy = 0; this.w = 0;
    this.L = V.L; this.W = V.W; this.m = V.mass; this.I = V.mass * (V.L * V.L + V.W * V.W) / 12;
    this.steer = 0; this.vf = 0; this.vl = 0;
    this.in = { thr: 0, brk: 0, st: 0, hb: false };
    this.hp = opt.hp || V.hp; this.maxHp = this.hp;
    this.color = opt.color || pick(V.colors);
    this.driver = null;     // null | 'player' | 'ai'
    this.driverKind = null; // 'civ' | 'cop' | 'gang' | 'target'
    this.ai = null; this.crew = 0;
    this.siren = false; this.sirenMode = 1;
    this.dead = false; this.burnT = 0; this.wreckT = 0;
    this.skid = false; this.lastSkid = null; this.hitCD = 0; this.lastHitBy = null;
    this.persistent = !!opt.persistent; this.mission = opt.mission || null;
    this.brakeLight = 0; this.bob = Math.random() * 10;
    const n = Math.max(2, Math.ceil(V.L / V.W));
    const span = V.L / 2 - V.W / 2;
    this.co = []; for (let i = 0; i < n; i++) this.co.push(-span + (2 * span * i) / (n - 1));
    this.r = V.W / 2;
    this.brad = V.L / 2 + 0.5;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  fwd() { return [Math.cos(this.a), Math.sin(this.a)]; }
  circles() { const c = Math.cos(this.a), s = Math.sin(this.a); return this.co.map(o => [this.x + c * o, this.y + s * o]); }
  doorPos(side = -1) { // -1 왼쪽(운전석)
    const c = Math.cos(this.a), s = Math.sin(this.a);
    const off = this.W / 2 + 0.6; // 오른쪽 벡터 = (-sin, cos)
    return [this.x + c * 0.4 - s * side * off, this.y + s * 0.4 + c * side * off];
  }

  step(dt) {
    const V = this.V, inp = this.in;
    const cs = Math.cos(this.a), sn = Math.sin(this.a);
    let vf = this.vx * cs + this.vy * sn, vl = -this.vx * sn + this.vy * cs;
    const speed = Math.hypot(vf, vl);
    const maxSt = V.steer / (1 + Math.abs(vf) / 30);
    this.steer = smooth(this.steer, clamp(inp.st, -1, 1) * maxSt, inp.st === 0 ? 8 : 6, dt);
    const d = this.steer, a = this.L * 0.3, b = this.L * 0.3, wb = a + b;
    const load = this.m * 9.81 * 0.5;
    const wet = Game.weather.wet;
    const gripF = V.grip * wet, gripR = V.grip * wet * (inp.hb ? 0.42 : 1);
    let FyF = 0, FyR = 0;
    const avf = Math.abs(vf);
    if (avf > 0.3) {
      const slipF = Math.atan2(vl + this.w * a, avf) - d * sign(vf);
      const slipR = Math.atan2(vl - this.w * b, avf);
      FyF = clamp(-V.cs * slipF, -gripF, gripF) * load;
      FyR = clamp(-V.cs * slipR, -gripR, gripR) * load;
    }
    // 종방향
    const Fb = this.m * 8.5;
    let Fx = 0;
    if (this.dead || this.burnT > 0 && !this.driver) { /* 엔진 없음 */ }
    else if (inp.thr > 0) Fx += inp.thr * V.Fe * (vf < -0.5 ? 1.6 : 1);
    else if (inp.thr < 0) Fx += inp.thr * V.Fe * 0.5 * (vf > 0.5 ? 1.6 : 1);
    if (inp.brk > 0) Fx -= sign(vf) * inp.brk * Fb * wet;
    if (inp.hb) Fx -= sign(vf) * Fb * 0.35 * wet;
    const Cd = V.Fe / (V.vmax * V.vmax);
    Fx -= Cd * vf * Math.abs(vf) + this.m * 0.12 * vf;
    let Fy = FyF * Math.cos(d) + FyR - Cd * 2 * vl * Math.abs(vl);
    Fx += -FyF * Math.sin(d);
    const torque = a * FyF * Math.cos(d) - b * FyR;
    const axl = Fx / this.m, ayl = Fy / this.m;
    this.vx += (axl * cs - ayl * sn) * dt;
    this.vy += (axl * sn + ayl * cs) * dt;
    this.w += (torque / this.I) * dt;
    // 저속 블렌딩 (기구학 모델)
    const k = clamp((speed - 0.6) / 3.5, 0, 1);
    if (k < 1) {
      vf = this.vx * cs + this.vy * sn; vl = -this.vx * sn + this.vy * cs;
      this.w = lerp(vf * Math.tan(d) / wb, this.w, k);
      vl *= k;
      this.vx = vf * cs - vl * sn; this.vy = vf * sn + vl * cs;
      if (Math.abs(inp.thr) < 0.05 && speed < 0.35) { this.vx = 0; this.vy = 0; this.w = 0; }
      if (inp.brk > 0 && Math.abs(vf) < 0.6 && inp.thr === 0) { this.vx *= 0.5; this.vy *= 0.5; }
    }
    this.w *= 1 - 0.4 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.a = angNorm(this.a + this.w * dt);
    this.vf = this.vx * Math.cos(this.a) + this.vy * Math.sin(this.a);
    this.vl = -this.vx * Math.sin(this.a) + this.vy * Math.cos(this.a);
    this.skid = !this.dead && ((Math.abs(this.vl) > 2.6 && speed > 5) || (inp.hb && speed > 4) || (inp.brk > 0.7 && speed > 9));
  }

  // 정적 충돌(건물, 물, 나무)
  collideStatic() {
    const r = this.r;
    let impact = 0;
    const cs = Math.cos(this.a), sn = Math.sin(this.a);
    for (const o of this.co) {
      let cx = this.x + cs * o, cy = this.y + sn * o;
      const tx0 = Math.floor((cx - r) / T), tx1 = Math.floor((cx + r) / T), ty0 = Math.floor((cy - r) / T), ty1 = Math.floor((cy + r) / T);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!solidT(tx, ty)) continue;
        const px = clamp(cx, tx * T, tx * T + T), py = clamp(cy, ty * T, ty * T + T);
        let dx = cx - px, dy = cy - py, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let nx, ny, pen;
        if (d2 < 1e-8) { // 중심이 타일 안
          const l = cx - tx * T, rr_ = tx * T + T - cx, u = cy - ty * T, dn = ty * T + T - cy, m = Math.min(l, rr_, u, dn);
          nx = m === l ? -1 : m === rr_ ? 1 : 0; ny = m === u ? -1 : m === dn ? 1 : 0; pen = m + r;
        } else { const dd = Math.sqrt(d2); nx = dx / dd; ny = dy / dd; pen = r - dd; }
        this.x += nx * pen; this.y += ny * pen; cx += nx * pen; cy += ny * pen;
        impact = Math.max(impact, this.impulseStatic(px, py, nx, ny));
      }
      for (const t of treesNear(cx, cy)) {
        const tr = 0.45, dx = cx - t.x, dy = cy - t.y, d2 = dx * dx + dy * dy;
        if (d2 < (r + tr) ** 2 && d2 > 1e-6) {
          const dd = Math.sqrt(d2), nx = dx / dd, ny = dy / dd, pen = r + tr - dd;
          this.x += nx * pen; this.y += ny * pen;
          impact = Math.max(impact, this.impulseStatic(t.x + nx * tr, t.y + ny * tr, nx, ny));
        }
      }
    }
    if (impact > 3) this.onImpact(impact, null);
  }
  impulseStatic(px, py, nx, ny, e = 0.25, mu = 0.25) {
    const rx = px - this.x, ry = py - this.y;
    const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return 0;
    const rn = rx * ny - ry * nx;
    const j = -(1 + e) * vn / (1 / this.m + rn * rn / this.I);
    this.vx += j * nx / this.m; this.vy += j * ny / this.m; this.w += rn * j / this.I;
    const tx = -ny, ty = nx, vt = vpx * tx + vpy * ty, rt = rx * ty - ry * tx;
    const jt = clamp(-vt / (1 / this.m + rt * rt / this.I), -mu * j, mu * j);
    this.vx += jt * tx / this.m; this.vy += jt * ty / this.m; this.w += rt * jt / this.I;
    return -vn;
  }
  onImpact(v, other) {
    if (this.hitCD > 0) return;
    this.hitCD = 0.25;
    if (v > 5) {
      this.damage((v - 5) * 3.2 * (this.type === 'armored' ? 0.4 : 1), other && other.driver === 'player' ? Game.player : null);
      Sfx.crash(this.x, this.y, v);
      for (let i = 0; i < Math.min(12, v); i++) Particles.spark(this.x + rand(-1, 1), this.y + rand(-1, 1));
      if (this === Game.player.car) Cam.shake = Math.max(Cam.shake, Math.min(0.8, v / 25));
    }
    if (v > 6 && this.driver === 'ai' && this.ai && this.driverKind === 'civ' && this.ai.mode === 'traffic') {
      if (other && other.driver === 'player') { this.ai.angryT = 3; if (chance(0.5)) this.ai.panic = true; }
    }
  }
  damage(amt, by) {
    if (this.dead) return;
    this.hp -= amt;
    if (by) this.lastHitBy = by;
    if (this.hp <= 0 && this.burnT <= 0) {
      this.hp = 0; this.burnT = this.type === 'armored' ? 3 : 4.5;
      // 탑승자 탈출
      if (this.driver === 'ai') bailOut(this, true);
    } else if (this.driver === 'ai' && this.driverKind === 'civ' && this.hp < this.maxHp * 0.3 && this.speed < 3) bailOut(this, true);
  }
  update(dt) {
    this.hitCD -= dt;
    if (this.dead) { this.in.thr = 0; this.in.brk = 1; this.in.st = 0; this.in.hb = false; this.wreckT += dt; }
    else if (this.burnT > 0) {
      this.burnT -= dt;
      if (Math.random() < 0.6) Particles.fire(this.x + rand(-1, 1), this.y + rand(-1, 1));
      if (Math.random() < 0.3) Particles.smoke(this.x, this.y, 1.5);
      if (this.burnT <= 0) { this.dead = true; explode(this.x, this.y, 7, 120, this.lastHitBy, this); this.siren = false; }
    } else if (this.hp < this.maxHp * 0.35) {
      this.smokeT = (this.smokeT || 0) - dt;
      if (this.smokeT <= 0) { this.smokeT = this.hp < this.maxHp * 0.15 ? 0.05 : 0.15; const f = this.fwd(); Particles.smoke(this.x + f[0] * this.L * 0.35, this.y + f[1] * this.L * 0.35, this.hp < this.maxHp * 0.15 ? 1.2 : 0.8, this.hp < this.maxHp * 0.15 ? '#2a2a2a' : '#9a9a9a'); }
    }
    // 입력 결정
    if (this.driver === 'player' && !this.dead) playerDrive(this, dt);
    else if (this.driver === 'ai' && this.ai && !this.dead && this.burnT <= 0) aiDrive(this, dt);
    else if (!this.dead) { this.in.thr = 0; this.in.st = 0; this.in.brk = this.driver ? 0 : 0.6; this.in.hb = false; }
    this.brakeLight = (this.in.brk > 0.1 || (this.in.thr < 0 && this.vf > 0.5)) ? 1 : 0;
    const sub = 2, h = dt / sub;
    const moving = this.speed > 0.01 || Math.abs(this.w) > 0.01 || this.in.thr !== 0;
    if (moving) for (let i = 0; i < sub; i++) { this.step(h); this.collideStatic(); }
    // 스키드 마크
    if (this.skid) {
      const c = Math.cos(this.a), s = Math.sin(this.a), bx = this.x - c * this.L * 0.32, by = this.y - s * this.L * 0.32;
      const ox = -s * this.W * 0.4, oy = c * this.W * 0.4;
      const cur = [bx + ox, by + oy, bx - ox, by - oy];
      if (this.lastSkid) { Decals.skid(this.lastSkid[0], this.lastSkid[1], cur[0], cur[1]); Decals.skid(this.lastSkid[2], this.lastSkid[3], cur[2], cur[3]); }
      this.lastSkid = cur;
      if (Math.random() < 0.3) Particles.smoke(bx, by, 0.6, '#cfcfcf');
    } else this.lastSkid = null;
  }
}

// ---------- 차량 간 충돌 (원 근사 + 충격량) ----------
function collideCarPair(A, B) {
  const R = A.brad + B.brad;
  if (dist2(A.x, A.y, B.x, B.y) > R * R) return;
  const ca = A.circles(), cb = B.circles(), ra = A.r, rb = B.r;
  for (const pa of ca) for (const pb of cb) {
    let dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    const d2 = dx * dx + dy * dy, rs = ra + rb;
    if (d2 >= rs * rs || d2 < 1e-8) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = rs - d;
    const ima = 1 / A.m, imb = 1 / B.m, it = ima + imb;
    A.x += nx * pen * ima / it; A.y += ny * pen * ima / it;
    B.x -= nx * pen * imb / it; B.y -= ny * pen * imb / it;
    const px = pb[0] + nx * rb, py = pb[1] + ny * rb;
    const rax = px - A.x, ray = py - A.y, rbx = px - B.x, rby = py - B.y;
    const vax = A.vx - A.w * ray, vay = A.vy + A.w * rax, vbx = B.vx - B.w * rby, vby = B.vy + B.w * rbx;
    const vn = (vax - vbx) * nx + (vay - vby) * ny;
    if (vn >= 0) continue;
    const rna = rax * ny - ray * nx, rnb = rbx * ny - rby * nx;
    const j = -(1.3) * vn / (ima + imb + rna * rna / A.I + rnb * rnb / B.I);
    A.vx += j * nx * ima; A.vy += j * ny * ima; A.w += rna * j / A.I;
    B.vx -= j * nx * imb; B.vy -= j * ny * imb; B.w -= rnb * j / B.I;
    const imp = -vn;
    if (imp > 3) {
      A.onImpact(imp * Math.min(1, B.m / A.m * 1.2), B); B.onImpact(imp * Math.min(1, A.m / B.m * 1.2), A);
      // 경찰차 들이받기 = 범죄
      if ((A.driver === 'player' && B.type === 'police') || (B.driver === 'player' && A.type === 'police')) crime('hitCop', px, py);
      if (imp > 8 && (A.driver === 'player' || B.driver === 'player')) {
        const o = A.driver === 'player' ? B : A;
        if (o.driver === 'ai' && o.driverKind === 'civ' && chance(0.5)) crime('crash', px, py);
      }
    }
  }
}

// ---------- 플레이어 운전 ----------
function playerDrive(car, dt) {
  let thrKey = 0, st = 0;
  if (keyDown('KeyW', 'ArrowUp')) thrKey += 1;
  if (keyDown('KeyS', 'ArrowDown')) thrKey -= 1;
  if (keyDown('KeyA', 'ArrowLeft')) st -= 1;
  if (keyDown('KeyD', 'ArrowRight')) st += 1;
  let hb = keyDown('Space');
  if (Input.touch.on) {
    const j = Input.touch;
    if (Math.abs(j.jx) > 0.15) st = clamp(j.jx * 1.3, -1, 1);
    if (Math.abs(j.jy) > 0.2) thrKey = clamp(-j.jy * 1.4, -1, 1);
    hb = hb || j.hb;
  }
  const vf = car.vf;
  car.in.st = st; car.in.hb = hb;
  if (thrKey > 0) { car.in.thr = thrKey; car.in.brk = vf < -1 ? 1 : 0; if (vf < -1) car.in.thr = 0; }
  else if (thrKey < 0) {
    if (vf > 1) { car.in.brk = -thrKey; car.in.thr = 0; }
    else { car.in.thr = thrKey; car.in.brk = 0; }
  } else { car.in.thr = 0; car.in.brk = 0; }
}

// ---------- 경로 구성 ----------
function lanePt(node, d, off, r = null) { const rt = r || rightOf(d); return { x: node.x + DIRS[d][0] * off + rt[0] * T * 0.5, y: node.y + DIRS[d][1] * off + rt[1] * T * 0.5 }; }
function pushLane(route, A, B, d, fromS, v) {
  const L = dist(A.x, A.y, B.x, B.y), end = L - 2 * T;
  for (let s = fromS; s < end - 4; s += 9) { const p = lanePt(A, d, s); p.v = v; route.push(p); }
  const p = lanePt(B, d, -2 * T); p.v = v; p.stop = B.id; p.dir = d; route.push(p);
}
function planTurn(car) {
  const ai = car.ai, B = World.nodes[ai.to], d = ai.dir;
  let exits = [0, 1, 2, 3].filter(e => B.adj[e] >= 0 && e !== (d + 2) % 4);
  if (!exits.length) exits = [(d + 2) % 4];
  let e;
  if (ai.forceDir !== undefined && exits.includes(ai.forceDir)) e = ai.forceDir;
  else {
    const wts = exits.map(x => x === d ? 2.2 : 1);
    let r = Math.random() * wts.reduce((a, b) => a + b, 0); e = exits[0];
    for (let i = 0; i < exits.length; i++) { r -= wts[i]; if (r <= 0) { e = exits[i]; break; } }
  }
  ai.forceDir = undefined;
  const C = World.nodes[B.adj[e]];
  const P0 = lanePt(B, d, -2 * T), P1 = lanePt(B, e, 2 * T);
  const turnV = e === d ? 99 : (e === (d + 1) % 4 ? 5.5 : 7);
  if (e === d) { const m = { x: (P0.x + P1.x) / 2, y: (P0.y + P1.y) / 2, v: 99 }; ai.route.push(m); }
  else {
    let cx, cy;
    if (e === (d + 2) % 4) { cx = B.x; cy = B.y; }
    else { const k = (P1.x - P0.x) * DIRS[d][0] + (P1.y - P0.y) * DIRS[d][1]; cx = P0.x + DIRS[d][0] * k; cy = P0.y + DIRS[d][1] * k; }
    for (const t of [0.3, 0.6, 0.85]) {
      const u = 1 - t;
      ai.route.push({ x: u * u * P0.x + 2 * u * t * cx + t * t * P1.x, y: u * u * P0.y + 2 * u * t * cy + t * t * P1.y, v: turnV });
    }
  }
  const p1 = { x: P1.x, y: P1.y, v: turnV + 2 }; ai.route.push(p1);
  pushLane(ai.route, B, C, e, 2 * T + 8, 99);
  ai.from = B.id; ai.to = C.id; ai.dir = e;
}
// 현재 위치에서 교통 흐름에 합류
function trafficFromHere(car, mode = 'traffic') {
  const E = nearestEdge(car.x, car.y);
  if (!E) return;
  const f = car.fwd();
  const forward = f[0] * E.dx + f[1] * E.dy >= 0;
  const A = forward ? E.A : E.B, B = forward ? E.B : E.A;
  const d = dirBetween(A, B);
  const s = forward ? E.s : E.L - E.s;
  car.ai = { mode, route: [], from: A.id, to: B.id, dir: d, cruise: rand(11, 15), stuckT: 0, waitT: 0, revT: 0, ignoreT: 0, honkT: 0 };
  pushLane(car.ai.route, A, B, d, s + 6, 99);
}

// 전방 장애물(IDM 선행차) 탐색
function findLeader(car, range, peds = true, carsToo = true) {
  const c = Math.cos(car.a), s = Math.sin(car.a);
  let bestS = 1e9, bestV = 0, what = null;
  const test = (ox, oy, ovx, ovy, halfL, halfW, oa, obj) => {
    const dx = ox - car.x, dy = oy - car.y;
    const lx = dx * c + dy * s; if (lx <= 0 || lx > range) return;
    const ly = -dx * s + dy * c;
    const ra = oa - car.a, cr = Math.abs(Math.cos(ra)), sr = Math.abs(Math.sin(ra));
    const projW = sr * halfL + cr * halfW, projL = cr * halfL + sr * halfW;
    const widen = 0.45 + Math.min(1.2, Math.abs(car.steer) * lx * 0.8);
    const offset = ly - car.steer * lx * 0.35;
    if (Math.abs(offset) > car.W / 2 + projW + widen) return;
    const gap = lx - car.L / 2 - projL;
    if (gap < bestS) { bestS = gap; bestV = ovx * c + ovy * s; what = obj; }
  };
  if (carsToo) for (const o of Game.cars) { if (o === car || dist2(o.x, o.y, car.x, car.y) > (range + 6) ** 2) continue; test(o.x, o.y, o.vx, o.vy, o.L / 2, o.W / 2, o.a, o); }
  if (peds) {
    for (const p of Game.peds) { if (p.dead || p.car || dist2(p.x, p.y, car.x, car.y) > range * range) continue; test(p.x, p.y, 0, 0, 0.4, 0.4, 0, p); }
    const P = Game.player; if (!P.car && !P.dead) test(P.x, P.y, 0, 0, 0.4, 0.4, 0, P);
  }
  return { s: bestS, v: bestV, what };
}

function idmAccel(v, v0, s, vLead, aMax, bComf, s0, Th) {
  let acc = aMax * (1 - Math.pow(Math.max(0, v) / Math.max(0.1, v0), 4));
  if (s < 1e8) {
    const sStar = s0 + Math.max(0, v * Th + v * (v - vLead) / (2 * Math.sqrt(aMax * bComf)));
    acc -= aMax * Math.pow(sStar / Math.max(0.2, s), 2);
  }
  return acc;
}
function applyAccel(car, acc) {
  const V = car.V;
  if (acc >= 0) { const drag = (V.Fe / (V.vmax * V.vmax)) * car.vf * car.vf + car.m * 0.12 * Math.max(0, car.vf); car.in.thr = clamp((acc * car.m + drag) / V.Fe, 0, 1); car.in.brk = 0; }
  else { car.in.thr = 0; car.in.brk = clamp(-acc / 7.5, 0, 1); }
}
function pursuitSteer(car, tx, ty) {
  const c = Math.cos(car.a), s = Math.sin(car.a), dx = tx - car.x, dy = ty - car.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const wb = car.L * 0.6;
  let delta = Math.atan2(2 * wb * ly, lx * lx + ly * ly);
  if (lx < 0) delta = sign(ly || 1) * car.V.steer; // 뒤에 있으면 최대로 꺾는다
  const maxSt = car.V.steer / (1 + Math.abs(car.vf) / 30);
  car.in.st = clamp(delta / maxSt, -1, 1);
}

// ---------- AI 운전 ----------
function aiDrive(car, dt) {
  const ai = car.ai;
  ai.ignoreT -= dt; ai.honkT -= dt;
  if (ai.mode === 'chase' || ai.mode === 'block') return policeDrive(car, dt);
  if (ai.mode === 'parked') { car.in.thr = 0; car.in.brk = 1; car.in.st = 0; return; }
  if (!ai.route || !ai.route.length) { trafficFromHere(car, ai.mode); if (!car.ai.route.length) return; }
  const r = car.ai.route;
  // 경유점 소비
  const f = car.fwd();
  while (r.length) {
    const p = r[0], dx = p.x - car.x, dy = p.y - car.y, d2 = dx * dx + dy * dy;
    if (d2 < 3.5 * 3.5 || (dx * f[0] + dy * f[1] < 0 && d2 < 64)) r.shift(); else break;
  }
  if (r.length < 8) planTurn(car);
  // 후진 탈출
  if (ai.revT > 0) {
    ai.revT -= dt; car.in.thr = -0.7; car.in.brk = 0; car.in.st = -ai.revSt; car.in.hb = false; return;
  }
  const speed = Math.max(0, car.vf);
  const Ld = clamp(4 + speed * 0.45, 5, 14);
  let tgt = r[r.length - 1];
  for (const p of r) if (dist2(p.x, p.y, car.x, car.y) >= Ld * Ld) { tgt = p; break; }
  pursuitSteer(car, tgt.x, tgt.y);
  car.in.hb = false;
  // 목표 속도
  const panic = ai.mode === 'flee' || ai.panic;
  let v0 = panic ? (ai.cruiseFlee || 22) : ai.cruise;
  if (Game.weather.rain) v0 *= 0.85;
  let along = 0, px = car.x, py = car.y;
  for (let i = 0; i < r.length && along < 40; i++) {
    along += dist(px, py, r[i].x, r[i].y); px = r[i].x; py = r[i].y;
    if (r[i].v < v0) v0 = Math.min(v0, Math.sqrt(r[i].v * r[i].v + 2 * 3.5 * Math.max(0, along - 3)));
  }
  // 신호
  let lead = { s: 1e9, v: 0 };
  if (!panic) {
    for (let i = 0; i < Math.min(r.length, 8); i++) {
      const p = r[i]; if (p.stop === undefined) continue;
      const node = World.nodes[p.stop], st = lightState(node, p.dir);
      const sd = (p.x - car.x) * DIRS[p.dir][0] + (p.y - car.y) * DIRS[p.dir][1] - car.L / 2;
      if (st === 'r' || (st === 'y' && sd > Math.max(4, speed * speed / 12))) { if (sd > -0.5) lead = { s: Math.max(0.1, sd + 0.3), v: 0, light: true }; }
      break;
    }
  }
  const L = ai.ignoreT > 0 ? findLeader(car, 12, true, false) : findLeader(car, 12 + speed * 1.6, true, true);
  const isLight = lead.light;
  if (L.s < lead.s) lead = L;
  let acc = idmAccel(speed, v0, lead.s, lead.v, panic ? 4 : 2.6, 4, panic ? 1.2 : 2.2, panic ? 0.6 : 1.3);
  if (lead.s < 0.8) acc = Math.min(acc, -8);
  applyAccel(car, acc);
  // 교착 해소
  if (car.speed < 0.4 && !isLight && lead.s < 6) {
    ai.waitT += dt;
    if (ai.waitT > 2.5 && ai.honkT <= 0 && lead.what === Game.player.car) { ai.honkT = 3; Sfx.tone({ x: car.x, y: car.y, f0: 420, f1: 400, dur: 0.35, type: 'square', vol: 0.12 }); }
    if (ai.waitT > 7) { ai.ignoreT = 2; ai.waitT = 0; }
  } else ai.waitT = Math.max(0, ai.waitT - dt);
  if (car.speed < 0.3 && car.in.thr > 0.4) { ai.stuckT += dt; if (ai.stuckT > 2) { ai.stuckT = 0; ai.revT = 1.3; ai.revSt = car.in.st || 1; } }
  else ai.stuckT = 0;
}

// ---------- 경찰차 AI ----------
function policeDrive(car, dt) {
  const ai = car.ai, P = Game.player;
  car.siren = Wanted.stars > 0;
  if (ai.mode === 'block') { car.in.thr = 0; car.in.brk = 1; car.in.st = 0; return; }
  if (Wanted.stars === 0) { car.siren = false; trafficFromHere(car, 'traffic'); car.ai.cruise = 13; return; }
  if (ai.revT > 0) { ai.revT -= dt; car.in.thr = -0.9; car.in.brk = 0; car.in.st = -ai.revSt; car.in.hb = false; return; }
  const seen = Wanted.seen;
  const tx0 = seen ? P.px : Wanted.searchX, ty0 = seen ? P.py : Wanted.searchY;
  const dT = dist(car.x, car.y, tx0, ty0);
  const direct = dT < 45 && losClear(car.x, car.y, tx0, ty0);
  let tx = tx0, ty = ty0, v0 = 30;
  if (direct) {
    const pv = P.car ? [P.car.vx, P.car.vy] : [P.vx, P.vy];
    const lead = seen ? clamp(dT / 25, 0, 1.2) : 0;
    tx += pv[0] * lead; ty += pv[1] * lead;
    const tgtSpeed = Math.hypot(pv[0], pv[1]);
    v0 = dT < 12 && tgtSpeed < 4 ? 2 : 34;
    ai.path = null;
  } else {
    ai.repath -= dt;
    if (!ai.path || ai.repath <= 0) {
      ai.repath = 1.5;
      const from = nearestNode(car.x + car.vx * 0.5, car.y + car.vy * 0.5), to = nearestNode(tx0, ty0);
      const path = nodePath(from.id, to.id) || [from.id];
      ai.path = path.map(id => ({ x: World.nodes[id].x, y: World.nodes[id].y }));
      ai.path.push({ x: tx0, y: ty0 });
    }
    while (ai.path.length > 1 && dist2(ai.path[0].x, ai.path[0].y, car.x, car.y) < 7 * 7) ai.path.shift();
    const p0 = ai.path[0]; tx = p0.x; ty = p0.y;
    if (ai.path.length > 1) {
      const p1 = ai.path[1], dd = dist(car.x, car.y, p0.x, p0.y);
      const ang = Math.abs(angNorm(Math.atan2(p1.y - p0.y, p1.x - p0.x) - car.a));
      if (ang > 0.5) v0 = Math.min(v0, 9 + dd * 0.7);
    }
  }
  pursuitSteer(car, tx, ty);
  car.in.hb = direct && Math.abs(car.in.st) > 0.95 && car.speed > 14;
  const L = findLeader(car, 10 + car.speed, false, true);
  let acc;
  if (direct && L.what === P.car) acc = 6; // 들이받기
  else acc = idmAccel(Math.max(0, car.vf), v0, L.s, L.v, 5, 6, 1, 0.4);
  applyAccel(car, acc);
  if (car.speed < 0.5 && car.in.thr > 0.4) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 1.4) { ai.stuckT = 0; ai.revT = 1.1; ai.revSt = car.in.st || 1; } }
  else ai.stuckT = 0;
  // 도보 추격으로 전환
  if (!P.car && dist(car.x, car.y, P.x, P.y) < 16 && car.speed < 2.5 && car.crew > 0) {
    while (car.crew > 0) { car.crew--; const cop = spawnPed('cop', ...car.doorPos(car.crew % 2 ? 1 : -1)); cop.state = 'chase'; cop.fromCar = car; }
    car.driver = null; car.ai = null; car.siren = true;
  }
}

// 탑승자 하차(공포)
function bailOut(car, flee) {
  if (car.driver !== 'ai') return;
  const kind = car.driverKind === 'cop' ? 'cop' : car.driverKind === 'gang' ? 'gang' : car.driverKind === 'target' ? 'target' : 'civ';
  const [dx, dy] = car.doorPos(-1);
  const p = spawnPed(kind, dx, dy);
  if (car.mission) p.mission = car.mission;
  if (car.driverRef) { Object.assign(p, car.driverRef, { x: dx, y: dy, car: null, dead: false }); }
  if (flee && kind !== 'cop') { p.state = 'flee'; p.fleeT = 8; p.fearX = car.x; p.fearY = car.y; }
  if (kind === 'cop') { p.state = Wanted.stars > 0 ? 'chase' : 'patrol'; }
  car.driver = null; car.ai = null; car.siren = false;
  return p;
}
