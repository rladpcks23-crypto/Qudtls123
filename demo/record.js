// 15초 시연 영상 녹화: D-day → 체크리스트 → 순공 히트맵 → 성적 그래프 → 엔딩
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP = 'file://' + path.resolve(__dirname, '../app/assets/index.html');
const OUT = path.join(__dirname, 'raw');
const W = 390, H = 844;

function iso(d) { return d.toISOString().slice(0, 10); }

// ---- 시드 데이터 (KST 기준 날짜) ----
const now = new Date(Date.now() + 9 * 3600e3);
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const todayNo = Math.floor(today.getTime() / 86400000);
const hlog = {};
let seed = 7;
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
for (let d = new Date(Date.UTC(2026, 7, 29)); d < today; d = new Date(d.getTime() + 86400000)) {
  const r = rnd();
  if (r < 0.06) continue;                     // 가끔 비운 날
  hlog[iso(d)] = r < 0.3 ? 3 + Math.round(rnd() * 4) / 2 : 6 + Math.round(rnd() * 6) / 2;
}
const done = [];
for (let i = 1; i <= 12; i++) done.push(todayNo - i);  // 12일 연속 → 오늘 완료하면 13
const exams = [
  { id: 'e1', date: '2026-09-03', kind: 'official', name: '9월 모평', rows: [
    { s: '국어', raw: 72, grade: 4, pct: 68 }, { s: '수학', raw: 64, grade: 4, pct: 62 },
    { s: '영어', raw: 78, grade: 3 }, { s: '탐구1', raw: 38, grade: 3, pct: 77 }, { s: '탐구2', raw: 35, grade: 4, pct: 66 }] },
  { id: 'e2', date: '2026-10-14', kind: 'official', name: '10월 학평', rows: [
    { s: '국어', raw: 80, grade: 3, pct: 79 }, { s: '수학', raw: 71, grade: 3, pct: 74 },
    { s: '영어', raw: 85, grade: 2 }, { s: '탐구1', raw: 42, grade: 2, pct: 88 }, { s: '탐구2', raw: 39, grade: 3, pct: 78 }] },
  { id: 'e3', date: '2026-10-29', kind: 'self', name: '이감 3회', rows: [
    { s: '국어', raw: 86, grade: 2, pct: 90 }, { s: '수학', raw: 80, grade: 2, pct: 87 },
    { s: '영어', raw: 91, grade: 1 }, { s: '탐구1', raw: 45, grade: 1, pct: 96 }, { s: '탐구2', raw: 43, grade: 2, pct: 89 }] },
];

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: false,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
  });
  await ctx.addInitScript(({ hlog, done, exams }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    const p = 'rl.p.나.';
    localStorage.setItem(p + 'hlog', JSON.stringify(hlog));
    localStorage.setItem(p + 'done', JSON.stringify(done));
    localStorage.setItem(p + 'exams', JSON.stringify(exams));
    localStorage.setItem(p + 'hours', '6');
  }, { hlog, done, exams });

  const page = await ctx.newPage();
  const t0 = Date.now();
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  let capturing = false, capLoop = null;
  const startCap = () => { capturing = true; capLoop = (async () => {
    while (capturing) {
      const t = Date.now() / 1000;
      const m = await cdp.send('Page.getLayoutMetrics');
      const vp = m.cssVisualViewport;
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true,
        clip: { x: vp.pageX, y: vp.pageY, width: W, height: H, scale: 2 } });
      frames.push({ t, data: r.data });
    }
  })(); };
  await page.goto(APP);
  await page.addStyleTag({ content: `
    body,input,button,select,textarea{font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif}
    #cap{position:fixed;left:16px;right:16px;bottom:22px;z-index:9999;pointer-events:none;
      background:rgba(14,14,16,.92);color:#fff;border-radius:16px;padding:14px 18px;
      font-family:'Noto Sans KR',sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);
      transform:translateY(140%);transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .3s;opacity:0}
    #cap.on{transform:none;opacity:1}
    #cap .n{font:700 12px 'IBM Plex Mono',monospace;color:#ff4d3d;letter-spacing:.08em}
    #cap .t{font-weight:800;font-size:20px;margin-top:2px;letter-spacing:-.02em}
    #cap .s{font-size:13px;color:#bbb;margin-top:2px}
    .tap{position:fixed;z-index:9998;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      background:rgba(255,77,61,.35);border:2px solid rgba(255,77,61,.9);pointer-events:none;
      animation:tap .55s ease-out forwards}
    @keyframes tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.3);opacity:0}}
    #end{position:fixed;inset:0;z-index:10000;background:#0e0e10;color:#fff;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;opacity:0;pointer-events:none;transition:opacity .45s;font-family:'Noto Sans KR',sans-serif}
    #end.on{opacity:1}
    #end .k{font:700 13px 'IBM Plex Mono',monospace;color:#ff4d3d;letter-spacing:.2em}
    #end .t{font-weight:800;font-size:32px;letter-spacing:-.03em}
    #end .s{font-size:14px;color:#aaa}
  `});
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'cap';
    c.innerHTML = '<div class="n"></div><div class="t"></div><div class="s"></div>';
    document.body.appendChild(c);
    const e = document.createElement('div'); e.id = 'end';
    e.innerHTML = '<div class="k">REDLINE</div><div class="t">탕부하나님 레드라인</div>' +
      '<div class="s">D-day · 체크리스트 · 순공 기록 · 성적 추이</div>';
    document.body.appendChild(e);
  });

  const wait = (ms) => page.waitForTimeout(ms);
  const cap = (n, t, s) => page.evaluate(([n, t, s]) => {
    const c = document.getElementById('cap');
    c.classList.remove('on');
    setTimeout(() => {
      c.querySelector('.n').textContent = n; c.querySelector('.t').textContent = t;
      c.querySelector('.s').textContent = s; c.classList.add('on');
    }, 120);
  }, [n, t, s]);
  const scrollTo = (sel, offset = 70) => page.evaluate(([sel, offset]) => {
    const el = document.querySelector(sel);
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - offset, behavior: 'smooth' });
  }, [sel, offset]);
  const tap = async (sel) => {
    const box = await page.locator(sel).first().boundingBox();
    const x = box.x + Math.min(box.width / 2, 24), y = box.y + box.height / 2;
    await page.evaluate(([x, y]) => {
      const d = document.createElement('div'); d.className = 'tap';
      d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d);
      setTimeout(() => d.remove(), 600);
    }, [x, y]);
    await page.mouse.click(x, y);
  };

  await wait(600);
  startCap();
  await wait(100);
  const tStart = Date.now();

  // ① D-day (0~3.3s)
  await cap('01', '수능 D-day 실시간 카운트다운', '남은 일수 · 시:분:초 · 진행 눈금');
  await wait(3200);

  // ② 체크리스트 (3.3~7s)
  await scrollTo('.grid > div > section:nth-of-type(2)', 120);
  await cap('02', '오늘의 체크리스트', '다 끝내면 연속 달성 스트릭 +1');
  await wait(900);
  for (let i = 0; i < 4; i++) { await tap(`#todo li:nth-child(${i + 1}) label`); await wait(430); }
  await wait(900);

  // ③ 순공 히트맵 (7~10.8s)
  await scrollTo('.study', 70);
  await cap('03', '순공 기록 히트맵', '하루 공부 시간을 칸마다 기록');
  await wait(900);
  await page.evaluate(() => { const s = document.querySelector('.hm-scroll');
    const r = document.querySelector('#hm rect[data-d="' + document.getElementById('hmDate').value + '"]');
    s.scrollTo({ left: r ? r.getBBox().x - s.clientWidth + 90 : 0, behavior: 'smooth' }); });
  await tap('#hmHours');
  await page.keyboard.type('7.5', { delay: 120 });
  await wait(250);
  await tap('#hmSave');
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await wait(1500);

  // ④ 성적 추이 (10.8~14s)
  await scrollTo('.scores', 70);
  await cap('04', '성적 추이 그래프', '모의고사 · 내신 과목별 등급/백분위');
  await wait(800);
  const cb = await page.locator('#chart').boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.5);
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(cb.x + cb.width * (0.2 + 0.7 * i / 12), cb.y + cb.height * 0.5);
    await wait(60);
  }
  await wait(500);
  await tap('#fMetric [data-v="pct"]');
  await wait(1200);

  // 엔딩 (14~15.5s)
  await page.evaluate(() => { document.getElementById('cap').classList.remove('on');
    document.getElementById('end').classList.add('on'); });
  await wait(1600);

  capturing = false; await capLoop;
  fs.mkdirSync(OUT, { recursive: true });
  const tEnd = Date.now() / 1000;
  let list = '';
  frames.forEach((f, i) => {
    const fn = path.join(OUT, 'f' + String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(fn, Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : tEnd;
    list += `file '${fn}'\nduration ${(next - f.t).toFixed(4)}\n`;
  });
  list += `file '${path.join(OUT, 'f' + String(frames.length - 1).padStart(5, '0') + '.jpg')}'\n`;
  fs.writeFileSync(path.join(OUT, 'list.txt'), list);
  console.log('frames', frames.length);
  console.log('trim_start', ((tStart - t0) / 1000).toFixed(2), 'scene_len', ((Date.now() - tStart) / 1000).toFixed(2));
  await page.close();
  await ctx.close();
  await browser.close();
})();
