/**
 * window.__seek(t) / window.__dur 를 내놓는 페이지를 mp4 로 굽는다.
 *
 *   node render-anim.js [페이지.html] [출력.mp4]
 *   node render-anim.js                       # morph-anim.html → deck/morph-anim.mp4
 *
 * 실시간 녹화가 아니라 프레임을 한 장씩 그려서 모은다 — 기계가 느려도
 * 결과가 흔들리지 않는다. playwright-core 와 ffmpeg 이 필요하다.
 *
 * 페이지는 file:// 가 아니라 이 스크립트가 띄우는 임시 서버로 연다.
 * 3D 페이지처럼 ./vendor/ 에서 모듈을 불러오는 경우 file:// 로는 막히기 때문이다.
 */
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs'), path = require('path');
const os = require('os');

const FPS = 25, W = 1920, H = 1080;
const pageFile = path.basename(process.argv[2] || 'morph-anim.html');
const out = process.argv[3] ||
  path.join(__dirname, '..', 'deck', pageFile.replace(/\.html$/, '') + '.mp4');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };

/** web/ 폴더를 통째로 내주는 최소 서버 */
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(__dirname, rel);
      if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found'); return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { srv, port } = await serve();
  const page_url = `http://127.0.0.1:${port}/${pageFile}?manual`;
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
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(dir, String(i).padStart(5, '0') + '.png') });
    if (i % 50 === 0) process.stdout.write(`  ${i}/${total}\r`);
  }
  await browser.close();
  srv.close();
  if (errs.length) { console.error('페이지 오류:', errs); process.exit(1); }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS),
    '-i', path.join(dir, '%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${out}  (${total} 프레임, ${dur.toFixed(1)}초, ${FPS}fps)`);
})();
