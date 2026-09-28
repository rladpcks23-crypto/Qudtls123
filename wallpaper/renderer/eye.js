// The giant eye: a round, watching eye with a red-black iris and a slowly
// turning halo. It follows the cursor, blinks rarely, and narrows into a
// glare (slit pupil, flaring glow) when something gets force-closed. Shared by wallpaper.html and toast.html.
//
// All sizes are in canvas pixels; callers scale by devicePixelRatio.
(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
      this.nextBlink = performance.now() + rand(5000, 10000);
      this.w = 0;
      this.auraR = 0; // 0 = size from the eye; set it to keep the glow inside a small window
      this.halo = true;
    }

    // w: corner-to-corner width, h: nominal open height.
    setSize(w, h) {
      if (Math.abs(w - this.w) < 1 && Math.abs(h - this.h) < 1) return;
      this.w = w; this.h = h;
      this.R = h * 0.41;
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
        const t = (now - this.blinkStart) / 320;
        if (t >= 1) {
          this.blink = 0;
          this.blinkStart = -1;
          // Slow and rare: it watches more than it blinks.
          this.nextBlink = now + rand(6000, 14000);
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
      rg.addColorStop(0, "#f6f1ec");
      rg.addColorStop(0.45, "#e3d9d1");
      rg.addColorStop(0.8, "#a8958d");
      rg.addColorStop(1, "#4a383a");
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
          g.strokeStyle = `rgba(165,18,28,${0.1 + 0.15 * (1 - i / len)})`;
          g.lineWidth = Math.max(0.5, width * (1 - i / len)) * unit;
          g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          x = nx; y = ny;
          if (depth < 2 && Math.random() < 0.08) vein(x, y, ang + rand(-0.9, 0.9), len * 0.5, width * 0.6, depth + 1);
        }
      };
      for (let i = 0; i < 6; i++) {
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
      const L = cx - w / 2, Rt = cx + w / 2;
      // Round, lens-shaped opening: wide control points, nearly symmetric lids.
      const up = h * 0.66 * (1 - 0.66 * s);
      const lo = h * 0.6 * (1 - 0.55 * s);
      const upY = -up + (up + lo) * bl; // upper-lid control offset; == lo when shut
      const ux = w * 0.36, lx = w * 0.36;

      // Aura behind the eye; flares up when angry.
      const pulse = 0.5 + 0.5 * Math.sin(now / 1400);
      const auraR = this.auraR || w * 0.8;
      const ag = ctx.createRadialGradient(cx, cy, h * 0.2, cx, cy, auraR);
      ag.addColorStop(0, `rgba(170,10,24,${0.14 + 0.05 * pulse + 0.3 * s})`);
      ag.addColorStop(1, "rgba(170,10,24,0)");
      ctx.fillStyle = ag;
      ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);

      if (this.halo) this.drawHalo(ctx, cx, cy, now, s);

      const upper = () => ctx.bezierCurveTo(cx - ux, cy + upY, cx + ux, cy + upY, Rt, cy);
      const lower = () => ctx.bezierCurveTo(cx + lx, cy + lo, cx - lx, cy + lo, L, cy);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(L, cy);
      upper();
      lower();
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(this.sclera, cx - this.sclera.width / 2, cy - this.sclera.height / 2);

      const ix = cx + this.gx * w * 0.24;
      const iy = cy + this.gy * h * 0.22;
      ctx.drawImage(this.iris, ix - R, iy - R, R * 2, R * 2);

      // Inner glow of the iris, much stronger when angry.
      const gg = ctx.createRadialGradient(ix, iy, R * 0.3, ix, iy, R * 1.35);
      gg.addColorStop(0, `rgba(255,40,40,${0.12 + 0.05 * pulse + 0.45 * s})`);
      gg.addColorStop(1, "rgba(255,0,0,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = gg;
      ctx.fillRect(ix - R * 1.35, iy - R * 1.35, R * 2.7, R * 2.7);
      ctx.globalCompositeOperation = "source-over";

      // Pupil, drawn over the glow so it stays pitch black. Breathes slowly,
      // narrows to a slit when angry.
      const pr = R * (0.4 + 0.025 * Math.sin(now / 1800) - 0.12 * s);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(ix, iy, pr * (1 - 0.6 * s), pr * (1 + 0.25 * s), 0, 0, TAU);
      ctx.fill();

      // Wet highlights.
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.ellipse(ix - R * 0.33, iy - R * 0.36, R * 0.13, R * 0.1, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath(); ctx.arc(ix + R * 0.3, iy + R * 0.3, R * 0.05, 0, TAU); ctx.fill();

      // Soft shading along both lids so the ball reads as round.
      const topY = cy + upY * 0.75;
      const sg = ctx.createLinearGradient(0, topY, 0, topY + h * 0.34);
      sg.addColorStop(0, "rgba(12,0,4,0.7)");
      sg.addColorStop(0.3, "rgba(12,0,4,0.32)");
      sg.addColorStop(0.65, "rgba(12,0,4,0.1)");
      sg.addColorStop(1, "rgba(12,0,4,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(L, topY - h * 0.1, w, h * 0.5);
      const botY = cy + lo * 0.75;
      const bg = ctx.createLinearGradient(0, botY, 0, botY - h * 0.2);
      bg.addColorStop(0, "rgba(12,0,4,0.45)");
      bg.addColorStop(1, "rgba(12,0,4,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(L, botY - h * 0.2, w, h * 0.3);
      ctx.restore();

      // Thin luminous rim instead of lids and lashes.
      ctx.save();
      ctx.shadowColor = `rgba(255,60,60,${0.6 + 0.4 * s})`;
      ctx.shadowBlur = h * (0.08 + 0.1 * s);
      ctx.strokeStyle = `rgba(255,${Math.round(190 - 150 * s)},${Math.round(180 - 140 * s)},${0.55 + 0.35 * s})`;
      ctx.lineWidth = h * 0.012;
      ctx.beginPath();
      ctx.moveTo(L, cy);
      upper();
      lower();
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Slowly turning rings, tick marks and faint rays around the eye.
    drawHalo(ctx, cx, cy, now, s) {
      const { w } = this;
      const spin = now / 60000;
      const col = (a) => `rgba(255,${Math.round(200 - 160 * s)},${Math.round(200 - 160 * s)},${a})`;
      ctx.save();
      ctx.lineCap = "round";

      // Rays.
      const rays = 36;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + spin * 0.5;
        const flick = 0.5 + 0.5 * Math.sin(now / 2200 + i * 1.7);
        const r1 = w * 0.6, r2 = w * (0.72 + 0.1 * flick + 0.08 * s);
        const g = ctx.createLinearGradient(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        g.addColorStop(0, col(0.05 + 0.05 * flick + 0.12 * s));
        g.addColorStop(1, col(0));
        ctx.strokeStyle = g;
        ctx.lineWidth = w * 0.004;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Rings: one solid, one dashed turning the other way, one with ticks.
      ctx.strokeStyle = col(0.14 + 0.25 * s);
      ctx.lineWidth = w * 0.002;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.56, 0, TAU); ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-spin * (1 + 4 * s) * TAU);
      ctx.setLineDash([w * 0.03, w * 0.02]);
      ctx.strokeStyle = col(0.1 + 0.2 * s);
      ctx.beginPath(); ctx.arc(0, 0, w * 0.6, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(spin * (2 + 6 * s) * TAU);
      ctx.strokeStyle = col(0.18 + 0.3 * s);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const r1 = w * 0.64, r2 = w * (i % 3 === 0 ? 0.68 : 0.66);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    }
  }

  window.Eye = Eye;
})();
