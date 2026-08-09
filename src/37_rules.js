// ===========================================================================
//  37_rules.js — 문장(규칙) → 노드 그래프 컴파일러
//
//  제어기 편집기는 사실상 프로그래밍 언어다: 빈 캔버스에 노드 29종을 놓고 선을
//  잇는다. 코딩을 안 해 본 사람은 **무엇을 만들지 이미 알아야** 시작할 수 있고,
//  거기서 멈춘다. 그래서 같은 것을 문장으로도 쓸 수 있게 한다:
//
//      만약 [상자 #7] 의 [철판] 이 [50개 미만] 이면
//      그래서 [조립기 #3] 을 [켠다]
//      다시  [200개 넘으면] 끈다
//
//  **문장은 두 번째 런타임이 아니다.** 여기서 하는 일은 노드와 배선을 대신 놓아
//  주는 것뿐이고, 평가는 여전히 35_logic.js 하나가 한다. 그래서 저장·튜토리얼
//  판정·전투 로직이 전부 그대로 통한다 — 문장으로 만든 회로도 "회로"다.
//
//  설계 규칙 (원장에서 옮겨온 것):
//   * **한 방향이다.** 문장 → 그래프만 있고 그래프 → 문장은 없다. 양쪽을 다
//     편집하게 두면 반드시 갈린다 (인서터 peek≠take 가 그 실패의 원형이다).
//     그래프를 손으로 고치면 그 제어기의 문장 화면은 잠근다.
//   * **좌표를 결정론적으로 준다.** 노드 좌표가 곧 평가 순서라서(graphCompile),
//     같은 문장이 늘 같은 좌표를 받아야 늘 같게 돈다.
//   * **연구 안 된 노드로 컴파일하지 않는다.** evalNode 는 잠긴 노드를 조용히 0
//     으로 만든다 — 문장은 맞는데 아무 일도 안 일어나는 상태가 된다.
// ===========================================================================

// --- 문장의 부품표 ---------------------------------------------------------
// 읽기: 무엇을 볼 것인가. node = 만들 노드, port = 그 노드의 몇 번째 출구.
var RULE_SOURCES = {
  'chest':     { label: '재고',     node: 'chest',    port: 0, needs: ['ent', 'item'],
                 entFilter: ['chest'], unit: '개' },
  'stock':     { label: '내 보유 자재',    node: 'invsense', port: 0, needs: ['item'], unit: '개' },
  'belt':      { label: '올라온 개수',    node: 'belt',     port: 0, needs: ['ent', 'item'],
                 entFilter: ['belt', 'splitter'], unit: '개' },
  'machineRun':{ label: '지금 도는가',   node: 'machine',  port: 0, needs: ['ent'],
                 entFilter: ['miner','furnace','assembler','lab','generator','turret','inserter'],
                 bool: true },
  'machineStall':{ label: '멈춰 있는가', node: 'machine', port: 1, needs: ['ent'],
                 entFilter: ['miner','furnace','assembler','lab','generator','turret','inserter'],
                 bool: true },
  'machineProg':{ label: '진행률',    node: 'machine',  port: 2, needs: ['ent'],
                 entFilter: ['miner','furnace','assembler','lab','generator','turret','inserter'],
                 unit: '%' },
  'powerSat':  { label: '전기 만족도',     node: 'power',    port: 0, needs: [], unit: '%' },
  'powerHead': { label: '전기 여유',       node: 'power',    port: 3, needs: [], unit: 'kW' },
  'powerSup':  { label: '전기 공급',       node: 'power',    port: 1, needs: [], unit: 'kW' },
  'powerDem':  { label: '전기 수요',       node: 'power',    port: 2, needs: [], unit: 'kW' },
  'researchP': { label: '연구 진행률',     node: 'research', port: 0, needs: [], unit: '%' },
  'enemyN':    { label: '가까이 온 적 수', node: 'enemy',    port: 0, needs: ['radius'],
                 unit: '마리', tech: 'defense-ai' },
  'enemyDist': { label: '가장 가까운 적까지', node: 'enemy',  port: 1, needs: ['radius'],
                 unit: '칸', tech: 'defense-ai' },
  // 다른 제어기가 보낸 값. 채널은 고르는 것이지 적는 것이 아니다 — 오타 하나로
  // 조용히 0 이 되는 것이 이 게임에서 제일 나쁜 실패라서.
  'busIn':     { label: '받은 신호', node: 'busrecv', port: 0, needs: ['ch'],
                 tech: 'logic-ctrl' }
};
var RULE_SOURCE_IDS = Object.keys(RULE_SOURCES);

// 행동: 무엇을 시킬 것인가.
var RULE_ACTIONS = {
  'run':    { label: '켠다 / 끈다', node: 'enable', verbOn: '켠다', verbOff: '끈다',
              entFilter: ['miner','furnace','assembler','lab','generator','turret','inserter'] },
  'gate':   { label: '벨트를 연다 / 막는다', node: 'gate', verbOn: '연다', verbOff: '막는다',
              entFilter: ['belt', 'splitter'], tech: 'logic-ctrl' },
  'fire':   { label: '터렛 사격을 허가 / 금지', node: 'fire', verbOn: '쏘게 한다', verbOff: '멈추게 한다',
              entFilter: ['turret'], tech: 'defense-ai' },
  'lamp':   { label: '경보를 켠다', node: 'lamp', verbOn: '켠다', verbOff: '끈다', text: 'label' },
  'display':{ label: '화면에 숫자를 띄운다', node: 'display', text: 'label', value: true },
  'filter': { label: '인서터가 집을 것을 바꾼다', node: 'filter', entFilter: ['inserter'],
              tech: 'logic-ctrl', twoItems: true },
  // 값을 그대로 다른 제어기에 넘긴다. 참/거짓이 아니라 **잰 값**을 보내므로
  // value 플래그가 붙는다 (display 와 같은 자리).
  'bus':    { label: '다른 제어기에 신호를 보낸다', node: 'bussend', value: true, ch: true,
              tech: 'logic-ctrl' }
};
var RULE_ACTION_IDS = Object.keys(RULE_ACTIONS);

var RULE_CMPS = [
  { op: '<',  label: '보다 작으면' },
  { op: '<=', label: '이하면' },
  { op: '>',  label: '보다 크면' },
  { op: '>=', label: '이상이면' },
  { op: '==', label: '와 같으면' },
  { op: '!=', label: '와 다르면' }
];
var RULE_MATHS = [
  { op: '-', label: '에서 뺀 값' }, { op: '+', label: '을 더한 값' },
  { op: '*', label: '을 곱한 값' }, { op: '/', label: '으로 나눈 값' },
  { op: 'min', label: '과 둘 중 작은 값' }, { op: 'max', label: '과 둘 중 큰 값' },
  // 유일한 단항이다 — 두 값을 계산하는 게 아니라 한 값을 시간으로 눅인다.
  // b 는 상수가 아니라 **시상수(초)** 라서 문장도 다르게 읽는다.
  { op: 'smooth', label: '초로 눅인 값', unary: true, tech: 'logic-ctrl' }
];

// 기억(memory) — 문장 뒤에 붙는 선택지. 각각 어떤 노드가 필요한지 함께 적는다.
// tech 가 있는 것은 연구 전에는 **고를 수 없게** 한다 (잠긴 노드는 조용히 0을 낸다).
var RULE_MEMOS = {
  'none':    { label: '(그때그때 판단)', nodes: [] },
  'latch':   { label: '한 번 참이면 유지하고, 따로 정한 조건에서만 되돌린다',
               nodes: ['latch'], tech: 'logic-mem' },
  'edge':    { label: '참이 되는 그 순간에만',  nodes: ['edge'], tech: 'logic-mem' },
  'count':   { label: '몇 번 일어났는지 세어서', nodes: ['counter', 'cmp'], tech: 'logic-mem' },
  'hold':    { label: '그때의 값을 기억해서',    nodes: ['hold'], tech: 'logic-mem' }
};

// --- 규칙 하나의 모양 -------------------------------------------------------
// {
//   id, name,                       // name 은 다른 규칙이 참조할 이름 (없으면 참조 불가)
//   when: { src, ent, item, radius, // 무엇을 읽나
//           math: {op, b},          // (선택) 계산 한 단
//           cmp, value,             // 어떻게 판단하나
//           and: [ {…같은 모양…} ], // (선택) 그리고/또는로 묶인 추가 조건
//           andMode: 'AND'|'OR',
//           refName },              // (선택) 다른 규칙의 이름을 읽는다
//   memo: { kind, resetCmp, resetValue, everySec, times },
//   then: { act, ent, item2, label, onWhenTrue }
// }
function newRule(id) {
  return { id: id, name: '', enabled: true,
           when: { src: 'chest', ent: null, item: 'iron-plate', radius: 30, ch: 'A',
                   math: null, cmp: '<', value: 50, and: [], andMode: 'AND', refName: null },
           memo: { kind: 'none', resetCmp: '>', resetValue: 200, everySec: 0, times: 3 },
           then: { act: 'run', ent: null, item2: null, label: '', ch: 'A', onWhenTrue: true } };
}

function ruleMath(op) {
  for (var i = 0; i < RULE_MATHS.length; i++) if (RULE_MATHS[i].op === op) return RULE_MATHS[i];
  return null;
}

// 규칙이 지금 연구 상태로 컴파일 가능한가. 안 되면 이유를 돌려준다.
// **컴파일해 놓고 조용히 0을 내게 두지 않는다** — 그게 이 게임에서 제일 나쁜 실패다.
function ruleBlockedReason(r) {
  var s = RULE_SOURCES[r.when.src];
  if (s && s.tech && !techDone[s.tech]) return TECHS[s.tech].name + ' 연구가 필요하다';
  var a = RULE_ACTIONS[r.then.act];
  if (a && a.tech && !techDone[a.tech]) return TECHS[a.tech].name + ' 연구가 필요하다';
  // 계산 한 단에도 연구가 걸릴 수 있다(눅이기 = 평활 필터). 여기를 빼먹으면
  // 잠긴 노드가 회로에 들어가 조용히 0 을 내고, 문장은 멀쩡해 보인다.
  var mo = r.when.math && r.when.math.op && ruleMath(r.when.math.op);
  if (mo && mo.tech && !techDone[mo.tech]) return TECHS[mo.tech].name + ' 연구가 필요하다';
  for (var q = 0; q < (r.when.and || []).length; q++) {
    var sub = r.when.and[q];
    var ss = RULE_SOURCES[sub.src];
    if (ss && ss.tech && !techDone[ss.tech]) return TECHS[ss.tech].name + ' 연구가 필요하다';
    var sm = sub.math && sub.math.op && ruleMath(sub.math.op);
    if (sm && sm.tech && !techDone[sm.tech]) return TECHS[sm.tech].name + ' 연구가 필요하다';
  }
  var m = RULE_MEMOS[r.memo.kind];
  if (m && m.tech && !techDone[m.tech]) return TECHS[m.tech].name + ' 연구가 필요하다';
  if (r.memo.kind === 'latch' && r.memo.everySec > 0 && !techDone['logic-mem']) {
    return TECHS['logic-mem'].name + ' 연구가 필요하다';
  }
  return null;
}

// --- 컴파일 -----------------------------------------------------------------
// 규칙 목록 → 노드 그래프. **좌표는 규칙 번호와 열 번호로 결정한다.**
// 좌표가 평가 순서를 정하므로(graphCompile), 여기서 흔들리면 같은 문장이
// 판마다 다르게 돈다.
var RULE_COL = 210;     // 열 간격(px)
var RULE_SUB = 62;      // 한 규칙 안에서 부품을 세로로 벌리는 간격
var RULE_GAP = 90;      // 규칙과 규칙 사이 여백
// **규칙 간격을 고정값으로 두면 안 된다.** 190px 로 박아 뒀더니 래치 규칙은 자기
// 부품이 y+516 까지 뻗어 다음 규칙과 겹쳤다 — 회로로 펼치면 두 문장의 노드가
// 뒤엉켜 어느 것이 어느 규칙인지 알 수 없다. 규칙마다 실제 높이를 재서 그만큼 내린다.

function compileRules(e) {
  var g = newGraph();
  if (!e.rules || !e.rules.length) { e.graph = g; return { nodes: 0, skipped: [] }; }
  var skipped = [];
  var named = {};                    // 규칙 이름 -> 그 규칙의 '판단 결과' 노드 nid

  var y0 = 20;
  for (var i = 0; i < e.rules.length; i++) {
    var r = e.rules[i];
    if (!r.enabled) { skipped.push({ name: r.name || ('규칙 ' + (i + 1)), why: '꺼 둠' }); continue; }
    var why = ruleBlockedReason(r);
    if (why) { skipped.push({ name: r.name || ('규칙 ' + (i + 1)), why: why }); continue; }
    var mark = g.nodes.length;
    var out = compileOneRule(g, r, y0, named);
    // 이 규칙이 만든 노드에 표를 달고, 실제로 얼마나 내려갔는지 재서 다음 줄을 잡는다.
    // 표(n.rule)는 시험이 "이 규칙의 노드"를 정확히 집게 해 주고, 화면에서 어느
    // 문장이 만든 노드인지 짚는 데도 쓸 수 있다.
    var maxY = y0;
    for (var k = mark; k < g.nodes.length; k++) {
      g.nodes[k].rule = r.id;
      if (g.nodes[k].y > maxY) maxY = g.nodes[k].y;
    }
    y0 = maxY + RULE_GAP;
    if (out && r.name) named[r.name] = out;
  }
  e.graph = g;
  return { nodes: g.nodes.length, skipped: skipped };
}

// 조건 하나(읽기 → (계산) → 비교)를 만들고 '참/거짓' 노드의 nid 를 돌려준다.
function compileCondition(g, w, x0, y0, named) {
  // 다른 규칙의 결과를 읽는 조건이면 노드를 새로 만들지 않고 그 결과를 그대로 쓴다.
  // 배선 없이 규칙을 엮는 길이 이것이다.
  if (w.refName && named[w.refName]) return { nid: named[w.refName], port: 0, isBool: true };

  var s = RULE_SOURCES[w.src];
  if (!s) return null;
  var src = graphAddNode(g, s.node, x0, y0);
  if (s.needs.indexOf('ent') >= 0) src.cfg.ent = w.ent || null;
  if (s.needs.indexOf('item') >= 0) src.cfg.item = w.item || null;
  if (s.needs.indexOf('radius') >= 0) src.cfg.radius = +w.radius || 30;
  if (s.needs.indexOf('ch') >= 0) src.cfg.ch = w.ch || 'A';

  var vNid = src.nid, vPort = s.port, x = x0 + RULE_COL;

  // 계산 한 단 (선택) — "공급kW 에서 수요kW 를 뺀 값" 같은 것
  if (w.math && w.math.op) {
    var mdef = ruleMath(w.math.op);
    if (mdef && mdef.unary) {
      // 눅이기는 상수를 하나 더 놓지 않는다 — b 는 시상수라 노드의 설정값이다
      var sm = graphAddNode(g, 'smooth', x, y0);
      sm.cfg.tau = +w.math.b || 0;
      graphLink(g, vNid, vPort, sm.nid, 0);
      vNid = sm.nid; vPort = 0; x += RULE_COL;
    } else {
      var mb = graphAddNode(g, 'const', x0, y0 + RULE_SUB);
      mb.cfg.value = +w.math.b || 0;
      var mm = graphAddNode(g, 'math', x, y0);
      mm.cfg.op = w.math.op;
      graphLink(g, vNid, vPort, mm.nid, 0);
      graphLink(g, mb.nid, 0, mm.nid, 1);
      vNid = mm.nid; vPort = 0; x += RULE_COL;
    }
  }

  // 참/거짓을 내는 읽기(기계가 도는가 등)를 그대로 조건으로 쓰면 비교가 필요 없다.
  if (s.bool && (w.cmp === '==' || !w.cmp)) {
    return { nid: vNid, port: vPort, isBool: true, valNid: vNid, valPort: vPort };
  }

  var kv = graphAddNode(g, 'const', x0, y0 + RULE_SUB * 2);
  kv.cfg.value = +w.value || 0;
  var c = graphAddNode(g, 'cmp', x, y0);
  c.cfg.op = w.cmp || '<';
  graphLink(g, vNid, vPort, c.nid, 0);
  graphLink(g, kv.nid, 0, c.nid, 1);
  // valNid/valPort = **비교하기 전의 값** 그 자체. '숫자를 띄운다' 처럼 참/거짓이
  // 아니라 값을 받아야 하는 행동이 이걸 쓴다 (아래 compileOneRule).
  return { nid: c.nid, port: 0, isBool: true, x: x, valNid: vNid, valPort: vPort };
}

function compileOneRule(g, r, y0, named) {
  var w = r.when;
  var cond = compileCondition(g, w, 20, y0, named);
  if (!cond) return null;
  var condNid = cond.nid, condPort = cond.port;
  var valNid = cond.valNid, valPort = cond.valPort;   // 비교 전의 값 (있을 때만)
  var x = (cond.x || 20 + RULE_COL) + RULE_COL;

  // 그리고 / 또는 로 묶인 추가 조건
  for (var a = 0; a < (w.and || []).length; a++) {
    var sub = compileCondition(g, w.and[a], 20, y0 + RULE_SUB * (3 + a * 3), named);
    if (!sub) continue;
    var b = graphAddNode(g, 'bool', x, y0);
    b.cfg.op = (w.andMode === 'OR') ? 'OR' : 'AND';
    graphLink(g, condNid, condPort, b.nid, 0);
    graphLink(g, sub.nid, sub.port, b.nid, 1);
    condNid = b.nid; condPort = 0; x += RULE_COL;
  }

  // 기억 한 단
  var m = r.memo || { kind: 'none' };
  if (m.kind === 'edge') {
    var ed = graphAddNode(g, 'edge', x, y0);
    ed.cfg.mode = '상승';
    graphLink(g, condNid, condPort, ed.nid, 0);
    condNid = ed.nid; condPort = 0; x += RULE_COL;

  } else if (m.kind === 'latch') {
    // "한 번 참이면 유지하고, 따로 정한 조건에서 되돌린다" = SR 래치.
    // 되돌리는 쪽은 같은 값을 반대 문턱으로 다시 비교한다 — 이게 히스테리시스다.
    var rc = compileCondition(g, { src: w.src, ent: w.ent, item: w.item, radius: w.radius,
                                   math: w.math, cmp: m.resetCmp, value: m.resetValue },
                              20, y0 + RULE_SUB * 6, named);
    var la = graphAddNode(g, 'latch', x, y0);
    graphLink(g, condNid, condPort, la.nid, 0);
    if (rc) {
      var resetNid = rc.nid, resetPort = rc.port;
      // "되돌리는 건 N초에 한 번만" — 되먹임이 있는 계는 문턱만 벌려서는 안 멈춘다.
      // 끊는 쪽은 즉시, 되돌리는 쪽만 늦춘다.
      if (m.everySec > 0) {
        var tm = graphAddNode(g, 'timer', 20, y0 + RULE_SUB * 8);
        tm.cfg.period = +m.everySec;
        var an = graphAddNode(g, 'bool', x - RULE_COL, y0 + RULE_SUB * 7);
        an.cfg.op = 'AND';
        graphLink(g, resetNid, resetPort, an.nid, 0);
        graphLink(g, tm.nid, 0, an.nid, 1);
        resetNid = an.nid; resetPort = 0;
      }
      graphLink(g, resetNid, resetPort, la.nid, 1);
    }
    condNid = la.nid; condPort = 0; x += RULE_COL;

  } else if (m.kind === 'count') {
    var cn = graphAddNode(g, 'counter', x, y0);
    graphLink(g, condNid, condPort, cn.nid, 0);
    var tv = graphAddNode(g, 'const', x, y0 + RULE_SUB * 2);
    tv.cfg.value = +m.times || 1;
    var cc = graphAddNode(g, 'cmp', x + RULE_COL, y0);
    cc.cfg.op = '>=';
    graphLink(g, cn.nid, 0, cc.nid, 0);
    graphLink(g, tv.nid, 0, cc.nid, 1);
    condNid = cc.nid; condPort = 0; x += RULE_COL * 2;

  } else if (m.kind === 'hold') {
    var hd = graphAddNode(g, 'hold', x, y0);
    graphLink(g, condNid, condPort, hd.nid, 1);        // 조건이 '샘플' 신호
    condNid = hd.nid; condPort = 0; x += RULE_COL;
  }

  // 행동
  var t = r.then, ad = RULE_ACTIONS[t.act];
  if (!ad) return condNid;
  var actIn = condNid, actPort = condPort;
  // "조건이 참일 때 끈다"는 뒤집기 한 단이 필요하다
  if (ad.verbOn && t.onWhenTrue === false) {
    var nt = graphAddNode(g, 'bool', x, y0);
    nt.cfg.op = 'NOT A';
    graphLink(g, actIn, actPort, nt.nid, 0);
    actIn = nt.nid; actPort = 0; x += RULE_COL;
  }
  var an2 = graphAddNode(g, ad.node, x, y0);
  if (ad.entFilter) an2.cfg.ent = t.ent || null;
  if (ad.text) an2.cfg.label = t.label || (r.name || '');
  if (ad.twoItems) { an2.cfg.a = t.item || null; an2.cfg.b = t.item2 || null; }
  if (ad.ch) an2.cfg.ch = t.ch || 'A';

  // **값을 받는 행동은 값을 받아야 한다.** 행동표에 value 플래그가 있었는데 여기서
  // 한 번도 안 읽어서, '숫자를 화면에 띄운다' 가 조건의 참/거짓(1 또는 0)을 띄우고
  // 있었다 — 문장은 맞는데 값이 틀린, 이 게임이 가장 싫어하는 종류다.
  // 조건은 버리지 않고 [선택] 한 단으로 살린다: 조건이 참이면 값, 아니면 0.
  // 그래야 "재고가 50 미만이면 그 값을 보낸다" 같은 문장이 말 그대로 돈다.
  if (ad.value && valNid) {
    var zero = graphAddNode(g, 'const', x, y0 + RULE_SUB * 2);
    zero.cfg.value = 0;
    var sel = graphAddNode(g, 'select', x, y0 + RULE_SUB);
    graphLink(g, actIn, actPort, sel.nid, 0);      // 조건
    graphLink(g, valNid, valPort, sel.nid, 1);     // 참일 때: 잰 값
    graphLink(g, zero.nid, 0, sel.nid, 2);         // 거짓일 때: 0
    graphLink(g, sel.nid, 0, an2.nid, 0);
    return condNid;
  }
  graphLink(g, actIn, actPort, an2.nid, 0);
  return condNid;
}

// --- 문장을 사람 말로 되읽기 -------------------------------------------------
// 화면에도 쓰고, 시험에서 "무엇을 만들었다고 주장하는가"를 재는 데도 쓴다.
function ruleSentence(r) {
  var w = r.when, s = RULE_SOURCES[w.src];
  var parts = [];
  if (w.refName) parts.push('만약 [' + w.refName + '] 이면');
  else if (s) {
    // 주어가 "상자 #14 의 상자의 재고(철판)" 처럼 겹치면 문장이 아니라 경로가 된다.
    // 품목이 있으면 품목을 주어로 세운다 — "상자 #14 의 철판".
    var subj = ruleSubject(w, s);
    var mtxt = mathPhrase(w.math);
    var ct = null;
    for (var c = 0; c < RULE_CMPS.length; c++) if (RULE_CMPS[c].op === w.cmp) ct = RULE_CMPS[c];
    if (s.bool && (!w.cmp || w.cmp === '==')) parts.push('만약 ' + subj + ' 이면');
    else parts.push('만약 ' + subj + mtxt + ' 이 ' + w.value + (s.unit || '') +
                    ' ' + (ct ? ct.label : w.cmp));
  }
  for (var a = 0; a < (w.and || []).length; a++) {
    parts.push((w.andMode === 'OR' ? '또는 ' : '그리고 ') + condPhrase(w.and[a]));
  }
  var m = r.memo || { kind: 'none' };
  var t = r.then, ad = RULE_ACTIONS[t.act];
  var verb = ad ? (ad.verbOn ? (t.onWhenTrue === false ? ad.verbOff : ad.verbOn) : ad.label) : '';
  var obj = (ad && ad.entFilter) ? entName(t.ent) + ' 을 ' : '';
  if (ad && ad.ch) obj = '채널 ' + (t.ch || 'A') + ' 로 ';
  parts.push('그래서 ' + obj + verb);
  if (m.kind === 'latch') {
    var rct = null;
    for (var k = 0; k < RULE_CMPS.length; k++) if (RULE_CMPS[k].op === m.resetCmp) rct = RULE_CMPS[k];
    parts.push('다시 ' + m.resetValue + (s ? (s.unit || '') : '') + ' ' +
               (rct ? rct.label : m.resetCmp) + ' 되돌린다' +
               (m.everySec > 0 ? ' (되돌리는 건 ' + m.everySec + '초에 한 번만)' : ''));
  } else if (m.kind === 'edge') parts.push('— 그 순간에만');
  else if (m.kind === 'count') parts.push('— ' + m.times + '번 넘게 일어났을 때');
  else if (m.kind === 'hold') parts.push('— 그때 값을 기억해서');
  return parts.join(' ');
}
// 주어 한 덩어리. 품목이 있으면 품목이 주어고, 대상이 있으면 그 앞에 붙고,
// 채널이 있으면 "채널 A 로 받은 신호" 가 된다.
function ruleSubject(w, s) {
  var subj = s.label;
  if (s.needs.indexOf('item') >= 0 && w.item && ITEMS[w.item]) subj = ITEMS[w.item].name;
  if (s.needs.indexOf('ent') >= 0) subj = entName(w.ent) + ' 의 ' + subj;
  if (s.needs.indexOf('ch') >= 0) subj = '채널 ' + (w.ch || 'A') + ' 로 ' + subj;
  return subj;
}
// 계산 한 단을 사람 말로. 단항(눅이기)은 조사가 달라서 따로 쓴다.
function mathPhrase(m) {
  if (!m || !m.op) return '';
  var md = ruleMath(m.op);
  if (md && md.unary) return ' 를 ' + m.b + md.label;
  return ' 에 ' + m.b + (md ? md.label : '');
}
function condPhrase(w) {
  var s = RULE_SOURCES[w.src];
  if (!s) return '?';
  var subj = ruleSubject(w, s) + mathPhrase(w.math);
  var ct = null;
  for (var c = 0; c < RULE_CMPS.length; c++) if (RULE_CMPS[c].op === w.cmp) ct = RULE_CMPS[c];
  if (s.bool && (!w.cmp || w.cmp === '==')) return subj + ' 이면';
  return subj + ' 이 ' + w.value + (s.unit || '') + ' ' + (ct ? ct.label : w.cmp);
}

// --- 하고 싶은 일 카드 -------------------------------------------------------
// 빈 문장도 막막할 수 있으니, 흔한 목적을 골라 절반쯤 채워진 문장으로 연다.
// 여기 값들은 심화 튜토리얼이 가르치는 것과 같은 회로다.
var RULE_CARDS = [
  { id: 'stock', title: '재고가 넘치면 기계 쉬게 하기',
    why: '상자가 가득 차면 만들어 봐야 갈 데가 없다. 전기와 광석만 쓴다.',
    make: function (r) {
      r.name = '재고충분';
      r.when.src = 'chest'; r.when.cmp = '>'; r.when.value = 200;
      r.memo.kind = 'none';
      r.then.act = 'run'; r.then.onWhenTrue = false;
    } },
  { id: 'shed', title: '전기가 모자라면 덜 급한 것부터 끄기',
    why: '전기가 모자라면 <b>모든</b> 기계가 같이 느려진다. 하나를 꺼서 나머지를 살린다.',
    need: 'logic-mem',
    make: function (r) {
      r.name = '전기부족';
      r.when.src = 'powerHead'; r.when.cmp = '<'; r.when.value = 0;
      r.memo.kind = 'latch'; r.memo.resetCmp = '>'; r.memo.resetValue = 200; r.memo.everySec = 30;
      r.then.act = 'run'; r.then.onWhenTrue = false;
    } },
  { id: 'defend', title: '적이 오면 생산 멈추기',
    why: '습격 중엔 전기를 터렛에 몰아주는 편이 낫다.',
    need: 'defense-ai',
    make: function (r) {
      r.name = '습격중';
      r.when.src = 'enemyN'; r.when.cmp = '>'; r.when.value = 0; r.when.radius = 30;
      r.then.act = 'run'; r.then.onWhenTrue = false;
    } },
  { id: 'alarm', title: '탄약이 줄면 경보 울리기',
    why: '빈 터렛은 조용히 빈다. 숫자를 안 보고 있으면 습격 때 알게 된다.',
    make: function (r) {
      r.name = '탄약부족';
      r.when.src = 'stock'; r.when.item = 'ammo'; r.when.cmp = '<'; r.when.value = 40;
      r.then.act = 'lamp'; r.then.label = '탄약 부족'; r.then.onWhenTrue = true;
    } },
  { id: 'watch', title: '숫자를 화면에 띄워 보기',
    why: '무엇이 벌어지는지 먼저 보는 게 순서다. 판단은 그 다음이다.',
    make: function (r) {
      r.name = '';
      r.when.src = 'powerHead'; r.when.cmp = '>='; r.when.value = 0;
      r.then.act = 'display'; r.then.label = '전기 여유';
    } },
  { id: 'signal', title: '공장 상태를 다른 제어기에 알리기',
    why: '제어기 하나에 규칙을 다 몰아넣으면 읽을 수가 없다. 재는 쪽과 판단하는 쪽을 ' +
         '나누고 <b>채널</b>로 값을 넘긴다. 받는 쪽에서는 [받은 신호] 를 읽으면 된다.',
    need: 'logic-ctrl',
    make: function (r) {
      r.name = '전기여유알림';
      r.when.src = 'powerHead'; r.when.cmp = '>='; r.when.value = -1e9;
      r.when.math = { op: 'smooth', b: 5 };     // 튀는 값은 눅여서 보낸다
      r.then.act = 'bus'; r.then.ch = 'A';
    } },
  { id: 'blank', title: '빈 문장으로 직접 만들기', why: '', make: function () {} }
];
