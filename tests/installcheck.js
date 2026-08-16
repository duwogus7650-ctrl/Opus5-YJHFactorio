// ===========================================================================
//  설치 검정 — "폰에 설치된다"를 **브라우저 자신의 판정**으로 확인한다.
//
//  왜 필요한가: 지금까지 잰 것은 "설치에 필요한 재료가 문서 안에 있는가" 였다.
//  그건 내가 넣은 것을 내가 다시 읽은 것이라, 브라우저가 그 재료를 **받아들이는지**
//  는 아무도 안 봤다. data: URI 매니페스트는 특히 그렇다 — 규격상 start_url 을
//  무엇에 상대적으로 풀지가 애매해서 엔진이 거부할 수 있다.
//
//  오라클: 크롬이 **실제로 가져온 매니페스트 본문**(CDP `Page.getAppManifest` 의
//  `url` 과 `data`). 내가 문서에서 읽은 것이 아니라 브라우저가 링크를 따라가 받아 온
//  바이트다.
//
//  **처음엔 같은 응답의 `parsed.startUrl` 을 오라클로 삼았다가 헛다리를 짚었다.**
//  이 크롬 빌드의 `parsed` 에는 `scope` 하나뿐이라 start_url 이 늘 undefined 로
//  나오고, 나는 그것을 "크롬이 start_url 을 거부했다" 로 읽었다. 진짜 매니페스트
//  **파일**로 같은 시험을 돌려 보고서야 계측기 쪽이 틀렸음을 알았다 — 파일도 똑같이
//  undefined 였다. 판정은 있는 필드로만 한다.
//
//  이 도구가 **말할 수 없는 것**: "설치 버튼이 실제로 뜨는가". 그 판단은 사용자 참여
//  휴리스틱까지 걸려 있어 헤드리스에서 재현되지 않는다. 여기서 GREEN 이 나와도
//  실기 설치는 여전히 미검증이다.
//
//  함께 보는 것: Pages 뿌리 주소의 meta refresh 를 브라우저가 실제로 따라가는가.
//  HTTP 200 두 개를 확인한 것으로는 "이동한다"를 말할 수 없다.
//
//  사용: node tests/installcheck.js [기준URL]
//  종료 코드: 0 = 전부 통과, 1 = 실패 있음
// ===========================================================================
const { chromium } = require(require('path').join(__dirname, '..', 'node_modules', 'playwright'));

const BASE = process.argv[2] || 'https://duwogus7650-ctrl.github.io/Opus5-YJHFactorio/';
const GAME = 'dist/Logic-Foundry.html';

const checks = [];
function chk(name, ok, detail) { checks.push({ name, ok: !!ok, detail: String(detail) }); }

(async () => {
  const browser = await chromium.launch();
  // 폰 컨텍스트로 연다 — 설치는 폰에서 하는 일이고, 레이아웃도 그때 것이어야 한다.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));

  try {
    // --- 1. 뿌리 주소가 정말 게임으로 데려가는가 -----------------------------
    await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    // meta refresh 는 로드 뒤에 일어난다. URL 이 바뀔 때까지 기다린다.
    await page.waitForURL(u => u.href.indexOf(GAME) >= 0, { timeout: 30000 }).catch(() => {});
    const landed = page.url();
    chk('install.rootRedirectsToGame', landed.indexOf(GAME) >= 0,
      `뿌리(${BASE}) → 최종 주소 ${landed}`);

    // --- 2. 도착한 페이지가 실제로 돌아가는 게임인가 -------------------------
    await page.waitForFunction(() => !!window.__GAME, null, { timeout: 60000 }).catch(() => {});
    const alive = await page.evaluate(() => {
      if (!window.__GAME) return null;
      const st = window.__GAME.state();
      const cv = document.getElementById('view');
      return { ents: st.entityCount, w: cv ? cv.width : 0, h: cv ? cv.height : 0,
               errs: window.__GAME.errors().length };
    });
    chk('install.gameBootsOnPhone', !!alive && alive.ents > 0 && alive.w > 0 && alive.errs === 0,
      alive ? `엔티티 ${alive.ents}개 · 캔버스 ${alive.w}x${alive.h} · 런타임 오류 ${alive.errs}건`
            : '__GAME 이 없다 — 게임이 뜨지 않았다');

    // --- 3. 크롬의 매니페스트 파서가 받아들이는가 ---------------------------
    // 여기서 errors 가 비어 있지 않으면, 내 눈에 멀쩡한 JSON 이어도 설치는 안 된다.
    const cdp = await ctx.newCDPSession(page);
    const got = await cdp.send('Page.getAppManifest');
    const errs = (got.errors || []).filter(e => e.critical);
    let man = null, manErr = '';
    try { man = JSON.parse(got.data || 'null'); } catch (e) { manErr = String(e); }
    chk('install.chromeFetchedManifest',
      !!got.url && errs.length === 0 && !!man && !!man.name && man.display === 'standalone',
      `크롬이 받아 온 주소 ${got.url ? got.url.slice(0, 46) + '…' : '없음'} · 본문 ` +
      `${(got.data || '').length} 바이트 · 치명 오류 ${errs.length}건 · 이름 ` +
      `${man ? man.name : manErr} · 표시 ${man ? man.display : '?'}`);

    // start_url 은 **매니페스트와 같은 출처**여야 한다(W3C). data: 는 출처가 없으므로
    // 규격상 그 자리에서 탈락한다 — 그래서 blob: 로 바꿔 문서의 출처를 물려받게 했다.
    // 여기서는 그 결과가 실제로 절대·동일 출처인지를 본다.
    const origin = new URL(landed).origin;
    const startAbs = man && man.start_url && /^https?:/.test(man.start_url) &&
                     man.start_url.indexOf(origin) === 0;
    chk('install.startUrlIsSameOriginAbsolute', !!startAbs,
      `start_url = ${man ? man.start_url : '없음'} · 문서 출처 ${origin} ` +
      `(절대 주소이고 같은 출처여야 한다 — 상대 주소는 data:/blob: 기준에서 풀 수 없다)`);

    // --- 4. 크롬이 푼 start_url 이 **실제로 열리는가** ----------------------
    // 이게 이 검정의 요점이다. start_url 이 폴더로 풀리면 홈화면 아이콘을 눌렀을 때
    // 404 가 뜨고, 그건 설치가 된 뒤에야 드러난다.
    let startOk = false, startInfo = 'start_url 이 없다';
    if (man && man.start_url) {
      const res = await page.request.get(man.start_url);
      const body = res.ok() ? await res.text() : '';
      startOk = res.ok() && body.indexOf('__GAME') >= 0;
      startInfo = `${man.start_url} → HTTP ${res.status()} · ${body.length} 바이트 · 게임 코드 포함=${body.indexOf('__GAME') >= 0}`;
    }
    chk('install.startUrlOpensTheGame', startOk, startInfo);

    // --- 5. 음성 대조군 — 이 검정이 정말 깨진 주소를 거르는가 ---------------
    // 없는 파일을 같은 방법으로 확인해 본다. 여기서 통과가 나오면 4번은 무엇이든
    // 통과시키는 장치다.
    const bogus = await page.request.get(new URL('dist/없는파일.html', BASE).href);
    chk('install.checkDetectsBrokenStartUrl', !bogus.ok(),
      `없는 주소 → HTTP ${bogus.status()} (200 이면 4번 검사가 죽은 것)`);

    // --- 6. 아이콘을 브라우저가 실제로 그리는가 ------------------------------
    // 바이트가 PNG 서명을 갖췄다는 것과, 디코더가 그림으로 푼다는 것은 다른 말이다.
    const icon = await page.evaluate(() => {
      const l = document.querySelector('link[rel="apple-touch-icon"]');
      if (!l) return Promise.resolve(null);
      return new Promise(res => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res({ w: 0, h: 0 });
        im.src = l.getAttribute('href');
      });
    });
    chk('install.iconDecodes', !!icon && icon.w === 192 && icon.h === 192,
      icon ? `디코드된 아이콘 ${icon.w}x${icon.h} (192x192 여야)` : '아이콘 링크가 없다');

  } catch (e) {
    chk('install.driverRan', false, '검정 자체가 죽었다: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
  }

  const bad = checks.filter(c => !c.ok);
  console.log('='.repeat(92));
  console.log(' 설치 검정 — 브라우저 자신의 판정으로');
  console.log('='.repeat(92));
  for (const c of checks) {
    console.log(`  [${c.ok ? 'PASS  ' : 'FAIL  '}] ${c.name.padEnd(34)} ${c.detail}`);
  }
  console.log('-'.repeat(92));
  console.log(bad.length === 0
    ? ` GREEN — 검사 ${checks.length}건 전부 통과`
    : ` RED — ${bad.length}건 실패 / 검사 ${checks.length}건`);
  process.exit(bad.length === 0 ? 0 : 1);
})();
