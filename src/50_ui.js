// ===========================================================================
//  50_ui.js — 창고/연구/손조립, 건설 도구, 입력, HUD 패널, 미니맵, 인스펙터
// ===========================================================================

var inventory = {};
var techDone = {};
var currentResearch = null;
var researchProgress = 0;
// **연구를 갈아타도 먹인 연구팩은 남는다.** 예전에는 갈아타는 순간 진행이 0 이 됐다 —
// 49/50 까지 간 연구를 놔두고 다른 걸 누르면 적팩 49 + 녹팩 49 가 경고 한 줄 없이
// 사라졌다. 클릭 한 번에 되돌릴 수 없는 손실이 나는 자리는 게임에 있으면 안 된다.
// 연구별로 따로 세어 두면 갈아탔다 돌아와도 이어서 한다.
var researchProgressBy = {};

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
  // **모르는 id 를 그냥 터뜨리면 안 된다.** 저장본이 손상됐거나 예전 판의 연구
  // id 가 남아 있으면 여기서 TypeError 가 나 게임이 통째로 멈춘다.
  if (!tid || !TECHS[tid]) return false;
  if (techDone[tid]) return false;
  var need = TECHS[tid].needs;
  for (var i = 0; i < need.length; i++) if (!techDone[need[i]]) return false;
  return true;
}
function startResearch(tid) {
  if (!techAvailable(tid)) return false;
  if (currentResearch) researchProgressBy[currentResearch] = researchProgress;   // 하던 것 보관
  currentResearch = tid;
  researchProgress = researchProgressBy[tid] || 0;                              // 하던 데서 이어간다
  markPowerDirty();
  toast('연구 시작: ' + TECHS[tid].name +
        (researchProgress > 0 ? ' (' + Math.round(researchProgress) + '개까지 이어서)' : ''), 'good');
  renderTech();
  return true;
}
function finishResearch() {
  var tid = currentResearch;
  if (!tid) return;
  techDone[tid] = true;
  delete researchProgressBy[tid];
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
// **손 조립에는 시간이 든다.** 예전에는 클릭 한 번에 즉시 완성이었다 — 조립기가
// 같은 것을 6.67초에 하나 만드는 동안 손으로는 초당 몇 개든 나왔고, 그러면
// "자동화할 이유"가 게임에서 사라진다. 이 장르의 전제 자체가 무너지는 자리다.
// 규약(Factorio 와 같다): 재료는 대기열에 넣는 즉시 빠지고, 완성품은 시간이 지나야
// 나온다. 대기열은 하나씩 순서대로 처리하므로 손은 언제나 "조립기 1대"가 최대다.
// 여러 대로 늘리려면 진짜 기계를 세워야 한다.
var handQueue = [];              // [{ rid, left }] — [0] 이 지금 만드는 것
var HAND_QUEUE_MAX = 100;
var handCraftCount = 0;          // **완성** 개수 (대기열에 넣은 수가 아니다)

function handCraft(rid) {
  if (!canHandCraft(rid)) { toast('재료가 부족하다', 'bad'); return false; }
  if (handQueue.length >= HAND_QUEUE_MAX) { toast('조립 대기열이 가득 찼다', 'bad'); return false; }
  var r = RECIPES[rid];
  for (var k in r.inp) inventory[k] -= r.inp[k];
  handQueue.push({ rid: rid, left: r.time });
  return true;
}
// 취소하면 재료를 돌려준다 — 안 그러면 잘못 누른 클릭이 아이템 소각이 된다
function handCancel(i) {
  if (i < 0 || i >= handQueue.length) return false;
  var job = handQueue.splice(i, 1)[0], r = RECIPES[job.rid];
  for (var k in r.inp) inventory[k] = (inventory[k] || 0) + r.inp[k];
  return true;
}
function stepHandCraft(dt) {
  var guard = 0;
  while (handQueue.length > 0 && dt > 1e-9 && guard++ < 2000) {
    var job = handQueue[0];
    var use = Math.min(dt, job.left);
    job.left -= use; dt -= use;
    if (job.left > 1e-9) break;
    handQueue.shift();
    var r = RECIPES[job.rid];
    for (var o in r.out) inventory[o] = (inventory[o] || 0) + r.out[o];
    handCraftCount++;
    prodStats.byRecipe[job.rid] = (prodStats.byRecipe[job.rid] || 0) + 1;
  }
}

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

// --- 청사진 ----------------------------------------------------------------
// 두 모드뿐이다: 'sel' 은 영역을 끌어 담는 중, 'paste' 는 담은 것을 놓는 중.
// B 로 돌린다 — 담은 게 없으면 담기, 있으면 놓기/다시 담기.
var bpMode = null;
// **R 키와 회전 버튼이 같은 손잡이를 쓴다.** 원래 키는 도구 방향만 돌렸고, 회전을
// 청사진에도 붙이면서 키 쪽에만 갈림길을 넣었다 — 그러면 키보드가 없는 기기에서는
// 청사진 회전이 아예 닿지 않는다. 진입점이 없으면 기능은 있어도 없는 것과 같다.
// 붙여넣기 중이면 손에 든 것은 도구가 아니라 청사진이므로 그쪽을 돌린다.
function rotateAction() {
  if (bpMode === 'paste' && blueprint) {
    var rr = rotateBlueprint();
    toast('청사진 회전 — ' + rr.w + 'x' + rr.h);
    return 'bp';
  }
  toolDir = dirCW(toolDir);
  return 'tool';
}
function toggleBlueprint() {
  if (bpMode) { bpMode = null; bpSelStart = null; toast('청사진 모드 해제'); }
  else if (blueprint) { bpMode = 'paste'; selectTool(null); toast('청사진 붙여넣기 — 좌클릭으로 배치, B 로 다시 담기'); }
  else { bpMode = 'sel'; selectTool(null); toast('청사진 담기 — 영역을 끌어서 선택'); }
  renderBuildList();
}
function blueprintClickAt(tx, ty) {
  if (bpMode !== 'paste' || !blueprint) return false;
  var r = pasteBlueprint(tx, ty);
  if (r.placed === 0) toast('아무것도 못 지었다 — ' + (r.why || '재료 부족'), 'bad');
  else if (r.skipped) toast(r.placed + '개 배치 · ' + r.skipped + '개 건너뜀 (' + (r.why || '') + ')', 'warn');
  else toast(r.placed + '개 배치');
  renderInv();
  return true;
}

function selectTool(t) {
  if (t && BUILDINGS[t].tech && !techDone[BUILDINGS[t].tech]) {
    toast(TECHS[BUILDINGS[t].tech].name + ' 연구가 필요하다', 'bad'); return;
  }
  tool = t; selected = null; hideInsp();
  renderBuildList();
}

function tryPlace(tx, ty) {
  if (!tool) return false;
  // 열차는 **레일 위에** 놓는다. 그 칸은 이미 레일이 점유하고 있어서 보통
  // 건물처럼은 못 세운다(한 칸에 id 하나) — 그래서 배치 경로를 여기서 가른다.
  // 팔레트·단축키·비용은 다른 건물과 똑같이 지나간다.
  if (BUILDINGS[tool] && BUILDINGS[tool].onRail) {
    if (!isRail(tx, ty)) { toast('레일 위에만 놓을 수 있다', 'bad'); return false; }
    if (trainAt(tx, ty)) { toast('여기 이미 열차가 있다', 'bad'); return false; }
    var costT = BUILDINGS[tool].cost;
    for (var ck in costT) {
      if ((inventory[ck] || 0) < costT[ck]) {
        var howT = howToGet(ck);
        toast(ITEMS[ck].name + ' ' + costT[ck] + '개 필요 (지금 ' + (inventory[ck] || 0) + '개)' +
              (howT ? ' — ' + howT : ''), 'bad');
        return false;
      }
    }
    for (var ck2 in costT) inventory[ck2] -= costT[ck2];
    addTrain(tx, ty);
    renderInv();
    return true;
  }
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
    // 청사진이 도구보다 먼저다 — 모드에 들어와 있으면 클릭의 뜻이 통째로 다르다
    if (bpMode === 'sel') { bpSelStart = { x: hoverT.x, y: hoverT.y }; return; }
    if (bpMode === 'paste') { blueprintClickAt(hoverT.x, hoverT.y); return; }
    if (tool) { dragLast = null; dragPlace(); }
    else { pickEntity(); }
  });
  window.addEventListener('mouseup', function (ev) {
    if (ev.button === 2) {
      if (mouse.rdown && !mouse.dragged) rightClickAction();
      mouse.rdown = false; return;
    }
    // 영역 선택은 **뗄 때** 확정한다. 누르는 순간 확정하면 한 칸짜리 청사진만 나온다.
    if (bpMode === 'sel' && bpSelStart) {
      var r = captureBlueprint(bpSelStart.x, bpSelStart.y, hoverT.x, hoverT.y);
      bpSelStart = null;
      if (!r.count) toast('그 영역에 담을 건물이 없다', 'bad');
      else { bpMode = 'paste'; toast('청사진에 ' + r.count + '개 담았다 (' + r.w + 'x' + r.h + ') — 좌클릭으로 붙여넣기'); }
      renderBuildList();
    }
    mouse.down = false; dragLast = null;
  });
  // --- 터치 ------------------------------------------------------------------
  // 폰에는 버튼이 셋(좌·우·휠)이 아니라 손가락 개수밖에 없다. 그래서 의도를
  // **손가락 수**로 가른다:
  //   손가락 1개 + 도구 있음 → 건설 (탭 = 한 칸, 끌기 = 여러 칸)
  //   손가락 1개 + 도구 없음 → 지도 이동 (그 자리에서 떼면 = 선택)
  //   손가락 2개            → 핀치 확대 + 이동
  // 우클릭(철거)에 해당하는 것이 없으므로 **철거는 도구로** 만든다(아래 'demolish').
  var tch = { mode: null, id: null, sx: 0, sy: 0, lx: 0, ly: 0, moved: 0,
              pinchD: 0, pinchCx: 0, pinchCy: 0 };
  function localXY(t) {
    var r = canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function dist2(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function setHoverFrom(p) {
    mouse.x = p.x; mouse.y = p.y;
    var w = worldOf(p.x, p.y);
    hoverT.x = Math.floor(w.x); hoverT.y = Math.floor(w.y);
  }

  canvas.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    if (ev.touches.length >= 2) {
      tch.mode = 'pinch';
      tch.pinchD = dist2(ev.touches[0], ev.touches[1]);
      var c = localXY({ clientX: (ev.touches[0].clientX + ev.touches[1].clientX) / 2,
                        clientY: (ev.touches[0].clientY + ev.touches[1].clientY) / 2 });
      tch.pinchCx = c.x; tch.pinchCy = c.y;
      // 핀치로 바뀌면 그전까지의 한 손가락 건설은 중단한다 (두 손가락은 건설이 아니다)
      mouse.down = false; dragLast = null;
      return;
    }
    var t = ev.touches[0]; if (!t) return;
    var p = localXY(t);
    tch.id = t.identifier; tch.sx = p.x; tch.sy = p.y; tch.lx = p.x; tch.ly = p.y; tch.moved = 0;
    setHoverFrom(p);
    if (pickMode) { tch.mode = 'pick'; return; }
    if (tool) { tch.mode = 'build'; mouse.down = true; dragLast = null; dragPlace(); }
    else { tch.mode = 'pan'; }
  }, { passive: false });

  canvas.addEventListener('touchmove', function (ev) {
    ev.preventDefault();
    if (tch.mode === 'pinch' && ev.touches.length >= 2) {
      var d = dist2(ev.touches[0], ev.touches[1]);
      if (tch.pinchD > 0 && d > 0) {
        var before = worldOf(tch.pinchCx, tch.pinchCy);
        cam.z = clamp(cam.z * (d / tch.pinchD), 0.35, 2.6);
        var after = worldOf(tch.pinchCx, tch.pinchCy);
        cam.x += before.x - after.x; cam.y += before.y - after.y;
        clampCam(); refreshHover();
      }
      tch.pinchD = d;
      return;
    }
    var t = ev.touches[0]; if (!t) return;
    var p = localXY(t);
    var dx = p.x - tch.lx, dy = p.y - tch.ly;
    tch.moved += Math.abs(dx) + Math.abs(dy);
    tch.lx = p.x; tch.ly = p.y;
    setHoverFrom(p);
    if (tch.mode === 'pan') {
      cam.x -= dx / (TILE * cam.z); cam.y -= dy / (TILE * cam.z);
      clampCam(); refreshHover();
    } else if (tch.mode === 'build') {
      dragPlace();
    }
  }, { passive: false });

  function endTouch(ev) {
    if (tch.mode === 'pinch') {
      if (!ev.touches || ev.touches.length === 0) { tch.mode = null; tch.pinchD = 0; }
      return;
    }
    // 손가락이 거의 안 움직였으면 탭이다. 손가락은 완벽히 가만있지 않으므로
    // 문턱을 둔다 — 0 으로 두면 실기에서 탭이 전부 드래그로 읽힌다.
    var TAP = 12;
    if (tch.mode === 'pick') { doPick(); }
    else if (tch.mode === 'pan' && tch.moved <= TAP) { pickEntity(); }
    mouse.down = false; dragLast = null; tch.mode = null;
  }
  canvas.addEventListener('touchend', function (ev) { ev.preventDefault(); endTouch(ev); }, { passive: false });
  canvas.addEventListener('touchcancel', function (ev) { endTouch(ev); });

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
    if (k === 'r' || k === 'R') { rotateAction(); return; }
    if (k === 't' || k === 'T') { toggleTech(); return; }
    if (k === 'h' || k === 'H' || k === '?') { toggleHelp(); return; }
    if (k === 'p' || k === 'P') { showPollution = !showPollution; return; }
    if (k === 'q' || k === 'Q') { pipetteTool(); return; }
    if (k === 'b' || k === 'B') { toggleBlueprint(); return; }
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
  // 철거 모드 — 폰에는 우클릭이 없다. 이게 없으면 잘못 놓은 건물을 영영 못 지운다.
  // 우클릭 경로(rightClickAction)와 같은 일을 하도록 그쪽을 그대로 부른다;
  // 따로 구현하면 "우클릭으로는 나무가 베이는데 철거 버튼으로는 안 된다" 가 생긴다.
  if (demolishMode) { rightClickAction(); renderInv(); return; }
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
// 문장 편집기용 — 노드가 아니라 콜백에 돌려준다. 고르는 **경로는 같은 코드**를 쓴다.
// (원장: 같은 것을 고르는 규칙이 두 곳에 있으면 반드시 갈린다)
function startPickFor(filter, cb) {
  pickMode = { ctrl: curCtrl ? curCtrl.id : null, nid: null, key: null,
               filter: filter || null, cb: cb || null };
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
  var cb = pickMode.cb;
  if (!cb && ctrl && ctrl.graph) {
    var n = graphNode(ctrl.graph, pickMode.nid);
    if (n) { n.cfg[pickMode.key] = e.id; ctrl.graph.dirty = true; }
  }
  var save = pickMode; pickMode = null;
  document.getElementById('pickBanner').style.display = 'none';
  if (logicOpen) {
    document.getElementById('logic').style.display = 'block';
    if (cb) cb(e.id); else renderGraph();
  }
  void save;
}

// --- 오버레이 (월드 좌표계에서 그린다) ----------------------------------------
function drawOverlays() {
  // 청사진 — 담는 중이면 끌고 있는 사각형, 놓는 중이면 놓일 자리.
  // **놓일 자리를 안 보여주면** 원점이 좌상단이라는 규칙을 플레이어가 알 방법이 없다.
  if (bpMode === 'sel' && bpSelStart && inBounds(hoverT.x, hoverT.y)) {
    var sx0 = Math.min(bpSelStart.x, hoverT.x), sy0 = Math.min(bpSelStart.y, hoverT.y);
    var sw = Math.abs(hoverT.x - bpSelStart.x) + 1, sh = Math.abs(hoverT.y - bpSelStart.y) + 1;
    ctx.fillStyle = 'rgba(47,95,143,0.18)';
    ctx.fillRect(sx0, sy0, sw, sh);
    ctx.strokeStyle = '#7fb8d8'; ctx.lineWidth = 0.07;
    ctx.strokeRect(sx0, sy0, sw, sh);
  } else if (bpMode === 'paste' && blueprint && inBounds(hoverT.x, hoverT.y)) {
    ctx.strokeStyle = 'rgba(127,184,216,0.55)'; ctx.lineWidth = 0.06;
    ctx.strokeRect(hoverT.x, hoverT.y, blueprint.w, blueprint.h);
    for (var bi = 0; bi < blueprint.ents.length; bi++) {
      var bit = blueprint.ents[bi], bB = BUILDINGS[bit.t];
      if (!bB) continue;
      var bw = bB.w, bh = bB.h;
      if (bB.rot && (bit.d === 1 || bit.d === 3) && bw !== bh) { var tmpw = bw; bw = bh; bh = tmpw; }
      var px = hoverT.x + bit.dx, py = hoverT.y + bit.dy;
      // 놓을 수 있는 칸과 막힌 칸을 색으로 가른다 — 붙여넣기 전에 몇 개가
      // 건너뛸지 보이는 편이 낫다(전부-아니면-전무가 아니므로 더욱).
      var okHere = canPlace(bit.t, px, py, bit.d, false).ok;
      ctx.fillStyle = okHere ? 'rgba(127,184,216,0.22)' : 'rgba(192,57,43,0.30)';
      ctx.fillRect(px + 0.05, py + 0.05, bw - 0.1, bh - 0.1);
    }
  }
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

// 대기열은 매 프레임 다시 그린다 (진행 막대가 움직여야 하므로). 항목이 없으면
// :empty 로 통째로 숨는다 — 빈 상자가 패널을 밀어 올리지 않게.
var craftQueueSig = '';
function renderCraftQueue() {
  var host = document.getElementById('craftQueue');
  if (!host) return;
  if (handQueue.length === 0) {
    if (craftQueueSig !== '') { host.innerHTML = ''; craftQueueSig = ''; }
    return;
  }
  // 매 프레임 innerHTML 을 새로 짜면 클릭 바인딩까지 60번/s 다시 건다. 줄 구성이
  // 그대로면 진행 막대 폭만 고친다 — 그래야 막대가 부드럽게 움직인다.
  var sig = handQueue.length + '|' + handQueue[0].rid;
  if (sig === craftQueueSig) {
    var bar = host.querySelector('.qbar');
    var rt = RECIPES[handQueue[0].rid].time;
    if (bar) bar.style.width = Math.round((1 - handQueue[0].left / rt) * 100) + '%';
    var lab = host.querySelector('.qrow .qx');
    if (lab) lab.textContent = handQueue[0].left.toFixed(1) + 's';
    return;
  }
  craftQueueSig = sig;
  // 대기열 줄과 아래 제작 목록이 같은 모양이라 경계가 안 보였다 — 무엇이 '만드는 중'
  // 이고 무엇이 '누르면 만들 것' 인지 그림만 보고 갈릴 수 있어야 한다.
  var html = ['<div class="qcap">만드는 중 · 클릭하면 취소</div>'];
  for (var i = 0; i < handQueue.length && i < 12; i++) {
    var job = handQueue[i], r = RECIPES[job.rid];
    var name = ITEMS[Object.keys(r.out)[0]].name;
    var pct = i === 0 ? Math.round((1 - job.left / r.time) * 100) : 0;
    html.push('<div class="qrow" data-i="' + i + '" title="클릭하면 취소하고 재료를 돌려받는다">' +
      '<i class="qbar" style="width:' + pct + '%"></i>' +
      '<span>' + name + '</span>' +
      '<span class="qx">' + (i === 0 ? job.left.toFixed(1) + 's' : '대기') + '</span></div>');
  }
  if (handQueue.length > 12) html.push('<div class="qrow"><span>… 외 ' + (handQueue.length - 12) + '개</span></div>');
  host.innerHTML = html.join('');
  var rows = host.querySelectorAll('.qrow[data-i]');
  for (var j = 0; j < rows.length; j++) {
    rows[j].onclick = (function (i) {
      return function () { if (handCancel(i)) { renderInv(); renderCraftList(); renderBuildList(); } };
    })(parseInt(rows[j].getAttribute('data-i'), 10));
  }
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
  // 좁은 화면에서는 시트가 겹친다 — 인스펙터를 열면 건설 시트는 접는다.
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    document.body.classList.remove('sheet-build', 'sheet-right');
    var bb = document.getElementById('btnSheetBuild'); if (bb) bb.classList.remove('on');
    var br = document.getElementById('btnSheetRight'); if (br) br.classList.remove('on');
  }
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
          stockPuttableItems(e).length > 0 ? 1 : 0,   // [넣기] 버튼의 활성 여부
          stockTakeCount(e) > 0 ? 1 : 0,     // [가져오기] 버튼의 활성 여부
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
    // 보유 자재 → 기계. 손으로 라인을 초기 급유할 수 있어야 "레시피는 걸었는데
    // 왜 안 도나"를 스스로 확인할 수 있다. 무엇이 들어갈지는 canAccept 가 정한다.
    if (PUT_TYPES[e.type]) {
      var puttable = stockPuttableItems(e);
      var putTitle = puttable.length
        ? '넣을 수 있는 것: ' + puttable.map(function (i) { return ITEMS[i].name; }).join(' · ')
        : (e.recipe || e.type !== 'assembler'
            ? '지금 이 기계가 받을 수 있는 자재가 보유 자재에 없다'
            : '레시피를 먼저 골라야 무엇을 받을지 정해진다');
      c.push('<button id="putBtn" style="width:100%;margin-top:4px" title="' + putTitle + '"' +
        (puttable.length ? '' : ' disabled') + '>보유 자재 넣기</button>');
    }
    // 상자·기계에 든 것을 보유 자재로 꺼낸다. 이 버튼이 없으면 공장이 만든 것을
    // 쓸 방법이 철거밖에 없어서, 시작 지급분을 다 쓰는 순간 게임이 막힌다.
    if (e.type !== 'generator' && e.type !== 'turret' && (e.inv || e.out)) {
      c.push('<button id="takeBtn" style="width:100%;margin-top:4px"' +
        (stockTakeCount(e) < 1 ? ' disabled' : '') + '>보유 자재로 가져오기</button>');
    }
    c.push('<div style="display:flex;gap:6px;margin-top:9px">' +
      // 제어기가 가동 축을 지배 중이면 이 버튼은 **지금 아무 효과가 없다.**
      // 예전엔 라벨만 뒤집히고 기계는 계속 돌아서 버튼이 거짓말을 했다.
      '<button id="tglBtn"' + (e.fEnable ? ' title="제어기가 지배 중 — 지배가 풀린 뒤에 적용된다"' : '') + '>' +
      (e.playerEnabled === false ? '가동' : '정지') + (e.fEnable ? ' (지배중)' : '') + '</button>' +
      '<button class="danger" id="delBtn">철거</button></div>');
    if (e.logicForced) {
      c.push('<div class="ok" style="font-size:11px;margin-top:5px">⛓ 제어기 지배 중 — 수동 조작은 지배가 풀린 뒤 적용된다</div>');
    }
    // 두 제어기가 같은 축을 다투면 한쪽이 조용히 무시된다. 그걸 말해 준다.
    if (e.logicConflict) {
      c.push('<div class="bad" style="font-size:11px;margin-top:5px;font-weight:600">⚠ ' +
             e.logicConflict + '</div>');
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
      Math.round((e.load || 0) * 100) + '% · 보유 석탄 ' + (inventory['coal'] || 0) +
      (e.net < 0 ? ' · <b class="bad">망 미연결</b>' : '') + '</span></div>');
  }
  if (e.type === 'boiler') {
    s.push('<div class="frow"><label>연료</label><span class="num">' + fmt((e.fuel || 0) / 1000, 1) +
      ' MJ · 부하 ' + Math.round((e.load || 0) * 100) + '% · 보유 석탄 ' + (inventory['coal'] || 0) +
      '</span></div>');
  }
  if (B.fluid) {
    // **증기는 이 계의 선행 지표다** — 전기가 흔들리기 전에 여기가 먼저 준다.
    // 그래서 숫자를 보여 준다. 안 보이면 제어기로 뭘 잡아야 할지 알 수 없다.
    var fi = fluidOf(e);
    if (!fi.connected) {
      s.push('<div class="frow"><label>유체</label><span class="num"><b class="bad">망 미연결</b>' +
        ' — 파이프가 맞닿아야 이어진다</span></div>');
    } else {
      s.push('<div class="frow"><label>물</label><span class="num">' + fmt(fi.water, 0) + ' / ' +
        fi.cap + '</span></div>');
      s.push('<div class="frow"><label>증기</label><span class="num" style="color:' +
        (fi.steamPct > 25 ? 'var(--run)' : (fi.steamPct > 0 ? 'var(--warn)' : 'var(--stop)')) + '">' +
        fmt(fi.steam, 0) + ' / ' + fi.cap + ' · ' + fmt(fi.steamPct, 0) + '%</span></div>');
    }
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
  // 레시피는 걸렸는데 왜 안 도는지 말해준다. 사용자가 "적색연구팩 제작이 안되는데?"
  // 로 막힌 자리다 — 화면에는 전력 100%·체력 만땅만 있고 정작 입력 버퍼가 비었다는
  // 사실은 [내용물] 행이 **없는 것**으로만 드러났다. 없는 것은 아무도 못 읽는다.
  if ((e.type === 'assembler' || e.type === 'furnace') && e.recipe) {
    var rec = RECIPES[e.recipe], missing = [];
    // 연구가 안 된 레시피는 시뮬에서도 안 돈다 — 그걸 안 알려주면 조용한 정지가 된다
    if (rec.tech && !techDone[rec.tech]) {
      s.push('<div class="frow" style="align-items:flex-start"><label>정지 이유</label>' +
        '<span class="bad">' + TECHS[rec.tech].name + ' 연구가 필요하다' +
        '<br><span class="hint">이 레시피는 연구가 끝나야 돈다. <b>T</b> 에서 연구한다.</span>' +
        '</span></div>');
    }
    for (var mk in rec.inp) {
      if ((e.inv[mk] || 0) < rec.inp[mk]) missing.push(ITEMS[mk].name + ' ' + (e.inv[mk] || 0) + '/' + rec.inp[mk]);
    }
    if (missing.length) {
      s.push('<div class="frow" style="align-items:flex-start"><label>정지 이유</label>' +
        '<span class="bad">재료 부족 — ' + missing.join(', ') + '<br>' +
        '<span class="hint">기계는 <b>제 안에 든 것</b>으로만 만든다. 인서터로 넣거나 ' +
        '아래 [보유 자재 넣기]로 손수 채운다.</span></span></div>');
    }
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
  var pb = document.getElementById('putBtn');
  if (pb) pb.onclick = function () {
    var n = putFromStock(e);
    if (n > 0) toast(n + '개를 넣었다', 'good');
    else toast('넣을 수 있는 자재가 없다', 'bad');
    renderInv(); renderCraftList(); renderBuildList(); refreshInsp();
  };
  var tk = document.getElementById('takeBtn');
  if (tk) tk.onclick = function () {
    var n = takeAllToStock(e);
    if (n > 0) toast(n + '개를 보유 자재로 가져왔다', 'good');
    renderInv(); renderCraftList(); renderBuildList(); refreshInsp();
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
    // 갈아탄 연구의 진행도도 보여준다. 안 보이면 "0으로 날아갔나" 싶어 못 갈아탄다 —
    // 안전한데 안전해 보이지 않는 것은 안전하지 않은 것과 같다.
    var prog = '';
    if (currentResearch === tid) prog = ' — 진행 ' + Math.round(researchFrac() * 100) + '%';
    else if (!done && (researchProgressBy[tid] || 0) > 0) {
      prog = ' — <span class="dim">중단 ' +
        Math.round((researchProgressBy[tid] / techCycles(tid)) * 100) + '% (이어서 진행됨)</span>';
    }
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
    '<p><b>참/거짓 판정은 0.5 이상이 참이다.</b> 0 초과가 아니다 — 0.4 는 거짓으로 읽힌다.',
    '사칙 <code>1÷4=0.25</code>, PID 출력 0.3 처럼 소수를 내는 노드를 참/거짓 자리에 바로 물리면',
    '여기 걸린다. <code>비교 &gt; 0</code> 을 한 단 끼우면 된다.</p>',
    '<p><b>평가 순서는 배선이 정한다 — 입력이 언제나 먼저 돈다.</b> 만든 순서는 상관없고,',
    '같은 그림의 회로는 언제나 같게 돈다. 한 회로 안에서는 <b>왼쪽 위 노드가 시작점</b>이 되고,',
    '순환에서 어느 배선이 1틱 지연이 될지도 그 시작점이 정한다.</p>',
    '<p><b>서로 이어지지 않은 두 회로 사이의 순서는 배치로 정해지지 않는다.</b>',
    '그래서 두 회로가 <b>같은 기계</b>를 잡으면 어느 쪽이 이길지 위치로 예측하지 마라 —',
    '그때는 위쪽에 <b class="bad">충돌</b> 경고가 뜬다. 순서에 기대는 대신 충돌을 없애는 것이 답이다.</p>',
    '<p><b>타이머·엣지 검출은 1틱(약 17ms)짜리 펄스</b>다. 편집기 값창은 0.14초마다 표본을 뜨므로',
    '그 순간 값은 거의 늘 0 으로 보인다. 그래서 값 옆에 <b>↑n</b> 으로 지금까지 올라간 횟수를 함께 적는다 —',
    '그 숫자가 늘고 있으면 정상 동작이다.</p>',
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
    '<h4>기차 — 먼 광맥을 쓸 이유</h4>',
    '<p>광맥은 멀수록 크고 풍부한데, 벨트로 60타일을 끌면 벨트값이 광석값을 넘는다.',
    '기차는 그 거리를 값싸게 만든다 — <b>8 타일/s</b> 로 벨트(1.875)보다 4배 빠르다.</p>',
    '<p><b>레일</b>을 깔고(드래그로 이어 깔린다), 레일 <b>옆</b>에 <b>역</b>을 세우고,',
    '레일 <b>위</b>에 <b>열차</b>를 놓는다. 열차는 닿을 수 있는 역들을 지은 순서대로 돈다.',
    '싣고 내리는 것은 인서터다 — 역에 선 열차는 <b>움직이는 상자</b>라, 상자에 하던 것을 그대로 하면 된다.</p>',
    '<p><b>언제 떠나는가가 이 게임의 자리다.</b> 기본은 화물이 다 찼거나 5초가 지나면 간다.',
    '그런데 역에 제어기의 <b>[열차 출발]</b> 노드를 물리면 <b>그 역은 제어기가 정한다</b> —',
    '참이면 보내고 거짓이면 붙잡는다. <code>[역 상태]</code> 로 저쪽 역에 열차가 있는지,',
    '이쪽 화물이 얼마나 찼는지 읽어서 배차를 회로로 짤 수 있다.',
    '예: <b>도착지 상자가 빌 때까지 붙잡았다가 보낸다.</b></p>',
    '<p class="dim">아직 없는 것: 신호기·다중 편성·교차 통제·대각선 곡선. 그래서 <b>한 노선에',
    '열차 한 대</b>를 전제한다. 두 대를 같은 레일에 놓으면 서로를 통과한다 — 넣을 때는 신호기부터다.</p>',
    '<h4>청사진 — 잘 도는 라인을 통째로 늘린다</h4>',
    '<p><code>B</code> (폰은 아래 [청사진] 버튼) 를 누르고 <b>영역을 끌어서</b> 담는다.',
    '담으면 곧바로 붙여넣기 모드가 되고, <b>좌클릭</b> 한 번으로 그 자리에 지어진다.',
    '놓일 자리는 미리 파랗게 보이고, <b>못 놓는 칸은 빨갛게</b> 보인다 — 붙이기 전에 몇 개가',
    '건너뛸지 알 수 있다. 다시 <code>B</code> 를 누르면 해제된다.</p>',
    '<p>붙이기 전에 <code>R</code>(폰은 [회전] 버튼)로 <b>90도씩 돌릴 수 있다</b>.',
    '모양만 도는 것이 아니라 <b>벨트·인서터의 방향도 같이 돈다</b> — 돌린 라인은 돌린 쪽으로',
    '흐른다. 네 번 누르면 원래대로다.</p>',
    '<p><b>제어기의 규칙과 배선까지 따라온다.</b> 그게 이 기능의 값이다 — 두 번째 라인을 만들 때',
    '회로를 손으로 다시 그리지 않아도 된다. 영역 <b>안</b>의 기계를 가리키던 참조는 사본의 기계로',
    '갈아 끼워지고, 영역 <b>밖</b>을 가리키던 참조는 <b>끊긴다</b>(대상 고르기 상태가 된다) —',
    '안 끊으면 붙여넣은 사본이 원본의 기계를 지배해서, 왜 멈췄는지 짚을 수 없게 된다.</p>',
    '<p>세 가지는 알아 두는 편이 낫다. <b>재료는 실제로 나간다</b>(공짜로 지으면 치트다).',
    '<b>내용물은 안 따라온다</b> — 상자 재고·벨트 위 아이템·연료는 계획이 아니라 화물이고,',
    '따라오면 청사진이 복제기가 된다. <b>원가는 회전해도 그대로다</b> — 회전은 모양만 바꾼다.</p>',
    '<h4>증기 발전 — 버퍼가 생기면 제어가 달라진다</h4>',
    '<p>강철 제련을 연구하면 <b>파이프·지하수 펌프·보일러·증기기관</b>이 열린다.',
    '<code>펌프 → 파이프 → 보일러 → 파이프 → 증기기관</code> 으로 <b>맞대어</b> 놓으면 한 유체망이 된다 —',
    '맞닿음이 곧 연결이고, 파이프 한 칸을 빼면 그 자리에서 끊긴다.</p>',
    '<p>보일러는 석탄을 태워 물 60/s 를 증기 60/s 로 바꾸고, 증기기관은 증기 30/s 로 900 kW 를 낸다.',
    '즉 <b>보일러 1대가 증기기관 2대</b>를 먹인다. 발전기와 효율은 같다(둘 다 100%) —',
    '이득은 <b>석탄 넣는 곳이 절반</b>이라는 것과, 파이프에 <b>증기가 고인다</b>는 것이다.</p>',
    '<p><b>그 고인 증기가 이 계의 요점이다.</b> 석탄이 잠깐 끊겨도 증기가 남아 있으면 전기는 버틴다.',
    '반대로 부하가 몰리면 <b>전기가 흔들리기 전에 증기부터 준다</b> —',
    '전력 만족도는 이미 모자란 뒤에야 100% 아래로 내려가지만, 증기%는 그 전에 내려간다.',
    '그래서 제어기의 과제가 "전기가 모자라면 끄기"에서 <b>"증기가 마르기 전에 끄기"</b>로 옮겨 간다.',
    '읽는 노드는 <b>유체 잔량</b>(증기%·증기·물·망연결)이고, 문장 편집기에도 <code>증기 잔량</code> 으로 있다.',
    '하고 싶은 일 카드의 <b>"증기가 마르기 전에 미리 끄기"</b>가 그 회로를 절반 채워서 열어 준다.</p>',
        '<p><b>저장 탱크</b>는 그 완충을 손으로 키우는 물건이다. 파이프 한 칸이 100 인데 탱크는',
    '<b>25,000</b> — 파이프 250칸어치다. 증기 60/s 를 쓰는 보일러 기준으로 7분 가까이 버틴다.',
    '완충이 크면 제어기가 늦게 반응해도 되고, 작으면 빨라야 한다 — <b>얼마나 둘 것인가가',
    '설계 결정</b>이다. 망 어디에 붙여도 같은 통이므로 자리는 편한 곳에 두면 된다.</p>',
'<h4>신호를 다듬고, 나누고, 단계로 쪼갠다</h4>',
    '<p><b>평활 필터</b>(논리 III)는 덜덜 떨리는 값을 눅인다. <code>시상수 s</code>는 입력이 갑자기 바뀌었을 때',
    '<b>63%까지 따라가는 데 걸리는 시간</b>이다 — 5로 두면 5초에 63%, 15초에 95% 따라간다.',
    '전력 만족도나 상자 재고처럼 매 틱 튀는 값을 임계값 비교에 바로 물리면 그 경계에서 딸깍거리는데,',
    '필터를 한 단 끼우면 잦아든다. <b>대신 반응이 느려진다</b> — 그 맞바꿈이 이 노드의 전부다.</p>',
    '<p><b>상태기계</b>(논리 II)는 공정을 <b>1→2→3→4→1</b> 단계로 돌린다. 각 입력은 그 단계에서만 보고,',
    '<b>거짓에서 참으로 올라가는 순간</b>에만 넘어간다(참인 채로 두어도 한 칸만 간다). 리셋은 언제나 1단계로,',
    '전이보다 우선한다. 단계별 출구 <code>1단계~4단계</code>가 그 단계에서만 1이므로,',
    '거기에 기계를 물리면 "지금은 이것만 만든다"가 된다. 타이머를 입력에 물리면 순서 반복이 되고,',
    '재고 조건을 물리면 재고가 이끄는 공정이 된다.</p>',
    '<p class="dim"><b>평활 필터와 신호 버스는 문장으로도 쓸 수 있다.</b>',
    '읽을 것 옆의 <code>(그대로)</code> 를 <code>초로 눅인 값</code> 으로 바꾸면 그 값이 눅고,',
    '행동에서 <code>다른 제어기에 신호를 보낸다</code> 를 고르면 잰 값이 채널로 나간다.',
    '받는 쪽은 읽을 것에서 <code>받은 신호</code> 를 고르면 된다.',
    '<b>상태기계는 문장에 없다</b> — 문장 한 줄은 조건 하나에 행동 하나인데 상태기계는',
    '전이가 넷이라 한 줄로 안 접힌다. 회로 화면에서 쓴다.</p>',
    '<p><b>신호 보내기 / 받기</b>(논리 III)는 <b>제어기끼리</b> 값을 주고받는 8채널(A~H)이다.',
    '한 제어기가 다 하기엔 회로가 커질 때 역할별로 쪼개 쓴다 — 발전소 제어기가 전력 여유를 A로 쏘면,',
    '지도 반대편 라인 제어기들이 그걸 받아 각자 판단한다. 규칙 두 가지만 기억하면 된다:',
    '<b>같은 채널에 여러 제어기가 보내면 합산</b>되고(순서를 안 타게 하려는 것이다),',
    '<b>받는 값은 언제나 한 틱 전 값</b>이다(되먹임 배선과 같은 규약). 보낸 노드를 지우면 그 몫이 바로 빠진다.</p>',
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
  function jump(clientX, clientY) {
    var r = c.getBoundingClientRect();
    cam.x = (clientX - r.left) / r.width * W;
    cam.y = (clientY - r.top) / r.height * H;
    clampCam(); refreshHover();
  }
  c.addEventListener('mousedown', function (ev) { jump(ev.clientX, ev.clientY); });
  c.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    var t = ev.touches[0]; if (t) jump(t.clientX, t.clientY);
  }, { passive: false });
}

// --- 모바일 조작 바 ----------------------------------------------------------
// 폰에는 키보드도 우클릭도 없다. R(회전)·철거·T(연구)·H(도움말)이 단축키로만
// 존재하면 그 기능들은 폰에서 **없는 기능**이다. 철거가 특히 그렇다 —
// 우클릭 없이는 잘못 놓은 건물을 영원히 못 지운다.
var demolishMode = false;
function setDemolish(on) {
  demolishMode = !!on;
  if (demolishMode) selectTool(null);
  var b = document.getElementById('btnDemolish');
  if (b) b.classList.toggle('on', demolishMode);
  var cv2 = document.getElementById('view');
  if (cv2) cv2.style.cursor = demolishMode ? 'not-allowed' : 'crosshair';
}
function toggleSheet(name) {
  var cls = 'sheet-' + name, on = document.body.classList.contains(cls);
  document.body.classList.remove('sheet-build', 'sheet-right');
  if (!on) document.body.classList.add(cls);
  var ids = { build: 'btnSheetBuild', right: 'btnSheetRight' };
  for (var k in ids) {
    var b = document.getElementById(ids[k]);
    if (b) b.classList.toggle('on', document.body.classList.contains('sheet-' + k));
  }
}
function bindMobileBar() {
  function on(id, fn) { var b = document.getElementById(id); if (b) b.onclick = fn; }
  on('btnSheetBuild', function () { toggleSheet('build'); });
  on('btnSheetRight', function () { toggleSheet('right'); });
  on('btnRotate', function () { rotateAction(); renderBuildList(); });
  on('btnDemolish', function () { setDemolish(!demolishMode); });
  // 폰에는 B 키가 없다. 단축키만 두면 청사진은 폰에서 존재하지 않는 기능이 된다.
  on('btnBlueprint', function () { toggleBlueprint(); });
  on('btnTech', function () { toggleTech(); });
  on('btnHelp', function () { toggleHelp(); });
  // 좁은 화면에서는 건설 시트를 먼저 열어 둔다 — 빈 화면만 보이면 무엇부터
  // 해야 할지 알 수 없다.
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    document.body.classList.add('sheet-build');
    var bb = document.getElementById('btnSheetBuild');
    if (bb) bb.classList.add('on');
  }
}
