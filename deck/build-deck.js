/**
 * 탕부하나님 레드라인 — 발표자료(.pptx) 생성기
 *
 *   node deck/build-deck.js
 *
 * 앱과 같은 팔레트(어두운 바탕 + 앰버 + 레드)를 쓰고, 한 장마다
 * 레이아웃을 달리한다. 강조색(레드)은 장당 한 군데에만 쓴다.
 */
const path = require('path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Fi = require('react-icons/fi');

/* ---------- 팔레트 ---------- */
const INK   = '0C0A08';  // 바탕
const SURF  = '1B1611';  // 카드
const SURF2 = '241D16';  // 카드(밝은 쪽)
const LINE  = '3A3129';
const TEXT  = 'F4F0EA';
const MUTED = '9C9186';
const FAINT = '6A6058';
const AMBER = 'FFA51F';
const RED   = 'FF4438';
const AMBER_WASH = '2B1E0B';

const FONT = 'Malgun Gothic';   // 윈도우·맥 오피스에 기본 포함된 한글 서체
const W = 13.3, H = 7.5;        // LAYOUT_WIDE

/* ---------- 아이콘: react-icons → PNG(base64) ---------- */
const iconCache = new Map();
async function icon(name, color = AMBER, px = 256) {
  const key = name + color + px;
  if (iconCache.has(key)) return iconCache.get(key);
  const svg = renderToStaticMarkup(
    React.createElement(Fi[name], { color: '#' + color, size: px, strokeWidth: 1.8 })
  );
  const png = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  const data = 'image/png;base64,' + png.toString('base64');
  iconCache.set(key, data);
  return data;
}

/* ---------- 반복 요소 ---------- */
function bg(slide) { slide.background = { color: INK }; }

/** 장 번호(앰버 원) + 분류 라벨 + 제목 */
function head(slide, no, label, title, redWord) {
  slide.addShape('ellipse', { x: 0.75, y: 0.6, w: 0.44, h: 0.44, fill: { color: AMBER_WASH }, line: { color: AMBER, width: 1 } });
  slide.addText(no, { x: 0.75, y: 0.6, w: 0.44, h: 0.44, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontFace: FONT, fontSize: 12, bold: true, color: AMBER });
  slide.addText(label, { x: 1.33, y: 0.6, w: 6, h: 0.44, isTextBox: true, margin: 0,
    valign: 'middle', fontFace: FONT, fontSize: 13, bold: true, color: MUTED });

  const runs = [];
  if (redWord && title.includes(redWord)) {
    const [a, b] = title.split(redWord);
    if (a) runs.push({ text: a, options: { color: TEXT } });
    runs.push({ text: redWord, options: { color: RED } });
    if (b) runs.push({ text: b, options: { color: TEXT } });
  } else {
    runs.push({ text: title, options: { color: TEXT } });
  }
  slide.addText(runs, { x: 0.75, y: 1.18, w: 11.8, h: 0.9, isTextBox: true, margin: 0,
    valign: 'middle', fontFace: FONT, fontSize: 36, bold: true });
}

/** 카드 바탕 */
function card(slide, x, y, w, h, tint) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.12,
    fill: { color: tint || SURF }, line: { color: LINE, width: 1 } });
}

async function build() {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';            // 반드시 슬라이드 추가 전에
  pres.author = '탕부하나님 레드라인';
  pres.title = '탕부하나님 레드라인 — 앱 소개';

  /* ======================= 01 표지 ======================= */
  {
    const s = pres.addSlide(); bg(s);

    // 오른쪽 여백의 추상 도형: 비어 있던 자리와, 돌아와 앉은 점
    s.addShape('ellipse', { x: 8.55, y: 1.55, w: 4.1, h: 4.1, fill: { color: INK }, line: { color: LINE, width: 1.5 } });
    s.addShape('ellipse', { x: 9.35, y: 2.35, w: 2.5, h: 2.5, fill: { color: SURF }, line: { color: AMBER, width: 1, transparency: 55 } });
    s.addShape('ellipse', { x: 10.28, y: 3.28, w: 0.64, h: 0.64, fill: { color: RED }, line: { color: RED, width: 1 } });

    s.addText('수험생을 위한 매일 묵상', { x: 0.75, y: 1.5, w: 7.3, h: 0.35, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 13, bold: true, color: AMBER });

    s.addText([
      { text: '탕부하나님', options: { color: TEXT, breakLine: true } },
      { text: '레드라인', options: { color: RED } },
    ], { x: 0.75, y: 2.05, w: 7.5, h: 2.3, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 54, bold: true, lineSpacing: 62 });

    s.addText('하루 한 장. 오늘 붙들 문장 하나면 충분합니다.', {
      x: 0.75, y: 4.5, w: 7.3, h: 0.4, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 17, color: MUTED });

    const pills = ['Android', 'Windows', 'Web', '오프라인 100%'];
    let px = 0.75;
    pills.forEach(t => {
      const w = 0.42 + t.length * (/[가-힣]/.test(t) ? 0.17 : 0.098);
      s.addShape('roundRect', { x: px, y: 5.35, w, h: 0.46, rectRadius: 0.23,
        fill: { color: SURF }, line: { color: LINE, width: 1 } });
      s.addText(t, { x: px, y: 5.35, w, h: 0.46, isTextBox: true, margin: 0,
        align: 'center', valign: 'middle', fontFace: FONT, fontSize: 12, color: MUTED });
      px += w + 0.16;
    });

    s.addText('github.com/rladpcks23-crypto/Qudtls123', {
      x: 0.75, y: 6.5, w: 7, h: 0.3, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 11, color: FAINT });

    s.addNotes('수험생을 위한 묵상 앱입니다. 오늘 하루를 붙드는 한 장, 그리고 읽은 자리에 남는 빨간 줄. 안드로이드·윈도우·웹 세 곳에서 같은 내용으로 돌아갑니다.');
  }

  /* ======================= 02 왜 만들었나 ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '01', '왜 만들었나', '공부는 길고, 마음은 그보다 먼저 지친다.', '먼저');

    s.addText(
      '진도표는 늘어나는데 버틸 힘이 먼저 바닥납니다. 계획을 더 촘촘히 짜는 것으로는 ' +
      '해결되지 않습니다. 필요한 것은 더 긴 목록이 아니라, 오늘 하루를 버티게 하는 문장 하나입니다.',
      { x: 0.75, y: 2.5, w: 6.5, h: 1.6, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 16, color: MUTED, lineSpacing: 28 });

    s.addText([
      { text: '고를 필요 없이', options: { color: MUTED, breakLine: true } },
      { text: '오늘 것만 펴면 된다.', options: { color: TEXT } },
    ], { x: 0.75, y: 4.75, w: 6.5, h: 1.4, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 26, bold: true, lineSpacing: 40 });

    card(s, 8.0, 2.5, 4.55, 4.15, SURF);
    s.addText('앱이 매일 건네는 말', { x: 8.45, y: 2.95, w: 3.65, h: 0.3, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 12, bold: true, color: AMBER });
    s.addText('내일의 종이 아니라,\n오늘을 사는 아들이 산다.', {
      x: 8.45, y: 3.6, w: 3.65, h: 1.7, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 22, bold: true, color: TEXT, lineSpacing: 34 });
    s.addText('앱에 실린 묵상 한 편에서', { x: 8.45, y: 5.95, w: 3.65, h: 0.3, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 12, color: FAINT });

    s.addNotes('수험 생활은 길고, 대개 체력보다 마음이 먼저 떨어집니다. 계획표를 더 늘리는 대신 하루 한 장으로 좁혔습니다.');
  }

  /* ======================= 03 앱이 하는 일 (2x2) ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '02', '앱이 하는 일', '네 가지만 합니다.');

    const items = [
      ['FiBookOpen',  '오늘의 한 장',   '날짜에 맞춰 묵상 한 편이 열립니다. 고를 필요 없이 오늘 것만 펴면 됩니다.'],
      ['FiEdit3',     '레드라인 진도',   '읽은 자리에 빨간 줄이 남습니다. 끊겨도 그 자리에서 다시 이어집니다.'],
      ['FiKey',       '백업 코드',      '기기를 바꿔도 코드 한 줄이면 그대로. 계정도 로그인도 없습니다.'],
      ['FiMoon',      '눈에 맞는 화면',  '새벽에도 자습실에서도. 라이트·다크가 시스템 설정을 따라갑니다.'],
    ];
    const xs = [0.75, 6.95], ys = [2.25, 4.65];
    for (let i = 0; i < items.length; i++) {
      const [ic, title, body] = items[i];
      const x = xs[i % 2], y = ys[Math.floor(i / 2)];
      card(s, x, y, 5.6, 2.3, SURF);
      s.addShape('ellipse', { x: x + 0.4, y: y + 0.42, w: 0.66, h: 0.66, fill: { color: AMBER_WASH }, line: { color: LINE, width: 1 } });
      s.addImage({ data: await icon(ic), x: x + 0.555, y: y + 0.575, w: 0.35, h: 0.35 });
      s.addText(title, { x: x + 1.25, y: y + 0.4, w: 4, h: 0.4, isTextBox: true, margin: 0,
        valign: 'middle', fontFace: FONT, fontSize: 19, bold: true, color: TEXT });
      s.addText(body, { x: x + 1.25, y: y + 0.92, w: 3.95, h: 0.95, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 13.5, color: MUTED, lineSpacing: 21 });
    }
    s.addNotes('기능을 넷으로 줄였습니다. 매일 한 편, 진도 표시, 백업 코드, 화면 테마. 더 넣지 않는 것이 이 앱의 방침입니다.');
  }

  /* ======================= 04 레드라인 (비교) ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '03', '이름이 된 기능', '읽은 자리에 줄이 남는다.');

    const cols = [
      ['흔한 진도표', MUTED, SURF, [
        '하루를 놓치면 표 전체가 무너진 것처럼 보인다',
        '어디까지 했는지 매번 다시 세어야 한다',
        '기기를 바꾸면 기록이 사라진다',
      ]],
      ['레드라인', AMBER, SURF2, [
        '놓친 날이 있어도 읽은 자리는 그대로 남는다',
        '펴는 순간 어디까지 왔는지 바로 보인다',
        '백업 코드 한 줄로 그대로 옮겨진다',
      ]],
    ];
    cols.forEach(([title, accent, fill, rows], i) => {
      const x = 0.75 + i * 6.1;
      card(s, x, 2.25, 5.7, 4.25, fill);
      s.addText(title, { x: x + 0.45, y: 2.6, w: 4.8, h: 0.4, isTextBox: true, margin: 0,
        valign: 'middle', fontFace: FONT, fontSize: 20, bold: true, color: accent });
      rows.forEach((t, j) => {
        const y = 3.45 + j * 0.95;
        s.addShape('ellipse', { x: x + 0.45, y: y + 0.22, w: 0.16, h: 0.16,
          fill: { color: i ? AMBER : FAINT }, line: { color: i ? AMBER : FAINT, width: 1 } });
        s.addText(t, { x: x + 0.78, y, w: 4.5, h: 0.6, isTextBox: true, margin: 0,
          valign: 'middle', fontFace: FONT, fontSize: 14, color: i ? TEXT : MUTED, lineSpacing: 21 });
      });
    });
    s.addNotes('탕자가 아니라 진도 이야기입니다. 하루를 빠뜨려도 이미 읽은 자리는 그대로 남기 때문에, 다시 펴는 문턱이 낮습니다.');
  }

  /* ======================= 05 숫자로 ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '04', '숫자로', '가볍게, 그러나 끝까지.');

    const stats = [
      ['365', '', '하루 한 편, 1년치 묵상'],
      ['3', '', '안드로이드 · 윈도우 · 웹'],
      ['0', '', '필요한 계정 수'],
      ['100', '%', '오프라인에서 동작'],
    ];
    stats.forEach(([v, unit, k], i) => {
      const x = 0.75 + i * 3.02;
      card(s, x, 2.55, 2.8, 3.1, SURF);
      s.addText([
        { text: v, options: { fontSize: 54, bold: true, color: AMBER } },
        { text: unit, options: { fontSize: 24, bold: true, color: MUTED } },
      ], { x: x + 0.35, y: 3.1, w: 2.1, h: 1.0, isTextBox: true, margin: 0,
        valign: 'middle', fontFace: FONT });
      s.addText(k, { x: x + 0.35, y: 4.45, w: 2.15, h: 0.85, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 13, color: MUTED, lineSpacing: 20 });
    });

    s.addText('계정도, 결제도, 인터넷 연결도 없이 돌아갑니다. 설치하면 그날부터 끝까지.', {
      x: 0.75, y: 6.1, w: 11.5, h: 0.4, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 14, color: FAINT });

    s.addNotes('계정이 없다는 점이 핵심입니다. 로그인 절차가 없으니 설치하고 바로 읽기 시작할 수 있고, 인터넷이 끊긴 자습실에서도 그대로 열립니다.');
  }

  /* ======================= 06 이름의 뜻 (흐름도) ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '05', '이름의 뜻', '기다리다 달려오신 아버지', '달려오신');

    // 떠남(높음) → 바닥(낮음) → 돌아섬 → 잔치(가장 높음)
    const pts = [
      { x: 1.55,  y: 3.35, label: '떠남',   sub: '받은 것을 들고 멀리' },
      { x: 4.65,  y: 4.75, label: '바닥',   sub: '가진 것이 다 떨어진 자리' },
      { x: 7.95,  y: 3.95, label: '돌아섬', sub: '아직 거리가 멀었는데' },
      { x: 11.25, y: 2.95, label: '잔치',   sub: '아버지가 먼저 달려와' },
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      s.addShape('line', {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
        line: { color: i === 2 ? RED : LINE, width: i === 2 ? 3 : 2 },
        flipH: b.x < a.x, flipV: b.y < a.y,
      });
    }
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      s.addShape('ellipse', { x: p.x - 0.19, y: p.y - 0.19, w: 0.38, h: 0.38,
        fill: { color: INK }, line: { color: last ? RED : AMBER, width: last ? 3 : 2 } });
      s.addText(p.label, { x: p.x - 1.15, y: p.y - 0.95, w: 2.3, h: 0.35, isTextBox: true, margin: 0,
        align: 'center', fontFace: FONT, fontSize: 16, bold: true, color: last ? TEXT : MUTED });
      s.addText(p.sub, { x: p.x - 1.35, y: p.y + 0.3, w: 2.7, h: 0.35, isTextBox: true, margin: 0,
        align: 'center', fontFace: FONT, fontSize: 12, color: FAINT });
    });

    s.addText(
      '탕부(蕩父) — 아들에게 아낌없이 쏟아붓는 아버지. 돌아오는 아들을 보고 먼저 달려간 쪽은 아버지였습니다. ' +
      '공부가 안 된 날에도 자리는 그대로 있습니다.',
      { x: 0.75, y: 6.05, w: 11.5, h: 0.8, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 14, color: MUTED, lineSpacing: 22 });

    s.addNotes('보통 탕자의 비유라고 부르지만, 이 앱은 아버지 쪽에 이름을 붙였습니다. 달려온 것은 아들이 아니라 아버지였다는 것이 앱 전체의 어조입니다.');
  }

  /* ======================= 07 하루 쓰는 법 ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '06', '하루 쓰는 법', '앉아서 3분.');

    const steps = [
      ['FiSmartphone', '앱을 연다',        '오늘 날짜의 한 편이 이미 펴져 있습니다. 찾을 것이 없습니다.'],
      ['FiBookOpen',   '한 장을 읽는다',    '말씀 한 구절과 짧은 글 한 편. 길어야 3분입니다.'],
      ['FiCheckCircle','줄이 남는다',       '읽고 나오면 그 자리에 빨간 줄. 내일은 그다음이 열립니다.'],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [ic, title, body] = steps[i];
      const y = 2.35 + i * 1.42;
      s.addShape('ellipse', { x: 0.85, y: y + 0.12, w: 0.78, h: 0.78, fill: { color: AMBER_WASH }, line: { color: LINE, width: 1 } });
      s.addImage({ data: await icon(ic), x: 1.04, y: y + 0.31, w: 0.4, h: 0.4 });
      s.addText(String(i + 1).padStart(2, '0'), { x: 1.95, y: y + 0.08, w: 0.7, h: 0.35, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 12, bold: true, color: AMBER });
      s.addText(title, { x: 2.65, y: y + 0.05, w: 3.2, h: 0.42, isTextBox: true, margin: 0,
        valign: 'middle', fontFace: FONT, fontSize: 20, bold: true, color: TEXT });
      s.addText(body, { x: 2.65, y: y + 0.55, w: 6.4, h: 0.45, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 14, color: MUTED });
    }

    card(s, 9.25, 2.35, 3.3, 4.15, SURF);
    s.addText('기기를 바꿀 때', { x: 9.65, y: 2.7, w: 2.6, h: 0.32, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 12, bold: true, color: AMBER });
    s.addText('설정에서 백업 코드를 복사해 두고, 새 기기에서 붙여넣으면 진도가 그대로 따라옵니다.', {
      x: 9.65, y: 3.2, w: 2.55, h: 1.7, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 13.5, color: MUTED, lineSpacing: 22 });
    s.addText('계정 없음\n로그인 없음\n광고 없음', { x: 9.65, y: 5.1, w: 2.55, h: 1.1, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 13, color: FAINT, lineSpacing: 22 });

    s.addNotes('쓰는 절차가 짧아야 매일 열립니다. 앱을 열면 오늘 것이 이미 펴져 있고, 읽고 나오면 진도가 자동으로 남습니다.');
  }

  /* ======================= 08 받는 곳 ======================= */
  {
    const s = pres.addSlide(); bg(s);
    head(s, '07', '받는 곳', '세 곳 모두 같은 내용입니다.');

    const plats = [
      ['FiSmartphone', 'Android', 'APK 설치',        '저장소 릴리스에서 APK를 내려받아 설치합니다.'],
      ['FiMonitor',    'Windows', '실행 파일',        '설치 없이 바로 실행되는 포터블 파일입니다.'],
      ['FiGlobe',      'Web',     '브라우저로 열기',   'HTML 한 장이라 링크만 있으면 열립니다.'],
    ];
    for (let i = 0; i < plats.length; i++) {
      const [ic, name, mode, body] = plats[i];
      const x = 0.75 + i * 4.02;
      card(s, x, 2.35, 3.8, 3.5, SURF);
      s.addShape('ellipse', { x: x + 0.45, y: 2.75, w: 0.8, h: 0.8, fill: { color: AMBER_WASH }, line: { color: LINE, width: 1 } });
      s.addImage({ data: await icon(ic), x: x + 0.655, y: 2.955, w: 0.39, h: 0.39 });
      s.addText(name, { x: x + 0.45, y: 3.75, w: 2.9, h: 0.4, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 20, bold: true, color: TEXT });
      s.addText(mode, { x: x + 0.45, y: 4.2, w: 2.9, h: 0.32, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 13, bold: true, color: AMBER });
      s.addText(body, { x: x + 0.45, y: 4.65, w: 2.9, h: 0.95, isTextBox: true, margin: 0,
        fontFace: FONT, fontSize: 13.5, color: MUTED, lineSpacing: 21 });
    }
    s.addText('진도와 설정은 기기마다 따로 저장되며, 백업 코드로 옮길 수 있습니다.', {
      x: 0.75, y: 6.15, w: 11.5, h: 0.35, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 13, color: FAINT });

    s.addNotes('세 플랫폼 모두 같은 내용입니다. 웹 버전은 파일 하나라 링크만으로 열 수 있어서, 급할 때 가장 빠릅니다.');
  }

  /* ======================= 09 마무리 ======================= */
  {
    const s = pres.addSlide(); bg(s);
    s.addShape('ellipse', { x: 9.35, y: 1.85, w: 3.5, h: 3.5, fill: { color: INK }, line: { color: LINE, width: 1.5 } });
    s.addShape('ellipse', { x: 10.05, y: 2.55, w: 2.1, h: 2.1, fill: { color: SURF }, line: { color: AMBER, width: 1, transparency: 55 } });
    s.addShape('ellipse', { x: 10.83, y: 3.33, w: 0.54, h: 0.54, fill: { color: RED }, line: { color: RED, width: 1 } });

    s.addText('마무리', { x: 0.9, y: 1.35, w: 6, h: 0.35, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 13, bold: true, color: AMBER });

    s.addText([
      { text: '내일의 종이 아니라,', options: { color: TEXT, breakLine: true } },
      { text: '오늘을 사는 아들로.', options: { color: RED } },
    ], { x: 0.9, y: 1.95, w: 8.4, h: 1.9, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 40, bold: true, lineSpacing: 56 });

    card(s, 0.9, 4.15, 8.4, 1.75, SURF);
    s.addText('오직 여호와를 앙망하는 자는 새 힘을 얻으리니\n독수리가 날개치며 올라감 같을 것이요', {
      x: 1.35, y: 4.45, w: 7.5, h: 0.85, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 16, bold: true, color: TEXT, lineSpacing: 26 });
    s.addText('이사야 40:31', { x: 1.35, y: 5.4, w: 7.5, h: 0.3, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 12, color: AMBER });

    s.addText('탕부하나님 레드라인 · 하루 한 장', {
      x: 0.9, y: 6.35, w: 8, h: 0.35, isTextBox: true, margin: 0,
      fontFace: FONT, fontSize: 12, color: FAINT });

    s.addNotes('끝맺음 문장입니다. 수험 기간을 "내일을 위해 참는 시간"이 아니라 오늘로 보자는 것이 앱 전체의 메시지입니다.');
  }

  const out = path.join(__dirname, 'tangbu-redline-deck.pptx');
  await pres.writeFile({ fileName: out });
  console.log('wrote ' + out);
}

build().catch(e => { console.error(e); process.exit(1); });
