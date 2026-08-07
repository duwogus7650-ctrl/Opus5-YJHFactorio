// ===========================================================================
//  40_enemy.js — 둥지, 습격파, 전투, 터렛
//
//  적은 길찾기를 하지 않는다. 목표를 향해 직진하고 앞을 막은 건물을 물어뜯는다
//  (Factorio 의 실제 행동이기도 하다). 대신 원장의 교착 사례를 피하려고:
//   * 이동에도 탈출 타임아웃을 둔다 — 일정 시간 거리가 안 줄면 옆으로 비킨다.
//   * 비키는 방향은 개체마다 다르게 준다. 같은 방향이면 서로를 영원히 민다.
//   * 목표가 사라지면 즉시 재선정한다. 유령 목표를 붙들면 그 자리에 굳는다.
// ===========================================================================

var nests = [];
var enemies = [];
var corpses = [];          // 연출용 (FX_RNG 만 사용)
var evolution = 0;
var waveStats = { spawned: 0, killed: 0, buildingsLost: 0, lastWaveT: 0, waves: 0 };

function spawnNests(seed) {
  nests.length = 0;
  var rng = makeRng(seed ^ 0x5eed);
  var cx = world.spawnX, cy = world.spawnY;
  for (var i = 0; i < 26; i++) {
    var ang = rng.next() * Math.PI * 2;
    var d = 34 + rng.next() * 42;
    var x = Math.round(cx + Math.cos(ang) * d);
    var y = Math.round(cy + Math.sin(ang) * d);
    if (!inBounds(x, y)) continue;
    if (world.oreAmt[idx(x, y)] > 0) continue;
    nests.push({ x: x, y: y, hp: 350, maxHp: 350, absorbed: 0, cool: rng.next() * 30, seed: (rng.next() * 1e9) | 0 });
    clearTrees(x - 1, y - 1, 3, 3);
  }
}

function nearestNestDist(tx, ty) {
  var best = 1e9;
  for (var i = 0; i < nests.length; i++) {
    var d = dist(nests[i].x, nests[i].y, tx, ty);
    if (d < best) best = d;
  }
  return best;
}

// --- 목표 선정 ---------------------------------------------------------------
// 적은 가장 가까운 플레이어 건물을 문다. 오염을 많이 내는 건물에 가중치를 준다.
function pickTarget(ex, ey) {
  var best = null, bestScore = 1e18;
  forEachEntity(function (e) {
    var d2 = dist2(e.tx + e.w * 0.5, e.ty + e.h * 0.5, ex, ey);
    var w = 1;
    if (e.type === 'generator' || e.type === 'miner') w = 0.6;   // 시끄러운 건물이 먼저 표적
    else if (e.type === 'wall') w = 1.4;                          // 벽은 굳이 먼저 물지 않는다
    var sc = d2 * w;
    if (sc < bestScore) { bestScore = sc; best = e; }
  });
  return best;
}

// (tx,ty) 타일을 점유한 플레이어 건물 — 적의 진로를 막는가
function blockerAt(tx, ty) {
  var id = occAt(tx, ty);
  if (id <= 0) return null;
  return entities[id] || null;
}

function spawnWave(nest, count) {
  var mix = tierMixFor(evolution);
  var rng = makeRng((nest.seed ^ (waveStats.waves * 7919)) >>> 0);
  for (var i = 0; i < count; i++) {
    var r = rng.next(), tier = 0, acc = 0;
    for (var t = 0; t < mix.length; t++) { acc += mix[t]; if (r <= acc) { tier = t; break; } }
    var spec = ENEMY_TIERS[tier];
    var ang = rng.next() * Math.PI * 2, rad = rng.next() * 2.2;
    enemies.push({
      x: nest.x + Math.cos(ang) * rad, y: nest.y + Math.sin(ang) * rad,
      hp: spec.hp, maxHp: spec.hp, tier: tier,
      target: null, atk: 0, stuckT: 0, lastD: 1e9,
      side: (i % 2) ? 1 : -1,          // 비키는 방향을 개체마다 다르게
      wob: rng.next() * 6.283
    });
    waveStats.spawned++;
  }
  waveStats.waves++;
  waveStats.lastWaveT = gameTime;
}

// 진화도 — Factorio 와 같은 점근 형태.
//   d(evo) = (시간항 + 오염항) × (1 - evo)²
// 선형 clamp 였을 때는 소형 공장도 30분에 62%, 대형 공장은 16분에 100%에 닿아
// 후반이 통째로 벽이 됐다(실측). 점근형은 100%에 영원히 닿지 않으므로 그 벽이 없다.
//   시간만으로 evo 0.5 → 2시간 (t = 1/k)
//   오염만으로 evo 0.5 → 누적 6000
var EVO_TIME_K = 1 / 7200;
var EVO_POLL_K = 1 / 6000;
var evoPrevPoll = 0;
var WAVE_GRACE = 300;      // 초반 5분은 습격 없음 (둥지는 그동안에도 오염을 모은다)
var POLL_PER_ENEMY = 8;    // 둥지가 흡수한 오염 이만큼당 적 1마리
function resetEvolution() { evolution = 0; evoPrevPoll = 0; }

function stepNests(dt) {
  var dPoll = world.totalPollution - evoPrevPoll;
  if (dPoll < 0) dPoll = 0;
  evoPrevPoll = world.totalPollution;
  var room = 1 - evolution;
  evolution = clamp(evolution + (EVO_TIME_K * dt + EVO_POLL_K * dPoll) * room * room, 0, 0.9999);
  for (var i = 0; i < nests.length; i++) {
    var n = nests[i];
    if (n.hp <= 0) continue;
    var px = (n.x / SPEC.pollutionPerChunk) | 0, py = (n.y / SPEC.pollutionPerChunk) | 0;
    if (px >= 0 && py >= 0 && px < PW && py < PH) {
      var pi = pidx(px, py);
      var take = Math.min(world.poll[pi], 0.9 * dt);
      world.poll[pi] -= take;
      n.absorbed += take;
    }
    n.cool -= dt;
    // 흡수한 오염 POLL_PER_ENEMY 당 적 1마리. 5마리 모이고 쿨다운이 끝나면 보낸다.
    // 나눗셈과 차감이 같은 상수를 봐야 한다 — 한쪽만 바꾸면 파도가 조용히 잦아진다.
    var ready = Math.floor(n.absorbed / POLL_PER_ENEMY);
    // 초반 유예 — 처음 5분은 습격이 없다. 이게 없으면 큰 공장을 빨리 세울수록
    // 2분 만에 두들겨 맞아서, 잘 지은 것이 벌이 된다 (측정에서 실제로 그랬다).
    // 둥지는 그동안에도 오염을 흡수하므로 유예가 끝나면 곧바로 몰려온다.
    if (gameTime < WAVE_GRACE) continue;
    if (ready >= 5 && n.cool <= 0) {
      // 후반에 실제로 무서워야 한다 — 진화 100%에서 한 둥지가 최대 30마리.
      var count = Math.min(ready, 4 + Math.floor(evolution * 26));
      n.absorbed -= count * POLL_PER_ENEMY;
      n.cool = 26 + 40 * (1 - evolution);
      spawnWave(n, count);
    }
  }
}

function stepEnemies(dt) {
  for (var i = enemies.length - 1; i >= 0; i--) {
    var en = enemies[i];
    if (en.hp <= 0) {
      corpses.push({ x: en.x, y: en.y, t: 0, tier: en.tier });
      enemies.splice(i, 1); waveStats.killed++;
      continue;
    }
    var spec = ENEMY_TIERS[en.tier];

    // 목표 재선정 — 유령 목표를 붙들지 않는다
    if (!en.target || !entities[en.target]) {
      var t = pickTarget(en.x, en.y);
      en.target = t ? t.id : null;
      en.lastD = 1e9; en.stuckT = 0;
      if (!en.target) {
        // 부술 게 없으면 스폰 지점 쪽으로 어슬렁 — 화면 밖에서 굳지 않게
        en.x += (world.spawnX - en.x) * 0.02 * dt;
        en.y += (world.spawnY - en.y) * 0.02 * dt;
        continue;
      }
    }
    var tgt = entities[en.target];
    var gx = tgt.tx + tgt.w * 0.5, gy = tgt.ty + tgt.h * 0.5;
    var d = dist(en.x, en.y, gx, gy);

    // 사거리 안이면 문다
    var reach = Math.max(tgt.w, tgt.h) * 0.5 + spec.r + 0.55;
    if (d <= reach) {
      en.atk += dt;
      en.stuckT = 0;
      if (en.atk >= 1) {
        en.atk = 0;
        tgt.hp -= spec.dmg;
        if (tgt.hp <= 0) {
          waveStats.buildingsLost++;
          removeEntity(tgt.id, false);
          en.target = null;
        }
      }
      continue;
    }

    // 이동 — 목표 방향, 다만 막힌 타일이 있으면 그것을 새 목표로 삼는다
    var ux = (gx - en.x) / d, uy = (gy - en.y) / d;
    var step = spec.speed * dt;
    var nx2 = en.x + ux * step, ny2 = en.y + uy * step;
    var bl = blockerAt(Math.floor(nx2), Math.floor(ny2));
    if (bl && bl.id !== tgt.id) { en.target = bl.id; en.lastD = 1e9; en.stuckT = 0; continue; }

    // 정체 감지 — 거리 개선이 없으면 진행방향에 수직으로 비킨다
    if (d < en.lastD - 0.02) { en.lastD = d; en.stuckT = 0; }
    else {
      en.stuckT += dt;
      if (en.stuckT > 1.2) {
        var px2 = -uy * en.side, py2 = ux * en.side;
        nx2 = en.x + px2 * step * 1.6;
        ny2 = en.y + py2 * step * 1.6;
        if (en.stuckT > 4) { en.target = null; en.stuckT = 0; }   // 그래도 안 되면 목표를 버린다
      }
    }
    en.x = clamp(nx2, 0.5, W - 1.5);
    en.y = clamp(ny2, 0.5, H - 1.5);
  }

  for (var c = corpses.length - 1; c >= 0; c--) {
    corpses[c].t += dt;
    if (corpses[c].t > 6) corpses.splice(c, 1);
  }
}

// --- 터렛 --------------------------------------------------------------------
var turretFx = [];       // { x1,y1,x2,y2,t } 총선 연출

function stepTurrets(dt) {
  for (var f = turretFx.length - 1; f >= 0; f--) {
    turretFx[f].t -= dt;
    if (turretFx[f].t <= 0) turretFx.splice(f, 1);
  }
  forEachEntity(function (e) {
    if (e.type !== 'turret') return;
    e.working = false;
    e.target = null;              // 죽은 적/철거된 둥지를 계속 조준하지 않게 매 틱 비운다
    if (!e.enabled || !e.fireOk || e.ammo <= 0) return;
    var cx = e.tx + 1, cy = e.ty + 1;
    // 가장 가까운 적
    var best = null, bd = SPEC.turretRange;
    for (var i = 0; i < enemies.length; i++) {
      var d = dist(enemies[i].x, enemies[i].y, cx, cy);
      if (d < bd) { bd = d; best = enemies[i]; }
    }
    // 둥지도 사거리 안이면 쏜다 — 터렛 크립으로 둥지를 밀 수 있게
    var bestNest = null;
    if (!best) {
      var nd = SPEC.turretRange;
      for (var k = 0; k < nests.length; k++) {
        if (nests[k].hp <= 0) continue;
        var d2 = dist(nests[k].x, nests[k].y, cx, cy);
        if (d2 < nd) { nd = d2; bestNest = nests[k]; }
      }
    }
    var victim = best || bestNest;
    if (!victim) return;

    e.working = true;
    e.shotT = (e.shotT || 0) + dt;
    var shots = 0;
    while (e.shotT >= 0.1 && e.ammo > 0) { e.shotT -= 0.1; e.ammo--; shots++; }
    if (shots > 0) {
      victim.hp -= shots * 5;
      turretFx.push({ x1: cx, y1: cy, x2: victim.x !== undefined ? victim.x : victim.x, y2: victim.y, t: 0.06 });
      if (victim.hp <= 0 && bestNest === victim) victim.hp = 0;
    }
    e.target = victim;
  });
  // 파괴된 둥지 정리
  for (var n = nests.length - 1; n >= 0; n--) if (nests[n].hp <= 0) nests.splice(n, 1);
}

function enemyThreatLevel() {
  var near = 0;
  for (var i = 0; i < enemies.length; i++) {
    if (dist(enemies[i].x, enemies[i].y, world.spawnX, world.spawnY) < 45) near++;
  }
  return near;
}
