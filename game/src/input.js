// Keyboard / mouse / touch input. Pointer lock drives the camera.
import { clamp } from './util.js';

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set();      // edge-triggered, cleared each frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftEdge: false };
    this.locked = false;
    this.touch = { active: false, mx: 0, my: 0, fire: false, act: false, brake: false, lookDx: 0, lookDy: 0 };
    this.enabled = true;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.code;
      if (['Tab', 'Space', 'F1', 'F5'].includes(k) && this.locked) e.preventDefault();
      this.keys.add(k); this.pressed.add(k);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    dom.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftEdge = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.onUnlock && this.onUnlock();
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });

    this.initTouch();
  }

  requestLock() {
    if (this.touch.active) return;
    this.dom.requestPointerLock && this.dom.requestPointerLock();
  }

  initTouch() {
    const coarse = matchMedia('(pointer:coarse)').matches;
    if (!coarse) return;
    this.touch.active = true;
    document.getElementById('touch').classList.add('on');

    const stick = document.getElementById('stick'), knob = stick.querySelector('i');
    let id = null, cx = 0, cy = 0;
    const R = 50;
    stick.addEventListener('touchstart', e => {
      const t = e.changedTouches[0]; id = t.identifier;
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });
    const move = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = clamp((t.clientX - cx) / R, -1, 1), dy = clamp((t.clientY - cy) / R, -1, 1);
        this.touch.mx = dx; this.touch.my = dy;
        knob.style.transform = `translate(${dx * R}px,${dy * R}px)`;
        e.preventDefault();
      }
    };
    stick.addEventListener('touchmove', move, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; this.touch.mx = this.touch.my = 0; knob.style.transform = '';
      }
    };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);

    const bind = (el, key) => {
      el.addEventListener('touchstart', e => { this.touch[key] = true; if (key === 'fire') this.mouse.leftEdge = true; e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', () => this.touch[key] = false);
      el.addEventListener('touchcancel', () => this.touch[key] = false);
    };
    bind(document.getElementById('tFire'), 'fire');
    bind(document.getElementById('tAct'), 'act');
    bind(document.getElementById('tBrake'), 'brake');

    // Drag anywhere on the right half of the screen to look around.
    let lookId = null, lx = 0, ly = 0;
    addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (lookId === null && t.clientX > innerWidth * 0.38 && t.clientY < innerHeight * 0.78) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === lookId) {
        this.mouse.dx += (t.clientX - lx) * 1.6; this.mouse.dy += (t.clientY - ly) * 1.6;
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: true });
    const lend = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
    addEventListener('touchend', lend); addEventListener('touchcancel', lend);
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  // Movement axes: x = strafe (right +), y = forward (+)
  axis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.touch.active) { x += this.touch.mx; y -= this.touch.my; }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  get fire() { return this.mouse.left || this.touch.fire; }
  get aim() { return this.mouse.right; }
  get brake() { return this.down('Space') || this.touch.brake; }
  get sprint() { return this.down('ShiftLeft') || this.down('ShiftRight'); }
  get interact() { return this.hit('KeyF') || this.consumeTouchAct(); }
  consumeTouchAct() { if (this.touch.act) { this.touch.act = false; return true; } return false; }

  endFrame() { this.pressed.clear(); this.mouse.dx = this.mouse.dy = 0; this.mouse.leftEdge = false; }
}
