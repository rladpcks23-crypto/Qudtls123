// Visual check: opens the built site in Chromium at desktop and phone sizes,
// walks the scroll sequence and saves a screenshot per stage.
// usage: node scripts/shoot.mjs [baseUrl] [outDir] [--only=desktop|mobile] [--reduced] [--stops=01,11]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/';
const out = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'shots';
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const reduced = args.includes('--reduced');
const pick = args.find((a) => a.startsWith('--stops='))?.split('=')[1]?.split(',');
mkdirSync(out, { recursive: true });

const STOPS = [
  ['01-hero', 'hero', 0.2],
  ['02-disassembly-mid', 'disassembly', 0.42],
  ['03-disassembly-end', 'disassembly', 0.82],
  ['04-fan', 'fan', 0.45],
  ['05-compressor', 'compressor', 0.45],
  ['06-combustor', 'combustor', 0.45],
  ['07-turbine', 'turbine', 0.45],
  ['08-reassembly-mid', 'reassembly', 0.5],
  ['09-reassembly-end', 'reassembly', 0.84],
  ['10-operation-lightoff', 'operation', 0.2],
  ['11-operation-takeoff', 'operation', 0.86],
  ['12-outro', 'outro', 0.3],
];

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

for (const [name, opts] of Object.entries(VIEWPORTS)) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext({ ...opts, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}-00-boot.png`), timeout: 120000 });
  await page.waitForFunction(() => window.__tf9?.ready, null, { timeout: 120000 });
  // software GL draws about one frame a second here, so the script advances
  // the animation clock directly and then waits for a frame to be drawn
  const settle = async (s) => { await page.evaluate((s) => window.__tf9.settle(s), s); await page.waitForTimeout(2500); };
  await settle(0.3);
  await page.screenshot({ path: join(out, `${name}-00b-scan.png`), timeout: 120000 });
  await settle(2.5);

  for (const [file, id, q] of STOPS.filter(([f]) => !pick || pick.some((p) => f.startsWith(p)))) {
    await page.evaluate(([id, q]) => {
      const el = document.getElementById(id);
      window.scrollTo(0, el.offsetTop + el.offsetHeight * q);
    }, [id, q]);
    await page.waitForTimeout(300);
    await settle(id === 'operation' || id === 'outro' ? 6 : 3);
    await page.screenshot({ path: join(out, `${name}-${file}.png`), timeout: 120000 });
    if (name === 'desktop' && file === '03-disassembly-end') {
      // hover check: point at the fan in the exploded layout
      const pt = await page.evaluate(() => {
        const { engine, stage } = window.__tf9;
        const p = engine.byId.get('fan');
        const v = p.box.getCenter(new p.box.min.constructor());
        v.y = p.box.max.y * 0.6;
        p.group.localToWorld(v);
        v.project(stage.camera);
        return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
      });
      await page.mouse.move(pt.x, pt.y);
      await settle(0.4);
      await page.screenshot({ path: join(out, `${name}-03b-hover.png`), timeout: 120000 });
      await page.mouse.move(5, 450);
    }
  }
  const ms = await page.evaluate(() => window.__tf9.frameMs);
  console.log(`${name}: avg JS+render ${ms.toFixed(2)} ms/frame (software GL)`);
  if (errors.length) console.log(`${name} console:\n  ` + errors.slice(0, 20).join('\n  '));
  await ctx.close();
}
await browser.close();
