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
  const VW = P.car && P.car.V.special ? vWeapon(P.car) : null;
  if (VW) { // 탑승 무기: 이름 + 재장전 게이지
    txt(c, VWEAP[VW].short, bx + bw / 2, by + bw / 2 + 2 * s, `700 ${14 * s}px ${FONT_KR}`, '#f2f2f2', 'rgba(0,0,0,0.9)', 3, 'center');
    const cdk = clamp((P.car['cd_' + VW] || 0) / VWEAP[VW].cd, 0, 1);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(bx + 8 * s, by + bw - 12 * s, bw - 16 * s, 4 * s);
    c.fillStyle = cdk > 0 ? '#f2c14e' : '#7ae68f'; c.fillRect(bx + 8 * s, by + bw - 12 * s, (bw - 16 * s) * (1 - cdk), 4 * s);
    txt(c, `${(P.car.vw || 0) % vWeapons(P.car).length + 1}/${vWeapons(P.car).length}`, bx + bw - 5 * s, by + 13 * s, `${10 * s}px ${FONT_NUM}`, '#cfd6e0', 'rgba(0,0,0,0.9)', 2, 'right');
  } else { c.save(); c.translate(bx + bw / 2, by + bw / 2 - 5 * s); drawWeaponIcon(c, P.weapon, 26 * s, '#f2f2f2'); c.restore(); }
  const ammo = VW ? undefined : P.inv[P.weapon];
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
  let by2 = barY + barH + 3;
  if (P.armor > 0) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(barX - 2, by2, barW + 4, barH * 0.7 + 4); c.fillStyle = '#4b8fe8'; c.fillRect(barX, by2 + 2, barW * P.armor / 100, barH * 0.7); by2 += barH * 0.7 + 5; }
  // 달리기 체력
  if (!P.car && (P.stamina < 0.995 || P.boostT > 0)) {
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(barX - 2, by2, barW + 4, barH * 0.55 + 4);
    c.fillStyle = P.boostT > 0 ? '#6fe0ff' : P.exhausted ? (Math.floor(Game.time * 5) % 2 ? '#ff8a5a' : '#8a4a2a') : '#f2c14e';
    c.fillRect(barX, by2 + 2, barW * (P.boostT > 0 ? 1 : P.stamina), barH * 0.55);
  }
  // 가방 · 체력 유지제
  const bagN = Bag.count();
  if (bagN || P.vitalT > 0) {
    const t = [bagN ? `가방 ${bagN}${Input.usingTouch ? '' : '(B)'}` : '', P.vitalT > 0 ? `유지 ${Math.ceil(P.vitalT)}s` : ''].filter(Boolean).join(' · ');
    txt(c, t, barX, by2 + 14 * s, `600 ${11 * s}px ${FONT_KR}`, P.vitalT > 0 ? '#7ae68f' : '#cfd6e0', 'rgba(0,0,0,0.9)', 3, 'left');
  }
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
  const m = Missions.active || Jobs.active;
  let ty = sy + 30 * s;
  if (m && m.timer !== null) {
    const tt = Math.max(0, m.timer), str = `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')}`;
    txt(c, '남은 시간', x - 70 * s, ty, `600 ${13 * s}px ${FONT_KR}`, '#cfd6e0', 'rgba(0,0,0,0.8)', 3, 'right');
    txt(c, str, x, ty + 2 * s, `${28 * s}px ${FONT_NUM}`, tt < 10 ? '#ff6b5a' : '#fff', 'rgba(0,0,0,0.9)', 4, 'right');
    ty += 30 * s;
  }
  if (m && m.def.title && m.def.title.includes('소탕') && m.stage === 1) { txt(c, `처치 ${m.kills}/15`, x, ty + 4 * s, `${24 * s}px ${FONT_NUM}`, '#4fe38a', 'rgba(0,0,0,0.9)', 4, 'right'); }

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
  if (Jobs.active) {
    const J = Jobs.active, line = `${J.def.name} · ${J.count}건 · $${J.earned.toLocaleString()}` + (Input.usingTouch ? '' : '   (X: 그만두기)');
    c.font = `700 ${13 * s}px ${FONT_KR}`;
    const w = c.measureText(line).width + 24 * s;
    c.fillStyle = J.def.legal ? 'rgba(20,50,90,0.75)' : 'rgba(70,20,50,0.75)'; roundRect(c, pad, hy, w, 26 * s, 6 * s); c.fill();
    txt(c, line, pad + 12 * s, hy + 18 * s, `700 ${13 * s}px ${FONT_KR}`, J.def.legal ? '#bcdcff' : '#ffc2d6', null);
    hy += 32 * s;
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
  const subW = Input.usingTouch && land ? Math.max(240, CW - (P.car ? 620 : 470)) : Math.min(CW - 60, 640 * s);
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

  if (UI.jay > 0.15 && !P.car && Wanted.stars === 0) {
    const a = clamp(UI.jay * 2, 0, 1);
    c.globalAlpha = a;
    txt(c, '무단횡단 중! 횡단보도에서 보행 신호에 건너세요', CW / 2, Input.usingTouch ? 96 : CH * 0.2, `700 ${15 * s}px ${FONT_KR}`, '#ffb4a8', 'rgba(0,0,0,0.9)', 4, 'center');
    c.globalAlpha = 1;
  }
  // ---- 화면 밖 목표 화살표 ----
  const tg = allTargets()[0];
  if (tg && Game.view === 'top' && !onScreenExact(tg.x, tg.y, -30)) {
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
  // 3D 시점 조준점: 실제 조준 방향 20m 앞
  if (Game.view !== 'top' && View3D.ok && Game.state === 'play' && !WEAPONS[P.weapon].melee) {
    const a = P.car ? View3D.yaw : P.aim, pr = View3D.project(P.px + Math.cos(a) * 20, P.py + Math.sin(a) * 20, 1.3);
    if (pr) { c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5; c.beginPath(); c.arc(pr[0], pr[1], 7, 0, TAU); c.moveTo(pr[0] - 12, pr[1]); c.lineTo(pr[0] - 4, pr[1]); c.moveTo(pr[0] + 4, pr[1]); c.lineTo(pr[0] + 12, pr[1]); c.stroke(); }
  }
  // 조준점
  if (Game.view === 'top' && !Input.usingTouch && !Pad.active && !P.car && Game.state === 'play' && P.weapon !== 'fist') {
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
  if (pl.dealer) out.push({ x: pl.dealer.x, y: pl.dealer.y, ch: 'D', c: '#c77dff', label: '네온 모터스(차량 매매)' });
  if (pl.ammu2) out.push({ x: pl.ammu2.x, y: pl.ammu2.y, ch: '총', c: '#ff6b5a', label: '총포상' });
  for (const k of ['burger', 'burger2']) if (pl[k]) out.push({ x: pl[k].x, y: pl[k].y, ch: '버', c: '#ffb347', label: '버거 샷' });
  for (const k of ['mart', 'mart2', 'mart3']) if (pl[k]) out.push({ x: pl[k].x, y: pl[k].y, ch: '편', c: '#7ae68f', label: '편의점' });
  if (pl.safehouse) out.push({ x: pl.safehouse.x, y: pl.safehouse.y, ch: '집', c: '#9be15d', label: '은신처(저장)' });
  if (pl.jobcenter) out.push({ x: pl.jobcenter.x, y: pl.jobcenter.y, ch: 'J', c: '#6fb6ff', label: '고용센터' });
  if (pl.broker) out.push({ x: pl.broker.x, y: pl.broker.y, ch: '$', c: '#ff5d8f', label: '브로커' });
  return out;
}

function drawRadar(s) {
  const c = ctx, P = Game.player;
  const R = (Input.usingTouch ? 62 : 80) * s;
  const pad = 16 * s + 4;
  const cx = pad + R, cy = Input.usingTouch ? pad + R + 8 : CH - pad - R;
  const span = P.car ? 230 + P.car.speed * 3 + (P.car.alt || 0) * 5 : 190; // 레이더 지름(m)
  const k = (R * 2) / span;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.closePath();
  c.fillStyle = '#0f2a3d'; c.fill();
  c.clip();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = 0.92;
  // 레이더는 화면과 같은 방향으로 돈다(운전 중 차 방향이 위)
  c.save(); c.translate(cx, cy); c.rotate(-Cam.rot);
  c.drawImage(World.mini, 0, 0, MW, MH, -P.px * k, -P.py * k, MW * T * k, MH * T * k);
  c.globalAlpha = 1; c.imageSmoothingEnabled = true;
  // 수색 원
  if (Wanted.stars > 0 && !Wanted.seen) {
    c.fillStyle = 'rgba(224,68,62,0.22)'; c.strokeStyle = 'rgba(255,90,80,0.8)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc((Wanted.lkpX - P.px) * k, (Wanted.lkpY - P.py) * k, Wanted.radius * k, 0, TAU); c.fill(); c.stroke();
  }
  GPS.draw(c, k, P.px, P.py, 3.2 * s);
  c.restore();
  const rc = Math.cos(Cam.rot), rs = Math.sin(Cam.rot);
  const put = (x, y, fn, clampEdge) => {
    const wx = (x - P.px) * k, wy = (y - P.py) * k;
    let dx = wx * rc + wy * rs, dy = -wx * rs + wy * rc;
    const d = Math.hypot(dx, dy);
    if (d > R - 7) { if (!clampEdge) return; dx *= (R - 7) / d; dy *= (R - 7) / d; }
    fn(cx + dx, cy + dy);
  };
  // 경찰
  const fl = Math.floor(Game.time * 4) % 2;
  for (const car of Game.cars) if (car.driverKind === 'cop' && !car.dead && car.driver === 'ai') put(car.x, car.y, (x, y) => { c.fillStyle = car.siren ? (fl ? '#ff3b3b' : '#4b8fe8') : '#4b8fe8'; c.fillRect(x - 3, y - 3, 6, 6); });
  for (const p of Game.peds) if ((p.kind === 'cop' || p.kind === 'swat') && !p.dead && p.state === 'chase') put(p.x, p.y, (x, y) => { c.fillStyle = fl ? '#ff3b3b' : '#4b8fe8'; c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill(); });
  for (const u of AirPatrol.units) put(u.x, u.y, (x, y) => { c.fillStyle = fl ? '#ff3b3b' : '#ffd24d'; c.font = `bold ${12 * s}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('✈', x, y); }, true);
  if (Police.heli && !Police.heli.dead) put(Police.heli.x, Police.heli.y, (x, y) => { c.fillStyle = '#fff'; c.font = `bold ${11 * s}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('✚', x, y); }, true);
  // 장소
  for (const ic of placeIcons()) put(ic.x, ic.y, (x, y) => {
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.beginPath(); c.arc(x, y, 7 * s, 0, TAU); c.fill();
    c.fillStyle = ic.c; c.font = `bold ${9 * s}px ${FONT_KR}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ic.ch, x, y + 0.5);
  });
  if (Game.waypoint) put(Game.waypoint.x, Game.waypoint.y, (x, y) => { c.fillStyle = '#c77dff'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x - 5 * s, y - 8 * s); c.lineTo(x + 5 * s, y - 8 * s); c.closePath(); c.fill(); c.stroke(); }, true);
  // 미션 목표
  for (const t of allTargets()) put(t.x, t.y, (x, y) => {
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.beginPath(); c.arc(x, y, 6.5 * s, 0, TAU); c.fill();
    c.fillStyle = t.c; c.beginPath(); c.arc(x, y, 4.8 * s, 0, TAU); c.fill();
    if (t.giver) { c.fillStyle = '#1a1a1a'; c.font = `bold ${7 * s}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('M', x, y + 0.5); }
  }, true);
  c.restore();
  // 테두리 + 플레이어 화살표
  c.strokeStyle = 'rgba(10,12,18,0.95)'; c.lineWidth = 5 * s; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, R + 2.5 * s, 0, TAU); c.stroke();
  txt(c, 'N', cx + Math.cos(-Math.PI / 2 - Cam.rot) * (R - 11 * s), cy + Math.sin(-Math.PI / 2 - Cam.rot) * (R - 11 * s) + 4 * s, `${12 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 3, 'center');
  const a = P.car ? P.car.a : P.a;
  c.save(); c.translate(cx, cy); c.rotate(a - Cam.rot);
  c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(8 * s, 0); c.lineTo(-5 * s, -5.5 * s); c.lineTo(-2.5 * s, 0); c.lineTo(-5 * s, 5.5 * s); c.closePath(); c.stroke(); c.fill();
  c.restore();
  // 속도계
  if (P.car) {
    const kmh = Math.round(Math.abs(P.car.vf) * 3.6);
    const sx = cx + R + 14 * s, sy = Input.usingTouch ? cy - 8 * s : cy + R - 10 * s;
    txt(c, String(kmh), sx, sy, `${34 * s}px ${FONT_NUM}`, '#fff', 'rgba(0,0,0,0.9)', 4, 'left');
    const kmW = c.measureText(String(kmh)).width;
    txt(c, 'km/h', sx + kmW + 5 * s, sy, `${14 * s}px ${FONT_NUM}`, '#cfd6e0', 'rgba(0,0,0,0.9)', 3, 'left');
    const rev = P.car.vf < -0.3;
    txt(c, rev ? 'R' : 'D', sx + kmW + 40 * s, sy, `${22 * s}px ${FONT_NUM}`, rev ? '#ff8a80' : '#7ae68f', 'rgba(0,0,0,0.9)', 3, 'left');
    if (isAir(P.car)) txt(c, `고도 ${Math.round(P.car.alt || 0)}m`, sx, sy - (Radio.station > 0 ? 52 : 34) * s, `${16 * s}px ${FONT_NUM}`, '#9fd8ff', 'rgba(0,0,0,0.9)', 3, 'left');
    const hw = 70 * s; c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(sx, sy + 6 * s, hw, 5 * s);
    const hpk = P.car.hp / P.car.maxHp; c.fillStyle = hpk > 0.5 ? '#7ad67a' : hpk > 0.25 ? '#f2c14e' : '#e0443e'; c.fillRect(sx, sy + 6 * s, hw * hpk, 5 * s);
    if (Radio.station > 0) txt(c, Radio.stations[Radio.station].name, sx, sy - 34 * s, `600 ${11 * s}px ${FONT_KR}`, '#ffcf5a', 'rgba(0,0,0,0.9)', 3, 'left');
  } else if (P.alt > 0) {
    const sx = cx + R + 14 * s, sy = Input.usingTouch ? cy - 8 * s : cy + R - 10 * s;
    txt(c, `고도 ${Math.round(P.alt)}m`, sx, sy, `${24 * s}px ${FONT_NUM}`, '#9fd8ff', 'rgba(0,0,0,0.9)', 4, 'left');
    txt(c, P.chute ? '낙하산 펼침' : '자유 낙하!', sx, sy + 20 * s, `600 ${13 * s}px ${FONT_KR}`, P.chute ? '#7ae68f' : '#ff8a80', 'rgba(0,0,0,0.9)', 3, 'left');
  }
}

// ---------- 전체 지도 ----------
function drawFullMap() {
  const c = ctx, P = Game.player;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = 'rgba(6,10,18,0.92)'; c.fillRect(0, 0, CW, CH);
  const legend = [['#f2c14e', 'M  미션 / 목표'], ['#e0443e', 'H  병원'], ['#4b8fe8', 'P  경찰서'], ['#ff6b5a', '총  총포상'], ['#ffb347', '버  버거 샷'], ['#7ae68f', '편  편의점'], ['#6fe0ff', 'S  페인트샵'], ['#f2c14e', 'G  차고'], ['#6fb6ff', 'J  고용센터 (합법 직업)'], ['#ff5d8f', '$  브로커 (불법 직업)'], ['#9be15d', '집  은신처 (저장·수면)'], ['#c77dff', '▼  웨이포인트'], ['#8f9b6a', '★4  군사 기지 (전차·헬기·전투기)'], ['#c77dff', 'D  네온 모터스 (차량 매매)']];
  // 범례 줄 수를 먼저 재서 지도 크기를 정한다 (글자가 지도·도움말과 겹치지 않게)
  const lf = `500 ${12 * UI.s}px ${FONT_KR}`, lh = 18 * Math.max(1, UI.s);
  c.font = lf;
  const widthFor = (w) => { let lx = 0, rows = 1; for (const [, l] of legend) { const lw = c.measureText(l).width + 34; if (lx && lx + lw > w) { lx = 0; rows++; } lx += lw; } return rows; };
  let size = Math.min(CW - 40, CH - 110);
  for (let i = 0; i < 3; i++) size = Math.min(CW - 40, CH - 64 - 16 - widthFor(size) * lh - 2 * lh - 8);
  size = Math.max(120, size);
  const k = size / (MW * T), ox = (CW - size) / 2, oy = 64;
  Game.mapRect = { ox, oy, size, k };
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
  if (World.base) { const B = World.base; txt(c, '포트 네온 기지', ox + (B.x0 + B.x1) / 2 * k, oy + (B.y0 + B.y1) / 2 * k, `${15 * UI.s}px ${FONT_DISP}`, '#c9d49a', 'rgba(0,0,0,0.9)', 4, 'center'); }
  for (const ic of placeIcons()) {
    const x = ox + ic.x * k, y = oy + ic.y * k;
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.beginPath(); c.arc(x, y, 9, 0, TAU); c.fill();
    c.fillStyle = ic.c; c.font = `bold 11px ${FONT_KR}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ic.ch, x, y + 0.5);
  }
  for (const t of allTargets()) { const x = ox + t.x * k, y = oy + t.y * k; c.fillStyle = '#000'; c.beginPath(); c.arc(x, y, 8, 0, TAU); c.fill(); c.fillStyle = t.c; c.beginPath(); c.arc(x, y, 6, 0, TAU); c.fill(); }
  if (Wanted.stars > 0) { c.strokeStyle = 'rgba(255,90,80,0.9)'; c.beginPath(); c.arc(ox + Wanted.lkpX * k, oy + Wanted.lkpY * k, Wanted.radius * k, 0, TAU); c.stroke(); }
  c.save(); c.translate(ox, oy); GPS.draw(c, k, 0, 0, 3); c.restore();
  if (Game.waypoint) { const wx = ox + Game.waypoint.x * k, wy = oy + Game.waypoint.y * k; c.fillStyle = '#c77dff'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx - 7, wy - 16); c.lineTo(wx + 7, wy - 16); c.closePath(); c.fill(); c.stroke(); }
  const px = ox + P.px * k, py = oy + P.py * k;
  c.save(); c.translate(px, py); c.rotate(P.car ? P.car.a : P.a); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(10, 0); c.lineTo(-6, -7); c.lineTo(-3, 0); c.lineTo(-6, 7); c.closePath(); c.stroke(); c.fill(); c.restore();
  // 범례
  let lx = ox, ly = oy + size + 16 + lh * 0.5;
  c.font = lf;
  for (const [col, l] of legend) { const lw = c.measureText(l).width + 34; if (lx > ox && lx + lw > ox + size) { lx = ox; ly += lh; } c.fillStyle = col; c.fillRect(lx, ly - 9, 10, 10); txt(c, l, lx + 15, ly, lf, '#dfe6ee', null); lx += lw; }
  ly += lh;
  txt(c, (Input.usingTouch ? '지도를 눌러 웨이포인트 지정 · 지도 버튼으로 닫기' : '클릭: 웨이포인트 지정/해제 · 지도 밖 클릭/M: 닫기') + `   ·   숨겨진 꾸러미 ${Game.packages.size}/${Game.packageTotal}   ·   스토리 ${Math.min(Missions.idx, Missions.defs.length)}/${Missions.defs.length}`, CW / 2, ly, lf, '#c7b8ff', null, 0, 'center');
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
    const camBtn = document.getElementById('btn-camrot');
    const camLabel = () => { camBtn.textContent = Settings.camRot ? '운전 시점: 차 방향으로 회전' : '운전 시점: 북쪽 고정'; };
    camLabel(); camBtn.onclick = () => { Settings.camRot = !Settings.camRot; Settings.save(); camLabel(); };
    this.camLabel = camLabel;
    const sensBtn = document.getElementById('btn-sens'), wheelBtn = document.getElementById('btn-wheel');
    const SENS = [[0.7, '둔하게'], [1, '보통'], [1.35, '민감하게']], WHEEL = [['md', '보통'], ['lg', '크게'], ['xl', '아주 크게']];
    const setLabels = () => { sensBtn.textContent = `조향 감도: ${(SENS.find(s => s[0] === Settings.sens) || SENS[1])[1]}`; wheelBtn.textContent = `핸들 크기: ${(WHEEL.find(w => w[0] === Settings.wheel) || WHEEL[1])[1]}`; document.body.dataset.wheel = Settings.wheel; };
    setLabels();
    sensBtn.onclick = () => { const i = SENS.findIndex(s => s[0] === Settings.sens); Settings.sens = SENS[(i + 1) % SENS.length][0]; Settings.save(); setLabels(); };
    wheelBtn.onclick = () => { const i = WHEEL.findIndex(w => w[0] === Settings.wheel); Settings.wheel = WHEEL[(i + 1) % WHEEL.length][0]; Settings.save(); setLabels(); };
    document.getElementById('btn-view').onclick = () => { this.hidePause(); Game.state = 'play'; cycleView(); };
    document.getElementById('btn-quitjob').onclick = () => { Jobs.stop('일을 그만뒀다'); this.hidePause(); Game.state = 'play'; };
    document.getElementById('jobs-close').onclick = () => Jobs.closeBoard();
    const ci = document.getElementById('cheat-input');
    document.getElementById('cheat-go').onclick = () => { const v = ci.value.trim().toUpperCase(); if (!v) return; ci.value = ''; this.hidePause(); Game.state = 'play'; Cheats.apply(v); };
    document.getElementById('btn-quit').onclick = () => { this.hidePause(); Game.toMenu(); };
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== b.dataset.tab);
    });
    document.getElementById('shop-close').onclick = () => Shop.close();
  },
  show() { this.el.hidden = false; const cont = document.getElementById('btn-continue'); cont.hidden = !Save.read(); },
  hide() { this.el.hidden = true; },
  showPause() { document.getElementById('pause').hidden = false; document.getElementById('btn-quitjob').hidden = !Jobs.active; if (this.camLabel) this.camLabel(); },
  hidePause() { document.getElementById('pause').hidden = true; },
};

// ---------- 상점 (총포상 · 버거 샷 · 24 편의점) ----------
function drawItemIcon(g, id, S) {
  g.save(); g.scale(S, S);
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  switch (id) {
    case 'vital': R(-0.22, -0.5, 0.44, 0.95, '#2fbf71'); R(-0.14, -0.62, 0.28, 0.14, '#f2f2f2'); R(-0.22, -0.1, 0.44, 0.18, '#f2f2f2'); R(-0.05, -0.16, 0.1, 0.3, '#e0443e'); R(-0.15, -0.06, 0.3, 0.1, '#e0443e'); break;
    case 'burger': R(-0.6, -0.35, 1.2, 0.25, '#d99a4e'); R(-0.62, -0.1, 1.24, 0.12, '#4b8f3a'); R(-0.62, 0.02, 1.24, 0.16, '#6b3a22'); R(-0.62, 0.18, 1.24, 0.08, '#f2c14e'); R(-0.58, 0.26, 1.16, 0.18, '#d99a4e'); break;
    case 'set': R(-0.75, -0.2, 0.8, 0.18, '#d99a4e'); R(-0.76, -0.02, 0.82, 0.14, '#6b3a22'); R(-0.72, 0.12, 0.74, 0.16, '#d99a4e'); R(0.15, -0.45, 0.45, 0.8, '#c7302a'); R(0.22, -0.6, 0.06, 0.2, '#f2c14e'); R(0.34, -0.62, 0.06, 0.22, '#f2c14e'); break;
    case 'fries': R(-0.35, -0.1, 0.7, 0.55, '#c7302a'); for (let i = 0; i < 5; i++) R(-0.3 + i * 0.13, -0.5 + (i % 2) * 0.1, 0.08, 0.45, '#f2c14e'); break;
    case 'cola': R(-0.25, -0.45, 0.5, 0.9, '#b8322c'); R(-0.25, -0.1, 0.5, 0.2, '#f2f2f2'); R(0.05, -0.65, 0.07, 0.25, '#ffffff'); break;
    case 'onigiri': g.fillStyle = '#f5f5f0'; g.beginPath(); g.moveTo(0, -0.5); g.lineTo(0.5, 0.4); g.lineTo(-0.5, 0.4); g.closePath(); g.fill(); R(-0.18, 0.05, 0.36, 0.35, '#1f2a22'); break;
    case 'ramen': R(-0.45, -0.3, 0.9, 0.7, '#f2f2f2'); R(-0.45, -0.3, 0.9, 0.18, '#c7302a'); R(-0.3, 0.02, 0.6, 0.1, '#e6b35a'); break;
    case 'energy': R(-0.22, -0.5, 0.44, 1, '#18d0ff'); R(-0.22, -0.2, 0.44, 0.3, '#10202a'); g.fillStyle = '#f2ff4d'; g.beginPath(); g.moveTo(0.05, -0.18); g.lineTo(-0.1, 0.02); g.lineTo(0.02, 0.02); g.lineTo(-0.05, 0.14); g.lineTo(0.12, -0.05); g.lineTo(0, -0.05); g.closePath(); g.fill(); break;
    case 'medkit': R(-0.55, -0.4, 1.1, 0.8, '#f2f2f2'); R(-0.1, -0.28, 0.2, 0.56, '#e0283a'); R(-0.3, -0.1, 0.6, 0.2, '#e0283a'); break;
    case 'lvest': case 'armor': drawPickupIcon(g, 'armor', null, 1); break;
    case 'lotto': R(-0.6, -0.35, 1.2, 0.7, '#f2c14e'); g.fillStyle = '#6b3a22'; g.font = 'bold 0.4px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LOTTO', 0, 0.02); break;
    default: drawWeaponIcon(g, id, 1, '#f2f2f2');
  }
  g.restore();
}
const SHOPS = {
  ammu: { title: '총포상', sub: '무기와 탄약', items: () => [
    ...['pistol', 'smg', 'shotgun', 'rifle', 'grenade', 'rocket'].map(w => ({ id: w, name: WEAPONS[w].name, price: WEAPONS[w].price, desc: `탄약 ${WEAPONS[w].pack}발` })),
    { id: 'armor', name: '방탄복', price: 500, desc: '피해 흡수 100' }, { id: 'bat', name: '야구방망이', price: 100, desc: '근접 무기' }] },
  burger: { title: '버거 샷', sub: '든든하게 먹고 체력을 채우자', items: () => [
    { id: 'burger', name: '치즈 버거', price: 12, desc: '체력 +25', hp: 25 },
    { id: 'set', name: '더블 버거 세트', price: 30, desc: '체력 +60, 달리기 체력 가득', hp: 60, stam: 1 },
    { id: 'fries', name: '감자튀김', price: 6, desc: '체력 +10', hp: 10 },
    { id: 'cola', name: '콜라', price: 4, desc: '달리기 체력 가득', stam: 1 }] },
  mart: { title: '24 편의점', sub: '먹을거리와 생활용품', items: () => [
    { id: 'onigiri', name: '삼각김밥', price: 5, desc: '체력 +12', hp: 12 },
    { id: 'ramen', name: '컵라면', price: 8, desc: '체력 +20', hp: 20 },
    { id: 'energy', name: '에너지 드링크', price: 15, desc: '60초 동안 지치지 않고 달리기', stam: 1, boost: 60 },
    { id: 'medkit', name: '구급상자', price: 120, desc: '체력 완전 회복', hp: 100 },
    { id: 'vital', name: '체력 유지제', price: 80, desc: '90초 동안 체력이 계속 차오르고 지치지 않는다', vital: 90 },
    { id: 'lvest', name: '경량 방탄조끼', price: 300, desc: '방어 +50', armor: 50 },
    { id: 'lotto', name: '즉석 복권', price: 10, desc: '5% 확률 $500, 1% 확률 $5,000', lotto: true }] },
};
const Shop = {
  kind: null,
  open(kind) {
    const S = SHOPS[kind] || SHOPS.ammu, P = Game.player;
    this.kind = kind;
    Game.state = 'shop';
    document.getElementById('shop-title').textContent = S.title;
    document.getElementById('shop-sub').textContent = S.sub;
    const list = document.getElementById('shop-list');
    list.innerHTML = '';
    const items = S.items();
    const buttons = [], bagBtns = [];
    const food = it => !!CONSUMABLES[it.id];
    // 체력이 가득해도 음식은 살 수 있다 (가방에 넣는다)
    const can = it => it.ok ? it.ok() && P.money >= it.price : P.money >= it.price && !(it.armor && P.armor >= 100) && !(it.id === 'armor' && P.armor >= 100) && !(food(it) && !this.useful(it) && Bag.count() >= Bag.MAX);
    const refresh = () => {
      document.getElementById('shop-money').textContent = `보유 $${P.money.toLocaleString()}` + (Bag.count() ? ` · 가방 ${Bag.count()}/${Bag.MAX}` : '');
      buttons.forEach((b, i) => { b.disabled = !can(items[i]); });
      bagBtns.forEach(([b, it]) => { b.disabled = P.money < it.price || Bag.count() >= Bag.MAX; });
    };
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'shop-row';
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
      const g = cv.getContext('2d'); g.translate(32, 20);
      if (it.veh) drawVehIcon(g, it.veh);
      else if (it.id === 'armor') drawPickupIcon(g, 'armor', null, 30); else drawItemIcon(g, it.id, WEAPONS[it.id] ? 26 : 30);
      const info = document.createElement('div'); info.className = 'shop-info';
      info.innerHTML = `<b>${it.name}</b><span>${it.desc}${food(it) ? ' · 필요 없으면 가방에 보관' : ''}</span>`;
      const btn = document.createElement('button'); btn.className = 'btn small';
      btn.textContent = it.sellPrice !== undefined ? `+$${it.sellPrice.toLocaleString()}` : `$${it.price.toLocaleString()}`;
      btn.onclick = () => {
        if (!can(it)) return;
        if (it.fn) { P.money -= it.price; it.fn(); if (Game.state === 'shop') refresh(); return; }
        P.money -= it.price; Sfx.cash();
        if (food(it)) {
          if (this.useful(it)) Bag.apply(it.id);
          else if (Bag.add(it.id)) UI.toast(`${it.name}: 지금은 배부르다 — 가방에 넣었다`);
          else P.money += it.price;
        }
        if (it.armor) P.armor = Math.min(100, P.armor + it.armor);
        if (it.lotto) { const r = Math.random(); const win = r < 0.01 ? 5000 : r < 0.06 ? 500 : 0; if (win) { P.money += win; Sfx.passed(); UI.toast(`복권 당첨! +$${win.toLocaleString()}`); } else UI.toast('꽝! 다음 기회에'); }
        if (WEAPONS[it.id]) { giveWeapon(P, it.id, WEAPONS[it.id].pack || 1); P.weapon = it.id; }
        if (it.id === 'armor') P.armor = 100;
        refresh();
      };
      buttons.push(btn);
      const box = document.createElement('div'); box.className = 'shop-btns';
      row.append(cv, info, box);
      if (food(it)) {
        const bb = document.createElement('button'); bb.className = 'btn small ghost'; bb.textContent = '가방에';
        bb.onclick = () => { if (P.money < it.price || Bag.count() >= Bag.MAX) return; P.money -= it.price; Bag.add(it.id); Sfx.cash(); UI.toast(`${it.name} → 가방 (${Bag.count()}/${Bag.MAX})`); refresh(); };
        bagBtns.push([bb, it]); box.append(bb);
      }
      box.append(btn); list.append(row);
    }
    refresh();
    document.getElementById('shop').hidden = false;
  },
  // 지금 먹으면 효과가 있는가
  useful(it) {
    const P = Game.player, c = CONSUMABLES[it.id]; if (!c) return true;
    return (c.hp && P.hp < P.maxHp - 1) || (c.stam && (P.stamina < 0.95 || P.exhausted)) || (c.boost && !(P.boostT > 0)) || (c.vital && !(P.vitalT > 0));
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
    hold('t-fire', 'fire'); hold('t-hb', 'hb'); hold('t-run', 'run');
    tap('t-steal', () => { if (Pick.target) Pick.attempt(); });
    tap('t-enter', () => { Input.pressed['KeyF'] = true; });
    tap('t-weapon', () => { Input.pressed['KeyE'] = true; });
    tap('t-bag', () => Bag.useBest());
    tap('t-radio', () => { Input.pressed['KeyR'] = true; });
    tap('t-map', () => { Input.pressed['KeyM'] = true; });
    tap('t-pause', () => { Input.pressed['Escape'] = true; });
    tap('t-view', () => { Input.pressed['KeyC'] = true; });
    const lz = document.getElementById('look-zone'); let lid = null, lx = 0;
    lz.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; Input.touch.look = true; }, { passive: false });
    lz.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === lid) { View3D.lookDX += t.clientX - lx; lx = t.clientX; } }, { passive: false });
    const lend = e => { for (const t of e.changedTouches) if (t.identifier === lid) { lid = null; Input.touch.look = false; } };
    lz.addEventListener('touchend', lend); lz.addEventListener('touchcancel', lend);
    Drive.init();
  },
};

// ---------- 모바일 운전: 핸들 + 페달 ----------
// 핸들: 바퀴 테두리를 잡고 돌린다(손가락 각도 변화 = 핸들 회전). 가운데를 잡으면 좌우로 끌어도 된다.
// 놓으면 스프링처럼 가운데로 돌아온다. 페달: 엑셀 = 가속, 브레이크 = 감속 → 멈춘 뒤 계속 밟으면 후진.
const Drive = {
  angle: 0, held: false, id: null, gas: 0, brake: 0, gasV: 0, brakeV: 0, MAX: 2.6, el: null,
  init() {
    const w = this.el = document.getElementById('wheel');
    const pos = t => { const r = w.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 }; };
    w.addEventListener('touchstart', e => {
      e.preventDefault(); const t = e.changedTouches[0]; const g = pos();
      this.id = t.identifier; this.held = true; this.cx = g.cx; this.cy = g.cy;
      this.center = Math.hypot(t.clientX - g.cx, t.clientY - g.cy) < g.r * 0.35;
      this.startA = Math.atan2(t.clientY - g.cy, t.clientX - g.cx); this.startX = t.clientX; this.base = this.angle; this.lastA = this.startA; this.acc = 0;
      w.classList.add('on');
    }, { passive: false });
    w.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.id) {
        if (this.center) this.angle = clamp(this.base + (t.clientX - this.startX) / 60, -this.MAX, this.MAX);
        else {
          const a = Math.atan2(t.clientY - this.cy, t.clientX - this.cx);
          this.acc += angNorm(a - this.lastA); this.lastA = a; // 누적해서 한 바퀴 넘게 돌려도 튀지 않게
          this.angle = clamp(this.base + this.acc, -this.MAX, this.MAX);
        }
      }
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === this.id) { this.held = false; this.id = null; w.classList.remove('on'); } };
    w.addEventListener('touchend', end); w.addEventListener('touchcancel', end);
    const pedal = (id, key) => {
      const b = document.getElementById(id);
      b.addEventListener('touchstart', e => { e.preventDefault(); this[key] = 1; b.classList.add('on'); buzz(8); }, { passive: false });
      const up = e => { e.preventDefault(); this[key] = 0; b.classList.remove('on'); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    };
    pedal('pedal-gas', 'gas'); pedal('pedal-brake', 'brake');
  },
  reset() { this.angle = 0; this.held = false; this.gas = this.brake = this.gasV = this.brakeV = 0; document.querySelectorAll('.pedal').forEach(p => p.classList.remove('on')); },
  update(dt) {
    if (!this.held) this.angle = smooth(this.angle, 0, 9, dt);
    this.gasV = smooth(this.gasV, this.gas, this.gas ? 10 : 20, dt);
    this.brakeV = smooth(this.brakeV, this.brake, this.brake ? 14 : 20, dt);
    if (this.el) this.el.style.transform = `rotate(${this.angle}rad)`;
  },
  get steer() {
    const x = clamp(this.angle / 1.9, -1, 1);
    if (Math.abs(x) < 0.03) return 0;
    return clamp(sign(x) * Math.pow(Math.abs(x), 1.35) * Settings.sens, -1, 1);
  },
};
