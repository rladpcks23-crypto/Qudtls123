# 네온 하버 (Neon Harbor) — AI 코딩 도구용 프로젝트 안내

GTA 1·2 스타일 탑뷰 오픈월드 게임. **순수 JavaScript + Canvas 2D (+ Three.js 3D 시점)**, 번들러·npm 의존성 없음.
UI·대사·주석은 전부 **한국어**. 새 문자열도 한국어로 쓴다.

## 빌드 · 실행 · 테스트

```bash
python3 build.py                 # src/*.js + shell.html → build/neon-harbor-{pc,mobile}.html, dist/artifact-*.html
# 브라우저로 build/neon-harbor-pc.html 을 바로 열면 실행된다 (서버 불필요)

npm install && npx playwright install chromium   # 테스트용 (한 번만)
npm test                         # = 빌드 + 무작위 조작 테스트
node tests/soak-test.js          # 400초 무작위 조작 — errs/nan 이 비어 있어야 한다
node tests/missions-test.js      # 스토리 14개 자동 진행 (테스트가 순간이동을 해서 일부 FAIL은 정상)
node tests/jobs-test.js          # 직업 9개 자동 진행

bash packaging/build-android.sh  # release/NeonHarbor-mobile.apk (apktool·zipalign·JDK 필요, 키: packaging/neonharbor.keystore)
bash packaging/desktop/build.sh  # release/NeonHarbor-PC.exe (electron-builder)
```
버전 올리기: `packaging/build-android.sh`의 versionCode/versionName, `packaging/desktop/package.json`의 version, `CHANGELOG.md`.

## 구조

`build.py`의 `ORDER` 순서대로 모든 `src/*.js`가 **하나의 `<script>`로 이어 붙는다** → 전역 스코프를 공유한다(import/export 없음).
최상위에서 다른 파일의 객체를 건드리는 코드(예: `SHOPS.dealer = ...`)는 그 객체가 정의된 파일보다 **뒤**에 와야 한다.

| 파일 | 내용 |
|---|---|
| `core.js` | 수학 헬퍼(`clamp` `lerp` `smooth` `dist` `rand` `pick`…), 입력(`Input` `keyDown` `keyHit` `Pad`), `Sfx`(Web Audio), `Radio`, `Settings`(localStorage), `Perf`(성능 모드), `Zoom`, `TUNE` |
| `world.js` | `genWorld(seed)` 절차적 도시 생성: 타일 `TL`, 구역 `DIST`/`DIST_NAMES`, 도로 그래프 `World.nodes/edgesList`, 건물, 장소 `World.places`(`makePlace`/`makeLotPlace`), 군사 기지 `World.base`, 마리나 `World.marinas`. `solidT`(사람·AI), `solidNoWater`(헤엄치는 플레이어·차), `solidBoat`(보트) |
| `vehicles.js` | `VTYPES`(차종 표), `class Car`(자전거 모델 물리), 교통 AI(IDM·pure pursuit), 경찰차 추격, `playerDrive`, 물에 빠짐 `sinkCar` |
| `peds.js` | `WEAPONS`, `class Ped`/`PlayerPed`, `fireWeapon`, `explode(x,y,r,dmg,by,source,alt)`, 유도탄, 보행자 AI, `Particles` `Decals` `Effects`, 픽업 |
| `police.js` | 수배 `Wanted`, `crime(type,x,y)`, 경찰 배차·헬기, 무단횡단 `Jay` |
| `missions.js` | `Save`(localStorage 저장 형식), `Missions`, `MISSION_DEFS`(스토리 14개) |
| `jobs.js` | `JOBS`, `Jobs.u_<id>(j,dt,P)`(직업별 로직), 소매치기 `Pick` |
| `npc.js` | 대사 `Talk`, 구급차 `EMS`, 의뢰인 `Givers`, 노점 `Vendors`, 은신처, `GPS`, 치트 `Cheats` |
| `military.js` | 전차·헬기·전투기·보트 물리 `specialStep`, 탑승 무기 `VWEAP`/`VSET`/`MilFire`(락온), 군 기지 `Military`, 공중 추격 `AirPatrol`, 낙하산 `Para`, `roofAt` |
| `render.js` | 2D 렌더(`renderScene`, `drawCar`, `drawPed`, `drawBoat`, 조명 `lightPass`), 카메라 `Cam` |
| `view3d.js` | Three.js 3D 시점(후면·전면·1인칭). 차량·사람 메시 `makeCar`/`makePed` |
| `ui.js` | HUD `drawHUD`, 레이더, 전체 지도, 메뉴·일시정지, 상점 `SHOPS`/`Shop`, 터치 조작·핀치 줌 |
| `economy.js` | 가방 `Bag`, 차량 매매 `Dealer`, 내 차고 `Fleet`, 사업체 `BUSINESSES`/`Biz` |
| `casino.js` | 카지노 `Casino`(룰렛·슬롯·블랙잭) |
| `main.js` | `Game` 루프, 인구 관리 `populate`, 플레이어 조작, 카메라, 사망·체포·리스폰, 장소 진입 `places()` |
| `shell.html` | 메뉴·상점·카지노 마크업과 **모든 CSS**(모바일 버튼 배치 포함) |

## 자주 하는 수정

- **차종 추가**: `VTYPES`에 항목(style은 기존 것 재사용 가능). 매매상 판매는 `economy.js`의 `VEHICLE_PRICES`·`DEALER_STOCK`.
- **무기 추가**: `WEAPONS` + `WEAPON_ORDER`(peds.js), 아이콘 `drawWeaponIcon`(render.js), 총포상 목록 `SHOPS.ammu`(ui.js).
- **스토리 미션**: `MISSION_DEFS`에 `{ title, reward, intro, outro, start(m), update(m,dt) → 'pass' | {fail}, noPolice? }` 추가 + `Missions.init`의 `givers`에 의뢰인 위치 하나 추가.
- **직업**: `JOBS`에 정의(legal, vehicle?) + `Jobs.u_<id>` 함수 + 필요하면 `timeout`/`stop` 정리.
- **가게/사업체**: `SHOPS[kind] = { title, sub, items: () => [...] }`. 항목에 `fn`이 있으면 **fn이 직접 돈을 처리**한다(Shop은 차감하지 않음 — 이중 결제 버그 방지). 사업체는 `BUSINESSES`에 추가 + `world.js`에서 `makePlace('biz_…', …)`.
- **장소 추가**: `world.js` 7) 특수 장소 부분의 `makePlace`(건물 문 앞 마커) 또는 `makeLotPlace`(마당형). 지도 아이콘은 `ui.js placeIcons`, 문 앞 고리는 `PLACE_MARK`.
- **저장 항목 추가**: `Save.write`(missions.js)와 `Game.newGame`(main.js)의 불러오기 부분을 함께 고친다.

## 주의할 점

- 좌표 단위는 **미터**, 타일 한 칸 `T = 4m`, 맵 `MW×MH = 190×190` 타일. 각도는 라디안, 0 = 동쪽.
- 게임 시간: `Game.clock`(분, 실제 1초 = 게임 1분), `Game.time`(초).
- `P.px/P.py`는 차에 타고 있으면 차 위치. 비행 고도는 `car.alt`, 낙하산은 `P.alt`.
- 탑승 무기 차량 판정은 `hasVW(car)` (보트는 `V.special==='boat'`지만 무기 없음).
- 공중 물체는 `airborne(c)`(alt>1.2) — 지상 충돌·폭발·픽업 판정에서 제외된다.
- 모바일 전용 분기는 `IS_MOBILE`/`Input.usingTouch`, 버튼 배치는 `shell.html`의 `body.driving`/`body.special` CSS.
- 수정 후에는 `python3 build.py` → `node tests/soak-test.js`로 오류가 0인지 확인한다.
