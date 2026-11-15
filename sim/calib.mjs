// node calib.mjs <직업 코드>... — 자동 생성 직업의 딜 환산값(dmgScale)을 정한다.
// 허수아비에 스킬을 쉬지 않고 돌렸을 때(쿨마다 궁극기·스킬, 충전이 있으면 특수 공격, 나머지는 평타) 초당 딜이 기준치가 되게 맞춘다.
import fs from 'node:fs';
import { Sim } from './engine.js';
import { Combat } from './combat.js';
const BENCH = 3450000, T = 180, base = JSON.parse(fs.readFileSync(new URL('./data/boss2-hard.json', import.meta.url)));
for (const code of process.argv.slice(2)) {
  const f = new URL(`./data/class-${code}.json`, import.meta.url), cls = JSON.parse(fs.readFileSync(f)); cls.dmgScale = 1;
  const s = new Sim({ ...base, events: [], duration: 0 }, new Combat(cls)), c = s.combat;
  for (let i = 0; i < T * 60; i++) {
    // 얼음 자원 직업은 버스트 버프를 먼저 켜고, 프로스트 스피어는 미스틱 아이스가 있을 때만 쏜다
    const skill = (cls.ice ? ['im1', 'im2', 'ult', 's4', 's2', 's3', 's1', 'sp'] : ['ult', 's1', 's2', 's3', 's4', 'sp']).find(id => cls.skills[id] && c.ready(id) && (id !== 'sp' || !cls.ice || c.mystic > 0)) ?? null;
    s.step(1 / 60, { mx: 0, mz: 0, atk: true, skill });
  }
  const own = cls.auto ? null : cls.benchmark, bench = own?.dps ?? BENCH, pct = c.dmg / T; cls.dmgScale = Math.round(bench / pct);
  cls.benchmark = { dps: bench, idealPctPerSec: +pct.toFixed(1), src: own?.src ?? '디바인 아처 기준치(중섭 S3 매활 허수아비 3.45M)를 그대로 빌려 쓴 상대값. 이 직업의 실제 딜과는 무관하다' };
  fs.writeFileSync(f, JSON.stringify(cls, null, 1));
  console.log(code, cls.name, '초당 공격력 대비 %', pct.toFixed(1), Object.fromEntries(Object.entries(c.by).map(([k, v]) => [k, Math.round(v / c.dmg * 100) + '%'])));
}
