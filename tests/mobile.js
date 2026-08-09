// ===========================================================================
//  모바일·터치 검증 드라이버
//
//  실기 아이폰이 없어도 **진짜 TouchEvent** 로 잴 수 있다. pwrun.js 가
//  hasTouch/isMobile 을 켠 컨텍스트를 만들어 주고, 여기서는 마우스 이벤트를
//  전혀 쓰지 않는다 — mousedown 으로 통과시키면 "폰에서 되는가" 가 아니라
//  "데스크톱에서 되는가" 를 다시 재는 것이다.
//
//  규율:
//   * 손가락은 한 점이 아니다. 탭에는 약간의 흔들림(2~3px)이 섞이므로 그 상태로
//     시험한다. 흔들림 0 으로만 통과하는 코드는 실기에서 안 먹는다.
//   * 화면 밖으로 밀려난 요소는 "있다" 가 아니라 **없는 것**이다. 존재가 아니라
//     뷰포트 안에 있는지로 판정한다.
//   * 키보드가 없다. 단축키로만 되는 기능은 폰에서 존재하지 않는 기능이다.
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

  // --- 터치 합성 -------------------------------------------------------------
  // WebKit(사파리 엔진)에는 Touch 생성자가 없다. 옛 document.createTouch 로 물러서고,
  // 그것도 없으면 **조용히 건너뛰지 않는다** — 못 쟀다는 사실을 게이트로 드러낸다.
  // 여기서 몰래 통과시키면 "사파리에서 검증됨" 이라는 거짓말이 된다.
  var TOUCH_SYNTH = null;
  try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }); TOUCH_SYNTH = 'ctor'; }
  catch (e) { TOUCH_SYNTH = (typeof document.createTouch === 'function') ? 'legacy' : null; }
  var SYNTH_OK = false, SYNTH_ERR = '';

  function tp(el, id, x, y) {
    if (TOUCH_SYNTH === 'ctor') {
      return new Touch({ identifier: id, target: el, clientX: x, clientY: y,
                         pageX: x, pageY: y, screenX: x, screenY: y,
                         radiusX: 12, radiusY: 12, force: 1 });
    }
    return document.createTouch(window, el, id, x, y, x, y);
  }
  // WebKit 은 TouchEvent 생성자도 없다. 옛 createEvent/initTouchEvent 로 물러선다.
  var EV_SYNTH = null;
  try { new TouchEvent('touchstart', { bubbles: true }); EV_SYNTH = 'ctor'; }
  catch (e) {
    try {
      var probe = document.createEvent('TouchEvent');
      EV_SYNTH = (probe && typeof probe.initTouchEvent === 'function') ? 'legacy' : null;
    } catch (e2) { EV_SYNTH = null; }
  }
  function touchList(arr) {
    if (typeof document.createTouchList === 'function') {
      return document.createTouchList.apply(document, arr);
    }
    return arr;
  }
  function fire(el, type, touches) {
    var live = (type === 'touchend') ? [] : touches;
    var ev;
    if (EV_SYNTH === 'ctor') {
      ev = new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live, targetTouches: live, changedTouches: touches
      });
    } else {
      ev = document.createEvent('TouchEvent');
      var t0 = touches[0] || { clientX: 0, clientY: 0, screenX: 0, screenY: 0 };
      ev.initTouchEvent(type, true, true, window, 0,
        t0.screenX || 0, t0.screenY || 0, t0.clientX || 0, t0.clientY || 0,
        false, false, false, false,
        touchList(live), touchList(live), touchList(touches), 1, 0);
    }
    el.dispatchEvent(ev);
    return ev;
  }
  function tap(el, x, y) {
    fire(el, 'touchstart', [tp(el, 1, x, y)]);
    // 손가락은 완벽히 가만있지 않는다 — 2px 흔들림을 일부러 섞는다
    fire(el, 'touchmove', [tp(el, 1, x + 2, y + 1)]);
    var end = fire(el, 'touchend', [tp(el, 1, x + 2, y + 1)]);
    // **브라우저는 touchend 가 preventDefault 되지 않았을 때만 click 을 합성한다.**
    // 캔버스는 직접 터치를 처리하며 preventDefault 하므로 click 이 안 나가고,
    // 일반 버튼은 나간다. 그 규칙을 그대로 흉내내지 않으면 "폰에서 버튼이 안 눌린다"
    // 는 거짓 실패가 난다 — 실기에서는 눌린다.
    if (!end.defaultPrevented) {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: x + 2, clientY: y + 1 }));
    }
  }
  function swipe(el, x0, y0, x1, y1, steps) {
    steps = steps || 8;
    fire(el, 'touchstart', [tp(el, 1, x0, y0)]);
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      fire(el, 'touchmove', [tp(el, 1, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)]);
    }
    fire(el, 'touchend', [tp(el, 1, x1, y1)]);
  }
  function pinch(el, cx, cy, d0, d1) {
    var a0 = tp(el, 1, cx - d0 / 2, cy), b0 = tp(el, 2, cx + d0 / 2, cy);
    fire(el, 'touchstart', [a0, b0]);
    for (var i = 1; i <= 6; i++) {
      var d = d0 + (d1 - d0) * (i / 6);
      fire(el, 'touchmove', [tp(el, 1, cx - d / 2, cy), tp(el, 2, cx + d / 2, cy)]);
    }
    fire(el, 'touchend', [tp(el, 1, cx - d1 / 2, cy), tp(el, 2, cx + d1 / 2, cy)]);
  }

  // 뷰포트 안에 실제로 보이는가 — 존재만으로는 폰에서 쓸 수 없다
  function onScreen(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    return r.left < window.innerWidth && r.right > 0 && r.top < window.innerHeight && r.bottom > 0;
  }
  function tileToClient(tx, ty) {
    var p = G.tileToScreen(tx, ty);
    var r = document.getElementById('view').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  function runAll() {
    var out = { version: null, checks: checks, errors: [], fatal: null, notes: [], measured: {} };
    try {
      if (!window.__READY || !window.__GAME) { out.fatal = 'boot 실패'; emit(out); return; }
      G = window.__GAME;
      out.version = G.version;
      var VW = window.innerWidth, VH = window.innerHeight;
      out.measured.viewport = { w: VW, h: VH, touch: ('ontouchstart' in window),
                                maxTouchPoints: navigator.maxTouchPoints };

      // 합성 터치를 못 만드는 엔진에서는 아래 터치 게이트들이 전부 무의미하다.
      // 그 사실을 먼저 실패시켜 "이 엔진에서는 검증되지 않았다" 를 드러낸다.
      // 진짜 판정: 스크래치 요소에 실제로 한 번 쏴 본다.
      if (TOUCH_SYNTH !== null && EV_SYNTH !== null) {
        try {
          var probeEl = document.createElement('div');
          probeEl.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px';
          document.body.appendChild(probeEl);
          fire(probeEl, 'touchstart', [tp(probeEl, 1, 1, 1)]);
          fire(probeEl, 'touchend', [tp(probeEl, 1, 1, 1)]);
          document.body.removeChild(probeEl);
          SYNTH_OK = true;
        } catch (se) { SYNTH_OK = false; SYNTH_ERR = String(se && se.message || se); }
      }
      chk('mobile.canSynthesizeTouch', SYNTH_OK,
        '합성 터치 수단 = ' + (TOUCH_SYNTH || '없음') + '/' + (EV_SYNTH || '없음') +
        ' · 실제 발사 ' + (SYNTH_OK ? '성공' : '실패: ' + SYNTH_ERR) +
        ' (실패면 이 엔진에서는 터치 동작이 **검증되지 않은 것**이다 — 통과로 읽지 말 것)');
      if (!SYNTH_OK) {
        out.notes.push('이 엔진은 합성 터치를 지원하지 않아 터치 게이트를 돌리지 못했다: ' + SYNTH_ERR);
        out.errors = G.errors();
        // 조기 반환에서도 자기 시험은 반드시 남긴다. 빼면 하네스가 "고의 실패 검사가
        // 하나도 없다" 며 자기 건강을 확인 못 한 채 끝난다 (실제로 그렇게 걸렸다).
        chk('selftest.mustFail', window.innerWidth < 0, '뷰포트 폭이 음수일 리 없다', true);
        out.finalState = G.state();
        emit(out); return;
      }

      chk('mobile.isActuallyTouch',
        ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
        '뷰포트 ' + VW + 'x' + VH + ' · ontouchstart=' + ('ontouchstart' in window) +
        ' · maxTouchPoints=' + navigator.maxTouchPoints +
        ' (거짓이면 이 시험은 폰이 아니라 좁은 데스크톱을 재고 있다)');

      G.ui.closeHelp();

      // ---------- 1. 가로 스크롤이 생기면 안 된다 -------------------------
      var docW = document.documentElement.scrollWidth;
      out.measured.scrollWidth = docW;
      out.measured.screenW = window.screen.width;
      chk('mobile.noHorizontalOverflow', docW <= VW + 1,
        '문서 폭 ' + docW + 'px vs 레이아웃 뷰포트 ' + VW + 'px');

      // **위 검사만으로는 부족하다.** 레이아웃이 기기 폭보다 넓으면 모바일 브라우저는
      // 뷰포트를 콘텐츠 폭까지 넓히고 화면을 축소해 넣는다(shrink-to-fit). 그러면
      // 넘침은 사라지지만 글자가 2/3 크기로 쪼그라든다 — 첫 측정에서 기기 폭 390 에
      // 뷰포트 586 이 나와 위 검사가 **가짜로 통과**했다.
      // 진단 — 기기 폭을 넘는 요소를 실제로 찾아 남긴다. 추측으로 CSS 를 고치면
      // 엉뚱한 곳을 손대고 넘침은 그대로 남는다.
      var wide = [], allEl = document.querySelectorAll('body *');
      for (var w0 = 0; w0 < allEl.length; w0++) {
        var e0 = allEl[w0], r0 = e0.getBoundingClientRect();
        if (r0.width < 1) continue;
        // 스크롤 컨테이너(#top 같은) 안의 자식은 잘려서 스크롤될 뿐 넘침이 아니다.
        // 그걸 넘침으로 세면 고칠 것이 없는데도 계속 빨간불이 뜬다.
        var par = e0.parentElement, clipped = false;
        while (par && par !== document.body) {
          var pcs = window.getComputedStyle(par);
          if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') {
            clipped = true; break;
          }
          par = par.parentElement;
        }
        if (!clipped && (r0.right > window.screen.width + 1 || r0.width > window.screen.width + 1)) {
          wide.push((e0.id || e0.tagName + '.' + (e0.className || '')).slice(0, 28) +
                    ' w=' + Math.round(r0.width) + ' r=' + Math.round(r0.right));
        }
      }
      out.measured.tooWide = wide.slice(0, 20);
      out.measured.bodyW = Math.round(document.body.getBoundingClientRect().width);
      out.measured.docElW = Math.round(document.documentElement.getBoundingClientRect().width);
      out.measured.vvScale = window.visualViewport ? window.visualViewport.scale : null;
      out.measured.vvWidth = window.visualViewport ? Math.round(window.visualViewport.width) : null;
      out.notes.push('기기폭 초과 요소 ' + wide.length + '개: ' + wide.slice(0, 8).join(' | '));

      // **window.innerWidth 를 오라클로 쓰면 안 된다.** 기기 에뮬레이션에서는 그 값이
      // 레이아웃 뷰포트가 아니라 실제 창 크기를 낸다 (여기서 390 짜리 화면에 535 가
      // 나왔고, 나는 그걸 축소로 잘못 읽었다). 표준 척도는 documentElement.clientWidth
      // 이고, 실제 축소는 visualViewport.scale 로 본다.
      var layoutW = document.documentElement.clientWidth;
      var vvScale = window.visualViewport ? window.visualViewport.scale : 1;
      out.measured.layoutW = layoutW; out.measured.vvScale = vvScale;
      chk('mobile.noShrinkToFit',
        layoutW <= window.screen.width + 1 && vvScale <= 1.01,
        '레이아웃 뷰포트(clientWidth) ' + layoutW + 'px · 기기 폭 ' + window.screen.width +
        'px · 시각 배율 ' + vvScale + ' (배율이 1 을 넘으면 브라우저가 축소해 넣은 것이다. ' +
        'window.innerWidth=' + VW + ' 는 에뮬레이션 창 크기라 오라클이 아니다)');

      // ---------- 2. 핵심 UI 가 화면 안에 있어야 한다 ----------------------
      var cv = document.getElementById('view');
      chk('mobile.canvasOnScreen', onScreen(cv),
        '캔버스 ' + (cv ? JSON.stringify(cv.getBoundingClientRect().width + 'x' +
          cv.getBoundingClientRect().height) : '없음'));

      var firstBuild = document.querySelector('#buildList .bitem');
      chk('mobile.buildListReachable', onScreen(firstBuild),
        '건설 목록 첫 항목이 화면 안에 있는가=' + onScreen(firstBuild) +
        (firstBuild ? ' · 위치 ' + JSON.stringify(firstBuild.getBoundingClientRect()) : ' · 항목 없음'));

      // ---------- 3. 키보드 없이 되는가 ------------------------------------
      // 폰에는 키보드가 없다. R(회전)·T(연구)·H(도움말)이 단축키뿐이면
      // 그 기능은 폰에서 **존재하지 않는 기능**이다.
      var rotBtn = document.getElementById('btnRotate');
      var techBtn = document.getElementById('btnTech');
      var helpBtn = document.getElementById('btnHelp');
      // **보이는지가 아니라 눌러서 되는지로 판정한다.** 처음엔 존재만 봤는데,
      // 버튼의 onclick 을 통째로 떼는 돌연변이에도 게이트가 통과했다(MISS).
      // 아무것도 안 하는 버튼은 없는 버튼과 같다.
      var dir0 = G.ui.curDir();
      if (rotBtn) tap(rotBtn, 10, 10);
      var dir1 = G.ui.curDir();
      chk('mobile.rotateWithoutKeyboard', onScreen(rotBtn) && dir1 !== dir0,
        '회전 버튼 표시=' + onScreen(rotBtn) + ' · 탭 → 방향 ' + dir0 + ' → ' + dir1 +
        ' (R 키는 폰에 없다)');

      if (techBtn) tap(techBtn, 10, 10);
      var techOn = onScreen(document.getElementById('tech'));
      chk('mobile.techWithoutKeyboard', onScreen(techBtn) && techOn,
        '연구 버튼 표시=' + onScreen(techBtn) + ' · 탭 → 연구창 열림=' + techOn + ' (T 키는 폰에 없다)');
      if (techBtn) tap(techBtn, 10, 10);            // 다시 닫는다

      if (helpBtn) tap(helpBtn, 10, 10);
      var helpOn = onScreen(document.getElementById('help'));
      chk('mobile.helpWithoutKeyboard', onScreen(helpBtn) && helpOn,
        '도움말 버튼 표시=' + onScreen(helpBtn) + ' · 탭 → 도움말 열림=' + helpOn + ' (H 키는 폰에 없다)');
      if (helpBtn) tap(helpBtn, 10, 10);
      G.ui.closeHelp();

      // ---------- 4. 탭으로 도구를 고르고 건물을 놓는다 --------------------
      G.reset(424242); G.clearEntities(); G.clearEnemies();
      G.giveAll(9999); G.powerCheat(true);
      var beltItem = document.querySelector('#buildList .bitem[data-b="belt"]');
      if (beltItem) tap(beltItem, 0, 0);
      chk('mobile.tapSelectsTool', G.ui.curTool() === 'belt',
        '건설 목록을 탭한 뒤 선택된 도구=' + G.ui.curTool());

      var pt = tileToClient(80, 80);
      tap(cv, pt.x, pt.y);
      var placed = G.entAtTile(80, 80);
      chk('mobile.tapPlacesBuilding', !!placed,
        '(80,80) 화면좌표 ' + Math.round(pt.x) + ',' + Math.round(pt.y) +
        ' 탭 → 배치된 엔티티 ' + placed);

      // ---------- 5. 손가락 드래그로 벨트를 잇는다 -------------------------
      var a = tileToClient(84, 80), b = tileToClient(90, 80);
      swipe(cv, a.x, a.y, b.x, b.y, 12);
      var dragged = 0;
      for (var x = 84; x <= 90; x++) if (G.entAtTile(x, 80)) dragged++;
      chk('mobile.dragPlacesBelts', dragged >= 5,
        '(84,80)→(90,80) 스와이프 → 벨트 ' + dragged + '/7칸 (드래그 설치가 안 되면 한 칸씩 탭해야 한다)');

      // ---------- 5b. 철거 (폰에는 우클릭이 없다) ---------------------------
      // 이게 안 되면 잘못 놓은 건물을 영영 못 지운다 — 폰에서 게임이 성립하지 않는다.
      var demoBtn = document.getElementById('btnDemolish');
      var victim = G.entAtTile(84, 80);
      if (demoBtn) tap(demoBtn, 10, 10);
      var vp = tileToClient(84, 80);
      tap(cv, vp.x, vp.y);
      var gone = !G.entAtTile(84, 80);
      chk('mobile.demolishWithoutRightClick',
        !!demoBtn && !!victim && gone,
        '철거 버튼 ' + (!!demoBtn) + ' · (84,80) 의 엔티티 ' + victim + ' → 탭 후 사라짐=' + gone);

      // 음성 대조군 — 철거 모드를 끄면 탭이 다시 선택이어야 한다.
      // 늘 부수는 모드는 모드가 아니라 사고다.
      if (demoBtn) tap(demoBtn, 10, 10);
      var keep = G.entAtTile(85, 80);
      var kp = tileToClient(85, 80);
      tap(cv, kp.x, kp.y);
      chk('mobile.demolishOffKeepsBuilding',
        !!keep && !!G.entAtTile(85, 80),
        '철거 모드 해제 후 (85,80) 탭 → 엔티티 ' + G.entAtTile(85, 80) + ' 그대로 (부수면 안 된다)');

      // ---------- 6. 지도를 움직이고 확대한다 ------------------------------
      // 도구를 든 상태에서 스와이프하면 건설이므로, 먼저 도구를 놓는다.
      G.ui.clearTool();
      var cam0 = G.camera();
      swipe(cv, VW * 0.5, VH * 0.6, VW * 0.5 - 120, VH * 0.6 - 90, 10);
      var cam1 = G.camera();
      chk('mobile.oneFingerPans',
        Math.abs(cam1.x - cam0.x) > 1 || Math.abs(cam1.y - cam0.y) > 1,
        '도구 없이 스와이프 → 카메라 (' + Math.round(cam0.x) + ',' + Math.round(cam0.y) +
        ') → (' + Math.round(cam1.x) + ',' + Math.round(cam1.y) + ')');

      var z0 = G.camera().z;
      pinch(cv, VW / 2, VH / 2, 100, 260);
      var z1 = G.camera().z;
      chk('mobile.pinchZooms', z1 > z0 * 1.1,
        '핀치 확대 → 배율 ' + z0.toFixed(2) + ' → ' + z1.toFixed(2) + ' (휠은 폰에 없다)');

      // ---------- 7. 건물을 탭하면 인스펙터가 화면 안에 뜬다 ---------------
      var fp = tileToClient(80, 80);
      tap(cv, fp.x, fp.y);
      var insp = document.getElementById('insp');
      chk('mobile.tapOpensInspector', onScreen(insp),
        '건물 탭 → 인스펙터가 화면 안=' + onScreen(insp) +
        (insp ? ' · ' + JSON.stringify(insp.getBoundingClientRect()) : ''));

      // ---------- 8. 제어기 — 문장 화면부터 (폰에서 이게 기본이다) ---------
      var ctrl = G.place('controller', 86, 86, 0);
      G.ui.openLogic(ctrl);
      // 문장 화면이 폰 화면 안에 들어오는가. 여기가 안 보이면 폰에서는 제어기가
      // 아예 없는 기능이 된다 — 데스크톱 게이트는 이걸 하나도 안 지난다.
      var rp = document.getElementById('rulePane');
      var cardEl = rp ? rp.querySelector('.c[data-card]') : null;
      chk('mobile.ruleEditorOnScreen', !!rp && rp.classList.contains('on') && onScreen(cardEl),
        '문장 화면이 먼저 열리고 카드가 화면 안에 = ' +
        (!!cardEl ? JSON.stringify(cardEl.getBoundingClientRect().toJSON ?
                                   { w: Math.round(cardEl.getBoundingClientRect().width),
                                     h: Math.round(cardEl.getBoundingClientRect().height) } : 'n/a') : 'none'));
      // 손가락으로 카드를 눌러 규칙이 만들어지는가 (진짜 TouchEvent)
      var rulesBefore = G.ruleList(ctrl).length;
      if (cardEl) {
        var cr = cardEl.getBoundingClientRect();
        tap(cardEl, cr.left + cr.width / 2, cr.top + cr.height / 2);
      }
      chk('mobile.ruleCardByTouch', G.ruleList(ctrl).length === rulesBefore + 1,
        '카드를 손가락으로 탭 → 규칙 ' + rulesBefore + ' → ' + G.ruleList(ctrl).length + '개');
      // 드롭다운이 손가락으로 누를 만한 크기인가 (44px 은 접근성 관례)
      var selEl = document.querySelector('#rulePane .rline select');
      var selH = selEl ? Math.round(selEl.getBoundingClientRect().height) : 0;
      chk('mobile.ruleControlsTappable', selH >= 24,
        '문장 드롭다운 높이 ' + selH + 'px (24px 이상이어야 손가락으로 누른다)');
      // 회로 검사는 **새 제어기**에서 한다. 위에서 카드를 탭해 규칙이 생겼고,
      // 그 규칙이 컴파일한 노드가 회로에 들어와 있어서 '첫 번째 .node' 가
      // 우리가 만든 노드가 아니게 된다 — 앞 검사가 뒤 검사의 무대를 바꾼 것이다.
      ctrl = G.place('controller', 90, 86, 0);
      G.ui.openLogic(ctrl);
      G.ui.showGraph();
      var n1 = G.gAdd(ctrl, 'const', 20, 20);
      var n2 = G.gAdd(ctrl, 'display', 20, 200);
      G.ui.renderGraph();
      var nodeEl = document.querySelector('#graphInner .node');
      chk('mobile.logicEditorOnScreen', onScreen(nodeEl),
        '노드 편집기의 노드가 화면 안=' + onScreen(nodeEl));

      // 노드를 손가락으로 끈다
      var before = G.gPos(ctrl, n1);
      var head = document.querySelector('#graphInner .node .nhead');
      if (head) {
        var hr = head.getBoundingClientRect();
        swipe(head, hr.left + 20, hr.top + 8, hr.left + 90, hr.top + 70, 8);
      }
      var after = G.gPos(ctrl, n1);
      chk('mobile.logicNodeDragByTouch',
        !!after && (Math.abs(after.x - before.x) > 10 || Math.abs(after.y - before.y) > 10),
        '노드 머리를 끌기 → (' + before.x + ',' + before.y + ') → (' +
        (after ? after.x + ',' + after.y : '?') + ')');

      // 출력 포트에서 입력 포트로 끌어 배선한다 — 이 게임의 본체다
      var outDot = document.querySelector('#graphInner .node .dot[data-out]');
      var inDot = document.querySelectorAll('#graphInner .node .dot[data-in]');
      var linksBefore = G.gInfo(ctrl).links;
      // 진단은 **발사 전에** 뜬다. tup() 이 renderGraph() 로 DOM 을 새로 만들기 때문에
      // 발사 뒤에 같은 참조를 재면 떨어져 나간 노드의 0x0 사각을 읽게 된다
      // (처음에 그렇게 재서 "입력점 크기 0" 이라는 엉뚱한 단서를 얻었다).
      if (outDot && inDot.length) {
        var pre = inDot[inDot.length - 1].getBoundingClientRect();
        var preO = outDot.getBoundingClientRect();
        var hitPre = document.elementFromPoint(pre.left + pre.width / 2, pre.top + pre.height / 2);
        out.notes.push('배선 진단(발사 전): 출력점 ' + JSON.stringify(
            { l: Math.round(preO.left), t: Math.round(preO.top), w: Math.round(preO.width) }) +
          ' · 입력점 ' + JSON.stringify(
            { l: Math.round(pre.left), t: Math.round(pre.top), w: Math.round(pre.width) }) +
          ' · 입력점 좌표의 요소 = ' + (hitPre ? hitPre.tagName + '.' + hitPre.className +
            ' data-in=' + hitPre.getAttribute('data-in') : 'null'));
      }
      if (outDot && inDot.length) {
        var o = outDot.getBoundingClientRect(), i2 = inDot[inDot.length - 1].getBoundingClientRect();
        fire(outDot, 'touchstart', [tp(outDot, 1, o.left + o.width / 2, o.top + o.height / 2)]);
        for (var s = 1; s <= 8; s++) {
          var t2 = s / 8;
          var mx = o.left + (i2.left - o.left) * t2, my = o.top + (i2.top - o.top) * t2;
          fire(document.getElementById('graphWrap') || outDot, 'touchmove', [tp(outDot, 1, mx, my)]);
        }
        fire(inDot[inDot.length - 1], 'touchend',
             [tp(inDot[inDot.length - 1], 1, i2.left + i2.width / 2, i2.top + i2.height / 2)]);
      }
      var linksAfter = G.gInfo(ctrl).links;
      chk('mobile.logicWiringByTouch', linksAfter > linksBefore,
        '포트에서 포트로 끌기 → 배선 ' + linksBefore + ' → ' + linksAfter +
        ' (안 되면 이 게임의 본체를 폰에서 못 쓴다)');
      G.ui.closeLogic();
      void n2;

      // ---------- 9. 탭 표적이 손가락 크기인가 ------------------------------
      // 접근성 지침의 최소 타깃은 44x44 CSS px 다. 그보다 작으면 오탭이 난다.
      var small = [], all = document.querySelectorAll(
        '#buildList .bitem, #top button, #side button, .close');
      for (var q = 0; q < all.length; q++) {
        if (!onScreen(all[q])) continue;
        var rr = all[q].getBoundingClientRect();
        if (rr.height < 44) small.push((all[q].id || all[q].className) + ':' + Math.round(rr.height));
      }
      out.measured.smallTargets = small;
      chk('mobile.tapTargetsBigEnough', small.length === 0,
        '높이 44px 미만인 탭 표적 ' + small.length + '개' +
        (small.length ? ' — ' + small.slice(0, 6).join(', ') : ''));

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', VW < 0, '뷰포트 폭이 음수일 리 없다', true);
      out.finalState = G.state();
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
