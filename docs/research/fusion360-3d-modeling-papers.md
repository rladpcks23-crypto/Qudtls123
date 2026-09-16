# Fusion 360 / 3D 모델링 관련 논문 학습 노트

> 작성일: 2026-09-16
> 목적: Fusion 360을 중심으로 한 3D CAD 모델링 연구(데이터셋 · 딥러닝 방법론 · 응용)를 정리해 두고,
> 이후 작업에서 바로 참조할 수 있는 지식 베이스로 사용한다.

---

## 0. 한 줄 요약

Fusion 360이 3D 모델링 연구에서 중요한 이유는 **결과 형상(geometry)만이 아니라 "사람이 만든 설계 과정(parametric timeline)"을
API로 꺼낼 수 있는 거의 유일한 상용 CAD**이기 때문이다. 그래서 2020년 이후 CAD 딥러닝 연구의 표준 데이터셋·벤치마크가
Autodesk Research의 **Fusion 360 Gallery Dataset**을 중심으로 형성되었다.

---

## 1. 배경 개념 (논문을 읽기 위한 최소 지식)

| 용어 | 설명 |
| :--- | :--- |
| **B-rep (Boundary Representation)** | 상용 CAD의 실제 내부 표현. 파라메트릭 곡면(평면/원통/원뿔/구/토러스/NURBS)과 곡선을 **face–edge–vertex 위상(topology)** 으로 연결한 구조. 메시/포인트클라우드와 달리 정확(exact)하고 가볍다. |
| **Coedge (half-edge)** | 한 edge를 인접한 두 face 각각의 방향에서 본 것. 방향성이 있어서 "왼쪽 면 / 오른쪽 면"의 모호함이 사라진다 → BRepNet 합성곱 커널의 기준점. |
| **Sketch & Extrude** | CAD의 가장 기본 워크플로. 2D 스케치(선/호/원) → 닫힌 프로파일 → 3D 압출. Fusion 360 원본 데이터에서 sketch 84%, extrude 79%의 디자인에 등장 (fillet/chamfer보다 3배 이상 흔함). |
| **Boolean 연산** | extrude 시 new body / join / cut / intersect 중 선택. 두 연산만으로도 표현력이 매우 크다. |
| **Joint (Mate)** | 어셈블리에서 두 부품의 상대 자세와 자유도(DOF)를 정의하는 구속. CAD 사용자가 각 부품의 face/edge를 선택해 만든다. |
| **Construction sequence / Design history** | 설계 의도(design intent)를 담은 순차 프로그램. 이게 있어야 "편집 가능한" CAD가 된다. STEP 등으로 교환하면 보통 소실된다. |
| **주요 평가지표** | Exact reconstruction(정확 복원율), IoU, Chamfer Distance(CD), Invalidity Rate(실행 불가 비율), Conciseness(시퀀스 간결성) |

---

## 2. 기반 데이터셋 — Fusion 360 Gallery Dataset

Autodesk Online Gallery에 사용자가 올린 **약 20,000개 Fusion 360 디자인**에서 파생된 3개 하위 데이터셋.
비상업 연구용 라이선스. 저장소: `AutodeskAILab/Fusion360GalleryDataset`

### 2.1 Reconstruction Dataset
- **8,625개** 사람이 설계한 construction sequence (sketch + extrude로만 구성)
- 학습 6,900 / 테스트 1,725 벤치마크 분할
- 포맷: B-rep(`.smt` 네이티브 + `.step`), 메시(`.obj`, face 단위 그룹 유지), 시퀀스 JSON
- 단위: cm, 각도: radian
- **한계(논문이 직접 명시)**: 3,267개(38%)가 extrude 1회짜리 단순 형상. 스플라인은 곡선의 4%이며 상위 DSL 미지원.

### 2.2 Segmentation Dataset
- **35,680개** 3D 모델 (B-rep / 메시 / 포인트클라우드), 약 390,000개 face
- 각 face에 **"어떤 모델링 연산이 이 면을 만들었는가"** 라벨 (8종):
  `ExtrudeSide`, `ExtrudeEnd`, `CutSide`, `CutEnd`, `Fillet`, `Chamfer`, `RevolveSide`, `RevolveEnd`
- 확장판(s2.0.1): STEP 42,912개
- 용도: 형상 교환 시 소실된 feature history 복원, CAE 단순화, CAM 공정 분할 자동화

### 2.3 Assembly Dataset (+ Joint Data)
- **8,251개 어셈블리 / 154,468개 부품**
- JSON에 `tree`, `occurrences`, `components`, `bodies`, `joints`, `as_built_joints`, `contacts`, `holes` 수록
- **Joint 서브셋**: 19,156 joint set / 32,148 joints / 23,029 parts
- JoinABLe용 그래프 표현(NetworkX node-link JSON) 및 UV-Net 스타일 UV-grid 피처 포함

> 데이터 특성 메모: joint 샘플의 82%가 hole을 포함하고, joint의 47.5%가 "원/원통 ↔ 구멍" 결합.
> → 전통적 휴리스틱(반지름 매칭)이 잘 먹는 구간과 안 먹는 구간(No-Hole)을 나눠서 평가해야 한다.

---

## 3. 핵심 논문 정리

### 3.1 Fusion 360 Gallery (ACM TOG / SIGGRAPH 2021) — arXiv:2010.02392
**Karl D. D. Willis, Yewen Pu, Jieliang Luo 외, Autodesk Research**

- **기여 1 — DSL**: sketch/extrude만으로 된 stateful 미니 언어를 정의.
  ```
  P  := G; [X]
  X  := S | E
  S  := add_sketch(I); [D]
  D  := L | A | C
  L  := add_line(N,N,N,N)
  A  := add_arc(N,N,N,N,N)
  C  := add_circle(N,N,N)
  E  := add_extrude([I], N, O)
  O  := new body | join | cut | intersect
  ```
  Fusion 360 Python API를 감싼 얇은 래퍼. 전역 변수 `G`(현재 형상)를 명령이 순차적으로 갱신.
- **기여 2 — Fusion 360 Gym**: CAD 구축 과정을 **MDP**로 형식화한 실행 환경.
  - state: 현재 형상 + (선택) 목표 형상 → **B-rep face-adjacency graph**
  - action: 모델링 연산 (sketch extrusion / face extrusion 두 가지 표현)
  - transition: Fusion 360이 실제로 실행
  - reward: 사용자 정의 (예: 목표와 일치 시 1)
- **기여 3 — CAD Reconstruction 태스크 표준화**:
  ground-truth 시퀀스로 **모방학습(imitation learning)** 한 Message Passing Network 정책 + 추론 시 **neurally guided search**.
- **결과**: 환경 상호작용 예산 100 스텝에서 테스트셋의 **67.5%를 정확 복원**, 디자인당 평균 20초 미만(실제 5~35초).
  탐색 전략 비교(rand / beam / best)에서 예산이 작을 때는 `rand`가 exact 복원에 유리.
- **교훈**: IoU는 부차 지표로 봐야 한다. USB 커넥터의 작은 구멍처럼 **기능적으로 중요한 디테일이 빠져도 IoU는 높게 나온다.**
  실무에서는 exact reconstruction + conciseness를 같이 봐야 한다.

### 3.2 BRepNet (CVPR 2021) — arXiv:2104.00706
**Joseph G. Lambourne, Karl D. D. Willis 외 (Autodesk Research / UCL)**

- **문제**: B-rep을 메시/포인트클라우드로 근사하지 말고 **직접 학습**하자.
- **방법**: 합성곱 커널을 **coedge 기준**으로 정의. 각 coedge 주변에서 위상 이동(*next, previous, mate, face, edge*)을
  행렬 곱(N, P, M, F, E)으로 표현해 "topological walk"로 이웃 엔티티를 정해진 순서로 모은다.
  → 이미지 CNN처럼 **특정 위치 = 특정 학습 파라미터** 매핑이 성립.
- **입력 피처(좌표 없음 = coordinate-free)**:
  - face: 곡면 타입 one-hot(plane/cylinder/cone/sphere/torus) + rational NURBS 플래그 + 면적
  - edge: 곡선 타입 one-hot(line/circle/ellipse/helix/intersection) + 볼록성 3종(concave/convex/smooth) + 닫힌 루프 플래그 + 길이
  - coedge: 곡선 방향 일치 여부 플래그 1개
  - **장점**: 평행이동·회전 불변 + 형상 좌표를 노출하지 않아 **CAD 고객의 IP 보호**에 유리
- **결과**: 메시 기반(MeshCNN), 포인트클라우드 기반(PointNet++), 그래프 기반(ECC)보다 높은 정확도/IoU를 더 적은 파라미터로 달성.
  ECC 대비 IoU 5%+ 우위, 학습 안정성도 더 좋음.
- **부수적 발견(중요)**: B-rep → 정합(manifold) 메시 변환이 **13%에서 실패**. B-rep 직접 처리의 실무적 이점이 크다.
  또 포인트 샘플링은 면적 비례라 **작은 구멍/홈이 누락**된다 — 기능적으로 치명적.

### 3.3 UV-Net (CVPR 2021) — arXiv:2006.10211
- B-rep을 **"UV 파라미터 공간 그리드 + face adjacency graph"** 의 하이브리드로 표현.
  각 face/edge를 UV 격자로 샘플링(points, normals, trimming mask, tangents) → CNN 인코더 → GNN.
- BRepNet과 함께 **B-rep 딥러닝의 양대 인코더 계열**. 이후 JoinABLe의 baseline(B-Grid), Assembly 데이터셋의 그래프 피처로 재사용됨.

### 3.4 JoinABLe (CVPR 2022) — arXiv:2111.12772
- **문제**: 부품 2개가 주어졌을 때 **클래스 라벨·사람 개입 없이** 어떻게 결합(joint)해야 하는지 예측.
- **핵심 아이디어**:
  1. 각 부품 → B-rep face/edge를 **정점**으로 하는 그래프 G(V,E)
  2. 두 그래프 사이를 **조밀 연결한 joint connectivity graph** `Gj` (n×m edge) 구성 → **link prediction** 문제로 환원
  3. face/edge 피처 → 각각 MLP → concat → MPN → edge convolution으로 n×m 행렬 예측
  4. joint axis 예측 후, 파라미터는 **탐색(search)** 으로 확정
- **학습의 어려움**: 실제 CAD 파일에는 joint 라벨이 극히 일부만 있음 → **Positive-Unlabeled(PU) 학습** 문제 + 극심한 클래스 불균형.
  → Joint Consolidation(동일 부품쌍의 joint를 joint set으로 통합) 등 3가지 데이터 구성 기법으로 완화.
- **결과 (joint axis 예측 정확도)**:

  | 방법 | All | Hole | No Hole | 파라미터 |
  | :--- | ---: | ---: | ---: | ---: |
  | **JoinABLe** | **79.53%** | 80.15% | **76.59%** | 1.3M |
  | B-Heuristic (규칙 기반) | 71.39% | 72.74% | 64.97% | - |
  | B-Grid (UV-Net 방식) | 65.21% | 65.09% | 65.81% | 3.1M |
  | B-Dense (PointNet++) | 10.59% | 10.36% | 10.59% | 3.2M |
  | B-Discrete (Shape2Motion) | 4.28% | 4.18% | 4.79% | 4.0M |
  | B-Random | 21.55% | 21.92% | 23.29% | - |
  | **사람 CAD 전문가** | **80.00%** | - | - | - |

- **해석**: 사람 전문가(80%)에 거의 근접(79.53%). 특히 **구멍이 없는 어려운 케이스에서 휴리스틱 대비 +11.62%p**.
  동시에 "전문가조차 80%밖에 못 맞춘다"는 사실이 중요 — **전체 어셈블리 문맥 없이 부품 2개만 보면 사람도 어렵다.**

### 3.5 Engineering Sketch Generation for CAD (CVPR Workshop 2021) — arXiv:2104.09621
- **CurveGen**: PolyGen을 스케치로 각색. 정점 + **hyperedge 집합**을 생성해 곡선 타입을 hyperedge 차수로 암묵 인코딩(선=2, 호=3, 원=3점 등).
  → **기하와 위상을 동시에** 생성.
- **TurtleGen**: `pen_down / pen_draw / pen_up` 시퀀스를 자기회귀 생성(터틀 그래픽스 확장). 9-layer Transformer.
- **둘 다 constraint solver 없이** 동작 — 이게 핵심 실용 포인트.
- **데이터 교훈(매우 중요)**: SketchGraphs 데이터의 **87.01%가 중복**. 중복 제거 전에는 모델이 그냥 암기한다.
  제거 후 1,106,328 / 39,407 / 39,147 (train/val/test)로 축소.

  | 모델 | 파라미터 | Unique% | Valid% | Novel% |
  | :--- | ---: | ---: | ---: | ---: |
  | CurveGen | 2.16M | 99.90 | 81.50 | 90.90 |
  | TurtleGen | 2.69M | 86.40 | 42.90 | 80.60 |
  | SketchGraphs | 18.6M | 76.20 | 65.80 | 69.10 |
  | SketchGraphs (중복 포함) | 18.6M | 58.70 | 74.00 | 49.70 |

- **지각 평가(AMT, 2-AFC "어느 쪽이 더 현실적인가")**: CurveGen이 가장 사람 설계와 구분하기 어려움.
- CurveGen 출력에 AutoCAD 자동 구속을 걸면 파라메트릭 스케치로 바로 전환 가능.

### 3.6 Material Prediction (2022) — arXiv:2209.12793
- 어셈블리 내 각 body의 **재료를 그래프 표현 학습으로 추천**. 노드 분류 문제로 정식화.
- Fusion 360 Gallery Assembly 데이터의 재료 메타데이터를 활용한 "설계 자동화" 방향 응용 사례.

---

## 4. 비교 대상 · 인접 데이터셋 (맥락 파악용)

| 데이터셋 | 출처 | 특징 | Fusion 360 Gallery와의 관계 |
| :--- | :--- | :--- | :--- |
| **DeepCAD** (arXiv:2105.09492) | Onshape | ~178K CAD 명령 시퀀스, **합성/자동 추출** 규모가 큼 | Fusion360 Reconstruction의 최대 경쟁 벤치마크. 논문들은 보통 **둘 다** 보고한다 |
| **SketchGraphs** (arXiv:2007.08506) | Onshape | 1,500만+ 2D 스케치 + **구속(constraint) 그래프** | Fusion360엔 constraint 라벨이 없음 → 스케치 연구는 SketchGraphs를 씀 |
| **ABC / CC3D** | Onshape / 실스캔 | 대규모 B-rep, 설계 이력 없음 | 사전학습·일반화 평가용 |
| **AutoMate** | MIT/Onshape | 어셈블리 mate 데이터 | JoinABLe의 인접 연구 |

> **중요한 후속 발견**: *"Is Fusion 360 Reconstruction Dataset Really Not Enough for Training When Compared With DeepCAD Dataset?"* (PMID 41880254)
> — 데이터 **규모 차이가 큼에도 불구하고**, 단순 sketch/extrude 시퀀스 학습 능력에서 두 데이터셋은 **사실상 구별되지 않는다**고 실험으로 보였다.
> 적절한 증강을 쓰면 8,625개로도 충분하다는 뜻 → 소규모 데이터로 시작해도 된다는 실용적 신호.

---

## 5. 2024~2026 흐름 — LLM/VLM 기반 생성형 CAD

Fusion 360 Gallery는 이제 **"벤치마크"로서** 이 흐름의 평가 축이 되었다.

### 5.1 패러다임 전환: "명령 시퀀스" → "실행 가능한 파이썬 코드"
- **CAD-Recode** (ICCV 2025, arXiv:2412.14042): 포인트클라우드 → **CadQuery 파이썬 코드**.
  Qwen2-1.5B에 선형 레이어 하나만 추가. 절차적으로 생성한 **100만 개** sketch-extrude 시퀀스로 사전학습.
  DeepCAD/Fusion360 벤치마크에서 **Chamfer Distance 10배 감소, IoU 20%p+ 향상**, 실행 불가 비율 1% 미만.
- **Text-to-CadQuery** (arXiv:2505.06507), **CAD-Coder** (arXiv:2505.08686): 텍스트 → CadQuery 코드 직접 생성.
- **의의**: 코드로 표현하면 사전학습된 LLM 능력을 **그대로** 쓸 수 있다. 별도 토크나이저/처음부터 학습이 불필요.

### 5.2 멀티모달 조건부 생성
- **Text2CAD** (NeurIPS 2024, arXiv:2409.17457 계열): DeepCAD에 Mistral + LLaVA-NeXT로 텍스트 주석 파이프라인 구축.
  ~170K 모델 / ~660K 텍스트 (초보자~전문가 수준별 프롬프트).
- **CAD-MLLM** (arXiv:2411.04954): 텍스트/이미지/포인트클라우드/혼합 입력 통합.
- **TransCAD** (ECCV 2024, arXiv:2407.12702): 포인트클라우드 → CAD 시퀀스, 계층적 트랜스포머 + loop refiner. DeepCAD·Fusion360 SOTA.
- **FlexCAD** (arXiv:2411.05823): CAD를 구조화 텍스트로 표현해 LLM 파인튜닝. sketch/extrude/loop/curve 등 **모든 계층에서 제어 가능한 생성**.
- **Img2CAD** (arXiv:2410.03417), **CAD-GPT** (arXiv:2412.19663), **OpenECAD** (arXiv:2406.09913).

### 5.3 B-rep 직접 생성
- **SolidGen** (arXiv:2203.13944): 시퀀스 감독 없이 B-rep 직접 자기회귀 생성 (vertex→edge→face).
- **BrepGen** (SIGGRAPH 2024, arXiv:2401.15563): 구조화 latent 트리 + 확산 모델.
- **HoLa** (arXiv:2504.13178 계열), **AutoBrep**, **BrepGPT**, **GraphBrep** 등 2025~2026년 대량 등장.

### 5.4 벤치마크 정비 (2026)
- **CADBench** (arXiv:2605.10873): DeepCAD/**Fusion 360**/ABC/MCB/Objaverse 기반 18,000 샘플, 5개 입력 모달리티, 6개 지표 통합.
- **UniCAD** (arXiv:2606.05058): point→CAD, text/image→CAD, CAD QA 통합 벤치마크 + UniCAD-MLLM.
- **HistCAD** (arXiv:2602.19171): **구속 조건을 명시**하고, "파라미터를 바꿨을 때 설계 의도가 보존되는가"를 측정.
  → 기존 벤치마크가 복원 정확도만 봤다는 비판.
- **VideoCAD** (arXiv:2505.24838): **CAD UI 조작 자체**를 학습. 41K+ 주석 비디오. 장기 horizon UI 에이전트.
- **Linkify** (arXiv:2607.01205): Fusion 360 Gallery Assembly의 **접촉면 기하를 고해상도로 재계산**(누락·오류 접촉 수정) 후 인터페이스 증강 어셈블리 그래프 학습.

### 5.5 남아 있는 미해결 과제 (여러 논문이 공통 지적)
1. **연산 다양성 부족** — 공개 데이터는 sketch+extrude에 편중. fillet/chamfer/revolve/loft/sweep/pattern 부재.
   → CADFS(FeatureScript 기반 450K, 15종 연산), CADEvolve, Zero-to-CAD 등이 이 격차를 메우려 함.
2. **설계 의도(design intent) 미평가** — 복원은 되는데 **편집 가능성**이 보장되지 않음 (HistCAD의 문제의식).
3. **구속(constraint) 생성** — arXiv:2504.13178 "Aligning Constraint Generation with Design Intent": 추론 LLM의 정렬 기법을 스케치 구속 생성에 적용.
4. **산업 정밀도** — OmniMech(arXiv:2608.05539)는 **밀리미터 공차** 수준을 요구하는 251,000+ 도면 벤치마크를 제시.

---

## 6. 응용 연구 — Fusion 360을 "도구"로 쓴 논문들

### 6.1 Generative Design (제너레이티브 디자인)
- **arXiv:2007.14138** "Generative Design for Performance Enhancement, Weight Reduction, and its Industrial Implications":
  회전 링키지 브래킷을 Fusion 360 내장 제너레이티브 디자인 기능으로 설계. 경량화 + 성능 개선 검증.
- 용어 구분(논문이 강조): **Generative Design = 응력 해석 기반**, **Optimization = 하중 경로 기반**.
- 관련 흐름: 토폴로지 최적화 + 적층제조(AM). 자기지지(self-supporting) 제약, 오버행 각도 제약, 잔류응력/변형 고려,
  래티스 구조 충전, 강화학습(PPO) 기반 토폴로지 최적화(PMC12355488) 등.

### 6.2 교육 / 협업 엔지니어링
- **"Cloud-Based Collaborative 3D Modeling to Train Engineers for the Industry 4.0"** (Applied Sciences 9(21):4559, 2019, doi:10.3390/app9214559):
  라구나 대학교 학부생 65명 대상. PLM 사전지식 / 개인 실습 / 협업 인식 3개 변수로 분석.
  기능성·가용성·접근성·통합성·협업성 평가에서 **Fusion 360이 최고점**. 클라우드 기능이 **대면 회의 필요를 줄였다**는 응답 다수.
- 시사점: Fusion 360의 연구적 가치는 알고리즘뿐 아니라 **클라우드 기반 협업 PDM/PLM** 측면에도 있다.

### 6.3 리버스 엔지니어링 / CAM
- 3D 스캔 → 포인트클라우드 → 메시 → B-rep → 편집 가능 CAD 파이프라인이 공통 주제
  (자동차 PMC3345859, 의료·치과 보철, 재제조 PMC6630306 등 사례 다수).
- **FusionCut** (arXiv:2603.03504): B-rep 기반 클라우드 지원 CWE(Cutter-Workpiece Engagement) 계산 — 가상 가공 시뮬레이션.
- **arXiv:2509.05857**: 적층제조 부품의 리버스 엔지니어링 — 공정 유발 변형을 시뮬레이션으로 보상.

---

## 7. 실무에 바로 쓸 수 있는 정리

### 7.1 Fusion 360 데이터를 다룰 때
- **`.smt`** 가 ground truth (Autodesk Shape Manager 네이티브, 변환 오차 최소). `.step`은 호환용 대안.
- `.obj` 메시는 **B-rep face 단위로 그룹**(`g face 1`)이 보존되어 face↔triangle 매핑이 가능. 단 **manifold 보장 없음**.
- 단위는 **cm**, 각도는 **radian**.
- UUID로 JSON ↔ 지오메트리 파일을 교차 참조.
- Fusion 360 API(Python)로 timeline을 재생(replay)하면 원본 형상을 재구성할 수 있다.

### 7.2 모델 설계 시 선택 가이드
| 상황 | 권장 접근 |
| :--- | :--- |
| B-rep이 직접 있고 face 단위 예측 | BRepNet(coedge 커널) 또는 UV-Net(UV-grid+GNN) |
| 좌표를 노출하면 안 되는 고객 데이터 | BRepNet의 coordinate-free 피처 (타입/볼록성/면적/길이만) |
| 포인트클라우드 → 편집 가능 CAD | CAD-Recode 계열 (LLM + CadQuery 코드) |
| 텍스트 → CAD | Text2CAD / FlexCAD / CAD-Coder |
| 어셈블리 결합 예측 | JoinABLe (link prediction on joint connectivity graph) |
| 데이터가 적을 때 | Fusion360 8.6K + 증강으로도 DeepCAD 178K와 대등 (PMID 41880254) |

### 7.3 평가할 때 주의할 점
- **IoU만 보지 말 것.** 작은 구멍/홈처럼 기능적으로 중요한 피처가 빠져도 IoU는 높다.
- exact reconstruction + **conciseness**(시퀀스 길이)를 함께 봐야 한다. 짧은 시퀀스만 복원해도 conciseness는 좋아 보인다.
- 어셈블리 joint는 **Hole / No-Hole 서브셋을 분리**해서 평가. 휴리스틱은 Hole에서만 강하다.
- 사람 상한선(human baseline)을 반드시 확인 — joint axis는 전문가도 80%다.

---

## 8. 참고 문헌

**핵심 (Autodesk Research, Fusion 360 직접 관련)**
- [Fusion 360 Gallery: A Dataset and Environment for Programmatic CAD Construction from Human Design Sequences](https://arxiv.org/abs/2010.02392) — ACM TOG 40(4), 2021 · [ACM DL](https://dl.acm.org/doi/10.1145/3450626.3459818) · [Autodesk](https://www.research.autodesk.com/publications/fusion-360-gallery/)
- [BRepNet: A topological message passing system for solid models](https://arxiv.org/abs/2104.00706) — CVPR 2021
- [UV-Net: Learning from Boundary Representations](https://arxiv.org/abs/2006.10211) — CVPR 2021
- [JoinABLe: Learning Bottom-up Assembly of Parametric CAD Joints](https://arxiv.org/abs/2111.12772) — CVPR 2022
- [Engineering Sketch Generation for Computer-Aided Design](https://arxiv.org/abs/2104.09621) — CVPR-W 2021
- [UVStyle-Net: Unsupervised Few-shot Learning of 3D Style Similarity Measure for B-Reps](https://arxiv.org/abs/2105.02961)
- [SolidGen: An Autoregressive Model for Direct B-rep Synthesis](https://arxiv.org/abs/2203.13944)
- [Material Prediction for Design Automation Using Graph Representation Learning](https://arxiv.org/abs/2209.12793)
- 데이터/코드: [AutodeskAILab/Fusion360GalleryDataset](https://github.com/AutodeskAILab/Fusion360GalleryDataset)

**비교 데이터셋**
- [DeepCAD: A Deep Generative Network for CAD Models](https://arxiv.org/abs/2105.09492)
- [SketchGraphs](https://arxiv.org/abs/2007.08506) · [SketchGen](https://arxiv.org/abs/2106.02711) · [Vitruvion](https://arxiv.org/abs/2109.14124)

**최신 생성형 CAD (2024~2026)**
- [CAD-Recode: Reverse Engineering CAD Code from Point Clouds](https://arxiv.org/abs/2412.14042) — ICCV 2025
- [TransCAD](https://arxiv.org/abs/2407.12702) · [Text2CAD](https://arxiv.org/abs/2409.17457) · [CAD-MLLM](https://arxiv.org/abs/2411.04954) · [FlexCAD](https://arxiv.org/abs/2411.05823)
- [BrepGen](https://arxiv.org/abs/2401.15563) · [SkexGen](https://arxiv.org/abs/2207.04632) · [SECAD-Net](https://arxiv.org/abs/2303.10613) · [Point2Cyl](https://arxiv.org/abs/2112.09329)
- [Aligning Constraint Generation with Design Intent in Parametric CAD](https://arxiv.org/abs/2504.13178)
- [VideoCAD](https://arxiv.org/abs/2505.24838) · [CADBench](https://arxiv.org/abs/2605.10873) · [UniCAD](https://arxiv.org/abs/2606.05058) · [HistCAD](https://arxiv.org/abs/2602.19171) · [Linkify](https://arxiv.org/abs/2607.01205)

**응용**
- [Generative Design for Performance Enhancement, Weight Reduction, and its Industrial Implications](https://arxiv.org/abs/2007.14138)
- [Cloud-Based Collaborative 3D Modeling to Train Engineers for the Industry 4.0](https://doi.org/10.3390/app9214559)
- [FusionCut: B-Rep Based Cloud-Ready Cutter Workpiece Engagement](https://arxiv.org/abs/2603.03504)

---

## 9. 정확도 메모

- 3장(핵심 논문)의 수치·표·아키텍처 설명은 **원문 본문을 직접 읽고** 기록했다.
- 5장의 2025~2026년 논문 다수는 **초록 수준**에서만 확인했다. 인용 전에 본문 재확인 필요.
- 데이터셋 통계(2장)는 공식 저장소 `docs/*.md` 원문 기준이다.
  (단 Segmentation 모델 수는 논문 "over 35,000" / 문서 "35,680" / 확장 STEP판 "42,912"로 표기가 갈린다.)
