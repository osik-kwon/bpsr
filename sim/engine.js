// 기믹 연습기 로직: 렌더링과 분리된 순수 계산. 좌표는 미터, 전투장 중심이 원점, 방은 사분면(1→2→3→4 시계 방향).
const TAU = Math.PI * 2;
// 방 n의 중심 각도. 위에서 내려다볼 때(x 오른쪽, z 아래쪽) 1→2→3→4가 시계 방향
export const roomAngle = n => Math.PI / 4 + (n - 1) * Math.PI / 2;
export function roomOf(x, z) {
  const a = Math.atan2(z, x);
  for (let n = 1; n <= 4; n++) {
    let d = Math.abs(a - roomAngle(n)) % TAU; if (d > Math.PI) d = TAU - d;
    if (d <= Math.PI / 4) return n;
  }
  return 1;
}
const polar = (ang, r) => ({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
export function inside(s, p) {
  if (s.shape === 'circle') return dist(p, s) <= s.r;
  if (s.shape === 'ring') { const d = dist(p, s); return d >= s.rIn && d <= s.rOut; }
  if (s.shape === 'line') return segDist(p, s.a, s.b) <= s.w / 2;
  if (s.shape === 'sector') {   // dir: 중심 방향(라디안), half: 반각
    const d = dist(p, s); if (d > s.r) return false;
    let a = Math.abs(Math.atan2(p.z - s.z, p.x - s.x) - s.dir) % TAU; if (a > Math.PI) a = TAU - a;
    return a <= s.half;
  }
  if (s.shape === 'rect') return Math.abs(p.x - s.x) <= s.w / 2 && Math.abs(p.z - s.z) <= s.h / 2;
  if (s.shape === 'multi') return s.spots.some(c => inside(c, p));
  return false;
}

export class Sim {
  constructor(data) { this.data = data; this.attackLock = false; this.reset(); }
  reset() {
    const d = this.data;
    this.t = 0; this.done = false; this.log = []; this.tele = []; this.cores = []; this.markers = [];
    this.room = d.boss.room; this.energy = 0; this.crossedEarly = false; this.spin = null; this.curtain = null; this.tether = null; this.lasers = [];
    // 격자 전투장(2·3넴): 타일 상태 0 멀쩡, 1 금 감, 2 무너짐(없는 칸도 2)
    const A = d.arena; this.grid = A.type === 'grid' ? A : null; this.cannons = []; this.sweeps = []; this.crystal = null; this.mines = []; this.freezeUntil = 0; this.freezeText = ''; this.orbs = [];
    if (this.grid) { this.tiles = Array.from({ length: A.cols * A.rows }, (_, i) => (A.missing ?? []).some(([c, r]) => c + r * A.cols === i) ? 2 : 0); }
    this.boss = d.boss.pos ? { x: d.boss.pos[0], z: d.boss.pos[1] } : polar(roomAngle(this.room), d.boss.dist);
    this.bossDir = (d.boss.dir ?? 90) * Math.PI / 180;
    this.clone = null;
    this.player = { ...(d.player.start ? { x: d.player.start[0], z: d.player.start[1] } : polar(roomAngle(this.room), 12)), dashCd: 0, iframe: 0, lock: 0, lockN: 0, attackTime: 0 };
    this.lockTimes = d.player.lockTimes ?? [0.6, 0.9, 1.3];
    // 파티원 7명은 보스 뒤쪽 근처에 모여 있는 고정 표식
    this.roomStart = 0; this.bots = this.partySpots(this.room);
    this.pending = d.events.map(e => ({ ...e })).sort((a, b) => a.t - b.t);
  }
  result(name, ok, msg) { this.log.push({ t: +this.t.toFixed(1), name, ok, msg }); }
  // 판정 예고 등록: kind avoid=안에 있으면 실패, soak=하나 안에 있어야 성공, far=거리 safeDist 이상이어야 성공
  add(o) { this.tele.push({ start: this.t, type: this.curType, noDodge: this.curNoDodge, ...o }); }

  // 파티원 7명의 기본 자리(보스 앞에 모여 있음)
  partySpots(room) {
    if (this.data.partySpots) return this.data.partySpots.map(([x, z]) => ({ x, z }));
    if (this.data.party === 'ring') return Array.from({ length: 7 }, (_, i) => polar(i * TAU / 7 + 0.3, 18));   // 전투장에 흩어진 배치
    return Array.from({ length: 7 }, (_, i) => polar(roomAngle(room) + (i - 3) * 0.12, 15 + (i % 2) * 2)); }
  // 격자 도우미: 칸 번호(없으면 -1), 칸 사각형
  tileAt(x, z) { const g = this.grid, c = Math.floor(x / g.tileW + g.cols / 2), r = Math.floor(z / g.tileH + g.rows / 2); return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : c + r * g.cols; }
  tileRect(i) { const g = this.grid, c = i % g.cols, r = Math.floor(i / g.cols); return { shape: 'rect', x: (c - (g.cols - 1) / 2) * g.tileW, z: (r - (g.rows - 1) / 2) * g.tileH, w: g.tileW, h: g.tileH }; }
  tileIdx([c, r]) { return c + r * this.grid.cols; }
  // 섬멸 광선 배치: 파티원 A·B 자리, 내 징 M, 그리고 세 변 위의 코어 4개(A–B 변에 2개)
  triangle() {
    const a0 = roomAngle(this.room), A = polar(a0 - 0.5, 20), B = polar(a0 + 0.5, 20), M = polar(a0, 5);
    const at = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f });
    return { A, B, M, cores: [at(A, B, 1 / 3), at(A, B, 2 / 3), at(B, M, 0.5), at(M, A, 0.5)] };
  }
  spawn(e) {
    this.curType = e.type; this.curNoDodge = !!e.noDodge;
    const front = polar(roomAngle(this.room), this.data.boss.dist - 8);
    if (e.type === 'tankbuster') {
      this.add({ name: e.name, kind: 'avoid', shape: 'circle', ...front, r: e.r, hitAt: e.t + e.cast, color: 'red' });
    } else if (e.type === 'cores') {
      this.cores = this.triangle().cores.slice(0, e.count).map(c => ({ ...c, alive: true }));
    } else if (e.type === 'tether') {
      // 대상 3명(파티원 A·B와 나)이 삼각형 줄로 이어진다. 줄이 확정되는 순간 세 변이 코어 4개를 모두 지나야 하고, 이어서 변을 따라 광선이 나간다
      const { A, B, M } = this.triangle();
      // role이 party면 세 번째 꼭짓점도 파티원이 맡고, 나는 광선만 피하면 된다
      const party = e.role === 'party';
      this.tether = { A, B, V: party ? M : null, lockAt: e.t + e.cast, fireAt: e.t + e.cast + e.fire, width: e.width, C: null };
      this.markers = party ? [] : [{ ...M, label: '내 징' }];
      this.bots[3] = { ...A }; this.bots[4] = { ...B }; if (party) this.bots[5] = { ...M };
    } else if (e.type === 'donut3') {
      // 전투장 중심 기준 세 고리가 전체를 덮고, 타격마다 안전 고리 하나만 남는다
      e.hits.forEach((h, i) => {
        const k = ['in', 'mid', 'out'].indexOf(e.safe[i]);
        const spots = [0, 1, 2].filter(j => j !== k).map(j => ({ shape: 'ring', x: 0, z: 0, rIn: e.bands[j][0], rOut: e.bands[j][1] }));
        // preview가 있으면 예고를 차례로 잠깐 보여 준 뒤 숨기고(순서 암기), 없으면 터지기 5초 전부터 보여 준다
        this.add({ name: `${e.name} ${i + 1}타`, kind: 'avoid', shape: 'multi', spots, hitAt: h, showFrom: e.preview ? e.preview[i] : h - 5, showUntil: e.preview ? e.preview[i] + e.previewDur : undefined, color: 'pink' });
      });
    } else if (e.type === 'share') {
      // 쉐어는 파티원 3명에게 붙는다. 원마다 인원이 차야 대상자가 산다(내가 들어가야 하는 원은 하나)
      const a0 = roomAngle(this.room);
      const spots = [-0.45, 0, 0.45].map(da => polar(a0 + da, 16));
      spots.forEach((c, i) => { this.bots[i] = { ...c }; });
      this.add({ name: e.name, kind: 'soak', shape: 'multi', spots: spots.map(c => ({ shape: 'circle', ...c, r: e.r })), hitAt: e.t + e.cast, color: 'pink', okMsg: e.okMsg, failMsg: e.failMsg, reset: true });
    } else if (e.type === 'phantom') {
      this.clone = polar(roomAngle(this.room) + 0.9, this.data.boss.dist - 4);
      for (const [who, at] of e.lands) {
        const c = who === 'boss' ? this.boss : this.clone;
        this.add({ name: `${e.name} · ${who === 'boss' ? '본체' : '분신'} 착지`, kind: 'far', shape: 'circle', ...c, r: e.safeDist, hitAt: at, showFrom: at - 3, color: who === 'boss' ? 'red' : 'pink' });
      }
      this.cloneUntil = Math.max(...e.lands.map(l => l[1]));
    } else if (e.type === 'cannon') {
      // 궤도포: 대상자를 따라다니는 원이 follow초 뒤 고정되고 fall초 뒤 떨어져 그 칸을 한 단계 부순다. shots: who('me' 또는 파티원 번호), r, tile(버릴 칸), at(파티원이 놓는 자리)
      for (const sh of e.shots) if (sh.who !== 'me') this.bots[sh.who] = { x: sh.at[0], z: sh.at[1] };
      this.cannons.push({ name: e.name, lockAt: e.t + e.follow, hitAt: e.t + e.follow + e.fall, shots: e.shots });
    } else if (e.type === 'lineShare') {
      // 직선 쉐어: 보스에서 대상 파티원 쪽으로 나가는 직사각형 안에 같이 서야 한다
      const b = this.bots[e.bot] = { x: e.at[0], z: e.at[1] }, dx = b.x - this.boss.x, dz = b.z - this.boss.z, l = Math.hypot(dx, dz) || 1;
      this.add({ name: e.name, kind: 'in', shape: 'line', a: { ...this.boss }, b: { x: this.boss.x + dx / l * e.len, z: this.boss.z + dz / l * e.len }, w: e.width, hitAt: e.t + e.cast, color: 'pink', reset: true });
    } else if (e.type === 'bomb') {
      // 거리 감쇠 폭탄: 대상 파티원이 구석으로 빠지고, 나는 safeDist 이상 떨어져야 한다
      const b = this.bots[e.bot] = { x: e.at[0], z: e.at[1] };
      this.add({ name: e.name, kind: 'far', shape: 'circle', ...b, r: e.safeDist, hitAt: e.t + e.cast, color: 'yellow' });
    } else if (e.type === 'shock') {
      // 붕괴 충격: 보스에서 멀어져야 하고, 터질 때 금 간 칸이 전부 무너진다
      this.add({ name: e.name, kind: 'far', shape: 'circle', ...this.boss, r: e.safeDist, hitAt: e.t + e.cast, color: 'red', tileOp: 'collapse' });
    } else if (e.type === 'stack') {
      // 쉐어: 파티원들이 모인 원 안에 같이 선다
      [0, 1, 2].forEach((i, k) => { this.bots[i] = { x: e.at[0] + (k - 1) * 1.5, z: e.at[1] + (k % 2) * 1.2 }; });
      this.add({ name: e.name, kind: 'in', shape: 'circle', x: e.at[0], z: e.at[1], r: e.r, hitAt: e.t + e.cast, color: 'pink', reset: true });
    } else if (e.type === 'spread') {
      // 산개·폭탄·개인: 터질 때 모든 파티원과 r 이상 떨어져 있어야 한다. 원은 나를 따라다닌다
      if (e.bots) this.bots = e.bots.map(([x, z]) => ({ x, z }));
      this.add({ name: e.name, kind: 'alone', shape: 'circle', follow: true, x: 0, z: 0, r: e.r, hitAt: e.t + e.cast, color: e.color ?? 'yellow', reset: !!e.bots });
    } else if (e.type === 'aoe') {
      // 정해진 자리에 깔리는 원형 장판(탱버, 번개 등)
      this.add({ name: e.name, kind: e.kind ?? 'avoid', shape: 'multi', spots: e.spots.map(([x, z, r]) => ({ shape: 'circle', x, z, r })), hitAt: e.t + e.cast, color: e.color ?? 'red' });
    } else if (e.type === 'puddle') {
      // 개인 장판: 시전 순간 나와 파티원이 선 자리에 원이 깔리고 cast초 뒤 터진다. 내 원에서 걸어 나온다
      const spots = [this.player, ...this.bots].map(c => ({ shape: 'circle', x: c.x, z: c.z, r: e.r }));
      this.add({ name: e.name, kind: 'avoid', shape: 'multi', spots, hitAt: e.t + e.cast, color: e.color ?? 'red' });
    } else if (e.type === 'marks') {
      // 공대가 바닥에 찍는 징(궤도포를 버릴 자리 번호)
      this.markers = e.pos.map(([x, z], i) => ({ x, z, label: String(i + 1) }));
    } else if (e.type === 'orb') {
      // 넉백 구슬: 터질 때 범위 안에 있으면 push만큼 날아간다. 걷는 중이면 걷는 방향, 서 있으면 구슬 반대쪽
      this.orbs.push({ name: e.name, x: e.at[0], z: e.at[1], r: e.r, push: e.push, hitAt: e.t + e.cast, start: e.t });
    } else if (e.type === 'crystals') {
      // 수정 텔포: 파티원이 1번을 누른 뒤 gap 범위 안에 내가 내 수정을 눌러야 한다(상호작용 키)
      this.crystal = { name: e.name, pos: e.pos.map(([x, z]) => ({ x, z })), first: e.first, mine: e.mine, gap: e.gap, fire: e.fire, pressed: null, start: e.t };
      this.markers = this.crystal.pos.slice(0, e.count).map((c, i) => ({ ...c, label: String(i + 1) }));
    } else if (e.type === 'mine') {
      // 파동 장판: 나를 따라다니다 follow초 뒤 바닥에 고정되고 fuse초 뒤 터진다. 본대에서 멀리 놓고 빠져나온다
      this.mines.push({ name: e.name, lockAt: e.t + e.follow, fuse: e.fuse, r: e.r, away: e.away, safeDist: e.safeDist });
    } else if (e.type === 'freeze') {
      this.freezeUntil = e.t + e.dur; this.freezeText = e.text;
    } else if (e.type === 'sweep') {
      // 반쪽 휩쓸기: 보스에서 나온 긴 광선이 from에서 vel(도/초)로 dur초 동안 돈다. 대시 무적으로 넘을 수 있다
      this.sweeps.push({ name: e.name, t0: e.t + e.warn, start: e.t, from: e.from, vel: e.vel, dur: e.dur, len: e.len, width: e.width, hits: 0 });
    } else if (e.type === 'cubes') {
      // 큐브: 십자(변 가운데 칸)나 정사각(모서리 칸) 모양으로 칸이 터진다. 중앙은 맞지 않는다. tiles로 칸을 직접 줄 수도 있다
      const g = this.grid, set = e.tiles ? e.tiles : e.pattern === 'cross' ? [[1, 0], [0, 1], [2, 1], [1, 2]] : [[0, 0], [2, 0], [0, 2], [2, 2]];
      const spots = set.map(t => this.tileIdx(t)).filter(i => this.tiles[i] < 2).map(i => this.tileRect(i));
      if (spots.length) this.add({ name: e.name, kind: 'avoid', shape: 'multi', spots, hitAt: e.t + e.cast, color: e.color ?? 'red', destroy: e.destroy ? set.map(t => this.tileIdx(t)) : null });
    } else if (e.type === 'charge') {
      // 돌진: 보스가 from에서 to로 달리는 길이 판정이고, 끝나면 보스가 to에 선다
      if (!e.keepBoss) { this.boss = { x: e.from[0], z: e.from[1] }; this.bossDir = Math.atan2(e.to[1] - e.from[1], e.to[0] - e.from[0]); }
      this.add({ name: e.name, kind: 'avoid', shape: 'line', a: { x: e.from[0], z: e.from[1] }, b: { x: e.to[0], z: e.to[1] }, w: e.width, hitAt: e.t + e.cast, color: 'red', bossTo: e.keepBoss ? null : e.to });
    } else if (e.type === 'bossMove') {
      this.boss = { x: e.to[0], z: e.to[1] }; if (e.dir != null) this.bossDir = e.dir * Math.PI / 180;
    } else if (e.type === 'tiles') {
      if (e.op === 'fill') this.tiles = this.tiles.map(() => 0);   // 틈까지 메워진 한 장 바닥
      if (e.op === 'restore') this.tiles = this.tiles.map((v, i) => (this.grid.missing ?? []).some(t => this.tileIdx(t) === i) ? 2 : 0);
    } else if (e.type === 'wave') {
      // 바닥 웨이브: 세로 띠들이 번갈아 터진다. sets: [[x 중심들], ...]가 gap초 간격
      e.sets.forEach((xs, k) => this.add({ name: `${e.name} ${k + 1}`, kind: 'avoid', shape: 'multi', spots: xs.map(x => ({ shape: 'rect', x, z: 0, w: e.width, h: e.len })), hitAt: e.t + e.cast + k * e.gap, showFrom: e.t + k * e.gap, color: 'blue' }));
    } else if (e.type === 'cleave') {
      // 보스에서 탱 자리(방 안쪽) 방향으로 나가는 부채꼴
      this.add({ name: e.name, kind: 'avoid', shape: 'sector', ...this.boss, r: e.r, dir: e.dir != null ? e.dir * Math.PI / 180 : roomAngle(this.room) + Math.PI, half: e.angle * Math.PI / 360, hitAt: e.t + e.hit, color: 'blue' });
    } else if (e.type === 'spin') {
      // 중심에서 네 방향으로 뻗은 부채꼴이 돌면서 계속 피해를 준다. segs: [시작, 끝, 각속도(도/초)]
      this.spin = { name: e.name, t0: e.t, warn: e.warn, segs: e.segs, r: e.r, half: e.angle * Math.PI / 360, base: roomAngle(this.room) + Math.PI / 4, hits: 0, next: e.t + e.warn, tick: e.tick, end: e.t + e.warn + Math.max(...e.segs.map(g => g[1])) };
    } else if (e.type === 'lasers') {
      // 대상자(나와 파티원 몇 명)를 따라다니는 직선 예고. follow초 뒤 고정되고 fire초 뒤 발사된다
      this.lasers.push({ name: e.name, lockAt: e.t + e.follow, fire: e.fire, width: e.width, len: e.len, targets: [p_ => p_.player, ...e.bots.map(i => p_ => p_.bots[i])] });
    } else if (e.type === 'curtain') {
      this.curtain = { open: e.open, close: e.close, next: this.room % 4 + 1, cont: !!e.continue };
      // 에너지가 차면 방 한 칸(정사각형)이 감전된다. 판정은 광막 이동 결과로 대신한다
      if (e.purify) { const c = polar(roomAngle(this.room), e.purify * Math.SQRT1_2); this.add({ name: '방 정화', kind: 'show', shape: 'rect', ...c, w: e.purify, h: e.purify, hitAt: e.close, showFrom: e.close - 10, color: 'yellow' }); }
    }
  }

  resolve(s) {
    const p = this.player, safe = p.iframe > 0 && !s.noDodge;
    if (s.kind === 'avoid') { const hit = inside(s, p) && !safe; if (!s.quiet || hit) this.result(s.name, !hit, hit ? '범위 안에서 맞음' : '회피'); }
    else if (s.kind === 'far') { const d = dist(p, s); const ok = d >= s.r; this.result(s.name, ok, ok ? `거리 ${d.toFixed(0)}m` : `너무 가까움 ${d.toFixed(0)}m (${s.r}m 이상)`); }
    else if (s.kind === 'in') { const ok = inside(s, p); this.result(s.name, ok, ok ? '쉐어 참여, 팀원 생존' : '쉐어 밖, 인원이 모자라 팀원 사망'); if (s.reset) this.bots = this.partySpots(this.room); }
    else if (s.kind === 'alone') { const dmin = Math.min(...this.bots.map(b => dist(b, p))); const ok = dmin >= s.r; this.result(s.name, ok, ok ? `가장 가까운 팀원 ${dmin.toFixed(0)}m` : `팀원과 너무 가까움 ${dmin.toFixed(0)}m (${s.r}m 이상)`); if (s.reset) this.bots = this.partySpots(this.room); }
    else if (s.kind === 'soak') { const n = s.spots.filter(c => inside(c, p)).length; this.result(s.name, n === 1, n === 1 ? (s.okMsg ?? '쉐어 참여') : n ? '쉐어 겹침(치유 감소 중첩)' : (s.failMsg ?? '쉐어 밖')); if (s.reset) this.bots = this.partySpots(this.room); }
  }

  // input: {mx, mz} 정규화된 이동 방향, dash 불리언
  step(dt, input) {
    if (this.done) return;
    const d = this.data, p = this.player;
    this.t += dt;
    p.dashCd = Math.max(0, p.dashCd - dt); p.iframe = Math.max(0, p.iframe - dt);
    if (this.t < this.freezeUntil) input = { mx: 0, mz: 0 };   // 시간 정지 중에는 움직일 수 없다
    const l = Math.hypot(input.mx, input.mz);
    this.moveDir = l > 0 ? { x: input.mx / l, z: input.mz / l } : null;
    // 공격 중 이동 묶임: 가만히 있으면 스킬을 쓰기 시작하고, 그 동작이 끝날 때까지 이동 입력이 먹지 않는다(대시는 동작을 끊는다)
    const canDash = input.dash && p.dashCd === 0 && l > 0;
    if (p.lock > 0) { p.lock -= dt; p.attackTime += dt; if (canDash) p.lock = 0; }
    else if (this.attackLock && l === 0) { p.lock = this.lockTimes[p.lockN++ % this.lockTimes.length]; }
    if (l > 0 && !(p.lock > 0)) {
      let step = d.player.speed * dt;
      if (canDash) { step += d.player.dashDist; p.dashCd = d.player.dashCd; p.iframe = d.player.dashIframe; }
      p.x += input.mx / l * step; p.z += input.mz / l * step;
      if (this.grid) { const g = this.grid, X = g.cols * g.tileW / 2 + 1.5, Z = g.rows * g.tileH / 2 + 1.5; p.x = Math.max(-X, Math.min(X, p.x)); p.z = Math.max(-Z, Math.min(Z, p.z)); }
      else { const r = Math.hypot(p.x, p.z), R = d.arena.radius - 0.5; if (r > R) { p.x *= R / r; p.z *= R / r; } }
    }
    while (this.pending.length && this.pending[0].t <= this.t) this.spawn(this.pending.shift());
    // 넉백 구슬
    for (const o of this.orbs.filter(o => o.hitAt <= this.t)) {
      const dd = dist(o, p);
      if (dd > o.r) this.result(o.name, true, '넉백 범위 밖');
      else {
        const dir = this.moveDir ?? (dd > 0.1 ? { x: (p.x - o.x) / dd, z: (p.z - o.z) / dd } : { x: 0, z: 1 });
        p.x += dir.x * o.push; p.z += dir.z * o.push;
        const i = this.tileAt(p.x, p.z), ok = i >= 0 && this.tiles[i] < 2;
        this.result(o.name, ok, ok ? '넉백을 타고 안전하게 착지' : '넉백으로 발판 밖에 떨어짐');
      }
    }
    this.orbs = this.orbs.filter(o => o.hitAt > this.t);
    // 수정 텔포
    const cr = this.crystal;
    if (cr) {
      if (input.interact && cr.pressed == null && this.t >= cr.first && dist(cr.pos[cr.mine], p) <= 4) cr.pressed = this.t;
      if (this.t >= cr.fire) {
        const gap = cr.pressed == null ? null : cr.pressed - cr.first, ok = gap != null && gap >= cr.gap[0] && gap <= cr.gap[1];
        this.result(cr.name, ok, gap == null ? '수정을 누르지 않음' : ok ? `1번 뒤 ${gap.toFixed(1)}초에 누름` : `간격 ${gap.toFixed(1)}초 (${cr.gap[0]}~${cr.gap[1]}초여야 함)`);
        if (ok) { Object.assign(p, cr.pos[cr.mine]); p.iframe = 1; }
        this.crystal = null; this.markers = [];
      }
    }
    // 파동 장판
    for (const m of this.mines.filter(m => m.lockAt <= this.t)) {
      const c = { x: this.bots.reduce((a, b) => a + b.x, 0) / this.bots.length, z: this.bots.reduce((a, b) => a + b.z, 0) / this.bots.length }, dd = dist(c, p);
      this.result(`${m.name} 배치`, dd >= m.away, dd >= m.away ? `본대에서 ${dd.toFixed(0)}m` : `본대와 너무 가까움 ${dd.toFixed(0)}m (${m.away}m 이상)`);
      this.tele.push({ start: this.t, type: 'mine', noDodge: true, name: `${m.name} 폭발`, kind: 'far', shape: 'circle', x: p.x, z: p.z, r: m.safeDist, hitAt: m.lockAt + m.fuse, color: 'blue' });
    }
    this.mines = this.mines.filter(m => m.lockAt > this.t);
    // 반쪽 휩쓸기
    for (const sw of this.sweeps) {
      if (this.t >= sw.t0 && this.t <= sw.t0 + sw.dur && inside(this.sweepShape(sw, this.t), p) && !(p.iframe > 0)) { if (!sw.in) sw.hits++; sw.in = true; } else sw.in = false;
      if (this.t > sw.t0 + sw.dur) { this.result(sw.name, sw.hits === 0, sw.hits ? `광선에 ${sw.hits}번 맞음` : '광선을 넘어 회피'); sw.done = true; }
    }
    this.sweeps = this.sweeps.filter(sw => !sw.done);
    // 궤도포: 고정되는 순간 놓은 칸을 판정하고, 떨어질 때 칸을 부순다
    for (const C of this.cannons.filter(C => C.lockAt <= this.t)) {
      for (const sh of C.shots) {
        const pos = sh.who === 'me' ? { x: p.x, z: p.z } : { ...this.bots[sh.who] }, here = this.tileAt(pos.x, pos.z);
        // 큰 궤도포는 원 안에 중심이 든 칸을 모두 부순다
        const hit = sh.big ? this.tiles.map((_, i) => i).filter(i => dist(this.tileRect(i), pos) <= sh.r) : here >= 0 ? [here] : [];
        if (sh.who === 'me') { const want = this.tileIdx(sh.tile), ok = hit.length === 1 && hit[0] === want; this.result(`${C.name} 배치`, ok, ok ? '정해진 칸에 버림' : hit.includes(this.tileIdx([1, 1])) ? '중앙 칸에 버림' : '다른 칸에 버림'); }
        this.tele.push({ start: this.t, type: 'cannon', noDodge: true, name: `${C.name} 낙하`, kind: 'avoid', shape: 'circle', ...pos, r: sh.r, hitAt: C.hitAt, color: 'red', damage: hit, quiet: sh.who !== 'me' });
      }
      this.bots = this.partySpots(this.room);
    }
    this.cannons = this.cannons.filter(C => C.lockAt > this.t);
    const due = this.tele.filter(s => s.hitAt <= this.t);
    for (const s of due) {
      if (s.damage) for (const i of s.damage) this.tiles[i] = Math.min(2, this.tiles[i] + 1);
      if (s.destroy) for (const i of s.destroy) this.tiles[i] = 2;
      if (s.tileOp === 'collapse') this.tiles = this.tiles.map(v => v === 1 ? 2 : v);
      if (s.bossTo) this.boss = { x: s.bossTo[0], z: s.bossTo[1] };
    }
    for (const s of due.filter(s => s.type !== 'lasers')) this.resolve(s);
    const ls = due.filter(s => s.type === 'lasers');
    if (ls.length) { const n = ls.filter(s => inside(s, p)).length; this.result(ls[0].name, n === 0, n ? `광선 ${n}줄에 맞음` : `광선 ${ls.length}줄 회피`); }
    this.tele = this.tele.filter(s => s.hitAt > this.t);
    const tr = this.tether;
    if (tr && !tr.C && tr.lockAt <= this.t) {
      tr.C = tr.V ?? { x: p.x, z: p.z };
      const edges = [[tr.A, tr.B], [tr.B, tr.C], [tr.C, tr.A]];
      const miss = this.cores.filter(c => Math.min(...edges.map(([a, b]) => segDist(c, a, b))) > tr.width / 2 + 1.5).length;
      if (!tr.V) this.result('섬멸 광선 줄 맞추기', miss === 0, miss ? `코어 ${miss}개가 줄에서 벗어남` : '코어 4개가 모두 줄 위');
      this.markers = [];
      for (const [a, b] of edges) this.tele.push({ start: this.t, type: 'tether', noDodge: true, name: '섬멸 광선 발사', kind: 'avoid', shape: 'line', a, b, w: tr.width, hitAt: tr.fireAt, color: 'blue' });
    }
    if (tr && tr.C && tr.fireAt <= this.t) { this.cores = []; this.tether = null; this.bots = this.partySpots(this.room); }
    if (this.clone && this.t > this.cloneUntil) this.clone = null;
    for (const L of this.lasers.filter(L => L.lockAt <= this.t)) {
      for (const ln of this.laserLines(L)) this.tele.push({ start: this.t, type: 'lasers', noDodge: true, name: L.name, kind: 'avoid', shape: 'line', ...ln, w: L.width, hitAt: L.lockAt + L.fire, color: 'red', mine: ln.mine });
    }
    this.lasers = this.lasers.filter(L => L.lockAt > this.t);
    if (this.spin) {
      const sp = this.spin;
      for (; sp.next <= this.t && sp.next <= sp.end; sp.next += sp.tick) if (inside(this.spinShape(sp.next), p)) sp.hits++;
      if (this.t > sp.end) { this.result(sp.name, sp.hits === 0, sp.hits ? `부채꼴에 ${sp.hits}번 맞음` : '빈틈을 따라 회피'); this.spin = null; }
    }
    if (this.grid) {   // 무너진 칸 위에 있으면 떨어진다
      const i = this.tileAt(p.x, p.z);
      if ((i < 0 || this.tiles[i] === 2) && !(p.iframe > 0)) {
        this.result('낙하', false, '무너진 칸에서 떨어짐');
        const j = this.tiles.map((v, k) => k).filter(k => this.tiles[k] < 2).sort((a, b) => dist(this.tileRect(a), p) - dist(this.tileRect(b), p))[0];
        if (j != null) { const c = this.tileRect(j); p.x = c.x; p.z = c.z; } p.iframe = 1;
      }
    }
    if (d.duration && this.t >= d.duration) this.done = true;
    // 방 에너지와 광막
    this.energy = Math.min(d.roomEnergyMax, this.t - this.roomStart);
    const pr = roomOf(p.x, p.z);
    if (!d.noCurtain && !this.grid && pr !== this.room && !this.crossedEarly && (!this.curtain || this.t < this.curtain.open)) {
      this.crossedEarly = true; this.result('광막', false, '내 차례 전에 광막을 넘음');
    }
    const cu = this.curtain;
    if (cu && !cu.moved && this.t >= cu.open) { cu.moved = true; this.bots = this.partySpots(cu.next); }   // 파티가 먼저 넘어간다
    if (cu && this.t >= cu.close) {
      const ok = pr === cu.next;
      this.result('광막 이동', ok, ok ? `${cu.next}번 방 도착` : '에너지 120, 방 감전');
      if (cu.cont) {
        // 다음 방에서 계속: 보스·파티가 옮겨 가고 방 에너지가 0부터 다시 찬다
        this.room = cu.next; this.roomStart = cu.close; this.boss = polar(roomAngle(this.room), d.boss.dist); this.bots = this.partySpots(this.room);
        this.curtain = null; this.crossedEarly = false;
        if (!ok) Object.assign(p, polar(roomAngle(this.room), 12));
      } else this.done = true;
    }
  }
  // 따라오는 광선의 현재 선분: 대상자 위치에서 전투장 중심 쪽으로 len만큼
  laserLines(L) {
    return L.targets.map((get, k) => {
      const a = get(this), d = Math.hypot(a.x, a.z) || 1, ux = d > 0.5 ? -a.x / d : 1, uz = d > 0.5 ? -a.z / d : 0;
      return { a: { x: a.x, z: a.z }, b: { x: a.x + ux * L.len, z: a.z + uz * L.len }, mine: k === 0 };
    });
  }
  sweepShape(sw, t) {
    const a = (sw.from + sw.vel * Math.max(0, Math.min(sw.dur, t - sw.t0))) * Math.PI / 180;
    return { shape: 'line', a: { ...this.boss }, b: { x: this.boss.x + Math.cos(a) * sw.len, z: this.boss.z + Math.sin(a) * sw.len }, w: sw.width };
  }
  // 회전 부채꼴의 시각 t에서의 모양
  spinShape(t) {
    const sp = this.spin, u = t - sp.t0 - sp.warn; let ang = 0;
    for (const [a, b, v] of sp.segs) ang += Math.max(0, Math.min(u, b) - a) * v;
    const dir0 = sp.base + ang * Math.PI / 180;
    return { shape: 'multi', spots: [0, 1, 2, 3].map(k => ({ shape: 'sector', x: 0, z: 0, r: sp.r, dir: dir0 + k * Math.PI / 2, half: sp.half })) };
  }
  // 화면용: 지금 보여 줄 예고 목록
  visible() {
    const out = this.tele.filter(s => (s.showFrom ?? s.start) <= this.t && (s.showUntil ?? Infinity) > this.t).map(s => s.follow ? { ...s, x: this.player.x, z: this.player.z } : s);
    for (const o of this.orbs) out.push({ shape: 'circle', x: o.x, z: o.z, r: o.r, name: o.name, kind: 'avoid', color: 'pink', start: o.start, hitAt: o.hitAt, orb: true });
    for (const m of this.mines) out.push({ shape: 'circle', x: this.player.x, z: this.player.z, r: m.r, name: m.name, kind: 'show', color: 'blue', start: this.t, hitAt: m.lockAt });
    for (const sw of this.sweeps) out.push({ ...this.sweepShape(sw, this.t), name: sw.name, kind: 'avoid', color: 'red', start: sw.start, hitAt: this.t < sw.t0 ? sw.t0 : sw.t0 + sw.dur, live: this.t >= sw.t0 });
    if (this.crystal) out.push({ shape: 'circle', ...this.crystal.pos[this.crystal.mine], r: 4, name: `${this.crystal.name} (내 수정에서 E)`, kind: 'show', color: 'yellow', start: this.crystal.start, hitAt: this.crystal.fire });
    if (this.t < this.freezeUntil) out.push({ shape: 'circle', x: this.player.x, z: this.player.z, r: 1, name: this.freezeText, kind: 'show', color: 'pink', start: this.t, hitAt: this.freezeUntil });
    for (const C of this.cannons) for (const sh of C.shots) out.push({ shape: 'circle', ...(sh.who === 'me' ? this.player : this.bots[sh.who]), r: sh.r, name: C.name, kind: 'show', color: 'red', start: this.t, hitAt: C.lockAt });
    for (const L of this.lasers) for (const ln of this.laserLines(L)) out.push({ shape: 'line', ...ln, w: L.width, name: L.name, kind: 'show', color: 'red', start: this.t, hitAt: L.lockAt });
    if (this.spin) { const sp = this.spin; out.push({ ...this.spinShape(this.t), name: sp.name, kind: 'avoid', color: 'blue', start: sp.t0, hitAt: this.t < sp.t0 + sp.warn ? sp.t0 + sp.warn : sp.end, live: this.t >= sp.t0 + sp.warn }); }
    return out;
  }
  upcoming() { return this.pending.filter(e => e.name).map(e => ({ t: e.t, name: e.name })); }
  score() { const n = this.log.length; return { ok: this.log.filter(r => r.ok).length, total: n }; }
}
