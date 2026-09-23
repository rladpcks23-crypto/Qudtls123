const { chromium } = require(process.env.NODE_PATH_PW || 'playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 4).join(' | ')));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errs.push('console: ' + m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../build') + '/neon-harbor-pc.html'); await p.waitForTimeout(1200);
  await p.click('#btn-new'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const out = []; const of = Missions.fail.bind(Missions); Missions.fail = (r) => { out.push('   FAIL: ' + r + ' t=' + (Missions.active && Missions.active.t.toFixed(1))); of(r); };
    const step = (sec) => { for (let t = 0; t < sec; t += 1 / 30) { if (Game.state !== 'play') { if (Game.state === 'wasted' || Game.state === 'busted') { Game.frame(1 / 30); continue; } Game.state = 'play'; } Game.update(1 / 30); } };
    for (let i = 0; i < Missions.defs.length; i++) {
      const P = Game.player; P.hp = 100; if (P.car) exitCar(P, true);
      Wanted.clear(); Game.noWanted = false; Missions.active = null; Missions.idx = i; Missions.cool = 0;
      Missions.start(i);
      const m = Missions.active, log = [m.def.title];
      for (let k = 0; k < 40 && Missions.active === m; k++) {
        // 목표 쪽으로 순간이동/차 타기 흉내
        const bl = m.blips.find(b => !b.ent || !b.ent.dead);
        if (bl) {
          const e = bl.ent, x = e ? (e.px ?? e.x) : bl.x, y = e ? (e.py ?? e.y) : bl.y;
          if (e && e.kind === 'car' && !e.dead && Game.player.car !== e && !e.driver) { if (Game.player.car) exitCar(Game.player, true); Game.player.x = e.x + 3; Game.player.y = e.y; tryEnterCar(Game.player); }
          else if (e && e.kind !== 'car' && !e.dead && k > 5) { e.damage(999, Game.player, 1, 0); }
          else if (Game.player.car) { const c = Game.player.car; c.x = x; c.y = y; c.vx = c.vy = 0; } else { Game.player.x = x; Game.player.y = y; }
        }
        if (Wanted.stars > 0 && k % 3 === 0) Wanted.clear();
        step(1);
        if (m.kills !== undefined && m.def.title.includes('소탕')) { for (const q of Game.peds) if (q.mission === m && !q.dead) q.damage(999, Game.player, 1, 0); }
        if (m.trucks) for (const t of m.trucks) if (!t.dead) { t.damage(99999, Game.player); }
      }
      log.push(Missions.active === m ? 'still active: ' + m.objective : 'ended');
      if (Missions.active) Missions.fail('test');
      out.push(log.join(' → ') + ' | money ' + Game.player.money + ' idx ' + Missions.idx);
    }
    return out;
  });
  console.log(r.join('\n'));
  console.log([...new Set(errs)].slice(0, 10).join('\n')); await b.close();
})();
