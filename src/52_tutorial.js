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
// title: 한 줄 목표 · why: 왜 하는지(개념) · how: 손이 할 일 · check: 세계 상태 판정
var TUTORIAL_STEPS = [
  {
    id: 'miner',
    title: '채광기를 광맥 위에 놓고 전기를 보낸다',
    why: '전주 5×5 안에 든 기계만 전기를 받는다. 전력망이 이 게임의 첫 제약이다.',
    how: '단축키 3 → 지도의 회색 돌무더기(철광맥) 위에 좌클릭. 전기가 안 오면 전주(8)를 사이에 놓아 이어라. 시작 발전기는 이미 연료가 들어 있다.',
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
    how: '채광기의 노란 화살표가 출구다(R로 회전). 단축키 1 → 출구 칸부터 좌클릭 드래그하면 방향까지 자동으로 이어 깔린다.',
    check: function () {
      return !!anyEntity(function (e) { return e.type === 'miner' && hasBeltInFront(e); });
    }
  },
  {
    id: 'smelt',
    title: '용광로로 철판을 만든다',
    why: '광석은 그대로 못 쓴다. 벨트에서 기계로 넣는 일은 인서터가 한다 — 기계끼리는 직접 주고받지 않는다.',
    how: '단축키 4로 용광로를 놓고, 단축키 2로 인서터를 벨트와 용광로 사이에 놓는다. 인서터는 뒤에서 집어 앞에 놓는다(R로 방향).',
    check: function () { return prodStats.smelted >= 1; }
  },
  {
    id: 'chest',
    title: '철판을 상자에 5개 모은다',
    why: '상자는 저장이자 **제어기의 눈**이다. 뒤에서 재고를 읽어 공장을 판단하게 만든다.',
    how: '단축키 9로 상자를 놓고, 용광로 → 인서터 → (벨트) → 인서터 → 상자로 잇는다.',
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
    how: '단축키 5로 조립기를 놓고 좌클릭 → 인스펙터에서 레시피를 "톱니"로. 철판을 인서터로 넣어라.',
    check: function () { return (prodStats.byRecipe['gear'] || 0) >= 1; }
  },
  {
    id: 'research',
    title: '연구소를 돌려 연구를 시작한다',
    why: '연구가 새 건물과 제어기 노드를 연다. 적색 연구팩은 구리판+톱니로 만든다.',
    how: '단축키 0으로 연구소를 놓고, 조립기 레시피를 "적색 연구팩"으로 바꿔 만든 뒤 인서터로 연구소에 넣는다. T로 연구창을 열어 무엇을 연구할지 고른다.',
    check: function () { return !!currentResearch && researchProgress >= 1; }
  },
  {
    id: 'controller',
    title: '제어기를 놓고 편집기를 연다',
    why: '★ 여기서부터가 이 게임의 본체다. 제어기는 전기를 쓰지 않는다.',
    how: '건설 목록에서 제어기를 놓고 **좌클릭**하면 노드 편집기가 열린다.',
    check: function () { return countEntity('controller') >= 1 && !!tutorial.flags.openedEditor; }
  },
  {
    id: 'wire',
    title: '재고를 보고 기계를 켜고 끄게 배선한다',
    why: '조건이 바뀌면 공장이 스스로 판단한다. 정답 배선은 없다 — 같은 목표를 여러 방법으로 풀 수 있다.',
    how: '편집기에서 [예제 불러오기]를 누르면 재고 히스테리시스 회로가 대상까지 물린 채 들어온다. 한 번 보고 나면 나머지는 응용이다. (상자와 조립기를 먼저 지어 두면 자동으로 물린다)',
    check: function () {
      return !!anyEntity(function (e) { return e.logicForced && e.fEnable; });
    }
  },
  {
    id: 'defend',
    title: '터렛을 세우고 탄약을 넣는다',
    why: '오염이 퍼지면 적이 온다. 터렛은 탄창을 인서터로 넣어줘야 쏜다 — 방어도 생산 문제다.',
    how: 'T에서 군수를 연구한 뒤 터렛을 놓고, 조립기로 탄창을 만들어 인서터로 넣는다.',
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
  lines.push('<div class="thow">' + s.how + '</div>');
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
