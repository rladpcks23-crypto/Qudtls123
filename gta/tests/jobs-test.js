const { chromium } = require(process.env.NODE_PATH_PW || 'playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 4).join(' | ')));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errs.push('console: ' + m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../build') + '/neon-harbor-pc.html'); await p.waitForTimeout(1200);
  await p.click('#btn-new'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const out = []; Game.noWanted = true;
    const step = (sec) => { for (let t = 0; t < sec; t += 1 / 30) { if (Game.state !== 'play') Game.state = 'play'; Game.update(1 / 30); } };
    const inBase = (o) => o && Military.inside(o.x, o.y);
    for (const id of Object.keys(JOBS)) {
      const P = Game.player; if (P.car) exitCar(P, true); P.hp = 100;
      Jobs.start(id); const j = Jobs.active; let bad = 0;
      for (let k = 0; k < 60 && Jobs.active === j; k++) {
        const bl = j.blips[0];
        for (const q of [j.dest, j.pick, ...(j.orders || []), j.fare, j.patient]) if (inBase(q)) bad++;
        if (bl) {
          const e = bl.ent, x = e ? (e.px ?? e.x) : bl.x, y = e ? (e.py ?? e.y) : bl.y;
          if (e && e.kind === 'car' && P.car !== e) { if (P.car) exitCar(P, true); P.x = e.x + 3; P.y = e.y; tryEnterCar(P); }
          else if (P.car) { const c = P.car; const a = Math.atan2(y - c.y, x - c.x); c.x = x - Math.cos(a) * 3; c.y = y - Math.sin(a) * 3; c.vx = c.vy = 0; }
          else { P.x = x; P.y = y; }
          if (id === 'pickpocket' && e && !P.car) { P.x = e.x - Math.cos(e.a) * 1; P.y = e.y - Math.sin(e.a) * 1; P.vx = P.vy = 0; Pick.scan(); if (Pick.target) Pick.attempt(); }
        }
        step(1);
      }
      out.push(`${id}: count ${j.count} earned ${j.earned} inBase ${bad} active ${Jobs.active === j}`);
      Jobs.stop();
    }
    return out;
  });
  console.log(r.join('\n'));
  console.log([...new Set(errs)].slice(0, 10).join('\n')); await b.close();
})();
