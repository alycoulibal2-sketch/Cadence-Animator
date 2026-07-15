// 3D viewport: scene, lights, orbit + transform controls, picking, pose overlay editing.
// Plain relative imports (no import map) — more portable across packaged/asar contexts than
// bare specifiers, and doesn't depend on a CSP hash staying byte-identical to an inline script.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { TransformControls } from '../vendor/three/TransformControls.js';
import * as CF from './cf.js';
import * as S from './state.js';
import { RigInstance, CameraInstance, PART_GAP_SCALE } from './rigbuild.js';

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
};

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
    for (const offset of wanted) {
      const t = playhead + offset;
      const pose = S.evalPose(item, t);
      const origin = S.evalTrackCF(item.id, '@origin', t, item.origin || CF.IDENTITY);
      const worlds = inst.solvePoseWorlds(pose, origin); // pure — never touches the displayed rig
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
  // Shift+right = pan
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      controls.mouseButtons.RIGHT = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }
  }, { capture: true });

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
    if (e.value) viewport.editingDrag = true;
    else {
      viewport.editingDrag = false;
      onGizmoRelease();
    }
  });
  gizmo.addEventListener('objectChange', onGizmoChange);
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
      const inst = item.kind === 'camera' ? new CameraInstance(item, viewport.scene) : new RigInstance(item, viewport.scene);
      inst.setHandlesVisible?.(S.state.handlesVisible);
      inst.setHandleSize?.(S.state.handleSize);
      viewport.instances.set(item.id, inst);
    }
  }
}

export function getInstance(itemId) { return viewport.instances.get(itemId); }

// Rebuild one item's three.js instance from scratch (its rig definition changed underneath it,
// e.g. a Studio "Sync Pose" corrected the bind geometry after native Move/Rotate tool edits).
export function refreshInstance(itemId) {
  const item = S.getItem(itemId);
  if (!item) return;
  const old = viewport.instances.get(itemId);
  if (old) old.dispose();
  const inst = item.kind === 'camera' ? new CameraInstance(item, viewport.scene) : new RigInstance(item, viewport.scene);
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
export function updateScene() {
  const p = S.state.project;
  if (!p) return;
  const t = S.state.playhead;
  for (const item of p.items) {
    const inst = viewport.instances.get(item.id);
    if (!inst) continue;
    const baseOrigin = item.origin || CF.IDENTITY;
    let origin = S.evalTrackCF(item.id, '@origin', t, baseOrigin);
    if (viewport.overlayOrigin.has(item.id)) origin = viewport.overlayOrigin.get(item.id);
    if (item.kind === 'camera') {
      const fov = S.evalTrackNum(item.id, '@fov', t, item.fov || 70);
      inst.computeWorld(origin, fov);
      inst.setBodyVisible(S.state.cameraView !== item.id);
      inst.setFrustumVisible(S.state.cameraView !== item.id && S.state.selection.itemId === item.id);
    } else {
      const pose = S.evalPose(item, t);
      const overlay = viewport.overlayPose.get(item.id);
      if (overlay) Object.assign(pose, overlay);
      inst.computeWorld(pose, origin);

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
  updateGizmoAnchor();
  updateSelBox();
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
  if (partId === '@origin' || partId === '@camera') {
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

function onGizmoChange() {
  if (!viewport.editingDrag) return;
  const { itemId, partId } = S.state.selection;
  if (!itemId || !partId) return;
  const inst = viewport.instances.get(itemId);
  if (!inst) return;
  viewport.dummy.updateMatrixWorld(true);
  const desired = CF.orthonormalize(CF.fromThreeMatrix(viewport.dummy.matrixWorld));

  const item = S.getItem(itemId);
  const isOrigin = partId === '@origin' || partId === '@camera' || partId === item?.rig?.rootPart;
  if (isOrigin) {
    viewport.overlayOrigin.set(itemId, desired);
  } else {
    const r = inst.transformForWorld?.(partId, desired);
    if (!r) { viewport.overlayOrigin.set(itemId, desired); return; }
    if (!viewport.overlayPose.has(itemId)) viewport.overlayPose.set(itemId, {});
    viewport.overlayPose.get(itemId)[r.joint] = r.transform;
  }
  S.emit('overlay');
}

function onGizmoRelease() {
  if (S.state.autoKey) commitOverlays();
}

// ---------------------------------------------------------------- picking
function setPointerFromEvent(e) {
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  viewport.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  viewport.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
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

let downPos = null;
function onPointerDown(e) {
  if (e.button !== 0) return;
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
  viewport.gizmo.setMode(mode);
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
  viewport.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(S.state.rotGridDegrees) : null);
}
