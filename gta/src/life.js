'use strict';
/* =====================================================================
 * life.js — 휴대폰 · 여자친구 · 업적과 완료율
 *
 *  · 휴대폰(I 키 / 일시정지 메뉴): 연락처(여자친구·조직·정비소·택시·변호사), 문자, 은행, 길 찾기, 날씨, 업적·완료율
 *  · 여자친구 3명(지도 ♥): 만나서 말을 걸고, 전화로 데이트 신청 → 데려가 원하는 곳까지 태워 주면 호감도↑.
 *    호감도 30: 그녀 집에서 쉬기(체력·저장) · 60: 하루 한 번 수배 -2 부탁 · 90: 무기·방탄복 보급 · 100: 전용 옷
 *    선물(꽃 $500·목걸이 $5,000)로도 호감도가 오르고, 오래 연락하지 않으면 조금씩 떨어진다.
 *  · 업적 24개 · 완료율 100%(스토리·꾸러미·점프·레이스·사업체·직업·이벤트·연애…) — 100%면 $1,000,000 + 무한 탄약
 * ===================================================================== */

// ---------- 여자친구 ----------
const GF_DEFS = [
  { id: 'seoyeon', name: '서연', job: '카페 바리스타', skin: '#f6dccb', hair: '#2a1a14', dress: '#f07aa0', hairStyle: 'long', lip: '#d4466a', earring: '#f2d479', shoe: '#f2f2f2', likes: '빠른 차', spot: 'biz_cafe', car: ['sports', 'super', 'hyper'], venue: ['biz_bistro', 'biz_towerview', 'biz_opera'] },
  { id: 'hana', name: '하나', job: '피트니스 트레이너', skin: '#efcaa8', hair: '#7a4222', dress: '#3fd0c2', hairStyle: 'ponytail', lip: '#e0566c', earring: '#ffffff', shoe: '#ffffff', likes: '운동·해변', spot: 'gym', car: ['muscle', 'bike'], venue: ['biz_surf', 'biz_bar', 'biz_golf'] },
  { id: 'mina', name: '미나', job: '갤러리 큐레이터', skin: '#f8e1d2', hair: '#141418', dress: '#8a63ff', hairStyle: 'bob', lip: '#b8284e', earring: '#e8e8f0', necklace: '#f2d479', shoe: '#1a1a1a', likes: '고급스러운 것', spot: 'biz_gallery', car: ['hyper', 'super', 'sedan'], venue: ['biz_club', 'biz_hotel', 'biz_dept'] },
];
const GF = {
  st: {}, date: null, npcs: {}, cool: 0, favorDay: -1,
  save() { return { st: this.st, favorDay: this.favorDay }; },
  load(o) { this.st = (o && o.st) || {}; this.favorDay = (o && o.favorDay) ?? -1; this.date = null; this.npcs = {}; },
  s(id) { return this.st[id] || (this.st[id] = { met: false, love: 0, lastDay: 0, dates: 0 }); },
  home(d) { const q = World.places[d.spot] || World.places.safehouse; return q; },
  best() { let b = null; for (const d of GF_DEFS) { const s = this.s(d.id); if (s.met && (!b || s.love > this.s(b.id).love)) b = d; } return b; },
  // 그녀들은 자기 장소 앞에 서 있다 (가까이 가면 생긴다)
  update(dt) {
    const P = Game.player; this.cool -= dt;
    for (const d of GF_DEFS) {
      const h = this.home(d); if (!h) continue;
      let n = this.npcs[d.id];
      const near = dist(P.px, P.py, h.x, h.y) < 90 && !(this.date && this.date.def === d && this.date.stage !== 'pick');
      if (near && (!n || !Game.peds.includes(n) || n.dead)) {
        const s = sidewalkNear(h.x, h.y, 6); // 가게 문(상점 마커)에서 조금 떨어져 선다
        n = this.npcs[d.id] = spawnPed('civ', s.x, s.y);
        Object.assign(n, { persistent: true, state: 'idle', female: true, dress: true, gf: d.id, skin: d.skin, hair: d.hair, shirt: d.dress, pants: d.dress, hairStyle: d.hairStyle, lip: d.lip, earring: d.earring, necklace: d.necklace, shoe: d.shoe, hp: 60, nameTag: `♥ ${d.name}`, invuln: true, walkSpeed: 1.1 });
      } else if (!near && n && Game.peds.includes(n)) { n.remove = true; this.npcs[d.id] = null; }
      if (n && !n.dead && !P.car && dist(P.x, P.y, n.x, n.y) < 2.2 && this.cool <= 0 && Game.state === 'play') { this.cool = 5; this.talk(d, n); }
    }
    // 하루가 지나면 연락 안 한 만큼 호감도가 준다
    for (const d of GF_DEFS) { const s = this.s(d.id); if (s.met && Gangs.day - s.lastDay > 3 && s.love > 10) { s.love -= 5; s.lastDay = Gangs.day - 2; Msgs.add(d.name, pick(['요즘 왜 연락이 없어?', '바빠? 나 좀 서운해…', '보고 싶다. 전화해 줘.'])); } }
    if (this.date) this.updateDate(dt);
  },
  talk(d, n) {
    const s = this.s(d.id);
    if (!s.met) { s.met = true; s.lastDay = Gangs.day; s.love = 10; UI.dialog([[d.name, `안녕하세요? 저는 ${d.name}, ${d.job}이에요.`], [d.name, `${d.likes}을(를) 좋아해요. 휴대폰(I)으로 연락 주세요!`]]); Msgs.add(d.name, '오늘 반가웠어요 :) 데이트 신청은 언제든지!'); Save.write(); return; }
    Talk.say(n, pick([`${Game.player.money > 1e6 ? '오늘 멋있다!' : '왔어?'}`, '데이트 언제 해?', '보고 싶었어']), 2.5, true);
  },
  love(d, n, why) { const s = this.s(d.id); const before = s.love; s.love = clamp(s.love + n, 0, 100); s.lastDay = Gangs.day; if (why) UI.toast(`${d.name} 호감도 ${n > 0 ? '+' : ''}${n} (${why}) — ${Math.round(s.love)}/100`); for (const [k, t] of [[30, '그녀 집에서 쉴 수 있다 (연락처 → 집에 가기)'], [60, '하루 한 번 수배를 줄여 달라고 부탁할 수 있다'], [90, '무기·방탄복을 챙겨 준다'], [100, '전용 옷을 선물받았다']]) if (before < k && s.love >= k) { UI.big(`${d.name}와(과)의 사이가 깊어졌다`, t, 3, '#ff7fb0'); if (k === 100) Game.player.gfOutfit = d.dress; } },
  askDate(d) {
    if (this.date) { UI.toast('이미 데이트 중이다'); return; }
    if (Missions.active || Races.cur) { UI.toast(`${d.name}: 지금 바쁜 것 같네, 나중에!`); return; }
    this.date = { def: d, stage: 'pick', t: 0 };
    Msgs.add(d.name, `좋아! ${this.home(d).label || '내가 있는 곳'} 앞으로 차 갖고 와 ♥`);
    UI.toast(`${d.name}와(과) 데이트: 차를 몰고 데리러 가자 (분홍 표시)`);
  },
  updateDate(dt) {
    const D = this.date, d = D.def, P = Game.player; D.t += dt;
    if (D.t > 360) { this.love(d, -8, '약속을 어겼다'); Msgs.add(d.name, '너무 늦었잖아. 오늘은 그냥 갈래.'); this.date = null; UI.objective(''); return; }
    if (D.stage === 'pick') {
      const n = this.npcs[d.id];
      UI.objective(`${d.name}을(를) 데리러 가자 — 차를 그녀 옆에 세워라`);
      if (n && P.car && !P.car.V.special && P.car.speed < 2 && dist(P.car.x, P.car.y, n.x, n.y) < 7) {
        n.remove = true; this.npcs[d.id] = null;
        const venue = pick(d.venue.filter(v => World.places[v])) || 'biz_bistro'; D.venue = venue; D.stage = 'drive'; D.hp0 = P.car.hp; D.car = P.car; D.dt = 0;
        const likeCar = d.car.includes(P.car.type);
        UI.dialog([[d.name, likeCar ? '와, 차 멋지다! 오늘 기분 좋은데?' : '안녕! 오늘 어디 갈 거야?'], [d.name, `${World.places[venue].label || BUSINESSES[venue]?.name || '거기'} 가고 싶어!`]]);
        if (likeCar) this.love(d, 5, '좋아하는 차');
      }
    } else if (D.stage === 'drive') {
      D.dt += dt; const V = World.places[D.venue];
      UI.objective(`${d.name}와(과) 데이트: ${BUSINESSES[D.venue]?.name || '약속 장소'}까지 ${Math.round(dist(P.px, P.py, V.x, V.y))}m — 조심해서 운전`);
      if (!P.car || P.car !== D.car) { this.love(d, -10, '차에서 버려두고 갔다'); Msgs.add(d.name, '나를 두고 가? 너무해.'); this.date = null; UI.objective(''); return; }
      if (Wanted.stars >= 2 && !D.scared) { D.scared = true; UI.dialog([[d.name, '뭐야, 경찰이잖아! 무서워…']]); this.love(d, -6, '경찰 추격'); }
      if (dist(P.px, P.py, V.x, V.y) < 14 && P.car.speed < 3) {
        const dmg = Math.max(0, (D.hp0 - P.car.hp) / P.car.maxHp), gain = Math.round(18 - dmg * 30 + (D.dt < 90 ? 4 : 0));
        this.love(d, Math.max(3, gain), dmg > 0.2 ? '험하게 운전했지만 즐거웠다' : '즐거운 데이트'); this.s(d.id).dates++;
        UI.dialog([[d.name, dmg > 0.2 ? '좀 무서웠지만… 재밌었어!' : '오늘 정말 좋았어. 또 만나 ♥']]);
        Sfx.passed(); this.date = null; UI.objective(''); Save.write();
      }
    }
  },
  targets() {
    const D = this.date; if (!D) return [];
    if (D.stage === 'pick') { const h = this.home(D.def); return h ? [{ x: h.x, y: h.y, c: '#ff7fb0', big: true }] : []; }
    const V = World.places[D.venue]; return V ? [{ x: V.x, y: V.y, c: '#ff7fb0', big: true }] : [];
  },
  gift(d, kind) {
    const P = Game.player, cost = kind === 'flower' ? 500 : 5000;
    if (P.money < cost) { UI.toast('돈이 부족하다'); return; }
    P.money -= cost; Sfx.cash();
    this.love(d, kind === 'flower' ? 4 : 12, kind === 'flower' ? '꽃 선물' : '목걸이 선물');
    Msgs.add(d.name, kind === 'flower' ? '꽃 고마워! 예쁘다 ♥' : '세상에… 이렇게 비싼 걸? 고마워 ♥♥');
  },
  favor(d) {
    if (this.favorDay === Gangs.day) { UI.toast(`${d.name}: 오늘은 이미 부탁했잖아`); return; }
    if (Wanted.stars === 0) { UI.toast(`${d.name}: 지금은 쫓기지 않잖아?`); return; }
    this.favorDay = Gangs.day; Wanted.drop(2); Sfx.passed(); UI.toast(`${d.name}이(가) 아는 경찰에게 부탁했다 — 수배 -2`);
  },
  supply(d) {
    if (this.supplyDay === Gangs.day) { UI.toast(`${d.name}: 내일 또 챙겨 줄게`); return; }
    this.supplyDay = Gangs.day; const P = Game.player; P.armor = 100; for (const w of ['pistol', 'smg', 'shotgun', 'rifle']) giveWeapon(P, w, WEAPONS[w].pack || 30);
    UI.toast(`${d.name}이(가) 방탄복과 무기를 챙겨 줬다`); Sfx.pickup();
  },
  visit(d) {
    const h = this.home(d), P = Game.player; if (!h) return;
    if (P.car) exitCar(P, true); const s = sidewalkNear(h.x, h.y, 3); P.x = s.x; P.y = s.y;
    P.hp = P.maxHp; Game.clock = (Game.clock + 360) % 1440; Save.write();
    UI.big(`${d.name}의 집`, '푹 쉬었다 — 체력 가득, 저장됐다', 2.6, '#ff7fb0');
  },
};
SaveExt.mods.gf = GF;

// ---------- 문자 ----------
const Msgs = {
  list: [], unread: 0,
  save() { return { list: this.list.slice(-40), unread: this.unread }; },
  load(o) { this.list = (o && o.list) || []; this.unread = (o && o.unread) || 0; },
  add(from, text) { this.list.push({ from, text, t: Game.clock, d: Gangs.day }); if (this.list.length > 60) this.list.shift(); this.unread++; Sfx.tone({ f0: 1300, f1: 1700, dur: 0.08, type: 'sine', vol: 0.25 }); setTimeout(() => Sfx.tone({ f0: 1700, f1: 2000, dur: 0.08, type: 'sine', vol: 0.25 }), 110); UI.toast(`📱 ${from}: ${text}`); },
};
SaveExt.mods.msgs = Msgs;

// ---------- 업적 · 완료율 ----------
const ACH = [
  ['firstcar', '첫 차', '차를 처음 몰았다', () => !!Game.player.car],
  ['cash1m', '백만장자', '$1,000,000을 모았다', () => Game.player.money >= 1e6],
  ['cash10m', '천만장자', '$10,000,000을 모았다', () => Game.player.money >= 1e7],
  ['cash100m', '억만장자', '$100,000,000을 모았다', () => Game.player.money >= 1e8],
  ['biz5', '사업가', '사업체 5곳을 가졌다', () => Object.keys(Biz.owned()).length >= 5],
  ['bizall', '재벌', '모든 사업체를 가졌다', () => Object.keys(BUSINESSES).every(k => Biz.has(k))],
  ['bizmax', '플래그십', '사업체 하나를 5단계로 올렸다', () => Object.keys(Biz.owned()).some(k => Biz.lv(k) >= 5)],
  ['boss', '보스', '조직의 보스가 되었다', () => Gangs.rank === 2],
  ['turf100', '도시의 절반', '우리 구역이 100블록을 넘었다', () => Gangs.mine && Gangs.count(Gangs.mine) >= 100],
  ['star5', '공공의 적', '수배 ★★★★★를 받았다', () => Wanted.stars >= 5],
  ['jump1', '날아라', '유니크 스턴트 점프 성공', () => Object.keys(Stunts.done).length >= 1],
  ['jumpall', '스턴트맨', '유니크 스턴트 점프 전부', () => Stunts.ramps && Object.keys(Stunts.done).length >= Stunts.ramps.length],
  ['race1', '우승', '길거리 레이스 우승', () => Races.wins >= 1],
  ['race10', '레이스의 전설', '길거리 레이스 10회 우승', () => Races.wins >= 10],
  ['gold', '금메달', '타임 트라이얼 금메달', () => Races.starts && Races.starts.some(s => s.kind !== 'street' && Races.best[s.key] && Races.best[s.key] <= Races.goldTime(s))],
  ['event5', '정의의 시민', '도시 이벤트 5번 해결', () => Object.values(Events.done).reduce((a, b) => a + b, 0) >= 5],
  ['fire10', '소방관', '불을 10번 껐다', () => (Jobs.stats.firefighter || {}).done >= 10],
  ['love', '연애 중', '호감도 60 달성', () => GF_DEFS.some(d => GF.s(d.id).love >= 60)],
  ['love100', '천생연분', '호감도 100 달성', () => GF_DEFS.some(d => GF.s(d.id).love >= 100)],
  ['pkg', '수집가', '숨겨진 꾸러미 전부', () => Game.packages.size >= Game.packageTotal],
  ['story', '엔딩', '스토리를 끝까지', () => Missions.done],
  ['support', '시민의 영웅', '시민·공무원 지지 둘 다 75', () => Empire.support.civ >= 75 && Empire.support.off >= 75],
  ['law', '로비스트', '국회 법안 3개 통과', () => Object.keys(Finance.laws || {}).length >= 3],
  ['takeover', '기업 사냥꾼', '회사 경영권을 인수했다', () => typeof Tycoon !== 'undefined' && Object.values(Tycoon.acq).includes('me')],
  ['builder', '건설왕', '건물을 하나 올렸다', () => typeof Dev !== 'undefined' && Dev.list.some(p => p.done)],
  ['mansion', '힐탑의 주인', '저택을 샀다', () => typeof Tycoon !== 'undefined' && Tycoon.mansion],
  ['mayor', '시장님', '시장에 당선됐다', () => typeof Tycoon !== 'undefined' && Tycoon.mayor],
  ['air', '조종사', '비행기나 헬기를 몰았다', () => Game.player.car && (Game.player.car.V.special === 'jet' || Game.player.car.V.special === 'heli' || Game.player.car.type === 'airliner')],
];
const Achieve = {
  got: {}, t: 2, reward: false,
  save() { return { got: this.got, reward: this.reward }; },
  load(o) { this.got = (o && o.got) || {}; this.reward = !!(o && o.reward); },
  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 2;
    for (const [id, name, desc, f] of ACH) {
      if (this.got[id]) continue;
      let ok = false; try { ok = f(); } catch (e) { }
      if (ok) { this.got[id] = Gangs.day + 1; Sfx.passed(); UI.big(`업적: ${name}`, desc, 2.8, '#ffd166'); Save.write(); break; }
    }
    if (!this.reward && this.percent() >= 100) { this.reward = true; Game.player.money += 1e6; Game.player.infAmmo = true; UI.big('완료율 100%!', '+$1,000,000 · 무한 탄약', 4, '#ffd166'); Save.write(); }
  },
  // 완료율: 항목별 가중치 합 100
  parts() {
    const jobsDone = Object.keys(JOBS).filter(k => (Jobs.stats[k] || {}).done > 0).length;
    const ev = RE_TYPES.filter(k => Events.done[k]).length;
    const racesDone = (Races.starts || []).filter(s => s.kind === 'street' ? Races.wins > 0 : Races.best[s.key]).length;
    return [
      ['스토리 미션', Math.min(1, Missions.idx / Math.max(1, Missions.givers.length)), 25],
      ['숨겨진 꾸러미', Game.packages.size / Math.max(1, Game.packageTotal), 8],
      ['스턴트 점프', Stunts.ramps ? Object.keys(Stunts.done).length / Stunts.ramps.length : 0, 8],
      ['레이스', racesDone / Math.max(1, (Races.starts || []).length), 8],
      ['사업체', Object.keys(Biz.owned()).length / Object.keys(BUSINESSES).length, 12],
      ['직업 (한 번씩)', jobsDone / Object.keys(JOBS).length, 10],
      ['도시 이벤트', ev / RE_TYPES.length, 6],
      ['업적', Object.keys(this.got).length / ACH.length, 10],
      ['조직 보스', Gangs.rank === 2 ? 1 : Gangs.rank / 2, 5],
      ['연애', Math.max(...GF_DEFS.map(d => GF.s(d.id).love)) / 100, 5],
      ['체육관 단련', Math.min(1, ((Game.player.maxHp - 100) / 100 + ((Game.player.endurance || 1) - 1) / 1.5 + ((Game.player.aimSkill || 1) - 1)) / 3), 3],
    ];
  },
  percent() { return Math.floor(this.parts().reduce((a, [, f, w]) => a + clamp(f, 0, 1) * w, 0)); },
};
SaveExt.mods.ach = Achieve;

// ---------- 휴대폰 ----------
const Phone = {
  el: null, screen: 'home',
  build() {
    if (this.el) return;
    const st = document.createElement('style');
    st.textContent = `#phone{position:fixed;right:28px;bottom:24px;width:300px;height:560px;background:#0b0d12;border:3px solid #2a2f3a;border-radius:34px;box-shadow:0 20px 60px rgba(0,0,0,.6);z-index:60;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;color:#e8edf5}
#phone[hidden]{display:none}#phone .ph-top{height:34px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;font-size:12px;color:#9aa4b5}
#phone .ph-body{flex:1;overflow-y:auto;padding:8px 14px 14px}#phone .ph-title{font-size:18px;font-weight:800;margin:4px 0 10px}
#phone .ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 8px;margin-top:10px}#phone .ph-app{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:#cfd6e0;background:none;border:0}
#phone .ph-ico{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;color:#fff}
#phone .ph-row{background:#161a22;border-radius:12px;padding:10px 12px;margin-bottom:8px}#phone .ph-row b{display:block;font-size:14px}#phone .ph-row span{font-size:12px;color:#9aa4b5}
#phone .ph-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}#phone .ph-btns button{background:#2b3446;color:#fff;border:0;border-radius:8px;padding:6px 9px;font-size:12px;cursor:pointer}#phone .ph-btns button:hover{background:#3b4a66}#phone .ph-btns button:disabled{opacity:.4;cursor:default}
#phone .ph-home{height:40px;display:flex;justify-content:center;align-items:center}#phone .ph-home button{width:120px;height:6px;border-radius:3px;background:#5a6272;border:0;cursor:pointer}
#phone .bar{height:8px;border-radius:4px;background:#2b3446;overflow:hidden;margin-top:6px}#phone .bar i{display:block;height:100%;background:linear-gradient(90deg,#ff7fb0,#ffd166)}`;
    document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'phone'; el.hidden = true;
    el.innerHTML = '<div class="ph-top"><span id="ph-clock"></span><span>네온텔 5G</span></div><div class="ph-body" id="ph-body"></div><div class="ph-home"><button id="ph-homebtn" title="홈 (Esc: 닫기)"></button></div>';
    document.body.appendChild(el);
    el.querySelector('#ph-homebtn').onclick = () => this.show('home');
  },
  open() { if (Game.state !== 'play') return; this.build(); this.el.hidden = false; Game.state = 'shop'; this.show('home'); Sfx.tone({ f0: 900, f1: 1200, dur: 0.06, type: 'sine', vol: 0.2 }); },
  close() { if (!this.el || this.el.hidden) return false; this.el.hidden = true; Game.state = 'play'; Game.shopCool = 2; return true; },
  isOpen() { return this.el && !this.el.hidden; },
  show(sc) {
    this.build(); this.screen = sc; const B = this.el.querySelector('#ph-body'), P = Game.player;
    this.el.querySelector('#ph-clock').textContent = `${String(Math.floor(Game.clock / 60)).padStart(2, '0')}:${String(Math.floor(Game.clock % 60)).padStart(2, '0')}`;
    const h = (t) => { B.innerHTML = t; };
    const row = (title, sub, btns = []) => { const r = document.createElement('div'); r.className = 'ph-row'; r.innerHTML = `<b>${title}</b><span>${sub}</span>`; if (btns.length) { const w = document.createElement('div'); w.className = 'ph-btns'; for (const [l, f, dis] of btns) { const b = document.createElement('button'); b.textContent = l; b.disabled = !!dis; b.onclick = () => { f(); if (this.isOpen() && this.screen === sc) this.show(sc); }; w.append(b); } r.append(w); } B.append(r); return r; };
    const back = () => { const b = document.createElement('div'); b.className = 'ph-btns'; const x = document.createElement('button'); x.textContent = '← 뒤로'; x.onclick = () => this.show('home'); b.append(x); B.append(b); };
    if (sc === 'home') {
      h(`<div class="ph-title">네온폰</div><div class="ph-grid"></div>`);
      const G = B.querySelector('.ph-grid');
      const apps = [['contacts', '연락처', '#34c759', '☎'], ['msgs', `문자${Msgs.unread ? ` (${Msgs.unread})` : ''}`, '#0a84ff', '✉'], ['bank', '은행', '#ffd60a', '$'], ['gps', '길 찾기', '#ff453a', '➤'], ['weather', '날씨', '#64d2ff', '☁'], ['ach', `업적 ${Achieve.percent()}%`, '#bf5af2', '★']];
      for (const [id, label, col, ico] of apps) { const a = document.createElement('button'); a.className = 'ph-app'; a.innerHTML = `<div class="ph-ico" style="background:${col}">${ico}</div>${label}`; a.onclick = () => this.show(id); G.append(a); }
      return;
    }
    h(`<div class="ph-title">${{ contacts: '연락처', msgs: '문자', bank: '은행', gps: '길 찾기', weather: '날씨', ach: '업적 · 완료율' }[sc]}</div>`);
    if (sc === 'contacts') {
      for (const d of GF_DEFS) {
        const s = GF.s(d.id); if (!s.met) continue;
        const r = row(`♥ ${d.name}`, `${d.job} · 좋아하는 것: ${d.likes} · 데이트 ${s.dates}회`, [
          ['데이트 신청', () => { GF.askDate(d); this.close(); }, !!GF.date],
          ['꽃 $500', () => GF.gift(d, 'flower')], ['목걸이 $5,000', () => GF.gift(d, 'jewel')],
          ['집에 가기', () => { GF.visit(d); this.close(); }, s.love < 30],
          ['수배 줄여 줘', () => GF.favor(d), s.love < 60 || Wanted.stars === 0],
          ['무기 챙겨 줘', () => GF.supply(d), s.love < 90],
        ]);
        r.insertAdjacentHTML('beforeend', `<div class="bar"><i style="width:${s.love}%"></i></div>`);
      }
      if (!GF_DEFS.some(d => GF.s(d.id).met)) row('아직 연락처가 없다', '지도의 ♥ 표시에서 그녀들을 만나 보자');
      if (Gangs.mine) row(`${GANGS[Gangs.mine].name}`, `부하 ${Empire.backupSize()}명`, [['부하 부르기', () => { this.close(); Gangs.callBackup(); }, Gangs.rank < 1], ['조직 관리', () => { this.close(); Shop.open('gang'); }]]);
      const fl = Fleet.list().filter(e => !e.wrecked && !Fleet.carOf(e));
      row('네온 정비소 — 차 배달', fl.length ? '차고의 차를 가까운 길가로 가져다준다 ($300)' : '차고에 보관한 차가 없다', fl.slice(0, 6).map(e => [VTYPES[e.type].name, () => { if (P.money < 300) return; P.money -= 300; const s = roadsideSpot(P.px, P.py, 8, 40); const c = Dealer.deliver(e.type, { x: s.x, y: s.y }, e.color); c.fleetId = e.id; UI.toast(`${c.V.name}이(가) 도착했다`); this.close(); }]));
      const wp = Game.waypoint, cost = wp ? Math.round(80 + dist(P.px, P.py, wp.x, wp.y) * 0.3) : 0;
      row('다운타운 택시', wp ? `웨이포인트까지 바로 이동 $${cost.toLocaleString()}` : '지도에서 웨이포인트를 먼저 찍자', [['타기', () => { if (Wanted.stars) { UI.toast('택시: 경찰에 쫓기는 손님은 안 태워요'); return; } if (P.money < cost) return; P.money -= cost; if (P.car) exitCar(P, true); const s = sidewalkNear(wp.x, wp.y, 6); P.x = s.x; P.y = s.y; Game.waypoint = null; this.close(); UI.big('택시', '목적지에 도착했다', 1.8, '#ffd166'); }, !wp]]);
      row('변호사 솔', Wanted.stars ? `수배 해제 $${(Wanted.stars * 8000).toLocaleString()}` : '"문제가 생기면 전화해."', [['수배 해제', () => { const c = Wanted.stars * 8000; if (P.money < c) return; P.money -= c; Wanted.clear('변호사가 손을 썼다'); }, !Wanted.stars]]);
    } else if (sc === 'msgs') {
      Msgs.unread = 0;
      if (!Msgs.list.length) row('문자가 없다', '');
      for (const m of Msgs.list.slice().reverse().slice(0, 30)) row(m.from, m.text);
    } else if (sc === 'bank') {
      const F = Finance.bank, inc = Biz.total() + Finance.rentPerMin();
      row(`현금 $${Math.round(P.money).toLocaleString()}`, `사업 수입 1분 $${Biz.total().toLocaleString()} · 임대 1분 $${Finance.rentPerMin().toLocaleString()}`);
      row(`중앙은행 예금 $${Math.round(F.dep).toLocaleString()}`, `대출 $${Math.round(F.debt).toLocaleString()} · 예금 이자 1분 3%`, [
        ['$100,000 예금', () => { if (P.money < 1e5) return; P.money -= 1e5; F.dep += 1e5; }], ['전부 예금', () => { F.dep += P.money; P.money = 0; }],
        ['$100,000 출금', () => { const a = Math.min(1e5, F.dep); F.dep -= a; P.money += a; }], ['전부 출금', () => { P.money += F.dep; F.dep = 0; }],
      ]);
      row('1시간(실제 60분) 예상 수입', `$${Math.round(inc * 60).toLocaleString()}`);
    } else if (sc === 'gps') {
      const near = keys => { let b = null, bd = 1e9; for (const k of keys) { const q = World.places[k]; if (q) { const d = dist(q.x, q.y, P.px, P.py); if (d < bd) { bd = d; b = q; } } } return b; };
      const dests = [['가장 가까운 병원', ['hospital', 'hospital2', 'hospital3', 'clinic']], ['총포상', ['ammu', 'ammu2', 'ammu3']], ['내 차고', ['mygarage']], ['은신처', ['safehouse']], ['페인트샵', ['spray', 'spray2']], ['고용센터', ['jobcenter']], ['브로커', ['broker']], ['작전실', ['heist']], ['레이스', (Races.starts || []).map(s => s.key)], ['점프대 (안 한 곳)', (Stunts.ramps || []).filter(r => !Stunts.done[r.id]).map(r => 'jump_' + r.id)], ['여자친구', GF_DEFS.map(d => d.spot)], ['네온 홀딩스 (기업 인수)', ['holdings']], ['하버 개발', ['devco']], ['힐탑 저택', ['mansion']]];
      for (const [label, keys] of dests) { const q = near(keys); row(label, q ? `${Math.round(dist(P.px, P.py, q.x, q.y))}m` : '없음', q ? [['경로 표시', () => { Game.waypoint = { x: q.x, y: q.y }; UI.toast(`${label}: 웨이포인트 설정`); this.close(); }]] : []); }
    } else if (sc === 'weather') {
      row(`지금: ${WEATHER_NAMES[Weather.type]}`, Weather.type === 'storm' ? '번개 조심 · 노면이 미끄럽다' : Weather.type === 'fog' ? '가시거리가 짧다' : Weather.type === 'rain' ? '노면이 젖었다' : '드라이브하기 좋은 날');
      row('다음 날씨 변화', `약 ${Math.max(1, Math.round(Game.weather.nextT / 60))}분 뒤`);
      row('시각', `${String(Math.floor(Game.clock / 60)).padStart(2, '0')}:${String(Math.floor(Game.clock % 60)).padStart(2, '0')} · ${Gangs.day + 1}일째`);
    } else if (sc === 'ach') {
      const pc = Achieve.percent();
      const r = row(`완료율 ${pc}%`, pc >= 100 ? '100% 달성 보상을 받았다' : '100%가 되면 $1,000,000 + 무한 탄약'); r.insertAdjacentHTML('beforeend', `<div class="bar"><i style="width:${pc}%"></i></div>`);
      for (const [n, f, w] of Achieve.parts()) row(`${n} (${w}%)`, `${Math.round(clamp(f, 0, 1) * 100)}% 완료`);
      for (const [id, name, desc] of ACH) row(`${Achieve.got[id] ? '★' : '☆'} ${name}`, desc);
    }
    back();
  },
};

// 가끔 오는 문자 (일감·소식)
const LifeMsgs = {
  t: 120,
  update(dt) {
    this.t -= dt; if (this.t > 0 || Game.state !== 'play') return; this.t = rand(150, 300);
    const P = Game.player, opts = [];
    opts.push(['브로커', '수출 주문이 들어왔다. 고급차면 값을 더 쳐주지.']);
    opts.push(['네온 뉴스', pick(['증권가: 오늘 증시 변동성 커질 전망', '시장 선거 앞두고 정치권 긴장', '하버 포인트 부두에서 밀수 단속 강화', '공항 이용객 역대 최다 기록'])]);
    if (Gangs.mine) opts.push([GANGS[Gangs.mine].name, pick(['라이벌 놈들이 우리 구역을 넘본다. 조심해.', '보호비 걷을 때 됐다.', '형님, 부하들 대기 중입니다.'])]);
    const d = GF.best(); if (d && GF.s(d.id).love >= 20) opts.push([d.name, pick(['뭐 해? 보고 싶어 ♥', '주말에 드라이브 갈래?', '오늘 날씨 좋다! 데이트하자'])]);
    if (Stunts.ramps && Object.keys(Stunts.done).length < Stunts.ramps.length) opts.push(['스턴트 클럽', '아직 안 뛴 점프대가 있어. 휴대폰 길 찾기에서 확인해 봐.']);
    const [from, text] = pick(opts); Msgs.add(from, text);
  },
};
