# -*- coding: utf-8 -*-
"""
스크린샷 — 실제 화면을 눈으로 검수하기 위한 장면 촬영.

"런타임 오류 0" 과 "화면에 무언가 보인다" 는 별개의 사실이므로, 게이트가 GREEN 이어도
사람이 그림을 봐야 한다. 장면마다 씬 구성 스크립트를 주입한 뒤 헤드리스로 캡처한다.
"""
import io
import os
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
SHOTS = os.path.join(ROOT, 'shots')

EDGE = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']

# 각 장면: (파일명, 창크기, 주입할 JS)
SCENES = []

# 표준 장면은 파일 하나로 두고 Edge·Playwright 양쪽이 같은 것을 읽는다.
# 엔진별로 장면이 다르면 그림 차이가 엔진 탓인지 장면 탓인지 구분할 수 없다.
# (read() 는 아래에서 정의되므로 여기서는 직접 연다.)
with io.open(os.path.join(ROOT, 'tests', 'scene-factory.js'), 'r', encoding='utf-8') as _f:
    FACTORY = _f.read()

LOGIC = r"""
var G = window.__GAME;
G.reset(424242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
G.ui.closeHelp();
G.research('logic-mem'); G.research('logic-ctrl'); G.research('defense-ai');
for (var y=75;y<=85;y+=5) for (var x=75;x<=85;x+=5) G.place('pole', x, y, 0);
var g = G.place('generator', 76, 81, 0); G.setFuel(g, 4000*600);
var chest = G.place('chest', 77, 76, 0); G.fillChest(chest, 'gear', 34);
var asm = G.place('assembler', 81, 76, 1); G.setRecipe(asm, 'gear'); G.fillChest(asm,'iron-plate',500);
var ctl = G.place('controller', 81, 81, 0);
G.run(1);
G.ui.openLogic(ctl);
G.ui.loadExample();
G.run(1);
"""

TECH = r"""
var G = window.__GAME;
G.reset(424242); G.giveAll(9999);
G.ui.closeHelp();
G.research('logistics'); G.research('military');
G.setResearch('logic-mem');
G.run(1);
G.ui.refresh();
G.ui.openTech();
"""

HELP = r"""
var G = window.__GAME;
G.reset(424242); G.giveAll(400);
G.run(1); G.ui.refresh();
G.ui.openHelp();
"""

SCENES = [
    ('01-factory.png', '1600,1000', FACTORY),
    ('02-logic-editor.png', '1600,1000', LOGIC),
    ('03-tech.png', '1400,900', TECH),
    ('04-help.png', '1400,900', HELP),
]


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def find_edge():
    for e in EDGE:
        if os.path.isfile(e):
            return e
    return None


def main():
    if not os.path.isfile(DIST):
        print('FATAL: dist 없음 — python build.py 먼저')
        return 2
    exe = find_edge()
    if not exe:
        print('FATAL: Edge 없음')
        return 2
    if not os.path.isdir(SHOTS):
        os.makedirs(SHOTS)

    html = read(DIST)
    ok = 0
    for name, size, js in SCENES:
        # 씬 스크립트는 부팅이 끝난 뒤에 돌아야 한다
        inject = ('<script>\nwindow.addEventListener("load", function(){ setTimeout(function(){\n'
                  'try{\n' + js + '\n}catch(e){ document.title = "SCENE ERROR: " + e; }\n'
                  '}, 120); });\n</' + 'script>\n')
        i = html.rindex('</body>')
        page = html[:i] + inject + html[i:]
        tmp = tempfile.mkdtemp(prefix='lf-shot-')
        pp = os.path.join(tmp, 'shot.html')
        with io.open(pp, 'w', encoding='utf-8') as f:
            f.write(page)
        outp = os.path.join(SHOTS, name)
        prof = tempfile.mkdtemp(prefix='lf-sp-')
        cmd = [exe, '--headless=new', '--disable-gpu', '--no-sandbox',
               '--user-data-dir=' + prof, '--window-size=' + size,
               '--virtual-time-budget=9000',
               '--screenshot=' + outp, 'file:///' + pp.replace('\\', '/')]
        p = subprocess.run(cmd, capture_output=True, timeout=180)
        shutil.rmtree(prof, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.isfile(outp) and os.path.getsize(outp) > 5000:
            print('  OK   %-22s %7d bytes' % (name, os.path.getsize(outp)))
            ok += 1
        else:
            print('  FAIL %-22s (rc=%s)' % (name, p.returncode))
            print('       ' + p.stderr.decode('utf-8', 'replace')[-600:])
    print('스크린샷 %d/%d → %s' % (ok, len(SCENES), SHOTS))
    return 0 if ok == len(SCENES) else 1


if __name__ == '__main__':
    sys.exit(main())
