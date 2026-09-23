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
      localStorage.setItem(this.key, JSON.stringify({ idx: Missions.idx, money: P.money, packages: [...Game.packages], inv, time: Game.clock, jobs: Jobs.stats, armor: Math.round(P.armor || 0), weapon: P.weapon, bag: P.bag || {}, fleet: Game.fleet || [], props: Game.props || {}, gangs: Gangs.save(), empire: Empire.save(), finance: Finance.save(), body: { maxHp: P.maxHp, endurance: P.endurance || 1, aimSkill: P.aimSkill || 1, shirt: P.shirt, pants: P.pants, hatType: P.hatType || 'none', hatCol: P.hatCol || '', logo: P.logo || '' } }));
    } catch (e) { /* 저장 불가 환경 */ }
  },
  clear() { try { localStorage.removeItem(this.key); } catch (e) { } },
};

const Missions = {
  idx: 0, active: null, givers: [], cool: 0,
  defs: [],
  init() {
    const at = (u, v) => sidewalkNear(u * MW * T, v * MH * T);
    this.givers = [at(0.4, 0.36), at(0.55, 0.3), at(0.3, 0.62), at(0.66, 0.5), at(0.45, 0.48), at(0.62, 0.22), at(0.28, 0.4), at(0.5, 0.62), at(0.58, 0.44), at(0.35, 0.25), at(0.7, 0.66), at(0.24, 0.55), at(0.5, 0.42), at(0.42, 0.7)];
    this.defs = MISSION_DEFS;
    // 미션 마커가 가게·고용센터 입구와 겹치면 둘이 동시에 열리므로 조금 옮긴다
    const taken = () => Object.values(World.places).filter(Boolean);
    this.givers = this.givers.map(g => {
      for (let k = 0; k < 20 && taken().some(p => dist(p.x, p.y, g.x, g.y) < 8); k++) g = sidewalkNear(g.x + rand(-16, 16), g.y + rand(-16, 16), 6);
      return g;
    });
  },
  get done() { return this.idx >= this.defs.length; },
  update(dt) {
    const P = Game.player;
    this.cool -= dt;
    if (!this.active) {
      if (this.done || P.dead || this.cool > 0) return;
      if (Jobs.active) return;
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
    UI.big(def.title, def.noPolice ? '미션 시작 — 조직 간 싸움이라 경찰은 개입하지 않는다' : '미션 시작', 2.6, '#f2c14e');
    if (def.noPolice) Wanted.clear();
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
  // 실패가 아니라 잠시 내려놓기 (직업을 시작할 때) — 의뢰인 마커에서 다시 받을 수 있다
  abort(reason) {
    const m = this.active; if (!m) return;
    this.cleanup(m); this.active = null; this.cool = 3;
    UI.objective(''); UI.toast(reason || '미션을 중단했다 — 의뢰인 마커에서 다시 시작할 수 있다');
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

const allTargets = () => [...(Jobs.active ? Jobs.targets() : []), ...Missions.targets(), ...GangJob.targets(), ...Empire.targets(), ...Finance.targets(), ...(Gangs.war && (!Gangs.mine || Gangs.war.A === Gangs.mine || Gangs.war.D === Gangs.mine) ? [{ x: Gangs.war.x, y: Gangs.war.y, c: '#ff3b3b', big: true }] : [])];

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
  const near = edgesNear(x, y, maxD), list = near.length ? near : World.edgesList;
  for (let k = 0; k < 80; k++) {
    const e = pick(list), A = World.nodes[e[0]], B = World.nodes[e[1]];
    const L = dist(A.x, A.y, B.x, B.y), s = rand(2 * T + 6, L - 2 * T - 6);
    const sp = laneSpot(e, chance(0.5), s);
    const d = dist(sp.x, sp.y, x, y);
    if (d > minD && d < maxD) return sp;
  }
  return laneSpot(World.edgesList[0], true, 20);
}
const blip = (m, o) => { m.blips.push(o); return o; };

// 암살 미션 공장: 표적 + 경호원 + 도주 차량. 경계하면 표적이 차로 달아나고, 끌어내면 다시 걸어서 싸운다.
function assassinDef(o) {
  return {
    title: o.title, reward: o.reward, intro: o.intro, outro: o.outro, noPolice: o.noPolice,
    start(m) {
      const base = sidewalkNear(o.u * MW * T, o.v * MH * T);
      m.target = missionPed(m, 'target', base.x, base.y);
      m.target.hp = m.target.maxHp = o.targetHp; if (o.targetLook) Object.assign(m.target, o.targetLook);
      m.blipT = blip(m, { ent: m.target, c: '#ff4d4d', big: true });
      for (let i = 0; i < o.guards; i++) { const g = missionPed(m, 'guard', base.x + rand(-4, 4), base.y + rand(-4, 4)); g.weapon = o.gWeapon; g.shirt = '#2b2b2b'; g.state = 'idle'; g.hp = g.maxHp = o.gHp; }
      const rs = roadsideSpot(base.x, base.y, 8, 30);
      m.car = missionCar(m, o.carType, rs.x, rs.y, rs.a, { color: o.carColor });
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
            UI.toast(`${o.name}이(가) 차를 타고 도주한다!`);
          };
        } else if (t) t.state = 'chase';
      };
    },
    update(m) {
      const P = Game.player;
      if (!m.alerted) { const t = m.target; if (t && dist(P.px, P.py, t.x, t.y) < 24 && losClear(P.px, P.py, t.x, t.y)) m.onAlert(); }
      if (!m.target && m.car && m.car.driverKind === 'target' && m.car.driver !== 'ai') {
        const np = Game.peds.find(p => p.kind === 'target' && p.mission === m && !p.dead);
        if (np) { m.target = np; np.state = 'chase'; m.blipT.ent = np; m.car.driverKind = null; }
      }
      const ref = m.target || m.car;
      Missions.obj(m, m.alerted ? o.objNear : o.objFar);
      if (ref && dist(P.px, P.py, ref.px !== undefined ? ref.px : ref.x, ref.py !== undefined ? ref.py : ref.y) > 280) return { fail: `${o.name}이(가) 달아났다` };
    },
    onKill(m, p) { if (p.kind === 'target' && p.mission === m) Missions.pass(); },
    onCar(m, c) { if (c === m.car && c.driverKind === 'target') { c.driverKind = null; Missions.pass(); } },
  };
}

// ---------- 미션 정의 ----------
const MISSION_DEFS = [
  {
    title: '1. 반시 GT',
    reward: 1500,
    intro: [['마담 윤', '네가 새로 왔다는 운전사구나. 말보다 핸들로 증명해.'], ['마담 윤', '미드타운 어딘가에 빨간 반시 GT가 서 있어. 흠집 없이 하버 포인트 차고로 가져와.'], ['도움말', IS_MOBILE ? '탑승 버튼으로 차에 타고 내린다. 드리프트 버튼은 핸드브레이크.' : 'F 키로 차에 타고 내린다. 스페이스바는 핸드브레이크(드리프트).']],
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
  assassinDef({
    title: '3. 빚 수금', reward: 3500, name: '강', u: 0.32, v: 0.78, guards: 3, gWeapon: 'pistol', gHp: 90, carType: 'muscle', carColor: '#101820', targetHp: 120,
    intro: [['마담 윤', '선셋 비치에 사는 "강"이라는 녀석이 3년째 빚을 안 갚아.'], ['마담 윤', '경호원이 붙어 있고, 겁먹으면 차로 튈 거야. 놓치지 마.']],
    outro: [['마담 윤', '장부가 깨끗해졌네. 넌 쓸모가 있어.']],
    objFar: '선셋 비치의 강을 찾아 처리하라', objNear: '강을 처리하라 — 도망치게 두지 마라',
  }),
  {
    title: '4. 청룡파 소탕',
    reward: 4000, noPolice: true,
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
    reward: 12000, noPolice: true,
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
  {
    title: '7. 항구 스프린트',
    reward: 3000,
    intro: [['조니 박', '다음 주 불법 레이스에 네 이름을 올렸어. 오늘은 연습이야.'], ['조니 박', '노란 반시 GT를 준비했다. 체크포인트를 전부 지나 제한시간 안에 들어와.']],
    outro: [['조니 박', '그 정도면 레이스판에서도 먹히겠어.']],
    start(m) {
      const P = Game.player, sp = roadsideSpot(P.px, P.py, 6, 30);
      m.car = missionCar(m, 'sports', sp.x, sp.y, sp.a, { color: '#f2c200' });
      let n = nearestNode(sp.x, sp.y), prev = -1; m.cps = []; m.total = 0;
      for (let i = 0; i < 60 && m.cps.length < 12; i++) {
        let opts = n.adj.filter(a => a >= 0 && a !== prev); if (!opts.length) opts = n.adj.filter(a => a >= 0);
        const nx = World.nodes[pick(opts)]; m.total += dist(n.x, n.y, nx.x, nx.y); prev = n.id; n = nx;
        if (i % 2 === 1 && !m.cps.some(c => dist(c.x, c.y, n.x, n.y) < 30)) m.cps.push({ x: n.x, y: n.y });
      }
      m.idx = 0; m.outT = 0;
    },
    update(m, dt) {
      const P = Game.player, c = m.car;
      if (c.dead || c.burnT > 0) return { fail: '레이스 차가 부서졌다' };
      if (P.car !== c) {
        if (m.stage === 0) { m.blips = [{ ent: c, c: '#4fb3ff' }]; Missions.obj(m, '노란 반시 GT에 타라'); return; }
        m.outT += dt; if (m.outT > 8) return { fail: '차에서 내려 실격' };
      } else m.outT = 0;
      if (m.stage === 0) { m.stage = 1; m.timer = Math.round(m.total / 19 + 14); UI.big('출발!', `체크포인트 ${m.cps.length}개`, 1.6, '#4fe38a'); Sfx.passed(); }
      const cp = m.cps[m.idx], nx = m.cps[m.idx + 1];
      m.blips = [{ x: cp.x, y: cp.y, c: '#4fe38a', big: true }]; if (nx) m.blips.push({ x: nx.x, y: nx.y, c: '#2a8f55' });
      Missions.obj(m, `체크포인트 ${m.idx + 1} / ${m.cps.length}`);
      if (dist(c.x, c.y, cp.x, cp.y) < 9) { m.idx++; Sfx.pickup(); if (m.idx >= m.cps.length) { m.bonus = Math.round(m.timer) * 60; return 'pass'; } }
    },
  },
  {
    title: '8. 그림자 미행',
    reward: 3500,
    intro: [['마담 윤', '시청 쪽 사람이 청룡파와 만난다는 소문이 있어.'], ['마담 윤', '검은 세다나를 따라가. 너무 붙으면 들키고, 놓치면 끝이야.']],
    outro: [['마담 윤', '역시 그랬군. 이 정보면 한동안 시청이 조용하겠어.']],
    start(m) {
      const P = Game.player, sp = roadsideSpot(P.px, P.py, 70, 140);
      const t = m.tgt = missionCar(m, 'sedan', sp.x, sp.y, sp.a, { color: '#16181c' });
      t.driver = 'ai'; t.driverKind = 'civ'; trafficFromHere(t, 'traffic'); t.ai.cruise = 12; t.label = '검은 세다나';
      m.left = 80; m.close = 0; m.far = 0;
      blip(m, { ent: t, c: '#ff4d4d', big: true });
    },
    update(m, dt) {
      const P = Game.player, t = m.tgt;
      if (t.dead || t.burnT > 0) return { fail: '표적 차가 부서졌다' };
      if (t.driver !== 'ai' || (t.ai && t.ai.panic)) return { fail: '미행을 들켰다' };
      const d = dist(P.px, P.py, t.x, t.y);
      if (m.stage === 0) { Missions.obj(m, '검은 세다나를 찾아 뒤를 밟아라'); if (d < 60) { m.stage = 1; UI.toast('미행 시작 — 10~60m 거리를 유지하라'); } return; }
      m.left -= dt;
      if (d < 12) m.close += dt; else m.close = Math.max(0, m.close - dt * 0.5);
      if (d > 70) m.far += dt; else m.far = 0;
      if (m.close > 2.5) return { fail: '너무 가까이 붙어서 들켰다' };
      if (m.far > 7) return { fail: '표적을 놓쳤다' };
      Missions.obj(m, `미행 중 · 거리 ${Math.round(d)}m ${d < 12 ? '— 너무 가깝다!' : d > 60 ? '— 놓치겠다!' : ''} · 남은 시간 ${Math.ceil(m.left)}초`);
      if (m.left <= 0) return 'pass';
    },
  },
  {
    title: '9. 편의점 털이',
    reward: 1500, noShop: true,
    intro: [['조니 박', '다운타운 24 편의점 금고가 두둑하대.'], ['조니 박', '총을 들고 들어가서 점원이 금고를 비울 때까지 버텨. 그다음은 경찰이랑 술래잡기야.']],
    outro: [['조니 박', '깔끔했어. 네 몫은 이미 주머니에 있지?']],
    start(m) { m.S = World.places.mart2 || World.places.mart; blip(m, { x: m.S.x, y: m.S.y, c: '#7ae68f', big: true }); m.hold = 0; },
    update(m, dt) {
      const P = Game.player, S = m.S;
      if (m.stage === 0) {
        Missions.obj(m, '다운타운 편의점에 총을 들고 들어가라');
        if (!P.car && dist(P.x, P.y, S.x, S.y) < 2.2) {
          if (WEAPONS[P.weapon].melee || WEAPONS[P.weapon].throw) { Missions.obj(m, '총을 꺼내라 (무기 교체)'); return; }
          m.stage = 1; m.hold = 0; UI.toast('점원: 히익! 도, 돈 드릴게요!');
        }
      } else if (m.stage === 1) {
        if (P.car || dist(P.x, P.y, S.x, S.y) > 4) { m.stage = 0; UI.toast('가게를 떠났다'); return; }
        m.hold += dt;
        Missions.obj(m, `점원이 금고를 비우는 중... ${Math.min(100, Math.round(m.hold / 6 * 100))}%`);
        if (m.hold > 6) {
          const loot = randi(900, 1700); P.money += loot; Sfx.cash(); Effects.text(P.x, P.y - 1, `+$${loot}`);
          m.stage = 2; m.blips = []; Wanted.set(2);
          UI.toast(`금고 털이 성공 +$${loot} — 경보가 울렸다!`);
        }
      } else {
        Missions.obj(m, '경찰을 따돌려라');
        if (Wanted.stars === 0) return 'pass';
      }
    },
  },
  {
    title: '10. 증인 호송',
    reward: 5000, noPolice: true,
    intro: [['마담 윤', '청룡파 회계사가 우리 쪽으로 넘어오겠대. 녀석들이 가만있지 않겠지.'], ['마담 윤', '차로 데리러 가서 선셋 비치 은신처까지 무사히 데려와. 차가 터지면 끝이야.']],
    outro: [['마담 윤', '회계사가 장부를 전부 넘겼어. 청룡파 금고가 훤히 보이네.']],
    start(m) {
      const s = sidewalkNear(0.22 * MW * T, 0.3 * MH * T);
      m.w = missionPed(m, 'civ', s.x, s.y); m.w.state = 'idle'; m.w.shirt = '#e8d9b0'; m.w.pants = '#3b3b3b';
      m.wb = blip(m, { ent: m.w, c: '#6fe0ff', big: true });
      m.safe = sidewalkNear(0.78 * MW * T, 0.8 * MH * T); m.spawnT = 0;
    },
    update(m, dt) {
      const P = Game.player;
      if (m.stage === 0) {
        if (m.w.dead) return { fail: '증인이 죽었다' };
        Missions.obj(m, P.car ? '증인 옆에 차를 세워라' : '차를 구해 증인을 데리러 가라');
        if (P.car && dist(P.car.x, P.car.y, m.w.x, m.w.y) < 7 && P.car.speed < 2.5) {
          m.w.remove = true; m.wcar = P.car; m.wcar.persistent = true; m.stage = 1;
          UI.toast('증인 탑승! 청룡파 차량이 따라붙는다');
        }
        return;
      }
      const wc = m.wcar;
      if (wc.dead || wc.burnT > 0) return { fail: '증인이 탄 차가 파괴됐다' };
      m.spawnT -= dt;
      const hunters = Game.cars.filter(c => c.mission === m && c.ai && c.ai.mode === 'hunt' && !c.dead).length;
      if (hunters < 2 && m.spawnT <= 0) {
        m.spawnT = 12;
        const sp = offscreenLaneSpot(60, 120);
        if (sp) { const h = missionCar(m, 'muscle', sp.x, sp.y, sp.a, { color: '#1f8a4c' }); h.driver = 'ai'; h.driverKind = 'gang'; h.ai = { mode: 'hunt' }; h.crew = 2; }
      }
      if (P.car !== wc) { m.blips = [{ ent: wc, c: '#6fe0ff', big: true }]; Missions.obj(m, '증인이 탄 차로 돌아가라'); return; }
      m.blips = [{ x: m.safe.x, y: m.safe.y, c: '#f2c14e', big: true }];
      Missions.obj(m, `증인을 선셋 비치 은신처로 — 차량 상태 ${Math.round(wc.hp / wc.maxHp * 100)}%`);
      if (dist(wc.x, wc.y, m.safe.x, m.safe.y) < 8 && wc.speed < 3) return 'pass';
    },
    cleanup(m) { for (const c of Game.cars) if (c.mission === m && c.ai && c.ai.mode === 'hunt') { c.ai = { mode: 'traffic', route: [] }; trafficFromHere(c); } },
  },
  {
    title: '11. 시한폭탄 밴',
    reward: 6000,
    intro: [['조니 박', '큰일 났어! 누가 우리 밴에 폭탄을 달았어. 속도가 떨어지면 터지는 놈이야.'], ['조니 박', '시속 50km 밑으로 떨어지지 말고 하버 포인트 부두까지 몰고 가. 거기 해체반이 있어.']],
    outro: [['조니 박', '살았다... 너 진짜 강심장이구나.']],
    start(m) {
      const P = Game.player, sp = roadsideSpot(P.px, P.py, 8, 35);
      m.van = missionCar(m, 'van', sp.x, sp.y, sp.a, { color: '#6b2f2f', hp: 320 }); m.van.label = '폭탄 밴';
      m.dest = sidewalkNear((World.VX[World.NX - 1] + 2) * T, 0.72 * MH * T);
      blip(m, { ent: m.van, c: '#ff4d4d', big: true }); m.slow = 0;
    },
    update(m, dt) {
      const P = Game.player, v = m.van;
      if (v.dead || v.burnT > 0) return { fail: '밴이 폭발했다' };
      if (m.stage === 0) {
        if (P.car !== v) { Missions.obj(m, '폭탄 밴에 타라'); return; }
        Missions.obj(m, '속도를 시속 50km 이상으로 올려라 — 넘는 순간 폭탄이 작동한다');
        m.blips = [{ x: m.dest.x, y: m.dest.y, c: '#f2c14e', big: true }];
        if (v.speed > 13.9) { m.stage = 1; m.timer = Math.round(dist(v.x, v.y, m.dest.x, m.dest.y) / 11 + 40); UI.big('폭탄 작동!', '시속 50km 아래로 떨어지면 터진다', 2, '#ff4d4d'); }
        return;
      }
      m.blips = [{ x: m.dest.x, y: m.dest.y, c: '#f2c14e', big: true }];
      if (v.speed < 13.9) { m.slow += dt; if (Math.floor(m.slow * 4) !== Math.floor((m.slow - dt) * 4)) Sfx.tone({ f0: 1400, f1: 1400, dur: 0.08, type: 'square', vol: 0.2 }); }
      else m.slow = Math.max(0, m.slow - dt * 0.5);
      if (m.slow > 3) { v.damage(99999, null); v.burnT = 0.01; return { fail: '속도가 떨어져 폭탄이 터졌다' }; }
      Missions.obj(m, m.slow > 0 ? `속도를 올려라! 폭발까지 ${(3 - m.slow).toFixed(1)}초` : `부두 해체반까지 달려라 — 현재 ${Math.round(v.speed * 3.6)}km/h`);
      if (dist(v.x, v.y, m.dest.x, m.dest.y) < 12) { UI.toast('해체반: 폭탄 해체 완료!'); return 'pass'; }
    },
  },
  assassinDef({
    title: '12. 왕좌', reward: 20000, name: '청룡', noPolice: true, u: 0.2, v: 0.22, guards: 8, gWeapon: 'smg', gHp: 110, carType: 'sports', carColor: '#1f8a4c', targetHp: 260,
    targetLook: { shirt: '#1f8a4c', pants: '#0d0d0d', weapon: 'rifle' },
    intro: [['마담 윤', '청룡파 두목 "청룡"이 웨스트 힐즈 저택에 숨어 있어. 경호원이 여덟이야.'], ['마담 윤', '이번 한 번이면 이 도시는 우리 거야. 끝내고 와, 파트너.']],
    outro: [['마담 윤', '끝났어. 네온 하버의 밤은 이제 우리 거야.'], ['마담 윤', '…그리고 넌 이제 이 도시에서 제일 유명한 이름이 됐지.']],
    objFar: '웨스트 힐즈 저택의 청룡을 찾아라', objNear: '청룡을 쓰러뜨려라 — 놓치면 끝이다',
  }),
  {
    title: '13. 강철 코끼리',
    reward: 15000,
    intro: [['마담 윤', '청룡파 잔당이 무기를 사 모은다는 소문이야. 우리도 한 수 위를 보여줘야지.'], ['마담 윤', '북쪽 포트 네온 기지에 라이노 전차가 있어. 끌고 와. 차고에 넣으면 경찰 쪽은 우리가 정리해 줄게.'], ['도움말', '전차는 느리지만 차를 밀어 부순다. 발사 버튼 = 주포. 기지에 들어가면 수배 ★4가 붙는다.']],
    outro: [['마담 윤', '전차라니… 이 도시에서 우리한테 덤빌 놈은 이제 없겠네.']],
    start(m) { m.spot = World.base.spots.tanks[0]; },
    update(m) {
      const P = Game.player, c = P.car, G = World.places.garage;
      if (m.tank && (m.tank.dead || m.tank.burnT > 0)) return { fail: '전차가 파괴됐다' };
      if (!c || c.type !== 'tank') {
        const t = m.tank || Game.cars.find(q => q.type === 'tank' && !q.dead && q.burnT <= 0 && Military.inside(q.x, q.y));
        m.blips = [t ? { ent: t, c: '#4fb3ff', big: true } : { x: m.spot.x, y: m.spot.y, c: '#4fb3ff', big: true }];
        Missions.obj(m, m.tank ? '전차로 돌아가라' : '포트 네온 기지에서 라이노 전차를 훔쳐라');
        return;
      }
      m.tank = c;
      m.blips = [{ x: G.x, y: G.y, c: '#f2c14e', big: true }];
      Missions.obj(m, `전차를 하버 포인트 차고로 — 전차 상태 ${Math.round(c.hp / c.maxHp * 100)}%`);
      if (dist(c.x, c.y, G.x, G.y) < 10 && c.speed < 3) {
        exitCar(P, true); c.remove = true; Wanted.clear('윤: 경찰 쪽은 정리됐다');
        return 'pass';
      }
    },
  },
  {
    title: '14. 하늘의 주인',
    reward: 18000,
    intro: [['조니 박', '큰일이야. 기지 녀석들이 우리를 노리고 공격 헬기 세 대를 띄운대.'], ['조니 박', '기지에서 헌터 헬기를 가져와서 먼저 떨어뜨려. 미사일은 적 헬기 쪽을 겨누고 쏘면 공중으로 날아간다.'], ['도움말', '헬기: 가속 = 이륙·전진, 핸들 = 방향. 발사 = 기관포, 드리프트/스페이스 = 미사일. 비행 중 하차 두 번 = 낙하산.']],
    outro: [['조니 박', '세 대 전부?! 넌 이제 네온 하버 하늘의 주인이야.']],
    start(m) { m.spot = World.base.spots.helis[0]; m.foes = []; },
    update(m) {
      const P = Game.player, c = P.car;
      if (m.stage === 0) {
        if (!c || c.type !== 'milheli' || c.alt < 30) {
          m.blips = c && c.type === 'milheli' ? [] : [{ x: m.spot.x, y: m.spot.y, c: '#4fb3ff', big: true }];
          Missions.obj(m, c && c.type === 'milheli' ? '고도를 올려라' : '포트 네온 기지에서 헌터 헬기를 가져와라');
          return;
        }
        m.stage = 1;
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3 + rand(-0.3, 0.3), x = clamp(P.px + Math.cos(a) * 200, 40, MW * T - 40), y = clamp(P.py + Math.sin(a) * 200, 40, MH * T - 40);
          const h = new Car('milheli', x, y, a + Math.PI, { persistent: true, mission: m });
          Object.assign(h, { alt: 72, driver: 'ai', driverKind: 'army', hp: 320, maxHp: 320, color: '#3d4636', label: '적 공격 헬기' });
          h.ai = { mode: 'air', fireT: 4 + i, gunT: 2, burst: 0, stay: true };
          Game.cars.push(h); m.ents.push(h); m.foes.push(h);
        }
        UI.big('적기 출현!', '공격 헬기 3대', 2.2, '#ff4d4d');
      }
      const left = m.foes.filter(h => !h.dead && h.burnT <= 0 && Game.cars.includes(h));
      m.blips = left.map(h => ({ ent: h, c: '#ff4d4d', big: true }));
      Missions.obj(m, `적 공격 헬기를 격추하라: 남은 ${left.length}대`);
      if (!left.length) return 'pass';
    },
    cleanup(m) { for (const h of m.foes || []) if (h.ai) h.ai.stay = false; },
  },
];
