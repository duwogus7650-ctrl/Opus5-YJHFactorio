// ===========================================================================
//  55_logicui.js — 노드 그래프 편집기 (DOM 노드 + SVG 배선)
//
//  캔버스에 직접 그리지 않고 DOM 을 쓴다 — 노드 안에 <select>/<input> 이 들어가야
//  설정이 편하고, 링크만 SVG 로 그리면 곡선도 공짜다.
// ===========================================================================

var logicOpen = false;
var curCtrl = null;
var gpan = { x: 60, y: 40, z: 1 };
var linking = null;         // { nid, port } — 출력 포트에서 끌기 시작
var liveTimer = null;

function openLogic(e) {
  var switching = (curCtrl !== e);
  curCtrl = e;
  logicOpen = true;
  if (!e.graph) e.graph = newGraph();
  // **다른 제어기를 열면 화면을 처음으로 되돌린다.** 예전에는 이전 제어기에서
  // 끌어다 놓은 위치가 그대로 남아, 노드가 있는데도 빈 화면만 보였다.
  if (switching) { gpan.x = 20; gpan.y = 20; gpan.z = 1; }
  document.getElementById('logic').style.display = 'block';
  document.getElementById('ctrlName').textContent = '#' + e.id;
  tutorial.flags.openedEditor = true;    // 상태로는 못 보는 사건이라 여기서 표시한다
  renderPalette();
  // **문장 화면이 먼저다.** 빈 캔버스에 노드를 놓는 일은 무엇을 만들지 이미 아는
  // 사람만 할 수 있고, 그게 이 게임에서 가장 높은 벽이었다. 회로를 손으로 고친
  // 제어기만 그래프로 연다.
  showRules(!e.handEdited);
  // 파형은 **연 제어기 하나만** 담는다. 여는 순간부터 담기 시작하므로 8초쯤
  // 지나야 창이 다 찬다 — 그 전에는 있는 만큼만 그린다.
  scopeWatch(e.id);
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(updateLive, 140);
}
function closeLogic() {
  logicOpen = false;
  scopeWatch(-1);                       // 안 보는 파형을 계속 담을 이유가 없다
  document.getElementById('logic').style.display = 'none';
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  curCtrl = null;
  linking = null;
}
// 철거된 엔티티가 지금 편집 중인 제어기면 편집기를 닫는다 (25_entity.js 가 부른다)
function closeLogicIfEditing(id) {
  if (logicOpen && curCtrl && curCtrl.id === id) {
    closeLogic();
    toast('편집 중이던 제어기가 철거되어 편집기를 닫았다', 'bad');
  }
}

// --- 팔레트 ------------------------------------------------------------------
function renderPalette() {
  var host = document.getElementById('pal');
  if (!host) return;
  var cats = [['in', '입력 — 공장을 읽는다'], ['op', '연산 — 판단한다'], ['out', '출력 — 공장을 움직인다']];
  var h = [];
  for (var c = 0; c < cats.length; c++) {
    h.push('<div class="pcat">' + cats[c][1] + '</div>');
    for (var i = 0; i < NODE_KINDS.length; i++) {
      var k = NODE_KINDS[i], d = NODE_DEFS[k];
      if (d.cat !== cats[c][0]) continue;
      var lock = !nodeAvailable(k);
      h.push('<div class="pitem' + (lock ? ' locked' : '') + '" data-k="' + k + '" title="' +
        (lock ? TECHS[d.tech].name + ' 연구 필요' : '클릭해서 추가') + '">' +
        d.label + (lock ? ' 🔒' : '') + '</div>');
    }
  }
  host.innerHTML = h.join('');
  var items = host.querySelectorAll('.pitem');
  for (var j = 0; j < items.length; j++) {
    items[j].onclick = (function (kind) {
      return function () {
        if (!nodeAvailable(kind)) { toast(TECHS[NODE_DEFS[kind].tech].name + ' 연구가 필요하다', 'bad'); return; }
        markGraphHandEdited();
        var wrap = document.getElementById('graphWrap');
        var nx = (wrap.clientWidth / 2 - gpan.x) / gpan.z + (curCtrl.graph.nodes.length % 4) * 14;
        var ny = (wrap.clientHeight / 2 - gpan.y) / gpan.z + (curCtrl.graph.nodes.length % 5) * 16;
        graphAddNode(curCtrl.graph, kind, Math.max(10, nx - 89), Math.max(10, ny - 40));
        renderGraph();
      };
    })(items[j].getAttribute('data-k'));
  }
}

// --- 그래프 렌더 -------------------------------------------------------------
function applyPan() {
  var inner = document.getElementById('graphInner');
  inner.style.transform = 'translate(' + gpan.x + 'px,' + gpan.y + 'px) scale(' + gpan.z + ')';
}

function renderGraph() {
  // 컴파일은 updateLinks 한 곳에서만 한다(여기서도 하면 중복이고, 두 곳에 같은
  // 방어가 있으면 한쪽을 깨뜨려도 다른 쪽이 가려 게이트를 검정할 수 없다).
  var inner = document.getElementById('graphInner');
  if (!inner || !curCtrl) return;
  var g = curCtrl.graph;
  // 기존 노드 DOM 제거 (svg 는 남긴다)
  var old = inner.querySelectorAll('.node');
  for (var i = 0; i < old.length; i++) inner.removeChild(old[i]);

  for (var n = 0; n < g.nodes.length; n++) buildNodeDom(inner, g, g.nodes[n]);
  applyPan();
  updateLinks();
  updateCycleInfo(g);
}

// 제어기가 전력망 밖이면 [전력 만족도] 노드가 **영원히 0** 을 낸다 (netSatOf 는
// net<0 에 0 을 돌려준다). 제어기는 전기를 안 쓰므로 전주 밖에 놓기 쉬운데,
// 그러면 부하 차단 회로 전체가 조용히 죽고 화면에는 아무 단서도 없다.
// 측정 하네스가 실제로 이 함정에 걸려 "발진 0회"라는 거짓 결론을 냈다.
function updateCycleInfo(g) {
  var el = document.getElementById('cycleInfo');
  if (!el) return;
  var txt = g.nodes.length + '노드 · ' + g.links.length + '배선' +
            (g.cycles ? ' · 되먹임 ' + g.cycles + '개(1틱 지연)' : '');
  var offGrid = false;
  for (var i = 0; i < g.nodes.length; i++) {
    if (g.nodes[i].kind === 'power') { offGrid = !!curCtrl && curCtrl.net < 0; break; }
  }
  el.innerHTML = offGrid
    ? txt + ' · <b class="bad">이 제어기가 전력망 밖이다 — 만족%가 0으로 읽힌다. 전주 범위 안으로 옮겨라</b>'
    : txt;
}

// --- 출력 노드의 "지금 무슨 일을 하는가" -------------------------------------
// 이 게임에서 가장 자주 걸리는 함정: [기계 가동/정지]의 입력 포트는 **가동** 이다.
// 신호가 참이면 "돌려라" 다. 그래서 '재고 과다' 같은 조건을 그대로 물리면
// "재고 과다일 때 돌려라" 가 되어 의도와 정반대가 된다. 나도, 사용자도 똑같이
// 여기서 틀렸다 — 두 사람이 같은 자리에서 걸렸으면 이름 탓이다.
// 그래서 노드가 **지금 실제로 하는 일**을 스스로 말하게 한다. 배선하는 순간
// 뜻이 뒤집혔는지 보인다. 게이트·필터·사격허가도 같은 함정이 있어 같이 다룬다.
function entName(id) {
  var e = entities[id];
  // **'null' 을 화면에 내보내지 않는다.** 문장에 null 이 박히면 그건 문장이 아니다.
  if (!e) return '(대상 고르기)';
  return BUILDINGS[e.type].name + ' #' + e.id;
}
function outputMeaning(g, n) {
  var d = NODE_DEFS[n.kind];
  if (d.cat !== 'out') return null;
  var fed = !!g.inLinks && !!g.inLinks[n.nid + ':0'];
  var v = readIn(g, n, 0);
  var on = truthy(v);
  // 대상 엔티티를 고르지 않는 출력 노드들 — 경보·수치표시·신호 송신은 화면과
  // 채널이 대상이라 '대상이 비어 있다' 검사에 걸리면 안 된다.
  var noEnt = (n.kind === 'lamp' || n.kind === 'display' || n.kind === 'bussend');
  var who = noEnt ? null : entName(n.cfg.ent);

  // 대상이 없으면 이 노드는 장식이다. 이것이 "배선했는데 아무 반응이 없다" 의 정체다.
  // **판정은 이름 문자열이 아니라 대상 자체로 한다.** entName 이 사람이 읽을 문구를
  // 돌려주도록 바꾼 순간 `!who` 가 영원히 거짓이 돼 이 검사가 통째로 죽었다 —
  // 표시용 함수를 술어로 쓰면 표시를 고칠 때 판정이 조용히 따라 바뀐다.
  if (!noEnt && !entities[n.cfg.ent]) {
    return { bad: true, text: '대상이 비어 있다 — 배선해도 아무 일도 하지 않는다' };
  }
  if (!fed) {
    return { bad: true, text: '입력이 안 물렸다 — 늘 ' +
      (n.kind === 'enable' ? '멈춤' : n.kind === 'gate' ? '닫힘' :
       n.kind === 'fire' ? '사격 금지' : n.kind === 'filter' ? '0일 때 품목' :
       n.kind === 'bussend' ? '아무것도 안 보냄' : '꺼짐') + ' 으로 본다' };
  }
  var now = on ? '참' : '거짓';
  switch (n.kind) {
    case 'enable':
      return { bad: false, text: '지금 ' + now + ' → ' + who + ' 를 ' +
                                 (on ? '돌린다' : '멈춘다') };
    case 'gate':
      return { bad: false, text: '지금 ' + now + ' → ' + who + ' 가 ' +
                                 (on ? '열린다' : '닫힌다') };
    case 'fire':
      return { bad: false, text: '지금 ' + now + ' → ' + who + ' ' +
                                 (on ? '사격 허가' : '사격 금지') };
    case 'filter': {
      var pick = on ? n.cfg.b : n.cfg.a;
      return { bad: false, text: '지금 ' + now + ' → ' + who + ' 가 ' +
        (pick ? ITEMS[pick].name + ' 만 집는다' : '아무거나 집는다') };
    }
    case 'lamp':
      return { bad: false, text: '지금 ' + now + ' → 경보 ' + (on ? '켜짐' : '꺼짐') };
    case 'display':
      return { bad: false, text: '지금 값 ' + fmt(v, 2) };
    case 'bussend':
      // 지금 보내는 값과, 채널에서 **지금 읽히는** 값을 함께 적는다. 둘은 한 틱
      // 어긋나 있고 다른 송신자가 있으면 합계라서, 안 적으면 "보냈는데 값이
      // 다르다"로 보인다.
      return { bad: false, text: '채널 ' + (n.cfg.ch || 'A') + ' 로 ' + fmt(v, 2) +
        ' 송신 — 지금 읽히는 합계 ' + fmt(busRead(n.cfg.ch), 2) + ' (한 틱 뒤 반영)' };
  }
  return null;
}

var SPARK_W = 170, SPARK_H = 20;

// 지난 8초를 한 줄로 그린다. **세로 눈금은 창 안의 최소~최대로 스스로 맞춘다** —
// 0~100 으로 고정하면 전력 만족도(95~100)는 평평한 선이 되어 아무것도 안 보이고,
// 그 미세한 흔들림이 바로 부하 차단에서 봐야 할 것이다. 대신 눈금이 바뀌면 같은
// 높이가 다른 값을 뜻하므로, 오른쪽 위에 지금 창의 최대값을 적어 둔다.
function drawSpark(cvs, series) {
  var ctx = cvs.getContext('2d');
  var W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1c2024'; ctx.fillRect(0, 0, W, H);
  if (!series || series.length < 2) {
    ctx.fillStyle = '#5a636b'; ctx.font = '16px monospace';
    ctx.fillText('…', 6, H - 8);
    return;
  }
  var lo = series[0], hi = series[0];
  for (var i = 1; i < series.length; i++) {
    if (series[i] < lo) lo = series[i];
    if (series[i] > hi) hi = series[i];
  }
  // 평평한 신호도 선이 보여야 한다 — 폭이 0 이면 가운데에 긋는다.
  var span = hi - lo, flat = (span < 1e-9);
  var pad = 6;
  function yOf(v) { return flat ? H / 2 : (H - pad) - ((v - lo) / span) * (H - pad * 2); }
  // 0 선 — 참/거짓 신호에서 바닥이 어디인지 알려 준다
  if (!flat && lo <= 0 && hi >= 0) {
    ctx.strokeStyle = '#3a424a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke();
  }
  // **표본이 화면 폭보다 많다.** 480 표본을 170px 에 그리면 한 칸에 여러 개가 겹치는데,
  // 그때 마지막 것만 찍으면 1틱 펄스가 사라진다 — 담아 놓고 그리다 잃는 것이다.
  // 칸마다 최소·최대를 세로선으로 이어 **뾰족한 것이 남게** 한다.
  ctx.strokeStyle = '#e2b21c'; ctx.lineWidth = 2;
  ctx.beginPath();
  var cols = W / 2;                       // 그림 픽셀 2개당 한 칸
  for (var c = 0; c < cols; c++) {
    var a = Math.floor(c * series.length / cols);
    var b = Math.floor((c + 1) * series.length / cols);
    if (b <= a) b = a + 1;
    if (a >= series.length) break;
    var mn = series[a], mx = series[a];
    for (var k = a + 1; k < b && k < series.length; k++) {
      if (series[k] < mn) mn = series[k];
      if (series[k] > mx) mx = series[k];
    }
    var x = c * 2 + 1, yTop = yOf(mx), yBot = yOf(mn);
    // **길이 0 인 선분은 캔버스가 안 그린다.** 값이 안 변하는 칸은 위아래가 같은
    // 자리라 세로선이 점 하나도 안 남기고 사라졌다 — 상수 신호의 파형 칸이 통째로
    // 비어서, 화면에서 '평평하다' 와 '담긴 게 없다' 가 구분되지 않았다(게이트가 잡았다).
    // 그런 칸은 가로로 눕혀 긋는다 — 평평한 것도 선으로 보여야 한다.
    if (Math.abs(yBot - yTop) < 1) { ctx.moveTo(x - 1, yTop); ctx.lineTo(x + 1, yTop); }
    else { ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); }
  }
  ctx.stroke();
  // **눈금이 자동이라 높이만으로는 값을 못 읽는다.** 창의 위·아래 값을 적어 둔다.
  // 바닥이 0 이면 0선이 이미 말해 주므로 위쪽만 적는다 — 20px 안에 글자 둘은 빽빽하다.
  // 처음엔 그냥 얹었더니 파형 위에 겹쳐 안 읽혔다(스크린샷에서 드러났다). 글자마다
  // 어두운 판을 깔아 띄운다.
  // **작은 칸에는 눈금을 안 적는다.** 같은 함수가 노드 상자(340px)와 계기 칩(76px)
  // 둘 다를 그리는데, 글자 크기를 고정해 두면 칩에서는 숫자가 파형을 덮는다.
  // 칩에는 바로 옆에 현재값이 큰 글씨로 적혀 있으니, 거기서는 모양만 보이면 된다.
  if (W >= 120) {
    var fs = Math.max(9, Math.round(H * 0.36));
    ctx.font = fs + 'px monospace'; ctx.textAlign = 'right';
    var pad = Math.round(fs * 0.4);
    function tag(txt, y) {
      var w = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(28,32,36,.82)';
      ctx.fillRect(W - w - pad * 2, y - fs + 1, w + pad * 2, fs + 2);
      ctx.fillStyle = '#b7bec4';
      ctx.fillText(txt, W - pad, y);
    }
    function num(v) { return String(Math.round(v * 10) / 10); }
    tag(num(hi), fs);
    if (!flat && Math.abs(lo) > 1e-9) tag(num(lo), H - 3);
    ctx.textAlign = 'left';
  }
}

// **출구 이름이 설정을 따라간다.** [유체 잔량] 의 석유 출구는 무엇을 고르느냐에 따라
// '중유%' 도 되고 '가스%' 도 된다. 늘 '석유%' 라고만 적혀 있으면 배선을 보고도
// 무엇을 읽는 선인지 알 수 없어, 설정을 하나하나 열어 봐야 한다.
// 지금 그리지 않는 자리에 물려 있는 배선을 걷어낸다. 몇 개를 걷었는지 돌려준다.
function pruneHiddenLinks(g, node) {
  var d = NODE_DEFS[node.kind], gone = 0;
  for (var i = g.links.length - 1; i >= 0; i--) {
    var lk = g.links[i];
    if (lk.tn === node.nid && !fsmPortActive(node, 'in', lk.tp)) { g.links.splice(i, 1); gone++; continue; }
    if (lk.fn === node.nid && !fsmPortActive(node, 'out', lk.fp)) { g.links.splice(i, 1); gone++; }
  }
  if (gone) g.dirty = true;
  void d;
  return gone;
}

function inPortName(n, d, pi) {
  // 4단계 상태기계의 3번 입력은 '4→1' 이지만, 8단계로 바꾸면 같은 자리가 '4→5' 가 된다.
  // 자리는 그대로 두고 뜻만 바뀌므로(예전 배선을 지키려고 그렇게 했다) 이름이 따라가야 한다.
  if (n.kind === 'fsm' && pi === 3) return (n.cfg.stages === '8단계') ? '4→5' : '4→1';
  return d.ins[pi];
}

function outPortName(n, d, po) {
  if (n.kind === 'fluid' && (po === 4 || po === 5)) {
    var k = n.cfg.oil || '중유';
    return (po === 4) ? (k + '%') : k;
  }
  return d.outs[po];
}

// 손가락이 빗나갔을 때 붙여 줄 거리. 포트 줄 간격(18px)의 절반보다 커야 의미가 있고,
// 간격보다 크면 옆 포트까지 끌어와 **틀린 데 붙는다** — 그건 안 붙는 것보다 나쁘다.
// 그래서 간격보다 작게 잡는다.
var WIRE_SNAP_PX = 16;

// 화면 좌표에서 가장 가까운 입력 포트. 없으면 null.
function nearestInPort(x, y, maxDist) {
  var ins = document.querySelectorAll('#graphInner .port.in[data-in]');
  var best = null, bestD = maxDist;
  for (var i = 0; i < ins.length; i++) {
    var q = ins[i].getBoundingClientRect();
    // 사각형까지의 거리 — 중심까지 재면 긴 줄에서 한쪽 끝이 불리해진다.
    var dx = Math.max(q.left - x, 0, x - q.right);
    var dy = Math.max(q.top - y, 0, y - q.bottom);
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; best = ins[i]; }
  }
  return best;
}

function buildNodeDom(inner, g, n) {
  var d = NODE_DEFS[n.kind];
  var el = document.createElement('div');
  el.className = 'node ' + d.cat;
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
  el.setAttribute('data-nid', String(n.nid));

  var head = document.createElement('div');
  head.className = 'nhead';
  head.innerHTML = '<span>' + d.label + '</span><span class="x" title="삭제">✕</span>';
  el.appendChild(head);

  var bodyEl = document.createElement('div');
  bodyEl.className = 'nbody';

  // 설정 필드
  for (var c = 0; c < d.cfg.length; c++) {
    var cf = d.cfg[c];
    var row = document.createElement('div');
    row.className = 'nrow';
    var lab = document.createElement('label');
    lab.textContent = cf.label;
    row.appendChild(lab);
    if (cf.t === 'num') {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.value = n.cfg[cf.k];
      inp.style.width = '58px';
      inp.oninput = (function (node, key, el2) { return function () { node.cfg[key] = parseFloat(el2.value) || 0; }; })(n, cf.k, inp);
      row.appendChild(inp);
    } else if (cf.t === 'opsel') {
      var sel = document.createElement('select');
      for (var o = 0; o < cf.opts.length; o++) {
        var op = document.createElement('option');
        op.value = cf.opts[o];
        // 채널은 이름이 붙어 있으면 이름으로 보여 준다 — 'A' 만 보이면 무엇을
        // 고르는지 알 수 없고, 그 순간 버스는 다시 익명 배선이 된다.
        op.textContent = (cf.k === 'ch' && typeof busLabel === 'function')
          ? busLabel(cf.opts[o]) : cf.opts[o];
        if (n.cfg[cf.k] === cf.opts[o]) op.selected = true;
        sel.appendChild(op);
      }
      sel.onchange = (function (node, key, el2) {
        return function () {
          node.cfg[key] = el2.value;
          // **단계를 줄이면 없어지는 자리가 생긴다.** 거기 물려 있던 배선을 그냥 두면
          // 화면에 보이지도 않는 선이 회로를 움직인다 — 지우고, 몇 개를 지웠는지 말한다.
          var gone = pruneHiddenLinks(curCtrl.graph, node);
          if (gone > 0) toast('없어진 자리의 배선 ' + gone + '개를 지웠다', 'warn');
          if (node.kind === 'fsm') renderGraph();      // 자리 수가 바뀌면 다시 그린다
        };
      })(n, cf.k, sel);
      row.appendChild(sel);
    } else if (cf.t === 'item') {
      var isel = document.createElement('select');
      var none = document.createElement('option'); none.value = ''; none.textContent = '— 전체 —';
      isel.appendChild(none);
      for (var ii = 0; ii < ITEM_IDS.length; ii++) {
        var io = document.createElement('option');
        io.value = ITEM_IDS[ii]; io.textContent = ITEMS[ITEM_IDS[ii]].name;
        if (n.cfg[cf.k] === ITEM_IDS[ii]) io.selected = true;
        isel.appendChild(io);
      }
      isel.onchange = (function (node, key, el2) { return function () { node.cfg[key] = el2.value || null; }; })(n, cf.k, isel);
      row.appendChild(isel);
    } else if (cf.t === 'text') {
      var tin = document.createElement('input');
      tin.type = 'text'; tin.value = n.cfg[cf.k] || '';
      tin.oninput = (function (node, key, el2) { return function () { node.cfg[key] = el2.value; }; })(n, cf.k, tin);
      row.appendChild(tin);
    } else if (cf.t === 'ent') {
      var btn = document.createElement('button');
      btn.className = 'entbtn';
      var te = entities[n.cfg[cf.k]];
      btn.textContent = te ? (BUILDINGS[te.type].name + ' #' + te.id) : '지정 안 됨 ▸';
      if (!te) btn.style.color = 'var(--stop)';
      btn.onclick = (function (node, key, filter) {
        return function () { startPick(curCtrl.id, node.nid, key, filter); };
      })(n, cf.k, cf.filter);
      row.appendChild(btn);
    }
    bodyEl.appendChild(row);
  }

  // 포트
  var ports = document.createElement('div');
  ports.className = 'ports';
  var cin = document.createElement('div'); cin.className = 'pcol i';
  for (var pi = 0; pi < d.ins.length; pi++) {
    if (!fsmPortActive(n, 'in', pi)) continue;    // 안 쓰는 자리는 그리지 않는다
    var pr = document.createElement('div'); pr.className = 'port in';
    var dot = document.createElement('div'); dot.className = 'dot';
    dot.setAttribute('data-in', String(pi));
    var nm = document.createElement('span'); nm.textContent = inPortName(n, d, pi);
    nm.setAttribute('data-pn-in', n.nid + ':' + pi);
    pr.appendChild(dot); pr.appendChild(nm);
    cin.appendChild(pr);
  }
  var cout = document.createElement('div'); cout.className = 'pcol o';
  for (var po = 0; po < d.outs.length; po++) {
    if (!fsmPortActive(n, 'out', po)) continue;
    var pr2 = document.createElement('div'); pr2.className = 'port out';
    var dot2 = document.createElement('div'); dot2.className = 'dot';
    dot2.setAttribute('data-out', String(po));
    var nm2 = document.createElement('span'); nm2.textContent = outPortName(n, d, po);
    nm2.setAttribute('data-pn', n.nid + ':' + po);   // 설정이 바뀌면 updateLive 가 고쳐 쓴다
    var pv = document.createElement('span'); pv.className = 'pv'; pv.setAttribute('data-pv', n.nid + ':' + po);
    pv.textContent = '0';
    pr2.appendChild(dot2); pr2.appendChild(nm2); pr2.appendChild(pv);
    cout.appendChild(pr2);
  }
  ports.appendChild(cin); ports.appendChild(cout);
  bodyEl.appendChild(ports);
  // **파형.** 숫자 한 칸은 '지금' 만 말한다 — 부하 차단이 발진하는지, 래치가 언제
  // 풀렸는지는 지난 8초를 봐야 안다. 출력마다 한 줄씩 깐다(대부분 출력은 하나다).
  for (var sp = 0; sp < d.outs.length; sp++) {
    if (!fsmPortActive(n, 'out', sp)) continue;
    var cvs = document.createElement('canvas');
    cvs.className = 'spark';
    cvs.setAttribute('data-spark', n.nid + ':' + sp);
    // CSS 크기와 그림 크기를 따로 준다 — 같게 두면 고해상도 화면에서 뭉갠다.
    cvs.width = SPARK_W * 2; cvs.height = SPARK_H * 2;
    cvs.style.width = SPARK_W + 'px'; cvs.style.height = SPARK_H + 'px';
    cvs.title = outPortName(n, d, sp) + ' — 지난 8초';
    bodyEl.appendChild(cvs);
  }
  // 출력 노드는 자기가 지금 하는 일을 한 줄로 말한다 (updateLive 가 매 140ms 갱신)
  if (d.cat === 'out') {
    var mrow = document.createElement('div');
    mrow.className = 'nmean';
    mrow.setAttribute('data-mean', String(n.nid));
    bodyEl.appendChild(mrow);
  }
  el.appendChild(bodyEl);
  inner.appendChild(el);

  // --- 상호작용 ---
  head.querySelector('.x').onclick = function (ev) {
    ev.stopPropagation();
    markGraphHandEdited();
    graphRemoveNode(g, n.nid);
    renderGraph();
  };
  head.onmousedown = function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    var sx = ev.clientX, sy = ev.clientY, ox = n.x, oy = n.y;
    function mv(e2) {
      n.x = Math.max(0, ox + (e2.clientX - sx) / gpan.z);
      n.y = Math.max(0, oy + (e2.clientY - sy) / gpan.z);
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      // **좌표가 곧 평가 순서다.** dirty 를 안 세우면 옮겨도 순서가 그대로라,
      // 도움말이 약속한 "보이는 배치가 규칙"이 거짓이 된다 — 되먹임 점선도
      // 옛 순서 그대로 남는다. 이 파일에서 dirty 를 쓰는 곳은 여기뿐이었다(읽기만).
      g.dirty = true;
      updateLinks();
    }
    function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  // 터치로도 노드를 끌 수 있어야 한다. 마우스 경로와 **같은 계산**을 쓰되 좌표만
  // 손가락에서 가져온다 — 따로 계산하면 배율(gpan.z)이 걸린 상태에서 어긋난다.
  head.addEventListener('touchstart', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    var t0 = ev.touches[0]; if (!t0) return;
    var sx = t0.clientX, sy = t0.clientY, ox = n.x, oy = n.y;
    function tmv(e2) {
      var t = e2.touches[0]; if (!t) return;
      e2.preventDefault();
      n.x = Math.max(0, ox + (t.clientX - sx) / gpan.z);
      n.y = Math.max(0, oy + (t.clientY - sy) / gpan.z);
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      g.dirty = true;                 // 마우스 경로와 같은 이유 (좌표 = 평가 순서)
      updateLinks();
    }
    function tup() {
      window.removeEventListener('touchmove', tmv);
      window.removeEventListener('touchend', tup);
      window.removeEventListener('touchcancel', tup);
    }
    window.addEventListener('touchmove', tmv, { passive: false });
    window.addEventListener('touchend', tup);
    window.addEventListener('touchcancel', tup);
  }, { passive: false });
  // **행 전체를 배선 표적으로 만든다.** 예전에는 9x9px 도트에만 핸들러가 붙어
  // 있었는데 CSS 는 .port 행 전체에 crosshair 커서를 주고 hover 로 도트를
  // 강조했다 — 살아 있는 폭이 41% 뿐이라 이름표에 떨구면 조용히 실패했다.
  // 폰에서는 9 CSS px 를 손가락으로 맞춰야 했다.
  var outRows = el.querySelectorAll('.port.out');
  for (var orI = 0; orI < outRows.length; orI++) {
    var odt = outRows[orI].querySelector('[data-out]');
    if (odt) outRows[orI].setAttribute('data-out', odt.getAttribute('data-out'));
  }
  var inRows = el.querySelectorAll('.port.in');
  for (var irI = 0; irI < inRows.length; irI++) {
    var idt = inRows[irI].querySelector('[data-in]');
    if (idt) inRows[irI].setAttribute('data-in', idt.getAttribute('data-in'));
  }
  var outs = el.querySelectorAll('.port.out[data-out]');
  for (var k = 0; k < outs.length; k++) {
    outs[k].onmousedown = (function (nid, port) {
      return function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        linking = { nid: nid, port: port };
      };
    })(n.nid, parseInt(outs[k].getAttribute('data-out'), 10));
    // 터치: touchend 는 **손가락을 올린 요소가 아니라 시작한 요소**로 간다.
    // 그래서 입력 포트의 mouseup 을 기다리면 영원히 안 온다 — 뗀 좌표에서
    // elementFromPoint 로 직접 찾는다. 이 게임의 본체가 배선이라 여기가 막히면
    // 폰에서는 게임이 성립하지 않는다.
    outs[k].addEventListener('touchstart', (function (nid, port) {
      return function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        linking = { nid: nid, port: port };
        function tmv(e2) {
          var t = e2.touches[0]; if (!t || !linking) return;
          e2.preventDefault();
          var r = document.getElementById('graphWrap').getBoundingClientRect();
          updateLinks({ x: (t.clientX - r.left - gpan.x) / gpan.z,
                        y: (t.clientY - r.top - gpan.y) / gpan.z });
        }
        function tup(e2) {
          window.removeEventListener('touchmove', tmv);
          window.removeEventListener('touchend', tup);
          window.removeEventListener('touchcancel', tup);
          var t = (e2.changedTouches && e2.changedTouches[0]) || null;
          if (t && linking) {
            var el2 = document.elementFromPoint(t.clientX, t.clientY);
            var dot = el2 && el2.closest ? el2.closest('[data-in]') : null;
            // **빗나가도 붙는다.** 입력 포트 줄은 높이 15px 인데 손가락 끝은 그보다 훨씬
            // 굵다 — 정확히 그 줄 위에서 떼기를 요구하면 배선이 손기술 시험이 된다.
            // 이 게임의 본체가 배선이라, 여기서 자꾸 놓치면 게임이 안 붙는다.
            // 빗나갔으면 **가장 가까운 입력**을 찾아 준다. 다만 아무 데나 붙지는 않는다 —
            // 너무 멀면 그건 '그만두려던 것' 이지 '조준을 못한 것' 이 아니다.
            if (!dot) dot = nearestInPort(t.clientX, t.clientY, WIRE_SNAP_PX);
            var host = dot && dot.closest ? dot.closest('.node') : null;
            if (dot && host) {
              var toNid = parseInt(host.getAttribute('data-nid'), 10);
              var toPort = parseInt(dot.getAttribute('data-in'), 10);
              if (!graphLink(curCtrl.graph, linking.nid, linking.port, toNid, toPort)) {
                toast('자기 자신에는 연결할 수 없다', 'bad');
              }
            }
          }
          linking = null; renderGraph();
        }
        window.addEventListener('touchmove', tmv, { passive: false });
        window.addEventListener('touchend', tup);
        window.addEventListener('touchcancel', tup);
      };
    })(n.nid, parseInt(outs[k].getAttribute('data-out'), 10)), { passive: false });
  }
  var ins = el.querySelectorAll('.port.in[data-in]');
  for (var m = 0; m < ins.length; m++) {
    ins[m].onmouseup = (function (nid, port) {
      return function (ev) {
        ev.stopPropagation();
        if (linking) {
          markGraphHandEdited();
          if (!graphLink(curCtrl.graph, linking.nid, linking.port, nid, port)) toast('자기 자신에는 연결할 수 없다', 'bad');
          linking = null; renderGraph();
        }
      };
    })(n.nid, parseInt(ins[m].getAttribute('data-in'), 10));
    ins[m].onclick = (function (nid, port) {
      return function (ev) {
        ev.stopPropagation();
        if (linking) return;
        markGraphHandEdited();
        graphUnlink(curCtrl.graph, nid, port);
        renderGraph();
      };
    })(n.nid, parseInt(ins[m].getAttribute('data-in'), 10));
  }
}

// --- 배선(SVG) ---------------------------------------------------------------
function portPos(nid, port, isOut) {
  var inner = document.getElementById('graphInner');
  var el = inner.querySelector('.node[data-nid="' + nid + '"]');
  if (!el) return null;
  var dot = el.querySelector(isOut ? '[data-out="' + port + '"]' : '[data-in="' + port + '"]');
  if (!dot) return null;
  return { x: el.offsetLeft + dot.offsetLeft + dot.offsetWidth / 2,
           y: el.offsetTop + dot.offsetTop + dot.offsetHeight / 2 };
}
function updateLinks(tempTo) {
  // **그리기 전에 컴파일한다.** back 플래그는 graphCompile 이 세우므로, 더러운
  // 그래프를 그대로 그리면 '되먹임 점선' 이 한 편집 전 상태로 나온다 —
  // 방금 만든 되먹임 배선이 표시가 안 났다.
  if (curCtrl && curCtrl.graph && curCtrl.graph.dirty) graphCompile(curCtrl.graph);
  var svg = document.getElementById('links');
  if (!svg || !curCtrl) return;
  var g = curCtrl.graph;
  var parts = [];
  for (var i = 0; i < g.links.length; i++) {
    var lk = g.links[i];
    var a = portPos(lk.fn, lk.fp, true), b = portPos(lk.tn, lk.tp, false);
    if (!a || !b) continue;
    var dx = Math.max(28, Math.abs(b.x - a.x) * 0.45);
    var col = lk.back ? '#b23a10' : '#2c5470';
    parts.push('<path d="M' + a.x + ' ' + a.y + ' C' + (a.x + dx) + ' ' + a.y + ',' +
      (b.x - dx) + ' ' + b.y + ',' + b.x + ' ' + b.y + '" fill="none" stroke="' + col +
      '" stroke-width="2"' + (lk.back ? ' stroke-dasharray="6 4"' : '') + '/>');
    parts.push('<circle cx="' + b.x + '" cy="' + b.y + '" r="3" fill="' + col + '"/>');
  }
  if (tempTo && linking) {
    var s = portPos(linking.nid, linking.port, true);
    if (s) {
      parts.push('<path d="M' + s.x + ' ' + s.y + ' L' + tempTo.x + ' ' + tempTo.y +
        '" fill="none" stroke="#b23a10" stroke-width="2" stroke-dasharray="5 4"/>');
    }
  }
  svg.innerHTML = parts.join('');
}

// --- 라이브 값 ---------------------------------------------------------------
function updateLive() {
  if (!logicOpen || !curCtrl) return;
  var g = curCtrl.graph;
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    for (var p = 0; p < n.out.length; p++) {
      var el = document.querySelector('[data-pv="' + n.nid + ':' + p + '"]');
      if (el) {
        // 값은 늘 현재값을 보여준다(거짓말하지 않는다). 펄스형 신호는 그것만으로는
        // 영원히 0 이므로 누적 발화 횟수를 옆에 붙인다.
        var txt = fmt(n.out[p], 1);
        if (n.fires && n.fires[p] > 0) txt += ' ↑' + n.fires[p];
        el.textContent = txt;
      }
    }
  }
  // 출구 이름 — 설정을 바꾸면 따라 바뀌어야 한다(그래프를 다시 그리지 않고도).
  var pnIn = document.querySelectorAll('[data-pn-in]');
  for (var pq = 0; pq < pnIn.length; pq++) {
    var pk2 = pnIn[pq].getAttribute('data-pn-in').split(':');
    var pnode2 = graphNode(g, parseInt(pk2[0], 10));
    if (!pnode2) continue;
    var want2 = inPortName(pnode2, NODE_DEFS[pnode2.kind], parseInt(pk2[1], 10));
    if (pnIn[pq].textContent !== want2) pnIn[pq].textContent = want2;
  }
  var pns = document.querySelectorAll('[data-pn]');
  for (var pn = 0; pn < pns.length; pn++) {
    var pk = pns[pn].getAttribute('data-pn').split(':');
    var pnode = graphNode(g, parseInt(pk[0], 10));
    if (!pnode) continue;
    var want = outPortName(pnode, NODE_DEFS[pnode.kind], parseInt(pk[1], 10));
    if (pns[pn].textContent !== want) pns[pn].textContent = want;
  }
  // 파형 — 담긴 표본을 그대로 그린다. 편집기가 연 제어기만 담기므로 다른
  // 제어기의 노드는 빈 칸(…)으로 남는다.
  var sparks = document.querySelectorAll('canvas[data-spark]');
  for (var sk = 0; sk < sparks.length; sk++) {
    var key = sparks[sk].getAttribute('data-spark').split(':');
    drawSpark(sparks[sk], scopeSeries(parseInt(key[0], 10), parseInt(key[1], 10)));
  }
  // 활성 배선 강조
  var dots = document.querySelectorAll('.dot[data-out]');
  for (var k = 0; k < dots.length; k++) {
    var host = dots[k].closest ? dots[k].closest('.node') : null;
    if (!host) continue;
    var nid = parseInt(host.getAttribute('data-nid'), 10);
    var nn = graphNode(g, nid);
    var port = parseInt(dots[k].getAttribute('data-out'), 10);
    // **1틱 펄스는 값 표본으로 못 잡는다** — 폭 16.7ms 에 표본 주기 140ms 다.
    // 그래서 값이 아니라 '지난 갱신 이후 몇 번 올라갔는가' 로도 켠다.
    var lit = false;
    if (nn) {
      lit = truthy(nn.out[port]);
      if (!lit && nn.fires) {
        if (!nn._uiFires) nn._uiFires = [];
        var seenN = nn._uiFires[port] || 0;
        if (nn.fires[port] > seenN) lit = true;
        nn._uiFires[port] = nn.fires[port];
      }
    }
    if (lit) dots[k].classList.add('on'); else dots[k].classList.remove('on');
  }
  // 출력 노드의 해석 줄 — 값이 바뀌면 문장도 바뀐다
  var means = document.querySelectorAll('[data-mean]');
  for (var m = 0; m < means.length; m++) {
    var mn = graphNode(g, parseInt(means[m].getAttribute('data-mean'), 10));
    if (!mn) continue;
    var info = outputMeaning(g, mn);
    if (!info) { means[m].textContent = ''; continue; }
    means[m].textContent = info.text;
    means[m].classList.toggle('bad', !!info.bad);
  }
  updateCycleInfo(g);
}

// --- 화면 이동/확대 ----------------------------------------------------------
function bindLogicPane() {
  var wrap = document.getElementById('graphWrap');
  wrap.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;
    if (ev.target !== wrap && ev.target.id !== 'links' && ev.target.id !== 'graphInner') return;
    wrap.classList.add('panning');
    var sx = ev.clientX, sy = ev.clientY, ox = gpan.x, oy = gpan.y;
    function mv(e2) { gpan.x = ox + (e2.clientX - sx); gpan.y = oy + (e2.clientY - sy); applyPan(); }
    function up() {
      wrap.classList.remove('panning');
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  wrap.addEventListener('mousemove', function (ev) {
    if (!linking) return;
    var r = wrap.getBoundingClientRect();
    updateLinks({ x: (ev.clientX - r.left - gpan.x) / gpan.z, y: (ev.clientY - r.top - gpan.y) / gpan.z });
  });
  window.addEventListener('mouseup', function () {
    if (linking) { linking = null; updateLinks(); }
  });
  // 편집기 화면도 손가락으로 움직이고 확대해야 한다 (휠은 폰에 없다)
  var gt = { mode: null, lx: 0, ly: 0, d: 0, cx: 0, cy: 0 };
  wrap.addEventListener('touchstart', function (ev) {
    if (ev.target !== wrap && ev.target.id !== 'links' && ev.target.id !== 'graphInner') return;
    if (ev.touches.length >= 2) {
      var r0 = wrap.getBoundingClientRect();
      gt.mode = 'pinch';
      gt.d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                        ev.touches[0].clientY - ev.touches[1].clientY);
      gt.cx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r0.left;
      gt.cy = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r0.top;
    } else {
      gt.mode = 'pan'; gt.lx = ev.touches[0].clientX; gt.ly = ev.touches[0].clientY;
      wrap.classList.add('panning');
    }
    ev.preventDefault();
  }, { passive: false });
  wrap.addEventListener('touchmove', function (ev) {
    if (!gt.mode) return;
    ev.preventDefault();
    if (gt.mode === 'pinch' && ev.touches.length >= 2) {
      var d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                         ev.touches[0].clientY - ev.touches[1].clientY);
      if (gt.d > 0 && d > 0) {
        var before = { x: (gt.cx - gpan.x) / gpan.z, y: (gt.cy - gpan.y) / gpan.z };
        gpan.z = clamp(gpan.z * (d / gt.d), 0.4, 2.2);
        gpan.x = gt.cx - before.x * gpan.z; gpan.y = gt.cy - before.y * gpan.z;
        applyPan(); updateLinks();
      }
      gt.d = d;
      return;
    }
    var t = ev.touches[0]; if (!t) return;
    gpan.x += t.clientX - gt.lx; gpan.y += t.clientY - gt.ly;
    gt.lx = t.clientX; gt.ly = t.clientY;
    applyPan();
  }, { passive: false });
  wrap.addEventListener('touchend', function () { gt.mode = null; wrap.classList.remove('panning'); });
  wrap.addEventListener('touchcancel', function () { gt.mode = null; wrap.classList.remove('panning'); });

  wrap.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = wrap.getBoundingClientRect();
    var mx = ev.clientX - r.left, my = ev.clientY - r.top;
    var before = { x: (mx - gpan.x) / gpan.z, y: (my - gpan.y) / gpan.z };
    gpan.z = clamp(gpan.z * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), 0.4, 2.2);
    gpan.x = mx - before.x * gpan.z; gpan.y = my - before.y * gpan.z;
    applyPan(); updateLinks();
  }, { passive: false });
}

// --- 예제 회로 ---------------------------------------------------------------
// 재고 히스테리시스: 상자 재고 < 하한이면 라인을 켜고, > 상한이면 끈다.
// 비교 하나로 하면 경계에서 덜덜 떨린다(채터링). SR 래치가 그것을 막는다 —
// 제어를 아는 사람이 처음 배선하는 회로이고, 이 게임에서 가장 자주 쓰인다.
function loadExample() {
  if (!curCtrl) return;
  // 기존 그래프를 비우고 새로 깐다. 예전엔 덧붙여서 두 번 누르면 같은 좌표에
  // 노드가 겹쳐 쌓이고 어느 쪽이 배선된 것인지 알 수 없었다.
  // confirm() 같은 블로킹 모달은 쓰지 않는다 — 게임 루프를 세우고, 헤드리스에서는
  // 페이지 자체가 멈춰 검증이 통째로 죽는다(실제로 그렇게 걸렸다). 사후 고지로 대신한다.
  var had = curCtrl.graph.nodes.length;
  curCtrl.graph = newGraph();
  var g = curCtrl.graph;
  var chest = null, asm = null;
  forEachEntity(function (e) {
    if (!chest && e.type === 'chest') chest = e;
    if (!asm && e.type === 'assembler') asm = e;
  });

  var nSense = graphAddNode(g, 'chest', 40, 60);
  nSense.cfg.ent = chest ? chest.id : null;
  var nLo = graphAddNode(g, 'const', 40, 250); nLo.cfg.value = 50;
  var nHi = graphAddNode(g, 'const', 40, 360); nHi.cfg.value = 200;
  var cLo = graphAddNode(g, 'cmp', 260, 90); cLo.cfg.op = '<';
  var cHi = graphAddNode(g, 'cmp', 260, 280); cHi.cfg.op = '>';

  var outNode;
  if (nodeAvailable('latch')) {
    var lat = graphAddNode(g, 'latch', 480, 170);
    graphLink(g, cLo.nid, 0, lat.nid, 0);      // 재고 부족 → SET
    graphLink(g, cHi.nid, 0, lat.nid, 1);      // 재고 충분 → RESET
    outNode = lat;
  } else {
    // 논리 II 이전에는 래치가 없다 — 비교 하나로 임시 배선하고 한계를 알려준다
    outNode = cLo;
    toast('논리 II(기억소자)를 연구하면 SR 래치로 채터링을 없앨 수 있다', 'bad');
  }
  var en = graphAddNode(g, 'enable', 700, 170);
  en.cfg.ent = asm ? asm.id : null;
  graphLink(g, outNode.nid, 0, en.nid, 0);

  var lamp = graphAddNode(g, 'lamp', 700, 300);
  lamp.cfg.label = '재고 부족';
  graphLink(g, cLo.nid, 0, lamp.nid, 0);

  graphLink(g, nSense.nid, 0, cLo.nid, 0);
  graphLink(g, nLo.nid, 0, cLo.nid, 1);
  graphLink(g, nSense.nid, 0, cHi.nid, 0);
  graphLink(g, nHi.nid, 0, cHi.nid, 1);

  renderGraph();
  if (had) toast('기존 배선 ' + had + '개 노드를 예제로 교체했다', 'bad');
  if (!chest || !asm) toast('상자와 조립기를 지어 두면 예제가 대상까지 자동으로 물린다', 'bad');
  else toast('예제 배선 완료 — 상자 #' + chest.id + ' 재고로 조립기 #' + asm.id + ' 를 켜고 끈다', 'good');
}
