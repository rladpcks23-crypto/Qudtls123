// 화면 타임라인이 등록한 효과음 큐를 JSON으로 내보낸다: node cues.js <out.json>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`http://localhost:${process.env.PORT || 8765}/index.html?capture=1`);
  await p.waitForFunction(() => window.READY === true);
  const s = await p.evaluate(() => JSON.stringify({ dur: window.DUR, sfx: window.SFX }));
  require('fs').writeFileSync(process.argv[2], s);
  await b.close();
})();
