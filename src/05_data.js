// ===========================================================================
//  05_data.js — 아이템 / 레시피 / 건물 스펙 / 기술트리
//
//  수치 오라클: 처리량·전력·사거리는 Factorio 의 공개 수치를 그대로 가져왔다.
//  임의로 정한 값이 아니므로 사용자가 wiki 와 대조해 검수할 수 있다.
//    · 벨트 1.875 타일/s → 레인당 7.5개/s → 합 15개/s   (yellow transport belt)
//    · 인서터 스윙 1.2s → 0.83개/s, 13 kW              (burner-less inserter)
//    · 채광기 0.5 광석/s, 90 kW                        (electric mining drill)
//    · 제련 3.2s/판, 180 kW                            (시간=stone furnace, 전력=electric furnace)
//    · 조립기 speed 0.75, 155 kW                       (assembling machine 2)
//    · 발전기 900 kW, 석탄 4 MJ → 0.225 석탄/s          (steam engine + 석탄 발열량)
//    · 연구소 60 kW, speed 1.0                         (lab)
//    · 터렛 사거리 18타일, 5 dmg/발, 10발/s             (gun turret + firearm magazine)
//    · 적 체력 소형 15 / 중형 75 / 대형 375             (biter)
//  이 표를 바꾸면 tests/driver.js 의 처리량 게이트가 즉시 어긋난다 — 일부러 그렇게 묶었다.
// ===========================================================================

// --- 아이템 ---------------------------------------------------------------
// shape: 렌더러가 벨트 위 아이템을 그릴 때 쓰는 형태 힌트
var ITEMS = {
  'iron-ore':    { name: '철광석',   color: '#8593a0', shape: 'rock' },
  'copper-ore':  { name: '구리광석', color: '#c87941', shape: 'rock' },
  'coal':        { name: '석탄',     color: '#2b2b30', shape: 'rock' },
  'stone':       { name: '돌',       color: '#a89880', shape: 'rock' },

  'iron-plate':  { name: '철판',     color: '#b8bfc6', shape: 'plate' },
  'copper-plate':{ name: '구리판',   color: '#e08a4a', shape: 'plate' },
  'brick':       { name: '벽돌',     color: '#b06a4a', shape: 'plate' },
  'steel':       { name: '강철',     color: '#8d9aa8', shape: 'plate' },

  'gear':        { name: '톱니',     color: '#7d858d', shape: 'gear' },
  'wire':        { name: '구리선',   color: '#d4732a', shape: 'wire' },
  'circuit':     { name: '회로기판', color: '#4fae5a', shape: 'chip' },

  'belt-item':   { name: '벨트',     color: '#c9a227', shape: 'chip' },
  'inserter-item':{name: '인서터',   color: '#c9a227', shape: 'gear' },
  'ammo':        { name: '탄창',     color: '#c94f3d', shape: 'ammo' },

  'sci-red':     { name: '적색 연구팩', color: '#e0483c', shape: 'flask' },
  'sci-green':   { name: '녹색 연구팩', color: '#49c05a', shape: 'flask' }
};
var ITEM_IDS = Object.keys(ITEMS);

// --- 레시피 ---------------------------------------------------------------
// cat: 'smelt' = 용광로, 'craft' = 조립기, 'hand' 도 가능한 것은 handOk
var RECIPES = {
  'iron-plate':   { cat: 'smelt', time: 3.2, inp: { 'iron-ore': 1 },   out: { 'iron-plate': 1 } },
  'copper-plate': { cat: 'smelt', time: 3.2, inp: { 'copper-ore': 1 }, out: { 'copper-plate': 1 } },
  'brick':        { cat: 'smelt', time: 3.2, inp: { 'stone': 2 },      out: { 'brick': 1 } },
  'steel':        { cat: 'smelt', time: 16,  inp: { 'iron-plate': 5 }, out: { 'steel': 1 }, tech: 'steel' },

  'gear':         { cat: 'craft', time: 0.5, inp: { 'iron-plate': 2 }, out: { 'gear': 1 }, handOk: true },
  'wire':         { cat: 'craft', time: 0.5, inp: { 'copper-plate': 1 }, out: { 'wire': 2 }, handOk: true },
  'circuit':      { cat: 'craft', time: 0.5, inp: { 'iron-plate': 1, 'wire': 3 }, out: { 'circuit': 1 }, handOk: true },

  'belt-item':    { cat: 'craft', time: 0.5, inp: { 'gear': 1, 'iron-plate': 1 }, out: { 'belt-item': 2 }, handOk: true },
  'inserter-item':{ cat: 'craft', time: 0.5, inp: { 'gear': 1, 'circuit': 1, 'iron-plate': 1 }, out: { 'inserter-item': 1 }, handOk: true },
  'ammo':         { cat: 'craft', time: 1.0, inp: { 'iron-plate': 4 }, out: { 'ammo': 1 }, handOk: true, tech: 'military' },

  'sci-red':      { cat: 'craft', time: 5.0, inp: { 'copper-plate': 1, 'gear': 1 }, out: { 'sci-red': 1 }, handOk: true },
  'sci-green':    { cat: 'craft', time: 6.0, inp: { 'belt-item': 1, 'inserter-item': 1 }, out: { 'sci-green': 1 }, handOk: true, tech: 'logistics' }
};
var RECIPE_IDS = Object.keys(RECIPES);

// --- 건물 스펙 -------------------------------------------------------------
// cost: 배치 비용(인벤토리에서 차감).  w/h: 타일 크기.
var BUILDINGS = {
  'belt':      { name: '벨트', w: 1, h: 1, cost: { 'belt-item': 1 }, rot: true,
                 desc: '아이템을 2레인으로 나른다. 합 15개/s (레인당 7.5).' },
  'splitter':  { name: '분배기', w: 2, h: 1, cost: { 'belt-item': 4, 'circuit': 2 }, rot: true, tech: 'logistics',
                 desc: '입력을 두 갈래로 균등 분배. 우선순위 지정 가능.' },
  'inserter':  { name: '인서터', w: 1, h: 1, cost: { 'inserter-item': 1 }, rot: true, power: 13,
                 desc: '뒤에서 집어 앞에 놓는다. 0.83개/s. 제어기로 켜고 끌 수 있다.' },
  'miner':     { name: '채광기', w: 2, h: 2, cost: { 'gear': 5, 'iron-plate': 10 }, rot: true, power: 90,
                 desc: '아래 광맥을 0.5개/s 로 캔다. 출력 방향으로 뱉는다.' },
  'furnace':   { name: '용광로', w: 2, h: 2, cost: { 'brick': 5, 'iron-plate': 5 }, power: 180,
                 desc: '광석을 판으로. 3.2초에 1개.' },
  'assembler': { name: '조립기', w: 3, h: 3, cost: { 'gear': 9, 'circuit': 3, 'iron-plate': 9 }, power: 155,
                 desc: '레시피를 지정해 조립. 제작속도 0.75.' },
  'generator': { name: '발전기', w: 3, h: 3, cost: { 'gear': 8, 'iron-plate': 12, 'brick': 10 },
                 desc: '석탄을 태워 900 kW. 0.225 석탄/s 를 먹는다.' },
  'pole':      { name: '전주', w: 1, h: 1, cost: { 'wire': 2, 'iron-plate': 1 },
                 desc: '5x5 공급, 7.5타일 연결. 전력망은 여기로만 이어진다.' },
  'chest':     { name: '상자', w: 1, h: 1, cost: { 'iron-plate': 8 },
                 desc: '600개 보관. 제어기의 재고 센서가 읽는 대상.' },
  'lab':       { name: '연구소', w: 3, h: 3, cost: { 'gear': 10, 'circuit': 10, 'belt-item': 4 }, power: 60,
                 desc: '연구팩을 소비해 기술을 연다.' },
  // 제어기는 전기를 쓰지 않는다 (Factorio 의 회로망과 같다).
  // 전력을 요구하게 두면 "전력이 부족할 때 부하를 차단하는" 배선이 자기 전원을 끊는
  // 순간 제어기도 죽고, 지배가 풀려 라인이 다시 켜지고, 또 죽는 발진이 된다.
  'controller':{ name: '제어기', w: 2, h: 2, cost: { 'circuit': 5, 'iron-plate': 5 },
                 desc: '★ 공장의 두뇌. 노드 그래프를 직접 배선한다. 클릭해서 편집. 전기를 쓰지 않는다.' },
  'turret':    { name: '기관총 터렛', w: 2, h: 2, cost: { 'gear': 10, 'iron-plate': 20 }, tech: 'military',
                 desc: '사거리 18타일. 탄창을 인서터로 넣어줘야 쏜다.' },
  'wall':      { name: '벽', w: 1, h: 1, cost: { 'brick': 2 }, tech: 'military',
                 desc: '체력 350. 적의 진로를 막는다.' }
};
var BUILD_IDS = Object.keys(BUILDINGS);

// --- 숫자 상수 (오라클) ----------------------------------------------------
var SPEC = {
  beltTilesPerSec: 1.875,     // → 레인당 7.5/s, 합 15/s
  beltSlotGap: 0.25,          // 아이템 최소 간격(타일). 레인당 최대 4개/타일
  inserterSwing: 1.2,         // 왕복 1회 = 1아이템 → 0.8333/s
  minerRate: 0.5,             // 광석/s
  assemblerSpeed: 0.75,
  furnaceSpeed: 1.0,
  labSpeed: 1.0,
  genOutput: 900,             // kW
  coalEnergy: 4000,           // kJ  (4 MJ)
  poleSupply: 2,              // 중심에서 ±2 → 5x5
  poleReach: 7.5,             // 전주끼리 연결되는 거리(타일)
  chestCap: 600,
  machineBufIn: 50,           // 기계 입력 버퍼(품목당)
  machineBufOut: 100,         // 기계 출력 버퍼
  turretRange: 18,
  turretDps: 50,              // 5 dmg x 10발/s
  turretShotsPerAmmo: 10,
  wallHp: 350,
  buildingHpPerTile: 150,
  pollutionPerChunk: 8,       // 오염 격자 한 칸 = 8x8 타일
  researchPerPack: 1
};

// --- 기술트리 --------------------------------------------------------------
// cost 는 연구팩 개수. needs 는 선행 기술.
var TECHS = {
  'logistics':  { name: '물류학', cost: { 'sci-red': 20 }, needs: [],
                  unlock: ['분배기', '녹색 연구팩 레시피'],
                  desc: '분배기와 녹색 연구팩을 연다.' },
  'military':   { name: '군수',   cost: { 'sci-red': 20 }, needs: [],
                  unlock: ['기관총 터렛', '벽', '탄창 레시피'],
                  desc: '방어 시설. 적의 습격은 오염을 따라온다.' },
  'logic-mem':  { name: '논리 II — 기억소자', cost: { 'sci-red': 40 }, needs: ['logistics'],
                  unlock: ['SR 래치', '카운터', '샘플홀드', '엣지검출'],
                  desc: '제어기에 상태를 가진 노드가 추가된다. 여기서부터 진짜 프로그래밍.' },
  'steel':      { name: '강철 제련', cost: { 'sci-red': 50 }, needs: ['logistics'],
                  unlock: ['강철 레시피'],
                  desc: '철판 5개를 강철 1개로.' },
  'logic-ctrl': { name: '논리 III — 공정 제어', cost: { 'sci-red': 50, 'sci-green': 50 }, needs: ['logic-mem'],
                  unlock: ['인서터 필터 출력', '벨트 게이트', 'PID 노드', '부하 차단'],
                  desc: '제어기가 라인을 실시간으로 갈아탈 수 있게 된다.' },
  'defense-ai': { name: '방어 자동화', cost: { 'sci-red': 50, 'sci-green': 50 }, needs: ['military', 'logic-mem'],
                  unlock: ['적 근접 센서', '터렛 사격허가 출력', '경보'],
                  desc: '적의 접근을 신호로 읽어 방어를 자동화한다.' },
  'belt-2':     { name: '고속 벨트', cost: { 'sci-red': 80, 'sci-green': 80 }, needs: ['logistics', 'steel'],
                  unlock: ['벨트 속도 x2'],
                  desc: '모든 벨트가 30개/s 로 빨라진다.' },
  'automation-2':{ name: '생산 효율', cost: { 'sci-red': 100, 'sci-green': 100 }, needs: ['steel', 'logic-ctrl'],
                  unlock: ['기계 속도 +50%', '전력 소비 -20%'],
                  desc: '전 기계가 빨라지고 전기를 덜 먹는다.' }
};
var TECH_IDS = Object.keys(TECHS);

// 연구 규약: cost 의 값은 "연구 사이클 수"이고, 한 사이클마다 나열된 팩을 각각 1개씩
// 먹는다. 그래서 여러 팩이 걸린 기술은 값이 같아야 한다 (Factorio 와 같은 방식).
function techCycles(tid) {
  var c = TECHS[tid].cost, m = 0;
  for (var k in c) if (c[k] > m) m = c[k];
  return m;
}

// --- 적 ------------------------------------------------------------------
var ENEMY_TIERS = [
  { name: '소형', hp: 15,  dmg: 7,  speed: 2.4, r: 0.35, color: '#8a5fc0' },
  { name: '중형', hp: 75,  dmg: 15, speed: 2.2, r: 0.45, color: '#6f4fbf' },
  { name: '대형', hp: 375, dmg: 30, speed: 2.0, r: 0.60, color: '#5238a8' }
];

// 오염 → 진화도. 진화도가 오르면 상위 티어가 섞여 나온다.
function tierMixFor(evo) {
  if (evo < 0.20) return [1.0, 0.0, 0.0];
  if (evo < 0.50) return [0.7, 0.3, 0.0];
  if (evo < 0.75) return [0.4, 0.45, 0.15];
  return [0.15, 0.45, 0.40];
}

// --- 시작 인벤토리 ---------------------------------------------------------
// 첫 채광 라인 한 줄과 발전기 한 대를 세울 수 있을 만큼만 준다.
var START_INV = {
  'iron-plate': 60, 'copper-plate': 30, 'brick': 30, 'gear': 30,
  'wire': 20, 'circuit': 10, 'belt-item': 60, 'inserter-item': 12, 'coal': 50
};
