'use strict';
/* =====================================================================
 * main.js — 게임 루프, 인구 관리, 플레이어 조작, 카메라, 사망/체포
 *
 * 인구 관리(Population management): GTA 시리즈처럼 도시 전체를 시뮬레이션하지 않고
 * 카메라 주변의 '고리(ring)' 영역에서만 차량·보행자를 생성하고, 멀어지면 제거한다.
 * 화면 안에서는 절대 생성/제거하지 않으므로 세계가 연속적으로 느껴진다.
 * ===================================================================== */

const Game = {
  state: 'menu', view: 'top', time: 0, clock: 17 * 60, cars: [], peds: [], pickups: [], projectiles: [],
  player: null, weather: { rain: false, intensity: 0, wet: 1, nextT: 90 }, wind: 0.6,
  packages: new Set(), packageTotal: 10, deathT: 0, popT: 0, lastDistrict: -1, districtHold: 0,
  sprayCool: 0, shopCool: 0, attract: null, attractT: 0, lastMouseMove: 0,

  init() {
    canvas = document.getElementById('game'); ctx = canvas.getContext('2d');
    lightCanvas = document.createElement('canvas'); lctx = lightCanvas.getContext('2d');
    resize(); addEventListener('resize', () => { resize(); View3D.resize(); });
    Cam.zoomMul = Settings.zoom;
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
    canvas.addEventListener('mousemove', e => { Input.mouse.x = e.clientX; Input.mouse.y = e.clientY; Input.mouse.moved = true; this.lastMouseMove = this.time; if (document.pointerLockElement === canvas) { Input.mouse.dx += e.movementX || 0; Input.mouse.dy += e.movementY || 0; } });
    addEventListener('keydown', () => { if (Sfx.ctx && Sfx.ctx.state !== 'running') Sfx.ctx.resume(); }); // 키보드로만 해도 소리가 깨어나게
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { Input.mouse.down = true; Input.mouse.clicked = true; } Sfx.init(); });
    addEventListener('mouseup', e => { if (e.button === 0) Input.mouse.down = false; });
    canvas.addEventListener('wheel', e => { if (this.state === 'map') MapView.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); else Input.wheel += sign(e.deltaY); e.preventDefault(); }, { passive: false });
    // 전체 지도: 마우스로 끌어서 이동 · 한 손가락 끌기 / 두 손가락 핀치
    canvas.addEventListener('mousedown', e => { if (this.state === 'map') { MapView.drag = { x: e.clientX, y: e.clientY }; MapView.moved = false; } });
    window.addEventListener('mousemove', e => { const d = MapView.drag; if (!d || this.state !== 'map') return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) MapView.moved = true; if (MapView.moved) { MapView.pan(dx, dy); d.x = e.clientX; d.y = e.clientY; } });
    window.addEventListener('mouseup', () => { MapView.drag = null; });
    let mt = null;
    canvas.addEventListener('touchstart', e => { if (this.state !== 'map') return; const t = e.touches; mt = t.length >= 2 ? { d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), z: MapView.z } : { x: t[0].clientX, y: t[0].clientY, sx: t[0].clientX, sy: t[0].clientY }; MapView.moved = false; }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (this.state !== 'map' || !mt) return; const t = e.touches;
      if (t.length >= 2 && mt.d) { const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); MapView.zoomAt(clamp(mt.z * d / Math.max(20, mt.d), 1, 10) / MapView.z, (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2); MapView.moved = true; }
      else if (t.length === 1 && mt.x !== undefined) { const dx = t[0].clientX - mt.x, dy = t[0].clientY - mt.y; if (Math.abs(t[0].clientX - mt.sx) + Math.abs(t[0].clientY - mt.sy) > 8) MapView.moved = true; if (MapView.moved) MapView.pan(dx, dy); mt.x = t[0].clientX; mt.y = t[0].clientY; }
    }, { passive: true });
    canvas.addEventListener('touchend', () => { mt = null; }, { passive: true });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('click', e => {
      if (this.state === 'map') this.mapClick(e.clientX, e.clientY);
      else if (this.state === 'play' && this.view !== 'top' && !Input.usingTouch && !this.player.car && document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (err) { } }
    });
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
    const st = sidewalkNear(g.x, g.y, 3); // 차도 위에서 시작하면 곧바로 무단횡단 단속에 걸린다
    const P = this.player = new PlayerPed(st.x, st.y);
    P.money = sv ? sv.money : 200; P.displayMoney = P.money;
    Jobs.active = null; Jobs.stats = (sv && sv.jobs) || {};
    if (sv) { for (const k in sv.inv) P.inv[k] = sv.inv[k] === -1 ? Infinity : sv.inv[k]; this.clock = sv.time || this.clock; P.armor = sv.armor || 0; if (sv.weapon && P.inv[sv.weapon] > 0) P.weapon = sv.weapon; P.bag = sv.bag || {}; }
    else { P.inv.pistol = 24; P.weapon = 'fist'; }
    this.fleet = sv ? sv.fleet || [] : [];
    this.props = sv ? sv.props || {} : {};
    Empire.load(sv && sv.empire); Finance.load(sv && sv.finance); Gangs.load(sv && sv.gangs); GangJob.active = null; SaveExt.load(sv && sv.ext);
    if (!sv) this.introT = 7;
    if (sv && sv.body) { Object.assign(P, sv.body); P.hp = P.maxHp; }
    // v2.13 보상: 업데이트 중 사라진 돈 $600,000 (이 저장소에서 한 번만)
    try { if (!localStorage.getItem('neonharbor.gift.600k')) { localStorage.setItem('neonharbor.gift.600k', '1'); P.money += 600000; P.displayMoney = P.money; this.giftMsg = true; } } catch (e) { }
    placeStaticPickups();
    Military.reset(); Airport.reset(); AirPatrol.reset(); Vendors.place(); EMS.car = null; EMS.body = null; EMS.medics = []; Givers.npc = null; Givers.idx = -1;
    this.waypoint = null; this.noWanted = false;
    Cam.x = P.x; Cam.y = P.y;
    this.populate(true);
    // 시작 차량 하나
    const sp = roadsideSpot(P.x, P.y, 10, 40);
    const c = new Car('sedan', sp.x, sp.y, sp.a); this.cars.push(c);
    Menu.hide();
    this.state = 'play';
    if (this.giftMsg) { this.giftMsg = false; setTimeout(() => UI.big('$600,000 보상', '업데이트로 사라졌던 돈을 돌려드렸습니다', 4, '#9be15d'), 800); Save.write(); }
    if (IS_MOBILE) mobileEnter();
    if (!sv) {
      UI.big('네온 하버', '1998년, 항구 도시의 밤', 3.5, '#ff5d8f');
      UI.dialog(IS_MOBILE
        ? [['도움말', '왼쪽 화면을 끌어 이동하고, 발사 버튼은 가까운 적을 자동 조준한다. 탑승 버튼으로 차에 탄다.'], ['도움말', '노란 M 마커로 가면 첫 의뢰를 받을 수 있다. 지도 버튼으로 위치를 확인하자.']]
        : [['도움말', 'WASD로 이동, 마우스로 조준·사격, F로 차량 탑승. 노란 M 마커에서 첫 의뢰를 받을 수 있다.'], ['도움말', 'M: 지도 · R: 라디오 · Q/E: 무기 교체 · Esc: 일시정지 · 게임패드도 지원한다']]);
    } else UI.toast('저장된 진행 상황을 불러왔다');
  },
  toMenu() { if (this.view !== 'top') setView('top'); this.state = 'menu'; Menu.show(); this.player.hidden = true; Wanted.reset(); Police.reset(); Missions.active = null; },
  // 전체 지도 클릭 = 웨이포인트 지정/해제 (지도 밖을 누르면 닫기)
  mapClick(sx, sy) {
    const r = this.mapRect; if (!r) return;
    const tb = this.turfBtn; if (tb && sx >= tb.x && sx <= tb.x + tb.w && sy >= tb.y && sy <= tb.y + tb.h) { this.showTurf = !this.showTurf; return; }
    const bb = this.bizBtn; if (bb && sx >= bb.x && sx <= bb.x + bb.w && sy >= bb.y && sy <= bb.y + bb.h) { this.showBiz = !this.showBiz; return; }
    for (const b of this.mapZoomBtns || []) if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) { MapView.zoomAt(b.f); return; }
    if (MapView.moved) { MapView.moved = false; return; } // 드래그로 지도를 옮긴 것
    if (sx < r.ox || sy < r.oy || sx > r.ox + (r.w || r.size) || sy > r.oy + (r.h || r.size)) { this.state = 'play'; this.pickTurf = false; return; }
    const x = (sx - r.mx) / r.k, y = (sy - r.my) / r.k;
    if (this.pickTurf) { // 구역 넓히기: 고른 블록으로 습격
      const b = blockAt(x, y);
      if (!Gangs.raidable(b)) { UI.toast(b && Gangs.turf[b.id] === Gangs.mine ? '이미 우리 구역이다' : '우리 구역에 맞닿은 블록(노란 테두리)을 골라라'); return; }
      this.pickTurf = false; this.state = 'play'; GangJob.start('raid', b); return;
    }
    if (this.waypoint && dist(x, y, this.waypoint.x, this.waypoint.y) < 25) { this.waypoint = null; UI.toast('웨이포인트 해제'); }
    else { this.waypoint = { x, y }; Sfx.pickup(); }
  },
  pause() { if (this.state !== 'play') return; this.state = 'paused'; Menu.showPause(); },
  resume() { Menu.hidePause(); this.state = 'play'; },

  focus() {
    if (this.state === 'menu' && this.attract && this.cars.includes(this.attract)) return { x: this.attract.x, y: this.attract.y };
    return { x: this.player.px, y: this.player.py };
  },

  loop(now) {
    const raw = (now - (this.last || now)) / 1000, dt = Math.min(0.05, raw); this.last = now;
    Perf.tick(raw);
    try { this.frame(dt * (this.slowmo ? 0.4 : 1)); } catch (e) { console.error(e); }
    endFrameInput();
    requestAnimationFrame(t => this.loop(t));
  },
  frame(dt) {
    Pad.poll();
    const st = this.state;
    if (st !== this._lastSt) { this._lastSt = st; document.body.classList.toggle('playing', st !== 'menu'); document.body.classList.toggle('mapopen', st === 'map'); }
    const drv = st !== 'menu' && !!(this.player && this.player.car);
    if (drv !== this._lastDrv) {
      this._lastDrv = drv; document.body.classList.toggle('driving', drv);
      Input.touch.on = false; Input.touch.jx = Input.touch.jy = 0; Input.touch.stickId = null; Drive.reset();
      const b = document.getElementById('t-enter'); if (b) b.textContent = drv ? '하차' : '탑승';
    }
    const sp = drv && hasVW(this.player.car) ? this.player.car.V.special : '';
    const lab = sp ? VWEAP[vWeapon(this.player.car)].short + '|' + sp : '';
    if (lab !== this._lastSp) {
      this._lastSp = lab; document.body.classList.toggle('special', !!sp);
      const L = sp ? [VWEAP[vWeapon(this.player.car)].short, sp === 'tank' ? '기관총' : '유도탄'] : ['발사', '드리프트'];
      const f = document.getElementById('t-fire'), h = document.getElementById('t-hb');
      if (f) f.textContent = L[0]; if (h) h.textContent = L[1];
    }
    Drive.update(dt);
    if (st !== 'map') this._mapOpen = false;
    if (st === 'play') {
      if (keyHit('Escape', 'KeyP', 'PadStart')) { this.pause(); }
      else if (keyHit('KeyM', 'Tab', 'PadBack')) { this.state = 'map'; }
      else this.update(dt);
    } else if (st === 'map') {
      if (this._mapOpen !== true) { this._mapOpen = true; if (MapView.cx === null) MapView.reset(); if (MapView.z > 1) MapView.center(this.player.px, this.player.py); }
      if (keyHit('Equal', 'NumpadAdd', 'PadRB')) MapView.zoomAt(1.5); if (keyHit('Minus', 'NumpadSubtract', 'PadLB')) MapView.zoomAt(1 / 1.5);
      if (keyHit('Escape', 'KeyM', 'Tab', 'PadBack', 'PadB', 'PadStart')) { this.state = 'play'; this.pickTurf = false; }
      if (keyHit('KeyG', 'PadY')) this.showTurf = !this.showTurf;
      if (keyHit('KeyV')) this.showBiz = !this.showBiz;
    } else if (st === 'cutscene') {
      Cutscene.update(dt);
    } else if (st === 'paused') {
      if (keyHit('Escape', 'KeyP', 'PadStart', 'PadB')) this.resume();
    } else if (st === 'menu') {
      this.updateAttract(dt);
      if (keyHit('PadA', 'PadStart')) { Sfx.init(); this.newGame(!!Save.read()); }
    } else if (st === 'wasted' || st === 'busted') {
      this.deathT += dt;
      this.update(dt, true);
      if (this.deathT > 4.2) this.respawn(st);
    } else if (st === 'fin') {
      if (keyHit('Escape', 'PadB')) FinUI.close();
    } else if (st === 'ward') {
      if (keyHit('Escape', 'PadB')) Wardrobe.close();
    } else if (st === 'bag') {
      if (keyHit('Escape', 'KeyB', 'PadB')) Bag.close();
    } else if (st === 'shop') {
      if (keyHit('Escape', 'PadB', 'KeyI') && Phone.close()) { /* 휴대폰 닫기 */ }
      else if (keyHit('Escape', 'PadB')) { if (!document.getElementById('jobs').hidden) Jobs.closeBoard(); else if (!document.getElementById('casino').hidden) { if (!Casino.busy) Casino.close(); } else Shop.close(); }
    }
    try { Sfx.update(dt); } catch (e) { /* 오디오 오류는 게임을 멈추지 않게 */ }
    UI.update(st === 'play' || st === 'wasted' || st === 'busted' ? dt : 0);
    const is3d = this.view !== 'top' && View3D.ok && st !== 'menu';
    if (is3d) {
      if (st === 'play') View3D.updateYaw(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      View3D.render(dt);
      drawWorldTexts3D();
      Rain.draw(this.weather.intensity);
    } else renderScene();
    Weather.drawOverlay();
    if (st === 'play' || st === 'wasted' || st === 'busted' || st === 'shop' || st === 'paused' || st === 'bag' || st === 'ward' || st === 'fin') { drawHUD(dt); if (st === 'play') drawLockHUD(); }
    if (st === 'wasted' || st === 'busted') drawDeathScreen(st, this.deathT);
    if (st === 'map') drawFullMap();
    if (st === 'cutscene') Cutscene.draw();
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
    Cam.ppm = smooth(Cam.ppm, Math.min(CW, CH) / 70, 2, dt); Cam.sx = Cam.sy = 0;
    const at = this.attract && Settings.camRot ? this.attract.a + Math.PI / 2 : 0;
    Cam.rot = angNorm(Cam.rot + angNorm(at - Cam.rot) * (1 - Math.exp(-1.5 * dt)));
    camSetView();
  },

  update(dt, dead = false) {
    const P = this.player;
    this.time += dt; this.clock = (this.clock + dt) % 1440;
    // 입력
    if (!dead) {
      if (!P.car && keyHit('KeyT', 'PadX') && Pick.target) Pick.attempt();
      if (keyHit('KeyX') && Jobs.active) Jobs.stop('일을 그만뒀다');
      if (keyHit('KeyV')) { Settings.camRot = !Settings.camRot; Settings.save(); UI.toast(Settings.camRot ? '운전 시점: 차 방향으로 회전' : '운전 시점: 북쪽 고정'); }
      if (keyHit('KeyF', 'Enter', 'PadY')) { if (P.car) exitCar(P); else if (!(P.alt > 0)) tryEnterCar(P); }
      const vc = hasVW(P.car) ? P.car : null; // 전차·헬기·전투기: 탑승 무기 교체
      if (keyHit('KeyE') || ((!P.car || vc) && keyHit('PadRight'))) { if (vc) cycleVWeapon(vc, 1); else cycleWeapon(P, 1); }
      if (keyHit('KeyQ') || ((!P.car || vc) && keyHit('PadLeft'))) { if (vc) cycleVWeapon(vc, -1); else cycleWeapon(P, -1); }
      // 마우스 휠 = 확대/축소 (무기는 Q/E · 숫자키)
      if (Input.wheel) Zoom.by(Input.wheel > 0 ? 1.12 : 1 / 1.12);
      if (keyHit('Equal', 'NumpadAdd')) Zoom.by(1 / 1.15); if (keyHit('Minus', 'NumpadSubtract')) Zoom.by(1.15);
      if (!P.car && keyHit('PadRB')) cycleWeapon(P, 1);
      if (!P.car && keyHit('PadLB')) cycleWeapon(P, -1);
      // 숫자키 1~9·0: 가진 무기 중 n번째
      for (let i = 0; i <= 9; i++) if (keyHit('Digit' + i)) { const own = WEAPON_ORDER.filter(w => P.inv[w] > 0), w = own[(i + 9) % 10]; if (w) { P.weapon = w; UI.weaponFlash = 1; } }
      if (keyHit('KeyR', 'PadDown') && P.car) { Radio.cycle(); }
      if (keyHit('KeyB')) Bag.open();
      if (keyHit('KeyO')) Shop.open('gang');
      if (keyHit('KeyI')) Phone.open();
      if (keyHit('F1')) toggleKeyHelp();
      if (keyHit('KeyK')) Gangs.callBackup();
      if (keyHit('KeyC', 'PadUp')) cycleView();
      if (keyHit('KeyZ')) Zoom.set(Settings.zoom < 0.7 ? 0.75 : Settings.zoom < 1.1 ? 1.4 : 0.55);
      if (P.car && (P.car.type === 'police' || P.car.type === 'ambulance') && keyHit('KeyG', 'PadLeft')) { P.car.siren = !P.car.siren; }
      if (P.car) updatePlayerInCar(P, dt); else if (P.alt > 0) Para.update(P, dt); else updatePlayerFoot(P, dt);
    }
    this.simulate(dt, false);
    Nav.update(dt);
    Police.update(dt);
    Jay.update(dt);
    Missions.update(dt);
    Jobs.update(dt);
    Military.update(dt); Airport.update(dt); AirPatrol.update(dt); Bag.update(dt); Fleet.update(); Biz.update(dt); BankRob.update(dt); Gangs.update(dt); GangJob.update(dt); Empire.update(dt); Finance.update(dt);
    this.autoT = (this.autoT || 0) + dt; if (this.autoT > 30 && this.state === 'play') { this.autoT = 0; Save.write(); } // 30초마다 자동 저장
    if (this.introT > 0 && (this.introT -= dt) <= 0) UI.big('조직을 고르자', '지도(M)의 왕관 = 조직 보스 · 찾아가 계약하거나, 은신처(집)에서 내 조직을 세울 수 있다', 5, '#f2c14e');
    Talk.update(dt); Aim.update(dt); EMS.update(dt); Givers.update(); Vendors.update(dt); GPS.update(dt);
    // 체력 자연 회복: 6초 동안 안 다치면 50까지 천천히 (GTA V)
    if (!P.dead && P.hp < 50 && this.time - (P.lastHurt || 0) > 6) P.hp = Math.min(50, P.hp + 2 * dt);
    if (P.car && keyHit('KeyH')) for (const q of this.peds) if (q.kind === 'civ' && !q.dead && dist2(q.x, q.y, P.px, P.py) < 144 && chance(0.4)) Talk.line(q, 'honk');
    Pick.scan();
    if (Pick.target !== this._lastPick) { this._lastPick = Pick.target; document.body.classList.toggle('cansteal', !!Pick.target); }
    updatePickups(dt);
    Events.update(dt); Stunts.update(dt); Races.update(dt); GF.update(dt); Achieve.update(dt); LifeMsgs.update(dt); Tycoon.update(dt);
    this.places(dt);
    // 사망
    if (P.hp <= 0 && this.state === 'play') this.wasted();
    // 카메라
    this.updateCamera(dt);
    // 지역 이름
    const d = hoodAt(P.px, P.py);
    if (d !== this.lastDistrict) { this.districtHold += dt; if (this.districtHold > 0.6) { this.lastDistrict = d; this.districtHold = 0; UI.district(d); } }
    else this.districtHold = 0;
  },

  simulate(dt, menu) {
    // 날씨
    Weather.update(dt); // events.js: 맑음·비·폭풍·안개
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
    if (P.alt > 0 && (P.dead || menu)) P.alt = Math.max(0, P.alt - 25 * dt);
    updateProjectiles(dt); Fires.update(dt);
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
    const v3 = this.view !== 'top';
    const inner = initial ? 0 : v3 ? 95 : viewR + 4, outer = v3 ? 160 : viewR + 70, kill = v3 ? 200 : viewR + 110;
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
    // 주차 차량 (빈 차는 최대 TUNE.cars[0]대 — 주차장이 몰린 곳에서 무한정 늘지 않게)
    let idle = 0; for (const c of this.cars) if (!c.driver && !c.persistent && !c.dead) idle++;
    for (const sp of World.parking) {
      if (idle >= TUNE.cars[0]) break;
      if (sp.car || sp.cd > 0) continue;
      const d = dist(sp.x, sp.y, f.x, f.y);
      if (d < inner || d > outer || (!initial && onScreen(sp.x, sp.y, 4))) continue;
      sp.cd = 60;
      if (!chance(0.55)) continue;
      const c = new Car(pick(['sedan', 'compact', 'sports', 'muscle', 'van', 'sedan', 'compact', 'bike', 'bike']), sp.x, sp.y, sp.a + (chance(0.5) ? Math.PI : 0));
      this.cars.push(c); sp.car = c; idle++;
    }
    // 마리나 보트
    for (const sp of World.marinas || []) {
      if (sp.car && (!this.cars.includes(sp.car) || dist(sp.car.x, sp.car.y, sp.x, sp.y) > 6)) { sp.car = null; sp.cd = 40; }
      sp.cd -= 0.4;
      if (sp.car || sp.cd > 0) continue;
      const d = dist(sp.x, sp.y, f.x, f.y);
      if (d < inner || d > outer || (!initial && onScreen(sp.x, sp.y, 6))) continue;
      sp.cd = 60;
      const c = new Car(chance(0.55) ? 'jetski' : 'speedboat', sp.x, sp.y, sp.a); this.cars.push(c); sp.car = c;
    }
    // 보행자
    const wantPeds = night ? TUNE.peds[1] : TUNE.peds[0];
    let peds = 0;
    for (const p of this.peds) if (!p.dead && dist(p.x, p.y, f.x, f.y) < kill) peds++;
    tries = initial ? 120 : 6;
    const nearB = blocksNear(f.x, f.y, outer);
    while (peds < wantPeds && tries-- > 0 && nearB.length) {
      const b = pick(nearB);
      const L = b.loop, s = rand(0, L.P), [x, y] = loopPoint(L, s);
      const d = dist(x, y, f.x, f.y);
      if (d < inner || d > outer || (!initial && onScreen(x, y, 3))) continue;
      const dist_ = b.district;
      const owner = Gangs.turf[b.id];
      if (owner && chance(0.3)) { // 구역 주인 조직원이 무리 지어 서성인다
        const n = randi(2, 3), gang = owner;
        for (let i = 0; i < n; i++) { const g = spawnPed('gang', x + rand(-1.5, 1.5), y + rand(-1.5, 1.5)); setGang(g, gang); g.homeX = g.x; g.homeY = g.y; peds++; }
        continue;
      }
      const p = spawnPed(chance(0.06) ? 'cop' : 'civ', x, y);
      p.block = b; p.s = s; p.state = 'walk'; p.seg = -1;
      if (p.kind === 'civ') { dressArch(p, pickArch(dist_)); if (p.dog) { p.dog.x = x - 1; p.dog.y = y; } }
      if (dist_ === DIST.BEACH && chance(0.5)) { p.shirt = pick(['#ff8fab', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de']); p.pants = pick(['#f4a261', '#2a9d8f', '#e9c46a']); }
      if (dist_ === DIST.DOWNTOWN && chance(0.5)) { p.shirt = pick(['#2b2d42', '#3d405b', '#1b263b', '#6c757d']); p.pants = '#1b1b1f'; }
      peds++;
    }
  },

  updateCamera(dt) {
    const P = this.player;
    let tx = P.px, ty = P.py;
    const car = P.car;
    // 운전 중: 화면이 차 방향으로 돌고(차 앞이 화면 위), 진행 방향 앞쪽을 더 보여준다
    const wantRot = car && Settings.camRot && !car.dead ? car.a + Math.PI / 2 : 0;
    if (this.view !== 'top' && View3D.ok) Cam.rot = View3D.yaw + Math.PI / 2; // 3D: 조작·레이더 기준 = 시선 방향
    else Cam.rot = angNorm(Cam.rot + angNorm(wantRot - Cam.rot) * (1 - Math.exp(-(car ? 2.6 : 2) * dt)));
    if (car) {
      const f = car.fwd(), ahead = car.vf > 1 ? clamp(4 + car.vf * 0.45, 0, 20) : 0;
      tx += clamp(car.vx * 0.3, -12, 12) + f[0] * ahead; ty += clamp(car.vy * 0.3, -12, 12) + f[1] * ahead;
    }
    else if (!Input.usingTouch && !Pad.active && this.time - this.lastMouseMove < 3 && WEAPONS[P.weapon] && !WEAPONS[P.weapon].melee) {
      const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y);
      tx += clamp((wx - P.x) * 0.2, -6, 6); ty += clamp((wy - P.y) * 0.2, -6, 6);
    }
    Cam.x = smooth(Cam.x, tx, car ? 4 : 5, dt); Cam.y = smooth(Cam.y, ty, car ? 4 : 5, dt);
    const alt = car ? car.alt || 0 : P.alt || 0;
    const span = (car ? 50 + car.speed * 0.9 + alt * 1.6 : 38 + alt * 1.4) * Cam.zoomMul;
    Cam.ppm = smooth(Cam.ppm, Math.min(CW, CH) / Math.min(alt > 1.2 ? 340 : 190, span), 1.6, dt);
    camSetView();
    Cam.shake = Math.max(0, Cam.shake - dt * 1.6);
    Cam.sx = (Math.random() - 0.5) * Cam.shake * 14; Cam.sy = (Math.random() - 0.5) * Cam.shake * 14;
  },

  places(dt) {
    const P = this.player;
    this.sprayCool -= dt; this.shopCool -= dt;
    // 페인트샵
    for (const key of ['spray', 'spray2']) {
      const S = World.places[key]; if (!S || !P.car || P.car.alt > 1.2 || this.sprayCool > 0) continue;
      if (dist(P.car.x, P.car.y, S.x, S.y) < 5 && P.car.speed < 5) {
        this.sprayCool = 12;
        const sprayCost = Biz.has('biz_auto') ? 0 : 100;
        if (P.money < sprayCost) { UI.toast('페인트샵: $100이 필요하다'); continue; }
        if (Wanted.stars > 0 && Wanted.seen) { UI.toast('경찰이 보고 있다! 따돌린 뒤 다시 오자'); this.sprayCool = 3; continue; }
        P.money -= sprayCost; P.car.hp = P.car.maxHp; P.car.burnT = 0; P.car.flat = false; P.car.dmgParts = null;
        P.car.color = pick(['#e0262b', '#3c6fb0', '#f2c200', '#1d1d1f', '#e8e8ea', '#4e7a52', '#7a3b8f', '#f07c1b']);
        const had = Wanted.stars > 0;
        Wanted.clear(); Sfx.cash();
        UI.toast((had ? '새 도색 완료! 수배가 해제됐다' : '수리 및 도색 완료') + (sprayCost ? ' (-$100)' : ' (정비소 소유주 무료)'));
      }
    }
    // 네온 모터스 · 내 차고: 차를 몰고 마당에 세우거나 걸어서 들어가면 화면이 열린다
    for (const key of ['dealer', 'mygarage']) {
      const DL = World.places[key];
      if (!DL || this.shopCool > 0 || P.alt > 0) continue;
      const inCar = P.car && !(P.car.alt > 1.2) && dist(P.car.x, P.car.y, DL.x, DL.y) < 9 && P.car.speed < 3;
      const onFoot = !P.car && dist(P.x, P.y, DL.x, DL.y) < 3;
      if (inCar || onFoot) { Shop.open(key); return; }
    }
    // 상점 · 직업 게시판 (걸어서 문 앞 마커에 들어가면 열림)
    if (!P.car && !(P.alt > 0) && this.shopCool <= 0 && !(Missions.active && Missions.active.def.noShop)) {
      for (const [k, kind] of [...GANG_IDS.map(g => ['hq_' + g, 'hq_' + g]), ...Object.keys(BUSINESSES).map(b => [b, b]), ['ammu3', 'ammu'], ['burger3', 'burger'], ['burger4', 'burger'], ['mart4', 'mart'], ['mart5', 'mart'], ['clothes', 'clothes'], ['clothes2', 'clothes'], ['gym', 'gym'], ['pharmacy', 'pharmacy'], ['pharmacy2', 'pharmacy'], ['bank', 'bank'], ['ammu', 'ammu'], ['ammu2', 'ammu'], ['burger', 'burger'], ['burger2', 'burger'], ['mart', 'mart'], ['mart2', 'mart'], ['mart3', 'mart'], ...EXTRA_PLACES, ...(World.branches || []).map(b => [b.key, b.kind]), ...(World.schools || []).map(k => [k, 'school'])]) {
        const S = World.places[k]; if (S && dist(P.x, P.y, S.x, S.y) < 1.8) { Shop.open(kind); return; }
      }
      const SH = World.places.safehouse;
      if (SH && dist(P.x, P.y, SH.x, SH.y) < 1.8) { Shop.open('safehouse'); return; }
      const JC = World.places.jobcenter, BR = World.places.broker;
      if (JC && dist(P.x, P.y, JC.x, JC.y) < 1.8) Jobs.openBoard(true);
      else if (BR && dist(P.x, P.y, BR.x, BR.y) < 1.8) Jobs.openBoard(false);
    }
  },

  wasted() {
    const P = this.player;
    P.dead = true; this.state = 'wasted'; this.deathT = 0;
    if (P.car) { const c = P.car; c.driver = null; P.car = null; P.x = c.x; P.y = c.y; }
    if (Missions.active) Missions.fail('사망');
    Jobs.stop('쓰러져서 일을 놓쳤다');
    Sfx.failed();
  },
  busted() {
    if (this.state !== 'play') return;
    const P = this.player;
    this.state = 'busted'; this.deathT = 0;
    if (P.car) { const c = P.car; exitCar(P, true); c.driver = null; }
    if (Missions.active) Missions.fail('체포됨');
    Jobs.stop('체포되어 일을 놓쳤다');
    Sfx.failed();
  },
  respawn(kind) {
    const P = this.player;
    let spot;
    if (kind === 'wasted') {
      const hs = ['hospital', 'clinic', 'hospital2', 'hospital3', ...(World.branches || []).filter(b => b.kind === 'hospital_st').map(b => b.key)].map(k => World.places[k]).filter(Boolean);
      spot = hs.sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y))[0];
      if (!Empire.freeHospital()) P.money = Math.max(0, P.money - 100);
    } else {
      spot = ['police', 'police2', 'police3', ...(World.branches || []).filter(b => b.kind === 'police_st').map(b => b.key)].map(k => World.places[k]).filter(Boolean).sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y))[0];
      const fine = Math.min(P.money, 100 + Wanted.stars * 150);
      P.money = Math.max(0, P.money - (Empire.lenient() ? Math.round(fine / 2) : fine));
      if (!Empire.lenient()) { P.inv = { fist: Infinity }; P.weapon = 'fist'; } else UI.toast('경찰 후원 덕분에 무기는 돌려받았다');
    }
    const np = new PlayerPed(spot.x, spot.y);
    Object.assign(np, { money: P.money, displayMoney: P.money, inv: P.inv, weapon: P.weapon in P.inv ? P.weapon : 'fist', bag: kind === 'wasted' ? P.bag : {}, maxHp: P.maxHp, hp: P.maxHp, endurance: P.endurance, aimSkill: P.aimSkill, eduLv: P.eduLv }); for (const k of STYLE_KEYS) np[k] = P[k];
    if (kind === 'wasted') np.inv = P.inv;
    this.player = np;
    Wanted.reset(); Police.reset(); Jay.reset();
    for (const p of this.peds) if ((p.kind === 'cop' || p.kind === 'swat' || p.kind === 'gang') && p.state === 'chase') p.state = p.kind === 'gang' || p.soldier ? 'idle' : 'patrol';
    for (const c of this.cars) if (c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'block' || c.ai.mode === 'air')) { c.remove = true; }
    AirPatrol.reset();
    this.cars = this.cars.filter(c => !c.remove);
    Cam.x = np.x; Cam.y = np.y;
    this.state = 'play';
    UI.district(kind === 'wasted' ? '병원 앞' : '경찰서 앞');
    Save.write();
  },
};


function spawnLaneSpot(f, inner, outer, initial) {
  for (let k = 0; k < 6; k++) {
    const near = edgesNear(f.x, f.y, outer); if (!near.length) return null;
    const e = pick(near), A = World.nodes[e[0]], B = World.nodes[e[1]];
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
  if (Cam.rot) { const c = Math.cos(Cam.rot), s = Math.sin(Cam.rot); [mx, my] = [mx * c - my * s, mx * s + my * c]; }
  // 달리기: 체력(스태미나)을 쓰며 빨리 달린다. 바닥나면 숨이 차서 잠깐 못 달림. 음식·음료로 회복.
  const wantRun = (keyDown('ShiftLeft', 'ShiftRight', 'PadA') || Input.touch.run || (Input.touch.on && mag > 0.92)) && mag > 0.15;
  if (P.exhausted && P.stamina > 0.35) P.exhausted = false;
  const sprint = wantRun && !P.exhausted;
  P.boostT = Math.max(0, P.boostT - dt);
  if (sprint) { if (P.boostT <= 0) { P.stamina -= dt / (9 * (P.endurance || 1)); if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; UI.toast('숨이 차다! 잠깐 걸으며 쉬자'); } } }
  else P.stamina = Math.min(1, P.stamina + dt * (mag > 0.15 ? 0.12 : 0.28));
  P.swim = tileAt(P.x, P.y) === TL.WATER;
  if (P.swim && !P._swimMsg) { P._swimMsg = true; UI.toast('헤엄치는 중 — 총은 쓸 수 없다'); } else if (!P.swim) P._swimMsg = false;
  const speed = P.downT > 0 ? 0 : P.swim ? (sprint ? 3.6 : 2.4) : sprint ? (P.boostT > 0 ? 8.2 : 7.6) : P.exhausted ? 3.4 : 4.4;
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
  if (this_view3d()) P.aim = View3D.aimAngle();
  if (!W.melee || firing) P.a = P.aim; else if (mag > 0.1) P.a = Math.atan2(P.vy, P.vx);
  if (firing && P.cd <= 0 && P.downT <= 0 && !P.swim) {
    if (!W.melee && !(P.inv[P.weapon] > 0)) { cycleWeapon(P, 1); }
    else {
      P.cd = W.rate;
      if (!W.melee && !P.infAmmo) { P.inv[P.weapon]--; if (P.inv[P.weapon] <= 0) { delete P.inv[P.weapon]; setTimeout(() => { if (!(P.inv[P.weapon] > 0)) P.weapon = 'fist'; }, 200); } }
      fireWeapon(P, P.weapon, P.aim);
      if (!W.melee) { P.vx -= Math.cos(P.aim) * 0.4; P.vy -= Math.sin(P.aim) * 0.4; }
    }
  }
  P.x += P.vx * dt; P.y += P.vy * dt;
  const sp = Math.hypot(P.vx, P.vy); P.moving = sp; P.anim += sp * dt * 2.4;
  for (const q of Game.peds) {
    if (q.dead || q.car) continue;
    const dx = P.x - q.x, dy = P.y - q.y, d2 = dx * dx + dy * dy;
    if (d2 < 0.5 && d2 > 1e-6) { const d = Math.sqrt(d2), push = (0.72 - d) * 0.5; P.x += dx / d * push; P.y += dy / d * push; q.x -= dx / d * push; q.y -= dy / d * push; if (sprint && q.kind === 'civ' && chance(0.02)) q.downT = 0.8; if (q.kind === 'civ' && chance(0.03)) Talk.line(q, 'bump'); }
  }
  pedStatic(P);
}
function updatePlayerInCar(P, dt) {
  const c = P.car;
  P.x = c.x; P.y = c.y; P.vx = c.vx; P.vy = c.vy; P.cd -= dt;
  const W = WEAPONS[P.weapon];
  const firing = Input.mouse.down || Input.touch.fire || keyDown('ControlLeft', 'KeyJ', 'PadX');
  if (hasVW(c)) { MilFire.update(c, dt, firing, keyDown('Space', 'PadRB', 'PadB') || Input.touch.hb); return; }
  if (firing && P.cd <= 0 && !W.melee && !W.throw && !W.proj && P.inv[P.weapon] > 0) {
    let ang;
    if (this_view3d()) ang = View3D.aimAngle();
    else if (Pad.active) { ang = (Pad.rx || Pad.ry) ? Math.atan2(Pad.ry, Pad.rx) : (() => { const t = nearestThreat({ px: c.x, py: c.y, a: c.a }, 25, 1.4); return t ? Math.atan2(t.y - c.y, t.x - c.x) : c.a; })(); }
    else if (!Input.usingTouch) { const [wx, wy] = screenToWorld(Input.mouse.x, Input.mouse.y); ang = Math.atan2(wy - c.y, wx - c.x); }
    else { const t = nearestThreat({ px: c.x, py: c.y, a: c.a }, 25, 1.4); ang = t ? Math.atan2(t.y - c.y, t.x - c.x) : c.a; }
    P.cd = W.rate * 1.2; if (!P.infAmmo) P.inv[P.weapon]--;
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
  else if (!c.everDriven && !c.persistent && c.type !== 'bike' && chance(0.3)) { c.alarmT = 9; UI.toast('도난 경보가 울린다!'); crime('carjack', c.x, c.y); }
  c.everDriven = true;
  P.car = c; c.driver = 'player'; c.ai = null; c.driverKind = null; c.siren = false;
  if (c.type === 'police') c.sirenMode = 1;
  Sfx.tone({ x: c.x, y: c.y, f0: 180, f1: 90, dur: 0.1, type: 'square', vol: 0.3 });
  UI.car(c.label || c.V.name);
  // 특수 차량 첫 탑승: 조작법 안내 (차종마다 한 번)
  const sp = c.V.special; Game.hinted = Game.hinted || {};
  if (sp && !Game.hinted[sp]) {
    Game.hinted[sp] = true;
    const M = IS_MOBILE;
    UI.dialog([['도움말', {
      tank: M ? '전차: 가속/브레이크 페달로 전진·후진, 핸들로 제자리 회전. 주포 버튼으로 포탄 — 포탑은 가까운 적을 자동으로 겨눈다.' : '전차: W/S 전진·후진, A/D 제자리 회전. 마우스로 포탑 조준, 클릭 또는 스페이스로 주포.',
      heli: M ? '헬기: 가속 페달 = 이륙·전진, 브레이크 = 후진, 핸들 = 방향. 기관포·미사일 버튼으로 공격. 하차 한 번 = 착륙, 곧바로 한 번 더 = 낙하산.' : '헬기: W 이륙·전진, S 후진, A/D 방향. 클릭 = 기관포, 스페이스 = 미사일. F 한 번 = 착륙, 곧바로 한 번 더 = 낙하산 탈출.',
      boat: M ? '보트: 가속 페달로 전진, 핸들로 방향. 물 위에서만 움직이고, 속도가 붙어야 잘 돈다. 하차하면 헤엄친다.' : '보트: W 전진, S 후진, A/D 방향. 물 위에서만 움직이고 속도가 붙어야 잘 돈다. F로 내리면 헤엄친다.',
      jet: M ? '전투기: 가속 페달로 활주로를 달려 약 120km/h에서 이륙. 너무 느려지면 떨어진다. 기관포·미사일은 기수 방향. 하차 = 착륙 접근, 두 번 = 낙하산.' : '전투기: W로 활주로를 달려 약 120km/h에서 이륙, 너무 느려지면 고도가 떨어진다. 클릭 = 기관포, 스페이스 = 미사일(기수 방향). F = 착륙 접근, 두 번 = 낙하산.',
    }[sp]]]);
  }
  for (const sp of World.parking) if (sp.car === c) { sp.car = null; sp.cd = 60; }
}
function exitCar(P, force) {
  const c = P.car; if (!c) return;
  if (isAir(c) && c.alt - roofAt(c.x, c.y) > 1 && !force) {
    if (c.landing && Game.time - (c.landReqT || 0) < 1.6) { Para.bail(P, c); return; }
    c.landing = true; c.landReqT = Game.time;
    UI.toast((c.V.special === 'jet' ? '착륙 접근 중…' : '착륙 중…') + ' 곧바로 한 번 더 누르면 낙하산 탈출');
    return;
  }
  const fast = c.speed > 9 && !c.V.special;
  let door = c.doorPos(-1);
  if (solidNoWater(Math.floor(door[0] / T), Math.floor(door[1] / T))) door = c.doorPos(1);
  if (solidNoWater(Math.floor(door[0] / T), Math.floor(door[1] / T))) {
    if (c.alt > 1.2) { door = openSpotNear(c.x, c.y); UI.toast('옥상 비상계단으로 내려왔다'); } // 옥상에 세운 헬기
    else if (!force) { UI.toast('문이 막혀 내릴 수 없다'); return; } else door = openSpotNear(c.x, c.y);
  }
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
  const at = (u, v) => { const s = sidewalkNear(u * CITY_W * T, v * CITY_H * T); return s; };
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

// 창을 닫거나 다른 창으로 가면 저장
for (const ev of ['beforeunload', 'pagehide']) window.addEventListener(ev, () => { if (Game.player && Game.state !== 'menu') Save.write(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && Game.player && Game.state !== 'menu') Save.write(); });
window.addEventListener('load', () => {
  // 로딩 화면을 먼저 그린 뒤 도시를 만든다 (만드는 동안 빈 화면으로 멈춘 것처럼 보이지 않게)
  const start = () => setTimeout(() => {
    try { Game.init(); const b = document.getElementById('boot'); if (b) { b.style.display = 'none'; b.dataset.ok = '1'; } }
    catch (e) { console.error(e); const m = document.getElementById('boot-msg'); if (m) { m.style.color = '#ff6b6b'; m.textContent = '오류로 시작하지 못했습니다: ' + e.message + ' — 이 문구를 알려 주세요'; } }
  }, 30);
  if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]).then(start); else start();
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

const this_view3d = () => Game.view !== 'top' && View3D.ok;
// 3D 시점에서 떠오르는 글자·말풍선 (3D 투영 위치)
function drawWorldTexts3D() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.font = '700 15px "Noto Sans KR", sans-serif';
  for (const t of Effects.texts) { const s = View3D.project(t.x, t.y, 2); if (!s) continue; ctx.globalAlpha = t.life / t.max; ctx.fillStyle = '#000'; ctx.fillText(t.s, s[0] + 1, s[1] + 1); ctx.fillStyle = t.c; ctx.fillText(t.s, s[0], s[1]); }
  ctx.globalAlpha = 1;
  Talk.draw();
}
