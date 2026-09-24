'use strict';
/* =====================================================================
 * story.js — 컷신 + 스토리 2부 「블랙 로터스」(미션 15~26, 선택에 따라 갈리는 결말)
 *
 *  · 컷신: 위아래 검은 띠(레터박스), 화면이 멈추고 인물 대사가 한 줄씩 나온다. 스페이스/엔터/클릭 = 다음, Esc = 건너뛰기
 *  · 단계 엔진 stepsDef({ steps }) — go(이동) · steal(차 훔치기) · deliver(배달) · kill(처치) · survive(버티기) ·
 *    chase(도주 차량 파괴) · evade(수배 떨치기) · hold(구역 지키기) · pick(물건 줍기) · choice(선택) · cut(중간 컷신)
 *  · 1부(1~14) 뒤에 이어진다. 25번에서 마담 윤 / 형사 한 중 한쪽을 고르면 26번과 엔딩이 달라진다.
 * ===================================================================== */

// ---------- 컷신 ----------
const Cutscene = {
  on: false, lines: [], i: 0, t: 0, chars: 0, done: null, prev: 'play', bars: 0,
  play(lines, done) {
    if (!lines || !lines.length) { if (done) done(); return; }
    this.on = true; this.lines = lines; this.i = 0; this.t = 0; this.chars = 0; this.done = done; this.prev = Game.state === 'cutscene' ? 'play' : Game.state; this.bars = 0;
    Game.state = 'cutscene'; UI.dialogQ = []; UI.dialogCur = null;
  },
  next() { if (this.chars < this.lines[this.i][1].length) { this.chars = 999; return; } this.i++; this.t = 0; this.chars = 0; if (this.i >= this.lines.length) this.end(); },
  end() { this.on = false; Game.state = 'play'; const d = this.done; this.done = null; if (d) d(); },
  update(dt) {
    this.bars = Math.min(1, this.bars + dt * 3); this.t += dt;
    const L = this.lines[this.i]; if (!L) { this.end(); return; }
    this.chars = Math.min(L[1].length, this.chars + dt * 32);
    if (keyHit('Escape')) { this.end(); return; }
    if (keyHit('Space', 'Enter', 'KeyF', 'PadA') || Input.mouse.clicked) this.next();
    else if (this.chars >= L[1].length && this.t > Math.max(2.4, L[1].length * 0.075) + 1.5) this.next(); // 자동 넘김
  },
  draw() {
    const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const h = Math.round(CH * 0.12 * this.bars);
    c.fillStyle = '#000'; c.fillRect(0, 0, CW, h); c.fillRect(0, CH - h, CW, h);
    const L = this.lines[this.i]; if (!L) return;
    const s = clamp(Math.min(CW, CH) / 760, 0.7, 1.2);
    txt(c, L[0], CW / 2, CH - h - 64 * s, `800 ${20 * s}px ${FONT_KR}`, '#f2c14e', 'rgba(0,0,0,0.9)', 4, 'center');
    const text = L[1].slice(0, Math.floor(this.chars));
    c.font = `500 ${19 * s}px ${FONT_KR}`;
    wrapLines(c, text, Math.min(CW - 80, 900 * s)).forEach((l, k) => txt(c, l, CW / 2, CH - h - 34 * s + k * 26 * s, `500 ${19 * s}px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'center'));
    txt(c, `스페이스: 다음 · Esc: 건너뛰기   ${this.i + 1}/${this.lines.length}`, CW - 20, h > 20 ? h - 10 : 24, `500 ${12 * s}px ${FONT_KR}`, 'rgba(255,255,255,0.6)', null, 0, 'right');
  },
};

// ---------- 스토리 상태 ----------
const Story = {
  flags: {},
  save() { return { flags: this.flags }; },
  load(o) { this.flags = (o && o.flags) || {}; },
};
SaveExt.mods.story = Story;

// 2부 인물 모습 (의뢰인 NPC)
Object.assign(CHAR_LOOK, {
  '마담 윤': { shirt: '#8b1e3f', pants: '#8b1e3f', hair: '#15110f', skin: '#f3cfb1', female: true, dress: true, hairStyle: 'bob', lip: '#b8284e', earring: '#f2d479', necklace: '#f2d479' },
  '형사 한': { shirt: '#6b5a44', pants: '#2a2a2e', hair: '#1a1a1a', skin: '#e0b894' },
  '레이서 토니': { shirt: '#ffd23f', pants: '#1a1a1a', hair: '#b5763c', skin: '#e9c2a1' },
  '미나': { shirt: '#8a63ff', pants: '#8a63ff', hair: '#141418', skin: '#f8e1d2', female: true, dress: true, hairStyle: 'bob', lip: '#b8284e', necklace: '#f2d479' },
});

// 블랙 로터스 (구역을 갖지 않는 스토리 전용 조직)
GANGS.lotus = { name: '블랙 로터스', shirt: '#15151a', band: '#e8e8e8', pants: '#0d0d10', color: '#e8e8e8', short: '로' };

// ---------- 단계 엔진 ----------
const at = (u, v) => sidewalkNear(u * MW * T, v * MH * T);
const placeOr = (k, u, v) => { const q = World.places[k]; return q ? sidewalkNear(q.x, q.y, 9) : at(u, v); }; // 가게·장소 마커 위는 피한다 (도착하자마자 상점 창이 열리지 않게)
function stepsDef(o) {
  return {
    title: o.title, reward: o.reward, intro: o.intro, outro: o.outro, noPolice: o.noPolice, cut: true,
    start(m) { m.si = -1; m.ents = m.ents || []; nextStep(m, o); },
    update(m, dt) {
      const s = o.steps[m.si]; if (!s) return 'pass';
      const r = STEP[s.t].update(m, s, dt);
      if (r && r.fail) return r;
      if (r === 'next') { if (m.si + 1 >= o.steps.length) return 'pass'; nextStep(m, o); }
    },
    cleanup(m) { if (m.hunter) m.hunter.persistent = false; },
  };
}
function nextStep(m, o) {
  m.si++; m.st = {}; m.blips = [];
  const s = o.steps[m.si]; if (!s) return;
  STEP[s.t].start(m, s);
}
const spawnFoes = (m, n, x, y, o = {}) => {
  const out = [];
  for (let k = 0; k < n; k++) {
    const w = sidewalkNear(x + rand(-12, 12), y + rand(-12, 12), 3);
    const p = missionPed(m, o.kind || 'gang', w.x, w.y);
    if (!o.kind || o.kind === 'gang') setGang(p, o.gang || 'lotus');
    Object.assign(p, { state: o.idle ? 'idle' : 'chase', weapon: o.weapon ? (Array.isArray(o.weapon) ? pick(o.weapon) : o.weapon) : pick(['smg', 'pistol', 'shotgun']), hp: o.hp || 100, maxHp: o.hp || 100, homeX: x, homeY: y });
    if (o.tag && k === 0) p.nameTag = o.tag;
    out.push(p);
  }
  return out;
};
// 목표 지점이 가게·장소 마커(상점 창이 열리는 곳) 8m 안이면 조금 옮긴다
const clearSpot = p => { if (!p) return p; const pl = Object.values(World.places).filter(Boolean); for (let k = 0; k < 20 && pl.some(q => dist(q.x, q.y, p.x, p.y) < 8); k++) { const a = p.a; p = sidewalkNear(p.x + rand(-14, 14), p.y + rand(-14, 14), 6); if (a !== undefined) p.a = a; } return p; };
const posOf = s => { const p = typeof s.at === 'function' ? s.at() : s.at; return s.t === 'steal' ? p : clearSpot(p); };
const STEP = {
  // 어떤 지점까지 이동 (inCar: 차를 타고, vehicle: 특정 차종)
  go: {
    start(m, s) { m.st.p = posOf(s); m.blips = [{ x: m.st.p.x, y: m.st.p.y, c: '#f2c14e', big: true }]; },
    update(m, s) {
      const P = Game.player, p = m.st.p, d = dist(P.px, P.py, p.x, p.y);
      Missions.obj(m, `${s.text} — ${Math.round(d)}m`);
      if (s.vehicle && !(P.car && (P.car.V.special === s.vehicle || P.car.type === s.vehicle))) return;
      if (d < (s.r || 6) && (!s.inCar || P.car) && (!P.car || P.car.speed < 5 || s.fly)) return 'next';
    },
  },
  // 차 훔치기: 먼 곳에 세워진 차에 탄다
  steal: {
    start(m, s) { const P = Game.player, sp = s.at ? posOf(s) : roadsideSpot(P.px, P.py, 80, 220); const c = m.st.car = missionCar(m, s.type, sp.x, sp.y, sp.a || 0, { color: s.color }); m.car = c; if (s.guards) spawnFoes(m, s.guards, sp.x, sp.y, { idle: true, gang: s.gang }); m.blips = [{ ent: c, c: '#4fb3ff', big: true }]; },
    update(m, s) { const P = Game.player, c = m.st.car; if (c.dead || c.burnT > 0) return { fail: `${c.V.name}이(가) 부서졌다` }; Missions.obj(m, s.text); if (P.car === c) return 'next'; },
  },
  // 타고 있는 미션 차를 어딘가로 (timer 초 안에)
  deliver: {
    start(m, s) { m.st.p = posOf(s); m.blips = [{ x: m.st.p.x, y: m.st.p.y, c: '#f2c14e', big: true }]; if (s.timer) m.timer = s.timer; },
    update(m, s) {
      const P = Game.player, c = m.car, p = m.st.p;
      if (c && (c.dead || c.burnT > 0)) return { fail: '차가 부서졌다' };
      if (c && P.car !== c) { Missions.obj(m, '차로 돌아가라'); m.blips = [{ ent: c, c: '#4fb3ff' }]; return; }
      m.blips = [{ x: p.x, y: p.y, c: '#f2c14e', big: true }];
      if (s.clean && Wanted.stars > 0) { Missions.obj(m, '수배를 떨쳐낸 뒤 가져가라'); return; }
      Missions.obj(m, `${s.text} — ${Math.round(dist(P.px, P.py, p.x, p.y))}m`);
      if (dist(P.px, P.py, p.x, p.y) < (s.r || 8) && (!P.car || P.car.speed < 4)) { m.timer = null; if (s.drop && P.car) { exitCar(P, true); P.car = null; } return 'next'; }
    },
  },
  // 적 처치 (at 근처에 n명, 두목 포함 가능)
  kill: {
    start(m, s) { const p = posOf(s); m.st.p = p; m.st.foes = []; m.st.spawned = false; m.blips = [{ x: p.x, y: p.y, c: '#ff4d4d', big: true }]; },
    update(m, s) {
      const P = Game.player, p = m.st.p;
      if (!m.st.spawned) {
        Missions.obj(m, `${s.text} — ${Math.round(dist(P.px, P.py, p.x, p.y))}m`);
        if (dist(P.px, P.py, p.x, p.y) < 90) { m.st.spawned = true; m.st.foes = spawnFoes(m, s.n, p.x, p.y, { gang: s.gang, weapon: s.weapon, hp: s.hp, tag: s.boss, kind: s.kind }); if (s.boss) Object.assign(m.st.foes[0], { hp: 400, maxHp: 400, weapon: 'rifle' }); UI.toast(s.alert || '적이 몰려온다!'); }
        return;
      }
      const left = m.st.foes.filter(q => !q.dead).length;
      m.blips = m.st.foes.filter(q => !q.dead).slice(0, 6).map(q => ({ ent: q, c: '#ff4d4d' }));
      Missions.obj(m, `${s.text}: 남은 ${left}명`);
      if (!left) return 'next';
    },
  },
  // 일정 시간 버티기 (파도처럼 적이 온다)
  survive: {
    start(m, s) { m.st.t = s.sec; m.st.wave = 0; m.st.foes = []; m.st.p = s.at ? posOf(s) : { x: Game.player.px, y: Game.player.py }; if (s.kind === 'swat' || s.kind === 'cop') Wanted.set(Math.max(3, Wanted.stars)); },
    update(m, s, dt) {
      const P = Game.player; m.st.t -= dt;
      if ((s.kind === 'swat' || s.kind === 'cop') && Wanted.stars < 3) Wanted.set(3);
      if (s.stay && dist(P.px, P.py, m.st.p.x, m.st.p.y) > s.stay) { Missions.obj(m, `구역(${s.stay}m)을 벗어났다 — 돌아가라`); m.blips = [{ x: m.st.p.x, y: m.st.p.y, c: '#f2c14e', big: true }]; m.st.t += dt; return; }
      m.blips = [];
      m.st.foes = m.st.foes.filter(q => !q.dead);
      if (m.st.foes.length < 3 && m.st.t > 4) { const a = rand(0, TAU); m.st.foes.push(...spawnFoes(m, s.per || 4, P.px + Math.cos(a) * 45, P.py + Math.sin(a) * 45, { gang: s.gang, kind: s.kind, weapon: s.weapon })); m.st.wave++; }
      Missions.obj(m, `${s.text}: ${Math.ceil(Math.max(0, m.st.t))}초`);
      if (m.st.t <= 0) { for (const q of m.st.foes) { q.state = 'flee'; q.fleeT = 8; q.fearX = P.px; q.fearY = P.py; } return 'next'; }
    },
  },
  // 도주 차량을 쫓아 부숴라
  chase: {
    start(m, s) {
      const P = Game.player;
      if (s.boat) { // 바다: 섬 둘레의 물길을 따라 도망친다 (스크립트 조종)
        const pts = Races.loopPts({ x: P.px, y: P.py, kind: 'boat' }, 10, 0, 0), a0 = pts[0];
        const c = m.st.car = missionCar(m, s.type, a0.x, a0.y, 0, { color: s.color }); c.driver = 'script'; c.driverKind = 'target'; m.st.pts = pts; m.st.k = 1;
        m.blips = [{ ent: c, c: '#ff4d4d', big: true }]; return;
      }
      const nb = s.near ? s.near() : null, sp = nb ? roadsideSpot(nb.x, nb.y, 10, 120) : (offscreenLaneSpot(50, 110) || roadsideSpot(P.px, P.py, 60, 120)); m.st.t = 0; const c = m.st.car = missionCar(m, s.type, sp.x, sp.y, sp.a, { color: s.color }); c.driver = 'ai'; c.driverKind = 'target'; trafficFromHere(c, 'flee'); c.ai.cruiseFlee = s.speed || 28; m.blips = [{ ent: c, c: '#ff4d4d', big: true }];
    },
    update(m, s) {
      const P = Game.player, c = m.st.car;
      if (!Game.cars.includes(c)) return { fail: '표적을 놓쳤다' };
      const d = dist(P.px, P.py, c.x, c.y);
      Missions.obj(m, `${s.text} — 차량 상태 ${Math.max(0, Math.round(c.hp / c.maxHp * 100))}% · ${Math.round(d)}m`);
      if (m.st.pts && c.driver === 'script' && !c.dead) { const q = m.st.pts[m.st.k % m.st.pts.length]; if (dist(c.x, c.y, q.x, q.y) < 25) m.st.k++; const want = Math.atan2(q.y - c.y, q.x - c.x); c.in.thr = d < 160 ? 1 : 0.4; c.in.brk = 0; c.in.st = clamp(angNorm(want - c.a) * 2, -1, 1); }
      if (c.dead || c.hp < c.maxHp * 0.12 || (c.driver !== 'ai' && c.driver !== 'script')) return 'next';
      m.st.t = (m.st.t || 0) + 1 / 30; if (d < 200) m.st.close = true;
      if (d > 380 && (m.st.close || m.st.t > 30)) return { fail: '표적이 달아났다' };
    },
  },
  // 수배 받기(선택) → 떨쳐내기
  evade: {
    start(m, s) { if (s.stars) Wanted.set(Math.max(Wanted.stars, s.stars)); },
    update(m, s) { Missions.obj(m, s.text + (Wanted.stars ? ` — 수배 ★${Wanted.stars}` : '')); if (Wanted.stars === 0) return 'next'; },
  },
  // 구역 안에서 sec초 버티기 (적 없이, 예: 금고 여는 중)
  hold: {
    start(m, s) { m.st.p = posOf(s); m.st.t = 0; m.blips = [{ x: m.st.p.x, y: m.st.p.y, c: '#f2c14e', big: true }]; if (s.stars) m.st.stars = s.stars; },
    update(m, s, dt) {
      const P = Game.player, d = dist(P.px, P.py, m.st.p.x, m.st.p.y);
      if (d > (s.r || 8)) { Missions.obj(m, `${s.text} 위치로 — ${Math.round(d)}m`); return; }
      if (m.st.stars && !m.st.alarm) { m.st.alarm = true; Wanted.set(Math.max(Wanted.stars, m.st.stars)); UI.toast('경보가 울렸다!'); }
      m.st.t += dt; Missions.obj(m, `${s.text}: ${Math.min(100, Math.round(m.st.t / s.sec * 100))}% — 자리를 지켜라`);
      if (m.st.t >= s.sec) return 'next';
    },
  },
  // 물건 줍기
  pick: {
    start(m, s) { const p = posOf(s); m.st.p = p; m.blips = [{ x: p.x, y: p.y, c: '#4fe38a', big: true }]; },
    update(m, s) { const P = Game.player, d = dist(P.px, P.py, m.st.p.x, m.st.p.y); Missions.obj(m, `${s.text} — ${Math.round(d)}m`); if (d < 3) { Sfx.pickup(); return 'next'; } },
  },
  // 선택 (1 / 2 키 또는 화면 버튼)
  choice: {
    start(m, s) {
      m.st.pick = null;
      const box = document.createElement('div');
      box.id = 'story-choice';
      box.style.cssText = 'position:fixed;left:50%;top:58%;transform:translate(-50%,-50%);z-index:70;display:flex;flex-direction:column;gap:10px;min-width:320px;background:rgba(10,12,18,.92);border:1px solid #f2c14e;border-radius:12px;padding:16px 18px;color:#fff;font-family:inherit';
      box.innerHTML = `<b style="color:#f2c14e;font-size:18px">${s.q}</b>`;
      s.opts.forEach((o, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = `${i + 1}. ${o[1]}`; b.onclick = () => { m.st.pick = o[0]; }; box.append(b); });
      document.body.append(box); m.st.box = box;
    },
    update(m, s) {
      Missions.obj(m, `${s.q} — 1 또는 2를 누르거나 버튼을 고르세요`);
      if (keyHit('Digit1')) m.st.pick = s.opts[0][0]; if (keyHit('Digit2')) m.st.pick = s.opts[1][0];
      if (m.st.pick) { Story.flags[s.flag] = m.st.pick; m.st.box.remove(); Save.write(); return 'next'; }
    },
  },
  // 중간 컷신
  cut: {
    start(m, s) { m.st.go = false; Cutscene.play(typeof s.lines === 'function' ? s.lines() : s.lines, () => { m.st.go = true; }); },
    update(m) { if (m.st.go) return 'next'; },
  },
};

// ---------- 2부 미션 ----------
const CH2 = [
  stepsDef({
    title: '15. 검은 연꽃', reward: 25000,
    intro: [['마담 윤', '네 덕에 이 도시는 조용해졌지. 그런데… 조용한 게 오래가질 않네.'], ['마담 윤', '"블랙 로터스"라는 놈들이 항구에 들어왔어. 우리 물건을 건드렸다고.'], ['마담 윤', '인사 좀 하고 와. 정중하게. 총으로.']],
    outro: [['마담 윤', '로터스… 저놈들 뒤에 누가 있는지 알아봐야겠어.']],
    steps: [
      { t: 'go', at: () => placeOr('wh_harbor', 0.78, 0.55), text: '하버 창고로 가라' },
      { t: 'kill', at: () => placeOr('wh_harbor', 0.78, 0.55), n: 7, text: '블랙 로터스 조직원을 처치하라', alert: '로터스: 누구냐! 쏴!' },
    ],
  }),
  stepsDef({
    title: '16. 형사 한', reward: 30000,
    intro: [['형사 한', '네가 요즘 소문난 녀석이군. 앉아. 체포하려는 거 아니야… 아직은.'], ['형사 한', '경찰청 증거 보관 밴에 너희 윤 누님 사진이 잔뜩 있어. 사라지면 좋겠지?'], ['형사 한', '밴을 훔쳐서 부두 끝 바다에 빠뜨려. 그럼 우린 친구야.']],
    outro: [['형사 한', '깔끔하군. 앞으로 자주 보자고, 친구.']],
    steps: [
      { t: 'steal', type: 'van', color: '#e8e8e8', text: '경찰 증거 보관 밴을 훔쳐라' },
      { t: 'evade', stars: 2, text: '경찰을 따돌려라' },
      { t: 'deliver', at: () => { const m = (World.marinas || [])[0] || at(0.8, 0.6); return sidewalkNear(m.x, m.y); }, text: '밴을 부두로 가져가라', drop: true },
    ],
  }),
  stepsDef({
    title: '17. 공항 화물', reward: 40000,
    intro: [['조니 박', '형님, 공항 화물 창고에 로터스 놈들 가방이 들어왔대요.'], ['조니 박', '안에 뭐가 들었는지는 모르지만, 걔들이 목숨 걸고 지키는 거면 비싼 거겠죠?']],
    outro: [['조니 박', '와… 이거 전부 위조 채권이에요. 누가 이걸 찍어낸 거지?']],
    steps: [
      { t: 'go', at: () => World.airport ? sidewalkNear(World.airport.cx * T, (World.airport.by1 + 4) * T) : at(0.8, 0.2), text: '공항 화물 구역으로', r: 10 },
      { t: 'kill', at: () => World.airport ? sidewalkNear(World.airport.cx * T, (World.airport.by1 + 4) * T) : at(0.8, 0.2), n: 5, text: '화물 경비를 처리하라' },
      { t: 'pick', at: () => World.airport ? sidewalkNear(World.airport.cx * T + 12, (World.airport.by1 + 4) * T) : at(0.8, 0.2), text: '가방을 챙겨라' },
      { t: 'evade', stars: 3, text: '공항 경찰을 따돌려라' },
    ],
  }),
  stepsDef({
    title: '18. 토니의 빚', reward: 35000,
    intro: [['레이서 토니', '로터스가 나한테 돈을 대 줬지. 대신 채권 운반을 시켰고.'], ['마담 윤', '토니가 도망친다! 그 차를 멈춰 세워. 입은 살려 두고.']],
    outro: [['레이서 토니', '말할게, 말한다고! 로터스 두목은… "연"이라는 여자야. 경찰이랑도 손잡았다고!']],
    steps: [{ t: 'chase', type: 'super', color: '#ffd23f', speed: 32, text: '토니의 인페르노를 부숴 멈춰라' }],
  }),
  stepsDef({
    title: '19. 옥상의 약속', reward: 45000,
    intro: [['마담 윤', '연이라는 여자가 우리를 만나자고 했어. 함정일 게 뻔하지.'], ['마담 윤', '약속 장소에서 90초만 버텨. 부하들이 뒤를 칠 거야.']],
    outro: [['마담 윤', '역시 함정이었어. 그리고… 경찰 무전이 들렸지. 한 형사 목소리였어.']],
    steps: [
      { t: 'go', at: () => placeOr('cityhall', 0.5, 0.45), text: '약속 장소(시청 앞 광장)로' },
      { t: 'survive', sec: 90, stay: 40, text: '로터스의 습격을 버텨라', per: 4 },
    ],
  }),
  stepsDef({
    title: '20. 도둑맞은 그림', reward: 50000,
    intro: [['미나', '갤러리에서 제일 비싼 그림이 없어졌어… 로터스 창고에 있다는 제보가 왔대.'], ['미나', '제발 찾아 줘. 경찰은 아무것도 안 해.']],
    outro: [['미나', '고마워, 정말 고마워! (호감도가 크게 올랐다)']],
    steps: [
      { t: 'kill', at: () => placeOr('wh_iron', 0.3, 0.7), n: 6, text: '로터스 창고를 습격하라' },
      { t: 'pick', at: () => placeOr('wh_iron', 0.3, 0.7), text: '그림을 챙겨라' },
      { t: 'go', at: () => placeOr('biz_gallery', 0.5, 0.5), text: '그림을 갤러리로 돌려줘라', r: 8 },
    ],
  }),
  stepsDef({
    title: '21. 연의 금고', reward: 120000,
    intro: [['조니 박', '위조 채권 원판이 연의 은행 금고에 있대요. 원판만 없으면 로터스는 끝이죠.'], ['조니 박', '금고 앞에서 40초만 버티면 열려요. 경보는… 울리겠죠?']],
    outro: [['조니 박', '원판 확보! 이제 로터스는 돈줄이 막혔어요.']],
    steps: [
      { t: 'hold', at: () => placeOr('bank', 0.5, 0.4), sec: 40, r: 9, stars: 3, text: '금고 여는 중' },
      { t: 'evade', text: '원판을 들고 도망쳐라' },
    ],
  }),
  stepsDef({
    title: '22. 배신', reward: 60000,
    intro: [['형사 한', '미안하게 됐어, 친구. 로터스가 나한테 더 많이 줬거든.'], ['형사 한', 'SWAT가 은신처를 포위했다. 윤 누님은 이미 연행됐어.']],
    outro: [['마담 윤', '(무전) 나 풀려났어. 한 형사… 이 빚은 반드시 갚는다.']],
    steps: [
      { t: 'survive', sec: 60, text: 'SWAT의 포위를 뚫고 버텨라', kind: 'swat', per: 3, weapon: 'rifle' },
      { t: 'evade', stars: 4, text: '포위망을 빠져나가라' },
    ],
  }),
  stepsDef({
    title: '23. 바다 위의 추격', reward: 70000,
    intro: [['조니 박', '연이 보트로 채권을 빼돌린대요! 마리나에 보트 준비해 뒀어요.']],
    outro: [['조니 박', '채권 가방 건졌어요! 연은… 헤엄쳐서 도망갔대요.']],
    steps: [
      { t: 'steal', type: 'speedboat', text: '마리나에 준비된 스피드보트에 타라', at: () => { const m = (World.marinas || [])[0]; return m ? { x: m.x + Math.cos(m.a) * 14, y: m.y + Math.sin(m.a) * 14, a: m.a } : at(0.8, 0.6); } },
      { t: 'chase', type: 'speedboat', color: '#111', text: '연의 보트를 부숴라', speed: 22, boat: true },
    ],
  }),
  stepsDef({
    title: '24. 하늘길', reward: 80000,
    intro: [['마담 윤', '연이 공항 전용기로 도망치려 해. 활주로를 막아야 해.'], ['마담 윤', '군 헬기를 하나 빌려 뒀어. 공항까지 날아가.']],
    outro: [['마담 윤', '전용기는 못 떴어. 이제 연은 도시 안에 갇혔어.']],
    steps: [
      { t: 'steal', type: 'milheli', text: '준비된 공격 헬기에 타라', at: () => roadsideSpot(Game.player.px, Game.player.py, 20, 60) },
      { t: 'go', at: () => World.airport ? { x: World.airport.cx * T, y: World.airport.cy * T } : at(0.8, 0.2), text: '공항 활주로로 날아가라', r: 60, fly: true, vehicle: 'heli' },
      { t: 'chase', type: 'sedan', color: '#101010', text: '활주로로 가는 연의 차를 부숴라', speed: 30, near: () => World.airport ? { x: World.airport.cx * T, y: (World.airport.by1 + 20) * T } : null },
    ],
  }),
  stepsDef({
    title: '25. 갈림길', reward: 100000,
    intro: [['형사 한', '(전화) 거래하자. 윤의 장부를 나한테 넘기면, 넌 깨끗해진다. 연도 내가 처리하지.'], ['마담 윤', '(전화) 한을 믿어? 그 인간은 이미 한 번 배신했어. 나와 끝까지 가자.']],
    outro: [],
    steps: [
      { t: 'choice', flag: 'side', q: '누구 편에 설까?', opts: [['yoon', '마담 윤 — 조직과 끝까지 간다'], ['han', '형사 한 — 장부를 넘기고 깨끗해진다']] },
      { t: 'cut', lines: () => Story.flags.side === 'han' ? [['형사 한', '현명한 선택이야. 장부를 경찰청 앞으로 가져와.']] : [['마담 윤', '역시 넌 내 사람이야. 한 형사부터 정리하자.']] },
      { t: 'go', at: () => Story.flags.side === 'han' ? placeOr('police', 0.5, 0.5) : placeOr('police2', 0.4, 0.6), text: '약속 장소로 가라' },
      { t: 'kill', at: () => Story.flags.side === 'han' ? placeOr('police', 0.5, 0.5) : placeOr('police2', 0.4, 0.6), n: 6, text: '끼어든 로터스 저격조를 처리하라' },
    ],
  }),
  stepsDef({
    title: '26. 네온의 왕', reward: 500000,
    intro: [['조니 박', '연이 옛 청룡파 본부에 숨었대요. 이게 마지막이에요, 형님.']],
    outro: [],
    steps: [
      { t: 'go', at: () => placeOr('hq_dragon', 0.3, 0.3), text: '로터스 최후의 은신처로' },
      { t: 'kill', at: () => placeOr('hq_dragon', 0.3, 0.3), n: 9, boss: '연 (블랙 로터스 두목)', text: '로터스와 두목 연을 쓰러뜨려라', hp: 120, weapon: ['rifle', 'smg', 'shotgun'] },
      { t: 'cut', lines: () => Story.flags.side === 'han'
        ? [['형사 한', '연은 끝났고, 장부도 내 손에 있지. 넌 약속대로 깨끗해.'], ['형사 한', '…물론, 앞으로도 내 부탁은 들어줘야겠지만.'], ['나레이션', '마담 윤은 도시를 떠났다. 네온 하버는 경찰과 손잡은 새 질서 아래 조용해졌다.'], ['나레이션', '엔딩 A — 「깨끗한 손」']]
        : [['마담 윤', '끝났어. 한 형사도, 연도. 이제 이 도시는 우리 거야.'], ['마담 윤', '아니… 네 거야. 난 좀 쉬어야겠어.'], ['나레이션', '네온 하버의 밤은 이제 한 사람의 이름으로 불린다.'], ['나레이션', '엔딩 B — 「네온의 왕」']] },
    ],
  }),
];
// 1부 뒤에 붙인다 (의뢰인 위치도 추가)
MISSION_DEFS.push(...CH2);
{
  const oInit = Missions.init.bind(Missions);
  Missions.init = function () {
    oInit();
    const extra = [[0.62, 0.52], [0.46, 0.3], [0.72, 0.4], [0.36, 0.6], [0.52, 0.46], [0.58, 0.68], [0.44, 0.56], [0.3, 0.44], [0.66, 0.6], [0.56, 0.36], [0.4, 0.4], [0.5, 0.5]];
    while (this.givers.length < MISSION_DEFS.length) { const [u, v] = extra[(this.givers.length - 14) % extra.length]; this.givers.push(sidewalkNear(u * MW * T + rand(-20, 20), v * MH * T + rand(-20, 20))); }
    this.defs = MISSION_DEFS;
  };
  // 미션 시작 대사를 컷신으로 (1부 포함 모든 미션)
  const oStart = Missions.start.bind(Missions);
  Missions.start = function (i) {
    const def = this.defs[i];
    if (!def.intro || !def.intro.length) return oStart(i);
    const intro = def.intro;
    Cutscene.play([[def.title, '— 미션 —'], ...intro], () => { oStart(i); UI.dialogQ = UI.dialogQ.filter(d => !intro.some(l => l[1] === d.text)); }); // 컷신으로 본 대사는 자막으로 다시 띄우지 않는다
  };
  // 마지막 미션을 마치면 크레딧
  const oPass = Missions.pass.bind(Missions);
  Missions.pass = function () {
    const last = this.idx === this.defs.length - 1;
    oPass();
    if (last) setTimeout(() => Cutscene.play([['네온 하버', '— 끝 —'], ['만든 사람', '플레이해 주셔서 고맙습니다.'], ['네온 하버', '이제 도시는 너의 것이다. 사업·조직·레이스·연애… 자유롭게 즐기세요.']]), 5000);
  };
}
