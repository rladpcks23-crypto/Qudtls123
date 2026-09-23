'use strict';
/* =====================================================================
 * jobs.js — 반복 가능한 직업(합법 3 · 불법 3) + 소매치기
 *
 * GTA의 '사이드 잡'(택시·구급차·자경단, SA의 절도 수출/밀수)처럼
 * 스토리와 별개로 언제든 돈을 벌 수 있는 반복 임무다. 연속으로 성공할수록 보수가 오른다.
 *  합법: 택시 기사, 구급대원, 음식 배달   — 고용센터(J)에서 시작, 업무 차량 지급
 *  불법: 차량 수출, 밀수 운반, 소매치기   — 브로커($)에서 시작
 * ===================================================================== */

const JOBS = {
  taxi: { legal: true, name: '택시 기사', desc: '손님을 태워 목적지까지. 빨리 도착할수록 팁이 붙고, 연속 성공하면 요금이 오른다.', vehicle: 'taxi' },
  ambulance: { legal: true, name: '구급대원', desc: '쓰러진 시민을 태워 제한시간 안에 병원으로 옮긴다. G로 사이렌.', vehicle: 'ambulance' },
  delivery: { legal: true, name: '음식 배달', desc: '버거 샷에서 음식을 받아 세 집에 배달한다. 늦으면 주문 취소.', vehicle: 'compact', color: '#ff8c1a', label: '배달 차량' },
  export: { legal: false, name: '차량 수출', desc: '브로커가 주문한 차종을 훔쳐 하버 포인트 차고로. 흠집이 적을수록 비싸게 팔린다.' },
  smuggle: { legal: false, name: '밀수 운반', desc: '부두에서 밀수품을 받아 접선 장소로 옮긴다. 제보가 들어가면 경찰(★★)이 따라붙는다.' },
  vigilante: { legal: true, name: '자경단', desc: '순찰차로 도주 중인 범죄자의 차를 쫓아 부숴라. 단계가 오를수록 범인이 거칠어지고 보상이 커진다.', vehicle: 'police', label: '자경단 순찰차' },
  bus: { legal: true, name: '버스 기사', desc: '정류장 다섯 곳을 차례로 돌며 정차해 손님을 태운다. 제시간에 돌면 보너스.', vehicle: 'bus', label: '시내버스' },
  heist: { legal: false, name: '현금수송차 습격', desc: '도시를 도는 현금수송 트럭을 부숴 돈가방을 챙긴다. 공격하는 순간 경보가 울린다(★★★).' },
  pickpocket: { legal: false, name: '소매치기', desc: '표시된 부자 5명의 지갑을 턴다. 뒤로 몰래 다가가 T(모바일: 훔치기). 앞에서 들키면 신고당한다.' },
};

const Jobs = {
  active: null, stats: {}, board: null,
  openBoard(legal) {
    if (Game.state !== 'play') return;
    this.board = legal;
    Game.state = 'shop';
    document.getElementById('jobs-title').textContent = legal ? '고용센터' : '브로커';
    document.getElementById('jobs-sub').textContent = legal ? '정직하게 번 돈은 경찰이 신경 쓰지 않는다.' : '돈은 크지만 걸리면 수배가 붙는다.';
    const list = document.getElementById('jobs-list'); list.innerHTML = '';
    for (const [id, J] of Object.entries(JOBS)) {
      if (J.legal !== legal) continue;
      const st = this.stats[id] || { done: 0, earned: 0 };
      const row = document.createElement('div'); row.className = 'job-row';
      row.innerHTML = `<div><b>${J.name}</b><span>${J.desc}</span><i>완료 ${st.done}회 · 누적 $${st.earned.toLocaleString()}</i></div>`;
      const btn = document.createElement('button'); btn.className = 'btn small';
      const cur = this.active && this.active.id === id;
      btn.textContent = cur ? '그만두기' : '시작';
      btn.onclick = () => { if (cur) this.stop('일을 그만뒀다'); else this.start(id); this.closeBoard(); };
      row.append(btn); list.append(row);
    }
    document.getElementById('jobs').hidden = false;
  },
  closeBoard() { document.getElementById('jobs').hidden = true; Game.state = 'play'; Game.shopCool = 4; },

  start(id) {
    if (Missions.active) Missions.abort(`「${Missions.active.def.title}」 미션을 잠시 내려놓고 일을 시작한다 — 의뢰인 마커에서 다시 받을 수 있다`);
    if (this.active) this.stop();
    const J = JOBS[id], P = Game.player;
    const j = this.active = { id, def: J, stage: 'start', timer: null, objective: '', blips: [], count: 0, earned: 0, streak: 0, t: 0, outT: 0 };
    if (J.vehicle) {
      const sp = roadsideSpot(P.px, P.py, 6, 40);
      for (const c of Game.cars) if (!c.persistent && dist2(c.x, c.y, sp.x, sp.y) < 49) c.remove = true;
      const c = j.car = new Car(J.vehicle, sp.x, sp.y, sp.a, { persistent: true, color: J.color });
      if (J.label) c.label = J.label;
      Game.cars.push(c);
    }
    UI.big(J.name, J.legal ? '합법 직업 시작' : '불법 직업 시작', 2.4, J.legal ? '#6fb6ff' : '#ff5d8f');
    if (id === 'export') this.newExport(j);
    if (id === 'pickpocket') { j.timer = 240; j.rich = null; }
  },
  stop(msg) {
    const j = this.active; if (!j) return;
    if (j.car) j.car.persistent = false;
    for (const k of ['fare', 'patient', 'rich']) if (j[k] && !j[k].dead) { j[k].persistent = false; j[k].jobMark = false; if (k === 'patient') j[k].downT = 0.5; }
    if (j.target) j.target.persistent = false;
    for (const k of ['crook', 'truck']) if (j[k]) j[k].persistent = false;
    this.active = null;
    if (msg) UI.toast(`${j.def.name}: ${msg} (이번에 번 돈 $${j.earned.toLocaleString()})`);
    UI.objective('');
    Save.write();
  },
  pay(j, amt, why) {
    amt = Math.round(amt);
    const P = Game.player; P.money += amt; j.earned += amt; j.count++;
    const st = this.stats[j.id] = this.stats[j.id] || { done: 0, earned: 0 };
    st.done++; st.earned += amt;
    Sfx.cash(); Effects.text(P.px, P.py - 1.5, `+$${amt}`);
    UI.toast(`${why} +$${amt}`);
  },
  obj(j, t) { if (j.objective !== t) { j.objective = t; UI.objective(t); } },
  targets() {
    const j = this.active; if (!j) return [];
    return j.blips.filter(b => !b.ent || !b.ent.dead).map(b => ({ x: b.ent ? (b.ent.px !== undefined ? b.ent.px : b.ent.x) : b.x, y: b.ent ? (b.ent.py !== undefined ? b.ent.py : b.ent.y) : b.y, c: b.c, big: b.big }));
  },
  farSpot(x, y, minD, maxD) {
    for (let k = 0; k < 30; k++) {
      const a = rand(0, TAU), r = rand(minD, maxD);
      const py0 = World.base ? World.base.y1 + 16 : 40; // 군사 기지 안에 목적지를 만들지 않는다
      const px = clamp(x + Math.cos(a) * r, 40, MW * T - 60), py = clamp(y + Math.sin(a) * r, py0, MH * T - 60);
      const s = sidewalkNear(px, py);
      const d = dist(s.x, s.y, x, y);
      if (d > minD * 0.8 && d < maxD * 1.2) return s;
    }
    return sidewalkNear(x + minD, y);
  },
  stopped(c, pt, r = 7) { return c && dist(c.x, c.y, pt.x, pt.y) < r && c.speed < 3; },

  update(dt) {
    const j = this.active; if (!j) return;
    const P = Game.player, J = j.def;
    j.t += dt;
    if (j.timer !== null) { j.timer -= dt; if (j.timer <= 0) { j.timer = null; this.timeout(j); return; } }
    if (P.dead) return;
    if (J.vehicle) {
      if (j.car.dead || j.car.burnT > 0) { this.stop('업무 차량이 망가졌다'); return; }
      if (P.car !== j.car) {
        j.outT += dt;
        j.blips = [{ ent: j.car, c: '#4fb3ff' }];
        this.obj(j, j.count ? '업무 차량으로 돌아가라' : `업무 차량(${j.car.label || j.car.V.name})에 타라`);
        if (j.outT > 45) this.stop('업무 차량을 오래 떠나 일을 그만뒀다');
        return;
      }
      j.outT = 0;
    }
    this['u_' + j.id](j, dt, P);
  },
  timeout(j) {
    if (j.id === 'taxi') { UI.toast('손님이 화가 나서 내렸다'); j.stage = 'find'; j.fare = null; j.streak = 0; }
    else if (j.id === 'ambulance') { UI.toast('환자를 제때 옮기지 못했다'); if (j.patient && !j.patient.dead) { j.patient.persistent = false; } j.patient = null; j.stage = 'find'; j.streak = 0; }
    else if (j.id === 'delivery') { UI.toast('남은 주문이 취소됐다'); j.stage = 'pickup'; j.orders = []; j.streak = 0; }
    else if (j.id === 'smuggle') { UI.toast('접선 시간을 놓쳤다'); j.stage = 'pickup'; }
    else if (j.id === 'pickpocket') { this.stop(`시간이 다 됐다 (${j.count}/5)`); }
    else if (j.id === 'vigilante') { UI.toast('범인이 달아났다'); if (j.crook) { j.crook.persistent = false; j.crook.remove = !onScreen(j.crook.x, j.crook.y, 10); } j.crook = null; }
    else if (j.id === 'bus') { UI.toast('노선 운행 시간을 넘겼다 — 보너스 없음'); }
    else if (j.id === 'heist') { UI.toast('현금수송차가 금고로 들어갔다'); if (j.truck) j.truck.persistent = false; j.truck = null; j.wait = 15; }
  },

  // ----- 택시 -----
  u_taxi(j, dt, P) {
    const c = j.car;
    if (j.stage === 'start' || j.stage === 'find') {
      if (!j.fare || j.fare.dead || !Game.peds.includes(j.fare)) {
        const s = this.farSpot(c.x, c.y, 60, 150);
        const f = spawnPed('civ', s.x, s.y); f.state = 'idle'; f.persistent = true; f.homeX = s.x; f.homeY = s.y;
        j.fare = f; j.stage = 'find'; j.timer = null;
      }
      j.blips = [{ ent: j.fare, c: '#f2c14e', big: true }];
      this.obj(j, `손님을 태워라 (연속 ${j.streak})`);
      if (this.stopped(c, j.fare, 7)) {
        j.fare.remove = true; j.fare = null;
        j.dest = this.farSpot(c.x, c.y, 150, 400); j.fdist = dist(c.x, c.y, j.dest.x, j.dest.y);
        j.timer = Math.round(j.fdist / 9 + 20); j.stage = 'ride';
        UI.toast(`손님: "${DIST_NAMES[districtAt(j.dest.x, j.dest.y)]}으로 가 주세요."`);
      }
    } else if (j.stage === 'ride') {
      j.blips = [{ x: j.dest.x, y: j.dest.y, c: '#f2c14e', big: true }];
      this.obj(j, '손님을 목적지에 내려줘라');
      if (this.stopped(c, j.dest, 7)) {
        const tip = Math.max(0, Math.round(j.timer)) * 2, hurt = c.hp / c.maxHp < 0.5 ? 0.6 : 1;
        this.pay(j, (20 + j.fdist * 0.25 + tip) * hurt + j.streak * 10, '택시 요금');
        j.streak++; j.timer = null; j.stage = 'find';
      }
    }
  },
  // ----- 구급대원 -----
  u_ambulance(j, dt, P) {
    const c = j.car;
    if (j.stage === 'start' || j.stage === 'find') {
      if (!j.patient) {
        const s = this.farSpot(c.x, c.y, 80, 220);
        const p = spawnPed('civ', s.x, s.y); p.persistent = true; p.downT = 1e9; p.state = 'idle'; p.homeX = s.x; p.homeY = s.y;
        j.patient = p; j.stage = 'find'; j.timer = Math.round(dist(c.x, c.y, s.x, s.y) / 9 + 25);
      }
      j.blips = [{ ent: j.patient, c: '#ff4d4d', big: true }];
      this.obj(j, '쓰러진 환자에게 가라');
      if (j.patient.dead) { j.patient = null; return; }
      if (this.stopped(c, j.patient, 7)) {
        j.patient.remove = true; j.patient = null;
        const hs = [World.places.hospital, World.places.clinic].filter(Boolean).sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y));
        j.dest = hs[0]; j.timer = Math.round(dist(c.x, c.y, j.dest.x, j.dest.y) / 9 + 20); j.stage = 'ride';
        UI.toast('환자 탑승! 병원으로 서둘러라');
      }
    } else {
      j.blips = [{ x: j.dest.x, y: j.dest.y, c: '#ff4d4d', big: true }];
      this.obj(j, '환자를 병원으로 이송하라');
      if (this.stopped(c, j.dest, 8)) { this.pay(j, 100 + j.streak * 25 + Math.max(0, j.timer) * 2, '환자 이송'); j.streak++; j.timer = null; j.stage = 'find'; }
    }
  },
  // ----- 음식 배달 -----
  u_delivery(j, dt, P) {
    const c = j.car;
    if (j.stage === 'start' || j.stage === 'pickup') {
      if (!j.shop) j.shop = [World.places.burger, World.places.burger2].filter(Boolean).sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y))[0];
      j.stage = 'pickup';
      j.blips = [{ x: j.shop.x, y: j.shop.y, c: '#ffb347', big: true }];
      this.obj(j, '버거 샷에서 음식을 받아라');
      if (this.stopped(c, j.shop, 8)) {
        j.orders = []; let total = 0, px = j.shop.x, py = j.shop.y;
        for (let i = 0; i < 3; i++) { const s = this.farSpot(j.shop.x, j.shop.y, 70, 260); j.orders.push(s); total += dist(px, py, s.x, s.y); px = s.x; py = s.y; }
        j.timer = Math.round(total / 9 + 40); j.stage = 'deliver'; j.shop = null;
        UI.toast('주문 3건! 아무 순서로나 배달하라');
      }
    } else {
      j.blips = j.orders.map(o => ({ x: o.x, y: o.y, c: '#ffb347', big: true }));
      this.obj(j, `음식 배달: 남은 주문 ${j.orders.length}`);
      for (let i = j.orders.length - 1; i >= 0; i--) if (this.stopped(c, j.orders[i], 7)) {
        j.orders.splice(i, 1); this.pay(j, 35 + (j.timer > 30 ? 15 : 0) + j.streak * 5, '배달 완료');
      }
      if (!j.orders.length) { this.pay(j, 50, '모든 배달 완료 보너스'); j.streak++; j.timer = null; j.stage = 'pickup'; }
    }
  },
  // ----- 차량 수출 -----
  newExport(j) {
    const P = Game.player;
    const types = [['sports', 2200], ['muscle', 1500], ['sedan', 700], ['van', 900], ['compact', 500], ['police', 3200]];
    const [type, base] = pick(types);
    const sp = farParking(P.px, P.py, 120, 380) || roadsideSpot(P.px, P.py, 120, 380);
    for (const c of Game.cars) if (!c.persistent && dist2(c.x, c.y, sp.x, sp.y) < 49) c.remove = true;
    const car = new Car(type, sp.x, sp.y, sp.a, { persistent: true });
    Game.cars.push(car);
    j.target = car; j.base = base; j.stage = 'steal';
    UI.toast(`브로커 주문: ${VTYPES[type].name} (기준가 $${base.toLocaleString()})`);
  },
  u_export(j, dt, P) {
    const c = j.target, G = World.places.garage;
    if (c.dead || c.burnT > 0) { UI.toast('주문한 차가 망가졌다. 새 주문이 들어온다'); c.persistent = false; this.newExport(j); return; }
    if (P.car !== c) { j.blips = [{ ent: c, c: '#4fb3ff', big: true }]; this.obj(j, `${c.V.name}을(를) 훔쳐라`); return; }
    j.blips = [{ x: G.x, y: G.y, c: '#f2c14e', big: true }];
    if (Wanted.stars > 0) { this.obj(j, '수배를 떨친 뒤 차고로 가져가라'); return; }
    this.obj(j, `차고로 가져가라 — 차량 상태 ${Math.round(c.hp / c.maxHp * 100)}%`);
    if (this.stopped(c, G, 7)) {
      exitCar(P, true); c.remove = true;
      this.pay(j, j.base * (0.3 + 0.7 * c.hp / c.maxHp), '차량 납품');
      this.newExport(j);
    }
  },
  // ----- 밀수 운반 -----
  u_smuggle(j, dt, P) {
    if (j.stage === 'start' || j.stage === 'pickup') {
      j.stage = 'pickup';
      if (!j.pick) j.pick = sidewalkNear((World.VX[World.NX - 1] + 3) * T, rand(0.25, 0.7) * MH * T);
      j.blips = [{ x: j.pick.x, y: j.pick.y, c: '#ff5d8f', big: true }];
      this.obj(j, '부두에서 밀수품을 받아라');
      if (dist(P.px, P.py, j.pick.x, j.pick.y) < 4 && (!P.car || P.car.speed < 3)) {
        j.pick = null; j.dest = this.farSpot(P.px, P.py, 280, 480);
        j.timer = Math.round(dist(P.px, P.py, j.dest.x, j.dest.y) / 10 + 45); j.stage = 'deliver';
        Sfx.pickup();
        if (chance(0.5)) { Wanted.set(2); UI.toast('누군가 제보했다! 경찰이 따라붙는다'); } else UI.toast('밀수품 확보. 조용히 옮겨라');
      }
    } else {
      j.blips = [{ x: j.dest.x, y: j.dest.y, c: '#ff5d8f', big: true }];
      this.obj(j, Wanted.stars ? '경찰을 달고 가면 접선이 깨진다 — 따돌려라' : '밀수품을 접선 장소로 옮겨라');
      if (dist(P.px, P.py, j.dest.x, j.dest.y) < 5 && (!P.car || P.car.speed < 4) && Wanted.stars === 0) { this.pay(j, 1200 + Math.min(6, j.count) * 200, '밀수품 인도'); j.timer = null; j.stage = 'pickup'; }
    }
  },
  // ----- 자경단 -----
  u_vigilante(j, dt, P) {
    const c = j.car; c.siren = true;
    if (!j.crook || !Game.cars.includes(j.crook)) {
      const sp = offscreenLaneSpot(90, 170); if (!sp) return;
      const k = new Car(pick(['muscle', 'sports', 'sedan', 'compact']), sp.x, sp.y, sp.a, { persistent: true });
      k.driver = 'ai'; k.driverKind = 'gang'; k.label = '범인 차량'; k.crook = true;
      trafficFromHere(k, 'flee'); k.ai.cruiseFlee = 17 + Math.min(10, j.count * 1.5);
      Game.cars.push(k); j.crook = k; j.timer = 110;
      UI.toast(`무전: 수배 차량 도주 중! (단계 ${j.count + 1})`);
    }
    const k = j.crook;
    j.blips = [{ ent: k, c: '#ff4d4d', big: true }];
    this.obj(j, `범인 차량을 부숴라 — 단계 ${j.count + 1}`);
    if (k.dead || k.burnT > 0 || k.driver !== 'ai') {
      k.persistent = false; j.crook = null; j.timer = null;
      this.pay(j, 250 + j.count * 120, '범인 검거');
    }
  },
  // ----- 버스 기사 -----
  u_bus(j, dt, P) {
    const c = j.car;
    if (!j.stops || !j.stops.length) {
      j.stops = []; let x = c.x, y = c.y;
      for (let i = 0; i < 5; i++) { const s = this.farSpot(x, y, 90, 170); j.stops.push(s); x = s.x; y = s.y; }
      let tot = 0, px = c.x, py = c.y; for (const s of j.stops) { tot += dist(px, py, s.x, s.y); px = s.x; py = s.y; }
      j.timer = Math.round(tot / 8 + 60); j.hold = 0; j.route = (j.route || 0) + 1;
      UI.toast(`노선 ${j.route}: 정류장 5곳`);
    }
    const s = j.stops[0];
    j.blips = [{ x: s.x, y: s.y, c: '#7ae68f', big: true }, ...(j.stops[1] ? [{ x: j.stops[1].x, y: j.stops[1].y, c: '#3d8f55' }] : [])];
    this.obj(j, `정류장에 정차하라 (남은 ${j.stops.length}곳)${j.hold > 0 ? ' — 승객 탑승 중…' : ''}`);
    if (this.stopped(c, s, 8) && c.speed < 1.5) {
      j.hold += dt;
      if (j.hold > 2) {
        j.hold = 0; j.stops.shift(); Effects.text(c.x, c.y - 2, '승객 탑승', '#7ae68f');
        this.pay(j, 45 + Math.min(5, j.streak) * 8, '정류장 요금');
        if (!j.stops.length) { if (j.timer > 0) this.pay(j, 150, '정시 운행 보너스'); j.streak++; j.timer = null; }
      }
    } else j.hold = 0;
  },
  // ----- 현금수송차 습격 -----
  u_heist(j, dt, P) {
    if (j.wait > 0) { j.wait -= dt; j.blips = []; this.obj(j, `다음 현금수송차 정보를 기다리는 중… ${Math.ceil(j.wait)}초`); return; }
    if (!j.truck || !Game.cars.includes(j.truck)) {
      const sp = offscreenLaneSpot(120, 220); if (!sp) return;
      const t = new Car('armored', sp.x, sp.y, sp.a, { persistent: true });
      t.driver = 'ai'; t.driverKind = 'civ'; t.label = '현금수송차'; trafficFromHere(t, 'traffic'); t.ai.cruise = 11;
      Game.cars.push(t); j.truck = t; j.alarm = false; j.timer = 150;
    }
    const t = j.truck;
    j.blips = [{ ent: t, c: '#f2c14e', big: true }];
    if (!j.alarm && t.hp < t.maxHp) { j.alarm = true; Wanted.set(Math.max(3, Wanted.stars)); UI.toast('현금수송차 경보 발령!'); if (t.ai) t.ai.panic = true; }
    this.obj(j, j.alarm ? '현금수송차를 부숴라!' : '현금수송차를 찾아 공격하라');
    if (t.dead || t.burnT > 0) {
      t.persistent = false; j.truck = null; j.timer = null; j.wait = 25;
      for (let i = 0; i < 4; i++) addPickup('cash', t.x + rand(-3, 3), t.y + rand(-3, 3), { amount: randi(300, 650), temp: 45 });
      this.pay(j, 800 + j.count * 150, '현금 탈취');
    }
  },
  // ----- 소매치기 -----
  u_pickpocket(j, dt, P) {
    if (!j.rich || j.rich.dead || !Game.peds.includes(j.rich) || j.rich.pickpocketed) {
      if (j.rich) { j.rich.persistent = false; j.rich.jobMark = false; }
      const b = pick(World.blocks.filter(b => { const cx = (b.loop.x0 + b.loop.x1) / 2, cy = (b.loop.y0 + b.loop.y1) / 2, d = dist(cx, cy, P.px, P.py); return d > 30 && d < 110; }));
      if (!b) return;
      const s = rand(0, b.loop.P), [x, y] = loopPoint(b.loop, s);
      const r = spawnPed('civ', x, y); Object.assign(r, { block: b, s, state: 'walk', seg: -1, rich: true, jobMark: true, persistent: true, shirt: '#2b2d42', pants: '#1b1b1f', walkSpeed: 1.1 });
      j.rich = r;
    }
    j.blips = [{ ent: j.rich, c: '#f2c14e', big: true }];
    this.obj(j, `부자 시민의 지갑을 털어라 (${j.count}/5) — 뒤에서 몰래`);
    if (j.count >= 5) { this.pay(j, 300, '소매치기 완수 보너스'); this.stop('오늘 할당량 끝'); }
  },
};

// ---------- 소매치기 (직업과 무관하게 누구에게나 시도 가능) ----------
const Pick = {
  target: null,
  scan() {
    const P = Game.player; this.target = null;
    if (P.car || P.dead || Game.state !== 'play') return;
    let bd = 1.5 * 1.5;
    for (const p of Game.peds) {
      if (p.dead || p.kind !== 'civ' || p.pickpocketed || p.downT > 0 || p.state === 'flee') continue;
      const d = dist2(p.x, p.y, P.x, P.y); if (d < bd) { bd = d; this.target = p; }
    }
  },
  attempt() {
    const P = Game.player, p = this.target; if (!p) return;
    const behind = Math.abs(angNorm(Math.atan2(P.y - p.y, P.x - p.x) - p.a)) > 1.9;
    const sneaky = Math.hypot(P.vx, P.vy) < 5;
    p.pickpocketed = true;
    if (behind && sneaky && chance(0.88)) {
      const amt = p.rich ? randi(150, 320) : randi(5, 45);
      Effects.text(p.x, p.y - 1.2, '슬쩍', '#8df28d');
      if (p.rich && Jobs.active && Jobs.active.id === 'pickpocket') Jobs.pay(Jobs.active, amt, '부자의 지갑');
      else { P.money += amt; Sfx.cash(); UI.toast(`지갑을 슬쩍했다 +$${amt}`); }
    } else {
      Effects.text(p.x, p.y - 1.2, '도둑이야!', '#ff8a80');
      Sfx.tone({ x: p.x, y: p.y, f0: 900, f1: 1300, dur: 0.3, type: 'sawtooth', vol: 0.15 });
      p.state = 'flee'; p.fleeT = 8; p.fearX = P.x; p.fearY = P.y;
      crime('theft', p.x, p.y);
      UI.toast(behind ? '너무 급하게 움직여서 들켰다' : '정면에서는 들킨다 — 뒤로 돌아가라');
    }
  },
};
