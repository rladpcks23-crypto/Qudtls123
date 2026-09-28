'use strict';
/* =====================================================================
 * events2.js — 작은 사건 14종 추가 (v2.18, 모두 20종) + 동물
 *
 *  어디서나: 히치하이커 · 주유소/편의점 강도 · 차량 고장 · 검문소 · 버려진 차 · 라이벌 조직 차량 ·
 *            화물 트럭 전복 · 현상수배범 · 길거리 레이서 도발 · 쓰러진 사람 · 분실 가방
 *  카운티:   소 떼 탈출 · 보급품 낙하 · 보안관 추격전
 *  동물: 소(농장) · 사슴(숲·산기슭) · 코요테(사막, 밤) — 사람이 다가오면 달아난다. 총에 맞으면 쓰러진다.
 * ===================================================================== */

// ---------- 동물 ----------
const ANIMALS = {
  cow: { sc: 2.1, coat: ['#f0ece4', '#5a3d2a', '#2a2420'], fear: 6, run: 3.2, walk: 0.7, hp: 90 },
  deer: { sc: 1.5, coat: ['#9a6a3c', '#8a5a30'], fear: 20, run: 7.5, walk: 1.1, hp: 40 },
  coyote: { sc: 1.05, coat: ['#b89a6a', '#9a8058'], fear: 13, run: 6.5, walk: 1.4, hp: 30 },
};
function spawnAnimal(sp, x, y) {
  const A = ANIMALS[sp], p = spawnPed('dog', x, y);
  Object.assign(p, { kind: 'animal', species: sp, state: 'animal', sc: A.sc, coat: pick(A.coat), r: 0.26 * A.sc, hp: A.hp, maxHp: A.hp, homeX: x, homeY: y, walkSpeed: A.walk, owner: null });
  return p;
}
function updateAnimal(p, dt) {
  const A = ANIMALS[p.species] || ANIMALS.cow, P = Game.player;
  const px = P.car ? P.car.x : P.x, py = P.car ? P.car.y : P.y, d = dist(px, py, p.x, p.y), fear = A.fear * (P.car ? 1.5 : 1);
  if (d < fear || p.fleeT > 0) {
    p.fleeT = Math.max(0, (p.fleeT || 0) - dt);
    const l = d || 1; pedSeek(p, p.x + (p.x - px) / l * 5, p.y + (p.y - py) / l * 5, A.run, dt, 8);
    if (p.species === 'cow' && chance(dt * 0.5)) Talk.say(p, '음메~', 1, true);
  } else {
    p.wt = (p.wt || 0) - dt;
    if (p.wt <= 0) { p.wt = rand(3, 7); p.wx = p.homeX + rand(-9, 9); p.wy = p.homeY + rand(-9, 9); if (solidT(Math.floor(p.wx / T), Math.floor(p.wy / T))) { p.wx = p.x; p.wy = p.y; } }
    pedSeek(p, p.wx, p.wy, A.walk, dt, 6);
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  const sp = Math.hypot(p.vx, p.vy); p.moving = sp; p.anim = (p.anim || 0) + sp * dt * 2.2;
  if (sp > 0.25) p.a = Math.atan2(p.vy, p.vx);
  pedStatic(p);
}
function drawAnimal(d) {
  ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.scale(d.sc, d.sc);
  if (d.dead) { ctx.fillStyle = d.coat; ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.2, 0.5, 0, TAU); ctx.fill(); ctx.restore(); return; }
  const leg = Math.sin((d.anim || 0) * 4) * 0.08 * Math.min(1, d.moving || 0);
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(0.08, 0.08, 0.42, 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(d.coat, -0.35);
  for (const [x, y] of [[0.2, 0.13], [0.2, -0.13], [-0.22, 0.13], [-0.22, -0.13]]) ctx.fillRect(x + (y > 0 ? leg : -leg) - 0.04, y - 0.04, 0.08, 0.08);
  ctx.fillStyle = d.coat; ctx.beginPath(); ctx.ellipse(0, 0, 0.34, 0.15, 0, 0, TAU); ctx.fill();
  if (d.species === 'cow' && d.coat === '#f0ece4') { ctx.fillStyle = '#2a2420'; ctx.beginPath(); ctx.arc(-0.1, 0.04, 0.07, 0, TAU); ctx.arc(0.12, -0.05, 0.05, 0, TAU); ctx.fill(); }
  ctx.fillStyle = d.coat; ctx.beginPath(); ctx.arc(0.36, 0, 0.11, 0, TAU); ctx.fill();
  if (d.species === 'deer') { ctx.strokeStyle = '#5a3d20'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(0.38, -0.05); ctx.lineTo(0.3, -0.2); ctx.moveTo(0.38, 0.05); ctx.lineTo(0.3, 0.2); ctx.stroke(); }
  if (d.species === 'cow') { ctx.fillStyle = '#d9c7a0'; ctx.fillRect(0.4, -0.13, 0.04, 0.05); ctx.fillRect(0.4, 0.08, 0.04, 0.05); }
  ctx.restore();
}

// ---------- 이벤트 ----------
const RE_OK = { // 조건 (없으면 언제나)
  hitch: P => P.car && !P.car.V.special, racer: P => P.car && !P.car.V.special && !isAir(P.car),
  cattle: P => inCounty(P.px) && (World.county.farms || []).length, airdrop: P => inCounty(P.px), sheriff: P => inCounty(P.px),
};
RE_TYPES.push('hitch', 'gasrob', 'breakdown', 'checkpoint', 'abandoned', 'rival', 'cargo', 'fugitive', 'racer', 'injured', 'briefcase', 'cattle', 'airdrop', 'sheriff');
const nearestPlace = (keys, x, y, maxD) => { let best = null, bd = maxD; for (const k of keys) { const q = World.places[k]; if (!q) continue; const d = dist(q.x, q.y, x, y); if (d < bd) { bd = d; best = q; } } return best; };
const nearOf = (a, P, r) => dist(a.x, a.y, P.px, P.py) < r;

Object.assign(Events, {
  pickType(P) { const ok = RE_TYPES.filter(t => !RE_OK[t] || RE_OK[t](P)); return pick(ok); },
  // 7) 히치하이커: 차를 세워 태우고 원하는 곳까지 (시골에서 자주)
  make_hitch(P) {
    const w = eventWalkSpot(60, 120); if (!w) return null;
    const h = spawnPed('civ', w.x, w.y); Object.assign(h, { persistent: true, state: 'idle', homeX: w.x, homeY: w.y, nameTag: '히치하이커' });
    Talk.say(h, '태워 주세요!', 3, true);
    const keys = Object.keys(World.places).filter(k => { const q = World.places[k]; const d = q && dist(q.x, q.y, w.x, w.y); return d > 350 && d < 1100 && q.label; });
    const k = pick(keys); if (!k) return null; const dest = World.places[k];
    this.announce('히치하이커', '길가의 사람을 태워 목적지까지 데려다주면 사례금');
    return {
      x: w.x, y: w.y, ents: [h], stage: 'pick', limit: 260, timeoutMsg: '히치하이커가 다른 차를 탔다',
      marks() { return this.stage === 'pick' ? [{ x: h.x, y: h.y, big: true }] : [{ x: dest.x, y: dest.y, big: true, c: '#8df28d' }]; },
      update(dt, P) {
        if (this.stage === 'pick') {
          if (h.dead) { Events.end('히치하이커가 쓰러졌다'); return; }
          if (P.car && P.car.speed < 2 && dist(P.car.x, P.car.y, h.x, h.y) < 7) { this.stage = 'ride'; h.remove = true; this.d0 = dist(P.px, P.py, dest.x, dest.y); UI.big('히치하이커 탑승', `"${dest.label}까지 부탁해요!"`, 2.6, '#4fc3ff'); }
        } else {
          this.x = P.px; this.y = P.py;
          UI.objective(`히치하이커 → ${dest.label} ${Math.round(dist(P.px, P.py, dest.x, dest.y))}m`);
          if (!P.car) { UI.objective(''); Events.end('차에서 내려 히치하이커가 떠났다'); return; }
          if (dist(P.px, P.py, dest.x, dest.y) < 16 && P.car.speed < 3) { const pay = Math.round(300 + this.d0 * 0.9); P.money += pay; UI.objective(''); Events.win('hitch', `"고마워요!" 사례금 +$${pay.toLocaleString()}`); }
        }
      },
    };
  },
  // 8) 주유소·편의점 강도: 강도 셋을 쓰러뜨리면 주인이 사례
  make_gasrob(P) {
    const q = nearestPlace([...FUEL_STATIONS, 'mart', 'mart2', 'mart3', 'mart4', 'mart5', 'c_mart1', 'c_mart2', 'c_mart3'], P.px, P.py, 280); if (!q || onScreen(q.x, q.y, 10)) return null;
    const g = pick(GANG_IDS.filter(x => x !== Gangs.mine && GANGS[x])) || 'dragon', men = [];
    for (let k = 0; k < 3; k++) { const m = spawnPed('gang', q.x + rand(-3, 3), q.y + rand(-3, 3)); setGang(m, g); Object.assign(m, { persistent: true, state: 'idle', homeX: q.x, homeY: q.y, weapon: pick(['pistol', 'smg', 'shotgun']), hat: '#111', nameTag: '강도' }); men.push(m); }
    this.announce('가게 강도', `${q.label || '가게'}에 강도가 들었다 — 쓰러뜨리면 주인이 사례`);
    return {
      x: q.x, y: q.y, ents: men, limit: 170, timeoutMsg: '강도들이 돈을 챙겨 달아났다',
      marks() { return men.filter(m => !m.dead).map(m => ({ x: m.x, y: m.y, c: '#ff5a4a' })).concat([{ x: q.x, y: q.y, big: true }]); },
      update(dt, P) {
        if (!this.hot && dist(P.px, P.py, q.x, q.y) < 22) { this.hot = true; for (const m of men) if (!m.dead) { m.state = 'chase'; Talk.say(m, '다 엎드려!', 1.8, true); } }
        if (men.every(m => m.dead || m.downT > 0)) { P.money += 2500; Empire.support.civ += 1; Events.win('gasrob', '강도를 막았다 — 주인 사례금 +$2,500 · 시민 지지 +1'); }
      },
    };
  },
  // 9) 차량 고장: 운전자 옆에 5초 서 있으면 고쳐 준다
  make_breakdown(P) {
    const sp = offscreenLaneSpot(70, 150); if (!sp) return null;
    const c = new Car(pick(['sedan', 'compact', 'van', ...(VTYPES.pickup ? ['pickup', 'pickup'] : [])]), sp.x, sp.y, sp.a, { persistent: true }); c.hp = c.maxHp * 0.35; c.ai = { mode: 'parked' }; c.driver = null; Game.cars.push(c);
    const s = sidewalkNear(sp.x, sp.y, 3), dr = spawnPed('civ', s.x, s.y); Object.assign(dr, { persistent: true, state: 'idle', homeX: s.x, homeY: s.y, nameTag: '운전자' });
    Talk.say(dr, '차가 퍼졌어요… 좀 봐 줄래요?', 3, true);
    this.announce('차량 고장', '길가에 멈춘 차 — 운전자 옆에 서 있으면 함께 고친다');
    return {
      x: sp.x, y: sp.y, ents: [c, dr], fix: 0, limit: 150, timeoutMsg: '견인차가 왔다',
      marks() { return [{ x: dr.x, y: dr.y, big: true }]; },
      update(dt, P) {
        if (Math.random() < dt * 3) Particles.smoke(c.x, c.y, 1, '#777');
        if (dr.dead) { Events.end('운전자가 쓰러졌다'); return; }
        if (!P.car && dist(P.px, P.py, c.x, c.y) < 5) { this.fix += dt; UI.objective(`고치는 중… ${Math.min(100, Math.round(this.fix / 5 * 100))}%`); } else if (this.fix > 0) UI.objective('');
        if (this.fix >= 5) { UI.objective(''); c.hp = c.maxHp; c.driver = 'ai'; c.driverKind = 'civ'; trafficFromHere(c); dr.remove = true; P.money += 500; Empire.support.civ += 0.5; Events.win('breakdown', '차를 고쳐 줬다 +$500'); }
      },
    };
  },
  // 10) 검문소: 천천히 서서 지나가면 통과, 빠르게 뚫으면 수배 (수배 중이면 바로 추격)
  make_checkpoint(P) {
    const sp = offscreenLaneSpot(90, 170); if (!sp) return null;
    const c = new Car('police', sp.x, sp.y, sp.a + Math.PI / 2, { persistent: true }); c.ai = { mode: 'parked' }; c.driver = null; c.siren = true; Game.cars.push(c); Rural.tag(c);
    const cops = [];
    for (let k = 0; k < 2; k++) { const s = sidewalkNear(sp.x, sp.y, 2); const q = spawnPed('cop', s.x + rand(-2, 2), s.y + rand(-2, 2)); Object.assign(q, { persistent: true, state: 'idle', homeX: s.x, homeY: s.y }); cops.push(q); }
    UI.toast(`${inCounty(sp.x) ? '보안관' : '경찰'} 검문소가 설치됐다 — 천천히 지나가자 (파란 표시)`);
    return {
      x: sp.x, y: sp.y, ents: [c, ...cops], stopT: 0, limit: 160, timeoutMsg: '',
      marks() { return [{ x: sp.x, y: sp.y }]; },
      update(dt, P) {
        const d = dist(P.px, P.py, sp.x, sp.y);
        if (Wanted.stars > 0 && d < 60 && !this.hot) { this.hot = true; for (const q of cops) q.state = 'chase'; }
        if (P.car && d < 12) { if (P.car.speed > 14 && !this.hot) { this.hot = true; Wanted.set(Math.max(1, Wanted.stars)); UI.toast('검문 무시! 수배 ★1'); Events.end(''); return; } if (P.car.speed < 1.5) this.stopT += dt; }
        if (this.stopT > 1.5) { Empire.support.off += 0.3; Events.win('checkpoint', '"협조 감사합니다" 검문 통과 · 공무원 지지 +0.3'); }
      },
    };
  },
  // 11) 버려진 차: 타 보면 트렁크에 돈
  make_abandoned(P) {
    const sp = offscreenLaneSpot(80, 180); if (!sp) return null;
    const c = new Car(pick(['sports', 'muscle', 'super']), sp.x, sp.y, sp.a + rand(-0.4, 0.4), { persistent: true }); c.hp = c.maxHp * 0.7; c.ai = { mode: 'parked' }; c.driver = null; c.fuel = rand(5, 25); Game.cars.push(c);
    this.announce('버려진 차', '누가 급하게 버리고 간 차가 있다');
    return {
      x: sp.x, y: sp.y, ents: [c], limit: 200, timeoutMsg: '견인차가 버려진 차를 끌고 갔다',
      marks() { return [{ x: c.x, y: c.y, big: true }]; },
      update(dt, P) { if (P.car === c) { const amt = randi(1500, 4500); P.money += amt; c.persistent = false; Events.win('abandoned', `트렁크에서 돈가방 발견 +$${amt.toLocaleString()} (연료가 거의 없다)`); } },
    };
  },
  // 12) 라이벌 조직 차량: 부수면 조직 평판 + 돈
  make_rival(P) {
    const g = pick(GANG_IDS.filter(x => x !== Gangs.mine && GANGS[x])); if (!g) return null;
    const sp = offscreenLaneSpot(70, 140); if (!sp) return null;
    const c = new Car('muscle', sp.x, sp.y, sp.a, { persistent: true, color: GANGS[g].color }); c.driver = 'ai'; c.driverKind = 'gang'; c.crew = 3; trafficFromHere(c); Game.cars.push(c);
    this.announce('라이벌 조직 차량', `${GANGS[g].name} 차가 지나간다 — 부수면 평판과 돈`);
    return {
      x: sp.x, y: sp.y, ents: [c], limit: 130, timeoutMsg: '조직 차량이 사라졌다',
      marks() { return [{ x: c.x, y: c.y, big: true, c: GANGS[g].color }]; },
      update(dt, P) {
        this.x = c.x; this.y = c.y;
        if (!Game.cars.includes(c)) { Events.end(''); return; }
        if (c.dead || c.hp < c.maxHp * 0.15) { addPickup('cash', c.x + 2, c.y, { amount: 3000, temp: 90 }); if (Gangs.mine) Gangs.addRep(30, '라이벌 차량 격파'); Events.win('rival', `${GANGS[g].name} 차량 격파 — 떨어진 돈 $3,000을 챙겨라`); }
      },
    };
  },
  // 13) 화물 트럭 전복: 흩어진 화물(돈) — 경찰이 보면 수배
  make_cargo(P) {
    const sp = offscreenLaneSpot(70, 150); if (!sp) return null;
    const c = new Car('truck', sp.x, sp.y, sp.a + rand(-1.2, 1.2), { persistent: true }); c.hp = c.maxHp * 0.15; c.ai = { mode: 'parked' }; c.driver = null; Game.cars.push(c);
    const bags = []; for (let k = 0; k < 5; k++) bags.push(addPickup('cash', sp.x + rand(-6, 6), sp.y + rand(-6, 6), { amount: randi(500, 1300), temp: 160 }));
    this.announce('화물 트럭 전복', '화물이 도로에 쏟아졌다 — 주우면 돈, 경찰이 보면 수배');
    return {
      x: sp.x, y: sp.y, ents: [c], limit: 160, timeoutMsg: '견인차가 도로를 치웠다',
      marks() { return bags.filter(b => Game.pickups.includes(b)).map(b => ({ x: b.x, y: b.y, c: '#3fbf5f' })); },
      update(dt, P) {
        if (Math.random() < dt * 2) Particles.smoke(c.x, c.y, 1.2, '#555');
        const left = bags.filter(b => Game.pickups.includes(b)).length;
        if (left <= 3 && !this.seen && Game.peds.some(q => q.kind === 'cop' && !q.dead && dist(q.x, q.y, P.px, P.py) < 60)) { this.seen = true; Wanted.set(Math.max(1, Wanted.stars)); UI.toast('경찰: 화물 절도! 수배 ★1'); }
        if (!left) Events.win('cargo', '흩어진 화물을 모두 챙겼다');
      },
    };
  },
  // 14) 현상수배범: 무장한 수배범을 쓰러뜨리면 현상금
  make_fugitive(P) {
    const w = eventWalkSpot(70, 140); if (!w) return null;
    const f = spawnPed('target', w.x, w.y); Object.assign(f, { persistent: true, state: 'idle', homeX: w.x, homeY: w.y, nameTag: '현상수배범', weapon: pick(['smg', 'shotgun', 'pistol']), shirt: '#6b2a2a' });
    this.announce('현상수배범 발견', '무장한 수배범 — 쓰러뜨리면 현상금 $3,000');
    return {
      x: w.x, y: w.y, ents: [f], limit: 180, timeoutMsg: '수배범이 숨어 버렸다',
      marks() { return [{ x: f.x, y: f.y, big: true, c: '#ff5a4a' }]; },
      update(dt, P) {
        this.x = f.x; this.y = f.y;
        if (!this.hot && dist(P.px, P.py, f.x, f.y) < 18) { this.hot = true; f.state = chance(0.5) ? 'chase' : 'flee'; f.fleeT = 60; f.fearX = P.px; f.fearY = P.py; Talk.say(f, '날 잡을 수 있을 것 같아?', 2, true); }
        if (f.dead) { P.money += 3000; Empire.support.off += 1; Events.win('fugitive', '현상수배범 처치 — 현상금 +$3,000 · 공무원 지지 +1'); }
      },
    };
  },
  // 15) 길거리 레이서 도발: 표시된 곳까지 먼저 가면 판돈
  make_racer(P) {
    const n0 = nearestNode(P.px, P.py); if (!n0) return null;
    const cands = World.nodes.filter(n => n.deg && dist(n.x, n.y, P.px, P.py) > 450 && dist(n.x, n.y, P.px, P.py) < 900);
    const goal = pick(cands); if (!goal) return null;
    const path = nodePath(n0.id, goal.id); if (!path) return null;
    let L = 0; for (let k = 1; k < path.length; k++) L += dist(World.nodes[path[k - 1]].x, World.nodes[path[k - 1]].y, World.nodes[path[k]].x, World.nodes[path[k]].y);
    const car = P.car, sx = car.x - Math.sin(car.a) * 4, sy = car.y + Math.cos(car.a) * 4;
    const r = new Car('sports', sx, sy, car.a, { persistent: true, color: pick(['#ff2d8a', '#39e36b', '#ffd700']) }); r.driver = 'ai'; r.driverKind = 'target'; trafficFromHere(r, 'flee'); r.ai.cruiseFlee = 34; Game.cars.push(r);
    const aiT = L / 24 + 4;
    this.announce('길거리 레이서', '옆 차가 도발한다 — 표시된 곳까지 먼저 가면 $2,500');
    return {
      x: P.px, y: P.py, ents: [r], t0: 0, limit: aiT + 40, timeoutMsg: '',
      marks() { return [{ x: goal.x, y: goal.y, big: true, c: '#ff4fd8' }]; },
      update(dt, P) {
        this.x = P.px; this.y = P.py; this.t0 += dt;
        UI.objective(`레이서보다 먼저 도착: ${Math.round(dist(P.px, P.py, goal.x, goal.y))}m · 상대 도착까지 ${Math.max(0, Math.ceil(aiT - this.t0))}초`);
        if (dist(P.px, P.py, goal.x, goal.y) < 18) { UI.objective(''); P.money += 2500; Events.win('racer', '레이서를 이겼다 +$2,500'); return; }
        if (this.t0 > aiT) { UI.objective(''); Events.end('레이서가 먼저 도착했다 — "느림보!"'); }
      },
    };
  },
  // 16) 쓰러진 사람: 옆에서 4초 응급처치
  make_injured(P) {
    const w = eventWalkSpot(50, 110); if (!w) return null;
    const v = spawnPed('civ', w.x, w.y); Object.assign(v, { persistent: true, state: 'idle', downT: 9999, nameTag: '쓰러진 사람' });
    this.announce('쓰러진 사람', '옆에 서 있으면 응급처치를 한다');
    return {
      x: w.x, y: w.y, ents: [v], cpr: 0, limit: 150, timeoutMsg: '구급차가 먼저 왔다',
      marks() { return [{ x: v.x, y: v.y, big: true }]; },
      update(dt, P) {
        if (v.dead) { Events.end('숨을 거뒀다'); return; }
        if (!P.car && dist(P.px, P.py, v.x, v.y) < 2.8) { this.cpr += dt; UI.objective(`응급처치 중… ${Math.min(100, Math.round(this.cpr / 4 * 100))}%`); } else if (this.cpr > 0) UI.objective('');
        if (this.cpr >= 4) { UI.objective(''); v.downT = 0; v.persistent = false; Talk.say(v, '살려 줘서 고마워요…', 2.5, true); P.money += 400; Empire.support.civ += 1; Events.win('injured', '목숨을 구했다 +$400 · 시민 지지 +1'); }
      },
    };
  },
  // 17) 분실 가방: 주우면 $2,500 — 주인에게 돌려주면 사례금 $3,000 + 시민 지지 (가방 속 돈은 돌려준다)
  make_briefcase(P) {
    const w = eventWalkSpot(50, 110); if (!w) return null;
    const bag = addPickup('cash', w.x, w.y, { amount: 2500, temp: 200 });
    const o2 = sidewalkNear(w.x + rand(-25, 25), w.y + rand(-25, 25), 12), owner = spawnPed('civ', o2.x, o2.y);
    Object.assign(owner, { persistent: true, state: 'idle', homeX: o2.x, homeY: o2.y, nameTag: '가방 주인', shirt: '#2b2d42', pants: '#1b1b1f' });
    this.announce('분실 가방', '돈가방이 떨어져 있다');
    return {
      x: w.x, y: w.y, ents: [owner], stage: 'bag', limit: 200, timeoutMsg: '',
      marks() { return this.stage === 'bag' ? (Game.pickups.includes(bag) ? [{ x: bag.x, y: bag.y, big: true }] : []) : [{ x: owner.x, y: owner.y, big: true, c: '#8df28d' }]; },
      update(dt, P) {
        if (this.stage === 'bag') { if (!Game.pickups.includes(bag)) { this.stage = 'return'; this.rt = 0; Talk.say(owner, '내 가방! 누가 봤어요?', 3, true); UI.big('가방을 주웠다 +$2,500', '주인(초록 표시)에게 돌려주면 사례금 $3,000 + 시민 지지 (가방 돈은 돌려준다) · 60초', 3.2, '#4fc3ff'); } return; }
        this.rt += dt;
        if (!owner.dead && dist(P.px, P.py, owner.x, owner.y) < 3.5) { P.money += 500; Empire.support.civ += 2; Talk.say(owner, '세상에, 정말 고마워요!', 2.5, true); Events.win('briefcase', '가방을 돌려줬다 — 사례금 $3,000 (가방 돈 $2,500 반환) · 시민 지지 +2'); }
        else if (this.rt > 60 || owner.dead) Events.end('가방 속 돈을 챙겼다');
      },
    };
  },
  // 18) 소 떼 탈출 (카운티): 소를 농장(초록 표시)으로 몰아라 — 소는 사람·차를 피해 달아난다
  make_cattle(P) {
    let farm = null, bd = 700; for (const f of World.county.farms) { const d = dist(f.x, f.y, P.px, P.py); if (d < bd && d > 60) { bd = d; farm = f; } }
    if (!farm) return null;
    const sp = (() => { let best = null, b2 = 1e9; for (const e of edgesNear(farm.x, farm.y, 90)) { const A = World.nodes[e[0]], B = World.nodes[e[1]]; for (let t = 0.1; t < 1; t += 0.1) { const x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t), d = Math.abs(dist(x, y, farm.x, farm.y) - 45); if (d < b2 && !onScreen(x, y, 6)) { b2 = d; best = { x, y }; } } } return best; })();
    if (!sp) return null;
    const cows = []; for (let k = 0; k < 5; k++) cows.push(spawnAnimal('cow', sp.x + rand(-5, 5), sp.y + rand(-5, 5)));
    for (const c of cows) { c.persistent = true; c.homeX = sp.x; c.homeY = sp.y; }
    this.announce('소 떼 탈출', '소가 도로로 나왔다 — 뒤에서 몰아 농장(초록 표시)으로 · 치면 배상');
    return {
      x: sp.x, y: sp.y, ents: cows, limit: 220, timeoutMsg: '농부가 소를 직접 데려갔다',
      marks() { return [{ x: farm.x, y: farm.y, big: true, c: '#8df28d' }, ...cows.filter(c => !c.dead).map(c => ({ x: c.x, y: c.y, c: '#f2e6bf' }))]; },
      update(dt, P) {
        const alive = cows.filter(c => !c.dead), home = alive.filter(c => dist(c.x, c.y, farm.x, farm.y) < 16).length;
        for (const c of alive) if (dist(c.x, c.y, farm.x, farm.y) < 16) { c.homeX = farm.x; c.homeY = farm.y; }
        this.x = P.px; this.y = P.py;
        UI.objective(`소 몰기: 농장 안 ${home}/4 · 남은 소 ${alive.length}`);
        if (alive.length < 4) { UI.objective(''); P.money = Math.max(0, P.money - 600); Events.end('소를 너무 많이 잃었다 — 배상금 -$600'); return; }
        if (home >= 4) { UI.objective(''); P.money += 1800; Events.win('cattle', '소를 모두 돌려보냈다 — 농부 사례금 +$1,800'); }
      },
    };
  },
  // 19) 보급품 낙하 (카운티): 하늘에서 떨어지는 상자 — 조직원도 노린다
  make_airdrop(P) {
    let spot = null;
    for (let k = 0; k < 30 && !spot; k++) { const a = rand(0, TAU), r = rand(140, 260), x = P.px + Math.cos(a) * r, y = P.py + Math.sin(a) * r, t = tileAt(x, y); if ((t === TL.SAND || t === TL.GRASS) && inCounty(x)) spot = { x, y }; }
    if (!spot) return null;
    const g = pick(GANG_IDS.filter(x => x !== Gangs.mine && GANGS[x])) || 'iron';
    this.announce('보급품 낙하', '비행기가 상자를 떨어뜨렸다 — 먼저 줍는 사람이 임자');
    const ev = {
      x: spot.x, y: spot.y, ents: [], z: 70, crate: null, limit: 200, timeoutMsg: '누군가 상자를 가져갔다',
      marks() { return [{ x: spot.x, y: spot.y, big: true, c: '#f2c14e' }]; },
      update(dt, P) {
        if (this.z > 0) { this.z = Math.max(0, this.z - dt * 6); if (this.z === 0) { this.crate = addPickup('cash', spot.x, spot.y, { amount: randi(6000, 10000), temp: 180 }); for (let k = 0; k < 3; k++) { const a = rand(0, TAU); const m = spawnPed('gang', spot.x + Math.cos(a) * 35, spot.y + Math.sin(a) * 35); setGang(m, g); Object.assign(m, { persistent: true, state: 'chase', weapon: pick(['smg', 'rifle', 'pistol']) }); this.ents.push(m); } UI.toast(`상자 착지! ${GANGS[g].name} 조직원들이 달려온다`); } return; }
        if (this.crate && !Game.pickups.includes(this.crate)) Events.win('airdrop', '보급품 상자를 챙겼다');
      },
    };
    Props.providers.push(() => (Events.cur === ev && ev.z > 0) ? [{ x: spot.x, y: spot.y, w: 1.4, d: 1.4, h: 1.2, z: ev.z, c: '#6b5a3a' }, { x: spot.x, y: spot.y, w: 5, d: 5, h: 0.2, z: ev.z + 5, c: '#f2f2f2', no2d: true }] : []);
    return ev;
  },
  // 20) 보안관 추격전 (카운티): 달아나는 용의자 차량을 멈추면 현상금
  make_sheriff(P) {
    const sp = offscreenLaneSpot(80, 150); if (!sp) return null;
    const s = new Car('muscle', sp.x, sp.y, sp.a, { persistent: true, color: '#3a3f55' }); s.driver = 'ai'; s.driverKind = 'target'; trafficFromHere(s, 'flee'); s.ai.cruiseFlee = 30; Game.cars.push(s);
    const cx = sp.x - Math.cos(sp.a) * 14, cy = sp.y - Math.sin(sp.a) * 14;
    const cop = new Car('police', cx, cy, sp.a, { persistent: true }); cop.driver = 'ai'; cop.driverKind = 'cop'; cop.siren = true; trafficFromHere(cop, 'flee'); cop.ai.cruiseFlee = 28; Game.cars.push(cop); Rural.tag(cop);
    this.announce('보안관 추격전', '보안관이 용의자를 쫓는다 — 용의자 차를 멈추면 $2,000');
    return {
      x: sp.x, y: sp.y, ents: [s, cop], limit: 150, timeoutMsg: '용의자가 카운티를 빠져나갔다',
      marks() { return [{ x: s.x, y: s.y, big: true, c: '#ff5a4a' }]; },
      update(dt, P) {
        this.x = s.x; this.y = s.y;
        if (!Game.cars.includes(s)) { Events.end(''); return; }
        if (s.dead || s.hp < s.maxHp * 0.15 || s.driver !== 'ai') { P.money += 2000; Empire.support.off += 1; Events.win('sheriff', '용의자 검거 협조 — 현상금 +$2,000 · 공무원 지지 +1'); }
      },
    };
  },
});
