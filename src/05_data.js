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
  // 석유의 두 번째 쓰임 — 가스를 태울 수 있는 덩어리로 굳힌다. 석탄 3개분(12 MJ)이라
  // 석탄 광맥에서 멀어질수록 값이 커진다. 플라스틱과 **같은 가스를 두고 다툰다.**
  'solid-fuel':  { name: '고체 연료', color: '#3a3340', shape: 'rock' },
  'stone':       { name: '돌',       color: '#a89880', shape: 'rock' },

  'iron-plate':  { name: '철판',     color: '#b8bfc6', shape: 'plate' },
  'copper-plate':{ name: '구리판',   color: '#e08a4a', shape: 'plate' },
  'brick':       { name: '벽돌',     color: '#b06a4a', shape: 'plate' },
  'steel':       { name: '강철',     color: '#8d9aa8', shape: 'plate' },

  'gear':        { name: '톱니',     color: '#7d858d', shape: 'gear' },
  'wire':        { name: '구리선',   color: '#d4732a', shape: 'wire' },
  'circuit':     { name: '회로기판', color: '#4fae5a', shape: 'chip' },

  'belt-item':   { name: '벨트',     color: '#c9a227', shape: 'chip' },
  'pipe-item':   { name: '파이프',   color: '#9aa6ae', shape: 'wire' },
  'inserter-item':{name: '인서터',   color: '#c9a227', shape: 'gear' },
  'ammo':        { name: '탄창',     color: '#c94f3d', shape: 'ammo' },

  'sci-red':     { name: '적색 연구팩', color: '#e0483c', shape: 'flask' },
  'sci-green':   { name: '녹색 연구팩', color: '#49c05a', shape: 'flask' },
  // 석유 계통의 산출. 원유·석유가스는 **유체라 아이템이 아니다** — 파이프로만 다닌다.
  'plastic':     { name: '플라스틱',   color: '#d8d2c4', shape: 'plate' }
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
  // 파이프는 철판 하나로 하나 (Factorio 와 같다). 강철 제련을 연구해야 만든다 —
  // 유체 계통 전체가 그 연구 하나에 걸려 있다.
  'pipe-item':    { cat: 'craft', time: 0.5, inp: { 'iron-plate': 1 }, out: { 'pipe-item': 1 }, handOk: true, tech: 'steel' },
  'ammo':         { cat: 'craft', time: 1.0, inp: { 'iron-plate': 4 }, out: { 'ammo': 1 }, handOk: true, tech: 'military' },

  'sci-red':      { cat: 'craft', time: 5.0, inp: { 'copper-plate': 1, 'gear': 1 }, out: { 'sci-red': 1 }, handOk: true },
  'sci-green':    { cat: 'craft', time: 6.0, inp: { 'belt-item': 1, 'inserter-item': 1 }, out: { 'sci-green': 1 }, handOk: true, tech: 'logistics' },

  // **석유의 보상은 탄약이다.** 철판 4개로 탄창 1개를 만들던 것이, 플라스틱을
  // 한 개 섞으면 2개가 된다 — 철 소모가 절반이다. 이 게임에서 철은 모든 것의
  // 상류이고 탄약은 방어의 목이라, 그 둘을 동시에 푸는 것이 석유를 뚫을 이유다.
  // (쓸 데 없는 산출물을 만들지 않는다 — 강철이 그 실수를 한 번 했다.)
  'ammo-plastic': { cat: 'craft', time: 1.0, inp: { 'plastic': 1, 'iron-plate': 4 },
                    out: { 'ammo': 2 }, handOk: true, tech: 'oil' }
};
var RECIPE_IDS = Object.keys(RECIPES);

// --- 연구 효과 배수 -------------------------------------------------------
// **여기가 유일한 출처다.** 예전엔 같은 숫자가 세 군데(연구 완료 · 저장 복원 ·
// 시험용 API)에 따로 적혀 있었다. 하나만 고치면 나머지 둘이 조용히 어긋나고,
// 특히 "저장했다 열면 연구 효과가 사라지는" 형태로 나타난다.
var TECH_EFFECTS = {
  'belt-2':       { belt: 2 },                    // 벨트 15 → 30개/s
  'automation-2': { machine: 1.5, power: 0.8 }    // 기계 1.5배 속도 · 전력 0.8배
};


// --- 건물 스펙 -------------------------------------------------------------
// cost: 배치 비용(인벤토리에서 차감).  w/h: 타일 크기.
var BUILDINGS = {
  'belt':      { hotkey: '1', name: '벨트', w: 1, h: 1, cost: { 'belt-item': 1 }, rot: true,
                 desc: '아이템을 2레인으로 나른다. 합 15개/s (레인당 7.5).' },
  'splitter':  { name: '분배기', w: 2, h: 1, cost: { 'belt-item': 4, 'circuit': 2, 'steel': 2 }, rot: true, tech: 'steel',
                 desc: '입력을 두 갈래로 균등 분배. 우선순위 지정 가능.' },
  'inserter':  { hotkey: '2', name: '인서터', w: 1, h: 1, cost: { 'inserter-item': 1 }, rot: true, power: 13,
                 desc: '뒤에서 집어 앞에 놓는다. 0.83개/s. 제어기로 켜고 끌 수 있다.' },
  'miner':     { hotkey: '3', name: '채광기', w: 2, h: 2, cost: { 'gear': 5, 'iron-plate': 10 }, rot: true, power: 90,
                 takeable: true,   // 인서터가 여기서 물건을 꺼낼 수 있다
                 desc: '아래 광맥을 0.5개/s 로 캔다. 출력 방향으로 뱉는다.' },
  'furnace':   { hotkey: '4', name: '용광로', w: 2, h: 2, cost: { 'brick': 5, 'iron-plate': 5 }, power: 180,
                 takeable: true,   // 인서터가 여기서 물건을 꺼낼 수 있다
                 desc: '광석을 판으로. 3.2초에 1개.' },
  'assembler': { hotkey: '5', name: '조립기', w: 3, h: 3, cost: { 'gear': 9, 'circuit': 3, 'iron-plate': 9 }, power: 155,
                 takeable: true,   // 인서터가 여기서 물건을 꺼낼 수 있다
                 desc: '레시피를 지정해 조립. 제작속도 0.75. 재료는 조립기 안에 들어 있어야 한다 — ' +
                       '인서터로 넣거나 [보유 자재 넣기]로 손수 채운다.' },
  'generator': { hotkey: '6', name: '발전기', w: 3, h: 3, cost: { 'gear': 8, 'iron-plate': 12, 'brick': 10 },
                 desc: '석탄을 태워 900 kW. 0.225 석탄/s 를 먹는다.' },
  'pole':      { hotkey: '7', name: '전주', w: 1, h: 1, cost: { 'wire': 2, 'iron-plate': 1 },
                 desc: '5x5 공급, 7.5타일 연결. 전력망은 여기로만 이어진다.' },
  'chest':     { hotkey: '8', name: '상자', w: 1, h: 1, cost: { 'iron-plate': 8 },
                 desc: '600개 보관. 제어기의 재고 센서가 읽는 대상. 여기 든 것은 세계에 있는 물건이라 ' +
                       '우측 [보유 자재]와 다르다 — 쓰려면 [보유 자재로 가져오기]를 눌러 꺼낸다.' },
  'lab':       { hotkey: '9', name: '연구소', w: 3, h: 3, cost: { 'gear': 10, 'circuit': 10, 'belt-item': 4 }, power: 60,
                 desc: '연구팩을 소비해 기술을 연다.' },
  // 제어기는 전기를 쓰지 않는다 (Factorio 의 회로망과 같다).
  // 전력을 요구하게 두면 "전력이 부족할 때 부하를 차단하는" 배선이 자기 전원을 끊는
  // 순간 제어기도 죽고, 지배가 풀려 라인이 다시 켜지고, 또 죽는 발진이 된다.
  'controller':{ hotkey: '0', name: '제어기', w: 2, h: 2, cost: { 'circuit': 5, 'iron-plate': 5 },
                 desc: '★ 공장의 두뇌. 노드 그래프를 직접 배선한다. 클릭해서 편집. 전기를 쓰지 않는다.' },
  'turret':    { name: '기관총 터렛', w: 2, h: 2, cost: { 'gear': 10, 'iron-plate': 20 }, tech: 'military',
                 desc: '사거리 18타일. 탄창을 인서터로 넣어줘야 쏜다.' },
  'wall':      { name: '벽', w: 1, h: 1, cost: { 'brick': 2 }, tech: 'military',
                 desc: '체력 350. 적의 진로를 막는다.' },

  // --- 유체 계통 (강철 제련으로 함께 열린다) --------------------------------
  // fluid: true 인 건물은 맞닿으면 한 유체망이 된다 (32_fluid.js).
  // **새 기술을 만들지 않았다** — clear.js 가 "연구 8종 = 410 사이클"을 오라클로
  // 쓰고 있어서, 9번째 기술은 자력완주 주행의 기준식을 통째로 흔든다.
  'pipe':      { name: '파이프', w: 1, h: 1, cost: { 'pipe-item': 1 }, tech: 'steel', fluid: true,
                 desc: '유체를 잇는다. 맞닿은 파이프·설비가 한 망이 된다. 한 칸에 100 저장.' },
  // 지하수 펌프 — 어디에나 선다. Factorio 의 offshore pump 는 물가에만 서지만,
  // 이 게임에는 물 지형이 없다. 넣어 봤다가 되돌렸다: 시험 리그들이 고정 좌표에
  // 짓는데(스폰에서 최대 85타일) 호수가 그 자리를 덮으면 배치가 실패해 드라이버가
  // 통째로 죽는다. 물가 배치 퍼즐은 이 게임이 얻으려던 것(증기 버퍼로 깊어지는
  // 제어 문제)과 무관해서, 지형 대신 규칙을 단순화했다. 자세한 것은 원장.
  'pump':      { name: '지하수 펌프', w: 1, h: 1, cost: { 'circuit': 1, 'gear': 1, 'pipe-item': 1 },
                 tech: 'steel', fluid: true,
                 desc: '땅에서 물을 1200/s 퍼 올린다. 전기를 쓰지 않는다 — 정전이 물까지 끊으면 ' +
                       '스스로 못 살아나는 고장이 된다.' },
  'boiler':    { name: '보일러', w: 2, h: 2, cost: { 'pipe-item': 4, 'brick': 5, 'iron-plate': 4 },
                 tech: 'steel', fluid: true,
                 desc: '석탄을 태워 물 60/s 를 증기 60/s 로. 1.8 MW 를 먹는다 — 증기기관 2대분.' },
  // --- 철도 (강철 제련으로 함께 열린다) --------------------------------------
  'rail':      { name: '레일', w: 1, h: 1, cost: { 'steel': 1, 'stone': 1 }, tech: 'steel',
                 desc: '열차가 다니는 길. 맞닿은 레일이 이어진다 — 직각 코너까지 된다.' },
  'station':   { name: '역', w: 1, h: 1, cost: { 'steel': 2, 'circuit': 2, 'iron-plate': 5 }, tech: 'steel',
                 desc: '레일 옆에 세운다. 열차가 여기 서고, 인서터로 싣고 내린다. ' +
                       '제어기의 [열차 출발]을 물리면 배차를 회로로 정할 수 있다.' },
  'train':     { name: '열차', w: 1, h: 1, cost: { 'steel': 10, 'gear': 10, 'circuit': 4 }, tech: 'steel',
                 onRail: true,
                 desc: '★ 레일 위에 놓는다. 역을 순서대로 돌며 2000개까지 나른다. ' +
                       '8 타일/s — 벨트보다 4배 빠르다.' },
  // 저장 탱크 — **버퍼를 얼마나 둘 것인가를 플레이어의 설계 결정으로 만든다.**
  // 파이프 한 칸이 100 인데 탱크는 25,000 이다(Factorio 저장 탱크의 공개값). 파이프
  // 250칸어치라, 증기 60/s 를 쓰는 보일러 기준으로 **7분 가까운 완충**이 생긴다.
  // 이 게임에서 버퍼는 편의가 아니라 제어 문제의 깊이다 — 완충이 크면 "마르기 전에
  // 끄기"의 여유가 늘고, 작으면 제어기가 더 빨리 반응해야 한다.
  'tank':      { name: '저장 탱크', w: 3, h: 3, cost: { 'iron-plate': 20, 'steel': 5 },
                 tech: 'steel', fluid: true,
                 desc: '유체를 25,000 까지 담는다 — 파이프 250칸어치. 망에 붙이면 남을 때 채우고 ' +
                       '모자랄 때 내준다. 완충이 크면 제어기가 늦게 반응해도 되고, 작으면 빨라야 한다.' },
  // 이송 펌프 — **두 망을 잇지 않고 옮긴다.** 파이프로 이으면 그 순간 한 망이 되어
  // "저쪽이 찰 때까지 이쪽을 비운다" 같은 것을 할 수 없다. 이 펌프는 뒤쪽 망에서
  // 빨아 앞쪽 망으로 밀되 **두 망은 끝까지 남남**이다 — 그래서 제어기가 '언제 옮길지'
  // 를 정할 수 있고, 그것이 이 건물이 여는 새 결정이다.
  // 200/s 는 Factorio pump 의 공개값이다.
  'xpump':     { name: '이송 펌프', w: 1, h: 1, cost: { 'pipe-item': 2, 'circuit': 1, 'gear': 2 },
                 tech: 'steel', fluid: true, xfer: true, rot: true, power: 30,
                 desc: '★ 방향이 있다. 뒤쪽 망에서 앞쪽 망으로 200/s 옮긴다. 두 망은 안 합쳐진다 — ' +
                       '제어기로 끄면 그 자리에서 멈춘다.' },
  // --- 석유·화학 (석유 처리 연구로 열린다) -----------------------------------
  // 사슬: 원유 광맥 → 펌프잭(원유) → 정제소(석유가스) → 화학공장(플라스틱).
  // 앞의 둘은 유체만 다루고, 화학공장만 고체를 뱉는다 — 그래서 벨트는 여기서 시작한다.
  'pumpjack':  { name: '펌프잭', w: 3, h: 3, cost: { 'steel': 5, 'gear': 10, 'circuit': 5, 'pipe-item': 4 },
                 tech: 'oil', fluid: true, power: 90,
                 desc: '원유 광맥 위에 놓는다. 원유를 10/s 뽑아 파이프로 보낸다.' },
  'refinery':  { name: '정제소', w: 3, h: 3, cost: { 'steel': 10, 'circuit': 10, 'gear': 10, 'pipe-item': 10 },
                 tech: 'oil', fluid: true, power: 420,
                 desc: '원유 20/s 를 중유 6 · 경유 6 · 가스 8 로 쪼갠다(합은 그대로다). 셋 중 한 출구만 막혀도 전부 선다. 420 kW 를 먹는다.' },
  'chemplant': { name: '화학공장', w: 3, h: 3, cost: { 'steel': 5, 'circuit': 5, 'gear': 5, 'pipe-item': 5 },
                 tech: 'oil', fluid: true, power: 210,
                 takeable: true,   // 인서터가 여기서 물건을 꺼낼 수 있다
                 desc: '석유가스 10/s 를 플라스틱 1개/s 로. 경유 10 으로도 고체 연료 1개/s 를 만든다. 남는 중유·경유는 분해해 아래로 흘려보낸다. 인서터로 빼낸다.' },
  'engine':    { name: '증기기관', w: 3, h: 2, cost: { 'gear': 8, 'iron-plate': 10, 'pipe-item': 5 },
                 tech: 'steel', fluid: true,
                 desc: '증기 30/s 로 900 kW. 발전기와 같은 출력인데 석탄을 직접 안 먹는다 — ' +
                       '보일러 1대가 2대를 먹이고, 파이프에 고인 증기가 완충 역할을 한다.' }
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
  // 유체 — 전부 Factorio 공개값. 이 넷은 서로 묶여 있다:
  //   보일러 1800 kW ÷ 60 증기/s = 30 kJ/증기 = 900 kW ÷ 30 증기/s
  // 즉 **증기 1개 = 30 kJ** 이 양쪽에서 같게 나온다. 하나만 바꾸면 에너지수지
  // 게이트가 즉시 어긋난다 — 일부러 그렇게 묶어 놨다.
  pumpRate: 1200,             // 물/s  (offshore pump)
  boilerFluid: 60,            // 물/s → 증기/s  (boiler)
  boilerPower: 1800,          // kW    (boiler, 연료 소비)
  engineSteam: 30,            // 증기/s (steam engine)
  engineOutput: 900,          // kW    (steam engine)
  fluidPerTile: 100,          // 한 칸이 담는 유체 (pipe)
  tankCap: 25000,             // 저장 탱크 하나 (Factorio storage tank)
  xpumpRate: 200,             // 유체/s  (Factorio pump — 망 사이 이송)
  // 석유 — Factorio 공개값을 이 게임의 배율(초당)로 옮긴 값이다.
  pumpjackRate: 10,           // 원유/s  (Factorio pumpjack 은 광맥 수율에 비례하지만
                              //  이 게임은 광맥 수율 개념이 없어 고정값으로 둔다)
  refineryIn: 20,             // 원유/s — 정제소가 한 번에 받는 양
  // **정제소는 셋을 동시에 낸다.** 합이 들어간 원유와 같다(20 = 6+6+8) — 정제는
  // 쪼개는 일이지 만드는 일이 아니다. 그래서 '나온 것의 합 = 들어간 것' 이 이 계의
  // 보존량이고, 게이트가 그것으로 검산한다. 비율 30:30:40 은 Factorio 기본 석유 처리다.
  //
  // 이 셋이 이 게임에서 제어기가 **꼭 필요해지는 자리**를 만든다: 세 출구 중 하나만
  // 차도 정제소 전체가 멈춘다. 중유만 쌓여도 가스가 끊긴다 — 남는 것을 분해로
  // 흘려보내야 하고, 언제 얼마나 흘릴지는 회로가 정한다.
  refineryHeavy: 6,           // 중유/s
  refineryLight: 6,           // 경유/s
  refineryGas: 8,             // 석유가스/s
  // 분해(cracking) — **공짜가 아니다.** 아래로 내려갈수록 부피가 준다.
  // 4→3(75%), 3→2(67%). 손실이 없으면 '항상 분해' 가 늘 옳아서 결정이 사라진다.
  crackHeavyIn: 4,            // 중유/s  →
  crackHeavyOut: 3,           //   경유/s
  crackLightIn: 3,            // 경유/s  →
  crackLightOut: 2,           //   석유가스/s
  chemGasPerPlastic: 10,      // 플라스틱 1개당 석유가스 (Factorio 는 20 가스 → 2 플라스틱)
  chemPlasticRate: 1,         // 플라스틱/s
  // 고체 연료 — 석탄(4 MJ)의 정확히 3배로 둔다. 배수가 정수라 철거 환급을
  // 석탄으로 돌려줘도 에너지가 어긋나지 않는다(어긋나면 그 자리가 이득 구멍이 된다).
  solidFuelEnergy: 12000,     // kJ (12 MJ)
  chemGasPerFuel: 20,         // 고체연료 1개당 석유가스
  chemFuelRate: 0.5,          // 고체연료/s
  // **경유로 만들면 두 배 낫다.** 가스는 플라스틱에도 쓰이므로 연료로 태우는 것이
  // 아깝고, 경유는 분해해서 가스로 만들 수도 있다 — 그 둘 사이의 저울질이 이 층의
  // 결정이다. 경유를 태우는 쪽이 유리해야 저울이 한쪽으로 기울지 않는다.
  lightPerFuel: 10,           // 고체연료 1개당 경유
  chemFuelLightRate: 1,       // 고체연료/s (경유로 만들 때)
  // 기차 — **설계값이다.** Factorio 기관차 최고속도는 82 타일/s 인데 이 맵은 한 변이
  // 160타일이라 그대로 쓰면 2초에 횡단한다. 8 타일/s 면 횡단에 20초 — 벨트(1.875)보다
  // 4.3배 빠르고, 먼 광맥을 쓸 이유가 되면서 화면에서 눈으로 따라갈 수 있다.
  trainSpeed: 8,              // 타일/s
  trainCargoCap: 2000,        // 화차 한 칸 (상자 600의 3.3배 — 한 번에 옮길 값이 있어야 한다)
  trainDwell: 5,              // 정차 후 자동 출발까지(초). 제어기가 물리면 그쪽이 이긴다
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
                  unlock: ['녹색 연구팩 레시피'],
                  desc: '녹색 연구팩을 연다 — 여기서부터 완성품이 연구 재료가 된다.' },
  'military':   { name: '군수',   cost: { 'sci-red': 20 }, needs: [],
                  unlock: ['기관총 터렛', '벽', '탄창 레시피'],
                  desc: '방어 시설. 적의 습격은 오염을 따라온다.' },
  'logic-mem':  { name: '논리 II — 기억소자', cost: { 'sci-red': 40 }, needs: ['logistics'],
                  unlock: ['SR 래치', '카운터', '엣지 검출', '샘플 홀드', '최고·최저 기록', '지속 조건', '상태기계 (4단계)'],
                  desc: '제어기에 상태를 가진 노드가 추가된다. 여기서부터 진짜 프로그래밍.' },
  // 강철은 **쓸 데가 있어야 한다.** 예전엔 레시피만 있고 소비처가 한 곳도 없어서,
  // 적팩 50개를 들여 "철판 5개를 못 쓰는 물건 1개로 바꾸는 기능"을 여는 연구였다.
  // 분배기를 여기로 옮겨 붙였다 — belt-2·automation-2 의 선행이라 어차피 모두
  // 연구하는 길목이고, 분배기는 없어도 죽지 않는 편의 장비라 늦춰도 초반이 안 무너진다.
  'steel':      { name: '강철 제련', cost: { 'sci-red': 50 }, needs: ['logistics'],
                  unlock: ['분배기', '파이프', '지하수 펌프', '보일러', '레일', '역', '열차', '저장 탱크', '이송 펌프', '증기기관', '강철 레시피', '파이프 레시피', '유체 잔량', '역 상태', '열차 출발'],
                  desc: '철판 5개를 강철 1개로. **유체 계통(파이프·펌프·보일러·증기기관·탱크)과 열차 계통(레일·역·열차)이 전부 여기서 열린다** — 게임의 절반이 이 연구 뒤에 있다. 분배기도.' },
  'logic-ctrl': { name: '논리 III — 공정 제어', cost: { 'sci-red': 50, 'sci-green': 50 }, needs: ['logic-mem'],
                  unlock: ['신호 받기', '평활 필터', '변화율', 'PID 제어', '벨트 게이트', '인서터 필터', '신호 보내기'],
                  desc: '제어기가 라인을 실시간으로 갈아탈 수 있게 된다.' },
  'defense-ai': { name: '방어 자동화', cost: { 'sci-red': 50, 'sci-green': 50 }, needs: ['military', 'logic-mem'],
                  unlock: ['적 근접', '터렛 사격허가'],
                  desc: '적의 접근을 신호로 읽어 방어를 자동화한다.' },
  'belt-2':     { name: '고속 벨트', cost: { 'sci-red': 80, 'sci-green': 80 }, needs: ['logistics', 'steel'],
                  unlock: ['벨트 속도 x2'],
                  desc: '모든 벨트가 30개/s 로 빨라진다.' },
  'oil':        { name: '석유 처리', cost: { 'sci-red': 60, 'sci-green': 60 }, needs: ['steel', 'logistics'],
                  unlock: ['펌프잭', '정제소', '화학공장', '탄창 레시피'],
                  desc: '원유를 뽑아 플라스틱까지. 플라스틱을 섞으면 탄창이 철판 4개에 2개 나온다 — 철이 절반이다.' },
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
  'wire': 20, 'circuit': 10, 'belt-item': 60, 'inserter-item': 12, 'coal': 50, 'solid-fuel': 50
};
