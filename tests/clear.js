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
//    · 노드 25종 전부를 살아 있는 회로에 써서 세계를 움직임
//    · 심화 튜토리얼 9단계 전부 통과 (건너뛰기 없이 세계 상태로)
//    · 습격을 막아냄 (손실 0)
//
//  규율: 배치·연구·배선 실패를 삼키지 않는다. 이상한 것은 FAIL 로 낸다.
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

  // **G.place 는 free 다** — 비용·기술·광맥을 전부 건너뛴다. 그걸로 지어 놓고
  // "자력 완주"라고 부르면 거짓이다: 광맥 없는 땅에 세운 채광기가 40분 동안
  // 아무것도 안 캐는 것을 못 알아챘다. 여기서는 플레이어와 같은 길(G.build)만 쓴다.
  //
  // 재료가 모자란 것은 **실패가 아니라 대기**다. 공장은 원래 벌어서 짓는다.
  // 자리가 없거나 광맥이 아닌 것만 실패로 센다.
  var pending = [];                  // 아직 못 지은 것들 (매 사이클 다시 시도)
  var WANT = {};                     // 기계 id -> 의도한 레시피
  // 주의: 여기 안에서는 **G.setRecipe** 를 부른다. 일괄 치환으로 setR 이 자기 자신을
  // 부르게 됐던 자리다 (스택 오버플로로 '철' 단계가 통째로 죽었다).
  function setR(id, rid) { if (id && rid) { G.setRecipe(id, rid); WANT[id] = rid; } return id; }

  function whyWait(type, x, y, d) {
    var w = G.whyPlace(type, x, y, d) || '';
    if (w.indexOf('필요') >= 0) return 'wait';        // 재료 부족 · 연구 필요
    return 'blocked';                                  // 이미 뭔가 있다 · 광맥이 없다 · 맵 밖
  }
  // 반경 R 안에서 지어 본다. 지었으면 id, 재료·연구 때문이면 'wait', 그 외 null.
  function tryBuild(type, x, y, dir, R) {
    var d = (dir === undefined) ? 1 : dir, sawWait = false;
    R = (R === undefined) ? 0 : R;
    for (var r = 0; r <= R; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var id = G.build(type, x + dx, y + dy, d);
          if (id) { markBuilt(type); return id; }
          if (whyWait(type, x + dx, y + dy, d) === 'wait') sawWait = true;
        }
      }
    }
    return sawWait ? 'wait' : null;
  }
  // 짓고 싶은 것을 예약한다. 재료가 생기면 저절로 선다.
  function want(type, x, y, dir, R, recipe, tag) {
    pending.push({ type: type, x: x, y: y, dir: dir, R: R || 0, recipe: recipe || null,
                   tag: tag || (type + '@' + x + ',' + y), t0: G.state().t });
  }
  function drainPending() {
    for (var i = 0; i < pending.length; i++) {
      var q = pending[i];
      var id = tryBuild(q.type, q.x, q.y, q.dir, q.R);
      if (id === 'wait') continue;                       // 아직 못 번다 — 다음에
      if (!id) {                                          // 자리 자체가 없다 = 진짜 실패
        out.fails.push(q.tag + ' — ' + G.whyPlace(q.type, q.x, q.y, q.dir === undefined ? 1 : q.dir));
        pending.splice(i--, 1);
        continue;
      }
      if (q.recipe) setR(id, q.recipe);
      ensurePower(id);
      if (q.after) q.after(id);
      pending.splice(i--, 1);
    }
  }
  // 전기를 쓰는 건물이 망 밖이면 조용히 멈춘다. 드라이버는 그걸 한 번도 안 봤다.
  function ensurePower(id) {
    var e = G.ent(id);
    if (!e || !G.buildingInfo(e.type) || !G.buildingInfo(e.type).power) return;
    if (e.net >= 0) return;
    var off = [[-1,-1],[e.w,-1],[-1,e.h],[e.w,e.h],[0,-2],[0,e.h+1],[-2,0],[e.w+1,0]];
    for (var i = 0; i < off.length; i++) {
      if (G.build('pole', e.tx + off[i][0], e.ty + off[i][1], 0)) { markBuilt('pole'); return; }
    }
  }
  function P(type, x, y, dir) {
    var d = (dir === undefined) ? 1 : dir;
    var id = tryBuild(type, x, y, d, 0);
    if (id && id !== 'wait') { ensurePower(id); return id; }
    want(type, x, y, d, 0);            // 못 지었으면 예약해 두고 나중에
    return null;
  }
  // quiet=true 면 실패를 기록하지 않는다 — placeFree 로 넘기는 fallback 자리에서
  // 쓴다. 안 그러면 대체 자리에 성공했는데도 "배치 실패"가 남아 판정이 거짓말한다.
  function placeNear(type, x, y, dir, R, quiet) {
    R = R || 8;
    var id = tryBuild(type, x, y, dir === undefined ? 0 : dir, R);
    if (id && id !== 'wait') { ensurePower(id); return id; }
    if (id === 'wait') { want(type, x, y, dir === undefined ? 0 : dir, R, null,
                              type + '~' + x + ',' + y); return null; }
    if (!quiet) out.fails.push(type + '~' + x + ',' + y + ' (반경 ' + R + ' 안에 지을 자리 없음)');
    return null;
  }
  function belt(x0, y0, n, dir) {
    var dx = [0, 1, 0, -1][dir], dy = [-1, 0, 1, 0][dir], made = 0;
    for (var i = 0; i < n; i++) if (P('belt', x0 + dx * i, y0 + dy * i, dir)) made++;
    return made;
  }
  function poleNear(x, y) {
    var off = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1],[2,0],[-2,0],[0,2],[0,-2]];
    for (var i = 0; i < off.length; i++) {
      var id = G.build('pole', x + off[i][0], y + off[i][1], 0);
      if (id) { markBuilt('pole'); return id; }
    }
    return null;
  }
  function poles(list) { for (var i = 0; i < list.length; i++) poleNear(list[i][0], list[i][1]); }
  // 좌표를 손으로 찍으면 확장할 때마다 서로 밟는다 — 발전기 5대 중 3대가 벽·터렛
  // 자리와 겹쳐 배치에 실패했고, 그 전력 부족이 생산 붕괴 → 탄약 고갈 → 전멸로
  // 이어졌다(실측: 만족도 0%, 손실 278). 사각형을 훑어 처음 들어가는 자리에 놓는다.
  function placeFree(type, x0, y0, x1, y1, dir) {
    var d = (dir === undefined) ? 0 : dir, sawWait = false;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var id = G.build(type, x, y, d);
        if (id) { markBuilt(type); ensurePower(id); return id; }
        if (whyWait(type, x, y, d) === 'wait') sawWait = true;
      }
    }
    // 재료를 못 벌었을 뿐이면 사각형 한가운데에 예약해 두고 나중에 다시 시도한다
    if (sawWait) {
      want(type, (x0 + x1) >> 1, (y0 + y1) >> 1, d, Math.max(x1 - x0, y1 - y0), null,
           type + '@' + x0 + ',' + y0 + '~' + x1 + ',' + y1);
      return null;
    }
    out.fails.push(type + ' 자리 없음 @' + x0 + ',' + y0 + '~' + x1 + ',' + y1);
    return null;
  }
  function look(x, y, z) { G.setCamera(x, y, z); }
  function note(m) { out.timeline.push({ t: Math.round(G.state().t), msg: m }); }

  // 이 판에서 실제로 쓴 것들 — 완주 판정의 근거
  var usedNodes = {}, usedBuildings = {}, ctrlIds = [];
  function markNode(k) { usedNodes[k] = (usedNodes[k] || 0) + 1; }
  // **'썼다'는 배치한 순간의 사실이다.** 예전엔 끝난 시점의 생존 건물을 셌는데,
  // 그러면 적에게 부서진 종류가 '안 써 봤다'로 뒤집혀 방어 실패가 기능 커버리지
  // 판정을 오염시킨다(실측: 13/13 → 1/13). 부서진 것은 defenseHeld 가 따로 잰다.
  function markBuilt(t) { usedBuildings[t] = (usedBuildings[t] || 0) + 1; }

  // --- 물류 (play.js 에서 검증된 방식) ---------------------------------------
  function harvest() {
    var ids = G.entIds();
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1];
      if (ty === 'chest') G.takeToStock(ids[i][0]);
      else if (ty === 'furnace' || ty === 'assembler') G.takeOutputToStock(ids[i][0]);
      // **채광기 전부에서 걷고, 용광로 전부에 넣는다.** 확장하며 세운 용광로 8대에
      // 인서터도 벨트도 없어 광석이 갈 길이 없었다 — 전기만 먹고 40분 동안 아무것도
      // 안 만들었다(실측: 철판 956개, 탄창 12개 → 전멸). 벨트로 이은 라인은 그대로
      // 두고, 이 드라이버가 '창고 물류'를 대신한다. 한쪽만 하면 벨트가 굶는다.
      else if (ty === 'miner') G.takeOutputToStock(ids[i][0]);
    }
  }
  // 완제품 재고 상한 — 레시피마다 다르다. 일괄 150이면 톱니 조립기 한 대가
  // 3.0 판/s 를 요구해 전 공장 소요(0.35 톱니/s)의 8배를 빨아들인다.
  var CAP = { gear: 60, wire: 80, circuit: 60, 'belt-item': 60, 'inserter-item': 60,
              'sci-red': 120, 'sci-green': 150, ammo: 1e9, brick: 200,
              'iron-plate': 1e9, 'copper-plate': 1e9 };
  var AMMO_RESERVE = 40;      // 재고에 남겨 둘 탄창
  var TURRET_CAP = 120;       // 발. canAccept 상한은 200발(=탄창 20개)

  // "다음 제작까지 얼마나 모자란가" — 0이면 지금 만들 수 있다.
  function needFrac(id) {
    var e = G.ent(id); if (!e || !e.recipe) return 1;
    var r = G.recipeInfo(e.recipe); if (!r) return 1;
    var worst = 0;
    for (var k in r.inp) {
      var miss = Math.max(0, r.inp[k] - ((e.inv && e.inv[k]) || 0)) / r.inp[k];
      if (miss > worst) worst = miss;
    }
    return worst;
  }

  function feed() {
    var inv0 = G.state().inventory;
    var ids = G.entIds(), turrets = [], machines = [];
    for (var i = 0; i < ids.length; i++) {
      var ty = ids[i][1];
      if (ty === 'turret') turrets.push(ids[i][0]);
      else if (ty === 'assembler' || ty === 'lab' || ty === 'furnace') {
        var id = ids[i][0], me = G.ent(id);
        // **의도한 레시피를 매 사이클 다시 못박는다.** 용광로는 완전히 비면 레시피가
        // 풀리고(src/25_entity.js:363), 그 다음 putFromStock 이 ITEM_IDS 순서로
        // 아무 광석이나 새 레시피로 굳힌다 — 철 용광로가 조용히 벽돌 가마가 됐다.
        // (돌 1개만 든 벽돌 가마는 2개가 필요해 영영 안 돌고 비지도 않는다.)
        // !== 검사가 필요하다: 무조건 setRecipe 하면 progress 가 매번 0으로 리셋된다.
        if (me && WANT[id] && me.recipe !== WANT[id]) { G.setRecipe(id, WANT[id]); me = G.ent(id); }
        if (me && ty !== 'furnace' && me.recipe &&
            (inv0[me.recipe] || 0) >= (CAP[me.recipe] || 150)) continue;
        machines.push(id);
      } else if (ty === 'generator') G.putFromStock(ids[i][0]);
    }
    // **총량이 아니라 부족분으로 줄을 세운다.** 총량으로 정렬하면 철판 2개를 즉시
    // 소비하는 톱니 조립기가 언제나 최소값이라 늘 먼저 받고, 4개가 필요해 3개를 쥔
    // 탄창 조립기는 두 번 다시 최소가 되지 못한다 (실측: 톱니 631 vs 탄창 19).
    machines = machines.filter(function (id) { return needFrac(id) > 0; });
    machines.sort(function (a, b) { return needFrac(a) - needFrac(b); });
    for (var m = 0; m < machines.length; m++) G.putFromStock(machines[m]);

    // 터렛은 예비량을 남기고 상한까지만. 14기 x 20탄창 = 280개를 한 번에 빨아들이면
    // 재고 탄창이 영원히 0이 되고, 그걸 조건으로 쓰던 과학 갈래가 통째로 막힌다.
    turrets.sort(function (a, b) { return (G.ent(a).ammo || 0) - (G.ent(b).ammo || 0); });
    for (var k2 = 0; k2 < turrets.length; k2++) {
      if ((G.state().inventory['ammo'] || 0) <= AMMO_RESERVE) break;
      var te = G.ent(turrets[k2]);
      if (!te || te.ammo >= TURRET_CAP) continue;
      G.putFromStock(turrets[k2]);
    }
  }
  function craft() {
    var st0 = G.state(), inv = st0.inventory, t = st0.t;
    // 손 조립은 이제 **시간이 든다** — 대기열에 넣으면 재료가 즉시 빠지고 완성은
    // 나중이다. 재고만 보고 계속 밀어 넣으면 같은 것을 수십 개 예약해 놓고
    // 재료를 다 태운다. 대기열이 짧을 때만 더 넣는다(손 = 조립기 1대가 한계).
    function n(k) { return inv[k] || 0; }
    function make(rid, times) {
      for (var i = 0; i < times; i++) { if (!G.handCraft(rid)) return i; inv = G.state().inventory; }
      return times;
    }
    // 탄창은 대기열 예산을 따로 받는다. 손 조립이 시간을 먹게 되면서 한 예산을
    // 다 같이 쓰면 과학 사슬이 앞에 끼어 탄창이 12개까지 떨어졌다(실측 → 전멸).
    var AMMO_FLOOR = 80;
    if (n('ammo') < AMMO_FLOOR && n('iron-plate') >= 4 && st0.handQueue < 12) make('ammo', 5);
    // 나머지는 대기열이 짧을 때만. 손은 조립기 1대가 한계이므로 밀어 넣어 봐야
    // 재료만 선점하고 완성은 안 빨라진다.
    if (st0.handQueue >= 6) return;
    // 군수 연구 전에는 탄창을 아예 못 만든다(canHandCraft 가 거부). 그때까지
    // ammoOk 를 거짓으로 두면 톱니조차 못 만들어 부트스트랩이 통째로 막힌다.
    var ammoUnlocked = st0.research.done.indexOf('military') >= 0;
    var ammoOk = !ammoUnlocked || n('ammo') >= 40;   // 이 아래면 과학 사슬을 굶긴다
    // 톱니에도 ammoOk 를 건다 — 여기만 게이트가 없어서, 탄창이 모자랄 때
    // 재고의 철이 빠져나가는 통로가 정확히 이 한 줄이었다.
    if (ammoOk && n('gear') < 60 && n('iron-plate') >= 12) make('gear', 4);
    if (ammoOk && n('wire') < 80 && n('copper-plate') >= 6) make('wire', 5);
    if (ammoOk && n('circuit') < 60 && n('iron-plate') >= 15 && n('wire') >= 4) make('circuit', 4);
    if (ammoOk && n('sci-red') < 60 && n('gear') >= 12 && n('copper-plate') >= 10) make('sci-red', 3);
    if (ammoOk && n('belt-item') < 60 && n('gear') >= 10 && n('iron-plate') >= 15) make('belt-item', 3);
    if (ammoOk && n('inserter-item') < 60 && n('gear') >= 10 && n('circuit') >= 3) make('inserter-item', 3);
    // 녹색 연구팩 — 완성품을 재료로 먹는다. 심화 1단계이자 후반 연구의 관문.
    if (ammoOk && n('sci-green') < 120 && n('belt-item') >= 2 && n('inserter-item') >= 2) make('sci-green', 3);
  }
  function logistics() { drainPending(); harvest(); craft(); feed(); }

  // --- 연구 순서 (선행 조건을 지킨다) ----------------------------------------
  // 강철을 3번째로 올린다 — 분배기가 강철 연구로 옮겨 갔기 때문에, 그 전에
  // 분배기를 놓으려 하면 '잠김'으로 배치가 실패한다.
  var TECH_ORDER = ['military', 'logistics', 'steel', 'logic-mem',
                    'logic-ctrl', 'defense-ai', 'belt-2', 'automation-2'];
  function nextTech() {
    var st = G.state(), done = st.research.done;
    if (st.research.current) return null;
    for (var i = 0; i < TECH_ORDER.length; i++) {
      if (done.indexOf(TECH_ORDER[i]) < 0 && G.setResearch(TECH_ORDER[i])) return TECH_ORDER[i];
    }
    return null;
  }

  var STAGES = [
    { t: 2, name: '전력 — 석탄 → 발전기 4대', fn: function () {
      look(78, 76, 0.9);
      var ids = G.entIds();
      for (var i = 0; i < ids.length; i++) if (ids[i][1] === 'pole') G.remove(ids[i][0]);
      P('miner', 71, 75, 0); P('miner', 73, 75, 0);
      belt(71, 74, 14, 1);
      P('generator', 75, 70, 0); P('inserter', 76, 73, 0);
      P('generator', 83, 70, 0); P('inserter', 84, 73, 0);
      P('generator', 79, 70, 0); P('inserter', 80, 73, 0);
      P('inserter', 79, 75, 2);
      poles([[73, 72], [78, 73], [83, 73], [86, 70], [70, 72]]);
      note('석탄 2 → 발전기 4');
    } },

    { t: 25, name: '철 — 채광 3 → 용광로 4 → 상자 4', fn: function () {
      look(86, 79, 0.8);
      P('miner', 89, 75, 3); P('miner', 89, 77, 3); P('miner', 91, 75, 3);
      belt(88, 75, 9, 2);
      var fy = [75, 77, 79, 81];
      for (var i = 0; i < fy.length; i++) {
        // **레시피를 명시한다.** 안 걸어 두면 보유 자재를 넣을 때 먼저 걸린 광석으로
        // 정해져, 철 라인의 용광로가 구리를 굽기 시작한다.
        var fz = P('furnace', 85, fy[i], 0);
        if (fz) setR(fz, 'iron-plate');
        P('inserter', 87, fy[i], 3);
        P('chest', 83, fy[i], 0);  P('inserter', 84, fy[i], 3);
      }
      poles([[86, 73], [82, 76], [87, 76], [87, 80], [90, 78]]);
      note('철: 채광 3 + 용광로 4');
    } },

    { t: 70, name: '구리 + 돌(벽돌)', fn: function () {
      look(76, 87, 0.9);
      P('miner', 73, 89, 0); P('miner', 75, 89, 0);
      belt(73, 88, 6, 1);
      var cfz = P('furnace', 76, 85, 0); if (cfz) setR(cfz, 'copper-plate');
      P('inserter', 76, 87, 0);
      P('chest', 74, 85, 0); P('inserter', 75, 85, 3);
      // 돌 → 벽돌. 벽을 많이 쓰려면 벽돌이 필요하다.
      // 벽돌은 용광로(5개)와 벽(2개)의 재료다. 이제 진짜로 지불하므로 라인을 세운다.
      var sps = G.oreSpotsNear('stone', 80, 80, 3);
      for (var si = 0; si < sps.length && si < 2; si++) {
        P('miner', sps[si].x, sps[si].y, 2);
        poleNear(sps[si].x + 1, sps[si].y + 2);
      }
      for (var bi = 0; bi < 2; bi++) {
        var sf = placeNear('furnace', 80, 92, 0, 6);
        if (sf) setR(sf, 'brick');
      }
      poles([[74, 87], [78, 86], [72, 84]]);
      note('구리 2 + 돌 채광(벽돌)');
    } },

    { t: 110, name: '연구소 — 군수부터', fn: function () {
      look(83, 86, 0.9);
      P('lab', 83, 85, 0);
      poles([[82, 84], [86, 87]]);
      nextTech();
      note('연구소 + 연구 시작');
    } },

    { t: 150, name: '확장 — 채광 4 · 용광로 6 · 탄창/톱니/연구팩 조립기', fn: function () {
      look(85, 80, 0.8);
      P('miner', 87, 73, 2);
      var f1 = P('furnace', 85, 83, 0); if (f1) setR(f1, 'iron-plate');
      P('inserter', 87, 83, 3);
      P('chest', 83, 83, 0);  P('inserter', 84, 83, 3);
      var f2 = P('furnace', 91, 79, 0); if (f2) setR(f2, 'iron-plate');
      P('inserter', 90, 80, 1); P('chest', 92, 81, 0);
      var am = placeNear('assembler', 74, 79, 0, 6);
      if (am) setR(am, 'ammo');
      var gr = placeNear('assembler', 80, 81, 0, 6);
      if (gr) setR(gr, 'gear');
      var sc = placeNear('assembler', 79, 85, 0, 6);
      if (sc) setR(sc, 'sci-red');
      poles([[87, 84], [90, 82], [73, 78], [77, 82], [80, 84]]);
      note('채광 4 + 용광로 6 + 조립기 3');
    } },

    { t: 200, name: '방어 — 벽 + 터렛 8기 (첫 습격 전)', fn: function () {
      look(80, 76, 0.7);
      // 벽 1장 = 벽돌 2개이고 이제 **진짜로 지불한다**. 128장이면 벽돌 256개 =
      // 돌 512개라 초반에 감당이 안 된다. 둥지가 있는 북면만 막는다 — 벽의 목적은
      // 막는 게 아니라 어디로 올지 정해서 터렛 앞으로 몰아주는 것이다.
      for (var x = 68; x <= 92; x++) P('wall', x, 66, 0);
      placeNear('turret', 71, 68, 0, 4); placeNear('turret', 78, 68, 0, 4);
      placeNear('turret', 85, 68, 0, 4); placeNear('turret', 92, 68, 0, 4);
      placeNear('turret', 69, 76, 0, 4); placeNear('turret', 94, 76, 0, 4);
      placeNear('turret', 80, 92, 0, 4); placeNear('turret', 74, 92, 0, 4);
      poles([[70, 69], [79, 69], [86, 69], [70, 77], [95, 77], [81, 91]]);
      note('벽 + 터렛 8기');
    } },

    // 자재 소요를 먼저 계산하고 규모를 정한다. 연구 8종 = 410단위이고 단위마다
    // 적팩 1개, 후반 4종은 녹팩도 1개씩 → **적팩 410 · 녹팩 280**.
    //   적팩 410 → 구리 410 + 톱니 410(철 820)
    //   녹팩 280 → 벨트 280(톱니 140·철 140) + 인서터 280(톱니 280·회로 280·철 280)
    //              회로 280 → 철 280 + 구리선 840(구리 420)
    // 합계 **철 2,360 · 구리 830** (탄창·건물 제외).
    // 이전 판이 4/8에서 멈춘 건 구리 용광로가 2대뿐이라 830을 못 채웠기 때문이다
    // (실측 714). 채광이 아니라 제련이 병목이었다.
    { t: 250, name: '대확장 — 채광·제련·발전을 자재 소요에 맞춘다', fn: function () {
      look(82, 80, 0.6);
      // 철: 채광기 0.5광석/s, 용광로 1장/3.2s. 2,400장을 2,000초에 뽑으려면
      // 채광 3광석/s(6대) · 제련 1.2장/s 이상(4대 추가로 총 10대).
      var fe = G.oreSpotsNear('iron-ore', 90, 78, 8);
      for (var i = 0; i < fe.length && i < 3; i++) placeNear('miner', fe[i].x, fe[i].y, 3, 2);
      for (var f = 0; f < 4; f++) {
        var ff = placeFree('furnace', 95, 68, 99, 96);      // 철 광맥 쪽 동편 빈 띠
        if (ff) setR(ff, 'iron-plate');
      }
      // 구리: 830장 → 용광로 4대 추가 (0.31장/s x 5대 = 1.56장/s)
      var cu = G.oreSpotsNear('copper-ore', 76, 90, 6);
      for (var c = 0; c < cu.length && c < 3; c++) placeNear('miner', cu[c].x, cu[c].y, 0, 2);
      for (var g = 0; g < 4; g++) {
        var cf = placeFree('furnace', 64, 84, 69, 96);      // 구리 광맥 쪽 서편 빈 띠
        if (cf) setR(cf, 'copper-plate');
      }
      // 전력: 늘어난 기계 ~6,000kW → 발전기 900kW x 8대, 석탄 0.225/s/대 → 채광 4대
      var co = G.oreSpotsNear('coal', 72, 76, 6);
      for (var k = 0; k < co.length && k < 3; k++) placeNear('miner', co[k].x, co[k].y, 0, 2);
      for (var gen = 0; gen < 5; gen++) placeFree('generator', 60, 68, 66, 84);
      // 전주는 격자로 깐다. placeNear 로 흩어 놓은 건물이 공급구역 밖에 떨어지면
      // 조용히 만족도 0으로 멈추는데, 그건 판정에 '생산이 적다'로만 보인다.
      // 5칸 격자면 공급 5x5 가 빈틈없이 이어지고 도달 7.5 로 한 망이 된다.
      for (var px = 65; px <= 97; px += 5) for (var py = 66; py <= 96; py += 5) poleNear(px, py);
      note('철 채광+3/제련+4 · 구리 채광+3/제련+4 · 발전기+5 · 전주격자');
    } },

    { t: 300, name: '과학 라인 본체 — 적팩 3 · 녹팩 3 + 중간재 전용기', fn: function () {
      look(76, 88, 0.7);
      // 조립기 속도 0.75 → 실제 시간 = 레시피시간 / 0.75.
      //   적팩 5.0s → 6.67s x 410개 = 2,733초 → 3대 (남은 2,100초 x 3 = 6,300초)
      //   녹팩 6.0s → 8.00s x 280개 = 2,240초 → 3대
      // 이전 판은 녹팩 조립기가 1대라 40분에 12개밖에 못 만들었다.
      var LINE = [['sci-red', 88, 88], ['sci-red', 92, 88],
                  ['wire', 70, 82], ['circuit', 74, 82],
                  ['belt-item', 70, 86], ['inserter-item', 70, 90],
                  ['sci-green', 74, 93], ['sci-green', 78, 93], ['sci-green', 82, 93],
                  ['gear', 84, 84]];
      for (var i = 0; i < LINE.length; i++) {
        var a = placeNear('assembler', LINE[i][1], LINE[i][2], 0, 7, true) ||
                placeFree('assembler', 70, 86, 96, 99);      // 남쪽 빈 들판으로 밀어낸다
        if (a) setR(a, LINE[i][0]);
      }
      placeNear('chest', 81, 89, 0, 4);
      for (var px = 66; px <= 98; px += 5) for (var py = 82; py <= 98; py += 5) poleNear(px, py);
      note('적팩 3 · 녹팩 3 · 구리선/회로/벨트/인서터 전용기');
    } },

    { t: 380, name: '방어 증강 — 터렛 10기 + 탄창 2호', fn: function () {
      look(80, 74, 0.65);
      // 40분이면 진화도가 높아져 6기로는 모자란다(손실 11 실측).
      placeNear('turret', 74, 70, 0, 5); placeNear('turret', 82, 70, 0, 5);
      placeNear('turret', 89, 70, 0, 5); placeNear('turret', 69, 82, 0, 5);
      placeNear('turret', 94, 82, 0, 5); placeNear('turret', 86, 92, 0, 5);
      var am2 = placeNear('assembler', 96, 74, 0, 8);
      if (am2) setR(am2, 'ammo');
      var am3 = placeNear('assembler', 66, 74, 0, 8);
      if (am3) setR(am3, 'ammo');
      // **탄약 보급선을 실제로 잇는다.** 지금까지는 보유 자재를 터렛에 직접 넣기만
      // 했는데, 그건 심화 'ammo-line' 이 요구하는 것(조립기 → 인서터 → 터렛)이
      // 아니다. 손으로 넣는 방어는 첫 습격만 막는다는 게 그 단계의 요지다.
      if (am2) {
        var ae = G.ent(am2);
        if (ae) {
          // 조립기 오른쪽에 인서터, 그 오른쪽에 터렛 — 인서터가 조립기에서 집어
          // 터렛에 넣는다 (dir 1 = 동쪽, 출처는 반대편 = 조립기).
          var ix = ae.tx + ae.w, iy = ae.ty + 1;
          if (P('inserter', ix, iy, 1)) placeNear('turret', ix + 1, iy - 1, 0, 2);
        }
      }
      poles([[75, 69], [83, 69], [90, 69], [70, 83], [95, 83], [97, 76]]);
      note('터렛 14기 + 탄창 조립기 2호');
    } },

    { t: 620, name: '분배기 — 강철 연구가 열어 준 것', fn: function () {
      look(84, 80, 0.9);
      // 분배기는 **강철** 연구가 연다(강철에 소비처를 주려고 옮겼다). 연구가 아직이면
      // 배치가 잠김으로 실패하므로, 아래 '늦은 보충' 단계가 다시 시도한다.
      var sp2 = placeNear('splitter', 88, 84, 2, 6);
      if (sp2) usedBuildings.splitter = 1;
      note(sp2 ? '분배기 배치 (강철)' : '분배기 보류 — 강철 연구 대기');
    } },

    { t: 1400, name: '늦은 보충 — 아직 못 놓은 것을 다시 시도한다', fn: function () {
      // 연구가 늦어 못 놓은 건물을 여기서 만회한다. 한 번 실패하면 끝인 단계는
      // "연구 속도가 조금 느렸다" 를 "기능을 안 써 봤다" 로 둔갑시킨다.
      if (!usedBuildings.splitter) {
        var sp3 = placeNear('splitter', 88, 84, 2, 8);
        if (sp3) { usedBuildings.splitter = 1; note('분배기 늦은 배치'); }
        else out.fails.push('분배기 배치 실패 (강철 연구 미완?)');
      }
    } },

    { t: 520, name: '제어기 1 — 부하 차단 (여유kW + 래치 + 타이머)', fn: function () {
      look(80, 79, 0.9);
      var c = placeNear('controller', 77, 78, 0, 6);
      if (!c) { out.fails.push('제어기1 배치 실패'); return; }
      ctrlIds.push(c);
      var p = G.gAdd(c, 'power', 20, 20);            markNode('power');
      var k0 = G.gAdd(c, 'const', 20, 200); G.gCfg(c, k0, 'value', 0);    markNode('const');
      var k2 = G.gAdd(c, 'const', 20, 340); G.gCfg(c, k2, 'value', 200);
      var cLo = G.gAdd(c, 'cmp', 240, 60);  G.gCfg(c, cLo, 'op', '<');    markNode('cmp');
      var cHi = G.gAdd(c, 'cmp', 240, 260); G.gCfg(c, cHi, 'op', '>');
      G.gLink(c, p, 3, cLo, 0); G.gLink(c, k0, 0, cLo, 1);   // 포트3 = 여유kW
      G.gLink(c, p, 3, cHi, 0); G.gLink(c, k2, 0, cHi, 1);
      var tm = G.gAdd(c, 'timer', 240, 420); G.gCfg(c, tm, 'period', 30); markNode('timer');
      var an = G.gAdd(c, 'bool', 430, 340);  G.gCfg(c, an, 'op', 'AND');  markNode('bool');
      G.gLink(c, cHi, 0, an, 0); G.gLink(c, tm, 0, an, 1);
      var la = G.gAdd(c, 'latch', 620, 160);                              markNode('latch');
      G.gLink(c, cLo, 0, la, 0); G.gLink(c, an, 0, la, 1);
      var nt = G.gAdd(c, 'bool', 800, 160); G.gCfg(c, nt, 'op', 'NOT A');
      G.gLink(c, la, 0, nt, 0);
      var lab = G.entAtTile(83, 85);
      var en = G.gAdd(c, 'enable', 980, 160); if (lab) G.gCfg(c, en, 'ent', lab);
      G.gLink(c, nt, 0, en, 0);                                           markNode('enable');
      var dp = G.gAdd(c, 'display', 980, 340); G.gCfg(c, dp, 'label', '여유kW');
      G.gLink(c, p, 3, dp, 0);                                            markNode('display');
      note('제어기1: 부하 차단 (여유kW·래치·타이머)');
    } },

    { t: 700, name: '제어기 2 — 재고 히스테리시스 + 경보 + 벨트 게이트', fn: function () {
      look(84, 82, 0.9);
      var c = placeNear('controller', 86, 78, 0, 8);
      if (!c) { out.fails.push('제어기2 배치 실패'); return; }
      ctrlIds.push(c);
      var box = G.entAtTile(83, 79);
      var ch = G.gAdd(c, 'chest', 20, 20); if (box) G.gCfg(c, ch, 'ent', box); markNode('chest');
      var lo = G.gAdd(c, 'const', 20, 200); G.gCfg(c, lo, 'value', 50);
      var hi = G.gAdd(c, 'const', 20, 340); G.gCfg(c, hi, 'value', 200);
      var c1 = G.gAdd(c, 'cmp', 240, 60);  G.gCfg(c, c1, 'op', '<');
      var c2 = G.gAdd(c, 'cmp', 240, 260); G.gCfg(c, c2, 'op', '>');
      G.gLink(c, ch, 0, c1, 0); G.gLink(c, lo, 0, c1, 1);
      G.gLink(c, ch, 0, c2, 0); G.gLink(c, hi, 0, c2, 1);
      var la2 = G.gAdd(c, 'latch', 460, 160);
      G.gLink(c, c1, 0, la2, 0); G.gLink(c, c2, 0, la2, 1);
      var lamp = G.gAdd(c, 'lamp', 660, 320); G.gCfg(c, lamp, 'label', '철판 부족');
      G.gLink(c, c1, 0, lamp, 0);                                          markNode('lamp');
      // 벨트 게이트 — 재고가 넘치면 벨트를 닫는다 (논리 III)
      var gbelt = G.entAtTile(88, 79);
      var gt = G.gAdd(c, 'gate', 660, 160); if (gbelt) G.gCfg(c, gt, 'ent', gbelt);
      var ng = G.gAdd(c, 'bool', 460, 320); G.gCfg(c, ng, 'op', 'NOT A');
      G.gLink(c, c2, 0, ng, 0); G.gLink(c, ng, 0, gt, 0);                  markNode('gate');
      note('제어기2: 재고 히스테리시스 + 경보 + 벨트 게이트');
    } },

    { t: 900, name: '제어기 3 — 방어 자동화 + 나머지 노드 전부', fn: function () {
      look(80, 72, 0.85);
      var c = placeNear('controller', 74, 70, 0, 8);
      if (!c) { out.fails.push('제어기3 배치 실패'); return; }
      ctrlIds.push(c);
      // 적 근접 → 경보 + 터렛 사격허가
      var en2 = G.gAdd(c, 'enemy', 20, 20); G.gCfg(c, en2, 'radius', 30);  markNode('enemy');
      var z = G.gAdd(c, 'const', 20, 200); G.gCfg(c, z, 'value', 0);
      var cA = G.gAdd(c, 'cmp', 240, 20); G.gCfg(c, cA, 'op', '>');
      G.gLink(c, en2, 0, cA, 0); G.gLink(c, z, 0, cA, 1);
      var lamp2 = G.gAdd(c, 'lamp', 460, 20); G.gCfg(c, lamp2, 'label', '습격');
      G.gLink(c, cA, 0, lamp2, 0);
      var tur = null, ids3 = G.entIds();
      for (var i = 0; i < ids3.length; i++) if (ids3[i][1] === 'turret') { tur = ids3[i][0]; break; }
      var fr = G.gAdd(c, 'fire', 460, 160); if (tur) G.gCfg(c, fr, 'ent', tur);
      var one = G.gAdd(c, 'const', 240, 160); G.gCfg(c, one, 'value', 1);
      G.gLink(c, one, 0, fr, 0);                                           markNode('fire');
      // 인서터 필터 — 적이 오면 탄창만 집게 한다
      var ins = null;
      for (var j = 0; j < ids3.length; j++) if (ids3[j][1] === 'inserter') { ins = ids3[j][0]; break; }
      var fl = G.gAdd(c, 'filter', 460, 300);
      if (ins) { G.gCfg(c, fl, 'ent', ins); G.gCfg(c, fl, 'a', 'iron-ore'); G.gCfg(c, fl, 'b', 'ammo'); }
      G.gLink(c, cA, 0, fl, 0);                                            markNode('filter');
      // 나머지 노드도 전부 살아 있는 회로에 건다 — 안 써 본 기능은 안 들킨 기능이다
      var mach = G.gAdd(c, 'machine', 20, 340);
      var anyAsm = null;
      for (var m = 0; m < ids3.length; m++) if (ids3[m][1] === 'assembler') { anyAsm = ids3[m][0]; break; }
      if (anyAsm) G.gCfg(c, mach, 'ent', anyAsm);                          markNode('machine');
      var iv = G.gAdd(c, 'invsense', 20, 480); G.gCfg(c, iv, 'item', 'iron-plate'); markNode('invsense');
      var bs = G.gAdd(c, 'belt', 20, 620);
      var anyBelt = G.entAtTile(88, 77); if (anyBelt) G.gCfg(c, bs, 'ent', anyBelt); markNode('belt');
      var rs = G.gAdd(c, 'research', 20, 760);                             markNode('research');
      var mt = G.gAdd(c, 'math', 240, 480); G.gCfg(c, mt, 'op', '/');      markNode('math');
      var hun = G.gAdd(c, 'const', 20, 900); G.gCfg(c, hun, 'value', 100);
      G.gLink(c, iv, 0, mt, 0); G.gLink(c, hun, 0, mt, 1);
      var cl = G.gAdd(c, 'clamp', 460, 480); G.gCfg(c, cl, 'lo', 0); G.gCfg(c, cl, 'hi', 1);
      G.gLink(c, mt, 0, cl, 0);                                            markNode('clamp');
      var sel = G.gAdd(c, 'select', 660, 480);
      G.gLink(c, cA, 0, sel, 0); G.gLink(c, iv, 0, sel, 1); G.gLink(c, z, 0, sel, 2); markNode('select');
      var ed = G.gAdd(c, 'edge', 240, 620); G.gCfg(c, ed, 'mode', '상승');
      G.gLink(c, cA, 0, ed, 0);                                            markNode('edge');
      var cnt = G.gAdd(c, 'counter', 460, 620); G.gCfg(c, cnt, 'max', 0);
      G.gLink(c, ed, 0, cnt, 0);                                           markNode('counter');
      var hd = G.gAdd(c, 'hold', 660, 620);
      G.gLink(c, iv, 0, hd, 0); G.gLink(c, ed, 0, hd, 1);                  markNode('hold');
      var pid = G.gAdd(c, 'pid', 240, 900);
      G.gCfg(c, pid, 'kp', 1); G.gCfg(c, pid, 'ki', 0.1); G.gCfg(c, pid, 'kd', 0); G.gCfg(c, pid, 'lim', 100);
      G.gLink(c, hun, 0, pid, 0); G.gLink(c, iv, 0, pid, 1);               markNode('pid');
      var d2 = G.gAdd(c, 'display', 880, 620); G.gCfg(c, d2, 'label', '습격횟수');
      G.gLink(c, cnt, 0, d2, 0);
      var d3 = G.gAdd(c, 'display', 880, 760); G.gCfg(c, d3, 'label', '연구%');
      G.gLink(c, rs, 0, d3, 0);
      out.measured.ctrl3 = G.gInfo(c);
      note('제어기3: 방어 자동화 + 노드 25종 전부 배선');
    } }
  ];

  var stageI = 0, lastPoll = -1, lastSnap = -1, inCombat = false, engaged = false;
  var peakEnemies = 0, worstSat = 1;

  function pump() {
    var st = G.state(), t = st.t;
    while (stageI < STAGES.length && t >= STAGES[stageI].t) {
      var s = STAGES[stageI++];
      try { s.fn(); } catch (e) { out.fails.push('stage:' + s.name + ' ' + e.message); }
    }
    if (t - lastPoll >= (st.enemies > 0 ? 0.3 : 2)) {
      lastPoll = t;
      logistics();
      nextTech();                                   // 끝나면 바로 다음 연구
      if (st.enemies > peakEnemies) peakEnemies = st.enemies;
      if (t >= 60 && st.power.sat < worstSat) worstSat = st.power.sat;

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
        if (stageI >= STAGES.length) look(81, 79, 0.7);
      }
      window.__ENGAGED = engaged;

      if (t - lastSnap >= 60) {
        lastSnap = t;
        out.measured.snaps = out.measured.snaps || [];
        // 전력이 0%가 됐을 때 "발전기가 없나 / 연료가 없나 / 수요가 넘나"를 뒤에서
        // 다시 추측하지 않도록 내역을 남긴다. 세 번 연속 원인을 잘못 짚었다.
        var gens = 0, fueled = 0, gi = G.entIds();
        var furn = 0, furnWork = 0, asm = 0, asmWork = 0, minr = 0, minrFull = 0;
        for (var gq = 0; gq < gi.length; gq++) {
          var gty = gi[gq][1];
          if (gty !== 'generator' && gty !== 'furnace' && gty !== 'assembler' && gty !== 'miner') continue;
          var ge2 = G.ent(gi[gq][0]);
          if (!ge2) continue;
          if (gty === 'generator') { gens++; if (ge2.fuel > 0) fueled++; }
          else if (gty === 'furnace') { furn++; if (ge2.working) furnWork++; }
          else if (gty === 'assembler') { asm++; if (ge2.working) asmWork++; }
          else { minr++;
            var ot = 0; for (var ok in ge2.out) ot += ge2.out[ok];
            if (ot >= 90) minrFull++;         // 출력이 막혀 캐기를 멈춘 채광기
          }
        }
        out.measured.snaps.push({ t: Math.round(t), res: st.research.done.length,
                                  ents: st.entityCount, lost: st.waves.lost,
                                  evo: +(st.evolution * 100).toFixed(0),
                                  gen: gens, fuel: fueled,
                                  fn: furn, fnW: furnWork, as: asm, asW: asmWork,
                                  mi: minr, miF: minrFull,
                                  ore: (st.inventory['iron-ore'] || 0),
                                  plate: (st.inventory['iron-plate'] || 0),
                                  gearN: (st.inventory['gear'] || 0),
                                  sup: Math.round(st.power.supply), dem: Math.round(st.power.demand),
                                  coal: (st.inventory['coal'] || 0),
                                  ammo: (st.inventory['ammo'] || 0) });
      }
    }
    if (t >= END_T) { finish(); return; }
    setTimeout(pump, 60);
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
    for (var uk in usedNodes) seenNodes[uk] = 1;   // 철거·파괴된 제어기의 노드도 '배선했다'
    var allKinds = G.nodeKinds();
    var missingN = allKinds.filter(function (k) { return !seenNodes[k]; });

    out.measured = {
      seed: SEED, gameMinutes: Math.round(st.t / 60), entities: st.entityCount,
      research: st.research.done, techCount: st.research.done.length,
      buildingsBuilt: Object.keys(built).length, missingBuildings: missingB,
      nodeKindsWired: Object.keys(seenNodes).length, missingNodes: missingN,
      waves: st.waves.waves, killed: st.waves.killed, lost: st.waves.lost,
      peakEnemies: peakEnemies, worstSat: +(worstSat * 100).toFixed(1),
      evolution: +(st.evolution * 100).toFixed(1),
      prod: tut.prod.byRecipe, power: st.power, placeFails: out.fails.length,
      snaps: prev.snaps || [], ctrl3: prev.ctrl3 || null
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
    chk('clear.allBuildingsUsed', missingB.length === 0,
      '건물 ' + Object.keys(built).length + '/' + allTypes.length + '종 사용' +
      (missingB.length ? ' · 안 쓴 것: ' + missingB.join(',') : ''));
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

    chk('clear.defenseHeld', st.waves.lost === 0 && st.waves.waves >= 1,
      '습격 ' + st.waves.waves + '회 · 격추 ' + st.waves.killed + ' · 손실 ' + st.waves.lost);
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
      G.ui.closeHelp(); G.ui.closeTutor();
      G.setSpeed(SPEED);
      look(80, 80, 0.9);
      pump();
    } catch (e) { out.fatal = (e && e.stack) ? e.stack : String(e); emit(out); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 200); });
  else setTimeout(go, 200);
})();
