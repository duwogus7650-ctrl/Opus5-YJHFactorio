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

      // ---------- 2.3 상단 계기가 밀지 않고 다 보이는가 ----------------------
      // [프레임] 계기를 맨 끝에 붙였더니 화면 밖으로 밀려 사용자가 "어디를 열어?" 라고
      // 물었다. 밀어야 보이는 계기는 사실상 없는 계기다. 여덟 칸이 폰 폭 안에 다
      // 들어가야 한다(더 좁은 기기를 위해 스크롤은 보루로 남긴다).
      var topEl = document.getElementById('top');
      var stats = topEl.querySelectorAll('.stat');
      var lastStat = stats[stats.length - 1];
      var lastR = lastStat ? lastStat.getBoundingClientRect() : null;
      var lastLabel = lastStat ? lastStat.querySelector('.k').textContent : '';
      chk('mobile.allGaugesVisibleWithoutScrolling',
        !NARROW || (stats.length >= 8 && topEl.scrollWidth <= topEl.clientWidth + 2 &&
                    lastR.right <= VW + 1 && lastLabel === '프레임'),
        (NARROW
          ? ('계기 ' + stats.length + '칸 · 줄 내용 폭 ' + topEl.scrollWidth + ' vs 보이는 폭 ' +
             topEl.clientWidth + ' · 마지막 칸 "' + lastLabel + '" 오른쪽 끝 ' +
             Math.round(lastR.right) + ' (화면 ' + VW + ')')
          : '(넓은 레이아웃 — 해당 없음)'));

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

      // ---------- 2.95 인스펙터 안에서 실제로 조작이 되는가 ------------------
      // 게이트는 "탭하면 인스펙터가 열린다" 까지만 보고 있었다. 그 판 **안에서 하는 일**
      // (레시피 고르기·켜고 끄기·철거)은 아무도 안 봤다 — 청사진이 마우스에만 있던 것과
      // 같은 모양의 사각지대다. 레시피를 못 고르면 폰에서 공장이 자라지 않는다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      var asmId = G.place('assembler', 80, 80, 0);
      var asmPt = tileToClient(81, 81);
      tap(cv, asmPt.x, asmPt.y);
      var inspEl = document.getElementById('insp');
      var inspOpen = getComputedStyle(inspEl).display !== 'none';
      var recSel = document.getElementById('recSel');
      var opts = recSel ? Array.prototype.map.call(recSel.options, function (o) { return o.value; }) : [];
      if (recSel) {
        recSel.value = 'gear';
        recSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var recipeSet = G.ent(asmId).recipe;
      G.run(0.4);                      // 0.2초 주기 갱신을 지나 보낸다
      var recSel2 = document.getElementById('recSel');
      chk('mobile.inspectorRecipeCanBeChosen',
        inspOpen && opts.indexOf('gear') >= 0 && recipeSet === 'gear' &&
        !!recSel2 && recSel2.value === 'gear',
        '인스펙터 열림=' + inspOpen + ' · 선택지 ' + opts.length + '개 · 고른 뒤 레시피 ' +
        recipeSet + ' · 갱신 뒤 드롭다운 값 ' + (recSel2 ? recSel2.value : '없음') +
        ' (갱신이 값을 되돌리면 폰에서 레시피를 못 건다)');

      var tglB = document.getElementById('tglBtn');
      var enBefore = G.ent(asmId).enabled;
      if (tglB) tap(tglB, 5, 5);
      var enAfter = G.ent(asmId).enabled;
      var delB = document.getElementById('delBtn');
      var entBefore2 = G.state().entityCount;
      if (delB) tap(delB, 5, 5);
      var gone = !G.entAtTile(81, 81);
      chk('mobile.inspectorToggleAndDemolish',
        enBefore === true && enAfter === false && gone && G.state().entityCount < entBefore2,
        '켜짐 ' + enBefore + ' → 버튼 탭 → ' + enAfter + ' · [철거] 탭 → 사라짐=' + gone +
        ' (엔티티 ' + entBefore2 + ' → ' + G.state().entityCount + ')');

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

      // ---------- 8.85 안내가 도구 칩을 덮지 않는가 --------------------------
      // 실기 스크린샷: 채광기를 든 채 못 놓는 자리를 눌렀더니 '이미 뭔가 있다' 가
      // '채광기 놓는 중 — 눌러서 그만두기 ✕' 위에 정확히 얹혔다. 지금 뭘 들고 있는지와
      // 그만두는 길을 가리는 안내는 도움이 아니라 방해다.
      // 튜토리얼 판에 대해서는 이미 재고 있었는데(toastsDoNotCoverTutorial) **칩은
      // 아무도 안 봤다** — 나중에 만든 것이라 검사 목록에 안 들어갔다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      var chipTool = document.querySelector('#buildList .bitem[data-b="miner"]');
      if (chipTool) tap(chipTool, chipTool.getBoundingClientRect().left + 30,
                                  chipTool.getBoundingClientRect().top + 20);
      var toastBox2 = document.getElementById('toast');
      if (toastBox2) toastBox2.innerHTML = '';
      G.ui.toast('이미 뭔가 있다');
      G.ui.toast('재료가 부족하다');
      // **짝을 손으로 적지 않는다.** 화면 아래에 고정된 것들은 같은 자리를 두고
      // 다투는 한 가족이다(조작 바·도구 칩·튜토리얼 손잡이·튜토리얼 판·안내 줄).
      // 짝을 적어 두는 방식으로는 나중에 만든 것이 늘 빠진다 — 이 레포에서 네 번째다.
      // 그래서 **아래쪽에 떠 있는 것을 전부 모아** 서로 겹치는지 본다. 새로 만드는
      // 것은 자동으로 이 검사에 든다.
      function bottomFloaters() {
        var out = [];
        var cand = document.querySelectorAll('#mobBar, #toolChip, #tutorChip, #tutor, #toast .tmsg');
        for (var ci = 0; ci < cand.length; ci++) {
          var el = cand[ci];
          if (getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') continue;
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (r.top > window.innerHeight || r.bottom < 0) continue;
          out.push({ name: el.id || (el.className + ':' + el.textContent.trim().slice(0, 12)), r: r });
        }
        return out;
      }
      var floaters = bottomFloaters(), covered = [];
      for (var fi = 0; fi < floaters.length; fi++) {
        for (var fj = fi + 1; fj < floaters.length; fj++) {
          var A = floaters[fi].r, Bb = floaters[fj].r;
          if (!(A.bottom <= Bb.top || A.top >= Bb.bottom || A.right <= Bb.left || A.left >= Bb.right)) {
            covered.push(floaters[fi].name + '↔' + floaters[fj].name);
          }
        }
      }
      var chipEl = document.getElementById('toolChip');
      var hasChip = floaters.some(function (f) { return f.name === 'toolChip'; });
      var hasMsg = floaters.some(function (f) { return f.name.indexOf('tmsg') === 0; });
      chk('mobile.toastsDoNotCoverToolChip',
        hasChip && hasMsg && covered.length === 0,
        '아래에 떠 있는 것 ' + floaters.length + '개(' +
        floaters.map(function (f) { return f.name.split(':')[0]; }).join(',') + ') · 겹친 짝 ' +
        covered.length + (covered.length ? ' — ' + covered.join(' · ') : '') +
        ' · 도구 칩 떠 있음=' + hasChip + ' · 안내 줄 떠 있음=' + hasMsg +
        ' (둘 중 하나라도 없으면 이 검사는 아무것도 안 본 것이다)');
      void chipEl;
      G.ui.clearTool();
      if (toastBox2) toastBox2.innerHTML = '';

      // ---------- 8.9 같은 건물 하나 더 (폰에는 Q 가 없다) --------------------
      // 데스크톱은 Q 로 커서 아래 건물을 손에 든다. 폰에 그 길이 없으면 건물 목록을
      // 열어 이름으로 다시 찾아야 하고, 방향은 손으로 다시 맞춰야 한다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      var cpId = G.place('inserter', 80, 80, 2);      // 방향 2 로 세운다 — 방향까지 따라와야 한다
      G.ui.clearTool();
      var cpPt = tileToClient(80, 80);
      tap(cv, cpPt.x, cpPt.y);
      var copyBtn = document.getElementById('copyBtn');
      var cpVisible = !!copyBtn && onScreen(copyBtn);
      if (copyBtn) tap(copyBtn, copyBtn.getBoundingClientRect().left + 20,
                                copyBtn.getBoundingClientRect().top + 20);
      // **읽기 전용 창구로 본다.** G.ui.tool() 은 인자를 받는 설정 함수라
      // 빈 인자로 부르면 오히려 손을 비운다 — 재려다 상태를 바꿔 버린다.
      var toolNow = G.ui.curTool();
      var dirNow = G.ui.curDir();
      chk('mobile.copyBuildingWithoutKeyboard',
        cpVisible && toolNow === 'inserter' && dirNow === 2,
        '[복제] 버튼 보임=' + cpVisible + ' · 누른 뒤 손에 든 것=' + toolNow +
        ' (inserter 여야) · 방향=' + dirNow + ' (2 여야 — 방향까지 안 따라오면 다시 맞춰야 한다)');
      G.ui.clearTool();
      void cpId;

      // ---------- 8.95 오염 보기 (P 키뿐이었다) ------------------------------
      // 적이 오는 이유가 오염인데, 폰에는 P 가 없어 **오염을 볼 방법이 아예 없었다.**
      var pollBtn = document.getElementById('pollBtn');
      var pollSeen = false, pollOn0 = null, pollOn1 = null;
      // **시트가 이미 열려 있을 수 있다.** 무턱대고 버튼을 누르면 오히려 닫힌다
      // (첫 판이 그래서 '화면 안=false' 였다). 상태를 보고 필요할 때만 누른다.
      function openRightSheet(want) {
        var el = document.getElementById('right');
        var isOpen = !!el && getComputedStyle(el).display !== 'none';
        if (isOpen === want) return;
        var b2 = document.getElementById('btnSheetRight');
        if (!b2) return;
        var rb = b2.getBoundingClientRect();
        tap(b2, rb.left + rb.width / 2, rb.top + rb.height / 2);
      }
      if (pollBtn) {
        openRightSheet(true);
        pollSeen = onScreen(pollBtn);
        pollOn0 = G.gfx().pollution;
        var pr = pollBtn.getBoundingClientRect();
        tap(pollBtn, pr.left + pr.width / 2, pr.top + pr.height / 2);
        pollOn1 = G.gfx().pollution;
        tap(pollBtn, pr.left + pr.width / 2, pr.top + pr.height / 2);   // 되돌린다
        openRightSheet(false);
      }
      // 기본값이 켜짐이라 '켜지는가' 로 물으면 안 된다 — **뒤집히는가** 로 묻고,
      // 되돌린 뒤 처음 값으로 돌아오는지까지 본다.
      chk('mobile.pollutionViewWithoutKeyboard',
        pollSeen && pollOn1 === !pollOn0 && G.gfx().pollution === pollOn0,
        '[오염 보기] 화면 안=' + pollSeen + ' · ' + pollOn0 + ' → ' + pollOn1 +
        ' → ' + G.gfx().pollution + ' (P 키는 폰에 없다)');

      // **버튼이 지금 상태를 말하는가.** 실기기에서 "눌러도 반응이 없다"는 보고가 왔다.
      // 상태는 실제로 뒤집히고 있었지만(위 게이트가 그것만 봤다), 기본값이 켜짐인데
      // 버튼은 꺼진 모양이라 첫 탭이 끄는 것이었고, 초반 판은 오염이 거의 없어 화면도
      // 그대로였다. **뒤집혔는가와 뒤집힌 것이 보이는가는 다른 질문이다.**
      var pollLabel0 = null, pollLabel1 = null, pollToast = '';
      if (pollBtn) {
        openRightSheet(true);
        pollLabel0 = pollBtn.textContent.trim() + '|' + pollBtn.className;
        // **앞선 검사의 안내 줄이 아직 떠 있다.** 태블릿에서 '청사진 회전 — 3x5' 를
        // 읽고 실패했다 — 첫 줄을 읽으면 남의 말을 읽는다. 비우고 나서 누른다.
        var toastBox = document.getElementById('toast');
        if (toastBox) toastBox.innerHTML = '';
        var pr2 = pollBtn.getBoundingClientRect();
        tap(pollBtn, pr2.left + pr2.width / 2, pr2.top + pr2.height / 2);
        pollLabel1 = pollBtn.textContent.trim() + '|' + pollBtn.className;
        var tEl = document.querySelector('#toast .tmsg');
        pollToast = tEl ? tEl.textContent.trim() : '';
        tap(pollBtn, pr2.left + pr2.width / 2, pr2.top + pr2.height / 2);
        openRightSheet(false);
      }
      chk('mobile.pollutionButtonSaysItsState',
        !!pollLabel0 && pollLabel0 !== pollLabel1 && /오염/.test(pollToast),
        '버튼 ' + pollLabel0 + ' → ' + pollLabel1 + ' · 안내 "' + pollToast +
        '" (라벨도 안 바뀌고 안내도 없으면 폰에서는 아무 일도 안 일어난 것과 같다)');

      // ---------- 8.955 시트가 한 장의 판인가 --------------------------------
      // 시트는 판 여러 개를 틈을 두고 쌓는다. 시트 자체가 투명이면 그 틈으로 지도가
      // 비쳐 글자가 게임 화면 위에 떠 있는 것처럼 보인다(실기 스크린샷).
      // **문자열이 아니라 손가락이 닿는 것으로 잰다** — 틈 자리를 짚었을 때 잡히는
      // 요소가 캔버스면 그 자리는 뚫린 것이다.
      openRightSheet(true);
      var sheetEl = document.getElementById('right');
      var kids = sheetEl ? sheetEl.children : [];
      var holes = [];
      for (var ki = 0; ki + 1 < kids.length; ki++) {
        var aR = kids[ki].getBoundingClientRect(), bR = kids[ki + 1].getBoundingClientRect();
        var midY = (aR.bottom + bR.top) / 2;
        if (midY <= 0 || midY >= window.innerHeight) continue;
        var hit = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(midY));
        if (hit && (hit.id === 'view' || hit.tagName === 'CANVAS')) {
          holes.push(Math.round(midY) + 'px→' + (hit.id || hit.tagName));
        }
      }
      // **덮였는가와 가려지는가는 다른 질문이다.** elementFromPoint 는 투명한 요소도
      // 잡아 주므로(히트 테스트는 색을 안 본다) 그것만으로는 '비친다'를 못 잡는다 —
      // 배경을 투명으로 되돌리는 돌연변이가 그 틈으로 빠져나갔다. 불투명도를 함께 본다.
      var sheetBg = sheetEl ? getComputedStyle(sheetEl).backgroundColor : '';
      var mAlpha = /rgba?\(([^)]+)\)/.exec(sheetBg);
      var alpha = 1;
      if (mAlpha) {
        var parts = mAlpha[1].split(',');
        alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
      }
      // **넓은 화면에서는 시트가 아니다.** 태블릿은 판이 지도 위에 떠 있는 배치가
      // 맞고(데스크톱과 같다), 거기에 '한 장의 판' 을 요구하면 없는 결함을 만든다.
      // 시트인지 아닌지는 화면 폭을 꽉 채운 고정 배치인가로 가른다.
      var sheetCS = sheetEl ? getComputedStyle(sheetEl) : null;
      var isSheet = !!sheetCS && sheetCS.position === 'fixed' &&
                    sheetEl.getBoundingClientRect().width >= window.innerWidth - 1;
      chk('mobile.sheetIsOneSurface',
        !isSheet || (kids.length > 1 && holes.length === 0 && alpha > 0.9),
        '시트 안 판 ' + kids.length + '개 · 판 사이로 지도가 비친 자리 ' + holes.length +
        (holes.length ? ' (' + holes.join(', ') + ')' : '') +
        ' · 시트 바닥 ' + sheetBg + ' · 시트 배치인가=' + isSheet +
        ' (시트가 아니면 이 검사는 건너뛴다 — 넓은 화면에서는 떠 있는 판이 맞다)');
      openRightSheet(false);

      // ---------- 8.96 신호 버스 계기판이 폰에서도 쓸 만한가 -------------------
      // 이름 칸은 **손가락으로 눌러 고치는 입력칸**이다. 26px 짜리로 두면 폰에서는
      // 없는 기능이 된다(저장 버튼이 폭 37px 로 그랬다).
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      openRightSheet(true);
      var busRowsM = document.querySelectorAll('#busList .brow');
      var smallBus = [];
      for (var bi2 = 0; bi2 < busRowsM.length; bi2++) {
        var rr2 = busRowsM[bi2].getBoundingClientRect();
        var nameEl = busRowsM[bi2].querySelector('.bname');
        var nr = nameEl ? nameEl.getBoundingClientRect() : null;
        if (rr2.height < 40 || !nr || nr.height < 30) {
          smallBus.push(busRowsM[bi2].getAttribute('data-ch') + ':' +
                        Math.round(rr2.height) + '/' + (nr ? Math.round(nr.height) : 0));
        }
      }
      var busOnScreen = busRowsM.length > 0 && onScreen(busRowsM[0]);
      chk('mobile.busPanelUsable',
        busRowsM.length === 8 && smallBus.length === 0 && busOnScreen,
        '버스 줄 ' + busRowsM.length + '개 · 작은 줄 ' + smallBus.length +
        (smallBus.length ? '(' + smallBus.join(',') + ')' : '') +
        ' · 첫 줄이 화면 안=' + busOnScreen);
      openRightSheet(false);

      // ---------- 8.97 안드로이드 주소창 (100vh 함정) -------------------------
      // 안드로이드 크롬·삼성 인터넷은 주소창이 스크롤에 따라 들락거린다. 100vh 는
      // **주소창이 숨은 큰 높이**라, 주소창이 보이는 동안 판이 그만큼 화면 밖으로
      // 밀린다 — 폰에서 "판 아래가 잘린다"의 흔한 원인이다.
      // 헤드리스에는 주소창이 없어 이 어긋남을 재현할 수 없다. 그래서 재는 것은
      // **규칙이 짝을 이루는가**다: 높이를 vh 로 정한 자리마다 dvh 짝이 있어야 한다.
      // (실기기 확인은 여전히 필요하다 — 이 게이트는 그 자리를 빠뜨리지 않았다까지다.)
      // **적어 둔 CSS 원문을 본다.** 처음엔 CSSOM(styleSheets[].cssRules) 을 훑었는데,
      // 같은 규칙 안에 max-height 를 두 번 적으면 브라우저가 뒤엣것만 남겨서 vh 짝이
      // 사라진 것처럼 보인다 — 짝을 지우는 돌연변이가 그 틈으로 빠져나갔다(MISS).
      var cssText = '';
      var styleEls = document.querySelectorAll('style');
      for (var si = 0; si < styleEls.length; si++) cssText += styleEls[si].textContent;
      // 주석은 규칙이 아니다 — 'dvh 를 왜 쓰는지' 설명하며 100vh 라고 적은 주석까지
      // 세는 바람에 짝이 하나 모자란 것처럼 보였다.
      cssText = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ');
      var vhHits = (cssText.match(/100vh/g) || []).length;
      var dvhHits = (cssText.match(/100dvh/g) || []).length;
      chk('mobile.viewportHeightUsesDvh', vhHits === 0 || dvhHits >= vhHits,
        '100vh ' + vhHits + '곳 · 100dvh ' + dvhHits + '곳 (dvh 짝이 모자라면 안드로이드에서 ' +
        '주소창이 보이는 동안 그만큼 잘린다)');

      // ---------- 8.98 조작 바·편집기 머리띠 글자가 접히는가 -------------------
      // 편집기도 열어 둔 채로 잰다 — 닫혀 있으면 그 안의 글자는 화면에 없어서
      // 아무것도 안 보는 검사가 된다(이 레포에서 이미 세 번 그랬다).
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.research('logic-mem'); G.research('logic-ctrl');
      var wrapCtrl = G.place('controller', 80, 80, 0);
      G.ui.select(wrapCtrl);
      G.ui.openLogic ? G.ui.openLogic(wrapCtrl) : null;

      // 실기기 스크린샷에서 '청사 진'·'도움 말' 로 두 줄이 됐다. 게이트는 버튼의
      // **크기와 위치만** 재고 있어서, 그 안의 글자가 접히는 것은 한 번도 안 봤다.
      // 줄 수는 텍스트 노드에 Range 를 걸어야 정확히 나온다(버튼 높이로는 못 본다 —
      // min-height 44px 이라 두 줄이어도 높이가 안 변한다).
      function labelLines(btn) {
        var tn = btn.firstChild;
        if (!tn || tn.nodeType !== 3) return -1;
        var rg = document.createRange();
        rg.selectNodeContents(tn);
        return rg.getClientRects().length;
      }
      var wrapBad = [], clipBad = [];
      // **바만 보지 않는다.** 편집기 머리띠도 같은 방식으로 접혔다('회로로 펼치 / 기') —
      // 손으로 적은 셀렉터는 나중에 만든 것을 늘 놓친다(이 레포에서 다섯 번째다).
      // 한 줄로 보여야 하는 짧은 라벨을 **한 자리에 모아** 검사한다.
      var barBtns = document.querySelectorAll('#mobBar button, #logicBar button, #logicBar .ttl');
      for (var bb = 0; bb < barBtns.length; bb++) {
        var ln = labelLines(barBtns[bb]);
        if (ln > 1) wrapBad.push(barBtns[bb].textContent.trim() + ':' + ln + '줄');
        if (barBtns[bb].scrollWidth > barBtns[bb].clientWidth + 1) {
          clipBad.push(barBtns[bb].textContent.trim());
        }
      }
      // **글자가 커지는 판도 본다.** 삼성 기기의 '글자 크게' 설정처럼 글자만 부푸는
      // 상황에서 접히면, 우리가 정한 크기가 아니라 사용자의 설정이 화면을 정한다.
      var stTest = document.createElement('style');
      stTest.textContent = '#mobBar button,#logicBar button{font-size:16px !important}';
      document.head.appendChild(stTest);
      var wrapBig = [];
      for (var bg = 0; bg < barBtns.length; bg++) {
        if (labelLines(barBtns[bg]) > 1) wrapBig.push(barBtns[bg].textContent.trim());
      }
      stTest.remove();
      // **몇 개를 봤는지 적는다.** 편집기를 안 열어 둔 판에서는 머리띠 글자가 화면에
      // 없어서 0개를 재고도 GREEN 이 된다 — 그건 검사가 아니라 통과다.
      // **접힘을 막으면 넘침으로 나타난다.** nowrap 을 걸어 두면 글자는 안 접히는 대신
      // 띠 밖으로 밀려나 잘린다 — 한 줄로 되돌리는 돌연변이가 그 틈으로 빠져나갔다.
      // 띠 자체가 제 안에 다 담기는지도 함께 본다.
      var barsOver = [];
      var barEls = document.querySelectorAll('#mobBar, #logicBar');
      for (var be = 0; be < barEls.length; be++) {
        if (getComputedStyle(barEls[be]).display === 'none') continue;
        if (barEls[be].scrollWidth > barEls[be].clientWidth + 1) {
          barsOver.push((barEls[be].id || '?') + ':' + barEls[be].scrollWidth + '>' + barEls[be].clientWidth);
        }
      }
      chk('mobile.barLabelsDoNotWrap',
        barBtns.length >= 10 && wrapBad.length === 0 && clipBad.length === 0 &&
        wrapBig.length === 0 && barsOver.length === 0,
        '검사한 라벨 ' + barBtns.length + '개(조작 바 7 + 편집기 머리띠) · 기본 글자에서 접힌 것 ' +
        (wrapBad.join(',') || '없음') +
        ' · 잘린 것 ' + (clipBad.join(',') || '없음') +
        ' · 글자 1.33배에서 접힌 것 ' + (wrapBig.join(',') || '없음') +
        ' · 띠 밖으로 넘친 것 ' + (barsOver.join(',') || '없음') +
        ' (접히면 "청사 진" 처럼 보인다 — 실기기에서 그렇게 나왔다)');

      // ---------- 8.99 한글이 어절 한가운데서 끊기는가 ----------------------
      // 실기 스크린샷: '…저장·불러오기·오염 보기가 있 / 고, 건물을 눌러…'. 브라우저
      // 기본값은 한글 음절 사이 **아무 데서나** 줄을 바꾼다. 글자 크기와 판 폭이
      // 맞아떨어지는 줄에서만 드러나므로 눈으로 훑어서는 못 잡는다 — 줄이 바뀌는
      // 자리의 앞뒤 글자를 직접 재고, 그 사이에 띄어쓰기가 있었는지로 판정한다.
      G.ui.openHelp();
      var HAN = /[가-힣]/;
      var midBreaks = [], wrapLines = 0, seenChars = 0;
      function scanBreaks(root) {
        if (!root) return;
        var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var tn, rg = document.createRange();
        while ((tn = tw.nextNode())) {
          if (seenChars > 12000) break;                  // 판정에 충분하다
          var s2 = tn.nodeValue;
          if (!s2 || !/\S/.test(s2)) continue;
          rg.selectNodeContents(tn);
          var lines = rg.getClientRects().length;
          if (lines === 0) continue;                     // 화면에 없는 글자
          if (lines === 1) { seenChars += s2.trim().length; continue; }  // 안 접힌 줄은 볼 것이 없다
          wrapLines += lines - 1;
          var prevIdx = -1, prevTop = null;
          for (var ci = 0; ci < s2.length; ci++) {
            rg.setStart(tn, ci); rg.setEnd(tn, ci + 1);
            var cr = rg.getBoundingClientRect();
            if (!cr.width && !cr.height) continue;
            seenChars++;
            if (prevTop !== null && cr.top > prevTop + 1) {   // 여기서 줄이 바뀌었다
              var gap = s2.slice(prevIdx + 1, ci);            // 두 글자 사이에 있던 것
              if (!/\s/.test(gap) && HAN.test(s2[prevIdx]) && HAN.test(s2[ci])) {
                midBreaks.push('…' + s2.slice(Math.max(0, prevIdx - 6), prevIdx + 1) +
                               ' / ' + s2.slice(ci, ci + 7) + '…');
              }
            }
            prevIdx = ci; prevTop = cr.top;
          }
        }
      }
      scanBreaks(document.getElementById('helpBody'));
      scanBreaks(document.getElementById('tutorBody'));
      scanBreaks(document.getElementById('rulePane'));
      // **keep-all 의 대가를 같은 자리에서 잰다.** 어절을 안 끊기로 하면, 끊을 자리가
      // 없는 긴 덩어리는 갈 곳이 없어 판 밖으로 밀려난다. 짝인 break-word 가 빠지면
      // 여기서 드러난다 — 고치면서 새로 만드는 고장이라, 고침과 함께 걸어 둔다.
      var helpBodyEl = document.getElementById('helpBody');
      var probe = document.createElement('p');
      probe.textContent = 'abcdefghij'.repeat(20) + ' 그리고 ' + '1234567890'.repeat(20);
      helpBodyEl.appendChild(probe);
      // **scrollWidth 로는 안 보인다.** overflow 가 visible 인 문단은 글자가 밖으로
      // 삐져나가도 scrollWidth 가 안 늘어난다 — 짝을 빼는 돌연변이가 그대로 통과했다(MISS).
      // 글자가 실제로 놓인 자리를 Range 로 재서 제 상자와 견준다.
      var rgp = document.createRange();
      rgp.selectNodeContents(probe);
      var inkBox = rgp.getBoundingClientRect();
      var probeBox = probe.getBoundingClientRect();
      var probeOver = inkBox.width > probeBox.width + 1 || inkBox.right > probeBox.right + 1;
      var helpPanel = document.getElementById('help');
      var panelOver = inkBox.right > helpPanel.getBoundingClientRect().right + 1;
      probe.remove();
      // **몇 줄이 접혔는지 세서 적는다.** 아무것도 안 접힌 판에서는 끊긴 자리도 없어서
      // 0곳을 재고도 GREEN 이 된다 — 이 레포에서 이미 세 번 그랬다.
      chk('mobile.koreanBreaksAtSpaces',
        midBreaks.length === 0 && !probeOver && !panelOver &&
        wrapLines >= 8 && seenChars >= 800,
        '접힌 줄 ' + wrapLines + '개 · 검사한 글자 ' + seenChars + '자 · 어절 한가운데서 끊긴 곳 ' +
        (midBreaks.slice(0, 3).join(' | ') || '없음') +
        (midBreaks.length > 3 ? ' 외 ' + (midBreaks.length - 3) + '곳' : '') +
        ' · 끊을 자리 없는 200자 덩어리: ' +
        (probeOver || panelOver ? '판 밖으로 밀려남(break-word 가 빠졌다)' : '판 안에 담김'));
      G.ui.closeHelp();

      // ---------- 8.992 배선이 손에 붙는가 -----------------------------------
      // 사용자 평가: "손에 조금 안 붙어"(2026-08-23). 재 보니 배선 손잡이인 포트 줄이
      // 높이 15px 이었다 — 이 게임이 스스로 정하고 게이트로 강제하는 손가락 기준은 44px 인데,
      // 정작 **이 게임의 본체인 배선**이 그 3분의 1이었다. 게다가 줄 간격이 18px 이라
      // 손가락 하나 폭에 서로 다른 포트가 둘 들어왔다.
      // 44px 은 여기서 못 쓴다(출구 아홉짜리 노드면 포트만 400px). 26px 로 키워 간격보다
      // 크게 만들고, 나머지 반은 **빗나감 보정**이 맡는다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.powerCheat(true); G.giveAll(9999);
      G.research('logistics'); G.research('logic-mem');
      var wC = G.place('controller', 60, 60, 0);
      var wSrc = G.gAdd(wC, 'const', 20, 20);
      var wDst = G.gAdd(wC, 'cmp', 20, 260);
      G.ui.openLogic(wC); G.ui.showGraph(); G.ui.renderGraph();
      var wOut = document.querySelector('.node[data-nid="' + wSrc + '"] .port.out[data-out="0"]');
      var wIn = document.querySelector('.node[data-nid="' + wDst + '"] .port.in[data-in="0"]');
      var wPorts = document.querySelectorAll('#graphInner .port');
      var wSmall = [], wRects = [];
      for (var wp = 0; wp < wPorts.length; wp++) {
        var wq = wPorts[wp].getBoundingClientRect();
        wRects.push(wq);
        if (wq.height < 24) wSmall.push(Math.round(wq.height));
      }
      // 이웃 포트끼리 겹치지 않는가 — 겹치는 표적은 키워도 오탭이 준 것이 아니다.
      var wOverlap = 0;
      for (var wi = 0; wi < wRects.length; wi++) {
        for (var wj = wi + 1; wj < wRects.length; wj++) {
          var A = wRects[wi], B = wRects[wj];
          if (A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top) wOverlap++;
        }
      }
      chk('mobile.wiringHandlesFitAFinger',
        wPorts.length >= 3 && wSmall.length === 0 && wOverlap === 0,
        '포트 줄 ' + wPorts.length + '개 · 24px 미만 ' + (wSmall.join(',') || '없음') +
        ' · 서로 겹친 짝 ' + wOverlap +
        '개 (0개여야 · 겹치면 손가락 하나에 두 포트가 들어와 엉뚱한 데 붙는다)');

      // **빗나가도 붙는가.** 입력 줄에서 살짝 벗어난 자리에서 손을 떼 본다.
      var wBefore = G.gLinks(wC).length;
      if (wOut && wIn) {
        var ob = wOut.getBoundingClientRect(), ib = wIn.getBoundingClientRect();
        swipe(wOut, ob.left + ob.width / 2, ob.top + ob.height / 2,
              ib.left + ib.width / 2, ib.top - 10);      // 10px 위 — 줄 밖이다
      }
      var wNear = G.gLinks(wC).length - wBefore;
      // **음성 대조군** — 아주 멀리서 떼면 붙으면 안 된다. 그건 그만두려던 것이다.
      G.gUnlink(wC, wDst, 0); G.ui.renderGraph();
      var wOut2 = document.querySelector('.node[data-nid="' + wSrc + '"] .port.out[data-out="0"]');
      var wIn2 = document.querySelector('.node[data-nid="' + wDst + '"] .port.in[data-in="0"]');
      var wBefore2 = G.gLinks(wC).length;
      if (wOut2 && wIn2) {
        var ob2 = wOut2.getBoundingClientRect(), ib2 = wIn2.getBoundingClientRect();
        swipe(wOut2, ob2.left + ob2.width / 2, ob2.top + ob2.height / 2,
              ib2.left + ib2.width / 2, ib2.top - 90);   // 90px 위 — 그만두려던 것이다
      }
      var wFar = G.gLinks(wC).length - wBefore2;
      chk('mobile.wiringForgivesANearMiss', wNear === 1 && wFar === 0,
        '입력 줄에서 10px 벗어나 뗐을 때 생긴 배선 ' + wNear + '개(1이어야) · ' +
        '90px 벗어나 뗐을 때 ' + wFar + '개(0이어야 — 아무 데나 붙으면 틀린 데 붙는다)');
      G.ui.closeLogic();

      // ---------- 8.991 끌지 않고도 이을 수 있는가 ---------------------------
      // 폰에서 첫 배선은 화면 높이의 3분의 1(257px)을 가로질러 끌어야 했다 — 그 거리를
      // 손가락으로 끄는 일 자체가 미끄러진다. 눌러서 겨누고, 이을 곳을 한 번 더 누르면 된다.
      // **끌기도 살아 있어야 한다** — 익힌 사람의 손버릇을 빼앗는 것은 고치는 것이 아니다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.powerCheat(true); G.giveAll(9999);
      G.research('logistics'); G.research('logic-mem');
      var tpC = G.place('controller', 60, 60, 0);
      var tpA = G.gAdd(tpC, 'const', 20, 20);
      var tpB = G.gAdd(tpC, 'cmp', 20, 300);
      G.ui.openLogic(tpC); G.ui.showGraph(); G.ui.renderGraph();
      function portAt(nid, dir, i) {
        return document.querySelector('.node[data-nid="' + nid + '"] .port.' + dir +
                                      '[data-' + dir + '="' + i + '"]');
      }
      var tapMissing = [];
      function tapPort(el, label) {
        // **못 찾은 것과 눌렀는데 안 된 것은 다르다.** 조용히 지나가면 게이트가
        // 어느 쪽인지 말하지 못한다 — 그러면 고칠 곳을 못 찾는다.
        if (!el) { tapMissing.push(label || '?'); return; }
        var q = el.getBoundingClientRect();
        tap(el, q.left + q.width / 2, q.top + q.height / 2);
      }
      // 1) 출력을 톡 누르면 '겨눔' 이 눈에 보여야 한다 — 안 보이면 눌린 줄 모른다.
      tapPort(portAt(tpA, 'out', 0), '출력0');
      var armedEl = document.querySelector('#graphInner .port.armed');
      var tapBefore = G.gLinks(tpC).length;
      // 2) 이을 곳을 누르면 이어진다.
      tapPort(portAt(tpB, 'in', 0), '입력0');
      var tapMade = G.gLinks(tpC).length - tapBefore;
      chk('mobile.wiringByTapThenTap',
        !!armedEl && tapMade === 1 && !document.querySelector('#graphInner .port.armed'),
        '출력을 톡 누름 → 겨눔 표시 ' + (armedEl ? '보임' : '없음(눌린 줄 모른다)') +
        ' · 입력을 누름 → 생긴 배선 ' + tapMade + '개(1이어야) · 이은 뒤 겨눔이 남았나=' +
        !!document.querySelector('#graphInner .port.armed') +
        ' · 화면에서 못 찾은 포트 ' + (tapMissing.join(',') || '없음'));

      // 3) **그만두는 길**이 있어야 한다 — 겨눠 놓고 빈 곳을 누르면 풀려야 한다.
      G.gUnlink(tpC, tpB, 0); G.ui.renderGraph();
      tapPort(portAt(tpA, 'out', 0), '출력0(재)');
      var armed2 = !!document.querySelector('#graphInner .port.armed');
      var wrapEl = document.getElementById('graphWrap');
      var wq = wrapEl.getBoundingClientRect();
      tap(wrapEl, wq.left + wq.width - 12, wq.top + wq.height - 12);   // 빈 구석
      var stillArmed = !!document.querySelector('#graphInner .port.armed');
      var cancelMade = G.gLinks(tpC).length;
      // **끊는 길도 그대로 살아 있어야 한다.** 같은 누름이 두 뜻을 갖게 됐으니,
      // 겨누지 않은 상태에서 입력을 누르면 예전처럼 그 배선이 끊겨야 한다 —
      // 새 기능을 넣으며 있던 기능을 조용히 덮으면 그건 고친 것이 아니다.
      G.gLink(tpC, tpA, 0, tpB, 0); G.ui.renderGraph();
      var cutBefore = G.gLinks(tpC).length;
      tapPort(portAt(tpB, 'in', 0), '입력0(끊기)');
      var cutAfter = G.gLinks(tpC).length;
      chk('mobile.wiringTapStillDisconnects',
        cutBefore === 1 && cutAfter === 0,
        '겨누지 않은 채 입력을 누름 → 배선 ' + cutBefore + '개 → ' + cutAfter +
        '개 (끊겨야 한다 · 안 끊기면 새 기능이 있던 기능을 덮은 것이다)');

      chk('mobile.wiringTapCanBeCancelled',
        armed2 && !stillArmed && cancelMade === 0,
        '겨눈 뒤 빈 곳을 누름 → 겨눔이 풀렸나=' + !stillArmed + '(풀려야) · 그 사이 생긴 배선 ' +
        cancelMade + '개(0이어야 · 안 풀리면 겨눔이 덫이 된다)');
      G.ui.closeLogic();

      // ---------- 8.993 도움말이 폰에게 먼저 말하는가 ------------------------
      // 예전에는 조작 절이 WASD·휠·우클릭·R·Q·F2 다섯 줄로 시작하고, **여섯 번째 줄**
      // 에서야 '폰에는 키보드가 없다' 가 나왔다. 폰으로 연 사람은 자기가 할 수 없는 것만
      // 다섯 줄을 읽고서야 자기 줄에 닿는다 — 그 다섯 줄은 폰에 아예 없는 조작이다.
      G.ui.openHelp();
      var opH = null, kids = document.getElementById('helpBody').children;
      for (var oh = 0; oh < kids.length; oh++) {
        if (kids[oh].tagName === 'H4' && kids[oh].textContent.indexOf('조작') >= 0) { opH = oh; break; }
      }
      var firstBlock = (opH !== null) ? kids[opH + 1] : null;
      var firstLi = firstBlock ? firstBlock.querySelector('li') : null;
      var firstTxt = firstLi ? firstLi.textContent : '';
      var fold = document.querySelector('#helpBody details.kbdfold');
      var kbdLis = fold ? fold.querySelectorAll('li').length : 0;
      // 키보드 조각이 첫 블록에 섞여 있으면 안 된다 — 폰에 없는 조작이다.
      var kbdInFirst = firstBlock ? (firstBlock.textContent.indexOf('WASD') >= 0 ||
                                     firstBlock.textContent.indexOf('우클릭') >= 0) : true;
      var touchFirst = firstTxt.indexOf('손가락') >= 0 || firstTxt.indexOf('누르면') >= 0;
      // **눌러서 펼 수 있다는 것이 보여야 한다.** summary 에 display:flex 를 주면 브라우저가
      // 기본으로 그리던 삼각형이 사라진다 — 그러면 그냥 흐린 글자라 아무도 안 누른다.
      var foldSum = fold ? fold.querySelector('summary') : null;
      var mark = foldSum ? getComputedStyle(foldSum, '::before').content : 'none';
      // **'뭔가 있다' 로는 부족하다.** CSS 이스케이프가 잘못 파싱돼 쓰레기 글자가 찍혔는데도
      // 비어 있지 않다는 이유로 통과했다 — 기대하는 글자와 같은지 본다.
      var mk = String(mark).replace(/["']/g, '');
      var hasMark = (mk === '▸');
      chk('mobile.helpLeadsWithTouch',
        !NARROW || (!!firstLi && touchFirst && !kbdInFirst &&
                    !!fold && fold.open === false && kbdLis >= 5 && hasMark),
        (NARROW
          ? ('조작 절 첫 줄 "' + firstTxt.slice(0, 34) + '…" · 손가락 이야기인가=' + touchFirst +
             ' · 첫 블록에 키보드가 섞였나=' + kbdInFirst + ' · 접어 둔 키보드 조작 ' + kbdLis +
             '줄(5줄 이상이어야 · 0이면 지워 버린 것이다) · 접혀 있나=' + (fold ? !fold.open : '없음') +
             ' · 펼 수 있다는 표시 ' + (hasMark ? mark : '없음(그냥 흐린 글자라 아무도 안 누른다)'))
          : '(넓은 레이아웃 — 키보드가 먼저인 것이 맞다)'));
      G.ui.closeHelp();

      // ---------- 8.994 잠긴 줄이 무엇을 연구해야 열리는지 말하는가 ----------
      // 예전엔 자물쇠만 있어서 **눌러 봐야** 알았다. 잠긴 것이 열다섯 줄이면 지도를
      // 그리는 데 열다섯 번을 눌러야 한다는 뜻이고, 실제로 사용자가 정제소를 눌러 보고
      // 나서야 '석유 처리가 필요하다' 를 알았다.
      // **이름을 게임 자신의 표와 대조한다** — 글자가 있다는 것만 보면 아무 이름이나
      // 적어 놓아도 통과한다(엉뚱한 연구를 가리키는 쪽이 자물쇠만 있는 것보다 나쁘다).
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.powerCheat(true);
      var bBtn = document.getElementById('btnSheetBuild');
      var bbr = bBtn.getBoundingClientRect();
      tap(bBtn, bbr.left + bbr.width / 2, bbr.top + bbr.height / 2);
      var lkRows = document.querySelectorAll('#buildList .bitem');
      var lkSeen = 0, lkBad = [], lkWrap = [], openHasLock = [], lkDim = [];
      // 글자가 실제로 어떤 색으로 보이는지 — **조상의 투명도까지 곱해서** 잰다.
      // opacity 는 자식이 되돌릴 수 없으므로, 요소의 color 만 보면 거짓말이 된다.
      function effContrast(el) {
        function rgbOf(str) {
          var t = String(str).trim();
          if (t.charAt(0) === '#') {                 // #rgb / #rrggbb
            if (t.length === 4) t = '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
            return [1, 3, 5].map(function (i) { return parseInt(t.substr(i, 2), 16); });
          }
          var m = t.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null;
        }
        var fg = rgbOf(getComputedStyle(el).color);
        var a = 1, n = el;
        while (n && n.nodeType === 1) { a *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
        var bg = null, m2 = el;
        while (m2 && !bg) {
          var st2 = getComputedStyle(m2);
          var c = st2.backgroundColor;
          if (c && c.indexOf('rgba(0, 0, 0, 0)') < 0) { bg = rgbOf(c); break; }
          // **그라디언트는 backgroundColor 로 안 잡힌다.** 넓은 화면에서 판(.panel)은
          // 위아래 그라데이션이라 여기서 못 읽고 계속 올라가다 문서의 검은 바탕에
          // 닿았다 — 밝은 판 위의 글자를 검정과 견주어 1.74:1 이라는 거짓 RED 가 났다.
          // 그럴 때는 그 판이 쓰는 기본 면 색(--face)을 바탕으로 본다.
          if (st2.backgroundImage && st2.backgroundImage !== 'none') {
            bg = rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--face'));
            break;
          }
          m2 = m2.parentElement;
        }
        if (!fg || !bg) return null;
        var eff = [0, 1, 2].map(function (i) { return fg[i] * a + bg[i] * (1 - a); });
        function lum(c) {
          var q = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2];
        }
        var L1 = lum(eff), L2 = lum(bg);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      }
      for (var lr = 0; lr < lkRows.length; lr++) {
        var bid = lkRows[lr].getAttribute('data-b');
        var bcEl = lkRows[lr].querySelector('.bc');
        if (!bcEl) continue;
        var txt = (bcEl.textContent || '').trim();
        var info = G.buildingInfo(bid);
        var needTech = info ? info.tech : null;
        var isLocked = txt.indexOf('\uD83D\uDD12') >= 0;
        if (!isLocked) {
          // **음성 대조군** — 열려 있는 줄에 자물쇠가 붙어 있으면 안 된다.
          continue;
        }
        lkSeen++;
        var wantName = needTech ? (G.techInfo(needTech) || {}).name : null;
        if (!wantName || txt.indexOf(wantName) < 0) {
          lkBad.push(bid + ': "' + txt + '" (기대 "' + wantName + '")');
        }
        var rgb = document.createRange(); rgb.selectNodeContents(bcEl);
        if (rgb.getClientRects().length > 1) lkWrap.push(bid);
        if (bcEl.scrollWidth > bcEl.clientWidth + 1) lkWrap.push(bid + '(잘림)');
        // **읽히는지도 잰다.** 잠긴 줄은 흐리게 칠하는데, 그 흐림이 이 글자까지
        // 지워 버리면 정보를 넣은 자리에 정보가 없는 것이다 — 실제로 줄 전체에
        // opacity:.36 이 걸려 있어 대비가 1.43:1 이었다(사실상 안 보인다).
        var cr = effContrast(bcEl);
        if (cr !== null && cr < 4.5) lkDim.push(bid + ':' + cr.toFixed(2) + ':1');
      }
      // 열려 있는 건물에 자물쇠가 붙었는지 따로 본다 — 전부 잠긴 것으로 칠하면
      // 위 검사는 통과하면서 목록은 쓸모없어진다.
      var doneList = (G.state().research && G.state().research.done) || [];
      for (var lo = 0; lo < lkRows.length; lo++) {
        var oid = lkRows[lo].getAttribute('data-b');
        var oinfo = G.buildingInfo(oid);
        var oc = lkRows[lo].querySelector('.bc');
        if (!oinfo || !oc) continue;
        var openNow = !oinfo.tech || doneList.indexOf(oinfo.tech) >= 0;
        if (openNow && (oc.textContent || '').indexOf('\uD83D\uDD12') >= 0) openHasLock.push(oid);
      }
      chk('mobile.lockedRowsSayWhatUnlocksThem',
        lkSeen >= 5 && lkBad.length === 0 && lkWrap.length === 0 &&
        openHasLock.length === 0 && lkDim.length === 0,
        '잠긴 줄 ' + lkSeen + '개(5개 이상이어야 · 0개면 아무것도 안 본 것이다) · 연구 이름이 ' +
        '게임 표와 어긋난 줄 ' + (lkBad.slice(0, 2).join(' | ') || '없음') +
        ' · 접히거나 잘린 줄 ' + (lkWrap.join(',') || '없음') +
        ' · 열려 있는데 자물쇠가 붙은 줄 ' + (openHasLock.join(',') || '없음') +
        ' · 대비 4.5:1 에 못 미쳐 안 읽히는 줄 ' + (lkDim.slice(0, 2).join(',') || '없음'));
      tap(bBtn, bbr.left + bbr.width / 2, bbr.top + bbr.height / 2);   // 시트를 닫는다

      // ---------- 8.995 칩이 시트의 버튼을 덮는가 ---------------------------
      // 화면 아래에 떠 있는 칩(도구 취소 · 튜토리얼 다시 열기)은 시트보다 위에 앉는다.
      // 도구 칩만 제 높이를 CSS 로 넘기고 튜토리얼 손잡이는 안 넘겨서, 인스펙터를 열면
      // [정지]·[복제]·[철거] 세 개가 손잡이에 통째로 가렸다(실측: 버튼 774~818 vs
      // 칩 779~823). **누른 줄 알았는데 안 눌리는** 부류라, 화면만 보면 멀쩡해 보인다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.ui.closeTutor();                 // 손잡이를 띄운다
      var chipEnt = G.place('assembler', 80, 80, 0);
      G.ui.select(chipEnt);              // 인스펙터를 연다
      var chipsUp = [], chipBoxes = [];
      var chipIds = ['toolChip', 'tutorChip'];
      for (var ci = 0; ci < chipIds.length; ci++) {
        var cel = document.getElementById(chipIds[ci]);
        if (!cel || getComputedStyle(cel).display === 'none') continue;
        chipsUp.push(chipIds[ci]); chipBoxes.push(cel.getBoundingClientRect());
      }
      var sheetBtns = [], coveredBtns = [];
      var sheetIds = ['insp', 'build', 'right', 'help', 'tech'];
      for (var si2 = 0; si2 < sheetIds.length; si2++) {
        var sel2 = document.getElementById(sheetIds[si2]);
        if (!sel2 || getComputedStyle(sel2).display === 'none') continue;
        var bl = sel2.querySelectorAll('button, select');
        for (var bi2 = 0; bi2 < bl.length; bi2++) {
          var bb2 = bl[bi2].getBoundingClientRect();
          if (bb2.width < 1 || bb2.height < 1) continue;
          sheetBtns.push(bl[bi2]);
          for (var cj = 0; cj < chipBoxes.length; cj++) {
            var cb2 = chipBoxes[cj];
            if (bb2.left < cb2.right && bb2.right > cb2.left &&
                bb2.top < cb2.bottom && bb2.bottom > cb2.top) {
              coveredBtns.push((bl[bi2].textContent || bl[bi2].id || '?').trim().slice(0, 8));
              break;
            }
          }
        }
      }
      // **떠 있는 칩이 없거나 버튼을 못 찾았으면 아무것도 안 본 것이다.** 이 레포에서
      // 판을 안 열어 둔 채 0개를 재고 GREEN 이 된 적이 이미 여러 번 있다.
      chk('mobile.chipsDoNotCoverSheetButtons',
        !NARROW || (chipsUp.length >= 1 && sheetBtns.length >= 3 && coveredBtns.length === 0),
        (NARROW
          ? ('떠 있는 칩 ' + (chipsUp.join(',') || '없음') + ' · 검사한 시트 버튼 ' +
             sheetBtns.length + '개 · 칩에 가린 것 ' + (coveredBtns.join(',') || '없음') +
             ' (가리면 누른 줄 알았는데 안 눌린다)')
          : '(넓은 레이아웃 — 칩이 없다)'));
      G.ui.select(-1);

      // ---------- 9. 탭 표적이 손가락 크기인가 ------------------------------
      // 접근성 지침의 최소 타깃은 44x44 CSS px 다. 그보다 작으면 오탭이 난다.
      // **재기 전에 인스펙터를 열어 둔다.** 이 검사는 화면에 보이는 것만 재는데,
      // 여기 올 때쯤엔 인스펙터가 닫혀 있어 드롭다운이 목록에 있어도 건너뛰었다 —
      // 돌연변이(드롭다운을 24px 로)가 두 번 MISS 로 빠져나갔다. 판을 열어 놓고 잰다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.place('assembler', 80, 80, 0);
      var tgPt = tileToClient(81, 81);
      tap(cv, tgPt.x, tgPt.y);

      // **드롭다운과 입력칸도 손가락 표적이다.** 여기 목록에 select 가 없어서, 인스펙터의
      // 레시피 드롭다운이 24px 인 채로 오래 남아 있었다(실측). 목록을 손으로 적는 검사는
      // 적어 둔 것까지만 본다 — 이 레포에서 같은 실수를 판 목록에서도 했다.
      // **시트를 하나씩 열어 놓고 잰다.** 셀렉터에 '#right button' 이 들어 있었는데도
      // [자재] 시트가 닫혀 있어 onScreen 이 전부 걸러 냈다 — 그 안의 저장·불러오기가
      // 10px 글씨의 20px 짜리 버튼인 채로 남아 있었고 이 게이트는 계속 GREEN 이었다.
      // 화면에 못 띄운 것을 "표적이 크다"로 셀 수는 없다.
      var small = [];
      function measureTargets(where) {
        var all = document.querySelectorAll(
          '#buildList .bitem, #top button, #side button, .close, ' +
          '#insp select, #insp button, #insp input, ' +
          '#right select, #right button, #right input, #mobBar button');
        for (var q = 0; q < all.length; q++) {
          if (!onScreen(all[q])) continue;
          var rr = all[q].getBoundingClientRect();
          // **44 는 높이만의 규격이 아니다.** 높이만 보다가 폭 37px 짜리 저장 버튼을
          // 계속 통과시켰다 — 손가락 접촉면은 원에 가까워서 좁고 긴 표적도 오탭이 난다.
          // 줄 전체를 차지하는 목록 행(.bitem)은 폭이 이미 화면만 하므로 제외한다.
          var tooShort = rr.height < 44;
          var tooNarrow = rr.width < 44 && all[q].className.indexOf('bitem') < 0;
          if (tooShort || tooNarrow) {
            small.push(where + '/' + (all[q].id || all[q].className) + ':' +
                       Math.round(rr.width) + 'x' + Math.round(rr.height));
          }
        }
      }
      measureTargets('인스펙터');
      var shBuild = document.getElementById('btnSheetBuild');
      var shRight = document.getElementById('btnSheetRight');
      function tapBtn(el) { var r = el.getBoundingClientRect(); tap(el, r.left + r.width / 2, r.top + r.height / 2); }
      if (shRight) { tapBtn(shRight); measureTargets('자재'); tapBtn(shRight); }
      if (shBuild) { tapBtn(shBuild); measureTargets('건설'); tapBtn(shBuild); }
      out.measured.smallTargets = small;
      chk('mobile.tapTargetsBigEnough', small.length === 0,
        '44px(폭·높이) 미만인 탭 표적 ' + small.length + '개' +
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

      // ---------- 10. 한 프레임에 얼마나 걸리는가 (맨 끝에 둔다) -------------
      // 이 블록은 G.reset 으로 판을 새로 만든다. 절 중간에 두었더니 뒤따르는
      // 청사진 회전 검사가 담아 둔 청사진을 잃고 실패했다 — 이 레포 교훈 14 다.
      // **한 번도 안 재던 것이다.** 40분 판 끝에 엔티티 289개인데 폰에서 몇 프레임이
      // 나오는지 아무도 몰랐다. rAF 간격으로는 알 수 없다 — 60Hz 에 물려 늘 16.7ms 로
      // 나오고 여유가 얼마인지는 말해 주지 않는다(실측으로 확인했다). 시뮬 한 틱과
      // 렌더 한 장을 실제로 돌려 그 시간을 잰다.
      //
      // 문턱 10ms 의 근거: 이 기계에서 296개짜리 판이 6.7~6.8ms 로 아주 안정적이다
      // (3회 측정 ±1%). 10ms 는 그 위 약 1.5배이고, "폰이 이 기계보다 1.5배쯤 느려도
      // 한 프레임 안에 든다" 는 가정이다. **가정이라는 것을 여기 적어 둔다** — 실기
      // 프레임률은 화면 위 [프레임] 계기로 그 폰에서 직접 봐야 한다.
      // **재기 전에 판을 정리한다.** 이 게이트는 드라이버 끝에 있어서 앞선 검사들이
      // 열어 둔 것(인스펙터·시트·미니맵)을 그대로 물려받는다. 그것들이 0.2초마다
      // 다시 그려지는 동안 60프레임을 재면 그 비용이 섞여 들어간다 — 같은 장면이
      // 격리 측정에서는 5.5 ms/Mpx, 드라이버 끝에서는 7.9 ms/Mpx 로 나왔다.
      // 벤치마크는 자기 조건을 스스로 세워야 한다.
      G.ui.closeHelp(); G.ui.closeTech(); G.ui.closeLogic(); G.ui.clearTool();
      var tutX = document.getElementById('tutorClose');   // 튜토리얼 판도 닫는다
      if (tutX && getComputedStyle(document.getElementById('tutor')).display !== 'none') {
        var tr = tutX.getBoundingClientRect();
        tap(tutX, tr.left + tr.width / 2, tr.top + tr.height / 2);
      }
      G.ui.select(-1);                       // 인스펙터를 닫는다(없는 id 로 선택 해제)
      var sheetB = document.getElementById('btnSheetBuild');
      var sheetR = document.getElementById('btnSheetRight');
      function closeSheet(btn, panelId) {
        var el = document.getElementById(panelId);
        if (!btn || !el || getComputedStyle(el).display === 'none') return;
        var rb = btn.getBoundingClientRect();
        tap(btn, rb.left + rb.width / 2, rb.top + rb.height / 2);
      }
      closeSheet(sheetB, 'build'); closeSheet(sheetR, 'right');
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(999999); G.powerCheat(true);
      G.research('steel');
      var perfN = 0;
      for (var pr = 0; pr < 8; pr++) {
        for (var pi2 = 0; pi2 < 24; pi2++) if (G.place('belt', 60 + pi2, 60 + pr * 3, 1)) perfN++;
        for (var pf = 0; pf < 6; pf++) if (G.place('furnace', 60 + pf * 4, 61 + pr * 3, 0)) perfN++;
        for (var ps2 = 0; ps2 < 6; ps2++) if (G.place('inserter', 62 + ps2 * 4, 61 + pr * 3, 0)) perfN++;
        if (G.place('pole', 84, 60 + pr * 3, 0)) perfN++;
      }
      var perfIds = G.entIds(), onBelt = 0;
      for (var pj = 0; pj < perfIds.length; pj++) {
        var pid = Array.isArray(perfIds[pj]) ? perfIds[pj][0] : perfIds[pj];
        var pe = G.ent(pid);
        if (pe && pe.type === 'belt') { for (var pk = 0; pk < 4; pk++) if (G.putOnBelt(pid, 'iron-plate', pk)) onBelt++; }
      }
      G.run(2);
      // **한 번 재고 판정하지 않는다.** 같은 판이 5.3~7.6 ms/Mpx 로 흔들렸다 —
      // 다른 프로그램·다른 시험이 같은 기계를 쓰는 동안 찍힌 값이 섞인다. 세 번 재고
      // 가운데 값으로 판정하고, 세 값을 전부 적어 흔들림이 보이게 둔다.
      // **가운데 값이 아니라 가장 빠른 값으로 판정한다.** 소음은 늘 한 방향으로만 붙는다 —
      // 다른 프로그램이 CPU 를 쓰면 느려지지, 빨라지는 일은 없다. 그래서 여러 번 재고
      // **가장 빠른 것**이 이 코드의 진짜 비용에 가장 가깝다.
      // 가운데 값으로 판정하다가 태블릿에서 6.42 / 6.92 / 7.16 이 나와 문턱(7)을 사이에 두고
      // 판정이 뒤집혔다 — 같은 코드가 돌 때마다 GREEN 도 RED 도 되는 게이트는, 진짜 RED 를
      // 가리는 쪽으로만 작동한다(문턱은 그대로 두었다. 흔들림을 없앤 것이지 낮춘 것이 아니다).

      var runs = [G.frameCost(30), G.frameCost(30), G.frameCost(30),
                  G.frameCost(30), G.frameCost(30)];
      // **이 기계가 지금 얼마나 빨리 그리는가**를 함께 잰다. 렌더가 느려진 것과 기계가
      // 바쁜 것은 다른 일인데, 절대 시간만 찍어 두면 둘이 구분되지 않는다 — 실제로 같은
      // 빌드가 아침에 6.34, 저녁에 7.49 로 나와 판정이 뒤집혔다(다른 작업이 이 PC 를
      // 쓰고 있었다). 그 사실은 숫자만 보고는 알 수 없었다.
      //
      // **같은 자원을 재야 한다.** 처음엔 산술 루프를 기준으로 삼았는데 그때 5.9ms 로
      // 멀쩡히 나왔다 — CPU 는 한가한데 그리기가 느렸던 것이다(화면을 나눠 쓰고 있었다).
      // 엉뚱한 자원을 재는 계기는 없느니만 못하다. 그래서 고정된 **그리기** 한 뭉치를 잰다.
      // **판정에는 쓰지 않는다** — 기준을 기계 속도로 나누면 느린 기계에서 회귀가 묻힌다.
      function refDraw() {
        // **작은 캔버스로는 안 잡힌다.** 처음엔 512x512 로 쟀는데, 화면을 나눠 쓰는
        // 프로그램(게임)이 돌고 있는데도 2.8ms 로 멀쩡히 나왔다 — 그건 CPU 쪽 그리기라
        // 화면 장치의 혼잡을 못 본다. 게임 화면과 비슷한 크기로 그려야 같은 병목을 탄다.
        var cv = document.createElement('canvas');
        cv.width = 1536; cv.height = 1024;
        var cx = cv.getContext('2d');
        var t0 = performance.now();
        for (var i = 0; i < 20000; i++) {
          cx.fillStyle = (i & 1) ? '#3a4a5a' : '#a08050';
          cx.fillRect((i * 37) % 1400, (i * 61) % 950, 48, 36);
        }
        cx.getImageData(0, 0, 1, 1);          // 실제로 그려질 때까지 기다린다
        return performance.now() - t0;
      }
      // 기준값도 소음을 타므로 여러 번 재고 가장 빠른 것을 쓴다 — 두 번으로는
      // 한가한 판에서도 23.8ms 가 찍혀 '바쁜 것' 과 구분이 안 됐다.
      var refMs = Math.min(refDraw(), refDraw(), refDraw());
      var sorted = runs.slice().sort(function (a2, b2) { return a2.totalMs - b2.totalMs; });
      var cost = sorted[0];
      // **절대 시간으로 문턱을 잡으면 안 된다.** 처음엔 10ms 로 뒀다가 태블릿에서
      // 빨개졌다 — 화면이 넓으면 그릴 픽셀이 많아 당연히 오래 걸린다(폰 6.8ms /
      // 1.32Mpx, 태블릿 17.0ms / 3.15Mpx). 둘 다 **5.2~5.4 ms/Mpx** 로 같다.
      // 비용은 픽셀에 비례하므로 문턱도 픽셀당으로 잡는다. 7 ms/Mpx 는 그 위 약 30%.
      var cvPerf = document.getElementById('view');
      var mpx = (cvPerf.width * cvPerf.height) / 1e6;
      var perMpx = cost.totalMs / mpx;
      // 다섯 값을 다 적는다 — 흔들림의 폭이 보여야 '문턱에 붙어 있다' 를 알아챈다.
      var allPer = runs.map(function (r2) { return (r2.totalMs / mpx).toFixed(2); }).join(' / ');
      chk('mobile.frameCostFitsBudget',
        perfN > 250 && onBelt > 100 && mpx > 0.5 && perMpx <= 7,
        '엔티티 ' + perfN + '개 · 벨트 위 물건 ' + onBelt + '개 · 캔버스 ' +
        cvPerf.width + 'x' + cvPerf.height + ' (' + mpx.toFixed(2) + 'Mpx) · 한 프레임 시뮬 ' +
        cost.simMs.toFixed(2) + 'ms + 렌더 ' + cost.drawMs.toFixed(2) + 'ms = ' +
        cost.totalMs.toFixed(2) + 'ms → ' + perMpx.toFixed(2) +
        ' ms/Mpx (문턱 7 · 60fps 예산 16.7ms 는 이 화면에서 ' +
        (16.7 / mpx).toFixed(1) + ' ms/Mpx 에 해당)' +
        ' · 5회 측정 ' + allPer + ' ms/Mpx (가장 빠른 값으로 판정 — 소음은 느려지는 쪽으로만 붙는다)' +
        ' · 이 기계의 고정 그리기 ' + refMs.toFixed(1) + 'ms' +
        ' (판정에는 안 쓴다 · 렌더와 **같은 자원**을 재는 값이다. 이 PC 실측: ' +
        '한가할 때 16.6~20.2ms · 게임이 돌 때 21~24ms — **구간이 겹치므로 이 값 하나로는 ' +
        '판정하지 못한다.** 쓰는 법은 렌더 값과 함께 보는 것이다: 둘이 같이 오르면 이 PC 가 ' +
        '화면을 나눠 쓰는 것이고, 렌더만 오르면 코드가 느려진 것이다. ' +
        '실제로 게임을 끄자 렌더 7.87 → 5.25, 그리기 21.4 → 20.2 로 같이 내려왔다)');
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
