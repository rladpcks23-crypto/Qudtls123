'use strict';
/* =====================================================================
 * sidequest.js — 카운티 의뢰 (v2.18)
 *
 *  레드 록의 '보안관 행크 모건'에게서 받는 지역 미션. 스토리 순서와 따로 언제든 받을 수 있고, 한 번씩 깨면 끝.
 *  Missions.startSide(def)로 시작한다 (스토리 단계 엔진 stepsDef를 그대로 쓴다). 보상 뒤 스토리 진행(idx)은 그대로.
 *  v2.19의 초대형 공사 준비 미션도 이 틀을 쓴다 (SIDE_DEFS에 kind로 구분).
 * ===================================================================== */

const cty = (x, y) => { const [ox, oy] = openSpotNear(x * T, y * T); return { x: ox, y: oy }; }; // 카운티 타일 좌표 → 빈 땅
const SIDE_DEFS = [
  Object.assign(stepsDef({
    title: '카운티 1. 사막의 추적', reward: 40000,
    intro: [['행크 모건', '도시에서 온 친구, 일 좀 하나 하겠나? 사막으로 밀수 픽업이 드나들어.'], ['행크 모건', '내 부하들은 겁쟁이라 못 쫓아. 차를 멈추고, 메사 밑 은신처까지 싹 치워 주게.']],
    outro: [['행크 모건', '이제 좀 조용해지겠군. 카운티는 빚을 잊지 않네.']],
    steps: [
      { t: 'go', at: () => World.places.c_sheriff1 ? sidewalkNear(World.places.c_sheriff1.x, World.places.c_sheriff1.y, 6) : cty(900, 440), text: '샌디 밸리 보안관 사무소로', r: 8 },
      { t: 'chase', type: VTYPES.pickup ? 'pickup' : 'van', color: '#3a3a3a', near: () => cty(860, 500), text: '사막으로 달아나는 밀수 픽업을 부숴라' },
      { t: 'kill', at: () => cty(762, 548), n: 5, gang: 'iron', text: '메사 밑 은신처의 밀수꾼을 처리하라' },
      { t: 'pick', at: () => cty(766, 552), text: '밀수품 가방을 챙겨라' },
    ],
  }), { id: 'c1', kind: 'county' }),
  Object.assign(stepsDef({
    title: '카운티 2. 실버 피크 추격', reward: 50000,
    intro: [['행크 모건', '검은 연꽃 놈들이 블랙우드 숲에 오두막을 잡았다더군.'], ['행크 모건', '파인 베이에서 놈들 차가 목격됐어. 산길로 도망치기 전에 잡아.']],
    outro: [['행크 모건', '숲이 조용해졌군. 사슴들이 고마워할 거야.']],
    steps: [
      { t: 'go', at: () => World.places.c_burger2 ? sidewalkNear(World.places.c_burger2.x, World.places.c_burger2.y, 6) : cty(1300, 60), text: '파인 베이로', r: 10 },
      { t: 'chase', type: 'muscle', color: '#15151a', near: () => cty(1240, 44), text: '산길로 달아나는 검은 연꽃 차를 부숴라' },
      { t: 'kill', at: () => cty(1110, 120), n: 5, gang: 'lotus', text: '블랙우드 숲 오두막의 조직원을 처리하라' },
      { t: 'evade', stars: 2, text: '보안관의 눈을 피해라' },
    ],
  }), { id: 'c2', kind: 'county' }),
  Object.assign(stepsDef({
    title: '카운티 3. 비행장 화물', reward: 60000,
    intro: [['행크 모건', '샌디 밸리 비행장에 코브라 놈들이 화물기를 내렸다. 안에 뭐가 들었든 도시로 가면 안 돼.'], ['행크 모건', '화물 트럭을 뺏어서 파인 베이 부두까지 몰고 오게. 배로 치워 버릴 테니.']],
    outro: [['행크 모건', '훌륭해. 자네 같은 사람이 카운티에 있으면 든든하지.']],
    steps: [
      { t: 'go', at: () => World.places.c_airfield ? cty(1020, 574) : cty(1020, 574), text: '샌디 밸리 비행장으로', r: 12 },
      { t: 'kill', at: () => cty(1015, 568), n: 6, gang: 'cobra', text: '화물을 지키는 코브라 조직원을 처리하라' },
      { t: 'steal', type: 'truck', color: '#e0e0e0', at: () => ({ ...cty(1024, 568), a: 0 }), text: '화물 트럭에 타라' },
      { t: 'deliver', at: () => { const f = (World.county.fish || []).find(q => q.kind === 'pier'); return f ? { x: f.x - 30, y: f.y } : cty(1330, 60); }, timer: 300, text: '파인 베이 부두로 화물을 옮겨라', r: 12, drop: true },
    ],
  }), { id: 'c3', kind: 'county' }),
];

const Side = {
  done: {},
  save() { return { done: this.done }; },
  load(o) { this.done = (o && o.done) || {}; },
};
SaveExt.mods.side = Side;

Missions.startSide = function (def) {
  if (this.active) { UI.toast('다른 미션을 하는 중이다'); return; }
  const go = () => { const m = { def, t: 0, stage: 0, timer: null, blips: [], objective: '', ents: [], kills: 0, side: true }; this.active = m; UI.big(def.title, '의뢰 시작', 2.6, '#f2c14e'); def.start(m); };
  if (typeof Cutscene !== 'undefined' && def.intro && def.intro.length) Cutscene.play([[def.title, '— 카운티 의뢰 —'], ...def.intro], go); else go();
};
{
  const _pass = Missions.pass.bind(Missions);
  Missions.pass = function () {
    const m = this.active;
    if (!m || !m.side) return _pass();
    const P = Game.player, reward = m.def.reward + (m.bonus || 0);
    P.money += reward; this.cleanup(m); this.active = null; this.cool = 3; UI.objective('');
    Side.done[m.def.id] = true; Sfx.passed();
    UI.big('의뢰 성공!', `+$${reward.toLocaleString()}`, 3.5, '#f2c14e');
    if (m.def.outro) setTimeout(() => UI.dialog(m.def.outro), 1800);
    if (m.def.onDone) m.def.onDone();
    Save.write();
  };
}

// 의뢰인: 레드 록 마을 (보안관 행크 모건)
SHOPS.hank = {
  title: '보안관 행크 모건', get sub() { const n = SIDE_DEFS.filter(d => d.kind === 'county' && Side.done[d.id]).length; return `레드 카운티의 골칫거리를 치워 주면 두둑이 준다 · ${n}/3 완료`; },
  items: () => SIDE_DEFS.filter(d => d.kind === 'county').map(d => ({
    id: d.id, name: `${d.title}${Side.done[d.id] ? ' (완료)' : ''}`, price: 0, btn: Side.done[d.id] ? '다시' : '받기', desc: `보상 $${d.reward.toLocaleString()} · ${d.intro[0][1]}`,
    ok: () => !Missions.active, fn: () => { Shop.close(); Missions.startSide(d); },
  })),
};
function placeHank() {
  const W = World; if (W.places.c_hank || !W.county) return;
  const t = (W.county.towns || []).find(q => q.name === '레드 록'); if (!t) return;
  const s = sidewalkNear(t.x + 20, t.y - 10, 4); W.places.c_hank = { x: s.x, y: s.y, label: '보안관 행크 모건 (카운티 의뢰)' };
  EXTRA_PLACES.push(['c_hank', 'hank']); EXTRA_ICONS.push({ key: 'c_hank', ch: '★', c: '#e0a43a', label: '카운티 의뢰 (보안관 행크)' }); PLACE_MARK.c_hank = '#e0a43a';
}
