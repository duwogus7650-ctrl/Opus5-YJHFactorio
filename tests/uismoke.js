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
      // 분배기는 강철 연구가 연다(강철에 소비처를 주려고 옮겼다). 터렛·벽은 군수.
      G.research('logistics'); G.research('steel'); G.research('military');
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

      // --- 16. 심화 과정 진입 버튼 -----------------------------------------
      // 기초를 끝낸 사람에게 다음 목적지를 주는 유일한 통로다. 완료 화면에만 나오고,
      // 여기서만 심화로 들어갈 수 있으므로 버튼이 죽으면 심화 8단계가 통째로 사라진다.
      G.reset(424242); G.clearEntities(); G.ui.closeHelp();
      G.tutorialReset(true);
      G.ui.refresh();
      chk('ui.advButtonHiddenBeforeDone',
        document.getElementById('tutorAdv') === null &&
        document.getElementById('tutorFoot').style.display !== 'none',
        '기초 진행 중: 심화 버튼 없음=' + (document.getElementById('tutorAdv') === null) +
        ' · 건너뛰기 버튼 보임=' + (document.getElementById('tutorFoot').style.display !== 'none'));

      for (var tz = 0; tz < 12; tz++) G.tutorialSkip();
      var advBtn = document.getElementById('tutorAdv');
      chk('ui.advButtonAppearsWhenDone',
        !!advBtn && document.getElementById('tutorHead').textContent.indexOf('완료') >= 0 &&
        document.getElementById('tutorFoot').style.display === 'none',
        '기초 완료 화면: 심화 버튼 존재=' + !!advBtn + ' · 머리말="' +
        document.getElementById('tutorHead').textContent + '" · 건너뛰기 숨김=' +
        (document.getElementById('tutorFoot').style.display === 'none'));

      if (advBtn) advBtn.click();
      var advNow = G.tutorial();
      chk('ui.advButtonEntersChapter',
        advNow.track === 'adv' && advNow.step === 0 && advNow.done === false &&
        // 총 단계 수를 박지 말 것 — 단계를 하나 추가하면 게이트가 깨진다
        // (실제로 5단계를 둘로 나누자 여기서 걸렸다).
        document.getElementById('tutorHead').textContent.indexOf('심화 1/' + advNow.total) >= 0 &&
        document.getElementById('tutorBody').textContent.indexOf('녹색 연구팩') >= 0,
        '버튼 클릭 → 트랙 ' + advNow.track + ' ' + advNow.step + '/' + advNow.total +
        ' · 머리말="' + document.getElementById('tutorHead').textContent + '"');

      // 음성 대조군 — 심화 중에는 심화 버튼이 다시 나오면 안 된다 (눌러 봐야 되돌아감만 된다)
      chk('ui.advButtonGoneInsideChapter',
        document.getElementById('tutorAdv') === null &&
        document.getElementById('tutorFoot').style.display !== 'none',
        '심화 진행 중: 심화 버튼 없음=' + (document.getElementById('tutorAdv') === null) +
        ' · 건너뛰기 버튼 다시 보임=' + (document.getElementById('tutorFoot').style.display !== 'none'));

      // --- 17. 전력망 밖 제어기 경고 ----------------------------------------
      // 제어기는 전기를 안 쓴다. 그래서 전주 밖에 놓기 쉬운데, 밖이면 netSatOf 가
      // 0 을 돌려줘 [전력 만족도]가 **영원히 0** 이 되고 부하 차단 회로가 통째로
      // 죽는다. 화면에 단서가 없으면 아무도 못 찾는다 — 측정 하네스가 실제로
      // 이 함정에 걸려 "발진 0회"라는 거짓 결론을 냈다.
      G.reset(424242); G.clearEntities(); G.ui.closeHelp(); G.powerCheat(false);
      G.giveAll(9999);
      var offCtrl = G.place('controller', 20, 20, 0);      // 전주 하나 없는 허허벌판
      G.run(1);
      G.gAdd(offCtrl, 'power', 10, 10);
      G.ui.openLogic(offCtrl);
      G.ui.showGraph();          // 제어기는 이제 문장 화면이 먼저 열린다
      var offTxt = document.getElementById('cycleInfo').textContent;
      chk('ui.offGridControllerWarns',
        G.ent(offCtrl).net < 0 && offTxt.indexOf('전력망 밖') >= 0,
        '전주 없는 곳의 제어기 net=' + G.ent(offCtrl).net + ' · 머리말="' + offTxt + '"');

      // 음성 대조군 — 망에 붙은 제어기에는 이 경고가 뜨면 안 된다.
      // 항상 뜨는 경고는 경고가 아니라 배경이고, 진짜 문제를 가린다.
      // 망을 만드는 것은 발전기가 아니라 **전주**다 (rebuildPower 는 전주에서
      // 5x5 를 찍는다). 발전기만 놓고 대조군을 짰다가 net=-1 이 나와 헛돌았다.
      // 제어기는 2x2 다 — 전주와 한 칸이라도 겹치면 배치가 조용히 실패하고
      // G.ent() 가 null 을 돌려준다(그렇게 짰다가 드라이버가 죽었다).
      // 전주 공급구역은 전주 좌표 ±2 이므로 (33,33) 전주는 31~35 를 덮는다.
      G.place('generator', 30, 30, 0);
      G.place('pole', 33, 33, 0);
      var onCtrl = G.place('controller', 35, 35, 0);   // 35 칸이 공급구역 안이다
      G.run(1);
      G.gAdd(onCtrl, 'power', 10, 10);
      G.ui.openLogic(onCtrl);
      var onTxt = document.getElementById('cycleInfo').textContent;
      chk('ui.onGridControllerQuiet',
        G.ent(onCtrl).net >= 0 && onTxt.indexOf('전력망 밖') < 0,
        '발전기 옆 제어기 net=' + G.ent(onCtrl).net + ' · 머리말="' + onTxt +
        '" (경고 없음=' + (onTxt.indexOf('전력망 밖') < 0) + ')');
      G.ui.closeLogic();

      // --- 18. 출력 노드가 '지금 하는 일'을 말한다 --------------------------
      // 사용자가 "재고 과다면 정지" 로 짠 회로가 오히려 기계를 돌렸다. 원인은
      // [기계 가동/정지]의 입력 포트가 **가동**이라 참=돌려라 이기 때문이다.
      // 나도 심화 튜토리얼 4단계에서 같은 실수를 했다 — 두 사람이 같은 자리에서
      // 걸렸으므로 이름 탓이다. 노드가 스스로 뜻을 말하게 해서 그 자리에서 보이게 한다.
      G.reset(424242); G.clearEntities(); G.ui.closeHelp(); G.powerCheat(true);
      G.giveAll(9999);
      var mc = G.place('controller', 60, 60, 0);
      var mChest = G.place('chest', 64, 60, 0);
      var mAsm = G.place('assembler', 68, 60, 0);
      G.fillChest(mChest, 'iron-plate', 300);
      var qCh = G.gAdd(mc, 'chest', 20, 20);  G.gCfg(mc, qCh, 'ent', mChest);
      var qK = G.gAdd(mc, 'const', 20, 200);  G.gCfg(mc, qK, 'value', 200);
      var qC = G.gAdd(mc, 'cmp', 260, 20);    G.gCfg(mc, qC, 'op', '>');
      var qE = G.gAdd(mc, 'enable', 520, 20);
      G.gLink(mc, qCh, 0, qC, 0); G.gLink(mc, qK, 0, qC, 1); G.gLink(mc, qC, 0, qE, 0);
      G.run(1);
      G.ui.openLogic(mc);
      G.ui.renderGraph();

      // 대상이 비었을 때: '아무 일도 하지 않는다' 라고 말해야 한다
      var meanEl = document.querySelector('[data-mean="' + qE + '"]');
      G.ui.updateLive();
      var noTargetTxt = meanEl ? meanEl.textContent : '';
      chk('ui.outputNodeWarnsNoTarget',
        !!meanEl && noTargetTxt.indexOf('대상이 비어 있다') >= 0 && meanEl.classList.contains('bad'),
        '대상 미지정 [기계 가동/정지] → "' + noTargetTxt + '"');

      // 대상을 물리면: 참일 때 **돌린다** 고 말해야 한다 (사용자가 기대한 '멈춘다' 가 아니다)
      G.gCfg(mc, qE, 'ent', mAsm);
      G.run(1); G.ui.renderGraph(); G.ui.updateLive();
      var meanEl2 = document.querySelector('[data-mean="' + qE + '"]');
      var invTxt = meanEl2 ? meanEl2.textContent : '';
      chk('ui.outputNodeSaysItRuns',
        invTxt.indexOf('참') >= 0 && invTxt.indexOf('돌린다') >= 0 && invTxt.indexOf('#' + mAsm) >= 0,
        '재고 300 > 200 (참) 인 배선 → "' + invTxt + '" · 실제 기계 가동=' +
        G.ent(mAsm).enabled + ' (문장과 세계가 일치해야 한다)');

      // 음성 대조군 — 부등호를 뒤집으면 문장도 '멈춘다' 로 바뀌어야 한다.
      // 늘 같은 문장이면 아무것도 알려주지 않는 장식이다.
      G.gCfg(mc, qC, 'op', '<');
      G.run(1); G.ui.updateLive();
      var meanEl3 = document.querySelector('[data-mean="' + qE + '"]');
      var fixTxt = meanEl3 ? meanEl3.textContent : '';
      chk('ui.outputNodeFollowsTheValue',
        fixTxt.indexOf('거짓') >= 0 && fixTxt.indexOf('멈춘다') >= 0 &&
        G.ent(mAsm).enabled === false,
        '부등호를 < 로 뒤집자 → "' + fixTxt + '" · 실제 기계 가동=' + G.ent(mAsm).enabled);
      G.ui.closeLogic();

      // --- 19. 편집기 — 감사가 짚은 네 가지 ---------------------------------
      G.reset(424242); G.clearEntities(); G.ui.closeHelp(); G.powerCheat(true);
      G.giveAll(9999);
      var edC = G.place('controller', 60, 60, 0);
      var edC2 = G.place('controller', 66, 60, 0);
      G.ui.openLogic(edC);
      G.ui.showGraph();
      var e1 = G.gAdd(edC, 'const', 40, 40);
      var e2 = G.gAdd(edC, 'display', 40, 220);
      G.ui.renderGraph();

      // (a) **배선 표적이 포트 행 전체여야 한다.** 9px 도트뿐이면 이름표에 떨궜을 때
      //     조용히 실패한다 — 살아 있는 폭이 41% 였다.
      var outRow = document.querySelector('#graphInner .node .port.out[data-out]');
      var inRow = document.querySelector('#graphInner .node .port.in[data-in]');
      var rowW = outRow ? outRow.getBoundingClientRect().width : 0;
      var dotEl = outRow ? outRow.querySelector('.dot') : null;
      var dotW = dotEl ? dotEl.getBoundingClientRect().width : 0;
      chk('ui.portRowIsTheTarget',
        !!outRow && !!inRow && rowW > dotW * 2,
        '포트 행이 배선 표적인가 — 행 폭 ' + Math.round(rowW) + 'px vs 도트 ' +
        Math.round(dotW) + 'px (행에 data-out/in 이 붙어야 한다)');

      // 실제로 **이름표 위에서** 끌어 배선이 걸리는지
      var linksBefore = G.gInfo(edC).links;
      if (outRow && inRow) {
        var orr = outRow.getBoundingClientRect(), irr = inRow.getBoundingClientRect();
        // 도트가 아니라 행의 오른쪽 끝(이름표 쪽)에서 시작한다
        outRow.dispatchEvent(new MouseEvent('mousedown',
          { clientX: orr.right - 4, clientY: orr.top + orr.height / 2, bubbles: true, cancelable: true }));
        inRow.dispatchEvent(new MouseEvent('mouseup',
          { clientX: irr.right - 4, clientY: irr.top + irr.height / 2, bubbles: true, cancelable: true }));
      }
      chk('ui.wiringWorksOnLabel', G.gInfo(edC).links > linksBefore,
        '포트 이름표 위에서 끌어 배선 → 배선 ' + linksBefore + ' → ' + G.gInfo(edC).links);

      // (b) **되먹임 점선이 즉시 나와야 한다.** 예전에는 한 편집 뒤처졌다.
      var m1 = G.gAdd(edC, 'math', 300, 40);
      var m2 = G.gAdd(edC, 'math', 300, 220);
      G.gLink(edC, m1, 0, m2, 0);
      G.gLink(edC, m2, 0, m1, 1);          // 되먹임을 방금 만들었다
      G.ui.renderGraph();
      var dashed = document.querySelectorAll('#links [stroke-dasharray="6 4"]').length;
      chk('ui.feedbackShownImmediately',
        G.gInfo(edC).cycles >= 1 && dashed >= 1,
        '되먹임 배선을 만든 직후 → 컴파일러가 센 되먹임 ' + G.gInfo(edC).cycles +
        '개 · 화면의 점선 ' + dashed + '개 (0이면 한 편집 뒤처진 것)');

      // (b2) **노드를 끌면 평가 순서가 다시 계산돼야 한다.**
      // 좌표가 곧 평가 순서인데(graphCompile), 끌기 핸들러가 graph.dirty 를 안 세워서
      // 옮겨도 옛 순서 그대로 돌았다. 도움말이 "보이는 배치가 규칙"이라고 약속한
      // 바로 그것이 거짓이었다. 실제 마우스 경로로 끌어서 잰다.
      var dragC = G.place('controller', 62, 62, 0);
      G.ui.openLogic(dragC);
      var dA = G.gAdd(dragC, 'math', 40, 40);
      var dB = G.gAdd(dragC, 'math', 300, 40);
      var dC = G.gAdd(dragC, 'math', 560, 40);
      G.gLink(dragC, dA, 0, dB, 0); G.gLink(dragC, dB, 0, dC, 0); G.gLink(dragC, dC, 0, dA, 1);
      G.ui.renderGraph();
      G.run(0.05);
      var ordBefore = G.gInfo(dragC).order.join(',');
      // dC 의 머리를 잡아 좌상단으로 끈다 (실제 mousedown → mousemove → mouseup)
      var nodeEl = document.querySelector('#graphInner .node[data-nid="' + dC + '"]');
      var headEl = nodeEl ? nodeEl.querySelector('.nhead') || nodeEl.firstElementChild : null;
      var dragOk = false;
      if (headEl) {
        var hr = headEl.getBoundingClientRect();
        headEl.dispatchEvent(new MouseEvent('mousedown',
          { clientX: hr.left + 5, clientY: hr.top + 5, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mousemove',
          { clientX: hr.left - 600, clientY: hr.top - 20, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup',
          { clientX: hr.left - 600, clientY: hr.top - 20, bubbles: true, cancelable: true }));
        dragOk = true;
      }
      G.run(0.05);
      var ordAfter = G.gInfo(dragC).order.join(',');
      chk('ui.dragRecompilesOrder',
        dragOk && ordBefore !== ordAfter,
        '노드를 좌상단으로 끌기 → 평가순서 [' + ordBefore + '] → [' + ordAfter +
        '] (같으면 끌기가 재컴파일을 안 걸어 배치가 규칙이라는 말이 거짓이 된다)');

      // (b3) **문장 편집기 — 실제 클릭으로.** 모델 게이트는 클릭 경로를 하나도
      // 안 지난다(tasks/lessons/05). 카드를 눌러 규칙을 만들고, 드롭다운을 바꾸고,
      // 그 결과가 회로로 컴파일돼 세계가 움직이는지까지 DOM 경로로 확인한다.
      G.reset(9300); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true); G.research('logic-mem');
      var uBox = G.place('chest', 60, 60, 0);
      var uAsm = G.place('assembler', 64, 60, 0); G.setRecipe(uAsm, 'gear');
      var uCtl = G.place('controller', 68, 60, 0);
      G.ui.openLogic(uCtl);
      var pane = document.getElementById('rulePane');
      chk('ui.rulesShowFirst',
        !!pane && pane.classList.contains('on') &&
        document.getElementById('logic').classList.contains('rules'),
        '제어기를 열면 문장 화면이 먼저 — rulePane.on=' +
        (pane ? pane.classList.contains('on') : 'none') +
        ' (회로가 먼저 나오면 비코더는 여기서 멈춘다)');

      var cardEls = pane.querySelectorAll('.c[data-card]');
      chk('ui.ruleCardsListed', cardEls.length >= 5,
        '하고싶은일 카드 ' + cardEls.length + '장 (5장 이상이어야)');

      // 첫 카드('재고가 넘치면 기계 쉬게 하기')를 클릭
      var before = G.ruleList(uCtl).length;
      cardEls[0].click();
      var afterN = G.ruleList(uCtl).length;
      chk('ui.cardClickMakesRule', before === 0 && afterN === 1,
        '카드 클릭 → 규칙 ' + before + ' → ' + afterN + '개');

      // 대상이 비어 있으니 문장에 '(대상 고르기)' 가 보여야 한다 — null 이 보이면 안 된다
      var sentence = pane.querySelector('[data-now]');
      var sTxt = sentence ? sentence.textContent : '';
      chk('ui.noNullInSentence', sTxt.indexOf('null') < 0 && sTxt.indexOf('대상 고르기') >= 0,
        '대상 미지정 문장: "' + sTxt.slice(0, 60) + '" (null 이 보이면 문장이 아니다)');

      // 대상을 붙이고 값을 바꿔 실제로 세계가 움직이는지
      var rid0 = G.ruleList(uCtl)[0].id;
      G.ruleSet(uCtl, rid0, { when: { ent: uBox, item: 'iron-plate', value: 100 },
                              then: { ent: uAsm } });
      G.ui.openLogic(uCtl);                       // 다시 그린다
      var selEls = document.querySelectorAll('#rulePane .rline select');
      chk('ui.ruleControlsRendered', selEls.length >= 3,
        '드롭다운 ' + selEls.length + '개 (읽을 것·행동·기억 최소 3개)');

      // 드롭다운을 **실제로 바꿔** 컴파일이 다시 도는지 — change 이벤트 경로
      var kindSel = null;
      for (var q = 0; q < selEls.length; q++) {
        if (selEls[q].getAttribute('data-k') === 'when.cmp') kindSel = selEls[q];
      }
      var nodesBefore = G.gInfo(uCtl).nodes;
      if (kindSel) {
        kindSel.value = '<';
        kindSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      G.fillChest(uBox, 'iron-plate', 10);
      G.run(0.3);
      chk('ui.dropdownRecompiles',
        !!kindSel && G.gInfo(uCtl).nodes >= nodesBefore && G.ent(uAsm).enabled === false,
        '비교를 "보다 작으면"으로 바꾸고 철판 10개 → 조립기 ' +
        (G.ent(uAsm).enabled ? '켜짐' : '꺼짐') + ' (카드가 "넘치면 끈다"이므로 꺼져야)');

      // **계산 한 단에 진입점이 있는가.** 컴파일러와 되읽기는 진작부터 when.math 를
      // 지원했는데 화면에 고를 자리가 없어서, 카드로 만든 규칙 말고는 아무도 쓸 수
      // 없었다. 저장/불러오기에서 같은 실패를 한 번 했다 — 진입점이 없는 기능은
      // 없는 기능이다. 드롭다운을 실제로 바꿔 회로가 따라 바뀌는지로 잰다.
      G.research('logic-ctrl');
      G.ui.openLogic(uCtl);                       // 연구 반영해 다시 그린다
      var mathSel = null, sels2 = document.querySelectorAll('#rulePane .rline select');
      for (var ms = 0; ms < sels2.length; ms++) {
        if (sels2[ms].getAttribute('data-k') === 'when.math.op') mathSel = sels2[ms];
      }
      var hadSmoothBefore = (G.gKinds(uCtl) || []).indexOf('smooth') >= 0;
      if (mathSel) {
        mathSel.value = 'smooth';
        mathSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var hasSmoothAfter = (G.gKinds(uCtl) || []).indexOf('smooth') >= 0;
      // 시상수 칸도 같이 나와야 한다 — 값을 못 고치면 반쪽이다
      var tauInput = document.querySelector('#rulePane input[data-k="when.math.b"]');
      chk('ui.mathDropdownExistsAndCompiles',
        !!mathSel && hadSmoothBefore === false && hasSmoothAfter === true && !!tauInput,
        '계산 드롭다운 ' + (mathSel ? '있음' : '없음') + ' · 고르기 전 평활 노드=' +
        hadSmoothBefore + ' → 고른 뒤=' + hasSmoothAfter + ' (조건 발생 확인) · 시상수 칸 ' +
        (tauInput ? '있음(' + tauInput.value + ')' : '없음'));
      // 되돌리기도 되어야 한다 — '(그대로)' 를 고르면 노드가 빠져야 한다.
      // 빈 op 를 남기면 문장엔 안 보이는데 회로엔 남는다.
      if (mathSel) {
        mathSel.value = '';
        mathSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      chk('ui.mathDropdownCanBeCleared',
        (G.gKinds(uCtl) || []).indexOf('smooth') < 0,
        "'(그대로)' 로 되돌림 → 평활 노드 " +
        ((G.gKinds(uCtl) || []).indexOf('smooth') >= 0 ? '남음' : '빠짐') + ' (빠져야)');

      // **한 방향이다** — 회로로 펼친 뒤 노드를 손대면 문장으로 못 돌아온다
      document.getElementById('btnToGraph').click();
      var inGraph = !document.getElementById('rulePane').classList.contains('on');
      var canGoBack = document.getElementById('btnToRules').style.display !== 'none';
      // **플레이어가 하는 대로** 팔레트를 클릭해 노드를 하나 추가한다.
      // 그 경로가 markGraphHandEdited 를 부른다 — 함수를 직접 부르면 배선이
      // 끊겨도 통과하는 검사가 된다.
      var palItem = document.querySelector('#pal .pitem:not(.locked)');
      if (palItem) palItem.click();
      var lockedAfter = G.ruleHandEdited(uCtl);
      var backHidden = document.getElementById('btnToRules').style.display === 'none';
      chk('ui.graphEditLocksRules',
        inGraph && canGoBack && lockedAfter === true && backHidden,
        '회로로 펼침(문장화면=' + (inGraph ? '숨김' : '보임') + ') · 돌아가기 버튼 ' +
        (canGoBack ? '있음' : '없음') + ' → 노드를 손대면 잠김=' + lockedAfter +
        ' · 버튼 ' + (backHidden ? '사라짐' : '남음'));

      // (c) **다른 제어기를 열면 화면이 처음으로 돌아가야 한다.**
      //     예전에는 이전 위치가 남아 노드가 있는데도 빈 화면만 보였다.
      G.ui.panGraph(-4000, -3000);
      var panned = G.ui.graphPan();
      G.ui.openLogic(edC2);
      var reset = G.ui.graphPan();
      chk('ui.editorViewResetsOnSwitch',
        Math.abs(panned.x) > 1000 && Math.abs(reset.x) < 200 && Math.abs(reset.y) < 200,
        '멀리 끌어다 놓고(' + Math.round(panned.x) + ',' + Math.round(panned.y) +
        ') 다른 제어기를 열자 → (' + Math.round(reset.x) + ',' + Math.round(reset.y) + ')');

      // 음성 대조군 — **같은** 제어기를 다시 열 때는 보던 위치를 지켜야 한다.
      // 매번 초기화하면 노드를 옮겨 가며 작업할 수가 없다.
      G.ui.panGraph(-1500, -900);
      var kept0 = G.ui.graphPan();
      G.ui.openLogic(edC2);
      var kept1 = G.ui.graphPan();
      chk('ui.editorViewKeptOnSameCtrl',
        Math.abs(kept1.x - kept0.x) < 1 && Math.abs(kept1.y - kept0.y) < 1,
        '같은 제어기를 다시 열자 → (' + Math.round(kept0.x) + ',' + Math.round(kept0.y) +
        ') → (' + Math.round(kept1.x) + ',' + Math.round(kept1.y) + ') 유지');

      // (d) 편집기 안내줄이 참/거짓 문턱과 펄스 표기를 말해야 한다.
      G.ui.showGraph();     // 안내줄은 화면마다 다르다 — 회로 화면의 것을 본다
      var hintTxt = document.querySelector('#logicBar .hint');
      chk('ui.editorHintExplainsThreshold',
        !!hintTxt && hintTxt.textContent.indexOf('0.5') >= 0 &&
        hintTxt.textContent.indexOf('↑') >= 0,
        '편집기 안내줄 = "' + (hintTxt ? hintTxt.textContent.slice(0, 90) : '없음') + '"');
      G.ui.closeLogic();

      // (e) **새 노드 4종의 클릭 경로.** 이 검사는 자기 판을 새로 깔기 때문에
      //     파일 맨 끝에 둔다 — 중간에 두었더니 뒤따르는 되먹임 점선 검사가
      //     지워진 제어기를 보고 RED 가 됐다. 뒤의 장면을 바꾸는 검사는 뒤의
      //     검사가 무엇을 재는지까지 바꾼다 (같은 실패를 문장 편집기에서 한 번 했다).
      G.ui.closeLogic();
      G.reset(424244); G.clearEntities(); G.powerCheat(true); G.giveAll(9999);
      var nvC = G.place('controller', 60, 60, 0);
      G.ui.openLogic(nvC); G.ui.showGraph();
      var newKinds = ['smooth', 'fsm', 'busrecv', 'bussend'];
      var palMissing = [], notLocked = [];
      for (var nk = 0; nk < newKinds.length; nk++) {
        var pit = document.querySelector('#pal .pitem[data-k="' + newKinds[nk] + '"]');
        if (!pit) { palMissing.push(newKinds[nk]); continue; }
        if (pit.className.indexOf('locked') < 0) notLocked.push(newKinds[nk]);
      }
      chk('ui.newNodesInPalette', palMissing.length === 0,
        '팔레트에 없는 새 노드: ' + (palMissing.length ? palMissing.join(',') : '없음') +
        ' (' + newKinds.length + '종 전부 나와야 한다)');
      var nvBefore = G.ui.nodeCount();
      for (var nk2 = 0; nk2 < newKinds.length; nk2++) {
        var pit2 = document.querySelector('#pal .pitem[data-k="' + newKinds[nk2] + '"]');
        if (pit2) pit2.click();
      }
      chk('ui.newNodesLockedBeforeTech',
        notLocked.length === 0 && G.ui.nodeCount() === nvBefore,
        '연구 전 잠김 표시가 없는 것: ' + (notLocked.length ? notLocked.join(',') : '없음') +
        ' (조건 발생 확인) · 4종을 다 눌러도 노드 ' + nvBefore + '개 그대로');

      // 연구하면 같은 클릭이 먹혀야 한다
      G.research('logistics'); G.research('logic-mem'); G.research('logic-ctrl');
      G.ui.closeLogic(); G.ui.openLogic(nvC); G.ui.showGraph();
      var nvAfterBase = G.ui.nodeCount(), nvFailed = [];
      for (var nk3 = 0; nk3 < newKinds.length; nk3++) {
        var pit3 = document.querySelector('#pal .pitem[data-k="' + newKinds[nk3] + '"]');
        var cnt0 = G.ui.nodeCount();
        if (pit3) pit3.click();
        if (G.ui.nodeCount() !== cnt0 + 1) nvFailed.push(newKinds[nk3]);
      }
      chk('ui.newNodesAddedAfterTech',
        nvFailed.length === 0 && G.ui.nodeCount() === nvAfterBase + newKinds.length,
        '연구 후 클릭 4회 → 노드 ' + nvAfterBase + ' → ' + G.ui.nodeCount() +
        '개 · 안 생긴 것: ' + (nvFailed.length ? nvFailed.join(',') : '없음'));

      // (a3) **입력 포트 5개짜리 노드가 실제로 배선되는가.** 지금까지 최대 3개였다.
      //      포트를 정의표에 적는 것과 편집기가 그것을 그리고 맞히는 것은 별개다.
      //      배선할 때마다 그래프가 다시 그려지므로 매번 다시 찾아야 한다.
      var wC = G.place('controller', 64, 60, 0);
      G.ui.openLogic(wC); G.ui.showGraph();
      var wK = G.gAdd(wC, 'const', 40, 40);
      var wF = G.gAdd(wC, 'fsm', 420, 40);
      G.ui.renderGraph();
      var fsmEl0 = document.querySelector('#graphInner .node[data-nid="' + wF + '"]');
      var fsmPorts = fsmEl0 ? fsmEl0.querySelectorAll('.port.in[data-in]').length : 0;
      for (var wi = 0; wi < 5; wi++) {
        var srcRow = document.querySelector('#graphInner .node[data-nid="' + wK + '"] .port.out[data-out="0"]');
        var fsmEl = document.querySelector('#graphInner .node[data-nid="' + wF + '"]');
        var dstRow = fsmEl ? fsmEl.querySelector('.port.in[data-in="' + wi + '"]') : null;
        if (!srcRow || !dstRow) continue;
        var sr = srcRow.getBoundingClientRect(), dr = dstRow.getBoundingClientRect();
        srcRow.dispatchEvent(new MouseEvent('mousedown',
          { clientX: sr.right - 4, clientY: sr.top + sr.height / 2, bubbles: true, cancelable: true }));
        dstRow.dispatchEvent(new MouseEvent('mouseup',
          { clientX: dr.right - 4, clientY: dr.top + dr.height / 2, bubbles: true, cancelable: true }));
      }
      chk('ui.fiveInputPortsAreWirable',
        fsmPorts === 5 && G.gInfo(wC).links === 5,
        '상태기계의 입력 포트 ' + fsmPorts + '개(5여야) · 다섯 개를 전부 마우스로 끌어 물린 결과 배선 ' +
        G.gInfo(wC).links + '개 (5여야 · 하나라도 못 맞히면 여기서 갈린다)');

      // (a4) 신호 송신 노드는 대상 엔티티를 안 고른다 — '대상이 비어 있다' 경고가
      //      뜨면 안 된다. 출력 노드 경고문은 종류를 손으로 나열하는 자리라 새 노드가
      //      추가되면 조용히 오탐이 된다.
      var bsC = G.place('controller', 68, 60, 0);
      G.ui.openLogic(bsC); G.ui.showGraph();
      var bsK = G.gAdd(bsC, 'const', 40, 40); G.gCfg(bsC, bsK, 'value', 5);
      var bsS = G.gAdd(bsC, 'bussend', 400, 40);
      G.gLink(bsC, bsK, 0, bsS, 0);
      G.ui.renderGraph(); G.run(0.05); G.ui.updateLive();
      // **해석 줄 그 자체를 읽는다.** 처음에는 노드 전체의 textContent 에서 '채널'을
      // 찾았는데, 그 글자는 설정 라벨에도 있어서 해석 줄이 비어 있어도 통과했다 —
      // 통과하면서 틀릴 수 있는 성질은 주 검사가 아니다 (교훈 13).
      var bsMean = document.querySelector('[data-mean="' + bsS + '"]');
      var bsTxt = bsMean ? bsMean.textContent : '';
      chk('ui.busSendExplainsItself',
        !!bsMean && bsTxt.indexOf('대상이 비어 있다') < 0 &&
        bsTxt.indexOf('채널 A') >= 0 && bsTxt.indexOf('5') >= 0,
        '신호 보내기 노드의 해석 줄 = "' + bsTxt + '" (대상 없다는 경고가 뜨면 안 되고, 채널과 값을 말해야 한다)');

      // (f) **청사진의 진입점.** 모델 게이트는 G.bpCapture/bpPaste 를 직접 부르므로
      //     "B 키가 먹히는가 · 드래그로 담기는가 · 클릭으로 붙는가"를 하나도
      //     보증하지 않는다(교훈 05). 여기서는 사람이 하는 순서 그대로 두드린다.
      G.reset(424250); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true); G.ui.closeHelp(); G.ui.clearTool();
      // **편집기를 닫고 시작한다.** 노드 편집기가 열려 있으면 게임 단축키가
      // 통째로 막힌다(의도된 규칙이다) — 앞 절이 열어 둔 채 끝나서 B 키가
      // 삼켜졌고, 그걸 '청사진이 안 된다'로 오독했다.
      G.ui.closeLogic();
      G.center(80, 80); G.setZoom(1); G.ui.refresh();
      var bpChest = G.place('chest', 78, 78, 0);
      var bpPole = G.place('pole', 80, 78, 0);
      key('b');                                    // 담기 모드
      // 영역을 끌어서 선택 — 누르고, 지나가고, 뗀다
      move(77, 77); down(77, 77, 0);
      move(79, 79); move(81, 79);
      up(0);
      var bpAfterDrag = G.bpInfo();
      chk('ui.blueprintKeyAndDragCapture',
        !!bpChest && !!bpPole && !!bpAfterDrag && bpAfterDrag.count === 2,
        'B 키 → 영역 드래그 → 청사진 ' + (bpAfterDrag ? bpAfterDrag.count + '개 · ' +
        bpAfterDrag.w + 'x' + bpAfterDrag.h : '없음') + ' (상자·전주 2개여야)');

      // **R 키가 붙여넣기 중에는 청사진을 돌려야 한다.** 모델 게이트는 G.bpRotate 를
      // 직접 부르므로 "손에 청사진을 든 상태에서 R 을 누르면 무엇이 돌아가는가"를
      // 전혀 보증하지 않는다. 원래 R 은 도구 방향을 돌리는 키라, 갈림길을 안 만들면
      // 청사진은 그대로 두고 도구만 돌아간다 — 화면에서는 아무 일도 안 일어난다.
      var bpBeforeRot = G.bpInfo();
      key('r');
      var bpAfterRot = G.bpInfo();
      chk('ui.blueprintRKeyRotates',
        !!bpBeforeRot && !!bpAfterRot &&
        bpAfterRot.w === bpBeforeRot.h && bpAfterRot.h === bpBeforeRot.w &&
        bpBeforeRot.w !== bpBeforeRot.h,
        'R 키 → 청사진 ' + (bpBeforeRot ? bpBeforeRot.w + 'x' + bpBeforeRot.h : '?') + ' → ' +
        (bpAfterRot ? bpAfterRot.w + 'x' + bpAfterRot.h : '?') +
        ' (가로세로가 바뀌어야 · 정사각형이면 이 검사는 아무것도 안 본다)');
      key('r'); key('r'); key('r');                // 네 번째 — 원래대로 되돌려 놓고 이어 간다

      // 담고 나면 곧바로 붙여넣기 모드다 — 좌클릭 한 번으로 지어져야 한다
      var entsBefore = G.state().entityCount;
      click(90, 90, 0);
      var entsAfter = G.state().entityCount;
      chk('ui.blueprintClickPastes',
        entsAfter === entsBefore + 2 && !!G.entAtTile(91, 91),
        '좌클릭 한 번 → 엔티티 ' + entsBefore + ' → ' + entsAfter +
        '개 (2개 늘어야) · 원점+1 자리에 상자 ' + (G.entAtTile(91, 91) ? '있음' : '없음'));

      // 음성 대조군 — 모드를 끄면 같은 클릭이 아무것도 안 지어야 한다.
      // 이게 없으면 위 검사는 "언제나 붙여넣는다"는 구현도 통과시킨다.
      key('b');                                    // 해제
      var entsBefore2 = G.state().entityCount;
      click(100, 100, 0);
      chk('ui.blueprintModeOffPastesNothing',
        G.state().entityCount === entsBefore2,
        'B 로 모드 해제 후 같은 클릭 → 엔티티 ' + entsBefore2 + ' → ' +
        G.state().entityCount + ' (안 늘어야 · 조건 발생 확인)');

      // (g) **열차의 진입점.** 열차는 점유맵 밖에 있어서 보통 건물과 배치 경로가
      //     다르다(레일 위에만 선다) — 그 갈림길이 팔레트 클릭에서 실제로 먹히는지
      //     본다. 모델 게이트는 G.trainAdd 를 직접 부르므로 이 경로를 안 지난다.
      G.reset(424251); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
      G.powerCheat(true); G.ui.closeHelp(); G.ui.closeLogic(); G.ui.clearTool();
      G.research('logistics'); G.research('steel');
      G.center(80, 80); G.setZoom(1); G.ui.refresh();
      // 팔레트에서 레일을 골라 드래그로 깐다 — 벨트와 같은 손놀림이다
      var railRow = document.querySelector('#buildList .bitem[data-b="rail"]');
      if (railRow) railRow.click();
      move(76, 80); down(76, 80, 0);
      for (var rx = 77; rx <= 82; rx++) move(rx, 80);
      up(0);
      var railsLaid = 0;
      for (var rq = 76; rq <= 82; rq++) if (G.entAtTile(rq, 80)) railsLaid++;
      chk('ui.railDragLaysTrack',
        !!railRow && railsLaid >= 6,
        '팔레트에서 레일 선택 → 드래그 → 깔린 레일 ' + railsLaid + '칸 (6칸 이상이어야)');

      // 열차는 레일 위에만 놓인다 — 빈 땅에 놓으면 거절돼야 한다(음성 대조군)
      key('Escape');
      var trainRow = document.querySelector('#buildList .bitem[data-b="train"]');
      if (trainRow) trainRow.click();
      click(76, 84, 0);                            // 레일이 아닌 빈 땅
      var afterBad = G.trainList().length;
      click(78, 80, 0);                            // 레일 위
      var afterGood = G.trainList().length;
      chk('ui.trainOnlyOnRail',
        !!trainRow && afterBad === 0 && afterGood === 1,
        '빈 땅 클릭 → 열차 ' + afterBad + '대(0이어야 · 조건 발생 확인) · ' +
        '레일 위 클릭 → ' + afterGood + '대 (1이어야)');

      // --- 누가 이 기계를 잡고 있나 ----------------------------------------
      // '제어기 지배 중' 만으로는 지도 어딘가의 제어기를 찾아 헤매게 된다.
      // 축마다 누가 잡았는지 말하고, 눌러서 그 회로로 갈 수 있어야 한다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.research('logic-mem'); G.research('logic-ctrl');
      var domAsm = G.place('assembler', 70, 70, 0);
      var domCtrl = G.place('controller', 90, 88, 0);
      var domK = G.gAdd(domCtrl, 'const', 20, 20); G.gCfg(domCtrl, domK, 'value', 0);
      var domEn = G.gAdd(domCtrl, 'enable', 240, 20); G.gCfg(domCtrl, domEn, 'ent', domAsm);
      G.gLink(domCtrl, domK, 0, domEn, 0);
      G.run(0.3);
      G.ui.select(domAsm); G.ui.refresh();
      var inspTxt = document.getElementById('insp').textContent;
      var gotoBtn = document.getElementById('gotoCtrl');
      chk('ui.inspectorNamesTheController',
        inspTxt.indexOf('제어기 #' + domCtrl) >= 0 && inspTxt.indexOf('가동/정지') >= 0 && !!gotoBtn,
        '인스펙터가 지배 제어기를 이름으로 말하는가 — "제어기 #' + domCtrl + '" 포함=' +
        (inspTxt.indexOf('제어기 #' + domCtrl) >= 0) + ' · 축 이름 포함=' +
        (inspTxt.indexOf('가동/정지') >= 0) + ' · [보러 가기] 있음=' + !!gotoBtn);

      // 눌러서 실제로 그 제어기로 가는가 — 카메라와 편집기 둘 다
      var camBefore = G.camera();
      if (gotoBtn) gotoBtn.click();
      var camAfter = G.camera();
      var editorOpen = G.ui.logicOpen();
      var movedToCtrl = Math.abs(camAfter.x - 91) < 2 && Math.abs(camAfter.y - 89) < 2;
      chk('ui.gotoControllerTakesYouThere',
        movedToCtrl && editorOpen && G.ui.nodeCount() === 2,
        '누르기 전 카메라 (' + Math.round(camBefore.x) + ',' + Math.round(camBefore.y) +
        ') → 누른 뒤 (' + Math.round(camAfter.x) + ',' + Math.round(camAfter.y) +
        ') · 제어기 자리(91,89) 도착=' + movedToCtrl + ' · 편집기 열림=' + editorOpen +
        ' · 그 회로의 노드 ' + G.ui.nodeCount() + '개(2여야)');
      G.ui.closeLogic();

      // 음성 대조군 — 아무도 안 잡은 기계에는 그 줄이 없어야 한다
      var freeAsm = G.place('assembler', 74, 70, 0);
      G.run(0.2);
      G.ui.select(freeAsm); G.ui.refresh();
      var freeTxt = document.getElementById('insp').textContent;
      chk('ui.noControllerRowWhenFree',
        freeTxt.indexOf('제어기 지배 중') < 0 && !document.getElementById('gotoCtrl'),
        '지배당하지 않는 기계의 인스펙터에 지배 줄 없음=' +
        (freeTxt.indexOf('제어기 지배 중') < 0) + ' (있으면 위 검사는 아무 기계에서나 통과한다)');

      // --- 신호 버스 계기판 ------------------------------------------------
      // 값·이름·쓰는 곳/읽는 곳이 **화면에** 있어야 한다. 모델이 답을 갖고 있어도
      // 볼 창이 없으면 제어기가 둘만 넘어가도 회로를 읽을 수 없다.
      G.reset(4242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999); G.powerCheat(true);
      G.research('logic-mem'); G.research('logic-ctrl');
      var bsC = G.place('controller', 60, 60, 0);
      var bsSend = G.gAdd(bsC, 'bussend', 20, 20); G.gCfg(bsC, bsSend, 'ch', 'D');
      var bsK = G.gAdd(bsC, 'const', 20, 200); G.gCfg(bsC, bsK, 'value', 42);
      G.gLink(bsC, bsK, 0, bsSend, 0);
      G.run(0.3);
      G.ui.refresh();
      var busRows = document.querySelectorAll('#busList .brow');
      var rowD = document.querySelector('#busList .brow[data-ch="D"]');
      var valD = rowD ? rowD.querySelector('.bval').textContent.trim() : '';
      var useD = rowD ? rowD.querySelector('.buse').textContent.trim() : '';
      chk('ui.busPanelShowsChannels',
        busRows.length === 8 && /42/.test(valD) && useD === '1→0',
        '버스 줄 ' + busRows.length + '개(8이어야) · D 값 "' + valD + '"(42여야) · 쓰기→읽기 "' +
        useD + '"(1→0이어야)');

      // 이름은 **고칠 수 있어야** 한다 — 못 고치면 채널은 여전히 익명이다
      var nameIn = rowD ? rowD.querySelector('.bname') : null;
      if (nameIn) { nameIn.value = '증기%'; nameIn.onchange(); }
      G.ui.refresh();
      var afterName = G.busName('D');
      var shownName = (document.querySelector('#busList .brow[data-ch="D"] .bname') || {}).value;
      chk('ui.busNameIsEditable', afterName === '증기%' && shownName === '증기%',
        '입력칸에 치고 나면 모델 이름 "' + afterName + '" · 화면 값 "' + shownName + '"');

      // 이름을 치는 동안 게임 단축키가 먹으면 글자마다 건물이 바뀐다
      var toolBefore = G.ui.curTool();
      if (nameIn) {
        nameIn.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
      }
      chk('ui.busNameTypingIsNotAHotkey', G.ui.curTool() === toolBefore,
        '이름칸에서 "3" 을 쳤을 때 든 도구 ' + G.ui.curTool() + ' (그대로여야 · 바뀌면 타이핑이 건설이 된다)');

      // --- 빌드 도장 -----------------------------------------------------
      // 폰이 캐시된 예전 사본을 열고 있어도 화면만 봐서는 알 수 없다. 도움말에 찍힌
      // 도장이 그 자리를 가른다 — 실기기 보고("복제 버튼이 안 보인다")가 코드 문제인지
      // 사본 문제인지 확인하는 데 반나절을 쓴 뒤에 넣었다.
      G.ui.openHelp ? G.ui.openHelp() : (document.getElementById('help').style.display = 'block');
      var stampEl = document.getElementById('buildStamp');
      var stampTxt = stampEl ? stampEl.textContent.trim() : '';
      chk('ui.buildStampIsShown',
        !!stampEl && stampTxt === G.buildId() && /^[0-9a-f]{8}$/.test(stampTxt),
        '도움말의 빌드 도장 "' + stampTxt + '" · G.buildId() "' + G.buildId() +
        '" (dev 이거나 비어 있으면 빌드가 도장을 안 박은 것이다)');
      G.ui.closeHelp();

      // --- 석유 설비 인스펙터 ------------------------------------------
      // 유체 칸은 물·증기만 보여주고 있었다. 펌프잭을 눌러도 뽑은 원유가 안 보이면
      // 정제소가 노는 이유(공급이 없다 / 하류가 막혔다)를 구분할 길이 없다.
      var cam0 = G.camera();
      G.research('steel'); G.research('logistics'); G.research('oil');
      G.clearTrees();
      var oil = G.oilSpot();
      var pjId = oil ? G.build('pumpjack', oil.x, oil.y, 0) : null;
      if (pjId) {
        G.center(oil.x + 1, oil.y + 1);
        G.powerCheat(true);
        G.run(3);
        G.ui.select(pjId);
        G.ui.refresh();
        var panel = document.getElementById('insp').textContent;
        var oilShown = /원유/.test(panel) && /광맥/.test(panel);
        // 라벨만 있고 값이 안 움직이면 죽은 표시다 — 3초 더 돌려 문구가 변하는지 본다.
        G.run(3); G.ui.refresh();
        var panel2 = document.getElementById('insp').textContent;
        chk('ui.pumpjackInspectorShowsOil', oilShown && panel2 !== panel,
          '펌프잭 인스펙터에 원유·광맥 표시=' + oilShown + ' · 3초 뒤 내용이 변함=' +
          (panel2 !== panel) + ' (안 변하면 죽은 라벨이다)');
        // 재고 뒤 남겨 두면 이 판의 rAF 루프가 계속 무거워진다(실측: 이 줄이 없으면
        // uismoke 전체가 3초에서 10분으로 늘었다). 검사만 하고 치운다.
        G.remove(pjId);
      } else {
        chk('ui.pumpjackInspectorShowsOil', false, '펌프잭을 세우지 못했다 — 원유 광맥 ' +
          JSON.stringify(oil));
      }

      // **판을 비우고 멈춘다.** 드라이버가 끝나도 헤드리스 브라우저는 가상시간
      // 120초를 마저 돌린다 — 살아 있는 공장을 남겨 두면 그 시간을 전부 시뮬·렌더에
      // 쓰느라 실행이 3초에서 10분으로 늘었다(실측). 재는 일은 여기서 끝났다.
      G.clearEntities(); G.clearEnemies(); G.pause(true);
      G.setCamera(cam0.x, cam0.y, cam0.z);
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
