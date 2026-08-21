// ===========================================================================
//  35_logic.js — ★ 이 게임의 차별점: 프로그래머블 제어기
//
//  제어기 하나는 데이터플로 그래프다. 매 틱 위상순으로 한 번 평가한다.
//  순환(피드백)이 생기면 그 간선만 "직전 틱의 값"을 읽는다 — 즉 1틱 지연 레지스터다.
//  실제 순차논리(D 플립플롭 한 단)와 같은 의미이고, 그래서 SR 래치·카운터·PID 같은
//  상태 소자를 자연스럽게 배선할 수 있다.
//
//  값은 전부 실수 하나. **참/거짓은 0.5 이상 = 참**이다 (TRUE_EPS).
//  0 초과가 아니다 — 0.4 는 거짓이다. 신호가 대부분 정수(0/1)라 잡음을
//  참으로 읽지 않으려고 이렇게 뒀다. 사칙 1/4=0.25, PID 출력 0.3 처럼
//  소수를 내는 노드를 참/거짓 자리에 물릴 때 걸린다 — 도움말에도 적어 둔다.
// ===========================================================================

var TRUE_EPS = 0.5;
// 화면에 보이는 이름 → 유체망이 들고 있는 이름. 한글을 코드 안에서 바로 키로 쓰면
// 이름 하나 바꿀 때 저장까지 깨진다.
var OIL_KEY = { '원유': 'oil', '중유': 'heavy', '경유': 'light', '가스': 'gas' };

// 단계 → 그 단계에서 나가는 전이 입력의 번호. 위 노드 정의의 주석과 같은 표다.
// 표로 두는 이유: 계산식으로 쓰면 '4는 예외' 를 코드 두 곳에 적게 된다.
var FSM_PORT = [0, 0, 1, 2, 3, 5, 6, 7, 8];   // [_,1단계,2,3,4,5,6,7,8]
function fsmStages(n) { return (n.cfg.stages === '8단계') ? 8 : 4; }
// 4단계로 둔 노드에서 5~8단계 자리는 **아무 일도 하지 않는 자리**다. 화면에도
// 그리지 않는다 — 있는데 안 되는 것이 없는 것보다 나쁘다.
function fsmPortActive(n, dir, i) {
  if (n.kind !== 'fsm') return true;
  if (fsmStages(n) === 8) return true;
  return i <= 4;
}      // >= 0.5 를 참으로 본다 (정수 신호가 대부분이라)
function truthy(v) { return v >= TRUE_EPS; }

// --- 신호 버스 --------------------------------------------------------------
//  제어기끼리 값을 주고받는 8채널. 두 가지를 못 박아 둔다.
//
//  * **읽기는 언제나 직전 틱의 값이다.** 같은 틱에 읽히게 하면 두 제어기의 평가
//    순서가 값을 갈라놓는다 — 제어기 사이의 순서는 배치로 정해지지 않으므로
//    (graphCompile 주석 참고) 플레이어가 원인을 짚을 단서가 하나도 없다.
//    1틱 지연은 이미 이 게임이 되먹임 배선에 쓰는 규약이라 새 개념도 아니다.
//  * **여러 송신자는 합산된다.** 마지막 값이 이기게 하면 이 역시 순서 의존이고,
//    한쪽 회로가 통째로 무시당한 것처럼 보인다. 합은 순서와 무관하다.
//
//  채널 이름은 자유 입력이 아니라 고정 목록이다 — 오타 하나로 조용히 침묵하는
//  것이 이 게임에서 가장 나쁜 실패다(대상 필터를 좁힌 것과 같은 이유).
var BUS_CHANNELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// **채널에 이름을 붙인다.** 제어기가 둘을 넘어가면 'A' 가 무엇이었는지 아무도 기억
// 못 한다 — 신호 버스는 공장 전체가 공유하는 유일한 배선이라, 이름이 없으면 그 배선을
// 읽을 수 없다. 이름은 판마다 다르므로 저장에 담는다.
var busNames = {};
function busName(ch) { return busNames[ch] || ''; }
function busLabel(ch) { var n = busNames[ch]; return n ? (ch + ' — ' + n) : ch; }
function setBusName(ch, name) {
  if (BUS_CHANNELS.indexOf(ch) < 0) return false;
  name = String(name || '').slice(0, 14).trim();
  if (name) busNames[ch] = name; else delete busNames[ch];
  return true;
}
// 누가 쓰고 누가 읽는가 — 값만 보여 주면 '이 숫자를 만든 회로'를 찾아 헤매게 된다.
function busUsers() {
  var use = {};
  for (var i = 0; i < BUS_CHANNELS.length; i++) use[BUS_CHANNELS[i]] = { w: 0, r: 0 };
  forEachEntity(function (e) {
    if (e.type !== 'controller' || !e.graph) return;
    for (var j = 0; j < e.graph.nodes.length; j++) {
      var n = e.graph.nodes[j], ch = n.cfg && n.cfg.ch;
      if (!ch || !use[ch]) continue;
      if (n.kind === 'bussend') use[ch].w++;
      else if (n.kind === 'busrecv') use[ch].r++;
    }
  });
  return use;
}
var busNow = {};        // 이번 틱에 읽히는 값 = 직전 틱 합계
var busNext = {};       // 이번 틱에 쌓이는 합계
function busClear() { busNow = {}; busNext = {}; }
function busNamesClear() { busNames = {}; }
function busRead(ch) { var v = busNow[ch]; return (typeof v === 'number' && isFinite(v)) ? v : 0; }
function busWrite(ch, v) {
  if (!(typeof v === 'number' && isFinite(v))) return;
  busNext[ch] = (busNext[ch] || 0) + v;
}
// 틱 끝에서 교체한다. 송신 노드를 지우면 다음 틱 합계에 그 몫이 아예 없으므로
// 채널이 저절로 0 으로 돌아온다 — 출력 축의 '유령 지배' 해제와 같은 성질이다.
function busSwap() { busNow = busNext; busNext = {}; }
function busSnapshot() { var o = {}; for (var k in busNow) if (busNow[k]) o[k] = busNow[k]; return o; }
function busRestore(o) {
  busClear();
  if (!o) return;
  for (var i = 0; i < BUS_CHANNELS.length; i++) {
    var c = BUS_CHANNELS[i], v = o[c];
    if (typeof v === 'number' && isFinite(v)) busNow[c] = v;
  }
}

// --- 노드 정의표 -----------------------------------------------------------
//  cat: 'in' 입력 / 'op' 연산 / 'out' 출력
//  cfg 항목 type: 'num' | 'item' | 'ent' | 'opsel' | 'text'
var NODE_DEFS = {
  // ---- 입력 ----
  'const':   { label: '상수', cat: 'in', ins: [], outs: ['값'],
               cfg: [{ k: 'value', t: 'num', label: '값', def: 1 }] },
  'chest':   { label: '상자 재고', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['chest'] },
                     { k: 'item', t: 'item', label: '품목' }] },
  'machine': { label: '기계 상태', cat: 'in', ins: [], outs: ['가동', '정체', '진행%'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상',
                       filter: ['miner', 'furnace', 'assembler', 'lab', 'generator', 'turret', 'inserter'] }] },
  // 출구 다섯 개 **모두 자기 전력망 기준**이다. 예전에는 만족%만 자기 망이고
  // 공급kW/수요kW 는 전 세계 합계였다 — 발전소가 둘이면 제어기가 지도 반대편
  // 숫자로 판단했다. '여유kW' 는 공급-수요이고 **클램프하지 않는다**:
  // 만족%는 100 에서 잘려 부하 차단의 히스테리시스에 쓸 사공간이 없다.
  // '망연결' 은 0 이 '전기 없음' 인지 '망 밖'인지 구별하게 해준다.
  'power':   { label: '전력 만족도', cat: 'in', ins: [],
               outs: ['만족%', '공급kW', '수요kW', '여유kW', '망연결'],
               cfg: [] },
  'timer':   { label: '타이머', cat: 'in', ins: [], outs: ['펄스', '위상%'],
               cfg: [{ k: 'period', t: 'num', label: '주기', def: 5 }] },
  'belt':    { label: '벨트 센서', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['belt', 'splitter'] },
                     { k: 'item', t: 'item', label: '품목' }] },
  'invsense':{ label: '창고 재고', cat: 'in', ins: [], outs: ['개수'],
               cfg: [{ k: 'item', t: 'item', label: '품목' }] },
  'research':{ label: '연구 진행', cat: 'in', ins: [], outs: ['진행%', '연구중'],
               cfg: [] },
  'enemy':   { label: '적 근접', cat: 'in', ins: [], outs: ['마릿수', '최근접거리'],
               cfg: [{ k: 'radius', t: 'num', label: '반경', def: 30 }],
               tech: 'defense-ai' },
  'busrecv': { label: '신호 받기', cat: 'in', ins: [], outs: ['값'],
               cfg: [{ k: 'ch', t: 'opsel', label: '채널', opts: BUS_CHANNELS, def: 'A' }],
               tech: 'logic-ctrl' },
  // 유체 센서 — 이 게임에서 **유일한 선행 지표**다. 전력 만족도는 이미 모자란
  // 뒤에야 떨어지지만, 증기%는 그 전에 준다. "모자란 다음에 끄기"와 "마르기 전에
  // 끄기"를 가르는 것이 이 노드이고, 유체 계통을 넣은 이유가 그것이다.
  // 망연결 출구가 따로 있는 이유는 전력 노드와 같다 — 0 이 '비었다'인지
  // '파이프를 안 이었다'인지 구별하지 못하면 원인을 짚을 수 없다.
  // 읽는 값은 **직전 틱**의 유체 상태다. 틱 순서가 로직 → 유체 → 전력이라
  // 그렇게 되고, 기계 상태 센서도 같은 규약이다. 60/s 로 차는 중이면 한 틱에
  // 1 만큼 벌어질 수 있다 — 임계값을 그 폭보다 촘촘하게 잡지 말 것.
  // **출구를 뒤에 붙인다.** 앞의 넷은 순서가 곧 배선이라, 사이에 끼우면 예전 저장의
  // 배선이 통째로 어긋난다(증기를 읽던 선이 물을 읽게 된다). 새 것은 언제나 뒤로.
  // 석유는 넷(원유·중유·경유·가스)이나 출구를 넷 다 달면 노드가 8칸짜리가 된다 —
  // 하나를 골라 읽는다. 회로가 한 번에 보고 싶은 것은 대개 하나다.
  'fluid':   { label: '유체 잔량', cat: 'in', ins: [],
               outs: ['증기%', '증기', '물', '망연결', '석유%', '석유'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상',
                       filter: ['pipe', 'pump', 'boiler', 'engine', 'tank', 'xpump',
                                'pumpjack', 'refinery', 'chemplant'] },
                     { k: 'oil', t: 'opsel', label: '석유',
                       opts: ['원유', '중유', '경유', '가스'], def: '중유' }],
               tech: 'steel' },

  // 역 센서 — 배차를 회로로 짜려면 "지금 열차가 서 있나 · 얼마나 실렸나" 를
  // 읽을 수 있어야 한다. 화물%는 임계값을 비율로 잡는 회로에 쓴다.
  'station': { label: '역 상태', cat: 'in', ins: [],
               outs: ['열차있음', '화물', '화물%'],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['station'] }],
               tech: 'steel' },

  // ---- 연산 ----
  'cmp':     { label: '비교', cat: 'op', ins: ['A', 'B'], outs: ['참'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['>', '>=', '<', '<=', '==', '!='], def: '>' }] },
  'math':    { label: '사칙', cat: 'op', ins: ['A', 'B'], outs: ['값'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['+', '-', '*', '/', '%', 'min', 'max'], def: '+' }] },
  'bool':    { label: '논리', cat: 'op', ins: ['A', 'B'], outs: ['참'],
               cfg: [{ k: 'op', t: 'opsel', label: '연산', opts: ['AND', 'OR', 'XOR', 'NOT A'], def: 'AND' }] },
  'clamp':   { label: '범위 제한', cat: 'op', ins: ['값'], outs: ['값'],
               cfg: [{ k: 'lo', t: 'num', label: '하한', def: 0 }, { k: 'hi', t: 'num', label: '상한', def: 100 }] },
  'select':  { label: '선택 (조건 ? A : B)', cat: 'op', ins: ['조건', 'A', 'B'], outs: ['값'], cfg: [] },
  'latch':   { label: 'SR 래치', cat: 'op', ins: ['SET', 'RESET'], outs: ['Q'], cfg: [], tech: 'logic-mem' },
  'counter': { label: '카운터', cat: 'op', ins: ['증가', '리셋'], outs: ['값'],
               cfg: [{ k: 'max', t: 'num', label: '상한', def: 0 }], tech: 'logic-mem' },
  'edge':    { label: '엣지 검출', cat: 'op', ins: ['A'], outs: ['펄스'],
               cfg: [{ k: 'mode', t: 'opsel', label: '검출', opts: ['상승', '하강', '양쪽'], def: '상승' }], tech: 'logic-mem' },
  'hold':    { label: '샘플 홀드', cat: 'op', ins: ['값', '샘플'], outs: ['유지값'], cfg: [], tech: 'logic-mem' },
  // 1차 저역통과(EMA). **박스카 평균이 아니다** — 창 안의 표본을 다 들고 있으면
  // 노드마다 배열이 저장에 들어가는데, 저장은 localStorage 한 칸(약 140 KB)이고
  // 이미 141 KB 다. 여기 상태는 숫자 하나뿐이고, 계단응답 1-e^(-t/τ) 가 그대로
  // 게이트의 오라클이 된다. τ 는 63% 에 도달하는 시간이다.
  'smooth':  { label: '평활 필터', cat: 'op', ins: ['값'], outs: ['평활값'],
               cfg: [{ k: 'tau', t: 'num', label: '시상수 s', def: 5 }], tech: 'logic-ctrl' },
  // 지속 조건 — **조건이 N초 이상 계속돼야 참.** 딸깍임을 거르는 두 번째 방법이고,
  // 평활 필터와 다른 자리를 맡는다: 평활은 값을 눅여서 **모든 반응을 늦추는** 대신
  // 진짜 변화도 늦게 알리고, 지속은 값을 안 건드리는 대신 **짧은 튐만** 버린다.
  //   "전기가 모자라다" 가 한 틱 스쳤다 → 지속 3초면 무시된다
  //   진짜로 3초 넘게 모자라면 → 그 순간 즉시 참이 된다(지연이 아니라 확인이다)
  // 조건이 끊기면 시계는 0 으로 돌아간다 — '누적'이 아니라 '연속'이라야 한다.
  // 최고·최저 기록 — **완충을 얼마나 둘지 정하려면 최악치를 알아야 한다.**
  // 저장 탱크가 들어오면서 "얼마나 두는가" 가 플레이어의 설계 결정이 됐는데, 그
  // 결정의 근거는 "이번 판에서 증기가 가장 낮았을 때 몇 %였나" 다. 순간값은 눈
  // 깜짝할 사이에 지나가므로 회로가 대신 기억해 준다.
  //
  // **씨앗을 0 으로 박으면 안 된다.** 최저 기록은 0 보다 낮은 값이 없어서 영원히
  // 0 을 낸다 — 평활 필터가 같은 함정을 겪었다(교훈 15). 첫 실제 입력에서 출발한다.
  'peak':    { label: '최고·최저 기록', cat: 'op', ins: ['값', '리셋'], outs: ['기록'],
               cfg: [{ k: 'mode', t: 'opsel', label: '기록', opts: ['최저', '최고'], def: '최저' }],
               tech: 'logic-mem' },
  'sustain': { label: '지속 조건', cat: 'op', ins: ['조건'], outs: ['참'],
               cfg: [{ k: 'sec', t: 'num', label: '지속 s', def: 3 }], tech: 'logic-mem' },
  // 변화율 — **얼마나 남았나가 아니라 얼마나 빨리 줄고 있나.**
  // 완충(저장 탱크)이 커질수록 수위 자체는 느리게 움직여 신호로 약해진다. 그때
  // 쓸 수 있는 것이 기울기다: 증기가 초당 12씩 줄고 있고 3000 남았다면 250초 뒤에
  // 마른다 — 그 나눗셈은 [계산] 노드가 이미 할 수 있다. 이 노드는 그 분모를 만든다.
  //
  // 원 미분은 60 Hz 에서 톱니처럼 튀므로 평활 필터와 같은 지수 평활을 얹는다.
  // 창(win)이 0 이면 평활 없이 그대로 — 음성 대조군용이자 "날것을 보고 싶다" 용이다.
  'rate':    { label: '변화율', cat: 'op', ins: ['값'], outs: ['초당 변화'],
               cfg: [{ k: 'win', t: 'num', label: '평활 창 s', def: 2 }], tech: 'logic-ctrl' },
  // 4단계 상태기계(SFC). 전이는 **상승엣지**다 — 레벨로 하면 조건이 참인 동안
  // 60 Hz 로 단계가 돌아버린다. 카운터의 '증가' 입력이 이미 같은 규약이다.
  // 리셋은 레벨이고 전이보다 우선한다(SR 래치의 RESET 과 같다).
  // **단계를 늘리되 앞의 자리는 건드리지 않는다.** 포트 번호가 곧 배선이라, 사이에
  // 끼우면 예전 저장의 배선이 통째로 어긋난다(3→4 를 물던 선이 4→5 를 물게 된다).
  // 그래서 5단계부터의 전이는 전부 **뒤에** 붙였다. 0~4번은 예전 그대로다.
  //   0:1→2  1:2→3  2:3→4  3:(4단계면 4→1, 8단계면 4→5)  4:리셋
  //   5:5→6  6:6→7  7:7→8  8:8→1
  // 4·8 만 고를 수 있게 한 것도 이 때문이다 — 5~7단계면 마지막 전이가 4번(리셋)과
  // 자리를 다툰다. 두 값만 두면 그 충돌이 아예 생기지 않는다.
  'fsm':     { label: '상태기계', cat: 'op',
               ins: ['1→2', '2→3', '3→4', '4→1', '리셋', '5→6', '6→7', '7→8', '8→1'],
               outs: ['단계', '1단계', '2단계', '3단계', '4단계',
                      '5단계', '6단계', '7단계', '8단계'],
               cfg: [{ k: 'stages', t: 'opsel', label: '단계 수',
                       opts: ['4단계', '8단계'], def: '4단계' }], tech: 'logic-mem' },
  'pid':     { label: 'PID 제어', cat: 'op', ins: ['목표', '측정'], outs: ['출력', '오차'],
               cfg: [{ k: 'kp', t: 'num', label: 'Kp', def: 1 }, { k: 'ki', t: 'num', label: 'Ki', def: 0 },
                     { k: 'kd', t: 'num', label: 'Kd', def: 0 }, { k: 'lim', t: 'num', label: '제한', def: 100 }],
               tech: 'logic-ctrl' },

  // ---- 출력 ----
  // 대상 목록을 **실제로 enabled 를 보는 건물**로 좁힌다. 예전에는 벽·전주·상자·
  // 벨트까지 고를 수 있었는데, 그것들은 enabled 를 읽지 않아 배선해도 아무 일도
  // 일어나지 않았다. 고를 수 있으면 고른다 — 그리고 왜 안 되는지 알 수 없다.
  // (벨트를 멈추려면 [벨트 게이트] 를 쓴다.)
  'enable':  { label: '기계 가동/정지', cat: 'out', ins: ['가동'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상',
                       filter: ['miner', 'furnace', 'assembler', 'lab', 'generator', 'turret', 'inserter'] }] },
  'gate':    { label: '벨트 게이트', cat: 'out', ins: ['열림'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['belt', 'splitter'] }], tech: 'logic-ctrl' },
  'filter':  { label: '인서터 필터', cat: 'out', ins: ['선택'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['inserter'] },
                     { k: 'a', t: 'item', label: '0일 때' },
                     { k: 'b', t: 'item', label: '1일 때' }], tech: 'logic-ctrl' },
  'fire':    { label: '터렛 사격허가', cat: 'out', ins: ['허가'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['turret'] }], tech: 'defense-ai' },
  'lamp':    { label: '경보 램프', cat: 'out', ins: ['점등'], outs: [],
               cfg: [{ k: 'label', t: 'text', label: '문구', def: '' }] },
  'display': { label: '수치 표시', cat: 'out', ins: ['값'], outs: [],
               cfg: [{ k: 'label', t: 'text', label: '이름', def: '' }] },
  // 열차 출발 — **물리는 순간 그 역은 제어기 지배 하에 들어간다.** 입력이 참이면
  // 보내고 거짓이면 붙잡는다. 안 물리면 기본 규칙(가득 차거나 정차 시간 초과)으로
  // 돌아간다 — 배선 없이도 게임이 돌아야 하기 때문이다. 다른 출력 노드가 쓰는
  // '안 물린 입력은 지배하지 않는다' 와 같은 규약이다.
  'traingo': { label: '열차 출발', cat: 'out', ins: ['출발'], outs: [],
               cfg: [{ k: 'ent', t: 'ent', label: '대상', filter: ['station'] }],
               tech: 'steel' },
  'bussend': { label: '신호 보내기', cat: 'out', ins: ['값'], outs: [],
               cfg: [{ k: 'ch', t: 'opsel', label: '채널', opts: BUS_CHANNELS, def: 'A' }],
               tech: 'logic-ctrl' }
};
var NODE_KINDS = Object.keys(NODE_DEFS);

function nodeAvailable(kind) {
  var d = NODE_DEFS[kind];
  return !d.tech || !!techDone[d.tech];
}

// --- 그래프 ----------------------------------------------------------------
function newGraph() {
  return { nodes: [], links: [], nextNid: 1, order: null, backEdges: null, dirty: true };
}
function graphAddNode(g, kind, x, y) {
  var d = NODE_DEFS[kind];
  var n = { nid: g.nextNid++, kind: kind, x: x, y: y, cfg: {}, state: {}, out: [], prev: [] };
  for (var i = 0; i < d.cfg.length; i++) {
    var c = d.cfg[i];
    n.cfg[c.k] = (c.def !== undefined) ? c.def : (c.t === 'num' ? 0 : (c.t === 'opsel' ? c.opts[0] : null));
  }
  for (var o = 0; o < d.outs.length; o++) { n.out.push(0); n.prev.push(0); }
  g.nodes.push(n);
  g.dirty = true;
  return n;
}
function graphNode(g, nid) {
  for (var i = 0; i < g.nodes.length; i++) if (g.nodes[i].nid === nid) return g.nodes[i];
  return null;
}
function graphRemoveNode(g, nid) {
  for (var i = g.nodes.length - 1; i >= 0; i--) if (g.nodes[i].nid === nid) g.nodes.splice(i, 1);
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].fn === nid || g.links[j].tn === nid) g.links.splice(j, 1);
  }
  g.dirty = true;
}
// 입력 포트 하나에는 간선 하나만 — 여러 개가 붙으면 값이 결정되지 않는다
function graphLink(g, fromNid, fromPort, toNid, toPort) {
  if (fromNid === toNid) return false;
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].tn === toNid && g.links[j].tp === toPort) g.links.splice(j, 1);
  }
  g.links.push({ fn: fromNid, fp: fromPort, tn: toNid, tp: toPort });
  g.dirty = true;
  return true;
}
function graphUnlink(g, toNid, toPort) {
  for (var j = g.links.length - 1; j >= 0; j--) {
    if (g.links[j].tn === toNid && g.links[j].tp === toPort) { g.links.splice(j, 1); g.dirty = true; }
  }
}

// --- 위상정렬 + 피드백 간선 판별 ---------------------------------------------
// DFS 로 후향 간선(back edge)을 찾아 그것만 "직전 틱 값"으로 읽게 표시한다.
function graphCompile(g) {
  var byId = {};
  for (var i = 0; i < g.nodes.length; i++) byId[g.nodes[i].nid] = g.nodes[i];
  var adj = {};
  for (var a = 0; a < g.nodes.length; a++) adj[g.nodes[a].nid] = [];
  for (var l = 0; l < g.links.length; l++) {
    var lk = g.links[l];
    if (byId[lk.fn] && byId[lk.tn]) adj[lk.fn].push({ to: lk.tn, link: lk });
    lk.back = false;
  }

  // **평가 순서는 '화면에 보이는 배치'의 함수여야 한다.**
  // 예전에는 DFS 진입점 순서 = g.nodes 배열 순서 = **노드를 만든 순서**였다.
  // 그래서 위치와 배선이 글자 하나까지 같은 두 회로가 다르게 돌았다 — 어느 배선이
  // 1틱 지연 되먹임이 되는지가 갈렸고, 값까지 달라졌다. 더 나쁜 것은 노드 하나를
  // 지우고 같은 자리에 다시 만들면(splice 후 push) 그 노드가 순서 맨 뒤로 밀려
  // 손도 안 댄 회로가 갑자기 다르게 도는 것이었다.
  // 화면에는 좌표와 배선만 보이고 생성 순서는 어디에도 안 나오므로, 플레이어가
  // 원인을 짚을 단서가 없었다. 좌표순으로 정렬하면 보이는 것이 곧 규칙이 된다.
  function layoutKey(n) { return [Math.round(n.x), Math.round(n.y), n.nid]; }
  function cmpNode(p, q) {
    var A = layoutKey(p), B = layoutKey(q);
    return (A[0] - B[0]) || (A[1] - B[1]) || (A[2] - B[2]);
  }
  var roots = g.nodes.slice().sort(cmpNode);
  for (var r2 = 0; r2 < roots.length; r2++) {
    var ls2 = adj[roots[r2].nid];
    if (ls2 && ls2.length > 1) {
      ls2.sort(function (u, v) { return cmpNode(byId[u.to], byId[v.to]); });
    }
  }
  var color = {};     // 0 미방문, 1 스택 위, 2 완료
  var order = [];
  function dfs(nid) {
    color[nid] = 1;
    var ls = adj[nid];
    for (var k = 0; k < ls.length; k++) {
      var t = ls[k].to;
      if (color[t] === 1) { ls[k].link.back = true; }        // 후향 간선 = 피드백
      else if (!color[t]) dfs(t);
    }
    color[nid] = 2;
    order.push(nid);
  }
  // **후위순회를 숲 전체에서 한 번에 뒤집는다 (reverse post-order).** 이것만이
  // 그래프 전체의 올바른 위상순서다 — 즉 어떤 노드도 자기 입력보다 먼저 돌지 않는다.
  //
  // 두 번 손댔다가 두 번 다 되돌렸으니 다시 건드리지 말 것:
  //   · 나무마다 따로 뒤집기 → 두 나무가 공유하는 노드가 입력보다 먼저 돌아
  //     샘플홀드가 옛 샘플로 갱신됐다 (node.hold RED).
  //   · 진입을 좌표 역순으로 → 순환 회로는 진입점이 하나뿐이라 좌표를 옮겨도
  //     순서가 안 바뀌었다 (ctrl.orderFollowsLayout RED).
  //
  // 한 회로 안에서는 "왼쪽 위가 먼저"가 성립한다(진입점이 먼저 나온다). 서로 이어지지
  // 않은 회로 **사이의** 순서는 DFS 구조가 정하며 좌표대로가 아니다 — 도움말은
  // 그 사실대로 쓴다. 같은 대상을 두 회로가 잡으면 순서에 기대지 말고 충돌 경고를 볼 것.
  for (var s = 0; s < roots.length; s++) if (!color[roots[s].nid]) dfs(roots[s].nid);
  order.reverse();
  g.order = order;
  g.byId = byId;
  // 입력 포트별 소스 링크 색인
  g.inLinks = {};
  for (var m = 0; m < g.links.length; m++) {
    var lm = g.links[m];
    if (!byId[lm.fn] || !byId[lm.tn]) continue;
    g.inLinks[lm.tn + ':' + lm.tp] = lm;
  }
  g.dirty = false;
  g.cycles = g.links.filter(function (x) { return x.back; }).length;
}

// --- 평가 -------------------------------------------------------------------
var logicDirty = true;
function markLogicDirty() { logicDirty = true; }
function dropLogicRefs(entId) {
  forEachEntity(function (e) {
    if (e.type !== 'controller' || !e.graph) return;
    for (var i = 0; i < e.graph.nodes.length; i++) {
      var n = e.graph.nodes[i];
      if (n.cfg && n.cfg.ent === entId) n.cfg.ent = null;
    }
  });
}

var alarms = [];        // 이번 틱에 켜진 램프 문구
var displays = [];      // { label, value }

// 이 입력 포트에 배선이 실제로 물려 있는가. 값이 0 인 것과 아예 안 물린 것은
// 다르다 — 출력 노드가 그 둘을 구별하지 않아 '안 물림'을 '정지 명령'으로 읽었다.
function inputFed(g, n, port) {
  return !!(g.inLinks && g.inLinks[n.nid + ':' + port]);
}

function readIn(g, n, port) {
  // **컴파일 전 그래프에서 부를 수 있다.** inLinks 는 graphCompile 이 만드는데,
  // 편집기의 해석 줄(updateLive)은 제어기가 아직 한 번도 평가되지 않은 상태에서도
  // 이 함수를 부른다 — 그때 g.inLinks 가 undefined 라 TypeError 로 죽고,
  // 그 예외가 updateLive 전체를 멈춰 편집기가 영구히 얼어붙는다.
  if (!g.inLinks) return 0;
  var lk = g.inLinks[n.nid + ':' + port];
  if (!lk) return 0;
  var src = g.byId[lk.fn];
  if (!src) return 0;
  var v = lk.back ? src.prev[lk.fp] : src.out[lk.fp];
  return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

function evalNode(g, n, dt, ctrl) {
  var d = NODE_DEFS[n.kind];
  if (d.tech && !techDone[d.tech]) { for (var z = 0; z < n.out.length; z++) n.out[z] = 0; return; }
  switch (n.kind) {
    case 'const': n.out[0] = +n.cfg.value || 0; break;

    case 'chest': {
      var e = entities[n.cfg.ent];
      if (!e || e.type !== 'chest') { n.out[0] = 0; break; }
      n.out[0] = n.cfg.item ? invCount(e.inv, n.cfg.item) : invTotal(e.inv);
      break;
    }
    case 'machine': {
      var m = entities[n.cfg.ent];
      if (!m) { n.out[0] = 0; n.out[1] = 0; n.out[2] = 0; break; }
      n.out[0] = m.working ? 1 : 0;
      n.out[1] = m.stallT > 1.5 ? 1 : 0;
      n.out[2] = Math.round((m.progress || 0) * 100);
      break;
    }
    case 'power': {
      var np = ctrl ? netPowerOf(ctrl)
                    : { connected: 1, supply: powerStats.supply,
                        demand: powerStats.demand, head: powerStats.supply - powerStats.demand };
      var sat = ctrl ? netSatOf(ctrl) : powerStats.sat;
      n.out[0] = Math.round(sat * 100);
      n.out[1] = Math.round(np.supply);
      n.out[2] = Math.round(np.demand);
      n.out[3] = Math.round(np.head);      // 클램프 없음 — 남는 쪽도 보인다
      n.out[4] = np.connected;
      break;
    }
    case 'timer': {
      var per = Math.max(0.05, +n.cfg.period || 1);
      n.state.t = (n.state.t || 0) + dt;
      var fired = 0;
      if (n.state.t >= per) { n.state.t -= per; fired = 1; }
      n.out[0] = fired;
      n.out[1] = Math.round((n.state.t / per) * 100);
      break;
    }
    case 'belt': {
      var be = entities[n.cfg.ent];
      if (!be || !be.cells) { n.out[0] = 0; break; }
      var acc = {};
      for (var c = 0; c < be.cells.length; c++) beltContents(be.cells[c], acc);
      n.out[0] = n.cfg.item ? (acc[n.cfg.item] || 0) : invTotal(acc);
      break;
    }
    case 'invsense': n.out[0] = n.cfg.item ? (inventory[n.cfg.item] || 0) : 0; break;
    case 'research': {
      n.out[0] = currentResearch ? Math.round(researchFrac() * 100) : 0;
      n.out[1] = currentResearch ? 1 : 0;
      break;
    }
    case 'enemy': {
      var R = Math.max(1, +n.cfg.radius || 30);
      var cx = ctrl ? ctrl.tx + 1 : world.spawnX, cy = ctrl ? ctrl.ty + 1 : world.spawnY;
      var cnt = 0, near = R + 1;
      for (var i = 0; i < enemies.length; i++) {
        var dd = dist(enemies[i].x, enemies[i].y, cx, cy);
        if (dd <= R) { cnt++; if (dd < near) near = dd; }
      }
      n.out[0] = cnt;
      // 적이 없을 때 0(=가장 가까움)을 내면 "거리 < 10 이면 방어" 같은 배선이
      // 평상시에 항상 참이 된다. 감지 반경 밖을 뜻하는 값을 낸다.
      n.out[1] = cnt ? Math.round(near * 10) / 10 : R;
      break;
    }

    case 'cmp': {
      var A = readIn(g, n, 0), B = readIn(g, n, 1), r = 0;
      switch (n.cfg.op) {
        case '>': r = A > B; break;
        case '>=': r = A >= B; break;
        case '<': r = A < B; break;
        case '<=': r = A <= B; break;
        case '==': r = A === B; break;
        case '!=': r = A !== B; break;
      }
      n.out[0] = r ? 1 : 0;
      break;
    }
    case 'math': {
      var a1 = readIn(g, n, 0), b1 = readIn(g, n, 1), v = 0;
      switch (n.cfg.op) {
        case '+': v = a1 + b1; break;
        case '-': v = a1 - b1; break;
        case '*': v = a1 * b1; break;
        case '/': v = b1 === 0 ? 0 : a1 / b1; break;      // 0 나눗셈은 0 — NaN 전파 금지
        case '%': v = b1 === 0 ? 0 : a1 % b1; break;
        case 'min': v = Math.min(a1, b1); break;
        case 'max': v = Math.max(a1, b1); break;
      }
      n.out[0] = isFinite(v) ? v : 0;
      break;
    }
    case 'bool': {
      var ba = truthy(readIn(g, n, 0)), bb = truthy(readIn(g, n, 1)), rb = false;
      switch (n.cfg.op) {
        case 'AND': rb = ba && bb; break;
        case 'OR': rb = ba || bb; break;
        case 'XOR': rb = ba !== bb; break;
        case 'NOT A': rb = !ba; break;
      }
      n.out[0] = rb ? 1 : 0;
      break;
    }
    case 'clamp': n.out[0] = clamp(readIn(g, n, 0), +n.cfg.lo || 0, +n.cfg.hi || 0); break;
    case 'select': n.out[0] = truthy(readIn(g, n, 0)) ? readIn(g, n, 1) : readIn(g, n, 2); break;

    case 'latch': {
      var S = truthy(readIn(g, n, 0)), R2 = truthy(readIn(g, n, 1));
      if (R2) n.state.q = 0; else if (S) n.state.q = 1;
      n.out[0] = n.state.q ? 1 : 0;
      break;
    }
    case 'counter': {
      var inc = truthy(readIn(g, n, 0)), rst = truthy(readIn(g, n, 1));
      if (n.state.prevInc === undefined) n.state.prevInc = false;
      if (rst) n.state.c = 0;
      else if (inc && !n.state.prevInc) n.state.c = (n.state.c || 0) + 1;
      n.state.prevInc = inc;
      var mx = +n.cfg.max || 0;
      if (mx > 0 && n.state.c > mx) n.state.c = 0;
      n.out[0] = n.state.c || 0;
      break;
    }
    case 'edge': {
      var cur = truthy(readIn(g, n, 0));
      var pv = !!n.state.prev;
      var fire2 = 0;
      if (n.cfg.mode === '상승') fire2 = (cur && !pv) ? 1 : 0;
      else if (n.cfg.mode === '하강') fire2 = (!cur && pv) ? 1 : 0;
      else fire2 = (cur !== pv) ? 1 : 0;
      n.state.prev = cur;
      n.out[0] = fire2;
      break;
    }
    case 'hold': {
      if (truthy(readIn(g, n, 1))) n.state.v = readIn(g, n, 0);
      n.out[0] = n.state.v || 0;
      break;
    }
    case 'peak': {
      // 리셋이 먼저다 — 리셋과 값이 같은 틱에 들어오면 '지우고 다시 시작' 이라야
      // 사람이 짐작한 대로다(래치의 RESET 우선과 같은 규약).
      if (truthy(readIn(g, n, 1))) { delete n.state.rec; n.out[0] = 0; break; }
      if (!inputFed(g, n, 0)) { delete n.state.rec; n.out[0] = 0; break; }
      var pv = readIn(g, n, 0);
      var pLow = (n.cfg.mode !== '최고');
      if (typeof n.state.rec !== 'number' || !isFinite(n.state.rec)) n.state.rec = pv;
      else if (pLow ? (pv < n.state.rec) : (pv > n.state.rec)) n.state.rec = pv;
      n.out[0] = n.state.rec;
      break;
    }
    case 'sustain': {
      // 상태 이름을 t 가 아니라 held 로 둔다 — 타이머도 n.state.t 를 쓰는데, 같은
      // 이름이면 사람도 시험도 둘을 헷갈린다(돌연변이 앵커가 실제로 겹쳤다).
      if (!inputFed(g, n, 0)) { n.state.held = 0; n.out[0] = 0; break; }
      if (!truthy(readIn(g, n, 0))) { n.state.held = 0; n.out[0] = 0; break; }
      n.state.held = (n.state.held || 0) + dt;
      n.out[0] = (n.state.held >= (+n.cfg.sec || 0)) ? 1 : 0;
      break;
    }
    case 'rate': {
      // 평활 필터와 같은 규약: 안 물렸으면 상태를 지우고 0 을 낸다. 안 그러면
      // 배선을 끊었다 다시 이을 때 그 사이의 '변화' 가 한꺼번에 튀어나온다.
      if (!inputFed(g, n, 0)) { delete n.state.px; delete n.state.r; n.out[0] = 0; break; }
      var xr = readIn(g, n, 0);
      // 첫 평가에는 기울기를 낼 수 없다 — 이전 값이 없으면 변화도 없다. 0 을 낸다.
      if (typeof n.state.px !== 'number' || !isFinite(n.state.px)) {
        n.state.px = xr; n.state.r = 0; n.out[0] = 0; break;
      }
      var raw = dt > 0 ? (xr - n.state.px) / dt : 0;
      n.state.px = xr;
      var win = +n.cfg.win || 0;
      if (typeof n.state.r !== 'number' || !isFinite(n.state.r)) n.state.r = raw;
      if (win <= 0) n.state.r = raw;
      else n.state.r += (raw - n.state.r) * (1 - Math.exp(-dt / win));
      n.out[0] = n.state.r;
      break;
    }
    case 'smooth': {
      // **입력이 안 물렸으면 씨앗을 심지 않는다.** 사람이 쓰는 순서는 언제나
      // '놓고 나서 잇기'인데, 놓자마자 도는 틱에서 readIn 이 0 을 주므로 여기서
      // 씨앗을 박으면 y=0 으로 굳는다. 그러면 배선한 순간 아래 주석이 막겠다던
      // 과도(0 → 현재값)가 정확히 생긴다 — 씨앗이 자기 목적을 배반한다.
      // 다른 출력 노드의 '안 물린 입력은 지배하지 않는다' 와 같은 규약이다.
      if (!inputFed(g, n, 0)) { delete n.state.y; n.out[0] = 0; break; }
      var xs = readIn(g, n, 0);
      var tau = +n.cfg.tau || 0;
      // 첫 평가는 입력값에서 출발한다. 0 에서 시작하면 이미 돌던 신호에 필터를
      // 물리는 순간 없던 과도(0 → 현재값)가 생겨 그것 때문에 라인이 흔들린다.
      if (typeof n.state.y !== 'number' || !isFinite(n.state.y)) n.state.y = xs;
      if (tau <= 0) n.state.y = xs;                    // τ=0 은 그냥 통과 (음성 대조군)
      else {
        // **정확한 지수해다.** y += (x-y)(1-e^(-dt/τ)). 오일러 근사 (x-y)·dt/τ 로
        // 쓰면 dt 를 어떻게 쪼개느냐에 따라 값이 달라진다 — 1초를 4틱으로 밀 때와
        // 60틱으로 밀 때가 어긋난다. 지수해는 어느 쪽이든 같은 값이고, 그 성질이
        // 곧 "dt 를 곱했는가"를 묻는 게이트가 된다 (교훈 03).
        n.state.y += (xs - n.state.y) * (1 - Math.exp(-dt / tau));
      }
      n.out[0] = n.state.y;
      break;
    }
    case 'fsm': {
      var fsmN = fsmStages(n);
      if (!(n.state.s >= 1 && n.state.s <= fsmN)) n.state.s = 1;
      if (!n.state.pe || n.state.pe.length !== 9) {
        n.state.pe = [false, false, false, false, false, false, false, false, false];
      }
      var rstF = truthy(readIn(g, n, 4));
      // 엣지 기억은 **전이 입력 전부** 매 틱 갱신한다. 현재 단계의 입력만 보면,
      // 다른 단계에 있는 동안 참이 된 조건이 그 단계로 돌아온 순간 '방금 올라간
      // 것'으로 읽혀 한 칸 더 튄다.
      var fired = false, curPort = FSM_PORT[n.state.s];
      for (var t4 = 0; t4 < 9; t4++) {
        if (t4 === 4) continue;                         // 4번은 리셋이라 전이가 아니다
        var cur4 = truthy(readIn(g, n, t4));
        if (t4 === curPort && cur4 && !n.state.pe[t4]) fired = true;
        n.state.pe[t4] = cur4;
      }
      if (rstF) n.state.s = 1;                            // 리셋 우선
      else if (fired) n.state.s = (n.state.s % fsmN) + 1; // 한 틱에 한 번만 전이
      n.out[0] = n.state.s;
      for (var q4 = 1; q4 <= 8; q4++) n.out[q4] = (n.state.s === q4) ? 1 : 0;
      break;
    }
    case 'busrecv': n.out[0] = busRead(n.cfg.ch); break;

    case 'station': {
      var se = entities[n.cfg.ent];
      var str = (se && se.type === 'station') ? trainAtStation(se) : null;
      n.out[0] = str ? 1 : 0;
      n.out[1] = str ? trainCargo(str) : 0;
      n.out[2] = str ? (trainCargo(str) / SPEC.trainCargoCap) * 100 : 0;
      break;
    }

    case 'fluid': {
      var fe = entities[n.cfg.ent];
      var fi = fe ? fluidOf(fe) : null;
      if (!fi) { for (var fz = 0; fz < n.out.length; fz++) n.out[fz] = 0; break; }
      n.out[0] = fi.steamPct;
      n.out[1] = fi.steam;
      n.out[2] = fi.water;
      n.out[3] = fi.connected;
      var okey = OIL_KEY[n.cfg.oil] || 'heavy';
      var oamt = fi[okey] || 0;
      n.out[4] = fi.cap > 0 ? (oamt / fi.cap) * 100 : 0;
      n.out[5] = oamt;
      break;
    }

    case 'pid': {
      var sp = readIn(g, n, 0), pv2 = readIn(g, n, 1);
      var err = sp - pv2;
      var kp = +n.cfg.kp || 0, ki = +n.cfg.ki || 0, kd = +n.cfg.kd || 0;
      var lim = Math.abs(+n.cfg.lim || 100);
      if (n.state.i === undefined) n.state.i = 0;
      if (n.state.pe === undefined) n.state.pe = err;
      // 적분 와인드업 방지 — 적분항 자체를 제한 안에 가둔다
      if (ki !== 0) n.state.i = clamp(n.state.i + err * dt, -lim / Math.abs(ki), lim / Math.abs(ki));
      var der = dt > 0 ? (err - n.state.pe) / dt : 0;
      n.state.pe = err;
      var u = kp * err + ki * n.state.i + kd * der;
      n.out[0] = clamp(isFinite(u) ? u : 0, -lim, lim);
      n.out[1] = Math.round(err * 100) / 100;
      break;
    }

    case 'enable': {
      // **입력이 안 물렸으면 지배하지 않는다.** readIn 이 0 을 돌려주므로 예전에는
      // 노드를 놓고 대상만 고른 순간 기계가 즉시 멈췄다 — 배선을 하나도 안 했는데
      // 말이다. 아직 아무 말도 하지 않는 노드가 세계를 붙잡으면 안 된다.
      if (!inputFed(g, n, 0)) break;
      var te = entities[n.cfg.ent];
      // 자기 자신은 끌 수 없다 — 끄는 순간 평가가 멈추고 지배가 풀려 다시 켜지는 발진이 된다.
      if (te && ctrl && te.id === ctrl.id) break;
      if (te) {
        noteAxisWriter(te, '가동', ctrl);
        te.enabled = truthy(readIn(g, n, 0)); te.logicForced = true; te.fEnable = true;
      }
      break;
    }
    case 'gate': {
      if (!inputFed(g, n, 0)) break;
      var ge = entities[n.cfg.ent];
      if (ge && ge.cells) {
        var open = truthy(readIn(g, n, 0));
        noteAxisWriter(ge, '게이트', ctrl);
        for (var gc = 0; gc < ge.cells.length; gc++) ge.cells[gc].gate = open;
        ge.logicForced = true; ge.fGate = true;
      }
      break;
    }
    case 'filter': {
      if (!inputFed(g, n, 0)) break;
      var fe = entities[n.cfg.ent];
      if (fe && fe.type === 'inserter') {
        noteAxisWriter(fe, '필터', ctrl);
        fe.filter = truthy(readIn(g, n, 0)) ? (n.cfg.b || null) : (n.cfg.a || null);
        fe.logicForced = true; fe.fFilter = true;
      }
      break;
    }
    case 'fire': {
      if (!inputFed(g, n, 0)) break;
      var tu = entities[n.cfg.ent];
      if (tu && tu.type === 'turret') {
        noteAxisWriter(tu, '사격허가', ctrl);
        tu.fireOk = truthy(readIn(g, n, 0)); tu.logicForced = true; tu.fFire = true;
      }
      break;
    }
    case 'lamp': {
      // HUD 는 이름으로 중복을 지운다 — 기본 이름이 같으면 두 번째부터 화면에서
      // 사라진다. 이름을 안 적었으면 노드 번호로 구분한다.
      if (truthy(readIn(g, n, 0))) alarms.push(String(n.cfg.label || ('경보 #' + n.nid)));
      break;
    }
    case 'display': {
      displays.push({ label: String(n.cfg.label || ('값 #' + n.nid)), value: readIn(g, n, 0) });
      break;
    }
    case 'traingo': {
      if (!inputFed(g, n, 0)) break;         // 안 물리면 지배하지 않는다
      var ts2 = entities[n.cfg.ent];
      if (ts2 && ts2.type === 'station') {
        noteAxisWriter(ts2, '열차출발', ctrl);
        ts2.trainCtl = true;
        ts2.holdTrain = !truthy(readIn(g, n, 0));
        ts2.logicForced = true;
      }
      break;
    }
    case 'bussend': {
      // 다른 출력 노드와 같은 형태를 유지한다. **다만 여기서는 값이 안 바뀐다** —
      // 합산 규약이라 0 을 한 몫 더해도 합계가 그대로다. 그래서 이 가드는 게이트로
      // 검정할 수 없고(등가 변형), 그 사실을 알고 남겨 둔다: 채널에 '누가 쓰고
      // 있는가' 를 나중에 드러내게 되면 그때 관측 가능해진다.
      if (!inputFed(g, n, 0)) break;
      busWrite(n.cfg.ch, readIn(g, n, 0));
      break;
    }
  }
}

// 제어기 하나 평가
// 같은 틱에 같은 축을 두 제어기가 쓰면 나중에 평가된 쪽이 이긴다. 그 자체는
// 결정적이지만 플레이어에게는 설명 불가능한 현상이라(한쪽 회로가 통째로 무시된
// 것처럼 보인다) 사실을 기록해 인스펙터에 드러낸다.
function noteAxisWriter(target, axis, ctrl) {
  if (!target || !ctrl) return;
  var prev = target.axisBy && target.axisBy[axis];
  if (prev && prev !== ctrl.id) {
    target.logicConflict = axis + ': 제어기 #' + prev + ' 와 #' + ctrl.id +
                           ' 가 동시에 지배 — 나중에 평가된 #' + ctrl.id + ' 가 이긴다';
  }
  if (!target.axisBy) target.axisBy = {};
  target.axisBy[axis] = ctrl.id;
}

// --- 값 추이 기록 (스코프) ---------------------------------------------------
// **1틱 펄스는 표본으로 못 잡는다.** 그래서 지금까지 fires 로 '몇 번 올랐나' 만
// 세어 왔는데, 횟수는 회로가 **언제 어떤 모양으로** 굴었는지는 말하지 않는다.
// 부하 차단이 발진하는지, 래치가 언제 풀렸는지는 파형을 봐야 안다.
// 여기서 **매 틱** 담으므로 폭 16.7ms 짜리 펄스도 남는다.
//
// 규율 셋:
//  * 편집기가 열어 둔 제어기 **하나만** 담는다. 전부 담으면 큰 판에서 메모리가
//    제어기 수에 비례해 늘고, 아무도 안 보는 파형을 위해 그럴 이유가 없다.
//  * **저장에 안 들어간다.** 파형은 화물이 아니라 계기다. 그래서 노드에 붙이지
//    않고 여기 모듈 변수에 둔다 — 붙이면 저장·청사진·되돌리기에 따라다닌다.
//  * **시뮬은 이 버퍼를 절대 읽지 않는다.** 읽는 순간 계기가 회로를 바꾼다.
var SCOPE_LEN = 480;             // 8초 (60 Hz)
var scopeCtrl = -1;              // 담고 있는 제어기 id (-1 이면 안 담는다)
var scopeBuf = null;             // { 'nid:port': Float64Array } 링버퍼
var scopeHead = 0;               // 다음에 쓸 자리
var scopeFilled = 0;             // 지금까지 담긴 표본 수 (SCOPE_LEN 에서 멈춘다)

// **같은 번호라고 같은 제어기가 아니다.** 처음엔 id 가 그대로면 버퍼를 두고
// 일찍 돌아왔는데, 새 판·불러오기 뒤에는 엔티티 번호가 다시 1부터 붙는다 —
// 지워진 제어기의 파형이 새 제어기 상자에 그대로 떠 있었다(게이트가 잡았다).
// 부를 때마다 비운다. 여는 동작은 드물고, 틀린 파형은 디버깅을 거꾸로 만든다.
function scopeWatch(ctrlId) {
  var id = (ctrlId === undefined || ctrlId === null) ? -1 : ctrlId;
  scopeCtrl = id;
  scopeBuf = (id < 0) ? null : {};
  scopeHead = 0; scopeFilled = 0;
  return scopeCtrl;
}
function scopeWatching() { return scopeCtrl; }

function scopeRecord(g) {
  if (!scopeBuf) return;
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    for (var p = 0; p < n.out.length; p++) {
      var key = n.nid + ':' + p;
      var arr = scopeBuf[key];
      if (!arr) { arr = new Float64Array(SCOPE_LEN); scopeBuf[key] = arr; }
      arr[scopeHead] = n.out[p];
    }
  }
  scopeHead = (scopeHead + 1) % SCOPE_LEN;
  if (scopeFilled < SCOPE_LEN) scopeFilled++;
}

// 오래된 것부터 최신 순으로 펴서 돌려준다. **화면과 시험만 부른다.**
function scopeSeries(nid, port) {
  if (!scopeBuf) return [];
  var arr = scopeBuf[nid + ':' + (port || 0)];
  if (!arr) return [];
  var out = [], start = (scopeFilled < SCOPE_LEN) ? 0 : scopeHead;
  for (var i = 0; i < scopeFilled; i++) out.push(arr[(start + i) % SCOPE_LEN]);
  return out;
}

// --- 계기 줄 파형 ------------------------------------------------------------
// 노드 파형은 편집기를 열어야 보인다. 그런데 실제로 오래 지켜봐야 하는 값(증기%,
// 전력 만족도)은 **편집기를 닫아 놓고 공장을 짓는 동안** 흘러간다 — 숫자만 봐서는
// 47% 가 내려가는 중인지 올라오는 중인지 알 수 없고, 그 둘은 정반대 상황이다.
//
// 노드 파형과 달리 **늘 담는다**: 계기는 플레이어가 스스로 화면에 띄워 둔 값이고
// 라벨로 묶여 많아야 여덟 개다. 저장에는 안 들어간다 — 계기지 화물이 아니다.
var DISP_LEN = 240;              // 4초 (60 Hz)
var dispSpark = {};              // 라벨 -> { a, head, filled }

function dispRecord() {
  var seen = {};
  for (var i = 0; i < displays.length; i++) {
    var it = displays[i];
    if (seen[it.label]) continue;          // 화면과 같은 규칙 — 같은 라벨은 첫 것만
    seen[it.label] = 1;
    var r = dispSpark[it.label];
    if (!r) r = dispSpark[it.label] = { a: new Float64Array(DISP_LEN), head: 0, filled: 0 };
    r.a[r.head] = it.value;
    r.head = (r.head + 1) % DISP_LEN;
    if (r.filled < DISP_LEN) r.filled++;
  }
  // 사라진 계기의 기록은 버린다 — 안 버리면 라벨을 고칠 때마다 유령이 쌓인다.
  for (var k in dispSpark) if (!seen[k]) delete dispSpark[k];
}

function dispSeries(label) {
  var r = dispSpark[label];
  if (!r) return [];
  var out = [], start = (r.filled < DISP_LEN) ? 0 : r.head;
  for (var i = 0; i < r.filled; i++) out.push(r.a[(start + i) % DISP_LEN]);
  return out;
}
function dispClear() { dispSpark = {}; }

function stepController(e, dt) {
  var g = e.graph;
  if (!g) return;
  // 전력은 보지 않는다 — 제어기는 전기를 쓰지 않는다(05_data.js 의 주석 참고).
  if (!e.enabled) { e.lastEval = null; return; }
  if (g.dirty || !g.order) graphCompile(g);
  // 직전 값 저장 — 피드백 간선이 읽는다
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    for (var p = 0; p < n.out.length; p++) n.prev[p] = n.out[p];
  }
  for (var k = 0; k < g.order.length; k++) {
    var node = g.byId[g.order[k]];
    if (node) evalNode(g, node, dt, e);
  }
  // 1틱 펄스는 표본으로 못 잡는다(폭 16.7ms vs 편집기 표본 140ms). 값 대신
  // **상승 횟수**를 세어 두면 표본을 놓쳐도 증거가 남는다. 편집기는 이 숫자가
  // 늘었는지로 LED 를 켠다 — 그래야 타이머가 도는 것이 화면에 보인다.
  for (var f = 0; f < g.nodes.length; f++) {
    var fn = g.nodes[f];
    if (!fn.fires) { fn.fires = []; for (var z = 0; z < fn.out.length; z++) fn.fires.push(0); }
    for (var fp = 0; fp < fn.out.length; fp++) {
      if (fn.out[fp] >= TRUE_EPS && fn.prev[fp] < TRUE_EPS) fn.fires[fp]++;
    }
  }
  // 파형은 fires 를 센 **뒤에** 담는다 — 이번 틱의 확정된 출력이라야 한다.
  if (e.id === scopeCtrl) scopeRecord(g);
  e.lastEval = { nodes: g.nodes.length, links: g.links.length, cycles: g.cycles || 0 };
}

// 매 틱: logicForced 를 먼저 지우고 모든 제어기를 돌린다.
// 지우지 않으면 제어 노드를 삭제해도 기계가 영원히 꺼진 채로 남는다 (유령 지배).
function stepLogic(dt) {
  alarms.length = 0;
  displays.length = 0;
  forEachEntity(function (e) {
    e.logicForced = false; e.fEnable = false; e.fGate = false; e.fFilter = false; e.fFire = false;
    // 역의 출발 지배도 매 틱 푼다. 안 풀면 노드를 지운 뒤에도 열차가 영원히 붙잡힌다.
    e.trainCtl = false; e.holdTrain = false;
    // 이번 틱에 이 축을 쓴 제어기가 누구인지 기억한다. 둘이 겹치면 나중에 평가된
    // 쪽이 조용히 이겨서, 한쪽 회로가 통째로 무시당하는 것처럼 보인다.
    e.axisBy = null; e.logicConflict = null;
  });
  forEachEntity(function (e) {
    if (e.type === 'controller') guard('controller#' + e.id, function () { stepController(e, dt); });
  });
  // 지배가 풀린 대상은 플레이어의 의사로 되돌린다.
  // 되돌리지 않으면 제어 노드를 지운 뒤에도 기계가 영원히 꺼진 채 남는다(유령 지배).
  // 축(가동/게이트/필터/사격)마다 따로 본다 — 게이트만 지배당한 벨트의 enabled 까지
  // 묶어서 판정하면 엉뚱한 축이 고정된다.
  forEachEntity(function (e) {
    if (!e.fEnable) e.enabled = (e.playerEnabled !== false);
    if (e.cells && !e.fGate) { for (var c = 0; c < e.cells.length; c++) e.cells[c].gate = true; }
    if (e.type === 'inserter' && !e.fFilter) e.filter = e.playerFilter || null;
    if (e.type === 'turret' && !e.fFire) e.fireOk = true;
  });
  // 이번 틱에 쌓인 송신 합계를 다음 틱의 읽기값으로 넘긴다. 모든 제어기가 끝난
  // 뒤에 한 번만 — 중간에 바꾸면 먼저 평가된 제어기와 나중 제어기가 서로 다른
  // 값을 보게 되어 순서 의존이 되살아난다.
  busSwap();
  // 계기 파형은 **모든 제어기가 돈 뒤**에 담는다 — displays 가 그때 완성된다.
  dispRecord();
  logicDirty = false;
}
