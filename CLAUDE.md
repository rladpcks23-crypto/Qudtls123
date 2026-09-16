# 이 저장소에 대해

두 가지가 들어 있다. 서로 무관하니 섞지 말 것.

1. **탕부하나님 레드라인 앱** — Android / Windows(Electron) / Web 빌드
2. **연구 학습 노트** (`docs/research/`) — 3D 모델링·구조역학·로보틱스

---

## ⚠️ 먼저 읽을 것 — 연구 학습 노트

`docs/research/` 에 이전 세션에서 **논문을 직접 읽고 정리한 지식 베이스**가 있다.
아래 주제가 대화에 나오면 **답하기 전에 해당 파일을 읽어라.** 기억에 의존해 답하지 말 것.

| 파일 | 언제 읽나 | 핵심 내용 |
| :--- | :--- | :--- |
| [`fusion360-3d-modeling-papers.md`](docs/research/fusion360-3d-modeling-papers.md) | Fusion 360, CAD, B-rep, 3D 모델링 데이터셋/AI | Fusion 360 Gallery 데이터셋 3종, BRepNet, UV-Net, JoinABLe, CurveGen, 생성형 CAD(CAD-Recode·Text2CAD) |
| [`specific-stiffness-structures.md`](docs/research/specific-stiffness-structures.md) | 경량화, 강성, 격자/인필 구조, 재료 선택 | Ashby 재료 지수, 형상 계수, Gibson-Ashby 스케일링, 판 격자 vs 트러스, FDM 인필 실험 |
| [`human-hand-anatomy.md`](docs/research/human-hand-anatomy.md) | 사람 손, 해부학, 파지, 생체역학 | 골격/자유도, 외재근·내재근, 활차 A1~A5, 신전건막, Santello 시너지, Feix 파지 분류 |
| [`robot-arm-and-hand.md`](docs/research/robot-arm-and-hand.md) | 로봇 팔, 로봇 손, 매니퓰레이터, 조작 학습 | 7 DOF 여유자유도, SEA/QDD 구동, 손 하드웨어 비교(Shadow·LEAP·RUKA·SoftHand), Dactyl 이후 RL |

네 문서는 서로 링크되어 있다. 로봇 손 설계 얘기는 해부학 노트가 근거이고,
링크 경량화는 비강성 노트가, CAD 작업은 Fusion 360 노트가 근거다.

### 이 노트를 다룰 때의 규칙

- **각 문서 마지막 장이 "정확도 메모"다.** 어디까지 원문을 읽었고 어디가 초록 수준인지 적혀 있다.
  인용하기 전에 반드시 확인하고, 초록 수준인 내용은 그렇다고 밝혀라.
- 숫자를 인용할 때 **문헌마다 갈리는 값**이 표시되어 있으면 하나로 고정하지 말 것
  (예: 사람 손 자유도 21~27, Shadow Hand DOF 22 vs 24).
- 새로 조사한 내용은 해당 파일에 **덧붙이고**, 정확도 메모도 함께 갱신할 것.
- 새 주제면 `docs/research/` 에 새 파일을 만들고 **이 표에 한 줄 추가**할 것.
  그래야 다음 세션이 찾을 수 있다.

---

## 탕부하나님 레드라인 앱

수능 수험생용 묵상 앱. 원본 "레드라인" 앱과 **별개 앱으로** 설치되도록 만든 것
(applicationId와 런처 라벨이 다름).

| 경로 | 내용 |
| :--- | :--- |
| `app/assets/index.html` | **단일 원본(source of truth).** 앱 화면 전체 |
| `app/icons/` | 런처 아이콘 (mipmap 밀도별) |
| `android/build.sh` | APK 빌드. apktool로 원본 APK를 리패키징 |
| `android/tools/` | AOSP build-tools에서 가져온 apksigner (Apache-2.0) |
| `desktop/` | Electron 포터블 .exe (`npm run build:win`) |
| `web/build.sh` | `app/assets/index.html` → Artifact용 HTML 조각 생성 |
| `design/` | 아이콘 마스터 이미지 |

### 빌드할 때 주의

- **APK 서명은 반드시 `apksigner`** (jarsigner 아님). jarsigner는 v1 서명만 만드는데,
  일부 기기가 v1-only APK 설치를 거부한다 ("앱이 설치되지 않았습니다"만 뜨고 원인 표시 없음).
  apksigner는 v1+v2+v3를 함께 넣는다.
- **서명 키스토어를 버리지 말 것.** 과거에 이걸 버려서 설치 충돌 버그가 났다.
- 앱 내용을 고치면 `app/assets/index.html` 하나만 고치고 각 빌드 스크립트를 다시 돌린다.

---

## 작업 규칙

- 개발 브랜치: `claude/<주제>-<해시>` 형식. 기본 브랜치에 직접 푸시하지 말 것.
- PR은 명시적으로 요청받았을 때만 생성한다.
