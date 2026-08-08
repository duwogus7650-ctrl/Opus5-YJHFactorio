// ===========================================================================
//  헤드리스 검증 드라이버 — 빌드된 HTML에 주입되어 게임을 강제 구동한다.
//  판정은 window.__GAME 이 돌려주는 JSON 필드(= 산출물의 출력 계약)로만 한다.
//  결과는 #testout 에 @@JSON_START@@ ... @@JSON_END@@ 로 싣는다.
//
//  이 파일의 규율:
//   * 기대값은 SPEC 상수에서 계산해 온다. 숫자를 손으로 적으면 스펙을 바꿔도
//     게이트가 안 따라와서 조용히 거짓 GREEN 이 된다.
//   * 음성 대조군에는 "조건이 실제로 발생했는가"를 함께 단언한다. 조건이 안 일어나서
//     통과한 대조군은 아무것도 보증하지 않는다.
//   * selftest.mustFail 은 반드시 FAIL 이어야 한다. PASS 로 오면 하네스가 고장난 것.
// ===========================================================================
(function () {
  var checks = [];
  function chk(name, ok, detail, expectFail) {
    checks.push({ name: name, ok: !!ok, detail: String(detail), expectFail: !!expectFail });
  }
  function emit(obj) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(obj) + '@@JSON_END@@';
  }
  function near(a, b, tolFrac, absFloor) {
    var tol = Math.max(Math.abs(b) * (tolFrac === undefined ? 0.05 : tolFrac), absFloor || 0);
    return Math.abs(a - b) <= tol;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  var G, SP;
  var TICKS = function (sec) { return Math.round(sec * 60); };

  // 시험용 깨끗한 판.
  //  realPower=false (기본) → 전력을 논외로 두고 다른 계통만 잰다.
  //  전력 자체는 아래 6번 구간에서 진짜 발전기·전주로 따로 검정하므로 우회로가
  //  전력 검증을 갉아먹지 않는다. (전주를 시험 구역에 깔면 건물 자리를 뺏어
  //  "배치 실패"가 "기능 실패"로 둔갑한다 — 처음에 실제로 그렇게 오판했다.)
  function labSetup(seed, realPower) {
    G.reset(seed === undefined ? 424242 : seed);
    G.clearEntities();          // 시작 키트 발전기까지 제거 — 안 지우면 전력 시험이 오염된다
    G.clearEnemies();
    G.giveAll(99999);
    G.powerCheat(!realPower);
    return G.state();
  }

  // 전력 시험용 판: 전주를 5칸 격자로 깔면 5x5 공급구역이 빈틈없이 이어진다.
  // 기계는 격자선을 피한 자리(P0+1+5k)에만 놓는다 — 3x3 이 격자선을 안 밟는 유일한 위치.
  var P0 = 50, PN = 7;                       // 전주 x,y ∈ {50,55,...,80}
  function powerLab(fuelPerGen, gens) {
    for (var y = 0; y < PN; y++) {
      for (var x = 0; x < PN; x++) G.place('pole', P0 + x * 5, P0 + y * 5, 0);
    }
    var gl = [];
    for (var i = 0; i < (gens || 1); i++) {
      var s = slot(i);
      var gid = G.place('generator', s[0], s[1], 0);
      if (gid) { G.setFuel(gid, fuelPerGen === undefined ? 4000 * 5000 : fuelPerGen); gl.push(gid); }
    }
    return gl;
  }
  // i번째 3x3 빈 자리 — 전주 격자선(5의 배수)을 밟지 않는 좌표만 돌려준다
  function slot(i) {
    var k = i % (PN - 1), m = Math.floor(i / (PN - 1)) % (PN - 1);
    return [P0 + 1 + k * 5, P0 + 1 + m * 5];
  }

  function runAll() {
    var out = { version: null, gfx: null, checks: checks, errors: [], fatal: null, notes: [] };
    try {
      if (!window.__READY || !window.__GAME) {
        out.fatal = 'boot 실패: __READY=' + window.__READY + ' __GAME=' + (!!window.__GAME);
        emit(out); return;
      }
      G = window.__GAME;
      SP = G.spec();
      var ITEM_IDS_TEST = G.itemIds();
      var SPEC_GEN_KW = SP.genKw;
      out.version = G.version;
      out.gfx = G.gfx();
      out.spec = SP;

      // ================= 1. 부팅 =========================================
      var s0 = G.state();
      chk('boot.ready', !!window.__READY && s0.entityCount > 0,
        '엔티티 ' + s0.entityCount + '개 · 둥지 ' + s0.nests + '개 · 시각 ' + r2(s0.t) + 's');
      chk('boot.startKit', s0.counts.generator >= 1 && s0.counts.pole >= 2,
        '시작 키트 발전기 ' + (s0.counts.generator || 0) + ' 전주 ' + (s0.counts.pole || 0) +
        ' — 없으면 첫 기계를 돌릴 방법이 없다');

      // ================= 2. 벨트 처리량 ==================================
      // 오라클: SPEC 에서 계산한 15개/s (= 1.875 타일/s ÷ 0.25 간격 × 2레인).
      labSetup();
      var bx = 40, by = 40;
      var beltIds = [];
      for (var i = 0; i < 40; i++) {
        var id = G.place('belt', bx + i, by, 1);
        if (id) beltIds.push(id);
      }
      chk('belt.built', beltIds.length === 40, '벨트 ' + beltIds.length + '/40 칸');
      G.resetBeltStats();
      var accepted = 0, secs = 10, n = TICKS(secs);
      for (var t = 0; t < n; t++) {
        if (G.putOnBelt(beltIds[0], 'iron-plate')) accepted++;
        G.tickOnce();
      }
      var expThru = SP.beltPerSec * secs;
      chk('belt.throughput', near(accepted, expThru, 0.04, 2),
        '10초에 ' + accepted + '개 실림 (오라클 ' + expThru + '개 = ' + SP.beltPerSec + '/s) · ' +
        '레인 2개 × ' + (SP.beltLaneTilesPerSec / 0.25) + '/s');

      // 아이템이 실제로 앞으로 갔는가 — 실렸는데 안 움직이면 처리량만으론 안 잡힌다.
      // 선두는 secs × 1.875 = 18.75칸까지만 가야 한다. 앞뒤를 함께 봐서 속도를 양쪽에서 조인다.
      var frontTile = Math.floor(secs * SP.beltLaneTilesPerSec);     // 18
      var inside = G.ent(beltIds[frontTile - 3]).beltItems[0];       // 도달했어야 하는 칸
      var beyond = G.ent(beltIds[frontTile + 3]).beltItems[0];       // 아직 못 갔어야 하는 칸
      chk('belt.transport', inside > 0 && beyond === 0,
        secs + '초 × ' + SP.beltLaneTilesPerSec + ' 타일/s = ' + (secs * SP.beltLaneTilesPerSec) +
        '칸 진행 → ' + (frontTile - 3) + '칸째 ' + inside + '개(있어야) · ' +
        (frontTile + 3) + '칸째 ' + beyond + '개(없어야)');

      // 음성 대조군: 벨트 게이트를 닫으면 흐름이 멈춰야 한다.
      // 조건이 실제로 발생했음(닫혔음)을 함께 단언한다.
      var gateEnt = beltIds[5];
      // 게이트를 로직 없이 직접 닫을 수는 없으므로 제어기로 닫는다.
      // 벨트 게이트 노드는 논리 III 해금이라 연구를 먼저 켠다 — 안 켜면 노드가 조용히
      // 아무 일도 안 하고, 그게 "게이트가 안 닫힌다"로 보인다.
      G.research('logic-ctrl');
      var ctrlG = G.place('controller', bx + 2, by + 3, 0);
      var cOff = G.gAdd(ctrlG, 'const', 0, 0); G.gCfg(ctrlG, cOff, 'value', 0);
      var gOut = G.gAdd(ctrlG, 'gate', 200, 0); G.gCfg(ctrlG, gOut, 'ent', gateEnt);
      G.gLink(ctrlG, cOff, 0, gOut, 0);
      G.run(0.1);
      var gateClosed = G.ent(gateEnt).gate[0] === false;
      G.resetBeltStats();
      var acc2 = 0;
      for (var t2 = 0; t2 < TICKS(5); t2++) { if (G.putOnBelt(beltIds[0], 'iron-plate')) acc2++; G.tickOnce(); }
      var passedGate = G.ent(beltIds[6]).beltItems[0];
      chk('belt.gateStopsFlow', gateClosed && acc2 < expThru * 0.5 * 0.35,
        '게이트 닫힘=' + gateClosed + ' (조건 발생 확인) · 닫은 뒤 5초 투입 ' + acc2 +
        '개 (열려 있었다면 ' + (SP.beltPerSec * 5) + '개) · 게이트 너머 잔량 ' + passedGate);

      // ================= 3. 인서터 =======================================
      labSetup();
      var srcChest = G.place('chest', 40, 40, 0);
      var insId = G.place('inserter', 41, 40, 1);
      var dstChest = G.place('chest', 42, 40, 0);
      G.fillChest(srcChest, 'iron-plate', 500);
      G.run(0.2);
      var insPow = G.ent(insId).powerSat;
      var dur = 24;
      G.run(dur);
      var moved = (G.ent(dstChest).inv['iron-plate'] || 0);
      var expIns = SP.inserterPerSec * dur;
      chk('inserter.rate', insPow > 0.99 && near(moved, expIns, 0.06, 1),
        dur + '초에 ' + moved + '개 이송 (오라클 ' + r2(expIns) + '개 = ' + r2(SP.inserterPerSec) +
        '/s, 스윙 1.2s) · 전력 ' + Math.round(insPow * 100) + '%');

      // 인서터 불변식: 놓을 곳이 없으면 집지 않는다 (자원 점유 교착 방지)
      labSetup();
      var sc2 = G.place('chest', 40, 40, 0);
      var ins2 = G.place('inserter', 41, 40, 1);
      G.fillChest(sc2, 'iron-plate', 100);
      G.run(6);
      var st2 = G.ent(ins2);
      chk('inserter.noPickWithoutTarget', st2.held === null && (G.ent(sc2).inv['iron-plate'] === 100),
        '대상 없음 → 손에 쥔 것 ' + st2.held + ', 출처 재고 ' + G.ent(sc2).inv['iron-plate'] +
        '/100 (집었다면 재고가 줄고 영원히 들고 있었을 것) · 정체시간 ' + r2(st2.stallT) + 's');

      // ================= 4. 채광 + 물질수지 ==============================
      labSetup();
      // 철광맥을 찾는다
      var st3 = G.state();
      var found = G.findOre ? G.findOre('iron-ore') : null;
      void st3; void found;
      var minerPos = G.oreSpot('iron-ore');
      chk('world.oreExists', !!minerPos, '철광맥 위치 ' + JSON.stringify(minerPos));
      if (minerPos) {
        var mid = G.place('miner', minerPos.x, minerPos.y, 1);
        chk('miner.placed', !!mid, '채광기 id=' + mid);
        if (mid) {
          // 벨트로 받아 상자까지 보내는 라인을 붙인다 — 흐르는 중에도 수지가 맞아야 한다
          for (var mb = 0; mb < 8; mb++) G.place('belt', minerPos.x + 2 + mb, minerPos.y, 1);
          G.run(0.2);
          var mdur = 20;
          var cenA = G.materialCensus();
          G.run(mdur);
          var cenB = G.materialCensus();
          var minedN = cenB.mined - cenA.mined;
          var expMine = SP.minerPerSec * mdur;
          chk('miner.rate', near(minedN, expMine, 0.08, 1),
            mdur + '초에 ' + minedN + '개 채굴 (오라클 ' + expMine + '개 = ' + SP.minerPerSec + '/s)');
          // 시작 재고(giveAll)가 섞이지 않도록 증분으로 본다.
          // 절대량으로 재면 창고의 99999개가 좌변을 통째로 덮어 게이트가 무의미해진다.
          chk('mass.balance', (cenB.present - cenA.present) === minedN,
            '20초 동안 땅에서 뽑은 ' + minedN + '개 = 세계 존재량 증가 ' +
            (cenB.present - cenA.present) + '개 (벨트 위 재고 포함) — 어긋나면 복제 또는 소멸');
        }
      }

      // ================= 5. 제련 =========================================
      labSetup();
      var fc = G.place('chest', 39, 40, 0);
      var fi = G.place('inserter', 40, 40, 1);
      var fu = G.place('furnace', 41, 39, 1);
      G.fillChest(fc, 'iron-ore', 400);
      G.run(0.2);
      var fdur = 60;
      G.run(fdur);
      var fst = G.ent(fu);
      var plates = (fst.out['iron-plate'] || 0);
      // 인서터 공급률(0.833/s)이 제련율(0.3125/s)보다 빠르므로 제련이 병목이다
      var expSmelt = fdur / SP.furnaceTime;
      chk('furnace.rate', near(plates, expSmelt, 0.08, 1),
        fdur + '초에 철판 ' + plates + '개 (오라클 ' + r2(expSmelt) + '개 = ' + SP.furnaceTime + 's/개) · ' +
        '입력 버퍼 ' + JSON.stringify(fst.inv));

      // ================= 6. 전력 (여기서는 진짜 발전기·전주를 쓴다) ==========
      // 6a. 발전기 1대(900kW)에 조립기 10대(1550kW)를 물려 브라운아웃을 만든다.
      labSetup(424242, true);
      powerLab(4000 * 5000, 1);
      var asms = [];
      for (var a = 1; a <= 10; a++) {
        var sa = slot(a);
        var aid = G.place('assembler', sa[0], sa[1], 1);
        if (aid) { G.setRecipe(aid, 'gear'); G.fillChest(aid, 'iron-plate', 90000); asms.push(aid); }
      }
      chk('power.rigBuilt', asms.length === 10, '조립기 ' + asms.length + '/10 배치 (전주 격자를 안 밟는 자리)');
      G.run(0.2);
      var ps = G.state().power;
      var expSat = Math.min(1, ps.supply / ps.demand);
      // 집계 통계만 보면 "표시는 맞는데 기계는 안 느려지는" 고장을 통째로 놓친다
      // (돌연변이 시험에서 실제로 놓쳤다). 그래서 개별 기계에 내려간 값도 함께 본다.
      var machSat = G.ent(asms[0]).powerSat;
      chk('power.brownout',
        ps.demand > ps.supply && ps.sat < 0.999 && near(ps.sat, expSat, 0.001) && near(machSat, expSat, 0.001),
        '공급 ' + Math.round(ps.supply) + 'kW < 수요 ' + Math.round(ps.demand) + 'kW → 집계 만족도 ' +
        Math.round(ps.sat * 100) + '% · 개별 기계에 내려간 값 ' + Math.round(machSat * 100) +
        '% (= 공급/수요 ' + Math.round(expSat * 100) + '%)');

      // 6b. 만족도가 생산속도에 실제로 비례하는가 (표시만 하고 안 느려지면 가짜다)
      var probe = asms[0];
      G.clearOut(probe);
      G.run(16);
      var slowRate = (G.ent(probe).out['gear'] || 0) / 16;
      // 발전기를 넉넉히 추가 → 만족도 100%
      for (var gAdd = 12; gAdd < 15; gAdd++) {
        var sg = slot(gAdd);
        var gg = G.place('generator', sg[0], sg[1], 0);
        if (gg) G.setFuel(gg, 4000 * 5000);
      }
      G.run(0.2);
      var satFull = G.state().power.sat;
      G.clearOut(probe);
      G.run(16);
      var fastRate = (G.ent(probe).out['gear'] || 0) / 16;
      var ratio = fastRate > 0 ? slowRate / fastRate : 0;
      chk('power.satScalesSpeed', satFull > 0.999 && near(ratio, ps.sat, 0.10, 0.03),
        '부족할 때 ' + r2(slowRate) + '개/s vs 충분할 때 ' + r2(fastRate) + '개/s → 비 ' + r2(ratio) +
        ' (만족도 ' + r2(ps.sat) + ' 와 같아야 한다) · 보강 후 만족도 ' + Math.round(satFull * 100) + '%');

      // 6c. 에너지 수지 — 태운 연료(kJ) = 실제 공급한 전력(kW) × 시간
      labSetup(424242, true);
      powerLab(4000 * 200, 1);
      var gE = null;
      for (var b2 = 1; b2 <= 12; b2++) {
        var sb2 = slot(b2);
        var aid2 = G.place('assembler', sb2[0], sb2[1], 1);
        if (aid2) { G.setRecipe(aid2, 'gear'); G.fillChest(aid2, 'iron-plate', 90000); }
      }
      var s0g = slot(0);
      gE = G.entAtTile(s0g[0], s0g[1]);
      G.run(0.2);
      var fuel0 = G.ent(gE).fuel;
      var pw = G.state().power;
      var edur = 30;
      G.run(edur);
      var burned = fuel0 - G.ent(gE).fuel;
      var expBurn = Math.min(pw.demand, pw.supply) * edur;   // kW × s = kJ
      chk('power.energyBalance', near(burned, expBurn, 0.02, 50),
        edur + '초에 ' + Math.round(burned) + ' kJ 소모 (오라클 = 실공급 ' +
        Math.round(Math.min(pw.demand, pw.supply)) + 'kW × ' + edur + 's = ' + Math.round(expBurn) + ' kJ)');

      // 6d. 연료가 떨어지면 정말 멈추는가 (음성 대조군 — 재료는 있었음을 함께 단언)
      labSetup(424242, true);
      powerLab(0, 1);
      var sD = slot(1);
      var aD = G.place('assembler', sD[0], sD[1], 1);
      G.setRecipe(aD, 'gear'); G.fillChest(aD, 'iron-plate', 500);
      G.run(5);
      var stD = G.ent(aD);
      chk('power.noFuelStops',
        stD.net >= 0 && stD.powerSat === 0 && (stD.out['gear'] || 0) === 0 && stD.inv['iron-plate'] === 500,
        '연료 0인 발전기 → 전력망 연결됨(net=' + stD.net + ') · 만족도 ' + stD.powerSat +
        ' · 생산 ' + (stD.out['gear'] || 0) + '개 · 재료 그대로 ' + stD.inv['iron-plate'] +
        ' (조건: 재료도 망 연결도 있었는데 전기만 없었다)');

      // 6e. 오염 배출량 항등식.
      // 발전기는 매 틱 호출되는 함수 안에서 오염을 뿜는다 — dt 를 곱하지 않으면 초당
      // 60배가 나온다. 실제로 그 버그가 있었고, 다른 게이트 43개가 전부 통과했다
      // (오염에는 오라클이 하나도 없었기 때문). 그래서 정확한 항등식으로 못박는다.
      //   배출/s = 20 × 부하 × 0.02
      // 부하를 아는 상태로 만들려고 소비자는 "오염을 안 내는" 인서터만 쓴다.
      labSetup(424242, true);
      powerLab(4000 * 9000, 1);
      var sGen = slot(0);
      var genP = G.entAtTile(sGen[0], sGen[1]);
      var insN = 0;
      for (var ip = 0; ip < 30; ip++) { if (G.place('inserter', P0 + 1 + ip, P0 + 7, 1)) insN++; }
      G.run(0.3);
      var loadP = G.ent(genP).load;
      var pdur = 30;
      var poll0 = G.state().totalPollution;
      G.run(pdur);
      var dPoll = G.state().totalPollution - poll0;
      var expPoll = 20 * loadP * 0.02 * pdur;
      chk('pollution.generatorRate', insN === 30 && loadP > 0.2 && near(dPoll, expPoll, 0.03, 0.05),
        '인서터 ' + insN + '대(13kW×' + insN + '=' + (insN * 13) + 'kW) → 발전기 부하 ' + r2(loadP) +
        ' · ' + pdur + '초 배출 ' + r2(dPoll) + ' (오라클 20×부하×0.02×' + pdur + ' = ' + r2(expPoll) + ')');

      // ================= 7. 제어기 (핵심 차별점) ==========================
      labSetup();
      G.research('logic-mem'); G.research('logic-ctrl'); G.research('defense-ai');
      var chestL = G.place('chest', 38, 38, 0);
      var asmL = G.place('assembler', 42, 38, 1);
      G.setRecipe(asmL, 'gear'); G.fillChest(asmL, 'iron-plate', 100000);
      var ctrl = G.place('controller', 38, 42, 0);
      chk('logic.controllerPlaced', !!ctrl, '제어기 id=' + ctrl);

      // 재고 히스테리시스: <50 → SET, >200 → RESET, 래치 Q → 조립기 가동
      var nSense = G.gAdd(ctrl, 'chest'); G.gCfg(ctrl, nSense, 'ent', chestL); G.gCfg(ctrl, nSense, 'item', 'gear');
      var nLo = G.gAdd(ctrl, 'const'); G.gCfg(ctrl, nLo, 'value', 50);
      var nHi = G.gAdd(ctrl, 'const'); G.gCfg(ctrl, nHi, 'value', 200);
      var cLo = G.gAdd(ctrl, 'cmp'); G.gCfg(ctrl, cLo, 'op', '<');
      var cHi = G.gAdd(ctrl, 'cmp'); G.gCfg(ctrl, cHi, 'op', '>');
      var lat = G.gAdd(ctrl, 'latch');
      var en = G.gAdd(ctrl, 'enable'); G.gCfg(ctrl, en, 'ent', asmL);
      G.gLink(ctrl, nSense, 0, cLo, 0); G.gLink(ctrl, nLo, 0, cLo, 1);
      G.gLink(ctrl, nSense, 0, cHi, 0); G.gLink(ctrl, nHi, 0, cHi, 1);
      G.gLink(ctrl, cLo, 0, lat, 0); G.gLink(ctrl, cHi, 0, lat, 1);
      G.gLink(ctrl, lat, 0, en, 0);

      G.fillChest(chestL, 'gear', 10);           // 재고 부족 → 켜져야 한다
      G.run(0.2);
      var onState = G.ent(asmL);
      chk('logic.hysteresisOn', onState.enabled === true && onState.logicForced === true,
        '재고 10개(<50) → 조립기 가동=' + onState.enabled + ', 제어기 지배=' + onState.logicForced +
        ' · 래치 Q=' + G.gOut(ctrl, lat, 0));

      // 히스테리시스의 본질은 "같은 값인데 직전 상태에 따라 답이 다르다"는 것이다.
      // 중간대(50~200)를 **아래에서 올라오며** 지날 때 켜진 채로 남아야 한다 —
      // 여기가 래치와 단순 비교기가 갈리는 유일한 지점이다.
      // (처음엔 위에서 내려오는 경우만 봐서, 래치를 비교기로 바꿔도 게이트가 안 뒤집혔다.)
      G.fillChest(chestL, 'gear', 110);          // 재고 120 — 아래(10)에서 올라옴
      G.run(0.2);
      var midUp = G.ent(asmL).enabled;
      chk('logic.hysteresisHolds', midUp === true,
        '재고 10 → 120(중간대, 상승) → 가동 유지=' + midUp +
        ' · 단순 비교기(<50)였다면 여기서 꺼진다. 래치 Q=' + G.gOut(ctrl, lat, 0));

      G.fillChest(chestL, 'gear', 190);          // 재고 310 (>200) → 꺼져야 한다
      G.run(0.2);
      var offState = G.ent(asmL);
      chk('logic.hysteresisOff', offState.enabled === false,
        '재고 310개(>200) → 조립기 가동=' + offState.enabled + ' · 래치 Q=' + G.gOut(ctrl, lat, 0));

      G.fillChest(chestL, 'gear', -190);         // 재고 120 — 위(310)에서 내려옴
      G.run(0.2);
      var midDown = G.ent(asmL).enabled;
      chk('logic.hysteresisDownHolds', midDown === false,
        '재고 310 → 120(중간대, 하강) → 정지 유지=' + (midDown === false) +
        ' · 같은 120인데 위 검사와 답이 반대여야 진짜 히스테리시스다');

      // 되먹임 = 1틱 지연 레지스터인가 — 카운터를 자기 출력으로 물려 확인
      var cnt = G.gAdd(ctrl, 'counter'); G.gCfg(ctrl, cnt, 'max', 0);
      var tmr = G.gAdd(ctrl, 'timer'); G.gCfg(ctrl, tmr, 'period', 0.05);
      G.gLink(ctrl, tmr, 0, cnt, 0);
      var info = G.gInfo(ctrl);
      var c0 = G.gOut(ctrl, cnt, 0);
      G.run(3);
      var c1 = G.gOut(ctrl, cnt, 0);
      chk('logic.counterCounts', c1 - c0 >= 55 && c1 - c0 <= 62,
        '0.05초 주기 타이머로 3초 → ' + (c1 - c0) + '회 증가 (기대 60회, 60 UPS 이산화 오차 허용)');
      chk('logic.compiles', info && info.nodes >= 9 && info.order.length === info.nodes,
        '노드 ' + info.nodes + '개 · 배선 ' + info.links + '개 · 위상순 길이 ' + info.order.length +
        ' · 되먹임 간선 ' + info.cycles + '개');

      // 유령 지배 해제 — enable 노드를 지우면 플레이어 의사로 돌아와야 한다
      G.gRemove(ctrl, en);
      G.run(0.2);
      var released = G.ent(asmL);
      chk('logic.releasesControl', released.enabled === true && released.logicForced === false,
        'enable 노드 삭제 후 → 가동=' + released.enabled + ', 지배=' + released.logicForced +
        ' (꺼진 채로 남으면 유령 지배 버그)');

      // 대상이 철거되면 참조가 끊겨야 한다 (유령 참조가 남으면 다음 엔티티를 오작동시킨다)
      var en2 = G.gAdd(ctrl, 'enable'); G.gCfg(ctrl, en2, 'ent', asmL);
      G.run(0.1);
      G.remove(asmL);
      G.run(0.2);
      var errAfter = G.errors().length;
      chk('logic.refDropped', errAfter === 0,
        '지배 대상 철거 후 런타임 오류 ' + errAfter + '건 (참조가 안 끊기면 여기서 터진다)');

      // 0 나눗셈이 NaN 을 퍼뜨리지 않는가
      var dz = G.gAdd(ctrl, 'math'); G.gCfg(ctrl, dz, 'op', '/');
      var one = G.gAdd(ctrl, 'const'); G.gCfg(ctrl, one, 'value', 5);
      var zero = G.gAdd(ctrl, 'const'); G.gCfg(ctrl, zero, 'value', 0);
      G.gLink(ctrl, one, 0, dz, 0); G.gLink(ctrl, zero, 0, dz, 1);
      G.run(0.1);
      var dzv = G.gOut(ctrl, dz, 0);
      chk('logic.noNaN', dzv === 0 && isFinite(dzv), '5 ÷ 0 = ' + dzv + ' (NaN 이면 그래프 전체가 오염된다)');

      // 부하 차단 — 전력 만족도를 읽어 저우선 라인을 끄는 실제 자동화 시나리오.
      // 이 게임에서 제어기가 없으면 못 하는 일 중 가장 실용적인 것이다.
      labSetup(424242, true);
      powerLab(4000 * 9000, 1);
      G.research('logic-mem');
      var lowPrio = [];
      for (var lp = 1; lp <= 8; lp++) {
        var sl = slot(lp);
        var lid = G.place('assembler', sl[0], sl[1], 1);
        if (lid) { G.setRecipe(lid, 'gear'); G.fillChest(lid, 'iron-plate', 90000); lowPrio.push(lid); }
      }
      G.run(0.3);
      var satBefore = G.state().power.sat;
      var sCtl = slot(10);
      var ctrlS = G.place('controller', sCtl[0], sCtl[1], 0);

      // 주의 — 순진한 배선(만족도 >= 95 면 가동)은 **발진한다.**
      // 끄면 만족도가 회복되고, 회복되면 즉시 켜지고, 켜면 다시 떨어진다. 60 Hz 로.
      // (이 게이트를 처음 그렇게 짰다가 "0대 꺼짐"이 나와서 알았다.)
      // 실제 부하 차단은 두 가지를 함께 쓴다:
      //   ① SR 래치로 차단 상태를 기억하고
      //   ② 복구는 타이머로 늦춘다 (회복되자마자 되돌리지 않는다).
      var pw2 = G.gAdd(ctrlS, 'power');
      var thLo = G.gAdd(ctrlS, 'const'); G.gCfg(ctrlS, thLo, 'value', 95);
      var thHi = G.gAdd(ctrlS, 'const'); G.gCfg(ctrlS, thHi, 'value', 99);
      var cmpLo = G.gAdd(ctrlS, 'cmp'); G.gCfg(ctrlS, cmpLo, 'op', '<');    // 부족하다
      var cmpHi = G.gAdd(ctrlS, 'cmp'); G.gCfg(ctrlS, cmpHi, 'op', '>');    // 넉넉하다
      var tmrR = G.gAdd(ctrlS, 'timer'); G.gCfg(ctrlS, tmrR, 'period', 30); // 복구 재시도 주기
      var andR = G.gAdd(ctrlS, 'bool'); G.gCfg(ctrlS, andR, 'op', 'AND');
      var latS = G.gAdd(ctrlS, 'latch');                                     // Q=1 이면 차단 중
      var notS = G.gAdd(ctrlS, 'bool'); G.gCfg(ctrlS, notS, 'op', 'NOT A');
      G.gLink(ctrlS, pw2, 0, cmpLo, 0); G.gLink(ctrlS, thLo, 0, cmpLo, 1);
      G.gLink(ctrlS, pw2, 0, cmpHi, 0); G.gLink(ctrlS, thHi, 0, cmpHi, 1);
      G.gLink(ctrlS, cmpHi, 0, andR, 0); G.gLink(ctrlS, tmrR, 0, andR, 1);
      G.gLink(ctrlS, cmpLo, 0, latS, 0);      // 부족 → 차단 SET
      G.gLink(ctrlS, andR, 0, latS, 1);       // 넉넉 + 재시도 시각 → 차단 RESET
      G.gLink(ctrlS, latS, 0, notS, 0);
      for (var sh = 0; sh < 4; sh++) {
        var eo = G.gAdd(ctrlS, 'enable'); G.gCfg(ctrlS, eo, 'ent', lowPrio[sh]);
        G.gLink(ctrlS, notS, 0, eo, 0);
      }
      G.run(1.0);
      var satAfter = G.state().power.sat;
      var shedCount = 0;
      for (var sc = 0; sc < 4; sc++) if (G.ent(lowPrio[sc]).enabled === false) shedCount++;
      // 안정성도 함께 본다 — 3초 더 돌려도 상태가 그대로여야 발진이 아니다
      G.run(3.0);
      var shedStill = 0;
      for (var sc2 = 0; sc2 < 4; sc2++) if (G.ent(lowPrio[sc2]).enabled === false) shedStill++;
      chk('logic.loadShedding',
        satBefore < 0.95 && shedCount === 4 && shedStill === 4 && satAfter > 0.99,
        '차단 전 만족도 ' + Math.round(satBefore * 100) + '% → 래치+타이머로 저우선 4대 차단(' +
        shedCount + '대) → ' + Math.round(satAfter * 100) + '% · 3초 뒤에도 ' + shedStill +
        '대 유지(발진 아님) · 발전기를 더 안 짓고 정전을 막았다' +
        ' [전력노드=' + G.gOut(ctrlS, pw2, 0) + ' 래치Q=' + G.gOut(ctrlS, latS, 0) + ']');

      // ================= 8. 전투 =========================================
      labSetup();
      G.research('military');
      var tx0 = 70, ty0 = 70;
      var tur = G.place('turret', tx0, ty0, 1);
      G.setAmmo(tur, 200);
      var wallId = G.place('chest', tx0 + 30, ty0, 0);   // 적이 목표로 삼을 건물
      G.spawnEnemyAt(tx0 + 6, ty0, 0);                    // 사거리 18 안
      var e0 = G.state().enemies;
      var killT = 0, killed = false;
      for (var kt = 0; kt < TICKS(6); kt++) {
        G.tickOnce(); killT += 1 / 60;
        if (G.state().enemies === 0) { killed = true; break; }
      }
      var expKillT = 15 / SP.turretDps;    // 소형 15hp ÷ 50dps = 0.3s
      chk('combat.turretKills', killed && killT < expKillT + 0.5,
        '소형(15hp) 사살 ' + r2(killT) + 's (오라클 ' + r2(expKillT) + 's = 15hp ÷ ' + SP.turretDps +
        'dps) · 스폰 ' + e0 + '마리');

      // 음성 대조군: 탄약이 없으면 못 죽인다. 그리고 "적이 실제로 사거리 안에 있었음"을
      // 함께 단언한다 — 조건이 안 일어나서 통과한 대조군은 무의미하다.
      labSetup(); G.research('military');
      var tur2 = G.place('turret', tx0, ty0, 1);
      G.setAmmo(tur2, 0);
      G.place('chest', tx0 + 4, ty0, 0);
      G.spawnEnemyAt(tx0 + 6, ty0, 0);
      G.run(6);
      var stillAlive = G.state().enemies;
      var wasInRange = 6 <= SP.turretRange;
      chk('combat.noAmmoNoKill', stillAlive >= 1 && wasInRange,
        '탄약 0 → 6초 뒤 적 ' + stillAlive + '마리 생존 · 적이 사거리(' + SP.turretRange +
        ') 안 6타일에 실제로 있었음=' + wasInRange);

      // 적이 건물을 실제로 부수는가 (압박이 진짜인가)
      labSetup();
      var victim = G.place('chest', 80, 80, 0);
      var vhp0 = G.ent(victim).hp;
      G.spawnEnemyAt(82, 80, 0);
      G.run(10);
      var vEnt = G.ent(victim);
      chk('combat.enemyDamages', vEnt === null || vEnt.hp < vhp0,
        vEnt ? ('상자 체력 ' + vhp0 + ' → ' + Math.round(vEnt.hp)) : '상자가 파괴됨 (체력 ' + vhp0 + '에서 시작)');

      // 교착 검정 — 적을 건물 벽 뒤에 가두고 오래 돌려도 전부 굳지 않는가.
      // 이동 상태에 탈출구가 없으면 여기서 좌표가 얼어붙는다.
      labSetup();
      for (var wi = 0; wi < 12; wi++) { G.place('chest', 90, 74 + wi, 0); G.place('chest', 91, 74 + wi, 0); }
      G.place('chest', 86, 80, 0);
      var epos0 = [];
      for (var ei = 0; ei < 6; ei++) { G.spawnEnemyAt(96 + (ei % 2), 78 + ei, 0); }
      G.run(1);
      var snap0 = G.enemyPositions();
      G.run(45);
      var snap1 = G.enemyPositions();
      var movedAny = 0;
      for (var mi = 0; mi < Math.min(snap0.length, snap1.length); mi++) {
        if (Math.abs(snap0[mi][0] - snap1[mi][0]) + Math.abs(snap0[mi][1] - snap1[mi][1]) > 0.5) movedAny++;
      }
      var destroyed = 24 + 1 - (G.state().counts.chest || 0);
      chk('enemy.noDeadlock', destroyed > 0 || movedAny > 0,
        '45초 뒤 상자 ' + destroyed + '개 파괴 · 남은 적 중 ' + movedAny + '/' +
        Math.min(snap0.length, snap1.length) + '마리 이동 (둘 다 0이면 전부 굳은 것)');
      void epos0;

      // ================= 8b. 출고 전 리뷰가 찾아낸 결함들의 회귀 게이트 ========
      // 전부 적대적 코드 리뷰에서 실기 재현된 것이고, 고친 뒤 여기에 못박았다.

      // (1) 분배기: 네 방향 모두 점유 사각형 == 셀 좌표여야 한다.
      //     남/서향에서 어긋나 벨트 인계가 막히고 철거가 이웃 점유를 지웠다.
      labSetup();
      G.research('logistics');
      var spMismatch = [], spCellsOk = 0;
      for (var sd = 0; sd < 4; sd++) {
        var sx0 = 40 + sd * 6, sy0 = 40;
        var sid2 = G.place('splitter', sx0, sy0, sd);
        if (!sid2) { spMismatch.push('dir' + sd + ':배치실패'); continue; }
        var se = G.ent(sid2);
        var occSet = {}, cellSet = {};
        for (var oy = se.ty; oy < se.ty + se.h; oy++) {
          for (var ox = se.tx; ox < se.tx + se.w; ox++) {
            if (G.entAtTile(ox, oy) === sid2) occSet[ox + ',' + oy] = 1;
          }
        }
        var cl = G.cellCoords(sid2) || [];
        for (var cq = 0; cq < cl.length; cq++) cellSet[cl[cq][0] + ',' + cl[cq][1]] = 1;
        var ka = Object.keys(occSet).sort().join(' ');
        var kb = Object.keys(cellSet).sort().join(' ');
        if (ka === kb && cl.length === 2) spCellsOk++;
        else spMismatch.push('dir' + sd + ' occ[' + ka + '] != cells[' + kb + ']');
      }
      chk('splitter.cellsMatchOccupancy', spCellsOk === 4,
        '네 방향 중 점유==셀 인 것 ' + spCellsOk + '/4' +
        (spMismatch.length ? ' · 어긋남: ' + spMismatch.join(' | ') : ''));

      // (2) 분배기 게이트: 우선순위 출구가 닫히면 열린 쪽으로 넘어가야 한다.
      labSetup(); G.research('logistics'); G.research('logic-ctrl');
      var sIn = [];
      for (var q3 = 0; q3 < 4; q3++) sIn.push(G.place('belt', 46 + q3, 50, 1));
      var spl = G.place('splitter', 50, 50, 1);            // dir=1 → 세로 2칸 (50,50),(50,51)
      var outA = [], outB = [];
      for (var q4 = 0; q4 < 6; q4++) { outA.push(G.place('belt', 51 + q4, 50, 1)); outB.push(G.place('belt', 51 + q4, 51, 1)); }
      G.setSplitterPrio(spl, 0);
      var ctrlSp = G.place('controller', 46, 54, 0);
      var zeroN = G.gAdd(ctrlSp, 'const'); G.gCfg(ctrlSp, zeroN, 'value', 0);
      var gateN = G.gAdd(ctrlSp, 'gate'); G.gCfg(ctrlSp, gateN, 'ent', outA[0]);
      G.gLink(ctrlSp, zeroN, 0, gateN, 0);
      G.run(0.2);
      var closedOk = G.ent(outA[0]).gate[0] === false;
      for (var q5 = 0; q5 < TICKS(6); q5++) { G.putOnBelt(sIn[0], 'iron-plate'); G.tickOnce(); }
      var throughB = G.ent(outB[4]).beltItems[0];
      chk('splitter.gateFallsBackToOtherOutput', closedOk && throughB > 0,
        '우선 출구 닫힘=' + closedOk + ' (조건 발생 확인) · 6초 뒤 반대편 출구 5칸째 아이템 ' +
        throughB + '개 (0이면 분배기가 영구 정체한 것)');

      // (3) 인서터: peek 과 take 가 같은 아이템을 가리켜야 한다.
      //     정체된 벨트(레인이 꽉 찬 상태)에서 서로 다른 것을 골라, 못 놓는 것을 쥔 채 굳었다.
      //     배치: 벨트(40,60) → 인서터(40,59, 북향: 출처=남쪽 벨트, 대상=북쪽 용광로) → 용광로(40,57)
      labSetup();
      var mixBelt = G.place('belt', 40, 60, 1);
      var mixFur = G.place('furnace', 40, 57, 2);
      // 한 레인을 꽉 채운다: 철 → 석탄 → 철 → 철.
      // 그러면 선두(peek 의 옛 선택)는 철, 중앙 최근접(take 의 선택)은 석탄이 되어 둘이 갈린다.
      G.putOnBelt(mixBelt, 'iron-ore', 0, 0); G.run(0.14);
      G.putOnBelt(mixBelt, 'coal', 0, 0); G.run(0.14);
      G.putOnBelt(mixBelt, 'iron-ore', 0, 0); G.run(0.14);
      G.putOnBelt(mixBelt, 'iron-ore', 0, 0);
      var mixIns = G.place('inserter', 40, 59, 0);
      G.run(4);
      var mixState = G.ent(mixIns);
      var furCoal = G.ent(mixFur).inv['coal'] || 0;
      chk('inserter.peekMatchesTake', mixState.held !== 'coal' && furCoal === 0,
        '중앙에 석탄이 있는 혼합 벨트 앞 무필터 인서터 4초 → 손에 쥔 것 ' + mixState.held +
        ' · 용광로 석탄 ' + furCoal + '개 · 정체 ' + r2(mixState.stallT) +
        's (석탄을 쥐면 못 놓고 영원히 굳는다)');
      // 양성 대조군 — 필터를 걸면 같은 배치에서 다시 흐른다
      G.setFilter(mixIns, 'iron-ore');
      G.run(8);
      var mixAfter = G.ent(mixIns);
      var furAfter = G.ent(mixFur);
      var furIron = (furAfter ? (furAfter.inv['iron-ore'] || 0) : 0) +
                    (furAfter ? (furAfter.out['iron-plate'] || 0) : 0);
      chk('inserter.filterRecovers', furIron > 0,
        '필터를 철광석으로 걸면 8초 뒤 용광로가 받은 철광석(제련분 포함) ' + furIron +
        '개 (0이면 위 검사가 "그냥 아무것도 안 한다"를 통과시킨 것)' +
        ' [진단: 인서터 id=' + mixIns + ' 위치=' + (mixAfter ? mixAfter.tx + ',' + mixAfter.ty : '?') +
        ' dir=' + (mixAfter ? mixAfter.dir : '?') + ' 필터=' + (mixAfter ? mixAfter.filter : '?') +
        ' 전력=' + (mixAfter ? mixAfter.powerSat : '?') +
        ' 벨트잔량=' + JSON.stringify(G.ent(mixBelt) ? G.ent(mixBelt).beltItems : null) +
        ' 용광로 id=' + mixFur + ' 레시피=' + (furAfter ? furAfter.recipe : 'null') +
        ' 대상칸=' + G.entAtTile(40, 58) + ' 출처칸=' + G.entAtTile(40, 60) + ']');

      // (4) 불러오기: 자원이 0이어도, 광맥이 고갈돼도 전부 복원돼야 한다.
      labSetup();
      var poorIds = [];
      poorIds.push(G.place('chest', 44, 64, 0));
      for (var q6 = 0; q6 < 5; q6++) poorIds.push(G.place('belt', 46 + q6, 64, 1));
      poorIds.push(G.place('pole', 44, 66, 0));
      poorIds.push(G.place('assembler', 48, 66, 1));
      for (var q7 = 0; q7 < ITEM_IDS_TEST.length; q7++) G.setInv(ITEM_IDS_TEST[q7], 0);
      var beforePoor = G.state().entityCount;
      var rawPoor = G.saveRaw();
      G.reset(999);
      var loadPoor = G.load(rawPoor);
      var afterPoor = G.state().entityCount;
      chk('save.restoreWithEmptyInventory', loadPoor && afterPoor === beforePoor && beforePoor >= 8,
        '창고를 전부 0으로 비운 채 저장 → 엔티티 ' + beforePoor + '개 → 복원 ' + afterPoor +
        '개 (예전엔 canPlace 비용검사에 걸려 통째로 사라졌다)');

      // (5) 불러오기: 철거를 많이 해 id 가 앞선 저장본도 온전해야 한다.
      labSetup();
      var made = [];
      for (var q8 = 0; q8 < 20; q8++) made.push(G.place('chest', 40 + q8, 70, 0));
      for (var q9 = 0; q9 < 6; q9++) G.remove(made[q9]);       // 누적 철거 6건 → id 커서가 앞선다
      var beforeIds = G.state().entityCount;
      var rawId = G.saveRaw();
      G.reset(999);
      G.load(rawId);
      var afterIds = G.state().entityCount;
      var realCount = G.liveEntityCount();
      chk('save.noIdCollision', afterIds === beforeIds && realCount === beforeIds,
        '철거 6건 후 저장 ' + beforeIds + '개 → 복원 목록 ' + afterIds + '개 · 실제 살아있는 엔티티 ' +
        realCount + '개 (세 수가 같아야 한다 — 예전엔 20→4로 소실됐다)');

      // (6) 불러오기: 형식이 깨진 저장본은 현재 판을 건드리지 않아야 한다.
      labSetup();
      G.place('chest', 50, 70, 0); G.place('chest', 51, 70, 0);
      var beforeBad = G.state().entityCount;
      var badOk = G.load('{"v":"1.0.0","seed":1,"t":0,"inv":{},"tech":{}}');
      var afterBad = G.state().entityCount;
      chk('save.badSaveKeepsGame', badOk === false && afterBad === beforeBad && beforeBad >= 2,
        '필드가 빠진 저장본 → 반환 ' + badOk + ' · 진행 중이던 엔티티 ' + beforeBad + ' → ' + afterBad +
        ' (예전엔 검사 전에 판을 먼저 부숴 둘 다 잃었다)');

      // (7) 불러오기: 되먹임 레지스터(래치 Q)가 살아남아야 한다.
      labSetup(); G.research('logic-mem');
      var lc = G.place('chest', 54, 70, 0);
      var lctrl = G.place('controller', 56, 70, 0);
      var ln1 = G.gAdd(lctrl, 'const'); G.gCfg(lctrl, ln1, 'value', 1);
      var ln2 = G.gAdd(lctrl, 'const'); G.gCfg(lctrl, ln2, 'value', 0);
      var llat = G.gAdd(lctrl, 'latch');
      G.gLink(lctrl, ln1, 0, llat, 0); G.gLink(lctrl, ln2, 0, llat, 1);
      G.run(0.2);
      var qBefore = G.gOut(lctrl, llat, 0);
      G.gCfg(lctrl, ln1, 'value', 0);          // SET 을 내려도 래치는 유지되어야 한다
      G.run(0.2);
      var rawLat = G.saveRaw();
      G.reset(999); G.load(rawLat);
      var qAfter = G.gOut(lctrl, llat, 0);
      chk('save.keepsLatchState', qBefore === 1 && qAfter === 1,
        '저장 전 래치 Q=' + qBefore + ' → 불러오기 후 Q=' + qAfter +
        ' (0이 되면 불러오는 순간 모든 래치가 풀려 라인이 예상 밖으로 켜진다)');
      void lc;

      // (8) 망에서 떨어진 발전기는 연료를 태우지도 오염을 내지도 않아야 한다.
      labSetup(424242, true);
      powerLab(4000 * 9000, 1);
      var sG2 = slot(0);
      var genOff = G.entAtTile(sG2[0], sG2[1]);
      for (var q10 = 0; q10 < 12; q10++) G.place('inserter', P0 + 1 + q10, P0 + 7, 1);
      G.run(0.5);
      var loadOn = G.ent(genOff).load;
      // 전주를 전부 철거해 망을 끊는다
      var poleIds = G.entitiesOfType('pole');
      for (var q11 = 0; q11 < poleIds.length; q11++) G.remove(poleIds[q11]);
      G.run(0.2);
      var fuelA = G.ent(genOff).fuel, pollA = G.state().totalPollution;
      G.run(10);
      var fuelB = G.ent(genOff).fuel, pollB = G.state().totalPollution;
      chk('power.disconnectedGeneratorIdles',
        loadOn > 0.05 && G.ent(genOff).net < 0 && fuelA - fuelB === 0 && pollB - pollA === 0,
        '망 연결 시 부하 ' + r2(loadOn) + ' (조건 발생 확인) → 전주 ' + poleIds.length +
        '개 철거 후 net=' + G.ent(genOff).net + ' · 10초간 연료 소모 ' + Math.round(fuelA - fuelB) +
        ' kJ · 오염 증가 ' + r2(pollB - pollA) + ' (둘 다 0이어야)');

      // (9) 제어기로 발전기를 끄면 공급이 실제로 끊겨야 한다.
      labSetup(424242, true);
      powerLab(4000 * 9000, 1);
      var sG3 = slot(0);
      var genCtl = G.entAtTile(sG3[0], sG3[1]);
      var sA3 = slot(1);
      var asmCtl = G.place('assembler', sA3[0], sA3[1], 1);
      G.setRecipe(asmCtl, 'gear'); G.fillChest(asmCtl, 'iron-plate', 90000);
      G.run(0.3);
      var supOn = G.state().power.supply;
      var sC3 = slot(2);
      var ctlG2 = G.place('controller', sC3[0], sC3[1], 0);
      var offC = G.gAdd(ctlG2, 'const'); G.gCfg(ctlG2, offC, 'value', 0);
      var offE = G.gAdd(ctlG2, 'enable'); G.gCfg(ctlG2, offE, 'ent', genCtl);
      G.gLink(ctlG2, offC, 0, offE, 0);
      G.run(0.5);
      var supOff = G.state().power.supply;
      var fuelC = G.ent(genCtl).fuel;
      G.run(5);
      chk('power.controllerCanStopGenerator',
        supOn >= SPEC_GEN_KW && supOff === 0 && (fuelC - G.ent(genCtl).fuel) === 0,
        '끄기 전 공급 ' + Math.round(supOn) + 'kW → 제어기로 정지 후 ' + Math.round(supOff) +
        'kW · 이후 5초 연료 소모 ' + Math.round(fuelC - G.ent(genCtl).fuel) + ' kJ');

      // (10) 용광로는 지금 걸린 레시피의 입력만 받아야 한다.
      labSetup();
      var fur2 = G.place('furnace', 60, 40, 1);
      G.setRecipe(fur2, 'iron-plate');
      G.fillChest(fur2, 'iron-ore', 5);
      G.run(0.1);
      var acceptsCopper = G.canAcceptTest(fur2, 'copper-ore');
      var acceptsIron = G.canAcceptTest(fur2, 'iron-ore');
      chk('furnace.onlyCurrentRecipeInput',
        acceptsIron === true && acceptsCopper === false,
        '철판 제련 중인 용광로 → 철광석 받음=' + acceptsIron + ' · 구리광석 받음=' + acceptsCopper +
        ' (구리를 받으면 영원히 안 쓰이는 재료가 입력 버퍼를 막는다)');
      // 다 구워서 완전히 비면 레시피를 놓아야 다음에 구리로 갈아탈 수 있다 (막힘 방지)
      G.run(30); G.clearOut(fur2);
      G.run(0.2);
      var freed = G.ent(fur2).recipe;
      var nowCopper = G.canAcceptTest(fur2, 'copper-ore');
      chk('furnace.releasesRecipeWhenEmpty', freed === null && nowCopper === true,
        '입출력이 모두 빈 뒤 레시피=' + freed + ' · 구리광석 받음=' + nowCopper +
        ' (안 놓으면 철을 굽던 용광로가 영원히 구리를 거부한다)');

      // (11) 벌목한 나무는 오염 흡수에서 빠져야 한다.
      labSetup();
      var treeBefore = G.treeCount();
      G.clearTrees(20, 20, 30, 30);
      var treeAfter = G.treeCount();
      chk('world.clearedTreesStopAbsorbing',
        treeBefore.total > treeAfter.total && treeAfter.census === treeAfter.total,
        '벌목 전 나무 ' + treeBefore.total + '그루(인구조사 ' + treeBefore.census + ') → 후 ' +
        treeAfter.total + '그루(인구조사 ' + treeAfter.census + ') — 두 수가 같아야 한다');

      // (12) 적 근접 노드는 적이 없을 때 "가장 가까움(0)"을 내면 안 된다.
      labSetup(); G.research('defense-ai');
      var ctlE = G.place('controller', 64, 40, 0);
      var enN = G.gAdd(ctlE, 'enemy'); G.gCfg(ctlE, enN, 'radius', 30);
      G.run(0.2);
      var distNone = G.gOut(ctlE, enN, 1);
      G.spawnEnemyAt(66, 40, 0);
      G.run(0.2);
      var distNear = G.gOut(ctlE, enN, 1);
      chk('logic.enemyDistanceWhenNone', distNone >= 30 && distNear > 0 && distNear < 10,
        '적 0마리일 때 최근접거리 ' + distNone + ' (반경 30 이상이어야) · 2타일 옆에 적이 생기면 ' +
        distNear + ' (0을 내면 평상시에 방어 배선이 항상 켜진다)');

      // ================= 8b-2. 상자 → 보유 자재 회수 =======================
      // 이게 없으면 게임이 막다른 길이 된다: 공장이 만든 것은 전부 상자·기계 버퍼에
      // 쌓이는데 건물 비용과 손 조립은 보유 자재에서만 나간다. 예전엔 회수 경로가
      // "상자를 철거하는 것"뿐이라 시작 지급분을 다 쓰면 아무것도 못 지었다.
      labSetup();
      // 상자를 **먼저** 놓고 그 다음에 보유 자재를 비운다.
      // 반대로 하면 배치 비용 관련 돌연변이가 걸렸을 때 상자가 안 생기고,
      // 뒤이은 G.ent(null).inv 에서 드라이버가 죽어 이후 게이트가 통째로 안 돈다
      // (실제로 그래서 돌연변이 하나가 CAUGHT 대신 INVALID 로 분류됐다).
      var tkChest = G.place('chest', 44, 44, 0);
      chk('stock.rigBuilt', !!tkChest, '회수 시험용 상자 id=' + tkChest);
      for (var zi = 0; zi < ITEM_IDS_TEST.length; zi++) G.setInv(ITEM_IDS_TEST[zi], 0);
      G.fillChest(tkChest, 'iron-plate', 37);
      G.fillChest(tkChest, 'copper-plate', 5);
      var stockBefore = G.state().inventory['iron-plate'] || 0;
      var takeable = G.takeableCount(tkChest);
      var movedN = G.takeToStock(tkChest);
      var st = G.state();
      var tkEnt = G.ent(tkChest);
      chk('stock.takeFromChest',
        !!tkEnt && stockBefore === 0 && takeable === 42 && movedN === 42 &&
        (st.inventory['iron-plate'] || 0) === 37 && (st.inventory['copper-plate'] || 0) === 5 &&
        tkEnt.inv['iron-plate'] === undefined,
        '상자에 철판 37 + 구리판 5 · 가져올 수 있는 개수 ' + takeable + ' · 옮긴 개수 ' + movedN +
        ' → 보유 철판 ' + (st.inventory['iron-plate'] || 0) + ' 구리판 ' +
        (st.inventory['copper-plate'] || 0) + ' · 상자는 비었는가=' +
        (G.takeableCount(tkChest) === 0));

      // 복제 금지 — 세계 전체 개수는 그대로여야 한다 (옮기기지 만들기가 아니다)
      G.fillChest(tkChest, 'iron-plate', 11);
      var censusA = G.materialCensus(['iron-plate', 'copper-plate']);
      G.takeToStock(tkChest);
      var censusB = G.materialCensus(['iron-plate', 'copper-plate']);
      chk('stock.takeDoesNotDuplicate', censusA.present === censusB.present,
        '가져오기 전후 세계 총량 ' + censusA.present + ' → ' + censusB.present +
        ' (materialCensus 는 상자·기계·벨트·보유 자재를 모두 센다)');

      // 음성 대조군 — 빈 상자에서는 아무 일도 없어야 한다.
      // (조건이 실제로 발생했음: 위에서 이미 다 꺼내 0개다)
      var emptyBefore = G.state().inventory['iron-plate'] || 0;
      var emptyTakeable = G.takeableCount(tkChest);
      var emptyMoved = G.takeToStock(tkChest);
      chk('stock.emptyChestTakesNothing',
        emptyTakeable === 0 && emptyMoved === 0 &&
        (G.state().inventory['iron-plate'] || 0) === emptyBefore,
        '빈 상자(가져올 수 있는 개수 ' + emptyTakeable + ') → 옮긴 개수 ' + emptyMoved +
        ' · 보유 철판 ' + emptyBefore + ' 그대로');

      // 기계의 출력 버퍼도 회수 대상이다 (제련한 철판이 용광로에 갇히면 안 된다)
      G.giveAll(999);                     // 용광로를 놓을 자재는 다시 준다
      var tkFur = G.place('furnace', 46, 44, 1);
      chk('stock.furnaceRigBuilt', !!tkFur, '회수 시험용 용광로 id=' + tkFur);
      G.setRecipe(tkFur, 'iron-plate'); G.fillChest(tkFur, 'iron-ore', 6);
      G.run(12);
      var furOut = tkFur ? (G.ent(tkFur).out['iron-plate'] || 0) : 0;
      var beforeFur = G.state().inventory['iron-plate'] || 0;
      G.takeToStock(tkFur);
      chk('stock.takeFromMachineOutput',
        furOut >= 1 && (G.state().inventory['iron-plate'] || 0) === beforeFur + furOut,
        '용광로 출력 ' + furOut + '개 → 보유 철판 ' + beforeFur + ' → ' +
        (G.state().inventory['iron-plate'] || 0));

      // ================= 8b-3. 보유 자재 → 기계 (라인 초기 급유) ===========
      // 반대 방향이 없으면 라인을 손으로 채울 수 없다. 실제로 사용자가 여기서 막혔다:
      // 보유 구리판 126·톱니 37을 들고도 적색 연구팩 조립기가 비어서 안 돌았는데,
      // 그때 보유 자재가 세계로 나가는 경로는 건물 비용·손 조립·발전기 석탄 버튼
      // 셋뿐이라 그 조립기에 넣을 방법 자체가 없었다.
      labSetup();
      var puA = G.place('assembler', 44, 48, 0);
      chk('stock.putRigBuilt', !!puA, '급유 시험용 조립기 id=' + puA);
      G.setRecipe(puA, 'sci-red');
      for (var pi = 0; pi < ITEM_IDS_TEST.length; pi++) G.setInv(ITEM_IDS_TEST[pi], 0);
      G.setInv('copper-plate', 7);
      G.setInv('gear', 4);
      G.setInv('iron-plate', 9);          // 음성 대조군용 — 이 레시피가 안 쓰는 품목
      var puItems = G.puttableItems(puA);
      var puCensusA = G.materialCensus(['copper-plate', 'gear', 'iron-plate']);
      var puMoved = G.putFromStock(puA);
      var puEnt = G.ent(puA);
      var puSt = G.state();
      chk('stock.putIntoAssembler',
        puMoved === 11 &&
        puEnt.inv['copper-plate'] === 7 && puEnt.inv['gear'] === 4 &&
        (puSt.inventory['copper-plate'] || 0) === 0 && (puSt.inventory['gear'] || 0) === 0,
        '보유 구리판 7 + 톱니 4 → 넣은 개수 ' + puMoved + ' · 조립기 안 구리판 ' +
        (puEnt.inv['copper-plate'] || 0) + ' 톱니 ' + (puEnt.inv['gear'] || 0) +
        ' · 보유 잔량 구리판 ' + (puSt.inventory['copper-plate'] || 0) +
        ' 톱니 ' + (puSt.inventory['gear'] || 0));

      // 음성 대조군 — 레시피가 안 쓰는 철판은 들어가면 안 된다. 판정을 canAccept 로
      // 통일했으니 인서터가 거부하는 것은 손으로도 거부돼야 한다.
      // (조건이 실제로 발생했음: 보유 철판 9개를 들고 넣기를 눌렀다)
      chk('stock.putRejectsWrongItem',
        puItems.indexOf('iron-plate') < 0 &&
        puEnt.inv['iron-plate'] === undefined &&
        (puSt.inventory['iron-plate'] || 0) === 9,
        '적색 연구팩 = 구리판+톱니 이므로 철판은 대상이 아니다 → 넣을 수 있는 품목 [' +
        puItems.join(',') + '] · 조립기 안 철판 ' + (puEnt.inv['iron-plate'] || 0) +
        ' · 보유 철판 ' + (puSt.inventory['iron-plate'] || 0) + ' 그대로');

      // 복제 금지 — 넣기도 옮기기지 만들기가 아니다
      var puCensusB = G.materialCensus(['copper-plate', 'gear', 'iron-plate']);
      chk('stock.putDoesNotDuplicate', puCensusA.present === puCensusB.present,
        '넣기 전후 세계 총량 ' + puCensusA.present + ' → ' + puCensusB.present);

      // 넣은 뒤 실제로 돌아야 한다 — 사용자가 원한 결과는 버튼이 아니라 이것이다
      G.run(12);
      var puOut = G.ent(puA).out['sci-red'] || 0;
      chk('stock.putThenMachineRuns', puOut >= 1,
        '급유 후 12초 → 적색 연구팩 ' + puOut + '개 (5.0s ÷ 조립기 속도 0.75 = 6.67s/개)');

      // 버퍼 한도 — 999개를 들고 있어도 품목당 50까지만 들어가야 한다.
      // 한도가 없으면 버튼 한 번에 보유 자재가 기계 하나로 통째로 빨려 들어간다.
      G.setInv('copper-plate', 999); G.setInv('gear', 999);
      G.putFromStock(puA);
      var capEnt = G.ent(puA), capSt = G.state();
      chk('stock.putRespectsBufferCap',
        (capEnt.inv['copper-plate'] || 0) === 50 && (capEnt.inv['gear'] || 0) === 50 &&
        (capSt.inventory['copper-plate'] || 0) >= 949,
        '보유 999개로 넣기 → 조립기 안 구리판 ' + (capEnt.inv['copper-plate'] || 0) +
        ' 톱니 ' + (capEnt.inv['gear'] || 0) + ' (입력 버퍼 한도 50) · 보유 잔량 구리판 ' +
        (capSt.inventory['copper-plate'] || 0));

      // 음성 대조군 — 보유 자재가 비면 아무 일도 없어야 한다
      for (var pj = 0; pj < ITEM_IDS_TEST.length; pj++) G.setInv(ITEM_IDS_TEST[pj], 0);
      var emptyPut = G.putFromStock(puA);
      chk('stock.emptyStockPutsNothing',
        emptyPut === 0 && G.puttableItems(puA).length === 0,
        '보유 자재 0 → 넣은 개수 ' + emptyPut + ' · 넣을 수 있는 품목 ' +
        G.puttableItems(puA).length + '종');

      // 음성 대조군 — 상자는 넣기 대상이 아니다. 상자는 무엇이든 받으므로 대상에
      // 넣으면 버튼 한 번에 벨트·인서터까지 전 재고가 상자로 빨려 들어간다.
      G.giveAll(999);
      var puChest = G.place('chest', 48, 48, 0);
      G.setInv('iron-plate', 40);
      var chestPut = G.putFromStock(puChest);
      chk('stock.chestIsNotAPutTarget',
        !!puChest && chestPut === 0 && G.puttableItems(puChest).length === 0 &&
        (G.state().inventory['iron-plate'] || 0) === 40,
        '상자 id=' + puChest + ' 에 넣기 → 옮긴 개수 ' + chestPut +
        ' · 보유 철판 ' + (G.state().inventory['iron-plate'] || 0) + ' 그대로 (상자는 인서터로 채운다)');

      // ================= 8c. 튜토리얼 ====================================
      // 판정은 "세계가 실제로 그렇게 됐는가"로만 한다. '다음' 버튼으로 넘기는
      // 튜토리얼은 아무것도 가르치지 않으므로, 게이트도 그 원칙을 지키는지를 본다.
      labSetup();
      G.tutorialReset(true);
      var tut0 = G.tutorial();
      chk('tutorial.startsAtFirstStep',
        tut0.on === true && tut0.step === 0 && tut0.done === false && tut0.total >= 8 &&
        tut0.id === 'miner' && tut0.ids.indexOf('copper') >= 0,
        '단계 ' + tut0.total + '개 · 시작 = ' + tut0.id + ' · 구리 단계 포함=' +
        (tut0.ids.indexOf('copper') >= 0) + ' (구리 없이는 회로기판·연구팩을 못 만든다)');

      // 재료가 모자랄 때 "어디서 얻는지"까지 말해야 한다.
      // 부족하다고만 하면 플레이어가 그 자리에서 막힌다 (회로기판이 실제로 그랬다).
      var howCircuit = G.howToGet('circuit');
      var howPlate = G.howToGet('iron-plate');
      var howOre = G.howToGet('iron-ore');
      chk('help.tellsHowToGetMaterials',
        !!howCircuit && howCircuit.indexOf('손 조립') >= 0 && howCircuit.indexOf('구리선') >= 0 &&
        !!howPlate && howPlate.indexOf('용광로') >= 0 &&
        !!howOre && howOre.indexOf('채광기') >= 0,
        '회로기판 → "' + howCircuit + '" · 철판 → "' + howPlate + '" · 철광석 → "' + howOre + '"');

      // 음성 대조군 — 아무것도 안 하고 시간만 흘려도 넘어가면 안 된다.
      // (이게 통과하면 "저절로 진행되는 튜토리얼"이라 아래 검사가 무의미해진다.)
      G.run(20);
      var tutIdle = G.tutorial();
      chk('tutorial.doesNotAdvanceIdle', tutIdle.step === 0,
        '20초 동안 아무것도 안 했을 때 단계 ' + tutIdle.step + ' (0이어야) · 현재 ' + tutIdle.id);

      // 1단계: 전기가 통하는 채광기. 광맥 없이 놓으면 안 넘어가야 한다.
      var tSpot = G.oreSpotNear('iron-ore', 80, 80);
      var tMiner = tSpot ? G.place('miner', tSpot.x, tSpot.y, 1) : null;
      G.powerCheat(false);                       // 전력을 진짜로 본다
      G.run(0.4);
      var beforePole = G.tutorial().step;
      G.place('pole', tSpot.x + 2, tSpot.y + 2, 0);
      var gT = G.place('generator', tSpot.x + 4, tSpot.y + 3, 0);
      if (gT) G.setFuel(gT, 4000 * 500);
      G.run(0.6);
      var afterPole = G.tutorial().step;
      chk('tutorial.step1NeedsPower',
        !!tMiner && beforePole === 0 && afterPole === 1,
        '채광기만 놓았을 때 단계 ' + beforePole + ' (전기 없음 → 0) → 전주·발전기를 잇자 단계 ' +
        afterPole + ' (조건: 세계 상태가 바뀌어야만 넘어간다)');

      // 2단계: 채광기 출구에 벨트
      var mEnt = G.ent(tMiner);
      G.place('belt', mEnt.tx + mEnt.w, mEnt.ty, 1);
      G.run(0.4);
      chk('tutorial.step2Belt', G.tutorial().step === 2,
        '채광기 출구에 벨트를 잇자 단계 ' + G.tutorial().step);

      // 3단계: 실제로 제련이 일어나야 한다 (버퍼를 보는 게 아니라 누적 생산)
      var tFur = G.place('furnace', mEnt.tx, mEnt.ty + 4, 1);
      G.setRecipe(tFur, 'iron-plate'); G.fillChest(tFur, 'iron-ore', 20);
      G.place('pole', mEnt.tx + 2, mEnt.ty + 4, 0);
      G.run(0.4);
      var smeltedBefore = G.tutorial().prod.smelted;
      G.run(8);
      var tut3 = G.tutorial();
      chk('tutorial.step3CountsProduction',
        smeltedBefore === 0 && tut3.prod.smelted >= 1 && tut3.step === 3,
        '제련 전 누적 ' + smeltedBefore + '개 → 8초 뒤 ' + tut3.prod.smelted + '개 · 단계 ' +
        tut3.step + ' (버퍼가 아니라 누적으로 세야 인서터가 빼 가도 놓치지 않는다)');

      // 건너뛰기는 단계만 넘긴다 (튜토리얼 자체를 끄는 것과 다르다)
      var beforeSkip = G.tutorial().step;
      G.tutorialSkip();
      var afterSkip = G.tutorial();
      chk('tutorial.skipAdvancesOnlyOne',
        afterSkip.step === beforeSkip + 1 && afterSkip.on === true,
        '건너뛰기 ' + beforeSkip + ' → ' + afterSkip.step + ' · 튜토리얼 켜짐=' + afterSkip.on);

      // 마지막 단계까지 건너뛰면 완료로 끝나야 한다 (무한 진행 방지)
      for (var ts = 0; ts < 20; ts++) G.tutorialSkip();
      var tutEnd = G.tutorial();
      chk('tutorial.terminates', tutEnd.done === true && tutEnd.step === tutEnd.total,
        '끝까지 건너뛰면 완료=' + tutEnd.done + ' · 단계 ' + tutEnd.step + '/' + tutEnd.total +
        ' (총 수를 넘어 자라면 진행 표시가 24/9 처럼 나온다)');

      // 저장/복원에서 진행이 유지되어야 한다
      labSetup();
      G.tutorialReset(true);
      G.tutorialSkip(); G.tutorialSkip();
      var tutSaved = G.tutorial().step;
      var rawTut = G.saveRaw();
      G.reset(999);
      var tutAfterReset = G.tutorial().step;
      G.load(rawTut);
      var tutLoaded = G.tutorial().step;
      chk('tutorial.survivesSaveLoad',
        tutSaved === 2 && tutAfterReset === 0 && tutLoaded === 2,
        '저장 시 단계 ' + tutSaved + ' → 리셋 ' + tutAfterReset + ' → 복원 ' + tutLoaded);

      // ================= 8d. 심화 과정 (부하 차단 · 방어) ==================
      // 심화 단계는 "노드를 놓았는가"가 아니라 **신호가 목적지까지 흐르는가**로 판정한다.
      // 놓기만 한 노드는 아무것도 안 하므로, 그걸 통과시키면 게이트가 거짓말을 한다.
      labSetup();

      // 음성 대조군 — 기초를 안 끝냈으면 심화로 못 들어간다.
      // 심화 문서는 공장·제어기·연구소가 이미 있다고 가정하고 쓰여 있다.
      var advTooEarly = G.tutorialAdvance();
      chk('adv.requiresBasicDone',
        advTooEarly === false && G.tutorial().track === 'basic',
        '기초 0/10 에서 심화 시작 시도 → 거절=' + (advTooEarly === false) +
        ' · 트랙 ' + G.tutorial().track);

      // 기초를 끝내고 넘어간다
      for (var ab = 0; ab < 12; ab++) G.tutorialSkip();
      var basicDone = G.tutorial();
      var advOk = G.tutorialAdvance();
      var advT = G.tutorial();
      chk('adv.startsAtFirstStep',
        basicDone.done === true && advOk === true && advT.track === 'adv' &&
        advT.step === 0 && advT.total >= 9 && advT.id === 'green-sci' &&
        advT.done === false,
        '기초 완료(' + basicDone.step + '/' + basicDone.total + ') → 심화 ' +
        advT.step + '/' + advT.total + ' · 첫 단계 ' + advT.id +
        ' · 단계 목록 [' + advT.advIds.join(',') + ']');

      // 판정 없이 저절로 진행되면 안 된다 (기초와 같은 원칙)
      G.run(20);
      chk('adv.doesNotAdvanceIdle', G.tutorial().step === 0,
        '20초 동안 아무것도 안 했을 때 심화 단계 ' + G.tutorial().step + ' (0이어야)');

      // --- 배선 판정: 놓기만 한 노드는 통과하면 안 된다 --------------------
      // 심화 3단계 = 전력 만족도를 화면에 띄운다
      var ctrl = G.place('controller', 60, 60, 0);
      chk('adv.rigBuilt', !!ctrl, '심화 배선 시험용 제어기 id=' + ctrl);
      var nPow = G.gAdd(ctrl, 'power', 10, 10);
      var nDisp = G.gAdd(ctrl, 'display', 300, 10);
      var seeBefore = G.tutorialCheckById('see-power');          // 노드만 있고 배선은 없다
      G.gLink(ctrl, nPow, 0, nDisp, 0);
      var seeAfter = G.tutorialCheckById('see-power');
      chk('adv.seePowerNeedsWiring',
        seeBefore === false && seeAfter === true,
        '전력·표시 노드를 놓기만 했을 때 ' + seeBefore + ' → 선을 이은 뒤 ' + seeAfter +
        ' (놓기만 한 노드를 통과시키면 판정이 거짓말이 된다)');

      // 심화 4단계 = power → cmp → enable. 비교를 건너뛴 직결은 통과하면 안 된다.
      var asmT = G.place('assembler', 64, 60, 0);
      var nEn = G.gAdd(ctrl, 'enable', 600, 10);
      G.gCfg(ctrl, nEn, 'ent', asmT);
      G.gLink(ctrl, nPow, 0, nEn, 0);              // 비교 없이 바로 이었다
      var shedDirect = G.tutorialCheckById('naive-shed');
      var nCmp = G.gAdd(ctrl, 'cmp', 300, 120);
      G.gCfg(ctrl, nCmp, 'op', '<');
      G.gLink(ctrl, nPow, 0, nCmp, 0);
      G.gLink(ctrl, nCmp, 0, nEn, 0);              // 비교를 거쳐 다시 잇는다
      var shedViaCmp = G.tutorialCheckById('naive-shed');
      chk('adv.naiveShedNeedsComparator',
        shedDirect === false && shedViaCmp === true,
        '전력→가동 직결 ' + shedDirect + ' → 전력→비교→가동 ' + shedViaCmp +
        ' (문턱을 정하는 것이 부하 차단의 핵심이라 비교가 빠지면 배운 게 없다)');

      // 대상이 안 걸린 출력 노드는 장식이다 — 통과시키면 안 된다
      var nEn2 = G.gAdd(ctrl, 'enable', 600, 200);   // cfg.ent 를 일부러 안 준다
      var nCmp2 = G.gAdd(ctrl, 'cmp', 300, 200);
      var ctrl2 = G.place('controller', 68, 60, 0);
      var p2 = G.gAdd(ctrl2, 'power', 10, 10);
      var c2 = G.gAdd(ctrl2, 'cmp', 200, 10);
      var e2 = G.gAdd(ctrl2, 'enable', 400, 10);     // 대상 없음
      G.gLink(ctrl2, p2, 0, c2, 0); G.gLink(ctrl2, c2, 0, e2, 0);
      var noTargetOnly = (function () {
        // ctrl 쪽 배선을 잠시 끊어 ctrl2 만 남긴 상태로 물어본다
        G.remove(ctrl);
        var r = G.tutorialCheckById('naive-shed');
        return r;
      })();
      chk('adv.outputNeedsTarget',
        noTargetOnly === false,
        '대상이 안 걸린 [기계 가동/정지] 로만 이어진 배선 → ' + noTargetOnly +
        ' (false 여야 한다. 대상 없는 출력 노드는 공장을 못 움직인다)');
      G.remove(ctrl2);

      // 심화 5단계 = SR 래치. RESET 이 안 물리면 한 번 켜지고 영영 안 꺼진다.
      var ctrl3 = G.place('controller', 72, 60, 0);
      var asm3 = G.place('assembler', 76, 60, 0);
      var p3 = G.gAdd(ctrl3, 'power', 10, 10);
      var cSet = G.gAdd(ctrl3, 'cmp', 200, 10); G.gCfg(ctrl3, cSet, 'op', '>');
      var cRst = G.gAdd(ctrl3, 'cmp', 200, 140); G.gCfg(ctrl3, cRst, 'op', '<');
      var nLat = G.gAdd(ctrl3, 'latch', 400, 60);
      var eLat = G.gAdd(ctrl3, 'enable', 600, 60); G.gCfg(ctrl3, eLat, 'ent', asm3);
      G.gLink(ctrl3, p3, 0, cSet, 0);
      G.gLink(ctrl3, cSet, 0, nLat, 0);            // SET 만 물렸다
      G.gLink(ctrl3, nLat, 0, eLat, 0);
      var latchNoReset = G.tutorialCheckById('latch-shed');
      G.gLink(ctrl3, p3, 0, cRst, 0);
      G.gLink(ctrl3, cRst, 0, nLat, 1);            // RESET 을 마저 물린다
      var latchFull = G.tutorialCheckById('latch-shed');
      chk('adv.latchNeedsReset',
        latchNoReset === false && latchFull === true,
        'RESET 미연결 래치 ' + latchNoReset + ' → RESET 연결 후 ' + latchFull +
        ' (RESET 이 없으면 한 번 켜진 뒤 영영 안 꺼져서 부하 차단이 성립하지 않는다)');

      // 되먹임(순환) 배선이 있어도 판정이 멈추지 않아야 한다.
      // 이 게임의 그래프는 순환이 정상이므로, 도달성 탐색이 순환 방어를 안 하면
      // 게이트가 아니라 게임이 프리즈한다.
      // graphLink 는 **자기 자신으로의 링크를 거부한다**(35_logic.js). 처음에 자기
      // 되먹임으로 짰다가 링크가 아예 안 생겨서, 순환 방어를 빼는 돌연변이에도
      // 이 게이트가 통과해 버렸다(MISS). 순환이 실제로 생겼는지를 먼저 단언한다.
      var m1 = G.gAdd(ctrl3, 'math', 400, 260);
      var m2 = G.gAdd(ctrl3, 'math', 520, 260);
      G.gLink(ctrl3, nLat, 0, m1, 0);
      var lk1 = G.gLink(ctrl3, m1, 0, m2, 0);
      var lk2 = G.gLink(ctrl3, m2, 0, m1, 1);      // m1 → m2 → m1 = 진짜 순환
      var cycInfo = G.gInfo(ctrl3);
      chk('adv.cyclicRigIsActuallyCyclic',
        lk1 === true && lk2 === true && cycInfo.cycles >= 1,
        '순환 배선 생성 ' + lk1 + '/' + lk2 + ' · 컴파일러가 센 되먹임 간선 ' +
        cycInfo.cycles + '개 (0이면 이 시험은 아무것도 안 보고 있는 것이다)');
      G.reachSteps(true);                          // 걸음 수 계수기 리셋
      var cyclicOk = G.tutorialCheckById('latch-shed');
      var cycSteps = G.reachSteps(false);
      // **boolean 으로는 무한 루프를 못 본다** — 안 끝나면 이 줄에 오지도 못한다.
      // 실제로 순환 방어를 지운 돌연변이가 여기서 브라우저를 영구히 매달았고,
      // 게이트가 FAIL 을 내는 대신 45건짜리 돌연변이 실행이 통째로 멎었다.
      // 그래서 판정을 "끝났는가"가 아니라 **몇 걸음에 끝났는가**로 바꿨다.
      chk('adv.cyclicSearchIsBounded',
        cyclicOk === true && cycSteps > 0 && cycSteps < 400,
        '되먹임 그래프에서 도달성 탐색 걸음 수 ' + cycSteps +
        ' (노드 ' + cycInfo.nodes + '개짜리 그래프다. 순환 방어가 깨지면 상한 20000 까지 튄다)');

      // --- 방어 단계 ------------------------------------------------------
      labSetup();
      G.tutorial();                                 // 트랙 초기화 확인용
      for (var ab2 = 0; ab2 < 12; ab2++) G.tutorialSkip();
      G.tutorialAdvance();
      G.research('military');                       // 벽·터렛·탄창이 여기서 열린다
      G.research('logic-mem'); G.research('defense-ai');
      var wallN = 0;
      for (var wx = 0; wx < 11; wx++) { if (G.place('wall', 40 + wx, 70, 0)) wallN++; }
      var tur1 = G.place('turret', 40, 72, 0);
      var tur2 = G.place('turret', 43, 72, 0);
      var wallShort = G.tutorialCheckById('wall-turret');           // 벽 11개 — 하나 모자란다
      if (G.place('wall', 51, 70, 0)) wallN++;
      var wallOk = G.tutorialCheckById('wall-turret');
      chk('adv.wallTurretThreshold',
        wallShort === false && wallOk === true && !!tur1 && !!tur2,
        '벽 11개 ' + wallShort + ' → 12개 ' + wallOk + ' · 터렛 ' +
        ((tur1 ? 1 : 0) + (tur2 ? 1 : 0)) + '기 (문턱 바로 아래에서 실패해야 문턱이 산다)');

      // 탄약: 손으로 채운 것만으로는 통과하면 안 된다 — 자동 보급이 이 단계의 목적이다
      G.setInv('ammo', 40);
      G.putFromStock(tur1); G.putFromStock(tur2);
      var ammoByHand = G.tutorialCheckById('ammo-line');
      // 터렛은 2x2 다 — tur1 이 40~41, tur2 가 43~44 를 먹으므로 42 만 비어 있다.
      // 인서터를 서쪽(dir 3)으로 두면 앞칸이 41 = tur1 안이 된다.
      var insA = G.place('inserter', 42, 72, 3);
      var ammoAuto = G.tutorialCheckById('ammo-line');
      chk('adv.ammoNeedsInserter',
        ammoByHand === false && ammoAuto === true && !!insA,
        '손으로만 채웠을 때 ' + ammoByHand + ' → 터렛에 넣는 인서터를 놓은 뒤 ' + ammoAuto +
        ' (손 보급은 첫 습격만 막는다 — 자동화가 이 단계의 목적이다)');

      // 마지막 단계: 적 근접을 무언가에 잇는다
      var ctrl4 = G.place('controller', 60, 76, 0);
      var nEnemy = G.gAdd(ctrl4, 'enemy', 10, 10);
      var nLamp = G.gAdd(ctrl4, 'lamp', 300, 10);
      var defBefore = G.tutorialCheckById('defense-auto');
      G.gLink(ctrl4, nEnemy, 0, nLamp, 0);
      var defAfter = G.tutorialCheckById('defense-auto');
      chk('adv.defenseAutoNeedsWiring',
        defBefore === false && defAfter === true,
        '적 근접 노드만 놓았을 때 ' + defBefore + ' → 경보 램프에 이은 뒤 ' + defAfter);

      // 끝까지 건너뛰면 멈춘다 (기초와 같은 규율 — 넘어가면 12/8 처럼 표시된다)
      for (var ab3 = 0; ab3 < 20; ab3++) G.tutorialSkip();
      var advEnd = G.tutorial();
      chk('adv.terminates',
        // total 을 advIds.length 와 대조한다. 'total >= 9' 로만 두면 curSteps 가
        // 기초 배열(10단계)을 돌려주는 돌연변이도 통과해 버렸다(MISS).
        advEnd.done === true && advEnd.track === 'adv' &&
        advEnd.total === advEnd.advIds.length && advEnd.step === advEnd.total &&
        advEnd.advIds[0] === 'green-sci',
        '심화를 끝까지 건너뛰면 완료=' + advEnd.done + ' · 단계 ' + advEnd.step + '/' + advEnd.total);

      // 저장·복원이 트랙까지 기억해야 한다. 트랙을 잃으면 심화 3단계가
      // 기초 3단계로 읽혀 엉뚱한 단계가 통과된다.
      labSetup();
      for (var ab4 = 0; ab4 < 12; ab4++) G.tutorialSkip();
      G.tutorialAdvance(); G.tutorialSkip(); G.tutorialSkip();
      var advSavedT = G.tutorial();
      var rawAdv = G.save();
      G.reset(999);
      var advReset = G.tutorial();
      G.load(rawAdv);
      var advLoaded = G.tutorial();
      chk('adv.trackSurvivesSaveLoad',
        advSavedT.track === 'adv' && advSavedT.step === 2 &&
        advReset.track === 'basic' && advReset.step === 0 &&
        advLoaded.track === 'adv' && advLoaded.step === 2 && advLoaded.id === 'see-power',
        '저장 시 ' + advSavedT.track + ' ' + advSavedT.step + ' → 리셋 ' + advReset.track +
        ' ' + advReset.step + ' → 복원 ' + advLoaded.track + ' ' + advLoaded.step +
        ' (' + advLoaded.id + ')');

      // ================= 8e. 제어기 — 말이 안 되던 것들 =====================
      // 사용자가 "회로가 이상하게 작동한다"고 했고, 파 보니 셋이 나왔다.
      labSetup();

      // (1) [기계 가동/정지] 는 enabled 를 **실제로 보는** 건물만 고를 수 있어야 한다.
      //     예전엔 벽·전주·상자·벨트도 고를 수 있었는데 그것들은 enabled 를 읽지 않아
      //     배선해도 아무 일도 안 났다. 고를 수 있으면 고른다 — 그리고 왜 안 되는지 모른다.
      var enFilter = G.nodeTargets('enable');
      chk('ctrl.enableTargetsOnlyResponsive',
        !!enFilter && enFilter.indexOf('wall') < 0 && enFilter.indexOf('pole') < 0 &&
        enFilter.indexOf('belt') < 0 && enFilter.indexOf('chest') < 0 &&
        enFilter.indexOf('assembler') >= 0 && enFilter.indexOf('turret') >= 0,
        '[기계 가동/정지] 대상 목록 = [' + (enFilter || []).join(',') +
        '] (벽·전주·벨트·상자는 enabled 를 안 보므로 빠져야 한다)');

      // (2) 제어기 둘이 같은 축을 다투면 그 사실을 기록해야 한다.
      //     나중에 평가된 쪽이 조용히 이겨서, 한쪽 회로가 통째로 무시당한 것처럼 보였다.
      var kA = G.place('controller', 44, 44, 0);
      var kB = G.place('controller', 47, 44, 0);
      var kM = G.place('assembler', 50, 44, 0);
      var ca = G.gAdd(kA, 'const', 0, 0); G.gCfg(kA, ca, 'value', 1);
      var ea2 = G.gAdd(kA, 'enable', 200, 0); G.gCfg(kA, ea2, 'ent', kM);
      G.gLink(kA, ca, 0, ea2, 0);
      var cb = G.gAdd(kB, 'const', 0, 0); G.gCfg(kB, cb, 'value', 0);
      var eb2 = G.gAdd(kB, 'enable', 200, 0); G.gCfg(kB, eb2, 'ent', kM);
      G.gLink(kB, cb, 0, eb2, 0);
      G.run(1);
      var conf = G.ent(kM).logicConflict;
      chk('ctrl.conflictIsReported',
        !!conf && conf.indexOf('#' + kA) >= 0 && conf.indexOf('#' + kB) >= 0,
        '제어기 ' + kA + '(켜라) vs ' + kB + '(꺼라) → 기록 "' + conf + '"');

      // 음성 대조군 — 제어기가 하나면 충돌 경고가 뜨면 안 된다.
      // 늘 뜨는 경고는 경고가 아니라 배경이다.
      G.remove(kB);
      G.run(1);
      chk('ctrl.noConflictWhenSingle',
        !G.ent(kM).logicConflict && G.ent(kM).enabled === true,
        '제어기 하나만 남기자 → 충돌 기록 ' + (G.ent(kM).logicConflict || '없음') +
        ' · 기계 가동=' + G.ent(kM).enabled);

      // --- 감사에서 나온 것들 (독립 에이전트 4개가 찾고 헤드리스로 재현) ---

      // (3) **입력이 안 물린 출력 노드는 대상을 지배하지 않는다.**
      //     예전에는 노드를 놓고 대상만 고른 순간 기계가 즉시 멈췄다 — 배선을
      //     하나도 안 했는데도. "회로가 이상하게 작동한다" 의 가장 유력한 정체다.
      labSetup();
      var uC = G.place('controller', 44, 50, 0);
      var uM = G.place('assembler', 48, 50, 0);
      var uE = G.gAdd(uC, 'enable', 200, 0); G.gCfg(uC, uE, 'ent', uM);
      G.run(1);
      var unwired = G.ent(uM);
      chk('ctrl.unwiredOutputDoesNotSeize',
        unwired.enabled === true && unwired.logicForced === false,
        '배선 없는 [기계 가동/정지](대상만 지정) → 기계 가동=' + unwired.enabled +
        ' · 지배중=' + unwired.logicForced + ' (지배하면 배선도 안 했는데 멈춘다)');

      // 음성 대조군 — 배선을 하면 그때는 지배해야 한다. 안 하면 위 검사가
      // "출력 노드가 아예 안 먹는다" 를 통과시킨 것이다.
      var uK = G.gAdd(uC, 'const', 0, 0); G.gCfg(uC, uK, 'value', 0);
      G.gLink(uC, uK, 0, uE, 0);
      G.run(1);
      var wired = G.ent(uM);
      chk('ctrl.wiredOutputDoesSeize',
        wired.enabled === false && wired.logicForced === true,
        '상수 0 을 물린 뒤 → 기계 가동=' + wired.enabled + ' · 지배중=' + wired.logicForced);

      // (4) 램프·수치표시의 기본 이름이 같으면 HUD 가 중복을 지워 두 번째가 사라진다.
      labSetup();
      var dC = G.place('controller', 44, 54, 0);
      var d1 = G.gAdd(dC, 'display', 0, 0);
      var d2 = G.gAdd(dC, 'display', 0, 200);
      var dk = G.gAdd(dC, 'const', 300, 100); G.gCfg(dC, dk, 'value', 7);
      G.gLink(dC, dk, 0, d1, 0); G.gLink(dC, dk, 0, d2, 0);
      G.run(1);
      var disp = G.state().displays;
      var names = disp.map(function (x) { return x.label; });
      chk('ctrl.displaysGetDistinctNames',
        disp.length === 2 && names[0] !== names[1],
        '이름을 안 적은 [수치 표시] 2개 → 화면 항목 ' + disp.length + '개 · 이름 [' +
        names.join(', ') + '] (같으면 HUD 가 중복을 지워 하나만 남는다)');

      // (5) 한 번도 평가되지 않은 그래프에서도 값을 읽을 수 있어야 한다.
      //     g.inLinks 는 graphCompile 이 만드는데, 편집기의 해석 줄은 그 전에도
      //     읽는다 — 방어가 없으면 TypeError 로 편집기가 영구히 얼어붙는다.
      labSetup();
      var zC = G.place('controller', 44, 58, 0);
      G.gAdd(zC, 'enable', 0, 0);
      var readOk = G.readInProbe(zC, 1, 0);
      chk('ctrl.readBeforeCompileIsSafe',
        readOk === 0,
        '컴파일 전 그래프에서 입력 읽기 → ' + readOk +
        ' (예외가 나면 편집기의 실시간 갱신이 통째로 멈춘다)');

      // (6) **같은 좌표·같은 배선이면 만든 순서와 무관하게 같게 돌아야 한다.**
      //     예전에는 DFS 진입점이 노드 생성 순서라, 위치가 똑같은 두 회로가 다른
      //     배선을 되먹임으로 잡고 값까지 달라졌다. 화면에는 생성 순서가 안 나오므로
      //     플레이어가 원인을 짚을 방법이 없었다.
      labSetup();
      function buildCycle(cx, cy, order) {
        var c = G.place('controller', cx, cy, 0);
        var pos = { A: [40, 40], B: [300, 40], C: [170, 240] };
        var id = {};
        for (var i = 0; i < order.length; i++) {
          var nm = order[i];
          id[nm] = G.gAdd(c, 'math', pos[nm][0], pos[nm][1]);
        }
        // 순환: A → B → C → A  (배선은 항상 같은 순서로 건다)
        G.gLink(c, id.A, 0, id.B, 0);
        G.gLink(c, id.B, 0, id.C, 0);
        G.gLink(c, id.C, 0, id.A, 1);
        return { ctrl: c, id: id, info: G.gInfo(c) };
      }
      var fwd = buildCycle(44, 62, ['A', 'B', 'C']);
      var rev = buildCycle(48, 62, ['C', 'B', 'A']);   // **역순으로 만든다**
      // 좌표는 같으므로 평가 순서를 좌표로 사상해 비교한다 (nid 는 당연히 다르다)
      function orderAsPos(r) {
        var inv = {};
        for (var k in r.id) inv[r.id[k]] = k;
        return r.info.order.map(function (nid) { return inv[nid] || '?'; }).join('>');
      }
      var oFwd = orderAsPos(fwd), oRev = orderAsPos(rev);
      chk('ctrl.orderIndependentOfCreation',
        oFwd === oRev && fwd.info.cycles === rev.info.cycles,
        '같은 좌표·같은 배선을 정순/역순으로 만듦 → 평가순서 ' + oFwd + ' vs ' + oRev +
        ' · 되먹임 ' + fwd.info.cycles + ' vs ' + rev.info.cycles +
        ' (달라지면 화면상 같은 회로가 다르게 돈다)');

      // 음성 대조군 — 좌표를 실제로 바꾸면 순서가 바뀌어야 한다.
      // 늘 같은 답이면 이 검사는 아무것도 안 보고 있는 것이다.
      var moved = buildCycle(52, 62, ['A', 'B', 'C']);
      G.gMove(moved.ctrl, moved.id.C, 10, 10);        // C 를 맨 왼쪽 위로 옮긴다
      var oMoved = orderAsPos({ ctrl: moved.ctrl, id: moved.id, info: G.gInfo(moved.ctrl) });
      chk('ctrl.orderFollowsLayout', oMoved !== oFwd,
        'C 노드를 좌상단으로 옮기자 평가순서 ' + oFwd + ' → ' + oMoved +
        ' (안 바뀌면 좌표를 안 보고 있다는 뜻)');

      // (7) **[전력 만족도] 의 다섯 출구가 전부 자기 전력망 기준이어야 한다.**
      //     예전에는 만족%만 자기 망이고 공급kW/수요kW 는 전 세계 합계였다 —
      //     발전소가 둘이면 제어기가 지도 반대편 숫자로 판단했다.
      labSetup(undefined, true);                 // 전력을 진짜로 쓴다
      // 망 A: 전주 + 발전기 + 조립기 1대(155kW).  망 B: 멀리 떨어진 전주 + 발전기.
      G.place('pole', 40, 40, 0);
      var pgA = G.place('generator', 41, 41, 0);
      if (pgA) G.setFuel(pgA, 4000 * 100000);
      var pAsm = G.place('assembler', 38, 38, 0);
      if (pAsm) { G.setRecipe(pAsm, 'gear'); G.fillChest(pAsm, 'iron-plate', 50); }
      G.place('pole', 100, 100, 0);
      var pgB = G.place('generator', 101, 101, 0);
      if (pgB) G.setFuel(pgB, 4000 * 100000);
      var pCtl = G.place('controller', 42, 38, 0);
      G.run(2);
      var pN = G.gAdd(pCtl, 'power', 0, 0);
      G.run(1);
      var st2 = G.state();
      var pSup = G.gOut(pCtl, pN, 1), pDem = G.gOut(pCtl, pN, 2);
      var pHead = G.gOut(pCtl, pN, 3), pConn = G.gOut(pCtl, pN, 4);
      chk('ctrl.powerOutputsAreNetLocal',
        st2.power.supply >= 1800 && pSup === 900 && pConn === 1 &&
        pHead === pSup - pDem,
        '발전기 2대(전 세계 공급 ' + Math.round(st2.power.supply) + 'kW)인데 제어기 망의 ' +
        '공급kW=' + pSup + ' 수요kW=' + pDem + ' 여유kW=' + pHead + ' 망연결=' + pConn +
        ' (전역 합계면 1800 이 나온다)');

      // 음성 대조군 — 망 밖 제어기는 '망연결 0' 으로 구별돼야 한다.
      // 예전에는 만족% 0 만 나와서 '전기 없음' 과 '망 밖' 을 구별할 수 없었다.
      var offCtl = G.place('controller', 20, 20, 0);
      G.run(2);
      var offN = G.gAdd(offCtl, 'power', 0, 0);
      G.run(1);
      chk('ctrl.powerReportsDisconnection',
        G.gOut(offCtl, offN, 4) === 0 && G.ent(offCtl).net < 0,
        '전주 없는 곳의 제어기 → 망연결=' + G.gOut(offCtl, offN, 4) + ' · net=' +
        G.ent(offCtl).net + ' (0 이어야 "전기 없음" 과 구별된다)');

      // (8) **1틱 펄스는 값 표본으로 못 잡는다 — 발화 횟수로 남겨야 한다.**
      //     타이머는 발화한 틱에만 1이고 다음 틱(16.7ms)에 0이다. 편집기 표본은
      //     140ms 라 주기 5초면 잡을 확률이 0.33% 다. 그래서 값이 아니라 누적
      //     상승 횟수를 세어 두고, 편집기가 그 숫자로 LED 를 켠다.
      labSetup();
      var puC = G.place('controller', 44, 66, 0);
      var puT = G.gAdd(puC, 'timer', 0, 0); G.gCfg(puC, puT, 'period', 1);
      G.run(1);
      var f0 = G.gFires(puC, puT, 0);
      G.run(5);                                   // 5초 = 주기 5회
      var f1 = G.gFires(puC, puT, 0);
      var vNow = G.gOut(puC, puT, 0);
      chk('ctrl.pulseCountedNotSampled',
        f1 - f0 >= 4 && f1 - f0 <= 6,
        '주기 1초 타이머를 5초 구동 → 누적 발화 ' + f0 + ' → ' + f1 +
        ' (5회 안팎이어야) · 그 순간 값은 ' + vNow +
        ' (값만 보면 거의 늘 0 이라 안 도는 것처럼 보인다)');

      // 음성 대조군 — 안 도는 노드는 발화가 0 이어야 한다.
      // 아무거나 세는 계수기라면 이것도 늘어난다.
      var puK = G.gAdd(puC, 'const', 0, 200); G.gCfg(puC, puK, 'value', 0);
      G.run(3);
      chk('ctrl.idleNodeNeverFires', G.gFires(puC, puK, 0) === 0,
        '값 0 인 상수 노드 3초 → 누적 발화 ' + G.gFires(puC, puK, 0) + ' (0이어야)');

      // (9) **정지는 정지다** — 꺼진 채광기가 버퍼를 벨트로 계속 밀어내면 안 된다.
      labSetup();
      var mSpot = G.oreSpot('iron-ore');
      var mMin = mSpot ? G.place('miner', mSpot.x, mSpot.y, 1) : null;
      chk('ctrl.minerRigBuilt', !!mMin, '채광기 배치 id=' + mMin + ' @' +
        (mSpot ? mSpot.x + ',' + mSpot.y : '?'));
      // **벨트를 나중에 놓는다.** 벨트가 처음부터 있으면 캔 것이 곧바로 흘러가서
      // 출력 버퍼가 비어 버리고, 그러면 '정지한 채광기가 버퍼를 밀어내는가' 를
      // 시험할 재료 자체가 없다(그래서 돌연변이가 MISS 로 빠져나갔다).
      G.run(20);                                  // 벨트 없이 버퍼를 가득 채운다
      var bufFilled = mMin ? G.ent(mMin).out : {};
      var bufTotal = 0; for (var bk in bufFilled) bufTotal += bufFilled[bk];
      chk('ctrl.minerBufferFilled', bufTotal > 0,
        '벨트 없이 20초 → 채광기 출력 버퍼 ' + bufTotal + '개 (0이면 시험 재료가 없다)');
      var mBelt = null;
      if (mMin) {
        var me = G.ent(mMin);
        mBelt = G.place('belt', me.tx + me.w, me.ty, 1);
      }
      // 오라클은 **벨트 위 아이템 수**다. beltDelivered 는 벨트→벨트 인계만 세므로
      // 한 칸짜리 벨트에서는 영원히 0 이고, 그러면 이 시험이 아무것도 안 본다.
      function beltCount() {
        var b = mBelt ? G.ent(mBelt) : null;
        if (!b || !b.beltItems) return -1;
        var t = 0; for (var i = 0; i < b.beltItems.length; i++) t += b.beltItems[i];
        return t;
      }
      G.run(6);                                   // 벨트로 내보낸다
      var onCount = beltCount();
      chk('ctrl.minerFeedsBeltWhenOn', onCount > 0,
        '가동 중 벨트 위 아이템 ' + onCount + '개 (0이면 이 시험이 조건을 못 만든 것)');
      // 이제 정지시킨다. 벨트를 비워 두고 다시 재야 '계속 밀어내는가' 를 본다.
      G.setEnabled(mMin, false);
      G.beltClear(mBelt);
      G.run(6);
      var offCount = beltCount();
      chk('ctrl.stoppedMinerStopsFeeding', offCount === 0,
        '정지시키고 벨트를 비운 뒤 6초 → 벨트 위 아이템 ' + offCount +
        '개 (0이 아니면 정지가 정지가 아니다)');

      // (10) 참/거짓 문턱이 0.5 라는 것을 코드가 스스로 말해야 한다.
      //      주석과 실제가 어긋나 있었다(주석은 '0 초과').
      labSetup();
      var thC = G.place('controller', 44, 70, 0);
      var thK = G.gAdd(thC, 'const', 0, 0);
      var thL = G.gAdd(thC, 'lamp', 300, 0); G.gCfg(thC, thL, 'label', '문턱시험');
      G.gLink(thC, thK, 0, thL, 0);
      G.gCfg(thC, thK, 'value', 0.4); G.run(1);
      var at04 = G.state().alarms.indexOf('문턱시험') >= 0;
      G.gCfg(thC, thK, 'value', 0.5); G.run(1);
      var at05 = G.state().alarms.indexOf('문턱시험') >= 0;
      chk('ctrl.truthThresholdIsHalf', at04 === false && at05 === true,
        '0.4 → 참=' + at04 + ' · 0.5 → 참=' + at05 + ' (문턱은 0.5 이상이다)');

      // ================= 9. 결정론 =======================================
      function scenarioHash(seed) {
        G.reset(seed); G.giveAll(99999); G.clearEnemies(); G.powerCheat(true);
        var sp = G.oreSpot('iron-ore');
        if (sp) G.place('miner', sp.x, sp.y, 1);
        var c = G.place('chest', 44, 44, 0);
        G.fillChest(c, 'coal', 50);
        for (var z = 0; z < 12; z++) G.place('belt', 46 + z, 44, 1);
        G.run(20);
        return G.stateHash();
      }
      var h1 = scenarioHash(777), h2 = scenarioHash(777);
      chk('determinism.repeatable', h1 === h2,
        '같은 시드 2회 상태해시 ' + h1 + ' vs ' + h2 + ' (같아야 한다)');
      var h3 = scenarioHash(778);
      chk('determinism.seedMatters', h1 !== h3,
        '다른 시드 해시 ' + h3 + ' ≠ ' + h1 +
        ' (같으면 해시가 아무것도 안 보고 있다는 뜻 — 위 검사가 무의미해진다)');

      // ================= 10. 저장/불러오기 ================================
      labSetup();
      G.research('logic-mem');
      var svChest = G.place('chest', 40, 44, 0);
      G.fillChest(svChest, 'iron-plate', 123);
      var svCtrl = G.place('controller', 44, 44, 0);
      var svN = G.gAdd(svCtrl, 'chest'); G.gCfg(svCtrl, svN, 'ent', svChest);
      var svL = G.gAdd(svCtrl, 'latch');
      G.gLink(svCtrl, svN, 0, svL, 0);
      var svBelts = [];
      for (var sb = 0; sb < 10; sb++) { var sbid = G.place('belt', 46 + sb, 46, 1); if (sbid) svBelts.push(sbid); }
      for (var sf = 0; sf < 8; sf++) { G.putOnBelt(svBelts[0], 'coal'); G.tickOnce(); }
      G.run(3);
      var beforeSave = G.state();
      var raw = G.saveRaw();
      var savedOk = !!raw && raw.length > 100;
      G.reset(999);                               // 완전히 다른 판으로 덮어쓴다
      var afterReset = G.state();
      var loadOk = G.load(raw);
      var afterLoad = G.state();
      var gi = G.gInfo(svCtrl);
      chk('save.roundtrip',
        savedOk && loadOk && afterLoad.entityCount === beforeSave.entityCount &&
        afterReset.entityCount !== beforeSave.entityCount &&
        Math.abs(afterLoad.t - beforeSave.t) < 0.01,
        '저장 ' + (raw ? raw.length : 0) + 'B · 저장전 엔티티 ' + beforeSave.entityCount +
        ' → 리셋 ' + afterReset.entityCount + ' → 복원 ' + afterLoad.entityCount +
        ' · 시각 ' + r2(beforeSave.t) + ' → ' + r2(afterLoad.t));
      chk('save.keepsGraph', gi && gi.nodes === 2 && gi.links === 1,
        '복원된 제어기 그래프: 노드 ' + (gi ? gi.nodes : '?') + '개 · 배선 ' + (gi ? gi.links : '?') + '개 (2/1 이어야)');

      // ================= 11. 렌더 ========================================
      // 빈 벌판이 아니라 실제 장면을 그려 놓고 잰다 — 지형만 있으면 색이 10종 남짓이라
      // 임계값이 "무엇을 보증하는가"가 흐려진다.
      labSetup();
      var rx = world0.x, ry = world0.y;
      G.clearTrees(rx - 6, ry - 6, 14, 14);
      var rBelts = [];
      for (var rb = 0; rb < 8; rb++) { var rid2 = G.place('belt', rx - 4 + rb, ry, 1); if (rid2) rBelts.push(rid2); }
      for (var rf = 0; rf < 40; rf++) { if (rBelts.length) G.putOnBelt(rBelts[0], rf % 2 ? 'iron-plate' : 'copper-plate'); G.tickOnce(); }
      G.place('assembler', rx - 4, ry + 2, 1);
      G.place('chest', rx + 4, ry + 2, 0);
      G.place('pole', rx - 5, ry + 2, 0);
      G.spawnEnemyAt(rx + 2, ry - 3, 1);
      G.center(rx, ry);
      G.setZoom(1);
      G.render();
      var pr = window.__PIXEL_PROBE(96, 96);
      chk('render.notBlank', pr && pr.uniqueRGB > 40,
        '벨트·아이템·조립기·적이 있는 장면의 중앙 96x96 색 ' + (pr ? pr.uniqueRGB : '?') + '종');
      // 음성 대조군 — 아무것도 안 그리면 검출기가 실제로 떨어져야 한다
      G.renderBlank();
      var prB = window.__PIXEL_PROBE(96, 96);
      chk('render.blankDetectorWorks', prB && prB.uniqueRGB <= 4,
        '배경만 칠했을 때 색 ' + (prB ? prB.uniqueRGB : '?') + '종 (실제 렌더는 ' +
        (pr ? pr.uniqueRGB : '?') + '종) — 4 이하여야 검출기가 살아 있다');

      // 시각 총조사 — 모든 건물이 화면에 실제로 뭔가를 그리는가.
      // "샀는데 아무것도 안 생긴다"는 기능 게이트로는 절대 안 잡힌다.
      labSetup();
      G.research('logistics'); G.research('military');
      var oreSp = G.oreSpot('iron-ore');
      var noDraw = [], drew = 0;
      var sigs = {};
      var buildTypes = G.buildIds();
      for (var bt = 0; bt < buildTypes.length; bt++) {
        var typ = buildTypes[bt];
        // 채광기는 광맥 위에만 설 수 있으니 그 자리에서 잰다
        var vx = (typ === 'miner' && oreSp) ? oreSp.x : 100;
        var vy = (typ === 'miner' && oreSp) ? oreSp.y : 100;
        G.clearTrees(vx - 1, vy - 1, 6, 6);
        var baseline = G.probeAt(vx + 1, vy + 1, 96, 1.6);
        var eid = G.place(typ, vx, vy, 1);
        if (!eid) { noDraw.push(typ + '(배치실패)'); continue; }
        var after = G.probeAt(vx + 1, vy + 1, 96, 1.6);
        if (after.hash === baseline.hash) noDraw.push(typ); else drew++;
        sigs[typ] = after.hash;
        G.remove(eid);
      }
      chk('visual.everyBuildingDraws', noDraw.length === 0,
        buildTypes.length + '종 중 ' + drew + '종이 빈 땅과 다른 화면을 그렸다' +
        (noDraw.length ? ' · 화면이 그대로인 것: ' + noDraw.join(', ') : '') +
        ' — 기능 게이트로는 "샀는데 아무것도 안 생긴다"를 절대 못 잡는다');

      // 서로 구별되는가 — 두 건물이 똑같이 보이면 "그리긴 그렸다"만으로는 못 잡는다
      var dupPairs = [];
      var sigKeys = Object.keys(sigs);
      for (var d1 = 0; d1 < sigKeys.length; d1++) {
        for (var d2 = d1 + 1; d2 < sigKeys.length; d2++) {
          if (sigs[sigKeys[d1]] === sigs[sigKeys[d2]]) dupPairs.push(sigKeys[d1] + '=' + sigKeys[d2]);
        }
      }
      chk('visual.buildingsDistinct', dupPairs.length === 0,
        sigKeys.length + '종의 화면 지문이 전부 다르다' +
        (dupPairs.length ? ' · 같은 것: ' + dupPairs.join(', ') : ''));

      // ================= 12. 런타임 오류 ==================================
      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');

      // ================= 13. 하네스 자기 시험 — 반드시 FAIL ================
      chk('selftest.mustFail', G.state().entityCount < 0, '엔티티 수가 음수일 리 없다', true);

      out.finalState = G.state();
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      try { out.errors = window.__GAME ? window.__GAME.errors() : []; } catch (e2) { void e2; }
    }
    emit(out);
  }

  var world0 = { x: 80, y: 80 };
  function go() { setTimeout(runAll, 60); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
