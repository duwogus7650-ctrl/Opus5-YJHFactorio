# -*- coding: utf-8 -*-
"""오프라인 검사 — 배포본이 정말로 '단일 HTML 한 장, 의존성 0' 인가.

README 의 첫 줄이 그것을 주장하는데 검정하는 장치가 하나도 없었다. 주장은 검사가
아니고, 외부 참조는 **하나만 들어가도 조용히 깨진다** — 개발 기계에서는 인터넷이
있으니 잘 돌고, 비행기에서 연 사람만 빈 화면을 본다.

무엇을 금지하나
  · 스킴이 붙은 참조(http:, https:) 와 프로토콜 상대 참조(//host/...)
  · 런타임에 네트워크를 여는 호출 (fetch, XMLHttpRequest, WebSocket, sendBeacon,
    importScripts, EventSource)
  · 외부 글꼴·이미지 (url(http...), @import)

무엇을 허용하나
  · data: URI (인라인 자산) · 프래그먼트(#) · 주석 안의 URL 은 예외 없이 **금지**다.
    "주석이니 괜찮다" 를 허용하면 그 예외가 다음엔 코드로 넘어온다. 필요하면 주석에
    URL 대신 이름을 쓴다.

**이 검사에는 음성 대조군이 있다.** 금지 패턴을 하나씩 심은 가짜 문서를 만들어
전부 잡히는지 먼저 확인한다 — 통과만 하는 검사는 검사가 아니다(tasks/lessons/06).
"""
import io
import os
import re
import sys

# 콘솔이 cp949 면 한글·em대시가 깨진다 — harness.py 와 같은 처리를 쓴다.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist', 'Logic-Foundry.html')

# (이름, 정규식, 설명) — 이름은 음성 대조군 표에서 그대로 쓴다
RULES = [
    ('절대 URL', re.compile(r'https?://', re.I),
     '외부 호스트를 가리킨다 — 오프라인에서 안 뜬다'),
    ('프로토콜 상대 URL', re.compile(r'(?<![:\w])//[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/', re.I),
     '//host/ 형태는 페이지 스킴을 따라가 결국 네트워크를 친다'),
    ('fetch 호출', re.compile(r'\bfetch\s*\(', re.I), '런타임에 네트워크를 연다'),
    ('XMLHttpRequest', re.compile(r'\bXMLHttpRequest\b'), '런타임에 네트워크를 연다'),
    ('WebSocket', re.compile(r'\bnew\s+WebSocket\b'), '런타임에 네트워크를 연다'),
    ('EventSource', re.compile(r'\bnew\s+EventSource\b'), '런타임에 네트워크를 연다'),
    ('sendBeacon', re.compile(r'\bsendBeacon\s*\('), '런타임에 네트워크를 연다'),
    ('importScripts', re.compile(r'\bimportScripts\s*\('), '외부 스크립트를 끌어온다'),
    ('@import', re.compile(r'@import\b'), '외부 스타일시트를 끌어온다'),
]

# 음성 대조군 — 각 규칙이 실제로 무언가를 잡는지 먼저 확인한다.
# 여기 문자열은 **일부러** 금지 패턴을 담고 있으므로, 이 파일 자신은 검사 대상이 아니다.
BAIT = {
    '절대 URL': 'x = "ht' + 'tps://cdn.example.com/lib.js";',
    '프로토콜 상대 URL': '<script src="' + '//' + 'cdn.example.com/lib.js"></script>',
    'fetch 호출': 'fetch' + '("/api")',
    'XMLHttpRequest': 'var r = new XML' + 'HttpRequest();',
    'WebSocket': 'var w = new Web' + 'Socket("ws://x");',
    'EventSource': 'var e = new Event' + 'Source("/s");',
    'sendBeacon': 'navigator.send' + 'Beacon("/b");',
    'importScripts': 'import' + 'Scripts("w.js");',
    '@import': '@im' + 'port url(other.css);',
}


def scan(text):
    """(규칙이름, 줄번호, 줄내용) 목록."""
    hits = []
    lines = text.split('\n')
    for name, rx, _why in RULES:
        for i, line in enumerate(lines):
            if rx.search(line):
                hits.append((name, i + 1, line.strip()[:110]))
    return hits


def selftest():
    """각 규칙이 자기 미끼를 잡는가. 하나라도 못 잡으면 이 검사는 무의미하다."""
    broken = []
    for name, bait in BAIT.items():
        found = [h for h in scan(bait) if h[0] == name]
        if not found:
            broken.append(name)
    # 반대쪽도 본다 — 깨끗한 문서에서 아무것도 안 잡혀야 한다(무오탐)
    clean = '<html><body><script>var a = 1; var b = "data:image/png;base64,AAA";</script></body></html>'
    false_hits = scan(clean)
    return broken, false_hits


def main():
    print('=' * 92)
    print(' 오프라인 검사 — 단일 HTML 한 장, 의존성 0 인가')
    print('=' * 92)

    broken, false_hits = selftest()
    if broken:
        print(' RED — 검사 자신이 고장났다. 못 잡는 규칙: %s' % ', '.join(broken))
        return 2
    if false_hits:
        print(' RED — 깨끗한 문서에서 %d건을 잘못 잡았다: %s' % (len(false_hits), false_hits[:3]))
        return 2
    print(' 자기 시험 GREEN — 규칙 %d개가 각자의 미끼를 잡고, 깨끗한 문서는 통과시킨다'
          % len(RULES))

    if not os.path.exists(DIST):
        print(' FATAL: dist 가 없다 — python build.py 먼저')
        return 2
    with io.open(DIST, encoding='utf-8') as fh:
        html = fh.read()

    hits = scan(html)
    print('-' * 92)
    print(' 배포본 %s (%d KB)' % (os.path.basename(DIST), len(html) // 1024))
    if not hits:
        print('-' * 92)
        print(' GREEN — 외부 참조 0건. 인터넷 없이 파일 하나로 돈다.')
        return 0

    for name, ln, text in hits:
        why = [w for n, _r, w in RULES if n == name][0]
        print('  [FAIL] %-14s %d행: %s' % (name, ln, text))
        print('         %s' % why)
    print('-' * 92)
    print(' RED — 외부 참조 %d건. "의존성 0 · 오프라인" 이 더는 사실이 아니다.' % len(hits))
    return 1


if __name__ == '__main__':
    sys.exit(main())
