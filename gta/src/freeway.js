'use strict';
/* =====================================================================
 * freeway.js — 레드 카운티 고속도로망 (v2.22)
 *
 *  바둑판 도로(노드·간선)와 따로 도는 '굽은 고속도로'. 실제 고속도로처럼
 *   두 다리에서 들어와 곡선으로 퍼지고, Y자 분기점에서 갈라졌다 합쳐진다.
 *   - 북부 68번 고속도로: 북쪽 다리 → 서부 분기점 → 동부 분기점 → 파인 베이
 *   - 남부 68번 고속도로: 남쪽 다리 → 샌디 밸리 분기점 → 골든 필즈 분기점 → 골든 필즈
 *   - 서부 연결선(평원) · 동부 연결선(솔트 레이크 동쪽)이 남북을 잇는다 → 카운티를 한 바퀴 도는 순환로
 *  땅: 가운데는 도로(ROAD, roadK 8 + hwLine), 가장자리는 도로지만 원래 땅 색(fwyG)으로 칠하고
 *      그 위에 부드러운 아스팔트 띠를 그린다 (2D 화면과 3D 바닥 텍스처가 같은 drawGround를 쓴다)
 *  교통: 차는 차선 점(진행 방향 오른쪽 2차로)을 따라가고, 분기점에선 꺾이지 않는 쪽으로만 갈라진다.
 *        끝(다리·마을)에 닿으면 바둑판 교통으로 넘어간다. 다리에서 오는 차도 고속도로로 올라탄다.
 * ===================================================================== */

const FWY_HW = 9.4;            // 반폭(m): 중앙분리대 0.6 + 차로 3.6×2 + 갓길 1.6
const FWY_LANE = [2.4, 6.0];   // 차선 중심(진행 방향 오른쪽으로 m)
const FWY_STEP = 4;            // 중심선 샘플 간격(m)
const FWY_LINES = [FWY_HW - 1.3, -(FWY_HW - 1.3), 4.2, -4.2, 0.32, -0.32]; // 가장자리 · 차로 점선 · 중앙 겹선

function catmull(pts, step) { // 타일 좌표 제어점 → 픽셀 좌표 촘촘한 점
  const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
  for (let k = 1; k < P.length - 2; k++) {
    const [p0, p1, p2, p3] = [P[k - 1], P[k], P[k + 1], P[k + 2]];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * T, n = Math.max(2, Math.ceil(L / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]) * T, y: f(p0[1], p1[1], p2[1], p3[1]) * T });
    }
  }
  const e = pts[pts.length - 1]; out.push({ x: e[0] * T, y: e[1] * T });
  // 고르게 다시 뽑기
  const res = [out[0]]; let acc = 0;
  for (let i = 1; i < out.length; i++) {
    let a = res[res.length - 1]; const b = out[i]; let d = Math.hypot(b.x - a.x, b.y - a.y);
    while (acc + d >= step) { const r = (step - acc) / d; const p = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r }; res.push(p); a = p; d = Math.hypot(b.x - a.x, b.y - a.y); acc = 0; }
    acc += d;
  }
  const last = out[out.length - 1], rl = res[res.length - 1]; if (Math.hypot(last.x - rl.x, last.y - rl.y) > step * 0.3) res.push(last); else res[res.length - 1] = last;
  return res;
}

// genCounty 안에서 길을 깐 뒤 부른다 (마을·농장·나무보다 먼저 → 그것들이 고속도로 위에 생기지 않는다)
function fwyGen(W, info) {
  const yN = info.yN + 1, yS = info.yS + 1, cN = info.coastX(info.yN), cS = info.coastX(info.yS);
  const J = { // 분기점·끝 (타일 좌표). end: 바둑판 도로로 넘어가는 끝
    bN: [cN, yN, 'end'], wN: [800, 211], eN: [1118, 226], pb: [1300, 80, 'end'],
    bS: [cS, yS, 'end'], wS: [880, 501], eS: [1122, 468], gf: [1147, 452, 'end'],
  };
  const S = [
    ['bN', [[cN + 30, yN], [745, yN + 3], [780, 204]], 'wN', '북부 68번 고속도로'],
    ['wN', [[860, 216], [930, 223], [1000, 217], [1065, 214]], 'eN', '북부 68번 고속도로'],
    ['eN', [[1165, 206], [1215, 170], [1255, 125], [1285, 97]], 'pb', '파인 베이 연결로'],
    ['wN', [[828, 238], [842, 290], [838, 350], [848, 420], [866, 470]], 'wS', '서부 연결선'],
    ['bS', [[cS + 30, yS], [740, yS + 3], [800, 492], [845, 500]], 'wS', '남부 68번 고속도로'],
    ['wS', [[930, 506], [990, 505], [1050, 492], [1095, 478]], 'eS', '남부 68번 고속도로'],
    ['eN', [[1136, 262], [1141, 330], [1136, 400], [1128, 440]], 'eS', '동부 연결선'],
    ['eS', [[1135, 461]], 'gf', '골든 필즈 연결로'],
  ];
  const F = W.fwy = { nodes: {}, segs: [] };
  for (const [k, v] of Object.entries(J)) F.nodes[k] = { k, x: v[0] * T, y: v[1] * T, end: v[2] === 'end', segs: [] };
  for (const [a, mid, b, name] of S) {
    const pts = catmull([J[a].slice(0, 2), ...mid, J[b].slice(0, 2)], FWY_STEP);
    const seg = { id: F.segs.length, a, b, name, pts };
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)], dx = q.x - o.x, dy = q.y - o.y, L = Math.hypot(dx, dy) || 1; p.tx = dx / L; p.ty = dy / L; }
    // 굽은 정도 → 안전 속도 (가로 가속 4.5m/s²)
    for (let i = 0; i < pts.length; i++) { const o = pts[Math.max(0, i - 2)], q = pts[Math.min(pts.length - 1, i + 2)], th = Math.abs(angNorm(Math.atan2(q.ty, q.tx) - Math.atan2(o.ty, o.tx))); pts[i].v = th < 0.01 ? 99 : Math.min(99, Math.sqrt(4.5 * (FWY_STEP * 4) / th)); }
    seg.bb = { x0: Math.min(...pts.map(p => p.x)) - FWY_HW, x1: Math.max(...pts.map(p => p.x)) + FWY_HW, y0: Math.min(...pts.map(p => p.y)) - FWY_HW, y1: Math.max(...pts.map(p => p.y)) + FWY_HW };
    F.segs.push(seg); F.nodes[a].segs.push(seg.id); F.nodes[b].segs.push(seg.id);
  }
  // 분기점: 다른 길의 아스팔트 위에 겹치는 차선·중앙선·가장자리선은 그리지 않는다 (갈라지는 곳이 V자로 깔끔하게)
  for (const seg of F.segs) {
    seg.hide = FWY_LINES.map(() => new Uint8Array(seg.pts.length));
    for (const nk of [seg.a, seg.b]) {
      const N = F.nodes[nk]; if (N.end) continue;
      const others = N.segs.filter(id => id !== seg.id).map(id => F.segs[id]);
      seg.pts.forEach((p, i) => {
        if (Math.hypot(p.x - N.x, p.y - N.y) > 140) return;
        FWY_LINES.forEach((o, li) => { const x = p.x - p.ty * o, y = p.y + p.tx * o; for (const s2 of others) for (const q of s2.pts) { if (Math.abs(q.x - x) > FWY_HW || Math.abs(q.y - y) > FWY_HW) continue; if (Math.abs((x - q.x) * q.ty - (y - q.y) * q.tx) < FWY_HW - 0.6 && Math.abs((x - q.x) * q.tx + (y - q.y) * q.ty) <= FWY_STEP / 2 + 0.01) { seg.hide[li][i] = 1; return; } } });
      });
    }
  }
  // 땅 칠하기: 반폭+2m 안은 도로(가장자리는 원래 땅 색), 가운데는 지도 주황
  W.fwyG = W.fwyG || new Uint8Array(MW * MH);
  for (const seg of F.segs) for (let i = 0; i < seg.pts.length; i++) {
    const p = seg.pts[i], R = FWY_HW + 2, x0 = Math.floor((p.x - R) / T), x1 = Math.floor((p.x + R) / T), y0 = Math.floor((p.y - R) / T), y1 = Math.floor((p.y + R) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < CITY_W || ty < 0 || tx >= MW || ty >= MH) continue;
      const cx = (tx + 0.5) * T, cy = (ty + 0.5) * T, d = Math.abs((cx - p.x) * p.ty - (cy - p.y) * p.tx), along = Math.abs((cx - p.x) * p.tx + (cy - p.y) * p.ty);
      if (d > R || along > FWY_STEP) continue;
      const k = tx + ty * MW, t = W.tiles[k];
      if (t === TL.WATER) continue;
      if (t !== TL.ROAD) { W.fwyG[k] = t === TL.ROCK ? TL.SAND : t; W.tiles[k] = TL.ROAD; W.roadK[k] = 8; W.rockH[k] = 0; }
      if (d < FWY_HW - 3) W.hwLine[k] = 1;
    }
  }
  // 지도 이름
  for (const [name, i, sg] of [['북부 68번', 0.5, 1], ['남부 68번', 0.5, 5], ['서부 연결선', 0.45, 3], ['동부 연결선', 0.5, 6]]) { const p = F.segs[sg].pts[Math.floor(F.segs[sg].pts.length * i)]; W.mapLabels.push({ name, x: p.x + 14, y: p.y - 10, small: true }); }
}

const Fwy = {
  // 진행 방향(dir=+1 a→b, -1 b→a)의 k번 차선 점
  lanePt(seg, i, dir, lane) { const p = seg.pts[i], o = FWY_LANE[lane] * dir; return { x: p.x - p.ty * o, y: p.y + p.tx * o, v: p.v }; },
  // 분기점에서 갈 수 있는 다음 길: 들어온 방향과 60° 이내로 이어지는 쪽만 (Y자에서 되돌아 꺾지 않는다)
  nextOf(seg, dir) {
    const F = World.fwy, nk = dir > 0 ? seg.b : seg.a, N = F.nodes[nk], pe = dir > 0 ? seg.pts[seg.pts.length - 1] : seg.pts[0];
    const inx = pe.tx * dir, iny = pe.ty * dir, out = [];
    for (const id of N.segs) {
      if (id === seg.id) continue; const s = F.segs[id], d2 = s.a === nk ? 1 : -1, q = d2 > 0 ? s.pts[0] : s.pts[s.pts.length - 1];
      if (q.tx * d2 * inx + q.ty * d2 * iny > 0.45) out.push({ seg: s, dir: d2 });
    }
    return { N, out };
  },
  // 경로 이어 붙이기 (aiDrive가 경유점이 모자라면 부른다)
  plan(car) {
    const ai = car.ai, w = ai.fw, F = World.fwy; if (!F) return;
    let guard = 0;
    while (ai.route.length < 14 && guard++ < 40) {
      const seg = F.segs[w.seg], n = seg.pts.length;
      w.i += w.dir * 2;
      if (w.i >= 0 && w.i < n) { const q = this.lanePt(seg, w.i, w.dir, w.lane); if (w.vmul) q.v *= w.vmul; ai.route.push(q); continue; }
      if (w.path) { w.pi = (w.pi + 1) % w.path.length; const [sid, d] = w.path[w.pi]; w.seg = sid; w.dir = d; w.i = d > 0 ? 0 : F.segs[sid].pts.length - 1; continue; } // 정해진 길 (레이스)
      const { N, out } = this.nextOf(seg, w.dir);
      if (!out.length || N.end) { ai.fwEnd = true; return; }
      // 분기: 오른쪽 차선이면 바깥쪽 길을 조금 더 자주 (단순히 무작위)
      const nx = pick(out); w.seg = nx.seg.id; w.dir = nx.dir; w.i = nx.dir > 0 ? 0 : nx.seg.pts.length - 1;
    }
  },
  // 가까운 고속도로 차선에 올라탄다 (같은 방향일 때만)
  near(x, y, hx, hy, maxD = 7) {
    const F = World.fwy; if (!F) return null; let best = null, bd = maxD;
    for (const seg of F.segs) {
      if (x < seg.bb.x0 || x > seg.bb.x1 || y < seg.bb.y0 || y > seg.bb.y1) continue;
      for (let i = 0; i < seg.pts.length; i++) {
        const p = seg.pts[i]; if (Math.abs(p.x - x) > 20 || Math.abs(p.y - y) > 20) continue;
        const dir = p.tx * hx + p.ty * hy >= 0 ? 1 : -1; if (Math.abs(p.tx * hx + p.ty * hy) < 0.8) continue;
        for (const lane of [0, 1]) { const q = this.lanePt(seg, i, dir, lane), d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = { seg: seg.id, i, dir, lane }; } }
      }
    }
    return best;
  },
  join(car, at) {
    const old = car.ai || {};
    car.ai = { mode: 'traffic', route: [], fw: { seg: at.seg, i: at.i, dir: at.dir, lane: at.lane }, cruise: rand(24, 31), stuckT: 0, waitT: 0, revT: 0, ignoreT: 0, honkT: 0, panic: old.panic };
    this.plan(car);
  },
  onRoad(x, y) { const tx = Math.floor(x / T), ty = Math.floor(y / T); return tx >= 0 && ty >= 0 && tx < MW && ty < MH && World.roadK[tx + ty * MW] === 8 && World.tiles[tx + ty * MW] === TL.ROAD; },
  // 인구 관리: 근처 고속도로에 차를 채운다
  populate(f, inner, outer) {
    const F = World.fwy; if (!F) return;
    const segs = F.segs.filter(s => f.x > s.bb.x0 - outer && f.x < s.bb.x1 + outer && f.y > s.bb.y0 - outer && f.y < s.bb.y1 + outer); if (!segs.length) return;
    let n = 0; for (const c of Game.cars) if (c.ai && c.ai.fw && dist2(c.x, c.y, f.x, f.y) < outer * outer * 1.5) n++;
    const want = 14;
    for (let tries = 0; tries < 6 && n < want; tries++) {
      const seg = pick(segs), i = Math.floor(rand(4, seg.pts.length - 4)), dir = chance(0.5) ? 1 : -1, lane = chance(0.5) ? 0 : 1, p = this.lanePt(seg, i, dir, lane);
      const d = dist(p.x, p.y, f.x, f.y); if (d < inner || d > outer) continue;
      if (Game.cars.some(c => dist2(c.x, c.y, p.x, p.y) < 14 * 14)) continue;
      const a = Math.atan2(seg.pts[i].ty * dir, seg.pts[i].tx * dir);
      const type = (typeof Rural !== 'undefined' && Rural.trafficType(f)) || pick(TRAFFIC_MIX);
      const c = new Car(type, p.x, p.y, a); c.driver = 'ai'; c.driverKind = 'civ';
      this.join(c, { seg: seg.id, i, dir, lane }); c.vx = Math.cos(a) * 20; c.vy = Math.sin(a) * 20;
      Game.cars.push(c); n++;
    }
  },
  // 2D·3D 바닥: 부드러운 아스팔트 띠 + 차선 (drawGround 끝에서, 월드 좌표)
  draw() {
    const F = World.fwy; if (!F) return;
    const vx0 = Cam.x - Cam.vw / 2 - 20, vx1 = Cam.x + Cam.vw / 2 + 20, vy0 = Cam.y - Cam.vh / 2 - 20, vy1 = Cam.y + Cam.vh / 2 + 20;
    const vis = F.segs.filter(s => s.bb.x1 > vx0 && s.bb.x0 < vx1 && s.bb.y1 > vy0 && s.bb.y0 < vy1); if (!vis.length) return;
    const path = (seg, off, hid) => { ctx.beginPath(); let started = false; for (let i = 0; i < seg.pts.length; i++) { const p = seg.pts[i]; if ((hid && hid[i]) || p.x < vx0 - 40 || p.x > vx1 + 40 || p.y < vy0 - 40 || p.y > vy1 + 40) { started = false; continue; } const x = p.x - p.ty * off, y = p.y + p.tx * off; if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); } };
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // 갓길 흙 테두리 → 아스팔트
    for (const seg of vis) { path(seg, 0); ctx.strokeStyle = 'rgba(120,112,96,0.55)'; ctx.lineWidth = FWY_HW * 2 + 1.6; ctx.stroke(); }
    for (const seg of vis) { path(seg, 0); ctx.strokeStyle = '#3b3e45'; ctx.lineWidth = FWY_HW * 2; ctx.stroke(); }
    ctx.lineCap = 'butt';
    for (const seg of vis) {
      FWY_LINES.forEach((o, li) => {
        if (li < 2) { ctx.strokeStyle = 'rgba(235,235,230,0.85)'; ctx.lineWidth = 0.22; ctx.setLineDash([]); }
        else if (li < 4) { ctx.strokeStyle = 'rgba(235,235,230,0.85)'; ctx.lineWidth = 0.16; ctx.setLineDash([3, 6]); }
        else { ctx.strokeStyle = '#d9b43a'; ctx.lineWidth = 0.13; ctx.setLineDash([]); }
        path(seg, o, seg.hide[li]); ctx.stroke();
      });
    }
    ctx.setLineDash([]);
    ctx.restore();
  },
};
