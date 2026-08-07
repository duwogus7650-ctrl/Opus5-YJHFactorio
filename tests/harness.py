# -*- coding: utf-8 -*-
"""
헤드리스 검증 하네스 — LOGIC FOUNDRY

계약:
  · 산출물(dist/Logic-Foundry.html)에 tests/driver.js 를 주입해 헤드리스 Edge 로 실행한다.
  · 판정은 #testout 에 실린 JSON 필드로만 한다. 콘솔 문자열 눈대중 금지.
  · driver 안의 expectFail 검사는 반드시 FAIL 이어야 한다. PASS 로 오면
    "이 하네스는 실패를 못 잡는다"는 뜻이라 전체를 RED 로 만든다.

종료 코드: 0=GREEN, 1=검사 실패, 2=하네스 자체 결함/실행 실패
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist', 'Logic-Foundry.html')
# 드라이버는 인자로 바꿔 끼울 수 있다 (모델 게이트 = driver.js, 클릭 경로 = uismoke.js)
DRIVER = os.path.join(ROOT, 'tests', sys.argv[1] if len(sys.argv) > 1 else 'driver.js')
if not os.path.isabs(DRIVER) and not os.path.isfile(DRIVER):
    DRIVER = os.path.abspath(sys.argv[1])

EDGE_CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]

START = '@@JSON_START@@'
END = '@@JSON_END@@'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def find_browser():
    for c in EDGE_CANDIDATES:
        if os.path.isfile(c):
            return c
    return None


def build_test_page(extra_js):
    """</body> 앞에 드라이버를 끼워 넣는다 — replace 가 아니라 슬라이스+연결."""
    html = read(DIST)
    marker = '</body>'
    i = html.rindex(marker)
    block = '<script>\n' + extra_js + '\n</' + 'script>\n'
    return html[:i] + block + html[i:]


def run_browser(exe, page_path, args, timeout=300):
    profile = tempfile.mkdtemp(prefix='lf-prof-')
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--allow-file-access-from-files',
           '--user-data-dir=' + profile,
           '--window-size=1280,800'] + args + ['file:///' + page_path.replace('\\', '/')]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main():
    if not os.path.isfile(DIST):
        print('FATAL: 산출물이 없다 — python build.py 먼저')
        return 2
    exe = find_browser()
    if not exe:
        print('FATAL: 헤드리스 브라우저를 찾을 수 없다')
        return 2

    page = build_test_page(read(DRIVER))
    tmpdir = tempfile.mkdtemp(prefix='lf-run-')
    page_path = os.path.join(tmpdir, 'test-run.html')
    with io.open(page_path, 'w', encoding='utf-8') as f:
        f.write(page)

    rc, dom, err = run_browser(exe, page_path, ['--dump-dom', '--virtual-time-budget=120000'])

    # 마커 문자열은 주입된 드라이버 소스에도 남아 있다. 문서 전체를 뒤지면 스크립트
    # 본문을 결과로 오인하므로 #testout 요소만 판정 채널로 쓴다.
    m = re.search(r'<div id="testout">(.*?)</div>', dom, re.S)
    payload = m.group(1) if m else ''
    if START not in payload or END not in payload:
        print('FATAL: 드라이버 결과를 찾지 못했다 (게임이 부팅조차 못 했을 수 있다)')
        print('  브라우저: %s (rc=%s)' % (exe, rc))
        print('  #testout 내용(앞 400자): %r' % payload[:400])
        print('--- stderr (마지막 3000자) ---')
        print(err[-3000:])
        return 2

    raw = payload[payload.index(START) + len(START): payload.index(END)]
    raw = (raw.replace('&quot;', '"').replace('&lt;', '<')
              .replace('&gt;', '>').replace('&amp;', '&'))
    try:
        res = json.loads(raw)
    except Exception as e:
        print('FATAL: JSON 파싱 실패: %s' % e)
        print(raw[:2000])
        return 2

    line = '=' * 92
    print(line)
    print(' LOGIC FOUNDRY 헤드리스 검증   버전 %s' % res.get('version'))
    print(' 캔버스 %s · 브라우저 %s' % (json.dumps(res.get('gfx')), os.path.basename(exe)))
    sp = res.get('spec') or {}
    if sp:
        print(' 오라클 상수: 벨트 %.3f개/s · 인서터 %.4f개/s · 채광 %.2f개/s · 제련 %.1fs · '
              '발전 %dkW · 터렛 %ddps/%d타일'
              % (sp.get('beltPerSec', 0), sp.get('inserterPerSec', 0), sp.get('minerPerSec', 0),
                 sp.get('furnaceTime', 0), sp.get('genKw', 0), sp.get('turretDps', 0),
                 sp.get('turretRange', 0)))
    print(line)

    if res.get('fatal'):
        print('FATAL(드라이버 내부): %s' % res['fatal'])
        for c in res.get('checks', []):
            print('   (중단 전) %-30s %s' % (c['name'], 'PASS' if c['ok'] else 'FAIL'))
        return 2

    checks = res.get('checks', [])
    if not checks:
        print('FATAL: 검사가 하나도 실행되지 않았다')
        return 2

    real_fail = 0
    selftest_broken = False
    selftest_count = 0
    for c in checks:
        if c.get('expectFail'):
            selftest_count += 1
            if c['ok']:
                tag, selftest_broken = 'BROKEN', True
            else:
                tag = 'GOOD  '     # 실패해야 할 검사가 정상적으로 실패했다
        else:
            tag = 'PASS  ' if c['ok'] else 'FAIL  '
            if not c['ok']:
                real_fail += 1
        print('  [%s] %-30s %s' % (tag, c['name'], c['detail']))

    print('-' * 92)
    fs = res.get('finalState')
    if fs:
        print(' 최종 상태: 시각 %.1fs · 엔티티 %d · 채굴 %d · 오염 %.1f · 진화 %.0f%% · 적 %d · 둥지 %d'
              % (fs['t'], fs['entityCount'], fs.get('mined', 0), fs['pollution'],
                 fs['evolution'] * 100, fs['enemies'], fs['nests']))
        print(' 전력: 공급 %dkW / 수요 %dkW / 만족 %.0f%% / 망 %d개   벨트 인계 %d회'
              % (fs['power']['supply'], fs['power']['demand'], fs['power']['sat'] * 100,
                 fs['power']['nets'], fs['beltDelivered']))
    if res.get('errors'):
        print(' 런타임 오류 %d건:' % len(res['errors']))
        for e in res['errors'][:12]:
            print('   - %s' % e)

    print('-' * 92)
    if selftest_count == 0:
        print(' RED — 고의 실패 검사가 하나도 없다. 이 하네스는 자기가 살아 있는지 모른다.')
        return 2
    if selftest_broken:
        print(' RED — 하네스 자기 시험이 통과했다. 이 하네스는 실패를 못 잡는다.')
        return 2
    if real_fail:
        print(' RED — 검사 %d건 실패 / 실검사 %d건' % (real_fail, len(checks) - selftest_count))
        return 1
    print(' GREEN — 실검사 %d건 전부 통과 (고의 실패 %d건 정상 검출)'
          % (len(checks) - selftest_count, selftest_count))
    return 0


if __name__ == '__main__':
    sys.exit(main())
