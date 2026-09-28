'use strict';
/* =====================================================================
 * tuning.js — 네온 커스텀 (v2.19): 차 튜닝 · 도색 · 번호판
 *
 *  페인트샵(spray·spray2)에 차를 세우면 커스텀 창이 열린다. 수배 중이면 예전처럼 곧바로 새로 칠하고 수배를 지운다.
 *  부품(단계별): 엔진(가속) · 변속기(최고속도) · 브레이크 · 타이어(접지) · 서스펜션(조향) · 터보 · 방탄 차체(체력)
 *  튜닝·색·번호판은 차마다 붙고, 내 차고(Fleet)에 넣으면 저장돼서 다시 꺼내도 그대로다.
 *  성능은 차마다 V를 복사해서 바꾼다 (c.V = VTYPES 원본을 프로토타입으로 한 사본).
 *  "차를 산다 → 튜닝한다 → 레이스에서 쓴다" — 레이스·스턴트에 바로 효과가 난다.
 * ===================================================================== */

const TUNE_PARTS = {
  engine: { name: '엔진', max: 3, base: [9000, 22000, 45000], desc: l => `가속 +${l * 12}%` },
  trans: { name: '변속기', max: 3, base: [7000, 16000, 32000], desc: l => `최고속도 +${l * 6}%` },
  brake: { name: '브레이크', max: 3, base: [4000, 9000, 18000], desc: l => `제동력 +${l * 20}%` },
  tire: { name: '타이어', max: 3, base: [5000, 11000, 22000], desc: l => `접지력 +${l * 7}%` },
  susp: { name: '서스펜션', max: 3, base: [5000, 12000, 24000], desc: l => `조향 +${l * 6}% · 접지 +${l * 3}%` },
  turbo: { name: '터보', max: 1, base: [60000], desc: l => l ? '가속 +18% (터보 휘슬)' : '가속 +18%' },
  armor: { name: '방탄 차체', max: 3, base: [15000, 35000, 70000], desc: l => `차체 내구도 +${l * 25}%` },
};
const PAINTS = [['레이싱 레드', '#d7263d'], ['미드나잇 블랙', '#15161a'], ['펄 화이트', '#eef0f2'], ['네온 핑크', '#ff4fd8'], ['라임', '#7ae62f'], ['일렉트릭 블루', '#2f6fe0'], ['골드', '#d4af37'], ['건메탈', '#4a5058'], ['선셋 오렌지', '#f07c1b'], ['로열 퍼플', '#6b3b8f'], ['민트', '#6fe0c0'], ['사막 모래', '#c8a868']];
const PLATES = ['NEON 01', 'BOSS', 'KING 26', 'RED CTY', '빠름빠름', 'NH 7777', 'TURBO', '네온의왕'];

function applyTune(c) {
  const base = VTYPES[c.type]; if (!base || base.special) return;
  const t = c.tune || {}, V = Object.create(base);
  const eng = 1 + 0.12 * (t.engine || 0) + (t.turbo ? 0.18 : 0), top = 1 + 0.06 * (t.trans || 0) + 0.04 * (t.engine || 0);
  V.Fe = base.Fe * eng; V.vmax = base.vmax * top;
  V.grip = base.grip * (1 + 0.07 * (t.tire || 0) + 0.03 * (t.susp || 0)); V.cs = base.cs * (1 + 0.05 * (t.tire || 0));
  V.steer = base.steer * (1 + 0.06 * (t.susp || 0));
  c.V = V; c.brakeMul = 1 + 0.2 * (t.brake || 0);
  const hk = c.hp / c.maxHp; c.maxHp = Math.round(base.hp * (1 + 0.25 * (t.armor || 0))); c.hp = Math.round(c.maxHp * (isFinite(hk) ? hk : 1));
}
function redrawCar(c) { const g = View3D.cars && View3D.cars.get(c.id); if (g) { View3D.scene.remove(g); View3D.cars.delete(c.id); } }
function tuneLevel(c) { const t = c.tune || {}; return Object.keys(TUNE_PARTS).reduce((a, k) => a + (t[k] || 0), 0); }
function syncFleet(c) { if (!c.fleetId) return; const e = Fleet.list().find(q => q.id === c.fleetId); if (e) { e.tune = { ...(c.tune || {}) }; e.color = c.color; e.plate = c.plate || null; } }

const Tuning = {
  cool: 0, visited: null,
  priceMul(c) { return 1 + Math.min(4, carValue(c) / 60000); },
  update(dt) {
    const P = Game.player; this.cool -= dt;
    if (!P || !P.car || P.car.V.special || Game.state !== 'play' || Wanted.stars > 0) { if (!P || !P.car) this.visited = null; return; }
    let at = null; for (const k of ['spray', 'spray2']) { const S = World.places[k]; if (S && dist(P.car.x, P.car.y, S.x, S.y) < 6) at = k; }
    if (!at) { this.visited = null; return; }
    if (P.car.speed < 1.5 && this.visited !== at && this.cool <= 0) { this.visited = at; this.cool = 2; Shop.open('custom'); }
  },
};

SHOPS.custom = {
  title: '네온 커스텀',
  get sub() { const c = Game.player.car; return c ? `${c.label || c.V.name}${c.plate ? ` [${c.plate}]` : ''} · 튜닝 ${tuneLevel(c)}단계 · 최고속도 ${Math.round(c.V.vmax * 3.6)}km/h · 차체 ${Math.round(100 * c.hp / c.maxHp)}%` : '차를 타고 오면 튜닝할 수 있다'; },
  items() {
    const P = Game.player, c = P.car; if (!c || c.V.special) return [];
    const mul = Tuning.priceMul(c), t = c.tune || (c.tune = {}), out = [];
    const rep = Fuel.repairCost(c);
    out.push({ id: 'rep', name: `수리 (차체 ${Math.round(100 * c.hp / c.maxHp)}%)`, price: rep, btn: '수리', desc: '부서진 곳을 모두 고친다', ok: () => rep > 0, fn: () => { if (P.money < rep) return; P.money -= rep; c.hp = c.maxHp; c.burnT = 0; c.dmgParts = null; c.flat = false; Sfx.cash(); Shop.open('custom'); } });
    for (const [k, D] of Object.entries(TUNE_PARTS)) {
      const lv = t[k] || 0, next = lv + 1, cost = next <= D.max ? Math.round(D.base[next - 1] * mul / 100) * 100 : 0;
      out.push({ id: 't_' + k, name: `${D.name} ${lv}/${D.max}${lv >= D.max ? ' (최고)' : ''}`, price: cost, btn: lv >= D.max ? '완료' : '장착', desc: lv >= D.max ? D.desc(lv) : `다음 단계: ${D.desc(next)}`, ok: () => lv < D.max,
        fn: () => { if (P.money < cost) return; P.money -= cost; t[k] = next; applyTune(c); syncFleet(c); Sfx.passed(); UI.toast(`${D.name} ${next}단계 장착`); Save.write(); Shop.open('custom'); } });
    }
    const paint = Math.round(1500 * mul / 100) * 100;
    for (const [nm, col] of PAINTS) out.push({ id: 'p_' + col, name: `도색: ${nm}`, price: paint, btn: c.color === col ? '현재' : '칠하기', desc: '', swatch: col, ok: () => c.color !== col, fn: () => { if (P.money < paint) return; P.money -= paint; c.color = col; redrawCar(c); syncFleet(c); Sfx.cash(); Shop.open('custom'); } });
    for (const pl of PLATES) out.push({ id: 'pl_' + pl, name: `번호판: ${pl}`, price: 2500, btn: c.plate === pl ? '현재' : '달기', desc: '', ok: () => c.plate !== pl, fn: () => { if (P.money < 2500) return; P.money -= 2500; c.plate = pl; syncFleet(c); Sfx.cash(); Shop.open('custom'); } });
    out.push({ id: 'store', name: '이 차를 내 차고에 등록', price: 0, btn: c.fleetId ? '등록됨' : '등록', desc: '튜닝·색·번호판을 저장한다 (내 차고에서 다시 꺼낼 수 있다)', ok: () => !c.fleetId && Fleet.list().length < Fleet.MAX, fn: () => { Fleet.add(c); syncFleet(c); Save.write(); UI.toast('내 차고에 등록했다'); Shop.open('custom'); } });
    return out;
  },
};

// 내 차고: 꺼낼 때 튜닝·번호판 적용, 넣을 때 저장
{
  const _take = Fleet.takeOut.bind(Fleet);
  Fleet.takeOut = function (e) { _take(e); const c = this.carOf(e); if (c) { c.tune = { ...(e.tune || {}) }; c.plate = e.plate || null; applyTune(c); } };
  const _store = Fleet.store.bind(Fleet);
  Fleet.store = function () { const c = Game.player.car; if (c) { const had = c.fleetId; _store(); if (c.fleetId || had) syncFleet(c); } else _store(); };
}
