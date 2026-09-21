// Pooled particle effects: explosions, smoke, sparks, blood, tracers, markers.
import * as THREE from 'three';
import { randRange, clamp } from './util.js';
import * as TX from './textures.js';

const POOL = 320;

export class FX {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    const glow = TX.glow(), smoke = TX.smoke();
    this.mats = {
      fire: new THREE.SpriteMaterial({ map: glow, color: 0xffaa33, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
      spark: new THREE.SpriteMaterial({ map: glow, color: 0xfff0b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
      smoke: new THREE.SpriteMaterial({ map: smoke, color: 0x555a63, depthWrite: false, transparent: true, opacity: .5 }),
      blood: new THREE.SpriteMaterial({ map: glow, color: 0x8e1220, depthWrite: false, transparent: true }),
      dust: new THREE.SpriteMaterial({ map: smoke, color: 0x9a9a92, depthWrite: false, transparent: true, opacity: .4 }),
    };
    // every sprite owns its material so particles can fade independently
    this.pool = [];
    this.live = [];
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s); this.pool.push(s);
    }

    // tracer beams
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: .9, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.05, 0.05, 1);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat.clone());
      m.visible = false; scene.add(m); this.tracers.push({ mesh: m, life: 0 });
    }

    // objective marker (rotating gold column)
    const mg = new THREE.CylinderGeometry(1.7, 1.7, 26, 22, 1, true);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xffc63f, transparent: true, opacity: .26, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending
    });
    this.marker = new THREE.Mesh(mg, this.markerMat);
    this.marker.position.y = 13; this.marker.visible = false;
    scene.add(this.marker);

    const rg = new THREE.RingGeometry(1.5, 2.2, 28);
    rg.rotateX(-Math.PI / 2);
    this.markerRing = new THREE.Mesh(rg, this.markerMat);
    this.markerRing.visible = false; scene.add(this.markerRing);
  }

  spawn(mat, x, y, z, vx, vy, vz, size, life, fade = 1, grow = 1) {
    const s = this.pool.pop();
    if (!s) return null;
    const tpl = this.mats[mat];
    const m = s.material;
    m.map = tpl.map; m.color.copy(tpl.color); m.blending = tpl.blending;
    m.toneMapped = tpl.toneMapped ?? true; m.opacity = tpl.opacity ?? 1;
    m.needsUpdate = true;
    s.userData.kind = mat;
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.visible = true;
    const p = { s, vx, vy, vz, life, max: life, size, fade, grow };
    this.live.push(p);
    return p;
  }

  explosion(x, y, z) {
    const n = this.q === 'low' ? 10 : this.q === 'med' ? 20 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      this.spawn('fire', x, y, z,
        Math.cos(a) * r * 9, randRange(Math.random, 2, 11), Math.sin(a) * r * 9,
        randRange(Math.random, 1.4, 3.6), randRange(Math.random, .4, .9), 1, 1.8);
    }
    for (let i = 0; i < n / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn('smoke', x, y + 1, z, Math.cos(a) * 3, randRange(Math.random, 1.5, 4), Math.sin(a) * 3,
        randRange(Math.random, 2.5, 5), randRange(Math.random, 1.2, 2.4), .7, 2.4);
    }
  }
  smoke(x, y, z) {
    this.spawn('smoke', x + randRange(Math.random, -.5, .5), y, z + randRange(Math.random, -.5, .5),
      randRange(Math.random, -.6, .6), randRange(Math.random, 1.2, 2.4), randRange(Math.random, -.6, .6),
      randRange(Math.random, 1, 2.2), randRange(Math.random, 1.2, 2.2), .5, 2);
  }
  sparks(x, y, z, nrm) {
    for (let i = 0; i < 6; i++) {
      this.spawn('spark', x, y, z,
        nrm.x * 3 + randRange(Math.random, -3, 3), nrm.y * 3 + randRange(Math.random, 1, 5), nrm.z * 3 + randRange(Math.random, -3, 3),
        randRange(Math.random, .12, .3), randRange(Math.random, .18, .4), 1, .6);
    }
    this.spawn('dust', x, y, z, 0, .6, 0, .7, .5, .6, 1.8);
  }
  blood(x, y, z) {
    for (let i = 0; i < 7; i++) {
      this.spawn('blood', x, y, z, randRange(Math.random, -2.5, 2.5), randRange(Math.random, .5, 3.5), randRange(Math.random, -2.5, 2.5),
        randRange(Math.random, .15, .4), randRange(Math.random, .3, .6), 1, .8);
    }
  }
  muzzle(x, y, z) {
    this.spawn('fire', x, y, z, 0, 0, 0, 0.5, 0.05, 1, 1.2);
    this.spawn('smoke', x, y, z, randRange(Math.random, -.3, .3), .8, randRange(Math.random, -.3, .3), .28, .4, .35, 2);
  }
  tyreSmoke(x, z) {
    this.spawn('dust', x, 0.16, z, randRange(Math.random, -.6, .6), randRange(Math.random, .3, 1.1), randRange(Math.random, -.6, .6),
      randRange(Math.random, .6, 1.3), randRange(Math.random, .5, 1), .45, 2.2);
  }

  tracer(from, to) {
    const t = this.tracers.find(t => t.life <= 0);
    if (!t) return;
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    t.mesh.position.copy(from).addScaledVector(d, .5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.mesh.material.opacity = .85;
    t.life = 0.07;
  }

  setMarker(x, z, on, color = 0xffc63f) {
    this.marker.visible = this.markerRing.visible = on;
    if (!on) return;
    this.marker.position.set(x, 13, z);
    this.markerRing.position.set(x, 0.3, z);
    this.markerMat.color.setHex(color);
  }

  update(dt, t) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false; this.pool.push(p.s);
        this.live.splice(i, 1); continue;
      }
      const airy = p.s.userData.kind === 'smoke' || p.s.userData.kind === 'dust';
      p.vy -= 9 * dt * (airy ? -0.12 : 1);
      p.vx *= Math.exp(-1.6 * dt); p.vz *= Math.exp(-1.6 * dt);
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      if (p.s.position.y < 0.05) { p.s.position.y = 0.05; p.vy = Math.abs(p.vy) * 0.25; }
      const k = p.life / p.max;
      p.s.scale.setScalar(p.size * (1 + (1 - k) * p.grow));
      p.s.material.opacity = clamp(k * p.fade, 0, 1);
    }
    for (const tr of this.tracers) {
      if (tr.life > 0) {
        tr.life -= dt;
        tr.mesh.material.opacity = Math.max(0, tr.life / 0.07) * .85;
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }
    if (this.marker.visible) {
      this.marker.rotation.y = t * .7;
      this.markerRing.rotation.y = -t * 1.1;
      this.markerRing.scale.setScalar(1 + Math.sin(t * 2.4) * .08);
      this.markerMat.opacity = .2 + Math.sin(t * 2.4) * .08;
    }
  }
}
