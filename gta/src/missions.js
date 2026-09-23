'use strict';
/* =====================================================================
 * missions.js — 스토리 미션 (GTA식 '미션 제공자' 마커 → 목표 → 성공/실패)
 *
 * GTA 미션 유형을 분류하면 대부분 다음 동사 조합이다:
 *   훔쳐라(steal) · 가져가라(deliver) · 제한시간(timed) · 처리하라(assassinate) ·
 *   쓸어버려라(rampage) · 따돌려라(evade) · 파괴하라(destroy)
 * 아래 여섯 개의 미션은 이 동사들을 하나씩 소개하고 마지막에 섞는다.
 * ===================================================================== */

const Save = {
  key: 'neonharbor.save.v1',
  read() { try { const s = localStorage.getItem(this.key); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  write() {
    try {
      const P = Game.player;
      const inv = {}; for (const k in P.inv) if (k !== 'fist') inv[k] = P.inv[k] === Infinity ? -1 : P.inv[k];
      localStorage.setItem(this.key, JSON.stringify({ idx: Missions.idx, money: P.money, packages: [...Game.packages], inv, time: Game.clock }));
    } catch (e) { /* 저장 불가 환경 */ }
  },
  clear() { try { localStorage.removeItem(this.key); } catch (e) { } },
};

const Missions = {
  idx: 0, active: null, givers: [], cool: 0,
  defs: [],
  init() {
    const at = (u, v) => sidewalkNear(u * MW * T, v * MH * T);
    this.givers = [at(0.4, 0.36), at(0.55, 0.3), at(0.3, 0.62), at(0.66, 0.5), at(0.45, 0.48), at(0.62, 0.22)];
    this.defs = MISSION_DEFS;
  },
  get done() { return this.idx >= this.defs.length; },
  update(dt) {
    const P = Game.player;
    this.cool -= dt;
    if (!this.active) {
      if (this.done || P.dead || this.cool > 0) return;
      const g = this.givers[this.idx];
      if (dist(P.px, P.py, g.x, g.y) < 2.2 && (!P.car || P.car.speed < 3)) {
        if (Wanted.stars > 0) { if (!this.warned) { UI.toast('수배 중에는 의뢰를 받을 수 없다'); this.warned = true; } return; }
        this.start(this.idx);
      } else this.warned = false;
      return;
    }
    const m = this.active;
    m.t += dt;
    if (m.timer !== null) { m.timer -= dt; if (m.timer <= 0) { this.fail('시간 초과'); return; } }
    const r = m.def.update(m, dt);
    if (r === 'pass') this.pass();
    else if (r && r.fail) this.fail(r.fail);
  },
  start(i) {
    const def = this.defs[i];
    const m = { def, t: 0, stage: 0, timer: null, blips: [], objective: '', ents: [], kills: 0 };
    this.active = m;
    UI.big(def.title, '미션 시작', 2.6, '#f2c14e');
    UI.dialog(def.intro);
    def.start(m);
  },
  obj(m, text) { if (m.objective !== text) { m.objective = text; UI.objective(text); } },
  cleanup(m) {
    for (const e of m.ents) { e.persistent = false; if (e.mission === m) e.mission = null; }
    if (m.def.cleanup) m.def.cleanup(m);
  },
  pass() {
    const m = this.active; if (!m) return;
    const P = Game.player;
    const reward = m.def.reward + (m.bonus || 0);
    P.money += reward;
    this.cleanup(m); this.active = null; this.idx++; this.cool = 3;
    Sfx.passed();
    UI.big('미션 성공!', `+$${reward.toLocaleString()}`, 3.5, '#f2c14e');
    if (m.def.outro) setTimeout(() => UI.dialog(m.def.outro), 1800);
    if (this.done) setTimeout(() => { UI.big('네온 하버의 새 주인', '모든 스토리 미션 완료 — 자유롭게 도시를 누비세요', 6, '#ff5d8f'); }, 4200);
    Save.write();
  },
  fail(reason) {
    const m = this.active; if (!m) return;
    this.cleanup(m); this.active = null; this.cool = 4;
    Sfx.failed();
    UI.big('미션 실패', reason, 3.2, '#e0443e');
    UI.objective('');
  },
  onKill(p, by) {
    const m = this.active; if (!m) return;
    if (m.def.onKill) m.def.onKill(m, p, by);
  },
  onCarDestroyed(c, by) {
    const m = this.active; if (!m) return;
    if (m.def.onCar) m.def.onCar(m, c, by);
  },
  // 레이더/화면 표시용 목표 목록
  targets() {
    if (this.active) return this.active.blips.filter(b => !b.ent || !b.ent.dead).map(b => ({ x: b.ent ? (b.ent.px !== undefined ? b.ent.px : b.ent.x) : b.x, y: b.ent ? (b.ent.py !== undefined ? b.ent.py : b.ent.y) : b.y, c: b.c, big: b.big }));
    if (this.done) return [];
    const g = this.givers[this.idx];
    return [{ x: g.x, y: g.y, c: '#f2c14e', giver: true }];
  },
};

// ---------- 미션 도우미 ----------
function missionCar(m, type, x, y, a, opt = {}) {
  for (const c of Game.cars) if (!c.persistent && dist2(c.x, c.y, x, y) < 36) c.remove = true;
  Game.cars = Game.cars.filter(c => !c.remove);
  const c = new Car(type, x, y, a, { persistent: true, mission: m, ...opt });
  Game.cars.push(c); m.ents.push(c);
  return c;
}
function missionPed(m, kind, x, y) {
  const p = spawnPed(kind, x, y); p.persistent = true; p.mission = m; m.ents.push(p); return p;
}
function farParking(x, y, minD, maxD) {
  const c = World.parking.filter(p => { const d = dist(p.x, p.y, x, y); return d > minD && d < maxD; });
  return c.length ? pick(c) : null;
}
function roadsideSpot(x, y, minD, maxD) {
  for (let k = 0; k < 80; k++) {
    const e = pick(World.edgesList), A = World.nodes[e[0]], B = World.nodes[e[1]];
    const L = dist(A.x, A.y, B.x, B.y), s = rand(2 * T + 6, L - 2 * T - 6);
    const sp = laneSpot(e, chance(0.5), s);
    const d = dist(sp.x, sp.y, x, y);
    if (d > minD && d < maxD) return sp;
  }
  return laneSpot(World.edgesList[0], true, 20);
}
const blip = (m, o) => { m.blips.push(o); return o; };

// ---------- 미션 정의 ----------
const MISSION_DEFS = [
  {
    title: '1. 반시 GT',
    reward: 1500,
    intro: [['마담 윤', '네가 새로 왔다는 운전사구나. 말보다 핸들로 증명해.'], ['마담 윤', '미드타운 어딘가에 빨간 반시 GT가 서 있어. 흠집 없이 하버 포인트 차고로 가져와.'], ['도움말', 'F 키로 차에 타고 내린다. 스페이스바는 핸드브레이크(드리프트).']],
    outro: [['마담 윤', '나쁘지 않네. 차 상태에 따라 보너스를 얹어줬어.']],
    start(m) {
      const P = Game.player;
      const spot = farParking(P.px, P.py, 90, 260);
      const s = spot || roadsideSpot(P.px, P.py, 90, 260);
      m.car = missionCar(m, 'sports', s.x, s.y, s.a, { color: '#e0262b' });
      if (spot) spot.car = m.car;
      m.carBlip = blip(m, { ent: m.car, c: '#4fb3ff' });
    },
    update(m) {
      const P = Game.player, G = World.places.garage, c = m.car;
      if (c.dead || c.burnT > 0) return { fail: '반시 GT가 파괴됐다' };
      if (P.car !== c) { Missions.obj(m, P.car ? '반시 GT로 갈아타라' : '빨간 반시 GT를 훔쳐라'); m.blips = [m.carBlip]; return; }
      m.blips = [{ x: G.x, y: G.y, c: '#f2c14e', big: true }];
      if (Wanted.stars > 0) { Missions.obj(m, '수배를 떨쳐낸 뒤 차고로 가져가라'); return; }
      Missions.obj(m, `하버 포인트 차고로 가져가라 — 차량 상태 ${Math.round(c.hp / c.maxHp * 100)}%`);
      if (dist(c.x, c.y, G.x, G.y) < 7 && c.speed < 4) {
        m.bonus = Math.round(c.hp / c.maxHp * 1000);
        exitCar(P, true); c.remove = true;
        return 'pass';
      }
    },
  },
  {
    title: '2. 급행 택배',
    reward: 2000,
    intro: [['조니 박', '윤 누님이 추천하더라. 급한 물건이 있어.'], ['조니 박', '꾸러미를 챙기면 시계가 돈다. 늦으면 없던 일로 하자고.']],
    outro: [['조니 박', '딱 맞췄네! 다음에도 부탁해.']],
    start(m) {
      const P = Game.player;
      m.A = sidewalkNear(P.px + rand(-120, 120), P.py + rand(-120, 120), 60);
      const far = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.75, 0.75]].map(([u, v]) => ({ x: u * MW * T, y: v * MH * T })).sort((a, b) => dist(b.x, b.y, m.A.x, m.A.y) - dist(a.x, a.y, m.A.x, m.A.y))[0];
      m.B = sidewalkNear(far.x, far.y);
      blip(m, { x: m.A.x, y: m.A.y, c: '#4fe38a', big: true });
    },
    update(m) {
      const P = Game.player;
      if (m.stage === 0) {
        Missions.obj(m, '꾸러미를 챙겨라');
        if (dist(P.px, P.py, m.A.x, m.A.y) < 3) {
          m.stage = 1; Sfx.pickup();
          m.timer = Math.round(dist(m.A.x, m.A.y, m.B.x, m.B.y) / 11 + 30);
          m.blips = [{ x: m.B.x, y: m.B.y, c: '#f2c14e', big: true }];
        }
      } else {
        Missions.obj(m, '제한 시간 안에 배달하라');
        if (dist(P.px, P.py, m.B.x, m.B.y) < 3.5 && (!P.car || P.car.speed < 6)) { m.bonus = Math.round(m.timer) * 20; return 'pass'; }
      }
    },
  },
  {
    title: '3. 빚 수금',
    reward: 3500,
    intro: [['마담 윤', '선셋 비치에 사는 "강"이라는 녀석이 3년째 빚을 안 갚아.'], ['마담 윤', '경호원이 붙어 있고, 겁먹으면 차로 튈 거야. 놓치지 마.']],
    outro: [['마담 윤', '장부가 깨끗해졌네. 넌 쓸모가 있어.']],
    start(m) {
      const base = sidewalkNear(0.32 * MW * T, 0.78 * MH * T);
      m.target = missionPed(m, 'target', base.x, base.y);
      m.target.name = '강';
      m.blipT = blip(m, { ent: m.target, c: '#ff4d4d', big: true });
      for (let i = 0; i < 3; i++) { const g = missionPed(m, 'guard', base.x + rand(-3, 3), base.y + rand(-3, 3)); g.weapon = 'pistol'; g.shirt = '#2b2b2b'; g.state = 'idle'; g.hp = 90; }
      const rs = roadsideSpot(base.x, base.y, 8, 30);
      m.car = missionCar(m, 'muscle', rs.x, rs.y, rs.a, { color: '#101820' });
      m.onAlert = () => {
        if (m.alerted) return; m.alerted = true;
        for (const p of Game.peds) if (p.mission === m && p.kind === 'guard' && !p.dead) p.state = 'chase';
        const t = m.target;
        if (t && !t.dead && !m.car.dead && m.car.burnT <= 0 && !m.car.driver) {
          const d = m.car.doorPos(-1);
          t.state = 'goto'; t.tx = d[0]; t.ty = d[1]; t.runSpeed = 5.2;
          t.onArrive = () => {
            if (m.car.driver || m.car.dead) { t.state = 'chase'; return; }
            t.remove = true; m.target = null;
            m.car.driver = 'ai'; m.car.driverKind = 'target';
            trafficFromHere(m.car, 'flee'); m.car.ai.cruiseFlee = 26;
            m.blipT.ent = m.car;
            UI.toast('강이 차를 타고 도주한다!');
          };
        } else if (t) t.state = 'chase';
      };
    },
    update(m) {
      const P = Game.player;
      if (!m.alerted) {
        const t = m.target;
        if (t && dist(P.px, P.py, t.x, t.y) < 24 && losClear(P.px, P.py, t.x, t.y)) m.onAlert();
      }
      // 차에서 끌려 나온 강
      if (!m.target && m.car && m.car.driverKind === 'target' && m.car.driver !== 'ai') {
        const np = Game.peds.find(p => p.kind === 'target' && p.mission === m && !p.dead);
        if (np) { m.target = np; np.state = 'chase'; m.blipT.ent = np; m.car.driverKind = null; }
      }
      const ref = m.target || m.car;
      Missions.obj(m, m.alerted ? '강을 처리하라 — 도망치게 두지 마라' : '선셋 비치의 강을 찾아 처리하라');
      if (ref && dist(P.px, P.py, ref.px !== undefined ? ref.px : ref.x, ref.py !== undefined ? ref.py : ref.y) > 280) return { fail: '강이 달아났다' };
    },
    onKill(m, p) { if (p.kind === 'target' && p.mission === m) { Missions.pass(); } },
    onCar(m, c) { if (c === m.car && c.driverKind === 'target') { c.driverKind = null; Missions.pass(); } },
  },
  {
    title: '4. 청룡파 소탕',
    reward: 4000,
    intro: [['조니 박', '하버 포인트의 청룡파가 우리 창고를 털었어.'], ['조니 박', '기관단총 한 자루 챙겨줄게. 90초 안에 15명. 할 수 있지?']],
    outro: [['조니 박', '항구가 조용해졌네. 청룡파도 한동안은 얌전하겠지.']],
    start(m) {
      giveWeapon(Game.player, 'smg', 300); Game.player.weapon = 'smg';
      m.center = sidewalkNear(0.8 * MW * T, 0.35 * MH * T);
      m.blips.push({ x: m.center.x, y: m.center.y, c: '#4fe38a', big: true });
      m.stage = 0;
    },
    update(m, dt) {
      const P = Game.player;
      if (m.stage === 0) {
        Missions.obj(m, '하버 포인트로 가라');
        if (dist(P.px, P.py, m.center.x, m.center.y) < 40) { m.stage = 1; m.timer = 90; m.blips = []; UI.big('소탕 시작!', '청룡파 15명', 2, '#4fe38a'); }
        return;
      }
      Missions.obj(m, `청룡파 처치: ${m.kills} / 15`);
      m.spawnT = (m.spawnT || 0) - dt;
      const alive = Game.peds.filter(p => p.mission === m && !p.dead).length;
      if (alive < 7 && m.spawnT <= 0) {
        m.spawnT = 1.2;
        const sp = offscreenWalkSpot(22, 45) || sidewalkNear(m.center.x, m.center.y, 20);
        const g = missionPed(m, 'gang', sp.x, sp.y); g.state = 'chase';
      }
      if (m.kills >= 15) return 'pass';
    },
    onKill(m, p, by) { if (p.kind === 'gang' && by === Game.player && m.stage === 1) m.kills++; },
    cleanup(m) { for (const p of Game.peds) if (p.mission === m && !p.dead) { p.state = 'idle'; } },
  },
  {
    title: '5. 뜨거운 화물',
    reward: 6000,
    intro: [['마담 윤', '경찰서 앞에 압수품을 실은 밴이 서 있어. 우리 장부가 들어 있지.'], ['마담 윤', '타는 순간 경찰이 벌떼처럼 붙을 거야. 떨쳐내고 차고로 와.'], ['도움말', '경찰 시야에서 벗어나 수색 원 밖으로 나가면 수배가 풀린다. 페인트샵도 방법이야.']],
    outro: [['마담 윤', '장부만 무사하면 됐어. 경찰이 한동안 이를 갈겠네.']],
    start(m) {
      const S = World.places.police;
      const rs = roadsideSpot(S.x, S.y, 6, 40);
      m.van = missionCar(m, 'van', rs.x, rs.y, rs.a, { color: '#2c3e66', hp: 260 });
      m.vBlip = blip(m, { ent: m.van, c: '#4fb3ff' });
    },
    update(m) {
      const P = Game.player, v = m.van, G = World.places.garage;
      if (v.dead || v.burnT > 0) return { fail: '압수품 밴이 파괴됐다' };
      if (P.car !== v) { Missions.obj(m, '압수품 밴을 훔쳐라'); m.blips = [m.vBlip]; return; }
      if (!m.hot) { m.hot = true; Wanted.set(3); UI.toast('경찰이 밴 도난을 알아챘다!'); }
      if (Wanted.stars > 0) { Missions.obj(m, '경찰을 따돌려라'); m.blips = []; return; }
      Missions.obj(m, '밴을 차고로 가져가라');
      m.blips = [{ x: G.x, y: G.y, c: '#f2c14e', big: true }];
      if (dist(v.x, v.y, G.x, G.y) < 7 && v.speed < 4) { exitCar(P, true); v.remove = true; return 'pass'; }
    },
  },
  {
    title: '6. 항구 전쟁',
    reward: 12000,
    intro: [['마담 윤', '청룡파가 현금수송 트럭 세 대로 도시를 빠져나가려 해.'], ['마담 윤', '로켓 런처를 준비했어. 트럭을 전부 날려버려. 그리고 살아서 돌아와.']],
    outro: [['마담 윤', '이제 이 항구는 우리 거야. 네온 하버에 온 걸 환영해, 파트너.']],
    start(m) {
      giveWeapon(Game.player, 'rocket', 8); Game.player.weapon = 'rocket';
      const lastX = (World.VX[World.NX - 1] + 5) * T;
      m.trucks = [];
      for (let i = 0; i < 3; i++) {
        const y = (World.HY[1] + 2 + i * 10) * T;
        let x = lastX;
        for (let k = 0; k < 20 && solidT(Math.floor(x / T), Math.floor(y / T)); k++) x += T;
        const t = missionCar(m, 'armored', x, y, Math.PI / 2 * (i % 2 ? 1 : -1));
        m.trucks.push(t); blip(m, { ent: t, c: '#ff4d4d', big: true });
        for (let g = 0; g < 2; g++) { const gg = missionPed(m, 'gang', x + rand(-5, 5), y + rand(-5, 5)); gg.weapon = 'smg'; gg.state = 'idle'; }
      }
    },
    update(m) {
      const left = m.trucks.filter(t => !t.dead && t.burnT <= 0).length;
      m.blips = m.blips.filter(b => !b.ent || (!b.ent.dead && b.ent.burnT <= 0));
      if (left > 0) { Missions.obj(m, `현금수송 트럭을 파괴하라: 남은 트럭 ${left}`); return; }
      if (Wanted.stars > 0) { Missions.obj(m, '경찰을 따돌려라'); return; }
      return 'pass';
    },
  },
];
