'use strict';
/* =====================================================================
 * main.js — 게임 루프, 인구 관리, 플레이어 조작, 카메라, 사망/체포
 *
 * 인구 관리(Population management): GTA 시리즈처럼 도시 전체를 시뮬레이션하지 않고
 * 카메라 주변의 '고리(ring)' 영역에서만 차량·보행자를 생성하고, 멀어지면 제거한다.
 * 화면 안에서는 절대 생성/제거하지 않으므로 세계가 연속적으로 느껴진다.
 * ===================================================================== */

const Game = {
  state: 'menu', time: 0, clock: 17 * 60, cars: [], peds: [], pickups: [], projectiles: [],
  player: null, weather: { rain: false, intensity: 0, wet: 1, nextT: 90 }, wind: 0.6,
  packages: new Set(), packageTotal: 10, deathT: 0, popT: 0, lastDistrict: -1, districtHold: 0,
  sprayCool: 0, shopCool: 0, attract: null, attractT: 0, lastMouseMove: 0,

  init() {
    canvas = document.getElementById('game'); ctx = canvas.getContext('2d');
    lightCanvas = document.createElement('canvas'); lctx = lightCanvas.getContext('2d');
    resize(); addEventListener('resize', resize);
    genWorld(90210);
    Missions.init();
    const g = Missions.givers[0];
    this.player = new PlayerPed(g.x + 3, g.y);
    this.player.hidden = true;
    Cam.x = g.x; Cam.y = g.y;
    document.body.classList.add(IS_MOBILE ? 'mobile' : 'pc');
    if (IS_MOBILE) { Input.usingTouch = true; document.body.classList.add('touch'); }
    Menu.init(); Touch.init();
    this.bindMouse();
    this.populate(true);
    requestAnimationFrame(t => this.loop(t));
  },
  bindMouse() {
    canvas.addEventListener('mousemove', e => { Input.mouse.x = e.clientX; Input.mouse.y = e.clientY; Input.mouse.moved = true; this.lastMouseMove = this.time; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { Input.mouse.down = true; Input.mouse.clicked = true; } Sfx.init(); });
    addEventListener('mouseup', e => { if (e.button === 0) Input.mouse.down = false; });
    canvas.addEventListener('wheel', e => { Input.wheel += sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  newGame(cont) {
    const sv = cont ? Save.read() : null;
    if (!cont) Save.clear();
    // 세계 초기화
    this.cars = []; this.peds = []; this.pickups = []; this.projectiles = [];
    Particles.list = []; Decals.skids = []; Decals.blood_ = []; Decals.scorch_ = [];
    Wanted.reset(); Police.reset(); Jay.reset(); Missions.active = null;
    Missions.idx = sv ? sv.idx : 0;
    this.packages = new Set(sv ? sv.packages : []);
    const g = Missions.done ? Missions.givers[0] : Missions.givers[Missions.idx];
    const P = this.player = new PlayerPed(g.x + 3, g.y);
    P.money = sv ? sv.money : 200; P.displayMoney = P.money;
    if (sv) { for (const k in sv.inv) P.inv[k] = sv.inv[k] === -1 ? Infinity : sv.inv[k]; this.clock = sv.time || this.clock; }
    else { P.inv.pistol = 24; P.weapon = 'fist'; }
    placeStaticPickups();
    Cam.x = P.x; Cam.y = P.y;
    this.populate(true);
    // 시작 차량 하나
    const sp = roadsideSpot(P.x, P.y, 10, 40);
    const c = new Car('sedan', sp.x, sp.y, sp.a); this.cars.push(c);
    Menu.hide();
    this.state = 'play';
    if (IS_MOBILE) mobileEnter();
    if (!sv) {
      UI.big('네온 하버', '1998년, 항구 도시의 밤', 3.5, '#ff5d8f');
      UI.dialog(IS_MOBILE
        ? [['도움말', '왼쪽 화면을 끌어 이동하고, 발사 버튼은 가까운 적을 자동 조준한다. 탑승 버튼으로 차에 탄다.'], ['도움말', '노란 M 마커로 가면 첫 의뢰를 받을 수 있다. 지도 버튼으로 위치를 확인하자.']]
        : [['도움말', 'WASD로 이동, 마우스로 조준·사격, F로 차량 탑승. 노란 M 마커에서 첫 의뢰를 받을 수 있다.'], ['도움말', 'M: 지도 · R: 라디오 · Q/E: 무기 교체 · Esc: 일시정지 · 게임패드도 지원한다']]);
    } else UI.toast('저장된 진행 상황을 불러왔다');
  },
  toMenu() { this.state = 'menu'; Menu.show(); this.player.hidden = true; Wanted.reset(); Police.reset(); Missions.active = null; },
  pause() { if (this.state !== 'play') return; this.state = 'paused'; Menu.showPause(); },
  resume() { Menu.hidePause(); this.state = 'play'; },

  focus() {
    if (this.state === 'menu' && this.attract && this.cars.includes(this.attract)) return { x: this.attract.x, y: this.attract.y };
    return { x: this.player.px, y: this.player.py };
  },

  loop(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    try { this.frame(dt); } catch (e) { console.error(e); }
    endFrameInput();
    requestAnimationFrame(t => this.loop(t));
  },
  frame(dt) {
    Pad.poll();
    const st = this.state;
    if (st !== this._lastSt) { this._lastSt = st; document.body.classList.toggle('playing', st !== 'menu'); }
    const drv = st !== 'menu' && !!(this.player && this.player.car);
    if (drv !== this._lastDrv) {
      this._lastDrv = drv; document.body.classList.toggle('driving', drv);
      Input.touch.on = false; Input.touch.jx = Input.touch.jy = 0; Input.touch.stickId = null; Drive.reset();
      const b = document.getElementById('t-enter'); if (b) b.textContent = drv ? '하차' : '탑승';
    }
    Drive.update(dt);
    if (st === 'play') {
      if (keyHit('Escape', 'KeyP', 'PadStart')) { this.pause(); }
      else if (keyHit('KeyM', 'Tab', 'PadBack')) { this.state = 'map'; }
      else this.update(dt);
    } else if (st === 'map') {
      if (keyHit('Escape', 'KeyM', 'Tab', 'PadBack', 'PadB', 'PadStart') || Input.mouse.clicked) this.state = 'play';
    } else if (st === 'paused') {
      if (keyHit('Escape', 'KeyP', 'PadStart', 'PadB')) this.resume();
    } else if (st === 'menu') {
      this.updateAttract(dt);
      if (keyHit('PadA', 'PadStart')) { Sfx.init(); this.newGame(!!Save.read()); }
    } else if (st === 'wasted' || st === 'busted') {
      this.deathT += dt;
      this.update(dt, true);
      if (this.deathT > 4.2) this.respawn(st);
    } else if (st === 'shop') {
      if (keyHit('Escape', 'PadB')) Shop.close();
    }
    try { Sfx.update(dt); } catch (e) { /* 오디오 오류는 게임을 멈추지 않게 */ }
    UI.update(st === 'play' || st === 'wasted' || st === 'busted' ? dt : 0);
    renderScene();
    if (st === 'play' || st === 'wasted' || st === 'busted' || st === 'shop' || st === 'paused') drawHUD(dt);
    if (st === 'wasted' || st === 'busted') drawDeathScreen(st, this.deathT);
    if (st === 'map') drawFullMap();
  },

  // 메뉴 배경: 교통 차량 하나를 따라가는 카메라
  updateAttract(dt) {
    this.attractT -= dt;
    if (!this.attract || !this.cars.includes(this.attract) || this.attract.dead || this.attractT <= 0) {
      const cands = this.cars.filter(c => c.driver === 'ai' && c.ai && c.ai.mode === 'traffic');
      this.attract = cands.length ? pick(cands) : null; this.attractT = 25;
      if (this.attract) { Cam.x = this.attract.x; Cam.y = this.attract.y; }
    }
    this.time += dt; this.clock = (this.clock + dt) % 1440;
    this.simulate(dt, true);
    const f = this.focus();
    Cam.x = smooth(Cam.x, f.x, 3, dt); Cam.y = smooth(Cam.y, f.y, 3, dt);
    Cam.ppm = smooth(Cam.ppm, Math.min(CW, CH) / 70, 2, dt); Cam.vw = CW / Cam.ppm; Cam.vh = CH / Cam.ppm; Cam.sx = Cam.sy = 0;
  },

  update(dt, dead = false) {
    const P = this.player;
    this.time += dt; this.clock = (this.clock + dt) % 1440;
    // 입력
    if (!dead) {
      if (keyHit('KeyF', 'Enter', 'PadY')) { if (P.car) exitCar(P); else tryEnterCar(P); }
      if (keyHit('KeyE') || Input.wheel > 0 || (!P.car && keyHit('PadRB', 'PadRight'))) cycleWeapon(P, 1);
      if (keyHit('KeyQ') || Input.wheel < 0 || (!P.car && keyHit('PadLB', 'PadLeft'))) cycleWeapon(P, -1);
      for (let i = 1; i <= 8; i++) if (keyHit('Digit' + i)) { const w = WEAPON_ORDER[i - 1]; if (P.inv[w] > 0) { P.weapon = w; UI.weaponFlash = 1; } }
      if (keyHit('KeyR', 'PadDown') && P.car) { Radio.cycle(); }
      if (keyHit('KeyZ', 'PadUp')) Cam.zoomMul = Cam.zoomMul === 1 ? 1.45 : Cam.zoomMul === 1.45 ? 0.8 : 1;
      if (P.car && P.car.type === 'police' && keyHit('KeyG', 'PadLeft')) { P.car.siren = !P.car.siren; }
      if (P.car) updatePlayerInCar(P, dt); else updatePlayerFoot(P, dt);
    }
    this.simulate(dt, false);
    Nav.update(dt);
    Police.update(dt);
    Jay.update(dt);
    Missions.update(dt);
    updatePickups(dt);
    this.places(dt);
    // 사망
    if (P.hp <= 0 && this.state === 'play') this.wasted();
    // 카메라
    this.updateCamera(dt);
    // 지역 이름
    const d = districtAt(P.px, P.py);
    if (d !== this.lastDistrict) { this.districtHold += dt; if (this.districtHold > 0.6) { this.lastDistrict = d; this.districtHold = 0; UI.district(DIST_NAMES[d]); } }
    else this.districtHold = 0;
  },

  simulate(dt, menu) {
    // 날씨
    const W = this.weather;
    W.nextT -= dt;
    if (W.nextT <= 0) { W.rain = !W.rain; W.nextT = W.rain ? rand(60, 130) : rand(150, 320); }
    W.intensity = smooth(W.intensity, W.rain ? 1 : 0, 0.3, dt);
    W.wet = 1 - 0.22 * W.intensity;
    this.wind = Math.sin(this.time * 0.05) * 0.8;
    // 차량
    for (const c of this.cars) c.update(dt);
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) collideCarPair(cs[i], cs[j]);
    // 보행자
    for (const p of this.peds) updatePed(p, dt);
    const P = this.player;
    for (const c of cs) {
      if (c.speed < 0.2 && Math.abs(c.w) < 0.1) { for (const p of this.peds) if (!p.dead) pedCarCollide(p, c); if (!P.car && !menu && !P.dead) pedCarCollide(P, c); continue; }
      for (const p of this.peds) pedCarCollide(p, c);
      if (!P.car && !menu && !P.dead) pedCarCollide(P, c);
    }
    updateProjectiles(dt);
    Particles.update(dt);
    Effects.update(dt);
    // 제거
    this.peds = this.peds.filter(p => !p.remove);
    this.cars = this.cars.filter(c => !c.remove);
    this.popT -= dt;
    if (this.popT <= 0) { this.popT = 0.4; this.populate(false); }
  },

  // ---------- 인구 관리 ----------
  populate(initial) {
    const f = this.focus();
    const viewR = Math.hypot(Cam.vw, Cam.vh) / 2;
    const inner = initial ? 0 : viewR + 4, outer = viewR + 70, kill = viewR + 110;
    const hour = this.clock / 60, night = hour < 5.5 || hour > 22;
    const P = this.player;
    // 제거
    for (const c of this.cars) {
      if (c === P.car || c.persistent || c === this.attract) continue;
      const d = dist(c.x, c.y, f.x, f.y);
      if (d > kill || (c.dead && c.wreckT > 60 && !onScreen(c.x, c.y, 5))) c.remove = true;
      if (c.remove) for (const sp of World.parking) if (sp.car === c) { sp.car = null; sp.cd = 20; }
    }
    for (const p of this.peds) {
      if (p.persistent) continue;
      const d = dist(p.x, p.y, f.x, f.y);
      if (d > kill || (p.dead && p.deadT > 40 && !onScreen(p.x, p.y, 3))) p.remove = true;
    }
    this.cars = this.cars.filter(c => !c.remove); this.peds = this.peds.filter(p => !p.remove);
    // 주차된 차량 상태 갱신
    for (const sp of World.parking) { sp.cd -= 0.4; if (sp.car && (dist(sp.car.x, sp.car.y, sp.x, sp.y) > 3 || !this.cars.includes(sp.car))) { sp.car = null; sp.cd = 30; } }
    // 교통 생성
    const wantCars = night ? TUNE.cars[1] : TUNE.cars[0];
    let traffic = 0;
    for (const c of this.cars) if (c.driver === 'ai' && dist(c.x, c.y, f.x, f.y) < kill) traffic++;
    let tries = initial ? 60 : 3;
    while (traffic < wantCars && tries-- > 0) {
      const spot = spawnLaneSpot(f, inner, outer, initial);
      if (!spot) continue;
      const cop = chance(0.07);
      const type = cop ? 'police' : pick(TRAFFIC_MIX);
      const c = new Car(type, spot.x, spot.y, spot.a);
      c.driver = 'ai'; c.driverKind = cop ? 'cop' : 'civ'; if (cop) c.crew = 2;
      c.ai = { mode: 'traffic', route: [], from: spot.A.id, to: spot.B.id, dir: spot.d, cruise: rand(10.5, 14.5), stuckT: 0, waitT: 0, revT: 0, ignoreT: 0, honkT: 0 };
      pushLane(c.ai.route, spot.A, spot.B, spot.d, dist(spot.A.x, spot.A.y, spot.x, spot.y) + 6, 99);
      c.vx = Math.cos(spot.a) * 9; c.vy = Math.sin(spot.a) * 9;
      this.cars.push(c); traffic++;
    }
    // 주차 차량
    for (const sp of World.parking) {
      if (sp.car || sp.cd > 0) continue;
      const d = dist(sp.x, sp.y, f.x, f.y);
      if (d < inner || d > outer || (!initial && onScreen(sp.x, sp.y, 4))) continue;
      sp.cd = 60;
      if (!chance(0.55)) continue;
      const c = new Car(pick(['sedan', 'compact', 'sports', 'muscle', 'van', 'sedan', 'compact']), sp.x, sp.y, sp.a + (chance(0.5) ? Math.PI : 0));
      this.cars.push(c); sp.car = c;
    }
    // 보행자
    const wantPeds = night ? TUNE.peds[1] : TUNE.peds[0];
    let peds = 0;
    for (const p of this.peds) if (!p.dead && dist(p.x, p.y, f.x, f.y) < kill) peds++;
    tries = initial ? 120 : 6;
    while (peds < wantPeds && tries-- > 0) {
      const b = pick(World.blocks);
      const L = b.loop, s = rand(0, L.P), [x, y] = loopPoint(L, s);
      const d = dist(x, y, f.x, f.y);
      if (d < inner || d > outer || (!initial && onScreen(x, y, 3))) continue;
      const dist_ = b.district;
      if (dist_ === DIST.HARBOR && chance(0.35)) {
        const n = randi(2, 3);
        for (let i = 0; i < n; i++) { const g = spawnPed('gang', x + rand(-1.5, 1.5), y + rand(-1.5, 1.5)); g.homeX = g.x; g.homeY = g.y; peds++; }
        continue;
      }
      const p = spawnPed(chance(0.06) ? 'cop' : 'civ', x, y);
      p.block = b; p.s = s; p.state = 'walk'; p.seg = -1;
      if (dist_ === DIST.BEACH && chance(0.5)) { p.shirt = pick(['#ff8fab', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de']); p.pants = pick(['#f4a261', '#2a9d8f', '#e9c46a']); }
      if (dist_ === DIST.DOWNTOWN && chance(0.5)) { p.shirt = pick(['#2b2d42', '#3d405b', '#1b263b', '#6c757d']); p.pants = '#1b1b1f'; }
      peds++;
    }
  },

  updateCamera(dt) {
    const P = this.player;
    let tx = P.px, ty = P.py;
    const car = P.car;
    if (car) { tx += clamp(car.vx * 0.55, -22, 22); ty += clamp(car.vy * 0.55, -22, 22); }
    else if (!Input.usingTouch && !Pad.active && this.time - this.lastMouseMove < 3 && WEAPONS[P.weapon] && !WEAPONS[P.weapon].melee) {
      const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y);
      tx += clamp((wx - P.x) * 0.2, -6, 6); ty += clamp((wy - P.y) * 0.2, -6, 6);
    }
    Cam.x = smooth(Cam.x, tx, car ? 4 : 5, dt); Cam.y = smooth(Cam.y, ty, car ? 4 : 5, dt);
    const span = (car ? 56 + car.speed * 1.05 : 38) * Cam.zoomMul;
    Cam.ppm = smooth(Cam.ppm, Math.min(CW, CH) / Math.min(130, span), 1.6, dt);
    Cam.vw = CW / Cam.ppm; Cam.vh = CH / Cam.ppm;
    Cam.shake = Math.max(0, Cam.shake - dt * 1.6);
    Cam.sx = (Math.random() - 0.5) * Cam.shake * 14; Cam.sy = (Math.random() - 0.5) * Cam.shake * 14;
  },

  places(dt) {
    const P = this.player;
    this.sprayCool -= dt; this.shopCool -= dt;
    // 페인트샵
    for (const key of ['spray', 'spray2']) {
      const S = World.places[key]; if (!S || !P.car || this.sprayCool > 0) continue;
      if (dist(P.car.x, P.car.y, S.x, S.y) < 5 && P.car.speed < 5) {
        this.sprayCool = 12;
        if (P.money < 100) { UI.toast('페인트샵: $100이 필요하다'); continue; }
        if (Wanted.stars > 0 && Wanted.seen) { UI.toast('경찰이 보고 있다! 따돌린 뒤 다시 오자'); this.sprayCool = 3; continue; }
        P.money -= 100; P.car.hp = P.car.maxHp; P.car.burnT = 0;
        P.car.color = pick(['#e0262b', '#3c6fb0', '#f2c200', '#1d1d1f', '#e8e8ea', '#4e7a52', '#7a3b8f', '#f07c1b']);
        const had = Wanted.stars > 0;
        Wanted.clear(); Sfx.cash();
        UI.toast(had ? '새 도색 완료! 수배가 해제됐다 (-$100)' : '수리 및 도색 완료 (-$100)');
      }
    }
    // 총포상
    const A = World.places.ammu;
    if (A && !P.car && this.shopCool <= 0 && dist(P.x, P.y, A.x, A.y) < 1.8) { Shop.open(); }
  },

  wasted() {
    const P = this.player;
    P.dead = true; this.state = 'wasted'; this.deathT = 0;
    if (P.car) { const c = P.car; c.driver = null; P.car = null; P.x = c.x; P.y = c.y; }
    if (Missions.active) Missions.fail('사망');
    Sfx.failed();
  },
  busted() {
    if (this.state !== 'play') return;
    const P = this.player;
    this.state = 'busted'; this.deathT = 0;
    if (P.car) { const c = P.car; exitCar(P, true); c.driver = null; }
    if (Missions.active) Missions.fail('체포됨');
    Sfx.failed();
  },
  respawn(kind) {
    const P = this.player;
    let spot;
    if (kind === 'wasted') {
      const hs = [World.places.hospital, World.places.clinic].filter(Boolean);
      spot = hs.sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y))[0];
      P.money = Math.max(0, P.money - 100);
    } else {
      spot = World.places.police;
      P.money = Math.max(0, P.money - Math.min(P.money, 100 + Wanted.stars * 150));
      P.inv = { fist: Infinity }; P.weapon = 'fist';
    }
    const np = new PlayerPed(spot.x, spot.y);
    Object.assign(np, { money: P.money, displayMoney: P.money, inv: P.inv, weapon: P.weapon in P.inv ? P.weapon : 'fist' });
    if (kind === 'wasted') np.inv = P.inv;
    this.player = np;
    Wanted.reset(); Police.reset(); Jay.reset();
    for (const p of this.peds) if ((p.kind === 'cop' || p.kind === 'swat' || p.kind === 'gang') && p.state === 'chase') p.state = p.kind === 'gang' ? 'idle' : 'patrol';
    for (const c of this.cars) if (c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'block')) { c.remove = true; }
    this.cars = this.cars.filter(c => !c.remove);
    Cam.x = np.x; Cam.y = np.y;
    this.state = 'play';
    UI.district(kind === 'wasted' ? '병원 앞' : '경찰서 앞');
    Save.write();
  },
};

function screenToWorld(sx, sy) { return [(sx - CW / 2 - Cam.sx) / Cam.ppm + Cam.x, (sy - CH / 2 - Cam.sy) / Cam.ppm + Cam.y]; }

function spawnLaneSpot(f, inner, outer, initial) {
  for (let k = 0; k < 6; k++) {
    const e = pick(World.edgesList), A = World.nodes[e[0]], B = World.nodes[e[1]];
    const t = rand(0.15, 0.85), x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t);
    const d = dist(x, y, f.x, f.y);
    if (d < inner || d > outer || (!initial && onScreen(x, y, 8))) continue;
    const L = dist(A.x, A.y, B.x, B.y), fwd = chance(0.5);
    const sp = laneSpot(e, fwd, fwd ? t * L : (1 - t) * L);
    let free = true; for (const c of Game.cars) if (dist2(c.x, c.y, sp.x, sp.y) < 100) { free = false; break; }
    if (free) return sp;
  }
  return null;
}

// ---------- 플레이어: 도보 ----------
function nearestThreat(P, maxD, cone) {
  let best = null, bs = 1e9;
  const facing = P.a;
  for (const p of Game.peds) {
    if (p.dead || p.car) continue;
    const d = dist(p.x, p.y, P.px, P.py); if (d > maxD) continue;
    const hostile = p.state === 'chase' || p.kind === 'target' || p.kind === 'guard' || (p.kind === 'gang' && Missions.active && p.mission === Missions.active);
    const da = Math.abs(angNorm(Math.atan2(p.y - P.py, p.x - P.px) - facing));
    if (!hostile && da > cone) continue;
    if (!losClear(P.px, P.py, p.x, p.y)) continue;
    const score = d * (hostile ? 0.4 : 1) + da * 6;
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}
function updatePlayerFoot(P, dt) {
  let mx = 0, my = 0;
  if (keyDown('KeyW', 'ArrowUp')) my -= 1; if (keyDown('KeyS', 'ArrowDown')) my += 1;
  if (keyDown('KeyA', 'ArrowLeft')) mx -= 1; if (keyDown('KeyD', 'ArrowRight')) mx += 1;
  let mag = Math.hypot(mx, my);
  if (Pad.active && (Pad.lx || Pad.ly)) { mx = Pad.lx; my = Pad.ly; mag = Math.hypot(mx, my); }
  if (Input.touch.on) { mx = Input.touch.jx; my = Input.touch.jy; mag = Math.hypot(mx, my); }
  if (mag > 1) { mx /= mag; my /= mag; mag = 1; }
  const sprint = keyDown('ShiftLeft', 'ShiftRight', 'PadA') || (Input.touch.on && mag > 0.92);
  const speed = P.downT > 0 ? 0 : sprint ? 7.2 : 4.4;
  P.cd -= dt; P.hitFlash -= dt; P.flash -= dt;
  if (P.downT > 0) { P.downT -= dt; P.vx *= Math.exp(-3 * dt); P.vy *= Math.exp(-3 * dt); }
  else { P.vx = smooth(P.vx, mx * speed, 14, dt); P.vy = smooth(P.vy, my * speed, 14, dt); }
  // 조준
  const W = WEAPONS[P.weapon];
  const firing = Input.mouse.down || Input.touch.fire || keyDown('ControlLeft', 'KeyJ') || (Pad.active && Pad.rt > 0.4);
  if (Pad.active) {
    if (Pad.rx || Pad.ry) P.aim = Math.atan2(Pad.ry, Pad.rx);
    else if (mag > 0.1) P.aim = Math.atan2(my, mx);
    if (firing && !(Pad.rx || Pad.ry)) { const t = nearestThreat(P, W.melee ? 3 : Math.min(W.range || 20, 28), 0.9); if (t) P.aim = Math.atan2(t.y - P.y, t.x - P.x); }
  } else if (!Input.usingTouch) {
    const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y);
    if (!W.melee || firing || Game.time - Game.lastMouseMove < 1.5) P.aim = Math.atan2(wy - P.y, wx - P.x);
    else if (mag > 0.1) P.aim = Math.atan2(my, mx);
  } else {
    if (mag > 0.1) P.aim = Math.atan2(my, mx);
    if (firing) { const t = nearestThreat(P, W.melee ? 3 : Math.min(W.range || 20, 28), 0.9); if (t) P.aim = Math.atan2(t.y - P.y, t.x - P.x); }
  }
  if (!W.melee || firing) P.a = P.aim; else if (mag > 0.1) P.a = Math.atan2(P.vy, P.vx);
  if (firing && P.cd <= 0 && P.downT <= 0) {
    if (!W.melee && !(P.inv[P.weapon] > 0)) { cycleWeapon(P, 1); }
    else {
      P.cd = W.rate;
      if (!W.melee) { P.inv[P.weapon]--; if (P.inv[P.weapon] <= 0) { delete P.inv[P.weapon]; setTimeout(() => { if (!(P.inv[P.weapon] > 0)) P.weapon = 'fist'; }, 200); } }
      fireWeapon(P, P.weapon, P.aim);
      if (!W.melee) { P.vx -= Math.cos(P.aim) * 0.4; P.vy -= Math.sin(P.aim) * 0.4; }
    }
  }
  P.x += P.vx * dt; P.y += P.vy * dt;
  const sp = Math.hypot(P.vx, P.vy); P.moving = sp; P.anim += sp * dt * 2.4;
  for (const q of Game.peds) {
    if (q.dead || q.car) continue;
    const dx = P.x - q.x, dy = P.y - q.y, d2 = dx * dx + dy * dy;
    if (d2 < 0.5 && d2 > 1e-6) { const d = Math.sqrt(d2), push = (0.72 - d) * 0.5; P.x += dx / d * push; P.y += dy / d * push; q.x -= dx / d * push; q.y -= dy / d * push; if (sprint && q.kind === 'civ' && chance(0.02)) q.downT = 0.8; }
  }
  pedStatic(P);
}
function updatePlayerInCar(P, dt) {
  const c = P.car;
  P.x = c.x; P.y = c.y; P.vx = c.vx; P.vy = c.vy; P.cd -= dt;
  const W = WEAPONS[P.weapon];
  const firing = Input.mouse.down || Input.touch.fire || keyDown('ControlLeft', 'KeyJ', 'PadX');
  if (firing && P.cd <= 0 && !W.melee && !W.throw && !W.proj && P.inv[P.weapon] > 0) {
    let ang;
    if (Pad.active) { ang = (Pad.rx || Pad.ry) ? Math.atan2(Pad.ry, Pad.rx) : (() => { const t = nearestThreat({ px: c.x, py: c.y, a: c.a }, 25, 1.4); return t ? Math.atan2(t.y - c.y, t.x - c.x) : c.a; })(); }
    else if (!Input.usingTouch) { const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y); ang = Math.atan2(wy - c.y, wx - c.x); }
    else { const t = nearestThreat({ px: c.x, py: c.y, a: c.a }, 25, 1.4); ang = t ? Math.atan2(t.y - c.y, t.x - c.x) : c.a; }
    P.cd = W.rate * 1.2; P.inv[P.weapon]--;
    fireWeapon(P, P.weapon, ang, 0.8);
  }
}

function tryEnterCar(P) {
  let best = null, bd = 1e9;
  for (const c of Game.cars) {
    if (c.dead || c.burnT > 0 || c.driver === 'player') continue;
    const d = dist(c.x, c.y, P.x, P.y) - c.L / 2;
    if (d < 2.2 && d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  const c = best;
  if (c.driver === 'ai') {
    const kind = c.driverKind;
    const ej = bailOut(c, kind === 'civ');
    if (ej) {
      const [dx, dy] = [ej.x - c.x, ej.y - c.y]; const l = Math.hypot(dx, dy) || 1;
      ej.vx = dx / l * 3; ej.vy = dy / l * 3; ej.downT = 0.8;
      if (kind === 'civ' && chance(0.2)) ej.state = 'fight';
      if (kind === 'gang') ej.state = 'chase';
    }
    crime(c.type === 'police' || kind === 'cop' ? 'stealCop' : 'carjack', c.x, c.y);
  } else if (c.type === 'police' || c.type === 'swat') crime('stealCop', c.x, c.y);
  P.car = c; c.driver = 'player'; c.ai = null; c.driverKind = null; c.siren = false;
  if (c.type === 'police') c.sirenMode = 1;
  Sfx.tone({ x: c.x, y: c.y, f0: 180, f1: 90, dur: 0.1, type: 'square', vol: 0.3 });
  UI.car(c.V.name);
  for (const sp of World.parking) if (sp.car === c) { sp.car = null; sp.cd = 60; }
}
function exitCar(P, force) {
  const c = P.car; if (!c) return;
  const fast = c.speed > 9;
  let door = c.doorPos(-1);
  if (solidT(Math.floor(door[0] / T), Math.floor(door[1] / T))) door = c.doorPos(1);
  if (solidT(Math.floor(door[0] / T), Math.floor(door[1] / T))) { if (!force) { UI.toast('문이 막혀 내릴 수 없다'); return; } door = [c.x, c.y]; }
  P.x = door[0]; P.y = door[1];
  P.vx = c.vx * 0.6; P.vy = c.vy * 0.6;
  if (fast && !force) { P.downT = 1; P.damage(Math.min(25, c.speed * 0.8), null, 0, 0, 'fall'); }
  c.driver = null; c.in.thr = 0; c.in.st = 0; c.in.brk = 0; c.in.hb = false;
  if (!c.mission) c.persistent = false;
  P.car = null; P.a = c.a;
  Sfx.tone({ x: c.x, y: c.y, f0: 160, f1: 80, dur: 0.1, type: 'square', vol: 0.3 });
}

// ---------- 고정 픽업 ----------
function placeStaticPickups() {
  const R = mulberry32(777);
  const at = (u, v) => { const s = sidewalkNear(u * MW * T, v * MH * T); return s; };
  const pl = World.places;
  if (pl.hospital) addPickup('health', pl.hospital.x, pl.hospital.y + (pl.hospital.face === 1 ? 0 : 0), { respawn: 60 });
  if (pl.clinic) addPickup('health', pl.clinic.x, pl.clinic.y, { respawn: 60 });
  if (pl.police) { const s = sidewalkNear(pl.police.x + 12, pl.police.y + 12, 6); addPickup('armor', s.x, s.y, { respawn: 90 }); }
  const weapons = [['pistol', 0.22, 0.4], ['bat', 0.5, 0.55], ['smg', 0.82, 0.3], ['shotgun', 0.55, 0.38], ['grenade', 0.5, 0.86], ['rifle', 0.9, 0.7], ['pistol', 0.7, 0.75], ['bat', 0.25, 0.8]];
  for (const [w, u, v] of weapons) { const s = at(u, v); addPickup('weapon', s.x, s.y, { wname: w, amount: WEAPONS[w].pack, respawn: 120 }); }
  for (const [u, v] of [[0.15, 0.2], [0.72, 0.62], [0.4, 0.9]]) { const s = at(u, v); addPickup('bribe', s.x, s.y, { respawn: 150 }); }
  // 숨겨진 꾸러미: 공원 안쪽, 부두 끝, 주차장 구석 같은 곳
  const spots = [];
  for (let ty = 4; ty < MH - 4; ty++) for (let tx = 4; tx < MW - 4; tx++) {
    const t = World.tiles[tIdx(tx, ty)];
    if (t === TL.GRASS || t === TL.DOCK || t === TL.SAND || t === TL.PLAZA) {
      const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => solidT(tx + dx, ty + dy)).length;
      if (walls >= 2) spots.push([tx, ty]);
    }
  }
  const chosen = [];
  for (let k = 0; k < 4000 && chosen.length < Game.packageTotal && spots.length; k++) {
    const s = spots[Math.floor(R() * spots.length)];
    if (chosen.every(c => Math.hypot(c[0] - s[0], c[1] - s[1]) > 22)) chosen.push(s);
  }
  chosen.forEach(([tx, ty], i) => { if (!Game.packages.has(i)) addPickup('package', (tx + 0.5) * T, (ty + 0.5) * T, { id: i }); });
  Game.packageTotal = chosen.length;
}

window.addEventListener('load', () => {
  const start = () => Game.init();
  if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(start); else start();
});

// 모바일판: 전체화면 + 가로 고정 + 화면 꺼짐 방지 (지원하지 않는 환경에서는 조용히 무시)
function mobileEnter() {
  try {
    const el = document.documentElement;
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fs) Promise.resolve(fs.call(el)).then(() => { try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { });
  } catch (e) { }
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => { }); } catch (e) { }
  setTimeout(() => { if (CH > CW * 1.1) UI.toast('휴대폰을 가로로 돌리면 더 넓게 보입니다'); }, 1500);
}
