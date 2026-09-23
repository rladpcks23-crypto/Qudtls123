const { chromium } = require(process.env.NODE_PATH_PW || 'playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 4).join(' | ')));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../build') + '/neon-harbor-pc.html'); await p.waitForTimeout(1200);
  await p.click('#btn-new'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const out = { errs: [], nan: [] };
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'];
    const R = (n) => Math.floor(Math.random() * n);
    const chk = (tag) => {
      const P = Game.player;
      if (!isFinite(P.x) || !isFinite(P.y)) out.nan.push(tag + ' player ' + P.x);
      for (const c of Game.cars) if (!isFinite(c.x) || !isFinite(c.vx) || !isFinite(c.a)) { out.nan.push(tag + ' car ' + c.type); c.remove = true; }
      for (const q of Game.peds) if (!isFinite(q.x) || !isFinite(q.y)) { out.nan.push(tag + ' ped ' + q.kind + ' ' + q.state); q.remove = true; }
    };
    const t0 = performance.now();
    for (let step = 0; step < 60 * 400; step++) {
      if (step % 90 === 0) { for (const k of keys) Input.keys[k] = Math.random() < 0.35; Input.mouse.down = Math.random() < 0.2; Input.mouse.x = R(1280); Input.mouse.y = R(720); }
      if (step % 600 === 0) {
        const P = Game.player, a = R(10);
        try {
          if (a === 0 && !P.car) tryEnterCar(P);
          if (a === 1 && P.car) exitCar(P);
          if (a === 2) Wanted.set(1 + R(5));
          if (a === 3) Wanted.clear();
          if (a === 4) { P.weapon = pick(['pistol', 'smg', 'shotgun', 'rifle', 'grenade', 'rocket']); giveWeapon(P, P.weapon, 50); }
          if (a === 5) { const c = Game.cars[R(Game.cars.length)]; if (c && !c.dead) { if (P.car) exitCar(P, true); P.x = c.x + 3; P.y = c.y; tryEnterCar(P); } }
          if (a === 6) { if (P.car) exitCar(P, true); const B = World.base, s = pick(Military.slots); if (s && s.car) { P.x = s.car.x + 3; P.y = s.car.y; tryEnterCar(P); } else { P.x = (B.x0 + B.x1) / 2; P.y = B.y1 + 10; } }
          if (a === 7) { P.x = rand(50, MW * T - 50); P.y = rand(50, MH * T - 50); }
          if (a === 8) Game.weather.intensity = Math.random();
          if (a === 9) Game.clock = R(1440);
        } catch (e) { out.errs.push('action ' + a + ': ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
      }
      try { if (Game.state === 'shop' || Game.state === 'paused' || Game.state === 'map') { if (Game.state === 'shop') { try { Shop.close(); Jobs.closeBoard(); } catch (e) {} } Game.state = 'play'; } if (step % 4 === 0) Game.frame(1 / 60); else if (Game.state === 'play') Game.update(1 / 60); else Game.frame(1/60); endFrameInput(); } catch (e) { out.errs.push(e.stack.split('\n').slice(0, 4).join(' | ')); if (out.errs.length > 30) break; }
      if (step % 300 === 0) chk(step);
    }
    out.ms = Math.round(performance.now() - t0); out.cars = Game.cars.length; out.peds = Game.peds.length; out.state2 = Game.state; out.deaths = Game.stats;
    return out;
  });
  const u = [...new Set(r.errs)]; r.errs = u.slice(0, 15); r.nan = [...new Set(r.nan)].slice(0, 10);
  console.log(JSON.stringify(r, null, 1));
  console.log([...new Set(errs)].slice(0, 10).join('\n')); await b.close();
})();
