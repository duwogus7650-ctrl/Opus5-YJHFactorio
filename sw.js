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
var CACHE = 'logic-foundry-v1';
var ASSETS = ['./', './index.html', './dist/Logic-Foundry.html'];

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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // 남의 집 것은 손대지 않는다

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () {
          return hit || Response.error();               // 오프라인 — 가진 것으로 답한다
        });
        return hit || net;
      });
    })
  );
});
