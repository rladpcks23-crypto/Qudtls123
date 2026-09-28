// The giant eye: a flat, gold Eye of Horus on black with a cat's slit
// pupil. It follows the cursor, blinks rarely, and narrows into a glare
// (the slit thins to a line, the gold flares red-orange, the brow drops)
// when something gets force-closed. Shared by wallpaper.html and toast.html.
//
// All sizes are in canvas pixels; callers scale by devicePixelRatio.
(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => Math.round(a + (b - a) * t);

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
      this.flip = false; // mirror it: tail points left (the left eye of a pair)
    }

    // w: corner-to-corner width, h: nominal open height.
    setSize(w, h) {
      this.w = w;
      this.h = h;
      this.R = h * 0.42;
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
      const k = 1 - Math.exp(-dt / (angry ? 60 : 90));
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

    draw(ctx, cx, cy, now) {
      const { w, h, R } = this;
      if (!w) return;
      const s = this.squint, bl = this.blink;
      const gold = `rgb(${mix(222, 255, s)},${mix(170, 84, s)},${mix(60, 36, s)})`;
      const glow = (a) => `rgba(255,${mix(186, 70, s)},${mix(70, 30, s)},${a})`;

      ctx.save();
      if (this.flip) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      const gx = this.flip ? -this.gx : this.gx;
      cx -= w * 0.18; // balance the emblem's long tail

      const L = cx - w / 2, Rt = cx + w / 2;
      const up = h * 0.66 * (1 - 0.66 * s);
      const lo = h * 0.6 * (1 - 0.55 * s);
      const upY = -up + (up + lo) * bl; // upper-lid control offset; == lo when shut
      const ux = w * 0.36, lx = w * 0.36;

      // Faint glow behind; flares up when angry.
      const pulse = 0.5 + 0.5 * Math.sin(now / 1600);
      const auraR = this.auraR || w * 0.85;
      const ag = ctx.createRadialGradient(cx, cy, h * 0.2, cx, cy, auraR);
      ag.addColorStop(0, glow(0.06 + 0.03 * pulse + 0.2 * s));
      ag.addColorStop(1, glow(0));
      ctx.fillStyle = ag;
      ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);

      // Dark eyeball, flat.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(L, cy);
      ctx.bezierCurveTo(cx - ux, cy + upY, cx + ux, cy + upY, Rt, cy);
      ctx.bezierCurveTo(cx + lx, cy + lo, cx - lx, cy + lo, L, cy);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = "#0e0c09";
      ctx.fillRect(L, cy - h, w, h * 2);

      const ix = cx + gx * w * 0.24;
      const iy = cy + this.gy * h * 0.22;

      // Gold iris with a dark rim.
      const ig = ctx.createRadialGradient(ix, iy, 0, ix, iy, R);
      ig.addColorStop(0, glow(1));
      ig.addColorStop(0.55, gold);
      ig.addColorStop(1, `rgb(${mix(150, 190, s)},${mix(100, 40, s)},${mix(20, 16, s)})`);
      ctx.fillStyle = ig;
      ctx.beginPath(); ctx.arc(ix, iy, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#0e0c09";
      ctx.lineWidth = R * 0.08;
      ctx.beginPath(); ctx.arc(ix, iy, R * 0.97, 0, TAU); ctx.stroke();

      // Cat's slit pupil, pointed at both ends; thins to a line when angry.
      const half = R * (0.2 + 0.03 * Math.sin(now / 1800)) * (1 - 0.75 * s);
      const tall = R * 0.9;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.moveTo(ix, iy - tall);
      ctx.quadraticCurveTo(ix + half * 2, iy, ix, iy + tall);
      ctx.quadraticCurveTo(ix - half * 2, iy, ix, iy - tall);
      ctx.fill();

      // One small flat glint.
      ctx.fillStyle = "rgba(255,248,225,0.8)";
      ctx.beginPath(); ctx.arc(ix - R * 0.42, iy - R * 0.42, R * 0.08, 0, TAU); ctx.fill();
      ctx.restore();

      this.drawHorus(ctx, cx, cy, s, gold, glow, { L, Rt, upY, lo, ux, lx });
      ctx.restore();
    }

    // Flat gold Eye-of-Horus strokes: liner with a long tail, brow,
    // teardrop and spiral.
    drawHorus(ctx, cx, cy, s, gold, glow, g) {
      const { w, h } = this;
      const { L, Rt, upY, lo, ux, lx } = g;
      const drop = s * h * 0.22; // the brow comes down into a frown
      const tailY = cy - h * 0.04;

      ctx.save();
      ctx.lineJoin = "round";
      ctx.strokeStyle = gold;
      ctx.fillStyle = gold;
      ctx.shadowColor = glow(0.35 + 0.5 * s);
      ctx.shadowBlur = h * (0.05 + 0.12 * s);

      const stroke = (width, cap, path) => {
        ctx.lineWidth = h * width;
        ctx.lineCap = cap;
        ctx.beginPath();
        path();
        ctx.stroke();
      };

      // Teardrop.
      const tx = cx - w * 0.14, ty = cy + lo * 0.72;
      ctx.beginPath();
      ctx.moveTo(tx - w * 0.03, ty);
      ctx.lineTo(tx + w * 0.03, ty);
      ctx.lineTo(tx + w * 0.015, cy + h * 1.02);
      ctx.lineTo(tx - w * 0.09, cy + h * 1.02);
      ctx.closePath();
      ctx.fill();

      // Upper liner following the (moving) lid, into the tail.
      stroke(0.1, "butt", () => {
        ctx.moveTo(L - w * 0.03, cy + h * 0.01);
        ctx.bezierCurveTo(cx - ux, cy + upY - h * 0.05, cx + ux, cy + upY - h * 0.05, Rt, tailY);
        ctx.lineTo(Rt + w * 0.46, tailY - h * 0.03);
      });
      // Lower liner.
      stroke(0.05, "round", () => {
        ctx.moveTo(L - w * 0.03, cy + h * 0.01);
        ctx.bezierCurveTo(cx - lx, cy + lo + h * 0.03, cx + lx, cy + lo + h * 0.03, Rt, tailY);
      });
      // Brow.
      stroke(0.1, "round", () => {
        ctx.moveTo(L - w * 0.04, cy - h * 0.55 + drop * 1.3);
        ctx.quadraticCurveTo(cx - w * 0.05, cy - h * 1.0 + drop, Rt + w * 0.08, cy - h * 0.74 + drop * 0.6);
        ctx.lineTo(Rt + w * 0.46, cy - h * 0.68 + drop * 0.3);
      });
      // Spiral: sweeps down and out from under the eye, then curls.
      stroke(0.05, "round", () => {
        const x0 = cx + w * 0.02, y0 = cy + lo * 0.78 + h * 0.03;
        const ex = Rt + w * 0.3, ey = cy + h * 0.68;
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(cx + w * 0.2, cy + h * 1.0, Rt + w * 0.12, cy + h * 1.02, ex, ey);
        const ccx = Rt + w * 0.2, ccy = cy + h * 0.6;
        const a0 = Math.atan2(ey - ccy, ex - ccx), r0 = Math.hypot(ex - ccx, ey - ccy);
        for (let i = 1; i <= 40; i++) {
          const t = i / 40;
          const a = a0 - t * TAU * 1.3, r = r0 * (1 - 0.8 * t);
          ctx.lineTo(ccx + Math.cos(a) * r, ccy + Math.sin(a) * r);
        }
      });
      ctx.restore();
    }
  }

  window.Eye = Eye;
})();
