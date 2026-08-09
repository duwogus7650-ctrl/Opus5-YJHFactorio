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
  var IN_R = 22;
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
    if ((st.inventory['coal'] || 0) > 45 || coalMiners >= 8) return;
    if (!afford('miner')) return;
    if (mineOn('coal', 71, 76)) { coalMiners++; note('석탄 채광 ' + coalMiners + '대'); }
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
  var EAST_RC = [83, 81, 97, 97, IN_R];        // 용광로 + 조립기 (남동 빈 들)
  var WEST_RC = [62, 82, 74, 92, IN_R];        // 후반 조립기

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
    var inner = [[92, 79], [79, 92], [67, 79], [79, 67]];
    for (i = 0; i < inner.length; i++) ring.push({ x: inner[i][0], y: inner[i][1], nd: 0, r: 5 });
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

  // --- 강철 (분배기 재료) ----------------------------------------------------
  // 강철은 조립기가 아니라 **용광로** 레시피다. 철 용광로 하나를 잠시 빌려 굽고,
  // 다 되면 되돌린다. 되돌릴 때 남은 철판을 안 걷으면 그 용광로 입력 버퍼에
  // 영원히 갇힌다(철판은 철 레시피의 입력이 아니라 canAccept 가 거부한다).
  var steelFurn = null;
  function steelTick() {
    var st = G.state();
    if (st.research.done.indexOf('steel') < 0) return;
    var have = st.inventory['steel'] || 0;
    if (have >= 4) {
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
              'iron-plate': 1e9, 'copper-plate': 1e9, steel: 8 };
  // **재고 예비량은 작아야 한다.** 30으로 뒀더니 재고 탄창이 그 위로 올라간 적이
  // 없어 터렛이 40분 내내 빈 채로 서 있었다(실측: 터렛 1기·탄약 0 → 손실 77).
  // 터렛을 굶기지 않는 쪽이 먼저다 — 과잉 흡수는 turretCap 이 따로 막는다.
  var AMMO_RESERVE = 4;

  // 터렛 채움 상한. 한 번에 200발(=탄창 20개)씩 빨아들이면 초반 철이 통째로
  // 탄약이 되어 공장이 안 큰다. 시간이 갈수록 올린다.
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
    // **총량이 아니라 부족분으로 줄을 세운다.** 총량으로 정렬하면 철판 2개를 즉시
    // 소비하는 톱니 조립기가 언제나 최소값이라 늘 먼저 받고, 4개가 필요해 3개를 쥔
    // 탄창 조립기는 두 번 다시 최소가 되지 못한다 (실측: 톱니 631 vs 탄창 19).
    machines.sort(function (a, b) { return a[1] - b[1]; });
    // **한 번에 조금씩, 여러 대에.** 버퍼는 품목당 50개라, 먼저 걸린 조립기 한 대가
    // 귀한 중간재를 50개씩 가져가 주차하면 나머지가 통째로 굶는다. 녹색 연구팩 사슬이
    // 정확히 그렇게 막혔다(인서터 157개가 조립기 버퍼에 흩어져 있었다).
    // 재고가 넉넉하면(용광로의 광석처럼) 상한을 풀어 예전처럼 채운다.
    for (var m = 0; m < machines.length; m++) {
      var mid = machines[m][0], me2 = G.ent(mid);
      var scarce = me2 && me2.type === 'assembler';
      G.putFromStock(mid, scarce ? 10 : 0);
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
    var free = n('iron-plate') - (pc['iron-plate'] || 0);
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
    if (cuLine && !mil && n('sci-red') < 26 && freeGear >= 2 && freeCu >= 3) make('sci-red', 3);
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
  var STAGES = [stageCtrl1, stageCtrl2, stageCtrl3, stageCtrl4, stageSplitter],
      stageDone = [0, 0, 0, 0, 0];
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
  function logistics() {
    refreshPoles();
    harvest();
    // **한 사이클 안의 순서가 곧 우선순위다.** 손 조립을 먼저 돌렸더니 철판이
    // 톱니·회로로 다 빠져 나가서 터렛이 40분 동안 한 기도 안 섰다(손실 134).
    // 전력과 방어가 먼저 가져가고, 남는 것으로 손이 만들고, 그 다음이 건설이다.
    craft();
    autoGen();
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

  // 한 사이클이 담당하는 **게임 시간**. 이 값이 곧 "공장이 얼마나 자주 손을
  // 쓰는가" 이고, 여기가 벽시계에 묶이면 측정이 프레임 속도에 딸려 간다.
  var CYCLE_T = 2, CYCLE_T_COMBAT = 0.5, MAX_CATCHUP = 40;

  // pump 의 뒷일 — 카메라·스냅샷·종료 판정. 사이클을 돈 뒤 한 번만 한다.
  // 두 경로(드라이버가 미는 쪽 / rAF 가 미는 쪽)가 **같은 코드**를 쓰게 뺐다 —
  // 갈라 두면 둘이 어긋나고, 어느 쪽을 잰 건지 알 수 없게 된다.
  function afterCycles(st, t) {
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
                                  furn: furnDiag() });
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
