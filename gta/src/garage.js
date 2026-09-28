'use strict';
/* =====================================================================
 * garage.js — 연료 · 주유 · 정비 (v2.18)
 *
 *  · 모든 땅 차량에 연료(0~100%)가 있다. 차종마다 연비가 다르다(경차 14km, 하이퍼카 5km 정도).
 *    연료가 떨어지면 가속이 안 된다 → 주유소까지 밀려 가거나 다른 차를 탄다.
 *  · 주유소(도시 주유소 2곳 · 카운티 주유소 4곳)에 차를 세우면 정비 창이 열린다: 주유 · 수리 · 타이어 교체.
 *    수리비는 차 값에 비례한다(고급차일수록 비싸다). 페인트샵도 이제 수리비를 따로 받는다.
 *  · 차가 많이 부서지면 가속이 떨어진다(체력 50% 아래부터, 0%면 65%).
 *  · 튜닝(v2.19)은 차마다 V를 복사해 성능을 바꾼다 — carV(c)
 * ===================================================================== */

// 차종별 연비: 가득 찬 탱크로 달리는 거리(m)
const FUEL_RANGE = { compact: 14000, sedan: 12000, taxi: 12000, bike: 13000, van: 9000, muscle: 8000, sports: 8000, super: 6500, hyper: 5500, truck: 6000, bus: 6000, armored: 6000, swat: 6500, police: 10000, ambulance: 9000, firetruck: 7000, atv: 9000, pickup: 9000, tractor: 7000 };
const FUEL_STATIONS = ['biz_gas1', 'biz_gas2', 'c_gas1', 'c_gas2', 'c_gas3', 'c_gas4'];
const fuelOf = c => (c.fuel === undefined ? (c.fuel = c.persistent && c.everDriven ? 100 : rand(45, 95)) : c.fuel);
const carValue = c => (typeof VEHICLE_PRICES !== 'undefined' && VEHICLE_PRICES[c.type]) || 8000;
const usesFuel = c => c && !c.V.special && c.type !== 'bicycle';

const Fuel = {
  warned: null, cool: 0, stopT: 0, lastCar: null,
  pricePct(c) { return Math.round(3 + Math.min(12, carValue(c) / 40000)); }, // 1%당 가격 (고급차는 고급유)
  repairCost(c) { const k = 1 - clamp(c.hp / c.maxHp, 0, 1); return k < 0.01 ? 0 : Math.round(Math.max(150, carValue(c) * 0.12 * k)); },
  tireCost(c) { return Math.round(300 + carValue(c) * 0.01); },
  // playerDrive 뒤에 부른다: 연료 소모 + 부서진 차 출력 저하
  drive(car, dt) {
    if (!usesFuel(car)) return;
    this.lastCar = car;
    const f = fuelOf(car), range = FUEL_RANGE[car.type] || 10000;
    const thr = Math.max(0, car.in.thr);
    car.fuel = Math.max(0, f - (Math.abs(car.vf) * dt / range * 100) * (0.35 + 0.65 * thr) - dt * 0.004);
    if (car.fuel <= 0) {
      car.in.thr = Math.min(car.in.thr, 0);
      if (this.warned !== car) { this.warned = car; UI.big('연료가 떨어졌다', '주유소까지 밀고 가거나 다른 차를 타자 (지도의 편·주유소)', 3, '#ff8a3d'); }
    } else if (car.fuel < 12 && this.warned !== car.id + 'low') { this.warned = car.id + 'low'; UI.toast('연료 부족 — 가까운 주유소를 찾자'); }
    const hpk = clamp(car.hp / car.maxHp, 0, 1);
    if (hpk < 0.5 && car.in.thr > 0) car.in.thr *= 0.65 + 0.7 * hpk; // 엔진 손상
  },
  nearStation(x, y, r = 14) { for (const k of FUEL_STATIONS) { const S = World.places[k]; if (S && dist(S.x, S.y, x, y) < r) return k; } return null; },
  update(dt) {
    const P = Game.player; this.cool -= dt;
    if (!P || !P.car || !usesFuel(P.car) || Game.state !== 'play') { this.stopT = 0; return; }
    const st = this.nearStation(P.car.x, P.car.y);
    if (!st) { this.visited = null; this.stopT = 0; return; }
    if (P.car.speed < 1.2) this.stopT += dt; else this.stopT = 0;
    if (this.stopT > 0.7 && this.visited !== st && this.cool <= 0) { this.visited = st; this.cool = 2; this.stopT = 0; Shop.open('fuelstop'); } // 한 번 들를 때 한 번만 연다
  },
  drawHUD(c, sx, sy, hw, s) {
    const car = Game.player.car; if (!usesFuel(car)) return;
    const f = fuelOf(car) / 100, low = f < 0.15, blink = low && Math.sin(performance.now() / 180) > 0;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(sx, sy + 14 * s, hw, 5 * s);
    c.fillStyle = low ? (blink ? '#ff5a4a' : '#8a2a22') : '#f2c14e'; c.fillRect(sx, sy + 14 * s, hw * f, 5 * s);
    txt(c, `연료 ${Math.round(f * 100)}%`, sx + hw + 6 * s, sy + 19 * s, `600 ${10 * s}px ${FONT_KR}`, low ? '#ff8a80' : '#e6d9a8', 'rgba(0,0,0,0.9)', 3, 'left');
  },
};

// 주유소 정비 창
SHOPS.fuelstop = {
  title: '주유소 · 정비',
  get sub() { const c = Game.player.car; return c ? `${c.label || c.V.name} · 연료 ${Math.round(fuelOf(c))}% · 차체 ${Math.round(100 * c.hp / c.maxHp)}%${c.flat ? ' · 타이어 펑크' : ''}` : '차를 타고 오면 주유·수리를 할 수 있다'; },
  items() {
    const P = Game.player, c = P.car; if (!c) return [];
    const need = Math.max(0, 100 - fuelOf(c)), pp = Fuel.pricePct(c), fuelCost = Math.round(need * pp), rep = Fuel.repairCost(c), tire = Fuel.tireCost(c);
    const out = [
      { id: 'fill', name: `가득 주유 (${Math.round(need)}%)`, price: fuelCost, btn: '주유', desc: `1%당 $${pp}${pp > 5 ? ' · 고급 휘발유' : ''}`, ok: () => need > 0.5, fn: () => { if (P.money < fuelCost) return; P.money -= fuelCost; c.fuel = 100; Fuel.warned = null; Sfx.cash(); UI.toast(`주유 완료 -$${fuelCost.toLocaleString()}`); Shop.open('fuelstop'); } },
      { id: 'half', name: '반만 주유 (+40%)', price: Math.round(Math.min(40, need) * pp), btn: '주유', desc: '돈이 모자랄 때', ok: () => need > 0.5, fn: () => { const n = Math.min(40, need), cost = Math.round(n * pp); if (P.money < cost) return; P.money -= cost; c.fuel = Math.min(100, fuelOf(c) + n); Sfx.cash(); Shop.open('fuelstop'); } },
      { id: 'repair', name: `수리 (차체 ${Math.round(100 * c.hp / c.maxHp)}% → 100%)`, price: rep, btn: '수리', desc: `차 값 $${carValue(c).toLocaleString()} 기준 — 비싼 차일수록 수리비가 크다 · 부서지면 가속이 떨어진다`, ok: () => rep > 0, fn: () => { if (P.money < rep) return; P.money -= rep; c.hp = c.maxHp; c.burnT = 0; c.dmgParts = null; Sfx.cash(); UI.toast('수리 완료'); Shop.open('fuelstop'); } },
      { id: 'tire', name: '타이어 교체', price: tire, btn: '교체', desc: c.flat ? '펑크 난 타이어를 새것으로' : '타이어 상태 양호', ok: () => !!c.flat, fn: () => { if (P.money < tire) return; P.money -= tire; c.flat = false; Sfx.cash(); UI.toast('타이어 교체 완료'); Shop.open('fuelstop'); } },
    ];
    return out;
  },
};

// playerDrive 다음에 연료·손상 처리 (전역 함수 교체)
{ const _pd = playerDrive; playerDrive = function (car, dt) { _pd(car, dt); Fuel.drive(car, dt); }; }
// 페인트샵: 도색·수배 해제 $100은 그대로, 수리비는 차 값에 맞게 따로 받는다 (main.js places → Fuel.repairCost)
for (const k of FUEL_STATIONS) if (typeof PLACE_MARK !== 'undefined' && !PLACE_MARK[k]) PLACE_MARK[k] = '#f2c14e';
