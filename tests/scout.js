// 세계 정찰 — 공장 배치를 설계하려면 광맥과 둥지가 어디 있는지부터 알아야 한다.
// 사람이 새 판을 열고 지도를 훑는 것과 같은 일이고, 결과를 보고 배치를 손으로 짠다.
(function () {
  function emit(obj) {
    document.getElementById('testout').textContent =
      '@@JSON_START@@' + JSON.stringify(obj) + '@@JSON_END@@';
  }
  function go() {
    var out = { checks: [{ name: 'scout.ran', ok: true, detail: 'ok' },
                         { name: 'selftest.mustFail', ok: false, detail: 'x', expectFail: true }],
                errors: [], fatal: null, notes: [], measured: {} };
    try {
      var G = window.__GAME;
      var SEED = 424242;
      G.reset(SEED);
      var st = G.state();
      out.measured.seed = SEED;
      out.measured.world = { w: st.W || null, spawn: G.camera() };

      // 자원별로 가장 가까운/큰 광맥 몇 곳
      var kinds = ['iron-ore', 'copper-ore', 'coal', 'stone'];
      var spots = {};
      for (var i = 0; i < kinds.length; i++) {
        var cam = G.camera();
        spots[kinds[i]] = G.oreSpotsNear(kinds[i], Math.round(cam.x), Math.round(cam.y), 8);
      }
      out.measured.ore = spots;
      out.measured.nests = G.nestList ? G.nestList() : null;
      out.measured.startKit = st.counts;
      out.measured.inventory = st.inventory;
      out.finalState = st;
    } catch (e) { out.fatal = (e && e.stack) ? e.stack : String(e); }
    emit(out);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 60); });
  else setTimeout(go, 60);
})();
