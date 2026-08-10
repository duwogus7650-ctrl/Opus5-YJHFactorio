// ===========================================================================
//  32_fluid.js — 유체망: 물과 증기
//
//  구조는 전력망과 같다. 파이프·취수펌프·보일러·증기기관이 **맞닿아** 있으면 한
//  망이고, 망 하나는 **잘 섞인 탱크 하나**다 — 압력 기울기도 흐름 방향도 모형화하지
//  않는다. 전력망이 선로 손실을 모형화하지 않는 것과 같은 층위의 단순화이고,
//  그래서 게이트가 물어볼 것도 같다: 총량이 맞는가, 에너지가 맞는가.
//
//  **왜 넣었나 — 버퍼 때문이다.** 발전이 한 단계(석탄→전기)에서 두 단계
//  (석탄→증기→전기)가 되면 중간에 저장고가 생긴다. 석탄이 잠깐 끊겨도 증기가
//  남아 있으면 전기는 버티고, 반대로 부하가 몰리면 전기가 흔들리기 **전에** 증기가
//  먼저 마른다. 제어기의 과제가 "전기가 모자란 다음에 끄기"에서 "증기가 마르기
//  전에 끄기"로 옮겨 간다 — 관측 가능한 선행 지표가 생기는 것이고, 이 게임이
//  가르치려는 지점이 정확히 거기다.
//
//  수치는 전부 Factorio 공개값이다 (05_data.js SPEC):
//    취수펌프 1200 물/s · 보일러 1.8 MW 로 물 60/s → 증기 60/s · 증기기관 30 증기/s → 900 kW
//  그래서 **증기 1개 = 30 kJ** 이 양쪽에서 같게 떨어진다(1800/60 = 900/30). 이 항등식이
//  에너지수지 게이트의 오라클이다 — 어느 한쪽 수치를 흔들면 즉시 어긋난다.
// ===========================================================================

var fluidNets = [];
var fluidDirty = true;
var fluidAt = new Int32Array(W * H);      // 타일 → 유체 엔티티 색인+1 (0 = 없음)

function markFluidDirty() { fluidDirty = true; }
function isFluidEnt(e) { return !!(e && BUILDINGS[e.type] && BUILDINGS[e.type].fluid); }
// **이송 펌프는 망의 회원이 아니다.** 회원으로 넣으면 유니온-파인드가 앞뒤를 한 망으로
// 합쳐 버려서, 이 건물이 존재하는 이유(두 망을 남남으로 두고 옮긴다)가 사라진다.
function isXferPump(e) { return !!(e && BUILDINGS[e.type] && BUILDINGS[e.type].xfer); }
// **탱크만 칸 수로 안 센다.** 저장 탱크의 값은 '넓다'가 아니라 '많이 담는다'이고,
// 3x3=900 으로 두면 파이프 아홉 칸과 같아져 지을 이유가 사라진다.
function fluidCapOf(e) {
  if (e.type === 'tank') return SPEC.tankCap;
  return e.w * e.h * SPEC.fluidPerTile;
}

// --- 망 재구성 --------------------------------------------------------------
// 맞닿은 칸으로만 잇는다. 대각선은 안 잇는다 — 화면에서 안 닿아 보이는데 이어지면
// 왜 이어졌는지 짚을 단서가 없다(전주가 '거리'로 잇는 것과 달리 파이프는 '맞닿음'이
// 눈에 보이는 규칙이다).
function rebuildFluid() {
  fluidAt.fill(0);
  var list = [];
  forEachEntity(function (e) { if (isFluidEnt(e) && !isXferPump(e)) { e.fnet = -1; list.push(e); } });
  var i, x, y;
  for (i = 0; i < list.length; i++) {
    var e0 = list[i];
    for (y = e0.ty; y < e0.ty + e0.h; y++) {
      for (x = e0.tx; x < e0.tx + e0.w; x++) if (inBounds(x, y)) fluidAt[idx(x, y)] = i + 1;
    }
  }
  var parent = new Int32Array(list.length);
  for (i = 0; i < list.length; i++) parent[i] = i;
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }

  for (var k = 0; k < list.length; k++) {
    var m = list[k];
    for (y = m.ty; y < m.ty + m.h; y++) {
      for (x = m.tx; x < m.tx + m.w; x++) {
        for (var d = 0; d < 4; d++) {
          var nx = x + DIR_DX[d], ny = y + DIR_DY[d];
          if (!inBounds(nx, ny)) continue;
          var other = fluidAt[idx(nx, ny)];
          if (other > 0 && other - 1 !== k) uni(k, other - 1);
        }
      }
    }
  }

  fluidNets = [];
  var rootNet = {};
  for (var q = 0; q < list.length; q++) {
    var r = find(q);
    if (rootNet[r] === undefined) {
      rootNet[r] = fluidNets.length;
      fluidNets.push({ members: [], cap: 0, water: 0, steam: 0 });
    }
    var nid = rootNet[r];
    list[q].fnet = nid;
    fluidNets[nid].members.push(list[q]);
  }
  // 용량과 **지금 들어 있는 양**을 같이 모은다. 양을 안 모으면, 망을 다시 지은
  // 직후(파이프 한 칸을 잇거나 저장을 불러온 순간) 회원은 증기를 들고 있는데
  // 망은 0 이라고 답한다 — 그 한 틱에 증기기관이 멎는다.
  for (var n = 0; n < fluidNets.length; n++) {
    var net = fluidNets[n], cap = 0, w0 = 0, s0 = 0;
    for (var mm = 0; mm < net.members.length; mm++) {
      var mem = net.members[mm];
      cap += fluidCapOf(mem);
      w0 += mem.fw || 0;
      s0 += mem.fs || 0;
    }
    net.cap = cap;
    // 망이 쪼개지거나 합쳐지면 용량이 줄 수 있다 — 넘치는 몫은 버린다.
    net.water = Math.min(w0, cap);
    net.steam = Math.min(s0, cap);
    spreadFluid(net, net.water, net.steam);
  }
  fluidDirty = false;
}

// --- 한 틱 -------------------------------------------------------------------
// 순서: 회원이 들고 있는 양을 모은다 → 펌프가 붓는다 → 보일러가 물을 증기로
// 바꾼다 → 다시 회원에게 고르게 나눠 담는다.
// **회원별로 나눠 담는 이유는 저장이다.** 망 번호는 지형이 바뀌면 갈리므로 저장할
// 수 없다. 각 건물이 제 몫을 들고 있으면 저장·복원이 그냥 된다.
function stepFluids(dt) {
  if (fluidDirty) rebuildFluid();
  for (var n = 0; n < fluidNets.length; n++) {
    var net = fluidNets[n];
    var w = 0, s = 0, i, m;
    for (i = 0; i < net.members.length; i++) {
      w += net.members[i].fw || 0;
      s += net.members[i].fs || 0;
    }

    for (i = 0; i < net.members.length; i++) {
      m = net.members[i];
      if (m.type === 'pump') {
        // 취수 펌프는 전기를 쓰지 않는다 (Factorio 의 offshore pump 와 같다).
        // 전기를 요구하면 "정전 → 물 끊김 → 증기 끊김 → 더 큰 정전" 이라는
        // 자기강화 고장이 생긴다. 제어기의 가동/정지로는 끌 수 있다.
        if (!m.enabled) { m.working = false; continue; }
        var add = SPEC.pumpRate * dt;
        var before = w;
        w = Math.min(net.cap, w + add);
        m.working = (w > before);
      }
    }

    for (i = 0; i < net.members.length; i++) {
      m = net.members[i];
      if (m.type !== 'boiler') continue;
      if (!m.enabled || m.fuel <= 0) { m.working = false; m.load = 0; continue; }
      var want = SPEC.boilerFluid * dt;                 // 이 틱에 최대로 끓일 물
      var room = net.cap - s;                           // 증기가 들어갈 자리
      var lim = Math.min(want, w, room);
      if (lim <= 0) { m.working = false; m.load = 0; continue; }
      // 연료는 끓인 만큼만 탄다. dt 를 곱하는 자리가 여기다 — 빼먹으면 60배가 되고,
      // 그걸 잡는 것은 아래 에너지수지 게이트뿐이다 (교훈 03).
      var kj = SPEC.boilerPower * (lim / want) * dt;
      if (kj > m.fuel) { lim *= m.fuel / kj; kj = m.fuel; }
      m.fuel -= kj;
      if (m.fuel < 0) m.fuel = 0;
      w -= lim; s += lim;
      m.load = want > 0 ? lim / want : 0;
      // 오염은 태운 에너지에 비례한다. 발전기가 900 kW 에 20/s 이므로 1.8 MW 는 40/s.
      emitPollution(m, 40 * m.load * dt);
      m.working = true;
    }

    net.water = w; net.steam = s;
    spreadFluid(net, w, s);
  }
  stepXferPumps(dt);
}

// --- 망 사이 이송 ------------------------------------------------------------
// 뒤쪽 망에서 빨아 앞쪽 망으로 민다. **두 망은 안 합친다** — 그것이 이 건물의 전부다.
// 방향은 dir 이고, 뒤/앞은 그 반대편·정면 한 칸이다(인서터와 같은 읽기다).
//
// 물과 증기를 **같은 비율로** 옮긴다. 한쪽만 옮기면 "증기만 빼 가는 펌프" 같은 것이
// 되어 규칙이 늘어나는데, 이 게임의 유체는 '잘 섞인 탱크' 라 종류를 가려 뽑는다는
// 개념 자체가 없다. 옮길 양은 세 가지에 걸린다: 규격 · 보낼 쪽에 있는 양 · 받을 쪽의 빈자리.
function stepXferPumps(dt) {
  forEachEntity(function (e) {
    if (!isXferPump(e)) return;
    if (!e.enabled) { e.working = false; return; }
    // 전기를 쓴다 — 정전이면 멈춘다(취수 펌프와 다른 점이다. 그쪽은 자기강화 고장을
    // 막으려고 일부러 전기를 안 쓴다).
    if (e.powerSat <= 0) { e.working = false; return; }
    var back = fluidNetAt(e.tx - DIR_DX[e.dir], e.ty - DIR_DY[e.dir]);
    var front = fluidNetAt(e.tx + DIR_DX[e.dir], e.ty + DIR_DY[e.dir]);
    if (!back || !front || back === front) { e.working = false; return; }
    var have = back.water + back.steam;
    var room = front.cap - (front.water + front.steam);
    var move = Math.min(SPEC.xpumpRate * dt * e.powerSat, have, room);
    if (move <= 0) { e.working = false; return; }
    var fw = have > 0 ? (back.water / have) * move : 0;
    var fs = move - fw;
    back.water -= fw; back.steam -= fs;
    front.water += fw; front.steam += fs;
    spreadFluid(back, back.water, back.steam);
    spreadFluid(front, front.water, front.steam);
    e.working = true;
  });
}

// 그 타일을 쓰는 유체망 (이송 펌프는 회원이 아니므로 여기 안 걸린다)
function fluidNetAt(tx, ty) {
  if (!inBounds(tx, ty)) return null;
  var i = fluidAt[idx(tx, ty)];
  if (i <= 0) return null;
  var e = null, n = 0;
  // fluidAt 은 rebuild 시점의 색인+1 이다. 회원 목록으로 되짚는 대신 엔티티에서
  // fnet 을 읽는다 — 색인은 재구성마다 바뀌지만 fnet 은 그 시점의 진실이다.
  e = entityAt(tx, ty);
  if (!e || !isFluidEnt(e) || isXferPump(e)) return null;
  n = e.fnet;
  if (n < 0 || n >= fluidNets.length) return null;
  return fluidNets[n];
}

// 망의 총량을 회원에게 **용량 비례**로 나눈다. 균등하게 나누면 파이프 한 칸과
// 증기기관(6칸)이 같은 양을 들게 되어, 큰 건물만 있는 망에서 용량이 남는데도
// 못 채우는 일이 생긴다.
function spreadFluid(net, w, s) {
  var cap = net.cap;
  for (var i = 0; i < net.members.length; i++) {
    var m = net.members[i];
    var share = cap > 0 ? fluidCapOf(m) / cap : 0;
    m.fw = w * share;
    m.fs = s * share;
  }
}

// 증기기관이 부하만큼 증기를 뽑는다. 망 전체에서 빼고 다시 나눠 담는다.
function drawSteam(e, amt) {
  if (fluidDirty) rebuildFluid();
  if (!e || e.fnet < 0 || e.fnet >= fluidNets.length) return 0;
  var net = fluidNets[e.fnet];
  var got = Math.min(amt, net.steam);
  if (got <= 0) return 0;
  net.steam -= got;
  spreadFluid(net, net.water, net.steam);
  return got;
}

// 센서·인스펙터·전력망이 함께 쓰는 조회. connected 0 은 "망이 아예 없다"이고,
// 그건 "망에 있는데 비었다"와 다르다 — 둘을 같은 0 으로 뭉치면 플레이어가
// 파이프를 안 이은 것인지 증기가 마른 것인지 구별할 수 없다.
function fluidOf(e) {
  // 배치 직후 첫 틱 전에도 물어본다(렌더러·시험). 다시 안 지으면 방금 이은
  // 파이프가 '연결 안 됨'으로 보이는데, 그건 사실이 아니라 타이밍이다.
  if (fluidDirty) rebuildFluid();
  if (!e || e.fnet === undefined || e.fnet < 0 || e.fnet >= fluidNets.length) {
    return { connected: 0, water: 0, steam: 0, cap: 0, steamPct: 0 };
  }
  var net = fluidNets[e.fnet];
  return { connected: 1, water: net.water, steam: net.steam, cap: net.cap,
           steamPct: net.cap > 0 ? (net.steam / net.cap) * 100 : 0 };
}
function engineHasSteam(e) {
  if (fluidDirty) rebuildFluid();
  if (!e || e.fnet === undefined || e.fnet < 0 || e.fnet >= fluidNets.length) return false;
  return fluidNets[e.fnet].steam > 0;
}

var fluidStats = { nets: 0, water: 0, steam: 0, cap: 0 };
function updateFluidStats() {
  var w = 0, s = 0, c = 0;
  for (var i = 0; i < fluidNets.length; i++) {
    w += fluidNets[i].water; s += fluidNets[i].steam; c += fluidNets[i].cap;
  }
  fluidStats.nets = fluidNets.length;
  fluidStats.water = w; fluidStats.steam = s; fluidStats.cap = c;
}
