// ===========================================================================
//  소개 페이지용 스크린샷 — 사람이 "이게 뭔지" 알아보게 하는 그림 넉 장.
//
//  장면은 코드로 만든다. 손으로 찍으면 다음에 다시 못 찍고, 게임이 바뀌면 그림만
//  옛날 것으로 남는다. 여기서 만든 장면은 언제든 같은 그림을 다시 낸다.
//
//  사용: node tools/make_site_shots.js
// ===========================================================================
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const GAME = pathToFileURL(path.join(ROOT, 'dist', 'Logic-Foundry.html')).href;
const OUT = path.join(ROOT, 'site');
const SCENE = fs.readFileSync(path.join(ROOT, 'tests', 'scene-factory.js'), 'utf8');

async function boot(ctx) {
  const p = await ctx.newPage();
  await p.goto(GAME, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__GAME, null, { timeout: 30000 });
  return p;
}

// 소개용 그림에서는 **안내가 화면을 가리면 안 된다.** 튜토리얼 판과 안내 줄은
// 게임을 처음 여는 사람에게 필요한 것이지, "이게 무슨 게임인가"를 보여주는 그림에는
// 방해다. 첫 판을 찍었더니 공장 절반이 튜토리얼에 덮여 있었다.
async function tidy(p) {
  await p.evaluate(() => {
    // **닫기 버튼으로 닫는다.** tutorialSkip() 은 '한 단계 건너뛰기'라 판이 다음
    // 단계로 다시 뜬다(그렇게 찍혀서 공장 절반이 가려졌다). 사람이 ✕ 를 누르는 것과
    // 같은 길로 닫아야 닫힌 채로 있는다.
    const close = document.getElementById('tutorClose');
    if (close) close.click();
    const t = document.getElementById('tutor');
    if (t) t.style.display = 'none';
    const toast = document.getElementById('toast');
    if (toast) toast.innerHTML = '';
    document.body.classList.remove('tutor-off');
    const chip = document.getElementById('tutorChip');
    if (chip) chip.style.display = 'none';
  });
}

(async () => {
  const b = await chromium.launch();
  const shots = [];

  // 1) 돌아가는 공장 — 표준 장면을 그대로 쓴다(시험과 같은 그림이라 어긋날 일이 없다)
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const p = await boot(ctx);
    await p.evaluate(SCENE);
    await tidy(p);
    // 히어로 그림은 라인 두어 개가 아니라 **공장 한 판**이 보여야 한다
    await p.evaluate(() => { window.__GAME.center(78, 76); window.__GAME.setZoom(0.85); window.__GAME.render(); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'shot-factory.jpg'), type: 'jpeg', quality: 80 });
    shots.push('shot-factory.jpg');
    await ctx.close();
  }

  // 2) 제어기 — 이 게임에만 있는 것. 노드 편집기를 열어 회로가 보이게 둔다
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const p = await boot(ctx);
    await p.evaluate(SCENE);
    await p.evaluate(() => {
      const G = window.__GAME;
      const ids = G.entIds().filter(e => e[1] === 'controller');
      if (!ids.length) return;
      G.ui.select(ids[0][0]);
      G.ui.openLogic ? G.ui.openLogic(ids[0][0]) : null;
      // **순서가 중요하다.** 문장 화면에서 예제를 부르고 회로로 펼치면, 빈 문장이
      // 컴파일돼 0노드 회로가 나온다(그렇게 한 번 찍혔다). 회로 화면으로 먼저 가고,
      // 그다음 예제를 부른다.
      var toGraph = document.getElementById('btnToGraph');
      if (toGraph) toGraph.click();
      var n = G.ui.loadExample();
      G.ui.renderGraph(); G.ui.updateLive();
      return n;
    });
    await tidy(p);
    await p.waitForTimeout(500);
    const nodeN = await p.evaluate(() => window.__GAME.ui.nodeCount());
    if (!nodeN) { console.log('FATAL: 회로가 비었다 — 노드 0개짜리 그림을 낼 수 없다'); process.exit(2); }
    console.log('  회로 노드 ' + nodeN + '개');
    await p.screenshot({ path: path.join(OUT, 'shot-logic.jpg'), type: 'jpeg', quality: 80 });
    shots.push('shot-logic.jpg');
    await ctx.close();
  }

  // 3) 폰 — 실제로 폰에서 어떻게 보이는지. 건설 시트를 열어 둔다
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 883 }, deviceScaleFactor: 2,
                                     isMobile: true, hasTouch: true });
    const p = await boot(ctx);
    await p.evaluate(SCENE);
    await tidy(p);
    await p.evaluate(() => {
      const b2 = document.getElementById('btnSheetBuild');
      if (b2) b2.click();
      window.__GAME.center(80, 78);
      window.__GAME.render();
    });
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'shot-phone.jpg'), type: 'jpeg', quality: 80 });
    shots.push('shot-phone.jpg');
    await ctx.close();
  }

  // 4) 석유·화학 — 최근에 들어온 층. 펌프잭 → 정제소 → 화학공장 한 줄
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const p = await boot(ctx);
    await p.evaluate(() => {
      const G = window.__GAME;
      G.reset(424242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.clearTrees(); G.ui.closeHelp();
      G.research('steel'); G.research('logistics'); G.research('oil');
      const o = G.oilSpot(80, 80);
      if (!o) return;
      // **전기를 치트로 주지 않는다.** 치트로 돌리면 인스펙터가 정직하게 '망 미연결'
      // 이라고 빨갛게 적는다 — 실제로 도는 판인데 고장 난 그림이 된다.
      // 발전기 900kW 한 대면 세 대(90+420+210=720kW)를 먹인다.
      const gen = G.place('generator', o.x + 2, o.y + 5, 0);
      G.setFuel(gen, 4000 * 900);
      for (let px = o.x - 1; px <= o.x + 11; px += 4) G.place('pole', px, o.y + 4, 0);
      G.place('pole', o.x + 2, o.y + 4, 0);
      const pj = G.build('pumpjack', o.x, o.y, 0);
      for (let i = 0; i < 3; i++) G.build('pipe', o.x + 3, o.y + i, 0);
      G.build('refinery', o.x + 4, o.y, 0);
      for (let i = 0; i < 3; i++) G.build('pipe', o.x + 7, o.y + i, 0);
      const cp = G.build('chemplant', o.x + 8, o.y, 0);
      G.run(40);
      // 화학공장을 고른다 — 플라스틱이 실제로 쌓인 것이 보여야 "돈다"가 그림이 된다
      G.ui.select(cp || pj);
      G.center(o.x + 5, o.y + 2); G.setZoom(1.35);
      G.ui.refresh(); G.render();
      return { plastic: (G.ent(cp).out['plastic'] || 0), sat: G.ent(cp).powerSat };
    });
    await tidy(p);
    const oilState = await p.evaluate(() => {
      const G = window.__GAME;
      const ids = G.entIds().filter(e => e[1] === 'chemplant');
      if (!ids.length) return null;
      const e = G.ent(ids[0][0]);
      return { plastic: (e.out['plastic'] || 0), sat: Math.round(e.powerSat * 100) };
    });
    if (!oilState || !oilState.plastic) {
      console.log('FATAL: 석유 라인이 안 돈다 — ' + JSON.stringify(oilState) +
                  ' (안 도는 판을 소개 그림으로 낼 수는 없다)');
      process.exit(2);
    }
    console.log('  석유 라인 플라스틱 ' + oilState.plastic + '개 · 전력 ' + oilState.sat + '%');
    await p.evaluate(() => window.__GAME.render());
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'shot-oil.jpg'), type: 'jpeg', quality: 80 });
    shots.push('shot-oil.jpg');
    await ctx.close();
  }

  await b.close();
  for (const s of shots) {
    const kb = Math.round(fs.statSync(path.join(OUT, s)).size / 1024);
    console.log('  ' + s.padEnd(20) + kb + ' KB');
  }
  console.log('스크린샷 ' + shots.length + '장 -> site/');
})();
