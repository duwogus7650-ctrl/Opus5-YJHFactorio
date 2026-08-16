// ===========================================================================
//  녹화 — 폰 화면 그대로 자력 완주 주행을 영상으로 남긴다.
//
//  왜 있나: "폰에서 처음부터 끝까지 깨는 걸 보여 달라" 는 요구는 스크린샷으로는
//  못 채운다. 게이트는 숫자로 맞다고 말하지만, **사람이 보기에 되는가**는 다른
//  질문이고 그건 움직이는 화면으로만 답할 수 있다.
//
//  clear.js 를 CINEMA 모드(?cine=1)로 돌린다 — 카메라가 지금 벌어지는 일을 따라간다.
//  뷰포트는 폰(390x844)이고 터치 컨텍스트다. 즉 **데스크톱 화면을 세로로 자른 것이
//  아니라** 실제 폰 레이아웃(바닥 시트·조작 바·계기 띠)이 그대로 찍힌다.
//
//  같이 남기는 것: 0.5초마다 게임 상태를 찍은 **타임라인 JSON**. 나중에 하이라이트를
//  자를 때 "몇 분쯤" 이 아니라 "연구 3개째가 끝난 순간" 으로 자를 수 있어야 한다.
//
//  사용: node tests/record.js [출력폴더] [speed]
// ===========================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'Logic-Foundry.html');
const DRV = path.join(__dirname, 'clear.js');
const OUTDIR = process.argv[2] || path.join(ROOT, 'shots', 'video');
const SPEED = process.argv[3] || '16';
const TIMEOUT = parseInt(process.env.LF_TIMEOUT || '1800', 10) * 1000;

(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  if (!fs.existsSync(DIST)) { console.error('FATAL: dist 가 없다 — python build.py 먼저'); process.exit(2); }

  const html = fs.readFileSync(DIST, 'utf8');
  const driver = fs.readFileSync(DRV, 'utf8');
  const i = html.lastIndexOf('</body>');
  const page_html = html.slice(0, i) + '<script>\n' + driver + '\n</' + 'script>\n' + html.slice(i);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-rec-'));
  const file = path.join(tmp, 'run.html');
  fs.writeFileSync(file, page_html, 'utf8');
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));

  const t0 = Date.now();
  const timeline = [];
  // 도입부만 따로 느리게 찍을 수 있어야 한다 — 전체 주행에서는 첫 2분이 10초도
  // 안 되어 '처음 시작하는 단계' 를 보여 줄 수가 없다.
  const MINS = process.argv[4] || '40';
  const qs = '?cine=1&drama=0&speed=' + SPEED + '&mins=' + MINS;
  await page.goto('file:///' + file.replace(/\\/g, '/') + qs, { waitUntil: 'load', timeout: 60000 });

  // 0.5초마다 상태를 찍는다. 이 표가 나중에 "어디를 자를까" 의 근거가 된다 —
  // 눈대중으로 고르면 매번 다른 데를 자르게 되고, 그건 재현이 안 된다.
  const sampler = setInterval(async () => {
    try {
      const s = await page.evaluate(() => {
        if (!window.__GAME) return null;
        const st = window.__GAME.state();
        return { t: Math.round(st.t), res: st.research.done.length, ents: st.entityCount,
                 waves: st.waves.waves, lost: st.waves.lost, enemies: st.enemies,
                 sat: Math.round(st.power.sat * 100) };
      });
      if (s) timeline.push(Object.assign({ wall: (Date.now() - t0) / 1000 }, s));
    } catch (e) { /* 페이지가 닫히는 중이면 무시 */ }
  }, 500);

  // **카메라를 공장에 붙든다.** 주행 드라이버의 카메라는 마지막으로 손댄 자리를
  // 따라가는데, 후반에는 그게 먼 광맥이라 화면이 빈 풀밭이 된다(실측: 29분 지점
  // 프레임이 통째로 초원). 하이라이트로 쓸 수 없어서, 녹화 쪽에서 생산 설비의
  // 무게중심으로 돌려 둔다. 적이 있을 때는 드라이버 카메라를 존중한다 — 그때는
  // 전투가 볼거리다.
  const camHold = setInterval(async () => {
    try {
      await page.evaluate(() => {
        const G = window.__GAME; if (!G) return;
        if (G.state().enemies > 0) return;
        // **평균이 아니라 중앙값.** 채광기는 먼 광맥까지 흩어져 있어서 평균을 내면
        // 무리와 무리 **사이의 빈 풀밭**에 카메라가 선다(실측: 29분 프레임이 통째로
        // 초원이었다). 공장 한복판에만 있는 것(조립기·연구소·제어기)으로 좁히고,
        // 그중에서도 중앙값을 쓴다.
        const xs = [], ys = [];
        for (const row of G.entIds()) {
          const id = Array.isArray(row) ? row[0] : row;
          const e = G.ent(id); if (!e) continue;
          if (e.type === 'assembler' || e.type === 'lab' || e.type === 'controller') {
            xs.push(e.tx); ys.push(e.ty);
          }
        }
        if (xs.length < 2) return;
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
        const mid = i2 => i2[Math.floor(i2.length / 2)];
        G.setCamera(mid(xs) + 1, mid(ys) + 1, 0.95);
      });
    } catch (e) { /* 닫히는 중 */ }
  }, 1000);

  let done = false;
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('testout');
      return !!el && el.textContent.indexOf('@@JSON_END@@') >= 0;
    }, null, { timeout: TIMEOUT, polling: 1000 });
    done = true;
  } catch (e) {
    console.error('주행이 시간 안에 안 끝났다 — 지금까지 찍힌 것으로 마감한다: ' + e.message);
  }
  clearInterval(sampler);
  clearInterval(camHold);

  const payload = done ? await page.evaluate(() => document.getElementById('testout').textContent) : '';
  const video = page.video();
  await ctx.close();                 // 여기서 영상 파일이 확정된다
  const vpath = video ? await video.path() : null;
  await browser.close();

  const wall = (Date.now() - t0) / 1000;
  const meta = { video: vpath, wallSeconds: Math.round(wall), speed: +SPEED,
                 finished: done, errors: errors.slice(0, 10), timeline: timeline };
  const metaPath = path.join(OUTDIR, 'timeline.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1), 'utf8');

  const last = timeline[timeline.length - 1] || {};
  console.log('영상: ' + vpath);
  console.log('벽시계 ' + Math.round(wall) + '초 · 게임 시각 ' + (last.t || 0) + 's · 연구 ' +
              (last.res || 0) + '종 · 엔티티 ' + (last.ents || 0) + ' · 습격 ' + (last.waves || 0) +
              ' · 손실 ' + (last.lost || 0));
  console.log('타임라인: ' + metaPath + ' (' + timeline.length + '점)');
  if (payload) {
    const m = /@@JSON_START@@([\s\S]*)@@JSON_END@@/.exec(payload);
    if (m) {
      const out = JSON.parse(m[1]);
      const bad = (out.checks || []).filter(c => !c.ok && !c.expectFail);
      console.log('게이트: ' + (out.checks || []).length + '건 · 실패 ' + bad.length +
                  (bad.length ? ' — ' + bad.map(c => c.name).join(',') : ''));
    }
  }
  if (errors.length) console.log('런타임 오류: ' + errors.slice(0, 3).join(' | '));
})();
