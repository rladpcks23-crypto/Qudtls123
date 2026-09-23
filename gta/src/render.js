'use strict';
/* =====================================================================
 * render.js — 탑다운 렌더링
 *
 * GTA 1/2 스타일의 '의사 3D' 건물: 카메라가 도시 위 높이 H에 있다고 보고
 * 높이 h의 지붕 꼭짓점을 화면 중심에서 H/(H−h) 배만큼 밀어낸다(원근 투영).
 * 벽은 바닥 모서리와 지붕 모서리를 잇는 사변형이며, 카메라 쪽을 향한 벽만 그린다.
 * 조명: 주변광으로 채운 라이트맵에 가로등·전조등·화염을 가산 합성한 뒤
 * 장면 위에 곱하기(multiply) 합성 → 밤 풍경.
 * ===================================================================== */

// rot: 화면 회전(운전 중 차 방향이 화면 위쪽). vw/vh는 회전된 화면을 감싸는 월드 축 정렬 영역(컬링용).
const Cam = { x: 0, y: 0, ppm: 8, vw: 100, vh: 60, sw: 100, sh: 60, rot: 0, shake: 0, sx: 0, sy: 0, H: 150, zoomMul: 1 };
function camSetView() {
  Cam.sw = CW / Cam.ppm; Cam.sh = CH / Cam.ppm;
  const c = Math.abs(Math.cos(Cam.rot)), s = Math.abs(Math.sin(Cam.rot));
  Cam.vw = c * Cam.sw + s * Cam.sh; Cam.vh = s * Cam.sw + c * Cam.sh;
}
let canvas, ctx, lightCanvas, lctx, DPR = 1, CW = 0, CH = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, TUNE.dpr);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.floor(CW * DPR); canvas.height = Math.floor(CH * DPR);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  lightCanvas.width = Math.ceil(CW * TUNE.light); lightCanvas.height = Math.ceil(CH * TUNE.light);
}
function toScreen(x, y) {
  const dx = x - Cam.x, dy = y - Cam.y, c = Math.cos(Cam.rot), s = Math.sin(Cam.rot);
  return [(dx * c + dy * s) * Cam.ppm + CW / 2 + Cam.sx, (-dx * s + dy * c) * Cam.ppm + CH / 2 + Cam.sy];
}
function screenToWorld(sx, sy) {
  const lx = (sx - CW / 2 - Cam.sx) / Cam.ppm, ly = (sy - CH / 2 - Cam.sy) / Cam.ppm, c = Math.cos(Cam.rot), s = Math.sin(Cam.rot);
  return [lx * c - ly * s + Cam.x, lx * s + ly * c + Cam.y];
}
function onScreenExact(x, y, m = 0) { const [sx, sy] = toScreen(x, y); return sx > -m && sy > -m && sx < CW + m && sy < CH + m; }
function worldTransform(c = ctx, scale = DPR) {
  c.setTransform(scale, 0, 0, scale, (CW / 2 + Cam.sx) * scale, (CH / 2 + Cam.sy) * scale);
  if (Cam.rot) c.rotate(-Cam.rot);
  c.scale(Cam.ppm, Cam.ppm); c.translate(-Cam.x, -Cam.y);
}
// 높이 z의 점을 원근 투영(월드 좌표계 안에서)
const proj = (x, y, z) => { const f = Cam.H / (Cam.H - z); return [Cam.x + (x - Cam.x) * f, Cam.y + (y - Cam.y) * f]; };

// ---------- 시간/주변광 ----------
const AMB_KEYS = [[0, [0.2, 0.23, 0.4]], [4.5, [0.22, 0.24, 0.42]], [6, [0.75, 0.55, 0.52]], [7.5, [1, 0.96, 0.92]], [12, [1, 1, 1]], [17, [1, 0.97, 0.9]], [18.8, [0.98, 0.66, 0.48]], [20.2, [0.4, 0.36, 0.58]], [21.5, [0.2, 0.23, 0.4]], [24, [0.2, 0.23, 0.4]]];
function ambientAt(h) {
  for (let i = 0; i < AMB_KEYS.length - 1; i++) {
    const [h0, a] = AMB_KEYS[i], [h1, b] = AMB_KEYS[i + 1];
    if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  }
  return [1, 1, 1];
}

// ---------- 지면 ----------
const GROUND = {
  [TL.ROAD]: ['#3b3e45', '#393c43', '#3d4047'],
  [TL.WALK]: ['#a4a49d', '#a09f98', '#a7a7a0'],
  [TL.GRASS]: ['#4f7f40', '#4a783c', '#548544', '#46723a'],
  [TL.SAND]: ['#dcc796', '#d8c290', '#e0cb9c'],
  [TL.LOT]: ['#4a4d53', '#484b51'],
  [TL.PLAZA]: ['#b8a88e', '#b3a389'],
  [TL.DOCK]: ['#7d8083', '#797c7f', '#818487'],
  [TL.BUILD]: ['#2a2e35'],
  [TL.WATER]: ['#1d5a80'],
  [TL.RUNWAY]: ['#2c2e33', '#2a2c31'],
};
function drawGround(amb) {
  const ppm = Cam.ppm;
  const x0 = Math.max(0, Math.floor((Cam.x - Cam.vw / 2 - 2) / T)), x1 = Math.min(MW - 1, Math.floor((Cam.x + Cam.vw / 2 + 2) / T));
  const y0 = Math.max(0, Math.floor((Cam.y - Cam.vh / 2 - 2) / T)), y1 = Math.min(MH - 1, Math.floor((Cam.y + Cam.vh / 2 + 2) / T));
  const tiles = World.tiles, rk = World.roadK;
  const ov = 0.6 / ppm; // 타일 사이 틈 방지
  // 바다 배경
  ctx.fillStyle = '#1d5a80';
  ctx.fillRect(Cam.x - Cam.vw, Cam.y - Cam.vh, Cam.vw * 2, Cam.vh * 2);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const t = tiles[tx + ty * MW];
    if (t === TL.WATER) continue;
    const pal = GROUND[t];
    ctx.fillStyle = pal[Math.floor(hash2(tx, ty) * pal.length)];
    ctx.fillRect(tx * T, ty * T, T + ov, T + ov);
  }
  const tt = Game.time;
  // 물결
  ctx.fillStyle = 'rgba(160,210,235,0.14)';
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tiles[tx + ty * MW] !== TL.WATER) continue;
    const w = Math.sin(tt * 1.3 + tx * 0.9 + ty * 0.5) * 0.5 + 0.5;
    ctx.fillRect(tx * T + w * 1.5, ty * T + 1.2 + w, 1.4, 0.14);
    // 해안 거품
    for (let k = 0; k < 4; k++) {
      const nx = tx + DIRS[k][0], ny = ty + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const nt = tiles[nx + ny * MW];
      if (nt !== TL.WATER) {
        ctx.fillStyle = `rgba(235,245,250,${0.25 + 0.2 * Math.sin(tt * 2 + tx + ty)})`;
        if (k === 0) ctx.fillRect(tx * T + T - 0.5, ty * T, 0.5, T); if (k === 2) ctx.fillRect(tx * T, ty * T, 0.5, T);
        if (k === 1) ctx.fillRect(tx * T, ty * T + T - 0.5, T, 0.5); if (k === 3) ctx.fillRect(tx * T, ty * T, T, 0.5);
        ctx.fillStyle = 'rgba(160,210,235,0.14)';
      }
    }
  }
  // 도로 표시
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = tx + ty * MW, t = tiles[i];
    if (t === TL.ROAD) {
      const k = rk[i], X = tx * T, Y = ty * T;
      if (k === 1) {
        const left = rk[i - 1] !== 1;
        if (left) { ctx.fillStyle = '#d9b43a'; ctx.fillRect(X + T - 0.2, Y, 0.1, T + ov); ctx.fillRect(X + T + 0.1, Y, 0.1, T + ov); }
        const above = rk[i - MW] === 3, below = rk[i + MW] === 3;
        if (above || below) {
          ctx.fillStyle = 'rgba(235,235,230,0.8)';
          for (let s = 0.2; s < T; s += 0.8) ctx.fillRect(X + s, Y + (above ? 0.3 : 1.2), 0.45, 2.4);
          if (!left && above) ctx.fillRect(X, Y + T - 0.35, T, 0.28);
          if (left && below) ctx.fillRect(X, Y + 0.07, T, 0.28);
        }
      } else if (k === 2) {
        const top = rk[i - MW] !== 2;
        if (top) { ctx.fillStyle = '#d9b43a'; ctx.fillRect(X, Y + T - 0.2, T + ov, 0.1); ctx.fillRect(X, Y + T + 0.1, T + ov, 0.1); }
        const lft = rk[i - 1] === 3, rgt = rk[i + 1] === 3;
        if (lft || rgt) {
          ctx.fillStyle = 'rgba(235,235,230,0.8)';
          for (let s = 0.2; s < T; s += 0.8) ctx.fillRect(X + (lft ? 0.3 : 1.2), Y + s, 2.4, 0.45);
          if (!top && rgt) ctx.fillRect(X + 0.07, Y, 0.28, T);
          if (top && lft) ctx.fillRect(X + T - 0.35, Y, 0.28, T);
        }
      }
      // 맨홀/균열
      const h = hash2(tx * 7, ty * 3);
      if (h < 0.04) { ctx.fillStyle = 'rgba(20,20,22,0.5)'; ctx.beginPath(); ctx.arc(X + 2, Y + 2, 0.45, 0, TAU); ctx.fill(); }
    } else if (t === TL.WALK) {
      const X = tx * T, Y = ty * T;
      ctx.fillStyle = 'rgba(60,60,60,0.18)';
      ctx.fillRect(X, Y, T, 0.06); ctx.fillRect(X, Y, 0.06, T); ctx.fillRect(X, Y + T / 2, T, 0.04); ctx.fillRect(X + T / 2, Y, 0.04, T);
      ctx.fillStyle = '#c9c9c2';
      if (tiles[i + 1] === TL.ROAD) ctx.fillRect(X + T - 0.25, Y, 0.25, T + ov);
      if (tiles[i - 1] === TL.ROAD) ctx.fillRect(X, Y, 0.25, T + ov);
      if (tiles[i + MW] === TL.ROAD) ctx.fillRect(X, Y + T - 0.25, T + ov, 0.25);
      if (tiles[i - MW] === TL.ROAD) ctx.fillRect(X, Y, T + ov, 0.25);
    } else if (t === TL.GRASS) {
      const h = hash2(tx, ty * 13);
      if (h < 0.3) { ctx.fillStyle = 'rgba(30,60,25,0.25)'; ctx.beginPath(); ctx.arc(tx * T + h * 10 % 4, ty * T + (h * 37) % 4, 0.6 + h, 0, TAU); ctx.fill(); }
      if (h > 0.93) { ctx.fillStyle = ['#f2e36b', '#f28bb4', '#ffffff'][Math.floor(h * 100) % 3]; ctx.fillRect(tx * T + 1.3, ty * T + 2.1, 0.25, 0.25); ctx.fillRect(tx * T + 2.4, ty * T + 1.2, 0.25, 0.25); }
    } else if (t === TL.PLAZA) {
      ctx.fillStyle = 'rgba(90,70,50,0.15)';
      if ((tx + ty) % 2) ctx.fillRect(tx * T, ty * T, T, T);
      ctx.fillRect(tx * T, ty * T, T, 0.05);
    } else if (t === TL.DOCK) {
      if (tiles[i + 1] === TL.WATER || tiles[i - 1] === TL.WATER || tiles[i + MW] === TL.WATER || tiles[i - MW] === TL.WATER) {
        ctx.fillStyle = '#d9b43a';
        for (let s = 0; s < T; s += 1) ctx.fillRect(tx * T + s, ty * T + (s % 2) * 0.1, 0.5, 0.2);
      }
      if (hash2(tx, ty) < 0.08) { ctx.fillStyle = 'rgba(40,30,20,0.25)'; ctx.beginPath(); ctx.arc(tx * T + 2, ty * T + 2, 1.1, 0, TAU); ctx.fill(); }
    }
  }
  // 활주로 표시 · 헬기 착륙장
  if (World.base) {
    const B = World.base;
    if (Cam.y - Cam.vh / 2 < B.y1 + 10) {
      const ry0 = 9 * T, ry1 = 14 * T, cy = (ry0 + ry1) / 2, rx0 = 12 * T, rx1 = (MW - 13) * T;
      ctx.fillStyle = 'rgba(240,240,235,0.85)';
      for (let x = rx0 + 20; x < rx1 - 20; x += 12) ctx.fillRect(x, cy - 0.2, 6, 0.4);
      for (const ex of [rx0 + 2, rx1 - 12]) for (let k = 0; k < 6; k++) ctx.fillRect(ex, ry0 + 1.5 + k * 3, 10, 1.4);
      ctx.fillStyle = 'rgba(242,193,78,0.8)'; ctx.fillRect(rx0, ry0 + 0.3, rx1 - rx0, 0.25); ctx.fillRect(rx0, ry1 - 0.55, rx1 - rx0, 0.25);
      for (const h of World.helipads || []) {
        ctx.strokeStyle = 'rgba(240,240,235,0.9)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(h.x, h.y, 9, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(240,240,235,0.9)'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', h.x, h.y + 0.5);
      }
      ctx.fillStyle = 'rgba(242,193,78,0.9)'; ctx.font = 'bold 3px "Black Han Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('군사 제한구역 · 무단 출입 금지', B.gate.x, B.gate.y + 5);
    }
  }
  // 주차칸
  ctx.fillStyle = 'rgba(230,230,225,0.7)';
  for (const p of World.parking) {
    if (Math.abs(p.x - Cam.x) > Cam.vw / 2 + 4 || Math.abs(p.y - Cam.y) > Cam.vh / 2 + 4) continue;
    const dy = p.a < 0 ? -1 : 1;
    ctx.fillRect(p.x - 1.6, p.y - (dy < 0 ? 2.6 : -2.6) - (dy < 0 ? 0 : 2.4), 0.1, 2.4 + 0.2);
    ctx.fillRect(p.x + 1.5, p.y - (dy < 0 ? 2.6 : -2.6) - (dy < 0 ? 0 : 2.4), 0.1, 2.4 + 0.2);
  }
  // 특수 장소 바닥
  for (const key of ['spray', 'spray2', 'garage', 'dealer', 'mygarage']) {
    const pl = World.places[key]; if (!pl) continue;
    const L = pl.lot, X0 = L.x0 * T, Y0 = L.y0 * T, W = (L.x1 - L.x0 + 1) * T, H = (L.y1 - L.y0 + 1) * T;
    if (Math.abs(pl.x - Cam.x) > Cam.vw / 2 + W || Math.abs(pl.y - Cam.y) > Cam.vh / 2 + H) continue;
    const dl = key === 'dealer' || key === 'mygarage', col = key === 'garage' ? '#f2c14e' : key === 'mygarage' ? '#9be15d' : dl ? '#c77dff' : '#6fe0ff';
    ctx.fillStyle = key === 'garage' ? '#3b3f47' : dl ? '#3a3448' : '#3a4a5c';
    ctx.fillRect(X0, Y0, W, H);
    ctx.strokeStyle = col; ctx.lineWidth = 0.3; ctx.setLineDash([1, 0.8]);
    ctx.strokeRect(X0 + 0.8, Y0 + 0.8, W - 1.6, H - 1.6); ctx.setLineDash([]);
    if (dl) { ctx.strokeStyle = 'rgba(240,240,235,0.8)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(pl.x, pl.y, Math.min(W, H) / 2 - 2, 0, TAU); ctx.stroke(); }
    ctx.save(); ctx.translate(pl.x, pl.y); ctx.fillStyle = key === 'garage' ? 'rgba(242,193,78,0.55)' : dl ? 'rgba(199,125,255,0.7)' : 'rgba(111,224,255,0.55)';
    ctx.font = 'bold 1.8px "Black Han Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(key === 'garage' ? '차고' : key === 'mygarage' ? 'MY GARAGE' : dl ? 'NEON MOTORS' : 'PAY\'N\'SPRAY', 0, 0); ctx.restore();
  }
}

// 신호등, 가로등 기둥
function drawStreetFurniture() {
  for (const n of World.nodes) {
    if (Math.abs(n.x - Cam.x) > Cam.vw / 2 + 12 || Math.abs(n.y - Cam.y) > Cam.vh / 2 + 12) continue;
    if (!n.light) continue;
    for (let d = 0; d < 4; d++) {
      if (n.adj[(d + 2) % 4] < 0) continue; // d 방향으로 들어오는 진입로
      const r = rightOf(d);
      const x = n.x - DIRS[d][0] * (2 * T + 0.3) + r[0] * (T + 0.6), y = n.y - DIRS[d][1] * (2 * T + 0.3) + r[1] * (T + 0.6);
      const st = lightState(n, d);
      ctx.fillStyle = '#1b1d21'; ctx.fillRect(x - 0.35, y - 0.35, 0.7, 0.7);
      ctx.fillStyle = st === 'g' ? '#39e36b' : st === 'y' ? '#ffc933' : '#ff3b3b';
      ctx.beginPath(); ctx.arc(x, y, 0.24, 0, TAU); ctx.fill();
    }
    // 보행자 신호: 각 진입로 횡단보도 양 끝 (차량 신호가 빨간불이면 초록 보행 신호)
    for (let d = 0; d < 4; d++) {
      if (n.adj[(d + 2) % 4] < 0) continue;
      const walk = lightState(n, d) === 'r';
      const r = rightOf(d);
      for (const side of [-1, 1]) {
        const x = n.x - DIRS[d][0] * T * 1.5 + r[0] * side * (T + 0.55), y = n.y - DIRS[d][1] * T * 1.5 + r[1] * side * (T + 0.55);
        ctx.fillStyle = '#15171b'; ctx.fillRect(x - 0.28, y - 0.28, 0.56, 0.56);
        ctx.fillStyle = walk ? '#6dff9a' : '#ff5a4a'; ctx.fillRect(x - 0.18, y - 0.18, 0.36, 0.36);
      }
    }
  }
  ctx.fillStyle = '#2b2d31';
  for (const l of World.lamps) {
    if (Math.abs(l.x - Cam.x) > Cam.vw / 2 + 4 || Math.abs(l.y - Cam.y) > Cam.vh / 2 + 4) continue;
    ctx.beginPath(); ctx.arc(l.x, l.y, 0.2, 0, TAU); ctx.fill();
  }
}

function drawDecals() {
  const now = Game.time;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.28;
  const vx = Cam.vw / 2 + 5, vy = Cam.vh / 2 + 5;
  ctx.beginPath();
  for (const s of Decals.skids) {
    if (Math.abs(s[0] - Cam.x) > vx || Math.abs(s[1] - Cam.y) > vy) continue;
    ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]);
  }
  ctx.strokeStyle = 'rgba(15,15,15,0.35)'; ctx.stroke();
  for (const s of Decals.scorch_) {
    if (Math.abs(s.x - Cam.x) > vx || Math.abs(s.y - Cam.y) > vy) continue;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.6);
    g.addColorStop(0, 'rgba(10,8,6,0.8)'); g.addColorStop(0.6, 'rgba(20,16,12,0.45)'); g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 1.6, 0, TAU); ctx.fill();
  }
  for (const b of Decals.blood_) {
    if (Math.abs(b.x - Cam.x) > vx || Math.abs(b.y - Cam.y) > vy) continue;
    const age = now - b.t, a = clamp(1 - (age - 60) / 30, 0, 1);
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(110,10,12,${0.75 * a})`;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * Math.min(1, 0.4 + age * 0.3), b.r * 0.8 * Math.min(1, 0.4 + age * 0.3), (b.x * 7) % 3, 0, TAU); ctx.fill();
  }
}

// ---------- 그림자 (낮) ----------
function sunVec() {
  const h = Game.clock / 60;
  const t = clamp((h - 6) / 13, 0, 1);
  const ang = lerp(-0.4, Math.PI + 0.4, t);
  const len = 0.22 + Math.abs(Math.cos(t * Math.PI)) * 0.38;
  return [-Math.cos(ang) * len, 0.55 * len];
}
function drawShadows(amb) {
  const day = clamp((amb[0] + amb[1] + amb[2]) / 3 * 1.4 - 0.4, 0, 1);
  if (day <= 0.02) return;
  const [sx, sy] = sunVec();
  ctx.fillStyle = `rgba(10,15,30,${0.28 * day})`;
  ctx.beginPath();
  for (const b of World.buildings) {
    const X0 = b.x0 * T, Y0 = b.y0 * T, X1 = (b.x1 + 1) * T, Y1 = (b.y1 + 1) * T;
    const ox = sx * b.h, oy = sy * b.h;
    if (X1 + Math.max(0, ox) < Cam.x - Cam.vw / 2 || X0 + Math.min(0, ox) > Cam.x + Cam.vw / 2 || Y1 + Math.max(0, oy) < Cam.y - Cam.vh / 2 || Y0 + Math.min(0, oy) > Cam.y + Cam.vh / 2) continue;
    // 직사각형 + 이동된 직사각형의 볼록껍질
    const pts = ox >= 0 ? (oy >= 0 ? [[X0, Y0], [X1, Y0], [X1 + ox, Y0 + oy], [X1 + ox, Y1 + oy], [X0 + ox, Y1 + oy], [X0, Y1]] : [[X0, Y1], [X0, Y0], [X0 + ox, Y0 + oy], [X1 + ox, Y0 + oy], [X1 + ox, Y1 + oy], [X1, Y1]])
      : (oy >= 0 ? [[X1, Y0], [X1, Y1], [X1 + ox, Y1 + oy], [X0 + ox, Y1 + oy], [X0 + ox, Y0 + oy], [X0, Y0]] : [[X0, Y0], [X1, Y0], [X1, Y1], [X1 + ox, Y1 + oy], [X0 + ox, Y1 + oy], [X0 + ox, Y0 + oy]]);
    ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath();
  }
  for (const t of World.trees) {
    if (Math.abs(t.x - Cam.x) > Cam.vw / 2 + 8 || Math.abs(t.y - Cam.y) > Cam.vh / 2 + 8) continue;
    ctx.moveTo(t.x + sx * t.h + t.r, t.y + sy * t.h); ctx.arc(t.x + sx * t.h, t.y + sy * t.h, t.r, 0, TAU);
  }
  ctx.fill();
  return [sx, sy, day];
}

// ---------- 차량 ----------
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawCar(c, shadow) {
  const L = c.L, W = c.W, st = c.V.style;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.32)'; rr(ctx, -L / 2 + shadow[0] * 1.2, -W / 2 + shadow[1] * 1.2, L, W, st === 'bike' ? 0.35 : 0.5); ctx.fill(); }
  if (st === 'bike') { drawBike(c); ctx.restore(); return; }
  if (st === 'tank' || st === 'milheli' || st === 'jet') { drawMilVehicle(c); ctx.restore(); return; }
  if (st === 'boat' || st === 'jetski') { drawBoat(c); ctx.restore(); return; }
  // 바퀴
  ctx.fillStyle = '#111';
  const wx = L * 0.3, wy = W / 2 - 0.12;
  for (const [x, y, s] of [[wx, wy, 1], [wx, -wy, 1], [-wx, wy, 0], [-wx, -wy, 0]]) {
    ctx.save(); ctx.translate(x, y); if (s) ctx.rotate(c.steer); ctx.fillRect(-0.35, -0.16, 0.7, 0.32); ctx.restore();
  }
  const body = c.dead ? '#26272a' : c.color;
  const dark = c.dead ? '#1a1a1c' : shade(c.color, -0.35), light = c.dead ? '#303134' : shade(c.color, 0.25);
  if (st === 'truck' || st === 'armored') {
    // 화물칸 + 운전실
    ctx.fillStyle = st === 'armored' ? (c.dead ? '#222' : '#39463a') : (c.dead ? '#2a2a2a' : '#e6e6e6');
    rr(ctx, -L / 2, -W / 2, L * 0.7, W, 0.2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.06;
    for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(-L / 2 + k * L * 0.7 / 6, -W / 2 + 0.1); ctx.lineTo(-L / 2 + k * L * 0.7 / 6, W / 2 - 0.1); ctx.stroke(); }
    ctx.fillStyle = body; rr(ctx, L * 0.22, -W / 2 + 0.05, L * 0.28, W - 0.1, 0.35); ctx.fill();
    ctx.fillStyle = '#16222e'; ctx.fillRect(L * 0.36, -W / 2 + 0.25, 0.4, W - 0.5);
    if (st === 'armored') { ctx.fillStyle = '#c9a43a'; ctx.font = 'bold 0.9px sans-serif'; ctx.textAlign = 'center'; ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillText('₩', 0, L * 0.12); ctx.restore(); }
  } else {
    ctx.fillStyle = body; rr(ctx, -L / 2, -W / 2, L, W, st === 'van' || st === 'swat' ? 0.3 : 0.55); ctx.fill();
    // 측면 음영
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-L / 2 + 0.3, W / 2 - 0.25, L - 0.6, 0.2); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-L / 2 + 0.3, -W / 2 + 0.05, L - 0.6, 0.18);
    let wsF, wsR, roofF, roofR;
    if (st === 'van' || st === 'swat' || st === 'ambulance') { wsF = L * 0.32; wsR = L * 0.22; roofF = L * 0.3; roofR = -L * 0.47; }
    else if (st === 'sports') { wsF = L * 0.2; wsR = L * 0.02; roofF = L * 0.02; roofR = -L * 0.18; }
    else if (st === 'compact') { wsF = L * 0.2; wsR = L * 0.06; roofF = L * 0.06; roofR = -L * 0.3; }
    else { wsF = L * 0.2; wsR = L * 0.06; roofF = L * 0.06; roofR = -L * 0.24; }
    // 앞유리
    ctx.fillStyle = c.dead ? '#111' : '#1b2735';
    ctx.beginPath(); ctx.moveTo(wsF, -W / 2 + 0.22); ctx.lineTo(wsF, W / 2 - 0.22); ctx.lineTo(wsR, W / 2 - 0.14); ctx.lineTo(wsR, -W / 2 + 0.14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(180,210,240,0.18)'; ctx.fillRect(wsR + 0.05, -W / 2 + 0.3, 0.2, W * 0.35);
    // 지붕
    if (st !== 'van' && st !== 'swat' && st !== 'ambulance') {
      ctx.fillStyle = c.dead ? '#222' : (st === 'police' ? '#f4f4f4' : light);
      rr(ctx, roofR, -W / 2 + 0.16, roofF - roofR, W - 0.32, 0.25); ctx.fill();
      ctx.fillStyle = c.dead ? '#111' : '#1b2735';
      ctx.beginPath(); ctx.moveTo(roofR, -W / 2 + 0.2); ctx.lineTo(roofR, W / 2 - 0.2); ctx.lineTo(roofR - 0.45, W / 2 - 0.28); ctx.lineTo(roofR - 0.45, -W / 2 + 0.28); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = c.dead ? '#222' : (st === 'swat' ? '#34393f' : light);
      rr(ctx, roofR, -W / 2 + 0.12, roofF - roofR, W - 0.24, 0.2); ctx.fill();
      if (st === 'ambulance' && !c.dead) {
        ctx.fillStyle = '#d7262e'; ctx.fillRect(-L / 2 + 0.1, -W / 2 + 0.02, L - 0.2, 0.16); ctx.fillRect(-L / 2 + 0.1, W / 2 - 0.18, L - 0.2, 0.16);
        ctx.fillRect(-1.2, -0.18, 1.3, 0.36); ctx.fillRect(-0.73, -0.65, 0.36, 1.3);
        const f = Math.floor(Game.time * 7) % 2; ctx.fillStyle = c.siren ? (f ? '#ff2d2d' : '#ffe0e0') : '#8a2020'; ctx.fillRect(roofF - 0.5, -0.8, 0.35, 1.6);
      }
      if (st === 'swat') { ctx.fillStyle = '#9aa3ad'; ctx.font = 'bold 0.8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillText('SWAT', 0, 0.6); ctx.restore(); }
    }
    // 보닛 라인
    ctx.strokeStyle = dark; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(wsF + 0.1, -W * 0.25); ctx.lineTo(L / 2 - 0.25, -W * 0.2); ctx.moveTo(wsF + 0.1, W * 0.25); ctx.lineTo(L / 2 - 0.25, W * 0.2); ctx.stroke();
    if (st === 'sports' && !c.dead) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(-L / 2 + 0.1, -0.22, L - 0.2, 0.12); ctx.fillRect(-L / 2 + 0.1, 0.1, L - 0.2, 0.12); }
    if (st === 'muscle' && !c.dead) { ctx.fillStyle = '#111'; ctx.fillRect(wsF + 0.3, -0.3, 0.9, 0.6); }
    if (st === 'taxi' && !c.dead) { ctx.fillStyle = '#222'; ctx.fillRect(-0.4, -0.45, 0.5, 0.9); ctx.fillStyle = '#ffe680'; ctx.fillRect(-0.35, -0.4, 0.4, 0.8); ctx.fillStyle = '#111'; for (let k = 0; k < 4; k++) ctx.fillRect(-L / 2 + 0.3 + k * 0.4, W / 2 - 0.2, 0.2, 0.12); }
    if (st === 'police' && !c.dead) {
      ctx.fillStyle = '#16181c'; ctx.fillRect(wsF + 0.05, -W / 2, L / 2 - wsF - 0.05, W); ctx.fillRect(-L / 2, -W / 2, L / 2 + roofR - 0.5, W);
      const f = Math.floor(Game.time * 8) % 2;
      ctx.fillStyle = c.siren ? (f ? '#ff2d2d' : '#5a1010') : '#7a2020'; ctx.fillRect(-0.3, -0.75, 0.45, 0.7);
      ctx.fillStyle = c.siren ? (f ? '#0f2a6a' : '#2d6bff') : '#20306a'; ctx.fillRect(-0.3, 0.05, 0.45, 0.7);
    }
  }
  // 전조등/후미등
  if (!c.dead) {
    ctx.fillStyle = '#fff7d6'; ctx.fillRect(L / 2 - 0.18, -W / 2 + 0.18, 0.16, 0.38); ctx.fillRect(L / 2 - 0.18, W / 2 - 0.56, 0.16, 0.38);
    ctx.fillStyle = c.brakeLight ? '#ff2a2a' : '#8a1a1a'; ctx.fillRect(-L / 2 + 0.02, -W / 2 + 0.16, 0.14, 0.4); ctx.fillRect(-L / 2 + 0.02, W / 2 - 0.56, 0.14, 0.4);
  }
  if (c.alarmT > 0 && !c.dead && Math.floor(Game.time * 5) % 2) { ctx.fillStyle = '#ffb020'; for (const [x, y] of [[L / 2 - 0.2, -W / 2 + 0.15], [L / 2 - 0.2, W / 2 - 0.15], [-L / 2 + 0.2, -W / 2 + 0.15], [-L / 2 + 0.2, W / 2 - 0.15]]) { ctx.beginPath(); ctx.arc(x, y, 0.22, 0, TAU); ctx.fill(); } }
  // 손상
  const dmg = 1 - c.hp / c.maxHp;
  if (!c.dead && dmg > 0.3) {
    ctx.fillStyle = `rgba(20,20,20,${(dmg - 0.3) * 0.5})`;
    const s = c.id * 13.7;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(((s * (k + 1)) % L) - L / 2, ((s * (k + 3)) % W) - W / 2, 0.3 + dmg * 0.4, 0, TAU); ctx.fill(); }
  }
  if (c.burnT > 0 && !c.dead) { ctx.fillStyle = `rgba(255,${120 + Math.random() * 80 | 0},20,${0.25 + Math.random() * 0.2})`; rr(ctx, -L / 2, -W / 2, L, W, 0.5); ctx.fill(); }
  ctx.restore();
}

function drawBike(c) {
  const col = c.dead ? '#26272a' : c.color;
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(-0.72, 0, 0.36, 0.11, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(0.72, 0); ctx.rotate(c.steer); ctx.beginPath(); ctx.ellipse(0, 0, 0.34, 0.1, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.moveTo(-0.15, -0.38); ctx.lineTo(-0.15, 0.38); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#2b2d31'; ctx.fillRect(-0.8, -0.1, 1.5, 0.2);
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0.2, 0, 0.36, 0.2, 0, 0, TAU); ctx.fill(); ctx.fillRect(-0.9, -0.12, 0.35, 0.24);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(0.05, -0.05, 0.35, 0.05);
  ctx.fillStyle = '#141414'; ctx.fillRect(-0.55, -0.14, 0.5, 0.28);
  if (!c.dead) { ctx.fillStyle = '#fff7d6'; ctx.fillRect(1.0, -0.06, 0.08, 0.12); ctx.fillStyle = c.brakeLight ? '#ff2a2a' : '#8a1a1a'; ctx.fillRect(-1.08, -0.06, 0.06, 0.12); }
  if (c.driver) {
    const P = Game.player, isP = c.driver === 'player';
    const jacket = isP ? P.shirt : (c.riderCol || (c.riderCol = pick(['#2b2d42', '#6e1414', '#3b4a6b', '#1d1d1d'])));
    ctx.fillStyle = jacket; ctx.beginPath(); ctx.ellipse(-0.25, 0, 0.22, 0.3, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = jacket; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.moveTo(-0.15, -0.22); ctx.lineTo(0.55, -0.34 + c.steer * 0.2); ctx.moveTo(-0.15, 0.22); ctx.lineTo(0.55, 0.34 + c.steer * 0.2); ctx.stroke();
    ctx.fillStyle = isP ? '#101418' : (c.helmet || (c.helmet = pick(['#f2f2f2', '#e0262b', '#111', '#f2c200']))); ctx.beginPath(); ctx.arc(-0.12, 0, 0.18, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(120,180,255,0.5)'; ctx.fillRect(-0.02, -0.1, 0.07, 0.2);
  }
}

// ---------- 보행자 ----------
function drawBoat(c) { // drawCar 안(차 좌표계)
  const L = c.L, W = c.W, col = c.dead ? '#26272a' : c.color, b = Math.sin(c.bob || 0) * 0.04;
  ctx.scale(1 + b, 1 - b);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(0, 0, L / 2 + 0.4, W / 2 + 0.35, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.quadraticCurveTo(L * 0.28, -W / 2, -L * 0.1, -W / 2); ctx.lineTo(-L / 2, -W * 0.42); ctx.lineTo(-L / 2, W * 0.42); ctx.lineTo(-L * 0.1, W / 2); ctx.quadraticCurveTo(L * 0.28, W / 2, L / 2, 0); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-L / 2, -W * 0.42, L * 0.08, W * 0.84);
  if (c.V.style === 'boat') {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-L * 0.28, -W * 0.3, L * 0.34, W * 0.6);
    ctx.fillStyle = '#1b2735'; ctx.fillRect(L * 0.02, -W * 0.28, L * 0.07, W * 0.56);
  } else { ctx.fillStyle = '#1d1d1f'; ctx.fillRect(-L * 0.25, -W * 0.2, L * 0.35, W * 0.4); ctx.fillStyle = '#c9ced6'; ctx.fillRect(L * 0.12, -W * 0.3, 0.12, W * 0.6); }
}
function drawPed(p, shadow) {
  if (p.kind === 'dog') { drawDog(p); return; }
  if (p.swim && !p.dead) { // 헤엄: 물결 고리 + 머리와 팔
    const t = Game.time * 3 + p.id;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.strokeStyle = 'rgba(230,245,255,0.55)'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.arc(0, 0, 0.55 + (t % 1) * 0.5, 0, TAU); ctx.stroke();
    ctx.rotate(p.a); ctx.fillStyle = p.skin;
    const sw = Math.sin(t * 2) * 0.35; ctx.fillRect(0.1, -0.45 + sw * 0.3, 0.45, 0.12); ctx.fillRect(0.1, 0.33 - sw * 0.3, 0.45, 0.12);
    ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, TAU); ctx.fill(); ctx.fillStyle = p.hair; ctx.beginPath(); ctx.arc(-0.05, 0, 0.2, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  ctx.save(); ctx.translate(p.x, p.y);
  if (p.dead) {
    ctx.rotate(p.a + Math.PI / 2 * ((p.id % 2) ? 1 : -1));
    ctx.fillStyle = p.pants; ctx.fillRect(-0.9, -0.2, 0.8, 0.4);
    ctx.fillStyle = p.shirt; ctx.beginPath(); ctx.ellipse(0.1, 0, 0.45, 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0.65, 0, 0.17, 0, TAU); ctx.fill();
    ctx.fillStyle = p.skin; ctx.fillRect(0, -0.55, 0.12, 0.3); ctx.fillRect(0.2, 0.25, 0.12, 0.32);
    ctx.restore(); return;
  }
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(shadow[0] * 0.8, shadow[1] * 0.8, 0.42, 0.3, 0, 0, TAU); ctx.fill(); }
  ctx.rotate(p.a);
  const down = p.downT > 0;
  if (down) ctx.scale(1.3, 0.8);
  const sw = Math.sin(p.anim * 3.2) * Math.min(1, p.moving / 1.5) * 0.28;
  // 다리
  ctx.fillStyle = p.pants;
  ctx.beginPath(); ctx.ellipse(sw, -0.13, 0.17, 0.1, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-sw, 0.13, 0.17, 0.1, 0, 0, TAU); ctx.fill();
  // 팔
  const armed = p.weapon && !WEAPONS[p.weapon].melee && (p.state === 'chase' || p.kind === 'player' || p.aimT > 0);
  ctx.fillStyle = p.skin;
  if (armed) {
    ctx.fillStyle = p.shirt; ctx.fillRect(0, -0.28, 0.35, 0.12); ctx.fillRect(0, 0.16, 0.35, 0.12);
    ctx.fillStyle = '#1a1a1a';
    const gl = p.weapon === 'rocket' ? 1.2 : p.weapon === 'shotgun' || p.weapon === 'rifle' ? 0.8 : p.weapon === 'smg' ? 0.55 : 0.4;
    ctx.fillRect(0.3, -0.06, gl, 0.12);
    if (p.weapon === 'rocket') { ctx.fillStyle = '#4b5a3a'; ctx.fillRect(-0.4, -0.12, 1.6, 0.24); }
    if (p.flash > 0) { ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(0.35 + gl + 0.15, 0, 0.22, 0, TAU); ctx.fill(); }
  } else {
    ctx.beginPath(); ctx.arc(-sw * 0.8, -0.34, 0.09, 0, TAU); ctx.arc(sw * 0.8, 0.34, 0.09, 0, TAU); ctx.fill();
    if (p.weapon === 'bat') { ctx.fillStyle = '#9b6b3c'; ctx.fillRect(sw * 0.8, 0.3, 0.8, 0.09); }
  }
  // 몸통
  ctx.fillStyle = p.hitFlash > 0 ? '#ffffff' : p.shirt;
  ctx.beginPath(); ctx.ellipse(0, 0, 0.2, 0.36, 0, 0, TAU); ctx.fill();
  if (p.kind === 'cop') { ctx.fillStyle = '#e8c547'; ctx.fillRect(0.02, -0.2, 0.08, 0.08); }
  drawArchProps(p);
  if (p.armor > 0 || p.kind === 'swat') { ctx.fillStyle = 'rgba(40,50,60,0.6)'; ctx.fillRect(-0.12, -0.25, 0.24, 0.5); }
  // 머리
  ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0.04, 0, 0.16, 0, TAU); ctx.fill();
  ctx.fillStyle = p.hair; ctx.beginPath(); ctx.arc(-0.01, 0, 0.155, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  if (p.kind === 'cop' || p.kind === 'swat') { ctx.fillStyle = p.kind === 'cop' ? '#15213f' : '#1b1f24'; ctx.beginPath(); ctx.arc(0.02, 0, 0.17, 0, TAU); ctx.fill(); ctx.fillRect(0.1, -0.12, 0.12, 0.24); }
  drawArchHead(p);
  ctx.restore();
}

// ---------- 픽업/마커 ----------
function drawPickupIcon(c, type, wname, s = 1) {
  c.save(); c.scale(s, s);
  if (type === 'cash') { c.fillStyle = '#3fbf5f'; c.fillRect(-0.55, -0.32, 1.1, 0.64); c.fillStyle = '#0f4a1f'; c.font = 'bold 0.55px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 0, 0.03); }
  else if (type === 'health') { c.fillStyle = '#fff'; c.fillRect(-0.45, -0.45, 0.9, 0.9); c.fillStyle = '#e0283a'; c.fillRect(-0.12, -0.35, 0.24, 0.7); c.fillRect(-0.35, -0.12, 0.7, 0.24); }
  else if (type === 'armor') { c.fillStyle = '#3d7dd8'; c.beginPath(); c.moveTo(0, -0.5); c.lineTo(0.45, -0.3); c.lineTo(0.35, 0.25); c.lineTo(0, 0.5); c.lineTo(-0.35, 0.25); c.lineTo(-0.45, -0.3); c.closePath(); c.fill(); c.fillStyle = '#bcd6ff'; c.fillRect(-0.05, -0.3, 0.1, 0.55); }
  else if (type === 'bribe') { drawStar(c, 0, 0, 0.55, '#f2c14e'); }
  else if (type === 'package') { c.fillStyle = '#9a6b3a'; c.fillRect(-0.45, -0.45, 0.9, 0.9); c.fillStyle = '#d9b77a'; c.fillRect(-0.45, -0.06, 0.9, 0.12); c.fillRect(-0.06, -0.45, 0.12, 0.9); }
  else if (type === 'weapon') { drawWeaponIcon(c, wname, 1.1, '#f2f2f2'); }
  c.restore();
}
function drawStar(c, x, y, r, col) {
  c.fillStyle = col; c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr_ = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr_, y + Math.sin(a) * rr_); }
  c.closePath(); c.fill();
}
function drawWeaponIcon(c, w, s, col) {
  c.save(); c.scale(s, s); c.fillStyle = col; c.strokeStyle = col;
  if (w === 'fist') { c.beginPath(); c.arc(0, 0, 0.32, 0, TAU); c.fill(); c.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 0; k < 3; k++) c.fillRect(-0.24 + k * 0.17, -0.3, 0.05, 0.25); }
  else if (w === 'bat') { c.lineWidth = 0.14; c.lineCap = 'round'; c.beginPath(); c.moveTo(-0.5, 0.35); c.lineTo(0.5, -0.35); c.stroke(); c.lineWidth = 0.24; c.beginPath(); c.moveTo(0.1, -0.07); c.lineTo(0.5, -0.35); c.stroke(); }
  else if (w === 'pistol') { c.fillRect(-0.4, -0.2, 0.8, 0.2); c.fillRect(-0.4, -0.05, 0.22, 0.4); }
  else if (w === 'smg') { c.fillRect(-0.55, -0.2, 1.05, 0.2); c.fillRect(-0.25, 0, 0.16, 0.4); c.fillRect(0.05, 0, 0.12, 0.3); }
  else if (w === 'shotgun') { c.fillRect(-0.7, -0.14, 1.4, 0.14); c.fillRect(-0.7, -0.05, 0.35, 0.28); c.fillRect(0.0, 0.0, 0.4, 0.12); }
  else if (w === 'rifle') { c.fillRect(-0.7, -0.16, 1.4, 0.16); c.fillRect(-0.7, -0.05, 0.3, 0.3); c.fillRect(-0.1, 0, 0.14, 0.38); c.fillRect(0.4, -0.3, 0.1, 0.16); }
  else if (w === 'grenade') { c.beginPath(); c.arc(0, 0.08, 0.3, 0, TAU); c.fill(); c.fillRect(-0.08, -0.35, 0.16, 0.2); c.fillRect(0.05, -0.35, 0.25, 0.07); }
  else if (w === 'rocket') { c.fillRect(-0.75, -0.13, 1.5, 0.26); c.fillRect(-0.1, 0.1, 0.15, 0.3); c.beginPath(); c.moveTo(0.75, -0.2); c.lineTo(1.0, 0); c.lineTo(0.75, 0.2); c.fill(); }
  c.restore();
}
function drawMarker(x, y, col, big) {
  const t = Game.time, r = (big ? 2.2 : 1.6) + Math.sin(t * 4) * 0.15;
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = col; ctx.globalAlpha = 0.9; ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  // 광선 기둥(의사 3D)
  const [px, py] = proj(x, y, 6);
  ctx.globalAlpha = 0.35; ctx.lineWidth = r * 1.4; ctx.strokeStyle = col; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px - x, py - y); ctx.stroke();
  ctx.globalAlpha = 1; ctx.restore();
}

// ---------- 조명 패스 ----------
// 빛 번짐 스프라이트: 매 프레임 그라디언트를 수백 개 만들지 않도록 색마다 한 번만 그려 둔다
const GlowSpr = {
  m: new Map(),
  get(col) {
    let c = this.m.get(col); if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this.m.set(col, c); return c;
  },
  cone() {
    if (this._cone) return this._cone;
    const c = document.createElement('canvas'); c.width = 160; c.height = 96; // 20m × 12m, 8px/m
    const g = c.getContext('2d'), gr = g.createRadialGradient(0, 48, 0, 0, 48, 160);
    gr.addColorStop(0, 'rgba(255,245,210,1)'); gr.addColorStop(1, 'rgba(255,245,210,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 48 - 6.4); g.lineTo(160, 0); g.lineTo(160, 96); g.lineTo(0, 48 + 6.4); g.closePath(); g.fill();
    return (this._cone = c);
  },
};
function lightPass(amb) {
  const night = 1 - (amb[0] + amb[1] + amb[2]) / 3;
  if (night < 0.03) return;
  const lc = lctx, s = TUNE.light;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  lc.fillStyle = `rgb(${amb[0] * 255 | 0},${amb[1] * 255 | 0},${amb[2] * 255 | 0})`;
  lc.fillRect(0, 0, lightCanvas.width, lightCanvas.height);
  lc.globalCompositeOperation = 'lighter';
  worldTransform(lc, s);
  const glow = (x, y, r, col, a) => {
    if (Math.abs(x - Cam.x) > Cam.vw / 2 + r || Math.abs(y - Cam.y) > Cam.vh / 2 + r) return;
    if (a <= 0.005) return;
    lc.globalAlpha = Math.min(1, a); lc.drawImage(GlowSpr.get(col), x - r, y - r, r * 2, r * 2); lc.globalAlpha = 1;
  };
  const cone = GlowSpr.cone();
  const k = clamp(night * 1.5, 0, 1);
  for (const l of World.lamps) glow(l.x, l.y, 10, '255,196,120', 0.6 * k);
  for (const c of Game.cars) {
    if (c.dead) continue;
    if (Math.abs(c.x - Cam.x) > Cam.vw / 2 + 25 || Math.abs(c.y - Cam.y) > Cam.vh / 2 + 25) continue;
    const f = c.fwd(), rgt = [-f[1], f[0]];
    const hx = c.x + f[0] * c.L / 2, hy = c.y + f[1] * c.L / 2;
    // 전조등 원뿔
    if (!c.V.special || c.type === 'tank') {
      lc.save(); lc.translate(hx, hy); lc.rotate(c.a); lc.globalAlpha = 0.7 * k; lc.drawImage(cone, 0, -6, 20, 12); lc.restore();
    }
    glow(c.x - f[0] * c.L / 2, c.y - f[1] * c.L / 2, c.brakeLight ? 3.5 : 2, '255,40,30', (c.brakeLight ? 0.7 : 0.4) * k);
    if (c.siren) { const fl = Math.floor(Game.time * 8) % 2; glow(c.x, c.y, 9, fl ? '255,40,40' : '50,100,255', 0.8); }
  }
  for (const p of Particles.list) if (p.t === 'fire' && Math.random() < 0.3) glow(p.x, p.y, 5, '255,140,40', 0.35);
  for (const c of Game.cars) if (c.burnT > 0) glow(c.x, c.y, 12, '255,130,40', 0.7);
  for (const f of Effects.flashes) glow(f.x, f.y, f.r, '255,210,140', f.life / f.max);
  for (const pk of Game.pickups) if (!pk.taken) glow(pk.x, pk.y, 3, '255,255,200', 0.35 * k);
  const H = Police.heli;
  if (H && !H.dead) { const tx = Wanted.seen ? Game.player.px : Wanted.searchX, ty = Wanted.seen ? Game.player.py : Wanted.searchY; glow(lerp(H.x, tx, 0.85), lerp(H.y, ty, 0.85), 8, '230,240,255', 0.9 * k); }
  for (const m of allTargets()) glow(m.x, m.y, 5, '255,220,120', 0.4 * k);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightCanvas, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- 건물 (의사 3D) ----------
function drawTrees(amb) {
  const vis = World.trees.filter(t => Math.abs(t.x - Cam.x) < Cam.vw / 2 + 10 && Math.abs(t.y - Cam.y) < Cam.vh / 2 + 10);
  for (const t of vis) {
    const [x, y] = proj(t.x, t.y, t.h), f = Cam.H / (Cam.H - t.h);
    if (t.kind === 'palm') {
      ctx.strokeStyle = tint('#8a6a45', amb); ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = tint('#3f8a3a', amb);
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + t.hue * 3;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 1.1 * f, y + Math.sin(a) * 1.1 * f, 1.3 * f, 0.35 * f, a, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = tint('#5a4a2a', amb); ctx.beginPath(); ctx.arc(x, y, 0.35 * f, 0, TAU); ctx.fill();
    } else {
      const base = t.hue < 0.33 ? '#3d6e34' : t.hue < 0.66 ? '#467a3a' : '#355f30';
      ctx.fillStyle = tint(base, amb, -0.15); ctx.beginPath(); ctx.arc(x, y, t.r * f, 0, TAU); ctx.fill();
      ctx.fillStyle = tint(base, amb, 0.05);
      ctx.beginPath(); ctx.arc(x - 0.4 * f, y - 0.4 * f, t.r * 0.7 * f, 0, TAU); ctx.fill();
      ctx.fillStyle = tint(base, amb, 0.22); ctx.beginPath(); ctx.arc(x - 0.7 * f, y - 0.7 * f, t.r * 0.35 * f, 0, TAU); ctx.fill();
    }
  }
}
function drawBuildings(amb) {
  const night = 1 - (amb[0] + amb[1] + amb[2]) / 3;
  const vis = [];
  for (const b of World.buildings) {
    const X0 = b.x0 * T, Y0 = b.y0 * T, X1 = (b.x1 + 1) * T, Y1 = (b.y1 + 1) * T;
    const f = Cam.H / (Cam.H - b.h), ex = (Cam.vw / 2) * (f - 1) + 2, ey = (Cam.vh / 2) * (f - 1) + 2;
    if (X1 < Cam.x - Cam.vw / 2 - ex || X0 > Cam.x + Cam.vw / 2 + ex || Y1 < Cam.y - Cam.vh / 2 - ey || Y0 > Cam.y + Cam.vh / 2 + ey) continue;
    vis.push(b); b._d = dist2((X0 + X1) / 2, (Y0 + Y1) / 2, Cam.x, Cam.y);
  }
  vis.sort((a, b) => b._d - a._d);
  for (const b of vis) drawBuilding(b, amb, night);
}
const PLACE_MARK = { safehouse: '#9be15d', ammu: '#ff6b5a', ammu2: '#ff6b5a', burger: '#ffb347', burger2: '#ffb347', mart: '#7ae68f', mart2: '#7ae68f', mart3: '#7ae68f', jobcenter: '#6fb6ff', broker: '#ff5d8f' };
const SHOP_ROOF = { safehouse: ['#4a7a3f', '#f2fff0'], ammu: ['#b23a2e', '#f2f2f2'], burger: ['#e0572f', '#ffe08a'], mart: ['#2e8b57', '#f2fff4'], jobcenter: ['#2d5d9f', '#ffffff'], broker: ['#3a2346', '#ff5d8f'] };
function drawBuilding(b, amb, night) {
  const X0 = b.x0 * T, Y0 = b.y0 * T, X1 = (b.x1 + 1) * T, Y1 = (b.y1 + 1) * T, h = b.h;
  const P = (x, y, z) => proj(x, y, z);
  const corners = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
  const roof = corners.map(([x, y]) => P(x, y, h));
  const col = b.color;
  // 벽: 카메라를 향한 면만
  const walls = [];
  if (Cam.y < Y0) walls.push([0, 1, -0.28]); // 북쪽 벽
  if (Cam.x > X1) walls.push([1, 2, -0.42]); // 동쪽
  if (Cam.y > Y1) walls.push([2, 3, -0.5]);  // 남쪽
  if (Cam.x < X0) walls.push([3, 0, -0.36]); // 서쪽
  const floorH = b.kind === 'house' ? 3 : b.kind === 'container' ? 99 : 3.4;
  for (const [i, j, sh] of walls) {
    const a = corners[i], c = corners[j];
    ctx.fillStyle = tint(col, amb, sh);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(roof[j][0], roof[j][1]); ctx.lineTo(roof[i][0], roof[i][1]); ctx.closePath(); ctx.fill();
    // 창문 띠
    if (b.kind !== 'container' && h > 4) {
      const lit = night > 0.35 && b.kind !== 'warehouse';
      ctx.fillStyle = lit ? `rgba(255,${200 + (b.lit * 40) | 0},120,${0.35 + b.lit * 0.5})` : tint('#1d2836', amb, 0.1);
      ctx.beginPath();
      for (let z = 1.1; z + 1.2 < h; z += floorH) {
        const p1 = P(a[0], a[1], z), p2 = P(c[0], c[1], z), p3 = P(c[0], c[1], z + 1.3), p4 = P(a[0], a[1], z + 1.3);
        const ins = 0.08;
        ctx.moveTo(lerp(p1[0], p2[0], ins), lerp(p1[1], p2[1], ins)); ctx.lineTo(lerp(p1[0], p2[0], 1 - ins), lerp(p1[1], p2[1], 1 - ins));
        ctx.lineTo(lerp(p4[0], p3[0], 1 - ins), lerp(p4[1], p3[1], 1 - ins)); ctx.lineTo(lerp(p4[0], p3[0], ins), lerp(p4[1], p3[1], ins)); ctx.closePath();
      }
      ctx.fill();
      if (b.kind === 'tower' || b.kind === 'mid' || b.kind === 'police' || b.kind === 'hospital') {
        // 세로 창살
        ctx.strokeStyle = tint(col, amb, sh - 0.1); ctx.lineWidth = 0.25;
        const n = Math.floor(dist(a[0], a[1], c[0], c[1]) / 2.2);
        ctx.beginPath();
        for (let k = 1; k < n; k++) { const t = k / n, bx = lerp(a[0], c[0], t), by = lerp(a[1], c[1], t); const q = P(bx, by, h); ctx.moveTo(bx, by); ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
      }
    }
    if (b.kind === 'container') {
      ctx.strokeStyle = tint(col, amb, sh - 0.2); ctx.lineWidth = 0.08; ctx.beginPath();
      const n = 8; for (let k = 1; k < n; k++) { const t = k / n, bx = lerp(a[0], c[0], t), by = lerp(a[1], c[1], t); const q = P(bx, by, h); ctx.moveTo(bx, by); ctx.lineTo(q[0], q[1]); } ctx.stroke();
    }
  }
  // 지붕
  if (b.kind === 'house') {
    // 박공지붕: 긴 축을 따라 용마루
    const alongX = (X1 - X0) >= (Y1 - Y0);
    const rH = h + 2.2;
    const r1 = alongX ? P(X0, (Y0 + Y1) / 2, rH) : P((X0 + X1) / 2, Y0, rH), r2 = alongX ? P(X1, (Y0 + Y1) / 2, rH) : P((X0 + X1) / 2, Y1, rH);
    ctx.fillStyle = tint(col, amb, 0.05);
    ctx.beginPath();
    if (alongX) { ctx.moveTo(roof[0][0], roof[0][1]); ctx.lineTo(roof[1][0], roof[1][1]); ctx.lineTo(r2[0], r2[1]); ctx.lineTo(r1[0], r1[1]); }
    else { ctx.moveTo(roof[0][0], roof[0][1]); ctx.lineTo(roof[3][0], roof[3][1]); ctx.lineTo(r2[0], r2[1]); ctx.lineTo(r1[0], r1[1]); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = tint(col, amb, -0.2);
    ctx.beginPath();
    if (alongX) { ctx.moveTo(roof[3][0], roof[3][1]); ctx.lineTo(roof[2][0], roof[2][1]); ctx.lineTo(r2[0], r2[1]); ctx.lineTo(r1[0], r1[1]); }
    else { ctx.moveTo(roof[1][0], roof[1][1]); ctx.lineTo(roof[2][0], roof[2][1]); ctx.lineTo(r2[0], r2[1]); ctx.lineTo(r1[0], r1[1]); }
    ctx.closePath(); ctx.fill();
    // 측면 박공 삼각형
    ctx.fillStyle = tint(col, amb, -0.35);
    ctx.beginPath();
    if (alongX) { if (Cam.x < X0) { ctx.moveTo(roof[0][0], roof[0][1]); ctx.lineTo(roof[3][0], roof[3][1]); ctx.lineTo(r1[0], r1[1]); } if (Cam.x > X1) { ctx.moveTo(roof[1][0], roof[1][1]); ctx.lineTo(roof[2][0], roof[2][1]); ctx.lineTo(r2[0], r2[1]); } }
    else { if (Cam.y < Y0) { ctx.moveTo(roof[0][0], roof[0][1]); ctx.lineTo(roof[1][0], roof[1][1]); ctx.lineTo(r1[0], r1[1]); } if (Cam.y > Y1) { ctx.moveTo(roof[3][0], roof[3][1]); ctx.lineTo(roof[2][0], roof[2][1]); ctx.lineTo(r2[0], r2[1]); } }
    ctx.fill();
    ctx.strokeStyle = tint(col, amb, -0.45); ctx.lineWidth = 0.15; ctx.beginPath(); ctx.moveTo(r1[0], r1[1]); ctx.lineTo(r2[0], r2[1]); ctx.stroke();
    return;
  }
  const roofCol = b.kind === 'hospital' ? '#e9ecef' : b.kind === 'police' ? '#2c3e66' : b.kind === 'warehouse' ? shade(col, 0.1) : col;
  const rc = roofCol.startsWith('#') ? roofCol : col;
  ctx.fillStyle = tint(rc, amb, 0.08);
  ctx.beginPath(); ctx.moveTo(roof[0][0], roof[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(roof[i][0], roof[i][1]); ctx.closePath(); ctx.fill();
  // 파라펫
  if (b.kind !== 'container') {
    ctx.strokeStyle = tint(rc, amb, 0.3); ctx.lineWidth = 0.35; ctx.stroke();
  } else {
    ctx.strokeStyle = tint(rc, amb, -0.25); ctx.lineWidth = 0.07; ctx.beginPath();
    const n = 10; for (let k = 1; k < n; k++) { const t = k / n; ctx.moveTo(lerp(roof[0][0], roof[3][0], t), lerp(roof[0][1], roof[3][1], t)); ctx.lineTo(lerp(roof[1][0], roof[2][0], t), lerp(roof[1][1], roof[2][1], t)); }
    ctx.stroke(); return;
  }
  const f = Cam.H / (Cam.H - h);
  const cx = (roof[0][0] + roof[2][0]) / 2, cy = (roof[0][1] + roof[2][1]) / 2;
  const rw = (roof[1][0] - roof[0][0]), rh = (roof[3][1] - roof[0][1]);
  ctx.save(); ctx.translate(cx, cy);
  if (b.kind === 'warehouse') {
    ctx.strokeStyle = tint(rc, amb, -0.15); ctx.lineWidth = 0.1; ctx.beginPath();
    for (let x = -rw / 2 + 1; x < rw / 2; x += 1.2) { ctx.moveTo(x, -rh / 2); ctx.lineTo(x, rh / 2); } ctx.stroke();
    ctx.fillStyle = tint('#b9d4e0', amb, -0.2); for (let k = -1; k <= 1; k += 2) ctx.fillRect(k * rw / 4 - 1, -rh / 4, 2, rh / 2);
  } else if (b.kind === 'hospital') {
    ctx.fillStyle = tint('#e0283a', amb); ctx.fillRect(-0.9 * f, -3 * f, 1.8 * f, 6 * f); ctx.fillRect(-3 * f, -0.9 * f, 6 * f, 1.8 * f);
  } else if (b.kind === 'police') {
    ctx.fillStyle = tint('#f2f2f2', amb); ctx.font = `bold ${2.2 * f}px "Black Han Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('POLICE', 0, 0);
    ctx.strokeStyle = tint('#f2c14e', amb); ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(0, 0, Math.min(Math.abs(rw), Math.abs(rh)) * 0.4, 0, TAU); ctx.stroke();
  } else if (SHOP_ROOF[b.kind]) {
    const [bg, fg] = SHOP_ROOF[b.kind];
    ctx.fillStyle = tint(bg, amb); ctx.fillRect(-rw / 2 + 0.6, -rh / 2 + 0.6, rw - 1.2, rh - 1.2);
    ctx.fillStyle = tint(fg, amb); ctx.font = `bold ${Math.min(1.8, Math.abs(rw) / Math.max(2, b.label.length) * 0.9) * f}px "Black Han Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.label, 0, 0);
    if (night > 0.35) { ctx.strokeStyle = fg; ctx.globalAlpha = 0.8; ctx.lineWidth = 0.25; ctx.strokeRect(-rw / 2 + 0.9, -rh / 2 + 0.9, rw - 1.8, rh - 1.8); ctx.globalAlpha = 1; }
  } else {
    // 옥상 설비 (결정적 난수)
    let s = b.seed * 1000;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const w = (1 + rnd() * 2.2) * f, hh = (1 + rnd() * 2) * f, x = (rnd() - 0.5) * (Math.abs(rw) - w - 1), y = (rnd() - 0.5) * (Math.abs(rh) - hh - 1);
      ctx.fillStyle = tint(col, amb, -0.2); ctx.fillRect(x + 0.25 * f, y + 0.25 * f, w, hh);
      ctx.fillStyle = tint('#9aa0a8', amb, 0); ctx.fillRect(x, y, w, hh);
    }
    if (b.kind === 'tower' && b.h > 40 && Math.abs(rw) > 12 && Math.abs(rh) > 12) {
      ctx.strokeStyle = tint('#f2c14e', amb); ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(0, 0, 3.5 * f, 0, TAU); ctx.stroke();
      ctx.fillStyle = tint('#f2c14e', amb); ctx.font = `bold ${3 * f}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', 0, 0.2);
    }
    if (b.kind === 'tower' && night > 0.35 && b.lit > 0.7) { // 옥상 네온
      ctx.fillStyle = `rgba(255,${80 + (b.seed * 120) | 0},170,0.8)`; ctx.fillRect(-rw / 2 + 0.4, -rh / 2 + 0.3, rw - 0.8, 0.25);
    }
  }
  ctx.restore();
}

// ---------- 헬기 ----------
function drawHeli(amb, shadow) {
  const H = Police.heli; if (!H) return;
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(H.x + shadow[0] * H.alt * 0.5, H.y + shadow[1] * H.alt * 0.5, 3, 1.4, H.a, 0, TAU); ctx.fill();
    return;
  }
  const [x, y] = proj(H.x, H.y, H.alt), f = Cam.H / (Cam.H - H.alt);
  ctx.save(); ctx.translate(x, y); ctx.rotate(H.a); ctx.scale(f, f);
  ctx.fillStyle = tint('#1c2a4a', amb); ctx.fillRect(-4.2, -0.25, 3.2, 0.5);
  ctx.fillStyle = tint('#e8e8e8', amb); ctx.beginPath(); ctx.ellipse(0, 0, 2.2, 1.1, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = tint('#1c2a4a', amb); ctx.beginPath(); ctx.ellipse(-0.4, 0, 1.6, 1.12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#243a55'; ctx.beginPath(); ctx.ellipse(1.3, 0, 0.8, 0.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = tint('#1c2a4a', amb); ctx.fillRect(-4.4, -0.8, 0.3, 1.6);
  ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 0.25;
  for (let k = 0; k < 4; k++) { const a = H.rotor + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 4.5, Math.sin(a) * 4.5); ctx.stroke(); }
  ctx.fillStyle = 'rgba(40,40,40,0.12)'; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill();
  const fl = Math.floor(Game.time * 3) % 2; ctx.fillStyle = fl ? '#ff3030' : '#3a70ff'; ctx.beginPath(); ctx.arc(-1.5, 0, 0.25, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------- 파티클/이펙트 ----------
function drawParticles(low) {
  for (const p of Particles.list) {
    const isLow = p.t === 'blood' || p.t === 'shell' || p.t === 'debris' || p.t === 'spark';
    if (isLow !== low) continue;
    if (Math.abs(p.x - Cam.x) > Cam.vw / 2 + 3 || Math.abs(p.y - Cam.y) > Cam.vh / 2 + 3) continue;
    const a = p.life / p.max;
    if (p.t === 'spark') { ctx.strokeStyle = `rgba(255,220,120,${a})`; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); }
    else if (p.t === 'blood') { ctx.fillStyle = `rgba(140,10,15,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
    else if (p.t === 'shell') { ctx.fillStyle = '#d4a93a'; ctx.fillRect(p.x, p.y, 0.1, 0.05); }
    else if (p.t === 'debris') { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    else if (p.t === 'fire') { ctx.fillStyle = `rgba(255,${(90 + a * 150) | 0},${(20 + a * 40) | 0},${a * 0.9})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); ctx.fill(); }
    else if (p.t === 'smoke') { ctx.fillStyle = p.col; ctx.globalAlpha = a * 0.45; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
  }
}
function drawEffects() {
  ctx.lineCap = 'round';
  for (const t of Effects.tracers) { ctx.strokeStyle = t.c; ctx.globalAlpha = t.life / 0.06; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  for (const b of Effects.booms) {
    const k = 1 - b.life / b.max;
    ctx.strokeStyle = `rgba(255,230,180,${1 - k})`; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.3 + k * 1.3), 0, TAU); ctx.stroke();
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * (0.6 + k));
    g.addColorStop(0, `rgba(255,250,220,${(1 - k) * 0.95})`); g.addColorStop(0.4, `rgba(255,160,40,${(1 - k) * 0.8})`); g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.6 + k), 0, TAU); ctx.fill();
  }
  for (const p of Game.projectiles) {
    if (p.type === 'rocket') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = '#4b5a3a'; ctx.fillRect(-0.5, -0.12, 1, 0.24); ctx.fillStyle = '#ffcc55'; ctx.beginPath(); ctx.arc(-0.6, 0, 0.2, 0, TAU); ctx.fill(); ctx.restore(); }
    else { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(p.x, p.y, 0.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#3f4a2f'; ctx.beginPath(); ctx.arc(p.x, p.y - p.z * 0.3, 0.2, 0, TAU); ctx.fill(); }
  }
}

// ---------- 비 ----------
const Rain = {
  drops: [],
  draw(intensity) {
    if (intensity <= 0.01) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = Math.floor(TUNE.rain * intensity);
    while (this.drops.length < n) this.drops.push({ x: Math.random() * CW, y: Math.random() * CH, s: rand(0.6, 1) });
    this.drops.length = n;
    ctx.strokeStyle = 'rgba(190,210,235,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const d of this.drops) {
      d.y += 22 * d.s; d.x -= 5 * d.s;
      if (d.y > CH) { d.y = -10; d.x = Math.random() * (CW + 100); }
      if (d.x < -20) d.x = CW + 10;
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 4 * d.s, d.y - 16 * d.s);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(30,40,60,${0.12 * intensity})`; ctx.fillRect(0, 0, CW, CH);
  },
};

// ---------- 전체 장면 ----------
function renderScene() {
  const amb0 = ambientAt(Game.clock / 60);
  const wet = Game.weather.intensity;
  const amb = [amb0[0] * (1 - 0.25 * wet), amb0[1] * (1 - 0.22 * wet), amb0[2] * (1 - 0.12 * wet)];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  worldTransform();
  drawGround(amb);
  drawDecals();
  const sh = drawShadows(amb) || null;
  const shadowV = sh ? [sh[0] * 0.8, sh[1] * 0.8] : [0.15, 0.2];
  drawStreetFurniture();
  // 픽업
  for (const k of Game.pickups) {
    if (k.taken || Math.abs(k.x - Cam.x) > Cam.vw / 2 + 2 || Math.abs(k.y - Cam.y) > Cam.vh / 2 + 2) continue;
    ctx.save(); ctx.translate(k.x, k.y + Math.sin(k.bob) * 0.12);
    ctx.fillStyle = 'rgba(255,255,220,0.18)'; ctx.beginPath(); ctx.arc(0, 0, 0.9, 0, TAU); ctx.fill();
    ctx.rotate(Math.sin(k.bob * 0.5) * 0.3);
    drawPickupIcon(ctx, k.type, k.wname, 0.9); ctx.restore();
  }
  // 미션 마커 / 상점 / 페인트샵 표시
  for (const m of allTargets()) drawMarker(m.x, m.y, m.c, m.big || m.giver);
  for (const [k, pl] of Object.entries(World.places)) { const col = PLACE_MARK[k]; if (col && pl) drawMarker(pl.x, pl.y, col, false); }
  drawParticles(true);
  for (const v of Vendors.list) if (Math.abs(v.x - Cam.x) < Cam.vw / 2 + 4 && Math.abs(v.y - Cam.y) < Cam.vh / 2 + 4) drawVendorCart(v);
  // 보행자(시체 먼저)
  for (const p of Game.peds) if (p.dead && Math.abs(p.x - Cam.x) < Cam.vw / 2 + 2 && Math.abs(p.y - Cam.y) < Cam.vh / 2 + 2) drawPed(p);
  for (const p of Game.peds) if (!p.dead && Math.abs(p.x - Cam.x) < Cam.vw / 2 + 2 && Math.abs(p.y - Cam.y) < Cam.vh / 2 + 2) drawPed(p, shadowV);
  const P = Game.player;
  if (!P.car && !P.hidden && !(P.alt > 1.2) && !(P.dead && Game.state === 'menu')) drawPed(P, shadowV);
  for (const c of Game.cars) if (!airborne(c) && Math.abs(c.x - Cam.x) < Cam.vw / 2 + 6 && Math.abs(c.y - Cam.y) < Cam.vh / 2 + 6) drawCar(c, shadowV);
  drawAirShadows(shadowV);
  drawHeli(amb, shadowV);
  drawEffects();
  drawParticles(false);
  lightPass(amb);
  worldTransform();
  drawTrees(amb);
  drawBuildings(amb);
  drawHeli(amb, null);
  drawAirborne(amb);
  // 떠오르는 텍스트(월드 위치, 화면 크기)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.font = '700 15px "Noto Sans KR", sans-serif';
  for (const t of Effects.texts) { const [sx, sy] = toScreen(t.x, t.y); ctx.globalAlpha = t.life / t.max; ctx.fillStyle = '#000'; ctx.fillText(t.s, sx + 1, sy + 1); ctx.fillStyle = t.c; ctx.fillText(t.s, sx, sy); }
  ctx.globalAlpha = 1;
  Talk.draw();
  Rain.draw(wet);
}
