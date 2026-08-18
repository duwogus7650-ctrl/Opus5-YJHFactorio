// ===========================================================================
//  00_core.js — 상수, 결정론 난수, 수학, 오류 수집
//
//  설계 규칙 (과거 실패 원장에서 옮겨온 것):
//   * 누산기는 선언 시 반드시 0으로 초기화한다. undefined + dt = NaN 은 예외 없이
//     번지고 렌더는 조용히 성공한다.
//   * 난수는 "먼저 뽑고 나중에 자리를 찾는다". 풀 점유율이 난수 소비량을 바꾸면
//     결정론이 깨진다.
//   * 프로토타입 상속은 쓰지 않는다 — Object.create 재할당으로 메서드가 조용히
//     사라진 적이 있다. 전부 팩토리 함수로 만든다.
// ===========================================================================

var VERSION = '1.0.0';
// **빌드 도장.** 빌드가 소스 전체의 해시로 채워 넣는다(dev 는 아직 안 박힌 상태다).
// 왜 있나: 폰이 캐시된 예전 사본을 열고 있어도 화면만 봐서는 알 수 없다 —
// '복제 버튼이 안 보인다'가 코드 문제인지 사본 문제인지 가르는 데 반나절이 든다.
// 도움말 맨 아래에 이 값을 찍어 두면 한 줄로 갈린다.
var BUILD_ID = 'dev';

var TILE = 32;            // 타일 한 변 픽셀 (레퍼런스 스크린샷과 동일 배율)
var W = 160;              // 월드 가로 타일 수
var H = 160;              // 월드 세로 타일 수
var TICK = 1 / 60;        // 고정 시뮬 스텝 (Factorio 와 같은 60 UPS)
var MAX_STEPS = 8;        // 한 프레임에 밀어넣을 수 있는 최대 스텝 (나선 방지)

// --- 방향 ------------------------------------------------------------------
// 0=북(위), 1=동, 2=남, 3=서.  화면 좌표계는 y가 아래로 증가한다.
var DIR_DX = [0, 1, 0, -1];
var DIR_DY = [-1, 0, 1, 0];
var DIR_NAME = ['북', '동', '남', '서'];

function dirOpp(d) { return (d + 2) & 3; }
function dirCW(d) { return (d + 1) & 3; }
function dirCCW(d) { return (d + 3) & 3; }

// --- 결정론 난수 -----------------------------------------------------------
// mulberry32. 시드 하나로 전체 수열이 결정된다. 게임 로직용(RNG)과 연출용(FX_RNG)을
// 물리적으로 분리하되, 연출 쪽은 "뽑고 나서 자리를 찾는" 규약을 지켜야 의미가 있다.
function makeRng(seed) {
  var s = seed >>> 0;
  var draws = 0;
  return {
    next: function () {
      draws++;
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int: function (n) { return Math.floor(this.next() * n); },
    range: function (a, b) { return a + this.next() * (b - a); },
    pick: function (arr) { return arr[Math.floor(this.next() * arr.length)]; },
    reseed: function (v) { s = v >>> 0; draws = 0; },
    draws: function () { return draws; }
  };
}

var RNG = makeRng(20260807);      // 게임 로직 전용
var FX_RNG = makeRng(991);        // 연출 전용 — 게임 수열을 절대 건드리지 않는다

// --- 수학 ------------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

// 값 잡음 — 지형/광맥 생성용. 시드에 대해 결정론.
function makeNoise(seed) {
  var rng = makeRng(seed);
  var P = new Float32Array(256 * 256);
  for (var i = 0; i < P.length; i++) P[i] = rng.next();
  function at(ix, iy) { return P[((iy & 255) << 8) | (ix & 255)]; }
  function smooth(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    // smoothstep — 격자 이음매가 각지지 않게
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }
  return {
    // 옥타브 합성. amp 합으로 나눠 항상 0..1 을 유지한다.
    fbm: function (x, y, oct, freq) {
      var v = 0, amp = 1, sum = 0, f = freq || 1;
      for (var o = 0; o < (oct || 3); o++) {
        v += smooth(x * f, y * f) * amp;
        sum += amp; amp *= 0.5; f *= 2;
      }
      return v / sum;
    },
    raw: smooth
  };
}

// --- 색 --------------------------------------------------------------------
function rgb(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
function rgba(r, g, b, a) { return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')'; }

// hex → [r,g,b]
function hex2rgb(h) {
  var n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(h, f) {
  var c = hex2rgb(h);
  return rgb(clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255));
}

// --- 오류 수집 -------------------------------------------------------------
// 게임 루프 안에서 터진 예외는 화면을 멈추게 하지 말고 모아 둔다. 검증 하네스가
// 이 배열을 출력 계약으로 읽는다 (콘솔 문자열 눈대중 금지).
var ERRORS = [];
function logError(where, e) {
  var msg = where + ': ' + ((e && e.stack) ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e));
  if (ERRORS.length < 60) ERRORS.push(msg);
}
function guard(where, fn) {
  try { fn(); } catch (e) { logError(where, e); }
}

// --- 소형 유틸 -------------------------------------------------------------
function fmt(n, d) {
  if (!isFinite(n)) return '—';
  var p = Math.pow(10, d || 0);
  return String(Math.round(n * p) / p);
}
// 1234 -> "1.2k". 수치 판독은 등폭 글꼴로 그린다.
function fmtShort(n) {
  var a = Math.abs(n);
  if (a >= 1e9) return fmt(n / 1e9, 1) + 'G';
  if (a >= 1e6) return fmt(n / 1e6, 1) + 'M';
  if (a >= 1e3) return fmt(n / 1e3, 1) + 'k';
  return fmt(n, 0);
}
function fmtTime(s) {
  var m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + (ss < 10 ? '0' : '') + ss;
}

// 얕은 병합으로는 규칙의 when/then 을 통째로 덮어써 나머지 칸이 사라진다.
function deepMerge(dst, src) {
  for (var k in src) {
    var v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) deepMerge(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}

function idx(x, y) { return y * W + x; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
