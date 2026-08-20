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
      var fresh = { members: [], cap: 0 };
      for (var fk = 0; fk < FLUID_KINDS.length; fk++) fresh[FLUID_KINDS[fk].key] = 0;
      fluidNets.push(fresh);
    }
    var nid = rootNet[r];
    list[q].fnet = nid;
    fluidNets[nid].members.push(list[q]);
  }
  // 용량과 **지금 들어 있는 양**을 같이 모은다. 양을 안 모으면, 망을 다시 지은
  // 직후(파이프 한 칸을 잇거나 저장을 불러온 순간) 회원은 증기를 들고 있는데
  // 망은 0 이라고 답한다 — 그 한 틱에 증기기관이 멎는다.
  for (var n = 0; n < fluidNets.length; n++) {
    var net = fluidNets[n], cap = 0, sum = {};
    for (var fj = 0; fj < FLUID_KINDS.length; fj++) sum[FLUID_KINDS[fj].key] = 0;
    for (var mm = 0; mm < net.members.length; mm++) {
      var mem = net.members[mm];
      cap += fluidCapOf(mem);
      for (var fq = 0; fq < FLUID_KINDS.length; fq++) {
        sum[FLUID_KINDS[fq].key] += mem[FLUID_KINDS[fq].f] || 0;
      }
    }
    net.cap = cap;
    // 망이 쪼개지거나 합쳐지면 용량이 줄 수 있다 — 넘치는 몫은 버린다.
    // **종류마다 따로 자른다.** 총량으로 자르는 쪽이 물리적으로는 맞아 보여서 그렇게
    // 바꿔 봤다가 저장 복원 게이트가 걸렸다(증기 120 → 110.9) — 이 게임의 유체는
    // 종류별로 용량을 따로 쓴다. 취수 펌프는 물을 늘 용량까지 채우므로 '물=용량 +
    // 증기 얼마' 가 **정상 상태**이고, 총량으로 자르면 그 증기를 매번 깎아 낸다.
    for (var fs2 = 0; fs2 < FLUID_KINDS.length; fs2++) {
      net[FLUID_KINDS[fs2].key] = Math.min(sum[FLUID_KINDS[fs2].key], cap);
    }
    spreadFluid(net);
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

    // --- 석유 계통 ---------------------------------------------------------
    // 펌프잭이 원유를 붓고, 정제소가 원유를 가스로 바꾸고, 화학공장이 가스를 먹어
    // 플라스틱을 뱉는다. 보일러와 같은 자리(같은 망 루프)에 두는 이유는 순서 때문이다:
    // **넣는 쪽 → 바꾸는 쪽 → 빼는 쪽** 이어야 한 틱 안에서 사슬이 이어진다.
    var oil = net.oil || 0, gas = net.gas || 0;
    var heavy = net.heavy || 0, light = net.light || 0;
    for (i = 0; i < net.members.length; i++) {
      m = net.members[i];
      if (m.type !== 'pumpjack') continue;
      if (!m.enabled || m.powerSat <= 0) { m.working = false; continue; }
      // 광맥을 실제로 판다 — 원유도 유한하다(다 뽑으면 마른다).
      var pull = SPEC.pumpjackRate * dt * m.powerSat;
      var room0 = net.cap - oil;
      var take = Math.min(pull, room0, oreLeftUnder(m));
      if (take <= 0) { m.working = false; continue; }
      consumeOreUnder(m, take);
      oil += take;
      m.working = true;
      emitPollution(m, 6 * dt);          // 발전기 20/s 를 기준으로 한 눈금
    }
    for (i = 0; i < net.members.length; i++) {
      m = net.members[i];
      if (m.type !== 'refinery') continue;
      if (!m.enabled || m.powerSat <= 0) { m.working = false; m.load = 0; continue; }
      // **셋을 동시에 낸다 — 그리고 하나만 차도 통째로 멈춘다.** 레시피는 쪼갤 수
      // 없는 한 덩어리다: 중유 낼 자리가 없으면 가스도 못 만든다. 이것이 이 층에서
      // 제어기가 꼭 필요해지는 이유다. '얼마나 돌 수 있나' 를 출구마다 **원유로 환산**해
      // 가장 좁은 곳에 맞춘다 — 어느 하나가 꽉 차면 그 환산값이 0 이 되어 멈춘다.
      var wantOil = SPEC.refineryIn * dt * m.powerSat;
      var shH = SPEC.refineryHeavy / SPEC.refineryIn;
      var shL = SPEC.refineryLight / SPEC.refineryIn;
      var shG = SPEC.refineryGas / SPEC.refineryIn;
      var lim2 = Math.min(wantOil, oil,
                          (net.cap - heavy) / shH,
                          (net.cap - light) / shL,
                          (net.cap - gas) / shG);
      if (lim2 <= 0) { m.working = false; m.load = 0; continue; }
      // 보존: 나가는 셋의 합이 들어온 원유와 같다. 게이트가 이것으로 검산한다.
      oil -= lim2;
      heavy += lim2 * shH; light += lim2 * shL; gas += lim2 * shG;
      m.load = wantOil > 0 ? lim2 / wantOil : 0;
      m.working = true;
      emitPollution(m, 10 * m.load * dt);
    }
    for (i = 0; i < net.members.length; i++) {
      m = net.members[i];
      if (m.type !== 'chemplant') continue;
      if (!m.enabled || m.powerSat <= 0) { m.working = false; m.load = 0; continue; }
      // **무엇을 만들지는 플레이어가 정한다.** 다섯 갈래가 같은 건물을 두고 다툰다 —
      // 가스로 플라스틱을 뽑을지 태울 연료로 바꿀지, 남는 중유·경유를 분해해 흘려보낼지.
      // '지금 무엇이 급한가' 가 매번 판단거리이고, 그 판단을 회로에 맡길 수 있다.
      var rec = CHEM_RECIPES[m.recipe] || CHEM_RECIPES['plastic'];
      // 물건을 만드는 레시피만 출력 버퍼가 찬다 — 분해는 유체를 내므로 버퍼가 없다.
      if (rec.item && invTotal(m.out) >= SPEC.machineBufOut) { m.working = false; m.load = 0; continue; }
      var avail = (rec.fin === 'gas') ? gas : (rec.fin === 'heavy' ? heavy : light);
      var want = rec.inRate * dt * m.powerSat;
      var used = Math.min(want, avail);
      // **분해는 내놓을 자리도 있어야 한다.** 받는 쪽이 꽉 차 있으면 분해도 멈춘다 —
      // 안 그러면 유체가 허공으로 사라져서, 넘치는 것이 문제가 아니게 된다.
      if (rec.fout) {
        var have = (rec.fout === 'gas') ? gas : (rec.fout === 'light' ? light : heavy);
        var byRoom = (net.cap - have) / (rec.outRate / rec.inRate);
        if (byRoom < used) used = byRoom;
      }
      if (used <= 0) { m.working = false; m.load = 0; continue; }
      if (rec.fin === 'gas') gas -= used;
      else if (rec.fin === 'heavy') heavy -= used;
      else light -= used;
      if (rec.fout) {
        var made = used * (rec.outRate / rec.inRate);
        if (rec.fout === 'gas') gas += made;
        else if (rec.fout === 'light') light += made;
        else heavy += made;
      } else {
        m.progress = (m.progress || 0) + used / rec.per;
        while (m.progress >= 1) { m.progress -= 1; invAdd(m.out, rec.item, 1); }
      }
      m.load = want > 0 ? used / want : 0;
      m.working = true;
      emitPollution(m, 8 * m.load * dt);
    }
    net.oil = oil; net.gas = gas; net.heavy = heavy; net.light = light;

    net.water = w; net.steam = s;
    spreadFluid(net);
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
    var have = netTotal(back);
    var room = front.cap - netTotal(front);
    var move = Math.min(SPEC.xpumpRate * dt * e.powerSat, have, room);
    if (move <= 0) { e.working = false; return; }
    // 종류를 가리지 않고 **있는 비율 그대로** 옮긴다 (이 게임의 유체는 잘 섞인 탱크다)
    for (var xk = 0; xk < FLUID_KINDS.length; xk++) {
      var key = FLUID_KINDS[xk].key;
      var part = (back[key] || 0) / have * move;
      back[key] = (back[key] || 0) - part;
      front[key] = (front[key] || 0) + part;
    }
    spreadFluid(back);
    spreadFluid(front);
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
// **유체 종류는 여기 한 줄로 정한다.** 예전에는 물·증기 두 가지가 곳곳에 이름으로
// 박혀 있어(net.water/net.steam · m.fw/m.fs) 종류를 하나 늘리려면 스무 군데를 고쳐야
// 했다. 석유 계통을 넣으면서 목록 하나로 몰았다 — 새 유체는 이 배열에 한 줄이다.
//   key = 망이 들고 있는 이름 · f = 회원(건물)이 제 몫을 들고 있는 필드 이름
// 화학공장이 할 수 있는 일 — **한 자리에서 정한다.** 갈래가 둘일 때는 if 하나로 됐지만,
// 다섯이 되면 조건문이 표를 어설프게 흉내 내기 시작한다.
//   fin    먹는 유체        inRate  초당 먹는 양(만근일 때)
//   item   내놓는 물건      per     물건 1개당 먹는 유체
//   fout   내놓는 유체      outRate 초당 내놓는 양   ← 분해가 이쪽이다
// 물건을 만드는 셋은 전부 초당 10 을 먹는다 — 건물 하나의 처리량은 같고, 무엇으로
// 바꾸느냐만 다르다. 분해만 처리량이 낮다(4·3): 흘려보내는 일은 만드는 일보다 느리다.
var CHEM_RECIPES = {
  'plastic':     { fin: 'gas',   inRate: SPEC.chemGasPerPlastic * SPEC.chemPlasticRate,
                   item: 'plastic',    per: SPEC.chemGasPerPlastic },
  'solid-fuel':  { fin: 'gas',   inRate: SPEC.chemGasPerFuel * SPEC.chemFuelRate,
                   item: 'solid-fuel', per: SPEC.chemGasPerFuel },
  'fuel-light':  { fin: 'light', inRate: SPEC.lightPerFuel * SPEC.chemFuelLightRate,
                   item: 'solid-fuel', per: SPEC.lightPerFuel },
  'crack-heavy': { fin: 'heavy', inRate: SPEC.crackHeavyIn,
                   fout: 'light', outRate: SPEC.crackHeavyOut },
  'crack-light': { fin: 'light', inRate: SPEC.crackLightIn,
                   fout: 'gas',   outRate: SPEC.crackLightOut }
};

var FLUID_KINDS = [
  { key: 'water', f: 'fw' },
  { key: 'steam', f: 'fs' },
  { key: 'oil',   f: 'fo' },      // 원유 — 펌프잭이 뽑는다
  { key: 'heavy', f: 'fh' },      // 중유 — 정제소가 낸다. 갈 곳은 분해뿐이다
  { key: 'light', f: 'fl' },      // 경유 — 분해해서 가스로, 또는 그대로 고체 연료로
  { key: 'gas',   f: 'fg' }       // 석유가스 — 플라스틱·고체 연료
];

function netTotal(net) {
  var t = 0;
  for (var k = 0; k < FLUID_KINDS.length; k++) t += net[FLUID_KINDS[k].key] || 0;
  return t;
}

function spreadFluid(net) {
  var cap = net.cap;
  for (var i = 0; i < net.members.length; i++) {
    var m = net.members[i];
    var share = cap > 0 ? fluidCapOf(m) / cap : 0;
    for (var k = 0; k < FLUID_KINDS.length; k++) {
      m[FLUID_KINDS[k].f] = (net[FLUID_KINDS[k].key] || 0) * share;
    }
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
  spreadFluid(net);
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
  return { connected: 1, water: net.water, steam: net.steam,
           oil: net.oil || 0, heavy: net.heavy || 0, light: net.light || 0,
           gas: net.gas || 0, cap: net.cap,
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
