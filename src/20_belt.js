// ===========================================================================
//  20_belt.js — 벨트 물류 (2레인) + 분배기
//
//  레인 규약: lane 0 = 진행방향 기준 왼쪽, lane 1 = 오른쪽.
//  아이템은 { id, pos } 이고 pos 는 타일 진입변(0) → 진출변(1) 까지의 진행률.
//  한 레인 배열은 앞(pos 큰 것)부터 정렬돼 있다. lane[0] 이 선두.
//
//  처리 순서에 대한 주의 —
//    상류를 먼저 처리하면 하류의 낡은 위치를 보고 인계를 거절해 처리량이 조용히
//    몇 퍼센트 깎인다. 그래서 배치가 바뀔 때마다 "하류부터" 도는 순서를 위상정렬로
//    다시 만든다(beltOrder). 순환 벨트는 위상이 없으므로 뒤에 몰아 붙인다.
// ===========================================================================

var GAP = SPEC.beltSlotGap;          // 0.25 — 레인당 타일 4개
var beltSpeedMul = 1;                // 고속 벨트 연구로 2가 된다

function beltSpeed() { return SPEC.beltTilesPerSec * beltSpeedMul; }

// --- 셀 --------------------------------------------------------------------
function makeCell(ent, tx, ty, dir) {
  return { ent: ent, tx: tx, ty: ty, dir: dir, lanes: [[], []], gate: true };
}
function cellItemCount(c) { return c.lanes[0].length + c.lanes[1].length; }

// 이 타일의 벨트 셀을 찾는다 (벨트/분배기만 해당)
function cellAt(tx, ty) {
  var id = occAt(tx, ty);
  if (id <= 0) return null;
  var e = entities[id];
  if (!e || !e.cells) return null;
  for (var i = 0; i < e.cells.length; i++) {
    if (e.cells[i].tx === tx && e.cells[i].ty === ty) return e.cells[i];
  }
  return null;
}

// 진입 규약 — from 셀(진행 dFrom)이 to 셀(진행 dTo)로 넘길 때 도착 레인.
//  뒤에서 들어오면(직진/커브) 레인 유지, 옆에서 들어오면(사이드로드) 그 쪽 레인.
function entryLane(toCell, fromTx, fromTy, srcLane) {
  var dxFrom = fromTx - toCell.tx, dyFrom = fromTy - toCell.ty;
  var dFrom = -1;
  for (var d = 0; d < 4; d++) if (DIR_DX[d] === dxFrom && DIR_DY[d] === dyFrom) dFrom = d;
  if (dFrom < 0) return srcLane;
  if (dFrom === dirOpp(toCell.dir)) return srcLane;      // 정후방 → 레인 유지
  if (dFrom === dirCW(toCell.dir)) return 1;             // 오른쪽에서 → 오른쪽 레인
  if (dFrom === dirCCW(toCell.dir)) return 0;            // 왼쪽에서 → 왼쪽 레인
  return srcLane;                                        // 정면(역주행)은 인계 불가지만 방어적으로
}

// 셀이 아이템을 받을 수 있는가 — 맨 뒤 아이템이 GAP 만큼 비켜났는가
function laneHasRoom(lane) {
  if (lane.length === 0) return true;
  return lane[lane.length - 1].pos >= GAP;
}
function lanePush(lane, id, pos) {
  var back = lane.length ? lane[lane.length - 1].pos : Infinity;
  var p = clamp(pos, 0, Math.min(1, back - GAP));
  lane.push({ id: id, pos: p });
  return true;
}

// --- 출력 대상 --------------------------------------------------------------
// 벨트: 진행방향 다음 타일의 셀. 분배기: 두 출구 중 라운드로빈.
function outputTarget(cell, lane) {
  var e = cell.ent;
  if (e.type === 'splitter') return splitterOutput(e, cell, lane);
  var nx = cell.tx + DIR_DX[cell.dir], ny = cell.ty + DIR_DY[cell.dir];
  var t = cellAt(nx, ny);
  if (!t) return null;
  if (t.ent.type === 'belt' && dirOpp(t.dir) === cell.dir) return null;  // 정면 충돌 벨트
  return { cell: t, lane: entryLane(t, cell.tx, cell.ty, lane) };
}

function splitterOutput(e, cell, lane) {
  // 두 셀 각각의 앞 타일이 출구다. rr 로 번갈아 내보내되, 한쪽이 막히면 다른 쪽.
  var order = [e.rr, 1 - e.rr];
  if (e.outPrio === 0 || e.outPrio === 1) {
    // **cells[0] 은 언제나 좌표가 작은 쪽**이지 '왼쪽'이 아니다 (25_entity.js:116).
    // 이 집의 규약에서 왼쪽은 진행방향 기준이다 (레인 0 = dirCCW, 45_render.js:300).
    //   북(0): 왼쪽=서=cells[0] · 동(1): 왼쪽=북=cells[0]
    //   남(2): 왼쪽=동=cells[1] · 서(3): 왼쪽=남=cells[1]
    // 그래서 남·서향 분배기는 UI 에서 [왼쪽]을 고르면 오른쪽으로 나갔다.
    var L = (e.dir === 0 || e.dir === 1) ? 0 : 1;
    var first = (e.outPrio === 0) ? L : (1 - L);
    order = [first, 1 - first];
  }
  for (var k = 0; k < 2; k++) {
    var ci = order[k];
    var oc = e.cells[ci];
    var nx = oc.tx + DIR_DX[oc.dir], ny = oc.ty + DIR_DY[oc.dir];
    var t = cellAt(nx, ny);
    if (!t) continue;
    if (t.ent.type === 'belt' && dirOpp(t.dir) === oc.dir) continue;   // 정면 충돌 벨트
    var tl = entryLane(t, oc.tx, oc.ty, lane);
    // 게이트가 닫힌 출구를 고르면 호출자가 거절해 그 틱 인계가 통째로 실패한다.
    // 게다가 닫힌 셀은 stepBelts 가 건너뛰어 비지 않으므로 laneHasRoom 이 영원히 true 다
    // → 우선순위 쪽을 닫으면 열린 쪽이 텅 비어도 분배기가 영구 정체한다.
    if (!t.gate || !laneHasRoom(t.lanes[tl])) continue;
    if (e.outPrio === null || e.outPrio === undefined) e.rr = 1 - ci;
    return { cell: t, lane: tl };
  }
  return null;
}

// --- 처리 순서 (위상정렬) ---------------------------------------------------
var beltOrder = [];
var beltOrderDirty = true;

function markBeltDirty() { beltOrderDirty = true; }

function rebuildBeltOrder() {
  var cells = [];
  for (var id in entities) {
    var e = entities[id];
    if (e && e.cells) for (var i = 0; i < e.cells.length; i++) cells.push(e.cells[i]);
  }
  // 각 셀의 하류(출력 대상 셀)를 미리 구해 역방향 인접을 만든다
  var index = new Map();
  for (var c = 0; c < cells.length; c++) index.set(cells[c], c);
  var downstream = new Array(cells.length);
  var indeg = new Int32Array(cells.length);     // "하류가 몇 개인가" 가 아니라
  for (var c2 = 0; c2 < cells.length; c2++) {
    var cell = cells[c2];
    var outs = [];
    // 분배기는 두 출구 모두를 하류로 본다
    if (cell.ent.type === 'splitter') {
      for (var s = 0; s < cell.ent.cells.length; s++) {
        var oc = cell.ent.cells[s];
        var t0 = cellAt(oc.tx + DIR_DX[oc.dir], oc.ty + DIR_DY[oc.dir]);
        if (t0 && index.has(t0)) outs.push(index.get(t0));
      }
    } else {
      var t1 = cellAt(cell.tx + DIR_DX[cell.dir], cell.ty + DIR_DY[cell.dir]);
      if (t1 && index.has(t1) && !(t1.ent.type === 'belt' && dirOpp(t1.dir) === cell.dir)) {
        outs.push(index.get(t1));
      }
    }
    downstream[c2] = outs;
  }
  // 하류가 먼저 나와야 하므로, "상류 개수"로 위상정렬하는 대신
  // 하류 방향 간선을 뒤집어 (하류 -> 상류) 로 두고 진입차수 0 부터 뽑는다.
  var rev = new Array(cells.length);
  for (var r = 0; r < cells.length; r++) rev[r] = [];
  for (var a = 0; a < cells.length; a++) {
    for (var b = 0; b < downstream[a].length; b++) {
      rev[downstream[a][b]].push(a);
      indeg[a]++;                                  // a 는 자기 하류가 처리된 뒤에 와야 한다
    }
  }
  var queue = [], out = [];
  for (var q = 0; q < cells.length; q++) if (indeg[q] === 0) queue.push(q);
  while (queue.length) {
    var n = queue.shift();
    out.push(cells[n]);
    for (var m = 0; m < rev[n].length; m++) {
      if (--indeg[rev[n][m]] === 0) queue.push(rev[n][m]);
    }
  }
  // 순환(벨트 루프)에 남은 셀은 위상이 없다 — 뒤에 그대로 붙인다
  if (out.length < cells.length) {
    var seen = new Set(out);
    for (var z = 0; z < cells.length; z++) if (!seen.has(cells[z])) out.push(cells[z]);
  }
  beltOrder = out;
  beltOrderDirty = false;
}

// --- 한 틱 진행 --------------------------------------------------------------
var beltStats = { delivered: 0 };     // 인계 성공 횟수 — 처리량 게이트가 읽는다

function stepBelts(dt) {
  if (beltOrderDirty) rebuildBeltOrder();
  var move = beltSpeed() * dt;
  for (var ci = 0; ci < beltOrder.length; ci++) {
    var cell = beltOrder[ci];
    if (!cell.gate) continue;                   // 제어기가 닫은 게이트
    for (var li = 0; li < 2; li++) {
      var lane = cell.lanes[li];
      for (var i = 0; i < lane.length; i++) {
        var it = lane[i];
        var cap;
        if (i === 0) {
          // 선두 — 타일 끝까지 가고, 넘으면 인계 시도
          var want = it.pos + move;
          if (want >= 1) {
            var tgt = outputTarget(cell, li);
            if (tgt && tgt.cell.gate && laneHasRoom(tgt.cell.lanes[tgt.lane])) {
              lane.shift();
              lanePush(tgt.cell.lanes[tgt.lane], it.id, want - 1);
              beltStats.delivered++;
              i--;                              // 배열이 당겨졌으므로 같은 인덱스를 다시
              continue;
            }
            it.pos = 1;
          } else {
            it.pos = want;
          }
        } else {
          cap = lane[i - 1].pos - GAP;
          it.pos = Math.min(it.pos + move, cap);
          if (it.pos < 0) it.pos = 0;
        }
      }
    }
  }
}

// --- 외부 투입/회수 (기계·인서터가 쓴다) --------------------------------------
// 기계가 벨트에 뱉을 때: 뒤쪽 여유가 있는 레인 하나에 넣는다.
function beltAccept(cell, itemId, preferLane) {
  if (!cell || !cell.gate) return false;
  var order = (preferLane === 0 || preferLane === 1) ? [preferLane, 1 - preferLane] : [0, 1];
  for (var k = 0; k < 2; k++) {
    var lane = cell.lanes[order[k]];
    if (laneHasRoom(lane)) { lanePush(lane, itemId, 0); return true; }
  }
  return false;
}
// 인서터가 집을 때: 타일 중앙(pos 0.5)에 가장 가까운 아이템. 필터가 있으면 그것만.
//
// 고르는 규칙은 beltPeek 과 **반드시 같아야 한다.** 예전엔 peek 이 레인 배열의 첫
// 원소(선두)를 보고 take 는 중앙 최근접을 집어서, 정체된 벨트(1.0/0.75/0.5/0.25로
// 꽉 찬 상태 — 기계 앞에서 늘 일어난다)에서 서로 다른 아이템을 가리켰다.
// 그러면 "놓을 수 있는지"를 A로 검사하고 B를 집어, 못 놓는 B를 영원히 쥔 채 굳는다.
function beltPick(cell, filter) {
  if (!cell) return null;
  var bestLane = -1, bestIdx = -1, bestD = 99;
  for (var li = 0; li < 2; li++) {
    var lane = cell.lanes[li];
    for (var i = 0; i < lane.length; i++) {
      if (filter && lane[i].id !== filter) continue;
      var d = Math.abs(lane[i].pos - 0.5);
      if (d < bestD) { bestD = d; bestLane = li; bestIdx = i; }
    }
  }
  return bestLane < 0 ? null : { lane: bestLane, idx: bestIdx, id: cell.lanes[bestLane][bestIdx].id };
}
function beltPeek(cell, filter) {
  var p = beltPick(cell, filter);
  return p ? p.id : null;
}
function beltTake(cell, filter) {
  var p = beltPick(cell, filter);
  if (!p) return null;
  return cell.lanes[p.lane].splice(p.idx, 1)[0].id;
}
// 벨트 위 내용물 세기 — 제어기의 벨트 센서, 그리고 저장에 쓴다.
function beltContents(cell, into) {
  var m = into || {};
  for (var li = 0; li < 2; li++) {
    var lane = cell.lanes[li];
    for (var i = 0; i < lane.length; i++) m[lane[i].id] = (m[lane[i].id] || 0) + 1;
  }
  return m;
}
