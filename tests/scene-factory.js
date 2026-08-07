// 촬영용 표준 장면 — "돌아가는 공장 한 판".
// shots.py(Edge)와 pwshot.js(Firefox/WebKit/Chromium)가 **같은 파일**을 읽는다.
// 엔진별로 장면을 따로 두면 그림이 달라도 엔진 탓인지 장면 탓인지 구분할 수 없다.
//
// 배치 규약: 전주는 5의 배수 격자점에만. 건물은 5k+1 에서 시작해 3칸 이하로 뻗으므로
// 격자점을 절대 밟지 않는다 (안 지키면 3x3 이 전주와 겹쳐 조용히 배치에 실패한다).
var G = window.__GAME;
G.reset(424242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
G.ui.closeHelp();
for (var y = 70; y <= 90; y += 5) for (var x = 70; x <= 95; x += 5) G.place('pole', x, y, 0);
var g = G.place('generator', 81, 86, 0); G.setFuel(g, 4000 * 600);

// 제련 라인: 상자 → 인서터 → 용광로 → 인서터 → 벨트 → 인서터 → 상자
var src = G.place('chest', 68, 71, 0); G.fillChest(src, 'iron-ore', 600);
G.place('inserter', 69, 71, 1);
G.place('furnace', 70, 71, 1);
G.place('inserter', 72, 71, 1);
for (var i = 0; i < 12; i++) G.place('belt', 73 + i, 71, 1);
G.place('inserter', 85, 71, 1);
G.place('chest', 86, 71, 0);

// 조립 라인
var src2 = G.place('chest', 68, 76, 0); G.fillChest(src2, 'iron-plate', 900);
G.place('inserter', 69, 76, 1);
var a1 = G.place('assembler', 70, 76, 1); G.setRecipe(a1, 'gear');
G.place('inserter', 73, 76, 1);
for (var j = 0; j < 11; j++) G.place('belt', 74 + j, 76, 1);
G.place('inserter', 85, 76, 1);
G.place('chest', 86, 76, 0);

// 채광 라인 — 스폰 근처 철광맥
var sp = G.oreSpotNear('iron-ore', 84, 84);
if (sp) { G.place('pole', 90, 85, 0); G.place('miner', sp.x, sp.y, 1); }

// 연구소 + 제어기
var lab = G.place('lab', 70, 81, 1); G.fillChest(lab, 'sci-red', 60);
G.setResearch('logistics');
G.place('controller', 76, 81, 0);

// 방어
G.research('military');
var t1 = G.place('turret', 88, 81, 1); G.setAmmo(t1, 120);
for (var w = 0; w < 10; w++) G.place('wall', 93, 74 + w, 0);
G.spawnEnemyAt(97, 76, 0); G.spawnEnemyAt(98, 80, 1); G.spawnEnemyAt(96, 83, 0);
G.run(45);
G.center(80, 78); G.setZoom(1.15);
G.ui.refresh(); G.render();
