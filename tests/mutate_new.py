# -*- coding: utf-8 -*-
"""
새로 추가한 게이트 전용 돌연변이 검정.

목적은 커버리지가 아니라 **"이 게이트가 없던 버그를 진짜로 잡는가"** 하나다.
게이트마다 고쳤던 줄을 원래(버그) 상태로 되돌리고, 그 게이트가 FAIL 로
뒤집히는지 본다. 안 뒤집히면 그 게이트는 통과만 하는 장식이다.

mutate.py 와 갈라 놓은 이유: 저건 무작위 변형으로 넓게 훑고, 이건 지목한
수정 한 줄씩을 정확히 되돌린다. 판정 기준도 다르다 —
저건 "아무 게이트나 잡으면 OK", 이건 "**지정한 그 게이트**가 잡아야 OK".

사용: python tests/mutate_new.py         (혼자 돌려야 한다 — 소스를 제자리에서 고친다)
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
RUN_TIMEOUT = 300

# (이름, 파일, 찾을 것, 바꿀 것, 이걸 잡아야 하는 게이트, 어떤 드라이버)
MUTATIONS = [
    ('탄약 환급을 발 단위 그대로', '25_entity.js',
     """    if (e.type === 'turret' && e.ammo > 0) {
      var mags = Math.floor(e.ammo / SPEC.turretShotsPerAmmo);
      if (mags > 0) inventory['ammo'] = (inventory['ammo'] || 0) + mags;
    }""",
     """    if (e.type === 'turret' && e.ammo) inventory['ammo'] = (inventory['ammo'] || 0) + e.ammo;""",
     'turret.ammoRefundKeepsUnit', 'driver.js'),

    ('발전기 석탄 환급 제거', '25_entity.js',
     """    if (e.type === 'generator' && e.fuel > 0) {
      var coals = Math.floor(e.fuel / SPEC.coalEnergy);
      if (coals > 0) inventory['coal'] = (inventory['coal'] || 0) + coals;
    }""",
     """    /* 환급 없음 */""",
     'generator.coalRefunded', 'driver.js'),

    ('죽은 적 건너뛰기 제거', '40_enemy.js',
     '      if (enemies[i].hp <= 0) continue;\n',
     '',
     'turret.noOverkillWaste', 'driver.js'),

    ('손 조립을 즉시 완성으로', '50_ui.js',
     '    var use = Math.min(dt, job.left);\n    job.left -= use; dt -= use;',
     '    var use = Math.min(dt, job.left);\n    job.left = 0; dt -= use;',
     'hand.takesTime', 'driver.js'),

    ('손 조립 대기열을 한 틱에 전부', '50_ui.js',
     '    if (job.left > 1e-9) break;',
     '    if (false) break;',
     'hand.oneAtATime', 'driver.js'),

    ('취소해도 재료를 안 돌려줌', '50_ui.js',
     "  for (var k in r.inp) inventory[k] = (inventory[k] || 0) + r.inp[k];\n  return true;\n}\nfunction stepHandCraft",
     "  return true;\n}\nfunction stepHandCraft",
     'hand.cancelRefunds', 'driver.js'),

    ('연구 갈아탈 때 진행도 0', '50_ui.js',
     '  researchProgress = researchProgressBy[tid] || 0;',
     '  researchProgress = 0;',
     'research.switchKeepsProgress', 'driver.js'),

    ('저장에서 대기열 누락', '60_game.js',
     "    hand: handQueue.map(function (j) { return [j.rid, j.left]; }),",
     "",
     'hand.queueSurvivesSave', 'driver.js'),

    ('손 조립이 생산통계를 안 남김', '50_ui.js',
     "    prodStats.byRecipe[job.rid] = (prodStats.byRecipe[job.rid] || 0) + 1;",
     "",
     'tut.handCraftSatisfiesAssemble', 'driver.js'),

    ('강철을 다시 소비처 없는 물건으로', '05_data.js',
     "cost: { 'belt-item': 4, 'circuit': 2, 'steel': 2 }, rot: true, tech: 'steel',",
     "cost: { 'belt-item': 4, 'circuit': 2 }, rot: true, tech: 'steel',",
     'sweep.noDeadEndItems', 'fullplay.js'),

    ('분배기 우선을 셀 번호 그대로', '20_belt.js',
     '  if (e.outPrio === 0 || e.outPrio === 1) {',
     '  if (false) {',
     'splitter.prioIsTravelRelative', 'driver.js'),

    ('용광로가 굽던 것을 안 기억함', '25_entity.js',
     '    e.lastRecipe = e.recipe;\n',
     '',
     'furnace.remembersLastRecipe', 'driver.js'),

    ('노드 이동이 재컴파일을 안 검', '55_logicui.js',
     '      g.dirty = true;\n      updateLinks();',
     '      updateLinks();',
     'ui.dragRecompilesOrder', 'uismoke.js'),

    ('평가 순서를 나무별로 뒤집기', '35_logic.js',
     '  for (var s = 0; s < roots.length; s++) if (!color[roots[s].nid]) dfs(roots[s].nid);',
     '  for (var s = 0; s < roots.length; s++) { if (color[roots[s].nid]) continue; var mk = order.length; dfs(roots[s].nid); var sg2 = order.splice(mk, order.length - mk); sg2.reverse(); for (var q3 = 0; q3 < sg2.length; q3++) order.push(sg2[q3]); } order.reverse();',
     'ctrl.inputsEvaluateBeforeOutputs', 'driver.js'),

    ('build 를 free 경로로 되돌리기', '60_game.js',
     'dir === undefined ? 1 : dir, false);',
     'dir === undefined ? 1 : dir, true);',
     'build.minerNeedsOre', 'driver.js'),

    ("규칙 컴파일 좌표를 흔들기", "37_rules.js",
     "    var y0 = 20 + i * RULE_ROW;",
     "    var y0 = 20 + i * RULE_ROW + (g.nodes.length % 7);",
     "rule.deterministicLayout", "driver.js"),

    ("연구 잠금 무시하고 컴파일", "37_rules.js",
     "    if (why) { skipped.push({ name: r.name || ('규칙 ' + (i + 1)), why: why }); continue; }",
     "    if (false) { continue; }",
     "rule.locksBehindResearch", "driver.js"),

    ("꺼진 규칙도 컴파일", "37_rules.js",
     "    if (!r.enabled) { skipped.push({ name: r.name || ('규칙 ' + (i + 1)), why: '꺼 둠' }); continue; }",
     "    if (false) { continue; }",
     "rule.disabledReleasesControl", "driver.js"),

    ("저장에서 규칙 누락", "60_game.js",
     "    o.rules = e.rules || [];",
     "",
     "rule.survivesSave", "driver.js"),

    ("대상없음 판정을 이름 문자열로", "55_logicui.js",
     "  if (n.kind !== 'lamp' && n.kind !== 'display' && !entities[n.cfg.ent]) {",
     "  if (n.kind !== 'lamp' && n.kind !== 'display' && !who) {",
     "ui.outputNodeWarnsNoTarget", "uismoke.js"),

    ("제어기를 열면 회로가 먼저", "55_logicui.js",
     "  showRules(!e.handEdited);",
     "  showRules(false);",
     "ui.rulesShowFirst", "uismoke.js"),
]


def build():
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'build.py')],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode == 0


def run_driver(drv):
    """게이트 이름 -> ok(bool) 사전을 돌려준다. 판정은 하네스의 출력 계약으로만 한다.

    **중단된 실행의 결과도 읽는다.** 돌연변이를 넣으면 UI 가 실제로 깨져서 뒤쪽
    검사가 예외로 죽는 일이 정상적으로 일어난다. 그때 하네스는 형식을 바꿔
    `(중단 전) 이름   PASS` 로 찍는데, `[PASS]` 형식만 읽던 시절에는 **아무것도
    파싱하지 못해** 멀쩡히 잡은 게이트가 INVALID(검정 불성립)로 분류됐다.
    채점기가 결과를 못 읽으면 검정 자체가 성립하지 않는다.
    """
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tests', 'harness.py'), drv],
                       cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=RUN_TIMEOUT)
    out = r.stdout or ''
    res = {}
    for m in re.finditer(r'\[(PASS|FAIL|GOOD)\s*\]\s+(\S+)', out):
        res[m.group(2)] = (m.group(1) != 'FAIL')
    aborted = 'FATAL' in out
    if aborted:
        for m in re.finditer(r'\(중단 전\)\s+(\S+)\s+(PASS|FAIL|GOOD)', out):
            res.setdefault(m.group(1), m.group(2) != 'FAIL')
    return res, r.returncode, aborted


def stale_snapshots():
    """지난 실행이 남긴 스냅샷들 — 최신 순."""
    base = tempfile.gettempdir()
    out = []
    for n in os.listdir(base):
        if not n.startswith('lf-mutnew-'):
            continue
        p = os.path.join(base, n, 'src')
        if os.path.isdir(p):
            out.append((os.path.getmtime(p), os.path.join(base, n)))
    out.sort(reverse=True)
    return [p for _, p in out]


def check_stale():
    """**전원이 꺼지면 finally 가 안 돈다.**

    이 도구는 소스를 제자리에서 변형하고 finally 에서 되돌린다. 예외·Ctrl-C 에는
    그게 돌지만 전원 차단에는 안 돈다 — 실제로 21건을 돌리다 컴퓨터가 꺼져서
    첫 변형(터렛 탄약 환급을 10배 복사로 되돌린 것)이 소스에 그대로 남았다.
    그 상태로 계속 작업하면 게이트가 그 버그를 다시 잡을 때까지 아무도 모른다.

    그래서 시작할 때 남은 스냅샷과 지금 소스를 파일별로 대조해, 다른 것이 있으면
    **먼저 알리고 멈춘다.** 조용히 덮어쓰지 않는다 — 그 사이에 손으로 고친 것이
    있을 수 있고, 그건 스냅샷에 없다.
    """
    snaps = stale_snapshots()
    if not snaps:
        return
    newest = snaps[0]
    diff = []
    for f in sorted(os.listdir(os.path.join(newest, 'src'))):
        a = os.path.join(newest, 'src', f)
        b = os.path.join(SRC, f)
        if not os.path.exists(b):
            diff.append(f + ' (지금 없음)')
        elif io.open(a, encoding='utf-8').read() != io.open(b, encoding='utf-8').read():
            diff.append(f)
    if not diff:
        return
    print('※ 지난 실행의 스냅샷이 남아 있고, 지금 소스와 다르다:')
    print('   스냅샷: ' + newest)
    for d in diff:
        print('   다름: ' + d)
    print('   지난 실행이 중단돼 **변형이 남았을 수 있다.** 아래로 확인·복구한 뒤 다시 돌려라:')
    print('   git diff src/   ·   copy "%s\\src\\*" src\\' % newest)
    sys.exit(2)


def main():
    check_stale()
    snap = tempfile.mkdtemp(prefix='lf-mutnew-')
    shutil.copytree(SRC, os.path.join(snap, 'src'))
    print('원본 스냅샷: ' + snap)
    rows = []
    try:
        for name, fname, find, repl, gate, drv in MUTATIONS:
            path = os.path.join(SRC, fname)
            orig = io.open(path, encoding='utf-8').read()
            if orig.count(find) != 1:
                rows.append((name, gate, 'INVALID', '앵커 %d회 발견 (1회여야)' % orig.count(find)))
                continue
            io.open(path, 'w', encoding='utf-8', newline='\n').write(orig.replace(find, repl, 1))
            try:
                if not build():
                    rows.append((name, gate, 'INVALID', '빌드 실패'))
                    continue
                res, rc, aborted = run_driver(drv)
                note = ' · 드라이버가 중간에 죽었다(변형 때문이면 정상)' if aborted else ''
                if gate not in res:
                    rows.append((name, gate, 'INVALID',
                                 '그 게이트가 결과에 없다 — 그 지점 전에 죽었다' + note))
                elif res[gate] is False:
                    others = [g for g, ok in res.items() if not ok and g != gate]
                    rows.append((name, gate, 'KILLED',
                                 '지목한 게이트가 잡았다' +
                                 (' (동시에 %d건 더)' % len(others) if others else '') + note))
                else:
                    dead = [g for g, ok in res.items() if not ok]
                    # 중단됐는데 그 게이트가 통과로 읽혔다면 "통과"를 믿을 수 없다 —
                    # 중단 지점 뒤의 검사는 아예 돌지 않았다.
                    verdict = 'SURVIVED' if not aborted else 'INVALID'
                    rows.append((name, gate, verdict,
                                 '그 게이트는 통과 · 다른 실패 ' +
                                 (', '.join(dead) if dead else '없음') + note))
            finally:
                io.open(path, 'w', encoding='utf-8', newline='\n').write(orig)
    finally:
        # 어떤 경로로 끝나든 원본을 되돌린다 (중단해도 소스가 변형된 채 남지 않게)
        for f in os.listdir(os.path.join(snap, 'src')):
            shutil.copy2(os.path.join(snap, 'src', f), os.path.join(SRC, f))
        build()
        print('원본 복구 + 재빌드 완료')

    print()
    print('%-30s %-34s %-9s %s' % ('되돌린 수정', '잡아야 하는 게이트', '결과', '비고'))
    print('-' * 118)
    for name, gate, verdict, note in rows:
        print('%-30s %-34s %-9s %s' % (name[:30], gate[:34], verdict, note))
    killed = sum(1 for r in rows if r[2] == 'KILLED')
    bad = [r for r in rows if r[2] != 'KILLED']
    print('-' * 118)
    print('%d/%d 게이트가 자기 버그를 잡았다' % (killed, len(rows)))
    if bad:
        print('※ 자기 버그를 못 잡은 게이트 — 장식일 수 있다:')
        for r in bad:
            print('   · %s (%s) — %s' % (r[1], r[2], r[3]))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
