// node engine.test.mjs — 타임라인 판정 로직 검증
import fs from 'node:fs';
import assert from 'node:assert';
import { Sim, roomOf, roomAngle, inside } from './engine.js';
const data = JSON.parse(fs.readFileSync(new URL('./data/boss1-hard.json', import.meta.url)));
assert.equal(roomOf(10, 10), 1); assert.equal(roomOf(-10, 10), 2); assert.equal(roomOf(-10, -10), 3); assert.equal(roomOf(10, -10), 4);
assert.ok(inside({ shape: 'ring', x: 0, z: 0, rIn: 5, rOut: 10 }, { x: 7, z: 0 }));
assert.ok(!inside({ shape: 'line', a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, w: 2 }, { x: 5, z: 2 }));
assert.ok(inside({ shape: 'sector', x: 0, z: 0, r: 10, dir: 0, half: 0.5 }, { x: 5, z: 2 }) && !inside({ shape: 'sector', x: 0, z: 0, r: 10, dir: 0, half: 0.5 }, { x: 2, z: 5 }));
assert.ok(inside({ shape: 'rect', x: 15, z: 15, w: 30, h: 30 }, { x: 29, z: 1 }) && !inside({ shape: 'rect', x: 15, z: 15, w: 30, h: 30 }, { x: -1, z: 5 }));

// 1) 가만히 서 있으면 실패가 나온다
let s = new Sim(data);
while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
const idle = s.score(); console.log('idle', idle, s.log.filter(r => !r.ok).map(r => r.name));
assert.ok(idle.ok < idle.total);

// 2) 목표 지점을 따라가는 모범 답안은 전부 성공한다
s = new Sim(data);
const goto = (tx, tz) => { const dx = tx - s.player.x, dz = tz - s.player.z; return Math.hypot(dx, dz) < 0.2 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
const pol = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
const a1 = roomAngle(1), a2 = roomAngle(2), B = s.boss;
const away = (c, r) => { const a = Math.atan2(-c.z, -c.x); return [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]; };
while (!s.done) {
  const t = s.t; let g = pol(a1, 10);
  if ((t >= 12 && t < 19) || (t >= 95 && t < 100)) g = pol(a1 - 0.7, 20);   // 내려치기 부채꼴 밖
  else if (t >= 30 && t < 37.1 && s.markers[0]) g = [s.markers[0].x, s.markers[0].z];
  else if (t >= 37.1 && t < 41) g = pol(a1, 12);      // 줄 확정 뒤 삼각형 안쪽으로 비킨다
  else if (t >= 53 && t < 58) g = pol(a1, 18);       // 안전: 가운데
  else if (t >= 58 && t < 64) g = pol(a1, 6);        // 안전: 안쪽
  else if (t >= 64 && t < 71) g = pol(a1, 30);       // 안전: 바깥
  else if (t >= 71 && t < 76) g = pol(a1, 16);       // 쉐어 중앙 원
  else if (t >= 76 && t < 95) g = pol(a1 - 0.75, 30); // 본체·분신에서 모두 20m 이상
  else if (t >= 95 && t < 110) g = pol(a1 - 0.6, 14);
  else if (t >= 110 && t < 150) g = pol(a2, 14);
  else if (t >= 150 && t < 161) g = pol(a2, 12);              // 팀원 삼각 줄 안쪽
  else if (t >= 161 && t < 168.1) g = pol(a2, 16);            // 쉐어 가운데 원
  else if (t >= 168.1 && t < 190) g = pol(a2, 10);
  else if (t >= 190 && t < 203) g = pol(a2 - 0.75, 30);
  else if (t >= 203 && t < 209) g = pol(a2 - 0.7, 20);        // 내려치기 밖
  else if (t >= 209 && t < 221) g = pol(a2, 6);               // 안전: 안쪽
  else if (t >= 221 && t < 227) g = pol(a2, 24);              // 안전: 바깥
  else if (t >= 227 && t < 233) g = pol(a2, 15);              // 안전: 가운데
  else if (t >= 233) g = pol(a2 + 0.45, 16);                  // 탱버 원을 피한 옆 쉐어
  s.step(0.05, goto(...g));
}
console.log('model', s.score()); for (const r of s.log) console.log(' ', r.t, r.ok ? 'O' : 'X', r.name, r.msg);
assert.deepEqual(s.score().ok, s.score().total);

// 2-1) 악몽 첫 방 자료도 끝까지 돈다
s = new Sim(JSON.parse(fs.readFileSync(new URL('./data/boss1-nightmare-room1.json', import.meta.url))));
while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
console.log('nightmare idle', s.score()); assert.ok(s.log.filter(r => r.name.startsWith('도넛')).length === 6 && s.room === 2);

// 3) 악몽 0% 버티기: 가만히 있으면 맞고, 회전을 따라 돌면 피한다
const nm = JSON.parse(fs.readFileSync(new URL('./data/boss1-nightmare-0pct.json', import.meta.url)));
s = new Sim(nm); while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
console.log('spin idle', s.log.map(r => r.msg)); assert.ok(s.log.some(r => !r.ok));
const spinOnly = { ...nm, events: nm.events.filter(e => e.type === 'spin') };
s = new Sim(spinOnly);
while (!s.done) {
  // 빈틈 중심(부채꼴 사이 45°)을 반경 8m에서 따라간다
  let g = [s.player.x, s.player.z];
  if (s.spin) { const sh = s.spinShape(s.t + 0.3).spots[0]; g = pol(sh.dir + Math.PI / 4, 8); }
  const dx = g[0] - s.player.x, dz = g[1] - s.player.z;
  s.step(0.05, Math.hypot(dx, dz) < 0.2 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz });
}
console.log('spin follow', s.log.map(r => r.msg)); assert.ok(s.log.length === 2 && s.log.every(r => r.ok));
// 추적 광선: 고정된 뒤 그대로 서 있으면 내 광선에 맞고, 옆으로 비키면 피한다
const laserOnly = { ...nm, party: undefined, duration: 8, events: [{ t: 0, type: 'lasers', name: '추적 광선', follow: 2, fire: 2.73, width: 2, len: 70, bots: [] }] };
s = new Sim(laserOnly); while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
assert.ok(!s.log[0].ok);
s = new Sim(laserOnly); while (!s.done) { const r = Math.hypot(s.player.x, s.player.z); s.step(0.05, s.t > 2 && s.t < 3 ? { mx: -s.player.z / r, mz: s.player.x / r } : { mx: 0, mz: 0 }); }
console.log('laser', s.log.map(r => r.msg)); assert.ok(s.log[0].ok);
// 2넴 하드: 모범 답안은 전부 성공, 가만히 있으면 실패가 난다
const b2 = JSON.parse(fs.readFileSync(new URL('./data/boss2-hard.json', import.meta.url)));
s = new Sim(b2); while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
console.log('boss2 idle', s.score()); assert.ok(s.score().ok < s.score().total);
s = new Sim(b2);
const plan2 = [[0,[6,3]],[14.2,[2,3]],[15.95,[6,3]],[17.7,[2,3]],[19.45,[6,3]],[24.05,[12,8]],[30,[-4,-19]],[42.05,[-4,-3]],[60,[-2,2]],[76.05,[-10,7]],[84,[26,4]],[92.05,[2,3]],[108,[-14,5]],[120,[0,0]],[196,[-4,19]],[206.05,[-4,3]],[230,[6,3]],[240.2,[2,3]],[241.95,[6,3]],[243.7,[2,3]],[245.45,[6,3]],[249.05,[12,8]],[255,[26,-4]],[263.05,[2,-3]],[279,[-14,-5]],[315,[-20,-19]],[325.05,[-2,-2]]];
while (!s.done) { const g = plan2.filter(([t]) => t <= s.t).pop()[1], dx = g[0] - s.player.x, dz = g[1] - s.player.z; s.step(0.05, Math.hypot(dx, dz) < 0.2 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }); }
console.log('boss2 model', s.score()); for (const r of s.log) if (!r.ok) console.log('  X', r.t, r.name, r.msg);
assert.deepEqual(s.score().ok, s.score().total);
// 3넴 하드: 모범 답안은 전부 성공
const b3 = JSON.parse(fs.readFileSync(new URL('./data/boss3-hard.json', import.meta.url)));
s = new Sim(b3); while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
console.log('boss3 idle', s.score()); assert.ok(s.score().ok < s.score().total);
s = new Sim(b3);
const follow = (plan) => { while (!s.done) { const e = plan.filter(([t]) => t <= s.t).pop(), g = e[1], dx = g[0] - s.player.x, dz = g[1] - s.player.z, inp = Math.hypot(dx, dz) < 0.2 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; if (e[2] && s.t - e[0] < 0.1) inp[e[2] === 'E' ? 'interact' : 'dash'] = true; s.step(0.05, inp); } };   // 세 번째 값 E=상호작용, D=대시
follow([[0,[15,2]],[17,[20,2]],[23.1,[14,0]],[50,[15,-7]],[54.1,[14,0]],[78,[16,-6]],[85.5,[20,12]],[93.5,[20,12],"E"],[99,[14,0]],[128,[26,14]],[140.05,[15,2]],[146,[15,9]],[150.1,[14,0]],[170.05,[24,-19],"D"],[177.1,[14,0]],[216,[26,14]],[229.05,[15,2]],[255,[20,2]],[261.1,[25,0]],[271.6,[15,0]],[275.6,[25,0]],[279.6,[15,0]],[284,[14,0]],[327,[26,14]],[341.05,[15,2]],[371,[20,12]],[379.5,[20,12],"E"],[384,[14,0]],[437.05,[24,-19],"D"],[444.1,[14,0]]]);
console.log('boss3 model', s.score()); for (const r of s.log) if (!r.ok) console.log('  X', r.t, r.name, r.msg);
assert.deepEqual(s.score().ok, s.score().total);
// 2넴·3넴 악몽 자료도 끝까지 돈다(가만히 있으면 실패가 섞인다)
// 2넴 악몽: 모범 답안은 전부 성공
{ const d = JSON.parse(fs.readFileSync(new URL('./data/boss2-nightmare.json', import.meta.url))), plan = [[0,[6,3]],[19.2,[2,3]],[20.95,[6,3]],[22.7,[2,3]],[24.45,[6,3]],[28.05,[-4,-19]],[39.05,[-4,-3]],[55,[-2,2]],[70,[2,3]],[86,[26,4]],[94.05,[2,3]],[107,[-14,5]],[120,[0,0]],[188,[9,6]],[200,[-4,19]],[208.05,[-4,3]],[228,[6,3]],[236.2,[2,3]],[237.95,[6,3]],[239.7,[2,3]],[241.45,[6,3]],[248,[26,-4]],[256.05,[2,-3]],[271,[-16,3]],[286,[-20,-19]],[296.05,[-2,-2]],[312,[0,0]],[356.1,[0,9]],[363.1,[0,0]]];
  s = new Sim(d); while (!s.done) { const g = plan.filter(([t]) => t <= s.t).pop()[1], dx = g[0] - s.player.x, dz = g[1] - s.player.z; s.step(0.05, Math.hypot(dx, dz) < 0.2 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }); }
  console.log('boss2 nightmare model', s.score()); for (const r of s.log) if (!r.ok) console.log('  X', r.t, r.name, r.msg); assert.deepEqual(s.score().ok, s.score().total); }
// 3넴 악몽: 모범 답안은 전부 성공
s = new Sim(JSON.parse(fs.readFileSync(new URL('./data/boss3-nightmare.json', import.meta.url)))); follow([[0,[15,2]],[17,[20,2]],[23.1,[14,0]],[50,[15,-7]],[54.1,[14,0]],[78,[16,-6]],[86,[20,12]],[94.5,[20,12],"E"],[100,[14,0]],[125,[20,2]],[130.1,[26,-13]],[142.05,[15,2]],[146,[15,9]],[150.1,[14,0]],[173.05,[24,-19],"D"],[180.1,[14,0]],[234,[21,-2]],[241.1,[25,0]],[251.6,[15,0]],[255.6,[25,0]],[259.6,[15,0]],[264,[14,0]],[278.05,[20,-4]],[281,[14,0]],[292,[16,7]],[296,[26,14]],[301.05,[15,2]],[336,[16,-6]],[344,[20,12]],[354.5,[20,12],"E"],[364.05,[27,13]],[373.1,[14,0]],[415.05,[24,-19],"D"],[422.05,[16,6]]]);
console.log('boss3 nightmare model', s.score()); for (const r of s.log) if (!r.ok) console.log('  X', r.t, r.name, r.msg); assert.deepEqual(s.score().ok, s.score().total);
for (const f of ['boss2-nightmare', 'boss3-nightmare']) {
  s = new Sim(JSON.parse(fs.readFileSync(new URL(`./data/${f}.json`, import.meta.url)))); while (!s.done) s.step(0.05, { mx: 0, mz: 0 });
  console.log(f, 'idle', s.score()); assert.ok(s.log.length > 20 && s.score().ok < s.score().total);
}
// 공격 중 이동 묶임: 공격 동작 중에는 이동 입력이 먹지 않고, 대시는 동작을 끊는다
s = new Sim(data); s.attackLock = true; s.step(0.05, { mx: 0, mz: 0 });
const x0 = s.player.x; s.step(0.05, { mx: 1, mz: 0 }); assert.equal(s.player.x, x0); assert.ok(s.player.lock > 0);
s.step(0.05, { mx: 1, mz: 0, dash: true }); assert.ok(s.player.x > x0 + 5 && !(s.player.lock > 0));
console.log('PASS');

// 직업 조작(디바인 아처): 쿨타임·충전·동작 중 이동 불가·회피 무적·라이트 에너지
{
  const { Combat } = await import('./combat.js');
  const cls = JSON.parse(fs.readFileSync(new URL('./data/class-archer.json', import.meta.url)));
  const d2 = JSON.parse(fs.readFileSync(new URL('./data/boss2-hard.json', import.meta.url)));
  const mk = () => new Sim({ ...d2, events: [] }, new Combat(cls));
  const run = (s, sec, inp = {}) => { for (let i = 0; i < Math.round(sec * 60); i++) { s.step(1 / 60, { mx: 0, mz: 0, ...inp }); inp = { ...inp, skill: undefined, dash: false }; } };
  // 라이트 봄버: 모으는 동안 이동 입력이 먹지 않고, 쿨타임이 돈다
  let s = mk(), c = s.combat, x0 = s.player.x;
  run(s, 0.05, { skill: 's3' }); assert.equal(c.act.id, 's3');
  run(s, 1.0, { mx: 0, mz: 1 }); assert.equal(s.player.z, 2); assert.ok(!c.ready('s3'));
  run(s, 1.0, { mx: 0, mz: 1 }); assert.ok(s.player.z > 2 && !c.act, '이동 불가 시간이 지나면 이동으로 동작이 끊긴다');
  run(s, 4); assert.ok(c.dmg > 0 && c.by.s3 > 0);
  run(s, 26); assert.ok(c.ready('s3'));
  // 회피: 동작을 끊고 5m 이동, 무적, 3회 충전
  s = mk(); c = s.combat; run(s, 0.3, { skill: 's3' }); run(s, 0.02, { dash: true, mx: -1, mz: 0 }); assert.equal(c.act.id, 'dodge'); assert.ok(s.player.iframe > 0);
  run(s, 0.6); assert.ok(Math.abs(s.player.x - (x0 - 5)) < 0.2, `회피 거리 ${s.player.x}`); assert.equal(c.ch.dodge.n, 2);
  run(s, 0.02, { dash: true }); run(s, 0.6); run(s, 0.02, { dash: true }); run(s, 0.6); assert.equal(c.ch.dodge.n, 0);
  run(s, 0.02, { dash: true }); assert.ok(c.act?.id !== 'dodge', '충전이 없으면 회피가 나가지 않는다');
  // 더블 애로우: 입력 방향으로 5m 미끄러진다
  s = mk(); c = s.combat; run(s, 0.02, { skill: 'sp', mx: 0, mz: 1 }); run(s, 0.4); assert.ok(Math.abs(s.player.z - 7) < 0.3, `미끄러진 거리 ${s.player.z}`); assert.equal(c.ch.sp.n, 2);
  // 평타로 라이트 에너지를 채우고, 가득 찬 뒤 특수 공격을 쓰면 리캐스트에 들어가 초당 25씩 줄어든다
  s = mk(); c = s.combat; run(s, 3, { atk: true }); assert.ok(c.light >= 10 && c.dmg > 0, `라이트 ${c.light}`);
  c.light = 100; run(s, 0.5); run(s, 0.02, { skill: 'sp' }); assert.ok(c.recast); assert.equal(c.act.s.name, '쿼드러플 애로우');
  run(s, 5); assert.ok(!c.recast && c.light === 0);
  // 사거리 밖이면 빗나간다
  s = mk(); c = s.combat; s.boss = { x: 60, z: 0 }; run(s, 2, { atk: true }); assert.equal(c.dmg, 0); assert.ok(c.whiff > 0);
  console.log('직업 조작 PASS', c.summary(2));
}

// 탱커 직업: 탱버를 내가 받는다
{
  const { Combat } = await import('./combat.js');
  const tk = { tank: true, skills: {} }, run = (f, go) => { const t = new Sim(JSON.parse(fs.readFileSync(new URL(`./data/${f}.json`, import.meta.url))), new Combat(tk)); while (!t.done && t.t < 45) { const g = go(t); const dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); t.step(0.05, l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }); } return t.log; };
  let L = run('boss1-hard', () => null).find(r => r.name.includes('탱버'));
  console.log(L.name.includes('내가 받기') && !L.ok ? 'PASS' : 'FAIL', '탱커가 탱버 자리를 비우면 실패');
  L = run('boss3-nightmare', t => t.t < 40 ? [24, -18] : null).find(r => r.name.includes('거리 감쇠'));
  console.log(L.ok ? 'PASS' : 'FAIL', '탱커가 탱버를 끝으로 가져가면 성공', L.msg ?? '');
}

// 마스터 던전 공용 실행기: 정해 둔 동선대로 걷되, 곧 터질 장판(피하기·역할상 피해야 하는 상흔 공격) 안이면 가까운 안전한 자리로 먼저 피한다
const { Combat: CombatM } = await import('./combat.js');
function runMaster(file, { role = 'dps', plan = [], acts = [], hook = null, variant = null } = {}) {
  const d = JSON.parse(fs.readFileSync(new URL(`./data/${file}.json`, import.meta.url)));
  const t = new Sim(d, new CombatM({ role, tank: role === 'tank', skills: {} })), A = [...acts], R = (d.arena.radius ?? 30) - 2;
  const bad = q => t.tele.some(x => (x.kind === 'avoid' || (x.kind === 'scar' && x.want === 'out')) && !x.follow && (x.showFrom ?? x.start) <= t.t && x.hitAt - t.t <= 2.5 && inside(x, q));
  while (!t.done) {
    let g = plan.filter(([at]) => at <= t.t).pop()?.[1]; const h = hook?.(t); if (h) g = h;
    if (bad(t.player)) { let best = null; for (let k = 0; k < 24; k++) for (const r of [2, 4, 6, 9, 12, 16, 20]) { const q = { x: t.player.x + Math.cos(k * Math.PI / 12) * r, z: t.player.z + Math.sin(k * Math.PI / 12) * r }; if (Math.hypot(q.x, q.z) < R && !bad(q) && (!best || r < best.r)) best = { ...q, r }; } if (best) g = [best.x, best.z]; }
    else if (g && bad({ x: g[0], z: g[1] })) g = null;
    const dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz), interact = A.length && t.t >= A[0] ? (A.shift(), true) : false;
    t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact });
  }
  return t;
}
const report = (name, t, extra = true) => console.log(t.log.every(r => r.ok) && extra ? 'PASS' : 'FAIL', name, t.log.length, t.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
const idleFails = (name, file, n) => { const t = runMaster(file, { plan: [[0, null]], hook: () => null }); const t2 = new Sim(JSON.parse(fs.readFileSync(new URL(`./data/${file}.json`, import.meta.url))), new CombatM({ role: 'dps', skills: {} })); while (!t2.done) t2.step(0.05, { mx: 0, mz: 0 }); console.log(t2.log.filter(r => !r.ok).length >= n ? 'PASS' : 'FAIL', `${name}: 가만히 있으면 실패`, t2.log.filter(r => r.ok).length, '/', t2.log.length); };

// 티나(시즌3 16단+, 영상 순서): 저주 → 위압 → 쉐어 → 창날 난무 → 거대화 → 침공 → 저주 2회차 → 분신 해일 → 창날 난무 2회차 → 번호 순 강타
{
  idleFails('티나', 'tina-master', 8);
  const P = a => [Math.cos(a * Math.PI / 180) * 10, Math.sin(a * Math.PI / 180) * 10];
  const pizza = t0 => [[t0 - 10, P(157.5)], [t0 + 3.45, P(202.5)], [t0 + 5.55, P(247.5)], [t0 + 7.65, P(292.5)]];
  const t = runMaster('tina-master', { plan: [[0, [0, 18]], [6.1, [13, -20]], [16.1, [-17, 1]], [30, [0, 8]], ...pizza(62), [72, [19, 0]], [93.1, [0, 19]], [105.1, [12, -14]], [122, [18, 0]], [138.1, [-14, 12]], [150, [0, 18]], [166.1, [13, -20]], [176.1, [0, 18]], [200.1, [19, 0]], ...pizza(224), [234, [14, 14]], [252.25, [11.5, 23]]], acts: [6, 93, 105, 138, 166, 200] });
  report('티나: 모범 동선', t);
}

// 티나 단계별 수식어: 18단 폭탄은 본대에서 빠져야 하고, 19단 연결은 이어진 파티원에게 다가가야 풀린다
{
  const { applyVariant } = await import('./engine.js');
  const load = m => applyVariant(JSON.parse(fs.readFileSync(new URL('./data/tina-master.json', import.meta.url))), m);
  let t = new Sim(load('18')); while (t.t < 20) t.step(0.05, t.player.z > 7 ? { mx: 0.5, mz: -0.87 } : { mx: 0, mz: 0 });   // 탱커 파티원 곁에 붙어 있으면 실패
  const a = t.log.find(r => r.name.includes('서프라이즈'));
  t = new Sim(load('18')); while (t.t < 20) t.step(0.05, t.t > 10 ? { mx: 0, mz: 1 } : { mx: 0, mz: 0 });
  const b = t.log.find(r => r.name.includes('서프라이즈'));
  console.log(a && !a.ok && b && b.ok ? 'PASS' : 'FAIL', '티나 18단 폭탄', a?.msg, '/', b?.msg);
  t = new Sim(load('19')); while (t.t < 46) t.step(0.05, { mx: 0, mz: 0 });
  const c = t.log.find(r => r.name === '약화 연결');
  t = new Sim(load('19')); while (t.t < 46) { const k = t.links[0], g = k && t.bots[k.bot], dx = g ? g.x - t.player.x : 0, dz = g ? g.z - t.player.z : 0, l = Math.hypot(dx, dz) || 1; t.step(0.05, g ? { mx: dx / l, mz: dz / l } : { mx: 0, mz: 0 }); }
  const e = t.log.find(r => r.name === '약화 연결');
  console.log(c && e && e.ok ? 'PASS' : 'FAIL', '티나 19단 연결', c?.msg, '/', e?.msg);
  console.log(load('20').title.includes('20단') && load('20').events.length === load('0').events.length + 2 ? 'PASS' : 'FAIL', '티나 20단 변형 적용');
}

// 안개 송곳니: 딜러는 압축 돌풍을 밟아 상흔을 만들어야 급습에서 산다
{
  idleFails('안개 송곳니', 'misthunt-master', 5);
  const T = JSON.parse(fs.readFileSync(new URL('./data/misthunt-master.json', import.meta.url))).events[0].pos;
  const shatter = t => { const sh = t.t > 160 && t.tele.find(x => x.name.includes('파쇄')); if (!sh) return null; const q = sh.spots[0]; return [q.a.x + (q.b.x - q.a.x) * 0.4, q.a.z + (q.b.z - q.a.z) * 0.4]; };
  const t = runMaster('misthunt-master', { plan: [[0, [14, 10]], [30, [-6, 12]], [50, [12, 10]], [74, [0, -14]], [91, T[0]], [140, T[3]], [160, [0, 10]], [173, [14, 8]]], acts: [158], hook: shatter });
  report('안개 송곳니: 딜러 모범 동선', t);
}

// 타나트로스: 딜러 모범 동선(수정 운반 → 화염구 막기 → 분담 → 빛 원)
{
  idleFails('타나트로스', 'factory-master', 6);
  const t = runMaster('factory-master', { plan: [[0, [-22, 0]], [10.1, [16, 14]], [120, [15, -19]], [172, [-10, 8]]], acts: [10, 17.5] });
  report('타나트로스: 딜러 모범 동선', t);
}

// 신벌의 대행자: 탑을 4 → 2 → 6번 칸 순으로 빼앗아 금색 대각선을 만든다. 안 빼앗으면 파란 줄로 전멸
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/cursedtomb-master.json', import.meta.url)));
  const i = new Sim(d, new CombatM({ role: 'dps', skills: {} })); while (!i.done) i.step(0.05, { mx: 0, mz: 0 });
  console.log(i.log.some(r => r.name === '신벌 프로토콜' && !r.ok) ? 'PASS' : 'FAIL', '신벌의 대행자: 탑을 안 빼앗으면 파란 줄로 전멸', i.log.filter(r => r.ok).length, '/', i.log.length);
  const t = runMaster('cursedtomb-master', { plan: [[0, [4, 2]], [40, [3, 3]], [58.1, [8, -8]], [76, [16, -10]], [96, [1, -1]], [102.1, [0, 21]], [134, [0, 0]], [170, [-10, 16]], [194, [0, 0]], [230.1, [13, 13]]] });
  report('신벌의 대행자: 모범 동선', t, t.log.some(r => r.name === '프로토콜 붕괴' && r.ok));
}

// 카트그리프: 딜러 모범 동선(연결 차단 → 쉐어 → 레이저 따라 돌며 막기 → 오브 → 진짜 포털)
{
  idleFails('카트그리프', 's3tower-master', 6);
  const beam = t => { if (t.t < 76 || t.t > 105.5) return null; const a = (90 + 10 * Math.max(0, t.t - 77)) * Math.PI / 180; return [t.boss.x + Math.cos(a) * 8, t.boss.z + Math.sin(a) * 8]; };
  const t = runMaster('s3tower-master', { plan: [[0, [6, 12]], [12, [0, 16]], [38, [-6, 8]], [52, [0, 8]], [118, [0, 14]], [241.1, [0, -14]], [256, [20, 0]]], acts: [21, 221, 247], hook: beam });
  report('카트그리프: 딜러 모범 동선', t);
}

// 심해 나뽀: 얼음 음표를 끝까지 지키는 모범 동선, 그리고 다른 색에 닿으면 음표가 바뀌는지
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/searocks-master.json', import.meta.url)));
  const run = (plan, acts) => { const t = new Sim(d, new Combat({ role: 'dps', skills: {} })); const A = [...acts]; while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t; };
  const idle = run([], []);
  console.log(idle.log.filter(r => !r.ok).length >= 6 && idle.note === '물' ? 'PASS' : 'FAIL', '심해 나뽀: 가만히 있으면 실패하고 물 띠에 맞아 음표가 물로 바뀜', idle.log.filter(r => r.ok).length, '/', idle.log.length);
  const t = run([[0, [18, 6]], [12.1, [0, 12]], [40.1, [10, 8]], [55.1, [-6, 8]], [107.1, [-14, 2]], [137.9, [0, -8]], [143.1, [-6, -6]], [149.9, [-8, 0]], [155.1, [-8, -5]], [162.1, [6, -6]], [173.2, [20, 0]]], [173, 177.5]);
  console.log(t.log.every(r => r.ok) && t.note === '얼음' ? 'PASS' : 'FAIL', '심해 나뽀: 얼음 음표 모범 동선', t.log.length, t.note, t.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}

// 보스 이동: 내가 탱커면 보스가 나를 따라오고, 딜러면 스킬에 맞춰 움직였다가 제자리로 돌아온다
{
  const { Combat } = await import('./combat.js');
  for (const f of ['tina', 'misthunt', 'factory', 'cursedtomb', 's3tower', 'searocks']) {
    const d = JSON.parse(fs.readFileSync(new URL(`./data/${f}-master.json`, import.meta.url)));
    const t = new Sim(d, new Combat({ role: 'tank', tank: true, skills: {} })); let far = 0, moved = 0; const h = d.boss.pos;
    while (!t.done) { t.step(0.05, { mx: 0, mz: 0 }); if (Math.hypot(t.boss.x - h[0], t.boss.z - h[1]) > 1) moved++; if (t.t > 7.5 && t.t < 8.5) far = Math.max(far, Math.hypot(t.boss.x - t.player.x, t.boss.z - t.player.z)); }
    const chase = d.boss.chase === false || far <= (d.boss.reach ?? 5) + 1;
    console.log(chase && (moved > 0 || d.boss.chase === false) && [t.boss.x, t.boss.z].every(Number.isFinite) ? 'PASS' : 'FAIL', `보스 이동(${f}, 탱커)`, far.toFixed(1), moved);
  }
}

// 시즌4 레이드 1넴: 줄 환영(대시 통과·틈으로 탈출)과 룬 회전판
{
  const d4 = JSON.parse(fs.readFileSync(new URL('./data/raid4-boss1.json', import.meta.url)));
  let s4 = new Sim(JSON.parse(JSON.stringify(d4)));
  while (!s4.done && s4.t < 270) s4.step(0.05, { mx: 0, mz: 0 });
  const bad = s4.log.filter(r => !r.ok).map(r => r.name);
  assert.ok(bad.includes('중앙 끌어당김 → 줄 환영') && bad.includes('룬 회전판'), '가만히 있으면 줄 환영과 회전판에서 실패해야 한다');
  s4 = new Sim(JSON.parse(JSON.stringify(d4)));
  const go = (x, z) => { const dx = x - s4.player.x, dz = z - s4.player.z; return Math.hypot(dx, dz) < 0.25 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
  // 회전판 풀이: 4개 자리(고리 밖·안쪽·가운데·바깥 고리)를 1.5초 단위로 4수 앞까지 내다보고 가장 잘 모이는 첫 수를 고른다
  const spots = dl => [12.5, ...dl.rings.map(g => (g.rIn + g.rOut) / 2)];
  const sprd = a => { let m = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { let v = Math.abs(a[i] - a[j]) % 360; if (v > 180) v = 360 - v; m = Math.max(m, v); } return m; };
  const look = (dl, ang, r, depth) => { let best = [Infinity, 0];
    spots(dl).forEach((tr, k) => { const a = ang.slice(); let rr = r, m = Infinity;
      for (let i = 0; i < 30; i++) { rr += Math.max(-0.3, Math.min(0.3, tr - rr)); dl.rings.forEach((g, j) => { a[j] += (rr >= g.rIn && rr < g.rOut ? 1 : -1) * g.speed * 0.05; }); m = Math.min(m, sprd(a)); }
      const v = m <= dl.tol ? -1 : depth > 1 ? Math.min(m, look(dl, a, rr, depth - 1)[0]) : m;
      if (v < best[0]) best = [v, tr]; });
    return best; };
  let dialGoal = 12.5, dialAt = -1;
  while (!s4.done && s4.t < 270) {
    const t = s4.t; let inp = go(0, 12.5);
    if ((t >= 16 && t < 18.2) || (t >= 172 && t < 174.2)) inp = go(8, 12.5);
    if (s4.cage) { const cg = s4.cage;
      if (cg.breach.idx === 0) inp = t < cg.t0 ? go(0, 11) : { mx: 0, mz: 1, dash: true };
      else { const a = cg.rot + (cg.breach.idx + 0.5) * Math.PI * 2 / cg.n; inp = t < cg.breach.at + 0.1 ? go(0, 0) : { mx: Math.cos(a), mz: Math.sin(a) }; } }
    if (s4.dial) { if (t >= dialAt) { dialGoal = look(s4.dial, s4.dial.rings.map(g => g.ang), Math.hypot(s4.player.x, s4.player.z), 4)[1]; dialAt = t + 1.5; } inp = go(0, dialGoal); }
    s4.step(0.05, inp);
  }
  console.log('raid4-boss1 모범', s4.score(), s4.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
  assert.equal(s4.score().ok, s4.score().total);
}

// 시즌4 레이드 2넴: 패링(형상 앞쪽으로 대시)·스카이플레어(빈 빛줄기에서 떠올라 최고점 점프)
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/raid4-boss2.json', import.meta.url)));
  let s = new Sim(JSON.parse(JSON.stringify(d)));
  while (!s.done && s.t < d.duration + 5) s.step(0.05, { mx: 0, mz: 0 });
  const bad = s.log.filter(r => !r.ok).map(r => r.name);
  assert.ok(bad.some(n => n.startsWith('환영 빛의 형상')) && bad.includes('스카이플레어') && bad.includes('궁극의 죄'), '가만히 있으면 패링·스카이플레어에서 실패하고 죄의 징벌이 5스택까지 쌓여야 한다');
  s = new Sim(JSON.parse(JSON.stringify(d)));
  const go = (x, z) => { const dx = x - s.player.x, dz = z - s.player.z; return Math.hypot(dx, dz) < 0.25 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
  const within = (t, a, b) => t >= a && t < b;
  // 기본 자리는 보스 옆구리(심판의 고리와 순회 원 궤도 사이)
  const B = [13, -16], fwd = () => { const dx = s.boss.x - s.player.x, dz = s.boss.z - s.player.z, l = Math.hypot(dx, dz); return { mx: dx / l, mz: dz / l }; };
  let dashed = -9;
  while (!s.done && s.t < d.duration + 5) {
    const t = s.t; let inp = go(...B);
    if (t < 16.5 || within(t, 276, 296.5)) inp = go(-8, -12);                        // 쫄 구간 첫 형상 곁
    if ([9, 31, 140, 208, 289, 311, 420].some(a => within(t, a, a + 3))) inp = go(13, -23);         // 내 자리 원에서 걸어 나온다
    if ([78, 150, 358, 430].some(a => within(t, a + 2.5, a + 4.5))) inp = go(8.3, -19.8);      // 고정된 직사각형에서 옆으로
    if (within(t, 106, 109) || within(t, 386, 389)) inp = go(14, -21.5);                                    // 부채꼴 갈래 사이
    if ([9, 31, 289, 311].some(a => within(t, a, a + 3)) && (t < 16.5 || within(t, 276, 296.5))) inp = go(-8, -4);
    if (within(t, 123.3, 126.1) || within(t, 403.3, 406.1)) inp = { mx: 0, mz: 0 };   // 첫 패링 자리에서 둘째 형상을 기다린다
    for (const a of [68, 118, 121.3, 180, 348, 398, 401.3]) if (within(t, a + 4.8, a + 5.3)) { if (t - dashed > 2) { inp = { ...fwd(), dash: true }; dashed = t; } else inp = { mx: 0, mz: 0 }; }   // 패링: 완성 직전에 형상 앞(보스 쪽)으로 대시
    if (within(t, 171.75, 172.2)) { if (t - dashed > 2) { inp = { mx: -1, mz: 0, dash: true }; dashed = t; } else inp = { mx: 0, mz: 0 }; }   // 전체 장판은 대시 무적으로
    if (s.flare) inp = { ...go(0, 18), jump: s.flare.up && t >= s.flare.apex };
    s.step(0.05, inp);
  }
  console.log('raid4-boss2 모범', s.score(), s.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
  assert.equal(s.score().ok, s.score().total);
}

// 시즌4 레이드 3넴: 천체 충돌 대피·다크폴 빛 구슬 옮기기·손 공격(점프/땅)
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/raid4-boss3.json', import.meta.url)));
  let s = new Sim(JSON.parse(JSON.stringify(d)));
  while (!s.done && s.t < d.duration + 5) s.step(0.05, { mx: 0, mz: 0 });
  const bad = s.log.filter(r => !r.ok).map(r => r.name);
  assert.ok(bad.some(n => n.startsWith('천체 충돌')) && bad.includes('다크폴: 빛 구슬') && bad.some(n => n.startsWith('오른손 내려찍기')), '가만히 있으면 천체 충돌·다크폴·오른손 내려찍기에서 실패해야 한다');
  s = new Sim(JSON.parse(JSON.stringify(d)));
  const go = (x, z) => { const dx = x - s.player.x, dz = z - s.player.z; return Math.hypot(dx, dz) < 0.25 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
  const within = (t, a, b) => t >= a && t < b;
  while (!s.done && s.t < d.duration + 5) {
    const t = s.t; let inp = go(4, 6);
    if (within(t, 85, 108) || within(t, 195, 214)) inp = go(-4, 6);                  // 오른쪽 반 공격은 왼쪽에서
    if (within(t, 66, 76)) inp = go(12, 22);                                         // 천체 충돌: 만나는 곳 반대편
    if (within(t, 278, 288)) inp = go(-12, 22);
    if (s.lorb) { const o = s.lorb; inp = Math.hypot(o.x - s.player.x, o.z - s.player.z) > 3.5 ? go(o.x, o.z) : { mx: -o.x, mz: -o.z }; }   // 구슬에 들어간 뒤 구슬이 중앙으로 가는 방향으로 걷는다
    if ([250, 266].some(a => within(t, a + 3.2, a + 3.3))) inp = { ...inp, jump: true };
    s.step(0.05, inp);
  }
  console.log('raid4-boss3 모범', s.score(), s.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
  assert.equal(s.score().ok, s.score().total);
}

// 시즌4 마스터 던전 거울 속의 심판: 넉백·회오리 놓기·얼음 창·거울 도넛
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/mirror-master.json', import.meta.url)));
  let s = new Sim(JSON.parse(JSON.stringify(d)));
  while (!s.done && s.t < d.duration + 5) s.step(0.05, { mx: 0, mz: 0 });
  const bad = s.log.filter(r => !r.ok).map(r => r.name);
  assert.ok(bad.some(n => n.startsWith('회오리 놓기')) && bad.some(n => n.startsWith('분신의 얼음 창')) && bad.some(n => n.startsWith('거울 직선')), '가만히 있으면 회오리·얼음 창·거울 직선에서 실패해야 한다');
  s = new Sim(JSON.parse(JSON.stringify(d)));
  const go = (x, z) => { const dx = x - s.player.x, dz = z - s.player.z; return Math.hypot(dx, dz) < 0.25 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
  // [시작 시각, 자리] — 그 시각부터 다음 항목 전까지 그 자리로 간다
  const path = [[0, [-6, 8]], [15.7, [6, 8]], [18, [0, 16]], [25.1, [0, 17.5]], [31.1, [0, 3]], [37.6, [0, -11]], [42.1, [0, -17.2]], [48.1, [8, -14]], [64, [6, 4]], [69.05, [3, 7]], [71, [6, 2]], [79.1, [6, 6]], [88.05, [0, 3]], [97.6, [-10, 0]], [102.1, [0, 13]], [112.1, [8, 14]], [124, [8, 8]], [140, [4.5, 2.5]], [145.05, [2, 4.5]]];
  while (!s.done && s.t < d.duration + 5) { const at = path.filter(q => q[0] <= s.t).pop()[1]; s.step(0.05, go(...at)); }
  console.log('mirror-master 모범', s.score(), s.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
  assert.equal(s.score().ok, s.score().total);
}

// 시즌4 마스터 던전 황폐한 정원: 색 맞추기 웅덩이·구슬 운반·넉백·보이드 스카 순서·파동 점프
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/courtyard-master.json', import.meta.url)));
  let s = new Sim(JSON.parse(JSON.stringify(d)));
  while (!s.done && s.t < d.duration + 5) s.step(0.05, { mx: 0, mz: 0 });
  const bad = s.log.filter(r => !r.ok).map(r => r.name);
  assert.ok(bad.some(n => n.startsWith('보이드 스카 소환')) && bad.includes('성원 구슬') && bad.some(n => n.startsWith('파동')), '가만히 있으면 색 맞추기·구슬·파동에서 실패해야 한다');
  s = new Sim(JSON.parse(JSON.stringify(d)));
  const go = (x, z) => { const dx = x - s.player.x, dz = z - s.player.z; return Math.hypot(dx, dz) < 0.25 ? { mx: 0, mz: 0 } : { mx: dx, mz: dz }; };
  const path = [[0, [0, 8]], [24.5, [-10, 6]], [48.1, [0, 19]], [55.05, [0, 10]], [58, [0, 14]], [65.1, [4, 13]], [89.1, [2, 8]], [100, [12, 8]], [129.5, [-8, -12]], [136, [0, 3]], [148.1, [6, 6]], [154.6, [-4, 4]], [173.5, [5, -5]]];
  const once = new Set(), hit = (k, a, b) => s.t >= a && s.t < b && !once.has(k) && once.add(k);
  while (!s.done && s.t < d.duration + 5) {
    let inp = go(...path.filter(q => q[0] <= s.t).pop()[1]);
    if (hit('d1', 23.75, 24) || hit('d2', 185.75, 186)) inp = { mx: 1, mz: 0, dash: true };   // 전체 장판은 대시 무적
    if (hit('pick', 129, 129.4) || hit('drop', 135.5, 135.9)) inp = { ...inp, interact: true };
    if (hit('jump', 172.2, 172.5)) inp = { ...inp, jump: true };
    s.step(0.05, inp);
  }
  console.log('courtyard-master 모범', s.score(), s.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
  assert.equal(s.score().ok, s.score().total);
}
