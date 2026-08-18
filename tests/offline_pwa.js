// ===========================================================================
//  오프라인 검정 — "설치한 앱이 비행기 모드에서 뜨는가"를 **실제로 끊고** 재본다.
//
//  문서에 매니페스트가 있다는 것과 오프라인에서 뜬다는 것은 다른 사실이다.
//  전자는 mobile.manifestIsInstallable 이 보고, 여기서는 후자만 본다:
//   1) 로컬 서버로 열고 서비스워커가 붙을 때까지 기다린다
//   2) 네트워크를 끊고 새로고침 → 게임이 떠야 한다
//   3) **음성 대조군** — 서비스워커가 없는 새 프로필에서 끊고 열면 못 떠야 한다.
//      이게 없으면 "그냥 캐시라서 떴을 뿐"인 판을 GREEN 으로 읽는다.
// ===========================================================================
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8731;
const URL_GAME = 'http://127.0.0.1:' + PORT + '/dist/Logic-Foundry.html';

function line(ok, name, detail) {
  console.log('  [' + (ok ? 'PASS  ' : 'FAIL  ') + '] ' + name.padEnd(28) + ' ' + detail);
  return ok;
}

(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
                    { cwd: ROOT, stdio: 'ignore' });
  const done = () => { try { srv.kill(); } catch (e) { void e; } };
  process.on('exit', done);
  await new Promise(r => setTimeout(r, 1200));

  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const chk = (ok, n, d) => { if (line(ok, n, d)) pass++; else fail++; };

  try {
    // ---- 1) 온라인에서 열고 서비스워커가 붙기를 기다린다 --------------------
    const ctx = await b.newContext({ viewport: { width: 412, height: 883 },
                                     isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(URL_GAME, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__GAME, null, { timeout: 30000 });
    const controlled = await p.waitForFunction(
      () => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 }
    ).then(() => true).catch(() => false);
    chk(controlled, 'offline.swTakesControl',
        '서비스워커가 이 판을 맡았는가 = ' + controlled + ' (안 붙으면 오프라인은 없다)');

    // ---- 1.5) 게임이 스스로 "준비됐다"고 말하는가 --------------------------
    // 실기기에서 비행기 모드에 '오프라인 상태입니다'가 떴는데, 화면만으로는 저장이
    // 안 된 것인지 워커가 안 맡은 것인지 알 수 없었다. 이제 도움말이 그 답을 적는다.
    // **그 문구가 실제 상태와 맞는지**를 여기서 검정한다(틀린 안내가 더 나쁘다).
    await p.evaluate(() => window.__GAME.ui.openHelp());
    await p.waitForTimeout(600);
    const statTxt = await p.evaluate(() => window.__GAME.ui.offlineStatusText());
    chk(!!statTxt && /준비됨/.test(statTxt), 'offline.gameSaysItIsReady',
        '도움말의 오프라인 준비 = "' + statTxt + '" (여기서 준비됨이라고 적으면 ' +
        '아래 비행기 모드 검사도 통과해야 한다 — 안 그러면 이 안내가 거짓말이다)');
    await p.evaluate(() => window.__GAME.ui.closeHelp());

    // ---- 2) 네트워크를 끊고 새로고침 ---------------------------------------
    await ctx.setOffline(true);
    let booted = false, why = '';
    try {
      await p.reload({ waitUntil: 'load', timeout: 25000 });
      booted = await p.waitForFunction(() => !!window.__GAME, null, { timeout: 20000 })
                      .then(() => true).catch(() => false);
    } catch (e) { why = String(e).split('\n')[0]; }
    chk(booted, 'offline.bootsWithNoNetwork',
        '네트워크를 끊고 새로고침 → 게임 부팅 = ' + booted + (why ? ' · ' + why : ''));

    // 뜨기만 하고 못 노는 것도 있다 — 실제로 한 판 돌려 본다
    let ran = false;
    if (booted) {
      ran = await p.evaluate(() => {
        const G = window.__GAME;
        const t0 = G.state().t;
        G.run(2);
        return G.state().t > t0 + 1;
      }).catch(() => false);
    }
    chk(ran, 'offline.simulationRuns', '오프라인 상태에서 2초 시뮬이 실제로 진행 = ' + ran);

    // ---- 2.5) 소개 페이지와 그 [지금 플레이] 도 오프라인이어야 한다 --------
    // 사람이 링크로 받는 것은 dist/... 가 아니라 뿌리 주소(소개 페이지)다.
    // 그 페이지와 그림이 캐시에 없으면, 게임은 캐시에 있는데도 링크를 열면 공룡이 뜬다.
    let rootOk = false, imgOk = false, playOk = false;
    try {
      await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load', timeout: 20000 });
      rootOk = await p.evaluate(() => !!document.querySelector('a.play'));
      imgOk = await p.evaluate(() =>
        Array.from(document.images).length > 0 &&
        Array.from(document.images).every(i => i.naturalWidth > 0));
      await p.click('a.play');
      playOk = await p.waitForFunction(() => !!window.__GAME, null, { timeout: 20000 })
                      .then(() => true).catch(() => false);
    } catch (e) { void e; }
    chk(rootOk && imgOk && playOk, 'offline.landingPageAlsoWorks',
        '오프라인에서 소개 페이지 = ' + rootOk + ' · 그림 전부 그려짐 = ' + imgOk +
        ' · [지금 플레이] 로 게임 부팅 = ' + playOk);

    // ---- 3) 음성 대조군 — 서비스워커 없는 새 프로필 ------------------------
    const ctx2 = await b.newContext({ viewport: { width: 412, height: 883 } });
    await ctx2.setOffline(true);
    const p2 = await ctx2.newPage();
    let booted2 = false;
    try {
      await p2.goto(URL_GAME, { waitUntil: 'load', timeout: 15000 });
      booted2 = await p2.waitForFunction(() => !!window.__GAME, null, { timeout: 8000 })
                        .then(() => true).catch(() => false);
    } catch (e) { void e; }
    chk(!booted2, 'offline.controlIsNotVacuous',
        '한 번도 연 적 없는 기기에서 오프라인으로 열기 → 부팅 = ' + booted2 +
        ' (여기서도 뜨면 위 결과는 서비스워커 덕이 아니다)');
  } finally {
    await b.close();
    done();
  }

  console.log('-'.repeat(92));
  if (fail === 0) console.log(' GREEN — 오프라인 검사 ' + pass + '건 전부 통과');
  else console.log(' RED — 오프라인 검사 ' + fail + '건 실패 / ' + (pass + fail) + '건');
  process.exit(fail === 0 ? 0 : 1);
})();
