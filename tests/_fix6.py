# -*- coding: utf-8 -*-
"""감사가 재현한 나머지 6건을 고친다."""
import io, sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# ============ 1) 1틱 펄스가 편집기에서 영구히 0 ============================
# 타이머·엣지는 발화한 틱에만 1이고 다음 틱(16.7ms)에 0이 된다. 편집기는 140ms
# 마다 표본을 뜨므로 주기 5초에서 잡을 확률이 0.33% 다. 값이 틀린 게 아니라
# **표본 주기가 신호 폭보다 8배 길다.** 그래서 값 대신 '발화 횟수'를 세어 둔다 —
# 횟수는 표본을 놓쳐도 사라지지 않는다.
p = 'src/35_logic.js'
s = io.open(p, encoding='utf-8').read()
old = """  for (var k = 0; k < g.order.length; k++) {
    var node = g.byId[g.order[k]];
    if (node) evalNode(g, node, dt, e);
  }"""
new = """  for (var k = 0; k < g.order.length; k++) {
    var node = g.byId[g.order[k]];
    if (node) evalNode(g, node, dt, e);
  }
  // 1틱 펄스는 표본으로 못 잡는다(폭 16.7ms vs 편집기 표본 140ms). 값 대신
  // **상승 횟수**를 세어 두면 표본을 놓쳐도 증거가 남는다. 편집기는 이 숫자가
  // 늘었는지로 LED 를 켠다 — 그래야 타이머가 도는 것이 화면에 보인다.
  for (var f = 0; f < g.nodes.length; f++) {
    var fn = g.nodes[f];
    if (!fn.fires) { fn.fires = []; for (var z = 0; z < fn.out.length; z++) fn.fires.push(0); }
    for (var fp = 0; fp < fn.out.length; fp++) {
      if (fn.out[fp] >= TRUE_EPS && fn.prev[fp] < TRUE_EPS) fn.fires[fp]++;
    }
  }"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('1) 펄스 상승 횟수 계수')

# ============ 6) 정지시킨 채광기가 출력을 계속 벨트로 밀어낸다 ==============
p = 'src/25_entity.js'
s = io.open(p, encoding='utf-8').read()
old = "  if (!e.enabled || e.powerSat <= 0) { e.working = false; e.stallT += dt; pushToFront(e); return; }"
new = ("  // **정지는 정지다.** 예전에는 꺼진 채광기도 pushToFront 로 버퍼를 계속 벨트에\n"
       "  // 밀어냈다 — 제어기로 '정지' 시켜 놓고도 물건이 계속 나가면 정지가 아니다.\n"
       "  // (전기가 없어 멈춘 경우도 같다.)\n"
       "  if (!e.enabled || e.powerSat <= 0) { e.working = false; e.stallT += dt; return; }")
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('6) 정지한 채광기는 벨트로 안 밀어낸다')

# ============ 3) 되먹임 점선이 한 편집 뒤처짐 + 4) gpan 초기화 =============
p = 'src/55_logicui.js'
s = io.open(p, encoding='utf-8').read()

old = """function openLogic(e) {
  curCtrl = e;
  logicOpen = true;
  if (!e.graph) e.graph = newGraph();"""
new = """function openLogic(e) {
  var switching = (curCtrl !== e);
  curCtrl = e;
  logicOpen = true;
  if (!e.graph) e.graph = newGraph();
  // **다른 제어기를 열면 화면을 처음으로 되돌린다.** 예전에는 이전 제어기에서
  // 끌어다 놓은 위치가 그대로 남아, 노드가 있는데도 빈 화면만 보였다.
  if (switching) { gpan.x = 20; gpan.y = 20; gpan.z = 1; }"""
assert s.count(old) == 1
s = s.replace(old, new, 1)

# 되먹임 표시는 컴파일된 back 플래그를 쓴다. 더러운 그래프면 한 편집 전 상태다.
old2 = """function renderGraph() {"""
new2 = """function renderGraph() {
  // **그리기 전에 컴파일한다.** back 플래그는 graphCompile 이 세우므로, 더러운
  // 그래프를 그대로 그리면 '되먹임 점선' 이 한 편집 전 상태로 나온다 —
  // 방금 만든 되먹임 배선이 표시가 안 났다.
  if (curCtrl && curCtrl.graph && curCtrl.graph.dirty) graphCompile(curCtrl.graph);"""
assert s.count(old2) == 1
s = s.replace(old2, new2, 1)

old3 = """function updateLinks(dragTo) {"""
new3 = """function updateLinks(dragTo) {
  if (curCtrl && curCtrl.graph && curCtrl.graph.dirty) graphCompile(curCtrl.graph);"""
assert s.count(old3) == 1
s = s.replace(old3, new3, 1)

# 2) 배선 히트영역 — 포트 행에 in/out 구분 클래스를 먼저 붙인다
s = s.replace("var pr = document.createElement('div'); pr.className = 'port';",
              "var pr = document.createElement('div'); pr.className = 'port in';", 1)
s = s.replace("var pr2 = document.createElement('div'); pr2.className = 'port';",
              "var pr2 = document.createElement('div'); pr2.className = 'port out';", 1)

# 2) 배선 히트영역 — 핸들러를 9px 도트가 아니라 포트 행 전체에 건다
old4 = """  var outs = el.querySelectorAll('[data-out]');
  for (var k = 0; k < outs.length; k++) {"""
new4 = """  // **행 전체를 배선 표적으로 만든다.** 예전에는 9x9px 도트에만 핸들러가 붙어
  // 있었는데 CSS 는 .port 행 전체에 crosshair 커서를 주고 hover 로 도트를
  // 강조했다 — 살아 있는 폭이 41% 뿐이라 이름표에 떨구면 조용히 실패했다.
  // 폰에서는 9 CSS px 를 손가락으로 맞춰야 했다.
  var outRows = el.querySelectorAll('.port.out');
  for (var orI = 0; orI < outRows.length; orI++) {
    (function (row) {
      var dt = row.querySelector('[data-out]');
      if (dt) row.setAttribute('data-out', dt.getAttribute('data-out'));
    })(outRows[orI]);
  }
  var inRows = el.querySelectorAll('.port.in');
  for (var irI = 0; irI < inRows.length; irI++) {
    (function (row) {
      var dt = row.querySelector('[data-in]');
      if (dt) row.setAttribute('data-in', dt.getAttribute('data-in'));
    })(inRows[irI]);
  }
  var outs = el.querySelectorAll('.port.out[data-out]');
  for (var k = 0; k < outs.length; k++) {"""
assert s.count(old4) == 1
s = s.replace(old4, new4, 1)
s = s.replace("  var ins = el.querySelectorAll('[data-in]');",
              "  var ins = el.querySelectorAll('.port.in[data-in]');", 1)

# 1) 편집기 LED 를 '발화 횟수가 늘었는가' 로 켠다
old5 = """  // 활성 배선 강조
  var dots = document.querySelectorAll('.dot[data-out]');"""
new5 = """  // 활성 배선 강조.
  // **1틱 펄스는 값 표본으로 못 잡는다** — 폭 16.7ms 에 표본 주기 140ms 다.
  // 그래서 값이 아니라 '지난 갱신 이후 몇 번 올라갔는가' 로 켠다. 타이머·엣지가
  // 도는 것이 그제야 화면에 보인다.
  var dots = document.querySelectorAll('.dot[data-out]');"""
assert s.count(old5) == 1
s = s.replace(old5, new5, 1)

old6 = """    if (nn && truthy(nn.out[port])) dots[k].classList.add('on'); else dots[k].classList.remove('on');"""
new6 = """    var lit = false;
    if (nn) {
      lit = truthy(nn.out[port]);
      if (!lit && nn.fires) {
        if (!nn._uiFires) nn._uiFires = [];
        var seenN = nn._uiFires[port] || 0;
        if (nn.fires[port] > seenN) lit = true;          // 표본 사이에 펄스가 있었다
        nn._uiFires[port] = nn.fires[port];
      }
    }
    if (lit) dots[k].classList.add('on'); else dots[k].classList.remove('on');"""
assert s.count(old6) == 1
s = s.replace(old6, new6, 1)

# 포트 값창에도 발화 누계를 덧붙인다 — 값이 0 이어도 '돌고 있다' 를 알 수 있게
old7 = """      var el = document.querySelector('[data-pv="' + n.nid + ':' + p + '"]');
      if (el) el.textContent = fmt(n.out[p], 1);"""
new7 = """      var el = document.querySelector('[data-pv="' + n.nid + ':' + p + '"]');
      if (el) {
        // 값은 늘 현재값을 보여준다(거짓말하지 않는다). 펄스형 신호는 그것만으로는
        // 영원히 0 이므로 누적 발화 횟수를 옆에 붙인다.
        var txt = fmt(n.out[p], 1);
        if (n.fires && n.fires[p] > 0) txt += ' ↑' + n.fires[p];
        el.textContent = txt;
      }"""
assert s.count(old7) == 1
s = s.replace(old7, new7, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('2) 포트 행 전체 배선 · 3) 되먹임 표시 즉시 · 4) gpan 초기화 · 1) LED/값창 펄스')

# ============ 5) 참/거짓 문턱을 문서와 화면에 드러낸다 ======================
p = 'src/35_logic.js'
s = io.open(p, encoding='utf-8').read()
old8 = "//  값은 전부 실수 하나. 참/거짓은 0 초과 = 참으로 본다."
new8 = ("//  값은 전부 실수 하나. **참/거짓은 0.5 이상 = 참**이다 (TRUE_EPS).\n"
        "//  0 초과가 아니다 — 0.4 는 거짓이다. 신호가 대부분 정수(0/1)라 잡음을\n"
        "//  참으로 읽지 않으려고 이렇게 뒀다. 사칙 1/4=0.25, PID 출력 0.3 처럼\n"
        "//  소수를 내는 노드를 참/거짓 자리에 물릴 때 걸리므로 화면에도 적어 둔다.")
assert s.count(old8) == 1
s = s.replace(old8, new8, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('5) 문턱 주석 정정')
