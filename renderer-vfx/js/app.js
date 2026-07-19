// VFX Studio: a standalone window for building a particle effect from scratch, then handing the
// finished result to the main animator window. Deliberately reuses renderer/js/{cf,rigbuild,vfx,
// particleLibrary}.js completely unmodified (same relative-import trick renderer-mobile already
// uses for its shared viewport code) — this window renders/simulates identically to the main app's
// inline VFX item, it just isn't wired to a project/timeline/undo-stack at all. It intentionally
// never imports state.js: that module reaches for `window.cadence` at load time (autosave/close
// flush wiring), which doesn't exist in this window's preload — vfx.js's sampleParticles was
// refactored to take an injectable track-evaluator specifically so this window can omit one
// entirely (see vfx.js's default) instead of needing a fake window.cadence shim.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { OrbitControls } from '../../renderer/vendor/three/OrbitControls.js';
import { VfxInstance } from '../../renderer/js/rigbuild.js';
import { sampleParticles, VFX_DEFAULTS } from '../../renderer/js/vfx.js';
import { PARTICLE_PRESETS, CATEGORIES, SHAPES, MOTIONS, searchPresets } from '../../renderer/js/particleLibrary.js';
import { toast } from '../../renderer/js/ui.js';

const FPS = 30;
const ORIGIN = [0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]; // static, a stud above the ground grid

// ---------------------------------------------------------------- scene
const canvas = document.getElementById('vfxCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
camera.position.set(3.2, 2.4, 3.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 1.1));
const grid = new THREE.GridHelper(10, 20, 0x3a3a46, 0x22222c);
scene.add(grid);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

// ---------------------------------------------------------------- effect state
const startPreset = PARTICLE_PRESETS.find((p) => p.id === 'fire-classic-standard') || PARTICLE_PRESETS[0];
let currentEmitter = { ...VFX_DEFAULTS, ...startPreset.emitter };
let effectName = startPreset.name;

let instance = null;
function rebuildInstance() {
  if (instance) instance.dispose();
  instance = new VfxInstance({ id: 'preview', kind: 'vfx', emitter: currentEmitter }, scene);
}
rebuildInstance();

function updateEmitter(patch, needsRebuild) {
  currentEmitter = { ...currentEmitter, ...patch };
  if (needsRebuild) rebuildInstance();
  renderControls(); // keep numeric fields in sync if applied via a preset click
}

// ---------------------------------------------------------------- real-time preview loop
// sampleParticles is a pure function of a frame NUMBER, not wall-clock time, so a live preview
// just needs to keep feeding it an increasing frame count. It's a made-up, unbounded "timeline"
// here (there's no real one in this window) — the frame count wraps every `loopFrames` so the
// preview loops seamlessly instead of the per-frame cost growing forever the longer this window
// stays open.
let startTime = null;
function restartPreview() { startTime = null; }
document.getElementById('restartBtn').addEventListener('click', restartPreview);

function tick(now) {
  if (startTime == null) startTime = now;
  const elapsed = (now - startTime) / 1000;
  const loopSeconds = Math.max(4, Math.min(12, currentEmitter.lifetime * 2.2 || 4));
  const loopFrames = Math.max(1, Math.round(loopSeconds * FPS));
  const frame = Math.floor(elapsed * FPS) % loopFrames;
  const particles = sampleParticles({ id: 'preview', emitter: currentEmitter }, frame, FPS, () => ORIGIN);
  instance.computeWorld(ORIGIN, particles);
  controls.update();
  resize();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------- controls panel
function row(label, input) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  const l = document.createElement('span');
  l.className = 'l';
  l.textContent = label;
  d.append(l, input);
  return d;
}
function numInput(value, onChange, step) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'fld';
  if (step) input.step = step;
  input.value = value;
  input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
  return input;
}
function colorInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'fld';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return input;
}
function rangeInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0'; input.max = '1'; input.step = '0.01';
  input.value = value;
  input.addEventListener('input', () => onChange(parseFloat(input.value)));
  return input;
}
function selectInput(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'fld';
  for (const o of options) sel.add(new Option(o, o));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
function sectionEl(title) {
  const d = document.createElement('div');
  d.className = 'insp-section';
  const h = document.createElement('div');
  h.className = 'insp-title';
  h.textContent = title;
  d.appendChild(h);
  return d;
}

function renderControls() {
  const body = document.getElementById('vfxControlsBody');
  body.innerHTML = '';
  const em = currentEmitter;

  const behavior = sectionEl('Behavior');
  behavior.appendChild(row('Shape', selectInput(SHAPES, em.shape, (v) => updateEmitter({ shape: v }, true))));
  behavior.appendChild(row('Motion', selectInput(MOTIONS, em.motion, (v) => updateEmitter({ motion: v }))));
  behavior.appendChild(row('Blend mode', selectInput(['normal', 'additive'], em.blendMode, (v) => updateEmitter({ blendMode: v }, true))));
  behavior.appendChild(row('Rate (particles/sec)', numInput(em.rate, (v) => updateEmitter({ rate: Math.max(0, v) }))));
  behavior.appendChild(row('Lifetime (sec)', numInput(em.lifetime, (v) => updateEmitter({ lifetime: Math.max(0.05, v) }), '0.1')));
  behavior.appendChild(row('Speed (studs/sec)', numInput(em.speed, (v) => updateEmitter({ speed: v }), '0.1')));
  behavior.appendChild(row('Spread (degrees)', numInput(em.spreadDegrees, (v) => updateEmitter({ spreadDegrees: Math.max(0, Math.min(90, v)) }))));
  behavior.appendChild(row('Gravity (studs/sec²)', numInput(em.gravity, (v) => updateEmitter({ gravity: v }), '0.1')));
  body.appendChild(behavior);

  const appearance = sectionEl('Appearance');
  appearance.appendChild(row('Color (start)', colorInput(em.colorStart, (v) => updateEmitter({ colorStart: v }))));
  appearance.appendChild(row('Color (end)', colorInput(em.colorEnd, (v) => updateEmitter({ colorEnd: v }))));
  appearance.appendChild(row('Size (start)', numInput(em.sizeStart, (v) => updateEmitter({ sizeStart: Math.max(0.005, v) }), '0.01')));
  appearance.appendChild(row('Size (end)', numInput(em.sizeEnd, (v) => updateEmitter({ sizeEnd: Math.max(0.005, v) }), '0.01')));
  appearance.appendChild(row('Transparency (start)', rangeInput(em.transparencyStart, (v) => updateEmitter({ transparencyStart: v }))));
  appearance.appendChild(row('Transparency (end)', rangeInput(em.transparencyEnd, (v) => updateEmitter({ transparencyEnd: v }))));
  appearance.appendChild(row('Max particles', numInput(em.maxParticles, (v) => updateEmitter({ maxParticles: Math.max(1, Math.min(2000, Math.round(v))) }, true))));
  body.appendChild(appearance);
}
renderControls();

// ---------------------------------------------------------------- preset library sidebar
const nameInput = document.getElementById('vfxNameInput');
nameInput.value = effectName;
nameInput.addEventListener('change', () => { effectName = nameInput.value.trim() || 'Untitled Effect'; nameInput.value = effectName; });

const search = document.getElementById('vfxSearch');
const catSel = document.getElementById('vfxCategory');
for (const c of CATEGORIES) catSel.add(new Option(c, c));

function applyPreset(preset) {
  currentEmitter = { ...VFX_DEFAULTS, ...preset.emitter };
  effectName = preset.name;
  nameInput.value = effectName;
  rebuildInstance();
  restartPreview();
  renderControls();
}

function presetCard(p, onDelete) {
  const card = document.createElement('button');
  card.className = 'choose-card';
  card.innerHTML = `<span class="ic"></span><span class="t"></span><span class="d"></span>`;
  card.querySelector('.ic').textContent = '✨';
  card.querySelector('.t').textContent = p.name;
  card.querySelector('.d').textContent = p.category || '';
  card.addEventListener('click', () => applyPreset(p));
  if (onDelete) {
    const del = document.createElement('span');
    del.className = 'choose-card-delete';
    del.title = 'Delete';
    del.textContent = '🗑';
    del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(p); });
    card.appendChild(del);
  }
  return card;
}

function renderLibraryGrid() {
  const grid = document.getElementById('vfxPresetGrid');
  grid.innerHTML = '';
  const results = searchPresets(search.value, catSel.value).slice(0, 200);
  for (const p of results) grid.appendChild(presetCard(p));
}
search.addEventListener('input', renderLibraryGrid);
catSel.addEventListener('change', renderLibraryGrid);
renderLibraryGrid();

async function renderUserGrid() {
  const list = await window.vfxStudio.listUserPresets();
  const head = document.getElementById('vfxUserPresetsHead');
  const grid = document.getElementById('vfxUserPresetGrid');
  grid.innerHTML = '';
  head.style.display = list.length ? '' : 'none';
  for (const p of list) {
    grid.appendChild(presetCard(p, async (preset) => {
      await window.vfxStudio.deleteUserPreset(preset.id);
      renderUserGrid();
    }));
  }
}
renderUserGrid();

// ---------------------------------------------------------------- title bar actions
document.getElementById('saveUserPresetBtn').addEventListener('click', async () => {
  const preset = { id: `user-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: effectName, category: 'My Presets', emitter: { ...currentEmitter } };
  await window.vfxStudio.saveUserPreset(preset);
  toast(`Saved "${effectName}" to your presets`);
  renderUserGrid();
});

document.getElementById('sendBtn').addEventListener('click', () => {
  window.vfxStudio.sendToAnimator({ name: effectName, emitter: { ...currentEmitter } });
  toast(`Sent "${effectName}" to the animator`);
});
