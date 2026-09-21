// Pedestrians and foot patrol cops.
import * as THREE from 'three';
import { Human, makeWeaponMesh } from './character.js';
import { clamp, damp, dampAngle, randRange, randInt, pick, wrapAngle } from './util.js';

const WALK = 1.45, FLEE = 4.6, COP_RUN = 4.2;

export class Ped {
  constructor(game, x, z, kind = 'civ') {
    this.game = game;
    this.kind = kind;
    const rng = game.rng;
    this.human = new Human(kind === 'cop'
      ? { rng, shirt: 0x1b2a4a, pants: 0x161d2c, cap: 0x14203a, scale: 1.03 }
      : { rng });
    this.human.root.position.set(x, 0, z);
    game.scene.add(this.human.root);

    this.pos = { x, z };
    this.yaw = rng() * Math.PI * 2;
    this.vel = { x: 0, z: 0 };
    this.state = 'walk';
    this.speedTarget = kind === 'cop' ? COP_RUN : WALK * randRange(rng, .8, 1.25);
    this.target = null;
    this.fleeT = 0;
    this.health = kind === 'cop' ? 70 : 45;
    this.dead = false;
    this.deadT = 0;
    this.shootCd = randRange(rng, .6, 1.6);
    this.talkT = randRange(rng, 3, 12);

    if (kind === 'cop') {
      this.human.attachWeapon(makeWeaponMesh('pistol'));
      this.speedTarget = COP_RUN;
    }
    this.pickTarget();
  }

  pickTarget() {
    const pts = this.game.city.sidewalkPoints;
    if (!pts.length) return;
    // prefer a nearby waypoint so pedestrians tour their own block
    let best = null, bestD = 1e9;
    for (let i = 0; i < 14; i++) {
      const p = pick(this.game.rng, pts);
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d > 3 && d < bestD) { bestD = d; best = p; }
    }
    this.target = best;
  }

  flee(fromX, fromZ, t = 6) {
    if (this.dead || this.kind === 'cop') return;
    this.state = 'flee';
    this.fleeT = Math.max(this.fleeT, t);
    this.fleeFrom = { x: fromX, z: fromZ };
    this.speedTarget = FLEE;
  }

  hit(dmg, fromX, fromZ) {
    if (this.dead) return;
    this.health -= dmg;
    this.game.fx.blood(this.pos.x, 1.1, this.pos.z);
    if (this.health <= 0) { this.kill(); return; }
    this.flee(fromX ?? this.game.player.pos.x, fromZ ?? this.game.player.pos.z, 9);
    this.game.alertArea(this.pos.x, this.pos.z, 26);
  }

  kill() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.game.fx.blood(this.pos.x, .9, this.pos.z);
    this.game.onPedKilled(this);
  }

  update(dt, t) {
    const g = this.game;
    if (this.dead) {
      this.deadT += dt;
      this.human.update(dt, { speed: 0, dead: true });
      return;
    }

    let tx, tz, speed = this.speedTarget;
    if (this.kind === 'cop' && g.wanted > 0) {
      const p = g.playerWorldPos();
      tx = p.x; tz = p.z;
      const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
      this.aiming = d < 22 && !g.player.dead;
      if (d < 13) speed = 0.4;
      this.shootCd -= dt;
      if (this.aiming && this.shootCd <= 0 && g.hasLineOfSight(this.pos.x, 1.4, this.pos.z, p.x, 1.3, p.z)) {
        this.shootCd = randRange(g.rng, .7, 1.5);
        this.shoot(p);
      }
    } else if (this.state === 'flee') {
      this.fleeT -= dt;
      tx = this.pos.x + (this.pos.x - this.fleeFrom.x);
      tz = this.pos.z + (this.pos.z - this.fleeFrom.z);
      if (this.fleeT <= 0) { this.state = 'walk'; this.speedTarget = WALK * randRange(g.rng, .8, 1.25); this.pickTarget(); }
    } else {
      if (!this.target) this.pickTarget();
      if (!this.target) return;
      tx = this.target.x; tz = this.target.z;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 1.6) this.pickTarget();

      // step away from moving cars
      for (const v of g.vehicles) {
        if (v.dead || v.speed < 3) continue;
        const d = Math.hypot(v.pos.x - this.pos.x, v.pos.y - this.pos.z);
        if (d < 7) { this.flee(v.pos.x, v.pos.y, 2.5); break; }
      }
    }

    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, want, 7, dt);

    const mv = speed * dt;
    this.pos.x += Math.sin(this.yaw) * mv;
    this.pos.z += Math.cos(this.yaw) * mv;

    const p = { x: this.pos.x, z: this.pos.z };
    if (g.city.resolveCircle(p, 0.42, 1.0)) {
      this.pos.x = p.x; this.pos.z = p.z;
      if (this.state === 'walk') this.pickTarget();
    }

    this.human.root.position.set(this.pos.x, 0, this.pos.z);
    this.human.root.rotation.y = this.yaw;
    this.human.update(dt, { speed, aiming: this.aiming });
  }

  shoot(target) {
    const g = this.game;
    const from = new THREE.Vector3(this.pos.x, 1.35, this.pos.z);
    const to = new THREE.Vector3(target.x, 1.2, target.z);
    g.fx.tracer(from, to);
    g.fx.muzzle(from.x + Math.sin(this.yaw) * .5, 1.35, from.z + Math.cos(this.yaw) * .5);
    g.audio.gunshot('pistol');
    const dist = from.distanceTo(to);
    const acc = clamp(1 - dist / 30, .15, .8);
    if (Math.random() < acc) g.damagePlayer(randRange(g.rng, 5, 11), this.pos.x, this.pos.z);
  }

  dispose() {
    this.game.scene.remove(this.human.root);
    this.human.dispose();
  }
}
