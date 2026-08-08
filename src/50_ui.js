// ===========================================================================
//  50_ui.js — 창고/연구/손조립, 건설 도구, 입력, HUD 패널, 미니맵, 인스펙터
// ===========================================================================

var inventory = {};
var techDone = {};
var currentResearch = null;
var researchProgress = 0;

function researchFrac() {
  if (!currentResearch) return 0;
  return clamp(researchProgress / techCycles(currentResearch), 0, 1);
}
function addResearchProgress(n) {
  if (!currentResearch) return;
  researchProgress += n;
  if (researchProgress >= techCycles(currentResearch)) finishResearch();
}
function techAvailable(tid) {
  if (techDone[tid]) return false;
  var need = TECHS[tid].needs;
  for (var i = 0; i < need.length; i++) if (!techDone[need[i]]) return false;
  return true;
}
function startResearch(tid) {
  if (!techAvailable(tid)) return false;
  currentResearch = tid; researchProgress = 0;
  markPowerDirty();
  toast('연구 시작: ' + TECHS[tid].name, 'good');
  renderTech();
  return true;
}
function finishResearch() {
  var tid = currentResearch;
  if (!tid) return;
  techDone[tid] = true;
  currentResearch = null; researchProgress = 0;
  if (tid === 'belt-2') beltSpeedMul = 2;
  if (tid === 'automation-2') { machineSpeedMul = 1.5; machinePowerMul = 0.8; }
  toast('연구 완료: ' + TECHS[tid].name + ' — ' + TECHS[tid].unlock.join(', '), 'good');
  markPowerDirty(); markLogicDirty();
  renderBuildList(); renderTech(); renderCraftList();
  if (logicOpen) renderPalette();
}

// --- 손 조립 -----------------------------------------------------------------
function canHandCraft(rid) {
  var r = RECIPES[rid];
  if (!r || !r.handOk) return false;
  if (r.tech && !techDone[r.tech]) return false;
  for (var k in r.inp) if ((inventory[k] || 0) < r.inp[k]) return false;
  return true;
}
function handCraft(rid) {
  if (!canHandCraft(rid)) { toast('재료가 부족하다', 'bad'); return false; }
  var r = RECIPES[rid];
  for (var k in r.inp) inventory[k] -= r.inp[k];
  for (var o in r.out) inventory[o] = (inventory[o] || 0) + r.out[o];
  handCraftCount++;
  return true;
}
var handCraftCount = 0;

// --- 토스트 ------------------------------------------------------------------
function toast(msg, kind) {
  var host = document.getElementById('toast');
  if (!host) return;
  var d = document.createElement('div');
  d.className = 'tmsg' + (kind ? ' ' + kind : '');
  d.textContent = msg;
  host.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3600);
  while (host.children.length > 5) host.removeChild(host.firstChild);
}

// --- 건설 도구 ---------------------------------------------------------------
var tool = null;          // 건물 type
var toolDir = 1;          // 동쪽
var hoverT = { x: -1, y: -1 };
var selected = null;      // 선택된 엔티티 id
var pickMode = null;      // 제어기 노드가 지도에서 대상을 고르는 중

function selectTool(t) {
  if (t && BUILDINGS[t].tech && !techDone[BUILDINGS[t].tech]) {
    toast(TECHS[BUILDINGS[t].tech].name + ' 연구가 필요하다', 'bad'); return;
  }
  tool = t; selected = null; hideInsp();
  renderBuildList();
}

function tryPlace(tx, ty) {
  if (!tool) return false;
  var e = placeEntity(tool, tx, ty, toolDir, false);
  if (!e) {
    var chk = canPlace(tool, tx, ty, toolDir);
    var why = chk.why;
    // 재료가 모자란 경우에는 "어디서 얻는지"까지 함께 말한다.
    // 부족하다고만 하면 플레이어가 그 자리에서 막힌다 (회로기판이 실제로 그랬다).
    if (chk.missing) {
      var how = howToGet(chk.missing);
      if (how) why += ' — ' + how;
    }
    if (why && placeFailMsg !== why) { toast(why, 'bad'); placeFailMsg = why; placeFailT = gameTime; }
    return false;
  }
  placeFailMsg = null;
  renderInv();
  return true;
}
var placeFailMsg = null, placeFailT = 0;

// --- 입력 --------------------------------------------------------------------
var mouse = { x: 0, y: 0, down: false, rdown: false, dragged: false, sx: 0, sy: 0 };
var dragLast = null;
var keys = {};

function bindInput(canvas) {
  canvas.addEventListener('mousemove', function (ev) {
    var r = canvas.getBoundingClientRect();
    mouse.x = ev.clientX - r.left; mouse.y = ev.clientY - r.top;
    var w = worldOf(mouse.x, mouse.y);
    hoverT.x = Math.floor(w.x); hoverT.y = Math.floor(w.y);
    if (mouse.rdown) {
      var dx = ev.movementX || 0, dy = ev.movementY || 0;
      if (Math.abs(dx) + Math.abs(dy) > 0) mouse.dragged = true;
      cam.x -= dx / (TILE * cam.z); cam.y -= dy / (TILE * cam.z);
      clampCam(); refreshHover();
    } else if (mouse.down && tool) {
      dragPlace();
    }
  });
  canvas.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    if (ev.button === 2) { mouse.rdown = true; mouse.dragged = false; return; }
    if (ev.button !== 0) return;
    mouse.down = true;
    if (pickMode) { doPick(); return; }
    if (tool) { dragLast = null; dragPlace(); }
    else { pickEntity(); }
  });
  window.addEventListener('mouseup', function (ev) {
    if (ev.button === 2) {
      if (mouse.rdown && !mouse.dragged) rightClickAction();
      mouse.rdown = false; return;
    }
    mouse.down = false; dragLast = null;
  });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var before = worldOf(mouse.x, mouse.y);
    cam.z = clamp(cam.z * (ev.deltaY < 0 ? 1.14 : 1 / 1.14), 0.35, 2.6);
    var after = worldOf(mouse.x, mouse.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    clampCam(); refreshHover();
  }, { passive: false });

  window.addEventListener('keydown', function (ev) {
    // 입력 요소에 포커스가 있으면 게임 단축키로 먹지 않는다.
    // (인스펙터의 <select> 를 키보드로 고르다 'd' 를 누르면 카메라가 움직이고
    //  't' 를 누르면 연구창이 열렸다.)
    // ev.target 을 먼저 본다 — 실제로 타이핑 중이면 키 이벤트의 표적이 그 요소다.
    // document.activeElement 만 보면 창이 포커스를 잃은 상황에서 판정이 어긋난다.
    var ae = ev.target || document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName || '') && ev.key !== 'Escape') return;
    keys[ev.key.toLowerCase()] = true;
    var k = ev.key;
    if (k === 'Escape') {
      if (pickMode) { cancelPick(); return; }
      if (logicOpen) { closeLogic(); return; }
      if (document.getElementById('tech').style.display === 'block') { closeTech(); return; }
      if (document.getElementById('help').style.display === 'block') { closeHelp(); return; }
      tool = null; selected = null; hideInsp(); renderBuildList(); return;
    }
    if (logicOpen) return;
    // 저장/불러오기 — 버튼과 같은 동작. F5(새로고침)·Ctrl+S 처럼 브라우저가 가져가는
    // 키는 피한다. 진입점이 없으면 저장 기능은 있어도 없는 것과 같다.
    if (k === 'F2') { ev.preventDefault(); saveGame(); return; }
    if (k === 'F3') { ev.preventDefault(); loadGame(); return; }
    if (k === 'r' || k === 'R') { toolDir = dirCW(toolDir); return; }
    if (k === 't' || k === 'T') { toggleTech(); return; }
    if (k === 'h' || k === 'H' || k === '?') { toggleHelp(); return; }
    if (k === 'p' || k === 'P') { showPollution = !showPollution; return; }
    if (k === 'q' || k === 'Q') { pipetteTool(); return; }
    // 단축키는 건물에 **고정**돼 있다 (BUILDINGS[].hotkey).
    // 예전엔 "잠긴 것을 뺀 목록의 순서"로 매겼는데, 연구로 새 건물이 열리면
    // 번호가 통째로 밀려서 3=채광기를 외운 사람이 물류학을 연구하는 순간
    // 3=인서터가 됐다. 손에 익은 번호가 바뀌면 안 된다.
    if (k >= '0' && k <= '9') {
      var hit = buildIdForKey(k);
      if (hit) selectTool(hit);
    }
  });
  window.addEventListener('keyup', function (ev) { keys[ev.key.toLowerCase()] = false; });
  window.addEventListener('resize', function () { resizeCanvas(); });
}

function clampCam() {
  cam.x = clamp(cam.x, 4, W - 4);
  cam.y = clamp(cam.y, 4, H - 4);
}

// 커서 아래 타일을 화면 좌표에서 다시 계산한다.
// 카메라가 움직이면 마우스는 그대로여도 가리키는 타일이 바뀐다 — 이걸 안 갱신하면
// WASD 로 이동한 뒤 클릭이 엉뚱한 칸에 들어간다.
function refreshHover() {
  if (!cv) return;
  var w = worldOf(mouse.x, mouse.y);
  hoverT.x = Math.floor(w.x); hoverT.y = Math.floor(w.y);
}

function stepCameraKeys(dt) {
  if (logicOpen && !pickMode) return;      // 대상 지정 중에는 지도를 움직일 수 있어야 한다
  var sp = 22 / cam.z * dt;
  var moved = false;
  if (keys['w'] || keys['arrowup']) { cam.y -= sp; moved = true; }
  if (keys['s'] || keys['arrowdown']) { cam.y += sp; moved = true; }
  if (keys['a'] || keys['arrowleft']) { cam.x -= sp; moved = true; }
  if (keys['d'] || keys['arrowright']) { cam.x += sp; moved = true; }
  if (moved) { clampCam(); refreshHover(); }
}

// 드래그 배치 — 벨트는 이동 방향으로 자동 회전한다 (공장 게임의 기본 손맛)
function dragPlace() {
  var tx = hoverT.x, ty = hoverT.y;
  if (!inBounds(tx, ty)) return;
  if (dragLast && dragLast.x === tx && dragLast.y === ty) return;
  if (dragLast && (tool === 'belt')) {
    var dx = tx - dragLast.x, dy = ty - dragLast.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      for (var d = 0; d < 4; d++) if (DIR_DX[d] === dx && DIR_DY[d] === dy) toolDir = d;
      // 직전 칸의 벨트도 새 방향으로 돌려준다 — 코너가 자연스럽게 이어진다
      var prev = entityAt(dragLast.x, dragLast.y);
      if (prev && prev.type === 'belt') { prev.dir = toolDir; prev.cells[0].dir = toolDir; markBeltDirty(); }
    }
  }
  if (tryPlace(tx, ty)) dragLast = { x: tx, y: ty };
  else if (entityAt(tx, ty)) dragLast = { x: tx, y: ty };
}

function pickEntity() {
  var e = entityAt(hoverT.x, hoverT.y);
  if (!e) { selected = null; hideInsp(); return; }
  if (e.type === 'controller') { openLogic(e); return; }
  selected = e.id;
  showInsp(e);
}
function rightClickAction() {
  // 대상 지정 중의 우클릭은 "취소"다. 철거로 동작하면 지정하려던 건물을 부수게 된다.
  if (pickMode) { cancelPick(); return; }
  if (tool) { tool = null; renderBuildList(); return; }
  var e = entityAt(hoverT.x, hoverT.y);
  if (e) {
    if (selected === e.id) { selected = null; hideInsp(); }
    removeEntity(e.id, true);
    renderInv();
    return;
  }
  if (inBounds(hoverT.x, hoverT.y) && world.tree[idx(hoverT.x, hoverT.y)]) {
    world.tree[idx(hoverT.x, hoverT.y)] = 0;
    treeCensusDone = false;
  }
}
function pipetteTool() {
  var e = entityAt(hoverT.x, hoverT.y);
  if (e && BUILDINGS[e.type]) { selectTool(e.type); toolDir = e.dir; }
}

// --- 지도에서 대상 고르기 (제어기 노드용) --------------------------------------
function startPick(ctrlId, nid, key, filter) {
  pickMode = { ctrl: ctrlId, nid: nid, key: key, filter: filter || null };
  document.getElementById('logic').style.display = 'none';
  document.getElementById('pickBanner').style.display = 'block';
}
function cancelPick() {
  pickMode = null;
  document.getElementById('pickBanner').style.display = 'none';
  if (logicOpen) document.getElementById('logic').style.display = 'block';
}
// 지정 중이던 제어기가 철거되면 지정 모드도 접는다 (25_entity.js 가 부른다)
function cancelPickIfTarget(id) {
  if (pickMode && pickMode.ctrl === id) cancelPick();
}
function doPick() {
  var e = entityAt(hoverT.x, hoverT.y);
  if (!e) { toast('그 자리엔 아무것도 없다', 'bad'); return; }
  if (pickMode.filter && pickMode.filter.indexOf(e.type) < 0) {
    toast(pickMode.filter.map(function (t) { return BUILDINGS[t].name; }).join('/') + ' 만 지정할 수 있다', 'bad');
    return;
  }
  var ctrl = entities[pickMode.ctrl];
  if (ctrl && ctrl.graph) {
    var n = graphNode(ctrl.graph, pickMode.nid);
    if (n) { n.cfg[pickMode.key] = e.id; ctrl.graph.dirty = true; }
  }
  var save = pickMode; pickMode = null;
  document.getElementById('pickBanner').style.display = 'none';
  if (logicOpen) { document.getElementById('logic').style.display = 'block'; renderGraph(); }
  void save;
}

// --- 오버레이 (월드 좌표계에서 그린다) ----------------------------------------
function drawOverlays() {
  // 전주 공급구역
  if (tool === 'pole' || (selected && entities[selected] && entities[selected].type === 'pole')) {
    ctx.fillStyle = 'rgba(240,169,43,0.09)';
    ctx.strokeStyle = 'rgba(240,169,43,0.4)'; ctx.lineWidth = 0.05;
    forEachEntity(function (e) {
      if (e.type !== 'pole') return;
      var S = SPEC.poleSupply;
      ctx.fillRect(e.tx - S, e.ty - S, S * 2 + 1, S * 2 + 1);
    });
    if (tool === 'pole' && inBounds(hoverT.x, hoverT.y)) {
      var S2 = SPEC.poleSupply;
      ctx.strokeRect(hoverT.x - S2, hoverT.y - S2, S2 * 2 + 1, S2 * 2 + 1);
    }
  }
  // 선택 강조 + 인서터/터렛 보조선
  if (selected && entities[selected]) {
    var se = entities[selected];
    ctx.strokeStyle = COL.amber; ctx.lineWidth = 0.08;
    ctx.strokeRect(se.tx - 0.05, se.ty - 0.05, se.w + 0.1, se.h + 0.1);
    if (se.type === 'inserter') {
      var s1 = inserterSource(se), t1 = inserterTarget(se);
      ctx.fillStyle = 'rgba(217,84,74,0.30)'; ctx.fillRect(s1.x, s1.y, 1, 1);
      ctx.fillStyle = 'rgba(73,192,90,0.30)'; ctx.fillRect(t1.x, t1.y, 1, 1);
    }
    if (se.type === 'turret') {
      ctx.strokeStyle = 'rgba(217,84,74,0.45)'; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(se.tx + 1, se.ty + 1, SPEC.turretRange, 0, 6.283); ctx.stroke();
    }
  }
  // 배치 미리보기
  if (tool && inBounds(hoverT.x, hoverT.y)) {
    var B = BUILDINGS[tool];
    var w = B.w, h = B.h;
    if (B.rot && (toolDir === 1 || toolDir === 3) && w !== h) { var t = w; w = h; h = t; }
    var ok = canPlace(tool, hoverT.x, hoverT.y, toolDir).ok;
    ctx.fillStyle = ok ? 'rgba(73,192,90,0.26)' : 'rgba(217,84,74,0.30)';
    ctx.fillRect(hoverT.x, hoverT.y, w, h);
    ctx.strokeStyle = ok ? '#49c05a' : '#d9544a'; ctx.lineWidth = 0.06;
    ctx.strokeRect(hoverT.x, hoverT.y, w, h);
    if (B.rot) drawArrow(hoverT.x, hoverT.y, w, h, toolDir, '#ffffff');
    if (tool === 'turret') {
      ctx.strokeStyle = 'rgba(217,84,74,0.35)'; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.arc(hoverT.x + 1, hoverT.y + 1, SPEC.turretRange, 0, 6.283); ctx.stroke();
    }
  }
  // 커서 타일
  if (!tool && inBounds(hoverT.x, hoverT.y)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.04;
    ctx.strokeRect(hoverT.x + 0.02, hoverT.y + 0.02, 0.96, 0.96);
  }
}

// --- HUD ---------------------------------------------------------------------
// 숫자 키 → 건물. 잠금 여부와 무관하게 항상 같은 건물을 가리킨다.
function buildIdForKey(k) {
  for (var i = 0; i < BUILD_IDS.length; i++) {
    if (BUILDINGS[BUILD_IDS[i]].hotkey === k) return BUILD_IDS[i];
  }
  return null;
}

function visibleBuildIds() {
  return BUILD_IDS.filter(function (b) {
    var B = BUILDINGS[b];
    return !B.tech || techDone[B.tech];
  });
}
function costStr(cost) {
  var s = [];
  for (var k in cost) s.push(cost[k] + ITEMS[k].name.slice(0, 2));
  return s.join(' ');
}
function renderBuildList() {
  var host = document.getElementById('buildList');
  if (!host) return;
  var html = [];
  for (var i = 0; i < BUILD_IDS.length; i++) {
    var id = BUILD_IDS[i], B = BUILDINGS[id];
    var locked = B.tech && !techDone[B.tech];
    var key = B.hotkey || '';   // 고정 — 연구를 해도 번호가 밀리지 않는다
    var poor = false;
    for (var k in B.cost) if ((inventory[k] || 0) < B.cost[k]) poor = true;
    html.push('<div class="bitem' + (tool === id ? ' sel' : '') + (locked ? ' locked' : '') +
      (poor ? ' poor' : '') + '" data-b="' + id + '" title="' + B.desc + '">' +
      '<span class="bkey">' + key + '</span>' +
      '<span class="bn">' + B.name + '</span>' +
      '<span class="bc">' + (locked ? '🔒' : costStr(B.cost)) + '</span></div>');
  }
  host.innerHTML = html.join('');
  var items = host.querySelectorAll('.bitem');
  for (var j = 0; j < items.length; j++) {
    items[j].onclick = (function (bid) { return function () { selectTool(bid); }; })(items[j].getAttribute('data-b'));
  }
}

function renderInv() {
  var host = document.getElementById('invList');
  if (!host) return;
  var html = [];
  for (var i = 0; i < ITEM_IDS.length; i++) {
    var k = ITEM_IDS[i];
    var q = inventory[k] || 0;
    if (!q) continue;
    html.push('<div class="irow"><span class="n">' + ITEMS[k].name + '</span><span class="q">' + q + '</span></div>');
  }
  host.innerHTML = html.join('') || '<div class="irow"><span class="n">비어 있음</span></div>';
}

function renderCraftList() {
  var host = document.getElementById('craftList');
  if (!host) return;
  var html = [];
  for (var i = 0; i < RECIPE_IDS.length; i++) {
    var rid = RECIPE_IDS[i], r = RECIPES[rid];
    if (!r.handOk) continue;
    if (r.tech && !techDone[r.tech]) continue;
    var ok = canHandCraft(rid);
    var inp = [];
    for (var k in r.inp) inp.push(r.inp[k] + '×' + ITEMS[k].name.slice(0, 3));
    var outN = 0; for (var o in r.out) outN = r.out[o];
    html.push('<div class="craftbtn' + (ok ? '' : ' no') + '" data-r="' + rid + '">' +
      '<span>' + ITEMS[Object.keys(r.out)[0]].name + (outN > 1 ? ' ×' + outN : '') + '</span>' +
      '<span class="dim" style="font-size:10px">' + inp.join(' ') + '</span></div>');
  }
  host.innerHTML = html.join('');
  var btns = host.querySelectorAll('.craftbtn');
  for (var j = 0; j < btns.length; j++) {
    btns[j].onclick = (function (rid) {
      return function () { if (handCraft(rid)) { renderInv(); renderCraftList(); renderBuildList(); } };
    })(btns[j].getAttribute('data-r'));
  }
}

function renderTop() {
  var host = document.getElementById('top');
  if (!host) return;
  var satPct = Math.round(powerStats.sat * 100);
  var satCls = satPct >= 99 ? 'okv' : (satPct >= 70 ? 'warnv' : 'badv');
  var evoPct = Math.round(evolution * 100);
  var threat = enemyThreatLevel();
  var res = currentResearch
    ? TECHS[currentResearch].name.split(' ')[0] + ' ' + Math.round(researchFrac() * 100) + '%'
    : '없음';
  var pollTot = 0;
  for (var i = 0; i < world.poll.length; i++) pollTot += world.poll[i];
  host.innerHTML =
    stat('시간', fmtTime(gameTime)) +
    stat('전력', satPct + '%', satCls, Math.round(powerStats.supply) + ' / ' + Math.round(powerStats.demand) + ' kW') +
    stat('오염', fmtShort(pollTot), pollTot > 60 ? 'warnv' : '') +
    stat('진화도', evoPct + '%', evoPct > 55 ? 'badv' : (evoPct > 25 ? 'warnv' : '')) +
    stat('적', String(enemies.length), threat > 0 ? 'badv' : '', '접근 ' + threat) +
    stat('연구', res, currentResearch ? 'okv' : 'warnv') +
    stat('손실', String(waveStats.buildingsLost), waveStats.buildingsLost ? 'badv' : '');
  // 라벨은 판에 각인, 값은 판에 박힌 계기창(well) 안에서 빛난다 — 이 UI 의 시그니처
  function stat(k, v, cls, sub) {
    return '<div class="stat" title="' + (sub || '') + '"><span class="k">' + k + '</span>' +
      '<span class="v well ' + (cls || '') + '">' + v + '</span></div>';
  }
}

function renderAlarms() {
  var a = document.getElementById('alarms');
  var uniq = {};
  for (var i = 0; i < alarms.length; i++) uniq[alarms[i]] = 1;
  var ks = Object.keys(uniq);
  a.innerHTML = ks.map(function (m) { return '<div class="alarm">⚠ ' + m + '</div>'; }).join('');
  var d = document.getElementById('dispRow');
  d.style.top = ks.length ? '100px' : '70px';
  var seen = {}, out = [];
  for (var j = 0; j < displays.length; j++) {
    var it = displays[j];
    if (seen[it.label]) continue;
    seen[it.label] = 1;
    out.push('<div class="disp">' + it.label + ' <b>' + fmt(it.value, 1) + '</b></div>');
  }
  d.innerHTML = out.join('');
}

// --- 인스펙터 ----------------------------------------------------------------
var lastInspSig = null;
function hideInsp() {
  document.getElementById('insp').style.display = 'none';
  lastInspSig = null;
}
function showInsp(e) {
  var p = document.getElementById('insp');
  document.getElementById('inspTitle').textContent = BUILDINGS[e.type].name + ' #' + e.id;
  p.style.display = 'block';
  lastInspSig = null;
  refreshInsp();
}

// 조작 요소(<select>·버튼)의 구성이 바뀌었는지를 나타내는 지문.
// 이게 같으면 조작 영역을 다시 그리지 않는다 — 0.2초마다 innerHTML 을 갈아엎으면
// 사용자가 열어 둔 드롭다운이 강제로 닫혀 레시피를 아예 고를 수 없었다.
function inspSignature(e) {
  return [e.id, e.type, e.recipe, e.playerFilter, e.outPrio,
          e.playerEnabled === false ? 0 : 1, e.logicForced ? 1 : 0,
          (inventory['coal'] || 0) > 0 ? 1 : 0,
          Object.keys(techDone).length].join('|');
}

function refreshInsp() {
  var p = document.getElementById('insp');
  if (p.style.display !== 'block') return;
  var e = entities[selected];
  if (!e) { hideInsp(); return; }
  var b = document.getElementById('inspBody');
  var B = BUILDINGS[e.type];

  // --- 조작 영역: 지문이 바뀔 때만 재생성 -----------------------------------
  var sig = inspSignature(e);
  if (sig !== lastInspSig) {
    lastInspSig = sig;
    var c = [];
    c.push('<div class="dim" style="font-size:11px;margin-bottom:6px">' + B.desc + '</div>');
    if (e.type === 'assembler') {
      c.push('<div class="frow"><label>레시피</label><select id="recSel"><option value="">— 없음 —</option>' +
        RECIPE_IDS.filter(function (r) {
          return RECIPES[r].cat === 'craft' && (!RECIPES[r].tech || techDone[RECIPES[r].tech]);
        }).map(function (r) {
          return '<option value="' + r + '"' + (e.recipe === r ? ' selected' : '') + '>' +
            ITEMS[Object.keys(RECIPES[r].out)[0]].name + ' (' + RECIPES[r].time + 's)</option>';
        }).join('') + '</select></div>');
    }
    if (e.type === 'furnace' && e.recipe) {
      c.push('<div class="frow"><label>레시피</label><span class="num">' +
        ITEMS[Object.keys(RECIPES[e.recipe].out)[0]].name + '</span></div>');
    }
    if (e.type === 'inserter') {
      c.push('<div class="frow"><label>필터</label><select id="filSel"><option value="">— 없음 —</option>' +
        ITEM_IDS.map(function (i) {
          return '<option value="' + i + '"' + (e.playerFilter === i ? ' selected' : '') + '>' + ITEMS[i].name + '</option>';
        }).join('') + '</select></div>');
    }
    if (e.type === 'splitter') {
      c.push('<div class="frow"><label>출력우선</label><select id="prioSel">' +
        '<option value="">균등 분배</option><option value="0"' + (e.outPrio === 0 ? ' selected' : '') + '>왼쪽</option>' +
        '<option value="1"' + (e.outPrio === 1 ? ' selected' : '') + '>오른쪽</option></select></div>');
    }
    if (e.type === 'generator') {
      c.push('<button id="fuelBtn"' + ((inventory['coal'] || 0) < 1 ? ' disabled' : '') + '>석탄 10개 넣기</button>');
    }
    c.push('<div style="display:flex;gap:6px;margin-top:9px">' +
      '<button id="tglBtn">' + (e.playerEnabled === false ? '가동' : '정지') + '</button>' +
      '<button class="danger" id="delBtn">철거</button></div>');
    if (e.logicForced) {
      c.push('<div class="ok" style="font-size:11px;margin-top:5px">⛓ 제어기 지배 중 — 수동 조작은 지배가 풀린 뒤 적용된다</div>');
    }
    b.innerHTML = '<div id="inspStat"></div>' + c.join('');
    bindInspControls(e);
  }

  // --- 수치 영역: 매번 갱신 (조작 요소가 없어 안전) ---------------------------
  var s = [];
  if (B.power) {
    s.push('<div class="frow"><label>전력</label><span class="num" style="color:' +
      (e.powerSat > 0.99 ? 'var(--run)' : (e.powerSat > 0 ? 'var(--warn)' : 'var(--stop)')) + '">' +
      Math.round(e.powerSat * 100) + '% · ' + Math.round(B.power * machinePowerMul) + ' kW' +
      (e.net < 0 ? ' · <b class="bad">망 미연결</b>' : '') + '</span></div>');
  }
  s.push('<div class="frow"><label>체력</label><span class="num">' + Math.round(e.hp) + ' / ' + e.maxHp + '</span></div>');
  if (e.type === 'generator') {
    s.push('<div class="frow"><label>연료</label><span class="num">' + fmt(e.fuel / 1000, 1) + ' MJ · 부하 ' +
      Math.round((e.load || 0) * 100) + '% · 창고 석탄 ' + (inventory['coal'] || 0) +
      (e.net < 0 ? ' · <b class="bad">망 미연결</b>' : '') + '</span></div>');
  }
  if (e.type === 'turret') {
    s.push('<div class="frow"><label>탄약</label><span class="num">' + e.ammo + ' 발' +
      (e.fireOk ? '' : ' · <b class="bad">사격 금지</b>') + '</span></div>');
  }
  if (e.type === 'miner') {
    s.push('<div class="frow"><label>광맥</label><span class="num">' +
      (e.surveyed && e.surveyed.item
        ? ITEMS[e.surveyed.item].name + ' ' + fmtShort(surveyOre(e.tx, e.ty, e.w, e.h).total)
        : '없음') + (e.depleted ? ' · <b class="bad">고갈</b>' : '') + '</span></div>');
  }
  var inv = {};
  for (var k in e.inv) inv[k] = e.inv[k];
  for (var o in e.out) inv[o] = (inv[o] || 0) + e.out[o];
  if (Object.keys(inv).length) {
    s.push('<div class="frow" style="align-items:flex-start"><label>내용물</label><div class="chips">' +
      Object.keys(inv).map(function (i) { return '<span class="chip">' + ITEMS[i].name + ' ' + inv[i] + '</span>'; }).join('') +
      '</div></div>');
  }
  var statEl = document.getElementById('inspStat');
  if (statEl) statEl.innerHTML = s.join('');
}

function bindInspControls(e) {
  var rs = document.getElementById('recSel');
  if (rs) rs.onchange = function () {
    e.recipe = rs.value || null; e.progress = 0;
    // 레시피를 바꾸면 남은 입력은 창고로 — 안 그러면 영원히 안 쓰이는 재료가 갇힌다
    for (var kk in e.inv) inventory[kk] = (inventory[kk] || 0) + e.inv[kk];
    e.inv = {};
    markPowerDirty(); renderInv(); refreshInsp();
  };
  var fs = document.getElementById('filSel');
  if (fs) fs.onchange = function () { e.playerFilter = fs.value || null; e.filter = e.playerFilter; };
  var ps = document.getElementById('prioSel');
  if (ps) ps.onchange = function () { e.outPrio = ps.value === '' ? null : parseInt(ps.value, 10); };
  var fb = document.getElementById('fuelBtn');
  if (fb) fb.onclick = function () {
    var n = Math.min(10, inventory['coal'] || 0);
    if (n <= 0) return;
    inventory['coal'] -= n;
    e.fuel += SPEC.coalEnergy * n;
    renderInv(); refreshInsp();
  };
  document.getElementById('tglBtn').onclick = function () {
    e.playerEnabled = (e.playerEnabled === false);
    if (!e.logicForced) e.enabled = e.playerEnabled;
    markPowerDirty(); refreshInsp();
  };
  document.getElementById('delBtn').onclick = function () {
    removeEntity(e.id, true); selected = null; hideInsp(); renderInv(); renderBuildList();
  };
}

// --- 연구 패널 ---------------------------------------------------------------
function toggleTech() {
  var t = document.getElementById('tech');
  t.style.display = t.style.display === 'block' ? 'none' : 'block';
  if (t.style.display === 'block') renderTech();
}
function closeTech() { document.getElementById('tech').style.display = 'none'; }
function renderTech() {
  var body = document.getElementById('techBody');
  if (!body) return;
  var h = [];
  h.push('<div class="dim" style="font-size:11.5px;margin-bottom:8px">' +
    '연구소가 연구팩을 소비해 진행한다. 한 사이클마다 표시된 팩을 각각 1개씩 먹는다.</div>');
  for (var i = 0; i < TECH_IDS.length; i++) {
    var tid = TECH_IDS[i], T = TECHS[tid];
    var done = !!techDone[tid], avail = techAvailable(tid);
    var cls = done ? 'done' : (avail ? '' : 'locked');
    var cost = Object.keys(T.cost).map(function (k) { return T.cost[k] + '× ' + ITEMS[k].name.replace(' 연구팩', ''); }).join(' + ');
    var prog = (currentResearch === tid) ? ' — 진행 ' + Math.round(researchFrac() * 100) + '%' : '';
    h.push('<div class="trow ' + cls + '"><div class="tn"><b>' + T.name + '</b>' + prog +
      '<div class="td">' + T.desc + ' <span class="lnk">해제: ' + T.unlock.join(', ') + '</span>' +
      (T.needs.length ? ' <span class="dim">· 선행: ' + T.needs.map(function (n) { return TECHS[n].name; }).join(', ') + '</span>' : '') +
      '</div></div><div class="tcost">' + cost + '</div>' +
      (done ? '<span class="ok">완료</span>'
        : (avail ? '<button data-t="' + tid + '" class="' + (currentResearch === tid ? '' : 'pri') + '">' +
          (currentResearch === tid ? '진행 중' : '시작') + '</button>' : '<span class="dim">잠김</span>')) +
      '</div>');
  }
  body.innerHTML = h.join('');
  var bs = body.querySelectorAll('button[data-t]');
  for (var j = 0; j < bs.length; j++) {
    bs[j].onclick = (function (tid) { return function () { startResearch(tid); }; })(bs[j].getAttribute('data-t'));
  }
}

// --- 도움말 ------------------------------------------------------------------
function toggleHelp() {
  var t = document.getElementById('help');
  t.style.display = t.style.display === 'block' ? 'none' : 'block';
}
function closeHelp() { document.getElementById('help').style.display = 'none'; }

function fillHelp() {
  document.getElementById('helpBody').innerHTML = [
    '<p>여기서 당신은 공장을 <b>짓는 사람</b>이 아니라 <b>공장의 제어계를 설계하는 사람</b>이다.',
    '벨트와 조립기는 다른 게임에도 있다. 이 게임에만 있는 것은 <b>제어기</b>다 —',
    '노드를 끌어다 배선해서 공장이 스스로 판단하게 만든다. 정답 배선은 없다.</p>',
    '<h4>조작</h4><ul>',
    '<li><code>WASD</code> / 방향키 — 이동 &nbsp; <code>휠</code> — 확대 &nbsp; <code>우클릭 드래그</code> — 화면 끌기</li>',
    '<li><code>좌클릭</code> — 배치 / 선택 &nbsp; <code>드래그</code> — 벨트 이어 깔기(방향 자동)</li>',
    '<li><code>우클릭</code> — 철거(자원 전액 환급) &nbsp; <code>R</code> — 회전 &nbsp; <code>Q</code> — 커서 아래 건물 복제</li>',
    '<li><code>1~0</code> — 건설 단축키 &nbsp; <code>T</code> — 연구 &nbsp; <code>P</code> — 오염 표시 &nbsp; <code>H</code> — 이 창</li>',
    '<li><code>F2</code> 저장 &nbsp; <code>F3</code> 불러오기 (창고 패널의 버튼과 같다). 저장 칸은 하나다.</li>',
    '<li><b>제어기를 좌클릭하면 노드 편집기가 열린다.</b></li>',
    '</ul>',
    '<h4>10분 안에 돌아가는 공장 만들기</h4><ul>',
    '<li>① <b>발전기</b>를 놓고 <b>전주</b>로 잇는다. 전주 5×5 안에 든 기계만 전기를 받는다.</li>',
    '<li>② <b>채광기</b>를 석탄 위에 놓고 벨트로 발전기까지 잇는다. 발전기에 넣는 건 <b>인서터</b>다.</li>',
    '<li>③ 철광석 채광기 → 벨트 → 인서터 → <b>용광로</b> → 인서터 → 벨트 → <b>상자</b>.</li>',
    '<li>④ <b>조립기</b>에 레시피를 걸고 <b>연구소</b>에 적색 연구팩을 넣으면 연구가 돈다.</li>',
    '<li>⑤ 오염이 퍼지면 <b>적</b>이 온다. 군수 연구 → <b>터렛</b>. 터렛은 탄창을 인서터로 넣어줘야 쏜다.</li>',
    '</ul>',
    '<h4>제어기 — 이 게임의 본체</h4>',
    '<p>제어기는 매 틱 노드 그래프를 한 번 평가한다. 되먹임(순환) 배선은 <b>직전 틱 값</b>을 읽는다.',
    '즉 실제 순차논리의 레지스터 한 단과 같다. 그래서 SR 래치·카운터·PID 를 그대로 배선할 수 있다.</p>',
    '<ul>',
    '<li><b>재고 히스테리시스</b> — 상자 재고가 50 미만이면 SET, 200 초과면 RESET 인 SR 래치를 만들어',
    '탄약 라인의 조립기를 켜고 끈다. 철을 탄약과 연구팩에 나눠 쓰는 문제가 저절로 풀린다.</li>',
    '<li><b>부하 차단</b> — 전력 만족도가 95% 아래로 떨어지면 우선순위가 낮은 라인을 먼저 끈다.',
    '발전기를 더 짓지 않고도 정전을 막는 정석적인 방법이다. <b>다만 순진하게 배선하면 발진한다</b> —',
    '끄면 만족도가 회복되고, 회복되면 즉시 켜지고, 켜면 다시 떨어진다. 실제 부하 차단은',
    '<code>SR 래치</code>로 차단 상태를 기억하고 복구는 <code>타이머</code>로 늦춘다.',
    '되먹임이 있는 제어를 짤 때 늘 만나는 문제이고, 이 게임에서 가장 배울 것이 많은 지점이다.</li>',
    '<li><b>방어 자동화</b> — 적 근접 센서가 적을 감지하면 생산 라인을 끄고 그 전력을 방어에 몰아준다.</li>',
    '</ul>',
    '<p class="dim">편집기의 <b>예제 불러오기</b>를 누르면 위 히스테리시스 회로가 배선된 채로 들어온다.',
    '한 번 보고 나면 나머지는 응용이다.</p>'
  // 공백으로 잇는다 — ''로 이으면 줄 끝과 다음 줄 첫 글자가 붙어 "만든다.정답 배선은"
  // 처럼 문장이 뭉개진다 (실제로 첫 화면에서 그렇게 보였다). HTML 은 여분 공백을 접는다.
  ].join(' ');
}

// --- 미니맵 ------------------------------------------------------------------
var miniT = 0;
function renderMini() {
  var c = document.getElementById('mini');
  if (!c) return;
  var g = c.getContext('2d');
  var sx = c.width / W, sy = c.height / H;
  g.fillStyle = '#141a14'; g.fillRect(0, 0, c.width, c.height);
  // 광맥
  for (var y = 0; y < H; y += 2) {
    for (var x = 0; x < W; x += 2) {
      var i = idx(x, y);
      if (world.oreAmt[i]) { g.fillStyle = ORE_COLOR[world.ore[i]]; g.fillRect(x * sx, y * sy, sx * 2, sy * 2); }
      else if (world.tree[i]) { g.fillStyle = '#22331b'; g.fillRect(x * sx, y * sy, sx * 2, sy * 2); }
    }
  }
  // 오염
  var C = SPEC.pollutionPerChunk;
  for (var py = 0; py < PH; py++) {
    for (var px = 0; px < PW; px++) {
      var v = world.poll[pidx(px, py)];
      if (v <= 0.05) continue;
      g.fillStyle = 'rgba(190,70,35,' + clamp(v * 0.10, 0, 0.5) + ')';
      g.fillRect(px * C * sx, py * C * sy, C * sx, C * sy);
    }
  }
  // 건물
  forEachEntity(function (e) {
    g.fillStyle = e.type === 'belt' || e.type === 'splitter' ? '#8a8f96'
      : (e.type === 'turret' ? '#d9544a' : (e.type === 'controller' ? '#49c05a' : '#4a86c4'));
    g.fillRect(e.tx * sx, e.ty * sy, Math.max(1.4, e.w * sx), Math.max(1.4, e.h * sy));
  });
  // 둥지 / 적
  for (var n = 0; n < nests.length; n++) {
    g.fillStyle = '#8a5fc0';
    g.fillRect(nests[n].x * sx - 2, nests[n].y * sy - 2, 4, 4);
  }
  g.fillStyle = '#e05a8a';
  for (var k = 0; k < enemies.length; k++) g.fillRect(enemies[k].x * sx - 1, enemies[k].y * sy - 1, 2, 2);
  // 카메라 사각
  var vs = viewScale();
  var hw = cv.width / 2 / vs, hh = cv.height / 2 / vs;
  g.strokeStyle = '#f0a92b'; g.lineWidth = 1;
  g.strokeRect((cam.x - hw) * sx, (cam.y - hh) * sy, hw * 2 * sx, hh * 2 * sy);
}

function bindSaveButtons() {
  var sb = document.getElementById('saveBtn');
  var lb = document.getElementById('loadBtn');
  if (sb) sb.onclick = function () { saveGame(); };
  if (lb) lb.onclick = function () { loadGame(); };
}

function bindMini() {
  var c = document.getElementById('mini');
  c.addEventListener('mousedown', function (ev) {
    var r = c.getBoundingClientRect();
    cam.x = (ev.clientX - r.left) / r.width * W;
    cam.y = (ev.clientY - r.top) / r.height * H;
    clampCam(); refreshHover();
  });
}
