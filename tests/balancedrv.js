// ===========================================================================
//  밸런스/페이싱 측정 드라이버 — "재미"는 못 재지만 "말이 되는 속도인가"는 잰다.
//
//  재는 것:
//   · 진화도와 오염이 시간에 따라 어떻게 오르나
//   · 첫 습격파가 언제 뜨고, 적이 언제 처음 공장에 닿나
//   · 그때까지 군수 연구(터렛 해금)를 끝낼 수 있나  ← 공정성의 핵심 질문
//   · 발전기 1대가 몇 대의 기계를 감당하나
//   · 시작 광맥이 얼마나 버티나
//
//  모델링 가정(사용자가 검수할 수 있게 명시한다):
//   기계는 "잘 지어진 공장"을 가정해 굶지 않도록 입력 버퍼를 주기적으로 채운다.
//   벨트 배선 실수로 인한 정체는 모델에 없다. 즉 여기서 나오는 오염·진화 속도는
//   **실제 플레이의 상한**이다(가장 빨리 진화하는 경우).
// ===========================================================================
(function () {
  var G, out = { samples: [], marks: {}, scenarios: {}, errors: [], fatal: null, assumptions: [] };

  function emit() {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(out) + '@@JSON_END@@';
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // 대표적인 초반 공장 — 5~8분쯤의 숙련 플레이어 규모
  function buildReferenceFactory(opt) {
    opt = opt || {};
    G.reset(424242);
    G.clearEntities();
    G.giveAll(99999);
    G.powerCheat(false);          // 전력은 진짜로 돌린다 — 오염의 주범이 발전기다

    var machines = { miner: [], furnace: [], assembler: [], lab: [], gen: [] };

    // 전주 격자 (5의 배수 격자점) — 건물은 5k+1 에서 3칸 이하라 절대 안 겹친다
    for (var y = 60; y <= 100; y += 5) for (var x = 60; x <= 100; x += 5) G.place('pole', x, y, 0);

    // 발전기
    var nGen = opt.gens || 2;
    for (var g = 0; g < nGen; g++) {
      var sg = slot(g);
      var gid = G.place('generator', sg[0], sg[1], 0);
      if (gid) { G.setFuel(gid, 4000 * 100000); machines.gen.push(gid); }
    }
    // 채광기 — 실제 광맥 위에 놓아야 하므로 스폰 주변에서 찾는다
    var ores = ['iron-ore', 'iron-ore', 'copper-ore', 'coal', 'coal'];
    for (var m = 0; m < (opt.miners || 5); m++) {
      var sp = G.oreSpotNear(ores[m % ores.length], 80, 80);
      if (!sp) continue;
      var mid = G.place('miner', sp.x, sp.y, 1);
      if (mid) machines.miner.push(mid);
    }
    // 전주로 채광기까지 전기를 보낸다
    for (var mm = 0; mm < machines.miner.length; mm++) {
      var me = G.ent(machines.miner[mm]);
      if (me && me.net < 0) {
        G.place('pole', me.tx + 2, me.ty, 0);
        G.place('pole', me.tx - 1, me.ty + 2, 0);
      }
    }
    // 용광로 / 조립기 / 연구소
    var si = nGen;
    for (var f = 0; f < (opt.furnaces || 6); f++) {
      var sf = slot(si++);
      var fid = G.place('furnace', sf[0], sf[1], 1);
      if (fid) machines.furnace.push(fid);
    }
    for (var a = 0; a < (opt.assemblers || 3); a++) {
      var sa = slot(si++);
      var aid = G.place('assembler', sa[0], sa[1], 1);
      if (aid) { G.setRecipe(aid, a === 0 ? 'sci-red' : 'gear'); machines.assembler.push(aid); }
    }
    for (var l = 0; l < (opt.labs || 1); l++) {
      var sl = slot(si++);
      var lid = G.place('lab', sl[0], sl[1], 1);
      if (lid) machines.lab.push(lid);
    }
    // 방어 (시나리오에 따라)
    machines.turret = [];
    if (opt.turrets) {
      G.research('military');
      for (var t = 0; t < opt.turrets; t++) {
        var st = slot(si++);
        var tid = G.place('turret', st[0], st[1], 1);
        if (tid) { G.setAmmo(tid, 400); machines.turret.push(tid); }
      }
    }
    return machines;
  }

  // 전주 격자를 안 밟는 3x3 자리
  var P0 = 61, PN = 8;
  function slot(i) {
    var k = i % PN, m = Math.floor(i / PN) % PN;
    return [P0 + k * 5, P0 + m * 5];
  }

  // 굶지 않게 입력 버퍼를 채운다 (= 잘 배선된 공장 가정)
  function feed(mc) {
    for (var i = 0; i < mc.furnace.length; i++) {
      var f = G.ent(mc.furnace[i]);
      if (!f) continue;
      if (!f.recipe) G.setRecipe(mc.furnace[i], 'iron-plate');
      if ((f.inv['iron-ore'] || 0) < 20) G.fillChest(mc.furnace[i], 'iron-ore', 30);
      G.clearOut(mc.furnace[i]);
    }
    for (var j = 0; j < mc.assembler.length; j++) {
      var a = G.ent(mc.assembler[j]);
      if (!a) continue;
      if ((a.inv['iron-plate'] || 0) < 20) G.fillChest(mc.assembler[j], 'iron-plate', 40);
      if ((a.inv['copper-plate'] || 0) < 20) G.fillChest(mc.assembler[j], 'copper-plate', 40);
      if ((a.inv['gear'] || 0) < 20) G.fillChest(mc.assembler[j], 'gear', 40);
      G.clearOut(mc.assembler[j]);
    }
    for (var k = 0; k < mc.lab.length; k++) {
      var lb = G.ent(mc.lab[k]);
      if (!lb) continue;
      if ((lb.inv['sci-red'] || 0) < 5) G.fillChest(mc.lab[k], 'sci-red', 20);
      if ((lb.inv['sci-green'] || 0) < 5) G.fillChest(mc.lab[k], 'sci-green', 20);
    }
    for (var t = 0; t < (mc.turret || []).length; t++) {
      var tu = G.ent(mc.turret[t]);
      if (tu && tu.ammo < 100) G.setAmmo(mc.turret[t], 400);
    }
  }

  function nearestEnemyDist() {
    var ps = G.enemyPositions();
    if (!ps.length) return null;
    var best = 1e9;
    for (var i = 0; i < ps.length; i++) {
      var d = Math.sqrt(Math.pow(ps[i][0] - 80, 2) + Math.pow(ps[i][1] - 80, 2));
      if (d < best) best = d;
    }
    return Math.round(best * 10) / 10;
  }

  // 시나리오 한 판을 돌리며 1분 간격으로 표본을 뜬다
  function runScenario(name, opt, minutes) {
    var mc = buildReferenceFactory(opt);
    if (opt.research) G.setResearch(opt.research);
    var samples = [], marks = {};
    var prevWaves = 0, prevResearch = [];
    for (var min = 1; min <= minutes; min++) {
      // 1분을 10초씩 쪼개 돌리며 그때그때 먹인다
      for (var s = 0; s < 6; s++) { feed(mc); G.run(10); }
      var st = G.state();
      var nd = nearestEnemyDist();
      samples.push({
        t: min,
        evo: Math.round(st.evolution * 1000) / 10,
        poll: r2(st.pollution),
        pollTotal: r2(st.totalPollution),
        enemies: st.enemies,
        waves: st.waves.waves,
        spawned: st.waves.spawned,
        lost: st.waves.lost,
        nearest: nd,
        sat: Math.round(st.power.sat * 100),
        demand: Math.round(st.power.demand),
        supply: Math.round(st.power.supply),
        done: st.research.done.length,
        cur: st.research.current,
        curFrac: Math.round(st.research.frac * 100)
      });
      if (!marks.firstWave && st.waves.waves > prevWaves) marks.firstWave = min;
      if (!marks.firstContact && nd !== null && nd < 12) marks.firstContact = min;
      if (!marks.firstLoss && st.waves.lost > 0) marks.firstLoss = min;
      // 연구가 끝나면 다음 것을 자동으로 건다 (플레이어가 계속 연구한다고 가정)
      if (!st.research.current) {
        var order = ['military', 'logistics', 'logic-mem', 'steel', 'logic-ctrl', 'defense-ai'];
        for (var o = 0; o < order.length; o++) {
          if (st.research.done.indexOf(order[o]) < 0) { if (G.setResearch(order[o])) break; }
        }
      }
      for (var d = 0; d < st.research.done.length; d++) {
        var tid = st.research.done[d];
        if (prevResearch.indexOf(tid) < 0) marks['tech_' + tid] = min;
      }
      prevResearch = st.research.done.slice();
      prevWaves = st.waves.waves;
    }
    out.scenarios[name] = { samples: samples, marks: marks, machines: {
      miner: mc.miner.length, furnace: mc.furnace.length, assembler: mc.assembler.length,
      lab: mc.lab.length, gen: mc.gen.length, turret: (mc.turret || []).length
    } };
    return { samples: samples, marks: marks };
  }

  function run() {
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(); return; }
      G = window.__GAME;
      out.version = G.version;
      out.assumptions = [
        '기계 입력 버퍼를 10초마다 채워 굶주림을 없앤다 = 배선이 완벽한 공장. 따라서 오염·진화 속도는 실제 플레이의 상한이다.',
        '기계 출력 버퍼를 비워 상한에 걸려 멈추는 것을 막는다 (하류가 계속 빼간다고 가정).',
        '연구는 끊기지 않고 이어서 건다 (군수 → 물류 → 논리II → 강철 → 논리III → 방어자동화).',
        '광맥 고갈은 별도 시나리오에서만 잰다. 본 시나리오의 채광기는 실제 광맥 위에 있으므로 고갈되면 오염이 저절로 준다.'
      ];

      // --- 시나리오 A: 무방비 공장 30분 -------------------------------------
      runScenario('A_무방비', { gens: 2, miners: 5, furnaces: 6, assemblers: 3, labs: 1, research: 'military' }, 30);

      // --- 시나리오 B: 터렛 6대를 갖춘 같은 공장 30분 -------------------------
      runScenario('B_방어', { gens: 2, miners: 5, furnaces: 6, assemblers: 3, labs: 1, turrets: 6, research: 'military' }, 30);

      // --- 시나리오 C: 대형 공장(오염 2배) 20분 -------------------------------
      runScenario('C_대형', { gens: 4, miners: 8, furnaces: 12, assemblers: 6, labs: 2, turrets: 6, research: 'military' }, 20);

      // --- 보조 측정 1: 발전기 1대가 감당하는 기계 수 --------------------------
      G.reset(424242); G.clearEntities(); G.giveAll(99999); G.powerCheat(false);
      for (var y = 60; y <= 90; y += 5) for (var x = 60; x <= 90; x += 5) G.place('pole', x, y, 0);
      var g1 = G.place('generator', 61, 61, 0); G.setFuel(g1, 4000 * 99999);
      var cnt = 0, sat = 1;
      for (var i = 1; i < 30 && sat > 0.999; i++) {
        var sp2 = slot(i);
        var aid2 = G.place('assembler', sp2[0], sp2[1], 1);
        if (!aid2) continue;
        G.setRecipe(aid2, 'gear'); G.fillChest(aid2, 'iron-plate', 99999);
        G.run(0.3);
        sat = G.state().power.sat;
        if (sat > 0.999) cnt++;
      }
      out.marks.assemblersPerGenerator = cnt;
      out.marks.assemblerKw = 155;

      // --- 보조 측정 2: 시작 광맥이 채광기 1대로 몇 분 버티나 ------------------
      // 주의: 채광기 출력 버퍼(100)가 차면 채굴이 멈춘다. 하류를 안 붙이고 재면
      //       "240분에 100개"라는 무의미한 값이 나온다 — 실제로 그렇게 나왔다.
      //       그래서 매 분 out 버퍼를 비워 "하류가 계속 빼간다"를 모델링한다.
      G.reset(424242); G.clearEntities(); G.giveAll(99999); G.powerCheat(true);
      var sp3 = G.oreSpotNear('iron-ore', 80, 80);
      if (sp3) {
        var patch0 = G.oreAmountAt ? G.oreAmountAt(sp3.x, sp3.y, 2, 2) : null;
        var mid2 = G.place('miner', sp3.x, sp3.y, 1);
        var mined0 = G.state().mined;
        var mins = 0;
        while (mins < 600) {
          G.run(60); G.clearOut(mid2); mins++;
          if (G.ent(mid2).depleted) break;
        }
        out.marks.startPatchMinutes = mins;
        out.marks.startPatchMined = G.state().mined - mined0;
        out.marks.startPatchDepleted = !!G.ent(mid2).depleted;
        out.marks.startPatchAmount = patch0;
        // 오라클: 0.5개/s 이므로 분당 30개여야 한다
        out.marks.minedPerMinute = Math.round((G.state().mined - mined0) / Math.max(1, mins) * 10) / 10;
      }

      // --- 보조 측정 3: 탄약 경제 — 습격 1회를 막는 데 드는 철판 --------------
      out.marks.ammoPerMagazine = 4;             // 철판 4 → 탄창 1 (10발)
      out.marks.shotsPerSmallBiter = Math.ceil(15 / 5);
      out.marks.shotsPerMediumBiter = Math.ceil(75 / 5);
      out.marks.shotsPerBigBiter = Math.ceil(375 / 5);

      out.errors = G.errors();
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      try { out.errors = window.__GAME ? window.__GAME.errors() : []; } catch (e2) { void e2; }
    }
    emit();
  }

  function go() { setTimeout(run, 120); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
