# -*- coding: utf-8 -*-
"""
LOGIC FOUNDRY 빌드 — src/*.js 를 shell.html 한 장으로 인라인한다.

주의: 마커 치환에 str.replace 를 쓰지 않는다. index() 로 위치를 찾아 슬라이스+연결로만
      조립한다 (replacement 안의 특수문자가 조용히 먹히는 계열의 함정을 원천 차단).
"""
import io
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')

FILES = [
    '00_core.js', '05_data.js', '10_world.js', '20_belt.js', '25_entity.js',
    '30_power.js', '35_logic.js', '37_rules.js', '40_enemy.js', '45_render.js',
    '50_ui.js', '52_tutorial.js', '55_logicui.js', '57_ruleui.js', '60_game.js',
]
MARK = '<!--GAME_INLINE-->'
OUT_NAME = 'Logic-Foundry.html'


def read(path):
    with io.open(path, 'r', encoding='utf-8') as f:
        return f.read()


def splice(host, marker, payload):
    i = host.index(marker)
    return host[:i] + payload + host[i + len(marker):]


def main():
    shell = read(os.path.join(SRC, 'shell.html'))
    parts = []
    sizes = []
    for name in FILES:
        p = os.path.join(SRC, name)
        if not os.path.isfile(p):
            print('FATAL: 소스가 없다: %s' % p)
            return 2
        src = read(p)
        sizes.append((name, len(src), src.count('\n') + 1))
        parts.append('/* ===================== %s ===================== */\n' % name)
        parts.append(src)
        parts.append('\n')
    game = ''.join(parts)

    # 인라인 스크립트 조기 종료 방지 — 소스에 </script 가 있으면 즉시 실패시킨다
    if '</script' in game.lower():
        print('FATAL: 소스에 </script 문자열이 있다 — 인라인하면 스크립트가 잘린다')
        return 2

    block = '<script>\n(function(){\n"use strict";\n' + game + '\n})();\n</' + 'script>'
    out = splice(shell, MARK, block)

    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    dst = os.path.join(DIST, OUT_NAME)
    with io.open(dst, 'w', encoding='utf-8') as f:
        f.write(out)

    print('BUILD OK  ->  %s' % dst)
    for name, b, ln in sizes:
        print('   %-16s %6d bytes  %5d lines' % (name, b, ln))
    print('   %-16s %6d bytes' % ('(shell)', len(shell)))
    print('   %-16s %6d bytes  %5d lines' % ('TOTAL', len(out), out.count('\n') + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
