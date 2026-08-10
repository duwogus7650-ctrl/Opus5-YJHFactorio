// ===========================================================================
//  45_render.js — Canvas2D 렌더러
//
//  좌표계: 캔버스 변환을 걸어 "타일 단위"로 그린다. 1 유닛 = 1 타일.
//  선 굵기·반지름도 전부 타일 단위라 확대해도 비율이 유지된다.
//  글자만 화면 좌표로 되돌려 그린다 (작은 폰트가 변환에서 깨지므로).
//
//  시각 문법은 레퍼런스 스크린샷(Factorio wiki)에서 읽은 것을 따른다:
//    · 벨트 = 어두운 트레드 띠 + 노란 셰브론, 아이템은 좌우 2레인에 실린다
//    · 인서터 = 피벗 원 + 뒤에서 앞으로 도는 팔, 끝에 아이템을 쥔다
//    · 기계 = 회색 금속 몸체 + 검은 외곽 + 노란 위험 줄무늬, 위에 레시피 아이콘
//    · 전주 = 기둥 + 전주끼리 늘어지는 구리색 현수선
//    · 광맥 = 땅에 흩뿌린 돌덩이, 매장량이 많을수록 촘촘
// ===========================================================================

var cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0 };
var cv = null, ctx = null;
var frameCount = 0;

var COL = {
  grass: ['#41522c', '#485a31', '#3b4a28', '#4e6136'],
  grassDot: 'rgba(255,255,255,0.045)',
  belt: '#35363a',
  beltEdge: '#212226',
  beltTread: '#4a4b50',
  chev: '#f0c419',
  metal: '#6d7278',
  metalDark: '#464a50',
  metalLite: '#8d949c',
  outline: '#1a1c20',
  hazardA: '#e2b21c',
  hazardB: '#26272b',
  glow: '#ff9a2e',
  wire: '#c8752b',
  steel: '#2f5f8f',
  amber: '#f0a92b',
  enemy: '#7a4fc0',
  nest: '#3d2650'
};

function hash2(x, y) {
  var h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function initRender(canvas) {
  cv = canvas;
  ctx = cv.getContext('2d', { alpha: false });
  resizeCanvas();
  cam.x = world.spawnX; cam.y = world.spawnY; cam.z = 1;
}
function resizeCanvas() {
  if (!cv) return;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var w = cv.clientWidth || 1280, h = cv.clientHeight || 720;
  cv.width = Math.max(2, Math.round(w * dpr));
  cv.height = Math.max(2, Math.round(h * dpr));
  cam.dpr = dpr;
}
function viewScale() { return TILE * cam.z * (cam.dpr || 1); }
function screenOf(wx, wy) {
  var s = viewScale();
  return { x: (wx - cam.x) * s + cv.width / 2, y: (wy - cam.y) * s + cv.height / 2 };
}
function worldOf(sx, sy) {
  var s = viewScale(), d = cam.dpr || 1;
  return { x: (sx * d - cv.width / 2) / s + cam.x, y: (sy * d - cv.height / 2) / s + cam.y };
}
function visibleBounds() {
  var s = viewScale();
  var halfW = cv.width / 2 / s, halfH = cv.height / 2 / s;
  return {
    x0: Math.max(0, Math.floor(cam.x - halfW) - 1), x1: Math.min(W - 1, Math.ceil(cam.x + halfW) + 1),
    y0: Math.max(0, Math.floor(cam.y - halfH) - 1), y1: Math.min(H - 1, Math.ceil(cam.y + halfH) + 1)
  };
}

// --- 기본 도형 (타일 단위) ---------------------------------------------------
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function body(x, y, w, h, fill, edge) {
  ctx.fillStyle = fill; rr(x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.1); ctx.fill();
  ctx.lineWidth = 0.07; ctx.strokeStyle = edge || COL.outline; ctx.stroke();
  // 위쪽 하이라이트 — 금속 느낌
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x + 0.12, y + 0.12, w - 0.24, 0.13);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + 0.12, y + h - 0.26, w - 0.24, 0.14);
}
// 노란 위험 줄무늬 띠 — 레퍼런스의 기계 테두리에 항상 있는 요소
function hazard(x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  var step = 0.22;
  for (var i = -h; i < w + h; i += step * 2) {
    ctx.fillStyle = COL.hazardA;
    ctx.beginPath();
    ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + step, y + h);
    ctx.lineTo(x + i + step + h, y); ctx.lineTo(x + i + h, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h * 0.18);
  ctx.restore();
}
function shadowUnder(x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  rr(x + 0.12, y + 0.22, w - 0.1, h - 0.05, 0.12); ctx.fill();
}

// --- 지형 --------------------------------------------------------------------
function drawTerrain(b) {
  for (var y = b.y0; y <= b.y1; y++) {
    for (var x = b.x0; x <= b.x1; x++) {
      var i = idx(x, y);
      ctx.fillStyle = COL.grass[world.terr[i]];
      ctx.fillRect(x, y, 1.02, 1.02);
    }
  }
  // 얼룩 — 같은 색 타일이 넓게 붙으면 격자가 그대로 보인다. 타일 해시로 결정하므로
  // 난수 상태를 건드리지 않고, 프레임마다 같은 자리에 찍힌다.
  for (var y3 = b.y0; y3 <= b.y1; y3++) {
    for (var x3 = b.x0; x3 <= b.x1; x3++) {
      var hb = hash2(x3 + 313, y3 + 977);
      if (hb < 0.62) continue;
      ctx.fillStyle = hb > 0.85 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.055)';
      var bx = x3 + hash2(x3 + 5, y3) * 0.4, by = y3 + hash2(x3, y3 + 5) * 0.4;
      ctx.beginPath();
      ctx.ellipse(bx + 0.3, by + 0.3, 0.36 + hb * 0.22, 0.26 + hb * 0.2, hb * 3, 0, 6.283);
      ctx.fill();
    }
  }
  // 잔디 반점
  ctx.fillStyle = COL.grassDot;
  for (var y2 = b.y0; y2 <= b.y1; y2++) {
    for (var x2 = b.x0; x2 <= b.x1; x2++) {
      var h1 = hash2(x2, y2), h2 = hash2(x2 + 91, y2 + 17);
      if (h1 > 0.55) ctx.fillRect(x2 + h1 * 0.8, y2 + h2 * 0.8, 0.09, 0.06);
      if (h2 > 0.72) ctx.fillRect(x2 + h2 * 0.7 + 0.1, y2 + h1 * 0.7, 0.07, 0.05);
      if (h1 > 0.80) {   // 풀포기
        ctx.strokeStyle = 'rgba(180,205,140,0.16)'; ctx.lineWidth = 0.03;
        var gx2 = x2 + h2 * 0.7 + 0.15, gy2 = y2 + h1 * 0.6 + 0.2;
        ctx.beginPath();
        ctx.moveTo(gx2, gy2); ctx.lineTo(gx2 - 0.06, gy2 - 0.16);
        ctx.moveTo(gx2, gy2); ctx.lineTo(gx2 + 0.07, gy2 - 0.14);
        ctx.stroke();
        ctx.fillStyle = COL.grassDot;
      }
    }
  }
}

function drawOre(b) {
  for (var y = b.y0; y <= b.y1; y++) {
    for (var x = b.x0; x <= b.x1; x++) {
      var i = idx(x, y);
      var amt = world.oreAmt[i];
      if (!amt) continue;
      var t = world.ore[i];
      var base = ORE_COLOR[t];
      var dens = clamp(amt / 3000, 0.18, 1);
      var n = 2 + Math.round(dens * 5);
      for (var k = 0; k < n; k++) {
        var hx = hash2(x * 7 + k, y * 13), hy = hash2(x * 3 + k * 5, y * 11 + k);
        var r = 0.09 + hash2(x + k, y - k) * 0.10;
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.arc(x + 0.12 + hx * 0.76, y + 0.12 + hy * 0.76, r, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.arc(x + 0.10 + hx * 0.76, y + 0.09 + hy * 0.76, r * 0.42, 0, 6.283);
        ctx.fill();
      }
    }
  }
}

function drawTrees(b) {
  for (var y = b.y0; y <= b.y1; y++) {
    for (var x = b.x0; x <= b.x1; x++) {
      var v = world.tree[idx(x, y)];
      if (!v) continue;
      var hx = hash2(x, y) * 0.3, hy = hash2(y, x) * 0.3;
      var cx = x + 0.5 + hx - 0.15, cy = y + 0.5 + hy - 0.15;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.ellipse(cx + 0.1, cy + 0.22, 0.38, 0.16, 0, 0, 6.283); ctx.fill();
      var tone = ['#28401f', '#2f4a24', '#22381b'][v - 1];
      ctx.fillStyle = tone;
      ctx.beginPath(); ctx.arc(cx, cy, 0.40, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(cx - 0.12, cy - 0.14, 0.20, 0, 6.283); ctx.fill();
    }
  }
}

// --- 벨트 --------------------------------------------------------------------
var beltPhase = 0;
function drawBeltCell(c) {
  var x = c.tx, y = c.ty, d = c.dir;
  ctx.save();
  ctx.translate(x + 0.5, y + 0.5);
  ctx.rotate(d * Math.PI / 2);          // 0=북 기준으로 회전. 내부는 "위로 흐른다"고 그린다
  ctx.fillStyle = COL.beltEdge; ctx.fillRect(-0.5, -0.5, 1, 1);
  ctx.fillStyle = COL.belt; ctx.fillRect(-0.44, -0.5, 0.88, 1);
  // 트레드 — 흐르는 방향으로 움직인다
  ctx.fillStyle = COL.beltTread;
  var ph = (beltPhase * beltSpeed()) % 0.25;
  for (var t = -0.5 - 0.25; t < 0.5; t += 0.25) {
    var yy = t + (0.25 - ph);
    if (yy > 0.5 || yy < -0.5) continue;
    ctx.fillRect(-0.44, yy, 0.88, 0.05);
  }
  // 노란 셰브론
  ctx.fillStyle = c.gate ? COL.chev : '#7a5f12';
  var cph = (beltPhase * beltSpeed() * 1) % 0.5;
  for (var s = -0.5 - 0.5; s < 0.6; s += 0.5) {
    var cy2 = s + (0.5 - cph);
    if (cy2 > 0.46 || cy2 < -0.52) continue;
    ctx.beginPath();
    ctx.moveTo(-0.20, cy2 + 0.13); ctx.lineTo(0, cy2 - 0.05); ctx.lineTo(0.20, cy2 + 0.13);
    ctx.lineTo(0.20, cy2 + 0.20); ctx.lineTo(0, cy2 + 0.02); ctx.lineTo(-0.20, cy2 + 0.20);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.05;
  ctx.strokeRect(-0.46, -0.5, 0.92, 1);
  ctx.restore();
}

function drawItemShape(id, wx, wy, scale) {
  var it = ITEMS[id];
  if (!it) return;
  var s = (scale || 1) * 0.20;
  ctx.fillStyle = it.color;
  switch (it.shape) {
    case 'plate':
      ctx.fillRect(wx - s, wy - s * 0.72, s * 2, s * 1.44);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(wx - s, wy - s * 0.72, s * 2, s * 0.34);
      break;
    case 'rock':
      ctx.beginPath();
      ctx.moveTo(wx - s, wy); ctx.lineTo(wx - s * 0.4, wy - s);
      ctx.lineTo(wx + s * 0.7, wy - s * 0.6); ctx.lineTo(wx + s, wy + s * 0.4);
      ctx.lineTo(wx - s * 0.2, wy + s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(wx - s * 0.25, wy - s * 0.3, s * 0.35, 0, 6.283); ctx.fill();
      break;
    case 'gear':
      ctx.beginPath(); ctx.arc(wx, wy, s, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2a2d31';
      ctx.beginPath(); ctx.arc(wx, wy, s * 0.36, 0, 6.283); ctx.fill();
      ctx.fillStyle = it.color;
      for (var g = 0; g < 6; g++) {
        var a = g * 1.047;
        ctx.fillRect(wx + Math.cos(a) * s * 0.95 - s * 0.16, wy + Math.sin(a) * s * 0.95 - s * 0.16, s * 0.32, s * 0.32);
      }
      break;
    case 'wire':
      ctx.lineWidth = s * 0.45; ctx.strokeStyle = it.color;
      ctx.beginPath();
      ctx.moveTo(wx - s, wy + s * 0.5);
      ctx.quadraticCurveTo(wx, wy - s * 1.1, wx + s, wy + s * 0.5);
      ctx.stroke();
      break;
    case 'chip':
      ctx.fillRect(wx - s * 0.9, wy - s * 0.7, s * 1.8, s * 1.4);
      ctx.fillStyle = '#d9c15a';
      for (var p = -1; p <= 1; p++) ctx.fillRect(wx - s * 0.9 + (p + 1) * s * 0.6, wy - s * 1.0, s * 0.22, s * 0.3);
      break;
    case 'ammo':
      ctx.fillRect(wx - s * 0.55, wy - s, s * 1.1, s * 2);
      ctx.fillStyle = '#e8c14a';
      ctx.fillRect(wx - s * 0.55, wy + s * 0.3, s * 1.1, s * 0.7);
      break;
    case 'flask':
      ctx.beginPath();
      ctx.moveTo(wx - s * 0.35, wy - s); ctx.lineTo(wx + s * 0.35, wy - s);
      ctx.lineTo(wx + s * 0.8, wy + s); ctx.lineTo(wx - s * 0.8, wy + s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(wx - s * 0.35, wy - s * 1.15, s * 0.7, s * 0.25);
      break;
    default:
      ctx.beginPath(); ctx.arc(wx, wy, s, 0, 6.283); ctx.fill();
  }
}

function drawBeltItems(c) {
  var d = c.dir;
  var fx = DIR_DX[d], fy = DIR_DY[d];
  var lv = [dirCCW(d), dirCW(d)];        // lane0 = 왼쪽, lane1 = 오른쪽
  for (var li = 0; li < 2; li++) {
    var ox = DIR_DX[lv[li]] * 0.25, oy = DIR_DY[lv[li]] * 0.25;
    var lane = c.lanes[li];
    for (var i = 0; i < lane.length; i++) {
      var p = lane[i].pos;
      var wx = c.tx + 0.5 + fx * (p - 0.5) + ox;
      var wy = c.ty + 0.5 + fy * (p - 0.5) + oy;
      drawItemShape(lane[i].id, wx, wy, 1);
    }
  }
}

// --- 건물 --------------------------------------------------------------------
function drawArrow(x, y, w, h, d, col) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(d * Math.PI / 2);
  ctx.fillStyle = col || COL.chev;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 + 0.10); ctx.lineTo(0.17, -h / 2 + 0.32); ctx.lineTo(-0.17, -h / 2 + 0.32);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawEntity(e) {
  var x = e.tx, y = e.ty, w = e.w, h = e.h;
  switch (e.type) {
    case 'belt': case 'splitter': return;   // 벨트는 따로 그린다
    case 'inserter': drawInserter(e); return;
    case 'pole': drawPole(e); return;
    // 파이프는 벨트처럼 1칸짜리라 그림자·몸통 규격을 안 쓴다. 이웃한 유체 설비
    // 쪽으로만 목을 뻗어, **어디가 이어졌는지 화면에서 바로 보이게** 한다 —
    // 유체망은 맞닿음이 규칙이므로 그게 곧 규칙의 시각화다.
    case 'rail': {
      // 침목 + 두 줄 레일. 이웃한 레일 쪽으로 이어 그려서 **연결이 눈에 보이게** 한다 —
      // 맞닿음이 규칙이므로 그림이 곧 규칙의 설명이다.
      ctx.fillStyle = '#4a4238';
      for (var rs = 0; rs < 3; rs++) ctx.fillRect(x + 0.12, y + 0.18 + rs * 0.28, 0.76, 0.1);
      ctx.fillStyle = '#8d949c';
      var rN = isRail(x, y - 1), rS = isRail(x, y + 1);
      var rW = isRail(x - 1, y), rE = isRail(x + 1, y);
      if (rN || rS || (!rW && !rE)) {
        ctx.fillRect(x + 0.28, y + (rN ? 0 : 0.1), 0.07, 1 - (rN ? 0 : 0.1) - (rS ? 0 : 0.1));
        ctx.fillRect(x + 0.65, y + (rN ? 0 : 0.1), 0.07, 1 - (rN ? 0 : 0.1) - (rS ? 0 : 0.1));
      }
      if (rW || rE) {
        ctx.fillRect(x + (rW ? 0 : 0.1), y + 0.28, 1 - (rW ? 0 : 0.1) - (rE ? 0 : 0.1), 0.07);
        ctx.fillRect(x + (rW ? 0 : 0.1), y + 0.65, 1 - (rW ? 0 : 0.1) - (rE ? 0 : 0.1), 0.07);
      }
      return;
    }
    case 'station': {
      ctx.fillStyle = '#5a4a3a'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(x + 0.12, y + 0.12, 0.76, 0.2);
      ctx.fillStyle = '#8d949c'; ctx.fillRect(x + 0.16, y + 0.42, 0.68, 0.42);
      // 열차가 서 있으면 초록, 붙잡혀 있으면 호박색 — 배차 상태가 지도에서 보인다
      var stTr = trainAtStation(e);
      ctx.fillStyle = stTr ? (e.holdTrain ? COL.amber : '#3fae5a') : '#3a3f45';
      ctx.fillRect(x + 0.34, y + 0.52, 0.32, 0.22);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05;
      ctx.strokeRect(x + 0.04, y + 0.04, 0.92, 0.92);
      return;
    }
    case 'pipe': {
      ctx.fillStyle = '#59636b';
      ctx.fillRect(x + 0.28, y + 0.28, 0.44, 0.44);
      for (var pd = 0; pd < 4; pd++) {
        var nb = entityAt(x + DIR_DX[pd], y + DIR_DY[pd]);
        if (!nb || !BUILDINGS[nb.type] || !BUILDINGS[nb.type].fluid) continue;
        ctx.fillRect(x + 0.28 + DIR_DX[pd] * 0.36, y + 0.28 + DIR_DY[pd] * 0.36, 0.44, 0.44);
      }
      ctx.strokeStyle = 'rgba(20,24,28,0.55)'; ctx.lineWidth = 0.04;
      ctx.strokeRect(x + 0.28, y + 0.28, 0.44, 0.44);
      ctx.fillStyle = 'rgba(150,205,235,0.5)';
      ctx.fillRect(x + 0.38, y + 0.38, 0.24, 0.24);
      return;
    }
    case 'pump': {
      ctx.fillStyle = '#4a5a64'; ctx.fillRect(x + 0.06, y + 0.06, 0.88, 0.88);
      ctx.fillStyle = '#9aa6ae'; ctx.fillRect(x + 0.2, y + 0.2, 0.6, 0.6);
      // 물을 퍼 올리는 중이면 도는 표시 — 정지와 가동을 화면에서 구별한다
      var pa = e.working ? e.anim * 6 : 0;
      ctx.save(); ctx.translate(x + 0.5, y + 0.5); ctx.rotate(pa);
      ctx.fillStyle = '#2f6d8f';
      ctx.fillRect(-0.30, -0.07, 0.60, 0.14);
      ctx.fillRect(-0.07, -0.30, 0.14, 0.60);
      ctx.restore();
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05;
      ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
      return;
    }
    case 'wall': {
      ctx.fillStyle = '#7a6a58'; ctx.fillRect(x + 0.02, y + 0.02, 0.96, 0.96);
      ctx.fillStyle = '#95836d'; ctx.fillRect(x + 0.08, y + 0.08, 0.84, 0.36);
      ctx.fillStyle = '#5d5044'; ctx.fillRect(x + 0.08, y + 0.52, 0.84, 0.36);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05;
      ctx.strokeRect(x + 0.02, y + 0.02, 0.96, 0.96);
      return;
    }
  }
  shadowUnder(x, y, w, h);

  if (e.type === 'miner') {
    body(x, y, w, h, COL.metal);
    hazard(x + 0.14, y + 0.14, w - 0.28, 0.22);
    ctx.fillStyle = COL.metalDark;
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2 + 0.08, 0.44, 0, 6.283); ctx.fill();
    // 회전 드릴
    var a = e.anim * 4;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2 + 0.08); ctx.rotate(a);
    ctx.fillStyle = COL.metalLite;
    for (var k = 0; k < 3; k++) {
      ctx.save(); ctx.rotate(k * 2.094);
      ctx.fillRect(-0.06, -0.40, 0.12, 0.40);
      ctx.restore();
    }
    ctx.restore();
    drawArrow(x, y, w, h, e.dir);
    if (e.depleted) drawWarn(x, y, w, '광맥 고갈');
  } else if (e.type === 'furnace') {
    body(x, y, w, h, '#6a6560');
    ctx.fillStyle = '#3a352f'; ctx.fillRect(x + 0.28, y + h - 0.72, w - 0.56, 0.5);
    var glow = e.working ? 1 : 0.15;
    var gr = ctx.createRadialGradient(x + w / 2, y + h - 0.47, 0.02, x + w / 2, y + h - 0.47, 0.55);
    gr.addColorStop(0, 'rgba(255,190,80,' + (0.95 * glow) + ')');
    gr.addColorStop(1, 'rgba(255,90,10,0)');
    ctx.fillStyle = gr; ctx.fillRect(x + 0.1, y + h - 1.0, w - 0.2, 0.9);
    hazard(x + 0.16, y + 0.16, w - 0.32, 0.2);
  } else if (e.type === 'assembler') {
    body(x, y, w, h, COL.metal);
    hazard(x + 0.16, y + 0.16, w - 0.32, 0.22);
    ctx.fillStyle = COL.metalDark;
    rr(x + 0.5, y + 0.7, w - 1.0, h - 1.2, 0.12); ctx.fill();
    var ang = e.working ? e.anim * 3 : 0;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2 + 0.1); ctx.rotate(ang);
    ctx.strokeStyle = COL.metalLite; ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, 6.283); ctx.stroke();
    for (var g2 = 0; g2 < 8; g2++) {
      var aa = g2 * 0.785;
      ctx.fillStyle = COL.metalLite;
      ctx.fillRect(Math.cos(aa) * 0.52 - 0.07, Math.sin(aa) * 0.52 - 0.07, 0.14, 0.14);
    }
    ctx.restore();
  } else if (e.type === 'generator') {
    body(x, y, w, h, '#5f6a72');
    hazard(x + 0.16, y + 0.16, w - 0.32, 0.2);
    // 플라이휠
    ctx.save(); ctx.translate(x + w / 2, y + h / 2 + 0.15);
    ctx.rotate(e.anim * (e.working ? 9 : 0));
    ctx.strokeStyle = '#8d949c'; ctx.lineWidth = 0.16;
    ctx.beginPath(); ctx.arc(0, 0, 0.62, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 0.1;
    for (var s2 = 0; s2 < 4; s2++) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(s2 * 1.5708) * 0.62, Math.sin(s2 * 1.5708) * 0.62); ctx.stroke();
    }
    ctx.restore();
    // 연료 게이지
    var ff = clamp(e.fuel / (SPEC.coalEnergy * 20), 0, 1);
    ctx.fillStyle = '#20232a'; ctx.fillRect(x + 0.3, y + h - 0.42, w - 0.6, 0.2);
    ctx.fillStyle = ff > 0.15 ? COL.amber : '#c0392b';
    ctx.fillRect(x + 0.32, y + h - 0.40, (w - 0.64) * ff, 0.16);
    if (e.fuel <= 0) drawWarn(x, y, w, '연료 없음');
  } else if (e.type === 'boiler') {
    body(x, y, w, h, '#6b5a52');
    // 가로로 누운 드럼 — 발전기의 플라이휠과 한눈에 갈리게 형태를 다르게 둔다
    ctx.fillStyle = '#8a7468';
    rr(x + 0.16, y + 0.34, w - 0.32, h - 0.72, 0.3); ctx.fill();
    ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05; ctx.stroke();
    hazard(x + 0.16, y + 0.12, w - 0.32, 0.18);
    // 불길 — 태우는 중에만
    var bg = e.working ? 1 : 0.12;
    var bgr = ctx.createRadialGradient(x + w / 2, y + h - 0.3, 0.02, x + w / 2, y + h - 0.3, 0.5);
    bgr.addColorStop(0, 'rgba(255,170,60,' + (0.9 * bg) + ')');
    bgr.addColorStop(1, 'rgba(255,80,10,0)');
    ctx.fillStyle = bgr; ctx.fillRect(x + 0.1, y + h - 0.8, w - 0.2, 0.7);
    // 증기 배출 — 부하가 있을 때만 김이 오른다
    if (e.working) {
      ctx.fillStyle = 'rgba(226,236,240,0.45)';
      var pph = 0.18 + (e.anim * 0.6 % 0.5);
      ctx.beginPath(); ctx.arc(x + w - 0.42, y + 0.28 - pph * 0.5, 0.13 + pph * 0.2, 0, 6.283); ctx.fill();
    }
    var bf = clamp((e.fuel || 0) / (SPEC.coalEnergy * 20), 0, 1);
    ctx.fillStyle = '#20232a'; ctx.fillRect(x + 0.24, y + h - 0.26, w - 0.48, 0.16);
    ctx.fillStyle = bf > 0.15 ? COL.amber : '#c0392b';
    ctx.fillRect(x + 0.26, y + h - 0.24, (w - 0.52) * bf, 0.12);
    if (!e.fuel) drawWarn(x, y, w, '연료 없음');
  } else if (e.type === 'engine') {
    body(x, y, w, h, '#59636b');
    hazard(x + 0.16, y + 0.14, w - 0.32, 0.18);
    // 수평 피스톤 — 왕복 운동. 발전기(회전)와 보일러(드럼)와 셋 다 달라야 한다.
    var stroke = e.working ? (Math.sin(e.anim * 8) * 0.5 + 0.5) : 0.5;
    ctx.fillStyle = '#39424a';
    ctx.fillRect(x + 0.3, y + h / 2 - 0.22, w - 0.6, 0.44);
    ctx.fillStyle = '#aeb8c0';
    ctx.fillRect(x + 0.36 + stroke * (w - 1.5), y + h / 2 - 0.14, 0.7, 0.28);
    ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05;
    ctx.strokeRect(x + 0.3, y + h / 2 - 0.22, w - 0.6, 0.44);
    // 증기 게이지 — 이 계의 선행 지표다. 전기가 흔들리기 전에 여기가 먼저 준다.
    var fi = fluidOf(e);
    var sp = clamp(fi.cap > 0 ? fi.steam / fi.cap : 0, 0, 1);
    ctx.fillStyle = '#20232a'; ctx.fillRect(x + 0.3, y + h - 0.32, w - 0.6, 0.18);
    ctx.fillStyle = sp > 0.15 ? '#7fb8d8' : '#c0392b';
    ctx.fillRect(x + 0.32, y + h - 0.30, (w - 0.64) * sp, 0.14);
    if (!fi.connected) drawWarn(x, y, w, '파이프 없음');
    else if (fi.steam <= 0) drawWarn(x, y, w, '증기 없음');
  } else if (e.type === 'tank') {
    // 원통 탱크 — 옆면에 **내용물 수위**가 보인다. 이 건물의 값이 곧 '얼마나 차
    // 있는가'이므로, 그것을 아이콘이 아니라 눈금으로 보여 준다.
    body(x, y, w, h, '#4a565e');
    var ti = fluidOf(e);
    var lvl = clamp(ti.cap > 0 ? (ti.water + ti.steam) / ti.cap : 0, 0, 1);
    ctx.fillStyle = '#20232a';
    ctx.fillRect(x + 0.28, y + 0.3, w - 0.56, h - 0.6);
    // 물은 파랑, 증기는 옅은 회청 — 무엇이 들었는지 색으로 구별된다
    var tcol = (ti.steam > ti.water) ? '#9fc7dd' : '#3d7ea6';
    ctx.fillStyle = tcol;
    ctx.fillRect(x + 0.3, y + 0.32 + (h - 0.64) * (1 - lvl), w - 0.6, (h - 0.64) * lvl);
    ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.06;
    ctx.strokeRect(x + 0.28, y + 0.3, w - 0.56, h - 0.6);
    // 테두리 띠 — 파이프와 같은 계열임을 알리는 표식
    hazard(x + 0.16, y + 0.12, w - 0.32, 0.14);
    if (!ti.connected) drawWarn(x, y, w, '파이프 없음');
  } else if (e.type === 'chest') {
    ctx.fillStyle = '#8a6a3d'; rr(x + 0.08, y + 0.12, 0.84, 0.78, 0.08); ctx.fill();
    ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.06; ctx.stroke();
    ctx.fillStyle = '#a8834e'; ctx.fillRect(x + 0.12, y + 0.16, 0.76, 0.26);
    ctx.fillStyle = '#5c4426'; ctx.fillRect(x + 0.12, y + 0.46, 0.76, 0.09);
    var tot = invTotal(e.inv);
    if (tot > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x + 0.1, y + 0.66, 0.8, 0.2);
      ctx.fillStyle = COL.amber;
      ctx.fillRect(x + 0.12, y + 0.68, 0.76 * clamp(tot / SPEC.chestCap, 0, 1), 0.16);
    }
  } else if (e.type === 'lab') {
    body(x, y, w, h, '#5a6470');
    for (var fl = 0; fl < 3; fl++) {
      var fx2 = x + 0.6 + fl * 0.9, fy2 = y + h - 1.0;
      ctx.fillStyle = fl === 0 ? '#e0483c' : (fl === 1 ? '#49c05a' : '#3a4250');
      ctx.beginPath();
      ctx.moveTo(fx2 - 0.2, fy2); ctx.lineTo(fx2 + 0.2, fy2);
      ctx.lineTo(fx2 + 0.3, fy2 + 0.55); ctx.lineTo(fx2 - 0.3, fy2 + 0.55);
      ctx.closePath(); ctx.fill();
      if (e.working) {
        var bub = (e.anim * 2 + fl * 0.4) % 1;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(fx2, fy2 + 0.5 - bub * 0.45, 0.06, 0, 6.283); ctx.fill();
      }
    }
    hazard(x + 0.16, y + 0.16, w - 0.32, 0.2);
  } else if (e.type === 'controller') {
    body(x, y, w, h, '#2a3340', '#101418');
    // 화면
    ctx.fillStyle = '#0d1a12'; rr(x + 0.22, y + 0.26, w - 0.44, h - 0.7, 0.06); ctx.fill();
    var on = e.enabled && e.powerSat > 0;
    ctx.strokeStyle = on ? '#49c05a' : '#3a4a3a'; ctx.lineWidth = 0.05;
    // 노드 그래프 글리프 — 화면 안에 작은 회로가 돈다
    var g = e.graph;
    var nn = g ? Math.min(5, g.nodes.length) : 0;
    for (var i2 = 0; i2 < nn; i2++) {
      var px = x + 0.36 + (i2 % 3) * 0.52;
      var py = y + 0.46 + Math.floor(i2 / 3) * 0.46;
      ctx.beginPath(); ctx.arc(px, py, 0.09, 0, 6.283); ctx.stroke();
      if (i2 > 0) {
        ctx.beginPath();
        ctx.moveTo(x + 0.36 + ((i2 - 1) % 3) * 0.52, y + 0.46 + Math.floor((i2 - 1) / 3) * 0.46);
        ctx.lineTo(px, py); ctx.stroke();
      }
    }
    if (on) {
      var blink = 0.5 + 0.5 * Math.sin(e.anim * 6);
      ctx.fillStyle = 'rgba(73,192,90,' + (0.15 + 0.25 * blink) + ')';
      rr(x + 0.22, y + 0.26, w - 0.44, h - 0.7, 0.06); ctx.fill();
    }
    ctx.fillStyle = COL.steel; ctx.fillRect(x + 0.22, y + h - 0.38, w - 0.44, 0.16);
  } else if (e.type === 'turret') {
    body(x, y, w, h, '#5d6470');
    ctx.fillStyle = COL.metalDark;
    ctx.beginPath(); ctx.arc(x + 1, y + 1, 0.5, 0, 6.283); ctx.fill();
    var ta = e.turretAng || 0;
    if (e.target) ta = Math.atan2(e.target.y - (y + 1), e.target.x - (x + 1));
    e.turretAng = ta;
    ctx.save(); ctx.translate(x + 1, y + 1); ctx.rotate(ta);
    ctx.fillStyle = '#3c4148'; ctx.fillRect(0, -0.11, 0.92, 0.22);
    ctx.fillStyle = COL.metalLite; ctx.fillRect(0.6, -0.07, 0.34, 0.14);
    ctx.restore();
    // 탄약 표시
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 0.25, y + h - 0.34, w - 0.5, 0.18);
    ctx.fillStyle = e.ammo > 0 ? '#c94f3d' : '#444';
    ctx.fillRect(x + 0.27, y + h - 0.32, (w - 0.54) * clamp(e.ammo / 200, 0, 1), 0.14);
    if (e.ammo <= 0) drawWarn(x, y, w, '탄약 없음');
    if (!e.fireOk) drawWarn(x, y, w, '사격 금지');
  }

  // 레시피 배지 — 레퍼런스에서 조립기 위에 떠 있는 산출물 아이콘. 눈으로 라인을 읽는
  // 가장 빠른 단서라 기능적으로도 값이 크다.
  if (e.type === 'assembler' || e.type === 'furnace') {
    var rid = e.recipe;
    if (rid && RECIPES[rid]) {
      var outId = Object.keys(RECIPES[rid].out)[0];
      var bx2 = x + w / 2, by2 = y - 0.02;
      ctx.fillStyle = 'rgba(18,22,27,0.88)';
      rr(bx2 - 0.30, by2 - 0.58, 0.60, 0.60, 0.10); ctx.fill();
      ctx.strokeStyle = 'rgba(240,169,43,0.75)'; ctx.lineWidth = 0.045; ctx.stroke();
      drawItemShape(outId, bx2, by2 - 0.28, 1.25);
      // 진행 막대
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx2 - 0.26, by2 - 0.10, 0.52, 0.07);
      ctx.fillStyle = COL.chev;
      ctx.fillRect(bx2 - 0.26, by2 - 0.10, 0.52 * clamp(e.progress || 0, 0, 1), 0.07);
    }
  } else if (e.type === 'lab' && currentResearch) {
    var need = Object.keys(TECHS[currentResearch].cost);
    var lx = x + w / 2 - (need.length - 1) * 0.32;
    for (var li2 = 0; li2 < need.length; li2++) {
      ctx.fillStyle = 'rgba(18,22,27,0.88)';
      rr(lx + li2 * 0.64 - 0.26, y - 0.60, 0.52, 0.52, 0.09); ctx.fill();
      ctx.strokeStyle = invCount(e.inv, need[li2]) > 0 ? 'rgba(73,192,90,0.8)' : 'rgba(217,84,74,0.8)';
      ctx.lineWidth = 0.045; ctx.stroke();
      drawItemShape(need[li2], lx + li2 * 0.64, y - 0.34, 1.1);
    }
  }

  // 전력 없음 표시 — 모든 전기 기계 공통
  var B = BUILDINGS[e.type];
  if (B && B.power && e.powerSat <= 0 && e.enabled) drawWarn(x, y, w, '전력 없음');
  if (!e.enabled) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = e.logicForced ? '#49c05a' : '#c0392b'; ctx.lineWidth = 0.08;
    ctx.strokeRect(x + 0.08, y + 0.08, w - 0.16, h - 0.16);
  }
  // 제어기 지배 표시 — 초록 점선 테두리
  if (e.logicForced && e.enabled) {
    ctx.save();
    ctx.setLineDash([0.16, 0.12]);
    ctx.strokeStyle = 'rgba(73,192,90,0.85)'; ctx.lineWidth = 0.07;
    ctx.strokeRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
    ctx.restore();
  }
  // 체력 바
  if (e.hp < e.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 0.1, y - 0.22, w - 0.2, 0.16);
    ctx.fillStyle = '#d94f3d';
    ctx.fillRect(x + 0.12, y - 0.20, (w - 0.24) * clamp(e.hp / e.maxHp, 0, 1), 0.12);
  }
}

var warnList = [];
function drawWarn(x, y, w, msg) {
  warnList.push({ x: x + w / 2, y: y - 0.35, msg: msg });
}

function drawInserter(e) {
  var x = e.tx, y = e.ty;
  ctx.fillStyle = '#3b4048';
  rr(x + 0.14, y + 0.14, 0.72, 0.72, 0.1); ctx.fill();
  ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.05; ctx.stroke();
  ctx.fillStyle = e.enabled ? (e.filter ? '#4fae5a' : COL.chev) : '#803a34';
  ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.14, 0, 6.283); ctx.fill();

  // 팔 각도: phase 0 = 뒤(−) → 앞(+). 총 회전 180도.
  var frac = e.phase === 0 ? (1 - e.t) * 0.5 : 0.5 + e.t * 0.5;
  var baseA = e.dir * Math.PI / 2 - Math.PI / 2;   // dir 0(북) → 위쪽이 0도
  var ang = baseA + Math.PI + frac * Math.PI;
  var ax = x + 0.5 + Math.cos(ang) * 0.62, ay = y + 0.5 + Math.sin(ang) * 0.62;
  ctx.strokeStyle = '#9aa2ab'; ctx.lineWidth = 0.11; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.5); ctx.lineTo(ax, ay); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#c3cad2';
  ctx.beginPath(); ctx.arc(ax, ay, 0.11, 0, 6.283); ctx.fill();
  if (e.held) drawItemShape(e.held, ax, ay, 0.9);
}

function drawPole(e) {
  var x = e.tx, y = e.ty;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 0.58, y + 0.72, 0.22, 0.10, 0, 0, 6.283); ctx.fill();
  ctx.fillStyle = '#6b563c'; ctx.fillRect(x + 0.42, y + 0.16, 0.16, 0.58);
  ctx.fillStyle = '#8a7150'; ctx.fillRect(x + 0.24, y + 0.18, 0.52, 0.10);
  ctx.fillStyle = e.net >= 0 ? '#49c05a' : '#803a34';
  ctx.beginPath(); ctx.arc(x + 0.5, y + 0.13, 0.07, 0, 6.283); ctx.fill();
}

// 전주끼리 늘어지는 현수선 — 레퍼런스의 주황 전선.
// 그릴 간선은 전력망 재구축 때 최소신장트리로 정해 둔다(30_power.js). 매 프레임
// 모든 쌍을 다시 재면 O(n²)일 뿐 아니라 화면이 그물이 된다.
function drawWires() {
  if (!wireEdges.length) return;
  ctx.strokeStyle = COL.wire; ctx.lineWidth = 0.05;
  ctx.globalAlpha = 0.85;
  for (var i = 0; i < wireEdges.length; i++) {
    var w = wireEdges[i];
    var x1 = w[0] + 0.5, y1 = w[1] + 0.2;
    var x2 = w[2] + 0.5, y2 = w[3] + 0.2;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + 0.30;   // 늘어짐
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- 적 ----------------------------------------------------------------------
// 열차는 점유맵 밖에 있고 엔티티 목록에도 없다 — 따로 그린다.
function drawTrains() {
  for (var i = 0; i < trains.length; i++) {
    var t = trains[i];
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(t.x + 0.14, t.y + 0.22, 0.86, 0.72);
    ctx.fillStyle = '#2c5470';
    rr(t.x + 0.06, t.y + 0.12, 0.88, 0.76, 0.14); ctx.fill();
    ctx.strokeStyle = COL.outline; ctx.lineWidth = 0.06; ctx.stroke();
    ctx.fillStyle = '#aeb8c0';
    ctx.fillRect(t.x + 0.18, t.y + 0.24, 0.64, 0.2);
    // 화물 게이지 — 얼마나 실렸는지가 지도에서 보여야 배차를 눈으로 판단한다
    var f = clamp(trainCargo(t) / SPEC.trainCargoCap, 0, 1);
    ctx.fillStyle = '#20232a'; ctx.fillRect(t.x + 0.18, t.y + 0.58, 0.64, 0.18);
    ctx.fillStyle = f > 0.02 ? COL.amber : '#3a3f45';
    ctx.fillRect(t.x + 0.19, t.y + 0.59, 0.62 * f, 0.16);
  }
}

function drawEnemies(b) {
  for (var i = 0; i < corpses.length; i++) {
    var c = corpses[i];
    ctx.fillStyle = 'rgba(60,30,80,' + clamp(1 - c.t / 6, 0, 0.5) + ')';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 0.4, 0.24, 0, 0, 6.283); ctx.fill();
  }
  for (var k = 0; k < enemies.length; k++) {
    var e = enemies[k];
    if (e.x < b.x0 - 2 || e.x > b.x1 + 2 || e.y < b.y0 - 2 || e.y > b.y1 + 2) continue;
    var spec = ENEMY_TIERS[e.tier];
    var wob = Math.sin(gameTime * 9 + e.wob) * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + spec.r * 0.7, spec.r * 1.1, spec.r * 0.45, 0, 0, 6.283); ctx.fill();
    // 다리
    ctx.strokeStyle = '#2c1c40'; ctx.lineWidth = spec.r * 0.22;
    for (var l = -1; l <= 1; l += 2) {
      for (var j = 0; j < 3; j++) {
        var ly = e.y - spec.r * 0.4 + j * spec.r * 0.42;
        ctx.beginPath(); ctx.moveTo(e.x, ly);
        ctx.lineTo(e.x + l * spec.r * 1.25, ly + wob * l * (j - 1)); ctx.stroke();
      }
    }
    ctx.fillStyle = spec.color;
    ctx.beginPath(); ctx.ellipse(e.x, e.y, spec.r * 1.1, spec.r * 0.85, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#d9c25a';
    ctx.beginPath(); ctx.arc(e.x - spec.r * 0.3, e.y - spec.r * 0.35, spec.r * 0.16, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x + spec.r * 0.3, e.y - spec.r * 0.35, spec.r * 0.16, 0, 6.283); ctx.fill();
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - 0.4, e.y - spec.r - 0.34, 0.8, 0.12);
      ctx.fillStyle = '#e05a4a';
      ctx.fillRect(e.x - 0.39, e.y - spec.r - 0.33, 0.78 * clamp(e.hp / e.maxHp, 0, 1), 0.10);
    }
  }
  for (var f = 0; f < turretFx.length; f++) {
    var t = turretFx[f];
    ctx.strokeStyle = 'rgba(255,230,140,0.9)'; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
  }
}

function drawNests(b) {
  for (var i = 0; i < nests.length; i++) {
    var n = nests[i];
    if (n.x < b.x0 - 3 || n.x > b.x1 + 3 || n.y < b.y0 - 3 || n.y > b.y1 + 3) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(n.x, n.y + 0.4, 1.5, 0.7, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = COL.nest;
    ctx.beginPath(); ctx.ellipse(n.x, n.y, 1.4, 1.05, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#54346e';
    for (var s = 0; s < 7; s++) {
      var a = s * 0.897 + 0.3;
      ctx.beginPath();
      ctx.moveTo(n.x + Math.cos(a) * 0.9, n.y + Math.sin(a) * 0.65);
      ctx.lineTo(n.x + Math.cos(a) * 1.5, n.y + Math.sin(a) * 1.1 - 0.35);
      ctx.lineTo(n.x + Math.cos(a + 0.3) * 0.9, n.y + Math.sin(a + 0.3) * 0.65);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#1a0f24';
    ctx.beginPath(); ctx.ellipse(n.x, n.y + 0.1, 0.45, 0.3, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(n.x - 0.8, n.y - 1.5, 1.6, 0.16);
    ctx.fillStyle = '#b05aa8';
    ctx.fillRect(n.x - 0.78, n.y - 1.48, 1.56 * clamp(n.hp / n.maxHp, 0, 1), 0.12);
  }
}

// --- 오염 오버레이 -----------------------------------------------------------
var showPollution = true;
function drawPollution(b) {
  if (!showPollution) return;
  var C = SPEC.pollutionPerChunk;
  var px0 = Math.max(0, (b.x0 / C) | 0), px1 = Math.min(PW - 1, (b.x1 / C) | 0);
  var py0 = Math.max(0, (b.y0 / C) | 0), py1 = Math.min(PH - 1, (b.y1 / C) | 0);
  for (var py = py0; py <= py1; py++) {
    for (var px = px0; px <= px1; px++) {
      var v = world.poll[pidx(px, py)];
      if (v <= 0.02) continue;
      // 사각 블록이 그대로 보이면 화면을 통째로 덮는다 — 옅게 깔고 중심으로 갈수록 진하게.
      var a = clamp(v * 0.045, 0, 0.16);
      var gx = px * C + C / 2, gy = py * C + C / 2;
      var gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, C * 0.78);
      gr.addColorStop(0, 'rgba(158,64,30,' + a + ')');
      gr.addColorStop(1, 'rgba(158,64,30,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(px * C - C * 0.3, py * C - C * 0.3, C * 1.6, C * 1.6);
    }
  }
}

// --- 메인 --------------------------------------------------------------------
function render() {
  if (!ctx) return;
  frameCount++;
  warnList.length = 0;
  var s = viewScale();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a1e17';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(s, 0, 0, s, cv.width / 2 - cam.x * s, cv.height / 2 - cam.y * s);

  var b = visibleBounds();
  drawTerrain(b);
  drawOre(b);
  drawPollution(b);
  drawTrees(b);
  drawNests(b);

  // 벨트 → 벨트 아이템 → 나머지 건물 순서 (아이템이 기계 밑으로 안 들어가게)
  forEachEntity(function (e) {
    if (!e.cells) return;
    if (e.tx < b.x0 - 3 || e.tx > b.x1 + 3 || e.ty < b.y0 - 3 || e.ty > b.y1 + 3) return;
    for (var c = 0; c < e.cells.length; c++) drawBeltCell(e.cells[c]);
  });
  forEachEntity(function (e) {
    if (!e.cells) return;
    if (e.tx < b.x0 - 3 || e.tx > b.x1 + 3 || e.ty < b.y0 - 3 || e.ty > b.y1 + 3) return;
    for (var c = 0; c < e.cells.length; c++) drawBeltItems(e.cells[c]);
  });
  drawWires();
  forEachEntity(function (e) {
    if (e.cells) return;
    if (e.tx < b.x0 - 4 || e.tx > b.x1 + 4 || e.ty < b.y0 - 4 || e.ty > b.y1 + 4) return;
    guard('draw:' + e.type, function () { drawEntity(e); });
  });
  drawTrains();
  drawEnemies(b);

  if (typeof drawOverlays === 'function') guard('overlays', drawOverlays);

  // 경고 글자 — 화면 좌표로 되돌려 그린다
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  var dpr = cam.dpr || 1;
  ctx.font = (11 * dpr) + 'px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  for (var i = 0; i < warnList.length; i++) {
    var p = screenOf(warnList[i].x, warnList[i].y);
    if (p.x < 0 || p.y < 0 || p.x > cv.width || p.y > cv.height) continue;
    var tw = ctx.measureText(warnList[i].msg).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(p.x - tw / 2 - 4 * dpr, p.y - 11 * dpr, tw + 8 * dpr, 15 * dpr);
    ctx.fillStyle = '#f0a92b';
    ctx.fillText(warnList[i].msg, p.x, p.y + dpr);
  }
  ctx.textAlign = 'left';
}

// 프레임버퍼 직독 — "렌더 예외 0" 과 "화면에 뭔가 그려짐" 은 별개의 사실이다.
// 검증 하네스가 이 함수로 빈 화면을 잡는다.
window.__PIXEL_PROBE = function (w, h) {
  if (!ctx) return null;
  var ww = w || 64, hh = h || 64;
  var x0 = Math.max(0, ((cv.width - ww) / 2) | 0), y0 = Math.max(0, ((cv.height - hh) / 2) | 0);
  var d = ctx.getImageData(x0, y0, Math.min(ww, cv.width), Math.min(hh, cv.height)).data;
  var set = {}, n = 0;
  for (var i = 0; i < d.length; i += 4) {
    var key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (!set[key]) { set[key] = 1; n++; }
  }
  return { uniqueRGB: n, sample: [d[0], d[1], d[2], d[3]], size: [ww, hh] };
};
