# 로봇 팔의 활용 — 논문 학습 노트

> 작성일: 2026-09-16
> 짝 문서: [로봇 팔·로봇 손 설계](./robot-arm-and-hand.md) — 하드웨어·구동·조작학습은 그쪽
> 이 문서는 **"그래서 어디에 어떻게 쓰이는가"** 와 **현장 성능의 실제 숫자**를 다룬다.

---

## 0. 한 줄 요약

**도메인마다 로봇 팔을 어렵게 만드는 요인이 완전히 다르다.**

| 도메인 | 진짜 병목 |
| :--- | :--- |
| 산업 제조 | 새 부품마다 재프로그래밍 (고혼합 소량생산) |
| 물류/창고 | 속도 (picks-per-hour) — 이미 규모로 돌아간다 |
| 수술 | **사람의 숙련**. 로봇은 도구, 근거는 논쟁 중 |
| 농업 | **가림(occlusion)과 개체 변이** — 성공률 30~80%에 머문다 |
| 보조 로봇 | **제어 인터페이스**. 팔이 아니라 사용자가 어떻게 지시하느냐 |
| 실험실 자동화 | **장기 계획(long-horizon)** — LLM 에이전트 실행 성공률 3.3% |
| 우주 | 자유부유 동역학 + 통신 지연 |
| 위험 환경 | 방사선 내성과 신뢰성. 아직 기계식 master-slave가 현역 |
| 건설 | 비정형 현장 + 공차 누적 |

그리고 **하나의 흐름이 이 전부를 관통한다**: Vision-Language-Action(VLA) 파운데이션 모델.
"작업마다 프로그래밍"에서 "한 정책을 여러 로봇·여러 작업에 파인튜닝"으로 넘어가는 중이다.

---

## 1. 협동로봇과 안전 규격 — 활용의 전제조건

사람 옆에서 로봇 팔을 쓰려면 규격을 먼저 알아야 한다.

| 규격 | 내용 |
| :--- | :--- |
| **ISO 10218-1 / -2** | 산업용 로봇 일반 안전. 설계(-1)와 통합(-2) |
| **ISO/TS 15066:2016** | 협동로봇 전용 기술사양. 10218을 보완 |

> **중요한 변경**: ISO/TS 15066은 **ISO 10218-2:2025에 통합**되었다.
> 이제 별도 TS가 아니라 본 규격의 일부다.

### 4가지 협동 운전 모드

| 모드 | 동작 | 사람과 로봇이 동시에 움직이나 |
| :--- | :--- | :--- |
| **1. 안전정격 감시정지** (Safety-rated monitored stop) | 작업자가 협동 작업공간에 들어오면 로봇 정지 | **아니오** (교대) |
| **2. 핸드 가이딩** (Hand guiding) | 작업자가 로봇을 직접 잡고 유도 | 예 (직접 접촉) |
| **3. 속도·분리 감시** (Speed and separation monitoring) | 최소 거리 유지. **접촉 자체를 회피**. 녹색=전속, 황색=감속, 적색=정지 | 예 |
| **4. 동력·힘 제한** (Power and force limiting) | 접촉을 허용하되 **상해 임계값 이하로 제한** | 예 |

**실무 함의**
- 대부분의 상용 협동로봇은 **4번(PFL)** 을 하드웨어에 내장하고 있다.
- 3번(SSM)과 4번(PFL)을 **조합**하는 것이 생산성과 안전을 동시에 잡는 방향이고, 활발한 연구 주제다
  (IEEE 및 arXiv:1908.03046이 통합 처리를 시도).
- PFL만 쓰면 속도가 크게 제한되어 생산성이 떨어진다. SSM으로 멀리 있을 때는 빠르게, 가까우면 PFL로 전환하는 식.
- 제어 장벽 함수(CBF)로 ISO 10218 준수를 제어기에 내장하려는 시도도 있다 (arXiv:2606.13203).

---

## 2. 산업 제조 — 빈 피킹(Bin Picking)이 대표 문제

**빈 피킹**: 통에 무작위로 쌓인 부품을 하나씩 집어내는 것. 산업 로봇의 가장 흔한 과제이자,
**"자동 부품 공급기(parts feeder)를 없앨 수 있는가"** 라는 경제적 질문과 직결된다.

### 2.1 왜 어려운가

1. **금속 부품의 3D 데이터가 희소하고 노이즈가 많다** — 반사, 녹, 무텍스처 (arXiv:2410.00706)
2. **엉킴(entanglement)** — 와이어 하네스처럼 긴 유연물은 서로 엉킨다 (arXiv:2306.14595, 2112.05941)
3. **연쇄 실패** — 파지가 실패해도 통 상태가 그대로면 **같은 파지를 무한 반복**한다.
   센서 입력이 동일하기 때문. MPPH가 급락한다 (arXiv:2007.10420)
4. **교착(deadlock)** — 미리 정의한 파지점이 가려지면 멈춘다 (arXiv:2608.28175)

### 2.2 접근법의 스펙트럼

| 방식 | 장점 | 단점 |
| :--- | :--- | :--- |
| **모델 기반** (6D 자세 추정) | 고정밀, 반복성 | 새 부품마다 파지점 튜닝 필요 |
| **모델 프리** (학습 기반 파지) | 처음 보는 물체도 "바로" | 생산에 요구되는 신뢰성·반복성 부족 |
| **하이브리드 + 온라인 자가학습** | 두 장점 결합 | 복잡도 증가 |

> **최근 방향**: **제로샷 6D 자세 추정**. DINOv2 같은 파운데이션 모델의 시맨틱 특징 + CAD 모델을 써서
> **부품별 파인튜닝과 데이터 라벨링을 없앤다** (arXiv:2607.16312 xperception).
> 고혼합 소량생산(high-mix low-volume)으로 가는 제조업의 요구와 정확히 맞물린다.

### 2.3 World Robot Summit 2018 조립 챌린지 — 현실 점검

"Level 5 자동화" = **하루 안에 자율 조립 시스템을 프로그래밍하고 셋업하기.**
빈 피킹, 키팅, 2D·3D 조립. 일부 과제는 대회 당일에야 공개.

→ **키팅(빈 피킹을 요구하는 과제)에서 가장 낮은 점수**가 나왔다 (arXiv:2309.16221).
빈 피킹이 산업 조립의 병목임을 대회가 실증한 셈.

주목할 해법: 팀 O2AS (arXiv:2003.02427)는 **전용 엔드이펙터도 툴체인저도 쓰지 않고**,
2지 그리퍼로 공구를 "쥐어서" 나사조임·흡착을 수행했다. 세 번째 그리퍼는 수동 컴플라이언스로 위치 오차를 흡수.

---

## 3. 물류·창고 — 이미 규모로 돌아가는 유일한 도메인

여기가 **연구와 현장의 간극이 가장 좁다.** 숫자가 그것을 보여준다.

| 시스템 | 실적 |
| :--- | :--- |
| **Dex-Net 4.0** (pmid:33137754) | 처음 보는 물체 25개까지의 통을 **신뢰도 95% 이상**, **시간당 300회 이상 평균 피킹(MPPH)**. 2종 그리퍼 양손잡이(ambidextrous) 정책 |
| **Amazon Robin** (arXiv:2309.13224) | **하루 최대 600만 개** 패키지 피킹·낱개분리, 누적 **20억 개 이상** 처리 |
| **Amazon Stow** (arXiv:2505.04572) | 대형 풀필먼트 센터에서 **50만 회 이상** 적재 수행. **사람 수준의 적재 밀도와 속도** 달성 |

**왜 물류만 되는가**
- 물체가 다양하지만 **환경은 구조화**되어 있다 (통, 선반, 컨베이어)
- 실패해도 **재시도가 싸다** — 물건을 떨어뜨려도 사람이 죽지 않는다
- **성공 지표가 명확**하다: MPPH. 최적화 목표가 분명하면 공학이 작동한다
- **데이터가 자동으로 쌓인다** — 하루 600만 회의 시행이 그대로 학습 데이터

**핵심 기법**
- **GOMP** (arXiv:2003.02401): 파지 후보 집합 위에서 최적화해 **동작을 빠르게** 만든다.
  Dex-Net이 여러 파지 후보를 주고, 각 파지는 그리퍼 회전 자유도를 가진다 → 이 여유를 모션 플래닝에 쓴다
- **픽 성공 예측 모델** (arXiv:2305.10272, 2506.09765): 휴리스틱으로 샘플링한 픽의 성공 확률을 학습해
  **높은 확률의 픽을 우선**한다. 나아가 픽 자체를 직접 최적화

---

## 4. 의료 — 수술 로봇, 근거는 아직 논쟁 중

### 4.1 COMPARE 메타분석 (PMC11974634) — 가장 큰 규모

**범위**: 230개 연구 (RCT 34, 전향적 74, 데이터베이스 122), 7개 종양 수술, 22개국
- da Vinci 1,194,559건 / 복강경·VATS 1,095,936건 / 개복 1,625,320건

**da Vinci vs 복강경/VATS**
| 지표 | 결과 |
| :--- | :--- |
| 개복 전환율 | **OR 0.44** (0.40–0.49) — 56% 감소 |
| 합병증 | OR 0.90 (0.84–0.96) — 10% 감소 |
| 재원기간 | **0.51일 단축** |
| 재입원 | OR 0.91 (0.83–0.99) |
| 사망률 | OR 0.86 (0.81–0.92) |
| 수술시간 | **17.73분 증가** ← 대가 |
| 출혈량 | 유의차 없음 (p=0.16) |

**da Vinci vs 개복**
| 지표 | 결과 |
| :--- | :--- |
| 합병증 | **OR 0.56** — 44% 감소 |
| 수혈 | **OR 0.25** — 75% 감소 |
| 출혈량 | **293.44 mL 감소** |
| 재원기간 | **1.85일 단축** |
| 사망률 | OR 0.54 (0.47–0.63) |
| 수술시간 | **40.92분 증가** |

### 4.2 하지만 — 반대 결론의 메타분석도 많다

> **이 분야는 근거가 엇갈린다. 한쪽만 인용하면 안 된다.**

- *"Limited Evidence for Robot-assisted Surgery"* (pmid:26766316) — RCT 기반, 제한적 근거
- *"The Evidence Behind Robot-Assisted Abdominopelvic Surgery: A Systematic Review"* (pmid:34181448) —
  복강경/개복 대비 이점이 있는지 **불확실**
- *"Clinical Outcomes of Robotic Surgery Compared to Conventional Approaches"* (pmid:32398482) —
  **임상 결과 개선을 뒷받침하는 근거가 제한적**
- 대장암 RCT 9건 2,758명 메타분석 (pmid:41020446) — 안전성·사망률·종양학적 결과 **동등**

**왜 엇갈리는가**
1. **연구 설계**: COMPARE는 데이터베이스 연구를 122개 포함했다. RCT만 보면 결론이 약해진다
2. **학습곡선**: 로봇 수술은 술자의 숙련도 의존이 크다. 초기 사례가 결과를 끌어내린다
3. **선택 편향**: 로봇을 쓰는 병원과 환자가 애초에 다르다
4. **비용**: 거의 모든 리뷰가 **비용과 수술시간 증가**를 일관되게 보고한다

> **정리**: 로봇 수술은 **개복 대비로는 명확한 이점**(출혈·합병증·재원)이 있고,
> **복강경 대비로는 논쟁적**이다. 전환율 감소는 비교적 일관된 신호.

---

## 5. 농업 — 성공률이 말해주는 현실

**가장 솔직한 도메인.** 논문이 성공률과 사이클 타임을 정직하게 보고한다.

| 작물 | 시스템 | 성공률 | 사이클 타임 |
| :--- | :--- | ---: | ---: |
| 파프리카 | Harvey, 초기 (arXiv:1706.02023) | **46%** (미개조) / 58% (개조) | — |
| 파프리카 | Harvey, 개선 (arXiv:1810.11920) | **76.5%** (개조 시나리오) | — |
| 파프리카 | 모방학습, 노지 (arXiv:2411.09929) | **28.95%** | 31.71초 |
| 토마토 | 하이브리드 그리퍼 (PMC13223203) | **~80%** | 24.34초 |
| 감귤 | flow-matching 정책 (PMC13314948) | **76%** | — |
| 사과 | YOLOv5-RACF (PMC11353041) | — | **9초/개** |
| 사과 | 양팔 과수원 (PMC12430792) | 병렬작업률 85.7~93.3% | 17.8~22.3초 |
| 키위 | (arXiv:2507.15484) | 캐노피 내 **80%+ 도달** (기존 SOTA <70%) | — |

**읽는 법**
- **통제된 온실에서는 되고, 노지에서는 안 된다.** 같은 파프리카인데 온실 76.5% vs 노지 28.95%.
- 사이클 타임 20~30초는 **사람보다 훨씬 느리다.** 그래서 **다중 팔**로 처리량을 올리려 한다
  (arXiv:2505.10028은 최대 12개 카티전 팔까지 검토, 팔을 늘릴수록 처리량 단조 증가)
- 실패 원인은 대부분 **가림(occlusion)**. 익은 열매가 덜 익은 열매에 가려 직접 파지가 불가능하다
  → **장애물 분리(obstacle separation)를 별도 스킬로 학습**시키는 접근이 나온다 (arXiv:2607.13799, 2607.14708)

**엔드이펙터가 절반이다**
- 블랙베리: 천 튜브를 비틀어 감싸는 그리퍼 (arXiv:2403.17099) — 균일 압력으로 손상 방지
- 딸기: 줄기를 홈에 유도해 **레이저로 절단** (arXiv:2507.20784). 188°C로 살균까지 하고, 절단면이 수분을 보존해 유통기한 증가
- 아보카도: 두꺼운 꼭지와 꽃받침 때문에 전용 설계 필요 (arXiv:2407.01809)

> **교훈**: 농업 수확 로봇은 **인식 문제가 아니라 접촉 문제**다. 열매를 찾는 건 이제 잘 된다(95%+).
> 가려진 것을 헤집고, 손상 없이 떼어내는 것이 안 된다.

---

## 6. 보조·재활 로봇 — 팔보다 인터페이스가 문제

**휠체어 장착 로봇 팔(WMRA)**: 사지마비·상지 장애인의 일상생활동작(ADL)을 지원한다.
상용 제품이 실제로 쓰인다 — **MANUS**(네덜란드에서 100명 이상 가정 사용, pmid:11436271), **JACO**.

### 6.1 진짜 병목은 제어 인터페이스

6 DOF 팔을 **손을 못 쓰는 사람이 어떻게 조종하는가**가 핵심이다. 시도된 방식들:

| 인터페이스 | 연구 |
| :--- | :--- |
| 턱·손가락 조이스틱 | PMC9354078 |
| **시선 추적(eye-gaze)** | PMC8684692 — 과제 성공률 100% 보고 |
| **혀 기반 제어** + 적응형 반자동화 | pmid:39078762 |
| sEMG (표면 근전도) 제스처 | PMC8433689 |
| **EEG/EOG 하이브리드 BCI** | PMC6882933 — 운동 상상으로 좌/우, 눈깜빡임·눈썹으로 명령 |
| **대화 기반(LLM)** | arXiv:2602.06243 — 5명 파일럿, 청소·음용·식사·서랍 열기 |
| 음성 제어 | PMC12973643 — 신경질환자 대상 사용성 평가 |

### 6.2 공유 자율(Shared Autonomy)이 답으로 수렴 중

사용자가 모든 관절을 조종하는 건 **너무 느리고 피곤하다.**
→ 사용자는 **무엇을**(어떤 물체) 지시하고, 로봇이 **어떻게**(파지 자세, 궤적)를 채운다.

- 레이저 포인터로 물체 선택 → 파지 검출로 처음 보는 물체도 집는다 (arXiv:1609.05253)
- 비전 유도 공유 제어 + 전동휠체어 사용자 평가 (PMC12349299)
- **제어 권한(control authority) 선호도** 연구 (PMC10996449) — 사용자가 얼마나 자율에 맡기고 싶어하는가

> 사용자 인터뷰에서 반복해서 나오는 문제: **"손목 방향과 위치를 구분하기 어렵다."** (PMC12349299)
> 기술이 아니라 **인지 부하**가 벽이다.

### 6.3 냉정한 평가도 있다

ANSO 연구 (pmid:24459695): 사용자와 간병인이 대체로 만족했지만,
**환자의 4분의 1만이 실제 일상생활에서 쓰겠다고 답했다.**

양손 과제 문제 (arXiv:2606.11151): 병뚜껑 열기, 액체 따르기, 쟁반 들기 등
**일상 과제의 상당수가 근본적으로 양손 작업**이라 단일 팔로는 불가능하다.
그런데 휠체어에 팔을 하나 더 다는 건 전력·비용·이승 공간 때문에 비현실적이다.

---

## 7. 실험실 자동화 — 자율주행 실험실(Self-Driving Lab)

로봇 팔이 **합성 → 특성분석 → 성능시험**을 돌리고, ML이 다음 실험을 결정하는 폐루프.

**대표 성과**
- 이동 로봇 화학자가 실험실을 돌아다니며 장비를 조작하고 **사람처럼 판단** (PMC11602721, *Nature*)
- AI-Chemist: **14개 워크스테이션**에서 합성·특성분석·성능시험 전 과정 자동 실행 (PMC9674120)
- 100억 조합이 넘는 반응 공간을 자율 탐색하는 화학 발견 로봇 (PMC7384156)
- RobInHood (PMC13202499): **표준 후드(50×120×170 cm) 안에** 들어가는 로봇 팔 플랫폼

### 7.1 LLM 에이전트 스트레스 테스트 — 냉혹한 숫자

**arXiv:2607.23045**, 45개 모듈 워크스테이션을 기계 판독 가능 스킬로 노출, **4,608회 시행**:

> - 전문가 평가 기준 **실행 가능한 워크플로를 만든 시행은 3.3%**
> - **최고 성능 시스템도 28.1%**
> - **30개 오퍼레이션을 넘는 실행 가능 워크플로는 단 3개**

→ **장기 계획(long-horizon planning)이 여전히 미해결**임을 물리 세계 테스트베드가 증명했다.
LLM이 계획을 "그럴듯하게" 쓰는 것과 로봇이 실행 가능한 계획을 쓰는 것은 다른 문제다.

### 7.2 안전과 이상 감지가 별도 과제

- 뚜껑이 제대로 안 닫힌 바이알 하나가 전체 워크플로를 망친다 → **워크플로 인식(workflow awareness)** 필요.
  다만 기존 인식 모듈은 **오탐(false positive)이 과다**해서 불필요하게 멈춘다 (arXiv:2510.21438 PREVENT)
- 위험 화학물질 취급용 슬라이딩 모드 제어 (arXiv:2602.06977)
- 사람 화학자와 로봇 화학자가 **같은 장비를 공유**하는 상황의 조율 (arXiv:2603.08420)

---

## 8. 우주 — 궤도상 서비싱(On-Orbit Servicing)

**지상 로봇과 근본적으로 다른 점 3가지**

1. **자유부유(free-floating) 동역학** — 팔을 움직이면 **본체가 반작용으로 움직인다.**
   비홀로노믹 제약이 걸리고, 팔과 우주선 자세가 강하게 결합된다
2. **통신 지연** — 지상 원격조작이 어렵다. 자율성이 필수 (PMC9009532)
3. **비협조 목표(non-cooperative target)** — 텀블링하는 위성/잔해를 잡아야 한다

**주요 과제**
- **포획 + 디텀블(detumble)**: 회전하는 목표를 잡고 정지시키기.
  흥미로운 접근: 서비싱 위성의 **반작용 휠로 목표의 회전을 따라 돌면서** 관절을 잠가 상대 정지 상태를 만든다 (arXiv:2402.01959)
- **시각 서보잉(visual servoing)**: OOS의 핵심 기술. 부분/완전 시각 실패 시에도 제어 행동을 선택 (arXiv:2409.05295)
- **지상 검증 설비**: 에어베어링 플랫폼, 선형 가이드레일 테스트베드로 궤도 접촉 동역학을 모사
  (arXiv:2203.01403, 2510.13005, 2209.15406)

**실제 임무**
- 중국 Shiyan-7 (2013): 첫 우주 로봇으로 협조 목표 포획 성공 (PMC10089578)
- ESA e.deorbit: ENVISAT 포획·안정화·제어 재진입 개념 설계 (PMC7805711)
- DLR SpaceDREAM: 임피던스 제어 로봇 팔의 LEO 검증 임무 (arXiv:2409.17562)
- ReCoBot (arXiv:2203.10217): **위성 표면을 걸어다니는** 7축 매니퓰레이터

---

## 9. 위험 환경 — 원자력, 가속기

### 9.1 아직 기계식 master-slave가 현역이다

> "복잡한 원격 취급 요구에도 불구하고, **단순한 기계식 링크 master-slave 매니퓰레이터가 여전히 이 분야를 지배한다.**"
> (pmid:31034421)

핫셀에서 과학자는 지금도 **밖에서 레버를 움직이면 안의 그리퍼가 기계적으로 따라오는** 방식으로 작업한다.

**왜 안 바뀌는가**
- **방사선 내성**. 현대 전자장비가 방사선에서 버티는지 검증이 필요하다.
  10 Gy/h 조사 환경에서 로봇 팔 동작을 실증한 연구가 있다 (PMC7805772)
- **신뢰성**. 고장 나면 사람이 들어가서 고칠 수 없다
- 상용 원격조작 솔루션(COTS)은 "유연하지만 불충분"하다는 평가 (PMC9732017, 글로브박스 작업 과제 성능 평가)

### 9.2 진행 중인 개선

- **양팔 텔레로봇 플랫폼**: 핫셀 핵폐기물 처리용 (arXiv:2411.13994)
- **증강현실 원격조작**: 핫박스 내 양팔 조작 (arXiv:2303.16055)
- **햅틱 공유제어**: 다중 목표 파지 유도 (pmid:31034421)
- **조작자 의도 예측**: 힘 데이터로부터 의도를 읽어 반자율화 → **인지 부하 감소** (arXiv:2402.10220)
- **접촉 명시적 모션 플래닝**: 글로브박스 해체는 좁은 공간에서 무거운 물체를 다루므로 **접촉이 불가피**하다.
  접촉 계획을 미리 지정하지 않고 선형 상보성 제약으로 접촉을 모델링 (arXiv:1807.04198)
- CERN 가속기 단지의 케이블·커넥터 취급 사례 연구 (PMC9963582)

---

## 10. 건설 — 비정형 현장과 공차 누적

**문제의 성격**
- 현장이 계속 변한다. 설계(as-designed)와 시공(as-built)이 다르다 (arXiv:2306.09639)
- **공차 누적(tolerance accumulation)** — 벽돌 한 장의 오차가 쌓인다
- 작업이 **준반복적(quasi-repetitive)** 이다. 완전 반복도 아니고 완전 비정형도 아니라서
  한 도메인에서 배운 스킬이 다른 도메인으로 전이되지 않는다 (arXiv:2509.02876)

**접근**
- **In situ Fabricator** (arXiv:1701.03573): 현장 이동형 로봇. 실물 크기 곡면 벽돌벽, Mesh Mould 콘크리트 공정
- **CONCERT** (arXiv:2504.04998): **모듈을 갈아끼워 운동학 구조 자체를 바꾸는** 재구성 가능 협동로봇
- **모듈형 로봇 + 자동 형태 선택** (arXiv:2412.20867): 과제마다 최적 로봇 형태를 자동 탐색
- **철근 결속(rebar tying)**: 반복적이고 인체공학적 위험이 큰 작업. 학습 없는 3D 프레임워크(arXiv:2509.00064),
  SE(3) 등변 확산 모델(arXiv:2509.00065)
- **적응형 인간-로봇 협업** (arXiv:2605.20264): 엔드이펙터에 프로젝터를 달아 **작업 위치를 바닥에 투영**해 지시.
  로봇이 벽돌을 놓고 사람이 접착제를 바른다
- **HEAP** (arXiv:2106.05059): 시판 보행 굴착기를 자율 로봇으로 개조

---

## 11. 관통하는 흐름 — VLA 파운데이션 모델

모든 도메인이 공유하는 문제가 있다: **작업마다 프로그래밍하는 비용.**
2023년 이후 그 답으로 제시된 것이 VLA다.

### 11.1 Open X-Embodiment (arXiv:2310.08864) — 데이터 연합

| 항목 | 규모 |
| :--- | :--- |
| 로봇 형태(embodiment) | **22종** (단일 팔 ~ 양팔 ~ 4족) |
| 참여 기관 | 21개 |
| 원본 데이터셋 | 34개 연구실의 60개 데이터셋 통합 |
| 궤적 | **100만+** |
| 스킬 | **527종** (16만 태스크) |

**결과**
- **RT-1-X**: 단일 로봇 베이스라인 대비 평균 성공률 **약 50% 향상**
- **RT-2-X**: 새 과제의 emergent skill 성공률 **3배**
- → **양의 전이(positive transfer)**. 다른 플랫폼의 경험이 내 로봇을 개선한다

### 11.2 OpenVLA (arXiv:2406.09246) — 오픈소스 전환점

| 항목 | 내용 |
| :--- | :--- |
| 크기 | **7B** 파라미터 |
| 구성 | Llama 2 + **SigLIP + DinoV2** 이중 비전 인코더 (Prismatic VLM) |
| 학습 데이터 | Open-X Embodiment **97만 궤적** |
| 성능 | **55B RT-2-X 대비 29개 과제에서 절대 성공률 +16.5%p** — 크기는 **8배 작다** |
| 학습 비용 | A100 64장 × 14일 = **21,500 A100-hours**, 배치 2048, **27 에폭**, lr 2e-5 고정 |
| 추론 | bf16에서 **15 GB**, RTX 4090에서 **~6 Hz** |
| 파인튜닝 | **LoRA + 양자화로 소비자용 GPU에서** 가능 (성능 손실 없음) |

**저자들이 발견한 반직관적 사실 3가지**
1. **비전 인코더를 freeze하면 안 된다.** VLM에서는 freeze가 유리하다는 통념이 있는데,
   VLA에서는 **파인튜닝이 필수**였다. 사전학습 비전 백본이 정밀 제어에 필요한 세밀한 공간 정보를 못 담기 때문.
2. **해상도를 올려도 소용없다.** 224px vs 384px 성능 차이 없음. 384px는 학습이 **3배 느리다**.
3. **에폭을 많이 돌려야 한다.** LLM/VLM은 1~2 에폭인데, VLA는 **27 에폭**까지 돌려야 실기 성능이 계속 올랐다
   (행동 토큰 정확도 95% 초과까지).

**한계**: 일반 정책은 **좁은 단일 명령 과제에서는 Diffusion Policy에 밀린다.**
여러 물체가 있고 **언어 근거(language grounding)가 필요한 다양한 과제**에서 앞선다.

### 11.3 각 도메인으로의 침투

| 도메인 | VLA 적용 |
| :--- | :--- |
| 농업 | **HarvestFlex** (arXiv:2603.05982) — 온실 딸기 수확에 π₀/π₀.5/WALL-OSS 파인튜닝. VR 원격조작 3.71시간(227 에피소드) |
| 화학 실험 | **RoboChemist** (arXiv:2509.08820) — VLM + VLA 이중 루프, 실험 규범 준수 |
| 건설 | **TARCAT** (arXiv:2608.25395) — O*NET 91개 작업 기반 41개 행동 프리미티브 분류 |
| 소프트 로봇 | arXiv:2510.17369 — 연속체 매니퓰레이터에 VLA 배포 |

### 11.4 냉정한 벤치마킹

**arXiv:2511.11298** — ACT, OpenVLA-OFT, RDT-1B, π₀ 4종을 ALOHA Mobile에서 실제 비교.
> 체계적인 실세계 평가와 모델 간 비교는 **여전히 드물다.**

**arXiv:2411.05821** — GPT-4o, OpenVLA, JAT를 Open-X 20개 데이터셋에서 평가.

→ **VLA는 유망하지만, 도메인별 실배치 근거는 아직 얇다.** 논문의 성공률을 현장 수치로 읽으면 안 된다.

---

## 12. 도메인 비교 — 무엇이 각각을 어렵게 만드는가

| 도메인 | 환경 구조화 | 실패 비용 | 사이클 타임 요구 | 현재 성숙도 |
| :--- | :--- | :--- | :--- | :--- |
| 물류/창고 | **높음** | 낮음 | **매우 빠름** (MPPH) | **실배치 대규모** |
| 산업 조립 | 높음 | 중간 | 빠름 | 부분 실배치 (셋업 비용이 병목) |
| 수술 | 중간 | **매우 높음** | 느려도 됨 | 실배치 (단 사람이 조종) |
| 실험실 자동화 | 높음 | 중간(시약 손실) | 느려도 됨 | 초기 (장기 계획 미해결) |
| 보조 로봇 | 낮음 (가정) | 중간 | 느려도 됨 | 상용 제품 존재, 채택률 낮음 |
| 농업 | **매우 낮음** | 낮음 | 빨라야 함 | 연구 단계 (노지 30%대) |
| 건설 | **매우 낮음** | 높음 | 중간 | 연구 단계 |
| 우주 | 낮음 | **극히 높음** | 느려도 됨 | 소수 임무 실증 |
| 원자력 | 중간 | **극히 높음** | 느려도 됨 | 기계식이 현역 |

**읽는 법**: **환경 구조화 정도와 실패 비용이 성숙도를 거의 결정한다.**
구조화되어 있고 실패가 싸면(물류) 이미 돌아간다. 비구조적이면(농업·건설) 연구 단계다.
실패 비용이 극히 높으면(우주·원자력) 자율화가 늦고 사람이 개입한다.

---

## 13. 교훈 정리

1. **"로봇 팔로 뭘 할 수 있나"는 팔의 문제가 아니다.**
   대부분의 도메인에서 병목은 팔의 자유도나 정밀도가 아니라 **인식, 계획, 인터페이스, 셋업 비용**이다.

2. **성공률 숫자를 볼 때는 조건을 봐라.**
   같은 파프리카 수확이 온실 76.5%, 노지 28.95%다. "개조 시나리오(modified crop)"라는 단서가 붙으면
   작물 배치를 로봇에 맞게 바꿨다는 뜻이다.

3. **사이클 타임이 성공률만큼 중요하다.** 농업 수확 20~30초는 성공해도 경제성이 없다.
   그래서 다중 팔·다중 로봇 스케줄링 연구가 따라붙는다.

4. **재시도 비용이 도메인의 성격을 결정한다.**
   물류는 실패해도 다시 집으면 되지만, 수술과 우주는 한 번의 실패가 끝이다.
   → 자율화 수준이 재시도 비용에 반비례한다.

5. **안전 규격을 모르면 사람 옆에 못 놓는다.** ISO 10218 / TS 15066의 4가지 협동 모드가
   설계 요구사항을 직접 규정한다. TS 15066은 이제 ISO 10218-2:2025에 통합됐다.

6. **VLA는 방향이지 답이 아직 아니다.** Open X-Embodiment의 양의 전이는 실제 결과지만,
   도메인별 실배치 벤치마킹은 "여전히 드물다"는 것이 2025~2026년 논문들의 평가다.

7. **오래된 기술이 버티는 데는 이유가 있다.** 원자력 핫셀의 기계식 master-slave가 아직 현역인 것은
   기술 낙후가 아니라 **방사선 내성과 신뢰성** 때문이다.

---

## 14. 정확도 메모

- **4장 COMPARE 메타분석 수치**(OR, 일수, mL, 연구 수, 환자 수)는 논문 본문에서 직접 확인했다.
  다만 **같은 주제의 다른 메타분석들은 반대 결론**을 낸다. 4.2절에 그 목록을 적어뒀다.
  **한쪽만 인용하면 왜곡이다.**
- **5장 농업 성공률**은 각 논문의 초록 또는 본문에 명시된 값이다. 단 **시험 조건(온실/노지, 개조/미개조,
  작물 품종)이 제각각이라 직접 비교할 수 없다.** 표는 범위를 보여주기 위한 것이지 순위표가 아니다.
- **11.2 OpenVLA의 학습 비용·하이퍼파라미터·반직관적 발견 3가지**는 논문 본문을 직접 읽고 기록했다.
- **3장 물류 수치**(Dex-Net 300 MPPH, Amazon 600만/일, 20억 누적, 50만 stow)는 각 논문의 저자 보고값이다.
  기업 자체 보고이므로 독립 검증된 수치는 아니다.
- **7.1 LLM 에이전트 3.3%** 수치는 arXiv:2607.23045의 결과이며, 초록 수준에서 확인했다. 본문 미확인.
- 1장의 **ISO/TS 15066 → ISO 10218-2:2025 통합**은 복수의 2차 출처에서 확인했으나
  **ISO 원문은 확인하지 않았다.** 규격을 실제로 적용할 때는 원문을 구매해 확인해야 한다.
- 8~10장(우주·원자력·건설)은 대부분 **초록 수준**에서만 확인했다. 인용 전 본문 재확인 필요.

---

## 15. 참고 문헌

**안전 규격**
- [ISO/TS 15066:2016 — Robots and robotic devices: Collaborative robots](https://www.iso.org/standard/62996.html)
- [Robotics Standards — OSHA](https://www.osha.gov/robotics/standards)
- [Safe physical HRI: Toward a unified treatment of speed and separation monitoring together with power and force limiting](https://arxiv.org/abs/1908.03046)
- [Embedding ISO 10218 Safety Compliance in Robots via Control Barrier Functions](https://arxiv.org/abs/2606.13203)
- [Safe Physical Human-Robot Interaction through Variable Impedance Control based on ISO/TS 15066](https://arxiv.org/abs/2311.13814)

**산업 제조 / 빈 피킹**
- [Robots Assembling Machines: Learning from the World Robot Summit 2018 Assembly Challenge](https://arxiv.org/abs/1911.05884)
- [Team O2AS at the World Robot Summit 2018](https://arxiv.org/abs/2003.02427)
- [xperception — Making Robotic Grasping Easier](https://arxiv.org/abs/2607.16312) — 제로샷 6D 자세
- [Picking Bins Empty: A Hierarchical Hybrid Approach with Online Self-Learning](https://arxiv.org/abs/2608.28175)
- [A Closed-Loop Bin Picking System for Entangled Wire Harnesses](https://arxiv.org/abs/2306.14595)
- [Non-Markov Policies to Reduce Sequential Failures in Robot Bin Picking](https://arxiv.org/abs/2007.10420)

**물류·창고**
- [Learning ambidextrous robot grasping policies (Dex-Net 4.0)](https://pubmed.ncbi.nlm.nih.gov/33137754/) — *Science Robotics*
- [GOMP: Grasp-Optimized Motion Planning for Bin Picking](https://arxiv.org/abs/2003.02401)
- [Demonstrating Large-Scale Package Manipulation via Learned Metrics of Pick Success](https://arxiv.org/abs/2305.10272) — Amazon Robin
- [Pick Planning Strategies for Large-Scale Package Manipulation](https://arxiv.org/abs/2309.13224)
- [Stow: Robotic Packing of Items into Fabric Pods](https://arxiv.org/abs/2505.04572)
- [Learning to Optimize Package Picking for Large-Scale, Real-World Robot Induction](https://arxiv.org/abs/2506.09765)

**수술 로봇 (양쪽 근거 모두)**
- [The COMPARE Study: da Vinci vs Laparoscopic vs Open Oncologic Procedures](https://pmc.ncbi.nlm.nih.gov/articles/PMC11974634/) — 230개 연구 메타분석
- [Limited Evidence for Robot-assisted Surgery: A Systematic Review and Meta-Analysis of RCTs](https://pubmed.ncbi.nlm.nih.gov/26766316/) ← 반대 결론
- [The Evidence Behind Robot-Assisted Abdominopelvic Surgery: A Systematic Review](https://pubmed.ncbi.nlm.nih.gov/34181448/) ← 반대 결론
- [Clinical Outcomes of Robotic Surgery Compared to Conventional Surgical Approaches](https://pubmed.ncbi.nlm.nih.gov/32398482/) ← 반대 결론
- [Redefining Precision: RCTs Comparing Robotic-Assisted vs Laparoscopic Surgery in Colorectal Cancer](https://pubmed.ncbi.nlm.nih.gov/41020446/)

**농업**
- [A Sweet Pepper Harvesting Robot for Protected Cropping Environments (Harvey)](https://arxiv.org/abs/1810.11920)
- [Lessons Learnt from Field Trials of a Robotic Sweet Pepper Harvester](https://arxiv.org/abs/1706.06203)
- [Autonomous Robotic Pepper Harvesting: Imitation Learning in Unstructured Agricultural Environments](https://arxiv.org/abs/2411.09929)
- [Advancement and Field Evaluation of a Dual-arm Apple Harvesting Robot](https://arxiv.org/abs/2506.05714)
- [Robots for Kiwifruit Harvesting and Pollination](https://arxiv.org/abs/2507.15484)
- [Fast Heuristic Scheduling and Trajectory Planning for Robotic Fruit Harvesters with Multiple Cartesian Arms](https://arxiv.org/abs/2505.10028)
- [A Strawberry Harvesting Tool with Minimal Footprint](https://arxiv.org/abs/2507.20784) — 레이저 절단
- [Berry Twist: a Twisting-Tube Soft Robotic Gripper for Blackberry Harvesting](https://arxiv.org/abs/2403.17099)
- [HarvestFlex: Strawberry Harvesting via VLA Policy Adaptation in the Wild](https://arxiv.org/abs/2603.05982)

**보조 로봇**
- [Wheelchair-mounted robotic arms: a systematic review of technical design and ADL outcomes](https://pubmed.ncbi.nlm.nih.gov/40853288/)
- [MANUS — a wheelchair-mounted rehabilitation robot](https://pubmed.ncbi.nlm.nih.gov/11436271/)
- [Evaluation of the JACO robotic arm: clinico-economic study](https://pubmed.ncbi.nlm.nih.gov/22275600/)
- [Eye-gaze control of a wheelchair mounted 6DOF assistive robot for ADL](https://pmc.ncbi.nlm.nih.gov/articles/PMC8684692/)
- [Evaluation of a Vision-Guided Shared-Control Robotic Arm System with Power Wheelchair Users](https://pmc.ncbi.nlm.nih.gov/articles/PMC12349299/)
- [Exploring Control Authority Preferences in Robotic Arm Assistance for Power Wheelchair Users](https://pmc.ncbi.nlm.nih.gov/articles/PMC10996449/)
- [JOIN: Bimanual Assistive Manipulation](https://arxiv.org/abs/2606.11151) — 양손 과제 문제

**실험실 자동화**
- [Autonomous mobile robots for exploratory synthetic chemistry](https://pmc.ncbi.nlm.nih.gov/articles/PMC11602721/) — *Nature*
- [Stress-testing large language model agents in a robotic chemistry laboratory](https://arxiv.org/abs/2607.23045) — 3.3% 실행 가능
- [An all-round AI-Chemist with a scientific mind](https://pmc.ncbi.nlm.nih.gov/articles/PMC9674120/)
- [ORGANA: A Robotic Assistant for Automated Chemistry Experimentation](https://arxiv.org/abs/2401.06949)
- [PREVENT: Proactive Risk Evaluation and Vigilant Execution for Mobile Robotic Chemists](https://arxiv.org/abs/2510.21438)
- [RoboChemist: Long-Horizon and Safety-Compliant Robotic Chemical Experimentation](https://arxiv.org/abs/2509.08820)

**우주**
- [Robotic Manipulation and Capture in Space: A Survey](https://pmc.ncbi.nlm.nih.gov/articles/PMC8326842/)
- [A comprehensive survey of space robotic manipulators for on-orbit servicing](https://pmc.ncbi.nlm.nih.gov/articles/PMC11496037/)
- [Visual Servoing for Robotic On-Orbit Servicing: A Survey](https://arxiv.org/abs/2409.02324)
- [Seamless Capture and Stabilization of Spinning Satellites By Space Robots with Spinning Base](https://arxiv.org/abs/2402.01959)
- [Design and Operational Elements of the Robotic Subsystem for the e.deorbit Debris Removal Mission](https://pmc.ncbi.nlm.nih.gov/articles/PMC7805711/)
- [Software for the SpaceDREAM Robotic Arm](https://arxiv.org/abs/2409.17562)

**위험 환경**
- [From traditional robotic deployments towards assisted robotic deployments in nuclear decommissioning](https://pmc.ncbi.nlm.nih.gov/articles/PMC11893983/)
- [A Haptic Shared-Control Architecture for Guided Multi-Target Robotic Grasping](https://pubmed.ncbi.nlm.nih.gov/31034421/)
- [Radiation Tolerance Testing Methodology of Robotic Manipulator Prior to Nuclear Waste Handling](https://pmc.ncbi.nlm.nih.gov/articles/PMC7805772/)
- [Assessing tele-manipulation systems using task performance for glovebox operations](https://pmc.ncbi.nlm.nih.gov/articles/PMC9732017/)
- [Using Contact to Increase Robot Performance for Glovebox D&D Tasks](https://arxiv.org/abs/1807.04198)
- [Manipulation Tasks in Hazardous Environments Using a Teleoperated Robot: A Case Study at CERN](https://pmc.ncbi.nlm.nih.gov/articles/PMC9963582/)

**건설**
- [Mobile Robotic Fabrication at 1:1 scale: the In situ Fabricator](https://arxiv.org/abs/1701.03573)
- [CONCERT: a Modular Reconfigurable Robot for Construction](https://arxiv.org/abs/2504.04998)
- [Holistic Construction Automation with Modular Robots](https://arxiv.org/abs/2412.20867)
- [Adaptive Human-Robot Collaboration for Masonry Construction Under Material and Assembly Uncertainty](https://arxiv.org/abs/2605.20264)
- [HEAP — The autonomous walking excavator](https://arxiv.org/abs/2106.05059)
- [A Taxonomy of Construction Task Activities for Robot Workers (TARCAT)](https://arxiv.org/abs/2608.25395)

**VLA / 파운데이션 모델 ★**
- [Open X-Embodiment: Robotic Learning Datasets and RT-X Models](https://arxiv.org/abs/2310.08864) ★
- [OpenVLA: An Open-Source Vision-Language-Action Model](https://arxiv.org/abs/2406.09246) ★
- [RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818)
- [Fine-Tuning Vision-Language-Action Models: Optimizing Speed and Success](https://arxiv.org/abs/2502.19645)
- [Experiences from Benchmarking Vision-Language-Action Models for Robotic Manipulation](https://arxiv.org/abs/2511.11298) ← 냉정한 평가
- [Benchmarking Vision, Language, & Action Models on Robotic Learning Tasks](https://arxiv.org/abs/2411.05821)
