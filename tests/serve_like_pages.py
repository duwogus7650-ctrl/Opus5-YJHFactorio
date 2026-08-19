# -*- coding: utf-8 -*-
"""
GitHub Pages 처럼 응답하는 시험용 서버.

왜 필요한가: 기본 http.server 는 Cache-Control 을 안 붙인다. 그러면 브라우저가
매번 새로 받아 오고, **실기기에서 나는 종류의 실패가 시험에서는 안 난다** —
Pages 는 max-age=600 을 보내므로 캐시를 지워도 HTTP 캐시가 10분간 옛 파일을 준다.
서버가 다르면 시험은 우리 코드가 아니라 우리 서버를 잰다.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class PagesHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    ThreadingHTTPServer(('127.0.0.1', port), PagesHandler).serve_forever()
