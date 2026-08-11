// ===========================================================================
//  60_game.js — 부팅, 고정 스텝 루프, 저장/불러오기, 테스트 API
//
//  틱 순서에는 이유가 있다:
//    로직 → 전력 → 기계 → 벨트 → 오염 → 적
//  로직이 먼저여야 이번 틱에 "끈" 기계가 이번 틱 전력수요에서 빠진다. 반대로 두면
//  부하 차단이 항상 한 틱 늦게 들어 전력이 덜덜 떨린다.
// ===========================================================================

var gameTime = 0;
var worldSeed = 20260807;
var paused = false;
var gameSpeed = 1;        // 시험/녹화용 배속 (1 = 실시간)
var lastFrame = 0;
var accumulator = 0;
var uiTimer = 0, miniTimer = 0;

function newGame(seed) {
  worldSeed = (seed === undefined || seed === null) ? worldSeed : (seed >>> 0);
  entities = {}; entOrder = []; nextEntId = 1;
  inventory = {}; techDone = {}; currentResearch = null; researchProgress = 0;
  researchProgressBy = {};
  beltSpeedMul = 1; machineSpeedMul = 1; machinePowerMul = 1; powerCheatOn = false;
  gameTime = 0; accumulator = 0; handCraftCount = 0; handQueue.length = 0;
  enemies.length = 0; corpses.length = 0; turretFx.length = 0;
  resetEvolution();          // 진화도는 증분 누적이라 기준점까지 같이 되돌려야 한다
  waveStats.spawned = 0; waveStats.killed = 0; waveStats.buildingsLost = 0;
  waveStats.lost.length = 0;
  waveStats.waves = 0; waveStats.lastWaveT = 0;
  beltStats.delivered = 0;
  ERRORS.length = 0;
  alarms.length = 0; displays.length = 0;
  busClear();                // 신호 버스도 판을 넘기지 않는다 — 결정성이 깨진다
  trains.length = 0;         // 열차도 판에 딸린 물건이다
  blueprint = null;          // 청사진도 판에 딸린 물건이다

  generateWorld(worldSeed);
  spawnNests(worldSeed);
  treeCensusDone = false;
  for (var k in START_INV) inventory[k] = START_INV[k];

  resetTutorial(tutorial ? tutorial.on : true);   // 껐다면 새 판에서도 꺼진 채로 둔다
  markBeltDirty(); markPowerDirty(); markLogicDirty();
  rebuildPower();

  // 콜드 스타트 해소 — 전기가 없으면 아무것도 못 돌리고, 발전기에 연료를 넣으려면
  // 인서터가 필요한데 인서터도 전기가 필요하다. 그래서 시작 발전기 한 대는 켜서 준다.
  var cx = world.spawnX, cy = world.spawnY;
  var gen = placeEntity('generator', cx - 1, cy - 4, 2, true);
  if (gen) gen.fuel = SPEC.coalEnergy * 12;
  placeEntity('pole', cx + 2, cy - 3, 0, true);
  placeEntity('pole', cx + 2, cy + 2, 0, true);
  markPowerDirty(); rebuildPower();

  if (cv) { cam.x = cx; cam.y = cy; cam.z = 1; }
  refreshAllUI();
}

function refreshAllUI() {
  if (typeof document === 'undefined' || !document.getElementById('buildList')) return;
  renderBuildList(); renderInv(); renderCraftList(); renderCraftQueue();
  renderTech(); renderTop(); renderTutorial();
}

// --- 한 틱 -------------------------------------------------------------------
function stepEntities(dt) {
  forEachEntity(function (e) {
    e.anim += dt;
    switch (e.type) {
      case 'miner': guard('miner', function () { stepMiner(e, dt); }); break;
      case 'furnace': guard('furnace', function () { stepCrafter(e, dt, SPEC.furnaceSpeed); }); break;
      case 'assembler': guard('assembler', function () { stepCrafter(e, dt, SPEC.assemblerSpeed); }); break;
      case 'generator': guard('generator', function () { stepGenerator(e, dt); }); break;
      case 'engine': guard('engine', function () { stepEngine(e, dt); }); break;
      case 'lab': guard('lab', function () { stepLab(e, dt); }); break;
      case 'inserter': guard('inserter', function () { stepInserter(e, dt); }); break;
    }
  });
}

function tick(dt) {
  stepLogic(dt);
  // 유체가 전력보다 먼저다 — 펌프가 물을 붓고 보일러가 증기를 만든 뒤에야
  // 증기기관이 이번 틱에 얼마를 공급할 수 있는지 정해진다. 뒤로 돌리면 발전이
  // 한 틱씩 밀려, 부하가 급변할 때 전력이 실제보다 한 틱 늦게 반응한다.
  stepFluids(dt);
  stepPower(dt);
  stepEntities(dt);
  stepHandCraft(dt);      // 손 조립도 시간이 든다 — 기계와 같은 틱에 진행한다
  stepBelts(dt);
  stepTrains(dt);         // 벨트 뒤 — 인서터가 이번 틱에 실은 것이 실려서 떠난다
  stepPollution(dt);
  absorbByTrees(dt);
  stepNests(dt);
  stepEnemies(dt);
  stepTurrets(dt);
  gameTime += dt;
  beltPhase += dt;
  // 튜토리얼은 세계를 읽기만 한다 — 시뮬레이션에 영향을 주지 않는다(난수도 안 쓴다)
  guard('tutorial', function () { stepTutorial(dt); });
}

// 고정 스텝 — 프레임 시간에 상관없이 시뮬은 항상 TICK 단위로 전진한다.
function advance(elapsed) {
  accumulator += elapsed;
  var steps = 0;
  // 배속을 올리면 한 프레임에 밀 틱 수도 그만큼 늘어야 한다. 상한을 고정해 두면
  // 배속 8 이상에서 시간이 조용히 버려져 "30분 돌렸다" 가 거짓이 된다.
  var cap = MAX_STEPS * Math.max(1, Math.ceil(gameSpeed));
  while (accumulator >= TICK && steps < cap) {
    tick(TICK);
    accumulator -= TICK;
    steps++;
  }
  if (steps >= cap) accumulator = 0;   // 밀린 시간은 버린다 (나선 방지)
  return steps;
}

function frame(now) {
  var elapsed = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (!paused) {
    stepCameraKeys(elapsed);
    // 배속은 **녹화·소크 시험 전용**이다. UI 에 노출하지 않는다 — 게임 난이도를
    // 바꾸는 손잡이가 되어 버린다. 시뮬레이션은 여전히 고정 스텝이라 결정성이
    // 유지되고, 배속은 "한 프레임에 몇 틱을 미느냐" 만 바꾼다.
    guard('advance', function () { advance(elapsed * gameSpeed); });
  }
  guard('render', render);
  // 손 조립 대기열은 매 프레임 — 0.2초 주기로 그리면 0.5초짜리 레시피의 진행
  // 막대가 두 칸만 움직여 "멈춘 것"처럼 보인다. 줄이 그대로면 폭만 고치므로 싸다.
  guard('cqueue', renderCraftQueue);

  uiTimer += elapsed;
  if (uiTimer > 0.2) {
    uiTimer = 0;
    guard('ui', function () {
      renderTop(); renderAlarms(); renderInv(); renderCraftList(); refreshInsp();
      if (document.getElementById('tech').style.display === 'block') renderTech();
    });
  }
  miniTimer += elapsed;
  if (miniTimer > 0.35) { miniTimer = 0; guard('mini', renderMini); }
  requestAnimationFrame(frame);
}

// --- 저장 / 불러오기 ---------------------------------------------------------
function b64enc(u8) {
  var s = '', chunk = 0x8000;
  for (var i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)));
  }
  return btoa(s);
}
function b64dec(str) {
  var bin = atob(str), u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function serializeEntity(e) {
  var o = { id: e.id, t: e.type, x: e.tx, y: e.ty, d: e.dir, hp: e.hp,
            pe: e.playerEnabled, pf: e.playerFilter, inv: e.inv, out: e.out,
            rec: e.recipe, prog: e.progress };
  if (e.type === 'generator' || e.type === 'boiler') o.fuel = e.fuel;
  // 유체는 회원이 제 몫을 들고 있다. 안 담으면 불러오는 순간 파이프의 증기가
  // 통째로 사라져 발전이 한 박자 멈춘다 — 버퍼가 있는 계에서는 그게 곧 정전이다.
  if (BUILDINGS[e.type] && BUILDINGS[e.type].fluid) { o.fw = e.fw || 0; o.fs = e.fs || 0; }
  if (e.type === 'furnace' && e.lastRecipe) o.lrec = e.lastRecipe;   // 굽던 것의 기억
  if (e.type === 'turret') o.ammo = e.ammo;
  if (e.type === 'splitter') o.prio = e.outPrio;
  if (e.type === 'lab') o.res = e.researching;
  if (e.type === 'inserter') { o.ph = e.phase; o.tt = e.t; o.held = e.held; }
  if (e.type === 'controller') {
    o.rules = e.rules || [];
    o.nrid = e.nextRuleId || 1;
    o.he = !!e.handEdited;
  }
  if (e.type === 'controller' && e.graph) {
    o.g = {
      nextNid: e.graph.nextNid,
      nodes: e.graph.nodes.map(function (n) {
        // o/p = 레지스터 값(현재/직전). 이걸 빼면 불러오기 때 래치가 전부 풀린다.
        return { nid: n.nid, k: n.kind, x: n.x, y: n.y, cfg: n.cfg, st: n.state,
                 o: n.out.slice(), p: n.prev.slice() };
      }),
      links: e.graph.links.map(function (l) { return [l.fn, l.fp, l.tn, l.tp]; })
    };
  }
  if (e.cells) {
    o.cells = e.cells.map(function (c) {
      return { l0: c.lanes[0].map(function (i) { return [i.id, Math.round(i.pos * 1000)]; }),
               l1: c.lanes[1].map(function (i) { return [i.id, Math.round(i.pos * 1000)]; }) };
    });
  }
  return o;
}

function saveGame() {
  var data = {
    v: VERSION, seed: worldSeed, t: gameTime,
    inv: inventory, tech: techDone, res: currentResearch, resP: researchProgress,
    resBy: researchProgressBy,      // 갈아탄 연구의 진행도 — 없으면 불러올 때 도로 0이 된다
    // 손 조립 대기열도 저장한다. 재료는 예약할 때 이미 빠졌으므로, 안 담으면
    // 저장 한 번이 만들던 것을 통째로 태운다 (되돌릴 방법이 없다).
    hand: handQueue.map(function (j) { return [j.rid, j.left]; }),
    ore: b64enc(new Uint8Array(world.oreAmt.buffer.slice(0))),
    oreT: b64enc(world.ore),
    tree: b64enc(world.tree),
    poll: b64enc(new Uint8Array(world.poll.buffer.slice(0))),
    totalPoll: world.totalPollution,
    mined: world.minedTotal,
    ents: entOrder.map(function (id) { return serializeEntity(entities[id]); }),
    nextId: nextEntId,
    nests: nests.map(function (n) { return [n.x, n.y, n.hp, n.absorbed, n.cool, n.seed]; }),
    enemies: enemies.map(function (e) { return [Math.round(e.x * 100), Math.round(e.y * 100), e.hp, e.tier]; }),
    evo: evolution, ws: waveStats,
    // 버스는 직전 틱 합계 하나뿐이다. 안 담으면 불러온 첫 틱에 모든 채널이 0 이
    // 돼, 신호를 받아 라인을 잡고 있던 회로가 한 틱 동안 손을 놓는다.
    bus: busSnapshot(),
    // 청사진도 저장한다. 저장 한 번에 사라지면 '한 라인 잘 만들어 두고 늘리기'가
    // 성립하지 않는다 — 그게 이 기능의 전부다.
    bp: blueprint,
    // 열차는 점유맵 밖에 있어서 엔티티 목록에 안 실린다 — 따로 담는다.
    // 화물까지 담지 않으면 저장 한 번에 실어 둔 것이 사라진다.
    trains: trains.map(function (t) {
      return { x: t.x, y: t.y, inv: t.inv, w: t.waitT };
    }),
    tut: { on: tutorial.on, track: tutorial.track, step: tutorial.step, done: tutorial.done, flags: tutorial.flags },
    prod: { smelted: prodStats.smelted, crafted: prodStats.crafted, byRecipe: prodStats.byRecipe }
  };
  try {
    localStorage.setItem('logic-foundry-save', JSON.stringify(data));
    toast('저장 완료', 'good');
    return true;
  } catch (e) { logError('save', e); toast('저장 실패: ' + e, 'bad'); return false; }
}

function loadGame(raw) {
  var data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(localStorage.getItem('logic-foundry-save')); }
  catch (e) { toast('저장된 게임이 없다', 'bad'); return false; }
  if (!data) { toast('저장된 게임이 없다', 'bad'); return false; }
  // 현재 판을 부수기 **전에** 저장본을 검사한다. 예전에는 newGame 을 먼저 불러
  // 세계를 지운 뒤에 실패해서, 저장본도 못 얻고 진행 중이던 공장도 잃었다.
  if (!Array.isArray(data.ents) || typeof data.ore !== 'string' || typeof data.oreT !== 'string' ||
      typeof data.tree !== 'string' || typeof data.poll !== 'string' || data.seed === undefined) {
    toast('저장본 형식이 맞지 않다 — 현재 게임은 그대로 둔다', 'bad');
    return false;
  }
  try {
    newGame(data.seed);
    // newGame 이 심어 둔 시작 키트를 지운다 — 저장본이 진실이다
    var ids = entOrder.slice();
    for (var z = 0; z < ids.length; z++) removeEntity(ids[z], false);
    entities = {}; entOrder = [];

    gameTime = data.t || 0;
    inventory = data.inv || {}; techDone = data.tech || {};
    currentResearch = data.res || null; researchProgress = data.resP || 0;
    researchProgressBy = data.resBy || {};   // 예전 저장본엔 없다 — 빈 채로 두면 그만이다
    busRestore(data.bus);                    // 마찬가지로 없으면 전 채널 0 에서 시작한다
    blueprint = data.bp || null;             // 예전 저장본엔 없다 — 빈 채로 둔다
    trains.length = 0;
    handQueue.length = 0;
    if (Array.isArray(data.hand)) {
      for (var hj = 0; hj < data.hand.length; hj++) {
        var hrow = data.hand[hj];
        if (RECIPES[hrow[0]]) handQueue.push({ rid: hrow[0], left: +hrow[1] || 0 });
      }
    }
    applyTechEffects();

    world.oreAmt = new Uint16Array(b64dec(data.ore).buffer);
    world.ore.set(b64dec(data.oreT));
    world.tree.set(b64dec(data.tree));
    world.poll = new Float32Array(b64dec(data.poll).buffer);
    world.pollNext = new Float32Array(world.poll.length);
    world.totalPollution = data.totalPoll || 0;
    world.minedTotal = data.mined || 0;      // 물질수지 오라클의 좌변 — 안 되돌리면 무너진다
    treeCensusDone = false;
    world.occ.fill(0);

    // 임시 id 가 저장본 id 와 절대 겹치지 않게 커서를 먼저 올린다.
    // 겹치면 placeEntity 의 entities[id]=e 가 앞서 복원한 엔티티를 덮고,
    // entOrder.indexOf 가 엉뚱한 항목을 잘라내 엔티티가 사라진다 (실측: 20개 → 4개).
    var maxId = 0;
    for (var mi2 = 0; mi2 < data.ents.length; mi2++) {
      if (data.ents[mi2].id > maxId) maxId = data.ents[mi2].id;
    }
    nextEntId = maxId + 1;

    var dropped = [];
    for (var i = 0; i < data.ents.length; i++) {
      var o = data.ents[i];
      var e = placeEntity(o.t, o.x, o.y, o.d, true);
      if (!e) { dropped.push(o.t + '@' + o.x + ',' + o.y); continue; }
      // id 를 저장본과 맞춘다 — 제어기 노드가 id 로 대상을 가리키기 때문
      delete entities[e.id];
      var oi = entOrder.indexOf(e.id); if (oi >= 0) entOrder.splice(oi, 1);
      e.id = o.id; entities[o.id] = e; entOrder.push(o.id);
      setOcc(e.tx, e.ty, e.w, e.h, o.id);
      e.hp = o.hp; e.playerEnabled = o.pe !== false; e.playerFilter = o.pf || null;
      e.filter = e.playerFilter;
      e.inv = o.inv || {}; e.out = o.out || {}; e.recipe = o.rec || null; e.progress = o.prog || 0;
      if (o.lrec) e.lastRecipe = o.lrec;
      if (e.type === 'controller') {
        e.rules = o.rules || [];          // 예전 저장본엔 없다 — 그래프만 있는 제어기가 된다
        e.nextRuleId = o.nrid || (e.rules.length + 1);
        e.handEdited = !!o.he || (!e.rules.length && !!(o.g && o.g.nodes && o.g.nodes.length));
      }
      if (o.fuel !== undefined) e.fuel = o.fuel;
      if (o.ammo !== undefined) e.ammo = o.ammo;
      if (o.prio !== undefined) e.outPrio = o.prio;
      if (o.res !== undefined) e.researching = o.res;
      if (o.fw !== undefined) e.fw = o.fw;
      if (o.fs !== undefined) e.fs = o.fs;
      if (o.ph !== undefined) { e.phase = o.ph; e.t = o.tt; e.held = o.held || null; }
      if (o.cells && e.cells) {
        for (var cc = 0; cc < e.cells.length && cc < o.cells.length; cc++) {
          e.cells[cc].lanes[0] = o.cells[cc].l0.map(function (p) { return { id: p[0], pos: p[1] / 1000 }; });
          e.cells[cc].lanes[1] = o.cells[cc].l1.map(function (p) { return { id: p[0], pos: p[1] / 1000 }; });
        }
      }
      if (o.g && e.graph) {
        e.graph.nextNid = o.g.nextNid;
        e.graph.nodes = o.g.nodes.map(function (n) {
          var d = NODE_DEFS[n.k];
          if (!d) return null;                     // 모르는 노드 종류는 버리되 전체를 죽이지 않는다
          var nn = { nid: n.nid, kind: n.k, x: n.x, y: n.y, cfg: n.cfg, state: n.st || {}, out: [], prev: [] };
          // 되먹임 간선은 "직전 틱 값"을 읽는 레지스터다. out/prev 를 0 으로 되살리면
          // 불러온 순간 모든 레지스터가 리셋돼 래치가 풀리고 라인이 예상 밖으로 켜진다.
          for (var q = 0; q < d.outs.length; q++) {
            nn.out.push((n.o && n.o[q] !== undefined) ? n.o[q] : 0);
            nn.prev.push((n.p && n.p[q] !== undefined) ? n.p[q] : nn.out[q]);
          }
          return nn;
        }).filter(function (n) { return !!n; });
        var validNid = {};
        for (var vn = 0; vn < e.graph.nodes.length; vn++) validNid[e.graph.nodes[vn].nid] = 1;
        e.graph.links = o.g.links
          .filter(function (l) { return validNid[l[0]] && validNid[l[2]]; })
          .map(function (l) { return { fn: l[0], fp: l[1], tn: l[2], tp: l[3] }; });
        e.graph.dirty = true;
      }
    }
    if (dropped.length) {
      logError('load', '복원하지 못한 엔티티 ' + dropped.length + '건: ' + dropped.slice(0, 8).join(', '));
      toast('경고: 엔티티 ' + dropped.length + '건을 복원하지 못했다', 'bad');
    }
    nextEntId = Math.max(data.nextId || 0, maxId + 1);
    // **열차는 엔티티를 다 복원한 뒤에 놓는다.** addTrain 은 레일 위인지 보는데,
    // 엔티티 복원 전에 부르면 레일이 아직 없어서 전부 조용히 버려진다
    // (실제로 그렇게 해서 복원 후 열차 0대가 나왔다).
    (data.trains || []).forEach(function (t) {
      var tr = addTrain(Math.round(t.x), Math.round(t.y));
      if (tr) { tr.x = t.x; tr.y = t.y; tr.inv = t.inv || {}; tr.waitT = t.w || 0; }
    });

    nests.length = 0;
    (data.nests || []).forEach(function (n) {
      nests.push({ x: n[0], y: n[1], hp: n[2], maxHp: 350, absorbed: n[3], cool: n[4], seed: n[5] });
    });
    enemies.length = 0;
    (data.enemies || []).forEach(function (e2) {
      var spec = ENEMY_TIERS[e2[3]] || ENEMY_TIERS[0];
      enemies.push({ x: e2[0] / 100, y: e2[1] / 100, hp: e2[2], maxHp: spec.hp, tier: e2[3],
                     target: null, atk: 0, stuckT: 0, lastD: 1e9, side: 1, wob: 0 });
    });
    evolution = data.evo || 0;
    evoPrevPoll = world.totalPollution;     // 증분식이라 기준점을 맞춰야 한다
    if (data.ws) for (var wk in data.ws) waveStats[wk] = data.ws[wk];
    if (data.tut) {
      tutorial.on = data.tut.on !== false; tutorial.step = data.tut.step || 0;
      // 옛 저장본에는 track 이 없다 — 그때는 기초뿐이었으므로 basic 으로 읽는다
      tutorial.track = (data.tut.track === 'adv') ? 'adv' : 'basic';
      tutorial.done = !!data.tut.done; tutorial.flags = data.tut.flags || {};
    }
    if (data.prod) {
      prodStats.smelted = data.prod.smelted || 0;
      prodStats.crafted = data.prod.crafted || 0;
      prodStats.byRecipe = data.prod.byRecipe || {};
    }

    markBeltDirty(); markPowerDirty(); markLogicDirty();
    rebuildPower();
    refreshAllUI();
    toast('불러오기 완료 — ' + fmtTime(gameTime), 'good');
    return true;
  } catch (e3) { logError('load', e3); toast('불러오기 실패: ' + e3, 'bad'); return false; }
}

// --- 부팅 --------------------------------------------------------------------
function boot() {
  var canvas = document.getElementById('view');
  generateWorld(worldSeed);          // initRender 가 world.spawn 을 읽으므로 먼저
  initRender(canvas);
  bindInput(canvas);
  bindMini();
  bindSaveButtons();
  bindMobileBar();
  bindTutorial();
  bindLogicPane();
  fillHelp();
  newGame(worldSeed);
  document.getElementById('help').style.display = 'block';
  requestAnimationFrame(frame);
  window.__READY = true;
}

// 인라인 onclick 은 IIFE 안의 함수를 못 본다 — 전역으로 내보낸다
window.closeTech = closeTech;
window.closeHelp = closeHelp;
window.closeLogic = closeLogic;
window.loadExample = loadExample;
// 인라인 onclick 은 **전역만 본다** — IIFE 안에 두면 클릭이 조용히 죽는다.
window.ruleToGraph = ruleToGraph;
window.graphToRules = graphToRules;
window.saveGame = saveGame;
window.loadGame = loadGame;

// --- 테스트 API --------------------------------------------------------------
// 판정은 전부 이 계약(반환 JSON 필드)으로만 한다. 화면 문자열 눈대중 금지.
window.__GAME = {
  version: VERSION,
  gfx: function () {
    return { canvas: cv ? [cv.width, cv.height] : null, dpr: cam.dpr || 1, zoom: cam.z };
  },
  errors: function () { return ERRORS.slice(); },
  reset: function (seed) { newGame(seed); return gameTime; },
  pause: function (v) { paused = !!v; },

  // 결정론 전진 — 프레임과 무관하게 정확히 n 틱
  run: function (seconds) {
    var n = Math.round(seconds / TICK);
    for (var i = 0; i < n; i++) tick(TICK);
    return { ticks: n, t: gameTime };
  },
  tickOnce: function () { tick(TICK); return gameTime; },
  // **검증 전용 — 게임은 여전히 60 UPS 고정 스텝이다.** 시뮬을 임의의 dt 로 한 번
  // 미는 유일한 경로이고, 존재 이유는 하나다: 같은 게임시간을 다르게 쪼개도 결과가
  // 같은지 물어야 dt 를 곱했는지 아닌지가 갈린다 (교훈 03 의 60배 오염이 그 실패다).
  tickWith: function (dt) { tick(Math.max(0, +dt || 0)); return gameTime; },
  // 유체망 — 이 설비가 속한 망의 물·증기. connected 0 은 "망이 없다"이고
  // 그건 "망에 있는데 비었다"와 다르다.
  fluid: function (id) { var e = entities[id]; return e ? fluidOf(e) : null; },
  // 청사진 — 시험은 플레이어와 같은 경로(영역 캡처 → 붙여넣기)만 쓴다
  bpCapture: function (x0, y0, x1, y1) { return captureBlueprint(x0, y0, x1, y1); },
  bpPaste: function (tx, ty) { return pasteBlueprint(tx, ty); },
  bpInfo: function () {
    if (!blueprint) return null;
    return { w: blueprint.w, h: blueprint.h, count: blueprint.ents.length,
             types: blueprint.ents.map(function (i) { return i.t; }),
             cost: blueprintCost() };
  },
  bpRotate: function () { return rotateBlueprint(); },
  // 청사진 항목의 상대 좌표·방향을 그대로 돌려준다. 회전 게이트가 "어디로 갔는지"를
  // 좌표 단위로 대조해야 하는데, bpInfo 는 종류와 원가만 알려 준다.
  bpEnts: function () {
    if (!blueprint) return [];
    return blueprint.ents.map(function (i) {
      return { t: i.t, dx: i.dx, dy: i.dy, d: i.d };
    });
  },
  bpClear: function () { blueprint = null; return true; },
  // 열차 — 시험도 플레이어와 같은 경로(레일 위 배치)로만 만든다
  trainAdd: function (tx, ty) { var t = addTrain(tx, ty); return t ? t.id : null; },
  trainList: function () {
    return trains.map(function (t) {
      return { id: t.id, x: t.x, y: t.y, moving: t.moving, cargo: trainCargo(t),
               inv: JSON.parse(JSON.stringify(t.inv)), why: t.lastWhy };
    });
  },
  stationInfo: function (id) {
    var e = entities[id];
    if (!e || e.type !== 'station') return null;
    var rt = stationRailTile(e);
    var tr = trainAtStation(e);
    return { rail: rt, hasTrain: !!tr, cargo: tr ? trainCargo(tr) : 0,
             ctl: !!e.trainCtl, hold: !!e.holdTrain };
  },
  fluidNetCount: function () { if (fluidDirty) rebuildFluid(); return fluidNets.length; },
  // 신호 버스 — 지금 읽히는 값(직전 틱 합계)
  bus: function (ch) { return ch === undefined ? busSnapshot() : busRead(ch); },
  busChannels: function () { return BUS_CHANNELS.slice(); },
  setSpeed: function (n) { gameSpeed = Math.max(0, Math.min(60, +n || 1)); return gameSpeed; },
  getSpeed: function () { return gameSpeed; },

  give: function (item, n) { inventory[item] = (inventory[item] || 0) + n; return inventory[item]; },
  giveAll: function (n) {
    for (var i = 0; i < ITEM_IDS.length; i++) inventory[ITEM_IDS[i]] = n;
    return invTotal(inventory);
  },
  // **place 는 free 다** — 비용도 기술도 광맥도 안 본다. 계통 하나만 떼어 재는
  // 시험에는 그게 맞지만, 그걸로 "자력 완주"를 주장하면 거짓이 된다: 광맥 없는
  // 땅에 채광기를 세워 놓고 아무것도 안 캐는 것을 눈치채지 못했다(실측).
  place: function (type, tx, ty, dir) {
    var e = placeEntity(type, tx, ty, dir === undefined ? 1 : dir, true);
    return e ? e.id : null;
  },
  // build 는 **플레이어와 같은 길**로 짓는다 — 재료를 내고, 기술을 요구하고,
  // 채광기는 광맥 위에만 선다. 완주 주행은 이쪽만 써야 한다.
  build: function (type, tx, ty, dir) {
    var e = placeEntity(type, tx, ty, dir === undefined ? 1 : dir, false);
    return e ? e.id : null;
  },
  // refund 를 생략하면 환급 없이 지운다(기존 호출부 그대로). 환급 경로는 플레이어의
  // 철거 버튼이 쓰는 것과 같은 코드라 시험으로 잴 수 있어야 한다.
  remove: function (id, refund) { return removeEntity(id, refund === true); },
  ent: function (id) {
    var e = entities[id];
    if (!e) return null;
    return {
      id: e.id, type: e.type, tx: e.tx, ty: e.ty, w: e.w, h: e.h, dir: e.dir, hp: e.hp, maxHp: e.maxHp,
      enabled: e.enabled, playerEnabled: e.playerEnabled, logicForced: !!e.logicForced,
      logicConflict: e.logicConflict || null,
      powerSat: e.powerSat, net: e.net, working: !!e.working, stallT: e.stallT,
      inv: JSON.parse(JSON.stringify(e.inv)), out: JSON.parse(JSON.stringify(e.out)),
      recipe: e.recipe, progress: e.progress,
      fuel: e.fuel, load: e.load, ammo: e.ammo, filter: e.filter, held: e.held, depleted: !!e.depleted,
      // 터렛의 사격 허가. 노출을 빼먹었더니 시험이 '없는 키' 를 읽고 값이 뒤집혔다고
      // 오독했다 — 없는 것과 false 는 다르다.
      fireOk: (e.fireOk === undefined) ? null : !!e.fireOk,
      beltItems: e.cells ? e.cells.map(function (c) { return cellItemCount(c); }) : null,
      gate: e.cells ? e.cells.map(function (c) { return c.gate; }) : null
    };
  },
  setRecipe: function (id, rid) { var e = entities[id]; if (e) { e.recipe = rid; e.progress = 0; return true; } return false; },
  setFuel: function (id, kj) { var e = entities[id]; if (e) { e.fuel = kj; return true; } return false; },
  setAmmo: function (id, n) { var e = entities[id]; if (e) { e.ammo = n; return true; } return false; },
  fillChest: function (id, item, n) { var e = entities[id]; if (e) { invAdd(e.inv, item, n); return invTotal(e.inv); } return -1; },
  putOnBelt: function (id, item, cellIdx, lane) {
    var e = entities[id];
    if (!e || !e.cells) return false;
    return beltAccept(e.cells[cellIdx || 0], item, lane);
  },

  // 로직 그래프 조작 (테스트가 배선을 직접 짠다)
  // --- 규칙(문장) ---------------------------------------------------------
  ruleAdd: function (ctrlId, patch) {
    var e = entities[ctrlId]; if (!e || e.type !== 'controller') return null;
    if (!e.rules) { e.rules = []; e.nextRuleId = 1; }
    var r = newRule(e.nextRuleId++);
    if (patch) deepMerge(r, patch);
    e.rules.push(r);
    return r.id;
  },
  ruleSet: function (ctrlId, rid, patch) {
    var e = entities[ctrlId]; if (!e || !e.rules) return false;
    for (var i = 0; i < e.rules.length; i++) {
      if (e.rules[i].id === rid) { deepMerge(e.rules[i], patch); return true; }
    }
    return false;
  },
  ruleRemove: function (ctrlId, rid) {
    var e = entities[ctrlId]; if (!e || !e.rules) return false;
    for (var i = e.rules.length - 1; i >= 0; i--) if (e.rules[i].id === rid) { e.rules.splice(i, 1); return true; }
    return false;
  },
  ruleList: function (ctrlId) {
    var e = entities[ctrlId]; if (!e || !e.rules) return null;
    return e.rules.map(function (r) {
      return { id: r.id, name: r.name, enabled: r.enabled,
               sentence: ruleSentence(r), blocked: ruleBlockedReason(r) };
    });
  },
  ruleCompile: function (ctrlId) {
    var e = entities[ctrlId]; if (!e || e.type !== 'controller') return null;
    var res = compileRules(e);
    markLogicDirty();
    return res;
  },
  ruleHandEdited: function (ctrlId) {
    var e = entities[ctrlId]; return e ? !!e.handEdited : null;
  },
  ruleCards: function () {
    return RULE_CARDS.map(function (c) {
      return { id: c.id, title: c.title, why: c.why || '',
               locked: !!(c.need && !techDone[c.need]) };
    });
  },
  ruleFromCard: function (ctrlId, cardId) {
    var e = entities[ctrlId]; if (!e || e.type !== 'controller') return null;
    for (var i = 0; i < RULE_CARDS.length; i++) {
      if (RULE_CARDS[i].id !== cardId) continue;
      if (RULE_CARDS[i].need && !techDone[RULE_CARDS[i].need]) return null;
      if (!e.rules) { e.rules = []; e.nextRuleId = 1; }
      var r = newRule(e.nextRuleId++);
      RULE_CARDS[i].make(r);
      e.rules.push(r);
      return r.id;
    }
    return null;
  },

  // 노드의 좌표까지 본다 — 좌표가 곧 평가 순서라 배치가 흔들리면 회로가 달라진다
  gNodes: function (ctrlId) {
    var e = entities[ctrlId]; if (!e || !e.graph) return [];
    return e.graph.nodes.map(function (n) {
      return { nid: n.nid, kind: n.kind, x: Math.round(n.x), y: Math.round(n.y), rule: n.rule || null };
    });
  },

  gAdd: function (ctrlId, kind, x, y) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    return graphAddNode(e.graph, kind, x || 0, y || 0).nid;
  },
  gCfg: function (ctrlId, nid, key, val) {
    var e = entities[ctrlId]; if (!e) return false;
    var n = graphNode(e.graph, nid); if (!n) return false;
    n.cfg[key] = val; e.graph.dirty = true; return true;
  },
  gLink: function (ctrlId, fn, fp, tn, tp) {
    var e = entities[ctrlId]; if (!e) return false;
    return graphLink(e.graph, fn, fp, tn, tp);
  },
  // 배선을 끊는다. 시험이 "끊었다 다시 이었을 때" 를 재려면 필요한데, 화면에는
  // 이미 있는 동작(선을 잡아 떼기)이고 모델 쪽 훅만 없었다.
  gUnlink: function (ctrlId, tn, tp) {
    var e = entities[ctrlId]; if (!e || !e.graph) return false;
    graphUnlink(e.graph, tn, tp); return true;
  },
  // 노드의 화면상 위치 (터치 드래그가 실제로 옮겼는지 보려면 좌표가 필요하다)
  // 노드의 대상 목록 필터 (게이트가 '고를 수 있는 건물' 을 검정한다)
  // 컴파일 전 그래프에서 readIn 이 안전한지 검정하기 위한 훅
  readInProbe: function (ctrlId, nid, port) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    var n = graphNode(e.graph, nid); if (!n) return null;
    try { return readIn(e.graph, n, port || 0); } catch (err) { return 'THREW:' + err.message; }
  },
  // 전수 스윕용 열거 훅 — "모든 X" 를 실제로 하나씩 돌려 보려면 목록이 필요하다
  nodeKinds: function () { return NODE_KINDS.slice(); },
  nodeAvailable: function (kind) { return nodeAvailable(kind); },
  techIds: function () { return TECH_IDS.slice(); },
  // 연구 설명문도 상수와 대조 대상이다 — "모든 벨트가 30개/s" 는 효과표에서 나온다
  techInfo: function (tid) {
    var T = TECHS[tid]; if (!T) return null;
    return { name: T.name, desc: T.desc || '', effect: TECH_EFFECTS[tid] || null,
             unlock: (T.unlock || []).slice(), cost: T.cost, needs: (T.needs || []).slice() };
  },
  buildingTypes: function () { return Object.keys(BUILDINGS); },
  buildingInfo: function (t) {
    var B = BUILDINGS[t];
    if (!B) return null;
    // name·desc 도 내준다 — 게임 안 설명문이 실제 상수와 어긋나는지 시험이 대조한다.
    // 설명문은 플레이어에게 하는 약속이고, 상수만 바뀌면 조용히 거짓말이 된다.
    return { cost: B.cost, tech: B.tech || null, w: B.w, h: B.h, power: B.power || 0,
             name: B.name, desc: B.desc || '' };
  },
  recipeIds: function () { return Object.keys(RECIPES); },
  recipeInfo: function (rid) {
    var r = RECIPES[rid]; if (!r) return null;
    return { cat: r.cat, time: r.time, inp: JSON.parse(JSON.stringify(r.inp)),
             out: JSON.parse(JSON.stringify(r.out)), handOk: !!r.handOk, tech: r.tech || null };
  },
  // 벨트 센서를 시험하려면 벨트에 물건을 직접 얹어야 한다
  // lanes 는 **엔티티가 아니라 셀** 에 있다 (20_belt.js:21). 엔티티에서 찾다가
  // 조용히 false 를 돌려주고, 그 탓에 벨트 센서가 고장난 것처럼 보였다.
  // 벨트 게이트가 실제로 닫혔는지 (셀의 gate 플래그)
  gateState: function (id) {
    var e = entities[id];
    if (!e || !e.cells || !e.cells.length) return null;
    for (var i = 0; i < e.cells.length; i++) if (!e.cells[i].gate) return false;
    return true;
  },
  beltPut: function (id, item, pos) {
    var e = entities[id];
    if (!e || !e.cells || !e.cells.length) return false;
    e.cells[0].lanes[0].push({ id: item, pos: (pos === undefined ? 0.5 : pos) });
    return true;
  },
  nodeTargets: function (kind) {
    var d = NODE_DEFS[kind]; if (!d) return null;
    for (var i = 0; i < d.cfg.length; i++) {
      if (d.cfg[i].t === 'ent') return d.cfg[i].filter || Object.keys(BUILDINGS);
    }
    return null;
  },
  // 노드를 옮긴다 (좌표가 평가 순서를 정하므로 그것을 검정하는 데 쓴다)
  gMove: function (ctrlId, nid, x, y) {
    var e = entities[ctrlId]; if (!e || !e.graph) return false;
    var n = graphNode(e.graph, nid); if (!n) return false;
    n.x = x; n.y = y; e.graph.dirty = true; return true;
  },
  // 펄스 누적 발화 횟수 (값 표본으로는 1틱 신호를 못 잡는다)
  beltClear: function (id) {
    var e = entities[id]; if (!e || !e.cells) return false;
    for (var i = 0; i < e.cells.length; i++) { e.cells[i].lanes[0].length = 0; e.cells[i].lanes[1].length = 0; }
    return true;
  },
  // 이 제어기 그래프에 실제로 놓인 노드 종류 (완주 판정이 '다 써 봤는가'를 본다)
  gKinds: function (ctrlId) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    var seen = {}, r = [];
    for (var i = 0; i < e.graph.nodes.length; i++) {
      var k = e.graph.nodes[i].kind;
      if (!seen[k]) { seen[k] = 1; r.push(k); }
    }
    return r;
  },
  gFires: function (ctrlId, nid, port) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    var n = graphNode(e.graph, nid); if (!n || !n.fires) return 0;
    return n.fires[port || 0] || 0;
  },
  setEnabled: function (id, on) {
    var e = entities[id]; if (!e) return false;
    e.playerEnabled = !!on; e.enabled = !!on; return true;
  },
  gPos: function (ctrlId, nid) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    var n = graphNode(e.graph, nid); if (!n) return null;
    return { x: n.x, y: n.y };
  },
  // 타일 좌표 → CSS 픽셀. 터치 좌표는 clientX/Y 라 dpr 을 나눈 값이어야 한다.
  // cam.x/y 와 screenOf 는 **타일 단위**다 (픽셀이 아니다 — cam.x 는 [4, W-4] 로
  // 클램프된다). TILE 을 곱했다가 화면좌표가 59587 로 나왔다.
  tileToScreen: function (tx, ty) {
    var p = screenOf(tx + 0.5, ty + 0.5), d = cam.dpr || 1;
    return { x: p.x / d, y: p.y / d };
  },
  camera: function () { return { x: cam.x, y: cam.y, z: cam.z, dpr: cam.dpr || 1 }; },
  // 녹화용 — 방금 지은 곳을 비춰야 영상이 무엇을 하는지 보여준다
  setCamera: function (x, y, z) {
    if (x !== undefined && x !== null) cam.x = clamp(x, 4, W - 4);
    if (y !== undefined && y !== null) cam.y = clamp(y, 4, H - 4);
    if (z) cam.z = clamp(z, 0.35, 2.6);
    return { x: cam.x, y: cam.y, z: cam.z };
  },
  gOut: function (ctrlId, nid, port) {
    var e = entities[ctrlId]; if (!e) return null;
    var n = graphNode(e.graph, nid); if (!n) return null;
    return n.out[port || 0];
  },
  gInfo: function (ctrlId) {
    var e = entities[ctrlId]; if (!e || !e.graph) return null;
    if (e.graph.dirty) graphCompile(e.graph);
    return { nodes: e.graph.nodes.length, links: e.graph.links.length,
             cycles: e.graph.cycles || 0, order: e.graph.order.slice() };
  },

  research: function (tid) {
    if (tid) { techDone[tid] = true; applyTechEffects(); return true; }
    return false;
  },
  setResearch: function (tid) { return startResearch(tid); },
  addResearch: function (n) { addResearchProgress(n); return researchProgress; },

  spawnEnemyAt: function (x, y, tier) {
    var spec = ENEMY_TIERS[tier || 0];
    enemies.push({ x: x, y: y, hp: spec.hp, maxHp: spec.hp, tier: tier || 0,
                   target: null, atk: 0, stuckT: 0, lastD: 1e9, side: 1, wob: 0 });
    return enemies.length;
  },
  clearEnemies: function () { enemies.length = 0; nests.length = 0; return 0; },
  addPollutionAt: function (tx, ty, amt) { addPollution(tx, ty, amt); return world.totalPollution; },

  beltDelivered: function () { return beltStats.delivered; },
  resetBeltStats: function () { beltStats.delivered = 0; return 0; },

  render: function () { render(); },
  setZoom: function (z) { cam.z = z; return cam.z; },
  center: function (x, y) { cam.x = x; cam.y = y; clampCam(); return [cam.x, cam.y]; },

  // 음성 대조군용 — 아무것도 안 그리고 배경만 칠한다. 빈 화면 검출기가 실제로
  // 작동하는지 확인하는 데 쓴다 (검출기가 살아 있지 않으면 render.notBlank 는
  // 아무것도 보증하지 않는다).
  renderBlank: function () {
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a1e17';
    ctx.fillRect(0, 0, cv.width, cv.height);
    return true;
  },
  // 특정 타일을 화면 중앙에 두고 그린 뒤, 중앙 영역의 픽셀 지문을 돌려준다.
  // "샀는데 화면에 아무것도 안 생긴다"를 잡는 시각 총조사용.
  probeAt: function (tx, ty, size, zoom) {
    if (!ctx) return null;
    var oz = cam.z, ox = cam.x, oy = cam.y;
    cam.z = zoom || 1.4; cam.x = tx; cam.y = ty;
    render();
    var s = size || 96;
    var x0 = Math.max(0, ((cv.width - s) / 2) | 0), y0 = Math.max(0, ((cv.height - s) / 2) | 0);
    var d = ctx.getImageData(x0, y0, Math.min(s, cv.width), Math.min(s, cv.height)).data;
    var set = {}, n = 0, sum = 0;
    for (var i = 0; i < d.length; i += 4) {
      var key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!set[key]) { set[key] = 1; n++; }
      sum = (sum * 31 + key) | 0;
    }
    cam.z = oz; cam.x = ox; cam.y = oy;
    return { uniqueRGB: n, hash: sum >>> 0 };
  },

  // 물질수지 — 땅에서 뽑은 개수 vs 세계 어딘가에 실제로 존재하는 개수.
  // 광석은 창고로 저절로 가지 않으므로, 채광 라인만 놓고 재면 좌우가 같아야 한다.
  materialCensus: function (items) {
    var want = items || ['iron-ore', 'copper-ore', 'coal', 'stone'];
    var have = {};
    for (var i = 0; i < want.length; i++) have[want[i]] = 0;
    function add(k, n) { if (have[k] !== undefined) have[k] += n; }
    forEachEntity(function (e) {
      for (var a in e.inv) add(a, e.inv[a]);
      for (var b in e.out) add(b, e.out[b]);
      if (e.cells) for (var c = 0; c < e.cells.length; c++) {
        var m = beltContents(e.cells[c]);
        for (var k in m) add(k, m[k]);
      }
      if (e.type === 'inserter' && e.held) add(e.held, 1);
    });
    for (var w = 0; w < want.length; w++) add(want[w], inventory[want[w]] || 0);
    var total = 0;
    for (var t in have) total += have[t];
    return { mined: world.minedTotal, present: total, byItem: have };
  },

  // 결정론 검정용 상태 지문
  //
  // **오염 격자가 빠져 있었고, 그래서 결정성이 깨진 것을 이 지문이 못 봤다.**
  // 예전에는 누적 발생량(totalPollution)만 넣었는데 그건 배출량이라 확산·감쇠와
  // 무관하다. 확산 타이머가 안 되돌려져 매 주행 위상이 달랐을 때, 격자 총량은
  // 갈리는데 이 지문은 끝까지 같은 값을 냈다 — 지문이 못 보는 상태는 지문이 없는
  // 것과 같다. 진화도(evolution)도 같은 이유로 넣는다. 격자는 칸마다 넣으면
  // 지문이 너무 커지므로 총량을 충분히 잘게 반올림해 넣는다.
  stateHash: function () {
    var pollSum = 0;
    for (var pz = 0; pz < world.poll.length; pz++) pollSum += world.poll[pz];
    var s = [Math.round(gameTime * 1000), entOrder.length, world.minedTotal,
             Math.round(world.totalPollution * 1000), Math.round(pollSum * 1000),
             Math.round(evolution * 1e6), enemies.length];
    for (var i = 0; i < entOrder.length; i++) {
      var e = entities[entOrder[i]];
      s.push(e.id, e.tx, e.ty, e.dir, Math.round(e.hp), e.enabled ? 1 : 0,
             Math.round((e.progress || 0) * 1000), Math.round((e.fuel || 0)), e.ammo || 0);
      for (var k in e.inv) s.push(k, e.inv[k]);
      for (var o in e.out) s.push(o, e.out[o]);
      if (e.cells) for (var c = 0; c < e.cells.length; c++) {
        for (var li = 0; li < 2; li++) {
          var lane = e.cells[c].lanes[li];
          for (var q = 0; q < lane.length; q++) s.push(lane[q].id, Math.round(lane[q].pos * 10000));
        }
      }
    }
    for (var m = 0; m < enemies.length; m++) {
      s.push(Math.round(enemies[m].x * 1000), Math.round(enemies[m].y * 1000), Math.round(enemies[m].hp));
    }
    var str = s.join('|'), h = 2166136261;
    for (var z = 0; z < str.length; z++) { h ^= str.charCodeAt(z); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  },

  // 특정 광종이 2x2 로 깔린 자리를 찾아준다 (하네스가 채광기를 놓을 곳)
  // 스폰 근처에서 채광기(2x2)를 놓을 수 있는 자리를 가까운 순으로 여러 개.
  // oreSpot 은 지도 좌상단부터 훑어 첫 자리 하나만 주는데, 배치를 설계하려면
  // "내 발밑에서 가까운 곳" 이 필요하다.
  oreSpotsNear: function (itemId, cx, cy, count, minAmt) {
    var want = ORE_ITEM.indexOf(itemId);
    if (want <= 0) return [];
    var found = [];
    for (var y = 1; y < H - 2; y += 2) {
      for (var x = 1; x < W - 2; x += 2) {
        var ok = true;
        for (var dy = 0; dy < 2 && ok; dy++) {
          for (var dx = 0; dx < 2; dx++) {
            var i = idx(x + dx, y + dy);
            if (world.ore[i] !== want || world.oreAmt[i] < (minAmt || 500) || world.occ[i] !== 0) { ok = false; break; }
          }
        }
        if (!ok) continue;
        var d = Math.abs(x - cx) + Math.abs(y - cy);
        found.push({ x: x, y: y, d: d, amount: surveyOre(x, y, 2, 2).total });
      }
    }
    found.sort(function (a, b) { return a.d - b.d; });
    return found.slice(0, count || 8);
  },
  // 배치가 왜 거절됐는지 그대로 돌려준다. 자율 플레이어가 실패 사유를 추측하다
  // 두 판을 날렸다 ('자리 충돌' 인 줄 알았는데 실제로는 '톱니 5개 필요' 였다).
  whyPlace: function (type, tx, ty, dir) {
    var r = canPlace(type, tx, ty, dir === undefined ? 1 : dir);
    return r.ok ? 'ok' : (r.why || '알 수 없음');
  },
  entIds: function () {
    var r = []; forEachEntity(function (e) { r.push([e.id, e.type]); }); return r;
  },
  // 살아 있는 적의 좌표 — 녹화에서 카메라가 전투를 따라가려면 필요하다.
  enemyList: function () {
    return enemies.map(function (e) {
      return { x: e.x, y: e.y, hp: Math.round(e.hp), tier: e.tier };
    });
  },
  nestList: function () {
    return nests.map(function (n) { return { x: Math.round(n.x), y: Math.round(n.y), hp: Math.round(n.hp) }; });
  },
  oreSpot: function (itemId) {
    var want = ORE_ITEM.indexOf(itemId);
    if (want <= 0) return null;
    for (var y = 1; y < H - 2; y++) {
      for (var x = 1; x < W - 2; x++) {
        var ok = true;
        for (var dy = 0; dy < 2 && ok; dy++) {
          for (var dx = 0; dx < 2; dx++) {
            var i = idx(x + dx, y + dy);
            if (world.ore[i] !== want || world.oreAmt[i] < 500 || world.occ[i] !== 0) { ok = false; break; }
          }
        }
        if (ok) return { x: x, y: y, amount: surveyOre(x, y, 2, 2).total };
      }
    }
    return null;
  },
  // (cx,cy)에서 가장 가까운 2x2 광맥 자리
  oreSpotNear: function (itemId, cx, cy) {
    var want = ORE_ITEM.indexOf(itemId);
    if (want <= 0) return null;
    var best = null, bestD = Infinity;
    for (var y = 1; y < H - 2; y++) {
      for (var x = 1; x < W - 2; x++) {
        var d = dist2(x, y, cx, cy);
        if (d >= bestD) continue;
        var ok = true;
        for (var dy = 0; dy < 2 && ok; dy++) {
          for (var dx = 0; dx < 2; dx++) {
            var i = idx(x + dx, y + dy);
            if (world.ore[i] !== want || world.oreAmt[i] < 300 || world.occ[i] !== 0) { ok = false; break; }
          }
        }
        if (ok) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  },
  enemyPositions: function () {
    return enemies.map(function (e) { return [Math.round(e.x * 1000) / 1000, Math.round(e.y * 1000) / 1000, e.hp]; });
  },
  buildIds: function () { return BUILD_IDS.slice(); },
  itemIds: function () { return ITEM_IDS.slice(); },
  itemName: function (iid) { return ITEMS[iid] ? ITEMS[iid].name : null; },
  // 적 등급표 — README 가 체력 15/75/375 를 문헌값(biter)으로 싣는다
  enemyTiers: function () {
    return ENEMY_TIERS.map(function (t) {
      return { name: t.name, hp: t.hp, dmg: t.dmg, speed: t.speed };
    });
  },
  // 노드의 표시 이름과 연구 조건 — 연구 화면의 해금 목록이 실제와 맞는지 대조한다
  nodeInfo: function (kind) {
    var d = NODE_DEFS[kind]; if (!d) return null;
    return { label: d.label, cat: d.cat, tech: d.tech || null };
  },
  // 벨트/분배기의 셀 좌표 — 점유 사각형과 일치하는지 검사할 때 쓴다
  cellCoords: function (id) {
    var e = entities[id];
    if (!e || !e.cells) return null;
    return e.cells.map(function (c) { return [c.tx, c.ty]; });
  },
  setSplitterPrio: function (id, p) {
    var e = entities[id];
    if (!e || e.type !== 'splitter') return false;
    e.outPrio = (p === null || p === undefined) ? null : (p | 0);
    return true;
  },
  // entOrder 의 길이가 아니라 **실제로 살아 있는** 엔티티 수.
  // id 충돌로 엔티티가 사라져도 entOrder 는 그대로라 겉보기 개수는 안 변한다.
  liveEntityCount: function () {
    var n = 0;
    for (var i = 0; i < entOrder.length; i++) if (entities[entOrder[i]]) n++;
    return n;
  },
  entitiesOfType: function (t) {
    var out = [];
    forEachEntity(function (e) { if (e.type === t) out.push(e.id); });
    return out;
  },
  canAcceptTest: function (id, item) { return canAccept(entities[id], item); },
  // 튜토리얼 — 판정은 "세계가 실제로 그렇게 됐는가"로만 한다
  tutorial: function () {
    var steps = curSteps();
    return {
      on: tutorial.on, step: tutorial.step, done: tutorial.done,
      track: tutorial.track,
      total: steps.length,
      id: tutorial.done ? null : steps[tutorial.step].id,
      ids: steps.map(function (s) { return s.id; }),
      advIds: ADVANCED_STEPS.map(function (s) { return s.id; }),
      flags: JSON.parse(JSON.stringify(tutorial.flags)),
      prod: { smelted: prodStats.smelted, crafted: prodStats.crafted,
              byRecipe: JSON.parse(JSON.stringify(prodStats.byRecipe)) }
    };
  },
  howToGet: function (itemId) { return howToGet(itemId); },
  takeToStock: function (id) { return takeAllToStock(entities[id]); },
  takeableCount: function (id) { return stockTakeCount(entities[id]); },
  putFromStock: function (id, perItemMax) { return putFromStock(entities[id], perItemMax); },
  takeOutputToStock: function (id) { return takeOutputToStock(entities[id]); },
  puttableItems: function (id) { return stockPuttableItems(entities[id]); },
  tutorialReset: function (on) { resetTutorial(on); renderTutorial(); return tutorial.step; },
  tutorialSkip: function () { var s = skipTutorialStep(); renderTutorial(); return s; },
  // 각 단계의 check() 를 지금 상태에서 직접 물어본다 (게이트가 단계별로 검정할 때)
  tutorialAdvance: function () { var ok = startAdvanced(); renderTutorial(); return ok; },
  // 도달성 탐색이 쓴 걸음 수. 순환 방어가 깨지면 이 숫자가 상한까지 폭발한다 —
  // "멈추나 안 멈추나"는 게이트가 못 보지만 걸음 수는 볼 수 있다.
  reachSteps: function (reset) { if (reset) resetReachSteps(); return reachStepsTotal; },
  // **id 로 찾는다.** 번호로 지목하면 단계를 하나 추가할 때마다 게이트가 통째로
  // 밀려 깨진다 (실제로 5단계를 둘로 나누자 4건이 어긋났다).
  // **두 트랙을 다 뒤진다.** 예전엔 지금 트랙만 봐서, 기초 진행 중에 심화 id 를 물으면
  // null 이 나왔다 — 호출자에게 null 은 '해당 없음'과 '실패'가 구별되지 않아, 세계
  // 상태가 어떻든 0/9 로 읽히는 게이트가 만들어졌다. 판정은 순수한 세계 상태 술어이고
  // id 는 두 트랙에 걸쳐 유일하므로(검증함), 트랙과 무관하게 답할 수 있다.
  // 단계의 제목·필요 재료 문구 — 문구가 실제 비용과 맞는지 시험이 대조한다.
  // 여기 적힌 재료를 보고 플레이어가 준비하므로, 틀리면 따라 하다 막힌다.
  tutorialSteps: function () {
    var lists = [TUTORIAL_STEPS, ADVANCED_STEPS], out2 = [];
    for (var L = 0; L < lists.length; L++) {
      for (var i = 0; i < lists[L].length; i++) {
        var st2 = lists[L][i];
        out2.push({ id: st2.id, track: L ? 'adv' : 'basic',
                    title: st2.title || '', need: st2.need || '' });
      }
    }
    return out2;
  },
  tutorialCheckById: function (id) {
    var lists = [TUTORIAL_STEPS, ADVANCED_STEPS];
    for (var L = 0; L < lists.length; L++) {
      var steps = lists[L];
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].id !== id) continue;
        try { return !!steps[i].check(); } catch (e) { return 'ERROR:' + e; }
      }
    }
    return null;                     // 정말 없는 id 일 때만 null
  },
  tutorialCheck: function (idx) {
    var s = curSteps()[idx];
    if (!s) return null;
    try { return !!s.check(); } catch (e) { return 'ERROR:' + e; }
  },

  setFilter: function (id, item) {
    var e = entities[id];
    if (!e || e.type !== 'inserter') return false;
    e.playerFilter = item || null; e.filter = e.playerFilter; return true;
  },
  // 실제 나무 수 vs 오염 흡수 인구조사의 합 — 둘이 어긋나면 벌목한 나무가 계속 흡수한다
  treeCount: function () {
    var total = 0;
    for (var i = 0; i < world.tree.length; i++) if (world.tree[i]) total++;
    if (!treeCensusDone) rebuildTreeCensus();
    var census = 0;
    for (var c = 0; c < treeCountPerChunk.length; c++) census += treeCountPerChunk[c];
    return { total: total, census: census };
  },
  entAtTile: function (tx, ty) { var e = entityAt(tx, ty); return e ? e.id : null; },
  // 여기서 treeCensusDone 을 무효화하면 안 된다 — 전량 재조사가 일어나 인구조사가
  // 저절로 맞아떨어지고, "벌목해도 안 깎는다" 결함을 게이트가 못 보게 된다.
  // (돌연변이 역검정에서 실제로 그 훅 때문에 MISS 가 났다.) 실제 게임 경로인
  // placeEntity → clearTrees 도 무효화하지 않으므로 이쪽이 더 충실하다.
  clearTrees: function (tx, ty, w, h) { return clearTrees(tx, ty, w, h); },
  // 시험판 초기화 — 시작 키트(발전기·전주)까지 전부 지운다.
  // 이걸 안 지우면 시작 발전기 900kW 가 시험 전력망에 몰래 합류해 브라운아웃 시험이
  // 성립하지 않는다(실제로 그렇게 오판했다).
  clearEntities: function () {
    var ids = entOrder.slice();
    for (var i = 0; i < ids.length; i++) removeEntity(ids[i], false);
    entities = {}; entOrder = []; world.occ.fill(0);
    markBeltDirty(); markPowerDirty(); markLogicDirty(); rebuildPower();
    return entOrder.length;
  },
  setInv: function (item, n) { inventory[item] = n; return inventory[item]; },

  // UI 조작 훅 — 스크린샷/스모크 테스트가 실제 화면을 열어 볼 때 쓴다
  ui: {
    // 녹화·시연용 — 튜토리얼 패널이 공장을 가린다
    closeTutor: function () { tutorial.on = false; renderTutorial(); return true; },
    closeHelp: function () { closeHelp(); },
    openHelp: function () { document.getElementById('help').style.display = 'block'; },
    openLogic: function (id) { var e = entities[id]; if (!e) return false; openLogic(e); return true; },
    // 제어기는 문장 화면이 먼저 열린다. 회로 DOM 을 보는 시험은 이걸로 전환한다.
    showGraph: function () { showRules(false); return true; },
    showRules: function () { showRules(true); return true; },
    rulesVisible: function () {
      var rp = document.getElementById('rulePane');
      return !!rp && rp.classList.contains('on');
    },
    closeLogic: function () { closeLogic(); },
    loadExample: function () { loadExample(); return curCtrl ? curCtrl.graph.nodes.length : 0; },
    openTech: function () { document.getElementById('tech').style.display = 'block'; renderTech(); },
    closeTech: function () { closeTech(); },
    select: function (id) { var e = entities[id]; if (!e) return false; selected = id; showInsp(e); return true; },
    tool: function (t) { selectTool(t); return tool; },
    hover: function (tx, ty) { hoverT.x = tx; hoverT.y = ty; return [hoverT.x, hoverT.y]; },
    refresh: function () { refreshAllUI(); renderAlarms(); renderMini(); refreshInsp(); },
    // 타일 → CSS 픽셀 좌표. 합성 마우스 이벤트를 정확한 칸에 쏘기 위한 것.
    screenOf: function (wx, wy) {
      var p = screenOf(wx, wy), d = cam.dpr || 1;
      return { x: p.x / d, y: p.y / d };
    },
    tileUnderCursor: function () { return [hoverT.x, hoverT.y]; },
    curTool: function () { return tool; },
    // 모바일 시험용 — 도구를 든 채로 스와이프하면 건설이라, 지도 이동을 재려면
    // 먼저 손을 비워야 한다. tool(undefined) 로도 되지만 의도가 안 드러난다.
    clearTool: function () { selectTool(null); return tool; },
    renderGraph: function () { renderGraph(); return true; },
    updateLive: function () { updateLive(); return true; },
    panGraph: function (dx, dy) { gpan.x += dx; gpan.y += dy; applyPan(); return { x: gpan.x, y: gpan.y }; },
    graphPan: function () { return { x: gpan.x, y: gpan.y, z: gpan.z }; },
    curDir: function () { return toolDir; },
    // 청사진 모드는 UI 상태다. 시험이 "붙여넣기 중" 상황을 만들려면 여기로 들어온다
    // (드래그로 담으면 자동으로 paste 가 되지만, 터치 리그는 그 드래그를 안 거친다).
    setBpMode: function (m) { bpMode = m; return bpMode; },
    bpMode: function () { return bpMode; },
    logicOpen: function () { return logicOpen; },
    selectedId: function () { return selected; },
    panelText: function (sel) { var el = document.querySelector(sel); return el ? el.textContent.trim() : null; },
    nodeCount: function () { return document.querySelectorAll('#graphInner .node').length; },
    linkCount: function () { return document.querySelectorAll('#links path').length; }
  },
  clearOut: function (id) { var e = entities[id]; if (!e) return false; e.out = {}; markPowerDirty(); return true; },
  powerCheat: function (v) { powerCheatOn = !!v; markPowerDirty(); return powerCheatOn; },

  setPlayerEnabled: function (id, v) {
    var e = entities[id]; if (!e) return false;
    e.playerEnabled = !!v; if (!e.logicForced) e.enabled = !!v;
    markPowerDirty(); return true;
  },
  gRemove: function (ctrlId, nid) {
    var e = entities[ctrlId]; if (!e || !e.graph) return false;
    graphRemoveNode(e.graph, nid); return true;
  },
  handCraft: function (rid) { return handCraft(rid); },
  handCancel: function (i) { return handCancel(i); },

  save: function () { return saveGame(); },
  load: function (raw) { return loadGame(raw); },
  saveRaw: function () { saveGame(); return localStorage.getItem('logic-foundry-save'); },

  state: function () {
    var counts = {};
    forEachEntity(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
    var pollTot = 0;
    for (var i = 0; i < world.poll.length; i++) pollTot += world.poll[i];
    return {
      t: gameTime, seed: worldSeed,
      inventory: JSON.parse(JSON.stringify(inventory)),
      entityCount: entOrder.length, counts: counts,
      power: { supply: powerStats.supply, demand: powerStats.demand, sat: powerStats.sat, nets: powerStats.netCount },
      pollution: pollTot, totalPollution: world.totalPollution, absorbed: world.absorbedByTrees,
      mined: world.minedTotal,
      evolution: evolution,
      enemies: enemies.length, nests: nests.length,
      waves: { spawned: waveStats.spawned, killed: waveStats.killed,
               lost: waveStats.buildingsLost, waves: waveStats.waves,
               lostList: waveStats.lost.slice() },
      research: { current: currentResearch, progress: researchProgress,
                  frac: researchFrac(), done: Object.keys(techDone) },
      beltDelivered: beltStats.delivered,
      handCrafts: handCraftCount,
      handQueue: handQueue.length,
      handQueueHead: handQueue.length ? { rid: handQueue[0].rid, left: handQueue[0].left } : null,
      alarms: alarms.slice(), displays: displays.slice(),
      mult: { belt: beltSpeedMul, machine: machineSpeedMul, power: machinePowerMul },
      rngDraws: RNG.draws()
    };
  },

  // 설계 상수 원본 — 시험이 **공개 문헌값과 직접 대조**하기 위해 통째로 내준다.
  // spec() 은 파생값이라 SPEC 이 바뀌면 같이 움직인다. 그것만으로는 "구현이 SPEC 을
  // 지키는가" 밖에 못 보고, "SPEC 이 README 가 약속한 숫자인가" 는 아무도 안 본다.
  specRaw: function () { var o = {}; for (var k in SPEC) o[k] = SPEC[k]; return o; },

  // 오라클 상수 — 하네스가 이 값으로 기대 처리량을 계산한다
  spec: function () {
    return { beltPerSec: SPEC.beltTilesPerSec / SPEC.beltSlotGap * 2 * beltSpeedMul,
             beltLaneTilesPerSec: SPEC.beltTilesPerSec * beltSpeedMul,
             inserterPerSec: 1 / SPEC.inserterSwing,
             minerPerSec: SPEC.minerRate, furnaceTime: RECIPES['iron-plate'].time,
             genKw: SPEC.genOutput, coalKj: SPEC.coalEnergy,
             turretRange: SPEC.turretRange, turretDps: SPEC.turretDps,
             pumpRate: SPEC.pumpRate, boilerFluid: SPEC.boilerFluid,
             boilerKw: SPEC.boilerPower, engineSteam: SPEC.engineSteam,
             engineKw: SPEC.engineOutput, fluidPerTile: SPEC.fluidPerTile,
             trainSpeed: SPEC.trainSpeed, trainCargoCap: SPEC.trainCargoCap,
             trainDwell: SPEC.trainDwell };
  }
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { guard('boot', boot); });
  else guard('boot', boot);
}
