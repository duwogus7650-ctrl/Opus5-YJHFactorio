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
  step: 0,           // 현재 단계 인덱스
  done: false,
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
      '우측 <b>[손 조립]</b>에서 클릭하면 하나씩 바로 만들어진다',
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
      '셋 다 우측 <b>[손 조립]</b>에서 클릭으로 만든다 (구리선을 먼저 여러 개)',
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

// --- 진행 --------------------------------------------------------------------
var tutorTimer = 0;
function stepTutorial(dt) {
  if (!tutorial.on || tutorial.done) return;
  if (tutorial.celebrateT > 0) tutorial.celebrateT -= dt;
  tutorTimer += dt;
  if (tutorTimer < 0.25) return;      // 4Hz 로 충분하다
  tutorTimer = 0;
  var s = TUTORIAL_STEPS[tutorial.step];
  if (!s) { tutorial.done = true; return; }
  var ok = false;
  try { ok = !!s.check(); } catch (e) { logError('tutorial:' + s.id, e); }
  if (!ok) return;
  tutorial.justDone = tutorial.step;
  tutorial.celebrateT = 2.2;
  tutorial.step++;
  if (tutorial.step >= TUTORIAL_STEPS.length) {
    tutorial.done = true;
    if (typeof toast === 'function') toast('튜토리얼 완료 — 이제 공장은 당신 것이다', 'good');
  } else if (typeof toast === 'function') {
    toast('✔ ' + s.title, 'good');
  }
  renderTutorial();
}

// 건너뛰기는 "이 단계를 안 하고 넘어간다" — 튜토리얼 자체를 끄는 것과 다르다.
// step 은 총 단계 수를 넘지 않게 고정한다 (넘게 두면 진행 표시가 24/9 처럼 나온다).
function skipTutorialStep() {
  if (tutorial.done) return tutorial.step;
  tutorial.step++;
  if (tutorial.step >= TUTORIAL_STEPS.length) {
    tutorial.step = TUTORIAL_STEPS.length;
    tutorial.done = true;
  }
  return tutorial.step;
}

function resetTutorial(on) {
  tutorial.on = on !== false;
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
  var n = TUTORIAL_STEPS.length;

  if (tutorial.done) {
    head.textContent = '튜토리얼 — 완료 ' + n + '/' + n;
    body.innerHTML =
      '<div class="ok" style="font-weight:600;margin-bottom:6px">전부 끝냈다.</div>' +
      '<div class="dim" style="font-size:11.5px;line-height:1.6">' +
      '이제 스스로 할 차례다. 다음으로 해볼 만한 것: <b>부하 차단</b> — 전력 만족도가 떨어지면 ' +
      '우선순위가 낮은 라인을 먼저 끈다. 순진하게 배선하면 발진하니 <b>SR 래치 + 타이머</b>가 필요하다. ' +
      'H를 눌러 도움말에서 자세히 볼 수 있다.</div>';
    return;
  }

  head.textContent = '튜토리얼 ' + (tutorial.step + 1) + '/' + n;
  var s = TUTORIAL_STEPS[tutorial.step];
  var lines = [];
  // 지나온 단계는 접어서 성취감만 남긴다
  if (tutorial.step > 0) {
    lines.push('<div class="tdone">');
    for (var i = 0; i < tutorial.step; i++) {
      lines.push('<span class="tchk">✔</span> ' + TUTORIAL_STEPS[i].title + '<br>');
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
