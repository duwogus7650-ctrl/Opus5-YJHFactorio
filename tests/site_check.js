// ===========================================================================
//  소개 페이지 검사 — 이 페이지는 "남에게 보여주는 얼굴"이라 깨지면 티가 크다.
//
//  텍스트로 훑지 않고 **실제로 띄워서 잰다**:
//   * 바깥 호스트로 나가는 요청이 0건인가 (문자열 검사는 동적 요청을 못 본다)
//   * 폰 폭에서 가로로 넘치지 않는가
//   * 그림이 실제로 그려졌는가 (naturalWidth · 파일이 없으면 0 이다)
//   * [지금 플레이] 가 진짜 게임으로 가는가 — 눌러서 부팅까지 확인한다
//   * 콘솔 오류 0건
// ===========================================================================
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'index.html')).href;

let pass = 0, fail = 0;
function chk(ok, name, detail) {
  console.log('  [' + (ok ? 'PASS  ' : 'FAIL  ') + '] ' + name.padEnd(30) + ' ' + detail);
  if (ok) pass++; else fail++;
}

(async () => {
  const b = await chromium.launch();
  for (const dev of [{ n: '폰', w: 412, h: 883, m: true }, { n: '데스크톱', w: 1280, h: 800, m: false }]) {
    const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h },
                                     isMobile: dev.m, hasTouch: dev.m });
    const p = await ctx.newPage();
    const external = [], errors = [];
    p.on('request', r => {
      const u = r.url();
      if (!/^(file|data|blob):/.test(u)) external.push(u.slice(0, 80));
    });
    p.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 90)); });

    await p.goto(PAGE, { waitUntil: 'load' });
    await p.waitForTimeout(300);

    chk(external.length === 0, 'site.noExternalRequests[' + dev.n + ']',
        '바깥 호스트 요청 ' + external.length + '건' + (external.length ? ': ' + external.join(' ') : ''));

    const over = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
      wide: Array.from(document.querySelectorAll('body *'))
              .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 4).map(el => el.tagName + '.' + (el.className || '')) }));
    chk(over.doc <= over.win + 1 && over.wide.length === 0, 'site.noHorizontalOverflow[' + dev.n + ']',
        '문서 폭 ' + over.doc + ' vs 창 ' + over.win + (over.wide.length ? ' · 넘친 요소 ' + over.wide.join(', ') : ''));

    const imgs = await p.evaluate(() => Array.from(document.images).map(i => ({
      src: i.getAttribute('src'), w: i.naturalWidth, alt: (i.alt || '').length })));
    const dead = imgs.filter(i => !i.w);
    const noAlt = imgs.filter(i => !i.alt);
    chk(imgs.length >= 3 && dead.length === 0 && noAlt.length === 0, 'site.imagesRender[' + dev.n + ']',
        '그림 ' + imgs.length + '장 · 안 그려진 것 ' + dead.length +
        (dead.length ? '(' + dead.map(d => d.src).join(',') + ')' : '') + ' · alt 없는 것 ' + noAlt.length);

    const play = await p.evaluate(() => {
      const a = document.querySelector('a.play');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { href: a.getAttribute('href'), h: Math.round(r.height), w: Math.round(r.width),
               onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
    });
    chk(!!play && play.href === 'dist/Logic-Foundry.html' && play.h >= 44 && play.onScreen,
        'site.playButtonIsReachable[' + dev.n + ']',
        play ? ('[지금 플레이] ' + play.w + 'x' + play.h + ' · href=' + play.href +
                ' · 첫 화면 안=' + play.onScreen) : '버튼이 없다');

    chk(errors.length === 0, 'site.noConsoleErrors[' + dev.n + ']', errors.join(' | ') || '없음');

    // 눌러서 진짜 게임이 뜨는가 — 링크만 맞고 파일이 없는 경우를 걸러낸다
    if (dev.n === '데스크톱') {
      await p.click('a.play');
      const booted = await p.waitForFunction(() => !!window.__GAME, null, { timeout: 30000 })
                            .then(() => true).catch(() => false);
      const stamp = booted ? await p.evaluate(() => window.__GAME.buildId()) : '-';
      chk(booted, 'site.playLinkBootsGame', '[지금 플레이] 를 눌러 게임 부팅 = ' + booted + ' · 도장 ' + stamp);
    }
    await ctx.close();
  }
  await b.close();
  console.log('-'.repeat(92));
  console.log(fail === 0 ? (' GREEN — 소개 페이지 검사 ' + pass + '건 전부 통과')
                         : (' RED — ' + fail + '건 실패 / ' + (pass + fail) + '건'));
  process.exit(fail === 0 ? 0 : 1);
})();
