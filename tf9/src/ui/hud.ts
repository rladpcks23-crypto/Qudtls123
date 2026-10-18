import { N1_RPM_100, specFor } from '../engine/spec';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/* ---------------- boot screen ---------------- */

export class Boot {
  private log = $('#boot-log');
  private bar = $('#boot-bar');
  private pct = $('#boot-pct');
  constructor(private fast: boolean) {}

  line(msg: string, val = '', state: 'run' | 'ok' = 'ok') {
    const li = document.createElement('li');
    li.innerHTML = `<span class="st ${state}"></span><span class="msg"></span><span class="val"></span>`;
    this.log.appendChild(li);
    const set = (m: string, v: string, s: 'run' | 'ok') => {
      (li.children[0] as HTMLElement).textContent = s === 'ok' ? '[ OK ]' : '[ .. ]';
      (li.children[0] as HTMLElement).className = `st ${s}`;
      (li.children[1] as HTMLElement).textContent = m;
      (li.children[2] as HTMLElement).textContent = v;
    };
    set(msg, val, state);
    return set;
  }

  progress(f: number) {
    this.bar.style.width = `${(f * 100).toFixed(1)}%`;
    this.pct.textContent = `${String(Math.round(f * 100)).padStart(3, '0')} %`;
  }

  pause(ms: number) {
    return this.fast ? frame() : wait(ms);
  }

  async finish() {
    const el = $('#boot');
    el.classList.add('is-done');
    document.body.classList.remove('booting');
    await wait(this.fast ? 50 : 420);
    el.remove();
  }
}

/* ---------------- N1 gauge ---------------- */

const A0 = -225, A1 = 45, MAX = 110; // dial sweep in degrees, full scale %
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [60 + Math.cos(a) * r, 60 + Math.sin(a) * r];
};
const arcPath = (from: number, to: number, r: number) => {
  const [x0, y0] = polar(from, r), [x1, y1] = polar(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const angleOf = (pct: number) => A0 + ((A1 - A0) * Math.min(pct, MAX)) / MAX;

export class Gauge {
  private el = $('#gauge');
  private fill = $<SVGPathElement>('#gauge-fill');
  private needle = $<SVGLineElement>('#gauge-needle');
  private n1 = $('#gauge-n1');
  private rpm = $('#gauge-rpm');
  private state = $('#gauge-state');
  private last = '';
  private on = false;

  constructor() {
    $<SVGPathElement>('#gauge-track').setAttribute('d', arcPath(A0, A1, 46));
    const ticks = $('#gauge-ticks');
    let svg = '';
    for (let p = 0; p <= MAX; p += 5) {
      const a = angleOf(p);
      const major = p % 20 === 0;
      const [x0, y0] = polar(a, major ? 38 : 41), [x1, y1] = polar(a, 44);
      svg += `<line class="${major ? 'major' : ''}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`;
      if (major) {
        const [tx, ty] = polar(a, 29);
        svg += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}">${p / 10}</text>`;
      }
    }
    const [r0x, r0y] = polar(angleOf(104), 36), [r1x, r1y] = polar(angleOf(104), 47);
    svg += `<line class="red" x1="${r0x.toFixed(2)}" y1="${r0y.toFixed(2)}" x2="${r1x.toFixed(2)}" y2="${r1y.toFixed(2)}"/>`;
    ticks.innerHTML = svg;
  }

  show(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('is-on', on);
  }

  set(n1: number, label: string) {
    const pct = n1 * 100;
    const key = `${pct.toFixed(1)}|${label}`;
    if (key === this.last) return;
    this.last = key;
    const a = angleOf(pct);
    this.fill.setAttribute('d', pct > 0.2 ? arcPath(A0, a, 46) : '');
    const [x, y] = polar(a, 40);
    this.needle.setAttribute('x2', x.toFixed(2));
    this.needle.setAttribute('y2', y.toFixed(2));
    this.n1.textContent = pct.toFixed(1).padStart(5, '0');
    this.rpm.textContent = (Math.round((n1 * N1_RPM_100) / 10) * 10).toLocaleString('en-US');
    this.state.textContent = label;
  }
}

/* ---------------- spec label with leader line ---------------- */

export class Label {
  private el = $('#label');
  private leader = $('#leader');
  private line = $<SVGPolylineElement>('#leader-line');
  private dot = $<SVGCircleElement>('#leader-dot');
  private current = '';
  private w = 260;
  private h = 160;

  show(id: string, anchor: { x: number; y: number }, near: { x: number; y: number }, vw: number, vh: number) {
    if (id !== this.current) {
      this.current = id;
      const s = specFor(id);
      this.el.innerHTML =
        `<div class="label-pn">${s.pn} · TF-9</div>` +
        `<div class="label-name">${s.name}</div>` +
        `<div class="label-ko">${s.ko}</div>` +
        `<dl>${s.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` +
        (s.note ? `<p class="label-note">${s.note}</p>` : '');
      this.el.hidden = false;
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
    }
    const m = 16;
    const top = 64, bottom = 48;
    // place to the upper right of the pointer, flipping at the edges
    let x = near.x + 40;
    let y = near.y - this.h - 36;
    if (x + this.w > vw - m) x = near.x - 40 - this.w;
    if (x < m) x = Math.max(m, Math.min(vw - m - this.w, near.x - this.w / 2));
    if (y < top) y = near.y + 40;
    if (y + this.h > vh - bottom) y = Math.max(top, vh - bottom - this.h);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // leader: anchor -> elbow -> nearest label edge
    const ex = anchor.x < x ? x : anchor.x > x + this.w ? x + this.w : anchor.x;
    const ey = anchor.y < y ? y : anchor.y > y + this.h ? y + this.h : y + 18;
    const elbowX = ex === anchor.x ? anchor.x : anchor.x + (ex - anchor.x) * 0.35;
    this.line.setAttribute('points', `${anchor.x.toFixed(1)},${anchor.y.toFixed(1)} ${elbowX.toFixed(1)},${ey.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`);
    this.dot.setAttribute('cx', anchor.x.toFixed(1));
    this.dot.setAttribute('cy', anchor.y.toFixed(1));
    this.leader.classList.remove('is-off');
  }

  hide() {
    if (!this.current) return;
    this.current = '';
    this.el.hidden = true;
    this.leader.classList.add('is-off');
  }

  get id() { return this.current; }
}

/* ---------------- top bar, rail and bottom readouts ---------------- */

const PHASES: Record<string, [string, string, string]> = {
  hero: ['01', 'ASSEMBLED', '완성품'],
  disassembly: ['02', 'DISASSEMBLY', '분해'],
  fan: ['03.1', 'INSPECTION · FAN', '점검 · 팬'],
  compressor: ['03.2', 'INSPECTION · COMPRESSOR', '점검 · 압축기'],
  combustor: ['03.3', 'INSPECTION · COMBUSTOR', '점검 · 연소기'],
  turbine: ['03.4', 'INSPECTION · TURBINE', '점검 · 터빈'],
  reassembly: ['04', 'REASSEMBLY', '재조립'],
  operation: ['05', 'OPERATION', '작동'],
  outro: ['05', 'OPERATION', '작동'],
};

export class Hud {
  private phase = $('#phase');
  private cam = $('#readout-cam');
  private seq = $('#readout-seq');
  private hint = $('#hint');
  private rail = [...document.querySelectorAll<HTMLAnchorElement>('.rail a')];
  private lastPhase = '';
  private lastCam = '';
  private lastSeq = '';

  setPhase(id: string) {
    if (id === this.lastPhase) return;
    this.lastPhase = id;
    const [n, en, ko] = PHASES[id];
    this.phase.innerHTML = `<span class="phase-num">${n}</span><span class="phase-name">${en}</span><span class="phase-ko">${ko}</span>`;
    for (const a of this.rail) a.classList.toggle('is-active', (a.dataset.for ?? '').split(' ').includes(id));
  }

  setReadouts(az: number, el: number, seq: number) {
    const c = `AZ ${az.toFixed(1).padStart(5, '0')}° EL ${el >= 0 ? '+' : '−'}${Math.abs(el).toFixed(1).padStart(4, '0')}°`;
    if (c !== this.lastCam) { this.cam.textContent = c; this.lastCam = c; }
    const s = `SEQ ${String(Math.round(seq * 100)).padStart(3, '0')} %`;
    if (s !== this.lastSeq) { this.seq.textContent = s; this.lastSeq = s; }
  }

  hideHint() {
    this.hint.style.opacity = '0';
  }
}
