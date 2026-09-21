// Shops and their catalogues, plus the overlay the player buys from.
// The same overlay renders the contract board, so both read as one system.
import { money as fmtMoney } from './util.js';

export const CATALOG = {
  gun: {
    name: '무기상', tag: 'AMMU', color: 0xff2e6a,
    blurb: '허가된 총기와 방탄복을 취급합니다.',
    items: [
      { id: 'smg', name: 'SMG', desc: '연사 가능, 탄창 30발', price: 2200, kind: 'weapon', w: 2 },
      { id: 'a9', name: '9mm 탄약 45발', desc: '권총용', price: 180, kind: 'ammo', w: 1, amount: 45 },
      { id: 'a45', name: 'SMG 탄약 90발', desc: 'SMG용', price: 320, kind: 'ammo', w: 2, amount: 90 },
      { id: 'armor', name: '방탄복', desc: '피해의 60%를 대신 받습니다', price: 600, kind: 'armor', amount: 100 },
    ],
  },
  car: {
    name: '차량 대리점', tag: 'MOTORS', color: 0x38e0ff,
    blurb: '구매한 차량은 매장 앞에 인도되며 사라지지 않습니다.',
    items: [
      { id: 'sedan', name: '세단', desc: '무난한 시내 주행용 · 137km/h', price: 3500, kind: 'car', car: 'sedan' },
      { id: 'taxi', name: '택시', desc: '택시 영업(T)으로 합법 수입 · 130km/h', price: 4500, kind: 'car', car: 'taxi' },
      { id: 'van', name: '밴', desc: '튼튼하고 무겁습니다 · 108km/h', price: 5500, kind: 'car', car: 'van' },
      { id: 'suv', name: 'SUV', desc: '연석과 충돌에 강함 · 126km/h', price: 6500, kind: 'car', car: 'suv' },
      { id: 'sport', name: '스포츠카', desc: '최고 속도 198km/h', price: 16000, kind: 'car', car: 'sport' },
    ],
  },
  store: {
    name: '편의점', tag: '24H', color: 0x3ce08a,
    blurb: '',
    items: [
      { id: 'snack', name: '도시락', desc: '체력 40 회복', price: 90, kind: 'health', amount: 40 },
      { id: 'meds', name: '구급 키트', desc: '체력 전부 회복', price: 200, kind: 'health', amount: 100 },
    ],
  },
};

export class Overlay {
  constructor(game) {
    this.g = game;
    const el = this.el = document.createElement('div');
    el.className = 'screen hide';
    el.id = 'shop';
    el.innerHTML = `<div class="card shopcard">
        <div class="shophead">
          <div><div class="shoptag" id="shopTag"></div><div class="shopname" id="shopName"></div></div>
          <div class="shopcash" id="shopCash"></div>
        </div>
        <div class="shopblurb" id="shopBlurb"></div>
        <div class="shoplist" id="shopList"></div>
        <div class="btnrow"><button class="ghost" id="shopClose">닫기 (Esc)</button></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#shopClose').addEventListener('click', () => this.close());
    el.querySelector('#shopList').addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      this.onPick(this.entries[+b.dataset.i]);
      this.refresh();
    });
  }

  get open() { return !this.el.classList.contains('hide'); }

  /**
   * @param {object} head  {tag, name, blurb}
   * @param {array}  entries rows to show
   * @param {function} render entry -> {title, desc, price, note, disabled}
   * @param {function} onPick entry -> void
   */
  show(head, entries, render, onPick) {
    this.entries = entries;
    this.render = render;
    this.onPick = onPick;
    this.el.querySelector('#shopTag').textContent = head.tag || '';
    this.el.querySelector('#shopName').textContent = head.name;
    const bl = this.el.querySelector('#shopBlurb');
    bl.textContent = head.blurb || '';
    bl.style.display = head.blurb ? '' : 'none';
    this.refresh();
    this.el.classList.remove('hide');
    document.exitPointerLock && document.exitPointerLock();
  }

  refresh() {
    this.el.querySelector('#shopCash').textContent = fmtMoney(this.g.money);
    const list = this.el.querySelector('#shopList');
    list.innerHTML = this.entries.map((e, i) => {
      const r = this.render(e);
      return `<div class="shoprow">
        <div class="shopinfo">
          <div class="shopitem">${r.title}</div>
          <div class="shopdesc">${r.desc || ''}</div>
        </div>
        <button data-i="${i}" ${r.disabled ? 'disabled' : ''}>${r.note || fmtMoney(r.price)}</button>
      </div>`;
    }).join('');
  }

  close() {
    if (!this.open) return;
    this.el.classList.add('hide');
    this.onClose && this.onClose();
    this.g.input.requestLock();
  }
}
