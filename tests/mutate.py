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


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=ENV)
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
            hrc, hout, herr = run([sys.executable, os.path.join('tests', 'harness.py'), drv])
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

    print('=' * 92)
    print(' 잡음 %d · 놓침 %d · 무효 %d  / 전체 %d' % (caught, missed, invalid, len(MUTATIONS)))
    if missed or invalid:
        print(' RED — 게이트가 실패를 못 잡는 자리가 있다.')
        return 1
    print(' GREEN — 지목한 게이트가 전부 실제로 실패를 검출했다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
