// ===========================================================================
//  25_entity.js — 엔티티 등록/배치/철거 + 기계 동작 + 인서터
//
//  불변식 (원장의 교착 사례들에서 옮겨온 것):
//   * "작업이 진행 중일 때만 자원을 쥔다" — 인서터는 놓을 곳이 없으면 집지 않는다.
//   * 모든 대기 상태에 탈출 타임아웃을 둔다 — stallT 가 그것이다.
//   * 철거는 점유맵·전력망·벨트순서·신호망을 전부 무효화한다. 한 곳이라도 빠지면
//     유령 참조가 남아 라인이 조용히 멈춘다.
// ===========================================================================

var entities = {};          // id -> entity
var entOrder = [];          // 결정론 순회를 위한 생성 순서
var nextEntId = 1;

function entityAt(tx, ty) {
  var id = occAt(tx, ty);
  return id > 0 ? entities[id] : null;
}
function forEachEntity(fn) {
  for (var i = 0; i < entOrder.length; i++) {
    var e = entities[entOrder[i]];
    if (e) fn(e);
  }
}

// --- 배치 가능 검사 ---------------------------------------------------------
// restore=true 는 "저장본 복원" 이다. 이때는 **자원·광맥·기술 검사를 하지 않는다.**
//   저장 시점의 인벤토리는 '짓고 남은 것'이라 부족한 게 정상이고, 광맥은 다 캤을 수 있다.
//   그 검사를 복원에도 걸면 멀쩡한 저장본에서 공장이 통째로 사라진다 (실측: 벨트 60개 → 0개).
//   기하 검사(맵 밖·점유)는 복원에서도 반드시 유지한다 — 그건 저장본의 무결성이다.
function canPlace(type, tx, ty, dir, restore) {
  var B = BUILDINGS[type];
  if (!B) return { ok: false, why: '알 수 없는 건물' };
  if (!restore && B.tech && !techDone[B.tech]) return { ok: false, why: TECHS[B.tech].name + ' 연구 필요' };
  var w = B.w, h = B.h;
  if (B.rot && (dir === 1 || dir === 3) && w !== h) { var t = w; w = h; h = t; }
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (!inBounds(x, y)) return { ok: false, why: '맵 밖' };
      if (world.occ[idx(x, y)] !== 0) return { ok: false, why: '이미 뭔가 있다' };
    }
  }
  if (!restore && type === 'miner') {
    var sv = surveyOre(tx, ty, w, h);
    if (!sv.total) return { ok: false, why: '광맥이 없다' };
  }
  if (!restore) {
    var cost = B.cost;
    for (var k in cost) {
      if ((inventory[k] || 0) < cost[k]) {
        return { ok: false, missing: k, need: cost[k], have: (inventory[k] || 0),
                 why: ITEMS[k].name + ' ' + cost[k] + '개 필요 (지금 ' + (inventory[k] || 0) + '개)' };
      }
    }
  }
  return { ok: true, w: w, h: h };
}

// "그건 어디서 얻나" — 부족하다고만 말하면 플레이어가 막힌다.
// 재료 사슬을 한 줄로 펴서 알려준다. 예: 회로기판 → 철판 1 + 구리선 3 (손 조립)
function howToGet(itemId) {
  var r = RECIPES[itemId];
  if (!r) {
    // 레시피가 없으면 땅에서 나오는 것이다
    if (ORE_ITEM.indexOf(itemId) > 0) return '채광기를 그 광맥 위에 놓아 캔다';
    return null;
  }
  var parts = [];
  for (var k in r.inp) parts.push(r.inp[k] + '×' + ITEMS[k].name);
  var recipe = parts.join(' + ');
  if (r.tech && !techDone[r.tech]) return TECHS[r.tech].name + ' 연구가 먼저다';
  if (r.handOk) return recipe + ' → 우측 [손 조립]에서 클릭';
  if (r.cat === 'smelt') return recipe + ' → 용광로에 넣는다';
  return recipe + ' → 조립기에 레시피를 걸어 만든다';
}

// --- 배치 -------------------------------------------------------------------
// free 는 두 가지를 함께 뜻한다: 비용을 안 받고, 비용/광맥/기술 검사도 안 한다.
// (예전에는 차감만 건너뛰고 검사는 그대로여서 복원이 조용히 실패했다.)
function placeEntity(type, tx, ty, dir, free) {
  var chk = canPlace(type, tx, ty, dir, free);
  if (!chk.ok) return null;
  var B = BUILDINGS[type];
  var w = chk.w, h = chk.h;
  clearTrees(tx, ty, w, h);
  if (!free) { for (var k in B.cost) inventory[k] -= B.cost[k]; }

  var id = nextEntId++;
  var tiles = w * h;
  var e = {
    id: id, type: type, tx: tx, ty: ty, w: w, h: h, dir: dir | 0,
    hp: 0, maxHp: 0,
    enabled: true,          // 이번 틱 실제 가동 여부 (제어기 또는 플레이어가 정한다)
    playerEnabled: true,    // 플레이어의 의사. 제어기 지배가 풀리면 여기로 돌아온다
    playerFilter: null,
    logicForced: false,     // 제어기가 실제로 지배 중인가 (UI 표시용)
    fEnable: false, fGate: false, fFilter: false, fFire: false,
    powerSat: 0,            // 이번 틱 전력 만족도 0..1
    net: -1,                // 전력망 번호
    inv: {}, out: {},
    recipe: null, progress: 0,
    stallT: 0,              // 아무 일도 못 한 시간 — 교착 진단용
    anim: 0
  };
  e.maxHp = (type === 'wall') ? SPEC.wallHp : tiles * SPEC.buildingHpPerTile;
  e.hp = e.maxHp;

  if (type === 'belt') {
    e.cells = [makeCell(e, tx, ty, e.dir)];
  } else if (type === 'splitter') {
    // 두 번째 칸은 **점유 사각형과 같은 축**으로 잡아야 한다.
    // 예전엔 dirCW 로 잡았는데, 회전 보정(w/h 스왑)은 dir 1/3 에서만 일어나므로
    // 남(2)·서(3) 향 분배기는 셀이 사각형 밖에 생겼다 — 점유한 칸엔 셀이 없고
    // 셀이 있는 칸은 비점유라, 벨트 인계가 막히고 철거가 이웃의 점유를 지웠다.
    // w/h 는 chk 에서 이미 회전 보정된 값이다.
    var sx = (w === 2) ? 1 : 0, sy = (h === 2) ? 1 : 0;
    e.cells = [makeCell(e, tx, ty, e.dir),
               makeCell(e, tx + sx, ty + sy, e.dir)];
    e.rr = 0;
    e.outPrio = null;
  } else if (type === 'inserter') {
    e.phase = 0; e.t = 0; e.held = null; e.filter = null;
  } else if (type === 'miner') {
    e.surveyed = surveyOre(tx, ty, w, h);
  } else if (type === 'generator') {
    e.fuel = 0;            // 남은 에너지 kJ
    e.load = 0;
  } else if (type === 'turret') {
    e.ammo = 0; e.shotT = 0; e.target = null; e.fireOk = true;
  } else if (type === 'controller') {
    e.graph = newGraph();
    e.lastEval = null;
  } else if (type === 'lab') {
    e.researching = 0;
  }

  entities[id] = e;
  entOrder.push(id);
  setOcc(tx, ty, w, h, id);
  markBeltDirty();
  markPowerDirty();
  markLogicDirty();
  return e;
}

// --- 철거 -------------------------------------------------------------------
function removeEntity(id, refund) {
  var e = entities[id];
  if (!e) return false;
  // 점유 해제는 사각형 하나로 끝난다. 예전엔 분배기만 셀 좌표로 한 번 더 지웠는데,
  // 셀이 사각형 밖에 있던 시절의 임시방편이었고 이웃 건물의 점유를 지우는 통로였다.
  setOcc(e.tx, e.ty, e.w, e.h, 0);
  if (refund) {
    var B = BUILDINGS[e.type];
    for (var k in B.cost) inventory[k] = (inventory[k] || 0) + B.cost[k];
    // 안에 들어 있던 것도 돌려준다 — 안 그러면 철거가 아이템 소각기가 된다
    for (var a in e.inv) inventory[a] = (inventory[a] || 0) + e.inv[a];
    for (var b in e.out) inventory[b] = (inventory[b] || 0) + e.out[b];
    // e.ammo 는 **발** 단위다 (탄창 1개 = SPEC.turretShotsPerAmmo 발). 발 개수를
    // 그대로 탄창 개수로 돌려주면 철거가 10배 복사기가 된다. 자투리 발은 못 돌려준다.
    if (e.type === 'turret' && e.ammo > 0) {
      var mags = Math.floor(e.ammo / SPEC.turretShotsPerAmmo);
      if (mags > 0) inventory['ammo'] = (inventory['ammo'] || 0) + mags;
    }
    // 발전기의 석탄은 e.inv 가 아니라 e.fuel(에너지)에 녹아 있다. 여기서 안 돌려주면
    // 바로 위 주석이 막으려던 그것 — 철거가 아이템 소각기 — 이 발전기에만 남는다.
    if (e.type === 'generator' && e.fuel > 0) {
      var coals = Math.floor(e.fuel / SPEC.coalEnergy);
      if (coals > 0) inventory['coal'] = (inventory['coal'] || 0) + coals;
    }
    if (e.held) inventory[e.held] = (inventory[e.held] || 0) + 1;   // 손에 쥔 것도 (안 그러면 소멸)
    if (e.cells) {
      for (var ci = 0; ci < e.cells.length; ci++) {
        var m = beltContents(e.cells[ci]);
        for (var mi in m) inventory[mi] = (inventory[mi] || 0) + m[mi];
      }
    }
  }
  delete entities[id];
  var oi = entOrder.indexOf(id);
  if (oi >= 0) entOrder.splice(oi, 1);
  // 유령 참조 제거 — 다른 제어기가 이 엔티티를 가리키고 있을 수 있다
  dropLogicRefs(id);
  // 편집 중이던 제어기를 철거하면 편집기를 닫는다. 안 그러면 죽은 그래프를 계속
  // 편집하게 되고, 그 편집은 아무 데도 반영되지 않는다.
  if (typeof closeLogicIfEditing === 'function') closeLogicIfEditing(id);
  if (typeof cancelPickIfTarget === 'function') cancelPickIfTarget(id);
  markBeltDirty();
  markPowerDirty();
  markLogicDirty();
  return true;
}

// 세계에 있는 물건을 플레이어 보유 자재로 옮긴다.
//
// 이게 없으면 게임이 막다른 길이 된다: 공장이 만든 것은 전부 상자·기계 버퍼에 쌓이는데
// 건물 비용과 손 조립은 보유 자재에서만 나가므로, 시작 지급분을 다 쓰면 상자가 가득
// 차 있어도 아무것도 못 짓는다. 예전엔 유일한 회수 경로가 "상자를 철거하는 것"이었다.
//
// 발전기 연료(이미 태울 에너지로 바뀐 것)와 터렛 탄약은 대상이 아니다 — 철거로만 회수한다.
function takeAllToStock(e) {
  if (!e) return 0;
  var moved = 0;
  function drain(bag) {
    for (var k in bag) {
      var n = bag[k];
      if (n > 0) { inventory[k] = (inventory[k] || 0) + n; moved += n; }
    }
  }
  drain(e.inv); e.inv = {};
  if (e.out) { drain(e.out); e.out = {}; }
  if (moved) { markPowerDirty(); markLogicDirty(); }
  return moved;
}
function stockTakeCount(e) {
  if (!e) return 0;
  return invTotal(e.inv || {}) + invTotal(e.out || {});
}

// 보유 자재 → 세계. takeAllToStock 의 반대편이다.
//
// 이 방향이 없으면 라인을 손으로 초기 급유(priming)할 수 없다. 보유 자재에 구리판이
// 126개 있어도 조립기에 못 넣어서, 레시피를 걸어 놓고도 왜 안 도는지 알 수 없다.
// 예전에는 발전기 석탄 버튼 하나만 이 방향이었다.
//
// **무엇을 받을지는 canAccept 가 정한다** — 인서터가 쓰는 것과 같은 판정이다.
// 따로 규칙을 쓰면 "인서터로는 들어가는데 손으로는 안 들어간다"가 반드시 생긴다.
var PUT_TYPES = { generator: 1, turret: 1, lab: 1, furnace: 1, assembler: 1 };

function stockPuttableItems(e) {
  var out = [];
  if (!e || !PUT_TYPES[e.type]) return out;
  for (var i = 0; i < ITEM_IDS.length; i++) {
    var k = ITEM_IDS[i];
    if ((inventory[k] || 0) > 0 && canAccept(e, k)) out.push(k);
  }
  return out;
}

// 출력 버퍼만 걷어온다. takeAllToStock 은 입력까지 비우는데, 기계에 그걸 쓰면
// 넣어 준 재료를 도로 뺏어서 영원히 완성되지 않는다 (자율 플레이어가 실제로 그랬다).
function takeOutputToStock(e) {
  if (!e || !e.out) return 0;
  var moved = 0;
  for (var k in e.out) {
    var n = e.out[k];
    if (n > 0) { inventory[k] = (inventory[k] || 0) + n; moved += n; }
  }
  e.out = {};
  if (moved) { markPowerDirty(); markLogicDirty(); }
  return moved;
}

function putFromStock(e) {
  if (!e || !PUT_TYPES[e.type]) return 0;
  var moved = 0, guard = 0;
  // **굽던 것의 재료를 먼저 시도한다.** 레시피가 풀린 용광로는 ITEM_IDS 선언 순서로
  // 처음 받아들여지는 광석에 굳는데(giveTo), 그 순서는 플레이어가 볼 수 없다 —
  // 철을 굽던 용광로에 [보유 자재 넣기]를 눌렀더니 구리를 굽기 시작하는 것이
  // 그래서 일어났다. 굽던 광석이 재고에 없을 때만 예전처럼 아무거나 받는다.
  var scan = ITEM_IDS;
  if (e.type === 'furnace' && !e.recipe && e.lastRecipe && RECIPES[e.lastRecipe]) {
    var pref = [];
    for (var pk in RECIPES[e.lastRecipe].inp) pref.push(pk);
    if (pref.length && (inventory[pref[0]] || 0) > 0) {
      scan = pref.concat(ITEM_IDS);
    }
  }
  for (var i = 0; i < scan.length; i++) {
    var k = scan[i];
    // canAccept 가 기계의 버퍼 한도를 이미 알고 있으므로 여기서 다시 세지 않는다.
    // guard 는 무한루프 방어일 뿐이고 정상 경로에서는 한도가 먼저 걸린다.
    while ((inventory[k] || 0) > 0 && canAccept(e, k) && guard++ < 20000) {
      if (!giveTo(e, k)) break;
      invTake(inventory, k, 1);
      moved++;
    }
  }
  if (moved) { markPowerDirty(); markLogicDirty(); }
  return moved;
}

// --- 인벤토리 헬퍼 ----------------------------------------------------------
function invCount(obj, k) { return obj[k] || 0; }
function invAdd(obj, k, n) { obj[k] = (obj[k] || 0) + n; }
function invTake(obj, k, n) {
  var have = obj[k] || 0;
  if (have < n) return false;
  obj[k] = have - n;
  if (obj[k] === 0) delete obj[k];
  return true;
}
function invTotal(obj) { var s = 0; for (var k in obj) s += obj[k]; return s; }

// --- 아이템 주고받기 --------------------------------------------------------
// 대상이 이 아이템을 받을 수 있는가 (인서터가 집기 전에 물어본다 — 교착 방지)
function canAccept(e, itemId) {
  if (!e) return false;
  switch (e.type) {
    case 'chest': return invTotal(e.inv) < SPEC.chestCap;
    case 'generator': return itemId === 'coal' && e.fuel < SPEC.coalEnergy * 20;
    case 'turret': return itemId === 'ammo' && e.ammo < 200;
    case 'lab': return (itemId === 'sci-red' || itemId === 'sci-green') && invCount(e.inv, itemId) < 100;
    case 'furnace':
    case 'assembler': {
      // 용광로에 레시피가 이미 걸려 있으면 **그 레시피의 입력만** 받는다.
      // 예전엔 '아무 제련 레시피나 받는' 판정이라, 철을 굽던 용광로가 구리광석도
      // 받아들이고는 영원히 안 쓰는 채로 입력 버퍼를 막았다.
      var rec = null;
      if (e.type === 'assembler') rec = e.recipe ? RECIPES[e.recipe] : null;
      else rec = e.recipe ? RECIPES[e.recipe] : furnaceRecipeFor(itemId);
      if (!rec) return false;
      if (!rec.inp[itemId]) return false;
      return invCount(e.inv, itemId) < SPEC.machineBufIn;
    }
    default: return false;
  }
}
function giveTo(e, itemId) {
  if (!canAccept(e, itemId)) return false;
  if (e.type === 'generator') { e.fuel += SPEC.coalEnergy; return true; }
  if (e.type === 'turret') { e.ammo += SPEC.turretShotsPerAmmo; return true; }
  if (e.type === 'furnace' && !e.recipe) e.recipe = furnaceRecipeIdFor(itemId);
  invAdd(e.inv, itemId, 1);
  return true;
}
// 대상에서 하나 꺼낸다 (필터 지정 가능)
function takeFrom(e, filter) {
  if (!e) return null;
  var src = null;
  if (e.type === 'chest') src = e.inv;
  else if (e.type === 'miner' || e.type === 'furnace' || e.type === 'assembler') src = e.out;
  else return null;
  if (filter) { return invTake(src, filter, 1) ? filter : null; }
  for (var k in src) { if (src[k] > 0) { invTake(src, k, 1); return k; } }
  return null;
}
function peekTake(e, filter) {
  if (!e) return null;
  var src = null;
  if (e.type === 'chest') src = e.inv;
  else if (e.type === 'miner' || e.type === 'furnace' || e.type === 'assembler') src = e.out;
  else return null;
  if (filter) return (src[filter] > 0) ? filter : null;
  for (var k in src) if (src[k] > 0) return k;
  return null;
}

function furnaceRecipeIdFor(itemId) {
  for (var r in RECIPES) {
    var rec = RECIPES[r];
    if (rec.cat !== 'smelt') continue;
    if (rec.inp[itemId]) { if (rec.tech && !techDone[rec.tech]) continue; return r; }
  }
  return null;
}
function furnaceRecipeFor(itemId) {
  var id = furnaceRecipeIdFor(itemId);
  return id ? RECIPES[id] : null;
}

// --- 기계 한 틱 --------------------------------------------------------------
var machineSpeedMul = 1;     // 생산 효율 연구
var machinePowerMul = 1;

function machineRecipeReady(e, rec) {
  for (var k in rec.inp) if (invCount(e.inv, k) < rec.inp[k]) return false;
  for (var o in rec.out) if (invCount(e.out, o) + rec.out[o] > SPEC.machineBufOut) return false;
  return true;
}

function stepCrafter(e, dt, speed) {
  // 용광로는 완전히 빈 순간 레시피를 놓는다 — 그래야 다음에 다른 광석을 넣으면
  // 그쪽으로 갈아탄다. 안 놓으면 철을 굽던 용광로가 영원히 구리를 거부한다.
  if (e.type === 'furnace' && e.recipe && e.progress === 0 &&
      invTotal(e.inv) === 0 && invTotal(e.out) === 0) {
    // 무엇을 굽고 있었는지는 남긴다. 레시피를 놓는 이유는 "다른 광석을 넣으면
    // 갈아탈 수 있게" 이지 "아무거나 먼저 온 것으로 바꾸려고" 가 아니다.
    e.lastRecipe = e.recipe;
    e.recipe = null;
  }
  var rec = e.recipe ? RECIPES[e.recipe] : null;
  if (!rec) { e.progress = 0; e.stallT += dt; e.working = false; return; }
  // **연구 조건은 시뮬에서도 지킨다.** 예전에는 UI 의 레시피 목록만 걸러서,
  // 그 목록을 지나지 않고 걸린 레시피(저장본·시험 훅)는 연구 없이도 돌았다.
  // 관문이 한 곳에만 있으면 그 곳을 안 지나는 길이 곧 구멍이다.
  if (rec.tech && !techDone[rec.tech]) { e.progress = 0; e.stallT += dt; e.working = false; return; }
  if (!e.enabled) { e.stallT += dt; e.working = false; return; }
  if (e.powerSat <= 0) { e.stallT += dt; e.working = false; return; }
  if (e.progress === 0 && !machineRecipeReady(e, rec)) { e.stallT += dt; e.working = false; return; }
  if (e.progress === 0) { for (var k in rec.inp) invTake(e.inv, k, rec.inp[k]); }

  e.working = true;
  e.stallT = 0;
  e.progress += (dt * speed * machineSpeedMul * e.powerSat) / rec.time;
  if (e.progress >= 1) {
    e.progress = 0;
    for (var o in rec.out) invAdd(e.out, o, rec.out[o]);
    // 누적 생산 통계 — 튜토리얼 판정이 쓴다. "지금 버퍼에 있는가"로 보면
    // 인서터가 빼 가는 순간을 놓쳐 영원히 다음 단계로 못 넘어간다.
    if (e.type === 'furnace') prodStats.smelted++;
    else prodStats.crafted++;
    prodStats.byRecipe[e.recipe] = (prodStats.byRecipe[e.recipe] || 0) + 1;
    emitPollution(e, 4);
  }
}

// 기계 출력 버퍼를 앞 타일 벨트로 밀어낸다 (채광기 전용 — 조립기·용광로는 인서터로 뺀다)
function pushToFront(e) {
  var d = e.dir;
  // 건물 앞변의 각 타일을 순서대로 시도
  var pts = [];
  if (d === 0) { for (var x = e.tx; x < e.tx + e.w; x++) pts.push([x, e.ty - 1]); }
  else if (d === 2) { for (var x2 = e.tx; x2 < e.tx + e.w; x2++) pts.push([x2, e.ty + e.h]); }
  else if (d === 1) { for (var y = e.ty; y < e.ty + e.h; y++) pts.push([e.tx + e.w, y]); }
  else { for (var y2 = e.ty; y2 < e.ty + e.h; y2++) pts.push([e.tx - 1, y2]); }
  for (var k in e.out) {
    if (e.out[k] <= 0) continue;
    for (var p = 0; p < pts.length; p++) {
      var c = cellAt(pts[p][0], pts[p][1]);
      if (c && beltAccept(c, k)) { invTake(e.out, k, 1); return true; }
      var te = entityAt(pts[p][0], pts[p][1]);
      if (te && te !== e && canAccept(te, k)) { giveTo(te, k); invTake(e.out, k, 1); return true; }
    }
  }
  return false;
}

function stepMiner(e, dt) {
  // **정지는 정지다.** 예전에는 꺼진 채광기도 pushToFront 로 버퍼를 계속 벨트에
  // 밀어냈다 — 제어기로 '정지' 시켜 놓고도 물건이 계속 나가면 정지가 아니다.
  // (전기가 없어 멈춘 경우도 같다.)
  if (!e.enabled || e.powerSat <= 0) { e.working = false; e.stallT += dt; return; }
  if (invTotal(e.out) >= SPEC.machineBufOut) { e.working = false; e.stallT += dt; pushToFront(e); return; }
  e.progress += dt * SPEC.minerRate * machineSpeedMul * e.powerSat;
  e.working = true;
  while (e.progress >= 1) {
    e.progress -= 1;
    var got = mineFrom(e.tx, e.ty, e.w, e.h);
    if (!got) { e.progress = 0; e.working = false; e.depleted = true; break; }
    e.depleted = false;
    invAdd(e.out, got, 1);
    emitPollution(e, 6);
  }
  pushToFront(e);
}

function stepGenerator(e, dt) {
  // 실제 출력은 전력망이 정한다 (e.load 0..1). 연료는 부하에 비례해 탄다.
  if (e.fuel > 0 && e.load > 0) {
    var kj = SPEC.genOutput * e.load * dt;
    e.fuel -= kj;
    if (e.fuel < 0) e.fuel = 0;
    // 매 틱 호출되므로 dt 를 곱해야 "초당" 배출이 된다.
    // 이걸 빠뜨려 60배로 뿜었고, 90초 만에 진화도 45%가 되는 것으로 드러났다.
    emitPollution(e, 20 * e.load * dt);
    e.working = true;
  } else {
    e.working = false;
  }
}

function stepLab(e, dt) {
  var t = currentResearch;
  if (!t || !e.enabled || e.powerSat <= 0) { e.working = false; return; }
  var need = TECHS[t].cost;
  for (var k in need) if (invCount(e.inv, k) < 1) { e.working = false; e.stallT += dt; return; }
  e.working = true; e.stallT = 0;
  var amt = dt * SPEC.labSpeed * machineSpeedMul * e.powerSat;
  e.researching += amt;
  while (e.researching >= 1) {
    e.researching -= 1;
    var ok = true;
    for (var k2 in need) if (invCount(e.inv, k2) < 1) ok = false;
    if (!ok) { e.researching = 0; break; }
    for (var k3 in need) invTake(e.inv, k3, 1);
    addResearchProgress(1);
  }
  emitPollution(e, 2 * dt);      // 틱마다 호출 → dt 필요 (발전기와 같은 함정)
}

// --- 인서터 ------------------------------------------------------------------
function inserterSource(e) { var d = dirOpp(e.dir); return { x: e.tx + DIR_DX[d], y: e.ty + DIR_DY[d] }; }
function inserterTarget(e) { return { x: e.tx + DIR_DX[e.dir], y: e.ty + DIR_DY[e.dir] }; }

function inserterCanPlace(e, itemId) {
  var t = inserterTarget(e);
  var c = cellAt(t.x, t.y);
  if (c) return laneHasRoom(c.lanes[0]) || laneHasRoom(c.lanes[1]);
  return canAccept(entityAt(t.x, t.y), itemId);
}
function inserterDoPlace(e, itemId) {
  var t = inserterTarget(e);
  var c = cellAt(t.x, t.y);
  if (c) return beltAccept(c, itemId);
  var te = entityAt(t.x, t.y);
  if (te && canAccept(te, itemId)) return giveTo(te, itemId);
  return false;
}
function inserterPeekSource(e) {
  var s = inserterSource(e);
  var c = cellAt(s.x, s.y);
  // beltPeek 은 beltTake 와 **같은 규칙**으로 고른다. 여기서 어긋나면
  // "놓을 수 있는지"를 A로 검사하고 B를 집어 영원히 쥔 채 굳는다.
  if (c) return beltPeek(c, e.filter);
  return peekTake(entityAt(s.x, s.y), e.filter);
}
function inserterGrab(e) {
  var s = inserterSource(e);
  var c = cellAt(s.x, s.y);
  if (c) return beltTake(c, e.filter);
  return takeFrom(entityAt(s.x, s.y), e.filter);
}

function stepInserter(e, dt) {
  if (!e.enabled) { e.working = false; e.stallT += dt; return; }
  if (e.powerSat <= 0) { e.working = false; e.stallT += dt; return; }
  var half = SPEC.inserterSwing / 2;
  var adv = (dt / half) * e.powerSat;

  if (e.phase === 0) {
    // 뒤로 뻗는 중 — 도착하면 집는다. 단 놓을 곳이 없으면 집지 않는다(자원 점유 금지).
    e.t += adv;
    if (e.t >= 1) {
      var peek = inserterPeekSource(e);
      if (peek === null || peek === undefined) { e.t = 1; e.working = false; e.stallT += dt; return; }
      if (!inserterCanPlace(e, peek)) { e.t = 1; e.working = false; e.stallT += dt; return; }
      var got = inserterGrab(e);
      if (got === null || got === undefined) { e.t = 1; e.working = false; e.stallT += dt; return; }
      e.held = got; e.phase = 1; e.t = 0; e.stallT = 0;
    }
    e.working = true;
  } else {
    e.t += adv;
    if (e.t >= 1) {
      if (inserterDoPlace(e, e.held)) {
        e.held = null; e.phase = 0; e.t = 0; e.stallT = 0;
      } else {
        e.t = 1; e.working = false; e.stallT += dt;   // 손에 쥔 채 대기
        return;
      }
    }
    e.working = true;
  }
}

// --- 오염 배출 ---------------------------------------------------------------
function emitPollution(e, perCraft) {
  addPollution(e.tx + (e.w >> 1), e.ty + (e.h >> 1), perCraft * 0.02);
}
