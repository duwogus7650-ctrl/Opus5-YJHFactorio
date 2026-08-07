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

    # ---- UI 경로 (uismoke.js 로 판정) ----
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
    for mut in MUTATIONS:
        name, fname, find, repl, expect = mut[0], mut[1], mut[2], mut[3], mut[4]
        drv = mut[5] if len(mut) > 5 else 'driver.js'
        path = os.path.join(SRC, fname)
        orig = read_bytes(path)
        n = orig.count(find)
        if n != 1:
            rows.append(('INVALID', name, '찾을 패턴이 %d번 나온다 (1번이어야)' % n))
            invalid += 1
            continue
        write_bytes(path, orig.replace(find, repl))
        try:
            brc, bout, berr = run([sys.executable, 'build.py'])
            if brc != 0:
                rows.append(('INVALID', name, '빌드 실패'))
                invalid += 1
                continue
            src, sout, serr = run(['node', os.path.join('tests', 'syntax_check.js')])
            if src != 0:
                # 문법 오류는 모든 게이트를 무너뜨려 "잡았다"로 오독된다
                rows.append(('INVALID', name, '돌연변이가 문법 오류를 냈다'))
                invalid += 1
                continue
            hrc, hout, herr = run([sys.executable, os.path.join('tests', 'harness.py'), drv])
            got = gate_results(hout)
            flipped = [g for g in expect if got.get(g) == 'FAIL']
            still = [g for g in expect if got.get(g) == 'PASS']
            missing = [g for g in expect if g not in got]
            if missing:
                rows.append(('INVALID', name, '게이트가 실행조차 안 됐다: ' + ','.join(missing)))
                invalid += 1
            elif still:
                rows.append(('MISS', name, '여전히 PASS: ' + ','.join(still)))
                missed += 1
            else:
                rows.append(('CAUGHT', name, '뒤집힘: ' + ','.join(flipped)))
                caught += 1
        finally:
            write_bytes(path, orig)
            if read_bytes(path) != orig:
                revert_failed.append(path)
        if revert_failed:
            print('FATAL: 되돌리기가 바이트 단위로 실패했다: %s' % revert_failed[0])
            return 2
        print('  [%-7s] %-38s %s' % (rows[-1][0], rows[-1][1], rows[-1][2]))

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
