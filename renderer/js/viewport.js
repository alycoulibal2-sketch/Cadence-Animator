// 3D viewport: scene, lights, orbit + transform controls, picking, pose overlay editing.
// Plain relative imports (no import map) — more portable across packaged/asar contexts than
// bare specifiers, and doesn't depend on a CSP hash staying byte-identical to an inline script.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { TransformControls } from '../vendor/three/TransformControls.js';
import * as CF from './cf.js';
import * as S from './state.js';
import { RigInstance, CameraInstance, VfxInstance, EffectInstance, PART_GAP_SCALE, updateEdgeResolution } from './rigbuild.js';
import { viewportPalette } from './themes.js';
import { buildChain, solveIK } from './ik.js';
import { sampleParticles } from './vfx.js';
import { sampleEffect } from './effectEngine.js';

const ghostGapVector = new THREE.Vector3(PART_GAP_SCALE, PART_GAP_SCALE, PART_GAP_SCALE);

export const viewport = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  gizmo: null,
  dummy: null,
  instances: new Map(),
  overlayPose: new Map(),   // itemId -> { joint -> transform }
  overlayOrigin: new Map(), // itemId -> cf
  hovered: null,
  selBox: null,
  container: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  editingDrag: false,
  onionGhosts: new Map(), // itemId -> OnionGhostSet
  trackballMode: false,
  ikMode: false, // IK tool: drag a limb's end part, the joint chain above it follows
  dragHud: null, // { text } while a move/rotate/scale drag is live, read by app.js's render loop
};

// Snapshot of the dummy's transform at the start of the current drag — used both for the live
// HUD readout (delta from here) and to detect whether a scale drag actually changed anything.
export const dragStart = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
// QA-only: drives the exact same drag-start/change/release path TransformControls itself would,
// without needing to raycast synthetic pointer events against its picker geometry.
export function debugSimulateDrag(applyFn) {
  viewport.editingDrag = true;
  dragStart.pos.copy(viewport.dummy.position);
  dragStart.quat.copy(viewport.dummy.quaternion);
  dragStart.scale.copy(viewport.dummy.scale);
  applyFn(viewport.dummy);
  viewport.dummy.updateMatrixWorld(true);
  onGizmoChange();
  const hud = viewport.dragHud;
  onGizmoRelease();
  viewport.editingDrag = false;
  viewport.dragHud = null;
  return hud;
}
let shiftHeld = false;
function applyLiveSnap() {
  const rotOn = S.state.rotGridSnap || shiftHeld;
  const posOn = S.state.posGridSnap || shiftHeld;
  viewport.gizmo.setRotationSnap(rotOn ? THREE.MathUtils.degToRad(S.state.rotGridDegrees) : null);
  viewport.gizmo.setTranslationSnap(posOn ? S.state.posGridDistance : null);
}

// ---------------------------------------------------------------- onion skin
// Ghost silhouettes of nearby frames, reusing the live rig's own (possibly still-loading)
// part geometry each frame rather than duplicating/reloading any assets.
class OnionGhostSet {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.userData.nonSelectable = true;
    scene.add(this.group);
    this.slotMeshes = new Map(); // slotOffset -> partId -> Mesh
  }
  #slotGroup(offset) {
    let byPart = this.slotMeshes.get(offset);
    if (!byPart) { byPart = new Map(); this.slotMeshes.set(offset, byPart); }
    return byPart;
  }
  update(inst, item, playhead, range, projectLength) {
    const wanted = new Set();
    for (let k = 1; k <= range; k++) {
      if (playhead - k >= 0) wanted.add(-k);
      if (playhead + k <= projectLength) wanted.add(k);
    }
    for (const [offset] of this.slotMeshes) {
      if (!wanted.has(offset)) this.#disposeSlot(offset);
    }
    const unparented = S.unparentedSet(item.id);
    for (const offset of wanted) {
      const t = playhead + offset;
      const pose = S.evalPose(item, t);
      const origin = S.evalTrackCF(item.id, '@origin', t, item.origin || CF.IDENTITY);
      const worlds = inst.solvePoseWorlds(pose, origin, unparented); // pure — never touches the displayed rig
      const isPast = offset < 0;
      const falloff = 1 - (Math.abs(offset) - 1) / range;
      const opacity = Math.max(0.05, 0.32 * falloff);
      const byPart = this.#slotGroup(offset);
      for (const [partId, p] of inst.parts) {
        if (p.def.transparency >= 0.99) continue; // skip invisible root etc.
        const world = worlds.get(partId);
        if (!world) continue;
        let mesh = byPart.get(partId);
        if (!mesh) {
          const mat = new THREE.MeshBasicMaterial({
            color: isPast ? 0x5fa8ff : 0xff9d5f, transparent: true, depthWrite: false,
          });
          mesh = new THREE.Mesh(p.mesh.geometry, mat);
          mesh.raycast = () => { };
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
          byPart.set(partId, mesh);
        }
        if (mesh.geometry !== p.mesh.geometry) mesh.geometry = p.mesh.geometry;
        mesh.material.opacity = opacity;
        CF.toThreeMatrix(world, mesh.matrix);
        mesh.matrix.scale(ghostGapVector);
      }
    }
  }
  #disposeSlot(offset) {
    const byPart = this.slotMeshes.get(offset);
    if (!byPart) return;
    for (const [, mesh] of byPart) { this.group.remove(mesh); mesh.material.dispose(); }
    this.slotMeshes.delete(offset);
  }
  dispose() {
    for (const [offset] of this.slotMeshes) this.#disposeSlot(offset);
    this.scene.remove(this.group);
  }
}

export function initViewport(container) {
  viewport.container = container;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  viewport.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101016');
  scene.fog = new THREE.Fog('#101016', 90, 260);
  viewport.scene = scene;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
  camera.position.set(9, 7, 12);
  viewport.camera = camera;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.target.set(0, 2.5, 0);
  controls.mouseButtons = {
    LEFT: null, // left is for selection
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.zoomSpeed = 0.9;
  viewport.controls = controls;
  // Shift+right = pan. Capture-phase so this runs and rewrites mouseButtons BEFORE
  // OrbitControls' own (bubble-phase) pointerdown handler reads it on the same event.
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      controls.mouseButtons.RIGHT = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }
  }, { capture: true });

  // Trackpad mode (Blender's "Emulate 3 Button Mouse"): Alt+LMB-drag orbits, Alt+Shift+LMB-drag
  // pans, Alt+Ctrl+LMB-drag dollies — for trackpads/laptops with no middle button. Same
  // capture-phase-mutate-before-OrbitControls-reads-it trick as the RIGHT-button remap above.
  // Plain LMB (no Alt) always leaves mouseButtons.LEFT untouched (stays null) so
  // selection/gizmo-dragging is completely unaffected whether this mode is on or off.
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (S.state.trackpadMode && e.altKey) {
      controls.mouseButtons.LEFT = e.shiftKey ? THREE.MOUSE.PAN : e.ctrlKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    } else {
      controls.mouseButtons.LEFT = null;
    }
  }, { capture: true });

  // Trackpad mode, continued: a genuine two-finger drag on the trackpad — touching and moving,
  // no physical click needed — arrives in Chromium as a `wheel` event, not a pointer/touch event
  // (trackpads don't expose individual finger contacts to a web page the way a touchscreen does).
  // A real pinch-to-zoom gesture is ALSO reported as `wheel`, but synthetically with ctrlKey:true
  // — that's how Chromium/Electron always distinguishes the two — so pinch is left completely
  // alone here and still zooms via OrbitControls' own default wheel handling below. Capture phase +
  // stopPropagation so OrbitControls' own (bubble-phase) wheel listener never sees a gesture this
  // code already handled, the same trick used for the button remaps above. A two-finger TAP
  // (no drag) needs no code at all: Windows/macOS trackpad drivers already deliver that as a
  // genuine right mouse button event before it reaches the browser, identical to a physical
  // right-click, which the RIGHT-button remap above already handles.
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!S.state.trackpadMode || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const offset = camera.position.clone().sub(controls.target);
    if (e.shiftKey) {
      // Pan: nudge camera and target together along the camera's own screen-space right/up axes
      // — same convention OrbitControls' own right-drag pan uses — scaled by distance to target
      // so the pan speed stays visually consistent whether zoomed in close or far out. Signs
      // flipped to match the orbit reversal above, per the same direct feedback.
      const panSpeed = (offset.length() * Math.tan((camera.fov / 2) * Math.PI / 180) * 2) / renderer.domElement.clientHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(e.deltaX * panSpeed);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-e.deltaY * panSpeed);
      camera.position.add(right).add(up);
      controls.target.add(right).add(up);
    } else {
      // Orbit: adjust azimuth/polar angle around the current target — same math OrbitControls
      // itself uses internally for a rotate drag. Signs flipped from the first pass per direct
      // feedback that the initial direction felt backwards.
      const ROTATE_SPEED = 0.0035;
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += e.deltaX * ROTATE_SPEED;
      spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi + e.deltaY * ROTATE_SPEED));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      camera.lookAt(controls.target);
    }
    controls.update();
  }, { capture: true, passive: false });

  // lights
  const hemi = new THREE.HemisphereLight('#cdd3e6', '#3a3d4d', 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffffff', 1.7);
  key.position.set(14, 26, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#aab4ff', 0.35);
  fill.position.set(-12, 8, -14);
  scene.add(fill);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(120, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#16161e', roughness: 1 }),
  );
  ground.receiveShadow = true;
  ground.position.y = -0.02;
  ground.userData.nonSelectable = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(120, 60, '#2e2e3c', '#22222d');
  grid.position.y = 0.0;
  grid.userData.nonSelectable = true;
  scene.add(grid);

  // Scene surfaces can't inherit CSS variables — retint them from the active theme's palette,
  // both now (a persisted non-default theme is applied before initViewport runs) and on switch.
  const applySceneTheme = () => {
    const pal = viewportPalette();
    scene.background.set(pal.bg);
    scene.fog.color.set(pal.bg);
    ground.material.color.set(pal.ground);
    // GridHelper bakes its two colors into vertex colors at construction — cheapest correct
    // retint is tinting the line material against white vertex colors, so approximate with the
    // major color for the whole grid (visually indistinguishable at viewport zoom levels).
    grid.material.color.set(pal.grid1);
    grid.material.vertexColors = false;
    grid.material.needsUpdate = true;
  };
  applySceneTheme();
  S.on('theme', applySceneTheme);

  const axes = new THREE.AxesHelper(2.4);
  axes.position.y = 0.01;
  axes.userData.nonSelectable = true;
  scene.add(axes);

  // gizmo
  const dummy = new THREE.Object3D();
  scene.add(dummy);
  viewport.dummy = dummy;
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.9);
  gizmo.setSpace('local');
  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (e.value) {
      viewport.editingDrag = true;
      dragStart.pos.copy(dummy.position);
      dragStart.quat.copy(dummy.quaternion);
      dragStart.scale.copy(dummy.scale);
      applyLiveSnap();
    } else {
      viewport.editingDrag = false;
      viewport.dragHud = null;
      onGizmoRelease();
    }
  });
  gizmo.addEventListener('objectChange', onGizmoChange);
  // Shift held during a drag temporarily forces snap on, on top of whatever the persistent C-key
  // toggle already has it at — released, it goes back to just the toggle's own state.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftHeld) { shiftHeld = true; applyLiveSnap(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') { shiftHeld = false; applyLiveSnap(); }
  });
  window.addEventListener('blur', () => { shiftHeld = false; applyLiveSnap(); });
  const gizmoRoot = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  gizmoRoot.traverse?.((o) => (o.userData.nonSelectable = true));
  scene.add(gizmoRoot);
  viewport.gizmo = gizmo;

  // selection box
  const selBox = new THREE.Box3Helper(new THREE.Box3(), '#7c8cff');
  selBox.visible = false;
  selBox.userData.nonSelectable = true;
  scene.add(selBox);
  viewport.selBox = selBox;

  // picking
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  S.on('items', syncItems);
  S.on('project', () => { clearOverlays(); syncItems(); });
  S.on('selection', onSelectionChanged);
  S.on('playhead', () => { if (!viewport.editingDrag) clearOverlays(false); });
}

function resize() {
  const { container, renderer, camera } = viewport;
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Edge-overlay LineMaterial sizes its line width in physical pixels relative to this — stale
  // after a resize would make every part's outline read too thick or too thin.
  const ratio = renderer.getPixelRatio();
  updateEdgeResolution(w * ratio, h * ratio);
}

// ---------------------------------------------------------------- items
export function syncItems() {
  const items = S.state.project ? S.state.project.items : [];
  const wanted = new Set(items.map((i) => i.id));
  for (const [id, inst] of viewport.instances) {
    if (!wanted.has(id)) {
      inst.dispose();
      viewport.instances.delete(id);
      const ghosts = viewport.onionGhosts.get(id);
      if (ghosts) { ghosts.dispose(); viewport.onionGhosts.delete(id); }
    }
  }
  for (const item of items) {
    if (!viewport.instances.has(item.id)) {
      const inst = makeInstance(item);
      inst.setHandlesVisible?.(S.state.handlesVisible);
      inst.setHandleSize?.(S.state.handleSize);
      viewport.instances.set(item.id, inst);
    }
  }
}

function makeInstance(item) {
  if (item.kind === 'camera') return new CameraInstance(item, viewport.scene);
  if (item.kind === 'vfx') return new VfxInstance(item, viewport.scene);
  if (item.kind === 'effect') return new EffectInstance(item, viewport.scene);
  return new RigInstance(item, viewport.scene, {
    onMeshError: (def, kind, reason) => S.emit('mesh-error', { itemId: item.id, itemName: item.name, partName: def.name, kind, reason }),
  });
}

export function getInstance(itemId) { return viewport.instances.get(itemId); }

// Rebuild one item's three.js instance from scratch (its rig definition changed underneath it,
// e.g. a Studio "Sync Pose" corrected the bind geometry after native Move/Rotate tool edits).
export function refreshInstance(itemId) {
  const item = S.getItem(itemId);
  if (!item) return;
  const old = viewport.instances.get(itemId);
  if (old) old.dispose();
  const inst = makeInstance(item);
  viewport.instances.set(itemId, inst);
  if (S.state.selection.itemId === itemId) onSelectionChanged();
}

// ---------------------------------------------------------------- overlays (unkeyed pose edits)
export function clearOverlays(notify = true) {
  if (viewport.overlayPose.size === 0 && viewport.overlayOrigin.size === 0) return;
  viewport.overlayPose.clear();
  viewport.overlayOrigin.clear();
  if (notify) S.emit('overlay');
}

export function hasOverlays() {
  return viewport.overlayPose.size > 0 || viewport.overlayOrigin.size > 0;
}

// Write all pending overlay edits as keyframes at the playhead
export function commitOverlays() {
  if (!hasOverlays()) return false;
  const t = Math.round(S.state.playhead);
  S.pushUndo();
  for (const [itemId, joints] of viewport.overlayPose) {
    for (const [joint, cf] of Object.entries(joints)) {
      S.setKey(itemId, joint, t, cf, { noUndo: true });
    }
  }
  for (const [itemId, cf] of viewport.overlayOrigin) {
    S.setKey(itemId, '@origin', t, cf, { noUndo: true });
  }
  viewport.overlayPose.clear();
  viewport.overlayOrigin.clear();
  S.emit('overlay');
  return true;
}

// ---------------------------------------------------------------- per-frame update
// Attached items (props held/carried by another item — see attachItem) are processed in a
// second pass, after every unattached item already has a fresh solved pose this frame, so the
// prop always reads its parent part's CURRENT position rather than a stale one from last frame.
export function updateScene() {
  const p = S.state.project;
  if (!p) return;
  const t = S.state.playhead;
  const unattached = [], attached = [];
  for (const item of p.items) (item.attachedTo ? attached : unattached).push(item);
  for (const item of unattached) updateOneItem(item, t);
  for (const item of attached) updateOneItem(item, t);
  updateGizmoAnchor();
  updateSelBox();
}

function updateOneItem(item, t) {
  const inst = viewport.instances.get(item.id);
  if (!inst) return;
  if (item.attachedTo) {
    const parentInst = viewport.instances.get(item.attachedTo.itemId);
    const parentWorld = parentInst?.partWorld?.(item.attachedTo.partId);
    let origin = parentWorld ? CF.mul(parentWorld, item.attachedTo.offset) : (item.origin || CF.IDENTITY);
    if (viewport.overlayOrigin.has(item.id)) origin = viewport.overlayOrigin.get(item.id);
    applyOrigin(item, inst, origin, t);
    return;
  }
  const baseOrigin = item.origin || CF.IDENTITY;
  let origin = S.evalTrackCF(item.id, '@origin', t, baseOrigin);
  if (viewport.overlayOrigin.has(item.id)) origin = viewport.overlayOrigin.get(item.id);
  applyOrigin(item, inst, origin, t);
}

function applyOrigin(item, inst, origin, t) {
  const p = S.state.project;
  if (item.kind === 'camera') {
    const fov = S.evalTrackNum(item.id, '@fov', t, item.fov || 70);
    inst.computeWorld(origin, fov);
    inst.setBodyVisible(S.state.cameraView !== item.id);
    inst.setFrustumVisible(S.state.cameraView !== item.id && S.state.selection.itemId === item.id);
  } else if (item.kind === 'vfx') {
    // Each particle's spawn-time origin is resolved independently (it may have been a different
    // frame's pose for a moving/attached emitter) — reuse the exact same per-frame origin logic
    // updateOneItem just used for `t`, generalized to arbitrary spawn frames `f`.
    const resolveOriginAt = (f) => {
      if (item.attachedTo) {
        const parentInst = viewport.instances.get(item.attachedTo.itemId);
        const parentWorld = parentInst?.partWorld?.(item.attachedTo.partId);
        return parentWorld ? CF.mul(parentWorld, item.attachedTo.offset) : (item.origin || CF.IDENTITY);
      }
      return S.evalTrackCF(item.id, '@origin', f, item.origin || CF.IDENTITY);
    };
    const particles = sampleParticles(item, Math.round(t), p.fps, resolveOriginAt, S.evalTrackNum);
    inst.computeWorld(origin, particles);
  } else if (item.kind === 'effect') {
    // Doc-frame <-> project-frame mapping (docs/vfx-studio.md "Frame-space contract"): the
    // engine's resolveOrigin callback receives DOC frames; convert back to project frames to
    // reuse the exact same attach-chain/@origin resolution logic above (inherently project-
    // frame), then hand the result straight through untouched.
    const doc = item.effect;
    if (!doc) { inst.computeWorld(origin, null); return; }
    const fps = doc.fps || 30;
    const resolveOriginAt = (docF) => {
      const projF = (item.effectStart || 0) + (docF * p.fps) / fps;
      if (item.attachedTo) {
        const parentInst = viewport.instances.get(item.attachedTo.itemId);
        const parentWorld = parentInst?.partWorld?.(item.attachedTo.partId);
        return parentWorld ? CF.mul(parentWorld, item.attachedTo.offset) : (item.origin || CF.IDENTITY);
      }
      return S.evalTrackCF(item.id, '@origin', projF, item.origin || CF.IDENTITY);
    };
    const docFrame = S.effectDocFrame(item, Math.round(t));
    const sample = docFrame < 0 ? null : sampleEffect(doc, docFrame, { origin, resolveOrigin: resolveOriginAt });
    inst.computeWorld(origin, sample);
  } else {
    const pose = S.evalPose(item, t);
    const overlay = viewport.overlayPose.get(item.id);
    if (overlay) Object.assign(pose, overlay);
    inst.computeWorld(pose, origin, S.unparentedSet(item.id));

    const onionOn = p.onionSkin.enabledItemIds.includes(item.id);
    if (onionOn) {
      let ghosts = viewport.onionGhosts.get(item.id);
      if (!ghosts) { ghosts = new OnionGhostSet(viewport.scene); viewport.onionGhosts.set(item.id, ghosts); }
      ghosts.update(inst, item, t, p.onionSkin.range, p.length);
    } else if (viewport.onionGhosts.has(item.id)) {
      viewport.onionGhosts.get(item.id).dispose();
      viewport.onionGhosts.delete(item.id);
    }
  }
}

export function render() {
  let cam = viewport.camera;
  if (S.state.cameraView) {
    const inst = viewport.instances.get(S.state.cameraView);
    if (inst && inst.camera) {
      cam = inst.camera;
      cam.aspect = viewport.camera.aspect;
      cam.updateProjectionMatrix();
    }
  }
  viewport.controls.update();
  viewport.renderer.render(viewport.scene, cam);
}

// ---------------------------------------------------------------- selection & gizmo
function selectedWorld() {
  const { itemId, partId } = S.state.selection;
  if (!itemId || !partId) return null;
  const inst = viewport.instances.get(itemId);
  if (!inst) return null;
  if (partId === '@origin' || partId === '@camera' || partId === '@vfx') {
    const item = S.getItem(itemId);
    let origin = S.evalTrackCF(itemId, '@origin', S.state.playhead, item.origin || CF.IDENTITY);
    if (viewport.overlayOrigin.has(itemId)) origin = viewport.overlayOrigin.get(itemId);
    return origin;
  }
  return inst.partWorld(partId);
}

function onSelectionChanged() {
  const { itemId, partId } = S.state.selection;
  const inst = itemId ? viewport.instances.get(itemId) : null;
  for (const [, i] of viewport.instances) i.setHighlight?.(null, 0);
  if (!inst || !partId) {
    viewport.gizmo.detach();
    viewport.selBox.visible = false;
    return;
  }
  inst.setHighlight?.(partId, 2);
  updateGizmoAnchor(true);
  viewport.gizmo.attach(viewport.dummy);
}

function updateGizmoAnchor(force = false) {
  if (viewport.editingDrag && !force) return;
  const world = selectedWorld();
  if (!world) return;
  const m = new THREE.Matrix4();
  CF.toThreeMatrix(world, m);
  m.decompose(viewport.dummy.position, viewport.dummy.quaternion, viewport.dummy.scale);
  viewport.dummy.updateMatrixWorld(true);
}

function updateSelBox() {
  const { itemId, partId } = S.state.selection;
  const inst = itemId ? viewport.instances.get(itemId) : null;
  if (inst && partId && inst.parts && inst.parts.has(partId)) {
    const mesh = inst.parts.get(partId).mesh;
    viewport.selBox.box.setFromObject(mesh);
    viewport.selBox.visible = true;
  } else {
    viewport.selBox.visible = false;
  }
}

// Resizing is always whole-rig and uniform (matches Roblox Studio's Model-scale: every handle —
// single-axis, planar, or the center cube — drives the same one proportional factor, never a
// lopsided per-axis stretch). Stock TransformControls still reports independent x/y/z deltas on
// `viewport.dummy.scale` depending on which literal handle was grabbed, so the axis that moved
// furthest from 1 is treated as "the" drag and its value is used for all three — for a single-axis
// handle that's exactly the axis you dragged; for a planar/uniform handle all axes already agree.
function dominantScaleFactor(v) {
  const dx = Math.abs(v.x - 1), dy = Math.abs(v.y - 1), dz = Math.abs(v.z - 1);
  if (dx >= dy && dx >= dz) return v.x;
  return dy >= dz ? v.y : v.z;
}
let liveScaleFactor = 1;

function onGizmoChange() {
  if (!viewport.editingDrag) return;
  const { itemId, partId } = S.state.selection;
  if (!itemId) return;
  const inst = viewport.instances.get(itemId);
  if (!inst) return;

  // trackball leaves the gizmo's own internal mode untouched (it never calls setMode while
  // active — see setGizmoMode), so it must be checked first or a stale 'scale' mode from before
  // switching to trackball would wrongly take the scale branch below.
  if (!viewport.trackballMode && viewport.gizmo.getMode() === 'scale') {
    // Resize is not part of the animatable pose pipeline — preview it by scaling the whole rig's
    // render group directly, bake into the rest definition on release (see onGizmoRelease).
    //
    // Every part's mesh carries its own ABSOLUTE WORLD matrix (baked in by computeWorld(), not
    // relative to inst.group at all) — so naively setting inst.group.scale alone scales every
    // part's position AROUND WORLD ORIGIN (0,0,0), not around the model's own pivot. Any item not
    // sitting exactly at world origin (i.e. nearly every item — addRigItem's groundOriginFor
    // spaces new items out from x=-4) visibly drifts toward/away from origin while shrinking or
    // growing, sliding out from under the gizmo instead of resizing in place around it. Fix:
    // scale around `pivot` (the gizmo's own anchor, viewport.dummy.position — unmoved throughout
    // a pure-scale drag) by also offsetting the group's position: newPos = pivot*(1-factor) +
    // factor*oldPos, i.e. group.position = pivot*(1-factor), group.scale = factor. Reset both in
    // onGizmoRelease so a released/no-op drag never leaves this offset behind.
    liveScaleFactor = dominantScaleFactor(viewport.dummy.scale);
    if (inst.group) {
      const pivot = viewport.dummy.position;
      inst.group.position.set(pivot.x * (1 - liveScaleFactor), pivot.y * (1 - liveScaleFactor), pivot.z * (1 - liveScaleFactor));
      inst.group.scale.setScalar(liveScaleFactor);
    }
    viewport.dragHud = { text: `Scale: ${(liveScaleFactor * 100).toFixed(0)}%` };
    return;
  }

  if (!partId) return;
  viewport.dummy.updateMatrixWorld(true);
  const desired = CF.orthonormalize(CF.fromThreeMatrix(viewport.dummy.matrixWorld));

  const item = S.getItem(itemId);

  // IK: the dragged gizmo is a TARGET the limb chases, not the part's own new transform. The
  // solved chain transforms land in overlayPose exactly like a normal single-joint edit, so
  // preview, auto-key, commit, and undo all ride the existing pipeline unchanged. A part with
  // no motor chain above it (the root, a loose part) falls through to the regular move below.
  if (viewport.ikMode && !viewport.trackballMode && item?.rig && partId !== '@origin' && partId !== '@camera') {
    const chain = buildChain(item, partId, S.state.ikChainLength);
    if (chain.length) {
      const target = [viewport.dummy.position.x, viewport.dummy.position.y, viewport.dummy.position.z];
      const basePose = S.evalPose(item, S.state.playhead);
      Object.assign(basePose, viewport.overlayPose.get(itemId) || {});
      // Displayed root world = the true current origin, including attachment/overlay effects.
      const origin = inst.partWorld(item.rig.rootPart);
      const res = solveIK(inst, item, partId, target, { basePose, origin });
      if (res) {
        if (!viewport.overlayPose.has(itemId)) viewport.overlayPose.set(itemId, {});
        Object.assign(viewport.overlayPose.get(itemId), res.pose);
        S.emit('overlay');
        viewport.dragHud = { text: `IK (${res.chain.length} joint${res.chain.length > 1 ? 's' : ''}): ${res.error.toFixed(2)} studs off target` };
        return;
      }
    }
  }

  const isOrigin = partId === '@origin' || partId === '@camera' || partId === '@vfx' || partId === item?.rig?.rootPart;
  if (isOrigin) {
    viewport.overlayOrigin.set(itemId, desired);
  } else {
    const r = inst.transformForWorld?.(partId, desired, S.unparentedSet(itemId));
    if (!r) {
      // Not directly motor-driven (welded, or reached only through welds/static offsets from
      // root) — there's no per-joint Transform to solve for, so move the ORIGIN by exactly the
      // amount needed to land this part at `desired`, holding every other joint's current pose
      // fixed. Naively doing `overlayOrigin.set(itemId, desired)` here (as if this part WERE the
      // root) ignores this part's own offset from root, dragging the entire rig sideways by that
      // offset — confirmed live: rotating a part welded 2 studs from root dragged the whole rig
      // 2 studs off to the side instead of just rotating in place.
      const newOrigin = inst.originForWorld?.(partId, desired);
      viewport.overlayOrigin.set(itemId, newOrigin || desired);
      S.emit('overlay');
      return;
    }
    if (!viewport.overlayPose.has(itemId)) viewport.overlayPose.set(itemId, {});
    viewport.overlayPose.get(itemId)[r.joint] = r.transform;
  }
  S.emit('overlay');

  if (viewport.trackballMode || viewport.gizmo.getMode() === 'rotate') {
    const deg = THREE.MathUtils.radToDeg(dragStart.quat.angleTo(viewport.dummy.quaternion));
    viewport.dragHud = { text: `Rotate: ${deg.toFixed(1)}°` };
  } else {
    const d = viewport.dummy.position.clone().sub(dragStart.pos);
    viewport.dragHud = { text: `Move: ${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)}` };
  }
}

function onGizmoRelease() {
  const { itemId } = S.state.selection;
  if (!viewport.trackballMode && viewport.gizmo.getMode() === 'scale' && itemId) {
    const inst = viewport.instances.get(itemId);
    // Bake exactly the factor that was just being live-previewed — reading a fresh
    // `viewport.dummy.scale.x` here (instead of the same value onGizmoChange already computed
    // and showed in the HUD) was the bug: dragging any handle but X/uniform would preview one
    // thing and then bake a different (often no-op) result on release.
    const factor = liveScaleFactor;
    viewport.dummy.scale.set(1, 1, 1);
    // Reset BOTH the scale and the pivot-compensation position — if refreshInstance() below
    // doesn't run (a released/no-op drag, factor≈1), this same `inst` keeps rendering afterward,
    // so any leftover position offset here would otherwise permanently shift the model.
    if (inst?.group) { inst.group.scale.set(1, 1, 1); inst.group.position.set(0, 0, 0); }
    liveScaleFactor = 1;
    if (Math.abs(factor - 1) > 0.001) {
      S.resizeItem(itemId, factor);
      refreshInstance(itemId);
    }
    return;
  }
  if (S.state.autoKey) commitOverlays();
}

// ---------------------------------------------------------------- picking
function setPointerFromEvent(e) {
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  viewport.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  viewport.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

export function debugPick(e) {
  return pick(e);
}
function pick(e) {
  setPointerFromEvent(e);
  viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
  const meshes = [];
  for (const [, inst] of viewport.instances) {
    if (inst.parts) {
      for (const [, p] of inst.parts) { if (p.mesh.visible) meshes.push(p.mesh); }
      if (inst.handles) for (const h of inst.handles) { if (h.mesh.visible) meshes.push(h.mesh); }
    } else if (inst.group) inst.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  }
  const hits = viewport.raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].object : null;
}

// ---------------------------------------------------------------- trackball posing
// Blender-style alternative to the rotate gizmo: click-drag the selected part anywhere on its
// surface to spin it like a physical trackball, instead of dragging one axis ring at a time.
// Classic Shoemake arcball technique — maps 2D mouse movement onto a virtual hemisphere and
// takes the rotation between the start and current points, reuses the SAME dummy/overlay/commit
// pipeline the translate/rotate gizmo already drives (onGizmoChange / onGizmoRelease below), so
// undo, auto-key, and overlay preview all work identically no matter which tool posed the part.
const trackball = { active: false, startVec: new THREE.Vector3(), startQuat: new THREE.Quaternion() };

function arcballVector(ndcX, ndcY) {
  const d2 = ndcX * ndcX + ndcY * ndcY;
  if (d2 <= 1) return new THREE.Vector3(ndcX, ndcY, Math.sqrt(1 - d2));
  return new THREE.Vector3(ndcX, ndcY, 0).normalize();
}

function startTrackballDrag(e) {
  trackball.active = true;
  viewport.editingDrag = true;
  viewport.controls.enabled = false;
  setPointerFromEvent(e);
  trackball.startVec.copy(arcballVector(viewport.pointer.x, viewport.pointer.y));
  trackball.startQuat.copy(viewport.dummy.quaternion);
  dragStart.quat.copy(viewport.dummy.quaternion); // shared HUD snapshot, see onGizmoChange

  const move = (me) => {
    setPointerFromEvent(me);
    const curVec = arcballVector(viewport.pointer.x, viewport.pointer.y);
    const camLocalDelta = new THREE.Quaternion().setFromUnitVectors(trackball.startVec, curVec);
    // camLocalDelta rotates around axes measured in camera space (arcballVector's x/y/z map to
    // camera right/up/forward) — conjugate by the camera's world orientation to get the same
    // rotation expressed in world space before applying it to the part.
    const camQuat = viewport.camera.quaternion;
    const worldDelta = camQuat.clone().multiply(camLocalDelta).multiply(camQuat.clone().invert());
    viewport.dummy.quaternion.copy(worldDelta).multiply(trackball.startQuat);
    viewport.dummy.updateMatrixWorld(true);
    onGizmoChange();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    trackball.active = false;
    viewport.editingDrag = false;
    viewport.controls.enabled = true;
    viewport.dragHud = null;
    onGizmoRelease();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

let downPos = null;
function onPointerDown(e) {
  if (e.button !== 0) return;
  if (viewport.trackballMode) {
    const { itemId, partId } = S.state.selection;
    const hit = pick(e);
    if (itemId && partId && hit && hit.userData.itemId === itemId && hit.userData.partId === partId) {
      startTrackballDrag(e);
      return;
    }
  }
  downPos = [e.clientX, e.clientY];
  const up = (ue) => {
    window.removeEventListener('pointerup', up);
    if (!downPos) return;
    const moved = Math.hypot(ue.clientX - downPos[0], ue.clientY - downPos[1]);
    downPos = null;
    if (moved > 4 || viewport.editingDrag) return;
    const hit = pick(ue);
    if (hit && hit.userData.itemId) {
      S.setSelection(hit.userData.itemId, hit.userData.partId);
    } else {
      S.setSelection(null, null);
    }
  };
  window.addEventListener('pointerup', up);
}

let hoverThrottle = 0;
function onPointerMove(e) {
  const now = performance.now();
  if (now - hoverThrottle < 40 || viewport.editingDrag) return;
  hoverThrottle = now;
  const hit = pick(e);
  const key = hit ? `${hit.userData.itemId}/${hit.userData.partId}` : null;
  if (key === viewport.hovered) return;
  viewport.hovered = key;
  for (const [id, inst] of viewport.instances) {
    if (!inst.setHighlight) continue;
    const selectedHere = S.state.selection.itemId === id ? S.state.selection.partId : null;
    if (hit && hit.userData.itemId === id && hit.userData.partId !== selectedHere) {
      inst.setHighlight(hit.userData.partId, 1);
      if (selectedHere) inst.setHighlight(selectedHere, 2);
    } else {
      inst.setHighlight(selectedHere, selectedHere ? 2 : 0);
    }
  }
  viewport.renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
}

// ---------------------------------------------------------------- public controls
export function setGizmoMode(mode) {
  viewport.ikMode = mode === 'ik';
  if (mode === 'trackball') {
    viewport.trackballMode = true;
    viewport.gizmo.enabled = false;
    viewport.gizmo.visible = false;
  } else {
    viewport.trackballMode = false;
    viewport.gizmo.enabled = true;
    viewport.gizmo.visible = true;
    // IK drives the translate gizmo (drag the target point); the branch in onGizmoChange
    // decides whether the drag means "move this part" or "solve the chain toward here".
    viewport.gizmo.setMode(mode === 'ik' ? 'translate' : mode);
  }
  S.emit('gizmo-mode', mode);
}
export function toggleGizmoSpace() {
  const next = viewport.gizmo.space === 'local' ? 'world' : 'local';
  viewport.gizmo.setSpace(next);
  S.emit('gizmo-space', next);
  return next;
}
export function focusSelected() {
  const world = selectedWorld();
  if (!world) return;
  viewport.controls.target.set(world[0], world[1], world[2]);
}
export function frameAll() {
  viewport.controls.target.set(0, 2.5, 0);
  viewport.camera.position.set(9, 7, 12);
}
// QA-only: arbitrary camera placement for scripted close-up screenshots.
export function debugFrame(target, pos) {
  viewport.controls.target.set(target[0], target[1], target[2]);
  viewport.camera.position.set(pos[0], pos[1], pos[2]);
  viewport.controls.update();
}

export function setHandlesVisible(v) {
  S.state.handlesVisible = v;
  for (const [, inst] of viewport.instances) inst.setHandlesVisible?.(v);
}
export function setHandleSize(size) {
  S.state.handleSize = size;
  for (const [, inst] of viewport.instances) inst.setHandleSize?.(size);
}
export function setRotationSnap(on, degrees) {
  S.state.rotGridSnap = on;
  if (degrees) S.state.rotGridDegrees = degrees;
  applyLiveSnap();
}
export function setTranslationSnap(on, distance) {
  S.state.posGridSnap = on;
  if (distance) S.state.posGridDistance = distance;
  applyLiveSnap();
}
