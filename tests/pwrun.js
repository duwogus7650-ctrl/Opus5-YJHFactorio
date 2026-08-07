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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

    await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
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
