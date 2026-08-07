// ===========================================================================
//  엔진별 스크린샷 — Firefox / WebKit / Chromium 에서 같은 장면을 찍는다.
//  장면 스크립트는 tests/scene-factory.js 하나를 shots.py 와 공유한다.
//
//  사용: node tests/pwshot.js <engine> <출력경로> [장면파일]
//  실패 시 exit 2. 장면 스크립트가 던지면 document.title 로 드러난다.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE = process.argv[2] || 'firefox';
const OUT = process.argv[3] || path.join(__dirname, '..', 'shots', 'engine-' + ENGINE + '.png');
const SCENE = process.argv[4] || path.join(__dirname, 'scene-factory.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'Logic-Foundry.html');

(async () => {
  const pw = require('playwright');
  const bt = pw[ENGINE];
  if (!bt) { console.error('FATAL: 알 수 없는 엔진 ' + ENGINE); process.exit(2); }
  if (!fs.existsSync(DIST)) { console.error('FATAL: dist 없음'); process.exit(2); }

  const html = fs.readFileSync(DIST, 'utf8');
  const scene = fs.readFileSync(SCENE, 'utf8');
  const i = html.lastIndexOf('</body>');
  // 장면은 부팅이 끝난 뒤에 돌아야 한다
  const inject = '<script>\nwindow.addEventListener("load", function(){ setTimeout(function(){\n' +
    'try{\n' + scene + '\n window.__SCENE_OK = true;\n}catch(e){ window.__SCENE_ERR = String(e); document.title = "SCENE ERROR: " + e; }\n' +
    '}, 150); });\n</' + 'script>\n';
  const page_html = html.slice(0, i) + inject + html.slice(i);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-shot-'));
  const file = path.join(tmp, 'shot.html');
  fs.writeFileSync(file, page_html, 'utf8');

  let browser;
  try {
    browser = await bt.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__SCENE_OK === true || !!window.__SCENE_ERR,
      null, { timeout: 120000, polling: 300 });
    const sceneErr = await page.evaluate(() => window.__SCENE_ERR || null);
    if (sceneErr) { console.error('FATAL: 장면 스크립트 실패: ' + sceneErr); await browser.close(); process.exit(2); }
    // 렌더가 실제로 뭔가 그렸는지 엔진 안에서 직접 확인한다 (빈 그림 캡처 방지)
    const probe = await page.evaluate(() => window.__PIXEL_PROBE ? window.__PIXEL_PROBE(96, 96) : null);
    const state = await page.evaluate(() => window.__GAME.state());
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT });
    console.log(JSON.stringify({
      engine: ENGINE, out: OUT, uniqueRGB: probe ? probe.uniqueRGB : null,
      entities: state.entityCount, counts: state.counts,
      power: Math.round(state.power.sat * 100), errors: errs.slice(0, 10)
    }));
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FATAL: ' + (err && err.stack ? err.stack : String(err)));
    try { if (browser) await browser.close(); } catch (e) { void e; }
    process.exit(2);
  }
})();
