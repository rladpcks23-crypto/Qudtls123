'use strict';
/* =====================================================================
 * core.js — 수학 유틸, 난수, 입력, 사운드(Web Audio 합성)
 * ===================================================================== */

// ---------- 수학 ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angNorm = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const sign = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// 결정적 도시 생성을 위한 시드 난수 (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 색 유틸: '#rrggbb' → 밝기 조절
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
// 야간 조명을 곱한 색 (건물은 조명 패스 뒤에 그리므로 직접 어둡게 한다)
function tint(hex, amb, f = 0) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${(r * amb[0]) | 0},${(g * amb[1]) | 0},${(b * amb[2]) | 0})`;
}

// ---------- 플랫폼 ----------
// build.py가 PC판/모바일판을 따로 만들 때 맨 앞에 NH_PLATFORM을 넣는다.
const PLATFORM = (typeof NH_PLATFORM !== 'undefined') ? NH_PLATFORM : 'pc';
const IS_MOBILE = PLATFORM === 'mobile';
const TUNE = IS_MOBILE
  ? { dpr: 1.3, light: 1 / 3, cars: [20, 12], peds: [34, 20], particles: 450, rain: 140 }
  : { dpr: 2, light: 1 / 2, cars: [28, 17], peds: [54, 30], particles: 900, rain: 260 };
// 사용자 설정 (브라우저에 저장)
const Settings = {
  camRot: true, // 운전 중 화면을 차 방향으로 회전
  load() { try { const v = localStorage.getItem('nh.camrot'); if (v !== null) this.camRot = v === '1'; } catch (e) { } },
  save() { try { localStorage.setItem('nh.camrot', this.camRot ? '1' : '0'); } catch (e) { } },
};
Settings.load();
function buzz(ms) { if (IS_MOBILE && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { } } }

// ---------- 입력 ----------
// e.code 기반: 한글 IME 상태에서도 WASD가 동작하도록 한다.
const Input = {
  keys: {}, pressed: {},
  mouse: { x: 0, y: 0, down: false, clicked: false, wx: 0, wy: 0, moved: false },
  wheel: 0,
  touch: { on: false, jx: 0, jy: 0, fire: false, hb: false, run: false, stickId: null, sx: 0, sy: 0 },
  usingTouch: false,
};
const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT')) return;
  if (!Input.keys[e.code]) Input.pressed[e.code] = true;
  Input.keys[e.code] = true;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { Input.keys[e.code] = false; });
addEventListener('blur', () => { Input.keys = {}; Input.mouse.down = false; });
const keyDown = (...ks) => ks.some(k => Input.keys[k]);
const keyHit = (...ks) => ks.some(k => Input.pressed[k]);
// ---------- 게임패드 (PC판: Xbox/PlayStation 호환 표준 매핑) ----------
// 버튼은 가상 키 이름(PadA, PadY, …)으로 Input.keys에 합쳐서 키보드와 같은 경로로 처리한다.
const Pad = {
  on: false, lx: 0, ly: 0, rx: 0, ry: 0, rt: 0, lt: 0, lastUse: -1e9, announced: false,
  poll() {
    let g = null;
    try { const gps = navigator.getGamepads ? navigator.getGamepads() : []; for (const x of gps) if (x && x.connected) { g = x; break; } } catch (e) { }
    if (!g) { this.on = false; return; }
    this.on = true;
    const dz = v => Math.abs(v) < 0.18 ? 0 : (v - sign(v) * 0.18) / 0.82;
    const b = i => (g.buttons[i] ? g.buttons[i].value : 0);
    this.lx = dz(g.axes[0] || 0); this.ly = dz(g.axes[1] || 0); this.rx = dz(g.axes[2] || 0); this.ry = dz(g.axes[3] || 0);
    this.rt = b(7); this.lt = b(6);
    const map = { 0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY', 4: 'PadLB', 5: 'PadRB', 8: 'PadBack', 9: 'PadStart', 12: 'PadUp', 13: 'PadDown', 14: 'PadLeft', 15: 'PadRight' };
    let any = this.lx || this.ly || this.rx || this.ry || this.rt > 0.1 || this.lt > 0.1;
    for (const i in map) {
      const down = b(+i) > 0.5, k = map[i];
      if (down && !Input.keys[k]) Input.pressed[k] = true;
      Input.keys[k] = down; if (down) any = true;
    }
    if (any) this.lastUse = performance.now();
    if (!this.announced && typeof UI !== 'undefined' && Game.state === 'play') { this.announced = true; UI.toast('게임패드 연결됨: 왼쪽 스틱 이동 · RT 사격/가속 · Y 탑승'); }
  },
  get active() { return this.on && performance.now() - this.lastUse < 4000; },
};

function endFrameInput() { Input.pressed = {}; Input.wheel = 0; Input.mouse.clicked = false; }

// ---------- 사운드 ----------
// 모든 소리는 오실레이터/노이즈로 즉석 합성한다(외부 파일 없음).
const Sfx = {
  ctx: null, master: null, sfxBus: null, musicBus: null, noise: null,
  engine: null, siren: null, horn: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(comp);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.32; this.musicBus.connect(comp);
    const len = c.sampleRate;
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // 엔진음: 톱니파 + 서브 사각파 → 로우패스
    const eg = c.createGain(); eg.gain.value = 0;
    const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 700;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 25;
    const g2 = c.createGain(); g2.gain.value = 0.5;
    o1.connect(ef); o2.connect(g2); g2.connect(ef); ef.connect(eg); eg.connect(this.sfxBus);
    o1.start(); o2.start();
    this.engine = { gain: eg, filt: ef, o1, o2 };
    // 사이렌: 삼각파 + LFO 없이 코드에서 주파수 변조
    const sg = c.createGain(); sg.gain.value = 0;
    const so = c.createOscillator(); so.type = 'triangle'; so.frequency.value = 800;
    const sp = c.createStereoPanner ? c.createStereoPanner() : null;
    so.connect(sg); if (sp) { sg.connect(sp); sp.connect(this.sfxBus); } else sg.connect(this.sfxBus);
    so.start();
    this.siren = { gain: sg, osc: so, pan: sp, t: 0 };
    // 경적
    const hg = c.createGain(); hg.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1600;
    const h1 = c.createOscillator(); h1.type = 'square'; h1.frequency.value = 392;
    const h2 = c.createOscillator(); h2.type = 'square'; h2.frequency.value = 494;
    h1.connect(hf); h2.connect(hf); hf.connect(hg); hg.connect(this.sfxBus); h1.start(); h2.start();
    this.horn = { gain: hg };
  },
  get ok() { return !!this.ctx && !this.muted; },
  // 거리 감쇠 + 좌우 팬
  spatial(x, y) {
    const cx = Cam.x, cy = Cam.y;
    const d = dist(x, y, cx, cy);
    const vol = clamp(1 - d / 110, 0, 1);
    const pan = clamp((x - cx) / 60, -1, 1);
    return { vol: vol * vol, pan };
  },
  out(pan) {
    const c = this.ctx;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; p.connect(this.sfxBus); return p; }
    return this.sfxBus;
  },
  noiseBurst({ x, y, dur = 0.2, freq = 1200, q = 0.8, type = 'lowpass', vol = 1, sweep = 0 }) {
    if (!this.ok) return;
    const s = x === undefined ? { vol: 1, pan: 0 } : this.spatial(x, y);
    if (s.vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol * s.vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out(s.pan));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  tone({ x, y, f0 = 120, f1 = 40, dur = 0.15, type = 'sine', vol = 0.6 }) {
    if (!this.ok) return;
    const s = x === undefined ? { vol: 1, pan: 0 } : this.spatial(x, y);
    if (s.vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol * s.vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out(s.pan)); o.start(t); o.stop(t + dur + 0.02);
  },
  shot(x, y, kind) {
    if (kind === 'shotgun') { this.noiseBurst({ x, y, dur: 0.35, freq: 2400, vol: 0.9, sweep: 0.15 }); this.tone({ x, y, f0: 150, f1: 40, dur: 0.2, vol: 0.7 }); }
    else if (kind === 'smg') { this.noiseBurst({ x, y, dur: 0.09, freq: 3000, vol: 0.45, sweep: 0.3 }); }
    else if (kind === 'rocket') { this.noiseBurst({ x, y, dur: 0.6, freq: 900, type: 'bandpass', vol: 0.6, sweep: 0.3 }); }
    else if (kind === 'throw') { this.noiseBurst({ x, y, dur: 0.15, freq: 600, type: 'bandpass', vol: 0.3 }); }
    else if (kind === 'punch') { this.tone({ x, y, f0: 180, f1: 60, dur: 0.08, vol: 0.5 }); }
    else { this.noiseBurst({ x, y, dur: 0.16, freq: 2600, vol: 0.6, sweep: 0.2 }); this.tone({ x, y, f0: 220, f1: 60, dur: 0.08, vol: 0.4 }); }
  },
  explosion(x, y) {
    this.noiseBurst({ x, y, dur: 1.6, freq: 1400, vol: 1.3, sweep: 0.05 });
    this.tone({ x, y, f0: 90, f1: 25, dur: 0.9, vol: 1.0 });
  },
  crash(x, y, v) {
    this.noiseBurst({ x, y, dur: 0.25, freq: 500 + v * 30, vol: clamp(v / 14, 0.1, 1) });
    this.tone({ x, y, f0: 90, f1: 40, dur: 0.12, type: 'square', vol: clamp(v / 25, 0.05, 0.5) });
  },
  hit(x, y) { this.noiseBurst({ x, y, dur: 0.06, freq: 900, type: 'bandpass', vol: 0.4 }); },
  pickup() { this.tone({ f0: 660, f1: 1320, dur: 0.12, type: 'square', vol: 0.18 }); setTimeout(() => this.tone({ f0: 990, f1: 1500, dur: 0.12, type: 'square', vol: 0.15 }), 90); },
  cash() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone({ f0: 1800 + i * 300, f1: 2400, dur: 0.06, type: 'square', vol: 0.1 }), i * 50); },
  passed() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone({ f0: f, f1: f, dur: 0.35, type: 'triangle', vol: 0.35 }), i * 140)); },
  failed() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone({ f0: f, f1: f * 0.97, dur: 0.4, type: 'sawtooth', vol: 0.18 }), i * 200)); },
  update(dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 엔진
    const car = Game.player && Game.player.car;
    const e = this.engine;
    if (car && !this.muted && !car.dead) {
      const sp = Math.abs(car.vf);
      const gear = Math.min(4, Math.floor(sp / 12));
      const rpm = (sp - gear * 12) / 12 + 0.25 + Math.abs(car.in.thr) * 0.25;
      const f = 38 + rpm * 70 + gear * 6;
      e.o1.frequency.setTargetAtTime(f, t, 0.05); e.o2.frequency.setTargetAtTime(f / 2, t, 0.05);
      e.filt.frequency.setTargetAtTime(500 + Math.abs(car.in.thr) * 900 + sp * 10, t, 0.08);
      e.gain.gain.setTargetAtTime(0.07 + Math.abs(car.in.thr) * 0.09, t, 0.08);
    } else e.gain.gain.setTargetAtTime(0, t, 0.1);
    // 사이렌: 가장 가까운 사이렌 차량
    let best = null, bd = 1e9;
    for (const c of Game.cars) if (c.siren && !c.dead) { const d = dist(c.x, c.y, Cam.x, Cam.y); if (d < bd) { bd = d; best = c; } }
    const s = this.siren; s.t += dt;
    if (best && bd < 120 && !this.muted) {
      const wail = best.sirenMode ? (Math.sin(s.t * 2.2) * 0.5 + 0.5) : (Math.floor(s.t * 3) % 2);
      s.osc.frequency.setTargetAtTime(650 + wail * 700, t, best.sirenMode ? 0.05 : 0.01);
      s.gain.gain.setTargetAtTime(0.09 * clamp(1 - bd / 120, 0, 1), t, 0.1);
      if (s.pan) s.pan.pan.setTargetAtTime(clamp((best.x - Cam.x) / 50, -1, 1), t, 0.1);
    } else s.gain.gain.setTargetAtTime(0, t, 0.2);
    // 경적
    const honk = Game.player && Game.player.car && keyDown('KeyH');
    this.horn.gain.gain.setTargetAtTime(honk && !this.muted ? 0.08 : 0, t, 0.02);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, t, 0.05);
    Radio.update();
  },
};

// ---------- 라디오 (절차적 음악 시퀀서) ----------
// GTA의 차량 라디오를 흉내: 차량 탑승 중에만 재생, R 키로 채널 전환.
const Radio = {
  station: 1, nextTime: 0, step: 0, lastCar: null,
  stations: [
    { name: '라디오 끔' },
    { name: '네온 FM 88.8', sub: '신스웨이브', bpm: 104, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], kind: 'synth' },
    { name: '하버 비트 102.3', sub: '붐뱁 힙합', bpm: 88, prog: [[50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55]], kind: 'hiphop' },
    { name: '미드나잇 라운지 95.1', sub: '로파이 재즈', bpm: 76, prog: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]], kind: 'lofi' },
  ],
  cycle() {
    this.station = (this.station + 1) % this.stations.length;
    UI.showStation(this.stations[this.station]);
    this.step = 0;
  },
  note(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  play(time, f, dur, type, vol, filt = 3000) {
    const c = Sfx.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filt;
    o.connect(fl); fl.connect(g); g.connect(Sfx.musicBus); o.start(time); o.stop(time + dur + 0.05);
  },
  drum(time, kind, vol = 1) {
    const c = Sfx.ctx;
    if (kind === 'k') {
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, time); o.frequency.exponentialRampToValueAtTime(40, time + 0.15);
      const g = c.createGain(); g.gain.setValueAtTime(0.9 * vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      o.connect(g); g.connect(Sfx.musicBus); o.start(time); o.stop(time + 0.32);
    } else {
      const src = c.createBufferSource(); src.buffer = Sfx.noise;
      const f = c.createBiquadFilter(); f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1800;
      const g = c.createGain(); const d = kind === 'h' ? 0.04 : 0.18;
      g.gain.setValueAtTime((kind === 'h' ? 0.25 : 0.6) * vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + d);
      src.connect(f); f.connect(g); g.connect(Sfx.musicBus); src.start(time, Math.random() * 0.5); src.stop(time + d + 0.02);
    }
  },
  update() {
    const c = Sfx.ctx; if (!c) return;
    const car = Game.player && Game.player.car;
    const on = car && this.station > 0 && !Sfx.muted && Game.state === 'play';
    if (car !== this.lastCar) { this.lastCar = car; if (car && this.station > 0) UI.showStation(this.stations[this.station]); }
    if (!on) { this.nextTime = c.currentTime + 0.05; return; }
    const st = this.stations[this.station];
    const spb = 60 / st.bpm / 4; // 16분음표
    while (this.nextTime < c.currentTime + 0.15) {
      const t = this.nextTime, s = this.step % 64, bar = Math.floor(s / 16) % 4, b = s % 16;
      const ch = st.prog[bar];
      if (st.kind === 'synth') {
        if (b % 4 === 0) this.drum(t, 'k');
        if (b === 4 || b === 12) this.drum(t, 's', 0.8);
        if (b % 2 === 0) this.drum(t, 'h', 0.6);
        if (b % 2 === 0) this.play(t, this.note(ch[0] - 12), spb * 1.8, 'sawtooth', 0.12, 900);
        this.play(t, this.note(ch[b % 3] + 12 + (b >= 8 ? 12 : 0)), spb * 0.9, 'square', 0.035, 2600);
        if (b === 0) ch.forEach(n => this.play(t, this.note(n), spb * 15, 'sawtooth', 0.025, 1400));
      } else if (st.kind === 'hiphop') {
        const sw = (b % 2 === 1) ? spb * 0.25 : 0;
        if (b === 0 || b === 7 || b === 10) this.drum(t + sw, 'k');
        if (b === 4 || b === 12) this.drum(t + sw, 's');
        if (b % 2 === 0) this.drum(t + sw, 'h', 0.5);
        if (b === 0 || b === 10) this.play(t, this.note(ch[0] - 12), spb * 5, 'sine', 0.3, 400);
        if (b === 2 || b === 6 || b === 14) ch.forEach(n => this.play(t + sw, this.note(n + 12), spb * 1.2, 'triangle', 0.05, 2000));
      } else {
        if (b === 0 || b === 9) this.drum(t, 'k', 0.6);
        if (b === 4 || b === 12) this.drum(t, 's', 0.35);
        if (b % 3 === 0) this.drum(t, 'h', 0.3);
        if (b === 0 || b === 6) ch.forEach((n, i) => this.play(t + i * 0.02, this.note(n), spb * 6, 'triangle', 0.05, 1500));
        if (b % 4 === 2 && Math.random() < 0.6) this.play(t, this.note(ch[(Math.random() * ch.length) | 0] + 24), spb * 2, 'sine', 0.05, 3000);
        if (b === 0) this.play(t, this.note(ch[0] - 12), spb * 8, 'sine', 0.25, 300);
      }
      this.nextTime += spb; this.step++;
    }
  },
};
