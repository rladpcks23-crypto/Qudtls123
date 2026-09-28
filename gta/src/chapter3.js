'use strict';
/* =====================================================================
 * chapter3.js — 3부 "왕관의 대가" (v2.20, 미션 27~32)
 *
 *  2부 끝에 '네온의 왕'이 된 뒤의 이야기. 무대는 레드 카운티.
 *  즉위 파티 습격 → 카운티 민병대 → 호수의 거래 → 실버 피크 정상의 배신(산길) → 다리 봉쇄 → 마지막 선택
 *  2부의 선택(윤/한)에 따라 대사가 달라지고, 30장(조니)과 32장(합법 제국/지하 왕국)에서 다시 고른다.
 *  의뢰인 마커는 카운티 마을들에 있다.
 * ===================================================================== */

const side2 = () => Story.flags.side === 'han';
const CH3 = [
  stepsDef({
    title: '27. 왕관의 무게', reward: 150000,
    intro: [['조니 박', '형님, 아니 이제 "왕"이라고 불러야 하나? 오늘 밤 나이트클럽에서 즉위 파티예요!'], ['조니 박', '도시 거물들이 다 온대요. 근데… 로터스 잔당이 복수한다는 소문이 있어요.']],
    outro: [['조니 박', '파티는 망쳤지만 살아남았네요. 근데 저 놈들, 카운티 쪽에서 왔대요.']],
    steps: [
      { t: 'cut', lines: () => side2() ? [['형사 한', '왕이라… 경찰청 서류엔 아직 네 이름이 깨끗하게 남아 있다. 그걸 지키라고.']] : [['마담 윤', '네가 왕이면 난 뭐지? 여왕? 좋아, 오늘은 축하만 하자.']] },
      { t: 'go', at: () => placeOr('biz_club', 0.5, 0.45), text: '네온 나이트클럽 즉위 파티로', r: 10 },
      { t: 'survive', sec: 40, stay: 35, gang: 'lotus', per: 4, text: '로터스 잔당의 습격을 버텨라' },
    ],
  }),
  stepsDef({
    title: '28. 카운티의 그림자', reward: 180000,
    intro: [['행크 모건', '도시의 왕이 여기까지 왔군. 레드 메사에 "민병대"가 생겼어. 네 놈 이름을 걸고 도시를 치겠다더군.'], ['행크 모건', '보안관 배지는 저 사막에선 종잇장이야. 자네 방식으로 처리하게.']],
    outro: [['행크 모건', '민병대장 콜트… 누가 돈을 댔는지 서류가 나왔군. 도시 사람이야.']],
    steps: [
      { t: 'go', at: () => World.places.c_hank ? sidewalkNear(World.places.c_hank.x, World.places.c_hank.y, 4) : cty(720, 304), text: '레드 록의 보안관 행크에게', r: 8 },
      { t: 'kill', at: () => cty(760, 470), n: 7, gang: 'iron', weapon: 'rifle', boss: '민병대장 콜트', text: '레드 메사 민병대를 쓸어버려라' },
      { t: 'pick', at: () => cty(764, 472), text: '돈줄이 적힌 서류를 챙겨라' },
    ],
  }),
  stepsDef({
    title: '29. 호수의 거래', reward: 200000,
    intro: [['조니 박', '서류에 나온 이름이… 솔트 레이크에서 오늘 밤 거래를 한대요. 무기랑 돈이 오간다고.'], ['조니 박', '먼저 도망치는 놈부터 잡아요!']],
    outro: [['조니 박', '와… 그 돈 전부 시청 계좌로 가는 거였어요. 누가 우리 뒤통수를 치려는 거죠?']],
    steps: [
      { t: 'go', at: () => cty(1122, 335), text: '솔트 레이크 동쪽 호숫가로', r: 14 },
      { t: 'chase', type: VTYPES.pickup ? 'pickup' : 'muscle', color: '#15151a', near: () => cty(1150, 330), text: '달아나는 거래 트럭을 부숴라' },
      { t: 'kill', at: () => cty(1118, 350), n: 6, gang: 'lotus', text: '호숫가의 거래 경비를 처리하라' },
      { t: 'evade', stars: 3, text: '보안관 추격을 따돌려라' },
    ],
  }),
  stepsDef({
    title: '30. 정상의 배신', reward: 250000,
    intro: [['익명 문자', '"실버 피크 정상. 혼자 와라. 네 옆의 쥐가 누군지 알려 주지."']],
    outro: [['행크 모건', '산 위에서 총소리가 났다더군… 무사한가?']],
    steps: [
      { t: 'go', at: () => cty(975, 112), text: '실버 피크 정상으로 — 산길(숲길 옆 입구)로 올라가라', r: 16 },
      { t: 'survive', sec: 45, stay: 30, gang: 'lotus', per: 3, weapon: ['rifle', 'smg'], text: '정상 매복을 버텨라' },
      { t: 'cut', lines: [['조니 박', '…미안해요, 형님. 로터스가 제 동생을 잡고 있었어요. 전부 제가 흘렸어요.'], ['조니 박', '쏘려면 쏴요. 도망 안 가요.']] },
      { t: 'choice', flag: 'johnny', q: '조니를 어떻게 할까?', opts: [['spare', '살려 보낸다 — 동생을 찾게 해 준다'], ['end', '끝낸다 — 배신은 배신이다']] },
      { t: 'cut', lines: () => Story.flags.johnny === 'spare' ? [['조니 박', '…평생 잊지 않을게요.'], ['네온 하버', '조니는 산 아래로 사라졌다.']] : [['네온 하버', '총성이 산을 울렸다. 정상엔 바람 소리만 남았다.']] },
    ],
  }),
  stepsDef({
    title: '31. 다리 봉쇄', reward: 300000,
    intro: [['형사 한', '시청이 널 "도시의 적"으로 발표했다. 남쪽 다리가 막힌다. 특수부대까지 나왔어.'], ['마담 윤', '다리를 건너오지 못하면 끝이야. 카운티에 갇히지 마!']],
    outro: [['마담 윤', '건넜구나… 도시는 이제 널 무서워해. 그게 왕관의 값이야.']],
    steps: [
      { t: 'go', at: () => { const bs = World.nodes[(World.countyInfo || {}).bridges ? World.countyInfo.bridges[1] : 0]; return bs ? { x: (bs.x + 700 * T) / 2 + 60, y: bs.y + 2 } : cty(700, 480); }, text: '남쪽 다리로', r: 20 },
      { t: 'survive', sec: 50, stay: 45, kind: 'swat', per: 4, text: '다리 위 봉쇄를 버텨라' },
      { t: 'evade', stars: 4, text: '도시 경찰을 따돌려라' },
    ],
  }),
  stepsDef({
    title: '32. 네온의 황제', reward: 1000000,
    intro: [['행크 모건', '모든 돈줄 끝에 한 사람이 있어. 로터스의 수장 "흑련". 샌디 밸리 비행장에서 도시를 뜬대.'], ['마담 윤', '마지막이야. 그리고 그 뒤엔… 네가 어떤 왕이 될지 정해야 해.']],
    outro: [['네온 하버', '— 3부 끝 —']],
    steps: [
      { t: 'choice', flag: 'empire', q: '어떤 왕이 될까?', opts: [['legit', '합법 제국 — 모든 걸 세탁하고 도시의 얼굴이 된다'], ['under', '지하 왕국 — 그림자에서 도시를 쥔다']] },
      { t: 'go', at: () => cty(1020, 574), text: '샌디 밸리 비행장으로', r: 14 },
      { t: 'kill', at: () => cty(1015, 568), n: 8, gang: 'lotus', weapon: ['rifle', 'smg'], boss: '로터스 수장 흑련', text: '흑련과 호위를 쓰러뜨려라' },
      { t: 'cut', lines: () => {
        const legit = Story.flags.empire === 'legit';
        if (legit) { Empire.support.civ += 10; Empire.support.off += 10; } else if (Gangs.mine) Gangs.addRep(500, '지하 왕국');
        return [
          ['네온 하버', legit ? '너는 모든 돈을 세탁했다. 신문엔 "카운티를 살린 기업가"라는 제목이 실렸다.' : '너는 그림자로 돌아갔다. 도시 누구도 네 이름을 입 밖에 내지 않는다.'],
          [side2() ? '형사 한' : '마담 윤', side2() ? (legit ? '깨끗한 왕이라… 네가 처음이군.' : '결국 이 길이군. 다음엔 내가 널 잡으러 간다.') : (legit ? '넥타이가 잘 어울리네. 난 그림자에 남을게.' : '역시 넌 내 사람이야. 도시는 우리 거야.')],
          ['네온 하버', Story.flags.johnny === 'spare' ? '카운티 어딘가에서 조니가 동생과 작은 식당을 열었다는 소문이 들린다.' : '실버 피크 정상엔 이름 없는 돌 하나가 놓였다.'],
          ['네온 하버', '(시민·공무원 지지 또는 조직 평판이 올랐다) — 자유롭게 도시와 카운티를 누비세요.'],
        ];
      } },
    ],
  }),
];
MISSION_DEFS.push(...CH3);

// 3부 의뢰인 마커: 카운티 마을들
{
  const _init = Missions.init.bind(Missions);
  Missions.init = function () {
    _init();
    const base = MISSION_DEFS.length - CH3.length, towns = () => (World.county && World.county.towns) || [];
    const spot = name => { const t = towns().find(q => q.name === name); return t ? sidewalkNear(t.x + rand(-15, 15), t.y + rand(-15, 15), 3) : null; };
    ['샌디 밸리', '레드 록', '골든 필즈', '파인 베이', '레드 록', '샌디 밸리'].forEach((n, i) => { const s = spot(n); if (s) this.givers[base + i] = s; });
  };
}
