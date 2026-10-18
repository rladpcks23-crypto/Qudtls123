import './styles/main.css';
import * as THREE from 'three';
import { Stage, type Region } from './scene/stage';
import { Engine, type Part } from './engine/engine';
import { DISASSEMBLY_ORDER, REASSEMBLY_ORDER, FOCUS } from './engine/model';
import { Sound } from './audio/sound';
import { Boot, Gauge, Hud, Label } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const remap = (x: number, a: number, b: number) => sat((x - a) / (b - a));
const damp = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-k * dt));

/* ---------------- preferences ---------------- */

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = mq.matches;
const motionBtn = $('#btn-motion');
const soundBtn = $('#btn-sound');

function setReduced(v: boolean) {
  reduced = v;
  motionBtn.setAttribute('aria-pressed', String(v));
  motionBtn.querySelector('.t-state')!.textContent = v ? 'LOW' : 'FULL';
  document.documentElement.classList.toggle('reduce-motion', v);
  engine.reduced = v;
}

/* ---------------- scene ---------------- */

const canvas = $<HTMLCanvasElement>('#gl');
const stage = new Stage(canvas);
const engine = new Engine();
stage.scene.add(engine.root);
const sound = new Sound();
const hud = new Hud();
const gauge = new Gauge();
const label = new Label();

engine.events.onSeat = (p) => sound.click(p.heavy);
engine.events.onRelease = () => sound.release();

setReduced(reduced);
mq.addEventListener?.('change', (e) => setReduced(e.matches));
motionBtn.addEventListener('click', () => setReduced(!reduced));
soundBtn.addEventListener('click', async () => {
  const on = !sound.enabled;
  if (on) await sound.enable(); else sound.disable();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('.t-state')!.textContent = on ? 'ON' : 'OFF';
});
if (!sound.available) soundBtn.hidden = true;

/* ---------------- story sections ---------------- */

interface Step { id: string; el: HTMLElement; pin: HTMLElement; panel: HTMLElement; top: number; h: number; live: boolean; op: number; panelRight: number; panelH: number }
const steps: Step[] = [...document.querySelectorAll<HTMLElement>('.step')].map((el) => ({
  id: el.dataset.step!, el, pin: el.querySelector('.pin') as HTMLElement, panel: el.querySelector('.panel') as HTMLElement,
  top: 0, h: 1, live: false, op: -1, panelRight: 0, panelH: 0,
}));
let vw = window.innerWidth, vh = window.innerHeight;
let side = true; // side-by-side layout vs stacked
let docMax = 1;

function measure() {
  vw = window.innerWidth;
  vh = window.innerHeight;
  side = vw / vh >= 1.1 && vw > 760;
  // panel geometry is cached here so the frame loop never forces a layout
  for (const s of steps) {
    s.top = s.el.offsetTop; s.h = s.el.offsetHeight;
    s.panelRight = s.panel.offsetLeft + s.panel.offsetWidth;
    s.panelH = s.panel.offsetHeight;
  }
  docMax = Math.max(1, document.documentElement.scrollHeight - vh);
  const dpr = Math.min(window.devicePixelRatio || 1, vw < 760 ? 2 : 1.75);
  stage.resize(vw, vh, dpr);
  engine.setResolution(vw, vh);
  engine.lineWidth = vw < 760 ? 1.15 : 1.3;
}

/** Screen region left free for the engine, given the layout and the active panel. */
function regionFor(active: Step, gaugeOn: boolean): Region {
  const topH = side ? 56 : 48;
  const botH = side ? 40 : 34;
  if (side) {
    const left = active.panelRight + 24;
    const right = vw - (vw > 1100 && vh > 520 ? 170 : 24);
    return { x: left, y: topH + 8, w: Math.max(200, right - left), h: vh - topH - botH - 16 };
  }
  const panelH = active.panelH;
  const top = topH + 6 + (gaugeOn ? 96 : 0);
  const bottom = vh - botH - panelH - 14;
  return { x: 8, y: top, w: vw - 16, h: Math.max(160, bottom - top) };
}

/* ---------------- views ---------------- */

// directions (from subject toward camera), engine frame: +X is the exhaust end
const V = {
  hero: new THREE.Vector3(-0.66, 0.3, 0.69).normalize(),
  disassembly: new THREE.Vector3(-0.28, 0.36, 0.89).normalize(),
  fan: new THREE.Vector3(-0.78, 0.26, 0.57).normalize(),
  compressor: new THREE.Vector3(-0.32, 0.38, 0.87).normalize(),
  combustor: new THREE.Vector3(-0.42, 0.5, 0.76).normalize(),
  turbine: new THREE.Vector3(0.5, 0.3, 0.81).normalize(),
  reassembly: new THREE.Vector3(-0.2, 0.34, 0.92).normalize(),
  operation: new THREE.Vector3(-0.6, 0.26, 0.76).normalize(),
  operationFront: new THREE.Vector3(-0.84, 0.24, 0.49).normalize(),
  outro: new THREE.Vector3(-0.46, 0.3, 0.84).normalize(),
};

// on tall, narrow screens the long exploded layout is seen more end-on so it
// fills the height instead of shrinking to the width
const V_NARROW: Partial<Record<keyof typeof V, THREE.Vector3>> = {
  disassembly: new THREE.Vector3(-0.62, 0.42, 0.66).normalize(),
  reassembly: new THREE.Vector3(-0.6, 0.4, 0.69).normalize(),
};

/* ---------------- state machine driven by scroll ---------------- */

let n1Target = 0, n2Target = 0, lit = false;
let lastActive = '';

function setParts(order: string[][], prog: number, explode: boolean, now: number) {
  // each step flips at its own threshold; flips in the same frame cascade
  let cascade = 0;
  const N = order.length;
  order.forEach((ids, k) => {
    const passed = prog > (k + 0.5) / N;
    const t: 0 | 1 = explode ? (passed ? 1 : 0) : (passed ? 0 : 1);
    for (const id of ids) {
      const p = engine.byId.get(id)!;
      if (p.target !== t) {
        p.set(t, now, reduced ? 0 : cascade * 0.055, reduced);
        cascade++;
      }
    }
  });
}

function setAll(t: 0 | 1, now: number, order: string[][]) {
  let cascade = 0;
  for (const ids of order) for (const id of ids) {
    const p = engine.byId.get(id)!;
    if (p.target !== t) { p.set(t, now, reduced ? 0 : cascade * 0.055, reduced); cascade++; }
  }
}

function applyStep(s: Step, q: number, now: number) {
  let focus: string[] | null = null;
  n1Target = 0; n2Target = 0; lit = false;
  switch (s.id) {
    case 'hero':
      setAll(0, now, REASSEMBLY_ORDER);
      break;
    case 'disassembly':
      setParts(DISASSEMBLY_ORDER, remap(q, 0.1, 0.78), true, now);
      break;
    case 'fan': case 'compressor': case 'combustor': case 'turbine':
      setAll(1, now, DISASSEMBLY_ORDER);
      focus = FOCUS[s.id];
      break;
    case 'reassembly':
      setParts(REASSEMBLY_ORDER, remap(q, 0.1, 0.8), false, now);
      break;
    case 'operation':
      setAll(0, now, REASSEMBLY_ORDER);
      if (q > 0.04) { n2Target = 0.24; n1Target = 0.05; }
      if (q > 0.12) {
        lit = true;
        const thr = smooth(0.24, 0.86, q);
        n1Target = 0.21 + 0.79 * thr;
        n2Target = 0.64 + 0.36 * thr;
      }
      break;
    case 'outro':
      setAll(0, now, REASSEMBLY_ORDER);
      lit = true; n1Target = 1; n2Target = 1;
      break;
  }
  for (const p of engine.parts) p.focusTarget = !focus || focus.includes(p.id) ? 1 : 0;
}

const opDir = new THREE.Vector3();

function viewFor(id: string, q: number, out: THREE.Box3) {
  switch (id) {
    case 'hero': case 'outro': engine.bounds(undefined, 'assembled', out); break;
    case 'operation':
      // side-on while the combustor lights, then round to the front as the fan spools up
      engine.bounds(undefined, 'assembled', out);
      return opDir.copy(V.operation).lerp(V.operationFront, smooth(0.42, 0.78, q)).normalize();
    case 'fan': case 'compressor': case 'combustor': case 'turbine': engine.bounds(FOCUS[id], 'exploded', out); break;
    default: engine.bounds(undefined, 'current', out);
  }
  const k = id as keyof typeof V;
  return (!side && V_NARROW[k]) || V[k];
}

/* ---------------- pointer: drag to orbit, hover / tap for specs ---------------- */

const pointer = { x: 0, y: 0, inside: false, moved: false, down: false, sx: 0, sy: 0, lx: 0, ly: 0, type: 'mouse', dirty: false };
let hovered: Part | null = null;
let pinned: Part | null = null; // touch selection

canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true; pointer.moved = false; pointer.type = e.pointerType;
  pointer.sx = pointer.lx = e.clientX; pointer.sy = pointer.ly = e.clientY;
  if (e.pointerType === 'mouse') canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; pointer.type = e.pointerType; pointer.dirty = true;
  if (!pointer.down) return;
  const dx = e.clientX - pointer.lx, dy = e.clientY - pointer.ly;
  pointer.lx = e.clientX; pointer.ly = e.clientY;
  if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 6) {
    if (!pointer.moved) { pointer.moved = true; stage.dragging = true; canvas.classList.add('is-drag'); hud.hideHint(); }
    // touch: horizontal only, vertical swipes stay with page scroll
    stage.drag(dx, e.pointerType === 'mouse' ? dy : 0);
  }
});
const endDrag = (e: PointerEvent) => {
  if (pointer.down && !pointer.moved && e.type === 'pointerup' && e.pointerType !== 'mouse') {
    pointer.x = e.clientX; pointer.y = e.clientY;
    const hit = pick(e.clientX, e.clientY);
    pinned = hit && hit !== pinned ? hit : null;
    if (pinned) sound.tick();
  }
  pointer.down = false;
  stage.dragging = false;
  canvas.classList.remove('is-drag');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') pointer.inside = false; });

const raycaster = new THREE.Raycaster();
(raycaster as any).firstHitOnly = true;
const ndc = new THREE.Vector2();
function pick(x: number, y: number): Part | null {
  ndc.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
  const hit = raycaster.intersectObjects(engine.meshes(), false)[0];
  return hit ? (hit.object.userData.part as Part) : null;
}

/* ---------------- scan-line reveal ---------------- */

const scanEl = $('#scan');
let scanT = -1; // <0 idle, else seconds into the sweep
const SCAN_DUR = 1.25;
const partX = new Map<Part, number>();

function startScan() {
  if (reduced) { for (const p of engine.parts) p.revealed = 1; return; }
  scanT = 0;
  const v = new THREE.Vector3();
  for (const p of engine.parts) {
    p.box.getCenter(v);
    engine.root.localToWorld(v);
    v.project(stage.camera);
    partX.set(p, (v.x + 1) / 2);
    p.revealed = 1;
  }
}

function updateScan(dt: number) {
  if (scanT < 0) return;
  scanT += dt;
  const k = sat(scanT / SCAN_DUR);
  const u = -0.02 + 1.06 * (1 - Math.pow(1 - k, 2.2));
  stage.setScan(u);
  scanEl.style.opacity = k < 0.92 ? '1' : String((1 - k) / 0.08);
  scanEl.style.transform = `translateX(${(u * vw).toFixed(1)}px)`;
  for (const [p, x] of partX) {
    if (x < u && x > u - 0.05) p.flash = Math.max(p.flash, 0.9);
  }
  if (k >= 1) {
    scanT = -1;
    stage.setScan(null);
    scanEl.style.opacity = '0';
  }
}

/* ---------------- main loop ---------------- */

let started = false;
let last = performance.now();

let region: Region | null = null;
const box = new THREE.Box3();
let n1 = 0, n2 = 0, heat = 0;
const anchor = new THREE.Vector3();
let frameMs = 0;

let simTime = 0;

function loop(t: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  simTime += dt;
  const t0 = performance.now();
  tick(dt, simTime);
  frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
  stage.render();
}

/** Advance the simulation without drawing (used by the screenshot script on software GL). */
function settle(seconds: number) {
  const h = 1 / 30;
  for (let i = 0; i < Math.round(seconds / h); i++) { simTime += h; tick(h, simTime); }
}

function tick(dt: number, now: number) {
  const y = window.scrollY;
  // active section: the one whose scroll window holds the viewport top
  let active = steps[0];
  for (const s of steps) if (y >= s.top - 1) active = s;
  const q = sat((y - active.top) / active.h);

  if (started) applyStep(active, q, now);

  // panels: crossfade over a short scroll window at each boundary
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    // fade out completes before the next panel starts, so text never overlaps
    const fin = i === 0 ? 1 : smooth(s.top - vh * 0.1, s.top + vh * 0.08, y);
    const fout = i === steps.length - 1 ? 1 : 1 - smooth(s.top + s.h - vh * 0.3, s.top + s.h - vh * 0.12, y);
    const o = Math.round(fin * fout * 100) / 100;
    if (o !== s.op) {
      s.op = o;
      s.pin.style.opacity = String(o);
      s.pin.style.visibility = o > 0 ? 'visible' : 'hidden';
      s.panel.style.transform = reduced || o === 1 ? '' : `translateY(${((1 - o) * 10).toFixed(1)}px)`;
    }
    const live = o > 0.6;
    if (live !== s.live) { s.live = live; s.pin.classList.toggle('is-live', live); }
  }

  if (active.id !== lastActive) {
    lastActive = active.id;
    hud.setPhase(active.id);
    pinned = null;
  }

  // spools: first-order lag, faster to accelerate than to decelerate
  n1 = damp(n1, n1Target, n1Target > n1 ? 0.9 : 0.6, dt);
  n2 = damp(n2, n2Target, n2Target > n2 ? 1.2 : 0.7, dt);
  heat = damp(heat, lit ? 0.55 + 0.45 * n1 : 0, lit ? 2.2 : 1.1, dt);
  engine.n1 = n1; engine.n2 = n2; engine.heat = heat;
  sound.setEngine(n1, n2, heat);

  const gaugeOn = active.id === 'operation' || active.id === 'outro';
  gauge.show(gaugeOn);
  if (gaugeOn || n1 > 0.002) {
    const st = n1 < 0.004 && !lit ? 'SHUTDOWN' : !lit ? 'STARTER · DRY CRANK' : n1 < 0.26 ? 'LIGHT-OFF · IDLE' : n1 < 0.95 ? 'ACCELERATING' : 'TAKE-OFF POWER';
    gauge.set(n1, st);
  }

  // camera
  const want = regionFor(active, gaugeOn);
  if (!region) region = { ...want };
  else for (const k of ['x', 'y', 'w', 'h'] as const) region[k] = damp(region[k], want[k], 6, dt);
  stage.setRegion(region);
  stage.chase = reduced ? 14 : 4.2;
  stage.ambientYaw = reduced ? 0 : (active.id === 'hero' || active.id === 'outro' || active.id === 'operation' ? Math.sin(now * 0.16) * 0.16 : 0);
  const dir = viewFor(active.id, q, box);
  box.applyMatrix4(engine.root.matrixWorld);
  stage.frame(box, dir, active.id === 'operation' ? 1.0 : 1.06);

  engine.update(dt, now);
  stage.update(dt);
  updateScan(dt);

  // hover / pinned label
  let target: Part | null = null;
  if (started && scanT < 0) {
    if (pointer.type === 'mouse') {
      if (pointer.inside && !pointer.down) {
        if (pointer.dirty || engine.anyMoving()) { hovered = pick(pointer.x, pointer.y); pointer.dirty = false; }
      } else if (!pointer.down) hovered = null;
      target = hovered;
    } else target = pinned;
  }
  for (const p of engine.parts) {
    const h = p === target;
    if (h && !p.hovered && pointer.type === 'mouse') sound.tick();
    p.hovered = h;
  }
  canvas.classList.toggle('is-hover', !!target && pointer.type === 'mouse');
  if (target) {
    target.box.getCenter(anchor);
    anchor.y = target.box.max.y * 0.85 + anchor.y * 0.15;
    target.group.localToWorld(anchor);
    anchor.project(stage.camera);
    const ax = (anchor.x + 1) / 2 * vw, ay = (1 - anchor.y) / 2 * vh;
    const near = pointer.type === 'mouse' ? { x: pointer.x, y: pointer.y } : { x: ax, y: ay };
    label.show(target.id, { x: ax, y: ay }, near, vw, vh);
  } else label.hide();

  const { az, el } = stage.azEl();
  hud.setReadouts(az, el, y / docMax);
}

/* ---------------- boot ---------------- */

async function boot() {
  document.body.classList.add('booting');
  measure();
  const b = new Boot(reduced);
  b.line('POWER BUS', '28 VDC');
  await b.pause(140);
  b.line('FADEC CHANNEL A / B', 'ONLINE');
  await b.pause(140);
  b.line('GEOMETRY KERNEL', 'TF-9 r4');
  await b.pause(100);
  const mesh = b.line('MESHING MODULES', '00 / 21', 'run');
  let tris = 0;
  await engine.build(async (i, n) => {
    mesh('MESHING MODULES', `${String(i).padStart(2, '0')} / ${n}`, i === n ? 'ok' : 'run');
    b.progress(0.08 + 0.72 * (i / n));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  for (const m of engine.meshes()) tris += (m.geometry.index?.count ?? 0) / 3;
  b.line('BLADE ROWS · TWIST PROFILES', `${Math.round(tris / 1000)}K TRIS`);
  // first frame: frame the hero and compile shaders while the log runs
  const step0 = steps[0];
  applyStep(step0, 0, simTime);
  for (const p of engine.parts) p.revealed = 1;
  region = regionFor(step0, false);
  stage.setRegion(region);
  engine.bounds(undefined, 'assembled', box);
  stage.frame(box, V.hero, 1.06);
  stage.snap();
  stage.update(0);
  const shade = b.line('EDGE SHADER', 'COMPILING', 'run');
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  engine.revealForCompile(true);
  stage.renderer.compile(stage.scene, stage.camera);
  engine.revealForCompile(false);
  shade('EDGE SHADER', 'COMPILED', 'ok');
  b.progress(0.9);
  await b.pause(110);
  b.line('N1 / N2 SPEED PICKUPS', 'NOMINAL');
  await b.pause(90);
  b.line('IGNITION EXCITERS', 'ARMED');
  await b.pause(90);
  b.line('DISPLAY', 'READY');
  b.progress(1);
  await b.pause(260);
  // hide everything until the scan line draws it
  if (!reduced) stage.setScan(-0.02);
  requestAnimationFrame(loop);
  await b.finish();
  started = true;
  startScan();
  (window as any).__tf9 = { ready: true, engine, stage, settle, get frameMs() { return frameMs; } };
}

window.addEventListener('resize', () => { measure(); });
window.addEventListener('load', measure);
document.fonts?.ready.then(measure);
document.querySelectorAll<HTMLAnchorElement>('.rail a').forEach((a) => {
  a.addEventListener('click', (e) => {
    const el = document.querySelector(a.getAttribute('href')!) as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    window.scrollTo({ top: el.offsetTop + (el.dataset.step === 'disassembly' || el.dataset.step === 'reassembly' ? 0 : vh * 0.12), behavior: reduced ? 'auto' : 'smooth' });
  });
});

boot();
