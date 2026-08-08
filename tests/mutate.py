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

    ('복원에서도 건설비를 요구한다', '25_entity.js',
     b'  if (!restore) {\n    var cost = B.cost;',
     b'  if (true) {\n    var cost = B.cost;',
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
     b"  forEachEntity(function (e) { if (e.type === 'generator') e.load = 0; });",
     b"  forEachEntity(function (e) { if (e.type === '__never') e.load = 0; });",
     ['power.disconnectedGeneratorIdles']),

    ('꺼진 발전기도 계속 공급한다', '30_power.js',
     b'      if (gen.fuel > 0 && gen.enabled) net.supplyCap += SPEC.genOutput;',
     b'      if (gen.fuel > 0) net.supplyCap += SPEC.genOutput;',
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

    ('대상이 비어도 경고하지 않는다', '55_logicui.js',
     b"  if (n.kind !== 'lamp' && n.kind !== 'display' && !who) {",
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
     b"  on('btnRotate', function () { toolDir = dirCW(toolDir); renderBuildList(); });",
     b"  on('__nope', function () { toolDir = dirCW(toolDir); renderBuildList(); });",
     ['mobile.rotateWithoutKeyboard'], 'mobile.js'),

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
     b'    while ((inventory[k] || 0) > 0 && canAccept(e, k) && guard++ < 20000) {\n'
     b'      if (!giveTo(e, k)) break;',
     b'    while ((inventory[k] || 0) > 0 && guard++ < 20000) {\n'
     b'      invAdd(e.inv, k, 1);',
     ['stock.putRespectsBufferCap', 'stock.putRejectsWrongItem']),

    ('넣기 대상에 상자를 넣는다 (전 재고가 상자로 빨려간다)', '25_entity.js',
     b"var PUT_TYPES = { generator: 1, turret: 1, lab: 1, furnace: 1, assembler: 1 };",
     b"var PUT_TYPES = { generator: 1, turret: 1, lab: 1, furnace: 1, assembler: 1, chest: 1 };",
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
        path = os.path.join(SRC, fname)
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
