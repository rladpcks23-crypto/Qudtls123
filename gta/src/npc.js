'use strict';
/* =====================================================================
 * npc.js — NPC 확장과 "GTA에는 있는데 우리에겐 없던 것" 보강
 *
 *  · 시민 유형: 회사원·조깅하는 사람·관광객·노인·통화 중·개 산책(+개)·핫도그 노점·버스커
 *  · 말풍선: 부딪히면 항의, 차가 스치면 비명, 총을 겨누면 애원, 한가할 땐 잡담
 *  · 손 들어!: 총을 겨누면 손을 들고, 계속 겨누면 지갑을 떨어뜨린다(GTA V 강도 시늉)
 *  · 구급대: 쓰러진 시민에게 구급차가 와서 되살린다(GTA III~SA의 파라메딕)
 *  · 두 조직(청룡파/파도파)의 구역 다툼, 미션 의뢰인 캐릭터, 노점 음식
 *  · 도로 위 분노(보복 운전자), 도난 경보, GPS 경로·웨이포인트, 은신처 저장, 체력 자연 회복, 치트
 * ===================================================================== */

// ---------- 시민 유형 ----------
const ARCH_W = {
  [DIST.DOWNTOWN]: { normal: 3, business: 4, phone: 2, jogger: 0.6, tourist: 1, elder: 0.4, dogwalker: 0.4 },
  [DIST.MIDTOWN]: { normal: 4, business: 2, phone: 1.5, jogger: 1, tourist: 1, elder: 1, dogwalker: 1 },
  [DIST.RESID]: { normal: 4, business: 0.6, phone: 1, jogger: 1.5, tourist: 0.3, elder: 2, dogwalker: 2.2 },
  [DIST.HARBOR]: { normal: 5, business: 0.4, phone: 1, jogger: 0.3, tourist: 0.3, elder: 0.6, dogwalker: 0.3 },
  [DIST.BEACH]: { normal: 3, business: 0.3, phone: 1, jogger: 2.2, tourist: 3, elder: 0.8, dogwalker: 1.2 },
  [DIST.PARK]: { normal: 3, business: 0.5, phone: 1, jogger: 3, tourist: 1, elder: 1.5, dogwalker: 2.5 },
  [DIST.COAST]: { normal: 3, business: 0.5, phone: 1, jogger: 2, tourist: 1, elder: 1, dogwalker: 1.5 },
};
function pickArch(district) {
  const w = ARCH_W[district] || ARCH_W[DIST.MIDTOWN];
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
  return 'normal';
}
function dressArch(p, arch) {
  p.arch = arch;
  if (arch === 'business') { p.shirt = pick(['#2b2d42', '#1b263b', '#3d405b', '#343a40']); p.pants = '#15161a'; p.walkSpeed = rand(1.4, 1.7); }
  else if (arch === 'jogger') { p.shirt = pick(['#ff4d6d', '#00c2ff', '#b8ff3d', '#ffb703']); p.pants = '#1d1d1d'; p.walkSpeed = rand(2.8, 3.4); p.band = pick(['#ffffff', '#ff4d6d', '#111']); }
  else if (arch === 'tourist') { p.shirt = pick(['#ff9f1c', '#2ec4b6', '#e71d36', '#ffbf69']); p.pants = pick(['#e9c46a', '#f4f1de']); p.walkSpeed = rand(0.9, 1.2); p.hat = '#f4e3b1'; }
  else if (arch === 'elder') { p.hair = pick(['#d9d2c5', '#bdbdbd', '#eeeeee']); p.walkSpeed = rand(0.6, 0.9); }
  else if (arch === 'dogwalker') { p.walkSpeed = rand(1.0, 1.3); spawnDog(p); }
}

// ---------- 개 ----------
const DOG_COATS = ['#c8a26b', '#3b2a1e', '#f2f2f2', '#8a6a4a', '#1d1d1d', '#d9b27c'];
function spawnDog(owner) {
  const d = spawnPed('dog', owner.x - 1, owner.y);
  Object.assign(d, { owner, r: 0.26, hp: 30, maxHp: 30, state: 'dog', coat: pick(DOG_COATS), walkSpeed: 3 });
  owner.dog = d;
  return d;
}
function updateDog(d, dt) {
  const o = d.owner, P = Game.player;
  if (o && !o.dead && Game.peds.includes(o) && o.state !== 'flee') {
    const bx = o.x - Math.cos(o.a) * 1.3 + Math.cos(o.a + 1.5) * 0.5, by = o.y - Math.sin(o.a) * 1.3 + Math.sin(o.a + 1.5) * 0.5;
    pedSeek(d, bx, by, Math.max(1.2, Math.hypot(o.vx, o.vy) + 1), dt, 10);
    if (!P.dead && !P.car && dist2(d.x, d.y, P.x, P.y) < 9 && chance(dt * 0.6)) { Talk.say(d, pick(['멍!', '멍멍!', '왈왈!']), 1.2, true); d.a = Math.atan2(P.y - d.y, P.x - d.x); }
  } else {
    // 주인을 잃으면 겁먹고 달아난다
    const fx = d.x - P.px, fy = d.y - P.py, l = Math.hypot(fx, fy) || 1;
    pedSeek(d, d.x + fx / l * 4, d.y + fy / l * 4, 5, dt, 10);
    if (chance(dt * 0.3)) Talk.say(d, '깨갱!', 1, true);
    if (!onScreen(d.x, d.y, 20)) d.remove = true;
  }
  d.x += d.vx * dt; d.y += d.vy * dt;
  const sp = Math.hypot(d.vx, d.vy); d.moving = sp; d.anim += sp * dt * 3;
  if (sp > 0.3) d.a = Math.atan2(d.vy, d.vx);
  pedStatic(d);
}
function drawDog(d) {
  ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
  if (d.dead) { ctx.fillStyle = d.coat; ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.2, 0.5, 0, TAU); ctx.fill(); ctx.restore(); return; }
  const leg = Math.sin(d.anim * 4) * 0.08 * Math.min(1, d.moving);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0.1, 0.1, 0.4, 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(d.coat, -0.3);
  for (const [x, y] of [[0.18, 0.14], [0.18, -0.14], [-0.2, 0.14], [-0.2, -0.14]]) ctx.fillRect(x + (y > 0 ? leg : -leg) - 0.04, y - 0.04, 0.08, 0.08);
  ctx.fillStyle = d.coat; ctx.beginPath(); ctx.ellipse(0, 0, 0.32, 0.14, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(0.34, 0, 0.12, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(d.coat, -0.35); ctx.beginPath(); ctx.ellipse(0.32, 0.1, 0.06, 0.04, 0, 0, TAU); ctx.ellipse(0.32, -0.1, 0.06, 0.04, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = d.coat; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(-0.3, 0); ctx.lineTo(-0.45, Math.sin(Game.time * 12) * 0.08); ctx.stroke();
  // 목줄
  const o = d.owner;
  ctx.restore();
  if (o && !o.dead && Game.peds.includes(o) && o.state !== 'flee' && dist2(o.x, o.y, d.x, d.y) < 9) {
    ctx.strokeStyle = 'rgba(200,40,40,0.8)'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(d.x + Math.cos(d.a) * 0.3, d.y + Math.sin(d.a) * 0.3); ctx.lineTo(o.x, o.y); ctx.stroke();
  }
}
// 사람 소품 (drawPed 안에서, 보행자 좌표계)
function drawArchProps(p) {
  const a = p.arch;
  if (p.state === 'handsup') { ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0.02, -0.34, 0.09, 0, TAU); ctx.arc(0.02, 0.34, 0.09, 0, TAU); ctx.fill(); }
  if (a === 'business') { ctx.fillStyle = '#3b2a1e'; ctx.fillRect(-0.1, 0.38, 0.34, 0.1); }
  else if (a === 'tourist') { ctx.fillStyle = '#111'; ctx.fillRect(0.2, -0.08, 0.14, 0.16); }
  else if (a === 'elder') { ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(0.1, 0.36); ctx.lineTo(0.4, 0.42); ctx.stroke(); }
  else if (a === 'phone' && p.state === 'walk') { ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0.08, -0.2, 0.08, 0, TAU); ctx.fill(); ctx.fillStyle = '#111'; ctx.fillRect(0.12, -0.24, 0.08, 0.1); }
  else if (a === 'busker') { ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(0.28, 0.05, 0.2, 0.13, 0.3, 0, TAU); ctx.fill(); ctx.fillStyle = '#3b2a1e'; ctx.fillRect(0.3, -0.35, 0.05, 0.4); }
}
function drawArchHead(p) {
  if (p.arch === 'jogger' && p.band) { ctx.strokeStyle = p.band; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0.04, 0, 0.15, 0, TAU); ctx.stroke(); }
  if (p.hat) { ctx.fillStyle = p.hat; ctx.beginPath(); ctx.arc(0.02, 0, 0.21, 0, TAU); ctx.fill(); ctx.fillStyle = shade(p.hat, -0.2); ctx.beginPath(); ctx.arc(0.02, 0, 0.12, 0, TAU); ctx.fill(); }
  if (p.kind === 'gang') { ctx.fillStyle = (GANGS[p.gang] || GANGS.dragon).band; ctx.beginPath(); ctx.arc(0, 0, 0.165, Math.PI * 0.4, Math.PI * 1.6); ctx.fill(); }
  if (p.medic) { ctx.fillStyle = '#d7262e'; ctx.fillRect(-0.05, -0.12, 0.1, 0.24); ctx.fillRect(-0.12, -0.05, 0.24, 0.1); }
}

// ---------- 말풍선 ----------
const LINES = {
  chat: ['오늘 날씨 좋네', '버거 샷 신메뉴 먹어봤어?', '청룡파가 요즘 설친대', '택시가 안 잡히네...', '월급날까지 사흘...', '복권 또 꽝이야', '어제 항구에서 총소리 들었어?', '이 동네 집값 미쳤어'],
  business: ['회의에 늦겠어', '주가가 또 떨어졌네', '이번 분기 실적이...', '넥타이 괜찮나?'],
  jogger: ['헉... 헉...', '오늘 10km!', '조금만 더!'],
  tourist: ['사진 한 장만요!', '여기가 그 유명한 네온 하버구나', '해변이 어느 쪽이죠?'],
  elder: ['요즘 젊은 것들은...', '에구 허리야', '옛날엔 여기 다 논이었지'],
  phone: ['응, 지금 가는 중이야', '여보세요? 안 들려!', '엄마, 나중에 전화할게', '그 얘기 진짜야?'],
  bump: ['조심해요!', '어이, 눈 좀 뜨고 다녀!', '뭐야?', '아야!', '밀지 마세요!'],
  near: ['미쳤어?!', '천천히 좀 달려!', '으악!', '면허 어디서 샀냐!'],
  beg: ['제발 쏘지 마세요!', '돈 드릴게요!', '살려주세요!', '아이가 있어요!'],
  mugged: ['다 가져가세요!', '여기요, 지갑이요!'],
  scream: ['꺄악!', '총이다!', '도망쳐!', '경찰 불러!'],
  cop: ['멈춰!', '경찰이다!', '손 들어!', '포위됐다!'],
  gang: ['우리 구역이다!', '죽고 싶냐?', '형님들한테 연락해!'],
  rage: ['내 차!!', '너 이리 와!', '보험 들었냐?!', '내려!'],
  honk: ['빵빵거리지 마!', '알았어 알았어!', '시끄러워!'],
  revive: ['으... 살았다...', '여긴 어디...', '고마워요 선생님'],
  medic: ['환자 발견!', '맥박 확인!', '괜찮으세요?'],
};
const Talk = {
  chatT: 2,
  say(p, text, dur = 2.6, force = false) {
    if (!p || p.dead || (!force && p.sayCD > Game.time)) return;
    if (!force && Game.peds.filter(q => q.sayT > 0).length > 4) return;
    p.sayT = dur; p.sayText = text; p.sayCD = Game.time + dur + rand(4, 8);
  },
  line(p, key) { this.say(p, pick(LINES[key])); },
  update(dt) {
    for (const p of Game.peds) if (p.sayT > 0) p.sayT -= dt;
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = rand(1.5, 3);
    const P = Game.player;
    const near = Game.peds.filter(p => p.kind === 'civ' && !p.dead && p.state === 'walk' && dist2(p.x, p.y, P.px, P.py) < 20 * 20 && !(p.sayT > 0));
    if (near.length && chance(0.5)) { const p = pick(near); this.line(p, LINES[p.arch] && chance(0.6) ? p.arch : 'chat'); }
  },
  draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const P = Game.player;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const v3 = Game.view !== 'top' && View3D.ok;
    for (const p of Game.peds) {
      if (p.dead) continue;
      const pr = v3 ? View3D.project(p.x, p.y, p.kind === 'dog' ? 1.1 : 2.1) : toScreen(p.x, p.y);
      if (!pr || (v3 && dist2(p.x, p.y, P.px, P.py) > 45 * 45)) continue;
      const [sx, sy] = pr;
      if (sx < -40 || sy < -40 || sx > CW + 40 || sy > CH + 40) continue;
      if (p.nameTag && dist2(p.x, p.y, P.px, P.py) < 30 * 30) {
        ctx.font = `700 ${12}px ${FONT_KR}`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(p.nameTag, sx, sy - 18); ctx.fillStyle = '#f2c14e'; ctx.fillText(p.nameTag, sx, sy - 18);
      }
      if (!(p.sayT > 0)) continue;
      ctx.font = `600 ${12.5}px ${FONT_KR}`;
      const w = ctx.measureText(p.sayText).width + 16, h = 22, bx = sx - w / 2, by = sy - (p.nameTag ? 50 : 38);
      ctx.globalAlpha = clamp(p.sayT * 3, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.94)'; roundRect(ctx, bx, by, w, h, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - 5, by + h); ctx.lineTo(sx + 5, by + h); ctx.lineTo(sx, by + h + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.kind === 'cop' ? '#1f3b73' : p.kind === 'gang' ? '#8a1f1f' : '#1a1d22'; ctx.fillText(p.sayText, sx, by + h / 2 + 0.5);
      ctx.globalAlpha = 1;
    }
  },
};

// ---------- 손 들어! (총 겨누기) ----------
const Aim = {
  target: null, t: 0,
  update(dt) {
    const P = Game.player, W = WEAPONS[P.weapon];
    let tgt = null;
    if (!P.car && !P.dead && W && !W.melee && !W.throw) {
      let best = 13;
      for (const p of Game.peds) {
        if (p.dead || p.kind !== 'civ' || p.invuln || p.medic) continue;
        const d = dist(p.x, p.y, P.x, P.y); if (d > best) continue;
        const da = Math.abs(angNorm(Math.atan2(p.y - P.y, p.x - P.x) - P.aim));
        if (da < 0.2 + 0.4 / Math.max(1, d) && losClear(P.x, P.y, p.x, p.y)) { best = d; tgt = p; }
      }
    }
    if (tgt !== this.target) { this.target = tgt; this.t = 0; } else this.t += dt;
    if (tgt && this.t > 0.35 && tgt.state !== 'handsup' && tgt.state !== 'flee' && !tgt.vendor) {
      tgt.state = 'handsup'; tgt.handsT = 0; tgt.freeT = 0; Talk.say(tgt, pick(LINES.beg), 2.5, true);
    }
  },
  updatePed(p, dt) { // updatePed의 'handsup' 상태
    const P = Game.player;
    p.vx *= 0.7; p.vy *= 0.7; p.a = Math.atan2(P.y - p.y, P.x - p.x);
    if (this.target === p) { p.handsT += dt; p.freeT = 0; } else p.freeT += dt;
    if (p.handsT > 2.2 && !p.mugged) {
      p.mugged = true;
      addPickup('cash', p.x + Math.cos(p.a) * 0.8, p.y + Math.sin(p.a) * 0.8, { amount: p.arch === 'business' ? randi(60, 200) : randi(10, 70), temp: 30 });
      Talk.say(p, pick(LINES.mugged), 2, true);
      crime('theft', p.x, p.y);
    }
    if (p.freeT > 1.8 || p.handsT > 6) { p.state = 'flee'; p.fleeT = 8; p.fearX = P.x; p.fearY = P.y; Talk.line(p, 'scream'); }
  },
};

// ---------- 두 조직 ----------
const GANGS = {
  dragon: { name: '청룡파', shirt: '#1f8a4c', band: '#1f8a4c' },
  wave: { name: '파도파', shirt: '#e07a1f', band: '#1b4f9c' },
};
function setGang(p, g) { p.gang = g; p.shirt = GANGS[g].shirt; if (GANGS[g].pants) p.pants = GANGS[g].pants; if (g === 'wave') { p.pants = '#2b3a55'; p.weapon = chance(0.4) ? 'pistol' : chance(0.5) ? 'smg' : 'bat'; } if (g === 'iron') p.weapon = chance(0.4) ? 'shotgun' : chance(0.5) ? 'pistol' : 'bat'; if (g === 'cobra') p.weapon = chance(0.4) ? 'smg' : chance(0.5) ? 'knife' : 'pistol'; }
function feudAI(p, dt) {
  const f = p.foe;
  if (!f || f.dead || !Game.peds.includes(f) || dist2(p.x, p.y, f.x, f.y) > 40 * 40) { p.foe = null; p.state = 'idle'; return; }
  const d = dist(p.x, p.y, f.x, f.y), W = WEAPONS[p.weapon];
  p.a = Math.atan2(f.y - p.y, f.x - p.x);
  if (W.melee) {
    if (d > 1.1) pedSeek(p, f.x, f.y, 4.5, dt, 12);
    else if (p.cd <= 0) { p.cd = W.rate + 0.4; fireWeapon(p, p.weapon, p.a); }
    return;
  }
  const see = losClear(p.x, p.y, f.x, f.y);
  if (!see || d > 22) { pedSeek(p, f.x, f.y, 4.2, dt, 12); return; }
  p.strafe = p.strafe || (chance(0.5) ? 1 : -1);
  pedSeek(p, p.x - Math.sin(p.a) * p.strafe, p.y + Math.cos(p.a) * p.strafe, 1.8, dt);
  if (p.cd <= 0) { p.cd = W.rate + rand(0.5, 1.2); fireWeapon(p, p.weapon, p.a + gauss() * 0.12, 0.5); }
}
function gangLook(p, dt) { // idle 상태의 조직원이 라이벌을 찾는다
  if (!chance(dt * 1.5)) return;
  // 플레이어가 라이벌 조직원이면 자기 구역에서 공격해 온다
  const P = Game.player;
  const logo = P.logo && P.logo === Gangs.mine && !P.car, r = logo ? 26 : 16; // 조직 마크를 달면 멀리서도, 어느 구역에서든 알아본다
  if (Gangs.mine && Gangs.mine !== p.gang && !p.bossNpc && !P.dead && !(P.car && P.car.alt > 1.2) && (logo || Gangs.ownerAt(p.x, p.y) === p.gang) && dist2(p.x, p.y, P.px, P.py) < r * r && losClear(p.x, p.y, P.px, P.py)) {
    p.state = 'chase'; Talk.say(p, pick(['여긴 우리 구역이다!', `${GANGS[Gangs.mine].name} 놈이다!`, '죽여!']), 2, true); return;
  }
  for (const q of Game.peds) {
    if (q.dead || q.kind !== 'gang' || q.gang === p.gang || dist2(p.x, p.y, q.x, q.y) > 16 * 16) continue;
    if (!losClear(p.x, p.y, q.x, q.y)) continue;
    p.foe = q; p.state = 'feud'; if (q.state === 'idle') { q.foe = p; q.state = 'feud'; }
    Talk.say(p, pick(LINES.gang), 2, true);
    return;
  }
}

// ---------- 구급대 (쓰러진 시민 소생) ----------
const EMS = {
  car: null, body: null, medics: [], stage: '', t: 4, st: 0,
  reset() {
    if (this.car && Game.cars.includes(this.car)) { this.car.persistent = false; this.car.siren = false; if (this.car.driver === 'ai') { this.car.ai = { mode: 'traffic', route: [] }; trafficFromHere(this.car); } }
    for (const m of this.medics) { m.persistent = false; if (!m.dead) returnToWalk(m); }
    this.car = null; this.body = null; this.medics = []; this.stage = ''; this.t = 8;
  },
  update(dt) {
    const P = Game.player;
    this.t -= dt;
    if (!this.car) {
      if (this.t > 0) return; this.t = 6;
      const body = Game.peds.find(p => p.dead && !p.emsDone && (p.kind === 'civ' || p.kind === 'cop') && p.deadT > 5 && p.deadT < 30 && dist2(p.x, p.y, P.px, P.py) < 90 * 90 && !p.mission);
      if (!body) return;
      const sp = offscreenLaneSpot(60, 120); if (!sp) return;
      const c = new Car('ambulance', sp.x, sp.y, sp.a, { persistent: true });
      c.driver = 'ai'; c.driverKind = 'medic'; c.siren = true;
      trafficFromHere(c, 'ems'); c.ai.goalD = bfsDist(nearestNode(body.x, body.y).id); c.ai.cruiseFlee = 17;
      Game.cars.push(c);
      body.emsDone = true; this.car = c; this.body = body; this.stage = 'drive'; this.st = 0;
      return;
    }
    const c = this.car, b = this.body;
    this.st += dt;
    if (c.dead || c.burnT > 0 || c.driver === 'player' || !Game.cars.includes(c) || !Game.peds.includes(b)) { this.reset(); return; }
    if (this.stage === 'drive') {
      if (dist(c.x, c.y, b.x, b.y) < 15 || this.st > 50) {
        c.ai = { mode: 'parked' };
        for (const side of [-1, 1]) {
          const [x, y] = c.doorPos(side);
          const m = spawnPed('civ', x, y); Object.assign(m, { medic: true, persistent: true, shirt: '#f4f4f4', pants: '#2b3a55', state: 'goto', tx: b.x + side * 0.7, ty: b.y, runSpeed: 3.2, onArrive: mm => { mm.state = 'idle'; mm.homeX = mm.x; mm.homeY = mm.y; mm.stay = true; } });
          this.medics.push(m);
        }
        Talk.say(this.medics[0], pick(LINES.medic), 2, true);
        this.stage = 'treat'; this.st = 0;
      }
    } else if (this.stage === 'treat') {
      const ok = this.medics.filter(m => !m.dead && m.stay && dist2(m.x, m.y, b.x, b.y) < 4);
      if (this.medics.every(m => m.dead || m.state === 'flee')) { this.reset(); return; }
      if (ok.length) { for (const m of ok) m.a = Math.atan2(b.y - m.y, b.x - m.x); this.tr = (this.tr || 0) + dt; }
      if ((this.tr || 0) > 3.5 || this.st > 25) {
        this.tr = 0;
        if (b.dead) {
          b.dead = false; b.hp = 35; b.downT = 1.2; b.persistent = false;
          if (b.kind === 'cop') { b.state = 'walk'; returnToWalk(b); } else returnToWalk(b);
          Talk.say(b, pick(LINES.revive), 2.5, true);
        }
        for (const m of this.medics) if (!m.dead) { m.stay = false; const [x, y] = c.doorPos(1); m.state = 'goto'; m.tx = x; m.ty = y; m.onArrive = mm => { mm.remove = true; }; }
        this.stage = 'leave'; this.st = 0;
      }
    } else if (this.stage === 'leave') {
      if (this.medics.every(m => m.remove || m.dead || !Game.peds.includes(m)) || this.st > 15) {
        for (const m of this.medics) if (!m.dead) m.remove = true;
        c.ai = { mode: 'traffic', route: [] }; trafficFromHere(c); c.siren = false; c.persistent = false;
        this.car = null; this.medics = []; this.stage = ''; this.t = 10;
      }
    }
  },
};
// 경로 따라 목표 지점까지 (구급차 등)
function pathDrive(car, tx, ty, dt, vmax) {
  const ai = car.ai;
  ai.repath = (ai.repath || 0) - dt;
  if (!ai.path || ai.repath <= 0) {
    ai.repath = 2;
    const from = nearestNode(car.x + car.vx * 0.5, car.y + car.vy * 0.5), to = nearestNode(tx, ty);
    ai.path = (nodePath(from.id, to.id) || [from.id]).map(id => ({ x: World.nodes[id].x, y: World.nodes[id].y }));
    ai.path.push({ x: tx, y: ty });
  }
  while (ai.path.length > 1 && dist2(ai.path[0].x, ai.path[0].y, car.x, car.y) < 49) ai.path.shift();
  const p0 = ai.path[0]; let v0 = vmax;
  if (ai.path.length > 1 && Math.abs(angNorm(Math.atan2(ai.path[1].y - p0.y, ai.path[1].x - p0.x) - car.a)) > 0.5) v0 = Math.min(v0, 8 + dist(car.x, car.y, p0.x, p0.y) * 0.6);
  if (ai.path.length === 1) v0 = Math.min(v0, dist(car.x, car.y, tx, ty) * 0.8);
  pursuitSteer(car, p0.x, p0.y); car.in.hb = false;
  const L = findLeader(car, 10 + car.speed * 1.2, true, true);
  applyAccel(car, idmAccel(Math.max(0, car.vf), v0, L.s, L.v, 3.5, 5, 1.5, 0.6));
  if (car.speed < 0.4 && car.in.thr > 0.4) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 2) { ai.stuckT = 0; ai.revT = 1.2; ai.revSt = car.in.st || 1; } } else ai.stuckT = 0;
}
function emsDrive(car, dt) {
  const ai = car.ai;
  if (ai.revT > 0) { ai.revT -= dt; car.in.thr = -0.8; car.in.brk = 0; car.in.st = -ai.revSt; return; }
  const b = EMS.body; if (!b) { car.in.thr = 0; car.in.brk = 1; return; }
  pathDrive(car, b.x, b.y, dt, 18);
}

// ---------- 미션 의뢰인 캐릭터 ----------
const CHAR_LOOK = {
  '마담 윤': { shirt: '#8b1e3f', pants: '#1a1a1a', hair: '#15110f', skin: '#f3cfb1' },
  '조니 박': { shirt: '#3b2f2a', pants: '#2b3a55', hair: '#6d4a2a', skin: '#e2b08a' },
};
const Givers = {
  npc: null, idx: -1,
  update() {
    const want = !Missions.active && !Missions.done ? Missions.idx : -1;
    if (want !== this.idx || (this.npc && (this.npc.dead || !Game.peds.includes(this.npc)))) {
      if (this.npc) { this.npc.remove = true; this.npc = null; }
      this.idx = want;
      if (want < 0) return;
      const def = Missions.defs[want], g = Missions.givers[want];
      const who = def.intro[0][0];
      const p = spawnPed('civ', g.x + 1.4, g.y + 0.4);
      Object.assign(p, CHAR_LOOK[who] || {}, { persistent: true, invuln: true, stay: true, state: 'idle', homeX: g.x + 1.4, homeY: g.y + 0.4, nameTag: who, arch: 'giver' });
      this.npc = p;
    }
    const n = this.npc, P = Game.player;
    if (n && !P.dead && dist2(n.x, n.y, P.px, P.py) < 12 * 12 && chance(0.004)) Talk.say(n, pick(['어이, 이리 와 봐', '일감이 있어', '시간 있어?']), 2);
  },
};

// ---------- 노점상 · 버스커 ----------
const Vendors = {
  list: [],
  place() {
    this.list = [];
    const plazas = [];
    for (let ty = 4; ty < MH - 4; ty++) for (let tx = 4; tx < MW - 4; tx++) if (World.tiles[tIdx(tx, ty)] === TL.PLAZA) plazas.push([tx, ty]);
    const R = mulberry32(4242), picked = [];
    for (let k = 0; k < 3000 && picked.length < 5 && plazas.length; k++) {
      const s = plazas[Math.floor(R() * plazas.length)];
      if (picked.every(q => Math.hypot(q[0] - s[0], q[1] - s[1]) > 25)) picked.push(s);
    }
    picked.forEach(([tx, ty], i) => {
      const x = (tx + 0.5) * T, y = (ty + 0.5) * T;
      const busker = i === picked.length - 1;
      const p = spawnPed('civ', x, y);
      Object.assign(p, { persistent: true, stay: true, state: 'idle', homeX: x, homeY: y, arch: busker ? 'busker' : 'vendor', vendor: !busker, nameTag: busker ? '버스커' : '핫도그', shirt: busker ? '#6b4a8a' : '#f4f4f4', pants: busker ? '#1d1d1d' : '#c7302a' });
      this.list.push(p);
    });
  },
  update(dt) {
    const P = Game.player;
    for (const v of this.list) {
      if (v.dead) continue;
      if (v.arch === 'busker' && chance(dt * 0.7) && dist2(v.x, v.y, P.px, P.py) < 30 * 30) Effects.text(v.x + rand(-0.5, 0.5), v.y - 0.8, pick(['♪', '♫', '♬']), '#e9d5ff');
      if (v.vendor && !P.car && Game.shopCool <= 0 && dist2(v.x, v.y, P.x, P.y) < 2.2 * 2.2) {
        Game.shopCool = 4;
        if (P.money < 5) { Talk.say(v, '돈이 모자라네요', 2, true); continue; }
        if (P.hp >= P.maxHp && P.stamina > 0.95) { Talk.say(v, '핫도그 하나 어때요? $5!', 2, true); continue; }
        P.money -= 5; P.hp = Math.min(P.maxHp, P.hp + 20); P.stamina = Math.min(1, P.stamina + 0.3);
        Sfx.cash(); Talk.say(v, '맛있게 드세요!', 2, true); UI.toast('핫도그 -$5 · 체력 +20');
      }
    }
  },
};
function drawVendorCart(p) {
  if (p.arch !== 'vendor' || p.dead) return;
  const cx = p.homeX + 1.1, cy = p.homeY;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx - 0.6, cy - 0.35, 1.3, 0.8);
  ctx.fillStyle = '#c9ced6'; ctx.fillRect(cx - 0.7, cy - 0.45, 1.3, 0.8);
  ctx.fillStyle = '#2b2d31'; ctx.fillRect(cx - 0.6, cy - 0.35, 1.1, 0.25);
  // 파라솔
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f4f4' : '#d7262e'; ctx.beginPath(); ctx.moveTo(cx - 0.05, cy - 0.05); ctx.arc(cx - 0.05, cy - 0.05, 1.05, i * TAU / 8, (i + 1) * TAU / 8); ctx.closePath(); ctx.globalAlpha = 0.85; ctx.fill(); }
  ctx.globalAlpha = 1;
}

// ---------- 은신처 ----------
const Safehouse = {
  use() {
    const P = Game.player;
    Game.shopCool = 8;
    if (Wanted.stars > 0) { UI.toast('수배 중에는 쉴 수 없다'); return; }
    P.hp = P.maxHp; P.stamina = 1; P.exhausted = false;
    Game.clock = (Game.clock + 360) % 1440;
    Save.write();
    UI.big('저장 완료', '6시간 푹 잤다 — 체력 회복', 2.6, '#9be15d');
  },
};

// ---------- GPS 경로 · 웨이포인트 ----------
const GPS = {
  pts: null, col: '#f2c14e', t: 0, lastKey: '',
  update(dt) {
    const P = Game.player;
    if (Game.waypoint && dist(P.px, P.py, Game.waypoint.x, Game.waypoint.y) < 14) { Game.waypoint = null; UI.toast('목적지 도착'); }
    const tg = Game.waypoint || allTargets()[0];
    if (!tg) { this.pts = null; return; }
    this.col = Game.waypoint ? '#c77dff' : tg.c;
    this.t -= dt;
    const key = `${Math.round(tg.x)},${Math.round(tg.y)}`;
    if (this.t > 0 && key === this.lastKey && this.pts) { this.pts[0] = { x: P.px, y: P.py }; return; }
    this.t = 1; this.lastKey = key;
    if (dist(P.px, P.py, tg.x, tg.y) < 30) { this.pts = [{ x: P.px, y: P.py }, { x: tg.x, y: tg.y }]; return; }
    const v = P.car ? [P.car.vx, P.car.vy] : [0, 0];
    const from = nearestNode(P.px + v[0] * 0.6, P.py + v[1] * 0.6), to = nearestNode(tg.x, tg.y);
    const path = nodePath(from.id, to.id) || [];
    this.pts = [{ x: P.px, y: P.py }, ...path.map(id => ({ x: World.nodes[id].x, y: World.nodes[id].y })), { x: tg.x, y: tg.y }];
  },
  draw(c, k, ox, oy, width) { // 월드 → (x-ox)*k 좌표계에 경로 그리기
    if (!this.pts || this.pts.length < 2) return;
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = width + 2.5;
    c.beginPath(); this.pts.forEach((p, i) => { const x = (p.x - ox) * k, y = (p.y - oy) * k; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
    c.strokeStyle = this.col; c.lineWidth = width; c.stroke();
  },
};

// ---------- 치트 (GTA 산안드레아스 코드) ----------
function cheatSpawn(type, depth = 0) {
  const P = Game.player, sp = roadsideSpot(P.px, P.py, 8, 40);
  for (const c of Game.cars) if (!c.persistent && !c.V.special && c !== P.car && dist2(c.x, c.y, sp.x, sp.y) < 100) c.remove = true;
  if (Game.cars.some(c => c.V.special && dist2(c.x, c.y, sp.x, sp.y) < 100) && depth < 8) return cheatSpawn(type, depth + 1);
  const c = new Car(type, sp.x, sp.y, sp.a); c.alt = 0; Game.cars.push(c);
  Game.waypoint = { x: sp.x, y: sp.y };
}
const Cheats = {
  buf: '',
  list: {
    HESOYAM: ['체력·방탄 가득, 차 수리, +$250,000', () => { const P = Game.player; P.hp = P.maxHp; P.armor = 100; P.money += 250000; if (P.car) { P.car.hp = P.car.maxHp; P.car.burnT = 0; } }],
    AEZAKMI: ['수배 받지 않기 (켜기/끄기)', () => { Game.noWanted = !Game.noWanted; if (Game.noWanted) Wanted.clear(); UI.toast(Game.noWanted ? '이제 경찰이 신경 쓰지 않는다' : '수배 면제 해제'); }],
    TURNUPTHEHEAT: ['수배 +2', () => { Game.noWanted = false; Wanted.set(Math.min(5, Wanted.stars + 2)); }],
    LXGIWYL: ['무기 세트', () => { const P = Game.player; for (const w of ['bat', 'pistol', 'smg', 'shotgun', 'grenade']) giveWeapon(P, w, WEAPONS[w].pack || 1); }],
    UZUMYMW: ['중화기 세트', () => { const P = Game.player; for (const w of ['rifle', 'rocket', 'grenade']) giveWeapon(P, w, WEAPONS[w].pack * 2); }],
    CPKTNWT: ['주변 차량 전부 폭파', () => { const P = Game.player; for (const c of Game.cars) if (c !== P.car && !c.dead && dist(c.x, c.y, P.px, P.py) < 70) { c.hp = 0; c.burnT = rand(0.1, 1.5); } }],
    MOTORBIKE: ['PCJ-600 오토바이 소환', () => { const P = Game.player; const c = new Car('bike', P.px + 3, P.py, 0); Game.cars.push(c); }],
    // 산안드레아스와 같은 코드: 헌터 · 라이노 · 전투기
    OHDUDE: ['헌터 공격 헬기 소환', () => cheatSpawn('milheli')],
    AIWPRTON: ['라이노 전차 소환', () => cheatSpawn('tank')],
    JUMPJET: ['라저 전투기 소환', () => cheatSpawn('jet')],
  },
  // 반환값 true = 치트를 입력하는 중이므로 이 키의 게임 단축키(P 일시정지, M 지도 등)는 무시
  key(code) {
    if (!code.startsWith('Key')) return false;
    this.buf = (this.buf + code.slice(3)).slice(-16);
    for (const name in this.list) if (this.buf.endsWith(name)) { this.apply(name); this.buf = ''; return true; }
    for (let n = Math.min(this.buf.length, 15); n >= 2; n--) { const tail = this.buf.slice(-n); for (const name in this.list) if (name.startsWith(tail)) return true; }
    return false;
  },
  apply(name) {
    const c = this.list[name.toUpperCase()];
    if (!c) { UI.toast('알 수 없는 치트'); return false; }
    c[1](); Sfx.passed(); UI.big('치트 활성화', c[0], 2, '#6fe0ff');
    return true;
  },
};
addEventListener('keydown', e => { if (typeof Game !== 'undefined' && Game.state === 'play' && Cheats.key(e.code)) Input.pressed[e.code] = false; });
