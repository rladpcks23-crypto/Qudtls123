# 네온 하버 (NEON HARBOR)

GTA 1·2 스타일의 탑다운 오픈월드 게임입니다. 브라우저 하나로 실행되고, 외부 이미지나 사운드 파일 없이 모든 것을 코드로 그리고 합성합니다.

## 두 가지 버전

| | PC판 | 모바일판 |
|---|---|---|
| 설치 파일 | `release/NeonHarbor-PC.exe` (Windows, 설치 없이 실행) | `release/NeonHarbor-mobile.apk` (Android) |
| 브라우저용 | `build/neon-harbor-pc.html` | `build/neon-harbor-mobile.html` |
| 조작 | 키보드 + 마우스, **게임패드**(Xbox/PS 호환) | 가상 조이스틱 + 터치 버튼, 자동 조준 |
| 화면 | 창 모드 1280×800, F11 전체화면 | 가로 고정 전체화면(APK), 웹은 시작 시 전체화면 요청 |
| 그래픽 | 고해상도(DPR 2), 조명맵 1/2 해상도, 차량 28·보행자 46 | DPR 1.3, 조명맵 1/3 해상도, 차량 20·보행자 30, 파티클 절반 |
| 기타 | 조준점, 마우스 방향 카메라 선행 | 피격·충돌·폭발 진동, 화면 꺼짐 방지 |

게임 내용(도시, 미션, 저장 형식)은 두 버전이 같습니다. 코드도 하나이고, `build.py`가 `NH_PLATFORM` 상수만 바꿔 두 번 묶습니다.

### 설치
- **Windows:** `NeonHarbor-PC.exe`를 받아 더블클릭. 서명되지 않은 exe라 SmartScreen이 뜨면 "추가 정보 → 실행".
- **Android:** `NeonHarbor-mobile.apk`를 받아 설치("출처를 알 수 없는 앱" 허용 필요). 패키지명 `kr.yechan.neonharbor`라 기존 앱과 따로 설치됩니다.

### 다시 빌드
```bash
python3 gta/build.py                        # HTML 두 개 (PC/모바일)
gta/packaging/build-android.sh              # APK (apktool, zipalign, JDK 필요)
gta/packaging/desktop/build.sh              # Windows exe (node/npm, wine 불필요)
```
APK 서명 키(`packaging/neonharbor.keystore`)는 일부러 커밋해 두었습니다. 같은 키로 서명해야 새 버전이 기존 설치 위에 업데이트됩니다.

### 게임패드 (PC판)
왼쪽 스틱 이동·조향 · 오른쪽 스틱 조준 · RT 사격/가속 · LT 브레이크/후진 · Y 탑승 · A 질주 · LB/RB 무기(도보) · RB/B 핸드브레이크(차) · X 드라이브바이 · 십자키 ↓ 라디오, ↑ 줌 · BACK 지도 · START 일시정지

## 게임 내용

| 요소 | 구현 |
|---|---|
| 도시 | 600m × 600m 절차 생성. 다운타운(고층), 미드타운, 웨스트 힐즈(주택가), 하버 포인트(부두·컨테이너), 선셋 비치, 센트럴 파크 |
| 시점 | GTA 1/2식 의사 3D. 건물 지붕을 원근 투영해 높이감을 주고, 속도에 따라 카메라가 줌아웃 |
| 차량 | 10종(소형차, 세단, 택시, 스포츠카, 머슬카, 밴, 트럭, 경찰차, SWAT, 현금수송차). 슬립각 기반 물리, 핸드브레이크 드리프트, 스키드 마크, 손상 → 연기 → 화재 → 폭발 |
| 교통 | 차선 추종, 교차로 신호 준수, 앞차와 간격 유지, 정체 시 경적, 충돌하면 겁먹고 과속 도주 |
| 보행자 | 인도를 따라 걷고, 모퉁이에서 길을 건너고, 달려오는 차를 피하고, 총성·폭발에 흩어짐. 차에 치이면 쓰러짐 |
| 전투 | 주먹, 야구방망이, 권총, 기관단총, 샷건, 돌격소총, 수류탄, 로켓 런처. 차 안에서 드라이브바이 |
| 수배 ★ | 범죄 점수 → 별 1~5. 경찰이 직접 보거나 시민이 신고. 시야를 놓치면 수색 원 표시, 원 밖에서 버티면 해제. 순찰차·도보 경찰·헬기·검문소·SWAT |
| 미션 | 스토리 6개: 차량 절도·배달, 제한시간 택배, 암살(도주 추격), 조직 소탕, 경찰 따돌리기, 트럭 파괴 |
| 장소 | 병원(사망 시 부활), 경찰서(체포 시), 총포상, 페인트샵(수배 해제·수리), 차고 |
| 수집 | 숨겨진 꾸러미 10개, 뇌물 별(수배 −1), 곳곳의 무기·체력·방탄복 |
| 분위기 | 1초 = 게임 속 1분 낮/밤 순환, 가로등·전조등·사이렌 조명, 비(노면 그립 감소), 합성 라디오 3채널 |
| 기타 | 레이더 미니맵, 전체 지도, 자동 저장(브라우저 localStorage), 모바일 터치 조작 |

## 조작

| 키 | 동작 |
|---|---|
| W A S D | 이동 / 운전 (S는 브레이크·후진) |
| 마우스 | 조준, 왼쪽 클릭 사격 |
| F / Enter | 차량 탑승·하차 (운전자가 있으면 끌어냄) |
| Space | 핸드브레이크 |
| Shift | 전력 질주 |
| Q / E / 휠 / 1–8 | 무기 교체 |
| R | 라디오 채널 |
| H / G | 경적 / 경찰차 사이렌 |
| M / Tab | 전체 지도 |
| Z | 카메라 줌 |
| Esc / P | 일시정지 |

## 참고한 논문·자료와 적용한 곳

1. **Parish & Müller, "Procedural Modeling of Cities", SIGGRAPH 2001**
   도로망을 먼저 만들고 → 도로로 둘러싸인 블록 → 필지 분할 → 구역 규칙에 맞는 건물을 세우는 파이프라인을 격자 도시에 맞게 단순화했습니다. 격자 구간 일부를 지워 슈퍼블록과 T자 교차로를 만듭니다. (`src/world.js`)
2. **Marco Monster, "Car Physics for Games" (2003)**
   앞·뒤 차축의 슬립각으로 횡력을 계산하는 2D 자전거 모델입니다. 그립 한계를 넘으면 미끄러지고, 핸드브레이크는 뒷바퀴 그립을 줄여 드리프트를 만듭니다. 저속에서 불안정한 부분은 기구학 모델과 섞었습니다. (`src/vehicles.js`)
3. **Treiber, Hennecke & Helbing, "Congested traffic states in empirical observations and microscopic simulations", Phys. Rev. E 62 (2000)** — 지능형 운전자 모델(IDM)
   AI 차량의 가속·감속을 IDM으로 계산합니다. 앞차와 빨간불 정지선을 모두 '선행 장애물'로 보고 똑같은 식에 넣습니다. (`src/vehicles.js`)
4. **R. Craig Coulter, "Implementation of the Pure Pursuit Path Tracking Algorithm", CMU-RI-TR-92-01 (1992)**
   차선 경유점을 따라가는 조향입니다. 속도에 비례해 앞을 내다보는 거리를 늘립니다. (`src/vehicles.js`)
5. **Craig Reynolds, "Steering Behaviors For Autonomous Characters", GDC 1999**
   보행자의 seek(인도 따라 걷기), flee(도망), separation(군중 분리), evasion(차 피하기)입니다. (`src/peds.js`)
6. **Amanatides & Woo, "A Fast Voxel Traversal Algorithm for Ray Tracing" (1987)**
   경찰의 시야 판정과 총알 탄도를 타일 격자 위 DDA 광선으로 계산합니다. (`src/world.js`)
7. **흐름장(Flow field) / Dijkstra map 길찾기** — Amit Patel(Red Blob Games) 정리
   플레이어를 원점으로 BFS 거리장을 한 번 계산하고, 추격하는 경찰·조직원 수십 명이 이를 함께 씁니다. (`src/peds.js`)
8. **Richter, Vineet, Roth & Koltun, "Playing for Data: Ground Truth from Computer Games", ECCV 2016**
   GTA V의 도시 장면이 자율주행 학습 데이터로 쓰일 만큼 사실적이라는 연구입니다. 이 게임에서는 "차선·신호·보행 동선이 그럴듯해야 한다"는 기준으로 삼았습니다(논문의 기법 자체를 구현한 것은 아닙니다).
9. **GTA 시리즈 게임 디자인 분석** (GTA 1/2, GTA III, GTA V; GTA Wiki의 수배 시스템 정리 등)
   - GTA 1/2: 탑다운 의사 3D 건물, 속도에 따른 줌
   - GTA III: 범죄 점수 → 별, 별 단계별 투입 전력, 페인트샵, 뇌물 별, 숨겨진 꾸러미, 병원 부활/경찰서 석방
   - GTA V: 시야(Line of Sight) 중심 수배, 마지막 목격 지점 중심의 수색 원, 시민의 휴대폰 신고
   - 카메라 주변의 고리 영역에서만 차량·보행자를 생성하고 멀어지면 제거하는 인구 관리 방식 (`src/main.js`)

## 파일 구조

```
gta/
├── release/           ← NeonHarbor-PC.exe, NeonHarbor-mobile.apk
├── build/             ← neon-harbor-pc.html, neon-harbor-mobile.html (단일 파일)
├── build.py
├── dist/              ← 웹 게시용 본문 (PC/모바일)
├── packaging/         ← 아이콘 생성, APK/EXE 빌드 스크립트
└── src/
    ├── shell.html     메뉴·일시정지·상점·터치 버튼 마크업과 CSS
    ├── core.js        수학, 입력, Web Audio 효과음·라디오
    ├── world.js       도시 생성, 도로 그래프, 시야 판정
    ├── vehicles.js    차량 물리, 교통 AI, 경찰 추격
    ├── peds.js        보행자, 플레이어, 무기, 폭발, 파티클, 픽업
    ├── police.js      수배·목격자·배차·헬기·검문소
    ├── missions.js    스토리 미션, 저장
    ├── render.js      지면, 의사 3D 건물, 조명, 날씨
    ├── ui.js          HUD, 레이더, 지도, 메뉴, 터치 조작
    └── main.js        게임 루프, 인구 관리, 카메라, 사망/체포
```
