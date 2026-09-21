// Neon Mile - a GTA-style open world built on three.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { clamp, lerp, damp, dampAngle, wrapAngle, randRange, randInt, pick, makeRng, money as fmtMoney } from './util.js';
import { City, HALF, N, S, ROAD, roadLine, onRoad } from './city.js';
import { Vehicle, randomCarType, VEHICLE_NAMES } from './vehicle.js';
import { Human, makeWeaponMesh } from './character.js';
import { Ped } from './npc.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Missions } from './missions.js';
import * as TX from './textures.js';

const QUALITY = {
  low:  { shadow: 0,    bloom: false, cars: 14, peds: 12, pixel: 0.75, far: 420, aa: false },
  med:  { shadow: 2048, bloom: true,  cars: 22, peds: 20, pixel: 1.0,  far: 700, aa: true },
  high: { shadow: 4096, bloom: true,  cars: 34, peds: 30, pixel: 1.0,  far: 1100, aa: true },
};

const WEAPONS = [
  { key: 'fist',   name: '주먹',     dmg: 18, rate: .42, range: 2.2, magSize: 0,  spread: 0,    auto: false, ammo: Infinity, mag: Infinity },
  { key: 'pistol', name: '9mm 권총', dmg: 26, rate: .17, range: 75,  magSize: 15, spread: .014, auto: false, ammo: 90,  mag: 15 },
  { key: 'smg',    name: 'SMG',      dmg: 17, rate: .075, range: 65, magSize: 30, spread: .032, auto: true,  ammo: 180, mag: 30 },
];

const DAY_LENGTH = 300;   // seconds for a full day/night cycle

class Game {
  constructor(quality) {
    this.qname = quality;
    this.q = QUALITY[quality];
    this.rng = makeRng(0xC0FFEE);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.dayTime = 0.38;        // 0..1, 0.25 = sunrise, 0.75 = sunset
    this.money = 500;
    this.wanted = 0;
    this.coolingDown = false;
    this.coolT = 0;
    this.objective = null;
    this.paused = false;
    this.vehicles = [];
    this.peds = [];
    this.weapons = WEAPONS.map(w => ({ ...w }));
    this.weaponIndex = 1;
    this.fireCd = 0;
    this.aiming = false;
    this.camYaw = 0; this.camPitch = 0.22; this.camDist = 6.2;
    this.mapYaw = 0;
    this.stats = { kills: 0, crashes: 0, distance: 0 };
  }

  get wantedLevel() { return clamp(this.wanted, 0, 5); }
  get nightFactor() {
    // 1 at midnight, 0 at midday
    const a = Math.cos(this.dayTime * Math.PI * 2);
    return clamp((a + 0.25) / 1.1, 0, 1);
  }

  // ---------------------------------------------------------------- setup
  async init(onProgress) {
    const step = async (pct, msg) => { onProgress(pct, msg); await new Promise(r => setTimeout(r, 12)); };

    await step(4, '렌더러 초기화…');
    const renderer = this.renderer = new THREE.WebGLRenderer({
      antialias: this.q.aa, powerPreference: 'high-performance', stencil: false
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * this.q.pixel);
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (this.q.shadow) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    document.body.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8fa9c4, 90, this.q.far);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 4000);
    this.camera.position.set(0, 12, 20);

    await step(12, '하늘과 조명 준비…');
    this.buildSky();
    this.buildLights();
    this.buildRain();

    await step(24, '도시 생성 중… (건물)');
    this.city = new City(this.scene, this.qname);
    this.city.build();

    await step(58, '차량 배치…');
    this.fx = new FX(this.scene, this.qname);
    this.audio = new Audio();
    this.hud = new HUD();
    this.input = new Input(renderer.domElement);
    this.input.onUnlock = () => { if (!this.paused && this.started) this.setPaused(true); };

    this.spawnPlayer();
    for (let i = 0; i < this.q.cars; i++) this.spawnTrafficCar();

    await step(78, '시민 배치…');
    for (let i = 0; i < this.q.peds; i++) this.spawnPed();

    await step(90, '포스트 프로세싱…');
    if (this.q.bloom) {
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight),
        this.qname === 'high' ? 0.62 : 0.45, 0.7, 0.85);
      this.bloom = bloom;
      this.composer.addPass(bloom);
    }

    this.missions = new Missions(this);
    this.updateEnv(true);

    addEventListener('resize', () => this.resize());
    await step(100, '준비 완료');
  }

  buildSky() {
    const uniforms = this.skyUniforms = {
      uSun: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uTop: { value: new THREE.Color(0x2f6fbf) },
      uBottom: { value: new THREE.Color(0xbcd4e8) },
      uSunColor: { value: new THREE.Color(0xfff0c8) },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uSun, uTop, uBottom, uSunColor;
        uniform float uNight;
        float hash(vec3 p){ p = fract(p*0.3183099+vec3(.71,.113,.419)); p*=17.0;
          return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
          vec3 col = mix(uBottom, uTop, pow(h, 0.72));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          col += uSunColor * pow(sd, 620.0) * 12.0;                 // disk
          col += uSunColor * pow(sd, 9.0) * 0.36;                   // glow
          col += uSunColor * pow(sd, 2.0) * 0.08 * (1.0-h);         // horizon wash
          if (uNight > 0.01) {                                      // stars
            vec3 g = floor(d * 240.0);
            float s = hash(g);
            float tw = step(0.9965, s) * (0.45 + 0.55*hash(g+3.7));
            col += vec3(0.85,0.9,1.0) * tw * uNight * smoothstep(0.02, 0.35, d.y);
          }
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 20), mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // A tiny scene holding a copy of the sky feeds the PMREM environment map,
    // so metal (cars, water, glass) actually reflects the current sky.
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), mat));
    this.envT = 0;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdce9ff, 0x4a4238, 0.75);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
    this.sun.position.set(80, 120, 60);
    if (this.q.shadow) {
      this.sun.castShadow = true;
      const s = this.sun.shadow;
      s.mapSize.set(this.q.shadow, this.q.shadow);
      s.camera.near = 1; s.camera.far = 420;
      const d = 95;
      s.camera.left = -d; s.camera.right = d; s.camera.top = d; s.camera.bottom = -d;
      s.bias = -0.0009; s.normalBias = 0.05;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambient = new THREE.AmbientLight(0x4a5468, 0.55);
    this.scene.add(this.ambient);

    // player headlights when driving at night
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 48, 0.62, 0.65, 1.3);
    this.headlight.position.set(0, 1, 0);
    this.scene.add(this.headlight, this.headlight.target);
  }

  buildRain() {
    // vertical streaks read as rain far better than round points
    const count = 1400;
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = randRange(Math.random, -34, 34), y = randRange(Math.random, -12, 34), z = randRange(Math.random, -34, 34);
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + .06; pos[i * 6 + 4] = y + .72; pos[i * 6 + 5] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({
      color: 0xbcd8f2, transparent: true, opacity: .4, depthWrite: false
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.weather = { rain: 0, next: randRange(Math.random, 60, 150) };
  }

  // -------------------------------------------------------------- spawning
  spawnPlayer() {
    const human = new Human({ rng: this.rng, shirt: 0x14202e, pants: 0x1c1f26, skin: 0xe8b98f, scale: 1.04 });
    this.scene.add(human.root);
    const start = { x: roadLine(3) + 10, z: roadLine(4) + 3 };
    this.player = {
      pos: new THREE.Vector3(start.x, 0, start.z),
      yaw: 0, vy: 0, onGround: true, speed: 0,
      health: 100, armor: 0, dead: false, deadT: 0,
      vehicle: null, human, lastSafe: new THREE.Vector3(start.x, 0, start.z),
    };
    this.setWeapon(1);
  }

  farRoadPoint(min = 70, max = 150) {
    const p = this.playerWorldPos();
    for (let i = 0; i < 50; i++) {
      const c = this.city.randomRoadPoint(this.rng);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d > min && d < max) return c;
    }
    return null;
  }

  spawnTrafficCar() {
    const p = this.farRoadPoint(30, 190) || this.farRoadPoint(20, 400);
    if (!p) return;
    const yaw = Math.atan2(p.dir[0], p.dir[1]);
    const v = new Vehicle(this, randomCarType(this.rng), p.x, p.z, yaw, 'traffic');
    v.vel.set(Math.sin(yaw) * 10, Math.cos(yaw) * 10);
    this.vehicles.push(v);
    return v;
  }

  spawnPed(anywhere = false) {
    const pts = this.city.sidewalkPoints;
    const pp = this.playerWorldPos();
    for (let i = 0; i < 40; i++) {
      const p = pick(this.rng, pts);
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (anywhere || (d > 35 && d < 120)) {
        const ped = new Ped(this, p.x + randRange(this.rng, -2, 2), p.z + randRange(this.rng, -2, 2), 'civ');
        this.peds.push(ped);
        return ped;
      }
    }
  }

  spawnCop(onFoot) {
    const pp = this.playerWorldPos();
    if (onFoot) {
      const pts = this.city.sidewalkPoints;
      for (let i = 0; i < 40; i++) {
        const p = pick(this.rng, pts);
        const d = Math.hypot(p.x - pp.x, p.z - pp.z);
        if (d > 28 && d < 70) { const c = new Ped(this, p.x, p.z, 'cop'); this.peds.push(c); return c; }
      }
      return;
    }
    const p = this.farRoadPoint(60, 150);
    if (!p) return;
    const yaw = Math.atan2(p.dir[0], p.dir[1]);
    const v = new Vehicle(this, 'police', p.x, p.z, yaw, 'police');
    const cop = new Human({ rng: this.rng, shirt: 0x1b2a4a, pants: 0x161d2c, cap: 0x14203a });
    v.mesh.add(cop.root);
    cop.root.position.set(-0.4, 0.16, 0.15);
    v.driverModel = cop;
    this.vehicles.push(v);
    return v;
  }

  // ------------------------------------------------------------ queries
  playerWorldPos() {
    const p = this.player;
    return p.vehicle ? { x: p.vehicle.pos.x, z: p.vehicle.pos.y } : { x: p.pos.x, z: p.pos.z };
  }

  hasLineOfSight(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.ceil(len / 1.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t, y = y0 + dy * t, z = z0 + dz * t;
      for (const s of this.city.near(x, z, 0.4)) {
        if (y < s.h && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return false;
      }
    }
    return true;
  }

  /** Marches a ray; returns {type, point, normal, obj} or null. */
  raycastWorld(origin, dir, range, ignorePlayer = true) {
    const step = 0.3;
    const p = origin.clone();
    const d = dir.clone().normalize();
    for (let t = 0; t < range; t += step) {
      p.copy(origin).addScaledVector(d, t);
      if (p.y < 0.02) {
        return { type: 'ground', point: p.clone(), normal: new THREE.Vector3(0, 1, 0) };
      }
      // peds
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const dx = p.x - ped.pos.x, dz = p.z - ped.pos.z;
        if (dx * dx + dz * dz < 0.2 && p.y > 0.1 && p.y < 1.85) {
          return { type: 'ped', point: p.clone(), normal: d.clone().negate(), obj: ped, head: p.y > 1.5 };
        }
      }
      // vehicles
      for (const v of this.vehicles) {
        const dx = p.x - v.pos.x, dz = p.z - v.pos.y;
        if (dx * dx + dz * dz > 12) continue;
        if (this.player.vehicle === v && ignorePlayer) continue;
        const c = Math.cos(-v.yaw), s = Math.sin(-v.yaw);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < v.T.w / 2 && Math.abs(lz) < v.T.l / 2 && p.y < v.T.h) {
          return { type: 'vehicle', point: p.clone(), normal: d.clone().negate(), obj: v };
        }
      }
      // buildings
      for (const s of this.city.near(p.x, p.z, 0.3)) {
        if (p.y < s.h && p.x > s.x0 && p.x < s.x1 && p.z > s.z0 && p.z < s.z1) {
          const nx = Math.abs(p.x - s.x0) < step * 2 ? -1 : Math.abs(p.x - s.x1) < step * 2 ? 1 : 0;
          const nz = nx === 0 ? (Math.abs(p.z - s.z0) < step * 2 ? -1 : 1) : 0;
          return { type: 'world', point: p.clone(), normal: new THREE.Vector3(nx, 0, nz) };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------- actions
  setObjective(x, z, color = 0xffc63f) {
    if (x == null) { this.objective = null; this.fx.setMarker(0, 0, false); return; }
    this.objective = { x, z };
    this.fx.setMarker(x, z, true, color);
  }

  setWeapon(i) {
    this.weaponIndex = clamp(i, 0, this.weapons.length - 1);
    const w = this.weapons[this.weaponIndex];
    this.player.human.attachWeapon(makeWeaponMesh(w.key));
  }

  addWanted(v) {
    const before = Math.ceil(this.wanted);
    this.wanted = clamp(this.wanted + v, 0, 5);
    this.coolT = 0; this.coolingDown = false;
    if (Math.ceil(this.wanted) > before && this.wanted >= 1) {
      this.hud.toast('수배 ' + Math.ceil(this.wanted) + '★', '경찰이 추격합니다');
    }
  }

  alertArea(x, z, r) {
    for (const p of this.peds) {
      if (p.kind === 'civ' && Math.hypot(p.pos.x - x, p.pos.z - z) < r) p.flee(x, z, 7);
    }
  }

  onPedKilled(ped) {
    this.stats.kills++;
    this.alertArea(ped.pos.x, ped.pos.z, 34);
    if (ped.kind === 'cop') this.addWanted(1.1);
    else if (!ped.isTarget) this.addWanted(0.9);
    else this.addWanted(0.35);
  }

  onCrash(v, impact) {
    this.stats.crashes++;
    this.hud.damageFlash(clamp(impact / 40, .1, .7));
    this.audio.impact(clamp(impact / 30, .2, 1));
    if (impact > 14) this.damagePlayer(clamp((impact - 14) * 1.1, 0, 30), v.pos.x, v.pos.y, true);
  }

  explosionDamage(x, z, radius, dmg, src) {
    for (const v of this.vehicles) {
      if (v === src || v.dead) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.y - z);
      if (d < radius) v.damage(dmg * (1 - d / radius));
    }
    for (const p of this.peds) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < radius) p.hit(dmg * (1 - d / radius), x, z);
      else if (d < radius * 2.5) p.flee(x, z, 8);
    }
    const pp = this.playerWorldPos();
    const d = Math.hypot(pp.x - x, pp.z - z);
    if (d < radius) this.damagePlayer(dmg * (1 - d / radius) * .8, x, z, true);
    this.shake = Math.max(this.shake || 0, clamp(1 - d / (radius * 2.5), 0, 1) * 1.2);
  }

  damagePlayer(amount, fx, fz, ignoreArmorFlash) {
    const p = this.player;
    if (p.dead) return;
    const a = Math.min(p.armor, amount * 0.6);
    p.armor -= a;
    p.health -= (amount - a);
    this.hud.damageFlash(clamp(amount / 30, .2, .9));
    this.audio.hurt();
    if (p.health <= 0) this.killPlayer();
  }

  killPlayer() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true; p.deadT = 0; p.health = 0;
    this.hud.toast('사망', '치료비 $300');
    this.audio.fail();
    if (p.vehicle) this.ejectPlayer(true);
  }

  respawnPlayer() {
    const p = this.player;
    p.dead = false;
    p.health = 100; p.armor = 0;
    this.money = Math.max(0, this.money - 300);
    this.wanted = 0;
    // nearest park makes a decent hospital stand-in
    let best = null, bd = 1e9;
    for (const k of this.city.parks) {
      const d = Math.hypot(k.cx - p.pos.x, k.cz - p.pos.z);
      if (d < bd) { bd = d; best = k; }
    }
    const t = best || { cx: 0, cz: 0 };
    p.pos.set(t.cx, 0, t.cz);
    p.vy = 0;
    p.human.setVisible(true);
    p.human.root.position.copy(p.pos);
    this.hud.whiteFlash();
    if (this.missions.state === 'active') this.missions.fail('사망');
  }

  enterVehicle(v) {
    const p = this.player;
    if (v.dead) return;
    p.vehicle = v;
    v.occupied = true;
    v.mode = 'player';
    v.driverModel && (v.driverModel.root.visible = false);
    v.mesh.add(p.human.root);
    const off = v.T.l * (v.type === 'van' ? 0.06 : 0.02);
    p.human.root.position.set(-0.38, 0.2, off);
    p.human.root.rotation.set(0, 0, 0);
    this.camDist = 9.2;
    this.audio.start();
    this.hud.toast(VEHICLE_NAMES[v.type] || '차량', '탑승');
    if (v.wasTraffic === undefined) v.wasTraffic = true;
  }

  ejectPlayer(forced = false) {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    v.occupied = false;
    v.mode = 'parked';
    v.throttle = 0; v.brake = 1; v.steer = 0;
    v.mesh.remove(p.human.root);
    this.scene.add(p.human.root);
    // step out to the left of the car
    const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const out = new THREE.Vector3(v.pos.x, 0, v.pos.y).addScaledVector(side, -(v.T.w / 2 + 0.9));
    const probe = { x: out.x, z: out.z };
    this.city.resolveCircle(probe, 0.5, 1.0);
    p.pos.set(probe.x, 0, probe.z);
    p.yaw = v.yaw;
    p.human.root.position.copy(p.pos);
    p.vehicle = null;
    this.camDist = 6.2;
    this.audio.engineOff();
    this.audio.skid(false);
    if (forced) this.damagePlayer(6, v.pos.x, v.pos.y);
  }

  nearestVehicle(maxD = 4.2) {
    const p = this.player.pos;
    let best = null, bd = maxD;
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.y - p.z) - v.T.l * 0.3;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ------------------------------------------------------------- shooting
  tryFire(dt) {
    this.fireCd -= dt;
    const w = this.weapons[this.weaponIndex];
    const want = w.auto ? this.input.fire : this.input.mouse.leftEdge || (this.input.touch.active && this.input.fire);
    if (!want || this.fireCd > 0 || this.player.dead) return;
    if (this.player.vehicle && w.key !== 'fist') { /* drive-by disabled */ return; }

    if (w.key === 'fist') {
      this.fireCd = w.rate;
      this.melee();
      return;
    }
    if (w.mag <= 0) {
      if (w.ammo > 0) this.reload();
      else { this.audio.blip(160, .08, 'square', .12, .8); this.fireCd = .4; }
      return;
    }
    this.fireCd = w.rate;
    w.mag--;

    const cam = this.camera;
    const origin = new THREE.Vector3(this.player.pos.x, 1.35, this.player.pos.z);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const spread = this.aiming ? w.spread * .4 : w.spread;
    dir.x += randRange(Math.random, -spread, spread);
    dir.y += randRange(Math.random, -spread, spread);
    dir.z += randRange(Math.random, -spread, spread);
    dir.normalize();
    // fire from the muzzle so tracers line up with the gun
    const muzzle = origin.clone().addScaledVector(dir, 0.75).add(new THREE.Vector3(0, -0.05, 0));

    this.audio.gunshot(w.key === 'smg' ? 'rifle' : 'pistol');
    this.fx.muzzle(muzzle.x, muzzle.y, muzzle.z);
    this.recoil = (this.recoil || 0) + (w.key === 'smg' ? 0.009 : 0.022);

    const hit = this.raycastWorld(origin, dir, w.range);
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, w.range);
    this.fx.tracer(muzzle, end);

    if (!hit) return;
    if (hit.type === 'ped') {
      const dmg = w.dmg * (hit.head ? 2.4 : 1);
      hit.obj.hit(dmg, this.player.pos.x, this.player.pos.z);
      this.hud.hitMark();
    } else if (hit.type === 'vehicle') {
      hit.obj.damage(w.dmg * .5);
      this.fx.sparks(hit.point.x, hit.point.y, hit.point.z, hit.normal);
      this.hud.hitMark();
    } else {
      this.fx.sparks(hit.point.x, hit.point.y, hit.point.z, hit.normal);
    }
    this.alertArea(this.player.pos.x, this.player.pos.z, 22);
    if (this.copsNearby(28)) this.addWanted(0.28);
  }

  melee() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const hx = p.pos.x + fx * 1.1, hz = p.pos.z + fz * 1.1;
    let hitAny = false;
    for (const ped of this.peds) {
      if (ped.dead) continue;
      if (Math.hypot(ped.pos.x - hx, ped.pos.z - hz) < 1.1) {
        ped.hit(this.weapons[0].dmg, p.pos.x, p.pos.z);
        this.hud.hitMark(); hitAny = true;
      }
    }
    for (const v of this.vehicles) {
      if (v.dead) continue;
      if (Math.hypot(v.pos.x - hx, v.pos.y - hz) < v.T.l * .55) { v.damage(6); hitAny = true; }
    }
    this.audio.blip(hitAny ? 200 : 520, .09, hitAny ? 'square' : 'sine', hitAny ? .25 : .08, .6);
    if (hitAny) this.alertArea(p.pos.x, p.pos.z, 18);
  }

  reload() {
    const w = this.weapons[this.weaponIndex];
    if (w.magSize === 0 || w.mag === w.magSize || w.ammo <= 0) return;
    const need = w.magSize - w.mag;
    const take = Math.min(need, w.ammo);
    w.mag += take; w.ammo -= take;
    this.audio.blip(300, .1, 'square', .12, 1.6);
    this.fireCd = Math.max(this.fireCd, 1.1);
  }

  copsNearby(r) {
    const p = this.playerWorldPos();
    for (const v of this.vehicles) if (v.mode === 'police' && !v.dead && Math.hypot(v.pos.x - p.x, v.pos.y - p.z) < r) return true;
    for (const c of this.peds) if (c.kind === 'cop' && !c.dead && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < r) return true;
    return false;
  }

  // ------------------------------------------------------------ main loop
  start() {
    this.started = true;
    this.hud.show(true);
    this.audio.start();
    this.clock.start();
    this.loop();
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hide', !p);
    if (p) {
      this.audio.engineOff(); this.audio.siren(0); this.audio.skid(false);
      const m = this.missions;
      document.getElementById('pstats').innerHTML =
        `소지금 ${fmtMoney(this.money)} · 완료한 일 ${m.completed}건<br>` +
        `제압 ${this.stats.kills} · 사고 ${this.stats.crashes} · 수배 ${Math.ceil(this.wantedLevel)}★`;
    } else {
      this.input.requestLock();
      this.clock.getDelta();
    }
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.paused) { this.render(); return; }
    this.time += dt;
    this.update(dt);
    this.render();
    this.input.endFrame();
  }

  update(dt) {
    const inp = this.input, p = this.player;

    if (inp.hit('Escape')) { this.setPaused(true); return; }
    if (inp.hit('Digit1')) this.setWeapon(0);
    if (inp.hit('Digit2')) this.setWeapon(1);
    if (inp.hit('Digit3')) this.setWeapon(2);
    if (inp.hit('KeyR')) this.reload();

    // ---- camera look
    const sens = 0.0022;
    this.camYaw -= inp.mouse.dx * sens;
    this.camPitch = clamp(this.camPitch + inp.mouse.dy * sens, -0.85, 1.15);
    if (this.recoil) { this.camPitch -= this.recoil; this.recoil *= 0.6; if (this.recoil < 0.001) this.recoil = 0; }
    this.mapYaw = this.camYaw;
    this.aiming = inp.aim && !p.vehicle && !p.dead;

    // ---- day / night
    this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
    this.updateSky(dt);
    this.updateWeather(dt);

    if (p.dead) {
      p.deadT += dt;
      p.human.update(dt, { speed: 0, dead: true });
      if (p.deadT > 2.6) this.respawnPlayer();
    } else if (p.vehicle) {
      this.updateDriving(dt);
    } else {
      this.updateOnFoot(dt);
    }

    this.tryFire(dt);
    this.updateWanted(dt);

    for (const v of this.vehicles) v.update(dt, this.city);
    for (const ped of this.peds) ped.update(dt, this.time);
    this.streamEntities(dt);
    this.missions.update(dt);

    this.fx.update(dt, this.time);
    this.updateCamera(dt);
    this.updateAudio(dt);
    this.hud.update(this, dt);
  }

  updateOnFoot(dt) {
    const p = this.player, inp = this.input;
    const ax = inp.axis();
    const sprint = inp.sprint && !this.aiming;
    const maxSpeed = this.aiming ? 2.0 : sprint ? 6.1 : 3.1;

    // camera-relative movement
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
    let dx = ax.x * cy + ax.y * sy;
    let dz = -ax.x * sy + ax.y * cy;
    const mag = Math.hypot(dx, dz);
    const target = mag > 0.05 ? maxSpeed : 0;
    p.speed = damp(p.speed, target, 9, dt);
    if (mag > 0.05) {
      dx /= mag; dz /= mag;
      p.moveDir = { x: dx, z: dz };
      const want = Math.atan2(dx, dz);
      p.yaw = this.aiming ? dampAngle(p.yaw, this.camYaw, 16, dt) : dampAngle(p.yaw, want, 11, dt);
    } else if (this.aiming) {
      p.yaw = dampAngle(p.yaw, this.camYaw, 16, dt);
    }

    if (p.speed > 0.05 && p.moveDir) {
      p.pos.x += p.moveDir.x * p.speed * dt;
      p.pos.z += p.moveDir.z * p.speed * dt;
    }

    // jump / gravity
    if (inp.hit('Space') && p.onGround) { p.vy = 4.6; p.onGround = false; this.audio.blip(420, .12, 'sine', .1, 1.4); }
    p.vy -= 16 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.onGround = true; }

    const probe = { x: p.pos.x, z: p.pos.z };
    this.city.resolveCircle(probe, 0.45, 1.0);
    p.pos.x = probe.x; p.pos.z = probe.z;

    // being run over
    for (const v of this.vehicles) {
      if (v.dead || v.speed < 4) continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.y - p.pos.z);
      if (d < v.T.l * 0.45) {
        this.damagePlayer(v.speed * 2.4, v.pos.x, v.pos.y);
        const k = Math.atan2(p.pos.x - v.pos.x, p.pos.z - v.pos.y);
        p.pos.x += Math.sin(k) * 1.6; p.pos.z += Math.cos(k) * 1.6;
        p.vy = 3;
        break;
      }
    }

    p.human.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    p.human.root.rotation.y = p.yaw;
    p.human.update(dt, { speed: p.speed, aiming: this.aiming, pitch: this.camPitch });
    if (p.human.stepped && p.onGround) this.audio.step();

    // enter a vehicle
    const near = this.nearestVehicle();
    if (near && !this.aiming) {
      this.hud.prompt('<kbd>F</kbd> ' + (VEHICLE_NAMES[near.type] || '차량') + ' 탑승');
      if (this.input.interact) {
        if (near.mode === 'traffic' || near.mode === 'police') {
          if (near.driver) near.driver = null;
          this.addWanted(near.mode === 'police' ? 1.2 : 0.45);
          this.hud.toast('차량 탈취', '');
          this.alertArea(near.pos.x, near.pos.y, 26);
        }
        this.enterVehicle(near);
      }
    } else this.hud.prompt('');
  }

  updateDriving(dt) {
    const p = this.player, v = p.vehicle, inp = this.input;
    const ax = inp.axis();
    v.steer = damp(v.steer, ax.x, 10, dt);
    const fwd = v.forwardSpeed;
    if (ax.y > 0.05) { v.throttle = ax.y; v.brake = 0; }
    else if (ax.y < -0.05) {
      if (fwd > 1.2) { v.brake = 1; v.throttle = 0; }
      else { v.throttle = ax.y; v.brake = 0; }
    } else { v.throttle = 0; v.brake = inp.touch.active && inp.touch.brake ? 1 : 0.06; }
    v.handbrake = inp.down('Space');
    if (v.handbrake) v.brake = Math.max(v.brake, .5);

    if (inp.hit('KeyE')) this.audio.horn(true);

    this.stats.distance += Math.abs(fwd) * dt;

    // tyre smoke while drifting
    if ((v.drift > .35 || (v.handbrake && Math.abs(fwd) > 6)) && Math.random() < dt * 25) {
      const bx = v.pos.x - Math.sin(v.yaw) * v.T.l * .3, bz = v.pos.y - Math.cos(v.yaw) * v.T.l * .3;
      this.fx.tyreSmoke(bx, bz);
    }

    p.human.update(dt, { speed: 0, sitting: true, steer: v.steer });

    // run over pedestrians
    if (Math.abs(fwd) > 4) {
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const dx = ped.pos.x - v.pos.x, dz = ped.pos.z - v.pos.y;
        if (Math.hypot(dx, dz) < v.T.l * 0.45) {
          ped.hit(Math.abs(fwd) * 6, v.pos.x, v.pos.y);
          this.audio.impact(.6);
          this.hud.damageFlash(.25);
        }
      }
    }

    this.hud.prompt('<kbd>F</kbd> 하차');
    if (inp.interact) this.ejectPlayer();
  }

  updateWanted(dt) {
    if (this.wanted <= 0) { this.coolingDown = false; return; }
    const seen = this.copsNearby(52);
    if (seen) { this.coolT = 0; this.coolingDown = false; }
    else {
      this.coolT += dt;
      this.coolingDown = this.coolT > 4;
      if (this.coolingDown) {
        this.wanted = Math.max(0, this.wanted - dt * 0.085);
        if (this.wanted <= 0) this.hud.toast('추적 해제', '');
      }
    }

    // keep the right number of units on the street
    const wantCars = Math.floor(this.wantedLevel * 1.4);
    let cars = 0, foot = 0;
    for (const v of this.vehicles) if (v.mode === 'police' && !v.dead) cars++;
    for (const c of this.peds) if (c.kind === 'cop' && !c.dead) foot++;
    this.copSpawnT = (this.copSpawnT || 0) - dt;
    if (this.copSpawnT <= 0) {
      this.copSpawnT = 2.2;
      if (cars < wantCars) this.spawnCop(false);
      if (this.wanted >= 2 && foot < Math.floor(this.wantedLevel)) this.spawnCop(true);
    }
  }

  streamEntities(dt) {
    const p = this.playerWorldPos();
    // cull far away traffic and pedestrians, then top up
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const d = Math.hypot(v.pos.x - p.x, v.pos.y - p.z);
      const stale = v.dead && v.wreckT > 22;
      if (v === this.player.vehicle) continue;
      if (stale || (d > 230 && v.mode !== 'player' && v !== this.missions.car)) {
        v.dispose(); this.vehicles.splice(i, 1);
      }
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const c = this.peds[i];
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if ((c.dead && c.deadT > 18) || d > 170) {
        if (c === this.missions.target && !c.dead) continue;
        c.dispose(); this.peds.splice(i, 1);
      }
    }
    let traffic = 0;
    for (const v of this.vehicles) if (v.mode === 'traffic') traffic++;
    this.spawnT = (this.spawnT || 0) - dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      if (traffic < this.q.cars) this.spawnTrafficCar();
      if (this.peds.length < this.q.peds) this.spawnPed();
    }
  }

  updateSky(dt) {
    const t = this.dayTime;
    const ang = (t - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.6, Math.sin(ang), Math.cos(ang) * 0.5).normalize();
    const night = this.nightFactor;
    const dayAmt = 1 - night;
    const horizon = clamp(1 - Math.abs(sunDir.y) * 3.2, 0, 1);   // sunrise/sunset warmth

    this.sun.position.copy(sunDir).multiplyScalar(260);
    this.sun.intensity = clamp(sunDir.y * 3.6, 0, 3.1) * (1 - this.weather.rain * .65);
    this.sun.color.setRGB(1, lerp(0.95, 0.62, horizon), lerp(0.88, 0.35, horizon));
    this.hemi.intensity = lerp(0.07, 1.05, dayAmt) * (1 - this.weather.rain * .3);
    this.ambient.intensity = lerp(0.13, 0.6, dayAmt);
    this.hemi.color.setRGB(lerp(0.30, 0.86, dayAmt), lerp(0.34, 0.88, dayAmt), lerp(0.52, 0.95, dayAmt));

    const top = new THREE.Color().setHSL(0.6, 0.7, lerp(0.03, 0.42, dayAmt));
    const bot = new THREE.Color().setHSL(lerp(0.62, 0.08, horizon * dayAmt), lerp(0.4, 0.8, horizon), lerp(0.05, 0.72, dayAmt));
    if (this.weather.rain > 0.02) {
      const g = new THREE.Color(0x4a5460);
      top.lerp(g, this.weather.rain * .8); bot.lerp(g, this.weather.rain * .8);
    }
    this.skyUniforms.uSun.value.copy(sunDir);
    this.skyUniforms.uTop.value.copy(top);
    this.skyUniforms.uBottom.value.copy(bot);
    this.skyUniforms.uNight.value = night;
    this.skyUniforms.uSunColor.value.setRGB(1, lerp(0.93, 0.6, horizon), lerp(0.8, 0.3, horizon));

    this.scene.fog.color.copy(bot).lerp(new THREE.Color(0x0a1220), night * .85);
    this.scene.fog.near = lerp(70, 40, this.weather.rain);
    this.scene.fog.far = this.q.far * lerp(1, 0.45, Math.max(night * .5, this.weather.rain));
    this.renderer.toneMappingExposure = lerp(1.08, 0.95, night);

    this.city.setNight(night);
    this.envT -= dt;
    if (this.envT <= 0) this.updateEnv(true);
    if (this.bloom) this.bloom.strength = lerp(this.qname === 'high' ? .5 : .38, this.qname === 'high' ? .95 : .72, night);

    // shadow camera follows the player
    if (this.q.shadow) {
      const p = this.playerWorldPos();
      this.sun.target.position.set(p.x, 0, p.z);
      this.sun.position.set(p.x + sunDir.x * 160, sunDir.y * 160 + 10, p.z + sunDir.z * 160);
      this.sun.target.updateMatrixWorld();
    }

    // player headlights
    const drive = this.player.vehicle;
    if (drive && !drive.dead) {
      const v = drive;
      this.headlight.intensity = (night > .3 || this.weather.rain > .3) ? 110 : 0;
      this.headlight.position.set(v.pos.x + Math.sin(v.yaw) * v.T.l * .5, 0.85, v.pos.y + Math.cos(v.yaw) * v.T.l * .5);
      this.headlight.target.position.set(v.pos.x + Math.sin(v.yaw) * 30, 0.2, v.pos.y + Math.cos(v.yaw) * 30);
      this.headlight.target.updateMatrixWorld();
    } else this.headlight.intensity = 0;
  }

  /** Refresh the sky reflection probe; cheap enough a few times a minute. */
  updateEnv(force = false) {
    if (!this.pmrem) return;
    if (!force && this.envT > 0) return;
    this.envT = this.qname === 'low' ? 14 : 7;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 200);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  updateWeather(dt) {
    const w = this.weather;
    w.next -= dt;
    if (w.next <= 0) {
      w.raining = !w.raining;
      w.next = w.raining ? randRange(Math.random, 45, 90) : randRange(Math.random, 120, 260);
      if (w.raining) this.hud.toast('비', '노면이 미끄럽습니다');
    }
    w.rain = damp(w.rain, w.raining ? 1 : 0, 0.5, dt);
    this.city.setWet(w.rain);
    this.rain.visible = w.rain > 0.03;
    if (this.rain.visible) {
      const c = this.camera.position;
      this.rain.material.opacity = w.rain * .5;
      const pos = this.rain.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 6) {
        const fall = (26 + (i % 11)) * dt;
        arr[i + 1] -= fall; arr[i + 4] -= fall;
        if (arr[i + 1] < c.y - 16) {
          const x = c.x + randRange(Math.random, -34, 34), z = c.z + randRange(Math.random, -34, 34);
          const y = c.y + randRange(Math.random, 14, 34);
          arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
          arr[i + 3] = x + .06; arr[i + 4] = y + .72; arr[i + 5] = z;
        }
      }
      pos.needsUpdate = true;
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const cam = this.camera;
    let tx, ty, tz, dist = this.camDist;

    if (p.vehicle) {
      const v = p.vehicle;
      tx = v.pos.x; ty = 1.5; tz = v.pos.y;
      dist = 9.2 + Math.min(4, Math.abs(v.forwardSpeed) * 0.13);
      cam.fov = lerp(cam.fov, 62 + Math.min(16, Math.abs(v.forwardSpeed) * 0.5), 1 - Math.exp(-3 * dt));
    } else {
      tx = p.pos.x; ty = p.pos.y + 1.5; tz = p.pos.z;
      dist = this.aiming ? 2.7 : 6.2;
      cam.fov = lerp(cam.fov, this.aiming ? 48 : 62, 1 - Math.exp(-9 * dt));
    }
    cam.updateProjectionMatrix();

    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * cp, -sp, Math.cos(this.camYaw) * cp
    );
    const target = new THREE.Vector3(tx, ty, tz);
    if (this.aiming) {          // over-the-shoulder offset
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      target.addScaledVector(right, 0.62).y += 0.12;
    }

    let want = target.clone().addScaledVector(dir, -dist).add(new THREE.Vector3(0, 0.6, 0));

    // don't let the camera go through buildings or the ground
    const hit = this.raycastWorld(target, want.clone().sub(target).normalize(), dist + 0.6, true);
    if (hit && (hit.type === 'world' || hit.type === 'ground')) {
      const d = target.distanceTo(hit.point) - 0.5;
      want = target.clone().addScaledVector(dir, -Math.max(0.9, d));
    }
    want.y = Math.max(want.y, 0.65);
    // last resort: if the camera still sits inside a building, pull it to the target
    for (const s of this.city.near(want.x, want.z, 0.3)) {
      if (want.y < s.h && want.x > s.x0 && want.x < s.x1 && want.z > s.z0 && want.z < s.z1) {
        want.lerp(target, 0.75); break;
      }
    }

    const lambda = p.vehicle ? 9 : 14;
    cam.position.lerp(want, 1 - Math.exp(-lambda * dt));

    // screen shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * 0.28;
      cam.position.x += randRange(Math.random, -s, s);
      cam.position.y += randRange(Math.random, -s, s);
      cam.position.z += randRange(Math.random, -s, s);
    }
    cam.lookAt(target.x, target.y + (this.aiming ? 0 : 0.25), target.z);
    this.sky.position.copy(cam.position);
  }

  updateAudio(dt) {
    const p = this.player;
    if (p.vehicle && !p.vehicle.dead) {
      const v = p.vehicle;
      const rpm = clamp(Math.abs(v.forwardSpeed) / v.T.max, 0, 1);
      this.audio.engine(rpm, clamp(v.throttle, 0.15, 1));
      this.audio.skid(v.drift > .45 || (v.handbrake && Math.abs(v.forwardSpeed) > 6));
    } else {
      this.audio.engineOff();
      this.audio.skid(false);
    }
    // siren volume by nearest cop
    let nearest = 1e9;
    const pp = this.playerWorldPos();
    for (const v of this.vehicles) {
      if (v.mode !== 'police' || v.dead) continue;
      nearest = Math.min(nearest, Math.hypot(v.pos.x - pp.x, v.pos.y - pp.z));
    }
    this.audio.siren(nearest < 90 ? clamp(1 - nearest / 90, 0, 1) : 0);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }
}

// ------------------------------------------------------------------ boot
const $ = id => document.getElementById(id);
let quality = 'med';

$('qseg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  quality = b.dataset.q;
  [...$('qseg').children].forEach(c => c.classList.toggle('sel', c === b));
});

let game = null;
async function boot() {
  const bar = $('loadbar').firstElementChild, msg = $('loadmsg');
  game = new Game(quality);
  window.__game = game;
  try {
    await game.init((pct, m) => { bar.style.width = pct + '%'; msg.textContent = m; });
    msg.textContent = '준비 완료 — 시작을 누르세요';
    $('play').disabled = false;
  } catch (err) {
    msg.textContent = '초기화 실패: ' + err.message;
    console.error(err);
  }
}

$('play').addEventListener('click', () => launch(true));
$('freeroam').addEventListener('click', () => launch(false));

function launch(withMissions) {
  if (!game || $('play').disabled) return;
  $('start').classList.add('hide');
  if (!withMissions) { game.missions.state = 'wait'; game.missions.cooldown = 1e9; game.setObjective(null); game.hud.mission('', ''); }
  game.start();
  game.input.requestLock();
  game.hud.toast('NEON MILE', withMissions ? '파란 마커에서 일감을 받으세요' : '자유 주행');
}

$('resume').addEventListener('click', () => game.setPaused(false));
$('restart').addEventListener('click', () => location.reload());

// quality buttons rebuild the game before it has started
$('qseg').addEventListener('click', () => {
  if (game && game.started) return;
  if (game) { game.renderer.domElement.remove(); game.renderer.dispose(); }
  $('play').disabled = true;
  boot();
});

boot();
