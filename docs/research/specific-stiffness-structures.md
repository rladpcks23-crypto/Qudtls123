# 같은 무게에서 더 큰 강성을 내는 구조 — 논문 학습 노트

> 작성일: 2026-09-16
> 질문: "필라멘트나 철이 **어떤 구조**에서 **같은 무게일 때 더 큰 강성**을 갖는가?"
> 대상: 3D 프린팅 필라멘트(PLA/PETG/PA/CF) + 금속(강철/알루미늄)

---

## 0. 결론 먼저

**"어떤 구조가 제일 뻣뻣한가"에 단일 정답은 없다. 하중 종류에 따라 답이 완전히 뒤집힌다.**

같은 무게 대비 강성(specific stiffness)은 **독립된 3개 층위의 곱**으로 결정된다:

```
비강성 = [재료 지수] × [단면 형상 계수] × [내부 셀 위상]
         Ashby index    shape factor      lattice topology
```

세 층위 중 **어디에 지렛대가 가장 큰지가 하중 종류에 따라 다르다.**

| 하중 | 지배 층위 | 실무적 정답 |
| :--- | :--- | :--- |
| 순수 인장 (tie) | 재료만 | 형상 무의미. E/ρ 높은 재료 |
| 굽힘 빔 | **단면 형상** | 속 빈 단면(튜브/I빔/각관) — 재료 바꾸는 것보다 효과 큼 |
| 굽힘 판 | **두께** | 샌드위치 구조. D ∝ t³ 이라 두께가 압도적 |
| 저밀도 충전 | **셀 위상** | stretch-dominated 또는 plate lattice |

그리고 가장 반직관적인 핵심 결과 하나:

> **굽힘을 받는 판(plate)에서는, 같은 무게일 때 PLA가 강철보다 약 1.6배 뻣뻣하다.**
> 밀도가 낮아 두께를 더 줄 수 있고, 굽힘 강성이 두께의 3제곱에 비례하기 때문이다.

---

## 1. 층위 1 — 재료 지수 (Ashby Material Index)

하중 모드마다 "같은 무게에서 가장 뻣뻣한 재료" 지수가 다르다. **지수가 1보다 작은 거듭제곱이 붙는 순간 저밀도 재료가 유리해진다.**

| 하중 형태 | 최대화할 지수 | 의미 |
| :--- | :--- | :--- |
| 인장 봉 (tie) | **E / ρ** | 단면적만 자유 |
| 굽힘/좌굴 빔 (beam) | **E^(1/2) / ρ** | 단면 치수 자유 |
| 굽힘 판 (plate) | **E^(1/3) / ρ** | 두께 자유 |

### 계산 결과 (강철 = 1.00 기준으로 정규화)

| 재료 | E (GPa) | ρ (g/cm³) | 인장 E/ρ | 굽힘 빔 E^½/ρ | **굽힘 판 E^⅓/ρ** |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 구조용 강철 | 210 | 7.85 | **1.00** | 1.00 | 1.00 |
| 알루미늄 6061 | 69 | 2.70 | 0.96 | **1.67** | **2.01** |
| Ti-6Al-4V | 114 | 4.43 | 0.96 | 1.31 | 1.45 |
| CF-PLA | ~6 | ~1.29 | 0.17 | 1.03 | 1.86 |
| PLA | 3.5 | 1.24 | 0.11 | 0.82 | **1.62** |
| PA12 (나일론) | 1.7 | 1.01 | 0.06 | 0.70 | 1.56 |
| PETG | 2.1 | 1.27 | 0.06 | 0.62 | 1.33 |

**읽는 법**
- **인장**에서는 강철 ≈ 알루미늄 ≈ 티타늄 (모두 0.96~1.00). 금속끼리 거의 동률이고, 플라스틱은 6~17%로 참패.
  → 케이블·타이로드는 재료 싸움이고, 플라스틱은 상대가 안 된다.
- **굽힘 빔**에서 알루미늄이 강철을 **1.67배** 앞선다. CF-PLA가 강철과 동률(1.03)까지 올라온다.
- **굽힘 판**에서는 순서가 완전히 뒤집혀 **강철이 꼴찌**다. 알루미늄 2.01, CF-PLA 1.86, PLA 1.62 모두 강철보다 앞선다.

> **주의**: 이 지수는 "두께를 자유롭게 키울 수 있다"는 가정이다. 두께 제약, 좌굴, 강도(strength), 온도가 걸리면 순위는 다시 바뀐다.
> 그리고 **강성(stiffness, E)과 강도(strength, σ)는 전혀 다른 문제다.** 여기 표는 전부 강성 얘기다.

---

## 2. 층위 2 — 단면 형상 계수 (Shape Factor)

같은 재료·같은 단면적에서 **단면 모양만 바꿔** 굽힘 강성을 올리는 배율.

```
φ_B^e = 12·I / A²          (속 찬 정사각형 = 1)
```

빔의 실효 지수는 `E^(1/2)/ρ` → **`(φ·E)^(1/2)/ρ`** 가 된다. 즉 **φ의 제곱근만큼 이득**.

### 재료별 달성 가능한 최대 φ

| 재료 | 최대 φ_B^e | 강성 이득 (√φ) | 제한 요인 |
| :--- | ---: | ---: | :--- |
| 강철 | **~60** | **~7.7배** | 국부 좌굴 (local buckling) |
| 알루미늄 합금 | ~40 | ~6.3배 | 국부 좌굴 |
| 목재 | 5~10 | ~2.2~3.2배 | **가공 한계** (좌굴 한계까지 못 감) |
| 복합재 | 5~10 | ~2.2~3.2배 | **가공 한계** |
| (참고) 얇은 벽 튜브 | 10~30 | 3.2~5.5배 | |
| (참고) 속 찬 원형 | ~1.2 | ~1.1배 | |

**핵심 통찰**
- 강철이 구조재의 왕인 이유는 E/ρ가 아니라 **φ를 60까지 밀어붙일 수 있기 때문**이다.
  재료 지수에서 알루미늄에 1.67배 밀려도, I빔/각관으로 형상에서 되찾는다.
- 한계는 **국부 좌굴**이 정한다. 벽을 계속 얇게 하면 어느 순간 판이 주름져 무너진다. 이 한계가 재료의 E와 σ_y에 달려 있다.
- **3D 프린팅 필라멘트는 φ를 크게 못 올린다.** 벽이 얇아지면 좌굴 + 층간 박리(delamination)가 먼저 오고, 노즐 직경(보통 0.4mm)이 최소 벽 두께의 하한을 만든다. 실용 범위는 복합재와 비슷한 **5~10**.

---

## 3. 층위 3 — 내부 셀 위상 (Lattice Topology)

여기가 "같은 무게에서 더 뻣뻣한 구조"라는 질문의 진짜 심장부다.

### 3.1 Gibson-Ashby 스케일링 법칙 (모든 논의의 출발점)

상대밀도 `ρ̄ = ρ*/ρs` 에 대해:

```
E* / Es = C · ρ̄ⁿ
```

**n이 1이냐 2냐가 전부를 가른다.**

| 변형 모드 | n | 예시 |
| :--- | ---: | :--- |
| **Stretch-dominated** (스트럿이 인장/압축) | **≈ 1** | 옥텟 트러스, 삼각 격자, 허니컴의 **축방향**, 재진입(re-entrant) |
| **Bending-dominated** (스트럿이 굽힘) | **≈ 2** | 일반 폼(foam), BCC 격자, 육각 허니컴의 **면내**, 대부분의 랜덤 구조 |

**왜 이게 결정적인가 — 저밀도일수록 격차가 폭발한다:**

| 상대밀도 ρ̄ | Stretch (n=1) | Bending (n=2) | **비율** |
| ---: | ---: | ---: | ---: |
| 50% | 0.50 | 0.25 | 2배 |
| 20% | 0.20 | 0.04 | **5배** |
| 10% | 0.10 | 0.01 | **10배** |
| 1% | 0.01 | 0.0001 | **100배** |

→ **가볍게 만들수록 위상 선택이 중요해진다.** 50% 인필에서는 뭘 써도 비슷하지만, 10% 인필에서는 10배 차이가 난다.

### 3.2 구체적 수치

**옥텟 트러스 (Deshpande, Fleck & Ashby 2001)** — stretch-dominated의 교과서적 사례
```
E*  = (1/9) · ρ̄ · Es
σy* = (1/3) · ρ̄ · σys
```
등방 평균 기준. **선형 스케일링**이라 저밀도에서 폼을 압도한다.

**Maxwell 기준** — 위상이 stretch인지 bending인지 판별하는 고전적 규칙 (핀 절점 가정, 절점 연결도 기반).

**실험적 확인 사례:**
- **BCC 트윈 격자** (arXiv:2410.07833): 절점 연결도를 **바꾸지 않고** 트위닝만으로 bending → stretch 전환을 유도.
  **강성 +162%, 강도 +95%.**
- **스포츠웨어용 격자** (PMC12526810): stretch형 re-entrant(RE)가 bending형 rhombic dodecahedron(RD)보다
  **상대밀도가 더 낮은데도 최대 40% 더 뻣뻣**.
- **재진입 플레이트 격자** (PMC8624896): Gibson-Ashby 지수 실측 — FPT는 ρ^1.15(stretch), FPMA는 ρ^1.30(혼합), FPV는 ρ^3.59(bending).
  같은 계열 안에서도 지수가 1.15 ~ 3.59로 벌어진다.

### 3.3 판 격자(Plate Lattice)가 트러스를 이긴다 — 현재 SOTA

**Tancogne-Dejean & Mohr, Advanced Materials 2018** (pmid:30230617)
- 입방 결정의 **최조밀면(closest-packed planes)** 에 판을 배치.
- SC + BCC + FCC 위상 조합으로 **등방성**을 확보.
- **같은 질량에서 가장 뻣뻣한 트러스 격자보다 최대 3배 강성.**
- 강성과 항복강도 모두 등방 다공성 고체의 **이론 한계에서 수 % 이내**.
- 직접 레이저 라이팅으로 제작해 실험 검증.

**Plate-nanolattice** (PMC7101344, 열분해 탄소 Es≈62 GPa, ρ̄ 25~60%)
| | Hashin-Shtrikman 상한 대비 | Suquet 상한 대비 |
| :--- | ---: | ---: |
| 옥텟 트러스 | **~25%** | **~20%** |
| 판 격자 | 상한 도달 | 상한 도달 |

- 최고 성능 빔 격자 대비 **강성 +137~522%, 강도 +89~639%.**
- 트러스가 상한의 25%에 그치는 이유: **절점 응력집중 + 굽힘 성분**.

**Berger, Wadley & McMeeking, Nature 2017** (pmid:28219078)
- 피라미드+십자(Isomax) 구조로 **등방 탄성 강성의 이론 한계에 최초로 도달**했음을 증명.

**왜 판이 더 좋은가**: 판은 **막(membrane) 응력**으로 하중을 받는다. 재료가 단면 전체에 균일하게 일한다.
트러스는 절점에서 응력이 몰리고 스트럿에 굽힘 성분이 섞인다.

### 3.4 판 격자의 대가 (반드시 알아야 할 단점)

**arXiv:2011.04095** "On the competition for ultimately stiff and strong architected materials"가 정리한 트레이드오프:
1. **좌굴 취약** — 판 격자는 강성/항복강도는 높지만 **좌굴이 먼저 온다.** 저밀도일수록 심각.
2. **제조성** — 닫힌 셀이라 분말/미경화 레진을 빼낼 수 없다. SLM/SLA에서 치명적.
3. **arXiv:2012.01359**: 토폴로지 최적화로 강성을 79~58%로 낮추는 대신 **좌굴 강도를 180~767%로 끌어올린** 구조군 제시.
   → 실제 하중 한계가 문제라면 강성 최적해를 쓰면 안 된다.

### 3.5 Maxwell 기준을 넘어서 (2019~)

**"Stiff isotropic lattices beyond the Maxwell criterion"** (PMC6764834, Science Advances)
- Maxwell 기준을 **위반**하는(extension-free mechanism을 가진) ORC/OQSO 위상도 실제로는 **n ≈ 1 선형 스케일링**.
- 이유: 절점을 강체 핀이 아니라 **변형 가능한 연속체**로 보면 메커니즘이 활성화되지 않거나 절점이 토크를 전달한다.
- **등방성이 훨씬 좋다**: OQSO의 Zener 비 = **1.000** vs **옥텟 = 1.927**(심한 이방성).
- 실용적 장점: 스트럿 직경이 **단일 값**. 다른 등방 설계는 13% 이상 직경 변화를 요구해 가공이 어렵다.
- 상대밀도 20%에서 OQSO ≈ 25 MPa, 옥텟 ≈ 16~27 MPa(방향 의존).

> **옥텟은 강하지만 이방성이 심하다.** 하중 방향이 불확실한 부품에서는 옥텟의 최약 방향이 발목을 잡는다.

### 3.6 허니컴의 이중성 (자주 오해되는 부분)

육각 허니컴은 **같은 구조인데 하중 방향에 따라 n이 달라진다**:
- **면내(in-plane)**: 셀벽이 굽는다 → bending-dominated, `E ∝ (t/l)³`
- **축방향(out-of-plane, 프리즘 축)**: 셀벽이 순수 압축 → **stretch-dominated, `E ∝ ρ̄`**

→ 허니컴 샌드위치 코어가 그렇게 효율적인 이유가 바로 이것. 축방향으로 쓰기 때문이다.
→ 반대로 **FDM의 허니컴 인필을 면내로 누르면 bending-dominated라 효율이 떨어진다.**

---

## 4. 실제 FDM 프린팅에서는 이론대로 안 된다

이게 실무에서 가장 중요한 부분이다. **문헌 결과가 서로 엇갈린다.**

### 4.1 사각형이 삼각형을 이긴 사례 (PMC8582052)

PLA 인필 패턴 비교, 유사 상대밀도:

| 패턴 | 상대밀도 | 탄성계수 |
| :--- | ---: | ---: |
| **사각(square)** | 56% | **942 MPa** |
| 삼각(triangular) | 55% | 432 MPa |
| 육각(hexagonal) | 52% | 224 MPa |

높은 밀도에서도 유지: square 75% → 2518 MPa vs triangular 66% → 1187 MPa.

**이론상 삼각형(stretch-dominated)이 이겨야 하는데 사각형이 2배 이상 이겼다.**
저자 설명: 압출기 이동 방향 정렬 + 절점 결함. **FFF의 방향성 결함이 위상 이점을 뒤집는다.**
(Gibson-Ashby 해석식 오차 12.7% vs FEA 6.4%)

### 4.2 반대 결과를 보고한 사례 (PMC12788003)

동일 재료·동일 공칭 인필에서:
- **강성 1위: 허니컴** (스트럿이 더 가는데도)
- **강도 1위: grid** (인장강도 21.91 MPa vs 허니컴 18.42, rectilinear 16.65, adaptive cubic 13.05 MPa)

> 결론: "패턴 선택만으로 강도-강성 균형이 이동한다."

### 4.3 그래서 어떻게 해석해야 하나

문헌이 엇갈리는 이유:
1. **시험 모드가 다르다** — 인장 / 압축 / 3점 굽힘에서 순위가 바뀐다
2. **밀도 범위가 다르다** — 위상 효과는 저밀도에서만 크게 벌어진다
3. **슬라이서의 "인필 20%"는 실제 상대밀도가 아니다** — 벽/상하면 포함 여부가 제각각
4. **프린터 개체차** — 노즐 정렬, 층간 접착, 냉각이 결함 분포를 바꾼다

→ **자기 프린터·자기 슬라이서에서 직접 검증해야 한다.** 논문의 순위를 그대로 믿으면 안 된다.

### 4.4 인필보다 벽(perimeter)이 훨씬 중요하다

이건 여러 연구가 일관되게 지지한다.

- Sustainability 18:7457 (3D 프린팅 가구 커넥터): **인필 밀도를 올려도 최대 굽힘 모멘트와 회전 강성에 통계적으로 유의한 개선이 없었다.**
  재료 소비와 프린팅 시간만 늘었다.
- 여러 FFF 연구: **윤곽선(contour/perimeter) 개수가 더 지배적인 인자.** 응력 집중을 바깥 모서리에서 중앙으로 옮겨 조기 파손을 막는다.

**물리적 이유**: 굽힘 강성은 `I = ∫y² dA`. **중립축에서 먼 재료가 y²로 기여**한다.
인필은 중립축 근처에 있어서 기여가 작다. 벽은 가장 바깥에 있다.

> **실무 규칙: 굽힘 부품이면 벽 개수를 먼저 올리고, 인필은 그 다음이다.**
> 이것은 3장의 "속 빈 단면 + 형상 계수" 논리를 프린터 설정으로 옮긴 것과 정확히 같다.

---

## 5. 판(plate) 문제 — 샌드위치가 답인 이유

굽힘 판의 강성은
```
D = E·t³ / [12(1−ν²)]
```
**두께의 3제곱.** 두께를 2배로 하면 굽힘 강성 8배.

샌드위치 구조는 이걸 직접 공략한다:
- 얇은 면재(face sheet) 2장을 가벼운 코어로 **떨어뜨려 놓는다**
- 질량은 코어 밀도만큼만 늘고, 유효 두께는 크게 늘어난다
- 면재가 인장/압축을 받고, 코어는 전단만 전달

관련 참고:
- 나노카드보드 (PMC6202357): ~1 g/m² 의 초저질량에서 굽힘 강성 확보, 급격히 구부려도 형상 완전 회복
- PMC2211.02803: 중공 원통 리간드 허니컴 코어 샌드위치 — basketweave 코어 대비 굽힘 강성·좌굴 저항 우세
- 파손 모드가 많다는 점 주의: 면재 항복, **면재 주름(wrinkling)**, 셀내 좌굴, 코어 전단, shear crimping
  (헬리콥터 바닥재 최적화 연구 PMC8399855는 제약 9개를 동시에 고려)

---

## 6. 종합 의사결정 표

| 상황 | 권장 구조 | 근거 |
| :--- | :--- | :--- |
| 순수 인장 | 형상 무의미, 재료 E/ρ | 금속끼리 동률, 플라스틱 불리 |
| 굽힘 빔 (금속) | **속 빈 각관/원형관/I빔** | φ까지 강철 60, 알루미늄 40 |
| 굽힘 빔 (프린팅) | **벽 두께 ↑ + 저밀도 인필** | 벽이 인필보다 지배적 |
| 굽힘 판 | **샌드위치** (얇은 면재 + 가벼운 코어) | D ∝ t³ |
| 초저밀도(ρ̄ < 10%) 충전 | **Stretch-dominated** (옥텟, 삼각) | n=1 vs n=2 격차가 10배 이상 |
| 최대 강성이 목표 | **Plate lattice** (SC+BCC+FCC) | 트러스 대비 최대 3배, HS 상한 도달 |
| **등방성**이 필요 | Plate lattice 또는 **OQSO/ORC** | 옥텟은 Zener 1.93으로 이방성 심함 |
| 좌굴/제조성이 걱정 | **트러스(옥텟)** 또는 **TPMS(gyroid)** | 판 격자는 좌굴 취약 + 분말 제거 불가 |
| 판재를 얇게 못 만들 때 | 알루미늄 > CF-PLA > PLA > 강철 | 굽힘 판 지수 순서 |

---

## 7. 반드시 피해야 할 함정

1. **강성(stiffness)과 강도(strength)를 혼동하지 말 것.**
   강성은 처짐(E), 강도는 파손(σ). 판 격자는 강성 1위여도 좌굴 때문에 실제 하중 한계는 트러스가 나을 수 있다.
2. **"가장 뻣뻣한 격자"는 밀도에 따라 바뀐다.** 50% 밀도의 순위를 10%에 적용하면 안 된다.
3. **FDM은 이방성이다.** 층간(Z) 방향이 가장 약하다. 격자 이론은 등방 모재를 가정한다.
4. **슬라이서 인필 % ≠ 상대밀도.** 실제 무게를 재서 ρ̄를 계산할 것.
5. **Maxwell 기준은 필요조건이지 충분조건이 아니다.** 절점 강성을 고려하면 기준을 "위반"해도 선형 스케일링이 나온다 (PMC6764834).
6. **Ashby 지수는 두께 자유를 가정한다.** 두께·포장 제약이 있으면 순위가 바뀐다.
7. **옥텟 = 만능이 아니다.** Zener 비 1.927로 방향에 따라 강성이 크게 다르다. 하중 방향이 확실할 때만 유리하다.

---

## 8. 핵심 수식 요약 (바로 쓰는 치트시트)

```
■ 재료 선택 (같은 무게 최대 강성)
   인장 봉   : max  E / ρ
   굽힘 빔   : max  E^(1/2) / ρ
   굽힘 판   : max  E^(1/3) / ρ

■ 단면 형상
   φ_B^e = 12·I / A²                  (속 찬 정사각형 = 1)
   실효 빔 지수 = (φ·E)^(1/2) / ρ
   최대 φ : 강철 ~60, 알루미늄 ~40, 목재/복합재 5~10
   한계 : 국부 좌굴

■ 셀 구조 (Gibson-Ashby)
   E* / Es = C · ρ̄ⁿ
   n ≈ 1 : stretch-dominated  (옥텟, 삼각, 허니컴 축방향)
   n ≈ 2 : bending-dominated  (폼, BCC, 허니컴 면내)
   옥텟   : E* = ρ̄·Es / 9,  σy* = ρ̄·σys / 3

■ 판 굽힘
   D = E·t³ / [12(1−ν²)]              (두께 2배 → 강성 8배)

■ 상대 성능 (강철 = 1.00)
   굽힘 판 : Al 2.01 > CF-PLA 1.86 > PLA 1.62 > PA12 1.56 > Ti 1.45 > PETG 1.33 > 강철 1.00
   굽힘 빔 : Al 1.67 > Ti 1.31 > CF-PLA 1.03 > 강철 1.00 > PLA 0.82
   인장   : 강철 1.00 ≈ Ti 0.96 ≈ Al 0.96 >> CF-PLA 0.17 > PLA 0.11
```

---

## 9. 참고 문헌

**이론 기초**
- M. F. Ashby, *Materials Selection in Mechanical Design* — 재료 지수, 형상 계수
- [Shape Factors (Granta EduPack 방법론)](https://support.grantadesign.com/resources/grantaedupack/2021R1/learn/html/ref_methodology/selection_2procedure5.htm)
- L. J. Gibson & M. F. Ashby, *Cellular Solids: Structure and Properties* — ρ̄ⁿ 스케일링
- Deshpande, Fleck & Ashby, "Effective properties of the octet-truss lattice material", JMPS 2001

**판 격자 / 이론 한계**
- [Mechanical metamaterials at the theoretical limit of isotropic elastic stiffness](https://www.nature.com/articles/nature21075) — Berger, Wadley & McMeeking, *Nature* 2017 (pmid:28219078)
- [3D Plate-Lattices: An Emerging Class of Low-Density Metamaterial Exhibiting Optimal Isotropic Stiffness](https://advanced.onlinelibrary.wiley.com/doi/abs/10.1002/adma.201803334) — Tancogne-Dejean & Mohr, *Adv. Mater.* 2018 (pmid:30230617)
- [Plate-nanolattices at the theoretical limit of stiffness and strength](https://pmc.ncbi.nlm.nih.gov/articles/PMC7101344/) — *Nat. Commun.* 2020
- [Stiff isotropic lattices beyond the Maxwell criterion](https://pmc.ncbi.nlm.nih.gov/articles/PMC6764834/) — *Sci. Adv.* 2019
- [On the competition for ultimately stiff and strong architected materials](https://arxiv.org/abs/2011.04095) — 강성 vs 좌굴 트레이드오프
- [3D architected isotropic materials with tunable stiffness and buckling strength](https://arxiv.org/abs/2012.01359)
- [Isotropic Metamaterial Stiffness Beyond Hashin-Shtrikman Upper Bound](https://arxiv.org/abs/2411.11332)

**격자 실험 검증**
- [Tuning the mechanical behaviour of additively manufactured metamaterials with twinning and meta-harmonics](https://arxiv.org/abs/2410.07833) — BCC 트위닝, 강성 +162%
- [Impact Absorption Behaviour of 3D-Printed Lattice Structures for Sportswear](https://pmc.ncbi.nlm.nih.gov/articles/PMC12526810/) — RE vs RD, 40% 차이
- [Re-Entrant Plate-Based Lattice Structures](https://pmc.ncbi.nlm.nih.gov/articles/PMC8624896/) — ρ^1.15 ~ ρ^3.59 실측
- [Elastically-isotropic open-cell minimal surface shell lattices with superior stiffness via variable thickness design](https://arxiv.org/abs/2105.03046) — TPMS 등방화
- [Buckling and yield strength estimation of architected materials under arbitrary loads](https://arxiv.org/abs/2105.06161)

**FDM 인필 실험**
- [Effect of Relative Density in In-Plane Mechanical Properties of Common 3D-Printed PLA Lattice Structures](https://pmc.ncbi.nlm.nih.gov/articles/PMC8582052/) — 사각 > 삼각 > 육각
- [A Comprehensive Investigation of Infill Geometry Effects on the Mechanical Performance of Polymer 3D Printed Components](https://pmc.ncbi.nlm.nih.gov/articles/PMC12788003/) — 허니컴 강성 1위, grid 강도 1위
- [On the Behavior of Honeycomb, Grid and Triangular PLA Structures under Symmetric and Asymmetric Bending](https://pmc.ncbi.nlm.nih.gov/articles/PMC9865300/)
- [Bio-Inspired 3D Infill Patterns for Additive Manufacturing (Gyroid, Schwarz D, Schwarz P)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6384811/)
- [Effective Stiffness of FDM Infill Lattice Patterns Made of PLA-Wood Material](https://pmc.ncbi.nlm.nih.gov/articles/PMC8780086/)
- [Material-Efficient Design of 3D-Printed Furniture Connectors: Effects of Perimeter Count and Infill Density](https://doi.org/10.3390/su18147457) — 인필 밀도 무의미, 벽이 지배
- [Effects of Infill Density, Wall Perimeter and Layer Height in Fabricating 3D Printing Products](https://pmc.ncbi.nlm.nih.gov/articles/PMC9867140/)

**샌드위치 구조**
- [Nanocardboard as a nanoscale analog of hollow sandwich plates](https://pmc.ncbi.nlm.nih.gov/articles/PMC6202357/)
- [Ultralight and ultra-stiff nano-cardboard panels](https://arxiv.org/abs/2211.02803)
- [Mechanical Performance Comparison of Sandwich Panels with Graded Lattice and Honeycomb Cores](https://pmc.ncbi.nlm.nih.gov/articles/PMC10887225/)
- [Optimization of a Totally FRP Composite Sandwich Construction of Helicopter Floor](https://pmc.ncbi.nlm.nih.gov/articles/PMC8399855/) — 제약 9개 동시 고려

---

## 10. 정확도 메모

- 1장의 재료 지수 표는 **표준 물성값으로 직접 계산**했다 (강철 E=210 GPa/ρ=7.85, PLA E=3.5 GPa/ρ=1.24 등).
  프린팅된 PLA의 실측 E는 공정·방향에 따라 2~3.5 GPa로 흩어지므로, 표의 PLA 값은 **벌크 상한 기준**이다.
  실제 프린팅 부품은 이보다 불리하게 나온다.
- 2장 형상 계수 최대값(강철 ~60, 알루미늄 ~40)은 Granta/Ashby 방법론 문서 기준이며, 출처에 따라 60~65로 표기가 갈린다.
- 3장의 논문별 수치(3배, +137~522%, 25%/20% 등)는 해당 논문 본문에서 확인했다.
- 4장 FDM 실험값은 각 논문의 특정 프린터·설정 결과이므로 **일반화하면 안 된다.** 논문 간 순위가 실제로 엇갈린다.
- 옥텟 `E = ρ̄Es/9`는 등방 평균 기준 상용값이다. 방향과 절점 모델링에 따라 계수가 달라진다.
