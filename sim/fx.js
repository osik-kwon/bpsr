// 추출한 이펙트(tools/fxpack.py의 pack.json) 재생기. 입자 하나를 메시·빌보드 한 장으로 단순화해 시뮬레이션 시각에 맞춰 그린다.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const lerpKeys = (keys, u) => {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [a, b] = [keys[i - 1], keys[i]]; return a[1] + (b[1] - a[1]) * (u - a[0]) / Math.max(1e-6, b[0] - a[0]); }
  return keys[keys.length - 1][1];
};

export class Fx {
  constructor(scene, base) {
    this.scene = scene; this.base = base; this.insts = []; this.geo = new Map(); this.tex = new Map(); this.pack = null;
    fetch(base + 'pack.json').then(r => r.ok ? r.json() : null).then(p => this.pack = p).catch(() => {});
  }
  texture(name) {
    if (!this.tex.has(name)) { const t = new THREE.TextureLoader().load(`${this.base}tex/${name}.png`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; this.tex.set(name, t); }
    return this.tex.get(name);
  }
  geometry(name, mesh) {
    if (!this.geo.has(name)) {
      this.geo.set(name, null);
      new OBJLoader().load(`${this.base}mesh/${name}.obj`, o => { let g; o.traverse(c => { if (c.isMesh && !g) g = c.geometry; }); this.geo.set(name, g); });
    }
    const g = this.geo.get(name); if (g && mesh.geometry !== g) mesh.geometry = g;
  }
  // until: 반복 이펙트를 끌 시각(없으면 한 번 재생)
  play(name, t0, x, z, yaw = 0, until = null) { const i = { name, t0, x, z, yaw, until, group: null }; this.insts.push(i); return i; }
  clear() { for (const i of this.insts) if (i.group) this.scene.remove(i.group); this.insts = []; }
  build(inst, def) {
    const g = new THREE.Group(); g.position.set(inst.x, 0, inst.z); g.rotation.y = inst.yaw;
    g.parts = def.emitters.map(e => {
      const mat = { map: this.texture(e.tex), color: new THREE.Color(e.color[0], e.color[1], e.color[2]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
      const o = e.mesh ? new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ ...mat, side: THREE.DoubleSide })) : new THREE.Sprite(new THREE.SpriteMaterial(mat));
      o.position.fromArray(e.pos); if (e.mesh) o.quaternion.fromArray(e.rot);
      o.renderOrder = 5; g.add(o); return o;
    });
    this.scene.add(g); return g;
  }
  update(t) {
    if (!this.pack) return;
    for (const inst of this.insts) {
      const def = this.pack[inst.name]; if (!def) continue;
      const age = t - inst.t0, end = inst.until ?? inst.t0 + def.dur;
      const on = age >= 0 && t <= end;
      if (!on) { if (inst.group) inst.group.visible = false; continue; }
      inst.group ??= this.build(inst, def); inst.group.visible = true;
      def.emitters.forEach((e, k) => {
        const o = inst.group.parts[k]; let a = age - e.delay;
        if (inst.until != null && a > 0) a %= e.life;
        o.visible = a >= 0 && a < e.life; if (!o.visible) return;
        if (e.mesh) this.geometry(e.mesh, o);
        const u = a / e.life, s = e.size ? lerpKeys(e.size, u) : 1;
        o.scale.set(e.scale[0] * s, e.scale[1] * s, e.scale[2] * s);
        o.material.opacity = Math.min(1, e.color[3] * (e.alpha ? lerpKeys(e.alpha, u) : 1)) * 0.6;   // 가산 혼합이 겹쳐 하얗게 타는 것을 줄인다
      });
    }
  }
}
