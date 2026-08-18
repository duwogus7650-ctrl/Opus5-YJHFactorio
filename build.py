# -*- coding: utf-8 -*-
"""
LOGIC FOUNDRY 빌드 — src/*.js 를 shell.html 한 장으로 인라인한다.

주의: 마커 치환에 str.replace 를 쓰지 않는다. index() 로 위치를 찾아 슬라이스+연결로만
      조립한다 (replacement 안의 특수문자가 조용히 먹히는 계열의 함정을 원천 차단).
"""
import io
import json
import os
import sys
from urllib.parse import quote

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
    '30_power.js', '32_fluid.js', '34_blueprint.js', '35_logic.js', '36_train.js', '37_rules.js', '40_enemy.js', '45_render.js',
    '50_ui.js', '52_tutorial.js', '55_logicui.js', '57_ruleui.js', '60_game.js',
]
MARK = '<!--GAME_INLINE-->'
OUT_NAME = 'Logic-Foundry.html'

# 폰 설치용 자리표시자. 아이콘 픽셀의 출처는 tools/make_icon.py 한 곳이다 —
# base64 덩어리를 shell.html 에 손으로 박아 두면 나중에 그게 어디서 나왔는지 알 수 없다.
ICON_MARK = '<!--ICON192-->'
MANIFEST_MARK = '<!--MANIFEST-->'


def read(path):
    with io.open(path, 'r', encoding='utf-8') as f:
        return f.read()


def stamp_of(shell_text, game_text):
    """배포본의 내용으로 정하는 빌드 도장. 껍데기와 스크립트를 **둘 다** 넣는다."""
    import hashlib
    return hashlib.sha1((shell_text + game_text).encode('utf-8')).hexdigest()[:8]


def stamp_selftest():
    """도장이 실제로 입력을 따라 바뀌는가 — 안 바뀌는 도장은 도장이 아니다.
    통과 케이스만 보면 '같은 입력 → 같은 값'만 확인하게 되므로, **바꿔 봤을 때
    달라지는지**를 함께 본다(껍데기 쪽과 스크립트 쪽 각각)."""
    bad = []
    base = stamp_of('shell', 'game')
    if stamp_of('shell', 'game') != base:
        bad.append('같은 입력인데 값이 흔들린다')
    if stamp_of('shell!', 'game') == base:
        bad.append('껍데기를 바꿔도 도장이 그대로다')
    if stamp_of('shell', 'game!') == base:
        bad.append('스크립트를 바꿔도 도장이 그대로다')
    if len(base) != 8:
        bad.append('길이가 8이 아니다: %d' % len(base))
    return bad


def splice(host, marker, payload):
    i = host.index(marker)
    return host[:i] + payload + host[i + len(marker):]


def splice_all(host, marker, payload):
    while marker in host:
        host = splice(host, marker, payload)
    return host


def manifest_uri(icon192, icon512):
    """홈화면 설치용 매니페스트를 data: URI 로 만든다.

    파일로 빼지 않는 이유: 배포본은 **HTML 한 장**이고, 매니페스트를 파일로 빼는 순간
    그 약속이 깨진다. JSON 을 URL 인코딩해 링크에 그대로 싣는다.
    """
    man = {
        'name': 'Logic Foundry',
        'short_name': 'Foundry',          # 홈화면 라벨은 짧아야 안 잘린다
        # **파일 이름을 그대로 쓴다.** '.' 로 두면 홈화면에서 띄울 때 폴더가 열리고,
        # 그 폴더에 index 가 없으면 404 다 (GitHub Pages 의 dist/ 가 정확히 그렇다).
        # 파일명으로 두면 file:// 로 직접 연 경우와 웹에 올린 경우 둘 다 맞는다.
        'start_url': './Logic-Foundry.html',
        'scope': './',
        'display': 'standalone',          # 주소창 없이 앱처럼
        'orientation': 'any',
        'background_color': '#1c2024',
        'theme_color': '#1c2024',
        'description': '제어기를 배선해 공장이 스스로 판단하게 만드는 공정자동화 게임',
        'icons': [
            {'src': icon192, 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
            {'src': icon512, 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
        ],
    }
    raw = json.dumps(man, ensure_ascii=False, separators=(',', ':'))
    # href 속성 안에 들어가므로 따옴표·부등호·#·% 는 반드시 인코딩한다.
    # 남겨 두면 속성이 그 자리에서 끊겨 매니페스트가 통째로 사라진다.
    return ('data:application/manifest+json;charset=utf-8,'
            + quote(raw, safe="!$&'()*+,-./:;=?@_~"))


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

    # 빌드 도장 — 소스 전체의 해시 앞 8자리. 시각이 아니라 내용으로 정한다
    # (같은 소스는 같은 도장이라 배포본 바이트가 재현된다).
    #
    # **껍데기(shell.html)까지 넣어 해싱한다.** 처음엔 JS 만 해싱했는데, 그러면
    # CSS 만 고친 판이 같은 도장을 달고 나간다 — 실제로 조작 바 글자 접힘을 CSS 로
    # 고친 뒤 도장이 그대로여서, "폰이 어느 사본인가"에 틀린 답을 하고 있었다.
    build_id = stamp_of(shell, game)
    stamp_mark = "var BUILD_ID = 'dev';"
    if stamp_mark not in game:
        print('FATAL: BUILD_ID 자리표시자를 못 찾았다 — 도장 없이 나가면 폰이 어느 사본인지 알 수 없다')
        return 2
    game = splice(game, stamp_mark, "var BUILD_ID = '" + build_id + "';")

    block = '<script>\n(function(){\n"use strict";\n' + game + '\n})();\n</' + 'script>'
    out = splice(shell, MARK, block)

    # 폰 설치용 아이콘·매니페스트 — 생성기에서 받아 자리표시자에 끼운다.
    # 생성기의 자기 시험을 **여기서 먼저 돌린다**: 깨진 PNG 를 배포본에 박아 두면
    # 홈화면 아이콘이 빈 사각형으로 뜨고, 그건 아무 게이트도 안 보는 자리다.
    stamp_bad = stamp_selftest()
    if stamp_bad:
        print('FATAL: 빌드 도장이 자기 시험에서 실패했다 — ' + ' · '.join(stamp_bad))
        return 2

    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import make_icon
    icon_problems = make_icon.selftest()
    if icon_problems:
        print('FATAL: 아이콘 생성기가 자기 시험에서 실패했다 — ' + ' · '.join(icon_problems))
        return 2
    i192, i512 = make_icon.data_uri(192), make_icon.data_uri(512)
    out = splice_all(out, ICON_MARK, i192)
    out = splice(out, MANIFEST_MARK, manifest_uri(i192, i512))

    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    dst = os.path.join(DIST, OUT_NAME)
    # newline='\n' 을 명시한다. 기본값은 os.linesep 으로 바꿔 써서 Windows 에서는
    # dist 가 CRLF 로 나오고, 그게 git 의 autocrlf 설정에 따라 커밋될 수도 아닐 수도
    # 있다 — 배포본의 바이트가 체크아웃 설정에 달리면 "배포본 바이트 기준" 검증이
    # 무슨 바이트를 잰 것인지 알 수 없게 된다.
    with io.open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)

    # **버전을 물어볼 수 있는 작은 파일.** 배포본은 430KB 라 '새 판이 있나' 를
    # 확인하려고 매번 받을 수는 없다. 도장만 담은 8바이트 파일을 같이 내보내면
    # 게임이 그것만 받아 보고 자기 도장과 비교할 수 있다.
    with io.open(os.path.join(ROOT, 'build.txt'), 'w', encoding='utf-8', newline=chr(10)) as f:
        f.write(build_id)

    print('BUILD OK  ->  %s  (도장 %s)' % (dst, build_id))
    for name, b, ln in sizes:
        print('   %-16s %6d bytes  %5d lines' % (name, b, ln))
    print('   %-16s %6d bytes' % ('(shell)', len(shell)))
    print('   %-16s %6d bytes  %5d lines' % ('TOTAL', len(out), out.count('\n') + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
