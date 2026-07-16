// char3 리디자인 v3 — 21프레임 픽셀 원본 데이터 + PNG 빌더
// 시트 규격: 224×192 = 32×64 프레임 × 7열(walk0,walk1,walk2,typing0,typing1,reading0,reading1) × 3행(down,up,right)
// 프레임 캔버스: 논리 행 22~85 (= PNG y 0~63). 발끝 기준선 = 행 85.
// 사용법(ai-office 저장소의 pngjs 이용):
//   node scripts/char3_v3_frames.mjs <출력.png>   (저장소 루트에서 실행 — pngjs는 루트 node_modules 사용)
// Figma 검토본: https://www.figma.com/design/GYMmdU8Mb0Q1rT2f6VAAbj ("char3 스프라이트시트 v3" 컨테이너)

export const PAL = {
  A: '0c0c12',
  B: '1d1d27',
  C: '14141c',
  D: '0f0f16',
  E: '2e2e3c', // 머리(흑발)
  F: 'ffe9dc',
  J: 'e6c6b4',
  K: 'e0bfae',
  N: 'fff8f2',
  P: 'fff3ea',
  Z: 'f7ddcd',
  M: 'ffc4bc', // 피부/볼터치
  G: '000000',
  H: 'ffffff',
  I: '12121c',
  O: '4f4f4f', // 눈/입/윤곽
  Q: 'f4f4f4',
  R: 'dcdcdc', // 흰 셔츠
  S: '8a2440',
  T: '6e1a32',
  V: '4a1122', // 버건디 타이
  W: '0e0e14',
  X: '1e1e26',
  Y: '2c2c38', // 수트(자켓+치마)
  U: '4c4c4c',
  L: '26262e', // 회색/다크 보조
  a: '353535',
  b: '1a1a1a',
  c: '595959', // 부츠
  d: '391624', // 책 표지(버건디)
};

// ── 정면(down) ──────────────────────────────────────────────
const headFront = [
  '..................AA............',
  '.................AAA............',
  '.............AAAAAAB............',
  '...........AAAAAABBB............',
  '...........AAAAAABBBAAA.........',
  '.........AAAAAAABBBBBAAAA.......',
  '.........ABBAAACDCCBBBBAA.......',
  '.......AAABBAADCCCCDBBBBAA......',
  '.......AAEBBAACCCDCCBBBBAA......',
  '......AAEEBBAACDCCCCBBBBAA......',
  '......AAEEBBAACCCCDCBBBBAA......',
  '......AEEBBBACACDCCCBBBBAA......',
  '......EEEBBFCAAACCAAFBBBAA......',
  '......EEBBFGGGGACGGGGFBBAA......',
  '......AACCFGHIGAAGHIGFCCAA......',
  '......AADCFGIIGCAGIIGFCDAA......',
  '......AACCJJGGFFAAGGAACCAA......',
  '......AACCJJKKFFAAKKAACCAA......',
  '......AACCLLMMFFNNFFMMCCAA......',
  '......AACCLLLMOONNOOMMCCAA......',
  '......AADC.LLLPPFFPPLLCDAA......',
  '......AACC..LLPPFFPPLLCCAA......',
  '......AACCHHQQQSSQQQHHCCAA......',
  '......AAACHHQQQTTQQQHHCAAA......',
];
const vRows = [
  '.....WYAAAXXQQQSTQQQXXAAAYW.....',
  '....WWYYAAXXQQQSTQQQXXAAYYWW....',
  '....WWYYYYXXXQQSTQQXXXYYYYWW....',
  '....WWYYYYYXXQQSTQQXXYYYYYWW....',
  '....WWYYYYYYYXXVVXXYYYYYYYWW....',
];
export const down1 = headFront.concat(vRows, [
  '...WWYYYYYYYYYYYYYYYYYYYYYYWW...',
  '...WWYYYYYXXYYYYYYYYXXYYYYYWW...',
  '..WWYYYYYYXXXYYYYYYXXXYYYYYYWW..',
  '..LLFFFFWWYXXYYYYYYXXYWWFFFFLL..',
  '..LLFFFFWWYYXXYYYYXXYYWWFFFFLL..',
  '..LLFFFFWWYYXXYYYYXXYYWWFFFFLL..',
  '..LLFFFFWWYYXYYYYYYXYYWWFFFFLL..',
  '..LLJFFFWWYYYYYYYYYYYYWWFFFJLL..',
  '...LLJFFWWWYYYYYYYYYYWWWFFJLL...',
  '...WWWWWXXXXXXXXXXXXXXXXWWWWW...',
  '.....WWWXXXXXXXXXXXXXXXXWWW.....',
  '........WWXYYYYYYYYYYXWW........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXXXXXXXXXXXXW.........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '.........GaabbGGGGbbaaG.........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaaabGGGGbaaaGG........',
  '........GGcaaaGGGGaaacGG........',
  '.........GGcaGGGGGGacGG.........',
  '.........GGGGGG..GGGGGG.........',
  '...........GG......GG...........',
]);

// 걷기 변형: 좌/우 절반(발)을 2px 들어올림
export function makeWalk(base, side) {
  const rows = base.slice();
  const lo = side === 'L' ? 0 : 16,
    hi = side === 'L' ? 16 : 32;
  for (let i = 0; i < 18; i++) {
    const arr = rows[46 + i].split('');
    let srcRow;
    if (i < 6) srcRow = base[46];
    else if (i < 16) srcRow = base[46 + i + 2];
    else srcRow = null;
    for (let c = lo; c < hi; c++) arr[c] = srcRow ? srcRow[c] : '.';
    rows[46 + i] = arr.join('');
  }
  return rows;
}

// 앉기 공통(정면·뒷모습): 스커트 펼침 + 부츠 앞코
const seatFront = [
  '........WWXYYYYYYYYYYXWW........',
  '.......WXXYYYYYYYYYYYYXXW.......',
  '.......WXYYYYYYYYYYYYYYXW.......',
  '.......WXYYYYYYYYYYYYYYXW.......',
  '.......WXYYYYYYYYYYYYYYXW.......',
  '.......WXXXXXXXXXXXXXXXXW.......',
  '.........GaabbG..GbbaaG.........',
  '.........GaabbG..GbbaaG.........',
  '.........GaabbG..GbbaaG.........',
  '.........GaabbG..GbbaaG.........',
  '.........GGGGGG..GGGGGG.........',
  '...........GG......GG...........',
];
const downTyp0 = headFront.concat(
  vRows,
  [
    '...WWYYYYYYYYYYYYYYYYYYYYYYWW...',
    '...WWYYYYYXXYYYYYYYYXXYYYYYWW...',
    '..WWYYYYYYXXXYYYYYYXXXYYYYYYWW..',
    '..WWYYYYWWYXXYYYYYYXXYWWYYYYWW..',
    '..WWYYYYWWYYXXYYYYXXYYWWYYYYWW..',
    '...WWYYYWWYYXXYYYYXXYYWWYYYWW...',
    '....WWYYWWYFFYYYYYYFFYWWYYWW....',
    '.....WWWWWYFFFYYYYFFFYWWWWW.....',
    '.........YYYYYYYYYYYYYY.........',
  ],
  seatFront,
);
const downTyp1 = headFront.concat(
  vRows,
  [
    '...WWYYYYYYYYYYYYYYYYYYYYYYWW...',
    '...WWYYYYYXXYYYYYYYYXXYYYYYWW...',
    '..WWYYYYYYXXXYYYYYYXXXYYYYYYWW..',
    '..WWYYYYWWYXXYYYYYYXXYWWYYYYWW..',
    '..WWYYYYWWYYXXYYYYXXYYWWYYYYWW..',
    '...WWYYYWWYYXXYYYYXXYYWWYYYWW...',
    '....WWYYWWYYYYYYYYYYYYWWYYWW....',
    '.....WWWWWYFFYYYYYYFFYWWWWW.....',
    '.........YYFFYYYYYYFFYY.........',
  ],
  seatFront,
);
const downRd0 = headFront.concat(
  vRows.slice(0, 4),
  [
    '...WWYYYYYYddddddddddYYYYYYWW...',
    '...WWYYYYYYdHHHHHHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHdHHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHdHHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHdHHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHHHHHHdYYYYYYWW...',
    '....WWYYYYFddddddddddFYYYYWW....',
    '.....WWYYYFFYYYYYYYYFFYYYWW.....',
    '.........YYYYYYYYYYYYYY.........',
    '.........YYYYYYYYYYYYYY.........',
  ],
  seatFront,
);
const downRd1 = headFront.concat(
  vRows.slice(0, 4),
  [
    '...WWYYYYYYddddddddddYYYYYYWW...',
    '...WWYYYYYYdHHHHHHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHHdHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHHdHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHHdHHHdYYYYYYWW...',
    '...WWYYYYYYdHHHHHHHHdYYYYYYWW...',
    '....WWYYYYFddddddddddFYYYYWW....',
    '.....WWYYYFFYYYYYYYYFFYYYWW.....',
    '.........YYYYYYYYYYYYYY.........',
    '.........YYYYYYYYYYYYYY.........',
  ],
  seatFront,
);

// ── 뒷모습(up) ──────────────────────────────────────────────
const headBack = [
  '..................AA............',
  '.................AAA............',
  '.............AAAAAAB............',
  '...........AAAAAABBB............',
  '...........AAAAAABBBAAA.........',
  '.........AAAAAAABBBBBAAAA.......',
  '.........ABBBCCBBBBBBBBAA.......',
  '.......AABBBBCCCCCCBBBBBAA......',
  '.......AAEBBBCCCCCCCBBBBAA......',
  '......AAEEBBBCCCCCCBBBBBAA......',
  '......AAEEBBBCCCCCCBBBBBAA......',
  '......AEEBBBBCCCCCCBBBBBAA......',
  '......AEEBBBBCCCCCCCBBBBAA......',
  '......ABBBBBCCCCCCCCBBBBAA......',
  '......ABBBBBCCCCCCCCBBBBAA......',
  '......ABBEEBCCCCCCCCBEEBAA......',
  '......ABBBBBCCCCCCCCBBBBAA......',
  '......ABBEEBCCCCCCCCBEEBAA......',
  '......ABBBBCCCCCCCCCBBBAA.......',
  '......ABBBBCCCCCCCCCBBBAA.......',
  '.......ABBBCCCCCCCCBBBAA........',
  '.......ABBBCCCCCCCCBBBAA........',
  '.......AABBCCCCCCCCBBAA.........',
  '.......AABBCCCCCCCCBBAA.........',
];
const backTorsoTop = [
  '.....WYYYABCCCCCCCCBAYYYW.......',
  '....WWYYYYABCCCCCCCCBAYYYYWW....',
  '....WWYYYYABCCCCCCCCBAYYYYWW....',
  '....WWYYYYABCCCCCCCCBAYYYYWW....',
  '....WWYYYYABCCECCECCBAYYYYWW....',
  '....WWYYYYABCCCCCCCCBAYYYYWW....',
  '....WWYYYYABCCECCECCBAYYYYWW....',
  '....WWYYYYABCCCCCCCCBAYYYYWW....',
];
export const up1 = headBack.concat(backTorsoTop, [
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '...WFFFFWWABCCCCCCCCBAWWFFFFW...',
  '...WFFFFWWAACCCCCCCCAAWWFFFFW...',
  '....WWWWWWAACCCCCCAAWWWWWW......',
  '...WWWWWXXXXACCAXXXXWWWWW.......',
  '.....WWWXXXXXXAAXXXXXXWWW.......',
  '........WWXYYYYYYYYYYXWW........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXYYYYYYYYYYXW.........',
  '.........WXXXXXXXXXXXXW.........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '..........ZZZZ....ZZZZ..........',
  '.........GaabbGGGGbbaaG.........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaabbGGGGbbaaGG........',
  '........GGaaabGGGGbaaaGG........',
  '........GGcaaaGGGGaaacGG........',
  '.........GGcaGGGGGGacGG.........',
  '.........GGGGGG..GGGGGG.........',
  '...........GG......GG...........',
]);
const upTypArms = [
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
];
const upTypArmsB = [
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '...WWYYWWWABCCCCCCCCBAWWWYYWW...',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
];
const upRdArms = [
  '.WWYYYYWWWABCCCCCCCCBAWWWYYYYWW.',
  '.WWYYYYWWWABCCCCCCCCBAWWWYYYYWW.',
  '..WWYYYWWWABCCCCCCCCBAWWWYYYWW..',
  '..WWYYYWWWABCCCCCCCCBAWWWYYYWW..',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
];
const upRdArmsB = [
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '..WWYYYYWWABCCCCCCCCBAWWYYYYWW..',
  '..WWYYYWWWABCCCCCCCCBAWWWYYYWW..',
  '..WWYYYWWWABCCCCCCCCBAWWWYYYWW..',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
  '....WWWWWWAACCCCCCCCAAWWWWWW....',
];

// ── 측면(right) ─────────────────────────────────────────────
const headSide = [
  '.............AAAAAAA............',
  '...........ABBBBBBBBBA..........',
  '..........ABBEEBBBBBBBA.........',
  '.........ABBEEEBBBBBBBA.........',
  '.........ABBBEEBBBBBBBBA........',
  '.........ABBBBBBBBBBBBCA........',
  '.........ABCBBBBBBBBBBCCA.......',
  '.........ABCBBBBBBBBBCCCA.......',
  '.........AECCBBBBBBBCCCCA.......',
  '.........AECCBBBCCCCCCCCA.......',
  '.........AECCBBCCCCCCCCCA.......',
  '.........AECCBCACFFGGGGFF.......',
  '.........ABCCBCACFFGHIGFF.......',
  '.........ABCCBCACFFGIIGFFF......',
  '.........AECCBCACFFFGGFFFF......',
  '.........AECCBCACMMFFFFF........',
  '.........AECCBCACMMFFKKF........',
  '.........ABCCBCACFFFFFFF........',
  '.........ABCCBCCCFFFFFF.........',
  '.........ABCCBCCCJFFFF..........',
  '.........ABCCBCCCJFFF...........',
  '.........ABCCBCCCFFFF...........',
  '.........ABECBCCCLLLLL..........',
  '.........ABECBCCCLLSSL..........',
];
const sideStandBody = [
  '.........ABECCYYYYYSSQQ.........',
  '.........ABECCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '..........ACCCYXXXXSTQQ.........',
  '..........ACCCYXXXXVQQQ.........',
  '..........ACCCYXXXXYYQQ.........',
  '..........ACCCYWWWWYYQQ.........',
  '...........ACCYFFFFYYQQ.........',
  '...........ACCYFFFFYYQQ.........',
  '...........ACCYFFFFYYQQ.........',
  '............ACYYYYYYYQQ.........',
  '..............XYYYYYYQQ.........',
  '.............WYYYYYYYYYW........',
  '.............WXXXXXXXXXW........',
  '............WXYYYYYYYYXW........',
  '............WXYYYYYYYYXW........',
  '............WXYYYYYYYYXW........',
  '.............WXYYYYYYXW.........',
  '.............WXYYYYYYXW.........',
  '.............WXXXXXXXXW.........',
];
const sideLegs1 = [
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '..............JJJZZZZ...........',
  '.............GbbbGaabG..........',
  '.............GbbbGaabG..........',
  '.............GbbbGaabG..........',
  '.............GbbbGaabG..........',
  '.............GbbbGaabG..........',
  '.............GbbbGaabbG.........',
  '.............GbbbGaabbbG........',
  '.............GbbGGabbbbG........',
  '.............GGGGGGGGGGG........',
];
// 보폭 축소판 (2026-07-12 사용자 피드백: "측면 걷기 보폭 줄여줘")
const sideLegs0 = [
  '..............JJJZZZZ...........',
  '..............JJJ.ZZZZ..........',
  '.............JJJ..ZZZZ..........',
  '.............JJJ..ZZZZ..........',
  '.............JJJ...ZZZZ.........',
  '.............JJJ...ZZZZ.........',
  '............JJJ....ZZZZ.........',
  '............JJJ....ZZZZ.........',
  '...........GbbG...GaabG.........',
  '...........GbbG...GaabG.........',
  '...........GbbG...GaabG.........',
  '...........GbbG...GaabG.........',
  '...........GbbbG..GaabbG........',
  '...........GGGGG..GaabbG........',
  '..................GaabbbG.......',
  '..................GabbbbG.......',
  '..................GGGGGGG.......',
];
const sideLegs2 = [
  '..............JJJZZZZ...........',
  '.............ZZZZ.JJJ...........',
  '.............ZZZZ..JJJ..........',
  '.............ZZZZ..JJJ..........',
  '............ZZZZ...JJJ..........',
  '............ZZZZ...JJJ..........',
  '............ZZZZ....JJJ.........',
  '............ZZZZ....JJJ.........',
  '...........GaabG...GbbG.........',
  '...........GaabG...GbbG.........',
  '...........GaabG...GbbG.........',
  '...........GaabG...GbbG.........',
  '...........GaabbG..GbbbG........',
  '...........GGGGGG..GbbbG........',
  '...................GbbbbG.......',
  '...................GbbbbG.......',
  '...................GGGGGG.......',
];
const sideSitLower = [
  '...........ACCYYYYYYYYY.........',
  '...........ACCWYYYYYYYW.........',
  '...........ACCWXXXXXXXW.........',
  '...........ACCWXYYYYYYYYXW......',
  '............WXYYYYYYYYYYXW......',
  '.............WXYYYYYYYYYXWZZ....',
  '.............WXXXXXXXXXXXWZZ....',
  '........................ZZZZZ...',
  '........................JZZZ....',
  '........................JZZZ....',
  '........................JZZZ....',
  '........................JZZZ....',
  '.......................GaabbG...',
  '.......................GaabbG...',
  '.......................GaabbG...',
  '.......................GaabbbG..',
  '.......................GabbbbbG.',
  '.......................GGGGGGGG.',
];
const sideTyp0Body = [
  '.........ABECCYYYYYSSQQ.........',
  '.........ABECCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXXXXXXW.......',
  '..........ACCCYXXXXXXXXWWFF.....',
  '..........ACCCYYYYYYYYYWWFF.....',
  '..........ACCCYYYYYYYYY.........',
  '..........ACCCYYYYYYYYY.........',
];
const sideTyp1Body = [
  '.........ABECCYYYYYSSQQ.........',
  '.........ABECCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXXXXXXW.......',
  '..........ACCCYXXXXXXXXWW.......',
  '..........ACCCYYYYYYYYYWWFF.....',
  '..........ACCCYYYYYYYYY..FF.....',
  '..........ACCCYYYYYYYYY.........',
];
const sideRd0Body = [
  '.........ABECCYYYYYSSQQ.........',
  '.........ABECCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQdHd.......',
  '.........ABCCCYXXXXSTQdHd.......',
  '..........ACCCYXXXXXXQdHd.......',
  '..........ACCCYXXXXFFQdHd.......',
  '..........ACCCYYYYYYYQdHd.......',
  '..........ACCCYYYYYYYYddd.......',
];
const sideRd1Body = [
  '.........ABECCYYYYYSSQQ.........',
  '.........ABECCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQQ.........',
  '.........ABCCCYXXXXSTQdHd.......',
  '.........ABCCCYXXXXSTQdHd.......',
  '..........ACCCYXXXXFFQdHd.......',
  '..........ACCCYXXXXXXQdHd.......',
  '..........ACCCYYYYYYYQdHd.......',
  '..........ACCCYYYYYYYYddd.......',
];

// ── 21프레임 조립 (각 {start: 시작 논리행, rows} — PNG y = 행-22) ──
export const FRAMES = {
  down: [
    { start: 22, rows: makeWalk(down1, 'L') },
    { start: 22, rows: down1 },
    { start: 22, rows: makeWalk(down1, 'R') },
    { start: 36, rows: downTyp0 },
    { start: 36, rows: downTyp1 },
    { start: 36, rows: downRd0 },
    { start: 36, rows: downRd1 },
  ],
  up: [
    { start: 22, rows: makeWalk(up1, 'L') },
    { start: 22, rows: up1 },
    { start: 22, rows: makeWalk(up1, 'R') },
    { start: 36, rows: headBack.concat(backTorsoTop, upTypArms, seatFront) },
    { start: 36, rows: headBack.concat(backTorsoTop, upTypArmsB, seatFront) },
    { start: 36, rows: headBack.concat(backTorsoTop, upRdArms, seatFront) },
    { start: 36, rows: headBack.concat(backTorsoTop, upRdArmsB, seatFront) },
  ],
  right: [
    { start: 22, rows: headSide.concat(sideStandBody, sideLegs0) },
    { start: 22, rows: headSide.concat(sideStandBody, sideLegs1) },
    { start: 22, rows: headSide.concat(sideStandBody, sideLegs2) },
    { start: 34, rows: headSide.concat(sideTyp0Body, sideSitLower) },
    { start: 34, rows: headSide.concat(sideTyp1Body, sideSitLower) },
    { start: 34, rows: headSide.concat(sideRd0Body, sideSitLower) },
    { start: 34, rows: headSide.concat(sideRd1Body, sideSitLower) },
  ],
};

// ── PNG 빌더 (ai-office의 pngjs 사용) ──
export async function buildPng(outPath) {
  const { createRequire } = await import('module');
  const { writeFileSync } = await import('fs');
  let PNG;
  for (const base of [
    'F:/Projects/ai-office/package.json',
    'F:/Projects/ai-office/core/package.json',
  ]) {
    try {
      PNG = createRequire(base)('pngjs').PNG;
      break;
    } catch {
      /* 다음 후보 */
    }
  }
  if (!PNG) throw new Error('pngjs를 찾을 수 없음 — ai-office 저장소에서 실행하세요');
  const W = 224,
    H = 192,
    FW = 32,
    FH = 64;
  const png = new PNG({ width: W, height: H });
  const dirs = ['down', 'up', 'right'];
  for (let di = 0; di < 3; di++) {
    const frames = FRAMES[dirs[di]];
    for (let fi = 0; fi < 7; fi++) {
      const { start, rows } = frames[fi];
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        if (row.length !== 32)
          throw new Error(`${dirs[di]}[${fi}] 행 길이 ${row.length} (index ${ri})`);
        const y = start - 22 + ri;
        if (y < 0 || y >= FH) throw new Error(`${dirs[di]}[${fi}] 행 범위 초과 y=${y}`);
        for (let x = 0; x < FW; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          const hex = PAL[ch];
          if (!hex) throw new Error(`미정의 팔레트 문자 '${ch}' (${dirs[di]}[${fi}] r${ri}c${x})`);
          const idx = ((di * FH + y) * W + (fi * FW + x)) * 4;
          png.data[idx] = parseInt(hex.slice(0, 2), 16);
          png.data[idx + 1] = parseInt(hex.slice(2, 4), 16);
          png.data[idx + 2] = parseInt(hex.slice(4, 6), 16);
          png.data[idx + 3] = 255;
        }
      }
    }
  }
  writeFileSync(outPath, PNG.sync.write(png));
  return outPath;
}

// CLI: node char3_v3_frames.mjs <출력.png>
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
) {
  const out = process.argv[2] || 'char3_v3.png';
  buildPng(out).then((p) => console.log('생성됨:', p));
}
