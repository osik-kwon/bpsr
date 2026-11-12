// 화면·입력 담당. 판정은 engine.js가 계산한다. assets/의 GLB(tools/simasset.py 산출물)가 없으면 자체 도형으로 그린다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sim, roomAngle } from './engine.js';
import { Fx } from './fx.js';

const scenario = new URLSearchParams(location.search).get('s') || 'boss1-hard';
const data = await (await fetch(`./data/${scenario}.json`)).json();
const spd = +new URLSearchParams(location.search).get('speed'); if (spd > 0) data.player.speed = spd;   // 이동 속도 덮어쓰기(?speed=5)
const sim = new Sim(data);
const $ = id => document.getElementById(id);
$('title').textContent = data.title;

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
if (!GRID) loadGlb('./assets/' + data.arena.model).then(env => { if (env) { scene.add(env.scene); disc.visible = false; } });
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
function label(text, size = 3, color = '#ffffff') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = color; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true })); s.scale.set(size, size, 1); return s;
}
for (let n = 1; n <= (GRID ? 0 : 4); n++) { const s = label(String(n), 5, '#58a6ff'); s.position.set(Math.cos(roomAngle(n)) * (R - 5), 6, Math.sin(roomAngle(n)) * (R - 5)); scene.add(s); }

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
    const e = data.events[i], name = A[e.type], c = g.clips[name];
    if (c && t >= e.t && t < e.t + c.duration) return setPose(g, name, t - e.t);
  }
  const idle = g.clips[A.idle]; if (idle) setPose(g, A.idle, t % idle.duration);
}
const boss = actor(0x4a4f5c, data.boss.model), clone = actor(0xe26fa8, data.boss.model, 0xff7eb6);
// 모델 정면(+z)이 대상을 보게 돌린다
const face = (o, t) => { const dx = t.x - o.position.x, dz = t.z - o.position.z; if (dx * dx + dz * dz > 0.01) o.rotation.y = Math.atan2(dx, dz); };
// 나와 파티원: 인게임 캐릭터 모델(tools/bossanim.py char 산출물). 파일이 없으면 캡슐로 그린다
const PCS = ['pc_f1.glb', 'pc_m1.glb', 'pc_f2.glb', 'pc_m2.glb', 'pc_f3.glb', 'pc_m3.glb', 'pc_f4.glb', 'pc_m4.glb'];
function person(color, model) {
  const g = new THREE.Group(); scene.add(g);
  const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color })); cap.position.y = 0.9; g.add(cap);
  g.ring = flat(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))); g.ring.position.y = 0.07; g.add(g.ring);
  g.last = null;
  loadGlb('./assets/' + model).then(m => {
    if (!m) return;
    g.remove(cap); g.add(m.scene); m.scene.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
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
const pcN = +new URLSearchParams(location.search).get('pc') || 0;
const player = person(0x3fb950, PCS[pcN % PCS.length]);
const bots = sim.bots.map((_, i) => person(0x9aa4b2, PCS[(pcN + i + 1) % PCS.length]));

// 실제 이펙트: 새로 생긴 예고·코어를 보고 시전·타격 시각에 재생을 걸어 둔다
const realFx = new Fx(scene, './assets/fx/'); let seen = new WeakSet();
function scheduleFx() {
  const F = data.fx ?? {};
  for (const s of sim.tele) {
    if (seen.has(s)) continue; seen.add(s);
    const m = F[s.type]; if (!m) continue;
    const spots = m.at === 'boss' ? [sim.boss] : s.shape === 'multi' ? s.spots : s.shape === 'line' ? [{ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 }] : [s];
    const yaw = m.at === 'boss' ? boss.rotation.y : 0, done = new Set();
    for (const p of spots) {
      const key = p.x.toFixed(1) + ',' + p.z.toFixed(1); if (done.has(key)) continue; done.add(key);
      if (m.cast) realFx.play(m.cast, s.showFrom ?? s.start, p.x, p.z, yaw);
      if (m.hit) realFx.play(m.hitByColor?.[s.color] ?? m.hit, s.hitAt, p.x, p.z, yaw);
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
const COLORS = { red: 0xf85149, pink: 0xff7eb6, blue: 0x58a6ff, yellow: 0xd29922 };
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
  for (const c of [...fx.children]) { c.geometry?.dispose(); c.material?.dispose(); fx.remove(c); }
  for (const s of sim.visible()) {
    const fill = s.live ? 1 : Math.min(1, (sim.t - (s.showFrom ?? s.start)) / Math.max(0.1, s.hitAt - (s.showFrom ?? s.start)));
    // 거리 비례(far)는 안전 거리 바깥이 안전하다는 뜻으로 테두리만 진하게
    if (s.orb) { const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xb38cff, transparent: true, opacity: 0.85 })); m.position.set(s.x, 2.6, s.z); fx.add(m); }
    for (const part of s.shape === 'multi' ? s.spots : [s]) fx.add(shapeMesh(part, COLORS[s.color], s.kind === 'far' || s.kind === 'show' ? fill * 0.4 : fill));
  }
  for (const c of sim.cores) { const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb38cff })); m.position.set(c.x, 1.4, c.z); fx.add(m); }
  for (const mk of sim.markers) { const m = flat(new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 32), new THREE.MeshBasicMaterial({ color: 0x3fb950, side: THREE.DoubleSide }))); m.position.set(mk.x, 0.08, mk.z); fx.add(m); }
  if (sim.tether) {
    // 대상 3명을 잇는 삼각형 줄(확정 전에는 내 꼭짓점이 나를 따라온다)
    const { A, B, C, V } = sim.tether, me = C ?? V ?? sim.player;
    if (!C) for (const [a, b] of [[A, B], [B, me], [me, A]]) { const m = shapeMesh({ shape: 'line', a, b, w: 0.5 }, 0x58d6ff, 1); m.position.y = 0.12; fx.add(m); }
  }
}

// 입력: 키보드·마우스 전용
const keys = new Set(); let yaw = GRID ? -Math.PI / 2 : roomAngle(1) + Math.PI, pitch = 0.5, zoom = 16, paused = true, dashQueued = false, interactQueued = false, speedMul = 1;
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'Space') { dashQueued = true; e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') interactQueued = true;
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyP' && !sim.done) paused = !paused;
  if (e.code === 'KeyT') setLock(!sim.attackLock);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// 포인터 잠금이 거부되는 환경에서는 드래그로 시점을 돌린다
const lock = () => { try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch {} };
renderer.domElement.addEventListener('click', lock);
let dragging = false;
renderer.domElement.addEventListener('mousedown', () => dragging = true); addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement && !dragging) return;
  yaw += e.movementX * 0.0035; pitch = Math.max(0.12, Math.min(1.35, pitch + e.movementY * 0.003));
});
addEventListener('wheel', e => { zoom = Math.max(6, Math.min(45, zoom + e.deltaY * 0.02)); }, { passive: true });
function restart() { sim.reset(); realFx.clear(); seen = new WeakSet(); paused = false; $('overlay').style.display = 'none'; $('results').innerHTML = ''; shown = 0; }
$('start').onclick = () => { restart(); lock(); };

function input() {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  // 카메라가 보는 방향 기준 이동
  const fx_ = -Math.cos(yaw), fz = -Math.sin(yaw);
  const dash = dashQueued, interact = interactQueued; dashQueued = interactQueued = false;
  return { mx: fx_ * f - fz * r, mz: fz * f + fx_ * r, dash, interact };
}

// 공격 중 이동 묶임 옵션(기본 꺼짐, T로 전환, 주소의 lock=1로 켬)
function setLock(on) { sim.attackLock = on; try { localStorage.setItem('lock', on ? '1' : '0'); } catch {} $('lockState').textContent = on ? '켜짐' : '꺼짐'; }
{ const q = new URLSearchParams(location.search).get('lock'); let saved = null; try { saved = localStorage.getItem('lock'); } catch {} setLock((q ?? saved ?? '0') === '1'); }
let shown = 0;
function hud() {
  $('atk').textContent = sim.attackLock ? `공격 가동 ${sim.t > 0 ? Math.round(sim.player.attackTime / sim.t * 100) : 0}%${sim.player.lock > 0 ? ' · 공격 중' : ''}` : '';
  $('clock').textContent = sim.t.toFixed(1) + '초' + (paused && !sim.done && sim.t > 0 ? ' (일시정지)' : '');
  $('energy').textContent = GRID ? `남은 칸 ${sim.tiles.filter(v => v < 2).length} / ${sim.tiles.length}` : `${sim.room}번 방 에너지 ${Math.floor(sim.energy)} / ${data.roomEnergyMax}`;
  $('bar').firstElementChild.style.width = (GRID ? sim.t / data.duration : sim.energy / data.roomEnergyMax) * 100 + '%';
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
    $('ovBody').innerHTML = sim.log.filter(r => !r.ok).map(r => `${r.t}초 ${r.name} — ${r.msg}`).join('<br>') || '모든 기믹을 처리했습니다.';
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
  if (!paused && !sim.done) { const inp = input(); for (; dt > 0 && !sim.done; dt -= 1 / 60, inp.dash = inp.interact = false) sim.step(Math.min(dt, 1 / 60), inp); }
  const p = sim.player;
  movePerson(player, p, adt, sim.boss);
  player.ring.material.color.set(p.iframe > 0 ? 0xffffff : p.lock > 0 ? 0xd29922 : 0x3fb950);   // 발밑 고리: 흰색 대시 무적, 주황 공격 중(이동 불가)
  boss.position.set(sim.boss.x, data.boss.y ?? 0, sim.boss.z); if (GRID) { boss.rotation.y = Math.atan2(Math.cos(sim.bossDir), Math.sin(sim.bossDir)); drawTiles(); } else face(boss, p); bossAnim(boss); if (sim.clone) bossAnim(clone);
  clone.visible = !!sim.clone; if (sim.clone) { clone.position.set(sim.clone.x, 0, sim.clone.z); face(clone, p); }
  sim.bots.forEach((b, i) => movePerson(bots[i], b, adt, sim.boss));
  drawFx(); scheduleFx(); realFx.update(sim.t);
  camera.position.set(p.x + Math.cos(yaw) * Math.cos(pitch) * zoom, 1.5 + Math.sin(pitch) * zoom, p.z + Math.sin(yaw) * Math.cos(pitch) * zoom);
  camera.lookAt(p.x, 1.5, p.z);
  const fc = window.__sim.freeCam; if (fc) { camera.position.set(fc[0], fc[1], fc[2]); camera.lookAt(fc[3], fc[4], fc[5]); }   // 검증용 고정 시점
  renderer.render(scene, camera); hud();
}
function frame(now) { tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
// 검증·디버깅용 핸들
window.__sim = { sim, data, realFx, keys, scene, camera, boss, tick, setSpeed: v => speedMul = v, restart, view: (y, p, z) => { yaw = y; pitch = p; zoom = z; } };
