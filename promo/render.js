// 프레임을 병렬로 찍어 JPEG로 저장한다: node render.js <outDir> <fps> <workers>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [, , outDir, fpsS = '60', wS = '3'] = process.argv;
const fps = +fpsS, workers = +wS;
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const t0 = Date.now();
  let total = 0;
  await Promise.all([...Array(workers)].map(async (_, w) => {
    const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--force-color-profile=srgb'] });
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto(`http://localhost:${process.env.PORT || 8765}/index.html?capture=1`);
    await p.waitForFunction(() => window.READY === true);
    const dur = await p.evaluate(() => window.DUR);
    total = Math.round(dur * fps);
    for (let f = w; f < total; f += workers) {
      const file = path.join(outDir, String(f).padStart(5, '0') + '.jpg');
      if (fs.existsSync(file)) continue;
      await p.evaluate(t => window.renderAt(t), f / fps);
      fs.writeFileSync(file, await p.screenshot({ type: 'jpeg', quality: 94 }));
      if (w === 0 && f % 120 === 0) console.log(`frame ${f}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await b.close();
  }));
  console.log(`done ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
