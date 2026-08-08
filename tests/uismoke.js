// ===========================================================================
//  UI 클릭 경로 스모크 — 합성 마우스 이벤트로 진짜 DOM 핸들러를 두드린다.
//
//  모델 게이트(driver.js)는 __GAME API 를 직접 부르므로 "클릭이 실제로 먹히는가"는
//  전혀 보증하지 않는다. 이벤트 배선이 끊겨도 그쪽은 전부 GREEN 이다.
//  그래서 여기서는 팔레트 클릭 → 캔버스 드래그 → 우클릭 철거 → 제어기 열기 →
//  노드 추가까지 사람이 하는 순서를 그대로 흉내낸다.
//
//  판정 채널은 driver.js 와 동일 (#testout 의 JSON).
// ===========================================================================
(function () {
  var checks = [];
  function chk(name, ok, detail, expectFail) {
    checks.push({ name: name, ok: !!ok, detail: String(detail), expectFail: !!expectFail });
  }
  function emit(obj) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(obj) + '@@JSON_END@@';
  }

  var G, cvEl;
  function at(tx, ty) { return G.ui.screenOf(tx + 0.5, ty + 0.5); }
  function ev(type, sx, sy, btn) {
    return new MouseEvent(type, { clientX: sx, clientY: sy, button: btn || 0, bubbles: true, cancelable: true });
  }
  function move(tx, ty) { var p = at(tx, ty); cvEl.dispatchEvent(ev('mousemove', p.x, p.y)); }
  function down(tx, ty, btn) { var p = at(tx, ty); cvEl.dispatchEvent(ev('mousedown', p.x, p.y, btn)); }
  function up(btn) { window.dispatchEvent(ev('mouseup', 0, 0, btn)); }
  function click(tx, ty, btn) { move(tx, ty); down(tx, ty, btn); up(btn); }
  function key(k) { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }

  function run() {
    var out = { version: null, gfx: null, checks: checks, errors: [], fatal: null };
    try {
      if (!window.__READY || !window.__GAME) {
        out.fatal = 'boot 실패'; emit(out); return;
      }
      G = window.__GAME; cvEl = document.getElementById('view');
      out.version = G.version; out.gfx = G.gfx();

      G.reset(424242); G.clearEntities(); G.clearEnemies(); G.giveAll(500);
      G.powerCheat(true);
      G.ui.closeHelp();
      G.center(80, 80); G.setZoom(1);
      G.ui.refresh();

      chk('ui.helpClosed', document.getElementById('help').style.display === 'none',
        '도움말 창이 닫혔다 (열린 채면 캔버스 클릭이 가려진다)');

      // --- 1. 건설 팔레트 클릭 → 도구 선택 -------------------------------
      var beltRow = document.querySelector('#buildList .bitem[data-b="belt"]');
      chk('ui.paletteRendered', !!beltRow, '건설 목록에 벨트 항목 존재');
      beltRow.click();
      chk('ui.toolSelectedByClick', G.ui.curTool() === 'belt',
        '팔레트 클릭 후 선택된 도구 = ' + G.ui.curTool());

      // --- 2. 캔버스 좌클릭 드래그 → 벨트가 이어 깔린다 --------------------
      var y0 = 78;
      move(70, y0);
      down(70, y0, 0);
      for (var x = 71; x <= 78; x++) move(x, y0);
      up(0);
      var placed = 0, dirsOk = 0;
      for (var q = 70; q <= 78; q++) {
        var id = G.entAtTile(q, y0);
        if (id) {
          placed++;
          var e = G.ent(id);
          if (e.type === 'belt' && e.dir === 1) dirsOk++;
        }
      }
      chk('ui.dragPlacesBelts', placed >= 8 && dirsOk >= 8,
        '좌클릭 드래그로 벨트 ' + placed + '칸 배치 · 진행방향(동쪽)이 맞는 것 ' + dirsOk + '칸');

      // 좌표 사상이 맞는가 — 커서 아래 타일이 우리가 쏜 칸과 같아야 한다
      move(74, y0);
      var hv = G.ui.tileUnderCursor();
      chk('ui.cursorMapsToTile', hv[0] === 74 && hv[1] === y0,
        '화면 좌표 → 타일 역변환 = ' + JSON.stringify(hv) + ' (74,' + y0 + ' 이어야)');

      // --- 3. R 키 회전 ---------------------------------------------------
      var d0 = G.ui.curDir();
      key('r');
      chk('ui.rotateKey', G.ui.curDir() === ((d0 + 1) & 3),
        'R 키로 방향 ' + d0 + ' → ' + G.ui.curDir());

      // --- 4. 우클릭 철거 + 자원 환급 --------------------------------------
      key('Escape');                       // 도구 해제 (안 하면 우클릭이 도구 취소로 먹힌다)
      chk('ui.escapeClearsTool', G.ui.curTool() === null, 'ESC 후 도구 = ' + G.ui.curTool());
      var beltCountBefore = G.state().counts.belt || 0;
      var invBefore = G.state().inventory['belt-item'] || 0;
      click(74, y0, 2);
      var beltCountAfter = G.state().counts.belt || 0;
      var invAfter = G.state().inventory['belt-item'] || 0;
      chk('ui.rightClickRemoves', beltCountAfter === beltCountBefore - 1 && invAfter === invBefore + 1,
        '우클릭 → 벨트 ' + beltCountBefore + '→' + beltCountAfter + '칸, 창고 벨트 ' +
        invBefore + '→' + invAfter + '개 (철거는 전액 환급이어야)');

      // --- 5. 상자 배치 후 좌클릭 → 인스펙터 -------------------------------
      document.querySelector('#buildList .bitem[data-b="chest"]').click();
      click(70, 82, 0);
      var chestId = G.entAtTile(70, 82);
      chk('ui.chestPlacedByClick', !!chestId && G.ent(chestId).type === 'chest',
        '상자 배치 id=' + chestId);
      key('Escape');
      click(70, 82, 0);
      var inspVisible = document.getElementById('insp').style.display === 'block';
      chk('ui.inspectorOpens', inspVisible && G.ui.selectedId() === chestId,
        '상자 좌클릭 → 인스펙터 표시=' + inspVisible + ' 선택 id=' + G.ui.selectedId());

      // --- 5b. 인스펙터의 <select> 가 주기 갱신에서 살아남아야 한다 ----------
      // 0.2초마다 innerHTML 을 갈아엎으면 사용자가 열어 둔 드롭다운이 강제로 닫혀
      // 레시피를 아예 고를 수 없다. 요소의 동일성으로 검정한다.
      document.querySelector('#buildList .bitem[data-b="assembler"]').click();
      click(76, 82, 0);
      var asmId = G.entAtTile(76, 82);
      key('Escape');
      click(76, 82, 0);
      var sel1 = document.getElementById('recSel');
      G.run(2);                                   // 진행률·전력 같은 수치가 바뀐다
      G.ui.refresh(); G.ui.refresh(); G.ui.refresh();
      var sel2 = document.getElementById('recSel');
      chk('ui.inspectorSelectSurvivesRefresh', !!sel1 && sel1 === sel2,
        '조립기 인스펙터의 레시피 <select> 가 3회 갱신 뒤에도 같은 요소인가 = ' + (sel1 === sel2) +
        ' (매번 새로 만들면 열어 둔 드롭다운이 닫혀 레시피를 고를 수 없다)');

      // 값을 바꾸면(=지문이 바뀌면) 그때는 다시 그려져야 한다
      if (sel2) { sel2.value = 'gear'; sel2.onchange(); }
      G.ui.refresh();
      chk('ui.inspectorAppliesChange', G.ent(asmId).recipe === 'gear',
        '드롭다운으로 고른 레시피가 실제 기계에 적용됐는가 = ' + G.ent(asmId).recipe);

      // 입력 요소에서 발생한 키는 게임 단축키로 먹지 않아야 한다.
      // 헤드리스에서는 focus() 가 activeElement 를 바꾸지 못할 수 있으므로,
      // 실제 타이핑과 같게 **그 요소에서 이벤트를 올려보내** 검정한다.
      // T 는 토글이라 시작 상태가 모호하면 결과도 모호해진다. 매번 닫힌 상태에서 시작한다.
      // (닫지 않았더니 토글이 엇갈려 뒤쪽 검사가 통째로 무너졌다.)
      var sel3 = document.getElementById('recSel');
      G.ui.closeTech();
      if (sel3) sel3.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      var techOpenedWhileTyping = document.getElementById('tech').style.display === 'block';
      G.ui.closeTech();
      chk('ui.keysIgnoredWhileTyping', !!sel3 && techOpenedWhileTyping === false,
        '<select> 에서 올라온 T 키에 연구창 열림 = ' + techOpenedWhileTyping +
        ' (열리면 드롭다운을 키보드로 조작할 수 없다)');
      // 음성 대조군 — 캔버스에서 올라온 같은 키는 정상적으로 먹어야 한다
      key('t');
      var techOpensFromCanvas = document.getElementById('tech').style.display === 'block';
      G.ui.closeTech();
      chk('ui.keysStillWorkOutsideInputs', techOpensFromCanvas === true,
        '입력 요소 밖에서 누른 T 는 연구창을 연다 = ' + techOpensFromCanvas +
        ' (안 열리면 위 검사가 "단축키가 아예 죽었다"를 통과시킨 것)');

      // --- 6. 제어기 클릭 → 노드 편집기 -----------------------------------
      var ctlRow = document.querySelector('#buildList .bitem[data-b="controller"]');
      chk('ui.controllerRowPresent', !!ctlRow,
        '건설 목록의 제어기 항목 존재 = ' + !!ctlRow + ' · 목록 항목 수 ' +
        document.querySelectorAll('#buildList .bitem').length);
      if (ctlRow) ctlRow.click();
      click(74, 82, 0);
      var ctrlId = G.entAtTile(74, 82);
      chk('ui.controllerPlaced', !!ctrlId, '제어기 배치 id=' + ctrlId);
      key('Escape');
      click(74, 82, 0);
      var lopen = document.getElementById('logic').style.display === 'block';
      chk('ui.logicEditorOpens', lopen && G.ui.logicOpen(),
        '제어기 좌클릭 → 편집기 표시=' + lopen);

      // --- 7. 편집기 팔레트 클릭 → 노드가 DOM 에 실제로 생긴다 --------------
      var n0 = G.ui.nodeCount();
      document.querySelector('#pal .pitem[data-k="chest"]').click();
      document.querySelector('#pal .pitem[data-k="cmp"]').click();
      var n1 = G.ui.nodeCount();
      chk('ui.nodeAddedByClick', n1 === n0 + 2,
        '팔레트 클릭 2회 → 화면의 노드 ' + n0 + ' → ' + n1 + '개');

      // 잠긴 노드는 눌러도 안 생겨야 한다 (음성 대조군 — 잠금이 실제로 걸려 있음도 단언)
      var lockedEl = document.querySelector('#pal .pitem[data-k="latch"]');
      var wasLocked = lockedEl && lockedEl.className.indexOf('locked') >= 0;
      var n2before = G.ui.nodeCount();
      if (lockedEl) lockedEl.click();
      chk('ui.lockedNodeRefused', wasLocked && G.ui.nodeCount() === n2before,
        'SR 래치가 잠김 표시=' + wasLocked + ' (조건 발생 확인) · 눌러도 노드 ' +
        n2before + '개 그대로');

      // --- 8. 예제 회로 → 배선이 SVG 에 실제로 그려진다 ---------------------
      G.research('logic-mem');
      G.ui.closeLogic();
      G.ui.openLogic(ctrlId);
      var before = G.ui.linkCount();
      G.ui.loadExample();
      var after = G.ui.linkCount();
      chk('ui.exampleDrawsWires', after > before && after >= 6,
        '예제 불러오기 → SVG 배선 ' + before + ' → ' + after + '개');

      G.ui.closeLogic();
      chk('ui.logicCloses', document.getElementById('logic').style.display === 'none' && !G.ui.logicOpen(),
        '편집기 닫힘');

      // --- 9. 휠 확대 ------------------------------------------------------
      var z0 = G.gfx().zoom;
      cvEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
      var z1 = G.gfx().zoom;
      chk('ui.wheelZooms', z1 > z0, '휠 위로 → 배율 ' + Math.round(z0 * 100) / 100 + ' → ' + Math.round(z1 * 100) / 100);

      // --- 10. 연구 패널 --------------------------------------------------
      key('t');
      var techOpen = document.getElementById('tech').style.display === 'block';
      var startBtn = document.querySelector('#techBody button[data-t]');
      if (startBtn) startBtn.click();
      chk('ui.techPanelStarts', techOpen && !!G.state().research.current,
        'T 키로 연구창 표시=' + techOpen + ' · 버튼 클릭 후 진행 중인 연구=' + G.state().research.current);

      // --- 11. 저장/불러오기 진입점 ---------------------------------------
      // 리뷰 지적: 저장 기능은 있었는데 플레이어가 부를 방법이 없었다(버튼도 키도 없음).
      // 진입점이 없는 기능은 없는 기능이다 — 버튼과 키를 모두 실제로 눌러 확인한다.
      G.ui.closeTech();
      var beforeSaveCount = G.state().entityCount;
      var sBtn = document.getElementById('saveBtn');
      var lBtn = document.getElementById('loadBtn');
      chk('ui.saveButtonsExist', !!sBtn && !!lBtn,
        '창고 패널에 저장 버튼=' + !!sBtn + ' 불러오기 버튼=' + !!lBtn);
      if (sBtn) sBtn.click();
      // 저장한 뒤 판을 바꿔치고, 불러오기 버튼으로 되돌아오는지 본다
      G.reset(31337);
      var afterResetCount = G.state().entityCount;
      if (lBtn) lBtn.click();
      var afterLoadCount = G.state().entityCount;
      chk('ui.saveLoadButtonsWork',
        beforeSaveCount > 0 && afterResetCount !== beforeSaveCount && afterLoadCount === beforeSaveCount,
        '저장 버튼 → 엔티티 ' + beforeSaveCount + '개 · 다른 판으로 리셋 ' + afterResetCount +
        '개 · 불러오기 버튼 → ' + afterLoadCount + '개');

      // F2/F3 키도 같은 일을 해야 한다
      G.place('chest', 60, 60, 0);
      var beforeKey = G.state().entityCount;
      key('F2');
      G.reset(31337);
      key('F3');
      var afterKey = G.state().entityCount;
      chk('ui.saveLoadHotkeys', afterKey === beforeKey && beforeKey > 0,
        'F2 저장 → 엔티티 ' + beforeKey + '개 · 리셋 후 F3 → ' + afterKey + '개');

      // --- 12. 튜토리얼 패널 -----------------------------------------------
      G.tutorialReset(true);
      G.ui.refresh();
      var tp = document.getElementById('tutor');
      var tHead = G.ui.panelText('#tutorHead');
      var tNow = G.ui.panelText('.tnow');
      chk('ui.tutorialPanelShows',
        !!tp && tp.style.display === 'block' && /1\s*\/\s*\d+/.test(tHead || '') && !!tNow,
        '튜토리얼 패널 표시 · 머리글 "' + tHead + '" · 현재 목표 "' + (tNow || '').slice(0, 24) + '…"');

      // 건너뛰기 버튼이 실제로 한 단계만 넘긴다
      var stepBefore = G.tutorial().step;
      document.getElementById('tutorSkip').click();
      var stepAfter = G.tutorial().step;
      chk('ui.tutorialSkipButton', stepAfter === stepBefore + 1,
        '건너뛰기 버튼 클릭 → 단계 ' + stepBefore + ' → ' + stepAfter);

      // 닫기 버튼은 패널만 접는다 (진행은 유지)
      document.getElementById('tutorClose').click();
      var closedHidden = document.getElementById('tutor').style.display === 'none';
      var keptStep = G.tutorial().step;
      chk('ui.tutorialCloseKeepsProgress', closedHidden && keptStep === stepAfter,
        '닫기 → 숨김=' + closedHidden + ' · 진행 유지 ' + keptStep);

      // 건설 패널의 [튜토리얼] 버튼으로 다시 열린다
      document.getElementById('tutorBtn').click();
      chk('ui.tutorialReopens', document.getElementById('tutor').style.display === 'block',
        '[튜토리얼] 버튼 → 다시 표시=' + (document.getElementById('tutor').style.display === 'block'));

      // --- 13. 단축키는 연구를 해도 절대 안 밀린다 --------------------------
      // 예전엔 "잠긴 것을 뺀 목록의 순서"로 번호를 매겨서, 물류학을 연구해 분배기가
      // 열리는 순간 3=채광기가 3=인서터로 바뀌었다. 손에 익은 번호가 바뀌면 안 된다.
      G.reset(424242); G.giveAll(9999); G.ui.closeHelp(); G.ui.refresh();
      function keyMap() {
        var m = {}, rows = document.querySelectorAll('#buildList .bitem');
        for (var i = 0; i < rows.length; i++) {
          var kEl = rows[i].querySelector('.bkey');
          var k = kEl ? kEl.textContent.trim() : '';
          if (k) m[k] = rows[i].getAttribute('data-b');
        }
        return m;
      }
      var mapBefore = keyMap();
      var lockedBefore = !!document.querySelector('#buildList .bitem[data-b="splitter"].locked');
      G.research('logistics'); G.research('military');   // 분배기·터렛·벽이 열린다
      G.ui.refresh();
      var mapAfter = keyMap();
      var same = JSON.stringify(mapBefore) === JSON.stringify(mapAfter);
      var lockedAfter = !!document.querySelector('#buildList .bitem[data-b="splitter"].locked');
      chk('ui.hotkeysStableAfterResearch',
        lockedBefore === true && lockedAfter === false && same && Object.keys(mapAfter).length === 10,
        '연구 전 분배기 잠김=' + lockedBefore + ' → 후 잠김=' + lockedAfter + ' (조건 발생 확인) · ' +
        '단축키 매핑 ' + Object.keys(mapAfter).length + '개가 동일=' + same +
        ' · 3번=' + mapAfter['3'] + ' 0번=' + mapAfter['0']);

      // 화면에 적힌 번호를 실제로 눌렀을 때 그 건물이 잡혀야 한다
      var mismatched = [];
      for (var kk in mapAfter) {
        key(kk);
        if (G.ui.curTool() !== mapAfter[kk]) mismatched.push(kk + '→' + G.ui.curTool() + '(표시:' + mapAfter[kk] + ')');
      }
      key('Escape');
      chk('ui.hotkeyMatchesLabel', mismatched.length === 0,
        '표시된 번호 10개를 모두 눌러 확인' + (mismatched.length ? ' · 어긋남: ' + mismatched.join(', ') : ' · 전부 일치'));

      // --- 14. 상자에서 보유 자재로 꺼내는 버튼 -----------------------------
      // 사용자가 "철판이 10개인데 STORES엔 1개만 뜬다"고 물어서 드러난 구멍이다.
      // 둘은 다른 저장소인데, 상자에서 꺼내는 길이 철거밖에 없었다.
      G.reset(424242); G.clearEntities(); G.ui.closeHelp();
      for (var zz = 0; zz < G.itemIds().length; zz++) G.setInv(G.itemIds()[zz], 0);
      document.querySelector('#buildList .bitem[data-b="chest"]').click();
      G.setInv('iron-plate', 8);          // 상자 값만 딱 맞게
      click(70, 70, 0);
      var uChest = G.entAtTile(70, 70);
      G.fillChest(uChest, 'iron-plate', 25);
      key('Escape');
      click(70, 70, 0);
      G.ui.refresh();
      var takeBtn = document.getElementById('takeBtn');
      var stockPre = G.state().inventory['iron-plate'] || 0;
      chk('ui.takeButtonExists', !!takeBtn && !takeBtn.disabled,
        '상자 인스펙터에 [보유 자재로 가져오기] 버튼 존재=' + !!takeBtn +
        ' · 활성=' + (takeBtn ? !takeBtn.disabled : '?') + ' · 상자 내용 25개');
      if (takeBtn) takeBtn.click();
      var stockPost = G.state().inventory['iron-plate'] || 0;
      chk('ui.takeButtonMovesToStock',
        stockPost === stockPre + 25 && G.takeableCount(uChest) === 0,
        '버튼 클릭 → 보유 철판 ' + stockPre + ' → ' + stockPost + ' · 상자 잔량 ' +
        G.takeableCount(uChest));

      // 비면 버튼이 비활성이어야 한다 (음성 대조군: 방금 비운 것이 조건)
      G.ui.refresh();
      var takeBtn2 = document.getElementById('takeBtn');
      chk('ui.takeButtonDisabledWhenEmpty', !!takeBtn2 && takeBtn2.disabled === true,
        '빈 상자에서 버튼 비활성=' + (takeBtn2 ? takeBtn2.disabled : '버튼 없음'));

      // --- 15. 보유 자재를 기계에 넣는 버튼 ---------------------------------
      // 사용자가 "적색연구팩 제작이 안되는데?"로 막힌 지점이다. 레시피는 걸려
      // 있었지만 조립기 입력 버퍼가 비어 있었고, 보유 구리판 126개를 넣을 방법이
      // 없었다 (그때 세계로 나가는 길은 건물 비용·손 조립·발전기 석탄뿐).
      G.reset(424242); G.clearEntities(); G.ui.closeHelp(); G.powerCheat(true);
      G.giveAll(999);
      var asmItem = document.querySelector('#buildList .bitem[data-b="assembler"]');
      if (asmItem) asmItem.click();
      click(76, 74, 0);
      key('Escape');
      var uAsm = G.entAtTile(76, 74);
      chk('ui.putRigBuilt', !!asmItem && !!uAsm,
        '조립기 버튼 존재=' + !!asmItem + ' · 배치된 조립기 id=' + uAsm);
      G.setRecipe(uAsm, 'sci-red');
      for (var zp = 0; zp < G.itemIds().length; zp++) G.setInv(G.itemIds()[zp], 0);
      G.setInv('copper-plate', 6); G.setInv('gear', 3); G.setInv('iron-plate', 12);
      click(76, 74, 0);
      G.ui.refresh();
      var putBtn = document.getElementById('putBtn');
      chk('ui.putButtonExists', !!putBtn && !putBtn.disabled,
        '조립기 인스펙터에 [보유 자재 넣기] 버튼 존재=' + !!putBtn +
        ' · 활성=' + (putBtn ? !putBtn.disabled : '?') + ' · 보유 구리판 6 톱니 3');
      if (putBtn) putBtn.click();
      var pEnt = uAsm ? G.ent(uAsm) : null, pSt = G.state();
      chk('ui.putButtonMovesToMachine',
        !!pEnt && pEnt.inv['copper-plate'] === 6 && pEnt.inv['gear'] === 3 &&
        (pSt.inventory['copper-plate'] || 0) === 0 && (pSt.inventory['gear'] || 0) === 0,
        '버튼 클릭 → 조립기 안 구리판 ' + (pEnt ? (pEnt.inv['copper-plate'] || 0) : '?') +
        ' 톱니 ' + (pEnt ? (pEnt.inv['gear'] || 0) : '?') + ' · 보유 잔량 구리판 ' +
        (pSt.inventory['copper-plate'] || 0) + ' 톱니 ' + (pSt.inventory['gear'] || 0));

      // 음성 대조군 — 남은 보유 자재가 철판 12개뿐이고 이 레시피는 철판을 안 쓴다.
      // 조건이 실제로 발생했다: 방금 구리판·톱니를 다 넣어서 철판만 남았다.
      G.ui.refresh();
      var putBtn2 = document.getElementById('putBtn');
      chk('ui.putButtonDisabledWhenNothingFits',
        !!putBtn2 && putBtn2.disabled === true &&
        (G.state().inventory['iron-plate'] || 0) === 12,
        '보유가 철판 12개뿐일 때 버튼 비활성=' + (putBtn2 ? putBtn2.disabled : '버튼 없음') +
        ' · 철판은 그대로 ' + (G.state().inventory['iron-plate'] || 0));

      // 인스펙터가 "왜 안 도는지"를 말해야 한다. 사용자가 막힌 자리에서 화면에는
      // 전력 100%·체력 만땅만 있었고, 입력이 비었다는 사실은 [내용물] 행이 **없는
      // 것**으로만 드러났다. 없는 것은 아무도 읽지 못한다.
      // G.ent() 는 사본을 돌려주므로 거기다 inv={} 를 써도 세계는 안 바뀐다
      // (처음에 그렇게 짰다가 게이트가 헛돌았다). 실제 회수 경로로 비운다.
      G.takeToStock(uAsm);
      for (var zq = 0; zq < G.itemIds().length; zq++) G.setInv(G.itemIds()[zq], 0);
      G.ui.refresh();
      var idleTxt = document.getElementById('inspStat').textContent;
      chk('ui.idleMachineSaysWhy',
        idleTxt.indexOf('정지 이유') >= 0 && idleTxt.indexOf('재료 부족') >= 0 &&
        idleTxt.indexOf('구리판 0/1') >= 0 && idleTxt.indexOf('톱니 0/1') >= 0,
        '재료 0인 조립기 인스펙터에 정지 이유 표시 · 발췌="' +
        idleTxt.replace(/\s+/g, ' ').slice(0, 120) + '"');

      // 음성 대조군 — 재료가 차 있으면 이 줄이 뜨면 안 된다. 항상 뜨는 경고는
      // 경고가 아니라 배경이라, 진짜로 멈춘 기계를 오히려 가린다.
      G.setInv('copper-plate', 5); G.setInv('gear', 5);
      G.putFromStock(uAsm);
      G.ui.refresh();
      var busyTxt = document.getElementById('inspStat').textContent;
      chk('ui.runningMachineSaysNothing',
        busyTxt.indexOf('정지 이유') < 0 && busyTxt.indexOf('구리판 5') >= 0,
        '재료를 채운 뒤 정지 이유 사라짐=' + (busyTxt.indexOf('정지 이유') < 0) +
        ' · 내용물 표시됨=' + (busyTxt.indexOf('구리판 5') >= 0));

      // 음성 대조군 — 상자 인스펙터에는 넣기 버튼이 아예 없어야 한다
      G.setInv('iron-plate', 99);
      document.querySelector('#buildList .bitem[data-b="chest"]').click();
      click(80, 80, 0);
      key('Escape');
      click(80, 80, 0);
      G.ui.refresh();
      chk('ui.putButtonAbsentOnChest',
        document.getElementById('putBtn') === null &&
        document.getElementById('takeBtn') !== null,
        '상자 인스펙터: 넣기 버튼 없음=' + (document.getElementById('putBtn') === null) +
        ' · 가져오기 버튼 있음=' + (document.getElementById('takeBtn') !== null));

      out.errors = G.errors();
      chk('runtime.noErrors', out.errors.length === 0, out.errors.join(' | ') || '없음');
      chk('selftest.mustFail', G.ui.nodeCount() < 0, '노드 수가 음수일 리 없다', true);
      out.finalState = G.state();
    } catch (e) {
      out.fatal = (e && e.stack) ? e.stack : String(e);
      try { out.errors = window.__GAME ? window.__GAME.errors() : []; } catch (e2) { void e2; }
    }
    emit(out);
  }

  function go() { setTimeout(run, 200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
