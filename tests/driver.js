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

      // 저장이 만들던 것을 태우면 안 된다 — 재료는 예약할 때 이미 빠졌다
      G.reset(6119); G.clearEntities(); G.setInv('iron-plate', 100);
      G.handCraft('gear'); G.handCraft('gear');
      var svH = G.save();
      G.reset(6119); G.load(svH);
      var qAfterLoad = G.state().handQueue;
      var gearBase = G.state().inventory['gear'] || 0;       // 시작 재고가 있다
      G.run(G.recipeInfo('gear').time * 2 + 0.2);
      var gearsBack = (G.state().inventory['gear'] || 0) - gearBase;
      chk('hand.queueSurvivesSave', qAfterLoad === 2 && gearsBack === 2,
        '2개 예약 후 저장→복원 → 대기열 ' + qAfterLoad + '개(2여야) · 기다린 뒤 톱니 ' +
        gearsBack + '개 (2여야 · 0이면 저장이 만들던 것을 태운다)');

      // --- 연구를 갈아타도 먹인 연구팩은 남는다 ------------------------------
      // 예전엔 갈아타는 순간 진행이 0 이 됐다. 49/50 까지 간 연구를 두고 다른 걸
      // 누르면 적팩 49 + 녹팩 49 가 경고 없이 증발했다 — 되돌릴 수 없는 손실이
      // 클릭 한 번에 나는 자리는 게임에 있으면 안 된다.
      G.reset(6120); G.clearEntities(); G.clearEnemies();
      G.setResearch('military');
      G.addResearch(12);
      var pA = G.state().research.progress;
      G.setResearch('logistics');                 // 갈아탄다
      var pB = G.state().research.progress;
      G.addResearch(3);
      G.setResearch('military');                  // 돌아온다
      var pC = G.state().research.progress;
      chk('research.switchKeepsProgress', pA === 12 && pB === 0 && pC === 12,
        '군수 12개 투입 → ' + pA + ' · 물류학으로 전환 → ' + pB +
        '(새 연구라 0) · 군수로 복귀 → ' + pC + ' (12여야 · 0이면 먹인 팩이 증발한다)');
      // 저장/복원에서도 살아남아야 한다 — 안 그러면 저장 한 번이 같은 손실을 낸다
      var svR = G.save();
      G.reset(6120); G.load(svR);
      var pD = G.state().research.progress;
      G.setResearch('logistics');
      var pE = G.state().research.progress;
      chk('research.switchProgressSurvivesSave', pD === 12 && pE === 3,
        '저장→복원 후 군수 ' + pD + '(12여야) · 물류학으로 전환 ' + pE +
        ' (3이어야 · 0이면 저장이 진행도를 버린 것)');

      // --- 안내한 방법으로 하면 실제로 통과해야 한다 ------------------------
      // 'assemble' 단계는 "톱니는 우측 [손 조립]에서도 만든다"고 안내하는데,
      // 판정은 prodStats.byRecipe 를 보고 손 조립은 그 통계를 건드리지 않았다.
      // 즉 **안내대로 해도 다음 단계로 못 넘어갔다.** 안내와 판정이 갈리면
      // 플레이어는 자기가 뭘 잘못했는지 알 방법이 없다.
      G.reset(5150); G.clearEntities(); G.clearEnemies();
      G.tutorialReset(true); G.setInv('iron-plate', 100);
      var gearBefore = G.tutorialCheckById('assemble');
      G.handCraft('gear');
      G.run(G.recipeInfo('gear').time + 0.2);
      var gearAfter = G.tutorialCheckById('assemble');
      chk('tut.handCraftSatisfiesAssemble', gearBefore === false && gearAfter === true,
        '손 조립 전 판정=' + gearBefore + '(false여야) → 톱니 1개 손 조립 후 ' + gearAfter +
        ' (true여야 · false면 안내가 시키는 대로 해도 단계가 안 넘어간다)');

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

      // --- 연구 관문은 UI 목록이 아니라 시뮬에 있어야 한다 --------------------
      // 관문이 레시피 드롭다운에만 있으면, 그 목록을 안 지나는 길(저장본·시험 훅)은
      // 연구 없이도 만든다. 관문은 결과가 나오는 자리에 있어야 한다.
      G.reset(7700); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      var tf = G.build('furnace', 40, 40, 0);
      G.setRecipe(tf, 'steel');                 // 강철은 'steel' 연구가 필요하다
      G.putFromStock(tf);
      G.run(G.recipeInfo('steel').time * 1.5);
      var lockedOut = (G.ent(tf).out['steel'] || 0);
      G.research('steel');
      G.run(G.recipeInfo('steel').time * 1.5);
      var freeOut = (G.ent(tf).out['steel'] || 0);
      chk('recipe.techGatedInSim', lockedOut === 0 && freeOut > 0,
        '연구 전 강철 산출 ' + lockedOut + '개(0이어야) → 연구 후 ' + freeOut +
        '개 (>0이어야 · 조건 발생 확인)');

      // 튜토리얼 판정은 트랙과 무관해야 한다. 'null' 은 호출자에게 '해당 없음'과
      // '실패'가 구별되지 않아, 세계 상태와 무관하게 0/9 를 내는 게이트를 만든다.
      G.reset(7701); G.clearEntities(); G.tutorialReset(true);
      var advProbe = G.tutorialCheckById('green-sci');     // 기초 트랙인데 심화 id
      chk('tut.checkByIdSpansTracks', typeof advProbe === 'boolean' && advProbe === false,
        '기초 트랙에서 심화 id 판정 → ' + JSON.stringify(advProbe) +
        ' (false 여야 · null 이면 해당없음과 실패가 같아진다)');
      chk('tut.checkByIdRejectsUnknown', G.tutorialCheckById('no-such-step') === null,
        '없는 id → null (음성 대조군: 이게 null 이 아니면 위 검사가 아무것도 안 본다)');

      // --- 평가 순서의 진짜 계약: 입력이 먼저 돈다 --------------------------
      // 이게 깨지면 노드는 **직전 틱 값**으로 계산한다. 되먹임(1틱 지연)은 의도된
      // 것이지만, 되먹임이 아닌 배선까지 한 틱 밀리면 회로가 조용히 틀린 답을 낸다.
      // 실제로 이 파일의 다른 게이트들은 그 붕괴를 못 잡았다 — 순서를 나무별로
      // 뒤집는 변경이 통과됐고, fullplay 의 node.hold 하나만 우연히 걸렸다.
      G.reset(6220); G.clearEntities(); G.clearEnemies();
      G.research('logic-mem');          // 샘플홀드는 이 연구가 열어 준다
      var oc = G.place('controller', 40, 40, 0);
      // 일부러 여러 갈래로 흩어 놓는다. 서로 다른 DFS 진입점에서 만나는 노드가
      // 있어야 "숲을 나눠 뒤집으면 깨진다"는 상황이 실제로 만들어진다.
      var vA = G.gAdd(oc, 'const', 10, 400);  G.gCfg(oc, vA, 'value', 7);
      var vB = G.gAdd(oc, 'const', 10, 10);   G.gCfg(oc, vB, 'value', 5);
      var mm = G.gAdd(oc, 'math', 300, 200);  G.gCfg(oc, mm, 'op', '+');
      G.gLink(oc, vA, 0, mm, 0); G.gLink(oc, vB, 0, mm, 1);
      var hh = G.gAdd(oc, 'hold', 600, 300);
      var sg = G.gAdd(oc, 'const', 10, 800);  G.gCfg(oc, sg, 'value', 1);
      G.gLink(oc, mm, 0, hh, 0); G.gLink(oc, sg, 0, hh, 1);
      var dsp = G.gAdd(oc, 'display', 900, 300); G.gCfg(oc, dsp, 'label', '합');
      G.gLink(oc, hh, 0, dsp, 0);
      G.run(0.05);
      var oinfo = G.gInfo(oc), pos = {};
      for (var oi = 0; oi < oinfo.order.length; oi++) pos[oinfo.order[oi]] = oi;
      // 되먹임(back)이 아닌 모든 배선에서 source 가 target 보다 앞서야 한다
      var links = [[vA, mm], [vB, mm], [mm, hh], [sg, hh], [hh, dsp]];
      var bad = [];
      for (var li = 0; li < links.length; li++) {
        if (!(pos[links[li][0]] < pos[links[li][1]])) bad.push(links[li].join('->'));
      }
      chk('ctrl.inputsEvaluateBeforeOutputs', bad.length === 0 && oinfo.cycles === 0,
        '전방 배선 ' + links.length + '개 중 순서가 뒤집힌 것 ' + bad.length + '건' +
        (bad.length ? ': ' + bad.join(',') : '') + ' · 되먹임 ' + oinfo.cycles +
        '개(0이어야) · 순서 [' + oinfo.order.join(',') + ']');
      // 값으로도 확인한다 — 순서가 깨지면 합이 한 틱 늦게 도착한다
      var dv = G.state().displays;
      chk('ctrl.valueArrivesSameTick',
        dv.length === 1 && dv[0].value === 12,
        '상수 7 + 5 → 샘플홀드 → 표시 = ' + (dv.length ? dv[0].value : 'none') +
        ' (12여야 · 0이면 한 틱 늦게 도착한 것)');

      // === 평활 필터 — 계단응답 해석해가 오라클이다 =========================
      // 1차 지연계의 계단응답은 y(t) = 1 - e^(-t/τ) 다. τ 에서 63.21%, 3τ 에서
      // 95.02%. 이 축에 오라클을 안 붙이면 "값이 대충 따라간다"로 전부 통과한다.
      G.reset(6260); G.clearEntities(); G.clearEnemies();
      G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
      var flC = G.place('controller', 40, 40, 0);
      var flK = G.gAdd(flC, 'const', 10, 10);   G.gCfg(flC, flK, 'value', 0);
      var flS = G.gAdd(flC, 'smooth', 300, 10); G.gCfg(flC, flS, 'tau', 5);
      G.gLink(flC, flK, 0, flS, 0);
      G.run(0.5);                                   // y 를 0 에 앉힌다
      var flStart = G.gOut(flC, flS, 0);
      G.gCfg(flC, flK, 'value', 1);                 // 계단 입력
      G.run(5);   var flTau  = G.gOut(flC, flS, 0); // t = τ
      G.run(10);  var fl3Tau = G.gOut(flC, flS, 0); // t = 3τ
      chk('smooth.stepResponseMatchesAnalytic',
        Math.abs(flStart) < 1e-9 &&
        Math.abs(flTau - 0.632121) < 0.001 && Math.abs(fl3Tau - 0.950213) < 0.001,
        'τ=5 계단응답: t=0 에서 ' + flStart.toFixed(6) + ' · t=τ 에서 ' + flTau.toFixed(6) +
        ' (오라클 0.632121) · t=3τ 에서 ' + fl3Tau.toFixed(6) + ' (오라클 0.950213)');

      // 음성 대조군 — τ=0 은 그냥 통과여야 한다. 위 검사가 "무조건 느리게 따라간다"
      // 로 통과하는 구현을 걸러낸다.
      G.gCfg(flC, flS, 'tau', 0); G.gCfg(flC, flK, 'value', 42);
      G.tickOnce();
      var flPass = G.gOut(flC, flS, 0);
      chk('smooth.zeroTauIsPassthrough', Math.abs(flPass - 42) < 1e-9,
        'τ=0, 입력 42 → 한 틱 뒤 ' + flPass + ' (42여야 · 필터가 항상 걸리면 여기서 갈린다)');

      // dt 를 곱했는가 — 같은 게임시간을 다르게 쪼개면 갈린다.
      // 지수해 y += (x-y)(1-e^(-dt/τ)) 는 어떻게 쪼개도 같은 값이고, 오일러 근사
      // (x-y)·dt/τ 는 안 그렇다. 매 틱 누적에 dt 를 빠뜨려 오염이 60배 나왔던
      // 실패(교훈 03)와 같은 축이라 게이트를 이 성질로 건다.
      function smoothAfter1s(seed, useBigSteps) {
        G.reset(seed); G.clearEntities(); G.clearEnemies();
        G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
        var c = G.place('controller', 40, 40, 0);
        var k = G.gAdd(c, 'const', 10, 10);   G.gCfg(c, k, 'value', 0);
        var s = G.gAdd(c, 'smooth', 300, 10); G.gCfg(c, s, 'tau', 5);
        G.gLink(c, k, 0, s, 0);
        G.tickOnce();                     // y=0 에서 출발
        G.gCfg(c, k, 'value', 1);
        if (useBigSteps) { for (var b = 0; b < 4; b++) G.tickWith(0.25); }  // 1초를 4번에
        else G.run(1);                                                     // 1초를 60번에
        return G.gOut(c, s, 0);
      }
      var flFine = smoothAfter1s(6261, false);
      var flCoarse = smoothAfter1s(6262, true);
      chk('smooth.dtInvariant',
        Math.abs(flFine - flCoarse) < 1e-6 && Math.abs(flFine - 0.181269) < 0.001,
        '1초를 60틱으로 → ' + flFine.toFixed(6) + ' · 4틱으로 → ' + flCoarse.toFixed(6) +
        ' (오라클 1-e^-0.2 = 0.181269 · 두 값이 다르면 dt 를 안 곱했거나 오일러 근사다)');

      // 놓고 나서 잇는다 — 사람이 쓰는 유일한 순서다. 배선 전에 씨앗을 박으면
      // y=0 으로 굳어, 배선한 순간 "이미 돌던 신호에 필터를 무는" 바로 그 과도가
      // 생긴다(적대적 리뷰가 잡았다. τ=10 이면 60→50 경보가 18초간 거짓으로 켜진다).
      G.reset(6267); G.clearEntities(); G.clearEnemies();
      G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
      var sdC = G.place('controller', 40, 40, 0);
      var sdK = G.gAdd(sdC, 'const', 10, 10);   G.gCfg(sdC, sdK, 'value', 500);
      var sdS = G.gAdd(sdC, 'smooth', 300, 10); G.gCfg(sdC, sdS, 'tau', 5);
      G.run(0.5);                                   // 아직 안 물린 채로 30틱
      var sdUnfed = G.gOut(sdC, sdS, 0);
      G.gLink(sdC, sdK, 0, sdS, 0);
      G.tickOnce();                                 // 물린 첫 틱
      var sdFirst = G.gOut(sdC, sdS, 0);
      chk('smooth.seedsFromRealInputWhenWired',
        Math.abs(sdUnfed) < 1e-9 && Math.abs(sdFirst - 500) < 1e-9,
        '안 물린 동안 ' + sdUnfed + ' (0이어야) → 상수 500 을 물린 첫 틱 ' + sdFirst +
        ' (500이어야 · 0에서 기어오르면 없던 과도가 생긴다)');
      // 음성 대조군 — 처음부터 물려 있던 신호가 계단으로 바뀌면 그건 눅어야 한다.
      // 없으면 위 검사는 "필터가 아예 안 걸린다" 를 통과시킨다.
      G.gCfg(sdC, sdK, 'value', 1000);
      G.tickOnce();
      var sdStep = G.gOut(sdC, sdS, 0);
      chk('smooth.wiredStepStillFilters',
        sdStep > 500 && sdStep < 510,
        '물린 채로 500 → 1000 계단, 한 틱 뒤 ' + sdStep.toFixed(3) +
        ' (500 바로 위여야 · 1000 이면 필터가 아무 일도 안 한다)');

      // === 상태기계 — 상승엣지 전이, 리셋 우선, 원핫 ========================
      G.reset(6263); G.clearEntities(); G.clearEnemies();
      G.research('logistics'); G.research('logic-mem');
      var fsC = G.place('controller', 40, 40, 0);
      var fsGo = G.gAdd(fsC, 'const', 10, 10);   G.gCfg(fsC, fsGo, 'value', 0);
      var fsR  = G.gAdd(fsC, 'const', 10, 300);  G.gCfg(fsC, fsR, 'value', 0);
      var fsM  = G.gAdd(fsC, 'fsm', 400, 10);
      // 네 전이 조건을 **모두** 같은 신호에 물린다. 하나만 물리면 레벨 전이 구현도
      // 2단계에서 멈춰서(다음 조건이 안 물렸으므로) 상승엣지와 구별되지 않는다.
      G.gLink(fsC, fsGo, 0, fsM, 0); G.gLink(fsC, fsGo, 0, fsM, 1);
      G.gLink(fsC, fsGo, 0, fsM, 2); G.gLink(fsC, fsGo, 0, fsM, 3);
      G.gLink(fsC, fsR, 0, fsM, 4);
      G.run(0.2);
      var fsS0 = G.gOut(fsC, fsM, 0);
      G.gCfg(fsC, fsGo, 'value', 1);
      G.run(0.5);                                   // 30틱 동안 조건을 참으로 유지
      var fsS1 = G.gOut(fsC, fsM, 0);
      G.run(2);                                     // 정상상태 — 더 돌려도 그대로여야
      var fsS1b = G.gOut(fsC, fsM, 0);
      chk('fsm.advancesOnceWhileHeld', fsS0 === 1 && fsS1 === 2 && fsS1b === 2,
        '시작 ' + fsS0 + '단계 → 조건을 30틱 참으로 유지 → ' + fsS1 + '단계 (2여야) → 2초 더 → ' +
        fsS1b + '단계 (레벨 전이면 매 틱 돌아 3단계로 간다)');
      // 원핫 — 단계 출구는 현재 단계에서만 1
      var fsOne = [G.gOut(fsC, fsM, 1), G.gOut(fsC, fsM, 2), G.gOut(fsC, fsM, 3), G.gOut(fsC, fsM, 4)];
      chk('fsm.oneHotOutputs',
        fsOne[0] === 0 && fsOne[1] === 1 && fsOne[2] === 0 && fsOne[3] === 0,
        '2단계에서 단계 출구 [' + fsOne.join(',') + '] (0,1,0,0 이어야)');
      // 다시 올라가면 한 칸 더 — 펄스마다 한 칸이라는 것까지 봐야 "안 움직이는" 구현이 걸린다
      // (여기서 한 번 펄스를 넣는 헬퍼를 쓴다 — 아래에서 고리를 계속 돌린다)
      function fsPulse() {
        G.gCfg(fsC, fsGo, 'value', 0); G.run(0.2);
        G.gCfg(fsC, fsGo, 'value', 1); G.run(0.2);
        return G.gOut(fsC, fsM, 0);
      }
      var fsS2 = fsPulse();
      chk('fsm.nextPulseAdvancesAgain', fsS2 === 3,
        '조건을 내렸다 다시 올림 → ' + fsS2 + '단계 (3이어야 · 음성 대조군: 전이가 아예 안 되면 위 검사도 통과한다)');

      // 고리를 **끝까지** 돈다. 3단계까지만 보면 4단계도, 4→1 순환도, 네 번째
      // 전이 입력도, 네 번째 단계 출구도 한 번도 안 밟는다 — 3단계 순환기로
      // 만들어 놔도 위 게이트가 전부 통과한다.
      var fsS4 = fsPulse();
      var fsHot4 = [G.gOut(fsC, fsM, 1), G.gOut(fsC, fsM, 2),
                    G.gOut(fsC, fsM, 3), G.gOut(fsC, fsM, 4)].join(',');
      var fsWrap = fsPulse();
      chk('fsm.ringWrapsAtFour',
        fsS4 === 4 && fsHot4 === '0,0,0,1' && fsWrap === 1,
        '3 → ' + fsS4 + '단계(4여야) · 4단계 출구 [' + fsHot4 + '] (0,0,0,1 이어야) → 한 번 더 → ' +
        fsWrap + '단계 (1로 돌아와야 · 안 돌아오면 4에서 멈추는 순환기다)');

      // 리셋은 전이보다 세다 — **같은 틱 안에서** 그런지를 봐야 한다.
      // 처음에는 리셋을 들고 0.2초를 돌린 뒤 단계를 읽었는데, 그건 "리셋이 결국
      // 이긴다"만 보는 검사였다: 전이가 이기는 구현도 다음 틱에 리셋이 도로 1로
      // 끌어내려 통과했다(돌연변이 MISS 로 확인). 전이와 리셋이 함께 참이 되는
      // 그 한 틱만 잘라서 본다.
      fsPulse(); fsPulse();                         // 1 → 2 → 3
      G.gCfg(fsC, fsGo, 'value', 0); G.run(0.2);
      var fsPre = G.gOut(fsC, fsM, 0);              // 3단계에서 대기
      G.gCfg(fsC, fsR, 'value', 1); G.gCfg(fsC, fsGo, 'value', 1);
      G.tickOnce();                                 // 리셋 ON 과 전이 상승이 같은 틱
      var fsRst = G.gOut(fsC, fsM, 0);
      chk('fsm.resetDominates', fsPre === 3 && fsRst === 1,
        '3단계에서 리셋과 전이가 같은 틱에 참 → ' + fsRst +
        '단계 (1이어야 · 전이가 이기면 4가 된다) · 직전 단계 ' + fsPre);

      // **리셋은 엣지 기억까지 지우면 안 된다.** 지우는 구현도 위 검사들을 전부
      // 통과하는데, 리셋을 놓는 순간 붙들려 있던 조건이 '방금 올라간 것'으로 읽혀
      // 한 칸 튄다 — 플레이어에겐 "리셋했더니 저절로 움직였다"로 보인다.
      G.run(0.3);                                   // 리셋과 전이를 함께 든 채 유지
      var fsHeld = G.gOut(fsC, fsM, 0);
      G.gCfg(fsC, fsR, 'value', 0); G.run(0.3);     // 전이는 참인 채로 리셋만 내린다
      var fsAfterRelease = G.gOut(fsC, fsM, 0);
      chk('fsm.resetKeepsEdgeMemory', fsHeld === 1 && fsAfterRelease === 1,
        '리셋+전이 동시 유지 → ' + fsHeld + '단계 · 리셋만 내림(전이는 참 유지) → ' +
        fsAfterRelease + '단계 (1이어야 · 리셋이 엣지 기억을 지우면 2로 튄다)');

      // 저장은 단계를 들고 가야 한다 — 안 그러면 불러오는 순간 공정이 처음으로 돌아간다.
      // **2단계에서 저장하면 안 된다.** 상태를 통째로 잃은 구현은 1단계로 초기화된 뒤,
      // 붙들린 전이 조건에 곧바로 한 칸 튀어 정확히 2단계에 도착한다 — 두 버그가
      // 상쇄돼 게이트가 GREEN 을 낸다(적대적 리뷰가 잡은 구멍이다). 3단계에서,
      // 그리고 전이 조건을 **내린 채** 저장한다.
      G.gCfg(fsC, fsGo, 'value', 0); G.run(0.2);
      fsPulse(); fsPulse();                         // 1 → 2 → 3
      G.gCfg(fsC, fsGo, 'value', 0); G.run(0.2);    // 조건을 내려 둔다
      var fsBefore = G.gOut(fsC, fsM, 0);
      var fsRaw = G.saveRaw(); G.load(fsRaw); G.run(0.05);
      var fsAfter = G.gOut(fsC, fsM, 0);
      chk('fsm.survivesSave', fsBefore === 3 && fsAfter === 3,
        '조건을 내린 채 ' + fsBefore + '단계에서 저장 → 복원 후 ' + fsAfter +
        '단계 (3이어야 · 상태를 안 담으면 1단계로 돌아간다)');

      // 엣지 기억도 저장돼야 한다. 단계만 담고 pe 를 버리면, 붙들린 조건이 복원
      // 직후 상승으로 읽혀 한 칸 튄다 — 위 검사는 조건을 내려 뒀으므로 못 잡는다.
      G.gCfg(fsC, fsGo, 'value', 1); G.run(0.2);    // 4단계로, 조건을 든 채
      var fsBefore2 = G.gOut(fsC, fsM, 0);
      var fsRaw2 = G.saveRaw(); G.load(fsRaw2); G.run(0.05);
      var fsAfter2 = G.gOut(fsC, fsM, 0);
      chk('fsm.saveKeepsEdgeMemory', fsBefore2 === 4 && fsAfter2 === 4,
        '전이 조건을 참으로 든 채 ' + fsBefore2 + '단계에서 저장 → 복원 후 ' + fsAfter2 +
        '단계 (4여야 · 엣지 기억을 안 담으면 복원 즉시 한 칸 튄다)');

      // **전이 입력은 그 단계에서만 유효하다.** 위 리그는 네 입력을 한 신호에 물려
      // 놔서 이 성질을 하나도 안 잰다 — 현재 단계를 안 보고 아무 입력에나 전이하는
      // 구현이 여기까지 전부 통과한다. 입력마다 다른 소스를 물린 리그로 따로 본다.
      G.reset(6266); G.clearEntities(); G.clearEnemies();
      G.research('logistics'); G.research('logic-mem');
      var sqC = G.place('controller', 40, 40, 0);
      var sqA = G.gAdd(sqC, 'const', 10, 10);   G.gCfg(sqC, sqA, 'value', 0);   // 1→2 전용
      var sqB = G.gAdd(sqC, 'const', 10, 300);  G.gCfg(sqC, sqB, 'value', 0);   // 3→4 전용
      var sqM = G.gAdd(sqC, 'fsm', 400, 10);
      G.gLink(sqC, sqA, 0, sqM, 0);                 // '1→2' 에만
      G.gLink(sqC, sqB, 0, sqM, 2);                 // '3→4' 에만
      G.run(0.2);
      G.gCfg(sqC, sqB, 'value', 1); G.run(0.5);     // 1단계인데 '3→4' 를 올린다
      var sqStay = G.gOut(sqC, sqM, 0);
      G.gCfg(sqC, sqA, 'value', 1); G.run(0.2);     // 이제 '1→2' 를 올린다
      var sqGo = G.gOut(sqC, sqM, 0);
      chk('fsm.inputsAreStageScoped', sqStay === 1 && sqGo === 2,
        "1단계에서 '3→4' 입력을 올림 → " + sqStay + "단계 (1이어야 · 단계를 안 보면 2로 간다) · " +
        "이어서 '1→2' 를 올림 → " + sqGo + '단계 (2여야 · 조건 발생 확인)');

      // === 신호 버스 — 합산되고, 한 틱 늦고, 순서를 안 탄다 ==================
      // 제어기 사이의 평가 순서는 배치로 정해지지 않는다(graphCompile 주석). 그래서
      // 버스가 순서를 타면 플레이어가 원인을 짚을 단서가 하나도 없다. 그 성질을
      // 값으로 못 박는다.
      // 제어기 평가 순서 = 생성 순서다(forEachEntity 가 entOrder 를 돈다). 그래서
      // **수신기를 언제 만드느냐가 검출력을 바꾼다** — 수신기를 늘 마지막에 만들면
      // '같은 틱에 읽는' 결함은 항상 잡히지만, 수신기가 먼저인 배치에서 그 결함이
      // 어떻게 보이는지는 한 번도 안 재게 된다. rcvFirst 로 둘 다 돈다.
      function busRig(seed, reverse, rcvFirst) {
        G.reset(seed); G.clearEntities(); G.clearEnemies();
        G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
        var mk = function (tx, val, ch) {
          var c = G.place('controller', tx, 40, 0);
          var k = G.gAdd(c, 'const', 10, 10); G.gCfg(c, k, 'value', val);
          var s = G.gAdd(c, 'bussend', 300, 10); G.gCfg(c, s, 'ch', ch);
          G.gLink(c, k, 0, s, 0);
          return { ctrl: c, send: s };
        };
        var rc = null, rn = null;
        var mkRecv = function () {
          rc = G.place('controller', 52, 40, 0);
          rn = G.gAdd(rc, 'busrecv', 10, 10); G.gCfg(rc, rn, 'ch', 'A');
        };
        if (rcvFirst) mkRecv();
        var w1, w2;
        if (reverse) { w2 = mk(44, 4, 'A'); w1 = mk(40, 3, 'A'); }
        else         { w1 = mk(40, 3, 'A'); w2 = mk(44, 4, 'A'); }
        var other = mk(48, 9, 'B');            // 다른 채널 — 섞이면 안 된다
        if (!rcvFirst) mkRecv();
        return { w1: w1, w2: w2, other: other, rc: rc, rn: rn };
      }
      var buA = busRig(6264, false);
      G.tickOnce();
      var buFirst = G.gOut(buA.rc, buA.rn, 0);      // 같은 틱엔 아직 0
      G.tickOnce();
      var buSecond = G.gOut(buA.rc, buA.rn, 0);     // 다음 틱에 3+4=7
      chk('bus.readsPreviousTick', buFirst === 0 && buSecond === 7,
        '송신 3+4 → 첫 틱 수신 ' + buFirst + ' (0이어야 · 같은 틱에 읽히면 평가 순서를 탄다)' +
        ' → 다음 틱 ' + buSecond + ' (7이어야)');
      chk('bus.sumsWriters', G.bus('A') === 7,
        '채널 A 합계 ' + G.bus('A') + ' (3+4=7 이어야 · 덮어쓰기면 3 또는 4가 나온다)');
      chk('bus.channelsAreIsolated', G.bus('B') === 9 && G.bus('C') === 0,
        '채널 B ' + G.bus('B') + ' (9여야) · 채널 C ' + G.bus('C') +
        ' (0이어야 · 음성 대조군: 채널이 안 갈리면 위 합계 검사가 무의미하다)');
      // 수신기를 **먼저** 만든 배치에서도 한 틱 늦게 와야 한다. 이쪽이 위 검사의
      // 진짜 음성 대조군이다 — 수신기가 언제나 마지막이면, 같은 틱에 읽는 구현도
      // '아직 아무도 안 썼다' 가 아니라 '이미 다 썼다' 를 보게 되어 검출이 배치에
      // 얹혀 간다.
      var buR1 = busRig(6268, false, true);
      G.tickOnce();
      var buRF1 = G.gOut(buR1.rc, buR1.rn, 0);
      G.tickOnce();
      var buRF2 = G.gOut(buR1.rc, buR1.rn, 0);
      chk('bus.delayHoldsWhenReceiverIsFirst', buRF1 === 0 && buRF2 === 7,
        '수신 제어기를 먼저 만든 배치 → 첫 틱 ' + buRF1 + ' (0이어야) · 다음 틱 ' + buRF2 +
        ' (7이어야 · 이 배치에서 값이 갈리면 버스가 생성 순서를 타는 것이다)');

      // 순서 무관 — 송신 제어기를 반대 순서로 만들어도 같은 값
      var buB = busRig(6265, true);
      G.run(0.05);
      var buRev = G.bus('A');
      chk('bus.orderIndependent', buRev === 7,
        '송신 제어기 생성 순서를 뒤집어도 채널 A = ' + buRev + ' (7이어야)');
      // 송신 노드를 지우면 그 몫이 다음 틱에 빠진다 (출력 축의 유령 지배 해제와 같은 성질)
      G.gRemove(buB.w2.ctrl, buB.w2.send);
      G.run(0.05);
      var buGone = G.bus('A');
      chk('bus.contributionLeavesWithNode', buGone === 3,
        '4를 보내던 송신 노드를 삭제 → 채널 A = ' + buGone +
        ' (3이어야 · 안 빠지면 지운 회로가 계속 지배한다)');
      // 저장이 버스를 안 담으면 불러온 첫 틱에 모든 채널이 0 이 된다
      var buRaw = G.saveRaw(); G.load(buRaw);
      var buLoaded = G.bus('A');
      chk('bus.survivesSave', buLoaded === 3,
        '저장→복원 직후 채널 A = ' + buLoaded + ' (3이어야 · 0이면 복원 첫 틱에 회로가 손을 놓는다)');

      // --- 분배기 [출력우선] 의 왼쪽/오른쪽은 진행방향 기준이다 ---------------
      // cells[0] 은 언제나 좌표가 작은 쪽이라, 남·서향에서는 UI 의 [왼쪽]이
      // 오른쪽으로 나갔다. 이 집의 규약(레인 0 = dirCCW)과 어긋난 채로 있었다.
      // 네 방향을 전부 잰다 — 북·동만 재면 원래 코드도 통과한다(음성 대조군).
      var sideFail = [];
      for (var sd = 0; sd < 4; sd++) {
        G.reset(7500 + sd); G.clearEntities(); G.clearEnemies();
        G.giveAll(9999); G.research('logistics'); G.research('steel');
        var spx = 50, spy = 50;
        var spid = G.build('splitter', spx, spy, sd);
        if (!spid) { sideFail.push('dir' + sd + ' 배치실패'); continue; }
        var cc = G.cellCoords(spid);
        // 진행방향 기준 왼쪽 = dirCCW(sd) 방향에 있는 셀
        var ccwD = (sd + 3) & 3;
        var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
        var mid = [(cc[0][0] + cc[1][0]) / 2, (cc[0][1] + cc[1][1]) / 2];
        var leftCell = ((cc[0][0] - mid[0]) * DX[ccwD] + (cc[0][1] - mid[1]) * DY[ccwD]) > 0 ? 0 : 1;
        // 두 출구 앞에 벨트를 깔고, [왼쪽] 우선으로 하나 흘려 어디로 나가는지 본다
        for (var q = 0; q < 2; q++) {
          G.build('belt', cc[q][0] + DX[sd], cc[q][1] + DY[sd], sd);
        }
        G.setSplitterPrio(spid, 0);                     // 0 = 왼쪽
        G.beltPut(spid, 'coal', 0.5);
        G.run(2.0);
        var lb = G.entAtTile(cc[leftCell][0] + DX[sd], cc[leftCell][1] + DY[sd]);
        var rb = G.entAtTile(cc[1 - leftCell][0] + DX[sd], cc[1 - leftCell][1] + DY[sd]);
        function beltN(bid) { var be = bid ? G.ent(bid) : null;
          if (!be || !be.beltItems) return -1;
          var t = 0; for (var z = 0; z < be.beltItems.length; z++) t += be.beltItems[z];
          return t; }
        var lCount = beltN(lb), rCount = beltN(rb);
        if (!(lCount > 0 && rCount === 0)) {
          sideFail.push('dir' + sd + ' 왼쪽=' + lCount + ' 오른쪽=' + rCount);
        }
      }
      chk('splitter.prioIsTravelRelative', sideFail.length === 0,
        '4방향 [왼쪽] 우선 → 어긋난 방향 ' + sideFail.length + '개' +
        (sideFail.length ? ': ' + sideFail.join(' | ') : ' (남·서에서 반대로 나가던 자리)'));

      // --- 용광로는 굽던 것을 기억한다 ---------------------------------------
      G.reset(7600); G.clearEntities(); G.clearEnemies(); G.giveAll(0); G.powerCheat(true);
      G.setInv('brick', 5); G.setInv('iron-plate', 5);
      var fz2 = G.build('furnace', 40, 40, 0);
      // **구리로 시험한다.** 철광석은 ITEM_IDS 의 첫 항목이라, 철로 시험하면
      // 고치기 전(선언 순서로 결정)에도 똑같이 iron-plate 가 나와 구별이 안 된다.
      // 돌연변이 검정에서 이 게이트만 SURVIVED 로 살아남아 드러난 자리다.
      G.setInv('copper-ore', 1);  // **정확히 1개** — 남으면 용광로가 안 비어 해제가 안 된다
      G.putFromStock(fz2);
      G.run(4.0);
      G.takeOutputToStock(fz2);                          // 출력을 걷으면 완전히 빈다
      G.run(0.05);
      var relRec = G.ent(fz2).recipe;
      G.setInv('iron-ore', 10); G.setInv('copper-ore', 10);
      G.putFromStock(fz2);
      var backRec = G.ent(fz2).recipe;
      chk('furnace.remembersLastRecipe', relRec === null && backRec === 'copper-plate',
        '비면 레시피 해제=' + relRec + '(null이어야) → 철·구리가 같이 있을 때 다시 급광하면 ' +
        backRec + ' (copper-plate 여야 · 예전엔 ITEM_IDS 선언 순서가 정해 철이 이겼다)');
      // 음성 대조군 — 굽던 광석이 없으면 예전처럼 다른 광석으로 갈아탄다.
      // 이게 안 되면 "철을 굽던 용광로가 구리를 영원히 거부한다" 로 되돌아간다.
      G.reset(7601); G.clearEntities(); G.giveAll(0); G.powerCheat(true);
      G.setInv('brick', 5); G.setInv('iron-plate', 5);
      var fz3 = G.build('furnace', 40, 40, 0);
      G.setInv('copper-ore', 1); G.putFromStock(fz3); G.run(4.0);
      G.takeOutputToStock(fz3); G.run(0.05);
      G.setInv('copper-ore', 0); G.setInv('iron-ore', 10);
      G.putFromStock(fz3);
      chk('furnace.stillSwitchesWhenOldOreGone', G.ent(fz3).recipe === 'iron-plate',
        '굽던 구리광석이 없고 철광석만 있을 때 → ' + G.ent(fz3).recipe +
        ' (iron-plate 여야 · 아니면 갈아타기 자체가 막힌 것)');

      // ================= 8.3 짓는 길은 두 가지이고 서로 달라야 한다 =========
      // G.place 는 free 경로(비용·기술·광맥 무시)라 계통 하나만 떼어 잴 때 쓴다.
      // G.build 는 플레이어와 같은 길이다. 완주 주행이 place 를 쓰고 있었고,
      // 그래서 **광맥 없는 땅에 채광기를 세워 놓고** 아무것도 안 캐는 것을 40분
      // 동안 눈치채지 못했다. 두 경로가 실제로 다른지 여기서 못박는다.
      G.reset(7411); G.clearEntities(); G.clearEnemies(); G.giveAll(0);
      var bareX = 20, bareY = 20;                       // 광맥이 없는 빈 땅
      chk('build.needsMaterials',
        G.build('furnace', bareX, bareY, 0) === null && G.place('furnace', bareX, bareY, 0) !== null,
        '재고 0에서 build=거절 · place=허용 (place 가 거절하면 free 경로가 아니다)');

      G.reset(7412); G.clearEntities(); G.giveAll(9999);
      chk('build.minerNeedsOre',
        G.build('miner', bareX, bareY, 0) === null,
        '광맥 없는 땅에 채광기 build → 거절 (' + G.whyPlace('miner', bareX, bareY, 0) + ')');
      var sp4 = G.oreSpot('iron-ore');          // **이 시드의** 광맥이어야 한다
      var onOre = sp4 ? G.build('miner', sp4.x, sp4.y, 0) : null;
      chk('build.minerOnOreWorks', !!onOre,
        '광맥 위 채광기 build → id=' + onOre + ' (조건 발생 확인)');

      G.reset(7413); G.clearEntities(); G.giveAll(9999);
      chk('build.needsTech',
        G.build('turret', 30, 30, 0) === null,
        '군수 연구 전 터렛 build → 거절 (재료는 충분한데도)');
      G.research('military');
      chk('build.techUnlocksBuild', G.build('turret', 30, 30, 0) !== null,
        '군수 연구 후 터렛 build → 성공 (조건 발생 확인)');

      G.reset(7414); G.clearEntities(); G.giveAll(0); G.setInv('brick', 5); G.setInv('iron-plate', 5);
      var beforeB = G.state().inventory['brick'];
      G.build('furnace', 30, 30, 0);
      chk('build.chargesCost', G.state().inventory['brick'] === beforeB - 5,
        '용광로 build → 벽돌 ' + beforeB + ' → ' + G.state().inventory['brick'] + ' (5 차감돼야)');

      // ================= 8.35 문장(규칙)이 진짜 회로가 되는가 ===============
      // 문장 편집기는 **두 번째 런타임이 아니다** — 노드를 대신 놓아 줄 뿐이다.
      // 그러니 판정도 "문장을 만들었나"가 아니라 **세계가 실제로 움직였나**로 한다.
      G.reset(8100); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true); G.research('logic-mem');
      var rc1 = G.place('controller', 40, 40, 0);
      var rBox = G.place('chest', 44, 40, 0);
      var rAsm = G.place('assembler', 48, 40, 0);
      G.setRecipe(rAsm, 'gear');
      // "상자의 철판이 50개 미만이면 조립기를 켠다, 다시 200개 넘으면 끈다"
      var r1 = G.ruleAdd(rc1, { name: '철판부족',
        when: { src: 'chest', ent: rBox, item: 'iron-plate', cmp: '<', value: 50 },
        memo: { kind: 'latch', resetCmp: '>', resetValue: 200 },
        then: { act: 'run', ent: rAsm, onWhenTrue: true } });
      var comp = G.ruleCompile(rc1);
      chk('rule.compilesToNodes', comp && comp.nodes >= 6 && comp.skipped.length === 0,
        '규칙 1개 → 노드 ' + (comp ? comp.nodes : 0) + '개 · 건너뛴 것 ' +
        (comp ? comp.skipped.length : '?') + ' (상자센서·상수2·비교2·래치·가동 = 최소 7)');

      // 상자를 비운 채 돌리면 조립기가 켜져야 한다
      G.fillChest(rBox, 'iron-plate', 10);
      G.run(0.2);
      var onWhenLow = G.ent(rAsm).enabled;
      // 200개를 넘기면 꺼져야 한다 — 히스테리시스의 반대 방향
      G.fillChest(rBox, 'iron-plate', 300);
      G.run(0.2);
      var offWhenHigh = G.ent(rAsm).enabled;
      chk('rule.worldActuallyMoves', onWhenLow === true && offWhenHigh === false,
        '철판 10개 → 조립기 ' + (onWhenLow ? '켜짐' : '꺼짐') + '(켜져야) · 310개 → ' +
        (offWhenHigh ? '켜짐' : '꺼짐') + '(꺼져야) · 문장이 실제로 세계를 움직였는가');

      // **음성 대조군** — 규칙을 끄면 지배가 풀려 기계가 플레이어 설정으로 돌아온다.
      // 이게 안 되면 위 검사는 "원래 그 상태였다"를 통과시킨 것일 수 있다.
      G.ruleSet(rc1, r1, { enabled: false });
      G.ruleCompile(rc1);
      G.run(0.2);
      chk('rule.disabledReleasesControl',
        G.ent(rAsm).enabled === true && G.gInfo(rc1).nodes === 0,
        '규칙을 끄면 → 노드 ' + G.gInfo(rc1).nodes + '개(0이어야) · 조립기 ' +
        (G.ent(rAsm).enabled ? '켜짐' : '꺼짐') + '(플레이어 설정인 켜짐으로 돌아와야)');

      // **규칙끼리 겹치지 않아야 한다.** 좌표가 곧 평가 순서라(graphCompile),
      // 두 문장의 노드가 뒤엉키면 회로로 펼쳤을 때 어느 것이 어느 규칙인지 알 수
      // 없고 순서도 뒤섞인다. 행 간격을 190px 로 박아 뒀더니 래치 규칙이 자기
      // 부품을 y+516 까지 뻗어 다음 규칙을 덮었다(이 게이트가 잡았다).
      function ruleRows(firstMemo) {
        G.reset(8101); G.clearEntities(); G.giveAll(9999); G.research('logic-mem');
        var c = G.place('controller', 40, 40, 0);
        var b2 = G.place('chest', 44, 40, 0);
        var a2 = G.place('assembler', 48, 40, 0);
        var r1 = G.ruleAdd(c, { when: { src: 'chest', ent: b2, item: 'iron-plate', cmp: '<', value: 50 },
                                memo: { kind: firstMemo, resetCmp: '>', resetValue: 200 },
                                then: { act: 'run', ent: a2 } });
        var r2 = G.ruleAdd(c, { when: { src: 'powerSat', cmp: '<', value: 95 },
                                then: { act: 'run', ent: a2, onWhenTrue: false } });
        G.ruleCompile(c);
        var ns = G.gNodes(c);
        function band(rid) {
          var lo = 1e9, hi = -1e9;
          for (var k = 0; k < ns.length; k++) {
            if (ns[k].rule !== rid) continue;
            if (ns[k].y < lo) lo = ns[k].y;
            if (ns[k].y > hi) hi = ns[k].y;
          }
          return [lo, hi];
        }
        return { one: band(r1), two: band(r2), n: ns.length,
                 sig: ns.map(function (n) { return n.rule + ':' + n.x + ',' + n.y; }).sort().join('|'),
                 order: G.gInfo(c).order.join(',') };
      }
      var thin = ruleRows('none'), fat = ruleRows('latch');
      var overlapThin = thin.one[1] >= thin.two[0], overlapFat = fat.one[1] >= fat.two[0];
      chk('rule.rowsDoNotOverlap', !overlapThin && !overlapFat,
        '규칙1 세로범위 vs 규칙2 시작 — 작을 때 ' + thin.one[1] + ' < ' + thin.two[0] +
        '=' + !overlapThin + ' · 클 때(래치) ' + fat.one[1] + ' < ' + fat.two[0] +
        '=' + !overlapFat + ' (겹치면 두 문장의 노드가 뒤엉킨다)');
      // 음성 대조군 — 같은 문장을 두 번 컴파일하면 좌표·순서가 완전히 같아야 한다.
      // 이게 없으면 위 검사는 "좌표를 아무렇게나 줘도" 통과시킨다.
      var again = ruleRows('latch');
      chk('rule.deterministicLayout', again.sig === fat.sig && again.order === fat.order,
        '같은 문장 두 번 컴파일 → 좌표·순서 동일=' +
        (again.sig === fat.sig && again.order === fat.order) + ' · 노드 ' + fat.n + '개');

      // 연구 안 된 노드로는 컴파일하지 않는다 — 잠긴 노드는 evalNode 가 조용히 0을
      // 낸다. "문장은 맞는데 아무 일도 안 일어남"이 이 게임에서 제일 나쁜 실패다.
      G.reset(8102); G.clearEntities(); G.giveAll(9999);   // logic-mem 연구 안 함
      var rc2 = G.place('controller', 40, 40, 0);
      var box2 = G.place('chest', 44, 40, 0);
      G.ruleAdd(rc2, { when: { src: 'chest', ent: box2, item: 'iron-plate', cmp: '<', value: 50 },
                       memo: { kind: 'latch' }, then: { act: 'run', ent: box2 } });
      var comp2 = G.ruleCompile(rc2);
      var lst = G.ruleList(rc2);
      chk('rule.locksBehindResearch',
        comp2.skipped.length === 1 && comp2.nodes === 0 && !!lst[0].blocked,
        '기억소자 연구 전 래치 규칙 → 건너뜀 ' + comp2.skipped.length + '건 · 노드 ' +
        comp2.nodes + '개 · 이유 "' + (lst[0].blocked || '없음') + '" (조용히 0을 내면 안 된다)');
      G.research('logic-mem');
      var comp3 = G.ruleCompile(rc2);
      chk('rule.unlocksAfterResearch', comp3.skipped.length === 0 && comp3.nodes > 0,
        '연구 후 다시 컴파일 → 노드 ' + comp3.nodes + '개 (조건 발생 확인)');

      // 규칙끼리 이름으로 잇기 — 배선 없이 조합하는 길
      G.reset(8103); G.clearEntities(); G.giveAll(9999); G.powerCheat(true);
      var rc3 = G.place('controller', 40, 40, 0);
      var lab3 = G.place('lab', 48, 44, 0);
      G.ruleAdd(rc3, { name: '전기부족',
        when: { src: 'powerHead', cmp: '<', value: 999999 },   // 항상 참
        then: { act: 'display', label: '전기부족' } });
      G.ruleAdd(rc3, { when: { refName: '전기부족' },
                       then: { act: 'run', ent: lab3, onWhenTrue: false } });
      G.ruleCompile(rc3);
      G.run(0.2);
      chk('rule.rulesReferenceByName', G.ent(lab3).enabled === false,
        '규칙2가 규칙1의 이름을 읽어 연구소를 끔 → ' +
        (G.ent(lab3).enabled ? '켜짐(실패)' : '꺼짐(성공)'));

      // 저장/복원에 문장이 실린다 — 안 실으면 불러오기 한 번에 회로만 남는다
      var svR2 = G.save();
      G.reset(8103); G.load(svR2);
      var after = G.ruleList(rc3);
      chk('rule.survivesSave', !!after && after.length === 2 && after[0].name === '전기부족',
        '저장→복원 후 규칙 ' + (after ? after.length : 0) + '개 · 첫 규칙 이름 "' +
        (after && after[0] ? after[0].name : '') + '"');

      // ▶ 아래 블록은 자기 판을 새로 깐다. 그래서 규칙 절이 **끝난 뒤**에 둔다 —
      //   중간에 뒀더니 G.reset 이 위 검사들의 제어기·조립기를 지워 드라이버가
      //   TypeError 로 통째로 죽었다(교훈 14 를 쓴 사람이 그대로 다시 밟았다).
      // **'숫자를 띄운다' 는 숫자를 띄워야 한다.** 행동표에 value 플래그가 있는데
      // 컴파일러가 그걸 한 번도 안 읽어서, 조건의 참/거짓(1 또는 0)이 화면에 떴다.
      // "숫자를 화면에 띄워 보기" 카드가 정확히 그 상태였다 — 문장은 맞는데 값이 틀리다.
      G.reset(8101); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      var rc9 = G.place('controller', 40, 40, 0);
      var rBox9 = G.place('chest', 44, 40, 0);
      G.fillChest(rBox9, 'iron-plate', 37);
      G.ruleAdd(rc9, {
        when: { src: 'chest', ent: rBox9, item: 'iron-plate', cmp: '>=', value: 0 },
        then: { act: 'display', label: '철판수' } });
      G.ruleCompile(rc9);
      G.run(0.2);
      var dsp9 = G.state().displays.filter(function (d) { return d.label === '철판수'; });
      chk('rule.displayShowsTheNumber',
        dsp9.length === 1 && dsp9[0].value === 37,
        '상자에 철판 37개 · "철판수를 띄운다" 문장 → 표시값 ' +
        (dsp9.length ? dsp9[0].value : 'none') + ' (37이어야 · 1이면 조건의 참/거짓을 띄운 것)');
      // 음성 대조군 — 조건이 거짓이면 0 이어야 한다. 이게 없으면 위 검사는
      // "조건을 아예 안 본다" 는 구현도 통과시킨다.
      G.ruleSet(rc9, G.ruleList(rc9)[0].id, { when: { cmp: '>', value: 1000 } });
      G.ruleCompile(rc9); G.run(0.2);
      var dsp9b = G.state().displays.filter(function (d) { return d.label === '철판수'; });
      chk('rule.displayBlanksWhenConditionFails',
        dsp9b.length === 1 && dsp9b[0].value === 0,
        '조건을 거짓으로(1000개 초과) → 표시값 ' + (dsp9b.length ? dsp9b[0].value : 'none') +
        ' (0이어야 · 조건 발생 확인)');


      // --- 문장으로 쓴 신호 버스 · 눅이기 ---------------------------------
      // 새 노드를 문장 어휘에 넣었으면, 그 문장이 **회로가 되어 세계를 움직이는지**
      // 까지 봐야 한다. 어휘표에 줄을 추가한 것만으로는 아무것도 보증되지 않는다.
      G.reset(8102); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true);
      G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
      var sbA = G.place('controller', 40, 40, 0);       // 재는 쪽
      var sbB = G.place('controller', 44, 40, 0);       // 판단하는 쪽
      var sbBox = G.place('chest', 48, 40, 0);
      var sbAsm = G.place('assembler', 52, 40, 0);
      G.setRecipe(sbAsm, 'gear');
      G.fillChest(sbBox, 'iron-plate', 80);
      // 제어기 A: "상자의 철판이 -1 이상이면 채널 C 로 그 값을 보낸다"
      G.ruleAdd(sbA, {
        when: { src: 'chest', ent: sbBox, item: 'iron-plate', cmp: '>=', value: -1 },
        then: { act: 'bus', ch: 'C' } });
      var sbCompA = G.ruleCompile(sbA);
      // 제어기 B: "채널 C 로 받은 신호가 50 미만이면 조립기를 켠다"
      G.ruleAdd(sbB, {
        when: { src: 'busIn', ch: 'C', cmp: '<', value: 50 },
        then: { act: 'run', ent: sbAsm, onWhenTrue: true } });
      var sbCompB = G.ruleCompile(sbB);
      G.run(0.2);
      var sbChan = G.bus('C');
      var sbHighOff = G.ent(sbAsm).enabled;             // 80개 → 조건 거짓 → 꺼짐
      G.fillChest(sbBox, 'iron-plate', -70);            // 10개로 떨어뜨린다
      G.run(0.2);
      var sbChan2 = G.bus('C');
      var sbLowOn = G.ent(sbAsm).enabled;               // 10개 → 조건 참 → 켜짐
      chk('rule.busCarriesValueBetweenControllers',
        sbCompA.skipped.length === 0 && sbCompB.skipped.length === 0 &&
        sbChan === 80 && sbChan2 === 10 && sbHighOff === false && sbLowOn === true,
        '문장 두 줄(보내기/받기) → 채널 C = ' + sbChan + ' (80이어야) · 철판을 10개로 → ' +
        sbChan2 + ' (10이어야) · 조립기 ' + (sbHighOff ? '켜짐' : '꺼짐') + '→' +
        (sbLowOn ? '켜짐' : '꺼짐') + ' (꺼짐→켜짐이어야 · 문장이 채널을 건너 세계를 움직였는가)');

      // 눅이기 한 단이 문장으로 걸리는가 — 계단을 넣고 τ 시점 값을 오라클과 댄다
      G.reset(8103); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
      var smC = G.place('controller', 40, 40, 0);
      var smBox = G.place('chest', 44, 40, 0);
      G.ruleAdd(smC, {
        when: { src: 'chest', ent: smBox, item: 'iron-plate', cmp: '>=', value: -1,
                math: { op: 'smooth', b: 4 } },
        then: { act: 'display', label: '눅인재고' } });
      var smComp = G.ruleCompile(smC);
      G.run(0.5);                                        // 0 에서 안정
      G.fillChest(smBox, 'iron-plate', 100);             // 계단 0 → 100
      G.run(4);                                          // t = τ
      var smAtTau = G.state().displays.filter(function (d) { return d.label === '눅인재고'; });
      var smVal = smAtTau.length ? smAtTau[0].value : -1;
      chk('rule.smoothCompilesAndFilters',
        smComp.skipped.length === 0 && Math.abs(smVal - 63.2121) < 0.5,
        '문장 "재고를 4초로 눅인 값" → 계단 0→100 후 t=τ 에서 ' + smVal.toFixed(3) +
        ' (오라클 63.21 · 100이면 눅이기가 안 걸린 것)');

      // 연구 전에는 문장이 컴파일을 거부해야 한다 — 잠긴 노드는 조용히 0 을 낸다.
      // 눅이기(평활 필터)는 논리 III 이므로 계산 한 단에도 관문이 걸려야 한다.
      G.reset(8104); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.research('logistics'); G.research('logic-mem');   // logic-ctrl 은 일부러 뺀다
      var lkC = G.place('controller', 40, 40, 0);
      G.ruleAdd(lkC, {
        when: { src: 'chest', ent: null, item: 'iron-plate', cmp: '>=', value: 0,
                math: { op: 'smooth', b: 4 } },
        then: { act: 'display', label: 'x' } });
      var lkComp = G.ruleCompile(lkC);
      var lkWhy = (G.ruleList(lkC)[0] || {}).blocked;
      G.research('logic-ctrl');
      var lkComp2 = G.ruleCompile(lkC);
      chk('rule.smoothLocksBehindResearch',
        lkComp.nodes === 0 && lkComp.skipped.length === 1 && !!lkWhy && lkComp2.nodes > 0,
        '논리 III 연구 전 눅이기 문장 → 노드 ' + lkComp.nodes + '개(0이어야) · 이유 "' +
        (lkWhy || '없음') + '" → 연구 후 노드 ' + lkComp2.nodes + '개 (조건 발생 확인)');

      // ================= 8.4 철거 환급은 단위를 지킨다 =====================
      // 터렛의 e.ammo 는 **발** 단위(탄창 1개 = 10발)인데 환급은 그 숫자를 그대로
      // 탄창으로 돌려줬다 — 철거가 10배 복사기였다. 발전기는 반대로 e.fuel 이
      // e.inv 밖에 있어 석탄이 통째로 사라졌다. 같은 뿌리(단위 불일치)의 양면이다.
      G.reset(7311); G.clearEntities(); G.clearEnemies();
      G.setInv('ammo', 0); G.giveAll(0); G.setInv('ammo', 5);
      G.research('military');
      var tu = G.place('turret', 40, 40, 0);
      G.putFromStock(tu);
      var shotsIn = G.ent(tu).ammo, ammoLeft = G.state().inventory['ammo'] || 0;
      G.remove(tu, true);
      var backAmmo = G.state().inventory['ammo'] || 0;
      chk('turret.ammoRefundKeepsUnit', shotsIn === 50 && ammoLeft === 0 && backAmmo === 5,
        '탄창 5개 투입 → 터렛 ' + shotsIn + '발(50이어야) · 철거 환급 ' + backAmmo +
        '개 (5여야 · 50이면 발을 탄창으로 돌려줘 10배 복사)');

      G.reset(7312); G.clearEntities(); G.giveAll(0); G.setInv('coal', 6);
      var gn = G.place('generator', 40, 40, 0);
      G.putFromStock(gn);
      var fuelIn = G.ent(gn).fuel, coalLeft = G.state().inventory['coal'] || 0;
      G.remove(gn, true);
      var backCoal = G.state().inventory['coal'] || 0;
      chk('generator.coalRefunded', coalLeft === 0 && fuelIn > 0 && backCoal === 6,
        '석탄 6개 투입 → 연료 ' + fuelIn + 'kJ · 철거 환급 ' + backCoal +
        '개 (6이어야 · 0이면 철거가 연료 소각기)');

      // 같은 틱에 여러 터렛이 이미 죽은 적을 계속 쏘면 탄약을 그만큼 버린다.
      // 소형 15hp = 3발이면 죽는다. 터렛 8기가 각자 쏘면 8발이 나간다.
      G.reset(7313); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.research('military');
      G.powerCheat(true);
      var tus = [];
      for (var tq = 0; tq < 8; tq++) {
        var tid = G.place('turret', 36 + tq * 3, 44, 0);
        if (tid) { G.setInv('ammo', 999); G.putFromStock(tid); tus.push(tid); }
      }
      var ammoBefore = 0;
      for (var ta = 0; ta < tus.length; ta++) ammoBefore += G.ent(tus[ta]).ammo;
      G.spawnEnemyAt(48, 44, 0);                    // 소형 1마리 = 15hp = 3발
      G.run(1.0);
      var ammoAfter = 0;
      for (var tb = 0; tb < tus.length; tb++) ammoAfter += G.ent(tus[tb]).ammo;
      var spent = ammoBefore - ammoAfter, killed = G.state().waves.killed;
      // **오라클은 정확히 3발이다** — 15hp ÷ 5dmg. 처음엔 상한을 8발로 뒀는데,
      // 고치기 전 동작(터렛 8기가 각 1발 = 8발)도 그 상한을 통과해 버려서 이 게이트가
      // 자기 버그를 못 잡았다(돌연변이 SURVIVED). 여유를 준 상한은 게이트가 아니다.
      chk('turret.noOverkillWaste', killed === 1 && spent === 3,
        '터렛 ' + tus.length + '기 · 소형 1마리 → 격추 ' + killed +
        ' · 소모 ' + spent + '발 (오라클 3발 = 15hp ÷ 5dmg · ' + tus.length +
        '발이면 터렛마다 한 발씩 쏴 이미 죽은 적에 낭비한 것)');

      // ================= 8.5 손 조립은 시간이 든다 =========================
      // 이 장르의 전제는 "손으로는 느리니까 기계를 세운다" 이다. 손 조립이 즉시
      // 완성이면 조립기가 장식이 된다 — 실제로 그랬고, 손이 조립기보다 30배 빨랐다.
      // 그래서 **음성 대조군**(아직 안 나왔어야 하는 시점)을 반드시 함께 잰다.
      G.reset(9182); G.clearEntities(); G.setInv('iron-plate', 200);
      var gearT = G.recipeInfo('gear').time;            // 0.5s
      var g0 = G.state().inventory['gear'] || 0;
      var qOk = G.handCraft('gear');
      var ironAfterQueue = G.state().inventory['iron-plate'];
      chk('hand.materialsTakenOnQueue', qOk === true && ironAfterQueue === 200 - 2,
        '대기열에 넣는 즉시 재료 차감: 철판 200 → ' + ironAfterQueue + ' (198이어야) · 대기열 ' +
        G.state().handQueue + '개');
      G.run(gearT * 0.5);
      var midN = G.state().inventory['gear'] || 0;
      G.run(gearT * 0.6 + 0.1);
      var endN = G.state().inventory['gear'] || 0;
      chk('hand.takesTime', midN === g0 && endN === g0 + 1,
        '톱니 ' + gearT + 's: 절반 시점 ' + midN + '개(안 늘어야) → 완료 후 ' + endN +
        '개 (+1이어야). 절반 시점에 이미 늘어 있으면 즉시 완성이라는 뜻이다');

      // 손은 언제나 "조립기 1대"가 한계여야 한다 — 병렬로 처리되면 안 된다
      var b0 = G.state().inventory['gear'] || 0;
      for (var hq = 0; hq < 5; hq++) G.handCraft('gear');
      G.run(gearT * 2 + 0.05);                          // 2개 분량만 지났다
      var got2 = (G.state().inventory['gear'] || 0) - b0;
      chk('hand.oneAtATime', got2 === 2,
        '5개 예약 후 ' + (gearT * 2).toFixed(1) + 's 경과 → ' + got2 +
        '개 완성 (오라클 2개 = 순차 처리). 5개면 병렬이라 손이 무한 공장이 된다 · 남은 대기열 ' +
        G.state().handQueue);

      // 취소는 재료를 돌려준다 — 안 그러면 잘못 누른 클릭이 아이템 소각이 된다
      G.reset(9183); G.clearEntities(); G.setInv('iron-plate', 50);
      G.handCraft('gear');
      var beforeCancel = G.state().inventory['iron-plate'];
      var cOk = G.handCancel(0);
      var afterCancel = G.state().inventory['iron-plate'];
      chk('hand.cancelRefunds', cOk === true && beforeCancel === 48 && afterCancel === 50 &&
          G.state().handQueue === 0,
        '예약 후 철판 ' + beforeCancel + ' → 취소 후 ' + afterCancel +
        ' (48 → 50 이어야) · 대기열 ' + G.state().handQueue + '개');
      chk('hand.cancelRejectsBadIndex', G.handCancel(7) === false,
        '없는 항목 취소 → false (true 면 빈 대기열에서도 재료가 나온다)');

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

      // ================= 11.5 유체 — 물·증기 =============================
      // 오라클은 SPEC 의 Factorio 값 넷이고, 그것들이 **하나의 항등식**으로 묶여
      // 있다: 보일러 1800 kW ÷ 60 증기/s = 30 kJ/증기 = 900 kW ÷ 30 증기/s.
      // 그래서 "증기 1개 = 30 kJ" 를 양쪽에서 따로 재고 서로 대조한다.
      function fluidRig(seed) {
        G.reset(seed); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
        G.research('logistics'); G.research('steel');
        var r = {};
        r.pump = G.place('pump', 40, 40, 0);
        r.pipeA = G.place('pipe', 41, 40, 0);
        r.boiler = G.place('boiler', 42, 40, 0);     // 2x2 → x 42..43
        r.pipeB = G.place('pipe', 44, 40, 0);
        r.engine = G.place('engine', 45, 40, 0);     // 3x2 → x 45..47
        // 전주 — 증기기관도 **전력망에 붙어야** 공급으로 잡힌다(발전기와 같다).
        // 처음엔 빼놓고 재다가 '공급 0' 을 코드 탓으로 오해했다.
        r.pole = G.place('pole', 46, 42, 0);
        return r;
      }
      var fr = fluidRig(8200);
      chk('fluid.rigBuilt',
        !!fr.pump && !!fr.pipeA && !!fr.boiler && !!fr.pipeB && !!fr.engine &&
        G.fluid(fr.pump).connected === 1 && G.fluidNetCount() === 1,
        '펌프·파이프·보일러·파이프·증기기관을 맞대어 배치 → 유체망 ' + G.fluidNetCount() +
        '개 (1이어야 · 맞닿음이 곧 연결이다) · 용량 ' + G.fluid(fr.pump).cap +
        ' (13칸 × 100 = 1300 이어야)');

      // 펌프 처리량 — 0.1초에 120. 용량(1300)보다 훨씬 작게 재야 '상한'이 아니라
      // '속도'를 재는 것이 된다.
      G.run(0.1);
      var fPumped = G.fluid(fr.pump).water;
      chk('fluid.pumpRateMatchesSpec',
        Math.abs(fPumped - 120) < 2,
        '0.1초 → 물 ' + fPumped.toFixed(1) + ' (오라클 1200/s × 0.1s = 120)');

      // 보일러 — 석탄을 주면 물 60/s 를 증기 60/s 로 바꾸고 1800 kW 를 태운다.
      // 세 축(물 감소·증기 증가·연료 감소)을 **동시에** 재야 한 축만 맞는 구현이 걸린다.
      G.putFromStock(fr.boiler);                     // 석탄이 들어간다
      G.run(0.5);                                    // 정상 운전에 들기
      var b0 = { s: G.fluid(fr.boiler).steam, f: G.ent(fr.boiler).fuel, w: G.fluid(fr.boiler).water };
      G.run(1);
      var b1 = { s: G.fluid(fr.boiler).steam, f: G.ent(fr.boiler).fuel, w: G.fluid(fr.boiler).water };
      var dS = b1.s - b0.s, dF = b0.f - b1.f, dW = b1.w - b0.w;
      // 물은 펌프가 계속 채우므로 증가할 수도 있다 — 여기서 재는 것은 증기와 연료다.
      chk('fluid.boilerRateAndFuelMatchSpec',
        Math.abs(dS - 60) < 2 && Math.abs(dF - 1800) < 60,
        '1초 → 증기 +' + dS.toFixed(1) + ' (오라클 60) · 연료 -' + dF.toFixed(0) +
        ' kJ (오라클 1800) · 물 ' + (dW >= 0 ? '+' : '') + dW.toFixed(1) + ' (펌프가 채운다)');
      chk('fluid.energyPerSteamIsThirty',
        dS > 1 && Math.abs(dF / dS - 30) < 1,
        '태운 에너지 ÷ 만든 증기 = ' + (dF / dS).toFixed(2) +
        ' kJ/증기 (오라클 30 · 1800÷60 과 900÷30 이 같은 수여야 한다)');

      // 증기기관 — 증기가 있으면 900 kW 를 공급한다.
      var eng0 = G.state().power.supply;
      chk('fluid.engineSuppliesSpecPower',
        Math.abs(eng0 - SP.engineKw) < 1,
        '증기가 있는 증기기관 1대 → 공급 ' + eng0 + ' kW (오라클 900)');

      // 부하를 걸면 증기를 30/s 로 뽑는다. 인서터 70대 = 910 kW 로 공급을 넘긴다.
      // **전주를 먼저 깐다** — 인서터를 먼저 깔았더니 전주 자리를 차지해 전주가
      // 하나도 안 서고, 수요 0 이 나왔다. 그때 "코드가 수요를 안 센다"로 오해했다.
      var fpo = 0;
      for (var fp = 0; fp < 8; fp++) if (G.place('pole', 21 + fp * 5, 59, 0)) fpo++;
      // 증기기관 쪽 망과 이어 준다 (전주 사거리 7.5)
      for (var fp2 = 0; fp2 < 4; fp2++) G.place('pole', 46, 47 + fp2 * 4, 0);
      G.place('pole', 46, 59, 0); G.place('pole', 52, 59, 0);
      var insN = 0;
      for (var fi2 = 0; fi2 < 70; fi2++) {
        if (G.place('inserter', 20 + (fi2 % 35), 60 + Math.floor(fi2 / 35), 1)) insN++;
      }
      G.run(0.3);
      var s0 = G.fluid(fr.engine).steam;
      G.run(1);
      var s1 = G.fluid(fr.engine).steam;
      var st = G.state();
      // 보일러가 동시에 증기를 만들고 있으므로 순증감이 아니라 **소비량**을 본다:
      // 소비 = 생산(60/s) - 순증가.
      var consumed = 60 - (s1 - s0);
      chk('fluid.engineDrawsSteamAtSpec',
        st.power.demand > SP.engineKw && Math.abs(consumed - 30) < 3,
        '수요 ' + Math.round(st.power.demand) + ' kW (인서터 ' + insN + '대) → 증기 소비 ' +
        consumed.toFixed(1) + '/s (오라클 30 · 900kW ÷ 30kJ)');

      // **버퍼가 실제로 버티는가.** 석탄이 떨어져도 파이프에 고인 증기로 잠시 간다 —
      // 이 계를 넣은 이유가 그것이다.
      //
      // 처음에는 `G.ent(보일러).fuel = 0` 으로 연료를 끊으려 했다. **G.ent 는 사본을
      // 돌려준다** — 그 대입은 아무 데도 안 갔고, 보일러는 계속 태우고 있었다.
      // 게이트는 통과했지만 '연료가 끊긴 적이 없는' 통과였다(거짓 GREEN). 음성
      // 대조군이 FAIL 로 나와서야 들켰다. 이제는 석탄 1개(4000 kJ)만 넣고 **실제로
      // 바닥나기를 기다린다** — 시험용 setter 를 새로 만들지 않는다.
      var fr2 = fluidRig(8201);
      // putFromStock 은 **받을 수 있는 만큼 다 넣는다** (석탄 20개 = 80,000 kJ).
      // 그러면 증기가 용량까지 차서 보일러가 멈추고, 연료는 영영 안 마른다.
      // 보유 재고를 1개로 깎아 정확히 4000 kJ 만 넣는다.
      G.setInv('coal', 1);
      G.putFromStock(fr2.boiler);                    // 석탄 1개 = 4000 kJ = 2.22초분
      G.run(3);                                      // 다 태우고도 남을 시간
      var fuelLeft = G.ent(fr2.boiler).fuel;
      var bufSteam = G.fluid(fr2.engine).steam;
      G.run(0.5);
      var stillUp = G.state().power.supply;
      chk('fluid.steamBuffersFuelOutage',
        fuelLeft === 0 && bufSteam > 30 && stillUp === SP.engineKw,
        '연료 소진 확인(' + fuelLeft + ' kJ) · 남은 증기 ' + bufSteam.toFixed(0) +
        ' → 0.5초 뒤 공급 ' + stillUp + ' kW (버퍼가 없으면 즉시 0 이다)');

      // 음성 대조군 — 석탄을 한 번도 안 준 판에서는 공급이 0 이어야 한다.
      // 이게 없으면 위 검사는 "공급은 언제나 900" 인 구현도 통과시킨다.
      var fr2b = fluidRig(8206);                     // 석탄을 주지 않는다
      G.run(1);
      var dryUp = G.state().power.supply;
      var drySteam = G.fluid(fr2b.engine).steam;
      chk('fluid.noSteamNoPower', dryUp === 0 && drySteam === 0,
        '석탄을 안 준 판: 증기 ' + drySteam.toFixed(1) + ' · 공급 ' + dryUp +
        ' kW (둘 다 0이어야 · 조건 발생 확인)');

      // 파이프 한 칸을 빼면 망이 갈린다. 맞닿음이 규칙이라는 것을 값으로 못 박는다.
      var fr3 = fluidRig(8202);
      var netsBefore = G.fluidNetCount();
      G.remove(fr3.pipeB, false);
      G.run(0.05);
      var netsAfter = G.fluidNetCount();
      chk('fluid.removingPipeSplitsNet',
        netsBefore === 1 && netsAfter === 2,
        '파이프 한 칸 철거 → 망 ' + netsBefore + '개 → ' + netsAfter +
        '개 (2여야 · 안 갈리면 지운 파이프가 계속 잇고 있는 것)');

      // 저장은 파이프에 고인 유체를 들고 가야 한다. 안 담으면 불러온 순간
      // 버퍼가 통째로 사라져 발전이 한 박자 멈춘다.
      var fr4 = fluidRig(8203);
      G.putFromStock(fr4.boiler);
      G.run(2);
      var beforeSave = G.fluid(fr4.engine).steam;
      var rawF = G.saveRaw(); G.load(rawF); G.run(0.02);
      var afterLoad = G.fluid(fr4.engine).steam;
      chk('fluid.survivesSave',
        beforeSave > 10 && Math.abs(afterLoad - beforeSave) < 3,
        '저장 전 증기 ' + beforeSave.toFixed(1) + ' → 복원 후 ' + afterLoad.toFixed(1) +
        ' (같아야 · 0이면 버퍼가 저장에 안 담긴 것)');

      // dt 를 곱했는가 — 같은 게임시간을 다르게 쪼개도 같은 값이어야 한다.
      // 유체는 매 틱 누적이라 여기가 60배 함정의 자리다 (교훈 03).
      function steamAfter1s(seed, big) {
        var r = fluidRig(seed);
        G.putFromStock(r.boiler);
        G.tickOnce();
        var base = G.fluid(r.boiler).steam;
        if (big) { for (var q = 0; q < 4; q++) G.tickWith(0.25); }
        else G.run(1);
        return G.fluid(r.boiler).steam - base;
      }
      var fFine = steamAfter1s(8204, false);
      var fCoarse = steamAfter1s(8205, true);
      chk('fluid.dtInvariant',
        Math.abs(fFine - fCoarse) < 0.5 && Math.abs(fFine - 60) < 2,
        '1초를 60틱으로 → 증기 +' + fFine.toFixed(2) + ' · 4틱으로 → +' + fCoarse.toFixed(2) +
        ' (둘 다 60이어야 · 다르면 dt 를 안 곱한 것)');

      // **이 계를 넣은 이유를 값으로 못 박는다.** 증기%는 전력 만족도보다 *먼저*
      // 떨어져야 한다 — 그래야 "모자란 뒤에 끄기"가 아니라 "마르기 전에 끄기"가
      // 성립한다. 먼저 떨어지지 않으면 이 계는 복잡도만 늘린 것이다.
      var fr5 = fluidRig(8207);
      G.setInv('coal', 1);
      G.putFromStock(fr5.boiler);
      G.run(2);                                       // 증기를 모은다
      // 전주를 먼저 깔고 인서터로 공급(900)을 넘는 수요를 만든다
      for (var lp = 0; lp < 8; lp++) G.place('pole', 21 + lp * 5, 59, 0);
      for (var lp2 = 0; lp2 < 4; lp2++) G.place('pole', 46, 47 + lp2 * 4, 0);
      G.place('pole', 46, 59, 0); G.place('pole', 52, 59, 0);
      // 수요는 공급(900)보다 **조금 낮게** 둔다. 넘겨 버리면 전기가 처음부터
      // 모자라서(sat 99%) '증기가 먼저 준다'를 보일 수가 없다 — 처음에 70대를
      // 놓고 그렇게 됐다. 66대 × 13 kW = 858 kW.
      var linsN = 0;
      for (var li = 0; li < 66; li++) {
        if (G.place('inserter', 20 + (li % 33), 60 + Math.floor(li / 33), 1)) linsN++;
      }
      G.run(0.2);
      var demand0 = G.state().power.demand, sat0 = G.state().power.sat;
      var leadPct = -1, leadSat = -1, dryPct = -1, drySat = -1;
      for (var lt = 0; lt < 900; lt++) {              // 15초를 틱 단위로 지켜본다
        G.tickOnce();
        var fnow = G.fluid(fr5.engine);
        var snow = G.state().power.sat;
        // 증기가 절반 아래로 내려간 첫 순간 — 전기는 아직 멀쩡한가?
        if (leadPct < 0 && fnow.steamPct < 50) { leadPct = fnow.steamPct; leadSat = snow; }
        // 전기가 처음 무너진 순간 — 그때 증기는 이미 얼마나 남았나?
        if (drySat < 0 && snow < 0.999) { drySat = snow; dryPct = fnow.steamPct; }
      }
      chk('fluid.steamLeadsPowerAsIndicator',
        demand0 > 700 && demand0 < 900 && sat0 >= 0.999 &&
        leadSat >= 0.999 && drySat >= 0 && dryPct < 5,
        '수요 ' + Math.round(demand0) + ' kW < 공급 900 (조건 발생 확인) · 증기가 50% 아래로 내려간 ' +
        '순간 전력 ' + Math.round(leadSat * 100) + '% (100이어야 — 증기가 먼저 준다) · ' +
        '전력이 처음 무너진 순간의 증기 ' + (dryPct < 0 ? '안 무너짐' : dryPct.toFixed(1) + '%') +
        ' (거의 0이어야 — 전기는 맨 나중에 안다)');

      // 제어기가 그 지표를 읽을 수 있어야 쓸모가 있다 — 노드로도, 문장으로도.
      var fc = G.place('controller', 50, 44, 0);
      var fn1 = G.gAdd(fc, 'fluid', 10, 10); G.gCfg(fc, fn1, 'ent', fr5.engine);
      G.run(0.05);
      var fRead = { pct: G.gOut(fc, fn1, 0), steam: G.gOut(fc, fn1, 1),
                    water: G.gOut(fc, fn1, 2), conn: G.gOut(fc, fn1, 3) };
      var fTrue = G.fluid(fr5.engine);
      chk('fluid.sensorReadsTheNet',
        // 한 틱 지연이 정상이다 — 로직이 유체보다 먼저 돈다(틱 순서 규약)
        fRead.conn === 1 && Math.abs(fRead.steam - fTrue.steam) <= 1.5 &&
        Math.abs(fRead.pct - fTrue.steamPct) <= 0.3 && fRead.water >= 0,
        '유체 센서 → 증기 ' + fRead.steam.toFixed(1) + ' (실제 ' + fTrue.steam.toFixed(1) +
        ') · ' + fRead.pct.toFixed(1) + '% · 망연결 ' + fRead.conn);

      // 음성 대조군 — 대상을 안 고르면 0 이고 망연결도 0 이어야 한다. 0 과
      // '망 밖'을 같은 값으로 뭉치면 플레이어가 원인을 못 짚는다.
      var fn2 = G.gAdd(fc, 'fluid', 10, 300);
      G.run(0.05);
      chk('fluid.sensorSaysDisconnected',
        G.gOut(fc, fn2, 3) === 0 && G.gOut(fc, fn2, 1) === 0,
        '대상 미지정 센서 → 망연결 ' + G.gOut(fc, fn2, 3) + ' · 증기 ' + G.gOut(fc, fn2, 1) +
        ' (둘 다 0이어야 · 조건 발생 확인)');

      // 문장으로도 같은 것을 쓸 수 있는가 — 카드가 있는데 컴파일이 안 되면 그 카드는 거짓말이다
      var fsC = G.place('controller', 54, 44, 0);
      var fsAsm = G.place('assembler', 56, 48, 0);
      G.setRecipe(fsAsm, 'gear');
      G.ruleAdd(fsC, {
        when: { src: 'steamPct', ent: fr5.engine, cmp: '<', value: 30 },
        then: { act: 'run', ent: fsAsm, onWhenTrue: false } });
      var fsComp = G.ruleCompile(fsC);
      G.run(0.2);
      chk('fluid.sentenceCanReadSteam',
        fsComp.skipped.length === 0 && fsComp.nodes >= 3 &&
        (G.gKinds(fsC) || []).indexOf('fluid') >= 0,
        '문장 "증기 잔량이 30% 미만이면 조립기를 끈다" → 노드 ' + fsComp.nodes +
        '개 · 건너뜀 ' + fsComp.skipped.length + ' · 유체 노드 포함 ' +
        ((G.gKinds(fsC) || []).indexOf('fluid') >= 0));

      // ================= 11.7 청사진 =====================================
      // 이 기능의 값은 **배선이 따라오는가**에 있다. 벨트만 복사하는 것은 편의지만,
      // 제어기의 규칙·그래프가 새 대상으로 갈아 끼워진 채 따라오면 "잘 도는 라인"을
      // 통째로 늘릴 수 있다. 그래서 게이트도 거기에 건다.
      G.reset(8300); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true); G.research('logistics'); G.research('logic-mem');
      var bpBox = G.place('chest', 40, 40, 0);
      var bpAsm = G.place('assembler', 42, 40, 0);
      G.setRecipe(bpAsm, 'gear');
      var bpCtl = G.place('controller', 40, 42, 0);
      // "상자의 철판이 50 미만이면 조립기를 켠다" — 문장으로 만든 회로
      G.ruleAdd(bpCtl, { name: '철판부족',
        when: { src: 'chest', ent: bpBox, item: 'iron-plate', cmp: '<', value: 50 },
        then: { act: 'run', ent: bpAsm, onWhenTrue: true } });
      G.ruleCompile(bpCtl);
      // 영역 밖 대상을 가리키는 두 번째 규칙 — 붙여넣으면 **끊겨야** 한다
      var bpOutside = G.place('lab', 50, 50, 0);
      G.ruleAdd(bpCtl, {
        when: { src: 'chest', ent: bpBox, item: 'iron-plate', cmp: '>', value: 999 },
        then: { act: 'run', ent: bpOutside, onWhenTrue: false } });
      G.ruleCompile(bpCtl);
      // **경계에 걸치는 건물을 일부러 하나 둔다.** 처음엔 영역 밖 연구소만 두고
      // "안 담긴다"를 확인했는데, 그건 스캔이 영역 안 타일만 훑으니 당연한 것이라
      // 아무것도 검사하지 않았다 — '걸친 것도 담는' 돌연변이가 그대로 살아남았다.
      // 걸친 것이 있어야 '완전히 들어온 것만' 이라는 규칙이 실제로 재진다.
      var bpEdge = G.place('assembler', 44, 44, 0);    // 44..46 → (45,45) 경계를 넘는다
      var bpCap = G.bpCapture(39, 39, 45, 45);
      chk('bp.capturesWholeBuildingsOnly',
        bpCap.count === 3 && !!bpEdge && G.bpInfo().types.indexOf('lab') < 0,
        '영역(39,39)-(45,45) 캡처 → ' + bpCap.count + '개 (상자·조립기·제어기 = 3) · ' +
        '경계에 걸친 조립기(44,44~46,46) 제외 확인 · 영역 밖 연구소 포함 ' +
        (G.bpInfo().types.indexOf('lab') >= 0) + ' (false 여야)');

      // 붙여넣기는 **플레이어와 같은 길**로 짓는다 — 재료가 실제로 나가야 한다
      var costBefore = G.state().inventory['iron-plate'] || 0;
      var bpRes = G.bpPaste(60, 60);
      var costAfter = G.state().inventory['iron-plate'] || 0;
      var bpCost = G.bpInfo().cost['iron-plate'] || 0;
      chk('bp.pasteChargesMaterials',
        bpRes.placed === 3 && bpRes.skipped === 0 && (costBefore - costAfter) === bpCost,
        '붙여넣기 ' + bpRes.placed + '개(건너뜀 ' + bpRes.skipped + ') · 철판 ' + costBefore +
        ' → ' + costAfter + ' (청사진 원가 ' + bpCost + '만큼 나가야 · 공짜면 치트다)');

      // **배선이 따라왔는가** — 사본 제어기가 사본 조립기를 지배해야 한다
      // 청사진 원점은 선택 영역의 좌상단(39,39)이다. 상자는 그 안에서 (+1,+1) 이므로
      // (60,60) 에 붙여넣으면 상자는 (61,61) 에 선다 — 처음에 (60,60) 으로 찾다가
      // null 을 만져 드라이버가 죽었다.
      var newBox = G.entAtTile(61, 61), newAsm = G.entAtTile(63, 61), newCtl = G.entAtTile(61, 63);
      // **'켜져 있다'로는 아무것도 증명 못 한다.** 기계의 기본값이 켜짐이라, 참조가
      // 통째로 끊긴 사본도 '켜짐'으로 통과한다(돌연변이 MISS 로 확인). 그래서
      // 사본을 **끄게** 만든다 — 참조가 끊겼으면 절대 못 끄는 상태다.
      // 지배 중(logicForced)까지 함께 단언한다.
      G.fillChest(newBox, 'iron-plate', 500);     // 사본 상자를 채워 조건을 거짓으로 → 꺼져야
      G.fillChest(bpBox, 'iron-plate', 10);       // 원본 상자는 비워 → 원본은 켜져야
      G.run(0.3);
      var newAsmOn = G.ent(newAsm).enabled, oldAsmOn = G.ent(bpAsm).enabled;
      var newForced = G.ent(newAsm).logicForced;
      chk('bp.wiringFollowsAndRetargets',
        !!newBox && !!newAsm && !!newCtl && newForced === true &&
        newAsmOn === false && oldAsmOn === true,
        '사본 상자 500개 → 사본 조립기 ' + (newAsmOn ? '켜짐' : '꺼짐') + '(꺼져야) · 지배중 ' +
        newForced + '(true 여야 · 참조가 끊기면 끌 수가 없다) · 원본 상자 10개 → 원본 조립기 ' +
        (oldAsmOn ? '켜짐' : '꺼짐') + '(켜져야 · 사본이 원본을 지배하면 여기가 뒤집힌다)');

      // 영역 밖을 가리키던 규칙은 끊겨야 한다. 안 끊으면 붙여넣은 사본이 남의
      // 기계를 지배하고, 플레이어는 왜 멈췄는지 짚을 수 없다.
      var newRules = G.ruleList(newCtl) || [];
      var outsideRef = newRules.length > 1 ? newRules[1].sentence : '';
      G.fillChest(newBox, 'iron-plate', 1500);    // 두 번째 규칙(>999)을 참으로
      G.run(0.3);
      chk('bp.outsideReferencesAreCut',
        newRules.length === 2 && outsideRef.indexOf('대상 고르기') >= 0 &&
        G.ent(bpOutside).enabled === true,
        '사본의 둘째 규칙 문장 "' + outsideRef.slice(-28) + '" (대상이 비어야) · ' +
        '영역 밖 연구소 ' + (G.ent(bpOutside).enabled ? '켜짐' : '꺼짐') +
        ' (켜져 있어야 · 사본이 원본 밖을 끄면 실패)');

      // **복제기가 아니다** — 내용물은 안 따라온다. 따라오면 청사진 한 번에
      // 벨트 위 아이템과 상자 재고가 공짜로 늘어난다.
      var srcContents = G.ent(bpBox).inv['iron-plate'] || 0;
      var dstContents = G.ent(newBox).inv['iron-plate'] || 0;
      G.bpClear();
      var bp2 = G.bpCapture(39, 39, 45, 45);
      var invBefore2 = G.state().inventory['iron-plate'] || 0;
      G.bpPaste(70, 70);
      var newBox2 = G.entAtTile(71, 71);
      chk('bp.doesNotCopyContents',
        bp2.count === 3 && srcContents > 0 && dstContents > 0 &&
        (G.ent(newBox2).inv['iron-plate'] || 0) === 0,
        '원본 상자 ' + srcContents + '개 · 새로 붙여넣은 상자 ' +
        (G.ent(newBox2).inv['iron-plate'] || 0) + '개 (0이어야 · 내용물이 따라오면 복제기다) · ' +
        '보유 철판은 원가만큼만 줄었다(' + invBefore2 + ' → ' +
        (G.state().inventory['iron-plate'] || 0) + ')');

      // 막힌 칸은 그 항목만 건너뛰고 나머지를 짓는다. 전부-아니면-전무면 큰
      // 청사진이 한 칸 때문에 영영 안 붙는다.
      G.place('wall', 81, 81, 0);                 // 상자가 설 자리(원점+1,+1)를 막는다
      var bpRes3 = G.bpPaste(80, 80);
      chk('bp.skipsBlockedTilesAndReports',
        bpRes3.placed === 2 && bpRes3.skipped === 1 && !!bpRes3.why,
        '한 칸을 벽으로 막고 붙여넣기 → 지음 ' + bpRes3.placed + ' · 건너뜀 ' +
        bpRes3.skipped + ' · 이유 "' + (bpRes3.why || '없음') + '" (이유를 안 돌려주면 왜 안 붙었는지 모른다)');

      // 재료가 없으면 아무것도 안 지어진다 — 음성 대조군. 이게 없으면 위 검사들은
      // "언제나 지어진다"는 구현도 통과시킨다.
      G.setInv('iron-plate', 0); G.setInv('gear', 0); G.setInv('circuit', 0);
      var bpRes4 = G.bpPaste(90, 90);
      chk('bp.poorPasteBuildsNothing',
        bpRes4.placed === 0 && bpRes4.skipped === 3,
        '재료를 0으로 만든 뒤 붙여넣기 → 지음 ' + bpRes4.placed + ' · 건너뜀 ' +
        bpRes4.skipped + ' (조건 발생 확인)');

      // 저장에 실려야 한다 — 저장 한 번에 사라지면 "만들어 두고 늘리기"가 성립하지 않는다
      var bpRaw = G.saveRaw(); G.load(bpRaw);
      var bpAfter = G.bpInfo();
      chk('bp.survivesSave',
        !!bpAfter && bpAfter.count === 3 && bpAfter.w === 7 && bpAfter.h === 7,
        '저장→복원 후 청사진 ' + (bpAfter ? bpAfter.count + '개 · ' + bpAfter.w + 'x' + bpAfter.h : '없음') +
        ' (3개 7x7 이어야)');

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
