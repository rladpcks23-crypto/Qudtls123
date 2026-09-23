'use strict';
/* =====================================================================
 * wardrobe.js — 옷 꾸미기 (옷가게에서 [꾸미기])
 *
 * 플레이어 외형: P.shirt · P.pants (색), P.hatType (HAT_TYPES 키), P.hatCol, P.logo (조직 id — 상의·모자에 마크)
 * 조직 마크는 가입한 조직(또는 내가 세운 조직)의 것만 달 수 있다. 마크를 달면 같은 조직원은 반기고
 * 라이벌 조직원은 멀리서도 알아보고 덤빈다(gangs.js의 gangSpots).
 * 2D: drawPlayerStyle(p) (render.js drawPed에서 호출) · 3D: View3D.makePed가 styleKey가 바뀌면 다시 만든다.
 * ===================================================================== */

const HAT_TYPES = { none: '없음', cap: '야구모자', beanie: '비니', fedora: '페도라', bandana: '반다나', helmet: '헬멧', crown: '보스 왕관' };
const CLOTH_COLS = ['#f2f2f2', '#1d1d1f', '#2b2d42', '#34495e', '#3b2618', '#7a7f86', '#b03a2e', '#e0443e', '#ff8fab', '#f2c14e', '#e07a1f', '#9be15d', '#1f8a4c', '#1f6f9b', '#6fe0ff', '#8a3bd1'];
const STYLE_KEYS = ['shirt', 'pants', 'hatType', 'hatCol', 'logo'];
const WARD_PRICE = { shirt: 150, pants: 120, hatType: 250, hatCol: 80, logo: 400 };
const styleKey = p => STYLE_KEYS.map(k => p[k] || '').join('|');

// 조직 마크: 조직 색 원 + 흰 테두리 + 약칭 글자
function drawGangLogo(g, id, x, y, r) {
  const G = GANGS[id]; if (!G) return;
  g.save(); g.translate(x, y);
  g.fillStyle = G.color; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(0.02, r * 0.18); g.stroke();
  if (r > 3) { g.fillStyle = '#fff'; g.font = `900 ${Math.round(r * 1.15)}px ${FONT_KR}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(G.short, 0, r * 0.08); }
  else { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -r * 0.55); g.lineTo(r * 0.5, 0); g.lineTo(0, r * 0.55); g.lineTo(-r * 0.5, 0); g.closePath(); g.fill(); }
  g.restore();
}

// 탑뷰 2D: 모자·마크 (drawPed 안, 몸 좌표계: +x = 앞)
function drawPlayerStyle(p) {
  if (p.logo && GANGS[p.logo]) drawGangLogo(ctx, p.logo, -0.06, 0, 0.1); // 등판 마크
  const h = p.hatType; if (!h || h === 'none') return;
  const c = p.hatCol || '#1d1d1f';
  ctx.fillStyle = c;
  if (h === 'cap') { ctx.beginPath(); ctx.arc(0.02, 0, 0.17, 0, TAU); ctx.fill(); ctx.fillStyle = shade(c, -0.25); ctx.fillRect(0.12, -0.1, 0.14, 0.2); }
  else if (h === 'beanie') { ctx.beginPath(); ctx.arc(0.01, 0, 0.175, 0, TAU); ctx.fill(); ctx.fillStyle = shade(c, 0.25); ctx.beginPath(); ctx.arc(0.01, 0, 0.06, 0, TAU); ctx.fill(); }
  else if (h === 'fedora') { ctx.beginPath(); ctx.arc(0.02, 0, 0.25, 0, TAU); ctx.fill(); ctx.fillStyle = shade(c, -0.3); ctx.beginPath(); ctx.arc(0.02, 0, 0.14, 0, TAU); ctx.fill(); }
  else if (h === 'bandana') { ctx.beginPath(); ctx.arc(0.02, 0, 0.165, Math.PI * 0.35, Math.PI * 1.65); ctx.fill(); ctx.fillRect(-0.24, -0.04, 0.1, 0.08); }
  else if (h === 'helmet') { ctx.beginPath(); ctx.arc(0.02, 0, 0.2, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(20,30,40,0.8)'; ctx.fillRect(0.1, -0.12, 0.1, 0.24); }
  else if (h === 'crown') { ctx.fillStyle = '#f2c14e'; for (let k = 0; k < 5; k++) { const a = k * TAU / 5; ctx.beginPath(); ctx.arc(0.02 + Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.06, 0, TAU); ctx.fill(); } }
  if (p.logo && GANGS[p.logo] && h !== 'crown') drawGangLogo(ctx, p.logo, 0.04, 0, 0.055);
}

// 정면 미리보기 (옷 꾸미기 창)
function drawStylePreview(g, o, W, H) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, W, H);
  const cx = W / 2, s = H / 190;
  g.save(); g.translate(cx, 12 * s); g.scale(s, s);
  // 다리
  g.fillStyle = o.pants; g.fillRect(-22, 104, 19, 66); g.fillRect(3, 104, 19, 66);
  g.fillStyle = '#222'; g.fillRect(-24, 166, 22, 8); g.fillRect(2, 166, 22, 8);
  // 몸통·팔
  g.fillStyle = o.shirt; g.fillRect(-28, 44, 56, 64); g.fillRect(-42, 46, 14, 52); g.fillRect(28, 46, 14, 52);
  g.fillStyle = '#e2b08a'; g.fillRect(-41, 96, 12, 12); g.fillRect(29, 96, 12, 12);
  if (o.logo && GANGS[o.logo]) drawGangLogo(g, o.logo, -12, 62, 9);
  // 머리
  g.fillStyle = '#e2b08a'; g.beginPath(); g.arc(0, 24, 18, 0, TAU); g.fill();
  g.fillStyle = '#1d1a18'; g.beginPath(); g.arc(0, 20, 18, Math.PI, TAU); g.fill();
  const h = o.hatType, c = o.hatCol || '#1d1d1f';
  g.fillStyle = c;
  if (h === 'cap') { g.beginPath(); g.arc(0, 16, 19, Math.PI, TAU); g.fill(); g.fillStyle = shade(c, -0.25); g.fillRect(-2, 13, 30, 5); }
  else if (h === 'beanie') { g.beginPath(); g.arc(0, 18, 20, Math.PI, TAU); g.fill(); g.fillRect(-20, 14, 40, 7); g.fillStyle = shade(c, 0.25); g.beginPath(); g.arc(0, -3, 5, 0, TAU); g.fill(); }
  else if (h === 'fedora') { g.fillRect(-30, 10, 60, 5); g.fillRect(-17, -6, 34, 17); g.fillStyle = shade(c, -0.35); g.fillRect(-17, 6, 34, 4); }
  else if (h === 'bandana') { g.beginPath(); g.arc(0, 18, 19, Math.PI, TAU); g.fill(); g.fillRect(16, 14, 10, 5); }
  else if (h === 'helmet') { g.beginPath(); g.arc(0, 22, 23, Math.PI * 0.95, Math.PI * 2.05); g.fill(); g.fillStyle = 'rgba(20,30,40,0.85)'; g.fillRect(-16, 20, 32, 9); }
  else if (h === 'crown') { g.fillStyle = '#f2c14e'; g.beginPath(); g.moveTo(-16, 8); g.lineTo(-16, -6); g.lineTo(-8, 2); g.lineTo(0, -10); g.lineTo(8, 2); g.lineTo(16, -6); g.lineTo(16, 8); g.closePath(); g.fill(); }
  if (o.logo && GANGS[o.logo] && (h === 'cap' || h === 'beanie' || h === 'helmet')) drawGangLogo(g, o.logo, 0, h === 'helmet' ? 10 : 8, 5);
  g.restore();
}

const Wardrobe = {
  draft: null,
  logoChoices() {
    const out = [''];
    if (Gangs.mine) out.push(Gangs.mine);
    return out;
  },
  hatChoices() { return Object.keys(HAT_TYPES).filter(k => k !== 'crown' || (Gangs.mine && Gangs.rank >= 2)); },
  open() {
    const P = Game.player; if (P.dead) return;
    this.draft = {}; for (const k of STYLE_KEYS) this.draft[k] = P[k] || (k === 'hatType' ? 'none' : k === 'hatCol' ? '#1d1d1f' : k === 'logo' ? '' : P[k]);
    Game.state = 'ward'; this.el = document.getElementById('wardui'); this.el.hidden = false;
    this.render();
  },
  close() { if (this.el) this.el.hidden = true; if (Game.state === 'ward') Game.state = 'play'; Game.shopCool = 4; },
  cost() { const P = Game.player; let c = 0; for (const k of STYLE_KEYS) if ((this.draft[k] || '') !== (P[k] || (k === 'hatType' ? 'none' : k === 'hatCol' ? '#1d1d1f' : ''))) c += WARD_PRICE[k]; return c; },
  buy() {
    const P = Game.player, c = this.cost();
    if (!c) { this.close(); return; }
    if (P.money < c) { UI.toast('돈이 모자란다'); return; }
    P.money -= c; for (const k of STYLE_KEYS) P[k] = this.draft[k];
    Sfx.cash();
    if (Wanted.stars > 0 && !Wanted.seen) { Wanted.drop(1); UI.toast('옷을 바꿔 입었다 — 변장으로 수배 ★ -1'); } else UI.toast(P.logo ? `${GANGS[P.logo].name} 마크를 달았다` : '새 옷으로 갈아입었다');
    Save.write(); this.close();
  },
  render() {
    const d = this.draft, P = Game.player;
    const cv = document.getElementById('ward-prev'); drawStylePreview(cv.getContext('2d'), d, cv.width, cv.height);
    const c = this.cost();
    document.getElementById('ward-cost').textContent = c ? `바꾼 것 합계 $${c.toLocaleString()} (가진 돈 $${P.money.toLocaleString()})` : '바꾼 것이 없다';
    const L = document.getElementById('ward-opts'); L.innerHTML = '';
    const row = (title, items) => { const r = document.createElement('div'); r.className = 'ward-row'; const t = document.createElement('div'); t.className = 'ward-t'; t.textContent = title; const box = document.createElement('div'); box.className = 'ward-items'; for (const it of items) box.append(it); r.append(t, box); L.append(r); };
    const sw = (key, col) => { const b = document.createElement('button'); b.className = 'ward-sw' + (d[key] === col ? ' on' : ''); b.style.background = col; b.onclick = () => { d[key] = col; this.render(); }; return b; };
    const tb = (key, val, label) => { const b = document.createElement('button'); b.className = 'btn small ward-tb' + ((d[key] || '') === val ? ' primary' : ''); b.textContent = label; b.onclick = () => { d[key] = val; this.render(); }; return b; };
    row(`상의 $${WARD_PRICE.shirt}`, CLOTH_COLS.map(c => sw('shirt', c)));
    row(`하의 $${WARD_PRICE.pants}`, CLOTH_COLS.map(c => sw('pants', c)));
    row(`모자 $${WARD_PRICE.hatType}`, this.hatChoices().map(k => tb('hatType', k, HAT_TYPES[k])));
    if (d.hatType !== 'none' && d.hatType !== 'crown') row(`모자 색 $${WARD_PRICE.hatCol}`, CLOTH_COLS.map(c => sw('hatCol', c)));
    const lc = this.logoChoices();
    row(`조직 마크 $${WARD_PRICE.logo}`, lc.length > 1 ? lc.map(g => tb('logo', g, g ? GANGS[g].name : '없음')) : [Object.assign(document.createElement('span'), { className: 'cz-note', textContent: '조직에 들어가거나 조직을 세우면 마크를 달 수 있다' })]);
  },
};
SHOPS.clothes.items = ((base) => () => [{ id: 'wardrobe', name: '옷 꾸미기 — 색 · 모자 · 조직 마크', price: 0, btn: '꾸미기', desc: '상의·하의 색, 모자 7종, 가입한 조직 마크', ok: () => true, fn: () => { Shop.close(); Wardrobe.open(); } }, ...base()])(SHOPS.clothes.items);
