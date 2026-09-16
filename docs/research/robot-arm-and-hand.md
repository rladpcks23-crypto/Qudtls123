# 로봇 팔·로봇 손 — 논문 학습 노트

> 작성일: 2026-09-16
> 짝 문서: [사람 손의 해부학·생체역학](./human-hand-anatomy.md) — 이 문서의 설계 근거가 그쪽에 있다
> 짝 문서: [로봇 팔의 활용](./robot-arm-applications.md) — 어디에 어떻게 쓰이는지, 도메인별 실제 성능
> 관련: [같은 무게에서 더 큰 강성을 내는 구조](./specific-stiffness-structures.md) (링크 경량화),
> [Fusion 360 / 3D 모델링 논문](./fusion360-3d-modeling-papers.md) (CAD 설계)

---

## 0. 한 줄 요약

로봇 팔과 로봇 손은 **정반대의 설계 문제**다.

- **로봇 팔**: 자유도가 적다(6~7). 문제는 **강성·정밀도·페이로드와 안전·경량의 충돌**.
- **로봇 손**: 자유도가 많다(15~24). 문제는 **자유도를 어떻게 줄일 것인가(언더액추에이션)와
  줄인 대가로 생기는 비선형성을 어떻게 제어할 것인가**.

그리고 2023년 이후 로봇 손 분야의 병목은 **소프트웨어가 아니라 하드웨어**라는 진단이 반복해서 나온다.

---

## 1. 로봇 팔

### 1.1 자유도 — 왜 6이 아니라 7인가

- **6 DOF**: 3차원 공간에서 **위치 3 + 자세 3**을 지정하는 최소 자유도. 해가 유한 개.
- **7 DOF (여유자유도, redundant)**: 같은 손끝 자세에 대해 **팔 자세가 연속체(continuum)로 존재**한다.

**자기운동(self-motion)**: 손끝 자세를 고정한 채 팔꿈치를 회전시키는 움직임.
- 팔꿈치는 관절 1·2가 만드는 **토러스**와 관절 6·7 중심의 **구**가 교차하는 곡선 위에 있다
- 이 여분의 자유도(영공간, null space)로 다음을 동시에 할 수 있다:
  - **장애물 회피** — 손끝은 그대로 두고 팔꿈치만 피한다
  - **특이점 회피(singularity avoidance)**
  - **관절 토크 최적화** — 같은 작업을 더 적은 토크로
- 7 DOF는 **최소한의 여유자유도**라서 실무에서 가장 흔한 선택 (사람 팔도 7 DOF)

**특이점(singularity)**: 자코비안이 랭크를 잃어 특정 방향으로 손끝을 움직일 수 없게 되는 자세.
관절 속도가 발산한다. 여유자유도 각(redundancy angle)으로 회피 전략을 세우는 연구가 있다 (PMC8587006).

### 1.2 구동 방식 트레이드오프

| 방식 | 장점 | 단점 |
| :--- | :--- | :--- |
| **하모닉 드라이브 + 고감속** | 고토크, 고정밀, 백래시 거의 없음 | 역구동 불가(non-backdrivable), 무거움, 비쌈, 충돌 시 위험 |
| **사이클로이드 감속기** | 고토크, 충격 강함 | 무거움, 마찰 큼 |
| **QDD (Quasi-Direct Drive)** | **역구동성 우수, 대역폭 높음**, 힘센서 불필요 | 감속비 낮아 토크 한계, 모터가 커짐 |
| **SEA (Series Elastic Actuator)** | 힘 제어 정확, **임피던스 낮음**, 충격 흡수, 스프링 변형으로 힘 측정 | **대역폭 희생**, 위치 정밀도 저하 |
| **텐던/케이블 구동** | 모터를 베이스로 이동 → **관성 최소** | 비선형, 히스테리시스, 장력 관리 필요 |

### 1.3 SEA — "더 뻣뻣한 게 낫다"는 통념을 깬 설계

> SEA는 기어트레인과 부하 사이에 **의도적으로 컴플라이언트 요소를 넣어 강성을 낮춘다.**
> 위치 센서로 변형을 재고 **훅의 법칙으로 출력 힘을 정확히 계산**한다.
> (arXiv:0912.3956)

**핵심 트레이드오프**: 낮은 강성 = 좋은 힘 제어 + 안전, 하지만 **대역폭 손실**.
높은 강성 = 빠른 응답 + 큰 출력, 하지만 딱딱하고 위험.

이 모순을 풀려는 시도들:
- **VSSEA** (arXiv:2301.00939): 가변 강성. **20 Nm/rad ~ 1000 Nm/rad** 범위, 토크밀도 **36 Nm/kg**.
  평형·비평형 위치 모두에서 저에너지로 강성 변조.
- **가변 강성 SEA** (arXiv:2205.14412): 비선형 강성으로 작업별 요구 조건에 대응
- **WAVE** (arXiv:2509.21878): **역구동 불가 웜기어**로 모터를 외력에서 분리.
  충격을 스프링 탄성에너지로 변환해 흡수.
- **QDD 대안** (arXiv:2004.00467): SEA가 컴플라이언스를 위해 대역폭을 희생하는 문제를,
  고토크밀도 모터 + 저감속비로 우회

### 1.4 경량·저관성 팔 — 최근 트렌드

안전의 핵심은 **움직이는 부분의 관성을 줄이는 것**이다. 충돌 에너지가 곧 관성 × 속도²이기 때문.

| 연구 | 접근 |
| :--- | :--- |
| **SAQIEL** (arXiv:2403.01803) | **수동 3D 와이어 정렬기**로 저마찰 동력 전달. 무거운 액추에이터를 전부 **루트 링크에 집중** |
| **ARMADA** (arXiv:2502.16908) | 6 DOF 양팔. 저관성 **역구동 액추에이터** + 3D 프린팅 링크. **비싼 토크 센서 없이** 접촉 풍부한 조작 |
| **텐던 구동 팔** (arXiv:2307.02654) | 4 DOF. 텐던으로 모터를 관절 밖으로 빼서 **고속에서도 충돌력 감소** |
| **DexWrist** (arXiv:2507.01008) | QDD + **분리된 운동학(decoupled kinematics)**. 손목이 병목이라는 문제 제기 |
| **토폴로지 최적화** (PMC10451915) | 어셈블리 FE 모델 기반 링크 경량화 → 협동로봇 구조 설계 |

> **연결**: 링크 경량화는 [비강성 노트](./specific-stiffness-structures.md)의 문제와 정확히 같다.
> 굽힘을 받는 로봇 링크는 **속 빈 단면**이 정답이고, 3D 프린팅한다면 **벽 두께 > 인필 밀도**다.

---

## 2. 로봇 손 — 하드웨어

### 2.1 주요 손 비교

| 손 | 가격 | DOF | DOA (액추에이터) | 구동 | 오픈소스 |
| :--- | ---: | ---: | ---: | :--- | :--- |
| **사람 손** | — | 22~24 | — | 텐던 | — |
| **Shadow Dexterous Hand** | $100,000 | **24** | 20쌍 길항 텐던 | 텐던 | ✗ |
| **Allegro Hand** | $15,000 | 16 (4손가락) | 16 | 직접구동 | ✗ |
| **Allegro Xella** | $75,000 | 16 | 16 | 직접구동 | ✗ |
| **LEAP Hand** (RSS 2023) | **$2,000** | 16 (4손가락) | 16 | 직접구동 | ✓ |
| **RUKA** (2025) | **$1,300** | 15 | 11 | 텐던 | ✓ |
| **Inmoov** | $100 | 14 | 5 | 텐던 | ✓ |
| **Pisa/IIT SoftHand** | — | **19** | **1** | 텐던 (적응형 시너지) | ✓ |

> **DOF 표기 주의**: Shadow Hand는 문헌에 따라 **22 또는 24 DOF**로 표기된다.
> 손목 2 DOF 포함 여부 차이. OpenAI 논문은 24 DOF / 20쌍 텐던으로 기술한다.

### 2.2 직접구동 vs 텐던구동

**직접구동 (LEAP, Allegro)**
- 모터+엔코더가 관절에 직접 → **정밀 제어, 모델링 쉬움**
- 하지만 **손이 커지고 무거워진다.** 사람 손 크기를 못 맞춘다
- Allegro는 $15,000인데 손가락이 **4개뿐이고, 과열되며, 수리가 어렵다**
- LEAP은 내구성·수리성을 개선했지만 여전히 **오버사이즈**

**텐던구동 (Shadow, RUKA, SoftHand)**
- 액추에이터를 손 밖으로 → **컴팩트 + 강력**, 사람 손 크기 달성 가능
- 대가: **비선형성, 탄성, 불확실성**이 힘 전달 경로에 들어간다
  → 액추에이터 명령과 관절각/손끝 위치의 관계를 모델링하기 어렵다
- 손 안에 작은 엔코더를 넣으면 완화되지만 **비싸고, 고장 나기 쉽고, 수리가 어렵다**

### 2.3 LEAP Hand — 보편적 외전/내전 기구

**Shaw, Agarwal & Pathak, RSS 2023**
- 16 DOF 4손가락, 3D 프린팅 + 기성 액추에이터, **4시간 조립 / $2,000**
- 핵심 기여: **universal abduction-adduction mechanism**
  - MCP-2 축을 **첫 번째 관절의 기준 프레임**으로 가져와 **항상 직교**하도록 배치
  - → **어떤 MCP 자세에서도 모든 자유도를 유지**한다
- Allegro 대비 **모든 실험에서 우위, 가격은 1/8**

### 2.4 RUKA — 텐던 구동의 제어 난제를 학습으로 푼다

**Zorin, Guzey 외 (NYU), arXiv:2504.13165**

설계:
- 15 DOF / **11 액추에이터**, 사람 손 평균 치수, **7시간 조립 / $1,300 미만**
- 엄지 3모터(관절당 1개), 나머지 4손가락은 각 2모터 (**PIP+DIP를 하나의 텐던으로 결합**)
- 굴곡은 텐던, 신전은 **스프링**
- 손가락 **벌림(splay)** 을 구조에 넣어 **능동 자유도 없이** 자연스러운 외전/내전 구현
- Dynamixel 모터, 환기 구조로 과열 방지, OnShape CAD 공개, MuJoCo 모델 제공

**가동범위 (사람과 비교)**
| 관절 | RUKA | 사람 |
| :--- | ---: | ---: |
| DIP | 120° | 85° |
| PIP | 120° | 105° |
| MCP (손가락) | 140° | 85° |
| IP (엄지) | 120° | 80° |
| MCP (엄지) | 90° | 56° |
| CMC | 190° | — |

**제어 — 핵심 아이디어**
1. **MANUS 모션캡처 글러브를 로봇 손에 씌운다.** 손 형태가 사람과 같기 때문에 가능.
   → **관절 엔코더 없이** 손끝·관절 위치 데이터를 얻는다
2. 모터 한계 내에서 **명령을 절차적으로 샘플링**해 (손끝/관절 위치, 액추에이터 명령) 쌍을 자동 수집
3. 이 데이터로 **fingertip-to-actuator / joint-to-actuator 모델**을 학습

> **왜 이게 중요한가**: 텐던 구동의 비선형성을 **모델링하지 않고 학습으로 우회**했다.
> 값싼 재료로도 정밀도를 얻는 길을 연 것. LEAP·Allegro 대비 도달성·내구성·힘에서 우위.

**PIP/DIP 결합의 근거**: 사람 손에서도 **DIP와 PIP는 거의 독립적으로 구동되지 않는다.**
→ [해부학 노트 2.1](./human-hand-anatomy.md)의 다관절 힘줄(FDP/FDS) 구조가 그 이유.

### 2.5 언더액추에이션 — Pisa/IIT SoftHand

**Catalano, Grioli, Farnioli, Serio, Piazza & Bicchi, *IJRR* 33(5), 2014**

- **19 자유도를 단 1개 모터로 구동** — 소프트 시너지(soft synergy) 개념의 직접 구현
- 기존 관절 설계 대신 **혁신적 관절(articulation)과 인대(ligament)** 사용
- 매우 부드럽고 안전하면서도 강력하고 극도로 견고

**적응형 시너지(adaptive synergy)**: 하나의 텐던이 모든 손가락을 지나가면서,
물체에 닿은 손가락은 멈추고 나머지는 계속 닫힌다 → **물체 형상에 자동으로 맞춰진다.**

파생 연구가 매우 많다:
- **BRL/Pisa/IIT SoftHand** (arXiv:2206.12655): 저가 3D 프린팅판
- **Tactile SoftHand-A** (arXiv:2406.12731): 길항 텐던 추가로 **능동 개방** + 촉각 센서
- **SoftHand Model-W** (arXiv:2604.00738): 2 DOF 손목 통합 + **수근관 모사 텐던 라우팅**
- **Educational SoftHand-A** (arXiv:2510.15638): **LEGO MINDSTORMS만으로** 구현

### 2.6 최근 설계 아이디어들 (2024~2026)

| 연구 | 핵심 아이디어 |
| :--- | :--- |
| **CRAFT** (arXiv:2603.12120) | **"접촉은 손 전체에 균일하지 않다."** 충격은 관절에 집중되고 링크는 하중을 받는다 → **관절엔 소프트 재료, 링크는 리지드**. 구름접촉(rolling-contact) 관절면으로 굴곡 경로 반복성 확보 |
| **RIM Hand** (pmid:41817285) | **수근골-중수골 전체를 모델링**해 손바닥 변형 구현. Nitinol 배측 신근 |
| **CYJ Hand-0** (arXiv:2507.14538) | 21 DOF. **SMA(형상기억합금)로 신전·외전**, 모터로 굴곡. 낚싯줄 텐던, AlSi10Mg 3D 프린팅 골격 |
| **MM-Hand** (arXiv:2604.17245) | 21 DOF. 원격 텐던 구동으로 손 안 공간을 비워 **센싱 모듈과 정비성** 확보. 발열 분리 |
| **CATCH-919** (arXiv:1809.04290) | MCP 신전 기전을 새로 해석해 **IP 관절과 MCP의 독립 운동** 구현. 9 액추에이터 / 19 DOF |
| **ARISTO Hand** (arXiv:2605.30508) | **능동적 원위 과신전(hyperextension)** — 얇은 물체 조작. 뽑기 힘 2.76배 |
| **H-PAC** (arXiv:2608.16712) | 텐던 신장(elongation)으로 생기는 관절 오차를 **역학 기반 모델로 보상** |
| **DexHand 021** (arXiv:2511.03481) | 능동 12 + 수동 7 = 19 DOF. 고유수용성 컴플라이언스 제어 |

---

## 3. 로봇 손 — 제어와 학습

### 3.1 OpenAI Dactyl — 전환점 (arXiv:1808.00177)

**하드웨어**: Shadow Dexterous Hand (24 DOF, 20쌍 길항 텐던), PhaseSpace 모션캡처 + Basler RGB 카메라 3대

**과제**: 손바닥 위 블록/팔각기둥을 목표 자세로 **재배향(reorientation)**, 달성하면 새 목표 제시

**방법**
- 시뮬레이션(MuJoCo)에서만 학습, 실기 데이터 0
- **도메인 랜덤화**: 마찰계수, 물체 외형 등 물리 파라미터를 광범위하게 무작위화
- **메모리(RNN) 정책** — 온라인 적응과 암묵적 시스템 식별
- 제어 정책 12 Hz, 저수준 제어기 ~1 kHz
- OpenAI Five와 같은 분산 RL 시스템

**결과 — 인간 시연 없이 자연 발현한 행동**
- **손가락 보행(finger gaiting)**, finger pivoting
- 다지 협응(multi-finger coordination)
- **중력의 의도적 활용**
- 병진력과 비틀림력의 협응
- Feix 분류 기준 **Tip Pinch, Palmar Pinch, Tripod, Quadpod, 5-Finger Precision, Power** 파지 출현

**흥미로운 발견 2가지**
1. 정밀 파지에서 **새끼손가락을 선호**했다. Shadow Hand의 새끼손가락에 자유도가 하나 더 있기 때문.
   사람은 검지·중지가 더 정교하다. → **정책이 사람의 파지를 재발견하되, 자기 몸에 맞게 각색했다.**
2. **말절골(distal phalanx)** 로 finger pivoting을 했다. 어린이는 근위·중간 지골을 쓰고
   성인이 되어야 말절골을 쓴다는 발달 연구와 일치.

**실패 모드**: 손목 pitch 관절을 아래로 회전할 때 물체를 가장 많이 떨어뜨렸고,
**그 관절이 가장 자주 고장 났다** (하중이 가장 크기 때문).

### 3.2 이후 흐름 — 촉각과 시각

| 연구 | 기여 |
| :--- | :--- |
| **DeXtreme** (arXiv:2210.13702) | Isaac Gym 대규모 병렬화로 sim-to-real. 강건한 자세 추정기 동반 |
| **In-Hand Object Rotation via Rapid Motor Adaptation** (arXiv:2210.04887) | **원통형 물체만으로 학습**해도 파인튜닝 없이 수십 종 물체로 전이. 고유수용성만 사용 |
| **Touch Dexterity** (arXiv:2303.10880) | **시각 없이 촉각만으로** 손 안 회전. 고밀도 **이진(닿음/안 닿음)** 센서로 충분 |
| **AnyRotate** (arXiv:2405.07391) | **중력 방향 불변** 다축 회전. 조밀 촉각 sim-to-real, 제로샷 전이 |
| **Visual Dexterity** (arXiv:2211.11744) | 새롭고 복잡한 형상의 실시간 재배향 |
| **Twisting Lids Off with Two Hands** (arXiv:2403.02338) | 양손 협응, 병뚜껑 열기 |
| **Text2Touch** (arXiv:2509.07445) | **LLM이 보상 함수를 설계**. 70개 이상 환경 변수로 확장 |
| **모듈형 RL + 촉각** (arXiv:2303.04705) | 외부 센서 없이 **손바닥을 아래로 향한 채** 24개 목표 자세로 큐브 재배향 |
| **DexNDM** (arXiv:2510.08556) | 관절별 신경 동역학 모델로 reality gap 축소 |

**공통 교훈**
1. **촉각이 결정적이다.** 시각만으로는 접촉 정보를 못 얻는다. 단, **정밀한 촉각이 아니라 조밀한 이진 촉각**으로도 된다.
2. **도메인 랜덤화 + 메모리 정책**이 sim-to-real의 기본 레시피.
3. **텐던 구동은 시뮬레이션이 어렵다** — 언더액추에이션 전달 구조를 시뮬레이터로 표현하기 힘들다
   (arXiv:2608.28578가 이 문제를 직접 지적).

### 3.3 텐던 구동 손의 상태 추정

관절 엔코더를 넣으면 컴팩트함과 민첩성이 희생된다. 그래서 대안들:
- **텐던 변위·장력 측정 → 관절각 추정** (arXiv:2601.20682): DH 기반 운동학 모델 + 비선형 최적화
- **텐던 기반 고유수용성** (arXiv:2509.12969): 단일 센싱 소스로 파지 상태 추정
- **학습 기반 매핑** (RUKA): 모델링을 포기하고 데이터로 대체
- **관절 센서만으로** (arXiv:2605.21330): 모터 엔코더 vs 직접 관절 센싱 비교

---

## 4. 사람 손 → 로봇 손 설계 원칙 (통합 정리)

| 원칙 | 생물학적 근거 | 구현 사례 |
| :--- | :--- | :--- |
| 모터를 손 밖에 둔다 | 근육이 전완에 있음 | Shadow, RUKA, SoftHand Model-W (수근관 모사) |
| DOF > DOA (언더액추에이션) | FDP/FDS 다관절 힘줄 | Pisa/IIT SoftHand (19:1), RUKA (15:11) |
| PIP·DIP를 묶는다 | 사람도 독립 구동 안 됨 | RUKA, 대부분의 저가 손 |
| 텐던 라우팅 = 활차 | A1~A5가 모멘트 암 유지 | 모든 텐던 구동 손의 핵심 설계 |
| 신전은 별도 기구 | 신전건막의 역설적 작용 | 스프링(RUKA), 길항 텐던(Tactile SoftHand-A), SMA(CYJ Hand-0) |
| 엄지에 자유도를 더 준다 | CMC 안장관절의 어긋난 축 | RUKA는 엄지에만 3모터, LEAP의 보편 외전 기구 |
| 손바닥을 강체로 만들지 않는다 | 손의 아치, 4·5지 CMC | RIM Hand, SoftHand Model-W |
| 시너지로 제어한다 | Santello 1998: PC 2개 > 80% | SoftHand 계열 전체 |
| 접촉은 균일하지 않다 | 관절 vs 링크의 하중 차이 | CRAFT (관절 소프트, 링크 리지드) |

---

## 5. 직접 만든다면 — 실무 체크리스트

**설계 단계**
1. **자유도를 먼저 정하지 말고, 목표 파지 종류를 먼저 정한다.**
   Feix 분류에서 손 형상만 보면 33종 → **17종**. 이 중 몇 개가 필요한가?
2. 정밀 조작이 필요 없다면 **시너지 기반 1~2 모터 구조**로 충분하다 (SoftHand 계열).
3. 손끝 위치 제어가 필요하면 **손가락당 최소 2 액추에이터** (RUKA 방식).
4. 엄지에 가장 많은 자원을 투자한다. **대립(opposition)이 파지 성능을 결정한다.**

**구조 설계 (Fusion 360 작업과 직결)**
- 손가락 링크는 굽힘 하중 → **속 빈 단면**. [비강성 노트](./specific-stiffness-structures.md) 참조
- 3D 프린팅이면 **벽 개수 ↑ 우선, 인필은 그 다음**
- 층간 방향(Z)이 가장 약하다 → **텐던 장력 방향과 적층 방향을 맞추지 말 것**
- 텐던 경로는 관절 회전축에서의 **모멘트 암이 가동 범위 전체에서 일정한지** 확인 (활차 원리)

**제어**
- 텐던 구동이면 관절각을 **직접 못 잰다**는 전제로 시작한다
- 모션캡처 글러브 + 자동 데이터 수집(RUKA 방식)이 가장 저렴한 해법
- 촉각은 **조밀한 이진 센서**로도 충분하다 (Touch Dexterity)

**피해야 할 함정**
- 사람 손 자유도(22~24)를 그대로 따라가려 하지 말 것 — 비용과 고장률이 폭증한다
- Allegro의 교훈: **과열과 수리 불가능성**이 연구 도구로서 치명적이다
- Dactyl의 교훈: **가장 하중이 큰 관절이 가장 먼저 부서진다** (손목 pitch)
- 텐던 신장(elongation)은 반드시 생긴다 → 보상 모델을 처음부터 계획에 넣을 것

---

## 6. 정확도 메모

- 2.1 비교표의 가격·DOF·DOA는 **RUKA 논문(arXiv:2504.13165) Table I** 기준이다.
  단 Shadow Hand의 DOF는 RUKA 표에서 22, OpenAI 논문(arXiv:1808.00177)에서 24로 다르게 표기된다
  (손목 포함 여부 차이). 인용 시 출처를 명시해야 한다.
- 2.4의 RUKA 가동범위 표와 설계 내용은 **논문 본문을 직접 읽고** 기록했다.
- 3.1 Dactyl의 결과·발현 행동·실패 모드는 논문 본문 기준이다.
- 1.3 SEA의 VSSEA 수치(20~1000 Nm/rad, 36 Nm/kg)는 arXiv:2301.00939의 저자 주장값이며 독립 검증은 확인하지 않았다.
- 2.6과 3.2의 2025~2026년 논문 상당수는 **초록 수준**에서만 확인했다. 인용 전 본문 재확인 필요.
- Pisa/IIT SoftHand의 "19 DOF / 1 모터"는 원 논문(IJRR 2014)과 개발팀 공식 설명 기준이다.

---

## 7. 참고 문헌

**로봇 팔 — 구동·컴플라이언스**
- [Modeling and Application of Series Elastic Actuators for Force Control Multi Legged Robots](https://arxiv.org/abs/0912.3956) — SEA 기본 개념
- [Design and Control of a Novel Variable Stiffness Series Elastic Actuator](https://arxiv.org/abs/2301.00939) — VSSEA
- [Design, Modelling, and Control of a Reconfigurable Rotary SEA with Nonlinear Stiffness](https://arxiv.org/abs/2205.14412)
- [Quasi-Direct Drive Actuation for a Lightweight Hip Exoskeleton](https://arxiv.org/abs/2004.00467) — QDD vs SEA
- [WAVE: Worm Gear-based Adaptive Variable Elasticity](https://arxiv.org/abs/2509.21878)
- [Evaluation and comparison of SEA torque controllers in a unified framework](https://arxiv.org/abs/2201.00583)

**로봇 팔 — 경량·저관성**
- [SAQIEL: Ultra-Light and Safe Manipulator with Passive 3D Wire Alignment Mechanism](https://arxiv.org/abs/2403.01803)
- [A low-cost and lightweight 6 DoF bimanual arm for dynamic and contact-rich manipulation (ARMADA)](https://arxiv.org/abs/2502.16908)
- [Safe & Accurate at Speed with Tendons: A Robot Arm for Exploring Dynamic Motion](https://arxiv.org/abs/2307.02654)
- [DexWrist: A Robotic Wrist for Constrained and Dynamic Manipulation](https://arxiv.org/abs/2507.01008)
- [A topology optimization method of robot lightweight design](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451915/)

**로봇 팔 — 운동학**
- [Kinematics and Singularity Analysis of a 7-DOF Redundant Manipulator](https://pmc.ncbi.nlm.nih.gov/articles/PMC8587006/)
- [Redundancy parameterization and inverse kinematics of 7-DOF revolute manipulators](https://arxiv.org/abs/2307.13122)

**로봇 손 — 하드웨어 ★**
- [LEAP Hand: Low-Cost, Efficient, and Anthropomorphic Hand for Robot Learning](https://arxiv.org/abs/2309.06440) — Shaw, Agarwal & Pathak, RSS 2023
- [RUKA: Rethinking the Design of Humanoid Hands with Learning](https://arxiv.org/abs/2504.13165) — NYU 2025
- [Ruka-v2: Tendon Driven Open-Source Dexterous Hand with Wrist and Abduction](https://arxiv.org/abs/2603.26660)
- [Adaptive synergies for the design and control of the Pisa/IIT SoftHand](https://journals.sagepub.com/doi/abs/10.1177/0278364913518998) — Catalano 외, *IJRR* 2014 ★
- [BRL/Pisa/IIT SoftHand: A Low-cost, 3D-Printed, Underactuated, Tendon-Driven Hand](https://arxiv.org/abs/2206.12655)
- [Tactile SoftHand-A: Highly-underactuated Hand with Antagonistic Tendon Mechanism](https://arxiv.org/abs/2406.12731)
- [SoftHand Model-W: Integrated Wrist and Carpal Tunnel](https://arxiv.org/abs/2604.00738)
- [ORCA: An Open-Source, Reliable, Cost-Effective, Anthropomorphic Robotic Hand](https://arxiv.org/abs/2504.04259)
- [CRAFT: A Tendon-Driven Hand with Hybrid Hard-Soft Compliance](https://arxiv.org/abs/2603.12120)
- [CATCH-919 Hand: Design of a 9-actuator 19-DOF Anthropomorphic Robotic Hand](https://arxiv.org/abs/1809.04290)
- [MM-Hand: A 21-DOF Multi-modal Modular Dexterous Robotic Hand with Remote Actuation](https://arxiv.org/abs/2604.17245)
- [CYJ Hand-0: 21-DOF Hand with Hybrid SMA-Motor Actuation](https://arxiv.org/abs/2507.14538)
- [DexHand 021: Bioinspired Tendon-Driven Hand with Proprioceptive Compliance Control](https://arxiv.org/abs/2511.03481)
- [Educational SoftHand-A: Building an Anthropomorphic Hand using LEGO MINDSTORMS](https://arxiv.org/abs/2510.15638)
- [A Soft Humanoid Hand with In-Finger Visual Perception (KIT)](https://arxiv.org/abs/2006.03537)

**로봇 손 — 학습·제어 ★**
- [Learning Dexterous In-Hand Manipulation](https://arxiv.org/abs/1808.00177) — OpenAI Dactyl 2018 ★
- [DeXtreme: Transfer of Agile In-hand Manipulation from Simulation to Reality](https://arxiv.org/abs/2210.13702)
- [In-Hand Object Rotation via Rapid Motor Adaptation](https://arxiv.org/abs/2210.04887)
- [Rotating without Seeing: Towards In-hand Dexterity through Touch](https://arxiv.org/abs/2303.10880)
- [AnyRotate: Gravity-Invariant In-Hand Object Rotation with Sim-to-Real Touch](https://arxiv.org/abs/2405.07391)
- [Visual Dexterity: In-Hand Reorientation of Novel and Complex Object Shapes](https://arxiv.org/abs/2211.11744)
- [Twisting Lids Off with Two Hands](https://arxiv.org/abs/2403.02338)
- [Text2Touch: Tactile In-Hand Manipulation with LLM-Designed Reward Functions](https://arxiv.org/abs/2509.07445)
- [Dextrous Tactile In-Hand Manipulation Using a Modular RL Architecture](https://arxiv.org/abs/2303.04705)
- [Tendon-based modelling, estimation and control for a simulated high-DoF anthropomorphic hand](https://arxiv.org/abs/2601.20682)
- [Aero Hand Open: A Simulation-Ready Tendon-Driven Hand](https://arxiv.org/abs/2608.28578) — 텐던 손의 시뮬레이션 난제

**설계 근거 (해부학)**
- [사람 손의 해부학·생체역학 노트](./human-hand-anatomy.md) — Santello 시너지, 활차, 신전건막, 엄지 CMC
