// ===========================================================================
//  녹화 러너 — 자율 플레이(play.js)를 영상으로 남긴다.
//
//  pwrun.js 와 갈라 놓은 이유: 녹화는 판정 채널이 아니다. 영상은 사람이 보라고
//  만드는 것이고, **합격/불합격은 여전히 #testout 의 JSON 이 정한다.**
//  둘을 섞으면 "영상이 그럴듯하니 됐다" 로 흐르게 된다 — 실제로 첫 세 판은
//  화면상 공장이 그럴듯했지만 30분 뒤 전멸했다.
//
//  사용: node tests/record.js [speed] [mins] [outdir]
// ===========================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPEED = process.argv[2] || '12';
const MINS = process.argv[3] || '30';
const OUTDIR = process.argv[4] || path.join(__dirname, '..', 'dist', 'video');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'Logic-Foundry.html');
const DRV = path.join(ROOT, 'tests', 'play.js');

(async () => {
  let pw;
  try { pw = require('playwright'); }
  catch (e) {
    try { pw = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
    catch (e2) { console.error('FATAL: playwright 없음: ' + e.message); process.exit(2); }
  }
  if (!fs.existsSync(DIST)) { console.error('FATAL: dist 없음 — python build.py 먼저'); process.exit(2); }
  fs.mkdirSync(OUTDIR, { recursive: true });

  const html = fs.readFileSync(DIST, 'utf8');
  const driver = fs.readFileSync(DRV, 'utf8');
  const i = html.lastIndexOf('</body>');
  const page_html = html.slice(0, i) + '<script>\n' + driver + '\n</' + 'script>\n' + html.slice(i);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-rec-'));
  const file = path.join(tmp, 'run.html');
  fs.writeFileSync(file, page_html, 'utf8');

  const W = 1280, H = 720;                       // 720p — 파일이 크지 않고 읽을 수 있다
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUTDIR, size: { width: W, height: H } }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const t0 = Date.now();
  await page.goto('file:///' + file.replace(/\\/g, '/') + '?speed=' + SPEED + '&mins=' + MINS,
                  { waitUntil: 'load', timeout: 60000 });
  console.error('녹화 시작 — 배속 ' + SPEED + 'x, 게임 ' + MINS + '분');

  // 편집기가 열리는 순간을 노려 스크린샷을 남긴다. 영상에 제어기 장면이 실제로
  // 들어갔는지 '그럴듯하다' 가 아니라 프레임으로 확인하기 위한 것이다.
  (async () => {
    try {
      await page.waitForFunction(
        () => document.getElementById('logic') &&
              getComputedStyle(document.getElementById('logic')).display !== 'none',
        null, { timeout: 600000, polling: 200 });
      await page.waitForTimeout(4500);           // 노드가 몇 개 놓인 뒤
      await page.screenshot({ path: path.join(OUTDIR, 'shot-editor.png') });
      console.error('편집기 스크린샷 저장');
    } catch (e) { console.error('편집기 스크린샷 실패: ' + e.message); }
  })();

  await page.waitForFunction(
    () => {
      const el = document.getElementById('testout');
      return !!el && el.textContent.indexOf('@@JSON_END@@') >= 0;
    }, null, { timeout: 3600000, polling: 1000 });

  const payload = await page.evaluate(() => document.getElementById('testout').textContent);
  await page.screenshot({ path: path.join(OUTDIR, 'shot-final.png') });
  // 마지막 화면을 몇 초 더 담는다 — 끝나자마자 끊기면 결과를 볼 시간이 없다
  await page.waitForTimeout(3000);
  process.stdout.write(payload);
  if (errs.length) process.stderr.write('CONSOLE_ERRORS:' + JSON.stringify(errs.slice(0, 20)) + '\n');

  const video = page.video();
  await ctx.close();                             // close 해야 영상이 flush 된다
  const vpath = video ? await video.path() : null;
  await browser.close();
  console.error('실시간 ' + Math.round((Date.now() - t0) / 1000) + 's · 영상: ' + vpath);
  if (vpath) {
    const finalPath = path.join(OUTDIR, 'logic-foundry-30min.webm');
    try { fs.renameSync(vpath, finalPath); console.error('저장: ' + finalPath); }
    catch (e) { console.error('이름 변경 실패(원본 유지): ' + e.message); }
  }
  process.exit(0);
})();
