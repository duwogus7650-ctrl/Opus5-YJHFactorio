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

      // ---------- 0. 화면에 뜬 판이 화면 안에 있는가 -----------------------
      // **이 절은 실기 스크린샷이 만들어 냈다.** 여기 있던 게이트들은 측정 전에
      // `G.ui.closeHelp()` 로 도움말을 닫고 있었다 — 그래서 도움말 판이 폭 680px 로
      // 화면(390) 밖 왼쪽 145px 에 걸쳐 있고, 그 폭 때문에 브라우저가 화면 전체를
      // 축소해 넣던 것을 **한 번도 못 봤다.** 깨진 상태를 피해 다니는 검사는 검사가
      // 아니다. 그래서 판을 하나씩 열어 놓고 잰다.
      // **레이아웃이 둘이다.** 좁은 화면은 바닥 시트, 넓은 터치 화면(태블릿)은
      // 데스크톱과 같은 좌우 도크다. 시트 전제의 검사를 도크에 들이대면 게이트가
      // 레이아웃 탓에 빨개진다 — 그건 게이트가 아니라 잡음이다.
      var NARROW = !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
      out.measured.narrow = NARROW;

      function panelBox(id) {
        var el = document.getElementById(id);
        if (!el) return null;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return null;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { id: id, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
      }
      // **목록을 손으로 적지 않는다.** 처음엔 일곱 개를 적어 뒀는데, 그 사이 연구 판이
      // 똑같이 660px 데스크톱 대화상자로 남아 있다가 실기에서 화면을 깨뜨렸다 — 목록에
      // 없어서 아무도 안 봤다. 화면에 있는 판을 시험이 스스로 훑는다. 새 판이 생기면
      // 자동으로 대상이 된다.
      var PANEL_IDS = (function () {
        var ids = [], seen = {};
        var els = document.querySelectorAll('.panel, #logic, #mobBar, #right');
        for (var i = 0; i < els.length; i++) {
          var id = els[i].id;
          if (id && !seen[id]) { seen[id] = 1; ids.push(id); }
        }
        return ids;
      })();
      out.measured.panelIds = PANEL_IDS;
      function visiblePanels() {
        var out2 = [];
        for (var i = 0; i < PANEL_IDS.length; i++) {
          var p2 = panelBox(PANEL_IDS[i]); if (p2) out2.push(p2);
        }
        return out2;
      }
      function clippedList() {
        var bad = [], ps = visiblePanels();
        for (var i = 0; i < ps.length; i++) {
          var p3 = ps[i];
          if (p3.l < -1) bad.push(p3.id + ' 왼쪽 ' + Math.round(-p3.l) + 'px 밖');
          if (p3.r > VW + 1) bad.push(p3.id + ' 오른쪽 ' + Math.round(p3.r - VW) + 'px 밖');
        }
        return bad;
      }

      // (a) 도움말을 **열어 놓고** 잰다 — 여기가 실제로 깨져 있던 자리다
      G.ui.openHelp();
      var clipOpen = clippedList();
      var helpBox = panelBox('help');
      chk('mobile.helpFitsOnScreenWhenOpen',
        !!helpBox && clipOpen.length === 0 && helpBox.l >= -1 && helpBox.r <= VW + 1,
        helpBox ? ('도움말 ' + Math.round(helpBox.l) + '..' + Math.round(helpBox.r) +
                   ' (화면 0..' + VW + ') · 화면 밖으로 나간 판 ' + clipOpen.length + '건' +
                   (clipOpen.length ? ': ' + clipOpen.join(' · ') : ''))
                : '도움말이 안 열렸다');

      // (b) 열린 상태에서도 브라우저가 축소해 넣지 않아야 한다.
      //     넓은 판 하나가 레이아웃을 넓히면 **글자 전체가 쪼그라든다** — 실기에서
      //     레이아웃 뷰포트가 390 이 아니라 535 로 커져 있었다.
      var layoutOpen = document.documentElement.clientWidth;
      var scaleOpen = window.visualViewport ? window.visualViewport.scale : 1;
      chk('mobile.noShrinkToFitWithHelpOpen',
        layoutOpen <= window.screen.width + 1 && scaleOpen <= 1.01,
        '도움말 열린 채 레이아웃 뷰포트 ' + layoutOpen + 'px · 기기 폭 ' +
        window.screen.width + 'px · 배율 ' + scaleOpen);

      // (c) 음성 대조군 — 이 자로 재면 **정말 밖에 나간 것을 잡는가.**
      //     도움말을 일부러 왼쪽으로 200px 밀어 보고 같은 검사를 돌린다.
      var helpEl = document.getElementById('help');
      var savedLeft = helpEl.style.left;
      helpEl.style.left = '-200px'; helpEl.style.right = 'auto';
      var clipBait = clippedList();
      helpEl.style.left = savedLeft; helpEl.style.right = '';
      var clipBack = clippedList();
      chk('mobile.clipCheckDetectsOffscreen',
        clipBait.length > 0 && clipBack.length === 0,
        '일부러 200px 밀었을 때 걸린 건수 ' + clipBait.length + ' (0 이면 이 검사는 죽은 것) · ' +
        '되돌린 뒤 ' + clipBack.length + '건');

      // (d) 큰 판 둘이 겹치면 아무것도 안 읽힌다. 열린 판들끼리 겹치지 않아야 한다.
      //     (조작 바·상단 계기는 늘 있는 틀이라 셈에서 뺀다.)
      function overlaps() {
        var ps = visiblePanels().filter(function (q) { return q.id !== 'mobBar' && q.id !== 'top'; });
        var hits = [];
        for (var i = 0; i < ps.length; i++) {
          for (var j = i + 1; j < ps.length; j++) {
            var A = ps[i], B = ps[j];
            var ov = Math.max(0, Math.min(A.b, B.b) - Math.max(A.t, B.t)) *
                     Math.max(0, Math.min(A.r, B.r) - Math.max(A.l, B.l));
            if (ov > 400) hits.push(A.id + '×' + B.id + ' ' + Math.round(ov) + 'px²');
          }
        }
        return hits;
      }
      var ovOpen = NARROW ? overlaps() : [];
      chk('mobile.openPanelsDoNotOverlap', ovOpen.length === 0,
        (NARROW ? '' : '(넓은 레이아웃 — 도크와 대화상자는 겹쳐도 된다) ') +
        '도움말 열린 상태에서 겹친 판 ' + ovOpen.length + '건' +
        (ovOpen.length ? ': ' + ovOpen.join(' · ') : '') +
        ' · 떠 있는 판 ' + visiblePanels().map(function (q) { return q.id; }).join(','));

      G.ui.closeHelp();

      // (d-1) **연구 판을 열어 놓고도** 잰다. 도움말과 판박이 결함이 여기 남아 있었다.
      var techBtn0 = document.getElementById('btnTech');
      if (techBtn0) tap(techBtn0, 10, 10);
      var clipTech = clippedList();
      var techBox = panelBox('tech');
      chk('mobile.techPanelFitsOnScreen',
        !!techBox && clipTech.length === 0,
        (techBox ? ('연구 판 ' + Math.round(techBox.l) + '..' + Math.round(techBox.r) +
                    ' (화면 0..' + VW + ')') : '연구 판이 안 열렸다') +
        ' · 화면 밖으로 나간 판 ' + clipTech.length + '건' +
        (clipTech.length ? ': ' + clipTech.join(' · ') : ''));
      var layoutTech = document.documentElement.clientWidth;
      chk('mobile.noShrinkToFitWithTechOpen', layoutTech <= window.screen.width + 1,
        '연구 판 열린 채 레이아웃 뷰포트 ' + layoutTech + 'px · 기기 폭 ' + window.screen.width + 'px');
      if (techBtn0) tap(techBtn0, 10, 10);      // 닫는다

      // (d-2) **시트를 열어 놓고도** 잰다. 첫 화면만 보면 시트가 닫혀 있어서, 시트와
      // 튜토리얼이 같은 자리에 겹치는 결함을 영원히 못 본다 — 실제로 돌연변이 두 개가
      // 이 자리에서 통과해 버렸고(놓침), 그래서 상태를 하나 더 넣었다.
      if (NARROW) {
        var openBtn = document.getElementById('btnSheetBuild');
        if (openBtn) tap(openBtn, 10, 10);
      }
      var ovSheet = NARROW ? overlaps() : [];
      var sheetBox = panelBox('build'), tutBox = panelBox('tutor');
      chk('mobile.openSheetDoesNotCoverTutorial', ovSheet.length === 0,
        (NARROW
          ? ('건설 시트 ' + (sheetBox ? Math.round(sheetBox.t) + '..' + Math.round(sheetBox.b) : '없음') +
             ' · 튜토리얼 ' + (tutBox ? Math.round(tutBox.t) + '..' + Math.round(tutBox.b) : '없음') +
             ' · 겹친 판 ' + ovSheet.length + '건' + (ovSheet.length ? ': ' + ovSheet.join(' · ') : ''))
          : '(넓은 레이아웃 — 도크라 해당 없음)'));
      // 시트가 **상단 계기까지 덮으면 안 된다.** 시간·전력·오염은 판을 열어 둔 채로도
      // 봐야 하는 값이다. 겹침 검사만으로는 이걸 못 잡는다 — 시트는 아래에서 위로
      // 자라므로 튜토리얼과는 안 겹치면서 위쪽 계기만 먹어 들어간다(돌연변이 실증).
      var topBox2 = panelBox('top');
      var sheetTop = sheetBox ? sheetBox.t : null;
      chk('mobile.openSheetKeepsTopBarVisible',
        !NARROW || (sheetTop !== null && topBox2 && sheetTop >= topBox2.b - 1),
        (NARROW
          ? ('상단 계기 아래끝 ' + (topBox2 ? Math.round(topBox2.b) : '?') + 'px · 건설 시트 윗끝 ' +
             (sheetTop === null ? '없음' : Math.round(sheetTop)) + 'px (시트가 계기 아래에서 시작해야 한다)')
          : '(넓은 레이아웃 — 도크라 해당 없음)'));

      if (NARROW) {
        var closeBtn = document.getElementById('btnSheetBuild');
        if (closeBtn) tap(closeBtn, 10, 10);      // 다시 닫는다 (뒤 검사가 첫 화면을 본다)
      }

      // (e) 첫 화면에서 **지도가 보여야 한다.** 판이 화면을 다 덮으면 게임이 아니다.
      //     실측으로 90px 만 남은 적이 있다(건설 시트 + 튜토리얼이 같이 떠서).
      var covered = 0, ps0 = visiblePanels();
      for (var pi = 0; pi < ps0.length; pi++) {
        if (ps0[pi].id === 'top') continue;          // 상단 계기는 얇은 띠다
        covered += Math.max(0, Math.min(ps0[pi].b, VH) - Math.max(ps0[pi].t, 0));
      }
      var mapH = VH - covered;
      chk('mobile.mapStaysVisibleOnFirstScreen', !NARROW || mapH >= VH * 0.35,
        (NARROW ? '' : '(넓은 레이아웃 — 판이 좌우 도크라 높이 합은 척도가 아니다) ') +
        '첫 화면에서 지도로 남은 높이 ' + Math.round(mapH) + 'px / ' + VH +
        'px (' + Math.round(mapH / VH * 100) + '%) · 35% 이상이어야 · 떠 있는 판 ' +
        ps0.map(function (q) { return q.id; }).join(','));

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

      // 건설 시트는 **처음엔 닫혀 있다** (예전엔 미리 열어 뒀는데, 튜토리얼 판까지
      // 같이 떠서 지도가 90px 밖에 안 남았다). 그러니 이 검사는 "목록이 보이는가" 가
      // 아니라 **"버튼을 눌러 목록에 닿을 수 있는가"** 를 봐야 한다 — 폰에서 그게
      // 실제 경로다. 여기서 탭까지 하면 '건설' 버튼이 죽어 있을 때도 걸린다.
      var beforeOpen = onScreen(document.querySelector('#buildList .bitem'));
      if (NARROW) {
        var sheetBtn = document.getElementById('btnSheetBuild');
        if (sheetBtn) tap(sheetBtn, 10, 10);   // tap 은 좌표를 반드시 받는다(생략하면 NaN)
      }
      var firstBuild = document.querySelector('#buildList .bitem');
      chk('mobile.buildListReachable',
        NARROW ? (onScreen(firstBuild) && !beforeOpen) : onScreen(firstBuild),
        (NARROW ? '[건설] 누르기 전 보임=' + beforeOpen + ' → 누른 뒤 보임=' + onScreen(firstBuild) +
                  ' (좁은 화면은 처음엔 닫혀 있고 눌러야 열려야 한다)'
                : '넓은 레이아웃 — 도크라 처음부터 보여야 한다: ' + onScreen(firstBuild)) +
        (firstBuild ? ' · 위치 ' + JSON.stringify(firstBuild.getBoundingClientRect()) : ' · 항목 없음'));

      // ---------- 2.35 제어기 계기 줄이 화면 안에 있는가 --------------------
      // 제어기가 값을 화면 위에 띄우는 줄이다. 가운데 정렬 + 폭 제한이 없어서 값이
      // 서너 개만 넘어도 양옆이 잘렸다 — **녹화 영상에서 처음 드러났다.** 게이트는
      // 그때까지 이 줄을 아예 안 보고 있었다(판 목록에 없었고, 값이 없으면 빈 줄이라
      // 있어도 안 보인다). 그래서 **값을 실제로 여러 개 띄워 놓고** 잰다.
      G.reset(5150); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.research('logic-mem');
      var dCtl = G.place('controller', 78, 78, 0);
      var dLabels = ['철판(평활)', '철판변화/s', '습격 3초 + 0', '습격단계', '습격횟수', '여유kW', '화물%'];
      for (var di = 0; di < dLabels.length; di++) {
        var kn = G.gAdd(dCtl, 'const', 0, di * 40);
        G.gCfg(dCtl, kn, 'value', 1234);
        var dn = G.gAdd(dCtl, 'display', 200, di * 40);
        G.gCfg(dCtl, dn, 'label', dLabels[di]);
        G.gLink(dCtl, kn, 0, dn, 0);
      }
      G.run(0.5);
      G.ui.refresh();                 // 계기 줄은 프레임 루프가 그린다 — 여기선 직접 부른다
      var dRow = document.getElementById('dispRow');
      var dr = dRow ? dRow.getBoundingClientRect() : null;
      var dCount = dRow ? dRow.querySelectorAll('.disp').length : 0;
      // **재는 것은 '줄이 화면 안인가' 가 아니다.** 처음엔 그렇게 쟀다가 돌연변이를
      // 놓쳤다 — 데스크톱 규칙으로 되돌려도 줄 자체는 353px 로 화면 안에 있었고,
      // 값들만 그 상자 밖으로 흘러 나가 화면 밖에서 사라졌다.
      // 진짜 기준: 내용이 줄보다 넓다면 **손가락으로 밀어서 닿을 수 있어야 한다.**
      var dOver = dRow ? (dRow.scrollWidth > dRow.clientWidth + 1) : false;
      var dOv = dRow ? getComputedStyle(dRow).overflowX : '';
      var dScrollable = dOv === 'auto' || dOv === 'scroll';
      chk('mobile.displayRowFitsOnScreen',
        !!dr && dCount >= 5 && dr.left >= -1 && dr.right <= VW + 1 &&
        (!dOver || dScrollable),
        '계기 ' + dCount + '개 · 줄 ' + Math.round(dr ? dr.left : -999) + '..' +
        Math.round(dr ? dr.right : -999) + ' (화면 0..' + VW + ') · 내용 폭 ' +
        (dRow ? dRow.scrollWidth : '?') + ' vs 줄 폭 ' + (dRow ? dRow.clientWidth : '?') +
        ' · 넘침=' + dOver + ' · overflow-x=' + dOv +
        ' (넘치면 밀어서 볼 수 있어야 한다 — 안 그러면 값이 화면 밖에서 사라진다)');

      // ---------- 2.4 시트가 상단 계기를 덮지 않는가 (연구 판 포함) ---------
      // 시간·전력·오염은 판을 열어 둔 채로도 봐야 하는 값이다. 연구 판은 62vh 로
      // 잡혀 있어 상단 계기 위까지 올라와 있었다(실측: ✕ 가 y=13 — 계기 띠 한복판).
      var topBox3 = panelBox('top');
      var sheetTops = [];
      var SHEET_IDS = ['tech', 'help'];
      for (var st3 = 0; st3 < SHEET_IDS.length; st3++) {
        var bid = SHEET_IDS[st3] === 'tech' ? 'btnTech' : 'btnHelp';
        var bel = document.getElementById(bid);
        if (bel) tap(bel, 10, 10);
        var pb = panelBox(SHEET_IDS[st3]);
        if (pb) sheetTops.push({ id: SHEET_IDS[st3], t: pb.t });
        if (bel) tap(bel, 10, 10);
      }
      var coveringTop = sheetTops.filter(function (q) {
        return topBox3 && q.t < topBox3.b - 1;
      });
      chk('mobile.sheetsKeepTopBarVisible', !NARROW || coveringTop.length === 0,
        (NARROW
          ? ('상단 계기 아래끝 ' + (topBox3 ? Math.round(topBox3.b) : '?') + 'px · 판 윗끝 ' +
             sheetTops.map(function (q) { return q.id + ':' + Math.round(q.t); }).join(' ') +
             ' · 계기를 덮은 판 ' + coveringTop.length + '건')
          : '(넓은 레이아웃 — 해당 없음)'));

      // ---------- 2.45 튜토리얼을 닫으면 되돌아올 수 있는가 -----------------
      // 닫는 ✕ 는 화면에 있는데 **다시 여는 길은 건설 판 머리에 숨어 있었다** — 닫고
      // 나면 그런 버튼이 있다는 사실조차 알 수 없다. 실기에서 "튜토리얼이 사라졌다" 로
      // 나타났다. 닫아 보고, 화면에 보이는 손잡이로 되돌아오는지까지 잰다.
      var tutClose = document.getElementById('tutorClose');
      if (tutClose) tap(tutClose, 5, 5);
      var tutGone = !panelBox('tutor');
      var tutChip = document.getElementById('tutorChip');
      var chipVisible = !!tutChip && getComputedStyle(tutChip).display !== 'none' && onScreen(tutChip);
      if (chipVisible) tap(tutChip, 10, 10);
      var tutBack = !!panelBox('tutor');
      chk('mobile.tutorialCanBeReopened',
        tutGone && (!NARROW || chipVisible) && tutBack,
        '✕ 로 닫힘=' + tutGone + ' · 되돌리는 손잡이가 화면에 보임=' + chipVisible +
        ' → 눌러서 돌아옴=' + tutBack + ' (닫는 길만 있고 여는 길이 없으면 갇힌다)');

      // ---------- 2.5 고른 도구를 그만둘 수 있는가 --------------------------
      // 폰에는 ESC 도 우클릭도 없다. 한 번 고르면 지도를 누를 때마다 계속 지어지고,
      // 푸는 길이 화면에 없으면 **갇힌다** — 실기 제보가 정확히 그것이었다.
      if (NARROW) {
        var openB = document.getElementById('btnSheetBuild');
        if (openB) tap(openB, 10, 10);
      }
      var firstItem = document.querySelector('#buildList .bitem:not(.locked)');
      if (firstItem) tap(firstItem, 10, 10);
      var pickedSel = !!document.querySelector('#buildList .bitem.sel');
      var chipEl = document.getElementById('toolChip');
      var chipShown = !!chipEl && getComputedStyle(chipEl).display !== 'none';
      var chipOnScreen = chipShown && onScreen(chipEl);
      if (chipShown) tap(chipEl, 10, 10);
      var stillSel = !!document.querySelector('#buildList .bitem.sel');
      chk('mobile.canCancelSelectedTool',
        pickedSel && (!NARROW || (chipShown && chipOnScreen)) && !stillSel,
        '건물 고름=' + pickedSel + ' · 취소 칩 보임=' + chipShown +
        ' · 화면 안=' + chipOnScreen + ' → 누른 뒤 아직 골라져 있나=' + stillSel +
        ' (폰에는 ESC 가 없다 — 화면에 그만두는 길이 있어야 한다)');

      // 음성 대조군 — 목록에서 같은 것을 다시 눌러도 풀려야 한다(두 번째 길).
      var again = document.querySelector('#buildList .bitem:not(.locked)');
      if (again) { tap(again, 10, 10); }
      var onAfterFirst = !!document.querySelector('#buildList .bitem.sel');
      if (again) { tap(again, 10, 10); }
      var onAfterSecond = !!document.querySelector('#buildList .bitem.sel');
      chk('mobile.reTapDeselects', onAfterFirst && !onAfterSecond,
        '한 번 누름 → 골라짐=' + onAfterFirst + ' · 같은 것을 다시 누름 → 골라짐=' +
        onAfterSecond + ' (다시 누르면 풀려야 한다)');
      if (NARROW) {
        var closeB2 = document.getElementById('btnSheetBuild');
        if (closeB2 && document.body.classList.contains('sheet-build')) tap(closeB2, 10, 10);
      }

      // ---------- 2.6 꾹 눌러 자리 잡고, 떼면 놓인다 ------------------------
      // 손끝이 그 칸을 가리므로, 닿는 즉시 지어지면 어디에 놓였는지 나중에야 안다.
      // 실기에서 "원치 않는 자리에 계속 지어진다" 로 나타났다. 누르는 동안은 자리만
      // 잡고 떼는 순간 놓여야 한다 — **누른 채로는 아직 없어야 한다**가 요점이다.
      G.reset(424242); G.clearEntities(); G.clearEnemies();
      G.giveAll(9999); G.powerCheat(true);
      var poleItem = document.querySelector('#buildList .bitem[data-b="pole"]');
      if (!poleItem) {
        var openB3 = document.getElementById('btnSheetBuild');
        if (NARROW && openB3) tap(openB3, 10, 10);
        poleItem = document.querySelector('#buildList .bitem[data-b="pole"]');
      }
      if (poleItem) tap(poleItem, 0, 0);
      var aimFrom = tileToClient(96, 96), aimTo = tileToClient(99, 96);
      var beforeAim = !!G.entAtTile(99, 96);
      fire(cv, 'touchstart', [tp(cv, 1, aimFrom.x, aimFrom.y)]);
      var atStart = !!G.entAtTile(96, 96);                 // 누른 자리에 벌써 생겼나
      fire(cv, 'touchmove', [tp(cv, 1, aimTo.x, aimTo.y)]);
      var whileDrag = !!G.entAtTile(99, 96);
      fire(cv, 'touchend', [tp(cv, 1, aimTo.x, aimTo.y)]);
      var afterRelease = !!G.entAtTile(99, 96);
      chk('mobile.holdToAimThenReleasePlaces',
        !beforeAim && !atStart && !whileDrag && afterRelease && !G.entAtTile(96, 96),
        '누른 자리(96,96)에 생김=' + atStart + ' · 끄는 중 목적지(99,96)에 생김=' + whileDrag +
        ' → 뗀 뒤 목적지에 생김=' + afterRelease + ' · 누른 자리에 남은 것=' +
        !!G.entAtTile(96, 96) + ' (누른 채로는 안 지어지고, 떼야 그 자리에 지어져야 한다)');

      // 벨트는 예외다 — 끌어서 줄로 까는 것이 본래 조작이라 닿는 즉시 깔려야 한다.
      // (이 검사가 음성 대조군 구실도 한다: 위 검사는 '무조건 안 지어짐' 을 재는 게 아니다.)
      var beltItem2 = document.querySelector('#buildList .bitem[data-b="belt"]');
      if (beltItem2) tap(beltItem2, 0, 0);
      var bpt = tileToClient(103, 96);
      fire(cv, 'touchstart', [tp(cv, 1, bpt.x, bpt.y)]);
      var beltAtTouch = !!G.entAtTile(103, 96);
      fire(cv, 'touchend', [tp(cv, 1, bpt.x, bpt.y)]);
      chk('mobile.beltStillLaysOnTouch', beltAtTouch,
        '벨트는 닿는 즉시 깔려야 한다 — 누른 채 (103,96) 에 생김=' + beltAtTouch);
      // **고른 것을 풀고 넘긴다.** 안 풀면 뒤 검사가 같은 항목을 다시 눌러 토글로 꺼져
      // "도구가 안 골라진다" 는 거짓 실패가 난다 (실제로 6건이 그렇게 무너졌다).
      if (beltItem2) tap(beltItem2, 0, 0);

      // ---------- 2.7 청사진: 영역을 끌어 담고, 눌러서 붙인다 ----------------
      // **마우스 경로에만 있던 기능이다.** 폰에서 [청사진] 을 눌러 모드에 들어가도
      // 손가락은 그냥 지도를 끌었다 — 담긴 것 0 · 붙인 것 0 (실측). 도움말은 폰에서도
      // 된다고 적어 두었으니, 그 문장이 거짓말이었다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.research('steel');
      for (var bq = 0; bq < 4; bq++) G.place('belt', 78 + bq, 78, 1);
      G.place('pole', 78, 80, 0);
      var bpBtn = document.getElementById('btnBlueprint');
      if (bpBtn) tap(bpBtn, 10, 10);
      var modeSel = G.ui.bpMode();
      var pa = tileToClient(77, 77), pz = tileToClient(82, 81);
      swipe(cv, pa.x, pa.y, pz.x, pz.y, 6);
      var capt = G.bpEnts() || [];
      var modePaste = G.ui.bpMode();
      chk('mobile.blueprintCaptureByDrag',
        modeSel === 'sel' && capt.length >= 5 && modePaste === 'paste',
        '[청사진] 탭 → 모드 ' + modeSel + ' · 영역을 끈 뒤 담긴 것 ' + capt.length +
        '개 · 모드 ' + modePaste + ' (마우스에만 있던 길이라 폰에서는 0개였다)');

      var pastePt = tileToClient(90, 90);
      var entBefore = G.state().entityCount;
      tap(cv, pastePt.x, pastePt.y);
      var pastedN = G.state().entityCount - entBefore;
      chk('mobile.blueprintPasteByTap', pastedN >= 5,
        '빈 자리를 눌러 붙여넣기 → 새로 생긴 건물 ' + pastedN + '개 (담은 ' + capt.length + '개)');
      if (bpBtn) tap(bpBtn, 10, 10);          // 모드 해제하고 넘긴다

      // ---------- 2.8 같은 안내가 쌓여 판을 덮지 않는가 ---------------------
      // 자동화가 자재 부족을 만날 때마다 한 줄씩 쌓여 다섯 줄이 화면을 덮었다
      // (실기 스크린샷 · 녹화 프레임 둘 다). 폰에서는 그게 튜토리얼 판을 통째로 가린다.
      // 반복은 정보가 아니라 소음이다 — 몇 번째인지만 알면 된다.
      var tHost = document.getElementById('toast');
      tHost.innerHTML = '';
      for (var ti2 = 0; ti2 < 5; ti2++) G.ui.toast('재료가 부족하다', 'bad');
      var rows = tHost.children.length;
      var txt = tHost.lastElementChild ? tHost.lastElementChild.textContent : '';
      chk('mobile.repeatedToastsCoalesce',
        rows === 1 && txt.indexOf('×5') >= 0,
        '같은 말을 5번 → 줄 ' + rows + '개 · 마지막 줄 "' + txt + '" (한 줄로 합치고 횟수를 적어야)');

      // 다른 말은 따로 뜬다 — 합치기가 **아무것이나** 합쳐 버리면 안 된다(음성 대조군)
      G.ui.toast('다른 안내', 'good');
      chk('mobile.differentToastsStaySeparate', tHost.children.length === 2,
        '다른 말을 하나 더 → 줄 ' + tHost.children.length + '개 (2개여야)');

      // 그리고 튜토리얼 판을 덮지 않아야 한다
      var tRect = tHost.getBoundingClientRect();
      var tutRect = panelBox('tutor');
      chk('mobile.toastsDoNotCoverTutorial',
        !NARROW || !tutRect || tRect.bottom <= tutRect.t + 1,
        (NARROW
          ? ('안내 줄 아래끝 ' + Math.round(tRect.bottom) + 'px · 튜토리얼 판 윗끝 ' +
             (tutRect ? Math.round(tutRect.t) : '없음') + 'px (안내가 판 위에 떠야 한다)')
          : '(넓은 레이아웃 — 해당 없음)'));
      tHost.innerHTML = '';

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

      // **청사진 회전도 같은 버튼으로 닿아야 한다.** R 키에만 갈림길을 넣으면
      // 키보드가 없는 기기에서 청사진 회전은 존재하지 않는 기능이 된다.
      var mbChest = G.place('chest', 60, 60, 0);
      var mbPole = G.place('pole', 62, 60, 0);
      var mbCap = G.bpCapture(59, 59, 63, 61);       // 5 x 3 — 정사각형이면 못 잰다
      G.ui.setBpMode('paste');
      var mbBefore = G.bpInfo();
      if (rotBtn) tap(rotBtn, 10, 10);
      var mbAfter = G.bpInfo();
      chk('mobile.blueprintRotateWithoutKeyboard',
        !!mbChest && !!mbPole && mbCap.count === 2 && !!mbBefore && !!mbAfter &&
        mbBefore.w !== mbBefore.h &&
        mbAfter.w === mbBefore.h && mbAfter.h === mbBefore.w,
        '붙여넣기 모드에서 회전 버튼 탭 → 청사진 ' +
        (mbBefore ? mbBefore.w + 'x' + mbBefore.h : '?') + ' → ' +
        (mbAfter ? mbAfter.w + 'x' + mbAfter.h : '?') + ' (가로세로가 바뀌어야)');
      G.ui.setBpMode(null);
      G.bpClear();

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

      // ---------- 8.5 멀리 놓인 노드에 손가락으로 닿는가 --------------------
      // 편집기 판은 6000px 인데 폰 화면은 390px 다. 오른쪽에 놓인 노드는 처음에
      // 화면 밖에 있고, **배경을 끌어 화면을 옮겨야** 닿는다. 그 길이 막히면 회로를
      // 조금만 키워도 폰에서는 손댈 수 없는 노드가 생긴다 — 이 게임의 본체가 그렇게
      // 반쪽이 된다. (측정: 노드 판 내용 폭 5630px · 보이는 폭 390px)
      var farN = G.gAdd(ctrl, 'lamp', 900, 40);
      G.ui.showGraph();
      function farBox() {
        var els = document.querySelectorAll('#graphInner .node');
        for (var q2 = 0; q2 < els.length; q2++) {
          if (+els[q2].getAttribute('data-nid') === farN) return els[q2].getBoundingClientRect();
        }
        return null;
      }
      var fb0 = farBox();
      var wrapEl = document.getElementById('graphWrap');
      var wr = wrapEl.getBoundingClientRect();
      // 배경(빈 자리)을 왼쪽으로 크게 끈다
      swipe(wrapEl, wr.left + wr.width - 30, wr.top + wr.height - 60,
                    wr.left + 20, wr.top + wr.height - 60, 12);
      var fb1 = farBox();
      chk('mobile.logicGraphPansToFarNodes',
        !!fb0 && !!fb1 && fb0.left > VW && fb1.left < fb0.left - 200,
        '멀리 둔 노드 처음 x=' + (fb0 ? Math.round(fb0.left) : '?') + ' (화면 폭 ' + VW +
        ') → 배경을 끈 뒤 x=' + (fb1 ? Math.round(fb1.left) : '?') +
        ' (처음엔 화면 밖이고, 끌면 따라와야 한다)');

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

      // --- 홈화면 설치 (폰에 "앱처럼" 얹기) --------------------------------
      // 브라우저 탭으로 여는 것과 홈화면에 얹는 것은 다른 경험이다. 얹으면 주소창이
      // 사라지고 아이콘이 생기며, 그러자면 매니페스트·아이콘·상태바 메타가 필요하다.
      // **실기 설치는 여기서 검증할 수 없다** — 대신 설치에 필요한 재료가 실제로
      // 문서 안에 있고 읽히는 형태인지까지를 잰다.
      // 링크의 href 를 되읽지 않는다 — 게임이 뜨면서 blob: 로 갈아 끼우기 때문이다
      // (data: 안의 상대 주소는 풀 기준이 없어 규격상 start_url 이 탈락한다).
      // 게임이 실제로 내건 매니페스트 객체를 그대로 받아 본다.
      var manInfo = G.manifest ? G.manifest() : { man: null, href: '' };
      var man = manInfo.man, manHref = manInfo.href, manErr = man ? '' : '게임이 매니페스트를 안 내걸었다';
      chk('mobile.manifestIsInstallable',
        !!man && man.display === 'standalone' && !!man.name && !!man.short_name &&
        !!man.icons && man.icons.length >= 2 &&
        man.icons[0].src.indexOf('data:image/png;base64,') === 0,
        man ? ('이름 "' + man.name + '" · 홈화면 라벨 "' + man.short_name + '" · 표시 ' +
               man.display + ' · 아이콘 ' + man.icons.length + '종(' +
               man.icons.map(function (ic) { return ic.sizes; }).join(',') + ') · 링크 ' +
               manHref.slice(0, 12))
            : ('매니페스트를 못 읽었다: ' + (manErr || '링크 없음')));

      // start_url 은 열린 자리의 절대 주소여야 한다 — 상대 주소로 두면 규격상 탈락한다
      chk('mobile.startUrlIsAbsolute',
        !!man && typeof man.start_url === 'string' &&
        /^(https?|file|blob):/.test(man.start_url) &&
        man.start_url.indexOf(location.href.split('#')[0].split('?')[0]) === 0,
        'start_url = ' + (man ? man.start_url : '없음') + ' (지금 주소로 시작해야 한다)');

      // 아이콘이 **진짜 PNG 인가.** data: URI 는 무엇이든 담을 수 있어서, 길이만
      // 보면 깨진 바이트열도 통과한다. 서명과 IHDR 의 크기까지 되읽는다.
      var appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      var iconHref = appleIcon ? appleIcon.getAttribute('href') : '';
      var iw = 0, ih = 0, sigOk = false;
      try {
        var bin = atob(iconHref.slice(iconHref.indexOf(',') + 1));
        sigOk = bin.charCodeAt(0) === 0x89 && bin.slice(1, 4) === 'PNG';
        function be32(o) {
          return ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) |
                  (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
        }
        iw = be32(16); ih = be32(20);
      } catch (e10) { /* 아래 게이트가 실패로 드러낸다 */ }
      chk('mobile.appleTouchIconIsRealPng',
        sigOk && iw === 192 && ih === 192,
        'apple-touch-icon PNG 서명=' + sigOk + ' · 크기 ' + iw + 'x' + ih +
        ' (192x192 여야 · iOS 는 매니페스트가 아니라 이 링크를 본다)');

      chk('mobile.standaloneMetaPresent',
        !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]') &&
        !!document.querySelector('meta[name="theme-color"]') &&
        (document.querySelector('meta[name="viewport"]').getAttribute('content') || '')
          .indexOf('viewport-fit=cover') >= 0,
        '전체화면 메타=' + !!document.querySelector('meta[name="apple-mobile-web-app-capable"]') +
        ' · 테마색=' + (document.querySelector('meta[name="theme-color"]') || {}).content +
        ' · viewport-fit=cover 포함=' +
        ((document.querySelector('meta[name="viewport"]').getAttribute('content') || '')
          .indexOf('viewport-fit=cover') >= 0));

      // --- 노치 여백이 **실제로 밀어내는가** --------------------------------
      // env(safe-area-inset-*) 는 노치가 없으면 0 이라, 규칙이 있는지 문자열로 훑어봐야
      // 아무것도 검정하지 않는다. 변수를 시험이 직접 44px 로 덮어 **여백이 그만큼
      // 늘어나는지**를 잰다. 안 늘어나면 그 규칙은 어딘가에서 끊긴 것이다.
      // 레이아웃마다 요소가 다르다 — 좁은 화면에는 조작 바가 있고 태블릿에는 없다.
      // **그 레이아웃에 실제로 있는 것만** 잰다. 없는 요소를 재면 게이트가 레이아웃
      // 탓에 빨개지고, 그러면 게이트가 아니라 잡음이 된다(실제로 태블릿에서 그랬다).
      var topBar = document.getElementById('top');
      var mob = document.getElementById('mobBar');
      var mobVisible = !!mob && getComputedStyle(mob).display !== 'none';
      // **박스가 아니라 눈에 보이는 계기의 위치를 잰다.** 좁은 레이아웃에서는 여백
      // (padding) 으로 밀어내므로 박스의 top 은 0 에 그대로 있고 안의 숫자만 내려온다 —
      // 박스를 재면 폰에서 "안 밀렸다" 는 잘못된 판정이 나온다(실제로 그랬다).
      function topEdge() {
        var first = topBar.querySelector('.stat') || topBar.firstElementChild || topBar;
        return first.getBoundingClientRect().top;
      }
      var t0 = topEdge();
      var b0 = mobVisible ? (parseFloat(getComputedStyle(mob).paddingBottom) || 0) : null;
      document.documentElement.style.setProperty('--safe-t', '44px');
      document.documentElement.style.setProperty('--safe-b', '34px');
      var t1 = topEdge();
      var b1 = mobVisible ? (parseFloat(getComputedStyle(mob).paddingBottom) || 0) : null;
      document.documentElement.style.removeProperty('--safe-t');
      document.documentElement.style.removeProperty('--safe-b');
      var t2 = topEdge();
      var topOk = (t1 - t0) >= 43 && Math.abs(t2 - t0) < 0.6;
      var botOk = !mobVisible || (b1 - b0) >= 33;
      chk('mobile.safeAreaPushesContentIn', topOk && botOk,
        '상단 계기 위치 ' + Math.round(t0) + 'px → 노치 44px 로 두면 ' + Math.round(t1) +
        'px → 되돌리면 ' + Math.round(t2) + 'px' +
        (mobVisible ? (' · 조작 바 아래 여백 ' + b0 + ' → ' + b1 + 'px')
                    : ' · 이 레이아웃엔 조작 바가 없다(태블릿·데스크톱)') +
        ' (밀려나고 되돌아와야 한다 — 안 밀리면 계기가 노치 밑에 깔린다)');

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
