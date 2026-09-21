// DOM HUD + rotating minimap drawn with canvas2d.
import { money as fmtMoney, fmtTime, clamp } from './util.js';
import { S, N, HALF, ROAD, roadLine } from './city.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hp').firstElementChild, ar: $('ar').firstElementChild,
      hpv: $('hpv'), arv: $('arv'), money: $('money'), stars: [...document.querySelectorAll('.star')],
      wname: $('wname'), wammo: $('wammo'), speedo: $('speedo'), kmh: $('kmh'), gear: $('gear'),
      mission: $('mission'), mtitle: $('mtitle'), mtext: $('mtext'), mtimer: $('mtimer'),
      toast: $('toast'), prompt: $('prompt'), cross: $('crosshair'), hit: $('hitmark'),
      dmg: $('damage'), flash: $('flashwhite'),
    };
    this.cv = $('mmcv'); this.ctx = this.cv.getContext('2d');
    this.shownMoney = 0;
    this.lastPrompt = '';
  }

  show(on) { this.el.hud.classList.toggle('on', on); }

  toast(text, sub = '') {
    const t = this.el.toast;
    t.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }

  prompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.el.prompt.innerHTML = text || '';
    this.el.prompt.classList.toggle('on', !!text);
  }

  hitMark() {
    const h = this.el.hit;
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
  }

  damageFlash(a = .8) {
    this.el.dmg.style.opacity = a;
    clearTimeout(this._dt);
    this._dt = setTimeout(() => this.el.dmg.style.opacity = 0, 130);
  }

  whiteFlash() {
    const f = this.el.flash;
    f.style.transition = 'none'; f.style.opacity = .9;
    requestAnimationFrame(() => { f.style.transition = 'opacity .8s'; f.style.opacity = 0; });
  }

  mission(title, text, timer) {
    const on = !!text;
    this.el.mission.classList.toggle('on', on);
    if (!on) return;
    this.el.mtitle.textContent = title;
    this.el.mtext.textContent = text;
    this.el.mtimer.textContent = timer != null ? '남은 시간 ' + fmtTime(timer) : '';
  }

  update(g, dt) {
    const p = g.player;
    this.el.hp.style.width = clamp(p.health, 0, 100) + '%';
    this.el.ar.style.width = clamp(p.armor, 0, 100) + '%';
    this.el.hpv.textContent = Math.max(0, Math.round(p.health));
    this.el.arv.textContent = Math.max(0, Math.round(p.armor));

    this.shownMoney += (g.money - this.shownMoney) * clamp(dt * 6, 0, 1);
    if (Math.abs(g.money - this.shownMoney) < 1) this.shownMoney = g.money;
    this.el.money.textContent = fmtMoney(this.shownMoney);

    const wl = g.wantedLevel;
    this.el.stars.forEach((s, i) => {
      s.classList.toggle('on', i < Math.ceil(wl));
      s.classList.toggle('blink', g.wanted > 0 && i === Math.ceil(wl) - 1 && g.coolingDown);
    });

    const w = g.weapons[g.weaponIndex];
    this.el.wname.textContent = w.name;
    this.el.wammo.innerHTML = w.ammo === Infinity ? '∞'
      : `${w.mag}<small> / ${w.ammo}</small>`;

    const inCar = !!g.player.vehicle;
    this.el.speedo.classList.toggle('on', inCar);
    if (inCar) {
      const v = g.player.vehicle;
      const kmh = Math.round(Math.abs(v.forwardSpeed) * 3.6);
      this.el.kmh.innerHTML = kmh + '<span>km/h</span>';
      this.el.gear.textContent = v.forwardSpeed < -0.6 ? 'R'
        : kmh < 1 ? 'N' : 'D' + clamp(Math.ceil(kmh / 34), 1, 5);
    }
    this.el.cross.classList.toggle('on', g.aiming && !inCar);

    this.drawMap(g);
  }

  drawMap(g) {
    const c = this.ctx, W = this.cv.width, H = this.cv.height;
    const view = 185;                       // world units across the minimap
    const sc = W / view;
    const p = g.playerWorldPos();
    const yaw = g.mapYaw;

    c.save();
    c.clearRect(0, 0, W, H);
    // rounded clip
    c.beginPath(); c.roundRect(0, 0, W, H, 26); c.clip();

    c.fillStyle = '#0a1420'; c.fillRect(0, 0, W, H);

    c.translate(W / 2, H / 2);
    c.rotate(-yaw);
    c.translate(-p.x * sc, -p.z * sc);

    // land
    c.fillStyle = '#131c27';
    c.fillRect((-HALF - 14) * sc, (-HALF - 14) * sc, (HALF * 2 + 28) * sc, (HALF * 2 + 28) * sc);
    // city blocks
    c.fillStyle = '#2b3646';
    for (const b of g.city.blocks) {
      if (Math.abs(b.x0 - p.x) > view || Math.abs(b.z0 - p.z) > view) continue;
      c.fillRect(b.x0 * sc, b.z0 * sc, (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }

    // parks
    c.fillStyle = '#20402a';
    for (const b of g.city.blocks) {
      if (b.kind !== 'park') continue;
      c.fillRect(b.x0 * sc, b.z0 * sc, (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }

    // roads
    c.strokeStyle = '#4a5a70'; c.lineWidth = ROAD * sc;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const l = roadLine(i);
      c.moveTo(l * sc, -HALF * sc); c.lineTo(l * sc, HALF * sc);
      c.moveTo(-HALF * sc, l * sc); c.lineTo(HALF * sc, l * sc);
    }
    c.stroke();

    // traffic + cops
    for (const v of g.vehicles) {
      if (v.dead) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.y - p.z);
      if (d > view * .8) continue;
      c.fillStyle = v.mode === 'police' ? '#2f7bff' : v === g.player.vehicle ? '#38e0ff' : '#7d8899';
      c.beginPath(); c.arc(v.pos.x * sc, v.pos.y * sc, v.mode === 'police' ? 5 : 3.5, 0, 7); c.fill();
    }
    for (const ped of g.peds) {
      if (ped.dead || ped.kind !== 'cop') continue;
      const d = Math.hypot(ped.pos.x - p.x, ped.pos.z - p.z);
      if (d > view * .8) continue;
      c.fillStyle = '#2f7bff';
      c.beginPath(); c.arc(ped.pos.x * sc, ped.pos.z * sc, 3, 0, 7); c.fill();
    }

    // objective
    if (g.objective) {
      const o = g.objective;
      c.fillStyle = '#ffc63f';
      c.beginPath(); c.arc(o.x * sc, o.z * sc, 7, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,198,63,.5)'; c.lineWidth = 3;
      c.beginPath(); c.arc(o.x * sc, o.z * sc, 12, 0, 7); c.stroke();
    }
    c.restore();

    // player arrow (always centred, pointing up)
    c.save();
    c.translate(W / 2, H / 2);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath();
    c.fill();
    c.restore();

    // off-screen objective arrow
    if (g.objective) {
      const dx = g.objective.x - p.x, dz = g.objective.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > view / 2) {
        const a = Math.atan2(dx, dz) - yaw;
        const r = W / 2 - 16;
        const x = W / 2 + Math.sin(a) * r, y = H / 2 - Math.cos(a) * r;
        c.save(); c.translate(x, y); c.rotate(a);
        c.fillStyle = '#ffc63f';
        c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(-7, 8); c.closePath(); c.fill();
        c.restore();
        c.fillStyle = '#ffc63f'; c.font = 'bold 22px system-ui'; c.textAlign = 'center';
        c.fillText(Math.round(dist) + 'm', W / 2, H - 14);
      }
    }
  }
}
