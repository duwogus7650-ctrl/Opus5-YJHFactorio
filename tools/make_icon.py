# -*- coding: utf-8 -*-
"""홈화면 아이콘 PNG 생성기 — 외부 라이브러리 없이 zlib 로 직접 쓴다.

왜 스크립트로 두나: 아이콘은 배포본 안에 base64 로 박히므로, 나중에 색이나 그림을
고치려면 **어디서 나온 픽셀인지** 알아야 한다. 손으로 만든 base64 덩어리는 그
출처가 사라진다. 이 파일이 그 출처다.

그림: 계기반 팔레트 그대로 — 어두운 판(#1c2024) 위에 밝은 금속 플레이트(#d8d4cc),
그 위에 블루프린트 스틸(#2f5f8f) 로 노드 두 개와 배선, 출력 쪽에 호박색(#e2b21c) 점.
게임의 정체(제어기 = 노드 배선)를 16px 로 줄여도 알아볼 수 있는 최소 형태다.

  python tools/make_icon.py            # 데이터 URI 두 개를 찍는다 (192 / 512)
  python tools/make_icon.py --selftest # 자기 시험: 만든 PNG 가 실제로 읽히는가
"""
import base64
import io
import struct
import sys
import zlib

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BG = (0x1c, 0x20, 0x24)
PLATE = (0xd8, 0xd4, 0xcc)
STEEL = (0x2f, 0x5f, 0x8f)
AMBER = (0xe2, 0xb2, 0x1c)


def draw(n):
    """n x n 픽셀 버퍼를 그린다. 좌표는 전부 비율로 잡아 크기를 바꿔도 같은 그림이 된다."""
    px = [[BG for _ in range(n)] for _ in range(n)]

    def rect(x0, y0, x1, y1, c):
        for y in range(max(0, int(y0)), min(n, int(y1))):
            for x in range(max(0, int(x0)), min(n, int(x1))):
                px[y][x] = c

    def disc(cx, cy, r, c):
        r2 = r * r
        for y in range(max(0, int(cy - r)), min(n, int(cy + r + 1))):
            for x in range(max(0, int(cx - r)), min(n, int(cx + r + 1))):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                    px[y][x] = c

    u = n / 32.0                      # 32 등분 격자
    rect(3 * u, 3 * u, 29 * u, 29 * u, PLATE)        # 금속 플레이트
    rect(5 * u, 5 * u, 27 * u, 27 * u, BG)           # 파인 계기창

    # 노드 두 개와 그 사이 배선 — "신호가 흐른다" 가 아이콘의 내용이다
    rect(8 * u, 11 * u, 13 * u, 15 * u, STEEL)
    rect(19 * u, 17 * u, 24 * u, 21 * u, STEEL)
    rect(13 * u, 12.5 * u, 16 * u, 13.5 * u, STEEL)  # 가로
    rect(15 * u, 12.5 * u, 16 * u, 18.5 * u, STEEL)  # 세로
    rect(16 * u, 18 * u, 19 * u, 19 * u, STEEL)      # 가로
    disc(24.5 * u, 19 * u, 1.6 * u, AMBER)           # 출력 램프
    return px


def png_bytes(px):
    n = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)                                 # 필터 = None
        for (r, g, b) in row:
            raw += bytes((r, g, b))
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', comp)
            + chunk(b'IEND', b''))


def data_uri(n):
    return 'data:image/png;base64,' + base64.b64encode(png_bytes(draw(n))).decode('ascii')


def selftest():
    """만든 PNG 가 **실제로 PNG 인가.** 헤더·청크·크기를 스스로 되읽는다.
    통과 케이스만 보면 깨진 바이트열도 '만들었다' 로 통과한다."""
    bad = []
    for n in (16, 192, 512):
        b = png_bytes(draw(n))
        if b[:8] != b'\x89PNG\r\n\x1a\n':
            bad.append('%d: PNG 서명 아님' % n)
            continue
        w, h = struct.unpack('>II', b[16:24])
        if (w, h) != (n, n):
            bad.append('%d: IHDR 크기 %dx%d' % (n, w, h))
        if b[-8:-4] != b'IEND':
            bad.append('%d: IEND 없음' % n)
        # 압축 해제해 픽셀이 정말 세 색을 담고 있는가 (전부 배경이면 그림이 없는 것)
        idat_start = b.index(b'IDAT') + 4
        idat_len = struct.unpack('>I', b[idat_start - 8:idat_start - 4])[0]
        raw = zlib.decompress(b[idat_start:idat_start + idat_len])
        seen = set()
        stride = n * 3 + 1
        for y in range(n):
            row = raw[y * stride + 1:(y + 1) * stride]
            for x in range(0, len(row), 3):
                seen.add(tuple(row[x:x + 3]))
        for want, name in ((BG, '배경'), (PLATE, '플레이트'), (STEEL, '스틸'), (AMBER, '호박')):
            if want not in seen:
                bad.append('%d: %s 색이 한 픽셀도 없다' % (n, name))
    # 음성 대조군 — 일부러 깨뜨린 바이트열은 반드시 걸려야 한다
    broken = bytearray(png_bytes(draw(16))); broken[1] = 0x00
    if bytes(broken[:8]) == b'\x89PNG\r\n\x1a\n':
        bad.append('음성 대조군: 깨뜨린 서명을 통과시켰다')
    return bad


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        problems = selftest()
        if problems:
            print(' RED — ' + ' · '.join(problems))
            sys.exit(1)
        print(' GREEN — 16/192/512 전부 유효한 PNG 이고 네 색이 다 들어 있다')
        sys.exit(0)
    for size in (192, 512):
        print('%d\t%s' % (size, data_uri(size)))
