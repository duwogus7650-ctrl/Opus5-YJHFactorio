// 문법 검사 — 빌드된 HTML 안의 인라인 스크립트를 실제로 파싱해 본다.
// (파일별로 따로 검사하면 IIFE 로 합쳐졌을 때만 나는 오류를 못 잡는다.)
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var dist = path.join(__dirname, '..', 'dist', 'Logic-Foundry.html');
if (!fs.existsSync(dist)) { console.error('FATAL: dist 가 없다 — python build.py 먼저'); process.exit(2); }
var html = fs.readFileSync(dist, 'utf8');

var re = /<script>([\s\S]*?)<\/script>/g;
var m, n = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  n++;
  try {
    new vm.Script(m[1], { filename: 'inline#' + n });
    console.log('  [PASS] inline script #' + n + '  (' + m[1].length + ' bytes)');
  } catch (e) {
    bad++;
    console.error('  [FAIL] inline script #' + n + ': ' + e.message);
    // 오류 줄 주변을 보여준다 — 어느 소스 파일인지 헤더 주석으로 알 수 있다
    var lines = m[1].split('\n');
    var lm = /inline#\d+:(\d+)/.exec(e.stack || '');
    var ln = lm ? parseInt(lm[1], 10) : 0;
    if (ln) {
      for (var i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 3); i++) {
        console.error('    ' + (i + 1 === ln ? '>>' : '  ') + ' ' + (i + 1) + ': ' + lines[i]);
      }
      for (var j = ln; j >= 0; j--) {
        if (/^\/\* =+ .+ =+ \*\/$/.test(lines[j].trim())) { console.error('    소스 파일: ' + lines[j].trim()); break; }
      }
    }
  }
}
if (n === 0) { console.error('FATAL: 인라인 스크립트를 하나도 못 찾았다'); process.exit(2); }
console.log(bad ? ('SYNTAX RED — ' + bad + '/' + n + ' 실패') : ('SYNTAX GREEN — ' + n + '개 전부 파싱'));
process.exit(bad ? 1 : 0);
