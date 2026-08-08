# -*- coding: utf-8 -*-
"""
페이싱/밸런스 측정 — 헤드리스로 30분치 시뮬을 돌려 표로 뽑는다.

이건 게이트가 아니다(합격/불합격을 정하지 않는다). "재미"는 못 재지만
"말이 되는 속도인가"는 잴 수 있고, 사람이 30분 플레이하기 전에 볼 수 있는 숫자다.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist', 'Logic-Foundry.html')
DRIVER = os.path.join(ROOT, 'tests', 'balancedrv.js')
EDGE = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
START, END = '@@JSON_START@@', '@@JSON_END@@'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def main():
    if not os.path.isfile(DIST):
        print('FATAL: dist 없음 — python build.py 먼저'); return 2
    exe = next((e for e in EDGE if os.path.isfile(e)), None)
    if not exe:
        print('FATAL: Edge 없음'); return 2

    html = read(DIST)
    i = html.rindex('</body>')
    page = html[:i] + '<script>\n' + read(DRIVER) + '\n</' + 'script>\n' + html[i:]
    tmp = tempfile.mkdtemp(prefix='lf-bal-')
    pp = os.path.join(tmp, 'bal.html')
    with io.open(pp, 'w', encoding='utf-8') as f:
        f.write(page)
    prof = tempfile.mkdtemp(prefix='lf-bp-')
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--user-data-dir=' + prof, '--window-size=900,600',
           '--dump-dom', '--virtual-time-budget=900000',
           'file:///' + pp.replace('\\', '/')]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=1500)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
    dom = p.stdout.decode('utf-8', 'replace')
    m = re.search(r'<div id="testout">(.*?)</div>', dom, re.S)
    payload = m.group(1) if m else ''
    if START not in payload:
        print('FATAL: 결과를 못 찾았다'); print(payload[:400])
        print(p.stderr.decode('utf-8', 'replace')[-2000:]); return 2
    raw = payload[payload.index(START) + len(START):payload.index(END)]
    raw = (raw.replace('&quot;', '"').replace('&lt;', '<')
              .replace('&gt;', '>').replace('&amp;', '&'))
    d = json.loads(raw)
    if d.get('fatal'):
        print('FATAL(드라이버): %s' % d['fatal']); return 2

    print('=' * 104)
    print(' LOGIC FOUNDRY 페이싱 측정   버전 %s' % d.get('version'))
    print('=' * 104)
    print(' 모델링 가정 (이게 틀리면 아래 숫자도 틀린다):')
    for a in d.get('assumptions', []):
        print('   · %s' % a)

    for name, sc in d.get('scenarios', {}).items():
        mc = sc['machines']
        print('')
        print('-' * 104)
        print(' 시나리오 %s — 채광 %d · 용광로 %d · 조립 %d · 연구소 %d · 발전 %d · 터렛 %d'
              % (name, mc['miner'], mc['furnace'], mc['assembler'], mc['lab'], mc['gen'], mc['turret']))
        print('-' * 104)
        print('  분  진화%   오염   적  파  스폰 손실 최근접  전력%  수요kW  연구')
        for s in sc['samples']:
            if s['t'] % 2 and s['t'] != 1 and s['t'] != len(sc['samples']):
                continue
            print('  %2d  %5.1f  %6.1f  %3d %3d  %4d %4d  %6s  %4d  %6d  %s'
                  % (s['t'], s['evo'], s['poll'], s['enemies'], s['waves'], s['spawned'],
                     s['lost'], ('-' if s['nearest'] is None else s['nearest']),
                     s['sat'], s['demand'],
                     ('%s %d%%' % (s['cur'], s['curFrac'])) if s['cur'] else ('완료 %d개' % s['done'])))
        mk = sc['marks']
        def mm(k):
            return ('%d분' % mk[k]) if k in mk else '없음'
        print('   첫 습격파 %s · 적이 공장 12타일 안 %s · 첫 건물 손실 %s'
              % (mm('firstWave'), mm('firstContact'), mm('firstLoss')))
        techs = [(k[5:], v) for k, v in mk.items() if k.startswith('tech_')]
        techs.sort(key=lambda x: x[1])
        if techs:
            print('   연구 완료 시점: ' + ' · '.join('%s %d분' % (t, v) for t, v in techs))

    g = d.get('marks', {})
    print('')
    print('-' * 104)
    print(' 보조 측정')
    print('   발전기 1대(900kW)가 만족도 100%%로 감당하는 조립기: %s대 (155kW 기준 이론상 5.8대)'
          % g.get('assemblersPerGenerator'))
    if 'startPatchMinutes' in g:
        print('   시작 철광맥 1개 + 채광기 1대: %s분에 %s개 채굴, 고갈=%s'
              % (g['startPatchMinutes'], g['startPatchMined'], g['startPatchDepleted']))
    print('   탄약 경제: 철판 4개 → 탄창 1개(10발) · 소형 %s발 · 중형 %s발 · 대형 %s발로 사살'
          % (g.get('shotsPerSmallBiter'), g.get('shotsPerMediumBiter'), g.get('shotsPerBigBiter')))
    if d.get('errors'):
        print('   런타임 오류 %d건: %s' % (len(d['errors']), d['errors'][:3]))
    else:
        print('   런타임 오류 0건')
    print('=' * 104)
    return 0


if __name__ == '__main__':
    sys.exit(main())
