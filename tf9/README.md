# TF-9 — turbofan teardown

A one-page, scroll-driven 3D study: a fictional twin-spool high-bypass
turbofan (TF-9) is shown complete, taken apart, inspected module by module,
rebuilt, and run up to take-off power.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ on http://localhost:4173
npm run shoot      # screenshots of every scroll stage, desktop + phone (needs preview running)
npm run artifact   # after build: single-file page for hosting as a claude.ai Artifact
```

## Stack

**Vite + TypeScript + Three.js** (plus `three-mesh-bvh` for fast hover picking).
Three.js gives real-time WebGL with screen-space fat lines for crisp edges;
Vite and TypeScript give a real module structure and a static build with no
framework runtime, which a single canvas scene does not need.

## Layout

```
index.html              story text (EN + KO), HUD, boot screen
src/main.ts             scroll → state machine, pointer input, main loop
src/engine/builder.ts   geometry kit: lathe profiles, twisted blade rows, bolts
src/engine/model.ts     TF-9 parts, explode offsets, (dis)assembly order
src/engine/engine.ts    runtime: seat/unseat animation, spools, heat, ghosting
src/engine/spec.ts      hover-label data and reference figures
src/scene/stage.ts      renderer, lights, camera rig (fits a box into a screen region)
src/audio/sound.ts      Web Audio synthesis: clicks, servo, engine
src/ui/hud.ts           boot log, N1 gauge, spec label, HUD readouts
scripts/shoot.mjs       Playwright visual check
scripts/artifact.mjs    single-file packer
```

## Notes

- Figures follow a LEAP-1A-class engine: fan 1,981 mm, bypass ratio 11:1
  (about 90 % of the air bypasses the core), overall pressure ratio 40:1,
  turbine entry gas around 1,500 °C. Stage counts are simplified.
- Fast rotation never shows the reverse "wagon-wheel" effect: each rotor's
  visible step per frame is capped below a third of its blade pitch, and a
  motion-blur disc takes over above that.
- `prefers-reduced-motion` (or the MOTION toggle) removes the scan sweep,
  camera drift and part travel; parts change state in place.
