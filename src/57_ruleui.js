// ===========================================================================
//  57_ruleui.js — 문장(규칙) 편집기 화면
//
//  제어기를 열면 **이 화면이 먼저** 나온다. 빈 캔버스에 노드를 놓는 일은 무엇을
//  만들지 이미 아는 사람만 할 수 있고, 그게 이 게임에서 가장 높은 벽이었다.
//
//  규율:
//   * 문장 → 회로는 되고 회로 → 문장은 안 된다. 그래프를 손대는 순간 그 제어기의
//     문장 화면은 잠근다. 양쪽을 편집하게 두면 반드시 갈린다(원장: peek≠take).
//   * 블로킹 모달을 쓰지 않는다. 헤드리스가 통째로 서고 제품 UX 도 나쁘다.
//   * 고를 수 없는 것은 **왜 못 고르는지** 보여 준다. 연구가 안 됐으면 그렇게 적는다.
// ===========================================================================

var ruleEditT = null;                 // 값 갱신 타이머

function rulesOn() {
  // 손으로 회로를 고친 제어기는 문장으로 되돌리지 않는다
  return !!(curCtrl && !curCtrl.handEdited);
}

function showRules(on) {
  var lg = document.getElementById('logic'), rp = document.getElementById('rulePane');
  if (!lg || !rp) return;
  if (on) { lg.classList.add('rules'); rp.classList.add('on'); renderRules(); }
  else { lg.classList.remove('rules'); rp.classList.remove('on'); renderGraph(); }
  // 안내문도 화면에 맞춰 바꾼다 — 문장 화면에서 "출력을 끌어 배선"이라고 적혀
  // 있으면 그 자체가 거짓말이다.
  var hint = document.querySelector('#logicBar .hint');
  if (hint) {
    hint.innerHTML = on
      ? '드롭다운을 골라 문장을 완성하면 그게 그대로 회로가 된다 · <b>대상</b>을 누르면 지도에서 고른다 · 규칙에 <b>이름</b>을 주면 다른 규칙이 그 이름을 조건으로 쓴다'
      : '출력 → 입력으로 끌어 배선 · 입력 포트 클릭 = 해제 · 배경 드래그 = 이동 · 휠 = 확대 · <b>참 = 0.5 이상</b> (0.4는 거짓) · 값 옆 <b>↑n</b> = 지금까지 올라간 횟수';
  }
  var bg = document.getElementById('btnToGraph'), br = document.getElementById('btnToRules');
  var bx = document.getElementById('btnExample');
  if (bg) bg.style.display = on ? '' : 'none';
  if (br) br.style.display = (!on && rulesOn()) ? '' : 'none';
  if (bx) bx.style.display = on ? 'none' : '';
}

// 문장 → 회로. 되돌아올 수 있다(아직 손대지 않았으므로).
function ruleToGraph() {
  if (!curCtrl) return;
  compileRules(curCtrl);
  markLogicDirty();
  showRules(false);
  toast('문장이 만든 회로다. 여기서 손대면 문장 화면은 잠긴다.', 'bad');
}
function graphToRules() {
  if (!curCtrl || curCtrl.handEdited) return;
  showRules(true);
}

// 그래프를 손으로 고쳤다 — 55_logicui.js 의 편집 경로가 부른다.
// **여기서 되돌아가는 길을 끊는다.** 조용히 두 표현이 갈리는 것보다 낫다.
function markGraphHandEdited() {
  if (!curCtrl || curCtrl.handEdited) return;
  if (!curCtrl.rules || !curCtrl.rules.length) { curCtrl.handEdited = true; return; }
  curCtrl.handEdited = true;
  toast('회로를 직접 고쳤다 — 이 제어기는 이제 문장으로 못 돌아간다', 'bad');
  var br = document.getElementById('btnToRules');
  if (br) br.style.display = 'none';
}

// --- 그리기 -----------------------------------------------------------------
function renderRules() {
  var host = document.getElementById('rulePane');
  if (!host || !curCtrl) return;
  if (curCtrl.handEdited) {
    host.innerHTML = '<div class="rlocked"><b>이 제어기는 회로로 직접 편집했다.</b><br>' +
      '문장과 회로가 서로 다른 말을 하는 것을 막으려고 문장 화면을 잠갔다. ' +
      '문장으로 다시 하려면 <b>회로의 노드를 전부 지우고</b> 제어기를 다시 열어라.</div>';
    return;
  }
  if (!curCtrl.rules) { curCtrl.rules = []; curCtrl.nextRuleId = 1; }
  var h = [];
  if (!curCtrl.rules.length) {
    h.push('<div class="rnow" style="margin:0 0 10px">무엇을 시키고 싶은지 고르면 문장이 절반쯤 채워져 나온다.</div>');
    h.push('<div class="rcards">');
    var cards = RULE_CARDS;
    for (var c = 0; c < cards.length; c++) {
      var lock = cards[c].need && !techDone[cards[c].need];
      h.push('<div class="c' + (lock ? ' locked' : '') + '" data-card="' + cards[c].id + '">' +
        '<b>' + cards[c].title + '</b><span>' +
        (lock ? TECHS[cards[c].need].name + ' 연구가 필요하다' : (cards[c].why || '')) +
        '</span></div>');
    }
    h.push('</div>');
  } else {
    for (var i = 0; i < curCtrl.rules.length; i++) h.push(ruleCardHtml(curCtrl.rules[i], i));
    h.push('<button id="rAdd" style="margin-top:2px">+ 규칙 추가</button>');
  }
  host.innerHTML = h.join('');
  bindRuleControls(host);
  // 머리말은 두 화면이 함께 쓰는 자리다. 문장 화면에서 갱신을 빼먹으면
  // **직전에 열었던 제어기의 경고가 그대로 남아** 거짓말을 한다(실측).
  updateCycleInfo(curCtrl.graph);
  if (ruleEditT) clearInterval(ruleEditT);
  ruleEditT = setInterval(updateRuleNow, 300);
}

function selHtml(cls, key, rid, opts, cur) {
  var o = ['<select class="' + cls + '" data-r="' + rid + '" data-k="' + key + '">'];
  for (var i = 0; i < opts.length; i++) {
    o.push('<option value="' + opts[i][0] + '"' + (opts[i][0] === cur ? ' selected' : '') +
           (opts[i][2] ? ' disabled' : '') + '>' + opts[i][1] + '</option>');
  }
  o.push('</select>');
  return o.join('');
}
function numHtml(key, rid, val) {
  return '<input class="num" type="number" data-r="' + rid + '" data-k="' + key + '" value="' + val + '">';
}
function entHtml(key, rid, id, filter) {
  return '<button class="pick" data-r="' + rid + '" data-pick="' + key + '" data-f="' +
         filter.join(',') + '">' + entName(id) + '</button>';
}

function ruleCardHtml(r, i) {
  var w = r.when, s = RULE_SOURCES[w.src], why = ruleBlockedReason(r);
  var h = ['<div class="rcard' + (r.enabled ? '' : ' off') + (why ? ' blocked' : '') +
           '" data-rc="' + r.id + '">'];
  h.push('<div class="rhead"><span class="rnum">규칙 ' + (i + 1) + '</span>' +
    '<input class="rname" data-r="' + r.id + '" data-k="name" value="' + (r.name || '') +
    '" placeholder="이름 (다른 규칙이 부를 때)">' +
    '<span class="sp"></span>' +
    '<button data-r="' + r.id + '" data-act="toggle">' + (r.enabled ? '끄기' : '켜기') + '</button>' +
    '<button data-r="' + r.id + '" data-act="del">삭제</button></div>');

  // 만약 —
  var srcOpts = RULE_SOURCE_IDS.map(function (k) {
    var d = RULE_SOURCES[k];
    return [k, d.label + (d.tech && !techDone[d.tech] ? ' (연구 필요)' : ''), d.tech && !techDone[d.tech]];
  });
  h.push('<div class="rline"><span class="kw">만약</span>');
  if (w.refName) {
    h.push('<b>[' + w.refName + ']</b> 이면');
    h.push('<button data-r="' + r.id + '" data-act="unref">다른 것을 보기</button>');
  } else {
    h.push(selHtml('', 'when.src', r.id, srcOpts, w.src));
    if (s && s.needs.indexOf('ent') >= 0) h.push('<span class="kw">중</span>' + entHtml('when.ent', r.id, w.ent, s.entFilter));
    if (s && s.needs.indexOf('item') >= 0) {
      h.push(selHtml('', 'when.item', r.id, ITEM_IDS.map(function (k) { return [k, ITEMS[k].name]; }), w.item));
    }
    if (s && s.needs.indexOf('radius') >= 0) { h.push('반경'); h.push(numHtml('when.radius', r.id, w.radius)); h.push('칸'); }
    if (!(s && s.bool)) {
      h.push('이');
      h.push(numHtml('when.value', r.id, w.value));
      h.push('<span class="kw">' + (s ? (s.unit || '') : '') + '</span>');
      h.push(selHtml('', 'when.cmp', r.id, RULE_CMPS.map(function (c) { return [c.op, c.label]; }), w.cmp));
    } else h.push('<span class="kw">이면</span>');
  }
  h.push('</div>');

  // 그래서 —
  var t = r.then, ad = RULE_ACTIONS[t.act];
  var actOpts = RULE_ACTION_IDS.map(function (k) {
    var d = RULE_ACTIONS[k];
    return [k, d.label + (d.tech && !techDone[d.tech] ? ' (연구 필요)' : ''), d.tech && !techDone[d.tech]];
  });
  h.push('<div class="rline"><span class="kw">그래서</span>');
  if (ad && ad.entFilter) h.push(entHtml('then.ent', r.id, t.ent, ad.entFilter) + '<span class="kw">을</span>');
  h.push(selHtml('', 'then.act', r.id, actOpts, t.act));
  if (ad && ad.verbOn) {
    h.push(selHtml('', 'then.onWhenTrue', r.id,
      [['1', ad.verbOn], ['0', ad.verbOff]], t.onWhenTrue === false ? '0' : '1'));
  }
  if (ad && ad.text) {
    h.push('<input data-r="' + r.id + '" data-k="then.label" value="' + (t.label || '') +
           '" placeholder="화면에 쓸 이름">');
  }
  if (ad && ad.twoItems) {
    h.push('평소' + selHtml('', 'when.item', r.id, ITEM_IDS.map(function (k) { return [k, ITEMS[k].name]; }), w.item));
    h.push('조건이면' + selHtml('', 'then.item2', r.id, ITEM_IDS.map(function (k) { return [k, ITEMS[k].name]; }), t.item2));
  }
  h.push('</div>');

  // 기억 —
  var memOpts = [];
  for (var mk in RULE_MEMOS) {
    var md = RULE_MEMOS[mk];
    memOpts.push([mk, md.label + (md.tech && !techDone[md.tech] ? ' (연구 필요)' : ''),
                  md.tech && !techDone[md.tech]]);
  }
  h.push('<div class="rline"><span class="kw">기억</span>' +
    selHtml('', 'memo.kind', r.id, memOpts, r.memo.kind));
  if (r.memo.kind === 'latch') {
    h.push('<span class="kw">되돌리는 건</span>');
    h.push(numHtml('memo.resetValue', r.id, r.memo.resetValue));
    h.push(selHtml('', 'memo.resetCmp', r.id, RULE_CMPS.map(function (c) { return [c.op, c.label]; }), r.memo.resetCmp));
    h.push('<span class="kw">· 되돌리기는</span>');
    h.push(numHtml('memo.everySec', r.id, r.memo.everySec));
    h.push('<span class="kw">초에 한 번만 (0 = 즉시)</span>');
  } else if (r.memo.kind === 'count') {
    h.push(numHtml('memo.times', r.id, r.memo.times) + '<span class="kw">번 넘게</span>');
  }
  h.push('</div>');

  h.push('<div class="rnow" data-now="' + r.id + '">' + ruleSentence(r) + '</div>');
  if (why) h.push('<div class="rwhy">지금은 안 돈다 — ' + why + '</div>');
  h.push('</div>');
  return h.join('');
}

// 지금 이 규칙이 무엇을 보고 무엇을 하고 있는지. 값은 회로에서 직접 읽는다 —
// 문장이 따로 계산하면 그게 두 번째 런타임이 되고, 반드시 갈린다.
function updateRuleNow() {
  if (!curCtrl || !curCtrl.rules || curCtrl.handEdited) return;
  for (var i = 0; i < curCtrl.rules.length; i++) {
    var r = curCtrl.rules[i];
    var el = document.querySelector('[data-now="' + r.id + '"]');
    if (!el) continue;
    var txt = ruleSentence(r);
    var w = r.when, s = RULE_SOURCES[w.src], live = '';
    if (s && !w.refName) {
      var v = ruleLiveValue(w);
      if (v !== null) live = ' &nbsp;·&nbsp; 지금 <b>' + fmt(v, 1) + (s.unit || '') + '</b>';
    }
    el.innerHTML = txt + live;
  }
}
// 조건이 읽는 값을 지금 한 번 재 본다 (표시 전용).
function ruleLiveValue(w) {
  var s = RULE_SOURCES[w.src];
  if (!s) return null;
  var e = w.ent ? entities[w.ent] : null;
  switch (s.node) {
    case 'chest': return e ? invCount(e.inv, w.item) : null;
    case 'invsense': return inventory[w.item] || 0;
    case 'belt': {
      if (!e || !e.cells) return null;
      var acc = {};
      for (var c = 0; c < e.cells.length; c++) beltContents(e.cells[c], acc);
      return acc[w.item] || 0;
    }
    case 'machine': {
      if (!e) return null;
      return s.port === 0 ? (e.working ? 1 : 0)
           : s.port === 1 ? (e.stallT > 1.5 ? 1 : 0)
           : Math.round((e.progress || 0) * 100);
    }
    case 'power': {
      var np = netPowerOf(curCtrl);
      return s.port === 0 ? Math.round(netSatOf(curCtrl) * 100)
           : s.port === 1 ? Math.round(np.supply)
           : s.port === 2 ? Math.round(np.demand) : Math.round(np.head);
    }
    case 'research': return currentResearch ? Math.round(researchFrac() * 100) : 0;
    case 'enemy': {
      var R = Math.max(1, +w.radius || 30), cx = curCtrl.tx + 1, cy = curCtrl.ty + 1, n = 0, near = R;
      for (var i = 0; i < enemies.length; i++) {
        var d = dist(enemies[i].x, enemies[i].y, cx, cy);
        if (d <= R) { n++; if (d < near) near = d; }
      }
      return s.port === 0 ? n : Math.round(near * 10) / 10;
    }
  }
  return null;
}

// --- 조작 -------------------------------------------------------------------
function ruleById(id) {
  if (!curCtrl || !curCtrl.rules) return null;
  for (var i = 0; i < curCtrl.rules.length; i++) if (curCtrl.rules[i].id === id) return curCtrl.rules[i];
  return null;
}
function setPath(obj, path, val) {
  var ks = path.split('.');
  while (ks.length > 1) { obj = obj[ks.shift()]; if (!obj) return; }
  obj[ks[0]] = val;
}
// 값이 바뀔 때마다 **곧바로 다시 컴파일한다.** 저장 버튼을 따로 두면 "고쳤는데
// 왜 안 되지"가 생긴다 — 문장이 곧 회로여야 그 질문 자체가 사라진다.
function ruleChanged() {
  compileRules(curCtrl);
  markLogicDirty();
  renderRules();
}

function bindRuleControls(host) {
  var sels = host.querySelectorAll('select[data-r]');
  for (var i = 0; i < sels.length; i++) {
    sels[i].onchange = function () {
      var r = ruleById(+this.getAttribute('data-r')); if (!r) return;
      var k = this.getAttribute('data-k'), v = this.value;
      if (k === 'then.onWhenTrue') v = (v === '1');
      setPath(r, k, v);
      ruleChanged();
    };
  }
  var nums = host.querySelectorAll('input[data-r]');
  for (var j = 0; j < nums.length; j++) {
    nums[j].onchange = function () {
      var r = ruleById(+this.getAttribute('data-r')); if (!r) return;
      var k = this.getAttribute('data-k');
      setPath(r, k, this.type === 'number' ? (+this.value || 0) : this.value);
      ruleChanged();
    };
  }
  var btns = host.querySelectorAll('button[data-act]');
  for (var b = 0; b < btns.length; b++) {
    btns[b].onclick = function () {
      var r = ruleById(+this.getAttribute('data-r')); if (!r) return;
      var act = this.getAttribute('data-act');
      if (act === 'toggle') r.enabled = !r.enabled;
      else if (act === 'del') {
        for (var k = curCtrl.rules.length - 1; k >= 0; k--) {
          if (curCtrl.rules[k].id === r.id) curCtrl.rules.splice(k, 1);
        }
      } else if (act === 'unref') r.when.refName = null;
      ruleChanged();
    };
  }
  // 대상 고르기 — 지도에서 클릭한다 (노드 편집기와 같은 경로를 쓴다)
  var picks = host.querySelectorAll('button[data-pick]');
  for (var p = 0; p < picks.length; p++) {
    picks[p].onclick = function () {
      var rid = +this.getAttribute('data-r'), key = this.getAttribute('data-pick');
      var filter = this.getAttribute('data-f').split(',');
      startPickFor(filter, function (entId) {
        var r = ruleById(rid); if (!r) return;
        setPath(r, key, entId);
        ruleChanged();
      });
    };
  }
  var cards = host.querySelectorAll('.c[data-card]');
  for (var c = 0; c < cards.length; c++) {
    cards[c].onclick = function () {
      if (this.classList.contains('locked')) {
        toast('이 카드는 연구가 먼저다', 'bad'); return;
      }
      var id = this.getAttribute('data-card');
      for (var k = 0; k < RULE_CARDS.length; k++) {
        if (RULE_CARDS[k].id !== id) continue;
        if (!curCtrl.rules) { curCtrl.rules = []; curCtrl.nextRuleId = 1; }
        var r = newRule(curCtrl.nextRuleId++);
        RULE_CARDS[k].make(r);
        curCtrl.rules.push(r);
        ruleChanged();
        return;
      }
    };
  }
  var add = document.getElementById('rAdd');
  if (add) add.onclick = function () {
    if (!curCtrl.rules) { curCtrl.rules = []; curCtrl.nextRuleId = 1; }
    curCtrl.rules.push(newRule(curCtrl.nextRuleId++));
    ruleChanged();
  };
}
