'use strict';
/* =====================================================================
 * view3d.js — 3D 시점 (3인칭 후면 · 3인칭 전면 · 1인칭)
 *
 * 게임 로직은 그대로 2D(x, y)에서 돌고, 이 모듈은 같은 세계를 Three.js로 다시 그린다.
 *  - 2D 좌표 (x, y) → 3D (x, 높이, z=y). 2D 방향각 a → 메시 rotation.y = −a
 *  - 지면: 기존 2D 지면 그리기 함수로 도시 전체를 한 장의 텍스처로 구워 평면에 입힌다.
 *  - 건물: 전부 하나의 지오메트리로 합쳐 드로우콜 1회. 창문은 반복 텍스처 + 밤에는 발광.
 *  - 나무·가로등·신호등: InstancedMesh. 차·사람: 필요할 때 만들고 매 프레임 위치만 갱신.
 *  - 카메라가 벽 뒤로 들어가면 GTA처럼 벽 앞으로 당긴다(2D 광선으로 판정).
 * ===================================================================== */

const VIEW_NAMES = { top: '탑뷰', chase: '3인칭 (후면)', front: '3인칭 (전면)', fps: '1인칭' };
const VIEW_ORDER = ['top', 'chase', 'front', 'fps'];

const View3D = {
  ok: false, failed: false, yaw: 0, lookDX: 0, pitch: 0,
  cars: new Map(), peds: new Map(), mats: new Map(),
  init() {
    if (this.ok || this.failed) return this.ok;
    if (typeof THREE === 'undefined') { this.failed = true; return false; }
    try {
      const cv = this.canvas = document.getElementById('view3d');
      const R = this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
      R.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.25 : 1.75));
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
      this.scene.fog = new THREE.Fog(0x9fc7e8, 60, 170);
      this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5a48, 0.9); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xffffff, 0.8); this.sun.position.set(-0.5, 1, 0.35); this.scene.add(this.sun);
      this.buildStatic();
      this.buildDynamicShared();
      this.resize();
      this.ok = true;
    } catch (e) { console.error(e); this.failed = true; this.ok = false; }
    return this.ok;
  },
  resize() { if (!this.renderer) return; this.renderer.setSize(CW, CH, false); this.canvas.style.width = CW + 'px'; this.canvas.style.height = CH + 'px'; this.camera.aspect = CW / CH; this.camera.updateProjectionMatrix(); },
  mat(color, opt = {}) {
    const key = color + JSON.stringify(opt);
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshLambertMaterial({ color, ...opt }));
    return this.mats.get(key);
  },

  // ---------- 정적 세계 ----------
  buildStatic() {
    const S = this.scene;
    // 지면 텍스처: 기존 2D 지면 렌더러를 오프스크린 캔버스에 도시 전체 크기로 실행
    const size = IS_MOBILE ? 2048 : 4096, ppm = size / (MW * T);
    const gc = document.createElement('canvas'); gc.width = gc.height = size;
    const g = gc.getContext('2d');
    const saveCtx = ctx, saveCam = { ...Cam };
    ctx = g; Object.assign(Cam, { x: MW * T / 2, y: MH * T / 2, ppm, vw: MW * T, vh: MH * T, rot: 0, sx: 0, sy: 0 });
    g.setTransform(ppm, 0, 0, ppm, 0, 0);
    try { drawGround([1, 1, 1]); } finally { ctx = saveCtx; Object.assign(Cam, saveCam); }
    const tex = new THREE.CanvasTexture(gc);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MW * T, MH * T), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(MW * T / 2, 0, MH * T / 2);
    S.add(ground);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x1d5a80 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(MW * T / 2, -0.05, MH * T / 2); S.add(sea);

    // 창문 텍스처 (흰 바탕 = 정점 색 그대로, 창 = 어두운 유리) + 밤 발광 맵
    const wc = document.createElement('canvas'); wc.width = wc.height = 64;
    const w = wc.getContext('2d'); w.fillStyle = '#ffffff'; w.fillRect(0, 0, 64, 64); w.fillStyle = '#3a4656'; w.fillRect(8, 16, 48, 30); w.fillStyle = 'rgba(255,255,255,0.25)'; w.fillRect(8, 16, 48, 4);
    const ec = document.createElement('canvas'); ec.width = ec.height = 64;
    const e = ec.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, 64, 64); e.fillStyle = '#ffd98a'; e.fillRect(8, 16, 48, 30);
    const winTex = new THREE.CanvasTexture(wc), emTex = new THREE.CanvasTexture(ec);
    for (const t of [winTex, emTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
    const pos = [], nor = [], uv = [], col = [];
    const color = new THREE.Color();
    const quad = (a, b, c, d, n, uvs, rgb) => {
      for (const [p, u] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) { pos.push(...p); nor.push(...n); uv.push(...u); col.push(rgb.r, rgb.g, rgb.b); }
    };
    const SOLID = [[0.02, 0.98], [0.03, 0.98], [0.03, 0.97], [0.02, 0.97]];
    for (const b of World.buildings) {
      const X0 = b.x0 * T, Z0 = b.y0 * T, X1 = (b.x1 + 1) * T, Z1 = (b.y1 + 1) * T, H = b.h;
      const hasWin = b.kind !== 'container' && b.kind !== 'house' && b.kind !== 'warehouse' && H > 5;
      const wallUV = (len) => hasWin ? [[0, 0], [len / 3, 0], [len / 3, H / 3.4], [0, H / 3.4]] : SOLID;
      const base = color.set(b.color).clone();
      const side = f => base.clone().multiplyScalar(f);
      quad([X0, 0, Z1], [X1, 0, Z1], [X1, H, Z1], [X0, H, Z1], [0, 0, 1], wallUV(X1 - X0), side(0.8));   // 남
      quad([X1, 0, Z0], [X0, 0, Z0], [X0, H, Z0], [X1, H, Z0], [0, 0, -1], wallUV(X1 - X0), side(0.95)); // 북
      quad([X1, 0, Z1], [X1, 0, Z0], [X1, H, Z0], [X1, H, Z1], [1, 0, 0], wallUV(Z1 - Z0), side(0.7));   // 동
      quad([X0, 0, Z0], [X0, 0, Z1], [X0, H, Z1], [X0, H, Z0], [-1, 0, 0], wallUV(Z1 - Z0), side(0.88)); // 서
      const roofC = b.kind === 'house' ? base.clone().multiplyScalar(0.7) : b.kind === 'hospital' ? color.set('#f4f4f4').clone() : b.kind === 'police' ? color.set('#2c3e66').clone() : base.clone().multiplyScalar(1.05);
      if (b.kind === 'house') { // 박공지붕
        const along = (X1 - X0) >= (Z1 - Z0), rH = H + 2.2;
        if (along) {
          const zm = (Z0 + Z1) / 2;
          quad([X0, H, Z1], [X1, H, Z1], [X1, rH, zm], [X0, rH, zm], [0, 0.7, 0.7], SOLID, roofC);
          quad([X1, H, Z0], [X0, H, Z0], [X0, rH, zm], [X1, rH, zm], [0, 0.7, -0.7], SOLID, roofC.clone().multiplyScalar(0.85));
          quad([X0, H, Z0], [X0, H, Z1], [X0, rH, zm], [X0, rH, zm], [-1, 0, 0], SOLID, side(0.8));
          quad([X1, H, Z1], [X1, H, Z0], [X1, rH, zm], [X1, rH, zm], [1, 0, 0], SOLID, side(0.7));
        } else {
          const xm = (X0 + X1) / 2;
          quad([X1, H, Z1], [X1, H, Z0], [xm, rH, Z0], [xm, rH, Z1], [0.7, 0.7, 0], SOLID, roofC);
          quad([X0, H, Z0], [X0, H, Z1], [xm, rH, Z1], [xm, rH, Z0], [-0.7, 0.7, 0], SOLID, roofC.clone().multiplyScalar(0.85));
          quad([X0, H, Z1], [X1, H, Z1], [xm, rH, Z1], [xm, rH, Z1], [0, 0, 1], SOLID, side(0.8));
          quad([X1, H, Z0], [X0, H, Z0], [xm, rH, Z0], [xm, rH, Z0], [0, 0, -1], SOLID, side(0.9));
        }
      } else quad([X0, H, Z1], [X1, H, Z1], [X1, H, Z0], [X0, H, Z0], [0, 1, 0], SOLID, roofC);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.bmat = new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex, emissive: 0xffffff, emissiveMap: emTex, emissiveIntensity: 0 });
    S.add(new THREE.Mesh(geo, this.bmat));

    // 나무 (줄기 + 수관)
    const trees = World.trees;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), this.mat('#6b4a2a'), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
    trees.forEach((t, i) => {
      m4.compose(p3.set(t.x, t.h * 0.4, t.y), q.identity(), sc.set(1, t.h * 0.8, 1)); trunk.setMatrixAt(i, m4);
      const palm = t.kind === 'palm';
      m4.compose(p3.set(t.x, t.h * (palm ? 0.95 : 0.8), t.y), q.identity(), palm ? sc.set(t.r * 0.9, 0.5, t.r * 0.9) : sc.set(t.r, t.r * 0.9, t.r)); crown.setMatrixAt(i, m4);
      crown.setColorAt(i, color.set(palm ? '#3f8a3a' : t.hue < 0.33 ? '#3d6e34' : t.hue < 0.66 ? '#467a3a' : '#355f30'));
    });
    S.add(trunk, crown);
    // 가로등
    const L = World.lamps;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 5), this.mat('#2b2d31'), L.length);
    this.lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), L.length);
    L.forEach((l, i) => { m4.makeTranslation(l.x, 2.5, l.y); pole.setMatrixAt(i, m4); m4.makeTranslation(l.x, 5.05, l.y); this.lampHeads.setMatrixAt(i, m4); });
    S.add(pole, this.lampHeads);
    // 신호등 (진입로마다 하나, 색은 매 프레임 갱신)
    this.tl = [];
    for (const n of World.nodes) {
      if (!n.light) continue;
      for (let d = 0; d < 4; d++) {
        if (n.adj[(d + 2) % 4] < 0) continue;
        const r = rightOf(d);
        this.tl.push({ n, d, x: n.x - DIRS[d][0] * (2 * T + 0.3) + r[0] * (T + 0.6), y: n.y - DIRS[d][1] * (2 * T + 0.3) + r[1] * (T + 0.6) });
      }
    }
    const tp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 5), this.mat('#1b1d21'), this.tl.length);
    this.tlHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.tl.length);
    this.tl.forEach((t, i) => { m4.makeTranslation(t.x, 1.8, t.y); tp.setMatrixAt(i, m4); m4.makeTranslation(t.x, 3.7, t.y); this.tlHeads.setMatrixAt(i, m4); this.tlHeads.setColorAt(i, color.set('#39e36b')); });
    S.add(tp, this.tlHeads);
  },
  buildDynamicShared() {
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10),
      head: new THREE.SphereGeometry(0.14, 10, 8),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
    };
    // 파티클 (불·연기·불꽃·피)
    const N = 1000;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    // 총알 궤적
    this.trGeo = new THREE.BufferGeometry(); this.trPos = new Float32Array(200 * 6);
    this.trGeo.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3));
    this.tracers = new THREE.LineSegments(this.trGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8 })); this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    // 폭발 구체, 마커 기둥, 픽업, 헬기
    this.booms = []; for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.8 })); m.visible = false; this.scene.add(m); this.booms.push(m); }
    this.markers = []; for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(this.geo.cyl, new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); m.visible = false; this.scene.add(m); this.markers.push(m); }
    this.pickups = []; for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(this.geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 })); m.visible = false; m.scale.set(0.5, 0.5, 0.5); this.scene.add(m); this.pickups.push(m); }
    const heli = this.heli = new THREE.Group();
    const hb = new THREE.Mesh(this.geo.box, this.mat('#e8e8e8')); hb.scale.set(4.2, 1.6, 2); heli.add(hb);
    const tail = new THREE.Mesh(this.geo.box, this.mat('#1c2a4a')); tail.scale.set(3.4, 0.4, 0.4); tail.position.set(-3.6, 0.3, 0); heli.add(tail);
    this.rotor = new THREE.Mesh(this.geo.box, this.mat('#222')); this.rotor.scale.set(9, 0.08, 0.35); this.rotor.position.y = 1.1; heli.add(this.rotor);
    heli.visible = false; this.scene.add(heli);
  },

  // ---------- 차량 메시 ----------
  makeCar(c) {
    const g = new THREE.Group(), L = c.L, W = c.W, st = c.V.style, box = this.geo.box;
    const add = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
    g.userData.body = [];
    const bodyMat = new THREE.MeshLambertMaterial({ color: c.color });
    g.userData.bodyMat = bodyMat;
    const glass = this.mat('#1b2735');
    if (st === 'tank') {
      const dark = this.mat('#1c1e21');
      for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) add(dark, L, 1.1, 0.8, 0, 0.55, z);
      add(bodyMat, L * 0.92, 0.8, W - 1.5, 0, 1.0, 0);
      add(bodyMat, L * 0.96, 0.18, W * 1.02, 0, 1.2, 0);
      const tur = new THREE.Group(); tur.position.set(-0.3, 1.4, 0); g.add(tur);
      const tb = new THREE.Mesh(box, bodyMat); tb.scale.set(3.4, 0.9, 2.5); tb.position.set(0, 0.45, 0); tur.add(tb);
      const gun = new THREE.Mesh(box, this.mat('#2f3a26')); gun.scale.set(4.6, 0.3, 0.3); gun.position.set(3.8, 0.5, 0); tur.add(gun);
      g.userData.turret = tur;
    } else if (st === 'milheli') {
      add(bodyMat, 4.8, 1.5, 1.4, 0.4, 1.4, 0);
      add(glass, 1.6, 0.9, 1.2, 2.5, 1.5, 0);
      add(bodyMat, 4.4, 0.5, 0.5, -3.6, 1.7, 0);
      add(bodyMat, 0.5, 1.5, 0.15, -5.6, 2.2, 0);
      add(this.mat('#2f3a26'), 1.0, 0.4, 3.8, 0, 1.2, 0);
      for (const z of [-0.8, 0.8]) add(this.mat('#222'), 3.6, 0.1, 0.1, 0.2, 0.2, z);
      add(this.mat('#222'), 0.4, 0.5, 0.4, 0.3, 2.4, 0);
      const rot = new THREE.Mesh(box, this.mat('#222')); rot.scale.set(11, 0.08, 0.4); rot.position.set(0.3, 2.7, 0); g.add(rot);
      const rot2 = new THREE.Mesh(box, this.mat('#222')); rot2.scale.set(0.4, 0.08, 11); rot2.position.set(0.3, 2.7, 0); g.add(rot2);
      g.userData.rotor = [rot, rot2];
    } else if (st === 'jet') {
      add(bodyMat, L * 0.85, 1.2, 1.3, -0.3, 1.5, 0);
      add(bodyMat, 1.6, 0.8, 0.9, L * 0.45, 1.5, 0);
      add(glass, 2.4, 0.6, 0.8, L * 0.2, 2.3, 0);
      add(bodyMat, 3.0, 0.15, 9.2, -1.4, 1.4, 0);
      add(bodyMat, 1.4, 0.12, 4.0, -L * 0.42, 1.6, 0);
      for (const z of [-0.8, 0.8]) add(bodyMat, 1.6, 1.8, 0.12, -L * 0.4, 2.6, z);
      add(new THREE.MeshBasicMaterial({ color: 0xff9a40 }), 0.2, 0.7, 0.7, -L * 0.5 - 0.3, 1.5, 0).name = 'flame';
      for (const [x, z] of [[L * 0.3, 0], [-1.5, 1.2], [-1.5, -1.2]]) add(this.mat('#111'), 0.5, 0.8, 0.3, x, 0.4, z);
      g.userData.flame = g.getObjectByName('flame');
    } else if (st === 'bike') {
      add(this.mat('#2b2d31'), L * 0.9, 0.3, 0.22, 0, 0.55, 0);
      add(bodyMat, 0.8, 0.35, 0.4, 0.2, 0.85, 0);
      for (const x of [-L * 0.33, L * 0.33]) { const w = new THREE.Mesh(this.geo.wheel, this.mat('#111')); w.rotation.x = Math.PI / 2; w.scale.set(1, 0.4, 1); w.position.set(x, 0.34, 0); g.add(w); }
      const rider = new THREE.Group(); rider.name = 'rider';
      const t = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: '#2b2d42' })); t.scale.set(0.35, 0.65, 0.45); t.position.set(-0.15, 1.35, 0); rider.add(t);
      const h = new THREE.Mesh(this.geo.head, this.mat('#111')); h.scale.setScalar(1.3); h.position.set(-0.05, 1.82, 0); rider.add(h);
      g.add(rider); g.userData.rider = rider; g.userData.riderMat = t.material;
    } else {
      const tall = st === 'truck' || st === 'armored' ? 2.5 : st === 'van' || st === 'swat' || st === 'ambulance' ? 1.9 : st === 'sports' ? 0.95 : 1.25;
      const bodyH = st === 'sports' ? 0.55 : 0.7;
      if (st === 'truck' || st === 'armored') {
        add(st === 'armored' ? bodyMat : this.mat('#e6e6e6'), L * 0.68, tall - 0.4, W, -L * 0.15, 0.35 + (tall - 0.4) / 2, 0);
        add(bodyMat, L * 0.28, tall - 0.6, W * 0.96, L * 0.35, 0.35 + (tall - 0.6) / 2, 0);
        add(glass, 0.08, 0.6, W * 0.8, L * 0.49, tall - 0.55, 0);
      } else if (st === 'van' || st === 'swat' || st === 'ambulance') {
        add(bodyMat, L, tall - 0.3, W, 0, 0.3 + (tall - 0.3) / 2, 0);
        add(glass, 0.1, 0.55, W * 0.86, L / 2 - 0.3, tall - 0.55, 0);
        add(glass, L * 0.55, 0.4, W * 1.01, L * 0.1, tall - 0.6, 0);
        if (st === 'ambulance') add(this.mat('#d7262e'), L * 1.01, 0.18, W * 1.01, 0, 1.0, 0);
      } else {
        add(bodyMat, L, bodyH, W, 0, 0.3 + bodyH / 2, 0);
        const cabL = st === 'sports' ? L * 0.38 : L * 0.5, cabX = st === 'sports' ? -L * 0.05 : -L * 0.06;
        const cab = add(glass, cabL, tall - bodyH - 0.3, W * 0.86, cabX, 0.3 + bodyH + (tall - bodyH - 0.3) / 2, 0);
        const roof = add(bodyMat, cabL * 0.8, 0.06, W * 0.84, cabX - cabL * 0.05, 0.3 + tall - 0.3 + 0.03, 0);
        g.userData.cab = [cab, roof];
      }
      for (const [x, z] of [[L * 0.32, W / 2 - 0.1], [L * 0.32, -W / 2 + 0.1], [-L * 0.32, W / 2 - 0.1], [-L * 0.32, -W / 2 + 0.1]]) { const w = new THREE.Mesh(this.geo.wheel, this.mat('#111')); w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w); }
      const hl = new THREE.MeshBasicMaterial({ color: 0xfff7d6 }), tlm = new THREE.MeshBasicMaterial({ color: 0x8a1a1a });
      for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) { add(hl, 0.06, 0.16, 0.36, L / 2 + 0.01, 0.75, z); add(tlm, 0.06, 0.16, 0.36, -L / 2 - 0.01, 0.8, z); }
      g.userData.tail = tlm;
      if (st === 'police' || st === 'ambulance' || st === 'swat') {
        const r = new THREE.MeshBasicMaterial({ color: 0xff2d2d }), b = new THREE.MeshBasicMaterial({ color: 0x2d6bff });
        add(r, 0.35, 0.15, W * 0.4, -0.2, tall + 0.08, -W * 0.22); add(st === 'ambulance' ? r : b, 0.35, 0.15, W * 0.4, -0.2, tall + 0.08, W * 0.22);
        g.userData.siren = [r, b];
      }
      if (st === 'taxi') add(this.mat('#ffe680'), 0.4, 0.2, 0.8, -0.3, tall + 0.1, 0);
      if (st === 'police') { add(this.mat('#16181c'), L * 0.3, bodyH * 1.01, W * 1.01, L * 0.35, 0.3 + bodyH / 2, 0); }
    }
    this.scene.add(g);
    return g;
  },
  // ---------- 사람 메시 ----------
  makePed(p) {
    const g = new THREE.Group(), box = this.geo.box;
    if (p.kind === 'dog') {
      const m = new THREE.MeshLambertMaterial({ color: p.coat || '#c8a26b' });
      const b = new THREE.Mesh(box, m); b.scale.set(0.7, 0.3, 0.26); b.position.y = 0.4; g.add(b);
      const h = new THREE.Mesh(box, m); h.scale.set(0.25, 0.24, 0.22); h.position.set(0.42, 0.55, 0); g.add(h);
      for (const [x, z] of [[0.25, 0.1], [0.25, -0.1], [-0.25, 0.1], [-0.25, -0.1]]) { const l = new THREE.Mesh(box, m); l.scale.set(0.08, 0.28, 0.08); l.position.set(x, 0.14, z); g.add(l); }
      this.scene.add(g); return g;
    }
    const shirt = new THREE.MeshLambertMaterial({ color: p.shirt }), pants = new THREE.MeshLambertMaterial({ color: p.pants });
    const legs = [];
    for (const z of [-0.11, 0.11]) { const piv = new THREE.Group(); piv.position.set(0, 0.88, z); const l = new THREE.Mesh(box, pants); l.scale.set(0.18, 0.86, 0.18); l.position.y = -0.43; piv.add(l); g.add(piv); legs.push(piv); }
    const t = new THREE.Mesh(box, shirt); t.scale.set(0.3, 0.62, 0.5); t.position.y = 1.2; g.add(t);
    const arms = [];
    for (const z of [-0.31, 0.31]) { const piv = new THREE.Group(); piv.position.set(0, 1.46, z); const a = new THREE.Mesh(box, shirt); a.scale.set(0.13, 0.6, 0.13); a.position.y = -0.3; piv.add(a); g.add(piv); arms.push(piv); }
    const head = new THREE.Mesh(this.geo.head, new THREE.MeshLambertMaterial({ color: p.skin })); head.position.y = 1.65; head.scale.setScalar(1.05); g.add(head);
    const hairC = p.kind === 'cop' ? '#15213f' : p.kind === 'gang' ? (GANGS[p.gang] || GANGS.dragon).band : p.hat || p.hair;
    const hair = new THREE.Mesh(this.geo.head, new THREE.MeshLambertMaterial({ color: hairC })); hair.position.set(-0.03, 1.7, 0); hair.scale.set(1.05, 0.75, 1.1); g.add(hair);
    const gun = new THREE.Mesh(box, this.mat('#1a1a1a')); gun.scale.set(0.5, 0.1, 0.08); gun.position.set(0.45, 1.2, 0.31); gun.visible = false; g.add(gun);
    g.userData = { legs, arms, gun, shirt, pants, sc: p.shirt };
    this.scene.add(g); return g;
  },

  // ---------- 매 프레임 ----------
  updateYaw(dt) {
    const P = Game.player;
    if (P.car) {
      const target = P.car.vf < -2 && Game.view !== 'front' ? P.car.a : P.car.a;
      this.yaw = angNorm(this.yaw + angNorm(target - this.yaw) * (1 - Math.exp(-6 * dt)));
      this.pitch *= 0.9;
    } else {
      const locked = document.pointerLockElement === canvas;
      if (locked) { this.yaw = angNorm(this.yaw + Input.mouse.dx * 0.0028); this.pitch = clamp(this.pitch - Input.mouse.dy * 0.002, -0.5, 0.6); }
      if (this.lookDX) { this.yaw = angNorm(this.yaw + this.lookDX * 0.008); this.lookDX = 0; }
      const sp = Math.hypot(P.vx, P.vy);
      const manual = locked || Input.touch.look || Pad.active && (Pad.rx || Pad.ry);
      if (Pad.active && Pad.rx) this.yaw = angNorm(this.yaw + Pad.rx * 2.6 * dt);
      if (!manual && sp > 1 && !(Input.mouse.down || Input.touch.fire)) this.yaw = angNorm(this.yaw + angNorm(Math.atan2(P.vy, P.vx) - this.yaw) * (1 - Math.exp(-1.4 * dt)));
    }
    Input.mouse.dx = 0; Input.mouse.dy = 0;
  },
  // 3D 시점에서의 조준: 시선 방향 + 가까운 적 보정
  aimAngle() {
    const P = Game.player;
    let a = this.yaw, best = 0.22, W = WEAPONS[P.weapon];
    for (const p of Game.peds) {
      if (p.dead || p.kind === 'dog' || p.car) continue;
      const d = dist(p.x, p.y, P.x, P.y); if (d > (W.range || 3) || d < 0.3) continue;
      const da = Math.abs(angNorm(Math.atan2(p.y - P.y, p.x - P.x) - this.yaw));
      const hostile = p.state === 'chase' || p.kind === 'gang' || p.kind === 'target' || p.kind === 'guard';
      if (da < best + (hostile ? 0.12 : 0) && losClear(P.x, P.y, p.x, p.y)) { best = da; a = Math.atan2(p.y - P.y, p.x - P.x); }
    }
    return a;
  },
  placeCamera(dt) {
    const P = Game.player, cam = this.camera, v = Game.view;
    const car = P.car;
    const tx = P.px, ty = P.py, fx = Math.cos(this.yaw), fy = Math.sin(this.yaw);
    if (v === 'fps') {
      let ex = tx, ey = ty, eh = 1.62;
      if (car) { const c = Math.cos(car.a), s = Math.sin(car.a); ex = car.x + c * (car.type === 'bike' ? 0 : 0.1) + s * (car.type === 'bike' ? 0 : 0.36); ey = car.y + s * 0.1 - c * (car.type === 'bike' ? 0 : 0.36); eh = car.type === 'bike' ? 1.75 : ['truck', 'armored', 'van', 'swat', 'ambulance'].includes(car.V.style) ? 1.6 : 1.2; }
      else { ex += fx * 0.18; ey += fy * 0.18; }
      if (car && car.V.special) eh = (car.type === 'tank' ? 3.0 : 2.3) + (car.alt || 0);
      cam.position.set(ex, eh, ey);
      cam.lookAt(ex + fx * 10, eh + Math.tan(this.pitch) * 10 - (car ? 0.1 : 0), ey + fy * 10);
      cam.fov = car ? 70 : 72;
    } else {
      const back = car ? (v === 'front' ? -1 : 1) * (6.5 + car.L * 0.8 + Math.min(car.speed, 30) * 0.08) : (v === 'front' ? -4.2 : 4.6);
      const alt = car ? car.alt || 0 : 0;
      const up = (car ? 2.6 + car.L * 0.25 : 2.3) + alt;
      let dist_ = Math.abs(back);
      const dx = -fx * sign(back), dy = -fy * sign(back);
      // 벽에 가리면 카메라를 당긴다
      const hit = rayWall(tx, ty, dx, dy, dist_);
      if (hit < dist_ && alt < 1.2) dist_ = Math.max(1.2, hit - 0.4);
      const cx = tx + dx * dist_, cy = ty + dy * dist_;
      const k = 1 - Math.exp(-10 * dt);
      const cp = cam.position;
      if (!this.camInit) { cp.set(cx, up, cy); this.camInit = true; }
      cp.set(lerp(cp.x, cx, k), lerp(cp.y, up + Math.max(0, -this.pitch) * 3, k), lerp(cp.z, cy, k));
      const lookH = (car ? 1.2 : 1.45) + alt - (alt > 1.2 ? 5 : 0);
      cam.lookAt(tx + fx * (v === 'front' ? 0 : 3), lookH + this.pitch * 4, ty + fy * (v === 'front' ? 0 : 3));
      cam.fov = car ? 65 + Math.min(12, car.speed * 0.35) : 60;
    }
    cam.updateProjectionMatrix();
  },
  project(x, y, h = 1.8) {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * CW, (1 - v.y) / 2 * CH];
  },
  render(dt) {
    if (!this.ok) return;
    const P = Game.player, S = this.scene;
    // 조명/하늘
    const amb = ambientAt(Game.clock / 60), wet = Game.weather.intensity;
    const night = 1 - (amb[0] + amb[1] + amb[2]) / 3;
    const sky = new THREE.Color(lerp(0.62, 0.04, night) * (1 - 0.3 * wet), lerp(0.78, 0.06, night) * (1 - 0.25 * wet), lerp(0.91, 0.14, night) * (1 - 0.1 * wet));
    if (amb[0] > amb[2] + 0.1) sky.lerp(new THREE.Color(0.95, 0.55, 0.35), 0.45);
    this.renderer.setClearColor(sky); S.fog.color.copy(sky);
    S.fog.far = 170 - wet * 50 + (P.car && P.car.alt || 0) * 2.5;
    this.hemi.intensity = 0.25 + (1 - night) * 0.75; this.sun.intensity = 0.1 + (1 - night) * 0.8;
    this.hemi.color.setRGB(amb[0], amb[1], amb[2]);
    this.bmat.emissiveIntensity = night > 0.35 ? night * 0.9 : 0;
    this.lampHeads.material.color.setScalar(night > 0.3 ? 1 : 0.55);
    // 신호등
    if (!this.tlT || Game.time - this.tlT > 0.4) {
      this.tlT = Game.time; const cc = new THREE.Color();
      this.tl.forEach((t, i) => { const s = lightState(t.n, t.d); this.tlHeads.setColorAt(i, cc.set(s === 'g' ? '#39e36b' : s === 'y' ? '#ffc933' : '#ff3b3b')); });
      this.tlHeads.instanceColor.needsUpdate = true;
    }
    const R2 = 180 * 180;
    // 차량
    const seen = new Set();
    for (const c of Game.cars) {
      if (dist2(c.x, c.y, P.px, P.py) > R2) continue;
      seen.add(c.id);
      let g = this.cars.get(c.id);
      if (!g) { g = this.makeCar(c); this.cars.set(c.id, g); }
      g.position.set(c.x, c.alt || 0, c.y); g.rotation.order = 'YXZ'; g.rotation.set(0, -c.a, 0);
      if (c.V.special) {
        const U = g.userData;
        if (U.turret) U.turret.rotation.y = -angNorm((c.turret ?? c.a) - c.a);
        if (U.rotor) { U.rotor[0].rotation.y = U.rotor[1].rotation.y = c.rotor || 0; }
        if (c.V.special === 'heli' && c.alt > 3) g.rotation.z = -clamp(c.vf / 36, -1, 1) * 0.25, g.rotation.x = -(c.in.st || 0) * 0.2;
        if (c.V.special === 'jet') { g.rotation.x = c.bank || 0; if (U.flame) U.flame.visible = (c.spd || 0) > 20 && !c.dead; }
      }
      const bm = g.userData.bodyMat, col = c.dead ? '#26272a' : c.color;
      if (g.userData.col !== col) { bm.color.set(col); g.userData.col = col; }
      if (c.burnT > 0 && !c.dead) bm.emissive.setRGB(0.5 + Math.random() * 0.3, 0.2, 0); else bm.emissive.setRGB(0, 0, 0);
      if (g.userData.tail) g.userData.tail.color.set(c.brakeLight ? '#ff2a2a' : '#8a1a1a');
      if (g.userData.siren) { const f = Math.floor(Game.time * 8) % 2; g.userData.siren[0].color.set(c.siren && f ? '#ff2d2d' : '#5a1010'); g.userData.siren[1].color.set(c.siren && !f ? '#2d6bff' : '#10205a'); }
      const mine = c === P.car && Game.view === 'fps';
      if (g.userData.cab) for (const m of g.userData.cab) m.visible = !mine;
      if (g.userData.rider) { g.userData.rider.visible = !!c.driver && !mine; if (c.driver === 'player') g.userData.riderMat.color.set(P.shirt); }
    }
    for (const [id, g] of this.cars) if (!seen.has(id)) { S.remove(g); this.cars.delete(id); }
    // 사람
    const pseen = new Set();
    const peds = P.car || P.hidden ? Game.peds : [...Game.peds, P];
    for (const p of peds) {
      if (dist2(p.x, p.y, P.px, P.py) > R2) continue;
      pseen.add(p.id);
      let g = this.peds.get(p.id);
      if (!g) { g = this.makePed(p); this.peds.set(p.id, g); }
      g.visible = !(p === P && Game.view === 'fps');
      g.position.set(p.x, 0, p.y);
      g.rotation.set(0, -p.a, 0);
      const U = g.userData;
      if (U.shirt && U.sc !== p.shirt) { U.shirt.color.set(p.shirt); U.sc = p.shirt; }
      if (p.dead || p.downT > 0) { g.rotation.set(0, -p.a, Math.PI / 2 * (p.id % 2 ? 1 : -1)); g.position.y = 0.2; }
      if (U.legs) {
        const sw = Math.sin(p.anim * 3.2) * Math.min(1, (p.moving || 0) / 1.5) * 0.7;
        U.legs[0].rotation.z = sw; U.legs[1].rotation.z = -sw;
        const armed = p.weapon && !WEAPONS[p.weapon].melee && (p.state === 'chase' || p === P || p.aimT > 0);
        U.gun.visible = !!armed;
        if (p.state === 'handsup') { U.arms[0].rotation.z = Math.PI; U.arms[1].rotation.z = Math.PI; }
        else if (armed) { U.arms[0].rotation.z = Math.PI / 2; U.arms[1].rotation.z = Math.PI / 2; }
        else { U.arms[0].rotation.z = -sw * 0.8; U.arms[1].rotation.z = sw * 0.8; }
      }
    }
    for (const [id, g] of this.peds) if (!pseen.has(id)) { S.remove(g); this.peds.delete(id); }
    // 파티클
    let n = 0; const pp = this.pPos, pc = this.pCol;
    for (const q of Particles.list) {
      if (n >= 1000) break;
      const a = q.life / q.max; let r, gg, b, h = 0.5;
      if (q.t === 'fire') { r = 1; gg = 0.4 + a * 0.5; b = 0.1; h = 0.6 + (1 - a) * 2.5; }
      else if (q.t === 'smoke') { const c = parseInt(q.col.slice(1), 16); r = ((c >> 16) & 255) / 255; gg = ((c >> 8) & 255) / 255; b = (c & 255) / 255; h = 1 + (1 - a) * 5; }
      else if (q.t === 'spark') { r = 1; gg = 0.85; b = 0.4; h = 0.9; }
      else if (q.t === 'blood') { r = 0.55; gg = 0.03; b = 0.05; h = 0.8 * a; }
      else { r = 0.2; gg = 0.2; b = 0.2; h = 0.5; }
      pp[n * 3] = q.x; pp[n * 3 + 1] = h; pp[n * 3 + 2] = q.y; pc[n * 3] = r; pc[n * 3 + 1] = gg; pc[n * 3 + 2] = b; n++;
    }
    this.pGeo.setDrawRange(0, n); this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
    // 총알 궤적
    let tn = 0;
    for (const t of Effects.tracers) { if (tn >= 200) break; this.trPos.set([t.x1, 1.3, t.y1, t.x2, 1.2, t.y2], tn * 6); tn++; }
    this.trGeo.setDrawRange(0, tn * 2); this.trGeo.attributes.position.needsUpdate = true;
    // 폭발
    this.booms.forEach((m, i) => { const b = Effects.booms[i]; m.visible = !!b; if (b) { const k = 1 - b.life / b.max; m.position.set(b.x, 1.5, b.y); m.scale.setScalar(b.r * (0.4 + k * 1.2)); m.material.opacity = 0.85 * (1 - k); } });
    // 목표 마커 (GTA식 빛기둥)
    const tg = [...allTargets(), ...(Game.waypoint ? [{ x: Game.waypoint.x, y: Game.waypoint.y, c: '#c77dff' }] : [])];
    const places = Object.entries(World.places).filter(([k]) => PLACE_MARK[k]).map(([k, pl]) => ({ x: pl.x, y: pl.y, c: PLACE_MARK[k], small: true }));
    const all = [...tg, ...places.filter(q => dist2(q.x, q.y, P.px, P.py) < 90 * 90)];
    this.markers.forEach((m, i) => {
      const t = all[i]; m.visible = !!t; if (!t) return;
      const r = t.small ? 1 : 1.8;
      m.position.set(t.x, t.small ? 1 : 12, t.y); m.scale.set(r, t.small ? 2 : 24, r); m.material.color.set(t.c);
      m.material.opacity = 0.25 + Math.sin(Game.time * 4) * 0.08;
    });
    // 픽업
    const PK = { cash: '#3fbf5f', health: '#e0283a', armor: '#3d7dd8', bribe: '#f2c14e', package: '#9a6b3a', weapon: '#dfe6ee' };
    let pi = 0;
    for (const k of Game.pickups) {
      if (k.taken || pi >= this.pickups.length || dist2(k.x, k.y, P.px, P.py) > 80 * 80) continue;
      const m = this.pickups[pi++]; m.visible = true; m.position.set(k.x, 0.7 + Math.sin(k.bob) * 0.15, k.y); m.rotation.y = k.bob; m.material.color.set(PK[k.type] || '#fff');
    }
    for (; pi < this.pickups.length; pi++) this.pickups[pi].visible = false;
    // 헬기
    const H = Police.heli;
    this.heli.visible = !!H;
    if (H) { this.heli.position.set(H.x, H.alt, H.y); this.heli.rotation.y = -H.a; this.rotor.rotation.y = H.rotor; }
    this.placeCamera(dt);
    this.renderer.render(S, this.camera);
  },
  // 월드 3D 좌표계 해제 (탑뷰로 돌아갈 때)
  clear() { for (const [, g] of this.cars) this.scene.remove(g); for (const [, g] of this.peds) this.scene.remove(g); this.cars.clear(); this.peds.clear(); this.camInit = false; },
};

function cycleView() {
  const i = VIEW_ORDER.indexOf(Game.view);
  let next = VIEW_ORDER[(i + 1) % VIEW_ORDER.length];
  if (next !== 'top' && !View3D.init()) { UI.toast('이 기기에서는 3D 시점을 쓸 수 없다 (WebGL 없음)'); next = 'top'; }
  setView(next);
}
function setView(v) {
  const P = Game.player;
  if (v !== 'top' && Game.view === 'top') { View3D.yaw = P.car ? P.car.a : P.a; View3D.camInit = false; View3D.pitch = 0; }
  if (v === 'top') { View3D.clear(); if (document.pointerLockElement) document.exitPointerLock(); }
  Game.view = v;
  document.body.classList.toggle('view3d', v !== 'top');
  UI.toast(`시점: ${VIEW_NAMES[v]}` + (v !== 'top' && !Input.usingTouch && !P.car ? ' — 화면을 클릭하면 마우스로 둘러보기' : ''));
}
