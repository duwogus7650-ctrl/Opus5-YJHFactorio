// ===========================================================================
//  결정론 검정 — 같은 씨앗, 같은 입력, 같은 결과인가
//
//  왜 필요했나: 40분 완주 주행(clear.js)이 **코드를 한 글자도 안 바꾸고 6회 돌려
//  6회 다 달랐다.** 최저 전력 만족도가 46~94% 로 흔들려 `powerHeld` 게이트가 주행마다
//  PASS 와 FAIL 을 오간다. 뒤집히는 게이트는 게이트가 아니다.
//
//  그런데 이 레포에는 **결정론 자체를 재는 게이트가 없었다.** README 는 결정론을
//  주장하고 있었고(그 주장으로 다른 수치들을 비교했다), 아무도 그것을 검정하지
//  않았다. 이 파일이 그 자리를 메운다.
//
//  구조 — 문제를 반으로 가른다:
//    A. 같은 페이지에서 같은 씨앗으로 두 번 돌린다 → 시뮬레이션 자체가 결정론적인가
//    B. 같은 페이지에서 드라이버가 하는 종류의 개입(재고 이동·배치·회로)을 끼워
//       두 번 돌린다 → 개입 경로가 결정론을 깨는가
//    C. 페이지 간 비교용 지문을 찍어 둔다 → 페이지를 새로 열면 달라지는가
//       (하네스는 페이지를 한 번만 여니, 이 값은 사람이 두 주행을 비교해서 본다)
//
//  **음성 대조군이 있다.** 씨앗을 바꾸면 지문이 달라져야 한다 — 안 달라지면 이
//  검정은 무엇을 비교하든 항상 '같다'고 답하는 빈 게이트다.
// ===========================================================================
(function () {
  var checks = [];
  function chk(n, ok, d, ef) { checks.push({ name: n, ok: !!ok, detail: String(d), expectFail: !!ef }); }
  function emit(o) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(o) + '@@JSON_END@@';
  }
  var G, out = { checks: checks, errors: [], fatal: null, measured: {} };

  var SEED = 20260810;
  var STEP = 2;            // 드라이버와 같은 몫으로 민다
  var SPAN = 480;          // 한 시나리오가 도는 게임 시간(초)
  var MARK = 60;           // 지문 간격

  // --- 시나리오 ------------------------------------------------------------
  // 세계 생성부터 같은 씨앗으로 다시 시작한다. clearEntities 를 쓰지 않는 이유는,
  // 완주 주행이 재는 것이 **실제 세계**(광맥·오염·적)이기 때문이다 — 리그를 깨끗이
  // 비우면 흔들리는 계(적·오염·전력)가 통째로 빠져 검정이 쉬운 쪽으로 기운다.
  function fresh(seed) {
    G.reset(seed === undefined ? SEED : seed);
    G.pause(true);
    return G.stateHash();
  }

  // **빈 세계로는 아무것도 못 잰다.** 처음엔 리셋만 하고 300초를 밀었는데, 엔티티
  // 3개·채굴 0 인 판이라 씨앗을 바꿔도 지문이 같았다 — 음성 대조군이 그걸 잡았다.
  // 상태 지문은 엔티티(위치·재고·진행도)와 채굴·오염·적을 담지, 지형은 안 담는다.
  // 그러니 **광맥 위에 실제로 공장을 세워야** 씨앗이 지문에 나타난다.
  function rig() {
    G.giveAll(3000);
    G.powerCheat(false);
    var i, x, y, ids = [];
    for (y = -2; y <= 2; y++) for (x = -2; x <= 2; x++) G.build('pole', 80 + x * 4, 80 + y * 4, 0);
    var gen = G.build('generator', 86, 86, 0);
    if (gen) { G.setFuel(gen, 4000 * 100000); ids.push(gen); }
    // 광맥 자리는 씨앗이 정한다 — 여기가 이 리그를 씨앗에 묶는 유일한 고리다.
    var kinds = ['iron-ore', 'copper-ore', 'coal', 'stone'];
    for (i = 0; i < kinds.length; i++) {
      var sp = G.oreSpotsNear(kinds[i], 80, 80, 12, 40);
      for (var s = 0; s < sp.length; s++) {
        var mid = G.build('miner', sp[s].x, sp[s].y, 1);
        if (mid) { ids.push(mid); break; }
      }
    }
    var recipes = ['iron-plate', 'copper-plate', 'brick'];
    for (i = 0; i < recipes.length; i++) {
      var fid = G.build('furnace', 72 + i * 3, 88, 0);
      if (fid) { G.setRecipe(fid, recipes[i]); ids.push(fid); }
    }
    var asm = G.build('assembler', 72, 72, 0);
    if (asm) { G.setRecipe(asm, 'gear'); ids.push(asm); }
    return ids;
  }

  // 공장을 세우고 그냥 민다 (개입 없음)
  function runPlain(span) {
    rig();
    var marks = [];
    for (var t = 0; t < span; t += STEP) {
      G.run(STEP);
      if ((t + STEP) % MARK === 0) marks.push(G.stateHash());
    }
    return marks;
  }

  // 드라이버가 하는 종류의 개입을 끼워 민다 — 재고 왕복·추가 배치.
  // **시각으로 분기한다(벽시계가 아니라 게임 시간).** 같은 게임 시각에 같은 일을
  // 하므로, 결과가 갈린다면 그건 개입 경로가 상태에 의존하는 방식이 문제라는 뜻이다.
  function runDriven(span) {
    var built = rig(), marks = [], t, i;
    for (t = 0; t < span; t += STEP) {
      var now = G.state().t;
      // 완주 드라이버의 물류가 하는 일의 축약 — 걷어서 재고로, 재고에서 다시 기계로
      if (Math.round(now) % 10 === 0) {
        for (i = 0; i < built.length; i++) {
          G.takeOutputToStock(built[i]);
          G.putFromStock(built[i], 5);
        }
      }
      if (Math.abs(now - 120) < 1e-9) {
        var t2 = G.build('turret', 84, 76, 0);
        if (t2) { built.push(t2); G.putFromStock(t2); }
      }
      G.run(STEP);
      if ((t + STEP) % MARK === 0) marks.push(G.stateHash());
    }
    return marks;
  }

  function firstDiff(a, b) {
    for (var i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return (i + 1) * MARK;
    }
    return (a.length === b.length) ? -1 : 0;
  }

  function go() {
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(out); return; }
      G = window.__GAME;

      // --- A. 시뮬레이션 자체 -------------------------------------------------
      var h0a = fresh(), A1 = runPlain(SPAN);
      var h0b = fresh(), A2 = runPlain(SPAN);
      out.measured.resetHash = { a: h0a, b: h0b };
      chk('det.resetIsReproducible', h0a === h0b,
        '같은 씨앗으로 reset 직후 지문 ' + h0a + ' vs ' + h0b);
      var dA = firstDiff(A1, A2);
      out.measured.plain = { A1: A1, A2: A2, firstDiff: dA };
      chk('det.plainRunIsReproducible', dA === -1,
        dA === -1 ? ('개입 없이 ' + SPAN + 's, 지문 ' + A1.length + '개 전부 일치')
                  : ('t=' + dA + 's 에서 처음 갈렸다 — 시뮬레이션 자체가 결정론적이지 않다'));

      // --- B. 개입을 끼운 경로 -----------------------------------------------
      fresh(); var B1 = runDriven(SPAN);
      fresh(); var B2 = runDriven(SPAN);
      var dB = firstDiff(B1, B2);
      out.measured.driven = { B1: B1, B2: B2, firstDiff: dB };
      chk('det.drivenRunIsReproducible', dB === -1,
        dB === -1 ? ('배치·재고 개입을 끼워 ' + SPAN + 's, 지문 ' + B1.length + '개 전부 일치')
                  : ('t=' + dB + 's 에서 처음 갈렸다 — 개입 경로가 결정론을 깬다'));

      // --- B2. 리셋 전에 얼마나 돌았든 같아야 한다 ----------------------------
      // **이 검정이 실제 결함을 잡았다.** 페이지가 열리고 드라이버가 reset 을 부르기
      // 전까지 게임은 실시간으로 잠깐 돈다. 그 시간은 머신 사정에 따라 다르고,
      // reset 이 되돌리지 않는 상태가 하나라도 있으면 **판마다 다른 출발점**이 된다.
      // 실제로 오염 확산 타이머(pollTimer)가 그랬다 — 40분 주행의 습격 손실과 최저
      // 전력 만족도가 주행마다 달라져 게이트가 PASS/FAIL 을 오갔다.
      //
      // 여기서는 그 '리셋 전 실행'을 일부러 흉내 낸다: 판을 깔고 임의 길이만큼 민 뒤
      // 다시 reset 하고 같은 시나리오를 돌린다. 결과가 A 와 달라지면, reset 이
      // 안 되돌리는 상태가 남아 있다는 뜻이다.
      fresh(); G.run(7.3);            // 0.25 의 배수가 아닌 길이 — 위상을 일부러 어긋낸다
      fresh(); var A3 = runPlain(SPAN);
      var dA3 = firstDiff(A1, A3);
      out.measured.afterWarmup = { firstDiff: dA3 };
      chk('det.resetClearsPriorRun', dA3 === -1,
        dA3 === -1 ? '리셋 전에 7.3초를 돌려도 같은 결과'
                   : ('t=' + dA3 + 's 에서 갈렸다 — reset 이 안 되돌리는 상태가 있다'));

      // --- C. 페이지 간 비교용 지문 -------------------------------------------
      // 같은 명령으로 두 번 실행해 이 줄을 눈으로 대조한다. A·B 가 통과하는데
      // 이 값이 주행마다 다르면, 원인은 **페이지를 여는 것 자체**에 있다.
      out.measured.crossPage = B1[B1.length - 1];
      chk('det.crossPageFingerprint', true,
        '페이지 간 대조용 — 같은 명령을 두 번 돌려 이 값을 비교하라: ' + out.measured.crossPage);

      // --- 음성 대조군 --------------------------------------------------------
      // **이 검정이 차이를 볼 수 있는가.** 씨앗을 바꾸면 반드시 달라져야 한다.
      // 안 달라지면 위의 GREEN 은 "같다"가 아니라 "아무것도 안 본다"는 뜻이다.
      fresh(SEED + 1);
      var C = runPlain(SPAN);
      var dC = firstDiff(A1, C);
      out.measured.otherSeed = { firstDiff: dC };
      chk('det.differentSeedDiffers', dC !== -1,
        dC === -1 ? '씨앗을 바꿔도 지문이 같다 — 이 검정은 차이를 못 본다'
                  : ('다른 씨앗은 t=' + dC + 's 에서 갈린다 (이 검정이 차이를 본다는 증거)'));

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', A1.length < 0, '지문 개수가 음수일 리 없다', true);
      out.finalState = G.state();
    } catch (e) { out.fatal = (e && e.stack) ? e.stack : String(e); }
    emit(out);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 80); });
  else setTimeout(go, 80);
})();
