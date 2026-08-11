// ===========================================================================
//  자력 완주 — 게임의 모든 기능을 실제로 써서 끝까지 간다
//
//  play.js(30분 소크)와 다른 점: 저기는 "공장이 돌고 습격을 막는가" 를 봤고,
//  여기는 **모든 기능을 빠짐없이 쓰는가** 를 본다. 안 써 본 기능은 안 깨진
//  기능이 아니라 **아직 안 들킨 기능**이다.
//
//  완주 조건 (전부 세계 상태로 판정한다):
//    · 연구 8종 전부 완료 (실제로 연구소를 돌려서)
//    · 건물 13종 전부 배치해 각자 제 일을 함
//    · 노드 29종 전부를 살아 있는 회로에 써서 세계를 움직임 (종류가 늘면 이 줄이 아니라
//      G.nodeKinds() 가 기준이다 — 검사는 그쪽을 본다)
//    · 심화 튜토리얼 9단계 전부 통과 (건너뛰기 없이 세계 상태로)
//    · 습격을 막아냄 (손실 0)
//
//  규율: 배치·연구·배선 실패를 삼키지 않는다. 이상한 것은 FAIL 로 낸다.
//
//  ── 이 판의 설계 (2026-08 재작성) ────────────────────────────────────────
//  예전 판은 **고정 시각에 고정 규모**를 지었다. G.place 가 공짜였을 때는 그게
//  통했지만, G.build 로 바꿔 재료를 진짜 내게 되자 통째로 무너졌다(실측: 40분에
//  용광로 1대·철판 0개·연구 0종·전력 만족도 0%). 시각으로는 공장 크기를 살 수
//  없다 — **번 만큼만 지어진다.**
//
//  그래서 셋을 바꿨다:
//   1. 계획을 우선순위 목록으로 두고 **살 수 있을 때 순서대로** 짓는다(runJobs).
//      재료가 모자라면 그 자리에서 줄이 선다 — 뒤엣것이 새치기하지 않는다.
//   2. 좌표를 손으로 안 찍는다. 구역(사각형)과 광맥 질의로 **자리를 그때 찾는다**.
//      고정 좌표는 확장할 때마다 서로 밟았다('이미 뭔가 있다' 배치 실패 3건).
//   3. 발전기는 계획이 아니라 **수요를 보고 자란다**(autoGen). 전주는 격자로 먼저
//      깔고, 새 전주는 **기존 망에 닿는 자리에만** 세운다 — 안 그러면 발전기 없는
//      섬 전력망이 생겨 만족도가 조용히 0 이 된다.
// ===========================================================================
(function () {
  var checks = [];
  function chk(name, ok, detail, expectFail) {
    checks.push({ name: name, ok: !!ok, detail: String(detail), expectFail: !!expectFail });
  }
  function emit(o) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(o) + '@@JSON_END@@';
  }
  var G, out = { checks: checks, errors: [], fatal: null, notes: [],
                 measured: {}, timeline: [], fails: [] };
  var SEED = 424242;
  var qs = new URLSearchParams(location.search);
  var SPEED = +(qs.get('speed') || 12);
  var END_T = +(qs.get('mins') || 40) * 60;
  // **연출과 측정을 갈라 놓는다.** 전투가 붙으면 1배속으로 떨어뜨려 사람이 볼 수
  // 있게 하는 기능인데, 공장이 커지면 전투가 상시라 측정 주행 전체가 실시간으로
  // 기어 40분이 걸리고 타임아웃에 죽는다(실측: 결과 없이 exit=2).
  // 녹화(record.js)에서만 켠다. 시뮬레이션 내용은 배속과 무관하게 같다(고정 스텝).
  var CINEMA = qs.get('cine') === '1';

  // --- 지도 상수 -------------------------------------------------------------
  // 스폰 (80,80) 둘레에 광맥 4종이 깔린다(10_world.js 의 startRing):
  //   철 ~(91,73) · 구리 ~(75,93) · 석탄 ~(69,75) · 돌 ~(86,66)
  // 전부 반경 18 안이므로 **건물은 반경 22 안에만** 두고 터렛 고리를 26 에 둔다.
  // 그래야 밖에서 오는 적이 건물보다 터렛을 먼저 만난다 — 순서가 뒤집히면
  // 바깥에 삐져나온 발전기 한 대가 매 파도의 첫 표적이 된다.
  var CX = 80, CY = 80;
  // **공장이 앉을 수 있는 반경.** 22 로 두었더니 자재보다 자리가 먼저 막혔다 —
  // 조립기 구역이 꽉 차 계획의 녹팩 조립기가 밀리고(배치 실패), 톱니 조립기를
  // 늘릴 자리도 없었다. 안쪽 터렛 고리는 반경 12~13 에 사거리 18 이라 반경 30 까지
  // 덮으므로, 25 까지는 방어 밖으로 나가지 않는다.
  var IN_R = 25;
  // **고리 기하는 건드리지 않는다.** 남은 손실 1건이 바깥에 혼자 선 터렛이라
  // (turret@101,65) 두 가지를 시도했는데 둘 다 더 나빴다:
  //   안쪽 대각선 4자리 추가 → 초반 자재를 더 먹어 증기·철도·제어기가 밀리고
  //                            습격 26 → 47 회, 손실 3, 노드 커버리지 32 → 28
  //   바깥 반경 26 → 20      → 터렛 자리가 공장 영역과 겹쳐 배치가 서로 밀어내고
  //                            노드 26/32, 열차는 아예 못 움직였다
  // 이 판의 좌표들은 서로 맞물려 있어서, 고리를 옮기면 공장 배치가 통째로 흔들린다.
  var RING_R = 26, RING_N = 20;

  var WANT = {};                     // 기계 id -> 의도한 레시피
  // 주의: 여기 안에서는 **G.setRecipe** 를 부른다. 일괄 치환으로 setR 이 자기 자신을
  // 부르게 됐던 자리다 (스택 오버플로로 '철' 단계가 통째로 죽었다).
  function setR(id, rid) { if (id && rid) { G.setRecipe(id, rid); WANT[id] = rid; } return id; }

  // 이 판에서 실제로 쓴 것들 — 완주 판정의 근거
  var usedNodes = {}, usedBuildings = {}, ctrlIds = [];
  function markNode(k) { usedNodes[k] = (usedNodes[k] || 0) + 1; }
  // **'썼다'는 배치한 순간의 사실이다.** 예전엔 끝난 시점의 생존 건물을 셌는데,
  // 그러면 적에게 부서진 종류가 '안 써 봤다'로 뒤집혀 방어 실패가 기능 커버리지
  // 판정을 오염시킨다(실측: 13/13 → 1/13). 부서진 것은 defenseHeld 가 따로 잰다.
  // 잠재수요(POT)와 발전 용량(SUPCAP)을 배치하는 순간 갱신한다. 사이클 단위로만
  // 재면 한 사이클에 기계를 여러 대 세워 놓고 다음 사이클에야 모자란 걸 알아채
  // 그 사이 만족도가 꺼진다(실측: 수요 1800 vs 공급 900, 만족도 50%).
  var POT = 0, SUPCAP = 0;
  function markBuilt(t) {
    usedBuildings[t] = (usedBuildings[t] || 0) + 1;
    var bi = G.buildingInfo(t);
    if (bi && bi.power) POT += bi.power;
    if (t === 'generator') SUPCAP += 900;
  }

  function note(m) { out.timeline.push({ t: Math.round(G.state().t), msg: m }); }
  function look(x, y, z) { G.setCamera(x, y, z); }

  // --- 배치 기본기 -----------------------------------------------------------
  // 비용·기술을 **먼저** 본다. 그래야 "자리를 못 찾았다" 가 진짜 자리 문제라는
  // 뜻이 된다 — 예전엔 재료 부족과 자리 충돌을 사유 문자열로 되짚다가 배치 실패를
  // 오분류했다(재료 부족은 대기이지 실패가 아니다).
  function invNow() { return G.state().inventory; }
  function afford(type) {
    var bi = G.buildingInfo(type); if (!bi) return false;
    var inv = invNow();
    for (var k in bi.cost) if ((inv[k] || 0) < bi.cost[k]) return false;
    return true;
  }
  function techOk(type) {
    var bi = G.buildingInfo(type); if (!bi) return false;
    return !bi.tech || G.state().research.done.indexOf(bi.tech) >= 0;
  }
  function researched(t) { return G.state().research.done.indexOf(t) >= 0; }
  function far(x, y, R) { var dx = x - CX, dy = y - CY; return dx * dx + dy * dy > R * R; }

  // 나선 탐색 — (ax,ay) 에서 링을 넓혀 가며 처음 서는 자리에 짓는다.
  function spiral(type, ax, ay, dir, R) {
    var d = (dir === undefined) ? 0 : dir;
    for (var r = 0; r <= R; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var id = G.build(type, ax + dx, ay + dy, d);
          if (id) { markBuilt(type); ensureNet(id); return id; }
        }
      }
    }
    return null;
  }
  // 사각형 구역을 훑어 첫 빈 자리에 짓는다. rc = [x0,y0,x1,y1,maxR]
  // 좌표를 손으로 찍으면 확장할 때마다 서로 밟는다 — 구역만 정하고 자리는 맡긴다.
  //
  // **전기를 쓰는 건물은 이미 전주가 덮은 칸에만 놓는다.** 이걸 안 걸었더니 구리
  // 용광로가 전주 없는 들판에 서서 40분 동안 한 장도 안 구웠고, 구리가 없으니
  // 구리선이 없고, 구리선이 없으니 전주를 못 세우는 교착이 됐다(실측: 구리 4개에서
  // 정지, 연구 0종). 여기서 막으면 그 순환이 아예 생기지 않는다.
  function placeIn(type, rc, dir, recipe) {
    var d = (dir === undefined) ? 0 : dir;
    if (!techOk(type)) return 'tech';
    if (!afford(type)) return 'mat';
    var bi = G.buildingInfo(type), want = needsNet(type), openUncovered = false;
    for (var y = rc[1]; y <= rc[3]; y++) {
      for (var x = rc[0]; x <= rc[2]; x++) {
        if (rc[4] && far(x + bi.w * 0.5, y + bi.h * 0.5, rc[4])) continue;
        if (want && !covered(x, y, bi.w, bi.h)) {
          if (G.whyPlace(type, x, y, d) === 'ok') openUncovered = true;
          continue;
        }
        var id = G.build(type, x, y, d);
        if (id) { markBuilt(type); if (recipe) setR(id, recipe); ensureNet(id); return id; }
      }
    }
    // 자리는 비었는데 전주가 아직 안 닿은 것과, 구역이 통째로 찬 것은 다르다.
    // 앞엣것을 '실패'로 세면 전주가 늦었을 뿐인데 배치 실패가 찍힌다.
    return openUncovered ? 'nocover' : null;
  }

  // --- 전력망 ----------------------------------------------------------------
  // **새 전주는 기존 망에 닿는 자리에만.** 떨어진 곳에 세우면 발전기가 없는 섬
  // 전력망이 생기고, 거기 붙은 기계는 수요만 올리고 만족도 0 으로 조용히 멈춘다.
  // 전역 만족도 = min(1, 총공급/총수요) 라 그 섬 하나가 판정을 통째로 끌어내린다.
  var POLES = [];
  function refreshPoles() {
    var ids = G.entIds(); POLES = [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][1] !== 'pole') continue;
      var e = G.ent(ids[i][0]); if (e) POLES.push([e.tx, e.ty]);
    }
  }
  function poleLinked(x, y) {
    for (var i = 0; i < POLES.length; i++) {
      var dx = POLES[i][0] - x, dy = POLES[i][1] - y;
      if (dx * dx + dy * dy <= 56.25) return true;      // 전주 연결 거리 7.5
    }
    return false;
  }
  // (x,y,w,h) 사각형 중 한 칸이라도 어떤 전주의 공급구역(±2)에 걸치는가
  function covered(x, y, w, h) {
    for (var i = 0; i < POLES.length; i++) {
      var px = POLES[i][0], py = POLES[i][1];
      if (px + 2 >= x && px - 2 <= x + w - 1 && py + 2 >= y && py - 2 <= y + h - 1) return true;
    }
    return false;
  }
  function putPole(x, y) {
    if (!poleLinked(x, y)) return null;
    var id = G.build('pole', x, y, 0);
    if (id) { markBuilt('pole'); POLES.push([x, y]); }
    return id;
  }
  function needsNet(type) {
    if (type === 'generator') return true;                 // 발전기는 power 항목이 없다
    var bi = G.buildingInfo(type);
    return !!(bi && bi.power);
  }
  // 전기를 쓰는 건물이 망 밖이면 조용히 멈춘다. 드라이버는 그걸 한 번도 안 봤다.
  function ensureNet(id) {
    var e = G.ent(id);
    if (!e || !needsNet(e.type) || e.net >= 0) return;
    if (!afford('pole')) return;
    // 전주 공급은 ±2 라 건물에서 2칸 안이어야 덮는다
    for (var r = 1; r <= 2; r++) {
      for (var dy = -r; dy < e.h + r; dy++) {
        for (var dx = -r; dx < e.w + r; dx++) {
          if (dx >= 0 && dx < e.w && dy >= 0 && dy < e.h) continue;
          if (putPole(e.tx + dx, e.ty + dy)) return;
        }
      }
    }
  }
  function ensureAllPowered() {
    var ids = G.entIds();
    for (var i = 0; i < ids.length; i++) {
      if (!needsNet(ids[i][1])) continue;
      var e = G.ent(ids[i][0]);
      if (e && e.net < 0) ensureNet(ids[i][0]);
    }
  }

  // --- 발전 (수요를 보고 자란다) ---------------------------------------------
  // 고정 개수로 두면 확장할 때마다 브라운아웃이 나고, 그 브라운아웃은 판정에
  // '생산이 적다'로만 보인다. 잠재수요(모든 전기 건물의 정격 합)를 넘게 유지한다.
  var GEN_RC = [74, 60, 84, 69, IN_R];
  var GEN_MAX = 18;
  var powerBlock = false, genStuck = false;
  function autoGen() {
    var st = G.state(), ids = G.entIds(), pot = 0, gens = 0;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][1] === 'generator') { gens++; continue; }
      var bi = G.buildingInfo(ids[i][1]);
      if (bi && bi.power) pot += bi.power;
    }
    POT = pot * ((st.mult && st.mult.power) || 1);
    SUPCAP = gens * 900;
    powerBlock = false;
    if (gens >= GEN_MAX || genStuck) return;
    // 잠재수요(정격 합)로 본다. 실제 수요는 재료가 없는 기계가 빠져 늘 더 작으므로
    // 이 기준을 지키면 만족도가 1 밑으로 안 내려간다.
    if (SUPCAP >= POT) return;
    // **발전기를 못 사면 줄을 세운다.** 안 그러면 기계가 발전보다 빨리 늘어
    // 브라운아웃이 나고, 그건 판정에 '생산이 적다'로만 보인다.
    if (!afford('generator')) { powerBlock = true; return; }
    var g1 = placeIn('generator', GEN_RC, 2);
    if (g1 === null || g1 === 'nocover') {
      var g2 = placeIn('generator', EAST_RC, 2);
      if (g2 === null || g2 === 'nocover') {
        var g3 = placeIn('generator', CORE_RC, 2);
        if (g3 === null && g1 === null && g2 === null) {
          genStuck = true;             // 어느 구역에도 자리가 없다 — 막아도 안 나아진다
          out.notes.push('발전기 자리 없음 — 이후 전력 대기 해제');
        }
      }
    }
  }
  // 석탄이 마르면 발전기를 더 지어도 소용없다 — 채광을 늘린다.
  var coalMiners = 0;
  function autoCoal() {
    var st = G.state();
    // 문턱을 35로 뒀더니 발전기가 마른 뒤에야 채광기를 세워 만족도가 27%까지
    // 떨어졌다. 석탄은 미리 벌어 둔다 — 남아도 손해가 크지 않다.
    // **보일러는 석탄 먹는 입이 하나 더 생긴 것이다.** 1.8 MW 를 태워 900 kW 를
    // 내므로 발전기보다 석탄 효율이 나쁘고(버퍼를 얻는 대가다), 채광을 그대로 두면
    // 발전기 몫이 줄어 전력 만족도가 떨어진다 (실측: 90.7% → 47.2%).
    var coalCap = steamParts.boiler ? 11 : 8;
    if ((st.inventory['coal'] || 0) > (steamParts.boiler ? 60 : 45) || coalMiners >= coalCap) return;
    if (!afford('miner')) return;
    if (mineOn('coal', 71, 76)) { coalMiners++; note('석탄 채광 ' + coalMiners + '대'); }
  }
  // 터렛도 계획이 아니라 **되먹임**이어야 한다. 이 파일은 그렇게 적어 놓고(아래
  // buildRing 위 주석) 실제로는 터렛을 작업 줄에 매달아 두고 있었다. 그래서 5~9번째
  // 터렛이 줄 차례를 기다리다 **피해가 난 뒤에** 섰다:
  //   t=1063  터렛 4기 · 잃은 건물 1
  //   t=1129  터렛 4기 · 잃은 건물 6 · 발전기 5→2대 · 전력 만족도 48%
  //   t=1197  터렛 8기 (이미 늦었다)
  // 전력 게이트가 실패한 원인이 석탄도 발전기 수도 아니라 **발전기가 부서진 것**이다.
  // 위협은 진화도로 읽힌다 — 그에 비례해 미리 세운다. 자재는 발전기와 같은 급으로
  // 먼저 가져간다(손실 0 은 타협할 수 있는 게이트가 아니다).
  function wantTurrets(evo) {
    // 기본 6기 + 진화 6%당 한 기. 4기로 시작했더니 진화 27% 시점(t≈1002)에 5기밖에
    // 못 서서 건물 하나를 잃었다 — 자재가 모이는 속도가 위협이 자라는 속도를 못 따라간다.
    // 초반 여유분을 미리 얹어 그 격차를 메운다.
    return Math.min(ring.length, 6 + Math.floor(evo * 100 / 6));
  }
  function autoTurret() {
    if (!techOk('turret')) return;
    var st = G.state();
    if (TURRETS >= wantTurrets(st.evolution)) return;
    if (!afford('turret')) return;
    // **제어기 몫은 남긴다.** 터렛은 철판 20 을 먹고 제어기는 철판 5 + 회로 5 를
    // 먹는데(회로도 철판을 거쳐 온다), 되먹임 터렛을 붙이자마자 제어기 2·4 가 자재를
    // 못 구해 안 섰다 — 노드 커버리지가 32/32 에서 29/32 로 후퇴했다. 방어를 고치면서
    // 커버리지를 깨면 고친 게 아니다. 아직 안 세운 제어기가 있으면 여유분을 남긴다.
    if (!ctrl2 || !ctrl4 || !ctrl5) {
      var iv2 = invNow();
      if ((iv2['iron-plate'] || 0) < 20 + 12) return;
    }
    // **뒤처졌으면 한 사이클에 여러 기를 세운다.** 한 기씩만 세우면 위협이 자라는
    // 속도를 못 따라간다 — 제철을 늘려 오염이 커지자 습격이 빨라져 t=507 에 발전기를
    // 잃었다(그 시점 목표 8기, 실제 3기). 목표와의 격차만큼 따라잡는다.
    var gap = wantTurrets(st.evolution) - TURRETS;
    var built = 0;
    while (built < Math.min(3, gap) && afford('turret') && nextRingTurret()) built++;
    if (built) note('터렛 보강 +' + built + '기 (진화 ' + Math.round(st.evolution * 100) + '%)');
  }
  // 제철도 되먹임으로 늘린다. **한 쌍(채광기+용광로)은 철판 15장을 쓰고 20분에
  // 370장을 돌려준다** — 채광기 0.5광석/s, 용광로 0.31판/s 이므로 명백히 남는
  // 장사인데, 작업 줄에 묶여 있으면 앞의 항목이 자재를 기다리는 동안 같이 늦어진다.
  // 실측으로 40분에 철판 5847장이 나왔고 그중 톱니 2612 · 탄약 1256 이 나갔다.
  // 녹색 연구팩의 병목은 벨트(128개)였고, 벨트는 톱니를 거쳐 철에서 온다 —
  // **연구가 안 되는 이유는 결국 철이다.**
  //
  // 초반에만 짓는다: 회수에 20분이 걸리므로 후반에 지으면 그 자재만 잃는다.
  // 재고에 여유가 있을 때만 짓는다 — 이 공장은 철판 재고가 상시 0 이지만 초반
  // (t<600)에는 97 까지 오른 적이 있다(스냅샷). 그 여유분만 쓴다.
  var ironPairs = 0;
  function autoIron() {
    var st = G.state();
    // **방어가 설 때까지 기다리지는 않는다.** 제철은 오염을 키워 첫 습격을 세게 만들고
    // 실제로 그 때문에 발전기 하나를 잃는다(t=507). 그래서 '터렛 4기 뒤에' 로 미뤄
    // 봤더니 회수 기간(20분)이 모자라 얻은 것을 전부 잃었다 — 연구 7→6종, 탱크 못 삼,
    // 노드 32→29. **철은 이르게 늘려야 값이 나온다.** 초반 손실 한 건은 그 대가다.
    if (st.t > 1200 || ironPairs >= 6) return;
    var iv = st.inventory;
    if ((iv['iron-plate'] || 0) < 35 || (iv['brick'] || 0) < 8 || (iv['gear'] || 0) < 6) return;
    if (!afford('miner') || !afford('furnace')) return;
    var m = mineOn('iron-ore', 89, 74);
    if (!m) return;
    var f = placeIn('furnace', EAST_RC, 0, 'iron-plate');
    if (!f || f === 'mat' || f === 'tech' || f === 'nocover') return;   // 채광기만 서도 광석은 쌓인다
    ironPairs++;
    note('제철 보강 ' + ironPairs + '쌍 (채광기+용광로)');
  }
  // 톱니도 되먹임으로 늘린다. 적팩 조립기가 톱니를 못 받아 멈춰 있었다
  // (진단: sci-red:.:in50 — 구리만 50, 톱니 0). **있는 톱니를 뺏는 것은 실패했다**:
  // 재고로 24개를 잡아 두자 톱니는 터렛 재료이기도 해서 방어가 무너졌다(손실 0 → 24).
  // 그러니 뺏지 말고 더 만든다 — 톱니는 철판 2장이고 철은 이제 남는다.
  //
  // 조건 둘을 실패로 배웠다:
  //   · **시작 재고로 성립하면 안 된다.** 't<1500' 만 걸었더니 시작 재고(회로 10 ·
  //     톱니 30 · 철판 60)로 t=0 에 3대를 지어 부트스트랩이 사라졌다(건물 4/21)
  //   · **자리가 있어야 한다.** 예전 구역(IN_R 22)에서는 조립기 구역이 꽉 차 계획의
  //     녹팩 조립기가 밀렸다. 구역을 넓힌 뒤에야 시도할 수 있는 일이었다
  var gearAsm = 0;
  function autoGear() {
    var st = G.state();
    // **시점을 900 → 600 으로 당기고 상한을 3대로.** 마지막 연구가 76% 에서 끝났다 —
    // 적팩 438(필요 410) · 녹팩 331(필요 280) 로 총량은 이미 충분하고 **도착이 늦을
    // 뿐**이다. 톱니가 일찍 풀리면 적팩·벨트·인서터가 다 같이 앞당겨진다.
    // 600 이면 부트스트랩(첫 용광로·발전기·연구소)은 이미 끝난 뒤다.
    if (st.t < 600 || st.t > 1800 || gearAsm >= 3) return;
    var iv = st.inventory;
    if ((iv['gear'] || 0) > 25) return;                // 모자랄 때만
    if ((iv['iron-plate'] || 0) < 60) return;          // 철 여유가 확실할 때만
    if (!afford('assembler')) return;
    var a2 = placeIn('assembler', EAST_RC, 0, 'gear');
    if (!a2 || a2 === 'mat' || a2 === 'tech' || a2 === 'nocover') {
      a2 = placeIn('assembler', WEST_RC, 0, 'gear');
      if (!a2 || a2 === 'mat' || a2 === 'tech' || a2 === 'nocover') return;
    }
    gearAsm++;
    note('톱니 조립기 보강 ' + gearAsm + '대');
  }
  // 광맥 자리는 **이미 전주가 덮은 곳을 먼저** 고른다. 안 그러면 채광기가 망 밖에
  // 서서 전기만 못 받은 채 멈춘다(스냅샷의 noNet 이 그것이다).
  // 벽돌은 발전기·용광로·벽의 재료다. 줄에 맡겨 두면 줄이 막힌 동안 재고가 0이 되고,
  // 그러면 벽돌 가마 자체(벽돌 5)를 못 지어 되돌아올 길이 사라진다. 석탄과 같은
  // 이유로 계획 밖에서 관리한다.
  var brickFurn = 0;
  function autoBrick() {
    var st = G.state();
    // **보충용이지 부트스트랩이 아니다.** 계획이 첫 가마를 세우기 전에 이게 먼저
    // 돌면 시작 자재가 통째로 벽돌 가마·돌 채광기가 되어 철 라인이 아예 안 선다
    // (실측: 용광로 3대 전부 벽돌, 채광기 3대 전부 돌, 철판 0).
    if (brickFurn < 1 || brickFurn >= 3) return;
    if ((st.inventory['brick'] || 0) > 25) return;
    // **돌이 없으면 가마를 더 지어도 벽돌은 안 나온다.** 오히려 가마 한 대가
    // 벽돌 5를 먹어 남은 벽돌을 0으로 만들고, 그러면 발전기(벽돌 10)를 못 사서
    // 공장이 통째로 선다 — 실제로 빈 가마 3대가 그 짓을 했다.
    if (stoneMiners < 1 || (st.inventory['stone'] || 0) < 20) return;
    if (!afford('furnace')) return;
    var r = placeIn('furnace', CORE_RC, 0, 'brick');
    if (r === 'mat' || r === 'tech' || r === 'nocover' || r === null) r = placeIn('furnace', EAST_RC, 0, 'brick');
    if (r && r !== 'mat' && r !== 'tech' && r !== 'nocover') { brickFurn++; note('벽돌 가마 ' + brickFurn + '대'); }
  }
  function autoStone() {
    var st = G.state();
    if (stoneMiners < 2 || stoneMiners >= 4) return;
    if ((st.inventory['stone'] || 0) > 25) return;
    if (!afford('miner')) return;
    if (mineOn('stone', 86, 68)) stoneMiners++;
  }
  var stoneMiners = 0;
  function mineOn(item, ax, ay) {
    var sp = G.oreSpotsNear(item, ax, ay, 40, 60), i, id;
    for (i = 0; i < sp.length; i++) {
      if (far(sp[i].x + 1, sp[i].y + 1, IN_R)) continue;
      if (!covered(sp[i].x, sp[i].y, 2, 2)) continue;
      id = G.build('miner', sp[i].x, sp[i].y, 1);
      if (id) { markBuilt('miner'); ensureNet(id); return id; }
    }
    // **덮이지 않은 자리에는 세우지 않는다.** 예전엔 '전주를 이어 붙일 수 있으면'
    // 세웠는데, 그 순간 구리선이 없어 전주를 못 세우면 채광기가 망 밖에 굳는다.
    // 실제로 구리 채광기가 그렇게 죽어 구리 → 구리선 → 전주가 통째로 멈췄고,
    // 석탄이 끊겨 발전기까지 꺼졌다(실측: 망 밖 6대, 만족도 0%, 연구 0종).
    // 못 세우면 'later' 로 돌아가 전주가 설 때 다시 시도하는 편이 언제나 낫다.
    return null;
  }

  // --- 작업 목록 (번 만큼 순서대로 짓는다) -----------------------------------
  //  fn() 은 'done'(끝) · 'wait'(자재 대기 — 뒤를 막는다) · 'later'(연구/자리
  //  대기 — 뒤를 안 막는다) 중 하나를 돌려준다.
  var JOBS = [];
  function job(key, fn, type) { JOBS.push({ key: key, fn: fn, done: false, type: type || null }); }
  // 줄 맨 앞에서 막고 있는 것이 무엇을 요구하는가. 손 조립이 그 재료를 먼저 태워
  // 버리면 맨 앞이 영원히 안 지어진다 — 시작 철판 60이 전부 톱니가 되어 채광기를
  // 한 대도 못 세운 채 20분을 흘려보냈다(실측: 용광로 0대, 철판 1개).
  function pendingCost() {
    for (var i = 0; i < JOBS.length; i++) {
      var j = JOBS[i];
      if (j.done || !j.type) continue;
      if (!techOk(j.type)) continue;              // 연구 대기는 줄을 안 막는다
      var bi = G.buildingInfo(j.type);
      if (bi) return bi.cost;
    }
    return null;
  }
  // 줄이 자재를 못 사서 멈춰 있는가. 손 조립이 재량껏 쓰는 철판은 이때 멈춘다 —
  // 안 그러면 손이 언제나 이기고 공장은 t≈1050 에서 자란 것을 멈춘다(실측).
  var queueWaiting = false;
  function runJobs() {
    queueWaiting = false;
    for (var i = 0; i < JOBS.length; i++) {
      var j = JOBS[i];
      if (j.done) continue;
      // 전력이 모자란데 발전기도 못 사면 **전주 말고는 아무것도 안 짓는다.**
      // 전주는 발전기가 설 자리를 만드는 쪽이라 막으면 도리어 교착이 된다.
      if (j.soft) { var rs; try { rs = j.fn(); } catch (es) { rs = 'later'; }
        if (rs === 'done') j.done = true; continue; }
      // **continue 여야 한다 — return 이면 줄 앞쪽의 기계 하나가 뒤에 있는 전주를
      // 통째로 가린다.** 그래서 벽돌이 0이 된 뒤 전주를 못 세워 돌 채광기가 안
      // 서고, 돌이 없어 벽돌이 안 나오고, 벽돌이 없어 발전기를 못 사는 4각
      // 교착으로 40분이 통째로 얼었다(실측: 엔티티 32개 고정).
      if ((powerBlock || (!genStuck && POT >= SUPCAP)) && j.key.indexOf('pole@') !== 0) continue;
      var r;
      try { r = j.fn(); }
      catch (e) { out.fails.push('job:' + j.key + ' ' + (e && e.message)); j.done = true; continue; }
      if (r === 'done') { j.done = true; continue; }
      if (r === 'later') continue;
      if (r === 'hold') return;                 // 일부러 멈춘 것 — 감시견을 걸지 않는다
      // 'wait' — 재료를 벌 때까지 줄을 선다.
      // **다만 영원히는 아니다.** 한 작업이 살 수 없는 재료를 기다리며 줄 전체를
      // 세우는 교착이 실제로 두 번 났다(구리선 → 전주 → 구리, 벽돌 → 벽돌 가마).
      // 5분을 넘기면 그 작업만 '나중에'로 내려놓고 뒤를 통과시킨다. 원인 자체는
      // 계획 순서로 고치는 게 맞고, 이건 한 곳의 실수가 판 전체를 죽이지 않게 하는
      // 안전판이다 — 그래서 눈에 보이게 기록한다.
      queueWaiting = true;
      var now = G.state().t;
      if (j.t0 === undefined) j.t0 = now;
      if (now - j.t0 > 150) {
        j.soft = true;
        out.notes.push('작업 ' + j.key + ' 이 ' + Math.round(now - j.t0) + '초째 자재 대기 — 줄에서 내림');
        continue;
      }
      return;
    }
  }
  // rc2 = 예비 구역. 한 구역이 차면 실패로 세지 말고 옆 들판으로 밀어낸다 —
  // 구역이 꽉 찬 것은 "지을 자리가 세상에 없다"가 아니라 "여기가 좁다"이다.
  function jIn(key, type, rc, dir, recipe, rc2) {
    job(key, function () {
      var r = placeIn(type, rc, dir, recipe);
      if (r === null && rc2) r = placeIn(type, rc2, dir, recipe);
      if (r === 'mat') return 'wait';
      if (r === 'tech' || r === 'nocover') return 'later';
      if (r === null) { out.fails.push(key + ' — ' + type + ' 구역에 자리 없음 [' + rc.slice(0, 4).join(',') + ']'); }
      return 'done';
    }, type);
  }
  function jMiner(key, item, ax, ay) {
    job(key, function () {
      if (!afford('miner')) return 'wait';
      if (mineOn(item, ax, ay)) { if (item === 'coal') coalMiners++; return 'done'; }
      return 'later';        // 남은 광맥 자리가 없다 — 실패가 아니라 그냥 못 늘린다
    }, 'miner');
  }
  function jPole(x, y) {
    job('pole@' + x + ',' + y, function () {
      // **전주는 줄을 막지 않는다.** 구리선이 모자라 전주가 서고, 전주가 없어
      // 구리 용광로가 못 서고, 구리가 없어 구리선을 못 만드는 3각 교착이 두 번 났다.
      // 못 사면 다음 사이클에 다시 시도할 뿐 뒤엣것을 세우지 않는다.
      if (!afford('pole')) return 'later';
      for (var r = 0; r <= 1; r++) {
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (putPole(x + dx, y + dy)) return 'done';
          }
        }
      }
      return 'later';        // 자리가 찼거나 아직 망이 안 닿았다 — 격자는 여유가 있다
    }, 'pole');
  }

  // --- 구역 ------------------------------------------------------------------
  // 드라이버가 창고 물류(harvest/feed)를 대신하므로 **용광로·조립기는 광맥 옆에
  // 있을 필요가 없다.** 광맥 위에 서야 하는 것은 채광기뿐이다. 그래서 제련·조립을
  // 전주가 촘촘한 두 구역에 몰아 두고, 광맥에는 채광기만 보낸다.
  var CORE_RC = [74, 70, 84, 76, IN_R];        // 연구소·제어기·벽돌가마·상자
  var EAST_RC = [83, 78, 100, 100, IN_R];      // 용광로 + 조립기 (남동 빈 들)
  var WEST_RC = [58, 80, 74, 96, IN_R];        // 후반 조립기

  // 전주 격자 — 5칸 간격이면 공급 5x5 가 빈틈없이 이어지고 도달 7.5 로 한 망이 된다.
  // 시작 전주 (82,77)·(82,82) 가 씨앗이라 여기서 뻗어 나간다. **순서가 곧 배선**이라
  // 앞의 전주에 닿는 것부터 적는다 (putPole 이 안 닿는 자리를 거절한다).
  var PA = [[82, 80], [77, 80], [82, 75], [87, 75], [92, 75], [87, 80], [82, 85], [87, 85]];
  var PB = [[77, 75], [72, 80], [72, 75], [67, 75]];               // 석탄
  var PC = [[77, 70], [82, 70], [87, 70]];                          // 발전 구역 + 돌 광맥
  var PD = [[77, 85], [77, 90], [72, 90]];                         // 구리
  var PE = [[77, 65], [82, 65], [92, 80], [87, 70], [92, 70]];     // 돌 + 철 확장
  var PF = [[67, 70], [72, 70], [72, 65], [67, 65], [97, 75], [97, 70], [87, 65],
            [82, 90], [87, 90], [92, 85], [92, 90], [67, 80], [72, 85], [67, 85]];
  function gridRest() {
    var seen = {}, i, w = [PA, PB, PC, PD, PE, PF], k;
    for (k = 0; k < w.length; k++) for (i = 0; i < w[k].length; i++) seen[w[k][i][0] + ',' + w[k][i][1]] = 1;
    // **지킬 수 있는 범위 안에만 깐다.** 손실 목록이 정확히 말해 줬다: 잃은 두 개는
    // 공장이 아니라 x=62 의 전주였다(t=1847,1853). 터렛 사거리 밖에 혼자 나가 있는
    // 전주는 방어선을 넓히는 게 아니라 적에게 먹이를 주는 것이다.
    var r = [];
    for (var x = 67; x <= 97; x += 5) {
      for (var y = 65; y <= 95; y += 5) {
        if (!seen[x + ',' + y]) r.push([x, y]);
      }
    }
    // 가까운 것부터 — 멀리 있는 전주를 먼저 세우면 망이 끊긴 채로 남는다
    r.sort(function (a, b) {
      return (Math.abs(a[0] - CX) + Math.abs(a[1] - CY)) - (Math.abs(b[0] - CX) + Math.abs(b[1] - CY));
    });
    return r;
  }
  function poleWave(list) { for (var i = 0; i < list.length; i++) jPole(list[i][0], list[i][1]); }

  // --- 튜토리얼용 고정 3종 세트 (용광로 → 인서터 → 상자) ----------------------
  // 기초 4단계가 "상자에 철판 5개"를 요구한다. 드라이버가 상자를 매 사이클 비우면
  // 영원히 5개가 안 되므로, 이 상자만 심화 트랙에 들어갈 때까지 안 걷는다.
  var tutChest = null, tutBelt = null;
  function tripleAt(ax, ay) {
    // 셋을 **함께** 살 수 있는지 먼저 본다. 하나씩 보면 용광로(철 5)만 서고
    // 상자(철 8)를 못 사서, 상자 없이 '완료'로 표시되고 기초 4단계가 영영 안 넘어간다.
    var inv = invNow();
    if ((inv['iron-plate'] || 0) < 13 || (inv['brick'] || 0) < 5 || (inv['inserter-item'] || 0) < 1) return false;
    if (G.whyPlace('furnace', ax, ay, 0) !== 'ok') return false;
    if (G.whyPlace('inserter', ax + 2, ay, 1) !== 'ok') return false;
    if (G.whyPlace('chest', ax + 3, ay, 0) !== 'ok') return false;
    var f = G.build('furnace', ax, ay, 0); if (!f) return false;
    markBuilt('furnace'); setR(f, 'iron-plate'); ensureNet(f);
    var ins = G.build('inserter', ax + 2, ay, 1);
    if (ins) { markBuilt('inserter'); ensureNet(ins); }
    var ch = G.build('chest', ax + 3, ay, 0);
    if (ch) { markBuilt('chest'); tutChest = ch; }
    return !!ch;
  }
  function frontTiles(e) {
    var d = e.dir, pts = [], i;
    if (d === 0) { for (i = e.tx; i < e.tx + e.w; i++) pts.push([i, e.ty - 1]); }
    else if (d === 2) { for (i = e.tx; i < e.tx + e.w; i++) pts.push([i, e.ty + e.h]); }
    else if (d === 1) { for (i = e.ty; i < e.ty + e.h; i++) pts.push([e.tx + e.w, i]); }
    else { for (i = e.ty; i < e.ty + e.h; i++) pts.push([e.tx - 1, i]); }
    return pts;
  }
  function findAll(t) {
    var ids = G.entIds(), r = [];
    for (var i = 0; i < ids.length; i++) if (ids[i][1] === t) r.push(ids[i][0]);
    return r;
  }
  function findOne(t) { var a = findAll(t); return a.length ? a[0] : null; }

  // --- 계획 ------------------------------------------------------------------
  var ring = [];
  function buildRing() {
    var nl = G.nestList(), outer = [], i, k;
    for (i = 0; i < RING_N; i++) {
      var a = i * 2 * Math.PI / RING_N;
      var x = Math.round(CX + Math.cos(a) * RING_R), y = Math.round(CY + Math.sin(a) * RING_R);
      var nd = 1e9;
      for (k = 0; k < nl.length; k++) {
        var d = Math.hypot(nl[k].x - x, nl[k].y - y);
        if (d < nd) nd = d;
      }
      outer.push({ x: x, y: y, nd: nd });
    }
    // 둥지가 가까운 면부터 — 철이 모자란 동안에도 위협받는 쪽이 먼저 선다
    outer.sort(function (p, q) { return p.nd - q.nd; });
    // **안쪽 4기가 먼저다.** 반경 12 에서는 사거리 18이 공장 전체(반경 22)를 덮어
    // 4기로 한 바퀴를 대신한다. 바깥 고리(26)를 먼저 채웠더니 성긴 3기가 아무것도
    // 못 막아 t=609~792 사이에 건물 13채를 잃었다.
    // **안쪽 4자리도 위협 순으로 세운다.** 바깥 고리는 둥지 거리로 정렬하면서
    // 안쪽은 동·남·서·북 고정 순서로 두고 있었다. 그래서 터렛이 3기일 때 북쪽
    // (79,67) 이 비어 있었고, 첫 습격에 잃은 것이 정확히 그 방향의 발전기(74,61)와
    // 전주(77,65)다 — 그 자리에 터렛이 있었으면 사거리 18 안이라 닿았다.
    var inner = [[92, 79], [79, 92], [67, 79], [79, 67]].map(function (p) {
      var nd2 = 1e9;
      for (var q = 0; q < nl.length; q++) {
        var dq = Math.hypot(nl[q].x - p[0], nl[q].y - p[1]);
        if (dq < nd2) nd2 = dq;
      }
      return { x: p[0], y: p[1], nd: nd2, r: 5 };
    });
    inner.sort(function (p, q) { return p.nd - q.nd; });
    for (i = 0; i < inner.length; i++) ring.push(inner[i]);
    for (i = 0; i < outer.length; i++) ring.push(outer[i]);
  }
  // **방어는 계획이 아니라 되먹임이어야 한다.** 고정 목록으로 두면 두 가지가 다
  // 나빴다: 줄에 두면 터렛 한 기가 과학 라인 전체를 막고(실측: t=1500~2400 동안
  // 조립기 2대만 늘었다), 줄에서 빼면 철판 재고가 늘 0이라 한 기도 안 선다.
  // 진화도가 위협의 척도이므로 그것에 비례해 세우고, 발전기와 같이 줄보다 먼저
  // 자재를 가져간다 — 손실 0 은 타협할 수 있는 게이트가 아니다.
  // 고리의 다음 자리에 터렛 한 기.
  function nextRingTurret(r) {
    for (var i = 0; i < ring.length; i++) {
      if (ring[i].built) continue;
      if (spiral('turret', ring[i].x, ring[i].y, 0, r || ring[i].r || 3)) { ring[i].built = 1; return true; }
      ring[i].built = 1;                       // 자리가 없다 — 다음 자리로
    }
    return false;
  }
  // **터렛 한 기 = 작업 한 개.** 'n기가 될 때까지' 하나로 묶었더니 적이 한 기를
  // 부술 때마다 조건이 되돌아가 그 작업이 줄을 영원히 막았고, 그 사이 채광기와
  // 용광로가 재건되지 않아 공장이 말라 죽었다(실측: 손실 63, 채광기 13).
  // 하나씩 나눠 두면 부서져도 이미 끝난 작업은 끝난 채로 남는다.
  function jTurrets(from, to) {
    for (var t = from; t < to; t++) {
      (function (n) {
        job('turret#' + n, function () {
          if (!techOk('turret')) return 'later';
          if (!afford('turret')) return 'wait';
          if (nextRingTurret()) return 'done';
          return 'done';                        // 고리에 남은 자리가 없다
        }, 'turret');
      })(t);
    }
  }
  function makePlan() {
    buildRing();

    // ── 0. 부팅 — 시작 자재(철60·톱니30·구리30·벽돌30)로 살 수 있는 것만.
    //    전주는 **그 구역의 기계보다 먼저** 깐다. 순서를 뒤집으면 기계가 망 밖에
    //    서서 전기만 못 받고 멈춘다 — 그게 초기 판들을 통째로 세운 교착이었다.
    jIn('lab#1', 'lab', CORE_RC, 0);
    poleWave(PA);
    poleWave(PB);
    jMiner('coal#1', 'coal', 71, 76);
    jMiner('iron#1', 'iron-ore', 89, 74);
    jIn('furnace-fe#1', 'furnace', EAST_RC, 0, 'iron-plate');
    // **구리를 최대한 일찍.** 적색 연구팩 = 구리1+톱니1 이고 군수 20개가 첫
    // 방어의 관문이다. 시작 구리 30개로는 연구팩 20개와 전주 몇 개면 끝난다.
    poleWave(PD);
    jMiner('copper#1', 'copper-ore', 75, 90);
    jIn('furnace-cu#1', 'furnace', EAST_RC, 0, 'copper-plate');
    // **벽돌 라인을 시작 벽돌이 마르기 전에.** 벽돌 가마 자체가 벽돌 5를 먹으므로
    // 30개를 용광로·발전기에 다 쓰면 벽돌을 영영 못 만들고, 그러면 용광로도
    // 발전기도 벽도 더는 못 짓는다(실측: 돌 249개가 쌓인 채 20분 정지).
    poleWave(PC);
    job('stone#1', function () {
      if (!afford('miner')) return 'wait';
      if (mineOn('stone', 86, 68)) { stoneMiners++; return 'done'; }
      return 'later';
    }, 'miner');
    job('furnace-brick#1', function () {
      var r = placeIn('furnace', CORE_RC, 0, 'brick');
      if (r === 'mat') return 'wait';
      if (r === null || r === 'tech' || r === 'nocover') return 'later';
      brickFurn++; return 'done';
    }, 'furnace');
    jMiner('iron#2', 'iron-ore', 89, 74);
    jIn('furnace-fe#2', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#3', 'furnace', EAST_RC, 0, 'iron-plate');

    // ── 1. 여기서 **일부러 멈춘다** (규칙 ②)
    job('gate:military', function () {
      if (G.state().research.done.indexOf('military') >= 0) { note('군수 연구 완료 — 방어 개시'); return 'done'; }
      return 'hold';
    });

    // 기초 튜토리얼이 요구하는 것들 — 세계 상태로 판정되므로 진짜로 만들어야 한다.
    // (용광로 → 인서터 → 상자, 그리고 채광기 앞의 벨트 한 칸)
    job('tut-triple', function () {
      if (tutChest) return 'done';
      var an = [[75, 71], [75, 73], [78, 70], [74, 74], [83, 70], [76, 75]];
      for (var i = 0; i < an.length; i++) if (tripleAt(an[i][0], an[i][1])) return 'done';
      return 'later';
    }, 'chest');
    job('tut-belt', function () {
      if (tutBelt) return 'done';
      if (!afford('belt')) return 'later';
      var ms = findAll('miner');
      for (var i = 0; i < ms.length; i++) {
        var e = G.ent(ms[i]); if (!e) continue;
        var pts = frontTiles(e);
        for (var p2 = 0; p2 < pts.length; p2++) {
          var id = G.build('belt', pts[p2][0], pts[p2][1], e.dir);
          if (id) { markBuilt('belt'); tutBelt = id; return 'done'; }
        }
      }
      return 'later';
    }, 'belt');

    // ── 2. 첫 방어 — 반경 12 의 4기가 사거리 18로 공장 전체(반경 22)를 덮는다.
    //    바깥 고리(반경 26)는 20기가 있어야 한 바퀴라 첫 파도에 못 맞춘다.
    jTurrets(0, 4);
    job('ammo-inserter', function () {
      // 심화 'ammo-line' 은 **인서터의 앞칸이 터렛**일 것을 요구한다.
      var ts = findAll('turret');
      if (!ts.length) return 'later';
      if (!afford('inserter')) return 'later';
      var best = null, bd = 1e9;
      for (var i = 0; i < ts.length; i++) {
        var e = G.ent(ts[i]); if (!e) continue;
        var d = Math.hypot(e.tx - CX, e.ty - CY);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) return 'later';
      var c = [[best.tx - 1, best.ty, 1], [best.tx + best.w, best.ty, 3],
               [best.tx, best.ty - 1, 2], [best.tx, best.ty + best.h, 0]];
      for (var k = 0; k < c.length; k++) {
        var id = G.build('inserter', c[k][0], c[k][1], c[k][2]);
        if (id) { markBuilt('inserter'); ensureNet(id); return 'done'; }
      }
      return 'later';
    }, 'inserter');
    // 벽 — 심화 'wall-turret' 이 12장 이상을 요구한다. 벽돌 2개짜리라 싸고,
    // 표적 가중치가 1.4 여서 같은 거리면 적이 가장 나중에 무는 건물이다.
    for (var wx = 62; wx <= 75; wx++) {
      (function (x) {
        job('wall@' + x, function () {
          if (!techOk('wall')) return 'later';
          if (!afford('wall')) return 'later';
          if (spiral('wall', x, 81, 0, 2)) return 'done';
          return 'later';
        }, 'wall');
      })(wx);
    }
    // 터렛을 세운 것과 **쏠 수 있는 것**은 다르다. 실탄이 들어갈 때까지는
    // 공장을 키우지 않는다 — 키우면 오염이 늘어 파도가 더 일찍·더 크게 온다.
    job('gate:armed', function () {
      var ts = findAll('turret'), armed = 0;
      for (var i = 0; i < ts.length; i++) { var e = G.ent(ts[i]); if (e && e.ammo >= 20) armed++; }
      if (armed >= 3) { note('터렛 ' + armed + '기 실탄 장전 — 확장 재개'); return 'done'; }
      return 'hold';
    });

    // ── 3. 제련 확장 (규칙 ③) — 여기서 처리량을 산다
    jMiner('iron#3', 'iron-ore', 89, 74);
    jIn('furnace-fe#4', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#5', 'furnace', EAST_RC, 0, 'iron-plate');
    jMiner('iron#4', 'iron-ore', 89, 74);
    jIn('furnace-fe#6', 'furnace', EAST_RC, 0, 'iron-plate');
    jMiner('coal#2', 'coal', 71, 76);
    job('stone#2', function () {
      if (!afford('miner')) return 'wait';
      if (mineOn('stone', 86, 68)) { stoneMiners++; return 'done'; }
      return 'later';
    }, 'miner');
    // 톱니 자동화가 부트스트랩의 목줄이다 — 손 조립은 조립기 1대가 한계라
    // 채광기·발전기·터렛·연구팩이 전부 톱니에서 줄을 선다.
    jIn('asm-gear', 'assembler', EAST_RC, 0, 'gear');
    // **팩 사슬을 제련 확장 앞으로 당겨 봤다가 되돌렸다.** 총량은 이미 요구치를
    // 넘겼고(적팩 438/410 · 녹팩 331/280) 마지막 연구가 76% 라 '시간'을 사려던 것이다.
    // 결과는 붕괴였다: 벨트·인서터·녹팩 조립기가 회로와 톱니를 먼저 가져가 **제어기가
    // 한 대도 못 섰고**(노드 0/33) 방어가 무너졌다(손실 145 · 최저 전력 0% · 연구 6/8).
    // 이 계획은 한 줄을 당기면 그 아래가 통째로 굶는 **팽팽한 균형**이다.
    jMiner('iron#5', 'iron-ore', 89, 74);
    jIn('furnace-fe#7', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#8', 'furnace', EAST_RC, 0, 'iron-plate');
    poleWave(PE);
    jMiner('copper#2', 'copper-ore', 75, 90);
    jIn('furnace-cu#2', 'furnace', EAST_RC, 0, 'copper-plate', WEST_RC);

    // ── 4. 과학 라인 — 자재 소요에서 역산한 규모
    //   연구 8종 = 410 사이클. 적팩 410 · 녹팩 280 이 필요하고 그 재료는
    //     적팩 410 → 구리 410 + 톱니 410(철 820)
    //     녹팩 280 → 벨트 280(철 420) + 인서터 280(철 1120, 구리 420)
    //   합계 **철 2,360 · 구리 830** (건물·탄약 제외).
    //   조립기 속도 0.75 → 적팩 6.67s/개, 녹팩 8.0s/개. 남은 1,400초 안에
    //   410·280 을 뽑으려면 적팩 3대 · 녹팩 3대가 필요하다.
    jIn('asm-red#1', 'assembler', EAST_RC, 0, 'sci-red');
    jIn('asm-wire', 'assembler', EAST_RC, 0, 'wire');
    jIn('asm-circuit', 'assembler', EAST_RC, 0, 'circuit');
    jTurrets(4, 9);
    jIn('asm-ammo#1', 'assembler', EAST_RC, 0, 'ammo');
    jIn('asm-belt', 'assembler', EAST_RC, 0, 'belt-item');
    jIn('asm-ins', 'assembler', EAST_RC, 0, 'inserter-item');
    jIn('asm-green#1', 'assembler', EAST_RC, 0, 'sci-green');
    // 녹팩 280개가 후반 4종의 관문이다. 그 재료(벨트·인서터)는 결국 철판이므로
    // 제련을 먼저 더 올려 둔다 — 여기서 막히면 연구가 5/8 에서 선다(실측).
    jMiner('iron#6', 'iron-ore', 89, 74);
    jIn('furnace-fe#9', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#10', 'furnace', EAST_RC, 0, 'iron-plate');
    jMiner('iron#7', 'iron-ore', 89, 74);
    jIn('furnace-fe#11', 'furnace', EAST_RC, 0, 'iron-plate');
    poleWave(PF);
    jIn('asm-red#2', 'assembler', EAST_RC, 0, 'sci-red');
    jIn('asm-green#2', 'assembler', EAST_RC, 0, 'sci-green');
    jIn('furnace-brick#2', 'furnace', CORE_RC, 0, 'brick');
    jMiner('iron#8', 'iron-ore', 89, 74);
    jIn('furnace-fe#12', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#13', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('lab#2', 'lab', CORE_RC, 0);
    jTurrets(9, 14);
    jMiner('copper#3', 'copper-ore', 75, 90);
    jIn('furnace-cu#3', 'furnace', EAST_RC, 0, 'copper-plate', WEST_RC);
    jIn('asm-red#3', 'assembler', EAST_RC, 0, 'sci-red');
    jIn('asm-green#3', 'assembler', EAST_RC, 0, 'sci-green');
    jIn('chest#2', 'chest', CORE_RC, 0);
    jTurrets(14, 20);
    jMiner('iron#9', 'iron-ore', 89, 74);
    jIn('furnace-fe#14', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#15', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('asm-ammo#2', 'assembler', WEST_RC, 0, 'ammo');
    jIn('furnace-fe#16', 'furnace', EAST_RC, 0, 'iron-plate');
    jIn('furnace-fe#17', 'furnace', EAST_RC, 0, 'iron-plate');
    jMiner('iron#10', 'iron-ore', 89, 74);
    jMiner('iron#11', 'iron-ore', 89, 74);
    poleWave(gridRest());
    jIn('asm-gear#2', 'assembler', WEST_RC, 0, 'gear');
    jIn('furnace-cu#4', 'furnace', EAST_RC, 0, 'copper-plate', WEST_RC);
    jIn('asm-green#4', 'assembler', WEST_RC, 0, 'sci-green');
    jIn('asm-red#4', 'assembler', WEST_RC, 0, 'sci-red');
    // 인서터 조립기를 한 대 더 넣어 봤다: 인서터는 256 → 296 으로 늘었는데
    // **녹팩은 259 → 229 로 줄었다** — 벨트가 대신 밀려났다. 사슬의 한 칸만
    // 넓히면 바로 옆 칸이 좁아진다. 그래서 넣지 않는다.

  }

  // --- 강철 (분배기·철도 재료) -----------------------------------------------
  // 강철은 조립기가 아니라 **용광로** 레시피다. 철 용광로 하나를 잠시 빌려 굽고,
  // 다 되면 되돌린다. 되돌릴 때 남은 철판을 안 걷으면 그 용광로 입력 버퍼에
  // 영원히 갇힌다(철판은 철 레시피의 입력이 아니라 canAccept 가 거부한다).
  //
  // **목표량이 고정 4개였다.** 분배기(강철 2)만 있을 때는 맞았는데 철도가 들어오면서
  // 레일·역·열차가 강철을 먹는다. 4에서 멈추면 철도 단계가 영원히 재료를 기다리고,
  // 그건 "기능이 안 된다"가 아니라 "드라이버가 안 사 준다"이다 — 둘은 다른 문장이고
  // 게이트는 구별하지 못한다. 목표를 철도 예산까지 올린다.
  // 강철 1개는 철판 5장·16초다. 24개면 철판 120장이 철도로 빠진다 — 그만큼 연구가
  // 늦어질 수 있고, 그 대가는 아래 (가) 무리의 숫자로 드러난다. 감추지 않는다.
  //   레일 6 + 역 2대(4) + 열차(10) + 분배기(2) = 22, 여유 2 = 24
  //
  // **저장 탱크(강철 5)는 이 예산에 안 들어간다.** 26·28·30 으로 올려도 봤는데, 강철
  // 1개는 철판 5장이고 그 철판은 회로를 거쳐 제어기가 된다 — 예산을 올릴 때마다
  // 제어기 2·4 가 못 서서 노드 커버리지가 32 → 29 로 떨어졌다. 노선을 4칸으로 줄여
  // 그 몫을 돌려 봐도 같았고 연구까지 6/8 로 내려갔다. 이 공장에서 **강철 예산은 곧
  // 제어기 예산**이고, 40분 안에서는 둘 다 살 수 없다. 탱크는 남는 자재가 있을 때만
  // 산다(그래서 이 주행에서는 대개 안 선다 — 게이트가 그 사실을 그대로 말한다).
  var STEEL_WANT = 24;
  // 재고에 잡아 두는 철판. 강철 연구 전에는 0 — 그 전에 잡으면 초반 공장이 굶는다.
  // 증기 발전소를 살 때까지 40, 그 뒤로는 철도용 강철을 굽는 동안 25 를 남긴다
  // (용광로가 강철을 구우려면 재고에서 철판을 받아야 한다).
  var ironHold = 0, ironPeak = 0;
  function ironHoldTick() {
    // **터렛도 재고가 있어야 산다.** 되먹임 터렛을 붙였는데도 t=655~1263 동안 5기에서
    // 멈춰 있었다 — 목표는 10기였다. 이유는 앞의 증기 발전소와 똑같다: 흐름은 넉넉한데
    // craft 와 feed 가 매 사이클 철판을 0 으로 만들어 20 짜리 구매가 성립하지 않는다.
    // 방어가 목표에 못 미치는 동안에는 터렛 한 기분(20) + 제어기 몫(12)을 남긴다.
    var st0 = G.state();
    var needTur = techOk('turret') && TURRETS < wantTurrets(st0.evolution);
    if (!researched('steel')) { ironHold = needTur ? 32 : 0; return; }
    // **탱크를 위한 재고 확보는 넣었다가 뺐다.** 효과가 없었기 때문이다(철판 0/20 이
    // 그대로였다) — ironHold 는 craft 의 여유분만 줄일 뿐, 작업 줄(runJobs)이 건물을
    // 지으며 쓰는 철판은 못 막는다. 안 듣는 장치를 주석과 함께 남겨 두면 다음 사람이
    // 그것을 이미 시도된 해법으로 착각한다.
    if (!steamDone) ironHold = 40;
    else if (!railDone) ironHold = 25;
    else ironHold = needTur ? 32 : 0;
  }
  var steelFurn = null;
  function steelTick() {
    var st = G.state();
    if (st.research.done.indexOf('steel') < 0) return;
    var have = st.inventory['steel'] || 0;
    if (have >= STEEL_WANT) {
      if (steelFurn) { G.takeToStock(steelFurn); setR(steelFurn, 'iron-plate'); steelFurn = null; }
      return;
    }
    if (steelFurn && G.ent(steelFurn)) return;
    var fs = findAll('furnace');
    for (var i = 0; i < fs.length; i++) {
      if (WANT[fs[i]] !== 'iron-plate') continue;
      G.takeToStock(fs[i]); steelFurn = fs[i]; setR(fs[i], 'steel');
      note('강철 제련 시작');
      return;
    }
  }

  // --- 물류 (play.js 에서 검증된 방식) ---------------------------------------
  function harvest() {
    var ids = G.entIds();
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1];
      // 튜토리얼 상자는 심화 트랙에 들어가기 전까지 안 걷는다 — 매 사이클 비우면
      // 기초 4단계("상자에 철판 5개")가 영원히 안 넘어가고, 그러면 심화 트랙 자체가
      // 안 열려 advancedTutorialDone 이 0/9 가 된다.
      if (ty === 'chest') { if (ids[i][0] !== tutChest || advOn) G.takeToStock(ids[i][0]); }
      // **채광기 전부에서 걷고, 용광로 전부에 넣는다.** 확장하며 세운 용광로 8대에
      // 인서터도 벨트도 없어 광석이 갈 길이 없었다 — 전기만 먹고 40분 동안 아무것도
      // 안 만들었다(실측: 철판 956개, 탄창 12개 → 전멸).
      else if (ty === 'furnace' || ty === 'assembler' || ty === 'miner') G.takeOutputToStock(ids[i][0]);
    }
  }
  // 완제품 재고 상한 — 레시피마다 다르다. 일괄 150이면 톱니 조립기 한 대가
  // 3.0 판/s 를 요구해 전 공장 소요(0.35 톱니/s)의 8배를 빨아들인다.
  var CAP = { gear: 70, wire: 90, circuit: 70, 'belt-item': 110, 'inserter-item': 110,
              'sci-red': 130, 'sci-green': 130, ammo: 70, brick: 260,
              'iron-plate': 1e9, 'copper-plate': 1e9,
              // **상한을 목표량에 묶는다.** 8로 박아 뒀더니 강철 재고가 9가 된 순간
              // feed 가 제련로를 영원히 건너뛰었고(이 표는 "재고가 상한을 넘으면 그
              // 기계는 재료를 안 받는다"), 40분에 강철 11개에서 멈춰 철도를 못 샀다.
              // 분배기(강철 2)만 있던 시절에 맞춘 숫자가 철도가 들어오자 조용한
              // 상한이 됐다 — 목표를 올릴 때 같이 안 올라가는 상수는 이렇게 배신한다.
              steel: STEEL_WANT + 4 };
  // **재고 예비량은 작아야 한다.** 30으로 뒀더니 재고 탄창이 그 위로 올라간 적이
  // 없어 터렛이 40분 내내 빈 채로 서 있었다(실측: 터렛 1기·탄약 0 → 손실 77).
  // 터렛을 굶기지 않는 쪽이 먼저다 — 과잉 흡수는 turretCap 이 따로 막는다.
  var AMMO_RESERVE = 4;

  // 터렛 채움 상한. 한 번에 200발(=탄창 20개)씩 빨아들이면 초반 철이 통째로
  // 탄약이 되어 공장이 안 큰다. 시간이 갈수록 올린다.
  //
  // **후반 상한을 110 → 70 으로 내려 봤다가 되돌렸다.** 탄약이 철판의 21~30% 를 먹으니
  // (실측 699발 = 철판 2,796장) 그 절반을 연구로 돌리려던 것이다. 결과는 붕괴였다:
  // 손실 0 → **127**, 최저 전력 0%, 연구 7 → 4종. 격추 170·손실 0 이라는 여유는
  // 탄약을 넉넉히 채워 둔 **결과**였지 남는 몫이 아니었다 — 재고를 보고 여유라고
  // 읽으면 안 되는 자리다.
  function turretCap(t) { return t < 700 ? 40 : (t < 1400 ? 70 : 110); }
  var TURRETS = 0, TURRET_SHOTS = 0;

  // "다음 제작까지 얼마나 모자란가" — 0이면 지금 만들 수 있다.
  var RI = {};
  function recInfo(rid) { if (!RI[rid]) RI[rid] = G.recipeInfo(rid); return RI[rid]; }
  function needFracE(e) {
    if (!e || !e.recipe) return 1;
    var r = recInfo(e.recipe); if (!r) return 1;
    var worst = 0;
    for (var k in r.inp) {
      var miss = Math.max(0, r.inp[k] - ((e.inv && e.inv[k]) || 0)) / r.inp[k];
      if (miss > worst) worst = miss;
    }
    return worst;
  }

  function feed() {
    var st = G.state(), inv0 = st.inventory;
    var ids = G.entIds(), turrets = [], machines = [];
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1], id = ids[i][0];
      if (ty === 'turret') { turrets.push(id); continue; }
      if (ty === 'generator') { G.putFromStock(id); continue; }
      // 보일러도 석탄을 먹는다. 여기 안 넣으면 증기 발전소가 서 있기만 하고
      // 증기% 가 0 에 붙는다 — 지었다는 사실만 남고 도는지는 아무도 안 본다.
      //
      // **다만 발전기 다음이다.** 보일러는 1.8 MW 를 태워 900 kW 를 내므로 석탄
      // 효율이 발전기보다 나쁘다(그 대가로 버퍼를 얻는다). 같은 순위로 먹이면
      // 발전기가 굶어 전력이 무너진다 — 실측으로 최저 만족도가 90.7% → 47.2% 로
      // 떨어졌고, 그건 유체를 넣어서 생긴 손해가 아니라 **먹이는 순서**의 문제였다.
      // 재고가 넉넉할 때만, 그것도 조금씩 준다.
      if (ty === 'boiler') {
        if ((inv0['coal'] || 0) > 40) G.putFromStock(id, 4);
        continue;
      }
      if (ty !== 'assembler' && ty !== 'lab' && ty !== 'furnace') continue;
      var me = G.ent(id); if (!me) continue;
      // **의도한 레시피를 매 사이클 다시 못박는다.** 용광로는 완전히 비면 레시피가
      // 풀리고(src/25_entity.js:375), 그 다음 putFromStock 이 ITEM_IDS 순서로
      // 아무 광석이나 새 레시피로 굳힌다 — 철 용광로가 조용히 벽돌 가마가 됐다.
      // !== 검사가 필요하다: 무조건 setRecipe 하면 progress 가 매번 0으로 리셋된다.
      if (WANT[id] && me.recipe !== WANT[id]) { G.setRecipe(id, WANT[id]); me = G.ent(id); }
      if (me.recipe && (inv0[me.recipe] || 0) >= (CAP[me.recipe] || 150)) continue;
      if (needFracE(me) <= 0) continue;
      machines.push([id, needFracE(me)]);
    }
    // **총량이 아니라 부족분으로, 그리고 많이 모자란 쪽부터.** 총량으로 정렬하면
    // 철판 2개를 즉시 소비하는 톱니 조립기가 언제나 최소값이라 늘 먼저 받고, 4개가
    // 필요해 3개를 쥔 탄창 조립기는 두 번 다시 최소가 되지 못한다 (실측: 톱니 631 vs
    // 탄창 19). 그래서 부족분으로 바꿨는데 **정렬 방향이 반대였다** — 오름차순이라
    // 가장 덜 급한 기계가 먼저 받고, 한 재료가 통째로 없어 막힌 기계(부족분 1)가
    // 맨 뒤로 갔다. 적팩 조립기 셋이 입력 50개를 쥔 채 멈춰 있던 것이 그것이다
    // (구리만 50, 톱니 0). 적팩 생산 345 < 필요 410 이라 연구가 7/8 에서 막혔다.
    // **정렬 방향을 뒤집어 봤다가 되돌렸다.** 많이 모자란 쪽부터 주면 적팩 조립기가
    // 먼저 받을 줄 알았는데, 실제로는 공장 전체의 배분이 흔들려 용광로 구역이 꽉 차고
    // (배치 실패 2건) 열차가 아예 안 움직였다. 연구는 그대로 7/8 이었다.
    // 문제는 순서가 아니라 **톱니 재고가 feed 시점에 0** 이라는 것이었다.
    machines.sort(function (a, b) { return a[1] - b[1]; });
    // **한 번에 조금씩, 여러 대에.** 버퍼는 품목당 50개라, 먼저 걸린 조립기 한 대가
    // 귀한 중간재를 50개씩 가져가 주차하면 나머지가 통째로 굶는다. 녹색 연구팩 사슬이
    // 정확히 그렇게 막혔다(인서터 157개가 조립기 버퍼에 흩어져 있었다).
    // 재고가 넉넉하면(용광로의 광석처럼) 상한을 풀어 예전처럼 채운다.
    // **저축하는 동안에는 더 조인다.** 증기 발전소·철도처럼 재고를 한 순간에 요구하는
    // 구매가 걸려 있으면(ironHold > 0), 기계 보급을 품목당 3개로 낮춰 재고가 쌓일
    // 틈을 만든다. 안 그러면 흐름은 넉넉한데 재고는 영원히 0 이라 큰 것을 못 산다.
    for (var m = 0; m < machines.length; m++) {
      var mid = machines[m][0], me2 = G.ent(mid);
      var scarce = me2 && me2.type === 'assembler';
      G.putFromStock(mid, ironHold > 0 ? 3 : (scarce ? 10 : 0));
    }

    // 터렛은 예비량을 남기고 상한까지만. 20기 x 20탄창 = 400개를 한 번에 빨아들이면
    // 재고 탄창이 영원히 0이 되고, 그걸 조건으로 쓰던 과학 갈래가 통째로 막힌다.
    var cap = turretCap(st.t), tv = [], shots = 0;
    for (var q = 0; q < turrets.length; q++) {
      var te = G.ent(turrets[q]); if (te) { tv.push([turrets[q], te.ammo || 0]); shots += te.ammo || 0; }
    }
    TURRETS = tv.length; TURRET_SHOTS = shots;
    tv.sort(function (a, b) { return a[1] - b[1]; });
    for (var k2 = 0; k2 < tv.length; k2++) {
      if ((G.state().inventory['ammo'] || 0) <= AMMO_RESERVE) break;
      if (tv[k2][1] >= cap) continue;
      G.putFromStock(tv[k2][0]);
    }
  }

  // 손 조립은 **시간이 든다** — 대기열에 넣으면 재료가 즉시 빠지고 완성은 나중이다.
  // 그래서 두 가지를 지킨다:
  //   1. 대기열 길이를 넘겨 예약하지 않는다 (make 안에서도 매번 다시 본다). 한 번에
  //      7개를 밀어 넣었더니 시작 철판 60이 한 사이클에 다 톱니가 됐다.
  //   2. **줄 맨 앞이 필요로 하는 재료는 손대지 않는다.** 손 조립과 건설이 같은
  //      철판을 두고 다투면, 이기는 쪽은 언제나 조건이 헐거운 손 조립이다.
  // 손 조립은 **시간이 든다** — 대기열에 넣으면 재료가 즉시 빠지고 완성은 나중이다.
  // 그리고 손은 조건이 헐거워서 건설과 같은 철판을 두고 다투면 언제나 이긴다.
  // 그래서 우선순위를 셋으로 못박는다:
  //   (가) 줄 맨 앞이 막힌 중간재 — 딱 모자란 만큼만. 이건 줄을 푸는 일이다.
  //   (나) 없으면 죽는 것 — 탄창과 연구팩.
  //   (다) 재고 불리기 — 줄이 안 막혀 있고 철판이 넉넉할 때만.
  // (다)를 느슨하게 뒀더니 시작 철판 60이 t=0 에 인서터 12개로 바뀌어 채광기를
  // 한 대도 못 세운 채 40분이 지났다(실측: 엔티티 17개, 연구 0종).
  var HANDQ = 4;
  function craft() {
    var st0 = G.state(), inv = st0.inventory, tut = G.tutorial().prod;
    function n(k) { return inv[k] || 0; }
    if (st0.handQueue >= HANDQ) return;
    function make(rid, times) {
      for (var i = 0; i < times; i++) {
        if (G.state().handQueue >= HANDQ) return i;
        if (!G.handCraft(rid)) return i;
        inv = G.state().inventory;
      }
      return times;
    }
    var done = st0.research.done;
    var mil = done.indexOf('military') >= 0, logi = done.indexOf('logistics') >= 0;
    // 구리 용광로가 한 장이라도 구웠는가 — 그 전에는 시작 구리 30을 구리선 말고
    // 다른 데 쓰지 않는다 (구리·구리선·전주의 3각 교착 방지)
    var cuLine = (tut.byRecipe['copper-plate'] || 0) > 0;
    // 전력 대기 중이면 줄 맨 앞은 사실상 발전기다
    var pc = (powerBlock ? G.buildingInfo('generator').cost : (pendingCost() || {}));
    function short(k) { return Math.max(0, (pc[k] || 0) - n(k)); }
    // **재고에 남겨 둘 철판.** 이걸 안 두면 증기 발전소도 강철 제련도 영원히 못 산다 —
    // craft 가 매 사이클 철판을 0 으로 만들어서 재고가 한 번도 문턱을 넘지 않는다
    // (실측: 40분 내내 '철판 여유 부족 0/40', 강철은 9개에서 멈췄다. 용광로에 넣을
    // 철판조차 없었다). 흐름이 아니라 **재고**가 필요한 구매가 있다는 뜻이다.
    var free = n('iron-plate') - (pc['iron-plate'] || 0) - ironHold;
    // **톱니 재고를 잡아 두는 것은 안 된다.** 적팩 조립기가 톱니를 못 받아 멈춰 있어
    // (진단: sci-red:.:in50 — 구리만 50, 톱니 0) 24개를 남겨 봤더니, 톱니는 터렛
    // 재료이기도 해서 방어가 통째로 무너졌다(손실 0 → 24). 적팩과 터렛이 같은 자원을
    // 놓고 다투고, 이 공장에서는 터렛이 먼저다.
    var freeCu = n('copper-plate'), freeGear = n('gear') - (pc['gear'] || 0);

    // (가) 줄을 푸는 손 조립 — **재료의 재료까지 따라 내려간다.**
    // 예전엔 한 단계만 봤다: 줄 맨 앞이 조립기(회로 3)를 기다리는데 구리선이 0이면
    // 회로를 못 만들고, 구리선은 '재량'이라 줄이 막힌 동안 안 만들어져 영영 멈췄다
    // (실측: 철판 2,544·구리 904를 쌓아 두고 조립기 1대에서 40분 정지).
    function ensureItem(k, want, depth) {
      if (depth > 3 || n(k) >= want) return;
      var r = recInfo(k);
      if (!r || !r.handOk) return;                       // 광석·판은 손으로 못 만든다
      if (r.tech && done.indexOf(r.tech) < 0) return;
      var per = r.out[k] || 1;
      var batches = Math.min(3, Math.ceil((want - n(k)) / per));
      for (var m in r.inp) ensureItem(m, r.inp[m] * batches, depth + 1);
      for (var m2 in r.inp) if (n(m2) < r.inp[m2]) return;
      make(k, batches);
    }
    for (var pk in pc) ensureItem(pk, pc[pk], 0);

    // (나) 없으면 죽는 것
    if (mil) {
      var haveMag = n('ammo') + Math.floor(TURRET_SHOTS / 10);
      var wantMag = 6 + 5 * TURRETS;
      // **빈 터렛은 터렛이 아니다.** free 만 보고 만들었더니 40분에 탄창 17개가
      // 전부였고 터렛이 빈 채로 건물 66채를 잃었다. 반대로 무조건 만들면 철의
      // 38%가 탄약이 되어 공장이 t≈1050 에서 자라기를 멈춘다(탄창 446개 실측).
      // 급할 때는 무조건, 아니면 줄이 안 막혔을 때만.
      var dry = TURRET_SHOTS < 25 * TURRETS || n('ammo') < 5;
      if (haveMag < wantMag && n('iron-plate') >= 6 && (dry || !queueWaiting)) make('ammo', 2);
    }
    // 군수 전에는 적팩이 최우선이다 — 터렛이 첫 파도(t≈550)보다 늦으면 전멸한다
    // **군수는 시작 재고만으로도 낼 수 있다.** 적팩 20개 = 구리 20 + 톱니 20 인데
    // 시작 재고가 구리 30 · 톱니 30 이다. 그런데 이 줄이 '구리 용광로가 한 장이라도
    // 구웠는가(cuLine)' 를 기다리고 있어서 군수 연구가 t≈400 까지 밀렸고, 첫 습격
    // (t≈450)에 터렛이 1~2기뿐이라 발전기를 잃었다(t=507). 그 구멍은 게임 설계가
    // 아니라 **드라이버의 출발 순서** 문제다.
    //
    // 구리를 다 쓰면 구리선 → 전주가 막히므로(그게 cuLine 가드의 원래 이유다)
    // 전주 몫 12 를 남기고 그 위로만 적팩에 쓴다.
    var CU_KEEP_FOR_WIRE = 12;
    if ((cuLine || freeCu >= CU_KEEP_FOR_WIRE + 3) && !mil && n('sci-red') < 26 &&
        freeGear >= 2 && (cuLine ? freeCu >= 3 : freeCu >= CU_KEEP_FOR_WIRE + 3)) {
      make('sci-red', 3);
    }
    if (cuLine && n('sci-red') < 45 && freeGear >= 8 && freeCu >= 10) make('sci-red', 3);
    // 녹색 연구팩 — 완성품을 재료로 먹는다. 심화 1단계이자 후반 연구 4종의 관문.
    if (logi && n('sci-green') < 40 && n('belt-item') >= 4 && n('inserter-item') >= 4) make('sci-green', 2);
    // 제어기(회로 5)는 계획 밖(runStages)에서 세우므로 pendingCost 가 못 본다.
    if (n('circuit') < 8 && n('copper-plate') >= 8 && free >= 4) ensureItem('circuit', 8, 0);

    // (다) 재고 불리기 — 여기부터는 여유가 있을 때만
    if (queueWaiting || free < 25) return;
    if (freeCu >= 12 && n('wire') < 30) make('wire', 3);
    if (n('gear') < 30) make('gear', 3);
    if (n('wire') >= 9 && n('circuit') < 16) make('circuit', 3);
    // 벨트·인서터는 시작 재고(60·12)로 초반이 충분하다. 녹팩 재료가 된 뒤에만 만든다.
    if (logi && n('belt-item') < 24 && n('gear') >= 6) make('belt-item', 2);
    if (logi && n('inserter-item') < 24 && n('gear') >= 6 && n('circuit') >= 6) make('inserter-item', 2);
  }

  // --- 튜토리얼 트랙 ---------------------------------------------------------
  // **심화 판정은 현재 트랙의 단계 배열에서만 찾는다**(60_game.js 의
  // tutorialCheckById → curSteps). 기초 트랙에 머무르면 심화 9단계 전부가 null →
  // 0/9 가 된다. 그래서 기초 10단계를 세계 상태로 실제로 통과한 뒤 심화로 넘긴다.
  var advOn = false;
  function tutorTick() {
    var t = G.tutorial();
    if (t.track === 'adv') { advOn = true; return; }
    if (t.done) { if (G.tutorialAdvance()) { advOn = true; note('심화 트랙 진입'); } }
  }

  // --- 연구 순서 (선행 조건을 지킨다) ----------------------------------------
  // 군수가 첫째 — 터렛·벽·탄창이 전부 여기 걸려 있고 습격 유예는 300초뿐이다.
  // 강철을 셋째로 올린다 — 분배기가 강철 연구로 옮겨 갔기 때문에, 그 전에
  // 분배기를 놓으려 하면 '잠김'으로 배치가 실패한다.
  // **생산 효율을 고속 벨트보다 먼저 든다.** 둘 다 적100+녹100 인데 효과가 다르다 —
  // 생산 효율은 기계를 1.5배로 돌려 **그 뒤의 연구팩 생산 자체를 앞당기고**, 고속 벨트는
  // 이 주행처럼 라인이 짧은 판에서는 거의 아무 일도 하지 않는다. 예전 순서로는 마지막
  // 생산 효율이 76% 에서 시간이 끝났다.
  var TECH_ORDER = ['military', 'logistics', 'steel', 'logic-mem',
                    'logic-ctrl', 'automation-2', 'defense-ai', 'belt-2'];
  // 연구가 **언제** 끝났는지 남긴다. 통과/실패만 보면 마지막 연구가 종료 1초 전에
  // 겨우 끝난 판과 여유 있게 끝난 판이 똑같이 GREEN 으로 보인다 — 앞의 것은 다음
  // 변경 한 번에 뒤집히는 GREEN 이고, 그 사실이 결과에 안 나타나면 아무도 모른다.
  var techAt = {};
  function nextTech() {
    var st = G.state(), done = st.research.done;
    for (var ti = 0; ti < done.length; ti++) {
      if (techAt[done[ti]] === undefined) techAt[done[ti]] = Math.round(st.t * 10) / 10;
    }
    if (st.research.current) return null;
    for (var i = 0; i < TECH_ORDER.length; i++) {
      if (done.indexOf(TECH_ORDER[i]) < 0 && G.setResearch(TECH_ORDER[i])) return TECH_ORDER[i];
    }
    return null;
  }

  // --- 제어기 4대 (노드 전 종류를 살아 있는 회로에 건다) ----------------------
  function nd(c, kind, x, y) { var id = G.gAdd(c, kind, x, y); markNode(kind); return id; }
  // 문장(규칙)으로 회로를 만든다. kinds 는 이 문장이 컴파일되며 쓰는 노드 종류 —
  // "노드를 다 써 봤는가" 판정에 그대로 센다. 컴파일 뒤 실제 그래프와
  // 대조해 **적어 낸 종류가 진짜로 생겼는지** 확인한다(적어만 내고 안 생기면
  // 판정이 거짓말이 된다).
  function rule(c, patch, kinds) {
    var id = G.ruleAdd(c, patch);
    if (id === null) { out.fails.push('규칙 추가 실패 @제어기 ' + c); return null; }
    for (var i = 0; i < (kinds || []).length; i++) markNode(kinds[i]);
    return id;
  }
  function verifyRuleKinds(c, claimed) {
    var have = {};
    var ns = G.gNodes(c);
    for (var i = 0; i < ns.length; i++) have[ns[i].kind] = 1;
    var miss = claimed.filter(function (k) { return !have[k]; });
    if (miss.length) out.fails.push('제어기 ' + c + ': 문장이 만들었다고 적은 노드가 없다 — ' + miss.join(','));
    return miss.length === 0;
  }
  var ctrl1 = null, ctrl2 = null, ctrl3 = null, ctrl4 = null;

  // 제어기 1 — 부하 차단 (여유kW + 래치 + 타이머). 심화 3·4·5·6단계가 여기 걸린다.
  function stageCtrl1() {
    if (ctrl1) return true;
    var lab = findOne('lab');
    if (!lab) return false;
    // 부하 차단은 **기억소자**가 있어야 성립한다. 연구 전에 세우면 문장이
    // 컴파일을 거부하고(잠긴 노드는 조용히 0을 내므로 그게 맞다) 회로가 안 생긴다.
    // 예전 손배선은 이걸 못 보고 죽은 래치를 만들어 두고 있었다.
    if (!researched('logic-mem')) return false;
    if (!afford('controller')) return false;
    var c = spiral('controller', 76, 74, 0, 6);
    if (!c) { c = placeIn('controller', CORE_RC, 0); }
    if (!c || c === 'mat' || c === 'tech') return false;
    ctrl1 = c; ctrlIds.push(c);
    look(80, 78, 0.9);
    // **문장으로 쓴다.** 플레이어가 실제로 만나는 길이 이것이고, 노드를 직접
    // 배선하면 그 길은 한 번도 안 지나간다. 컴파일 결과는 회로이므로 심화
    // 튜토리얼 판정(전력→래치→가동, RESET 이 타이머를 거치는가)도 그대로 받는다.
    //
    //   만약 [전기 여유] 가 [0kW] [보다 작으면] → [연구소] 를 [끈다]
    //   다시 [200kW] [보다 크면] 되돌리되, 되돌리기는 [30초]에 한 번만
    //
    // 되돌리는 쪽만 늦춘다 — 끊는 쪽까지 늦추면 전기가 모자란 채로 버틴다.
    rule(c, { name: '전기부족',
      when: { src: 'powerHead', cmp: '<', value: 0 },
      memo: { kind: 'latch', resetCmp: '>', resetValue: 200, everySec: 30 },
      then: { act: 'run', ent: lab, onWhenTrue: false } },
      ['power', 'const', 'cmp', 'latch', 'timer', 'bool', 'enable']);
    rule(c, { when: { src: 'powerHead', cmp: '>=', value: -1e9 },
              then: { act: 'display', label: '여유kW' } }, ['display']);
    G.ruleCompile(c);
    verifyRuleKinds(c, ['power', 'const', 'cmp', 'latch', 'timer', 'bool', 'enable', 'display']);
    // 기초 8단계는 "편집기를 열었는가"를 플래그로 본다 — 상태로는 못 보는 사건이다
    try { G.ui.openLogic(c); G.ui.closeLogic(); } catch (e) { void e; }
    note('제어기1: 부하 차단 (여유kW·래치·타이머)');
    return true;
  }

  // 제어기 2 — 재고 히스테리시스 + 경보 + 벨트 게이트
  function stageCtrl2() {
    if (ctrl2) return true;
    if (!tutChest || !tutBelt) return false;
    // 재고 히스테리시스도 래치를 쓰고, 벨트 게이트는 논리 III 가 필요하다
    if (!researched('logic-mem') || !researched('logic-ctrl')) return false;
    if (!afford('controller')) return false;
    var c = placeIn('controller', CORE_RC, 0);
    if (!c || c === 'mat' || c === 'tech') { c = spiral('controller', 84, 78, 0, 8); }
    if (!c) return false;
    ctrl2 = c; ctrlIds.push(c);
    // 재고 히스테리시스 · 경보 · 벨트 게이트 — 셋 다 문장 세 줄이다.
    rule(c, { name: '철판부족',
      when: { src: 'chest', ent: tutChest, item: 'iron-plate', cmp: '<', value: 50 },
      memo: { kind: 'latch', resetCmp: '>', resetValue: 200 },
      then: { act: 'lamp', label: '철판 부족' } },
      ['chest', 'const', 'cmp', 'latch', 'lamp']);
    // 재고가 넘치면 벨트를 막는다 (논리 III). 조건이 참일 때 '막는다' 이므로
    // 컴파일러가 NOT 한 단을 대신 넣는다 — 문장에는 그 말이 안 나온다.
    rule(c, { when: { src: 'chest', ent: tutChest, item: 'iron-plate', cmp: '>', value: 200 },
              then: { act: 'gate', ent: tutBelt, onWhenTrue: false } },
      ['bool', 'gate']);
    G.ruleCompile(c);
    verifyRuleKinds(c, ['chest', 'const', 'cmp', 'latch', 'lamp', 'bool', 'gate']);
    note('제어기2: 재고 히스테리시스 + 경보 + 벨트 게이트');
    return true;
  }

  // 제어기 3 — 방어 자동화 + 나머지 노드 전부
  function stageCtrl3() {
    if (ctrl3) return true;
    var tur = findOne('turret'), asm = findOne('assembler');
    var inss = findAll('inserter');
    if (!tur || !asm || !inss.length || !tutBelt) return false;
    if (!afford('controller')) return false;
    var c = placeIn('controller', CORE_RC, 0);
    if (!c || c === 'mat' || c === 'tech') { c = spiral('controller', 78, 84, 0, 8); }
    if (!c) return false;
    ctrl3 = c; ctrlIds.push(c);
    look(80, 76, 0.85);
    // 적 근접 → 경보 + 터렛 사격허가
    var en2 = nd(c, 'enemy', 20, 20); G.gCfg(c, en2, 'radius', 30);
    var z = nd(c, 'const', 20, 200); G.gCfg(c, z, 'value', 0);
    var cA = nd(c, 'cmp', 240, 20); G.gCfg(c, cA, 'op', '>');
    G.gLink(c, en2, 0, cA, 0); G.gLink(c, z, 0, cA, 1);
    var lamp2 = nd(c, 'lamp', 460, 20); G.gCfg(c, lamp2, 'label', '습격');
    G.gLink(c, cA, 0, lamp2, 0);
    var one = nd(c, 'const', 240, 160); G.gCfg(c, one, 'value', 1);
    var fr = nd(c, 'fire', 460, 160); G.gCfg(c, fr, 'ent', tur);
    G.gLink(c, one, 0, fr, 0);
    // 인서터 필터 — 적이 오면 탄창만 집게 한다
    var fl = nd(c, 'filter', 460, 300);
    G.gCfg(c, fl, 'ent', inss[inss.length - 1]);
    G.gCfg(c, fl, 'a', 'iron-ore'); G.gCfg(c, fl, 'b', 'ammo');
    G.gLink(c, cA, 0, fl, 0);
    // 나머지 노드도 전부 살아 있는 회로에 건다 — 안 써 본 기능은 안 들킨 기능이다
    var mach = nd(c, 'machine', 20, 340); G.gCfg(c, mach, 'ent', asm);
    var iv = nd(c, 'invsense', 20, 480); G.gCfg(c, iv, 'item', 'iron-plate');
    var bs = nd(c, 'belt', 20, 620); G.gCfg(c, bs, 'ent', tutBelt);
    var rs = nd(c, 'research', 20, 760);
    var mt = nd(c, 'math', 240, 480); G.gCfg(c, mt, 'op', '/');
    var hun = nd(c, 'const', 20, 900); G.gCfg(c, hun, 'value', 100);
    G.gLink(c, iv, 0, mt, 0); G.gLink(c, hun, 0, mt, 1);
    var cl = nd(c, 'clamp', 460, 480); G.gCfg(c, cl, 'lo', 0); G.gCfg(c, cl, 'hi', 1);
    G.gLink(c, mt, 0, cl, 0);
    var sel = nd(c, 'select', 660, 480);
    G.gLink(c, cA, 0, sel, 0); G.gLink(c, iv, 0, sel, 1); G.gLink(c, z, 0, sel, 2);
    var ed = nd(c, 'edge', 240, 620); G.gCfg(c, ed, 'mode', '상승');
    G.gLink(c, cA, 0, ed, 0);
    var cnt = nd(c, 'counter', 460, 620); G.gCfg(c, cnt, 'max', 0);
    G.gLink(c, ed, 0, cnt, 0);
    var hd = nd(c, 'hold', 660, 620);
    G.gLink(c, iv, 0, hd, 0); G.gLink(c, ed, 0, hd, 1);
    var pid = nd(c, 'pid', 240, 900);
    G.gCfg(c, pid, 'kp', 1); G.gCfg(c, pid, 'ki', 0.1); G.gCfg(c, pid, 'kd', 0); G.gCfg(c, pid, 'lim', 100);
    G.gLink(c, hun, 0, pid, 0); G.gLink(c, iv, 0, pid, 1);
    var d2 = nd(c, 'display', 880, 620); G.gCfg(c, d2, 'label', '습격횟수');
    G.gLink(c, cnt, 0, d2, 0);
    var d3 = nd(c, 'display', 880, 760); G.gCfg(c, d3, 'label', '연구%');
    G.gLink(c, rs, 0, d3, 0);
    // 재고는 인서터가 집을 때마다 튄다. 평활 필터로 눅여서 표시하고, 그 값을
    // 신호 버스 A 로 내보낸다 — 받는 쪽은 제어기 4다.
    var smo = nd(c, 'smooth', 460, 900); G.gCfg(c, smo, 'tau', 10);
    G.gLink(c, iv, 0, smo, 0);
    // 변화율 — **얼마나 남았나가 아니라 얼마나 빨리 줄고 있나.** 눅인 재고의 기울기를
    // 띄워 두면 "줄고 있다" 를 눈으로 볼 수 있다. 노드를 늘리면 이 주행도 같이 늘어야
    // 한다(clear.allNodeKindsWired 가 기준을 게임의 목록에서 읽는다 — 교훈 17).
    // 지속 조건 — 습격 감지가 한 틱 스쳐도 경보가 켜지지 않게 3초를 요구한다.
    // 노드를 늘리면 이 주행도 같이 늘어야 한다(clear.allNodeKindsWired · 교훈 17).
    var su = nd(c, 'sustain', 660, 20); G.gCfg(c, su, 'sec', 3);
    G.gLink(c, cA, 0, su, 0);
    var d7 = nd(c, 'display', 880, 20); G.gCfg(c, d7, 'label', '습격 3초+');
    G.gLink(c, su, 0, d7, 0);
    var rt = nd(c, 'rate', 660, 900); G.gCfg(c, rt, 'win', 5);
    G.gLink(c, smo, 0, rt, 0);
    var d6 = nd(c, 'display', 880, 1320); G.gCfg(c, d6, 'label', '철판 변화/s');
    G.gLink(c, rt, 0, d6, 0);
    var d4 = nd(c, 'display', 880, 900); G.gCfg(c, d4, 'label', '철판(평활)');
    G.gLink(c, smo, 0, d4, 0);
    var snd = nd(c, 'bussend', 880, 1040); G.gCfg(c, snd, 'ch', 'A');
    G.gLink(c, smo, 0, snd, 0);
    // 습격이 한 번 올 때마다 한 단계씩 도는 상태기계. 네 전이를 같은 펄스에 물려
    // 1→2→3→4→1 로 순환시킨다 (레벨이 아니라 상승엣지라서 습격 한 번에 한 칸이다).
    var fsm3 = nd(c, 'fsm', 660, 760);
    G.gLink(c, ed, 0, fsm3, 0); G.gLink(c, ed, 0, fsm3, 1);
    G.gLink(c, ed, 0, fsm3, 2); G.gLink(c, ed, 0, fsm3, 3);
    G.gLink(c, z, 0, fsm3, 4);
    var d5 = nd(c, 'display', 880, 1180); G.gCfg(c, d5, 'label', '습격단계');
    G.gLink(c, fsm3, 0, d5, 0);
    out.measured.ctrl3 = G.gInfo(c);
    note('제어기3: 방어 자동화 + 평활/상태기계/신호송신');
    return true;
  }

  // 제어기 4 — 신호 버스를 **받는** 쪽. 보내는 회로만 있으면 채널이 실제로
  // 건너가는지는 이 주행이 한 번도 안 지나간다.
  function stageCtrl4() {
    if (ctrl4) return true;
    if (!ctrl3) return false;                       // 보내는 쪽이 먼저다
    if (!researched('logic-ctrl')) return false;
    if (!afford('controller')) return false;
    var c = placeIn('controller', CORE_RC, 0);
    if (!c || c === 'mat' || c === 'tech') { c = spiral('controller', 74, 86, 0, 8); }
    if (!c) return false;
    ctrl4 = c; ctrlIds.push(c);
    var rcv = nd(c, 'busrecv', 20, 20); G.gCfg(c, rcv, 'ch', 'A');
    var lim = nd(c, 'const', 20, 160); G.gCfg(c, lim, 'value', 50);
    var cmp4 = nd(c, 'cmp', 240, 20); G.gCfg(c, cmp4, 'op', '<');
    G.gLink(c, rcv, 0, cmp4, 0); G.gLink(c, lim, 0, cmp4, 1);
    var lmp4 = nd(c, 'lamp', 460, 20); G.gCfg(c, lmp4, 'label', '철판 부족(신호)');
    G.gLink(c, cmp4, 0, lmp4, 0);
    note('제어기4: 신호 버스 수신 → 재고 경보');
    return true;
  }

  // 분배기 — 강철 연구가 열어 준 것. 강철은 손으로 못 만든다(용광로 전용).
  // **줄에 두면 안 된다**: 계획 맨 끝이라 40분 안에 차례가 오지 않는다(실측:
  // 강철 4개를 손에 쥐고도 건물 12/13 종으로 끝났다). 제어기와 같이 밖에서 세운다.
  function stageSplitter() {
    if (usedBuildings.splitter) return true;
    if (!techOk('splitter')) return false;
    if ((invNow()['steel'] || 0) < 2 || !afford('splitter')) return false;
    if (spiral('splitter', 84, 80, 2, 12)) { note('분배기 배치 (강철)'); return true; }
    out.fails.push('분배기 자리 없음');
    return true;
  }
  // --- 증기 발전소 (파이프·펌프·보일러·증기기관) -------------------------------
  // **이 단계가 없어서 유체 4종이 40분 동안 한 번도 안 세워졌다.** 모델 게이트는
  // 전부 GREEN 이었는데, 그 게이트들은 리그가 세운 실험 설비를 잰다. 완주 주행은
  // "플레이어가 실제로 지어 쓰는가"를 재는 유일한 자리다.
  //
  // 넷을 **맞닿게** 놓아야 한 유체망이 된다(대각선은 안 이어진다). 가로 한 줄:
  //   펌프(1x1) │ 보일러(2x2) │ 증기기관(3x2)
  // 자리를 손으로 찍으면 확장할 때마다 밟으니 구역만 정하고 자리는 찾게 한다.
  var steamSpot = null;
  function findSteamSpot() {
    for (var y = 64; y <= 92; y++) {
      for (var x = 64; x <= 92; x++) {
        if (G.whyPlace('pump', x, y, 0) !== 'ok') continue;
        if (G.whyPlace('boiler', x + 1, y, 0) !== 'ok') continue;
        if (G.whyPlace('engine', x + 3, y, 0) !== 'ok') continue;
        // 증기기관은 **망에 들어가야 공급한다.** needsNet 은 소비 건물만 보므로
        // (bi.power 가 있는 것) 여기서 직접 전주 자리를 확인한다. 망 밖에 세우면
        // 900kW 가 조용히 0 이 되고, 그건 게이트가 아니라 눈으로도 안 보인다.
        for (var dx = -1; dx <= 6; dx++) {
          for (var dy = -1; dy <= 2; dy++) {
            var px = x + dx, py = y + dy;
            if (px >= x && px <= x + 5 && py >= y && py <= y + 1) continue;
            if (poleLinked(px, py) && G.whyPlace('pole', px, py, 0) === 'ok') {
              return { x: x, y: y, px: px, py: py };
            }
          }
        }
      }
    }
    return null;
  }
  // **막힌 이유를 남긴다.** 첫 실행에서 두 단계가 통째로 안 돌았는데 게이트는
  // "안 지어졌다"까지만 알려 줬다. 무엇을 기다리다 40분을 보냈는지는 안 나온다 —
  // 재료인지, 자리인지, 기술인지. 그 셋은 고치는 방법이 전혀 다르다.
  var steamWhy = '아직 시도 전', trainWhy = '아직 시도 전';
  function why(kind, msg) { if (kind === 's') steamWhy = msg; else trainWhy = msg; return false; }
  var steamDone = false;
  function stageSteam() {
    if (steamDone) return true;
    if (!researched('steel')) return why('s', '강철 연구 대기');
    if ((invNow()['iron-plate'] || 0) > ironPeak) ironPeak = invNow()['iron-plate'] || 0;
    // 파이프 아이템은 손으로 만든다(철판 1장). 네 건물이 통틀어 11개를 먹는다.
    //
    // **파이프는 철판의 안전한 저축이다.** 이 판의 어느 기계도 파이프를 재료로 안
    // 쓰므로 feed 가 못 가져간다. 철판을 재고에 두면 다음 사이클에 사라지지만
    // 파이프로 바꿔 두면 남는다 — 큰 것을 사려면 안 없어지는 형태로 모아야 한다.
    if ((invNow()['pipe-item'] || 0) < 11) {
      if ((invNow()['iron-plate'] || 0) < 4) {
        return why('s', '철판 부족 ' + (invNow()['iron-plate'] || 0) + ' (파이프 재료, 최대 ' + ironPeak + ')');
      }
      for (var i = 0; i < 3 && (invNow()['pipe-item'] || 0) < 11; i++) {
        if (!G.handCraft('pipe-item')) break;
      }
      return why('s', '파이프 ' + (invNow()['pipe-item'] || 0) + '/11 제작 중');
    }
    // **자리는 고정, 구매는 부품별.** 처음엔 넷을 한꺼번에 살 수 있을 때까지
    // 기다리게 했는데, 이 공장은 철판 40장을 한 순간에 가진 적이 **한 번도 없다**
    // (실측: 40분 내내 최대 8). 흐름은 넉넉한데 재고가 안 쌓이는 경제다 —
    // feed 가 매 사이클 기계 버퍼로 밀어 넣기 때문이다.
    //
    // 반대로 처음 판에서는 부품별로 사되 **실패하면 자리를 새로 찾았다.** 그게
    // 누수였다: 펌프·보일러를 세우고 증기기관에서 실패하면 다음 사이클에 다른 자리에
    // 펌프와 보일러를 또 지었다(철판 0, 탄약 끊김, 손실 3→7). 누수의 원인은 부분
    // 건설이 아니라 **자리를 바꾼 것**이었다. 자리를 못 박으면 부분 건설은 안전하다.
    var iv = invNow();
    if (!steamSpot) steamSpot = findSteamSpot();
    if (!steamSpot) return why('s', '자리 없음 (전주가 닿는 6x2 공터를 못 찾았다)');
    var s = steamSpot;
    if (!steamParts.pump && afford('pump')) {
      steamParts.pump = G.build('pump', s.x, s.y, 0);
      if (steamParts.pump) markBuilt('pump');
    }
    if (!steamParts.boiler && afford('boiler')) {
      steamParts.boiler = G.build('boiler', s.x + 1, s.y, 0);
      if (steamParts.boiler) markBuilt('boiler');
    }
    if (!steamParts.engine && afford('engine')) {
      steamParts.engine = G.build('engine', s.x + 3, s.y, 0);
      if (steamParts.engine) markBuilt('engine');
    }
    if (!steamParts.pump || !steamParts.boiler || !steamParts.engine) {
      return why('s', '부품 대기 — 펌프 ' + (steamParts.pump ? 'O' : 'X') +
                      ' 보일러 ' + (steamParts.boiler ? 'O' : 'X') +
                      ' 증기기관 ' + (steamParts.engine ? 'O' : 'X') +
                      ' · 지금 철판 ' + (iv['iron-plate'] || 0) + ' 파이프 ' + (iv['pipe-item'] || 0) +
                      ' 기어 ' + (iv['gear'] || 0) + ' 벽돌 ' + (iv['brick'] || 0) +
                      ' (철판 최대 ' + ironPeak + ')');
    }
    putPole(s.px, s.py);
    // 파이프 한 칸을 보일러 위에 덧대 **망이 실제로 이어지는지**를 눈에 보이게 한다.
    // 없어도 셋은 맞닿아 있지만, 파이프 자체가 안 쓰인 건물로 남는다.
    if (!steamParts.pipe) {
      if (G.whyPlace('pipe', s.x + 1, s.y - 1, 0) === 'ok') {
        steamParts.pipe = G.build('pipe', s.x + 1, s.y - 1, 0);
      }
      if (!steamParts.pipe && G.whyPlace('pipe', s.x + 1, s.y + 2, 0) === 'ok') {
        steamParts.pipe = G.build('pipe', s.x + 1, s.y + 2, 0);
      }
      if (steamParts.pipe) markBuilt('pipe');
    }
    steamEnt = { boiler: steamParts.boiler, engine: steamParts.engine, pump: steamParts.pump };
    steamDone = true;
    note('증기 발전소: 펌프·보일러·증기기관 (' + s.x + ',' + s.y + ')');
    return true;
  }
  var steamEnt = null, steamParts = { pump: null, boiler: null, engine: null, pipe: null, tank: null, xpump: null };

  // --- 저장 탱크 --------------------------------------------------------------
  // **발전소가 선 뒤에 따로 산다.** 처음엔 발전소 단계 안에 넣고 파이프 저축 목표를
  // 11 → 21 로 올렸는데, 그러면 탱크 재료를 모으느라 발전소 자체가 늦어져 제어기
  // 2·4·5 가 통째로 밀렸다(노드 32 → 26). 나중에 사는 것은 나중에 사야 한다.
  var tankDone = false, tankWhy = '아직 시도 전';
  function stageTank() {
    if (tankDone) return true;
    if (!steamDone || !steamSpot) return false;      // 붙일 망이 먼저다
    if (!ctrl2 || !ctrl4 || !ctrl5) { tankWhy = '제어기 먼저 (2·4·5)'; return false; }
    var iv = invNow();
    if (!afford('tank')) {
      tankWhy = '재료 대기 — 강철 ' + (iv['steel'] || 0) + '/5 철판 ' + (iv['iron-plate'] || 0) + '/20';
      return false;
    }
    // **제어기가 다 선 뒤에 산다.** 탱크는 철판 20 과 파이프 10(= 철판 10)을 먹는데,
    // 제어기의 병목은 철판이 아니라 **회로**이고 회로도 철을 거쳐 온다. 철판 여유분만
    // 남겨 봤지만 제어기 2·4 가 여전히 못 섰다(노드 32 → 29). 탱크는 후반의 완충이라
    // 순서를 뒤로 미루는 편이 맞다 — 커버리지를 지키면서 늦게 사면 둘 다 된다.
    // **탱크를 발전소에 붙이지 않는다.** 붙이면 한 망이 되어 완충이 그냥 커질 뿐인데,
    // 한 칸 띄우고 그 사이에 **이송 펌프**를 두면 두 망이 남남인 채로 "언제 옮길지" 를
    // 제어기가 정할 수 있다 — 이 게임이 유체를 넣은 이유가 거기까지 간다.
    //   발전소는 (s2.y) ~ (s2.y+1) 두 줄. 이송 펌프를 s2.y+2 에 아래 방향으로 두면
    //   뒤가 발전소 망, 앞이 탱크 망이 된다. 탱크는 s2.y+3 부터 3x3.
    // **탱크가 먼저다.** 처음엔 이송 펌프용 파이프를 먼저 만들게 했는데, 그 철판
    // 2장이 탱크 예산을 밀어내 탱크조차 못 샀다(철판 10/20 에서 종료). 큰 것을 먼저
    // 사고 작은 것을 나중에 붙인다 — 순서만 바꾸면 둘 다 된다.
    var s2 = steamSpot;
    if (!steamParts.tank) {
      // **자리 조건을 까다롭게 걸었다가 탱크 자체를 못 세웠다.** 탱크(3x3)와 이송
      // 펌프 자리를 동시에 요구하니 맞는 열이 없었고, 재고가 20 을 넘는 짧은 순간을
      // 그냥 흘려보냈다(실측: 건물 21종 → 20종). 넓게 훑고, 그래도 없으면 **검증된
      // 예전 자리**(발전소에 붙이기)로 물러난다 — 탱크를 세우는 것이 먼저다.
      for (var tdx = -2; tdx <= 7 && !steamParts.tank; tdx++) {
        if (G.whyPlace('tank', s2.x + tdx, s2.y + 3, 0) !== 'ok') continue;
        if (G.whyPlace('xpump', s2.x + tdx, s2.y + 2, 2) !== 'ok') continue;
        steamParts.tank = G.build('tank', s2.x + tdx, s2.y + 3, 0);
        if (steamParts.tank) { tankAt = s2.x + tdx; tankSplit = true; }
      }
      for (var tdx2 = -1; tdx2 <= 5 && !steamParts.tank; tdx2++) {
        if (G.whyPlace('tank', s2.x + tdx2, s2.y + 2, 0) !== 'ok') continue;
        steamParts.tank = G.build('tank', s2.x + tdx2, s2.y + 2, 0);   // 예전 자리(같은 망)
      }
      if (!steamParts.tank) { tankWhy = '자리 없음 (발전소 아래 3x3)'; return false; }
      markBuilt('tank');
      note(tankSplit ? '저장 탱크 — 발전소와 한 칸 띄워 다른 망으로 둔다'
                     : '저장 탱크 — 발전소에 붙임(이송 펌프 자리를 못 잡았다)');
    }
    // **두 번째 망에 탱크가 필요한 것은 아니다.** 처음엔 탱크를 한 칸 띄워 그쪽을
    // 두 번째 망으로 삼으려 했는데, 3x3 자리와 펌프 자리를 동시에 요구하니 맞는 열이
    // 없어 펌프를 아예 못 세웠다. **파이프 한 칸이면 망 하나다** — 펌프 앞에 파이프를
    // 한 칸 두면 그것으로 충분하고, 자리 조건이 3x3 에서 두 칸으로 줄어든다.
    // 이송 펌프 + 그 앞의 파이프 한 칸(= 두 번째 망). 파이프 3개가 든다(펌프 2 + 망 1).
    if (!steamParts.xpump) {
      if ((invNow()['pipe-item'] || 0) < 3) {
        if ((invNow()['iron-plate'] || 0) < 8) { tankWhy = '펌프용 철판 대기'; return false; }
        G.handCraft('pipe-item'); G.handCraft('pipe-item'); G.handCraft('pipe-item');
        tankWhy = '이송 펌프용 파이프 ' + (invNow()['pipe-item'] || 0) + '/3 제작 중';
        return false;
      }
      if (!afford('xpump')) { tankWhy = '이송 펌프 재료 대기'; return false; }
      // 발전소 아래 줄에서 **두 칸이 연달아 빈 열**을 찾는다: 펌프(y+2) + 파이프(y+3).
      for (var xk = -2; xk <= 7 && !steamParts.xpump; xk++) {
        var px2 = s2.x + xk;
        if (G.whyPlace('xpump', px2, s2.y + 2, 2) !== 'ok') continue;
        if (G.whyPlace('pipe', px2, s2.y + 3, 0) !== 'ok') continue;
        var xp = G.build('xpump', px2, s2.y + 2, 2);                 // dir 2 = 아래
        if (!xp) continue;
        steamParts.xpump = xp;
        if (G.build('pipe', px2, s2.y + 3, 0)) markBuilt('pipe');    // 두 번째 망
      }
      if (!steamParts.xpump) { tankWhy = '이송 펌프 자리 없음 (발전소 아래 두 칸)'; return false; }
      markBuilt('xpump'); ensureNet(steamParts.xpump);
      note('이송 펌프 — 발전소 망에서 옆 망으로 200/s (두 망은 남남)');
    }
    tankDone = true;
    return true;
  }
  var tankAt = 0, tankSplit = false;

  // --- 철도 (레일·역·열차) ----------------------------------------------------
  // 최소한이되 **실제로 도는** 노선이다. 한 대가 두 역 사이를 왕복하고, 출발역에는
  // 인서터가 붙어 짐을 싣는다. 역이 하나면 열차는 서 있기만 하고, 그러면 이 주행은
  // "열차를 놓았다"만 증명하지 "열차가 다닌다"를 증명하지 못한다.
  //   레일 6칸 가로줄 · 양 끝 위에 역 2대 · 왼쪽 끝 레일 위에 열차
  var RAIL_LEN = 6;
  function findRailSpot() {
    for (var y = 66; y <= 92; y++) {
      for (var x = 64; x <= 88; x++) {
        var ok = true, i;
        for (i = 0; i < RAIL_LEN && ok; i++) if (G.whyPlace('rail', x + i, y, 0) !== 'ok') ok = false;
        if (!ok) continue;
        if (G.whyPlace('station', x, y - 1, 0) !== 'ok') continue;
        if (G.whyPlace('station', x + RAIL_LEN - 1, y - 1, 0) !== 'ok') continue;
        return { x: x, y: y };
      }
    }
    return null;
  }
  var railDone = false, stationA = null, stationB = null, trainId = null;
  var railSpot = null, railTiles = [];
  function stageTrain() {
    if (railDone) return true;
    if (!researched('steel')) return why('t', '강철 연구 대기');
    var inv = invNow();
    // 전부 한꺼번에 산다 — 레일만 깔고 강철이 떨어지면 열차 없는 선로가 남는다.
    var needSteel = RAIL_LEN + 2 * 2 + 10;
    if ((inv['steel'] || 0) < needSteel) {
      // **왜 안 모이는지까지 남긴다.** 재고만 보면 "강철 9/20"이고, 그게 제련이
      // 느린 것인지 다 써 버린 것인지 용광로가 놀고 있는 것인지 구별이 안 된다.
      var fe = steelFurn ? G.ent(steelFurn) : null;
      return why('t', '강철 ' + (inv['steel'] || 0) + '/' + needSteel +
                      ' · 누계 제련 ' + ((G.tutorial().prod.byRecipe || {})['steel'] || 0) +
                      ' · 제련로 ' + (fe ? (fe.recipe || '-') + (fe.working ? '(가동)' : '(정지)') : '없음') +
                      ' · 지금 철판 ' + (inv['iron-plate'] || 0) + ' (최대 ' + ironPeak + ')');
    }
    if ((inv['stone'] || 0) < RAIL_LEN) return why('t', '돌 ' + (inv['stone'] || 0) + '/' + RAIL_LEN);
    // **강철만 한꺼번에 본다.** 강철은 이 판에서 아무도 안 뺏어 가는 자원이라
    // (제련 상한을 목표에 묶어 뒀다) 한 번 모으면 남는다 — 그래서 노선 전체분을
    // 확보한 뒤에 착공하는 게 맞다. 반대로 철판·회로는 매 순간 다른 데로 흘러
    // 나가서 "한 순간에 10장"을 요구하면 40분 내내 못 넘는다(실측: 5/10 에서 종료).
    // 그래서 나머지는 **부품별로** 산다. 자리를 못 박아 뒀으니 부분 건설은 안전하다.
    if (!railSpot) railSpot = findRailSpot();
    if (!railSpot) return why('t', '자리 없음 (레일 ' + RAIL_LEN + '칸 + 역 2대가 들어갈 줄을 못 찾았다)');
    var s = railSpot;
    var i, rid;
    for (i = 0; i < RAIL_LEN; i++) {
      if (railTiles[i]) continue;
      rid = G.build('rail', s.x + i, s.y, 0);
      if (!rid) return why('t', '레일 배치 실패 @' + (s.x + i) + ',' + s.y);
      railTiles[i] = rid; markBuilt('rail');
    }
    if (!stationA && afford('station')) stationA = G.build('station', s.x, s.y - 1, 0);
    if (!stationB && afford('station')) stationB = G.build('station', s.x + RAIL_LEN - 1, s.y - 1, 0);
    if (!stationA || !stationB) {
      return why('t', '역 대기 (A ' + (stationA ? 'O' : 'X') + ' B ' + (stationB ? 'O' : 'X') +
                      ') · 철판 ' + (invNow()['iron-plate'] || 0) + '/5 회로 ' +
                      (invNow()['circuit'] || 0) + '/2 강철 ' + (invNow()['steel'] || 0) + '/2');
    }
    markBuilt('station');
    // 열차는 점유맵 밖에 살아서 G.build 로는 못 세운다. 비용은 UI 와 같은 순서로
    // 직접 치른다 — **결제 경로 자체는 클릭 드라이버(uismoke)가 검정한다.** 여기서
    // 재료를 안 빼면 열차가 공짜가 되어 이 주행의 예산 판정이 거짓이 된다.
    var costT = G.buildingInfo('train').cost;
    for (var ck in costT) {
      if ((invNow()[ck] || 0) < costT[ck]) {
        return why('t', '열차 재료 — ' + ck + ' ' + (invNow()[ck] || 0) + '/' + costT[ck] +
                        ' (선로·역은 완성)');
      }
    }
    for (var ck2 in costT) G.give(ck2, -costT[ck2]);
    trainId = G.trainAdd(s.x, s.y);
    if (!trainId) { out.fails.push('열차 배치 실패'); return true; }
    markBuilt('train');
    // 출발역에 인서터를 붙여 실제로 싣게 한다(있으면 좋고, 없어도 노선은 돈다).
    if (afford('inserter')) {
      var ins = G.build('inserter', s.x, s.y + 1, 0);
      if (ins) { markBuilt('inserter'); ensureNet(ins); }
    }
    railDone = true;
    look(s.x + 3, s.y, 0.9);
    note('철도: 레일 ' + RAIL_LEN + '칸 · 역 2대 · 열차 1대 (' + s.x + ',' + s.y + ')');
    return true;
  }

  // 제어기 5 — 증기와 배차. 유체 잔량 · 역 상태 · 열차 출발을 살아 있는 회로에 건다.
  var ctrl5 = null;
  function stageCtrl5() {
    if (ctrl5) return true;
    if (!steamEnt || !stationA) return false;        // 볼 대상이 먼저 있어야 한다
    if (!afford('controller')) return false;
    var c = placeIn('controller', CORE_RC, 0);
    if (!c || c === 'mat' || c === 'tech') { c = spiral('controller', 70, 88, 0, 8); }
    if (!c) return false;
    ctrl5 = c; ctrlIds.push(c);
    // 증기가 마르기 전에 보인다 — 이 게임이 유체를 넣은 이유가 이 한 줄이다.
    var fl5 = nd(c, 'fluid', 20, 20); G.gCfg(c, fl5, 'ent', steamEnt.engine);
    var d51 = nd(c, 'display', 460, 20); G.gCfg(c, d51, 'label', '증기%');
    G.gLink(c, fl5, 0, d51, 0);
    // **완충을 얼마나 둘지는 최악치가 정한다.** 증기%가 가장 낮았을 때를 기록해 두면
    // 탱크를 더 둘지 말지를 눈으로 판단할 수 있다 — 이 게임에서 탱크의 값이 그것이다.
    var pk5 = nd(c, 'peak', 660, 20); G.gCfg(c, pk5, 'mode', '최저');
    G.gLink(c, fl5, 0, pk5, 0);
    var d53 = nd(c, 'display', 880, 20); G.gCfg(c, d53, 'label', '증기% 최저');
    G.gLink(c, pk5, 0, d53, 0);
    // 배차: 화물이 절반을 넘으면 보낸다. **아니면 20초마다 한 번은 보낸다.**
    //
    // 조건을 화물% 하나로만 두면 짐이 안 실리는 판에서 열차가 영원히 안 떠나고,
    // 그 주행은 "열차 출발 노드를 걸었다"만 증명하지 "노선이 돈다"를 증명하지
    // 못한다. 게이트는 둘을 구별 못 하므로 회로 쪽에서 막는다 — 제어기가 지배를
    // 가져가되 굶기지는 않는, 실제로 사람이 짤 법한 규칙이다.
    var st5 = nd(c, 'station', 20, 200); G.gCfg(c, st5, 'ent', stationA);
    var half = nd(c, 'const', 20, 340); G.gCfg(c, half, 'value', 50);
    var cmp5 = nd(c, 'cmp', 240, 200); G.gCfg(c, cmp5, 'op', '>=');
    G.gLink(c, st5, 2, cmp5, 0); G.gLink(c, half, 0, cmp5, 1);
    var tm5 = nd(c, 'timer', 20, 480); G.gCfg(c, tm5, 'period', 20);
    var or5 = nd(c, 'bool', 460, 480); G.gCfg(c, or5, 'op', 'OR');
    G.gLink(c, cmp5, 0, or5, 0); G.gLink(c, tm5, 0, or5, 1);
    var go5 = nd(c, 'traingo', 660, 200); G.gCfg(c, go5, 'ent', stationA);
    G.gLink(c, or5, 0, go5, 0);
    var d52 = nd(c, 'display', 460, 340); G.gCfg(c, d52, 'label', '화물%');
    G.gLink(c, st5, 2, d52, 0);
    note('제어기5: 증기 잔량 표시 + 화물 50% 배차');
    return true;
  }

  var STAGES = [stageCtrl1, stageCtrl2, stageCtrl3, stageCtrl4, stageSplitter, stageCtrl5],
      stageDone = [0, 0, 0, 0, 0, 0];

  // 증기 발전소와 철도는 **사이클의 앞에서** 산다. 한 사이클 안의 순서가 곧
  // 우선순위인데(logistics 의 주석), 뒤에 두었더니 앞의 feed 가 재고를 기계
  // 버퍼로 다 밀어 넣은 뒤라 철판이 언제나 0 이었다 — 40분 내내 '0/40'.
  // 재고를 잡아 두는 것(ironHold)만으로는 안 됐다. 그건 craft 만 막고 feed 는
  // 그대로 퍼 갔기 때문이다. **큰 것을 사려면 줄의 앞에 서야 한다.**
  var buyDone = [0, 0, 0];
  function runBuyStages() {
    var BUY = [stageSteam, stageTank, stageTrain];
    for (var i = 0; i < BUY.length; i++) {
      if (buyDone[i]) continue;
      var ok = false;
      try { ok = BUY[i](); }
      catch (e) { out.fails.push('buy' + (i + 1) + ': ' + (e && e.message)); buyDone[i] = 1; continue; }
      if (ok) buyDone[i] = 1;
    }
  }
  function runStages() {
    for (var i = 0; i < STAGES.length; i++) {
      if (stageDone[i]) continue;
      var ok = false;
      try { ok = STAGES[i](); }
      catch (e) { out.fails.push('stage' + (i + 1) + ': ' + (e && e.message)); stageDone[i] = 1; continue; }
      if (ok) stageDone[i] = 1;
    }
  }

  // 진단용 — 용광로가 무엇을 굽고 있고 왜 노는지. 세 번을 추측으로 헛짚었다.
  function furnDiag() {
    var ids = G.entIds(), r = [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][1] !== 'furnace') continue;
      var e = G.ent(ids[i][0]); if (!e) continue;
      var tot = 0; for (var k in e.inv) tot += e.inv[k];
      r.push((e.recipe || '-') + ':' + (e.working ? 'W' : '.') + ':' + tot + ':' + (e.net >= 0 ? 'N' : 'x'));
    }
    return r;
  }
  // 조립기도 같은 진단이 필요하다. 용광로는 세 번 추측으로 헛짚어서 furnDiag 를
  // 만들었는데, 조립기는 없어서 "적팩이 왜 모자란가" 를 재고만 보고 짐작하고 있었다.
  // 무엇을 만드는 조립기가 · 돌고 있는지 · 입력이 얼마나 들었는지를 같이 본다.
  function asmDiag() {
    var ids = G.entIds(), r = [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][1] !== 'assembler') continue;
      var e = G.ent(ids[i][0]); if (!e) continue;
      var tot = 0; for (var k in e.inv) tot += e.inv[k];
      var out = 0; for (var o in e.out) out += e.out[o];
      r.push((e.recipe || '-') + ':' + (e.working ? 'W' : '.') + ':in' + tot + ':out' + out +
             ':' + (e.net >= 0 ? 'N' : 'x'));
    }
    return r;
  }
  function logistics() {
    refreshPoles();
    harvest();
    // **한 사이클 안의 순서가 곧 우선순위다.** 손 조립을 먼저 돌렸더니 철판이
    // 톱니·회로로 다 빠져 나가서 터렛이 40분 동안 한 기도 안 섰다(손실 134).
    // 전력과 방어가 먼저 가져가고, 남는 것으로 손이 만들고, 그 다음이 건설이다.
    ironHoldTick();
    runBuyStages();
    craft();
    autoGen();
    autoTurret();               // 전력과 같은 급 — 발전기가 부서지면 전력도 없다
    autoIron();                 // 철이 모든 것의 상류다
    autoGear();                 // 적팩과 터렛이 같은 톱니를 다툰다 — 뺏지 말고 더 만든다
    autoCoal();
    autoBrick();
    autoStone();
    runJobs();
    ensureAllPowered();
    steelTick();
    feed();
    tutorTick();
    runStages();
  }

  // --- 주행 ------------------------------------------------------------------
  var lastPoll = -1, lastSnap = -1, inCombat = false, engaged = false;
  var peakEnemies = 0, worstSat = 1;
  // 증기 발전소와 노선이 **실제로 돌았는가** — 배치 사실과 따로 잰다
  var steamPeak = 0, trainTravel = 0, trainLastX = null, trainMoved = false;
  // **궤적 지문 — 사이클마다 찍는다.** 처음엔 배치(pump)가 끝날 때 찍었는데,
  // 그러면 배치 크기가 찍는 시각을 바꾼다(12면 t=72, 4면 t=64에 t=60 자리를 채운다).
  // 그 상태로 배치 12 와 4 를 비교했더니 t=60 부터 갈리는 것처럼 보였다 — 시뮬이
  // 아니라 **내 계측이 갈린 것**이었다. 지문은 재는 대상의 시각에 붙어야 한다.
  function fpTick() {
    var t = G.state().t;
    for (var fp = 0; fp < FP_T.length; fp++) {
      if (fpMark[fp] || t < FP_T[fp]) continue;
      fpMark[fp] = FP_T[fp] + '@' + t.toFixed(1) + ':' + G.stateHash();
    }
  }

  // 상태 지문 — 두 주행의 첫 불일치를 좁히는 데 쓴다. 간격을 20초로 뒀더니 주행이
  // 1200초 상한을 넘겨 판정 불성립이 됐다(stateHash 는 엔티티마다 벨트 위 아이템까지
  // 훑는다). 60초면 창은 넓어도 주행은 끝난다 — **못 끝나는 정밀도는 정밀도가 아니다.**
  var FP_T = (function () { var a = []; for (var v = 60; v <= 2400; v += 60) a.push(v); return a; })(),
      fpMark = [];

  // 한 사이클이 담당하는 **게임 시간**. 이 값이 곧 "공장이 얼마나 자주 손을
  // 쓰는가" 이고, 여기가 벽시계에 묶이면 측정이 프레임 속도에 딸려 간다.
  var CYCLE_T = 2, CYCLE_T_COMBAT = 0.5, MAX_CATCHUP = 40;

  // pump 의 뒷일 — 카메라·스냅샷·종료 판정. 사이클을 돈 뒤 한 번만 한다.
  // 두 경로(드라이버가 미는 쪽 / rAF 가 미는 쪽)가 **같은 코드**를 쓰게 뺐다 —
  // 갈라 두면 둘이 어긋나고, 어느 쪽을 잰 건지 알 수 없게 된다.
  function afterCycles(st, t) {
      if (st.enemies > peakEnemies) peakEnemies = st.enemies;
      if (t >= 60 && st.power.sat < worstSat) worstSat = st.power.sat;

      // 철판 재고의 최대치 — "흐름은 넉넉한데 재고가 없다"를 숫자로 남긴다.
      // 한 순간에 얼마를 쥘 수 있었는지가 큰 구매의 가능 여부를 정한다.
      if ((st.inventory['iron-plate'] || 0) > ironPeak) ironPeak = st.inventory['iron-plate'] || 0;

      // **지었다 ≠ 돈다.** 건물 종류 커버리지 게이트는 배치한 순간을 세므로, 죽은
      // 증기 발전소와 안 움직이는 열차도 통과시킨다. 도는지는 여기서 따로 잰다.
      if (steamEnt) {
        var fi = G.fluid(steamEnt.engine);
        if (fi && fi.steam > steamPeak) steamPeak = fi.steam;
      }
      if (trainId) {
        var tl = G.trainList();
        for (var ti = 0; ti < tl.length; ti++) {
          if (tl[ti].id !== trainId) continue;
          if (trainLastX !== null) trainTravel += Math.abs(tl[ti].x - trainLastX);
          trainLastX = tl[ti].x;
          if (tl[ti].moving) trainMoved = true;
        }
      }

      if (st.enemies > 0) {
        var el = G.enemyList(), cx = 0, cy = 0;
        for (var q = 0; q < el.length; q++) { cx += el[q].x; cy += el[q].y; }
        var near = 1e9, ids3 = G.entIds();
        for (var w = 0; w < ids3.length; w++) {
          if (ids3[w][1] !== 'turret') continue;
          var tw = G.ent(ids3[w][0]);
          for (var v = 0; v < el.length; v++) {
            var dd = Math.hypot(el[v].x - (tw.tx + 1), el[v].y - (tw.ty + 1));
            if (dd < near) near = dd;
          }
        }
        engaged = near < 16;
        if (el.length && engaged) { G.setCamera(cx / el.length, cy / el.length, 1.2); }
        if (CINEMA && engaged && !inCombat) { inCombat = true; G.setSpeed(1); }
        if (CINEMA && !engaged && inCombat) { inCombat = false; G.setSpeed(SPEED); }
      } else {
        engaged = false;
        if (CINEMA && inCombat) { inCombat = false; G.setSpeed(SPEED); }
      }
      window.__ENGAGED = engaged;

      if (t - lastSnap >= 60) {
        lastSnap = t;
        out.measured.snaps = out.measured.snaps || [];
        // 전력이 0%가 됐을 때 "발전기가 없나 / 연료가 없나 / 수요가 넘나"를 뒤에서
        // 다시 추측하지 않도록 내역을 남긴다. 세 번 연속 원인을 잘못 짚었다.
        var gens = 0, fueled = 0, gi = G.entIds();
        var furn = 0, furnWork = 0, asm = 0, asmWork = 0, minr = 0, minrFull = 0;
        var tur = 0, turAmmo = 0, walls = 0, noNet = 0;
        for (var gq = 0; gq < gi.length; gq++) {
          var gty = gi[gq][1];
          if (gty === 'wall') { walls++; continue; }
          if (gty !== 'generator' && gty !== 'furnace' && gty !== 'assembler' &&
              gty !== 'miner' && gty !== 'turret') continue;
          var ge2 = G.ent(gi[gq][0]);
          if (!ge2) continue;
          if (needsNet(gty) && ge2.net < 0) noNet++;
          if (gty === 'generator') { gens++; if (ge2.fuel > 0) fueled++; }
          else if (gty === 'furnace') { furn++; if (ge2.working) furnWork++; }
          else if (gty === 'assembler') { asm++; if (ge2.working) asmWork++; }
          else if (gty === 'turret') { tur++; turAmmo += (ge2.ammo || 0); }
          else { minr++;
            var ot = 0; for (var ok in ge2.out) ot += ge2.out[ok];
            if (ot >= 90) minrFull++;         // 출력이 막혀 캐기를 멈춘 채광기
          }
        }
        out.measured.snaps.push({ t: Math.round(t), res: st.research.done.length,
                                  ents: st.entityCount, lost: st.waves.lost,
                                  wv: st.waves.waves, en: st.enemies,
                                  evo: +(st.evolution * 100).toFixed(0),
                                  gen: gens, fuel: fueled, nets: st.power.nets, noNet: noNet,
                                  fn: furn, fnW: furnWork, as: asm, asW: asmWork,
                                  mi: minr, miF: minrFull, tu: tur, tuA: turAmmo, wl: walls,
                                  ore: (st.inventory['iron-ore'] || 0),
                                  plate: (st.inventory['iron-plate'] || 0),
                                  cu: (st.inventory['copper-plate'] || 0),
                                  gearN: (st.inventory['gear'] || 0),
                                  sat: +(st.power.sat * 100).toFixed(0),
                                  sup: Math.round(st.power.supply), dem: Math.round(st.power.demand),
                                  coal: (st.inventory['coal'] || 0),
                                  // 부하 차단이 실제로 무엇을 끄고 있는지 — 제어기가
                                  // 살아난 뒤 연구가 느려졌다면 여기서 갈린다.
                                  labOn: (function () {
                                    var ls = findAll('lab'), on = 0;
                                    for (var q = 0; q < ls.length; q++) {
                                      var le = G.ent(ls[q]); if (le && le.enabled) on++;
                                    }
                                    return on + '/' + ls.length;
                                  })(),
                                  beltShut: (function () {
                                    if (!tutBelt) return '-';
                                    var gs = G.gateState(tutBelt);
                                    return gs === false ? '막힘' : '열림';
                                  })(),
                                  red: (st.inventory['sci-red'] || 0),
                                  grn: (st.inventory['sci-green'] || 0),
                                  ammo: (st.inventory['ammo'] || 0),
                                  furn: furnDiag(), asm: asmDiag() });
      }
      }

  // **드라이버가 시뮬을 직접 민다 (기본값).**
  //
  // 예전에는 게임의 rAF 루프가 시간을 밀고 드라이버는 setTimeout 으로 따라갔다.
  // 그러면 드라이버가 행동하는 **게임 시각이 프레임 경계에 딸려 간다** — 한 프레임이
  // 2.67초를 밀면 10.0초가 아니라 12.67초에 손을 쓴다. 그 어긋남이 누적돼 같은
  // 코드가 녹색 연구팩 78과 260을 냈다. 머신이 한가한지를 잰 셈이다.
  //
  // 이제 게임 루프를 세우고 드라이버가 `G.run(quant)` 로 정확히 quant 초씩 민 뒤
  // 한 사이클을 돈다. 행동 시각이 2, 4, 6… 으로 정확히 떨어져 부하와 무관해진다.
  // 녹화(CINEMA)에서는 사람이 봐야 하므로 예전처럼 rAF 가 민다.
  // **여기서 G.pause 를 부르면 안 된다** — 이 줄은 스크립트가 읽히는 순간 돌고,
  // 그때 G 는 아직 undefined 다(부팅을 기다린 뒤 run() 안에서 대입된다).
  // 그렇게 뒀다가 드라이버가 통째로 죽어 결과가 한 줄도 안 나왔다.
  var DRIVE = !CINEMA;
  var PUMP_CYCLES = 12;              // 한 pump 에 밀 사이클 수 (페이지가 숨 쉬게)

  function pump() {
    var st = G.state(), t = st.t;
    var quant = (st.enemies > 0 ? CYCLE_T_COMBAT : CYCLE_T);
    if (DRIVE) {
      for (var d = 0; d < PUMP_CYCLES && G.state().t < END_T; d++) {
        var s2 = G.state();
        G.run(s2.enemies > 0 ? CYCLE_T_COMBAT : CYCLE_T);
        try { logistics(); } catch (e1) { out.fails.push('logistics: ' + (e1 && e1.message)); }
        nextTech();
        fpTick();
      }
      st = G.state(); t = st.t;
      lastPoll = t;
      afterCycles(st, t);
      if (t < END_T) setTimeout(pump, 0); else finish();
      return;
    }
    // **밀린 게임 시간을 따라잡는다.** pump 는 벽시계 40ms 마다 도는데, 한 번 돌 때
    // 한 사이클만 하면 게임 시간당 작업량이 프레임 속도에 딸려 간다 — 같은 코드가
    // 녹색 연구팩 58과 237을 냈다(스냅샷 필드 두 개를 더한 것 말고는 차이가 없었다).
    // 이제 사이클 수는 흐른 게임 시간 ÷ CYCLE_T 로 정확히 정해진다.
    var cycles = 0;
    while (t - lastPoll >= quant && cycles < MAX_CATCHUP) {
      lastPoll += quant;
      cycles++;
      try { logistics(); } catch (e) { out.fails.push('logistics: ' + (e && e.message)); }
      nextTech();
    }
    // **밀려서 버린 게임 시간을 센다.** 여기서 버리면 그만큼 공장이 손을 덜 쓴 것이고,
    // 그게 곧 "측정이 머신 부하에 딸려 갔다"는 뜻이다 — 실제로 브라우저 5개를 동시에
    // 돌렸더니 같은 코드가 녹색 연구팩 260 대신 74를 냈다. 조용히 넘어가면 그 판의
    // 숫자를 믿을 수 없다는 사실 자체가 안 보인다.
    if (cycles >= MAX_CATCHUP) {
      out.measured.skippedT = (out.measured.skippedT || 0) + (t - lastPoll);
      out.measured.skippedN = (out.measured.skippedN || 0) + 1;
      lastPoll = t;                            // 나선 방지
    }
    if (cycles > 0) afterCycles(st, t);

    if (t >= END_T) { finish(); return; }
    setTimeout(pump, 40);
  }

  function finish() {
    var st = G.state(), tut = G.tutorial();
    var prev = out.measured || {};

    // 실제로 세운 건물 종류
    var built = {}, ids = G.entIds();
    for (var i = 0; i < ids.length; i++) built[ids[i][1]] = (built[ids[i][1]] || 0) + 1;
    for (var b in usedBuildings) built[b] = built[b] || usedBuildings[b];
    var allTypes = G.buildingTypes();
    var missingB = allTypes.filter(function (ty) { return !built[ty]; });

    // 실제로 배선한 노드 종류 (살아 있는 그래프에서 센다)
    var seenNodes = {};
    for (var c = 0; c < ctrlIds.length; c++) {
      var kinds = G.gKinds(ctrlIds[c]) || [];
      for (var k = 0; k < kinds.length; k++) seenNodes[kinds[k]] = 1;
    }
    // **적어 낸 것을 세지 않는다.** 예전엔 여기서 usedNodes(내가 '쓸 것'이라고
    // 표시한 목록)를 그냥 합쳤다. 그래서 규칙이 연구 부족으로 컴파일조차 안 된
    // 판에서도 25/25 로 통과했다 — 주장을 세는 게이트는 주장을 통과시킨다.
    // 살아 있는 그래프에서 실제로 센 것만 남긴다.
    //
    // 파괴된 제어기의 노드는 못 세지만, 그건 "안 세는 쪽으로 틀리는" 것이라 안전하다.
    var claimedOnly = Object.keys(usedNodes).filter(function (k) { return !seenNodes[k]; });
    var allKinds = G.nodeKinds();
    var missingN = allKinds.filter(function (k) { return !seenNodes[k]; });

    out.measured = {
      fingerprints: fpMark,
      seed: SEED, gameMinutes: Math.round(st.t / 60), entities: st.entityCount,
      research: st.research.done, techCount: st.research.done.length,
      buildingsBuilt: Object.keys(built).length, missingBuildings: missingB,
      nodeKindsWired: Object.keys(seenNodes).length, missingNodes: missingN,
      claimedButNotWired: claimedOnly,
      waves: st.waves.waves, killed: st.waves.killed, lost: st.waves.lost,
      peakEnemies: peakEnemies, worstSat: +(worstSat * 100).toFixed(1),
      evolution: +(st.evolution * 100).toFixed(1),
      prod: tut.prod.byRecipe, power: st.power, placeFails: out.fails.length,
      counts: st.counts, tutTrack: tut.track,
      jobsLeft: JOBS.filter(function (j) { return !j.done; }).map(function (j) { return j.key; }).slice(0, 12),
      snaps: prev.snaps || [], ctrl3: prev.ctrl3 || null,
      inv: st.inventory,
      steamPeak: +steamPeak.toFixed(1), trainTravel: +trainTravel.toFixed(1), trainMoved: trainMoved
    };

    chk('clear.ranFullDuration', st.t >= END_T - 2,
      '게임 시각 ' + Math.round(st.t) + 's (' + Math.round(st.t / 60) + '분)');
    chk('clear.noRuntimeErrors', G.errors().length === 0, G.errors().join(' | ') || '없음');
    chk('clear.noPlaceFailures', out.fails.length === 0,
      '배치·단계 실패 ' + out.fails.length + '건' +
      (out.fails.length ? ': ' + out.fails.slice(0, 5).join(' | ') : ''));

    chk('clear.allTechsResearched', st.research.done.length === G.techIds().length,
      '연구 ' + st.research.done.length + '/' + G.techIds().length + '종 완료: ' +
      st.research.done.join(','));

    // **여유를 함께 잰다.** "8/8 끝냈다" 만으로는 종료 1초 전에 겨우 끝난 판과 넉넉히
    // 끝난 판이 구별되지 않는다. 앞의 것은 다음 변경 한 번에 RED 로 뒤집히는 GREEN 이고,
    // 그 사실이 결과에 안 보이면 아무도 대비하지 못한다.
    //
    // 문턱은 **주행 길이의 5%** 다(2400s → 120s). "공장이 5% 느려져도 여전히 다 끝낸다"
    // 는 뜻이고, 이 정도 여유가 없으면 사소한 변경 하나가 게이트를 뒤집는다.
    // 실제로 이 게이트를 처음 켰을 때 여유는 **13초** 였다 — 8/8 GREEN 이었지만 다음
    // 변경 한 번이면 RED 로 돌아갈 자리였고, 통과/실패만 보던 동안에는 그게 안 보였다.
    var TECH_MARGIN_MIN = Math.round(END_T * 0.05);
    var lastTechT = 0, lastTechId = '없음';
    for (var tk in techAt) { if (techAt[tk] > lastTechT) { lastTechT = techAt[tk]; lastTechId = tk; } }
    var margin = Math.round(END_T - lastTechT);
    out.techAt = techAt;
    chk('clear.techPaceHasMargin',
      st.research.done.length === G.techIds().length && margin >= TECH_MARGIN_MIN,
      '마지막 연구(' + lastTechId + ') 완료 ' + Math.round(lastTechT) + 's · 종료 ' +
      Math.round(END_T) + 's · 여유 ' + margin + 's (' + TECH_MARGIN_MIN +
      's 이상이어야 · 여유가 없으면 다음 변경 한 번에 뒤집힌다) · 연구 도착 시각 ' +
      G.techIds().map(function (q) {
        return techAt[q] === undefined ? q + ':미완' : q + ':' + Math.round(techAt[q]);
      }).join(' '));
    chk('clear.allBuildingsUsed', missingB.length === 0,
      '건물 ' + Object.keys(built).length + '/' + allTypes.length + '종 사용' +
      (missingB.length ? ' · 안 쓴 것: ' + missingB.join(',') : '') +
      // 안 쓴 것이 무엇을 기다리다 못 섰는지까지 말한다 — 개수만으로는 재료인지
      // 자리인지 순서인지 구별할 수 없다.
      (missingB.indexOf('tank') >= 0 ? ' · 탱크: ' + tankWhy : ''));
    // **지었다는 사실만으로는 모자란다.** 위 게이트는 배치한 순간을 세므로 연료
    // 없는 보일러와 붙박이 열차도 통과시킨다. 두 설비가 실제로 돌았는지는 따로 잰다
    // — 이게 없으면 "커버리지를 메웠다"가 "커버리지 표를 채웠다"로 미끄러진다.
    chk('clear.steamPlantRan', steamPeak > 0,
      '증기 최대 잔량 ' + steamPeak.toFixed(1) +
      (steamEnt ? ' (0 이면 보일러가 물이나 석탄을 못 받았다)' : ' — 발전소 미건설: ' + steamWhy));
    chk('clear.trainRanRoute', trainMoved && trainTravel >= 10,
      trainId ? ('열차 이동 누적 ' + trainTravel.toFixed(1) + ' 타일 · 움직인 적 ' +
                 (trainMoved ? '있음' : '없음'))
              : ('노선 미건설: ' + trainWhy));
    // 적어만 내고 실제로 안 생긴 것이 있으면 그 자체가 실패다 — 조용히 넘어가면
    // "쓴 셈 치자"가 되고, 그게 바로 위에서 고친 거짓 통과다.
    // **이 주행을 믿어도 되는가.** 드라이버가 밀려서 게임 시간을 버렸다면 공장이
    // 그만큼 손을 덜 쓴 것이고, 그 판의 생산량은 코드가 아니라 그때 머신이 얼마나
    // 한가했는지를 잰 것이다. 조용히 통과시키면 그 뒤의 모든 비교가 무의미해진다.
    var skT = out.measured.skippedT || 0;
    chk('clear.measurementNotStarved', skT < 30,
      '밀려서 버린 게임 시간 ' + Math.round(skT) + 's (' + (out.measured.skippedN || 0) +
      '회) — 30s 이상이면 이 주행의 생산량은 코드가 아니라 머신 부하를 잰 것이다. ' +
      '브라우저를 동시에 여러 개 돌리지 말 것');
    chk('clear.noPhantomNodeClaims', claimedOnly.length === 0,
      '쓴다고 적었지만 살아 있는 회로에 없는 노드 ' + claimedOnly.length + '종' +
      (claimedOnly.length ? ': ' + claimedOnly.join(',') : ''));
    chk('clear.allNodeKindsWired', missingN.length === 0,
      '노드 ' + Object.keys(seenNodes).length + '/' + allKinds.length + '종 배선' +
      (missingN.length ? ' · 안 쓴 것: ' + missingN.join(',') : ''));

    // **머리말이 완주 조건이라고 적은 것은 전부 재야 한다.** 심화 9단계를 조건으로
    // 써 놓고 검사를 안 넣어 뒀었다 — 게임에서 방금 고친 "안내와 판정 불일치"와
    // 같은 종류가 이 시험 자신에게 있었다. 건너뛰기가 아니라 세계 상태로 판정한다.
    var advIds = tut.advIds || [];
    var advFail = [];
    for (var a = 0; a < advIds.length; a++) {
      if (!G.tutorialCheckById(advIds[a])) advFail.push(advIds[a]);
    }
    out.measured.advDone = advIds.length - advFail.length;
    out.measured.advMissing = advFail;
    chk('clear.advancedTutorialDone', advIds.length > 0 && advFail.length === 0,
      '심화 ' + (advIds.length - advFail.length) + '/' + advIds.length + '단계 통과' +
      (advFail.length ? ' · 못 넘은 것: ' + advFail.join(',') : ''));

    // **뚫린 자리를 같이 말한다.** 게임은 파괴 목록(무엇을·언제·어디서)을 이미
    // 들고 있는데 게이트는 개수만 보고했다. "손실 1" 로는 터렛을 더 세울지, 다른
    // 면을 막을지, 그 건물이 애초에 고리 밖이었는지를 구별할 수 없다.
    var ll = (st.waves.lostList || []).slice(-5).map(function (e) {
      return e.type + '@' + e.x + ',' + e.y + '(t=' + e.t + ')';
    });
    // **저장이 브라우저 저장칸에 들어가는가.** 40분 판은 엔티티 170여 개 · 벨트 위
    // 아이템 · 제어기 그래프 · 청사진 · 열차까지 담는다. 저장은 localStorage 한 칸이고
    // 브라우저가 주는 칸은 대략 5 MB 다 — 넘으면 저장이 통째로 실패한다(코드는 그때
    // 토스트로 알리지만, 알린다고 판이 안 사라지는 것은 아니다).
    // 1 MB 를 상한으로 잡는다: 지금 바닥이 약 141 KB(대부분 지형 배열)이므로 일곱 배
    // 여유가 있고, 그 사이에 무엇이 크게 늘면 여기서 먼저 걸린다.
    var saveBytes = (G.saveRaw() || '').length;
    out.measured.saveBytes = saveBytes;
    chk('clear.saveFitsBudget', saveBytes > 0 && saveBytes < 1000000,
      '40분 판 저장 ' + Math.round(saveBytes / 1024) + ' KB (상한 1,000 KB · 브라우저 칸은 약 5 MB)');

    chk('clear.defenseHeld', st.waves.lost === 0 && st.waves.waves >= 1,
      '습격 ' + st.waves.waves + '회 · 격추 ' + st.waves.killed + ' · 손실 ' + st.waves.lost +
      (ll.length ? ' · 뚫린 자리: ' + ll.join(' ') : ''));
    chk('clear.powerHeld', worstSat >= 0.5,
      '최저 전력 만족도 ' + (worstSat * 100).toFixed(1) + '%');

    chk('selftest.mustFail', st.t < 0, '게임 시각이 음수일 리 없다', true);
    out.errors = G.errors();
    out.finalState = st;
    emit(out);
  }

  function go() {
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(out); return; }
      G = window.__GAME;
      G.reset(SEED);
      // 튜토리얼 패널은 **끄지 않는다.** 끄면 stepTutorial 이 안 돌아 기초 트랙이
      // 영원히 안 끝나고, 그러면 심화 트랙으로 못 넘어가 심화 판정이 0/9 가 된다.
      G.ui.closeHelp();
      G.setSpeed(SPEED);
      look(80, 80, 0.8);
      makePlan();
      nextTech();
      // 드라이버가 시뮬을 직접 민다 — 게임 루프는 세운다 (녹화 때는 안 세운다)
      if (DRIVE) G.pause(true);
      pump();
    } catch (e) { out.fatal = (e && e.stack) ? e.stack : String(e); emit(out); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 200); });
  else setTimeout(go, 200);
})();
