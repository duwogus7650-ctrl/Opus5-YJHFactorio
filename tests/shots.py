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
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist', 'Logic-Foundry.html')
SHOTS = os.path.join(ROOT, 'shots')

EDGE = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']

# 각 장면: (파일명, 창크기, 주입할 JS)
SCENES = []

# 배치 규약: 전주는 5의 배수 격자점에만 둔다. 건물은 (5k+1 ..) 에서 시작해 3칸 이하로
# 뻗으므로 격자점을 절대 밟지 않는다. 이걸 안 지키면 3x3 건물이 전주와 겹쳐 조용히
# 배치에 실패하고, 스크린샷에서 "안 그려진 것"처럼 보인다 (첫 촬영에서 실제로 그랬다).
FACTORY = r"""
var G = window.__GAME;
G.reset(424242); G.clearEntities(); G.clearEnemies(); G.giveAll(9999);
G.ui.closeHelp();
for (var y=70;y<=90;y+=5) for (var x=70;x<=95;x+=5) G.place('pole', x, y, 0);
var g = G.place('generator', 81, 86, 0); G.setFuel(g, 4000*600);

// 제련 라인: 상자 → 인서터 → 용광로 → 인서터 → 벨트 → 인서터 → 상자
var src = G.place('chest', 68, 71, 0); G.fillChest(src,'iron-ore',600);
G.place('inserter', 69, 71, 1);
G.place('furnace', 70, 71, 1);
G.place('inserter', 72, 71, 1);
var belts = [];
for (var i=0;i<12;i++) { var b=G.place('belt', 73+i, 71, 1); if(b) belts.push(b); }
G.place('inserter', 85, 71, 1);
G.place('chest', 86, 71, 0);

// 조립 라인
var src2 = G.place('chest', 68, 76, 0); G.fillChest(src2,'iron-plate',900);
G.place('inserter', 69, 76, 1);
var a1 = G.place('assembler', 70, 76, 1); G.setRecipe(a1,'gear');
G.place('inserter', 73, 76, 1);
for (var j=0;j<11;j++) G.place('belt', 74+j, 76, 1);
G.place('inserter', 85, 76, 1);
G.place('chest', 86, 76, 0);

// 채광 라인 — 스폰 근처 철광맥
var sp = G.oreSpotNear('iron-ore', 84, 84);
if (sp) { G.place('pole', 90, 85, 0); G.place('miner', sp.x, sp.y, 1); }

// 연구소 + 제어기
var lab = G.place('lab', 70, 81, 1); G.fillChest(lab,'sci-red',60);
G.setResearch('logistics');
G.place('controller', 76, 81, 0);

// 방어
G.research('military');
var t1 = G.place('turret', 88, 81, 1); G.setAmmo(t1, 120);
for (var w=0; w<10; w++) G.place('wall', 93, 74+w, 0);
G.spawnEnemyAt(97, 76, 0); G.spawnEnemyAt(98, 80, 1); G.spawnEnemyAt(96, 83, 0);
G.run(45);
G.center(80, 78); G.setZoom(1.15);
G.ui.refresh(); G.render();
"""

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
