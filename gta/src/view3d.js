'use strict';
/* =====================================================================
 * view3d.js — 3D 시점 (3인칭 후면 · 3인칭 전면 · 1인칭)
 *
 * 게임 로직은 그대로 2D(x, y)에서 돌고, 이 모듈은 같은 세계를 Three.js로 다시 그린다.
 *  - 2D 좌표 (x, y) → 3D (x, 높이, z=y). 2D 방향각 a → 메시 rotation.y = −a
 *  - 세계는 128m 청크로 나눠 카메라 주변만 만든다(stream). 청크마다 지면 텍스처(2D 지면 렌더러로 굽기) +
 *    건물 합친 지오메트리 + 나무·가로등·신호등 InstancedMesh. 가까운 청크는 고해상도 텍스처.
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
      this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 460);
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

  // ---------- 정적 세계: 마인크래프트처럼 청크(128m) 단위로 스트리밍 ----------
  // 도시 전체를 한 번에 만들지 않고, 카메라 주변 반경 R 안의 청크만 만들어 두고 멀어지면 버린다.
  // R은 속도·고도에 따라 넓어져서 500km/h로 달려도 앞쪽이 끊기지 않는다(매 프레임 시간 예산 안에서 몇 개씩 생성).
  CS: 128,
  buildStatic() {
    const S = this.scene;
    // 바다·거친 지면은 잘게 나누고 조금 낮춘 뒤 깊이를 뒤로 민다 (거대한 삼각형 두 개면 청크 지면과 깊이 싸움을 한다)
    const backMat = o => new THREE.MeshLambertMaterial({ ...o, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 48, 48), backMat({ color: 0x1d5a80 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(MW * T / 2, -0.3, MH * T / 2); S.add(sea);
    // 아직 안 만든 청크 자리에 바다 대신 보이는 거친 지면 (미니맵 한 장을 통째로 깐다)
    if (World.mini) {
      const mt = new THREE.CanvasTexture(World.mini); mt.colorSpace = THREE.SRGBColorSpace; mt.magFilter = THREE.LinearFilter;
      const under = new THREE.Mesh(new THREE.PlaneGeometry(MW * T, MH * T, 56, 26), backMat({ map: mt }));
      under.rotation.x = -Math.PI / 2; under.position.set(MW * T / 2, -0.15, MH * T / 2); S.add(under);
    }
    // 레드 카운티의 산·메사: 높이 함수(mountainH)로 만든 지형 메시 (한 번만 만들어 둔다)
    for (const m of World.mountains || []) {
      const size = 2 * m.rMax * T + 16, seg = Math.min(128, Math.ceil(size / 5));
      const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, cx = m.x * T, cz = m.y * T;
      for (let k = 0; k < pos.count; k++) { const x = pos.getX(k) + cx, z = pos.getZ(k) + cz, h = mountainH(x / T, z / T); pos.setXYZ(k, x, h > 0.25 ? h : -1.5, z); }
      geo.computeVertexNormals();
      const nor = geo.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const h = pos.getY(k), steep = 1 - nor.getY(k);
        if (m.mesa) c.set(steep > 0.35 ? (Math.floor(h / 3.5) % 2 ? '#b0643a' : '#9a5532') : '#c98a55');
        else c.set(h > 98 ? '#f1f3f6' : h > 76 ? (steep > 0.45 ? '#8f8b85' : '#d9dde2') : steep > 0.5 ? '#7d7266' : h < 28 ? '#5c7a44' : h < 55 ? '#4f6b3c' : '#7c7a6c');
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.mtMat = this.mtMat || new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
      const mesh = new THREE.Mesh(geo, this.mtMat);
      S.add(mesh);
    }
    // 창문 텍스처 (흰 바탕 = 정점 색 그대로, 창 = 어두운 유리) + 밤 발광 맵
    const wc = document.createElement('canvas'); wc.width = wc.height = 64;
    const w = wc.getContext('2d'); w.fillStyle = '#ffffff'; w.fillRect(0, 0, 64, 64); w.fillStyle = '#3a4656'; w.fillRect(8, 16, 48, 30); w.fillStyle = 'rgba(255,255,255,0.25)'; w.fillRect(8, 16, 48, 4);
    const ec = document.createElement('canvas'); ec.width = ec.height = 64;
    const e = ec.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, 64, 64); e.fillStyle = '#ffd98a'; e.fillRect(8, 16, 48, 30);
    const winTex = new THREE.CanvasTexture(wc), emTex = new THREE.CanvasTexture(ec);
    for (const t of [winTex, emTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
    this.bmat = new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex, emissive: 0xffffff, emissiveMap: emTex, emissiveIntensity: 0 });
    // 청크들이 함께 쓰는 지오메트리·재질
    this.sg = {
      trunk: new THREE.CylinderGeometry(0.18, 0.25, 1, 6), crown: new THREE.IcosahedronGeometry(1, 0), cone: new THREE.ConeGeometry(1, 1, 7),
      pole: new THREE.CylinderGeometry(0.08, 0.1, 5, 5), head: new THREE.SphereGeometry(0.28, 8, 6),
      tpole: new THREE.CylinderGeometry(0.07, 0.07, 3.6, 5), tbox: new THREE.BoxGeometry(0.4, 0.4, 0.4),
    };
    this.crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    this.tlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    // 신호등 위치 (진입로마다 하나)
    const tls = [];
    for (const n of World.nodes) {
      if (!n.light) continue;
      for (let d = 0; d < 4; d++) {
        if (n.adj[(d + 2) % 4] < 0) continue;
        const r = rightOf(d), g = signalGeom(n, d);
        tls.push({ n, d, x: n.x - DIRS[d][0] * (g.back + 0.3) + r[0] * (g.half + 0.6), y: n.y - DIRS[d][1] * (g.back + 0.3) + r[1] * (g.half + 0.6) });
      }
    }
    // 청크별 물건 목록
    const CS = this.CS, NCX = this.NCX = Math.ceil(MW * T / CS), NCY = this.NCY = Math.ceil(MH * T / CS);
    this.bucket = [];
    for (let i = 0; i < NCX * NCY; i++) this.bucket.push({ b: [], trees: [], lamps: [], tl: [], decos: [] });
    const at = (x, y) => this.bucket[clamp(Math.floor(x / CS), 0, NCX - 1) + clamp(Math.floor(y / CS), 0, NCY - 1) * NCX];
    for (const b of World.buildings) at((b.x0 + b.x1 + 1) / 2 * T, (b.y0 + b.y1 + 1) / 2 * T).b.push(b);
    for (const t of World.trees) at(t.x, t.y).trees.push(t);
    for (const l of World.lamps) at(l.x, l.y).lamps.push(l);
    for (const t of tls) at(t.x, t.y).tl.push(t);
    for (const d of World.decos || []) at(d.x !== undefined ? d.x : (d.x0 + d.x1) / 2, d.y !== undefined ? d.y : (d.y0 + d.y1) / 2).decos.push(d);
    this.chunks = new Map();
    this.drawR = 300;
  },
  // 청크 지면 텍스처: 기존 2D 지면 렌더러를 청크 크기 오프스크린 캔버스에 실행
  chunkTex(cx, cy, px) {
    const CS = this.CS, ppm = px / CS, X0 = cx * CS, Y0 = cy * CS;
    const gc = document.createElement('canvas'); gc.width = gc.height = px;
    const g = gc.getContext('2d');
    const saveCtx = ctx, saveCam = { ...Cam };
    ctx = g; Object.assign(Cam, { x: X0 + CS / 2, y: Y0 + CS / 2, ppm, vw: CS, vh: CS, rot: 0, sx: 0, sy: 0 });
    g.setTransform(ppm, 0, 0, ppm, -X0 * ppm, -Y0 * ppm);
    try { drawGround([1, 1, 1]); } finally { ctx = saveCtx; Object.assign(Cam, saveCam); }
    const tex = new THREE.CanvasTexture(gc);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  },
  texPx(hi) { return IS_MOBILE || Perf.low ? (hi ? 512 : 128) : (hi ? 1024 : 256); },
  buildChunk(cx, cy, hi) {
    const CS = this.CS, bk = this.bucket[cx + cy * this.NCX], G = new THREE.Group();
    const tex = this.chunkTex(cx, cy, this.texPx(hi));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CS, CS), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx * CS + CS / 2, 0, cy * CS + CS / 2);
    G.add(ground);
    const ch = { cx, cy, hi, G, ground, tl: bk.tl, tlHeads: null };
    // 건물: 청크 안 건물을 하나의 지오메트리로
    if (bk.b.length) {
      const pos = [], nor = [], uv = [], col = [];
      const color = new THREE.Color();
      const quad = (a, b, c, d, n, uvs, rgb) => {
        for (const [p, u] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(u[0], u[1]); col.push(rgb.r, rgb.g, rgb.b); }
      };
      const SOLID = [[0.02, 0.98], [0.03, 0.98], [0.03, 0.97], [0.02, 0.97]];
      for (const b of bk.b) {
        const X0 = b.x0 * T, Z0 = b.y0 * T, X1 = (b.x1 + 1) * T, Z1 = (b.y1 + 1) * T, H = b.h;
        if (b.kind === 'eiffel' || b.kind === 'terminal' || b.label === '관제탑') continue; // 탑·공항 터미널은 addDeco에서 따로 만든다
        const hasWin = !['container', 'house', 'warehouse', 'fence', 'arch', 'church', 'arena'].includes(b.kind) && H > 5;
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
        } else {
          quad([X0, H, Z1], [X1, H, Z1], [X1, H, Z0], [X0, H, Z0], [0, 1, 0], SOLID, roofC);
          if (H > 6 && !['container', 'fence', 'arch', 'church', 'arena', 'hangar', 'tankcyl'].includes(b.kind)) {
            // 옥상 난간 (가장자리 0.9m)
            const pH = H + 0.9, i = 0.35, rim = roofC.clone().multiplyScalar(0.8);
            quad([X0, H, Z1], [X1, H, Z1], [X1, pH, Z1], [X0, pH, Z1], [0, 0, 1], SOLID, side(0.78)); quad([X1, H, Z0], [X0, H, Z0], [X0, pH, Z0], [X1, pH, Z0], [0, 0, -1], SOLID, side(0.9));
            quad([X1, H, Z1], [X1, H, Z0], [X1, pH, Z0], [X1, pH, Z1], [1, 0, 0], SOLID, side(0.68)); quad([X0, H, Z0], [X0, H, Z1], [X0, pH, Z1], [X0, pH, Z0], [-1, 0, 0], SOLID, side(0.86));
            quad([X0, pH, Z1], [X1, pH, Z1], [X1, pH, Z1 - i], [X0, pH, Z1 - i], [0, 1, 0], SOLID, rim); quad([X0, pH, Z0 + i], [X1, pH, Z0 + i], [X1, pH, Z0], [X0, pH, Z0], [0, 1, 0], SOLID, rim);
            quad([X1 - i, pH, Z1], [X1, pH, Z1], [X1, pH, Z0], [X1 - i, pH, Z0], [0, 1, 0], SOLID, rim); quad([X0, pH, Z1], [X0 + i, pH, Z1], [X0 + i, pH, Z0], [X0, pH, Z0], [0, 1, 0], SOLID, rim);
            // 옥상 설비: 실외기 · 물탱크 · 안테나 (건물마다 다르게)
            const bx = (x0, z0, x1, z1, y1, rgb) => { quad([x0, H, z1], [x1, H, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], SOLID, rgb.clone().multiplyScalar(0.8)); quad([x1, H, z0], [x0, H, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], SOLID, rgb.clone().multiplyScalar(0.9)); quad([x1, H, z1], [x1, H, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], SOLID, rgb.clone().multiplyScalar(0.7)); quad([x0, H, z0], [x0, H, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], SOLID, rgb.clone().multiplyScalar(0.85)); quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], SOLID, rgb); };
            const sd = b.seed || 0.5, gray = new THREE.Color('#9aa0a8'), tank = new THREE.Color('#7a6a58');
            const w_ = X1 - X0, d_ = Z1 - Z0;
            if (w_ > 5 && d_ > 5) {
              for (let k = 0; k < 1 + Math.floor(sd * 3); k++) { const ax = X0 + 1.2 + ((sd * 7.3 + k * 0.37) % 1) * (w_ - 3.4), az = Z0 + 1.2 + ((sd * 3.1 + k * 0.61) % 1) * (d_ - 3.4); bx(ax, az, ax + 1.6, az + 1.2, H + 1.1, gray); }
              if (H > 14 && sd > 0.35) { const tx = X0 + w_ * 0.7, tz = Z0 + d_ * 0.3; bx(tx - 1, tz - 1, tx + 1, tz + 1, H + 3.2, tank); }
              if (H > 30 && sd < 0.5) { const tx = X0 + w_ * 0.5, tz = Z0 + d_ * 0.5; bx(tx - 0.15, tz - 0.15, tx + 0.15, tz + 0.15, H + 9, new THREE.Color('#d0d4da')); }
            }
          }
        }
        // 1층 가게 앞: 짙은 유리 띠 + 차양 (상가·중층 건물)
        if ((b.kind === 'mid' || b.kind === 'shop' || b.kind === 'biz' || b.kind === 'tower') && H > 7) {
          const aw = new THREE.Color(['#b23a2e', '#2e6f9e', '#2f7d4a', '#c8871f', '#6b3b8f'][Math.floor((b.seed || 0) * 5) % 5]), dark = new THREE.Color('#1e2632'), o = 0.04;
          quad([X0, 0.2, Z1 + o], [X1, 0.2, Z1 + o], [X1, 3.2, Z1 + o], [X0, 3.2, Z1 + o], [0, 0, 1], SOLID, dark); quad([X1, 0.2, Z0 - o], [X0, 0.2, Z0 - o], [X0, 3.2, Z0 - o], [X1, 3.2, Z0 - o], [0, 0, -1], SOLID, dark);
          quad([X1 + o, 0.2, Z1], [X1 + o, 0.2, Z0], [X1 + o, 3.2, Z0], [X1 + o, 3.2, Z1], [1, 0, 0], SOLID, dark); quad([X0 - o, 0.2, Z0], [X0 - o, 0.2, Z1], [X0 - o, 3.2, Z1], [X0 - o, 3.2, Z0], [-1, 0, 0], SOLID, dark);
          quad([X0, 3.2, Z1 + 1.1], [X1, 3.2, Z1 + 1.1], [X1, 3.6, Z1], [X0, 3.6, Z1], [0, 0.94, 0.34], SOLID, aw); quad([X1, 3.2, Z0 - 1.1], [X0, 3.2, Z0 - 1.1], [X0, 3.6, Z0], [X1, 3.6, Z0], [0, 0.94, -0.34], SOLID, aw);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      G.add(new THREE.Mesh(geo, this.bmat));
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), color = new THREE.Color();
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; G.add(m); return m; };
    // 나무 (줄기 + 수관)
    const broad = bk.trees.filter(t => t.kind !== 'pine' && t.kind !== 'cactus'), pines = bk.trees.filter(t => t.kind === 'pine'), cacti = bk.trees.filter(t => t.kind === 'cactus');
    if (broad.length) {
      const trunk = inst(this.sg.trunk, this.mat('#6b4a2a'), broad.length), crown = inst(this.sg.crown, this.crownMat, broad.length);
      broad.forEach((t, i) => {
        m4.compose(p3.set(t.x, t.h * 0.4, t.y), q.identity(), sc.set(1, t.h * 0.8, 1)); trunk.setMatrixAt(i, m4);
        const palm = t.kind === 'palm';
        m4.compose(p3.set(t.x, t.h * (palm ? 0.95 : 0.8), t.y), q.identity(), palm ? sc.set(t.r * 0.9, 0.5, t.r * 0.9) : sc.set(t.r, t.r * 0.9, t.r)); crown.setMatrixAt(i, m4);
        crown.setColorAt(i, color.set(palm ? '#3f8a3a' : t.hue < 0.33 ? '#3d6e34' : t.hue < 0.66 ? '#467a3a' : '#355f30'));
      });
    }
    if (pines.length) { // 침엽수 (산비탈이면 그 높이에 선다)
      const trunk = inst(this.sg.trunk, this.mat('#5a3d24'), pines.length), cone = inst(this.sg.cone, this.crownMat, pines.length);
      pines.forEach((t, i) => {
        const z = t.z || 0;
        m4.compose(p3.set(t.x, z + t.h * 0.15, t.y), q.identity(), sc.set(1, t.h * 0.3, 1)); trunk.setMatrixAt(i, m4);
        m4.compose(p3.set(t.x, z + t.h * 0.6, t.y), q.identity(), sc.set(t.r, t.h * 0.85, t.r)); cone.setMatrixAt(i, m4);
        cone.setColorAt(i, color.set(t.hue < 0.5 ? '#24462a' : '#2e5632'));
      });
    }
    if (cacti.length) { // 선인장: 몸통 + 팔
      const body = inst(this.sg.trunk, this.mat('#3f7a45'), cacti.length * 3);
      cacti.forEach((t, i) => {
        m4.compose(p3.set(t.x, t.h / 2, t.y), q.identity(), sc.set(2.2, t.h, 2.2)); body.setMatrixAt(i * 3, m4);
        const s = t.hue > 0.5 ? 1 : -1;
        m4.compose(p3.set(t.x + 0.55 * s, t.h * 0.62, t.y), q.identity(), sc.set(1.5, t.h * 0.4, 1.5)); body.setMatrixAt(i * 3 + 1, m4);
        m4.compose(p3.set(t.x - 0.5 * s, t.h * 0.5, t.y + 0.2), q.identity(), sc.set(1.4, t.h * 0.32, 1.4)); body.setMatrixAt(i * 3 + 2, m4);
      });
    }
    // 가로등
    if (bk.lamps.length) {
      const pole = inst(this.sg.pole, this.mat('#2b2d31'), bk.lamps.length), heads = inst(this.sg.head, this.lampMat, bk.lamps.length);
      bk.lamps.forEach((l, i) => { m4.makeTranslation(l.x, 2.5, l.y); pole.setMatrixAt(i, m4); m4.makeTranslation(l.x, 5.05, l.y); heads.setMatrixAt(i, m4); });
    }
    // 신호등 (색은 render에서 갱신)
    if (bk.tl.length) {
      const tp = inst(this.sg.tpole, this.mat('#1b1d21'), bk.tl.length), th = ch.tlHeads = inst(this.sg.tbox, this.tlMat, bk.tl.length);
      bk.tl.forEach((t, i) => { m4.makeTranslation(t.x, 1.8, t.y); tp.setMatrixAt(i, m4); m4.makeTranslation(t.x, 3.7, t.y); th.setMatrixAt(i, m4); th.setColorAt(i, color.set('#39e36b')); });
    }
    for (const d of bk.decos) this.addDeco(G, d);
    this.scene.add(G);
    return ch;
  },
  // 랜드마크 장식: 개선문 윗부분 · 오페라 돔 · 성당 첨탑 · 네온 타워(에펠탑 느낌)
  addDeco(G, d) {
    const m = new THREE.MeshLambertMaterial({ color: d.c }), add = (geo, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); G.add(o); return o; };
    if (d.t === 'lintel') { add(new THREE.BoxGeometry(d.x1 - d.x0, d.z1 - d.z0, d.y1 - d.y0), (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2, (d.y0 + d.y1) / 2); add(new THREE.BoxGeometry(d.x1 - d.x0 + 1, 1.2, d.y1 - d.y0 + 1), (d.x0 + d.x1) / 2, d.z1 + 0.6, (d.y0 + d.y1) / 2); }
    else if (d.t === 'dome') { add(new THREE.SphereGeometry(d.r, 20, 10, 0, TAU, 0, Math.PI / 2), d.x, d.z, d.y); add(new THREE.CylinderGeometry(0.4, 0.8, 5, 8), d.x, d.z + d.r + 2, d.y); }
    else if (d.t === 'spire') add(new THREE.ConeGeometry(2.2, d.h, 8), d.x, d.z + d.h / 2, d.y);
    else if (d.t === 'vault') { const len = d.x1 - d.x0, r = (d.y1 - d.y0) / 2; const o = add(new THREE.CylinderGeometry(r, r, len, 16, 1, false, 0, Math.PI), (d.x0 + d.x1) / 2, d.z, (d.y0 + d.y1) / 2); o.rotation.set(0, 0, Math.PI / 2); o.scale.set(1, 1, 0.45); o.rotation.y = 0; o.rotation.x = -Math.PI / 2; o.rotation.z = Math.PI / 2; }
    else if (d.t === 'cab') { add(new THREE.CylinderGeometry(3.2, 2.4, 3.2, 10), d.x, d.z + 1.6, d.y); add(new THREE.CylinderGeometry(3.6, 3.6, 0.5, 10), d.x, d.z + 3.4, d.y); }
    else if (d.t === 'glass') this.addGlass(G, d);
    else if (d.t === 'tower2') {
      const wm = this.mat('#e8ecef'), H = d.h;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, H, 16), wm); shaft.position.set(d.x, H / 2, d.y); G.add(shaft);
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 3.2, 1.6, 16), wm); deck.position.set(d.x, H + 0.4, d.y); G.add(deck);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 4.6, 4, 16), this.glassMat()); cab.position.set(d.x, H + 3.2, d.y); G.add(cab);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(3, 6, 1.2, 16), this.mat('#b8c2cc')); cap.position.set(d.x, H + 5.8, d.y); G.add(cap);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 7, 6), this.mat('#d33')); ant.position.set(d.x, H + 9.8, d.y); G.add(ant);
    }
    else if (d.t === 'jetbridge') { // 탑승교: 기둥 위의 긴 통로
      const dx = d.x1 - d.x0, dy = d.y1 - d.y0, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(L, 2.8, 2.6), this.mat('#c9ced6')); tube.position.set((d.x0 + d.x1) / 2, 4.6, (d.y0 + d.y1) / 2); tube.rotation.y = -a; G.add(tube);
      const win = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.8, 2.7), this.glassMat()); win.position.set((d.x0 + d.x1) / 2, 5.1, (d.y0 + d.y1) / 2); win.rotation.y = -a; G.add(win);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.4, 0.6), this.mat('#6b7280')); leg.position.set(d.x0 + dx * 0.75, 1.7, d.y0 + dy * 0.75); G.add(leg);
    }
    else if (d.t === 'gse') { // 지상 조업 차량 (견인차 + 수하물 카트)
      const car = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.8), this.mat('#f2c14e')); car.position.set(d.x, 0.8, d.y); G.add(car);
      for (let k = 1; k <= 3; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1.4), this.mat('#8a929c')); c.position.set(d.x - k * 2.6, 0.6, d.y); G.add(c); }
    }
    else if (d.t === 'mast') { // 계류장 조명탑
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, d.h, 6), this.mat('#9aa3ad')); p.position.set(d.x, d.h / 2, d.y); G.add(p);
      const l = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 1.2), this.lampMat); l.position.set(d.x, d.h, d.y); G.add(l);
    }
    else if (d.t === 'rlights') { // 활주로 등화: 가장자리 흰색, 시작 초록, 끝 빨강 (밤에 빛난다)
      const pos = [], col = [], cc = [[1, 0.95, 0.8], [0.2, 1, 0.3], [1, 0.2, 0.2]];
      for (const [x, y, k] of d.pts) { pos.push(x, 0.25, y); col.push(...cc[k]); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pm = this.rlMat = this.rlMat || new THREE.PointsMaterial({ size: 0.9, vertexColors: true, transparent: true, opacity: 0.9 });
      const pts = new THREE.Points(geo, pm); pts.frustumCulled = false; G.add(pts);
    }
    else if (d.t === 'tankcyl') add(new THREE.CylinderGeometry(d.r, d.r, d.z + 1, 16), d.x, (d.z + 1) / 2, d.y);
    else if (d.t === 'eiffel') {
      // 네 다리(기울어진 기둥) + 층층이 좁아지는 몸통 + 첨탑. 밤에는 금빛으로 빛난다
      m.emissive = new THREE.Color('#3a2a10'); this.eiffelMat = m;
      const H = d.h, legH = H * 0.3;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const leg = add(new THREE.BoxGeometry(2.2, legH * 1.08, 2.2), d.x + sx * 5.5, legH / 2, d.y + sz * 5.5); leg.rotation.set(-sz * 0.33, 0, sx * 0.33); }
      add(new THREE.BoxGeometry(14, 1.6, 14), d.x, legH, d.y);
      for (let k = 0; k < 6; k++) { const t0 = k / 6, w = 9 * (1 - t0) + 1.6; add(new THREE.BoxGeometry(w, (H * 0.55) / 6 * 0.9, w), d.x, legH + (k + 0.5) * (H * 0.55) / 6, d.y); }
      add(new THREE.BoxGeometry(5, 1.2, 5), d.x, legH + H * 0.28, d.y);
      add(new THREE.CylinderGeometry(0.25, 0.9, H * 0.15, 6), d.x, H * 0.925, d.y);
    }
  },
  glassMat() { return this._glass = this._glass || new THREE.MeshPhongMaterial({ color: '#5d8fb8', specular: '#e8f4ff', shininess: 90, emissive: '#10263a' }); }, // 불투명 반사 유리 (비쳐 보이면 바다처럼 보인다)
  // 현대식 유리 건물: 유리 벽 + 세로 멀리언(창틀) + 지붕 (wave = 물결 곡면 지붕, tube = 둥근 지붕의 탑승동)
  addGlass(G, d) {
    const w = d.x1 - d.x0, l = d.y1 - d.y0, H = d.h, cx = (d.x0 + d.x1) / 2, cz = (d.y0 + d.y1) / 2, gm = this.glassMat();
    const core = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, H * 0.92, l - 0.6), gm); core.position.set(cx, H * 0.46, cz); G.add(core);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, l), this.mat('#e3e7ea')); floor.position.set(cx, H * 0.45, cz); G.add(floor);
    const mul = this.mat('#dfe4e8'), step = 4;
    const along = w >= l, len = along ? w : l, n = Math.floor(len / step);
    const mg = new THREE.BoxGeometry(along ? 0.25 : l + 0.1, H * 0.92, along ? l + 0.1 : 0.25);
    const inst = new THREE.InstancedMesh(mg, mul, n + 1); const m4 = new THREE.Matrix4();
    for (let k = 0; k <= n; k++) { const t = -len / 2 + k * len / n; m4.makeTranslation(along ? cx + t : cx, H * 0.46, along ? cz : cz + t); inst.setMatrixAt(k, m4); }
    inst.frustumCulled = false; G.add(inst);
    if (d.roof === 'wave') { // 물결 지붕: 얇은 판을 사인 곡선으로 기울여 이어 붙인다 + 넓은 처마
      const segs = 18, rm = this.mat('#f4f6f8');
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs, y0 = H + 2.2 * Math.sin(t0 * Math.PI * 2), y1 = H + 2.2 * Math.sin(t1 * Math.PI * 2);
        const sw = (w + 8) / segs, pl = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(sw, y1 - y0) + 0.05, 0.5, l + 8), rm);
        pl.position.set(d.x0 - 4 + (k + 0.5) * sw, (y0 + y1) / 2, cz); pl.rotation.z = Math.atan2(y1 - y0, sw); G.add(pl);
      }
      for (const s of [-1, 1]) for (let k = 0; k <= 6; k++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, H + 1, 6), this.mat('#c9ced6')); col.position.set(d.x0 - 2 + k * (w + 4) / 6, (H + 1) / 2, cz + s * (l / 2 + 2.5)); G.add(col); }
    } else { // 탑승동: 반원 지붕
      const r = (along ? l : w) / 2 + 0.3, geo = new THREE.CylinderGeometry(r, r, len, 12, 1, false, 0, Math.PI);
      geo.rotateZ(Math.PI / 2); geo.scale(1, 0.45, 1); if (!along) geo.rotateY(Math.PI / 2); // 축을 길이 방향으로, 반원이 위로
      const roof = new THREE.Mesh(geo, this.mat('#eef1f4')); roof.position.set(cx, H * 0.92, cz);
      G.add(roof);
    }
  },
  disposeChunk(ch) {
    this.scene.remove(ch.G);
    ch.G.traverse(o => {
      if (o === ch.ground) { o.geometry.dispose(); o.material.map.dispose(); o.material.dispose(); }
      else if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry.dispose();
    });
  },
  // 카메라 주변 청크 스트리밍. 반경은 속도·고도에 비례 (500km/h ≈ 139m/s 에서도 수 초 앞까지 준비)
  stream(fx, fy, spd, alt) {
    const CS = this.CS, low = IS_MOBILE || Perf.low;
    const base = low ? 170 : 260, cap = low ? 300 : 480; // v2.17: 시야를 줄여 넓어진 맵에서도 가볍게 (산은 멀리서도 보인다)
    const want = clamp(base + spd * (low ? 1.6 : 2.8) + alt * 3, base, cap);
    this.drawR = want > this.drawR ? smooth(this.drawR, want, 1.2, 1 / 60) : smooth(this.drawR, want, 0.4, 1 / 60);
    if (!this.lastF || Math.hypot(fx - this.lastF[0], fy - this.lastF[1]) > 150) this.firstFill = true; // 첫 프레임·순간이동: 주변을 한 번에 채운다
    this.lastF = [fx, fy];
    const R = this.drawR, hiR = low ? 90 : 170;
    // 진행 방향 앞쪽을 먼저 만든다
    const P = Game.player, car = P.car, lx = car ? car.vx * 1.5 : 0, ly = car ? car.vy * 1.5 : 0;
    const need = [];
    const c0 = Math.max(0, Math.floor((fx - R) / CS)), c1 = Math.min(this.NCX - 1, Math.floor((fx + R) / CS));
    const d0 = Math.max(0, Math.floor((fy - R) / CS)), d1 = Math.min(this.NCY - 1, Math.floor((fy + R) / CS));
    const rectD = (cx, cy, x, y) => Math.hypot(Math.max(cx * CS - x, 0, x - (cx + 1) * CS), Math.max(cy * CS - y, 0, y - (cy + 1) * CS));
    for (let cy = d0; cy <= d1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const d = rectD(cx, cy, fx, fy); if (d > R) continue;
      const k = cx + cy * this.NCX, ch = this.chunks.get(k), hi = d < hiR;
      if (!ch) need.push([rectD(cx, cy, fx + lx, fy + ly), cx, cy, hi, k]);
      else if (hi && !ch.hi) need.push([d + 1000, cx, cy, true, k, ch]);
    }
    need.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now(), budget = this.firstFill ? 400 : low ? 4 : 7;
    for (const [, cx, cy, hi, k, old] of need) {
      if (old) { // 가까워진 청크는 지면 텍스처만 고해상도로 교체
        const tex = this.chunkTex(cx, cy, this.texPx(true));
        old.ground.material.map.dispose(); old.ground.material.map = tex; old.ground.material.needsUpdate = true; old.hi = true;
      } else this.chunks.set(k, this.buildChunk(cx, cy, hi));
      if (performance.now() - t0 > budget) break;
    }
    this.firstFill = false;
    // 멀어진 청크는 버린다 (조금 여유를 둬서 경계에서 깜빡이지 않게)
    for (const [k, ch] of this.chunks) {
      const d = rectD(ch.cx, ch.cy, fx, fy);
      if (d > R + CS * 0.75) { this.disposeChunk(ch); this.chunks.delete(k); }
      else ch.G.visible = d < R + 8;
    }
  },
  buildDynamicShared() {
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16),
      rim: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12),
      head: new THREE.SphereGeometry(0.14, 16, 12),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
      skirt: new THREE.CylinderGeometry(0.17, 0.34, 1, 16),
      limb: new THREE.CapsuleGeometry(0.075, 0.72, 4, 8),
      arm: new THREE.CapsuleGeometry(0.055, 0.44, 4, 8),
      hand: new THREE.SphereGeometry(0.055, 8, 6),
      torso: new THREE.CapsuleGeometry(0.16, 0.26, 4, 10),
      eye: new THREE.SphereGeometry(0.018, 6, 4),
      cap: new THREE.SphereGeometry(0.152, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
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
    this.props = []; for (let i = 0; i < 80; i++) { const m = new THREE.Mesh(this.geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff })); m.visible = false; this.scene.add(m); this.props.push(m); }
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })); this.spot.rotation.x = -Math.PI / 2; this.spot.visible = false; this.scene.add(this.spot);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 6, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); this.beam.visible = false; this.scene.add(this.beam);
    const heli = this.heli = new THREE.Group();
    const hb = new THREE.Mesh(this.geo.box, this.mat('#e8e8e8')); hb.scale.set(4.2, 1.6, 2); heli.add(hb);
    const tail = new THREE.Mesh(this.geo.box, this.mat('#1c2a4a')); tail.scale.set(3.4, 0.4, 0.4); tail.position.set(-3.6, 0.3, 0); heli.add(tail);
    this.rotor = new THREE.Mesh(this.geo.box, this.mat('#222')); this.rotor.scale.set(9, 0.08, 0.35); this.rotor.position.y = 1.1; heli.add(this.rotor);
    heli.visible = false; this.scene.add(heli);
  },

  // ---------- 차량 메시 ----------
  // 차 옆모습 → ExtrudeGeometry (앞 = +x, 위 = +y, 폭 = z) · 같은 치수는 재사용
  carProfile(st, L, W, tall, bodyH) {
    const key = `${st}|${L}|${W}`; this.profCache = this.profCache || {};
    if (this.profCache[key]) return this.profCache[key];
    const y0 = 0.3, yb = y0 + bodyH, h = L / 2;
    const R = st === 'sports' || st === 'super' || st === 'hyper' ? { cab: [-0.24, 0.12], roof: [-0.13, 0.02], nose: 0.45, tail: 0.75 }
      : st === 'compact' ? { cab: [-0.42, 0.2], roof: [-0.38, 0.02], nose: 0.7, tail: 0.95 }
      : st === 'muscle' ? { cab: [-0.26, 0.1], roof: [-0.18, 0.0], nose: 0.75, tail: 0.85 }
      : { cab: [-0.3, 0.22], roof: [-0.2, 0.06], nose: 0.65, tail: 0.85 };
    const shape = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; };
    const ext = (s, depth, bevel) => { const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g; };
    // 아래 차체: 뒤범퍼 → 트렁크 → (캐빈 밑) → 보닛 → 앞코
    const body = shape([[-h, y0 + 0.05], [-h, y0 + bodyH * R.tail], [-h + 0.25, yb], [h - 0.35, yb - bodyH * 0.08], [h, y0 + bodyH * R.nose], [h, y0 + 0.08], [h - 0.2, y0], [-h + 0.2, y0]]);
    const cx0 = L * R.cab[0], cx1 = L * R.cab[1], rx0 = L * R.roof[0], rx1 = L * R.roof[1];
    const cab = shape([[cx0, yb - 0.02], [rx0, tall - 0.02], [rx1, tall - 0.02], [cx1, yb - 0.02]]);
    const roof = shape([[rx0 - 0.04, tall - 0.06], [rx0 + 0.02, tall + 0.02], [rx1 - 0.02, tall + 0.02], [rx1 + 0.04, tall - 0.06]]);
    const out = { body: ext(body, W - 0.16, 0.08), cab: ext(cab, W * 0.84, 0.03), roof: ext(roof, W * 0.86, 0.03) };
    this.profCache[key] = out; return out;
  },
  makeCar(c) {
    const g = new THREE.Group(), L = c.L, W = c.W, st = c.V.style, box = this.geo.box;
    const add = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
    g.userData.body = [];
    const bodyMat = new THREE.MeshLambertMaterial({ color: c.color });
    g.userData.bodyMat = bodyMat;
    const glass = this.mat('#1b2735');
    if (st === 'boat' || st === 'jetski') {
      const hullH = st === 'boat' ? 0.9 : 0.55;
      add(bodyMat, L, hullH, W, 0, hullH / 2 - 0.1, 0);
      add(bodyMat, L * 0.3, hullH * 0.8, W * 0.62, L * 0.58, hullH * 0.4 - 0.1, 0);
      if (st === 'boat') { add(this.mat('#e8e8e8'), L * 0.34, 0.8, W * 0.6, -L * 0.12, hullH + 0.3, 0); add(glass, 0.1, 0.5, W * 0.56, L * 0.06, hullH + 0.35, 0); }
      else { add(this.mat('#1d1d1f'), L * 0.35, 0.3, W * 0.4, -L * 0.1, hullH + 0.1, 0); add(this.mat('#c9ced6'), 0.1, 0.5, W * 0.6, L * 0.14, hullH + 0.25, 0); }
    } else if (st === 'tank') {
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
    } else if (st === 'airliner') {
      const white = bodyMat, blue = this.mat('#2f6fd6'), grey = this.mat('#5b6573');
      add(white, L, 3.6, 3.8, 0, 3.2, 0);                          // 동체
      add(blue, L * 0.96, 0.5, 3.86, 0, 3.4, 0);                   // 줄무늬
      add(white, 5, 2.6, 3.0, L * 0.52, 3.0, 0);                   // 기수
      add(glass, 1.2, 0.8, 2.6, L * 0.55, 4.0, 0);
      const wing = add(white, 6, 0.4, L * 0.95, -1, 2.4, 0);        // 주날개
      add(white, 3, 0.3, L * 0.38, -L * 0.42, 4.6, 0);             // 수평 꼬리
      add(blue, 4.2, 5, 0.4, -L * 0.43, 7.2, 0);                   // 수직 꼬리
      for (const z of [-L * 0.22, L * 0.22]) add(grey, 4, 1.6, 1.6, 0.5, 1.6, z); // 엔진
      for (const [x, z] of [[L * 0.4, 0], [-1, 2.2], [-1, -2.2]]) add(this.mat('#111'), 0.8, 1.4, 0.5, x, 0.7, z);
      add(new THREE.MeshBasicMaterial({ color: 0xff9a40 }), 0.2, 1.2, 1.2, -L * 0.5 - 0.3, 3.2, 0).name = 'flame';
      g.userData.flame = g.getObjectByName('flame');
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
      const tall = st === 'fire' ? 2.4 : st === 'truck' || st === 'armored' ? 2.5 : st === 'van' || st === 'swat' || st === 'ambulance' ? 1.9 : st === 'sports' ? 0.95 : 1.25;
      const bodyH = st === 'sports' ? 0.55 : 0.7;
      if (st === 'fire') { // 소방차: 빨간 차체 + 흰 사다리
        add(bodyMat, L, tall - 0.4, W, 0, 0.35 + (tall - 0.4) / 2, 0);
        add(glass, 0.08, 0.6, W * 0.84, L / 2 + 0.01, tall - 0.6, 0);
        const wm = this.mat('#e8e8e8'); add(wm, L * 0.7, 0.12, 0.12, -L * 0.1, tall + 0.1, -0.35); add(wm, L * 0.7, 0.12, 0.12, -L * 0.1, tall + 0.1, 0.35);
        for (let s = -L * 0.43; s < L * 0.25; s += 0.6) add(wm, 0.08, 0.08, 0.7, s, tall + 0.1, 0);
        add(this.mat('#f2d24a'), L * 1.01, 0.12, W * 1.01, 0, 0.9, 0);
      } else if (st === 'truck' || st === 'armored') {
        add(st === 'armored' ? bodyMat : this.mat('#e6e6e6'), L * 0.68, tall - 0.4, W, -L * 0.15, 0.35 + (tall - 0.4) / 2, 0);
        add(bodyMat, L * 0.28, tall - 0.6, W * 0.96, L * 0.35, 0.35 + (tall - 0.6) / 2, 0);
        add(glass, 0.08, 0.6, W * 0.8, L * 0.49, tall - 0.55, 0);
      } else if (st === 'van' || st === 'swat' || st === 'ambulance') {
        add(bodyMat, L, tall - 0.3, W, 0, 0.3 + (tall - 0.3) / 2, 0);
        add(glass, 0.1, 0.55, W * 0.86, L / 2 - 0.3, tall - 0.55, 0);
        add(glass, L * 0.55, 0.4, W * 1.01, L * 0.1, tall - 0.6, 0);
        if (st === 'ambulance') add(this.mat('#d7262e'), L * 1.01, 0.18, W * 1.01, 0, 1.0, 0);
      } else {
        // 옆모습 윤곽을 밀어 만든 둥근 차체 + 좁은 유리 캐빈 + 지붕 (스타일마다 비율이 다르다)
        const P_ = this.carProfile(st, L, W, tall, bodyH);
        const bm = new THREE.Mesh(P_.body, bodyMat); g.add(bm);
        const cab = new THREE.Mesh(P_.cab, glass); g.add(cab);
        const roof = new THREE.Mesh(P_.roof, bodyMat); g.add(roof);
        add(this.mat('#16181c'), L * 1.005, 0.12, W * 1.01, 0, 0.33, 0); // 아래 몰딩
        g.userData.cab = [cab, roof];
      }
      for (const [x, z] of [[L * 0.32, W / 2 - 0.1], [L * 0.32, -W / 2 + 0.1], [-L * 0.32, W / 2 - 0.1], [-L * 0.32, -W / 2 + 0.1]]) { const rim = new THREE.Mesh(this.geo.rim, this.mat(st === 'sports' || st === 'super' || st === 'hyper' ? '#2b2b2e' : '#b8bec6')); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.34, z + Math.sign(z) * 0.1); g.add(rim); const w = new THREE.Mesh(this.geo.wheel, this.mat('#111')); w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w); }
      const hl = new THREE.MeshBasicMaterial({ color: 0xfff7d6 }), tlm = new THREE.MeshBasicMaterial({ color: 0x8a1a1a });
      for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) { add(hl, 0.06, 0.16, 0.36, L / 2 + 0.01, 0.75, z); add(tlm, 0.06, 0.16, 0.36, -L / 2 - 0.01, 0.8, z); }
      g.userData.tail = tlm; g.userData.hl = hl;
      if (st === 'police' || st === 'ambulance' || st === 'swat' || st === 'fire') {
        const r = new THREE.MeshBasicMaterial({ color: 0xff2d2d }), b = new THREE.MeshBasicMaterial({ color: 0x2d6bff });
        add(r, 0.35, 0.15, W * 0.4, -0.2, tall + 0.08, -W * 0.22); add(st === 'ambulance' || st === 'fire' ? r : b, 0.35, 0.15, W * 0.4, -0.2, tall + 0.08, W * 0.22);
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
    // (피부는 약간 자체 발광 → 그늘에서도 칙칙하지 않게)
    // 사람: 둥근 몸통·팔다리(캡슐) + 얼굴(눈·눈썹·입) + 머리 모양(짧은/긴/포니테일/단발) — 여성은 가는 허리·치마·맨다리
    const G = this.geo, F = !!p.female, dressed = F && p.dress;
    const shirt = new THREE.MeshLambertMaterial({ color: p.shirt }), pants = new THREE.MeshLambertMaterial({ color: p.pants });
    const skinM = new THREE.MeshLambertMaterial({ color: p.skin, emissive: shade(p.skin, -0.55) }), hairC = p.kind === 'cop' ? '#15213f' : p.kind === 'gang' ? (GANGS[p.gang] || GANGS.dragon).band : p.hat || p.hair;
    const hairM = new THREE.MeshLambertMaterial({ color: hairC }), shoeM = this.mat(F ? (p.shoe || '#2b1d1d') : '#1c1c1e');
    const mesh = (geo, mat, sx, sy, sz, x, y, z, par = g) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); par.add(m); return m; };
    const legs = [];
    for (const z of [-0.1, 0.1]) {
      const piv = new THREE.Group(); piv.position.set(0, 0.9, z * (F ? 0.85 : 1));
      mesh(G.limb, dressed ? skinM : pants, F ? 0.82 : 1, 1, F ? 0.82 : 1, 0, -0.44, 0, piv);
      mesh(G.box, shoeM, F ? 0.24 : 0.28, 0.08, F ? 0.1 : 0.13, 0.05, -0.87, 0, piv);
      g.add(piv); legs.push(piv);
    }
    // 몸통: 가슴 + 허리(여성은 가늘게) + 골반
    mesh(G.torso, shirt, F ? 0.66 : 0.8, 1, F ? 0.92 : 1.15, 0, 1.3, 0);
    mesh(G.torso, dressed ? shirt : pants, F ? 0.62 : 0.76, 0.55, F ? 0.86 : 1.0, 0, 1.0, 0);
    if (dressed) mesh(G.skirt, shirt, 0.95, 0.5, 0.95, 0, 0.72, 0);
    const arms = [];
    for (const z of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(0, 1.5, z * (F ? 0.24 : 0.28));
      mesh(G.arm, F && dressed ? skinM : shirt, 1, 1, 1, 0, -0.26, 0, piv);
      mesh(G.hand, skinM, 1, 1, 1, 0, -0.55, 0, piv);
      g.add(piv); arms.push(piv);
    }
    // 목·머리·얼굴 (앞 = +x)
    mesh(G.limb, skinM, 0.7, 0.18, 0.7, 0, 1.6, 0);
    const head = mesh(G.head, skinM, 1.0, F ? 1.12 : 1.08, 0.94, 0.01, 1.74, 0);
    const eyeM = this.mat('#1b1b22'), browM = this.mat(shade(hairC, -0.2));
    const whiteM = this.mat('#f4f1ec'), irisM = this.mat(p.eyeC || '#3a2418');
    for (const z of [-0.047, 0.047]) {
      mesh(G.eye, whiteM, 0.9, F ? 1.35 : 1.1, 1.4, 0.117, 1.757, z); // 흰자
      mesh(G.eye, irisM, 0.8, F ? 1.1 : 0.9, 0.8, 0.13, 1.755, z);    // 눈동자
      mesh(G.box, browM, 0.02, 0.012, 0.05, 0.12, 1.8, z);             // 눈썹
      if (F) mesh(G.box, eyeM, 0.02, 0.01, 0.052, 0.125, 1.781, z);  // 속눈썹
    }
    if (F) { mesh(G.eye, this.mat(p.lip || '#c9385a'), 0.7, 0.45, 1.5, 0.128, 1.685, 0); for (const z of [-0.078, 0.078]) mesh(G.eye, this.mat('#f4a3a3'), 0.6, 0.5, 1.1, 0.112, 1.715, z); }
    else mesh(G.box, this.mat('#8a5a4a'), 0.02, 0.01, 0.05, 0.122, 1.69, 0);
    // 머리카락
    const st = p.hairStyle || (F ? (p.id % 3 === 0 ? 'ponytail' : p.id % 3 === 1 ? 'long' : 'bob') : 'short');
    const hair = mesh(G.cap, hairM, 1.02, 1.12, 0.98, -0.012, 1.745, 0); hair.material.side = THREE.DoubleSide;
    if (st === 'long') { mesh(G.box, hairM, 0.09, 0.42, 0.28, -0.1, 1.56, 0); for (const z of [-0.12, 0.12]) mesh(G.box, hairM, 0.12, 0.3, 0.05, 0.0, 1.62, z); mesh(G.box, hairM, 0.035, 0.05, 0.22, 0.12, 1.83, 0); }
    else if (st === 'ponytail') { mesh(G.hand, hairM, 1.2, 1.2, 1.2, -0.15, 1.78, 0); mesh(G.limb, hairM, 0.5, 0.3, 0.5, -0.19, 1.62, 0); mesh(G.box, hairM, 0.035, 0.05, 0.22, 0.12, 1.83, 0); }
    else if (st === 'bob') { mesh(G.head, hairM, 1.08, 0.8, 1.1, -0.02, 1.72, 0); mesh(G.box, hairM, 0.035, 0.06, 0.24, 0.12, 1.82, 0); head.renderOrder = 1; }
    if (p.earring) for (const z of [-0.13, 0.13]) mesh(G.eye, this.mat(p.earring), 0.8, 0.8, 0.8, 0.0, 1.67, z);
    if (p.necklace) mesh(G.box, this.mat(p.necklace), 0.02, 0.02, 0.2, 0.1, 1.55, 0);
    const gun = new THREE.Mesh(box, this.mat('#1a1a1a')); gun.scale.set(0.5, 0.1, 0.08); gun.position.set(0.45, 1.2, 0.31); gun.visible = false; g.add(gun);
    if (p.kind === 'player') this.addStyle(g, p);
    g.userData = { legs, arms, gun, shirt, pants, sc: p.shirt, style: p.kind === 'player' ? styleKey(p) : '' };
    this.scene.add(g); return g;
  },

  // 플레이어 모자·조직 마크 (옷 꾸미기)
  logoTex(id) {
    this.logoTexs = this.logoTexs || {};
    if (!this.logoTexs[id]) { const c = document.createElement('canvas'); c.width = c.height = 64; drawGangLogo(c.getContext('2d'), id, 32, 32, 28); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.logoTexs[id] = t; }
    return this.logoTexs[id];
  },
  addStyle(g, p) {
    const box = this.geo.box, h = p.hatType, col = p.hatCol || '#1d1d1f', m = this.mat(col);
    const hg = new THREE.Group(); hg.position.y = 0.09; g.add(hg); // 새 머리 높이에 맞춰 모자를 올린다
    const add = (mat, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(box, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); hg.add(o); return o; };
    if (h === 'cap') { add(m, 0.32, 0.12, 0.32, -0.02, 1.8, 0); add(m, 0.16, 0.03, 0.26, 0.2, 1.75, 0); }
    else if (h === 'beanie') { add(m, 0.33, 0.18, 0.33, -0.02, 1.82, 0); }
    else if (h === 'fedora') { add(m, 0.55, 0.03, 0.55, -0.02, 1.77, 0); add(m, 0.3, 0.16, 0.3, -0.02, 1.86, 0); }
    else if (h === 'bandana') { add(m, 0.32, 0.08, 0.32, -0.02, 1.78, 0); add(m, 0.12, 0.05, 0.08, -0.2, 1.74, 0); }
    else if (h === 'helmet') { add(m, 0.4, 0.34, 0.4, 0, 1.72, 0); add(this.mat('#1c2630'), 0.05, 0.14, 0.3, 0.2, 1.7, 0); }
    else if (h === 'crown') { const gm = new THREE.MeshLambertMaterial({ color: '#f2c14e', emissive: '#5a4210' }); for (let k = 0; k < 5; k++) { const a = k * TAU / 5; add(gm, 0.07, 0.16, 0.07, Math.cos(a) * 0.12, 1.86, Math.sin(a) * 0.12); } add(gm, 0.3, 0.05, 0.3, 0, 1.79, 0); }
    if (p.logo && GANGS[p.logo]) {
      const lm = new THREE.MeshBasicMaterial({ map: this.logoTex(p.logo), transparent: true });
      const pg = new THREE.PlaneGeometry(0.22, 0.22);
      const back = new THREE.Mesh(pg, lm); back.position.set(-0.155, 1.28, 0); back.rotation.y = -Math.PI / 2; g.add(back);
      const chest = new THREE.Mesh(pg, lm); chest.scale.setScalar(0.5); chest.position.set(0.155, 1.36, 0.1); chest.rotation.y = Math.PI / 2; g.add(chest);
      if (h === 'cap' || h === 'beanie' || h === 'helmet') { const hl = new THREE.Mesh(pg, lm); hl.scale.setScalar(0.45); hl.position.set(h === 'helmet' ? 0.205 : 0.15, 1.84, 0); hl.rotation.y = Math.PI / 2; g.add(hl); }
    }
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
      if (!car) eh += P.alt || 0;
      cam.position.set(ex, eh, ey);
      cam.lookAt(ex + fx * 10, eh + Math.tan(this.pitch) * 10 - (car ? 0.1 : 0), ey + fy * 10);
      cam.fov = car ? 70 : 72;
    } else {
      const para = !car && P.alt > 1.2;
      const back = car ? (v === 'front' ? -1 : 1) * (6.5 + car.L * 0.8 + Math.min(car.speed, 30) * 0.08) : para ? (v === 'front' ? -9 : 9) : (v === 'front' ? -4.2 : 4.6);
      const alt = car ? car.alt || 0 : P.alt || 0;
      const up = (car ? 2.6 + car.L * 0.25 : para ? 5 : 2.3) + alt;
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
      const lookH = (car ? 1.2 : 1.45) + alt - (alt > 1.2 ? (para ? 1 : 5) : 0);
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
    const fc = P.car, fAlt = fc ? fc.alt || 0 : P.alt || 0;
    this.stream(P.px, P.py, fc ? Math.abs(fc.speed || fc.spd || 0) : 0, fAlt);
    S.fog.far = this.drawR * (1 - Math.min(1, wet) * 0.3) * (1 - 0.7 * Weather.fog); S.fog.near = Math.min(90, S.fog.far * (0.4 - 0.3 * Weather.fog));
    if (Weather.fog > 0.05) S.fog.color.lerp(new THREE.Color(0.75, 0.78, 0.82), Weather.fog * (1 - night * 0.7));
    const farW = (World.mountains && World.mountains.length) ? Math.max(this.drawR + 60, 2600) : this.drawR + 60; // 산은 멀리서도 보인다 (나머지는 안개와 청크 반경이 가린다)
    if (Math.abs(this.camera.far - farW) > 20) { this.camera.far = farW; this.camera.updateProjectionMatrix(); }
    if (this.mtMat) { this.mtMat.color.copy(S.fog.color).lerp(this._white || (this._white = new THREE.Color(1, 1, 1)), 0.62); } // 먼 산 대기 원근: 하늘색으로 살짝 바랜다
    this.hemi.intensity = 0.25 + (1 - night) * 0.75; this.sun.intensity = 0.1 + (1 - night) * 0.8;
    this.hemi.color.setRGB(amb[0], amb[1], amb[2]);
    this.bmat.emissiveIntensity = night > 0.35 ? night * 0.9 : 0;
    this.lampMat.color.setScalar(night > 0.3 ? 1 : 0.55);
    if (this._glass) this._glass.emissive.setRGB(0.05 + night * 0.62, 0.1 + night * 0.48, 0.16 + night * 0.2);
    if (this.rlMat) this.rlMat.opacity = night > 0.3 ? 1 : 0.35;
    if (this.eiffelMat) this.eiffelMat.emissive.setRGB(0.23 + night * 0.6, 0.16 + night * 0.4, 0.06 + night * 0.08);
    // 신호등
    if (!this.tlT || Game.time - this.tlT > 0.4) {
      this.tlT = Game.time; const cc = new THREE.Color();
      for (const [, ch] of this.chunks) {
        if (!ch.tlHeads || !ch.G.visible) continue;
        ch.tl.forEach((t, i) => { const s = lightState(t.n, t.d); ch.tlHeads.setColorAt(i, cc.set(s === 'g' ? '#39e36b' : s === 'y' ? '#ffc933' : '#ff3b3b')); });
        ch.tlHeads.instanceColor.needsUpdate = true;
      }
    }
    const R2 = 180 * 180;
    // 차량
    const seen = new Set();
    for (const c of Game.cars) {
      if (dist2(c.x, c.y, P.px, P.py) > R2) continue;
      seen.add(c.id);
      let g = this.cars.get(c.id);
      if (!g) { g = this.makeCar(c); this.cars.set(c.id, g); }
      g.position.set(c.x, (c.alt || 0) + (c.jz || 0), c.y); g.rotation.order = 'YXZ'; g.rotation.set(0, -c.a, c.jpitch || 0);
      if (g.userData.hl) { const ok = CarDamage.headlightsOK(c); if (g.userData.hlOK !== ok) { g.userData.hl.color.set(ok ? '#fff7d6' : '#2a2a28'); g.userData.hlOK = ok; } }
      if (c.dmgParts) { const d = c.dmgParts, sx = 1 - (d.f + d.r) * 0.05; if (g.userData.sx !== sx) { g.scale.set(sx, 1 - (d.f + d.r + d.ls + d.rs) * 0.015, 1 - (d.ls + d.rs) * 0.04); g.userData.sx = sx; } } else if (g.userData.sx) { g.scale.set(1, 1, 1); g.userData.sx = 0; }
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
      if (g && p === P && g.userData.style !== styleKey(P)) { S.remove(g); g = null; } // 옷을 갈아입었다
      if (!g) { g = this.makePed(p); this.peds.set(p.id, g); }
      g.visible = !(p === P && Game.view === 'fps');
      g.position.set(p.x, p.alt || (p.swim ? -1.2 : 0), p.y);
      if (p === P) {
        if (P.chute && !g.userData.chute) {
          const ch = new THREE.Group();
          for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(this.geo.box, this.mat(k % 2 ? '#f2f2f2' : '#e0443e')); m.scale.set(1.4, 0.15, 1); m.position.set(0.2, 3.2 + Math.cos((k - 2) * 0.35) * 0.4, (k - 2) * 0.9); ch.add(m); }
          g.add(ch); g.userData.chute = ch;
        }
        if (g.userData.chute) g.userData.chute.visible = !!P.chute;
      }
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
      else if (q.t === 'water') { r = 0.75; gg = 0.88; b = 1; h = 1.2 + (1 - a) * 0.8; }
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
    // 공용 소품 (스파이크·체크포인트·점프대 …)
    const PR = Props.collect(P, 140); let ri = 0;
    for (const o of PR) { if (ri >= this.props.length || o.no3d) continue; const m = this.props[ri++]; m.visible = true; m.position.set(o.x, (o.z || 0) + (o.h || 0.2) / 2, o.y); m.scale.set(o.w, o.h || 0.2, o.d); m.rotation.set(0, -(o.a || 0), o.pitch || 0); m.material.color.set(o.c); m.material.emissive && m.material.emissive.set(o.glow ? o.c : '#000'); }
    for (; ri < this.props.length; ri++) this.props[ri].visible = false;
    // 헬기 서치라이트 (밤)
    const sp = Pursuit.spot, HH = Police.heli, showSpot = !!(sp && HH && !HH.dead && night > 0.3);
    this.spot.visible = this.beam.visible = showSpot;
    if (showSpot) { this.spot.position.set(sp.x, 0.15, sp.y); this.spot.scale.setScalar(7); const hgt = HH.alt; this.beam.position.set((sp.x + HH.x) / 2, hgt / 2, (sp.y + HH.y) / 2); this.beam.scale.set(1, hgt, 1); this.beam.lookAt(sp.x, 0, sp.y); this.beam.rotateX(Math.PI / 2); }
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
