// ===========================================================================
//  서비스워커 — 설치한 앱을 **비행기 모드에서도** 열리게 한다.
//
//  왜 따로 파일인가: 서비스워커는 같은 출처의 **독립된 스크립트 주소**로만 등록된다
//  (blob: 이나 data: 로는 안 된다). 그래서 배포는 "HTML 한 장 + 이 파일"이 된다.
//  **게임 산출물 자체는 여전히 자기완결 한 장이다** — 이 파일은 그것을 감싸는
//  껍데기이고, 게임 코드는 한 줄도 여기 들어오지 않는다.
//
//  전략: stale-while-revalidate.
//   * 열 때는 캐시에서 즉시 준다 (네트워크가 없어도 뜬다).
//   * 동시에 뒤에서 새 판을 받아 캐시를 갈아 둔다 (다음에 열면 최신).
//  캐시 우선이 아니라 네트워크 우선으로 하면, 신호가 나쁜 곳에서 로딩이 몇 초씩
//  걸린다 — 이미 가진 것을 두고 기다릴 이유가 없다.
// ===========================================================================
// 담는 목록이 바뀌면 **이름을 올린다.** 안 올리면 예전 캐시가 그대로 남아
// 새로 담기로 한 것들이 영영 안 담긴다(설치 단계는 캐시가 이미 있으면 건너뛴다).
var CACHE = 'logic-foundry-v3';
var ASSETS = ['./', './index.html', './dist/Logic-Foundry.html',
              './site/shot-factory.jpg', './site/shot-logic.jpg',
              './site/shot-phone.jpg', './site/shot-oil.jpg'];

self.addEventListener('install', function (e) {
  // 설치 즉시 게임 한 장을 받아 둔다. 이게 없으면 "설치는 됐는데 오프라인에서 안 뜨는"
  // 상태가 된다 — 사용자는 설치했다고 믿는데 비행기 모드에서 공룡이 뜬다.
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS).catch(function () {
        // 하나가 실패해도 설치는 계속한다 (index.html 이 없는 배치도 있다).
        return c.add('./dist/Logic-Foundry.html');
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 버전 확인은 **여기서** 한다. 배포본(HTML 한 장)은 네트워크를 열지 않는다는 것이
// 이 프로젝트의 약속이고, offline_check 가 그것을 지킨다 — 게임 안에 fetch 를 넣었다가
// 그 자리에서 걸렸다. 네트워크를 아는 쪽은 이 껍데기다.
self.addEventListener('message', function (e) {
  var msg = e.data || {};
  if (msg.q !== 'version') return;
  var src = e.source;
  fetch(new URL('./build.txt', self.location.href).href, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.text() : null; })
    .then(function (t) {
      var id = t ? t.trim() : null;
      if (src) src.postMessage({ a: 'version', id: id, mine: msg.id || null });
    })
    .catch(function () { if (src) src.postMessage({ a: 'version', id: null }); });
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // 남의 집 것은 손대지 않는다
  // 버전 표는 **캐시하지 않는다.** 캐시된 도장을 보고 '최신이다' 라고 답하면
  // 그 확인은 아무 일도 안 하는 것이다.
  if (url.pathname.indexOf('build.txt') >= 0) return;
  // 탈출문도 캐시하지 않는다 — 캐시된 탈출문은 탈출문이 아니다.
  if (url.pathname.indexOf('update.html') >= 0) return;

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () {
          // 오프라인이다. 가진 것이 있으면 그것으로 답한다.
          if (hit) return hit;
          // **화면 이동은 반드시 무언가로 답해야 한다.** 주소가 조금만 달라도
          // (끝의 슬래시, index.html 을 붙였는지, ?뒤에 붙은 것) 정확히 일치하는
          // 캐시가 없어 실패하고, 그러면 설치한 앱이 '오프라인 상태입니다' 를 띄운다.
          // 실기기에서 그렇게 떴다. 이럴 때는 가진 페이지 중 하나로 답한다.
          if (req.mode === 'navigate') {
            return c.match('./index.html', { ignoreSearch: true })
              .then(function (idx) { return idx || c.match('./dist/Logic-Foundry.html', { ignoreSearch: true }); })
              .then(function (any) { return any || Response.error(); });
          }
          return Response.error();
        });
        return hit || net;
      });
    })
  );
});
