// ===========================================================================
//  부하 차단 발진 측정 — 심화 튜토리얼 4·5단계의 주장을 숫자로 확인한다.
//
//  4단계 본문에 이렇게 써 놨다:
//      "그 기계가 1초에도 몇 번씩 켜졌다 꺼지는지 본다"
//  그리고 5단계는 그 떨림을 SR 래치로 없애라고 한다. **둘 다 재 본 적이 없었다.**
//  순진한 배선이 실제로는 안 떨린다면 4단계는 고장을 못 보여주고, 5단계의 래치도
//  왜 필요한지 알 수 없게 된다 — 튜토리얼 두 단계가 통째로 헛돈다.
//
//  그래서 여기서 판정하는 것은 "회로가 도는가"가 아니라 **몇 번 뒤집히는가**다.
//  판정은 #testout JSON 으로만 하고 채점은 harness.py 가 한다 (드라이버만 갈아 낀다).
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
  var G;
  var P0 = 50, PN = 7;
  function slot(i) {
    var k = i % (PN - 1), m = Math.floor(i / (PN - 1)) % (PN - 1);
    return [P0 + 1 + k * 5, P0 + 1 + m * 5];
  }

  // 전력을 **진짜로** 쓴다. powerCheat 를 켜면 만족도가 늘 100% 라 이 측정 자체가
  // 성립하지 않는다 (그러면 발진이 0 으로 나오고 "안 떨린다"는 거짓 결론이 된다).
  function rig(nAsm, nGen) {
    G.reset(424242);
    G.clearEntities();
    G.clearEnemies();
    G.giveAll(99999);
    G.powerCheat(false);
    for (var y = 0; y < PN; y++) {
      for (var x = 0; x < PN; x++) G.place('pole', P0 + x * 5, P0 + y * 5, 0);
    }
    var gens = [], asms = [], i, s;
    for (i = 0; i < nGen; i++) {
      s = slot(i);
      var gid = G.place('generator', s[0], s[1], 0);
      if (gid) { G.setFuel(gid, 4000 * 100000); gens.push(gid); }
    }
    for (i = 0; i < nAsm; i++) {
      s = slot(nGen + i);
      var aid = G.place('assembler', s[0], s[1], 0);
      if (aid) {
        G.setRecipe(aid, 'gear');
        G.fillChest(aid, 'iron-plate', 50);   // 재료가 없으면 전기를 안 먹는다
        asms.push(aid);
      }
    }
    return { gens: gens, asms: asms };
  }

  // 한 틱씩 전진하며 대상 기계의 가동 상태가 몇 번 뒤집히는지 센다.
  // G.run(초) 로 뭉뚱그리면 중간의 토글이 안 보인다 — 그게 바로 재려는 대상이다.
  function countToggles(entId, seconds, asms) {
    var n = Math.round(seconds * 60), prev = null, flips = 0, onT = 0, satMin = 1;
    for (var i = 0; i < n; i++) {
      // **재료를 계속 대준다.** 조립기는 재료가 없거나 출력이 꽉 차면 powerDraw 가
      // 0 이 되어 수요에서 빠진다. 그러면 전력 부족이 저절로 풀려서, 재려던 발진이
      // 아니라 "재료 떨어진 빈 공장"을 재게 된다 (첫 측정이 실제로 그랬다).
      if (asms && i % 30 === 0) {
        for (var a = 0; a < asms.length; a++) {
          G.takeToStock(asms[a]);                  // 입력·출력 버퍼를 비우고
          G.fillChest(asms[a], 'iron-plate', 20);  // 다시 채운다
        }
      }
      G.tickOnce();
      var e = G.ent(entId);
      if (!e) break;
      var on = !!e.enabled;
      if (on) onT++;
      if (prev !== null && on !== prev) flips++;
      prev = on;
      var sp = G.state().power;
      if (sp.sat < satMin) satMin = sp.sat;
    }
    return { flips: flips, onFrac: n ? onT / n : 0, ticks: n, satMin: satMin };
  }

  function runAll() {
    var out = { version: null, checks: checks, errors: [], fatal: null, notes: [], measured: {} };
    try {
      if (!window.__READY || !window.__GAME) {
        out.fatal = 'boot 실패'; emit(out); return;
      }
      G = window.__GAME;
      out.version = G.version;
      var SP = G.spec();

      // ---------- 1. 순진한 배선: 만족% < 95 면 끈다 ----------------------
      var r = rig(7, 1);                      // 155kW x 7 = 1085kW > 900kW 공급
      // 제어기를 전주 범위 **안**에 둔다. 밖에 두면 netSatOf 가 0 을 돌려주고
      // (전기를 안 쓰는 건물이라 net 이 -1 이다) 만족%가 영원히 0 으로 읽혀
      // 부하 차단 회로가 통째로 죽는다 — 첫 측정이 실제로 그 상태였다.
      var cs = slot(8);
      var ctrl = G.place('controller', cs[0], cs[1], 0);
      var target = r.asms[r.asms.length - 1];  // 저우선 기계 = 마지막 조립기
      chk('shed.rigBuilt',
        r.gens.length === 1 && r.asms.length === 7 && !!ctrl && !!target,
        '발전기 ' + r.gens.length + ' · 조립기 ' + r.asms.length + ' · 제어기 ' + ctrl);


      // 전력이 실제로 모자라야 이 측정이 성립한다. 남아돌면 회로가 아예 안 움직여
      // "발진 0" 이 나오는데, 그건 고쳐서가 아니라 시험이 조건을 못 만든 것이다.
      G.run(2);
      var st0 = G.state();
      // 배치 직후에는 전력망이 아직 재구성 전이라 net 이 -1 이다. 반드시 틱을 돌린
      // **뒤에** 물어봐야 한다 (처음에 배치 직후 물어봤다가 거짓 실패를 냈다).
      chk('shed.controllerOnGrid', !!ctrl && G.ent(ctrl).net >= 0,
        '제어기의 전력망 번호 ' + (ctrl ? G.ent(ctrl).net : '?') +
        ' (-1 이면 만족%가 0 으로 읽혀 부하 차단 회로가 통째로 죽는다)');
      chk('shed.deficitExists',
        st0.power.demand > st0.power.supply && st0.power.sat < 0.95,
        '수요 ' + Math.round(st0.power.demand) + 'kW > 공급 ' + Math.round(st0.power.supply) +
        'kW · 만족도 ' + Math.round(st0.power.sat * 100) + '% (95% 미만이어야 회로가 작동한다)');

      var nPow = G.gAdd(ctrl, 'power', 10, 10);
      // '>=' 다. '<' 로 짜면 "전기가 모자라면 켠다" 가 되어 아무 일도 안 일어난다.
      var nC = G.gAdd(ctrl, 'cmp', 200, 10); G.gCfg(ctrl, nC, 'op', '>=');
      var nK = G.gAdd(ctrl, 'const', 10, 150); G.gCfg(ctrl, nK, 'value', 95);
      var nEn = G.gAdd(ctrl, 'enable', 400, 10); G.gCfg(ctrl, nEn, 'ent', target);
      G.gLink(ctrl, nPow, 0, nC, 0);
      G.gLink(ctrl, nK, 0, nC, 1);
      G.gLink(ctrl, nC, 0, nEn, 0);

      var naive = countToggles(target, 30, r.asms);
      out.measured.naive = naive;
      // "1초에도 몇 번씩" 이라고 본문에 썼다. 최소한 초당 1회는 넘어야 그 문장이 참이다.
      chk('shed.naiveOscillates',
        naive.flips >= 30,
        '순진한 배선 30초 → 가동 상태가 ' + naive.flips + '회 뒤집혔다 (초당 ' +
        (naive.flips / 30).toFixed(1) + '회) · 켜져 있던 시간 비율 ' +
        Math.round(naive.onFrac * 100) + '%');

      // ---------- 2. SR 래치 배선: 문턱을 벌리고 기억으로 버틴다 -----------
      var r2 = rig(7, 1);
      var cs2 = slot(8);
      var ctrl2 = G.place('controller', cs2[0], cs2[1], 0);
      var tgt2 = r2.asms[r2.asms.length - 1];
      chk('shed.latchRigBuilt', r2.asms.length === 7 && !!ctrl2 && !!tgt2,
        '조립기 ' + r2.asms.length + ' · 제어기 ' + ctrl2 + ' · 대상 ' + tgt2);
      G.run(2);

      var p2 = G.gAdd(ctrl2, 'power', 10, 10);
      var cSet = G.gAdd(ctrl2, 'cmp', 200, 10);  G.gCfg(ctrl2, cSet, 'op', '>');
      var kSet = G.gAdd(ctrl2, 'const', 10, 120); G.gCfg(ctrl2, kSet, 'value', 98);
      var cRst = G.gAdd(ctrl2, 'cmp', 200, 220); G.gCfg(ctrl2, cRst, 'op', '<');
      var kRst = G.gAdd(ctrl2, 'const', 10, 330); G.gCfg(ctrl2, kRst, 'value', 90);
      var lat = G.gAdd(ctrl2, 'latch', 400, 110);
      var en2 = G.gAdd(ctrl2, 'enable', 600, 110); G.gCfg(ctrl2, en2, 'ent', tgt2);
      G.gLink(ctrl2, p2, 0, cSet, 0); G.gLink(ctrl2, kSet, 0, cSet, 1);
      G.gLink(ctrl2, p2, 0, cRst, 0); G.gLink(ctrl2, kRst, 0, cRst, 1);
      G.gLink(ctrl2, cSet, 0, lat, 0);      // 여유롭다 → SET (다시 돌려라)
      G.gLink(ctrl2, cRst, 0, lat, 1);      // 모자란다 → RESET (꺼라)
      G.gLink(ctrl2, lat, 0, en2, 0);

      var latched = countToggles(tgt2, 30, r2.asms);
      out.measured.latch = latched;
      // 래치판은 한 번 정착하면 안 떨려야 한다. 초반 1~2회 전환은 정착 과정이다.
      chk('shed.latchSettles',
        latched.flips <= 2,
        'SR 래치 배선 30초 → 뒤집힘 ' + latched.flips + '회 (2회 이하여야 정착이다) · ' +
        '켜져 있던 시간 비율 ' + Math.round(latched.onFrac * 100) + '%');

      // 두 값의 대비가 교육 효과의 전부다. 배수를 명시해 둔다.
      chk('shed.latchBeatsNaive',
        naive.flips > latched.flips * 10,
        '순진 ' + naive.flips + '회 vs 래치 ' + latched.flips + '회 — ' +
        (latched.flips ? Math.round(naive.flips / latched.flips) + '배' : '비교 불가(래치 0회)') +
        ' 차이 (10배 미만이면 4→5단계의 교훈이 눈에 안 보인다)');

      // ---------- 3. 부하 차단이 실제로 전력을 회복시키는가 ----------------
      var stEnd = G.state();
      out.measured.finalSat = stEnd.power.sat;
      chk('shed.actuallyRecoversPower',
        stEnd.power.sat > st0.power.sat,
        '차단 전 만족도 ' + Math.round(st0.power.sat * 100) + '% → 래치 정착 후 ' +
        Math.round(stEnd.power.sat * 100) + '% (안 오르면 부하 차단이 아무것도 안 한 것이다)');

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', naive.flips < 0, '뒤집힘 횟수가 음수일 리 없다', true);
      out.finalState = stEnd;
      void SP;
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      try { out.errors = window.__GAME ? window.__GAME.errors() : []; } catch (e2) { void e2; }
    }
    emit(out);
  }

  function go() { setTimeout(runAll, 60); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
