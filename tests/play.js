// ===========================================================================
//  30분 소크 — 자율 플레이어
//
//  목적 두 가지가 겹쳐 있다:
//   1) 소크 시험 — 30분 연속 구동에서 크래시·소프트락·수치 폭주가 없는가
//   2) 실연 — 공장을 실제로 세우고 습격을 막아내는 과정을 영상으로 남긴다
//
//  규율:
//   * **배치 실패를 삼키지 않는다.** place() 가 null 을 돌려주면 기록하고, 마지막에
//     그 수를 게이트로 판정한다. 조용히 넘어가면 "지었다" 는 영상이 거짓이 된다.
//   * 각 단계가 끝나면 **세계 상태로** 그 단계가 실제로 작동했는지 본다
//     (제련량, 연구 진행, 터렛 탄약). 지었다는 사실은 돌아간다는 뜻이 아니다.
//   * 시간은 게임 시각(G.state().t)으로 잰다. 실시간이나 프레임 수로 재면 배속에서
//     전부 어긋난다.
//
//  세계는 시드 424242 로 고정한다. 정찰해 둔 광맥 좌표에 맞춰 배치를 손으로 짰다:
//     스폰 (80,80) · 철 (89,75)(89,77) · 구리 (75,89)(77,91)
//     석탄 (73,75)(71,75) · 돌 (83,67) · 가장 가까운 둥지 (74,46) 북쪽
// ===========================================================================
(function () {
  var checks = [];
  function chk(name, ok, detail, expectFail) {
    checks.push({ name: name, ok: !!ok, detail: String(detail), expectFail: !!expectFail });
  }
  function emit(obj) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(obj) + '@@JSON_END@@';
  }

  var G, out = { version: null, checks: checks, errors: [], fatal: null, notes: [],
                 measured: {}, timeline: [], fails: [], snaps: [] };
  var SEED = 424242;
  var SPEED = +(new URLSearchParams(location.search).get('speed') || 12);
  var END_T = +(new URLSearchParams(location.search).get('mins') || 30) * 60;

  // --- 배치 도우미 -----------------------------------------------------------
  function P(type, x, y, dir) {
    var d = (dir === undefined) ? 1 : dir;
    var id = G.place(type, x, y, d);
    // 실패하면 **사유까지** 남긴다. 사유 없이 좌표만 남기면 원인을 추측하게 되고,
    // 실제로 그렇게 두 판을 날렸다.
    if (!id) out.fails.push(type + '@' + x + ',' + y + ' dir' + d + ' — ' + G.whyPlace(type, x, y, d));
    return id;
  }
  // 직선 벨트. dir: 0북 1동 2남 3서
  function belt(x0, y0, n, dir) {
    var dx = [0, 1, 0, -1][dir], dy = [-1, 0, 1, 0][dir], made = 0;
    for (var i = 0; i < n; i++) if (P('belt', x0 + dx * i, y0 + dy * i, dir)) made++;
    return made;
  }
  // 전주는 **기계를 다 놓은 뒤** 빈 자리를 찾아 세운다. 격자 좌표를 고정하면
  // 기계와 부딪혀 조용히 실패하고, 그러면 전기가 안 와서 공장이 통째로 멈춘다
  // (첫 판에서 실제로 그랬다 — 배치 17건 실패, 전력 만족도 0%).
  // 공급구역이 5x5 라 한두 칸 밀려도 덮는 범위는 사실상 같다.
  function poleNear(x, y) {
    var off = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1],[2,0],[-2,0],[0,2],[0,-2]];
    for (var i = 0; i < off.length; i++) {
      var id = G.place('pole', x + off[i][0], y + off[i][1], 0);
      if (id) return id;
    }
    out.fails.push('pole@' + x + ',' + y + ' (주변 13칸 전부 막힘)');
    return null;
  }
  function poles(list) { for (var i = 0; i < list.length; i++) poleNear(list[i][0], list[i][1]); }
  // 건물도 마찬가지 — 좌표를 손으로 맞히려다 여러 번 헛짚었다. 목표 근처에서
  // 나선형으로 빈 자리를 찾는다. 사람도 '이 근처 아무 데나' 로 짓는다.
  function placeNear(type, x, y, dir, radius) {
    var R = radius || 6;
    for (var r = 0; r <= R; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var id = G.place(type, x + dx, y + dy, dir === undefined ? 0 : dir);
          if (id) return id;
        }
      }
    }
    out.fails.push(type + '~' + x + ',' + y + ' (반경 ' + R + ' 안에 빈 자리 없음)');
    return null;
  }
  function note(msg) {
    out.timeline.push({ t: Math.round(G.state().t), msg: msg });
  }
  function look(x, y, z) { G.setCamera(x, y, z); }

  // --- 단계 -------------------------------------------------------------------
  // 좌표는 정찰 결과에 맞춰 손으로 짰다. 광맥은 2x2 채광기 자리이고,
  // 벨트 통로는 서로 겹치지 않게 y 를 갈라 놓았다.
  var STAGES = [
    { t: 2, name: '정리 + 석탄 -> 발전기 3대', fn: function () {
      look(78, 76, 0.95);
      var ids = G.entIds();
      for (var i = 0; i < ids.length; i++) if (ids[i][1] === 'pole') G.remove(ids[i][0]);
      P('miner', 71, 75, 0); P('miner', 73, 75, 0);
      belt(71, 74, 14, 1);
      P('generator', 75, 70, 0); P('inserter', 76, 73, 0);
      P('generator', 83, 70, 0); P('inserter', 84, 73, 0);
      P('generator', 79, 70, 0); P('inserter', 80, 73, 0);
      P('inserter', 79, 75, 2);
      // 전주는 이 시점에 최소한만 — 기계가 전기를 받아야 돌기 시작한다
      // (88,74)는 나중에 4번째 채광기(87~88 x 73~74)가 들어올 자리다.
      // 여기에 전주를 세웠다가 그 채광기와 철 벨트 한 칸이 두 판 내내 막혔다.
      poles([[73, 72], [78, 73], [83, 73], [86, 70], [70, 72]]);
      note('석탄 2 -> 발전기 4 (2700+900kW)');
    } },

    { t: 25, name: '철 라인 - 채광 4 -> 용광로 6 -> 상자 6', fn: function () {
      look(86, 79, 0.8);
      // 비율: 채광 1대(0.5 광석/s) 가 용광로 1.6대(각 0.3125 판/s)를 먹인다.
      // 4대 -> 6.4 이므로 용광로 6대. 2대/3대로 지었을 때는 0.41 판/s 밖에
      // 안 나와서 탄창이 말랐고 그대로 전멸했다.
      // 시작 지급분(톱니 30·철판 60)으로는 여기까지가 한계다. 4번째 채광기와
      // 6번째 용광로는 판이 나오기 시작한 뒤(150초) 확장 단계에서 붙인다.
      P('miner', 89, 75, 3); P('miner', 89, 77, 3); P('miner', 91, 75, 3);
      belt(88, 75, 9, 2);                              // (88,75)~(88,83) 남쪽
      var fy = [75, 77, 79, 81];
      for (var i = 0; i < fy.length; i++) {
        P('furnace', 85, fy[i], 0); P('inserter', 87, fy[i], 3);
        P('chest', 83, fy[i], 0);  P('inserter', 84, fy[i], 3);
      }
      // 용광로 열(85~86 x 75~83)을 5x5 공급구역으로 덮는다. x=87 의 짝수 y 는
      // 비어 있다(인서터는 홀수 y). 처음엔 남쪽 절반이 사각지대라 용광로 3대와
      // 인서터 6개가 전력망 밖이었다 — 화면에 '전력 없음' 으로 떠 있었다.
      poles([[86, 73], [82, 76], [87, 76], [87, 80], [90, 78]]);
      note('철: 채광 3 + 용광로 4 + 상자 4');
    } },

    { t: 70, name: '구리 라인', fn: function () {
      look(76, 87, 0.95);
      P('miner', 73, 89, 0); P('miner', 75, 89, 0);
      belt(73, 88, 6, 1);
      P('furnace', 76, 85, 0); P('inserter', 76, 87, 0);
      P('chest', 74, 85, 0); P('inserter', 75, 85, 3);
      poles([[74, 87], [78, 86], [72, 84]]);
      note('구리: 채광 2 + 용광로 1');
    } },

    { t: 110, name: '연구소 - 군수를 먼저 연구한다', fn: function () {
      look(83, 86, 0.95);
      // 군수는 선행 연구가 없고 적색 20 이면 된다. 첫 습격이 300초에 오므로
      // 그 전에 탄창을 열어야 한다. 첫 판은 물류학부터 하다가 늦었다.
      P('lab', 83, 85, 0);
      poles([[82, 84], [86, 87]]);
      G.setResearch('military');
      note('연구소 + 군수 연구 (첫 습격 300초 전)');
    } },

    { t: 150, name: '확장 - 4번째 채광기 + 용광로 2 + 탄창 라인', fn: function () {
      look(87, 79, 0.8);
      // 이제 판이 쌓였다. 비율을 맞춘다: 채광 4대(2.0 광석/s) <-> 용광로 6대(1.875 판/s).
      P('miner', 87, 73, 2);                           // 남향 출구가 벨트 머리(88,75)와 맞는다
      P('furnace', 85, 83, 0); P('inserter', 87, 83, 3);
      P('chest', 83, 83, 0);  P('inserter', 84, 83, 3);
      P('furnace', 91, 79, 0); P('inserter', 90, 80, 1); P('chest', 92, 81, 0);
      // 탄창 조립기 — 벨트를 피해 서쪽 빈 자리에. 방어도 생산 라인이어야 한다.
      P('assembler', 74, 79, 0);                       // 74~76 x 79~81
      var am = G.entAtTile(74, 79);
      if (am) G.setRecipe(am, 'ammo'); else out.fails.push('ammo assembler 없음');
      poles([[87, 84], [90, 82], [73, 78], [77, 82], [80, 84]]);
      note('채광 4 + 용광로 6 + 탄창 조립기');
    } },

    { t: 230, name: '방어선 - 벽 + 터렛 6기 (첫 습격 전에)', fn: function () {
      look(80, 76, 0.7);
      // 둥지는 북·북서에 몰려 있다. 북면을 벽으로 막고 터렛을 그 뒤에 세운다.
      for (var x = 68; x <= 92; x++) P('wall', x, 66, 0);
      for (var y = 67; y <= 84; y++) { P('wall', 67, y, 0); P('wall', 93, y, 0); }
      P('turret', 71, 68, 0); P('turret', 78, 68, 0); P('turret', 85, 68, 0);
      P('turret', 69, 76, 0); P('turret', 94, 76, 0); P('turret', 80, 92, 0);
      poles([[70, 69], [79, 69], [86, 69], [70, 77], [95, 77], [81, 91]]);
      note('벽 + 터렛 6기 (탄약은 보급 루프가 계속 채운다)');
    } },

    { t: 400, name: '톱니 조립기', fn: function () {
      look(81, 82, 0.95);
      P('assembler', 80, 81, 0);
      var a = G.entAtTile(80, 81);
      if (a) G.setRecipe(a, 'gear'); else out.fails.push('gear assembler 없음');
      poles([[77, 81]]);
      note('톱니 조립기 (보유 자재로 급유)');
    } },

    { t: 520, name: '적색 연구팩 조립기 + 물류학', fn: function () {
      look(80, 86, 0.95);
      P('assembler', 79, 85, 0);
      var a2 = G.entAtTile(79, 85);
      if (a2) G.setRecipe(a2, 'sci-red');
      G.setResearch('logistics');
      note('연구팩 조립기 + 물류학');
    } },

    { t: 900, name: '점검 - 전기 안 오는 기계에 전주를 더 세운다', fn: function () {
      look(85, 80, 0.8);
      // 좌표를 손으로 맞추는 대신 **세계에 물어본다.** 사람이 하는 일과 같다:
      // '전력 없음' 딱지가 붙은 기계를 찾아 그 옆에 전주를 하나 더 세운다.
      var ids = G.entIds(), fixed = 0;
      for (var i = 0; i < ids.length; i++) {
        var ty = ids[i][1];
        if (ty === 'pole' || ty === 'belt' || ty === 'wall' || ty === 'chest' ||
            ty === 'controller' || ty === 'splitter') continue;
        var e = G.ent(ids[i][0]);
        if (!e || e.net >= 0) continue;
        if (poleNear(e.tx + Math.floor(e.w / 2), e.ty - 1)) { fixed++; continue; }
        if (poleNear(e.tx + Math.floor(e.w / 2), e.ty + e.h)) fixed++;
      }
      out.measured.polesAdded = fixed;
      // 탄창 조립기 2호. 습격 14회를 겪고 나면 1대로는 6기를 다 못 채운다
      // (30분 시점에 한 기가 0발로 남았다). 철판은 2391개로 남아돈다.
      var am2 = placeNear('assembler', 71, 83, 0, 8);
      if (am2) { G.setRecipe(am2, 'ammo'); var ae = G.ent(am2); poleNear(ae.tx - 1, ae.ty - 1); }
      note('전력 점검: 전주 ' + fixed + '개 보강');
    } },

    { t: 1000, name: '논리 II 연구 -> 제어기 배선 (편집기에서 직접)', fn: function () {
      look(80, 80, 0.9);
      G.setResearch('logic-mem');
      var c = P('controller', 77, 78, 0);
      // 훅으로 한 번에 조립하지 않는다 — 편집기를 열고 노드를 하나씩 놓는다.
      editorDemo(c);
      note('제어기: 전력 만족도 -> SR 래치 -> 연구소 가동/정지');
    } }
,

    { t: 1620, name: '★ 대규모 습격 — 방어선 성능 시험', fn: function () {
      // **일부러 일으키는 습격이다.** 자연 발생 습격은 터렛 6기(합계 300dps) 앞에서
      // 1초도 못 버텨 영상에 남지 않는다 — 즉시 캡처로도 시체만 찍혔다.
      // 방어선이 실제로 얼마나 버티는지 보려면 이 정도 규모가 필요하다.
      G.setSpeed(1);
      var n = 0;
      for (var i = 0; i < 30; i++) {
        var x = 70 + (i % 15) * 1.6;
        var y = 52 - Math.floor(i / 15) * 3;
        var tier = (i % 5 === 0) ? 1 : 0;          // 5마리 중 1마리는 중형(75hp)
        if (G.spawnEnemyAt(x, y, tier)) n++;
      }
      out.measured.stagedAssault = n;
      G.setCamera(80, 60, 1.0);
      note('대규모 습격 ' + n + '마리 (연출 아님 — 실제 전투 판정)');
    } }  ];

  // --- 물류: 수확하고, 만들고, 먹인다 -----------------------------------
  // 벨트는 광석을 용광로까지 나른다. 그 위쪽(판 -> 부품 -> 연구팩 -> 연구소,
  // 그리고 탄창 -> 터렛)은 마지막 한 칸을 손으로 잇는다. 첫 판에서 이 고리가
  // 없어서 톱니 0 -> 연구 0 -> 탄약 0 -> 전멸로 이어졌다.
  function harvest() {
    var ids = G.entIds();
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1];
      // 상자와 기계 출력에 쌓인 것을 걷어온다. 안 걷으면 상자가 차서 라인이 멈춘다.
      // 상자는 통째로, **기계는 출력만**. 기계에 takeToStock 을 쓰면 방금 넣어 준
      // 재료를 도로 빼앗아 영원히 완성되지 않는다 — 첫 두 판이 그래서 말랐다.
      if (ty === 'chest') G.takeToStock(ids[i][0]);
      // **채광기는 건드리지 않는다.** 출력을 걷어오면 벨트로 갈 광석을 훔치는 셈이고,
      // 광석은 손으로 제련할 수도 없어 그냥 사라진다. 이것 때문에 용광로 6대가
      // 38% 만 돌았다 (0.59 판/s, 이론치 1.875 대비).
      else if (ty === 'furnace' || ty === 'assembler') G.takeOutputToStock(ids[i][0]);
    }
  }
  function feed() {
    var inv0 = G.state().inventory;
    var ids = G.entIds(), turrets = [], machines = [];
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1];
      if (ty === 'turret') turrets.push(ids[i][0]);
      else if (ty === 'assembler' || ty === 'lab') {
        // **남아도는 것을 더 만들지 않는다.** 톱니 조립기가 철판의 86%(2046/2391)를
        // 먹어치우는 바람에 탄창이 30분 동안 82개밖에 안 나왔고, 최전선 터렛 하나가
        // 빈 채로 끝났다. 재고가 충분하면 그 조립기에는 재료를 대지 않는다.
        var me = G.ent(ids[i][0]);
        if (me && me.recipe && me.recipe !== 'ammo') {
          var have = inv0[me.recipe] || 0;
          if (have >= 150) continue;
        }
        machines.push(ids[i][0]);
      }
      else if (ty === 'generator') G.putFromStock(ids[i][0]);
    }
    // **가장 빈 것부터 채운다.** putFromStock 은 대상 하나를 한도까지 가득 채우므로
    // id 순서대로 돌리면 앞의 기계가 재고를 다 먹고 뒤는 굶는다. 터렛에서 3/5 로
    // 드러났고(-> 6/6 으로 해결), 조립기에서는 탄창 조립기가 철판을 독점해
    // 톱니 조립기가 30분 내내 한 번도 안 돌았다.
    function fillLevel(id) {
      var e = G.ent(id), n = 0;
      for (var k in (e.inv || {})) n += e.inv[k];
      return n;
    }
    machines.sort(function (a, b) { return fillLevel(a) - fillLevel(b); });
    for (var m = 0; m < machines.length; m++) G.putFromStock(machines[m]);
    turrets.sort(function (a, b) { return (G.ent(a).ammo || 0) - (G.ent(b).ammo || 0); });
    for (var k2 = 0; k2 < turrets.length; k2++) G.putFromStock(turrets[k2]);
  }

  // 손 조립 — 우선순위대로. 탄약이 제일 급하다(습격이 300초부터 온다).
  function craft() {
    var st0 = G.state();
    var inv = st0.inventory;
    var t = st0.t;
    // 손 조립은 시간이 든다 — 대기열이 밀려 있으면 더 넣지 않는다 (재료만 태운다)
    if (st0.handQueue >= 6) return;
    function n(k) { return inv[k] || 0; }
    function make(rid, times) {
      for (var i = 0; i < times; i++) { if (!G.handCraft(rid)) return i; inv = G.state().inventory; }
      return times;
    }
    // **톱니가 1순위다.** 채광기·조립기·연구소가 전부 톱니를 먹으므로, 톱니가
    // 마르면 공장이 자라지 못한다. 7차에서 탄창을 1순위로 뒀다가 철판을 전부
    // 뺏겨 톱니 0 -> 4번째 채광기 배치 실패 -> 연구팩 5개로 끝났다.
    if (n('gear') < 40 && n('iron-plate') >= 12) make('gear', 4);
    // 탄창은 **부트스트랩만**. 조립기가 선 뒤에는 라인이 뽑는다(7차 실측 266개).
    if (t < 260 && n('ammo') < 30 && n('iron-plate') >= 20) make('ammo', 2);
    if (n('wire') < 30 && n('copper-plate') >= 8) make('wire', 3);
    if (n('circuit') < 20 && n('iron-plate') >= 20 && n('wire') >= 6) make('circuit', 2);
    if (n('sci-red') < 40 && n('gear') >= 12 && n('copper-plate') >= 10) make('sci-red', 3);
    if (n('belt-item') < 30 && n('gear') >= 20 && n('iron-plate') >= 30) make('belt-item', 2);
    if (n('inserter-item') < 15 && n('gear') >= 20 && n('circuit') >= 4) make('inserter-item', 2);
  }
  function logistics() { harvest(); craft(); feed(); }

  // --- 제어기 편집기 시연 -----------------------------------------------
  // 노드를 **한 개씩, 실시간 간격으로** 놓아 화면에 보이게 한다. 훅으로 한 번에
  // 조립하면 세계 상태는 맞아도 영상에는 아무 일도 일어나지 않는다.
  var demoRunning = false;
  function editorDemo(c) {
    if (!c || demoRunning) return;
    demoRunning = true;
    var nP, cSet, kSet, cRst, kRst, lat, en;
    var lab = G.entAtTile(83, 85);
    var steps = [
      function () { G.ui.openLogic(c); },
      // 입력: 전력 만족도 — 공장의 전기를 읽는 눈
      function () { nP = G.gAdd(c, 'power', 40, 40); G.ui.renderGraph(); },
      // 켜는 문턱 98%
      function () { kSet = G.gAdd(c, 'const', 40, 200); G.gCfg(c, kSet, 'value', 98); G.ui.renderGraph(); },
      function () { cSet = G.gAdd(c, 'cmp', 300, 40); G.gCfg(c, cSet, 'op', '>'); G.ui.renderGraph(); },
      function () { G.gLink(c, nP, 0, cSet, 0); G.ui.renderGraph(); },
      function () { G.gLink(c, kSet, 0, cSet, 1); G.ui.renderGraph(); },
      // 끄는 문턱 90% — 두 문턱을 벌리는 것이 히스테리시스의 전부다
      function () { kRst = G.gAdd(c, 'const', 40, 360); G.gCfg(c, kRst, 'value', 90); G.ui.renderGraph(); },
      function () { cRst = G.gAdd(c, 'cmp', 300, 260); G.gCfg(c, cRst, 'op', '<'); G.ui.renderGraph(); },
      function () { G.gLink(c, nP, 0, cRst, 0); G.ui.renderGraph(); },
      function () { G.gLink(c, kRst, 0, cRst, 1); G.ui.renderGraph(); },
      // 기억: SR 래치 — 두 문턱 사이에서는 직전 결정을 유지한다
      function () { lat = G.gAdd(c, 'latch', 560, 150); G.ui.renderGraph(); },
      function () { G.gLink(c, cSet, 0, lat, 0); G.ui.renderGraph(); },
      function () { G.gLink(c, cRst, 0, lat, 1); G.ui.renderGraph(); },
      // 출력: 연구소를 켜고 끈다 (전기가 모자라면 연구부터 미룬다)
      function () { en = G.gAdd(c, 'enable', 820, 150); if (lab) G.gCfg(c, en, 'ent', lab); G.ui.renderGraph(); },
      function () { G.gLink(c, lat, 0, en, 0); G.ui.renderGraph(); },
      function () { out.measured.ctrlNodes = G.gInfo(c); }
    ];
    var i = 0;
    (function next() {
      if (i >= steps.length) {
        // 다 짜고 나서 잠깐 그대로 둔다 — 포트 값이 실시간으로 갱신되는 것을 보여준다
        setTimeout(function () { G.ui.closeLogic(); demoRunning = false; look(81, 79, 0.7); }, 5000);
        return;
      }
      try { steps[i++](); } catch (e) { out.fails.push('editorDemo: ' + e.message); }
      setTimeout(next, 500);
    })();
  }

  var inCombat = false, engaged = false;
  var stageI = 0, lastPoll = -1, lastSnap = -1, peakEnemies = 0, worstSat = 1;
  function pump() {
    var st = G.state();
    var t = st.t;
    while (stageI < STAGES.length && t >= STAGES[stageI].t) {
      var s = STAGES[stageI++];
      try { s.fn(); } catch (e) { out.fails.push('stage:' + s.name + ' ' + e.message); }
    }
    if (t - lastPoll >= (G.state().enemies > 0 ? 0.3 : 2)) {
      lastPoll = t;
      logistics();
      // 30초마다 스냅샷. 전멸의 원인을 나중에 추측하지 않기 위해서다.
      if (t - lastSnap >= 30) {
        lastSnap = t;
        var ids = G.entIds(), tur = 0, ammo = 0, ent = {};
        for (var q = 0; q < ids.length; q++) {
          ent[ids[q][1]] = (ent[ids[q][1]] || 0) + 1;
          if (ids[q][1] === 'turret') { tur++; ammo += (G.ent(ids[q][0]).ammo || 0); }
        }
        out.snaps.push({ t: Math.round(t), en: st.enemies, tur: tur, ammo: ammo,
                         iron: st.inventory['iron-plate'] || 0,
                         res: (st.research.done || []).join('+'),
                         lost: st.waves.lost, sat: +(st.power.sat * 100).toFixed(0),
                         inv_ammo: st.inventory['ammo'] || 0,
                         walls: ent.wall || 0, ents: st.entityCount });
      }
      if (st.enemies > peakEnemies) peakEnemies = st.enemies;
      // 발전기가 서기 전(0~60초)의 0% 를 최저값으로 잡으면 늘 '전력 붕괴' 가 된다.
      if (t >= 60 && st.power.sat < worstSat) worstSat = st.power.sat;
      // 습격이 오면 그쪽을 비춘다 (영상이 무슨 일인지 보여줘야 한다)
      // **전투를 보여준다.** 12배속에서 습격은 눈 깜짝할 새 지나가고, 카메라가
      // 공장만 보고 있으면 적이 죽는 장면이 영상에 아예 안 남는다.
      // 적이 나타나면 배속을 늦추고 적 무리 쪽으로 붙는다.
      if (st.enemies > 0) {
        var el = G.enemyList(), cx = 0, cy = 0;
        for (var q = 0; q < el.length; q++) { cx += el[q].x; cy += el[q].y; }
        // **교전 중일 때만** 붙는다. 적은 둥지에서 나와 한참을 걸어오는데, 스폰
        // 직후부터 따라가면 빈 들판을 걷는 장면만 길게 남는다(실제로 그랬다).
        // 터렛 사거리(18타일) 안으로 들어왔을 때가 총알이 오가는 순간이다.
        var near = 1e9, ids3 = G.entIds();
        for (var w = 0; w < ids3.length; w++) {
          if (ids3[w][1] !== 'turret') continue;
          var tw = G.ent(ids3[w][0]);
          for (var v = 0; v < el.length; v++) {
            var dd = Math.hypot(el[v].x - (tw.tx + 1), el[v].y - (tw.ty + 1));
            if (dd < near) near = dd;
          }
        }
        // 사거리 18타일 **안**이어야 실제로 총알이 오간다. 24로 잡았더니 둥지가
        // 터렛에서 22칸이라 스폰 지점부터 걸려서, 또 접근 장면만 찍혔다.
        engaged = near < 16;
        if (el.length && engaged) {
          cx /= el.length; cy /= el.length;
          // **적 무리를 화면 한복판에 둔다.** 처음엔 적과 가장 가까운 터렛의 중간을
          // 봤는데, 스폰 지점이 멀면 중간점이 둘 다에서 멀어 빈 들판만 나왔다.
          // 터렛 사거리가 18타일이라 적을 가운데 두면 쏘는 터렛도 화면에 들어온다.
          G.setCamera(cx, cy, 1.2);
        }
        // 교전은 짧다 — 터렛 6기 x 50dps 면 소형(15hp)은 한순간에 죽는다. 그래서
        // 교전 구간만 **등속(1배)**으로 떨군다. 구간이 짧아 영상 길이에 큰 영향이 없다.
        if (engaged && !inCombat) { inCombat = true; G.setSpeed(1); }
        if (!engaged && inCombat) { inCombat = false; G.setSpeed(SPEED); }
        if (!engaged && stageI >= STAGES.length) look(81, 79, 0.75);
      } else {
        engaged = false;
        if (inCombat) { inCombat = false; G.setSpeed(SPEED); }
        if (stageI >= STAGES.length) look(81, 79, 0.75);
      }
      window.__ENGAGED = engaged;      // 녹화기가 교전 순간을 잡을 수 있게 노출
    }
    if (t >= END_T) { finish(); return; }
    setTimeout(pump, 60);
  }

  function finish() {
    var st = G.state();
    var tut = G.tutorial();
    // **덮어쓰지 않고 합친다.** 통째로 대입하면 시연 중에 넣어 둔 ctrlNodes 같은
    // 값이 사라져, 편집기가 실제로 돌았는지 증거가 없어진다 (실제로 그랬다).
    var prev = out.measured || {};
    out.measured = {
      seed: SEED, speed: SPEED, gameMinutes: Math.round(st.t / 60),
      entities: st.entityCount, mined: st.mined, pollution: Math.round(st.pollution),
      evolution: +(st.evolution * 100).toFixed(1),
      enemiesPeak: peakEnemies, waves: st.waves.waves, buildingsLost: st.waves.lost,
      killed: st.waves.killed, spawned: st.waves.spawned,
      worstPowerSat: +(worstSat * 100).toFixed(1),
      power: st.power, inventory: st.inventory,
      research: st.research, prod: tut.prod, placeFails: out.fails.length
    };
    // **키를 하나씩 고르지 않는다.** 전에 ctrlNodes 만 옮겼다가 stagedAssault 를
    // 또 잃었다 — 같은 실수를 두 번 했다. 앞서 넣어 둔 값은 전부 살린다.
    for (var pk in prev) if (!(pk in out.measured)) out.measured[pk] = prev[pk];

    chk('soak.ranFullDuration', st.t >= END_T - 2,
      '게임 시각 ' + Math.round(st.t) + 's / 목표 ' + END_T + 's (' + Math.round(st.t / 60) + '분)');
    chk('soak.noRuntimeErrors', G.errors().length === 0, G.errors().join(' | ') || '없음');
    chk('soak.allPlacementsSucceeded', out.fails.length === 0,
      '배치 실패 ' + out.fails.length + '건' + (out.fails.length ? ': ' + out.fails.slice(0, 6).join(', ') : ''));

    // 지었다 ≠ 돌아간다. 세계 상태로 확인한다.
    var prod = tut.prod.byRecipe || {};
    chk('factory.smeltedIron', (prod['iron-plate'] || 0) >= 100,
      '누적 철판 ' + (prod['iron-plate'] || 0) + '개 (제련 라인이 실제로 돌았는가)');
    chk('factory.smeltedCopper', (prod['copper-plate'] || 0) >= 30,
      '누적 구리판 ' + (prod['copper-plate'] || 0) + '개');
    chk('factory.assembledGears', (prod['gear'] || 0) >= 30,
      '누적 톱니 ' + (prod['gear'] || 0) + '개 (조립기가 돌았는가)');
    chk('factory.researchDone', (st.research.done || []).length >= 1,
      '완료한 연구 ' + (st.research.done || []).join(',') + ' · 진행중 ' + st.research.current);
    chk('power.neverCollapsed', worstSat >= 0.5,
      '최저 전력 만족도 ' + (worstSat * 100).toFixed(1) + '% (50% 밑으로 떨어지면 공장이 사실상 멈춘 것)');

    // 방어 — 이게 이 소크의 절반이다
    chk('defense.wavesCame', st.waves.waves >= 1,
      '습격 ' + st.waves.waves + '회 · 최대 동시 적 ' + peakEnemies + '마리 · 진화도 ' +
      (st.evolution * 100).toFixed(1) + '% (안 왔으면 방어를 시험한 게 아니다)');
    chk('defense.heldTheLine', st.waves.lost === 0,
      '잃은 건물 ' + st.waves.lost + '개 (0 이어야 막아낸 것이다)');
    chk('defense.turretsHadAmmo', (function () {
      var ok = 0, tot = 0, ids2 = G.entIds();
      for (var q = 0; q < ids2.length; q++) {
        if (ids2[q][1] !== 'turret') continue;
        tot++; if (G.ent(ids2[q][0]).ammo > 0) ok++;
      }
      out.measured.turretsWithAmmo = ok + '/' + tot;
      return tot >= 3 && ok === tot;
    })(), '탄약이 남아 있는 터렛 ' + (out.measured.turretsWithAmmo || '?') + ' — 보급이 끊기면 다음 습격에 무너진다');

    // 편집기 시연이 실제로 그래프를 세웠는가. 영상에 '보이는 것 같다' 로는
    // 판정하지 않는다 — 세계 상태로 본다.
    var cn = out.measured.ctrlNodes;
    chk('ctrl.graphBuiltInEditor',
      !!cn && cn.nodes === 7 && cn.links === 7,
      '제어기 그래프: 노드 ' + (cn ? cn.nodes : '?') + '개 · 배선 ' + (cn ? cn.links : '?') +
      '개 (전력·상수2·비교2·래치·가동 = 7노드, 배선 7개여야 한다)');

    // 최종 화면에 '전력 없음' 딱지가 셋 떠 있었다. 전력 만족도만 보면 **붙어 있는
    // 망** 기준이라 100% 로 통과한다 — 망 밖에 있는 기계는 아예 안 세어진다.
    var unpowered = [], idsP = G.entIds();
    for (var u = 0; u < idsP.length; u++) {
      var ty = idsP[u][1];
      if (ty === 'pole' || ty === 'belt' || ty === 'wall' || ty === 'chest' ||
          ty === 'controller' || ty === 'splitter') continue;
      var e = G.ent(idsP[u][0]);
      if (e && e.net < 0) unpowered.push(ty + '#' + idsP[u][0] + '@' + e.tx + ',' + e.ty);
    }
    out.measured.unpowered = unpowered;
    chk('factory.allMachinesPowered', unpowered.length === 0,
      '전력망 밖 기계 ' + unpowered.length + '대' +
      (unpowered.length ? ': ' + unpowered.slice(0, 8).join(', ') : ''));

    // 일부러 일으킨 대규모 습격을 실제로 막아냈는가. '영상에 그럴듯하게 나왔다' 가
    // 아니라 잃은 건물 수로 본다.
    chk('defense.survivedStagedAssault',
      (out.measured.stagedAssault || 0) >= 25 && st.waves.lost === 0,
      '연출 습격 ' + (out.measured.stagedAssault || 0) + '마리 투입 · 최종 손실 ' +
      st.waves.lost + '개 · 총 격추 ' + st.waves.killed + '마리');

    chk('selftest.mustFail', st.t < 0, '게임 시각이 음수일 리 없다', true);
    out.errors = G.errors();
    out.finalState = st;
    emit(out);
  }

  function go() {
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(out); return; }
      G = window.__GAME;
      out.version = G.version;
      G.reset(SEED);
      G.ui.closeHelp();
      G.ui.closeTutor();          // 녹화 중에는 패널이 공장을 가린다
      G.setSpeed(SPEED);
      look(80, 80, 1.0);
      pump();
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      emit(out);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 200); });
  else setTimeout(go, 200);
})();
