// ===========================================================================
//  52_tutorial.js — 대화형 튜토리얼
//
//  설계 원칙: **문장을 읽었는지가 아니라 공장이 실제로 그렇게 됐는지로 판정한다.**
//  각 단계는 check() 하나이고, 그 함수는 세계 상태만 본다. "다음" 버튼으로 넘기는
//  튜토리얼은 아무것도 가르치지 않는다 — 눌러서 넘어가면 손은 배운 게 없다.
//
//  단계는 도움말의 "10분 안에 돌아가는 공장"과 같은 순서이고, 마지막 두 단계가
//  이 게임의 본체(제어기 배선)다. 거기까지 데려가는 것이 이 튜토리얼의 목적이다.
// ===========================================================================

var tutorial = {
  on: true,          // 패널을 띄우는가
  track: 'basic',    // 'basic' 기초 10단계 / 'adv' 심화
  step: 0,           // 현재 트랙 안에서의 단계 인덱스
  done: false,       // **현재 트랙**을 끝냈는가
  flags: {},         // 상태로는 못 보는 사건 (편집기를 열었다 등)
  justDone: -1,      // 방금 완료한 단계 (연출용)
  celebrateT: 0
};

// 생산 통계 — 튜토리얼 판정과 HUD 양쪽이 쓴다.
// "지금 버퍼에 있는가"로 보면 인서터가 빼 가는 순간을 놓치므로 누적으로 센다.
var prodStats = { smelted: 0, crafted: 0, byRecipe: {} };
function resetProdStats() { prodStats.smelted = 0; prodStats.crafted = 0; prodStats.byRecipe = {}; }

// --- 판정 도우미 -------------------------------------------------------------
function anyEntity(fn) {
  var hit = null;
  forEachEntity(function (e) { if (!hit && fn(e)) hit = e; });
  return hit;
}
function countEntity(type) {
  var n = 0;
  forEachEntity(function (e) { if (e.type === type) n++; });
  return n;
}
// 건물 앞변(출력 방향)에 벨트가 있는가
function hasBeltInFront(e) {
  var d = e.dir, pts = [];
  if (d === 0) { for (var x = e.tx; x < e.tx + e.w; x++) pts.push([x, e.ty - 1]); }
  else if (d === 2) { for (var x2 = e.tx; x2 < e.tx + e.w; x2++) pts.push([x2, e.ty + e.h]); }
  else if (d === 1) { for (var y = e.ty; y < e.ty + e.h; y++) pts.push([e.tx + e.w, y]); }
  else { for (var y2 = e.ty; y2 < e.ty + e.h; y2++) pts.push([e.tx - 1, y2]); }
  for (var i = 0; i < pts.length; i++) {
    var c = cellAt(pts[i][0], pts[i][1]);
    if (c) return true;
  }
  return false;
}

// --- 배선 판정 도우미 --------------------------------------------------------
// 심화 단계는 "제어기에 무엇을 배선했는가"로 판정한다. 노드를 놓기만 한 것은
// 아무것도 아니고, **신호가 실제로 목적지까지 흐르는 배선**이어야 통과한다.
// 그래서 노드 개수가 아니라 링크를 따라간 도달성으로 본다.
function eachCtrlGraph(fn) {
  forEachEntity(function (e) { if (e.type === 'controller' && e.graph) fn(e.graph); });
}
// startNid 에서 링크를 따라 도달하는 노드 중 kinds 에 속하는 것 전부.
// **첫 하나에서 멈추지 않는다** — 멈추면 "그 하나가 막다른 길일 때" 뒤에 있는
// 멀쩡한 경로를 못 보고 거짓 실패를 낸다.
// 걸음 수 누적 — 게이트가 "순환에서 탐색이 폭발하지 않는가"를 숫자로 검정한다.
// 이게 없으면 순환 방어가 깨졌는지를 "멈추나 안 멈추나"로만 볼 수 있는데,
// 안 멈추는 것은 게이트가 못 잡는다. 브라우저가 통째로 매달릴 뿐이다.
var reachStepsTotal = 0;
function resetReachSteps() { reachStepsTotal = 0; }
var REACH_LIMIT = 20000;

function reachableNodes(g, startNid, kinds, pred) {
  var seen = {}, stack = [startNid], out = [], guard = 0;
  // 상한은 seen 과 **겹치는 방어**다. seen 하나만 믿으면 그것이 깨진 순간
  // 판정이 틀리는 게 아니라 브라우저가 멈춘다 — 이 검사는 플레이어 기계에서
  // 초당 4번 돈다. 실제로 seen 을 지운 돌연변이가 헤드리스 브라우저를 영구히
  // 매달아 돌연변이 게이트 전체를 세웠고, 그래서 상한을 따로 두게 됐다.
  while (stack.length && guard++ < REACH_LIMIT) {
    var cur = stack.pop();
    if (seen[cur]) continue;   // 되먹임 배선 순환 방어 (reachableNodes 전용)
    seen[cur] = 1;
    for (var i = 0; i < g.links.length; i++) {
      var l = g.links[i];
      if (l.fn !== cur) continue;
      var nx = graphNode(g, l.tn);
      if (!nx) continue;
      if (kinds.indexOf(nx.kind) >= 0 && (!pred || pred(nx))) out.push(nx);
      stack.push(l.tn);
    }
  }
  reachStepsTotal += guard;
  return out;
}
function portFed(g, nid, port) {
  for (var i = 0; i < g.links.length; i++) {
    if (g.links[i].tn === nid && g.links[i].tp === port) return true;
  }
  return false;
}
// 출력 노드는 대상이 물려 있어야 실제로 공장을 움직인다. 대상이 빈 노드는 장식이다.
function hasTarget(n) { return !!n.cfg && n.cfg.ent !== null && n.cfg.ent !== undefined; }

// kindFrom 에서 출발해 kindsTo 중 하나에 닿는 배선이 어느 제어기에든 있는가
function ctrlFeeds(kindFrom, kindsTo, pred) {
  var hit = false;
  eachCtrlGraph(function (g) {
    if (hit) return;
    for (var i = 0; i < g.nodes.length; i++) {
      if (g.nodes[i].kind !== kindFrom) continue;
      if (reachableNodes(g, g.nodes[i].nid, kindsTo, pred).length) hit = true;
    }
  });
  return hit;
}
// kindFrom → (kindMid 를 거쳐) → kindTo. 중간 노드 후보를 전부 시도한다.
function ctrlPathThrough(kindFrom, kindMid, kindTo, midOk) {
  var hit = false;
  eachCtrlGraph(function (g) {
    if (hit) return;
    for (var i = 0; i < g.nodes.length; i++) {
      if (g.nodes[i].kind !== kindFrom) continue;
      var mids = reachableNodes(g, g.nodes[i].nid, [kindMid]);
      for (var j = 0; j < mids.length; j++) {
        if (midOk && !midOk(g, mids[j])) continue;
        if (reachableNodes(g, mids[j].nid, [kindTo], hasTarget).length) hit = true;
      }
    }
  });
  return hit;
}
// 인서터가 앞칸에 터렛을 두고 있는가 (= 탄약을 자동으로 넣는 배치인가)
function inserterFeedsTurret() {
  return !!anyEntity(function (e) {
    if (e.type !== 'inserter') return false;
    var t = inserterTarget(e);
    var tgt = entityAt(t.x, t.y);
    return !!tgt && tgt.type === 'turret';
  });
}
// srcNid 에서 나온 신호가 nid 의 port 번 입력으로 흘러드는가.
// 래치의 RESET(포트 1)에 타이머가 실제로 물렸는지 보려면 포트를 구별해야 한다.
function feedsPort(g, nid, port, srcNid) {
  if (!g.inLinks) return false;
  var lk = g.inLinks[nid + ':' + port];
  if (!lk) return false;
  if (lk.fn === srcNid) return true;
  // 사이에 AND 같은 노드가 끼어 있을 수 있으니 거슬러 올라간다
  // 변수명을 reachableNodes 와 다르게 둔다 — 같은 줄이 두 곳에 있으면 돌연변이
  // 앵커가 유일하지 않아 그 게이트를 검정할 수 없다(INVALID 로 걸렸다).
  var walked = {}, stack = [lk.fn];
  while (stack.length) {
    var cur = stack.pop();
    if (walked[cur]) continue;
    walked[cur] = 1;
    if (cur === srcNid) return true;
    for (var i = 0; i < g.links.length; i++) {
      if (g.links[i].tn === cur) stack.push(g.links[i].fn);
    }
  }
  return false;
}

function countEntityWhere(type, fn) {
  var n = 0;
  forEachEntity(function (e) { if (e.type === type && fn(e)) n++; });
  return n;
}

// --- 단계 정의 ---------------------------------------------------------------
// title : 한 줄 목표
// why   : 왜 하는지 (개념 한 문장)
// how   : 손이 할 일 — **한 줄에 하나씩.** 문단으로 쓰면 안 읽는다.
// need  : 드는 재료와 얻는 법 (없으면 생략). "부족하다"만 말하면 그 자리에서 막힌다.
// check : 세계 상태 판정
//
// 단축키는 건물에 고정돼 있다(BUILDINGS[].hotkey). 여기 적힌 번호는 연구를 해도 안 바뀐다.
var TUTORIAL_STEPS = [
  {
    id: 'miner',
    title: '채광기를 철광맥 위에 놓는다',
    why: '전주 5×5 안에 든 기계만 전기를 받는다. 전력망이 이 게임의 첫 제약이다.',
    how: [
      '건설 목록에서 <b>3 채광기</b>를 고른다',
      '지도의 <b>회색 돌무더기</b>(철광맥) 위에 좌클릭',
      '전기가 안 오면 <b>7 전주</b>를 발전기와 채광기 사이에 놓아 잇는다',
      '시작 발전기에는 연료가 이미 들어 있다'
    ],
    need: '톱니 5 · 철판 10 (보유 자재에 있다)',
    check: function () {
      return !!anyEntity(function (e) {
        return e.type === 'miner' && e.net >= 0 && !e.depleted;
      });
    }
  },
  {
    id: 'belt',
    title: '채광기 출구에 벨트를 잇는다',
    why: '기계는 스스로 물건을 옮기지 않는다. 벨트가 공장의 혈관이다.',
    how: [
      '<b>1 벨트</b>를 고른다',
      '채광기의 <b>노란 화살표</b>가 출구다 — <b>R</b>로 돌린다',
      '출구 칸부터 <b>좌클릭 드래그</b> — 방향까지 자동으로 이어진다'
    ],
    check: function () {
      return !!anyEntity(function (e) { return e.type === 'miner' && hasBeltInFront(e); });
    }
  },
  {
    id: 'smelt',
    title: '용광로로 철판을 만든다',
    why: '기계끼리는 직접 주고받지 않는다. 벨트에서 기계로 넣는 일은 인서터가 한다.',
    how: [
      '<b>4 용광로</b>를 벨트 옆에 놓는다',
      '<b>2 인서터</b>를 <b>벨트와 용광로 사이</b>에 놓는다',
      '인서터는 <b>뒤에서 집어 앞에 놓는다</b> — R로 방향을 맞춘다',
      '용광로는 처음 들어온 광석에 맞춰 레시피를 스스로 잡는다'
    ],
    need: '용광로 = 벽돌 5 + 철판 5 · 인서터 = 보유 자재에 12개 있다',
    check: function () { return prodStats.smelted >= 1; }
  },
  {
    id: 'chest',
    title: '철판을 상자에 5개 모은다',
    why: '상자는 저장이자 <b>제어기의 눈</b>이다. 나중에 여기 재고를 읽어 공장을 판단하게 만든다.',
    how: [
      '<b>8 상자</b>를 놓는다',
      '용광로 → <b>인서터</b> → 상자 로 잇는다',
      '거리가 멀면 사이에 벨트를 깐다 (인서터는 한 칸만 건넨다)',
      '상자에 든 것은 <b>세계에 있는 물건</b>이라 우측 [보유 자재]와 다르다',
      '쓰려면 상자를 좌클릭해 <b>[보유 자재로 가져오기]</b>를 누른다'
    ],
    check: function () {
      return !!anyEntity(function (e) {
        return e.type === 'chest' && invCount(e.inv, 'iron-plate') >= 5;
      });
    }
  },
  {
    id: 'assemble',
    title: '조립기로 톱니를 만든다',
    why: '조립기는 레시피를 지정해야 움직인다. 여기서부터 생산 사슬이 길어진다.',
    how: [
      '<b>5 조립기</b>를 놓고 <b>좌클릭</b>한다',
      '왼쪽 아래 인스펙터에서 레시피를 <b>톱니</b>로 고른다',
      '인서터로 철판을 넣어준다'
    ],
    need: '조립기 = 톱니 9 + 회로기판 3 + 철판 9 · 톱니는 우측 [손 조립]에서도 만든다',
    check: function () { return (prodStats.byRecipe['gear'] || 0) >= 1; }
  },
  {
    id: 'copper',
    title: '구리도 캔다 — 구리판을 만든다',
    why: '여기서부터 구리가 필요하다. 연구팩도, 회로기판도 구리로 만든다.',
    how: [
      '지도에서 <b>주황색 돌무더기</b>가 구리광맥이다',
      '철과 <b>똑같이</b> 잇는다: 채광기 → 벨트 → 인서터 → 용광로',
      '용광로는 구리광석이 들어오면 구리판으로 알아서 바꾼다',
      '철 라인과 <b>같은 용광로를 쓰지 마라</b> — 한 용광로는 한 가지만 굽는다'
    ],
    check: function () { return (prodStats.byRecipe['copper-plate'] || 0) >= 1; }
  },
  {
    id: 'research',
    title: '연구소를 돌려 연구를 시작한다',
    why: '연구가 새 건물과 제어기 노드를 연다.',
    how: [
      '<b>적색 연구팩 = 구리판 1 + 톱니 1</b>',
      '우측 <b>[손 조립]</b>에서 클릭하면 대기열에 하나 걸린다 — <b>손도 시간이 걸린다</b>',
      '손은 한 번에 하나씩만 만든다. 여러 대로 늘리려면 조립기를 세워야 한다',
      '조립기로 자동화한다면 재료가 <b>조립기 안에</b> 있어야 한다 — 인서터로 넣거나 조립기를 클릭해 <b>[보유 자재 넣기]</b>',
      '<b>9 연구소</b>를 놓고 인서터로 연구팩을 넣는다',
      '<b>T</b>를 눌러 무엇을 연구할지 고른다'
    ],
    need: '연구소 = 톱니 10 + 회로기판 10 + 벨트 4',
    check: function () { return !!currentResearch && researchProgress >= 1; }
  },
  {
    id: 'controller',
    title: '제어기를 놓고 편집기를 연다',
    why: '★ 여기서부터가 이 게임의 본체다. 제어기는 전기를 쓰지 않는다.',
    how: [
      '<b>제어기 = 회로기판 5 + 철판 5</b>',
      '<b>회로기판 = 철판 1 + 구리선 3</b>',
      '<b>구리선 = 구리판 1</b> → 2개가 나온다',
      '셋 다 우측 <b>[손 조립]</b>에서 클릭으로 예약한다 (구리선을 먼저 여러 개)',
      '<b>0 제어기</b>를 놓고 <b>좌클릭</b>하면 노드 편집기가 열린다'
    ],
    need: '재료가 모자라면 배치할 때 무엇이 몇 개 필요한지, 어디서 얻는지 알려준다',
    check: function () { return countEntity('controller') >= 1 && !!tutorial.flags.openedEditor; }
  },
  {
    id: 'wire',
    title: '재고를 보고 기계를 켜고 끄게 배선한다',
    why: '조건이 바뀌면 공장이 스스로 판단한다. 정답 배선은 없다.',
    how: [
      '편집기 위쪽 <b>[예제 불러오기]</b>를 누른다',
      '재고 히스테리시스 회로가 <b>대상까지 물린 채</b> 들어온다',
      '상자 재고가 50 미만이면 켜고 200 초과면 끈다 — 값을 바꿔 보라',
      '한 번 보고 나면 나머지는 응용이다'
    ],
    check: function () {
      return !!anyEntity(function (e) { return e.logicForced && e.fEnable; });
    }
  },
  {
    id: 'defend',
    title: '터렛을 세우고 탄약을 넣는다',
    why: '오염이 퍼지면 적이 온다. 첫 습격은 5분 뒤부터다.',
    how: [
      '<b>T</b>에서 <b>군수</b>를 연구한다',
      '터렛을 공장 바깥쪽에 놓는다',
      '<b>탄창 = 철판 4</b> — [손 조립]이나 조립기로 만든다',
      '<b>인서터로 넣어줘야 쏜다</b> — 방어도 생산 문제다'
    ],
    check: function () {
      return !!anyEntity(function (e) { return e.type === 'turret' && e.ammo > 0; });
    }
  }
];

// ===========================================================================
//  심화 과정 — 부하 차단과 방어
//
//  기초 10단계가 "공장을 짓는 법"이라면 여기는 "공장이 스스로 판단하게 만드는 법"이다.
//  두 주제를 고른 이유는 이 게임에서 **되먹임이 반드시 필요해지는 두 자리**이기 때문이다.
//    · 부하 차단 — 자르면 여유가 생기고, 여유가 생기면 되돌리고 싶어진다. 그 순환이
//      기억 없이는 발진한다. 제어의 첫 수업이 여기서 저절로 나온다.
//    · 방어      — 적은 오염을 따라오고 오염은 생산을 따라온다. 생산을 늘릴수록 방어가
//      비싸진다. 이 게임에서 유일하게 "덜 만드는 것"이 정답이 될 수 있는 축이다.
//
//  4단계는 **일부러 고장난 회로를 만들게 한다.** 떨리는 걸 직접 봐야 5단계의 래치가
//  왜 필요한지 안다. 고친 것만 보여주면 아무도 왜 그런지 모른다.
// ===========================================================================
var ADVANCED_STEPS = [
  {
    id: 'green-sci',
    title: '녹색 연구팩을 만든다',
    why: '심화 기능은 전부 녹색 연구팩을 먹는다. 녹색은 광석이 아니라 <b>완성품</b>(벨트·인서터)이 재료다 — 여기서부터 공장이 공장을 먹인다.',
    how: [
      '<b>T</b>에서 <b>물류학</b>을 먼저 연구한다 (적색 20)',
      '<b>녹색 연구팩 = 벨트 1 + 인서터 1</b>',
      '벨트와 인서터를 <b>쓰지 말고 재료로 모아라</b> — 이게 처음엔 아깝게 느껴진다',
      '우측 <b>[손 조립]</b>으로도 되고, 조립기에 레시피를 걸어도 된다'
    ],
    need: '벨트 = 톱니 1 + 철판 1 (2개 나옴) · 인서터 = 톱니 1 + 회로기판 1 + 철판 1',
    check: function () { return (prodStats.byRecipe['sci-green'] || 0) >= 1; }
  },
  {
    id: 'mem-tech',
    title: '논리 II — 기억소자를 연구한다',
    why: '지금 제어기는 <b>지금 이 순간</b>만 본다. 기억이 없으면 "아까 내가 껐었나"를 모르고, 그래서 다음 단계의 부하 차단이 반드시 떨린다.',
    how: [
      '<b>T</b>에서 <b>논리 II — 기억소자</b>를 연구한다',
      '연구가 끝나면 왼쪽 목록의 <b>SR 래치·카운터·엣지 검출·샘플 홀드</b> 자물쇠가 풀린다'
    ],
    need: '적색 연구팩 40 · 선행 = 물류학',
    check: function () { return !!techDone['logic-mem']; }
  },
  {
    id: 'see-power',
    title: '제어기가 전기를 보게 한다',
    why: '자를지 말지는 "얼마나 모자라나"에서 나온다. 판단을 만들기 전에 먼저 <b>눈</b>을 붙인다.',
    how: [
      '제어기를 <b>좌클릭</b>해 편집기를 연다',
      '입력에서 <b>전력 만족도</b>를 놓는다',
      '출력에서 <b>수치 표시</b>를 놓는다',
      '전력 만족도의 <b>만족%</b> 포트를 끌어 수치 표시에 잇는다',
      '<b>100</b>이 뜨면 전기가 남는 것이고, 숫자가 내려가면 기계가 느려지고 있다는 뜻이다',
      '<b>0이 계속 뜨면 제어기가 전주 범위 밖이다</b> — 제어기는 전기를 안 써서 밖에 놓기 쉬운데, 밖이면 전기를 못 읽는다'
    ],
    need: '제어기를 <b>전주 5×5 안</b>으로 옮겨야 만족%가 읽힌다. 편집기 위쪽에 경고가 뜬다.',
    check: function () { return ctrlFeeds('power', ['display', 'lamp']); }
  },
  {
    id: 'naive-shed',
    title: '순진하게 잘라 보고 — 떨리는 것을 직접 본다',
    why: '★ 이 단계는 <b>일부러 고장난 것을 만든다.</b> 자르면 여유가 생기고, 여유가 생기면 되돌아가고, 되돌아가면 또 모자란다. 이 순환을 눈으로 봐야 다음 단계가 이해된다.',
    how: [
      '<b>비교</b> 노드를 놓는다 — 연산은 <b>&gt;=</b>',
      '전력 만족도의 <b>만족%</b> → 비교의 <b>A</b>',
      '<b>상수</b> 95 → 비교의 <b>B</b>',
      '비교의 <b>참</b> → <b>기계 가동/정지</b>, 대상은 <b>안 급한 기계</b>(연구소나 여분 조립기)',
      '읽으면 "<b>전기가 95% 이상일 때만 돌린다</b>" 가 된다 — 부등호를 뒤집으면 모자랄 때 켜는 꼴이 되니 주의',
      '전기를 일부러 모자라게 만든다 — 기계를 더 짓거나 발전기 하나를 정지시킨다',
      '그 기계가 <b>1초에도 몇 번씩</b> 켜졌다 꺼지는지 본다'
    ],
    need: '이 배선은 <b>틀린 배선이다.</b> 다음 단계에서 고친다.',
    check: function () { return ctrlPathThrough('power', 'cmp', 'enable'); }
  },
  {
    id: 'latch-shed',
    title: 'SR 래치로 문턱을 벌린다 — 그런데도 아직 떤다',
    why: '에어컨은 26도에 켜고 26도에 끄지 않는다. <b>26도에 켜고 24도까지 내려가야 끈다.</b> ' +
         '켜는 문턱과 끄는 문턱을 벌리고 그 사이는 <b>기억</b>으로 버틴다 — 그게 SR 래치다. ' +
         '★ 그런데 이 게임에서는 <b>래치만으로는 안 멈춘다.</b> 왜 그런지는 다음 단계에서 본다.',
    how: [
      '<b>SR 래치</b>를 놓는다 — 출력 Q를 "지금 끊어야 하나"로 쓴다',
      '비교 <b>여유kW &lt; 0</b> → 래치의 <b>SET</b> (모자라다 → 끊어라)',
      '비교 <b>여유kW &gt; 200</b> → 래치의 <b>RESET</b> (남는다 → 되돌려라)',
      '<b>논리 NOT A</b>로 Q를 뒤집어 <b>기계 가동/정지</b>에 잇는다 (Q=끊음이므로)',
      '<b>여유kW</b>를 쓴다 — 만족%는 100%에서 잘려서 "얼마나 남는가"를 알 수 없다',
      '전기를 모자라게 만들고 그 기계를 본다 — <b>여전히 떨린다.</b> 그게 정상이다'
    ],
    need: '만족% 대신 <b>여유kW</b>를 쓰는 이유: 만족%는 min(100%) 이라 차단하면 늘 정확히 100이 된다',
    check: function () {
      return ctrlPathThrough('power', 'latch', 'enable', function (g, L) {
        return portFed(g, L.nid, 1);     // RESET 이 안 물리면 한 번 끊고 영영 안 돌아온다
      });
    }
  },
  {
    id: 'timer-shed',
    title: '타이머로 복귀를 늦춘다 — 부하 차단 완성',
    why: '★ 문턱을 벌려도 떠는 이유: 끊으면 전기가 남고, 남으면 되돌리고, 되돌리면 또 모자란다. ' +
         '<b>두 상태가 어떤 문턱이든 양쪽으로 넘나든다.</b> 이건 문턱을 더 벌려서 못 고친다 — ' +
         '<b>되돌리는 것을 늦춰야</b> 한다. 실제 배전 설비도 이렇게 한다(최소 차단 시간).',
    how: [
      '<b>타이머</b>를 놓고 주기를 <b>30</b>으로 한다',
      '<b>논리 AND</b>를 놓는다',
      '<b>여유kW &gt; 200</b>(남는다) → AND의 A · <b>타이머 펄스</b> → AND의 B',
      'AND의 출력 → 래치의 <b>RESET</b> (앞 단계에서 직결했던 것을 이걸로 바꾼다)',
      '이제 복귀는 <b>30초에 한 번만</b> 시도한다 — 떨림이 멈춘다',
      '끊는 쪽(SET)은 늦추지 않는다 — 전기가 모자라면 즉시 끊어야 한다'
    ],
    need: '측정치: 비교기만 300틱에 299회 떨림 · 래치만 299회 · <b>래치+타이머 0회</b>',
    check: function () {
      // 래치의 RESET 이 타이머를 거친 신호로 물렸는가.
      // 래치만으로는 못 멈춘다는 것이 실측됐으므로, 여기서는 타이머까지 요구한다.
      var ok = false;
      eachCtrlGraph(function (g) {
        if (ok) return;
        for (var i = 0; i < g.nodes.length; i++) {
          if (g.nodes[i].kind !== 'timer') continue;
          var lats = reachableNodes(g, g.nodes[i].nid, ['latch']);
          for (var j = 0; j < lats.length; j++) {
            // 타이머가 RESET(포트 1) 쪽으로 흘러야 한다
            if (!feedsPort(g, lats[j].nid, 1, g.nodes[i].nid)) continue;
            if (reachableNodes(g, lats[j].nid, ['enable'], hasTarget).length) ok = true;
          }
        }
      });
      return ok;
    }
  },
  {
    id: 'wall-turret',
    title: '벽으로 길을 좁히고 터렛을 세운다',
    why: '적은 <b>오염 구름을 따라</b> 온다. 벽은 적을 세우는 것이 아니라 <b>어디로 올지 정하는 것</b>이다 — 터렛 앞으로 오게 만드는 도구다.',
    how: [
      '<b>T</b>에서 <b>군수</b>를 연구한다 (적색 20)',
      '우하단 <b>지도</b>에서 둥지(적 진영) 방향을 확인한다',
      '그쪽 면에 <b>벽을 12칸 이상</b> 줄지어 세운다',
      '<b>터렛 2기</b>를 벽 <b>뒤</b>에 놓는다 — 사거리 18칸이라 벽 너머를 쏜다',
      '터렛만 흩어 놓으면 적이 사이로 지나쳐 공장을 문다'
    ],
    need: '벽 = 벽돌 2 · 터렛 = 톱니 10 + 철판 20',
    check: function () { return countEntity('wall') >= 12 && countEntity('turret') >= 2; }
  },
  {
    id: 'ammo-line',
    title: '탄약 보급을 자동화한다',
    why: '손으로 넣는 방어는 <b>첫 습격만</b> 막는다. 두 번째에 빈 터렛이 된다. 방어도 결국 생산 라인이다.',
    how: [
      '조립기 하나의 레시피를 <b>탄창</b>으로 바꾼다 (철판 4)',
      '벨트로 터렛 근처까지 끌고 간다',
      '<b>인서터의 앞칸이 터렛</b>이 되게 놓는다 — R로 방향을 맞춘다',
      '터렛 2기가 각각 <b>20발 이상</b> 차면 통과다',
      '급하면 터렛을 클릭해 <b>[보유 자재 넣기]</b>로 먼저 채워도 된다'
    ],
    need: '탄창 1개 = 철판 4 · 터렛 하나가 가득 차면 200발',
    check: function () {
      return countEntityWhere('turret', function (e) { return e.ammo >= 20; }) >= 2 &&
             inserterFeedsTurret();
    }
  },
  {
    id: 'defense-auto',
    title: '적이 오면 공장이 스스로 물러선다',
    why: '습격 중에 제일 급한 건 전기다. 적이 붙었을 때 연구소가 전기를 먹고 있으면 터렛이 느려진다. <b>적 근접</b>을 신호로 읽어 생산을 잠시 접는다.',
    how: [
      '<b>T</b>에서 <b>방어 자동화</b>를 연구한다',
      '입력에서 <b>적 근접</b>을 놓는다 (반경 30)',
      '<b>마릿수</b> → <b>비교 &gt; 0</b> → <b>경보 램프</b> (문구는 "습격")',
      '같은 신호를 <b>논리 NOT A</b>에 넣고, 그 출력을 <b>기계 가동/정지</b>에 잇는다',
      '적이 있으면 0 → 그 기계가 멈추고, 적이 없으면 1 → 다시 돈다',
      '이게 부하 차단과 같은 구조다 — 읽는 대상만 전기에서 적으로 바뀌었다'
    ],
    need: '적색 50 + 녹색 50 · 선행 = 군수 + 논리 II',
    check: function () { return ctrlFeeds('enemy', ['lamp', 'enable', 'fire']); }
  }
];

// 현재 트랙의 단계 배열
function curSteps() { return tutorial.track === 'adv' ? ADVANCED_STEPS : TUTORIAL_STEPS; }
function trackName() { return tutorial.track === 'adv' ? '심화' : '튜토리얼'; }

// 기초를 끝낸 사람만 심화로 넘어간다. 되돌아가지는 않는다 —
// 기초 진행도를 덮어쓰면 "다 깼는데 다시 10/10 이 아니다"가 되어 후퇴로 읽힌다.
function startAdvanced() {
  if (tutorial.track === 'adv') return false;
  // 기초를 안 끝냈으면 거절한다. 심화는 공장이 이미 돌아가고 있다고 **가정하고**
  // 쓰여 있어서 (제어기·연구소·전력망이 있다는 전제), 빈 판에서 열면 첫 단계부터
  // 막힌다. 버튼은 완료 화면에만 나오지만 저장본 조작이나 훅으로도 못 들어오게 막는다.
  if (!tutorial.done) return false;
  tutorial.track = 'adv';
  tutorial.step = 0;
  tutorial.done = false;
  tutorial.justDone = -1;
  tutorial.on = true;
  return true;
}

// --- 진행 --------------------------------------------------------------------
var tutorTimer = 0;
function stepTutorial(dt) {
  if (!tutorial.on || tutorial.done) return;
  if (tutorial.celebrateT > 0) tutorial.celebrateT -= dt;
  tutorTimer += dt;
  if (tutorTimer < 0.25) return;      // 4Hz 로 충분하다
  tutorTimer = 0;
  var steps = curSteps();
  var s = steps[tutorial.step];
  if (!s) { tutorial.done = true; return; }
  var ok = false;
  try { ok = !!s.check(); } catch (e) { logError('tutorial:' + s.id, e); }
  if (!ok) return;
  tutorial.justDone = tutorial.step;
  tutorial.celebrateT = 2.2;
  tutorial.step++;
  if (tutorial.step >= steps.length) {
    tutorial.done = true;
    if (typeof toast === 'function') {
      toast(tutorial.track === 'adv'
        ? '심화 과정 완료 — 공장이 스스로 판단한다'
        : '튜토리얼 완료 — 이제 공장은 당신 것이다', 'good');
    }
  } else if (typeof toast === 'function') {
    toast('✔ ' + s.title, 'good');
  }
  renderTutorial();
}

// 건너뛰기는 "이 단계를 안 하고 넘어간다" — 튜토리얼 자체를 끄는 것과 다르다.
// step 은 총 단계 수를 넘지 않게 고정한다 (넘게 두면 진행 표시가 24/9 처럼 나온다).
function skipTutorialStep() {
  if (tutorial.done) return tutorial.step;
  var n = curSteps().length;
  tutorial.step++;
  if (tutorial.step >= n) {
    tutorial.step = n;
    tutorial.done = true;
  }
  return tutorial.step;
}

function resetTutorial(on) {
  tutorial.on = on !== false;
  tutorial.track = 'basic';
  tutorial.step = 0;
  tutorial.done = false;
  tutorial.flags = {};
  tutorial.justDone = -1;
  tutorial.celebrateT = 0;
  tutorTimer = 0;
  resetProdStats();
}

// --- 패널 --------------------------------------------------------------------
function renderTutorial() {
  var host = document.getElementById('tutor');
  if (!host) return;
  if (!tutorial.on) { host.style.display = 'none'; return; }
  host.style.display = 'block';

  var body = document.getElementById('tutorBody');
  var head = document.getElementById('tutorHead');
  var foot = document.getElementById('tutorFoot');
  var steps = curSteps();
  var n = steps.length;

  if (tutorial.done) {
    head.textContent = trackName() + ' — 완료 ' + n + '/' + n;
    if (foot) foot.style.display = 'none';
    if (tutorial.track === 'basic') {
      body.innerHTML =
        '<div class="ok" style="font-weight:600;margin-bottom:6px">전부 끝냈다.</div>' +
        '<div class="dim" style="font-size:11.5px;line-height:1.6;margin-bottom:8px">' +
        '공장 짓는 법은 익혔다. 남은 것은 <b>공장이 스스로 판단하게 만드는 일</b>이다.<br>' +
        '심화 과정 8단계는 두 가지를 가르친다 — 전기가 모자랄 때 <b>덜 급한 라인부터 끊는 것</b>(부하 차단)과, ' +
        '<b>적의 습격을 막는 것</b>. 둘 다 순진하게 하면 실패하고, 왜 실패하는지를 직접 보게 한다.</div>' +
        '<button id="tutorAdv" style="width:100%">심화 과정 시작 — 부하 차단과 방어</button>';
      var ab = document.getElementById('tutorAdv');
      if (ab) ab.onclick = function () { startAdvanced(); renderTutorial(); };
    } else {
      body.innerHTML =
        '<div class="ok" style="font-weight:600;margin-bottom:6px">심화까지 끝냈다.</div>' +
        '<div class="dim" style="font-size:11.5px;line-height:1.6">' +
        '이제 가르칠 것이 없다. 남은 것은 당신이 정한다 — 되먹임을 어디에 걸지, 무엇을 먼저 끊을지, ' +
        '얼마나 크게 지을지. 오염은 생산에 비례하고 적은 오염을 따라오므로, ' +
        '<b>덜 만드는 것이 정답인 순간</b>이 반드시 온다. H로 도움말을 볼 수 있다.</div>';
    }
    return;
  }
  if (foot) foot.style.display = '';

  // step 이 배열을 넘어서면 여기서 s 가 undefined 가 되어 패널이 통째로 죽는다
  // (돌연변이 시험이 실제로 이 경로를 밟아 드라이버를 죽였다). 지금 코드로는 그런
  // step 이 나올 수 없지만, 저장본 손상이나 트랙 계산 실수 한 번이면 나온다.
  if (tutorial.step >= n) { tutorial.step = n; tutorial.done = true; renderTutorial(); return; }

  head.textContent = trackName() + ' ' + (tutorial.step + 1) + '/' + n;
  var s = steps[tutorial.step];
  var lines = [];
  // 지나온 단계는 접어서 성취감만 남긴다
  if (tutorial.step > 0) {
    lines.push('<div class="tdone">');
    for (var i = 0; i < tutorial.step; i++) {
      lines.push('<span class="tchk">✔</span> ' + steps[i].title + '<br>');
    }
    lines.push('</div>');
  }
  lines.push('<div class="tnow">' + s.title + '</div>');
  lines.push('<div class="twhy">' + s.why + '</div>');
  // how 는 한 줄에 하나씩 — 문단으로 붙여 놓으면 읽지 않는다
  lines.push('<ol class="thow">');
  for (var h = 0; h < s.how.length; h++) lines.push('<li>' + s.how[h] + '</li>');
  lines.push('</ol>');
  if (s.need) lines.push('<div class="tneed">' + s.need + '</div>');
  body.innerHTML = lines.join('');
}

function bindTutorial() {
  var sk = document.getElementById('tutorSkip');
  var cl = document.getElementById('tutorClose');
  if (sk) sk.onclick = function () { skipTutorialStep(); renderTutorial(); };
  if (cl) cl.onclick = function () { tutorial.on = false; renderTutorial(); };
  var re = document.getElementById('tutorBtn');
  if (re) re.onclick = function () {
    if (!tutorial.on) { tutorial.on = true; renderTutorial(); return; }
    resetTutorial(true); renderTutorial();
  };
}
