// ===========================================================================
//  10_world.js — 격자 세계: 지형, 광맥, 나무, 점유맵, 오염 격자
//
//  좌표 규약: 타일 좌표 (tx, ty) 는 정수. 월드 좌표는 타일 단위 실수.
//  픽셀 변환은 렌더러에서만 한다 — 시뮬레이션은 픽셀을 모른다.
// ===========================================================================

var ORE_NONE = 0, ORE_IRON = 1, ORE_COPPER = 2, ORE_COAL = 3, ORE_STONE = 4;
var ORE_ITEM = [null, 'iron-ore', 'copper-ore', 'coal', 'stone'];
var ORE_COLOR = [null, '#8593a0', '#c87941', '#22222a', '#a89880'];

var PW = Math.ceil(W / SPEC.pollutionPerChunk);   // 오염 격자 가로
var PH = Math.ceil(H / SPEC.pollutionPerChunk);

var world = {
  terr: new Uint8Array(W * H),      // 0..3 잔디 변주
  ore: new Uint8Array(W * H),
  oreAmt: new Uint16Array(W * H),
  tree: new Uint8Array(W * H),      // 0 없음, 1..3 나무 변주
  occ: new Int32Array(W * H),       // 엔티티 id (0 = 빈 칸)
  poll: new Float32Array(PW * PH),  // 오염량
  pollNext: new Float32Array(PW * PH),
  spawnX: (W / 2) | 0,
  spawnY: (H / 2) | 0,
  totalPollution: 0,                // 누적 발생량 (진화도 계산용)
  absorbedByTrees: 0,
  minedTotal: 0                     // 땅에서 뽑아낸 총 개수 — 물질수지 게이트의 좌변
};

function pidx(px, py) { return py * PW + px; }
function pollAtTile(tx, ty) {
  var px = (tx / SPEC.pollutionPerChunk) | 0, py = (ty / SPEC.pollutionPerChunk) | 0;
  if (px < 0 || py < 0 || px >= PW || py >= PH) return 0;
  return world.poll[pidx(px, py)];
}
function addPollution(tx, ty, amt) {
  var px = (tx / SPEC.pollutionPerChunk) | 0, py = (ty / SPEC.pollutionPerChunk) | 0;
  if (px < 0 || py < 0 || px >= PW || py >= PH) return;
  world.poll[pidx(px, py)] += amt;
  world.totalPollution += amt;
}

// --- 광맥 한 덩이 심기 -----------------------------------------------------
// 중심에서 멀어질수록 매장량이 줄어드는 타원 블롭. 가장자리가 각지지 않게
// 잡음으로 반지름을 흔든다.
function plantOre(cx, cy, type, radius, richness, rng) {
  var wob = [];
  for (var a = 0; a < 16; a++) wob.push(0.7 + rng.next() * 0.6);
  var placed = 0;
  var r2 = radius * radius;
  for (var y = Math.max(0, cy - radius - 2); y <= Math.min(H - 1, cy + radius + 2); y++) {
    for (var x = Math.max(0, cx - radius - 2); x <= Math.min(W - 1, cx + radius + 2); x++) {
      var dx = x - cx, dy = y - cy;
      var ang = Math.atan2(dy, dx);
      var wi = ((ang + Math.PI) / (2 * Math.PI) * 16) | 0;
      var wobA = wob[wi % 16], wobB = wob[(wi + 1) % 16];
      var wf = lerp(wobA, wobB, ((ang + Math.PI) / (2 * Math.PI) * 16) % 1);
      var rr = radius * wf;
      var d2 = dx * dx + dy * dy;
      if (d2 > rr * rr) continue;
      var f = 1 - Math.sqrt(d2) / rr;                   // 0..1, 중심이 1
      var amt = Math.floor(richness * (0.35 + 0.65 * f * f));
      if (amt <= 0) continue;
      var i = idx(x, y);
      if (world.oreAmt[i] >= amt) continue;             // 겹치면 많은 쪽이 이긴다
      world.ore[i] = type;
      world.oreAmt[i] = Math.min(65000, amt);
      world.tree[i] = 0;                                 // 광맥 위엔 나무가 없다
      placed++;
    }
  }
  void r2;
  return placed;
}

// --- 세계 생성 -------------------------------------------------------------
function generateWorld(seed) {
  RNG.reseed(seed >>> 0);
  var n1 = makeNoise(seed ^ 0x1234);
  var n2 = makeNoise(seed ^ 0x9abc);

  world.terr.fill(0); world.ore.fill(0); world.oreAmt.fill(0);
  world.tree.fill(0); world.occ.fill(0);
  world.poll.fill(0); world.pollNext.fill(0);
  world.totalPollution = 0;
  world.absorbedByTrees = 0;
  world.minedTotal = 0;

  var cx = world.spawnX, cy = world.spawnY;

  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var i = idx(x, y);
      var v = n1.fbm(x, y, 4, 0.06);
      world.terr[i] = v < 0.42 ? 0 : (v < 0.52 ? 1 : (v < 0.62 ? 2 : 3));
      // 나무: 다른 주파수의 잡음이 임계 이상인 곳에 숲을 이룬다
      var t = n2.fbm(x + 500, y + 500, 3, 0.09);
      var dc = dist(x, y, cx, cy);
      if (t > 0.60 && dc > 14) world.tree[i] = 1 + ((t * 37) | 0) % 3;
    }
  }

  // 시작 광맥 — 스폰 주변에 4종을 반드시 하나씩. 없으면 게임이 시작되지 않는다.
  var startRing = [
    { t: ORE_IRON,   ang: -0.6, d: 13, r: 6, rich: 3000 },
    { t: ORE_COPPER, ang: 1.9,  d: 14, r: 5, rich: 2600 },
    { t: ORE_COAL,   ang: 3.6,  d: 12, r: 5, rich: 3000 },
    { t: ORE_STONE,  ang: 5.1,  d: 15, r: 4, rich: 2000 }
  ];
  for (var s = 0; s < startRing.length; s++) {
    var o = startRing[s];
    var ox = Math.round(cx + Math.cos(o.ang) * o.d);
    var oy = Math.round(cy + Math.sin(o.ang) * o.d);
    plantOre(ox, oy, o.t, o.r, o.rich, RNG);
  }

  // 바깥 광맥 — 멀수록 크고 풍부하다. 확장할 이유를 만든다.
  var types = [ORE_IRON, ORE_IRON, ORE_COPPER, ORE_COAL, ORE_STONE];
  for (var k = 0; k < 46; k++) {
    var ang = RNG.next() * Math.PI * 2;
    var d = 26 + RNG.next() * 48;
    var px = Math.round(cx + Math.cos(ang) * d);
    var py = Math.round(cy + Math.sin(ang) * d);
    if (!inBounds(px, py)) continue;
    var far = d / 74;
    plantOre(px, py, RNG.pick(types), 5 + Math.floor(RNG.next() * 6 + far * 4),
      2500 + Math.floor(far * 9000 + RNG.next() * 3000), RNG);
  }

  // 스폰 반경은 평평하게 — 첫 공장을 지을 자리
  for (var yy = cy - 8; yy <= cy + 8; yy++) {
    for (var xx = cx - 8; xx <= cx + 8; xx++) {
      if (!inBounds(xx, yy)) continue;
      if (dist(xx, yy, cx, cy) < 8.5) world.tree[idx(xx, yy)] = 0;
    }
  }
  return world;
}

// --- 점유 --------------------------------------------------------------------
function occAt(tx, ty) {
  if (!inBounds(tx, ty)) return -1;              // 밖 = 막힘
  return world.occ[idx(tx, ty)];
}
function areaFree(tx, ty, w, h) {
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (!inBounds(x, y)) return false;
      var i = idx(x, y);
      if (world.occ[i] !== 0) return false;
      if (world.tree[i] !== 0) return false;
    }
  }
  return true;
}
function setOcc(tx, ty, w, h, id) {
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (inBounds(x, y)) world.occ[idx(x, y)] = id;
    }
  }
}
function clearTrees(tx, ty, w, h) {
  var n = 0;
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (!inBounds(x, y)) continue;
      if (!world.tree[idx(x, y)]) continue;
      world.tree[idx(x, y)] = 0;
      n++;
      // 인구조사를 여기서 바로 깎는다. 예전엔 안 깎아서, 건물로 밀어낸 나무가
      // 영원히 오염을 흡수했다 (전량 재조사를 걸면 드래그 배치마다 25600칸을 다시 센다).
      if (treeCountPerChunk) {
        var pi = pidx((x / SPEC.pollutionPerChunk) | 0, (y / SPEC.pollutionPerChunk) | 0);
        if (treeCountPerChunk[pi] > 0) treeCountPerChunk[pi]--;
      }
    }
  }
  return n;
}

// --- 광맥 채굴 ----------------------------------------------------------------
// 채광기 영역 안에서 남은 매장량이 가장 많은 칸을 하나 판다.
function mineFrom(tx, ty, w, h) {
  var best = -1, bestAmt = 0, bestType = 0;
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (!inBounds(x, y)) continue;
      var i = idx(x, y);
      if (world.oreAmt[i] > bestAmt) { bestAmt = world.oreAmt[i]; best = i; bestType = world.ore[i]; }
    }
  }
  if (best < 0 || bestAmt <= 0) return null;
  world.oreAmt[best]--;
  world.minedTotal++;
  if (world.oreAmt[best] === 0) world.ore[best] = ORE_NONE;
  return ORE_ITEM[bestType];
}
// 배치 미리보기용 — 캐지 않고 어떤 광종이 얼마나 깔려 있는지만 본다.
function surveyOre(tx, ty, w, h) {
  var total = 0, type = 0;
  for (var y = ty; y < ty + h; y++) {
    for (var x = tx; x < tx + w; x++) {
      if (!inBounds(x, y)) continue;
      var i = idx(x, y);
      if (world.oreAmt[i] > 0) { total += world.oreAmt[i]; if (!type) type = world.ore[i]; }
    }
  }
  return { total: total, type: type, item: ORE_ITEM[type] };
}

// --- 오염 확산 ------------------------------------------------------------
// 4방향 확산 + 자연 감쇠 + 나무 흡수. 매 틱이 아니라 0.25초마다 돈다.
var pollTimer = 0;
function stepPollution(dt) {
  pollTimer += dt;
  if (pollTimer < 0.25) return;
  var steps = Math.floor(pollTimer / 0.25);
  pollTimer -= steps * 0.25;
  if (steps > 4) steps = 4;                    // 프레임이 밀려도 폭주하지 않게

  for (var s = 0; s < steps; s++) {
    var P = world.poll, N = world.pollNext;
    for (var y = 0; y < PH; y++) {
      for (var x = 0; x < PW; x++) {
        var i = pidx(x, y);
        var v = P[i];
        var spread = v * 0.06;
        var keep = v - spread * 4;
        var acc = keep;
        // 이웃에서 흘러들어오는 양
        if (x > 0) acc += P[i - 1] * 0.06;
        if (x < PW - 1) acc += P[i + 1] * 0.06;
        if (y > 0) acc += P[i - PW] * 0.06;
        if (y < PH - 1) acc += P[i + PW] * 0.06;
        N[i] = acc * 0.998;                     // 자연 감쇠
      }
    }
    world.poll = N;
    world.pollNext = P;
  }
}

// 나무는 오염을 흡수한다 — 벌목하면 오염이 더 멀리 퍼진다는 인과가 생긴다.
var treeCensusDone = false;
var treeCountPerChunk = null;
function rebuildTreeCensus() {
  treeCountPerChunk = new Int32Array(PW * PH);
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      if (world.tree[idx(x, y)]) {
        treeCountPerChunk[pidx((x / SPEC.pollutionPerChunk) | 0, (y / SPEC.pollutionPerChunk) | 0)]++;
      }
    }
  }
  treeCensusDone = true;
}
// 나무 1그루가 초당 흡수하는 양. 매 틱 호출되므로 dt 를 곱해야 "초당"이 된다.
// 예전에는 `* dt * 60` 이라 dt 가 상쇄돼 **틱당 고정량 = 초당 60배**였다. 그 결과
// 오염이 공장 근처 숲에 전부 먹혀 둥지까지 가지 못했고, 습격이 사실상 오지 않았다
// (측정: 30분에 파도 6회·30마리, 터렛 6대가 손실 0으로 방어 — 압박 부재).
var TREE_ABSORB_PER_SEC = 0.0015;
function absorbByTrees(dt) {
  if (!treeCensusDone) rebuildTreeCensus();
  for (var i = 0; i < world.poll.length; i++) {
    var t = treeCountPerChunk[i];
    if (!t || world.poll[i] <= 0) continue;
    var take = Math.min(world.poll[i], t * TREE_ABSORB_PER_SEC * dt);
    world.poll[i] -= take;
    world.absorbedByTrees += take;
  }
}
