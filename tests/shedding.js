// ===========================================================================
//  부하 차단 검증 — 다섯 구성을 같은 자리에서 잰다
//
//  이 파일은 예전 shedding.js 를 대체한다. 예전 것은 조립기 7대 중 **1대만**
//  끊어 차단 후에도 적자가 남는 구성을 골랐고(만족도 96.8%), 그 하나에서만
//  성립하는 안정을 근거로 "래치가 발진을 잡는다" 는 GREEN 을 받고 있었다.
//  독립 감사가 그걸 교차 확인해 짚었다 — 통과하도록 만든 게이트는 통과한다.
//
//  이제 어려운 구성(차단이 적자를 완전히 지우는 경우)을 기본으로 재고,
//  래치만으로는 못 막힌다는 것까지 게이트로 못박는다.
// ===========================================================================
(function () {
  var checks = [];
  function chk(n, ok, d, ef) { checks.push({ name: n, ok: !!ok, detail: String(d), expectFail: !!ef }); }
  function emit(o) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(o) + '@@JSON_END@@';
  }
  var G, out = { checks: checks, errors: [], fatal: null, measured: {} };

  var P0 = 50, PN = 6;
  function slot(i) {
    var k = i % (PN - 1), m = Math.floor(i / (PN - 1)) % (PN - 1);
    return [P0 + 1 + k * 5, P0 + 1 + m * 5];
  }
  // 전력을 진짜로 쓰는 판. nAsm 조립기(155kW) + nFur 용광로(180kW) + 발전기 1대(900kW)
  function rig(nAsm, nFur) {
    G.reset(424242); G.clearEntities(); G.clearEnemies();
    G.giveAll(99999); G.powerCheat(false);
    G.research('logic-mem'); G.research('logic-ctrl');
    for (var y = 0; y < PN; y++) for (var x = 0; x < PN; x++) G.place('pole', P0 + x * 5, P0 + y * 5, 0);
    var s0 = slot(0);
    var gen = G.place('generator', s0[0], s0[1], 0);
    if (gen) G.setFuel(gen, 4000 * 200000);
    var loads = [], i, s, id;
    for (i = 0; i < nAsm; i++) {
      s = slot(1 + i);
      id = G.place('assembler', s[0], s[1], 0);
      if (id) { G.setRecipe(id, 'gear'); G.fillChest(id, 'iron-plate', 50); loads.push(id); }
    }
    for (i = 0; i < nFur; i++) {
      s = slot(1 + nAsm + i);
      id = G.place('furnace', s[0], s[1], 0);
      if (id) { G.setRecipe(id, 'iron-plate'); G.fillChest(id, 'iron-ore', 50); loads.push(id); }
    }
    var cs = slot(1 + nAsm + nFur);
    var ctrl = G.place('controller', cs[0], cs[1], 0);
    G.run(2);
    return { gen: gen, loads: loads, ctrl: ctrl };
  }
  // 대상들의 가동 상태가 몇 번 뒤집히는지. 재료를 계속 대 수요를 유지한다.
  function flips(ids, ticks, feedIds) {
    var prev = null, n = 0, satMin = 1, satMax = 0, demMin = 1e9, demMax = 0;
    for (var i = 0; i < ticks; i++) {
      if (feedIds && i % 30 === 0) {
        for (var f = 0; f < feedIds.length; f++) {
          G.takeOutputToStock(feedIds[f]);
          G.putFromStock(feedIds[f]);
        }
      }
      G.tickOnce();
      var v = !!G.ent(ids[0]).enabled;
      if (prev !== null && v !== prev) n++;
      prev = v;
      var pw = G.state().power;
      if (pw.sat < satMin) satMin = pw.sat;
      if (pw.sat > satMax) satMax = pw.sat;
      if (pw.demand < demMin) demMin = pw.demand;
      if (pw.demand > demMax) demMax = pw.demand;
    }
    return { flips: n, satMin: +(satMin * 100).toFixed(1), satMax: +(satMax * 100).toFixed(1),
             demMin: Math.round(demMin), demMax: Math.round(demMax), ticks: ticks };
  }

  function go() {
    try {
      G = window.__GAME;

      // ---------- A. 감사 리그 — 비교기 하나 (차단하면 공급 >= 수요) ----------
      // 조립기 4(620) + 용광로 2(360) = 980kW > 900kW. 용광로 2대를 끊으면 620kW
      // 로 떨어져 **공급이 남는다** → 만족도가 정확히 100% 에 걸린다.
      var r = rig(4, 2);
      var shed = r.loads.slice(-2);
      var p1 = G.gAdd(r.ctrl, 'power', 0, 0);
      var k1 = G.gAdd(r.ctrl, 'const', 0, 200); G.gCfg(r.ctrl, k1, 'value', 98);
      var c1 = G.gAdd(r.ctrl, 'cmp', 200, 100); G.gCfg(r.ctrl, c1, 'op', '>=');
      G.gLink(r.ctrl, p1, 0, c1, 0); G.gLink(r.ctrl, k1, 0, c1, 1);
      for (var a = 0; a < shed.length; a++) {
        var e1 = G.gAdd(r.ctrl, 'enable', 400, a * 200);
        G.gCfg(r.ctrl, e1, 'ent', shed[a]);
        G.gLink(r.ctrl, c1, 0, e1, 0);
      }
      G.run(1);
      var A = flips(shed, 300, r.loads);
      out.measured.A_comparatorOnly = A;
      chk('shed2.rigHasDeficit', A.demMax > 900,
        '리그 수요 최대 ' + A.demMax + 'kW vs 공급 900kW · 만족도 ' + A.satMin + '~' + A.satMax +
        '% (부족이 없으면 이 시험은 아무것도 안 잰다)');
      chk('shed2.comparatorOscillates', A.flips >= 100,
        '비교기 하나 300틱 → 뒤집힘 ' + A.flips + '회 · 수요 ' + A.demMin + '~' + A.demMax +
        'kW · 만족도 ' + A.satMin + '~' + A.satMax + '%');

      // ---------- B. 같은 리그에 SR 래치 히스테리시스 ----------
      // 감사 주장의 핵심: 차단 직후 만족도가 정확히 100 이므로 RESET(>99)이
      // 즉시 걸려 래치가 발진을 못 막는다.
      var r2 = rig(4, 2);
      var shed2 = r2.loads.slice(-2);
      var p2 = G.gAdd(r2.ctrl, 'power', 0, 0);
      var kSet = G.gAdd(r2.ctrl, 'const', 0, 200);  G.gCfg(r2.ctrl, kSet, 'value', 95);
      var kRst = G.gAdd(r2.ctrl, 'const', 0, 340);  G.gCfg(r2.ctrl, kRst, 'value', 99);
      var cSet = G.gAdd(r2.ctrl, 'cmp', 200, 60);   G.gCfg(r2.ctrl, cSet, 'op', '<');
      var cRst = G.gAdd(r2.ctrl, 'cmp', 200, 260);  G.gCfg(r2.ctrl, cRst, 'op', '>');
      G.gLink(r2.ctrl, p2, 0, cSet, 0); G.gLink(r2.ctrl, kSet, 0, cSet, 1);
      G.gLink(r2.ctrl, p2, 0, cRst, 0); G.gLink(r2.ctrl, kRst, 0, cRst, 1);
      var lat = G.gAdd(r2.ctrl, 'latch', 420, 150);
      G.gLink(r2.ctrl, cSet, 0, lat, 0);      // 모자라다 → SET (= 끊어라)
      G.gLink(r2.ctrl, cRst, 0, lat, 1);      // 여유롭다 → RESET (= 되돌려라)
      var nots = G.gAdd(r2.ctrl, 'bool', 600, 150); G.gCfg(r2.ctrl, nots, 'op', 'NOT A');
      G.gLink(r2.ctrl, lat, 0, nots, 0);      // Q=1(끊음) → 가동 0
      for (var b = 0; b < shed2.length; b++) {
        var e2 = G.gAdd(r2.ctrl, 'enable', 800, b * 200);
        G.gCfg(r2.ctrl, e2, 'ent', shed2[b]);
        G.gLink(r2.ctrl, nots, 0, e2, 0);
      }
      G.run(1);
      var B = flips(shed2, 300, r2.loads);
      out.measured.B_latchOnly = B;
      chk('shed2.latchAloneCannotStop', B.flips >= 100,
        'SR 래치만 300틱 → 뒤집힘 ' + B.flips + '회 · 만족도 ' + B.satMin + '~' + B.satMax +
        '% (감사 주장: 차단하면 만족도가 정확히 100 이 되어 RESET 이 즉시 걸린다)');

      // ---------- C. 래치 + 타이머 (복귀를 늦춘다) ----------
      // RESET 을 '여유롭다 AND 타이머 펄스' 로 만들면 복귀 시도가 주기당 1회로 줄어든다.
      var r3 = rig(4, 2);
      var shed3 = r3.loads.slice(-2);
      var p3 = G.gAdd(r3.ctrl, 'power', 0, 0);
      var k3s = G.gAdd(r3.ctrl, 'const', 0, 200); G.gCfg(r3.ctrl, k3s, 'value', 95);
      var k3r = G.gAdd(r3.ctrl, 'const', 0, 340); G.gCfg(r3.ctrl, k3r, 'value', 99);
      var c3s = G.gAdd(r3.ctrl, 'cmp', 200, 60);  G.gCfg(r3.ctrl, c3s, 'op', '<');
      var c3r = G.gAdd(r3.ctrl, 'cmp', 200, 260); G.gCfg(r3.ctrl, c3r, 'op', '>');
      G.gLink(r3.ctrl, p3, 0, c3s, 0); G.gLink(r3.ctrl, k3s, 0, c3s, 1);
      G.gLink(r3.ctrl, p3, 0, c3r, 0); G.gLink(r3.ctrl, k3r, 0, c3r, 1);
      var tmr = G.gAdd(r3.ctrl, 'timer', 200, 420); G.gCfg(r3.ctrl, tmr, 'period', 30);
      var andN = G.gAdd(r3.ctrl, 'bool', 400, 320); G.gCfg(r3.ctrl, andN, 'op', 'AND');
      G.gLink(r3.ctrl, c3r, 0, andN, 0); G.gLink(r3.ctrl, tmr, 0, andN, 1);
      var lat3 = G.gAdd(r3.ctrl, 'latch', 600, 150);
      G.gLink(r3.ctrl, c3s, 0, lat3, 0);      // SET: 모자라면 즉시 끊는다
      G.gLink(r3.ctrl, andN, 0, lat3, 1);     // RESET: 여유로울 때 **30초마다 한 번만** 시도
      var not3 = G.gAdd(r3.ctrl, 'bool', 780, 150); G.gCfg(r3.ctrl, not3, 'op', 'NOT A');
      G.gLink(r3.ctrl, lat3, 0, not3, 0);
      for (var d = 0; d < shed3.length; d++) {
        var e3 = G.gAdd(r3.ctrl, 'enable', 960, d * 200);
        G.gCfg(r3.ctrl, e3, 'ent', shed3[d]);
        G.gLink(r3.ctrl, not3, 0, e3, 0);
      }
      G.run(1);
      var C = flips(shed3, 300, r3.loads);
      out.measured.C_latchPlusTimer = C;
      chk('shed2.latchPlusTimerSettles', C.flips <= 4,
        '래치 + 타이머(30초) 300틱 → 뒤집힘 ' + C.flips + '회 · 만족도 ' +
        C.satMin + '~' + C.satMax + '% (5초 구간이므로 30초 주기면 0~2회여야 한다)');
      chk('shed2.timerBeatsLatchAlone', B.flips > C.flips * 10,
        '래치만 ' + B.flips + '회 vs 래치+타이머 ' + C.flips + '회');

      // ---------- D. 내 원래 리그 (차단해도 여전히 부족) ----------
      // 조립기 7대(1085kW). 1대를 끊어도 930kW > 900 이라 만족도가 100 에 안 걸린다.
      // 그래서 래치만으로도 안착했다 — 내 측정이 틀린 게 아니라 **특수한 경우**였다.
      var r4 = rig(7, 0);
      var shed4 = [r4.loads[r4.loads.length - 1]];
      var p4 = G.gAdd(r4.ctrl, 'power', 0, 0);
      var k4s = G.gAdd(r4.ctrl, 'const', 0, 200); G.gCfg(r4.ctrl, k4s, 'value', 98);
      var k4r = G.gAdd(r4.ctrl, 'const', 0, 340); G.gCfg(r4.ctrl, k4r, 'value', 90);
      var c4s = G.gAdd(r4.ctrl, 'cmp', 200, 60);  G.gCfg(r4.ctrl, c4s, 'op', '>');
      var c4r = G.gAdd(r4.ctrl, 'cmp', 200, 260); G.gCfg(r4.ctrl, c4r, 'op', '<');
      G.gLink(r4.ctrl, p4, 0, c4s, 0); G.gLink(r4.ctrl, k4s, 0, c4s, 1);
      G.gLink(r4.ctrl, p4, 0, c4r, 0); G.gLink(r4.ctrl, k4r, 0, c4r, 1);
      var lat4 = G.gAdd(r4.ctrl, 'latch', 420, 150);
      G.gLink(r4.ctrl, c4s, 0, lat4, 0); G.gLink(r4.ctrl, c4r, 0, lat4, 1);
      var e4 = G.gAdd(r4.ctrl, 'enable', 620, 150);
      G.gCfg(r4.ctrl, e4, 'ent', shed4[0]);
      G.gLink(r4.ctrl, lat4, 0, e4, 0);
      G.run(1);
      var D = flips(shed4, 300, r4.loads);
      out.measured.D_myOriginalRig = D;
      chk('shed2.myRigStillSettles', D.flips <= 2 && D.satMax < 100,
        '내 원래 리그(조립기 7, 1대만 끊음) 300틱 → 뒤집힘 ' + D.flips + '회 · 만족도 ' +
        D.satMin + '~' + D.satMax + '% (최대가 100 미만이면 클램프에 안 걸린 것이다)');

      // 갈리는 지점을 숫자로 못박는다
      chk('shed2.clampIsTheDivider',
        A.satMax >= 100 && D.satMax < 100,
        '감사 리그 만족도 최대 ' + A.satMax + '% (100 에 걸림) vs 내 리그 ' + D.satMax +
        '% (안 걸림) — 이것이 두 결론이 갈린 이유다');

      // ---------- E. 튜토리얼이 지금 가르치는 회로 (여유kW + 래치 + 타이머) ----------
      // 5단계는 여유kW 로 문턱을 벌리고, 5b 단계가 타이머로 복귀를 늦춘다.
      // 그 조합이 실제로 멈추는지 — 가르치는 절차가 작동하는지 — 를 잰다.
      var r5 = rig(4, 2);
      var shed5 = r5.loads.slice(-2);
      var p5 = G.gAdd(r5.ctrl, 'power', 0, 0);
      var z0 = G.gAdd(r5.ctrl, 'const', 0, 200);  G.gCfg(r5.ctrl, z0, 'value', 0);
      var z2 = G.gAdd(r5.ctrl, 'const', 0, 340);  G.gCfg(r5.ctrl, z2, 'value', 200);
      var cLo5 = G.gAdd(r5.ctrl, 'cmp', 200, 60);  G.gCfg(r5.ctrl, cLo5, 'op', '<');
      var cHi5 = G.gAdd(r5.ctrl, 'cmp', 200, 260); G.gCfg(r5.ctrl, cHi5, 'op', '>');
      // 포트 3 = 여유kW (클램프 없음)
      G.gLink(r5.ctrl, p5, 3, cLo5, 0); G.gLink(r5.ctrl, z0, 0, cLo5, 1);
      G.gLink(r5.ctrl, p5, 3, cHi5, 0); G.gLink(r5.ctrl, z2, 0, cHi5, 1);
      var tm5 = G.gAdd(r5.ctrl, 'timer', 200, 420); G.gCfg(r5.ctrl, tm5, 'period', 30);
      var and5 = G.gAdd(r5.ctrl, 'bool', 400, 320); G.gCfg(r5.ctrl, and5, 'op', 'AND');
      G.gLink(r5.ctrl, cHi5, 0, and5, 0); G.gLink(r5.ctrl, tm5, 0, and5, 1);
      var lat5 = G.gAdd(r5.ctrl, 'latch', 600, 150);
      G.gLink(r5.ctrl, cLo5, 0, lat5, 0);    // SET: 여유 < 0 → 즉시 끊는다
      G.gLink(r5.ctrl, and5, 0, lat5, 1);    // RESET: 여유 > 200 이고 타이머가 울릴 때만
      var not5 = G.gAdd(r5.ctrl, 'bool', 780, 150); G.gCfg(r5.ctrl, not5, 'op', 'NOT A');
      G.gLink(r5.ctrl, lat5, 0, not5, 0);
      for (var q5 = 0; q5 < shed5.length; q5++) {
        var e5 = G.gAdd(r5.ctrl, 'enable', 960, q5 * 200);
        G.gCfg(r5.ctrl, e5, 'ent', shed5[q5]);
        G.gLink(r5.ctrl, not5, 0, e5, 0);
      }
      G.run(1);
      var E = flips(shed5, 300, r5.loads);
      out.measured.E_tutorialCircuit = E;
      chk('shed2.tutorialCircuitSettles', E.flips <= 4,
        '튜토리얼이 가르치는 회로(여유kW + 래치 + 타이머) 300틱 → 뒤집힘 ' + E.flips +
        '회 · 만족도 ' + E.satMin + '~' + E.satMax + '% (가르치는 절차가 작동해야 한다)');

      // 여유kW 가 실제로 클램프 없이 남는 쪽을 보여주는가 — 만족%로는 못 하던 일
      var headOut = G.gOut(r5.ctrl, p5, 3);
      var satOut = G.gOut(r5.ctrl, p5, 0);
      out.measured.headroom = { 여유kW: headOut, 만족: satOut };
      chk('shed2.headroomIsUnclamped', headOut > 0 && satOut === 100,
        '차단 후 여유kW=' + headOut + ' · 만족%=' + satOut +
        ' (만족%는 100 에서 잘려 "얼마나 남는가"를 못 알려준다 — 여유kW 가 그걸 대신한다)');

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', A.flips < 0, '뒤집힘이 음수일 리 없다', true);
      out.finalState = G.state();
    } catch (e) { out.fatal = (e && e.stack) ? e.stack : String(e); }
    emit(out);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 80); });
  else setTimeout(go, 80);
})();
