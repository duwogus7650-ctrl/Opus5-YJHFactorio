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
  curCtrl = e;
  logicOpen = true;
  if (!e.graph) e.graph = newGraph();
  document.getElementById('logic').style.display = 'block';
  document.getElementById('ctrlName').textContent = '#' + e.id;
  tutorial.flags.openedEditor = true;    // 상태로는 못 보는 사건이라 여기서 표시한다
  renderPalette();
  renderGraph();
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(updateLive, 140);
}
function closeLogic() {
  logicOpen = false;
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
  var inner = document.getElementById('graphInner');
  if (!inner || !curCtrl) return;
  var g = curCtrl.graph;
  // 기존 노드 DOM 제거 (svg 는 남긴다)
  var old = inner.querySelectorAll('.node');
  for (var i = 0; i < old.length; i++) inner.removeChild(old[i]);

  for (var n = 0; n < g.nodes.length; n++) buildNodeDom(inner, g, g.nodes[n]);
  applyPan();
  updateLinks();
  document.getElementById('cycleInfo').textContent =
    g.nodes.length + '노드 · ' + g.links.length + '배선' + (g.cycles ? ' · 되먹임 ' + g.cycles + '개(1틱 지연)' : '');
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
        op.value = cf.opts[o]; op.textContent = cf.opts[o];
        if (n.cfg[cf.k] === cf.opts[o]) op.selected = true;
        sel.appendChild(op);
      }
      sel.onchange = (function (node, key, el2) { return function () { node.cfg[key] = el2.value; }; })(n, cf.k, sel);
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
    var pr = document.createElement('div'); pr.className = 'port';
    var dot = document.createElement('div'); dot.className = 'dot';
    dot.setAttribute('data-in', String(pi));
    var nm = document.createElement('span'); nm.textContent = d.ins[pi];
    pr.appendChild(dot); pr.appendChild(nm);
    cin.appendChild(pr);
  }
  var cout = document.createElement('div'); cout.className = 'pcol o';
  for (var po = 0; po < d.outs.length; po++) {
    var pr2 = document.createElement('div'); pr2.className = 'port';
    var dot2 = document.createElement('div'); dot2.className = 'dot';
    dot2.setAttribute('data-out', String(po));
    var nm2 = document.createElement('span'); nm2.textContent = d.outs[po];
    var pv = document.createElement('span'); pv.className = 'pv'; pv.setAttribute('data-pv', n.nid + ':' + po);
    pv.textContent = '0';
    pr2.appendChild(dot2); pr2.appendChild(nm2); pr2.appendChild(pv);
    cout.appendChild(pr2);
  }
  ports.appendChild(cin); ports.appendChild(cout);
  bodyEl.appendChild(ports);
  el.appendChild(bodyEl);
  inner.appendChild(el);

  // --- 상호작용 ---
  head.querySelector('.x').onclick = function (ev) {
    ev.stopPropagation();
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
      updateLinks();
    }
    function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  var outs = el.querySelectorAll('[data-out]');
  for (var k = 0; k < outs.length; k++) {
    outs[k].onmousedown = (function (nid, port) {
      return function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        linking = { nid: nid, port: port };
      };
    })(n.nid, parseInt(outs[k].getAttribute('data-out'), 10));
  }
  var ins = el.querySelectorAll('[data-in]');
  for (var m = 0; m < ins.length; m++) {
    ins[m].onmouseup = (function (nid, port) {
      return function (ev) {
        ev.stopPropagation();
        if (linking) {
          if (!graphLink(curCtrl.graph, linking.nid, linking.port, nid, port)) toast('자기 자신에는 연결할 수 없다', 'bad');
          linking = null; renderGraph();
        }
      };
    })(n.nid, parseInt(ins[m].getAttribute('data-in'), 10));
    ins[m].onclick = (function (nid, port) {
      return function (ev) {
        ev.stopPropagation();
        if (linking) return;
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
      if (el) el.textContent = fmt(n.out[p], 1);
    }
  }
  // 활성 배선 강조
  var dots = document.querySelectorAll('.dot[data-out]');
  for (var k = 0; k < dots.length; k++) {
    var host = dots[k].closest ? dots[k].closest('.node') : null;
    if (!host) continue;
    var nid = parseInt(host.getAttribute('data-nid'), 10);
    var nn = graphNode(g, nid);
    var port = parseInt(dots[k].getAttribute('data-out'), 10);
    if (nn && truthy(nn.out[port])) dots[k].classList.add('on'); else dots[k].classList.remove('on');
  }
  document.getElementById('cycleInfo').textContent =
    g.nodes.length + '노드 · ' + g.links.length + '배선' + (g.cycles ? ' · 되먹임 ' + g.cycles + '개(1틱 지연)' : '');
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
