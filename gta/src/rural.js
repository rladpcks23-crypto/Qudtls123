'use strict';
/* =====================================================================
 * rural.js — 레드 카운티의 하루 (v2.18)
 *
 *  · 일과 NPC: 시간대에 따라 사람이 모이고 흩어진다
 *      농부 06~18시 밭·농가 · 어부 05~11시·16~19시 부두·호숫가 · 식당 손님 07~09·12~14·18~21시
 *      술집(바비큐·어부의 식당) 20~02시 · 교회 09~11시 · 비행장 정비사 08~17시 · 주유소 점원 종일
 *    일이 시작되면 마을 쪽에서 걸어와 자리를 잡고, 끝나면 마을로 걸어 돌아간다.
 *  · 밀도: 카운티는 도시보다 차·사람이 적고, 밤에는 훨씬 한산하다. 차종도 픽업·밴·트랙터 위주.
 *  · 보안관: 카운티의 경찰차·경찰은 보안관(베이지·갈색)으로 바뀐다.
 *  · 카운티 FM 99.5(컨트리): 다리를 건너면 라디오가 저절로 카운티 FM으로 바뀌고, 돌아오면 원래 방송으로.
 * ===================================================================== */

// 카운티 차량 (v2.18): 픽업트럭 · ATV · 트랙터
Object.assign(VTYPES, {
  pickup: { name: '보디 픽업', L: 5.0, W: 2.0, mass: 1700, Fe: 9500, vmax: 44, grip: 1.12, cs: 4.8, steer: 0.55, hp: 150, colors: ['#8a3b2e', '#2f4f6f', '#d8d0c0', '#3a3a3a', '#6b7a3a', '#b89a5a'], style: 'pickup' },
  atv: { name: '블레이저 ATV', L: 2.1, W: 1.3, mass: 330, Fe: 4300, vmax: 34, grip: 1.4, cs: 6, steer: 0.78, hp: 70, colors: ['#e0262b', '#2f8a3a', '#f2c200', '#1d1d1f'], style: 'atv' },
  tractor: { name: '팜랜드 트랙터', L: 3.6, W: 2.1, mass: 3000, Fe: 9000, vmax: 14, grip: 1.35, cs: 4.6, steer: 0.62, hp: 220, colors: ['#2f8a3a', '#c8201e', '#e0a43a'], style: 'tractor' },
});
if (typeof VEHICLE_PRICES !== 'undefined') Object.assign(VEHICLE_PRICES, { pickup: 8500, atv: 5500, tractor: 16000 });
if (typeof DEALER_STOCK !== 'undefined') DEALER_STOCK.splice(DEALER_STOCK.indexOf('van') + 1, 0, 'pickup', 'atv', 'tractor');

// 산길 오르막·내리막: 경사만큼 차가 밀리거나 빨라진다 (실버 피크 산길)
{
  const _step = Car.prototype.step;
  Car.prototype.step = function (dt) {
    _step.call(this, dt);
    if (this.V.special || this.alt || !World.mtMask) return;
    const h0 = groundZ(this.x, this.y); if (!h0) return;
    const sp = Math.hypot(this.vx, this.vy); if (sp < 0.3) { const h1 = groundZ(this.x + Math.cos(this.a) * 2, this.y + Math.sin(this.a) * 2); if (Math.abs(this.in.thr) < 0.05 && Math.abs(h1 - h0) > 0.3 && !this.in.hb) { const s = (h1 - h0) / 2; this.vx -= Math.cos(this.a) * 9.81 * s * dt * 0.5; this.vy -= Math.sin(this.a) * 9.81 * s * dt * 0.5; } return; }
    const ux = this.vx / sp, uy = this.vy / sp, s = (groundZ(this.x + ux * 2, this.y + uy * 2) - h0) / 2;
    this.vx -= ux * 9.81 * clamp(s, -0.3, 0.3) * dt; this.vy -= uy * 9.81 * clamp(s, -0.3, 0.3) * dt;
  };
}

const inCounty = x => x > CITY_W * T + 40;
const gameHour = () => ((Game.clock / 60) % 24 + 24) % 24;
const inHours = (h, ranges) => ranges.some(([a, b]) => a <= b ? h >= a && h < b : h >= a || h < b);

const ROUTINES = {
  farmer: { hours: [[6, 18]], n: 3, look: { shirt: ['#b5452f', '#4d7ea8', '#c89b3c'], pants: ['#3a4f7a', '#5a4632'], hat: '#d8b36a' }, lines: ['올해 옥수수가 잘 자랐어', '비가 좀 와야 할 텐데', '트랙터가 또 말썽이야'] },
  fisher: { hours: [[5, 11], [16, 19]], n: 2, look: { shirt: ['#e0a43a', '#2f5d7a', '#7a2f2f'], pants: ['#2b3440'], hat: '#e0c040' }, lines: ['오늘은 입질이 없네', '어제 이만한 걸 잡았지', '조용히 해, 고기 도망가'] },
  diner: { hours: [[7, 9], [12, 14], [18, 21]], n: 4, look: {}, lines: ['여기 파이가 최고야', '커피 한 잔 더요', '도시 사람인가 봐?'] },
  bar: { hours: [[20, 2]], n: 5, look: { shirt: ['#6b3a2a', '#2d2d2d', '#4a5a3a', '#8a2a2a'] }, lines: ['한 잔 더!', '보안관 놈이 또 왔더라', '사막에서 이상한 불빛을 봤다니까', '건배!'] },
  church: { hours: [[9, 11]], n: 4, look: { shirt: ['#f2f2f2', '#3a3f55', '#6b5b7b'], pants: ['#1b1b1f'] }, lines: ['좋은 아침이에요', '설교가 길었네'] },
  mechanic: { hours: [[8, 17]], n: 2, look: { shirt: ['#3a4a5a'], pants: ['#3a4a5a'], hat: '#c8201e' }, lines: ['엔진 오일 갈 때 됐어', '비행기 한 대 들어온대'] },
  clerk: { hours: [[0, 24]], n: 1, look: { shirt: ['#d7263d'], pants: ['#1b1b1f'] }, lines: ['어서 오세요', '기름 넣고 가요'] },
};

const Rural = {
  spots: null, t: 0, tagT: 0, wasCounty: false, prevStation: 1,
  build() {
    const W = World, C = W.county || {}, sp = [], home = (x, y) => { let best = null, bd = 1e18; for (const t of C.towns || []) { const d = dist(t.x, t.y, x, y); if (d < bd) { bd = d; best = t; } } return best || { x, y }; };
    const add = (kind, x, y, r = 5) => { const h = home(x, y); sp.push({ kind, x, y, r, hx: h.x, hy: h.y, npcs: [] }); };
    for (const f of C.farms || []) { add('farmer', f.fx, f.fy, 8); }
    for (const f of C.fish || []) add('fisher', f.x, f.y, 2);
    for (const k of ['c_burger1', 'c_burger2', 'c_mart3']) { const q = W.places[k]; if (q) add('diner', q.x, q.y, 4); }
    for (const k of ['c_burger3', 'c_burger2']) { const q = W.places[k]; if (q) add('bar', q.x, q.y, 4); }
    for (const k of FUEL_STATIONS) { const q = W.places[k]; if (q && inCounty(q.x)) add('clerk', q.x, q.y, 2); }
    if (W.places.c_airfield) add('mechanic', W.places.c_airfield.x, W.places.c_airfield.y, 6);
    const ch = W.buildings.find(b => b.county && b.kind === 'church'); if (ch) add('church', (ch.x0 + 1.5) * T, (ch.y1 + 2) * T, 4);
    this.spots = sp;
  },
  // 인구 밀도 배수 (main.populate)
  carMul(f) { if (!inCounty(f.x)) return 1; const h = gameHour(); return h < 5.5 || h >= 22 ? 0.18 : h < 7 || h >= 19 ? 0.32 : 0.45; },
  pedMul(f) { if (!inCounty(f.x)) return 1; const h = gameHour(); return h < 5.5 || h >= 22 ? 0.2 : 0.7; },
  trafficType(f) {
    if (!inCounty(f.x)) return null;
    const day = inHours(gameHour(), [[6, 19]]);
    const l = ['pickup', 'pickup', 'pickup', 'sedan', 'van', 'truck', 'compact', 'muscle', ...(day ? ['tractor', 'atv'] : [])].filter(t => VTYPES[t]);
    return pick(l);
  },
  parkedType(sp) { if (!inCounty(sp.x)) return null; const farm = (World.county.farms || []).some(f => dist(f.x, f.y, sp.x, sp.y) < 60); return pick(farm ? ['tractor', 'pickup', 'atv'] : ['pickup', 'pickup', 'atv', 'sedan', 'compact', 'van']); },
  tag(c) { if (c._rt) return; c._rt = 1; if ((c.type === 'police' || c.type === 'swat') && inCounty(c.x)) { c.sheriff = true; c.color = '#e8dfc8'; c.label = '카운티 보안관'; } },
  // 야생동물: 숲·산기슭엔 사슴, 사막엔 코요테(주로 밤), 농장 근처엔 소
  wildlife(P) {
    const near = Game.peds.filter(p => p.kind === 'animal' && !p.dead && dist(p.x, p.y, P.px, P.py) < 220).length, h = gameHour(), night = h < 6 || h >= 20;
    if (near >= (night ? 3 : 5)) return;
    const a = rand(0, TAU), r = rand(90, 170), x = P.px + Math.cos(a) * r, y = P.py + Math.sin(a) * r, t = tileAt(x, y);
    if ((t !== TL.GRASS && t !== TL.SAND) || onScreen(x, y, 6) || !inCounty(x)) return;
    const hood = hoodAt(x, y), farm = (World.county.farms || []).find(f => dist(f.fx, f.fy, x, y) < 70);
    const sp = farm && !night ? 'cow' : (hood === '블랙우드 숲' || hood === '실버 피크' || hood === '블랙 리지') ? 'deer' : t === TL.SAND ? (night || chance(0.3) ? 'coyote' : null) : chance(0.35) ? 'deer' : null;
    if (!sp) return;
    const n = sp === 'cow' ? randi(2, 4) : sp === 'deer' ? randi(1, 3) : randi(1, 2);
    for (let k = 0; k < n; k++) spawnAnimal(sp, x + rand(-4, 4), y + rand(-4, 4));
  },
  update(dt) {
    const P = Game.player; if (!P || !World.county) return;
    if (!this.spots) { this.build(); if (typeof placeHank === 'function') placeHank(); }
    // 보안관: 카운티에서 생긴 경찰차·경찰 (매 프레임 새로 생긴 것만)
    for (const c of Game.cars) if (!c._rt) this.tag(c);
    this.tagT -= dt;
    if (this.tagT <= 0) { this.tagT = 1; for (const p of Game.peds) if (p.kind === 'cop' && !p._rt) { p._rt = 1; if (inCounty(p.x)) { p.sheriff = true; p.shirt = '#b8955a'; p.pants = '#5a4632'; p.hat = '#6b4e2a'; p.nameTag = p.nameTag || null; } } }
    // 카운티 FM
    const cty = inCounty(P.px);
    if (cty !== this.wasCounty) {
      this.wasCounty = cty;
      const ci = Radio.stations.findIndex(s => s.kind === 'country');
      if (ci > 0 && P.car && Radio.station > 0) {
        if (cty && Radio.station !== ci) { this.prevStation = Radio.station; Radio.station = ci; Radio.step = 0; UI.showStation(Radio.stations[ci]); }
        else if (!cty && Radio.station === ci) { Radio.station = this.prevStation > 0 && this.prevStation !== ci ? this.prevStation : 1; Radio.step = 0; UI.showStation(Radio.stations[Radio.station]); }
      }
    }
    // 일과 NPC (0.5초마다)
    this.t -= dt; if (this.t > 0) return; this.t = 0.5;
    if (cty && chance(0.25)) this.wildlife(P);
    const h = gameHour();
    for (const s of this.spots) {
      s.npcs = s.npcs.filter(p => Game.peds.includes(p) && !p.dead);
      const d = dist(s.x, s.y, P.px, P.py), R = ROUTINES[s.kind];
      if (d > 300) { for (const p of s.npcs) { p.persistent = false; p.routine = null; } s.npcs = []; continue; }
      const want = inHours(h, R.hours) ? R.n : 0;
      if (s.npcs.length > want) { // 일 끝: 마을로 걸어 돌아간다
        for (const p of s.npcs.splice(want)) { p.persistent = false; p.homeX = s.hx + rand(-20, 20); p.homeY = s.hy + rand(-20, 20); p.routine = null; }
      } else if (s.npcs.length < want && d < 230) {
        // 일 시작: 마을 쪽 40~70m에서 걸어오게 (화면 밖), 안 되면 제자리(화면 밖일 때만)
        const a = Math.atan2(s.hy - s.y, s.hx - s.x), r = rand(40, 70);
        let x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
        if (solidT(Math.floor(x / T), Math.floor(y / T)) || onScreen(x, y, 4)) { x = s.x + rand(-s.r, s.r); y = s.y + rand(-s.r, s.r); if (onScreen(x, y, 4) || solidT(Math.floor(x / T), Math.floor(y / T))) continue; }
        const p = spawnPed('civ', x, y);
        Object.assign(p, { persistent: true, state: 'idle', homeX: s.x + rand(-s.r, s.r), homeY: s.y + rand(-s.r, s.r), routine: s.kind });
        const L = R.look; if (L.shirt) p.shirt = pick(L.shirt); if (L.pants) p.pants = pick(L.pants); if (L.hat) p.hat = L.hat;
        s.npcs.push(p);
      }
      // 가까이 가면 한마디
      if (d < 14 && s.npcs.length && chance(0.08)) Talk.say(pick(s.npcs), pick(R.lines), 2.6);
    }
  },
};

// 카운티 FM 99.5 — 컨트리 (붐칙 베이스 · 브러시 스네어 · 밴조 아르페지오 · 피들 멜로디)
Radio.stations.push({ name: '카운티 FM 99.5', sub: '컨트리', bpm: 116, prog: [[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]], kind: 'country' });
{
  const _up = Radio.update.bind(Radio);
  Radio.update = function () {
    const st = this.stations[this.station];
    if (!st || st.kind !== 'country') return _up();
    // 공통 부분(볼륨·켜짐)은 원래 함수가 처리하게 두되, 음 스케줄만 여기서 한다
    const c = Sfx.ctx; if (!c) return;
    const car = Game.player && Game.player.car;
    const on = car && !Sfx.muted && Game.state === 'play' && !car.dead;
    if (car !== this.lastCar) { this.lastCar = car; if (car) UI.showStation(st); }
    Sfx.musicBus.gain.setTargetAtTime(on ? 0.9 * (Settings.radioVol ?? 1) : 0, c.currentTime, 0.08);
    if (!on) { this.nextTime = c.currentTime + 0.05; return; }
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.02;
    const spb = 60 / st.bpm / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      const t = this.nextTime, s = this.step % 64, bar = Math.floor(s / 16) % 4, b = s % 16, ch = st.prog[bar], m = this.mel(st, bar)[b];
      if (b === 0 || b === 8) { this.drum(t, 'k', 0.8); this.play(t, this.note(ch[0]), spb * 2.5, 'triangle', 0.22, 1200); }   // 붐 (근음)
      if (b === 4 || b === 12) { this.drum(t, 's', 0.55); this.play(t, this.note(ch[2] - 12), spb * 2.5, 'triangle', 0.18, 1200); } // 칙 (5음) + 브러시
      if (b % 2 === 1) this.drum(t, 'h', 0.35);
      this.play(t, this.note(ch[b % 3] + 24), spb * 0.7, 'square', 0.035, 5200);                       // 밴조 롤
      if (m && b % 2 === 0) this.play(t, this.note(m + 12), spb * 2.2, 'sawtooth', 0.07, 2600);          // 피들
      this.nextTime += spb; this.step++;
    }
  };
}
