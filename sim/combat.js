// 직업 조작 로직: 회피·평타 콤보·스킬(쿨타임, 충전, 동작 중 이동 불가)과 라이트 에너지. 렌더링과 분리된 순수 계산이며 Sim.step이 호출한다.
// 동작 하나는 dur초 동안 이어지고, root초까지는 이동 입력이 먹지 않으며 그 뒤로는 이동하면 남은 동작이 끊긴다. 회피는 어떤 동작이든 끊는다.
export class Combat {
  constructor(cls) { this.cls = cls; this.reset(); }
  reset() {
    const S = this.cls.skills;
    this.act = null; this.cd = {}; this.ch = {}; this.light = 0; this.recast = false; this.focus = 0;
    this.dmg = 0; this.by = {}; this.busy = 0; this.combo = 0; this.comboT = 0; this.zones = []; this.fxq = []; this.buf = null; this.face = null; this.whiff = 0;
    for (const [id, s] of Object.entries(S)) { this.cd[id] = 0; if (s.charges) this.ch[id] = { n: s.charges, t: s.recharge }; }
  }
  def(id) { const s = this.cls.skills[id]; return id === 'sp' && this.recast && s.recast ? { ...s, ...s.recast, charges: s.charges } : s; }
  ready(id) { return this.ch[id] ? this.ch[id].n > 0 : !(this.cd[id] > 0); }
  // 화면용: 슬롯 상태(남은 쿨 비율, 충전 수)
  slot(id) {
    const s = this.def(id), c = this.ch[id];
    return { id, name: s.name, icon: s.icon, key: s.key, n: c ? c.n : null, left: c ? (c.n < s.charges ? c.t : 0) : this.cd[id], total: c ? s.recharge : s.cd, ready: this.ready(id), active: this.act?.id === id };
  }
  start(id, sim, input) {
    if (id === 'sp' && this.cls.light && !this.recast && this.light >= this.cls.light.max) this.recast = true;   // 가득 찬 상태로 특수 공격을 쓰면 리캐스트 진입
    const s = id === 'atk' ? { ...this.cls.skills.atk.combo[this.combo], name: this.cls.skills.atk.name } : this.def(id);
    const p = sim.player, b = sim.boss, l = Math.hypot(input.mx, input.mz), bd = Math.hypot(b.x - p.x, b.z - p.z) || 1;
    const fwd = { x: (b.x - p.x) / bd, z: (b.z - p.z) / bd }, inp = l > 0 ? { x: input.mx / l, z: input.mz / l } : null;
    let dir = null;
    if (s.move) dir = s.move.dir === 'input' && inp ? inp : s.move.fallback === 'forward' ? fwd : s.move.fallback === 'back' ? { x: -fwd.x, z: -fwd.z } : null;
    if (this.ch[id]) this.ch[id].n--; else if (s.cd) this.cd[id] = s.cd;
    if (s.lightOnCast && !this.recast) this.gain(s.lightOnCast);
    if (s.buff === 'focus') this.focus = this.cls.focus.dur;
    this.act = { id, s, t: 0, dir, back: id === 'dodge' && !inp, mul: s.recastMul && this.recast ? s.recastMul : 1, step: id === 'atk' ? this.combo : 0 };
    if (id === 'atk') this.combo = (this.combo + 1) % this.cls.skills.atk.combo.length;
    if (s.iframe?.[0] === 0) p.iframe = Math.max(p.iframe, s.iframe[1]);
    this.buf = null; this.fxq.push({ kind: 'cast', id, t: sim.t, s, x: p.x, z: p.z });
  }
  gain(n) { if (this.cls.light && !this.recast) this.light = Math.min(this.cls.light.max, this.light + n); }
  hit(sim, id, h, at, mul = 1) {
    const p = sim.player, b = sim.boss, ok = Math.hypot(b.x - at.x, b.z - at.z) <= (at.r ?? this.cls.range);
    if (ok) { const v = h.dmg * mul * (this.cls.dmgScale ?? 1); this.dmg += v; this.by[id] = (this.by[id] ?? 0) + v; if (h.light) this.gain(h.light); } else this.whiff++;
    return ok;
  }
  // 한 스텝 진행. 반환: free(이동 입력 허용), dx·dz(동작이 강제로 옮기는 거리)
  step(dt, input, sim) {
    const C = this.cls, p = sim.player, l = Math.hypot(input.mx, input.mz), out = { free: true, dx: 0, dz: 0 };
    const haste = this.focus > 0 ? C.focus.haste : 1;
    this.focus = Math.max(0, this.focus - dt);
    for (const id in this.cd) this.cd[id] = Math.max(0, this.cd[id] - dt);
    for (const [id, c] of Object.entries(this.ch)) {
      const s = C.skills[id]; if (c.n >= s.charges) continue;
      c.t -= dt * (s.special && this.focus > 0 ? C.focus.spRecharge : 1);
      if (c.t <= 0) { c.n++; c.t += s.recharge; }
    }
    if (this.recast && !(this.act?.s.pauseDrain)) { this.light -= C.light.drain * dt; if (this.light <= 0) { this.light = 0; this.recast = false; } }
    // 깔아 둔 지속 피해
    for (const z of this.zones) for (; z.next <= sim.t && z.next <= z.until; z.next += z.tick) { if (this.hit(sim, z.id, z, z, z.mul) && z.light && z.got < z.lightMax) { this.gain(z.light); z.got += z.light; } }
    this.zones = this.zones.filter(z => z.until > sim.t);
    // 입력: 회피는 즉시, 나머지는 동작이 끝날 때까지 잠깐 기억해 둔다
    const want = input.dash ? 'dodge' : input.skill ?? (input.atk ? 'atk' : null);
    if (want && want !== 'atk') this.buf = { id: want, until: sim.t + 0.4 };
    if (this.buf && this.buf.until < sim.t) this.buf = null;
    let a = this.act;
    if (a) {
      const t0 = a.t; a.t += dt * (a.id === 'dodge' ? 1 : haste); this.busy += dt;
      for (const h of a.s.hits ?? []) if (h.t > t0 && h.t <= a.t) { const ok = this.hit(sim, a.id, h, p, a.mul); this.fxq.push({ kind: 'shot', id: a.id, t: sim.t, x: p.x, z: p.z, ok, big: h.big, hitFx: a.s.hitFx }); }
      const z = a.s.zone;
      if (z && z.t > t0 && z.t <= a.t) { const Z = { ...z, id: a.id, x: sim.boss.x, z: sim.boss.z, until: sim.t + z.dur, next: sim.t + z.tick, mul: a.mul, got: 0 }; this.zones.push(Z); this.fxq.push({ kind: 'zone', id: a.id, t: sim.t, x: Z.x, z: Z.z, zone: Z }); }
      const m = a.s.move;
      if (m && a.dir) { const u = (Math.min(a.t, m.t1) - Math.max(t0, m.t0)) / (m.t1 - m.t0); if (u > 0) { out.dx = a.dir.x * m.dist * u; out.dz = a.dir.z * m.dist * u; } }
      const iv = a.s.iframe; if (iv && a.t >= iv[0] && a.t < iv[1]) p.iframe = Math.max(p.iframe, iv[1] - a.t);
      out.free = a.t >= (a.s.root ?? a.s.dur);
      const next = this.buf && this.ready(this.buf.id) ? this.buf.id : null;
      if (a.t >= a.s.dur || (out.free && (l > 0 || next || input.atk)) || (next === 'dodge' && a.id !== 'dodge')) { if (a.id === 'atk') this.comboT = 0.7; this.act = a = null; }
    }
    if (!a) {
      if (this.comboT > 0 && (this.comboT -= dt) <= 0) this.combo = 0;
      const id = this.buf && this.ready(this.buf.id) ? this.buf.id : input.atk ? 'atk' : null;
      if (id) { this.start(id, sim, input); out.free = false; }
    }
    this.face = this.act ? (this.act.s.move && this.act.dir && this.act.t < this.act.s.move.t1 && this.act.id !== 's2' ? 'move' : 'boss') : null;
    return out;
  }
  // 결과 화면용 요약
  summary(t) { return { dmg: Math.round(this.dmg), dps: t > 0 ? Math.round(this.dmg / t) : 0, uptime: t > 0 ? Math.round(this.busy / t * 100) : 0, whiff: this.whiff }; }
}
