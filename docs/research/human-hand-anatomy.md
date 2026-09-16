# 사람 손의 해부학·생체역학 — 논문 학습 노트

> 작성일: 2026-09-16
> 목적: 로봇 손 설계의 기준점이 되는 인체 손의 구조·구동·제어 원리를 정리한다.
> 짝 문서: [로봇 팔·로봇 손](./robot-arm-and-hand.md)

---

## 0. 한 줄 요약

사람 손은 **27개 뼈**를 **약 24~27 자유도**로 움직이는데, 근육의 대부분은 **손이 아니라 전완에 있고**
**긴 힘줄(tendon)로 원격 구동**된다. 그리고 뇌는 이 많은 자유도를 개별 제어하지 않고
**소수의 시너지(synergy) 조합**으로 다룬다 — 주성분 2개가 파지 자세 분산의 **80% 이상**을 설명한다.

**이 세 가지가 로봇 손 설계의 핵심 근거다.**
1. 모터를 손 안이 아니라 전완에 두고 텐던으로 당긴다 → 손끝 관성 감소
2. 활차(pulley)로 선형 힘을 관절 토크로 변환한다
3. 자유도 수만큼 액추에이터를 달 필요가 없다 → 언더액추에이션(underactuation)

---

## 1. 골격 구조

### 1.1 뼈 27개

| 구분 | 개수 | 내용 |
| :--- | ---: | :--- |
| 수근골 (carpals) | **8** | 주상골, 월상골, 삼각골, 두상골 / 대능형골, 소능형골, 유두골, 유구골 (2열 4개씩) |
| 중수골 (metacarpals) | **5** | 손바닥 뼈 |
| 지골 (phalanges) | **14** | 엄지 2개(기절·말절), 나머지 4손가락 3개씩(기절·중절·말절) |

### 1.2 관절과 자유도

| 관절 | 위치 | 자유도 | 비고 |
| :--- | :--- | ---: | :--- |
| **DIP** (원위지절) | 말절-중절 | 1 (굴곡/신전) | 엄지에는 없음 |
| **PIP** (근위지절) | 중절-기절 | 1 (굴곡/신전) | |
| **MCP** (중수지절) | 기절-중수골 | **2** (굴곡/신전 + 내전/외전) | 과상관절(condyloid) |
| **IP** (엄지 지절) | 엄지 말절-기절 | 1 | |
| **CMC** (수근중수) | 중수골-수근골 | 엄지 **2+**, 4·5지 약간 | 2~5지 CMC는 거의 고정 |
| 손목 | 요골-수근골 | 2 (굴곡/신전 + 요측/척측 편위) | |

**총 자유도**: 문헌에 따라 **21 / 22 / 24 / 27**로 달라진다.
- 손가락 관절만: 2~5지 (1+1+2) × 4 = 16, 엄지 (IP 1 + MCP 2 + CMC 2) = 5 → **21**
- 손목 2 포함 → **23**
- 손바닥 아치(4·5지 CMC) 포함 → **24~27**

> **주의**: 논문마다 이 숫자가 다르다. 비교할 때는 **무엇을 셌는지** 반드시 확인해야 한다.
> (예: RUKA 논문은 사람 손을 22 DOF로 표기, 다른 문헌은 24 DOF로 센다.)

### 1.3 엄지 CMC — 가장 중요하고 가장 어려운 관절

엄지 수근중수관절(trapeziometacarpal)은 **안장관절(saddle joint)**이다.

- 대능형골(trapezium)과 제1중수골 사이의 **양면 볼록-오목(biconcavoconvex)** 안장 형태
- **두 축이 서로 직교하지 않고 어긋나 있다(offset axes)**
- → **2개 축의 제어만으로 3개 평면의 운동**을 만들어낸다
- 수동 생체역학 실험(pmid:38703515, 2024)은 이 관절이 실제로 **6자유도**의 회전·병진을 허용함을 보였다

**대립운동(opposition)은 단일 운동이 아니다.** 굴곡/신전 + 외전/내전 + **축회전(internal/external rotation)** + 병진이
결합된 복합 운동이다. 기존 연구가 4개 직교 방향 가동범위(ROM)만 측정해온 것이 한계로 지적된다.

> **로봇 설계 함의**: 엄지 CMC를 2축 직교 조인트로 근사하면 **대립이 부자연스러워진다.**
> 대부분의 로봇 손이 엄지에서 사람과 가장 크게 벌어지는 지점.

### 1.4 손의 아치

손바닥은 평평하지 않다. 물체를 감싸는 **3차원 곡면**을 만든다.
- **횡 아치(transverse arch)**: 중수골 머리들이 이루는 가로 아치
- **종 아치(longitudinal arch)**: 손목→손끝 세로 아치
- 4·5지 CMC의 약간의 가동성이 손바닥을 **오므리는(cupping)** 동작을 만든다

→ 로봇 손이 손바닥을 완전 강체로 만들면 큰 물체 파지가 나빠진다.
(SoftHand Model-W, RIM Hand 등이 손바닥 변형을 재현하려 시도)

---

## 2. 근육 — 외재근과 내재근

총 **약 30개 근육**이 손을 움직인다. 결정적 구분:

### 2.1 외재근 (Extrinsic) — 전완에 있고 긴 힘줄로 원격 구동

| 근육 | 작용 |
| :--- | :--- |
| **FDP** (심수지굴근, flexor digitorum profundus) | 말절골에 부착 → **DIP 굴곡** (PIP·MCP도 함께) |
| **FDS** (천수지굴근, flexor digitorum superficialis) | 중절골에 부착 → **PIP 굴곡** |
| **FPL** (장무지굴근) | 엄지 IP 굴곡 |
| **EDC** (총지신근) | 손가락 신전 |
| **EIP / EDM** | 검지·소지 독립 신전 |
| **EPL / EPB / APL** | 엄지 신전·외전 |

**핵심 특징**: 이 근육들은 **다관절(multiarticular)**이다. 하나의 힘줄이 여러 관절을 가로지른다.
→ 관절들이 **기계적으로 결합(coupled)**되어 있다. 완전한 독립 제어가 원천적으로 불가능하다.

> 이것이 **언더액추에이션의 생물학적 근거**다. 사람도 DIP와 PIP를 독립적으로 움직이지 못한다.
> RUKA 하드웨어가 PIP/DIP를 하나의 텐던으로 묶는 것이 정확히 이 구조를 모사한 것.

### 2.2 내재근 (Intrinsic) — 손 안에 완전히 들어 있음

**무지구 (Thenar, 엄지)** — 정중신경(median) 회귀분지
| 근육 | 기시 | 정지 | 작용 |
| :--- | :--- | :--- | :--- |
| 단무지외전근 (APB) | 굴근지대, 주상골 결절 | 기절골 외측 | 엄지 외전 |
| 단무지굴근 (FPB) | 굴근지대, 대능형골 결절 | 기절골 외측 | 엄지 굴곡 |
| 무지대립근 (OPP) | 굴근지대, 대능형골 | 제1중수골 외측연 | **엄지 대립** |

**무지내전근 (Adductor Pollicis)** — 해부학적으로 무지구와 별개. 척골신경 심부분지.
기시: 제2·3중수골 + 유두골 / 정지: 기절골 내측 / 작용: 엄지 내전

**소지구 (Hypothenar, 새끼손가락)** — 척골신경 심부분지
소지외전근(ADM, 두상골 기시), 단소지굴근(FDMB), 소지대립근(ODM)

**골간근 (Interossei)** — 척골신경 심부분지
- **배측 골간근 4개** — **외전(DAB: Dorsal ABduct)**. 인접 중수골에서 기시, 신전건막+기절골에 정지
- **장측 골간근 3개** — **내전(PAD: Palmar ADduct)**. 중수골 장측면에서 기시

**충양근 (Lumbricals) 4개** — 가장 특이한 근육
- **기시: FDP 힘줄** (뼈가 아니라 다른 근육의 힘줄에서 시작한다)
- **정지: 2~5지 신전건막(extensor hood)**
- **작용: MCP 굴곡 + PIP/DIP 신전을 동시에** (역설적 작용)
- 신경: 1·2번은 정중신경, 3·4번은 척골신경

### 2.3 신경 지배 요약

| 신경 | 지배 근육 |
| :--- | :--- |
| **정중신경 (Median)** | 무지구 3개, 충양근 1·2 |
| **척골신경 (Ulnar)** | 무지내전근, 소지구 3개, 골간근 전부, 충양근 3·4 |
| **요골신경 (Radial)** | 신근 전부 (전완) |

→ 척골신경이 **정밀 조작(내재근)의 대부분**을 담당한다. 척골신경 마비 시 갈퀴손(claw hand) 변형이 나오는 이유.

---

## 3. 신전 기구 (Extensor Mechanism / Extensor Hood)

손 생체역학에서 **가장 정교하고, 로봇이 가장 못 따라하는 부분.**

- 손가락 등쪽을 덮는 **건막 그물망(aponeurosis)** 구조
- EDC(외재 신근), 충양근, 골간근이 **모두 여기로 수렴**한다
- 중앙대(central slip)는 중절골에, 측대(lateral bands)는 말절골에 부착

**왜 중요한가**: 이 구조 때문에 충양근/골간근이
**MCP는 굽히면서 동시에 PIP·DIP는 펴는** 역설적 동작을 만들 수 있다.

→ 이것이 **정밀 파지(precision grip)의 핵심 자세**다. 손가락을 갈고리처럼 굽히는 게 아니라
MCP에서 꺾고 손가락 끝마디는 곧게 펴서 지문면으로 접촉한다.

> **로봇 설계 함의**: 단순 굴곡 텐던 + 복원 스프링 구조로는 이 자세가 안 나온다.
> CATCH-919 Hand(arXiv:1809.04290)가 MCP 신전 기전을 새롭게 해석해 IP/MCP 독립 운동을 구현하려 한 이유가 이것.
> CYJ Hand-0은 SMA로 신전·외전을, 모터로 굴곡을 따로 담당시켜 이 이중성을 흉내낸다.

---

## 4. 활차 시스템 (Pulley System)

**힘줄이 뼈에서 떨어지지 않게 붙들어 두는 섬유성 밴드.**

### 4.1 구성

| 종류 | 개수 | 위치 |
| :--- | ---: | :--- |
| **윤상활차 (Annular) A1~A5** | 5 | A1=MCP, A2=기절골 근위, A3=PIP, A4=중절골 중앙, A5=DIP |
| **십자활차 (Cruciate) C1~C3** | 3 | C1=A2~A3 사이, C2=A3~A4 사이, C3=A4~A5 사이 |

- A1, A3, A5는 **관절 위**에 있고 장측판(palmar plate)에서 기시
- A2, A4는 **뼈(지골) 위**에 있고 **생체역학적으로 가장 중요** — 이 둘이 끊어지면 활시위 현상 발생
- A4가 IP 관절 독립 기능 유지에 가장 결정적이라는 보고

### 4.2 기능 — 로봇 설계자가 알아야 할 핵심

> **활차의 역할은 근육-힘줄의 선형 이동과 힘을
> 관절의 회전과 토크로 변환하는 것이다.**

활차가 없으면 **활시위 현상(bowstringing)** — 힘줄이 굽힘 바깥쪽으로 튀어나온다.
그러면:
- 모멘트 암이 커져 토크는 늘지만
- **가동범위가 급감**하고 힘줄 경로가 불안정해진다

즉 활차는 **모멘트 암을 일정하게 유지**하는 장치다. 로봇 손의 텐던 라우팅 설계가 정확히 같은 문제를 푼다.

> SoftHand Model-W(arXiv:2604.00738)가 **수근관(carpal tunnel)을 모사한 텐던 라우팅**으로
> 모터를 전완에 두면서 손의 관성을 낮춘 것이 이 원리의 직접 응용.

---

## 5. 운동 시너지 (Postural Synergies) — 제어의 핵심

### 5.1 Santello, Flanders & Soechting (1998), *J. Neurosci.* 18(23):10105

로봇 손 제어 전체의 이론적 토대가 된 논문.

- 피험자에게 익숙한 물체 다수를 **잡아서 사용하는 자세**를 취하게 함 (precision·power grip 모두 포함)
- 손가락·엄지의 **관절각 15개**를 정적으로 측정
- **주성분분석(PCA) 결과: 첫 2개 주성분이 분산의 80% 이상을 설명**
- 즉 15자유도가 사실상 **2~3차원 부분공간**으로 축약된다

**중요한 단서**: 3차 이상의 고차 주성분은 무작위 잡음이 아니다.
**물체에 대한 추가 정보**를 담고 있다. → 저차 성분만 쓰면 파지는 되지만 정밀 조작은 안 된다.

### 5.2 후속 연구가 확인한 것

| 연구 | 결과 |
| :--- | :--- |
| 대규모 공개 데이터셋 분석 (PMC6540541) | 첫 **3개** 시너지가 전체 분산의 **50% 이상** |
| 비구속 촉각 탐색 과제 (PMC6671569) | 첫 **7개** 주성분이 **90% 이상** |
| 일차운동피질 뉴런 기록 (PMC4032981) | 24 자유도 중 **2~7개 PC가 80~95%** 설명 (파지~지문자 과제) |
| 원숭이 reach-to-grasp (pmid:14762155) | 사람과 유사한 자유도 축약 전략 |
| 일상생활동작 (pmid:32634094) | **희소(sparse) 시너지** — 각 자유도가 주로 하나의 시너지에만 나타남 |

> **해석 시 주의**: "2개면 충분하다"는 **과제 의존적**이다.
> 정적 파지 자세는 2개, 촉각 탐색처럼 복잡한 과제는 7개가 필요하다.
> 시너지 개수는 상수가 아니라 **과제 복잡도의 함수**다.

### 5.3 시너지의 종류

- **운동학적 시너지 (kinematic)** — 관절각의 공변 패턴 (위 연구들)
- **근육 시너지 (muscle)** — EMG 활성의 공변 패턴. **둘은 다르다** (PMC4374551)
- **동역학적 시너지 (dynamical)** — 접촉력의 공변 패턴 (PMC9185513)

---

## 6. 파지 분류 (Grasp Taxonomy)

| 연구 | 분류 수 | 내용 |
| :--- | ---: | :--- |
| **Napier** (1956) | 2 | **정밀 파지(precision) / 강력 파지(power)** — 근본 구분 |
| **Cutkosky** (1989) | 16 | 제조 작업 기준 세분화 |
| **Feix et al.** (2015, *IEEE T-HMS*) | **33** | 기존 분류 다수를 통합한 **GRASP Taxonomy** |

**GRASP Taxonomy 정의**: "손 방향과 무관하게, **손 안에서의 움직임 없이** 물체를 안정적으로 잡고 있는
모든 정적 손 자세."

분류 기준: **접촉 유형(contact type) / 대립 방향(opposition direction) / 손 형상(hand shape)**

> 실무 메모: 물체 형상·크기를 빼고 **손 형상만** 보면 33종은 **17종**으로 줄어든다.
> 로봇 손 벤치마크를 만들 때 이 17종이 현실적인 목표치가 된다.

---

## 7. 로봇 설계로 옮길 때의 핵심 원칙

| 사람 손의 구조 | 이유 | 로봇 설계 대응 |
| :--- | :--- | :--- |
| 근육이 전완에 있음 | 손끝 관성·부피 최소화 | **텐던 원격 구동** (모터를 전완/베이스에) |
| 다관절 힘줄 (FDP/FDS) | 관절 수보다 적은 근육 | **언더액추에이션** (DOF > DOA) |
| 활차 A1~A5 | 모멘트 암 유지, 활시위 방지 | **텐던 라우팅 / 도르래 설계** |
| 신전건막 | MCP 굴곡 + IP 신전 동시 구현 | 길항 텐던, 이중 텐던, SMA 신전 모듈 |
| 엄지 CMC 안장관절 | 2축 제어로 3평면 운동 → 대립 | 어긋난 축(offset axes) 설계, 구면 조인트 |
| 손바닥 아치 | 큰 물체를 감쌈 | 손바닥 자유도 / 변형 가능 팜 |
| 시너지 (PC 2개로 80%) | 뇌의 제어 부담 감소 | **1~2 모터로 다지 구동** (Pisa/IIT SoftHand) |
| 내재근 (정밀 제어) | 미세 자세 조정 | 고차 시너지가 필요한 정밀 조작에 추가 액추에이터 |

---

## 8. 정확도 메모

- 근육의 기시·정지·작용·신경지배는 **StatPearls (NCBI Bookshelf, NBK539810)** 기준으로 정리했다.
- 활차 시스템 구성과 A2/A4의 중요성은 임상 해부 문헌(Orthobullets, TeachMeAnatomy) 및
  A2~A4 파열 증례 보고(PMC7993427) 기준이다.
- **자유도 숫자는 문헌마다 다르다** (21/22/24/27). 어떤 관절을 포함했는지가 다르기 때문이며,
  본 문서는 그 범위를 그대로 적어두었다. 하나의 값으로 고정해 인용하면 안 된다.
- Santello 1998의 "2개 PC > 80%"는 **15개 관절각, 정적 자세** 조건의 결과다.
  다른 과제·다른 측정 자유도에서는 필요한 PC 수가 달라진다 (5.2 표 참조).
- 엄지 CMC의 "6자유도" 결과는 2024년 사체 10구 대상 in vitro 연구(pmid:38703515)의 것으로,
  생체 내 능동 운동과는 구분해서 읽어야 한다.

---

## 9. 참고 문헌

**해부학**
- [Anatomy, Shoulder and Upper Limb, Hand Intrinsic Muscles — StatPearls](https://www.ncbi.nlm.nih.gov/books/NBK539810/)
- [The Flexor Pulley System of the Hand — TeachMeAnatomy](https://teachmeanatomy.info/upper-limb/misc/flexor-system-hand/)
- [Flexor Pulley System — Orthobullets](https://www.orthobullets.com/hand/6004/flexor-pulley-system)
- [Functional Anatomy of the Hand — Physiopedia](https://www.physio-pedia.com/Functional_Anatomy_of_the_Hand)

**엄지 CMC 생체역학**
- [The passive biomechanics of the thumb carpometacarpal joint: An in vitro study](https://pubmed.ncbi.nlm.nih.gov/38703515/) — *J. Biomech.* 2024
- [In Vivo Kinematics of the Thumb Carpometacarpal Joint During Three Isometric Functional Tasks](https://pmc.ncbi.nlm.nih.gov/articles/PMC3940759/)
- [Anatomy and Biomechanics of the Thumb Carpometacarpal Joint](https://www.sciencedirect.com/science/article/abs/pii/S104866661730109X)

**시너지**
- [Postural Hand Synergies for Tool Use](https://doi.org/10.1523/JNEUROSCI.18-23-10105.1998) — Santello, Flanders & Soechting, *J. Neurosci.* 1998 ★ 필독
- [Muscular and postural synergies of the human hand](https://pubmed.ncbi.nlm.nih.gov/14973321/) — Santello 외 2004
- [Kinematic synergies of hand grasps: a comprehensive study on a large publicly available dataset](https://pmc.ncbi.nlm.nih.gov/articles/PMC6540541/)
- [Multidigit movement synergies of the human hand in an unconstrained haptic exploration task](https://pmc.ncbi.nlm.nih.gov/articles/PMC6671569/)
- [Differences between kinematic synergies and muscle synergies during two-digit grasping](https://pmc.ncbi.nlm.nih.gov/articles/PMC4374551/)
- [Primary Motor Cortex Neurons during Individuated Finger and Wrist Movements](https://pmc.ncbi.nlm.nih.gov/articles/PMC4032981/)
- [Hand Kinematics Characterization While Performing Activities of Daily Living Through Kinematics Reduction](https://pubmed.ncbi.nlm.nih.gov/32634094/)

**파지 분류**
- [The GRASP Taxonomy of Human Grasp Types](https://www.csc.kth.se/grasp/taxonomyGRASP.pdf) — Feix, Romero, Schmiedmayer, Dollar & Kragic, *IEEE T-HMS* 2015
- Napier (1956) — precision / power grip 구분
- Cutkosky (1989) — 16종 분류

**데이터셋**
- [A hand biomechanics dataset of kinematics, kinetics, electromyography, and imaging in healthy adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC13111597/)
