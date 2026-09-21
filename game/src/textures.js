// All textures are painted into canvases at load time: no external assets.
import * as THREE from 'three';
import { makeRng, randInt, clamp } from './util.js';

function cv(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function tex(canvas, rep = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseInto(ctx, size, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** Facade + window-light pair. One tile == 4m wide x 3.6m tall in world units. */
export function facade(style, seed) {
  const S = 512, rng = makeRng(seed);
  const [c, g] = cv(S), [ec, eg] = cv(S);
  const cols = [4, 3, 5, 3][style], rows = 4;

  const base = ['#9c9c9a', '#8b8e93', '#b29a82', '#7d828a'][style];
  g.fillStyle = base; g.fillRect(0, 0, S, S);

  // concrete streaks
  for (let i = 0; i < 220; i++) {
    g.globalAlpha = 0.03 + rng() * 0.06;
    g.fillStyle = rng() > .5 ? '#ffffff' : '#000000';
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 20 + rng() * 180);
  }
  g.globalAlpha = 1;

  eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);

  const cw = S / cols, rh = S / rows;
  const glass = ['#2b3a4a', '#26313d', '#33404d', '#1e2a36'][style];
  for (let r = 0; r < rows; r++) {
    for (let cix = 0; cix < cols; cix++) {
      const x = cix * cw, y = r * rh;
      const mx = cw * 0.17, my = rh * 0.2;
      const w = cw - mx * 2, h = rh - my * 2;
      // window frame + glass
      g.fillStyle = '#3a3f47'; g.fillRect(x + mx - 3, y + my - 3, w + 6, h + 6);
      const grad = g.createLinearGradient(0, y + my, 0, y + my + h);
      grad.addColorStop(0, '#4d6b83'); grad.addColorStop(0.35, glass);
      grad.addColorStop(1, '#22303c');
      g.fillStyle = grad; g.fillRect(x + mx, y + my, w, h);
      // single flat reflection streak
      g.save();
      g.beginPath(); g.rect(x + mx, y + my, w, h); g.clip();
      g.globalAlpha = .18; g.fillStyle = '#dff0ff';
      g.beginPath();
      g.moveTo(x + mx, y + my + h * .75); g.lineTo(x + mx + w * .6, y + my);
      g.lineTo(x + mx + w * .85, y + my); g.lineTo(x + mx, y + my + h);
      g.closePath(); g.fill();
      g.restore(); g.globalAlpha = 1;
      // mullion
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(x + mx + w / 2 - 1, y + my, 2, h);
      // floor band under the window
      g.fillStyle = 'rgba(0,0,0,.14)';
      g.fillRect(x, y + rh - my * 0.7, cw, my * 0.5);

      if (rng() < 0.42) {                       // lit at night
        const warm = rng();
        eg.fillStyle = warm < .55 ? '#ffd79a' : warm < .85 ? '#cfe4ff' : '#9effd8';
        eg.globalAlpha = 0.55 + rng() * 0.45;
        eg.fillRect(x + mx, y + my, w, h);
        eg.globalAlpha = 1;
        if (rng() < .3) { eg.fillStyle = 'rgba(0,0,0,.45)'; eg.fillRect(x + mx, y + my, w, h * (0.2 + rng() * 0.4)); }
      }
    }
  }
  noiseInto(g, S, 16);
  return { map: tex(c), emissive: tex(ec) };
}

export function asphalt() {
  const S = 512, [c, g] = cv(S);
  g.fillStyle = '#3e434b'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    g.globalAlpha = 0.05 + Math.random() * 0.2;
    g.fillStyle = Math.random() > .5 ? '#4a4f57' : '#171a1f';
    const r = 1 + Math.random() * 3;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, r, 0, 7); g.fill();
  }
  g.globalAlpha = 0.5;
  for (let i = 0; i < 14; i++) { // patches & cracks
    g.strokeStyle = '#1b1e23'; g.lineWidth = 1 + Math.random() * 2;
    g.beginPath(); let x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 90; y += (Math.random() - .5) * 90; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  noiseInto(g, S, 18);
  return tex(c, 1);
}

export function concrete() {
  const S = 512, [c, g] = cv(S);
  g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {         // paving slab joints
    g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke();
  }
  for (let i = 0; i < 1400; i++) {
    g.globalAlpha = 0.05 + Math.random() * 0.12;
    g.fillStyle = Math.random() > .5 ? '#ffffff' : '#4c5158';
    g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  g.globalAlpha = 1; noiseInto(g, S, 14);
  return tex(c, 1);
}

export function grass() {
  const S = 256, [c, g] = cv(S);
  g.fillStyle = '#2f5a35'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    g.globalAlpha = 0.25 + Math.random() * 0.4;
    g.fillStyle = ['#3c7040', '#27492c', '#4a8248', '#355e38'][randInt(Math.random, 0, 3) | 0];
    g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 2 + Math.random() * 4);
  }
  g.globalAlpha = 1;
  return tex(c, 1);
}

/** Radial white blob used for headlight glows, muzzle flashes and lamp halos. */
export function glow() {
  const S = 128, [c, g] = cv(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smoke() {
  const S = 128, [c, g] = cv(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  noiseInto(g, S, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
