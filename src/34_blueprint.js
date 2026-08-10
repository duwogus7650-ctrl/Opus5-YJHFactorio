// ===========================================================================
//  34_blueprint.js — 청사진: 영역을 통째로 복사해 다시 짓는다
//
//  **이 게임에서 청사진의 값은 배선이다.** 벨트와 기계만 복사하는 것은 편의지만,
//  제어기의 규칙·노드 그래프까지 따라오면 "잘 도는 라인 하나"를 통째로 늘릴 수
//  있다. 그게 없으면 두 번째 라인을 만들 때마다 회로를 손으로 다시 그려야 한다.
//
//  세 가지를 못 박아 둔다.
//
//  * **내용물은 복사하지 않는다.** 벨트 위 아이템·상자 재고·보일러 연료는 계획이
//    아니라 화물이다. 함께 복사하면 청사진이 복제기가 되고 물질수지가 깨진다.
//  * **붙여넣기는 플레이어와 같은 길로 짓는다.** placeEntity(free=false) 를 쓰므로
//    재료가 나가고 연구도 요구한다. 공짜로 지으면 청사진이 치트가 된다.
//  * **영역 밖을 가리키는 제어기 참조는 끊는다.** 원본을 계속 가리키게 두면 붙여넣은
//    사본이 남의 기계를 지배한다 — "왜 멈췄는지 알 수 없는" 현상이 되고, 이 게임이
//    가장 싫어하는 실패다. 영역 안 참조는 새 id 로 갈아 끼운다.
//
//  전부-아니면-전무가 아니다. 막힌 칸·모자란 재료는 그 항목만 건너뛰고 나머지를
//  짓는다 — 큰 청사진이 한 칸 때문에 영영 안 붙는 것이 더 나쁘다. 대신 몇 개를
//  왜 건너뛰었는지 돌려준다.
// ===========================================================================

var blueprint = null;      // { w, h, ents: [...] } — 저장에 실린다
var bpSelStart = null;     // 선택 드래그 시작 타일 (UI 가 채운다)

// 청사진 한 항목: 상대 좌표 + 다시 지을 때 필요한 설정만.
// 화물(inv/out/fuel/cells)은 일부러 뺀다.
function bpItemFrom(e, ox, oy) {
  // srcId 는 **청사진 안에서만 쓰는 열쇠**다. 붙여넣을 때 "이 항목이 원래 몇 번이었나"
  // 를 알아야 제어기 참조를 새 id 로 갈아 끼울 수 있다. 저장본에 실려도 세계의 id 와
  // 대조하지 않으므로 낡아도 무해하다 — 대응표의 키로만 쓴다.
  var it = { srcId: e.id, dx: e.tx - ox, dy: e.ty - oy, t: e.type, d: e.dir };
  if (e.recipe) it.rec = e.recipe;
  if (e.type === 'splitter' && e.outPrio) it.prio = e.outPrio;
  if (e.type === 'inserter' && e.playerFilter) it.pf = e.playerFilter;
  if (e.playerEnabled === false) it.off = 1;
  if (e.type === 'controller') {
    // 규칙과 그래프를 **깊은 사본**으로 담는다. 얕게 담으면 원본을 편집할 때
    // 청사진이 같이 바뀌고, 그건 플레이어가 짐작할 수 없는 동작이다.
    it.rules = JSON.parse(JSON.stringify(e.rules || []));
    it.nrid = e.nextRuleId || 1;
    it.he = !!e.handEdited;
    if (e.graph) {
      it.g = {
        nextNid: e.graph.nextNid,
        nodes: e.graph.nodes.map(function (n) {
          return { nid: n.nid, k: n.kind, x: n.x, y: n.y,
                   cfg: JSON.parse(JSON.stringify(n.cfg)) };
        }),
        links: e.graph.links.map(function (l) { return [l.fn, l.fp, l.tn, l.tp]; })
      };
    }
  }
  return it;
}

// 영역 안에 **완전히** 들어온 건물만 담는다. 걸친 것을 담으면 붙여넣을 때
// 잘린 건물이 생기고, 그건 청사진이 아니라 파편이다.
function captureBlueprint(x0, y0, x1, y1) {
  var ax = Math.min(x0, x1), ay = Math.min(y0, y1);
  var bx = Math.max(x0, x1), by = Math.max(y0, y1);
  var seen = {}, items = [];
  for (var y = ay; y <= by; y++) {
    for (var x = ax; x <= bx; x++) {
      if (!inBounds(x, y)) continue;
      var e = entityAt(x, y);
      if (!e || seen[e.id]) continue;
      seen[e.id] = 1;
      if (e.tx < ax || e.ty < ay || e.tx + e.w - 1 > bx || e.ty + e.h - 1 > by) continue;
      items.push(bpItemFrom(e, ax, ay));
    }
  }
  if (!items.length) { blueprint = null; return { count: 0, w: 0, h: 0 }; }
  blueprint = { w: bx - ax + 1, h: by - ay + 1, ents: items };
  return { count: items.length, w: blueprint.w, h: blueprint.h };
}

// --- 회전 -------------------------------------------------------------------
// **좌표를 돌리는 것과 방향을 돌리는 것은 따로다.** 항목의 상대 좌표를 90도 돌리고,
// 그 항목 자신의 dir 도 한 칸 돌린다. 둘 중 하나만 하면 벨트가 제자리에서 엉뚱한
// 곳을 가리키거나(방향만), 라인 모양은 돌았는데 흐름은 옛 방향 그대로가 된다(좌표만).
//
// 크기는 **지금 방향 기준의 실제 발자국**을 써야 한다. 분배기는 2x1 인데 dir 1·3
// 에서는 1x2 로 서므로(canPlace 가 그렇게 정한다), 정의값 w·h 를 그대로 쓰면 회전
// 뒤 자리가 한 칸씩 어긋난다. 그 규칙을 여기서 다시 쓰지 않고 같은 식을 부른다.
function bpEffSize(type, dir) {
  var B = BUILDINGS[type];
  if (!B) return [1, 1];
  var w = B.w, h = B.h;
  if (B.rot && (dir === 1 || dir === 3) && w !== h) { var t = w; w = h; h = t; }
  return [w, h];
}

// 시계 방향 90도. (x, y) → (H-1-y, x) 이고, 직사각형은 좌상단이 바뀐다:
//   새 좌상단 = (H - dy - h, dx),  새 크기 = (h, w)
// **네 번 돌리면 원래대로**여야 한다 — 그 성질이 게이트의 오라클이다. 좌표만 맞고
// dir 이 안 돌면 4회전이 제자리로 안 온다.
function rotateBlueprint() {
  if (!blueprint) return null;
  var H = blueprint.h;
  var ents = blueprint.ents.map(function (it) {
    var s = bpEffSize(it.t, it.d);
    var n = JSON.parse(JSON.stringify(it));
    n.dx = H - it.dy - s[1];
    n.dy = it.dx;
    n.d = dirCW(it.d | 0);
    return n;
  });
  blueprint = { w: blueprint.h, h: blueprint.w, ents: ents };
  return { w: blueprint.w, h: blueprint.h, count: ents.length };
}

// 이 청사진을 다 지으려면 무엇이 얼마나 드는가 (UI 가 보여 준다)
function blueprintCost(bp) {
  bp = bp || blueprint;
  var cost = {};
  if (!bp) return cost;
  for (var i = 0; i < bp.ents.length; i++) {
    var B = BUILDINGS[bp.ents[i].t];
    if (!B) continue;
    for (var k in B.cost) cost[k] = (cost[k] || 0) + B.cost[k];
  }
  return cost;
}

// 제어기의 세계-엔티티 참조를 새 id 로 갈아 끼운다. **영역 밖이면 끊는다.**
function bpRemapEnt(oldId, idMap) {
  if (oldId === null || oldId === undefined) return null;
  var n = idMap[oldId];
  return (n === undefined) ? null : n;
}

function pasteBlueprint(tx, ty) {
  if (!blueprint) return { placed: 0, skipped: 0, why: '청사진이 비어 있다' };
  var idMap = {};          // 원본 id → 새 id ... 가 아니라 **청사진 항목 색인 → 새 id**
  var placedEnts = [];
  var skipped = 0, whyFirst = null;

  // 1차: 건물을 짓는다. 플레이어와 같은 길(비용·기술 검사)로 짓는다.
  for (var i = 0; i < blueprint.ents.length; i++) {
    var it = blueprint.ents[i];
    var e = placeEntity(it.t, tx + it.dx, ty + it.dy, it.d, false);
    if (!e) {
      skipped++;
      if (!whyFirst) {
        var chk = canPlace(it.t, tx + it.dx, ty + it.dy, it.d, false);
        whyFirst = (chk && chk.why) ? chk.why : '배치 실패';
      }
      placedEnts.push(null);
      continue;
    }
    placedEnts.push(e);
    if (it.srcId !== undefined) idMap[it.srcId] = e.id;
  }

  // 2차: 설정을 얹는다. 참조 재사상은 **전부 지어진 뒤**에 해야 한다 —
  // 1차 도중에 하면 아직 안 지어진 이웃을 가리킬 수 없다.
  for (var j = 0; j < blueprint.ents.length; j++) {
    var it2 = blueprint.ents[j], e2 = placedEnts[j];
    if (!e2) continue;
    if (it2.rec) e2.recipe = it2.rec;
    if (it2.prio) e2.outPrio = it2.prio;
    if (it2.pf) { e2.playerFilter = it2.pf; e2.filter = it2.pf; }
    if (it2.off) { e2.playerEnabled = false; e2.enabled = false; }
    if (it2.t === 'controller') {
      e2.rules = JSON.parse(JSON.stringify(it2.rules || []));
      e2.nextRuleId = it2.nrid || 1;
      e2.handEdited = !!it2.he;
      for (var r = 0; r < e2.rules.length; r++) {
        var ru = e2.rules[r];
        if (ru.when) ru.when.ent = bpRemapEnt(ru.when.ent, idMap);
        if (ru.then) ru.then.ent = bpRemapEnt(ru.then.ent, idMap);
        for (var a = 0; a < ((ru.when && ru.when.and) || []).length; a++) {
          ru.when.and[a].ent = bpRemapEnt(ru.when.and[a].ent, idMap);
        }
      }
      if (it2.g) {
        e2.graph = newGraph();
        e2.graph.nextNid = it2.g.nextNid;
        e2.graph.nodes = it2.g.nodes.map(function (n) {
          var d = NODE_DEFS[n.k];
          if (!d) return null;
          var cfg = JSON.parse(JSON.stringify(n.cfg));
          if (cfg.ent !== undefined) cfg.ent = bpRemapEnt(cfg.ent, idMap);
          var nn = { nid: n.nid, kind: n.k, x: n.x, y: n.y, cfg: cfg,
                     state: {}, out: [], prev: [] };
          for (var q = 0; q < d.outs.length; q++) { nn.out.push(0); nn.prev.push(0); }
          return nn;
        }).filter(function (n) { return !!n; });
        var valid = {};
        for (var v = 0; v < e2.graph.nodes.length; v++) valid[e2.graph.nodes[v].nid] = 1;
        e2.graph.links = it2.g.links
          .filter(function (l) { return valid[l[0]] && valid[l[2]]; })
          .map(function (l) { return { fn: l[0], fp: l[1], tn: l[2], tp: l[3] }; });
        e2.graph.dirty = true;
      }
      // 규칙이 있고 손으로 안 고친 제어기는 문장이 1급이다 — 다시 컴파일한다.
      if (e2.rules.length && !e2.handEdited) compileRules(e2);
    }
  }
  markPowerDirty(); markFluidDirty(); markLogicDirty(); markBeltDirty();
  return { placed: placedEnts.filter(function (e) { return !!e; }).length,
           skipped: skipped, why: whyFirst };
}
