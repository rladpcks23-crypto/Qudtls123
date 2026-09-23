'use strict';
/* =====================================================================
 * casino.js — 다이아몬드 카지노: 룰렛 · 슬롯머신 · 블랙잭
 *
 *  · 베팅 한도 $100,000 (카지노를 소유하면 $1,000,000, 잃은 돈의 20% 환급)
 *  · 확률은 실제 카지노와 같게: 유럽식 룰렛(0 한 칸), 슬롯 환수율 약 93%, 블랙잭 3:2
 * ===================================================================== */

const Casino = {
  bet: 1000, game: 'roulette', busy: false, net: 0,
  limit() { return Biz.has('biz_casino') ? 1000000 : 100000; },
  open() {
    Game.state = 'shop';
    this.el = document.getElementById('casino');
    this.el.hidden = false; this.net = 0;
    this.render();
  },
  close() {
    this.el.hidden = true; Game.state = 'play'; Game.shopCool = 4;
    if (this.net) UI.toast(`카지노 결과: ${this.net > 0 ? '+' : '-'}$${Math.abs(this.net).toLocaleString()}`);
    Save.write();
  },
  money() { return Game.player.money; },
  canBet() { return !this.busy && this.bet > 0 && this.bet <= this.money() && this.bet <= this.limit(); },
  // 정산: 이긴 경우 payout(원금 포함)을 돌려준다. 소유주는 잃은 돈의 20% 환급
  settle(stake, payout, msg) {
    const P = Game.player;
    P.money += payout; const d = payout - stake; this.net += d;
    if (d < 0 && Biz.has('biz_casino')) { const r = Math.round(-d * 0.2); P.money += r; this.net += r; msg += ` (소유주 환급 +$${r.toLocaleString()})`; }
    if (d > 0) { Sfx.cash(); if (d >= stake * 5) Sfx.passed(); } else Sfx.tone({ f0: 300, f1: 180, dur: 0.25, type: 'triangle', vol: 0.2 });
    this.result(msg, d > 0 ? '#7ae68f' : d === 0 ? '#cfd6e0' : '#ff8a80');
    this.refreshMoney();
  },
  take() { if (!this.canBet()) { this.result(this.bet > this.limit() ? `베팅 한도 $${this.limit().toLocaleString()}` : '돈이 모자란다', '#ff8a80'); return false; } Game.player.money -= this.bet; this.refreshMoney(); return true; },
  result(t, col) { const r = this.el.querySelector('#cz-result'); if (r) { r.textContent = t; r.style.color = col || '#fff'; } },
  refreshMoney() { const m = this.el.querySelector('#cz-money'); if (m) m.textContent = `보유 $${this.money().toLocaleString()} · 베팅 $${this.bet.toLocaleString()} · 오늘 ${this.net >= 0 ? '+' : '-'}$${Math.abs(this.net).toLocaleString()}`; },

  render() {
    const E = this.el.querySelector('.card');
    const bets = [100, 1000, 10000, 50000, 100000, 500000, 1000000].filter(b => b <= this.limit());
    E.innerHTML = `
      <h2>다이아몬드 카지노${Biz.has('biz_casino') ? ' <small style="color:#ffd166">VIP · 소유주</small>' : ''}</h2>
      <div id="cz-money" class="cz-money"></div>
      <div class="cz-row cz-bets">${bets.map(b => `<button class="btn small cz-bet${b === this.bet ? ' on' : ''}" data-b="${b}">$${b >= 1000 ? (b / 1000) + 'K' : b}</button>`).join('')}<button class="btn small cz-bet" data-b="max">최대</button></div>
      <div class="cz-row cz-tabs">${[['roulette', '룰렛'], ['slots', '슬롯머신'], ['bj', '블랙잭']].map(([g, n]) => `<button class="btn small${g === this.game ? ' primary' : ''}" data-g="${g}">${n}</button>`).join('')}</div>
      <div id="cz-game" class="cz-game"></div>
      <div id="cz-result" class="cz-result">베팅 금액을 고르고 게임을 하자</div>
      <button class="btn" id="cz-close">나가기</button>`;
    E.querySelectorAll('.cz-bet').forEach(b => b.onclick = () => { if (this.busy) return; const v = b.dataset.b; this.bet = v === 'max' ? Math.max(0, Math.min(this.limit(), this.money())) : +v; this.render(); });
    E.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { if (this.busy) return; this.game = b.dataset.g; this.bj = null; this.render(); });
    E.querySelector('#cz-close').onclick = () => { if (!this.busy) this.close(); };
    this.refreshMoney();
    this['r_' + this.game](E.querySelector('#cz-game'));
  },

  // ----- 룰렛 (유럽식 0~36) -----
  RED: new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]),
  r_roulette(G) {
    G.innerHTML = `<div class="cz-wheel" id="cz-wheel">?</div>
      <div class="cz-row">${[['red', '빨강 ×2'], ['black', '검정 ×2'], ['odd', '홀 ×2'], ['even', '짝 ×2'], ['low', '1–18 ×2'], ['high', '19–36 ×2'], ['zero', '0 ×36']].map(([k, n]) => `<button class="btn small" data-r="${k}">${n}</button>`).join('')}</div>
      <div class="cz-row">숫자에 걸기(×36): <input id="cz-num" type="number" min="0" max="36" value="7" style="width:64px"> <button class="btn small" data-r="num">숫자 베팅</button></div>`;
    G.querySelectorAll('[data-r]').forEach(b => b.onclick = () => this.spin(b.dataset.r, +G.querySelector('#cz-num').value));
  },
  spin(kind, num) {
    if (kind === 'num' && !(num >= 0 && num <= 36)) { this.result('0~36 사이 숫자', '#ff8a80'); return; }
    if (!this.take()) return;
    this.busy = true; const stake = this.bet, W = this.el.querySelector('#cz-wheel');
    const n = Math.floor(Math.random() * 37); let k = 0;
    const tick = setInterval(() => {
      const v = k < 18 ? Math.floor(Math.random() * 37) : n;
      W.textContent = v; W.className = 'cz-wheel ' + (v === 0 ? 'g' : this.RED.has(v) ? 'r' : 'b');
      Sfx.tone({ f0: 900, f1: 900, dur: 0.03, type: 'square', vol: 0.06 });
      if (++k > 18) {
        clearInterval(tick); this.busy = false;
        const red = this.RED.has(n), win = { red: n && red, black: n && !red, odd: n && n % 2, even: n && !(n % 2), low: n >= 1 && n <= 18, high: n >= 19, zero: n === 0, num: n === num }[kind];
        const mult = kind === 'zero' || kind === 'num' ? 36 : 2;
        this.settle(stake, win ? stake * mult : 0, `${n} ${n === 0 ? '초록' : red ? '빨강' : '검정'} — ${win ? `당첨! +$${(stake * (mult - 1)).toLocaleString()}` : '꽝'}`);
      }
    }, 70);
  },

  // ----- 슬롯머신 -----
  SYM: [['🍒', 30, 3], ['🍋', 25, 5], ['🔔', 18, 8], ['⭐', 12, 12], ['💎', 9, 25], ['7', 6, 50]],
  pickSym() { let r = Math.random() * 100; for (const s of this.SYM) { if ((r -= s[1]) < 0) return s; } return this.SYM[0]; },
  r_slots(G) {
    G.innerHTML = `<div class="cz-reels"><span>?</span><span>?</span><span>?</span></div>
      <div class="cz-note">세 개 같으면 🍒×3 🍋×5 🔔×8 ⭐×12 💎×25 7×50 · 두 개 같으면 ×1.4</div>
      <button class="btn primary" id="cz-pull">레버 당기기</button>`;
    G.querySelector('#cz-pull').onclick = () => this.pull();
  },
  pull() {
    if (!this.take()) return;
    this.busy = true; const stake = this.bet, R = [...this.el.querySelectorAll('.cz-reels span')];
    const out = [this.pickSym(), this.pickSym(), this.pickSym()]; let k = 0;
    const tick = setInterval(() => {
      R.forEach((r, i) => { if (k < 10 + i * 5) r.textContent = this.SYM[Math.floor(Math.random() * 6)][0]; else r.textContent = out[i][0]; });
      Sfx.tone({ f0: 600, f1: 600, dur: 0.02, type: 'square', vol: 0.05 });
      if (++k > 20) {
        clearInterval(tick); this.busy = false;
        const [a, b, c] = out.map(s => s[0]);
        let mult = 0, msg = '꽝';
        if (a === b && b === c) { mult = out[0][2]; msg = `${a}${a}${a} 잭팟! ×${mult}`; }
        else if (a === b || b === c || a === c) { mult = 1.4; msg = '두 개 같음 ×1.4'; }
        this.settle(stake, Math.round(stake * mult), msg);
      }
    }, 60);
  },

  // ----- 블랙잭 -----
  card() { const r = Math.floor(Math.random() * 13), s = ['♠', '♥', '♦', '♣'][Math.floor(Math.random() * 4)]; return { r, s, t: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][r] }; },
  score(h) { let v = 0, a = 0; for (const c of h) { v += c.r === 0 ? 11 : Math.min(10, c.r + 1); if (c.r === 0) a++; } while (v > 21 && a) { v -= 10; a--; } return v; },
  hand(h, hide) { return h.map((c, i) => hide && i === 1 ? '<i class="cz-card back">?</i>' : `<i class="cz-card${c.s === '♥' || c.s === '♦' ? ' red' : ''}">${c.t}${c.s}</i>`).join(''); },
  r_bj(G) {
    const B = this.bj;
    if (!B) { G.innerHTML = `<div class="cz-note">21에 가깝게. 딜러는 17 이상에서 멈춘다. 블랙잭 3:2, 더블다운 가능</div><button class="btn primary" id="cz-deal">카드 받기</button>`; G.querySelector('#cz-deal').onclick = () => this.deal(); return; }
    const done = B.done;
    G.innerHTML = `<div class="cz-note">딜러 ${done ? this.score(B.d) : '?'}</div><div class="cz-hand">${this.hand(B.d, !done)}</div>
      <div class="cz-note">나 ${this.score(B.p)}</div><div class="cz-hand">${this.hand(B.p)}</div>
      <div class="cz-row">${done ? '<button class="btn primary" id="cz-deal">다시 하기</button>' : '<button class="btn" id="cz-hit">한 장 더</button><button class="btn" id="cz-stand">멈춤</button>' + (B.p.length === 2 && this.money() >= B.stake ? '<button class="btn" id="cz-dbl">더블다운</button>' : '')}</div>`;
    const on = (id, f) => { const b = G.querySelector(id); if (b) b.onclick = f; };
    on('#cz-deal', () => this.deal()); on('#cz-hit', () => this.hit()); on('#cz-stand', () => this.stand()); on('#cz-dbl', () => this.dbl());
  },
  deal() {
    if (!this.take()) return;
    this.bj = { stake: this.bet, p: [this.card(), this.card()], d: [this.card(), this.card()], done: false };
    const B = this.bj;
    if (this.score(B.p) === 21) { B.done = true; const dbj = this.score(B.d) === 21; this.settle(B.stake, dbj ? B.stake : Math.round(B.stake * 2.5), dbj ? '둘 다 블랙잭 — 무승부' : '블랙잭! ×2.5'); }
    this.r_bj(this.el.querySelector('#cz-game'));
  },
  hit() { const B = this.bj; B.p.push(this.card()); if (this.score(B.p) > 21) { B.done = true; this.settle(B.stake, 0, `버스트 (${this.score(B.p)})`); } this.r_bj(this.el.querySelector('#cz-game')); },
  dbl() { const B = this.bj, P = Game.player; if (P.money < B.stake) return; P.money -= B.stake; B.stake *= 2; B.p.push(this.card()); if (this.score(B.p) > 21) { B.done = true; this.settle(B.stake, 0, `더블다운 버스트 (${this.score(B.p)})`); this.r_bj(this.el.querySelector('#cz-game')); } else this.stand(); },
  stand() {
    const B = this.bj; while (this.score(B.d) < 17) B.d.push(this.card());
    B.done = true;
    const p = this.score(B.p), d = this.score(B.d);
    if (d > 21 || p > d) this.settle(B.stake, B.stake * 2, `승리! ${p} 대 ${d}`);
    else if (p === d) this.settle(B.stake, B.stake, `무승부 ${p}`);
    else this.settle(B.stake, 0, `패배 ${p} 대 ${d}`);
    this.r_bj(this.el.querySelector('#cz-game'));
  },
};
