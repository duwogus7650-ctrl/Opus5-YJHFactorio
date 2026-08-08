# -*- coding: utf-8 -*-
"""플레이 결과 JSON 을 사람이 읽을 수 있게 찍는다."""
import io, json, sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

raw = sys.stdin.read()
if '@@JSON_START@@' not in raw:
    print('결과 마커를 못 찾았다. 앞 600자:')
    print(raw[:600])
    sys.exit(1)
j = json.loads(raw.split('@@JSON_START@@')[1].split('@@JSON_END@@')[0])

if j.get('fatal'):
    print('FATAL:', j['fatal'][:800])

for c in j.get('checks', []):
    tag = 'GOOD' if c.get('expectFail') and not c['ok'] else ('PASS' if c['ok'] else 'FAIL')
    print('  [%-4s] %-30s %s' % (tag, c['name'], c['detail'][:110]))

fails = j.get('fails', [])
print()
print('배치 실패 %d건: %s' % (len(fails), ', '.join(fails[:10])))

m = j.get('measured', {})
keys = ['gameMinutes', 'entities', 'mined', 'pollution', 'evolution', 'waves',
        'spawned', 'killed', 'buildingsLost', 'enemiesPeak', 'worstPowerSat',
        'turretsWithAmmo', 'placeFails']
print('측정:')
for k in keys:
    if k in m:
        print('   %-16s %s' % (k, m[k]))
prod = (m.get('prod') or {}).get('byRecipe')
print('   %-16s %s' % ('생산누적', prod))
pw = m.get('power')
if pw:
    print('   %-16s 공급 %d / 수요 %d / 만족 %.0f%%' % ('전력', pw['supply'], pw['demand'], pw['sat'] * 100))
res = m.get('research')
if res:
    print('   %-16s 완료 %s · 진행 %s' % ('연구', res.get('done'), res.get('current')))
tl = j.get('timeline', [])
if tl:
    print('진행:')
    for e in tl:
        print('   %5ds  %s' % (e['t'], e['msg']))

snaps = j.get('snaps', [])
if snaps:
    print()
    print('  시각  적 터렛 탄약합 손실 전력 보유탄약 보유철판 엔티티 연구')
    for x in snaps:
        print('  %4d %3d %4d %6d %4d %4d%% %7d %8d %6d  %s'
              % (x['t'], x['en'], x['tur'], x['ammo'], x['lost'], x['sat'],
                 x['inv_ammo'], x.get('iron', -1), x['ents'], x.get('res', '')))
