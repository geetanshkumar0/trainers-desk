/* Trainer Desk background: a 3D "learning universe" behind the page.
 *  - a flowing wave of ~12k glowing particles that ripples under the pointer; a click sends a shockwave
 *  - glossy, colour-shifting crystals floating around the page; they lean toward the pointer, spin up on hover
 *    and drift with scrolling
 * Three.js (served from /vendor). Never takes clicks from the page. Pauses in hidden tabs; draws a
 * single still frame when the person prefers reduced motion; lighter on phones. Light theme by default. */
import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const root = document.documentElement;

/* ---------- theme (light by default; the switch remembers a choice) ---------- */
let saved = null;
try { saved = localStorage.getItem('desk-theme'); } catch (e) {}
root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
const isDark = () => root.getAttribute('data-theme') === 'dark';
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const btn = document.createElement('button');
btn.id = 'desk-theme'; btn.type = 'button';
function paintBtn() { btn.innerHTML = isDark() ? SUN : MOON; btn.title = btn.ariaLabel = isDark() ? 'Switch to light theme' : 'Switch to dark theme'; }
btn.onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('desk-theme', next); } catch (e) {}
  paintBtn(); applyTheme();
};

/* ---------- setup ---------- */
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = Math.min(innerWidth, innerHeight) < 700;
const aurora = document.createElement('div'); aurora.id = 'desk-glow';
const canvas = document.createElement('canvas'); canvas.id = 'desk-bg'; canvas.setAttribute('aria-hidden', 'true');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = null;                                         // no WebGL: the CSS gradient alone still looks fine
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.6, 13);
const lookAt = new THREE.Vector3(0, 0.4, 0);

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.25 : 1.6));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
}

/* ---------- 1. particle wave ---------- */
const COLS = small ? 110 : 190, ROWS = small ? 60 : 92, SPAN_X = 34, SPAN_Z = 18;
const pos = new Float32Array(COLS * ROWS * 3), seed = new Float32Array(COLS * ROWS);
for (let r = 0, i = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++, i++) {
  pos[i * 3] = (c / (COLS - 1) - 0.5) * SPAN_X;
  pos[i * 3 + 1] = 0;
  pos[i * 3 + 2] = (r / (ROWS - 1) - 0.5) * SPAN_Z;
  seed[i] = Math.random();
}
const waveGeo = new THREE.BufferGeometry();
waveGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
waveGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
const MAX_RIPPLES = 6;
const waveUniforms = {
  uTime: { value: 0 }, uMouse: { value: new THREE.Vector3(999, 0, 999) }, uMouseOn: { value: 0 },
  uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3(0, 0, -100)) },
  uPixel: { value: renderer ? renderer.getPixelRatio() : 1 },
  uC1: { value: new THREE.Color('#6366f1') }, uC2: { value: new THREE.Color('#a855f7') }, uC3: { value: new THREE.Color('#06b6d4') },
  uAlpha: { value: 0.9 }, uGlow: { value: 0.0 }
};
const waveMat = new THREE.ShaderMaterial({
  uniforms: waveUniforms, transparent: true, depthWrite: false,
  vertexShader: `
    uniform float uTime; uniform vec3 uMouse; uniform float uMouseOn; uniform vec3 uRipples[${MAX_RIPPLES}]; uniform float uPixel;
    attribute float aSeed; varying float vH; varying float vD; varying float vX; varying float vSeed;
    void main(){
      vec3 p = position;
      float t = uTime;
      float h = sin(p.x * 0.32 + t * 0.9) * 0.7 + sin(p.z * 0.55 - t * 0.7) * 0.5 + sin((p.x + p.z) * 0.18 + t * 0.4) * 0.8 + sin(p.x * 0.9 - t * 1.6) * 0.12;
      // pointer: a soft lift with a ring around it
      float dm = distance(p.xz, uMouse.xz);
      h += uMouseOn * (exp(-dm * dm * 0.09) * 1.5 + sin(dm * 2.2 - t * 5.0) * exp(-dm * 0.35) * 0.35);
      // clicks: expanding shockwaves
      for (int i = 0; i < ${MAX_RIPPLES}; i++) {
        float age = t - uRipples[i].z;
        if (age > 0.0 && age < 4.0) {
          float d = distance(p.xz, uRipples[i].xy);
          float front = age * 6.0;
          h += sin((d - front) * 1.6) * exp(-abs(d - front) * 0.9) * (1.0 - age / 4.0) * 1.4;
        }
      }
      p.y = h;
      vH = h; vX = position.x; vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vD = -mv.z;
      gl_PointSize = (2.8 + aSeed * 2.0 + max(h, 0.0) * 1.6) * uPixel * (14.0 / vD);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uAlpha; uniform float uGlow; uniform float uTime;
    varying float vH; varying float vD; varying float vX; varying float vSeed;
    void main(){
      vec2 q = gl_PointCoord - 0.5; float r = length(q);
      if (r > 0.5) discard;
      float soft = smoothstep(0.5, 0.0, r);
      float k = clamp(vX / 34.0 + 0.5, 0.0, 1.0);
      vec3 col = mix(uC1, uC2, smoothstep(0.0, 0.6, k));
      col = mix(col, uC3, smoothstep(0.55, 1.0, k) * 0.8 + clamp(vH * 0.25, 0.0, 0.4));
      float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + vSeed * 40.0);
      float fade = smoothstep(30.0, 9.0, vD);
      gl_FragColor = vec4(col + uGlow * soft * 0.35, soft * uAlpha * fade * twinkle);
    }`
});
const wave = new THREE.Points(waveGeo, waveMat);
wave.position.set(0, -2.7, -1.5);
wave.rotation.x = 0.08;
scene.add(wave);

/* ---------- 2. floating crystals ---------- */
const crystals = new THREE.Group();
scene.add(crystals);
function glossy(color) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.16, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08,
    iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
    sheen: 0.8, sheenColor: new THREE.Color('#c4b5fd'), envMapIntensity: 1.35,
    emissive: new THREE.Color(color).multiplyScalar(0.12)
  });
}
const specs = small
  ? [
      { g: new THREE.IcosahedronGeometry(0.95, 0), c: '#818cf8', p: [-3.6, -2.6, -2], s: 1 },
      { g: new THREE.TorusKnotGeometry(0.6, 0.2, 140, 18), c: '#e879f9', p: [3.4, -2.2, -3], s: 1 }
    ]
  : [
      // kept to the edges and the lower half, so they never sit behind headings or numbers
      { g: new THREE.IcosahedronGeometry(1.25, 0), c: '#818cf8', p: [-10.6, -1.6, -5], s: 1 },
      { g: new THREE.TorusKnotGeometry(0.95, 0.28, 200, 22), c: '#e879f9', p: [10.4, 2.2, -4.5], s: 1 },
      { g: new THREE.OctahedronGeometry(0.85, 0), c: '#22d3ee', p: [9.2, -2.6, -2.5], s: 1 },
      { g: new THREE.TorusGeometry(0.9, 0.24, 32, 120), c: '#a78bfa', p: [-12.2, 3.6, -7], s: 1 },
      { g: new THREE.DodecahedronGeometry(0.55, 0), c: '#f472b6', p: [3.8, 5.6, -9], s: 1 },
      { g: new THREE.SphereGeometry(0.5, 48, 48), c: '#7dd3fc', p: [-3.6, -3.4, 1.2], s: 1 }
    ];
specs.forEach((sp, i) => {
  const m = new THREE.Mesh(sp.g, glossy(sp.c));
  m.position.set(...sp.p);
  m.userData = { home: new THREE.Vector3(...sp.p), spin: 0.15 + Math.random() * 0.25, phase: Math.random() * 6.28, hover: 0, push: new THREE.Vector3() };
  m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  crystals.add(m);
});
// a ring of tiny light points orbiting the largest crystal
const orbitGeo = new THREE.BufferGeometry();
const ORB = 140, orbPos = new Float32Array(ORB * 3);
for (let i = 0; i < ORB; i++) { const a = (i / ORB) * Math.PI * 2; orbPos[i * 3] = Math.cos(a) * 2; orbPos[i * 3 + 1] = Math.sin(a * 3) * 0.08; orbPos[i * 3 + 2] = Math.sin(a) * 2; }
orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
const orbit = new THREE.Points(orbitGeo, new THREE.PointsMaterial({ size: 0.06, color: '#818cf8', transparent: true, opacity: 0.85, depthWrite: false }));
orbit.position.copy(crystals.children[0].position);
orbit.rotation.set(0.6, 0, 0.3);
scene.add(orbit);

scene.add(new THREE.HemisphereLight('#ffffff', '#c7d2fe', 0.7));
const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(4, 8, 6); scene.add(key);
const rim = new THREE.PointLight('#a855f7', 30, 30); rim.position.set(-6, 3, 4); scene.add(rim);

/* ---------- theme colours ---------- */
function applyTheme() {
  const d = isDark();
  waveUniforms.uAlpha.value = d ? 1.0 : 1.0;
  waveUniforms.uGlow.value = d ? 1.0 : 0.0;
  waveUniforms.uC1.value.set(d ? '#818cf8' : '#4f46e5');
  waveUniforms.uC2.value.set(d ? '#c084fc' : '#9333ea');
  waveUniforms.uC3.value.set(d ? '#22d3ee' : '#0891b2');
  if (renderer) renderer.toneMappingExposure = d ? 0.95 : 1.08;
  if (still) render(0);
}

/* ---------- interaction ---------- */
const pointer = new THREE.Vector2(0, 0), target = new THREE.Vector2(0, 0);
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2.7);
const hit = new THREE.Vector3();
let pointerIn = false, ripple = 0, scrollY = 0, hovered = null;
addEventListener('pointermove', e => {
  target.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerIn = true;
}, { passive: true });
document.addEventListener('pointerleave', () => { pointerIn = false; });
addEventListener('scroll', () => { scrollY = scrollY * 0 + (window.scrollY || 0); }, { passive: true });
addEventListener('pointerdown', e => {
  // clicks still reach the page; the wave answers with a shockwave where the pointer is
  const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(p, camera);
  if (ray.ray.intersectPlane(plane, hit)) {
    const local = wave.worldToLocal(hit.clone());
    waveUniforms.uRipples.value[ripple % MAX_RIPPLES].set(local.x, local.z, waveUniforms.uTime.value);
    ripple++;
  }
}, { passive: true });

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function render(t) {
  if (!renderer) return;
  waveUniforms.uTime.value = t;
  pointer.lerp(target, 0.06);
  // camera drifts with the pointer and sinks a little as the page scrolls
  const sy = Math.min(scrollY, 1600);
  camera.position.x = pointer.x * 0.9;
  camera.position.y = 2.6 + pointer.y * 0.5 - sy * 0.0012;
  camera.lookAt(lookAt.x, lookAt.y - sy * 0.0008, lookAt.z);

  // pointer on the wave
  ray.setFromCamera(pointer, camera);
  if (pointerIn && ray.ray.intersectPlane(plane, hit)) { const l = wave.worldToLocal(hit.clone()); waveUniforms.uMouse.value.set(l.x, 0, l.z); }
  waveUniforms.uMouseOn.value += ((pointerIn ? 1 : 0) - waveUniforms.uMouseOn.value) * 0.05;

  // crystals: float, lean toward the pointer, spin up and glow when hovered, shy away from it
  const hits = ray.intersectObjects(crystals.children, false);
  hovered = pointerIn && hits.length ? hits[0].object : null;
  document.body.classList.toggle('desk-bg-hover', !!hovered);
  crystals.children.forEach((m, i) => {
    const u = m.userData;
    u.hover += ((m === hovered ? 1 : 0) - u.hover) * 0.08;
    const bob = Math.sin(t * 0.8 + u.phase) * 0.35;
    const screen = m.position.clone().project(camera);
    const dx = screen.x - pointer.x, dy = screen.y - pointer.y, dist = Math.hypot(dx, dy);
    const shy = pointerIn ? Math.max(0, 0.35 - dist) * 2.2 : 0;
    u.push.lerp(new THREE.Vector3(dx * shy, dy * shy, 0), 0.06);
    m.position.set(u.home.x + u.push.x, u.home.y + bob + u.push.y - sy * 0.0015 * (i % 2 ? 1 : 1.6), u.home.z);
    m.rotation.x += 0.004 + u.spin * 0.006 + u.hover * 0.05;
    m.rotation.y += 0.006 + u.spin * 0.008 + u.hover * 0.06;
    m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, pointer.x * 0.6, 0.03);
    const s = 1 + u.hover * 0.22 + Math.sin(t * 1.3 + u.phase) * 0.02;
    m.scale.setScalar(s);
    m.material.emissive.set(m.material.color).multiplyScalar(0.12 + u.hover * 0.45);
  });
  orbit.position.copy(crystals.children[0].position);
  orbit.rotation.y = t * 0.6;
  rim.position.x = -6 + Math.sin(t * 0.3) * 3;
  renderer.render(scene, camera);
}

let running = false;
function frame() { if (!running) return; render(clock.getElapsedTime()); requestAnimationFrame(frame); }
function start() { if (still || running || document.hidden || !renderer) return; running = true; requestAnimationFrame(frame); }
function stop() { running = false; }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (renderer) renderer.setSize(innerWidth, innerHeight, false);
  if (still) render(0);
});

/* ---------- page touches: top bar shadow once scrolled, home cards light up where the pointer is ---------- */
addEventListener('scroll', () => document.body.classList.toggle('desk-scrolled', (window.scrollY || 0) > 4), { passive: true });
document.addEventListener('pointermove', e => {
  const card = e.target.closest && e.target.closest('.card');
  if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
}, { passive: true });

function boot() {
  document.body.prepend(aurora, canvas);
  document.body.appendChild(btn);
  paintBtn(); applyTheme();
  if (still) render(0); else start();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
