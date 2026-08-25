// ===========================================================================
//  녹화 — **제어기 회로를 짜는 장면**만 따로 남긴다.
//
//  왜 따로인가: 자력 완주 주행(clear.js)은 배선을 모델 호출로 한다(gAdd/gLink).
//  숫자로는 맞지만 화면에는 아무 일도 안 일어난다 — 편집기를 열었다 바로 닫는다.
//  그래서 완주 영상에는 **이 게임의 본체가 안 나온다.** 여기서는 사람이 하는 길
//  그대로, 손가락으로 눌러서 짠다.
//
//  속도: 사람이 따라올 수 있어야 한다. 한 동작마다 멈춰서 무슨 일이 일어났는지
//  보이게 한다 — 빨리 감으면 '되는 것' 은 보여도 '하는 법' 은 안 보인다.
//
//  사용: node tests/record_wiring.js [출력폴더]
// ===========================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'Logic-Foundry.html');
const OUTDIR = process.argv[2] || path.join(ROOT, 'shots', 'video-wiring');

(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  if (!fs.existsSync(DIST)) { console.error('FATAL: dist 가 없다 — python build.py 먼저'); process.exit(2); }
  const html = fs.readFileSync(DIST, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-wire-'));
  const file = path.join(tmp, 'run.html');
  fs.writeFileSync(file, html, 'utf8');
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
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);

  // 손가락 하나로 누르는 것을 페이지 안에서 합성한다. Playwright 의 tap 은
  // 좌표계가 달라 편집기 안에서 어긋난다 — 게임이 실제로 듣는 이벤트를 그대로 쏜다.
  await page.addScriptTag({ content: `
    window.__fingerTap = function (sel, dx, dy) {
      var el = document.querySelector(sel);
      if (!el) return 'NO:' + sel;
      var q = el.getBoundingClientRect();
      var x = q.left + q.width / 2 + (dx || 0), y = q.top + q.height / 2 + (dy || 0);
      function fire(type, list) {
        var t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y,
                            pageX: x, pageY: y, radiusX: 12, radiusY: 12, force: 1 });
        var ev = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true,
          touches: list ? [t] : [], targetTouches: list ? [t] : [], changedTouches: [t] });
        el.dispatchEvent(ev); return ev;
      }
      fire('touchstart', true);
      var end = fire('touchend', false);
      if (!end.defaultPrevented) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
                                                   clientX: x, clientY: y }));
      }
      return 'OK';
    };
  ` });

  const say = async (msg, ms) => {
    await page.evaluate((m) => { if (window.__GAME) window.__GAME.ui.toast(m, 'warn'); }, msg);
    await page.waitForTimeout(ms || 1600);
  };
  const tapSel = async (sel, wait) => {
    const r = await page.evaluate(([s]) => window.__fingerTap(s), [sel]);
    if (String(r).startsWith('NO:')) throw new Error('못 찾음: ' + sel);
    await page.waitForTimeout(wait || 900);
    return r;
  };

  // --- 무대 만들기: 상자 하나, 조립기 하나, 제어기 하나 ---
  const ids = await page.evaluate(() => {
    const G = window.__GAME;
    G.reset(20260824); G.clearEntities(); G.clearEnemies();
    G.giveAll(9999); G.powerCheat(true);
    G.research('logistics'); G.research('logic-mem');
    const tc = document.getElementById('tutorClose'); if (tc) tc.click();
    const box = G.place('chest', 78, 78, 0);
    const asm = G.place('assembler', 83, 78, 0);
    G.setRecipe(asm, 'gear');
    G.fillChest(box, 'gear', 10);
    const ctl = G.place('controller', 80, 82, 0);
    G.ui.select(-1);
    return { box: box, asm: asm, ctl: ctl };
  });
  await page.waitForTimeout(800);

  await say('만들 것: "상자의 톱니가 50개 아래면 조립기를 돌린다"', 2600);

  // --- 편집기를 연다 (사람이 하는 길: 제어기를 누른다) ---
  await page.evaluate((c) => { window.__GAME.ui.openLogic(c); window.__GAME.ui.showGraph(); }, ids.ctl);
  await page.waitForTimeout(1200);
  await say('제어기를 누르면 노드 편집기가 열린다', 2200);

  // --- 노드 세 개를 놓는다 ---
  const nodes = await page.evaluate((v) => {
    const G = window.__GAME;
    const sense = G.gAdd(v.ctl, 'chest', 30, 30);
    G.gCfg(v.ctl, sense, 'ent', v.box); G.gCfg(v.ctl, sense, 'item', 'gear');
    G.ui.renderGraph();
    return { sense: sense };
  }, ids);
  await say('① 상자 재고를 읽는 노드', 2200);

  const n2 = await page.evaluate((v) => {
    const G = window.__GAME;
    const k = G.gAdd(v.ctl, 'const', 30, 250); G.gCfg(v.ctl, k, 'value', 50);
    const cmp = G.gAdd(v.ctl, 'cmp', 30, 400); G.gCfg(v.ctl, cmp, 'op', '<');
    G.ui.renderGraph();
    return { k: k, cmp: cmp };
  }, ids);
  await say('② 50 과 견주는 노드 — "50보다 적으면"', 2200);

  const n3 = await page.evaluate((v) => {
    const G = window.__GAME;
    const en = G.gAdd(v.ctl, 'enable', 30, 600); G.gCfg(v.ctl, en, 'ent', v.asm);
    G.ui.renderGraph();
    return { en: en };
  }, ids);
  await say('③ 조립기를 켜고 끄는 노드', 2200);

  // --- 배선: 톡 누르고, 이을 곳을 누른다 (오늘 만든 길) ---
  await say('배선은 톡 누르고 → 이을 곳을 누른다', 2400);

  const wire = async (fromSel, toSel, msg) => {
    await tapSel(fromSel, 1100);          // 겨눔 — 노란 테두리가 켜진다
    await page.waitForTimeout(700);
    await tapSel(toSel, 1100);            // 잇는다
    if (msg) await say(msg, 1800);
  };

  await wire(`.node[data-nid="${nodes.sense}"] .port.out[data-out="0"]`,
             `.node[data-nid="${n2.cmp}"] .port.in[data-in="0"]`,
             '재고 → 비교의 A');
  await wire(`.node[data-nid="${n2.k}"] .port.out[data-out="0"]`,
             `.node[data-nid="${n2.cmp}"] .port.in[data-in="1"]`,
             '50 → 비교의 B');
  await wire(`.node[data-nid="${n2.cmp}"] .port.out[data-out="0"]`,
             `.node[data-nid="${n3.en}"] .port.in[data-in="0"]`,
             '비교 결과 → 조립기 가동');

  // --- 돌려 본다 ---
  await say('이제 돌려 본다 — 재고 10개니까 켜져야 한다', 2400);
  await page.evaluate(() => { window.__GAME.run(1.5); window.__GAME.ui.updateLive(); });
  await page.waitForTimeout(2200);

  const on = await page.evaluate((v) => window.__GAME.ent(v.asm).enabled, ids);
  await say('조립기 가동 = ' + on + ' (켜졌다)', 2600);

  // 반대로 — 재고를 채우면 꺼져야 한다. **음성 대조군을 영상에도 남긴다**:
  // 켜지는 것만 보여 주면 "원래 켜져 있던 것" 과 구분이 안 된다.
  await say('상자를 300개로 채우면?', 2200);
  await page.evaluate((v) => {
    const G = window.__GAME;
    G.fillChest(v.box, 'gear', 300);
    G.run(1.5); G.ui.updateLive();
  }, ids);
  await page.waitForTimeout(2400);
  const off = await page.evaluate((v) => window.__GAME.ent(v.asm).enabled, ids);
  await say('조립기 가동 = ' + off + ' (스스로 껐다)', 3000);

  const video = page.video();
  await ctx.close();
  const vpath = video ? await video.path() : null;
  await browser.close();
  console.log('영상: ' + vpath);
  console.log('켜짐=' + on + ' 꺼짐=' + off + ' · 오류 ' + errors.length +
              (errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''));
  if (on !== true || off !== false) {
    console.error('FATAL: 회로가 실제로 동작하지 않았다 — 영상은 남았지만 내용이 거짓이다');
    process.exit(2);
  }
})();
