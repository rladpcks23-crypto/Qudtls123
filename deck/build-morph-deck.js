/**
 * 모핑 전환(Morph) 예시 덱을 만든다.
 *
 * 파워포인트의 모핑은 "앞 장에 있던 물체가 다음 장에도 있으면, 그 사이를 움직여서
 * 이어준다"는 규칙으로 동작한다. 어떤 물체끼리 짝인지는 도형 이름으로 알려줄 수 있고,
 * 이름을 `!!` 로 시작하면 파워포인트가 그 이름을 짝짓기 기준으로 쓴다.
 * 그래서 여기서는 이어질 물체마다 objectName 에 `!!...` 를 붙인다.
 *
 * 전환 자체(<p:transition><p159:morph/>)는 pptxgenjs 가 못 쓰므로
 * build-morph-deck.sh 가 만들어진 파일의 XML 에 끼워 넣는다.
 */
const path = require('path');
const pptxgen = require('pptxgenjs');

const INK = '0C0A08', SURF = '1B1611', LINE = '3A3129';
const TEXT = 'F4F0EA', MUTED = '9C9186', FAINT = '6A6058';
const AMBER = 'FFA51F', RED = 'FF4438';
const FONT = 'Malgun Gothic';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';                 // 13.3 x 7.5
pres.title = '모핑 전환 예시';

const bg = s => { s.background = { color: INK }; };

/** 장마다 이어지는 빨간 표시. 같은 roundRect 라서 매끄럽게 늘어난다. */
const mark = (s, x, y, w, h, r) => s.addShape('roundRect', {
  x, y, w, h, rectRadius: r, fill: { color: RED }, line: { color: RED, width: 0 },
  objectName: '!!mark',
});
/** 장마다 이어지는 제목 */
const title = (s, txt, o) => s.addText(txt, {
  isTextBox: true, margin: 0, fontFace: FONT, color: TEXT, bold: true,
  objectName: '!!title', ...o,
});
/** 카드 (도형과 글을 한 덩어리로 — 그래야 통째로 모핑된다) */
const card = (s, name, runs, o) => s.addText(runs, {
  isTextBox: true, shape: 'roundRect', rectRadius: 0.12,
  fill: { color: SURF }, line: { color: LINE, width: 1 },
  fontFace: FONT, color: TEXT, align: 'left', valign: 'middle',
  margin: [20, 20, 20, 20], objectName: name, ...o,
});

/* ── 1. 점 하나 ─────────────────────────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 6.48, 3.42, 0.34, 0.34, 0.17);
  title(s, '레드라인', { x: 4.9, y: 4.0, w: 3.5, h: 0.4, fontSize: 13, bold: false,
    color: MUTED, align: 'center' });
  s.addText('모핑 전환 예시 · 스페이스바로 넘기세요', {
    x: 0, y: 6.7, w: 13.3, h: 0.4, isTextBox: true, margin: 0,
    align: 'center', fontFace: FONT, fontSize: 11, color: FAINT });
  s.addNotes('작은 점 하나로 시작합니다. 다음 장으로 넘기면 이 점이 커지면서 자리를 옮깁니다 — 새로 나타나는 게 아니라 이어집니다.');
}

/* ── 2. 점이 커진다 ─────────────────────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 8.2, 1.85, 3.8, 3.8, 1.9);
  title(s, '탕부하나님\n레드라인', { x: 0.9, y: 2.4, w: 6.8, h: 2.6,
    fontSize: 46, lineSpacing: 58 });
  s.addText('수험생을 위한 매일 묵상', { x: 0.9, y: 1.8, w: 6, h: 0.4,
    isTextBox: true, margin: 0, fontFace: FONT, fontSize: 13, bold: true, color: AMBER });
  s.addNotes('점이 원으로 자라고, 작던 글씨가 제목 크기로 커집니다. 두 물체 모두 앞 장에 있던 것과 같은 물체입니다.');
}

/* ── 3. 원이 줄이 된다 ──────────────────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 0.9, 3.05, 11.5, 0.34, 0.17);
  title(s, '읽은 자리에 줄이 남는다.', { x: 0.9, y: 3.7, w: 11.5, h: 0.9, fontSize: 34 });
  s.addText('하루를 놓쳐도 이미 읽은 자리는 그대로 남습니다.', {
    x: 0.9, y: 4.75, w: 11.5, h: 0.4, isTextBox: true, margin: 0,
    fontFace: FONT, fontSize: 15, color: MUTED });
  s.addNotes('같은 원이 옆으로 늘어나 줄이 됩니다. 앱 이름이 왜 레드라인인지를 화면이 대신 설명합니다.');
}

/* ── 4. 줄이 올라가고 카드가 놓인다 ─────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 0.9, 6.95, 6.9, 0.09, 0.045);          // 아래쪽 진행 표시로
  title(s, '앱이 하는 일', { x: 0.9, y: 1.15, w: 6, h: 0.6, fontSize: 24 });

  const body = (t, b) => ([
    { text: t, options: { fontSize: 19, bold: true, color: TEXT, align: 'left', breakLine: true } },
    { text: ' ', options: { fontSize: 7, align: 'left', breakLine: true } },
    { text: b, options: { fontSize: 13.5, color: MUTED, align: 'left' } },
  ]);
  card(s, '!!c1', body('오늘의 한 장', '날짜에 맞춰 묵상 한 편이 열립니다.'),
    { x: 0.9, y: 2.5, w: 3.62, h: 2.75 });
  card(s, '!!c2', body('365일', '하루 한 편, 1년치가 들어 있습니다.'),
    { x: 4.84, y: 2.5, w: 3.62, h: 2.75 });
  card(s, '!!c3', body('백업 코드', '기기를 바꿔도 코드 한 줄이면 그대로.'),
    { x: 8.78, y: 2.5, w: 3.62, h: 2.75 });
  s.addNotes('줄이 얇아지며 위로 올라가 제목 밑줄처럼 자리를 잡고, 카드 셋이 들어옵니다.');
}

/* ── 5. 가운데 카드가 화면을 채운다 ─────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 0.9, 6.95, 10.2, 0.09, 0.045);         // 더 차오른다
  title(s, '숫자로', { x: 0.9, y: 1.15, w: 6, h: 0.6, fontSize: 24 });
  card(s, '!!c2', [
    { text: '365', options: { fontSize: 96, bold: true, color: AMBER, align: 'center', breakLine: true } },
    { text: '하루 한 편, 1년치 묵상', options: { fontSize: 17, color: MUTED, align: 'center' } },
  ], { x: 0.9, y: 2.2, w: 11.5, h: 4.1, align: 'center', valign: 'middle' });
  s.addNotes('가운데 카드만 남기고 나머지는 물러납니다. 카드가 커지면서 그 안의 글도 같이 커집니다.');
}

/* ── 6. 마무리 ──────────────────────────────────────────── */
{
  const s = pres.addSlide(); bg(s);
  mark(s, 9.3, 3.3, 3.2, 3.2, 1.6);
  title(s, '하루 한 장.', { x: 0.9, y: 3.2, w: 7.5, h: 1.3, fontSize: 52 });
  s.addText('내일의 종이 아니라, 오늘을 사는 아들로.', {
    x: 0.9, y: 4.6, w: 7.5, h: 0.5, isTextBox: true, margin: 0,
    fontFace: FONT, fontSize: 16, color: MUTED });
  s.addNotes('줄이 다시 원으로 모이면서 처음 점으로 돌아옵니다. 시작과 끝이 같은 물체라 이야기가 닫힙니다.');
}

const out = path.join(__dirname, 'morph-demo.pptx');
pres.writeFile({ fileName: out }).then(() => console.log('wrote ' + out));
