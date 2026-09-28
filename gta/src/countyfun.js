'use strict';
/* =====================================================================
 * countyfun.js — 레드 카운티 즐길 거리 (v2.22)
 *
 *  · 고속도로 휴게소 2곳: 주유·정비(차로 들어가면) + 먹거리(걸어서) · 속도 기록 상금 · 순환로 레이스 접수
 *  · 과속 카메라 5대: 고속도로에서 찍히면 속도 기록 + 벌금 (130km/h 넘으면)
 *  · 카운티 순환 고속도로 레이스: 북부 68번 → 동부 연결선 → 남부 68번 → 서부 연결선 한 바퀴, AI 레이서 3대, 베팅
 *  · 금괴 12개: 카운티 곳곳에 숨어 있다 (행크에게 보물 지도를 사면 지도에 표시)
 *  · 블랙 리지 폐광: 곡괭이 채굴 · 다이너마이트 발파 (도박)
 *  · 블랙우드 사냥 대회: 3분 동안 사슴·코요테 사냥
 *  · UFO: 밤(22~4시) 레드 메사 사막 하늘에 떠 있다 — 가까이 가면 목격
 * 건물·땅은 게임 시작 때 WorldEdit(mega.js)로 붙인다 (세계 생성 순서·예전 저장에 영향 없음).
 * ===================================================================== */

const CF_GOLD = [[742, 250], [930, 150], [1030, 60], [1200, 95], [1350, 170], [1295, 335], [1360, 450], [1250, 605], [1060, 612], [900, 560], [770, 400], [1000, 405]];
const CF_CAMS = [[1, 0.7], [5, 0.3], [6, 0.5], [2, 0.5], [0, 0.6]]; // [고속도로 조각, 위치 비율]
const CF_RACE_PATH = [[1, 1], [6, 1], [5, -1], [3, -1]];          // 순환로: 북부 → 동부 연결선 → 남부(서쪽으로) → 서부 연결선(북쪽으로)
FUEL_STATIONS.push('c_rest1', 'c_rest2');

const CountyFun = {
  gold: [], goldMap: false, camBest: {}, claims: {}, raceBest: 0, raceWins: 0, huntBest: 0, ufoSeen: 0, ufoNight: -1,
  applied: false, spots: {}, race: null, hunt: null, camCd: {}, mineCd: 0, ufo: null,
  save() { return { gold: this.gold, goldMap: this.goldMap, camBest: this.camBest, claims: this.claims, raceBest: this.raceBest, raceWins: this.raceWins, huntBest: this.huntBest, ufoSeen: this.ufoSeen, ufoNight: this.ufoNight }; },
  load(o) {
    o = o || {}; this.gold = o.gold || []; this.goldMap = !!o.goldMap; this.camBest = o.camBest || {}; this.claims = o.claims || {};
    this.raceBest = o.raceBest || 0; this.raceWins = o.raceWins || 0; this.huntBest = o.huntBest || 0; this.ufoSeen = o.ufoSeen || 0; this.ufoNight = o.ufoNight ?? -1;
    if (this.race) this.endRace(null); if (this.hunt) this.endHunt(true);
    if (this.applied) this.markGold();
  },

  // ---------- 세계에 붙이기 ----------
  freeRect(cx, cy, w, h, maxR = 10) { // (cx,cy) 타일 근처에서 풀·모래만 있는 w×h 칸
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = Math.round(cx + dx - w / 2), y0 = Math.round(cy + dy - h / 2); let ok = true;
      for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w; x++) { if (x < CITY_W || y < 1 || x >= MW - 1 || y >= MH - 1) { ok = false; break; } const t = World.tiles[tIdx(x, y)]; if (t !== TL.GRASS && t !== TL.SAND) { ok = false; break; } }
      if (ok) return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    }
    return null;
  },
  landNear(tx, ty) { for (let r = 0; r < 30; r++) for (let a = 0; a < 8; a++) { const x = Math.round(tx + Math.cos(a * TAU / 8) * r), y = Math.round(ty + Math.sin(a * TAU / 8) * r); const t = World.tiles[tIdx(clamp(x, 0, MW - 1), clamp(y, 0, MH - 1))]; if (t === TL.GRASS || t === TL.SAND) return { x: (x + 0.5) * T, y: (y + 0.5) * T }; } return { x: tx * T, y: ty * T }; },
  apply() {
    if (this.applied || !World.fwy || !World.county) return; this.applied = true;
    const F = World.fwy, E = WorldEdit, S = this.spots;
    // 휴게소: 북부 68번(북쪽) · 남부 68번(남쪽)
    [[1, 0.36, -1, 'c_rest1', '북부 68번 휴게소'], [5, 0.55, 1, 'c_rest2', '남부 68번 휴게소']].forEach(([si, f, side, key, name]) => {
      const seg = F.segs[si], i = Math.floor(seg.pts.length * f), p = seg.pts[i], nx = -p.ty * side, ny = p.tx * side, off = FWY_HW + 30;
      const L = this.freeRect((p.x + nx * off) / T, (p.y + ny * off) / T, 14, 9); if (!L) return;
      E.tiles(L.x0, L.y0, L.x1, L.y1, () => TL.LOT);
      World.trees = World.trees.filter(t => !(t.x >= L.x0 * T - 2 && t.x <= (L.x1 + 1) * T + 2 && t.y >= L.y0 * T - 2 && t.y <= (L.y1 + 1) * T + 2));
      // 가게는 고속도로 반대편 가장자리
      const by0 = ny > 0 ? L.y1 - 3 : L.y0, bx0 = L.x0 + 1;
      E.building(bx0, by0, bx0 + 5, by0 + 3, 6, 'shop', '#d9c7a0', name);
      const cx = (L.x0 + 7) * T, cy = (L.y0 + L.y1 + 1) / 2 * T;
      E.place(key, cx, cy, name + ' 주유소', 'fuelstop', '油', '#ffb400');
      E.place(key + 'f', (bx0 + 3) * T, (ny > 0 ? by0 - 0.8 : by0 + 4.8) * T, name, 'reststop', '休', '#ffb400');
      S[key] = { seg: si, i, L, name };
      World.mapLabels.push({ name: '휴게소', x: cx, y: cy - 20, small: true });
      E.touch(L.x0 - 1, L.y0 - 1, L.x1 + 1, L.y1 + 1);
    });
    // 폐광 (블랙 리지 서쪽 기슭)
    { const L = this.freeRect(1204, 300, 5, 4, 12); if (L) { E.tiles(L.x0 - 1, L.y0 - 1, L.x1 + 1, L.y1 + 1, () => TL.SAND); E.building(L.x0, L.y0, L.x1, L.y0 + 2, 5, 'warehouse', '#5a4632', '블랙 리지 폐광'); E.place('c_mine', (L.x0 + 2.5) * T, (L.y1 + 1.2) * T, '블랙 리지 폐광', 'mine', '鑛', '#c9a26b'); World.mapLabels.push({ name: '폐광', x: (L.x0 + 2) * T, y: (L.y0 - 3) * T, small: true }); E.touch(L.x0 - 2, L.y0 - 2, L.x1 + 2, L.y1 + 2); } }
    // 사냥 오두막 (블랙우드 숲)
    { const L = this.freeRect(1172, 118, 5, 4, 14); if (L) { E.building(L.x0, L.y0, L.x1, L.y0 + 2, 5, 'house', '#6b4a2e', '블랙우드 사냥 오두막'); E.place('c_hunt', (L.x0 + 2.5) * T, (L.y1 + 1.2) * T, '블랙우드 사냥 오두막', 'hunt', '獵', '#7fbf5f'); S.hunt = L; World.mapLabels.push({ name: '사냥터', x: (L.x0 + 2) * T, y: (L.y0 - 3) * T, small: true }); E.touch(L.x0 - 1, L.y0 - 1, L.x1 + 1, L.y1 + 1); } }
    // 과속 카메라
    S.cams = CF_CAMS.map(([si, f], k) => { const seg = F.segs[si], p = seg.pts[Math.floor(seg.pts.length * f)]; return { k, x: p.x, y: p.y, px: p.x - p.ty * (FWY_HW + 1.6), py: p.y + p.tx * (FWY_HW + 1.6), a: Math.atan2(p.ty, p.tx), name: `${seg.name} 카메라` }; });
    // 금괴 · UFO 자리
    S.gold = CF_GOLD.map(([x, y]) => this.landNear(x, y));
    S.ufo = this.landNear(760, 515);
    this.markGold();
  },
  markGold() {
    const S = this.spots; if (!S.gold) return;
    S.gold.forEach((g, k) => { const key = 'gold' + k; if (this.goldMap && !this.gold[k]) { World.places[key] = { x: g.x, y: g.y, label: '금괴' }; if (!EXTRA_ICONS.some(e => e.key === key)) EXTRA_ICONS.push({ key, ch: '金', c: '#ffd700', label: '금괴 (보물 지도)' }); } else { delete World.places[key]; const j = EXTRA_ICONS.findIndex(e => e.key === key); if (j >= 0) EXTRA_ICONS.splice(j, 1); } });
  },

  // ---------- 매 프레임 ----------
  update(dt) {
    const P = Game.player; if (!P || !World.county) return;
    this.apply(); if (!this.applied) return;
    const S = this.spots, car = P.car, px = P.px, py = P.py;
    this.mineCd -= dt;
    // 금괴
    if (S.gold) S.gold.forEach((g, k) => {
      if (this.gold[k] || Math.abs(g.x - px) > 4 || Math.abs(g.y - py) > 4 || dist(g.x, g.y, px, py) > 3.2) return;
      this.gold[k] = 1; P.money += 500000; Sfx.cash(); const n = this.gold.filter(Boolean).length;
      UI.big(`금괴 ${n}/12`, '+$500,000' + (n >= 12 ? ' · 전부 찾았다! 보너스 +$10,000,000' : ''), 2.5, '#ffd700');
      if (n >= 12) P.money += 1e7; this.markGold(); Save.write();
    });
    // 과속 카메라
    if (S.cams && car && car.driver === 'player' && !car.alt) for (const c of S.cams) {
      this.camCd[c.k] = (this.camCd[c.k] || 0) - dt;
      if (this.camCd[c.k] > 0 || dist2(c.x, c.y, car.x, car.y) > (FWY_HW + 4) ** 2) continue;
      this.camCd[c.k] = 6; const kmh = Math.round(car.speed * 3.6); if (kmh < 60) continue;
      const best = this.camBest[c.k] || 0, rec = kmh > best; if (rec) this.camBest[c.k] = kmh;
      const fine = kmh > 130 ? Math.min(100000, (kmh - 130) * 500) : 0; if (fine) P.money = Math.max(0, P.money - fine);
      Sfx.tone && Sfx.tone({ f0: 2400, f1: 2400, dur: 0.06, type: 'square', vol: 0.2 });
      UI.toast(`📸 ${c.name} — ${kmh}km/h${fine ? ` · 과속 벌금 $${fine.toLocaleString()}` : ''}${rec ? ' · 최고 기록!' : ''}`);
    }
    // UFO (밤)
    const h = Game.clock / 60, night = h >= 22 || h < 4, nightId = (Gangs.day || 0) - (h < 4 ? 1 : 0);
    if (S.ufo) {
      if (!this.ufo && night && this.ufoNight !== nightId && dist(px, py, S.ufo.x, S.ufo.y) < 600) this.ufo = { x: S.ufo.x, y: S.ufo.y, alt: 26, t: 0, leave: 0, id: nightId };
      if (this.ufo) {
        const U = this.ufo; U.t += dt;
        if (U.leave > 0) { U.leave += dt; U.alt += dt * (20 + U.leave * 60); U.x += dt * 30; if (U.leave > 4) this.ufo = null; }
        else {
          U.x = S.ufo.x + Math.sin(U.t * 0.3) * 18; U.y = S.ufo.y + Math.cos(U.t * 0.23) * 12;
          if (!night) this.ufo.leave = 0.01;
          else if (dist(px, py, U.x, U.y) < 34) this.sightUfo();
        }
      }
    }
    this.updateRace(dt); this.updateHunt(dt);
    if (View3D.scene) this.ufo3D();
  },
  sightUfo() {
    const U = this.ufo, first = !this.ufoSeen; U.leave = 0.01; this.ufoNight = U.id; this.ufoSeen++;
    const P = Game.player, pay = first ? 3000000 : 300000; P.money += pay;
    Cam.shake = Math.max(Cam.shake, 0.6);
    Cutscene.play([['???', '…머리 위에서 낮은 웅웅거림이 들린다.'], ['네온 하버', first ? '빛나는 원반이 사막 위에 떠 있다. 휴대폰 카메라가 저절로 켜졌다.' : '또 그 원반이다. 이번엔 사진을 제대로 찍었다.'], ['네온 뉴스', first ? `레드 카운티 UFO 사진 단독 입수! 제보자에게 사례금 $${pay.toLocaleString()}` : `타블로이드가 UFO 사진을 $${pay.toLocaleString()}에 샀다`]], () => { });
    Save.write();
  },
  ufo3D() {
    const U = this.ufo;
    if (!this.u3) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 8), new THREE.MeshLambertMaterial({ color: 0x9aa4b2 })); disc.scale.y = 0.22; g.add(disc);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.8 })); dome.position.y = 0.8; g.add(dome);
      const lights = []; for (let k = 0; k < 10; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dff6a })); l.position.set(Math.cos(k / 10 * TAU) * 6.2, -0.4, Math.sin(k / 10 * TAU) * 6.2); g.add(l); lights.push(l); }
      const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 26, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfffb0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = -13; g.add(beam);
      View3D.scene.add(g); this.u3 = { g, lights, beam };
    }
    const u = this.u3; u.g.visible = !!U; if (!U) return;
    u.g.position.set(U.x, U.alt + Math.sin(U.t * 1.7) * 0.8, U.y); u.g.rotation.y = U.t * 1.2;
    u.lights.forEach((l, k) => l.material.color.setHex((k + Math.floor(U.t * 8)) % 3 ? 0x7dff6a : 0xff4fd8));
    u.beam.visible = !U.leave;
  },
  props() {
    const out = [], S = this.spots; if (!this.applied) return out;
    if (S.cams) for (const c of S.cams) { out.push({ x: c.px, y: c.py, w: 0.35, d: 0.35, h: 6.5, c: '#8a8f98' }, { x: c.px, y: c.py, w: 1.2, d: 0.7, h: 0.8, z: 6.2, c: '#e8e8e8' }); }
    if (S.gold) S.gold.forEach((g, k) => { if (!this.gold[k]) out.push({ x: g.x, y: g.y, w: 0.8, d: 0.4, h: 0.32, c: '#ffd700', glow: true }); });
    const U = this.ufo; if (U) out.push({ x: U.x, y: U.y, no3d: true, draw: c => { c.fillStyle = 'rgba(191,255,176,0.18)'; c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill(); c.fillStyle = '#9aa4b2'; c.beginPath(); c.ellipse(0, 0, 7, 7, 0, 0, TAU); c.fill(); c.fillStyle = '#8ff7ff'; c.beginPath(); c.arc(0, 0, 2.6, 0, TAU); c.fill(); for (let k = 0; k < 10; k++) { c.fillStyle = (k + Math.floor(U.t * 8)) % 3 ? '#7dff6a' : '#ff4fd8'; c.fillRect(Math.cos(k / 10 * TAU) * 6 - 0.4, Math.sin(k / 10 * TAU) * 6 - 0.4, 0.8, 0.8); } } });
    const R = this.race; if (R && R.cps[R.cp]) for (const [j, col] of [[R.cp, '#ff4fd8'], [R.cp + 1, '#8a4f86']]) { const q = R.cps[j]; if (!q) continue; for (const s of [-1, 1]) out.push({ x: q.x - q.ty * s * (FWY_HW + 1), y: q.y + q.tx * s * (FWY_HW + 1), w: 0.8, d: 0.8, h: j === R.cps.length - 1 ? 9 : 6, c: j === R.cps.length - 1 ? '#f2f2f2' : col, glow: true }); }
    return out;
  },

  // ---------- 순환로 레이스 ----------
  raceCps(si, i0) { // 휴게소 옆에서 출발 → 한 바퀴 → 같은 자리 도착
    const F = World.fwy, pi = CF_RACE_PATH.findIndex(p => p[0] === si), out = [];
    for (let k = 0; k <= CF_RACE_PATH.length; k++) {
      const [sid, d] = CF_RACE_PATH[(pi + k) % CF_RACE_PATH.length], seg = F.segs[sid], n = seg.pts.length;
      const idxs = []; for (let s = 0; s < n; s++) idxs.push(d > 0 ? s : n - 1 - s);
      for (const i of idxs) {
        const onStart = k === 0, onEnd = k === CF_RACE_PATH.length;
        if (onStart && (d > 0 ? i < i0 + 40 : i > i0 - 40)) continue; if (onEnd && (d > 0 ? i > i0 : i < i0)) continue;
        if (!out.length || Math.hypot(seg.pts[i].x - out[out.length - 1].x, seg.pts[i].y - out[out.length - 1].y) > 230) { const p = seg.pts[i]; out.push({ x: p.x, y: p.y, tx: p.tx * d, ty: p.ty * d }); }
      }
    }
    const S = F.segs[si], e = S.pts[i0]; const d0 = CF_RACE_PATH[pi][1]; out.push({ x: e.x, y: e.y, tx: e.tx * d0, ty: e.ty * d0 });
    return out;
  },
  startRace(key, bet) {
    const P = Game.player, S = this.spots[key]; if (!S || this.race) return;
    if (P.money < bet) { UI.toast('베팅할 돈이 모자라다'); return; }
    if (Missions.active) Missions.abort('레이스에 나가느라 미션을 잠시 내려놓는다'); if (Jobs.active) Jobs.stop('레이스 출전');
    P.money -= bet; Shop.close();
    const F = World.fwy, pi = CF_RACE_PATH.findIndex(p => p[0] === S.seg), d = CF_RACE_PATH[pi][1], seg = F.segs[S.seg];
    const i0 = clamp(S.i + d * 12, 2, seg.pts.length - 3), R = this.race = { key, bet, t: -3.5, cp: 0, cps: this.raceCps(S.seg, i0), rivals: [], cars: [] };
    for (const q of Game.cars) if (!q.persistent && q.ai && dist(q.x, q.y, seg.pts[i0].x, seg.pts[i0].y) < 90) q.remove = true;
    const put = (c, back, lane) => { const i = clamp(i0 - d * back, 1, seg.pts.length - 2), q = Fwy.lanePt(seg, i, d, lane), p = seg.pts[i]; c.x = q.x; c.y = q.y; c.a = Math.atan2(p.ty * d, p.tx * d); c.vx = c.vy = 0; return i; };
    let car = P.car && !P.car.V.special && !P.car.dead ? P.car : null;
    if (!car) { car = new Car('super', seg.pts[i0].x, seg.pts[i0].y, 0, { persistent: true }); Game.cars.push(car); if (P.car) exitCar(P, true); putPlayerIn(car); R.cars.push(car); }
    put(car, 0, 1); R.car = car;
    ['super', 'sports', 'muscle'].forEach((ty, k) => {
      const c = new Car(ty, 0, 0, 0, { persistent: true }); c.driver = 'ai'; c.driverKind = 'racer'; Game.cars.push(c); R.cars.push(c);
      const i = put(c, k === 0 ? 0 : 3, k === 0 ? 0 : k % 2);
      Fwy.join(c, { seg: S.seg, i, dir: d, lane: k === 0 ? 0 : k % 2 }); Object.assign(c.ai.fw, { path: CF_RACE_PATH, pi, vmul: 1.75 + k * 0.08 }); c.ai.panic = true; c.ai.cruiseFlee = 52 + k * 3 + rand(0, 3);
      c.ai.route = []; Fwy.plan(c);
      R.rivals.push({ car: c, cp: 0, name: ['블레이즈', '스네이크', '토니'][k], done: 0 });
    });
    UI.big('카운티 순환 고속도로 레이스', `베팅 $${bet.toLocaleString()} · 체크포인트 ${R.cps.length}곳 · 한 바퀴 약 ${Math.round(R.cps.length * 0.23)}km`, 3, '#ff4fd8');
  },
  updateRace(dt) {
    const R = this.race; if (!R) return; const P = Game.player;
    R.t += dt;
    if (R.t < 0) { for (const c of R.cars.concat(R.car ? [R.car] : [])) { c.vx = c.vy = 0; if (c.in) { c.in.thr = 0; c.in.brk = 1; } } if (Math.ceil(R.t) !== R.cd) { R.cd = Math.ceil(R.t); if (R.cd > 0) UI.big(String(R.cd), '', 0.8, '#ff4fd8'); } return; }
    if (!R.go) { R.go = true; UI.big('출발!', '', 0.8, '#9be15d'); }
    const hit = (x, y, q) => dist(x, y, q.x, q.y) < FWY_HW + 8;
    for (const r of R.rivals) { const q = R.cps[r.cp]; if (q && r.car && !r.car.dead && hit(r.car.x, r.car.y, q)) { r.cp++; if (r.cp >= R.cps.length && !r.done) r.done = R.t; } }
    const q = R.cps[R.cp]; if (q) Game.waypoint = { x: q.x, y: q.y };
    if (q && hit(P.px, P.py, q)) { R.cp++; Sfx.tone && Sfx.tone({ f0: 900, f1: 1300, dur: 0.12, type: 'sine', vol: 0.25 }); if (R.cp >= R.cps.length) return this.endRace(true); }
    if (!P.car || P.car.dead) { R.off = (R.off || 0) + dt; if (R.off > 10) return this.endRace(false); } else R.off = 0;
    if (R.t > 600) this.endRace(false);
  },
  racePos() { const R = this.race, P = Game.player, me = R.cp, md = R.cps[R.cp] ? dist(P.px, P.py, R.cps[R.cp].x, R.cps[R.cp].y) : 0; return 1 + R.rivals.filter(r => r.cp > me || (r.cp === me && r.car && R.cps[r.cp] && dist(r.car.x, r.car.y, R.cps[r.cp].x, R.cps[r.cp].y) < md)).length; },
  endRace(done) {
    const R = this.race; if (!R) return; const P = Game.player;
    const pos = done ? this.racePos() : 4; this.race = null; Game.waypoint = null;
    for (const c of R.cars) if (c !== P.car) { c.persistent = false; if (c.ai && c.ai.fw) { c.ai.fw.path = null; c.ai.fw.vmul = 0; c.ai.panic = false; c.ai.cruise = 26; } }
    if (done === null) return;
    if (!done) { UI.big('레이스 실격', '차에서 내렸거나 시간이 너무 걸렸다', 3, '#ff4d4d'); return; }
    const mult = [3, 1.5, 0.5, 0][pos - 1], pay = Math.round(R.bet * mult) + (pos === 1 ? 50000 : 0); P.money += pay;
    if (!this.raceBest || R.t < this.raceBest) this.raceBest = R.t; if (pos === 1) this.raceWins++;
    UI.big(`${pos}위 · ${R.t.toFixed(1)}초`, pay ? `상금 +$${pay.toLocaleString()}` : '상금 없음', 4, pos === 1 ? '#ffd700' : '#ff4fd8'); Save.write();
  },

  // ---------- 사냥 대회 ----------
  startHunt() {
    const P = Game.player, L = this.spots.hunt; if (!L || this.hunt) return;
    if (P.money < 5000) return; P.money -= 5000; Shop.close();
    giveWeapon(P, 'rifle', 60); P.weapon = 'rifle';
    const cx = (L.x0 + 2) * T, cy = (L.y0 + 2) * T, list = [];
    for (let k = 0; k < 14; k++) { for (let tr = 0; tr < 20; tr++) { const a = rand(0, TAU), r = rand(50, 170), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, t = tileAt(x, y); if (t === TL.GRASS || t === TL.SAND) { const p = spawnAnimal(k % 3 ? 'deer' : 'coyote', x, y); p.persistent = true; list.push(p); break; } } }
    this.hunt = { t: 180, list, kills: 0, cx, cy };
    UI.big('블랙우드 사냥 대회', '3분 · 사슴·코요테 한 마리 $40,000 · 소총 지급', 3, '#7fbf5f');
  },
  updateHunt(dt) {
    const H = this.hunt; if (!H) return; H.t -= dt;
    for (const p of H.list) if (p.dead && !p.counted) { p.counted = true; H.kills++; Game.player.money += 40000; Sfx.cash(); UI.toast(`사냥 ${H.kills}마리 · +$40,000`); }
    if (H.t <= 0 || (H.list.length && H.list.every(p => p.dead))) this.endHunt(false);
  },
  endHunt(silent) {
    const H = this.hunt; if (!H) return; this.hunt = null;
    for (const p of H.list) { p.persistent = false; if (!p.dead) p.remove = true; }
    if (silent) return;
    const bonus = H.kills >= 10 ? 500000 : H.kills >= 6 ? 150000 : 0; Game.player.money += bonus;
    if (H.kills > this.huntBest) this.huntBest = H.kills;
    UI.big(`사냥 대회 끝 — ${H.kills}마리`, `${bonus ? `명사수 보너스 +$${bonus.toLocaleString()} · ` : ''}최고 기록 ${this.huntBest}마리`, 4, '#7fbf5f'); Save.write();
  },
  hud() {
    const R = this.race, H = this.hunt, out = [];
    if (R) out.push(R.t < 0 ? '카운티 순환 고속도로 레이스 — 준비' : `순환로 레이스 ${this.racePos()}/4위 · 체크포인트 ${R.cp}/${R.cps.length} · ${R.t.toFixed(1)}초`);
    if (H) out.push(`사냥 대회 ${H.kills}마리 · 남은 시간 ${Math.ceil(H.t)}초`);
    return out.join('\n');
  },
};
SaveExt.mods.countyfun = CountyFun;
Props.providers.push(() => CountyFun.props());
{ const _h = Races.hud.bind(Races); Races.hud = () => [_h(), CountyFun.hud()].filter(Boolean).join('\n') || null; }

// ---------- 창 ----------
SHOPS.reststop = {
  title: '고속도로 휴게소', get sub() { const b = Object.values(CountyFun.camBest); return `과속 카메라 최고 ${b.length ? Math.max(...b) : 0}km/h · 순환로 최고 ${CountyFun.raceBest ? CountyFun.raceBest.toFixed(1) + '초' : '-'} · 우승 ${CountyFun.raceWins}회`; },
  items: () => {
    const P = Game.player, key = (Shop.placeKey || 'c_rest1f').replace(/f$/, ''), best = Math.max(0, ...Object.values(CountyFun.camBest)), out = [];
    out.push({ id: 'snack', name: '호두과자', price: 30, btn: '먹기', desc: '체력 +25', ok: () => P.money >= 30, fn: () => { P.money -= 30; P.hp = Math.min(P.maxHp, P.hp + 25); UI.toast('따끈한 호두과자!'); } });
    out.push({ id: 'udon', name: '휴게소 우동', price: 80, btn: '먹기', desc: '체력 가득', ok: () => P.money >= 80, fn: () => { P.money -= 80; P.hp = P.maxHp; UI.toast('국물이 끝내준다'); } });
    out.push({ id: 'coffee', name: '졸음 쉼터 커피', price: 15, btn: '마시기', desc: '졸음운전 금지!', ok: () => P.money >= 15, fn: () => { P.money -= 15; UI.toast('정신이 번쩍 든다'); } });
    for (const [v, pay] of [[200, 200000], [300, 1000000], [400, 5000000]]) out.push({ id: 'rec' + v, name: `속도 기록 상금: ${v}km/h${CountyFun.claims[v] ? ' (받음)' : ''}`, price: 0, btn: '받기', desc: `과속 카메라에 ${v}km/h 이상 찍히면 +$${pay.toLocaleString()} · 지금 최고 ${best}km/h`, ok: () => best >= v && !CountyFun.claims[v], fn: () => { CountyFun.claims[v] = 1; P.money += pay; Sfx.cash(); UI.big('속도 기록 상금', `+$${pay.toLocaleString()}`, 2.5, '#ffd700'); Save.write(); Shop.open('reststop'); } });
    for (const b of [100000, 1000000, 10000000]) out.push({ id: 'race' + b, name: `순환 고속도로 레이스 — $${b.toLocaleString()} 걸기`, price: b, btn: '출전', desc: `AI 레이서 3대 · 1위 ×3 + $50,000 · 2위 ×1.5 · 3위 ×0.5 · 한 바퀴 약 7km`, ok: () => P.money >= b && !CountyFun.race, fn: () => CountyFun.startRace(key, b) });
    out.push({ id: 'board', name: '과속 카메라 기록판', price: 0, btn: '보기', desc: CountyFun.spots.cams ? CountyFun.spots.cams.map(c => `${c.k + 1}번 ${CountyFun.camBest[c.k] || 0}`).join(' · ') + ' (km/h)' : '-', ok: () => true, fn: () => { } });
    return out;
  },
};
SHOPS.mine = {
  title: '블랙 리지 폐광', sub: '1890년대 은광. 아직 금맥이 남아 있다는 소문이…',
  items: () => {
    const P = Game.player, cd = CountyFun.mineCd;
    return [
      { id: 'pick', name: '곡괭이로 캐기', price: 0, btn: cd > 0 ? `${Math.ceil(cd)}초` : '캐기', desc: '금 조각 $50,000~$400,000 (1분마다)', ok: () => CountyFun.mineCd <= 0, fn: () => { CountyFun.mineCd = 60; if (chance(0.75)) { const v = Math.round(rand(5, 40)) * 10000; P.money += v; Sfx.cash(); UI.toast(`금 조각! +$${v.toLocaleString()}`); } else UI.toast('돌뿐이다…'); Shop.open('mine'); } },
      { id: 'tnt', name: '다이너마이트 발파', price: 200000, btn: '발파', desc: '40% 확률로 금맥 $1,000,000~$2,500,000 · 실패하면 돈만 날린다', ok: () => P.money >= 200000, fn: () => { P.money -= 200000; Cam.shake = Math.max(Cam.shake, 1); Sfx.explode && Sfx.explode(P.px, P.py, 2); if (chance(0.4)) { const v = Math.round(rand(100, 250)) * 10000; P.money += v; UI.big('금맥 발견!', `+$${v.toLocaleString()}`, 2.5, '#ffd700'); } else UI.big('쾅!', '먼지만 가득하다', 1.8, '#c9a26b'); Shop.open('mine'); } },
    ];
  },
};
SHOPS.hunt = {
  title: '블랙우드 사냥 오두막', get sub() { return `사냥 대회 최고 기록 ${CountyFun.huntBest}마리 · 10마리 이상이면 보너스 $500,000`; },
  items: () => [{ id: 'hunt', name: '사냥 대회 참가 (3분)', price: 5000, btn: '참가', desc: '사슴·코요테 한 마리 $40,000 · 소총과 탄약 지급 · 6마리 이상 보너스', ok: () => Game.player.money >= 5000 && !CountyFun.hunt, fn: () => CountyFun.startHunt() }],
};
// 행크: 보물 지도
{ const _i = SHOPS.hank.items; SHOPS.hank.items = function () { const l = _i.call(this); const n = CountyFun.gold.filter(Boolean).length; l.push({ id: 'goldmap', name: `보물 지도 — 금괴 12개 위치${CountyFun.goldMap ? ' (가지고 있음)' : ''}`, price: CountyFun.goldMap ? 0 : 250000, btn: CountyFun.goldMap ? '✓' : '구입', desc: `찾은 금괴 ${n}/12 · 하나에 $500,000, 전부 찾으면 +$10,000,000`, ok: () => !CountyFun.goldMap && Game.player.money >= 250000, fn: () => { Game.player.money -= 250000; CountyFun.goldMap = true; CountyFun.markGold(); UI.toast('지도에 금괴 위치가 표시됐다 (金)'); Save.write(); Shop.open('hank'); } }); return l; }; }

ACH.push(
  ['gold12', '금괴 사냥꾼', '레드 카운티의 금괴 12개를 모두 찾았다', () => CountyFun.gold.filter(Boolean).length >= 12],
  ['ufo', '그들은 있다', '레드 메사 사막에서 UFO를 목격했다', () => CountyFun.ufoSeen > 0],
  ['speed300', '과속의 신', '과속 카메라에 300km/h 이상 찍혔다', () => Math.max(0, ...Object.values(CountyFun.camBest)) >= 300],
  ['fwyrace', '순환로의 왕', '카운티 순환 고속도로 레이스 1위', () => CountyFun.raceWins > 0],
  ['hunter', '명사수', '사냥 대회에서 10마리 이상 잡았다', () => CountyFun.huntBest >= 10],
);
