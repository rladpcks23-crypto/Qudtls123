import * as THREE from 'three';

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export interface Region { x: number; y: number; w: number; h: number }

/**
 * Renderer, lights and a camera rig that frames a box inside a screen
 * region (the part of the screen not covered by text), using the camera's
 * view offset so orbiting stays centred on the subject.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 200);
  readonly clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6);
  width = 1;
  height = 1;
  region: Region = { x: 0, y: 0, w: 1, h: 1 };

  // rig state
  private goalTarget = new THREE.Vector3();
  private goalDir = new THREE.Vector3(0, 0, 1);
  private goalDist = 8;
  readonly target = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, 1);
  dist = 8;
  private initialized = false;

  // user orbit offsets
  yaw = 0;
  pitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private idle = 0;
  dragging = false;
  ambientYaw = 0;
  chase = 4.2;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = false;
    // the clip plane stays bound for the whole session (parked far away when
    // idle) so starting or ending the scan never triggers a shader recompile
    this.renderer.clippingPlanes = [this.clip];

    const hemi = new THREE.HemisphereLight(0x9aa6b4, 0x050607, 1.1);
    const key = new THREE.DirectionalLight(0xf2f4f7, 1.6);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x8fa3b8, 0.9);
    rim.position.set(4, 1.5, -5);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(2, -3, 3);
    this.scene.add(hemi, key, rim, fill);
  }

  resize(w: number, h: number, dpr: number) {
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
  }

  setRegion(r: Region) {
    this.region = r;
    this.applyViewOffset();
  }

  private applyViewOffset() {
    const { width: W, height: H, region: r } = this;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Frame a world-space box seen from `dir` (unit, from target toward camera).
   * Solves the camera distance so every corner lands inside the region.
   */
  frame(box: THREE.Box3, dir: THREE.Vector3, margin = 1.08) {
    const c = box.getCenter(new THREE.Vector3());
    const d = this.fitDistance(box, c, this.orbitDir(dir), margin);
    this.goalTarget.copy(c);
    this.goalDir.copy(dir);
    this.goalDist = d;
    if (!this.initialized) this.snap();
  }

  snap() {
    this.target.copy(this.goalTarget);
    this.dir.copy(this.goalDir);
    this.dist = this.goalDist;
    this.initialized = true;
  }

  private fitDistance(box: THREE.Box3, c: THREE.Vector3, dir: THREE.Vector3, margin: number) {
    const { width: W, height: H, region: r } = this;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (r.h / H);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (W / H) * (r.w / W);
    const F = dir.clone().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const R = new THREE.Vector3().crossVectors(F, up).normalize();
    const U = new THREE.Vector3().crossVectors(R, F);
    let d = 0.5;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const x = Math.abs(p.dot(R)) * margin, y = Math.abs(p.dot(U)) * margin, z = p.dot(F);
      d = Math.max(d, x / tanH - z, y / tanV - z);
    }
    return d;
  }

  /** direction after user orbit and ambient drift */
  private orbitDir(base: THREE.Vector3, out = new THREE.Vector3()) {
    out.copy(base);
    const up = new THREE.Vector3(0, 1, 0);
    out.applyAxisAngle(up, this.yaw + this.ambientYaw);
    const el = Math.asin(THREE.MathUtils.clamp(out.y, -1, 1));
    const maxEl = THREE.MathUtils.degToRad(72);
    const want = THREE.MathUtils.clamp(el + this.pitch, -maxEl, maxEl);
    const right = new THREE.Vector3().crossVectors(up, out).normalize();
    if (right.lengthSq() > 1e-6) out.applyAxisAngle(right, -(want - el));
    return out.normalize();
  }

  drag(dx: number, dy: number) {
    const s = 0.0055;
    this.vYaw = -dx * s;
    this.vPitch = dy * s;
    this.yaw += this.vYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.vPitch, -1.1, 1.1);
    this.idle = 0;
  }

  update(dt: number) {
    if (!this.dragging) {
      this.yaw += this.vYaw;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.vPitch, -1.1, 1.1);
      this.vYaw *= Math.exp(-dt * 5);
      this.vPitch *= Math.exp(-dt * 5);
      this.idle += dt;
      if (this.idle > 3) {
        const k = damp(0.9, dt);
        this.yaw -= this.yaw * k;
        this.pitch -= this.pitch * k;
      }
    }
    const k = damp(this.chase, dt);
    this.target.lerp(this.goalTarget, k);
    this.dir.lerp(this.goalDir, k).normalize();
    this.dist += (this.goalDist - this.dist) * k;

    const d = this.orbitDir(this.dir);
    this.camera.position.copy(this.target).addScaledVector(d, this.dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(0.05, this.dist * 0.05);
    this.camera.far = this.dist * 6 + 20;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** camera azimuth/elevation in degrees, for the HUD readout */
  azEl() {
    const v = this.camera.position.clone().sub(this.target).normalize();
    const az = (THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)) + 360) % 360;
    const el = THREE.MathUtils.radToDeg(Math.asin(v.y));
    return { az, el };
  }

  /** Scan-line clip plane through the camera, at screen fraction u (0 left .. 1 right). */
  setScan(u: number | null) {
    if (u === null) {
      this.clip.set(new THREE.Vector3(1, 0, 0), 1e6);
      return;
    }
    const ndcX = u * 2 - 1;
    const p = new THREE.Vector3(ndcX, 0, 0.5).unproject(this.camera);
    const q = new THREE.Vector3(ndcX, 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const n = new THREE.Vector3().crossVectors(p.clone().sub(o), q.clone().sub(o)).normalize();
    // keep the side already swept (left of the line)
    const left = new THREE.Vector3(-1, 0, 0.5).unproject(this.camera).sub(o);
    if (n.dot(left) < 0) n.negate();
    this.clip.setFromNormalAndCoplanarPoint(n, o);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
