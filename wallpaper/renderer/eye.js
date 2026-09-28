// The giant eye: a red-black iris that follows the cursor, blinks now and
// then, and squints (a glare with a furrowed brow) when something gets
// force-closed. Shared by wallpaper.html and toast.html.
//
// All sizes are in canvas pixels; callers scale by devicePixelRatio.
(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }
  function bezD(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
  }
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  class Eye {
    constructor() {
      this.gx = 0; this.gy = 0; // current gaze, -1..1
      this.tx = 0; this.ty = 0; // target gaze
      this.squint = 0;
      this.angerUntil = 0;
      this.blink = 0;
      this.blinkStart = -1;
      this.nextBlink = performance.now() + rand(2500, 6000);
      this.w = 0;
      this.auraR = 0; // 0 = size from the eye; set it to keep the glow inside a small window
    }

    // w: corner-to-corner width, h: nominal open height.
    setSize(w, h) {
      if (Math.abs(w - this.w) < 1 && Math.abs(h - this.h) < 1) return;
      this.w = w; this.h = h;
      this.R = h * 0.37;
      this.sclera = this.buildSclera(w, h);
      this.iris = this.buildIris(this.R);
    }

    lookAt(nx, ny) {
      this.tx = clamp(nx, -1, 1);
      this.ty = clamp(ny, -1, 1);
    }

    anger(ms) {
      this.angerUntil = performance.now() + ms;
      this.blink = 0;
      this.blinkStart = -1;
    }

    update(dt, now) {
      const angry = now < this.angerUntil;
      // While glaring it stares straight out at you.
      const tx = angry ? 0 : this.tx, ty = angry ? 0 : this.ty;
      const k = 1 - Math.exp(-dt / (angry ? 60 : 80));
      this.gx += (tx - this.gx) * k;
      this.gy += (ty - this.gy) * k;

      const sk = 1 - Math.exp(-dt / (angry ? 70 : 380));
      this.squint += ((angry ? 1 : 0) - this.squint) * sk;

      if (!angry && this.blinkStart < 0 && now > this.nextBlink) this.blinkStart = now;
      if (this.blinkStart >= 0) {
        const t = (now - this.blinkStart) / 200;
        if (t >= 1) {
          this.blink = 0;
          this.blinkStart = -1;
          // Sometimes a quick double blink.
          this.nextBlink = now + (Math.random() < 0.2 ? 180 : rand(2500, 7000));
        } else {
          this.blink = Math.sin(t * Math.PI);
        }
      }
    }

    buildSclera(w, h) {
      const c = canvas(w, h * 1.4);
      const g = c.getContext("2d");
      const cx = c.width / 2, cy = c.height / 2;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      rg.addColorStop(0, "#f1ebe4");
      rg.addColorStop(0.5, "#ddd2c8");
      rg.addColorStop(0.85, "#a8958d");
      rg.addColorStop(1, "#5e4a48");
      g.fillStyle = rg;
      g.fillRect(0, 0, c.width, c.height);

      // Bloodshot veins creeping in from both corners.
      const unit = Math.max(1, h / 220);
      const vein = (x, y, ang, len, width, depth) => {
        g.lineCap = "round";
        for (let i = 0; i < len; i++) {
          ang += rand(-0.45, 0.45);
          const nx = x + Math.cos(ang) * w * 0.012;
          const ny = y + Math.sin(ang) * w * 0.012;
          g.strokeStyle = `rgba(165,18,28,${0.18 + 0.25 * (1 - i / len)})`;
          g.lineWidth = Math.max(0.5, width * (1 - i / len)) * unit;
          g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          x = nx; y = ny;
          if (depth < 2 && Math.random() < 0.08) vein(x, y, ang + rand(-0.9, 0.9), len * 0.5, width * 0.6, depth + 1);
        }
      };
      for (let i = 0; i < 16; i++) {
        const left = i % 2 === 0;
        vein(left ? rand(0, w * 0.06) : w - rand(0, w * 0.06), cy + rand(-h * 0.22, h * 0.22),
          left ? rand(-0.4, 0.4) : Math.PI + rand(-0.4, 0.4), Math.floor(rand(14, 30)), rand(1, 2.2), 0);
      }
      return c;
    }

    buildIris(R) {
      const c = canvas(R * 2, R * 2);
      const g = c.getContext("2d");
      const r = c.width / 2;
      g.save();
      g.beginPath(); g.arc(r, r, r, 0, TAU); g.clip();

      const rg = g.createRadialGradient(r, r, 0, r, r, r);
      rg.addColorStop(0, "#040000");
      rg.addColorStop(0.3, "#1a0003");
      rg.addColorStop(0.55, "#5c030b");
      rg.addColorStop(0.78, "#9e0d16");
      rg.addColorStop(0.9, "#43030a");
      rg.addColorStop(1, "#060000");
      g.fillStyle = rg;
      g.fillRect(0, 0, c.width, c.height);

      // Radial fibres, red and black.
      const unit = Math.max(1, R / 90);
      for (let i = 0; i < 320; i++) {
        const a = rand(0, TAU);
        const r1 = r * rand(0.3, 0.5), r2 = r * rand(0.7, 0.97);
        const red = Math.random() < 0.7;
        g.strokeStyle = red
          ? `rgba(${Math.floor(rand(190, 255))},${Math.floor(rand(20, 70))},${Math.floor(rand(30, 60))},${rand(0.06, 0.22)})`
          : `rgba(0,0,0,${rand(0.15, 0.35)})`;
        g.lineWidth = rand(0.6, 1.6) * unit;
        const bend = rand(-0.08, 0.08);
        g.beginPath();
        g.moveTo(r + Math.cos(a) * r1, r + Math.sin(a) * r1);
        g.quadraticCurveTo(
          r + Math.cos(a + bend) * (r1 + r2) / 2, r + Math.sin(a + bend) * (r1 + r2) / 2,
          r + Math.cos(a) * r2, r + Math.sin(a) * r2);
        g.stroke();
      }

      // Jagged collarette ring around the pupil zone.
      g.strokeStyle = "rgba(255,70,60,0.28)";
      g.lineWidth = 1.4 * unit;
      g.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        const rr = r * (0.5 + 0.04 * Math.sin(a * 9) + rand(-0.015, 0.015));
        const x = r + Math.cos(a) * rr, y = r + Math.sin(a) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();

      // Dark limbal ring.
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.lineWidth = r * 0.1;
      g.beginPath(); g.arc(r, r, r * 0.97, 0, TAU); g.stroke();
      g.restore();
      return c;
    }

    draw(ctx, cx, cy, now) {
      const { w, h, R } = this;
      if (!w) return;
      const s = this.squint, bl = this.blink;
      if (s > 0.3) {
        // Trembling with rage.
        cx += (Math.random() - 0.5) * h * 0.014 * s;
        cy += (Math.random() - 0.5) * h * 0.008 * s;
      }
      const L = cx - w / 2, Rt = cx + w / 2;
      const up = h * 0.62 * (1 - 0.64 * s);
      const lo = h * 0.42 * (1 - 0.45 * s);
      const upY = -up + (up + lo) * bl; // upper-lid control offset; == lo when shut
      const ux = w * 0.27, lx = w * 0.25;

      // Red aura behind the eye; flares up when angry.
      const pulse = 0.5 + 0.5 * Math.sin(now / 900);
      const auraR = this.auraR || w * 0.66;
      const ag = ctx.createRadialGradient(cx, cy, h * 0.2, cx, cy, auraR);
      ag.addColorStop(0, `rgba(170,10,24,${0.12 + 0.05 * pulse + 0.3 * s})`);
      ag.addColorStop(1, "rgba(170,10,24,0)");
      ctx.fillStyle = ag;
      ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);

      const upper = () => ctx.bezierCurveTo(cx - ux, cy + upY, cx + ux, cy + upY, Rt, cy);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(L, cy);
      upper();
      ctx.bezierCurveTo(cx + lx, cy + lo, cx - lx, cy + lo, L, cy);
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(this.sclera, L, cy - this.sclera.height / 2);

      const ix = cx + this.gx * w * 0.27;
      const iy = cy + this.gy * h * 0.2;
      ctx.drawImage(this.iris, ix - R, iy - R, R * 2, R * 2);

      // Pupil: breathes a little, narrows to a slit when angry.
      const pr = R * (0.4 + 0.02 * Math.sin(now / 1300) - 0.12 * s);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(ix, iy, pr * (1 - 0.6 * s), pr * (1 + 0.25 * s), 0, 0, TAU);
      ctx.fill();

      if (s > 0.01) {
        const gg = ctx.createRadialGradient(ix, iy, pr * 0.5, ix, iy, R * 1.35);
        gg.addColorStop(0, `rgba(255,30,30,${0.5 * s})`);
        gg.addColorStop(1, "rgba(255,0,0,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = gg;
        ctx.fillRect(ix - R * 1.35, iy - R * 1.35, R * 2.7, R * 2.7);
        ctx.globalCompositeOperation = "source-over";
      }

      // Wet highlights.
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.ellipse(ix - R * 0.33, iy - R * 0.36, R * 0.13, R * 0.1, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath(); ctx.arc(ix + R * 0.3, iy + R * 0.3, R * 0.05, 0, TAU); ctx.fill();

      // Shadow cast by the upper lid.
      const topY = cy + upY * 0.75;
      const sg = ctx.createLinearGradient(0, topY, 0, topY + h * 0.34);
      sg.addColorStop(0, "rgba(12,0,4,0.8)");
      sg.addColorStop(0.3, "rgba(12,0,4,0.4)");
      sg.addColorStop(0.65, "rgba(12,0,4,0.12)");
      sg.addColorStop(1, "rgba(12,0,4,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(L, topY - h * 0.1, w, h * 0.5);
      ctx.restore();

      // Lid lines, crease and lashes.
      ctx.lineCap = "round";
      // Lid crease: the upper lid line pushed outwards, middle part only.
      ctx.strokeStyle = "rgba(60,14,24,0.55)";
      ctx.lineWidth = h * 0.012;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = 0.14 + (0.72 * i) / 24;
        const dx = bezD(L, cx - ux, cx + ux, Rt, t), dy = bezD(cy, cy + upY, cy + upY, cy, t);
        const m = Math.hypot(dx, dy) || 1;
        const off = h * (0.1 + 0.06 * Math.sin(t * Math.PI));
        const x = bez(L, cx - ux, cx + ux, Rt, t) + (dy / m) * off;
        const y = bez(cy, cy + upY, cy + upY, cy, t) - (dx / m) * off;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(24,6,12,0.9)";
      ctx.lineWidth = h * 0.016;
      ctx.beginPath(); ctx.moveTo(Rt, cy); ctx.bezierCurveTo(cx + lx, cy + lo, cx - lx, cy + lo, L, cy); ctx.stroke();

      ctx.strokeStyle = "#08030a";
      ctx.lineWidth = h * 0.042;
      ctx.beginPath(); ctx.moveTo(L, cy); upper(); ctx.stroke();

      ctx.lineWidth = h * 0.011;
      const N = 30;
      for (let i = 2; i < N - 1; i++) {
        const t = i / N;
        const px = bez(L, cx - ux, cx + ux, Rt, t), py = bez(cy, cy + upY, cy + upY, cy, t);
        let dx = bezD(L, cx - ux, cx + ux, Rt, t), dy = bezD(cy, cy + upY, cy + upY, cy, t);
        const m = Math.hypot(dx, dy) || 1;
        dx /= m; dy /= m;
        // Outward normal, fanned towards the corners.
        const fan = (t - 0.5) * 1.3;
        let nx = dy + dx * fan, ny = -dx + dy * fan;
        const nm = Math.hypot(nx, ny) || 1;
        nx /= nm; ny /= nm;
        const len = h * (0.06 + 0.08 * Math.sin(t * Math.PI));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + nx * len * 0.6, py + ny * len * 0.6, px + nx * len + dx * len * 0.35 * Math.sign(fan), py + ny * len);
        ctx.stroke();
      }

      // Furrowed V-shaped brow while squinting.
      if (s > 0.02) {
        const oy = cy - h * (0.74 - 0.08 * s);
        const iy2 = cy - h * (0.6 - 0.28 * s);
        const th = h * 0.09;
        ctx.globalAlpha = Math.min(1, s * 1.2);
        for (const dir of [-1, 1]) {
          const ox = cx + dir * w * 0.42, inx = cx + dir * w * 0.03;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.quadraticCurveTo(cx + dir * w * 0.25, oy - th * 0.6, inx, iy2 - th * 0.5);
          ctx.lineTo(inx, iy2 + th * 0.5);
          ctx.quadraticCurveTo(cx + dir * w * 0.25, oy + th * 0.5, ox, oy + th * 0.15);
          ctx.closePath();
          ctx.fillStyle = "#0b0307";
          ctx.fill();
          ctx.strokeStyle = "rgba(210,30,40,0.55)";
          ctx.lineWidth = h * 0.008;
          ctx.stroke();
        }
        // Crow's-feet creases at the corners.
        ctx.strokeStyle = "rgba(120,20,30,0.6)";
        ctx.lineWidth = h * 0.01;
        for (const dir of [-1, 1]) {
          const x0 = cx + dir * w * 0.53;
          for (const a of [-0.35, 0, 0.35]) {
            ctx.beginPath();
            ctx.moveTo(x0, cy + a * h * 0.3);
            ctx.lineTo(x0 + dir * h * 0.14, cy + a * h * 0.6);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  window.Eye = Eye;
})();
