// ===========================================================================
//  Playwright 러너 — 같은 드라이버를 Firefox / WebKit / Chromium 에서 돌린다.
//
//  왜 별도로 필요한가: harness.py 는 Chromium 의 --dump-dom 으로 #testout 을 읽는다.
//  그 스위치는 Chromium 전용이라 Firefox·WebKit 에서는 쓸 수 없다. 여기서는 같은
//  판정 채널(#testout 의 JSON)을 페이지 안에서 직접 읽어 표준출력으로 넘긴다.
//  판정 로직은 harness.py 한 곳에만 둔다 — 엔진마다 다른 채점기를 만들지 않는다.
//
//  사용: node tests/pwrun.js <firefox|webkit|chromium> <드라이버파일> [타임아웃ms]
//  출력: @@JSON_START@@ ... @@JSON_END@@  (harness.py 와 같은 마커)
// ===========================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE = process.argv[2] || 'firefox';
const DRIVER = process.argv[3] || 'driver.js';
const TIMEOUT = parseInt(process.argv[4] || '300000', 10);
const DEVICE = (process.argv[5] || 'desktop').toLowerCase();

// 기기 프로필. **hasTouch/isMobile 을 켜야 진짜 TouchEvent 가 나간다** —
// 뷰포트만 줄이면 여전히 마우스 이벤트라 "폰에서 되는가"를 재는 게 아니다.
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  // iPhone 13 급 세로. 폭 390 은 요즘 폰의 사실상 하한선이다.
  mobile:  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
             isMobile: true, hasTouch: true,
             userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
                        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  // 작은 태블릿 세로 — 패널이 두 개 이상 들어갈 수 있는 경계
  tablet:  { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2,
             isMobile: true, hasTouch: true },
  // 갤럭시 S 계열 세로. 폭이 412 로 아이폰(390)보다 넓고 세로가 짧아(915 지만 브라우저
  // 껍데기를 빼면 더 짧다) **시트와 지도가 나눠 갖는 높이가 달라진다.** 실제로 쓰는
  // 기기가 이쪽이면 이 비율로도 재야 한다 — 390 에서 GREEN 이라고 412 가 GREEN 은 아니다.
  galaxy:  { viewport: { width: 412, height: 883 }, deviceScaleFactor: 2.6,
             isMobile: true, hasTouch: true,
             userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 ' +
                        '(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  // 갤럭시 폴드 안쪽 화면에 가까운 정사각 비율 — 가장 넓은 폰
  fold:    { viewport: { width: 673, height: 841 }, deviceScaleFactor: 2.6,
             isMobile: true, hasTouch: true }
};
if (!DEVICES[DEVICE]) { console.error('FATAL: 알 수 없는 기기 ' + DEVICE); process.exit(2); }

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'Logic-Foundry.html');
const DRV = path.isAbsolute(DRIVER) ? DRIVER : path.join(ROOT, 'tests', DRIVER);

(async () => {
  let pw;
  try { pw = require('playwright'); }
  catch (e) {
    // npx 로 받은 전역 설치를 쓰는 경우를 위해 한 번 더 시도
    try { pw = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
    catch (e2) { console.error('FATAL: playwright 모듈을 찾을 수 없다: ' + e.message); process.exit(2); }
  }
  const browserType = pw[ENGINE];
  if (!browserType) { console.error('FATAL: 알 수 없는 엔진 ' + ENGINE); process.exit(2); }

  if (!fs.existsSync(DIST)) { console.error('FATAL: dist 가 없다 — python build.py 먼저'); process.exit(2); }
  const html = fs.readFileSync(DIST, 'utf8');
  const driver = fs.readFileSync(DRV, 'utf8');
  const i = html.lastIndexOf('</body>');
  const page_html = html.slice(0, i) + '<script>\n' + driver + '\n</' + 'script>\n' + html.slice(i);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-pw-'));
  const file = path.join(tmp, 'run.html');
  fs.writeFileSync(file, page_html, 'utf8');

  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    // firefox 는 isMobile/hasTouch 를 지원하지 않는다 — 뷰포트만 적용하고 그 사실을
    // 남긴다. 조용히 데스크톱으로 도는 것을 GREEN 으로 읽으면 거짓 검증이 된다.
    const prof = Object.assign({}, DEVICES[DEVICE]);
    if (ENGINE === 'firefox') { delete prof.isMobile; delete prof.hasTouch; }
    const ctx = await browser.newContext(prof);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

    // 드라이버에 넘길 질의문자열. **예전에는 이걸 아무도 안 읽었다** — 세션 내내
    // `LF_QS="speed=60&mins=40"` 을 붙여 놓고 실제로는 기본값으로 돌았고, 그 사실이
    // 어디에도 드러나지 않았다. 조용히 무시되는 손잡이는 없느니만 못하다.
    const QS = (process.env.LF_QS || '').replace(/^\?/, '');
    if (QS) console.error('질의문자열: ?' + QS);
    await page.goto('file:///' + file.replace(/\\/g, '/') + (QS ? '?' + QS : ''),
                    { waitUntil: 'load', timeout: 60000 });
    // 드라이버가 #testout 에 결과를 실을 때까지 기다린다 (판정 채널은 엔진과 무관)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('testout');
        return !!el && el.textContent.indexOf('@@JSON_END@@') >= 0;
      },
      null,
      { timeout: TIMEOUT, polling: 500 }
    );
    const payload = await page.evaluate(() => document.getElementById('testout').textContent);
    // 엔진별 콘솔 오류도 결과에 얹어 준다 (드라이버가 못 보는 종류가 있다)
    process.stdout.write(payload);
    if (consoleErrors.length) {
      process.stderr.write('CONSOLE_ERRORS:' + JSON.stringify(consoleErrors.slice(0, 20)) + '\n');
    }
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FATAL: ' + (err && err.stack ? err.stack : String(err)));
    try { if (browser) await browser.close(); } catch (e3) { void e3; }
    process.exit(2);
  }
})();
