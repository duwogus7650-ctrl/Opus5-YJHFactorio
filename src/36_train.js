// ===========================================================================
//  36_train.js — 레일 · 역 · 열차
//
//  왜 넣었나: 광맥은 멀수록 크고 풍부한데(10_world.js), 벨트로 60타일을 끌면
//  벨트값이 광석값을 넘는다. 기차는 **먼 광맥을 쓸 이유**를 만든다.
//
//  이 게임다운 부분은 마지막 한 가지다 — **출발 허가.** 열차는 세 조건 중 하나로
//  떠난다: 화물이 다 찼거나, 정차 시간이 지났거나, **제어기가 보내라고 했을 때.**
//  셋째가 있어서 "저쪽 상자가 비었을 때만 보낸다" 같은 배차가 회로가 된다.
//
//  v1 의 경계 (알려진 한계로 문서에도 적는다):
//    · 레일은 격자 위 1×1 타일이고 방향이 없다. 직각 코너까지만 — 대각선·곡선 없음
//    · 신호기·다중 편성·교차 통제 없음. 한 노선에 열차 한 대를 전제한다
//    · 연료를 안 먹는다. 정전과 무관하게 돈다
//  이 넷은 "아직 안 만든 것"이지 "안 되는 것"이 아니다. 넣을 때는 신호기부터다.
//
//  속도는 **설계값이다.** Factorio 기관차 최고속도는 82 타일/s 인데 이 맵은 한 변이
//  160타일이라 그대로 쓰면 2초에 횡단한다 — 숫자가 우스워진다. 8 타일/s 로 두어
//  횡단에 20초가 걸리게 했다(SPEC.trainSpeed). 게이트는 그 값으로 정확히 잰다.
// ===========================================================================

var trains = [];           // 열차는 점유맵에 안 들어간다 (아래 주석 참고)
var railDirty = true;
function markRailDirty() { railDirty = true; }

function isRail(tx, ty) {
  var e = entityAt(tx, ty);
  return !!(e && e.type === 'rail');
}
// 역은 레일 옆에 선다. 어느 레일 칸에 붙었는지가 곧 정차 위치다.
function stationRailTile(st) {
  for (var d = 0; d < 4; d++) {
    var x = st.tx + DIR_DX[d], y = st.ty + DIR_DY[d];
    if (isRail(x, y)) return { x: x, y: y };
  }
  return null;
}

// --- 경로 ------------------------------------------------------------------
// 레일 그래프에서 두 칸 사이 최단 경로. 폭 우선 — 격자에 가중치가 없으므로
// 그게 곧 최단이고, 무엇보다 **결정론적**이다(같은 배치면 늘 같은 경로).
// 방문 순서를 DIR 순서로 고정해 두면 동점일 때도 흔들리지 않는다.
function railPath(from, to) {
  if (!from || !to) return null;
  if (from.x === to.x && from.y === to.y) return [{ x: from.x, y: from.y }];
  var prev = {}, seen = {};
  var key = function (x, y) { return x + ',' + y; };
  var q = [{ x: from.x, y: from.y }];
  seen[key(from.x, from.y)] = 1;
  var guard = 0;
  while (q.length && guard++ < 40000) {
    var cur = q.shift();
    for (var d = 0; d < 4; d++) {
      var nx = cur.x + DIR_DX[d], ny = cur.y + DIR_DY[d];
      if (!inBounds(nx, ny) || seen[key(nx, ny)] || !isRail(nx, ny)) continue;
      seen[key(nx, ny)] = 1;
      prev[key(nx, ny)] = cur;
      if (nx === to.x && ny === to.y) {
        var path = [{ x: nx, y: ny }], p = cur;
        while (p) { path.push({ x: p.x, y: p.y }); p = prev[key(p.x, p.y)]; }
        path.reverse();
        return path;
      }
      q.push({ x: nx, y: ny });
    }
  }
  return null;      // 이어지지 않았다 — 열차는 안 움직인다(억지로 가로지르지 않는다)
}

// 이 열차가 설 수 있는 역 목록. **id 순**으로 돈다 — 화면에 안 나오는 순서로
// 돌면 플레이어가 다음 목적지를 예측할 수 없다. id 는 건설 순서라 최소한
// "먼저 지은 역부터"라고 설명할 수 있다.
function trainStations(tr) {
  var list = [];
  forEachEntity(function (e) {
    if (e.type !== 'station') return;
    var rt = stationRailTile(e);
    if (!rt) return;
    if (!railPath({ x: tr.x, y: tr.y }, rt)) return;
    list.push(e);
  });
  list.sort(function (a, b) { return a.id - b.id; });
  return list;
}

// --- 열차 ------------------------------------------------------------------
// **점유맵에 안 넣는다.** 한 칸에는 엔티티 id 하나만 들어가는데 그 자리는 이미
// 레일이 쓰고 있다. 열차를 억지로 넣으면 지나갈 때마다 레일의 점유가 지워져
// 철거·배치가 통째로 어긋난다. 대신 trainAt() 로 찾고, 인서터가 대상을 푸는
// 한 곳에서만 그걸 본다.
function addTrain(tx, ty) {
  if (!isRail(tx, ty)) return null;
  if (trainAt(tx, ty)) return null;
  var tr = { id: 'T' + (trains.length + 1) + ':' + tx + ',' + ty,
             x: tx, y: ty, path: null, step: 0, target: null,
             inv: {}, waitT: 0, moving: false, lastWhy: '대기' };
  trains.push(tr);
  return tr;
}
function trainAt(tx, ty) {
  for (var i = 0; i < trains.length; i++) {
    if (Math.round(trains[i].x) === tx && Math.round(trains[i].y) === ty) return trains[i];
  }
  return null;
}
function trainCargo(tr) { var s = 0; for (var k in tr.inv) s += tr.inv[k]; return s; }

// 이 역에 지금 정차 중인 열차 (제어기 센서와 인서터가 쓴다)
function trainAtStation(st) {
  var rt = stationRailTile(st);
  if (!rt) return null;
  var tr = trainAt(rt.x, rt.y);
  return (tr && !tr.moving) ? tr : null;
}

function stepTrains(dt) {
  for (var i = 0; i < trains.length; i++) {
    var tr = trains[i];
    var here = { x: Math.round(tr.x), y: Math.round(tr.y) };
    if (!isRail(here.x, here.y)) { tr.lastWhy = '레일 없음'; tr.moving = false; continue; }

    if (tr.moving && tr.path) {
      // 경로를 타일 단위로 따라간다. 속도 × dt — 여기서 dt 를 빼면 60배가 된다.
      var adv = SPEC.trainSpeed * dt;
      while (adv > 0 && tr.step < tr.path.length - 1) {
        var nxt = tr.path[tr.step + 1];
        var dx = nxt.x - tr.x, dy = nxt.y - tr.y;
        var dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= adv) {
          tr.x = nxt.x; tr.y = nxt.y; tr.step++; adv -= dist;
        } else {
          tr.x += (dx === 0 ? 0 : (dx > 0 ? adv : -adv));
          tr.y += (dy === 0 ? 0 : (dy > 0 ? adv : -adv));
          adv = 0;
        }
      }
      if (tr.step >= tr.path.length - 1) {
        tr.x = tr.path[tr.path.length - 1].x;
        tr.y = tr.path[tr.path.length - 1].y;
        tr.moving = false; tr.waitT = 0; tr.path = null;
        tr.lastWhy = '정차';
      }
      continue;
    }

    // 정차 중 — 떠날 이유를 찾는다
    tr.waitT += dt;
    var sts = trainStations(tr);
    if (sts.length < 2) { tr.lastWhy = sts.length ? '갈 곳이 없다(역 1개)' : '역이 없다'; continue; }

    // 지금 서 있는 역이 몇 번째인가 → 다음 역
    var curIdx = -1;
    for (var s = 0; s < sts.length; s++) {
      var rt = stationRailTile(sts[s]);
      if (rt && rt.x === here.x && rt.y === here.y) { curIdx = s; break; }
    }
    var nextSt = sts[(curIdx + 1) % sts.length];
    var nrt = stationRailTile(nextSt);
    if (!nrt) { tr.lastWhy = '역이 레일에 안 붙었다'; continue; }

    // **출발 조건.** 이 역에 [열차 출발] 노드가 물려 있으면 **제어기가 전부 정한다** —
    // 참이면 보내고 거짓이면 붙잡는다. 안 물려 있으면 기본 규칙으로 돌아간다:
    // 화물이 다 찼거나(더 실을 게 없다) 정차 시간이 지났을 때. 배선 없이도 게임이
    // 돌아야 하므로 기본값이 '언젠가는 간다' 여야 한다.
    var curSt = (curIdx >= 0) ? sts[curIdx] : null;
    if (curSt && curSt.trainCtl) {
      if (curSt.holdTrain) { tr.lastWhy = '출발 보류(제어기)'; continue; }
    } else {
      var full = trainCargo(tr) >= SPEC.trainCargoCap;
      var timeUp = tr.waitT >= SPEC.trainDwell;
      if (!(full || timeUp)) { tr.lastWhy = '적재 중'; continue; }
    }

    var path = railPath(here, nrt);
    if (!path) { tr.lastWhy = '경로 없음'; continue; }
    tr.path = path; tr.step = 0; tr.moving = true;
    tr.lastWhy = '이동 중';
  }
}

// 열차 화물은 상자와 같은 규약으로 주고받는다 — 화차는 움직이는 상자다.
function trainCanAccept(tr, itemId) {
  return !!tr && !tr.moving && trainCargo(tr) < SPEC.trainCargoCap && !!itemId;
}
function trainGive(tr, itemId) {
  if (!trainCanAccept(tr, itemId)) return false;
  invAdd(tr.inv, itemId, 1);
  return true;
}
function trainPeek(tr, filter) {
  if (!tr || tr.moving) return null;
  for (var k in tr.inv) {
    if (tr.inv[k] > 0 && (!filter || k === filter)) return k;
  }
  return null;
}
function trainTake(tr, itemId) {
  if (!tr || tr.moving) return false;
  return invTake(tr.inv, itemId, 1);
}
