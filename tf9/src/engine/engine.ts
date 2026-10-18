import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { partDefs, combustorLiner, type PartDef, type Module } from './model';
import { N1_RPM_100, N2_RPM_100, type Spool } from './spec';
import type { GeoBuilder } from './builder';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const WHITE = new THREE.Color(0xe9ecef);
export const ORANGE = new THREE.Color(0xff4f00);

const SEAT_DUR = 0.46;
const UNSEAT_DUR = 0.5;
const CONTACT = 0.74; // fraction of the seat move at which the part makes contact

const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const damp = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-k * dt));

export interface EngineEvents {
  onSeat?: (p: Part) => void;
  onRelease?: (p: Part) => void;
}

export class Part {
  readonly id: string;
  readonly module: Module;
  readonly spool: Spool;
  readonly pitch: number;
  readonly heavy: boolean;
  readonly group = new THREE.Group();
  readonly rotor = new THREE.Group();
  readonly offset: THREE.Vector3;
  readonly box = new THREE.Box3();
  readonly meshes: THREE.Mesh[] = [];
  readonly rotMat: LineMaterial;
  readonly statMat: LineMaterial;
  readonly discs: THREE.Mesh[] = [];
  readonly mat: THREE.MeshStandardMaterial;

  /** explode amount actually shown (0 seated, 1 out) */
  e = 0;
  target = 0;
  private from = 0;
  private t0 = 0;
  private seatedFired = true;
  private releaseFired = true;
  private moving = false;

  flash = 0;
  hover = 0;
  hovered = false;
  focus = 1;
  focusTarget = 1;
  heat = 0;
  angle = 0;
  blur = 0;
  revealed = 1;

  constructor(def: PartDef, solid: THREE.Material, lineRes: THREE.Vector2) {
    this.id = def.id;
    this.module = def.module;
    this.spool = def.spool;
    this.pitch = def.pitch;
    this.heavy = !!def.heavy;
    this.offset = new THREE.Vector3(...def.offset);
    this.rotMat = makeLineMat(lineRes);
    this.statMat = makeLineMat(lineRes);
    this.mat = (solid as THREE.MeshStandardMaterial).clone();
    this.group.name = def.id;
    this.group.add(this.rotor);
    this.addBuilder(def.rot, this.rotor, this.mat, this.rotMat);
    this.addBuilder(def.stat, this.group, this.mat, this.statMat);
    for (const d of def.discs) {
      const disc = makeDisc(d.r0, d.r1);
      disc.position.x = d.x;
      this.discs.push(disc);
      this.group.add(disc);
    }
  }

  addBuilder(g: GeoBuilder, parent: THREE.Object3D, solid: THREE.Material, lineMat: LineMaterial) {
    const geo = g.solidGeometry();
    if (geo) {
      (geo as any).computeBoundsTree();
      const mesh = new THREE.Mesh(geo, solid);
      mesh.userData.part = this;
      parent.add(mesh);
      this.meshes.push(mesh);
      this.box.union(geo.boundingBox!);
    }
    if (g.line.length) {
      const lg = new LineSegmentsGeometry();
      lg.setPositions(g.line);
      const ls = new LineSegments2(lg, lineMat);
      ls.renderOrder = 2;
      parent.add(ls);
    }
  }

  /** Request seated (0) or exploded (1). */
  set(target: 0 | 1, now: number, delay = 0, instant = false) {
    if (this.target === target) return;
    this.target = target;
    this.from = this.e;
    this.t0 = now + delay;
    this.moving = true;
    if (target === 0) this.seatedFired = false;
    else this.releaseFired = false;
    if (instant) { this.t0 = now - 10; }
  }

  step(now: number, ev: EngineEvents) {
    if (!this.moving) return;
    const t = now - this.t0;
    if (t < 0) return;
    if (this.target === 1) {
      if (!this.releaseFired) { this.releaseFired = true; ev.onRelease?.(this); }
      const k = sat(t / UNSEAT_DUR);
      const ease = 1 - Math.pow(1 - k, 4);
      this.e = this.from + (1 - this.from) * ease;
      if (k >= 1) { this.e = 1; this.moving = false; }
    } else {
      const k = sat(t / SEAT_DUR);
      if (k < CONTACT) {
        const a = k / CONTACT;
        this.e = this.from * (1 - a * a * a);
      } else {
        if (!this.seatedFired) { this.seatedFired = true; this.flash = 1; ev.onSeat?.(this); }
        const b = (k - CONTACT) / (1 - CONTACT);
        // small recoil after contact, then settle
        this.e = Math.min(this.from, 0.6) * 0.03 * Math.sin(Math.PI * b) * (1 - b);
      }
      if (k >= 1) { this.e = 0; this.moving = false; }
    }
  }

  get isMoving() { return this.moving; }
}

function makeLineMat(res: THREE.Vector2) {
  const m = new LineMaterial({ color: WHITE.getHex(), linewidth: 1.25, worldUnits: false, transparent: true, opacity: 0.95, depthWrite: false });
  m.resolution = res;
  return m;
}

const discMat = new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 0 }, uR0: { value: 0 }, uR1: { value: 1 }, uColor: { value: new THREE.Color(0xdfe4ea) } },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() { vP = position.yz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity; uniform float uR0; uniform float uR1; uniform vec3 uColor;
    varying vec2 vP;
    void main() {
      float r = length(vP);
      float s = clamp((r - uR0) / (uR1 - uR0), 0.0, 1.0);
      float edge = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.92, s);
      float rings = 0.5 + 0.5 * sin(s * 70.0);
      float a = uOpacity * edge * (0.26 + 0.16 * rings) * (0.5 + 0.5 * s);
      a += uOpacity * 0.7 * smoothstep(0.95, 0.985, s) * smoothstep(1.0, 0.985, s);
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

function makeDisc(r0: number, r1: number) {
  const g = new THREE.RingGeometry(r0, r1, 128, 1);
  g.rotateY(Math.PI / 2);
  const m = discMat.clone();
  m.uniforms.uR0.value = r0;
  m.uniforms.uR1.value = r1;
  const mesh = new THREE.Mesh(g, m);
  mesh.visible = false;
  mesh.renderOrder = 3;
  mesh.raycast = () => {};
  return mesh;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,120,40,1)');
  g.addColorStop(0.35, 'rgba(255,79,0,0.45)');
  g.addColorStop(1, 'rgba(255,79,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Engine {
  readonly root = new THREE.Group();
  readonly parts: Part[] = [];
  readonly byId = new Map<string, Part>();
  readonly lineRes = new THREE.Vector2(1, 1);
  readonly solid: THREE.MeshStandardMaterial;
  readonly linerMat: THREE.MeshStandardMaterial;
  private glow!: THREE.Sprite;
  private fire!: THREE.PointLight;
  private linerLines!: LineMaterial;

  n1 = 0; // 0..1 (fraction of 100 % N1)
  n2 = 0;
  heat = 0;
  reduced = false;
  lineWidth = 1.25;
  events: EngineEvents = {};

  constructor() {
    // solids stay in the transparent pass for the whole session so parts can
    // ghost out during inspection without a shader recompile
    this.solid = new THREE.MeshStandardMaterial({
      color: 0x0c0e11, roughness: 0.78, metalness: 0.2, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
      transparent: true, opacity: 1,
    });
    this.linerMat = this.solid.clone();
    this.linerMat.emissive = ORANGE.clone();
    this.linerMat.emissiveIntensity = 0;
  }

  /** Build all parts, yielding between them so the boot screen can report progress. */
  async build(onProgress: (i: number, n: number, id: string) => Promise<void> | void) {
    const defs = partDefs();
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]();
      const part = new Part(def, this.solid, this.lineRes);
      if (def.id === 'combustor') this.addCombustorExtras(part);
      this.parts.push(part);
      this.byId.set(part.id, part);
      this.root.add(part.group);
      await onProgress(i + 1, defs.length, def.id);
    }
  }

  private addCombustorExtras(part: Part) {
    const liner = combustorLiner();
    this.linerLines = makeLineMat(this.lineRes);
    part.addBuilder(liner, part.group, this.linerMat, this.linerLines);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, opacity: 0 }));
    this.glow.position.set(1.78, 0, 0);
    this.glow.scale.setScalar(1.5);
    this.glow.renderOrder = 4;
    this.glow.raycast = () => {};
    part.group.add(this.glow);
    this.fire = new THREE.PointLight(0xff5a10, 0, 2.4, 1.6);
    this.fire.position.set(1.78, 0.0, 0);
    part.group.add(this.fire);
  }

  meshes() {
    return this.parts.flatMap((p) => p.meshes);
  }

  /** Show objects that start hidden so their shaders compile during boot, not mid-scroll. */
  revealForCompile(on: boolean) {
    for (const p of this.parts) for (const d of p.discs) d.visible = on;
    this.glow.visible = on;
  }

  setResolution(w: number, h: number) {
    this.lineRes.set(w, h);
  }

  /** Union box of the given parts (or all), in engine frame, at their current or a given explode state. */
  bounds(ids?: string[], state?: 'current' | 'assembled' | 'exploded', out = new THREE.Box3()) {
    out.makeEmpty();
    const tmp = new THREE.Box3();
    for (const p of this.parts) {
      if (ids && !ids.includes(p.id)) continue;
      const e = state === 'assembled' ? 0 : state === 'exploded' ? 1 : p.e;
      tmp.copy(p.box).translate(p.offset.clone().multiplyScalar(e));
      out.union(tmp);
    }
    return out;
  }

  anyMoving() {
    return this.parts.some((p) => p.isMoving);
  }

  update(dt: number, now: number) {
    const capFactor = this.reduced ? 0.12 : 0.28;
    const lpOmega = (this.n1 * N1_RPM_100 / 60) * Math.PI * 2;
    const hpOmega = (this.n2 * N2_RPM_100 / 60) * Math.PI * 2;
    const fps = 60;

    for (const p of this.parts) {
      p.step(now, this.events);
      p.group.position.copy(p.offset).multiplyScalar(p.e);
      p.hover = damp(p.hover, p.hovered ? 1 : 0, 18, dt);
      p.flash = Math.max(0, p.flash - dt * 2.6);
      p.focus = damp(p.focus, p.focusTarget, 6, dt);

      // spin with an anti-strobe cap: never step more than a fraction of the
      // blade pitch per frame, and hand over to a motion-blur disc instead
      if (p.spool) {
        const omega = p.spool === 'LP' ? lpOmega : hpOmega;
        const cap = capFactor * p.pitch;
        const stepTrue = omega * dt;
        p.angle = (p.angle + Math.min(stepTrue, cap)) % (Math.PI * 2);
        p.rotor.rotation.x = p.angle;
        const ratio = omega / (cap * fps);
        p.blur = damp(p.blur, smooth(0.45, 1.6, ratio), 4, dt);
      }

      // parts outside the inspected module turn into faint ghosts that no
      // longer hide what is behind them
      const ghost = 1 - p.focus;
      p.mat.opacity = 1 - 0.82 * ghost;
      p.mat.depthWrite = ghost < 0.5;

      const accent = Math.max(p.hover, p.flash * p.flash, p.heat);
      const reveal = p.revealed;
      const dim = 0.08 + 0.92 * p.focus;
      const statColor = p.statMat.color.copy(WHITE).lerp(ORANGE, accent);
      p.rotMat.color.copy(statColor);
      p.statMat.opacity = 0.95 * dim * reveal;
      p.rotMat.opacity = 0.95 * dim * reveal * (1 - 0.72 * p.blur);
      p.rotMat.linewidth = p.statMat.linewidth = this.lineWidth * (1 + 0.35 * p.flash);
      for (const d of p.discs) {
        const m = d.material as THREE.ShaderMaterial;
        m.uniforms.uOpacity.value = p.blur * dim * reveal;
        d.visible = p.blur > 0.01;
      }
    }

    // combustor heat
    const comb = this.byId.get('combustor');
    if (comb) {
      const h = this.heat;
      comb.heat = h * 0.85;
      this.linerMat.emissiveIntensity = h * 1.25;
      this.linerMat.opacity = comb.mat.opacity;
      this.linerMat.depthWrite = comb.mat.depthWrite;
      this.linerLines.color.copy(WHITE).lerp(ORANGE, Math.max(h, comb.hover, comb.flash));
      this.linerLines.opacity = 0.95 * (0.08 + 0.92 * comb.focus) * comb.revealed;
      this.linerLines.linewidth = this.lineWidth;
      const flicker = this.reduced ? 1 : 0.94 + 0.06 * Math.sin(now * 31) * Math.sin(now * 13.7);
      (this.glow.material as THREE.SpriteMaterial).opacity = h * 0.55 * flicker;
      this.glow.visible = h > 0.01;
      this.fire.intensity = h * 2.2 * flicker;
      // the hot section downstream picks up some of the colour
      const tint: Array<[string, number]> = [['hpt1', 0.5], ['hpt2', 0.38], ['lpt1', 0.22]];
      for (const [id, k] of tint) { const p = this.byId.get(id); if (p) p.heat = h * k; }
    }
  }
}
