/**
 * morph-anim.html 을 mp4 로 굽는다.
 *
 *   node render-anim.js [출력경로]
 *
 * 실시간 녹화가 아니라 프레임을 한 장씩 그려서 모은다 — 기계가 느려도
 * 결과가 흔들리지 않는다. playwright-core 와 ffmpeg 이 필요하다.
 */
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const os = require('os');

const FPS = 25, W = 1920, H = 1080;
const page_url = 'file://' + path.join(__dirname, 'morph-anim.html') + '?manual';
const out = process.argv[2] || path.join(__dirname, '..', 'deck', 'morph-anim.mp4');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-'));
  const exeDir = fs.existsSync('/opt/pw-browsers')
    ? fs.readdirSync('/opt/pw-browsers').find(d => /^chromium-\d/.test(d)) : null;
  const browser = await chromium.launch({
    executablePath: exeDir ? `/opt/pw-browsers/${exeDir}/chrome-linux/chrome` : undefined,
    args: ['--no-sandbox', '--force-device-scale-factor=1',
           '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(page_url);
  await page.waitForTimeout(500);

  const dur = await page.evaluate(() => window.__dur);
  const total = Math.round(dur * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.__seek(t), i / FPS);
    await page.screenshot({ path: path.join(dir, String(i).padStart(5, '0') + '.png') });
    if (i % 50 === 0) process.stdout.write(`  ${i}/${total}\r`);
  }
  await browser.close();
  if (errs.length) { console.error('페이지 오류:', errs); process.exit(1); }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS),
    '-i', path.join(dir, '%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${out}  (${total} 프레임, ${dur.toFixed(1)}초, ${FPS}fps)`);
})();
