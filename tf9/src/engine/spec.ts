/**
 * TF-9 is fictional. Its headline figures follow a modern high-bypass
 * turbofan of the LEAP-1A class (fan 1,981 mm, bypass ratio 11:1,
 * overall pressure ratio 40:1, turbine entry gas around 1,500 °C).
 * Stage counts follow the brief (3 LPC / 5 HPC / 2 HPT / 3 LPT);
 * production engines of this class use about ten HPC stages.
 */

export const N1_RPM_100 = 3900; // LP spool, 100 % N1 (TF-9)
export const N2_RPM_100 = 16400; // HP spool, 100 % N2 (TF-9)

export type Spool = 'LP' | 'HP' | null;

export interface PartSpec {
  name: string;
  ko: string;
  pn: string;
  rows: Array<[string, string]>;
  note: string; // Korean one-liner
}

export const BLADES = {
  fan: 18,
  lpc: [44, 48, 52],
  lpcVanes: [52, 56, 60],
  hpc: [36, 42, 48, 54, 60],
  hpcVanes: [44, 50, 56, 62, 68],
  hptVanes: [22, 26],
  hpt: [46, 52],
  lptVanes: [40, 46, 52],
  lpt: [58, 64, 70],
  fuelNozzles: 20,
  rearStruts: 12,
};

export function specFor(id: string): PartSpec {
  const m = /^(lpc|hpc|hpt|lpt)(\d)$/.exec(id);
  if (m) {
    const kind = m[1] as 'lpc' | 'hpc' | 'hpt' | 'lpt';
    const i = Number(m[2]);
    const n = { lpc: 3, hpc: 5, hpt: 2, lpt: 3 }[kind];
    const blades = BLADES[kind][i - 1];
    const vanes = BLADES[(kind + 'Vanes') as 'lpcVanes'][i - 1];
    const vaneWord = kind === 'hpt' || kind === 'lpt' ? 'NOZZLE VANES' : 'STATOR VANES';
    switch (kind) {
      case 'lpc':
        return {
          name: `LP COMPRESSOR · STAGE ${i}/${n}`, ko: `저압 압축기 ${i}단`, pn: `TF9-72-3${i}0`,
          rows: [['ROTOR BLADES', `${blades}`], [vaneWord, `${vanes}`], ['MATERIAL', 'Titanium alloy'], ['SPOOL', 'LP · N1']],
          note: '팬과 같은 축으로 돌며 코어 공기를 처음 압축합니다.',
        };
      case 'hpc':
        return {
          name: `HP COMPRESSOR · STAGE ${i}/${n}`, ko: `고압 압축기 ${i}단`, pn: `TF9-72-4${i}0`,
          rows: [['ROTOR BLADES', `${blades}`], [vaneWord, `${vanes}${i <= 2 ? ' · variable' : ''}`], ['MATERIAL', i <= 3 ? 'Titanium alloy' : 'Nickel alloy'], ['SPOOL', 'HP · N2']],
          note: i <= 2 ? '앞쪽 정익은 각도가 바뀌는 가변 정익입니다.' : '뒤로 갈수록 공기가 뜨거워져 니켈 합금을 씁니다.',
        };
      case 'hpt':
        return {
          name: `HP TURBINE · STAGE ${i}/${n}`, ko: `고압 터빈 ${i}단`, pn: `TF9-72-5${i}0`,
          rows: [['ROTOR BLADES', `${blades}`], [vaneWord, `${vanes}`], ['MATERIAL', 'Single-crystal Ni superalloy'], ['COOLING', 'Film holes + thermal coating'], ['SPOOL', 'HP · N2']],
          note: '블레이드 속 냉각 공기와 표면 코팅으로 금속을 보호합니다.',
        };
      case 'lpt':
        return {
          name: `LP TURBINE · STAGE ${i}/${n}`, ko: `저압 터빈 ${i}단`, pn: `TF9-72-6${i}0`,
          rows: [['ROTOR BLADES', `${blades} · shrouded tips`], [vaneWord, `${vanes}`], ['MATERIAL', 'Nickel alloy'], ['SPOOL', 'LP · N1']],
          note: '남은 가스 에너지로 저압 축을 돌려 팬을 구동합니다.',
        };
    }
  }
  return FIXED[id] ?? { name: id.toUpperCase(), ko: '', pn: '', rows: [], note: '' };
}

const FIXED: Record<string, PartSpec> = {
  spinner: {
    name: 'SPINNER', ko: '스피너', pn: 'TF9-72-010',
    rows: [['SHELL', 'Composite'], ['FASTENERS', '12'], ['MARKING', 'Spiral rotation cue']],
    note: '나선 무늬로 지상 요원이 회전 여부를 바로 알 수 있습니다.',
  },
  fan: {
    name: 'FAN', ko: '팬', pn: 'TF9-72-100',
    rows: [['BLADES', `${BLADES.fan} · wide-chord`], ['DIAMETER', '1,981 mm'], ['MATERIAL', 'CFRP · Ti leading edge'], ['SPEED', `${N1_RPM_100.toLocaleString('en-US')} rpm at 100 % N1`]],
    note: '흡입 공기의 약 90%를 바이패스로 보내 추력 대부분을 만듭니다.',
  },
  caseUpper: {
    name: 'FAN CASE · UPPER HALF', ko: '팬 케이스 (상부)', pn: 'TF9-72-200U',
    rows: [['SPLIT', 'Horizontal flange'], ['FLANGE BOLTS', '2 × 11'], ['WALL', 'Composite, blade-out containment'], ['INLET LIP', 'Ø 2,120 mm']],
    note: '블레이드가 이탈해도 파편이 밖으로 나가지 않게 막는 케이스입니다.',
  },
  caseLower: {
    name: 'FAN CASE · LOWER HALF', ko: '팬 케이스 (하부)', pn: 'TF9-72-200L',
    rows: [['SPLIT', 'Horizontal flange'], ['FLANGE NUTS', '2 × 11'], ['WALL', 'Composite, blade-out containment'], ['INLET LIP', 'Ø 2,120 mm']],
    note: '상부와 수평 플랜지로 맞물려 하나의 링이 됩니다.',
  },
  combustor: {
    name: 'ANNULAR COMBUSTOR', ko: '환형 연소기', pn: 'TF9-72-500',
    rows: [['FUEL NOZZLES', `${BLADES.fuelNozzles}`], ['IGNITERS', '2'], ['LINER', 'Ni alloy · thermal coating'], ['EXIT GAS', '≈ 1,500 °C']],
    note: '하나의 고리 모양 연소실에서 연료와 압축 공기가 탑니다.',
  },
  nozzle: {
    name: 'EXHAUST NOZZLE', ko: '배기 노즐', pn: 'TF9-72-800',
    rows: [['PARTS', 'Core nozzle · tail cone'], ['REAR FRAME STRUTS', `${BLADES.rearStruts}`], ['MOUNT', 'Aft lugs × 2']],
    note: '코어 배기를 정리해 뒤로 내보내고 엔진 후방 마운트를 겸합니다.',
  },
  lpShaft: {
    name: 'LP SHAFT', ko: '저압 축', pn: 'TF9-72-910',
    rows: [['LINKS', 'Fan + LPC ↔ LPT'], ['ROUTE', 'Inside the HP shaft'], ['SPEED', `${N1_RPM_100.toLocaleString('en-US')} rpm · N1`]],
    note: '고압 축 안을 관통해 저압 터빈의 힘을 팬까지 전달합니다.',
  },
  hpShaft: {
    name: 'HP SHAFT', ko: '고압 축', pn: 'TF9-72-920',
    rows: [['LINKS', 'HPC ↔ HPT'], ['BUILD', 'Hollow drum'], ['SPEED', `${N2_RPM_100.toLocaleString('en-US')} rpm · N2`]],
    note: '속이 빈 축으로, 저압 축을 감싼 채 더 빠르게 돕니다.',
  },
};
