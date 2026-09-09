// Diagnostic render passes (directive Part 43) — the GPU half of the Observation Layer.
//
// This file exists so that `renderer/js/ai/` never has to. The semantic layer reasons about
// pixels; it must not import three.js, and the purity test in `test/aitest.mjs` enforces that. So
// the split is: everything here produces a plain `{ width, height, encoding, data }` byte buffer
// and hands it over, and every comparison, policy and explanation lives on the other side of that
// boundary in `ai/raster.js`, `ai/observe.js` and `ai/explain.js`.
//
// Three properties are load-bearing and worth stating before the code, because losing any of them
// silently would turn a regression engine into a random-number generator:
//
//   NO ANTIALIASING. Passes render to a plain render target with AA off. A silhouette pixel is
//   either subject or background, and an object-ID pixel is exactly one object's index. Exact
//   comparison is exact. The cost is sub-pixel precision at edges, which is stated in the results.
//
//   SAME VIEWPOINT OR NO COMPARISON. Every raster carries a camera fingerprint. If the user nudged
//   the orbit between a baseline and a check, every silhouette moves and a naive engine reports a
//   whole-body regression with total confidence. `ai/raster.js` refuses to compare across
//   viewpoints, and `withCamera` below lets a caller reproduce the baseline's exact viewpoint.
//
//   SUBJECT ONLY. The scene contains a ground plane, a grid, joint handles, per-part selection
//   boxes (opacity 0, but `visible: true` so they stay raycast targets — under a flat override
//   material they would render as SOLID BOXES), gizmos and onion ghosts. Every pass hides all of
//   it and renders rig part meshes alone. Anything not re-enabled is not in the pass, and
//   `passSubjects()` is the list of what is.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { viewport } from './viewport.js';
import * as S from './state.js';
import { cameraFingerprint, makeRaster, rasterDigest, signature } from './ai/raster.js';
import { partId as partEntityId } from './ai/ids.js';

const DEFAULT_SIZE = 192;
const MAX_SIZE = 512;

let target = null;      // reused across calls; reallocated when the size changes
let readBuffer = null;
const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
const idMaterials = new Map(); // index -> MeshBasicMaterial

function ensureTarget(width, height) {
  if (target && target.width === width && target.height === height) return target;
  if (target) target.dispose();
  target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    // NoColorSpace: the ID pass writes indices, not colours, and any sRGB conversion on the way
    // out would corrupt them into a neighbouring object's index.
    colorSpace: THREE.NoColorSpace,
  });
  readBuffer = new Uint8Array(width * height * 4);
  return target;
}

/** The camera the viewport is actually rendering through — the free orbit camera, or a scene
 *  camera item when one is being looked through. Matches `viewport.render()` exactly, because a
 *  pass rendered from a different camera than the user is looking at is a lie about what they see. */
function activeCamera() {
  if (S.state.cameraView) {
    const inst = viewport.instances.get(S.state.cameraView);
    if (inst && inst.camera) return { camera: inst.camera, source: `item:${S.state.cameraView}` };
  }
  return { camera: viewport.camera, source: 'viewport' };
}

/** Every rig part mesh currently in the scene, with the entity id that names it. Props, effect
 *  items, screen effects, cameras, the ground and the grid are not here — see the header. */
export function passSubjects() {
  const out = [];
  for (const [itemId, inst] of viewport.instances) {
    if (!inst.parts || !inst.parts.size) continue;
    for (const [partId, p] of inst.parts) {
      if (!p.mesh) continue;
      // The SAME id `ai/ids.js` mints, minted by the same function — an object-ID pass whose
      // palette named parts slightly differently from the scene graph would be unjoinable to
      // every other result in the system, and the mismatch would look like a missing object.
      out.push({ itemId, partId, mesh: p.mesh, entityId: partEntityId(itemId, partId) });
    }
  }
  return out;
}

/**
 * Hide everything renderable, re-show only the subject meshes that were already visible, run `fn`,
 * then put every single object back exactly as it was.
 *
 * "Already visible" matters: a part at transparency 1 is deliberately invisible, and forcing it
 * into a silhouette would make the pass disagree with the beauty render about what is on screen.
 */
function withSubjectsOnly(subjects, fn) {
  const { scene } = viewport;
  const prev = new Map();
  scene.traverse((o) => {
    if (o.material) { prev.set(o, o.visible); o.visible = false; }
  });
  const shown = [];
  for (const s of subjects) {
    if (prev.get(s.mesh)) { s.mesh.visible = true; shown.push(s); }
  }
  try {
    return fn(shown);
  } finally {
    for (const [o, v] of prev) o.visible = v;
  }
}

function withRenderState(fn) {
  const { renderer, scene } = viewport;
  const prevTarget = renderer.getRenderTarget();
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const prevOverride = scene.overrideMaterial;
  const prevToneMapping = renderer.toneMapping;
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.enabled;

  scene.background = null;
  scene.fog = null;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x000000, 1);
  try {
    return fn();
  } finally {
    renderer.setRenderTarget(prevTarget);
    scene.background = prevBackground;
    scene.fog = prevFog;
    scene.overrideMaterial = prevOverride;
    renderer.toneMapping = prevToneMapping;
    renderer.shadowMap.enabled = prevShadow;
    renderer.setClearColor(prevClear, prevClearAlpha);
  }
}

/**
 * Point the camera at a recorded fingerprint for the duration of `fn`, then put it back.
 *
 * This is what makes a baseline usable an hour later: the user has orbited since, and comparing
 * against the baseline means reproducing its exact viewpoint rather than hoping. Camera state is
 * session state, not project data, so moving it temporarily changes nothing that can be saved.
 */
function withCamera(camera, fingerprint, fn) {
  if (!fingerprint || fingerprint.source !== 'viewport') return fn();
  const pos = camera.position.clone();
  const quat = camera.quaternion.clone();
  const fov = camera.fov;
  try {
    camera.position.fromArray(fingerprint.position);
    camera.quaternion.fromArray(fingerprint.quaternion);
    camera.fov = fingerprint.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return fn();
  } finally {
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
}

function idColour(index) {
  let m = idMaterials.get(index);
  if (m) return m;
  // The index goes into the low byte of R, the next into G, the next into B. Written through a
  // MeshBasicMaterial with toneMapped off, to a NoColorSpace target, so the byte that comes back
  // is the byte that went in. `unclassified_pixels` in ai/raster.js is the safety net if a driver
  // ever disagrees — it counts pixels the palette cannot name rather than guessing.
  m = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false });
  m.color.setRGB((index & 0xff) / 255, ((index >> 8) & 0xff) / 255, ((index >> 16) & 0xff) / 255, THREE.LinearSRGBColorSpace);
  idMaterials.set(index, m);
  return m;
}

/**
 * Render one or more passes at the current pose, and return them as plain rasters.
 *
 * The caller is responsible for having scrubbed to the frame it wants and for the pose having
 * been painted — `scrub_to_frame` in app.js already double-rAFs for exactly this reason.
 *
 * @param opts.passes  'silhouette' | 'object_id'
 * @param opts.camera  a fingerprint from a baseline, to reproduce its viewpoint
 * @returns `{ rasters: [...], subjects, skipped }`
 */
export function renderPasses({ passes = ['silhouette'], frame = null, size = DEFAULT_SIZE, camera: wantCamera = null } = {}) {
  const { renderer, scene } = viewport;
  if (!renderer || !scene) throw new Error('the viewport is not initialised, so no pass can be rendered');

  const dim = Math.max(32, Math.min(MAX_SIZE, Math.round(size)));
  const rt = ensureTarget(dim, dim);
  const { camera, source } = activeCamera();
  const known = ['silhouette', 'object_id'];
  const skipped = passes.filter((p) => !known.includes(p));
  const wanted = passes.filter((p) => known.includes(p));

  const rasters = [];
  withRenderState(() => {
    withCamera(camera, wantCamera, () => {
      const prevAspect = camera.aspect;
      camera.aspect = 1; // the target is square; the framing must be deterministic, not the panel's
      camera.updateProjectionMatrix();
      const fingerprint = cameraFingerprint({
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: camera.fov,
        aspect: 1,
        source,
      });

      const subjects = passSubjects();
      withSubjectsOnly(subjects, (shown) => {
        for (const pass of wanted) {
          renderer.setRenderTarget(rt);
          renderer.clear(true, true, true);

          let palette = null;
          const swapped = [];
          if (pass === 'silhouette') {
            scene.overrideMaterial = silhouetteMaterial;
          } else {
            // Per-mesh materials, not an override: an override cannot vary per object, and the
            // whole point of the ID pass is that it does.
            scene.overrideMaterial = null;
            palette = {};
            shown.forEach((s, i) => {
              const index = i + 1; // 0 is background and must never name an object
              palette[index] = s.entityId;
              swapped.push([s.mesh, s.mesh.material]);
              s.mesh.material = idColour(index);
            });
          }

          try {
            renderer.render(scene, camera);
            renderer.readRenderTargetPixels(rt, 0, 0, dim, dim, readBuffer);
          } finally {
            for (const [mesh, mat] of swapped) mesh.material = mat;
            scene.overrideMaterial = null;
          }

          rasters.push(toRaster(pass, frame, dim, readBuffer, fingerprint, palette));
        }
      });

      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    });
  });

  return {
    rasters,
    subject_count: passSubjects().length,
    skipped: skipped.map((p) => ({ pass: p, reason: 'not implemented — see ai/observe.js PASSES for what blocks it' })),
  };
}

// readRenderTargetPixels returns rows BOTTOM-UP (OpenGL convention). Flipping here rather than in
// the comparison code means every raster in the system has the same origin, and a region reported
// as "y: 12" means twelve rows down from the top of the image as a human would see it.
function toRaster(pass, frame, dim, rgba, fingerprint, palette) {
  if (pass === 'silhouette') {
    const data = new Uint8Array(dim * dim);
    for (let y = 0; y < dim; y++) {
      const src = (dim - 1 - y) * dim * 4;
      for (let x = 0; x < dim; x++) data[y * dim + x] = rgba[src + x * 4];
    }
    return makeRaster({ pass, frame, width: dim, height: dim, encoding: 'gray8', data, camera: fingerprint });
  }
  const data = new Uint8Array(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    const src = (dim - 1 - y) * dim * 4;
    data.set(rgba.subarray(src, src + dim * 4), y * dim * 4);
  }
  return makeRaster({ pass, frame, width: dim, height: dim, encoding: 'id8', data, camera: fingerprint, palette });
}

/**
 * The session's raster store.
 *
 * A baseline in the project file carries a digest and a 16x16 signature per observation, which is
 * all that can reasonably live in a saved document. The full pixels live here, keyed by baseline
 * and by (frame, pass), for as long as the app is running — which is what lets a comparison in the
 * same session answer "displaced by 14 pixels" instead of "somewhere in the lower right".
 *
 * When it does not have them, `ai/explain.js` degrades to signatures and SAYS SO. That is the
 * whole contract: losing resolution is fine, losing it silently is not.
 */
export class RasterStore {
  constructor({ capacity = 64 } = {}) {
    this.capacity = capacity;
    this.map = new Map(); // `${owner}|${pass}@${frame}` -> raster
    this.order = [];
    this.dropped = 0;
  }

  put(owner, raster) {
    const key = `${owner}|${raster.pass}@${raster.frame}`;
    if (!this.map.has(key)) this.order.push(key);
    this.map.set(key, raster);
    while (this.map.size > this.capacity) {
      const victim = this.order.shift();
      this.map.delete(victim);
      this.dropped++;
    }
    return key;
  }

  get(owner, frame, pass) {
    return this.map.get(`${owner}|${pass}@${frame}`) || null;
  }

  /** A `(frame, pass) => raster` lookup bound to one owner, which is the shape ai/explain.js wants. */
  lookup(owner) {
    return (frame, pass) => this.get(owner, frame, pass);
  }

  forget(owner) {
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(`${owner}|`)) { this.map.delete(key); this.order.splice(this.order.indexOf(key), 1); }
    }
  }

  stats() {
    return {
      held: this.map.size,
      capacity: this.capacity,
      dropped: this.dropped,
      storage: 'in memory, this session only. A baseline reloaded from disk keeps its digests and signatures but not its pixels, and a comparison against it degrades to block granularity and says so',
    };
  }
}

/** The compact form of a raster that a baseline can hold and a result can return: no pixels. */
export function observationOf(raster) {
  return {
    frame: raster.frame,
    pass: raster.pass,
    digest: rasterDigest(raster),
    signature: signature(raster),
    camera: raster.camera,
    stats: raster.encoding === 'id8'
      ? { objects: Object.keys(raster.palette || {}).length, resolution: `${raster.width}x${raster.height}` }
      : { resolution: `${raster.width}x${raster.height}` },
  };
}

export function passLimitations() {
  return {
    cannot: [
      'render anything but rig part meshes: props, effect items, screen effects, camera bodies, the ground, the grid, joint handles and selection boxes are excluded from every pass',
      'render depth, normals, motion vectors, alpha, shadows or material IDs — see ai/observe.js PASSES for what blocks each',
      'render at a non-square aspect: the target is square so that framing is a property of the pass rather than of the current panel layout',
      'guarantee bit-identical output across GPUs or drivers. Within one session on one machine it is deterministic, which is what a baseline comparison needs',
    ],
    assumptions: [
      'the caller has already scrubbed to the frame AND let it paint. renderPasses reads the scene as it currently stands and does not evaluate the timeline itself',
      'index 0 in an object-ID pass is background. A pixel carrying an index the palette does not name is counted as unclassified rather than attributed to the nearest object',
    ],
  };
}
