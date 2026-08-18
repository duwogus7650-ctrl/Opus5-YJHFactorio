# -*- coding: utf-8 -*-
"""
돌연변이 게이트 — 검증 하네스가 정말로 실패를 잡는지 확인한다.

통과 케이스만으로 GREEN 을 본 게이트는 "실패를 잡는지" 한 번도 확인하지 않은 것이다.
그래서 소스를 한 곳씩 고의로 깨뜨리고, 그때 지목한 게이트가 실제로 FAIL 로 뒤집히는지 본다.
뒤집히지 않으면(MISS) 그 게이트는 아무것도 보증하지 않는다.

원장에서 옮겨온 규율:
  · 바이트로 읽고 바이트로 쓰고 바이트로 대조한다. 텍스트 모드는 Windows 에서 개행을
    CRLF 로 바꿔 놓고, 되돌림 검사도 그 차이를 못 본다 ('revert OK' 를 찍으면서 파일이
    전부 다시 쓰이는 사고가 실제로 있었다).
  · 돌연변이가 문법 오류를 내면 모든 게이트가 무너져 "잡았다"로 오독된다 → INVALID 로 분리.
  · 혼자 돌린다. 도는 동안 소스가 제자리에서 바뀌므로 다른 빌드/테스트와 겹치면 안 된다.

종료 코드: 0 = 모든 돌연변이가 잡혔다, 1 = MISS 있음, 2 = 하네스 자체 결함
"""
import io
import os
import re
import subprocess
import sys

# harness.py 와 같은 이유 — cp949 콘솔에서 em-dash 하나 때문에 print 가 죽으면
# 소스를 되돌리기 전에 터져서 작업 트리가 돌연변이된 채로 남는다. 표시 경로다.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- 강제 종료 안전장치 ------------------------------------------------------
# finally 로 되돌리는 것은 **프로세스가 살아 있을 때만** 통한다. 타임아웃이나
# Ctrl-C 로 죽으면 되돌리기가 아예 실행되지 않아 소스가 돌연변이된 채 남는다.
# 실제로 그렇게 되어 52_tutorial.js 의 순환 방어가 지워진 채 작업 트리에 남았다.
# 그래서 시작할 때 전 소스를 통째로 떠 두고, 다음 실행이 그 흔적을 보면 먼저 되돌린다.
def _bak_dir():
    return os.path.join(ROOT, 'tests', '.mutate-backup')

def snapshot_sources():
    d = _bak_dir()
    if not os.path.isdir(d):
        os.makedirs(d)
    for fn in os.listdir(os.path.join(ROOT, 'src')):
        src = os.path.join(ROOT, 'src', fn)
        if os.path.isfile(src):
            with open(src, 'rb') as f:
                data = f.read()
            with open(os.path.join(d, fn), 'wb') as f:
                f.write(data)

def restore_sources_if_dirty():
    """이전 실행이 비정상 종료돼 백업이 남아 있으면 바이트 그대로 되돌린다."""
    d = _bak_dir()
    if not os.path.isdir(d):
        return []
    changed = []
    for fn in os.listdir(d):
        bak, live = os.path.join(d, fn), os.path.join(ROOT, 'src', fn)
        if not os.path.isfile(live):
            continue
        with open(bak, 'rb') as f:
            want = f.read()
        with open(live, 'rb') as f:
            got = f.read()
        if want != got:
            with open(live, 'wb') as f:
                f.write(want)
            changed.append(fn)
    return changed

def clear_snapshot():
    d = _bak_dir()
    if not os.path.isdir(d):
        return
    for fn in os.listdir(d):
        os.remove(os.path.join(d, fn))
    os.rmdir(d)

SRC = os.path.join(ROOT, 'src')

ENV = dict(os.environ)
ENV['PYTHONIOENCODING'] = 'utf-8'

# (이름, 파일, 찾을 바이트, 바꿀 바이트, 반드시 FAIL 이 되어야 하는 게이트들 [, 드라이버])
# 드라이버를 생략하면 모델 게이트(driver.js). UI 결함은 uismoke.js 로 지목한다.
MUTATIONS = [
    # 헤드리스 주행은 그림을 솎아서 돈다(renderThin). 솎기가 지나쳐 한 장도 안
    # 그리게 되면 40분 주행이 화면 없이 도는 셈이 된다 — 그것을 잡는지 본다.
    ('render: 프레임 루프가 아무것도 안 그린다', '60_game.js',
     b"  if (renderThinN <= 1 || renderTick % renderThinN === 0) guard('render', render);",
     b"  if (false) guard('render', render);",
     ['clear.stillDrewFrames'], 'clear.js'),

    # 안드로이드 주소창 함정 — dvh 짝을 지우면 갤럭시에서 판 아래가 잘린다.
    ('phone: 판 높이가 dvh 짝 없이 vh 만 쓴다', 'shell.html',
     b'#build{max-height:calc(100dvh - 16px)}',
     b'#build{max-height:calc(100vh - 16px)}',
     ['mobile.viewportHeightUsesDvh'], 'mobile.js'),

    # 빌드가 도장을 안 박으면 폰이 어느 사본을 열었는지 알 수 없다.
    ('stamp: 빌드가 도장을 안 박는다', 'build.py',
     b"    game = splice(game, stamp_mark, \"var BUILD_ID = '\" + build_id + \"';\")",
     b'    pass',
     ['ui.buildStampIsShown'], 'uismoke.js'),

    # 오염 버튼이 상태를 말하지 않으면 폰에서는 '반응이 없다' 로 보인다(실기기 보고).
    # 라벨만 지우는 돌연변이는 안 걸린다 — 강조(class)가 남아 여전히 상태를 말하기
    # 때문이다. 버튼 쪽 표시를 통째로 죽여야 이 게이트가 무엇을 보는지 드러난다.
    ('phone: 오염 버튼이 상태를 말하지 않는다', '50_ui.js',
     b'function syncPollBtn() {',
     b'function syncPollBtn() { return;',
     ['mobile.pollutionButtonSaysItsState'], 'mobile.js'),

    # 실기기 스크린샷에서 '청사 진'·'도움 말' 로 접혔다 — 그 상태로 되돌린다.
    ('phone: 조작 바 글자가 다시 접힌다', 'shell.html',
     b'#mobBar button{white-space:nowrap;padding:0 2px;font-size:min(12px, 3.05vw)}',
     b'#mobBar button{padding:0 8px}',
     ['mobile.barLabelsDoNotWrap'], 'mobile.js'),

    # 새 튜토리얼 단계가 실제로 무언가를 요구하는가 — 판정을 헐겁게 쓰면
    # 빈 판에서 이미 참이 되어 그 단계는 아무것도 안 가르친다.
    ('tutorial: 석유 단계가 아무 조건 없이 통과한다', '52_tutorial.js',
     b"      if ((inventory['plastic'] || 0) >= 1) return true;",
     b'      if (true) return true;',
     ['tut.noStepIsAlreadyDone']),

    # 석유 제어 단계는 40분 주행이 실제로 밟는지로 지킨다(커버리지).
    ('tutorial: 석유 제어 단계 판정이 늘 거짓', '52_tutorial.js',
     b"    check: function () { return ctrlFeeds('fluid', ['enable']); }",
     b'    check: function () { return false; }',
     ['clear.advancedTutorialDone'], 'clear.js'),

    # --- 폰 조작 ---------------------------------------------------------
    ('phone: 오염 보기 버튼이 아무 일도 안 한다', '50_ui.js',
     b'  if (pb) pb.onclick = function () { togglePollution(); };',
     b'  if (pb) pb.onclick = function () { };',
     ['mobile.pollutionViewWithoutKeyboard'], 'mobile.js'),

    ('phone: 복제 버튼이 방향을 안 물려준다', '50_ui.js',
     b'    selectTool(e.type); toolDir = e.dir;',
     b'    selectTool(e.type);',
     ['mobile.copyBuildingWithoutKeyboard'], 'mobile.js'),

    # 줄을 내리는 것만 되돌리면 안 걸린다 — 버튼 크기 규칙이 따로 살아 있기 때문이다
    # (그렇게 만들었다가 MISS 를 봤다). 크기 규칙 자체를 데스크톱 값으로 되돌린다.
    ('phone: 저장 버튼이 폰에서도 데스크톱 크기를 쓴다', 'shell.html',
     b'  #sysRow button{min-height:44px;min-width:44px;font-size:13px;padding:4px}',
     b'  #sysRow button{font-size:10px;padding:1px 7px}',
     ['mobile.tapTargetsBigEnough'], 'mobile.js'),


    # --- 석유·화학 사슬 ------------------------------------------------
    ('oil: 펌프잭이 절반만 뽑는다', '05_data.js',
     b'  pumpjackRate: 10,',
     b'  pumpjackRate: 5,',
     ['oil.pumpjackRateMatchesSpec', 'spec.matchesPublishedValues']),

    ('oil: 채광기가 원유 위에도 선다', '25_entity.js',
     b'    if (sv.type === ORE_OIL) return { ok: false, why:',
     b'    if (false) return { ok: false, why:',
     ['oil.pumpjackNeedsOilPatch']),

    ('oil: 플라스틱이 가스를 절반만 먹는다', '05_data.js',
     b'  chemGasPerPlastic: 10,',
     b'  chemGasPerPlastic: 5,',
     ['oil.chemGasPerPlasticMatchesSpec', 'spec.matchesPublishedValues']),

    ('oil: 정제소가 꺼도 계속 돈다', '32_fluid.js',
     b'      if (!m.enabled || m.powerSat <= 0) { m.working = false; m.load = 0; continue; }\n      var wantOil = SPEC.refineryIn * dt * m.powerSat;',
     b'      if (m.powerSat <= 0) { m.working = false; m.load = 0; continue; }\n      var wantOil = SPEC.refineryIn * dt * m.powerSat;',
     ['oil.refineryOffStopsChain']),

    ('oil: 원유 광맥이 마르지 않는다', '10_world.js',
     b'function consumeOreUnder(e, amt) {',
     b'function consumeOreUnder(e, amt) { if (amt >= 0) return;',
     ['oil.patchDepletes']),

    # 주의: 후속 아이템 쪽 한 줄만 늦추면 선두는 그대로라 라인 속도가 안 변한다
    #       (처음에 그렇게 골랐다가 belt.transport 를 못 뒤집었다). 이동량 자체를 늦춘다.
    ('벨트가 30% 느려진다', '20_belt.js',
     b'  var move = beltSpeed() * dt;',
     b'  var move = beltSpeed() * dt * 0.7;',
     ['belt.throughput', 'belt.transport']),

    ('인서터가 놓을 곳 없이 집는다', '25_entity.js',
     b'      if (!inserterCanPlace(e, peek)) { e.t = 1; e.working = false; e.stallT += dt; return; }',
     b'      if (false) { e.t = 1; e.working = false; e.stallT += dt; return; }',
     ['inserter.noPickWithoutTarget']),

    ('채광기가 광석을 2개씩 만든다', '25_entity.js',
     b'    invAdd(e.out, got, 1);',
     b'    invAdd(e.out, got, 2);',
     ['mass.balance']),

    ('전력 만족도가 항상 100%', '30_power.js',
     b'    nt.sat = nt.demand <= 0 ? 1 : Math.min(1, nt.supplyCap / nt.demand);',
     b'    nt.sat = 1;',
     ['power.brownout', 'power.satScalesSpeed']),

    ('SR 래치가 그냥 비교기가 된다', '35_logic.js',
     b'      if (R2) n.state.q = 0; else if (S) n.state.q = 1;',
     b'      n.state.q = S ? 1 : 0;',
     ['logic.hysteresisHolds']),

    ('제어기 지배가 풀려도 안 돌려준다', '35_logic.js',
     b'    if (!e.fEnable) e.enabled = (e.playerEnabled !== false);',
     b'    if (false) e.enabled = (e.playerEnabled !== false);',
     ['logic.releasesControl']),

    # else-if 조건만 바꾸면 그림자(shadowUnder)가 먼저 그려져 있어 화면이 바뀐다 —
    # 게이트의 주장("빈 땅과 다르게 그린다")은 그대로 참이다. 정말 아무것도 안 그리게 만든다.
    ('상자를 화면에 아예 안 그린다', '45_render.js',
     b"    case 'pole': drawPole(e); return;",
     b"    case 'pole': drawPole(e); return;\n    case 'chest': return;",
     ['visual.everyBuildingDraws']),

    ('발전기 오염에 dt 를 빠뜨린다 (초당 60배)', '25_entity.js',
     b'    emitPollution(e, 20 * e.load * dt);',
     b'    emitPollution(e, 20 * e.load);',
     ['pollution.generatorRate']),

    ('터렛이 탄약을 안 쓰고도 쏜다 → 사거리 판정 제거', '40_enemy.js',
     b'      if (d < bd) { bd = d; best = enemies[i]; }',
     b'      if (false) { bd = d; best = enemies[i]; }',
     ['combat.turretKills']),

    # ---- 아래는 출고 전 적대적 리뷰가 찾아낸 결함들. 고친 뒤 회귀 게이트를 달았고,
    #      그 게이트가 정말로 그 결함을 잡는지 여기서 되짚는다.
    ('분배기 둘째 칸을 다시 dirCW 로 잡는다', '25_entity.js',
     b'    var sx = (w === 2) ? 1 : 0, sy = (h === 2) ? 1 : 0;',
     b'    var sx = DIR_DX[dirCW(e.dir)], sy = DIR_DY[dirCW(e.dir)];',
     ['splitter.cellsMatchOccupancy']),

    ('분배기가 닫힌 게이트 출구를 다시 고른다', '20_belt.js',
     b'    if (!t.gate || !laneHasRoom(t.lanes[tl])) continue;',
     b'    if (!laneHasRoom(t.lanes[tl])) continue;',
     ['splitter.gateFallsBackToOtherOutput']),

    ('인서터 peek 이 다시 레인 선두를 본다', '25_entity.js',
     b'  if (c) return beltPeek(c, e.filter);',
     b'  if (c) return (c.lanes[0][0] && (!e.filter || c.lanes[0][0].id === e.filter)) ? c.lanes[0][0].id : beltPeek(c, e.filter);',
     ['inserter.peekMatchesTake']),

    # **불러오기 경로만** 유료로 만든다. 예전에는 canPlace 의 `if (!restore)` 를
    # 통째로 켰는데, 그러면 시험용 G.place 까지 재료를 요구해 드라이버가 초반에
    # 죽는다 — 게이트가 실행조차 안 돼 INVALID(검정 불성립)로 빠졌다. 돌연변이는
    # 겨냥한 게이트가 살아서 판정할 수 있을 만큼만 좁게 깨뜨려야 한다.
    ('복원에서도 건설비를 요구한다', '60_game.js',
     b'      var e = placeEntity(o.t, o.x, o.y, o.d, true);',
     b'      var e = placeEntity(o.t, o.x, o.y, o.d, false);',
     ['save.restoreWithEmptyInventory']),

    ('불러오기 전에 id 커서를 안 올린다', '60_game.js',
     b'    nextEntId = maxId + 1;',
     b'    nextEntId = nextEntId;',
     ['save.noIdCollision']),

    # 조건식을 건드리면 괄호가 깨져 INVALID 가 된다. 이른 return 만 없앤다.
    ('저장본 선검사가 중단시키지 않는다', '60_game.js',
     b"    toast('\xec\xa0\x80\xec\x9e\xa5\xeb\xb3\xb8 \xed\x98\x95\xec\x8b\x9d\xec\x9d\xb4 \xeb\xa7\x9e\xec\xa7\x80 \xec\x95\x8a\xeb\x8b\xa4 \xe2\x80\x94 \xed\x98\x84\xec\x9e\xac \xea\xb2\x8c\xec\x9e\x84\xec\x9d\x80 \xea\xb7\xb8\xeb\x8c\x80\xeb\xa1\x9c \xeb\x91\x94\xeb\x8b\xa4', 'bad');\n    return false;",
     b"    toast('bad-save', 'bad');",
     ['save.badSaveKeepsGame']),

    ('래치 레지스터를 저장에서 뺀다', '60_game.js',
     b'                 o: n.out.slice(), p: n.prev.slice() };',
     b'                 o: null, p: null };',
     ['save.keepsLatchState']),

    ('망에서 떨어진 발전기의 부하를 안 지운다', '30_power.js',
     b"  forEachEntity(function (e) { if (e.type === 'generator' || e.type === 'engine') e.load = 0; });",
     b"  forEachEntity(function (e) { if (e.type === '__never') e.load = 0; });",
     ['power.disconnectedGeneratorIdles']),

    ('꺼진 발전기도 계속 공급한다', '30_power.js',
     b'      if (!gen.enabled) continue;',
     b'      if (false) continue;',
     ['power.controllerCanStopGenerator']),

    ('용광로가 아무 제련 레시피나 받는다', '25_entity.js',
     b"      else rec = e.recipe ? RECIPES[e.recipe] : furnaceRecipeFor(itemId);",
     b"      else rec = furnaceRecipeFor(itemId);",
     ['furnace.onlyCurrentRecipeInput']),

    ('벌목해도 오염 흡수 인구조사를 안 깎는다', '10_world.js',
     b'      if (treeCountPerChunk) {',
     b'      if (false) {',
     ['world.clearedTreesStopAbsorbing']),

    ('적이 없을 때 근접거리를 0으로 낸다', '35_logic.js',
     b'      n.out[1] = cnt ? Math.round(near * 10) / 10 : R;',
     b'      n.out[1] = cnt ? Math.round(near * 10) / 10 : 0;',
     ['logic.enemyDistanceWhenNone']),

    ('튜토리얼이 판정 없이 저절로 진행된다', '52_tutorial.js',
     b'  if (!ok) return;',
     b'  if (false) return;',
     ['tutorial.doesNotAdvanceIdle']),

    ('재료를 어디서 얻는지 안 알려준다', '25_entity.js',
     b'function howToGet(itemId) {\n  var r = RECIPES[itemId];',
     b'function howToGet(itemId) {\n  if (true) return null;\n  var r = RECIPES[itemId];',
     ['help.tellsHowToGetMaterials']),

    # ---- 심화 과정 (부하 차단 · 방어) ----
    # 배선 판정이 "놓기만 한 노드"를 통과시키면 심화 단계는 전부 무의미해진다.
    ('배선 판정이 도달성 대신 노드 존재만 본다', '52_tutorial.js',
     b'      if (reachableNodes(g, g.nodes[i].nid, kindsTo, pred).length) hit = true;',
     b'      hit = true;',
     ['adv.seePowerNeedsWiring', 'adv.defenseAutoNeedsWiring']),

    ('중간 노드를 건너뛴 직결도 통과시킨다', '52_tutorial.js',
     b'      var mids = reachableNodes(g, g.nodes[i].nid, [kindMid]);',
     b'      var mids = g.nodes;',
     ['adv.naiveShedNeedsComparator']),

    # RESET 이 없는 래치는 한 번 켜진 뒤 영영 안 꺼진다 — 부하 차단이 성립하지 않는다
    ('RESET 이 안 물린 래치도 완성으로 친다', '52_tutorial.js',
     b'        return portFed(g, L.nid, 1);',
     b'        return true;',
     ['adv.latchNeedsReset']),

    ('대상 없는 출력 노드도 배선으로 친다', '52_tutorial.js',
     b'function hasTarget(n) { return !!n.cfg && n.cfg.ent !== null && n.cfg.ent !== undefined; }',
     b'function hasTarget(n) { return !!n; }',
     ['adv.outputNeedsTarget']),

    # 순환 방어를 빼면 되먹임 배선에서 탐색이 안 끝난다 — 게이트가 아니라 게임이 멈춘다
    # 이 돌연변이는 예전에 **무한 루프를 내서 게이트가 아니라 실행 전체를 세웠다.**
    # 이제 REACH_LIMIT 상한이 있어 멈추기는 하지만 걸음 수가 폭발하고,
    # adv.cyclicSearchIsBounded 가 그 숫자를 본다.
    ('도달성 탐색의 순환 방어를 뺀다', '52_tutorial.js',
     b'    if (seen[cur]) continue;',
     b'    if (false) continue;',
     ['adv.cyclicSearchIsBounded']),

    # 상한을 지우면 seen 이 살아 있는 한 정상 동작한다 — 단독으로는 안 잡힌다.
    # 대신 상한 자체를 1 로 낮추면 탐색이 아무것도 못 찾아 판정이 무너진다.
    # 상한 1 이면 첫 바퀴에서 **직접 이웃**까지는 찾는다. 그래서 1홉 배선을 보는
    # 게이트는 안 뒤집힌다. naiveShedNeedsComparator 도 power→cmp, cmp→enable 로
    # **1홉 탐색 두 번**이라 통과해 버렸다(MISS 2회로 확인). 한 번의 탐색이 2홉을
    # 타야 하는 latchNeedsReset(power→cmp→latch) 만이 이 상한에 실제로 걸린다.
    ('도달성 탐색 상한을 1 로 낮춘다', '52_tutorial.js',
     b'var REACH_LIMIT = 20000;',
     b'var REACH_LIMIT = 1;',
     ['adv.latchNeedsReset']),

    ('손으로 채운 터렛도 자동 보급으로 친다', '52_tutorial.js',
     b'             inserterFeedsTurret();',
     b'             true;',
     ['adv.ammoNeedsInserter']),

    ('기초를 안 끝내도 심화로 들어간다', '52_tutorial.js',
     b'  if (!tutorial.done) return false;',
     b'  if (false) return false;',
     ['adv.requiresBasicDone']),

    ('저장본이 트랙을 안 기억한다', '60_game.js',
     b"      tutorial.track = (data.tut.track === 'adv') ? 'adv' : 'basic';",
     b"      tutorial.track = 'basic';",
     ['adv.trackSurvivesSaveLoad']),

    # skipTutorialStep 의 상한만 깨면 renderTutorial 의 오버플로 가드가 대신 step 을
    # 8 에서 멈춰 세워 MISS 가 난다(이중 방어 — 실제로 그렇게 났다). 두 곳이 함께
    # 쓰는 진실의 출처인 curSteps() 를 깨야 한 방에 무너진다.
    ('트랙과 무관하게 기초 단계 배열을 쓴다', '52_tutorial.js',
     b"function curSteps() { return tutorial.track === 'adv' ? ADVANCED_STEPS : TUTORIAL_STEPS; }",
     b'function curSteps() { return TUTORIAL_STEPS; }',
     ['adv.terminates']),

    # ---- 최고·최저 기록 노드 ----
    # 씨앗을 0 으로 박으면 최저 기록은 영원히 0 이다 — 평활 필터가 겪은 것과 같은 부류.
    # JS 안에 홑따옴표가 있으니 바이트 리터럴은 겹따옴표로 쓴다.
    ('최저 기록의 씨앗을 0 으로 박는다', '35_logic.js',
     b"      if (typeof n.state.rec !== 'number' || !isFinite(n.state.rec)) n.state.rec = pv;",
     b"      if (typeof n.state.rec !== 'number' || !isFinite(n.state.rec)) n.state.rec = 0;",
     # **한 돌연변이는 한 드라이버의 게이트만 지목한다** — 이 파일에서 두 번째로
     # 걸렸다(변화율 때도 같았다). 같은 결함을 두 각도에서 보려면 항목을 나눈다.
     ['peak.seedsFromFirstInput']),

    ('최저 기록의 씨앗을 0 으로 박는다 — 전수 스윕 쪽', '35_logic.js',
     b"      if (typeof n.state.rec !== 'number' || !isFinite(n.state.rec)) n.state.rec = pv;",
     b"      if (typeof n.state.rec !== 'number' || !isFinite(n.state.rec)) n.state.rec = 0;",
     ['node.peak'], 'fullplay.js'),

    # 최저·최고 구분이 없으면 한쪽 모드가 조용히 반대로 돈다.
    # **바이트 리터럴에는 한글을 못 넣는다**(이 파일에서 두 번째로 걸렸다) — 줄의
    # ASCII 접두만 겨냥하고 나머지는 그대로 둔다.
    ('기록 모드를 무시하고 언제나 최저로 본다', '35_logic.js',
     b'      var pLow = (n.cfg.mode',
     b'      var pLow = true; var pUnused = (n.cfg.mode',
     ['peak.maxModeKeepsHigh']),

    # ---- 지속 조건 노드 ----
    # 조건이 끊겨도 시계를 안 지우면 '연속'이 '누적'이 되어, 짧은 튐이 모여 참이 된다.
    ('지속 조건이 끊겨도 시계를 안 지운다 (누적이 된다)', '35_logic.js',
     b"      if (!truthy(readIn(g, n, 0))) { n.state.held = 0; n.out[0] = 0; break; }",
     b"      if (!truthy(readIn(g, n, 0))) { n.out[0] = 0; break; }",
     ['node.sustain'], 'fullplay.js'),

    # dt 를 안 더하면 틱을 세게 되어 60배 빨리 참이 된다.
    # **앵커는 한 줄로.** 여러 줄 바이트 리터럴은 이 파일에서 두 번째로 깨뜨렸다.
    ('지속 조건이 dt 대신 틱을 센다 (60배 빨리 참이 된다)', '35_logic.js',
     b'      n.state.held = (n.state.held || 0) + dt;',
     b'      n.state.held = (n.state.held || 0) + 1;',
     ['sustain.dropsSpikesKeepsReal']),

    # 문장의 기억 종류가 sustain 을 모르면, 골라도 아무 일도 안 일어난다.
    ('문장의 지속 조건이 노드를 안 만든다', '37_rules.js',
     b"  } else if (m.kind === 'sustain') {",
     b'  } else if (false) {',
     ['rule.sustainCompilesAndWaits']),

    # ---- 변화율 노드 ----
    # dt 로 안 나누면 '틱당 변화' 가 되어 프레임 수에 딸려 간다 — 이 레포가 반복해 겪은 부류다.
    # 한 돌연변이는 **한 드라이버의 게이트만** 지목할 수 있다 — 둘을 섞었더니
    # '게이트가 실행조차 안 됐다(INVALID)' 가 났다. 같은 결함을 두 각도에서 보려면
    # 항목을 나눈다.
    ('변화율이 dt 로 안 나눈다 (틱당 변화가 된다)', '35_logic.js',
     b'      var raw = dt > 0 ? (xr - n.state.px) / dt : 0;',
     b'      var raw = xr - n.state.px;',
     ['rate.matchesKnownSlope']),

    ('변화율이 dt 로 안 나눈다 — 전수 스윕 쪽', '35_logic.js',
     b'      var raw = dt > 0 ? (xr - n.state.px) / dt : 0;',
     b'      var raw = xr - n.state.px;',
     ['node.rate'], 'fullplay.js'),

    # 끊긴 사이의 변화가 한꺼번에 튀면, 배선을 고칠 때마다 거짓 경보가 뜬다.
    ('배선을 끊어도 이전 값을 기억한다 (다시 물면 튄다)', '35_logic.js',
     b"      if (!inputFed(g, n, 0)) { delete n.state.px; delete n.state.r; n.out[0] = 0; break; }",
     b"      if (!inputFed(g, n, 0)) { n.out[0] = 0; break; }",
     ['rate.rewireDoesNotSpike']),

    # 단항이 둘인데 컴파일러가 한쪽만 안다면, 변화율을 골라도 평활이 걸린다.
    ('문장의 단항이 언제나 평활로 컴파일된다', '37_rules.js',
     b"      var sm = graphAddNode(g, mdef.node || 'smooth', x, y0);",
     b"      var sm = graphAddNode(g, 'smooth', x, y0);",
     ['rule.rateCompilesAsItsOwnNode']),

    # ---- 저장본 판 표시 ----
    # 판이 바뀌어도 조용히 열리면 "열었더니 연구가 사라졌다" 의 원인을 아무도 못 짚는다.
    ("저장본에 판을 안 적는다", "60_game.js",
     "    v: VERSION, seed: worldSeed, t: gameTime,".encode("utf-8"),
     "    seed: worldSeed, t: gameTime,".encode("utf-8"),
     ["save.recordsVersion", "save.sameVersionIsNotFlagged"]),

    ("다른 판에서 온 저장본을 같은 판인 척 연다", "60_game.js",
     "  lastLoadWasForeign = (lastLoadVersion !== VERSION);".encode("utf-8"),
     "  lastLoadWasForeign = false;".encode("utf-8"),
     ["save.foreignVersionIsFlaggedButStillLoads", "save.missingVersionIsFlagged"]),

    # ---- 도움말 본문 ----
    # 튜토리얼을 건너뛴 사람은 도움말만 읽는다. 여기 숫자가 틀리면 배선이 안 되고
    # 이유를 모른다.
    ("도움말이 열차 자동 출발을 3초라고 적는다", "50_ui.js",
     "화물이 다 찼거나 5초가 지나면 간다".encode("utf-8"),
     "화물이 다 찼거나 3초가 지나면 간다".encode("utf-8"),
     ["help.matchesConstants"]),

    ("도움말이 참/거짓 문턱을 0 초과라고 적는다", "50_ui.js",
     "0.5 이상이 참이다".encode("utf-8"),
     "0 초과가 참이다".encode("utf-8"),
     ["help.matchesConstants"]),

    # ---- 튜토리얼 재료 문구 ----
    # 문구를 보고 재료를 준비하는 사람이 있다. 비용만 바꾸면 그 줄이 거짓말이 된다.
    # 비용 쪽을 건드리면 초반 리그가 통째로 깨져 드라이버가 중단되고 INVALID 가 된다
    # (실제로 한 번 그랬다). 그래서 **문구 쪽**을 틀어 본다 — 어차피 현실에서도
    # 문구가 뒤처지는 쪽이 흔하다.
    ("튜토리얼 문구가 용광로 값을 실제보다 비싸게 적는다", "52_tutorial.js",
     "need: '용광로 = 벽돌 5 + 철판 5".encode("utf-8"),
     "need: '용광로 = 벽돌 8 + 철판 5".encode("utf-8"),
     ["tut.needTextMatchesCosts"]),

    ("기억소자 연구비를 올리면서 문구를 안 고친다", "05_data.js",
     "'logic-mem':  { name: '논리 II — 기억소자', cost: { 'sci-red': 40 }".encode("utf-8"),
     "'logic-mem':  { name: '논리 II — 기억소자', cost: { 'sci-red': 60 }".encode("utf-8"),
     ["tut.needTextMatchesCosts"]),

    # ---- SPEC 밖의 공개 숫자 ----
    # 전력·시간·적 체력은 SPEC 이 아니라 BUILDINGS·RECIPES·ENEMY_TIERS 에 흩어져 있어
    # 앞 절의 대조를 그냥 지나갔다.
    ("조립기가 전기를 덜 먹는다고 조용히 바꾼다", "05_data.js",
     "power: 155,".encode("utf-8"),
     "power: 120,".encode("utf-8"),
     ["spec.buildingPowerMatchesPublished"]),

    ("제련 시간을 절반으로 줄인다", "05_data.js",
     "'iron-plate':   { cat: 'smelt', time: 3.2,".encode("utf-8"),
     "'iron-plate':   { cat: 'smelt', time: 1.6,".encode("utf-8"),
     ["spec.recipeTimeMatchesPublished"]),

    ("대형 적이 절반만 맞아도 죽는다", "05_data.js",
     "{ name: '대형', hp: 375,".encode("utf-8"),
     "{ name: '대형', hp: 180,".encode("utf-8"),
     ["spec.enemyHpMatchesPublished"]),

    # ---- 해금 목록 ----
    # 목록이 실제 잠금과 갈라지는 두 방향. 실제로 강철 제련이 유체·열차 계통 전체를
    # 잠그는데 목록엔 두 줄만 있었다(이 게이트가 그것을 찾아냈다).
    ("강철 연구가 여는 것을 목록에서 하나 뺀다 (열차)", "05_data.js",
     "'저장 탱크', '이송 펌프'".encode("utf-8"),
     "'이송 펌프'".encode("utf-8"),
     ["tech.unlockListCoversWhatItGates"]),

    ("이미 열려 있는 물건을 해금 목록에 적어 둔다", "05_data.js",
     "unlock: ['녹색 연구팩 레시피'],".encode("utf-8"),
     "unlock: ['녹색 연구팩 레시피', '채광기'],".encode("utf-8"),
     ["tech.unlockListHasNoPhantoms"]),

    ("다른 연구가 잠그는 것을 자기 목록에 적어 둔다", "05_data.js",
     "unlock: ['적 근접', '터렛 사격허가'],".encode("utf-8"),
     "unlock: ['적 근접', '터렛 사격허가', '분배기'],".encode("utf-8"),
     ["tech.unlockListHasNoPhantoms"]),

    # ---- 연구 효과 ----
    # 숫자를 바꾸는 연구 둘. 효과가 조용히 약해지거나 저장에서 새어 나가면
    # 플레이어는 원인을 짐작할 수 없다.
    ("고속 벨트가 2배가 아니라 1.5배만 빨라진다", "05_data.js",
     "'belt-2':       { belt: 2 },".encode("utf-8"),
     "'belt-2':       { belt: 1.5 },".encode("utf-8"),
     ["tech.beltSpeedDoubles", "tech.descMatchesEffect"]),

    ("생산 효율이 기계 속도를 안 올린다", "05_data.js",
     "'automation-2': { machine: 1.5, power: 0.8 }".encode("utf-8"),
     "'automation-2': { machine: 1.0, power: 0.8 }".encode("utf-8"),
     ["tech.automationSpeedsMachines"]),

    ("생산 효율이 전력을 안 깎는다", "05_data.js",
     "'automation-2': { machine: 1.5, power: 0.8 }".encode("utf-8"),
     "'automation-2': { machine: 1.5, power: 1.0 }".encode("utf-8"),
     ["tech.automationCutsPower"]),

    ("저장을 열 때 연구 효과를 다시 안 건다 (열면 느려지는 공장)", "60_game.js",
     ("    applyTechEffects();" + chr(10) + chr(10) + "    world.oreAmt").encode("utf-8"),
     (chr(10) + "    world.oreAmt").encode("utf-8"),
     ["tech.effectsSurviveSave"]),

    ("새 판을 시작해도 배수가 안 돌아간다 (연구가 다음 판으로 샌다)", "60_game.js",
     "  beltSpeedMul = 1; machineSpeedMul = 1; machinePowerMul = 1; powerCheatOn = false;".encode("utf-8"),
     "  powerCheatOn = false;".encode("utf-8"),
     ["tech.effectsResetOnNewGame"]),

    # ---- 설명문 대조 ----
    # 설명문만 조용히 틀어지는 경우다. 상수는 그대로라 앞 절 게이트는 아무 말도 안 한다.
    ("채광기 설명문이 실제보다 빠르다고 말한다", "05_data.js",
     "아래 광맥을 0.5개/s 로 캔다".encode("utf-8"),
     "아래 광맥을 0.7개/s 로 캔다".encode("utf-8"),
     ["desc.matchesConstants"]),

    ("상자 설명문이 실제보다 많이 담는다고 말한다", "05_data.js",
     "600개 보관".encode("utf-8"),
     "900개 보관".encode("utf-8"),
     ["desc.matchesConstants"]),

    # ---- 공개 숫자 대조 ----
    # 이 셋이 CAUGHT 여야 하는 이유: 처리량 게이트는 기대값을 SPEC 에서 받아 쓰므로
    # SPEC 이 바뀌면 오라클도 같이 움직여 아무것도 안 걸린다(실측으로 확인했다).
    ('채광 속도를 절반으로 깎는다 (README 는 0.5 광석/s 라고 약속한다)', '05_data.js',
     b'  minerRate: 0.5,',
     b'  minerRate: 0.25,',
     ['spec.matchesPublishedValues']),

    ('증기기관이 먹는 증기량만 조용히 바꿔 30 kJ 항등식을 깬다', '05_data.js',
     b'  engineSteam: 30,',
     b'  engineSteam: 25,',
     ['spec.steamEnergyIdentityHolds', 'spec.matchesPublishedValues']),

    ('설계 상수 원본을 안 내준다 (대조가 조용히 무력화된다)', '60_game.js',
     b'  specRaw: function () { var o = {}; for (var k in SPEC) o[k] = SPEC[k]; return o; },',
     b'  specRaw: function () { return {}; },',
     ['spec.rawIsExposed', 'spec.matchesPublishedValues']),

    # ---- 전주의 두 반경 · 벽 체력 ----
    # 플레이어가 배치를 계획하는 근거다. 조용히 바뀌면 지금까지의 배치 감각이 전부 틀린다.
    ('전주 공급 반경이 한 칸 넓다 (5x5 가 7x7 이 된다)', '05_data.js',
     b'  poleSupply: 2,',
     b'  poleSupply: 3,',
     ['pole.supplyIsFiveByFive']),

    ('전주 연결 거리가 한 칸 길다', '05_data.js',
     b'  poleReach: 7.5,',
     b'  poleReach: 8.5,',
     ['pole.linkReachIsSevenAndHalf']),

    ('벽 체력이 규격의 절반이다', '05_data.js',
     b'  wallHp: 350,',
     b'  wallHp: 175,',
     ['wall.hpMatchesSpec']),

    # ---- 저장 실패 처리 ----
    # try/catch 를 걷어내면 저장칸이 거부할 때 예외가 그대로 새어나온다 — 플레이어는
    # 저장된 줄 알고 창을 닫는다. 코드에 이미 있던 처리라 게이트가 없으면 조용히 사라진다.
    ('저장 실패를 안 잡는다 (예외가 새어나온다)', '60_game.js',
     # 이 줄에는 한글 토스트 문구가 있어 통째로는 못 겨냥한다 — ASCII 접두까지만
     # 잡고 뒤는 죽은 함수 안으로 밀어 넣는다(문법은 그대로 성립한다).
     b"  } catch (e) { logError('save', e); toast(",
     b"  } catch (e) { throw e; } function _deadSaveToast(e) { toast(",
     ['save.survivesQuotaFailure']),

    # ---- 망 사이 이송 펌프 ----
    # 회원으로 넣으면 유니온-파인드가 앞뒤를 한 망으로 합쳐, 이 건물의 이유가 사라진다.
    ('이송 펌프가 유체망의 회원이 된다 (두 망이 합쳐진다)', '32_fluid.js',
     b'  forEachEntity(function (e) { if (isFluidEnt(e) && !isXferPump(e)) { e.fnet = -1; list.push(e); } });',
     b'  forEachEntity(function (e) { if (isFluidEnt(e)) { e.fnet = -1; list.push(e); } });',
     ['xpump.keepsNetsSeparate']),

    # 규격을 반으로 줄이면 옮기는 속도가 반이 된다.
    ('이송 속도가 규격의 절반이다', '05_data.js',
     b'  xpumpRate: 200,',
     b'  xpumpRate: 100,',
     ['xpump.movesAtSpec']),

    # 제어기가 꺼도 계속 옮기면, 이 건물이 여는 결정(언제 옮길지)이 통째로 사라진다.
    ('제어기가 꺼도 이송 펌프가 계속 옮긴다', '32_fluid.js',
     b'    if (!e.enabled) { e.working = false; return; }',
     b'    if (false) { e.working = false; return; }',
     ['xpump.stopsWhenDisabled']),

    # ---- 저장 탱크 ----
    # 탱크를 칸 수로 세면 3x3=900 이라 파이프 아홉 칸과 같아지고, 지을 이유가 사라진다.
    ('탱크 용량을 칸 수로 센다 (파이프 9칸과 같아진다)', '32_fluid.js',
     b"  if (e.type === 'tank') return SPEC.tankCap;",
     b"  if (false) return SPEC.tankCap;",
     # tankBufferIsTime 은 여기 안 넣는다 — 그 게이트가 재는 것은 용량이 아니라
     # **소비율**(저장량 ÷ 30/s)이라, 용량을 어떻게 세든 그 관계는 그대로 성립한다.
     # 돌연변이가 그 사실을 MISS 로 알려 줬다.
     ['fluid.tankCapacityMatchesSpec']),

    # 완충은 곧 시간이다 — 용량을 반으로 줄이면 버티는 시간도 반이 된다.
    ('탱크 용량이 규격의 절반이다', '05_data.js',
     b'  tankCap: 25000,',
     b'  tankCap: 12500,',
     ['fluid.tankCapacityMatchesSpec']),

    # ---- 청사진 회전 ----
    # 좌표만 돌리고 방향을 안 돌리면 라인 모양은 맞는데 흐름이 옛 방향 그대로다.
    # 4회전 항등이 그것을 잡는다(방향이 안 돌면 절대 제자리로 안 온다).
    ('회전이 방향은 그대로 두고 좌표만 돌린다', '34_blueprint.js',
     b'    n.d = dirCW(it.d | 0);',
     b'    n.d = it.d | 0;',
     ['bp.rotateTurnsDirections']),

    # 방향에 따라 발자국이 바뀌는 것(분배기)을 무시하면 좌표가 한 칸씩 어긋난다.
    ('회전이 정의값 크기를 쓴다 (방향별 발자국 무시)', '34_blueprint.js',
     b'  if (B.rot && (dir === 1 || dir === 3) && w !== h) { var t = w; w = h; h = t; }',
     b'  if (false) { var t = w; w = h; h = t; }',
     ['bp.rotateMapsCoordinates']),

    # 회전 축이 틀리면(H 를 안 빼면) 청사진이 원점 밖으로 나가 서로 겹친다.
    ('회전이 원점을 안 맞춘다 (H - dy - h 대신 dy)', '34_blueprint.js',
     b'    n.dx = H - it.dy - s[1];',
     b'    n.dx = it.dy;',
     ['bp.rotateMapsCoordinates']),

    # 붙여넣기 중 R 이 청사진 대신 도구를 돌리면, 화면에서는 아무 일도 안 일어난다.
    ('붙여넣기 중 회전이 도구만 돌린다', '50_ui.js',
     b"  if (bpMode === 'paste' && blueprint) {",
     b'  if (false) {',
     ['ui.blueprintRKeyRotates'], 'uismoke.js'),

    # 회전 버튼이 공용 손잡이를 안 쓰면 키보드 없는 기기에서 청사진 회전이 사라진다.
    ('회전 버튼이 도구만 돌린다 (폰에서 청사진 회전 불가)', '50_ui.js',
     b"  on('btnRotate', function () { rotateAction(); renderBuildList(); });",
     b"  on('btnRotate', function () { toolDir = dirCW(toolDir); renderBuildList(); });",
     ['mobile.blueprintRotateWithoutKeyboard'], 'mobile.js'),

    # ---- 결정론 (determinism.js 로 판정) ----
    # 이 한 줄이 없어서 40분 완주 주행이 주행마다 다른 결과를 냈다. 리셋이 되돌리지
    # 않는 상태가 하나만 있어도, 페이지가 열리고 리셋되기까지 실시간으로 돈 시간이
    # 그대로 출발점의 차이가 된다. 되돌리기를 지우면 그 결함이 그대로 돌아온다.
    ('리셋이 오염 확산 타이머를 안 되돌린다', '10_world.js',
     b'  pollTimer = 0;',
     b'  pollTimer = pollTimer;',
     ['det.resetClearsPriorRun'], 'determinism.js'),

    # ---- 부하 차단 (shedding.js 로 판정) ----
    # 순진한 배선이 실제로 떨리는지는 boolean 이 아니라 **횟수**로만 볼 수 있다.
    # 주의: powerStats.sat(=G.state().power.sat)은 nt.sat 이 아니라 전세계 합계에서
    # 따로 계산된다(30_power.js:186). 그래서 nt.sat 을 깨도 shed.deficitExists 는
    # 안 뒤집힌다(MISS 로 확인). 망별 sat 을 읽는 것은 [전력 만족도] 노드 쪽이다.
    ('망별 전력 만족도가 항상 100% (제어기가 부족을 못 본다)', '30_power.js',
     b'    nt.sat = nt.demand <= 0 ? 1 : Math.min(1, nt.supplyCap / nt.demand);',
     b'    nt.sat = 1;',
     ['shed2.comparatorOscillates'], 'shedding.js'),

    ('꺼진 기계도 계속 전기를 먹는다 (부하 차단이 무의미해진다)', '30_power.js',
     b'  if (!e.enabled) return 0;',
     b'  if (false) return 0;',
     ['shed2.comparatorOscillates'], 'shedding.js'),

    # 여기에 'SR 래치를 비교기로 바꾼다' 돌연변이를 넣었다가 MISS 가 났고, 빼는 것이
    # 옳다고 판단했다. 이유: 제대로 설계된 히스테리시스는 **차단 후 값이 밴드 안에
    # 떨어지도록** 문턱을 잡는다(82.9% → RESET(<90) → 차단 → 96.8% < SET(98)).
    # 그 조건에서는 기억을 잃은 비교기도 같은 답(꺼짐)을 내므로 이 리그로는 구별이
    # 안 된다. 래치의 기억 자체는 driver.js 의 logic.hysteresisHolds 가 돌연변이로
    # 검정하고 있으므로 중복 커버가 아니라 **적절한 위치에서** 검정되는 것이다.
    # shed.latchSettles 는 돌연변이 검정된 게이트가 아니라 **관측치**로 읽어야 한다.

    # ---- 전력망 밖 제어기 경고 ----
    ('전력망 밖 제어기 경고를 없앤다', '55_logicui.js',
     b"    if (g.nodes[i].kind === 'power') { offGrid = !!curCtrl && curCtrl.net < 0; break; }",
     b'    if (false) { offGrid = true; break; }',
     ['ui.offGridControllerWarns'], 'uismoke.js'),

    # 항상 뜨는 경고는 경고가 아니라 배경이다
    ('망에 붙은 제어기에도 경고를 띄운다', '55_logicui.js',
     b'offGrid = !!curCtrl && curCtrl.net < 0;',
     b'offGrid = true;',
     ['ui.onGridControllerQuiet'], 'uismoke.js'),

    # ---- 제어기: 사용자가 걸린 함정들 ----
    # [기계 가동/정지] 는 입력이 참이면 '돌려라' 다. 사용자도 나도 여기서 틀렸다.
    # 그래서 노드가 지금 하는 일을 스스로 말하게 했다. 그 문장이 값을 안 따라가면
    # 아무것도 알려주지 않는 장식이다.
    #
    # 주의: 앵커는 **ASCII 조각만** 쓴다. b"" 리터럴에 한국어를 넣으면 이 파일이
    # 아예 파싱되지 않는다 (한 번 그렇게 깨뜨렸다).
    ('출력 노드 해석 줄이 값을 안 따라간다', '55_logicui.js',
     b'  var on = truthy(v);',
     b'  var on = true;',
     ['ui.outputNodeFollowsTheValue'], 'uismoke.js'),

    # 앵커가 소스를 두 번 따라가지 못해 조용히 INVALID 로 빠져 있었다 —
    # `!who` 는 표시용 함수를 술어로 쓰던 옛 코드고, 지금은 대상 자체를 본다.
    # 앵커가 사라진 돌연변이는 '검정한 척'이라 잡을 때마다 현재 코드로 옮긴다.
    ('대상이 비어도 경고하지 않는다', '55_logicui.js',
     b"  if (!noEnt && !entities[n.cfg.ent]) {",
     b'  if (false) {',
     ['ui.outputNodeWarnsNoTarget'], 'uismoke.js'),

    # 뒤에 오는 노드 이름('gate')까지 붙여야 유일해진다 — 같은 filter 배열이
    # 'machine' 노드에도 쓰이기 때문이다.
    ('[기계 가동/정지] 가 반응하지 않는 건물까지 고르게 한다', '35_logic.js',
     b"'inserter'] }] },\n  'gate'",
     b"'inserter', 'wall', 'pole'] }] },\n  'gate'",
     ['ctrl.enableTargetsOnlyResponsive']),

    ('제어기 충돌을 기록하지 않는다', '35_logic.js',
     b'    target.logicConflict = axis',
     b'    target.__dropped = axis',
     ['ctrl.conflictIsReported']),

    # 늘 충돌이라고 하면 경고가 아니라 배경이다
    ('제어기가 하나여도 충돌이라고 한다', '35_logic.js',
     b'  if (prev && prev !== ctrl.id) {',
     b'  if (true) {',
     ['ctrl.noConflictWhenSingle']),

    # ---- 감사에서 나온 것들 ----
    # 배선 없는 출력 노드가 대상을 붙잡고 0(정지)을 강제하던 것. 노드를 놓고
    # 대상만 고른 순간 기계가 멈췄다 — 사용자가 겪은 증상의 유력 후보다.
    ('배선 없는 출력 노드가 다시 대상을 지배한다', '35_logic.js',
     b'      if (!inputFed(g, n, 0)) break;\n      var te = entities[n.cfg.ent];',
     b'      var te = entities[n.cfg.ent];',
     ['ctrl.unwiredOutputDoesNotSeize']),

    # 반대로 아예 안 먹으면 그것도 결함이다 (음성 대조군 쪽)
    ('배선을 해도 출력 노드가 지배하지 않는다', '35_logic.js',
     b'  return !!(g.inLinks && g.inLinks[n.nid',
     b'  return false && !!(g.inLinks && g.inLinks[n.nid',
     ['ctrl.wiredOutputDoesSeize']),

    # HUD 가 이름으로 중복을 지우므로 기본 이름이 같으면 두 번째가 사라진다
    ('램프·표시의 기본 이름이 다시 겹친다', '35_logic.js',
     b"('\xea\xb0\x92 #' + n.nid)",
     b"'\xea\xb0\x92'",
     ['ctrl.displaysGetDistinctNames']),

    ('컴파일 전 그래프에서 입력을 읽으면 던진다', '35_logic.js',
     b'  if (!g.inLinks) return 0;',
     b'  if (false) return 0;',
     ['ctrl.readBeforeCompileIsSafe']),

    # ---- HIGH 2건: 감사가 찾고 실측으로 확정한 것 ----
    # 평가 순서가 노드 생성 순서에 달려 있으면 화면상 같은 회로가 다르게 돈다.
    # 좌표순 정렬을 걷어내면 다시 생성 순서로 돌아간다.
    ('평가 순서를 다시 노드 생성 순서로 돌린다', '35_logic.js',
     b'  var roots = g.nodes.slice().sort(cmpNode);',
     b'  var roots = g.nodes.slice();',
     ['ctrl.orderIndependentOfCreation']),

    # 좌표를 아예 안 보면 '배치를 바꿔도 순서가 안 바뀐다' 쪽으로 깨진다
    ('좌표를 무시하고 nid 로만 정렬한다', '35_logic.js',
     b'    return (A[0] - B[0]) || (A[1] - B[1]) || (A[2] - B[2]);',
     b'    return A[2] - B[2];',
     ['ctrl.orderFollowsLayout']),

    # 전력 노드의 출구가 전역 합계로 돌아가면 제어기가 남의 발전소를 본다
    ('전력 노드 출구를 다시 전 세계 합계로', '35_logic.js',
     b'      n.out[1] = Math.round(np.supply);',
     b'      n.out[1] = Math.round(powerStats.supply);',
     ['ctrl.powerOutputsAreNetLocal']),

    ('망 밖인지를 알려주지 않는다', '35_logic.js',
     b'      n.out[4] = np.connected;',
     b'      n.out[4] = 1;',
     ['ctrl.powerReportsDisconnection']),

    # 여유kW 를 만족% 처럼 클램프하면 부하 차단에 쓸 사공간이 다시 사라진다
    ('여유kW 를 0 에서 잘라 버린다', '30_power.js',
     b'           head: nt.supplyCap - nt.demand };',
     b'           head: Math.max(0, nt.supplyCap - nt.demand) };',
     ['shed2.headroomIsUnclamped'], 'shedding.js'),

    # 래치만으로는 못 막힌다는 것 자체가 측정치다 — 측정기가 살아 있는지 본다
    ('전력 만족도를 항상 100 으로 (부족이 사라진다)', '30_power.js',
     b'    nt.sat = nt.demand <= 0 ? 1 : Math.min(1, nt.supplyCap / nt.demand);',
     b'    nt.sat = 1;',
     ['shed2.comparatorOscillates'], 'shedding.js'),

    # 튜토리얼이 가르치는 회로(여유kW+래치+타이머)가 실제로 멈추는지
    ('타이머가 펄스를 안 낸다 (복귀 지연이 사라진다)', '35_logic.js',
     b'      var per = Math.max(0.05, +n.cfg.period || 1);',
     b'      var per = 0.05;',
     ['shed2.tutorialCircuitSettles'], 'shedding.js'),

    # ---- 감사 6건: 편집기가 거짓말하던 것들 ----
    # 1틱 펄스는 값 표본으로 못 잡는다. 발화 횟수 계수를 걷어내면 다시 안 보인다.
    ('펄스 발화 횟수를 안 센다', '35_logic.js',
     b'      if (fn.out[fp] >= TRUE_EPS && fn.prev[fp] < TRUE_EPS) fn.fires[fp]++;',
     b'      if (false) fn.fires[fp]++;',
     ['ctrl.pulseCountedNotSampled']),

    # 반대로 아무 때나 세면 '안 도는 노드도 발화' 가 된다
    ('멈춰 있는 노드까지 발화로 센다', '35_logic.js',
     b'      if (fn.out[fp] >= TRUE_EPS && fn.prev[fp] < TRUE_EPS) fn.fires[fp]++;',
     b'      if (true) fn.fires[fp]++;',
     ['ctrl.idleNodeNeverFires']),

    # 정지시킨 채광기가 버퍼를 계속 벨트로 밀어내던 것
    ('정지한 채광기가 다시 벨트로 밀어낸다', '25_entity.js',
     b'  if (!e.enabled || e.powerSat <= 0) { e.working = false; e.stallT += dt; return; }',
     b'  if (!e.enabled || e.powerSat <= 0) { e.working = false; e.stallT += dt; pushToFront(e); return; }',
     ['ctrl.stoppedMinerStopsFeeding']),

    # 참/거짓 문턱
    ('참 문턱을 0 초과로 되돌린다', '35_logic.js',
     b'function truthy(v) { return v >= TRUE_EPS; }',
     b'function truthy(v) { return v > 0; }',
     ['ctrl.truthThresholdIsHalf']),

    # ---- 편집기 UI (uismoke.js 로 판정) ----
    ('배선 표적을 다시 9px 도트로 좁힌다', '55_logicui.js',
     b"  var outs = el.querySelectorAll('.port.out[data-out]');",
     b"  var outs = el.querySelectorAll('.dot[data-out]');",
     ['ui.wiringWorksOnLabel'], 'uismoke.js'),

    ('되먹임 표시를 다시 한 편집 뒤처지게', '55_logicui.js',
     b'  if (curCtrl && curCtrl.graph && curCtrl.graph.dirty) graphCompile(curCtrl.graph);',
     b'  if (false) graphCompile(curCtrl.graph);',
     ['ui.feedbackShownImmediately'], 'uismoke.js'),

    ('제어기를 바꿔도 편집기 화면을 안 되돌린다', '55_logicui.js',
     b'  if (switching) { gpan.x = 20; gpan.y = 20; gpan.z = 1; }',
     b'  if (false) { gpan.x = 20; gpan.y = 20; gpan.z = 1; }',
     ['ui.editorViewResetsOnSwitch'], 'uismoke.js'),

    # 매번 초기화하면 노드를 옮겨 가며 작업할 수가 없다
    ('같은 제어기를 다시 열 때도 화면을 초기화한다', '55_logicui.js',
     b'  var switching = (curCtrl !== e);',
     b'  var switching = true;',
     ['ui.editorViewKeptOnSameCtrl'], 'uismoke.js'),

    # ---- 모바일·터치 (mobile.js 로 판정, chromium+mobile 기기) ----
    # 인스펙터 안의 조작 — 레시피를 못 고르면 폰에서 공장이 자라지 않는다
    ("드롭다운을 다시 손가락보다 작게 만든다", "shell.html",
     "  .panel select,.panel input{min-height:44px;font-size:14px}".encode("utf-8"),
     "  .panel select,.panel input{min-height:24px;font-size:11px}".encode("utf-8"),
     ["mobile.tapTargetsBigEnough"], "mobile.js"),

    ("레시피 드롭다운이 고른 값을 안 적용한다", "50_ui.js",
     "    e.recipe = rs.value || null; e.progress = 0;".encode("utf-8"),
     "    e.progress = 0;".encode("utf-8"),
     ["mobile.inspectorRecipeCanBeChosen"], "mobile.js"),

    # 계기 칸을 다시 넓히면 마지막 칸([프레임])이 화면 밖으로 밀린다
    ("상단 계기 칸을 다시 넓혀 마지막 칸을 밀어낸다", "shell.html",
     "  #top .stat{min-width:0;padding:3px 4px 4px;flex:1 1 0}".encode("utf-8"),
     "  #top .stat{min-width:56px;padding:4px 6px 5px}".encode("utf-8"),
     ["mobile.allGaugesVisibleWithoutScrolling"], "mobile.js"),

    # 성능 — 화면 밖까지 그리기 시작하면 폰에서 프레임이 무너진다
    ("보이는 범위를 지도 전체로 넓힌다 (화면 밖까지 그린다)", "45_render.js",
     "    x0: Math.max(0, Math.floor(cam.x - halfW) - 1), x1: Math.min(W - 1, Math.ceil(cam.x + halfW) + 1),".encode("utf-8"),
     "    x0: 0, x1: W - 1,".encode("utf-8"),
     ["mobile.frameCostFitsBudget"], "mobile.js"),

    # 같은 안내가 쌓여 판을 덮었다 (실기 스크린샷 · 녹화 프레임 둘 다)
    ("같은 안내를 합치지 않고 계속 쌓는다", "50_ui.js",
     "  if (last && last.getAttribute('data-msg') === msg) {".encode("utf-8"),
     "  if (false) {".encode("utf-8"),
     ["mobile.repeatedToastsCoalesce"], "mobile.js"),

    ("다른 안내까지 한 줄로 합쳐 버린다", "50_ui.js",
     "  if (last && last.getAttribute('data-msg') === msg) {".encode("utf-8"),
     "  if (last) {".encode("utf-8"),
     ["mobile.differentToastsStaySeparate"], "mobile.js"),

    ("안내를 튜토리얼 판 위로 안 올린다", "shell.html",
     "  #toast{bottom:calc(64px + var(--safe-b) + var(--tutor-h, 0px));left:8px;right:8px;".encode("utf-8"),
     "  #toast{bottom:120px;left:8px;right:8px;".encode("utf-8"),
     ["mobile.toastsDoNotCoverTutorial"], "mobile.js"),

    # 청사진은 마우스 경로에만 있었다 — 폰에서는 담기도 붙여넣기도 안 됐다
    ("청사진 담기를 손가락으로 못 한다", "50_ui.js",
     "    if (bpMode === 'sel') { tch.mode = 'bpsel'; bpSelStart = { x: hoverT.x, y: hoverT.y }; return; }".encode("utf-8"),
     "    if (false) { tch.mode = 'bpsel'; bpSelStart = { x: hoverT.x, y: hoverT.y }; return; }".encode("utf-8"),
     ["mobile.blueprintCaptureByDrag"], "mobile.js"),

    ("청사진을 손가락으로 못 붙인다", "50_ui.js",
     "    else if (tch.mode === 'bppaste') { blueprintClickAt(hoverT.x, hoverT.y); }".encode("utf-8"),
     "    else if (tch.mode === 'bppaste') { /* 아무것도 안 한다 */ }".encode("utf-8"),
     ["mobile.blueprintPasteByTap"], "mobile.js"),

    # 편집기 판은 6000px 인데 폰 화면은 390px 다. 배경을 끌어 옮기는 길이 막히면
    # 오른쪽에 놓인 노드는 영영 못 만진다.
    ("노드 편집기 화면을 손가락으로 못 옮긴다", "55_logicui.js",
     "      gt.mode = 'pan'; gt.lx = ev.touches[0].clientX; gt.ly = ev.touches[0].clientY;".encode("utf-8"),
     "      gt.mode = null; gt.lx = ev.touches[0].clientX; gt.ly = ev.touches[0].clientY;".encode("utf-8"),
     ["mobile.logicGraphPansToFarNodes"], "mobile.js"),

    # 녹화 영상이 드러낸 것 — 제어기 계기 줄이 화면 밖으로 잘렸다
    ("계기 줄을 다시 가운데 정렬 무제한으로 (양옆이 잘린다)", "shell.html",
     "  #dispRow{left:0;right:0;transform:none;width:100%;max-width:100%;".encode("utf-8"),
     "  #dispRow_off{left:0;right:0;transform:none;width:100%;max-width:100%;".encode("utf-8"),
     ["mobile.displayRowFitsOnScreen"], "mobile.js"),

    # 실기 4차 제보 — 손끝이 칸을 가리는데 닿는 즉시 지어져 원치 않는 자리에 계속 지어졌다
    ("닿는 즉시 짓는다 (손 떼기 전에 이미 놓인다)", "50_ui.js",
     "      if (LINE_TOOLS[tool]) { tch.mode = 'build'; mouse.down = true; dragLast = null; dragPlace(); }".encode("utf-8"),
     "      if (true) { tch.mode = 'build'; mouse.down = true; dragLast = null; dragPlace(); }".encode("utf-8"),
     ["mobile.holdToAimThenReleasePlaces"], "mobile.js"),

    ("손을 떼도 안 짓는다 (자리만 잡고 끝난다)", "50_ui.js",
     "    else if (tch.mode === 'aim') { dragLast = null; dragPlace(); }".encode("utf-8"),
     "    else if (tch.mode === 'aim') { dragLast = null; }".encode("utf-8"),
     ["mobile.holdToAimThenReleasePlaces"], "mobile.js"),

    ("벨트까지 떼야 깔리게 만든다 (줄로 못 깐다)", "50_ui.js",
     "  var LINE_TOOLS = { belt: 1, rail: 1, pipe: 1 };".encode("utf-8"),
     "  var LINE_TOOLS = {};".encode("utf-8"),
     ["mobile.beltStillLaysOnTouch"], "mobile.js"),

    # 실기 3차 제보 — 연구 판이 상단 계기를 덮었고, 튜토리얼을 닫으면 못 돌아왔다.
    ("시트 높이를 다시 62vh 로 (상단 계기를 덮는다)", "shell.html",
     # dvh 짝이 뒤에 오므로 **두 줄을 함께** 바꿔야 실제 높이가 바뀐다.
     # 앞줄만 62vh 로 돌렸더니 뒤의 dvh 가 덮어써서 아무 일도 안 일어났다(MISS).
     ("    max-height:calc(100vh - 56px - 52px - var(--tutor-h, 0px) - var(--safe-t) - var(--safe-b));" + chr(10) +
      "    max-height:calc(100dvh - 56px - 52px - var(--tutor-h, 0px) - var(--safe-t) - var(--safe-b));").encode("utf-8"),
     ("    max-height:62vh;" + chr(10) + "    max-height:62dvh;").encode("utf-8"),
     ["mobile.sheetsKeepTopBarVisible"], "mobile.js"),

    ("튜토리얼을 닫아도 되돌아올 손잡이를 안 띄운다", "52_tutorial.js",
     "  document.body.classList.toggle('tutor-off', !tutorial.on && !tutorial.done);".encode("utf-8"),
     "  document.body.classList.toggle('tutor-off', false);".encode("utf-8"),
     ["mobile.tutorialCanBeReopened"], "mobile.js"),

    # 실기 2차 제보 — 연구 판이 데스크톱 대화상자로 남아 있었고, 고른 도구를 푸는 길이
    # 폰에 없었다.
    ("연구 판을 좁은 화면 시트에서 뺀다 (데스크톱 660px 대화상자가 되살아난다)", "shell.html",
     "  #help,#tech{".encode("utf-8"),
     "  #help,#tech_off{".encode("utf-8"),
     ["mobile.techPanelFitsOnScreen"], "mobile.js"),

    ("고른 도구를 그만두는 칩을 안 띄운다", "50_ui.js",
     "  document.body.classList.toggle('tool-on', on);".encode("utf-8"),
     "  document.body.classList.toggle('tool-on', false);".encode("utf-8"),
     ["mobile.canCancelSelectedTool"], "mobile.js"),

    ("같은 것을 다시 눌러도 안 풀린다", "50_ui.js",
     "  if (t && t === tool) t = null;".encode("utf-8"),
     "  if (false) t = null;".encode("utf-8"),
     ["mobile.reTapDeselects"], "mobile.js"),

    # 실기 스크린샷이 드러낸 것들 — 게이트가 이제 잡는지 확인한다.
    # (문자열에 개행을 넣을 때는 chr(10) 을 쓴다. 백슬래시-n 을 이 파일에 직접 적으면
    #  편집 경로에서 진짜 개행으로 바뀌어 문법 오류가 났다 — 세 번 반복했다.)
    # 좁은 화면용 #help 규칙 자체를 무력화한다 → 데스크톱 규칙(680px 가운데 정렬)이
    # 되살아나고, 그게 실기에서 화면 밖 왼쪽 145px 로 나간 바로 그 상태다.
    ("좁은 화면용 시트 규칙을 통째로 없앤다 (데스크톱 대화상자가 되살아난다)", "shell.html",
     ("  #help,#tech{" + chr(10) + "    position:fixed;left:0;right:0;bottom:calc(56px").encode("utf-8"),
     ("  #help_off,#tech_off{" + chr(10) + "    position:fixed;left:0;right:0;bottom:calc(56px").encode("utf-8"),
     ["mobile.helpFitsOnScreenWhenOpen", "mobile.techPanelFitsOnScreen"], "mobile.js"),

    ("손가락 화면 규칙이 좁은 화면 시트 높이까지 덮는다", "shell.html",
     ("  @media (min-width: 721px){" + chr(10) +
      "    #build,#right{max-height:calc(100vh - 72px);max-height:calc(100dvh - 72px)}" + chr(10) + "  }").encode("utf-8"),
     "  #build,#right{max-height:calc(100vh - 72px);max-height:calc(100dvh - 72px)}".encode("utf-8"),
     ["mobile.openSheetKeepsTopBarVisible"], "mobile.js"),

    # 앵커는 **유일해야 한다.** 처음엔 bottom:calc(...) 한 줄만 잡았다가 #build 무리와
    # #help 두 곳에 걸려 INVALID 가 났다. 선택자까지 포함해 한 곳으로 못 박는다.
    ("튜토리얼 높이를 건설 시트에 안 알려 준다 (둘이 같은 자리에 겹친다)", "shell.html",
     ("  #build,#right,#insp{" + chr(10) + "    position:fixed;left:0;right:0;bottom:calc(56px + var(--tutor-h, 0px))").encode("utf-8"),
     ("  #build,#right,#insp{" + chr(10) + "    position:fixed;left:0;right:0;bottom:56px").encode("utf-8"),
     ["mobile.openSheetDoesNotCoverTutorial"], "mobile.js"),

    # 홈화면 설치 — 재료가 하나만 빠져도 "설치했더니 브라우저 껍데기 그대로" 가 된다
    ("매니페스트를 브라우저 탭 모드로 되돌린다", "build.py",
     "'display': 'standalone',".encode("utf-8"),
     "'display': 'browser',".encode("utf-8"),
     ["mobile.manifestIsInstallable"], "mobile.js"),

    ("아이콘을 192 가 아닌 크기로 넣는다", "build.py",
     "i192, i512 = make_icon.data_uri(192), make_icon.data_uri(512)".encode("utf-8"),
     "i192, i512 = make_icon.data_uri(128), make_icon.data_uri(512)".encode("utf-8"),
     ["mobile.appleTouchIconIsRealPng"], "mobile.js"),

    ("전체화면 메타를 뺀다", "shell.html",
     '<meta name="apple-mobile-web-app-capable" content="yes">'.encode("utf-8"),
     '<meta name="apple-mobile-web-app-capable" content="no">'.encode("utf-8"),
     ["mobile.standaloneMetaPresent"], "mobile.js"),

    ("노치 여백을 상단 계기에 안 준다", "shell.html",
     "       padding-top:var(--safe-t);".encode("utf-8"),
     "       padding-top:0;".encode("utf-8"),
     ["mobile.safeAreaPushesContentIn"], "mobile.js"),

    ('캔버스가 터치를 아예 안 받는다', '50_ui.js',
     b"  canvas.addEventListener('touchstart', function (ev) {",
     b"  canvas.addEventListener('__nope', function (ev) {",
     ['mobile.tapPlacesBuilding', 'mobile.dragPlacesBelts'], 'mobile.js'),

    ('한 손가락 이동이 안 된다', '50_ui.js',
     b"    else { tch.mode = 'pan'; }",
     b"    else { tch.mode = null; }",
     ['mobile.oneFingerPans'], 'mobile.js'),

    ('두 손가락 핀치를 무시한다', '50_ui.js',
     b"    if (tch.mode === 'pinch' && ev.touches.length >= 2) {",
     b'    if (false) {',
     ['mobile.pinchZooms'], 'mobile.js'),

    # 탭 문턱을 0 으로 두면 손가락 흔들림이 전부 드래그로 읽혀 선택이 안 된다
    ('탭 문턱을 0 으로 (손가락 흔들림을 드래그로 읽는다)', '50_ui.js',
     b'    var TAP = 12;',
     b'    var TAP = 0;',
     ['mobile.tapOpensInspector'], 'mobile.js'),

    ('노드 편집기가 터치 배선을 안 받는다', '55_logicui.js',
     b"    outs[k].addEventListener('touchstart', (function (nid, port) {",
     b"    outs[k].addEventListener('__nope', (function (nid, port) {",
     ['mobile.logicWiringByTouch'], 'mobile.js'),

    ('노드를 손가락으로 못 끈다', '55_logicui.js',
     b"  head.addEventListener('touchstart', function (ev) {",
     b"  head.addEventListener('__nope', function (ev) {",
     ['mobile.logicNodeDragByTouch'], 'mobile.js'),

    # 이 게이트는 처음에 "버튼이 보이는가" 만 봐서 MISS 가 났다 — 손잡이를 떼도
    # 버튼은 그대로 보였기 때문이다. 지금은 눌러서 방향이 바뀌는지로 판정한다.
    ('회전 버튼의 손잡이를 뗀다 (버튼은 남고 아무 일도 안 한다)', '50_ui.js',
     b"  on('btnRotate', function () { rotateAction(); renderBuildList(); });",
     b"  on('__nope', function () { rotateAction(); renderBuildList(); });",
     ['mobile.rotateWithoutKeyboard', 'mobile.blueprintRotateWithoutKeyboard'], 'mobile.js'),

    # 폰에는 우클릭이 없다 — 철거가 막히면 잘못 놓은 건물을 영영 못 지운다
    ('철거 모드가 아무것도 안 부순다', '50_ui.js',
     b'  if (demolishMode) { rightClickAction(); renderInv(); return; }',
     b'  if (false) { rightClickAction(); renderInv(); return; }',
     ['mobile.demolishWithoutRightClick'], 'mobile.js'),

    # 늘 부수는 모드는 모드가 아니라 사고다
    ('철거 모드가 꺼져도 계속 부순다', '50_ui.js',
     b'  demolishMode = !!on;',
     b'  demolishMode = true;',
     ['mobile.demolishOffKeepsBuilding'], 'mobile.js'),

    ('완료 화면에 심화 버튼을 안 단다', '52_tutorial.js',
     b'        \'<button id="tutorAdv" style="width:100%">',
     b'        \'<button id="tutorNope" style="width:100%">',
     ['ui.advButtonAppearsWhenDone'], 'uismoke.js'),

    ('가져오기가 원본을 안 비운다 (복제)', '25_entity.js',
     b'  drain(e.inv); e.inv = {};',
     b'  drain(e.inv);',
     ['stock.takeDoesNotDuplicate']),

    ('넣기가 보유 자재를 안 깎는다 (복제)', '25_entity.js',
     b'      if (!giveTo(e, k)) break;\n      invTake(inventory, k, 1);',
     b'      if (!giveTo(e, k)) break;',
     ['stock.putDoesNotDuplicate']),

    # 실제로 걱정되는 버그는 "넣기 경로가 제 나름의 규칙을 따로 쓰는 것"이다.
    # giveTo 를 건너뛰고 e.inv 에 직접 밀어 넣으면 버퍼 한도도, 레시피 입력 판정도
    # 통째로 사라져서 버튼 한 번에 보유 자재 전부가 기계 하나로 빨려 들어간다.
    #
    # 한쪽만 지우면 MISS 가 난다 — while 조건과 giveTo 가 **둘 다** canAccept 를 보는
    # 이중 방어라서, canAccept 를 하나 지워도 나머지 하나가 그대로 막는다. 그 둘을
    # 각각 지운 돌연변이 2종을 실제로 돌려 보고 확인했다. 그래서 여기서는 "순진한
    # 구현" 통째로 — 재고를 훑어 기계 버퍼에 그냥 밀어 넣는 형태로 바꾼다.
    ('넣기를 순진한 구현으로 되돌린다 (한도·품목 판정 없이 전부 밀어 넣기)', '25_entity.js',
     b'    while ((inventory[k] || 0) > 0 && gave < cap && canAccept(e, k) && guard++ < 20000) {\n'
     b'      if (!giveTo(e, k)) break;',
     b'    while ((inventory[k] || 0) > 0 && guard++ < 20000) {\n'
     b'      invAdd(e.inv, k, 1);',
     ['stock.putRespectsBufferCap', 'stock.putRejectsWrongItem']),

    ('넣기 대상에 상자를 넣는다 (전 재고가 상자로 빨려간다)', '25_entity.js',
     b"var PUT_TYPES = { generator: 1, boiler: 1, turret: 1, lab: 1, furnace: 1, assembler: 1 };",
     b"var PUT_TYPES = { generator: 1, boiler: 1, turret: 1, lab: 1, furnace: 1, assembler: 1, chest: 1 };",
     ['stock.chestIsNotAPutTarget']),

    # ---- UI 경로 (uismoke.js 로 판정) ----
    ('기계에 넣는 버튼을 없앤다', '50_ui.js',
     b'    if (PUT_TYPES[e.type]) {',
     b'    if (false) {',
     ['ui.putButtonExists'], 'uismoke.js'),

    # b"" 리터럴은 ASCII 만 담을 수 있어 한국어가 없는 조각으로 앵커를 잡는다
    ('넣기 버튼이 넣을 게 없어도 활성이다', '50_ui.js',
     b"(puttable.length ? '' : ' disabled')",
     b"('')",
     ['ui.putButtonDisabledWhenNothingFits'], 'uismoke.js'),

    ('멈춘 기계가 왜 멈췄는지 말하지 않는다', '50_ui.js',
     b"  if ((e.type === 'assembler' || e.type === 'furnace') && e.recipe) {",
     b'  if (false) {',
     ['ui.idleMachineSaysWhy'], 'uismoke.js'),

    # 항상 뜨는 경고는 경고가 아니라 배경이다 — 진짜로 멈춘 기계를 오히려 가린다
    ('정지 이유를 재료가 차 있어도 항상 띄운다', '50_ui.js',
     b'      if ((e.inv[mk] || 0) < rec.inp[mk])',
     b'      if (true)',
     ['ui.runningMachineSaysNothing'], 'uismoke.js'),

    ('상자에서 꺼내는 버튼을 없앤다', '50_ui.js',
     b"    if (e.type !== 'generator' && e.type !== 'turret' && (e.inv || e.out)) {",
     b'    if (false) {',
     ['ui.takeButtonExists'], 'uismoke.js'),

    ('단축키를 다시 목록 순서로 매긴다', '50_ui.js',
     b'      var hit = buildIdForKey(k);',
     b"      var hit = visibleBuildIds()[k === '0' ? 9 : (parseInt(k, 10) - 1)];",
     ['ui.hotkeyMatchesLabel'], 'uismoke.js'),

    ('인스펙터를 매 갱신마다 통째로 다시 그린다', '50_ui.js',
     b'  if (sig !== lastInspSig) {',
     b'  if (true) {',
     ['ui.inspectorSelectSurvivesRefresh'], 'uismoke.js'),

    ('입력 요소에서 올라온 키도 단축키로 먹는다', '50_ui.js',
     b"    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName || '') && ev.key !== 'Escape') return;",
     b"    if (false) return;",
     ['ui.keysIgnoredWhileTyping'], 'uismoke.js'),

    # ---- 평활 필터 · 상태기계 · 신호 버스 ----
    # 오일러 근사는 **계단응답으로는 안 걸린다** — τ 시점 오차가 0.0006 이라 오라클
    # 허용치 안에 든다. dt 를 어떻게 쪼개도 같은가를 묻는 게이트만 이걸 잡는다.
    ('평활 필터가 지수해 대신 오일러 근사를 쓴다', '35_logic.js',
     b'        n.state.y += (xs - n.state.y) * (1 - Math.exp(-dt / tau));',
     b'        n.state.y += (xs - n.state.y) * (dt / tau);',
     ['smooth.dtInvariant']),

    ('평활 필터가 아무것도 안 눅인다 (항상 통과)', '35_logic.js',
     b'      if (tau <= 0) n.state.y = xs;',
     b'      if (tau >= 0) n.state.y = xs;',
     ['smooth.stepResponseMatchesAnalytic']),

    ('상태기계가 상승엣지가 아니라 레벨로 전이한다', '35_logic.js',
     b'        if (t4 === n.state.s - 1 && cur4 && !n.state.pe[t4]) fired = true;',
     b'        if (t4 === n.state.s - 1 && cur4) fired = true;',
     ['fsm.advancesOnceWhileHeld']),

    ('상태기계에서 전이가 리셋을 이긴다', '35_logic.js',
     b'      if (rstF) n.state.s = 1;',
     b'      if (fired) n.state.s = (n.state.s % 4) + 1;\n      else if (rstF) n.state.s = 1;\n      else if (false) n.state.s = 1;',
     ['fsm.resetDominates']),

    ('상태기계의 단계 출구가 전부 켜진다', '35_logic.js',
     b'      for (var q4 = 1; q4 <= 4; q4++) n.out[q4] = (n.state.s === q4) ? 1 : 0;',
     b'      for (var q4 = 1; q4 <= 4; q4++) n.out[q4] = 1;',
     ['fsm.oneHotOutputs']),

    ('신호 버스가 합산하지 않고 마지막 값으로 덮어쓴다', '35_logic.js',
     b'  busNext[ch] = (busNext[ch] || 0) + v;',
     b'  busNext[ch] = v;',
     ['bus.sumsWriters']),

    ('신호 버스를 같은 틱에 읽는다 (평가 순서에 의존하게 된다)', '35_logic.js',
     b"    case 'busrecv': n.out[0] = busRead(n.cfg.ch); break;",
     b"    case 'busrecv': n.out[0] = (busNext[n.cfg.ch] !== undefined) ? busNext[n.cfg.ch] : busRead(n.cfg.ch); break;",
     ['bus.readsPreviousTick']),

    ('신호 버스를 틱마다 비우지 않는다 (값이 눈덩이처럼 쌓인다)', '35_logic.js',
     b'function busSwap() { busNow = busNext; busNext = {}; }',
     b'function busSwap() { busNow = busNext; }',
     ['bus.readsPreviousTick']),

    ('저장이 신호 버스를 안 담는다', '60_game.js',
     b'    bus: busSnapshot(),',
     b'    bus: {},',
     ['bus.survivesSave']),

    ('새 노드가 연구 전에도 팔레트에서 풀린다', '35_logic.js',
     b'  return !d.tech || !!techDone[d.tech];',
     b'  return true;',
     ['ui.newNodesLockedBeforeTech'], 'uismoke.js'),

    # ---- 적대적 리뷰가 잡은 자리들 (게이트를 메운 뒤 그 게이트들을 역검정한다) ----
    ('평활 필터가 배선 전에 0 으로 씨앗을 박는다', '35_logic.js',
     b'      if (!inputFed(g, n, 0)) { delete n.state.y; n.out[0] = 0; break; }',
     b'      if (false) { delete n.state.y; n.out[0] = 0; break; }',
     ['smooth.seedsFromRealInputWhenWired']),

    ('상태기계가 4단계에서 멈춘다 (고리가 안 돈다)', '35_logic.js',
     b'      else if (fired) n.state.s = (n.state.s % 4) + 1;',
     b'      else if (fired) n.state.s = Math.min(n.state.s + 1, 4);',
     ['fsm.ringWrapsAtFour']),

    ('상태기계가 현재 단계를 안 보고 아무 입력에나 전이한다', '35_logic.js',
     b'        if (t4 === n.state.s - 1 && cur4 && !n.state.pe[t4]) fired = true;',
     b'        if (cur4 && !n.state.pe[t4]) fired = true;',
     ['fsm.inputsAreStageScoped']),

    # 리셋 우선순위는 그대로 두고 엣지 기억만 지우는 변형이다. 그래서
    # fsm.resetDominates 는 통과한 채로 fsm.resetKeepsEdgeMemory 만 뒤집혀야 한다.
    ('리셋이 엣지 기억까지 지운다', '35_logic.js',
     b'      if (rstF) n.state.s = 1;',
     b'      if (rstF) { n.state.pe = [false, false, false, false]; }\n      if (rstF) n.state.s = 1;',
     ['fsm.resetKeepsEdgeMemory']),

    # 노드 상태를 통째로 안 담는 저장. 예전 게이트는 2단계에서 저장했는데, 상태를
    # 잃은 구현은 1단계로 초기화된 뒤 붙들린 조건에 한 칸 튀어 정확히 2단계에
    # 도착했다 — 두 결함이 상쇄돼 GREEN 이 나왔다. 3단계·조건 내림으로 옮겨 고쳤다.
    ('저장이 노드 상태를 통째로 버린다', '60_game.js',
     b'cfg: n.cfg, st: n.state,',
     b'cfg: n.cfg, st: {},',
     ['fsm.survivesSave']),

    # 단계는 담고 엣지 기억만 버리는 복원. 이건 위 돌연변이가 못 잡는 자리다 —
    # 조건을 내린 채 저장하는 검사는 pe 가 없어도 안 튀기 때문이다.
    ('복원이 상태기계의 엣지 기억만 버린다', '60_game.js',
     b'state: n.st || {}, out: [], prev: []',
     b'state: (n.st ? { s: n.st.s } : {}), out: [], prev: []',
     ['fsm.saveKeepsEdgeMemory']),

    # ---- 문장(규칙) 어휘: 신호 버스 · 눅이기 · 값을 받는 행동 ----
    # 값을 받는 행동이 조건의 참/거짓을 받게 되돌린다. 이게 실제로 출고돼 있던
    # 상태이고, '숫자를 화면에 띄운다' 가 1 을 띄우고 있었다.
    ('값을 받는 행동이 참/거짓을 받는다', '37_rules.js',
     b'  if (ad.value && valNid) {',
     b'  if (false) {',
     ['rule.displayShowsTheNumber']),

    ('문장의 단항이 시간 설정을 무시한다 (그대로 통과)', '37_rules.js',
     b"      sm.cfg[mdef.cfgKey || 'tau'] = +w.math.b || 0;",
     b"      sm.cfg[mdef.cfgKey || 'tau'] = 0;",
     ['rule.smoothCompilesAndFilters']),

    ('문장이 계산 한 단의 연구 관문을 안 본다', '37_rules.js',
     b'  if (mo && mo.tech && !techDone[mo.tech]) return TECHS[mo.tech].name',
     b'  if (false) return TECHS[mo.tech].name',
     ['rule.smoothLocksBehindResearch']),

    ('문장의 채널 선택이 노드에 안 내려간다', '37_rules.js',
     b"  if (s.needs.indexOf('ch') >= 0) src.cfg.ch = w.ch || 'A';",
     b"  if (false) src.cfg.ch = w.ch || 'A';",
     ['rule.busCarriesValueBetweenControllers']),

    ('보내는 행동의 채널이 노드에 안 내려간다', '37_rules.js',
     b"  if (ad.ch) an2.cfg.ch = t.ch || 'A';",
     b"  if (false) an2.cfg.ch = t.ch || 'A';",
     ['rule.busCarriesValueBetweenControllers']),

    # 화면에 계산 한 단을 고를 자리가 없으면, 컴파일러가 지원해도 아무도 못 쓴다.
    ('문장 편집기에서 계산 드롭다운을 뺀다', '57_ruleui.js',
     b"      h.push(selHtml('', 'when.math.op', r.id, mathOpts, (w.math && w.math.op) || ''));",
     b'      h.push(\'\');',
     ['ui.mathDropdownExistsAndCompiles'], 'uismoke.js'),

    ('중간 경로가 없으면 설정이 조용히 사라진다', '57_ruleui.js',
     b'    if (!obj[k]) obj[k] = {};',
     b'    if (!obj[k]) return;',
     ['ui.mathDropdownExistsAndCompiles'], 'uismoke.js'),

    # ---- 유체: 물·증기 ----
    # 매 틱 누적에서 dt 를 빼면 60배가 된다. 오염이 그렇게 60배로 나왔었다(교훈 03).
    ('보일러가 dt 를 안 곱한다 (60배)', '32_fluid.js',
     b'      var want = SPEC.boilerFluid * dt;',
     b'      var want = SPEC.boilerFluid * 1;',
     ['fluid.boilerRateAndFuelMatchSpec']),

    ('펌프가 dt 를 안 곱한다 (60배)', '32_fluid.js',
     b'        var add = SPEC.pumpRate * dt;',
     b'        var add = SPEC.pumpRate;',
     ['fluid.pumpRateMatchesSpec']),

    # 증기 1개 = 30 kJ 항등식을 깬다. 한쪽만 바꿔도 양쪽 게이트가 어긋나야 한다.
    ('보일러가 연료를 덜 태운다 (증기가 공짜가 된다)', '32_fluid.js',
     b'      var kj = SPEC.boilerPower * (lim / want) * dt;',
     b'      var kj = SPEC.boilerPower * (lim / want) * dt * 0.5;',
     ['fluid.energyPerSteamIsThirty']),

    ('증기기관이 증기를 안 쓴다 (영구기관)', '25_entity.js',
     b'  var need = SPEC.engineSteam * e.load * dt;',
     b'  var need = 0;',
     ['fluid.engineDrawsSteamAtSpec']),

    ('증기가 없어도 증기기관이 공급한다', '30_power.js',
     b'        if (engineHasSteam(gen)) net.supplyCap += SPEC.engineOutput;',
     b'        net.supplyCap += SPEC.engineOutput;',
     ['fluid.noSteamNoPower']),

    # 맞닿음이 유체망의 규칙이다. 이걸 깨면 파이프를 지워도 계속 이어져 있다.
    ('철거해도 유체망을 다시 안 짓는다', '25_entity.js',
     b'  markBeltDirty();\n  markPowerDirty();\n  markFluidDirty();\n  markLogicDirty();\n  return true;',
     b'  markBeltDirty();\n  markPowerDirty();\n  markLogicDirty();\n  return true;',
     ['fluid.removingPipeSplitsNet']),

    ('저장이 파이프의 유체를 안 담는다', '60_game.js',
     b"  if (BUILDINGS[e.type] && BUILDINGS[e.type].fluid) { o.fw = e.fw || 0; o.fs = e.fs || 0; }",
     b"  if (false) { o.fw = e.fw || 0; o.fs = e.fs || 0; }",
     ['fluid.survivesSave']),

    ('유체 센서가 망 밖과 빈 망을 같은 값으로 뭉갠다', '32_fluid.js',
     b'  return { connected: 1, water: net.water, steam: net.steam,',
     b'  return { connected: 0, water: net.water, steam: net.steam,',
     ['fluid.sensorReadsTheNet']),

    # ---- 청사진 ----
    # 공짜로 지으면 청사진이 치트가 된다.
    ('붙여넣기가 재료를 안 받는다 (공짜 건설)', '34_blueprint.js',
     b'    var e = placeEntity(it.t, tx + it.dx, ty + it.dy, it.d, false);',
     b'    var e = placeEntity(it.t, tx + it.dx, ty + it.dy, it.d, true);',
     ['bp.pasteChargesMaterials']),

    # 영역 밖 참조를 안 끊으면 붙여넣은 사본이 남의 기계를 지배한다.
    ('영역 밖 참조를 안 끊고 원본을 그대로 가리킨다', '34_blueprint.js',
     b'  var n = idMap[oldId];\n  return (n === undefined) ? null : n;',
     b'  var n = idMap[oldId];\n  return (n === undefined) ? oldId : n;',
     ['bp.outsideReferencesAreCut']),

    # 영역 안 참조까지 끊으면 배선이 따라오지 않는다 — 이 기능의 값 자체가 사라진다.
    ('영역 안 참조도 끊는다 (배선이 안 따라온다)', '34_blueprint.js',
     b'  var it = { srcId: e.id, dx: e.tx - ox, dy: e.ty - oy, t: e.type, d: e.dir };',
     b'  var it = { dx: e.tx - ox, dy: e.ty - oy, t: e.type, d: e.dir };',
     ['bp.wiringFollowsAndRetargets']),

    ('청사진이 내용물까지 복사한다 (복제기)', '34_blueprint.js',
     b"  if (it2.pf) { e2.playerFilter = it2.pf; e2.filter = it2.pf; }",
     b"  if (it2.pf) { e2.playerFilter = it2.pf; e2.filter = it2.pf; }\n    if (it2.t === 'chest') invAdd(e2.inv, 'iron-plate', 500);",
     ['bp.doesNotCopyContents']),

    ('걸친 건물도 청사진에 담는다 (잘린 조각)', '34_blueprint.js',
     b'      if (e.tx < ax || e.ty < ay || e.tx + e.w - 1 > bx || e.ty + e.h - 1 > by) continue;',
     b'      if (false) continue;',
     ['bp.capturesWholeBuildingsOnly']),

    ('저장이 청사진을 안 담는다', '60_game.js',
     b'    bp: blueprint,',
     b'    bp: null,',
     ['bp.survivesSave']),

    ('B 키를 눌러도 청사진 모드가 안 켜진다', '50_ui.js',
     b"    if (k === 'b' || k === 'B') { toggleBlueprint(); return; }",
     b"    if (false) { toggleBlueprint(); return; }",
     ['ui.blueprintKeyAndDragCapture'], 'uismoke.js'),

    # ---- 기차 ----
    ('열차 이동에 dt 를 안 곱한다 (60배)', '36_train.js',
     b'      var adv = SPEC.trainSpeed * dt;',
     b'      var adv = SPEC.trainSpeed;',
     ['train.dtInvariant']),

    # 앵커는 **ASCII 만** 담을 수 있다(bytes 리터럴). 한글이 든 줄은 앞의 ASCII
    # 부분까지만 잡는다 — 처음에 한글째로 썼다가 SyntaxError 로 파일이 안 열렸다.
    ('열차가 규격보다 빠르다', '05_data.js',
     b'  trainSpeed: 8,',
     b'  trainSpeed: 12,',
     ['train.speedMatchesSpec']),

    ('움직이는 열차에도 짐을 싣는다 (텔레포트)', '36_train.js',
     b'  return !!tr && !tr.moving && trainCargo(tr) < SPEC.trainCargoCap && !!itemId;',
     b'  return !!tr && trainCargo(tr) < SPEC.trainCargoCap && !!itemId;',
     ['train.noLoadingWhileMoving']),

    ('싣기가 상자에서 안 빼고 열차에만 더한다 (복제)', '36_train.js',
     b'  invAdd(tr.inv, itemId, 1);\n  return true;',
     b'  invAdd(tr.inv, itemId, 2);\n  return true;',
     ['train.inserterLoadsMovesNotCreates']),

    ('제어기가 붙잡아도 열차가 떠난다', '36_train.js',
     b'      if (curSt.holdTrain) {',
     b'      if (false) {',
     ['train.controllerCanHold']),

    ('역 지배를 매 틱 안 푼다 (유령 지배)', '35_logic.js',
     b'    e.trainCtl = false; e.holdTrain = false;',
     b'    e.holdTrain = false;',
     ['train.releasesControlWhenNodeRemoved']),

    ('끊긴 레일을 건너뛴다 (닿지 않는 역도 목록에 넣는다)', '36_train.js',
     b'    if (!railPath({ x: tr.x, y: tr.y }, rt)) return;',
     b'    if (false) return;',
     ['train.brokenRailStopsIt']),

    ('저장이 열차를 안 담는다', '60_game.js',
     b'    trains: trains.map(function (t) {',
     b'    trains: [].map(function (t) {',
     ['train.survivesSave']),

    # 레일 검사는 **UI 와 모델 양쪽에** 있다(이중 방어). 한쪽만 깨면 다른 쪽이 가려서
    # 어느 것도 검정되지 않는다 — 그래서 각 층을 그 층의 게이트로 잰다. 여기서는
    # 모델의 검사를 깨고, UI 를 거치지 않는 driver 게이트로 잡는다.
    ('열차를 빈 땅에도 놓을 수 있다 (모델 검사)', '36_train.js',
     b'  if (!isRail(tx, ty)) return null;',
     b'  if (false) return null;',
     ['train.addRejectsNonRail']),
]


def read_bytes(p):
    with io.open(p, 'rb') as f:
        return f.read()


def write_bytes(p, b):
    with io.open(p, 'wb') as f:
        f.write(b)


# 타임아웃은 선택이 아니다. 돌연변이가 **무한 루프**를 내면 헤드리스 브라우저가
# 페이지를 끝내지 못하고, 타임아웃 없는 subprocess.run 은 영원히 기다린다.
# 실제로 순환 방어를 지운 돌연변이에서 그렇게 되어 45건짜리 실행이 통째로 멎었고,
# 강제 종료로 죽이는 바람에 소스가 돌연변이된 채 작업 트리에 남았다.
RUN_TIMEOUT = 180

def run(cmd):
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=ENV, timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        return 'TIMEOUT', '', 'timed out after %ds' % RUN_TIMEOUT
    return p.returncode, p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')


GATE_RE = re.compile(r'^\s*\[(\w+)\s*\]\s+(\S+)', re.M)


def gate_results(out):
    res = {}
    for tag, name in GATE_RE.findall(out):
        res[name] = tag
    return res


def main():
    # 기준선 — 손대지 않은 상태에서 전부 GREEN 이어야 시작할 수 있다
    rc, out, err = run([sys.executable, 'build.py'])
    if rc != 0:
        print('FATAL: 기준선 빌드 실패\n' + out + err)
        return 2
    rc, out, err = run([sys.executable, os.path.join('tests', 'harness.py')])
    base = gate_results(out)
    if rc != 0:
        print('FATAL: 기준선이 이미 RED 다. 돌연변이 시험은 GREEN 위에서만 뜻이 있다.')
        print(out[-3000:])
        return 2
    print('기준선 GREEN — 게이트 %d개' % len(base))
    print('=' * 92)

    # uismoke 기준선도 GREEN 이어야 UI 돌연변이를 판정할 수 있다
    rc, out2, err2 = run([sys.executable, os.path.join('tests', 'harness.py'), 'uismoke.js'])
    if rc != 0:
        print('FATAL: uismoke 기준선이 RED 다.')
        print(out2[-3000:])
        return 2
    print('uismoke 기준선 GREEN — 게이트 %d개' % len(gate_results(out2)))

    # 모바일 기준선. 기기 에뮬레이션이 켜진 상태에서 GREEN 이어야 터치 돌연변이를
    # 판정할 수 있다 — 데스크톱으로 돌리면 TouchEvent 자체가 안 나가서 모든 터치
    # 게이트가 무너지고, 그걸 "돌연변이가 잡혔다" 로 오독하게 된다.
    rc, out3, err3 = run([sys.executable, os.path.join('tests', 'harness.py'),
                          'mobile.js', 'chromium', 'mobile'])
    if rc != 0:
        print('FATAL: mobile 기준선이 RED 다.')
        print(out3[-3000:])
        return 2
    print('mobile 기준선 GREEN — 게이트 %d개' % len(gate_results(out3)))

    only = None
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = a.split('=', 1)[1]
    if only:
        globals()['MUTATIONS'] = [m for m in MUTATIONS if only in m[0] or only in m[1]]
        print('필터 --only=%s → %d 건만 돌린다' % (only, len(MUTATIONS)))

    recovered = restore_sources_if_dirty()
    if recovered:
        print('!! 이전 실행이 비정상 종료돼 소스가 돌연변이된 채 남아 있었다.')
        print('   백업에서 되돌렸다: %s' % ', '.join(sorted(recovered)))
    snapshot_sources()

    caught, missed, invalid = 0, 0, 0
    rows = []
    revert_failed = []

    # 판정 행은 **덧붙이는 즉시 찍는다.** 예전에는 루프 끝에서 rows[-1] 을 찍었는데,
    # INVALID 경로 3개(앵커 불일치·빌드 실패·문법 오류)가 전부 continue 로 빠져
    # 그 print 를 건너뛰었다. 집계에는 "무효 1"이 뜨는데 **어느 돌연변이인지는 화면에
    # 안 나오는** 상태였다 — 검사 장치가 자기 실패를 감추고 있었던 것이다.
    def emit(row):
        rows.append(row)
        print('  [%-7s] %-38s %s' % row)
    for mut in MUTATIONS:
        name, fname, find, repl, expect = mut[0], mut[1], mut[2], mut[3], mut[4]
        drv = mut[5] if len(mut) > 5 else 'driver.js'
        # 대상은 기본이 src/ 지만, 레포 뿌리의 도구(build.py · tools/*.py)도
        # 배포본을 만드는 코드다 — 아이콘·매니페스트가 거기서 나오므로
        # 그쪽도 돌연변이를 걸 수 있어야 한다.
        path = os.path.join(SRC, fname)
        if not os.path.isfile(path):
            path = os.path.join(ROOT, fname)
        orig = read_bytes(path)
        n = orig.count(find)
        if n != 1:
            emit(('INVALID', name, '찾을 패턴이 %d번 나온다 (1번이어야)' % n))
            invalid += 1
            continue
        write_bytes(path, orig.replace(find, repl))
        try:
            brc, bout, berr = run([sys.executable, 'build.py'])
            if brc != 0:
                emit(('INVALID', name, '빌드 실패'))
                invalid += 1
                continue
            src, sout, serr = run(['node', os.path.join('tests', 'syntax_check.js')])
            if src != 0:
                # 문법 오류는 모든 게이트를 무너뜨려 "잡았다"로 오독된다
                emit(('INVALID', name, '돌연변이가 문법 오류를 냈다'))
                invalid += 1
                continue
            # 터치 드라이버는 기기 에뮬레이션이 켜져야 의미가 있다. 데스크톱으로
            # 돌리면 TouchEvent 가 안 만들어져 게이트가 아니라 도구를 재게 된다.
            hcmd = [sys.executable, os.path.join('tests', 'harness.py'), drv]
            if drv == 'mobile.js':
                hcmd += ['chromium', 'mobile']
            hrc, hout, herr = run(hcmd)
            if hrc == 'TIMEOUT':
                # 게이트가 잡은 것이 아니다 — 판정 자체가 성립하지 않았다.
                # 무한 루프는 FAIL 로 안 나오고 화면이 멈출 뿐이라, 이 결함은
                # 게이트가 아니라 코드의 상한(REACH_LIMIT 등)으로 막아야 한다.
                emit(('INVALID', name, '돌연변이가 무한 루프를 냈다 (%ds 안에 안 끝남) — '
                                       '게이트로는 못 잡는 종류다' % RUN_TIMEOUT))
                invalid += 1
                continue
            got = gate_results(hout)
            flipped = [g for g in expect if got.get(g) == 'FAIL']
            still = [g for g in expect if got.get(g) == 'PASS']
            missing = [g for g in expect if g not in got]
            if missing:
                emit(('INVALID', name, '게이트가 실행조차 안 됐다: ' + ','.join(missing)))
                invalid += 1
            elif still:
                emit(('MISS', name, '여전히 PASS: ' + ','.join(still)))
                missed += 1
            else:
                emit(('CAUGHT', name, '뒤집힘: ' + ','.join(flipped)))
                caught += 1
        finally:
            write_bytes(path, orig)
            if read_bytes(path) != orig:
                revert_failed.append(path)
        if revert_failed:
            print('FATAL: 되돌리기가 바이트 단위로 실패했다: %s' % revert_failed[0])
            return 2

    # 원본 상태로 다시 빌드해 둔다
    run([sys.executable, 'build.py'])

    clear_snapshot()

    print('=' * 92)
    print(' 잡음 %d · 놓침 %d · 무효 %d  / 전체 %d' % (caught, missed, invalid, len(MUTATIONS)))
    if missed or invalid:
        print(' RED — 게이트가 실패를 못 잡는 자리가 있다.')
        return 1
    print(' GREEN — 지목한 게이트가 전부 실제로 실패를 검출했다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
