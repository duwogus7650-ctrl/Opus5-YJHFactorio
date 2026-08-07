// ===========================================================================
//  30_power.js — 전력망
//
//  전주끼리 7.5타일 안이면 같은 망. 전주는 자기 중심 5x5 를 공급한다.
//  기계는 자기 타일 중 하나라도 공급구역에 걸치면 그 망에 붙는다.
//
//  만족도 = min(1, 공급 / 수요). 부족하면 모든 기계가 그 비율로 느려진다
//  (Factorio 의 브라운아웃). 제어기가 이 값을 읽어 부하를 차단하는 것이
//  이 게임에서 가장 재미있는 자동화 과제다.
// ===========================================================================

var powerDirty = true;
var netCover = new Int32Array(W * H);   // 0 = 비공급, n>0 = 망 번호 n-1
var nets = [];                          // { supplyCap, demand, sat, gens[], loads }

function markPowerDirty() { powerDirty = true; }

function powerDraw(e) {
  var B = BUILDINGS[e.type];
  if (!B || !B.power) return 0;
  if (!e.enabled) return 0;
  var p = B.power * machinePowerMul;
  switch (e.type) {
    case 'miner':
      if (e.depleted) return 0;
      return invTotal(e.out) >= SPEC.machineBufOut ? 0 : p;
    case 'furnace':
    case 'assembler': {
      var rec = e.recipe ? RECIPES[e.recipe] : null;
      if (!rec) return 0;
      if (e.progress > 0) return p;
      return machineRecipeReady(e, rec) ? p : 0;
    }
    case 'lab': {
      if (!currentResearch) return 0;
      var need = TECHS[currentResearch].cost;
      for (var k in need) if (invCount(e.inv, k) < 1) return 0;
      return p;
    }
    default:
      return p;
  }
}

function rebuildPower() {
  netCover.fill(0);
  nets = [];
  var poles = [];
  forEachEntity(function (e) { if (e.type === 'pole') poles.push(e); });

  // 유니온-파인드로 전주를 묶는다
  var parent = new Int32Array(poles.length);
  for (var i = 0; i < poles.length; i++) parent[i] = i;
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  var reach2 = SPEC.poleReach * SPEC.poleReach;
  for (var a = 0; a < poles.length; a++) {
    for (var b = a + 1; b < poles.length; b++) {
      if (dist2(poles[a].tx, poles[a].ty, poles[b].tx, poles[b].ty) <= reach2) uni(a, b);
    }
  }
  // 루트 → 망 번호
  var rootNet = {};
  for (var p = 0; p < poles.length; p++) {
    var r = find(p);
    if (rootNet[r] === undefined) {
      rootNet[r] = nets.length;
      nets.push({ supplyCap: 0, demand: 0, sat: 1, gens: [], poles: [] });
    }
    poles[p].net = rootNet[r];
    nets[rootNet[r]].poles.push(poles[p]);
  }
  // 공급구역 스탬프
  var S = SPEC.poleSupply;
  for (var q = 0; q < poles.length; q++) {
    var e0 = poles[q];
    for (var y = e0.ty - S; y <= e0.ty + S; y++) {
      for (var x = e0.tx - S; x <= e0.tx + S; x++) {
        if (inBounds(x, y)) netCover[idx(x, y)] = e0.net + 1;
      }
    }
  }
  // 기계를 망에 붙인다
  forEachEntity(function (e) {
    if (e.type === 'pole') return;
    e.net = -1;
    for (var y = e.ty; y < e.ty + e.h && e.net < 0; y++) {
      for (var x = e.tx; x < e.tx + e.w; x++) {
        if (!inBounds(x, y)) continue;
        var c = netCover[idx(x, y)];
        if (c > 0) { e.net = c - 1; break; }
      }
    }
    if (e.net >= 0 && e.type === 'generator') nets[e.net].gens.push(e);
  });
  rebuildWireEdges();
  powerDirty = false;
}

// 그릴 전선 목록 — 도달 범위 안 "모든 쌍"을 그으면 격자 배치에서 대각선까지 이어져
// 화면이 그물이 된다(레퍼런스의 전선은 몇 가닥뿐이다). 망마다 최소신장트리만 남긴다.
// 전기적 연결성은 유니온-파인드가 이미 정했으므로, 여기는 순수하게 표시용이다.
var wireEdges = [];
function rebuildWireEdges() {
  wireEdges = [];
  for (var n = 0; n < nets.length; n++) {
    var ps = nets[n].poles;
    if (ps.length < 2) continue;
    var inTree = [0];
    var rest = [];
    for (var i = 1; i < ps.length; i++) rest.push(i);
    while (rest.length) {
      var bestA = -1, bestB = -1, bestD = Infinity, bestRi = -1;
      for (var r = 0; r < rest.length; r++) {
        for (var t = 0; t < inTree.length; t++) {
          var d = dist2(ps[rest[r]].tx, ps[rest[r]].ty, ps[inTree[t]].tx, ps[inTree[t]].ty);
          if (d < bestD) { bestD = d; bestA = inTree[t]; bestB = rest[r]; bestRi = r; }
        }
      }
      if (bestB < 0) break;
      wireEdges.push([ps[bestA].tx, ps[bestA].ty, ps[bestB].tx, ps[bestB].ty]);
      inTree.push(bestB);
      rest.splice(bestRi, 1);
    }
  }
}

var powerStats = { supply: 0, demand: 0, sat: 1, netCount: 0 };

// 시험 전용 — 전력을 논외로 두고 다른 계통만 재고 싶을 때 켠다.
// 전력 자체는 별도 게이트(brownout / satScalesSpeed / energyBalance / noFuelStops)로
// 진짜 발전기를 놓고 검정하므로, 이 우회로가 전력 검증을 갉아먹지 않는다.
var powerCheatOn = false;

function stepPower(dt) {
  if (powerDirty) rebuildPower();
  // 발전기 부하는 매 틱 0 에서 시작해 아래 망 루프가 다시 채운다.
  // 이 초기화가 없으면 전주를 철거해 망에서 떨어진 발전기가 **마지막 부하율로
  // 영원히 연료를 태우고 오염을 뿜는다** (전기는 아무 데도 안 가는데).
  // 틱 순서가 stepPower → stepEntities 라 연결된 발전기는 같은 틱에 값이 복구된다.
  forEachEntity(function (e) { if (e.type === 'generator') e.load = 0; });
  if (powerCheatOn) {
    var dem = 0;
    forEachEntity(function (e) { e.powerSat = 1; dem += powerDraw(e); });
    powerStats.supply = dem; powerStats.demand = dem; powerStats.sat = 1;
    powerStats.netCount = nets.length;
    return;
  }
  var totSup = 0, totDem = 0;

  for (var n = 0; n < nets.length; n++) {
    var net = nets[n];
    net.supplyCap = 0;
    for (var g = 0; g < net.gens.length; g++) {
      var gen = net.gens[g];
      // 꺼진 발전기는 공급하지 않는다 — 제어기의 가동/정지 노드가 발전기에도 먹혀야
      // "예비 발전기를 필요할 때만 돌린다" 같은 배선이 성립한다.
      if (gen.fuel > 0 && gen.enabled) net.supplyCap += SPEC.genOutput;
    }
    net.demand = 0;
  }
  forEachEntity(function (e) {
    if (e.net < 0 || e.net >= nets.length) { e.powerSat = 0; return; }
    nets[e.net].demand += powerDraw(e);
  });
  for (var n2 = 0; n2 < nets.length; n2++) {
    var nt = nets[n2];
    nt.sat = nt.demand <= 0 ? 1 : Math.min(1, nt.supplyCap / nt.demand);
    // 발전기 부하율 — 연료는 실제로 뽑아 쓴 만큼만 탄다
    var used = Math.min(nt.demand, nt.supplyCap);
    var loadFrac = nt.supplyCap > 0 ? used / nt.supplyCap : 0;
    for (var g2 = 0; g2 < nt.gens.length; g2++) {
      nt.gens[g2].load = (nt.gens[g2].fuel > 0 && nt.gens[g2].enabled) ? loadFrac : 0;
    }
    totSup += nt.supplyCap; totDem += nt.demand;
  }
  forEachEntity(function (e) {
    if (e.type === 'pole' || e.type === 'generator') { e.powerSat = 1; return; }
    var B = BUILDINGS[e.type];
    if (!B || !B.power) { e.powerSat = 1; return; }
    e.powerSat = (e.net >= 0 && e.net < nets.length) ? nets[e.net].sat : 0;
  });

  powerStats.supply = totSup;
  powerStats.demand = totDem;
  powerStats.sat = totDem <= 0 ? 1 : Math.min(1, totSup / totDem);
  powerStats.netCount = nets.length;
  void dt;
}

// 제어기 센서용 — 특정 엔티티가 속한 망의 만족도
function netSatOf(e) {
  if (!e || e.net < 0 || e.net >= nets.length) return 0;
  return nets[e.net].sat;
}
