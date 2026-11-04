// 홈라인 15초 시연 영상 (1920×1080, 남색 무대 + QR)
// WIDE=1 이면 앱을 PC(가로) 화면으로, 아니면 폰 화면으로 보여준다
// 사용: 이 폴더에서 `python3 -m http.server 8765` 를 띄운 뒤 `node record.js`
//       site/ 에는 홈라인 웹 버전(index.html + 이미지 + qrcode.min.js)이 있어야 한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'raw');
const W = 1920, H = 1080;
const WIDE = process.env.WIDE === '1';

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1,
    colorScheme: 'dark', locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  // 구글 폰트는 이 환경에서 못 받으니 막고, 같은 글꼴을 시스템에 설치해 둔 것을 쓴다
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('rl.intro', 'seen'); } catch (e) {} });

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(BASE + (WIDE ? 'stage-wide.html' : 'stage.html'));
  await page.waitForTimeout(800);

  const app = () => page.frames().find(f => f.url().includes('/site/index.html'));
  // 예시 데이터 켜기 (앱이 스스로 다시 열린다)
  await app().evaluate(() => document.getElementById('demoBtn').click());
  await page.waitForTimeout(1800);
  const f = app();
  await f.addStyleTag({ content: `
    #demoChip,.devtag{display:none!important}
    .grid>*{min-width:0}
    .tapfx{position:fixed;z-index:99999;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
      background:rgba(255,184,108,.35);border:2px solid rgba(255,184,108,.95);pointer-events:none;animation:tapfx .6s ease-out forwards}
    @keyframes tapfx{from{transform:scale(.4);opacity:1}to{transform:scale(1.35);opacity:0}}` });
  await f.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(600);

  // ---- 캡처 루프 ----
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let capturing = true;
  const loop = (async () => {
    while (capturing) {
      const t = Date.now() / 1000;
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
      frames.push({ t, data: r.data });
    }
  })();

  const wait = ms => page.waitForTimeout(ms);
  const scene = n => page.evaluate(n => window.scene(n), n);
  const scrollTo = (sel, off = 70) => f.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - off, behavior: 'smooth' });
  }, [sel, off]);
  const tap = sel => f.evaluate(sel => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect();
    const d = document.createElement('div'); d.className = 'tapfx';
    d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 700);
    el.click();
  }, sel);
  const tab = async name => { await tap(`.tab[data-tab="${name}"]`); await f.evaluate(() => scrollTo(0, 0)); };

  const t0 = Date.now();
  // 01 첫 화면 : D-day → 4단계
  await scene(1);
  await wait(1700);
  await scrollTo(WIDE ? '#steps' : '.metrics-band', WIDE ? 330 : 40);
  await wait(1900);

  // 02 하루를 마치며
  await scene(2);
  await scrollTo(WIDE ? '.grid' : '#sonCard', WIDE ? 56 : 20);
  await wait(WIDE ? 700 : 1300);
  if (WIDE) { await scrollTo('.son-opts', 330); await wait(700); }
  await tap('.son-o[data-k="home"]');
  await wait(2400);

  // 03 순공 기록
  await scene(3);
  await tab('record');
  await wait(300);
  await scrollTo('.study', WIDE ? 70 : 14);
  await f.evaluate(() => {
    const s = document.querySelector('.hm-scroll');
    const r = document.querySelector('#hm rect[data-d="' + document.getElementById('hmDate').value + '"]');
    if (r) s.scrollTo({ left: Math.max(0, r.getBBox().x - s.clientWidth + 80), behavior: 'smooth' });
  });
  await wait(900);
  await f.evaluate(() => { document.getElementById('hmHours').value = '6.5'; });
  await tap('#hmSave');
  await wait(1700);

  // 04 성적 추이
  await scene(4);
  await tab('scores');
  await wait(900);
  // 그래프 위 툴팁 : 차트에 초점을 주고 → 키로 시험을 하나씩 넘긴다
  await f.evaluate(() => document.getElementById('chart').focus());
  for (let i = 0; i < 4; i++) { await f.evaluate(() => document.getElementById('chart').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))); await wait(380); }
  await wait(400);
  await f.evaluate(() => document.getElementById('chart').blur());
  await tap('#fMetric [data-v="pct"]');
  await wait(1300);

  // 마무리 : 메시지 + 큰 QR
  await page.evaluate(() => window.ending());
  await wait(1900);

  capturing = false; await loop;
  const tEnd = Date.now() / 1000;
  let list = '';
  frames.forEach((fr, i) => {
    const fn = path.join(OUT, 'f' + String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(fn, Buffer.from(fr.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : tEnd;
    list += `file '${fn}'\nduration ${(next - fr.t).toFixed(4)}\n`;
  });
  list += `file '${path.join(OUT, 'f' + String(frames.length - 1).padStart(5, '0') + '.jpg')}'\n`;
  fs.writeFileSync(path.join(OUT, 'list.txt'), list);
  console.log('frames', frames.length, 'length', ((Date.now() - t0) / 1000).toFixed(2) + 's');
  await browser.close();
})();
