// ===========================================================================
//  35_logic.js — ★ 이 게임의 차별점: 프로그래머블 제어기
//
//  제어기 하나는 데이터플로 그래프다. 매 틱 위상순으로 한 번 평가한다.
//  순환(피드백)이 생기면 그 간선만 "직전 틱의 값"을 읽는다 — 즉 1틱 지연 레지스터다.
//  실제 순차논리(D 플립플롭 한 단)와 같은 의미이고, 그래서 SR 래치·카운터·PID 같은
//  상태 소자를 자연스럽게 배선할 수 있다.
//
//  값은 전부 실수 하나. **참/거짓은 0.5 이상 = 참**이다 (TRUE_EPS).
//  0 초과가 아니다 — 0.4 는 거짓이다. 신호가 대부분 정수(0/1)라 잡음을
//  참으로 읽지 않으려고 이렇게 뒀다. 사칙 1/4=0.25, PID 출력 0.3 처럼
//  소수를 내는 노드를 참/거짓 자리에 물릴 때 걸린다 — 도움말에도 적어 둔다.
// ===========================================================================

var TRUE_EPS = 0.5;      // >= 0.5 를 참으로 본다 (정수 신호가 대부분이라)
function truthy(v) { return v >= TRUE_EPS; }

// --- 노드 정의표 -----------------------------------------------------------
//  cat: 'in' 입력 / 'op' 연산 / 'out' 출력
//  cfg 항목 type: 'num' | 'item' | 'ent' | 'opsel' | 'text'
var NODE_DEFS = {
  // ---- 입력 ----
  'const':   { label: '상수', cat: 'in', ins: [], outs: ['값'],
               cfg: [{ k: 'value', t: 'num', label: '값', def: 1 }] },
  'chest':   { label: '상자 재고', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['chest'] },
                     { k: 'item', t: 'item', label: '품목' }] },
  'machine': { label: '기계 상태', cat: 'in', ins: [], outs: ['가동', '정체', '진행%'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상',
                       filter: ['miner', 'furnace', 'assembler', 'lab', 'generator', 'turret', 'inserter'] }] },
  // 출구 다섯 개 **모두 자기 전력망 기준**이다. 예전에는 만족%만 자기 망이고
  // 공급kW/수요kW 는 전 세계 합계였다 — 발전소가 둘이면 제어기가 지도 반대편
  // 숫자로 판단했다. '여유kW' 는 공급-수요이고 **클램프하지 않는다**:
  // 만족%는 100 에서 잘려 부하 차단의 히스테리시스에 쓸 사공간이 없다.
  // '망연결' 은 0 이 '전기 없음' 인지 '망 밖'인지 구별하게 해준다.
  'power':   { label: '전력 만족도', cat: 'in', ins: [],
               outs: ['만족%', '공급kW', '수요kW', '여유kW', '망연결'],
               cfg: [] },
  'timer':   { label: '타이머', cat: 'in', ins: [], outs: ['펄스', '위상%'],
               cfg: [{ k: 'period', t: 'num', label: '주기', def: 5 }] },
  'belt':    { label: '벨트 센서', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['belt', 'splitter'] },
                     { k: 'item', t: 'item', label: '품목' }] },
  'invsense':{ label: '창고 재고', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'item', t: 'item', label: '품목' }] },
  'research':{ label: '연구 진행', cat: 'in', ins: [], outs: ['진행%', '연구중'],
               cfg: [] },
  'enemy':   { label: '적 근접', cat: 'in', ins: [], outs: ['마릿수', '최근접거리'],
               cfg: [{ k: 'radius', t: 'num', label: '반경', def: 30 }],
               tech: 'defense-ai' },

  // ---- 연산 ----
  'cmp':     { label: '비교', cat: 'op', ins: ['A', 'B'], outs: ['참'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['>', '>=', '<', '<=', '==', '!='], def: '>' }] },
  'math':    { label: '사칙', cat: 'op', ins: ['A', 'B'], outs: ['값'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['+', '-', '*', '/', '%', 'min', 'max'], def: '+' }] },
  'bool':    { label: '논리', cat: 'op', ins: ['A', 'B'], outs: ['참'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['AND', 'OR', 'XOR', 'NOT A'], def: 'AND' }] },
  'clamp':   { label: '범위 제한', cat: 'op', ins: ['값'], outs: ['값'],
               cfg: [{ k: 'lo', t: 'num', label: '하한', def: 0 }, { k: 'hi', t: 'num', label: '상한', def: 100 }] },
  'select':  { label: '선택 (조건 ? A : B)', cat: 'op', ins: ['조건', 'A', 'B'], outs: ['값'], cfg: [] },
  'latch':   { label: 'SR 래치', cat: 'op', ins: ['SET', 'RESET'], outs: ['Q'], cfg: [], tech: 'logic-mem' },
  'counter': { label: '카운터', cat: 'op', ins: ['증가', '리셋'], outs: ['값'],
               cfg: [{ k: 'max', t: 'num', label: '상한', def: 0 }], tech: 'logic-mem' },
  'edge':    { label: '엣지 검출', cat: 'op', ins: ['A'], outs: ['펄스'],
               cfg: [{ k: 'mode', t: 'opsel', label: '검출', opts: ['상승', '하강', '양쪽'], def: '상승' }], tech: 'logic-mem' },
  'hold':    { label: '샘플 홀드', cat: 'op', ins: ['값', '샘플'], outs: ['유지값'], cfg: [], tech: 'logic-mem' },
  'pid':     { label: 'PID 제어', cat: 'op', ins: ['목표', '측정'], outs: ['출력', '오차'],
               cfg: [{ k: 'kp', t: 'num', label: 'Kp', def: 1 }, { k: 'ki', t: 'num', label: 'Ki', def: 0 },
                     { k: 'kd', t: 'num', label: 'Kd', def: 0 }, { k: 'lim', t: 'num', label: '제한', def: 100 }],
               tech: 'logic-ctrl' },

  // ---- 출력 ----
  // 대상 목록을 **실제로 enabled 를 보는 건물**로 좁힌다. 예전에는 벽·전주·상자·
  // 벨트까지 고를 수 있었는데, 그것들은 enabled 를 읽지 않아 배선해도 아무 일도
  // 일어나지 않았다. 고를 수 있으면 고른다 — 그리고 왜 안 되는지 알 수 없다.
  // (벨트를 멈추려면 [벨트 게이트] 를 쓴다.)
  'enable':  { label: '기계 가동/정지', cat: 'out', ins: ['가동'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상',
                       filter: ['miner', 'furnace', 'assembler', 'lab', 'generator', 'turret', 'inserter'] }] },
  'gate':    { label: '벨트 게이트', cat: 'out', ins: ['열림'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['belt', 'splitter'] }], tech: 'logic-ctrl' },
  'filter':  { label: '인서터 필터', cat: 'out', ins: ['선택'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['inserter'] },
                     { k: 'a', t: 'item', label: '0일 때' },
                     { k: 'b', t: 'item', label: '1일 때' }], tech: 'logic-ctrl' },
  'fire':    { label: '터렛 사격허가', cat: 'out', ins: ['허가'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['turret'] }], tech: 'defense-ai' },
  'lamp':    { label: '경보 램프', cat: 'out', ins: ['점등'], outs: [],
               cfg: [{ k: 'label', t: 'text', label: '문구', def: '' }] },
  'display': { label: '수치 표시', cat: 'out', ins: ['값'], outs: [],
               cfg: [{ k: 'label', t: 'text', label: '이름', def: '' }] }
};
var NODE_KINDS = Object.keys(NODE_DEFS);

function nodeAvailable(kind) {
  var d = NODE_DEFS[kind];
  return !d.tech || !!techDone[d.tech];
}

// --- 그래프 ----------------------------------------------------------------
function newGraph() {
  return { nodes: [], links: [], nextNid: 1, order: null, backEdges: null, dirty: true };
}
function graphAddNode(g, kind, x, y) {
  var d = NODE_DEFS[kind];
  var n = { nid: g.nextNid++, kind: kind, x: x, y: y, cfg: {}, state: {}, out: [], prev: [] };
  for (var i = 0; i < d.cfg.length; i++) {
    var c = d.cfg[i];
    n.cfg[c.k] = (c.def !== undefined) ? c.def : (c.t === 'num' ? 0 : (c.t === 'opsel' ? c.opts[0] : null));
  }
  for (var o = 0; o < d.outs.length; o++) { n.out.push(0); n.prev.push(0); }
  g.nodes.push(n);
  g.dirty = true;
  return n;
}
function graphNode(g, nid) {
  for (var i = 0; i < g.nodes.length; i++) if (g.nodes[i].nid === nid) return g.nodes[i];
  return null;
}
function graphRemoveNode(g, nid) {
  for (var i = g.nodes.length - 1; i >= 0; i--) if (g.nodes[i].nid === nid) g.nodes.splice(i, 1);
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].fn === nid || g.links[j].tn === nid) g.links.splice(j, 1);
  }
  g.dirty = true;
}
// 입력 포트 하나에는 간선 하나만 — 여러 개가 붙으면 값이 결정되지 않는다
function graphLink(g, fromNid, fromPort, toNid, toPort) {
  if (fromNid === toNid) return false;
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].tn === toNid && g.links[j].tp === toPort) g.links.splice(j, 1);
  }
  g.links.push({ fn: fromNid, fp: fromPort, tn: toNid, tp: toPort });
  g.dirty = true;
  return true;
}
function graphUnlink(g, toNid, toPort) {
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].tn === toNid && g.links[j].tp === toPort) { g.links.splice(j, 1); g.dirty = true; }
  }
}

// --- 위상정렬 + 피드백 간선 판별 ---------------------------------------------
// DFS 로 후향 간선(back edge)을 찾아 그것만 "직전 틱 값"으로 읽게 표시한다.
function graphCompile(g) {
  var byId = {};
  for (var i = 0; i < g.nodes.length; i++) byId[g.nodes[i].nid] = g.nodes[i];
  var adj = {};
  for (var a = 0; a < g.nodes.length; a++) adj[g.nodes[a].nid] = [];
  for (var l = 0; l < g.links.length; l++) {
    var lk = g.links[l];
    if (byId[lk.fn] && byId[lk.tn]) adj[lk.fn].push({ to: lk.tn, link: lk });
    lk.back = false;
  }

  // **평가 순서는 '화면에 보이는 배치'의 함수여야 한다.**
  // 예전에는 DFS 진입점 순서 = g.nodes 배열 순서 = **노드를 만든 순서**였다.
  // 그래서 위치와 배선이 글자 하나까지 같은 두 회로가 다르게 돌았다 — 어느 배선이
  // 1틱 지연 되먹임이 되는지가 갈렸고, 값까지 달라졌다. 더 나쁜 것은 노드 하나를
  // 지우고 같은 자리에 다시 만들면(splice 후 push) 그 노드가 순서 맨 뒤로 밀려
  // 손도 안 댄 회로가 갑자기 다르게 도는 것이었다.
  // 화면에는 좌표와 배선만 보이고 생성 순서는 어디에도 안 나오므로, 플레이어가
  // 원인을 짚을 단서가 없었다. 좌표순으로 정렬하면 보이는 것이 곧 규칙이 된다.
  function layoutKey(n) { return [Math.round(n.x), Math.round(n.y), n.nid]; }
  function cmpNode(p, q) {
    var A = layoutKey(p), B = layoutKey(q);
    return (A[0] - B[0]) || (A[1] - B[1]) || (A[2] - B[2]);
  }
  var roots = g.nodes.slice().sort(cmpNode);
  for (var r2 = 0; r2 < roots.length; r2++) {
    var ls2 = adj[roots[r2].nid];
    if (ls2 && ls2.length > 1) {
      ls2.sort(function (u, v) { return cmpNode(byId[u.to], byId[v.to]); });
    }
  }
  var color = {};     // 0 미방문, 1 스택 위, 2 완료
  var order = [];
  function dfs(nid) {
    color[nid] = 1;
    var ls = adj[nid];
    for (var k = 0; k < ls.length; k++) {
      var t = ls[k].to;
      if (color[t] === 1) { ls[k].link.back = true; }        // 후향 간선 = 피드백
      else if (!color[t]) dfs(t);
    }
    color[nid] = 2;
    order.push(nid);
  }
  for (var s = 0; s < roots.length; s++) if (!color[roots[s].nid]) dfs(roots[s].nid);
  order.reverse();
  g.order = order;
  g.byId = byId;
  // 입력 포트별 소스 링크 색인
  g.inLinks = {};
  for (var m = 0; m < g.links.length; m++) {
    var lm = g.links[m];
    if (!byId[lm.fn] || !byId[lm.tn]) continue;
    g.inLinks[lm.tn + ':' + lm.tp] = lm;
  }
  g.dirty = false;
  g.cycles = g.links.filter(function (x) { return x.back; }).length;
}

// --- 평가 -------------------------------------------------------------------
var logicDirty = true;
function markLogicDirty() { logicDirty = true; }
function dropLogicRefs(entId) {
  forEachEntity(function (e) {
    if (e.type !== 'controller' || !e.graph) return;
    for (var i = 0; i < e.graph.nodes.length; i++) {
      var n = e.graph.nodes[i];
      if (n.cfg && n.cfg.ent === entId) n.cfg.ent = null;
    }
  });
}

var alarms = [];        // 이번 틱에 켜진 램프 문구
var displays = [];      // { label, value }

// 이 입력 포트에 배선이 실제로 물려 있는가. 값이 0 인 것과 아예 안 물린 것은
// 다르다 — 출력 노드가 그 둘을 구별하지 않아 '안 물림'을 '정지 명령'으로 읽었다.
function inputFed(g, n, port) {
  return !!(g.inLinks && g.inLinks[n.nid + ':' + port]);
}

function readIn(g, n, port) {
  // **컴파일 전 그래프에서 부를 수 있다.** inLinks 는 graphCompile 이 만드는데,
  // 편집기의 해석 줄(updateLive)은 제어기가 아직 한 번도 평가되지 않은 상태에서도
  // 이 함수를 부른다 — 그때 g.inLinks 가 undefined 라 TypeError 로 죽고,
  // 그 예외가 updateLive 전체를 멈춰 편집기가 영구히 얼어붙는다.
  if (!g.inLinks) return 0;
  var lk = g.inLinks[n.nid + ':' + port];
  if (!lk) return 0;
  var src = g.byId[lk.fn];
  if (!src) return 0;
  var v = lk.back ? src.prev[lk.fp] : src.out[lk.fp];
  return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

function evalNode(g, n, dt, ctrl) {
  var d = NODE_DEFS[n.kind];
  if (d.tech && !techDone[d.tech]) { for (var z = 0; z < n.out.length; z++) n.out[z] = 0; return; }
  switch (n.kind) {
    case 'const': n.out[0] = +n.cfg.value || 0; break;

    case 'chest': {
      var e = entities[n.cfg.ent];
      if (!e || e.type !== 'chest') { n.out[0] = 0; break; }
      n.out[0] = n.cfg.item ? invCount(e.inv, n.cfg.item) : invTotal(e.inv);
      break;
    }
    case 'machine': {
      var m = entities[n.cfg.ent];
      if (!m) { n.out[0] = 0; n.out[1] = 0; n.out[2] = 0; break; }
      n.out[0] = m.working ? 1 : 0;
      n.out[1] = m.stallT > 1.5 ? 1 : 0;
      n.out[2] = Math.round((m.progress || 0) * 100);
      break;
    }
    case 'power': {
      var np = ctrl ? netPowerOf(ctrl)
                    : { connected: 1, supply: powerStats.supply,
                        demand: powerStats.demand, head: powerStats.supply - powerStats.demand };
      var sat = ctrl ? netSatOf(ctrl) : powerStats.sat;
      n.out[0] = Math.round(sat * 100);
      n.out[1] = Math.round(np.supply);
      n.out[2] = Math.round(np.demand);
      n.out[3] = Math.round(np.head);      // 클램프 없음 — 남는 쪽도 보인다
      n.out[4] = np.connected;
      break;
    }
    case 'timer': {
      var per = Math.max(0.05, +n.cfg.period || 1);
      n.state.t = (n.state.t || 0) + dt;
      var fired = 0;
      if (n.state.t >= per) { n.state.t -= per; fired = 1; }
      n.out[0] = fired;
      n.out[1] = Math.round((n.state.t / per) * 100);
      break;
    }
    case 'belt': {
      var be = entities[n.cfg.ent];
      if (!be || !be.cells) { n.out[0] = 0; break; }
      var acc = {};
      for (var c = 0; c < be.cells.length; c++) beltContents(be.cells[c], acc);
      n.out[0] = n.cfg.item ? (acc[n.cfg.item] || 0) : invTotal(acc);
      break;
    }
    case 'invsense': n.out[0] = n.cfg.item ? (inventory[n.cfg.item] || 0) : 0; break;
    case 'research': {
      n.out[0] = currentResearch ? Math.round(researchFrac() * 100) : 0;
      n.out[1] = currentResearch ? 1 : 0;
      break;
    }
    case 'enemy': {
      var R = Math.max(1, +n.cfg.radius || 30);
      var cx = ctrl ? ctrl.tx + 1 : world.spawnX, cy = ctrl ? ctrl.ty + 1 : world.spawnY;
      var cnt = 0, near = R + 1;
      for (var i = 0; i < enemies.length; i++) {
        var dd = dist(enemies[i].x, enemies[i].y, cx, cy);
        if (dd <= R) { cnt++; if (dd < near) near = dd; }
      }
      n.out[0] = cnt;
      // 적이 없을 때 0(=가장 가까움)을 내면 "거리 < 10 이면 방어" 같은 배선이
      // 평상시에 항상 참이 된다. 감지 반경 밖을 뜻하는 값을 낸다.
      n.out[1] = cnt ? Math.round(near * 10) / 10 : R;
      break;
    }

    case 'cmp': {
      var A = readIn(g, n, 0), B = readIn(g, n, 1), r = 0;
      switch (n.cfg.op) {
        case '>': r = A > B; break;
        case '>=': r = A >= B; break;
        case '<': r = A < B; break;
        case '<=': r = A <= B; break;
        case '==': r = A === B; break;
        case '!=': r = A !== B; break;
      }
      n.out[0] = r ? 1 : 0;
      break;
    }
    case 'math': {
      var a1 = readIn(g, n, 0), b1 = readIn(g, n, 1), v = 0;
      switch (n.cfg.op) {
        case '+': v = a1 + b1; break;
        case '-': v = a1 - b1; break;
        case '*': v = a1 * b1; break;
        case '/': v = b1 === 0 ? 0 : a1 / b1; break;      // 0 나눗셈은 0 — NaN 전파 금지
        case '%': v = b1 === 0 ? 0 : a1 % b1; break;
        case 'min': v = Math.min(a1, b1); break;
        case 'max': v = Math.max(a1, b1); break;
      }
      n.out[0] = isFinite(v) ? v : 0;
      break;
    }
    case 'bool': {
      var ba = truthy(readIn(g, n, 0)), bb = truthy(readIn(g, n, 1)), rb = false;
      switch (n.cfg.op) {
        case 'AND': rb = ba && bb; break;
        case 'OR': rb = ba || bb; break;
        case 'XOR': rb = ba !== bb; break;
        case 'NOT A': rb = !ba; break;
      }
      n.out[0] = rb ? 1 : 0;
      break;
    }
    case 'clamp': n.out[0] = clamp(readIn(g, n, 0), +n.cfg.lo || 0, +n.cfg.hi || 0); break;
    case 'select': n.out[0] = truthy(readIn(g, n, 0)) ? readIn(g, n, 1) : readIn(g, n, 2); break;

    case 'latch': {
      var S = truthy(readIn(g, n, 0)), R2 = truthy(readIn(g, n, 1));
      if (R2) n.state.q = 0; else if (S) n.state.q = 1;
      n.out[0] = n.state.q ? 1 : 0;
      break;
    }
    case 'counter': {
      var inc = truthy(readIn(g, n, 0)), rst = truthy(readIn(g, n, 1));
      if (n.state.prevInc === undefined) n.state.prevInc = false;
      if (rst) n.state.c = 0;
      else if (inc && !n.state.prevInc) n.state.c = (n.state.c || 0) + 1;
      n.state.prevInc = inc;
      var mx = +n.cfg.max || 0;
      if (mx > 0 && n.state.c > mx) n.state.c = 0;
      n.out[0] = n.state.c || 0;
      break;
    }
    case 'edge': {
      var cur = truthy(readIn(g, n, 0));
      var pv = !!n.state.prev;
      var fire2 = 0;
      if (n.cfg.mode === '상승') fire2 = (cur && !pv) ? 1 : 0;
      else if (n.cfg.mode === '하강') fire2 = (!cur && pv) ? 1 : 0;
      else fire2 = (cur !== pv) ? 1 : 0;
      n.state.prev = cur;
      n.out[0] = fire2;
      break;
    }
    case 'hold': {
      if (truthy(readIn(g, n, 1))) n.state.v = readIn(g, n, 0);
      n.out[0] = n.state.v || 0;
      break;
    }
    case 'pid': {
      var sp = readIn(g, n, 0), pv2 = readIn(g, n, 1);
      var err = sp - pv2;
      var kp = +n.cfg.kp || 0, ki = +n.cfg.ki || 0, kd = +n.cfg.kd || 0;
      var lim = Math.abs(+n.cfg.lim || 100);
      if (n.state.i === undefined) n.state.i = 0;
      if (n.state.pe === undefined) n.state.pe = err;
      // 적분 와인드업 방지 — 적분항 자체를 제한 안에 가둔다
      if (ki !== 0) n.state.i = clamp(n.state.i + err * dt, -lim / Math.abs(ki), lim / Math.abs(ki));
      var der = dt > 0 ? (err - n.state.pe) / dt : 0;
      n.state.pe = err;
      var u = kp * err + ki * n.state.i + kd * der;
      n.out[0] = clamp(isFinite(u) ? u : 0, -lim, lim);
      n.out[1] = Math.round(err * 100) / 100;
      break;
    }

    case 'enable': {
      // **입력이 안 물렸으면 지배하지 않는다.** readIn 이 0 을 돌려주므로 예전에는
      // 노드를 놓고 대상만 고른 순간 기계가 즉시 멈췄다 — 배선을 하나도 안 했는데
      // 말이다. 아직 아무 말도 하지 않는 노드가 세계를 붙잡으면 안 된다.
      if (!inputFed(g, n, 0)) break;
      var te = entities[n.cfg.ent];
      // 자기 자신은 끌 수 없다 — 끄는 순간 평가가 멈추고 지배가 풀려 다시 켜지는 발진이 된다.
      if (te && ctrl && te.id === ctrl.id) break;
      if (te) {
        noteAxisWriter(te, '가동', ctrl);
        te.enabled = truthy(readIn(g, n, 0)); te.logicForced = true; te.fEnable = true;
      }
      break;
    }
    case 'gate': {
      if (!inputFed(g, n, 0)) break;
      var ge = entities[n.cfg.ent];
      if (ge && ge.cells) {
        var open = truthy(readIn(g, n, 0));
        noteAxisWriter(ge, '게이트', ctrl);
        for (var gc = 0; gc < ge.cells.length; gc++) ge.cells[gc].gate = open;
        ge.logicForced = true; ge.fGate = true;
      }
      break;
    }
    case 'filter': {
      if (!inputFed(g, n, 0)) break;
      var fe = entities[n.cfg.ent];
      if (fe && fe.type === 'inserter') {
        noteAxisWriter(fe, '필터', ctrl);
        fe.filter = truthy(readIn(g, n, 0)) ? (n.cfg.b || null) : (n.cfg.a || null);
        fe.logicForced = true; fe.fFilter = true;
      }
      break;
    }
    case 'fire': {
      if (!inputFed(g, n, 0)) break;
      var tu = entities[n.cfg.ent];
      if (tu && tu.type === 'turret') {
        noteAxisWriter(tu, '사격허가', ctrl);
        tu.fireOk = truthy(readIn(g, n, 0)); tu.logicForced = true; tu.fFire = true;
      }
      break;
    }
    case 'lamp': {
      // HUD 는 이름으로 중복을 지운다 — 기본 이름이 같으면 두 번째부터 화면에서
      // 사라진다. 이름을 안 적었으면 노드 번호로 구분한다.
      if (truthy(readIn(g, n, 0))) alarms.push(String(n.cfg.label || ('경보 #' + n.nid)));
      break;
    }
    case 'display': {
      displays.push({ label: String(n.cfg.label || ('값 #' + n.nid)), value: readIn(g, n, 0) });
      break;
    }
  }
}

// 제어기 하나 평가
// 같은 틱에 같은 축을 두 제어기가 쓰면 나중에 평가된 쪽이 이긴다. 그 자체는
// 결정적이지만 플레이어에게는 설명 불가능한 현상이라(한쪽 회로가 통째로 무시된
// 것처럼 보인다) 사실을 기록해 인스펙터에 드러낸다.
function noteAxisWriter(target, axis, ctrl) {
  if (!target || !ctrl) return;
  var prev = target.axisBy && target.axisBy[axis];
  if (prev && prev !== ctrl.id) {
    target.logicConflict = axis + ': 제어기 #' + prev + ' 와 #' + ctrl.id +
                           ' 가 동시에 지배 — 나중에 평가된 #' + ctrl.id + ' 가 이긴다';
  }
  if (!target.axisBy) target.axisBy = {};
  target.axisBy[axis] = ctrl.id;
}

function stepController(e, dt) {
  var g = e.graph;
  if (!g) return;
  // 전력은 보지 않는다 — 제어기는 전기를 쓰지 않는다(05_data.js 의 주석 참고).
  if (!e.enabled) { e.lastEval = null; return; }
  if (g.dirty || !g.order) graphCompile(g);
  // 직전 값 저장 — 피드백 간선이 읽는다
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    for (var p = 0; p < n.out.length; p++) n.prev[p] = n.out[p];
  }
  for (var k = 0; k < g.order.length; k++) {
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
  }
  e.lastEval = { nodes: g.nodes.length, links: g.links.length, cycles: g.cycles || 0 };
}

// 매 틱: logicForced 를 먼저 지우고 모든 제어기를 돌린다.
// 지우지 않으면 제어 노드를 삭제해도 기계가 영원히 꺼진 채로 남는다 (유령 지배).
function stepLogic(dt) {
  alarms.length = 0;
  displays.length = 0;
  forEachEntity(function (e) {
    e.logicForced = false; e.fEnable = false; e.fGate = false; e.fFilter = false; e.fFire = false;
    // 이번 틱에 이 축을 쓴 제어기가 누구인지 기억한다. 둘이 겹치면 나중에 평가된
    // 쪽이 조용히 이겨서, 한쪽 회로가 통째로 무시당하는 것처럼 보인다.
    e.axisBy = null; e.logicConflict = null;
  });
  forEachEntity(function (e) {
    if (e.type === 'controller') guard('controller#' + e.id, function () { stepController(e, dt); });
  });
  // 지배가 풀린 대상은 플레이어의 의사로 되돌린다.
  // 되돌리지 않으면 제어 노드를 지운 뒤에도 기계가 영원히 꺼진 채 남는다(유령 지배).
  // 축(가동/게이트/필터/사격)마다 따로 본다 — 게이트만 지배당한 벨트의 enabled 까지
  // 묶어서 판정하면 엉뚱한 축이 고정된다.
  forEachEntity(function (e) {
    if (!e.fEnable) e.enabled = (e.playerEnabled !== false);
    if (e.cells && !e.fGate) { for (var c = 0; c < e.cells.length; c++) e.cells[c].gate = true; }
    if (e.type === 'inserter' && !e.fFilter) e.filter = e.playerFilter || null;
    if (e.type === 'turret' && !e.fFire) e.fireOk = true;
  });
  logicDirty = false;
}
