// ===========================================================================
//  전수 스윕 — 게임의 모든 기능을 하나씩 실제로 써 보고 말이 되는지 본다
//
//  목적: "내가 발견 못한 것" 을 찾는다. 그래서 판정 기준을 **오라클** 로 둔다 —
//  관찰된 값을 정답으로 삼지 않고, 스펙·정의·상식에서 기대값을 먼저 계산해 대조한다.
//  관찰을 정답으로 쓰면 버그가 스펙이 되어 버린다.
//
//  덮는 범위:
//    · 노드 전 종류 — 개수는 여기 적지 않는다. 기준은 G.nodeKinds() 이고,
//      숫자를 아는 곳은 아래 sweep.allNodeKindsKnown 한 군데뿐이다
//    · 건물 전부 — 놓고, 실제로 제 일을 하는지
//    · 레시피 전부 — 만들어지는지
//    · 연구 전부 — 끝내면 실제로 열리는지
//    · 저장/복원 왕복
//
//  규율: 이상한 것은 FAIL 로 낸다. 통과시켜 놓고 주석에 적으면 아무도 안 읽는다.
// ===========================================================================
(function () {
  var checks = [];
  function chk(name, ok, detail, expectFail) {
    checks.push({ name: name, ok: !!ok, detail: String(detail), expectFail: !!expectFail });
  }
  function emit(o) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(o) + '@@JSON_END@@';
  }
  var G, out = { checks: checks, errors: [], fatal: null, notes: [], measured: {} };
  function r2(v) { return Math.round(v * 100) / 100; }

  // --- 노드 시험용 판 --------------------------------------------------------
  // 제어기 하나에 노드를 놓고, 입력을 상수로 물려 출력을 읽는다.
  var CT = null;
  function freshCtrl() {
    G.reset(424242); G.clearEntities(); G.clearEnemies();
    G.giveAll(99999); G.powerCheat(true);
    for (var t = 0; t < G.techIds().length; t++) G.research(G.techIds()[t]);
    CT = G.place('controller', 60, 60, 0);
    G.run(1);
    return CT;
  }
  function K(v, x, y) { var n = G.gAdd(CT, 'const', x || 0, y || 0); G.gCfg(CT, n, 'value', v); return n; }
  function N(kind, x, y) { return G.gAdd(CT, kind, x || 200, y || 0); }
  function L(a, ap, b, bp) { return G.gLink(CT, a, ap, b, bp); }
  function O(n, p) { return G.gOut(CT, n, p || 0); }
  // 노드를 좌표로 벌려 놓는다 — 평가 순서가 좌표순이므로 입력이 먼저 오게 한다

  function runAll() {
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(out); return; }
      G = window.__GAME;
      var SP = G.spec();
      var anomalies = [];
      function odd(what) { anomalies.push(what); }

      // ======================= 1. 노드 전수 ===============================
      var kinds = G.nodeKinds();
      out.measured.nodeKinds = kinds.length;
      // **이 숫자는 덫이다.** 노드 종류를 늘리면 여기가 RED 로 갈리고, 그때 이 파일
      // 아래의 전수 시험도 같이 채우라는 뜻이다. 숫자만 올리고 시험을 안 채우면
      // 그 종류는 "안 깨진 기능"이 아니라 **아직 안 들킨 기능**으로 남는다.
      chk('sweep.allNodeKindsKnown', kinds.length === 33,
        '노드 종류 ' + kinds.length + '개: ' + kinds.join(','));

      // ---- 입력: 상수 ----
      freshCtrl();
      var kc = K(42, 0, 0);
      G.run(1);
      chk('node.const', O(kc) === 42, '상수 42 → ' + O(kc));

      // ---- 입력: 상자 재고 (품목 지정 / 전체) ----
      freshCtrl();
      var box = G.place('chest', 64, 60, 0);
      G.fillChest(box, 'iron-plate', 7);
      G.fillChest(box, 'copper-plate', 3);
      var nb = N('chest', 0, 0); G.gCfg(CT, nb, 'ent', box); G.gCfg(CT, nb, 'item', 'iron-plate');
      var nb2 = N('chest', 0, 200); G.gCfg(CT, nb2, 'ent', box); G.gCfg(CT, nb2, 'item', null);
      G.run(1);
      chk('node.chest', O(nb) === 7 && O(nb2) === 10,
        '철판 7 + 구리판 3 인 상자 → 품목지정 ' + O(nb) + ' (7이어야) · 전체 ' + O(nb2) + ' (10이어야)');

      // ---- 입력: 창고 재고 ----
      freshCtrl();
      G.setInv('gear', 55);
      var ni = N('invsense', 0, 0); G.gCfg(CT, ni, 'item', 'gear');
      G.run(1);
      chk('node.invsense', O(ni) === 55, '보유 톱니 55 → ' + O(ni));

      // ---- 입력: 타이머 ----
      // 주기 2초면 2초에 정확히 한 번 발화해야 한다. 위상%는 0~100 을 톱니처럼 돈다.
      freshCtrl();
      var nt = N('timer', 0, 0); G.gCfg(CT, nt, 'period', 2);
      var fires = 0, phMin = 1e9, phMax = -1e9;
      // 정확히 6.0초로 재면 3번째 발화가 경계에 걸린다(2회로 관측됐다).
      // 경계에서 게임을 탓하지 않는다 — 7초로 재고 3회를 기대한다.
      for (var ti = 0; ti < 420; ti++) {          // 7초 = 주기 3회 (2,4,6초)
        G.tickOnce();
        if (O(nt, 0) >= 0.5) fires++;
        var ph = O(nt, 1);
        if (ph < phMin) phMin = ph;
        if (ph > phMax) phMax = ph;
      }
      chk('node.timer', fires === 3,
        '주기 2초로 7초 구동 → 발화 ' + fires + '회 (2·4·6초 = 3회여야) · 위상% ' + phMin + '~' + phMax);
      if (phMin < 0 || phMax > 100) odd('타이머 위상%가 0~100 을 벗어난다: ' + phMin + '~' + phMax);

      // ---- 입력: 기계 상태 ----
      freshCtrl();
      var mAsm = G.place('assembler', 64, 60, 0);
      G.setRecipe(mAsm, 'gear'); G.fillChest(mAsm, 'iron-plate', 50);
      var nm = N('machine', 0, 0); G.gCfg(CT, nm, 'ent', mAsm);
      G.run(1);
      var работ = O(nm, 0), stall = O(nm, 1), prog = O(nm, 2);
      chk('node.machineWorking', работ >= 0.5 && prog >= 0 && prog <= 100,
        '재료를 댄 조립기 → 가동 ' + работ + ' · 정체 ' + stall + ' · 진행% ' + prog);
      // 재료를 끊으면 정체가 자라야 한다
      G.takeToStock(mAsm);
      G.run(3);
      var stall2 = O(nm, 1);
      chk('node.machineStall', stall2 > stall,
        '재료를 끊고 3초 → 정체 ' + r2(stall) + ' → ' + r2(stall2) + ' (자라야 한다)');

      // ---- 입력: 벨트 센서 ----
      freshCtrl();
      var bl = G.place('belt', 64, 60, 1);
      G.beltPut(bl, 'iron-plate', 0.5);
      var nbe = N('belt', 0, 0); G.gCfg(CT, nbe, 'ent', bl); G.gCfg(CT, nbe, 'item', null);
      G.run(1);
      chk('node.belt', O(nbe) >= 1, '벨트에 아이템 1개 올림 → 센서 ' + O(nbe));

      // ---- 입력: 연구 진행 ----
      // freshCtrl 은 모든 연구를 끝내 버리므로 '진행 중' 을 만들 수 없다.
      // 연구를 하나도 안 한 판을 따로 만든다.
      G.reset(424242); G.clearEntities(); G.clearEnemies();
      G.giveAll(99999); G.powerCheat(true);
      CT = G.place('controller', 60, 60, 0);
      G.run(1);
      var nr = N('research', 0, 0);
      G.run(1);
      var noRes = O(nr, 1);
      var started = G.setResearch('logistics');
      G.run(1);
      chk('node.research', noRes === 0 && started === true && O(nr, 1) >= 0.5,
        '연구 없음 → 연구중 ' + noRes + ' · 시작 성공 ' + started + ' → 연구중 ' + O(nr, 1));

      // ---- 입력: 적 근접 ----
      // 적이 없을 때 최근접거리는 0 이 아니라 반경 R 이어야 한다.
      // 0 이면 "거리 < 10 이면 방어" 가 평상시 늘 참이 된다.
      freshCtrl();
      var ne = N('enemy', 0, 0); G.gCfg(CT, ne, 'radius', 30);
      G.run(1);
      var cnt0 = O(ne, 0), dist0 = O(ne, 1);
      G.spawnEnemyAt(62, 60, 0);
      G.run(1);
      var cnt1 = O(ne, 0), dist1 = O(ne, 1);
      chk('node.enemy', cnt0 === 0 && dist0 === 30 && cnt1 >= 1 && dist1 < 30,
        '적 없음 → 마릿수 ' + cnt0 + ' 거리 ' + dist0 + ' (반경 30이어야) · 적 1마리 → ' +
        cnt1 + ' / ' + r2(dist1));

      // ---- 연산: 비교 6종 ----
      freshCtrl();
      var ops = ['>', '>=', '<', '<=', '==', '!='];
      var expect = { '>': 0, '>=': 1, '<': 0, '<=': 1, '==': 1, '!=': 0 };  // 5 vs 5
      var cmpBad = [];
      for (var ci = 0; ci < ops.length; ci++) {
        var a5 = K(5, 0, ci * 60), b5 = K(5, 100, ci * 60);
        var cn = N('cmp', 300, ci * 60); G.gCfg(CT, cn, 'op', ops[ci]);
        L(a5, 0, cn, 0); L(b5, 0, cn, 1);
        G.run(1);
        if (O(cn) !== expect[ops[ci]]) cmpBad.push(ops[ci] + '=' + O(cn) + '(기대 ' + expect[ops[ci]] + ')');
      }
      chk('node.cmpAllOps', cmpBad.length === 0,
        '5 vs 5 로 6개 연산자 검산 → ' + (cmpBad.length ? '어긋남: ' + cmpBad.join(', ') : '전부 일치'));

      // ---- 연산: 사칙 7종 + 0 나눗셈 ----
      freshCtrl();
      var mops = [['+', 3, 4, 7], ['-', 3, 4, -1], ['*', 3, 4, 12], ['/', 12, 4, 3],
                  ['%', 13, 4, 1], ['min', 3, 4, 3], ['max', 3, 4, 4],
                  ['/', 5, 0, 0], ['%', 5, 0, 0]];      // 0 나눗셈은 0 이어야 (NaN 금지)
      var mBad = [];
      for (var mi = 0; mi < mops.length; mi++) {
        var o = mops[mi];
        var ma = K(o[1], 0, mi * 60), mb = K(o[2], 100, mi * 60);
        var mn = N('math', 300, mi * 60); G.gCfg(CT, mn, 'op', o[0]);
        L(ma, 0, mn, 0); L(mb, 0, mn, 1);
        G.run(1);
        var got = O(mn);
        if (got !== o[3]) mBad.push(o[1] + o[0] + o[2] + '=' + got + '(기대 ' + o[3] + ')');
      }
      chk('node.mathAllOps', mBad.length === 0,
        '사칙 9경우 검산(0 나눗셈 포함) → ' + (mBad.length ? '어긋남: ' + mBad.join(', ') : '전부 일치'));

      // ---- 연산: 논리 4종 ----
      freshCtrl();
      var bops = [['AND', 1, 1, 1], ['AND', 1, 0, 0], ['OR', 1, 0, 1], ['OR', 0, 0, 0],
                  ['XOR', 1, 0, 1], ['XOR', 1, 1, 0], ['NOT A', 0, 1, 1], ['NOT A', 1, 0, 0]];
      var bBad = [];
      for (var bi = 0; bi < bops.length; bi++) {
        var q = bops[bi];
        var qa = K(q[1], 0, bi * 60), qb = K(q[2], 100, bi * 60);
        var qn = N('bool', 300, bi * 60); G.gCfg(CT, qn, 'op', q[0]);
        L(qa, 0, qn, 0); L(qb, 0, qn, 1);
        G.run(1);
        if (O(qn) !== q[3]) bBad.push(q[0] + '(' + q[1] + ',' + q[2] + ')=' + O(qn) + '≠' + q[3]);
      }
      chk('node.boolAllOps', bBad.length === 0,
        '논리 8경우 검산 → ' + (bBad.length ? '어긋남: ' + bBad.join(', ') : '전부 일치'));

      // ---- 연산: 범위 제한 ----
      freshCtrl();
      var clBad = [];
      var clCases = [[-5, 0], [50, 50], [500, 100]];
      for (var li = 0; li < clCases.length; li++) {
        var lk2 = K(clCases[li][0], 0, li * 60);
        var cl = N('clamp', 300, li * 60); G.gCfg(CT, cl, 'lo', 0); G.gCfg(CT, cl, 'hi', 100);
        L(lk2, 0, cl, 0);
        G.run(1);
        if (O(cl) !== clCases[li][1]) clBad.push(clCases[li][0] + '→' + O(cl) + '≠' + clCases[li][1]);
      }
      chk('node.clamp', clBad.length === 0,
        '범위 제한 0~100 에 -5/50/500 → ' + (clBad.length ? clBad.join(', ') : '전부 일치'));

      // ---- 연산: 선택 ----
      freshCtrl();
      var sc = K(1, 0, 0), sa = K(11, 0, 60), sb = K(22, 0, 120);
      var sn = N('select', 300, 0);
      L(sc, 0, sn, 0); L(sa, 0, sn, 1); L(sb, 0, sn, 2);
      G.run(1);
      var selTrue = O(sn);
      G.gCfg(CT, sc, 'value', 0);
      G.run(1);
      chk('node.select', selTrue === 11 && O(sn) === 22,
        '조건1 → ' + selTrue + ' (A=11) · 조건0 → ' + O(sn) + ' (B=22)');

      // ---- 연산: SR 래치 (RESET 우선) ----
      freshCtrl();
      var ls = K(0, 0, 0), lr = K(0, 0, 60);
      var ln = N('latch', 300, 0);
      L(ls, 0, ln, 0); L(lr, 0, ln, 1);
      G.gCfg(CT, ls, 'value', 1); G.run(1);
      var q1 = O(ln);
      G.gCfg(CT, ls, 'value', 0); G.run(1);
      var q2 = O(ln);                                  // SET 내려도 유지
      G.gCfg(CT, lr, 'value', 1); G.run(1);
      var q3 = O(ln);
      G.gCfg(CT, ls, 'value', 1); G.run(1);            // SET·RESET 동시 → RESET 우선
      var q4 = O(ln);
      chk('node.latch', q1 === 1 && q2 === 1 && q3 === 0 && q4 === 0,
        'SET→' + q1 + ' · SET해제→' + q2 + '(유지) · RESET→' + q3 + ' · SET+RESET동시→' + q4 + '(RESET 우선)');

      // ---- 연산: 카운터 (상승 엣지에서만) ----
      freshCtrl();
      var ck = K(0, 0, 0), crst = K(0, 0, 60);
      var cn2 = N('counter', 300, 0); G.gCfg(CT, cn2, 'max', 0);
      L(ck, 0, cn2, 0); L(crst, 0, cn2, 1);
      for (var ci2 = 0; ci2 < 3; ci2++) {
        G.gCfg(CT, ck, 'value', 1); G.run(1);
        G.gCfg(CT, ck, 'value', 0); G.run(1);
      }
      var cVal = O(cn2);
      // 신호를 계속 1로 두면 더 안 세어야 한다 (상승 엣지 계수)
      G.gCfg(CT, ck, 'value', 1); G.run(2);
      var cVal2 = O(cn2);
      G.gCfg(CT, crst, 'value', 1); G.run(1);
      chk('node.counter', cVal === 3 && cVal2 === 4 && O(cn2) === 0,
        '펄스 3회 → ' + cVal + ' · 계속 1로 2초 → ' + cVal2 + ' (1만 늘어야) · 리셋 → ' + O(cn2));

      // ---- 연산: 엣지 검출 3종 ----
      freshCtrl();
      var eBad = [];
      var eModes = ['상승', '하강', '양쪽'];
      for (var ei = 0; ei < eModes.length; ei++) {
        var ek = K(0, 0, ei * 120);
        var en2 = N('edge', 300, ei * 120); G.gCfg(CT, en2, 'mode', eModes[ei]);
        L(ek, 0, en2, 0);
        G.run(1);
        var rise = 0, fall = 0;
        G.gCfg(CT, ek, 'value', 1); G.tickOnce(); if (O(en2) >= 0.5) rise++;
        G.tickOnce();
        G.gCfg(CT, ek, 'value', 0); G.tickOnce(); if (O(en2) >= 0.5) fall++;
        var want = { '상승': [1, 0], '하강': [0, 1], '양쪽': [1, 1] }[eModes[ei]];
        if (rise !== want[0] || fall !== want[1]) {
          eBad.push(eModes[ei] + ': 상승' + rise + '/하강' + fall + ' (기대 ' + want.join('/') + ')');
        }
      }
      chk('node.edge', eBad.length === 0,
        '엣지 3모드 검산 → ' + (eBad.length ? eBad.join(' · ') : '전부 일치'));

      // ---- 연산: 샘플 홀드 ----
      freshCtrl();
      var hv = K(10, 0, 0), hs = K(0, 0, 60);
      var hn = N('hold', 300, 0);
      L(hv, 0, hn, 0); L(hs, 0, hn, 1);
      G.gCfg(CT, hs, 'value', 1); G.run(1);
      var h1 = O(hn);
      G.gCfg(CT, hs, 'value', 0); G.gCfg(CT, hv, 'value', 99); G.run(1);
      var h2 = O(hn);
      chk('node.hold', h1 === 10 && h2 === 10,
        '값10 샘플1 → ' + h1 + ' · 값을 99로 바꾸고 샘플0 → ' + h2 + ' (10을 유지해야)');

      // ---- 연산: PID ----
      // 목표 100, 측정 0 이면 오차 100 이고 출력은 Kp*오차 방향(양수)이어야 한다.
      freshCtrl();
      var pt = K(100, 0, 0), pm = K(0, 0, 60);
      var pn = N('pid', 300, 0);
      G.gCfg(CT, pn, 'kp', 1); G.gCfg(CT, pn, 'ki', 0); G.gCfg(CT, pn, 'kd', 0);
      G.gCfg(CT, pn, 'lim', 1000);
      L(pt, 0, pn, 0); L(pm, 0, pn, 1);
      G.run(1);
      var pOut = O(pn, 0), pErr = O(pn, 1);
      chk('node.pid', pErr === 100 && pOut > 0,
        '목표100 측정0 Kp=1 → 오차 ' + pErr + ' · 출력 ' + r2(pOut) + ' (오차 100, 출력 양수여야)');

      // ---- 출력 6종은 세계를 실제로 움직이는가 ----
      freshCtrl();
      var oAsm = G.place('assembler', 64, 60, 0);
      var oBelt = G.place('belt', 68, 60, 1);
      var oIns = G.place('inserter', 70, 60, 1);
      var oTur = G.place('turret', 72, 64, 0);
      var on1 = K(0, 0, 0);
      var oe = N('enable', 300, 0);   G.gCfg(CT, oe, 'ent', oAsm);  L(on1, 0, oe, 0);
      var og = N('gate', 300, 60);    G.gCfg(CT, og, 'ent', oBelt); L(on1, 0, og, 0);
      var of2 = N('filter', 300, 120); G.gCfg(CT, of2, 'ent', oIns);
      G.gCfg(CT, of2, 'a', 'iron-plate'); G.gCfg(CT, of2, 'b', 'gear'); L(on1, 0, of2, 0);
      var ofi = N('fire', 300, 180);  G.gCfg(CT, ofi, 'ent', oTur); L(on1, 0, ofi, 0);
      var olp = N('lamp', 300, 240);  G.gCfg(CT, olp, 'label', '시험경보'); L(on1, 0, olp, 0);
      var odp = N('display', 300, 300); G.gCfg(CT, odp, 'label', '시험값'); L(on1, 0, odp, 0);
      G.run(1);
      var s0 = G.state();
      // **조건별로 쪼갠다.** 뭉쳐 놓으면 어디가 깨졌는지 알 수 없어 진단이 안 된다.
      var rig = { asm: !!oAsm, belt: !!oBelt, ins: !!oIns, tur: !!oTur };
      chk('node.outputRigBuilt', rig.asm && rig.belt && rig.ins && rig.tur,
        '출력 시험용 대상 배치 ' + JSON.stringify(rig));
      var off = {
        asmOff: G.ent(oAsm).enabled === false,
        filterA: G.ent(oIns).filter === 'iron-plate',
        fireOff: G.ent(oTur).fireOk === false,
        noAlarm: s0.alarms.indexOf('시험경보') < 0,
        gateShut: G.gateState(oBelt) === false
      };
      G.gCfg(CT, on1, 'value', 1); G.run(1);
      var s1 = G.state();
      var on = {
        asmOn: G.ent(oAsm).enabled === true,
        filterB: G.ent(oIns).filter === 'gear',
        fireOn: G.ent(oTur).fireOk === true,
        alarm: s1.alarms.indexOf('시험경보') >= 0,
        gateOpen: G.gateState(oBelt) === true
      };
      function allTrue(o) { for (var k in o) if (!o[k]) return false; return true; }
      chk('node.allOutputsAct', allTrue(off) && allTrue(on),
        '신호 0 → ' + JSON.stringify(off) + ' · 신호 1 → ' + JSON.stringify(on));
      var dsp = s1.displays.filter(function (d) { return d.label === '시험값'; });
      chk('node.displayShows', dsp.length === 1 && dsp[0].value === 1,
        '수치 표시 → ' + JSON.stringify(dsp));

      // ---- 연산: 평활 필터 ----
      // 이 스윕은 노드 하나를 홀로 세워 놓고 본다. 계단응답의 해석해가 오라클이다.
      freshCtrl();
      var flIn = K(0, 0, 0);
      var fln = N('smooth', 300, 0); G.gCfg(CT, fln, 'tau', 2);
      L(flIn, 0, fln, 0);
      G.run(0.5);
      var flZero = O(fln);
      G.gCfg(CT, flIn, 'value', 10);
      G.run(2);                                   // t = τ → 63.2%
      var flAtTau = O(fln);
      G.run(4);                                   // t = 3τ → 95.0%
      var flAt3 = O(fln);
      chk('node.smooth',
        Math.abs(flZero) < 1e-9 &&
        Math.abs(flAtTau - 6.32121) < 0.01 && Math.abs(flAt3 - 9.50213) < 0.01,
        'τ=2, 입력 0→10 계단: t=0 에서 ' + r2(flZero) + ' · t=τ 에서 ' + r2(flAtTau) +
        ' (오라클 6.32) · t=3τ 에서 ' + r2(flAt3) + ' (오라클 9.50)');

      // ---- 연산: 변화율 ----
      // 홀로 세워 놓고 **계단이 아니라 경사**를 준다. 상수 노드를 한 틱마다 일정
      // 폭으로 올리면 기울기가 정확히 (폭 × 60)/s 다 — 이 수는 게임의 어느 상수도
      // 아니고 시험이 만든 입력에서 나온다.
      freshCtrl();
      var rtIn = K(0, 0, 0);
      var rtn = N('rate', 300, 0); G.gCfg(CT, rtn, 'win', 0);
      L(rtIn, 0, rtn, 0);
      G.tickOnce();
      var rtFirst = O(rtn);                        // 첫 평가 — 이전 값이 없으니 0
      var vv = 0;
      for (var rq = 0; rq < 30; rq++) { vv += 2; G.gCfg(CT, rtIn, 'value', vv); G.tickOnce(); }
      var rtSlope = O(rtn);
      G.run(1);                                    // 값을 멈추면 기울기도 멈춘다
      var rtStop = O(rtn);
      chk('node.rate',
        Math.abs(rtFirst) < 1e-9 && Math.abs(rtSlope - 120) < 1e-6 && Math.abs(rtStop) < 1e-9,
        '첫 평가 ' + r2(rtFirst) + ' (0이어야) · 틱마다 +2 → ' + r2(rtSlope) +
        ' /s (오라클 2×60 = 120) · 값을 멈추면 ' + r2(rtStop) + ' (0이어야)');

      // ---- 연산: 상태기계 ----
      // 네 전이를 같은 신호에 물려 순환시킨다. 상승엣지 한 번에 한 칸이어야 한다.
      freshCtrl();
      var fsGo2 = K(0, 0, 0), fsRs2 = K(0, 0, 120);
      var fsn = N('fsm', 300, 0);
      L(fsGo2, 0, fsn, 0); L(fsGo2, 0, fsn, 1); L(fsGo2, 0, fsn, 2); L(fsGo2, 0, fsn, 3);
      L(fsRs2, 0, fsn, 4);
      G.run(0.2);
      var fsA = O(fsn, 0);
      G.gCfg(CT, fsGo2, 'value', 1); G.run(0.5);   // 참으로 계속 붙들어도 한 칸
      var fsB = O(fsn, 0);
      var fsHot = [O(fsn, 1), O(fsn, 2), O(fsn, 3), O(fsn, 4)].join(',');
      G.gCfg(CT, fsGo2, 'value', 0); G.run(0.2);
      G.gCfg(CT, fsGo2, 'value', 1); G.run(0.2);   // 다시 올리면 한 칸 더
      var fsC2 = O(fsn, 0);
      G.gCfg(CT, fsRs2, 'value', 1); G.run(0.2);
      var fsD = O(fsn, 0);
      chk('node.fsm',
        fsA === 1 && fsB === 2 && fsHot === '0,1,0,0' && fsC2 === 3 && fsD === 1,
        '시작 ' + fsA + '단계 → 조건 유지 30틱 ' + fsB + '단계(2여야) · 단계출구 [' + fsHot +
        '] · 내렸다 올림 ' + fsC2 + '단계(3여야) · 리셋 ' + fsD + '단계(1이어야)');

      // ---- 입력: 유체 잔량 ----
      // 네 출구를 한 번에 본다. 증기%와 증기 개수가 따로 있는 이유는 임계값을
      // 비율로 잡는 회로와 절대량으로 잡는 회로가 둘 다 자연스럽기 때문이다.
      freshCtrl();
      var flPump = G.place('pump', 64, 60, 0);
      var flPipe = G.place('pipe', 65, 60, 0);
      var flBoil = G.place('boiler', 66, 60, 0);
      G.setInv('coal', 1); G.putFromStock(flBoil);
      var flN = N('fluid', 0, 0); G.gCfg(CT, flN, 'ent', flPipe);
      G.run(1);
      var flTrue = G.fluid(flPipe);
      var flPct = O(flN, 0), flSteam = O(flN, 1), flWater = O(flN, 2), flConn = O(flN, 3);
      chk('node.fluid',
        !!flPump && !!flPipe && !!flBoil && flConn === 1 &&
        // **한 틱 지연이 정상이다.** 틱 순서가 로직 → 유체 → 전력이라 센서는 직전
        // 틱의 유체 상태를 본다(기계 상태 센서도 같다). 보일러가 60/s 로 만드는
        // 중이면 한 틱 = 1.0 만큼 벌어질 수 있으므로 허용치를 그만큼 준다.
        Math.abs(flSteam - flTrue.steam) <= 1.5 && Math.abs(flPct - flTrue.steamPct) <= 0.3 &&
        flWater > 0 && Math.abs(flTrue.cap - 600) < 1,
        '펌프+파이프+보일러(용량 ' + flTrue.cap + ', 6칸×100 이어야) → 센서: 증기 ' +
        r2(flSteam) + ' (실제 ' + r2(flTrue.steam) + ') · ' + r2(flPct) + '% · 물 ' +
        r2(flWater) + ' · 망연결 ' + flConn);
      // 음성 대조군 — 망 밖(대상 미지정)은 망연결 0
      var flN2 = N('fluid', 0, 300);
      G.run(0.2);
      chk('node.fluidDisconnected', O(flN2, 3) === 0 && O(flN2, 1) === 0,
        '대상 미지정 → 망연결 ' + O(flN2, 3) + ' · 증기 ' + O(flN2, 1) + ' (둘 다 0이어야)');

      // ---- 입력/출력: 역 상태 · 열차 출발 ----
      // 이 둘은 짝이다 — 읽고(열차 있음·화물) 정한다(보낸다/붙잡는다).
      // 그래서 한 리그에서 같이 본다.
      freshCtrl();
      var tvRails = [];
      for (var tv = 0; tv < 9; tv++) tvRails.push(G.place('rail', 64 + tv, 60, 0));
      var tvA = G.place('station', 64, 61, 0);
      var tvB = G.place('station', 72, 61, 0);
      G.trainAdd(64, 60);
      var tvS = N('station', 0, 0); G.gCfg(CT, tvS, 'ent', tvA);
      var tvZero = K(0, 0, 300);
      var tvGo = N('traingo', 300, 0); G.gCfg(CT, tvGo, 'ent', tvA);
      L(tvZero, 0, tvGo, 0);
      G.run(12);                                    // 정차 5초의 두 배 넘게 붙잡는다
      var tvHas = O(tvS, 0), tvCargo = O(tvS, 1), tvPct = O(tvS, 2);
      var tvMoving = G.trainList()[0].moving;
      chk('node.stationAndTrainGo',
        !!tvA && !!tvB && tvRails.length === 9 && tvHas === 1 && tvCargo === 0 &&
        tvPct === 0 && tvMoving === false,
        '역 센서 → 열차있음 ' + tvHas + ' · 화물 ' + tvCargo + ' · ' + r2(tvPct) +
        '% · 출발 허가 거짓으로 12초 → 이동중 ' + tvMoving + ' (false 여야 · 기본값은 5초 뒤 출발)');
      // 음성 대조군 — 허가를 참으로 바꾸면 떠나야 한다. 안 그러면 위 검사는
      // "열차가 원래 안 움직인다"는 구현도 통과시킨다.
      G.gCfg(CT, tvZero, 'value', 1);
      G.run(0.5);
      chk('node.trainGoReleases', G.trainList()[0].moving === true,
        '허가를 참으로 → 이동중 ' + G.trainList()[0].moving + ' (true 여야 · 조건 발생 확인)');

      // ---- 출력/입력: 신호 버스 ----
      // 한 제어기 안에서도 보내고 받을 수 있지만, 값은 **다음 틱**에 온다.
      // 두 송신이 합산되는지도 같은 자리에서 본다.
      freshCtrl();
      var buA2 = K(3, 0, 0), buB2 = K(4, 0, 120);
      var buS1 = N('bussend', 300, 0);   G.gCfg(CT, buS1, 'ch', 'A'); L(buA2, 0, buS1, 0);
      var buS2 = N('bussend', 300, 120); G.gCfg(CT, buS2, 'ch', 'A'); L(buB2, 0, buS2, 0);
      var buS3 = N('bussend', 300, 240); G.gCfg(CT, buS3, 'ch', 'B'); L(buA2, 0, buS3, 0);
      var buR = N('busrecv', 600, 0);    G.gCfg(CT, buR, 'ch', 'A');
      G.tickOnce();
      var buT1 = O(buR);                            // 같은 틱엔 아직 0
      G.tickOnce();
      var buT2 = O(buR);                            // 다음 틱에 3+4
      var buChans = JSON.stringify(G.bus());
      chk('node.bus',
        buT1 === 0 && buT2 === 7 && G.bus('A') === 7 && G.bus('B') === 3 && G.bus('C') === 0,
        '3+4 를 채널 A 로 송신 → 첫 틱 수신 ' + buT1 + '(0이어야) · 다음 틱 ' + buT2 +
        '(7이어야) · 채널 전체 ' + buChans);

      // ======================= 2. 모든 건물 =============================
      freshCtrl();
      var types = G.buildingTypes();
      out.measured.buildingTypes = types.length;
      var placeFail = [];
      for (var bt = 0; bt < types.length; bt++) {
        var ty = types[bt];
        var ok = false;
        for (var tryY = 0; tryY < 12 && !ok; tryY++) {
          if (G.place(ty, 40 + bt * 4, 40 + tryY * 4, 1)) ok = true;
        }
        if (!ok) placeFail.push(ty + ' — ' + G.whyPlace(ty, 40 + bt * 4, 40, 1));
      }
      chk('sweep.everyBuildingPlaceable', placeFail.length === 0,
        '건물 ' + types.length + '종 배치 → 실패 ' + placeFail.length +
        (placeFail.length ? ': ' + placeFail.join(' | ') : ''));

      // ======================= 3. 모든 레시피 ===========================
      freshCtrl();
      var recipes = G.recipeIds();
      out.measured.recipes = recipes.length;
      var craftFail = [];
      for (var ri = 0; ri < recipes.length; ri++) {
        var rid = recipes[ri], info = G.recipeInfo(rid);
        if (info.cat === 'craft' && info.handOk) {
          for (var k in info.inp) G.setInv(k, 999);
          var before = G.state().inventory[rid] || 0;
          G.handCraft(rid);
          // 손 조립은 **시간이 든다**. 넣자마자 나오면 그건 고장이다 — 즉시 완성이면
          // 조립기를 세울 이유가 없어져 이 장르의 전제가 무너진다. 음성 대조군으로
          // "레시피 시간의 절반이 지난 시점엔 아직 안 나왔다"를 함께 잰다.
          G.run(info.time * 0.5);
          if ((G.state().inventory[rid] || 0) > before) craftFail.push(rid + '(손조립이 즉시 완성됨)');
          G.run(info.time * 0.6 + 0.2);
          if ((G.state().inventory[rid] || 0) <= before) craftFail.push(rid + '(손조립)');
        } else if (info.cat === 'smelt') {
          var fz = G.place('furnace', 44 + ri * 3, 70, 0);
          if (!fz) { craftFail.push(rid + '(용광로 배치 실패)'); continue; }
          G.setRecipe(fz, rid);
          for (var k2 in info.inp) G.fillChest(fz, k2, 50);
          G.run(info.time * 3 + 2);
          if ((G.ent(fz).out[rid] || 0) < 1) craftFail.push(rid + '(제련)');
        }
      }
      // 만들 수 있는 것에는 **쓸 데가 있어야 한다.** 강철은 레시피와 아이템만 있고
      // 소비처가 한 곳도 없었다 — 적팩 50개짜리 연구가 "철판을 버리는 기능"을 열었다.
      // 최종재(연구팩)와 원광은 예외다. 나머지는 어딘가의 입력이어야 한다.
      // 면제는 **소비처를 밝힌 것만** 넣는다. "쓰는 데가 있겠지" 로 비우면
      // 이 게이트는 아무것도 못 잡는다 (강철이 정확히 그렇게 빠져 있었다).
      var SINK_EXEMPT = {
        'sci-red': '연구소가 먹는다', 'sci-green': '연구소가 먹는다',
        'coal': '발전기가 태운다', 'ammo': '터렛이 쏜다',
        'iron-ore': '용광로 입력', 'copper-ore': '용광로 입력', 'stone': '용광로 입력'
      };
      var consumed = {};
      var allRec = G.recipeIds();
      for (var cr = 0; cr < allRec.length; cr++) {
        var inpMap = G.recipeInfo(allRec[cr]).inp;
        for (var ik in inpMap) consumed[ik] = 1;
      }
      var bts = G.buildingTypes();
      for (var bt = 0; bt < bts.length; bt++) {
        var bcost = G.buildingInfo(bts[bt]).cost;
        for (var bk in bcost) consumed[bk] = 1;
      }
      var deadEnds = [];
      for (var pr = 0; pr < allRec.length; pr++) {
        var outMap = G.recipeInfo(allRec[pr]).out;
        for (var ok2 in outMap) if (!consumed[ok2] && !SINK_EXEMPT[ok2]) deadEnds.push(ok2);
      }
      chk('sweep.noDeadEndItems', deadEnds.length === 0,
        '만들 수 있는데 아무 데도 안 쓰이는 품목 ' + deadEnds.length + '종' +
        (deadEnds.length ? ': ' + deadEnds.join(', ') + ' — 만들 이유가 없는 것을 연구로 열어 주고 있다'
                         : ' (연구팩·원광은 제외)'));

      chk('sweep.everyRecipeProducible', craftFail.length === 0,
        '레시피 ' + recipes.length + '종 → 실패 ' + craftFail.length +
        (craftFail.length ? ': ' + craftFail.join(', ') : ''));

      // ======================= 4. 모든 연구 =============================
      G.reset(424242); G.clearEntities(); G.giveAll(99999); G.powerCheat(true);
      var techs = G.techIds();
      out.measured.techs = techs.length;
      var techFail = [];
      for (var tI = 0; tI < techs.length; tI++) {
        G.research(techs[tI]);
        if (!G.state().research.done.includes(techs[tI])) techFail.push(techs[tI]);
      }
      // 연구가 실제로 무언가를 여는지 — 잠긴 노드가 풀렸는지로 본다
      var lockedAfter = G.nodeKinds().filter(function (k) { return !G.nodeAvailable(k); });
      chk('sweep.everyTechUnlocks', techFail.length === 0 && lockedAfter.length === 0,
        '연구 ' + techs.length + '종 완료 → 실패 ' + techFail.length +
        ' · 아직 잠긴 노드 ' + lockedAfter.length + (lockedAfter.length ? ': ' + lockedAfter.join(',') : ''));

      // ======================= 5. 저장/복원 왕복 =========================
      // 노드 전 종류가 든 그래프를 저장하고 복원해도 값이 같아야 한다.
      freshCtrl();
      var allNodes = [];
      for (var ki = 0; ki < kinds.length; ki++) allNodes.push(N(kinds[ki], 100 + ki * 12, ki * 30));
      G.run(2);
      var infoBefore = G.gInfo(CT);
      var raw = G.save();
      G.reset(999);
      G.load(raw);
      var ctrl2 = null, idsL = G.entIds();
      for (var q2 = 0; q2 < idsL.length; q2++) if (idsL[q2][1] === 'controller') ctrl2 = idsL[q2][0];
      var infoAfter = ctrl2 ? G.gInfo(ctrl2) : null;
      chk('sweep.saveKeepsAllNodeKinds',
        !!infoAfter && infoAfter.nodes === infoBefore.nodes,
        '노드 ' + kinds.length + '종이 든 그래프 저장→복원 → 노드 ' +
        infoBefore.nodes + ' → ' + (infoAfter ? infoAfter.nodes : '없음'));

      out.measured.anomalies = anomalies;
      chk('sweep.noAnomalies', anomalies.length === 0,
        '오라클과 어긋난 것 ' + anomalies.length + '건' +
        (anomalies.length ? ': ' + anomalies.join(' | ') : ''));

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', kinds.length < 0, '노드 종류 수가 음수일 리 없다', true);
      out.finalState = G.state();
      void SP;
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      try { out.errors = window.__GAME ? window.__GAME.errors() : []; } catch (e2) { void e2; }
    }
    emit(out);
  }
  function go() { setTimeout(runAll, 80); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
