// Job board: pick up a gold marker, run a contract, get paid.
import { randRange, randInt, pick, fmtTime } from './util.js';
import { HALF } from './city.js';
import { Vehicle } from './vehicle.js';
import { Ped } from './npc.js';

const TYPES = ['delivery', 'taxi', 'steal', 'hit'];

export class Missions {
  constructor(game) {
    this.g = game;
    this.state = 'idle';
    this.job = null;
    this.timer = 0;
    this.leg = 0;
    this.cooldown = 2;
    this.completed = 0;
    this.newJobSpot();
  }

  spotFar(min = 90) {
    const g = this.g, p = g.playerWorldPos();
    for (let i = 0; i < 60; i++) {
      const c = g.city.randomRoadPoint(g.rng);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d > min && d < min + 260) return { x: c.x, z: c.z };
    }
    const c = g.city.randomRoadPoint(g.rng);
    return { x: c.x, z: c.z };
  }

  newJobSpot() {
    this.state = 'idle';
    this.job = null;
    this.spot = this.spotFar(60);
    this.g.setObjective(this.spot.x, this.spot.z, 0x38e0ff);
    this.g.hud.mission('다음 일감', '파란 마커로 이동해 계약을 받으세요');
  }

  begin() {
    const g = this.g;
    const type = pick(g.rng, TYPES);
    this.state = 'active';
    this.leg = 0;
    this.target = null;
    this.car = null;

    if (type === 'delivery') {
      const dst = this.spotFar(160);
      const d = Math.hypot(dst.x - g.player.pos.x, dst.z - g.player.pos.z);
      this.job = { type, title: '급송 배달', text: '소포를 목적지까지 배달하세요', dst, pay: Math.round(240 + d * 1.6) };
      this.timer = 28 + d / 11;
    } else if (type === 'taxi') {
      const a = this.spotFar(70), b = this.spotFar(170);
      this.job = { type, title: '승객 운송', text: '차를 타고 승객을 태우러 가세요', dst: a, dst2: b, pay: 420 };
      this.timer = 60 + Math.hypot(b.x - a.x, b.z - a.z) / 10;
    } else if (type === 'steal') {
      const a = this.spotFar(90), b = this.spotFar(150);
      this.car = new Vehicle(g, pick(g.rng, ['sport', 'suv', 'sport']), a.x, a.z,
        g.rng() * Math.PI * 2, 'parked', 0xe8e9ee);
      g.vehicles.push(this.car);
      this.job = { type, title: '차량 탈취', text: '표시된 차량을 훔쳐 인계 장소로', dst: a, dst2: b, pay: 900 };
      this.timer = 110;
    } else {
      const a = this.spotFar(110);
      const ped = new Ped(g, a.x + 2, a.z + 2, 'civ');
      ped.isTarget = true;
      ped.human.materials[1].color.setHex(0x7a1220);
      g.peds.push(ped);
      this.target = ped;
      this.job = { type, title: '계약 타격', text: '표적을 제거하세요 (수배 발생)', dst: a, pay: 1100 };
      this.timer = 100;
      g.addWanted(1.2);
    }

    g.hud.toast(this.job.title, this.job.pay ? '보상 $' + this.job.pay : '');
    g.audio.pickup();
    this.updateObjective();
  }

  updateObjective() {
    const j = this.job; if (!j) return;
    const g = this.g;
    let p = j.dst;
    if (j.type === 'taxi' && this.leg === 1) p = j.dst2;
    if (j.type === 'steal' && this.leg === 1) p = j.dst2;
    if (j.type === 'hit' && this.target && !this.target.dead) p = { x: this.target.pos.x, z: this.target.pos.z };
    g.setObjective(p.x, p.z, j.type === 'hit' ? 0xff2e6a : 0xffc63f);
  }

  fail(reason) {
    const g = this.g;
    g.hud.toast('실패', reason || '');
    g.audio.fail();
    this.cleanup();
    this.cooldown = 4;
    this.state = 'wait';
    g.setObjective(null);
    g.hud.mission('', '');
  }

  succeed() {
    const g = this.g;
    g.money += this.job.pay;
    this.completed++;
    g.hud.toast('미션 완료', '+$' + this.job.pay);
    g.audio.pickup();
    this.cleanup();
    this.cooldown = 3;
    this.state = 'wait';
    g.setObjective(null);
    g.hud.mission('', '');
  }

  cleanup() {
    if (this.target && !this.target.dead) this.target.isTarget = false;
    this.target = null;
    if (this.car && this.car !== this.g.player.vehicle) this.car.mode = 'parked';
    this.car = null;
    this.job = null;
  }

  update(dt) {
    const g = this.g;
    if (this.state === 'wait') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.newJobSpot();
      return;
    }
    const p = g.playerWorldPos();

    if (this.state === 'idle') {
      if (Math.hypot(p.x - this.spot.x, p.z - this.spot.z) < 6) this.begin();
      return;
    }

    const j = this.job; if (!j) return;
    this.timer -= dt;
    if (this.timer <= 0) return this.fail('시간 초과');

    this.updateObjective();
    const obj = g.objective;
    const d = Math.hypot(p.x - obj.x, p.z - obj.z);
    const inCar = !!g.player.vehicle;

    if (j.type === 'delivery') {
      g.hud.mission(j.title, j.text, this.timer);
      if (d < 6) this.succeed();
    } else if (j.type === 'taxi') {
      g.hud.mission(j.title, this.leg === 0 ? '승객 픽업 지점으로 (차량 필요)' : '목적지에 승객을 내려주세요', this.timer);
      if (d < 7 && inCar && g.player.vehicle.speed < 3) {
        if (this.leg === 0) { this.leg = 1; g.hud.toast('승객 탑승', '목적지로!'); this.updateObjective(); }
        else this.succeed();
      }
    } else if (j.type === 'steal') {
      if (this.leg === 0) {
        g.hud.mission(j.title, '표시된 차량에 탑승하세요', this.timer);
        if (this.car && g.player.vehicle === this.car) {
          this.leg = 1; g.addWanted(1.5);
          g.hud.toast('추적 시작', '인계 장소로 도주');
          this.updateObjective();
        }
        if (this.car && this.car.dead) this.fail('차량 파손');
      } else {
        g.hud.mission(j.title, '인계 장소로 차량을 가져가세요', this.timer);
        if (this.car && this.car.dead) return this.fail('차량 파손');
        if (d < 8 && g.player.vehicle === this.car) this.succeed();
        else if (d < 8 && !inCar) g.hud.prompt('훔친 차를 가져와야 합니다');
      }
    } else if (j.type === 'hit') {
      g.hud.mission(j.title, this.target && this.target.dead ? '도주하세요' : '표적을 제거하세요', this.timer);
      if (this.target && this.target.dead) this.succeed();
    }
  }
}
