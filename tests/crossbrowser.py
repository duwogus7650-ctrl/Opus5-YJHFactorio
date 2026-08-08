# -*- coding: utf-8 -*-
"""
교차 브라우저 검증 — 같은 게이트를 엔진 4개에서 돌리고 표로 찍는다.

왜 필요한가: 모든 검증이 Edge(Chromium) 하나에서만 GREEN 이면 "이 게임이 동작한다"가
아니라 "Chromium 에서 동작한다"만 보증한 것이다. Canvas2D·이벤트·localStorage·
TypedArray base64 왕복은 엔진마다 다르게 굴 수 있는 대표적인 자리다.

판정 로직은 tests/harness.py 한 곳에만 있다 — 여기서는 엔진만 바꿔 부른다.
엔진마다 다른 채점기를 만들면 어느 쪽이 맞는지 알 수 없게 된다.

사전 준비: npm i -D playwright && npx playwright install firefox webkit chromium
종료 코드: 0=전부 GREEN, 1=실패 있음, 2=하네스 결함
"""
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV['PYTHONIOENCODING'] = 'utf-8'

ENGINES = ['edge', 'chromium', 'firefox', 'webkit']
DRIVERS = [('driver.js', '모델'), ('uismoke.js', '클릭'), ('shedding.js', '부하차단'),
           ('fullplay.js', '전수스윕')]

# 터치 조합. **합성 터치가 되는 엔진에서만 의미가 있다** — WebKit(사파리 엔진)은
# Touch/TouchEvent 를 스크립트로 만들 수 없어(Type error) 여기서 돌려도 검증이
# 아니라 도구 한계를 재게 된다. 빼되 **조용히 빼지 않고** 표에 미검증으로 남긴다.
TOUCH_RUNS = [('chromium', 'mobile'), ('chromium', 'tablet')]
TOUCH_UNVERIFIED = [('webkit', 'mobile', '합성 터치 불가 (Touch/TouchEvent 생성 Type error)'),
                    ('firefox', 'mobile', 'Playwright 가 firefox 에 hasTouch 를 못 준다')]

RESULT_RE = re.compile(r'^\s*(GREEN|RED)\s+—\s+(.*)$', re.M)
COUNT_RE = re.compile(r'실검사 (\d+)건')


def run(engine, driver, device='desktop'):
    cmd = [sys.executable, os.path.join('tests', 'harness.py'), driver, engine, device]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=ENV, timeout=1800)
    out = p.stdout.decode('utf-8', 'replace') + p.stderr.decode('utf-8', 'replace')
    m = RESULT_RE.search(out)
    verdict = m.group(1) if m else ('FATAL' if 'FATAL' in out else '?')
    cm = COUNT_RE.search(out)
    n = int(cm.group(1)) if cm else 0
    fails = re.findall(r'\[FAIL\s*\]\s+(\S+)', out)
    broken = re.findall(r'\[BROKEN\s*\]\s+(\S+)', out)
    return p.returncode, verdict, n, fails, broken, out


def main():
    if not os.path.isfile(os.path.join(ROOT, 'dist', 'Logic-Foundry.html')):
        print('FATAL: dist 없음 — python build.py 먼저')
        return 2

    print('=' * 78)
    print(' 교차 브라우저 검증 — 같은 게이트, 엔진만 교체')
    print('=' * 78)
    print(' %-10s %-6s %-8s %s' % ('엔진', '드라이버', '검사수', '결과'))
    print('-' * 78)

    bad = 0
    rows = []
    for eng in ENGINES:
        for drv, label in DRIVERS:
            rc, verdict, n, fails, broken, out = run(eng, drv)
            note = ''
            if broken:
                note = '자기시험 BROKEN: ' + ','.join(broken)
                bad += 1
            elif fails:
                note = '실패: ' + ','.join(fails[:4])
                bad += 1
            elif verdict != 'GREEN':
                note = verdict + ' (rc=%d)' % rc
                bad += 1
            print(' %-10s %-6s %-8s %s %s' % (eng, label, n, verdict, note))
            rows.append((eng, label, verdict, n))
            if verdict != 'GREEN':
                # 원인을 바로 볼 수 있게 마지막 부분을 남긴다
                print('     ' + out.strip().splitlines()[-1][:120] if out.strip() else '')

    # --- 터치 기기 -----------------------------------------------------------
    print('-' * 78)
    print(' 터치 기기 (진짜 TouchEvent)')
    print('-' * 78)
    for eng, dev in TOUCH_RUNS:
        rc, verdict, n, fails, broken, out = run(eng, 'mobile.js', dev)
        note = ''
        if broken:
            note = '자기시험 BROKEN: ' + ','.join(broken); bad += 1
        elif fails:
            note = '실패: ' + ','.join(fails[:4]); bad += 1
        elif verdict != 'GREEN':
            note = verdict + ' (rc=%d)' % rc; bad += 1
        print(' %-10s %-6s %-8s %s %s' % (eng, dev, n, verdict, note))
        rows.append((eng, dev, verdict, n))

    # **미검증을 조용히 숨기지 않는다.** 표에서 빠지면 "다 됐다" 로 읽힌다.
    for eng, dev, why in TOUCH_UNVERIFIED:
        print(' %-10s %-6s %-8s %s' % (eng, dev, '-', '미검증 — ' + why))

    print('-' * 78)
    if bad:
        print(' RED — 엔진 %d 조합에서 문제가 있다.' % bad)
        return 1
    print(' GREEN — %d 조합 통과 (데스크톱 %d + 터치 %d). 터치 미검증 %d 조합은 위에 명시.'
          % (len(rows), len(ENGINES) * len(DRIVERS), len(TOUCH_RUNS), len(TOUCH_UNVERIFIED)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
