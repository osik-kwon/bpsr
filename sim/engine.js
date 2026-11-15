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
// 시나리오 변형(예: 마스터 단계별 수식어): variants[key]의 이벤트를 더하고 제목에 꼬리표를 붙인다
export function applyVariant(data, key) {
  const v = data.variants?.[key]; if (!v) return data;
  data.events.push(...v.events); data.title += ` · ${v.label}`; return data;
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
  constructor(data, combat = null) { this.data = data; this.attackLock = false; this.combat = combat; this.tank = !!combat?.cls.tank; this.role = combat?.cls.role ?? (this.tank ? 'tank' : 'dps'); this.reset(); }
  reset() {
    const d = this.data;
    this.t = 0; this.done = false; this.log = []; this.tele = []; this.cores = []; this.markers = [];
    this.room = d.boss.room; this.energy = 0; this.crossedEarly = false; this.spin = null; this.curtain = null; this.tether = null; this.lasers = [];
    // 격자 전투장(2·3넴): 타일 상태 0 멀쩡, 1 금 감, 2 무너짐(없는 칸도 2)
    const A = d.arena; this.grid = A.type === 'grid' ? A : null; this.cannons = []; this.sweeps = []; this.crystal = null; this.mines = []; this.freezeUntil = 0; this.freezeText = ''; this.orbs = []; this.sigil = null; this.closets = null; this.links = []; this.bossY = null; this.curse = null; this.scars = new Set(); this.trees = null; this.carry = null; this.runners = []; this.ttt = null; this.presses = []; this.note = null; this.bubbles = []; this.bossFace = Math.PI / 2; this.bq = []; this.bmove = null; this.bossHoldUntil = 0; this.bossAir = 0; this.bossWalking = false; this.hazards = []; this.strikes = null; this.waves = []; this.bossScale = 1;
    if (this.grid) { this.tiles = Array.from({ length: A.cols * A.rows }, (_, i) => (A.missing ?? []).some(([c, r]) => c + r * A.cols === i) ? 2 : 0); }
    this.boss = d.boss.pos ? { x: d.boss.pos[0], z: d.boss.pos[1] } : polar(roomAngle(this.room), d.boss.dist);
    this.bossDir = (d.boss.dir ?? 90) * Math.PI / 180;
    this.clone = null;
    this.player = { ...(d.player.start ? { x: d.player.start[0], z: d.player.start[1] } : polar(roomAngle(this.room), 12)), dashCd: 0, iframe: 0, lock: 0, lockN: 0, attackTime: 0 };
    this.lockTimes = d.player.lockTimes ?? [0.6, 0.9, 1.3];
    // 파티원 7명은 보스 뒤쪽 근처에 모여 있는 고정 표식
    this.roomStart = 0; this._botInit = true; this.bots = this.partySpots(this.room);
    this.pending = d.events.map(e => ({ ...e })).sort((a, b) => a.t - b.t);
    this.combat?.reset();
  }
  result(name, ok, msg) { this.log.push({ t: +this.t.toFixed(1), name, ok, msg }); }
  // 판정 예고 등록: kind avoid=안에 있으면 실패, soak=하나 안에 있어야 성공, far=거리 safeDist 이상이어야 성공
  add(o) { this.tele.push({ start: this.t, type: this.curType, noDodge: this.curNoDodge, ...o }); }

  // 파티원 7명의 기본 자리(보스 앞에 모여 있음)
  partySpots(room) {
    if (this.data.partySpots) { const v = this.data.partySpots.map(([x, z]) => ({ x, z })); v.home = true; return v; }
    if (this.data.party === 'ring') return Array.from({ length: 7 }, (_, i) => polar(i * TAU / 7 + 0.3, 18));   // 전투장에 흩어진 배치
    // 보스 앞 탱버 원(반경 5m) 밖, 내 시작 자리 양옆
    return Array.from({ length: 7 }, (_, i) => polar(roomAngle(room) + (i < 4 ? i - 4 : i - 3) * 0.2, 11 + (i % 2))); }
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
    if (e.byNote) e = { ...e, ...(e.byNote[this.note] ?? {}) };
    if (e.move) this.bq.push({ ...e.move, at: e.t + (e.move.at ?? 0) });
    if (e.back) this.bq.push({ ...e.back, at: e.t + e.back.at });
    if (e.hold) this.bossHoldUntil = e.t + e.hold;
    if (e.rel) e = this.relEvent(e);   // 내 음표(원소)에 따라 달라지는 이벤트
    this.curType = e.fx ?? e.type; this.curNoDodge = !!e.noDodge;
    if (e.bossTo) { this.boss = { x: e.bossTo[0], z: e.bossTo[1] }; this.bmove = null; }
    if (e.bossScale) this.bossScale = e.bossScale;
    if (e.bossY != null) this.bossY = e.bossY;
    const front = polar(roomAngle(this.room), this.data.boss.dist - 8);
    if (e.type === 'tankbuster') {
      // 탱커 직업이면 보스 앞에서 내가 받아야 한다
      this.add({ name: this.tank ? `${e.name} · 내가 받기` : e.name, kind: this.tank ? 'take' : 'avoid', shape: 'circle', ...front, r: e.r, hitAt: e.t + e.cast, color: 'red' });
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
      if (this.data.botsMove) this.bots = this.bots.map((_, k) => ({ x: e.at[0] + (k % 2 ? 1 : -1) * (0.8 + (k >> 1)), z: e.at[1] + (k % 3 - 1) * 1.2 }));
      else [0, 1, 2].forEach((i, k) => { this.bots[i] = { x: e.at[0] + (k - 1) * 1.5, z: e.at[1] + (k % 2) * 1.2 }; });
      this.add({ name: e.name, kind: 'in', shape: 'circle', x: e.at[0], z: e.at[1], r: e.r, hitAt: e.t + e.cast, color: 'pink', reset: true });
    } else if (e.type === 'spread') {
      // 산개·폭탄·개인: 터질 때 모든 파티원과 r 이상 떨어져 있어야 한다. 원은 나를 따라다닌다
      if (e.bots) this.bots = e.bots.map(([x, z]) => ({ x, z }));
      this.add({ name: e.name, kind: 'alone', shape: 'circle', follow: true, x: 0, z: 0, r: e.r, hitAt: e.t + e.cast, color: e.color ?? 'yellow', reset: !!e.bots });
    } else if (e.type === 'aoe') {
      // 정해진 자리에 깔리는 원형 장판(탱버, 번개 등)
      // 탱커 직업: carry는 나를 따라오는 탱버를 본대에서 떼어 놓고, drop은 내가 선 자리에 깔린 원에서 나온다
      if (this.tank && e.tank === 'carry') this.add({ name: `${e.name} · 내가 받기`, kind: 'alone', shape: 'circle', follow: true, x: 0, z: 0, r: e.spots[0][2], hitAt: e.t + e.cast, color: 'red' });
      else if (this.tank && e.tank === 'drop') this.add({ name: e.name, kind: 'avoid', shape: 'circle', x: this.player.x, z: this.player.z, r: e.spots[0][2], hitAt: e.t + e.cast, color: e.color ?? 'red' });
      else this.add({ name: e.name, kind: e.kind ?? 'avoid', shape: 'multi', spots: e.spots.map(([x, z, r]) => ({ shape: 'circle', x, z, r })), hitAt: e.t + e.cast, color: e.color ?? 'red' });
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
    } else if (e.type === 'sectors') {
      // 부채꼴 여러 장: center에서 dirs(도) 방향으로 반각 half(도)인 부채꼴이 동시에 터진다
      const [x, z] = e.center ?? [this.boss.x, this.boss.z];
      this.add({ name: e.name, kind: 'avoid', shape: 'multi', spots: e.dirs.map(d => ({ shape: 'sector', x, z, r: e.r, dir: d * Math.PI / 180, half: e.half * Math.PI / 180 })), hitAt: e.t + e.cast, showFrom: e.showFrom, color: e.color ?? 'red' });
    } else if (e.type === 'bubbles') {
      this.bubbles = e.spots.map(([x, z, note]) => ({ x, z, note }));
    } else if (e.type === 'noteDrop') {
      // 흩어지기: 발밑 원이 터지며 각자 자기 음표 색 물방울을 그 자리에 떨군다
      if (e.bots) this.bots = e.bots.map(([x, z]) => ({ x, z }));
      this.add({ name: e.name, kind: 'noteDrop', shape: 'circle', follow: true, x: 0, z: 0, r: e.r, hitAt: e.t + e.cast, color: 'yellow' });
    } else if (e.type === 'bubbleCheck') {
      this.add({ name: e.name, kind: 'bubble', shape: 'circle', follow: true, x: 0, z: 0, r: e.r ?? 3, hitAt: e.t + e.cast, color: 'pink', quietShape: true });
    } else if (e.type === 'note') {
      this.note = e.value;
    } else if (e.type === 'noteShare') {
      // 두 원소 분담: 어느 한 원에 들어가야 하고, 들어간 원의 원소로 내 음표가 바뀐다
      this.add({ name: e.name, kind: 'noteShare', shape: 'multi', spots: Object.entries(e.spots).map(([k, [x, z]]) => ({ shape: 'circle', x, z, r: e.r, note: k })), hitAt: e.t + e.cast, color: 'pink' });
    } else if (e.type === 'hazards') {
      // 밟으면 안 되는 자리(꽃잎 등): [x, z, 반경]
      for (const [x, z, r] of e.spots) this.hazards.push({ x, z, r, start: e.t, label: e.name });
    } else if (e.type === 'press') {
      // 지정한 자리 곁에서 cast초 안에 상호작용
      this.presses.push({ name: e.name, x: e.at[0], z: e.at[1], start: e.t, hitAt: e.t + e.cast, okMsg: e.okMsg, failMsg: e.failMsg });
    } else if (e.type === 'towers') {
      // 틱택토 탑: 3×3 칸(간격 spacing)에 파란 탑이 서고, 이번 배치 중 하나의 대각 자리에서 hold초 서 있으면 금색으로 빼앗는다. cast초 뒤 남은 파란 탑이 터지고 줄을 검사한다
      this.ttt ??= { grid: Array(9).fill(0), sp: e.spacing ?? 13 };
      for (const c of e.cells) this.ttt.grid[c] = 1;
      this.ttt.round = { name: e.name, cells: e.cells, start: e.t, until: e.t + e.steal, hitAt: e.t + e.cast, hold: e.hold, r: e.r, last: !!e.last, holdT: 0, holdCell: null, stolen: null };
    } else if (e.type === 'shapes') {
      // 임의 도형 묶음: spots에 도형을 그대로 적는다(circle·ring·sector·line·rect). kind 기본은 피하기
      this.add({ name: e.name, kind: e.kind ?? 'avoid', shape: 'multi', spots: e.spots, hitAt: e.t + e.cast, showFrom: e.showFrom, color: e.color ?? 'red', okMsg: e.okMsg, failMsg: e.failMsg, setNote: e.setNote });
    } else if (e.type === 'carry') {
      // 운반: pick에서 상호작용해 들고 drop에서 상호작용해 놓는다. cast초 안에 못 하면 실패
      this.carry = { name: e.name, pick: { x: e.pick[0], z: e.pick[1] }, drop: { x: e.drop[0], z: e.drop[1] }, have: false, start: e.t, hitAt: e.t + e.cast, pickMsg: e.pickMsg, dropMsg: e.dropMsg };
    } else if (e.type === 'intercept') {
      // 굴러가는 구체: from에서 to로 dur초 동안 움직인다. want[역할]이 in이면 몸으로 막아야 하고 out이면 닿으면 안 된다
      this.runners.push({ name: e.name, a: { x: e.from[0], z: e.from[1] }, b: { x: e.to[0], z: e.to[1] }, t0: e.t, dur: e.dur, r: e.r, want: e.want[this.role] ?? 'any', touched: false, okMsg: e.okMsg, failMsg: e.failMsg });
    } else if (e.type === 'trees') {
      // 치유의 나무: 충전된 나무 곁에서 상호작용하면 내 상흔이 모두 지워지고 recharge초 동안 꺼진다
      this.trees = { pos: e.pos.map(([x, z]) => ({ x, z, readyAt: 0 })), recharge: e.recharge, r: e.r ?? 3.5 };
    } else if (e.type === 'scarHit') {
      // 상흔 공격: 터질 때 범위 안이면 scar(색 목록)를 얻는다. want[역할]이 in이면 맞아야 하고 out이면 피해야 하며 any면 판정하지 않는다
      this.add({ name: e.name, kind: 'scar', shape: 'multi', spots: e.spots, hitAt: e.t + e.cast, color: e.color ?? 'red', scar: e.scar, want: e.want[this.role] ?? 'any', okMsg: e.okMsg, failMsg: e.failMsg });
    } else if (e.type === 'pounce') {
      // 급습: 상흔이 하나도 없는 사람을 노린다. 탱커가 아닌데 상흔이 없으면 실패
      this.add({ name: e.name, kind: 'pounce', shape: 'circle', follow: true, x: 0, z: 0, r: e.r, hitAt: e.t + e.cast, color: 'red' });
    } else if (e.type === 'cleanseCheck') {
      this.add({ name: e.name, kind: 'cleanse', shape: 'circle', x: e.at[0], z: e.at[1], r: e.r ?? 3.5, hitAt: e.t + e.cast, color: 'blue' });
    } else if (e.type === 'hunt') {
      // 사냥: 도약 순간 지정한 충전 나무의 풀 위에 서 있어야 한다(미리 흔들면 무효)
      const tr = this.trees.pos[e.tree]; for (const x of this.trees.pos) x.readyAt = 0;
      this.add({ name: e.name, kind: 'hunt', shape: 'circle', x: tr.x, z: tr.z, r: e.r ?? 3, hitAt: e.t + e.cast, color: 'blue', tree: e.tree });
    } else if (e.type === 'lineup') {
      // 줄 서기: 직사각형 위에 서되 파티원과 gap 이상 떨어져야 한다
      if (e.bots) this.bots = e.bots.map(([x, z]) => ({ x, z }));
      this.add({ name: e.name, kind: 'lineup', shape: 'line', a: { x: e.from[0], z: e.from[1] }, b: { x: e.to[0], z: e.to[1] }, w: e.width, gap: e.gap, hitAt: e.t + e.cast, color: 'pink', reset: !!e.bots });
    } else if (e.type === 'safe') {
      // 안전지대: 터질 때 지정한 원(spots) 가운데 하나 안에 있어야 한다
      this.add({ name: e.name, kind: 'soak', shape: 'multi', spots: e.ring ? [{ shape: 'ring', x: 0, z: 0, rIn: e.ring[0], rOut: e.ring[1] }] : e.spots.map(([x, z]) => ({ shape: 'circle', x, z, r: e.r })), hitAt: e.t + e.cast, color: e.color ?? 'blue', okMsg: e.okMsg, failMsg: e.failMsg, label: e.label ?? '안전' });
    } else if (e.type === 'rects') {
      // 직사각형 여러 장(십자 범위 등): [x, z, 가로, 세로]
      this.add({ name: e.name, kind: 'avoid', shape: 'multi', spots: e.rects.map(([x, z, w, h]) => ({ shape: 'rect', x, z, w, h })), hitAt: e.t + e.cast, color: e.color ?? 'red' });
    } else if (e.type === 'curse') {
      // 저주 옷장: 내 옷장에서 상호작용해 저주를 받아 오고, 터질 때 전투장 가장자리(edge 이상)·옷장에서 away 이상 떨어져 있어야 한다. 터진 자리에 독 장판이 남는다
      this.curse = { name: e.name, at: { x: e.pos[0], z: e.pos[1] }, hitAt: e.t + e.charge, start: e.t, taken: false, edge: e.edge, away: e.away, poison: e.poison, others: e.others ?? [] };
    } else if (e.type === 'clearHazards') {
      this.hazards = [];
    } else if (e.type === 'strikes') {
      // 번호 순 강타: order 순서(파티원 번호 또는 'me')로 한 명씩 원(r) 강타 뒤 그 자리에서 오른쪽 반면(sweepR) 휩쓸기. 두 번 이상 맞으면 실패
      if (e.bots) this.bots = e.bots.map(([x, z]) => ({ x, z }));
      this.strikes = { name: e.name, order: e.order, t0: e.t + e.cast, gap: e.gap, r: e.r, sr: e.sweepR, sd: e.sweepDelay, lock: e.lock ?? 0.6, start: e.t, hits: 0, cur: null, reset: !!e.bots };
    } else if (e.type === 'tide') {
      // 해일·벽: from에서 to로 dur초 동안 밀려오는 띠(두께 thick, 폭 span). 닿으면 실패
      this.waves.push({ name: e.name, a: { x: e.from[0], z: e.from[1] }, b: { x: e.to[0], z: e.to[1] }, t0: e.t + e.warn, dur: e.dur, thick: e.thick, span: e.span, start: e.t, hits: 0, noDodge: !!e.noDodge });
    } else if (e.type === 'link') {
      // 약화 연결: 가장 먼 파티원과 줄로 이어지고, r 안으로 다가가면 풀린다
      const bot = this.bots.reduce((m, b, i) => dist(b, this.player) > dist(this.bots[m], this.player) ? i : m, 0);
      this.links.push({ name: e.name, bot, r: e.r, start: e.t, until: e.t + e.dur });
    } else if (e.type === 'sigil') {
      // 징표: 든 사람이 purify초 뒤 강타를 맞는다. 탱커가 아니면 탱커 파티원(bot) 곁에서 상호작용으로 넘기고, 탱커면 파티원이 넘겨 준 징표를 들고 버틴다
      this.sigil = { name: e.name, bot: e.bot, hitAt: e.t + e.purify, start: e.t, mine: !this.tank, r: e.r ?? 4 };
    } else if (e.type === 'closets') {
      // 옷장: 곁에서 상호작용하면 맞은편 옷장으로 순간이동한다
      this.closets = { pos: e.pos.map(([x, z]) => ({ x, z })), until: e.t + e.dur, r: e.r ?? 3.5 };
      this.markers = this.closets.pos.map((c, i) => ({ ...c, label: '옷장' }));
    } else if (e.type === 'sweep') {
      // 반쪽 휩쓸기: 보스에서 나온 긴 광선이 from에서 vel(도/초)로 dur초 동안 돈다. 대시 무적으로 넘을 수 있다
      this.sweeps.push({ name: e.name, t0: e.t + e.warn, start: e.t, from: e.from, vel: e.vel, dur: e.dur, len: e.len, width: e.width, hits: 0, block: e.block ?? 0, inT: 0, origin: e.origin ? { x: e.origin[0], z: e.origin[1] } : null, noDodge: !!e.noDodge });
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
    if (s.kind === 'avoid') { const hit = inside(s, p) && !safe; if (hit && s.setNote) this.note = s.setNote; if (!s.quiet || hit) this.result(s.name, !hit, hit ? (s.setNote ? `맞아서 내 음표가 ${s.setNote}(으)로 바뀜` : '범위 안에서 맞음') : '회피'); }
    else if (s.kind === 'noteDrop') { const dmin = Math.min(...this.bots.map(b => dist(b, p))), ok = dmin >= s.r, N = this.data.partyNotes ?? [];
      this.result(s.name, ok, ok ? `흩어져서 내 물방울을 따로 떨굼(가장 가까운 팀원 ${dmin.toFixed(0)}m)` : `팀원과 너무 가까움 ${dmin.toFixed(0)}m — 물방울이 겹침`);
      this.bubbles = [{ x: p.x, z: p.z, note: this.note, mine: true }, ...this.bots.map((b, i) => ({ x: b.x, z: b.z, note: N[i] }))]; this.bots = this.partySpots(this.room); }
    else if (s.kind === 'bubble') { const b = this.bubbles.find(b => dist(b, p) <= s.r), ok = !!b && b.note === this.note; this.result(s.name, ok, ok ? `${this.note} 물방울 안에서 버팀` : b ? `다른 색(${b.note}) 물방울에 들어감 — 즉사` : '물방울 밖 — 치사'); this.bubbles = []; }
    else if (s.kind === 'noteShare') { const c = s.spots.find(c => inside(c, p)); if (c) this.note = c.note; this.result(s.name, !!c, c ? `${c.note} 원에서 분담 — 내 음표가 ${c.note}(으)로` : '어느 원에도 없음 — 전체 피해'); }
    else if (s.kind === 'scar') { const hit = inside(s, p); if (hit) for (const c of s.scar) this.scars.add(c);
      if (s.want !== 'any') { const ok = hit === (s.want === 'in'); this.result(s.name, ok, ok ? (s.okMsg ?? (hit ? '맞아서 상흔을 받음' : '회피')) : (s.failMsg ?? (hit ? '맞으면 안 되는 역할인데 맞음' : '내 역할이 받아야 하는데 피함'))); } }
    else if (s.kind === 'pounce') { const ok = this.role === 'tank' || this.scars.size > 0; if (this.role === 'tank') this.scars.add('붉은'); this.result(s.name, ok, this.role === 'tank' ? '탱커가 받아냄(붉은 상흔)' : ok ? '상흔이 있어 대상에서 빠짐' : '상흔이 없어 급습 대상이 됨 — 즉사'); }
    else if (s.kind === 'cleanse') { const ok = this.scars.size === 0; this.result(s.name, ok, ok ? '나무로 상흔을 지움' : `상흔이 남음: ${[...this.scars].join('·')}`); }
    else if (s.kind === 'hunt') { const tr = this.trees.pos[s.tree], ok = inside(s, p) && tr.readyAt <= this.t; tr.readyAt = this.t + this.trees.recharge; this.result(s.name, ok, ok ? '보스가 나무에 부딪혀 비틀거림' : inside(s, p) ? '나무를 미리 흔들어 무효' : '충전된 나무의 풀 밖 — 즉사'); }
    else if (s.kind === 'lineup') { const dmin = Math.min(...this.bots.map(b => dist(b, p))), on = inside(s, p), ok = on && dmin >= s.gap; this.result(s.name, ok, ok ? '줄에 서서 구체를 막음' : on ? `파티원과 원이 겹침 ${dmin.toFixed(0)}m (${s.gap}m 이상)` : '직사각형 밖 — 구체가 보스에 닿아 격노'); if (s.reset) this.bots = this.partySpots(this.room); }
    else if (s.kind === 'take') { const ok = inside(s, p); this.result(s.name, ok, ok ? '탱버를 받아냄' : '탱버 자리를 비움(탱커가 보스 앞에서 받아야 함)'); }
    else if (s.kind === 'far') { const d = dist(p, s); const ok = d >= s.r; this.result(s.name, ok, ok ? `거리 ${d.toFixed(0)}m` : `너무 가까움 ${d.toFixed(0)}m (${s.r}m 이상)`); }
    else if (s.kind === 'in') { const ok = inside(s, p); this.result(s.name, ok, ok ? '쉐어 참여, 팀원 생존' : '쉐어 밖, 인원이 모자라 팀원 사망'); if (s.reset) this.bots = this.partySpots(this.room); }
    else if (s.kind === 'alone') { const dmin = Math.min(...this.bots.map(b => dist(b, p))); const ok = dmin >= s.r; this.result(s.name, ok, ok ? `가장 가까운 팀원 ${dmin.toFixed(0)}m` : `팀원과 너무 가까움 ${dmin.toFixed(0)}m (${s.r}m 이상)`); if (s.reset) this.bots = this.partySpots(this.room); }
    else if (s.kind === 'soak') { const n = s.spots.filter(c => inside(c, p)).length; this.result(s.name, n === 1, n === 1 ? (s.okMsg ?? '쉐어 참여') : n ? '쉐어 겹침(치유 감소 중첩)' : (s.failMsg ?? '쉐어 밖')); if (s.reset) this.bots = this.partySpots(this.room); }
  }

  // 전투장 밖으로 나가지 못하게 한다
  clamp(p) {
    const d = this.data;
    if (this.grid) { const g = this.grid, X = g.cols * g.tileW / 2 + 1.5, Z = g.rows * g.tileH / 2 + 1.5; p.x = Math.max(-X, Math.min(X, p.x)); p.z = Math.max(-Z, Math.min(Z, p.z)); }
    else { const r = Math.hypot(p.x, p.z), R = d.arena.radius - 0.5; if (r > R) { p.x *= R / r; p.z *= R / r; } }
  }
  // input: {mx, mz} 정규화된 이동 방향, dash 불리언. 직업(combat)이 있으면 atk(누르고 있음)·skill(이번에 누른 스킬 ID)도 받는다
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
    if (this.combat) {
      // 직업 조작: 동작이 강제하는 이동(회피·미끄러지기)과 이동 입력을 합친다
      const m = this.t < this.freezeUntil ? { free: false, dx: 0, dz: 0 } : this.combat.step(dt, input, this);
      if (l > 0 && m.free) { m.dx += input.mx / l * d.player.speed * dt; m.dz += input.mz / l * d.player.speed * dt; }
      if (m.dx || m.dz) { p.x += m.dx; p.z += m.dz; this.clamp(p); }
    } else {
    if (p.lock > 0) { p.lock -= dt; p.attackTime += dt; if (canDash) p.lock = 0; }
    else if (this.attackLock && l === 0) { p.lock = this.lockTimes[p.lockN++ % this.lockTimes.length]; }
    if (l > 0 && !(p.lock > 0)) {
      let step = d.player.speed * dt;
      if (canDash) { step += d.player.dashDist; p.dashCd = d.player.dashCd; p.iframe = d.player.dashIframe; }
      p.x += input.mx / l * step; p.z += input.mz / l * step; this.clamp(p);
    }
    }
    while (this.pending.length && this.pending[0].t <= this.t) this.spawn(this.pending.shift());
    this.moveBoss(dt); this.moveBots(dt);
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
    // 물방울: 다른 색 물방울의 범위에 닿으면 내 음표가 그 색으로 바뀐다
    for (const b of this.bubbles) { const i = dist(b, p) <= 3; if (i && !b.in && this.note && b.note !== this.note) this.note = b.note; b.in = i; }
    // 상호작용 과제
    for (const pr of this.presses) {
      if (input.interact && dist(pr, p) <= 3.5) { this.result(pr.name, true, pr.okMsg ?? `${(this.t - pr.start).toFixed(1)}초 만에 처리`); pr.done = true; }
      else if (this.t >= pr.hitAt) { this.result(pr.name, false, pr.failMsg ?? '시간 안에 처리하지 못함'); pr.done = true; }
    }
    this.presses = this.presses.filter(x => !x.done);
    // 틱택토 탑
    const tt = this.ttt, rd = tt?.round;
    if (rd) {
      if (rd.stolen == null && this.t < rd.until) {
        const c = rd.cells.find(c => dist(this.tttSpot(c), p) <= 1.5), still = !input.mx && !input.mz;
        if (c != null && still) { if (rd.holdCell === c) rd.holdT += dt; else { rd.holdCell = c; rd.holdT = 0; } if (rd.holdT >= rd.hold) { tt.grid[c] = 2; rd.stolen = c; } } else { rd.holdCell = null; rd.holdT = 0; }
      }
      if (this.t >= rd.hitAt) {
        const blues = rd.cells.filter(c => tt.grid[c] === 1), hit = blues.some(c => dist(this.tttCell(c), p) <= rd.r);
        this.result(`${rd.name} 충전 폭발`, !hit, hit ? '파란 탑 폭발에 맞음' : rd.stolen == null ? '폭발은 피했지만 탑을 빼앗지 못함' : '탑 하나를 금색으로 빼앗고 폭발 회피');
        const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]], line = v => L.some(q => q.every(i => tt.grid[i] === v));
        if (line(1)) this.result('신벌 프로토콜', false, '파란 탑 3개가 일렬 — 전멸');
        else if (line(2)) this.result('프로토콜 붕괴', true, '금색 탑 3개 일렬 — 보스 정지, 딜 타임');
        else if (rd.last) this.result('프로토콜 붕괴', false, '금색 줄을 만들지 못함');
        tt.round = null; if (rd.last || line(1) || line(2)) this.ttt = null;
      }
    }
    // 운반
    const ca = this.carry;
    if (ca) {
      if (input.interact) { if (!ca.have && dist(ca.pick, p) <= 3.5) ca.have = true; else if (ca.have && dist(ca.drop, p) <= 3.5) { this.result(ca.name, true, `${(this.t - ca.start).toFixed(0)}초 만에 완료`); this.carry = null; } }
      if (this.carry && this.t >= ca.hitAt) { this.result(ca.name, false, ca.have ? '들고만 있다가 시간 초과' : '시간 안에 하지 못함'); this.carry = null; }
    }
    // 굴러가는 구체
    for (const r of this.runners) {
      const c = this.runnerPos(r);
      if (!r.touched && this.t >= r.t0 && dist(c, p) <= r.r) { r.touched = true; r.end = this.t; }
      if (r.touched || this.t >= r.t0 + r.dur) { if (r.want !== 'any') { const ok = r.touched === (r.want === 'in'); this.result(r.name, ok, ok ? (r.okMsg ?? (r.touched ? '몸으로 막음' : '닿지 않음')) : (r.failMsg ?? (r.touched ? '닿으면 안 되는 역할인데 닿음' : '막지 못해 폭발'))); } r.done = true; }
    }
    this.runners = this.runners.filter(r => !r.done);
    // 치유의 나무
    if (this.trees && input.interact) { const tr = this.trees.pos.find(x => dist(x, p) <= this.trees.r && x.readyAt <= this.t); if (tr) { this.scars.clear(); tr.readyAt = this.t + this.trees.recharge; } }
    // 저주 옷장과 독 장판
    const cz = this.curse;
    if (cz) {
      if (!cz.taken && input.interact && dist(cz.at, p) <= 3.5) cz.taken = true;
      if (this.t >= cz.hitAt) {
        const d = Math.hypot(p.x, p.z), dc = this.closets ? Math.min(...this.closets.pos.map(c => dist(c, p))) : 99;
        if (!cz.taken) this.result(cz.name, false, '저주를 받아 오지 않아 옷장에서 크게 폭발');
        else { const ok = d >= cz.edge && dc >= cz.away; this.result(cz.name, ok, ok ? `가장자리에서 터뜨림(중심에서 ${d.toFixed(0)}m)` : d < cz.edge ? `전투 자리에 너무 가까움(중심에서 ${d.toFixed(0)}m, ${cz.edge}m 이상)` : `옷장에 너무 가까움 ${dc.toFixed(0)}m`); this.hazards.push({ x: p.x, z: p.z, r: cz.poison, in: true, start: this.t }); }
        for (const [x, z] of cz.others) this.hazards.push({ x, z, r: cz.poison, start: this.t });
        this.curse = null;
      }
    }
    for (const h of this.hazards) { const i = dist(h, p) <= h.r; if (i && !h.in) this.result(h.label ?? '독 장판', false, '밟으면 안 되는 자리를 밟음'); h.in = i; }
    // 번호 순 강타
    const sk = this.strikes;
    if (sk) {
      const k = Math.max(0, Math.floor((this.t - sk.t0 + sk.lock) / sk.gap));
      if (this.t >= sk.t0 - sk.lock && k < sk.order.length && sk.cur?.k !== k && !(sk.cur && !sk.cur.swept)) {
        const who = sk.order[k], tp = who === 'me' ? p : this.bots[who];
        sk.cur = { k, me: who === 'me', x: tp.x, z: tp.z, face: Math.atan2(tp.z - this.boss.z, tp.x - this.boss.x), T: sk.t0 + k * sk.gap };
        this.bq.push({ to: [tp.x, tp.z], mode: 'dash', at: sk.cur.T - 0.15, dur: 0.15, stop: 2 });
      }
      const c = sk.cur;
      if (c) {
        if (!c.hit && this.t >= c.T) { c.hit = true; if (dist(c, p) <= sk.r && !(p.iframe > 0 && !c.me)) sk.hits++; }
        if (!c.swept && this.t >= c.T + sk.sd) { c.swept = true; if (inside(this.strikeSweep(c), p) && !(p.iframe > 0)) sk.hits++;
          if (c.k === sk.order.length - 1) { this.result(sk.name, sk.hits <= 1, sk.hits <= 1 ? `${sk.hits}번 맞음(내 차례 강타만)` : `${sk.hits}번 맞음 — 두 번 이상이면 즉사`); if (sk.reset) this.bots = this.partySpots(this.room); this.strikes = null; this.bq.push({ to: 'home', mode: 'jump', at: this.t + 1, dur: 0.8 }); } }
      }
    }
    // 해일·벽
    for (const w of this.waves) {
      if (this.t >= w.t0 && this.t <= w.t0 + w.dur && inside(this.waveShape(w, this.t), p) && !(p.iframe > 0 && !w.noDodge)) { if (!w.in) w.hits++; w.in = true; } else w.in = false;
      if (this.t > w.t0 + w.dur) { this.result(w.name, w.hits === 0, w.hits ? '밀려오는 띠에 닿음' : '뒤로 넘어가 회피'); w.done = true; }
    }
    this.waves = this.waves.filter(w => !w.done);
    // 약화 연결
    for (const k of this.links) {
      const near = dist(this.bots[k.bot], p) <= k.r;
      if (near || this.t >= k.until) { this.result(k.name, near, near ? `${(this.t - k.start).toFixed(1)}초 만에 연결 해제` : '끝까지 이어져 대미지 감소 유지'); k.done = true; }
    }
    this.links = this.links.filter(k => !k.done);
    // 징표 넘기기
    const sg = this.sigil;
    if (sg) {
      const tk = this.bots[sg.bot];
      if (sg.mine && !this.tank && input.interact && dist(tk, p) <= sg.r) sg.mine = false;
      if (this.t >= sg.hitAt) {
        if (this.tank) this.result(sg.name, true, '징표를 넘겨받아 강타를 받아냄(생존기 필요)');
        else this.result(sg.name, !sg.mine, sg.mine ? '징표를 든 채 강타를 맞음' : '탱커에게 징표를 넘김');
        this.sigil = null;
      }
    }
    // 옷장 순간이동
    const cl = this.closets;
    if (cl) {
      if (input.interact) { const i = cl.pos.findIndex(c => dist(c, p) <= cl.r); if (i >= 0) { const o = cl.pos[(i + cl.pos.length / 2) % cl.pos.length]; p.x = o.x; p.z = o.z; } }
      if (this.t >= cl.until) { this.closets = null; this.markers = []; }
    }
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
      if (this.t >= sw.t0 && this.t <= sw.t0 + sw.dur && !sw.block && inside(this.sweepShape(sw, this.t), p) && !(p.iframe > 0 && !sw.noDodge)) { if (!sw.in) sw.hits++; sw.in = true; } else sw.in = false;
      if (sw.block && this.t >= sw.t0 && this.t <= sw.t0 + sw.dur && inside(this.sweepShape(sw, this.t), p)) sw.inT += dt;
      if (sw.block && this.t > sw.t0 + sw.dur) { const f = sw.inT / sw.dur; this.result(sw.name, f >= sw.block, `광선을 ${Math.round(f * 100)}% 동안 막음(${Math.round(sw.block * 100)}% 이상 필요)`); sw.done = true; }
      else if (this.t > sw.t0 + sw.dur) { this.result(sw.name, sw.hits === 0, sw.hits ? `광선에 ${sw.hits}번 맞음` : '광선을 넘어 회피'); sw.done = true; }
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
  tttCell(c) { const sp = this.ttt.sp; return { x: (c % 3 - 1) * sp, z: (Math.floor(c / 3) - 1) * sp }; }
  tttSpot(c) { const o = this.tttCell(c); return { x: o.x + 3, z: o.z + 3 }; }
  // 보스가 노리는 대상: 내가 탱커면 나, 아니면 탱커 파티원
  // 파티원 위치: botsMove 시나리오에서는 값을 넣으면 순간이동하지 않고 그 자리로 걸어간다(기본 배치를 넣으면 역할별 대형으로 돌아간다)
  get bots() { return this._bots; }
  set bots(v) {
    if (!this.data.botsMove || !this._bots || this._botInit) { this._bots = v; this._goal = null; this._botInit = false; }
    else this._goal = v.home ? null : v.map(q => ({ ...q }));
  }
  botRoles() { const r = this.data.partyRoles; return (Array.isArray(r) ? r : r?.[this.role]) ?? []; }
  // 역할별 대형: 탱커는 보스 앞, 근딜은 보스 뒤, 원딜·힐러는 뒤쪽 양옆 멀찍이
  formation(i, role) {
    const b = this.boss, f = this.bossFace, R = this.data.boss.reach ?? 5, sg = i % 2 ? 1 : -1, at = (a, d) => ({ x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d });
    if (this.bossScale !== 1) { const h = this.data.partySpots[i]; return { x: h[0], z: h[1] }; }
    if (role === '탱') return at(f, R);
    if (role === '근딜') return at(f + Math.PI + sg * 0.5, R);
    if (role === '힐') return at(f + Math.PI + sg * 1.0, 11);
    return at(f + Math.PI - sg * 1.2, 13);
  }
  moveBots(dt) {
    if (!this.data.botsMove) return;
    const roles = this.botRoles(), Rr = (this.data.arena.radius ?? 30) - 1.5, sp = (this.data.player.speed ?? 6) * dt;
    const soon = this.tele.filter(s => s.kind === 'avoid' && (s.showFrom ?? s.start) <= this.t && s.hitAt - this.t <= 3 && !s.follow);
    const bad = q => soon.some(s => inside(s, q));
    this._bots.forEach((b, i) => {
      let g = this._goal?.[i] ?? this.formation(i, roles[i]);
      if (bad(b) || bad(g)) {   // 장판 안이면 가장 가까운 안전한 자리로
        let best = null;
        for (let k = 0; k < 16; k++) for (const d of [3, 6, 9, 13, 18]) { const q = { x: b.x + Math.cos(k * TAU / 16) * d, z: b.z + Math.sin(k * TAU / 16) * d }; if (Math.hypot(q.x, q.z) > Rr || bad(q)) continue; if (!best || d < best.d) best = { ...q, d }; }
        if (best && bad(b)) g = best; else if (bad(g)) g = b;
      }
      const dx = g.x - b.x, dz = g.z - b.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { const st = Math.min(sp, l); b.x += dx / l * st; b.z += dz / l * st; const r = Math.hypot(b.x, b.z); if (r > Rr) { b.x *= Rr / r; b.z *= Rr / r; } }
    });
  }
  // 보스 이동: 예약된 돌진·도약·순간이동을 처리하고, 한가할 때 탱커(나)를 따라온다
  moveBoss(dt) {
    const B = this.data.boss, b = this.boss;
    const i = this.bq.findIndex(m => m.at <= this.t);
    if (i >= 0) { const m = this.bq.splice(i, 1)[0], to = this.bossTarget(m.to), d = dist(to, b) || 1, k = Math.max(0, d - (m.stop ?? 0)) / d;
      this.bmove = { from: { ...b }, to: { x: b.x + (to.x - b.x) * k, z: b.z + (to.z - b.z) * k }, t0: this.t, dur: m.dur ?? 0.5, mode: m.mode ?? 'dash' }; }
    let look = this.aggro(); this.bossWalking = false; this.bossAir = 0;
    const mv = this.bmove;
    if (mv) {
      const u = Math.min(1, (this.t - mv.t0) / mv.dur);
      if (mv.mode !== 'blink' || u >= 1) { this.boss = { x: mv.from.x + (mv.to.x - mv.from.x) * u, z: mv.from.z + (mv.to.z - mv.from.z) * u }; }
      if (mv.mode === 'jump') this.bossAir = Math.sin(Math.PI * u);
      if (mv.mode === 'walk') this.bossWalking = true;
      if (dist(mv.to, mv.from) > 0.5) look = mv.to;
      if (u >= 1) this.bmove = null;
    } else if (this.tank && B.chase !== false && this.t >= this.bossHoldUntil && this.bossScale === 1 && this.data.noCurtain) {
      const g = this.player, d = dist(g, b), reach = B.reach ?? 5;
      if (d > reach + 0.5) { const st = Math.min((B.speed ?? 3) * dt, d - reach); this.boss = { x: b.x + (g.x - b.x) / d * st, z: b.z + (g.z - b.z) / d * st }; this.bossWalking = true; }
    }
    if (dist(look, this.boss) > 0.3 && this.bossScale === 1) {
      const want = Math.atan2(look.z - this.boss.z, look.x - this.boss.x); let da = (want - this.bossFace) % TAU; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
      const mx = (B.turn ?? 240) * Math.PI / 180 * dt; this.bossFace += Math.max(-mx, Math.min(mx, da));
    }
  }
  aggro() { return (this.tank ? null : this.bots[this.data.tankBot ?? 0]) ?? this.player; }
  bossTarget(to) {
    if (Array.isArray(to)) return { x: to[0], z: to[1] };
    if (to === 'me') return { ...this.player }; if (to === 'aggro') return { ...this.aggro() };
    if (to === 'home') { const h = this.data.boss.pos ?? [0, 0]; return { x: h[0], z: h[1] }; }
    if (to?.bot != null) return { ...this.bots[to.bot] }; if (to?.tree != null) return { ...this.trees.pos[to.tree] };
    return { x: 0, z: 0 };
  }
  // rel 이벤트: 보스가 기본 자리에서 아래(+z)를 보고 있다고 치고 적은 도형을, 지금 보스 자리와 대상 방향에 맞춰 옮긴다
  relEvent(e) {
    const h = this.data.boss.pos ?? [0, 0], g = this.aggro(), a = Math.atan2(g.z - this.boss.z, g.x - this.boss.x), rot = a - Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
    const P = q => { const dx = q.x - h[0], dz = q.z - h[1]; return { x: this.boss.x + dx * c - dz * s, z: this.boss.z + dx * s + dz * c }; };
    const S = q => q.shape === 'line' ? { ...q, a: P(q.a), b: P(q.b) } : q.shape === 'sector' ? { ...q, ...P(q), dir: q.dir + rot } : { ...q, ...P(q) };
    const out = { ...e };
    if (Array.isArray(e.spots) && e.spots[0]?.shape) out.spots = e.spots.map(S);
    if (e.type === 'sectors') { const o = P({ x: (e.center ?? h)[0], z: (e.center ?? h)[1] }); out.center = [o.x, o.z]; out.dirs = e.dirs.map(d => d + rot * 180 / Math.PI); }
    return out;
  }
  runnerPos(r) { const u = Math.max(0, Math.min(1, (this.t - r.t0) / r.dur)); return { x: r.a.x + (r.b.x - r.a.x) * u, z: r.a.z + (r.b.z - r.a.z) * u }; }
  strikeSweep(c) { return { shape: 'sector', x: c.x, z: c.z, r: this.strikes.sr, dir: c.face - Math.PI * 2 / 3, half: Math.PI / 2 }; }
  waveShape(w, t) {
    const u = Math.max(0, Math.min(1, (t - w.t0) / w.dur)), cx = w.a.x + (w.b.x - w.a.x) * u, cz = w.a.z + (w.b.z - w.a.z) * u;
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, l = Math.hypot(dx, dz) || 1, px = -dz / l * w.span / 2, pz = dx / l * w.span / 2;
    return { shape: 'line', a: { x: cx - px, z: cz - pz }, b: { x: cx + px, z: cz + pz }, w: w.thick };
  }
  sweepShape(sw, t) {
    const a = (sw.from + sw.vel * Math.max(0, Math.min(sw.dur, t - sw.t0))) * Math.PI / 180;
    const o = sw.origin ?? this.boss;
    return { shape: 'line', a: { x: o.x, z: o.z }, b: { x: o.x + Math.cos(a) * sw.len, z: o.z + Math.sin(a) * sw.len }, w: sw.width };
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
    for (const b of this.bubbles) out.push({ shape: 'circle', x: b.x, z: b.z, r: 3, name: `${b.note} 물방울`, kind: 'show', color: b.note === '물' ? 'blue' : 'white', start: 0, hitAt: 9999 });
    for (const pr of this.presses) out.push({ shape: 'circle', x: pr.x, z: pr.z, r: 3.5, name: `${pr.name} (여기서 E)`, kind: 'show', color: 'green', start: pr.start, hitAt: pr.hitAt });
    if (this.ttt) { const tt = this.ttt, rd = tt.round;
      tt.grid.forEach((v, c) => { if (v) out.push({ shape: 'circle', ...this.tttCell(c), r: 2, name: v === 2 ? '금색 탑' : '파란 탑', kind: 'show', color: v === 2 ? 'yellow' : 'blue', start: 0, hitAt: 9999 }); });
      if (rd) { for (const c of rd.cells) { if (tt.grid[c] === 1) out.push({ shape: 'circle', ...this.tttCell(c), r: rd.r, name: `${rd.name} 충전 폭발`, kind: 'avoid', color: 'red', start: rd.start, hitAt: rd.hitAt });
        if (rd.stolen == null && this.t < rd.until) out.push({ shape: 'circle', ...this.tttSpot(c), r: 1.5, name: `${rd.name} (탑 하나 골라 대각 자리에서 ${rd.hold}초 정지)`, kind: 'show', color: 'green', start: rd.start, hitAt: rd.until }); } } }
    if (this.carry) { const ca = this.carry; out.push({ shape: 'circle', ...(ca.have ? ca.drop : ca.pick), r: 3.5, name: `${ca.name} (${ca.have ? (ca.dropMsg ?? '여기에 E로 놓기') : (ca.pickMsg ?? '여기서 E로 들기')})`, kind: 'show', color: ca.have ? 'green' : 'blue', start: ca.start, hitAt: ca.hitAt }); }
    for (const r of this.runners) out.push({ shape: 'circle', ...this.runnerPos(r), r: r.r, name: r.name, kind: 'show', color: 'yellow', start: r.t0, hitAt: r.t0 + r.dur });
    if (this.trees) for (const tr of this.trees.pos) out.push({ shape: 'circle', x: tr.x, z: tr.z, r: this.trees.r, name: '치유의 나무', kind: 'show', color: tr.readyAt <= this.t ? 'green' : 'gray', start: 0, hitAt: 9999 });
    if (this.curse) { const cu = this.curse; out.push({ shape: 'circle', ...(cu.taken ? this.player : cu.at), r: cu.taken ? cu.poison : 3.5, name: cu.taken ? `${cu.name} (가장자리로 들고 가기)` : `${cu.name} (내 옷장에서 E)`, kind: 'show', color: 'pink', start: cu.start, hitAt: cu.hitAt }); }
    for (const h of this.hazards) out.push({ shape: 'circle', x: h.x, z: h.z, r: h.r, name: h.label ?? '독 장판', kind: 'avoid', color: 'pink', start: h.start, hitAt: h.start + 999, quietLabel: true });
    if (this.strikes?.cur) { const sk = this.strikes, c = sk.cur, nm = `${sk.name} ${c.k + 1}번${c.me ? ' (내 차례)' : ''}`;
      if (!c.hit) out.push({ shape: 'circle', x: c.x, z: c.z, r: sk.r, name: nm, kind: 'avoid', color: 'red', start: c.T - sk.lock, hitAt: c.T });
      if (!c.swept) out.push({ ...this.strikeSweep(c), name: `${nm} 반면 휩쓸기`, kind: 'avoid', color: 'red', start: c.T - sk.lock, hitAt: c.T + sk.sd }); }
    for (const w of this.waves) out.push({ ...this.waveShape(w, this.t), name: w.name, kind: 'avoid', color: 'pink', start: w.start, hitAt: this.t < w.t0 ? w.t0 : w.t0 + w.dur, live: this.t >= w.t0 });
    for (const k of this.links) out.push({ shape: 'line', a: { x: this.player.x, z: this.player.z }, b: { ...this.bots[k.bot] }, w: 0.5, name: `${k.name} (이어진 파티원에게 다가가기)`, kind: 'show', color: 'pink', start: k.start, hitAt: k.until });
    if (this.sigil) { const sg = this.sigil, at = sg.mine && !this.tank ? this.bots[sg.bot] : null;
      out.push({ shape: 'circle', ...(at ?? this.player), r: at ? sg.r : 1.5, name: this.tank ? `${sg.name} (넘겨받아 버티기)` : sg.mine ? `${sg.name} (탱커 곁에서 E)` : `${sg.name} (넘김)`, kind: 'show', color: sg.mine || this.tank ? 'pink' : 'yellow', start: sg.start, hitAt: sg.hitAt }); }
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
