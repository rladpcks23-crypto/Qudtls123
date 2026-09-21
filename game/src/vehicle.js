// Vehicles: box-built models, arcade driving physics, traffic + police AI.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, wrapAngle, dampAngle, randRange, randInt, pick, makeRng, TAU } from './util.js';
import { S, ROAD, N, HALF, LANE, roadLine, nearestLine } from './city.js';

const TYPES = {
  sedan:  { l: 4.5, w: 1.95, h: 1.42, power: 18, max: 38, mass: 1, cabin: [.52, .55, -.09] },
  sport:  { l: 4.4, w: 2.0,  h: 1.18, power: 27,   max: 55, mass: .85, cabin: [.45, .46, -.13] },
  suv:    { l: 4.9, w: 2.1,  h: 1.82, power: 17,   max: 35, mass: 1.35, cabin: [.6, .72, -.05] },
  van:    { l: 5.4, w: 2.15, h: 2.15, power: 15,   max: 30, mass: 1.6, cabin: [.72, .9, .04] },
  taxi:   { l: 4.6, w: 1.98, h: 1.5,  power: 17,   max: 36, mass: 1.05, cabin: [.54, .58, -.08] },
  police: { l: 4.7, w: 2.02, h: 1.48, power: 24,   max: 48, mass: 1.1, cabin: [.54, .58, -.08] },
};
export const VEHICLE_NAMES = {
  sedan: '세단', sport: '스포츠카', suv: 'SUV', van: '밴', taxi: '택시', police: '순찰차'
};

const BODY_COLORS = [0xb9202e, 0x1b3a6b, 0x1d1f24, 0xdfe2e6, 0x2f6b4a, 0xc9a227, 0x6a2d7a,
  0x2a2f38, 0x8c9096, 0xd06a1e, 0x14707e, 0x7a1f3d];

const sharedGeo = {};
function wheelGeo(r, w) {
  const k = 'w' + r + '_' + w;
  if (!sharedGeo[k]) {
    const g = new THREE.CylinderGeometry(r, r, w, 12);
    g.rotateZ(Math.PI / 2);
    sharedGeo[k] = g;
  }
  return sharedGeo[k];
}
const MAT = {
  tyre: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: .95 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xa8adb5, roughness: .32, metalness: .9 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: .5, metalness: .7 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x0d1a24, roughness: .06, metalness: .2, transparent: true, opacity: .62,
    transmission: 0, side: THREE.DoubleSide
  }),
  lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

function boxGeo(w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
function coloredQuad(w, h, x, y, z, color, ry = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Builds a vehicle mesh group. +Z is forward. */
export function buildVehicle(type, colorHex) {
  const T = TYPES[type];
  const g = new THREE.Group();
  const L = T.l, W = T.w, H = T.h;
  const bodyParts = [];
  const ride = 0.34, bh = H - ride;

  // main body: lower slab + upper cabin, slightly tapered nose
  bodyParts.push(boxGeo(W, bh * .52, L, 0, ride + bh * .26, 0));
  bodyParts.push(boxGeo(W * .92, bh * .26, L * .96, 0, ride + bh * .62, 0));
  // bonnet: a slab from the front bumper to the windscreen
  const nose = L * (0.5 + T.cabin[2]) - L * T.cabin[1] / 2;
  bodyParts.push(boxGeo(W * .86, bh * .2, nose, 0, ride + bh * .76, L * (0.5 + T.cabin[2]) - nose / 2));
  const [cw, cl, coff] = T.cabin;
  bodyParts.push(boxGeo(W * cw * 1.55, bh * .46, L * cl, 0, ride + bh * .82, L * coff));
  // fenders
  bodyParts.push(boxGeo(W * 1.01, bh * .3, L * .3, 0, ride + bh * .3, L * .3));
  bodyParts.push(boxGeo(W * 1.01, bh * .3, L * .3, 0, ride + bh * .3, -L * .3));
  if (type === 'sport') bodyParts.push(boxGeo(W * .9, .07, .4, 0, ride + bh * 1.02, -L * .47));  // spoiler

  const bodyGeo = mergeGeometries(bodyParts, false);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex, roughness: .34, metalness: .5, envMapIntensity: 1.25
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // glass
  const gy = ride + bh * .84, gw = W * cw * 1.5, gl = L * cl;
  const glass = new THREE.Mesh(mergeGeometries([
    boxGeo(gw * .99, bh * .3, .06, 0, gy, L * coff + gl / 2),
    boxGeo(gw * .99, bh * .3, .06, 0, gy, L * coff - gl / 2),
    boxGeo(.06, bh * .3, gl * .92, gw / 2, gy, L * coff),
    boxGeo(.06, bh * .3, gl * .92, -gw / 2, gy, L * coff),
  ], false), MAT.glass);
  g.add(glass);

  // trim: bumpers, grille, mirrors, exhaust
  const trim = new THREE.Mesh(mergeGeometries([
    boxGeo(W * 1.02, .2, .3, 0, ride + .22, L / 2 - .05),
    boxGeo(W * 1.02, .2, .3, 0, ride + .22, -L / 2 + .05),
    boxGeo(W * .62, .16, .1, 0, ride + bh * .44, L / 2),
    boxGeo(.1, .12, .2, W / 2 + .05, ride + bh * .78, L * coff + gl / 2 - .2),
    boxGeo(.1, .12, .2, -W / 2 - .05, ride + bh * .78, L * coff + gl / 2 - .2),
  ], false), MAT.trim);
  trim.castShadow = true;
  g.add(trim);

  // lights (unlit emissive quads)
  const hl = [1, .96, .86], tl = [1, .12, .12];
  const lightGeo = mergeGeometries([
    coloredQuad(.42, .18, W * .32, ride + bh * .48, L / 2 + .02, hl),
    coloredQuad(.42, .18, -W * .32, ride + bh * .48, L / 2 + .02, hl),
    coloredQuad(.42, .16, W * .32, ride + bh * .5, -L / 2 - .02, tl),
    coloredQuad(.42, .16, -W * .32, ride + bh * .5, -L / 2 - .02, tl),
  ], false);
  const lights = new THREE.Mesh(lightGeo, MAT.lights.clone());
  lights.material.transparent = true;
  g.add(lights);

  // wheels
  const wr = type === 'suv' || type === 'van' ? .42 : .36;
  const wheels = [];
  const wx = W / 2 - .12, wz = L * .32;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const wg = new THREE.Group();
    wg.position.set(sx * wx, wr, sz * wz);
    const tyre = new THREE.Mesh(wheelGeo(wr, .26), MAT.tyre);
    tyre.castShadow = true;
    const rim = new THREE.Mesh(wheelGeo(wr * .56, .28), MAT.rim);
    wg.add(tyre, rim);
    g.add(wg);
    wheels.push({ g: wg, front: sz > 0, tyre, rim });
  }

  // police light bar
  let bar = null;
  if (type === 'police') {
    bar = new THREE.Group();
    const bb = new THREE.Mesh(boxGeo(1.1, .08, .26, 0, 0, 0), MAT.trim);
    bar.add(bb);
    const mk = (c, x) => {
      const m = new THREE.Mesh(boxGeo(.42, .13, .22, x, .05, 0),
        new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity: .25 }));
      bar.add(m); return m;
    };
    bar.red = mk(0xff1133, -.3); bar.blue = mk(0x2255ff, .3);
    bar.position.set(0, ride + bh * 1.08, L * coff);
    g.add(bar);
  }

  g.userData = { body, glass, trim, lights, wheels, bar, bodyMat, T, type };
  return g;
}

let vid = 0;
export class Vehicle {
  constructor(game, type, x, z, yaw, mode = 'traffic', colorHex) {
    this.id = ++vid;
    this.game = game;
    this.type = type;
    this.T = TYPES[type];
    this.mode = mode;
    this.color = colorHex ?? (type === 'police' ? 0xf2f4f7 : type === 'taxi' ? 0xf5c518 : pick(game.rng, BODY_COLORS));
    this.mesh = buildVehicle(type, this.color);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;
    game.scene.add(this.mesh);

    this.pos = new THREE.Vector2(x, z);
    this.vel = new THREE.Vector2(0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.wheelSpin = 0;
    this.health = 100;
    this.dead = false;
    this.driver = null;
    this.occupied = false;
    this.bobT = Math.random() * 10;

    // AI state
    this.aiTarget = null;
    this.aiDir = [0, 1];
    this.aiSpeed = randRange(game.rng, 14, 22);
    this.stuckT = 0;

    if (mode === 'traffic') this.planNextNode(true);
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() {
    return this.vel.x * Math.sin(this.yaw) + this.vel.y * Math.cos(this.yaw);
  }

  // ---- traffic routing ----------------------------------------------------
  planNextNode(initial = false) {
    const rng = this.game.rng;
    let [dx, dz] = this.aiDir;
    if (initial) {
      // snap the direction to whichever lane we spawned on
      const nx = Math.abs(this.pos.x - roadLine(nearestLine(this.pos.x)));
      const nz = Math.abs(this.pos.y - roadLine(nearestLine(this.pos.y)));
      if (nx < nz) { dx = 0; dz = Math.sign(Math.cos(this.yaw)) || 1; }
      else { dz = 0; dx = Math.sign(Math.sin(this.yaw)) || 1; }
    } else {
      const opts = [];
      if (dx !== 0) { opts.push([dx, 0], [dx, 0], [0, 1], [0, -1]); }
      else { opts.push([0, dz], [0, dz], [1, 0], [-1, 0]); }
      const nxt = pick(rng, opts);
      dx = nxt[0]; dz = nxt[1];
    }
    this.aiDir = [dx, dz];

    // next intersection along that direction
    let i = nearestLine(this.pos.x), j = nearestLine(this.pos.y);
    if (dx !== 0) i = clamp(i + dx, 0, N); else j = clamp(j + dz, 0, N);
    // bounce off the map edge
    if ((dx > 0 && i === N && Math.abs(this.pos.x - roadLine(N)) < 4) ||
        (dx < 0 && i === 0 && Math.abs(this.pos.x - roadLine(0)) < 4)) { this.aiDir = [0, Math.random() < .5 ? 1 : -1]; return this.planNextNode(); }
    if ((dz > 0 && j === N && Math.abs(this.pos.y - roadLine(N)) < 4) ||
        (dz < 0 && j === 0 && Math.abs(this.pos.y - roadLine(0)) < 4)) { this.aiDir = [Math.random() < .5 ? 1 : -1, 0]; return this.planNextNode(); }

    const cx = roadLine(i), cz = roadLine(j);
    // keep to the right-hand lane
    const tx = dx !== 0 ? cx - dx * 6 : cx + (dz > 0 ? -LANE : LANE);
    const tz = dz !== 0 ? cz - dz * 6 : cz + (dx > 0 ? LANE : -LANE);
    this.aiTarget = new THREE.Vector2(tx, tz);
  }

  aiDrive(dt) {
    const game = this.game;
    if (this.mode === 'police' && game.wanted > 0) {
      const t = game.playerWorldPos();
      this.driveToward(t.x, t.z, dt, 22 + game.wanted * 6, true);
      return;
    }
    if (this.mode === 'police') { this.mode = 'traffic'; this.planNextNode(true); }

    if (!this.aiTarget) this.planNextNode(true);
    const d = this.aiTarget.distanceTo(this.pos);
    if (d < 7) this.planNextNode();
    this.driveToward(this.aiTarget.x, this.aiTarget.y, dt, this.aiSpeed, false);
  }

  driveToward(tx, tz, dt, targetSpeed, aggressive) {
    const dx = tx - this.pos.x, dz = tz - this.pos.y;
    const want = Math.atan2(dx, dz);
    const err = wrapAngle(want - this.yaw);
    this.steer = clamp(err * (aggressive ? 1.6 : 1.25), -1, 1);

    // look ahead for other cars / the player
    let blocked = 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ahead = 6 + this.forwardSpeed * 0.75;
    for (const o of this.game.vehicles) {
      if (o === this) continue;
      const rx = o.pos.x - this.pos.x, rz = o.pos.y - this.pos.y;
      const dist = Math.hypot(rx, rz);
      if (dist > ahead + 3) continue;
      const dot = (rx * fx + rz * fz) / (dist || 1);
      const lat = Math.abs(rx * fz - rz * fx);
      if (dot > 0.65 && lat < 2.6) blocked = Math.max(blocked, 1 - dist / (ahead + 3));
    }
    for (const p of this.game.peds) {
      if (p.dead) continue;
      const rx = p.pos.x - this.pos.x, rz = p.pos.z - this.pos.y;
      const dist = Math.hypot(rx, rz);
      if (dist > 9) continue;
      const dot = (rx * fx + rz * fz) / (dist || 1);
      const lat = Math.abs(rx * fz - rz * fx);
      if (dot > 0.7 && lat < 2.2) blocked = Math.max(blocked, .8);
    }

    const spd = this.forwardSpeed;
    const want2 = targetSpeed * (1 - blocked) * (1 - Math.min(.55, Math.abs(err) * .5));
    if (spd < want2) { this.throttle = 1; this.brake = 0; }
    else { this.throttle = 0; this.brake = blocked > .5 ? 1 : .35; }

    if (this.stuck) this.throttle = 1;
  }

  update(dt, cityRef) {
    if (this.dead) { this.updateWreck(dt); return; }
    if (this.mode === 'traffic' || this.mode === 'police') this.aiDrive(dt);

    const T = this.T;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vl = this.vel.x * rx + this.vel.y * rz;

    const power = T.power * (this.mode === 'player' ? 1 : .92);
    const maxS = T.max * (this.mode === 'player' ? 1 : .8);
    vf += this.throttle * power * dt / T.mass;
    if (this.throttle < 0) vf += this.throttle * power * .55 * dt / T.mass;
    vf -= this.brake * 26 * dt * Math.sign(vf) * (Math.abs(vf) > .4 ? 1 : 0);
    vf *= Math.exp(-(0.12 + Math.abs(vf) * 0.004) * dt);
    vf = clamp(vf, -maxS * .42, maxS);

    // steering: less authority at speed, reversed when backing up
    const grip = this.handbrake ? 2.2 : 9.5;
    const steerAuth = clamp(1.15 - Math.abs(vf) / (maxS * 1.7), .28, 1);
    const target = this.steer * 2.05 * steerAuth * clamp(Math.abs(vf) / 5.5, 0, 1) * Math.sign(vf || 1);
    this.yawRate = damp(this.yawRate, target, 9, dt);
    this.yaw += this.yawRate * dt;

    vl *= Math.exp(-grip * dt);
    vl += -this.yawRate * vf * dt * (this.handbrake ? 0.95 : 0.35);

    this.vel.set(fx * vf + rx * vl, fz * vf + rz * vl);
    this.drift = Math.min(1, Math.abs(vl) / 7);

    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.y + this.vel.y * dt;
    this.pos.set(nx, nz);

    // --- collision with the world ----------------------------------------
    const R = T.w * 0.52;
    const pts = [
      { x: this.pos.x + fx * T.l * .3, z: this.pos.y + fz * T.l * .3 },
      { x: this.pos.x - fx * T.l * .3, z: this.pos.y - fz * T.l * .3 },
    ];
    let bumped = false;
    for (const p of pts) {
      const before = { x: p.x, z: p.z };
      const v = { x: p.x, z: p.z };
      if (cityRef.resolveCircle(v, R, 1.0)) {
        const px = v.x - before.x, pz = v.z - before.z;
        this.pos.x += px; this.pos.y += pz;
        const n = Math.hypot(px, pz) || 1;
        const dot = (this.vel.x * px + this.vel.y * pz) / n;
        if (dot < 0) {
          this.vel.x -= (px / n) * dot * 1.35;
          this.vel.y -= (pz / n) * dot * 1.35;
        }
        bumped = true;
      }
    }
    if (bumped) {
      const impact = Math.abs(vf);
      if (impact > 7) {
        this.damage(impact * 1.5);
        if (this.mode === 'player') this.game.onCrash(this, impact);
      }
      if (this.mode !== 'player') { this.stuckT += dt; if (this.stuckT > 2.4) this.respawnAI(); }
      this.vel.multiplyScalar(0.55);
    } else if (this.speed > 2) this.stuckT = Math.max(0, this.stuckT - dt);
    else if (this.mode !== 'player') { this.stuckT += dt * .5; if (this.stuckT > 8) this.respawnAI(); }

    // --- vehicle vs vehicle ----------------------------------------------
    for (const o of this.game.vehicles) {
      if (o === this || o.dead) continue;
      const rxx = o.pos.x - this.pos.x, rzz = o.pos.y - this.pos.y;
      const dist = Math.hypot(rxx, rzz);
      const minD = (this.T.l + o.T.l) * 0.33;
      if (dist > minD || dist < 1e-4) continue;
      const push = (minD - dist) / 2;
      const ux = rxx / dist, uz = rzz / dist;
      this.pos.x -= ux * push; this.pos.y -= uz * push;
      o.pos.x += ux * push; o.pos.y += uz * push;
      const rel = (this.vel.x - o.vel.x) * ux + (this.vel.y - o.vel.y) * uz;
      if (rel > 0) {
        const j = rel * 0.9;
        this.vel.x -= ux * j; this.vel.y -= uz * j;
        o.vel.x += ux * j * .8; o.vel.y += uz * j * .8;
        if (rel > 8) {
          this.damage(rel * 1.2); o.damage(rel * 1.2);
          if (this.mode === 'player' || o.mode === 'player') this.game.onCrash(this, rel);
        }
      }
    }

    this.applyTransform(dt, vf);
  }

  applyTransform(dt, vf) {
    const m = this.mesh;
    m.position.x = this.pos.x; m.position.z = this.pos.y;
    m.rotation.y = this.yaw;

    // body roll / pitch from acceleration
    this.bobT += dt;
    const roll = clamp(-this.yawRate * Math.abs(vf) * 0.018, -.13, .13);
    const pitch = clamp((this.brake * Math.sign(vf) * .05) - (this.throttle * .025), -.08, .08);
    m.rotation.z = damp(m.rotation.z, roll, 8, dt);
    m.rotation.x = damp(m.rotation.x, pitch + Math.sin(this.bobT * 9) * 0.002 * Math.min(1, Math.abs(vf) / 10), 8, dt);

    const ud = m.userData;
    this.wheelSpin += vf * dt / 0.36;
    for (const w of ud.wheels) {
      w.g.rotation.x = -this.wheelSpin;
      if (w.front) w.g.rotation.y = damp(w.g.rotation.y, this.steer * .5, 12, dt);
    }
    // brake lights / headlights
    const lit = this.game.nightFactor > .25 || this.mode === 'player';
    ud.lights.material.opacity = this.brake > .1 ? 1 : (lit ? .85 : .35);

    if (ud.bar) {
      const t = performance.now() / 1000;
      const on = this.game.wanted > 0 || this.mode === 'police';
      const f = on ? (Math.sin(t * 9) > 0 ? 1 : 0) : 0;
      ud.bar.red.material.opacity = on ? (f ? 1 : .15) : .15;
      ud.bar.blue.material.opacity = on ? (f ? .15 : 1) : .15;
    }
  }

  /** Drops wheels, glass and shadows for distant cars; hides them entirely far away. */
  setLod(d2, quality) {
    const ud = this.mesh.userData;
    const visible = d2 < 135 * 135;
    if (this.mesh.visible !== visible) this.mesh.visible = visible;
    if (!visible) return;
    const detail = d2 < 52 * 52;
    if (this._detail !== detail) {
      this._detail = detail;
      for (const w of ud.wheels) w.rim.visible = detail;
      ud.glass.visible = detail || quality === 'high';
      ud.trim.visible = detail || quality === 'high';
      ud.body.castShadow = detail;
    }
  }

  damage(v) {
    if (this.dead) return;
    this.health -= v;
    if (this.health <= 0) this.explode();
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.wreckT = 0;
    this.game.fx.explosion(this.pos.x, 1.1, this.pos.y);
    this.game.audio.impact(1);
    this.mesh.userData.bodyMat.color.setHex(0x1a1512);
    this.mesh.userData.bodyMat.roughness = .95;
    this.mesh.userData.bodyMat.metalness = .1;
    this.mesh.userData.lights.visible = false;
    this.game.explosionDamage(this.pos.x, this.pos.y, 9, 60, this);
    if (this.occupied) this.game.ejectPlayer(true);
    if (this.driver) { this.driver.kill(); this.driver = null; }
  }

  updateWreck(dt) {
    this.wreckT += dt;
    this.vel.multiplyScalar(Math.exp(-2 * dt));
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt;
    this.mesh.position.x = this.pos.x; this.mesh.position.z = this.pos.y;
    if (this.wreckT < 6 && Math.random() < dt * 14) {
      this.game.fx.smoke(this.pos.x, 1.3, this.pos.y);
    }
  }

  respawnAI() {
    this.stuckT = 0;
    const g = this.game;
    const p = g.farRoadPoint();
    if (!p) return;
    this.pos.set(p.x, p.z);
    this.yaw = Math.atan2(p.dir[0], p.dir[1]);
    this.aiDir = [p.dir[0], p.dir[1]];
    this.vel.set(0, 0);
    this.health = 100;
    this.planNextNode(true);
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.mesh.userData.bodyMat.dispose();
  }
}

export function randomCarType(rng, allowPolice = false) {
  const pool = ['sedan', 'sedan', 'sedan', 'sport', 'suv', 'suv', 'van', 'taxi'];
  if (allowPolice) pool.push('police');
  return pick(rng, pool);
}
