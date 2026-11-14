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

// 마스터 던전 티나(시즌3 16단+): 가만히 있으면 실패가 쌓이고, 모범 동선이면 전부 성공
{
  const d = JSON.parse(fs.readFileSync(new URL('./data/tina-master.json', import.meta.url)));
  const run = (plan, acts) => { const t = new Sim(d); const A = [...acts]; while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t.log; };
  const idle = run([], []);
  console.log(idle.filter(r => !r.ok).length >= 8 ? 'PASS' : 'FAIL', '티나: 가만히 있으면 실패', idle.filter(r => r.ok).length, '/', idle.length);
  const P = a => [Math.cos(a * Math.PI / 180) * 10, Math.sin(a * Math.PI / 180) * 10];
  const plan = [[0, [0, 18]], [6.1, [13, -20]], [16.1, [0, 8]], [22.1, [-17, 1]], [30.1, P(157.5)], [34.45, P(202.5)], [36.55, P(247.5)], [38.65, P(292.5)], [41, [14, 14]], [53.25, [11.5, 23]],
    [58, [0, 18]], [74.1, [19, 0]], [92, [0, 19]], [103.1, [12, -12]], [116, [18, 0]], [131.1, [-14, 10]]];
  const ok = run(plan, [6, 74, 91, 103, 131]);
  console.log(ok.every(r => r.ok) ? 'PASS' : 'FAIL', '티나: 모범 동선', ok.length, ok.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
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
  t = new Sim(load('19')); while (t.t < 31) t.step(0.05, { mx: 0, mz: 0 });
  const c = t.log.find(r => r.name === '약화 연결');
  t = new Sim(load('19')); while (t.t < 31) { const k = t.links[0], g = k && t.bots[k.bot], dx = g ? g.x - t.player.x : 0, dz = g ? g.z - t.player.z : 0, l = Math.hypot(dx, dz) || 1; t.step(0.05, g ? { mx: dx / l, mz: dz / l } : { mx: 0, mz: 0 }); }
  const e = t.log.find(r => r.name === '약화 연결');
  console.log(c && !c.ok && e && e.ok ? 'PASS' : 'FAIL', '티나 19단 연결', c?.msg, '/', e?.msg);
  console.log(load('20').title.includes('20단') && load('20').events.length === load('0').events.length + 2 ? 'PASS' : 'FAIL', '티나 20단 변형 적용');
}

// 안개 송곳니: 딜러는 압축 돌풍을 밟아 상흔을 만들어야 급습에서 산다
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/misthunt-master.json', import.meta.url)));
  const run = (role, plan, acts) => { const t = new Sim(d, new Combat({ role, tank: role === 'tank', skills: {} })); const A = [...acts]; while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t.log; };
  const idle = run('dps', [], []);
  console.log(idle.filter(r => !r.ok).length >= 5 ? 'PASS' : 'FAIL', '안개 송곳니: 가만히 있으면 실패', idle.filter(r => r.ok).length, '/', idle.length);
  const T = d.events[0].pos;
  const ok = run('dps', [[0, [12, 6]], [18, [-6, 12]], [32, [10, 8]], [46, [0, -14]], [59, T[0]], [71, T[3]], [84, [0, 10]], [92, [12, 4]]], [82]);
  console.log(ok.every(r => r.ok) ? 'PASS' : 'FAIL', '안개 송곳니: 딜러 모범 동선', ok.length, ok.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}

// 타나트로스: 딜러 모범 동선(수정 운반 → 화염구 막기 → 분담 → 빛 원 → 광선 회피)
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/factory-master.json', import.meta.url)));
  const run = (role, plan, acts) => { const t = new Sim(d, new Combat({ role, tank: role === 'tank', skills: {} })); const A = [...acts]; while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t.log; };
  const idle = run('dps', [], []);
  console.log(idle.filter(r => !r.ok).length >= 6 ? 'PASS' : 'FAIL', '타나트로스: 가만히 있으면 실패', idle.filter(r => r.ok).length, '/', idle.length);
  const ok = run('dps', [[0, [-22, 0]], [6.1, [16, 14]], [44, [15, -19]], [70, [-10, 8]], [95.2, [1, 4.5]], [100.2, [-8, -3]], [105.7, [-9, 2]]], [6, 13.5]);
  console.log(ok.every(r => r.ok) ? 'PASS' : 'FAIL', '타나트로스: 딜러 모범 동선', ok.length, ok.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}

// 신벌의 대행자: 탑을 4 → 2 → 6번 칸 순으로 빼앗아 금색 대각선을 만든다. 엉뚱한 탑을 빼앗으면 파란 줄이 생겨 전멸
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/cursedtomb-master.json', import.meta.url)));
  const run = (plan) => { const t = new Sim(d, new Combat({ role: 'dps', skills: {} })); while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); t.step(0.05, l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }); } return t.log; };
  const idle = run([]);
  console.log(idle.some(r => r.name === '신벌 프로토콜' && !r.ok) ? 'PASS' : 'FAIL', '신벌의 대행자: 탑을 안 빼앗으면 파란 줄로 전멸', idle.filter(r => r.ok).length, '/', idle.length);
  const ok = run([[0, [4, 2]], [10.1, [9, 7]], [13.2, [3, 3]], [24.1, [8, -8]], [36.1, [16, -10]], [42, [1, -1]], [46.1, [0, 21]], [54.1, [-10, 16]], [63.4, [0, 0]], [80.1, [13, 13]], [94.1, [18, 9]]]);
  console.log(ok.every(r => r.ok) && ok.some(r => r.name === '프로토콜 붕괴') ? 'PASS' : 'FAIL', '신벌의 대행자: 모범 동선', ok.length, ok.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}

// 카트그리프: 딜러 모범 동선(연결 차단 → 쉐어 → 레이저 따라 돌며 막기 → 오브 → 진짜 포털)
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/s3tower-master.json', import.meta.url)));
  const run = (plan, acts) => { const t = new Sim(d, new Combat({ role: 'dps', skills: {} })); const A = [...acts]; while (!t.done) { let g = plan.filter(([at]) => at <= t.t).pop()?.[1]; if (t.t >= 36 && t.t < 46.5) { const a = (90 + 20 * Math.max(0, t.t - 37)) * Math.PI / 180; g = [Math.cos(a) * 8, Math.sin(a) * 8]; } const dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t.log; };
  const idle = run([], []);
  console.log(idle.filter(r => !r.ok).length >= 6 ? 'PASS' : 'FAIL', '카트그리프: 가만히 있으면 실패', idle.filter(r => r.ok).length, '/', idle.length);
  const ok = run([[0, [6, 12]], [8.6, [0, 16]], [25.1, [-6, 8]], [32.1, [0, 8]], [46.5, [0, 14]], [75.1, [20, 0]]], [13, 64]);
  console.log(ok.every(r => r.ok) ? 'PASS' : 'FAIL', '카트그리프: 딜러 모범 동선', ok.length, ok.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}

// 심해 나뽀: 분담에서 물 원에 서면 음표가 물로 바뀌고, 이후 파도·물방울·스피커는 물 쪽을 써야 한다
{
  const { Combat } = await import('./combat.js');
  const d = JSON.parse(fs.readFileSync(new URL('./data/searocks-master.json', import.meta.url)));
  const run = (plan, acts) => { const t = new Sim(d, new Combat({ role: 'dps', skills: {} })); const A = [...acts]; while (!t.done) { const g = plan.filter(([at]) => at <= t.t).pop()?.[1], dx = g ? g[0] - t.player.x : 0, dz = g ? g[1] - t.player.z : 0, l = Math.hypot(dx, dz); const interact = A.length && t.t >= A[0] ? (A.shift(), true) : false; t.step(0.05, { ...(l < 0.2 ? { mx: 0, mz: 0 } : { mx: dx / l, mz: dz / l }), interact }); } return t; };
  const idle = run([], []).log;
  console.log(idle.filter(r => !r.ok).length >= 6 ? 'PASS' : 'FAIL', '심해 나뽀: 가만히 있으면 실패', idle.filter(r => r.ok).length, '/', idle.length);
  const t = run([[0, [18, 6]], [10.1, [8, 8]], [19.1, [-12, 10]], [27.1, [-10, 10]], [38.1, [0, -12]], [52, [0, -8]], [57.1, [-12, 0]], [69.2, [10, -4]], [76.1, [-6, 8]], [85.6, [-10, 17.3]], [92, [-18, 6]]], [85.2, 90.5]);
  console.log(t.log.every(r => r.ok) && t.note === '물' ? 'PASS' : 'FAIL', '심해 나뽀: 물 음표 모범 동선', t.log.length, t.log.filter(r => !r.ok).map(r => `${r.t} ${r.name}: ${r.msg}`));
}
