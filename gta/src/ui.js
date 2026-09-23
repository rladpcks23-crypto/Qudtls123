'use strict';
/* =====================================================================
 * ui.js — HUD(레이더, 돈, 체력, 수배 별), 자막, 전체 지도, 메뉴, 터치 조작
 * ===================================================================== */

const FONT_NUM = '"Bebas Neue", "Oswald", Impact, sans-serif';
const FONT_KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FONT_DISP = '"Black Han Sans", "Noto Sans KR", sans-serif';

const UI = {
  toasts: [], bigQ: [], bigCur: null, dialogQ: [], dialogCur: null, objText: '', objT: 0,
  station: null, stationT: 0, districtName: '', districtT: 0, carName: '', carT: 0,
  weaponFlash: 0, starPulse: 0, s: 1,
  toast(msg) { if (this.toasts.length && this.toasts[this.toasts.length - 1].msg === msg) { this.toasts[this.toasts.length - 1].t = 4; return; } this.toasts.push({ msg, t: 4.2 }); if (this.toasts.length > 3) this.toasts.shift(); },
  big(title, sub, dur = 3, col = '#f2c14e') { this.bigQ.push({ title, sub, t: dur, max: dur, col }); },
  dialog(lines) { for (const [who, text] of lines) this.dialogQ.push({ who, text, t: Math.max(3.2, text.length * 0.09) }); },
  objective(text) { this.objText = text; this.objT = text ? 6 : 0; },
  showStation(st) { this.station = st; this.stationT = 3; },
  district(n) { this.districtName = n; this.districtT = 3.5; },
  car(n) { this.carName = n; this.carT = 3; },
  update(dt) {
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter(t => t.t > 0);
    if (!this.bigCur && this.bigQ.length) this.bigCur = this.bigQ.shift();
    if (this.bigCur) { this.bigCur.t -= dt; if (this.bigCur.t <= 0) this.bigCur = null; }
    if (!this.dialogCur && this.dialogQ.length) this.dialogCur = this.dialogQ.shift();
    if (this.dialogCur) { this.dialogCur.t -= dt; if (this.dialogCur.t <= 0) this.dialogCur = null; }
    this.objT -= dt; this.stationT -= dt; this.districtT -= dt; this.carT -= dt; this.weaponFlash -= dt; this.starPulse -= dt;
    const P = Game.player;
    if (P) P.displayMoney += (P.money - P.displayMoney) * Math.min(1, dt * 6) + sign(P.money - P.displayMoney) * 0.5;
    if (P && Math.abs(P.money - P.displayMoney) < 1) P.displayMoney = P.money;
  },
};

function txt(c, s, x, y, font, fill, stroke = 'rgba(0,0,0,0.85)', lw = 4, align = 'left', base = 'alphabetic') {
  c.font = font; c.textAlign = align; c.textBaseline = base;
  if (stroke) { c.lineJoin = 'round'; c.strokeStyle = stroke; c.lineWidth = lw; c.strokeText(s, x, y); }
  c.fillStyle = fill; c.fillText(s, x, y);
}
function wrapLines(c, s, maxW) {
  const out = []; let line = '';
  for (const ch of s.split(' ')) {
    const test = line ? line + ' ' + ch : ch;
    if (c.measureText(test).width > maxW && line) { out.push(line); line = ch; } else line = test;
  }
  if (line) out.push(line);
  return out;
}

function drawHUD(dt) {
  const c = ctx, P = Game.player;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = UI.s = clamp(Math.min(CW, CH) / 760, 0.62, 1.15);
  const pad = 16 * s + 4;
  const topInset = 8;
  // ---- 우상단: 시계 / 무기 / 돈 / 체력 / 별 ----
  let x = CW - pad, y = pad + topInset;
  const hh = Math.floor(Game.clock / 60), mm = Math.floor(Game.clock % 60);
  txt(c, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, x, y + 22 * s, `${24 * s}px ${FONT_NUM}`, '#e9eef5', 'rgba(0,0,0,0.8)', 4, 'right');
  // 무기 박스
  const bw = 62 * s, bx = x - bw, by = y + 30 * s;
  c.fillStyle = 'rgba(12,14,20,0.55)'; roundRect(c, bx, by, bw, bw, 10 * s); c.fill();
  c.strokeStyle = UI.weaponFlash > 0 ? '#f2c14e' : 'rgba(255,255,255,0.25)'; c.lineWidth = 2; c.stroke();
  c.save(); c.translate(bx + bw / 2, by + bw / 2 - 5 * s); drawWeaponIcon(c, P.weapon, 26 * s, '#f2f2f2'); c.restore();
  const ammo = P.inv[P.weapon];
  if (ammo !== Infinity && ammo !== undefined) txt(c, String(ammo), bx + bw / 2, by + bw - 6 * s, `${16 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 3, 'center');
  // 돈
  const money = '$' + String(Math.max(0, Math.round(P.displayMoney))).padStart(8, '0');
  txt(c, money, bx - 12 * s, by + 34 * s, `${38 * s}px ${FONT_NUM}`, '#8df28d', 'rgba(8,30,10,0.95)', 5, 'right');
  // 체력/방어
  const barW = 150 * s, barH = 9 * s, barX = bx - 12 * s - barW, barY = by + 44 * s;
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  c.fillStyle = '#5a1a1a'; c.fillRect(barX, barY, barW, barH);
  const hpCol = P.hp < 25 && Math.floor(Game.time * 4) % 2 ? '#ff8a80' : '#e0443e';
  c.fillStyle = hpCol; c.fillRect(barX, barY, barW * clamp(P.hp / P.maxHp, 0, 1), barH);
  if (P.armor > 0) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(barX - 2, barY + barH + 3, barW + 4, barH * 0.7 + 4); c.fillStyle = '#4b8fe8'; c.fillRect(barX, barY + barH + 5, barW * P.armor / 100, barH * 0.7); }
  // 별
  const starR = 11 * s, sy = by + bw + 22 * s;
  const flash = Wanted.stars > 0 && !Wanted.seen && Math.floor(Game.time * 3) % 2;
  for (let i = 0; i < 5; i++) {
    const sx = x - starR - i * starR * 2.3;
    const on = 5 - i <= Wanted.stars;
    const pulse = UI.starPulse > 0 && on ? 1 + Math.sin(UI.starPulse * 20) * 0.15 : 1;
    c.save(); c.translate(sx, sy); c.scale(pulse, pulse);
    drawStar(c, 1.5, 1.5, starR, 'rgba(0,0,0,0.7)');
    drawStar(c, 0, 0, starR, on ? (flash ? '#8fb7ff' : '#f2c14e') : 'rgba(255,255,255,0.18)');
    c.restore();
  }
  // 미션 타이머
  const m = Missions.active;
  let ty = sy + 30 * s;
  if (m && m.timer !== null) {
    const tt = Math.max(0, m.timer), str = `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')}`;
    txt(c, '남은 시간', x - 70 * s, ty, `600 ${13 * s}px ${FONT_KR}`, '#cfd6e0', 'rgba(0,0,0,0.8)', 3, 'right');
    txt(c, str, x, ty + 2 * s, `${28 * s}px ${FONT_NUM}`, tt < 10 ? '#ff6b5a' : '#fff', 'rgba(0,0,0,0.9)', 4, 'right');
    ty += 30 * s;
  }
  if (m && m.def.title.includes('소탕') && m.stage === 1) { txt(c, `처치 ${m.kills}/15`, x, ty + 4 * s, `${24 * s}px ${FONT_NUM}`, '#4fe38a', 'rgba(0,0,0,0.9)', 4, 'right'); }

  // ---- 좌상단: 도움말 박스 ----
  const land = CW > CH;
  let hy = Input.usingTouch ? (land ? 112 : 172) : pad + topInset;
  c.font = `500 ${14 * s}px ${FONT_KR}`;
  for (const t of UI.toasts) {
    const lines = wrapLines(c, t.msg, 300 * s);
    const h = lines.length * 20 * s + 16 * s, w = Math.min(330 * s, Math.max(...lines.map(l => c.measureText(l).width)) + 28 * s);
    c.globalAlpha = clamp(t.t * 2, 0, 1);
    c.fillStyle = 'rgba(8,10,16,0.78)'; roundRect(c, pad, hy, w, h, 8 * s); c.fill();
    c.fillStyle = '#f2c14e'; c.fillRect(pad, hy + 8 * s, 3 * s, h - 16 * s);
    lines.forEach((l, i) => txt(c, l, pad + 14 * s, hy + 22 * s + i * 20 * s, `500 ${14 * s}px ${FONT_KR}`, '#eef2f7', null));
    hy += h + 8 * s; c.globalAlpha = 1;
  }
  if (m && m.objective && UI.objT <= 0) {
    c.font = `600 ${13 * s}px ${FONT_KR}`;
    const w = c.measureText(m.objective).width + 28 * s;
    c.fillStyle = 'rgba(8,10,16,0.55)'; roundRect(c, pad, hy, w, 26 * s, 6 * s); c.fill();
    txt(c, '▸ ' + m.objective, pad + 10 * s, hy + 18 * s, `600 ${13 * s}px ${FONT_KR}`, '#f5d77a', null);
  }

  // ---- 라디오 방송국 ----
  if (UI.stationT > 0 && UI.station) {
    c.globalAlpha = clamp(UI.stationT * 2, 0, 1);
    const stY = Input.usingTouch ? Math.min(250, CH * 0.36) : pad + 30 * s;
    txt(c, UI.station.name, CW / 2, stY, `${30 * s}px ${FONT_DISP}`, '#ffcf5a', 'rgba(0,0,0,0.9)', 5, 'center');
    if (UI.station.sub) txt(c, UI.station.sub, CW / 2, stY + 22 * s, `500 ${14 * s}px ${FONT_KR}`, '#e6e6e6', 'rgba(0,0,0,0.9)', 3, 'center');
    c.globalAlpha = 1;
  }

  // ---- 레이더 ----
  drawRadar(s);

  // ---- 우하단: 지역/차량 이름 ----
  const bottom = Input.usingTouch ? (land ? CH * 0.2 : ty + 36 * s) : CH - pad - 6;
  const dAlign = Input.usingTouch && land ? 'center' : 'right', dX = Input.usingTouch && land ? CW / 2 : CW - pad;
  if (UI.districtT > 0) { c.globalAlpha = clamp(UI.districtT, 0, 1); txt(c, UI.districtName, dX, bottom, `${34 * s}px ${FONT_DISP}`, '#e8f0ff', 'rgba(10,20,40,0.95)', 6, dAlign); c.globalAlpha = 1; }
  if (UI.carT > 0) { c.globalAlpha = clamp(UI.carT, 0, 1); txt(c, UI.carName, dX, bottom + (Input.usingTouch ? 34 : -42) * s, `${24 * s}px ${FONT_DISP}`, '#b9f0ff', 'rgba(10,20,40,0.95)', 5, dAlign); c.globalAlpha = 1; }

  // ---- 자막 / 목표 ----
  let subY = Input.usingTouch ? (land ? CH - 64 : CH - 290) : CH - 120 * s;
  const subW = Input.usingTouch && land ? Math.max(260, CW - 470) : Math.min(CW - 60, 640 * s);
  if (UI.dialogCur) {
    const d = UI.dialogCur;
    c.font = `500 ${18 * s}px ${FONT_KR}`;
    const lines = wrapLines(c, d.text, subW);
    const who = d.who + ': ';
    lines.forEach((l, i) => {
      const yy = subY - (lines.length - 1 - i) * 26 * s;
      if (i === 0) {
        c.font = `700 ${18 * s}px ${FONT_KR}`; const ww = c.measureText(who).width; c.font = `500 ${18 * s}px ${FONT_KR}`; const lw = c.measureText(l).width;
        const x0 = CW / 2 - (ww + lw) / 2;
        txt(c, who, x0, yy, `700 ${18 * s}px ${FONT_KR}`, d.who === '도움말' ? '#8fd3ff' : '#f2c14e', 'rgba(0,0,0,0.9)', 4);
        txt(c, l, x0 + ww, yy, `500 ${18 * s}px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 4);
      } else txt(c, l, CW / 2, yy, `500 ${18 * s}px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'center');
    });
    subY += 34 * s;
  }
  if (UI.objT > 0 && UI.objText) {
    c.globalAlpha = clamp(UI.objT, 0, 1);
    txt(c, UI.objText, CW / 2, subY, `700 ${19 * s}px ${FONT_KR}`, '#f5d77a', 'rgba(0,0,0,0.9)', 4, 'center');
    c.globalAlpha = 1;
  }

  // ---- 화면 밖 목표 화살표 ----
  const tg = Missions.targets()[0];
  if (tg && !onScreen(tg.x, tg.y, -4)) {
    const [sx, sy2] = toScreen(tg.x, tg.y);
    const ang = Math.atan2(sy2 - CH / 2, sx - CW / 2);
    const mX = CW / 2 - 60 * s, mY = CH / 2 - 70 * s;
    const k = Math.min(Math.abs(mX / Math.cos(ang)), Math.abs(mY / Math.sin(ang)));
    const ax = CW / 2 + Math.cos(ang) * k, ay = CH / 2 + Math.sin(ang) * k;
    c.save(); c.translate(ax, ay); c.rotate(ang);
    c.fillStyle = tg.c; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(16 * s, 0); c.lineTo(-10 * s, -11 * s); c.lineTo(-5 * s, 0); c.lineTo(-10 * s, 11 * s); c.closePath(); c.stroke(); c.fill();
    c.restore();
    const dd = Math.round(dist(P.px, P.py, tg.x, tg.y));
    txt(c, `${dd}m`, ax - Math.cos(ang) * 26 * s, ay - Math.sin(ang) * 26 * s + 5 * s, `${15 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 3, 'center');
  }

  // ---- 큰 글자 ----
  if (UI.bigCur) {
    const b = UI.bigCur, a = clamp(Math.min(b.t, b.max - b.t) * 3, 0, 1);
    c.globalAlpha = a;
    txt(c, b.title, CW / 2, CH * 0.36, `${52 * s}px ${FONT_DISP}`, b.col, 'rgba(0,0,0,0.95)', 8, 'center');
    if (b.sub) txt(c, b.sub, CW / 2, CH * 0.36 + 40 * s, `600 ${20 * s}px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'center');
    c.globalAlpha = 1;
  }
  // 체포 게이지
  if (Wanted.bustT > 0.1 && Game.state === 'play') {
    const w = 160 * s;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(CW / 2 - w / 2, CH * 0.62, w, 10 * s);
    c.fillStyle = '#4b8fe8'; c.fillRect(CW / 2 - w / 2, CH * 0.62, w * clamp(Wanted.bustT / 1.3, 0, 1), 10 * s);
    txt(c, '체포 중! 벗어나라', CW / 2, CH * 0.62 - 8 * s, `700 ${15 * s}px ${FONT_KR}`, '#bcd6ff', 'rgba(0,0,0,0.9)', 3, 'center');
  }
  // 조준점
  if (!Input.usingTouch && !Pad.active && !P.car && Game.state === 'play' && P.weapon !== 'fist') {
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5;
    const mx = Input.mouse.x, my = Input.mouse.y;
    c.beginPath(); c.arc(mx, my, 9, 0, TAU); c.moveTo(mx - 14, my); c.lineTo(mx - 5, my); c.moveTo(mx + 5, my); c.lineTo(mx + 14, my); c.moveTo(mx, my - 14); c.lineTo(mx, my - 5); c.moveTo(mx, my + 5); c.lineTo(mx, my + 14); c.stroke();
  }
}

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

function placeIcons() {
  const out = [];
  const pl = World.places;
  if (pl.hospital) out.push({ x: pl.hospital.x, y: pl.hospital.y, ch: 'H', c: '#e0443e', label: '병원' });
  if (pl.clinic) out.push({ x: pl.clinic.x, y: pl.clinic.y, ch: 'H', c: '#e0443e', label: '의원' });
  if (pl.police) out.push({ x: pl.police.x, y: pl.police.y, ch: 'P', c: '#4b8fe8', label: '경찰서' });
  if (pl.ammu) out.push({ x: pl.ammu.x, y: pl.ammu.y, ch: '총', c: '#ff6b5a', label: '총포상' });
  if (pl.spray) out.push({ x: pl.spray.x, y: pl.spray.y, ch: 'S', c: '#6fe0ff', label: '페인트샵' });
  if (pl.spray2) out.push({ x: pl.spray2.x, y: pl.spray2.y, ch: 'S', c: '#6fe0ff', label: '페인트샵' });
  if (pl.garage) out.push({ x: pl.garage.x, y: pl.garage.y, ch: 'G', c: '#f2c14e', label: '차고' });
  return out;
}

function drawRadar(s) {
  const c = ctx, P = Game.player;
  const R = (Input.usingTouch ? 62 : 80) * s;
  const pad = 16 * s + 4;
  const cx = pad + R, cy = Input.usingTouch ? pad + R + 8 : CH - pad - R;
  const span = P.car ? 230 + P.car.speed * 3 : 190; // 레이더 지름(m)
  const k = (R * 2) / span;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.closePath();
  c.fillStyle = '#0f2a3d'; c.fill();
  c.clip();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = 0.92;
  c.drawImage(World.mini, 0, 0, MW, MH, cx - P.px * k, cy - P.py * k, MW * T * k, MH * T * k);
  c.globalAlpha = 1; c.imageSmoothingEnabled = true;
  // 수색 원
  if (Wanted.stars > 0 && !Wanted.seen) {
    c.fillStyle = 'rgba(224,68,62,0.22)'; c.strokeStyle = 'rgba(255,90,80,0.8)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx + (Wanted.lkpX - P.px) * k, cy + (Wanted.lkpY - P.py) * k, Wanted.radius * k, 0, TAU); c.fill(); c.stroke();
  }
  const put = (x, y, fn, clampEdge) => {
    let dx = (x - P.px) * k, dy = (y - P.py) * k;
    const d = Math.hypot(dx, dy);
    if (d > R - 7) { if (!clampEdge) return; dx *= (R - 7) / d; dy *= (R - 7) / d; }
    fn(cx + dx, cy + dy);
  };
  // 경찰
  const fl = Math.floor(Game.time * 4) % 2;
  for (const car of Game.cars) if (car.driverKind === 'cop' && !car.dead && car.driver === 'ai') put(car.x, car.y, (x, y) => { c.fillStyle = car.siren ? (fl ? '#ff3b3b' : '#4b8fe8') : '#4b8fe8'; c.fillRect(x - 3, y - 3, 6, 6); });
  for (const p of Game.peds) if ((p.kind === 'cop' || p.kind === 'swat') && !p.dead && p.state === 'chase') put(p.x, p.y, (x, y) => { c.fillStyle = fl ? '#ff3b3b' : '#4b8fe8'; c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill(); });
  if (Police.heli && !Police.heli.dead) put(Police.heli.x, Police.heli.y, (x, y) => { c.fillStyle = '#fff'; c.font = `bold ${11 * s}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('✚', x, y); }, true);
  // 장소
  for (const ic of placeIcons()) put(ic.x, ic.y, (x, y) => {
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.beginPath(); c.arc(x, y, 7 * s, 0, TAU); c.fill();
    c.fillStyle = ic.c; c.font = `bold ${9 * s}px ${FONT_KR}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ic.ch, x, y + 0.5);
  });
  // 미션 목표
  for (const t of Missions.targets()) put(t.x, t.y, (x, y) => {
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.beginPath(); c.arc(x, y, 6.5 * s, 0, TAU); c.fill();
    c.fillStyle = t.c; c.beginPath(); c.arc(x, y, 4.8 * s, 0, TAU); c.fill();
    if (t.giver) { c.fillStyle = '#1a1a1a'; c.font = `bold ${7 * s}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('M', x, y + 0.5); }
  }, true);
  c.restore();
  // 테두리 + 플레이어 화살표
  c.strokeStyle = 'rgba(10,12,18,0.95)'; c.lineWidth = 5 * s; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, R + 2.5 * s, 0, TAU); c.stroke();
  txt(c, 'N', cx, cy - R + 11 * s, `${12 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 3, 'center');
  const a = P.car ? P.car.a : P.a;
  c.save(); c.translate(cx, cy); c.rotate(a);
  c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(8 * s, 0); c.lineTo(-5 * s, -5.5 * s); c.lineTo(-2.5 * s, 0); c.lineTo(-5 * s, 5.5 * s); c.closePath(); c.stroke(); c.fill();
  c.restore();
  // 속도계
  if (P.car) {
    const kmh = Math.round(Math.abs(P.car.vf) * 3.6);
    const sx = cx + R + 14 * s, sy = Input.usingTouch ? cy - 8 * s : cy + R - 10 * s;
    txt(c, String(kmh), sx, sy, `${34 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'left');
    txt(c, 'km/h', sx + c.measureText(String(kmh)).width + 5 * s, sy, `${14 * s}px ${FONT_NUM}`, '#cfd6e0', 'rgba(0,0,0,0.9)', 3, 'left');
    const hw = 70 * s; c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(sx, sy + 6 * s, hw, 5 * s);
    const hpk = P.car.hp / P.car.maxHp; c.fillStyle = hpk > 0.5 ? '#7ad67a' : hpk > 0.25 ? '#f2c14e' : '#e0443e'; c.fillRect(sx, sy + 6 * s, hw * hpk, 5 * s);
    if (Radio.station > 0) txt(c, Radio.stations[Radio.station].name, sx, sy - 34 * s, `600 ${11 * s}px ${FONT_KR}`, '#ffcf5a', 'rgba(0,0,0,0.9)', 3, 'left');
  }
}

// ---------- 전체 지도 ----------
function drawFullMap() {
  const c = ctx, P = Game.player;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = 'rgba(6,10,18,0.92)'; c.fillRect(0, 0, CW, CH);
  const size = Math.min(CW - 40, CH - 110);
  const k = size / (MW * T), ox = (CW - size) / 2, oy = 64;
  c.imageSmoothingEnabled = false;
  c.drawImage(World.mini, ox, oy, size, size);
  c.imageSmoothingEnabled = true;
  c.strokeStyle = 'rgba(255,255,255,0.3)'; c.strokeRect(ox, oy, size, size);
  txt(c, '네온 하버 지도', CW / 2, 44, `${28 * UI.s}px ${FONT_DISP}`, '#f2c14e', 'rgba(0,0,0,0.9)', 5, 'center');
  // 구역 이름
  const acc = {};
  for (const b of World.blocks) { const d = b.district; acc[d] = acc[d] || [0, 0, 0]; acc[d][0] += (b.x0 + b.x1) / 2; acc[d][1] += (b.y0 + b.y1) / 2; acc[d][2]++; }
  acc[DIST.HARBOR] = acc[DIST.HARBOR] || [0, 0, 0];
  for (const d in acc) { const [sx, sy, n] = acc[d]; if (!n) continue; txt(c, DIST_NAMES[d], ox + sx / n * T * k, oy + sy / n * T * k, `${15 * UI.s}px ${FONT_DISP}`, 'rgba(255,255,255,0.85)', 'rgba(0,0,0,0.9)', 4, 'center'); }
  for (const ic of placeIcons()) {
    const x = ox + ic.x * k, y = oy + ic.y * k;
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.beginPath(); c.arc(x, y, 9, 0, TAU); c.fill();
    c.fillStyle = ic.c; c.font = `bold 11px ${FONT_KR}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ic.ch, x, y + 0.5);
  }
  for (const t of Missions.targets()) { const x = ox + t.x * k, y = oy + t.y * k; c.fillStyle = '#000'; c.beginPath(); c.arc(x, y, 8, 0, TAU); c.fill(); c.fillStyle = t.c; c.beginPath(); c.arc(x, y, 6, 0, TAU); c.fill(); }
  if (Wanted.stars > 0) { c.strokeStyle = 'rgba(255,90,80,0.9)'; c.beginPath(); c.arc(ox + Wanted.lkpX * k, oy + Wanted.lkpY * k, Wanted.radius * k, 0, TAU); c.stroke(); }
  const px = ox + P.px * k, py = oy + P.py * k;
  c.save(); c.translate(px, py); c.rotate(P.car ? P.car.a : P.a); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(10, 0); c.lineTo(-6, -7); c.lineTo(-3, 0); c.lineTo(-6, 7); c.closePath(); c.stroke(); c.fill(); c.restore();
  // 범례
  const legend = [['#f2c14e', 'M  미션 / 목표'], ['#e0443e', 'H  병원 (체력)'], ['#4b8fe8', 'P  경찰서'], ['#ff6b5a', '총  총포상'], ['#6fe0ff', 'S  페인트샵 (수배 해제)'], ['#f2c14e', 'G  차고']];
  let lx = ox, ly = oy + size + 22;
  c.font = `500 ${12 * UI.s}px ${FONT_KR}`;
  for (const [col, l] of legend) { c.fillStyle = col; c.fillRect(lx, ly - 9, 10, 10); txt(c, l, lx + 15, ly, `500 ${12 * UI.s}px ${FONT_KR}`, '#dfe6ee', null); lx += c.measureText(l).width + 34; if (lx > ox + size - 80) { lx = ox; ly += 18; } }
  txt(c, `숨겨진 꾸러미 ${Game.packages.size}/${Game.packageTotal}   ·   스토리 ${Math.min(Missions.idx, Missions.defs.length)}/${Missions.defs.length}`, CW / 2, CH - 12, `500 ${12 * UI.s}px ${FONT_KR}`, '#9fb0c4', null, 0, 'center');
}

// ---------- WASTED / BUSTED ----------
function drawDeathScreen(kind, t) {
  const c = ctx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const a = clamp(t / 1.2, 0, 1);
  c.fillStyle = kind === 'wasted' ? `rgba(40,0,0,${0.45 * a})` : `rgba(0,10,40,${0.45 * a})`;
  c.fillRect(0, 0, CW, CH);
  c.globalAlpha = clamp((t - 0.6) * 2, 0, 1);
  const s = UI.s;
  txt(c, kind === 'wasted' ? 'WASTED' : 'BUSTED', CW / 2, CH / 2, `${96 * s}px ${FONT_NUM}`, kind === 'wasted' ? '#c8322b' : '#4b8fe8', 'rgba(0,0,0,0.95)', 10, 'center', 'middle');
  txt(c, kind === 'wasted' ? '사망 — 병원에서 깨어납니다 (진료비 -$100)' : '체포 — 무기를 압수당했습니다 (보석금 청구)', CW / 2, CH / 2 + 62 * s, `600 ${18 * s}px ${FONT_KR}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'center');
  c.globalAlpha = 1;
}

// ---------- DOM 메뉴 ----------
const Menu = {
  el: null,
  init() {
    this.el = document.getElementById('menu');
    document.getElementById('btn-new').onclick = () => { Sfx.init(); Game.newGame(false); };
    const cont = document.getElementById('btn-continue');
    if (Save.read()) cont.hidden = false;
    cont.onclick = () => { Sfx.init(); Game.newGame(true); };
    document.getElementById('btn-resume').onclick = () => Game.resume();
    document.getElementById('btn-map').onclick = () => { Game.state = 'map'; this.hidePause(); };
    document.getElementById('btn-sound').onclick = e => { Sfx.muted = !Sfx.muted; e.target.textContent = Sfx.muted ? '소리 켜기' : '소리 끄기'; };
    document.getElementById('btn-quit').onclick = () => { this.hidePause(); Game.toMenu(); };
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== b.dataset.tab);
    });
    document.getElementById('shop-close').onclick = () => Shop.close();
  },
  show() { this.el.hidden = false; const cont = document.getElementById('btn-continue'); cont.hidden = !Save.read(); },
  hide() { this.el.hidden = true; },
  showPause() { document.getElementById('pause').hidden = false; },
  hidePause() { document.getElementById('pause').hidden = true; },
};

const Shop = {
  open() {
    Game.state = 'shop';
    const list = document.getElementById('shop-list');
    list.innerHTML = '';
    const P = Game.player;
    const items = ['pistol', 'smg', 'shotgun', 'rifle', 'grenade', 'rocket'].map(w => ({ id: w, name: WEAPONS[w].name, price: WEAPONS[w].price, desc: `탄약 ${WEAPONS[w].pack}발` }));
    items.push({ id: 'armor', name: '방탄복', price: 500, desc: '피해 흡수 100' });
    items.push({ id: 'bat', name: '야구방망이', price: 100, desc: '근접 무기' });
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'shop-row';
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
      const g = cv.getContext('2d'); g.translate(32, 20);
      if (it.id === 'armor') drawPickupIcon(g, 'armor', null, 30); else drawWeaponIcon(g, it.id, 26, '#f2f2f2');
      const info = document.createElement('div'); info.className = 'shop-info';
      info.innerHTML = `<b>${it.name}</b><span>${it.desc}</span>`;
      const btn = document.createElement('button'); btn.className = 'btn small'; btn.textContent = `$${it.price.toLocaleString()}`;
      btn.disabled = P.money < it.price;
      btn.onclick = () => {
        if (P.money < it.price) return;
        P.money -= it.price; Sfx.cash();
        if (it.id === 'armor') P.armor = 100; else giveWeapon(P, it.id, WEAPONS[it.id].pack || 1);
        if (it.id !== 'armor') P.weapon = it.id;
        document.getElementById('shop-money').textContent = `보유 $${P.money.toLocaleString()}`;
        list.querySelectorAll('button').forEach((b, i) => { b.disabled = P.money < items[i].price; });
      };
      row.append(cv, info, btn); list.append(row);
    }
    document.getElementById('shop-money').textContent = `보유 $${P.money.toLocaleString()}`;
    document.getElementById('shop').hidden = false;
  },
  close() { document.getElementById('shop').hidden = true; Game.state = 'play'; Game.shopCool = 4; },
};

// ---------- 터치 조작 ----------
const Touch = {
  init() {
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    const T_ = Input.touch;
    const enable = () => { if (!Input.usingTouch) { Input.usingTouch = true; document.body.classList.add('touch'); } };
    window.addEventListener('touchstart', enable, { passive: true });
    const zone = document.getElementById('stick-zone');
    zone.addEventListener('touchstart', e => {
      e.preventDefault(); enable();
      const t = e.changedTouches[0]; T_.stickId = t.identifier; T_.sx = t.clientX; T_.sy = t.clientY; T_.on = true;
      stick.style.left = (t.clientX - 60) + 'px'; stick.style.top = (t.clientY - 60) + 'px'; stick.classList.add('active');
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === T_.stickId) {
        let dx = t.clientX - T_.sx, dy = t.clientY - T_.sy; const d = Math.hypot(dx, dy), m = 50;
        if (d > m) { dx *= m / d; dy *= m / d; }
        T_.jx = dx / m; T_.jy = dy / m;
        knob.style.transform = `translate(${dx}px,${dy}px)`;
      }
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === T_.stickId) { T_.stickId = null; T_.jx = 0; T_.jy = 0; T_.on = false; knob.style.transform = ''; stick.classList.remove('active'); } };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
    const hold = (id, key) => {
      const b = document.getElementById(id);
      b.addEventListener('touchstart', e => { e.preventDefault(); enable(); T_[key] = true; b.classList.add('on'); }, { passive: false });
      const up = e => { e.preventDefault(); T_[key] = false; b.classList.remove('on'); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    };
    const tap = (id, fn) => { const b = document.getElementById(id); b.addEventListener('touchstart', e => { e.preventDefault(); enable(); fn(); }, { passive: false }); };
    hold('t-fire', 'fire'); hold('t-hb', 'hb');
    tap('t-enter', () => { Input.pressed['KeyF'] = true; });
    tap('t-weapon', () => { Input.pressed['KeyE'] = true; });
    tap('t-radio', () => { Input.pressed['KeyR'] = true; });
    tap('t-map', () => { Input.pressed['KeyM'] = true; });
    tap('t-pause', () => { Input.pressed['Escape'] = true; });
  },
};
