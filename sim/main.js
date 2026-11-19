// 화면·입력 담당. 판정은 engine.js가 계산한다. assets/의 GLB(tools/simasset.py 산출물)가 없으면 자체 도형으로 그린다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sim, roomAngle, applyVariant } from './engine.js';
import { Combat } from './combat.js';
import { Fx } from './fx.js';

const scenario = new URLSearchParams(location.search).get('s') || 'boss1-hard';
const data = await (await fetch(`./data/${scenario}.json`, { cache: 'no-cache' })).json();
applyVariant(data, new URLSearchParams(location.search).get('m')); data.events.sort((a, b) => a.t - b.t);   // 변형(?m=18 등)
const spd = +new URLSearchParams(location.search).get('speed'); if (spd > 0) data.player.speed = spd;   // 이동 속도 덮어쓰기(?speed=5)
// 직업: 주소의 c 또는 마지막에 고른 값(기본 디바인 아처)
const CLS_IDS = ['archer', 'olvera', 'boyce', 'tina', 'iruna', 'comeau', 'farfara', 'guitar', 'tata'];
let clsId = new URLSearchParams(location.search).get('c'); try { clsId ??= localStorage.getItem('cls'); } catch {}
if (!CLS_IDS.includes(clsId)) clsId = 'archer';
const cls = await (await fetch(`./data/class-${clsId}.json`, { cache: 'no-cache' })).json();
const sim = new Sim(data, new Combat(cls));
const $ = id => document.getElementById(id);
$('title').textContent = `${data.title} · ${cls.name}`;
const ROLE = { tank: '탱커', heal: '힐러', dps: '딜러' };
{ const sel = $('cls'); sel.value = clsId; sel.onchange = () => { try { localStorage.setItem('cls', sel.value); } catch {} const q = new URLSearchParams(location.search); q.set('c', sel.value); location.search = q; }; }

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2233);
scene.fog = new THREE.Fog(0x1b2233, 150, 700);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1500);
scene.add(new THREE.HemisphereLight(0xcfd9ff, 0x30323a, 1.1));
const sun = new THREE.DirectionalLight(0xffe2c4, 1.2); sun.position.set(40, 60, 20); scene.add(sun);

const R = data.arena.radius;
const flat = m => { m.rotation.x = -Math.PI / 2; return m; };
// 전투장: 실측 반경의 원판과 방을 나누는 십자 광막
const disc = flat(new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ color: 0x8d94a3, roughness: 0.9 }))); scene.add(disc);
const rim = flat(new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R, 96), new THREE.MeshBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.5 }))); rim.position.y = 0.04; scene.add(rim);
const gltf = new GLTFLoader();
const loadGlb = url => gltf.loadAsync(url).then(g => g, () => null);
// 전투장 환경: 바닥이 y=0, 중심이 원점이 되도록 변환돼 있다
const GRID = data.arena.type === 'grid' ? data.arena : null;
if (!GRID && data.arena.model) loadGlb('./assets/' + data.arena.model).then(env => {
  if (!env) return;
  // clipY: 보스방 위층 바닥·천장이 위에서 보는 시야를 가리면 그 높이 위를 잘라 낸다
  if (data.arena.clipY != null) { renderer.localClippingEnabled = true; const pl = [new THREE.Plane(new THREE.Vector3(0, -1, 0), data.arena.clipY)]; env.scene.traverse(o => { if (o.isMesh) o.material.clippingPlanes = pl; }); }
  scene.add(env.scene); disc.visible = false;
});
// 회전판 고리(시즌4 레이드 1넴): 고리마다 모델 하나, 룬 회전판 기믹 동안 돈다
const ringObjs = [];
(data.arena.rings ?? []).forEach((f, i) => loadGlb('./assets/' + f).then(g => { if (!g) return; g.scene.position.y = 0.04; scene.add(g.scene); ringObjs[i] = g.scene; }));
// 격자 전투장(2·3넴): 바닥 타일 프리팹을 칸마다 놓고, 금 간 칸은 붉게 물들이고 무너진 칸은 숨긴다
const tileObjs = [];
if (GRID) {
  disc.visible = rim.visible = false;
  for (let i = 0; i < GRID.cols * GRID.rows; i++) {
    const c = sim.tileRect(i), box = new THREE.Mesh(new THREE.BoxGeometry(c.w - 0.4, 1, c.h - 0.4), new THREE.MeshStandardMaterial({ color: 0x8d94a3, roughness: 0.9 }));
    box.position.set(c.x, -0.5, c.z); scene.add(box); tileObjs.push({ g: box, mats: [box.material], state: -1 });
  }
  loadGlb('./assets/' + GRID.tileModel).then(m => {
    if (!m) return;
    tileObjs.forEach((t, i) => {
      const c = sim.tileRect(i), g = m.scene.clone(true), mats = [];
      g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
      g.rotation.y = Math.PI / 2; g.position.set(c.x, -0.39, c.z); scene.remove(t.g); scene.add(g); t.g = g; t.mats = mats; t.state = -1;
    });
  });
}
function drawTiles() {
  tileObjs.forEach((t, i) => {
    const st = sim.tiles[i]; if (st === t.state) return; t.state = st;
    t.g.visible = st < 2; for (const m of t.mats) m.color.set(st === 1 ? 0xff8a70 : 0xffffff);
  });
}
const curtainMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
for (const rot of data.noCurtain || GRID ? [] : [0, Math.PI / 2]) {
  const c = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, 7), curtainMat); c.position.y = 3.5; c.rotation.y = rot; scene.add(c);
}
// 방 번호
const markLabels = {};   // 징 번호 글자는 한 번만 만든다
function label(text, size = 3, color = '#ffffff') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = color; g.font = `bold ${text.length > 1 ? 44 : 72}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true })); s.scale.set(size, size, 1); return s;
}
for (let n = 1; n <= (GRID || data.noCurtain ? 0 : 4); n++) { const s = label(String(n), 5, '#58a6ff'); s.position.set(Math.cos(roomAngle(n)) * (R - 5), 6, Math.sin(roomAngle(n)) * (R - 5)); scene.add(s); }

// 보스·분신: 크기만 맞춘 자체 도형
function standin(color, h) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.28, h * 0.36, h * 0.7, 8), m); body.position.y = h * 0.35; g.add(body);
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(h * 0.22), m); head.position.y = h * 0.86; g.add(head);
  return g;
}
function actor(color, model, tint) {
  const g = new THREE.Group(), s = standin(color, data.boss.height); g.add(s); scene.add(g);
  loadGlb('./assets/' + model).then(m => {
    if (!m) return;
    g.remove(s); g.add(m.scene);
    m.scene.scale.setScalar(data.boss.scale ?? 1);
    m.scene.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; if (tint) { o.material = o.material.clone(); o.material.color.set(tint); o.material.emissive.set(tint); o.material.emissiveIntensity = 0.35; } } });
    g.mixer = new THREE.AnimationMixer(m.scene); g.clips = Object.fromEntries(m.animations.map(c => [c.name, c]));
  });
  return g;
}
// 지정한 클립의 지정 시각 자세로 맞춘다(시뮬레이션 시각을 그대로 따라가도록 직접 지정)
function setPose(g, name, time) {
  const clip = g.clips?.[name]; if (!clip) return;
  if (g.cur !== name) { g.mixer.stopAllAction(); g.action = g.mixer.clipAction(clip); g.action.play(); g.cur = name; }
  g.action.time = time; g.mixer.update(0);
}
// 지금 시각에 재생할 보스 동작: 진행 중인 기믹의 동작(한 번 재생), 없으면 대기 반복
function bossAnim(g) {
  if (!g.clips) return;
  const A = data.boss.anims, t = sim.t;
  for (let i = data.events.length - 1; i >= 0; i--) {
    const e = data.events[i], name = A[e.anim ?? e.type], c = g.clips[name];
    if (c && t >= e.t && t < e.t + c.duration) return setPose(g, name, t - e.t);
  }
  const walk = g === boss && sim.bossWalking && g.clips[A.walk]; if (walk) return setPose(g, A.walk, t % walk.duration);
  const idle = g.clips[A.idle]; if (idle) setPose(g, A.idle, t % idle.duration);
}
const boss = actor(0x4a4f5c, data.boss.model), clone = actor(0xe26fa8, data.boss.model, 0xff7eb6);
// 모델 정면(+z)이 대상을 보게 돌린다
const face = (o, t) => { const dx = t.x - o.position.x, dz = t.z - o.position.z; if (dx * dx + dz * dz > 0.01) o.rotation.y = Math.atan2(dx, dz); };
// 나와 파티원: 인게임 캐릭터 모델(tools/bossanim.py char 산출물). 파일이 없으면 캡슐로 그린다
const PCS = ['pc_f1.glb', 'pc_m1.glb', 'pc_f2.glb', 'pc_m2.glb', 'pc_f3.glb', 'pc_m3.glb', 'pc_f4.glb', 'pc_m4.glb'];
// 캐릭터를 게임처럼 보이게: 얼굴은 조명 없이 제 색 그대로, 나머지는 두 단계 툰 음영, 그리고 뒤집어 부풀린 외곽선
const toonRamp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 255, 255, 255, 255]), 2, 1); toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter; toonRamp.needsUpdate = true;
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x2a1a1c, side: THREE.BackSide });
outlineMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_SKINNING\ntransformed += normalize(objectNormal) * 0.0035;\n#endif'); };
function toonify(root) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy(), add = [];
  root.traverse(o => {
    if (!o.isMesh) return; o.frustumCulled = false;
    const src = o.material, face = /head|lash/.test(src.name), opt = { map: src.map, color: src.color, vertexColors: src.vertexColors, side: src.side, transparent: src.transparent, name: src.name };
    if (src.map) { src.map.anisotropy = maxAniso; src.map.needsUpdate = true; }
    o.material = face ? new THREE.MeshBasicMaterial(opt) : new THREE.MeshToonMaterial({ ...opt, gradientMap: toonRamp });
    if (o.isSkinnedMesh && !/lash/.test(src.name)) add.push(o);
  });
  for (const o of add) { const ol = new THREE.SkinnedMesh(o.geometry, outlineMat); ol.bind(o.skeleton, o.bindMatrix); ol.frustumCulled = false; o.parent.add(ol); }
}
function person(color, model) {
  const g = new THREE.Group(); scene.add(g);
  const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color })); cap.position.y = 0.9; g.add(cap);
  g.ring = flat(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))); g.ring.position.y = 0.07; g.add(g.ring);
  g.last = null;
  loadGlb('./assets/' + model).then(m => {
    if (!m) return;
    g.remove(cap); g.add(m.scene);
    toonify(m.scene);
    g.mixer = new THREE.AnimationMixer(m.scene); g.acts = Object.fromEntries(m.animations.map(c => [c.name, g.mixer.clipAction(c)]));
    g.cur = 'idle'; g.acts.idle?.play();
  });
  return g;
}
// 위치를 옮기고, 움직이면 달리기 동작으로 진행 방향을 보게 한다. 멈춰 있으면 lookAt 쪽을 본다
function movePerson(g, pos, dt, lookAt) {
  const dx = g.last ? pos.x - g.last.x : 0, dz = g.last ? pos.z - g.last.z : 0, d = Math.hypot(dx, dz);
  const moving = dt > 0 && d > 0.3 * dt && d < 3;   // 순간 이동(자리 재배치)은 달리기로 치지 않는다
  g.position.set(pos.x, 0, pos.z); g.last = { x: pos.x, z: pos.z };
  if (moving) g.rotation.y = Math.atan2(dx, dz);
  else if (lookAt && dt > 0) { const lx = lookAt.x - pos.x, lz = lookAt.z - pos.z; if (lx * lx + lz * lz > 1) g.rotation.y = Math.atan2(lx, lz); }
  if (!g.mixer) return;
  const want = moving && g.acts.run ? 'run' : 'idle';
  if (want !== g.cur && g.acts[want]) { g.acts[g.cur]?.fadeOut(0.12); g.acts[want].reset().fadeIn(0.12).play(); g.cur = want; }
  g.mixer.update(dt);
}
// 내 캐릭터: 진행 중인 스킬 동작의 클립을 동작 경과 시각에 맞춰 보여 주고, 없으면 달리기·대기를 반복한다
function animPlayer(g, p, dt) {
  const C = sim.combat, a = C.act;
  const dx = g.last ? p.x - g.last.x : 0, dz = g.last ? p.z - g.last.z : 0, d = Math.hypot(dx, dz), moving = dt > 0 && d > 0.3 * dt && d < 3;
  g.position.set(p.x, 0, p.z); g.last = { x: p.x, z: p.z };
  if (a) g.rotation.y = C.face === 'move' && a.dir && !a.back ? Math.atan2(a.dir.x, a.dir.z) : Math.atan2(sim.boss.x - p.x, sim.boss.z - p.z);
  else if (moving) g.rotation.y = Math.atan2(dx, dz);
  if (!g.mixer) return;
  let name = moving ? cls.run : cls.idle, time = null;
  if (a && ((a.back && a.s.animBack) || a.s.anim)?.length) { const segs = (a.back && a.s.animBack) || a.s.anim; let seg = segs[0]; for (const sg of segs) if (a.t >= sg.t) seg = sg; name = seg.clip; time = a.t - seg.t; }
  const act = g.acts[name] ?? g.acts[cls.idle] ?? g.acts.as_f_base_idle ?? g.acts.idle;   // 클립이 없는 동작은 대기 자세로 둔다 if (!act) return; name = act.getClip().name;
  if (name !== g.cur || (time !== null && time < g.curT)) {
    const prev = g.acts[g.cur]; act.reset(); act.setLoop(time === null ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); act.clampWhenFinished = true; act.play();
    if (prev && prev !== act) prev.crossFadeTo(act, 0.08, false);
    g.cur = name;
  }
  if (time !== null) { act.time = Math.min(time, act.getClip().duration - 0.001); act.timeScale = 0; } else act.timeScale = 1;
  g.curT = time ?? 0; g.mixer.update(dt);
}
// 스킬 이펙트·화살: combat이 쌓아 둔 사건을 꺼내 재생한다
const pcFx = new Fx(scene, cls.fxBase ?? './assets/fx-pc/'), shots = [], HIT_Y = Math.min(data.boss.height * 0.45, 6);
const arrowGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6), UP = new THREE.Vector3(0, 1, 0);
const me = () => ({ x: sim.player.x, z: sim.player.z, yaw: player.rotation.y });
function drainCombat() {
  const C = sim.combat, q = C.fxq; if (!q.length) return; C.fxq = [];
  for (const e of q) {
    if (e.kind === 'cast') for (const f of e.s.fx ?? []) pcFx.play(f.name, e.t + f.t, e.x, e.z, 0, f.dur ? e.t + f.t + f.dur : null, { follow: me });
    else if (e.kind === 'zone') pcFx.play(e.zone.fx, e.t, e.x, e.z, 0, e.t + e.zone.dur, { center: true, scale: 0.6, alpha: 0.3 });   // 보스를 가리지 않게 줄이고 옅게
    else if (e.kind === 'shot' && cls.ranged === false) {   // 근접: 화살 없이 보스 앞쪽에 타격 이펙트만
      const dx = e.x - sim.boss.x, dz = e.z - sim.boss.z, l = Math.hypot(dx, dz) || 1, k = Math.min(l - 1.5, 6);
      if (e.ok && e.hitFx) pcFx.play(e.hitFx, e.t, sim.boss.x + dx / l * k, sim.boss.z + dz / l * k, 0, null, { center: true, y: 0.6 });
    } else if (e.kind === 'shot') {
      const from = new THREE.Vector3(e.x, 1.35, e.z), to = new THREE.Vector3(sim.boss.x + (Math.random() - 0.5) * 2, HIT_Y + (Math.random() - 0.5) * 2, sim.boss.z + (Math.random() - 0.5) * 2);
      const dir = to.clone().sub(from), len = dir.length(); dir.normalize(); if (!e.ok) to.copy(from).addScaledVector(dir, cls.range);
      const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: e.big ? 0xffe9a0 : 0xbfe9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.quaternion.setFromUnitVectors(UP, dir); m.scale.set(e.big ? 2.2 : 0.9, e.big ? 5 : 2.4, e.big ? 2.2 : 0.9); scene.add(m);
      shots.push({ m, from, dir, t0: e.t, dur: (e.ok ? len : cls.range) / 80, to, ok: e.ok, big: e.big, hitFx: e.hitFx });
    }
  }
}
function drawShots() {
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i], u = (sim.t - sh.t0) / sh.dur;
    if (u >= 1 || u < 0) {
      if (u >= 1 && sh.ok && (sh.hitFx || !cls.auto)) pcFx.play(sh.hitFx ?? (sh.big ? 'rodri_exattack01_hit' : 'skill_rodri-01_attack_bullet01_hit'), sim.t, sh.to.x, sh.to.z, 0, null, { center: true, y: sh.to.y - 1 });
      scene.remove(sh.m); sh.m.material.dispose(); shots.splice(i, 1); continue;
    }
    sh.m.position.copy(sh.from).lerp(sh.to, u);
  }
}
const pcN = +new URLSearchParams(location.search).get('pc') || 0;
const player = person(0x3fb950, cls.model);
const bots = sim.bots.map((_, i) => person(0x9aa4b2, PCS[(pcN + i + 1) % PCS.length]));
// 음표(원소) 표시: 머리 위에 내 것과 파티원 것을 띄운다
const NOTE_COL = { '얼음': '#e6f7ff', '물': '#58a6ff' }, myNotes = {};
if (data.partyNotes) { for (const k of Object.keys(NOTE_COL)) { const l = label('♪' + k, 2.2, NOTE_COL[k]); l.position.y = 3.3; l.visible = false; player.add(l); myNotes[k] = l; }
  data.partyNotes.forEach((k, i) => { if (!bots[i]) return; const l = label('♪' + k, 1.8, NOTE_COL[k]); l.position.y = 3.6; bots[i].add(l); }); }
// 파티원 역할 표시(던전 5인 파티: 탱·힐·딜)
(Array.isArray(data.partyRoles) ? data.partyRoles : data.partyRoles?.[sim.role] ?? []).forEach((r, i) => { if (!bots[i]) return; const l = label(r, r.length > 1 ? 2.4 : 1.6, r === '탱' ? '#58a6ff' : r === '힐' ? '#3fb950' : '#f0883e'); l.position.y = 2.6; bots[i].add(l); });

// 실제 이펙트: 새로 생긴 예고·코어를 보고 시전·타격 시각에 재생을 걸어 둔다
const realFx = new Fx(scene, data.fxBase ?? './assets/fx/'); let seen = new WeakSet(), evFx = 0;
function scheduleFx() {
  const F = data.fx ?? {};
  // 이벤트에 직접 붙인 이펙트(fxList: name, at 'boss' 또는 [x, z], t 지연, dur 지속)
  for (; evFx < data.events.length && data.events[evFx].t <= sim.t; evFx++) for (const f of data.events[evFx].fxList ?? []) {
    const e = data.events[evFx], at = f.at === 'boss' || !f.at ? sim.boss : { x: f.at[0], z: f.at[1] }, t0 = e.t + (f.t ?? 0);
    realFx.play(f.name, t0, at.x, at.z, f.at === 'boss' || !f.at ? boss.rotation.y : 0, f.dur ? t0 + f.dur : null, f.opt);
  }
  for (const s of sim.tele) {
    if (seen.has(s)) continue; seen.add(s);
    const m = F[s.type]; if (!m) continue;
    const spots = m.at === 'boss' ? [sim.boss] : s.shape === 'multi' ? s.spots : s.shape === 'line' ? [{ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 }] : [s];
    const yaw = m.at === 'boss' ? boss.rotation.y : 0, done = new Set();
    for (const q of spots) {
      const p = q.shape === 'line' ? { x: (q.a.x + q.b.x) / 2, z: (q.a.z + q.b.z) / 2 } : q;   // 직선은 가운데에 놓는다
      const key = p.x.toFixed(1) + ',' + p.z.toFixed(1); if (done.has(key)) continue; done.add(key);
      // castOpt·hitOpt: 크기·투명도 등, hitDur: 긴 이펙트를 잘라 쓸 길이, castLoop: 예고 이펙트를 터질 때까지 반복. 나를 따라다니는 원은 터지는 순간의 내 자리에 놓는다
      const fol = s.follow ? { follow: () => ({ x: sim.player.x, z: sim.player.z, yaw: 0 }) } : null;
      if (m.cast) realFx.play(m.cast, s.showFrom ?? s.start, p.x, p.z, yaw, m.castLoop ? s.hitAt : null, { ...m.castOpt, ...fol });   // castLoop: 터질 때까지 반복
      if (m.hit) realFx.play(m.hitByColor?.[s.color] ?? m.hit, s.hitAt, p.x, p.z, yaw, m.hitDur ? s.hitAt + m.hitDur : null, { ...m.hitOpt, ...fol });
    }
  }
  const C = F.cores;
  for (const c of sim.cores) {
    if (C && !seen.has(c)) { seen.add(c); realFx.play(C.start, sim.t, c.x, c.z); c.fx = realFx.play(C.loop, sim.t, c.x, c.z, 0, sim.t); }
    if (c.fx) c.fx.until = sim.t + 0.2;
  }
}
// 예고 도형은 매 프레임 다시 만든다(개수가 적다)
const fx = new THREE.Group(); scene.add(fx);
const shareBeam = new THREE.CylinderGeometry(1.1, 1.1, 14, 20, 1, true);
const COLORS = { white: 0xe6f7ff, red: 0xf85149, pink: 0xff7eb6, blue: 0x58a6ff, yellow: 0xd29922, green: 0x3fb950, gray: 0x6e7681 };
function shapeMesh(s, color, fill) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 + 0.45 * fill, depthWrite: false, side: THREE.DoubleSide });
  let m;
  if (s.shape === 'circle') { m = flat(new THREE.Mesh(new THREE.CircleGeometry(s.r, 64), mat)); m.position.set(s.x, 0.05, s.z); }
  else if (s.shape === 'ring') { m = flat(new THREE.Mesh(new THREE.RingGeometry(s.rIn, s.rOut, 64), mat)); m.position.set(s.x, 0.05, s.z); }
  else if (s.shape === 'sector') { m = flat(new THREE.Mesh(new THREE.CircleGeometry(s.r, 48, -(s.dir + s.half), s.half * 2), mat)); m.position.set(s.x, 0.05, s.z); }
  else if (s.shape === 'rect') { m = flat(new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat)); m.position.set(s.x, 0.05, s.z); }
  else if (s.shape === 'line') {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, len = Math.hypot(dx, dz);
    m = new THREE.Mesh(new THREE.PlaneGeometry(len, s.w), mat); m.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
    m.position.set((s.a.x + s.b.x) / 2, 0.06, (s.a.z + s.b.z) / 2);
  }
  return m;
}
function drawFx() {
  for (const c of [...fx.children]) { if (!c.isSprite) { if (c.geometry !== shareBeam) c.geometry?.dispose(); c.material?.dispose(); } fx.remove(c); }
  for (const s of sim.visible()) {
    const fill = s.live ? 1 : Math.min(1, (sim.t - (s.showFrom ?? s.start)) / Math.max(0.1, s.hitAt - (s.showFrom ?? s.start)));
    // 거리 비례(far)는 안전 거리 바깥이 안전하다는 뜻으로 테두리만 진하게
    if (s.orb) { const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xb38cff, transparent: true, opacity: 0.85 })); m.position.set(s.x, 2.6, s.z); fx.add(m); }
    for (const part of s.shape === 'multi' ? s.spots : [s]) fx.add(shapeMesh(part, COLORS[s.color], s.kind === 'far' || s.kind === 'show' ? fill * 0.4 : fill));
    // 들어가야 하는 원(쉐어)은 멀리서도 보이게 굵은 테두리·빛기둥·글자를 세운다
    if (s.kind === 'in' || s.kind === 'soak') for (const part of s.shape === 'multi' ? s.spots : [s]) {
      if (part.shape !== 'circle') continue;
      const edge = shapeMesh({ shape: 'ring', x: part.x, z: part.z, rIn: part.r - 0.45, rOut: part.r }, 0xffffff, 1); edge.position.y = 0.1; fx.add(edge);
      const beam = new THREE.Mesh(shareBeam, new THREE.MeshBasicMaterial({ color: COLORS[s.color], transparent: true, opacity: 0.28 + 0.2 * Math.sin(sim.t * 6), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.set(part.x, 7, part.z); fx.add(beam);
      const lt = s.label ?? '쉐어', l = (markLabels[lt] ??= label(lt, 6, '#ffb3d4')).clone(); l.scale.set(4.5, 4.5, 1); l.position.set(part.x, 6.5, part.z); fx.add(l);
    }
  }
  for (const c of sim.cores) { const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb38cff })); m.position.set(c.x, 1.4, c.z); fx.add(m); }
  for (const z of sim.combat.zones) { const m = shapeMesh({ shape: 'ring', x: z.x, z: z.z, rIn: z.r - 0.2, rOut: z.r }, 0x7fd4ff, 0.6); m.position.y = 0.09; fx.add(m); }   // 내가 깔아 둔 지속 피해 범위
  for (const mk of sim.markers) { const m = flat(new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 32), new THREE.MeshBasicMaterial({ color: 0x3fb950, side: THREE.DoubleSide }))); m.position.set(mk.x, 0.08, mk.z); fx.add(m); if (/^\d+$/.test(mk.label ?? '')) { const l = markLabels[mk.label] ??= label(mk.label, 3, '#3fb950'); const c = l.clone(); c.position.set(mk.x, 2.2, mk.z); fx.add(c); } }
  if (sim.tether) {
    // 대상 3명을 잇는 삼각형 줄(확정 전에는 내 꼭짓점이 나를 따라온다)
    const { A, B, C, V } = sim.tether, me = C ?? V ?? sim.player;
    if (!C) for (const [a, b] of [[A, B], [B, me], [me, A]]) { const m = shapeMesh({ shape: 'line', a, b, w: 0.5 }, 0x58d6ff, 1); m.position.y = 0.12; fx.add(m); }
  }
}

// 입력: 키보드·마우스, 터치 기기는 아래 터치 조작을 함께 쓴다
const keys = new Set(); let yaw = GRID ? -Math.PI / 2 : data.boss.pos && data.player.start ? Math.atan2(data.player.start[1] - data.boss.pos[1], data.player.start[0] - data.boss.pos[0]) : roomAngle(1) + Math.PI, pitch = 0.5, zoom = 16, paused = true, dashQueued = false, interactQueued = false, speedMul = 1, atkHeld = false, skillQueued = null;
// 인게임 PC 기본 키(클라 입력 설정): 특수 공격 1, 마스터리 스킬 2~5, 궁극 스킬 R, 배틀 이매진 Z·X
const SKILL_KEYS = { Digit1: 'sp', Digit2: 's1', Digit3: 's2', Digit4: 's3', Digit5: 's4', KeyR: 'ult', KeyZ: 'im1', KeyX: 'im2' };
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'ShiftLeft') { dashQueued = true; e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') interactQueued = true;
  if (e.code === 'Backspace') restart();
  if (e.code === 'KeyP' && !sim.done) paused = !paused;
  if (SKILL_KEYS[e.code] && !e.repeat) skillQueued = SKILL_KEYS[e.code];
  if (e.code === 'KeyJ') atkHeld = true;
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyJ') atkHeld = false; });
addEventListener('blur', () => { keys.clear(); atkHeld = false; });
// 포인터 잠금이 거부되는 환경에서는 드래그로 시점을 돌린다
const lock = () => { try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch {} };
renderer.domElement.addEventListener('click', lock);
let dragging = false;
// 마우스가 시점 조작에 잠겨 있을 때는 좌클릭(누르고 있기) 평타, 우클릭 특수 공격
const locked = () => document.pointerLockElement === renderer.domElement;
renderer.domElement.addEventListener('mousedown', e => { if (locked()) { if (e.button === 0) atkHeld = true; else if (e.button === 2) dashQueued = true; } else if (e.button === 0) dragging = true; });
addEventListener('mouseup', e => { if (e.button === 0) { dragging = false; atkHeld = false; } });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement && !dragging) return;
  yaw += e.movementX * 0.0035; pitch = Math.max(0.12, Math.min(1.35, pitch + e.movementY * 0.003));
});
addEventListener('wheel', e => { zoom = Math.max(6, Math.min(45, zoom + e.deltaY * 0.02)); }, { passive: true });
function restart() { sim.reset(); realFx.clear(); pcFx.clear(); for (const sh of shots.splice(0)) scene.remove(sh.m); atkHeld = false; skillQueued = null; seen = new WeakSet(); evFx = 0; paused = false; $('overlay').style.display = 'none'; $('results').innerHTML = ''; shown = 0; }
$('start').onclick = () => { restart(); if (!document.body.classList.contains('touch')) lock(); };

// 터치: 화면 왼쪽은 누른 자리에 생기는 조이스틱, 오른쪽은 드래그 시점·두 손가락 줌. 터치 이벤트에서 파생되는 마우스 이벤트는 preventDefault로 막는다
const STICK_R = 50, stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, cams = new Map();
let pinch = 0;
const touchUI = () => document.body.classList.add('touch');
if (matchMedia('(pointer: coarse)').matches) touchUI();
function drawStick() {
  const on = stick.id !== null; $('stick').style.display = on ? 'block' : 'none'; if (!on) return;
  $('stick').style.transform = `translate(${stick.ox - STICK_R}px, ${stick.oy - STICK_R}px)`;
  $('knob').style.transform = `translate(${stick.x * STICK_R}px, ${stick.y * STICK_R}px)`;
}
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  e.preventDefault(); touchUI(); try { cv.setPointerCapture(e.pointerId); } catch {}
  if (e.clientX < innerWidth * 0.45 && stick.id === null) { Object.assign(stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 }); drawStick(); }
  else { cams.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; }
});
cv.addEventListener('pointermove', e => {
  if (e.pointerId === stick.id) {
    const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, l = Math.hypot(dx, dy), k = l > STICK_R ? STICK_R / l : 1;
    stick.x = dx * k / STICK_R; stick.y = dy * k / STICK_R; drawStick(); return;
  }
  const c = cams.get(e.pointerId); if (!c) return;
  if (cams.size === 1) { yaw += (e.clientX - c.x) * 0.008; pitch = Math.max(0.12, Math.min(1.35, pitch + (e.clientY - c.y) * 0.006)); }
  c.x = e.clientX; c.y = e.clientY;
  if (cams.size === 2) {
    const [a, b] = [...cams.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoom = Math.max(6, Math.min(45, zoom * pinch / d)); pinch = d;
  }
});
const release = e => { if (e.pointerId === stick.id) { stick.id = null; drawStick(); } cams.delete(e.pointerId); pinch = 0; };
cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
// 버튼은 누르는 순간 반응하도록 pointerdown에서 처리
const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
tap('tAct', () => interactQueued = true);
tap('tPause', () => { if (!sim.done) paused = !paused; });
tap('tRe', () => restart());

function input() {
  let f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (stick.id !== null && Math.hypot(stick.x, stick.y) > 0.2) { f = -stick.y; r = stick.x; }
  // 카메라가 보는 방향 기준 이동
  const fx_ = -Math.cos(yaw), fz = -Math.sin(yaw);
  const dash = dashQueued, interact = interactQueued, skill = skillQueued; dashQueued = interactQueued = false; skillQueued = null;
  return { mx: fx_ * f - fz * r, mz: fz * f + fx_ * r, dash, interact, atk: atkHeld, skill };
}

// 스킬바: 슬롯마다 아이콘·키·충전 수·쿨타임. 터치에서는 누르는 순간 시전하고 평타는 누르고 있는 동안 이어진다
const slots = cls.bar.map(id => {
  const el = document.createElement('button'); el.className = 'sk'; el.dataset.id = id;
  el.innerHTML = '<img alt=""><i class="cdm"></i><b class="key"></b><em class="n"></em><span class="cdt"></span>'; $('skills').append(el);
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch {} if (id === 'atk') atkHeld = true; else if (id === 'dodge') dashQueued = true; else skillQueued = id; });
  const up = () => { if (id === 'atk') atkHeld = false; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return { id, el, img: el.querySelector('img'), key: el.querySelector('.key'), n: el.querySelector('.n'), cdt: el.querySelector('.cdt'), icon: undefined };
});
function drawSkills() {
  const C = sim.combat;
  for (const o of slots) {
    const s = C.slot(o.id);
    if (o.icon !== s.icon) { o.icon = s.icon; o.img.style.display = s.icon ? 'block' : 'none'; if (s.icon) o.img.src = './assets/ui/' + s.icon; o.el.title = s.name; o.key.textContent = s.key ?? ''; if (!s.icon) o.cdt.style.fontSize = '12px'; }
    const wait = s.left > 0 && !s.ready;
    o.el.style.setProperty('--p', s.left > 0 && s.total ? (s.left / s.total).toFixed(3) : 0);
    o.el.classList.toggle('off', !s.ready); o.el.classList.toggle('act', s.active);
    o.n.textContent = s.n ?? ''; o.cdt.textContent = wait ? Math.ceil(s.left) : s.icon ? '' : s.name;
  }
  const L = $('light'), I = cls.ice; L.style.display = cls.light || I ? '' : 'none';
  if (I) {   // 아이스 에너지 막대 + 미스틱 아이스 개수와 버프 남은 시간
    L.firstElementChild.style.width = C.energy / I.max * 100 + '%'; L.classList.toggle('focus', C.perma > 0); L.classList.toggle('recast', C.extreme > 0);
    const b = [C.perma > 0 && `퍼마프로스트 ${C.perma.toFixed(0)}초`, C.extreme > 0 && `극한 ${C.extreme.toFixed(0)}초`, C.iggy > 0 && `이그레우스 ${C.iggy.toFixed(0)}초`, C.boyce > 0 && `보이스 ${C.boyceN}중첩 ${C.boyce.toFixed(0)}초`].filter(Boolean);
    $('resinfo').textContent = `아이스 에너지 ${Math.floor(C.energy)} · 미스틱 아이스 ${'◆'.repeat(C.mystic)}${'◇'.repeat(I.mysticMax - C.mystic)}${b.length ? ' · ' + b.join(' · ') : ''}`; return;
  }
  if (!cls.light) return;
  L.firstElementChild.style.width = C.light / cls.light.max * 100 + '%'; L.classList.toggle('recast', C.recast); L.classList.toggle('focus', C.focus > 0);
}
const BENCH = cls.benchmark?.dps ?? 3450000;
const fmt = v => v >= 1e8 ? (v / 1e8).toFixed(2) + '억' : v >= 1e4 ? Math.round(v / 1e4).toLocaleString() + '만' : Math.round(v).toLocaleString();
let shown = 0;
function hud() {
  const cs = sim.combat.summary(sim.t); $('atk').textContent = `추정 딜 ${fmt(cs.dmg)} · 초당 ${fmt(cs.dps)} (기준의 ${Math.round(cs.dps / BENCH * 100)}%)${sim.combat.recast ? ' · 라이트 리캐스트' : ''}${sim.combat.focus > 0 ? ' · 정신 집중' : ''}`; drawSkills();
  $('clock').textContent = sim.t.toFixed(1) + '초' + (paused && !sim.done && sim.t > 0 ? ' (일시정지)' : '');
  $('tPause').textContent = paused ? '계속' : '정지';
  $('energy').textContent = GRID ? `남은 칸 ${sim.tiles.filter(v => v < 2).length} / ${sim.tiles.length}` : (data.roomEnergyMax ? `${sim.room}번 방 에너지 ${Math.floor(sim.energy)} / ${data.roomEnergyMax}` : `${Math.floor(sim.t)}초 / ${data.duration}초`);
  for (const k in myNotes) myNotes[k].visible = sim.note === k;
  if (sim.note) $('energy').textContent += ` · 내 음표 ${sim.note}`;
  if (sim.trees) $('energy').textContent += ` · 내 역할 ${ROLE[sim.role]} · 상흔 ${sim.scars.size ? [...sim.scars].join('·') : '없음'}`;
  $('bar').firstElementChild.style.width = (GRID || !data.roomEnergyMax ? sim.t / data.duration : sim.energy / data.roomEnergyMax) * 100 + '%';
  $('upcoming').innerHTML = sim.upcoming().slice(0, 5).map(e => `<div class="row"><b>${e.t}초</b><span>${e.name}</span></div>`).join('') || '없음';
  for (; shown < sim.log.length; shown++) {
    const r = sim.log[shown], d = document.createElement('div'); d.className = 'row ' + (r.ok ? 'ok' : 'bad');
    d.innerHTML = `<b>${r.t}</b><span>${r.ok ? '성공' : '실패'} · ${r.name} — ${r.msg}</span>`; $('results').prepend(d);
  }
  const cur = sim.visible().sort((a, b) => a.hitAt - b.hitAt)[0];
  $('cast').style.display = cur ? 'block' : 'none';
  if (cur) $('cast').textContent = `${cur.name} · ${(cur.hitAt - sim.t).toFixed(1)}초`;
  if (sim.done && $('overlay').style.display === 'none') {
    const s = sim.score(); document.exitPointerLock?.();
    $('ovTitle').textContent = `결과 ${s.ok} / ${s.total}`;
    $('ovBody').innerHTML = `추정 딜 ${fmt(cs.dmg)} · 초당 ${fmt(cs.dps)} (기준 ${fmt(BENCH)}의 ${Math.round(cs.dps / BENCH * 100)}%) · 스킬 동작 시간 ${cs.uptime}% · 사거리 밖 ${cs.whiff}회<br><br>` + (sim.log.filter(r => !r.ok).map(r => `${r.t}초 ${r.name} — ${r.msg}`).join('<br>') || '모든 기믹을 처리했습니다.');
    $('start').textContent = '다시 하기'; $('overlay').style.display = 'flex';
  }
}

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now();
function tick(now) {
  // 프레임이 느려도 실제 시간과 맞도록 1/60초 단위로 나눠 진행
  let dt = Math.min(0.25, (now - last) / 1000) * speedMul; last = now;
  const adt = paused || sim.done ? 0 : dt;   // 동작 재생용 경과 시간
  if (!paused && !sim.done && dt > 0) { const inp = input(); for (; dt > 0 && !sim.done; dt -= 1 / 60, inp.dash = inp.interact = false, inp.skill = null) sim.step(Math.min(dt, 1 / 60), inp); }
  const p = sim.player;
  animPlayer(player, p, adt); drainCombat(); drawShots();
  player.ring.material.color.set(p.iframe > 0 ? 0xffffff : sim.combat.recast ? 0xffd24a : sim.combat.act ? 0xd29922 : 0x3fb950);   // 발밑 고리: 흰색 회피 무적, 금색 라이트 리캐스트, 주황 스킬 동작 중
  if (sim.dial) sim.dial.rings.forEach((g, i) => { if (ringObjs[i]) ringObjs[i].rotation.y = -(g.ang - g.ang0) * Math.PI / 180 + (g.rot0 ?? 0); });
  boss.position.set(sim.boss.x, sim.bossY ?? data.boss.y ?? 0, sim.boss.z); boss.scale.setScalar(sim.bossScale ?? 1); if (GRID) { boss.rotation.y = Math.atan2(Math.cos(sim.bossDir), Math.sin(sim.bossDir)); drawTiles(); } else if (data.noCurtain) { boss.rotation.y = Math.atan2(Math.cos(sim.bossFace), Math.sin(sim.bossFace)); boss.position.y += sim.bossAir * (data.boss.jumpH ?? 4); } else face(boss, p); bossAnim(boss); if (sim.clone) bossAnim(clone);
  clone.visible = !!sim.clone; if (sim.clone) { clone.position.set(sim.clone.x, 0, sim.clone.z); face(clone, p); }
  sim.bots.forEach((b, i) => movePerson(bots[i], b, adt, sim.boss));
  drawFx(); scheduleFx(); realFx.update(sim.t); pcFx.update(sim.t);
  camera.position.set(p.x + Math.cos(yaw) * Math.cos(pitch) * zoom, 1.5 + Math.sin(pitch) * zoom, p.z + Math.sin(yaw) * Math.cos(pitch) * zoom);
  camera.lookAt(p.x, 1.5, p.z);
  const fc = window.__sim.freeCam; if (fc) { camera.position.set(fc[0], fc[1], fc[2]); camera.lookAt(fc[3], fc[4], fc[5]); }   // 검증용 고정 시점
  renderer.render(scene, camera); hud();
}
function frame(now) { tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
// 검증·디버깅용 핸들
window.__sim = { sim, data, realFx, pcFx, player, cast: id => skillQueued = id, hold: v => atkHeld = v, keys, scene, camera, boss, tick, setSpeed: v => speedMul = v, restart, view: (y, p, z) => { yaw = y; pitch = p; zoom = z; } };
