// Low-poly humanoid with fully procedural animation (no skeletal assets).
import * as THREE from 'three';
import { clamp, lerp, damp, randRange, pick } from './util.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

const SKIN = [0xf1c7a4, 0xd9a173, 0xa9724c, 0x7a4e30, 0xf6d6bb];
const SHIRT = [0x2b4f8f, 0x7a2b3c, 0x2f6b52, 0x8d6a2f, 0x413f55, 0xa14b2a, 0x2c6d86, 0x6f3f7a];
const PANTS = [0x232733, 0x3a3f4d, 0x2c2a26, 0x1d2b3a, 0x4a4438];

export class Human {
  constructor(opts = {}) {
    const rng = opts.rng || Math.random;
    const skin = opts.skin ?? pick(rng, SKIN);
    const shirt = opts.shirt ?? pick(rng, SHIRT);
    const pants = opts.pants ?? pick(rng, PANTS);
    const scale = opts.scale ?? randRange(rng, 0.95, 1.06);

    const mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: .82 });
    const mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: .78 });
    const mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: .84 });
    const mShoe = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: .6 });
    const mHair = new THREE.MeshStandardMaterial({ color: opts.hair ?? 0x1b1410, roughness: .9 });

    const root = this.root = new THREE.Group();
    root.scale.setScalar(scale);
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);

    const torso = new THREE.Mesh(box(.46, .58, .26), mShirt);
    torso.position.y = .29; hips.add(torso);
    const belt = new THREE.Mesh(box(.44, .1, .25), mPants); belt.position.y = .02; hips.add(belt);

    const neck = new THREE.Group(); neck.position.y = .6; hips.add(neck);
    this.neck = neck;
    const head = new THREE.Mesh(box(.23, .26, .24), mSkin); head.position.y = .14; neck.add(head);
    const hair = new THREE.Mesh(box(.245, .1, .255), mHair); hair.position.y = .26; neck.add(hair);
    if (opts.cap) {
      const cap = new THREE.Mesh(box(.26, .09, .26), new THREE.MeshStandardMaterial({ color: opts.cap, roughness: .7 }));
      cap.position.y = .28; neck.add(cap);
      const brim = new THREE.Mesh(box(.26, .03, .12), cap.material); brim.position.set(0, .25, -.17); neck.add(brim);
    }

    const arm = side => {
      const sh = new THREE.Group(); sh.position.set(side * .29, .5, 0); hips.add(sh);
      const upper = new THREE.Mesh(box(.14, .3, .15), mShirt); upper.position.y = -.15; sh.add(upper);
      const el = new THREE.Group(); el.position.y = -.3; sh.add(el);
      const fore = new THREE.Mesh(box(.12, .3, .13), mSkin); fore.position.y = -.15; el.add(fore);
      const hand = new THREE.Group(); hand.position.y = -.3; el.add(hand);
      return { sh, el, hand };
    };
    this.armL = arm(1); this.armR = arm(-1);

    const leg = side => {
      const hip = new THREE.Group(); hip.position.set(side * .12, 0, 0); hips.add(hip);
      const thigh = new THREE.Mesh(box(.17, .44, .18), mPants); thigh.position.y = -.22; hip.add(thigh);
      const kn = new THREE.Group(); kn.position.y = -.44; hip.add(kn);
      const shin = new THREE.Mesh(box(.15, .42, .16), mPants); shin.position.y = -.21; kn.add(shin);
      const foot = new THREE.Mesh(box(.16, .1, .27), mShoe); foot.position.set(0, -.44, .05); kn.add(foot);
      return { hip, kn };
    };
    this.legL = leg(1); this.legR = leg(-1);

    this.meshes = [];
    root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; this.meshes.push(o); }
    });

    this.phase = rng() * 10;
    this.aimBlend = 0;
    this.sitBlend = 0;
    this.deadBlend = 0;
    this.bobY = 0;
    this.stepFlag = 0;
    this.materials = [mSkin, mShirt, mPants, mShoe, mHair];
  }

  attachWeapon(mesh) {
    if (this.weapon) this.armR.hand.remove(this.weapon);
    this.weapon = mesh;
    if (mesh) { mesh.position.set(0, -.06, .06); this.armR.hand.add(mesh); }
  }

  setVisible(v) { this.root.visible = v; }

  /** Distant characters stop casting shadows - that is a shadow-map draw each. */
  setShadow(on) {
    if (this._shadow === on) return;
    this._shadow = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  /**
   * @param {object} st  speed (m/s), aiming, sitting, dead, steer (-1..1 for driving)
   */
  update(dt, st) {
    const speed = st.speed || 0;
    const moving = speed > 0.12;
    this.phase += dt * (moving ? clamp(speed * 1.65, 3, 13) : 2.4);
    this.aimBlend = damp(this.aimBlend, st.aiming ? 1 : 0, 14, dt);
    this.sitBlend = damp(this.sitBlend, st.sitting ? 1 : 0, 12, dt);
    this.deadBlend = damp(this.deadBlend, st.dead ? 1 : 0, 7, dt);

    const p = this.phase, s = Math.sin(p), c = Math.cos(p);
    const amp = clamp(speed / 5.4, 0, 1);
    const swing = lerp(0.14, 1.15, amp);

    // legs
    const lt = s * swing, rt = -s * swing;
    this.legL.hip.rotation.x = lt;
    this.legR.hip.rotation.x = rt;
    this.legL.kn.rotation.x = Math.max(0, -Math.sin(p - 0.7)) * swing * 0.9;
    this.legR.kn.rotation.x = Math.max(0, -Math.sin(p + Math.PI - 0.7)) * swing * 0.9;

    // arms (counter swing), overridden by aim pose
    const aSw = swing * 0.75;
    let lSh = -s * aSw, rSh = s * aSw;
    let lEl = -0.25 - Math.abs(s) * .35, rEl = -0.25 - Math.abs(s) * .35;
    let lZ = 0.07, rZ = -0.07;

    if (this.aimBlend > 0.01) {
      const b = this.aimBlend;
      lSh = lerp(lSh, -1.45, b); rSh = lerp(rSh, -1.5, b);
      lEl = lerp(lEl, -0.45, b); rEl = lerp(rEl, -0.12, b);
      lZ = lerp(lZ, 0.55, b); rZ = lerp(rZ, -0.2, b);
    }

    // sitting in a vehicle
    if (this.sitBlend > 0.01) {
      const b = this.sitBlend;
      this.legL.hip.rotation.x = lerp(this.legL.hip.rotation.x, -1.5, b);
      this.legR.hip.rotation.x = lerp(this.legR.hip.rotation.x, -1.5, b);
      this.legL.kn.rotation.x = lerp(this.legL.kn.rotation.x, 1.35, b);
      this.legR.kn.rotation.x = lerp(this.legR.kn.rotation.x, 1.35, b);
      const st2 = (st.steer || 0) * 0.5;
      lSh = lerp(lSh, -1.15 + st2, b); rSh = lerp(rSh, -1.15 - st2, b);
      lEl = lerp(lEl, -0.55, b); rEl = lerp(rEl, -0.55, b);
      lZ = lerp(lZ, 0.3, b); rZ = lerp(rZ, -0.3, b);
    }

    this.armL.sh.rotation.set(lSh, 0, lZ);
    this.armR.sh.rotation.set(rSh, 0, rZ);
    this.armL.el.rotation.x = lEl;
    this.armR.el.rotation.x = rEl;

    // torso bob + lean
    const bob = moving ? Math.abs(c) * 0.035 * amp : Math.sin(p * .5) * 0.008;
    this.hips.position.y = 0.92 + bob - this.sitBlend * 0.44;
    this.hips.rotation.z = moving ? s * 0.035 * amp : 0;
    this.hips.rotation.x = lerp(amp * 0.16, 0.05, this.sitBlend);
    this.neck.rotation.x = clamp(-(st.pitch || 0) * 0.45, -0.5, 0.5);

    // footstep events for audio
    const nf = s > 0 ? 1 : -1;
    this.stepped = moving && nf !== this.stepFlag;
    this.stepFlag = nf;

    // death: fall over
    if (this.deadBlend > 0.01) {
      this.root.rotation.z = lerp(0, Math.PI / 2 * 0.92, this.deadBlend);
      this.hips.position.y = lerp(this.hips.position.y, 0.32, this.deadBlend);
    } else if (this.root.rotation.z !== 0) this.root.rotation.z = 0;
  }

  dispose() {
    this.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.materials.forEach(m => m.dispose());
  }
}

/** Simple weapon props held in the right hand. */
export function makeWeaponMesh(kind) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: .45, metalness: .75 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: .8 });
  if (kind === 'pistol') {
    const b = new THREE.Mesh(box(.06, .1, .26), dark); b.position.set(0, .06, .06); g.add(b);
    const h = new THREE.Mesh(box(.055, .16, .08), grip); h.position.set(0, -.04, -.01); g.add(h);
    g.muzzle = new THREE.Object3D(); g.muzzle.position.set(0, .07, .2); g.add(g.muzzle);
  } else if (kind === 'smg') {
    const b = new THREE.Mesh(box(.07, .13, .42), dark); b.position.set(0, .07, .12); g.add(b);
    const h = new THREE.Mesh(box(.06, .18, .09), grip); h.position.set(0, -.04, -.02); g.add(h);
    const m = new THREE.Mesh(box(.05, .06, .2), dark); m.position.set(0, .0, .06); g.add(m);
    const st = new THREE.Mesh(box(.04, .09, .22), dark); st.position.set(0, .07, -.16); g.add(st);
    g.muzzle = new THREE.Object3D(); g.muzzle.position.set(0, .07, .34); g.add(g.muzzle);
  } else return null;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
